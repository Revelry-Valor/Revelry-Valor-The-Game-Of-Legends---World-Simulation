import { BRUSHES, TerrainEditor, strokeLevel, type BrushTool } from '../engine/editor';
import { Rng } from '../engine/rng';
import type { MapData, WorldConfig } from '../engine/types';
import { encodeHeights, generateMap } from '../engine/worldgen';
import { drawCurrents, paintClimate, type ClimateLayer } from './render';
import { paintHeights, paintTerrain } from './terrain';

export type EditorView = 'terrain' | ClimateLayer;

/**
 * The world editor: one terrain tool raises, lowers or flattens the land, and the climate that
 * follows (temperature, rainfall, ocean currents) is shown after every stroke.
 */
export class WorldEditor {
  cfg: WorldConfig;
  map!: MapData;
  editor: TerrainEditor;
  tool: BrushTool = 'raise';
  radius = 6;
  strength = 0.5;
  layer: EditorView = 'terrain';
  /** Pointer position in tiles, for the brush outline. */
  cursor: { x: number; y: number } | null = null;
  private terrain = document.createElement('canvas');
  private climate = document.createElement('canvas');
  private stroke: { x: number; y: number; level?: number } | null = null;

  constructor(cfg: WorldConfig) {
    this.cfg = { ...cfg };
    this.map = generateMap(this.cfg, new Rng(this.cfg.seed).fork('map'));
    this.editor = new TerrainEditor(Float32Array.from(this.map.heights), this.map.width, this.map.height, this.cfg.seed);
    this.paint();
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

  /** The hand-shaped land as a code to keep in the world's settings. */
  heightmap(): string {
    return encodeHeights(this.editor.heights, this.map.width, this.map.height);
  }

  /** Rebuild climate, rivers and biomes from the current heights and settings. */
  regenerate(): void {
    this.map = generateMap({ ...this.cfg, heightmap: this.heightmap() }, new Rng(this.cfg.seed).fork('map'));
    this.paint();
  }

  /** Change a climate setting (latitudes, tilt, currents) and rebuild. */
  setClimate(patch: Partial<WorldConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    this.regenerate();
  }

  private paint(): void {
    paintTerrain(this.map, this.terrain);
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

  begin(x: number, y: number): void {
    this.editor.beginStroke();
    this.stroke = { x, y, level: strokeLevel(this.tool, this.editor.heightAt(x, y)) };
    const box = this.editor.dab(x, y, this.brush());
    paintHeights(this.editor.heights, this.map.width, this.map.height, this.terrain, box);
  }

  move(x: number, y: number): void {
    if (!this.stroke) return;
    const box = this.editor.line(this.stroke.x, this.stroke.y, x, y, this.brush());
    this.stroke.x = x;
    this.stroke.y = y;
    paintHeights(this.editor.heights, this.map.width, this.map.height, this.terrain, box);
  }

  end(): void {
    if (!this.stroke) return;
    this.stroke = null;
    this.regenerate();
  }

  undo(): boolean {
    if (!this.editor.undoStroke()) return false;
    this.regenerate();
    return true;
  }

  canUndo(): boolean {
    return this.editor.canUndo();
  }

  /** Start again from a blank ocean. */
  blank(): void {
    this.editor.beginStroke();
    this.editor.clear();
    this.regenerate();
  }

  /** Start again from freshly generated land for a seed. */
  generated(seed: number): void {
    this.editor.beginStroke();
    this.cfg = { ...this.cfg, seed, heightmap: undefined };
    const fresh = generateMap(this.cfg, new Rng(seed).fork('map'));
    this.editor.heights.set(fresh.heights);
    this.regenerate();
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
    if (this.cursor) {
      const BR = BRUSHES.find((b) => b.id === this.tool)!;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((this.cursor.x - view.ox) * z, (this.cursor.y - view.oy) * z, this.radius * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc((this.cursor.x - view.ox) * z, (this.cursor.y - view.oy) * z, this.radius * z + 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(BR.name, (this.cursor.x - view.ox) * z + this.radius * z + 6, (this.cursor.y - view.oy) * z);
    }
  }
}
