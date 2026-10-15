import { Noise2D } from './noise';
import { Rng } from './rng';

/**
 * The map's land as a terrain program (Gaea, World Machine) would build it, on a grid finer than the
 * tiles (`scale` cells to a tile each way), with the data maps the erosion leaves behind.
 */
export interface ReliefField {
  heights: Float32Array;
  /** Where erosion took material away (0..1): bare, scoured rock. */
  wear: Float32Array;
  /** Where the material came to rest (0..1): fans, screes and valley floors. */
  deposits: Float32Array;
  /** How much water ran over each cell (0..1): streams and gullies. */
  flow: Float32Array;
  /** 1 for cells under the sea: the erosion's outlets, left uncarved. */
  water: Uint8Array;
  /** 1 for cells under a lake (set when the rivers and lakes are worked out). */
  lake?: Uint8Array;
  /** Signed distance to the nearest lake shore in tiles, positive on the water (-3/3 far away). */
  lakeSd?: Float32Array;
  /** The land as shaped before erosion (when asked for with keepShaped). */
  shaped?: Float32Array;
  width: number;
  height: number;
  scale: number;
}

/** How far through the pipeline to go (for comparing the stages). */
export type TerrainStage = 'layout' | 'mountains' | 'valleys' | 'full';

/** The settings a world's land is carved with unless told otherwise (chosen on the stages preview). */
export const TERRAIN_DEFAULTS = { mountains: 1.3, erosion: 1.4, softness: 0.6, downcutting: 0.7 };

export interface ErosionOptions {
  /** Cells per tile in each direction. */
  scale?: number;
  seed?: number;
  /** Stop after this stage. */
  stage?: TerrainStage;
  /** How much jagged mountain shape is added to the high ground (0 none .. 1 full .. 1.5). */
  mountains?: number;
  /** Overall strength of the erosion (0 none .. 1 normal .. 2 heavy). */
  erosion?: number;
  /** Rock softness (0 hard .. 1 soft): soft rock wears quickly, hard rock carries its sediment further. */
  softness?: number;
  /** Downcutting (0 .. 1): how deep streams groove into the slopes. */
  downcutting?: number;
  /** Raindrops per land cell (of the half-fine grid the rain falls on). */
  rain?: number;
  /** Where this piece of land sits on the whole map, in tiles (so a piece carves like the whole). */
  offset?: [number, number];
  /**
   * Land shaped by hand on the fine grid (the editor's Terrain tools), as heights added to the
   * land laid out from the tiles: `scale` cells to a tile, the same size as the result.
   */
  relief?: Float32Array | null;
  /** Leave the wear, deposit and flow maps unscaled (to be scaled with normaliseMaps). */
  raw?: boolean;
  /** Keep a copy of the land as shaped, before any erosion (as `shaped` on the result). */
  keepShaped?: boolean;
}

/** A min-heap of cell indices ordered by height. */
export class CellHeap {
  private idx: Int32Array;
  private key: Float64Array;
  size = 0;
  constructor(n: number) {
    this.idx = new Int32Array(n);
    this.key = new Float64Array(n);
  }
  push(i: number, k: number): void {
    let p = this.size++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (this.key[q] <= k) break;
      this.idx[p] = this.idx[q];
      this.key[p] = this.key[q];
      p = q;
    }
    this.idx[p] = i;
    this.key[p] = k;
  }
  pop(): number {
    const top = this.idx[0];
    const n = --this.size;
    const li = this.idx[n];
    const lk = this.key[n];
    let p = 0;
    for (;;) {
      let c = 2 * p + 1;
      if (c >= n) break;
      if (c + 1 < n && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lk) break;
      this.idx[p] = this.idx[c];
      this.key[p] = this.key[c];
      p = c;
    }
    this.idx[p] = li;
    this.key[p] = lk;
    return top;
  }
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Two fixed pseudo-random numbers in [0, 1) for a lattice point. */
function hash2(ix: number, iy: number, seed: number): [number, number] {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  const a = (h >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 15;
  return [a, (h >>> 0) / 4294967296];
}

/**
 * Faceted peaks, as Gaea's Mountain node makes them from a Voronoi pattern: each cell of a jittered
 * lattice is a pyramid, highest at its point and creased down to a valley along the cell's borders,
 * so sharp ridges run from every summit out to the corners. 0..1.
 */
function pyramids(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [hx, hy] = hash2(ix + i, iy + j, seed);
      const dx = ix + i + 0.1 + hx * 0.8 - x;
      const dy = iy + j + 0.1 + hy * 0.8 - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return Math.min(1, (f2 - f1) * 1.4);
}

interface Grid {
  hts: Float32Array;
  fixed: Uint8Array;
  W: number;
  H: number;
}

/** Lay the tiles out on the fine grid, smoothly (water cells stay where they are, as outlets). */
function layOut(surface: Float32Array, water: Uint8Array, w: number, h: number, s: number): Grid {
  const W = w * s;
  const H = h * s;
  const hts = new Float32Array(W * H);
  const fixed = new Uint8Array(W * H);
  const tile = (x: number, y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x);
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  for (let Y = 0; Y < H; Y++) {
    const fy = (Y + 0.5) / s - 0.5;
    const y1 = Math.floor(fy);
    const ty = fy - y1;
    for (let X = 0; X < W; X++) {
      const fx = (X + 0.5) / s - 0.5;
      const x1 = Math.floor(fx);
      const tx = fx - x1;
      const i = Y * W + X;
      // Water where the tiles around, blended, are more water than land: shores come out rounded
      // rather than square.
      const wx0 = x1 < 0 ? 0 : x1;
      const wy0 = y1 < 0 ? 0 : y1;
      const wx1 = Math.min(w - 1, x1 + 1);
      const wy1 = Math.min(h - 1, y1 + 1);
      const cx = Math.min(1, Math.max(0, tx));
      const cy = Math.min(1, Math.max(0, ty));
      const wet =
        (water[wy0 * w + wx0] * (1 - cx) + water[wy0 * w + wx1] * cx) * (1 - cy) +
        (water[wy1 * w + wx0] * (1 - cx) + water[wy1 * w + wx1] * cx) * cy;
      if (wet >= 0.5) {
        fixed[i] = 1;
        hts[i] = Math.max(0, surface[tile(Math.round(fx), Math.round(fy))]);
        continue;
      }
      const row = (yy: number) => cr(surface[tile(x1 - 1, yy)], surface[tile(x1, yy)], surface[tile(x1 + 1, yy)], surface[tile(x1 + 2, yy)], tx);
      hts[i] = Math.max(0.001, cr(row(y1 - 1), row(y1), row(y1 + 1), row(y1 + 2), ty));
    }
  }
  return { hts, fixed, W, H };
}

/**
 * Give the high ground the shape of real mountains before it is eroded, as Gaea's Mountain and Draw
 * nodes do: Voronoi pyramids at three sizes, warped so their edges wander, the smaller ones riding
 * on the bigger ones' flanks. Low ground is left alone; the higher the land, the more mountainous.
 */
function addMountains(g: Grid, s: number, rng: Rng, amount: number, ox = 0, oy = 0): void {
  if (amount <= 0) return;
  const { hts, fixed, W, H } = g;
  const warp = new Noise2D(rng.fork('mountain-warp'));
  const grain = new Noise2D(rng.fork('mountain-grain'));
  const seed = Math.floor(rng.next() * 1e9);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const i = Y * W + X;
      if (fixed[i]) continue;
      const v = hts[i];
      const mass = smooth(0.12, 0.5, v);
      // Where on the whole map this cell is (in cells), so pieces carved apart line up.
      const AX = X + ox * s;
      const AY = Y + oy * s;
      if (mass <= 0) {
        hts[i] = v + grain.noise(AX * 0.6 / s, AY * 0.6 / s) * 0.003;
        continue;
      }
      // In tiles, warped.
      const tx = (AX + 0.5) / s + warp.fbm(AX * 0.05 / s, AY * 0.05 / s, 3) * 3;
      const ty = (AY + 0.5) / s + warp.fbm(AX * 0.05 / s + 31, AY * 0.05 / s - 17, 3) * 3;
      let m = 0;
      let amp = 1;
      let f = 1 / 8;
      let norm = 0;
      let weight = 1;
      for (let o = 0; o < 3; o++) {
        const p = pyramids(tx * f, ty * f, seed + o * 101);
        m += p * amp * weight;
        norm += amp;
        weight = 0.5 + 0.5 * p;
        amp *= 0.45;
        f *= 2.3;
      }
      m /= norm;
      hts[i] = Math.max(0.001, v + v * mass * amount * (m - 0.32) * 0.9);
    }
  }
}

/**
 * Rain, drop by drop, as terrain programs erode: each raindrop runs downhill, picks up soil where it
 * speeds up and drops it where it slows, and carries the rest on until it dries up or reaches the
 * sea. Soft rock wears quickly but drops its load soon; hard rock wears slowly and carries further.
 * Records where it wore the land, where it left its load, and where the water ran.
 */
function rainfall(g: Grid, rng: Rng, s: number, opts: { drops: number; strength: number; softness: number; downcutting: number; ox?: number; oy?: number }, wear: Float32Array, deposits: Float32Array, flow: Float32Array): void {
  const { hts, fixed, W, H } = g;
  const inertia = 0.1;
  const gravity = 4;
  const evaporate = 0.02;
  const maxLife = 30 * Math.max(1, s / 2);
  const capacityK = 3 + 5 * opts.downcutting;
  const minCapacity = 0.0005;
  const erodeK = (0.009 + 0.021 * opts.softness) * opts.strength;
  const depositK = 0.07 - 0.045 * opts.softness;
  // Heights and slopes as the drop sees them (heights are 0..1 over the map, slopes per cell).
  const steep = 1;
  // The erosion brush: a small soft disc, so gullies stay narrow.
  const R = 1;
  const bx: number[] = [];
  const by: number[] = [];
  const bw: number[] = [];
  let bsum = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      bx.push(dx);
      by.push(dy);
      bw.push(R - d + 0.2);
      bsum += R - d + 0.2;
    }
  }
  for (let k = 0; k < bw.length; k++) bw[k] /= bsum;
  // Where each drop falls depends only on where on the map it is, never on how much land there is
  // elsewhere: change the land in one place and the rain everywhere else falls just as before.
  const ox = opts.ox ?? 0;
  const oy = opts.oy ?? 0;
  const seed = Math.floor(rng.next() * 1e9);
  const starts: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (fixed[i]) continue;
    const X = (i % W) + ox;
    const Y = Math.floor(i / W) + oy;
    const [a, b] = hash2(X, Y, seed);
    const count = Math.floor(opts.drops + a);
    for (let k = 0; k < count; k++) {
      const [u, v] = hash2(X * 7 + k, Y * 13 - k, seed + 17);
      starts.push(i, u, (v + b) % 1);
    }
  }
  if (!starts.length) return;
  const hg = new Float64Array(3);
  const sample = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const i = iy * W + ix;
    const a = hts[i];
    const b = hts[i + 1];
    const c = hts[i + W];
    const d = hts[i + W + 1];
    hg[0] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    hg[1] = (b - a) * (1 - fy) + (d - c) * fy;
    hg[2] = (c - a) * (1 - fx) + (d - b) * fx;
  };
  for (let n = 0; n < starts.length; n += 3) {
    const start = starts[n];
    let x = (start % W) + starts[n + 1];
    let y = Math.floor(start / W) + starts[n + 2];
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;
    for (let life = 0; life < maxLife; life++) {
      if (x < 1 || y < 1 || x >= W - 2 || y >= H - 2) break;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const cell = iy * W + ix;
      if (fixed[cell]) break;
      const ox = x - ix;
      const oy = y - iy;
      sample(x, y);
      const h0 = hg[0];
      dx = dx * inertia - hg[1] * (1 - inertia);
      dy = dy * inertia - hg[2] * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) {
        const a = hash2(Math.floor(x * 31) + ox, Math.floor(y * 31) + oy, seed + life)[0] * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a);
      } else {
        dx /= len;
        dy /= len;
      }
      x += dx;
      y += dy;
      flow[cell] += water;
      if (x < 1 || y < 1 || x >= W - 2 || y >= H - 2) break;
      sample(x, y);
      const dh = (hg[0] - h0) * steep;
      const capacity = Math.max(-dh * speed * water * capacityK, minCapacity);
      if (sediment > capacity || dh > 0) {
        // Slowing or climbing: drop some of the load (filling the hollow it would climb out of).
        const drop = dh > 0 ? Math.min(dh, sediment) * 0.15 : (sediment - capacity) * depositK;
        sediment -= drop;
        const amt = drop / steep;
        const w00 = (1 - ox) * (1 - oy);
        const w10 = ox * (1 - oy);
        const w01 = (1 - ox) * oy;
        const w11 = ox * oy;
        hts[cell] += amt * w00;
        hts[cell + 1] += amt * w10;
        hts[cell + W] += amt * w01;
        hts[cell + W + 1] += amt * w11;
        deposits[cell] += amt;
      } else {
        // Speeding downhill: scour the ground under it, never deeper than the drop it just made.
        const take = Math.min((capacity - sediment) * erodeK, -dh);
        let got = 0;
        for (let k = 0; k < bw.length; k++) {
          const j = (iy + by[k]) * W + ix + bx[k];
          if (j < 0 || j >= W * H || fixed[j]) continue;
          const want = (take / steep) * bw[k];
          const d = Math.min(want, Math.max(0, hts[j] - 0.0005));
          hts[j] -= d;
          wear[j] += d;
          got += d;
        }
        sediment += got * steep;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
    }
  }
}

/**
 * Slopes steeper than loose rock can stand crumble: material slides down to the foot, where it
 * piles up as scree. Leaves cliffs at the angle of repose and talus slopes below them.
 */
function crumble(g: Grid, s: number, rounds: number, deposits: Float32Array): void {
  const { hts, fixed, W, H } = g;
  // Steepest a slope may stand, per cell: a quarter of the map's height over a tile.
  const talus = 0.25 / s;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  for (let r = 0; r < rounds; r++) {
    for (let Y = 1; Y < H - 1; Y++) {
      for (let X = 1; X < W - 1; X++) {
        const i = Y * W + X;
        if (fixed[i]) continue;
        let best = -1;
        let drop = 0;
        for (let k = 0; k < 8; k++) {
          const j = (Y + DY[k]) * W + X + DX[k];
          const d = (hts[i] - hts[j]) / DL[k] - talus;
          if (d > drop) {
            drop = d;
            best = j;
          }
        }
        if (best < 0) continue;
        const move = drop * 0.4;
        hts[i] -= move;
        if (!fixed[best]) {
          hts[best] += move;
          deposits[best] += move;
        }
      }
    }
  }
}

/** Scale a data map to 0..1 against its own high values, and soften it a little. */
function normalise(a: Float32Array, fixed: Uint8Array, W: number, H: number, curve: (v: number) => number, given?: number): number {
  let top = given;
  if (top === undefined) {
    const vals: number[] = [];
    for (let i = 0; i < a.length; i += 7) if (!fixed[i] && a[i] > 0) vals.push(a[i]);
    vals.sort((x, y) => x - y);
    top = vals.length ? vals[Math.floor(vals.length * 0.97)] : 1;
  }
  const tmp = Float32Array.from(a);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const i = Y * W + X;
      if (fixed[i]) {
        a[i] = 0;
        continue;
      }
      let sum = tmp[i] * 4;
      let n = 4;
      if (X > 0) (sum += tmp[i - 1]), n++;
      if (X < W - 1) (sum += tmp[i + 1]), n++;
      if (Y > 0) (sum += tmp[i - W]), n++;
      if (Y < H - 1) (sum += tmp[i + W]), n++;
      a[i] = clamp01(curve(sum / n / (top || 1)));
    }
  }
  return top;
}

/**
 * Turn the map's heights into realistic terrain, the way Gaea and World Machine turn a heightmap
 * into a landscape:
 *  1. the tile heights are laid out smoothly on a grid finer than the tiles;
 *  2. the high ground is given the shape of real mountains (Voronoi pyramids, as Gaea's Mountain node);
 *  3. rivers cut the big valleys, branching up into the ranges (stream erosion, coarse then fine);
 *  4. rain falls drop by drop, scouring gullies and carrying the soil down to fans and valley floors;
 *  5. slopes too steep to stand crumble into scree.
 * Steps 4 and 5 leave the wear, deposit and flow maps that the map colours its ground by.
 * Coasts and lakes stay where they are. `water` marks tiles that are sea or lake.
 */
export function erodeRelief(surface: Float32Array, water: Uint8Array, w: number, h: number, opts: ErosionOptions = {}): ReliefField {
  const s = opts.scale ?? 4;
  const stage = opts.stage ?? 'full';
  const strength = opts.erosion ?? TERRAIN_DEFAULTS.erosion;
  const softness = opts.softness ?? TERRAIN_DEFAULTS.softness;
  const downcutting = opts.downcutting ?? TERRAIN_DEFAULTS.downcutting;
  const rng = new Rng(opts.seed ?? 1);
  const g = layOut(surface, water, w, h, s);
  const { hts, fixed, W, H } = g;
  const n = W * H;
  const wear = new Float32Array(n);
  const deposits = new Float32Array(n);
  const flow = new Float32Array(n);
  if (stage === 'layout') return { heights: hts, wear, deposits, flow, water: fixed, width: W, height: H, scale: s };
  addMountains(g, s, rng.fork('mountains'), opts.mountains ?? TERRAIN_DEFAULTS.mountains, opts.offset?.[0] ?? 0, opts.offset?.[1] ?? 0);
  // The land shaped by hand goes on top, as drawn: its ridges are already mountain-shaped.
  const relief = opts.relief;
  if (relief) for (let i = 0; i < n; i++) if (!fixed[i] && relief[i] !== 0) hts[i] = Math.max(0.001, hts[i] + relief[i]);
  const shaped = opts.keepShaped ? Float32Array.from(hts) : undefined;
  const done = (): ReliefField => ({ heights: hts, wear, deposits, flow, water: fixed, width: W, height: H, scale: s, shaped });
  if (stage === 'mountains' || strength <= 0) return done();

  // 3 to 5 happen first on a grid half as fine: water gathers from further, the raindrops cut
  // gullies big enough to read on a map, and it is quicker. The change is then carried up to the
  // full grid smoothly, and the streams finish their cutting there.
  const K = 0.03 * strength * (0.6 + 0.8 * downcutting);
  const cs = Math.max(1, s >> 1);
  const f = s / cs;
  const CW = w * cs;
  const CH = h * cs;
  const cn = CW * CH;
  const coarse = new Float32Array(cn);
  const cfixed = new Uint8Array(cn);
  for (let Y = 0; Y < CH; Y++) {
    for (let X = 0; X < CW; X++) {
      let sum = 0;
      let fx = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = (Y * f + dy) * W + X * f + dx;
          sum += hts[i];
          fx += fixed[i];
        }
      }
      coarse[Y * CW + X] = sum / (f * f);
      cfixed[Y * CW + X] = fx * 2 >= f * f ? 1 : 0;
    }
  }
  const was = Float32Array.from(coarse);
  const cg: Grid = { hts: coarse, fixed: cfixed, W: CW, H: CH };
  const cwear = new Float32Array(cn);
  const cdep = new Float32Array(cn);
  const cflow = new Float32Array(cn);
  // At the tiles' own resolution (a quick preview) there is only the one grid, worked a little less.
  const quick = s === 1;
  erodeGrid(coarse, cfixed, CW, CH, quick ? 18 : 30, K, 0.03, 0.5, rng.fork('valleys'), was, UPLIFT);
  for (let i = 0; i < cn; i++) if (was[i] > coarse[i]) cwear[i] += (was[i] - coarse[i]) * 0.5;
  if (stage === 'full') {
    // The rain scours gullies and lays down fans, but never wears the land more than gully-deep:
    // the big valleys are the streams' work, and a ridge keeps its height.
    const preRain = Float32Array.from(coarse);
    rainfall(cg, rng.fork('rain'), cs, { drops: (opts.rain ?? (quick ? 1.5 : 3)) * strength, strength: Math.min(1.5, strength), softness, downcutting, ox: (opts.offset?.[0] ?? 0) * cs, oy: (opts.offset?.[1] ?? 0) * cs }, cwear, cdep, cflow);
    const gully = 0.012 + 0.006 * strength;
    for (let i = 0; i < cn; i++) {
      const d = coarse[i] - preRain[i];
      if (d < -gully) coarse[i] = preRain[i] - gully;
      else if (d > gully * 0.6) coarse[i] = preRain[i] + gully * 0.6;
    }
    crumble(cg, cs, 3, cdep);
  }
  // Carry the change up to the full grid along smooth curves (so no creases show along the coarse
  // cells), and the maps up straight; both a row at a time and then a column at a time.
  const delta = new Float32Array(cn);
  for (let i = 0; i < cn; i++) delta[i] = coarse[i] - was[i];
  const cubic = (n: number, N: number) => {
    // For each fine index: the coarse index before it and the four Catmull-Rom weights.
    const at = new Int32Array(n * 4);
    const wt = new Float32Array(n * 4);
    for (let X = 0; X < n; X++) {
      const c = (X + 0.5) / f - 0.5;
      const c1 = Math.floor(c);
      const t = c - c1;
      for (let k = 0; k < 4; k++) at[X * 4 + k] = Math.min(N - 1, Math.max(0, c1 - 1 + k));
      wt[X * 4] = 0.5 * (-t + 2 * t * t - t * t * t);
      wt[X * 4 + 1] = 0.5 * (2 - 5 * t * t + 3 * t * t * t);
      wt[X * 4 + 2] = 0.5 * (t + 4 * t * t - 3 * t * t * t);
      wt[X * 4 + 3] = 0.5 * (-t * t + t * t * t);
    }
    return { at, wt };
  };
  const linear = (n: number, N: number) => {
    const at = new Int32Array(n * 2);
    const wt = new Float32Array(n * 2);
    for (let X = 0; X < n; X++) {
      const c = Math.min(N - 1, Math.max(0, (X + 0.5) / f - 0.5));
      const c0 = Math.floor(c);
      at[X * 2] = c0;
      at[X * 2 + 1] = Math.min(N - 1, c0 + 1);
      wt[X * 2] = 1 - (c - c0);
      wt[X * 2 + 1] = c - c0;
    }
    return { at, wt };
  };
  const upscale = (a: Float32Array, cx: { at: Int32Array; wt: Float32Array }, cy: { at: Int32Array; wt: Float32Array }, k: number, add: boolean, out: Float32Array) => {
    const rows = new Float32Array(CH * W);
    for (let y = 0; y < CH; y++) {
      for (let X = 0; X < W; X++) {
        let v = 0;
        for (let q = 0; q < k; q++) v += a[y * CW + cx.at[X * k + q]] * cx.wt[X * k + q];
        rows[y * W + X] = v;
      }
    }
    for (let Y = 0; Y < H; Y++) {
      for (let X = 0; X < W; X++) {
        const i = Y * W + X;
        if (fixed[i]) continue;
        let v = 0;
        for (let q = 0; q < k; q++) v += rows[cy.at[Y * k + q] * W + X] * cy.wt[Y * k + q];
        out[i] = add ? Math.max(0.001, out[i] + v) : v;
      }
    }
  };
  const cx4 = cubic(W, CW);
  const cy4 = cubic(H, CH);
  const cx2 = linear(W, CW);
  const cy2 = linear(H, CH);
  upscale(delta, cx4, cy4, 4, true, hts);
  upscale(cwear, cx2, cy2, 2, false, wear);
  upscale(cdep, cx2, cy2, 2, false, deposits);
  upscale(cflow, cx2, cy2, 2, false, flow);
  const before = Float32Array.from(hts);
  if (!quick) erodeGrid(hts, fixed, W, H, 6, K, 0.02, 0.5, rng.fork('streams'), before, UPLIFT);
  for (let i = 0; i < n; i++) if (!fixed[i] && before[i] > hts[i]) wear[i] += before[i] - hts[i];
  return finish(g, wear, deposits, flow, done, opts.raw);
}

/** Soften the grid's stair-steps, and scale the data maps to 0..1. */
function finish(g: Grid, wear: Float32Array, deposits: Float32Array, flow: Float32Array, done: () => ReliefField, raw = false): ReliefField {
  const { hts, fixed, W, H } = g;
  const tmp = Float32Array.from(hts);
  for (let Y = 1; Y < H - 1; Y++) {
    for (let X = 1; X < W - 1; X++) {
      const i = Y * W + X;
      if (fixed[i]) continue;
      const b = (4 * tmp[i] + 2 * (tmp[i - 1] + tmp[i + 1] + tmp[i - W] + tmp[i + W]) + tmp[i - W - 1] + tmp[i - W + 1] + tmp[i + W - 1] + tmp[i + W + 1]) / 16;
      hts[i] = Math.max(0.0005, tmp[i] * 0.5 + b * 0.5);
    }
  }
  if (raw) return done();
  const f = done();
  normaliseMaps(f);
  return f;
}

/**
 * Scale a carving's wear, deposit and flow maps to 0..1. Each is scaled against its own high values
 * unless `tops` gives the scales to use: pieces of one map carved apart are scaled alike with the
 * scales of the whole, so their colours match. Returns the scales used.
 */
export function normaliseMaps(f: ReliefField, tops?: [number, number, number]): [number, number, number] {
  const { water, width: W, height: H } = f;
  return [
    normalise(f.wear, water, W, H, (v) => Math.sqrt(v), tops?.[0]),
    normalise(f.deposits, water, W, H, (v) => Math.sqrt(v), tops?.[1]),
    normalise(f.flow, water, W, H, (v) => Math.log1p(v * 20) / Math.log1p(20), tops?.[2]),
  ];
}

/**
 * How strongly the land rises back towards its shape each round of stream cutting, as uplift
 * balances erosion in real ranges: streams with much water still cut their valleys deep, but
 * the ridges between them keep their height, so the land keeps the shape it was drawn with.
 */
const UPLIFT = 0.12;

/**
 * Rounds of stream cutting and slope creep on one grid; `fixed` cells (water) are outlets.
 * With `keep`, the land rises back towards it by `uplift` of the difference each round.
 */
function erodeGrid(hts: Float32Array, fixed: Uint8Array, W: number, H: number, iters: number, K: number, D: number, M: number, rng: Rng, keep?: Float32Array, uplift = 0): void {
  const n = W * H;
  const wander = 0.6;
  const order = new Int32Array(n);
  const recv = new Int32Array(n);
  const area = new Float32Array(n);
  const seen = new Uint8Array(n);
  const heap = new CellHeap(n);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  const dist = new Float32Array(n);
  const tmp = new Float32Array(n);
  const fill = new Float32Array(n);
  const jitter = new Float32Array(n);
  for (let i = 0; i < n; i++) jitter[i] = rng.next();

  for (let it = 0; it < iters; it++) {
    // Route the water. First flood upward from the sea and lakes (and the map's edge), raising every
    // hollow just above its outlet, so water never gets stuck. Then each cell drains to its steepest
    // neighbour on that surface; cells reached later in the flood always lie above earlier ones, so
    // the flood order runs downstream to upstream.
    seen.fill(0);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const X = i % W;
      const Y = (i / W) | 0;
      if (fixed[i] || X === 0 || Y === 0 || X === W - 1 || Y === H - 1) {
        seen[i] = 1;
        heap.push(i, fixed[i] ? -1 : hts[i]);
      }
    }
    while (heap.size) {
      const c = heap.pop();
      order[count++] = c;
      const X = c % W;
      const Y = (c / W) | 0;
      const fc = fill[c] = fixed[c] ? hts[c] : Math.max(hts[c], fill[c]);
      for (let k = 0; k < 8; k++) {
        const x = X + DX[k];
        const y = Y + DY[k];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (seen[j]) continue;
        seen[j] = 1;
        // A tiny rise across flats, varied a little, so water finds its way across them crookedly.
        fill[j] = Math.max(hts[j], fc + 1e-6 * (1 + jitter[j]));
        heap.push(j, fill[j]);
      }
    }
    for (let k = 0; k < count; k++) {
      const c = order[k];
      recv[c] = -1;
      if (fixed[c]) continue;
      const X = c % W;
      const Y = (c / W) | 0;
      let best = 0;
      for (let q = 0; q < 8; q++) {
        const x = X + DX[q];
        const y = Y + DY[q];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        // Steepest way down, give or take: a little chance in which way water turns keeps the
        // streams from running in dead straight lines along the grid.
        const drop = ((fill[c] - fill[j]) / DL[q]) * (1 + wander * jitter[(j * 7 + c * 13) % n]);
        if (drop > best) {
          best = drop;
          recv[c] = j;
          dist[c] = DL[q];
        }
      }
    }
    // Gather the water: each cell's rain, plus everything that runs into it.
    for (let i = 0; i < n; i++) area[i] = 1;
    for (let k = count - 1; k >= 0; k--) {
      const c = order[k];
      const r = recv[c];
      if (r >= 0) area[r] += area[c];
    }
    // Cut: downstream first, each cell lowered towards the cell it drains to, by how much water
    // runs through it (implicit, so it never overshoots). Hollows silt up.
    for (let k = 0; k < count; k++) {
      const c = order[k];
      const r = recv[c];
      if (r < 0 || fixed[c]) continue;
      const hr = hts[r];
      if (hts[c] <= hr) {
        // A hollow silts up a little each round, rather than filling flat at once.
        hts[c] += (hr - hts[c]) * 0.3;
        continue;
      }
      const F = (K * Math.pow(area[c], M)) / dist[c];
      hts[c] = (hts[c] + F * hr) / (1 + F);
    }
    // Slopes creep and slump between the streams, which rounds off the finest rills.
    if (D > 0) {
      tmp.set(hts);
      for (let Y = 1; Y < H - 1; Y++) {
        for (let X = 1; X < W - 1; X++) {
          const i = Y * W + X;
          if (fixed[i]) continue;
          const lap = tmp[i - 1] + tmp[i + 1] + tmp[i - W] + tmp[i + W] - 4 * tmp[i];
          hts[i] = tmp[i] + D * lap;
        }
      }
    }
    if (keep && uplift > 0) for (let i = 0; i < n; i++) if (!fixed[i]) hts[i] += (keep[i] - hts[i]) * uplift;
  }
}

/** The water on carved land: rivers and lakes, for the map tiles and for drawing. */
export interface RiverNet {
  /** River discharge on each land tile (0 where no river runs), in the same units as the threshold. */
  river: Float32Array;
  /**
   * The rivers as smooth curves in tile coordinates: records of 7 numbers, a quadratic curve from
   * (x0, y0) through the control point (cx, cy) to (x1, y1), and its width in tiles.
   */
  curves: Float32Array;
  /** 1 for tiles that are mostly lake. */
  lake: Uint8Array;
  /** 1 for tiles at the dry floor of a basin with no outlet (salt flats). */
  salt: Uint8Array;
}

/** Gaea's Rivers settings. */
export interface RiverOptions {
  /** How much water makes a river: more Water, more and longer rivers (0 none .. 1 normal .. 2). */
  water?: number;
  /** How wide rivers are drawn and carved (0.5 thin .. 1 normal .. 2 wide). */
  width?: number;
  /** How deep the channels are cut (0 .. 1 normal .. 2). */
  depth?: number;
  /** How far rivers cut down through whatever stands in their way, so they keep falling to the sea (0 .. 1). */
  downcutting?: number;
  /** Places, in tiles, where a river must rise (painted with the River source tool). */
  sources?: [number, number][];
}

export const RIVER_DEFAULTS = { water: 1, width: 1, depth: 1, downcutting: 0.5 };

/**
 * Lakes and rivers on carved land, worked out together as water really behaves.
 *
 * Every hollow in the land is found, with the height at which it would spill over. A hollow too
 * small to matter is filled in. A real basin collects the rain of all the land draining into it:
 * where that is more than its surface would lose to the sky, it fills to the brim and spills out
 * through its lowest gap, and a river runs on from there; in a dry land it fills only until what
 * evaporates matches what flows in, a lake with no outlet (or a salt flat if it never fills).
 *
 * Rivers run where enough water gathers, always the steepest way down the carved land, so they
 * keep to the valley floors, from the uplands to a lake or the sea; out of every lake that spills,
 * a river carries on. A river source marked by hand starts one there. Rivers cut their channels
 * into the land, wider and deeper downstream, and wind a little where the land is flat.
 *
 * `rain` and `moisture` are per tile; `threshold` is how much gathered rain makes a river.
 */
export function traceRivers(relief: ReliefField, rain: Float32Array, moisture: Float32Array, w: number, h: number, threshold: number, seed = 1, opts: RiverOptions = {}): RiverNet {
  const water = opts.water ?? RIVER_DEFAULTS.water;
  const widthK = opts.width ?? RIVER_DEFAULTS.width;
  const depthK = opts.depth ?? RIVER_DEFAULTS.depth;
  const downcut = opts.downcutting ?? RIVER_DEFAULTS.downcutting;
  const { width: W, height: H, scale: S } = relief;
  const n = W * H;
  const hts = relief.heights;
  const isSea = relief.water;
  const tileOf = (c: number) => {
    const X = c % W;
    const Y = (c - X) / W;
    return Math.min(h - 1, Math.floor(Y / S)) * w + Math.min(w - 1, Math.floor(X / S));
  };
  const rng = new Rng(seed);
  const jitter = new Float32Array(n);
  for (let i = 0; i < n; i++) jitter[i] = rng.next();
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  const perCell = 1 / (S * S);

  // --- 1. Flood up from the sea: the level each hollow would fill to, and the order water drains in.
  const spill = new Float32Array(n); // the hollows filled exactly to their brims
  const fe = new Float32Array(n); // the same, with a slight fall across every filled flat
  const order = new Int32Array(n);
  const seen = new Uint8Array(n);
  const heap = new CellHeap(n);
  for (let i = 0; i < n; i++) {
    const X = i % W;
    const Y = (i - X) / W;
    if (isSea[i] || X === 0 || Y === 0 || X === W - 1 || Y === H - 1) {
      seen[i] = 1;
      spill[i] = fe[i] = isSea[i] ? -1 : hts[i];
      heap.push(i, fe[i]);
    }
  }
  let count = 0;
  while (heap.size) {
    const c = heap.pop();
    order[count++] = c;
    const X = c % W;
    const Y = (c - X) / W;
    for (let k = 0; k < 8; k++) {
      const x = X + DX[k];
      const y = Y + DY[k];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      if (seen[j]) continue;
      seen[j] = 1;
      spill[j] = Math.max(hts[j], spill[c] < 0 ? hts[j] : spill[c]);
      fe[j] = Math.max(hts[j], fe[c] + 1e-6 * (1 + jitter[j]));
      heap.push(j, fe[j]);
    }
  }
  const rank = new Int32Array(n);
  for (let k = 0; k < count; k++) rank[order[k]] = k;

  // Each cell drains the steepest way down; across a filled hollow, towards its outlet.
  const recv = new Int32Array(n).fill(-1);
  const steepest = (c: number, surf: Float32Array) => {
    const X = c % W;
    const Y = (c - X) / W;
    let best = 0;
    let to = -1;
    for (let q = 0; q < 8; q++) {
      const x = X + DX[q];
      const y = Y + DY[q];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      const drop = ((surf[c] - surf[j]) / DL[q]) * (1 + 0.3 * jitter[(j * 7 + c * 13) % n]);
      if (drop > best) {
        best = drop;
        to = j;
      }
    }
    return to;
  };
  for (let c = 0; c < n; c++) if (!isSea[c]) recv[c] = steepest(c, fe);
  const q = new Float32Array(n);
  const gather = () => {
    q.fill(0);
    for (let c = 0; c < n; c++) if (!isSea[c]) q[c] = rain[tileOf(c)] * perCell;
    // Upstream first: by height on the drained surface, highest first.
    for (let k = count - 1; k >= 0; k--) {
      const c = order[k];
      const r = recv[c];
      if (r >= 0) q[r] += q[c];
    }
  };
  gather();

  // --- 2. The hollows: each connected stretch of land below its brim.
  const basin = new Int32Array(n).fill(-1);
  const basins: { cells: number[]; level: number; deepest: number; outlet: number }[] = [];
  const stack: number[] = [];
  for (let k = 0; k < count; k++) {
    const c0 = order[k];
    if (basin[c0] >= 0 || isSea[c0] || spill[c0] - hts[c0] <= 1e-6) continue;
    const id = basins.length;
    const b = { cells: [] as number[], level: spill[c0], deepest: 0, outlet: -1 };
    basins.push(b);
    basin[c0] = id;
    stack.push(c0);
    // The first of its cells the flood reached came in over the outlet.
    let first = c0;
    while (stack.length) {
      const c = stack.pop()!;
      b.cells.push(c);
      b.level = Math.max(b.level, spill[c]);
      b.deepest = Math.max(b.deepest, spill[c] - hts[c]);
      if (rank[c] < rank[first]) first = c;
      const X = c % W;
      const Y = (c - X) / W;
      for (let d = 0; d < 8; d++) {
        const x = X + DX[d];
        const y = Y + DY[d];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (basin[j] >= 0 || isSea[j] || spill[j] - hts[j] <= 1e-6) continue;
        basin[j] = id;
        stack.push(j);
      }
    }
    // The outlet: the lowest neighbouring cell outside the hollow at the brim.
    let out = -1;
    for (const c of b.cells) {
      const X = c % W;
      const Y = (c - X) / W;
      for (let d = 0; d < 8; d++) {
        const x = X + DX[d];
        const y = Y + DY[d];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (basin[j] === id) continue;
        if (out < 0 || fe[j] < fe[out]) out = j;
      }
    }
    b.outlet = out >= 0 ? out : first;
  }

  // --- 3. Which hollows hold lakes, and how full.
  const lakeLevel = new Float32Array(n).fill(-Infinity);
  const isLake = new Uint8Array(n);
  const saltCell = new Uint8Array(n);
  const minCells = Math.max(3, Math.round(S * S * 1.2));
  const minDepth = 0.007;
  const outlets: number[] = []; // where rivers leave full lakes
  for (const b of basins) {
    if (b.deepest < minDepth || b.cells.length < minCells) {
      // Too small to hold a lake: filled in, so water runs on across it.
      for (const c of b.cells) hts[c] = fe[c];
      continue;
    }
    // Rain gathered over everything draining into the basin, against what its surface loses.
    let inflow = 0;
    for (const c of b.cells) inflow = Math.max(inflow, q[c]);
    let wet = 0;
    for (const c of b.cells) wet += moisture[tileOf(c)];
    wet /= b.cells.length;
    const evap = (0.15 + 0.9 * Math.max(0, 1 - wet)) * perCell;
    if (inflow >= evap * b.cells.length * 1.15) {
      // Full to the brim, spilling over the outlet.
      for (const c of b.cells) {
        isLake[c] = 1;
        lakeLevel[c] = b.level;
      }
      if (b.outlet >= 0 && !isSea[b.outlet]) outlets.push(b.outlet);
      continue;
    }
    // A lake with no outlet: it fills from the bottom until evaporation matches the inflow.
    const sorted = b.cells.slice().sort((x, y) => hts[x] - hts[y]);
    const fill = Math.min(sorted.length, Math.floor(inflow / evap));
    // Its water stays in the basin: inside, water runs down to the lowest ground.
    for (const c of b.cells) recv[c] = steepest(c, hts);
    if (fill < minCells) {
      for (const c of sorted.slice(0, Math.max(minCells, Math.round(sorted.length * 0.3)))) saltCell[c] = 1;
      continue;
    }
    const level = hts[sorted[fill - 1]];
    for (let i = 0; i < fill; i++) {
      isLake[sorted[i]] = 1;
      lakeLevel[sorted[i]] = level;
    }
    for (const c of sorted.slice(fill, Math.min(sorted.length, fill + Math.round(fill * 0.4)))) saltCell[c] = 1;
  }
  gather();

  // --- 4. Rivers: where enough water gathers, plus every lake's outflow and any marked sources.
  const thr = water > 0 ? (threshold * 2.2) / water : Infinity;
  const forced = new Uint8Array(n);
  const force = (start: number) => {
    let c = start;
    let guard = 0;
    while (c >= 0 && !isSea[c] && !isLake[c] && !forced[c] && guard++ < n) {
      forced[c] = 1;
      c = recv[c];
    }
  };
  if (water > 0) for (const c of outlets) force(c);
  for (const [sx, sy] of opts.sources ?? []) {
    const X = Math.round((sx + 0.5) * S - 0.5);
    const Y = Math.round((sy + 0.5) * S - 0.5);
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    force(Y * W + X);
  }
  // Rivers the world lives by (towns, boats, trade) need real water; the map draws the whole tree
  // of streams feeding them too, as Gaea's Rivers node does, each as wide as the water it carries.
  const isRiver = (c: number) => !isSea[c] && !isLake[c] && (q[c] >= thr || forced[c] === 1);
  const drawThr = thr * 0.12;
  const isStream = (c: number) => !isSea[c] && !isLake[c] && (q[c] >= drawThr || forced[c] === 1);
  // A forced stretch carries at least a small river's water.
  const flowOf = (c: number) => Math.max(q[c], forced[c] ? thr * 0.6 : 0);

  // Lines: from each stream's source down its main stem, ending on the sea, a lake, or the stream
  // it joins. Where two meet, the one carrying more water carries on and the other ends there.
  const main = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    if (!isStream(c)) continue;
    const d = recv[c];
    if (d < 0 || !isStream(d)) continue;
    if (main[d] < 0 || flowOf(c) > flowOf(main[d])) main[d] = c;
  }
  const lines: { cells: number[]; end: number }[] = [];
  for (let c = 0; c < n; c++) {
    if (!isStream(c) || main[c] >= 0) continue;
    const cells: number[] = [];
    let cur = c;
    let end = -1;
    for (let guard = 0; guard < n; guard++) {
      cells.push(cur);
      const d = recv[cur];
      if (d < 0) break;
      if (!isStream(d) || main[d] !== cur) {
        end = d;
        break;
      }
      cur = d;
    }
    // Rills shorter than a tile are left off: they would only speckle the slopes.
    const joins = end >= 0 && isStream(end);
    if (joins && !forced[c] && cells.length < S) continue;
    lines.push({ cells, end });
  }

  // --- 5. Downcutting: each river keeps falling, cut down through any rise in its way.
  if (downcut > 0) {
    for (const { cells } of lines) {
      let ceiling = Infinity;
      for (const c of cells) {
        if (hts[c] > ceiling) hts[c] -= (hts[c] - ceiling) * downcut;
        ceiling = Math.min(ceiling, hts[c]);
      }
    }
  }

  // --- 6. Channels cut into the valley floor, wider and deeper as the river grows.
  const size = (v: number) => Math.sqrt(Math.max(v, threshold * 0.02) / threshold);
  const wid = (v: number) => Math.min(0.32, Math.max(0.012, size(v) * 0.06)) * widthK;
  for (const { cells } of lines) {
    for (const c of cells) {
      const r = Math.max(1, wid(flowOf(c)) * S * 1.5);
      const depth = Math.min(0.03, 0.006 * size(flowOf(c))) * depthK;
      const X = c % W;
      const Y = (c - X) / W;
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = X + dx;
          const y = Y + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const j = y * W + x;
          if (isSea[j] || isLake[j]) continue;
          const d = Math.hypot(dx, dy) / r;
          if (d >= 1) continue;
          const target = hts[c] - depth * (1 - d * d);
          if (target < hts[j]) hts[j] = Math.max(0.0005, hts[j] + (target - hts[j]) * (d === 0 ? 1 : 0.6));
        }
      }
    }
  }

  // --- 7. For the world: river tiles, lake tiles, salt flats; and the lakes' shores for drawing.
  const river = new Float32Array(w * h);
  const lakeCount = new Uint16Array(w * h);
  const cellCount = new Uint16Array(w * h);
  const saltCount = new Uint16Array(w * h);
  for (let c = 0; c < n; c++) {
    const t = tileOf(c);
    cellCount[t]++;
    if (isLake[c]) lakeCount[t]++;
    if (saltCell[c]) saltCount[t]++;
  }
  const lake = new Uint8Array(w * h);
  const salt = new Uint8Array(w * h);
  for (let t = 0; t < w * h; t++) {
    if (lakeCount[t] * 2.2 >= cellCount[t]) lake[t] = 1;
    else if (saltCount[t] * 2 >= cellCount[t]) salt[t] = 1;
  }
  for (const { cells } of lines) {
    for (const c of cells) {
      const t = tileOf(c);
      if (lake[t]) continue;
      if (!isRiver(c)) continue;
      const v = Math.max(flowOf(c), threshold * 0.5);
      if (v > river[t]) river[t] = v;
    }
  }
  // Signed distance to the nearest lake shore, in tiles: positive on the water.
  const sd = new Float32Array(n).fill(-3);
  const R = Math.max(2, Math.ceil(S * 2));
  for (let c = 0; c < n; c++) {
    const X = c % W;
    const Y = (c - X) / W;
    let near = false;
    for (let d = 0; d < 4 && !near; d++) {
      const x = X + DX[d] * R;
      const y = Y + DY[d] * R;
      if (x >= 0 && y >= 0 && x < W && y < H && isLake[y * W + x] !== isLake[c]) near = true;
    }
    if (!near && !isLake[c]) {
      // Look a little closer too.
      for (let dy = -R; dy <= R && !near; dy += Math.max(1, R >> 1)) {
        for (let dx = -R; dx <= R; dx += Math.max(1, R >> 1)) {
          const x = X + dx;
          const y = Y + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && isLake[y * W + x]) {
            near = true;
            break;
          }
        }
      }
    }
    if (!near) {
      sd[c] = isLake[c] ? 3 : -3;
      continue;
    }
    let best = R + 1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = X + dx;
        const y = Y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (isLake[y * W + x] !== isLake[c]) best = Math.min(best, Math.hypot(dx, dy));
      }
    }
    const dist = (best - 0.5) / S;
    sd[c] = isLake[c] ? Math.min(3, dist) : -Math.min(3, dist);
  }
  relief.lakeSd = sd;
  relief.lake = isLake;

  // --- 8. The curves to draw: smooth, winding a little where the land is flat.
  const meander = new Noise2D(rng.fork('meander'));
  const pt = (c: number): [number, number] => [((c % W) + 0.5) / S - 0.5, (Math.floor(c / W) + 0.5) / S - 0.5];
  const out: number[] = [];
  let lineNo = 0;
  for (const { cells, end } of lines) {
    lineNo++;
    const pts: [number, number, number][] = cells.map((c) => [...pt(c), flowOf(c)] as [number, number, number]);
    if (end >= 0) {
      // On into the sea, the lake, or the river it joins.
      const [x, y] = pt(end);
      pts.push([x, y, flowOf(cells[cells.length - 1])]);
    }
    if (pts.length < 2) continue;
    let line = pts.filter((_, i) => i === 0 || i === pts.length - 1 || i % S === 0);
    for (let pass = 0; pass < 2; pass++) {
      if (line.length < 3) break;
      const next: [number, number, number][] = [line[0]];
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        if (i > 0) next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2]]);
        if (i < line.length - 2) next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, b[2]]);
      }
      next.push(line[line.length - 1]);
      line = next;
    }
    let along = 0;
    for (let i = 1; i < line.length - 1; i++) {
      const a = line[i - 1];
      const b = line[i + 1];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      along += Math.hypot(line[i][0] - a[0], line[i][1] - a[1]);
      const hx = Math.round((line[i][0] + 0.5) * S - 0.5);
      const hy = Math.round((line[i][1] + 0.5) * S - 0.5);
      if (hx < 1 || hy < 1 || hx >= W - 1 || hy >= H - 1) continue;
      const c = hy * W + hx;
      const slope = Math.hypot(hts[c + 1] - hts[c - 1], hts[c + W] - hts[c - W]) * S;
      const flat = Math.max(0, 1 - slope / 0.15);
      const ends = Math.min(1, i / 4, (line.length - 1 - i) / 4);
      const amp = Math.min(0.3, 0.06 + wid(line[i][2]) * 0.8) * flat * ends;
      const off = meander.noise(along * 0.55, lineNo * 3.1) * amp;
      line[i][0] += (-ty / tl) * off;
      line[i][1] += (tx / tl) * off;
    }
    if (line.length === 2) {
      const [a, b] = line;
      out.push(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, b[0], b[1], wid(a[2]));
      continue;
    }
    for (let i = 1; i < line.length - 1; i++) {
      const a = line[i - 1];
      const p = line[i];
      const b = line[i + 1];
      const sx = i === 1 ? a[0] : (a[0] + p[0]) / 2;
      const sy = i === 1 ? a[1] : (a[1] + p[1]) / 2;
      const ex = i === line.length - 2 ? b[0] : (p[0] + b[0]) / 2;
      const ey = i === line.length - 2 ? b[1] : (p[1] + b[1]) / 2;
      out.push(sx, sy, p[0], p[1], ex, ey, wid(p[2]));
    }
  }
  return { river, curves: Float32Array.from(out), lake, salt };
}
