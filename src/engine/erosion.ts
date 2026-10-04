import { Noise2D } from './noise';
import { Rng } from './rng';

/** A finer height field laid over the map's tiles: `scale` cells to a tile in each direction. */
export interface ReliefField {
  heights: Float32Array;
  width: number;
  height: number;
  scale: number;
}

export interface ErosionOptions {
  /** Cells per tile in each direction. */
  scale?: number;
  /** Rounds of carving on the full grid. */
  iterations?: number;
  /** Rounds of carving the big valleys, on a grid half as fine. */
  coarseIterations?: number;
  /** How hard running water cuts. */
  strength?: number;
  seed?: number;
  /** How much slopes creep between streams (rounds off the finest rills). */
  creep?: number;
  /** How strongly cutting grows with the water a stream carries. */
  exponent?: number;
  /** How rough the high ground is before it is carved (the shapes erosion works into ridges). */
  roughness?: number;
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

/**
 * Carve the land the way water does, as terrain programs (Wilbur, Gaea) erode a heightmap. The tile
 * heights are first laid out on a finer grid, roughened with ridged noise in the high ground (so the
 * water has something to bite on), then worked over in rounds: rain runs downhill to the sea or a
 * lake, gathers into streams, and each stream cuts down in proportion to the water it carries and
 * the slope it runs on. Valleys branch up into the mountains and what stands between them is left
 * as sharp ridges and spurs running down from the crests. Coasts and lakes stay where they are.
 *
 * `water` marks tiles that are sea or lake: they are where the water ends up and are not carved.
 */
export function erodeRelief(surface: Float32Array, water: Uint8Array, w: number, h: number, opts: ErosionOptions = {}): ReliefField {
  const s = opts.scale ?? 4;
  const iters = opts.iterations ?? 12;
  const coarseIters = opts.coarseIterations ?? 30;
  const K = opts.strength ?? 0.03;
  const D = opts.creep ?? 0.03;
  const M = opts.exponent ?? 0.5;
  const rough = opts.roughness ?? 0.3;
  const W = w * s;
  const H = h * s;
  const n = W * H;
  const hts = new Float32Array(n);
  const fixed = new Uint8Array(n);
  const rng = new Rng(opts.seed ?? 1);
  const ridged = new Noise2D(rng.fork('relief-ridges'));
  const grain = new Noise2D(rng.fork('relief-grain'));
  const tile = (x: number, y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x);
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

  // Lay the tiles out on the fine grid, smoothly, and roughen the high ground.
  for (let Y = 0; Y < H; Y++) {
    const fy = (Y + 0.5) / s - 0.5;
    const y1 = Math.floor(fy);
    const ty = fy - y1;
    for (let X = 0; X < W; X++) {
      const fx = (X + 0.5) / s - 0.5;
      const x1 = Math.floor(fx);
      const tx = fx - x1;
      const i = Y * W + X;
      const t = tile(Math.round(fx), Math.round(fy));
      if (water[t]) {
        fixed[i] = 1;
        hts[i] = Math.max(0, surface[t]);
        continue;
      }
      const row = (yy: number) => cr(surface[tile(x1 - 1, yy)], surface[tile(x1, yy)], surface[tile(x1 + 1, yy)], surface[tile(x1 + 2, yy)], tx);
      const v = Math.max(0.001, cr(row(y1 - 1), row(y1), row(y1 + 1), row(y1 + 2), ty));
      // Ridged noise, strongest on high ground: the rough shapes erosion works into ridges.
      let r = 0;
      let amp = 1;
      let f = 0.09;
      for (let o = 0; o < 4; o++) {
        r += (1 - Math.abs(ridged.noise(fx * f * s / 4 + o * 17, fy * f * s / 4 - o * 9))) * amp;
        amp *= 0.5;
        f *= 2.1;
      }
      const high = smooth(0.06, 0.45, v);
      hts[i] = v + (r / 1.875 - 0.55) * rough * high * v + grain.noise(fx * 2.3, fy * 2.3) * 0.003;
      if (hts[i] < 0.001) hts[i] = 0.001;
    }
  }

  // Big valleys first, on a grid half as fine (quicker, and water gathers from further), then the
  // finer gullies on the full grid.
  const cs = Math.max(1, s >> 1);
  if (cs < s) {
    const f = s / cs;
    const CW = w * cs;
    const CH = h * cs;
    const coarse = new Float32Array(CW * CH);
    const cfixed = new Uint8Array(CW * CH);
    for (let Y = 0; Y < CH; Y++) {
      for (let X = 0; X < CW; X++) {
        let sum = 0;
        let fx = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
          const i = (Y * f + dy) * W + X * f + dx;
          sum += hts[i];
          fx += fixed[i];
        }
        coarse[Y * CW + X] = sum / (f * f);
        cfixed[Y * CW + X] = fx * 2 >= f * f ? 1 : 0;
      }
    }
    const before = Float32Array.from(coarse);
    erodeGrid(coarse, cfixed, CW, CH, coarseIters, K, D, M, rng);
    // Carry the change down to the fine grid, smoothly.
    for (let Y = 0; Y < H; Y++) {
      const cy = Math.min(CH - 1, Math.max(0, (Y + 0.5) / f - 0.5));
      const y0 = Math.floor(cy);
      const y1 = Math.min(CH - 1, y0 + 1);
      const ty = cy - y0;
      for (let X = 0; X < W; X++) {
        const i = Y * W + X;
        if (fixed[i]) continue;
        const cx = Math.min(CW - 1, Math.max(0, (X + 0.5) / f - 0.5));
        const x0 = Math.floor(cx);
        const x1 = Math.min(CW - 1, x0 + 1);
        const tx = cx - x0;
        const d = (k: number) => coarse[k] - before[k];
        const v = (d(y0 * CW + x0) * (1 - tx) + d(y0 * CW + x1) * tx) * (1 - ty) + (d(y1 * CW + x0) * (1 - tx) + d(y1 * CW + x1) * tx) * ty;
        hts[i] = Math.max(0.001, hts[i] + v);
      }
    }
  }
  erodeGrid(hts, fixed, W, H, iters, K, D, M, rng);
  // Soften the grid's stair-steps in the stream beds, so close in they read as valleys, not pixels.
  const tmp = Float32Array.from(hts);
  for (let Y = 1; Y < H - 1; Y++) {
    for (let X = 1; X < W - 1; X++) {
      const i = Y * W + X;
      if (fixed[i]) continue;
      const b = (4 * tmp[i] + 2 * (tmp[i - 1] + tmp[i + 1] + tmp[i - W] + tmp[i + W]) + tmp[i - W - 1] + tmp[i - W + 1] + tmp[i + W - 1] + tmp[i + W + 1]) / 16;
      hts[i] = tmp[i] * 0.4 + b * 0.6;
    }
  }
  return { heights: hts, width: W, height: H, scale: s };
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
