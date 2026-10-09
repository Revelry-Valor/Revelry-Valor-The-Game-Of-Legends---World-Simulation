import { erodeRelief, normaliseMaps, type ErosionOptions, type ReliefField } from './erosion';

/** A rectangle of tiles, inclusive. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The land is carved in square pieces this many tiles across... */
const CHUNK = 32;
/** ...each carved with this much land around it, so its edges carve as if the map went on... */
const MARGIN = 7;
/** ...and blended into its neighbours across this many tiles either side of the seam. */
const FEATHER = 4;
/** How far, in tiles, a change to the tiles reaches into the land laid out from them. */
const SPREAD = 3;

interface Chunk {
  /** The tiles this piece is responsible for. */
  core: Box;
  /** The tiles it is carved from (the core and its margin, within the map). */
  ext: Box;
  field: ReliefField | null;
}

/** What the land is carved from: tile heights, the sea, and the land shaped by hand on the fine grid. */
interface Inputs {
  surface: Float32Array;
  sea: Uint8Array;
  relief: Float32Array | null;
}

/**
 * Carves the map's land: all of it the first time (in pieces, blended at the seams), and after that
 * only the land a change touched.
 *
 * A change is worked out as a difference. The land around it is carved twice, as it was and as it
 * is now, from the same piece of map with the same rain; the difference between the two is what
 * the change did, and it is added to the land as it was, on the cells the change touched and on no
 * others. Everything else stays exactly as it was. While a stroke is still being drawn (`erode`
 * false) the change is shown at once as drawn, and worn by water when it is finished.
 */
export class ChunkCarver {
  readonly scale: number;
  readonly field: ReliefField;
  private chunks: Chunk[] = [];
  private sea: Uint8Array | null = null;
  /** The land as last carved in full (before any change still being drawn). */
  private base: { heights: Float32Array; wear: Float32Array; deposits: Float32Array; flow: Float32Array } | null = null;
  /** What that carving was carved from. */
  private done: Inputs | null = null;
  /** The scales of the wear, deposit and flow maps over the whole map. */
  private tops: [number, number, number] | undefined;
  /** Tiles changed by a stroke still being drawn, since the land was last carved. */
  private pending: Box | null = null;
  /** The land as shaped (before carving) at the last carving, around the stroke being drawn. */
  private shapedCache: { win: Box; f: ReliefField } | null = null;
  /** The tiles the last carve changed (null if none). */
  changed: Box | null = null;
  private nx: number;
  private ny: number;

  constructor(readonly w: number, readonly h: number, private opts: ErosionOptions) {
    this.scale = opts.scale ?? 4;
    const S = this.scale;
    const W = w * S;
    const H = h * S;
    this.field = {
      heights: new Float32Array(W * H),
      wear: new Float32Array(W * H),
      deposits: new Float32Array(W * H),
      flow: new Float32Array(W * H),
      water: new Uint8Array(W * H),
      width: W,
      height: H,
      scale: S,
    };
    this.nx = Math.ceil(w / CHUNK);
    this.ny = Math.ceil(h / CHUNK);
    for (let cy = 0; cy < this.ny; cy++) {
      for (let cx = 0; cx < this.nx; cx++) {
        const core = { x0: cx * CHUNK, y0: cy * CHUNK, x1: Math.min(w, (cx + 1) * CHUNK) - 1, y1: Math.min(h, (cy + 1) * CHUNK) - 1 };
        const ext = { x0: Math.max(0, core.x0 - MARGIN), y0: Math.max(0, core.y0 - MARGIN), x1: Math.min(w - 1, core.x1 + MARGIN), y1: Math.min(h - 1, core.y1 + MARGIN) };
        this.chunks.push({ core, ext, field: null });
      }
    }
  }

  /** Change the carving settings: everything is carved again on the next call. */
  setOptions(opts: ErosionOptions): void {
    this.opts = { ...opts, scale: this.scale };
    for (const c of this.chunks) c.field = null;
    this.base = null;
    this.done = null;
  }

  /**
   * Carve the land (tile heights, sea below 0, and the land shaped by hand on the fine grid). With
   * `dirty`, only the land changed within that box is carved again; without it (or the first time),
   * all of it. `erode` false shows a change as drawn, to be worn by water on a later call.
   */
  carve(surface: Float32Array, sea: Uint8Array, relief: Float32Array | null = null, dirty?: Box | null, erode = true): ReliefField {
    const now: Inputs = { surface, sea, relief };
    if (!dirty || !this.base || !this.done) return this.full(now);
    this.sea = sea;
    this.changed = null;
    const box = union(dirty.x1 >= dirty.x0 && dirty.y1 >= dirty.y0 ? dirty : null, this.pending);
    if (!box) return this.field;
    if (!erode) {
      // Only what this step of the stroke changed needs showing; earlier steps are shown already.
      if (dirty.x1 >= dirty.x0 && dirty.y1 >= dirty.y0) this.preview(dirty, now);
      this.pending = box;
    } else {
      this.commit(box, now);
      this.pending = null;
      this.shapedCache = null;
    }
    return this.field;
  }

  /** Carve the whole map, piece by piece. */
  private full(now: Inputs): ReliefField {
    const { w, h } = this;
    this.sea = now.sea;
    for (const c of this.chunks) c.field = this.carveWindow(c.ext, now, true);
    this.blend({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
    // The data maps are scaled over the whole map once, and every later change with the same scales.
    this.tops = normaliseMaps(this.field);
    for (const c of this.chunks) c.field = null;
    const f = this.field;
    this.base = { heights: Float32Array.from(f.heights), wear: Float32Array.from(f.wear), deposits: Float32Array.from(f.deposits), flow: Float32Array.from(f.flow) };
    this.done = copyInputs(now);
    this.pending = null;
    this.shapedCache = null;
    this.changed = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    return f;
  }

  /** Carve one piece of the map (tiles `win`), as it would be carved as part of the whole. */
  private carveWindow(win: Box, inp: Inputs, raw: boolean, stage?: 'mountains', keepShaped = false): ReliefField {
    const { w } = this;
    const S = this.scale;
    const cw = win.x1 - win.x0 + 1;
    const ch = win.y1 - win.y0 + 1;
    const surf = new Float32Array(cw * ch);
    const water = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const t = (win.y0 + y) * w + win.x0 + x;
        surf[y * cw + x] = inp.surface[t];
        water[y * cw + x] = inp.sea[t];
      }
    }
    let relief: Float32Array | null = null;
    if (inp.relief) {
      const W = w * S;
      const RW = cw * S;
      relief = new Float32Array(RW * ch * S);
      for (let Y = 0; Y < ch * S; Y++) relief.set(inp.relief.subarray((win.y0 * S + Y) * W + win.x0 * S, (win.y0 * S + Y) * W + (win.x1 + 1) * S), Y * RW);
    }
    const r = erodeRelief(surf, water, cw, ch, { ...this.opts, scale: S, offset: [win.x0, win.y0], relief, raw, stage, keepShaped });
    if (!raw && stage !== 'mountains') normaliseMaps(r, this.tops);
    return r;
  }

  /**
   * Show a change as drawn, before water wears it: the land as carved, plus what the change added,
   * over the tiles of `box`. The land as it was shaped is kept around the stroke, so each step of
   * the stroke shapes only its own few tiles.
   */
  private preview(box: Box, now: Inputs): void {
    const { w, h } = this;
    const S = this.scale;
    const grow = (b: Box, d: number): Box => ({ x0: Math.max(0, b.x0 - d), y0: Math.max(0, b.y0 - d), x1: Math.min(w - 1, b.x1 + d), y1: Math.min(h - 1, b.y1 + d) });
    // Shaped with SPREAD tiles of land around the box, so the box itself is shaped as part of the whole.
    const win = grow(box, SPREAD);
    const c = this.shapedCache;
    if (!c || win.x0 < c.win.x0 || win.y0 < c.win.y0 || win.x1 > c.win.x1 || win.y1 > c.win.y1) {
      const cw = grow(c ? union(c.win, win)! : win, 16);
      this.shapedCache = { win: cw, f: this.carveWindow(cw, this.done!, true, 'mountains') };
    }
    const cache = this.shapedCache!;
    const is = this.carveWindow(win, now, true, 'mountains');
    // The land as it was over the same window, from the cache.
    const was: ReliefField = { ...is, heights: new Float32Array(is.heights.length), water: new Uint8Array(is.water.length) };
    const ox = (win.x0 - cache.win.x0) * S;
    const oy = (win.y0 - cache.win.y0) * S;
    for (let y = 0; y < is.height; y++) {
      for (let x = 0; x < is.width; x++) {
        const k = (y + oy) * cache.f.width + x + ox;
        was.heights[y * is.width + x] = cache.f.heights[k];
        was.water[y * is.width + x] = cache.f.water[k];
      }
    }
    this.lay(win, was, is, null, null, box);
  }

  /** Wear a change with water: the land around it carved as it was and as it is, the difference laid in where it changed. */
  private commit(box: Box, now: Inputs): void {
    const { w, h } = this;
    const win = { x0: Math.max(0, box.x0 - SPREAD - MARGIN), y0: Math.max(0, box.y0 - SPREAD - MARGIN), x1: Math.min(w - 1, box.x1 + SPREAD + MARGIN), y1: Math.min(h - 1, box.y1 + SPREAD + MARGIN) };
    const wasC = this.carveWindow(win, this.done!, false, undefined, true);
    const isC = this.carveWindow(win, now, false, undefined, true);
    this.lay(win, { ...wasC, heights: wasC.shaped! }, { ...isC, heights: isC.shaped! }, wasC, isC);
    const f = this.field;
    const b = this.base!;
    // What is shown now is the land as carved.
    b.heights.set(f.heights);
    b.wear.set(f.wear);
    b.deposits.set(f.deposits);
    b.flow.set(f.flow);
    this.done = copyInputs(now);
  }

  /**
   * Lay a change into the land, on the cells it touched and no others: where the land as shaped
   * (before carving) differs between `was` and `is`. Carved (`wasC`, `isC`), the change is what the
   * carving did differently; otherwise it is the change as drawn.
   */
  private lay(win: Box, was: ReliefField, is: ReliefField, wasC: ReliefField | null, isC: ReliefField | null, only?: Box): void {
    const S = this.scale;
    const f = this.field;
    const b = this.base!;
    const W = f.width;
    let changed: Box | null = null;
    // Within `only` (tiles), if given: the rest of the window is there to shape it as part of the whole.
    const ys = only ? (only.y0 - win.y0) * S : 0;
    const ye = only ? (only.y1 + 1 - win.y0) * S : is.height;
    const xs = only ? (only.x0 - win.x0) * S : 0;
    const xe = only ? (only.x1 + 1 - win.x0) * S : is.width;
    for (let y = ys; y < ye; y++) {
      const Y = win.y0 * S + y;
      for (let x = xs; x < xe; x++) {
        const X = win.x0 * S + x;
        const j = y * is.width + x;
        const i = Y * W + X;
        const dp = is.heights[j] - was.heights[j];
        const wet = is.water[j] !== was.water[j];
        if (dp === 0 && !wet) {
          // Untouched: as carved (undoing anything an earlier preview showed here).
          f.heights[i] = b.heights[i];
          f.wear[i] = b.wear[i];
          f.deposits[i] = b.deposits[i];
          f.flow[i] = b.flow[i];
          continue;
        }
        if (wasC && isC) {
          // Faded in by how much the land changed, so the edge of a stroke meets the land around it.
          const k0 = wet ? 1 : Math.min(1, Math.abs(dp) / 0.004);
          const k = k0 * k0 * (3 - 2 * k0);
          f.heights[i] = Math.max(0, b.heights[i] + k * (isC.heights[j] - wasC.heights[j]) + (1 - k) * dp);
          f.wear[i] = clamp01(b.wear[i] + k * (isC.wear[j] - wasC.wear[j]));
          f.deposits[i] = clamp01(b.deposits[i] + k * (isC.deposits[j] - wasC.deposits[j]));
          f.flow[i] = clamp01(b.flow[i] + k * (isC.flow[j] - wasC.flow[j]));
        } else {
          f.heights[i] = Math.max(0, b.heights[i] + dp);
          f.wear[i] = b.wear[i];
          f.deposits[i] = b.deposits[i];
          f.flow[i] = b.flow[i];
        }
        const tx = Math.floor(X / S);
        const ty = Math.floor(Y / S);
        changed = union(changed, { x0: tx, y0: ty, x1: tx, y1: ty });
      }
    }
    // Cells shown changed by an earlier preview but no longer changed were put back above: repaint those too.
    if (this.pending && !only) changed = union(changed, this.pending);
    if (changed) this.seaMask(changed);
    this.changed = changed;
  }

  /** Each cell of the box as the weighted sum of the pieces covering it (weights add up to 1). */
  private blend(box: Box): void {
    const S = this.scale;
    const f = this.field;
    const W = f.width;
    const X0 = Math.max(0, box.x0 * S);
    const Y0 = Math.max(0, box.y0 * S);
    const X1 = Math.min(f.width - 1, (box.x1 + 1) * S - 1);
    const Y1 = Math.min(f.height - 1, (box.y1 + 1) * S - 1);
    for (let Y = Y0; Y <= Y1; Y++) {
      for (let X = X0; X <= X1; X++) {
        f.heights[Y * W + X] = 0;
        f.wear[Y * W + X] = 0;
        f.deposits[Y * W + X] = 0;
        f.flow[Y * W + X] = 0;
        f.water[Y * W + X] = 0;
      }
    }
    // Ramps in tiles: 0 at (seam - FEATHER), 1 at (seam + FEATHER).
    const ramp = (v: number, seam: number) => Math.min(1, Math.max(0, (v - (seam - FEATHER)) / (2 * FEATHER)));
    for (const c of this.chunks) {
      const r = c.field;
      if (!r) continue;
      const cx0 = Math.max(X0, (c.core.x0 - FEATHER) * S);
      const cy0 = Math.max(Y0, (c.core.y0 - FEATHER) * S);
      const cx1 = Math.min(X1, (c.core.x1 + 1 + FEATHER) * S - 1);
      const cy1 = Math.min(Y1, (c.core.y1 + 1 + FEATHER) * S - 1);
      if (cx0 > cx1 || cy0 > cy1) continue;
      const hasL = c.core.x0 > 0;
      const hasR = c.core.x1 < this.w - 1;
      const hasT = c.core.y0 > 0;
      const hasB = c.core.y1 < this.h - 1;
      const ox = c.ext.x0 * S;
      const oy = c.ext.y0 * S;
      for (let Y = cy0; Y <= cy1; Y++) {
        const ty = (Y + 0.5) / S;
        const wy = (hasT ? ramp(ty, c.core.y0) : 1) * (hasB ? 1 - ramp(ty, c.core.y1 + 1) : 1);
        if (wy <= 0) continue;
        for (let X = cx0; X <= cx1; X++) {
          const tx = (X + 0.5) / S;
          const wgt = wy * (hasL ? ramp(tx, c.core.x0) : 1) * (hasR ? 1 - ramp(tx, c.core.x1 + 1) : 1);
          if (wgt <= 0) continue;
          const lx = X - ox;
          const ly = Y - oy;
          if (lx < 0 || ly < 0 || lx >= r.width || ly >= r.height) continue;
          const j = ly * r.width + lx;
          const i = Y * W + X;
          f.heights[i] += r.heights[j] * wgt;
          f.wear[i] += r.wear[j] * wgt;
          f.deposits[i] += r.deposits[j] * wgt;
          f.flow[i] += r.flow[j] * wgt;
        }
      }
    }
    this.seaMask(box);
  }

  /** Under the sea where the tiles around, blended, are more sea than land (as the carving has it). */
  private seaMask(box: Box): void {
    const S = this.scale;
    const f = this.field;
    const W = f.width;
    const X0 = Math.max(0, box.x0 * S);
    const Y0 = Math.max(0, box.y0 * S);
    const X1 = Math.min(f.width - 1, (box.x1 + 1) * S - 1);
    const Y1 = Math.min(f.height - 1, (box.y1 + 1) * S - 1);
    const sea = this.sea!;
    const { w, h } = this;
    for (let Y = Y0; Y <= Y1; Y++) {
      const fy = (Y + 0.5) / S - 0.5;
      const ty0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
      const ty1 = Math.min(h - 1, Math.floor(fy) + 1);
      const vy = Math.min(1, Math.max(0, fy - Math.floor(fy)));
      for (let X = X0; X <= X1; X++) {
        const fx = (X + 0.5) / S - 0.5;
        const tx0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
        const tx1 = Math.min(w - 1, Math.floor(fx) + 1);
        const vx = Math.min(1, Math.max(0, fx - Math.floor(fx)));
        const wet = (sea[ty0 * w + tx0] * (1 - vx) + sea[ty0 * w + tx1] * vx) * (1 - vy) + (sea[ty1 * w + tx0] * (1 - vx) + sea[ty1 * w + tx1] * vx) * vy;
        f.water[Y * W + X] = wet >= 0.5 ? 1 : 0;
      }
    }
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function union(a: Box | null, b: Box | null): Box | null {
  return !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function copyInputs(i: Inputs): Inputs {
  return { surface: Float32Array.from(i.surface), sea: Uint8Array.from(i.sea), relief: i.relief ? Float32Array.from(i.relief) : null };
}

/** A copy of a carved field, to work water into without touching the original. */
export function copyField(f: ReliefField): ReliefField {
  return {
    ...f,
    heights: Float32Array.from(f.heights),
    wear: Float32Array.from(f.wear),
    deposits: Float32Array.from(f.deposits),
    flow: Float32Array.from(f.flow),
    water: Uint8Array.from(f.water),
    lake: undefined,
    lakeSd: undefined,
  };
}

/**
 * Land held as the Smooth and Ramp tools left it: on the fine grid, how firmly each cell is held
 * (0 not at all .. 1 exactly) and the height it is held at. Held land stays as it was smoothed,
 * whatever the carving does under it, until another tool reshapes it.
 */
export interface Held {
  weight: Float32Array;
  level: Float32Array;
}

/** The carved land's maps, before any held land is laid on them. */
export interface LandMaps {
  heights: Float32Array;
  wear: Float32Array;
  deposits: Float32Array;
  flow: Float32Array;
}

/**
 * Lay held land over the carved land `f`, from its maps as carved (`src`), over a box of tiles (or
 * all of it). The held cells take their held height; the marks of wear there fade, as on ground
 * smoothed over. Water is left alone.
 */
export function applyHeld(f: ReliefField, src: LandMaps, held: Held | null, box?: Box): void {
  const S = f.scale;
  const X0 = box ? Math.max(0, box.x0 * S) : 0;
  const Y0 = box ? Math.max(0, box.y0 * S) : 0;
  const X1 = box ? Math.min(f.width, (box.x1 + 1) * S) : f.width;
  const Y1 = box ? Math.min(f.height, (box.y1 + 1) * S) : f.height;
  for (let Y = Y0; Y < Y1; Y++) {
    for (let X = X0; X < X1; X++) {
      const i = Y * f.width + X;
      const w = held ? held.weight[i] : 0;
      if (w <= 0 || f.water[i] || f.lake?.[i]) {
        f.heights[i] = src.heights[i];
        f.wear[i] = src.wear[i];
        f.deposits[i] = src.deposits[i];
        f.flow[i] = src.flow[i];
        continue;
      }
      f.heights[i] = src.heights[i] + (held!.level[i] - src.heights[i]) * w;
      f.wear[i] = src.wear[i] * (1 - 0.8 * w);
      f.deposits[i] = src.deposits[i] * (1 - 0.5 * w);
      f.flow[i] = src.flow[i] * (1 - 0.8 * w);
    }
  }
}
