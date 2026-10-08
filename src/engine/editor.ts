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
  { id: 'mountains', group: 'terrain', name: 'Mountains', hint: 'Drag along a range: a sharp crest, rising with each pass up to the height limit. Erosion carves its valleys and spurs.' },
  { id: 'hills', group: 'terrain', name: 'Hills', hint: 'Rolling, uneven hill country, up to the height limit.' },
  { id: 'raise', group: 'terrain', name: 'Raise', hint: 'Lift the ground gently and evenly, up to the height limit.' },
  { id: 'lower', group: 'terrain', name: 'Lower', hint: 'Sink the ground, never below the lowest height and never into the sea (the coast is drawn on Land & Sea).' },
  { id: 'plateau', group: 'terrain', name: 'Plateau', hint: 'Level the ground to the height where the stroke began: plateaus, mesas, table lands.' },
  { id: 'cliff', group: 'terrain', name: 'Cliff', hint: 'Raise the land on the left of your stroke into a cliff, dropping sheer along the line you draw. Strength sets how tall, the height limit how high.' },
  { id: 'smooth', group: 'terrain', name: 'Smooth', hint: 'Soften the land: gentler slopes, rounded ridges.' },
  { id: 'valley', group: 'terrain', name: 'Valley', hint: 'Cut a V-shaped valley along the stroke, never below the lowest height (and never into the sea).' },
  { id: 'river', group: 'water', name: 'River', hint: 'Click where the river rises, then click each point it should pass. It ends when it reaches the sea, a lake or another river, or press Enter. It finds the natural way between your points and cuts through anything in the way. Esc cancels; click a river to select it, Delete removes it.' },
  { id: 'lake', group: 'water', name: 'Lake', hint: 'Click a low spot: the hollow fills with water to where it would spill over. Set how high it stands with Water level. Click a lake to select it.' },
  { id: 'lakeAdd', group: 'water', name: 'Add water', hint: 'Paint lake water in: widen a lake, or make a pond.' },
  { id: 'lakeRemove', group: 'water', name: 'Remove water', hint: 'Paint land back over lake water: islands, headlands, a narrower shore.' },
];

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

/**
 * Shapes a height field (sea below 0, land 0..1) with one terrain tool that raises, lowers or
 * flattens. Raising builds a rounded rise under the brush; going over it again builds it higher,
 * so strokes along a line make a range whose width is the brush's. The map carves the range with
 * running water (see erodeRelief), which leaves the crest and spurs. Edges are roughened a little with noise so coasts and ranges don't come out round.
 */
export class TerrainEditor {
  private rough: Noise2D;
  private detail: Noise2D;
  private undo: Float32Array[] = [];

  constructor(public heights: Float32Array, public width: number, public height: number, seed = 1) {
    this.rough = new Noise2D(new Rng(seed).fork('brush-edge'));
    this.detail = new Noise2D(new Rng(seed).fork('brush-detail'));
  }

  /** Remember the land as it is, so the next stroke can be undone. */
  beginStroke(): void {
    this.undo.push(Float32Array.from(this.heights));
    if (this.undo.length > 30) this.undo.shift();
  }

  canUndo(): boolean {
    return this.undo.length > 0;
  }

  undoStroke(): boolean {
    const prev = this.undo.pop();
    if (!prev) return false;
    this.heights.set(prev);
    return true;
  }

  heightAt(x: number, y: number): number {
    const tx = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
    const ty = Math.max(0, Math.min(this.height - 1, Math.floor(y)));
    return this.heights[ty * this.width + tx];
  }

  /** Apply one dab of the tool centred at (cx, cy) in tile coordinates. Returns the changed area. */
  dab(cx: number, cy: number, b: Brush): { x0: number; y0: number; x1: number; y1: number } {
    if (b.tool === 'river' || b.tool === 'lake' || b.tool === 'lakeAdd' || b.tool === 'lakeRemove') return { x0: 0, y0: 0, x1: -1, y1: -1 };
    const w = this.width;
    const h = this.height;
    const Hs = this.heights;
    const r = Math.max(0.5, b.radius);
    const outline = b.tool === 'land' || b.tool === 'sea' || b.tool === 'shallows' || b.tool === 'deep';
    const rough = outline ? Math.max(0, Math.min(1, b.roughness ?? 0.5)) : 0.1;
    const reach = r * (1 + rough * 0.8);
    const x0 = Math.max(0, Math.floor(cx - reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const x1 = Math.min(w - 1, Math.ceil(cx + reach));
    const y1 = Math.min(h - 1, Math.ceil(cy + reach));
    const k = Math.max(0.02, Math.min(1, b.strength));
    const top = b.top ?? 1;
    const floor = b.floor ?? 0;
    // The edge wanders at the brush's own scale and finer, more with more roughness.
    const fq = 1.6 / r;
    const [ux, uy] = b.dir ?? [1, 0];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const wobble = this.rough.fbm(x * fq + 3.7, y * fq - 1.3, 4) * rough * 0.75 + this.rough.noise(x * 0.9, y * 0.9) * rough * 0.15;
        const d = Math.sqrt(dx * dx + dy * dy) / r + wobble;
        if (d >= 1) continue;
        const i = y * w + x;
        const e = Hs[i];
        // The Terrain tools shape only the land: the coast and the sea are the outline's business.
        if (!outline && e < 0) continue;
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
          case 'mountains': {
            const lift = STEP * 1.5 * k * Math.pow(t, 1.6);
            v = Math.max(e, Math.min(e + lift, top));
            break;
          }
          case 'hills': {
            const bump = 0.55 + 0.45 * this.detail.noise(x * 0.45, y * 0.45);
            const lift = STEP * 0.45 * k * t * t * bump;
            v = Math.max(e, Math.min(e + lift, top));
            break;
          }
          case 'raise': {
            // A rounded rise, highest in the middle.
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
          case 'smooth': {
            let sum = 0;
            let cnt = 0;
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const xx = x + ox;
                const yy = y + oy;
                if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                sum += Hs[yy * w + xx];
                cnt++;
              }
            }
            const avg = sum / cnt;
            // Smoothing never turns land to sea or sea to land.
            const nv = e + (avg - e) * Math.min(1, k * t * 1.5);
            v = e >= 0 ? Math.max(0.001, nv) : Math.min(-0.001, nv);
            break;
          }
        }
        Hs[i] = outline ? Math.max(-1, Math.min(1, v)) : Math.max(LAND_FLOOR, Math.min(1, v));
      }
    }
    return { x0, y0, x1, y1 };
  }

  /** Apply the tool along a stroke from one point to the next, a dab every quarter width. */
  line(ax: number, ay: number, bx: number, by: number, b: Brush): { x0: number; y0: number; x1: number; y1: number } {
    const len = Math.hypot(bx - ax, by - ay);
    if (len > 1e-6) b = { ...b, dir: [(bx - ax) / len, (by - ay) / len] };
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, b.radius * 0.25)));
    let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const r = this.dab(ax + (bx - ax) * t, ay + (by - ay) * t, b);
      box = { x0: Math.min(box.x0, r.x0), y0: Math.min(box.y0, r.y0), x1: Math.max(box.x1, r.x1), y1: Math.max(box.y1, r.y1) };
    }
    return box;
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
  }
}
