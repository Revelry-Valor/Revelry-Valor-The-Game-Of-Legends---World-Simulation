import { hash01, type Point } from '../engine/geometry';
import { Noise2D } from '../engine/noise';
import { Rng } from '../engine/rng';

const warpNoise = new Noise2D(new Rng(13).fork('border-warp'));

/**
 * Labels on a finer grid (`f` cells per tile each way), each cell taking the label of the tile
 * under a gently warped position. Borders traced on this follow wandering natural lines instead of
 * the tile staircase.
 */
export function warpLabels(labels: Int32Array, w: number, h: number, f: number, amount = 0.8): Int32Array {
  const index = warpIndex(w, h, f, amount);
  const out = new Int32Array(index.length);
  for (let i = 0; i < index.length; i++) out[i] = labels[index[i]];
  return out;
}

const warpCache = new Map<string, Int32Array>();

/** For each fine cell, the tile its warped position falls in. The warp never changes, so it is worked out once per map size. */
function warpIndex(w: number, h: number, f: number, amount: number): Int32Array {
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

/** Scale traced shapes from a fine grid back to map coordinates. */
export function scaleShapes(shapes: RegionShapes, k: number): RegionShapes {
  const sc = (pts: Point[]) => pts.map(([x, y]) => [x * k, y * k] as Point);
  return {
    segments: shapes.segments.map((s) => ({ a: s.a, b: s.b, pts: sc(s.pts) })),
    loops: new Map([...shapes.loops].map(([l, loops]) => [l, loops.map(sc)])),
  };
}

/** One stretch of border between two regions (label a on its left, b on its right; -1 for none). */
export interface BorderSegment {
  a: number;
  b: number;
  pts: Point[];
}

export interface RegionShapes {
  /** Every border stretch, smoothed, each drawn once. */
  segments: BorderSegment[];
  /** Closed outlines of each region (outer edges and holes), for filling with the nonzero rule. */
  loops: Map<number, Point[][]>;
}

/**
 * Turn a map of labels (one per tile) into smooth regions. The edges between tiles of different
 * labels are joined into stretches that run from one meeting point of three or more regions to
 * the next (or round in a closed loop). Each stretch is nudged a little and rounded off, once,
 * so neighbouring regions share exactly the same curved border. Each region's outline is then
 * assembled from the stretches around it.
 */
export function traceRegions(labels: Int32Array, w: number, h: number, smoothing = 3): RegionShapes {
  const W = w + 1;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : labels[y * w + x]);
  // Border edges: horizontal edge (x, y)-(x+1, y) between tiles above and below; vertical edge (x, y)-(x, y+1) between tiles left and right.
  const hEdge = new Uint8Array(W * (h + 1));
  const vEdge = new Uint8Array(W * (h + 1));
  const degree = new Uint8Array(W * (h + 1));
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y - 1) !== at(x, y)) {
        hEdge[y * W + x] = 1;
        degree[y * W + x]++;
        degree[y * W + x + 1]++;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x <= w; x++) {
      if (at(x - 1, y) !== at(x, y)) {
        vEdge[y * W + x] = 1;
        degree[y * W + x]++;
        degree[(y + 1) * W + x]++;
      }
    }
  }
  /** Unused border edges leaving vertex v: [next vertex, edge kind 0=h 1=v, edge index]. */
  const step = (v: number): [number, number, number] | null => {
    const x = v % W;
    const y = (v - x) / W;
    if (x < w && hEdge[y * W + x] === 1) return [v + 1, 0, y * W + x];
    if (x > 0 && hEdge[y * W + x - 1] === 1) return [v - 1, 0, y * W + x - 1];
    if (y < h && vEdge[y * W + x] === 1) return [v + W, 1, y * W + x];
    if (y > 0 && vEdge[(y - 1) * W + x] === 1) return [v - W, 1, (y - 1) * W + x];
    return null;
  };
  /** Labels left and right of the directed edge from u to v. */
  const sides = (u: number, v: number): [number, number] => {
    const ux = u % W;
    const uy = (u - ux) / W;
    const d = v - u;
    if (d === 1) return [at(ux, uy - 1), at(ux, uy)]; // east: north on the left
    if (d === -1) return [at(ux - 1, uy), at(ux - 1, uy - 1)]; // west: south on the left
    if (d === W) return [at(ux, uy), at(ux - 1, uy)]; // south: east on the left
    return [at(ux - 1, uy - 1), at(ux, uy - 1)]; // north: west on the left
  };
  const take = (kind: number, e: number) => {
    if (kind === 0) hEdge[e] = 2;
    else vEdge[e] = 2;
  };
  const chains: { verts: number[]; a: number; b: number; closed: boolean }[] = [];
  const walk = (start: number, closed: boolean) => {
    const verts = [start];
    let v = start;
    let first: [number, number] | null = null;
    for (;;) {
      const s = step(v);
      if (!s) break;
      const [n, kind, e] = s;
      take(kind, e);
      if (!first) first = sides(v, n);
      verts.push(n);
      v = n;
      if (n === start || (!closed && degree[n] !== 2)) break;
    }
    if (first && verts.length > 1) chains.push({ verts, a: first[0], b: first[1], closed: closed && v === start });
  };
  // Stretches between junctions first, then whatever is left: closed loops (islands, enclaves).
  for (let v = 0; v < degree.length; v++) {
    if (degree[v] === 0 || degree[v] === 2) continue;
    while (step(v)) walk(v, false);
  }
  for (let v = 0; v < degree.length; v++) while (degree[v] === 2 && step(v)) walk(v, true);

  // Nudge interior points (the same way for both sides) and round them off.
  const pos = (v: number): Point => {
    const x = v % W;
    const y = (v - x) / W;
    return [x, y];
  };
  const segments: BorderSegment[] = chains.map((c) => {
    const pts = c.verts.map((v, k) => {
      const [x, y] = pos(v);
      const fixed = !c.closed && (k === 0 || k === c.verts.length - 1);
      if (fixed || x === 0 || y === 0 || x === w || y === h) return [x, y] as Point;
      return [x + (hash01(v, 7) - 0.5) * 0.5, y + (hash01(v, 8) - 0.5) * 0.5] as Point;
    });
    // Straighten the little steps of the grid first, then round off what is left.
    const simple = simplify(pts, 0.7);
    return { a: c.a, b: c.b, pts: c.closed ? chaikinLoop(simple.slice(0, -1), smoothing) : chaikin(simple, smoothing) };
  });

  // Each region's outlines from the stretches around it, walked with the region on the left.
  const loops = new Map<number, Point[][]>();
  const byLabel = new Map<number, { from: number; to: number; pts: Point[]; used: boolean }[]>();
  chains.forEach((c, k) => {
    const pts = segments[k].pts;
    if (c.closed) {
      if (c.a >= 0) push(loops, c.a, pts);
      if (c.b >= 0) push(loops, c.b, [...pts].reverse());
      return;
    }
    const from = c.verts[0];
    const to = c.verts[c.verts.length - 1];
    if (c.a >= 0) pushList(byLabel, c.a, { from, to, pts, used: false });
    if (c.b >= 0) pushList(byLabel, c.b, { from: to, to: from, pts: [...pts].reverse(), used: false });
  });
  for (const [label, list] of byLabel) {
    const starting = new Map<number, typeof list>();
    for (const s of list) pushList(starting, s.from, s);
    for (const s0 of list) {
      if (s0.used) continue;
      const loop: Point[] = [];
      let s: (typeof list)[number] | undefined = s0;
      while (s && !s.used) {
        s.used = true;
        for (let k = loop.length ? 1 : 0; k < s.pts.length; k++) loop.push(s.pts[k]);
        if (s.to === s0.from) break;
        s = starting.get(s.to)?.find((o) => !o.used);
      }
      if (loop.length > 2) push(loops, label, loop);
    }
  }
  return { segments, loops };
}

function push(m: Map<number, Point[][]>, k: number, v: Point[]): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

function pushList<T>(m: Map<number, T[]>, k: number, v: T): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/**
 * Drop points that stray less than `tol` from the straight line between their neighbours
 * (Douglas–Peucker), keeping both ends: a staircase of grid steps becomes a few straight runs.
 */
export function simplify(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  // A closed loop starts and ends on the same point: split it at its farthest point first.
  if (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    let far = 1;
    let fd = -1;
    for (let k = 1; k < pts.length - 1; k++) {
      const d = Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]);
      if (d > fd) {
        fd = d;
        far = k;
      }
    }
    keep[far] = 1;
    stack.length = 0;
    stack.push([0, far], [far, pts.length - 1]);
  }
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const vx = bx - ax;
    const vy = by - ay;
    const len = Math.hypot(vx, vy) || 1;
    let worst = -1;
    let wd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * vy - (pts[k][1] - ay) * vx) / len;
      if (d > wd) {
        wd = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** Corner-cutting smoothing of an open line, keeping its two ends where they are. */
export function chaikin(pts: Point[], iterations: number): Point[] {
  let p = pts;
  for (let it = 0; it < iterations && p.length > 2; it++) {
    const out: Point[] = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const [ax, ay] = p[k];
      const [bx, by] = p[k + 1];
      if (k > 0) out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      if (k < p.length - 2) out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Corner-cutting smoothing of a closed loop (the first point is not repeated at the end). */
export function chaikinLoop(pts: Point[], iterations: number): Point[] {
  let p = pts;
  for (let it = 0; it < iterations && p.length > 2; it++) {
    const out: Point[] = [];
    for (let k = 0; k < p.length; k++) {
      const [ax, ay] = p[k];
      const [bx, by] = p[(k + 1) % p.length];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    p = out;
  }
  return [...p, p[0]];
}
