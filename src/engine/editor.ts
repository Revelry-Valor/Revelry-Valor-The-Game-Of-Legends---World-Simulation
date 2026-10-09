import { Noise2D } from './noise';
import { Rng } from './rng';

/** The editor's tools: outline the land and seas, shape the terrain, and put water on it. */
export type BrushTool =
  | 'land'
  | 'sea'
  | 'shallows'
  | 'deep'
  | 'mountains'
  | 'hills'
  | 'raise'
  | 'lower'
  | 'plateau'
  | 'cliff'
  | 'smooth'
  | 'ramp'
  | 'valley'
  | 'river'
  | 'lake'
  | 'lakeAdd'
  | 'lakeRemove';

export type ToolGroup = 'outline' | 'terrain' | 'water';

export const BRUSHES: { id: BrushTool; group: ToolGroup; name: string; hint: string }[] = [
  { id: 'land', group: 'outline', name: 'Land', hint: 'Paint land out of the sea: continents, islands, peninsulas. Low, flat ground; shape it on the Terrain tab.' },
  { id: 'sea', group: 'outline', name: 'Sea', hint: 'Paint the sea back over land: coves, bays, straits, inland seas.' },
  { id: 'shallows', group: 'outline', name: 'Shallows', hint: 'Shallow water: reefs, banks, sounds and lagoons. Paints over deep sea or drowns land just under the waves.' },
  { id: 'deep', group: 'outline', name: 'Deep sea', hint: 'Deepen the sea: ocean basins and trenches. Leaves land alone.' },
  { id: 'mountains', group: 'terrain', name: 'Mountains', hint: 'Drag along a range: your stroke becomes the crest, with peaks and saddles along it and spurs and side valleys running down from it, as wide as the brush. Each new stroke over it builds it higher, up to the height limit. Water wears it when you let go.' },
  { id: 'hills', group: 'terrain', name: 'Hills', hint: 'A sponge: roughs up the land under the brush with lumps and hollows. Go over it again for rougher hill country, up to the height limit.' },
  { id: 'raise', group: 'terrain', name: 'Raise', hint: 'Lift the ground gently and evenly, up to the height limit.' },
  { id: 'lower', group: 'terrain', name: 'Lower', hint: 'Sink the ground, never below the lowest height and never into the sea (the coast is drawn on Land & Sea).' },
  { id: 'plateau', group: 'terrain', name: 'Plateau', hint: 'Level the ground to the height where the stroke began: plateaus, mesas, table lands.' },
  { id: 'cliff', group: 'terrain', name: 'Cliff', hint: 'Raise the land on the left of your stroke into a cliff, dropping sheer along the line you draw. Strength sets how tall, the height limit how high.' },
  { id: 'smooth', group: 'terrain', name: 'Smooth', hint: 'Blends the land under the brush together: knocks down the sharp highs, fills the dips, softens slopes. Go over it again to smooth it more.' },
  { id: 'ramp', group: 'terrain', name: 'Ramp', hint: 'Click and drag along the way the ramp should go: it rises (or falls) evenly along your path, curves and all, from the height where you pressed to the height where you let go. Its sides blend into the land beside it. Wind it up a mountainside for a road or a pass.' },
  { id: 'valley', group: 'terrain', name: 'Valley', hint: 'Cut a V-shaped valley along the stroke, never below the lowest height (and never into the sea).' },
  { id: 'river', group: 'water', name: 'River', hint: 'Click where the river rises, then click each point it should pass. It ends when it reaches the sea, a lake or another river, or press Enter. It finds the natural way between your points and cuts through anything in the way. Esc cancels; click a river to select it, Delete removes it.' },
  { id: 'lake', group: 'water', name: 'Lake', hint: 'Click a low spot: the hollow fills with water to where it would spill over. Set how high it stands with Water level. Click a lake to select it.' },
  { id: 'lakeAdd', group: 'water', name: 'Add water', hint: 'Paint lake water in: widen a lake, or make a pond.' },
  { id: 'lakeRemove', group: 'water', name: 'Remove water', hint: 'Paint land back over lake water: islands, headlands, a narrower shore.' },
];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Brush {
  tool: BrushTool;
  /** Radius in tiles: how wide the stroke is. */
  radius: number;
  /** 0..1 */
  strength: number;
  /** 0..1: how ragged the edge of land and sea is. */
  roughness?: number;
  /** The highest the raising tools build to (map height units). */
  top?: number;
  /** The lowest the lowering tools cut to (map height units). */
  floor?: number;
  /** Height the plateau and cliff work to (set where the stroke began). */
  level?: number;
  /** Which way the stroke is heading (for the cliff). */
  dir?: [number, number];
}

/** The level a stroke works to: a plateau keeps the height where it began; a cliff rises above it. */
export function strokeLevel(tool: BrushTool, start: number, strength = 0.5): number | undefined {
  if (tool === 'plateau') return start;
  if (tool === 'cliff') return Math.max(0.01, start) + 0.03 + 0.12 * strength;
  return undefined;
}

/** How much one dab lifts or sinks the ground at full strength. */
const STEP = 0.06;
/** Heights the outline tools paint: new land, the sea, shallows, the deep. */
const LAND = 0.015;
/** The lowest the Terrain tools take land: just above the sea, so a coast never moves. */
const LAND_FLOOR = 0.002;
const SEA = -0.12;
const SHALLOW = -0.025;
const DEEP = -0.45;
/** How far, in tiles, a tile's height reaches into the fine grid laid out from the tiles. */
const SPREAD = 3;

const OUTLINE = new Set<BrushTool>(['land', 'sea', 'shallows', 'deep']);

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The land as drawn in the editor, in two layers, as a flat map program and a terrain program
 * would keep it:
 *  - `heights`, one per tile: the outline of land and sea (Land & Sea), and how deep the sea is;
 *  - `relief`, on the fine grid the land is carved on (`scale` cells to a tile each way): the land
 *    shaped by hand on top of that (Terrain).
 * The Terrain tools work on the fine grid, inside the brush's circle exactly and nowhere else, and
 * only on land: they never move a coast. The map carves the result with running water (see
 * ChunkCarver), only where it changed.
 */
export class TerrainEditor {
  readonly scale: number;
  /** The land shaped by hand, added to the land laid out from the tiles. */
  readonly relief: Float32Array;
  /** The land laid out from the tiles on the fine grid (before any shaping), and where it is water. */
  private under: Float32Array;
  private wet: Uint8Array;
  private rough: Noise2D;
  private detail: Noise2D;
  private undo: { heights: Float32Array; relief: Float32Array }[] = [];
  /** The crest a Mountains stroke has raised so far, and how far along it the stroke has come. */
  private ridgeLayer: Float32Array | null = null;
  private ridgeU = 0;

  constructor(public heights: Float32Array, public width: number, public height: number, seed = 1, scale = 4, relief?: Float32Array | null) {
    this.scale = scale;
    const n = width * scale * height * scale;
    this.relief = relief && relief.length === n ? relief : new Float32Array(n);
    this.under = new Float32Array(n);
    this.wet = new Uint8Array(n);
    this.rough = new Noise2D(new Rng(seed).fork('brush-edge'));
    this.detail = new Noise2D(new Rng(seed).fork('brush-detail'));
    this.layOut({ x0: 0, y0: 0, x1: width - 1, y1: height - 1 });
  }

  /** Remember the land as it is, so the next stroke can be undone. */
  beginStroke(): void {
    this.undo.push({ heights: Float32Array.from(this.heights), relief: Float32Array.from(this.relief) });
    if (this.undo.length > 20) this.undo.shift();
    this.ridgeLayer = null;
    this.ridgeU = 0;
  }

  canUndo(): boolean {
    return this.undo.length > 0;
  }

  undoStroke(): boolean {
    const prev = this.undo.pop();
    if (!prev) return false;
    this.heights.set(prev.heights);
    this.relief.set(prev.relief);
    this.layOut({ x0: 0, y0: 0, x1: this.width - 1, y1: this.height - 1 });
    return true;
  }

  /** The land's height at a point (tiles), as shaped, before it is carved. */
  heightAt(x: number, y: number): number {
    const S = this.scale;
    const W = this.width * S;
    const X = Math.max(0, Math.min(W - 1, Math.floor(x * S)));
    const Y = Math.max(0, Math.min(this.height * S - 1, Math.floor(y * S)));
    const i = Y * W + X;
    if (this.wet[i]) return this.heights[Math.min(this.height - 1, Math.floor(y)) * this.width + Math.min(this.width - 1, Math.floor(x))];
    return this.under[i] + this.relief[i];
  }

  /** Lay the tiles of a box (and as far around as they reach) out on the fine grid, as the carving does. */
  private layOut(box: Box): void {
    const { width: w, height: h, scale: s, heights } = this;
    const W = w * s;
    const surf = (x: number, y: number) => Math.max(0, heights[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)]);
    const sea = (x: number, y: number) => (heights[y * w + x] < 0 ? 1 : 0);
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const X0 = Math.max(0, box.x0 - SPREAD) * s;
    const Y0 = Math.max(0, box.y0 - SPREAD) * s;
    const X1 = Math.min(w, box.x1 + 1 + SPREAD) * s;
    const Y1 = Math.min(h, box.y1 + 1 + SPREAD) * s;
    for (let Y = Y0; Y < Y1; Y++) {
      const fy = (Y + 0.5) / s - 0.5;
      const y1 = Math.floor(fy);
      const ty = fy - y1;
      for (let X = X0; X < X1; X++) {
        const fx = (X + 0.5) / s - 0.5;
        const x1 = Math.floor(fx);
        const tx = fx - x1;
        const i = Y * W + X;
        const wx0 = x1 < 0 ? 0 : x1;
        const wy0 = y1 < 0 ? 0 : y1;
        const wx1 = Math.min(w - 1, x1 + 1);
        const wy1 = Math.min(h - 1, y1 + 1);
        const cx = Math.min(1, Math.max(0, tx));
        const cy = Math.min(1, Math.max(0, ty));
        const wet = (sea(wx0, wy0) * (1 - cx) + sea(wx1, wy0) * cx) * (1 - cy) + (sea(wx0, wy1) * (1 - cx) + sea(wx1, wy1) * cx) * cy;
        if (wet >= 0.5) {
          this.wet[i] = 1;
          this.under[i] = 0;
          // Land under the sea keeps no shaping: painted back into land, it comes back flat.
          this.relief[i] = 0;
          continue;
        }
        this.wet[i] = 0;
        const row = (yy: number) => cr(surf(x1 - 1, yy), surf(x1, yy), surf(x1 + 1, yy), surf(x1 + 2, yy), tx);
        this.under[i] = Math.max(0.001, cr(row(y1 - 1), row(y1), row(y1 + 1), row(y1 + 2), ty));
      }
    }
  }

  /** Apply one dab of the tool centred at (cx, cy) in tile coordinates. Returns the changed area (tiles). */
  dab(cx: number, cy: number, b: Brush): Box {
    if (b.tool === 'river' || b.tool === 'lake' || b.tool === 'lakeAdd' || b.tool === 'lakeRemove' || b.tool === 'ramp') return { x0: 0, y0: 0, x1: -1, y1: -1 };
    if (b.tool === 'smooth') return this.blur(cx, cy, b);
    if (b.tool === 'mountains') return this.ridge(cx, cy, cx, cy, b);
    if (!OUTLINE.has(b.tool)) return this.shape(cx, cy, b);
    const w = this.width;
    const h = this.height;
    const Hs = this.heights;
    const r = Math.max(0.5, b.radius);
    const rough = Math.max(0, Math.min(1, b.roughness ?? 0.5));
    const reach = r * (1 + rough * 0.8);
    const x0 = Math.max(0, Math.floor(cx - reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const x1 = Math.min(w - 1, Math.ceil(cx + reach));
    const y1 = Math.min(h - 1, Math.ceil(cy + reach));
    const k = Math.max(0.02, Math.min(1, b.strength));
    // The edge wanders at the brush's own scale and finer, more with more roughness.
    const fq = 1.6 / r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const wobble = this.rough.fbm(x * fq + 3.7, y * fq - 1.3, 4) * rough * 0.75 + this.rough.noise(x * 0.9, y * 0.9) * rough * 0.15;
        const d = Math.sqrt(dx * dx + dy * dy) / r + wobble;
        if (d >= 1) continue;
        const i = y * w + x;
        const e = Hs[i];
        const t = 1 - d;
        let v = e;
        switch (b.tool) {
          case 'land':
            if (e < LAND) v = LAND + this.detail.noise(x * 0.3, y * 0.3) * 0.004;
            break;
          case 'sea':
            if (e > SEA) v = SEA + this.detail.noise(x * 0.2, y * 0.2) * 0.02;
            break;
          case 'shallows':
            v = SHALLOW + this.detail.noise(x * 0.4, y * 0.4) * 0.008;
            break;
          case 'deep':
            if (e > DEEP) v = e + (DEEP - e) * Math.min(1, k * 0.5) * Math.min(1, t * 3);
            break;
        }
        Hs[i] = Math.max(-1, Math.min(1, v));
      }
    }
    const box = { x0, y0, x1, y1 };
    this.layOut(box);
    return { x0: Math.max(0, x0 - SPREAD), y0: Math.max(0, y0 - SPREAD), x1: Math.min(w - 1, x1 + SPREAD), y1: Math.min(h - 1, y1 + SPREAD) };
  }

  /** The fine cells inside a circle (tiles), as a box of cells, and the box of tiles it covers. */
  private cells(cx: number, cy: number, r: number) {
    const S = this.scale;
    const X0 = Math.max(0, Math.floor((cx - r) * S));
    const Y0 = Math.max(0, Math.floor((cy - r) * S));
    const X1 = Math.min(this.width * S - 1, Math.ceil((cx + r) * S));
    const Y1 = Math.min(this.height * S - 1, Math.ceil((cy + r) * S));
    return { X0, Y0, X1, Y1, tiles: { x0: Math.floor(X0 / S), y0: Math.floor(Y0 / S), x1: Math.floor(X1 / S), y1: Math.floor(Y1 / S) } };
  }

  /**
   * One dab of Smooth: each point under the brush moves towards the average of the land around it
   * (over about a third of the brush's width), most in the middle of the brush and not at all at
   * its edge, so sharp highs come down, dips fill and slopes even out. Only land is averaged.
   */
  private blur(cx: number, cy: number, b: Brush): Box {
    const S = this.scale;
    const W = this.width * S;
    const H = this.height * S;
    const r = Math.max(0.25, b.radius);
    const k = Math.max(0.02, Math.min(1, b.strength));
    const kr = Math.max(1, Math.round(r * S * 0.3));
    const { X0, Y0, X1, Y1, tiles } = this.cells(cx, cy, r);
    // The land around the brush, as far out as the averaging reaches.
    const ax0 = Math.max(0, X0 - kr);
    const ay0 = Math.max(0, Y0 - kr);
    const ax1 = Math.min(W - 1, X1 + kr);
    const ay1 = Math.min(H - 1, Y1 + kr);
    const aw = ax1 - ax0 + 1;
    const ah = ay1 - ay0 + 1;
    const v = new Float32Array(aw * ah);
    const m = new Float32Array(aw * ah);
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const i = (ay0 + y) * W + ax0 + x;
        if (this.wet[i]) continue;
        v[y * aw + x] = this.under[i] + this.relief[i];
        m[y * aw + x] = 1;
      }
    }
    // Averaged over a square, twice (rows then columns, then again): close to a soft round blur.
    const pass = (a: Float32Array) => {
      const t = new Float32Array(aw * ah);
      for (let y = 0; y < ah; y++) {
        let sum = 0;
        for (let x = -kr; x <= kr; x++) if (x >= 0 && x < aw) sum += a[y * aw + x];
        for (let x = 0; x < aw; x++) {
          t[y * aw + x] = sum;
          const out = x - kr;
          const inn = x + kr + 1;
          if (out >= 0) sum -= a[y * aw + out];
          if (inn < aw) sum += a[y * aw + inn];
        }
      }
      const o = new Float32Array(aw * ah);
      for (let x = 0; x < aw; x++) {
        let sum = 0;
        for (let y = -kr; y <= kr; y++) if (y >= 0 && y < ah) sum += t[y * aw + x];
        for (let y = 0; y < ah; y++) {
          o[y * aw + x] = sum;
          const out = y - kr;
          const inn = y + kr + 1;
          if (out >= 0) sum -= t[out * aw + x];
          if (inn < ah) sum += t[inn * aw + x];
        }
      }
      return o;
    };
    let sv = pass(v);
    let sm = pass(m);
    // Normalise between the passes so the second averages heights, not sums.
    const avg = new Float32Array(aw * ah);
    for (let i = 0; i < avg.length; i++) avg[i] = sm[i] > 0 ? sv[i] / sm[i] : v[i];
    for (let i = 0; i < avg.length; i++) avg[i] *= m[i];
    sv = pass(avg);
    sm = pass(m);
    for (let Y = Y0; Y <= Y1; Y++) {
      const ty = (Y + 0.5) / S;
      for (let X = X0; X <= X1; X++) {
        const i = Y * W + X;
        if (this.wet[i]) continue;
        const dx = (X + 0.5) / S - cx;
        const dy = ty - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d >= 1) continue;
        const j = (Y - ay0) * aw + (X - ax0);
        if (sm[j] <= 0) continue;
        const e = this.under[i] + this.relief[i];
        const target = sv[j] / sm[j];
        const nv = e + (target - e) * smoothstep(0, 1, 1 - d) * k * 0.6;
        this.relief[i] = Math.max(LAND_FLOOR, Math.min(1, nv)) - this.under[i];
      }
    }
    return tiles;
  }

  /** One dab of a Terrain tool other than Mountains, Smooth and Ramp, on the fine grid, inside the circle exactly. */
  private shape(cx: number, cy: number, b: Brush): Box {
    const S = this.scale;
    const W = this.width * S;
    const r = Math.max(0.25, b.radius);
    const k = Math.max(0.02, Math.min(1, b.strength));
    const top = b.top ?? 1;
    const floor = b.floor ?? 0;
    const [ux, uy] = b.dir ?? [1, 0];
    const { X0, Y0, X1, Y1, tiles } = this.cells(cx, cy, r);
    for (let Y = Y0; Y <= Y1; Y++) {
      const ty = (Y + 0.5) / S;
      for (let X = X0; X <= X1; X++) {
        const i = Y * W + X;
        if (this.wet[i]) continue;
        const tx = (X + 0.5) / S;
        const dx = tx - cx;
        const dy = ty - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d >= 1) continue;
        const t = 1 - d;
        const e = this.under[i] + this.relief[i];
        let v = e;
        switch (b.tool) {
          case 'hills': {
            // A sponge: lumps and hollows a couple of tiles across, pressed into the land as it is,
            // so each pass roughens it further (mostly up, with dips between the hills).
            const n = this.detail.fbm(tx * 0.42 + 11.3, ty * 0.42 - 7.9, 3) * 0.7 + this.detail.noise(tx * 1.1 - 4.2, ty * 1.1 + 2.6) * 0.22 + this.rough.noise(tx * 2.6, ty * 2.6) * 0.08;
            const lump = n * 1.6 + 0.3;
            const lift = STEP * 0.3 * k * smoothstep(0, 1, t) * lump;
            v = lift > 0 ? Math.max(e, Math.min(e + lift, top)) : e + lift;
            break;
          }
          case 'raise': {
            const q = 1 - d * d;
            v = Math.max(e, Math.min(e + STEP * k * q * q, top));
            break;
          }
          case 'lower': {
            const q = 1 - d * d;
            v = Math.min(e, Math.max(e - STEP * k * q * q, floor));
            break;
          }
          case 'valley': {
            const lo = Math.max(floor, 0.003);
            v = Math.min(e, Math.max(e - STEP * 1.2 * k * Math.pow(t, 0.6), lo));
            break;
          }
          case 'plateau': {
            const lvl = Math.min(b.level ?? e, top);
            const edge = d < 0.8 ? 1 : (1 - d) / 0.2;
            v = e + (lvl - e) * edge * Math.min(1, k * 0.8);
            break;
          }
          case 'cliff': {
            // Left of the stroke (across its heading), lifted to the cliff's top; a sheer drop at the line.
            const side = ux * dy - uy * dx;
            if (side <= 0) break;
            const lvl = Math.min(b.level ?? e + 0.05, top);
            const step = Math.min(1, side / 0.6);
            if (lvl > e) v = e + (lvl - e) * step * Math.min(1, t * 2.5);
            break;
          }
        }
        this.relief[i] = Math.max(LAND_FLOOR, Math.min(1, v)) - this.under[i];
      }
    }
    return tiles;
  }

  /**
   * A stretch of a Mountains stroke, from a to b (tiles): the stroke is the crest of a ridge as
   * wide as the brush, as Gaea's Draw and Ridge make them. Along the crest the height rises to
   * peaks and dips to saddles; down its flanks spurs run out from it with side valleys between
   * them, their spacing set by the brush's width, so a thin brush makes a small ridge and a wide
   * one a great range. Within one stroke the ridge is the highest of what each stretch makes (going
   * back over it doesn't pile it up); each new stroke over it builds it higher.
   */
  private ridge(ax: number, ay: number, bx: number, by: number, b: Brush): Box {
    const S = this.scale;
    const W = this.width * S;
    const n = W * this.height * S;
    const base = this.undo[this.undo.length - 1]?.relief ?? null;
    if (!this.ridgeLayer) this.ridgeLayer = new Float32Array(n);
    const layer = this.ridgeLayer;
    const r = Math.max(0.25, b.radius);
    const k = Math.max(0.02, Math.min(1, b.strength));
    const top = b.top ?? 1;
    const amp = STEP * 3.2 * k;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const u0 = this.ridgeU;
    // Spurs this far apart (tiles), and the crest's peaks about three times that.
    const lam = Math.max(0.35, r * 0.42);
    const box = this.cells((ax + bx) / 2, (ay + by) / 2, r + len / 2);
    const { X0, Y0, X1, Y1 } = box;
    for (let Y = Y0; Y <= Y1; Y++) {
      const ty = (Y + 0.5) / S;
      for (let X = X0; X <= X1; X++) {
        const i = Y * W + X;
        if (this.wet[i]) continue;
        const tx = (X + 0.5) / S;
        const px = tx - ax;
        const py = ty - ay;
        const s = len > 1e-6 ? Math.max(0, Math.min(1, (px * dx + py * dy) / (len * len))) : 0;
        const qx = px - dx * s;
        const qy = py - dy * s;
        const dist = Math.hypot(qx, qy);
        if (dist >= r) continue;
        // Along the crest (u) and out from it (v), in tiles.
        const u = u0 + s * len;
        const v = len > 1e-6 ? (dx * py - dy * px) / len : dist;
        // The range swells and narrows along its length, within the brush.
        const girth = 0.8 + 0.2 * (0.5 + 0.5 * this.detail.noise(u / (lam * 4) + 1.7, 0.3));
        // Spurs: ridges running out from the crest, bending, with smaller spurs off them; their
        // ends reach the brush's edge and the side valleys between them cut back in.
        const warp = this.detail.noise(u / (lam * 2.5) + 9.1, v / (lam * 2.5) - 4.4) * 0.8;
        const av = Math.abs(v);
        const spur1 = 1 - Math.abs(this.rough.noise(u / lam + warp, av / (lam * 2.6) + 17.1));
        const spur2 = 1 - Math.abs(this.rough.noise(u / (lam * 0.5) + warp * 2, av / (lam * 1.3) - 6.2));
        const spurs = spur1 * 0.7 + spur2 * 0.3;
        const dd = dist / (r * girth) / (0.6 + 0.4 * Math.pow(spurs, 1.5));
        if (dd >= 1) continue;
        const p = 1 - dd;
        const peaks = 0.68 + 0.32 * this.detail.fbm(u / (lam * 3.2) + 5.3, 3.1, 2);
        const flank = smoothstep(0.04, 0.55, dd);
        const shape = Math.pow(p, 1.15) * (1 - 0.5 * flank * (1 - spurs * spurs));
        const grain = this.rough.noise(tx * 2.1 / lam + 3.3, ty * 2.1 / lam - 8.8) * 0.07 * p;
        const lift = amp * peaks * Math.max(0, shape + grain);
        if (lift <= layer[i]) continue;
        layer[i] = lift;
        const under = this.under[i];
        const was = base ? base[i] : 0;
        const e = under + was;
        const hgt = Math.min(e + lift, Math.max(top, e));
        this.relief[i] = Math.max(LAND_FLOOR, Math.min(1, hgt)) - under;
      }
    }
    this.ridgeU = u0 + len;
    return box.tiles;
  }

  /**
   * The Ramp drag: lays an even slope along the path dragged (`points`, in tiles), rising or
   * falling from the height where the drag began to the height where it is now, evenly by the
   * distance travelled along the path, curves and all: a road winding up a mountain, a switchback.
   * It is as wide as the brush; its sides fade into the land beside it over the outer two thirds
   * of the brush, so it meets the hillside like a natural spur. It works from the land as it was
   * before the drag and puts back what the last move laid (prev), so the ramp follows the pen live.
   * Sea is never touched. Returns the changed area in tiles (including what was put back).
   */
  ramp(points: [number, number][], b: Brush, prev: Box | null): Box {
    const S = this.scale;
    const W = this.width * S;
    const base = this.undo[this.undo.length - 1]?.relief;
    const none = { x0: 0, y0: 0, x1: -1, y1: -1 };
    if (!base) return prev ?? none;
    if (prev) {
      for (let Y = prev.y0 * S; Y < (prev.y1 + 1) * S; Y++) for (let X = prev.x0 * S; X < (prev.x1 + 1) * S; X++) this.relief[Y * W + X] = base[Y * W + X];
    }
    // The length along the path to each point.
    const along = [0];
    for (let k = 1; k < points.length; k++) along.push(along[k - 1] + Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]));
    const total = along[along.length - 1];
    if (points.length < 2 || total < 0.2) return prev ?? none;
    const r = Math.max(0.25, b.radius);
    const at = (x: number, y: number) => {
      const i = Math.max(0, Math.min(this.height * S - 1, Math.floor(y * S))) * W + Math.max(0, Math.min(W - 1, Math.floor(x * S)));
      return this.wet[i] ? LAND_FLOOR : this.under[i] + base[i];
    };
    const [sx, sy] = points[0];
    const [ex, ey] = points[points.length - 1];
    const ha = Math.max(LAND_FLOOR, at(sx, sy));
    const hb = Math.max(LAND_FLOOR, at(ex, ey));
    const k = Math.max(0.02, Math.min(1, b.strength));
    // Each cell near the path: how far it is from the path, and how far along the path that is.
    let box: Box | null = null;
    for (const [x, y] of points) box = union(box, this.cells(x, y, r).tiles);
    const bx = box!;
    const X0 = bx.x0 * S;
    const Y0 = bx.y0 * S;
    const bw = (bx.x1 - bx.x0 + 1) * S;
    const bh = (bx.y1 - bx.y0 + 1) * S;
    const dist = new Float32Array(bw * bh).fill(Infinity);
    const pos = new Float32Array(bw * bh);
    for (let q = 1; q < points.length; q++) {
      const [ax, ay] = points[q - 1];
      const [cx, cy] = points[q];
      const dx = cx - ax;
      const dy = cy - ay;
      const len2 = dx * dx + dy * dy;
      const seg = this.cells((ax + cx) / 2, (ay + cy) / 2, r + Math.sqrt(len2) / 2);
      for (let Y = seg.Y0; Y <= seg.Y1; Y++) {
        const ty = (Y + 0.5) / S;
        for (let X = seg.X0; X <= seg.X1; X++) {
          const j = (Y - Y0) * bw + (X - X0);
          if (j < 0 || j >= dist.length) continue;
          const px = (X + 0.5) / S - ax;
          const py = ty - ay;
          const t = len2 > 1e-9 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
          const d = Math.hypot(px - dx * t, py - dy * t);
          if (d < dist[j]) {
            dist[j] = d;
            pos[j] = (along[q - 1] + t * Math.sqrt(len2)) / total;
          }
        }
      }
    }
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const j = y * bw + x;
        const dd = dist[j] / r;
        if (dd >= 1) continue;
        const i = (Y0 + y) * W + X0 + x;
        if (this.wet[i]) continue;
        const e = this.under[i] + base[i];
        const target = ha + (hb - ha) * pos[j];
        // Full along the middle third, fading smoothly into the land beside it.
        const side = 1 - smoothstep(0.33, 1, dd);
        const v = e + (target - e) * side * (0.3 + 0.7 * k);
        this.relief[i] = Math.max(LAND_FLOOR, Math.min(1, v)) - this.under[i];
      }
    }
    return union(prev, bx);
  }

  /** Apply the tool along a stroke from one point to the next. Returns the changed area (tiles). */
  line(ax: number, ay: number, bx: number, by: number, b: Brush): Box {
    if (b.tool === 'mountains') return this.ridge(ax, ay, bx, by, b);
    const len = Math.hypot(bx - ax, by - ay);
    if (len > 1e-6) b = { ...b, dir: [(bx - ax) / len, (by - ay) / len] };
    // A dab every quarter width (the outline's tiles), or every half cell (the fine grid).
    const gap = OUTLINE.has(b.tool) ? Math.max(0.5, b.radius * 0.25) : Math.max(0.5 / this.scale, b.radius * 0.25);
    const steps = Math.max(1, Math.ceil(len / gap));
    let box: Box | null = null;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      box = union(box, this.dab(ax + (bx - ax) * t, ay + (by - ay) * t, b));
    }
    return box ?? { x0: 0, y0: 0, x1: -1, y1: -1 };
  }

  /** Drown everything: a blank ocean to raise continents from. */
  clear(depth = SEA): void {
    const w = this.width;
    const h = this.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.heights[y * w + x] = depth + 0.08 * this.detail.fbm(x * 0.05, y * 0.05, 3);
      }
    }
    this.relief.fill(0);
    this.layOut({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
  }
}

function union(a: Box | null, b: Box): Box {
  if (b.x1 < b.x0) return a ?? b;
  return !a || a.x1 < a.x0 ? b : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
