import type { Env } from './env';
import type { FarmLayer } from './rural';
import type { Settlement, SimState } from './state';
import { MARKET, tierOf } from './tiers';

/**
 * Catchments and food competition (REDESIGN.md, "Settlements and population", step 4), yearly.
 *
 * Every town (a market town or bigger, or a dawn city) draws food from the surplus of the farmed
 * provinces it can reach (rural.ts: what their land grows beyond what its working farmers, herders
 * and fishers eat). How far it reaches depends on transport:
 * - over land, about 15 km past a province's edge (its own province, and one it stands at the edge of);
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

export type Mode = 'land' | 'river' | 'sea';
export interface Imports {
  /** Rations a year drawn, and from where (province id, rations, how). */
  rations: number;
  from: [number, number, Mode][];
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
}

/** The towns that draw on the land's surplus. */
export const drawsFood = (st: Settlement) => !st.ruined && !st.layer && st.partOf === undefined && (st.kind === 'dawn' || tierOf(st) >= MARKET);

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
  // Over land.
  put(p0, 0, 'land');
  for (let i = P.nbStart[p0]; i < P.nbStart[p0 + 1]; i++) {
    const q = P.nb[i];
    const past = c.dist(st.x, st.y, P.x[q], P.y[q]) - radius(q);
    if (past <= LAND_KM) put(q, Math.max(0, past), 'land');
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

/** Once a year: each town's catchment, and each province's surplus split among the towns reaching it. */
export function catchmentYear(c: CatchmentContext): void {
  const { sim, env, farms } = c;
  const P = env.prov;
  const towns = sim.settlements.filter(drawsFood);
  const want = new Map<Settlement, number>();
  const got = new Map<Settlement, Imports>();
  const byProv = new Map<number, { st: Settlement; w: number; mode: Mode }[]>();
  for (const st of towns) {
    want.set(st, c.eats(st) * HEADROOM);
    got.set(st, { rations: 0, from: [] });
    for (const [p, r] of reachOf(c, st)) {
      if (farms.surplus[p] <= 0) continue;
      const list = byProv.get(p) ?? [];
      list.push({ st, w: 1 / (1 + r.e / LAND_KM), mode: r.mode });
      byProv.set(p, list);
    }
  }
  // Each province's surplus split by how cheaply each reaches it, none past its need (the rest to the others).
  // The provinces fewest reach go first, so a town shared with others draws on its own first.
  for (const [p, list] of [...byProv].sort((a, b) => a[1].length - b[1].length)) {
    let left = farms.surplus[p];
    let open = list.filter((q) => want.get(q.st)! > 0);
    for (let pass = 0; pass < 4 && left > 0.5 && open.length; pass++) {
      const W = open.reduce((n, q) => n + q.w, 0);
      let given = 0;
      for (const q of open) {
        const take = Math.min(want.get(q.st)!, (left * q.w) / W);
        if (take <= 0) continue;
        want.set(q.st, want.get(q.st)! - take);
        const im = got.get(q.st)!;
        im.rations += take;
        const f = im.from.find((x) => x[0] === P.ids[p]);
        if (f) f[1] += take;
        else im.from.push([P.ids[p], take, q.mode]);
        given += take;
      }
      left -= given;
      open = open.filter((q) => want.get(q.st)! > 0.5);
    }
  }
  for (const st of sim.settlements) delete st.imports;
  for (const [st, im] of got) if (im.rations > 0.5) st.imports = { rations: Math.round(im.rations), from: im.from.map(([id, n, m]) => [id, Math.round(n), m] as [number, number, Mode]).sort((a, b) => b[1] - a[1]) };
}

/** The towns each province's surplus goes to this year (for its card): town, rations, how. */
export function surplusGoesTo(sim: SimState, provId: number): { st: Settlement; rations: number; mode: Mode }[] {
  const out: { st: Settlement; rations: number; mode: Mode }[] = [];
  for (const st of sim.settlements) for (const [id, n, mode] of st.imports?.from ?? []) if (id === provId) out.push({ st, rations: n, mode });
  return out.sort((a, b) => b.rations - a.rations);
}
