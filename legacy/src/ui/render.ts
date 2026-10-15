import { Res } from '../engine/data/economy';
import type { MapData } from '../engine/types';
import type { World } from '../engine/world';
import { LAND_USE_COLORS } from '../engine/data/settlements';
import { friendly } from '../engine/systems/diplomacy';
import { TERRAIN_SCALE, TerrainShader, drawContourLabels, drawRiverCurves, riverCurves, type MapStyle } from './terrain';
import { paintOutline, paintRegions, pixelLabels, warpLabels } from './regions';
import { sideColor } from '../engine/systems/landwars';
import { pointAlong, waypoint, type Point } from '../engine/geometry';
import { DX, DY } from '../engine/worldgen';

const ROAD_STYLE = [
  { color: '', width: 0, min: 0 },
  { color: 'rgba(120, 90, 50, 0.55)', width: 0.08, min: 0.8 },
  { color: 'rgba(125, 82, 38, 0.8)', width: 0.14, min: 1.2 },
  { color: 'rgba(95, 95, 100, 0.9)', width: 0.2, min: 1.8 },
  { color: 'rgba(45, 45, 52, 0.95)', width: 0.28, min: 2.4 },
];
export const CARAVAN_COLOR: Record<string, string> = { merchant: '#e8b923', family: '#b57be0', nomad: '#d99152', convoy: '#3fbf7f' };

export type MapLayer = 'terrain' | 'political' | 'nations' | 'culture' | 'race' | 'resource' | 'land' | 'temperature' | 'rainfall' | 'currents';

export interface ViewState {
  layer: MapLayer;
  /** How the land is painted: as seen from orbit, or as an old map on parchment. */
  style: MapStyle;
  resource: Res;
  showRoutes: boolean;
  showLabels: boolean;
  showRuins: boolean;
  showCaravans: boolean;
  showArmies: boolean;
  showRoads: boolean;
  /** Contour lines (every 250 ft, bold and labelled every 1,000 ft) over the land, in any style. */
  contours: boolean;
  /** Progress through the current month (0..1) for smooth movement in real time. */
  frac: number;
  /** Screen pixels per tile. */
  zoom: number;
  /** Tile coordinate at the top-left of the canvas. */
  ox: number;
  oy: number;
  selectedSettlement: number;
  selectedPolity: number;
  selectedTile: number;
  /** Band picked on the map (-1 if none). */
  selectedBand?: number;
}

interface NationShapes {
  /** Nation owning each land tile, -1 if none. */
  polityAt: Int32Array;
  info: Map<number, { tiles: number; sx: number; sy: number }>;
}

const TEMP_RAMP: [number, [number, number, number]][] = [
  [0, [70, 40, 160]],
  [0.2, [70, 130, 230]],
  [0.4, [120, 210, 220]],
  [0.55, [150, 215, 110]],
  [0.7, [240, 210, 70]],
  [0.85, [240, 130, 50]],
  [1, [200, 40, 40]],
];
const RAIN_RAMP: [number, [number, number, number]][] = [
  [0, [190, 140, 80]],
  [0.25, [225, 200, 120]],
  [0.45, [150, 200, 100]],
  [0.65, [60, 160, 90]],
  [0.85, [40, 120, 170]],
  [1, [40, 60, 160]],
];

function ramp(stops: [number, [number, number, number]][], v: number): [number, number, number] {
  if (v <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (v <= stops[k][0]) {
      const [a, ca] = stops[k - 1];
      const [b, cb] = stops[k];
      const t = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}


export type ClimateLayer = 'temperature' | 'rainfall' | 'currents';

/** Colour a climate layer into RGBA pixels, one per tile. */
export function paintClimate(map: MapData, layer: ClimateLayer, d: Uint8ClampedArray): void {
  for (let i = 0; i < map.size; i++) {
    let c: [number, number, number];
    let a = 175;
    if (layer === 'temperature') c = ramp(TEMP_RAMP, map.temperature[i]);
    else if (layer === 'rainfall') {
      if (map.elevation[i] < 0) continue;
      c = ramp(RAIN_RAMP, map.moisture[i]);
    } else {
      // Water warmer than usual for its latitude in red, colder in blue.
      if (map.elevation[i] >= 0) continue;
      const v = Math.max(-1, Math.min(1, map.seaAnomaly[i] / 0.08));
      c = v >= 0 ? [220, 70, 50] : [50, 110, 220];
      a = Math.round(Math.abs(v) * 190);
    }
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = a;
  }
}

/** Arrows along the ocean currents, spaced to suit the zoom. */
export function drawCurrents(ctx: CanvasRenderingContext2D, map: MapData, view: { zoom: number; ox: number; oy: number }, cw: number, ch: number): void {
  const z = view.zoom;
  const w = map.width;
  const every = Math.max(2, Math.round(14 / z));
  const x0 = Math.max(0, Math.floor(view.ox / every) * every);
  const y0 = Math.max(0, Math.floor(view.oy / every) * every);
  const x1 = Math.min(w, Math.ceil(view.ox + cw / z));
  const y1 = Math.min(map.height, Math.ceil(view.oy + ch / z));
  ctx.strokeStyle = 'rgba(240, 248, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = y0; y < y1; y += every) {
    for (let x = x0; x < x1; x += every) {
      const i = y * w + x;
      if (map.elevation[i] >= 0) continue;
      const u = map.currentU[i];
      const v = map.currentV[i];
      const m = Math.hypot(u, v);
      if (m < 0.15) continue;
      const len = Math.min(1, m) * every * z * 0.8;
      const sx = (x + 0.5 - view.ox) * z;
      const sy = (y + 0.5 - view.oy) * z;
      const ex = sx + (u / m) * len;
      const ey = sy + (v / m) * len;
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      // Arrow head.
      const hx = (u / m) * Math.min(5, len * 0.4);
      const hy = (v / m) * Math.min(5, len * 0.4);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - hx - hy * 0.6, ey - hy + hx * 0.6);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - hx + hy * 0.6, ey - hy - hx * 0.6);
    }
  }
  ctx.stroke();
}

/** Trace a smooth curve through points: straight out of the first, rounded through each corner, straight into the last. */
export function traceSmooth(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  const n = pts.length;
  if (n === 0) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (n === 1) return;
  ctx.lineTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
  for (let k = 1; k < n - 1; k++) ctx.quadraticCurveTo(pts[k][0], pts[k][1], (pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2);
  ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
}

type RegionKind = 'polity' | 'culture' | 'race';

/** Region labels from here up are clans' hunting grounds (clan id + CLAN_BASE) rather than nations. */
const CLAN_BASE = 1 << 20;
/** Finer grid the borders are read from (cells per tile each way). */
const FINE = 3;

interface RegionGrid {
  key: string;
  /** Who holds each tile, and who holds it in fact (an occupier, in a war), as labels. */
  held: Int32Array;
  control: Int32Array;
  fineHeld: Int32Array;
  fineControl: Int32Array;
  version: number;
}

function sameLabels(a: Int32Array, b: Int32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const colorCache = new Map<string, [number, number, number]>();

/** Parse "#rrggbb" or "hsl(h s% l%)" to RGB. */
export function toRgb(c: string): [number, number, number] {
  const hit = colorCache.get(c);
  if (hit) return hit;
  let rgb: [number, number, number] = [128, 128, 128];
  if (c.startsWith('#') && c.length === 7) {
    rgb = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  } else {
    const m = c.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
    if (m) {
      const h = +m[1] / 360;
      const s = +m[2] / 100;
      const l = +m[3] / 100;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const f = (t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      rgb = [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
    }
  }
  colorCache.set(c, rgb);
  return rgb;
}

/** Renders the world map: a cached shaded-relief base, a thematic overlay, then routes and settlements. */
export class MapRenderer {
  private base: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private overlayKey = '';
  /** Land shown opaque, sea and lakes clear: realm colours are clipped to it so they stop at the painted coast. */
  private landMask = document.createElement('canvas');
  private detailMask = document.createElement('canvas');
  /** Screen-sized scratch canvas the realm layers are drawn on before clipping to the land. */
  private regionCanvas = document.createElement('canvas');
  private outlineCanvas = document.createElement('canvas');
  private focusCanvas = document.createElement('canvas');
  /** What each scratch canvas last showed: redrawn only when the view, the layer or the borders change. */
  private regionDrawn = '';
  private outlineDrawn = '';
  private focusDrawn = '';
  /** Bumped whenever any region grid changes. */
  private regionVersion = 0;
  private regionCache = new Map<RegionKind, RegionGrid>();
  /** Labels at every pixel of the current view, per kind of region. */
  private pixelCache = new Map<RegionKind, { key: string; held: Int32Array; control: Int32Array }>();
  private shapes: NationShapes | null = null;
  private shapesKey = '';
  private rivers: Float32Array = new Float32Array(0);
  private shader: TerrainShader | null = null;
  private detail = document.createElement('canvas');
  private detailKey = '';
  private detailTimer = 0;
  private detailJob = 0;
  /** Called when a sharper painting of the view is ready to be drawn. */
  onDetail?: () => void;

  constructor(private world: World) {
    const { width, height } = world.map;
    this.base = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.overlay.width = width;
    this.overlay.height = height;
    this.paintBase();
  }

  private style: MapStyle = 'drawn';
  private contours = false;

  /** Switch map style, or contour lines on or off (repaints the land). */
  setStyle(style: MapStyle, contours = this.contours): void {
    if (style === this.style && contours === this.contours) return;
    this.style = style;
    this.contours = contours;
    this.detailKey = '';
    this.paintBase();
    this.invalidate();
  }

  private paintBase(): void {
    const map = this.world.map;
    this.shader = new TerrainShader(map, this.style, undefined, this.contours);
    for (const c of [this.base, this.landMask]) {
      c.width = map.width * TERRAIN_SCALE;
      c.height = map.height * TERRAIN_SCALE;
    }
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(this.base.width, this.base.height);
    const mctx = this.landMask.getContext('2d')!;
    const mask = mctx.createImageData(this.base.width, this.base.height);
    this.shader.paint(img, 0, 0, 1 / TERRAIN_SCALE, 1 / TERRAIN_SCALE, mask);
    ctx.putImageData(img, 0, 0);
    mctx.putImageData(mask, 0, 0);
    this.rivers = riverCurves(map);
  }

  /**
   * Close in, the whole-map terrain image is too coarse, so once the view settles the visible part
   * is painted again at screen resolution. Until then the coarse image stands in.
   */
  private detailFor(view: ViewState, cw: number, ch: number): HTMLCanvasElement | null {
    if (view.zoom <= TERRAIN_SCALE * 1.15) return null;
    const key = `${view.zoom.toFixed(3)}:${view.ox.toFixed(3)}:${view.oy.toFixed(3)}:${cw}:${ch}`;
    if (key === this.detailKey) return this.detail;
    clearTimeout(this.detailTimer);
    // Painted a slice at a time between frames, so the world keeps moving while it is done; a newer
    // view abandons an unfinished one.
    const job = ++this.detailJob;
    this.detailTimer = window.setTimeout(() => {
      const res = Math.min(1.5, window.devicePixelRatio || 1);
      const W = Math.ceil(cw * res);
      const H = Math.ceil(ch * res);
      const img = new ImageData(W, H);
      const mask = new ImageData(W, H);
      this.shader ??= new TerrainShader(this.world.map, this.style, undefined, this.contours);
      const shader = this.shader;
      const step = 1 / (view.zoom * res);
      let row = 0;
      const slice = () => {
        if (job !== this.detailJob) return;
        const t0 = performance.now();
        while (row < H && performance.now() - t0 < 12) {
          const next = Math.min(H, row + 8);
          shader.paint(img, view.ox, view.oy, step, step, mask, row, next);
          row = next;
        }
        if (row < H) {
          this.detailTimer = window.setTimeout(slice, 0);
          return;
        }
        for (const c of [this.detail, this.detailMask]) {
          c.width = W;
          c.height = H;
        }
        this.detail.getContext('2d')!.putImageData(img, 0, 0);
        this.detailMask.getContext('2d')!.putImageData(mask, 0, 0);
        this.detailKey = key;
        this.onDetail?.();
      };
      slice();
    }, 140);
    return null;
  }

  private paintOverlay(view: ViewState): void {
    const world = this.world;
    const map = world.map;
    const key = `${view.layer}:${view.resource}:${world.monthIndex}:${world.settlements.length}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const ctx = this.overlay.getContext('2d')!;
    ctx.clearRect(0, 0, map.width, map.height);
    if (view.layer === 'terrain') return;
    const img = ctx.createImageData(map.width, map.height);
    const d = img.data;
    if (view.layer === 'temperature' || view.layer === 'rainfall' || view.layer === 'currents') {
      paintClimate(map, view.layer, d);
    } else if (view.layer === 'land') {
      // What every worked tile is used for.
      for (let i = 0; i < map.size; i++) {
        if (map.owner[i] < 0) continue;
        const [r, g, b] = LAND_USE_COLORS[map.landUse[i]];
        d[i * 4] = r;
        d[i * 4 + 1] = g;
        d[i * 4 + 2] = b;
        d[i * 4 + 3] = map.landUse[i] === 0 ? 60 : 215;
      }
    } else if (view.layer === 'resource') {
      const R = map.resources[view.resource];
      let max = 0;
      for (let i = 0; i < map.size; i++) max = Math.max(max, R[i]);
      for (let i = 0; i < map.size; i++) {
        const v = max > 0 ? R[i] / max : 0;
        if (v <= 0.02) continue;
        d[i * 4] = 250;
        d[i * 4 + 1] = 200 - v * 150;
        d[i * 4 + 2] = 40;
        d[i * 4 + 3] = 60 + v * 180;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  invalidate(): void {
    this.overlayKey = '';
    this.regionCache.clear();
    this.pixelCache.clear();
    this.regionDrawn = '';
    this.outlineDrawn = '';
    this.focusDrawn = '';
  }

  /** What each tile of the realms belongs to, for a kind of region (-1: nobody's), and who holds it in fact. */
  private labelsFor(kind: RegionKind): { held: Int32Array; control: Int32Array } {
    const world = this.world;
    const map = world.map;
    const held = new Int32Array(map.size).fill(-1);
    const raceIndex = new Map(world.races.map((r, k) => [r.id, k]));
    const bySettlement = new Int32Array(world.settlements.length).fill(-1);
    for (const s of world.settlements) {
      if (!s.alive) continue;
      bySettlement[s.id] = kind === 'polity' ? s.polityId : kind === 'culture' ? s.cultureId : raceIndex.get(world.majorityRaceId(s)) ?? -1;
    }
    // A clan's hunting grounds: its own region (its own colour, alongside the realms).
    const byClan = new Int32Array(world.tribes.length).fill(-1);
    for (const t of world.tribes) {
      const culture = world.cultures[t.cultureId];
      byClan[t.id] = kind === 'polity' ? CLAN_BASE + t.id : kind === 'culture' ? t.cultureId : raceIndex.get(culture.raceId) ?? -1;
    }
    for (let i = 0; i < map.size; i++) {
      const o = map.region[i];
      if (o >= 0) held[i] = bySettlement[o];
      else if (map.claim[i] >= 0) held[i] = byClan[map.claim[i]];
    }
    if (kind !== 'polity') return { held, control: held };
    // Land held by force in a war still being fought.
    const control = Int32Array.from(held);
    for (let i = 0; i < map.size; i++) {
      const occ = map.occupier[i];
      if (occ !== -1 && held[i] !== -1) control[i] = occ >= 0 ? occ : CLAN_BASE + (-occ - 2);
    }
    return { held, control };
  }

  /** The finer, warped grids the borders are read from, rebuilt only when the land changes hands. */
  private regions(kind: RegionKind): RegionGrid {
    const world = this.world;
    const key = `${world.monthIndex}:${world.settlements.length}:${world.polities.length}`;
    const hit = this.regionCache.get(kind);
    if (hit && hit.key === key) return hit;
    const { held, control } = this.labelsFor(kind);
    if (hit && sameLabels(hit.held, held) && sameLabels(hit.control, control)) {
      hit.key = key;
      return hit;
    }
    const { width: w, height: h } = world.map;
    const grid: RegionGrid = {
      key, held, control, fineHeld: warpLabels(held, w, h, FINE), fineControl: control === held ? warpLabels(held, w, h, FINE) : warpLabels(control, w, h, FINE), version: ++this.regionVersion,
    };
    this.regionCache.set(kind, grid);
    return grid;
  }

  /** Labels at every pixel of the view. */
  private pixels(kind: RegionKind, view: ViewState, W: number, H: number, res: number): { held: Int32Array; control: Int32Array } {
    const grid = this.regions(kind);
    const key = `${grid.version}:${view.zoom}:${view.ox}:${view.oy}:${W}:${H}`;
    const hit = this.pixelCache.get(kind);
    if (hit && hit.key === key) return hit;
    const { width: w, height: h } = this.world.map;
    const step = 1 / (view.zoom * res);
    const held = pixelLabels(grid.fineHeld, w * FINE, h * FINE, FINE, view.ox, view.oy, step, W, H, hit?.held.length === W * H ? hit.held : undefined);
    const control = grid.fineControl === grid.fineHeld ? held : pixelLabels(grid.fineControl, w * FINE, h * FINE, FINE, view.ox, view.oy, step, W, H, hit && hit.control !== hit.held && hit.control.length === W * H ? hit.control : undefined);
    const out = { key, held, control };
    this.pixelCache.set(kind, out);
    return out;
  }

  private colorOf(kind: RegionKind, label: number): string {
    const world = this.world;
    if (label >= CLAN_BASE) return world.tribes[label - CLAN_BASE].color;
    return kind === 'polity' ? world.polities[label].color : kind === 'culture' ? world.cultures[label].color : world.races[label].color;
  }

  /** A screen-sized scratch canvas at the resolution regions are painted at. */
  private scratch(c: HTMLCanvasElement, cw: number, ch: number): { W: number; H: number; res: number } {
    const res = Math.min(1.5, window.devicePixelRatio || 1);
    const W = Math.ceil(cw * res);
    const H = Math.ceil(ch * res);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    return { W, H, res };
  }

  /** Keep only what lies over dry land, so colours and borders stop at the painted coast. */
  private clipToLand(c: HTMLCanvasElement, view: ViewState, cw: number, ch: number, res: number): void {
    const o = c.getContext('2d')!;
    const map = this.world.map;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'destination-in';
    o.imageSmoothingEnabled = true;
    const s = view.zoom * res;
    if (this.detailFor(view, cw, ch)) o.drawImage(this.detailMask, 0, 0, c.width, c.height);
    else o.drawImage(this.landMask, -view.ox * s, -view.oy * s, map.width * s, map.height * s);
    o.globalCompositeOperation = 'source-over';
  }

  /**
   * The realm layers: every pixel of the view belongs to one nation, clan, culture or people (or to
   * nobody), so borders are simply where one meets another, smooth and never crossing themselves.
   * Borders between holders are solid; land taken in a war still being fought is striped with the
   * occupier's colour inside a dotted line, which turns solid if the peace hands it over.
   */
  private drawRegions(ctx: CanvasRenderingContext2D, view: ViewState, cw: number, ch: number): void {
    const layer = view.layer;
    const kind: RegionKind = layer === 'culture' ? 'culture' : layer === 'race' ? 'race' : 'polity';
    const rc = this.regionCanvas;
    const { W, H, res } = this.scratch(rc, cw, ch);
    const grid = this.regions(kind);
    const detailed = this.detailFor(view, cw, ch) !== null;
    const drawn = `${layer}:${grid.version}:${view.zoom}:${view.ox}:${view.oy}:${W}:${H}:${detailed}`;
    if (drawn !== this.regionDrawn) {
      this.regionDrawn = drawn;
      const { held, control } = this.pixels(kind, view, W, H, res);
      const o = rc.getContext('2d')!;
      const img = o.createImageData(W, H);
      const nations = layer === 'nations';
      paintRegions(img, held, control, {
        fill: (label) => {
          const [r, g, b] = toRgb(this.colorOf(kind, label));
          // Clans' hunting grounds are washed paler than settled realms.
          const clan = label >= CLAN_BASE;
          return [r, g, b, Math.round(255 * (nations ? (clan ? 0.45 : 0.8) : clan ? 0.28 : 0.45))];
        },
        border: nations ? [24, 20, 16, 235] : [30, 24, 18, 170],
        width: Math.max(1, Math.round((nations ? 2 : 1.4) * res)),
      });
      if (nations) {
        // Unclaimed wilds washed pale so the nations read clearly.
        const d = img.data;
        for (let i = 0; i < W * H; i++) {
          if (held[i] !== -1 || d[i * 4 + 3] !== 0) continue;
          d[i * 4] = 236;
          d[i * 4 + 1] = 232;
          d[i * 4 + 2] = 222;
          d[i * 4 + 3] = 128;
        }
      }
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.putImageData(img, 0, 0);
      this.clipToLand(rc, view, cw, ch, res);
    }
    ctx.drawImage(rc, 0, 0, cw, ch);
  }

  /** The selected nation's outline: a bright band round its land; dashed lines round the nations bound to it. */
  private drawOutline(ctx: CanvasRenderingContext2D, view: ViewState, cw: number, ch: number, selected: number, bonded: Set<number>): void {
    const rc = this.outlineCanvas;
    const { W, H, res } = this.scratch(rc, cw, ch);
    const grid = this.regions('polity');
    const detailed = this.detailFor(view, cw, ch) !== null;
    const drawn = `${selected}:${[...bonded].join(',')}:${grid.version}:${view.zoom}:${view.ox}:${view.oy}:${W}:${H}:${detailed}`;
    if (drawn !== this.outlineDrawn) {
      this.outlineDrawn = drawn;
      const { held } = this.pixels('polity', view, W, H, res);
      const o = rc.getContext('2d')!;
      const img = o.createImageData(W, H);
      for (const b of bonded) paintOutline(img, held, b, toRgb(this.world.polities[b].color), Math.max(1, Math.round(res)), true);
      paintOutline(img, held, selected, [255, 255, 255], Math.max(2, Math.round(2 * res)));
      paintOutline(img, held, selected, toRgb(this.world.polities[selected].color), Math.max(1, Math.round(res)));
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.putImageData(img, 0, 0);
      this.clipToLand(rc, view, cw, ch, res);
    }
    ctx.drawImage(rc, 0, 0, cw, ch);
  }

  /** Dim everything outside the selected nation; the nations bound to it stay half-lit. */
  private drawFocus(ctx: CanvasRenderingContext2D, view: ViewState, cw: number, ch: number, selected: number, bonded: Set<number>): void {
    const rc = this.focusCanvas;
    const { W, H, res } = this.scratch(rc, cw, ch);
    const grid = this.regions('polity');
    const drawn = `${selected}:${[...bonded].join(',')}:${grid.version}:${view.zoom}:${view.ox}:${view.oy}:${W}:${H}`;
    if (drawn !== this.focusDrawn) {
      this.focusDrawn = drawn;
      const { held } = this.pixels('polity', view, W, H, res);
      const o = rc.getContext('2d')!;
      const img = o.createImageData(W, H);
      const d = img.data;
      for (let i = 0; i < W * H; i++) {
        const l = held[i];
        if (l === selected) continue;
        d[i * 4] = 12;
        d[i * 4 + 1] = 16;
        d[i * 4 + 2] = 24;
        d[i * 4 + 3] = bonded.has(l) ? 80 : 170;
      }
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.putImageData(img, 0, 0);
    }
    ctx.drawImage(rc, 0, 0, cw, ch);
  }

  /** Tile counts, centres and outline segments of every nation, rebuilt when borders may have moved. */
  private nationShapes(): NationShapes {
    const world = this.world;
    const map = world.map;
    const key = `${world.monthIndex}:${world.settlements.length}`;
    if (this.shapes && key === this.shapesKey) return this.shapes;
    this.shapesKey = key;
    const w = map.width;
    const polityAt = new Int32Array(map.size).fill(-1);
    for (let i = 0; i < map.size; i++) {
      const o = map.region[i];
      if (o >= 0 && map.elevation[i] >= 0) polityAt[i] = world.settlements[o].polityId;
    }
    const info = new Map<number, { tiles: number; sx: number; sy: number }>();
    for (let i = 0; i < map.size; i++) {
      const p = polityAt[i];
      if (p < 0) continue;
      let n = info.get(p);
      if (!n) {
        n = { tiles: 0, sx: 0, sy: 0 };
        info.set(p, n);
      }
      const x = i % w;
      const y = (i / w) | 0;
      n.tiles++;
      n.sx += x + 0.5;
      n.sy += y + 0.5;
    }
    this.shapes = { polityAt, info };
    return this.shapes;
  }

  /** Nations bound to `polity` by marriage, alliance, confederation or vassalage. */
  private bondedTo(polity: number): Set<number> {
    const world = this.world;
    const out = new Set<number>();
    for (const q of world.alivePolities()) if (q.id !== polity && friendly(world, polity, q.id)) out.add(q.id);
    return out;
  }

  draw(canvas: HTMLCanvasElement, view: ViewState, ink: { text: string; halo: string; accent: string }): void {
    const world = this.world;
    const map = world.map;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const z = view.zoom;
    const tx = (x: number) => (x - view.ox) * z;
    const ty = (y: number) => (y - view.oy) * z;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.base, tx(0), ty(0), map.width * z, map.height * z);
    this.setStyle(view.style, view.contours);
    const detail = this.detailFor(view, cw, ch);
    if (detail) ctx.drawImage(detail, 0, 0, cw, ch);
    const riverInk = view.style === 'parchment' ? 'rgb(84, 98, 122)' : view.style === 'drawn' ? 'rgb(84, 128, 160)' : view.style === 'topo' ? 'rgb(62, 112, 160)' : undefined;
    drawRiverCurves(ctx, this.rivers, view, { x0: view.ox, y0: view.oy, x1: view.ox + cw / z, y1: view.oy + ch / z }, riverInk);
    if ((view.contours || view.style === 'topo') && view.layer === 'terrain') drawContourLabels(ctx, map, view, cw, ch, view.style === 'parchment' ? 'rgb(72, 54, 38)' : 'rgb(130, 84, 48)');
    const selected = view.selectedPolity >= 0 && world.polities[view.selectedPolity]?.alive ? view.selectedPolity : -1;
    const bonded = selected >= 0 ? this.bondedTo(selected) : new Set<number>();
    if (view.layer === 'political' || view.layer === 'nations' || view.layer === 'culture' || view.layer === 'race') this.drawRegions(ctx, view, cw, ch);
    else {
      this.paintOverlay(view);
      // Climate and resource layers are smooth fields.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.overlay, tx(0), ty(0), map.width * z, map.height * z);
      ctx.imageSmoothingEnabled = false;
      if (view.layer === 'currents') drawCurrents(ctx, map, view, cw, ch);
    }
    const selectedBand = view.selectedBand ?? -1;

    const w = map.width;
    /** Screen position of the point a path passes through on a tile. */
    const wp = (t: number): Point => {
      const [x, y] = waypoint(map, world.settlements, t);
      return [tx(x), ty(y)];
    };
    const cx = (t: number) => wp(t)[0];
    const cy = (t: number) => wp(t)[1];
    /** A path drawn as a smooth curve through its waypoints. */
    const pathTo = (path: number[], from = 0) => {
      ctx.beginPath();
      traceSmooth(ctx, path.slice(from).map(wp));
      ctx.stroke();
    };
    const x0 = Math.max(0, Math.floor(view.ox) - 1);
    const y0 = Math.max(0, Math.floor(view.oy) - 1);
    const x1 = Math.min(w, Math.ceil(view.ox + cw / z) + 1);
    const y1 = Math.min(map.height, Math.ceil(view.oy + ch / z) + 1);

    // Roads: each level drawn as its own line style. Every road tile draws its own stretch, curving
    // from the midpoint towards one neighbour, through its waypoint, to the midpoint towards the
    // other, so the pieces join into smooth winding roads that meet at the towns.
    if (view.showRoads) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const nbs: Point[] = [];
      for (let level = 1; level <= 4; level++) {
        const style = ROAD_STYLE[level];
        ctx.strokeStyle = style.color;
        ctx.lineWidth = Math.max(style.min, z * style.width);
        ctx.setLineDash(level === 1 ? [2, 3] : []);
        ctx.beginPath();
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * w + x;
            if ((map.road[i] | 0) < level) continue;
            const p = wp(i);
            nbs.length = 0;
            for (let d = 0; d < 8; d++) {
              const nx = x + DX[d];
              const ny = y + DY[d];
              if (nx < 0 || ny < 0 || nx >= w || ny >= map.height) continue;
              if ((map.road[ny * w + nx] | 0) < level) continue;
              // A diagonal step is left out where the two tiles already join round the corner.
              if (DX[d] !== 0 && DY[d] !== 0 && ((map.road[y * w + nx] | 0) >= level || (map.road[ny * w + x] | 0) >= level)) continue;
              const q = wp(ny * w + nx);
              nbs.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
            }
            if (nbs.length === 2) {
              ctx.moveTo(nbs[0][0], nbs[0][1]);
              ctx.quadraticCurveTo(p[0], p[1], nbs[1][0], nbs[1][1]);
            } else {
              for (const m of nbs) {
                ctx.moveTo(p[0], p[1]);
                ctx.lineTo(m[0], m[1]);
              }
            }
          }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Trade routes: where free traders and state convoys actually travel.
    if (view.showRoutes) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let maxVol = 1;
      for (const r of world.routes.values()) maxVol = Math.max(maxVol, r.volume);
      for (const r of world.routes.values()) {
        if (r.path.length < 2) continue;
        const t = Math.sqrt(r.volume / maxVol);
        const a = 0.3 + 0.55 * t;
        ctx.strokeStyle = r.kind === 'convoy' ? `rgba(40, 150, 90, ${a})` : `rgba(214, 160, 40, ${a})`;
        ctx.lineWidth = Math.max(1, Math.min(4.5, 1 + t * 3.5));
        ctx.setLineDash(r.kind === 'convoy' ? [7, 4] : [4, 4]);
        pathTo(r.path);
      }
      ctx.setLineDash([]);
    }

    const frac = view.frac;
    /** Position along a path's smooth curve between last month's step and this month's. */
    const along = (path: number[], from: number, to: number): Point => {
      const pos = frac >= 1 || from >= to ? to : from + (to - from) * frac;
      // Only the waypoints around the traveller matter for the curve.
      const lo = Math.max(0, Math.floor(pos) - 1);
      const hi = Math.min(path.length, Math.ceil(pos) + 2);
      return pointAlong(path.slice(lo, hi).map(wp), pos - lo);
    };
    /** An army's position: along its marching path when last month's tile is on it, else straight between the two. */
    const armyAt = (a: { path: number[]; step: number; prevTile: number; tile: number }): Point => {
      if (a.path[a.step] === a.tile) {
        for (let k = a.step; k >= Math.max(0, a.step - 12); k--) if (a.path[k] === a.prevTile) return along(a.path, k, a.step);
      }
      const p = wp(a.prevTile);
      const q = wp(a.tile);
      return [p[0] + (q[0] - p[0]) * frac, p[1] + (q[1] - p[1]) * frac];
    };

    // Everything outside the selected nation sinks into shadow (roads and routes included).
    if (selected >= 0) this.drawFocus(ctx, view, cw, ch, selected, bonded);

    // Wandering bands: a small tent in their tribe's colour, with a faint trail to their next seasonal ground.
    for (const b of world.bands) {
      if (!b.alive) continue;
      const to = Math.min(b.step, Math.max(0, b.path.length - 1));
      const [X, Y] = b.path.length > 1 ? along(b.path, Math.min(b.prevStep, to), to) : [cx(b.tile), cy(b.tile)];
      const tribe = world.tribes[b.tribeId];
      const mine = selectedBand === b.id;
      if (selected >= 0 && tribe.polityId !== selected && !mine) ctx.globalAlpha = 0.35;
      if (b.path.length > 1 && to < b.path.length - 1) {
        ctx.beginPath();
        traceSmooth(ctx, [[X, Y], ...b.path.slice(to + 1).map(wp)]);
        ctx.strokeStyle = 'rgba(255, 240, 210, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const r = Math.max(2.5, Math.min(5.5, 1.5 + Math.sqrt(b.pop) * 0.22)) * Math.max(0.8, Math.min(1.5, z / 5));
      ctx.beginPath();
      ctx.moveTo(X, Y - r * 1.2);
      ctx.lineTo(X + r, Y + r * 0.8);
      ctx.lineTo(X - r, Y + r * 0.8);
      ctx.closePath();
      ctx.fillStyle = tribe.color;
      ctx.fill();
      ctx.strokeStyle = mine ? '#fff' : b.way === 'herders' ? '#3b2a12' : '#1d2a1d';
      ctx.lineWidth = mine ? 2.5 : 1.2;
      ctx.stroke();
      if (b.way === 'herders') {
        ctx.beginPath();
        ctx.arc(X + r * 1.3, Y + r * 0.6, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = '#f3ead2';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Columns of settlers: a white figure with a faint trail to the land they mean to settle.
    for (const p of world.settlers) {
      const to = Math.min(p.step, p.path.length - 1);
      const [X, Y] = along(p.path, Math.min(p.prevStep, to), to);
      if (selected >= 0 && p.polityId !== selected) ctx.globalAlpha = 0.35;
      ctx.beginPath();
      traceSmooth(ctx, [[X, Y], ...p.path.slice(to + 1).map(wp)]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      const r = Math.max(2.5, Math.min(5, 1.5 + Math.sqrt(p.people) * 0.15)) * Math.max(0.8, Math.min(1.5, z / 5));
      ctx.beginPath();
      ctx.moveTo(X, Y - r * 1.3);
      ctx.lineTo(X + r, Y + r);
      ctx.lineTo(X - r, Y + r);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = world.polities[p.polityId]?.color ?? '#333';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (view.showCaravans && world.caravans.length) {
      for (const c of world.caravans) {
        const to = Math.min(c.step, c.path.length - 1);
        const [X, Y] = along(c.path, Math.min(c.prevStep, to), to);
        const r = Math.max(2, Math.min(5, 1.5 + Math.sqrt(c.size) * 0.35)) * Math.max(0.8, Math.min(1.5, z / 5));
        ctx.beginPath();
        if (c.kind === 'convoy') ctx.rect(X - r, Y - r, r * 2, r * 2);
        else ctx.arc(X, Y, r, 0, Math.PI * 2);
        ctx.fillStyle = CARAVAN_COLOR[c.kind];
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#2b2208';
        ctx.stroke();
      }
    }

    if (view.showArmies && world.armies.length) {
      for (const a of world.armies) {
        if (!a.alive) continue;
        const color = world.polities[a.polityId].color;
        if (a.path.length > a.step + 1) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          pathTo(a.path, a.step);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        const [X, Y] = armyAt(a);
        const s = Math.max(5, Math.min(12, 3 + Math.log10(Math.max(10, a.size)) * 2)) * Math.max(0.8, Math.min(1.4, z / 5));
        ctx.beginPath();
        ctx.moveTo(X, Y - s);
        ctx.lineTo(X + s * 0.9, Y + s * 0.7);
        ctx.lineTo(X - s * 0.9, Y + s * 0.7);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = a.siege > 0 ? 2.5 : 1.5;
        ctx.strokeStyle = a.siege > 0 ? '#b3362f' : '#1b1b1b';
        ctx.stroke();
        if (view.showLabels && z >= 5) {
          const label = `${a.name} (${Math.round(a.size).toLocaleString('en-US')})${a.siege > 0 ? ' — besieging' : ''}`;
          ctx.font = `600 11px "Alegreya Sans", system-ui, sans-serif`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = ink.halo;
          ctx.strokeText(label, X + s + 3, Y + s * 0.4);
          ctx.fillStyle = ink.text;
          ctx.fillText(label, X + s + 3, Y + s * 0.4);
        }
      }
      // Warbands: a clan's or an early settlement's fighters, out to take or hold land, and coming home.
      for (const wb of world.warbands) {
        if (!wb.alive) continue;
        const color = sideColor(world, wb.side);
        const to = Math.min(wb.step, Math.max(0, wb.path.length - 1));
        const [X, Y] = wb.path.length > 1 ? along(wb.path, Math.min(wb.prevStep, to), to) : wp(wb.tile);
        if (!wb.homeward && wb.path.length > to + 1) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          traceSmooth(ctx, [[X, Y], ...wb.path.slice(to + 1).map(wp)]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = wb.homeward ? 0.55 : 1;
        const r = Math.max(3.5, Math.min(8, 2 + Math.sqrt(wb.size) * 0.45)) * Math.max(0.8, Math.min(1.4, z / 5));
        // Two crossed spears over a shield in the side's colour.
        ctx.beginPath();
        ctx.arc(X, Y, r * 0.75, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = '#1b1b1b';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(X - r, Y - r);
        ctx.lineTo(X + r, Y + r);
        ctx.moveTo(X + r, Y - r);
        ctx.lineTo(X - r, Y + r);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (view.showLabels && z >= 6) {
          const label = `${wb.name.charAt(0).toUpperCase() + wb.name.slice(1)} (${Math.round(wb.size)})${wb.homeward ? ' — going home' : ''}`;
          ctx.font = `600 11px "Alegreya Sans", system-ui, sans-serif`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = ink.halo;
          ctx.strokeText(label, X + r + 3, Y + r * 0.4);
          ctx.fillStyle = ink.text;
          ctx.fillText(label, X + r + 3, Y + r * 0.4);
        }
        ctx.globalAlpha = 1;
      }
      // Recent battles flare and fade; captured towns ring red.
      for (const m of world.battleMarks) {
        const age = world.monthIndex - m.at + (1 - frac);
        const life = m.kind === 'capture' ? 8 : 5;
        if (age > life) continue;
        const alpha = Math.max(0, 1 - age / life);
        const [X, Y] = wp(m.tile);
        const r = (5 + Math.min(10, Math.log10(Math.max(10, m.size)) * 3)) * Math.max(0.8, Math.min(1.5, z / 5));
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = m.kind === 'capture' ? '#d62f2f' : '#1b1b1b';
        ctx.lineWidth = 2.5;
        if (m.kind === 'capture') {
          ctx.beginPath();
          ctx.arc(X, Y, r * (1 + age * 0.15), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(X - r, Y - r);
          ctx.lineTo(X + r, Y + r);
          ctx.moveTo(X + r, Y - r);
          ctx.lineTo(X - r, Y + r);
          ctx.stroke();
          ctx.strokeStyle = '#f2c14e';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // Nation names written across their lands.
    const shapes = view.layer === 'nations' || selected >= 0 ? this.nationShapes() : null;
    const placed: [number, number, number, number][] = [];
    const nameNation = (pid: number, forced: boolean) => {
      const n = shapes!.info.get(pid);
      if (!n) return;
      const span = Math.sqrt(n.tiles) * z;
      const size = Math.max(forced ? 14 : 11, Math.min(forced ? 34 : 30, span * 0.22));
      const name = world.polities[pid].name.toUpperCase();
      ctx.font = `700 ${size}px "Alegreya SC", Georgia, serif`;
      const width = ctx.measureText(name).width;
      if (!forced && (width > span * 3 || n.tiles < 25)) return;
      const X = tx(n.sx / n.tiles);
      const Y = ty(n.sy / n.tiles);
      // Skip names that would collide with one already placed (the selected nation always shows).
      const box: [number, number, number, number] = [X - width / 2 - 4, Y - size / 2 - 2, X + width / 2 + 4, Y + size / 2 + 2];
      if (!forced && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      placed.push(box);
      ctx.globalAlpha = !forced && selected >= 0 ? 0.35 : 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, size * 0.22);
      ctx.strokeStyle = ink.halo;
      ctx.strokeText(name, X, Y);
      ctx.fillStyle = forced ? ink.text : 'rgba(20, 22, 28, 0.82)';
      ctx.fillText(name, X, Y);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    };
    if (view.layer === 'nations' && shapes) {
      const order = [...shapes.info.entries()].sort((a, b) => b[1].tiles - a[1].tiles).map(([pid]) => pid);
      if (selected >= 0 && shapes.info.has(selected)) {
        // Reserve the selected nation's spot first so others make way for it.
        const n = shapes.info.get(selected)!;
        const size = Math.max(14, Math.min(34, Math.sqrt(n.tiles) * z * 0.22));
        ctx.font = `700 ${size}px "Alegreya SC", Georgia, serif`;
        const width = ctx.measureText(world.polities[selected].name.toUpperCase()).width;
        const X = tx(n.sx / n.tiles);
        const Y = ty(n.sy / n.tiles);
        placed.push([X - width / 2 - 4, Y - size / 2 - 2, X + width / 2 + 4, Y + size / 2 + 2]);
      }
      for (const pid of order) if (pid !== selected) nameNation(pid, false);
    }
    if (selected >= 0) this.drawOutline(ctx, view, cw, ch, selected, bonded);

    // A red ring marks towns cut off from their capital.
    ctx.strokeStyle = 'rgba(220, 60, 50, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    for (const s of world.settlements) {
      if (!s.alive || s.connected || (selected >= 0 && s.polityId !== selected)) continue;
      ctx.beginPath();
      ctx.arc(tx(s.px), ty(s.py), Math.max(6, z * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Occupied towns: a thick ring in the occupier's colour.
    for (const s of world.settlements) {
      if (!s.alive || s.occupiedBy < 0) continue;
      if (selected >= 0 && s.polityId !== selected && s.occupiedBy !== selected) continue;
      ctx.beginPath();
      ctx.arc(tx(s.px), ty(s.py), Math.max(7, z * 1.1), 0, Math.PI * 2);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = world.polities[s.occupiedBy].color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Settlements, largest last so they sit on top.
    const list = world.settlements.filter((s) => s.alive || (view.showRuins && s.peakPop > 800));
    list.sort((a, b) => a.pop - b.pop);
    ctx.font = `600 ${Math.max(10, Math.min(14, z * 2))}px "Alegreya Sans", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const s of list) {
      const X = tx(s.px);
      const Y = ty(s.py);
      if (X < -20 || Y < -20 || X > cw + 20 || Y > ch + 20) continue;
      const foreign = selected >= 0 && (!s.alive || s.polityId !== selected);
      ctx.globalAlpha = foreign ? 0.35 : 1;
      const isCapital = s.alive && world.polities[s.polityId].capitalId === s.id;
      const r = s.alive ? Math.max(2, Math.min(9, Math.log10(Math.max(10, s.pop)) * 1.6 - 1.5)) * Math.max(0.7, Math.min(1.6, z / 5)) : 2.5;
      ctx.beginPath();
      if (isCapital) {
        // A small crown-like diamond marks seats of power.
        ctx.moveTo(X, Y - r - 1.5);
        ctx.lineTo(X + r + 1.5, Y);
        ctx.lineTo(X, Y + r + 1.5);
        ctx.lineTo(X - r - 1.5, Y);
        ctx.closePath();
      } else ctx.arc(X, Y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.alive ? '#f7f3ea' : 'rgba(120,110,100,0.7)';
      ctx.fill();
      ctx.lineWidth = s.id === view.selectedSettlement ? 3 : 1.5;
      ctx.strokeStyle = s.id === view.selectedSettlement ? ink.accent : s.alive ? world.polities[s.polityId].color : '#5a534c';
      ctx.stroke();
      // In the Nations layer the map names nations, so only capitals (or close zoom) get town names;
      // with a nation selected, only its own towns are named.
      const busy = view.layer === 'nations' ? (isCapital ? z >= 5 : z >= 9) : isCapital ? z >= 2.5 || s.pop > 3000 : z >= 7 || (z >= 4 && s.pop > 2500);
      const labelled = view.showLabels && (s.id === view.selectedSettlement || (s.alive && !foreign && busy));
      if (labelled) {
        const text = s.alive ? s.name : `${s.name} (ruins)`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = ink.halo;
        ctx.strokeText(text, X + r + 4, Y);
        ctx.fillStyle = ink.text;
        ctx.fillText(text, X + r + 4, Y);
      }
    }
    ctx.globalAlpha = 1;

    if (selected >= 0 && shapes) nameNation(selected, true);

    if (view.selectedTile >= 0 && view.selectedSettlement < 0) {
      // The inspected spot of land: a ring, not a square.
      const [X, Y] = wp(view.selectedTile);
      ctx.strokeStyle = ink.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X, Y, Math.max(5, z * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
