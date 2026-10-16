import { milesToKm } from './units';

/**
 * The painted surface (REDESIGN.md, section 6). Every brush stroke is kept as a path in world
 * kilometres with its brush settings: never a grid of cells. The map picture and the
 * simulation's "what is here?" both come from these strokes, so the land is the same at
 * every zoom and on every screen.
 */

export type BrushId =
  // Land & Sea (one shared layer)
  | 'land'
  | 'shallow'
  | 'deep'
  // Relief
  | 'mountains'
  | 'hills'
  | 'plateau'
  | 'cliffs'
  | 'canyon'
  | 'ravine'
  | 'crater'
  | 'erode'
  // Ground and ground cover
  | 'forest'
  | 'jungle'
  | 'grassland'
  | 'tundra'
  | 'marsh'
  | 'dunes'
  | 'badlands'
  | 'saltflats'
  | 'glacier'
  | 'beach'
  // Sea features
  | 'whirlpool'
  // Mountain zones (by hand)
  | 'zone';

export type MountainMode = 'range' | 'spur' | 'massif';

/** Mountain altitude zones (REDESIGN.md, 6.2a). 0 means none. */
export const ZONES = [
  { id: 1, name: 'Foothills', travel: 'Slightly slow', settle: 'Anyone' },
  { id: 2, name: 'Highlands', travel: 'Slow', settle: 'Most races: villages, mining camps, forts' },
  { id: 3, name: 'High mountains', travel: 'Impassable except by roads, passes or able races', settle: 'Only mountain-adapted races' },
  { id: 4, name: 'Peaks', travel: 'Impassable', settle: 'Nobody' },
] as const;
export type ZoneId = 0 | 1 | 2 | 3 | 4;

/** How a brush is used: painted as an area, drawn as a line, or placed at a point. */
export type BrushKind = 'area' | 'line' | 'point';

export interface BrushInfo {
  id: BrushId;
  name: string;
  group: 'Land & Sea' | 'Relief' | 'Ground cover' | 'Sea' | 'Mountain zones';
  kind: BrushKind;
  hint: string;
  /** Default brush settings. Size is the brush's width in miles. */
  sizeMi: number;
  strength: number;
  softness: number;
  roughness: number;
  /** Size of individual peaks, bumps or patches, in miles. */
  detailMi: number;
}

export const BRUSHES: BrushInfo[] = [
  { id: 'land', name: 'Land', group: 'Land & Sea', kind: 'area', hint: 'Paint continents and islands. A soft edge leaves a strip of shallow sea.', sizeMi: 120, strength: 1, softness: 0.35, roughness: 0.5, detailMi: 40 },
  { id: 'shallow', name: 'Shallow sea', group: 'Land & Sea', kind: 'area', hint: 'Continental shelves and banks. Reefs can only form here.', sizeMi: 120, strength: 1, softness: 0.5, roughness: 0.4, detailMi: 40 },
  { id: 'deep', name: 'Deep sea', group: 'Land & Sea', kind: 'area', hint: 'Open ocean. Also carves bays, straits and lakes out of land.', sizeMi: 120, strength: 1, softness: 0.35, roughness: 0.5, detailMi: 40 },
  { id: 'mountains', name: 'Mountains', group: 'Relief', kind: 'line', hint: 'Paints a crest down the middle of the brush, sloping to both sides. Paint over mountains to build them up and widen them; use a smaller, weaker brush along the edges to add shoulders. Range: drag along the crest. Spur: start on a range and drag outward. Massif: a broad block.', sizeMi: 90, strength: 0.75, softness: 0.5, roughness: 0.45, detailMi: 12 },
  { id: 'hills', name: 'Hills', group: 'Relief', kind: 'area', hint: 'Soft rolling bumps.', sizeMi: 80, strength: 0.7, softness: 0.6, roughness: 0.5, detailMi: 8 },
  { id: 'plateau', name: 'Plateau', group: 'Relief', kind: 'area', hint: 'Paint the shape of the top: a flat raised top with a steep shaded rim.', sizeMi: 80, strength: 0.7, softness: 0.08, roughness: 0.55, detailMi: 15 },
  { id: 'cliffs', name: 'Cliffs', group: 'Relief', kind: 'line', hint: 'Draw along the cliff edge. The high ground is on the side you choose.', sizeMi: 25, strength: 0.7, softness: 0.3, roughness: 0.3, detailMi: 5 },
  { id: 'canyon', name: 'Canyon / gorge', group: 'Relief', kind: 'line', hint: 'Draw the canyon. Blocks travel except where bridged.', sizeMi: 14, strength: 0.8, softness: 0.25, roughness: 0.35, detailMi: 3 },
  { id: 'ravine', name: 'Ravine', group: 'Relief', kind: 'line', hint: 'A narrow crack in the earth. Blocks travel.', sizeMi: 3, strength: 0.8, softness: 0.2, roughness: 0.3, detailMi: 1 },
  { id: 'crater', name: 'Crater', group: 'Relief', kind: 'point', hint: 'Click to place a crater. The size is its width.', sizeMi: 20, strength: 0.7, softness: 0.3, roughness: 0.25, detailMi: 3 },
  { id: 'erode', name: 'Erosion', group: 'Relief', kind: 'area', hint: 'Wears the land as you paint: cuts gullies into mountains, lowers peaks and makes coasts ragged.', sizeMi: 60, strength: 0.6, softness: 0.5, roughness: 0.5, detailMi: 6 },
  { id: 'forest', name: 'Forest', group: 'Ground cover', kind: 'area', hint: 'A canopy of treetops. Painted cover overrides the climate here.', sizeMi: 60, strength: 0.9, softness: 0.3, roughness: 0.6, detailMi: 6 },
  { id: 'jungle', name: 'Jungle', group: 'Ground cover', kind: 'area', hint: 'Dense tropical canopy.', sizeMi: 60, strength: 0.9, softness: 0.3, roughness: 0.6, detailMi: 6 },
  { id: 'grassland', name: 'Grassland', group: 'Ground cover', kind: 'area', hint: 'Open grass and steppe.', sizeMi: 80, strength: 0.8, softness: 0.6, roughness: 0.5, detailMi: 10 },
  { id: 'tundra', name: 'Tundra', group: 'Ground cover', kind: 'area', hint: 'Cold, treeless ground.', sizeMi: 80, strength: 0.8, softness: 0.6, roughness: 0.5, detailMi: 10 },
  { id: 'marsh', name: 'Marsh / swamp', group: 'Ground cover', kind: 'area', hint: 'Wetland with pools of open water.', sizeMi: 40, strength: 0.85, softness: 0.5, roughness: 0.6, detailMi: 3 },
  { id: 'dunes', name: 'Dunes', group: 'Ground cover', kind: 'area', hint: 'Sand seas with wind-shaped ridges.', sizeMi: 70, strength: 0.85, softness: 0.5, roughness: 0.5, detailMi: 4 },
  { id: 'badlands', name: 'Badlands', group: 'Ground cover', kind: 'area', hint: 'Bare, gullied rock and clay.', sizeMi: 50, strength: 0.85, softness: 0.45, roughness: 0.6, detailMi: 4 },
  { id: 'saltflats', name: 'Salt flats', group: 'Ground cover', kind: 'area', hint: 'White crusted plains.', sizeMi: 40, strength: 0.9, softness: 0.4, roughness: 0.5, detailMi: 3 },
  { id: 'glacier', name: 'Glacier / ice', group: 'Ground cover', kind: 'area', hint: 'Ice sheets and glaciers.', sizeMi: 60, strength: 0.9, softness: 0.4, roughness: 0.5, detailMi: 8 },
  { id: 'beach', name: 'Beach / shore', group: 'Ground cover', kind: 'area', hint: 'Paint along a coast for a sandy or rocky strip.', sizeMi: 6, strength: 0.9, softness: 0.4, roughness: 0.4, detailMi: 1 },
  { id: 'whirlpool', name: 'Whirlpool', group: 'Sea', kind: 'point', hint: 'Click at sea to place one. Choose whether it is dangerous to ships.', sizeMi: 8, strength: 0.8, softness: 0.3, roughness: 0, detailMi: 1 },
  { id: 'zone', name: 'Zone brush', group: 'Mountain zones', kind: 'area', hint: 'Repaint mountain zones by hand, or paint “Automatic” to undo that.', sizeMi: 25, strength: 1, softness: 0.1, roughness: 0.2, detailMi: 5 },
];

export const brushInfo = (id: BrushId): BrushInfo => BRUSHES.find((b) => b.id === id)!;

/** Brushes that only colour the ground (no relief). */
export const COVER_BRUSHES = ['forest', 'jungle', 'grassland', 'tundra', 'marsh', 'dunes', 'badlands', 'saltflats', 'glacier', 'beach'] as const;
export type CoverBrush = (typeof COVER_BRUSHES)[number];

export interface Stroke {
  id: number;
  brush: BrushId;
  /** Removes this brush's own layer instead of adding to it. */
  erase?: boolean;
  /** Path as x,y pairs in km from the north-west corner. One pair for a placed feature. */
  pts: number[];
  /** Brush width in km. */
  size: number;
  /** 0–1: opacity for Land & Sea, density for ground cover, boldness for relief. */
  strength: number;
  /** 0–1: how gradually the edge fades. */
  softness: number;
  /** 0–1: how ragged the outline is. */
  roughness: number;
  /** Size of individual peaks or bumps, in km. */
  detail: number;
  /** 0–1: how much the stroke varies along its length. */
  variation: number;
  /** Mountains only. */
  mode?: MountainMode;
  /** Mountains: 0–1, small ridges and valleys down both sides of a range. */
  sideRidges?: number;
  /** Width at the end as a share of the start (spurs taper). */
  taper?: number;
  /** Cliffs: which side of the line is high, as you look along the drawing direction (1 = right). */
  side?: 1 | -1;
  /** Zone brush: the zone painted (0 = automatic). */
  zone?: ZoneId;
  /** Whirlpools: dangerous to ships. */
  dangerous?: boolean;
}

export interface Surface {
  strokes: Stroke[];
  nextId: number;
}

export const emptySurface = (): Surface => ({ strokes: [], nextId: 1 });

/** Default settings for a new stroke with this brush. */
export function brushDefaults(id: BrushId): Omit<Stroke, 'id' | 'pts'> {
  const b = brushInfo(id);
  return {
    brush: id,
    size: milesToKm(b.sizeMi),
    strength: b.strength,
    softness: b.softness,
    roughness: b.roughness,
    detail: milesToKm(b.detailMi),
    variation: 0.3,
    ...(id === 'mountains' ? { mode: 'range' as MountainMode, sideRidges: 0.5 } : {}),
    ...(id === 'cliffs' ? { side: 1 as const } : {}),
    ...(id === 'zone' ? { zone: 2 as ZoneId } : {}),
    ...(id === 'whirlpool' ? { dangerous: true } : {}),
  };
}

/** How far a stroke can reach from its path, in km (for finding what it touches). */
export function strokeReach(s: Stroke): number {
  const r = s.size / 2;
  const extra = s.brush === 'crater' ? 1.35 : s.brush === 'whirlpool' ? 1.1 : (1 + s.variation * 0.45) * (1 + s.roughness * 0.5) + 0.05;
  return r * extra;
}

/** The area a stroke can affect: [minX, minY, maxX, maxY] in km. */
export function strokeBounds(s: Stroke): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 2) {
    x0 = Math.min(x0, s.pts[i]);
    x1 = Math.max(x1, s.pts[i]);
    y0 = Math.min(y0, s.pts[i + 1]);
    y1 = Math.max(y1, s.pts[i + 1]);
  }
  const r = strokeReach(s);
  return [x0 - r, y0 - r, x1 + r, y1 + r];
}

/** Round a path to 10 m so saved worlds stay small. */
export function roundPath(pts: number[]): number[] {
  return pts.map((v) => Math.round(v * 100) / 100);
}

/**
 * Where a spur should start: the closest point on the crest of an existing range (or spur)
 * near `x, y`, with that range's width there. Null if no range is close enough.
 */
export function snapSpur(surface: Surface, x: number, y: number): { x: number; y: number; size: number } | null {
  let best: { x: number; y: number; size: number; d: number } | null = null;
  for (const s of surface.strokes) {
    if (s.brush !== 'mountains' || s.erase || s.mode === 'massif') continue;
    const p = s.pts;
    const n = p.length / 2;
    let along = 0;
    const total = pathLength(p);
    for (let k = 0; k < Math.max(1, n - 1); k++) {
      const ax = p[2 * k];
      const ay = p[2 * k + 1];
      const bx = n > 1 ? p[2 * k + 2] : ax;
      const by = n > 1 ? p[2 * k + 3] : ay;
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const d = Math.hypot(x - cx, y - cy);
      const seg = Math.sqrt(l2);
      const frac = total > 0 ? (along + t * seg) / total : 0;
      const size = s.size * (1 + ((s.taper ?? 1) - 1) * frac);
      if (d <= size / 2 && (!best || d < best.d)) best = { x: cx, y: cy, size, d };
      along += seg;
    }
  }
  return best && { x: best.x, y: best.y, size: best.size };
}

export function pathLength(p: number[]): number {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
}

/** Strokes moved by (dx, dy) km, for when the map grows west or north. */
export function shiftSurface(surface: Surface, dx: number, dy: number): Surface {
  return {
    ...surface,
    strokes: surface.strokes.map((s) => ({ ...s, pts: roundPath(s.pts.map((v, i) => v + (i % 2 ? dy : dx))) })),
  };
}
