import { CellHeap, type ReliefField } from './erosion';
import { Noise2D } from './noise';
import { Rng } from './rng';

/** A river drawn by hand: its source, then each point it should pass, in order. In tiles. */
export interface RiverDef {
  points: [number, number][];
}

/** A lake set by hand: the spot clicked, and how full its hollow is (1 = to where it spills over). */
export interface LakeDef {
  x: number;
  y: number;
  level: number;
}

/** Lake water painted in (add) or out (land), as circles in tiles. */
export interface LakeEdit {
  x: number;
  y: number;
  r: number;
  add: boolean;
}

/** All the water put on a world by hand. */
export interface WaterPlan {
  rivers: RiverDef[];
  lakes: LakeDef[];
  edits: LakeEdit[];
}

export const emptyWater = (): WaterPlan => ({ rivers: [], lakes: [], edits: [] });

export interface WaterResult {
  /** River discharge on each tile (0 where none), in the units of the threshold. */
  river: Float32Array;
  /** Curves to draw: records of 7 (start x, y, control x, y, end x, y, width), in tiles. */
  curves: Float32Array;
  /** 1 for tiles that are mostly lake. */
  lake: Uint8Array;
  /** Each drawn river's course as it was laid, in tiles (x, y pairs): for picking a river on the map. */
  paths: Float32Array[];
  /** Each lake set by hand: its water level and the level it would spill at (0 if no hollow there). */
  lakes: { level: number; spill: number; bottom: number }[];
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * The hollow a point lies in: from the point, down to the bottom of its hollow, then filled up
 * until the water would find a way out. Returns the bottom cell, the level it spills at, and every
 * cell below that level reached on the way (in the order they fill).
 */
export function hollowAt(relief: ReliefField, cell: number, limit = 250000): { bottom: number; spill: number; cells: number[] } {
  const { width: W, height: H, heights: Hs, water } = relief;
  // Down the steepest way to the bottom of the hollow.
  let c = cell;
  for (let guard = 0; guard < 10000; guard++) {
    const X = c % W;
    const Y = (c - X) / W;
    let best = c;
    for (let k = 0; k < 8; k++) {
      const x = X + DX[k];
      const y = Y + DY[k];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      if (!water[j] && Hs[j] < Hs[best]) best = j;
    }
    if (best === c) break;
    c = best;
  }
  const bottom = c;
  // Fill: always the lowest cell on the water's edge next; once that is lower than the water
  // already stands, the water has found its way out.
  const seen = new Uint8Array(W * H);
  const heap = new CellHeap(Math.min(W * H, limit * 8 + 16));
  const cells: number[] = [];
  let level = Hs[bottom];
  heap.push(bottom, Hs[bottom]);
  seen[bottom] = 1;
  while (heap.size) {
    const q = heap.pop();
    if (water[q] || (cells.length > 0 && Hs[q] < level - 1e-7)) break;
    level = Math.max(level, Hs[q]);
    cells.push(q);
    if (cells.length >= limit) break;
    const X = q % W;
    const Y = (q - X) / W;
    if (X === 0 || Y === 0 || X === W - 1 || Y === H - 1) break;
    for (let k = 0; k < 8; k++) {
      const x = X + DX[k];
      const y = Y + DY[k];
      const j = y * W + x;
      if (seen[j]) continue;
      seen[j] = 1;
      heap.push(j, Hs[j]);
    }
  }
  return { bottom, spill: level, cells };
}

/**
 * Put the water drawn by hand onto carved land. Lakes fill the hollow clicked, to the level asked;
 * painted water adds to them or makes ponds, painted land takes water away. Each river runs from
 * its source through the points given, in order, finding the most natural way between them (low
 * ground, valley floors, never climbing if it can help it); where the land is in the way it is cut
 * through, the river's bed always falling, with a gorge as deep as the cut needs. A river ends where
 * it reaches the sea, a lake or another river (it becomes a tributary there), or at its last point.
 * It grows as it goes and as rivers join it, and cuts its channel into the land.
 *
 * Works on `relief` itself (its heights are cut, and its lake fields set): pass a copy.
 */
export function applyWater(relief: ReliefField, w: number, h: number, plan: WaterPlan, threshold: number, opts: { width?: number; depth?: number; seed?: number } = {}, shaped?: Float32Array): WaterResult {
  const { width: W, height: H, scale: S, heights: Hs } = relief;
  const n = W * H;
  // Lakes keep to the hollows as the land was shaped: erosion would otherwise silt them up or cut
  // through their rims. The shaped land (tile heights, sea at 0), blended smoothly to the fine grid.
  const basin: ReliefField = shaped ? { ...relief, heights: upsample(shaped, w, h, S) } : relief;
  const Bs = basin.heights;
  const sea = relief.water;
  const widthK = opts.width ?? 1;
  const depthK = opts.depth ?? 1;
  const cellAt = (x: number, y: number) => {
    const X = Math.min(W - 1, Math.max(0, Math.round((x + 0.5) * S - 0.5)));
    const Y = Math.min(H - 1, Math.max(0, Math.round((y + 0.5) * S - 0.5)));
    return Y * W + X;
  };
  const tileOf = (c: number) => {
    const X = c % W;
    const Y = (c - X) / W;
    return Math.min(h - 1, Math.floor(Y / S)) * w + Math.min(w - 1, Math.floor(X / S));
  };

  // --- Lakes ---
  const isLake = new Uint8Array(n);
  const level = new Float32Array(n);
  const lakes: WaterResult['lakes'] = [];
  for (const def of plan.lakes) {
    const start = cellAt(def.x, def.y);
    if (sea[start]) {
      lakes.push({ level: 0, spill: 0, bottom: 0 });
      continue;
    }
    const hollow = hollowAt(basin, start);
    const bottom = Bs[hollow.bottom];
    const L = bottom + Math.min(1, Math.max(0.02, def.level)) * (hollow.spill - bottom);
    lakes.push({ level: L, spill: hollow.spill, bottom });
    if (hollow.spill - bottom < 1e-5) continue;
    // Everything below the water, joined to the bottom.
    const stack = [hollow.bottom];
    const seen = new Uint8Array(n);
    seen[hollow.bottom] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      isLake[c] = 1;
      level[c] = Math.max(level[c], L);
      const X = c % W;
      const Y = (c - X) / W;
      for (let k = 0; k < 8; k++) {
        const x = X + DX[k];
        const y = Y + DY[k];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (seen[j] || sea[j] || Bs[j] >= L) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  // The lake bed lies under the water, deeper towards the middle.
  for (let c = 0; c < n; c++) {
    if (!isLake[c]) continue;
    const bed = level[c] - 0.002 - Math.max(0, level[c] - Bs[c]) * 0.6;
    if (Hs[c] > bed) Hs[c] = Math.max(0.0005, bed);
  }
  for (const e of plan.edits) {
    const r = e.r * S;
    const cx = (e.x + 0.5) * S - 0.5;
    const cy = (e.y + 0.5) * S - 0.5;
    const X0 = Math.max(0, Math.floor(cx - r));
    const X1 = Math.min(W - 1, Math.ceil(cx + r));
    const Y0 = Math.max(0, Math.floor(cy - r));
    const Y1 = Math.min(H - 1, Math.ceil(cy + r));
    let L = -Infinity;
    if (e.add) {
      // Water joining a lake stands at the lake's level; a new pond, level with its highest shore.
      let lakeL = -Infinity;
      let top = -Infinity;
      for (let Y = Y0; Y <= Y1; Y++) {
        for (let X = X0; X <= X1; X++) {
          if (Math.hypot(X - cx, Y - cy) > r) continue;
          const c = Y * W + X;
          if (isLake[c]) lakeL = Math.max(lakeL, level[c]);
          else top = Math.max(top, Hs[c]);
        }
      }
      L = lakeL > -Infinity ? lakeL : top;
    }
    for (let Y = Y0; Y <= Y1; Y++) {
      for (let X = X0; X <= X1; X++) {
        if (Math.hypot(X - cx, Y - cy) > r) continue;
        const c = Y * W + X;
        if (sea[c]) continue;
        if (e.add) {
          isLake[c] = 1;
          level[c] = Math.max(level[c], L);
          // The bed under painted water lies below its surface.
          if (Hs[c] >= L) Hs[c] = L - 0.002;
        } else isLake[c] = 0;
      }
    }
  }
  const wet = (c: number) => sea[c] === 1 || isLake[c] === 1;

  // --- Rivers: courses ---
  const courses: number[][] = [];
  for (const def of plan.rivers) {
    if (def.points.length < 2) {
      courses.push([]);
      continue;
    }
    const cells = def.points.map(([x, y]) => cellAt(x, y));
    let course: number[] = [cells[0]];
    for (let k = 1; k < cells.length; k++) {
      const leg = route(relief, cells[k - 1], cells[k], wet);
      course = course.concat(leg.slice(1));
    }
    // Rising in a lake, it leaves from the shore; reaching water, it ends there.
    let first = 0;
    while (first < course.length - 1 && wet(course[first]) && wet(course[first + 1])) first++;
    let last = course.length - 1;
    for (let i = first + 1; i < course.length; i++) {
      if (wet(course[i])) {
        last = i;
        break;
      }
    }
    courses.push(course.slice(first, last + 1));
  }
  // A river ending at another river joins it there, as a tributary.
  const onRiver = new Int32Array(n).fill(-1);
  const joins: { into: number; at: number }[] = courses.map(() => ({ into: -1, at: -1 }));
  courses.forEach((c, k) => c.forEach((cell) => onRiver[cell] < 0 && (onRiver[cell] = k)));
  courses.forEach((course, k) => {
    if (course.length < 3) return;
    const endCell = course[course.length - 1];
    if (wet(endCell)) return;
    const near = (cell: number) => {
      const X = cell % W;
      const Y = (cell - X) / W;
      const R = Math.max(1, Math.round(S * 0.6));
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = X + dx;
          const y = Y + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = onRiver[y * W + x];
          if (o >= 0 && o !== k) return o;
        }
      }
      return -1;
    };
    if (near(endCell) < 0) return;
    // The first touch in the second half of its course.
    for (let i = Math.floor(course.length * 0.4); i < course.length; i++) {
      const o = near(course[i]);
      if (o < 0) continue;
      const target = courses[o];
      let best = 0;
      let bd = Infinity;
      target.forEach((t, j) => {
        const d = Math.hypot((t % W) - (course[i] % W), Math.floor(t / W) - Math.floor(course[i] / W));
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      courses[k] = course.slice(0, i + 1).concat([target[best]]);
      joins[k] = { into: o, at: best };
      return;
    }
  });

  // --- How much water each carries: growing with its length, and with every river that joins it.
  const own = courses.map((c) => c.map((_, i) => threshold * (0.6 + i / S / 14)));
  const extra = courses.map((c) => new Float32Array(c.length));
  const flowAt = (k: number, i: number) => {
    let v = own[k][i];
    const e = extra[k];
    for (let j = 0; j <= i && j < e.length; j++) v += e[j];
    return v;
  };
  for (let pass = 0; pass < 8; pass++) {
    for (const e of extra) e.fill(0);
    joins.forEach((j, k) => {
      if (j.into < 0 || !courses[k].length) return;
      extra[j.into][Math.min(j.at, extra[j.into].length - 1)] += flowAt(k, courses[k].length - 1);
    });
  }
  const flows = courses.map((c, k) => {
    const out = new Float32Array(c.length);
    let acc = 0;
    for (let i = 0; i < c.length; i++) {
      acc += extra[k][i];
      out[i] = own[k][i] + acc;
    }
    return out;
  });
  const size = (v: number) => Math.sqrt(Math.max(v, threshold * 0.1) / threshold);
  const wid = (v: number) => Math.min(0.32, Math.max(0.03, size(v) * 0.06)) * widthK;

  // --- Cut the beds: always falling, through whatever is in the way; biggest rivers first.
  const order = courses.map((_, k) => k).sort((a, b) => (flows[b][flows[b].length - 1] ?? 0) - (flows[a][flows[a].length - 1] ?? 0));
  const wallSlope = 0.06 / S; // how steeply a gorge's walls rise, per cell
  for (const k of order) {
    const course = courses[k];
    if (course.length < 2) continue;
    let bed = Infinity;
    for (let i = 0; i < course.length; i++) {
      const c = course[i];
      if (wet(c)) {
        if (i === 0) bed = Math.min(bed, isLake[c] ? level[c] : 0);
        continue;
      }
      bed = Math.min(bed, Hs[c]) - 2e-5;
      const cut = Hs[c] - bed;
      const r = Math.max(1, wid(flows[k][i]) * S * 1.5);
      const depth = Math.min(0.03, 0.006 * size(flows[k][i])) * depthK;
      const R = Math.min(10 * S, Math.ceil(r + cut / wallSlope));
      const X = c % W;
      const Y = (c - X) / W;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = X + dx;
          const y = Y + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const j = y * W + x;
          if (wet(j)) continue;
          const d = Math.hypot(dx, dy);
          if (d > R) continue;
          const target = d <= r ? bed - depth * (1 - (d / r) ** 2) : bed + (d - r) * wallSlope;
          if (target < Hs[j]) Hs[j] = Math.max(0.0005, target);
        }
      }
    }
  }

  // --- For the world: river and lake tiles. ---
  const river = new Float32Array(w * h);
  const lakeCount = new Uint16Array(w * h);
  const cellCount = new Uint16Array(w * h);
  for (let c = 0; c < n; c++) {
    const t = tileOf(c);
    cellCount[t]++;
    if (isLake[c]) lakeCount[t]++;
  }
  const lake = new Uint8Array(w * h);
  for (let t = 0; t < w * h; t++) if (lakeCount[t] * 2.2 >= cellCount[t]) lake[t] = 1;
  courses.forEach((course, k) => {
    course.forEach((c, i) => {
      if (wet(c)) return;
      const t = tileOf(c);
      if (lake[t]) return;
      river[t] = Math.max(river[t], flows[k][i]);
    });
  });
  relief.lake = isLake;
  relief.lakeSd = shoreDistance(isLake, W, H, S);

  // --- Curves to draw, gently winding where the land is flat. ---
  const meander = new Noise2D(new Rng(opts.seed ?? 1).fork('meander'));
  const pt = (c: number): [number, number] => [((c % W) + 0.5) / S - 0.5, (Math.floor(c / W) + 0.5) / S - 0.5];
  const out: number[] = [];
  const paths: Float32Array[] = [];
  courses.forEach((course, k) => {
    const p = new Float32Array(course.length * 2);
    course.forEach((c, i) => p.set(pt(c), i * 2));
    paths.push(p);
    if (course.length < 2) return;
    let line: [number, number, number][] = course.map((c, i) => [...pt(c), flows[k][i]] as [number, number, number]);
    line = line.filter((_, i) => i === 0 || i === line.length - 1 || i % Math.max(1, Math.round(S / 2)) === 0);
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
      const c = cellAt(line[i][0], line[i][1]);
      const X = c % W;
      const Y = (c - X) / W;
      if (X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1) continue;
      const slope = Math.hypot(Hs[c + 1] - Hs[c - 1], Hs[c + W] - Hs[c - W]) * S;
      const flat = Math.max(0, 1 - slope / 0.15);
      const ends = Math.min(1, i / 4, (line.length - 1 - i) / 4);
      const off = meander.noise(along * 0.5, k * 3.1) * Math.min(0.2, 0.05 + wid(line[i][2])) * flat * ends;
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
      const m = line[i];
      const b = line[i + 1];
      const sx = i === 1 ? a[0] : (a[0] + m[0]) / 2;
      const sy = i === 1 ? a[1] : (a[1] + m[1]) / 2;
      const ex = i === line.length - 2 ? b[0] : (m[0] + b[0]) / 2;
      const ey = i === line.length - 2 ? b[1] : (m[1] + b[1]) / 2;
      out.push(sx, sy, m[0], m[1], ex, ey, wid(m[2]));
    }
  });
  return { river, curves: Float32Array.from(out), lake, paths, lakes };
}

/** Tile heights blended smoothly to the fine grid. */
function upsample(t: Float32Array, w: number, h: number, S: number): Float32Array {
  const W = w * S;
  const H = h * S;
  const out = new Float32Array(W * H);
  for (let Y = 0; Y < H; Y++) {
    const fy = Math.min(h - 1, Math.max(0, (Y + 0.5) / S - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let X = 0; X < W; X++) {
      const fx = Math.min(w - 1, Math.max(0, (X + 0.5) / S - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      out[Y * W + X] = (t[y0 * w + x0] * (1 - tx) + t[y0 * w + x1] * tx) * (1 - ty) + (t[y1 * w + x0] * (1 - tx) + t[y1 * w + x1] * tx) * ty;
    }
  }
  return out;
}

/**
 * The most natural way for water from one cell to another: through low ground and along valley
 * floors, as little uphill as can be, never across the sea (unless that is where it ends).
 */
function route(relief: ReliefField, a: number, b: number, wet: (c: number) => boolean): number[] {
  const { width: W, height: H, scale: S, heights: Hs, water: sea } = relief;
  if (a === b) return [a];
  const ax = a % W;
  const ay = (a - ax) / W;
  const bx = b % W;
  const by = (b - bx) / W;
  const pad = Math.max(6 * S, Math.round(Math.hypot(ax - bx, ay - by) * 0.5));
  const x0 = Math.max(0, Math.min(ax, bx) - pad);
  const y0 = Math.max(0, Math.min(ay, by) - pad);
  const x1 = Math.min(W - 1, Math.max(ax, bx) + pad);
  const y1 = Math.min(H - 1, Math.max(ay, by) + pad);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const local = (c: number) => ((Math.floor(c / W) - y0) * bw + (c % W) - x0);
  const cost = new Float64Array(bw * bh).fill(Infinity);
  const from = new Int32Array(bw * bh).fill(-1);
  const heap = new CellHeap(bw * bh * 8 + 16);
  cost[local(a)] = 0;
  heap.push(a, 0);
  while (heap.size) {
    const c = heap.pop();
    if (c === b) break;
    const lc = local(c);
    const X = c % W;
    const Y = (c - X) / W;
    for (let k = 0; k < 8; k++) {
      const x = X + DX[k];
      const y = Y + DY[k];
      if (x < x0 || y < y0 || x > x1 || y > y1) continue;
      const j = y * W + x;
      const lj = local(j);
      const climb = Math.max(0, Hs[j] - Hs[c]) * S;
      let step = DL[k] * (1 + 6 * Hs[j] + 300 * climb);
      if (sea[j] && j !== b) step += 1000;
      else if (wet(j) && j !== b) step += 2;
      const v = cost[lc] + step;
      if (v < cost[lj]) {
        cost[lj] = v;
        from[lj] = c;
        heap.push(j, v);
      }
    }
  }
  const path: number[] = [];
  let c = b;
  for (let guard = 0; guard < bw * bh && c >= 0; guard++) {
    path.push(c);
    if (c === a) break;
    c = from[local(c)];
  }
  if (path[path.length - 1] !== a) return [a, b];
  return path.reverse();
}

/** Signed distance to the nearest lake shore, in tiles (positive on the water, ±3 far away). */
export function shoreDistance(isLake: Uint8Array, W: number, H: number, S: number): Float32Array {
  const sd = new Float32Array(W * H);
  const R = Math.max(2, Math.ceil(S * 2));
  // Only near a shore is the distance worked out; elsewhere it is just "far".
  const edge = new Uint8Array(W * H);
  for (let c = 0; c < W * H; c++) {
    const X = c % W;
    const Y = (c - X) / W;
    for (let k = 0; k < 4; k++) {
      const x = X + DX[k];
      const y = Y + DY[k];
      if (x >= 0 && y >= 0 && x < W && y < H && isLake[y * W + x] !== isLake[c]) {
        edge[c] = 1;
        break;
      }
    }
  }
  const near = new Uint8Array(W * H);
  for (let c = 0; c < W * H; c++) {
    if (!edge[c]) continue;
    const X = c % W;
    const Y = (c - X) / W;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = X + dx;
        const y = Y + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) near[y * W + x] = 1;
      }
    }
  }
  for (let c = 0; c < W * H; c++) {
    if (!near[c]) {
      sd[c] = isLake[c] ? 3 : -3;
      continue;
    }
    const X = c % W;
    const Y = (c - X) / W;
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
  return sd;
}
