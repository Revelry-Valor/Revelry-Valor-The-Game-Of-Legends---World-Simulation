import type { Env } from './env';
import { cropYear, isFood, PROVISIONS } from './economy';
import type { FarmLayer } from './rural';
import { baseWorth, spareAll } from './trade';
import type { Settlement, SimState } from './state';
import { FARM_SHARE, GRAZING_KM, MARKET, tierOf } from './tiers';

/**
 * Catchments and food competition (REDESIGN.md, "Settlements and population", step 4), yearly.
 *
 * Every town (a market town or bigger, or a dawn city) draws food from the surplus of the farmed
 * provinces it can reach (rural.ts: what their land grows beyond what its working farmers, herders
 * and fishers eat). How far it reaches depends on transport:
 * - over land, about 15 km past a province's edge (its own province, and those it stands near); and
 *   from the grazing ring, 15–30 km off, only the herds, driven in on the hoof;
 * - by river (with rafts and canoes), from a town on a river along the river provinces it runs
 *   through, up to 150 km, at a seventh of the cost of hauling by land;
 * - by sea (with sailing), from a coastal town to coastal provinces up to 600 km off (1,200 with
 *   navigation), at a thirtieth of the cost, plus loading and unloading.
 * Where catchments overlap, each province's surplus is split among the towns reaching it in
 * proportion to how cheaply each can reach it, none taking more than it needs (what its people eat,
 * and a tenth over to grow on); what one doesn't need goes to the others. What a town draws comes
 * into its stores month by month, so its own people turn from the fields to crafts and trade.
 *
 * A town short of food goes hungry: its growth stalls, then people leave for the countryside, then
 * it shrinks (as before). So towns can't sit side by side (a new one near an old one starves both),
 * towns near a great city stay small (it takes their surplus), and only a town with water can grow
 * past what the land round it feeds: about 10–15 thousand by land, 50–100 thousand by river, more by
 * sea with grain brought from afar.
 *
 * And the country people its land can't employ move to the towns that draw on it (a fifth of them
 * a year, to the one that reaches it most cheaply).
 *
 * Food reaches a town three ways (REDESIGN.md, "Settlements and population", food supply):
 * - Rent and tax in kind, first: the realm takes a share of what each province's farmers grow (more
 *   under lords and the state than among clans or free cities) for the lord's seat in the province and
 *   for the capital (feudal lords keep most at their seats; the state sends most to the capital, if
 *   the capital can reach the province). It comes in free. Where it is more than the farmers spare,
 *   it comes out of their own food: the country goes hungry.
 * - The market: what is left of the surplus the countryside sells to the towns that reach it, and
 *   the towns pay for it in goods (tools, cloth, salt, wares: whatever they can spare, at their own
 *   prices). A town with little to sell buys little: its crafts are what feed it.
 * - Trade from afar (trade.ts): a town on a river or the coast deals in grain, buying half as much
 *   again as it eats from the provinces it reaches by water (paid in goods like the rest); its
 *   caravans and ships carry what it can spare to wherever food is dear.
 * The harvest is good or bad by region and year (economy.ts cropYear): a short one leaves less to
 * sell, and where it falls below what the farmers eat, the country goes hungry; the towns live on
 * their stores, and their food grows dear.
 * A town's own fields (its farmers, close round it) feed the rest.
 */

export const LAND_KM = 15;
export const RIVER_KM = 150;
export const SEA_KM = 600;
/** What a km costs by river and by sea, against land (1); a port's loading and unloading (km of land). */
const RIVER_COST = 0.15;
const SEA_COST = 0.03;
const PORT = 3;
/** A town asks for what its people eat and a tenth over. */
const HEADROOM = 1.1;
/** Share of the country people its land can't employ who move to a town each year. */
export const TO_TOWN = 0.2;

export type Mode = 'land' | 'river' | 'sea' | 'rent' | 'herd';
export interface Imports {
  /** Rations a year drawn, and from where (province id, rations, how). */
  rations: number;
  from: [number, number, Mode][];
  /** Of them: owed as rent and tax (free), and offered at market (paid for in goods). */
  rent?: number;
  market?: number;
  /** Rations bought at market so far this year and last year (what it could pay for), and the worth of the goods it paid. */
  bought?: number;
  boughtLast?: number;
  paid?: number;
  paidLast?: number;
  /** It deals in grain (on the water): it keeps more in store, to sell on. */
  deal?: boolean;
}

/** The ways of holding land, and the share of the farmers' crop the realm takes in rent and tax, and how much of it goes to the capital (the rest to the lord's seat). */
export const RENT: Record<string, { share: number; capital: number }> = {
  'Clans and tribes': { share: 0.05, capital: 0.2 },
  'Great lords with vassals (feudal)': { share: 0.15, capital: 0.25 },
  'Appointed governors': { share: 0.12, capital: 0.5 },
  'The state directly': { share: 0.12, capital: 0.65 },
  Temples: { share: 0.15, capital: 0.4 },
  'Free cities': { share: 0.05, capital: 0.3 },
};
/** Months of food a town keeps in store, buying at market (a grain town twice as many). */
export const STOCK_MONTHS = 6;
/** A grain town buys this share of what it eats again, to deal in (by water). */
export const DEAL = 0.5;
/** What a ration of food fetches from the country people, in the one currency (a unit of staple at ease). */
export const FOOD_WORTH = 1;

/** Who takes a province's rent: the share, the lord's seat there and the realm's capital (either may be missing). */
export interface Lords {
  share: number;
  toCapital: number;
  seat: Settlement | null;
  capital: Settlement | null;
}

export interface CatchmentContext {
  sim: SimState;
  env: Env;
  farms: FarmLayer;
  provAt(x: number, y: number): number;
  /** The climate point a place stands on (its nearest land point). */
  cellOf(x: number, y: number): number;
  /** Food a settlement's people eat a year (rations). */
  eats(st: Settlement): number;
  /** Whether a settlement's people know a technology. */
  knows(st: Settlement, id: string): boolean;
  dist(ax: number, ay: number, bx: number, by: number): number;
  /** Who takes a province's rent (null: no one rules it). */
  lords?(p: number): Lords | null;
}

/** The towns that draw on the land's surplus. */
export const drawsFood = (st: Settlement) => !st.ruined && !st.layer && st.partOf === undefined && (st.kind === 'dawn' || tierOf(st) >= MARKET);

/**
 * The most of a town's workers who work for food this year: its tier's share where the countryside
 * feeds it, up to nearly all of them where it doesn't (an early city with no countryside round it yet
 * is a farming town: most of its people walk out to its fields each day).
 */
export function farmShareOf(st: Settlement, eats: number): number {
  const tier = FARM_SHARE[tierOf(st)];
  const covered = Math.min(1, (st.imports?.rations ?? 0) / Math.max(1, eats));
  return tier + (FARM_SHARE[1] - tier) * (1 - covered);
}

/** The provinces a town can reach, and the effective distance (km of land haulage) by the cheapest way. */
export function reachOf(c: CatchmentContext, st: Settlement): Map<number, { e: number; mode: Mode }> {
  const { env } = c;
  const P = env.prov;
  const out = new Map<number, { e: number; mode: Mode }>();
  const put = (p: number, e: number, mode: Mode) => {
    const o = out.get(p);
    if (!o || e < o.e) out.set(p, { e, mode });
  };
  const p0 = c.provAt(st.x, st.y);
  if (p0 < 0) return out;
  const radius = (p: number) => Math.sqrt(P.area[p] / Math.PI);
  // Over land: grain from about 15 km; herds walk in from up to 30 (the grazing ring, tiers.ts).
  put(p0, 0, 'land');
  const seen = new Set([p0]);
  let front = [p0];
  for (let step = 0; step < 3 && front.length; step++) {
    const next: number[] = [];
    for (const p of front) for (let i = P.nbStart[p]; i < P.nbStart[p + 1]; i++) {
      const q = P.nb[i];
      if (seen.has(q) || P.kind[q] !== 0) continue;
      seen.add(q);
      const past = Math.max(0, c.dist(st.x, st.y, P.x[q], P.y[q]) - radius(q));
      if (past <= LAND_KM) put(q, past, 'land');
      else if (past <= GRAZING_KM) put(q, past, 'herd');
      else continue;
      next.push(q);
    }
    front = next;
  }
  const k = c.cellOf(st.x, st.y);
  // On the river: any of its points river, or right beside one (a river is marked only every few points).
  const freshNear = (k: number) => {
    if (env.fresh[k]) return true;
    const i = k % env.w;
    return (i > 0 && env.fresh[k - 1] === 1) || (i < env.w - 1 && env.fresh[k + 1] === 1) || (k >= env.w && env.fresh[k - env.w] === 1) || (k + env.w < env.n && env.fresh[k + env.w] === 1);
  };
  const river = (p: number) => {
    for (let q = P.start[p]; q < P.start[p + 1]; q++) if (freshNear(P.cells[q])) return true;
    return false;
  };
  const coastal = (p: number) => {
    for (let q = P.start[p]; q < P.start[p + 1]; q++) if (env.coast[P.cells[q]] && env.land[P.cells[q]]) return true;
    return false;
  };
  // By river: along the river provinces from its own.
  if (k >= 0 && freshNear(k) && river(p0) && c.knows(st, 'rafts')) {
    const got = new Map<number, number>([[p0, 0]]);
    let front = [p0];
    while (front.length) {
      const next: number[] = [];
      for (const p of front) for (let i = P.nbStart[p]; i < P.nbStart[p + 1]; i++) {
        const q = P.nb[i];
        if (!river(q)) continue;
        const d = got.get(p)! + Math.hypot(P.x[q] - P.x[p], P.y[q] - P.y[p]);
        if (d > RIVER_KM || d >= (got.get(q) ?? Infinity)) continue;
        got.set(q, d);
        next.push(q);
      }
      front = next;
    }
    for (const [p, d] of got) put(p, d * RIVER_COST, 'river');
  }
  // By sea: to coastal provinces along the coasts and across the water.
  if (k >= 0 && env.coast[k] && c.knows(st, 'sailing')) {
    const reach = SEA_KM * (c.knows(st, 'navigation') ? 2 : 1);
    for (let p = 0; p < P.count; p++) {
      if (P.kind[p] !== 0 || !coastal(p)) continue;
      const d = c.dist(st.x, st.y, P.x[p], P.y[p]);
      if (d <= reach) put(p, PORT + d * SEA_COST, 'sea');
    }
  }
  return out;
}

/** Once a year: each town's rent, then its catchment, and each province's surplus split among the towns reaching it. */
export function catchmentYear(c: CatchmentContext): void {
  const { sim, farms } = c;
  const P = c.env.prov;
  const towns = sim.settlements.filter(drawsFood);
  const want = new Map<Settlement, number>();
  const got = new Map<Settlement, Imports>();
  const reach = new Map<Settlement, Map<number, { e: number; mode: Mode }>>();
  for (const st of towns) {
    want.set(st, c.eats(st) * HEADROOM);
    got.set(st, { rations: 0, from: [], rent: 0, market: 0 });
    reach.set(st, reachOf(c, st));
  }
  const give = (st: Settlement, p: number, n: number, mode: Mode) => {
    want.set(st, want.get(st)! - n);
    const im = got.get(st)!;
    im.rations += n;
    if (mode === 'rent') im.rent! += n;
    else im.market! += n;
    const f = im.from.find((x) => x[0] === P.ids[p] && x[2] === mode);
    if (f) f[1] += n;
    else im.from.push([P.ids[p], n, mode]);
  };
  // ---- This year's harvest, good or bad: what is left over what the farmers eat (a failed one leaves them short).
  const year = Math.floor(sim.day / 360);
  const left = new Float32Array(P.count);
  for (let p = 0; p < P.count; p++) {
    const ate = farms.ate?.[p] ?? 0;
    const grown = (ate + Math.max(0, farms.surplus[p])) * cropYear(c.env, P.x[p], P.y[p], year);
    left[p] = Math.max(0, grown - ate);
    if (grown < ate && ate > 0) {
      const keep = grown / ate;
      for (let q = P.start[p]; q < P.start[p + 1]; q++) farms.farm[P.cells[q]] *= keep;
    }
  }
  // ---- Rent and tax in kind, first: to the lord's seat in the province and to the capital.
  if (c.lords) for (let p = 0; p < P.count; p++) {
    const grown = (farms.ate?.[p] ?? 0) + left[p];
    if (grown <= 0) continue;
    const L = c.lords(p);
    if (!L || L.share <= 0) continue;
    const seat = L.seat && want.has(L.seat) ? L.seat : null;
    const capital = L.capital && want.has(L.capital) && reach.get(L.capital)!.has(p) ? L.capital : null;
    if (!seat && !capital) continue;
    const due = grown * L.share;
    const parts: [Settlement, number][] = seat === capital ? [[seat!, due]] : !capital ? [[seat!, due]] : !seat ? [[capital, due]] : [[seat, due * (1 - L.toCapital)], [capital, due * L.toCapital]];
    let taken = 0;
    for (const [st, n] of parts) {
      // A lord takes what his household and town eat (and a tenth over), no more: the rest the farmers keep to sell.
      const take = Math.min(n, Math.max(0, want.get(st)!));
      if (take <= 0.5) continue;
      give(st, p, take, 'rent');
      taken += take;
    }
    // Rent past what the farmers spare comes out of their own food (the country goes hungry).
    const bite = taken - left[p];
    left[p] = Math.max(0, left[p] - taken);
    if (bite > 0 && farms.ate && farms.ate[p] > 0) {
      const keep = Math.max(0, 1 - bite / Math.max(farms.rural[p], 1));
      for (let q = P.start[p]; q < P.start[p + 1]; q++) farms.farm[P.cells[q]] *= keep;
    }
  }
  // A town on the water deals in grain: it buys more, to sell on (trade.ts).
  for (const st of towns) if ([...reach.get(st)!.values()].some((r) => r.mode === 'river' || r.mode === 'sea')) {
    want.set(st, want.get(st)! + c.eats(st) * DEAL);
    got.get(st)!.deal = true;
  }
  // ---- The market: the rest of each province's surplus split by how cheaply each town reaches it, none
  // past its need (the rest to the others). The provinces fewest reach go first, so a town shared with
  // others draws on its own first.
  const byProv = new Map<number, { st: Settlement; w: number; mode: Mode }[]>();
  for (const st of towns) for (const [p, r] of reach.get(st)!) {
    if (left[p] <= 0) continue;
    const list = byProv.get(p) ?? [];
    list.push({ st, w: 1 / (1 + r.e / LAND_KM), mode: r.mode });
    byProv.set(p, list);
  }
  for (const [p, list] of [...byProv].sort((a, b) => a[1].length - b[1].length)) {
    let rest = left[p];
    // From the grazing ring only its herds come (on the hoof).
    let herdRest = rest * (farms.herds?.[p] ?? 0);
    let open = list.filter((q) => want.get(q.st)! > 0.5 && (q.mode !== 'herd' || herdRest > 0.5));
    for (let pass = 0; pass < 4 && rest > 0.5 && open.length; pass++) {
      const W = open.reduce((n, q) => n + q.w, 0);
      let given = 0;
      for (const q of open) {
        let take = Math.min(want.get(q.st)!, (rest * q.w) / W);
        if (q.mode === 'herd') take = Math.min(take, herdRest);
        if (take <= 0) continue;
        give(q.st, p, take, q.mode);
        if (q.mode === 'herd') herdRest -= take;
        given += take;
      }
      rest -= given;
      open = open.filter((q) => want.get(q.st)! > 0.5 && (q.mode !== 'herd' || herdRest > 0.5));
    }
  }
  const round = (im: Imports): Imports => ({ ...im, rations: Math.round(im.rations), rent: Math.round(im.rent ?? 0), market: Math.round(im.market ?? 0), from: im.from.map(([id, n, m]) => [id, Math.round(n), m] as [number, number, Mode]).filter((f) => f[1] > 0).sort((a, b) => b[1] - a[1]) });
  for (const st of sim.settlements) {
    const old = st.imports;
    const im = got.get(st);
    delete st.imports;
    if (im && im.rations > 0.5) st.imports = { ...round(im), boughtLast: Math.round(old?.bought ?? 0), paidLast: Math.round(old?.paid ?? 0) };
  }
}

/**
 * Each month: a town's food from outside comes in. Its rent and tax come in free; what the country
 * offers at market it buys with the goods it can spare (at its own prices), and gets only what it
 * can pay for (the rest the country people keep).
 */
export function deliverMonth(env: Env, st: Settlement, needPer: number): void {
  const im = st.imports;
  const e = st.economy;
  if (!im || !e || st.ruined) return;
  const S = e.stores;
  // (Imports worked out before rent and market were told apart come in as they did.)
  if (im.rent === undefined && im.market === undefined) {
    S[PROVISIONS] = (S[PROVISIONS] ?? 0) + im.rations;
    return;
  }
  let got = im.rent ?? 0;
  // It buys only to keep its stores at about half a year's food (a grain town a year's).
  let food = 0;
  for (const [id, v] of Object.entries(S)) if (isFood(env, id)) food += v;
  const need = Math.max(1, st.pop * needPer);
  const offered = Math.min(im.market ?? 0, Math.max(0, need * (im.deal ? STOCK_MONTHS * 2 : STOCK_MONTHS) - food - got));
  if (offered > 0) {
    const spare = spareAll(env, st, needPer);
    let worth = 0;
    const goods: [string, number, number][] = [];
    for (const [id, v] of Object.entries(spare)) {
      if (isFood(env, id) || v <= 0) continue;
      const w = e.prices?.[id] ?? baseWorth(env, id);
      // The country takes no more than half of what it can spare of any one thing (it keeps some to trade).
      goods.push([id, v * 0.5, w]);
      worth += v * 0.5 * w;
    }
    const pay = Math.min(offered * FOOD_WORTH, worth);
    if (pay > 0) {
      for (const [id, v] of goods) S[id] = Math.max(0, (S[id] ?? 0) - (v * pay) / worth);
      const bought = pay / FOOD_WORTH;
      got += bought;
      im.bought = (im.bought ?? 0) + bought;
      im.paid = (im.paid ?? 0) + pay;
    }
  }
  if (got > 0) S[PROVISIONS] = (S[PROVISIONS] ?? 0) + got;
}

/** The towns each province's surplus goes to this year (for its card): town, rations, how. */
export function surplusGoesTo(sim: SimState, provId: number): { st: Settlement; rations: number; mode: Mode }[] {
  const out: { st: Settlement; rations: number; mode: Mode }[] = [];
  for (const st of sim.settlements) for (const [id, n, mode] of st.imports?.from ?? []) if (id === provId) out.push({ st, rations: n, mode });
  return out.sort((a, b) => b.rations - a.rations);
}
