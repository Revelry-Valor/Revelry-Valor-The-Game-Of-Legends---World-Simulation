import { Noise2D } from './noise';
import { Rng } from './rng';

/** The world editor's brushes. */
export type BrushTool = 'land' | 'sea' | 'raise' | 'lower' | 'hills' | 'mountains' | 'peaks' | 'cliffs' | 'valley' | 'smooth' | 'flatten';

export const BRUSHES: { id: BrushTool; name: string; hint: string }[] = [
  { id: 'land', name: 'Land', hint: 'Paint new land out of the sea, with a ragged natural shore.' },
  { id: 'sea', name: 'Sea', hint: 'Drown land: carve coves, inlets, straits and bays.' },
  { id: 'raise', name: 'Raise', hint: 'Lift the ground gently.' },
  { id: 'lower', name: 'Lower', hint: 'Sink the ground gently (it stays land until it reaches the sea).' },
  { id: 'hills', name: 'Hills', hint: 'Rolling hill country.' },
  { id: 'mountains', name: 'Mountains', hint: 'Ridged mountain ranges: drag along the line of the range.' },
  { id: 'peaks', name: 'Peaks', hint: 'Single tall summits.' },
  { id: 'cliffs', name: 'Cliffs', hint: 'Sheer-sided plateaus and mesas with near-vertical walls.' },
  { id: 'valley', name: 'Valley', hint: 'Cut a valley down through hills and mountains (keeps it above the sea).' },
  { id: 'smooth', name: 'Smooth', hint: 'Soften slopes and blend rough ground.' },
  { id: 'flatten', name: 'Flatten', hint: 'Level the ground to the height where the stroke began.' },
];

export interface Brush {
  tool: BrushTool;
  /** Radius in tiles. */
  radius: number;
  /** 0..1 */
  strength: number;
  /** Height the flatten brush levels towards, or the cliff brush lifts its plateau to (set where the stroke began). */
  level?: number;
}

/** The level a stroke works to, from the height where it began: flatten keeps it, cliffs rise well above it. */
export function strokeLevel(tool: BrushTool, start: number, strength: number): number | undefined {
  if (tool === 'flatten') return start;
  if (tool === 'cliffs') return Math.min(1, Math.max(start, 0.02) + 0.06 + 0.2 * strength);
  return undefined;
}

/** Height just above the shore for newly painted land, and just below for new sea. */
const SHORE = 0.02;
const SHALLOWS = -0.08;

/**
 * Shapes a height field (sea below 0, land 0..1) with brushes. Edges are roughened with noise so
 * painted coasts and ranges look natural rather than round.
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

  /** Apply one dab of the brush centred at (cx, cy) in tile coordinates. Returns the changed area. */
  dab(cx: number, cy: number, b: Brush): { x0: number; y0: number; x1: number; y1: number } {
    const w = this.width;
    const h = this.height;
    const H = this.heights;
    const r = Math.max(0.5, b.radius);
    const reach = r * 1.3;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const x1 = Math.min(w - 1, Math.ceil(cx + reach));
    const y1 = Math.min(h - 1, Math.ceil(cy + reach));
    const k = Math.max(0.02, Math.min(1, b.strength));
    const src = b.tool === 'smooth' ? Float32Array.from(H) : H;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // Distance as a share of the radius, wobbled by noise for a natural edge.
        const wobble = this.rough.fbm(x * 0.18, y * 0.18, 3) * 0.35;
        const d = Math.sqrt(dx * dx + dy * dy) / r + wobble;
        if (d >= 1) continue;
        const soft = 1 - d * d * (3 - 2 * d); // smoothstep falloff
        const i = y * w + x;
        const e = H[i];
        const n = this.detail.fbm(x * 0.12, y * 0.12, 4);
        let v = e;
        switch (b.tool) {
          case 'land':
            if (e < SHORE) v = e + (SHORE + 0.03 * (n + 1) - e) * Math.min(1, soft * k * 2.5);
            break;
          case 'sea':
            if (e > SHALLOWS) v = e + (SHALLOWS - 0.12 * soft - e) * Math.min(1, soft * k * 2.5);
            break;
          case 'raise':
            v = e + 0.04 * k * soft;
            break;
          case 'lower':
            v = e >= 0 ? Math.max(SHORE * 0.5, e - 0.04 * k * soft) : e - 0.04 * k * soft;
            break;
          case 'hills': {
            if (e < 0) break;
            const target = 0.22 + 0.12 * n;
            if (e < target) v = e + (target - e) * soft * k * 0.5;
            v += 0.012 * k * soft * n;
            break;
          }
          case 'mountains': {
            if (e < 0) break;
            const ridge = this.detail.ridged(x * 0.09 + 31, y * 0.09 + 17, 4);
            v = e + (0.02 + 0.07 * ridge * ridge) * k * soft;
            break;
          }
          case 'peaks': {
            if (e < 0) break;
            const dd = Math.sqrt(dx * dx + dy * dy) / r;
            if (dd < 1) v = e + 0.12 * k * (1 - dd) ** 2.2;
            break;
          }
          case 'cliffs': {
            if (e < 0) break;
            // A flat top at one height with a hard edge, so the rim is a wall however often the brush passes.
            const top = b.level ?? e + 0.15;
            v = Math.max(e, e + (top - e) * (d < 0.9 ? 1 : (1 - d) / 0.1));
            break;
          }
          case 'valley':
            if (e > SHORE) v = Math.max(SHORE * 0.75, e - 0.05 * k * soft);
            break;
          case 'smooth': {
            let s = 0;
            let c = 0;
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const nx = x + ox;
                const ny = y + oy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                s += src[ny * w + nx];
                c++;
              }
            }
            const avg = s / c;
            // Smoothing never lets a shore tile cross the sea line by accident.
            v = e + (avg - e) * soft * k;
            if ((e >= 0) !== (v >= 0)) v = e >= 0 ? Math.max(1e-4, v) : Math.min(-1e-4, v);
            break;
          }
          case 'flatten': {
            const lvl = b.level ?? e;
            v = e + (lvl - e) * soft * k * 0.6;
            if ((e >= 0) !== (v >= 0) && lvl < 0 !== e < 0) v = lvl < 0 ? Math.min(-1e-4, v) : Math.max(1e-4, v);
            break;
          }
        }
        H[i] = Math.max(-1, Math.min(1, v));
      }
    }
    return { x0, y0, x1, y1 };
  }

  /** Apply the brush along a stroke from one point to the next, a dab every quarter radius. */
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

  /** Drown everything: a blank ocean to paint continents on. */
  clear(depth = -0.3): void {
    const w = this.width;
    const h = this.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.heights[y * w + x] = depth + 0.08 * this.detail.fbm(x * 0.05, y * 0.05, 3);
      }
    }
  }
}
