import type { Env } from './env';
import { PK, provAt, type ProvIndex } from './land';

/**
 * Travel province to province (REDESIGN.md 8.6a, step 3). Roads, caravans and armies go from one
 * province's middle to the next along the links between neighbouring provinces. A step costs its
 * length times how rough the ground is (hills, forest, highlands and mountains dearer; impassable
 * peaks closed), more again where it fords a river. By sea (for those who sail), sea provinces
 * carry the way, quicker than the land.
 *
 * Routes are found with A* (never shorter than the straight line at the sea's pace) and kept, by
 * pair of provinces, for as long as the provinces stay the same.
 */

/** A ford costs this much more than the step over it. */
const FORD_COST = 1;

export interface RoutePlan {
  /** The provinces on the way, first to last. */
  provs: number[];
  /** The way as points (km): from the start, through each province's middle, to the end. */
  pts: number[];
  /** Kilometres of it over land, and by sea. */
  landKm: number;
  seaKm: number;
}

const routeCache = new WeakMap<ProvIndex, Map<string, number[] | null>>();
const fordCache = new WeakMap<ProvIndex, Map<number, boolean>>();

const dxOn = (env: Env, dx: number) => (env.wrapKm && Math.abs(dx) > env.wrapKm / 2 ? dx - Math.sign(dx) * env.wrapKm : dx);
const cellOf = (env: Env, x: number, y: number) => {
  let i = Math.round((x - env.x0) / env.step);
  const j = Math.round((y - env.y0) / env.step);
  if (j < 0 || j >= env.h) return -1;
  if (i < 0 || i >= env.w) {
    if (!env.wrapKm) return -1;
    i = ((i % env.w) + env.w) % env.w;
  }
  return j * env.w + i;
};

/** Does the straight way between two provinces' middles come onto a river (a ford)? */
function fords(env: Env, p: number, q: number): boolean {
  const P = env.prov;
  let m = fordCache.get(P);
  if (!m) fordCache.set(P, (m = new Map()));
  const key = p < q ? p * P.count + q : q * P.count + p;
  const had = m.get(key);
  if (had !== undefined) return had;
  const dx = dxOn(env, P.x[q] - P.x[p]);
  const dy = P.y[q] - P.y[p];
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (env.step * 0.5)));
  let wet = false;
  let out = false;
  for (let i = 0; i <= n && !out; i++) {
    const k = cellOf(env, P.x[p] + (dx * i) / n, P.y[p] + (dy * i) / n);
    const f = k >= 0 && !!env.fresh[k] && !!env.land[k];
    if (f && !wet && i > 0) out = true;
    wet = f;
  }
  m.set(key, out);
  return out;
}

/** Can the way go through this province (by sea only when sailing)? */
const passable = (P: ProvIndex, p: number, sea: boolean) => P.kind[p] === PK.land ? Number.isFinite(P.rough[p]) : P.kind[p] === PK.sea ? sea : false;

/** The cheapest chain of provinces from one to another (null if there is none). */
export function provinceRoute(env: Env, from: number, to: number, sea = false): number[] | null {
  const P = env.prov;
  if (from < 0 || to < 0) return null;
  if (from === to) return [from];
  let cache = routeCache.get(P);
  if (!cache) routeCache.set(P, (cache = new Map()));
  const key = `${from}:${to}:${sea ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key)!;
  const best = sea ? 0.7 : 1;
  const h = (p: number) => Math.hypot(dxOn(env, P.x[to] - P.x[p]), P.y[to] - P.y[p]) * best;
  const g = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  const done = new Set<number>();
  // A small binary heap of [f, province].
  const heap: [number, number][] = [[h(from), from]];
  const push = (f: number, p: number) => {
    heap.push([f, p]);
    let i = heap.length - 1;
    while (i > 0) {
      const u = (i - 1) >> 1;
      if (heap[u][0] <= heap[i][0]) break;
      [heap[u], heap[i]] = [heap[i], heap[u]];
      i = u;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const a = 2 * i + 1;
        const b = a + 1;
        let m = i;
        if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
        if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  let found = false;
  let guard = 0;
  while (heap.length && guard++ < 400_000) {
    const [, p] = pop();
    if (done.has(p)) continue;
    if (p === to) {
      found = true;
      break;
    }
    done.add(p);
    const gp = g.get(p)!;
    for (let q = P.nbStart[p]; q < P.nbStart[p + 1]; q++) {
      const m = P.nb[q];
      if (done.has(m) || (m !== to && !passable(P, m, sea))) continue;
      const d = Math.hypot(dxOn(env, P.x[m] - P.x[p]), P.y[m] - P.y[p]);
      const rough = (Math.min(P.rough[p], 50) + Math.min(P.rough[m], 50)) / 2;
      const land = P.kind[p] === PK.land && P.kind[m] === PK.land;
      const cost = gp + d * rough + (land && fords(env, p, m) ? d * FORD_COST : 0);
      if (cost < (g.get(m) ?? Infinity)) {
        g.set(m, cost);
        came.set(m, p);
        push(cost + h(m), m);
      }
    }
  }
  let out: number[] | null = null;
  if (found) {
    out = [to];
    for (let p = to; p !== from; ) {
      p = came.get(p)!;
      out.push(p);
    }
    out.reverse();
  }
  cache.set(key, out);
  return out;
}

/** The way between two places, province to province (straight across when they share a province, or there is no way). */
export function routePlan(env: Env, ax: number, ay: number, bx: number, by: number, sea = false): RoutePlan {
  const P = env.prov;
  const pa = provAt(env, ax, ay);
  const pb = provAt(env, bx, by);
  const provs = provinceRoute(env, pa, pb, sea) ?? [];
  const pts = [ax, ay];
  let landKm = 0;
  let seaKm = 0;
  let px = ax;
  let py = ay;
  const to = (x: number, y: number, wet: boolean) => {
    const nx = px + dxOn(env, x - px);
    const d = Math.hypot(nx - px, y - py);
    if (wet) seaKm += d;
    else landKm += d;
    pts.push(nx, y);
    [px, py] = [nx, y];
  };
  for (let i = 1; i < provs.length - 1; i++) to(P.x[provs[i]], P.y[provs[i]], P.kind[provs[i]] === PK.sea);
  to(bx, by, false);
  return { provs, pts, landKm, seaKm };
}

/** The land points of the grid along a way (in order, each once in a row). */
export function cellsAlong(env: Env, pts: number[]): number[] {
  const out: number[] = [];
  for (let q = 0; q + 3 < pts.length; q += 2) {
    const dx = pts[q + 2] - pts[q];
    const dy = pts[q + 3] - pts[q + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (env.step * 0.5)));
    for (let i = q ? 1 : 0; i <= n; i++) {
      const k = cellOf(env, pts[q] + (dx * i) / n, pts[q + 1] + (dy * i) / n);
      if (k >= 0 && env.land[k] && out[out.length - 1] !== k) out.push(k);
    }
  }
  return out;
}

/** Where to head next toward a place: the next province's middle on the way (by sea if `sea`), or the place itself once in its province (or with no way found). */
export function nextWaypoint(env: Env, x: number, y: number, tx: number, ty: number, sea = false): { x: number; y: number } {
  const P = env.prov;
  if (!P.real) return { x: tx, y: ty };
  const route = provinceRoute(env, provAt(env, x, y), provAt(env, tx, ty), sea);
  if (!route || route.length < 3) return { x: tx, y: ty };
  return { x: P.x[route[1]], y: P.y[route[1]] };
}

/** Ships go this much faster than a caravan on foot. */
export const SHIP_PACE = 2.5;
