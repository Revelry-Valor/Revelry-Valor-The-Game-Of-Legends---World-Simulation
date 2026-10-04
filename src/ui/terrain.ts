import { BIOMES, Biome } from '../engine/data/biomes';
import { Noise2D } from '../engine/noise';
import { Rng } from '../engine/rng';
import type { MapData } from '../engine/types';
import { riverNext, riverPoint, type Point } from '../engine/geometry';
import { stripes } from '../engine/relief';

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

/** Catmull-Rom interpolation between tile centres: smooth, with slopes that run on without a seam. */
function cubic(field: Float32Array, w: number, h: number) {
  const at = (x: number, y: number) => field[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  return (fx: number, fy: number): number => {
    const x = clamp(fx, 0, w - 1);
    const y = clamp(fy, 0, h - 1);
    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const tx = x - x1;
    const ty = y - y1;
    const row = (yy: number) => cr(at(x1 - 1, yy), at(x1, yy), at(x1 + 1, yy), at(x1 + 2, yy), tx);
    return cr(row(y1 - 1), row(y1), row(y1 + 1), row(y1 + 2), ty);
  };
}

const SEA_SHALLOW: [number, number, number] = [92, 150, 190];
const SEA_DEEP: [number, number, number] = [30, 64, 112];

export type MapStyle = 'drawn' | 'parchment' | 'satellite';

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
/** The drawn map: watercolour washes on cream paper. */
const DRAWN: Record<string, [number, number, number]> = {
  ice: [244, 246, 248],
  tundra: [200, 198, 178],
  taiga: [122, 146, 112],
  temperateForest: [128, 158, 102],
  grassland: [186, 202, 136],
  steppe: [212, 202, 152],
  desert: [232, 212, 166],
  savanna: [206, 194, 132],
  tropicalForest: [104, 148, 92],
  wetland: [150, 170, 128],
  mountain: [186, 170, 142],
};
const DRAWN_PAPER: [number, number, number] = [244, 236, 214];
const DRAWN_HIGH: [number, number, number] = [176, 156, 124];
const DRAWN_SEA: [number, number, number] = [170, 202, 214];
const DRAWN_DEEP: [number, number, number] = [140, 180, 202];
const DRAWN_INK: [number, number, number] = [62, 58, 60];
const DRAWN_SHADOW: [number, number, number] = [100, 90, 84];
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
  private iceAt: (fx: number, fy: number) => number;
  /** Open sea (not lakes or low ground inland), for where the coastline is inked. */
  private oceanAt: (fx: number, fy: number) => number;
  private forestAt: (fx: number, fy: number) => number;
  private cavAt: (fx: number, fy: number) => number;
  private colR: (fx: number, fy: number) => number;
  private colG: (fx: number, fy: number) => number;
  private colB: (fx: number, fy: number) => number;
  /** Slope of the land at tile scale (water counts as level ground), with no kinks between tiles. */
  private slopeX: (fx: number, fy: number) => number;
  private slopeY: (fx: number, fy: number) => number;
  /** The surface, smoothly interpolated with continuous slopes (no grid in the shading). */
  private surfAt: (fx: number, fy: number) => number;
  /** The lowest and highest ground around each point, and how much relief there is (0 flat .. 1 mountains). */
  private footAt: (fx: number, fy: number) => number;
  private topAt: (fx: number, fy: number) => number;
  private reliefAt: (fx: number, fy: number) => number;
  /** Ground colours of the drawn map. */
  private paperR: (fx: number, fy: number) => number;
  private paperG: (fx: number, fy: number) => number;
  private paperB: (fx: number, fy: number) => number;

  constructor(private map: MapData, private style: MapStyle = 'drawn') {
    const { width: w, height: h, size } = map;
    this.elev = sampler(map.elevation, w, h);
    this.temp = sampler(map.temperature, w, h);
    const lake = new Float32Array(size);
    const ocean = new Float32Array(size);
    const ice = new Float32Array(size);
    const forest = new Float32Array(size);
    const r = new Float32Array(size);
    const g = new Float32Array(size);
    const b = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      lake[i] = map.biome[i] === Biome.Lake ? 1 : 0;
      ocean[i] = map.elevation[i] < 0 && map.biome[i] !== Biome.Lake ? 1 : 0;
      ice[i] = map.biome[i] === Biome.Ice ? 1 : 0;
      forest[i] = map.biome[i] === Biome.TemperateForest || map.biome[i] === Biome.Taiga || map.biome[i] === Biome.TropicalForest ? 1 : 0;
      let key = BIOMES[map.biome[i]].key;
      if (BIOMES[map.biome[i]].water) key = 'grassland';
      const c = SATELLITE[key] ?? BIOMES[map.biome[i]].color;
      r[i] = c[0];
      g[i] = c[1];
      b[i] = c[2];
    }
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
    this.slopeX = cubic(sx, w, h);
    this.slopeY = cubic(sy, w, h);
    // The lowest and highest ground within a few tiles: the foot and the crest of any range.
    const foot = new Float32Array(size);
    const top = new Float32Array(size);
    const rel = new Float32Array(size);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            if (dx * dx + dy * dy > 17) continue;
            const v = at(x + dx, y + dy);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        const i = y * w + x;
        foot[i] = lo;
        top[i] = hi;
        rel[i] = clamp((hi - lo - 0.06) / 0.18, 0, 1);
      }
    }
    // Smoothed only a little: the crest height must not sink below the crest, or the top flattens.
    blurField(foot, w, h);
    blurField(rel, w, h);
    this.footAt = linear(foot, w, h);
    this.topAt = linear(top, w, h);
    this.reliefAt = linear(rel, w, h);
    this.surfAt = cubic(surface, w, h);
    const pr = new Float32Array(size);
    const pg = new Float32Array(size);
    const pb = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      let key = BIOMES[map.biome[i]].key;
      if (BIOMES[map.biome[i]].water) key = 'grassland';
      const c = DRAWN[key] ?? BIOMES[map.biome[i]].color;
      pr[i] = c[0];
      pg[i] = c[1];
      pb[i] = c[2];
    }
    this.paperR = linear(pr, w, h);
    this.paperG = linear(pg, w, h);
    this.paperB = linear(pb, w, h);
    this.lakeAt = sampler(lake, w, h);
    this.oceanAt = linear(ocean, w, h);
    this.iceAt = linear(ice, w, h);
    this.forestAt = sampler(forest, w, h);
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

  /**
   * The drawn shape of the land where it rises into hills and mountains, as a cartographer draws a
   * range: one sharp crest along the spine (the rounded top of the land is turned into a knife edge),
   * with spurs running down both flanks to the valley floor, and smaller spurs branching off those
   * low down. Wide ranges get long spurs, narrow ones short; flat-topped land (plateaus) stays flat.
   */
  private ranges(fx: number, fy: number, fine: boolean): number {
    const S = this.surfAt(fx, fy);
    const rw = this.reliefAt(fx, fy);
    const foot = Math.min(S, this.footAt(fx, fy));
    const span = Math.max(S + 0.002, this.topAt(fx, fy)) - foot;
    if (rw <= 0.01 || span < 0.02) return S;
    const hn = clamp((S - foot) / span, 0, 1);
    // Smooth slopes here: any kink in them between tiles would show as a grid in the shading.
    const gx = this.slopeX(fx, fy);
    const gy = this.slopeY(fx, fy);
    const gl = Math.hypot(gx, gy);
    // A knife-edge crest. The slope falls to nothing along the spine, so taking away a share of it
    // leaves the spine standing and pulls the shoulders down: the rounded top becomes a sharp ridge.
    // Only high on the range, so valley floors stay rounded.
    let v = S - 1.3 * rw * smooth(0.35, 0.8, hn) * gl;
    // Spurs: a few long ridges running straight down each flank from the crest to the floor, with
    // V-shaped valleys between. Only on real ranges, not on every bump.
    const sp = smooth(0.4, 0.8, rw);
    if (sp <= 0) return v;
    if (gl > 1e-5) {
      const dx = gy / gl;
      const dy = -gx / gl;
      // Strong on the flanks, fading out at the crest (so it stays one clean line) and at the foot.
      const flank = smooth(0.0, 0.25, hn) * smooth(0.97, 0.75, hn);
      // Straight-sided spurs: the stripes turned into a sawtooth of sharp ridges and V-shaped valleys.
      const ridge = (t: number) => 1 - Math.acos(clamp(t * 0.97, -1, 1)) / Math.PI;
      // Faded out where the ground levels off (peaks, saddles), where the spurs have no way to run.
      const depth = sp * span * 0.22 * flank * smooth(0.004, 0.03, gl);
      v -= depth * (1 - ridge(stripes(fx * 0.42, fy * 0.42, dx * 0.85, dy * 0.85)));
      // Smaller spurs branching off low down, only when close in.
      if (fine) v -= depth * 0.25 * smooth(0.6, 0.2, hn) * (1 - ridge(stripes(fx * 1.1 + 7, fy * 1.1 - 3, dx * 0.9, dy * 0.9)));
    }
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
    const drawn = this.style === 'drawn';
    const eps = clamp(sx * 1.5, 0.03, 0.3);
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
          if (drawn) {
            const k = smooth(0.0, 0.1, depth);
            r = DRAWN_SEA[0] + (DRAWN_DEEP[0] - DRAWN_SEA[0]) * k;
            g = DRAWN_SEA[1] + (DRAWN_DEEP[1] - DRAWN_SEA[1]) * k;
            b = DRAWN_SEA[2] + (DRAWN_DEEP[2] - DRAWN_SEA[2]) * k;
            // Ripple lines following the shore, fading out to sea.
            if (!lake && depth < 0.05 && (depth / 0.011) % 1 < 0.18) {
              const q = 0.35 * (1 - depth / 0.05);
              r += (90 - r) * q;
              g += (128 - g) * q;
              b += (150 - b) * q;
            }
            const paper = 1 + edgeNoise.noise(fx * 7, fy * 7) * 0.012;
            r *= paper;
            g *= paper;
            b *= paper;
          } else if (parchment) {
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
          // Plains: the land's broad slope, smooth between tiles, with a little unevenness.
          const nv = reliefNoise.noise(fx * 0.6, fy * 0.6) * 0.004;
          let hh = Math.max(0.002, e) + nv;
          let gx = this.slopeX(fx, fy) + (reliefNoise.noise((fx + eps) * 0.6, fy * 0.6) * 0.004 - nv) / eps;
          let gy = this.slopeY(fx, fy) + (reliefNoise.noise(fx * 0.6, (fy + eps) * 0.6) * 0.004 - nv) / eps;
          // Hills and mountains: crests and spurs, shaded from their own shape.
          const rw = this.reliefAt(fx, fy);
          if (rw > 0.01) {
            const pe = clamp(sx * 0.9, 0.02, 0.25);
            const fine = sx < 0.2;
            const r0 = this.ranges(fx, fy, fine);
            const rgx = (this.ranges(fx + pe, fy, fine) - r0) / pe;
            const rgy = (this.ranges(fx, fy + pe, fine) - r0) / pe;
            const k = smooth(0.01, 0.12, rw);
            gx += (rgx - gx) * k;
            gy += (rgy - gy) * k;
            hh += (Math.max(0.002, r0) - hh) * k;
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
          if (drawn) {
            // Watercolour washes on cream paper, browning with height, crisp relief shading.
            const paper = 1 + edgeNoise.fbm(fx * 1.5 + 40, fy * 1.5, 3) * 0.035 + edgeNoise.noise(fx * 7, fy * 7) * 0.015;
            const jx = fx + edgeNoise.fbm(fx * 0.35, fy * 0.35, 4) * 0.7;
            const jy = fy + edgeNoise.fbm(fx * 0.35 + 40, fy * 0.35 + 40, 4) * 0.7;
            const wash = 0.75;
            r = DRAWN_PAPER[0] + (this.paperR(jx, jy) - DRAWN_PAPER[0]) * wash;
            g = DRAWN_PAPER[1] + (this.paperG(jx, jy) - DRAWN_PAPER[1]) * wash;
            b = DRAWN_PAPER[2] + (this.paperB(jx, jy) - DRAWN_PAPER[2]) * wash;
            const high = smooth(0.3, 0.75, hh);
            r += (DRAWN_HIGH[0] - r) * high;
            g += (DRAWN_HIGH[1] - g) * high;
            b += (DRAWN_HIGH[2] - b) * high;
            const t = this.temp(fx, fy);
            const snow = Math.max(smooth(0.3, 0.6, this.iceAt(jx, jy)), smooth(0.17, 0.08, t - Math.max(0, hh - Math.max(0, e0)) * 0.4));
            r += (250 - r) * snow;
            g += (250 - g) * snow;
            b += (250 - b) * snow;
            // Shaded as drawn: the sunlit side stays near the paper, the shadow side is laid on in a
            // warm grey-brown wash, so the crest reads as the sharp line where the two meet.
            const dark = clamp((1 - shade) * 1.2, 0, 0.66);
            const lit = clamp(shade - 1, 0, 0.4) * 0.3;
            r += (DRAWN_SHADOW[0] - r) * dark + (255 - r) * lit;
            g += (DRAWN_SHADOW[1] - g) * dark + (255 - g) * lit;
            b += (DRAWN_SHADOW[2] - b) * dark + (255 - b) * lit;
            r *= paper;
            g *= paper;
            b *= paper;
            // The inked coastline, and the shores of lakes.
            const lk = this.lakeAt(lx, ly);
            if ((e >= 0 && e < (slope + 0.004) * sx * 1.4 && this.oceanAt(fx, fy) > 0.02) || (lk > 0.38 && lk <= 0.5)) [r, g, b] = DRAWN_INK;
          } else if (parchment) {
            const paper = 1 + edgeNoise.fbm(fx * 1.5 + 40, fy * 1.5, 3) * 0.04 + edgeNoise.noise(fx * 6, fy * 6) * 0.015;
            const m = this.reliefAt(fx, fy);
            [r, g, b] = PAPER;
            r += (205 - r) * m * 0.35;
            g += (186 - g) * m * 0.35;
            b += (150 - b) * m * 0.35;
            const sh = 1 + (shade - 1) * 0.9;
            r *= paper * sh;
            g *= paper * sh;
            b *= paper * sh * 0.98;
            // Forests hatched in fine diagonal ink lines, as old maps mark woodland.
            const jx = fx + edgeNoise.fbm(fx * 0.35, fy * 0.35, 4) * 0.7;
            const jy = fy + edgeNoise.fbm(fx * 0.35 + 40, fy * 0.35 + 40, 4) * 0.7;
            if (this.forestAt(jx, jy) > 0.5 && (px + py) % 5 === 0) {
              r += (INK[0] - r) * 0.45;
              g += (INK[1] - g) * 0.45;
              b += (INK[2] - b) * 0.45;
            }
            // The inked coastline, and the shores of lakes.
            const lk = this.lakeAt(lx, ly);
            if ((e >= 0 && e < (slope + 0.004) * sx * 1.4 && this.oceanAt(fx, fy) > 0.02) || (lk > 0.38 && lk <= 0.5)) [r, g, b] = INK;
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
export function paintTerrain(map: MapData, canvas: HTMLCanvasElement = document.createElement('canvas'), scale = TERRAIN_SCALE, rivers = true, style: MapStyle = 'drawn'): HTMLCanvasElement {
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
