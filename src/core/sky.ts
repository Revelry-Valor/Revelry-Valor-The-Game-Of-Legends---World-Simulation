import type { Stroke, Surface } from './paint';
import { covers, shapeOf } from './underdark';

/**
 * Sky islands (REDESIGN.md, section 5): land floating on three sky layers. Painted with their own
 * brushes into the world's one stroke list, each stroke tagged with its layer. Strokes on a layer
 * that touch make one island. Islands don't block sun, rain or wind for the land below; each layer
 * has its own climate, colder and windier the higher it is. An island can stay fixed, drift with
 * the wind, or drift along a drawn path; a fixed island's waterfalls land on the ground below.
 */

export type SkyLayer = 1 | 2 | 3;
export const SKY_LAYERS: SkyLayer[] = [1, 2, 3];
/** How high each layer floats above sea level (km). */
export const SKY_ALT_KM: Record<SkyLayer, number> = { 1: 1.5, 2: 3, 3: 5 };
/** How much stronger the winds blow up there than at the ground. */
export const SKY_WIND: Record<SkyLayer, number> = { 1: 1.4, 2: 1.9, 3: 2.5 };
/** How much of the rain below falls up there (the air holds less water the higher it is). */
export const SKY_RAIN: Record<SkyLayer, number> = { 1: 1, 2: 0.7, 3: 0.45 };

export type SkyCover = 'meadow' | 'forest' | 'rock' | 'tundra' | 'snow';
export const SKY_COVER_NAMES: Record<SkyCover, string> = { meadow: 'Sky meadow', forest: 'Sky forest', rock: 'Bare rock', tundra: 'Windswept tundra', snow: 'Snow and ice' };

const layerOf = (st: Stroke): SkyLayer => st.sky ?? 1;

export interface SkyIsland {
  /** Its first stroke's id (stays the same as the island grows). */
  id: number;
  layer: SkyLayer;
  /** The strokes that make its ground (not erasers), oldest first. */
  strokes: Stroke[];
  drift: 'fixed' | 'wind' | 'path';
  /** Its drift path (x, y pairs), when it has one. */
  path: number[] | null;
  /** Its middle (km): the average of its strokes' points. */
  x: number;
  y: number;
  box: [number, number, number, number];
}

const touch = (a: Stroke, b: Stroke): boolean => {
  const A = shapeOf(a);
  const B = shapeOf(b);
  if (A.box[2] < B.box[0] || B.box[2] < A.box[0] || A.box[3] < B.box[1] || B.box[3] < A.box[1]) return false;
  for (let i = 0; i < A.dabs.length; i += 3) {
    for (let j = 0; j < B.dabs.length; j += 3) {
      const r = A.dabs[i + 2] + B.dabs[j + 2];
      const dx = A.dabs[i] - B.dabs[j];
      const dy = A.dabs[i + 1] - B.dabs[j + 1];
      if (dx * dx + dy * dy <= r * r) return true;
    }
  }
  return false;
};

const islandCache = new WeakMap<Stroke[], SkyIsland[]>();

/** The islands on every layer. */
export function skyIslands(surface: Surface): SkyIsland[] {
  const hit = islandCache.get(surface.strokes);
  if (hit) return hit;
  const out: SkyIsland[] = [];
  for (const layer of SKY_LAYERS) {
    const adds = surface.strokes.filter((s) => s.brush === 'skyisland' && !s.erase && layerOf(s) === layer && s.pts.length >= 2);
    // Strokes that touch are one island (union–find).
    const parent = adds.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < adds.length; i++) for (let j = 0; j < i; j++) if (find(i) !== find(j) && touch(adds[i], adds[j])) parent[find(i)] = find(j);
    const groups = new Map<number, Stroke[]>();
    adds.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));
    for (const strokes of groups.values()) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const s of strokes) {
        for (let i = 0; i < s.pts.length; i += 2) {
          sx += s.pts[i];
          sy += s.pts[i + 1];
          n++;
        }
        const b = shapeOf(s).box;
        box[0] = Math.min(box[0], b[0]);
        box[1] = Math.min(box[1], b[1]);
        box[2] = Math.max(box[2], b[2]);
        box[3] = Math.max(box[3], b[3]);
      }
      out.push({ id: strokes[0].id, layer, strokes, drift: 'fixed', path: null, x: sx / n, y: sy / n, box });
    }
  }
  // Drift: a path belongs to the island it starts on (the latest path wins).
  for (const p of surface.strokes) {
    if (p.brush !== 'skypath') continue;
    if (p.erase) {
      // Erasing over a path takes it away.
      for (const isl of out) {
        const q = isl.path;
        if (isl.layer !== layerOf(p) || !q) continue;
        const hit = (a: number, b: number) => { for (let i = 0; i < q.length; i += 2) if (Math.hypot(q[i] - a, q[i + 1] - b) <= p.size / 2 + 3) return true; return false; };
        for (let i = 0; i < p.pts.length; i += 2) if (hit(p.pts[i], p.pts[i + 1])) { isl.path = null; break; }
      }
      continue;
    }
    if (p.pts.length < 4) continue;
    const isl = islandAt(surface, layerOf(p), p.pts[0], p.pts[1], out);
    if (isl) isl.path = p.pts;
  }
  for (const isl of out) {
    const set = isl.strokes.find((s) => s.drift)?.drift;
    isl.drift = set ?? (isl.path ? 'path' : 'fixed');
    if (isl.drift === 'path' && !isl.path) isl.drift = 'fixed';
  }
  islandCache.set(surface.strokes, out);
  return out;
}

/** Whether a layer has island ground at a place (painted and not erased since). */
export function skyGround(surface: Surface, layer: SkyLayer, x: number, y: number): boolean {
  let on = false;
  for (const st of surface.strokes) {
    if (st.brush !== 'skyisland' || layerOf(st) !== layer) continue;
    if (covers(shapeOf(st), x, y)) on = !st.erase;
  }
  return on;
}

/** The island at a place on a layer, if there is ground there. */
export function islandAt(surface: Surface, layer: SkyLayer, x: number, y: number, list = skyIslands(surface)): SkyIsland | null {
  if (!skyGround(surface, layer, x, y)) return null;
  for (const isl of list) if (isl.layer === layer && isl.strokes.some((s) => covers(shapeOf(s), x, y))) return isl;
  return null;
}

/** The painted cover at a place on a layer (null: the island's own, from its climate). */
export function skyPaintedCover(surface: Surface, layer: SkyLayer, x: number, y: number): SkyCover | null {
  let c: SkyCover | null = null;
  for (const st of surface.strokes) {
    if ((st.brush !== 'skymeadow' && st.brush !== 'skyforest' && st.brush !== 'skyrock') || layerOf(st) !== layer) continue;
    if (!covers(shapeOf(st), x, y)) continue;
    c = st.erase ? null : st.brush === 'skymeadow' ? 'meadow' : st.brush === 'skyforest' ? 'forest' : 'rock';
  }
  return c;
}

/** An island's ground area (km²), sampled over its box. */
export function islandArea(surface: Surface, isl: SkyIsland): number {
  const [x0, y0, x1, y1] = isl.box;
  const n = 48;
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  let hits = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * dx;
      const y = y0 + (j + 0.5) * dy;
      if (isl.strokes.some((s) => covers(shapeOf(s), x, y)) && skyGround(surface, isl.layer, x, y)) hits++;
    }
  }
  return hits * dx * dy;
}

/** An island waterfall, and whether it lands on the ground below (only from a fixed island). */
export interface SkyFall {
  stroke: Stroke;
  island: SkyIsland | null;
  lands: boolean;
}

const fallCache = new WeakMap<Stroke[], SkyFall[]>();
/** The island waterfalls. A fall sits on its island or just off its edge (within about 10 miles). */
export function skyFalls(surface: Surface): SkyFall[] {
  const hit = fallCache.get(surface.strokes);
  if (hit) return hit;
  const list = skyIslands(surface);
  const out: SkyFall[] = [];
  for (const st of surface.strokes) {
    if (st.brush !== 'skyfall' || st.pts.length < 2) continue;
    const [x, y] = st.pts;
    if (st.erase) {
      for (let i = out.length - 1; i >= 0; i--) if (Math.hypot(out[i].stroke.pts[0] - x, out[i].stroke.pts[1] - y) <= st.size / 2 + 3) out.splice(i, 1);
      continue;
    }
    const layer = layerOf(st);
    let island = islandAt(surface, layer, x, y, list);
    // Placed at the edge: look a little way round for its island (up to about 10 miles).
    for (const r of [3, 8, 16]) for (let a = 0; a < 8 && !island; a++) island = islandAt(surface, layer, x + Math.cos((a * Math.PI) / 4) * r, y + Math.sin((a * Math.PI) / 4) * r, list);
    out.push({ stroke: st, island, lands: !!island && island.drift === 'fixed' });
  }
  fallCache.set(surface.strokes, out);
  return out;
}
