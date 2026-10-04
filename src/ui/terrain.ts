import { BIOMES, Biome, Relief } from '../engine/data/biomes';
import { Noise2D } from '../engine/noise';
import { Rng } from '../engine/rng';
import type { MapData } from '../engine/types';
import { riverNext, riverPoint, type Point } from '../engine/geometry';
import { erodedHills, gullies } from '../engine/relief';

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

export type MapStyle = 'satellite' | 'parchment';

/** Ground colours as seen from orbit: muted, darker greens and dun browns rather than map-book colours. */
const SATELLITE: Record<string, [number, number, number]> = {
  ice: [236, 240, 244],
  tundra: [132, 128, 108],
  taiga: [44, 64, 48],
  temperateForest: [50, 80, 42],
  grassland: [108, 126, 70],
  steppe: [142, 136, 102],
  desert: [196, 174, 136],
  savanna: [140, 132, 88],
  tropicalForest: [30, 70, 36],
  wetland: [62, 82, 56],
  mountain: [116, 106, 94],
};
const ROCK: [number, number, number] = [112, 102, 92];
const ALPINE: [number, number, number] = [128, 120, 100];
const SNOW: [number, number, number] = [240, 242, 246];
const SHELF: [number, number, number] = [44, 120, 128];
const MIDSEA: [number, number, number] = [22, 70, 106];
const DEEPSEA: [number, number, number] = [10, 34, 66];
const LAKE: [number, number, number] = [40, 86, 106];
const PAPER: [number, number, number] = [236, 223, 190];
const PAPER_SEA: [number, number, number] = [212, 205, 178];
const INK: [number, number, number] = [72, 54, 38];

const reliefNoise = new Noise2D(new Rng(11).fork('relief-detail'));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Light from the north-west, fairly low, as relief maps are lit. */
const LIGHT = (() => {
  const l = [-1, -1, 0.95];
  const n = Math.hypot(l[0], l[1], l[2]);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

/**
 * Paints the land as one continuous surface rather than squares, in either style.
 *
 * Satellite: heights are interpolated between tile centres and given fine, eroded-looking detail
 * (sharp ridges and spurs in the mountains, rolling ground in the hills); coasts are fractal, broken
 * up at every zoom; the ground is coloured by what covers it, blending between biomes, with bare
 * rock on steep slopes and above the tree line and snow where it is cold enough; the relief is lit
 * from the north-west and valleys sit in shadow; the sea runs from turquoise shallows to dark deeps.
 *
 * Parchment: the same land on old paper, with an inked coastline, ripple lines along the shore and
 * soft sepia relief (mountains, hills and forests are drawn as symbols on top by the renderer).
 *
 * It can paint the whole map at a few pixels per tile, or any part of it at screen resolution.
 */
export class TerrainShader {
  private elev: (fx: number, fy: number) => number;
  private temp: (fx: number, fy: number) => number;
  private lakeAt: (fx: number, fy: number) => number;
  private mtnAt: (fx: number, fy: number) => number;
  private hillAt: (fx: number, fy: number) => number;
  private iceAt: (fx: number, fy: number) => number;
  private cavAt: (fx: number, fy: number) => number;
  private colR: (fx: number, fy: number) => number;
  private colG: (fx: number, fy: number) => number;
  private colB: (fx: number, fy: number) => number;
  /** Slope of the land at tile scale (water counts as level ground), blended smoothly between tiles. */
  private slopeX: (fx: number, fy: number) => number;
  private slopeY: (fx: number, fy: number) => number;

  constructor(private map: MapData, private style: MapStyle = 'satellite') {
    const { width: w, height: h, size } = map;
    this.elev = sampler(map.elevation, w, h);
    this.temp = sampler(map.temperature, w, h);
    const lake = new Float32Array(size);
    const mtn = new Float32Array(size);
    const ice = new Float32Array(size);
    const hill = new Float32Array(size);
    const r = new Float32Array(size);
    const g = new Float32Array(size);
    const b = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      lake[i] = map.biome[i] === Biome.Lake ? 1 : 0;
      ice[i] = map.biome[i] === Biome.Ice ? 1 : 0;
      mtn[i] = map.relief[i] === Relief.Mountains ? 1 : 0;
      hill[i] = map.relief[i] === Relief.Hills ? 1 : 0;
      let key = BIOMES[map.biome[i]].key;
      if (BIOMES[map.biome[i]].water) key = 'grassland';
      const c = SATELLITE[key] ?? BIOMES[map.biome[i]].color;
      r[i] = c[0];
      g[i] = c[1];
      b[i] = c[2];
    }
    blurField(mtn, w, h);
    blurField(hill, w, h);
    // Hollows and valleys: lower than the land around them.
    const cav = new Float32Array(size);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || map.elevation[yy * w + xx] < 0) continue;
            sum += map.elevation[yy * w + xx];
            n++;
          }
        }
        // Water (sea and lakes) is not a hollow in the land.
        cav[y * w + x] = map.elevation[y * w + x] < 0 || n === 0 ? 0 : map.elevation[y * w + x] - sum / n;
      }
    }
    const sx = new Float32Array(size);
    const sy = new Float32Array(size);
    // The surface: a lake lies level with its shores, the sea at zero.
    const surface = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const e = map.elevation[i];
      if (e >= 0) surface[i] = e;
      else if (map.biome[i] === Biome.Lake) {
        let sum = 0;
        let n = 0;
        const x = i % w;
        const y = (i - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || map.elevation[yy * w + xx] < 0) continue;
            sum += map.elevation[yy * w + xx];
            n++;
          }
        }
        surface[i] = n ? sum / n : 0;
      }
    }
    const at = (x: number, y: number) => surface[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        sx[y * w + x] = (at(x + 1, y) - at(x - 1, y)) * 0.5;
        sy[y * w + x] = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      }
    }
    this.slopeX = linear(sx, w, h);
    this.slopeY = linear(sy, w, h);
    this.lakeAt = sampler(lake, w, h);
    this.iceAt = sampler(ice, w, h);
    this.mtnAt = linear(mtn, w, h);
    this.hillAt = linear(hill, w, h);
    this.cavAt = linear(cav, w, h);
    this.colR = linear(r, w, h);
    this.colG = linear(g, w, h);
    this.colB = linear(b, w, h);
  }

  /** The sea line, broken up at every scale so coasts look fractal however close you look. */
  private coast(fx: number, fy: number, e: number): number {
    const a = Math.abs(e);
    if (a >= 0.06) return e;
    const n = edgeNoise.fbm(fx * 0.9 + 13, fy * 0.9 - 7, 4) * 0.011 + edgeNoise.noise(fx * 3.7, fy * 3.7) * 0.004 + edgeNoise.noise(fx * 11, fy * 11) * 0.0015;
    return e + n * (1 - a / 0.06);
  }

  /** Height of the ground at a point, with fine relief detail: ridges in the mountains, folds in the hills. */
  /** Gentle relief everywhere: folds in the hills, a little unevenness on the plains. */
  private detail(fx: number, fy: number): number {
    let v = reliefNoise.noise(fx * 0.6, fy * 0.6) * 0.004;
    const hl = this.hillAt(fx, fy);
    if (hl > 0.02) v += hl * 0.03 * erodedHills(reliefNoise, fx * 0.3 - 11, fy * 0.3 + 4, 3);
    return v;
  }

  /**
   * Paint a W×H pixel image of the map region starting at (x0, y0) in map coordinates, each pixel
   * covering sx × sy of the map. The optional mask is opaque over dry land (so realm colours can be
   * clipped to the painted coast).
   */
  paint(img: ImageData, x0: number, y0: number, sx: number, sy: number, mask?: ImageData): void {
    const map = this.map;
    const w = map.width;
    const h = map.height;
    const W = img.width;
    const H = img.height;
    const d = img.data;
    const md = mask?.data;
    const parchment = this.style === 'parchment';
    const eps = clamp(sx * 1.5, 0.03, 0.3);
    // As much gully detail as the pixels can show: finer layers only when zoomed in.
    const GULLY = 0.8;
    const octaves = clamp(Math.floor(Math.log2(0.3 / (sx * GULLY))) + 1, 1, 6);
    for (let py = 0; py < H; py++) {
      // Sampling coordinates put tile centres on whole numbers.
      const fy = y0 + (py + 0.5) * sy - 0.5;
      for (let px = 0; px < W; px++) {
        const fx = x0 + (px + 0.5) * sx - 0.5;
        const o = (py * W + px) * 4;
        if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) {
          d[o + 3] = 0;
          if (md) md[o + 3] = 0;
          continue;
        }
        const e0 = this.elev(fx, fy);
        const e = this.coast(fx, fy, e0);
        // Lakes take their shape from the lake tiles, warped at two scales so the shore wanders.
        const lx = fx + edgeNoise.noise(fx * 0.45 + 17, fy * 0.45) * 0.9 + edgeNoise.noise(fx * 1.6, fy * 1.6 + 5) * 0.15;
        const ly = fy + edgeNoise.noise(fx * 0.45, fy * 0.45 + 17) * 0.9 + edgeNoise.noise(fx * 1.6 + 5, fy * 1.6) * 0.15;
        const lake = this.lakeAt(lx, ly) > 0.5;
        const sea = !lake && e < 0 && (this.lakeAt(fx, fy) <= 0.02 || e < -0.03);
        if (md) {
          md[o] = md[o + 1] = md[o + 2] = 255;
          md[o + 3] = lake || sea ? 0 : e < 0 ? 255 : 255 * clamp(e / 0.004 + 0.75, 0, 1);
        }
        let r: number;
        let g: number;
        let b: number;
        if (lake || sea) {
          const depth = lake ? 0.05 : -e;
          if (parchment) {
            [r, g, b] = PAPER_SEA;
            // Ripple lines following the shore, fading out to sea.
            if (!lake && depth < 0.05) {
              const phase = (depth / 0.011) % 1;
              if (phase < 0.18) {
                const k = 0.55 * (1 - depth / 0.05);
                r += (INK[0] - r) * k * 0.6;
                g += (INK[1] - g) * k * 0.6;
                b += (INK[2] - b) * k * 0.6;
              }
            }
            if (lake) [r, g, b] = [r * 0.94, g * 0.95, b * 0.97];
          } else if (lake) [r, g, b] = LAKE;
          else {
            const k1 = smooth(0.0, 0.1, depth);
            const k2 = smooth(0.1, 0.45, depth);
            r = SHELF[0] + (MIDSEA[0] - SHELF[0]) * k1 + (DEEPSEA[0] - MIDSEA[0]) * k2;
            g = SHELF[1] + (MIDSEA[1] - SHELF[1]) * k1 + (DEEPSEA[1] - MIDSEA[1]) * k2;
            b = SHELF[2] + (MIDSEA[2] - SHELF[2]) * k1 + (DEEPSEA[2] - MIDSEA[2]) * k2;
            const swell = 1 + edgeNoise.fbm(fx * 0.6, fy * 0.6, 3) * 0.06;
            r *= swell;
            g *= swell;
            b *= swell;
            // A thin line of surf and sand where the sea meets the land.
            if (depth < 0.004) {
              const k = 1 - depth / 0.004;
              r += (196 - r) * k * 0.45;
              g += (200 - g) * k * 0.45;
              b += (186 - b) * k * 0.45;
            }
          }
        } else {
          // The land's broad slope (smooth between tiles) plus the slope of the gentle relief.
          const dv = this.detail(fx, fy);
          let hh = Math.max(0.002, e) + dv;
          let gx = this.slopeX(fx, fy) + (this.detail(fx + eps, fy) - dv) / eps;
          let gy = this.slopeY(fx, fy) + (this.detail(fx, fy + eps) - dv) / eps;
          // Gullies cut down the slopes of mountains and hills, branching like veins.
          const rough = this.mtnAt(fx, fy) + this.hillAt(fx, fy) * 0.35;
          if (!parchment && rough > 0.02) {
            const [gv, gdx, gdy] = gullies(fx * GULLY, fy * GULLY, gx, gy, octaves, 28);
            const depth = 0.06 * rough;
            hh += gv * depth;
            gx += gdx * GULLY * depth;
            gy += gdy * GULLY * depth;
          }
          const slope = Math.hypot(gx, gy);
          // Lit from the north-west: brightness against flat ground.
          const Z = 4;
          const nx = -gx * Z;
          const ny = -gy * Z;
          const nl = Math.hypot(nx, ny, 1);
          const lambert = (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / nl;
          const shade = clamp(lambert / LIGHT[2], 0.35, 1.45);
          const ao = clamp(1 + this.cavAt(fx, fy) * 2.2, 0.72, 1.06);
          if (parchment) {
            const paper = 1 + edgeNoise.fbm(fx * 1.5 + 40, fy * 1.5, 3) * 0.04 + edgeNoise.noise(fx * 6, fy * 6) * 0.015;
            const m = this.mtnAt(fx, fy);
            [r, g, b] = PAPER;
            r += (205 - r) * m * 0.35;
            g += (186 - g) * m * 0.35;
            b += (150 - b) * m * 0.35;
            const sh = 1 + (shade - 1) * 0.4;
            r *= paper * sh;
            g *= paper * sh;
            b *= paper * sh * 0.98;
            // The inked coastline, and the shores of lakes.
            const lk = this.lakeAt(lx, ly);
            if ((e >= 0 && e < (slope + 0.004) * sx * 1.4) || (lk > 0.38 && lk <= 0.5)) [r, g, b] = INK;
          } else {
            // Ground cover, blended between neighbouring biomes along a ragged line.
            const jx = fx + edgeNoise.fbm(fx * 0.35, fy * 0.35, 4) * 0.7;
            const jy = fy + edgeNoise.fbm(fx * 0.35 + 40, fy * 0.35 + 40, 4) * 0.7;
            r = this.colR(jx, jy);
            g = this.colG(jx, jy);
            b = this.colB(jx, jy);
            const t = this.temp(fx, fy);
            // Bare rock above the tree line and on steep slopes.
            const alpine = smooth(0.5, 0.68, hh) * (t < 0.6 ? 1 : 0.5);
            r += (ALPINE[0] - r) * alpine;
            g += (ALPINE[1] - g) * alpine;
            b += (ALPINE[2] - b) * alpine;
            const steep = smooth(0.35, 0.95, slope);
            r += (ROCK[0] - r) * steep;
            g += (ROCK[1] - g) * steep;
            b += (ROCK[2] - b) * steep;
            // Snow where it is cold enough, thinner on the steepest faces.
            const tp = t - Math.max(0, hh - Math.max(0, e0)) * 0.4;
            const glacier = smooth(0.3, 0.6, this.iceAt(jx, jy));
            const snow = Math.max(glacier, smooth(0.17, 0.08, tp)) * (1 - 0.55 * smooth(0.7, 1.4, slope));
            r += (SNOW[0] - r) * snow;
            g += (SNOW[1] - g) * snow;
            b += (SNOW[2] - b) * snow;
            // Fine texture so nothing is one flat colour.
            const tex = 1 + edgeNoise.fbm(fx * 2.3, fy * 2.3, 3) * 0.07 + edgeNoise.noise(fx * 9, fy * 9) * 0.03;
            const k = shade * ao * tex;
            r *= k;
            g *= k;
            b *= k;
          }
        }
        d[o] = r > 255 ? 255 : r < 0 ? 0 : r;
        d[o + 1] = g > 255 ? 255 : g < 0 ? 0 : g;
        d[o + 2] = b > 255 ? 255 : b < 0 ? 0 : b;
        d[o + 3] = 255;
      }
    }
  }
}

function blurField(a: Float32Array, w: number, h: number): void {
  const t = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += a[yy * w + xx];
          n++;
        }
      }
      t[y * w + x] = s / n;
    }
  }
  a.set(t);
}

/** Paint the whole map at `scale` pixels per tile, optionally with its rivers. */
export function paintTerrain(map: MapData, canvas: HTMLCanvasElement = document.createElement('canvas'), scale = TERRAIN_SCALE, rivers = true, style: MapStyle = 'satellite'): HTMLCanvasElement {
  canvas.width = map.width * scale;
  canvas.height = map.height * scale;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  new TerrainShader(map, style).paint(img, 0, 0, 1 / scale, 1 / scale);
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
export function drawRiverCurves(ctx: CanvasRenderingContext2D, curves: Float32Array, view: { zoom: number; ox: number; oy: number }, bounds?: { x0: number; y0: number; x1: number; y1: number }, color = 'rgb(46, 92, 128)'): void {
  const z = view.zoom;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
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
