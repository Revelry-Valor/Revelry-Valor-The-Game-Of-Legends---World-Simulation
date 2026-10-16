import type { Surface } from '../core/paint';
import { renderPicture, type MapStyle, type RenderJob } from './paintmap';
import RenderWorker from './worker?worker&inline';

/**
 * Keeps drawn pieces of the map at several zoom levels, so the view can pan and zoom smoothly
 * while new detail is drawn in the background. These pieces are only pictures for the screen;
 * the world itself is the painted strokes.
 */

const PIECE = 256;
const MAX_PIECES = 420;

interface Piece {
  key: string;
  level: number;
  cx: number;
  cy: number;
  canvas: HTMLCanvasElement | null;
  /** Surface version the picture was drawn from. */
  version: number;
  pending: boolean;
  used: number;
}

export interface MapLook {
  style: MapStyle;
  zones: boolean;
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

const kmPerPixel = (level: number) => 2 ** level;

export class MapCache {
  private pieces = new Map<string, Piece>();
  private version = 0;
  /** Recent changes: anything drawn before `version` inside `bounds` is out of date. */
  private changes: { version: number; bounds: [number, number, number, number] | null }[] = [];
  private queue: Piece[] = [];
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private jobs = new Map<number, { piece: Piece; version: number; worker: Worker | null }>();
  private nextJob = 1;
  private useWorkers = true;
  private frame = 0;
  private surface: Surface;
  private look: MapLook = { style: 'satellite', zones: false };
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
    for (const job of this.jobs.values()) job.piece.pending = false;
    this.jobs.clear();
    this.pump();
  }

  /** The strokes changed. `bounds` (km) limits what needs redrawing; null redraws everything. */
  setSurface(surface: Surface, bounds: [number, number, number, number] | null): void {
    this.surface = surface;
    this.version++;
    this.changes.push({ version: this.version, bounds });
    if (this.changes.length > 300) {
      this.changes = this.changes.slice(-300);
      // Older changes are forgotten, so pieces older than them can't be trusted.
      const oldest = this.changes[0].version;
      for (const [k, p] of this.pieces) if (p.version < oldest && !p.pending) this.pieces.delete(k);
    }
    for (const w of this.workers) w.postMessage({ type: 'surface', surface });
  }

  setLook(look: MapLook): void {
    this.look = look;
  }

  /** The map's size or seed changed: start again. */
  reset(info: MapInfo, surface: Surface): void {
    this.info = info;
    this.pieces.clear();
    this.queue = [];
    this.changes = [];
    for (const job of this.jobs.values()) job.version = -1;
    this.setSurface(surface, null);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    cancelAnimationFrame(this.frame);
  }

  private stale(p: Piece): boolean {
    if (p.version === this.version) return false;
    const size = PIECE * kmPerPixel(p.level);
    const x0 = p.cx * size;
    const y0 = p.cy * size;
    // Allow for lighting and stroke edges reaching a little past their bounds.
    const m = kmPerPixel(p.level) * 2;
    for (const c of this.changes) {
      if (c.version <= p.version) continue;
      if (!c.bounds) return true;
      const [bx0, by0, bx1, by1] = c.bounds;
      const W = this.info.widthKm;
      for (const off of this.info.wrap ? [0, -W, W] : [0]) {
        if (bx1 + off >= x0 - m && bx0 + off <= x0 + size + m && by1 >= y0 - m && by0 <= y0 + size + m) return true;
      }
    }
    return false;
  }

  /** The zoom level to draw at for this many CSS pixels per km. */
  levelFor(scale: number): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    return Math.max(-7, Math.min(8, Math.round(Math.log2(1 / (scale * dpr)))));
  }

  private keyOf(level: number, cx: number, cy: number): string {
    return `${this.look.style}${this.look.zones ? 'z' : ''}|${level}|${cx}|${cy}`;
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

  /** Draw what is ready, and ask for what is missing (nearest the middle first). */
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
    // What still needs drawing: a quick coarse pass, then full detail.
    const wanted: Piece[] = [];
    const cxKm = view.cx;
    const cyKm = view.cy;
    for (const lv of [level + 2, level]) {
      const size = PIECE * kmPerPixel(lv);
      const list = this.visible(lv, view, w, h)
        .map(([cx, cy]) => ({ cx, cy, d: Math.hypot((cx + 0.5) * size - (((cxKm % W) + W) % W), (cy + 0.5) * size - cyKm) }))
        .sort((a, b) => a.d - b.d);
      for (const { cx, cy } of list) {
        const key = this.keyOf(lv, cx, cy);
        let p = this.pieces.get(key);
        if (!p) {
          p = { key, level: lv, cx, cy, canvas: null, version: -1, pending: false, used: now };
          this.pieces.set(key, p);
        }
        p.used = now;
        if (!p.pending && (!p.canvas || this.stale(p))) wanted.push(p);
      }
    }
    this.queue = wanted;
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

  private job(p: Piece): RenderJob {
    const px = kmPerPixel(p.level);
    return { x0: p.cx * PIECE * px, y0: p.cy * PIECE * px, px, w: PIECE, h: PIECE, style: this.look.style, zones: this.look.zones, ...this.info };
  }

  private pump(): void {
    if (this.useWorkers) {
      while (this.idle.length && this.queue.length) {
        const p = this.queue.shift()!;
        const w = this.idle.pop()!;
        const id = this.nextJob++;
        p.pending = true;
        this.jobs.set(id, { piece: p, version: this.version, worker: w });
        // Pass the look with the job: the look can change while it waits.
        w.postMessage({ type: 'job', id, job: this.job(p) });
      }
      return;
    }
    if (this.jobs.size || !this.queue.length) return;
    const p = this.queue.shift()!;
    const id = this.nextJob++;
    p.pending = true;
    this.jobs.set(id, { piece: p, version: this.version, worker: null });
    setTimeout(() => this.finished(null, { id, pixels: renderPicture(this.surface, this.job(p)) }), 0);
  }

  private finished(w: Worker | null, m: { id: number; pixels: Uint8ClampedArray }): void {
    const job = this.jobs.get(m.id);
    this.jobs.delete(m.id);
    if (w) this.idle.push(w);
    if (job && job.version >= 0) {
      const p = job.piece;
      p.pending = false;
      if (job.version > p.version) {
        p.canvas ??= document.createElement('canvas');
        p.canvas.width = PIECE;
        p.canvas.height = PIECE;
        p.canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(m.pixels), PIECE, PIECE), 0, 0);
        p.version = job.version;
        if (!this.pieces.has(p.key)) this.pieces.set(p.key, p);
      }
    }
    // Redraw (which also hands out the next jobs) once per frame.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.onReady());
  }
}
