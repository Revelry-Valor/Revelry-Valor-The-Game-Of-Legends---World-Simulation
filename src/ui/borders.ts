import { assembleRings, traceChains, type Chain } from '../core/trace';

export type { Chain };

/**
 * Borders for the realms' lands, drawn the way Crusader Kings draws them (the claims themselves
 * stay on the simulation's grid): a solid black line along every border, a strip of the realm's
 * colour just inside it (one on each side where two realms meet), the coast as a border too, and
 * no fill. Land taken in a war is its own region, outlined with a dashed line and a red strip.
 *
 * The claims are sampled on a finer grid (each fine point to the claim strongest round it, the
 * land and sea from the painted coast itself), the edges between different holders are traced
 * into chains running junction to junction, and each chain is smoothed once, so both sides of a
 * border, and its line, use the very same curve.
 */

export interface BorderInput {
  w: number;
  h: number;
  wrap: boolean;
  /** The grid's land, and who claims each grid point (−1 none). */
  land: Uint8Array;
  owner: Int32Array;
  /** Grid points held by an enemy in a war (their land shown as taken). */
  occupied: Set<number>;
  /** Fine points per grid point along each side, and the painted land at each fine point (null: from the grid). */
  F: number;
  fineLand: Uint8Array | null;
}


export interface BorderMap {
  F: number;
  W: number;
  H: number;
  label: Int32Array;
  /** The grid point each fine point lies in. */
  cell: Int32Array;
  chains: Chain[];
  /** Each holder's land as closed rings (fine units), for clipping its colour strip inside the border. */
  rings: Map<number, number[][]>;
}

export const UNCLAIMED = -1;
export const SEA = -2;
export const OUTSIDE = -3;
/** Land of realm `o` held by an enemy in a war. */
export const occ = (o: number) => -1000 - o;
export const isOcc = (l: number) => l <= -1000;
/** Whose land a label is (a realm, or a realm's land held by an enemy), or −1. */
export const holder = (l: number) => (l >= 0 ? l : l <= -1000 ? -1000 - l : -1);

export function borderMap(inp: BorderInput): BorderMap {
  const { w, h, wrap, land, owner, occupied, F, fineLand } = inp;
  const W = w * F;
  const H = h * F;
  const col = (i: number) => (wrap ? ((i % w) + w) % w : Math.max(0, Math.min(w - 1, i)));
  const row = (j: number) => Math.max(0, Math.min(h - 1, j));
  const lab = (k: number) => (owner[k] >= 0 && occupied.has(k) ? occ(owner[k]) : owner[k]);
  // Each grid point's claims, blurred over its 3×3 neighbours (sea not counted).
  const KW = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const CL = new Int32Array(w * h * 9);
  const CV = new Float32Array(w * h * 9);
  const CN = new Uint8Array(w * h);
  const uni = new Int32Array(w * h).fill(-99);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    const base = k * 9;
    let cnt = 0;
    let n = 0;
    let same = !!land[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const m = row(j + dj) * w + col(i + di);
      if (!land[m]) {
        same = false;
        continue;
      }
      const l = lab(m);
      if (l !== lab(k)) same = false;
      const wt = KW[(dj + 1) * 3 + (di + 1)];
      n += wt;
      let q = 0;
      while (q < cnt && CL[base + q] !== l) q++;
      if (q < cnt) CV[base + q] += wt;
      else {
        CL[base + cnt] = l;
        CV[base + cnt] = wt;
        cnt++;
      }
    }
    for (let q = 0; q < cnt; q++) CV[base + q] /= n || 1;
    CN[k] = cnt;
    if (same) uni[k] = lab(k);
  }
  const label = new Int32Array(W * H);
  const cell = new Int32Array(W * H);
  const accL = new Int32Array(40);
  const accV = new Float32Array(40);
  let accN = 0;
  const addCell = (ii: number, jj: number, wt: number) => {
    if (wt <= 0) return;
    const c = row(jj) * w + col(ii);
    for (let q = 0; q < CN[c]; q++) {
      const l = CL[c * 9 + q];
      let r = 0;
      while (r < accN && accL[r] !== l) r++;
      if (r < accN) accV[r] += CV[c * 9 + q] * wt;
      else {
        accL[accN] = l;
        accV[accN] = CV[c * 9 + q] * wt;
        accN++;
      }
    }
  };
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const q0 = Y * W + X;
    const u = (X + 0.5) / F - 0.5;
    const v = (Y + 0.5) / F - 0.5;
    const ci = col(Math.round(u));
    const cj = row(Math.round(v));
    const c0 = cj * w + ci;
    cell[q0] = c0;
    // Land or sea: the painted coast where we have it.
    const isLand = fineLand ? !!fineLand[q0] : !!land[c0];
    if (!isLand) {
      label[q0] = SEA;
      continue;
    }
    if (uni[c0] !== -99 && (!fineLand || land[c0])) {
      label[q0] = uni[c0];
      continue;
    }
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const fu = u - i0;
    const fv = v - j0;
    accN = 0;
    addCell(i0, j0, (1 - fu) * (1 - fv));
    addCell(i0 + 1, j0, fu * (1 - fv));
    addCell(i0, j0 + 1, (1 - fu) * fv);
    addCell(i0 + 1, j0 + 1, fu * fv);
    if (!accN) {
      // Painted land the grid counts as sea: whoever claims the nearest grid land.
      let best = UNCLAIMED;
      let bd = 9;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const m = row(cj + dj) * w + col(ci + di);
        const d = di * di + dj * dj;
        if (land[m] && d < bd) [best, bd] = [lab(m), d];
      }
      label[q0] = best;
      continue;
    }
    let best = UNCLAIMED;
    let bv = 0;
    for (let q = 0; q < accN; q++) if (accV[q] > bv) [best, bv] = [accL[q], accV[q]];
    label[q0] = best;
  }
  const chains = traceChains(label, W, H, wrap, held, OUTSIDE);
  return { F, W, H, label, cell, chains, rings: assembleRings(chains, W, wrap, held) };
}

const held = (l: number) => l >= 0 || l <= -1000;
