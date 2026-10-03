import { BIOMES, Biome } from '../engine/data/biomes';
import { Noise2D } from '../engine/noise';
import { Rng } from '../engine/rng';
import type { MapData } from '../engine/types';
import { DX, DY } from '../engine/worldgen';

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
 * Paint the land as one continuous surface rather than squares: heights are interpolated between
 * tile centres, coasts follow the smooth sea line, biomes meet along ragged natural edges, and the
 * relief is hill-shaded from the north-west. Rivers are drawn as winding lines on top.
 */
export function paintTerrain(map: MapData, canvas: HTMLCanvasElement = document.createElement('canvas'), scale = TERRAIN_SCALE): HTMLCanvasElement {
  const w = map.width;
  const h = map.height;
  const W = w * scale;
  const Hh = h * scale;
  canvas.width = W;
  canvas.height = Hh;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, Hh);
  const d = img.data;
  const elev = sampler(map.elevation, w, h);
  const temp = sampler(map.temperature, w, h);
  const shadeAt = linear(tileShade(map.elevation, w, h), w, h);
  for (let py = 0; py < Hh; py++) {
    const fy = (py + 0.5) / scale - 0.5;
    for (let px = 0; px < W; px++) {
      const fx = (px + 0.5) / scale - 0.5;
      const e = elev(fx, fy);
      const o = (py * W + px) * 4;
      // Biome from the nearest tile after a noisy nudge, so neighbouring biomes interlock.
      const jx = fx + edgeNoise.fbm(fx * 0.35, fy * 0.35, 4) * 1.1;
      const jy = fy + edgeNoise.fbm(fx * 0.35 + 40, fy * 0.35 + 40, 4) * 1.1;
      const tx = clamp(Math.round(jx), 0, w - 1);
      const ty = clamp(Math.round(jy), 0, h - 1);
      const ti = ty * w + tx;
      let r: number;
      let g: number;
      let b: number;
      if (e < 0) {
        const near = clamp(Math.round(fx), 0, w - 1) + clamp(Math.round(fy), 0, h - 1) * w;
        if (map.biome[near] === Biome.Lake) [r, g, b] = BIOMES[Biome.Lake].color;
        else {
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
  ctx.putImageData(img, 0, 0);
  drawRivers(map, ctx, scale);
  return canvas;
}

/** Rivers as lines that wind from tile to tile downhill, thickening as they gather water. */
function drawRivers(map: MapData, ctx: CanvasRenderingContext2D, scale: number): void {
  const w = map.width;
  const h = map.height;
  const { river, elevation } = map;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgb(62, 120, 178)';
  const at = (i: number): [number, number] => {
    const x = i % w;
    const y = (i - x) / w;
    // A small fixed wobble keeps the course from running ruler-straight.
    const jx = edgeNoise.noise(x * 0.7, y * 0.7) * 0.22;
    const jy = edgeNoise.noise(x * 0.7 + 9, y * 0.7 + 9) * 0.22;
    return [(x + 0.5 + jx) * scale, (y + 0.5 + jy) * scale];
  };
  for (let i = 0; i < map.size; i++) {
    if (river[i] <= 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    // Downstream: the neighbour carrying more water than this one with the least, or the sea.
    let next = -1;
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const v = elevation[j] < 0 ? 1e9 : river[j];
      if (v > river[i] && v < best) {
        best = v;
        next = j;
      }
    }
    if (next < 0) continue;
    const width = clamp(Math.sqrt(river[i] / map.riverThreshold) * 0.32, 0.25, 1.1) * scale;
    const [ax, ay] = at(i);
    const [bx, by] = elevation[next] < 0 ? [(next % w + 0.5) * scale, (Math.floor(next / w) + 0.5) * scale] : at(next);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
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
