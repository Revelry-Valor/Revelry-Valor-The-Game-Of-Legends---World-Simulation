import { pathLength, type Stroke, type Surface, type VineEnd } from './paint';
import { skyGround, type SkyLayer } from './sky';
import { covers, shapeOf } from './underdark';

/**
 * Giant trees, the canopy and giant vines (REDESIGN.md, section 5). A giant tree is planted at a
 * point: its trunk stands on the land and its crown spreads in the canopy layer, between the
 * surface and the lowest sky layer. Limbs reach out from the crowns (roads through the canopy, and
 * bridges where they meet another crown); tree cities are sites marked on them. Giant vines run
 * from one place to another, on one layer or between layers, and can be climbed and crossed.
 * None of it changes the surface, its climate or its provinces.
 */

export const VINE_END_NAMES: Record<VineEnd, string> = { surface: 'the surface', canopy: 'the canopy', sky1: 'sky layer 1', sky2: 'sky layer 2', sky3: 'sky layer 3' };

export interface GiantTree {
  id: number;
  stroke: Stroke;
  x: number;
  y: number;
  /** Crown radius (km). */
  crown: number;
  /** Trunk radius (km). */
  trunk: number;
}

/** A point-placed thing near which an erase click takes it away. */
const erased = <T extends { x: number; y: number }>(list: T[], st: Stroke, extra: number) => {
  for (let i = list.length - 1; i >= 0; i--) if (Math.hypot(list[i].x - st.pts[0], list[i].y - st.pts[1]) <= st.size / 2 + extra) list.splice(i, 1);
};

const treeCache = new WeakMap<Stroke[], GiantTree[]>();
/** The giant trees standing (erasing near a trunk fells it). */
export function giantTrees(surface: Surface): GiantTree[] {
  const hit = treeCache.get(surface.strokes);
  if (hit) return hit;
  const out: GiantTree[] = [];
  for (const st of surface.strokes) {
    if (st.brush !== 'gianttree' || st.pts.length < 2) continue;
    if (st.erase) erased(out, st, 3);
    else out.push({ id: st.id, stroke: st, x: st.pts[0], y: st.pts[1], crown: st.size / 2, trunk: Math.max(0.1, st.size / 20) });
  }
  treeCache.set(surface.strokes, out);
  return out;
}

/** The tree whose crown covers a place, if any. */
export function crownAt(surface: Surface, x: number, y: number): GiantTree | null {
  for (const t of giantTrees(surface)) if (covers(shapeOf(t.stroke), x, y)) return t;
  return null;
}

/** Whether a limb runs through a place (painted, and not erased since). */
export function limbAt(surface: Surface, x: number, y: number): boolean {
  let on = false;
  for (const st of surface.strokes) if (st.brush === 'limb' && covers(shapeOf(st), x, y)) on = !st.erase;
  return on;
}

/** Whether the canopy has something to stand on here: a crown or a limb. */
export function canopyGround(surface: Surface, x: number, y: number): boolean {
  return !!crownAt(surface, x, y) || limbAt(surface, x, y);
}

export interface TreeCity {
  id: number;
  x: number;
  y: number;
  /** The tree it is on (or whose limb it is on), null when it is on neither. */
  tree: GiantTree | null;
  onLimb: boolean;
}

/** The tree city sites, and what they stand on. */
export function treeCities(surface: Surface): TreeCity[] {
  const out: TreeCity[] = [];
  for (const st of surface.strokes) {
    if (st.brush !== 'treecity' || st.pts.length < 2) continue;
    if (st.erase) {
      erased(out, st, 3);
      continue;
    }
    const [x, y] = st.pts;
    const tree = crownAt(surface, x, y);
    const onLimb = !tree && limbAt(surface, x, y);
    // A city on a limb belongs to the nearest tree.
    let owner = tree;
    if (onLimb) {
      let best = Infinity;
      for (const t of giantTrees(surface)) {
        const d = Math.hypot(t.x - x, t.y - y) - t.crown;
        if (d < best) {
          best = d;
          owner = t;
        }
      }
    }
    out.push({ id: st.id, x, y, tree: owner, onLimb });
  }
  return out;
}

export interface Vine {
  id: number;
  stroke: Stroke;
  from: VineEnd;
  to: VineEnd;
  /** What is wrong with its ends, if anything ('' when both ends hold). */
  problem: string;
  length: number;
}

/** Whether a layer has ground to anchor a vine near a place (within a few miles). */
function holds(surface: Surface, end: VineEnd, x: number, y: number, land: (x: number, y: number) => boolean): boolean {
  const at = (px: number, py: number) => {
    if (end === 'surface') return land(px, py);
    if (end === 'canopy') return canopyGround(surface, px, py);
    return skyGround(surface, Number(end.slice(3)) as SkyLayer, px, py);
  };
  if (at(x, y)) return true;
  for (const r of [3, 8]) for (let a = 0; a < 8; a++) if (at(x + Math.cos((a * Math.PI) / 4) * r, y + Math.sin((a * Math.PI) / 4) * r)) return true;
  return false;
}

/** The giant vines and whether their ends hold (a surface end on land, a canopy end on a crown or limb, a sky end on an island). Erasing over a vine takes it away. */
export function giantVines(surface: Surface, land: (x: number, y: number) => boolean): Vine[] {
  const out: Vine[] = [];
  for (const st of surface.strokes) {
    if (st.brush !== 'vine' || st.pts.length < 2) continue;
    if (st.erase) {
      for (let i = out.length - 1; i >= 0; i--) {
        const sh = shapeOf(out[i].stroke);
        let hit = false;
        for (let k = 0; k < st.pts.length && !hit; k += 2) {
          const probe = { ...sh, half: sh.half + st.size / 2 + 2 };
          hit = covers(probe, st.pts[k], st.pts[k + 1]);
        }
        if (hit) out.splice(i, 1);
      }
      continue;
    }
    const from = st.vineFrom ?? 'surface';
    const to = st.vineTo ?? from;
    const n = st.pts.length;
    const issues: string[] = [];
    if (!holds(surface, from, st.pts[0], st.pts[1], land)) issues.push(`its start isn’t on ${from === 'surface' ? 'land' : from === 'canopy' ? 'a crown or limb' : `an island on ${VINE_END_NAMES[from]}`}`);
    if (!holds(surface, to, st.pts[n - 2], st.pts[n - 1], land)) issues.push(`its end isn’t on ${to === 'surface' ? 'land' : to === 'canopy' ? 'a crown or limb' : `an island on ${VINE_END_NAMES[to]}`}`);
    out.push({ id: st.id, stroke: st, from, to, problem: issues.join(' and '), length: pathLength(st.pts) });
  }
  return out;
}

/** Total length of the limbs (km). */
export function limbLength(surface: Surface): number {
  return surface.strokes.filter((s) => s.brush === 'limb' && !s.erase).reduce((a, s) => a + pathLength(s.pts), 0);
}
