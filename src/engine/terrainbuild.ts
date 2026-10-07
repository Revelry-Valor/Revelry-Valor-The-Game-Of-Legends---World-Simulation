import { erodeRelief, type ErosionOptions, type ReliefField } from './erosion';

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

interface Chunk {
  /** The tiles this piece is responsible for. */
  core: Box;
  /** The tiles it is carved from (the core and its margin, within the map). */
  ext: Box;
  field: ReliefField | null;
}

/**
 * Carves the map's land piece by piece, so that when part of it changes only the pieces touching
 * the change are carved again and the rest of the map stays exactly as it was. The whole map is
 * carved the same way, so a world built in one go matches one built up stroke by stroke.
 *
 * Each piece is carved with a margin of land around it and blended into its neighbours over a few
 * tiles, so the seams don't show; the mountain shapes come from the same noise across the map.
 */
export class ChunkCarver {
  readonly scale: number;
  readonly field: ReliefField;
  private chunks: Chunk[] = [];
  private sea: Uint8Array | null = null;
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
  }

  /**
   * Carve the land (tile heights, sea below 0). With `dirty`, only the pieces whose land reaches
   * into that box are carved again; without it (or the first time), all of them.
   */
  carve(surface: Float32Array, sea: Uint8Array, dirty?: Box | null): ReliefField {
    const todo: number[] = [];
    this.chunks.forEach((c, k) => {
      if (!c.field || !dirty || overlaps(c.ext, dirty)) todo.push(k);
    });
    this.sea = sea;
    this.changed = null;
    if (!todo.length) return this.field;
    const { w } = this;
    for (const k of todo) {
      const c = this.chunks[k];
      const cw = c.ext.x1 - c.ext.x0 + 1;
      const ch = c.ext.y1 - c.ext.y0 + 1;
      const surf = new Float32Array(cw * ch);
      const water = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const t = (c.ext.y0 + y) * w + c.ext.x0 + x;
          surf[y * cw + x] = surface[t];
          water[y * cw + x] = sea[t];
        }
      }
      c.field = erodeRelief(surf, water, cw, ch, { ...this.opts, scale: this.scale, offset: [c.ext.x0, c.ext.y0] });
    }
    // Blend again everywhere a re-carved piece reaches.
    let box: Box | null = null;
    for (const k of todo) {
      const c = this.chunks[k].core;
      const b = { x0: c.x0 - FEATHER, y0: c.y0 - FEATHER, x1: c.x1 + FEATHER, y1: c.y1 + FEATHER };
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    }
    this.blend(box!);
    this.changed = { x0: Math.max(0, box!.x0), y0: Math.max(0, box!.y0), x1: Math.min(this.w - 1, box!.x1), y1: Math.min(this.h - 1, box!.y1) };
    return this.field;
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
    // Under the sea where the tiles around, blended, are more sea than land (as the carving has it).
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

function overlaps(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
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
