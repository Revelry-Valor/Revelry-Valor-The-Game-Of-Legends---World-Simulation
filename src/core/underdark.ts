import { pathLength, type BrushId, type Stroke, type Surface } from './paint';

/**
 * The Underdark (REDESIGN.md, section 5): caverns, tunnels and underground seas cut into the rock
 * under the land, their own ground cover, and the cave entrances and shafts that join them to the
 * surface. Painted with its own brushes into the same stroke list as the surface (so undo, erase,
 * Adjust and saving work the same), but nothing here changes the surface, its climate or provinces.
 *
 * Every painted shape is a set of round dabs (areas) or a thick line (tunnels), worked out here
 * once, so the map picture and "what is here?" always agree.
 */

export type UnderKind = 'rock' | 'cavern' | 'tunnel' | 'sea';
export type UnderCover = 'fungus' | 'glowcave' | 'crystalcave';

export const UNDER_NAMES: Record<UnderKind | UnderCover, string> = {
  rock: 'Solid rock',
  cavern: 'Cavern',
  tunnel: 'Tunnel',
  sea: 'Underground sea',
  fungus: 'Fungus forest',
  glowcave: 'Glowing caves',
  crystalcave: 'Crystal caverns',
};

const OPEN: BrushId[] = ['cavern', 'tunnel'];
const COVER: BrushId[] = ['fungus', 'glowcave', 'crystalcave'];

/** A small, steady hash noise in [0, 1). */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A painted area as round dabs along its path: [x, y, radius] km, ragged by its roughness. */
export function dabsOf(st: Stroke): number[] {
  const p = st.pts;
  const r0 = st.size / 2;
  const out: number[] = [];
  const spacing = Math.max(0.3, r0 * 0.45);
  const rough = st.roughness ?? 0.5;
  let k = 0;
  const put = (x: number, y: number) => {
    // Lumps: each dab a little bigger or smaller, and a few side bubbles where it's ragged.
    const n1 = hash(st.id * 7919 + k, 17);
    const n2 = hash(st.id * 7919 + k, 43);
    out.push(x, y, r0 * (1 - rough * 0.35 + n1 * rough * 0.5));
    if (rough > 0.2 && n2 < rough * 0.6) {
      const a = hash(st.id, k) * Math.PI * 2;
      const d = r0 * (0.55 + 0.3 * n1);
      out.push(x + Math.cos(a) * d, y + Math.sin(a) * d, r0 * (0.3 + 0.35 * n2));
    }
    k++;
  };
  if (p.length < 4) {
    put(p[0], p[1]);
    return out;
  }
  put(p[0], p[1]);
  let carry = 0;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2];
    const ay = p[i - 1];
    const dx = p[i] - ax;
    const dy = p[i + 1] - ay;
    const len = Math.hypot(dx, dy);
    let t = spacing - carry;
    while (t <= len) {
      put(ax + (dx * t) / len, ay + (dy * t) / len);
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  put(p[p.length - 2], p[p.length - 1]);
  return out;
}

/** Distance from a point to a path (km). */
function distToPath(p: number[], x: number, y: number): number {
  if (p.length < 4) return Math.hypot(x - p[0], y - p[1]);
  let best = Infinity;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2];
    const ay = p[i - 1];
    const dx = p[i] - ax;
    const dy = p[i + 1] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** One painted shape of the Underdark, ready to test and draw. */
export interface UnderShape {
  stroke: Stroke;
  /** Areas: dabs [x, y, r]. Tunnels: none (the path and half width are used). */
  dabs: number[];
  half: number;
  box: [number, number, number, number];
}

const shapeCache = new WeakMap<Stroke, UnderShape>();
export function shapeOf(st: Stroke): UnderShape {
  const hit = shapeCache.get(st);
  if (hit) return hit;
  const dabs = st.brush === 'tunnel' ? [] : dabsOf(st);
  const half = st.size / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  if (dabs.length) {
    for (let i = 0; i < dabs.length; i += 3) {
      x0 = Math.min(x0, dabs[i] - dabs[i + 2]);
      x1 = Math.max(x1, dabs[i] + dabs[i + 2]);
      y0 = Math.min(y0, dabs[i + 1] - dabs[i + 2]);
      y1 = Math.max(y1, dabs[i + 1] + dabs[i + 2]);
    }
  } else {
    for (let i = 0; i < st.pts.length; i += 2) {
      x0 = Math.min(x0, st.pts[i] - half);
      x1 = Math.max(x1, st.pts[i] + half);
      y0 = Math.min(y0, st.pts[i + 1] - half);
      y1 = Math.max(y1, st.pts[i + 1] + half);
    }
  }
  const sh = { stroke: st, dabs, half, box: [x0, y0, x1, y1] as [number, number, number, number] };
  shapeCache.set(st, sh);
  return sh;
}

/** Whether a shape covers a point. */
export function covers(sh: UnderShape, x: number, y: number): boolean {
  const [x0, y0, x1, y1] = sh.box;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  if (!sh.dabs.length) return distToPath(sh.stroke.pts, x, y) <= sh.half;
  const d = sh.dabs;
  for (let i = 0; i < d.length; i += 3) {
    const dx = x - d[i];
    const dy = y - d[i + 1];
    if (dx * dx + dy * dy <= d[i + 2] * d[i + 2]) return true;
  }
  return false;
}

/** The Underdark's painted shapes, in the order painted. */
export function underStrokes(surface: Surface): Stroke[] {
  return surface.strokes.filter((s) => OPEN.includes(s.brush) || s.brush === 'undersea' || COVER.includes(s.brush));
}

/** What is at a place in the Underdark (land or not is the caller's to say: beyond the land is sea). */
export interface UnderHere {
  kind: UnderKind;
  cover: UnderCover | null;
}

/**
 * What the Underdark has at a place, the strokes taken in the order painted. Three things are kept
 * apart, as the map draws them: open floor (caverns and tunnels hollow the rock, erasing fills it
 * back), underground seas (flooding over whatever is there; erasing drains it back to what was
 * under it), and ground cover (shown only on open, dry floor; erasing any cover brush clears it).
 */
export function underdarkAt(strokes: Stroke[], x: number, y: number): UnderHere {
  let open: 'cavern' | 'tunnel' | null = null;
  let sea = false;
  let cover: UnderCover | null = null;
  for (const st of strokes) {
    if (!covers(shapeOf(st), x, y)) continue;
    if (OPEN.includes(st.brush)) open = st.erase ? null : open === 'cavern' ? 'cavern' : (st.brush as 'cavern' | 'tunnel');
    else if (st.brush === 'undersea') sea = !st.erase;
    else if (COVER.includes(st.brush)) cover = st.erase ? null : (st.brush as UnderCover);
  }
  if (sea) return { kind: 'sea', cover: null };
  if (!open) return { kind: 'rock', cover: null };
  return { kind: open, cover };
}

/** A way between the surface and the Underdark. */
export interface WayDown {
  id: number;
  kind: 'entrance' | 'shaft';
  x: number;
  y: number;
  /** What it opens into below (solid rock means it leads nowhere yet). */
  below: UnderKind;
}

/** The cave entrances and shafts (erasing one takes it away). */
export function waysDown(surface: Surface): WayDown[] {
  const strokes = underStrokes(surface);
  const out: WayDown[] = [];
  for (const st of surface.strokes) {
    if ((st.brush !== 'entrance' && st.brush !== 'shaft') || st.pts.length < 2) continue;
    const x = st.pts[0];
    const y = st.pts[1];
    if (st.erase) {
      // An erase dab takes away the ways down it touches.
      for (let i = out.length - 1; i >= 0; i--) if (Math.hypot(out[i].x - x, out[i].y - y) <= st.size / 2 + 3) out.splice(i, 1);
      continue;
    }
    // A way down opens into what is under its mouth, or within a couple of miles of it.
    let below = underdarkAt(strokes, x, y).kind;
    if (below === 'rock') {
      for (let a = 0; a < 8 && below === 'rock'; a++) {
        const k = underdarkAt(strokes, x + Math.cos((a * Math.PI) / 4) * 3, y + Math.sin((a * Math.PI) / 4) * 3).kind;
        if (k !== 'rock') below = k;
      }
    }
    out.push({ id: st.id, kind: st.brush, x, y, below });
  }
  return out;
}

/** How much of each kind the Underdark has, sampled on a grid (km²), counting only under land. */
export function underdarkSummary(surface: Surface, grid: { x0: number; y0: number; step: number; w: number; h: number }, land: (i: number) => boolean): Record<UnderKind | UnderCover, number> {
  const strokes = underStrokes(surface);
  const out: Record<UnderKind | UnderCover, number> = { rock: 0, cavern: 0, tunnel: 0, sea: 0, fungus: 0, glowcave: 0, crystalcave: 0 };
  if (!strokes.length) return out;
  // Only look where something is painted.
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const st of strokes) {
    const b = shapeOf(st).box;
    bx0 = Math.min(bx0, b[0]);
    by0 = Math.min(by0, b[1]);
    bx1 = Math.max(bx1, b[2]);
    by1 = Math.max(by1, b[3]);
  }
  // Fine enough for tunnels: up to a few times finer than the grid given.
  const thin = Math.min(...strokes.map((s) => s.size));
  const sub = Math.max(1, Math.min(4, Math.ceil(grid.step / Math.max(1, thin * 1.5))));
  const step = grid.step / sub;
  const cell = step * step;
  for (let j = 0; j < grid.h * sub; j++) {
    const y = grid.y0 - grid.step / 2 + (j + 0.5) * step;
    if (y < by0 || y > by1) continue;
    for (let i = 0; i < grid.w * sub; i++) {
      const x = grid.x0 - grid.step / 2 + (i + 0.5) * step;
      if (x < bx0 || x > bx1) continue;
      if (!land(Math.floor(j / sub) * grid.w + Math.floor(i / sub))) continue;
      const u = underdarkAt(strokes, x, y);
      if (u.kind === 'rock') continue;
      out[u.kind] += cell;
      if (u.cover) out[u.cover] += cell;
    }
  }
  return out;
}

/** Total length of the painted tunnels (km). */
export function tunnelLength(surface: Surface): number {
  return surface.strokes.filter((s) => s.brush === 'tunnel' && !s.erase).reduce((a, s) => a + pathLength(s.pts), 0);
}
