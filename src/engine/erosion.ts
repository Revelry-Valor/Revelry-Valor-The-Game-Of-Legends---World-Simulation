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
  /** 1 for cells under water (sea or lake): the erosion's outlets, left uncarved. */
  water: Uint8Array;
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
}

/** A min-heap of cell indices ordered by height. */
class CellHeap {
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
function addMountains(g: Grid, s: number, rng: Rng, amount: number): void {
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
      if (mass <= 0) {
        hts[i] = v + grain.noise(X * 0.6 / s, Y * 0.6 / s) * 0.003;
        continue;
      }
      // In tiles, warped.
      const tx = (X + 0.5) / s + warp.fbm(X * 0.05 / s, Y * 0.05 / s, 3) * 3;
      const ty = (Y + 0.5) / s + warp.fbm(X * 0.05 / s + 31, Y * 0.05 / s - 17, 3) * 3;
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
function rainfall(g: Grid, rng: Rng, s: number, opts: { drops: number; strength: number; softness: number; downcutting: number }, wear: Float32Array, deposits: Float32Array, flow: Float32Array): void {
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
  const land: number[] = [];
  for (let i = 0; i < W * H; i++) if (!fixed[i]) land.push(i);
  if (!land.length) return;
  const drops = Math.floor(land.length * opts.drops);
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
  for (let n = 0; n < drops; n++) {
    const start = land[Math.floor(rng.next() * land.length)];
    let x = (start % W) + rng.next();
    let y = Math.floor(start / W) + rng.next();
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
        const a = rng.next() * Math.PI * 2;
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
function normalise(a: Float32Array, fixed: Uint8Array, W: number, H: number, curve: (v: number) => number): void {
  const vals: number[] = [];
  for (let i = 0; i < a.length; i += 7) if (!fixed[i] && a[i] > 0) vals.push(a[i]);
  vals.sort((x, y) => x - y);
  const top = vals.length ? vals[Math.floor(vals.length * 0.97)] : 1;
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
  const done = (): ReliefField => ({ heights: hts, wear, deposits, flow, water: fixed, width: W, height: H, scale: s });
  if (stage === 'layout') return done();
  addMountains(g, s, rng.fork('mountains'), opts.mountains ?? TERRAIN_DEFAULTS.mountains);
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
  erodeGrid(coarse, cfixed, CW, CH, quick ? 18 : 30, K, 0.03, 0.5, rng.fork('valleys'));
  for (let i = 0; i < cn; i++) if (was[i] > coarse[i]) cwear[i] += (was[i] - coarse[i]) * 0.5;
  if (stage === 'full') {
    rainfall(cg, rng.fork('rain'), cs, { drops: (opts.rain ?? (quick ? 1.5 : 3)) * strength, strength: Math.min(1.5, strength), softness, downcutting }, cwear, cdep, cflow);
    crumble(cg, cs, 3, cdep);
  }
  // Carry the change and the maps up to the full grid, smoothly.
  const up = (Y: number, X: number, a: Float32Array) => {
    const cy = Math.min(CH - 1, Math.max(0, (Y + 0.5) / f - 0.5));
    const cx = Math.min(CW - 1, Math.max(0, (X + 0.5) / f - 0.5));
    const y0 = Math.floor(cy);
    const x0 = Math.floor(cx);
    const y1 = Math.min(CH - 1, y0 + 1);
    const x1 = Math.min(CW - 1, x0 + 1);
    const ty = cy - y0;
    const tx = cx - x0;
    const v = (k: number) => a[k];
    return (v(y0 * CW + x0) * (1 - tx) + v(y0 * CW + x1) * tx) * (1 - ty) + (v(y1 * CW + x0) * (1 - tx) + v(y1 * CW + x1) * tx) * ty;
  };
  // The height change is carried up along smooth curves, so no creases show along the coarse cells.
  const delta = new Float32Array(cn);
  for (let i = 0; i < cn; i++) delta[i] = coarse[i] - was[i];
  const cat = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const dAt = (x: number, y: number) => delta[(y < 0 ? 0 : y >= CH ? CH - 1 : y) * CW + (x < 0 ? 0 : x >= CW ? CW - 1 : x)];
  const upSmooth = (Y: number, X: number) => {
    const cy = (Y + 0.5) / f - 0.5;
    const cx = (X + 0.5) / f - 0.5;
    const y1 = Math.floor(cy);
    const x1 = Math.floor(cx);
    const ty = cy - y1;
    const tx = cx - x1;
    const row = (yy: number) => cat(dAt(x1 - 1, yy), dAt(x1, yy), dAt(x1 + 1, yy), dAt(x1 + 2, yy), tx);
    return cat(row(y1 - 1), row(y1), row(y1 + 1), row(y1 + 2), ty);
  };
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const i = Y * W + X;
      if (fixed[i]) continue;
      hts[i] = Math.max(0.001, hts[i] + upSmooth(Y, X));
      wear[i] = up(Y, X, cwear);
      deposits[i] = up(Y, X, cdep);
      flow[i] = up(Y, X, cflow);
    }
  }
  const before = Float32Array.from(hts);
  if (!quick) erodeGrid(hts, fixed, W, H, 6, K, 0.02, 0.5, rng.fork('streams'));
  for (let i = 0; i < n; i++) if (!fixed[i] && before[i] > hts[i]) wear[i] += before[i] - hts[i];
  return finish(g, wear, deposits, flow, done);
}

/** Soften the grid's stair-steps, and scale the data maps to 0..1. */
function finish(g: Grid, wear: Float32Array, deposits: Float32Array, flow: Float32Array, done: () => ReliefField): ReliefField {
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
  normalise(wear, fixed, W, H, (v) => Math.sqrt(v));
  normalise(deposits, fixed, W, H, (v) => Math.sqrt(v));
  normalise(flow, fixed, W, H, (v) => Math.log1p(v * 20) / Math.log1p(20));
  return done();
}

/** Rounds of stream cutting and slope creep on one grid; `fixed` cells (water) are outlets. */
function erodeGrid(hts: Float32Array, fixed: Uint8Array, W: number, H: number, iters: number, K: number, D: number, M: number, rng: Rng): void {
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
  }
}

/** The rivers found on carved land: how much water each tile's river carries, and the curves to draw. */
export interface RiverNet {
  /** River discharge on each land tile (0 where no river runs), in the same units as the threshold. */
  river: Float32Array;
  /**
   * The rivers as smooth curves in tile coordinates: records of 7 numbers, a quadratic curve from
   * (x0, y0) through the control point (cx, cy) to (x1, y1), and its width in tiles.
   */
  curves: Float32Array;
}

/** Gaea's Rivers settings. */
export interface RiverOptions {
  /** How much water there is to make rivers: more headwaters, more rivers (0 none .. 1 normal .. 2). */
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
 * Rivers made as Gaea's Rivers node makes them. Rain is routed over the carved land cell by cell
 * (across lakes to their outlets, and out to the sea). Headwaters are spread over the uplands, where
 * it is high and wet, at least a few tiles apart (more of them with more Water), and any painted
 * river sources are added. From each, a river runs downhill along the way the water goes until it
 * reaches the sea or a lake (flowing on out of the lake's outlet), or joins a river already there,
 * becoming its tributary. Each river grows with the water gathered above it, winds more where the
 * land is flat, and cuts its channel into the land: wider and deeper downstream, and with
 * Downcutting, carved down through rises so it keeps falling all the way.
 */
export function traceRivers(relief: ReliefField, sea: Uint8Array, lake: Uint8Array, rain: Float32Array, w: number, h: number, threshold: number, seed = 1, opts: RiverOptions = {}): RiverNet {
  const water = opts.water ?? RIVER_DEFAULTS.water;
  const widthK = opts.width ?? RIVER_DEFAULTS.width;
  const depthK = opts.depth ?? RIVER_DEFAULTS.depth;
  const downcut = opts.downcutting ?? RIVER_DEFAULTS.downcutting;
  const { width: W, height: H, scale: S } = relief;
  const n = W * H;
  const hts = relief.heights;
  const tileOf = (c: number) => {
    const X = c % W;
    const Y = (c - X) / W;
    return Math.min(h - 1, Math.floor(Y / S)) * w + Math.min(w - 1, Math.floor(X / S));
  };
  const isSea = new Uint8Array(n);
  const isLake = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (!relief.water[c]) continue;
    if (lake[tileOf(c)]) isLake[c] = 1;
    else isSea[c] = 1;
  }
  const rng = new Rng(seed);
  const jitter = new Float32Array(n);
  for (let i = 0; i < n; i++) jitter[i] = rng.next();

  // --- Where the water goes: flood upward from the sea, then steepest way down. ---
  const fill = new Float32Array(n);
  const order = new Int32Array(n);
  const seen = new Uint8Array(n);
  const heap = new CellHeap(n);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  for (let i = 0; i < n; i++) {
    const X = i % W;
    const Y = (i - X) / W;
    if (isSea[i] || X === 0 || Y === 0 || X === W - 1 || Y === H - 1) {
      seen[i] = 1;
      fill[i] = isSea[i] ? -1 : hts[i];
      heap.push(i, fill[i]);
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
      fill[j] = Math.max(hts[j], fill[c] + 1e-6 * (1 + jitter[j]));
      heap.push(j, fill[j]);
    }
  }
  const recv = new Int32Array(n).fill(-1);
  for (let k = 0; k < count; k++) {
    const c = order[k];
    if (isSea[c]) continue;
    const X = c % W;
    const Y = (c - X) / W;
    let best = 0;
    for (let q = 0; q < 8; q++) {
      const x = X + DX[q];
      const y = Y + DY[q];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      const drop = ((fill[c] - fill[j]) / DL[q]) * (1 + 0.5 * jitter[(j * 7 + c * 13) % n]);
      if (drop > best) {
        best = drop;
        recv[c] = j;
      }
    }
  }
  const q = new Float32Array(n);
  const perCell = 1 / (S * S);
  for (let c = 0; c < n; c++) if (!isSea[c]) q[c] = rain[tileOf(c)] * perCell;
  for (let k = count - 1; k >= 0; k--) {
    const c = order[k];
    const r = recv[c];
    if (r >= 0) q[r] += q[c];
  }

  // --- Headwaters: high, wet ground, spread out; and any painted sources. ---
  const heads: number[] = [];
  const taken = new Uint8Array(w * h);
  const spacing = 5; // tiles between headwaters
  const claim = (c: number) => {
    const t = tileOf(c);
    const tx = t % w;
    const ty = (t - tx) / w;
    for (let dy = -spacing; dy <= spacing; dy++) {
      for (let dx = -spacing; dx <= spacing; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && dx * dx + dy * dy <= spacing * spacing) taken[y * w + x] = 1;
      }
    }
  };
  for (const [sx, sy] of opts.sources ?? []) {
    const X = Math.round((sx + 0.5) * S - 0.5);
    const Y = Math.round((sy + 0.5) * S - 0.5);
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const c = Y * W + X;
    if (relief.water[c]) continue;
    heads.push(c);
  }
  let land = 0;
  let top = 0;
  for (let c = 0; c < n; c++) {
    if (relief.water[c]) continue;
    land++;
    if (hts[c] > top) top = hts[c];
  }
  const want = Math.round((land / (S * S)) * 0.0055 * water);
  if (want > 0 && top > 0) {
    // Candidates weighted by height and rain, drawn at random; too close to another, passed over.
    const cand: number[] = [];
    const weight: number[] = [];
    for (let c = 0; c < n; c += 3) {
      if (relief.water[c]) continue;
      const hn = hts[c] / top;
      const wgt = Math.pow(Math.max(0, hn - 0.12), 1.5) * rain[tileOf(c)];
      if (wgt <= 0) continue;
      cand.push(c);
      weight.push(wgt);
    }
    // Weighted shuffle: each candidate keyed by random^(1/weight), best keys first.
    const keyed = cand.map((c, i) => [Math.pow(rng.next(), 1 / weight[i]), c] as [number, number]).sort((a, b) => b[0] - a[0]);
    for (const c of heads) claim(c);
    let added = 0;
    for (const [, c] of keyed) {
      if (added >= want) break;
      if (taken[tileOf(c)]) continue;
      heads.push(c);
      claim(c);
      added++;
    }
  }

  // --- Run each river down to the sea, a lake, or a river already there. ---
  const onRiver = new Int32Array(n).fill(-1); // index of the river line a cell belongs to
  const lines: number[][] = [];
  // Big rivers first, so tributaries join them rather than the other way round.
  heads.sort((a, b) => hts[b] - hts[a]);
  for (const head of heads) {
    if (onRiver[head] >= 0) continue;
    const path: number[] = [];
    let cur = head;
    let guard = 0;
    while (cur >= 0 && guard++ < n) {
      path.push(cur);
      if (isSea[cur]) break;
      if (onRiver[cur] >= 0 && cur !== head) break;
      onRiver[cur] = lines.length;
      cur = recv[cur];
    }
    lines.push(path);
  }

  // --- Downcutting: each river keeps falling, cut down through any rise in its way. ---
  if (downcut > 0) {
    for (const path of lines) {
      // From the mouth upward, each cell no lower than the one below it.
      let floor = -Infinity;
      for (let i = path.length - 1; i >= 0; i--) {
        const c = path[i];
        if (relief.water[c]) {
          floor = hts[c];
          continue;
        }
        if (hts[c] < floor) hts[c] = floor + 1e-5;
        floor = hts[c];
      }
      // From the source downward, cut away rises so the bed only ever falls.
      let ceiling = Infinity;
      for (const c of path) {
        if (relief.water[c]) {
          ceiling = Infinity;
          continue;
        }
        if (hts[c] > ceiling) hts[c] -= (hts[c] - ceiling) * downcut;
        ceiling = Math.min(ceiling, hts[c]);
      }
    }
  }

  // --- Channels: cut into the land, wider and deeper as the river grows. ---
  const size = (v: number) => Math.sqrt(Math.max(v, threshold * 0.2) / threshold);
  const wid = (v: number) => Math.min(0.32, Math.max(0.05, size(v) * 0.07)) * widthK;
  for (const path of lines) {
    for (const c of path) {
      if (relief.water[c]) continue;
      const r = Math.max(1, wid(q[c]) * S * 1.5);
      const depth = Math.min(0.035, 0.007 * size(q[c])) * depthK;
      const X = c % W;
      const Y = (c - X) / W;
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = X + dx;
          const y = Y + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const j = y * W + x;
          if (relief.water[j]) continue;
          const d = Math.hypot(dx, dy) / r;
          if (d >= 1) continue;
          const target = hts[c] - depth * (1 - d * d);
          if (target < hts[j]) hts[j] = Math.max(0.0005, hts[j] + (target - hts[j]) * (d === 0 ? 1 : 0.6));
        }
      }
    }
  }

  // --- What the world lives by: the tiles each river runs through. ---
  const river = new Float32Array(w * h);
  for (const path of lines) {
    for (const c of path) {
      if (relief.water[c]) continue;
      const t = tileOf(c);
      const v = Math.max(q[c], threshold * 0.5);
      if (v > river[t]) river[t] = v;
    }
  }

  // --- The curves to draw: smooth, winding where the land is flat. ---
  const meander = new Noise2D(rng.fork('meander'));
  const pt = (c: number): [number, number] => [((c % W) + 0.5) / S - 0.5, (Math.floor(c / W) + 0.5) / S - 0.5];
  const out: number[] = [];
  const emit = (cells: number[], joinEnd: number) => {
    if (cells.length < 2 && joinEnd < 0) return;
    const pts: [number, number, number][] = cells.map((c) => [...pt(c), q[c]] as [number, number, number]);
    if (joinEnd >= 0) {
      const [x, y] = pt(joinEnd);
      pts.push([x, y, q[cells[cells.length - 1]]]);
    }
    if (pts.length < 2) return;
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
    // Meanders: a gentle sideways swing on flat ground, bigger for bigger rivers, never at the ends.
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
      const amp = Math.min(0.45, 0.12 + wid(line[i][2]) * 1.2) * flat * ends;
      const off = meander.noise(along * 0.55, (cellsKey(cells) % 97) * 3.1) * amp;
      line[i][0] += (-ty / tl) * off;
      line[i][1] += (tx / tl) * off;
    }
    if (line.length === 2) {
      const [a, b] = line;
      out.push(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, b[0], b[1], wid(a[2]));
      return;
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
  };
  const cellsKey = (cells: number[]) => cells[0];
  for (const path of lines) {
    // Drawn in runs over the land, broken where the river crosses a lake; each run ends on the
    // water it flows into, or on the river it joins.
    let run: number[] = [];
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (relief.water[c]) {
        if (run.length) emit(run, c);
        run = [];
        continue;
      }
      run.push(c);
    }
    if (run.length) {
      const last = run[run.length - 1];
      const d = recv[last];
      emit(run, d >= 0 && onRiver[d] >= 0 && onRiver[d] !== onRiver[last] ? d : -1);
    }
  }
  return { river, curves: Float32Array.from(out) };
}
