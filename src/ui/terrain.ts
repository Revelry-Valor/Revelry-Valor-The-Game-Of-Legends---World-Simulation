import { BIOMES, Biome } from '../engine/data/biomes';
import { Noise2D } from '../engine/noise';
import { Rng } from '../engine/rng';
import type { MapData } from '../engine/types';
import { riverNext, riverPoint, type Point } from '../engine/geometry';

/** Pixels per tile in the painted terrain: enough for smooth coasts and soft biome edges. */
export const TERRAIN_SCALE = 4;

const edgeNoise = new Noise2D(new Rng(7).fork('terrain-edge'));

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Height of the land at a point between tile centres, interpolated smoothly. */
function sampler(field: Float32Array, w: number, h: number) {
  return (fx: number, fy: number): number => {
    const x = clamp(fx, 0, w - 1);
    const y = clamp(fy, 0, h - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    // Smoothstep weights hide the grid better than straight lines between centres.
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = field[y0 * w + x0] * (1 - sx) + field[y0 * w + x1] * sx;
    const b = field[y1 * w + x0] * (1 - sx) + field[y1 * w + x1] * sx;
    return a * (1 - sy) + b * sy;
  };
}

/**
 * Light falling on each tile from the north-west, from the slope across its neighbours. Shading is
 * worked out per tile and then blended between tiles, which keeps the grid from showing in it.
 */
function tileShade(field: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) => Math.max(0, field[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ex = (at(x + 1, y) - at(x - 1, y)) * 0.5;
      const ey = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      out[y * w + x] = clamp(1 - (ex + ey) * 4.2, 0.5, 1.5);
    }
  }
  return out;
}

/** Plain bilinear blend between tile centres. */
function linear(field: Float32Array, w: number, h: number) {
  return (fx: number, fy: number): number => {
    const x = clamp(fx, 0, w - 1);
    const y = clamp(fy, 0, h - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const a = field[y0 * w + x0] * (1 - tx) + field[y0 * w + x1] * tx;
    const b = field[y1 * w + x0] * (1 - tx) + field[y1 * w + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
}

const SEA_SHALLOW: [number, number, number] = [92, 150, 190];
const SEA_DEEP: [number, number, number] = [30, 64, 112];

/**
 * Colours the land as one continuous surface rather than squares: heights are interpolated between
 * tile centres, coasts follow the smooth sea line, biomes meet along ragged natural edges, and the
 * relief is hill-shaded from the north-west. It can paint the whole map at a few pixels per tile,
 * or any small part of it at full screen resolution for close zoom.
 */
export class TerrainShader {
  private elev: (fx: number, fy: number) => number;
  private temp: (fx: number, fy: number) => number;
  private shadeAt: (fx: number, fy: number) => number;
  private lakeAt: (fx: number, fy: number) => number;

  constructor(private map: MapData) {
    const { width: w, height: h } = map;
    // Lakes blend between tiles too, so their shores are as smooth as the sea's.
    const lake = new Float32Array(map.size);
    for (let i = 0; i < map.size; i++) lake[i] = map.biome[i] === Biome.Lake ? 1 : 0;
    this.lakeAt = sampler(lake, w, h);
    this.elev = sampler(map.elevation, w, h);
    this.temp = sampler(map.temperature, w, h);
    this.shadeAt = linear(tileShade(map.elevation, w, h), w, h);
  }

  /**
   * Paint a W×H pixel image of the map region starting at (x0, y0) in map coordinates, each pixel
   * covering sx × sy of the map.
   */
  paint(img: ImageData, x0: number, y0: number, sx: number, sy: number): void {
    const map = this.map;
    const w = map.width;
    const h = map.height;
    const W = img.width;
    const H = img.height;
    const d = img.data;
    const { elev, temp, shadeAt, lakeAt } = this;
    for (let py = 0; py < H; py++) {
      // Sampling coordinates put tile centres on whole numbers.
      const fy = y0 + (py + 0.5) * sy - 0.5;
      for (let px = 0; px < W; px++) {
        const fx = x0 + (px + 0.5) * sx - 0.5;
        const o = (py * W + px) * 4;
        if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) {
          d[o + 3] = 0;
          continue;
        }
        const e = elev(fx, fy);
        // Biome from the nearest tile after a noisy nudge, so neighbouring biomes interlock.
        const jx = fx + edgeNoise.fbm(fx * 0.35, fy * 0.35, 4) * 1.1;
        const jy = fy + edgeNoise.fbm(fx * 0.35 + 40, fy * 0.35 + 40, 4) * 1.1;
        const ti = clamp(Math.round(jy), 0, h - 1) * w + clamp(Math.round(jx), 0, w - 1);
        let r: number;
        let g: number;
        let b: number;
        // Lakes take their shape from the lake tiles, with the same ragged edge as the biomes.
        const lake = lakeAt(fx + (jx - fx) * 0.6, fy + (jy - fy) * 0.6);
        if (lake > 0.5) [r, g, b] = BIOMES[Biome.Lake].color;
        else if (e < 0 && (lakeAt(fx, fy) <= 0.02 || e < -0.03)) {
          const depth = clamp(-e * 2.2, 0, 1);
          r = SEA_SHALLOW[0] + (SEA_DEEP[0] - SEA_SHALLOW[0]) * depth;
          g = SEA_SHALLOW[1] + (SEA_DEEP[1] - SEA_SHALLOW[1]) * depth;
          b = SEA_SHALLOW[2] + (SEA_DEEP[2] - SEA_SHALLOW[2]) * depth;
          // A pale fringe of surf along the shore.
          if (e > -0.025) {
            const k = 1 - -e / 0.025;
            r += (205 - r) * k * 0.5;
            g += (222 - g) * k * 0.5;
            b += (226 - b) * k * 0.5;
          }
        } else {
          let bi = map.biome[ti];
          if (BIOMES[bi].water) bi = Biome.Grassland;
          [r, g, b] = BIOMES[bi].color;
          if (bi === Biome.Mountain) {
            // Grey rock rising to bare stone, snow on the cold heights.
            const t = temp(fx, fy);
            if (t < 0.2 || e > 0.75) {
              const k = clamp(Math.max((0.2 - t) / 0.08, (e - 0.75) / 0.1), 0, 1);
              r += (240 - r) * k;
              g += (242 - g) * k;
              b += (246 - b) * k;
            }
          }
          // Hill-shading, with a faint grain so broad plains aren't flat colour.
          const shade = shadeAt(fx, fy) * (1 + edgeNoise.noise(fx * 1.7, fy * 1.7) * 0.05);
          const lift = 1 + Math.min(0.12, e * 0.15);
          r *= shade * lift;
          g *= shade * lift;
          b *= shade * lift;
        }
        d[o] = r > 255 ? 255 : r;
        d[o + 1] = g > 255 ? 255 : g;
        d[o + 2] = b > 255 ? 255 : b;
        d[o + 3] = 255;
      }
    }
  }
}

/** Paint the whole map at `scale` pixels per tile, optionally with its rivers. */
export function paintTerrain(map: MapData, canvas: HTMLCanvasElement = document.createElement('canvas'), scale = TERRAIN_SCALE, rivers = true): HTMLCanvasElement {
  canvas.width = map.width * scale;
  canvas.height = map.height * scale;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  new TerrainShader(map).paint(img, 0, 0, 1 / scale, 1 / scale);
  ctx.putImageData(img, 0, 0);
  if (rivers) drawRiverCurves(ctx, riverCurves(map), { zoom: scale, ox: 0, oy: 0 });
  return canvas;
}

/**
 * Rivers as smooth winding curves in map coordinates, thickening as they gather water. Each river
 * tile gives one stretch: from the midpoint with the main stream coming in, curving through its
 * point, to the midpoint with the tile it flows on to. A tributary runs on to meet the main
 * stream's curve. Packed as start x, y, control x, y, end x, y, width (in tiles).
 */
export function riverCurves(map: MapData): Float32Array {
  const { river } = map;
  const next = new Int32Array(map.size).fill(-1);
  // The main stream into each tile: the upstream neighbour carrying the most water.
  const main = new Int32Array(map.size).fill(-1);
  let count = 0;
  for (let i = 0; i < map.size; i++) {
    if (river[i] <= 0) continue;
    const n = riverNext(map, i);
    next[i] = n;
    if (n < 0) continue;
    count++;
    if (main[n] < 0 || river[i] > river[main[n]]) main[n] = i;
  }
  const P = (i: number): Point => riverPoint(map, i);
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out = new Float32Array(count * 7);
  let k = 0;
  for (let i = 0; i < map.size; i++) {
    const n = next[i];
    if (n < 0) continue;
    const p = P(i);
    const q = P(n);
    const start = main[i] >= 0 ? mid(P(main[i]), p) : p;
    let end = mid(p, q);
    if (map.elevation[n] < 0) end = q;
    else if (main[n] !== i) {
      const nn = next[n];
      const m0 = mid(P(main[n]), q);
      const m1 = nn >= 0 ? mid(q, P(nn)) : q;
      // The point halfway along the main stream's curve through n.
      end = [0.25 * m0[0] + 0.5 * q[0] + 0.25 * m1[0], 0.25 * m0[1] + 0.5 * q[1] + 0.25 * m1[1]];
    }
    out.set([start[0], start[1], p[0], p[1], end[0], end[1], clamp(Math.sqrt(river[i] / map.riverThreshold) * 0.08, 0.06, 0.28)], k);
    k += 7;
  }
  return out;
}

/** Draw river curves for a view (zoom = screen pixels per tile, ox/oy = map point at the top-left). */
export function drawRiverCurves(ctx: CanvasRenderingContext2D, curves: Float32Array, view: { zoom: number; ox: number; oy: number }, bounds?: { x0: number; y0: number; x1: number; y1: number }): void {
  const z = view.zoom;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgb(62, 120, 178)';
  // Batched by width so a few strokes draw them all.
  const BINS = 6;
  for (let bin = 0; bin < BINS; bin++) {
    const lo = 0.06 + ((0.28 - 0.06) * bin) / BINS;
    const hi = bin === BINS - 1 ? Infinity : 0.06 + ((0.28 - 0.06) * (bin + 1)) / BINS;
    ctx.beginPath();
    let any = false;
    for (let k = 0; k < curves.length; k += 7) {
      const wdt = curves[k + 6];
      if (wdt < lo || wdt >= hi) continue;
      const cxm = curves[k + 2];
      const cym = curves[k + 3];
      if (bounds && (cxm < bounds.x0 - 1 || cym < bounds.y0 - 1 || cxm > bounds.x1 + 1 || cym > bounds.y1 + 1)) continue;
      ctx.moveTo((curves[k] - view.ox) * z, (curves[k + 1] - view.oy) * z);
      ctx.quadraticCurveTo((cxm - view.ox) * z, (cym - view.oy) * z, (curves[k + 4] - view.ox) * z, (curves[k + 5] - view.oy) * z);
      any = true;
    }
    if (!any) continue;
    ctx.lineWidth = Math.max(0.8, ((lo + Math.min(hi, 0.3)) / 2) * z);
    ctx.stroke();
  }
}

/**
 * Quick colouring of bare heights for the editor while a stroke is under way: sea blues, then
 * lowland green through upland brown to rock and snow, hill-shaded.
 */
export function paintHeights(heights: Float32Array, w: number, h: number, canvas: HTMLCanvasElement, box?: { x0: number; y0: number; x1: number; y1: number }, scale = TERRAIN_SCALE): void {
  if (canvas.width !== w * scale || canvas.height !== h * scale) {
    canvas.width = w * scale;
    canvas.height = h * scale;
    box = undefined;
  }
  const bx0 = box ? Math.max(0, box.x0 - 1) : 0;
  const by0 = box ? Math.max(0, box.y0 - 1) : 0;
  const bx1 = box ? Math.min(w - 1, box.x1 + 1) : w - 1;
  const by1 = box ? Math.min(h - 1, box.y1 + 1) : h - 1;
  const W = (bx1 - bx0 + 1) * scale;
  const Hh = (by1 - by0 + 1) * scale;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, Hh);
  const d = img.data;
  const elev = sampler(heights, w, h);
  const shadeAt = linear(tileShade(heights, w, h), w, h);
  for (let py = 0; py < Hh; py++) {
    const fy = by0 + (py + 0.5) / scale - 0.5;
    for (let px = 0; px < W; px++) {
      const fx = bx0 + (px + 0.5) / scale - 0.5;
      const e = elev(fx, fy);
      const o = (py * W + px) * 4;
      let r: number;
      let g: number;
      let b: number;
      if (e < 0) {
        const depth = clamp(-e * 2.2, 0, 1);
        r = SEA_SHALLOW[0] + (SEA_DEEP[0] - SEA_SHALLOW[0]) * depth;
        g = SEA_SHALLOW[1] + (SEA_DEEP[1] - SEA_SHALLOW[1]) * depth;
        b = SEA_SHALLOW[2] + (SEA_DEEP[2] - SEA_SHALLOW[2]) * depth;
      } else {
        [r, g, b] = hypsometric(e);
        const shade = shadeAt(fx, fy);
        r *= shade;
        g *= shade;
        b *= shade;
      }
      d[o] = r > 255 ? 255 : r;
      d[o + 1] = g > 255 ? 255 : g;
      d[o + 2] = b > 255 ? 255 : b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, bx0 * scale, by0 * scale);
}

const HYPSO: [number, [number, number, number]][] = [
  [0, [118, 160, 96]],
  [0.15, [150, 170, 104]],
  [0.3, [176, 160, 110]],
  [0.5, [150, 124, 96]],
  [0.7, [140, 132, 128]],
  [0.85, [236, 236, 240]],
];

function hypsometric(e: number): [number, number, number] {
  for (let k = 1; k < HYPSO.length; k++) {
    if (e <= HYPSO[k][0]) {
      const [a, ca] = HYPSO[k - 1];
      const [b, cb] = HYPSO[k];
      const t = (e - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return HYPSO[HYPSO.length - 1][1];
}
