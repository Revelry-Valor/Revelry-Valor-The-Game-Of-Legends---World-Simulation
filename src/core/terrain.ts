import { fbm, noise2, random2, ridged, strokeSeed } from './noise';
import { COVER_BRUSHES, strokeBounds, strokeReach, type CoverBrush, type Stroke, type Surface, type ZoneId } from './paint';
import { flowAt, pointAt, riverNetwork, widthForFlow, type RiverInfo } from './water';

/**
 * Turns painted strokes into what is where (REDESIGN.md, section 6). The map picture and the
 * simulation both read it. Values are worked out for a rectangle of sample points; the
 * simulation asks about single points, the renderer about screen-sized rectangles.
 *
 * Brushes work like a paint program: a stroke is a row of stamps ("dabs") laid at fixed spacing
 * along the path, so what is painted never changes as the stroke goes on. Land, sea and ground
 * cover are opaque paint; mountains, hills and erosion are spray paint that builds up.
 *
 * Nothing here is an elevation. `relief` exists only so the renderer can light and shade the
 * painting; the simulation reads the ground, the cover, the mountain zones and the obstacles.
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
  /** Bare rock faces (cliffs, plateau rims, canyon walls), 0–1. */
  face: Float32Array;
  /** Height up a rock face, in strata (whole numbers are layer boundaries), for colouring. */
  strata: Float32Array;
  /** Cliffs are drawn, not lit by relief: their face brightness (1 = neutral). */
  faceShade: Float32Array;
  /** Loose rock at the foot of a cliff, 0–1. */
  scree: Float32Array;
  /** Shadow cast by a cliff on the ground below it, 0–1. */
  shadow: Float32Array;
  /** Plateau tops, 0–1. */
  plateau: Float32Array;
  /** Ramps joining the ground floor to a raised or sunken feature, 0–1. */
  ramp: Float32Array;
  /** The worn track down the middle of a ramp, 0–1. */
  track: Float32Array;
  /** Fresh crater ejecta and rays, 0–1 (lighter ground). */
  ejecta: Float32Array;
  /** How much hill paint is built up here. */
  hill: Float32Array;
  /** Fresh water: rivers and lakes, 0–1. */
  water: Float32Array;
  /** 1 = river, 2 = lake (where there is water). */
  waterKind: Uint8Array;
  /** How far into a lake, 0 at the shore to 1 in the middle (for its colour). */
  waterDepth: Float32Array;
  /** River width here (km), where there is a river. */
  riverWidth: Float32Array;
  /** White water at waterfalls, 0–1. */
  foam: Float32Array;
  /** Wetter, greener, more fertile ground: river banks, and around waterfalls (oases), 0–1. */
  wet: Float32Array;
  /** Volcanic cone, 0–1. */
  volcano: Float32Array;
  /** Lava flows, 0–1, and the glow of active ones, 0–1. */
  lava: Float32Array;
  lavaGlow: Float32Array;
  /** For lighting the painting only. */
  relief: Float32Array;
}

export type GroundClass = 'deep' | 'shallow' | 'land';

export const groundClass = (v: number): GroundClass => (v >= 1.5 ? 'land' : v >= 0.5 ? 'shallow' : 'deep');

/** How high built-up mountains can get (in relief units): more paint levels off toward this. */
const MOUNTAIN_CAP = 2;

const GROUND_TARGET: Record<string, number> = { deep: 0, shallow: 1, land: 2 };
const TAU = Math.PI * 2;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Options {
  seed: number;
  /** Width of a wrapping map (km), or 0 if the map does not wrap. */
  wrapKm: number;
  /** Skip the fine detail only lighting needs (for finding river courses). */
  noRelief?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Dabs: the stamps a stroke is made of.

const DAB_SPACING = 0.1;

/** Dabs as x, y, radius triples. Laid at fixed spacing from the start, so earlier dabs never move. */
const dabCache = new WeakMap<Stroke, { seed: number; dabs: Float64Array }>();
function dabsOf(s: Stroke, seed: number): Float64Array {
  const hit = dabCache.get(s);
  if (hit && hit.seed === seed) return hit.dabs;
  const p = s.pts;
  const sp = Math.max(s.size * DAB_SPACING, 0.01);
  const out: number[] = [];
  const radius = (arc: number) => (s.size / 2) * (1 + s.variation * 0.35 * noise2(arc / (s.size * 1.3), 0.5, seed + 9));
  if (p.length === 2) out.push(p[0], p[1], radius(0));
  let arc = 0;
  let next = 0;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k];
    const ay = p[k + 1];
    const dx = p[k + 2] - ax;
    const dy = p[k + 3] - ay;
    const len = Math.hypot(dx, dy);
    while (next <= arc + len) {
      const f = len > 0 ? (next - arc) / len : 0;
      out.push(ax + dx * f, ay + dy * f, radius(next));
      next += sp;
    }
    arc += len;
  }
  const dabs = new Float64Array(out);
  dabCache.set(s, { seed, dabs });
  return dabs;
}

/** Copies of a stroke to consider on a wrapping map, as x offsets. */
function offsetsFor(s: Stroke, g: Grid, o: Options): number[] {
  const [sx0, sy0, sx1, sy1] = strokeBounds(s);
  const gx1 = g.x0 + (g.w - 1) * g.px;
  const gy1 = g.y0 + (g.h - 1) * g.px;
  return (o.wrapKm ? [0, -o.wrapKm, o.wrapKm] : [0]).filter((off) => !(sx1 + off < g.x0 || sx0 + off > gx1 || sy1 < g.y0 || sy0 > gy1));
}

/** Visit every sample point within `reach` (a multiple of each dab's radius) of each dab. */
function forDabs(s: Stroke, g: Grid, o: Options, seed: number, reach: number, visit: (i: number, x: number, y: number, dx: number, dy: number, r: number) => void): void {
  const dabs = dabsOf(s, seed);
  for (const off of offsetsFor(s, g, o)) {
    for (let k = 0; k < dabs.length; k += 3) {
      const cx = dabs[k] + off;
      const cy = dabs[k + 1];
      const r = dabs[k + 2];
      const R = r * reach;
      const i0 = Math.max(0, Math.ceil((cx - R - g.x0) / g.px));
      const i1 = Math.min(g.w - 1, Math.floor((cx + R - g.x0) / g.px));
      const j0 = Math.max(0, Math.ceil((cy - R - g.y0) / g.px));
      const j1 = Math.min(g.h - 1, Math.floor((cy + R - g.y0) / g.px));
      for (let j = j0; j <= j1; j++) {
        const y = g.y0 + j * g.px;
        const dy = y - cy;
        for (let i = i0; i <= i1; i++) {
          const x = g.x0 + i * g.px;
          const dx = x - cx;
          if (dx * dx + dy * dy < R * R) visit(j * g.w + i, x, y, dx, dy, r);
        }
      }
    }
  }
}

// Scratch buffers reused between strokes (one grid at a time per thread).
let scratchA = new Float32Array(0);
let scratchB = new Float32Array(0);
let scratchC = new Float32Array(0);
const scratch = (n: number) => {
  if (scratchA.length < n) {
    scratchA = new Float32Array(n);
    scratchB = new Float32Array(n);
    scratchC = new Float32Array(n);
  }
};

/** The box of sample points a stroke can touch: [i0, j0, i1, j1], or null. */
function boxOf(s: Stroke, g: Grid, o: Options): [number, number, number, number] | null {
  const offs = offsetsFor(s, g, o);
  if (!offs.length) return null;
  const [sx0, sy0, sx1, sy1] = strokeBounds(s);
  const i0 = Math.max(0, Math.floor((Math.min(...offs) + sx0 - g.x0) / g.px));
  const i1 = Math.min(g.w - 1, Math.ceil((Math.max(...offs) + sx1 - g.x0) / g.px));
  const j0 = Math.max(0, Math.floor((sy0 - g.y0) / g.px));
  const j1 = Math.min(g.h - 1, Math.ceil((sy1 - g.y0) / g.px));
  return i0 > i1 || j0 > j1 ? null : [i0, j0, i1, j1];
}

/**
 * Opaque paint: for each sample point, how far inside the stroke it is, as the distance to the
 * nearest dab centre over that dab's radius (0 = on the path, 1 = at the brush edge). The whole
 * stroke is one shape, however often it crosses itself.
 */
function unionStroke(s: Stroke, g: Grid, o: Options, seed: number, visit: (i: number, x: number, y: number, e: number, r: number) => void): void {
  const box = boxOf(s, g, o);
  if (!box) return;
  const [i0, j0, i1, j1] = box;
  scratch(g.w * g.h);
  const R = s.size / 2;
  // How far inside the nearest dab's edge (km): the exact union of the dabs' circles, so it is
  // continuous where neighbouring dabs differ in size.
  for (let j = j0; j <= j1; j++) scratchA.fill(-Infinity, j * g.w + i0, j * g.w + i1 + 1);
  const reach = 1 + s.roughness * 0.5 + 0.05;
  forDabs(s, g, o, seed, reach, (i, _x, _y, dx, dy, r) => {
    const inside = r - Math.sqrt(dx * dx + dy * dy);
    if (inside > scratchA[i]) scratchA[i] = inside;
  });
  for (let j = j0; j <= j1; j++) {
    const y = g.y0 + j * g.px;
    for (let i = i0; i <= i1; i++) {
      const idx = j * g.w + i;
      const e = 1 - scratchA[idx] / R;
      if (e < reach) visit(idx, g.x0 + i * g.px, y, e, R);
    }
  }
}

/** Brush coverage 0–1 from how far inside the stroke a point is, with a soft and ragged edge. */
function edge(s: Stroke, x: number, y: number, e: number, _r: number, px: number, seed: number): number {
  // One scale for the whole stroke, so the edge is continuous where neighbouring dabs differ in size.
  const r = s.size / 2;
  const soft = Math.max(s.softness, Math.min(1, (1.2 * px) / r));
  // The ragged outline moves the edge by at most this much; skip the noise away from it.
  const wobble = s.roughness * 0.45;
  if (e - wobble >= 1) return 0;
  if (wobble > 0 && e + wobble > 1 - soft) e += wobble * fbm(x, y, Math.max(r * 0.9, px), px, seed);
  if (e >= 1) return 0;
  return e <= 1 - soft ? 1 : 1 - smooth(1 - soft, 1, e);
}

/** A spray dab: a smooth bump, 1 in the middle and 0 at the edge, with its slope. */
const bump = (q: number) => (q < 1 ? (1 - q) * (1 - q) : 0);

/**
 * For line tools (cliffs, canyons, ravines): distance to the path, distance along it, and signed
 * distance (positive to the right of the drawing direction).
 */
function lineStroke(s: Stroke, g: Grid, o: Options, visit: (i: number, x: number, y: number, d: number, t: number, sd: number) => void): void {
  const box = boxOf(s, g, o);
  if (!box) return;
  const [bi0, bj0, bi1, bj1] = box;
  scratch(g.w * g.h);
  const reach = strokeReach(s);
  const p = s.pts;
  const segs = Math.max(1, p.length / 2 - 1);
  for (let j = bj0; j <= bj1; j++) scratchA.fill(Infinity, j * g.w + bi0, j * g.w + bi1 + 1);
  for (const off of offsetsFor(s, g, o)) {
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
          if (d < scratchA[idx]) {
            scratchA[idx] = d;
            scratchB[idx] = along + t * len;
            scratchC[idx] = l2 > 0 ? (dx * ey - dy * ex >= 0 ? d : -d) : d;
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
      const d = scratchA[idx];
      if (d < reach) visit(idx, g.x0 + i * g.px, y, d, scratchB[idx], scratchC[idx]);
    }
  }
}

/**
 * Gullies that follow the slope: ridges and valleys running straight downhill from whatever
 * shape has been painted, branching finer as they go (after Clay John's eroded-noise method).
 * Returns a height offset of about ±1. `gx, gy` is the slope (relief per km).
 */
function gullies(x: number, y: number, gx: number, gy: number, scale: number, px: number, seed: number, octaves: number, amp0: number): number {
  let h = 0;
  let amp = 1;
  let f = 1 / scale;
  let tx = gx;
  let ty = gy;
  const flat = Math.hypot(gx, gy);
  for (let oc = 0; oc < octaves; oc++) {
    const size = 1 / f;
    const fade = size >= px * 3 ? 1 : size <= px * 1.5 ? 0 : size / (px * 1.5) - 1;
    if (fade <= 0) break;
    const len = Math.hypot(tx, ty) + 1e-9;
    // Waves vary across the slope, so their crests and troughs run down it.
    const dx = ty / len;
    const dy = -tx / len;
    const sx = x * f;
    const sy = y * f;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const fx = sx - ix;
    const fy = sy - iy;
    let va = 0;
    let vx = 0;
    let vy = 0;
    let wt = 0;
    const s = seed + oc * 97;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const qx = fx - i - random2(cx, cy, s);
        const qy = fy - j - random2(cx, cy, s + 1);
        const w = Math.exp(-(qx * qx + qy * qy) * 2);
        const mag = (qx * dx + qy * dy) * TAU;
        va += Math.cos(mag) * w;
        const sn = -Math.sin(mag) * w;
        vx += sn * dx;
        vy += sn * dy;
        wt += w;
      }
    }
    const a = amp * fade;
    h += (va / wt) * a;
    // The gullies' own slopes steer the finer ones, so they branch.
    tx += (vx / wt) * TAU * f * a * amp0;
    ty += (vy / wt) * TAU * f * a * amp0;
    amp *= 0.45;
    f *= 2.1;
  }
  // No gullies on flat ground.
  return h * smooth(0, 0.004, flat);
}

/** A layered staircase for rock walls: flat benches and steep risers, `n` steps from 0 to 1. */
function terraces(u: number, n: number): number {
  const s = Math.max(0, Math.min(1, u)) * n;
  const fl = Math.floor(s);
  return Math.min(1, (fl + smooth(0.55, 1, s - fl)) / n);
}

// ---------------------------------------------------------------------------------------------

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
    face: new Float32Array(n),
    strata: new Float32Array(n),
    faceShade: new Float32Array(n).fill(1),
    shadow: new Float32Array(n),
    scree: new Float32Array(n),
    plateau: new Float32Array(n),
    ramp: new Float32Array(n),
    track: new Float32Array(n),
    ejecta: new Float32Array(n),
    hill: new Float32Array(n),
    water: new Float32Array(n),
    waterKind: new Uint8Array(n),
    waterDepth: new Float32Array(n),
    riverWidth: new Float32Array(n),
    foam: new Float32Array(n),
    wet: new Float32Array(n),
    volcano: new Float32Array(n),
    lava: new Float32Array(n),
    lavaGlow: new Float32Array(n),
    relief: new Float32Array(n),
  };
  // Volcanic cones (relief) and their slope, for gullies.
  const cone = new Float32Array(n);
  const coneGx = new Float32Array(n);
  const coneGy = new Float32Array(n);
  let rivers: Map<number, RiverInfo> | null = null;
  // Spray paint: mountain mass and its slope, hills, erosion.
  const mass = new Float32Array(n);
  const mgx = new Float32Array(n);
  const mgy = new Float32Array(n);
  const ridgeDepth = new Float32Array(n);
  const hills = new Float32Array(n);
  const erosion = new Float32Array(n);
  // Plateaus: how far inside the nearest rim (km), and their settings.
  const plateauIn = new Float32Array(n).fill(-Infinity);
  const plateauH = new Float32Array(n);
  const plateauW = new Float32Array(n);
  const plateauEro = new Float32Array(n);
  // Hollows and bumps that replace what was under them: canyons, ravines, craters.
  const cut = new Float32Array(n);
  // The same hollows as an even slope, for where a ramp leads down into them.
  const cutSmooth = new Float32Array(n);
  let zoneOverride: Int8Array | null = null;
  const px = g.px;

  for (const s of surface.strokes) {
    if (s.brush === 'whirlpool') continue;
    if (!offsetsFor(s, g, o).length) continue;
    const seed = strokeSeed(o.seed, s.id);
    const er = !!s.erase;
    const str = s.strength;

    if (s.brush === 'land' || s.brush === 'shallow' || s.brush === 'deep') {
      const target = er ? 0 : GROUND_TARGET[s.brush];
      unionStroke(s, g, o, seed, (i, x, y, e, r) => {
        const c = edge(s, x, y, e, r, px, seed) * str;
        if (c > 0) f.ground[i] += (target - f.ground[i]) * c;
      });
      continue;
    }
    if ((COVER_BRUSHES as readonly string[]).includes(s.brush)) {
      const key = s.brush as CoverBrush;
      const buf = (f.cover[key] ??= new Float32Array(n));
      unionStroke(s, g, o, seed, (i, x, y, e, r) => {
        const c = edge(s, x, y, e, r, px, seed);
        if (c <= 0) return;
        buf[i] = er ? buf[i] * (1 - c) : Math.max(buf[i], c * str);
      });
      continue;
    }
    switch (s.brush) {
      case 'mountains':
      case 'hills':
      case 'erode': {
        // Spray: each dab adds a smooth bump. Dragging along a line lays down about `strength`.
        const dabs = dabsOf(s, seed);
        const single = dabs.length <= 3;
        const per = single ? str * 0.7 : (str * DAB_SPACING * 2) / 1.07;
        const wob = s.roughness * 0.4;
        const ridges = s.sideRidges ?? 0.6;
        forDabs(s, g, o, seed, 1 + wob, (i, x, y, dx, dy, r) => {
          const d2 = dx * dx + dy * dy;
          let q = d2 / (r * r);
          // A ragged outline: the bump's edge wanders.
          if (wob > 0 && q > 0.3) q *= 1 + wob * fbm(x, y, r * 0.8, Math.max(px, r * 0.05), seed, 5);
          if (q >= 1) return;
          const b = bump(q) * per;
          if (s.brush === 'erode') {
            erosion[i] = er ? erosion[i] * (1 - b * 4) : Math.min(1, erosion[i] + b * (1 - erosion[i]));
            return;
          }
          if (s.brush === 'hills') {
            hills[i] = er ? Math.max(0, hills[i] - b) : hills[i] + b * Math.max(0, 1 - hills[i] / 1.2);
            return;
          }
          const sign = er ? -1 : 1;
          mass[i] = Math.max(0, mass[i] + sign * b);
          // Slope of the bump: d/dx of per·(1 − d²/r²)².
          const k = (sign * per * -4 * (1 - q)) / (r * r);
          mgx[i] += k * dx;
          mgy[i] += k * dy;
          if (!er) ridgeDepth[i] += b * ridges;
        });
        break;
      }
      case 'plateau': {
        // Plateaus merge: keep the deepest distance inside any rim. Erasing cuts them back.
        const H = 0.06 + 0.16 * str;
        const W = Math.max(s.size * 0.09, s.detail * 0.6, px * 1.5);
        unionStroke(s, g, o, seed, (i, x, y, e, r) => {
          let inside = r * (1 - e);
          if (s.roughness > 0) inside += s.roughness * r * 0.2 * fbm(x, y, r * 0.8, px, seed);
          if (er) {
            plateauIn[i] = Math.min(plateauIn[i], -inside);
            return;
          }
          if (inside > plateauIn[i]) {
            plateauIn[i] = inside;
            plateauH[i] = H;
            plateauW[i] = W;
            plateauEro[i] = s.erosion ?? 0.4;
          }
        });
        break;
      }
      case 'ramp':
        unionStroke(s, g, o, seed, (i, x, y, e, r) => {
          const c = edge(s, x, y, e, r, px, seed);
          if (c <= 0) return;
          if (er) {
            f.ramp[i] *= 1 - c;
            f.track[i] *= 1 - c;
            return;
          }
          f.ramp[i] = Math.max(f.ramp[i], c * str);
          // A track along the middle, wandering a little.
          const tr = (1 - smooth(0.12, 0.28, e + 0.08 * fbm(x, y, s.size, px, seed + 2, 3))) * str;
          if (tr > f.track[i]) f.track[i] = tr;
        });
        break;
      case 'cliffs': {
        // Only the face is drawn, on the low side; the high side is whatever land is there.
        const side = s.side ?? 1;
        const W = s.size / 2;
        const ero = s.erosion ?? 0.4;
        const H = 0.4 + 0.6 * str;
        const total = s.pts.length > 2 ? polyLength(s.pts) : 0;
        const facingAt = facingTable(s, side);
        lineStroke(s, g, o, (i, x, y, d, t, sd) => {
          const ends = Math.min(smooth(0, W * 2, t), smooth(0, W * 2, total - t), 1);
          if (er) {
            const c = d < W * 1.5 ? ends : 0;
            f.face[i] *= 1 - c;
            f.shadow[i] *= 1 - c;
            f.scree[i] *= 1 - c;
            return;
          }
          // Gullies notch the top edge; a ragged line.
          let down = -sd * side;
          down += s.roughness * W * 0.6 * fbm(x, y, W * 8, px, seed);
          down += ero * W * 0.8 * (ridged(t / (W * 1.4), down / (W * 3), 1, px / W, seed + 5, 3, 0.5) - 0.35);
          if (down < -px) return;
          const u = down / W;
          if (u <= 1.6) {
            // The face: a bright rock lip at the top, layered rock streaked by runnels, darker
            // toward the foot; then a fan of scree fading into the ground below.
            const a = (u < 0 ? smooth(-0.15, 0, u) : 1) * ends * (1 - smooth(0.7, 0.95, u));
            const scree = ends * smooth(0.6, 0.85, u) * (1 - smooth(1.05, 1.6, u + 0.25 * fbm(x, y, W * 2, px, seed + 3, 4)));
            if (a > f.face[i]) {
              f.face[i] = a;
              f.strata[i] = (1 - u) * 2.5 * H + 0.5 * fbm(x, y, W * 6, px, seed + 2, 4);
              const streak = ridged(t / (W * 0.45), u * 0.5, 1, px / W, seed + 7, 3, 0.5);
              f.faceShade[i] = shadeFor(facingAt(t)) * (0.84 + 0.26 * streak) * (1.12 - 0.3 * u) * (u < 0.12 ? 1.18 : 1);
            }
            if (scree > f.scree[i]) f.scree[i] = scree;
          }
          // Shadow on the ground below a face turned from the light.
          const facing = facingAt(t);
          if (facing < 0.2 && u > 0.6) {
            const reach = 1 + H * 1.6 * (0.2 - facing);
            const sh = (1 - smooth(1, reach, u)) * ends * 0.55;
            if (sh > f.shadow[i]) f.shadow[i] = sh;
          }
        });
        break;
      }
      case 'canyon':
      case 'ravine': {
        const canyon = s.brush === 'canyon';
        const buf = canyon ? f.canyon : f.ravine;
        const r = s.size / 2;
        const D = canyon ? 0.05 + 0.12 * str : 0.03 + 0.06 * str;
        const ero = s.erosion ?? 0.4;
        lineStroke(s, g, o, (i, x, y, d, t) => {
          let e = d / r;
          if (canyon) {
            // Side canyons notch the rim; terraced walls step down to a flat floor.
            // Side canyons cut back into the rim, branching.
            // An irregular rim with lobes and buttes...
            e += (0.15 + ero * 0.5) * fbm(x, y, r * 1.1, px, seed + 14, 5) * smooth(0.3, 0.9, e);
            // ...and side canyons cutting back into it at intervals, narrowing as they go.
            const cutAt = noise2(t / (r * 2.2), 0.31, seed + 11);
            const reachOut = d / (r * 2.2);
            const cutW = 1 - smooth(0, 0.55 * (1.1 - reachOut), Math.abs(noise2(t / (r * 1.1), d / (r * 5), seed + 12)));
            e -= ero * 1.3 * smooth(0.1, 0.45, cutAt) * cutW * smooth(0.3, 1, e) * (1 - smooth(0.7, 1, reachOut));
            e += s.roughness * 0.2 * fbm(x, y, r * 0.6, px, seed);
          } else {
            e += s.roughness * 0.6 * fbm(x, y, r * 2, px, seed);
          }
          if (e >= 1) return;
          if (er) {
            buf[i] *= e;
            cut[i] *= e;
            cutSmooth[i] *= e;
            return;
          }
          const c = 1 - smooth(0.85, 1, e);
          buf[i] = Math.max(buf[i], c * str);
          let depth: number;
          if (canyon) {
            const wall = Math.max(0, (e - 0.14) / 0.86);
            depth = D * (1 - terraces(wall + 0.06 * fbm(x, y, r * 0.8, px, seed + 3, 4), 3 + Math.round(ero * 3)));
            const even = D * (1 - wall);
            if (-even < cutSmooth[i]) cutSmooth[i] = -even;
            const a = smooth(0.08, 0.2, e) * (1 - smooth(0.92, 1, e));
            if (a > f.face[i]) {
              f.face[i] = a;
              f.strata[i] = (depth / D) * 5 + 0.8 * fbm(x, y, r * 2, px, seed + 2, 4);
              f.faceShade[i] = 1;
            }
          } else {
            // A narrow, deep crack.
            depth = D * Math.sqrt(1 - e);
            if (-D * (1 - e) < cutSmooth[i]) cutSmooth[i] = -D * (1 - e);
          }
          if (-depth < cut[i]) cut[i] = -depth;
        });
        break;
      }
      case 'crater':
        crater(s, g, o, seed, er, f, cut, mass, hills, plateauIn);
        break;
      case 'river': {
        if (er) {
          unionStroke(s, g, o, seed, (i, x, y, e, r) => {
            const c = edge(s, x, y, e, r, px, seed);
            if (c > 0) f.water[i] *= 1 - c;
          });
          break;
        }
        rivers ??= riverNetwork(surface);
        const info = rivers.get(s.id);
        if (!info) break;
        lineStroke(s, g, o, (i, _x, _y, d, t) => {
          const flow = flowAt(info, t);
          const w = widthForFlow(flow) / 2;
          // Like a map, rivers are drawn a little wider than life so they read at any zoom, and
          // visibly grow downstream.
          const wd = Math.max(w, px * (0.35 + 0.45 * Math.sqrt(flow)));
          const c = 1 - smooth(wd - px * 0.5, wd + px * 0.5, d);
          if (c > f.water[i]) {
            f.water[i] = c;
            f.waterKind[i] = 1;
            f.riverWidth[i] = w * 2;
          }
          // Green banks.
          const bank = 0.5 * (1 - smooth(w, w + 1.5 + w * 8, d));
          if (bank > f.wet[i]) f.wet[i] = bank;
        });
        for (const fall of s.falls ?? []) {
          if (typeof fall !== 'object') continue;
          const w = widthForFlow(flowAt(info, fall.at)) / 2;
          // White water all the way down the face, and a pool at the foot.
          const to = Math.max(fall.to, fall.at + w * 2);
          const steps = Math.min(200, Math.ceil((to - fall.at) / Math.max(px, w)));
          const cascade: number[] = [];
          for (let k = 0; k <= steps; k++) cascade.push(...pointAt(info, fall.at + ((to - fall.at) * k) / Math.max(1, steps)));
          const [qx, qy] = pointAt(info, to + Math.max(w * 2, 0.3));
          splash(f, g, o, cascade, qx, qy, w, px);
        }
        break;
      }
      case 'lake':
        unionStroke(s, g, o, seed, (i, x, y, e, r) => {
          const c = edge(s, x, y, e, r, px, seed);
          if (c <= 0) return;
          if (er) {
            f.water[i] *= 1 - c;
            return;
          }
          if (c * str >= f.water[i]) {
            f.water[i] = c * str;
            f.waterKind[i] = 2;
          }
          f.waterDepth[i] = Math.max(f.waterDepth[i], Math.min(1, (1 - e) * 2));
        });
        break;
      case 'waterfall': {
        const [x0, y0] = s.pts;
        if (er) {
          // Erasing a placed waterfall: clear its spray and pool.
          const R = s.size * 4;
          eachNear(g, o, x0, y0, R, (i) => {
            f.foam[i] = 0;
          });
          break;
        }
        splash(f, g, o, [x0, y0], x0, y0 + s.size, s.size / 2, px);
        break;
      }
      case 'volcano': {
        const R = s.size / 2;
        const [vx, vy] = s.pts;
        const A = (0.15 + 0.5 * Math.sqrt(R / 25)) * (0.4 + 0.6 * str);
        eachNear(g, o, vx, vy, R * 1.6, (i, x, y, dx, dy) => {
          const d = Math.hypot(dx, dy);
          const e = d / R + s.roughness * 0.12 * fbm(x, y, R * 0.5, px, seed, 4);
          if (er) {
            const k = smooth(0.8, 1.3, e);
            cone[i] *= k;
            f.volcano[i] *= k;
            f.lavaGlow[i] *= k;
            return;
          }
          if (e >= 1.2) return;
          // A steep-topped cone flaring out at the base, with a crater at the summit.
          const q = Math.max(0, 1 - e);
          let hh = A * q ** 1.6;
          let k = (-A * 1.6 * q ** 0.6) / (R * Math.max(d, 1e-6));
          const crater = 0.13;
          if (e < crater) {
            hh = A * (1 - crater) ** 1.6 - A * 0.28 * (1 - (e / crater) ** 2);
            k = (A * 0.56 * e) / (crater * crater * R * Math.max(d, 1e-6));
          }
          if (hh > cone[i]) {
            cone[i] = hh;
            coneGx[i] = k * dx;
            coneGy[i] = k * dy;
          }
          f.volcano[i] = Math.max(f.volcano[i], 1 - smooth(0.75, 1.15, e));
          if (s.active !== false && e < crater * 1.1) f.lavaGlow[i] = Math.max(f.lavaGlow[i], (1 - smooth(crater * 0.3, crater * 1.1, e)) * str);
        });
        break;
      }
      case 'lava': {
        const w0 = s.size / 2;
        lineStroke(s, g, o, (i, x, y, d) => {
          // Lobed, ropy edges.
          const w = w0 * (1 + s.roughness * 0.45 * fbm(x, y, s.size * 0.9, px, seed, 5));
          const c = 1 - smooth(w - px * 0.6, w + px * 0.6, d);
          if (c <= 0) return;
          if (er) {
            f.lava[i] *= 1 - c;
            f.lavaGlow[i] *= 1 - c;
            return;
          }
          f.lava[i] = Math.max(f.lava[i], c * str);
          if (s.active !== false) {
            // Glowing through cracks in a dark crust, hottest along the middle.
            const core = 1 - smooth(0, w * 0.8, d + w * 0.25 * fbm(x, y, s.size * 0.4, px, seed + 1, 3));
            const cracks = 1 - smooth(0, 0.12, Math.abs(fbm(x, y, Math.max(s.size * 0.25, px * 2), px, seed + 2, 4)));
            f.lavaGlow[i] = Math.max(f.lavaGlow[i], core * (0.25 + 0.75 * Math.max(cracks, core * core)) * str);
          }
        });
        break;
      }
      case 'zone':
        zoneOverride ??= new Int8Array(n).fill(-1);
        unionStroke(s, g, o, seed, (i, x, y, e, r) => {
          if (edge(s, x, y, e, r, px, seed) > 0.5) zoneOverride![i] = er || !s.zone ? -1 : s.zone;
        });
        break;
    }
  }

  // Mountains: the built-up mass levels off as it grows, and erosion wears it down.
  const capScale = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = mass[i];
    if (m <= 0) continue;
    const ex = Math.exp(-m / MOUNTAIN_CAP);
    capScale[i] = ex * (1 - 0.35 * erosion[i]);
    f.mountain[i] = MOUNTAIN_CAP * (1 - ex) * (1 - 0.35 * erosion[i]);
  }

  // Mountain zones: automatic from how high the mountains are built, then anything painted by hand.
  for (let i = 0; i < n; i++) {
    const b = Math.max(f.mountain[i], cone[i] * 1.4);
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
      f.ground[idx] = v + ev * 0.7 * fbm(g.x0 + i * px, g.y0 + j * px, 25, px, o.seed + 81, 7);
    }
  }

  // Relief, for lighting only.
  const dunes = f.cover.dunes;
  for (let j = 0; j < g.h; j++) {
    const y = g.y0 + j * px;
    for (let i = 0; i < g.w; i++) {
      const idx = j * g.w + i;
      const v = f.ground[idx];
      const land = smooth(1.35, 1.65, v);
      if (land <= 0) continue;
      const x = g.x0 + i * px;
      let r = 0.008 * fbm(x, y, 60, px, o.seed + 1, 6);
      const ev = erosion[idx];

      // Hills: soft bumps with gentle gullies.
      const hl = hills[idx];
      f.hill[idx] = hl;
      if (hl > 0) {
        const hh = 0.6 * (1 - Math.exp(-hl / 0.6));
        r += hh * 0.12 * (0.7 + 0.3 * fbm(x, y, 10, px, o.seed + 41, 5));
      }

      // Mountains: a body with a crest where the paint is thickest, and gullies down every slope.
      const m = f.mountain[idx];
      if (m > 0 && o.noRelief) r += m;
      else if (m > 0) {
        // Peaks and saddles vary the body, so the slopes (and gullies) aren't all parallel.
        const ps = 45;
        const pk = (xx: number, yy: number) => ridged(xx, yy, ps, Math.max(px, ps / 4), o.seed + 84, 2, 0.5);
        const p0 = pk(x, y);
        const hd = ps * 0.15;
        const pa = 0.18 * m;
        const gx = mgx[idx] * capScale[idx] + (pa * (pk(x + hd, y) - p0)) / hd;
        const gy = mgy[idx] * capScale[idx] + (pa * (pk(x, y + hd) - p0)) / hd;
        const depth = 0.3 + 0.5 * Math.min(1, ridgeDepth[idx] / Math.max(1e-6, mass[idx])) + 0.4 * ev;
        // Steep flanks get the deepest gullies.
        const ga = depth * (0.05 * m + 3 * Math.hypot(gx, gy));
        const gul = gullies(x, y, gx, gy, 24, Math.max(px, 2.5), o.seed + 85, 4, ga);
        r += m + pa * (p0 - 0.4) + ga * gul;
      }

      // Volcanoes: a cone scored by gullies running down from the rim.
      const cn = cone[idx];
      if (cn > 0) {
        r += cn;
        if (!o.noRelief) r += gullies(x, y, coneGx[idx], coneGy[idx], 6, Math.max(px, 0.6), o.seed + 95, 4, cn * 0.12) * cn * 0.12;
      }
      if (f.lava[idx] > 0) r += f.lava[idx] * 0.004;

      // Plateaus: a flat top ringed by layered rock faces, gullied by erosion. Ramps make a slope.
      const pin = plateauIn[idx];
      if (pin > -Infinity && plateauH[idx] > 0) {
        const W = plateauW[idx];
        const H = plateauH[idx];
        const ero = plateauEro[idx];
        // Gullies eat into the rim.
        const notch = ero * W * 1.6 * Math.max(0, ridged(x, y, W * 2.5, px, o.seed + 91, 4, 0.5) - 0.35);
        const inside = pin - notch;
        const u = 1 - Math.max(0, Math.min(1, inside / W));
        const steps = 2 + Math.round(ero * 3);
        let ph = inside <= 0 ? 0 : H * terraces(1 - u, steps);
        // Scree fans at the foot.
        if (inside > -W * 0.8 && inside <= 0) ph = H * 0.12 * (1 + inside / (W * 0.8)) ** 2;
        const rp = f.ramp[idx];
        if (rp > 0) {
          const slope = H * Math.max(0, Math.min(1, (inside + W * 2.5) / (W * 3.5)));
          ph = ph + (Math.max(ph * (inside > W ? 1 : 0), slope) - ph) * rp;
        }
        r += ph;
        f.plateau[idx] = smooth(0, W * 0.3, inside);
        // Shadow cast past the rim on the side away from the light: the rim lies to the
        // north-west of here when the plateau's inward direction points that way.
        if (inside < 0 && inside > -W * 2.5 && i > 0 && j > 0 && i < g.w - 1 && j < g.h - 1) {
          const ix = plateauIn[idx + 1] - plateauIn[idx - 1];
          const iy = plateauIn[idx + g.w] - plateauIn[idx - g.w];
          const l = Math.hypot(ix, iy);
          if (l > 0 && Number.isFinite(l)) {
            const toward = (ix * -0.7071 + iy * -0.7071) / l;
            const sh = Math.max(0, toward) * (1 - smooth(0, W * 2.4 * (0.4 + 0.6 * toward), -inside)) * (1 - rp) * 0.6;
            if (sh > f.shadow[idx]) f.shadow[idx] = sh;
          }
        }
        const a = (inside > 0 && u > 0.02 ? 1 - smooth(0.9, 1, 1 - u) : 0) * (1 - rp);
        if (a > f.face[idx]) {
          f.face[idx] = a;
          f.strata[idx] = (1 - u) * (steps + 1) + 0.3 * fbm(x, y, W * 3, px, o.seed + 92);
          f.faceShade[idx] = 1;
        }
      }

      // A ramp into a canyon or ravine replaces its steps with an even slope down to the floor.
      r += f.ramp[idx] > 0 && cut[idx] < 0 ? cut[idx] + (Math.min(cutSmooth[idx], 0) - cut[idx]) * f.ramp[idx] : cut[idx];
      if (dunes && dunes[idx] > 0) {
        const ph = (x * 0.8 + y * 0.6) / 2.2 + 2.5 * fbm(x, y, 18, px, o.seed + 5);
        const fr = ph - Math.floor(ph);
        r += dunes[idx] * 0.012 * (fr < 0.75 ? fr / 0.75 : (1 - fr) / 0.25);
      }
      const forest = (f.cover.forest?.[idx] ?? 0) + (f.cover.jungle?.[idx] ?? 0);
      if (forest > 0) r += Math.min(1, forest) * 0.003 * fbm(x, y, Math.max(px * 2.5, 0.08), px * 0.8, o.seed + 6, 3);
      if (ev > 0) r += ev * 0.015 * (ridged(x, y, 6, px, o.seed + 83, 5, 0.5) - 0.5);
      f.relief[idx] = r * land;
      if (f.ramp[idx] > 0) {
        f.face[idx] *= 1 - f.ramp[idx];
        f.scree[idx] *= 1 - f.ramp[idx];
      }
    }
  }
  return f;
}

/** Visit sample points within `R` km of (cx, cy), on every wrapped copy. */
function eachNear(g: Grid, o: Options, cx0: number, cy: number, R: number, visit: (i: number, x: number, y: number, dx: number, dy: number) => void): void {
  for (const off of o.wrapKm ? [0, -o.wrapKm, o.wrapKm] : [0]) {
    const cx = cx0 + off;
    const i0 = Math.max(0, Math.ceil((cx - R - g.x0) / g.px));
    const i1 = Math.min(g.w - 1, Math.floor((cx + R - g.x0) / g.px));
    const j0 = Math.max(0, Math.ceil((cy - R - g.y0) / g.px));
    const j1 = Math.min(g.h - 1, Math.floor((cy + R - g.y0) / g.px));
    for (let j = j0; j <= j1; j++) {
      const y = g.y0 + j * g.px;
      for (let i = i0; i <= i1; i++) {
        const x = g.x0 + i * g.px;
        visit(j * g.w + i, x, y, x - cx, y - cy);
      }
    }
  }
}

/**
 * A waterfall pouring down `cascade` (x, y points) with half-width `w` km: white water down the
 * face, a pool where it lands at (qx, qy), and wet, fertile ground around (an oasis in dry land).
 */
function splash(f: Fields, g: Grid, o: Options, cascade: number[], qx: number, qy: number, w0: number, px: number): void {
  // Drawn a little larger than life, like the rivers, so they show on the map.
  const w = Math.max(w0, px * 1.2);
  const R = Math.max(w * 3, 0.35, px * 2);
  const green = 4 + w * 25;
  const spray = w * 1.4 + Math.max(px, 0.15);
  let reach = R + green;
  for (let k = 0; k < cascade.length; k += 2) reach = Math.max(reach, Math.hypot(cascade[k] - qx, cascade[k + 1] - qy) + spray);
  eachNear(g, o, qx, qy, reach, (i, x, y, dx, dy) => {
    const dq = Math.hypot(dx, dy);
    const pool = 1 - smooth(R - px * 0.5, R + px * 0.5, dq);
    if (pool > 0 && pool >= f.water[i]) {
      f.water[i] = pool;
      f.waterKind[i] = 2;
      f.waterDepth[i] = Math.max(f.waterDepth[i], 1 - dq / R);
    }
    const wet = 1 - smooth(R, R + green, dq);
    if (wet > f.wet[i]) f.wet[i] = wet;
    let near = Infinity;
    for (let k = 0; k < cascade.length; k += 2) near = Math.min(near, Math.hypot(x - cascade[k], y - cascade[k + 1]));
    const foam = (1 - smooth(spray * 0.6, spray, near)) * 0.95 + (1 - smooth(0, R * 1.3, dq)) * 0.4;
    if (foam > f.foam[i]) f.foam[i] = Math.min(1, foam);
  });
}

function polyLength(p: number[]): number {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
}

/**
 * How squarely a cliff face looks toward the light (from the north-west) at each distance along
 * the line: 1 straight at it, −1 away. The face looks toward the low side.
 */
function facingTable(s: Stroke, side: number): (t: number) => number {
  const p = s.pts;
  const ends: number[] = [];
  const facing: number[] = [];
  let along = 0;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const dx = p[k + 2] - p[k];
    const dy = p[k + 3] - p[k + 1];
    const len = Math.hypot(dx, dy);
    along += len;
    ends.push(along);
    // Right of the drawing direction is (−dy, dx); light comes from (−1, −1).
    facing.push(len > 0 ? -((-dy / len) * side * -0.7071 + (dx / len) * side * -0.7071) : 0);
  }
  return (t) => {
    if (!ends.length) return 0;
    let lo = 0;
    let hi = ends.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return facing[lo];
  };
}

const shadeFor = (facing: number) => 0.88 + 0.38 * facing;

/**
 * An impact crater. Bigger means a bigger meteor: small ones are simple bowls; big ones have a
 * flat floor, terraced walls and a central peak. The blast wipes out what was there before
 * (older craters included), then the rim and a blanket of ejecta land on top.
 */
function crater(s: Stroke, g: Grid, o: Options, seed: number, er: boolean, f: Fields, cut: Float32Array, mass: Float32Array, hills: Float32Array, plateauIn: Float32Array): void {
  const R = s.size / 2;
  const cx0 = s.pts[0];
  const cy = s.pts[1];
  const str = s.strength;
  // Depth grows with size, but big craters are shallow for their width.
  const A = (0.02 + 0.07 * Math.min(1, Math.sqrt(R / 40))) * (0.4 + 0.6 * str);
  const complex = R > 8;
  const ellipse = 1 + 0.08 * noise2(seed % 1000, 0.3, seed);
  const rot = random2(seed, 3, seed) * Math.PI;
  const offs = o.wrapKm ? [0, -o.wrapKm, o.wrapKm] : [0];
  const px = g.px;
  for (const off of offs) {
    const cx = cx0 + off;
    const reach = R * 4;
    const i0 = Math.max(0, Math.ceil((cx - reach - g.x0) / px));
    const i1 = Math.min(g.w - 1, Math.floor((cx + reach - g.x0) / px));
    const j0 = Math.max(0, Math.ceil((cy - reach - g.y0) / px));
    const j1 = Math.min(g.h - 1, Math.floor((cy + reach - g.y0) / px));
    for (let j = j0; j <= j1; j++) {
      const y = g.y0 + j * px;
      for (let i = i0; i <= i1; i++) {
        const x = g.x0 + i * px;
        const idx = j * g.w + i;
        const dx = x - cx;
        const dy = y - cy;
        const rx = dx * Math.cos(rot) + dy * Math.sin(rot);
        const ry = (-dx * Math.sin(rot) + dy * Math.cos(rot)) * ellipse;
        let e = Math.hypot(rx, ry) / R;
        e += s.roughness * 0.12 * fbm(x, y, R * 0.6, px, seed);
        if (e >= 4) continue;
        if (er) {
          const k = smooth(0.9, 1.4, e);
          cut[idx] *= k;
          f.ejecta[idx] *= k;
          continue;
        }
        // The blast: whatever was inside the rim is wiped out.
        const blast = 1 - smooth(0.85, 1.1, e);
        if (blast > 0) {
          cut[idx] *= 1 - blast;
          mass[idx] *= 1 - blast * 0.9;
          hills[idx] *= 1 - blast;
          if (blast > 0.5) plateauIn[idx] = Math.min(plateauIn[idx], -1);
          f.ejecta[idx] *= 1 - blast;
        }
        let h: number;
        if (e < 1) {
          // The inner wall is bare rock showing the layers the impact cut through.
          const wallA = smooth(0.5, 0.75, e) * (1 - smooth(0.97, 1.03, e));
          if (wallA > f.face[idx]) {
            f.face[idx] = wallA * 0.85;
            f.strata[idx] = (1 - e) * 6 + 0.6 * fbm(x, y, R * 0.4, px, seed + 12, 4);
            f.faceShade[idx] = 1;
          }
          // The floor is a darker, lumpy basin.
          f.shadow[idx] = Math.max(f.shadow[idx], (1 - smooth(0.3, 0.8, e)) * 0.25);
          if (complex) {
            // Flat floor, terraced walls, a central peak.
            // Slumped, uneven terraces.
            const wall = smooth(0.45, 1, e + 0.12 * fbm(x, y, R * 0.35, px, seed + 8, 4));
            h = -A + A * 1.3 * terraces(wall, 3) * wall + A * 0.12 * fbm(x, y, R * 0.15, px, seed + 9, 5);
            h += A * 0.7 * Math.exp(-((e / 0.13) ** 2)) * (0.8 + 0.4 * ridged(x, y, R * 0.15, px, seed + 3, 3, 0.5));
          } else {
            h = -A + A * 1.3 * e * e + A * 0.06 * fbm(x, y, R * 0.3, px, seed + 9, 4);
          }
        } else {
          // Raised rim, then a blanket of ejecta thinning outward, lumpy near the rim.
          // Raised rim, then a blanket of ejecta thinning outward: lumpy, with radial furrows.
          const ang = Math.atan2(dy, dx);
          const furrows = noise2(ang * (8 + R * 0.2), e * 1.5, seed + 13);
          h = A * 0.3 * Math.pow(e, -3.2) * (1 + 0.8 * fbm(x, y, R * 0.2, px, seed + 4, 5) * smooth(2.5, 1, e) + 0.5 * furrows * smooth(3, 1.2, e));
        }
        cut[idx] = (1 - blast) * cut[idx] + h;
        if (e > 0.9) {
          // Fresh ejecta and rays, lighter than the ground around.
          const ang = Math.atan2(dy, dx);
          const rays = R > 15 ? Math.max(0, noise2(ang * 5, e * 0.6, seed + 6)) ** 4 * (0.5 + 0.5 * fbm(x, y, R * 0.3, px, seed + 10, 3)) : 0;
          const ej = Math.min(1, (Math.pow(e, -2.5) * 0.7 + rays * smooth(3.2, 1.2, e)) * str);
          f.ejecta[idx] = Math.max(f.ejecta[idx], ej);
        }
      }
    }
  }
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

/**
 * Ramps are the way peoples get between the ground floor and a raised or sunken feature
 * (plateaus, cliffs, canyons). The simulation treats each one as an access point with two ends.
 */
export interface AccessPoint {
  id: number;
  /** The two ends of the ramp, km. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Width in km. */
  width: number;
}

export function accessPoints(surface: Surface): AccessPoint[] {
  return surface.strokes
    .filter((s) => s.brush === 'ramp' && !s.erase)
    .map((s) => ({ id: s.id, from: { x: s.pts[0], y: s.pts[1] }, to: { x: s.pts[s.pts.length - 2], y: s.pts[s.pts.length - 1] }, width: s.size }));
}

/** What the simulation sees at one place. */
export interface PlaceInfo {
  ground: GroundClass;
  cover: Partial<Record<CoverBrush, number>>;
  mountain: number;
  zone: ZoneId;
  plateau: boolean;
  /** A cliff or rock face here (no ramp). */
  cliff: boolean;
  /** A ramp joins the ground floor to the feature here: an easy way up or down. */
  ramp: boolean;
  /** Fresh water here: a river or a lake (null on dry land and at sea). */
  water: 'river' | 'lake' | null;
  /** River width here, km (0 if no river). */
  riverWidth: number;
  /** A waterfall's white water here. */
  waterfall: boolean;
  /** Extra wetness and fertility (river banks, waterfall oases), 0–1. */
  wet: number;
  /** On a volcano or lava flow (rich ash soil, obsidian, sulfur, hot springs…). */
  volcanic: boolean;
  /** Canyons, ravines and cliff faces block travel (ramps open them). */
  blocksTravel: boolean;
  whirlpool: Whirlpool | null;
}

/** What is at a place (x, y in km from the north-west corner). */
export function surfaceAt(surface: Surface, x: number, y: number, o: Options): PlaceInfo {
  const f = evaluate(surface, { x0: x, y0: y, px: 0.25, w: 1, h: 1 }, o);
  const cover: Partial<Record<CoverBrush, number>> = {};
  for (const [k, v] of Object.entries(f.cover)) if (v[0] > 0.05) cover[k as CoverBrush] = Math.round(v[0] * 100) / 100;
  const w = whirlpools(surface).find((p) => Math.hypot(p.x - x, p.y - y) < p.r) ?? null;
  const ramp = f.ramp[0] > 0.5;
  const cliff = f.face[0] > 0.5 && !ramp;
  return {
    ground: groundClass(f.ground[0]),
    cover,
    mountain: f.mountain[0],
    zone: f.zone[0] as ZoneId,
    plateau: f.plateau[0] > 0.5,
    cliff,
    ramp,
    blocksTravel: !ramp && (f.canyon[0] > 0.5 || f.ravine[0] > 0.5 || cliff),
    water: f.water[0] > 0.5 && f.ground[0] >= 1.5 ? (f.waterKind[0] === 1 ? 'river' : 'lake') : null,
    riverWidth: f.waterKind[0] === 1 && f.water[0] > 0.3 ? Math.round(f.riverWidth[0] * 100) / 100 : 0,
    waterfall: f.foam[0] > 0.5,
    wet: Math.round(f.wet[0] * 100) / 100,
    volcanic: f.volcano[0] > 0.3 || f.lava[0] > 0.3,
    whirlpool: w,
  };
}
