/**
 * Natural borders for the realms' lands (drawn, not simulated: the claims themselves stay on the
 * simulation's grid).
 *
 * Each realm's claim is blurred into a smooth field, the fields are sampled on a finer grid at
 * places nudged by gentle low-frequency noise (so edges wander the way real borders do, rather
 * than running along the grid), and each fine point goes to the realm whose field is strongest
 * there. The border lines between them are traced and smoothed into curves.
 */

export interface LandInput {
  w: number;
  h: number;
  wrap: boolean;
  land: Uint8Array;
  owner: Int32Array;
  seed: number;
}

export interface NaturalLands {
  /** Fine points per grid point along each side. */
  F: number;
  W: number;
  H: number;
  /** Who holds each fine point: a realm (clan id), −1 unclaimed land, −2 sea. */
  label: Int32Array;
  /** The cell each fine point lies in (for things kept per cell: occupation, contested land). */
  cell: Int32Array;
  /** Border lines, as polylines of [x, y] in fine units (0 … W, 0 … H); between realms, and a realm and unclaimed land (not the coast). */
  lines: number[][];
  /** Each realm's land as closed smooth rings (fine units), to fill with the even-odd rule (holes are rings too). */
  rings: Map<number, number[][]>;
}

const SEA = -2;

function hash(seed: number, x: number, y: number): number {
  let t = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return (((t ^ (t >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}
/** Smooth value noise in −1 … 1, period-free, at a given scale (grid points per wave). */
function noise(seed: number, x: number, y: number, scale: number): number {
  const u = x / scale;
  const v = y / scale;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(seed, i, j);
  const b = hash(seed, i + 1, j);
  const c = hash(seed, i, j + 1);
  const d = hash(seed, i + 1, j + 1);
  const su = s(fu);
  return a + (b - a) * su + (c - a + (d - c - b + a) * su) * s(fv);
}

export function naturalLands(inp: LandInput, fine = 4): NaturalLands {
  const { w, h, wrap, land, owner, seed } = inp;
  const F = Math.max(2, Math.min(4, fine));
  const W = w * F;
  const H = h * F;
  const col = (i: number) => (wrap ? ((i % w) + w) % w : Math.max(0, Math.min(w - 1, i)));
  const rowOk = (j: number) => Math.max(0, Math.min(h - 1, j));
  // Each cell's blurred claims: up to 9 (label, weight) pairs from its 3×3 neighbourhood (sea not counted), in flat arrays.
  const K = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const CL = new Int32Array(w * h * 9);
  const CV = new Float32Array(w * h * 9);
  const CN = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const base = (j * w + i) * 9;
    let cnt = 0;
    let n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const m = rowOk(j + dj) * w + col(i + di);
      if (!land[m]) continue;
      const lab = owner[m];
      const wt = K[(dj + 1) * 3 + (di + 1)];
      n += wt;
      let q = 0;
      while (q < cnt && CL[base + q] !== lab) q++;
      if (q < cnt) CV[base + q] += wt;
      else {
        CL[base + cnt] = lab;
        CV[base + cnt] = wt;
        cnt++;
      }
    }
    for (let q = 0; q < cnt; q++) CV[base + q] /= n || 1;
    CN[j * w + i] = cnt;
  }
  // The noise that nudges where claims are sampled, worked out at each grid corner and blended between.
  const NW = w + 2;
  const NH = h + 2;
  const DX = new Float32Array(NW * NH);
  const DY = new Float32Array(NW * NH);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const u = i - 1;
    const v = j - 1;
    DX[j * NW + i] = 0.55 * noise(seed, u, v, 3.2) + 0.25 * noise(seed + 17, u, v, 1.3);
    DY[j * NW + i] = 0.55 * noise(seed + 31, u, v, 3.2) + 0.25 * noise(seed + 47, u, v, 1.3);
  }
  const lerp2 = (A: Float32Array, u: number, v: number) => {
    const i = Math.max(0, Math.min(NW - 2, Math.floor(u) + 1));
    const j = Math.max(0, Math.min(NH - 2, Math.floor(v) + 1));
    const fu = u + 1 - i;
    const fv = v + 1 - j;
    const a = A[j * NW + i];
    const b = A[j * NW + i + 1];
    const c = A[(j + 1) * NW + i];
    const d = A[(j + 1) * NW + i + 1];
    return a + (b - a) * fu + (c - a + (d - c - b + a) * fu) * fv;
  };
  // Cells deep inside one holding (all land, the same holder within two cells every way): nothing
  // there can wander, so their fine points need no sampling.
  const NONE = -9;
  const uni = new Int32Array(w * h).fill(NONE);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (!land[k]) continue;
    const o = owner[k];
    let same = true;
    for (let dj = -2; dj <= 2 && same; dj++) for (let di = -2; di <= 2; di++) {
      const m = rowOk(j + dj) * w + col(i + di);
      if (!land[m] || owner[m] !== o) {
        same = false;
        break;
      }
    }
    if (same) uni[k] = o;
  }
  const label = new Int32Array(W * H);
  const cell = new Int32Array(W * H);
  const accL = new Int32Array(40);
  const accV = new Float32Array(40);
  let accN = 0;
  const addCell = (ii: number, jj: number, wt: number) => {
    if (wt <= 0) return;
    const c = rowOk(jj) * w + col(ii);
    const base = c * 9;
    for (let q = 0; q < CN[c]; q++) {
      const lab = CL[base + q];
      let r = 0;
      while (r < accN && accL[r] !== lab) r++;
      if (r < accN) accV[r] += CV[base + q] * wt;
      else {
        accL[accN] = lab;
        accV[accN] = CV[base + q] * wt;
        accN++;
      }
    }
  };
  const L = (ii: number, jj: number) => land[rowOk(jj) * w + col(ii)];
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    // In cell units, cell centres at whole numbers.
    const u0 = (X + 0.5) / F - 0.5;
    const v0 = (Y + 0.5) / F - 0.5;
    const q0 = Y * W + X;
    const c0 = rowOk(Math.round(v0)) * w + col(Math.round(u0));
    cell[q0] = c0;
    if (uni[c0] !== NONE) {
      label[q0] = uni[c0];
      continue;
    }
    // Land or sea: the land smoothly interpolated (no wandering: the coast is the map's own).
    let i0 = Math.floor(u0);
    let j0 = Math.floor(v0);
    let fu = u0 - i0;
    let fv = v0 - j0;
    const lv = L(i0, j0) * (1 - fu) * (1 - fv) + L(i0 + 1, j0) * fu * (1 - fv) + L(i0, j0 + 1) * (1 - fu) * fv + L(i0 + 1, j0 + 1) * fu * fv;
    if (lv < 0.5) {
      label[q0] = SEA;
      continue;
    }
    // Where the claims are sampled: nudged by the noise.
    const u = u0 + lerp2(DX, u0, v0);
    const v = v0 + lerp2(DY, u0, v0);
    i0 = Math.floor(u);
    j0 = Math.floor(v);
    fu = u - i0;
    fv = v - j0;
    accN = 0;
    addCell(i0, j0, (1 - fu) * (1 - fv));
    addCell(i0 + 1, j0, fu * (1 - fv));
    addCell(i0, j0 + 1, (1 - fu) * fv);
    addCell(i0 + 1, j0 + 1, fu * fv);
    let best = -1;
    let bv = 0;
    for (let q = 0; q < accN; q++) if (accV[q] > bv) {
      best = accL[q];
      bv = accV[q];
    }
    label[q0] = accN ? best : -1;
  }
  return { F, W, H, label, cell, lines: traceBorders(label, W, H, wrap), rings: traceRings(label, W, H) };
}

/** The edges between differing fine points (not the coast), chained into polylines and smoothed. */
function traceBorders(label: Int32Array, W: number, H: number, wrap: boolean): number[][] {
  const segs: number[] = [];
  const border = (a: number, b: number) => a !== b && a !== SEA && b !== SEA;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const a = label[Y * W + X];
    if (X + 1 < W || wrap) {
      const b = label[Y * W + ((X + 1) % W)];
      if (border(a, b)) segs.push(X + 1, Y, X + 1, Y + 1);
    }
    if (Y + 1 < H) {
      const b = label[(Y + 1) * W + X];
      if (border(a, b)) segs.push(X, Y + 1, X + 1, Y + 1);
    }
  }
  // Chain the edges at their shared corners.
  const key = (x: number, y: number) => y * (W + 2) + x;
  const at = new Map<number, number[]>();
  const n = segs.length / 4;
  for (let s = 0; s < n; s++) for (const e of [0, 1]) {
    const k = key(segs[s * 4 + e * 2], segs[s * 4 + e * 2 + 1]);
    const l = at.get(k);
    if (l) l.push(s);
    else at.set(k, [s]);
  }
  const used = new Uint8Array(n);
  const other = (s: number, x: number, y: number): [number, number] => (segs[s * 4] === x && segs[s * 4 + 1] === y ? [segs[s * 4 + 2], segs[s * 4 + 3]] : [segs[s * 4], segs[s * 4 + 1]]);
  const lines: number[][] = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const pts: [number, number][] = [[segs[s0 * 4], segs[s0 * 4 + 1]], [segs[s0 * 4 + 2], segs[s0 * 4 + 3]]];
    // Grow from both ends while the way on is unbranched.
    for (const front of [true, false]) {
      for (;;) {
        const [x, y] = front ? pts[pts.length - 1] : pts[0];
        const here = at.get(key(x, y)) ?? [];
        if (here.length !== 2) break;
        const next = here.find((q) => !used[q]);
        if (next === undefined) break;
        used[next] = 1;
        const p = other(next, x, y);
        if (front) pts.push(p);
        else pts.unshift(p);
      }
    }
    lines.push(smooth(simplify(pts, 0.75)));
  }
  return lines;
}

/** The outline of each realm's land: its pixel edges chained into closed rings, then straightened and rounded. */
function traceRings(label: Int32Array, W: number, H: number): Map<number, number[][]> {
  // Directed edges with the land on one side; the map's edges (and the wrap seam) close the rings.
  const ex: number[] = [];
  const lab: number[] = [];
  const L = (X: number, Y: number) => (X < 0 || Y < 0 || X >= W || Y >= H ? SEA - 1 : label[Y * W + X]);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const o = label[Y * W + X];
    if (o < 0) continue;
    if (L(X, Y - 1) !== o) ex.push(X + 1, Y, X, Y), lab.push(o);
    if (L(X + 1, Y) !== o) ex.push(X + 1, Y + 1, X + 1, Y), lab.push(o);
    if (L(X, Y + 1) !== o) ex.push(X, Y + 1, X + 1, Y + 1), lab.push(o);
    if (L(X - 1, Y) !== o) ex.push(X, Y, X, Y + 1), lab.push(o);
  }
  const key = (x: number, y: number) => y * (W + 2) + x;
  const from = new Map<number, number[]>();
  for (let e = 0; e < lab.length; e++) {
    const k = key(ex[e * 4], ex[e * 4 + 1]);
    const l = from.get(k);
    if (l) l.push(e);
    else from.set(k, [e]);
  }
  const used = new Uint8Array(lab.length);
  const out = new Map<number, number[][]>();
  for (let e0 = 0; e0 < lab.length; e0++) {
    if (used[e0]) continue;
    const o = lab[e0];
    const pts: [number, number][] = [[ex[e0 * 4], ex[e0 * 4 + 1]]];
    let e = e0;
    for (let guard = 0; guard < lab.length; guard++) {
      used[e] = 1;
      const x = ex[e * 4 + 2];
      const y = ex[e * 4 + 3];
      pts.push([x, y]);
      const next = (from.get(key(x, y)) ?? []).find((q) => !used[q] && lab[q] === o);
      if (next === undefined) break;
      e = next;
    }
    if (pts.length < 4) continue;
    const ring = smooth(simplify(pts, 0.75));
    const l = out.get(o);
    if (l) l.push(ring);
    else out.set(o, [ring]);
  }
  return out;
}

/** Douglas–Peucker: drop points within `tol` of the line, so a staircase becomes a slope. */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > fd) [far, fd] = [i, d];
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  // A closed ring with its first and last points the same stays closed.
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin's corner cutting (three rounds), keeping the ends of an open line where they are. */
function smooth(pts: [number, number][]): number[] {
  const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  let p = closed ? pts.slice(0, -1) : pts;
  for (let r = 0; r < 3 && p.length > 2; r++) {
    const out: [number, number][] = closed ? [] : [p[0]];
    const m = closed ? p.length : p.length - 1;
    for (let i = 0; i < m; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[p.length - 1]);
    p = out;
  }
  if (closed) p.push(p[0]);
  return p.flat();
}
