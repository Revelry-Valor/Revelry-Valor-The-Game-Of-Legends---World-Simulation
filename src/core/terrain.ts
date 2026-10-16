import { fbm, noise2, ridged, strokeSeed } from './noise';
import { COVER_BRUSHES, pathLength, strokeBounds, strokeReach, type CoverBrush, type Stroke, type Surface, type ZoneId } from './paint';

/**
 * Turns painted strokes into what is where (REDESIGN.md, section 6). The map picture and the
 * simulation both read it. Values are worked out for a rectangle of sample points; the
 * simulation asks about single points, the renderer about screen-sized rectangles.
 *
 * Nothing here is an elevation. `relief` exists only so the renderer can light and shade the
 * painting; the simulation reads the ground, the cover and the mountain zones.
 */

/** Sample points: the centre of the first is (x0, y0) km; they are `px` km apart. */
export interface Grid {
  x0: number;
  y0: number;
  px: number;
  w: number;
  h: number;
}

export interface Whirlpool {
  x: number;
  y: number;
  r: number;
  strength: number;
  dangerous: boolean;
}

export interface Fields {
  grid: Grid;
  /** 0 = deep sea, 1 = shallow sea, 2 = land (blended at edges). */
  ground: Float32Array;
  /** Ground cover by brush, 0–1 (only brushes that appear). */
  cover: Partial<Record<CoverBrush, Float32Array>>;
  /** How high the mountains are built up here (0, up to about 1.6). */
  mountain: Float32Array;
  /** Mountain zone (0 none, 1 foothills … 4 peaks). */
  zone: Uint8Array;
  /** Canyon and ravine strength, 0–1 (they block travel). */
  canyon: Float32Array;
  ravine: Float32Array;
  /** Cliff faces, 0–1 (for colouring rock). */
  cliff: Float32Array;
  /** Plateau tops, 0–1. */
  plateau: Float32Array;
  /** For lighting the painting only. */
  relief: Float32Array;
}

export type GroundClass = 'deep' | 'shallow' | 'land';

export const groundClass = (v: number): GroundClass => (v >= 1.5 ? 'land' : v >= 0.5 ? 'shallow' : 'deep');

/** How high built-up mountains can get (in relief units): more paint levels off toward this. */
const MOUNTAIN_CAP = 1.6;
/** Relief from everything but mountains, scaled to match the stronger lighting. */
const OTHER_RELIEF = 0.25;

const GROUND_TARGET: Record<string, number> = { deep: 0, shallow: 1, land: 2 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Scratch buffers reused between strokes (one grid at a time per thread).
let scratchD = new Float32Array(0);
let scratchT = new Float32Array(0);
let scratchS = new Float32Array(0);

interface Options {
  seed: number;
  /** Width of a wrapping map (km), or 0 if the map does not wrap. */
  wrapKm: number;
}

/**
 * For each sample point within reach of the stroke: distance to its path, distance along the
 * path, and signed distance (positive to the right of the drawing direction).
 */
function rasterStroke(s: Stroke, g: Grid, o: Options, visit: (i: number, x: number, y: number, d: number, t: number, sd: number) => void): void {
  const n = g.w * g.h;
  if (scratchD.length < n) {
    scratchD = new Float32Array(n);
    scratchT = new Float32Array(n);
    scratchS = new Float32Array(n);
  }
  const reach = strokeReach(s);
  const p = s.pts;
  const segs = Math.max(1, p.length / 2 - 1);
  const [sx0, sy0, sx1, sy1] = strokeBounds(s);
  const offsets = (o.wrapKm ? [0, -o.wrapKm, o.wrapKm] : [0]).filter(
    (off) => !(sx1 + off < g.x0 || sx0 + off > g.x0 + (g.w - 1) * g.px || sy1 < g.y0 || sy0 > g.y0 + (g.h - 1) * g.px),
  );
  if (!offsets.length) return;
  // The box of sample points this stroke can touch (over all its wrapped copies).
  const bi0 = Math.max(0, Math.floor((Math.min(...offsets.map((off) => sx0 + off)) - g.x0) / g.px));
  const bi1 = Math.min(g.w - 1, Math.ceil((Math.max(...offsets.map((off) => sx1 + off)) - g.x0) / g.px));
  const bj0 = Math.max(0, Math.floor((sy0 - g.y0) / g.px));
  const bj1 = Math.min(g.h - 1, Math.ceil((sy1 - g.y0) / g.px));
  for (let j = bj0; j <= bj1; j++) scratchD.fill(Infinity, j * g.w + bi0, j * g.w + bi1 + 1);
  for (const off of offsets) {
    let along = 0;
    for (let k = 0; k < segs; k++) {
      const ax = p[2 * k] + off;
      const ay = p[2 * k + 1];
      const bx = p.length > 2 ? p[2 * k + 2] + off : ax;
      const by = p.length > 2 ? p[2 * k + 3] : ay;
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const len = Math.sqrt(l2);
      const i0 = Math.max(bi0, Math.floor((Math.min(ax, bx) - reach - g.x0) / g.px));
      const i1 = Math.min(bi1, Math.ceil((Math.max(ax, bx) + reach - g.x0) / g.px));
      const j0 = Math.max(bj0, Math.floor((Math.min(ay, by) - reach - g.y0) / g.px));
      const j1 = Math.min(bj1, Math.ceil((Math.max(ay, by) + reach - g.y0) / g.px));
      for (let j = j0; j <= j1; j++) {
        const y = g.y0 + j * g.px;
        for (let i = i0; i <= i1; i++) {
          const x = g.x0 + i * g.px;
          const tr = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          const t = tr < 0 ? 0 : tr > 1 ? 1 : tr;
          const ex = x - (ax + t * dx);
          const ey = y - (ay + t * dy);
          const d = Math.sqrt(ex * ex + ey * ey);
          const idx = j * g.w + i;
          if (d < scratchD[idx]) {
            scratchD[idx] = d;
            // Past either end of the path, distance along keeps counting (so patterns run on).
            scratchT[idx] = along + ((k === 0 && tr < 0) || (k === segs - 1 && tr > 1) ? tr : t) * len;
            // Right of the direction of travel is positive (y grows southward).
            scratchS[idx] = l2 > 0 ? (dx * ey - dy * ex >= 0 ? d : -d) : d;
          }
        }
      }
      along += len;
    }
  }
  for (let j = bj0; j <= bj1; j++) {
    const y = g.y0 + j * g.px;
    for (let i = bi0; i <= bi1; i++) {
      const idx = j * g.w + i;
      const d = scratchD[idx];
      if (d < reach) visit(idx, g.x0 + i * g.px, y, d, scratchT[idx], scratchS[idx]);
    }
  }
}

/** Brush coverage 0–1 at a point, from its distance to the path relative to the radius. */
function shape(s: Stroke, x: number, y: number, d: number, r: number, px: number, seed: number): number {
  let e = d / r;
  const soft = Math.max(s.softness, Math.min(1, (1.2 * px) / r));
  // The ragged outline moves the edge by at most this much; skip the noise away from it.
  const wobble = s.roughness * 0.45;
  if (e - wobble >= 1) return 0;
  if (wobble > 0 && e + wobble > 1 - soft) e += wobble * fbm(x, y, Math.max(r * 0.9, px), px, seed);
  if (e >= 1) return 0;
  let c = e <= 1 - soft ? 1 : 1 - smooth(1 - soft, 1, e);
  if (s.variation > 0) c *= 1 - s.variation * 0.5 * (0.5 + 0.5 * fbm(x, y, r * 2.5, Math.max(px, r * 0.4), seed + 3, 3));
  return c;
}

/** Radius at distance `t` along the path: spurs taper toward their end, and width wanders a little. */
function radiusAt(s: Stroke, t: number, total: number, seed: number): number {
  let r = s.size / 2;
  if (s.taper !== undefined && s.taper !== 1 && total > 0) r *= 1 + (s.taper - 1) * Math.max(0, Math.min(1, t / total));
  if (s.variation > 0 && total > 0) r *= 1 + s.variation * 0.45 * noise2(t / (s.size * 1.3), 0.5, seed + 9);
  return r;
}

/** Work out the painted surface at every sample point of a grid. */
export function evaluate(surface: Surface, g: Grid, o: Options): Fields {
  const n = g.w * g.h;
  const f: Fields = {
    grid: g,
    ground: new Float32Array(n),
    cover: {},
    mountain: new Float32Array(n),
    zone: new Uint8Array(n),
    canyon: new Float32Array(n),
    ravine: new Float32Array(n),
    cliff: new Float32Array(n),
    plateau: new Float32Array(n),
    relief: new Float32Array(n),
  };
  const mass = new Float32Array(n);
  const ribSum = new Float32Array(n);
  const ribWeight = new Float32Array(n);
  const erosion = new Float32Array(n);
  const hills = new Float32Array(n);
  const cliffRelief = new Float32Array(n);
  const crater = new Float32Array(n);
  let zoneOverride: Int8Array | null = null;
  const px = g.px;
  const gx1 = g.x0 + (g.w - 1) * px;
  const gy1 = g.y0 + (g.h - 1) * px;

  for (const s of surface.strokes) {
    const [bx0, by0, bx1, by1] = strokeBounds(s);
    const hit = (off: number) => !(bx1 + off < g.x0 || bx0 + off > gx1 || by1 < g.y0 || by0 > gy1);
    if (!hit(0) && !(o.wrapKm && (hit(o.wrapKm) || hit(-o.wrapKm)))) continue;
    if (s.brush === 'whirlpool') continue;
    const seed = strokeSeed(o.seed, s.id);
    const total = pathLength(s.pts);
    const er = !!s.erase;
    const str = s.strength;

    if (s.brush === 'land' || s.brush === 'shallow' || s.brush === 'deep') {
      const target = er ? 0 : GROUND_TARGET[s.brush];
      rasterStroke(s, g, o, (i, x, y, d, t) => {
        const c = shape(s, x, y, d, radiusAt(s, t, total, seed), px, seed) * str;
        if (c > 0) f.ground[i] += (target - f.ground[i]) * c;
      });
      continue;
    }
    if ((COVER_BRUSHES as readonly string[]).includes(s.brush)) {
      const key = s.brush as CoverBrush;
      const buf = (f.cover[key] ??= new Float32Array(n));
      rasterStroke(s, g, o, (i, x, y, d, t) => {
        const c = shape(s, x, y, d, radiusAt(s, t, total, seed), px, seed);
        if (c <= 0) return;
        buf[i] = er ? buf[i] * (1 - c) : Math.max(buf[i], c * str);
      });
      continue;
    }
    switch (s.brush) {
      case 'mountains': {
        // Mountains build up: each stroke adds to the mass already there, like an airbrush.
        const massif = s.mode === 'massif';
        const sr = s.sideRidges ?? 0;
        const spacing = Math.max(s.detail * 1.8, px * 4);
        rasterStroke(s, g, o, (i, x, y, d, t, sd) => {
          const r = radiusAt(s, t, total, seed);
          const c = shape(s, x, y, d, r, px, seed);
          if (c <= 0) return;
          if (er) {
            mass[i] *= 1 - c;
            ribSum[i] *= 1 - c;
            ribWeight[i] *= 1 - c;
            return;
          }
          const e = Math.min(1, d / r);
          // Side ridges and valleys run square to this stroke's crest, down its flanks.
          let lu = t / spacing;
          const lv = sd / (spacing * 1.6);
          lu += 0.5 * noise2(lu * 0.35, lv * 0.6, seed + 33);
          const rib = massif ? ridged(x, y, spacing * 0.9, Math.max(px, spacing / 8), seed + 23, 4, 0.5) : ridged(lu, lv, 1, Math.max(px / spacing, 0.08), seed + 31, 4, 0.5);
          // A crest down the middle of the brush: steep near the top, easing out into foothills,
          // with peaks and saddles along it. The ridges reach out and the valleys cut in, so the
          // range's edge is lobed, not smooth.
          const crest = massif ? 1 : 0.78 + 0.35 * noise2(t / (spacing * 2.2), 0.37, seed + 41);
          const body = massif ? (1 - e * e * 0.7) : (1 - e) ** 1.5;
          const lobes = Math.max(0, 1 + (massif ? 0.8 : sr * 1.4) * (rib - 0.45) * smooth(0.05, 0.6, e));
          // Ranges fall away at their two ends instead of stopping short.
          const ends = massif ? 1 : smooth(-r, r * 0.6, t) * smooth(-r, r * 0.6, total - t);
          const add = str * body * crest * lobes * ends * c;
          mass[i] += add;
          ribSum[i] += add * (rib - 0.45) * (massif ? 0.8 : sr);
          ribWeight[i] += add;
        });
        break;
      }
      case 'erode':
        rasterStroke(s, g, o, (i, x, y, d, t) => {
          const c = shape(s, x, y, d, radiusAt(s, t, total, seed), px, seed);
          if (c <= 0) return;
          erosion[i] = er ? erosion[i] * (1 - c) : Math.min(1, erosion[i] + c * str * (1 - erosion[i]));
        });
        break;
      case 'hills':
        rasterStroke(s, g, o, (i, x, y, d, t) => {
          const c = shape(s, x, y, d, radiusAt(s, t, total, seed), px, seed);
          if (c <= 0) return;
          if (er) return void (hills[i] *= 1 - c);
          const h = c * str * 0.4 * (0.5 + 0.5 * fbm(x, y, s.detail, px, seed + 41, 6));
          // Hills build up too, levelling off as they grow.
          hills[i] += h * Math.max(0, 1 - hills[i] / 0.6);
        });
        break;
      case 'plateau':
        rasterStroke(s, g, o, (i, x, y, d, t) => {
          const c = shape(s, x, y, d, radiusAt(s, t, total, seed), px, seed);
          if (c <= 0) return;
          f.plateau[i] = er ? f.plateau[i] * (1 - c) : Math.max(f.plateau[i], c * (0.4 + 0.6 * str));
        });
        break;
      case 'cliffs': {
        const side = s.side ?? 1;
        rasterStroke(s, g, o, (i, x, y, d, t, sd) => {
          const r = s.size / 2;
          // Fade the cliff in and out at its two ends.
          const ends = Math.min(smooth(0, r * 0.6, t), smooth(0, r * 0.6, total - t), 1);
          const edge = sd * side + (s.roughness > 0 ? s.roughness * r * 0.35 * fbm(x, y, r * 2, px, seed) : 0);
          const high = smooth(-px * 0.8, px * 0.8, edge) * Math.max(0, 1 - Math.max(0, edge) / r) ** 0.6;
          const face = 1 - smooth(px * 0.5, px * 2.5 + r * 0.06, Math.abs(edge));
          if (er) {
            cliffRelief[i] *= 1 - ends * (d < r ? 1 : 0);
            f.cliff[i] *= 1 - ends * (d < r ? 1 : 0);
            return;
          }
          const h = high * ends * str * 0.45;
          if (h > cliffRelief[i]) cliffRelief[i] = h;
          if (face * ends > f.cliff[i]) f.cliff[i] = face * ends;
        });
        break;
      }
      case 'canyon':
      case 'ravine': {
        const buf = s.brush === 'canyon' ? f.canyon : f.ravine;
        rasterStroke(s, g, o, (i, x, y, d, t) => {
          const c = shape(s, x, y, d, radiusAt(s, t, total, seed), px, seed);
          if (c <= 0) return;
          buf[i] = er ? buf[i] * (1 - c) : Math.max(buf[i], c * str);
        });
        break;
      }
      case 'crater':
        rasterStroke(s, g, o, (i, x, y, d) => {
          const r = s.size / 2;
          const e = d / r + s.roughness * 0.25 * fbm(x, y, r * 0.7, px, seed);
          if (er) return void (crater[i] *= smooth(0.9, 1.3, e));
          const rim = Math.exp(-(((e - 1) / 0.16) ** 2)) * 0.32;
          const bowl = e < 1 ? -0.42 * (1 - e * e) : 0;
          crater[i] += (rim + bowl) * str;
        });
        break;
      case 'zone':
        zoneOverride ??= new Int8Array(n).fill(-1);
        rasterStroke(s, g, o, (i, x, y, d, t) => {
          const c = shape(s, x, y, d, radiusAt(s, t, total, seed), px, seed);
          if (c > 0.5) zoneOverride![i] = er || !s.zone ? -1 : s.zone;
        });
        break;
    }
  }

  // Mountains: the built-up mass levels off as it grows, and erosion wears it down.
  for (let i = 0; i < n; i++) {
    let m = mass[i];
    if (m <= 0) continue;
    m = MOUNTAIN_CAP * (1 - Math.exp(-m / MOUNTAIN_CAP));
    f.mountain[i] = m * (1 - 0.3 * erosion[i]);
  }

  // Mountain zones: automatic from how high the mountains are built, then anything painted by hand.
  for (let i = 0; i < n; i++) {
    const b = f.mountain[i];
    let z: ZoneId = b < 0.03 ? 0 : b < 0.15 ? 1 : b < 0.35 ? 2 : b < 0.6 ? 3 : 4;
    if (zoneOverride && zoneOverride[i] >= 0) z = zoneOverride[i] as ZoneId;
    f.zone[i] = z;
  }

  // Erosion also wears coasts ragged.
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const idx = j * g.w + i;
      const ev = erosion[idx];
      const v = f.ground[idx];
      if (ev <= 0 || v < 0.6 || v > 2.4) continue;
      const x = g.x0 + i * px;
      const y = g.y0 + j * px;
      f.ground[idx] = v + ev * 0.7 * fbm(x, y, 25, px, o.seed + 81, 7);
    }
  }

  // Relief, for lighting only. Mountains carry most of it; the rest is quieter detail.
  const dunes = f.cover.dunes;
  for (let j = 0; j < g.h; j++) {
    const y = g.y0 + j * px;
    for (let i = 0; i < g.w; i++) {
      const idx = j * g.w + i;
      const v = f.ground[idx];
      const land = smooth(1.35, 1.65, v);
      if (land <= 0) continue;
      const x = g.x0 + i * px;
      let r = 0.03 * fbm(x, y, 60, px, o.seed + 1, 6);
      const pl = f.plateau[idx];
      if (pl > 0) r += smooth(0.25, 0.55, pl) * 0.42 * (1 + 0.08 * fbm(x, y, 20, px, o.seed + 2));
      r += hills[idx] + cliffRelief[idx] + crater[idx];
      if (f.canyon[idx] > 0) r -= smooth(0, 0.6, f.canyon[idx]) * 0.45;
      if (f.ravine[idx] > 0) r -= smooth(0, 0.7, f.ravine[idx]) * 0.2;
      if (dunes && dunes[idx] > 0) {
        const w = 2.2;
        const ph = (x * 0.8 + y * 0.6) / w + 2.5 * fbm(x, y, 18, px, o.seed + 5);
        const fr = ph - Math.floor(ph);
        r += dunes[idx] * 0.05 * (fr < 0.75 ? fr / 0.75 : (1 - fr) / 0.25);
      }
      const forest = (f.cover.forest?.[idx] ?? 0) + (f.cover.jungle?.[idx] ?? 0);
      if (forest > 0) r += Math.min(1, forest) * 0.012 * fbm(x, y, Math.max(px * 2.5, 0.08), px * 0.8, o.seed + 6, 3);
      const ev = erosion[idx];
      if (ev > 0) r += ev * 0.06 * (ridged(x, y, 6, px, o.seed + 83, 5, 0.5) - 0.5);
      r *= OTHER_RELIEF;
      const m = f.mountain[idx];
      if (m > 0) {
        // Shaded-relief look: a clear body and crest, side ridges, and only a little fine detail.
        const ribs = ribWeight[idx] > 0 ? ribSum[idx] / ribWeight[idx] : 0;
        const fine = ridged(x, y, 8, px, o.seed + 85, 4, 0.45) - 0.5;
        r += m + m * ribs * 0.7 + m * fine * 0.06;
        // Erosion cuts branching gullies into the mountainside.
        if (ev > 0) r += ev * m * 0.35 * (ridged(x, y, 14, px, o.seed + 87, 5, 0.55) - 0.55);
      }
      f.relief[idx] = r * land;
    }
  }
  return f;
}

/** All whirlpools, after erasing (they are few, so they are kept as a list). */
export function whirlpools(surface: Surface): Whirlpool[] {
  let list: (Whirlpool & { id: number })[] = [];
  for (const s of surface.strokes) {
    if (s.brush !== 'whirlpool') continue;
    if (s.erase) {
      const r = s.size / 2;
      list = list.filter((w) => {
        for (let k = 0; k < s.pts.length; k += 2) if (Math.hypot(w.x - s.pts[k], w.y - s.pts[k + 1]) < r + w.r * 0.5) return false;
        return true;
      });
    } else {
      list.push({ id: s.id, x: s.pts[0], y: s.pts[1], r: s.size / 2, strength: s.strength, dangerous: s.dangerous ?? true });
    }
  }
  return list;
}

/** What the simulation sees at one place. */
export interface PlaceInfo {
  ground: GroundClass;
  cover: Partial<Record<CoverBrush, number>>;
  mountain: number;
  zone: ZoneId;
  plateau: boolean;
  /** Canyons and ravines block travel. */
  blocksTravel: boolean;
  whirlpool: Whirlpool | null;
}

/** What is at a place (x, y in km from the north-west corner). */
export function surfaceAt(surface: Surface, x: number, y: number, o: Options): PlaceInfo {
  const f = evaluate(surface, { x0: x, y0: y, px: 0.25, w: 1, h: 1 }, o);
  const cover: Partial<Record<CoverBrush, number>> = {};
  for (const [k, v] of Object.entries(f.cover)) if (v[0] > 0.05) cover[k as CoverBrush] = Math.round(v[0] * 100) / 100;
  const w = whirlpools(surface).find((p) => Math.hypot(p.x - x, p.y - y) < p.r) ?? null;
  return {
    ground: groundClass(f.ground[0]),
    cover,
    mountain: f.mountain[0],
    zone: f.zone[0] as ZoneId,
    plateau: f.plateau[0] > 0.4,
    blocksTravel: f.canyon[0] > 0.5 || f.ravine[0] > 0.5,
    whirlpool: w,
  };
}
