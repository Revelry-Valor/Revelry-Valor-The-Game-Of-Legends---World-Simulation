import { BIOMES, Biome } from '../engine/data/biomes';
import { Noise2D } from '../engine/noise';
import { Rng } from '../engine/rng';
import type { MapData } from '../engine/types';
import { riverNext, riverPoint, type Point } from '../engine/geometry';
import { erodeRelief, type ErosionOptions, type ReliefField } from '../engine/erosion';

/** Pixels per tile in the painted terrain: enough for smooth coasts and soft biome edges. */
export const TERRAIN_SCALE = 6;

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
const SCREE: [number, number, number] = [176, 164, 140];
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
const DRAWN_ROCK: [number, number, number] = [168, 160, 150];
const PAPER_SEA: [number, number, number] = [212, 205, 178];
const INK: [number, number, number] = [72, 54, 38];

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

/** Each map's land is carved once, however many times (and in whatever style) it is painted. */
const carved = new WeakMap<MapData, ReliefField>();

/** The land's surface for carving: a lake lies level with its shores, the sea at zero. */
function landSurface(map: MapData): Float32Array {
  const { width: w, height: h, size } = map;
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
  return surface;
}

/**
 * Carve a map's land into realistic terrain (see erodeRelief), on a grid finer than the tiles kept
 * to a few hundred thousand cells, so even big maps carve in a second or two. With no options the
 * result is kept, so the map is carved once however often it is painted.
 */
export function carveMap(map: MapData, opts?: ErosionOptions): ReliefField {
  const cached = opts ? undefined : (map.carved ?? carved.get(map));
  if (cached) return cached;
  const water = new Uint8Array(map.size);
  for (let i = 0; i < map.size; i++) water[i] = map.elevation[i] < 0 ? 1 : 0;
  const relief = erodeRelief(landSurface(map), water, map.width, map.height, {
    scale: clamp(Math.floor(Math.sqrt(400000 / map.size)), 2, 4),
    seed: map.width * 7919 + map.height,
    ...opts,
  });
  if (!opts) carved.set(map, relief);
  return relief;
}

/**
 * Paints the land as one continuous surface rather than squares, in any of the map styles.
 *
 * Every style is shaded from the same carved land: the tile heights laid out on a finer grid and
 * eroded by running water (see erodeRelief), so ranges stand as sharp crests with spurs and valleys
 * running down from them, lit from the north-west. Coasts are fractal, broken up at every zoom.
 *
 * Drawn map: watercolour washes for each kind of ground on cream paper, browning with height, snow,
 * an inked coastline and blue seas with ripple lines. Parchment: the same land on old paper in sepia,
 * forests hatched. Satellite: ground coloured by what covers it, bare rock and snow up high, and
 * the sea from turquoise shallows to dark deeps.
 *
 * It can paint the whole map at a few pixels per tile, or any part of it at screen resolution.
 */
export class TerrainShader {
  private elev: (fx: number, fy: number) => number;
  private temp: (fx: number, fy: number) => number;
  private lakeAt: (fx: number, fy: number) => number;
  private iceAt: (fx: number, fy: number) => number;
  /** Near the open sea (not lakes or low ground inland), for where the coastline is inked. */
  private oceanAt: (fx: number, fy: number) => number;
  private forestAt: (fx: number, fy: number) => number;
  private cavAt: (fx: number, fy: number) => number;
  private colR: (fx: number, fy: number) => number;
  private colG: (fx: number, fy: number) => number;
  private colB: (fx: number, fy: number) => number;
  /**
   * The land as water has carved it (see erodeRelief), on a grid finer than the tiles and smoothly
   * interpolated: the height every style is shaded from.
   */
  private cells!: Float32Array;
  private cellW = 0;
  private cellH = 0;
  private cellScale = 1;
  /** The carved land at the last point sampled: height, slope (x, y, per tile), wear, deposits, flow. */
  private readonly here = new Float64Array(6);
  /** Signed distance in tiles to a lake's shore (positive on the water), smoothly blended. */
  private lakeSd!: (fx: number, fy: number) => number;
  /** Tiles within reach of a lake, so lake shores are only worked out where there could be one. */
  private nearLake!: Uint8Array;
  /** What the erosion left (0..1): scoured rock, settled soil and scree, and running water. */
  /** How rugged the land is around each point (0 flat .. 1 mountains), for tinting. */
  private ruggedAt: (fx: number, fy: number) => number;
  /** Ground colours of the drawn map. */
  private paperR: (fx: number, fy: number) => number;
  private paperG: (fx: number, fy: number) => number;
  private paperB: (fx: number, fy: number) => number;

  /** `given` paints from land already carved (with other erosion settings) instead of the map's own. */
  constructor(private map: MapData, private style: MapStyle = 'drawn', given?: ReliefField) {
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
    const surface = landSurface(map);
    const at = (x: number, y: number) => surface[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    const relief = given ?? carveMap(map);
    const scale = relief.scale;
    // Everything the painter needs from the carved land, cell by cell and side by side, so a pixel
    // reads it with one blend: height, slope across and down (per tile), wear, deposits and flow.
    const RW = relief.width;
    const RH = relief.height;
    const cells = new Float32Array(RW * RH * 6);
    const H = relief.heights;
    for (let y = 0; y < RH; y++) {
      for (let x = 0; x < RW; x++) {
        const i = y * RW + x;
        const xl = x > 0 ? i - 1 : i;
        const xr = x < RW - 1 ? i + 1 : i;
        const yu = y > 0 ? i - RW : i;
        const yd = y < RH - 1 ? i + RW : i;
        const o = i * 6;
        cells[o] = H[i];
        cells[o + 1] = ((H[xr] - H[xl]) / Math.max(1, xr - xl)) * scale;
        cells[o + 2] = ((H[yd] - H[yu]) / Math.max(1, (yd - yu) / RW)) * scale;
        cells[o + 3] = relief.wear[i];
        cells[o + 4] = relief.deposits[i];
        cells[o + 5] = relief.flow[i];
      }
    }
    this.cells = cells;
    this.cellW = RW;
    this.cellH = RH;
    this.cellScale = scale;
    const near = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (map.biome[i] !== Biome.Lake) continue;
      const lx = i % w;
      const ly = (i - lx) / w;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = lx + dx;
          const yy = ly + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
        }
      }
    }
    this.nearLake = near;
    // Lakes take their outline from how far each tile centre is from the other side of the shore,
    // which blends into smooth shores of an even steepness (a lone lake tile becomes a round pond).
    const sd = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      if (!near[i]) {
        sd[i] = -3;
        continue;
      }
      const wet = map.biome[i] === Biome.Lake;
      const ix = i % w;
      const iy = (i - ix) / w;
      let best = 9;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = ix + dx;
          const yy = iy + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if ((map.biome[yy * w + xx] === Biome.Lake) !== wet) best = Math.min(best, Math.hypot(dx, dy));
        }
      }
      sd[i] = wet ? Math.min(3, best - 0.5) : -Math.min(3, best - 0.5);
    }
    this.lakeSd = linear(sd, w, h);
    const rug = new Float32Array(size);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const v = at(x + dx, y + dy);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        rug[y * w + x] = clamp((hi - lo - 0.04) / 0.2, 0, 1);
      }
    }
    blurField(rug, w, h);
    this.ruggedAt = linear(rug, w, h);
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
    // Reaching a tile inland, since the shore wanders that far from the tiles' own coast.
    const reach = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      if (!ocean[i]) continue;
      const ox = i % w;
      const oy = (i - ox) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = ox + dx;
          const yy = oy + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) reach[yy * w + xx] = 1;
        }
      }
    }
    this.oceanAt = linear(reach, w, h);
    this.iceAt = linear(ice, w, h);
    this.forestAt = sampler(forest, w, h);
    this.cavAt = linear(cav, w, h);
    this.colR = linear(r, w, h);
    this.colG = linear(g, w, h);
    this.colB = linear(b, w, h);
  }

  /**
   * The sea line, made to wander at every scale. The shore is bent sideways (the land is sampled a
   * little off to one side) rather than raised or lowered, so it can twist into coves and points
   * but never throws up specks of land at sea or pocks the land with puddles.
   */
  private coast(fx: number, fy: number, e: number, sx: number): number {
    if (Math.abs(e) >= 0.08) return e;
    // Wiggles smaller than a pixel are left out: drawn, they would only speckle the line.
    const mid = clamp(2 - sx * 12, 0, 1) * 0.05;
    const fine = clamp(2 - sx * 35, 0, 1) * 0.01;
    let wx = edgeNoise.fbm(fx * 0.9 + 13, fy * 0.9 - 7, 2) * 0.35;
    let wy = edgeNoise.fbm(fx * 0.9 - 21, fy * 0.9 + 5, 2) * 0.35;
    if (mid > 0) {
      wx += edgeNoise.noise(fx * 3.7, fy * 3.7) * mid;
      wy += edgeNoise.noise(fx * 3.7 + 9, fy * 3.7 - 4) * mid;
    }
    if (fine > 0) {
      wx += edgeNoise.noise(fx * 11 + 3, fy * 11) * fine;
      wy += edgeNoise.noise(fx * 11, fy * 11 + 7) * fine;
    }
    return this.elev(fx + wx, fy + wy);
  }

  /** How much a point of land is inked as a lake's shore (0..1): a soft line about 1.5 pixels wide. */
  private lakeShoreInk(lsd: number, sx: number): number {
    return lsd <= 0 ? clamp(1 + lsd / (sx * 1.2), 0, 1) : clamp(1 - lsd / (sx * 0.6), 0, 1);
  }

  /**
   * How much a point of land is inked as the sea's shore (0..1): a soft line about 1.5 pixels wide,
   * judged by how fast the coast's height changes there, so the line keeps one width on gentle and
   * steep shores alike. Only the open sea's shores count here (lakes have their own line).
   */
  private shoreInk(fx: number, fy: number, e: number, sx: number): number {
    if (e > 0.03 || e < -0.03 || this.oceanAt(fx, fy) <= 0.02) return 0;
    const d = sx;
    const ex = this.coast(fx + d, fy, this.elev(fx + d, fy), sx) - this.coast(fx - d, fy, this.elev(fx - d, fy), sx);
    const ey = this.coast(fx, fy + d, this.elev(fx, fy + d), sx) - this.coast(fx, fy - d, this.elev(fx, fy - d), sx);
    const perPixel = Math.hypot(ex, ey) / 2;
    if (perPixel <= 0) return 0;
    // Mostly on the land side, a little on the water's, so the line is smooth at any size.
    return e >= 0 ? clamp(1 - e / (perPixel * 1.2), 0, 1) : clamp(1 + e / (perPixel * 0.6), 0, 1);
  }

  /**
   * The erosion maps at a point, eased for colouring: wear counts most on steep ground, deposits on
   * gentle ground, and the flow map is taken in its stronger streams only.
   */
  private erosionAt(slope: number): [number, number, number] {
    const c = this.here;
    const wear = smooth(0.15, 0.8, c[3]) * (0.4 + 0.6 * smooth(0.1, 0.6, slope));
    const dep = smooth(0.2, 0.85, c[4]) * (1 - 0.7 * smooth(0.3, 0.9, slope));
    const flow = smooth(0.35, 0.95, c[5]);
    return [wear, dep, flow];
  }

  /** Blend the carved land's cells around a point (in tiles) into `here`. */
  private sampleCells(fx: number, fy: number): void {
    const S = this.cellScale;
    const W = this.cellW;
    const H = this.cellH;
    let x = (fx + 0.5) * S - 0.5;
    let y = (fy + 0.5) * S - 0.5;
    x = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
    y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 < W - 1 ? x0 + 1 : x0;
    const y1 = y0 < H - 1 ? y0 + 1 : y0;
    const tx = x - x0;
    const ty = y - y0;
    const a = (y0 * W + x0) * 6;
    const b = (y0 * W + x1) * 6;
    const c = (y1 * W + x0) * 6;
    const d = (y1 * W + x1) * 6;
    const wa = (1 - tx) * (1 - ty);
    const wb = tx * (1 - ty);
    const wc = (1 - tx) * ty;
    const wd = tx * ty;
    const g = this.cells;
    const out = this.here;
    for (let k = 0; k < 6; k++) out[k] = g[a + k] * wa + g[b + k] * wb + g[c + k] * wc + g[d + k] * wd;
  }

  /**
   * Paint a W×H pixel image of the map region starting at (x0, y0) in map coordinates, each pixel
   * covering sx × sy of the map. The optional mask is opaque over dry land (so realm colours can be
   * clipped to the painted coast). `rowFrom`/`rowTo` paint only those rows, so a big picture can be
   * painted a slice at a time.
   */
  paint(img: ImageData, x0: number, y0: number, sx: number, sy: number, mask?: ImageData, rowFrom = 0, rowTo = img.height): void {
    const map = this.map;
    const w = map.width;
    const h = map.height;
    const W = img.width;
    const H = img.height;
    const d = img.data;
    const md = mask?.data;
    const parchment = this.style === 'parchment';
    const drawn = this.style === 'drawn';
    for (let py = rowFrom; py < Math.min(H, rowTo); py++) {
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
        const e = this.coast(fx, fy, e0, sx);
        // Lakes take their shape from the lake tiles, warped at two scales so the shore wanders.
        let lx = fx;
        let ly = fy;
        const tile = Math.min(h - 1, Math.max(0, Math.round(fy))) * w + Math.min(w - 1, Math.max(0, Math.round(fx)));
        if (this.nearLake[tile]) {
          lx += edgeNoise.noise(fx * 0.45 + 17, fy * 0.45) * 0.5 + edgeNoise.noise(fx * 1.6, fy * 1.6 + 5) * 0.1;
          ly += edgeNoise.noise(fx * 0.45, fy * 0.45 + 17) * 0.5 + edgeNoise.noise(fx * 1.6 + 5, fy * 1.6) * 0.1;
        }
        const lsd = this.nearLake[tile] ? this.lakeSd(lx, ly) : -3;
        const lake = lsd > 0;
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
            if (!lake && sx < 0.1 && depth < 0.05 && (depth / 0.011) % 1 < 0.18) {
              const q = 0.35 * (1 - depth / 0.05);
              r += (90 - r) * q;
              g += (128 - g) * q;
              b += (150 - b) * q;
            }
            const paper = 1 + edgeNoise.noise(fx * 7, fy * 7) * 0.012;
            r *= paper;
            g *= paper;
            b *= paper;
            const line = lake ? this.lakeShoreInk(lsd, sx) : this.shoreInk(fx, fy, e, sx);
            if (line > 0) {
              r += (DRAWN_INK[0] - r) * line;
              g += (DRAWN_INK[1] - g) * line;
              b += (DRAWN_INK[2] - b) * line;
            }
          } else if (parchment) {
            [r, g, b] = PAPER_SEA;
            // Ripple lines following the shore, fading out to sea.
            if (!lake && sx < 0.1 && depth < 0.05) {
              const phase = (depth / 0.011) % 1;
              if (phase < 0.18) {
                const k = 0.55 * (1 - depth / 0.05);
                r += (INK[0] - r) * k * 0.6;
                g += (INK[1] - g) * k * 0.6;
                b += (INK[2] - b) * k * 0.6;
              }
            }
            if (lake) [r, g, b] = [r * 0.94, g * 0.95, b * 0.97];
            const line = lake ? this.lakeShoreInk(lsd, sx) : this.shoreInk(fx, fy, e, sx);
            if (line > 0) {
              r += (INK[0] - r) * line;
              g += (INK[1] - g) * line;
              b += (INK[2] - b) * line;
            }
          } else if (lake) [r, g, b] = LAKE;
          else {
            const k1 = smooth(0.0, 0.1, depth);
            const k2 = smooth(0.1, 0.45, depth);
            r = SHELF[0] + (MIDSEA[0] - SHELF[0]) * k1 + (DEEPSEA[0] - MIDSEA[0]) * k2;
            g = SHELF[1] + (MIDSEA[1] - SHELF[1]) * k1 + (DEEPSEA[1] - MIDSEA[1]) * k2;
            b = SHELF[2] + (MIDSEA[2] - SHELF[2]) * k1 + (DEEPSEA[2] - MIDSEA[2]) * k2;
            const swell = 1 + edgeNoise.noise(fx * 0.6, fy * 0.6) * 0.05;
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
          // The carved land: its height and slope.
          this.sampleCells(fx, fy);
          const hh = Math.max(0.002, this.here[0]);
          const gx = this.here[1];
          const gy = this.here[2];
          const slope = Math.hypot(gx, gy);
          // Lit from the north-west: brightness against flat ground.
          const Z = 6;
          const nx = -gx * Z;
          const ny = -gy * Z;
          const nl = Math.hypot(nx, ny, 1);
          const lambert = (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / nl;
          const shade = clamp(lambert / LIGHT[2], 0.35, 1.45);
          const ao = clamp(1 + this.cavAt(fx, fy) * 2.2, 0.72, 1.06);
          if (drawn) {
            // Watercolour washes on cream paper, browning with height, crisp relief shading.
            const paper = 1 + edgeNoise.noise(fx * 1.5 + 40, fy * 1.5) * 0.03 + edgeNoise.noise(fx * 7, fy * 7) * 0.015;
            const jx = fx + edgeNoise.noise(fx * 0.35, fy * 0.35) * 0.6;
            const jy = fy + edgeNoise.noise(fx * 0.35 + 40, fy * 0.35 + 40) * 0.6;
            const wash = 0.75;
            r = DRAWN_PAPER[0] + (this.paperR(jx, jy) - DRAWN_PAPER[0]) * wash;
            g = DRAWN_PAPER[1] + (this.paperG(jx, jy) - DRAWN_PAPER[1]) * wash;
            b = DRAWN_PAPER[2] + (this.paperB(jx, jy) - DRAWN_PAPER[2]) * wash;
            const high = smooth(0.3, 0.75, hh);
            r += (DRAWN_HIGH[0] - r) * high;
            g += (DRAWN_HIGH[1] - g) * high;
            b += (DRAWN_HIGH[2] - b) * high;
            // What the erosion left, in light washes: grey scoured rock, pale screes and fans, and
            // the gullies picked out a shade darker.
            const [wr, dp, fl] = this.erosionAt(slope);
            r += (DRAWN_ROCK[0] - r) * wr * 0.6 + (DRAWN_PAPER[0] - r) * dp * 0.35;
            g += (DRAWN_ROCK[1] - g) * wr * 0.6 + (DRAWN_PAPER[1] - g) * dp * 0.35;
            b += (DRAWN_ROCK[2] - b) * wr * 0.6 + (DRAWN_PAPER[2] - b) * dp * 0.35;
            const gully = 1 - fl * 0.14;
            r *= gully;
            g *= gully;
            b *= gully;
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
            const line = Math.max(this.shoreInk(fx, fy, e, sx), this.lakeShoreInk(lsd, sx));
            if (line > 0) {
              r += (DRAWN_INK[0] - r) * line;
              g += (DRAWN_INK[1] - g) * line;
              b += (DRAWN_INK[2] - b) * line;
            }
          } else if (parchment) {
            const paper = 1 + edgeNoise.noise(fx * 1.5 + 40, fy * 1.5) * 0.035 + edgeNoise.noise(fx * 6, fy * 6) * 0.015;
            const m = this.ruggedAt(fx, fy);
            [r, g, b] = PAPER;
            r += (205 - r) * m * 0.35;
            g += (186 - g) * m * 0.35;
            b += (150 - b) * m * 0.35;
            const sh = 1 + (shade - 1) * 0.9;
            r *= paper * sh;
            g *= paper * sh;
            b *= paper * sh * 0.98;
            // Forests hatched in fine diagonal ink lines, as old maps mark woodland.
            const jx = fx + edgeNoise.noise(fx * 0.35, fy * 0.35) * 0.6;
            const jy = fy + edgeNoise.noise(fx * 0.35 + 40, fy * 0.35 + 40) * 0.6;
            if (this.forestAt(jx, jy) > 0.5 && (px + py) % 5 === 0) {
              r += (INK[0] - r) * 0.45;
              g += (INK[1] - g) * 0.45;
              b += (INK[2] - b) * 0.45;
            }
            // The inked coastline, and the shores of lakes.
            const line = Math.max(this.shoreInk(fx, fy, e, sx), this.lakeShoreInk(lsd, sx));
            if (line > 0) {
              r += (INK[0] - r) * line;
              g += (INK[1] - g) * line;
              b += (INK[2] - b) * line;
            }
          } else {
            // Ground cover, blended between neighbouring biomes along a ragged line.
            const jx = fx + edgeNoise.noise(fx * 0.35, fy * 0.35) * 0.6;
            const jy = fy + edgeNoise.noise(fx * 0.35 + 40, fy * 0.35 + 40) * 0.6;
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
            // What the erosion left, as Gaea colours a landscape from its erosion maps: bare rock
            // where water scoured it, pale scree and gravel fans where the load came to rest (soil,
            // and so greener, down in the lowlands), and the gullies darker, wet and shaded.
            const [wr, dp, fl] = this.erosionAt(slope);
            r += (ROCK[0] - r) * wr * 0.75;
            g += (ROCK[1] - g) * wr * 0.75;
            b += (ROCK[2] - b) * wr * 0.75;
            const low = smooth(0.4, 0.15, hh);
            const dr = SCREE[0] + (r * 1.08 - SCREE[0]) * low;
            const dg = SCREE[1] + (g * 1.12 - SCREE[1]) * low;
            const db = SCREE[2] + (b * 1.0 - SCREE[2]) * low;
            r += (dr - r) * dp * 0.55;
            g += (dg - g) * dp * 0.55;
            b += (db - b) * dp * 0.55;
            const wet = 1 - fl * 0.22;
            r *= wet;
            g *= wet;
            b *= wet;
            // Snow where it is cold enough, thinner on the steepest faces.
            const tp = t - Math.max(0, hh - Math.max(0, e0)) * 0.4;
            const glacier = smooth(0.3, 0.6, this.iceAt(jx, jy));
            const snow = Math.max(glacier, smooth(0.17, 0.08, tp)) * (1 - 0.55 * smooth(0.7, 1.4, slope));
            r += (SNOW[0] - r) * snow;
            g += (SNOW[1] - g) * snow;
            b += (SNOW[2] - b) * snow;
            // Fine texture so nothing is one flat colour.
            const tex = 1 + edgeNoise.noise(fx * 2.3, fy * 2.3) * 0.06 + edgeNoise.noise(fx * 9, fy * 9) * 0.03;
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
 * Rivers as smooth winding curves in map coordinates, thickening as they gather water. Normally
 * these are the rivers traced along the carved valleys; otherwise, from the tiles: each river
 * tile gives one stretch: from the midpoint with the main stream coming in, curving through its
 * point, to the midpoint with the tile it flows on to. A tributary runs on to meet the main
 * stream's curve. Packed as start x, y, control x, y, end x, y, width (in tiles).
 */
export function riverCurves(map: MapData): Float32Array {
  // Rivers traced along the carved valleys when the world was made.
  if (map.riverCurves) return map.riverCurves;
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
