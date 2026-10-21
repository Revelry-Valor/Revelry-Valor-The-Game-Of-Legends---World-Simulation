import { CLIMATE_DEFAULTS, climateRadiusKm, kmPerDegree, type WorldSettings } from './settings';
import type { Stroke, Surface } from './paint';
import { evaluate } from './terrain';
import { flowAt, riverNetwork, widthForFlow } from './water';

/**
 * The climate (REDESIGN.md, section 7): a chain of rules run once for northern summer and once
 * for northern winter, on invisible climate points spread evenly over the map. Nothing in the
 * simulation lives on these points: they only answer "what is the climate here?", blended
 * smoothly between them.
 *
 * Order per season: wind belts → ocean currents → temperature → ITCZ → pressure centres →
 * pressure field and winds → fronts → upwelling → rain; then climate zones, sea ice and reefs.
 */

export const ZONE_INFO = [
  { name: 'Tropical rainforest', colour: '#0b6b3a' },
  { name: 'Tropical monsoon', colour: '#2d9a52' },
  { name: 'Tropical savanna', colour: '#a5cf63' },
  { name: 'Hot desert', colour: '#ecc27a' },
  { name: 'Cold desert', colour: '#d9c9a2' },
  { name: 'Hot steppe', colour: '#d3ad5f' },
  { name: 'Cold steppe', colour: '#c4b787' },
  { name: 'Mediterranean', colour: '#b9ba3b' },
  { name: 'Humid subtropical', colour: '#72b56c' },
  { name: 'Oceanic', colour: '#4b9c8c' },
  { name: 'Humid continental', colour: '#5d88b7' },
  { name: 'Subarctic', colour: '#6c6fab' },
  { name: 'Tundra', colour: '#a9b7b4' },
  { name: 'Ice cap', colour: '#eaf2f5' },
] as const;
export type ZoneCode = number;

/** Rain index thresholds: below WET is dry, from VERY_WET up is very wet. */
export const RAIN_WET = 0.12;
export const RAIN_VERY_WET = 0.42;
export const rainClass = (r: number) => (r < RAIN_WET ? 0 : r < RAIN_VERY_WET ? 1 : 2);
export const RAIN_NAMES = ['dry', 'wet', 'very wet'];

export interface PressureCentre {
  kind: 'high' | 'low';
  name: string;
  /** km from the map's north-west corner (may lie off the map). */
  x: number;
  y: number;
  /** Strength (pressure units) and size (km). */
  amp: number;
  sx: number;
  sy: number;
  /** Placed highs: the stroke it came from, its strength (0–1) and reach (km). */
  id?: number;
  strength?: number;
  reach?: number;
}

export interface SeasonClimate {
  /** Air temperature over land, sea surface temperature over sea (°C). */
  temp: Float32Array;
  /** Rain index (see rainClass); 0 at sea. */
  rain: Float32Array;
  /** Wind toward east and toward north (arbitrary units). */
  windU: Float32Array;
  windV: Float32Array;
  pressure: Float32Array;
  /** Front zones, 0–1. */
  front: Float32Array;
  /** Upwelling strength at sea, 0–1. */
  upwell: Float32Array;
  /** Coastal fog, 0–1. */
  fog: Float32Array;
  /** Ocean currents: −1 cold, 0 neutral, 1 warm, −9 none; direction (east, north); temperature anomaly (°C). */
  current: Int8Array;
  curU: Float32Array;
  curV: Float32Array;
  curAnomaly: Float32Array;
  ice: Uint8Array;
  snow: Uint8Array;
  /** ITCZ latitude for each column. */
  itcz: Float32Array;
  centres: PressureCentre[];
  /** Paths for the map: winds and currents, coarse and fine (km, fixed to the map). */
  windPaths: FlowPath[][];
  currentPaths: FlowPath[][];
  /** The major currents as built (km), before they become map paths. */
  major?: { pts: number[]; kind: number[] }[];
}

/** A traced path through a flow, in km from the map's north-west corner (x may run past the edges on wrapping maps). */
export interface FlowPath {
  pts: Float32Array;
  /** Per point: 1 warm, −1 cold, 0 neutral (currents); 0 for winds. */
  kind: Int8Array;
  /** Major current (deep water, steered by coasts and shelves) or minor (shallow sea). */
  major: boolean;
}

export interface Climate {
  /** Climate points: the first is at (x0, y0) km, `step` km apart, w × h of them. */
  x0: number;
  y0: number;
  step: number;
  w: number;
  h: number;
  wrapKm: number;
  /** Latitude of each row. */
  lat: Float32Array;
  land: Uint8Array;
  ground: Float32Array;
  height: Float32Array;
  distSea: Float32Array;
  /** Northern summer (s = 1) and northern winter (s = −1). */
  summer: SeasonClimate;
  winter: SeasonClimate;
  zone: Int8Array;
  reef: Uint8Array;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, w: number) => Math.exp(-(x * x) / (w * w));
const RAD = Math.PI / 180;
const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Wind cell edges for a day length (Earth: 30° and 60°); a warmer world pushes the first poleward. */
export function cellEdges(dayLengthHours: number, avgTempC: number): number[] {
  const r = dayLengthHours / 24;
  const base = r <= 0.75 ? [25, 40, 55, 70] : r <= 1.5 ? [30, 60] : r <= 3 ? [40, 70] : r <= 8 ? [55] : [70];
  const shift = (avgTempC - 15) / 4;
  return base.map((e, i) => Math.max(10, Math.min(85, e + (i === 0 ? shift : shift * 0.5))));
}

/** Chamfer distance (km) from every point to the nearest point where `seed` is true. */
function distanceField(w: number, h: number, step: number, wrap: boolean, seed: (k: number) => boolean, edgeSeed: boolean): Float32Array {
  const d = new Float32Array(w * h).fill(1e9);
  for (let k = 0; k < w * h; k++) if (seed(k)) d[k] = 0;
  // Off the map counts as a seed (open ocean) along the edges that don't wrap.
  if (edgeSeed) {
    for (let i = 0; i < w; i++) {
      d[i] = Math.min(d[i], step * 0.5);
      d[(h - 1) * w + i] = Math.min(d[(h - 1) * w + i], step * 0.5);
    }
    if (!wrap) for (let j = 0; j < h; j++) {
      d[j * w] = Math.min(d[j * w], step * 0.5);
      d[j * w + w - 1] = Math.min(d[j * w + w - 1], step * 0.5);
    }
  }
  const a = step;
  const b = step * Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let v = d[k];
        const il = i > 0 ? i - 1 : wrap ? w - 1 : -1;
        if (il >= 0) v = Math.min(v, d[j * w + il] + a);
        if (j > 0) {
          v = Math.min(v, d[k - w] + a);
          if (il >= 0) v = Math.min(v, d[(j - 1) * w + il] + b);
          const ir = i < w - 1 ? i + 1 : wrap ? 0 : -1;
          if (ir >= 0) v = Math.min(v, d[(j - 1) * w + ir] + b);
        }
        d[k] = v;
      }
    }
    for (let j = h - 1; j >= 0; j--) {
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        let v = d[k];
        const ir = i < w - 1 ? i + 1 : wrap ? 0 : -1;
        if (ir >= 0) v = Math.min(v, d[j * w + ir] + a);
        if (j < h - 1) {
          v = Math.min(v, d[k + w] + a);
          if (ir >= 0) v = Math.min(v, d[(j + 1) * w + ir] + b);
          const il = i > 0 ? i - 1 : wrap ? w - 1 : -1;
          if (il >= 0) v = Math.min(v, d[(j + 1) * w + il] + b);
        }
        d[k] = v;
      }
    }
  }
  return d;
}

/** Blur a field a few times (3 × 3), wrap-aware. */
function blur(src: Float32Array, w: number, h: number, wrap: boolean, passes: number): Float32Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let s = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= h) continue;
          for (let di = -1; di <= 1; di++) {
            let ii = i + di;
            if (ii < 0 || ii >= w) {
              if (!wrap) continue;
              ii = (ii + w) % w;
            }
            s += a[jj * w + ii];
            n++;
          }
        }
        b[j * w + i] = s / n;
      }
    }
    a = b;
  }
  return a;
}

/** Work out the climate of a world. */
export function computeClimate(surface: Surface, s: WorldSettings): Climate {
  const W = s.widthKm;
  const H = s.heightKm;
  const w = Math.max(4, Math.round(W / Math.max(8, Math.max(W, H) / 300)));
  const stepX = W / w;
  const stepY = stepX;
  const h = Math.max(4, Math.round(H / stepY));
  const wrap = s.edges === 'wrap';
  const n = w * h;
  const c = { ...CLIMATE_DEFAULTS, ...s.climate };
  const tilt = Math.max(0, Math.min(90, s.axialTilt));
  const tiltF = tilt / 23.5;
  const avgShift = s.averageTemperatureC - 15;
  const edges = cellEdges(s.dayLengthHours, s.averageTemperatureC);

  // ---- The painted world, sampled at the climate points ----
  const f = evaluate(surface, { x0: stepX / 2, y0: stepY / 2, px: stepX, w, h }, { seed: s.seed, wrapKm: wrap ? W : 0, noRelief: true });
  const ground = f.ground;
  const height = f.climateH;
  const land = new Uint8Array(n);
  for (let k = 0; k < n; k++) land[k] = ground[k] >= 1.5 ? 1 : 0;
  const kpd = kmPerDegree(s);
  const lat = new Float32Array(h);
  for (let j = 0; j < h; j++) lat[j] = s.northLatitude - ((j + 0.5) * stepY) / kpd;
  const latOf = (k: number) => lat[(k / w) | 0];

  const distSea = distanceField(w, h, Math.min(stepX, stepY), wrap, (k) => !land[k], true);
  const distLand = distanceField(w, h, Math.min(stepX, stepY), wrap, (k) => land[k] === 1, false);
  const distDeep = distanceField(w, h, Math.min(stepX, stepY), wrap, (k) => ground[k] < 0.5, true);

  // Direction from a sea point toward the nearest land (east, north), from the distance field.
  const toLandX = new Float32Array(n);
  const toLandY = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (land[k]) continue;
      const il = i > 0 ? k - 1 : wrap ? k + w - 1 : k;
      const ir = i < w - 1 ? k + 1 : wrap ? k - w + 1 : k;
      const ju = j > 0 ? k - w : k;
      const jd = j < h - 1 ? k + w : k;
      const gx = distLand[ir] - distLand[il];
      const gy = distLand[ju] - distLand[jd]; // northward
      const len = Math.hypot(gx, gy) || 1;
      toLandX[k] = -gx / len;
      toLandY[k] = -gy / len;
    }
  }

  const ctx: Ctx = { kpd, s, c, w, h, n, stepX, stepY, W, H, wrap, lat, land, ground, height, distSea, distLand, distDeep, toLandX, toLandY, tilt, tiltF, avgShift, edges, latOf };
  const summer = season(ctx, surface, 1);
  const winter = season(ctx, surface, -1);
  const zone = zones(ctx, summer, winter);
  const reef = reefs(ctx, surface, summer, winter);
  const cl: Climate = { x0: stepX / 2, y0: stepY / 2, step: stepX, w, h, wrapKm: wrap ? W : 0, lat, land, ground, height, distSea, summer, winter, zone, reef };
  for (const se of [summer, winter]) {
    flowPaths(cl, se, W, H);
    delete se.major;
  }
  return cl;
}

interface Ctx {
  /** Kilometres per degree of latitude on this planet. */
  kpd: number;
  s: WorldSettings;
  c: typeof CLIMATE_DEFAULTS;
  w: number;
  h: number;
  n: number;
  stepX: number;
  stepY: number;
  W: number;
  H: number;
  wrap: boolean;
  lat: Float32Array;
  land: Uint8Array;
  ground: Float32Array;
  height: Float32Array;
  distSea: Float32Array;
  distLand: Float32Array;
  distDeep: Float32Array;
  toLandX: Float32Array;
  toLandY: Float32Array;
  tilt: number;
  tiltF: number;
  avgShift: number;
  edges: number[];
  latOf: (k: number) => number;
}

/** Sea temperature before currents (°C) at a latitude in a season (s = 1 northern summer). */
function seaBase(ctx: Ctx, latDeg: number, s: number): number {
  const sn = Math.sin(latDeg * RAD);
  const annual = 28 - 31 * sn * sn - 2 * sn ** 8 + ctx.avgShift;
  const amp = (4 * Math.abs(Math.sin(2 * latDeg * RAD)) + 1.5 * Math.abs(sn)) * ctx.tiltF;
  return annual + Math.sign(latDeg) * s * amp;
}

/** Which wind belt a latitude is in: 0 = trades, then alternating; and the belt's zonal sign. */
const belt0 = (ctx: Ctx, latDeg: number, s: number) => belt(ctx, latDeg, s);

function belt(ctx: Ctx, latDeg: number, s: number): { band: number; u: number; v: number } {
  const l = latDeg - s * 5 * ctx.tiltF;
  const al = Math.abs(l);
  let band = 0;
  for (const e of ctx.edges) if (al >= e) band++;
  const u = band % 2 === 0 ? -1 : 1;
  // Even bands blow toward the equator, odd bands toward the pole.
  const v = (band % 2 === 0 ? -0.35 : 0.3) * Math.sign(l || 1);
  return { band, u, v };
}

function season(ctx: Ctx, surface: Surface, s: number): SeasonClimate {
  const { w, h, n, stepX, stepY, land, lat, wrap, c } = ctx;
  const out: SeasonClimate = {
    temp: new Float32Array(n),
    rain: new Float32Array(n),
    windU: new Float32Array(n),
    windV: new Float32Array(n),
    pressure: new Float32Array(n),
    front: new Float32Array(n),
    upwell: new Float32Array(n),
    fog: new Float32Array(n),
    current: new Int8Array(n).fill(-9),
    curU: new Float32Array(n),
    curV: new Float32Array(n),
    curAnomaly: new Float32Array(n),
    ice: new Uint8Array(n),
    snow: new Uint8Array(n),
    itcz: new Float32Array(w),
    centres: [],
    windPaths: [],
    currentPaths: [],
  };

  // 1. ITCZ path.
  itczPath(ctx, s, out.itcz);

  // 2. Ocean currents.
  currents(ctx, surface, s, out);

  // 3. Sea temperature with currents.
  const sst = new Float32Array(n);
  for (let k = 0; k < n; k++) sst[k] = seaBase(ctx, ctx.latOf(k), s) + out.curAnomaly[k];

  // 4. Land temperature: upwind trace to the sea gives distance (continentality) and the
  //    current anomaly the air brought with it.
  const crystals = climateCrystals(surface);
  const step = Math.min(stepX, stepY);
  const contDist = new Float32Array(n);
  const contAnom = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!land[k]) continue;
      // Trace upwind along the idealized belts.
      let x = (i + 0.5) * stepX;
      let y = (j + 0.5) * stepY;
      let dist = 0;
      let anomaly = 0;
      let blocked = 0;
      for (let t = 0; t < 400 && dist < 3000; t++) {
        const la2 = ctx.s.northLatitude - y / ctx.kpd;
        const b = belt(ctx, la2, s);
        const len = Math.hypot(b.u, b.v);
        x -= (b.u / len) * step;
        y += (b.v / len) * step;
        dist += step;
        if (y < 0 || y > ctx.H) break;
        if (x < 0 || x > ctx.W) {
          if (!wrap) break;
          x = (x + ctx.W) % ctx.W;
        }
        const ii = Math.min(w - 1, Math.floor(x / stepX));
        const jj = Math.min(h - 1, Math.floor(y / stepY));
        const kk = jj * w + ii;
        if (!land[kk]) {
          anomaly = out.curAnomaly[kk];
          break;
        }
        if (ctx.height[kk] > 1.5 && !blocked) {
          blocked = 1;
          dist += 1200;
        }
      }
      // Never further than the straight-line distance to the sea allows the other way round.
      contDist[k] = Math.max(dist, ctx.distSea[k]);
      contAnom[k] = anomaly * Math.exp(-dist / 450);
    }
  }
  // Belts switch direction at their edges: blend so nothing changes in a hard line.
  const cd = blur(contDist, w, h, wrap, 14);
  const ca = blur(contAnom, w, h, wrap, 3);
  for (let j = 0; j < h; j++) {
    const la = lat[j];
    const sn = Math.abs(Math.sin(la * RAD));
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!land[k]) {
        out.temp[k] = sst[k];
        continue;
      }
      const cont = Math.min(1, cd[k] / 2200);
      const annual = seaBase(ctx, la, 0) - cont * 12 * sn * sn;
      const amp = ctx.tiltF * (6 + 22 * cont) * Math.pow(sn, 0.8);
      let T = annual + Math.sign(la) * s * amp + ca[k] - c.altitudeCoolingC * ctx.height[k];
      T += crystalEffect(crystals, (i + 0.5) * stepX, (j + 0.5) * stepY, 'heat', ctx) * 12;
      T -= crystalEffect(crystals, (i + 0.5) * stepX, (j + 0.5) * stepY, 'cold', ctx) * 12;
      out.temp[k] = T;
    }
  }

  // 5. Pressure centres and the pressure field.
  pressureField(ctx, surface, s, out);

  // 6. Winds spiralling out of the highs; 7. fronts where they meet.
  winds(ctx, s, out);

  // 8. Upwelling, fog, and their cooling.
  upwelling(ctx, s, out);
  for (let k = 0; k < n; k++) {
    if (land[k]) continue;
    out.temp[k] = Math.max(-1.8, sst[k] - 6 * out.upwell[k]);
  }
  // Upwelling coasts are cooler.
  for (let k = 0; k < n; k++) {
    if (!land[k] || ctx.distSea[k] > 300) continue;
    let best = 0;
    const i0 = k % w;
    const j0 = (k / w) | 0;
    for (let dj = -3; dj <= 3; dj++) {
      for (let di = -3; di <= 3; di++) {
        let ii = i0 + di;
        const jj = j0 + dj;
        if (jj < 0 || jj >= h) continue;
        if (ii < 0 || ii >= w) {
          if (!wrap) continue;
          ii = (ii + w) % w;
        }
        best = Math.max(best, out.upwell[jj * w + ii]);
      }
    }
    out.temp[k] -= best * 4 * Math.exp(-ctx.distSea[k] / 150);
  }

  // 9. Rain.
  rain(ctx, surface, s, out, crystals);

  // 10. Sea ice and snow.
  for (let k = 0; k < n; k++) {
    const la = ctx.latOf(k);
    if (!land[k]) {
      if (out.temp[k] <= -1 && Math.abs(la) >= 45) out.ice[k] = 1;
    } else if (out.temp[k] <= 0 && out.rain[k] >= RAIN_WET * 0.6) out.snow[k] = 1;
  }
  return out;
}

/** The crystals on the map, after erasing (an erase stroke removes the crystals it touches). */
export function climateCrystals(surface: Surface): Stroke[] {
  let list: Stroke[] = [];
  for (const k of surface.strokes) {
    if (k.brush !== 'crystal') continue;
    if (!k.erase) {
      list.push(k);
      continue;
    }
    const r = k.size / 2;
    list = list.filter((c) => {
      for (let n = 0; n < k.pts.length; n += 2) if (Math.hypot(c.pts[0] - k.pts[n], c.pts[1] - k.pts[n + 1]) < r) return false;
      return true;
    });
  }
  return list;
}

/** How strongly crystals of a kind act at a place, 0–1+ (nearby crystals add together). */
function crystalEffect(list: Stroke[], x: number, y: number, kind: 'heat' | 'cold' | 'rain', ctx: Ctx): number {
  let e = 0;
  for (const k of list) {
    if ((k.crystal ?? 'heat') !== kind) continue;
    let dx = x - k.pts[0];
    if (ctx.wrap) dx -= Math.round(dx / ctx.W) * ctx.W;
    const d = Math.hypot(dx, y - k.pts[1]);
    const r = k.size / 2;
    if (d < r * 1.5) e += k.strength * (1 - smooth(r * 0.3, r * 1.5, d));
  }
  return e;
}

// ---------------------------------------------------------------------------------------------
// ITCZ (decided rules: tilt sets the limit; land pulls it toward the tilt line, wide sea lets it
// sink to its lowest point; ramps near coasts; cold eastern oceans hold it; hemisphere imbalance).

function itczPath(ctx: Ctx, s: number, out: Float32Array): void {
  const { w, h, land, lat, tilt, stepX, c, wrap } = ctx;
  if (tilt < 0.5) {
    out.fill(0);
    return;
  }
  const oceanLat = tilt * 0.21;
  // Land in the band between the equator and the tilt line in the summer hemisphere.
  const frac = new Float32Array(w);
  const hgt = new Float32Array(w);
  // How far toward the pole the land in each column reaches (within the band).
  const top = new Float32Array(w);
  const expected = Math.max(1, (tilt * ctx.kpd) / ctx.stepY);
  for (let i = 0; i < w; i++) {
    let lc = 0;
    let hs = 0;
    for (let j = 0; j < h; j++) {
      const la = lat[j] * s;
      if (la < 0 || la > tilt) continue;
      if (land[j * w + i]) {
        lc++;
        hs += ctx.height[j * w + i];
        top[i] = Math.max(top[i], la);
      }
    }
    frac[i] = Math.min(1, lc / expected);
    hgt[i] = lc ? hs / lc : 0;
  }
  // Land runs along the width of the world.
  const isLand = (i: number) => frac[i] > 0.35;
  type Run = { a: number; b: number; amp: number };
  const runs: Run[] = [];
  for (let i = 0; i < w; i++) {
    if (!isLand(i) || (i > 0 && isLand(i - 1))) continue;
    let b = i;
    while (b + 1 < w && isLand(b + 1)) b++;
    const L = (b - i + 1) * stepX;
    let hm = 0;
    for (let k = i; k <= b; k++) hm += hgt[k];
    hm /= b - i + 1;
    // Hot interiors and big plateaus pull a few degrees past the tilt line.
    runs.push({ a: i, b, amp: Math.min(1, L / c.itczLandKm) * (1 + 0.2 * Math.min(1, hm / 2)) });
  }
  if (wrap && runs.length > 1 && runs[0].a === 0 && runs[runs.length - 1].b === w - 1) {
    const last = runs.pop()!;
    runs[0] = { a: last.a - w, b: runs[0].b, amp: Math.max(last.amp, runs[0].amp) };
  }
  const A = new Float32Array(w);
  const eastSide = new Float32Array(w);
  const capLat = new Float32Array(w).fill(Infinity);
  if (runs.length) {
    // Inside land: half the run's pull at the coast, all of it in the middle.
    for (const r of runs) {
      for (let k = r.a; k <= r.b; k++) {
        const t = (k - r.a + 0.5) / (r.b - r.a + 1);
        A[(k + w) % w] = r.amp * (0.5 + 0.5 * Math.sin(Math.PI * t));
      }
    }
    // The belt follows the heated land, never past it: in each column it stops a little beyond
    // the land's furthest reach toward the pole, however wide the land is.
    for (const r of runs) {
      for (let k = r.a; k <= r.b; k++) {
        const kk = (k + w) % w;
        const cap = (top[kk] + 1.5 - oceanLat) / Math.max(1e-6, tilt - oceanLat);
        A[kk] = Math.min(A[kk], Math.max(0, cap));
        capLat[kk] = Math.max(oceanLat, top[kk] + 1.5);
      }
    }
    const coastA = (k: number) => A[(k + w) % w];
    // Seas between runs: from one coast's value to the other's, dipping in the middle if wide.
    const order = runs.slice().sort((p, q) => p.a - q.a);
    for (let r = 0; r < order.length; r++) {
      const left = order[r];
      const right = order[r + 1] ?? (wrap ? { ...order[0], a: order[0].a + w, b: order[0].b + w } : null);
      const start = left.b + 1;
      const end = right ? right.a - 1 : w - 1;
      const open = !right;
      fillSea(start, end, coastA(left.b), right ? coastA(right.a) : 0, open);
      if (r === 0 && !wrap && left.a > 0) fillSea(0, left.a - 1, 0, coastA(left.a), true);
    }
    function fillSea(a: number, b: number, va: number, vb: number, open: boolean) {
      if (b < a) return;
      const S = open ? Infinity : (b - a + 1) * stepX;
      const d = Math.min(1, S / c.itczSeaKm);
      for (let k = a; k <= b; k++) {
        const t = (k - a + 0.5) / (b - a + 1);
        const toCoast = Math.min(open && va === 0 ? Infinity : (k - a + 0.5) * stepX, open && vb === 0 ? Infinity : (b - k + 0.5) * stepX);
        const base = va + (vb - va) * t;
        const dip = d * smooth(0, c.itczRampKm, toCoast);
        A[(k + w) % w] = base * (1 - dip);
        eastSide[(k + w) % w] = vb > 0 ? smooth(0.55, 1, t) : 0;
      }
    }
  }
  // Hemisphere imbalance: more land in one hemisphere's tropics pulls both paths toward it.
  let ln = 0;
  let ls = 0;
  let tot = 0;
  for (let j = 0; j < h; j++) {
    const la = lat[j];
    if (Math.abs(la) > 30) continue;
    for (let i = 0; i < w; i++) {
      if (land[j * w + i]) {
        if (la > 0) ln++;
        else ls++;
      }
      tot++;
    }
  }
  const imbalance = tot ? Math.max(-1, Math.min(1, (ln - ls) / Math.max(1, tot * 0.25))) * 5 * Math.min(1, tilt / 10) : 0;
  const raw = new Float32Array(w);
  for (let i = 0; i < w; i++) {
    let v = s * (oceanLat + (tilt - oceanLat) * A[i]);
    // Cold water on the eastern side of oceans holds it away from the equator.
    if (eastSide[i] > 0) v = s > 0 ? Math.max(v, v + (oceanLat * 1.6 - v) * eastSide[i] * 0.6) : v + (oceanLat - v) * eastSide[i] * 0.8;
    // The hemisphere imbalance shifts the belt, but never past the tilt line (only high plateaus overshoot it).
    const lim = Math.max(tilt, Math.abs(v));
    raw[i] = Math.max(-lim, Math.min(lim, v + imbalance));
    // Over land, not past the land's reach (the shift included).
    if (Math.abs(raw[i]) > capLat[i] && Math.sign(raw[i]) === s) raw[i] = s * Math.max(capLat[i], Math.abs(v));
  }
  // Smooth so the path never zigzags.
  const radius = Math.max(1, Math.round(600 / stepX));
  let cur = raw;
  for (let p = 0; p < 2; p++) {
    const next = new Float32Array(w);
    for (let i = 0; i < w; i++) {
      let sum = 0;
      let cnt = 0;
      for (let d = -radius; d <= radius; d++) {
        let k = i + d;
        if (k < 0 || k >= w) {
          if (!wrap) continue;
          k = (k + w) % w;
        }
        sum += cur[k];
        cnt++;
      }
      next[i] = sum / cnt;
    }
    cur = next;
  }
  out.set(cur);
}

// ---------------------------------------------------------------------------------------------
// Ocean currents: placed by hand on the map (the Current brush). Major currents are the big
// ocean gyres; secondary currents are smaller ones running in and out of bays and shallow seas,
// to set the water temperature in awkward places. Each warms or cools the water near it; the
// map draws them exactly as placed. The Currents panel lists the rules to follow when drawing.

interface MajorPath {
  pts: number[];
  kind: number[];
  /** Strength of each point (secondary currents count less and reach less far). */
  str: number[];
  major: boolean;
}

/** The currents drawn on the map, as paths in km (x may run past the edges on wrapping maps). */
export function drawnCurrents(surface: Surface): MajorPath[] {
  const out: MajorPath[] = [];
  for (const st of surface.strokes) {
    if (st.brush !== 'current' || st.pts.length < 4) continue;
    const kind = st.current === 'cold' ? -1 : st.current === 'neutral' ? 0 : 1;
    const major = st.currentSize !== 'secondary';
    const n = st.pts.length / 2;
    out.push({ pts: st.pts.slice(), kind: new Array(n).fill(kind), str: new Array(n).fill(major ? 1 : 0.75), major });
  }
  return out;
}

function currents(ctx: Ctx, surface: Surface, s: number, out: SeasonClimate): void {
  const { w, h, n, land, stepX, stepY, wrap, W, c } = ctx;
  const shift = s * 2.5 * ctx.tiltF;
  const wx = (x: number) => (wrap ? ((x % W) + W) % W : x);
  const keep = drawnCurrents(surface);
  out.major = keep;

  // ---- Water temperature next to the currents ----
  const anomaly = new Float32Array(n);
  const reach = 520;
  const pg = new Map<number, number[]>();
  const pc = reach;
  const pgw = Math.ceil(W / pc) + 1;
  for (const p of keep) {
    for (let q = 0; q < p.kind.length; q++) {
      const kd = p.kind[q];
      if (!kd) continue;
      const x = wx(p.pts[q * 2]);
      const y = p.pts[q * 2 + 1];
      const key = Math.floor(y / pc) * pgw + Math.floor(x / pc);
      let l = pg.get(key);
      if (!l) pg.set(key, (l = []));
      l.push(x, y, kd * p.str[q], p.major ? 220 : 110);
    }
  }
  for (let j = 0; j < h; j++) {
    const la = ctx.lat[j];
    const al = Math.abs(la - shift);
    const warmMag = c.warmCurrentC * (0.25 + 0.6 * smooth(20, 55, al));
    const coldMag = -c.coldCurrentC * (0.55 + 0.25 * smooth(10, 40, al));
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (land[k]) continue;
      const x = (i + 0.5) * stepX;
      const y = (j + 0.5) * stepY;
      const cx = Math.floor(x / pc);
      const cy = Math.floor(y / pc);
      let best = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          let xx = cx + ox;
          if (wrap) xx = (xx + pgw) % pgw;
          const l = pg.get((cy + oy) * pgw + xx);
          if (!l) continue;
          for (let q = 0; q < l.length; q += 4) {
            let ddx = Math.abs(l[q] - x);
            if (wrap) ddx = Math.min(ddx, W - ddx);
            const d = Math.hypot(ddx, l[q + 1] - y);
            if (d > reach) continue;
            const v = l[q + 2] * (l[q + 2] > 0 ? warmMag : coldMag) * Math.exp(-d / l[q + 3]);
            if (Math.abs(v) > Math.abs(best)) best = v;
          }
        }
      }
      anomaly[k] = best;
    }
  }
  const sm = blur(anomaly, w, h, wrap, 2);
  for (let k = 0; k < n; k++) {
    if (land[k]) continue;
    out.curAnomaly[k] = sm[k];
    out.current[k] = sm[k] > 0.8 ? 1 : sm[k] < -0.8 ? -1 : 0;
  }

  // ---- A flow field for the smaller currents in bays and shallows: the major currents' pull ----
  const fu = new Float32Array(n);
  const fv = new Float32Array(n);
  const fw = new Float32Array(n);
  const R = 700;
  for (const p of keep) {
    for (let q = 1; q < p.kind.length; q++) {
      const x = wx(p.pts[q * 2]);
      const y = p.pts[q * 2 + 1];
      const dx = p.pts[q * 2] - p.pts[q * 2 - 2];
      const dy = p.pts[q * 2 + 1] - p.pts[q * 2 - 1];
      const l = Math.hypot(dx, dy) || 1;
      const ri = Math.ceil(R / stepX);
      const ci = Math.floor(x / stepX);
      const cj = Math.floor(y / stepY);
      for (let oj = -ri; oj <= ri; oj += 2) {
        const jj = cj + oj;
        if (jj < 0 || jj >= h) continue;
        for (let oi = -ri; oi <= ri; oi += 2) {
          let ii = ci + oi;
          if (ii < 0 || ii >= w) {
            if (!wrap) continue;
            ii = (ii + w) % w;
          }
          const k = jj * w + ii;
          if (land[k]) continue;
          const d = Math.hypot(oi * stepX, oj * stepY);
          if (d > R) continue;
          const wt = Math.exp(-d / 250);
          fu[k] += (dx / l) * wt;
          fv[k] += (-dy / l) * wt;
          fw[k] += wt;
        }
      }
    }
  }
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) mask[k] = land[k] ? 0 : 1;
  for (let k = 0; k < n; k++) {
    if (land[k]) continue;
    // Far from any current: the wind belts' drift.
    const b = belt(ctx, ctx.latOf(k), s);
    const drift = 0.08;
    fu[k] = fw[k] > 0 ? fu[k] / (fw[k] + 0.05) : 0;
    fv[k] = fw[k] > 0 ? fv[k] / (fw[k] + 0.05) : 0;
    fu[k] += b.u * drift;
    fv[k] += b.v * drift;
  }
  let su: Float32Array = fu;
  let sv: Float32Array = fv;
  for (let p = 0; p < 3; p++) {
    su = maskedBlur(su, mask, w, h, wrap, 2);
    sv = maskedBlur(sv, mask, w, h, wrap, 2);
    // Never into the land.
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (land[k] || ctx.distLand[k] > stepX * 3) continue;
        const into = su[k] * ctx.toLandX[k] + sv[k] * ctx.toLandY[k];
        if (into > 0) {
          su[k] -= into * ctx.toLandX[k];
          sv[k] -= into * ctx.toLandY[k];
        }
      }
    }
  }
  out.curU.set(su);
  out.curV.set(sv);
}

/** Average over sea points only, a few passes. */
function maskedBlur(src: Float32Array, mask: Uint8Array, w: number, h: number, wrap: boolean, passes: number): Float32Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (!mask[k]) continue;
        let sum = 0;
        let cnt = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= h) continue;
          for (let di = -1; di <= 1; di++) {
            let ii = i + di;
            if (ii < 0 || ii >= w) {
              if (!wrap) continue;
              ii = (ii + w) % w;
            }
            const kk = jj * w + ii;
            if (!mask[kk]) continue;
            sum += a[kk];
            cnt++;
          }
        }
        b[k] = cnt ? sum / cnt : a[k];
      }
    }
    a = b;
  }
  return a;
}

function flowPaths(cl: Climate, se: SeasonClimate, W: number, H: number): void {
  // Winds: six channels spiral out of each high, following the wind (turned by mountains and by
  // the other highs' air), until they meet another high's air at a front, run into the ITCZ, or fade.
  const channels: FlowPath[] = [];
  const highs = se.centres.filter((c) => c.kind === 'high' && c.reach);
  const rowKm = H / cl.h;
  const kpd = rowKm / Math.max(1e-6, Math.abs(cl.lat[0] - cl.lat[1]));
  const latAt = (y: number) => cl.lat[0] + (rowKm / 2 - y) / kpd;
  const itczAt = (x: number) => se.itcz[Math.max(0, Math.min(cl.w - 1, Math.floor((((x % W) + W) % W) / cl.step)))];
  for (const c of highs) {
    const R = c.reach!;
    const step = Math.max(30, Math.min(120, R / 30));
    for (let a = 0; a < 6; a++) {
      const ang = (a * Math.PI) / 3;
      let x = c.x + Math.cos(ang) * R * 0.22;
      let y = c.y - Math.sin(ang) * R * 0.22;
      const pts = [x, y];
      let len = 0;
      for (let t = 0; t < 600; t++) {
        const xx = cl.wrapKm ? ((x % W) + W) % W : x;
        if (y < 0 || y > H || (!cl.wrapKm && (x < 0 || x > W))) break;
        const u = sampleField(cl, se.windU, xx, y);
        const v = sampleField(cl, se.windV, xx, y);
        const sp = Math.hypot(u, v);
        if (sp < 0.04) break;
        x += (u / sp) * step;
        y -= (v / sp) * step;
        len += step;
        pts.push(x, y);
        if (len > R * 3.5) break;
        if (len > R * 0.4) {
          const xw = cl.wrapKm ? ((x % W) + W) % W : x;
          if (xw >= 0 && xw <= W && y >= 0 && y <= H && sampleField(cl, se.front, xw, y) > 0.45) break;
          if (Math.abs(latAt(y) - itczAt(x)) < 1.5) break;
          let near = false;
          for (const o of highs) {
            let dx = x - o.x;
            if (cl.wrapKm) dx -= Math.round(dx / W) * W;
            if (Math.hypot(dx, y - o.y) < o.reach! * (o === c ? 0.15 : 0.3)) near = true;
          }
          if (near) break;
        }
      }
      if (pts.length >= 8) channels.push({ pts: Float32Array.from(pts), kind: new Int8Array(pts.length / 2), major: true });
    }
  }
  se.windPaths = [channels, channels];
  // Currents are drawn by hand and shown as drawn, so there are no traced current paths.
  se.currentPaths = [[], []];
}

// ---------------------------------------------------------------------------------------------
// Pressure: the high-pressure zones placed on the map (the High pressure brush), plus the low
// trough along the ITCZ. Lows aren't placed: air simply flows out of the highs.

/** The placed highs holding in this season (s: 1 northern summer, −1 northern winter). */
export function placedHighs(surface: Surface, s: number): Stroke[] {
  return surface.strokes.filter((st) => st.brush === 'high' && st.pts.length >= 2 && (st.highSeason ?? 'both') !== (s > 0 ? 'winter' : 'summer'));
}

function pressureField(ctx: Ctx, surface: Surface, s: number, out: SeasonClimate): void {
  const { w, h, stepX, stepY, W, lat } = ctx;
  for (const st of placedHighs(surface, s)) {
    const reach = Math.max(200, st.size);
    out.centres.push({ kind: 'high', name: 'High pressure', x: st.pts[0], y: st.pts[1], amp: 12 * st.strength, sx: reach * 0.55, sy: reach * 0.55, id: st.id, strength: st.strength, reach });
  }
  for (let j = 0; j < h; j++) {
    const y = (j + 0.5) * stepY;
    const la = lat[j];
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * stepX;
      let p = -4 * gauss(la - out.itcz[i], 8);
      for (const cc of out.centres) {
        let dx = x - cc.x;
        if (ctx.wrap) dx -= Math.round(dx / W) * W;
        const dy = y - cc.y;
        const q = (dx * dx) / (cc.sx * cc.sx) + (dy * dy) / (cc.sy * cc.sy);
        if (q < 9) p += cc.amp * Math.exp(-q);
      }
      out.pressure[j * w + i] = p;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Winds: from high to low, turned by rotation; flipped across the equator; steered by ranges.

function winds(ctx: Ctx, s0: number, out: SeasonClimate): void {
  const { w, h, n, stepX, stepY, lat, s, wrap, height, W } = ctx;
  const dayF = Math.pow(24 / Math.max(4, s.dayLengthHours), 0.3);
  const sizeF = Math.pow(climateRadiusKm(s) / 6371, 0.3);
  const thetaMax = Math.min(82, 62 * dayF * sizeF) * RAD;
  // The ranges as the wind feels them: broad, so it starts turning before it reaches the slope.
  const hb = blur(height, w, h, wrap, Math.max(1, Math.round(120 / stepX)));
  const highs = out.centres.filter((c) => c.kind === 'high' && c.reach);
  // Where the air of two highs meets head on: a front.
  const meet = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    const la = lat[j];
    const y = (j + 0.5) * stepY;
    const theta = thetaMax * smooth(0, 1, Math.abs(Math.sin(la * RAD)) / Math.sin(18 * RAD)) * Math.sign(la);
    const cs = Math.cos(theta);
    const sn = Math.sin(theta);
    // Far from any high, a light drift of the wind belts (toward the ITCZ in the tropics).
    const bt = belt(ctx, la, s0);
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const il = i > 0 ? k - 1 : wrap ? k + w - 1 : k;
      const ir = i < w - 1 ? k + 1 : wrap ? k - w + 1 : k;
      const ju = j > 0 ? k - w : k;
      const jd = j < h - 1 ? k + w : k;
      const x = (i + 0.5) * stepX;
      let fx = bt.u * 0.35;
      let fy = bt.v * 0.35;
      // Each high: air flowing out of it, turned right in the north and left in the south, so it
      // spirals out (calm at the centre, strongest part-way out, fading at its reach).
      let m1 = 0;
      let m2 = 0;
      let a1x = 0;
      let a1y = 0;
      let a2x = 0;
      let a2y = 0;
      for (const c of highs) {
        let dx = x - c.x;
        if (wrap) dx -= Math.round(dx / W) * W;
        const dn = c.y - y;
        const d = Math.hypot(dx, dn);
        const R = c.reach!;
        if (d > R * 2.2 || d < 1) continue;
        const f = (1 - Math.exp(-((d / (0.22 * R)) ** 2))) * Math.exp(-((d / R) ** 2));
        const m = 3 * c.strength! * f;
        const ox = dx / d;
        const oy = dn / d;
        const vx = (ox * cs + oy * sn) * m;
        const vy = (-ox * sn + oy * cs) * m;
        fx += vx;
        fy += vy;
        if (m > m1) {
          m2 = m1;
          a2x = a1x;
          a2y = a1y;
          m1 = m;
          a1x = vx / m;
          a1y = vy / m;
        } else if (m > m2) {
          m2 = m;
          a2x = vx / m;
          a2y = vy / m;
        }
      }
      if (m2 > 0) meet[k] = (m2 / m1) * Math.max(0, -(a1x * a2x + a1y * a2y)) * Math.min(1, m2 / 0.6);
      // Mountains steer the wind: it turns to run along a range instead of over it, and slows over high ground.
      const hx = (hb[ir] - hb[il]) / (2 * stepX);
      const hy = (hb[ju] - hb[jd]) / (2 * stepY);
      const hl = Math.hypot(hx, hy);
      if (hl > 1e-5) {
        const nx = hx / hl;
        const ny = hy / hl;
        const into = fx * nx + fy * ny;
        const k2 = smooth(0.25, 2, hb[k]) * 0.9;
        if (into > 0) {
          // Climbing: turned aside along the slope, keeping its speed.
          const sp = Math.hypot(fx, fy);
          fx -= into * nx * k2;
          fy -= into * ny * k2;
          const sp2 = Math.hypot(fx, fy) || 1;
          const keep = 1 - 0.4 * k2;
          fx *= (sp / sp2) * keep;
          fy *= (sp / sp2) * keep;
        } else {
          // Coming down the far side: a sheltered, calmer lee.
          fx *= 1 - 0.35 * k2;
          fy *= 1 - 0.35 * k2;
        }
      }
      const slow = 1 - 0.45 * smooth(1.2, 4, height[k]);
      fx *= slow;
      fy *= slow;
      out.windU[k] = fx;
      out.windV[k] = fy;
    }
  }
  // Fronts: where the air of two highs meets (smoothed), plus a little where air masses differ.
  const mt = blur(meet, w, h, wrap, 2);
  const grad = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const il = i > 0 ? k - 1 : wrap ? k + w - 1 : k;
      const ir = i < w - 1 ? k + 1 : wrap ? k - w + 1 : k;
      const ju = j > 0 ? k - w : k;
      const jd = j < h - 1 ? k + w : k;
      grad[k] = Math.hypot((out.temp[ir] - out.temp[il]) / (2 * stepX), (out.temp[ju] - out.temp[jd]) / (2 * stepY)) * 1000;
    }
  }
  const gr = blur(grad, w, h, wrap, 3);
  for (let k = 0; k < n; k++) out.front[k] = Math.min(1, mt[k] * 1.6 + Math.min(1, gr[k] / 12) * 0.25 * Math.min(1, mt[k] * 4 + 0.3));
}

// ---------------------------------------------------------------------------------------------
// Upwelling: wind along a coast pushing surface water out to sea; plus the cold strip along the
// equator on the eastern side of oceans. The countercurrent's landfall cancels it.

function upwelling(ctx: Ctx, s: number, out: SeasonClimate): void {
  const { w, n, land, distLand, distDeep, toLandX, toLandY } = ctx;
  let wmax = 1e-6;
  for (let k = 0; k < n; k++) wmax = Math.max(wmax, Math.hypot(out.windU[k], out.windV[k]));
  for (let k = 0; k < n; k++) {
    if (land[k]) continue;
    const la = ctx.latOf(k);
    const u = out.windU[k] / wmax;
    const v = out.windV[k] / wmax;
    let up = 0;
    if (distLand[k] < 350) {
      // Surface water moves to the right of the wind in the north, to the left in the south.
      const tx = la >= 0 ? v : -v;
      const ty = la >= 0 ? -u : u;
      const offshore = -(tx * toLandX[k] + ty * toLandY[k]);
      const shelfNarrow = 1 - smooth(60, 400, distDeep[k] + distLand[k] * 0.5);
      up = Math.max(0, offshore) * 2.2 * (0.5 + 0.5 * shelfNarrow) * (out.current[k] === -1 ? 1.4 : 1) * Math.exp(-distLand[k] / 250);
    }
    // Equatorial upwelling on the eastern side of oceans, under the trades.
    if (Math.abs(la) < 6 && u < 0 && toLandX[k] > 0.2 && distLand[k] < 3000) up += 0.5 * gauss(la, 3);
    // Cancelled where the countercurrent lands.
    if (out.curAnomaly[k] > 1.5 && Math.abs(la - out.itcz[k % w]) < 5) up = 0;
    out.upwell[k] = Math.min(1, up);
  }
  const sm = blur(out.upwell, w, ctx.h, ctx.wrap, 1);
  for (let k = 0; k < n; k++) {
    if (land[k]) continue;
    out.upwell[k] = sm[k];
    const la = ctx.latOf(k);
    const summerHere = Math.sign(la) === s;
    out.fog[k] = smooth(0.2, 0.6, out.upwell[k]) * (summerHere ? 1 : 0.6) * Math.exp(-distLand[k] / 140);
  }
}

// ---------------------------------------------------------------------------------------------
// Rain: moisture from the sea carried along the winds, dropped on windward slopes, at the ITCZ
// and fronts, held back under highs; dry behind ranges.

function rain(ctx: Ctx, surface: Surface, s: number, out: SeasonClimate, crystals: Stroke[]): void {
  const { w, h, n, land, stepX, stepY, lat, wrap, c, height } = ctx;
  const mult = ctx.s.rainfall.mode === 'manual' ? ctx.s.rainfall.percent / 100 : Math.max(0.3, 1 + 0.03 * ctx.avgShift);
  const carry = c.moistureCarryKm * (0.6 + 0.4 * mult);
  // Moisture over the sea, from its temperature; cold upwelling water gives little.
  const src = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (land[k]) continue;
    src[k] = Math.max(0.05, Math.min(1.1, (out.temp[k] + 2) / 28)) ** 1.2 * (1 - 0.75 * out.upwell[k]) * (out.ice[k] ? 0.2 : 1);
  }
  let wmax = 1e-6;
  for (let k = 0; k < n; k++) wmax = Math.max(wmax, Math.hypot(out.windU[k], out.windV[k]));
  // Upwind sample positions (one step back along the wind).
  const step = Math.min(stepX, stepY);
  const back = new Int32Array(n * 2).fill(-1);
  const backW = new Float32Array(n * 2);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let u = out.windU[k];
      let v = out.windV[k];
      const len = Math.hypot(u, v);
      if (len < wmax * 0.03) {
        const b = belt(ctx, lat[j], s);
        u = b.u;
        v = b.v;
      }
      const l2 = Math.hypot(u, v) || 1;
      const fx = i - (u / l2) * (step / stepX);
      const fy = j + (v / l2) * (step / stepY);
      // Nearest two neighbours, weighted (enough for a smooth trace).
      const i0 = Math.floor(fx);
      const j0 = Math.round(fy);
      const tx = fx - i0;
      for (let q = 0; q < 2; q++) {
        let ii = i0 + q;
        if (j0 < 0 || j0 >= h) continue;
        if (ii < 0 || ii >= w) {
          if (!wrap) continue;
          ii = (ii + w) % w;
        }
        back[k * 2 + q] = j0 * w + ii;
        backW[k * 2 + q] = q === 0 ? 1 - tx : tx;
      }
    }
  }
  const q = new Float32Array(n);
  for (let k = 0; k < n; k++) q[k] = land[k] ? 0 : src[k];
  const r = out.rain;
  // Everything that doesn't change between passes, worked out once.
  const baseRate = new Float32Array(n);
  const liftAt = new Float32Array(n);
  const warmAt = new Float32Array(n);
  const landIdx: number[] = [];
  // Cold coasts: air over cold currents and upwelling is stable, so the tropical rains stop short of the shore.
  const coldSea = new Float32Array(n);
  for (let k = 0; k < n; k++) if (!land[k]) coldSea[k] = Math.max(0, -out.curAnomaly[k]) + 4 * out.upwell[k];
  const coldNear = blur(coldSea, w, h, wrap, Math.max(1, Math.round(450 / step)));
  // Ranges as the air feels them: it starts to rise a little before the slope.
  const hr = blur(height, w, h, wrap, Math.max(1, Math.round(50 / step)));
  for (let k = 0; k < n; k++) hr[k] = Math.max(hr[k], height[k] * 0.85);
  const lee = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (!land[k]) continue;
    landIdx.push(k);
    let hu = 0;
    let wsum = 0;
    for (let p = 0; p < 2; p++) {
      const b = back[k * 2 + p];
      if (b < 0) continue;
      hu += backW[k * 2 + p] * hr[b];
      wsum += backW[k * 2 + p];
    }
    if (wsum > 0) hu /= wsum;
    const la = lat[(k / w) | 0];
    const he = hr[k];
    // Windward slopes: rising air drops its moisture (starting on the approach); very high ground is dry air.
    const rise = Math.max(0, he - hu);
    // The lee: sinking air warms and dries, so little falls even from moist air.
    lee[k] = Math.min(0.8, Math.max(0, hu - he) * 2.5);
    const block = c.blockingReliefKm * (3 - 2 * smooth(15, 50, Math.abs(la)));
    liftAt[k] = Math.min(0.85, rise * 0.9 + (he > block && rise > 0 ? 0.25 : 0)) * Math.exp(-Math.max(0, he - 2) / 2);
    const itcz = gauss(la - out.itcz[k % w], 9);
    const sup = Math.max(0, Math.min(0.92, (out.pressure[k] - 0.5) / 4.5));
    const conv = Math.max(0, Math.min(1, out.front[k]));
    const warm = smooth(15, 26, out.temp[k]);
    warmAt[k] = warm;
    // Storms in the westerlies (mid-latitude lows along the polar front).
    const storms = belt(ctx, la, s).band % 2 === 1 ? 0.3 : 0;
    // Rain rate (per 1,000 km of travel) from the air's moisture: everywhere a little, much
    // more at the ITCZ, fronts and in westerly storms, from warm tropical land; little under highs.
    const cold = smooth(0.2, 1.2, coldNear[k]) * Math.exp(-ctx.distSea[k] / 900) * (1 - smooth(30, 40, Math.abs(la)));
    baseRate[k] = (0.35 + storms + (1.5 * itcz + 0.5 * warm * gauss(la, 12)) * (1 - 0.85 * cold) + 0.7 * conv) * (1 - sup) * (1 - 0.5 * cold) * (1 - lee[k]);
  }
  const iters = Math.min(260, Math.ceil(Math.max(ctx.W, ctx.H) / step) + 10);
  const decay = Math.exp(-step / carry);
  const lossPerStep = 0.3 * (step / 1000);
  for (let it = 0; it < iters; it++) {
    let change = 0;
    for (const k of landIdx) {
      // Air arriving from upwind: off the map counts as open sea.
      let qa = 0;
      let wsum = 0;
      for (let p = 0; p < 2; p++) {
        const b = back[k * 2 + p];
        const wt = backW[k * 2 + p];
        if (b < 0) qa += wt * 0.8 * mult;
        else qa += wt * (land[b] ? q[b] : src[b] * mult);
        wsum += wt;
      }
      if (wsum > 0) qa /= wsum;
      // A little moisture also spreads from all sides, so places where winds meet (and trace
      // back to each other rather than to the sea) still get moist air.
      {
        const i = k % w;
        const j = (k / w) | 0;
        let nb = 0;
        let nc = 0;
        for (const [di, dj] of NB4) {
          let ii = i + di;
          const jj = j + dj;
          if (jj < 0 || jj >= h || ii < 0 || ii >= w) {
            if (jj >= 0 && jj < h && wrap) ii = (ii + w) % w;
            else {
              nb += 0.8 * mult;
              nc++;
              continue;
            }
          }
          const kk = jj * w + ii;
          nb += land[kk] ? q[kk] : src[kk] * mult;
          nc++;
        }
        qa = qa * 0.85 + (nb / nc) * 0.15;
      }
      const liftF = liftAt[k];
      const rate = qa * baseRate[k];
      r[k] = rate + qa * liftF * 1.5;
      // Wet, green land hands much of its rain back to the air; dry land doesn't.
      const recycle = 0.2 + 0.55 * smooth(0.1, 0.45, r[k]) * (0.5 + 0.5 * warmAt[k]);
      const next = Math.max(0, qa - rate * lossPerStep * (1 - recycle) - qa * liftF * 0.85) * Math.pow(decay, 1 / (1 + recycle));
      change = Math.max(change, Math.abs(next - q[k]));
      q[k] = next;
    }
    if (it > 10 && change < 1e-4) break;
  }
  // The polar front belt brings rain to all coasts within reach, even with offshore wind.
  const pf = (ctx.edges[1] ?? ctx.edges[0] + 30) - 15;
  for (let k = 0; k < n; k++) {
    if (!land[k]) {
      r[k] = 0;
      continue;
    }
    const la = Math.abs(ctx.latOf(k));
    const summerHere = Math.sign(ctx.latOf(k)) === s;
    const belt = smooth(pf - (summerHere ? 0 : 10), pf + 5 - (summerHere ? 0 : 10), la) * (1 - smooth(70, 80, la));
    // Storms along the polar front reach all coasts within range, as long as mountains haven't wrung the air dry.
    let shadow = 0;
    if (belt > 0.01) {
      // High ground upwind (along the storm track) shelters this place.
      const b = ctx.latOf(k) >= 0 ? 1 : -1;
      const bu = belt0(ctx, ctx.latOf(k), s);
      const len = Math.hypot(bu.u, bu.v) || 1;
      let x = k % w;
      let y = (k / w) | 0;
      let hmax = 0;
      for (let t = 1; t * step < 1500; t++) {
        x -= bu.u / len;
        y += bu.v / len;
        let xi = Math.round(x);
        const yi = Math.round(y);
        if (yi < 0 || yi >= h) break;
        if (xi < 0 || xi >= w) {
          if (!wrap) break;
          xi = (xi + w) % w;
        }
        const kk = yi * w + xi;
        if (!land[kk]) break;
        hmax = Math.max(hmax, height[kk]);
      }
      void b;
      shadow = smooth(0.6, 2.5, hmax - height[k]);
    }
    r[k] += 0.2 * belt * Math.exp(-ctx.distSea[k] / 2500) * mult * (1 - 0.85 * shadow);
    r[k] += 0.6 * crystalEffect(crystals, ((k % w) + 0.5) * stepX, (((k / w) | 0) + 0.5) * stepY, 'rain', ctx);
  }
  // Land-only blur, so coasts don't pick up the sea's zero.
  const lw = new Float32Array(n);
  for (let k = 0; k < n; k++) lw[k] = land[k];
  const passes = Math.max(1, Math.round(60 / step));
  const sm = blur(r, w, h, wrap, passes);
  const sw = blur(lw, w, h, wrap, passes);
  for (let k = 0; k < n; k++) if (land[k]) r[k] = sw[k] > 0 ? sm[k] / sw[k] : r[k];
  void surface;
}

// ---------------------------------------------------------------------------------------------
// Climate zones from both seasons (decided rules, Köppen groups).

function zones(ctx: Ctx, a: SeasonClimate, b: SeasonClimate): Int8Array {
  const { w, h, n, land, lat, stepX, wrap } = ctx;
  const zone = new Int8Array(n).fill(-1);
  const desert = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (!land[k]) continue;
    const north = ctx.latOf(k) >= 0;
    const sum = north ? a : b;
    const win = north ? b : a;
    const Ts = Math.max(sum.temp[k], win.temp[k]);
    const Tw = Math.min(sum.temp[k], win.temp[k]);
    const rs = rainClass(sum.rain[k]);
    const rw = rainClass(win.rain[k]);
    const mean = (Ts + Tw) / 2;
    let z: number;
    if (Ts < 0) z = 13;
    else if (Ts < 10) z = 12;
    else if (rs === 0 && rw === 0) {
      z = mean >= 18 ? 3 : 4;
      desert[k] = 1;
    } else if (Tw >= 18) {
      // Tropical: rainforest wet all year, monsoon with a short dry season, savanna with a long one.
      const rMin = Math.min(sum.rain[k], win.rain[k]);
      const rMax = Math.max(sum.rain[k], win.rain[k]);
      if (rMin >= RAIN_WET * 2) z = 0;
      else if (rMax >= RAIN_VERY_WET && rMin >= RAIN_WET * 0.6) z = 1;
      else z = 2;
    } else if (Tw >= 0) {
      if (rs === 0 && rw >= 1) z = 7;
      else z = Ts >= 22 ? 8 : 9;
    } else z = Ts >= 19 ? 10 : 11;
    zone[k] = z;
  }
  // Steppe borders around deserts (wider away from the tropics), and dry margins.
  const dd = distanceField(w, h, stepX, wrap, (k) => desert[k] === 1, false);
  for (let k = 0; k < n; k++) {
    const z = zone[k];
    if (z < 0 || desert[k] || z >= 12) continue;
    const la = Math.abs(lat[(k / w) | 0]);
    const border = 160 * (la < 25 ? 1 : 2) * (ctx.height[k] > 1.5 ? 0.5 : 1);
    const north = ctx.latOf(k) >= 0;
    const minRain = Math.min(a.rain[k], b.rain[k]);
    const maxRain = Math.max(north ? a.rain[k] : b.rain[k], north ? b.rain[k] : a.rain[k]);
    if ((dd[k] <= border && minRain < RAIN_WET && maxRain < RAIN_VERY_WET) || (maxRain < RAIN_WET * 1.6 && minRain < RAIN_WET && z !== 7)) {
      const mean = (a.temp[k] + b.temp[k]) / 2;
      zone[k] = mean >= 18 ? 5 : 6;
    }
  }
  return zone;
}

// ---------------------------------------------------------------------------------------------
// Coral reefs: shallow sea inside the reefs' temperature range all year, no winter upwelling,
// away from big river mouths.

function reefs(ctx: Ctx, surface: Surface, a: SeasonClimate, b: SeasonClimate): Uint8Array {
  const { w, n, ground, c, stepX, stepY } = ctx;
  const reef = new Uint8Array(n);
  const mouths: { x: number; y: number; r: number }[] = [];
  for (const r of riverNetwork(surface).values()) {
    const p = r.stroke.pts;
    const width = widthForFlow(flowAt(r, r.total));
    mouths.push({ x: p[p.length - 2], y: p[p.length - 1], r: 20 + 120 * width });
  }
  for (let k = 0; k < n; k++) {
    if (ground[k] < 0.5 || ground[k] >= 1.5) continue;
    const la = ctx.latOf(k);
    const north = la >= 0;
    const win = north ? b : a;
    const cold = Math.min(a.temp[k], b.temp[k]);
    const hot = Math.max(a.temp[k], b.temp[k]);
    if (cold < c.reefMinC || hot > c.reefMaxC) continue;
    if (win.upwell[k] > 0.25 && !(Math.abs(la) < 5 && cold >= 27)) continue;
    const x = ((k % w) + 0.5) * stepX;
    const y = (((k / w) | 0) + 0.5) * stepY;
    if (mouths.some((m) => Math.hypot(m.x - x, m.y - y) < m.r)) continue;
    reef[k] = 1;
  }
  return reef;
}

// ---------------------------------------------------------------------------------------------
// Reading the climate at a place.

export interface ClimateAt {
  zone: number;
  summerT: number;
  winterT: number;
  summerRain: number;
  winterRain: number;
  land: boolean;
}

/** Bilinear sample of a field at x, y km. */
export function sampleField(cl: Climate, arr: Float32Array, x: number, y: number): number {
  const fx = (x - cl.x0) / cl.step;
  const fy = Math.max(0, Math.min(cl.h - 1, (y - cl.y0) / cl.step));
  const i0 = Math.floor(fx);
  const j0 = Math.min(cl.h - 2, Math.floor(fy));
  const tx = fx - i0;
  const ty = fy - Math.max(0, j0);
  const col = (i: number) => (cl.wrapKm ? ((i % cl.w) + cl.w) % cl.w : Math.max(0, Math.min(cl.w - 1, i)));
  const r0 = Math.max(0, j0) * cl.w;
  const r1 = Math.min(cl.h - 1, Math.max(0, j0) + 1) * cl.w;
  const a = arr[r0 + col(i0)];
  const b = arr[r0 + col(i0 + 1)];
  const c2 = arr[r1 + col(i0)];
  const d = arr[r1 + col(i0 + 1)];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d * tx) * ty;
}

/** Nearest climate point to x, y km. */
export function nearestPoint(cl: Climate, x: number, y: number): number {
  let i = Math.floor(x / cl.step);
  if (cl.wrapKm) i = ((i % cl.w) + cl.w) % cl.w;
  i = Math.max(0, Math.min(cl.w - 1, i));
  const j = Math.max(0, Math.min(cl.h - 1, Math.floor(y / cl.step)));
  return j * cl.w + i;
}

/** The climate at a place (nearest point for the zone, blended temperatures and rain). */
export function climateAt(cl: Climate, x: number, y: number): ClimateAt {
  const k = nearestPoint(cl, x, y);
  const north = cl.lat[(k / cl.w) | 0] >= 0;
  const sum = north ? cl.summer : cl.winter;
  const win = north ? cl.winter : cl.summer;
  return {
    zone: cl.zone[k],
    summerT: sampleField(cl, sum.temp, x, y),
    winterT: sampleField(cl, win.temp, x, y),
    summerRain: sampleField(cl, sum.rain, x, y),
    winterRain: sampleField(cl, win.rain, x, y),
    land: cl.land[k] === 1,
  };
}
