import type { MapData, Settlement } from './types';
import { DX, DY } from './worldgen';

/**
 * Positions on the continuous land. Map coordinates run in tiles, with tile (x, y) covering
 * [x, x+1) × [y, y+1), so its centre is (x + 0.5, y + 0.5). The simulation still keeps its
 * books per tile, but everything that is seen — settlements, rivers, roads, travellers — sits
 * at a real point on the land.
 */
export type Point = [number, number];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** A fixed pseudo-random number in [0, 1) for a tile (and a salt), the same every run. */
export function hash01(i: number, salt = 0): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * A field (height, temperature …) between tile centres, blended with smoothstep weights so the
 * tile grid doesn't show. (fx, fy) are map coordinates.
 */
export function sampleField(field: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const x = clamp(fx - 0.5, 0, w - 1);
  const y = clamp(fy - 0.5, 0, h - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = field[y0 * w + x0] * (1 - sx) + field[y0 * w + x1] * sx;
  const b = field[y1 * w + x0] * (1 - sx) + field[y1 * w + x1] * sx;
  return a * (1 - sy) + b * sy;
}

/** A natural-looking point near a tile's centre: where a path or river passes through it. */
export function tilePoint(map: MapData, i: number): Point {
  const x = i % map.width;
  const y = (i - x) / map.width;
  return [x + 0.5 + (hash01(i, 1) - 0.5) * 0.44, y + 0.5 + (hash01(i, 2) - 0.5) * 0.44];
}

/** The tile a river flows on to: its neighbour carrying more water with the least, or the sea. -1 at a dead end. */
export function riverNext(map: MapData, i: number): number {
  const w = map.width;
  const x = i % w;
  const y = (i - x) / w;
  let next = -1;
  let best = Infinity;
  for (let k = 0; k < 8; k++) {
    const nx = x + DX[k];
    const ny = y + DY[k];
    if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
    const j = ny * w + nx;
    const v = map.elevation[j] < 0 ? 1e9 : map.river[j];
    if (v > map.river[i] && v < best) {
      best = v;
      next = j;
    }
  }
  return next;
}

/** Where a river course runs through a tile (its mouth sits on the open water's tile centre). */
export function riverPoint(map: MapData, i: number): Point {
  if (map.elevation[i] < 0) {
    const x = i % map.width;
    return [x + 0.5, (i - x) / map.width + 0.5];
  }
  return tilePoint(map, i);
}

function segDist(px: number, py: number, a: Point, b: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  const t = len > 0 ? clamp(((px - a[0]) * vx + (py - a[1]) * vy) / len, 0, 1) : 0;
  return Math.hypot(px - a[0] - vx * t, py - a[1] - vy * t);
}

/**
 * Where on its tile a settlement stands. People build on a riverbank (not in the river), on the
 * shore just above the water, and on level ground, so the town sits where the land invites it
 * rather than in the middle of a square.
 */
export function siteOf(map: MapData, tile: number, salt = 0): Point {
  const w = map.width;
  const h = map.height;
  const tx = tile % w;
  const ty = (tile - tx) / w;
  // River courses through this tile and its neighbours.
  const segs: [Point, Point][] = [];
  let water = false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x;
      if (map.elevation[j] < 0) water = true;
      if (map.river[j] > 0) {
        const n = riverNext(map, j);
        if (n >= 0) segs.push([riverPoint(map, j), riverPoint(map, n)]);
      }
    }
  }
  const E = map.elevation;
  let best: Point = [tx + 0.5, ty + 0.5];
  let bestScore = -Infinity;
  for (let a = -4; a <= 4; a++) {
    for (let b = -4; b <= 4; b++) {
      const px = tx + 0.5 + a * 0.1;
      const py = ty + 0.5 + b * 0.1;
      const e = sampleField(E, w, h, px, py);
      // In the water, or so close to it that the broken coast drawn on the map could put it there.
      if (e < 0.014) continue;
      let score = -0.5 * Math.hypot(a, b) * 0.1;
      if (segs.length) {
        let dr = Infinity;
        for (const [p, q] of segs) dr = Math.min(dr, segDist(px, py, p, q));
        if (dr < 0.07) continue; // in the river itself
        score += 1.5 * Math.exp(-(((dr - 0.15) / 0.1) ** 2));
      }
      if (water) score += 1.2 * Math.exp(-(((e - 0.024) / 0.012) ** 2));
      const gx = sampleField(E, w, h, px + 0.1, py) - sampleField(E, w, h, px - 0.1, py);
      const gy = sampleField(E, w, h, px, py + 0.1) - sampleField(E, w, h, px, py - 0.1);
      score -= Math.hypot(gx, gy) * 6;
      score += hash01(tile * 97 + (a + 4) * 9 + (b + 4), salt) * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = [px, py];
      }
    }
  }
  return best;
}

/** The point a path passes through on a tile: the settlement standing there, or a natural spot near the centre. */
export function waypoint(map: MapData, settlements: Settlement[], t: number): Point {
  const o = map.settlementAt[t];
  if (o >= 0) {
    const s = settlements[o];
    if (s) return [s.px, s.py];
  }
  return tilePoint(map, t);
}

/**
 * A point along a path drawn as a smooth curve through its waypoints (each corner rounded into
 * a curve between the midpoints of its two legs). `pos` runs from 0 at the first waypoint to
 * points.length - 1 at the last, so travellers follow exactly the line the map draws.
 */
export function pointAlong(pts: Point[], pos: number): Point {
  const n = pts.length;
  if (n === 0) return [0, 0];
  if (n === 1 || pos <= 0) return pts[0];
  if (pos >= n - 1) return pts[n - 1];
  const k = clamp(Math.floor(pos + 0.5), 0, n - 1);
  const p = pts[k];
  const a: Point = k === 0 ? pts[0] : [(pts[k - 1][0] + p[0]) / 2, (pts[k - 1][1] + p[1]) / 2];
  const b: Point = k === n - 1 ? pts[n - 1] : [(p[0] + pts[k + 1][0]) / 2, (p[1] + pts[k + 1][1]) / 2];
  // The first and last legs are half as long in curve parameter, as the curve starts and ends on a waypoint.
  let t: number;
  if (k === 0) t = pos / 0.5;
  else if (k === n - 1) t = (pos - (k - 0.5)) / 0.5;
  else t = pos - (k - 0.5);
  if (k === 0) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  if (k === n - 1) return [a[0] + (p[0] - a[0]) * t, a[1] + (p[1] - a[1]) * t];
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]];
}
