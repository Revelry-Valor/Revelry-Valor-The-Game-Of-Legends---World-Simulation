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

export interface Chain {
  /** Points [x, y, x, y…] in fine units (the wrap seam unrolled). */
  pts: number[];
  /** Who is on each side (left as the chain runs). */
  left: number;
  right: number;
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
  const chains = traceChains(label, W, H, wrap);
  return { F, W, H, label, cell, chains, rings: assembleRings(chains, W, wrap) };
}

const held = (l: number) => l >= 0 || l <= -1000;

/** Every edge between two different holders (at least one a realm), chained junction to junction and smoothed. */
function traceChains(label: Int32Array, W: number, H: number, wrap: boolean): Chain[] {
  const L = (X: number, Y: number) => {
    if (Y < 0 || Y >= H) return OUTSIDE;
    if (X < 0 || X >= W) {
      if (!wrap) return OUTSIDE;
      X = ((X % W) + W) % W;
    }
    return label[Y * W + X];
  };
  // Unit edges, each with its two ends and who is on its left and right as stored.
  const ex: number[] = [];
  const el: number[] = [];
  const er: number[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number, left: number, right: number) => {
    if (left === right || (!held(left) && !held(right))) return;
    ex.push(x1, y1, x2, y2);
    el.push(left);
    er.push(right);
  };
  for (let Y = -1; Y < H; Y++) for (let X = -1; X < W; X++) {
    const a = L(X, Y);
    // The edge east of (X, Y), running down: the east point on its left.
    if (Y >= 0) {
      const b = L(X + 1, Y);
      if (!(wrap && X < 0)) add(X + 1, Y, X + 1, Y + 1, b, a);
    }
    // The edge south of (X, Y), running east: the north point on its left.
    if (X >= 0) add(X, Y + 1, X + 1, Y + 1, a, L(X, Y + 1));
  }
  // Ends meet at lattice points (the wrap seam folds x = W onto x = 0).
  const n = el.length;
  const kx = (x: number) => (wrap ? ((x % W) + W) % W : x);
  const key = (x: number, y: number) => (y + 1) * (W + 3) + kx(x) + 1;
  const at = new Map<number, number[]>();
  for (let e = 0; e < n; e++) for (const s of [0, 1]) {
    const k = key(ex[e * 4 + s * 2], ex[e * 4 + s * 2 + 1]);
    const l = at.get(k);
    if (l) l.push(e);
    else at.set(k, [e]);
  }
  const used = new Uint8Array(n);
  const pair = (e: number) => (el[e] < er[e] ? `${el[e]}|${er[e]}` : `${er[e]}|${el[e]}`);
  const chains: Chain[] = [];
  // Walk on from a point along the edge that continues the same border (a junction stops it).
  const step = (x: number, y: number, p: string): number | undefined => {
    const here = at.get(key(x, y)) ?? [];
    if (here.length !== 2) return undefined;
    const e = here.find((q) => !used[q]);
    return e !== undefined && pair(e) === p ? e : undefined;
  };
  const near = (x: number, ref: number) => (wrap ? x + Math.round((ref - x) / W) * W : x);
  for (let e0 = 0; e0 < n; e0++) {
    if (used[e0]) continue;
    used[e0] = 1;
    const p = pair(e0);
    // Forward from its end, then backward from its start.
    const fwd: number[] = [ex[e0 * 4], ex[e0 * 4 + 1], ex[e0 * 4 + 2], ex[e0 * 4 + 3]];
    const left = el[e0];
    const right = er[e0];
    for (;;) {
      const x = fwd[fwd.length - 2];
      const y = fwd[fwd.length - 1];
      const e = step(x, y, p);
      if (e === undefined) break;
      used[e] = 1;
      const s0x = near(ex[e * 4], x);
      const startsHere = kx(ex[e * 4]) === kx(x) && ex[e * 4 + 1] === y;
      const nx = startsHere ? near(ex[e * 4 + 2], x) : s0x;
      const ny = startsHere ? ex[e * 4 + 3] : ex[e * 4 + 1];
      fwd.push(nx, ny);
    }
    const back: number[] = [];
    for (;;) {
      const x = back.length ? back[back.length - 2] : fwd[0];
      const y = back.length ? back[back.length - 1] : fwd[1];
      const e = step(x, y, p);
      if (e === undefined) break;
      used[e] = 1;
      const startsHere = kx(ex[e * 4]) === kx(x) && ex[e * 4 + 1] === y;
      back.push(startsHere ? near(ex[e * 4 + 2], x) : near(ex[e * 4], x), startsHere ? ex[e * 4 + 3] : ex[e * 4 + 1]);
    }
    const pts: [number, number][] = [];
    for (let i = back.length - 2; i >= 0; i -= 2) pts.push([back[i], back[i + 1]]);
    for (let i = 0; i < fwd.length; i += 2) pts.push([fwd[i], fwd[i + 1]]);
    chains.push({ pts: smooth(simplify(pts, 0.7)), left, right });
  }
  return chains;
}

/** Each holder's rings: its chains (turned so it is on their left) joined end to start. */
function assembleRings(chains: Chain[], W: number, wrap: boolean): Map<number, number[][]> {
  const byHolder = new Map<number, number[][]>();
  for (const c of chains) {
    for (const [who, flip] of [[c.left, false], [c.right, true]] as const) {
      if (!held(who)) continue;
      const pts = flip ? reverse(c.pts) : c.pts;
      const l = byHolder.get(who);
      if (l) l.push(pts);
      else byHolder.set(who, [pts]);
    }
  }
  const kx = (x: number) => (wrap ? ((Math.round(x) % W) + W) % W : Math.round(x));
  const key = (x: number, y: number) => `${kx(x)},${Math.round(y)}`;
  const out = new Map<number, number[][]>();
  for (const [who, parts] of byHolder) {
    const starts = new Map<string, number[]>();
    parts.forEach((p, i) => {
      const k = key(p[0], p[1]);
      const l = starts.get(k);
      if (l) l.push(i);
      else starts.set(k, [i]);
    });
    const used = new Uint8Array(parts.length);
    const rings: number[][] = [];
    for (let i0 = 0; i0 < parts.length; i0++) {
      if (used[i0]) continue;
      used[i0] = 1;
      const ring = [...parts[i0]];
      const startKey = key(ring[0], ring[1]);
      for (let guard = 0; guard < parts.length; guard++) {
        const ex = ring[ring.length - 2];
        const ey = ring[ring.length - 1];
        if (key(ex, ey) === startKey && ring.length > 4) break;
        const next = (starts.get(key(ex, ey)) ?? []).find((q) => !used[q]);
        if (next === undefined) break;
        used[next] = 1;
        const p = parts[next];
        // Shift a part across the wrap seam to meet the ring's end.
        const shift = wrap ? Math.round((ex - p[0]) / W) * W : 0;
        for (let i = 2; i < p.length; i += 2) ring.push(p[i] + shift, p[i + 1]);
      }
      rings.push(ring);
    }
    out.set(who, rings);
  }
  return out;
}

function reverse(p: number[]): number[] {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
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
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin's corner cutting (three rounds); both ends stay where they are (they are junctions). */
function smooth(pts: [number, number][]): number[] {
  let p = pts;
  const closed = p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
  for (let r = 0; r < 3 && p.length > 2; r++) {
    const out: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (i > 0 || closed) out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      if (i < p.length - 2 || closed) out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p.flat();
}
