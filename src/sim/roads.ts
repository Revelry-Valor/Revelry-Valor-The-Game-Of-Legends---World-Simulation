import type { Env } from './env';
import type { Route, SimState } from './state';
import { FORD_SLOW, WAYS } from './ways';

/**
 * Roads (REDESIGN.md 8.0, step 4): how traders find their ways, and how the ways become roads.
 *
 * - A trader going somewhere new takes the easiest way across the land, point to point over the
 *   grid: slopes, forest, marsh and fords cost more; peaks and water can't be walked. So routes
 *   follow the terrain, never a straight line.
 * - Worn ways are quicker, and so cheaper: a trader follows the trails and roads that are already
 *   there as far as they help, then breaks off onto a new path. Over time the branches make a
 *   network.
 * - The first few trips between two places try somewhat different ways (each trader judging the
 *   land a little differently); the best found is kept, and from then on everyone goes that way.
 * - Once a year each route's way is checked against the best way now (new roads, bridges): when
 *   one is much better, traffic moves to it, and the old way fades as it goes unused.
 */

/** Trips that try a way of their own before a route's way is settled. */
export const SCOUT_TRIPS = 3;
/** A new way must be this much quicker to replace a settled route's way. */
export const BETTER = 0.85;

/** How hard the ground at a point is to cross, per km (Infinity: not at all). */
export function groundCost(env: Env, k: number): number {
  if (k < 0 || !env.land[k]) return Infinity;
  const relief = [1, 1.4, 1.8, 3, Infinity][env.mzone[k]] ?? Infinity;
  const c = env.cover[k];
  // forest, jungle, grassland, tundra, marsh, dunes, badlands, saltflats, glacier, beach, savanna, scrub, taiga, steppe, rockdesert
  const cover = [1.3, 1.5, 1, 1.1, 1.7, 1.4, 1.3, 1, 1.6, 1, 1, 1.1, 1.3, 1, 1.2][c] ?? 1;
  return relief * cover;
}

const dxOn = (env: Env, dx: number) => (env.wrapKm && Math.abs(dx) > env.wrapKm / 2 ? dx - Math.sign(dx) * env.wrapKm : dx);

/** A hash in [0, 1) of a point and a seed (the same each time: no draw on the simulation's dice). */
const hash = (k: number, seed: number) => {
  let x = (k * 374761393 + seed * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** What one step from point a to its neighbour b costs (days-ish: km over speed, rough ground dearer). */
export function stepCost(sim: SimState, env: Env, a: number, b: number, d?: number): number {
  d ??= stepKm(env, a, b);
  const g = (groundCost(env, a) + groundCost(env, b)) / 2;
  if (!Number.isFinite(g)) return Infinity;
  // On a way the ground matters much less: it was cleared and levelled.
  const tier = Math.min(sim.way[a], sim.way[b]);
  const ground = tier >= 2 ? 1 + (g - 1) * 0.3 : tier === 1 ? 1 + (g - 1) * 0.7 : g;
  let c = (d * ground) / WAYS[tier].speed;
  // Coming onto a river without a bridge: a ford.
  if (env.fresh[b] && !env.fresh[a] && !sim.bridge?.[b]) c += (d * (FORD_SLOW - 1)) / 2;
  return c;
}

export interface WayFound {
  cells: number[];
  /** What it costs to go that way now (without any trader's own judgement). */
  cost: number;
}

/**
 * The easiest way from one point to another over the land (A*, eight neighbours). `judge` (0–1)
 * makes each point look up to that much dearer or cheaper, differently for each `seed`: a
 * trader's own reading of the land. Null when there is no way.
 */
export function findWay(sim: SimState, env: Env, from: number, to: number, judge = 0, seed = 0): WayFound | null {
  if (from < 0 || to < 0 || !env.land[from] || !env.land[to]) return null;
  if (from === to) return { cells: [from], cost: 0 };
  const { w, h, n, step } = env;
  const wrap = env.wrapKm > 0;
  let fastest = 1;
  for (let k = 0; k < n; k++) if (sim.way[k] > 0 && WAYS[sim.way[k]].speed > fastest) fastest = WAYS[sim.way[k]].speed;
  const tx = to % w;
  const ty = (to / w) | 0;
  const hOf = (k: number) => {
    let dx = Math.abs((k % w) - tx);
    if (wrap) dx = Math.min(dx, w - dx);
    const dy = Math.abs(((k / w) | 0) - ty);
    return (Math.hypot(dx, dy) * step) / fastest;
  };
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  g[from] = 0;
  // A binary heap of points by f.
  const hk: number[] = [];
  const hf: number[] = [];
  const push = (k: number, f: number) => {
    hk.push(k);
    hf.push(f);
    let i = hk.length - 1;
    while (i > 0) {
      const u = (i - 1) >> 1;
      if (hf[u] <= hf[i]) break;
      [hk[u], hk[i]] = [hk[i], hk[u]];
      [hf[u], hf[i]] = [hf[i], hf[u]];
      i = u;
    }
  };
  const pop = () => {
    const top = hk[0];
    const lk = hk.pop()!;
    const lf = hf.pop()!;
    if (hk.length) {
      hk[0] = lk;
      hf[0] = lf;
      let i = 0;
      for (;;) {
        const a = 2 * i + 1;
        const b = a + 1;
        let m = i;
        if (a < hk.length && hf[a] < hf[m]) m = a;
        if (b < hk.length && hf[b] < hf[m]) m = b;
        if (m === i) break;
        [hk[m], hk[i]] = [hk[i], hk[m]];
        [hf[m], hf[i]] = [hf[i], hf[m]];
        i = m;
      }
    }
    return top;
  };
  push(from, hOf(from));
  const D = Math.SQRT2 * step;
  while (hk.length) {
    const k = pop();
    if (done[k]) continue;
    if (k === to) break;
    done[k] = 1;
    const i = k % w;
    const j = (k / w) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      const nj = j + dj;
      if (nj < 0 || nj >= h) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        let ni = i + di;
        if (ni < 0 || ni >= w) {
          if (!wrap) continue;
          ni = (ni + w) % w;
        }
        const m = nj * w + ni;
        if (done[m] || !env.land[m]) continue;
        let c = stepCost(sim, env, k, m, di && dj ? D : step);
        if (!Number.isFinite(c)) continue;
        if (judge) c *= 1 + judge * (hash(m, seed) * 2 - 1);
        const gm = g[k] + c;
        if (gm < g[m]) {
          g[m] = gm;
          came[m] = k;
          push(m, gm + hOf(m));
        }
      }
    }
  }
  if (came[to] < 0) return null;
  const cells = [to];
  for (let k = to; k !== from; ) {
    k = came[k];
    cells.push(k);
  }
  cells.reverse();
  return { cells, cost: wayCost(sim, env, cells) };
}

/** How far apart two neighbouring points are (km). */
export function stepKm(env: Env, a: number, b: number): number {
  const di = dxOn(env, ((b % env.w) - (a % env.w)) * env.step);
  const dj = (((b / env.w) | 0) - ((a / env.w) | 0)) * env.step;
  return Math.hypot(di, dj);
}

/** What going along a way costs now. */
export function wayCost(sim: SimState, env: Env, cells: number[]): number {
  let c = 0;
  for (let i = 1; i < cells.length; i++) c += stepCost(sim, env, cells[i - 1], cells[i]);
  return c;
}

/** Whether a way is still walkable (nothing on it has become water or impassable). */
export const walkable = (env: Env, cells: number[]) => cells.every((k) => Number.isFinite(groundCost(env, k)));

/**
 * The way a trader takes between two settlements' points (from a to b). On a route still being
 * scouted, the trader tries a way of its own; a better one found becomes the route's way.
 */
export function traderWay(sim: SimState, env: Env, route: Route | undefined, from: number, to: number): number[] | null {
  // A route's way is kept in either direction.
  const orient = (cells: number[]) => (cells[0] === from ? cells : [...cells].reverse());
  let known = route?.path && walkable(env, route.path) ? orient(route.path) : null;
  if (known && (known[0] !== from || known[known.length - 1] !== to)) known = null;
  const tries = route?.scouted ?? 0;
  if (known && tries >= SCOUT_TRIPS) return known;
  const seed = (route ? route.a * 7919 + route.b * 104729 : from * 31 + to * 17) + tries * 977;
  const found = findWay(sim, env, from, to, 0.5, seed);
  if (route) route.scouted = tries + 1;
  if (!found) return known;
  if (known && wayCost(sim, env, known) <= found.cost) return known;
  if (route) route.path = found.cells;
  return found.cells;
}

/**
 * Once a year: each settled route's way against the best way now. Returns the routes whose way
 * changed (traffic moves to the new way; the old one fades as it goes unused).
 */
export function betterWays(sim: SimState, env: Env, cellOfSettlement: (id: number) => number): Route[] {
  const changed: Route[] = [];
  for (const r of sim.routes) {
    if (!r.path || (r.scouted ?? 0) < SCOUT_TRIPS) continue;
    const from = r.path[0];
    const to = r.path[r.path.length - 1];
    if (cellOfSettlement(r.a) < 0 || cellOfSettlement(r.b) < 0) continue;
    const now = walkable(env, r.path) ? wayCost(sim, env, r.path) : Infinity;
    const best = findWay(sim, env, from, to);
    if (!best || best.cost >= now * BETTER) continue;
    r.path = best.cells;
    changed.push(r);
  }
  return changed;
}

/** The points on a straight line between two places (a village path: short and direct). */
export function straightCells(env: Env, ax: number, ay: number, bx: number, by: number, cellAt: (x: number, y: number) => number): number[] {
  const dx = dxOn(env, bx - ax);
  const dy = by - ay;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (env.step * 0.5)));
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = cellAt(ax + (dx * i) / steps, ay + (dy * i) / steps);
    if (k >= 0 && env.land[k] && out[out.length - 1] !== k) out.push(k);
  }
  return out;
}
