import type { Climate } from '../core/climate';
import type { Stroke, Surface } from '../core/paint';
import { renderPicture, type MapStyle, type MapView, type RenderJob } from './paintmap';
import RenderWorker from './worker?worker&inline';

/**
 * Keeps drawn pieces of the map at several zoom levels, so the view can pan and zoom smoothly
 * while new detail is drawn in the background. When paint changes, only the changed part of each
 * piece is redrawn, so strokes appear as they are painted. These pieces are only pictures for
 * the screen; the world itself is the painted strokes.
 */

const PIECE = 256;
const MAX_PIECES = 420;

type Rect = [number, number, number, number];

interface Piece {
  key: string;
  level: number;
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement | null;
  /** Needs drawing in full. */
  full: boolean;
  /** Part that needs redrawing (km), if any. */
  dirty: Rect | null;
  pending: boolean;
  used: number;
}

export interface MapLook {
  style: MapStyle;
  zones: boolean;
  view: MapView;
  /** 1 northern summer, -1 northern winter. */
  season: 1 | -1;
}

export interface MapInfo {
  seed: number;
  widthKm: number;
  heightKm: number;
  wrap: boolean;
}

export interface View {
  cx: number;
  cy: number;
  /** CSS pixels per km. */
  scale: number;
}

interface Job {
  piece: Piece;
  /** Where the result goes in the piece, in pixels. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  live: boolean;
}

const kmPerPixel = (level: number) => 2 ** level;

export class MapCache {
  private pieces = new Map<string, Piece>();
  private queue: { piece: Piece; patch: boolean }[] = [];
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private jobs = new Map<number, Job>();
  private nextJob = 1;
  private useWorkers = true;
  private frame = 0;
  private surface: Surface;
  private look: MapLook = { style: 'satellite', zones: false, view: 'land', season: 1 };
  private climate: Climate | null = null;
  private info: MapInfo;

  constructor(surface: Surface, info: MapInfo, private onReady: () => void) {
    this.surface = surface;
    this.info = info;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new RenderWorker();
        w.onmessage = (e) => this.finished(w, e.data as { id: number; pixels: Uint8ClampedArray });
        w.onerror = () => this.dropWorkers();
        w.postMessage({ type: 'surface', surface });
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch {
      this.dropWorkers();
    }
  }

  /** Workers are unavailable here: draw on the page instead, a piece at a time. */
  private dropWorkers(): void {
    if (!this.useWorkers) return;
    this.useWorkers = false;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    for (const job of this.jobs.values()) {
      job.piece.pending = false;
      job.piece.full = true;
    }
    this.jobs.clear();
    this.pump();
  }

  /** Mark what a change touches. `bounds` (km) null means everything. */
  private touch(bounds: Rect | null): void {
    const W = this.info.widthKm;
    for (const p of this.pieces.values()) {
      if (!bounds) {
        p.full = true;
        continue;
      }
      const px = kmPerPixel(p.level);
      const size = PIECE * px;
      const x0 = p.cx * size;
      const y0 = p.cy * size;
      // Lighting reaches a pixel past a change.
      const m = px * 2;
      for (const off of this.info.wrap ? [0, -W, W] : [0]) {
        const r: Rect = [Math.max(x0, bounds[0] + off - m), Math.max(y0, bounds[1] - m), Math.min(x0 + size, bounds[2] + off + m), Math.min(y0 + size, bounds[3] + m)];
        if (r[0] >= r[2] || r[1] >= r[3]) continue;
        p.dirty = p.dirty ? [Math.min(p.dirty[0], r[0]), Math.min(p.dirty[1], r[1]), Math.max(p.dirty[2], r[2]), Math.max(p.dirty[3], r[3])] : r;
      }
    }
  }

  /** All the strokes changed (undo, redo, loading). `bounds` limits what needs redrawing. */
  setSurface(surface: Surface, bounds: Rect | null): void {
    this.surface = surface;
    for (const w of this.workers) w.postMessage({ type: 'surface', surface });
    this.touch(bounds);
  }

  /** One stroke was added or grew (live painting). */
  updateStroke(surface: Surface, stroke: Stroke, bounds: Rect): void {
    this.surface = surface;
    for (const w of this.workers) w.postMessage({ type: 'stroke', stroke });
    this.touch(bounds);
  }

  /** A new climate is ready: every picture is redrawn with it. */
  setClimate(cl: Climate | null): void {
    this.climate = cl;
    for (const w of this.workers) w.postMessage({ type: 'climate', climate: cl });
    this.touch(null);
  }

  setLook(look: MapLook): void {
    this.look = look;
  }

  /** The map's size or seed changed: start again. */
  reset(info: MapInfo, surface: Surface): void {
    this.info = info;
    this.pieces.clear();
    this.queue = [];
    for (const job of this.jobs.values()) job.live = false;
    this.setSurface(surface, null);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    cancelAnimationFrame(this.frame);
  }

  /** The zoom level to draw at for this many CSS pixels per km. */
  levelFor(scale: number): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    return Math.max(-7, Math.min(8, Math.round(Math.log2(1 / (scale * dpr)))));
  }

  private keyOf(level: number, cx: number, cy: number): string {
    return `${this.look.style}${this.look.zones ? 'z' : ''}|${this.look.view}${this.look.view === 'land' ? '' : this.look.season}|${level}|${cx}|${cy}`;
  }

  /** Pieces of a level that cover the visible part of the map. */
  private visible(level: number, view: View, w: number, h: number): [number, number][] {
    const size = PIECE * kmPerPixel(level);
    const { widthKm: W, heightKm: H } = this.info;
    const vx0 = view.cx - w / 2 / view.scale;
    const vx1 = view.cx + w / 2 / view.scale;
    const y0 = Math.max(0, view.cy - h / 2 / view.scale);
    const y1 = Math.min(H, view.cy + h / 2 / view.scale);
    if (y1 <= y0) return [];
    const cols = new Set<number>();
    for (const off of this.info.wrap ? [0, -W, W] : [0]) {
      const x0 = Math.max(0, vx0 - off);
      const x1 = Math.min(W, vx1 - off);
      if (x1 <= x0) continue;
      for (let cx = Math.floor(x0 / size); cx <= Math.floor((x1 - 1e-9) / size); cx++) cols.add(cx);
    }
    const out: [number, number][] = [];
    for (let cy = Math.floor(y0 / size); cy <= Math.floor((y1 - 1e-9) / size); cy++) for (const cx of cols) out.push([cx, cy]);
    return out;
  }

  /** Draw what is ready, and ask for what is missing or changed (nearest the middle first). */
  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number): void {
    const level = this.levelFor(view.scale);
    const now = performance.now();
    const W = this.info.widthKm;
    const offsets = this.info.wrap ? [-W, 0, W] : [0];
    ctx.imageSmoothingEnabled = true;
    // Coarser pictures first, as a stand-in until the detail arrives.
    for (let lv = level + 3; lv >= level; lv--) {
      for (const [cx, cy] of this.visible(lv, view, w, h)) {
        const p = this.pieces.get(this.keyOf(lv, cx, cy));
        if (!p?.canvas) continue;
        p.used = now;
        const size = PIECE * kmPerPixel(lv);
        for (const off of offsets) {
          const sx = w / 2 + (cx * size + off - view.cx) * view.scale;
          const sy = h / 2 + (cy * size - view.cy) * view.scale;
          const ss = size * view.scale;
          if (sx > w || sy > h || sx + ss < 0 || sy + ss < 0) continue;
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          ctx.drawImage(p.canvas, x0, y0, Math.ceil(sx + ss) - x0, Math.ceil(sy + ss) - y0);
        }
      }
    }
    // Changes to what is on screen come first, then a quick coarse pass, then full detail.
    const patches: { piece: Piece; patch: boolean }[] = [];
    const fills: { piece: Piece; patch: boolean }[] = [];
    const centre = ((view.cx % W) + W) % W;
    for (const lv of [level, level + 2]) {
      const size = PIECE * kmPerPixel(lv);
      const list = this.visible(lv, view, w, h)
        .map(([cx, cy]) => ({ cx, cy, d: Math.hypot((cx + 0.5) * size - centre, (cy + 0.5) * size - view.cy) }))
        .sort((a, b) => a.d - b.d);
      for (const { cx, cy } of list) {
        const key = this.keyOf(lv, cx, cy);
        let p = this.pieces.get(key);
        if (!p) {
          p = { key, level: lv, cx, cy, canvas: null, full: true, dirty: null, pending: false, used: now };
          this.pieces.set(key, p);
        }
        p.used = now;
        if (p.pending) continue;
        if (!p.canvas || p.full) fills.push({ piece: p, patch: false });
        else if (p.dirty) patches.push({ piece: p, patch: true });
      }
    }
    // Coarse fills before fine ones.
    fills.sort((a, b) => b.piece.level - a.piece.level);
    this.queue = [...patches, ...fills];
    this.evict();
    this.pump();
  }

  /** True while pictures are still being drawn. */
  get busy(): boolean {
    return this.jobs.size > 0 || this.queue.length > 0;
  }

  private evict(): void {
    if (this.pieces.size <= MAX_PIECES) return;
    const list = [...this.pieces.values()].filter((p) => !p.pending).sort((a, b) => a.used - b.used);
    for (const p of list.slice(0, this.pieces.size - MAX_PIECES)) this.pieces.delete(p.key);
  }

  /** Turn a queued piece into a drawing job: the whole piece, or just its changed part. */
  private makeJob(p: Piece, patch: boolean): { job: Job; render: RenderJob } {
    const px = kmPerPixel(p.level);
    const size = PIECE * px;
    let ox = 0;
    let oy = 0;
    let w = PIECE;
    let h = PIECE;
    if (patch && p.dirty) {
      ox = Math.max(0, Math.floor((p.dirty[0] - p.cx * size) / px));
      oy = Math.max(0, Math.floor((p.dirty[1] - p.cy * size) / px));
      w = Math.min(PIECE, Math.ceil((p.dirty[2] - p.cx * size) / px)) - ox;
      h = Math.min(PIECE, Math.ceil((p.dirty[3] - p.cy * size) / px)) - oy;
    }
    p.full = false;
    p.dirty = null;
    p.pending = true;
    const render: RenderJob = { x0: p.cx * size + ox * px, y0: p.cy * size + oy * px, px, w: Math.max(1, w), h: Math.max(1, h), style: this.look.style, zones: this.look.zones, view: this.look.view, season: this.look.season, ...this.info };
    return { job: { piece: p, ox, oy, w: render.w, h: render.h, live: true }, render };
  }

  private pump(): void {
    if (this.useWorkers) {
      while (this.idle.length && this.queue.length) {
        const { piece, patch } = this.queue.shift()!;
        if (piece.pending) continue;
        const w = this.idle.pop()!;
        const id = this.nextJob++;
        const { job, render } = this.makeJob(piece, patch);
        this.jobs.set(id, job);
        w.postMessage({ type: 'job', id, job: render });
      }
      return;
    }
    if (this.jobs.size || !this.queue.length) return;
    const { piece, patch } = this.queue.shift()!;
    const id = this.nextJob++;
    const { job, render } = this.makeJob(piece, patch);
    this.jobs.set(id, job);
    setTimeout(() => this.finished(null, { id, pixels: renderPicture(this.surface, render, this.climate) }), 0);
  }

  private finished(w: Worker | null, m: { id: number; pixels: Uint8ClampedArray }): void {
    const job = this.jobs.get(m.id);
    this.jobs.delete(m.id);
    if (w) this.idle.push(w);
    if (job) {
      const p = job.piece;
      p.pending = false;
      if (job.live) {
        if (!p.canvas) {
          p.canvas = document.createElement('canvas');
          p.canvas.width = PIECE;
          p.canvas.height = PIECE;
        }
        p.canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(m.pixels), job.w, job.h), job.ox, job.oy);
      }
    }
    // Redraw (which also hands out the next jobs) once per frame.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.onReady());
  }
}
