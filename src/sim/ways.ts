import type { Library } from '../core/library';
import type { Env } from './env';
import { resInfoOf } from './economy';
import type { Settlement, SimState } from './state';

/**
 * The travel network (REDESIGN.md 8.4h and the Phase 7 decisions, step 3).
 *
 * Trails grow from use: where people, herds and caravans walk often a trail forms, and it fades
 * when they stop. Past trails, a way has to be built: the builder must know how (a technology)
 * and have the resources, and must keep paying upkeep each year or the way falls back a tier.
 * Busy trade routes are improved by whichever end can. Trains need the whole way laid as railway,
 * and burn coal for each run.
 *
 * Bridges are a nation's choice (to shorten travel between its cities, to draw trade, or as a
 * term of a pact) and come with nations in Phase 9.
 */

export interface WayTier {
  tier: number;
  id: string;
  name: string;
  /** Technologies that let it be built (any one of them); none for a trail. */
  techs: string[];
  /** How much faster than open country. */
  speed: number;
  /** Resources to build a kilometre, by kind ('wood', 'stone', or a resource id). */
  build: Record<string, number>;
  /** Share of the building cost needed each year to keep it up. */
  upkeep: number;
  colour: string;
}

export const WAYS: WayTier[] = [
  { tier: 0, id: 'none', name: 'No way', techs: [], speed: 1, build: {}, upkeep: 0, colour: '' },
  { tier: 1, id: 'trail', name: 'Trail', techs: [], speed: 1.25, build: {}, upkeep: 0, colour: '#b08a5a' },
  { tier: 2, id: 'track', name: 'Cart track', techs: ['wheel'], speed: 1.5, build: { wood: 0.2 }, upkeep: 0.05, colour: '#8c5a2b' },
  { tier: 3, id: 'road', name: 'Paved road', techs: ['roads'], speed: 2, build: { stone: 1 }, upkeep: 0.05, colour: '#d8d4cc' },
  { tier: 4, id: 'rail', name: 'Railway', techs: ['railways', 'mana-rail'], speed: 6, build: { iron: 2, wood: 1, stone: 0.5 }, upkeep: 0.05, colour: '#1c1c1c' },
];
/** Mana rail is laid with mana crystals in place of iron. */
const MANA_RAIL_BUILD: Record<string, number> = { 'mana-crystal': 0.2, stone: 0.5 };
/** Coal a train burns per 100 km of a run (each way). */
export const TRAIN_COAL_PER_100KM = 1;
/** Traffic (see SimState.traffic) at which a trail forms, and below which an unbuilt trail fades. */
const TRAIL_FORMS = 20;
const TRAIL_FADES = 4;
/** Ways built per year by a settlement along a route (points of the grid). */
const BUILD_PER_YEAR = 4;

/** Whether a settlement knows a technology: every people's starting ones, and those it has learned. */
export function knows(lib: Library, st: Settlement, techId: string): boolean {
  const t = lib.techs.find((q) => q.id === techId);
  if (!t) return false;
  return t.start || (st.techs ?? []).includes(techId);
}

/** The best way a settlement can build (1: trails only), and with which technology. */
export function bestWay(lib: Library, st: Settlement): { tier: number; tech: string } {
  for (let i = WAYS.length - 1; i >= 2; i--) {
    const tech = WAYS[i].techs.find((t) => knows(lib, st, t));
    if (tech) return { tier: i, tech };
  }
  return { tier: 1, tech: '' };
}

/** What building a tier costs per km (mana rail differs). */
export function buildCost(tier: number, tech = ''): Record<string, number> {
  if (tier === 4 && tech === 'mana-rail') return MANA_RAIL_BUILD;
  return WAYS[tier]?.build ?? {};
}

/** Take resources of a kind from a settlement's stores ('wood' and 'stone' take any wood or stone). Returns whether it had enough (and took it). */
function pay(env: Env, st: Settlement, cost: Record<string, number>): boolean {
  const S = st.economy?.stores;
  if (!S) return false;
  const pick = (kind: string) => Object.keys(S).filter((id) => (kind === 'wood' ? resInfoOf(env, id)?.category === 'Wood' : kind === 'stone' ? resInfoOf(env, id)?.category === 'Stone' : id === kind));
  for (const [kind, amount] of Object.entries(cost)) {
    const have = pick(kind).reduce((n, id) => n + (S[id] ?? 0), 0);
    if (have < amount) return false;
  }
  for (const [kind, amount] of Object.entries(cost)) {
    let left = amount;
    for (const id of pick(kind)) {
      const take = Math.min(S[id], left);
      S[id] -= take;
      left -= take;
      if (left <= 0) break;
    }
  }
  return true;
}
const scale = (c: Record<string, number>, f: number) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v * f]));

/** The points of the grid on the way between two places, from a to b (land only). */
export function pathCells(env: Env, ax: number, ay: number, bx: number, by: number, cellAt: (x: number, y: number) => number): number[] {
  let dx = bx - ax;
  if (env.wrapKm && Math.abs(dx) > env.wrapKm / 2) dx -= Math.sign(dx) * env.wrapKm;
  const dy = by - ay;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (env.step * 0.5)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = cellAt(ax + (dx * i) / n, ay + (dy * i) / n);
    if (k >= 0 && env.land[k] && out[out.length - 1] !== k) out.push(k);
  }
  return out;
}

/** How much faster than open country travel is along a path (the average over its points). */
export function pathSpeed(sim: SimState, cells: number[]): number {
  if (!cells.length) return 1;
  // Time adds up per point: the harmonic mean.
  let t = 0;
  for (const k of cells) t += 1 / WAYS[sim.way[k]].speed;
  return cells.length / t;
}
/** Is the whole path railway (a train can run)? */
export const allRail = (sim: SimState, cells: number[]) => cells.length > 0 && cells.every((k) => sim.way[k] >= 4);

export interface WaysContext {
  sim: SimState;
  env: Env;
  lib: Library;
  cellAt: (x: number, y: number) => number;
  log: (text: string, x?: number, y?: number) => void;
}

/** Each year: trails form and fade with use; keepers pay upkeep or their ways fall back; busy routes are improved. */
export function waysYear(c: WaysContext): void {
  const { sim, env, lib } = c;
  // Trails from use.
  for (let k = 0; k < env.n; k++) {
    if (!env.land[k]) continue;
    if (sim.way[k] === 0 && sim.traffic[k] >= TRAIL_FORMS) sim.way[k] = 1;
    else if (sim.way[k] === 1 && sim.traffic[k] < TRAIL_FADES) sim.way[k] = 0;
  }
  // Upkeep, by keeper.
  const owed = new Map<number, { cost: Record<string, number>; cells: number[] }>();
  for (let k = 0; k < env.n; k++) {
    const t = sim.way[k];
    if (t < 2) continue;
    const keeper = sim.wayKeeper[k];
    const o = owed.get(keeper) ?? { cost: {}, cells: [] };
    const st = sim.settlements.find((q) => q.id === keeper);
    const tech = st ? bestWay(lib, st).tech : '';
    for (const [kind, v] of Object.entries(buildCost(t, tech))) o.cost[kind] = (o.cost[kind] ?? 0) + v * env.step * WAYS[t].upkeep;
    o.cells.push(k);
    owed.set(keeper, o);
  }
  for (const [keeper, o] of owed) {
    const st = sim.settlements.find((q) => q.id === keeper && !q.ruined);
    if (st && pay(env, st, o.cost)) continue;
    // Unkept: every way it kept falls back a tier (to a trail if still walked).
    for (const k of o.cells) {
      sim.way[k] = Math.max(sim.traffic[k] >= TRAIL_FADES ? 1 : 0, sim.way[k] - 1);
      if (sim.way[k] < 2) sim.wayKeeper[k] = -1;
    }
    if (st) c.log(`The ways ${st.name} keeps are falling into disrepair: it lacks the ${Object.keys(o.cost).join(', ')} to keep them up.`, st.x, st.y);
  }
  // Builders keep back next year's materials: a year's building on each busy route, and upkeep.
  for (const st of sim.settlements) {
    if (!st.economy) continue;
    const best = bestWay(lib, st);
    const reserve: Record<string, number> = {};
    const add = (cost: Record<string, number>, f: number) => {
      for (const [kind, v] of Object.entries(cost)) reserve[kind] = (reserve[kind] ?? 0) + v * f;
    };
    if (best.tier >= 2 && sim.routes.some((r) => r.a === st.id || r.b === st.id)) add(buildCost(best.tier, best.tech), env.step * BUILD_PER_YEAR);
    const mine = owed.get(st.id);
    if (mine) add(mine.cost, 1);
    st.economy.reserve = reserve;
  }
  // Busy routes are improved by whichever end can.
  for (const r of sim.routes) {
    const yearTrips = r.trips - (r.mark ?? 0);
    r.mark = r.trips;
    if (yearTrips < 2) continue;
    const a = sim.settlements.find((q) => q.id === r.a && !q.ruined);
    const b = sim.settlements.find((q) => q.id === r.b && !q.ruined);
    if (!a || !b) continue;
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const best = bestWay(lib, from);
      if (best.tier < 2) continue;
      const cells = pathCells(env, from.x, from.y, to.x, to.y, c.cellAt);
      let built = 0;
      for (const k of cells) {
        if (built >= BUILD_PER_YEAR) break;
        if (sim.way[k] >= best.tier) continue;
        if (!pay(env, from, scale(buildCost(best.tier, best.tech), env.step))) break;
        const first = !cells.some((q) => sim.way[q] >= best.tier);
        sim.way[k] = best.tier;
        sim.wayKeeper[k] = from.id;
        built++;
        if (first) c.log(`${from.name} began ${best.tier === 4 ? 'a railway' : `a ${WAYS[best.tier].name.toLowerCase()}`} toward ${to.name}.`, from.x, from.y);
      }
      if (built && cells.every((q) => sim.way[q] >= best.tier) && built > 0) c.log(`The ${WAYS[best.tier].name.toLowerCase()} between ${from.name} and ${to.name} is finished.`, to.x, to.y);
    }
  }
}
