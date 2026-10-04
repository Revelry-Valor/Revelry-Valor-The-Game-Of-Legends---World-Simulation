import { Noise2D } from '../engine/noise';
import { Rng } from '../engine/rng';

const warpNoise = new Noise2D(new Rng(13).fork('border-warp'));
const warpCache = new Map<string, Int32Array>();

/**
 * For each cell of a finer grid (`f` cells per tile each way), the tile its gently warped position
 * falls in. Borders read from this wander like natural ones instead of following the tile grid.
 * The warp never changes, so it is worked out once per map size.
 */
export function warpIndex(w: number, h: number, f: number, amount = 0.8): Int32Array {
  const key = `${w}:${h}:${f}:${amount}`;
  const hit = warpCache.get(key);
  if (hit) return hit;
  const W = w * f;
  const H = h * f;
  const out = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    const my = (y + 0.5) / f;
    for (let x = 0; x < W; x++) {
      const mx = (x + 0.5) / f;
      const tx = Math.floor(mx + warpNoise.fbm(mx * 0.3, my * 0.3, 3) * amount);
      const ty = Math.floor(my + warpNoise.fbm(mx * 0.3 + 71, my * 0.3 + 29, 3) * amount);
      out[y * W + x] = (ty < 0 ? 0 : ty >= h ? h - 1 : ty) * w + (tx < 0 ? 0 : tx >= w ? w - 1 : tx);
    }
  }
  warpCache.set(key, out);
  return out;
}

/** Labels (one per tile) spread onto the warped finer grid. */
export function warpLabels(labels: Int32Array, w: number, h: number, f: number): Int32Array {
  const index = warpIndex(w, h, f);
  const out = new Int32Array(index.length);
  for (let i = 0; i < index.length; i++) out[i] = labels[index[i]];
  return out;
}

/**
 * The label at every pixel of a view. Each pixel weighs the nine fine cells around it with a soft
 * tent-shaped kernel and takes whichever label has the most weight there, so the boundary between
 * two regions is a smooth curve rather than a staircase of cells. Every pixel belongs to exactly
 * one region, so a border can never twist or cross itself: it is simply where one region's pixels
 * meet another's.
 */
export function pixelLabels(fine: Int32Array, FW: number, FH: number, f: number, x0: number, y0: number, step: number, W: number, H: number, into?: Int32Array): Int32Array {
  const out: Int32Array = into ?? new Int32Array(W * H);
  const labs = new Int32Array(9);
  const wts = new Float64Array(9);
  for (let py = 0; py < H; py++) {
    const v = (y0 + (py + 0.5) * step) * f - 0.5;
    const cj = Math.min(FH - 1, Math.max(0, Math.round(v)));
    for (let px = 0; px < W; px++) {
      const u = (x0 + (px + 0.5) * step) * f - 0.5;
      const ci = Math.min(FW - 1, Math.max(0, Math.round(u)));
      const first = fine[cj * FW + ci];
      // Quick path: deep inside a region.
      let same = true;
      for (let dj = -1; dj <= 1 && same; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= FH) continue;
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          if (i >= 0 && i < FW && fine[j * FW + i] !== first) {
            same = false;
            break;
          }
        }
      }
      if (same) {
        out[py * W + px] = first;
        continue;
      }
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= FH) continue;
        const ky = 1.5 - Math.abs(v - j);
        if (ky <= 0) continue;
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          if (i < 0 || i >= FW) continue;
          const kx = 1.5 - Math.abs(u - i);
          if (kx <= 0) continue;
          const l = fine[j * FW + i];
          const wgt = kx * ky;
          let k = 0;
          while (k < n && labs[k] !== l) k++;
          if (k === n) {
            labs[n] = l;
            wts[n] = 0;
            n++;
          }
          wts[k] += wgt;
        }
      }
      let best = first;
      let bw = -1;
      for (let k = 0; k < n; k++) {
        if (wts[k] > bw) {
          bw = wts[k];
          best = labs[k];
        }
      }
      out[py * W + px] = best;
    }
  }
  return out;
}

export interface RegionStyle {
  /** RGBA for each label's fill (alpha 0..255); labels without one are left clear. */
  fill: (label: number) => [number, number, number, number] | null;
  /** Border colour and width in pixels. */
  border: [number, number, number, number];
  width: number;
}

/**
 * Paint fills and borders for a view. `held` is who holds each pixel's land; `control` is who
 * holds it in fact (an occupier, during a war). Borders between holders are solid; the edge of
 * land occupied in a war is dotted, and the occupied land is striped with the occupier's colour.
 */
export function paintRegions(img: ImageData, held: Int32Array, control: Int32Array, style: RegionStyle): void {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  const [br, bg, bb, ba] = style.border;
  const half = Math.max(1, Math.round(style.width / 2));
  const cache = new Map<number, [number, number, number, number] | null>();
  const fillOf = (l: number) => {
    let c = cache.get(l);
    if (c === undefined) {
      c = l === -1 ? null : style.fill(l);
      cache.set(l, c);
    }
    return c;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      const h = held[i];
      const c = control[i];
      // Borders: any pixel within `half` of a change of holder (solid) or of controller (dotted).
      let solid = false;
      let dotted = false;
      for (let k = 1; k <= half && !solid; k++) {
        const back = k < half;
        if ((x + k < W && held[i + k] !== h) || (y + k < H && held[i + k * W] !== h) || (back && ((x - k >= 0 && held[i - k] !== h) || (y - k >= 0 && held[i - k * W] !== h)))) solid = true;
        else if ((x + k < W && control[i + k] !== c) || (y + k < H && control[i + k * W] !== c) || (back && ((x - k >= 0 && control[i - k] !== c) || (y - k >= 0 && control[i - k * W] !== c)))) dotted = true;
      }
      if (solid) {
        d[o] = br;
        d[o + 1] = bg;
        d[o + 2] = bb;
        d[o + 3] = ba;
        continue;
      }
      if (dotted && ((x >> 2) + (y >> 2)) % 2 === 0) {
        d[o] = 250;
        d[o + 1] = 250;
        d[o + 2] = 245;
        d[o + 3] = 235;
        continue;
      }
      // Occupied land: stripes of the occupier's colour over the holder's.
      const f = c !== h && ((x + y) >> 3) % 2 === 0 ? fillOf(c) : fillOf(h);
      if (!f) {
        d[o + 3] = 0;
        continue;
      }
      d[o] = f[0];
      d[o + 1] = f[1];
      d[o + 2] = f[2];
      d[o + 3] = f[3];
    }
  }
}

/** A ring of pixels around one label's land (for the selected nation's outline), `width` pixels wide. */
export function paintOutline(img: ImageData, labels: Int32Array, target: number, color: [number, number, number], width: number, dashed = false): void {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const inside = labels[i] === target;
      let edge = false;
      for (let k = 1; k <= width && !edge; k++) {
        if ((x + k < W && (labels[i + k] === target) !== inside) || (x - k >= 0 && (labels[i - k] === target) !== inside)) edge = true;
        else if ((y + k < H && (labels[i + k * W] === target) !== inside) || (y - k >= 0 && (labels[i - k * W] === target) !== inside)) edge = true;
      }
      if (!edge || (dashed && ((x >> 2) + (y >> 2)) % 2 === 1)) continue;
      const o = i * 4;
      d[o] = color[0];
      d[o + 1] = color[1];
      d[o + 2] = color[2];
      d[o + 3] = 245;
    }
  }
}
