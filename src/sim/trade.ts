import type { Library } from '../core/library';
import type { Env } from './env';
import { isFood, NEEDS, resInfoOf } from './economy';
import type { RaceInfo } from './sim';
import type { Caravan, Settlement, SimState } from './state';
import { allRail, knows, pathCells, pathSpeed, TRAIN_COAL_PER_100KM, WAYS } from './ways';

/**
 * Markets and trade (REDESIGN.md 8.4h, Phase 7 step 2).
 *
 * Each settlement has its own market: every good has a price there, in the one currency, set by
 * how much of it is kept against how much is wanted: dear in shortage, cheap in surplus. The
 * currency is the measure of worth everywhere; goods change hands by barter (coin comes with
 * minting and governments). A settlement sends a caravan when a partner within reach values its
 * surplus more than it does and has something to give back that it values more than the partner
 * does: both sides must gain. Caravans walk there and back, carrying more with pack animals.
 */

const CATEGORY_WORTH: Record<string, number> = { Food: 1, Plant: 1, Wood: 0.6, Stone: 0.5, 'Animal product': 1.5, Metal: 3, Mineral: 1, Gem: 8, Luxury: 4, 'Rift and mana': 10 };
const RARITY_WORTH: Record<string, number> = { Common: 1, Uncommon: 2, Rare: 5, 'Very rare': 15 };

/** What a unit of a good is worth where it is neither short nor plentiful. */
export function baseWorth(env: Env, id: string): number {
  const r = resInfoOf(env, id);
  if (!r) return 1;
  return (CATEGORY_WORTH[r.category] ?? 1) * (RARITY_WORTH[r.rarity] ?? 1);
}
/** Dear in shortage, cheap in plenty: months of it in store against the months a market likes to keep. */
const scarcity = (months: number, target: number) => Math.max(0.35, Math.min(4, Math.pow(target / Math.max(0.25, months), 0.6)));

/** How much of a good people want each month here (besides food). */
function desire(env: Env, id: string, pop: number): number {
  const r = resInfoOf(env, id);
  if (!r) return pop * 0.002;
  const nd = NEEDS.find((n) => n.match(r));
  if (nd) return nd.per * pop;
  return r.category === 'Luxury' || r.category === 'Gem' || r.category === 'Metal' ? pop * 0.003 : pop * 0.002;
}

/** Work out a settlement's prices from its stores. */
export function updatePrices(env: Env, st: Settlement, needPer: number): Record<string, number> {
  const e = st.economy!;
  const S = e.stores;
  const need = Math.max(1, st.pop * needPer);
  let food = 0;
  for (const [id, v] of Object.entries(S)) if (isFood(env, id)) food += v;
  const foodMonths = food / need;
  const prices: Record<string, number> = {};
  const ids = new Set([...env.resInfo.map((r) => r.id), ...Object.keys(S)]);
  for (const id of ids) {
    const r = resInfoOf(env, id);
    if (!r || r.source === 'Rift') continue;
    const base = baseWorth(env, id);
    if (r.food) {
      prices[id] = base * scarcity(foodMonths, 6);
      continue;
    }
    const nd = NEEDS.find((n) => n.match(r));
    if (nd) {
      // One need, many goods that meet it: what counts is how much of all of them is kept.
      let have = 0;
      for (const q of env.resInfo) if (!q.food && nd.match(q)) have += S[q.id] ?? 0;
      prices[id] = base * scarcity(have / Math.max(0.01, nd.per * st.pop), 6);
      continue;
    }
    prices[id] = base * scarcity((S[id] ?? 0) / Math.max(0.01, desire(env, id, st.pop)), 12);
  }
  e.prices = prices;
  return prices;
}

/** How much a settlement can spare of everything it keeps (worked out at once: totals by need). */
export function spareAll(env: Env, st: Settlement, needPer: number): Record<string, number> {
  const S = st.economy?.stores ?? {};
  const res = st.economy?.reserve ?? {};
  let food = 0;
  const byNeed = NEEDS.map(() => 0);
  const needOf = new Map<string, number>();
  for (const [id, v] of Object.entries(S)) {
    const r = resInfoOf(env, id);
    if (!r) continue;
    if (r.food) food += v;
    else {
      const i = NEEDS.findIndex((n) => n.match(r));
      needOf.set(id, i);
      if (i >= 0) byNeed[i] += v;
    }
  }
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(S)) {
    const r = resInfoOf(env, id);
    if (!r) continue;
    const kept = (res[id] ?? 0) + (r.category === 'Wood' ? res.wood ?? 0 : 0) + (r.category === 'Stone' ? res.stone ?? 0 : 0);
    const have = v - kept;
    if (have <= 0) continue;
    let spare: number;
    if (r.food) spare = Math.min(have, food - st.pop * needPer * 5);
    else {
      const i = needOf.get(id) ?? -1;
      spare = i >= 0 ? Math.min(have, byNeed[i] - NEEDS[i].per * st.pop * 8) : have - desire(env, id, st.pop) * 6;
    }
    if (spare > 0) out[id] = spare;
  }
  return out;
}

/** How much of a good a settlement can spare: what is over a good stock to keep. */
export function surplus(env: Env, st: Settlement, needPer: number, id: string): number {
  const S = st.economy?.stores ?? {};
  const r = resInfoOf(env, id);
  if (!r) return 0;
  // Materials kept back for its ways are not for trade.
  const res = st.economy?.reserve ?? {};
  const kept = (res[id] ?? 0) + (r.category === 'Wood' ? res.wood ?? 0 : 0) + (r.category === 'Stone' ? res.stone ?? 0 : 0);
  const have = (S[id] ?? 0) - kept;
  if (have <= 0) return 0;
  if (r.food) {
    let food = 0;
    for (const [q, v] of Object.entries(S)) if (isFood(env, q)) food += v;
    return Math.max(0, Math.min(have, food - st.pop * needPer * 5));
  }
  const nd = NEEDS.find((n) => n.match(r));
  if (nd) {
    let total = 0;
    for (const q of env.resInfo) if (!q.food && nd.match(q)) total += S[q.id] ?? 0;
    return Math.max(0, Math.min(have, total - nd.per * st.pop * 8));
  }
  return Math.max(0, have - desire(env, id, st.pop) * 6);
}

export interface TradeContext {
  sim: SimState;
  env: Env;
  lib: Library;
  info: (t: { race: string; culture: string }) => RaceInfo | null;
  dist: (ax: number, ay: number, bx: number, by: number) => number;
  /** Can people of this race be at this place (land, mountains they can cross)? */
  passableAt: (ri: RaceInfo, x: number, y: number) => boolean;
  cellAt: (x: number, y: number) => number;
  rand: () => number;
  log: (text: string, x?: number, y?: number) => void;
}

/** How readily two settlements trade (0 never, 1 freely): kin freely, wary peoples less, never with a grudge or an open fight. */
export function willingness(c: TradeContext, a: Settlement, b: Settlement): number {
  if (a.clan === b.clan) return 1;
  const { sim, lib } = c;
  if (sim.grudges.some((g) => (g.race === a.race && g.against === b.race) || (g.race === b.race && g.against === a.race))) return 0;
  // Fighting each other now.
  const fighting = (x: Settlement, y: Settlement) => sim.sorties.some((s) => s.clan === x.clan && sim.tribes.find((t) => t.id === s.target)?.clan === y.clan) || sim.sorties.some((s) => s.clan === x.clan && s.targetKind === 'settlement' && s.target === y.id);
  if (fighting(a, b) || fighting(b, a)) return 0;
  const sa = lib.species.find((s) => s.id === a.species);
  const other = lib.species.find((s) => s.id === b.species);
  const att = sa?.profile.attitudes.find((x) => x.species === other?.name)?.attitude || sa?.profile.attitude || 'Wary';
  let w = att === 'Welcoming' ? 1 : att === 'Indifferent' ? 0.7 : 0.4;
  if (a.species === b.species) w = Math.max(w, 0.8);
  if (a.culture && a.culture === b.culture) w = Math.min(1, w * 1.2);
  return w;
}

/** Goods a partner should give back for a cargo: what it can spare that home values more, worth (at its own prices) a little under what it receives. */
function barterReturn(env: Env, home: Settlement, partner: Settlement, partnerSpare: Record<string, number>, cargo: Record<string, number>, capacity: number): Record<string, number> {
  const pH = home.economy?.prices ?? {};
  const pP = partner.economy?.prices ?? {};
  let worth = 0;
  for (const [id, u] of Object.entries(cargo)) worth += u * (pP[id] ?? baseWorth(env, id));
  worth *= 0.9;
  const offers = Object.keys(partnerSpare)
    .filter((id) => !(id in cargo) && (pP[id] ?? 0) > 0)
    .map((id) => ({ id, ratio: (pH[id] ?? baseWorth(env, id)) / pP[id], spare: partnerSpare[id] }))
    .filter((o) => o.spare > 0.5 && o.ratio > 1.15)
    .sort((a, b) => b.ratio - a.ratio);
  const out: Record<string, number> = {};
  let room = capacity;
  for (const o of offers) {
    if (worth <= 0.01 || room <= 0.01) break;
    const u = Math.min(o.spare, room, worth / pP[o.id]);
    if (u < 0.5) continue;
    out[o.id] = u;
    room -= u;
    worth -= u * pP[o.id];
  }
  return out;
}

const CARRY_PERSON = 2;
const CARRY_ANIMAL = 6;

/** The points between two settlements (they don't move, so worked out once). */
const paths = new WeakMap<SimState, Map<string, number[]>>();
function pathBetween(c: TradeContext, a: Settlement, b: Settlement): number[] {
  let m = paths.get(c.sim);
  if (!m) paths.set(c.sim, (m = new Map()));
  const key = `${a.id}:${b.id}`;
  let p = m.get(key);
  if (!p) m.set(key, (p = pathCells(c.env, a.x, a.y, b.x, b.y, c.cellAt)));
  return p;
}

/** Each month: settlements look for a good trade, and send a caravan if one is worth the road. */
export function tradeMonth(c: TradeContext): void {
  const { sim, env } = c;
  const live = sim.settlements.filter((s) => !s.ruined && s.economy);
  // Each settlement takes its turn every third month: it sets its prices and looks for a trade
  // (caravans take months on the road anyway). Partners' markets are read as they were last set,
  // or set now if they never were.
  const month = Math.floor(sim.day / 30);
  const turn = (st: Settlement) => (st.id + month) % 3 === 0;
  const spare = new Map<Settlement, Record<string, number>>();
  const ready = (st: Settlement) => {
    if (spare.has(st)) return spare.get(st)!;
    const ri = c.info(st);
    if (!ri) return {};
    if (turn(st) || !st.economy!.prices) updatePrices(env, st, ri.need);
    const sp = spareAll(env, st, ri.need);
    spare.set(st, sp);
    return sp;
  };
  for (const st of live) if (turn(st)) ready(st);
  // How far the fastest way anywhere lets a caravan go (to skip partners plainly out of reach).
  let fastest = 1;
  for (let k = 0; k < sim.way.length; k++) if (sim.way[k]) fastest = Math.max(fastest, WAYS[sim.way[k]].speed);
  for (const a of live) {
    if (!turn(a) || a.pop < 50 || sim.caravans.some((v) => v.from === a.id)) continue;
    const ra = c.info(a);
    if (!ra) continue;
    const pA = a.economy!.prices ?? {};
    // Pack animals, where beasts that carry loads live round it.
    const k = c.cellAt(a.x, a.y);
    const animalsHere = k >= 0 && env.beastInfo.some((b) => b.haul && (env.beastK[b.id]?.[k] ?? 0) > 0.2);
    const speed = ra.speed * (animalsHere ? 0.9 : 0.8);
    // Wagons where it knows the wheel carry half as much again.
    const wagons = knows(c.lib, a, 'carts') || knows(c.lib, a, 'wheel');
    const workers = Math.round(a.pop * ra.workShare) - (a.economy!.away ?? 0);
    const people = Math.max(3, Math.min(40, Math.round(workers * 0.08)));
    if (workers < people * 3) continue;
    const animals = animalsHere ? people * 2 : 0;
    const baseCapacity = (people * CARRY_PERSON + animals * CARRY_ANIMAL) * (wagons ? 1.5 : 1);
    let best: { b: Settlement; cargo: Record<string, number>; gain: number; worth: number; train: boolean; coal: number } | null = null;
    for (const b of live) {
      if (b === a) continue;
      const d = c.dist(a.x, a.y, b.x, b.y);
      if (d > speed * fastest * 25) continue;
      // Days on the road, faster along trails, roads and railways; up to about 25 days away.
      const cells = pathBetween(c, a, b);
      const days = d / (speed * pathSpeed(sim, cells));
      if (days > 25) continue;
      // A train, where the whole way is railway and there is coal to burn there and back.
      const coal = (2 * d * TRAIN_COAL_PER_100KM) / 100;
      const train = allRail(sim, cells) && (a.economy!.stores.coal ?? 0) >= coal + 1;
      const capacity = baseCapacity * (train ? 10 : 1);
      const w = willingness(c, a, b);
      if (w <= 0) continue;
      const rb = c.info(b);
      if (!rb) continue;
      ready(b);
      const pB = b.economy!.prices ?? {};
      const cost = 1.15 + 0.02 * days;
      // What to take: its surplus, where the partner values it most against home.
      const sA = ready(a);
      const goods = Object.keys(sA)
        .map((id) => ({ id, ratio: (pB[id] ?? 0) / (pA[id] ?? Infinity), spare: sA[id] }))
        .filter((g) => g.spare > 0.5 && g.ratio > cost)
        .sort((x, y) => y.ratio - x.ratio);
      if (!goods.length) continue;
      const cargo: Record<string, number> = {};
      let room = capacity;
      for (const g of goods.slice(0, 3)) {
        const u = Math.min(g.spare, room);
        if (u < 0.5) continue;
        cargo[g.id] = u;
        room -= u;
        if (room <= 0.5) break;
      }
      // Barter: the partner must have something to give back that home values more.
      const back = barterReturn(env, a, b, ready(b), cargo, capacity);
      let given = 0;
      for (const [id, u] of Object.entries(cargo)) given += u * (pA[id] ?? 0);
      let got = 0;
      for (const [id, u] of Object.entries(back)) got += u * (pA[id] ?? baseWorth(env, id));
      const gain = (got / cost - given) * w;
      if (gain > 2 && (!best || gain > best.gain)) best = { b, cargo, gain, worth: given, train, coal };
    }
    if (!best) continue;
    // Off it goes.
    for (const [id, u] of Object.entries(best.cargo)) a.economy!.stores[id] -= u;
    if (best.train) a.economy!.stores.coal -= best.coal;
    a.economy!.away = (a.economy!.away ?? 0) + people;
    const cv: Caravan = { id: sim.nextId++, from: a.id, to: best.b.id, clan: a.clan, x: a.x, y: a.y, leg: 'out', cargo: best.cargo, people, animals, speed, worth: best.worth, started: sim.day, ...(best.train ? { train: true } : {}) };
    sim.caravans.push(cv);
    traded(a, sim.day).out += best.worth;
    traded(a, sim.day).caravans++;
  }
}

function traded(st: Settlement, day: number) {
  const e = st.economy!;
  if (!e.traded || day - e.traded.since >= 360) e.traded = { out: 0, in: 0, caravans: 0, since: day };
  return e.traded;
}

/** Each day: caravans walk on (round whatever blocks the way), barter on arrival, and come home. */
export function caravansDay(c: TradeContext): void {
  const { sim, env } = c;
  for (const cv of [...sim.caravans]) {
    const home = sim.settlements.find((s) => s.id === cv.from);
    const there = sim.settlements.find((s) => s.id === cv.to);
    const goal = cv.leg === 'out' ? there : home;
    const ri = home ? c.info(home) : null;
    if (!home || !ri) {
      sim.caravans = sim.caravans.filter((q) => q !== cv);
      continue;
    }
    if (!goal || (cv.leg === 'out' && goal.ruined)) {
      cv.leg = 'home';
      continue;
    }
    // Feet on the ground: the way gets worn.
    const k = c.cellAt(cv.x, cv.y);
    if (k >= 0) sim.traffic[k] += (cv.people + cv.animals) / 10;
    const d = c.dist(cv.x, cv.y, goal.x, goal.y);
    // Faster along the way it is on.
    const step = cv.speed * (k >= 0 ? WAYS[sim.way[k]].speed : 1);
    if (d > step) {
      let dx = goal.x - cv.x;
      if (env.wrapKm && Math.abs(dx) > env.wrapKm / 2) dx -= Math.sign(dx) * env.wrapKm;
      const a0 = Math.atan2(goal.y - cv.y, dx);
      let moved = false;
      for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const nx = cv.x + Math.cos(a0 + turn) * step;
        const ny = cv.y + Math.sin(a0 + turn) * step;
        if (c.passableAt(ri, nx, ny)) {
          cv.x = env.wrapKm ? ((nx % env.wrapKm) + env.wrapKm) % env.wrapKm : nx;
          cv.y = ny;
          moved = true;
          break;
        }
      }
      // Lost the way, or gone on too long: turn for home (or, already going home, arrive as best it can).
      if (!moved || sim.day - cv.started > 200) {
        if (cv.leg === 'out') cv.leg = 'home';
        else arriveHome(c, cv, home);
      }
      continue;
    }
    if (cv.leg === 'out') arriveThere(c, cv, home, goal);
    else arriveHome(c, cv, home);
  }
}

function arriveThere(c: TradeContext, cv: Caravan, home: Settlement, b: Settlement): void {
  const { sim, env } = c;
  const ra = c.info(home);
  const rb = c.info(b);
  if (!ra || !rb || !b.economy) {
    cv.leg = 'home';
    return;
  }
  updatePrices(env, b, rb.need);
  updatePrices(env, home, ra.need);
  const back = barterReturn(env, home, b, spareAll(env, b, rb.need), cv.cargo, (cv.people * CARRY_PERSON + cv.animals * CARRY_ANIMAL) * (knows(c.lib, home, 'carts') || knows(c.lib, home, 'wheel') ? 1.5 : 1) * (cv.train ? 10 : 1));
  // Nothing to be had for it now (things changed on the road): no deal; the goods go home again.
  if (!Object.keys(back).length) {
    cv.leg = 'home';
    return;
  }
  const pB = b.economy.prices ?? {};
  let worthIn = 0;
  for (const [id, u] of Object.entries(cv.cargo)) {
    b.economy.stores[id] = (b.economy.stores[id] ?? 0) + u;
    worthIn += u * (pB[id] ?? 0);
  }
  let worthOut = 0;
  for (const [id, u] of Object.entries(back)) {
    b.economy.stores[id] -= u;
    worthOut += u * (pB[id] ?? 0);
  }
  traded(b, sim.day).in += worthIn;
  traded(b, sim.day).out += worthOut;
  const what = (o: Record<string, number>) => Object.keys(o).map((id) => resInfoOf(env, id)?.name.toLowerCase() ?? id).join(' and ') || 'nothing';
  // The route: the first trade along it is news.
  const [x, y] = home.id < b.id ? [home.id, b.id] : [b.id, home.id];
  let route = sim.routes.find((r) => r.a === x && r.b === y);
  if (!route) {
    route = { a: x, b: y, trips: 0, worth: 0, last: sim.day };
    sim.routes.push(route);
    const ca = sim.clans.find((q) => q.id === home.clan)?.name;
    const cb = sim.clans.find((q) => q.id === b.clan)?.name;
    c.log(`Traders from ${home.name} reached ${b.name}${home.clan !== b.clan ? ` (clan ${ca ?? '?'} with clan ${cb ?? '?'})` : ''}: ${what(cv.cargo)} for ${what(back)}.`, b.x, b.y);
  }
  route.trips++;
  route.worth += worthIn;
  route.last = sim.day;
  cv.cargo = back;
  cv.leg = 'home';
}

function arriveHome(c: TradeContext, cv: Caravan, home: Settlement): void {
  const { sim, env } = c;
  const e = home.economy;
  if (e) {
    const p = e.prices ?? {};
    for (const [id, u] of Object.entries(cv.cargo)) {
      e.stores[id] = (e.stores[id] ?? 0) + u;
      traded(home, sim.day).in += u * (p[id] ?? baseWorth(env, id));
    }
    e.away = Math.max(0, (e.away ?? 0) - cv.people);
  }
  sim.caravans = sim.caravans.filter((q) => q !== cv);
}
