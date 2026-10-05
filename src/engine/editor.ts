import { Noise2D } from './noise';
import { Rng } from './rng';

/** What the terrain tool does: lift the ground, sink it, or level it; or mark where a river rises. */
export type BrushTool = 'raise' | 'lower' | 'flatten' | 'river';

export const BRUSHES: { id: BrushTool; name: string; hint: string }[] = [
  { id: 'raise', name: 'Raise', hint: 'Lift the ground. Out of the sea it makes land; keep going over it and it builds hills, then a mountain range. When you let go, running water carves it: valleys cut up into the range and leave a sharp crest with spurs running down to the valley floor. A wide brush gives a broad range, a narrow one a thin ridge.' },
  { id: 'lower', name: 'Lower', hint: 'Sink the ground: cut valleys and passes, or drown land to make coves, inlets and seas.' },
  { id: 'flatten', name: 'Flatten', hint: 'Level the ground to the height where the stroke began: plateaus, mesas and table lands, with steep edges.' },
  { id: 'river', name: 'River source', hint: 'Click (or drag) where a river should rise, as Gaea paints headwaters. Each runs downhill from there to the sea or a lake, joining any river it meets. Undo takes them away again.' },
];

export interface Brush {
  tool: BrushTool;
  /** Radius in tiles: how wide the stroke is. */
  radius: number;
  /** 0..1 */
  strength: number;
  /** Height the flatten function levels towards (set where the stroke began). */
  level?: number;
}

/** The level a stroke works to: flatten keeps the height where it began. */
export function strokeLevel(tool: BrushTool, start: number): number | undefined {
  return tool === 'flatten' ? start : undefined;
}

/** How much one dab lifts or sinks the ground at full strength. */
const STEP = 0.06;

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
    if (b.tool === 'river') return { x0: 0, y0: 0, x1: -1, y1: -1 };
    const w = this.width;
    const h = this.height;
    const H = this.heights;
    const r = Math.max(0.5, b.radius);
    const reach = r * 1.2;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const x1 = Math.min(w - 1, Math.ceil(cx + reach));
    const y1 = Math.min(h - 1, Math.ceil(cy + reach));
    const k = Math.max(0.02, Math.min(1, b.strength));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // Distance as a share of the radius, wobbled a little for a natural edge.
        const d = Math.sqrt(dx * dx + dy * dy) / r + this.rough.fbm(x * 0.18, y * 0.18, 3) * 0.15;
        if (d >= 1) continue;
        const i = y * w + x;
        const e = H[i];
        let v = e;
        if (b.tool === 'flatten') {
          // Level inside, with a short, steep edge: the walls of a plateau.
          const lvl = b.level ?? e;
          const edge = d < 0.8 ? 1 : (1 - d) / 0.2;
          v = e + (lvl - e) * edge * Math.min(1, k * 0.8);
        } else {
          // A rounded rise (or hollow) under the brush, highest at its middle.
          const t = 1 - d * d;
          const lift = STEP * k * t * t;
          v = b.tool === 'raise' ? e + lift : e - lift;
        }
        H[i] = Math.max(-1, Math.min(1, v));
      }
    }
    return { x0, y0, x1, y1 };
  }

  /** Apply the tool along a stroke from one point to the next, a dab every quarter width. */
  line(ax: number, ay: number, bx: number, by: number, b: Brush): { x0: number; y0: number; x1: number; y1: number } {
    const len = Math.hypot(bx - ax, by - ay);
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
  clear(depth = -0.2): void {
    const w = this.width;
    const h = this.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.heights[y * w + x] = depth + 0.08 * this.detail.fbm(x * 0.05, y * 0.05, 3);
      }
    }
  }
}
