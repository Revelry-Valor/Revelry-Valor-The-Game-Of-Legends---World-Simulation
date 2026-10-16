import { noise2, strokeSeed } from './noise';
import type { Stroke, Surface } from './paint';
import { evaluate, type Fields, type Grid } from './terrain';

/**
 * Rivers (REDESIGN.md, 6.8). A river is a stroke whose path is its course, from source to mouth.
 * In point mode the course is found through the painted land: it winds through low ground and
 * valleys, goes around mountains, hills and plateaus, follows canyons, and meanders where the
 * land is flat. Rivers grow downstream, and one that flows into another makes it bigger from
 * there on. Where a course runs over a cliff or plateau rim it becomes a waterfall.
 */

interface Options {
  seed: number;
  wrapKm: number;
}

// ---------------------------------------------------------------------------------------------
// How big rivers are.

/** River length (km) that adds as much water as a source of flow 1. */
const KM_PER_FLOW = 400;

/** Width of a river (km) carrying this much water. */
export const widthForFlow = (flow: number) => 0.06 + 0.45 * Math.sqrt(Math.max(0, flow));

export interface RiverInfo {
  stroke: Stroke;
  /** Distance along the course at each path point. */
  cum: Float64Array;
  total: number;
  /** Rivers flowing into this one: where (km along) and how much water they bring. */
  tributaries: { at: number; flow: number }[];
}

const networks = new WeakMap<Stroke[], Map<number, RiverInfo>>();

/** All rivers, with how much water each carries along its course. */
export function riverNetwork(surface: Surface): Map<number, RiverInfo> {
  const hit = networks.get(surface.strokes);
  if (hit) return hit;
  const map = new Map<number, RiverInfo>();
  for (const s of surface.strokes) {
    if (s.brush !== 'river' || s.erase || s.pts.length < 2) continue;
    const n = s.pts.length / 2;
    const cum = new Float64Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(s.pts[2 * k] - s.pts[2 * k - 2], s.pts[2 * k + 1] - s.pts[2 * k - 1]);
    map.set(s.id, { stroke: s, cum, total: cum[n - 1], tributaries: [] });
  }
  // Water at each river's mouth, worked out upstream first (and safe against loops).
  const endFlow = new Map<number, number>();
  const visiting = new Set<number>();
  const flowAtEnd = (id: number): number => {
    const known = endFlow.get(id);
    if (known !== undefined) return known;
    const r = map.get(id)!;
    if (visiting.has(id)) return r.stroke.strength;
    visiting.add(id);
    let f = r.stroke.strength + r.total / KM_PER_FLOW;
    for (const other of map.values()) if (other.stroke.joins?.id === id) f += flowAtEnd(other.stroke.id);
    visiting.delete(id);
    endFlow.set(id, f);
    return f;
  };
  for (const r of map.values()) {
    const j = r.stroke.joins;
    if (j && map.has(j.id)) map.get(j.id)!.tributaries.push({ at: j.at, flow: flowAtEnd(r.stroke.id) });
  }
  networks.set(surface.strokes, map);
  return map;
}

/** Water carried at a distance along a river. */
export function flowAt(r: RiverInfo, t: number): number {
  let f = r.stroke.strength + Math.max(0, t) / KM_PER_FLOW;
  for (const tr of r.tributaries) if (tr.at <= t) f += tr.flow;
  return f;
}

/** A point on a river at a distance along it. */
export function pointAt(r: RiverInfo, t: number): [number, number] {
  const p = r.stroke.pts;
  const n = r.cum.length;
  if (t <= 0) return [p[0], p[1]];
  if (t >= r.total) return [p[2 * n - 2], p[2 * n - 1]];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - r.cum[lo]) / Math.max(1e-9, r.cum[hi] - r.cum[lo]);
  return [p[2 * lo] + (p[2 * hi] - p[2 * lo]) * f, p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * f];
}

// ---------------------------------------------------------------------------------------------
// Finding a course.

/** The painted land over a box, sampled coarsely, for finding courses. */
interface LandGrid {
  g: Grid;
  f: Fields;
}

function landGrid(surface: Surface, x0: number, y0: number, x1: number, y1: number, o: Options, maxCells = 280): LandGrid {
  const span = Math.max(x1 - x0, y1 - y0);
  const px = Math.max(span / maxCells, 0.3);
  const g = { x0, y0, px, w: Math.max(2, Math.ceil((x1 - x0) / px) + 1), h: Math.max(2, Math.ceil((y1 - y0) / px) + 1) };
  return { g, f: evaluate(surface, g, { ...o, noRelief: true }) };
}

const cellOf = (lg: LandGrid, x: number, y: number) => {
  const i = Math.max(0, Math.min(lg.g.w - 1, Math.round((x - lg.g.x0) / lg.g.px)));
  const j = Math.max(0, Math.min(lg.g.h - 1, Math.round((y - lg.g.y0) / lg.g.px)));
  return j * lg.g.w + i;
};

const isWater = (f: Fields, k: number) => f.ground[k] < 1.5 || f.water[k] > 0.5;

/** How hard it is for water to run into a cell from a neighbour. */
function stepCost(f: Fields, from: number, to: number): number {
  const m = f.mountain[to];
  const up = Math.max(0, m - f.mountain[from]);
  let c = 1 + 12 * m + 60 * up + 5 * f.hill[to];
  // Never climb onto a plateau; running off one is a waterfall, which is allowed.
  if (f.plateau[to] > f.plateau[from] + 0.2) c += 400;
  c += 6 * f.face[to];
  // Canyons and ravines lead the water along.
  if (f.canyon[to] > 0.4 || f.ravine[to] > 0.4) c *= 0.3;
  if (isWater(f, to)) c = 0.3;
  return c;
}

/** A binary min-heap of cells by priority. */
class MinHeap {
  private pri: number[] = [];
  private val: number[] = [];
  get size(): number {
    return this.val.length;
  }
  push(p: number, v: number): void {
    const { pri, val } = this;
    let i = val.length;
    pri.push(p);
    val.push(v);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      pri[i] = pri[up];
      val[i] = val[up];
      i = up;
    }
    pri[i] = p;
    val[i] = v;
  }
  pop(): number {
    const { pri, val } = this;
    const top = val[0];
    const lp = pri.pop()!;
    const lv = val.pop()!;
    const n = val.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && pri[l + 1] < pri[l] ? l + 1 : l;
        if (pri[c] >= lp) break;
        pri[i] = pri[c];
        val[i] = val[c];
        i = c;
      }
      pri[i] = lp;
      val[i] = lv;
    }
    return top;
  }
}

/** Cheapest course between two cells (A*, eight directions). */
function findCourse(lg: LandGrid, a: number, b: number): number[] {
  const { w, h } = lg.g;
  const n = w * h;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const bx = b % w;
  const by = (b / w) | 0;
  const heur = (k: number) => Math.hypot((k % w) - bx, ((k / w) | 0) - by) * 0.3;
  const heap = new MinHeap();
  const push = (pri: number, k: number) => heap.push(pri, k);
  const pop = () => heap.pop();
  cost[a] = 0;
  push(heur(a), a);
  const D = [-1, 0, 1, 0, 0, -1, 0, 1, -1, -1, 1, -1, -1, 1, 1, 1];
  while (heap.size) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === b) break;
    const x = k % w;
    const y = (k / w) | 0;
    for (let d = 0; d < 16; d += 2) {
      const nx = x + D[d];
      const ny = y + D[d + 1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = ny * w + nx;
      if (done[nk]) continue;
      const c = cost[k] + stepCost(lg.f, k, nk) * (d >= 8 ? Math.SQRT2 : 1);
      if (c < cost[nk]) {
        cost[nk] = c;
        prev[nk] = k;
        push(c + heur(nk), nk);
      }
    }
  }
  const out: number[] = [];
  for (let k = b; k >= 0; k = prev[k]) {
    out.push(k);
    if (k === a) break;
  }
  return out.reverse();
}

/** Round off corners (Chaikin), keeping the two ends. */
function smoothPath(p: number[], rounds: number): number[] {
  let cur = p;
  for (let r = 0; r < rounds; r++) {
    if (cur.length < 6) return cur;
    const out = [cur[0], cur[1]];
    for (let k = 0; k + 3 < cur.length; k += 2) {
      const ax = cur[k];
      const ay = cur[k + 1];
      const bx = cur[k + 2];
      const by = cur[k + 3];
      out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
    }
    out.push(cur[cur.length - 2], cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/** Evenly spaced points along a path. */
function resample(p: number[], step: number): number[] {
  const out = [p[0], p[1]];
  let carry = 0;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k];
    const ay = p[k + 1];
    const dx = p[k + 2] - ax;
    const dy = p[k + 3] - ay;
    const len = Math.hypot(dx, dy);
    let d = step - carry;
    while (d <= len) {
      out.push(ax + (dx * d) / len, ay + (dy * d) / len);
      d += step;
    }
    carry = len - (d - step);
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}

/** Water drops straight down a rock face: replace each crossing with a straight line. */
function straightenFaces(p: number[], lg: LandGrid): number[] {
  const n = p.length / 2;
  // On a face, bridging small gaps between its rock steps.
  const raw = new Uint8Array(n);
  for (let k = 0; k < n; k++) raw[k] = lg.f.face[cellOf(lg, p[2 * k], p[2 * k + 1])] > 0.2 ? 1 : 0;
  const gap = Math.max(2, Math.round((lg.g.px * 2) / Math.max(1e-6, Math.hypot(p[2] - p[0], p[3] - p[1]))));
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (raw[k]) {
      mask[k] = 1;
      continue;
    }
    let before = false;
    let after = false;
    for (let d = 1; d <= gap; d++) {
      if (k - d >= 0 && raw[k - d]) before = true;
      if (k + d < n && raw[k + d]) after = true;
    }
    mask[k] = before && after ? 1 : 0;
  }
  const onFace = (k: number) => mask[k] === 1;
  const out: number[] = [];
  let k = 0;
  while (k < n) {
    if (!onFace(k) || k === 0) {
      out.push(p[2 * k], p[2 * k + 1]);
      k++;
      continue;
    }
    let e = k;
    while (e < n - 1 && onFace(e)) e++;
    // From the last point before the face to the first after it, in a straight line.
    const ax = p[2 * k - 2];
    const ay = p[2 * k - 1];
    const bx = p[2 * e];
    const by = p[2 * e + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (lg.g.px * 0.5)));
    for (let s = 1; s < steps; s++) out.push(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
    k = e;
  }
  return out;
}

/**
 * Natural winding: big bends and small meanders, strongest on flat open ground and weakest in
 * mountains and canyons. The ends stay where they are.
 */
function meander(p: number[], lg: LandGrid, seed: number, scale: number): number[] {
  const out = p.slice();
  const n = p.length / 2;
  let t = 0;
  const total = (() => {
    let l = 0;
    for (let k = 1; k < n; k++) l += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    return l;
  })();
  for (let k = 1; k < n - 1; k++) {
    t += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    const dx = p[2 * k + 2] - p[2 * k - 2];
    const dy = p[2 * k + 3] - p[2 * k - 1];
    const len = Math.hypot(dx, dy) || 1;
    const c = cellOf(lg, p[2 * k], p[2 * k + 1]);
    const f = lg.f;
    const free = (1 - Math.min(1, f.face[c] * 2)) / (1 + 6 * f.mountain[c] + 3 * f.hill[c] + 4 * f.canyon[c]);
    const big = noise2(t / (scale * 12), 0.5, seed) * scale * 2.6;
    const small = noise2(t / (scale * 3), 3.5, seed + 1) * scale * 0.9;
    const ends = Math.min(1, t / (scale * 3), (total - t) / (scale * 3));
    const off = (big + small) * free * ends;
    out[2 * k] = p[2 * k] + (-dy / len) * off;
    out[2 * k + 1] = p[2 * k + 1] + (dx / len) * off;
  }
  return out;
}

export interface Course {
  pts: number[];
  joins?: { id: number; at: number };
  falls: { at: number; to: number }[];
}

/**
 * Turn what was drawn or clicked into a finished course. In point mode the course is found
 * through the land between the clicked points, in their order. Either way the river joins
 * another it ends on, and falls wherever it runs over a cliff or plateau rim.
 */
export function finishCourse(surface: Surface, s: Stroke, o: Options): Course {
  const raw = s.route === 'points' && s.ctrl && s.ctrl.length >= 4 ? s.ctrl : s.pts;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < raw.length; k += 2) {
    x0 = Math.min(x0, raw[k]);
    x1 = Math.max(x1, raw[k]);
    y0 = Math.min(y0, raw[k + 1]);
    y1 = Math.max(y1, raw[k + 1]);
  }
  const margin = Math.max(50, Math.max(x1 - x0, y1 - y0) * 0.5);
  // The land as it is without this river (its own water must not stop it).
  const others: Surface = { ...surface, strokes: surface.strokes.filter((k) => k.id !== s.id) };
  const lg = landGrid(others, x0 - margin, y0 - margin, x1 + margin, y1 + margin, o);
  const seed = strokeSeed(o.seed, s.id);
  let pts: number[];
  if (s.route === 'points' && s.ctrl && s.ctrl.length >= 4) {
    pts = [];
    for (let k = 0; k + 3 < raw.length; k += 2) {
      const cells = findCourse(lg, cellOf(lg, raw[k], raw[k + 1]), cellOf(lg, raw[k + 2], raw[k + 3]));
      const leg = cells.map((c) => [lg.g.x0 + (c % lg.g.w) * lg.g.px, lg.g.y0 + ((c / lg.g.w) | 0) * lg.g.px]).flat();
      leg[0] = raw[k];
      leg[1] = raw[k + 1];
      leg[leg.length - 2] = raw[k + 2];
      leg[leg.length - 1] = raw[k + 3];
      pts.push(...(pts.length ? leg.slice(2) : leg));
    }
    pts = straightenFaces(smoothPath(resample(pts, lg.g.px * 1.5), 3), lg);
    // Lava runs thick and straight; rivers wind.
    if (s.brush === 'river') pts = straightenFaces(meander(resample(pts, Math.max(lg.g.px * 0.6, 0.3)), lg, seed, Math.max(lg.g.px * 2, 3)), lg);
  } else {
    pts = s.pts.slice();
  }
  pts = pts.map((v) => Math.round(v * 100) / 100);
  if (s.brush !== 'river') return { pts, falls: [] };

  // Join a river this one ends on.
  let joins: Course['joins'];
  const ex = pts[pts.length - 2];
  const ey = pts[pts.length - 1];
  let best = Infinity;
  for (const r of riverNetwork(others).values()) {
    const p = r.stroke.pts;
    for (let k = 0; k < p.length / 2; k++) {
      const d = Math.hypot(p[2 * k] - ex, p[2 * k + 1] - ey);
      const reach = widthForFlow(flowAt(r, r.cum[k])) / 2 + Math.max(3, lg.g.px * 3);
      if (d < reach && d < best) {
        best = d;
        joins = { id: r.stroke.id, at: Math.round(r.cum[k] * 100) / 100 };
        pts[pts.length - 2] = Math.round(p[2 * k] * 100) / 100;
        pts[pts.length - 1] = Math.round(p[2 * k + 1] * 100) / 100;
      }
    }
  }

  // Waterfalls: where the course runs over a rock face or drops off a plateau.
  // Only going down counts: off a plateau top, into a canyon or ravine, or over a cliff face.
  // One fall per drop, however many rock steps it has; it lands where the rock face ends.
  const falls: { at: number; to: number }[] = [];
  const f = lg.f;
  const gorge = (c: number) => Math.max(f.canyon[c], f.ravine[c]);
  let t = 0;
  let onTop = f.plateau[cellOf(lg, pts[0], pts[1])] > 0.6;
  let inGorge = gorge(cellOf(lg, pts[0], pts[1])) > 0.6;
  let onFace = false;
  let faceStart = -1;
  let open: { at: number; to: number } | null = null;
  const add = (at: number) => {
    const last = falls[falls.length - 1];
    if (last && at - last.to < Math.max(lg.g.px * 4, 5)) return;
    open = { at: Math.round(at * 100) / 100, to: Math.round(at * 100) / 100 };
    falls.push(open);
  };
  for (let k = 1; k < pts.length / 2; k++) {
    t += Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
    const c = cellOf(lg, pts[2 * k], pts[2 * k + 1]);
    if (isWater(f, c)) break;
    const face = f.face[c] > 0.4;
    if (face && !onFace) faceStart = t;
    onFace = face;
    // The fall being followed lands where the rock face ends.
    if (open) {
      // Still on the way down: on the rock face, its scree, or the lower slope of a plateau.
      const falling = f.face[c] > 0.15 || f.scree[c] > 0.3 || (f.plateau[c] > 0.05 && f.plateau[c] < 0.6);
      if (falling) (open as { to: number }).to = Math.round(t * 100) / 100;
      else open = null;
    }
    if (onTop && f.plateau[c] < 0.2) {
      add(faceStart >= 0 ? faceStart : t);
      onTop = false;
    } else if (f.plateau[c] > 0.6) onTop = true;
    if (!inGorge && gorge(c) > 0.6) {
      add(faceStart >= 0 && t - faceStart < 20 ? faceStart : t);
      inGorge = true;
    } else if (gorge(c) < 0.2) inGorge = false;
    // A cliff (not a plateau rim or gorge wall): it falls where the river crosses the face.
    // (Cliff faces are the ones shaded by which way they look; rims and walls are lit by relief.)
    if (face && Math.abs(f.faceShade[c] - 1) > 1e-6 && !onTop && !open) add(t);
    if (!face) faceStart = -1;
  }
  return { pts, joins, falls };
}

/** Whether a point is on water (sea, lake or river): a point-mode river ends there. */
export function onWater(surface: Surface, x: number, y: number, o: Options): boolean {
  const f = evaluate(surface, { x0: x, y0: y, px: 0.25, w: 1, h: 1 }, { ...o, noRelief: true });
  return isWater(f, 0);
}
