import { BRUSHES, TerrainEditor, strokeLevel, type BrushTool } from '../engine/editor';
import { Rng } from '../engine/rng';
import type { MapData, WorldConfig } from '../engine/types';
import { encodeHeights, generateMap } from '../engine/worldgen';
import BuilderWorker from './builder.worker?worker&inline';
import { drawCurrents, paintClimate, type ClimateLayer } from './render';
import { TerrainShader, drawContourLabels, drawRiverCurves, riverCurves, type MapStyle } from './terrain';

export type EditorView = 'terrain' | ClimateLayer;

/** Pixels per tile the editor paints the land at: coarser for a preview, so it keeps up with the pen. */
const PREVIEW_SCALE = 3;
const FULL_SCALE = 6;

type Build = 'preview' | 'full';

/**
 * The world editor, working the way Gaea does: what you see while you draw is the real world,
 * carved, rivered and coloured, built at a quicker preview resolution a few times a second; when
 * you let go it is built again at full detail. Building happens on a background thread, so the pen
 * never waits for it.
 */
export class WorldEditor {
  cfg: WorldConfig;
  map!: MapData;
  editor: TerrainEditor;
  tool: BrushTool = 'raise';
  radius = 6;
  strength = 0.5;
  layer: EditorView = 'terrain';
  style: MapStyle = 'drawn';
  contours = false;
  /** Where rivers must rise, in tiles. */
  sources: [number, number][];
  /** Pointer position in tiles, for the brush outline. */
  cursor: { x: number; y: number } | null = null;
  /** Called when a new build is on show (to redraw the map). */
  onChange?: () => void;
  /** Called when a build starts (to say so). */
  onStatus?: () => void;
  /** What is on show: a quick preview, or the full build. */
  shown: Build = 'preview';
  private terrain = document.createElement('canvas');
  private climate = document.createElement('canvas');
  private stroke: { x: number; y: number; level?: number } | null = null;
  private sourceUndo: [number, number][][] = [];
  private worker: Worker | null = null;
  private job = 0;
  private busy: Build | null = null;
  private queued: Build | null = null;

  constructor(cfg: WorldConfig, style: MapStyle = 'drawn', contours = false) {
    this.cfg = { ...cfg };
    this.style = style;
    this.contours = contours;
    this.sources = (cfg.riverSources ?? []).map(([x, y]) => [x, y] as [number, number]);
    // A quick preview straight away, then full detail in the background.
    this.map = generateMap({ ...this.cfg, terrainPreview: true }, new Rng(this.cfg.seed).fork('map'));
    this.editor = new TerrainEditor(Float32Array.from(this.map.heights), this.map.width, this.map.height, this.cfg.seed);
    try {
      this.worker = new BuilderWorker();
      this.worker.onmessage = (e: MessageEvent<{ id: number; map: MapData }>) => this.received(e.data.id, e.data.map);
      this.worker.onerror = () => {
        this.worker = null;
        this.busy = null;
        this.request('full');
      };
    } catch {
      this.worker = null;
    }
    this.paint();
    this.request('full');
  }

  /** Stop building (the editor is closing). */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.onChange = undefined;
    this.onStatus = undefined;
  }

  get width(): number {
    return this.map.width;
  }

  get height(): number {
    return this.map.height;
  }

  get painting(): boolean {
    return this.stroke !== null;
  }

  /** Whether a build is under way (the panel says so). */
  get working(): boolean {
    return this.busy !== null || this.queued !== null;
  }

  /** The hand-shaped land as a code to keep in the world's settings. */
  heightmap(): string {
    return encodeHeights(this.editor.heights, this.map.width, this.map.height);
  }

  /** The world's settings as they now stand, land and rivers included. */
  settings(): WorldConfig {
    return { ...this.cfg, heightmap: this.heightmap(), riverSources: this.sources.length ? this.sources.map(([x, y]) => [x, y]) : undefined, terrainPreview: undefined };
  }

  /**
   * Ask for the world to be built again. A preview while one is already building waits its turn
   * (only the latest is built); full detail replaces any preview waiting.
   */
  private request(kind: Build): void {
    if (this.busy) {
      if (kind === 'full' || this.queued !== 'full') this.queued = kind;
      return;
    }
    this.busy = kind;
    this.onStatus?.();
    const id = ++this.job;
    const cfg = { ...this.settings(), terrainPreview: kind === 'preview' };
    if (this.worker) {
      this.worker.postMessage({ id, cfg });
      return;
    }
    // No background thread to be had: build here, between frames.
    setTimeout(() => this.received(id, generateMap(cfg, new Rng(cfg.seed).fork('map'))), 0);
  }

  private received(id: number, map: MapData): void {
    if (id !== this.job) return;
    const kind = this.busy ?? 'full';
    this.busy = null;
    const next = this.queued;
    this.queued = null;
    // A preview that arrives after the stroke has ended is shown only until the full build lands.
    this.map = map;
    this.shown = kind;
    this.paint();
    this.onChange?.();
    if (next) this.request(next);
    else if (kind === 'preview' && !this.stroke) this.request('full');
  }

  /** Change a climate setting (latitudes, tilt, currents) and rebuild. */
  setClimate(patch: Partial<WorldConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    this.request('full');
  }

  /** Change how the land is carved and its rivers made, and rebuild. */
  setTerrain(patch: NonNullable<WorldConfig['terrain']>): void {
    this.cfg = { ...this.cfg, terrain: { ...this.cfg.terrain, ...patch } };
    this.request('full');
  }

  /** Show the land in another map style, or with contour lines on or off. */
  setLook(style: MapStyle, contours: boolean): void {
    if (style === this.style && contours === this.contours) return;
    this.style = style;
    this.contours = contours;
    this.paint();
  }

  private paint(): void {
    const scale = this.shown === 'full' ? FULL_SCALE : PREVIEW_SCALE;
    const map = this.map;
    this.terrain.width = map.width * scale;
    this.terrain.height = map.height * scale;
    const ctx = this.terrain.getContext('2d')!;
    const img = ctx.createImageData(this.terrain.width, this.terrain.height);
    new TerrainShader(map, this.style, undefined, this.contours).paint(img, 0, 0, 1 / scale, 1 / scale);
    ctx.putImageData(img, 0, 0);
    const ink = this.style === 'parchment' ? 'rgb(84, 98, 122)' : this.style === 'drawn' ? 'rgb(84, 128, 160)' : this.style === 'topo' ? 'rgb(62, 112, 160)' : undefined;
    drawRiverCurves(ctx, riverCurves(map), { zoom: scale, ox: 0, oy: 0 }, undefined, ink);
    this.paintClimate();
  }

  private paintClimate(): void {
    if (this.layer === 'terrain') return;
    this.climate.width = this.map.width;
    this.climate.height = this.map.height;
    const ctx = this.climate.getContext('2d')!;
    const img = ctx.createImageData(this.map.width, this.map.height);
    paintClimate(this.map, this.layer, img.data);
    ctx.putImageData(img, 0, 0);
  }

  setLayer(layer: EditorView): void {
    this.layer = layer;
    this.paintClimate();
  }

  /** Remember the land and the river sources, so the next change can be undone. */
  private remember(): void {
    this.editor.beginStroke();
    this.sourceUndo.push(this.sources.map(([x, y]) => [x, y]));
    if (this.sourceUndo.length > 30) this.sourceUndo.shift();
  }

  /** Mark a river source, unless one is already close by. */
  private addSource(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return;
    if (this.sources.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 2)) return;
    this.sources.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }

  begin(x: number, y: number): void {
    this.remember();
    this.stroke = { x, y, level: strokeLevel(this.tool, this.editor.heightAt(x, y)) };
    if (this.tool === 'river') this.addSource(x, y);
    else this.editor.dab(x, y, this.brush());
    this.request('preview');
  }

  move(x: number, y: number): void {
    if (!this.stroke) return;
    if (this.tool === 'river') {
      this.addSource(x, y);
    } else {
      this.editor.line(this.stroke.x, this.stroke.y, x, y, this.brush());
    }
    this.stroke.x = x;
    this.stroke.y = y;
    this.request('preview');
  }

  end(): void {
    if (!this.stroke) return;
    this.stroke = null;
    this.request('full');
  }

  undo(): boolean {
    if (!this.editor.undoStroke()) return false;
    this.sources = this.sourceUndo.pop() ?? this.sources;
    this.request('full');
    return true;
  }

  canUndo(): boolean {
    return this.editor.canUndo();
  }

  /** Take away every river source. */
  clearSources(): void {
    if (!this.sources.length) return;
    this.remember();
    this.sources = [];
    this.request('full');
  }

  /** Start again from a blank ocean. */
  blank(): void {
    this.remember();
    this.editor.clear();
    this.sources = [];
    this.request('full');
  }

  /** Start again from freshly generated land for a seed. */
  generated(seed: number): void {
    this.remember();
    this.cfg = { ...this.cfg, seed, heightmap: undefined };
    const fresh = generateMap({ ...this.cfg, terrainPreview: true }, new Rng(seed).fork('map'));
    this.editor.heights.set(fresh.heights);
    this.sources = [];
    this.request('full');
  }

  private brush() {
    return { tool: this.tool, radius: this.radius, strength: this.strength, level: this.stroke?.level };
  }

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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrain, x0, y0, this.map.width * z, this.map.height * z);
    if (this.layer !== 'terrain' && !this.stroke) {
      ctx.drawImage(this.climate, x0, y0, this.map.width * z, this.map.height * z);
      if (this.layer === 'currents') drawCurrents(ctx, this.map, view, cw, ch);
    }
    if (this.layer === 'terrain' && (this.contours || this.style === 'topo')) drawContourLabels(ctx, this.map, view, cw, ch, this.style === 'parchment' ? 'rgb(72, 54, 38)' : 'rgb(130, 84, 48)');
    // Latitude lines every 15°, labelled at the left edge.
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    const lat = this.map.latitude;
    const h = this.map.height;
    for (let y = 1; y < h; y++) {
      const a = lat[y - 1];
      const b = lat[y];
      const line = Math.floor(a / 15) !== Math.floor(b / 15) ? Math.max(Math.floor(a / 15), Math.floor(b / 15)) * 15 : null;
      if (line === null) continue;
      const sy = (y - view.oy) * z;
      ctx.strokeStyle = line === 0 ? 'rgba(255, 236, 160, 0.6)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash(line === 0 ? [] : [3, 5]);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, x0), sy);
      ctx.lineTo(Math.min(cw, x0 + this.map.width * z), sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillText(line === 0 ? 'Equator' : `${Math.abs(line)}°${line > 0 ? 'N' : 'S'}`, Math.max(4, x0 + 4), sy - 7);
    }
    // River sources: where a river has been told to rise.
    for (const [sx, sy] of this.sources) {
      const px = (sx - view.ox) * z;
      const py = (sy - view.oy) * z;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(46, 110, 170)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.stroke();
    }
    if (this.cursor) {
      const BR = BRUSHES.find((b) => b.id === this.tool)!;
      const r = this.tool === 'river' ? 6 / z : this.radius;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((this.cursor.x - view.ox) * z, (this.cursor.y - view.oy) * z, r * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc((this.cursor.x - view.ox) * z, (this.cursor.y - view.oy) * z, r * z + 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(BR.name, (this.cursor.x - view.ox) * z + r * z + 6, (this.cursor.y - view.oy) * z);
    }
  }
}
