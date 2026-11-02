/**
 * Tracing borders on a labelled grid: every edge between two different labels, chained junction
 * to junction, each chain simplified and smoothed once (so both sides of a border share the very
 * same curve), and each label's chains joined into closed rings for filling or clipping.
 * Used for the realms' borders and for provinces.
 */

export interface Chain {
  /** Points [x, y, x, y…] in grid units, lattice corners (the wrap seam unrolled). */
  pts: number[];
  /** Who is on each side (left as the chain runs). */
  left: number;
  right: number;
}

/** Every edge between two different labels (at least one `held`), chained junction to junction and smoothed. Off the grid (north, south, and east–west unless it wraps) is `outside`; `tol` is how far (grid units) a staircase may be straightened (or, per chain, from the labels either side). */
export function traceChains(label: Int32Array, W: number, H: number, wrap: boolean, held: (l: number) => boolean, outside: number, tol: number | ((left: number, right: number) => number) = 0.7): Chain[] {
  const L = (X: number, Y: number) => {
    if (Y < 0 || Y >= H) return outside;
    if (X < 0 || X >= W) {
      if (!wrap) return outside;
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
    chains.push({ pts: smooth(simplify(pts, typeof tol === 'number' ? tol : tol(left, right))), left, right });
  }
  return chains;
}

/** Each `held` label's rings: its chains (turned so it is on their left) joined end to start. */
export function assembleRings(chains: Chain[], W: number, wrap: boolean, held: (l: number) => boolean): Map<number, number[][]> {
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
