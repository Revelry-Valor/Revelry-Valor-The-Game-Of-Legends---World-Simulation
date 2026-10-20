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
  | 'ramp'
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
  | 'savanna'
  | 'scrub'
  | 'taiga'
  | 'steppe'
  | 'rockdesert'
  // Water
  | 'river'
  | 'lake'
  | 'waterfall'
  // Volcanic
  | 'volcano'
  | 'lava'
  // Sea features
  | 'whirlpool'
  | 'reef'
  // Climate
  | 'crystal'
  | 'shadowpen'
  | 'gap'
  | 'current'
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
  group: 'Land & Sea' | 'Relief' | 'Water' | 'Volcanic' | 'Ground cover' | 'Sea' | 'Climate' | 'Mountain zones';
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
  { id: 'mountains', name: 'Mountains', group: 'Relief', kind: 'area', hint: 'A spray brush: paint builds up into mountains, and the crest forms where the paint is thickest. Paint beside a mountain to widen it, go over it again to raise it, and use a small, weak brush along the edges to add shoulders and spurs.', sizeMi: 70, strength: 0.6, softness: 0.5, roughness: 0.45, detailMi: 14 },
  { id: 'hills', name: 'Hills', group: 'Relief', kind: 'area', hint: 'A spray brush for soft rolling hills; builds up like mountains, but lower.', sizeMi: 60, strength: 0.6, softness: 0.6, roughness: 0.5, detailMi: 8 },
  { id: 'plateau', name: 'Plateau', group: 'Relief', kind: 'area', hint: 'Paint the shape of the top: a flat raised top ringed by layered cliffs. Use Ramp to make a way up.', sizeMi: 80, strength: 0.7, softness: 0.1, roughness: 0.55, detailMi: 6 },
  { id: 'cliffs', name: 'Cliffs', group: 'Relief', kind: 'line', hint: 'Draw along the top edge. The cliff face shows on the low side; the high side is the land you drew it on.', sizeMi: 5, strength: 0.7, softness: 0.3, roughness: 0.35, detailMi: 2 },
  { id: 'ramp', name: 'Ramp', group: 'Relief', kind: 'area', hint: 'Draw from the ground floor up onto a plateau or cliff top, or down into a canyon. It joins the two, and the peoples of the world will use it to get there.', sizeMi: 8, strength: 1, softness: 0.4, roughness: 0.2, detailMi: 2 },
  { id: 'canyon', name: 'Canyon / gorge', group: 'Relief', kind: 'line', hint: 'Draw the canyon: terraced, layered walls and a flat floor. Blocks travel except where bridged.', sizeMi: 14, strength: 0.8, softness: 0.25, roughness: 0.35, detailMi: 3 },
  { id: 'ravine', name: 'Ravine', group: 'Relief', kind: 'line', hint: 'A narrow, deep crack in the earth. Blocks travel.', sizeMi: 2, strength: 0.8, softness: 0.2, roughness: 0.5, detailMi: 1 },
  { id: 'crater', name: 'Crater', group: 'Relief', kind: 'point', hint: 'Click to place an impact crater. Bigger means a bigger meteor: big craters get flat floors, terraced walls, a central peak and rays. A new crater blasts away what was there, older craters included.', sizeMi: 12, strength: 0.8, softness: 0.3, roughness: 0.25, detailMi: 3 },
  { id: 'erode', name: 'Erosion', group: 'Relief', kind: 'area', hint: 'A spray brush that wears the land: cuts gullies into mountains, lowers peaks and makes coasts ragged.', sizeMi: 50, strength: 0.5, softness: 0.5, roughness: 0.5, detailMi: 6 },
  { id: 'river', name: 'River', group: 'Water', kind: 'line', hint: 'Points: click the source, then points along the way; press Enter or click on water to finish. The river finds its own course through the land. Draw: drag the course yourself. A river that ends in another makes it bigger downstream.', sizeMi: 12, strength: 0.3, softness: 0.3, roughness: 0, detailMi: 1 },
  { id: 'lake', name: 'Lake', group: 'Water', kind: 'area', hint: 'Fresh water. Paint the shape of the lake.', sizeMi: 30, strength: 1, softness: 0.3, roughness: 0.5, detailMi: 3 },
  { id: 'waterfall', name: 'Waterfall', group: 'Water', kind: 'point', hint: 'Rivers make waterfalls by themselves where they run over a cliff or plateau rim. Click to place one by hand: a pool forms below it and the land around turns green and fertile.', sizeMi: 1, strength: 0.8, softness: 0.3, roughness: 0, detailMi: 1 },
  { id: 'volcano', name: 'Volcano', group: 'Volcanic', kind: 'point', hint: 'Click to place a volcano. The size is its width at the base. Active volcanoes glow and feed lava flows; they bring obsidian, sulfur, pumice, basalt, rich ash soil, hot springs, gems and rare metals.', sizeMi: 25, strength: 0.8, softness: 0.3, roughness: 0.4, detailMi: 3 },
  { id: 'lava', name: 'Lava flow', group: 'Volcanic', kind: 'line', hint: 'Drawn like a river: Points or Draw, from a volcano downhill. Cooled flows are black rock; flows from an active volcano glow.', sizeMi: 4, strength: 0.8, softness: 0.3, roughness: 0.6, detailMi: 1 },
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
  { id: 'savanna', name: 'Savanna', group: 'Ground cover', kind: 'area', hint: 'Tropical grass with scattered trees.', sizeMi: 80, strength: 0.85, softness: 0.6, roughness: 0.5, detailMi: 8 },
  { id: 'scrub', name: 'Dry scrub', group: 'Ground cover', kind: 'area', hint: 'Low shrubs and open woodland of dry-summer coasts.', sizeMi: 60, strength: 0.85, softness: 0.6, roughness: 0.5, detailMi: 6 },
  { id: 'taiga', name: 'Conifer forest / taiga', group: 'Ground cover', kind: 'area', hint: 'Dark, dense needle-leaf forest of cold lands.', sizeMi: 70, strength: 0.9, softness: 0.4, roughness: 0.6, detailMi: 6 },
  { id: 'steppe', name: 'Steppe grass', group: 'Ground cover', kind: 'area', hint: 'Short, dry grass around deserts and in dry interiors.', sizeMi: 90, strength: 0.8, softness: 0.6, roughness: 0.5, detailMi: 10 },
  { id: 'rockdesert', name: 'Rocky desert', group: 'Ground cover', kind: 'area', hint: 'Bare stony desert and gravel plains.', sizeMi: 80, strength: 0.85, softness: 0.5, roughness: 0.5, detailMi: 6 },
  { id: 'whirlpool', name: 'Whirlpool', group: 'Sea', kind: 'point', hint: 'Click at sea to place one. Choose whether it is dangerous to ships.', sizeMi: 8, strength: 0.8, softness: 0.3, roughness: 0, detailMi: 1 },
  { id: 'reef', name: 'Reef', group: 'Sea', kind: 'area', hint: 'Add coral reefs by hand on shallow sea, or erase the ones the climate made.', sizeMi: 20, strength: 1, softness: 0.4, roughness: 0.6, detailMi: 2 },
  { id: 'crystal', name: 'Climate crystal', group: 'Climate', kind: 'point', hint: 'Click to place a crystal that changes the climate around it: heat (sun crystal), cold, or rain. Its width is how far it reaches; nearby crystals add together.', sizeMi: 150, strength: 0.6, softness: 0.5, roughness: 0, detailMi: 1 },
  { id: 'shadowpen', name: 'Rain Shadow Pen', group: 'Climate', kind: 'line', hint: 'Mountains, plateaus and hills already cast rain shadows. Draw along a crest to add high ground the climate should see, or to change how high it is. Nothing is drawn on the map.', sizeMi: 40, strength: 1, softness: 0.5, roughness: 0, detailMi: 1 },
  { id: 'current', name: 'Current (sketch)', group: 'Climate', kind: 'line', hint: 'Teaching sketch: draw a current the way it should flow (tap points, then tap the last point again or press Enter). It doesn’t change the climate. Use Adjust to move points, add points, change its type, reverse it or delete it.', sizeMi: 60, strength: 1, softness: 0, roughness: 0, detailMi: 1 },
  { id: 'gap', name: 'Gap (pass)', group: 'Climate', kind: 'area', hint: 'Cut a pass through high ground so moist air slips through.', sizeMi: 30, strength: 1, softness: 0.4, roughness: 0, detailMi: 1 },
  { id: 'zone', name: 'Zone brush', group: 'Mountain zones', kind: 'area', hint: 'Repaint mountain zones by hand, or paint “Automatic” to undo that.', sizeMi: 25, strength: 1, softness: 0.1, roughness: 0.2, detailMi: 5 },
];

export const brushInfo = (id: BrushId): BrushInfo => BRUSHES.find((b) => b.id === id)!;

/** Brushes that only colour the ground (no relief). */
export const COVER_BRUSHES = ['forest', 'jungle', 'grassland', 'tundra', 'marsh', 'dunes', 'badlands', 'saltflats', 'glacier', 'beach', 'savanna', 'scrub', 'taiga', 'steppe', 'rockdesert'] as const;
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
  /** No longer used (mountains are a spray brush); kept so older saves still load. */
  mode?: MountainMode;
  /** Mountains: 0–1, how deeply ridges and gullies are cut down the slopes. */
  sideRidges?: number;
  /** Plateaus, cliffs and canyons: 0–1, how worn and gullied the rock faces are. */
  erosion?: number;
  /** Width at the end as a share of the start (spurs taper). */
  taper?: number;
  /** Cliffs: which side of the line is high, as you look along the drawing direction (1 = right). */
  side?: 1 | -1;
  /** Zone brush: the zone painted (0 = automatic). */
  zone?: ZoneId;
  /** Whirlpools: dangerous to ships. */
  dangerous?: boolean;
  /** Rivers: width at the source (km); it widens downstream and where rivers join. */
  width?: number;
  /** Rivers in point mode: how far (km) the river may wander from its course; 0 = not at all. */
  wander?: number;
  /** Rivers and lava flows: drawn by hand, or routed through clicked points. */
  route?: 'draw' | 'points';
  /** Rivers and lava flows in point mode: the points that were clicked (x, y pairs). */
  ctrl?: number[];
  /** Rivers: the river this one flows into, and how far along that river it joins (km). */
  joins?: { id: number; at: number };
  /** Rivers: where along the course (km) it falls over a cliff or rim, and where it lands. */
  falls?: { at: number; to: number }[];
  /** Volcanoes and lava flows: still active (glowing). */
  active?: boolean;
  /** Climate crystals: what they do. */
  crystal?: 'heat' | 'cold' | 'rain';
  /** Rain Shadow Pen: the height of the high ground (km) for the climate. */
  penHeight?: number;
  /** Drawn current (teaching sketch): what kind of water it carries. Its course is `ctrl`. */
  current?: 'warm' | 'cold' | 'neutral';
}

/** A drawn current's smooth course through its points (km), for drawing and reports. */
export function sketchCourse(ctrl: number[], wrapKm = 0): number[] {
  const n = ctrl.length / 2;
  if (n < 2) return ctrl.slice();
  // Unwrap across the east–west seam so the curve takes the short way.
  const p = ctrl.slice();
  if (wrapKm) for (let i = 1; i < n; i++) p[i * 2] += Math.round((p[(i - 1) * 2] - p[i * 2]) / wrapKm) * wrapKm;
  const at = (i: number) => [p[Math.max(0, Math.min(n - 1, i)) * 2], p[Math.max(0, Math.min(n - 1, i)) * 2 + 1]];
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    const steps = Math.max(4, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 60));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull–Rom: passes through every point.
      out.push(
        0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
        0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
      );
    }
  }
  out.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  return out;
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
    ...(id === 'mountains' ? { sideRidges: 0.6 } : {}),
    ...(id === 'plateau' || id === 'cliffs' || id === 'canyon' ? { erosion: 0.4 } : {}),
    ...(id === 'cliffs' ? { side: 1 as const } : {}),
    ...(id === 'zone' ? { zone: 2 as ZoneId } : {}),
    ...(id === 'whirlpool' ? { dangerous: true } : {}),
    ...(id === 'river' || id === 'lava' ? { route: 'points' as const, variation: 0 } : {}),
    ...(id === 'river' ? { width: milesToKm(0.1), wander: milesToKm(3) } : {}),
    ...(id === 'volcano' || id === 'lava' ? { active: true } : {}),
    ...(id === 'crystal' ? { crystal: 'heat' as const } : {}),
    ...(id === 'shadowpen' ? { penHeight: 2.5 } : {}),
    ...(id === 'current' ? { current: 'warm' as const, route: 'points' as const } : {}),
  };
}

/** How far a river's water, banks and waterfall pools can reach from its course, km. */
export const RIVER_REACH = 25;

/** How far a stroke can reach from its path, in km (for finding what it touches). */
export function strokeReach(s: Stroke): number {
  const r = s.size / 2;
  // Craters throw ejecta and rays well past their rim; cliffs cast shadows below their face.
  // Rivers reach as far as their widest stretch and the green banks and waterfall pools beside it.
  if (s.brush === 'river') return RIVER_REACH;
  const extra = s.brush === 'volcano' ? 1.6 : s.brush === 'waterfall' ? 40 : s.brush === 'crater' ? 4 : s.brush === 'whirlpool' ? 1.1 : s.brush === 'cliffs' ? 3 : s.brush === 'canyon' ? 2.3 : s.brush === 'plateau' ? 1.55 : (1 + s.variation * 0.35) * (1 + s.roughness * 0.5) + 0.05;
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
