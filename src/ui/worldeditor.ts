import { BRUSHES, TerrainEditor, strokeLevel, type BrushTool, type ToolGroup } from '../engine/editor';
import { Rng } from '../engine/rng';
import type { Box, ChunkCarver } from '../engine/terrainbuild';
import type { MapData, WorldConfig } from '../engine/types';
import { emptyWater, type WaterPlan } from '../engine/water';
import { carverFor, decodeHeights, encodeHeights, generateMap } from '../engine/worldgen';
import BuilderWorker from './builder.worker?worker&inline';
import { drawCurrents, paintClimate, type ClimateLayer } from './render';
import { FEET_PER_UNIT, TerrainShader, drawContourLabels, drawRiverCurves, riverCurves, type MapStyle } from './terrain';

export type EditorView = 'terrain' | ClimateLayer;

/** Pixels per tile the editor paints the land at. */
const SCALE = 6;

/** One step that can be undone: the land and water before it, and where the land changed. */
interface Step {
  water: string;
  box: Box | null;
}

const union = (a: Box | null, b: Box | null): Box | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

/**
 * The world editor, in three parts you can move between at will: Land & Sea (the outline of the
 * world, as in a flat map program), Terrain (shaping the land) and Water (rivers and lakes, only
 * where you put them).
 *
 * The world is built on a background thread. Only the part of the land you change is carved again
 * and painted again; the rest of the map stays exactly as it was.
 */
export class WorldEditor {
  cfg: WorldConfig;
  map: MapData | null = null;
  editor: TerrainEditor;
  tab: ToolGroup = 'outline';
  tools: Record<ToolGroup, BrushTool> = { outline: 'land', terrain: 'mountains', water: 'river' };
  radius = 8;
  strength = 0.5;
  roughness = 0.5;
  /** Height limit for raising tools, and the lowest height for lowering ones, in feet. */
  topFeet = 9000;
  floorFeet = 0;
  layer: EditorView = 'terrain';
  style: MapStyle = 'drawn';
  contours = false;
  water: WaterPlan;
  /** A river being drawn: its points so far. */
  pending: [number, number][] | null = null;
  selected: { kind: 'river' | 'lake'; index: number } | null = null;
  /** Pointer position in tiles, for the brush outline. */
  cursor: { x: number; y: number } | null = null;
  /** Called when a new build is on show (to redraw the map). */
  onChange?: () => void;
  /** Called when a build starts (to say so). */
  onStatus?: () => void;
  /** A message for the panel (what just happened, or why not). */
  note = '';
  private terrain = document.createElement('canvas');
  private climate = document.createElement('canvas');
  private stroke: { x: number; y: number; level?: number; lastEdit?: [number, number] } | null = null;
  private steps: Step[] = [];
  private worker: Worker | null = null;
  private localCarver: ChunkCarver | null = null;
  private job = 0;
  private busy = false;
  private queued = false;
  /** Land changed since the last build was sent (to carve again). */
  private dirty: Box | null = null;
  /** What to paint again when the next build lands: a box of tiles, or everything. */
  private repaint: Box | 'all' | null = 'all';
  private inFlight: { repaint: Box | 'all' | null } | null = null;

  constructor(cfg: WorldConfig, style: MapStyle = 'drawn', contours = false) {
    this.cfg = { ...cfg };
    this.style = style;
    this.contours = contours;
    this.water = cfg.water ? JSON.parse(JSON.stringify(cfg.water)) : emptyWater();
    const { width: w, height: h } = cfg;
    const land = cfg.heightmap ? decodeHeights(cfg.heightmap, w, h) : null;
    this.editor = new TerrainEditor(land ?? new Float32Array(w * h), w, h, cfg.seed);
    // No land drawn yet: a blank ocean to start from.
    if (!land) this.editor.clear();
    try {
      this.worker = new BuilderWorker();
      this.worker.onmessage = (e: MessageEvent<{ id: number; map: MapData; changed: Box | null; full: boolean }>) => this.received(e.data.id, e.data.map, e.data.changed, e.data.full);
      this.worker.onerror = () => {
        this.worker = null;
        this.busy = false;
        this.repaint = 'all';
        this.request();
      };
    } catch {
      this.worker = null;
    }
    this.dirty = null;
    this.request(true);
  }

  /** Stop building (the editor is closing). */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.onChange = undefined;
    this.onStatus = undefined;
  }

  get tool(): BrushTool {
    return this.tools[this.tab];
  }

  set tool(t: BrushTool) {
    const b = BRUSHES.find((x) => x.id === t);
    if (b) {
      this.tab = b.group;
      this.tools[b.group] = t;
    }
  }

  get width(): number {
    return this.cfg.width;
  }

  get height(): number {
    return this.cfg.height;
  }

  get painting(): boolean {
    return this.stroke !== null;
  }

  /** Whether a build is under way (the panel says so). */
  get working(): boolean {
    return this.busy || this.queued;
  }

  /** The hand-shaped land as a code to keep in the world's settings. */
  heightmap(): string {
    return encodeHeights(this.editor.heights, this.cfg.width, this.cfg.height);
  }

  /** The world's settings as they now stand: land, water and all. */
  settings(): WorldConfig {
    return { ...this.cfg, heightmap: this.heightmap(), water: JSON.parse(JSON.stringify(this.water)), riverSources: undefined, terrainPreview: undefined };
  }

  /**
   * Build the world again. `full` carves all the land afresh; otherwise only what changed since
   * the last build. A build asked for while one is under way waits its turn (only the latest runs).
   */
  private request(full = false): void {
    if (full) {
      this.dirty = null;
      this.fullCarve = true;
    }
    if (this.busy) {
      this.queued = true;
      return;
    }
    this.busy = true;
    this.queued = false;
    this.onStatus?.();
    const id = ++this.job;
    const cfg = this.settings();
    // Nothing of the land changed: an empty box, so nothing is carved again.
    const dirty = this.fullCarve ? null : (this.dirty ?? { x0: 0, y0: 0, x1: -1, y1: -1 });
    this.inFlight = { repaint: this.repaint };
    this.repaint = null;
    this.dirty = null;
    this.fullCarve = false;
    if (this.worker) {
      this.worker.postMessage({ id, cfg, dirty });
      return;
    }
    // No background thread to be had: build here, between frames.
    setTimeout(() => {
      const fresh = !this.localCarver || dirty === null;
      if (fresh) this.localCarver = carverFor(cfg);
      const map = generateMap(cfg, new Rng(cfg.seed).fork('map'), { carver: this.localCarver!, dirty: fresh ? null : dirty });
      this.received(id, map, fresh ? null : this.localCarver!.changed, fresh);
    }, 0);
  }

  private fullCarve = false;

  private received(id: number, map: MapData, changed: Box | null, full: boolean): void {
    if (id !== this.job) return;
    this.busy = false;
    const asked = this.inFlight?.repaint ?? null;
    this.inFlight = null;
    const first = !this.map;
    this.map = map;
    // Paint again what changed: the land carved again, and whatever the edit itself asked for.
    let box: Box | 'all' | null = full || first || asked === 'all' ? 'all' : union(changed, asked);
    if (box && box !== 'all') box = { x0: Math.max(0, box.x0 - 1), y0: Math.max(0, box.y0 - 1), x1: Math.min(map.width - 1, box.x1 + 1), y1: Math.min(map.height - 1, box.y1 + 1) };
    if (box) this.paint(box);
    // A lake clicked where there is no hollow to hold it: say what to do instead.
    const sel = this.selected;
    if (sel?.kind === 'lake') {
      const info = map.lakeInfo?.[sel.index];
      if (info && info.spill - info.bottom < 0.0005) this.note = 'There is no hollow here to hold a lake. Dig one with Lower or Valley on the Terrain tab, or paint water in with Add water.';
    }
    if (this.layer !== 'terrain') this.paintClimate();
    this.onChange?.();
    if (this.queued) this.request();
  }

  /** Change a climate setting (latitudes, tilt, currents) and rebuild. */
  setClimate(patch: Partial<WorldConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    this.repaint = 'all';
    this.request();
  }

  /** Change how the land is carved, or how rivers are drawn, and rebuild. */
  setTerrain(patch: NonNullable<WorldConfig['terrain']>): void {
    this.cfg = { ...this.cfg, terrain: { ...this.cfg.terrain, ...patch } };
    this.repaint = 'all';
    this.request(true);
  }

  /** Show the land in another map style, or with contour lines on or off. */
  setLook(style: MapStyle, contours: boolean): void {
    if (style === this.style && contours === this.contours) return;
    this.style = style;
    this.contours = contours;
    if (this.map) this.paint('all');
  }

  /** Paint the land: everything, or one box of tiles. */
  private paint(box: Box | 'all'): void {
    const map = this.map;
    if (!map) return;
    if (this.terrain.width !== map.width * SCALE || this.terrain.height !== map.height * SCALE) {
      this.terrain.width = map.width * SCALE;
      this.terrain.height = map.height * SCALE;
      box = 'all';
    }
    const b = box === 'all' ? { x0: 0, y0: 0, x1: map.width - 1, y1: map.height - 1 } : box;
    const ctx = this.terrain.getContext('2d')!;
    const pw = (b.x1 - b.x0 + 1) * SCALE;
    const ph = (b.y1 - b.y0 + 1) * SCALE;
    if (pw <= 0 || ph <= 0) return;
    const img = ctx.createImageData(pw, ph);
    new TerrainShader(map, this.style, undefined, this.contours).paint(img, b.x0, b.y0, 1 / SCALE, 1 / SCALE);
    ctx.putImageData(img, b.x0 * SCALE, b.y0 * SCALE);
  }

  private paintClimate(): void {
    const map = this.map;
    if (this.layer === 'terrain' || !map) return;
    this.climate.width = map.width;
    this.climate.height = map.height;
    const ctx = this.climate.getContext('2d')!;
    const img = ctx.createImageData(map.width, map.height);
    paintClimate(map, this.layer, img.data);
    ctx.putImageData(img, 0, 0);
  }

  setLayer(layer: EditorView): void {
    this.layer = layer;
    this.paintClimate();
  }

  // ------------------------------------------------------------------ undo

  /** Remember the land and water as they are, so the next change can be undone. */
  private remember(): void {
    this.editor.beginStroke();
    this.steps.push({ water: JSON.stringify(this.water), box: null });
    if (this.steps.length > 30) this.steps.shift();
  }

  /** Note land changed in this step (to carve it again, now and if it is undone). */
  private touched(box: Box): void {
    if (box.x1 < box.x0) return;
    this.dirty = union(this.dirty, box);
    const step = this.steps[this.steps.length - 1];
    if (step) step.box = union(step.box, box);
  }

  undo(): boolean {
    const step = this.steps.pop();
    if (!step || !this.editor.undoStroke()) return false;
    const waterChanged = step.water !== JSON.stringify(this.water);
    this.water = JSON.parse(step.water);
    this.pending = null;
    this.selected = null;
    if (step.box) this.dirty = union(this.dirty, step.box);
    if (waterChanged) this.repaint = 'all';
    this.request();
    return true;
  }

  canUndo(): boolean {
    return this.steps.length > 0 && this.editor.canUndo();
  }

  /** Start again from a blank ocean. */
  blank(): void {
    this.remember();
    this.editor.clear();
    this.water = emptyWater();
    this.pending = null;
    this.selected = null;
    this.repaint = 'all';
    this.touched({ x0: 0, y0: 0, x1: this.cfg.width - 1, y1: this.cfg.height - 1 });
    this.request();
  }

  // ------------------------------------------------------------------ what is where

  private cell(x: number, y: number): number {
    const r = this.map?.carved;
    if (!r) return -1;
    const X = Math.round((x + 0.5) * r.scale - 0.5);
    const Y = Math.round((y + 0.5) * r.scale - 0.5);
    if (X < 0 || Y < 0 || X >= r.width || Y >= r.height) return -1;
    return Y * r.width + X;
  }

  /** Whether a point is on the sea or a lake. */
  waterAt(x: number, y: number): boolean {
    const c = this.cell(x, y);
    const r = this.map?.carved;
    return c >= 0 && !!r && (r.water[c] === 1 || r.lake?.[c] === 1);
  }

  /** The drawn river passing nearest a point, within `reach` tiles, or -1. */
  riverAt(x: number, y: number, reach = 0.6): number {
    const paths = this.map?.riverPaths ?? [];
    let best = -1;
    let bd = reach;
    paths.forEach((p, k) => {
      for (let i = 0; i < p.length; i += 2) {
        const d = Math.hypot(p[i] - x, p[i + 1] - y);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
    });
    return best;
  }

  /** The lake set by hand at a point, or -1. */
  lakeAt(x: number, y: number): number {
    const c = this.cell(x, y);
    const r = this.map?.carved;
    if (c < 0 || !r?.lake?.[c] || !this.water.lakes.length) return -1;
    let best = -1;
    let bd = Infinity;
    this.water.lakes.forEach((l, k) => {
      const d = Math.hypot(l.x - x, l.y - y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  }

  // ------------------------------------------------------------------ water

  /** Finish the river being drawn (Enter). */
  finishRiver(): void {
    const pts = this.pending;
    this.pending = null;
    if (!pts || pts.length < 2) {
      this.note = pts ? 'A river needs at least two points: where it rises and where it goes.' : '';
      return;
    }
    this.remember();
    this.water.rivers.push({ points: pts });
    this.selected = { kind: 'river', index: this.water.rivers.length - 1 };
    this.note = '';
    this.repaint = 'all';
    this.request();
  }

  cancelRiver(): void {
    this.pending = null;
  }

  /** Take away the selected river or lake. */
  deleteSelected(): boolean {
    const s = this.selected;
    if (!s) return false;
    this.remember();
    if (s.kind === 'river') this.water.rivers.splice(s.index, 1);
    else this.water.lakes.splice(s.index, 1);
    this.selected = null;
    this.repaint = 'all';
    this.request();
    return true;
  }

  /** The selected lake's water level (0..1 of the way to where it spills over). */
  get lakeLevel(): number | null {
    const s = this.selected;
    return s?.kind === 'lake' ? (this.water.lakes[s.index]?.level ?? null) : null;
  }

  /** Set the selected lake's water level. `commit` marks the end of a change (for undo). */
  setLakeLevel(v: number, start = false): void {
    const s = this.selected;
    if (s?.kind !== 'lake' || !this.water.lakes[s.index]) return;
    if (start) this.remember();
    this.water.lakes[s.index].level = Math.max(0.05, Math.min(1, v));
    this.repaint = 'all';
    this.request();
  }

  // ------------------------------------------------------------------ the pen

  begin(x: number, y: number): void {
    const tool = this.tool;
    this.note = '';
    if (tool === 'river') {
      if (!this.pending) {
        const hit = this.riverAt(x, y, 0.5);
        if (hit >= 0) {
          this.selected = { kind: 'river', index: hit };
          return;
        }
        this.selected = null;
        this.pending = [[x, y]];
        return;
      }
      this.pending.push([x, y]);
      // Reaching the sea, a lake or another river, it is finished.
      if (this.waterAt(x, y) || this.riverAt(x, y) >= 0) this.finishRiver();
      return;
    }
    if (tool === 'lake') {
      const hit = this.lakeAt(x, y);
      if (hit >= 0) {
        this.selected = { kind: 'lake', index: hit };
        return;
      }
      if (this.waterAt(x, y)) {
        this.note = 'That is already water.';
        return;
      }
      this.remember();
      this.water.lakes.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, level: 1 });
      this.selected = { kind: 'lake', index: this.water.lakes.length - 1 };
      this.repaint = 'all';
      this.request();
      return;
    }
    this.remember();
    this.stroke = { x, y, level: strokeLevel(tool, this.editor.heightAt(x, y), this.strength) };
    if (tool === 'lakeAdd' || tool === 'lakeRemove') {
      this.paintWater(x, y);
      return;
    }
    this.touched(this.editor.dab(x, y, this.brush()));
    this.request();
  }

  move(x: number, y: number): void {
    const s = this.stroke;
    if (!s) return;
    if (this.tool === 'lakeAdd' || this.tool === 'lakeRemove') {
      const [lx, ly] = s.lastEdit ?? [s.x, s.y];
      if (Math.hypot(x - lx, y - ly) >= Math.max(0.5, this.radius * 0.4)) this.paintWater(x, y);
      return;
    }
    this.touched(this.editor.line(s.x, s.y, x, y, this.brush()));
    s.x = x;
    s.y = y;
    this.request();
  }

  end(): void {
    if (!this.stroke) return;
    this.stroke = null;
  }

  private paintWater(x: number, y: number): void {
    const add = this.tool === 'lakeAdd';
    this.water.edits.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: this.radius, add });
    if (this.stroke) this.stroke.lastEdit = [x, y];
    const r = Math.ceil(this.radius) + 2;
    const box = { x0: Math.floor(x) - r, y0: Math.floor(y) - r, x1: Math.ceil(x) + r, y1: Math.ceil(y) + r };
    this.repaint = this.repaint === 'all' ? 'all' : union(this.repaint, box);
    this.request();
  }

  private brush() {
    return {
      tool: this.tool,
      radius: this.radius,
      strength: this.strength,
      roughness: this.roughness,
      top: this.topFeet / FEET_PER_UNIT,
      floor: this.floorFeet / FEET_PER_UNIT,
      level: this.stroke?.level,
    };
  }

  // ------------------------------------------------------------------ drawing

  draw(canvas: HTMLCanvasElement, view: { zoom: number; ox: number; oy: number }): void {
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const z = view.zoom;
    const x0 = -view.ox * z;
    const y0 = -view.oy * z;
    const map = this.map;
    if (!map) {
      ctx.fillStyle = 'rgb(140, 180, 202)';
      ctx.fillRect(x0, y0, this.cfg.width * z, this.cfg.height * z);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText('Building the world…', Math.max(12, x0 + 12), Math.max(24, y0 + 24));
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrain, x0, y0, map.width * z, map.height * z);
    if (this.layer !== 'terrain' && !this.stroke) {
      ctx.drawImage(this.climate, x0, y0, map.width * z, map.height * z);
      if (this.layer === 'currents') drawCurrents(ctx, map, view, cw, ch);
    }
    const ink = this.style === 'parchment' ? 'rgb(84, 98, 122)' : this.style === 'drawn' ? 'rgb(84, 128, 160)' : this.style === 'topo' ? 'rgb(62, 112, 160)' : 'rgb(60, 110, 150)';
    drawRiverCurves(ctx, riverCurves(map), view, { x0: view.ox, y0: view.oy, x1: view.ox + cw / z, y1: view.oy + ch / z }, ink);
    if (this.layer === 'terrain' && (this.contours || this.style === 'topo')) drawContourLabels(ctx, map, view, cw, ch, this.style === 'parchment' ? 'rgb(72, 54, 38)' : 'rgb(130, 84, 48)');
    const sx = (x: number) => (x - view.ox) * z;
    const sy = (y: number) => (y - view.oy) * z;
    // The selected river, picked out.
    const sel = this.selected;
    if (sel?.kind === 'river') {
      const p = map.riverPaths?.[sel.index];
      if (p && p.length >= 4) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 196, 64, 0.9)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(sx(p[0]), sy(p[1]));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(sx(p[i]), sy(p[i + 1]));
        ctx.stroke();
        ctx.restore();
      }
    }
    if (sel?.kind === 'lake') {
      const l = this.water.lakes[sel.index];
      if (l) {
        ctx.beginPath();
        ctx.arc(sx(l.x), sy(l.y), 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 196, 64, 0.95)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
    // The river being drawn: its points so far, and on to the pen.
    if (this.pending) {
      ctx.save();
      ctx.strokeStyle = 'rgba(30, 90, 160, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      this.pending.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      if (this.cursor) ctx.lineTo(sx(this.cursor.x), sy(this.cursor.y));
      ctx.stroke();
      ctx.setLineDash([]);
      this.pending.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), i === 0 ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? 'rgb(30, 90, 160)' : 'rgb(255, 255, 255)';
        ctx.fill();
        ctx.strokeStyle = 'rgb(30, 90, 160)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      ctx.restore();
    }
    // Latitude lines every 15°, labelled at the left edge.
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    const lat = map.latitude;
    for (let y = 1; y < map.height; y++) {
      const a = lat[y - 1];
      const b = lat[y];
      const line = Math.floor(a / 15) !== Math.floor(b / 15) ? Math.max(Math.floor(a / 15), Math.floor(b / 15)) * 15 : null;
      if (line === null) continue;
      const py = (y - view.oy) * z;
      ctx.strokeStyle = line === 0 ? 'rgba(255, 236, 160, 0.6)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash(line === 0 ? [] : [3, 5]);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, x0), py);
      ctx.lineTo(Math.min(cw, x0 + map.width * z), py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillText(line === 0 ? 'Equator' : `${Math.abs(line)}°${line > 0 ? 'N' : 'S'}`, Math.max(4, x0 + 4), py - 7);
    }
    if (this.cursor) {
      const BR = BRUSHES.find((b) => b.id === this.tool)!;
      const point = this.tool === 'river' || this.tool === 'lake';
      const r = point ? 5 / z : this.radius;
      const cx = sx(this.cursor.x);
      const cy = sy(this.cursor.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r * z + 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(BR.name, cx + r * z + 6, cy);
    }
  }
}
