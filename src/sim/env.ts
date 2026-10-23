import type { Climate } from '../core/climate';
import { COVER_BRUSHES } from '../core/paint';
import type { Beast, Library } from '../core/library';
import { freshWaters } from '../core/geography';
import type { Surface } from '../core/paint';

/**
 * What the land offers the first peoples, on the climate's points: plant food by season, fresh
 * water, coasts, mountain zones, and where each beast can live (its carrying capacity).
 *
 * Food is counted in person-months: one is what an ordinary (Medium) person eats in a month.
 */

/** Plant food at best (person-months per km² per month): rich land feeds about a third of a forager per km². */
export const PLANT_K = 0.3;
/** Game at full density (person-months per km², standing stock). */
export const MEAT_K = 4;

const COVER_FOOD: Record<string, number> = {
  forest: 1,
  jungle: 1.1,
  grassland: 1,
  tundra: 0.35,
  marsh: 1.1,
  dunes: 0.08,
  badlands: 0.2,
  saltflats: 0.05,
  glacier: 0,
  beach: 0.5,
  savanna: 1,
  scrub: 0.7,
  taiga: 0.6,
  steppe: 0.8,
  rockdesert: 0.15,
};

export interface BeastInfo {
  id: string;
  name: string;
  /** Lives in water (fish, whales) rather than on land. */
  water: boolean;
  /** Person-months of meat at full density per km², and how well hunters take it (1 easy … lower is harder). */
  meat: number;
  catchRate: number;
  /** Monthly regrowth rate. */
  regrow: number;
}

export interface Env {
  w: number;
  h: number;
  n: number;
  step: number;
  x0: number;
  y0: number;
  wrapKm: number;
  cellArea: number;
  land: Uint8Array;
  /** Plant food per km² per month: [northern summer, northern winter]. */
  plant: [Float32Array, Float32Array];
  /** Air temperature (°C): [northern summer, northern winter]. */
  temp: [Float32Array, Float32Array];
  /** Fresh water (river or lake) at the point, and sea coast. */
  fresh: Uint8Array;
  coast: Uint8Array;
  /** Mountain zone: 0 lowland, 1 foothills, 2 highlands, 3 high mountains, 4 peaks. */
  mzone: Uint8Array;
  lat: Float32Array;
  /** Where each beast can live (0–1), and how it is hunted. */
  beastK: Record<string, Float32Array>;
  beastInfo: BeastInfo[];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const SIZE_MEAT: Record<string, number> = { Tiny: 0.5, Small: 0.4, Medium: 0.6, Large: 0.7, Giant: 0.5 };

/** The mountain zone of a climate height (km). */
export const mountainZone = (hk: number) => (hk < 0.3 ? 0 : hk < 1 ? 1 : hk < 2.2 ? 2 : hk < 3.7 ? 3 : 4);

export function buildEnv(cl: Climate, lib: Library, surface: Surface): Env {
  const { w, h, step } = cl;
  const n = w * h;
  const plant: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const temp: [Float32Array, Float32Array] = [cl.summer.temp, cl.winter.temp];
  const mzone = new Uint8Array(n);
  const coast = new Uint8Array(n);
  const fresh = new Uint8Array(n);
  const lat = new Float32Array(n);
  const cellAt = (x: number, y: number) => {
    let i = Math.round((x - cl.x0) / step);
    const j = Math.round((y - cl.y0) / step);
    if (j < 0 || j >= h) return -1;
    if (i < 0 || i >= w) {
      if (!cl.wrapKm) return -1;
      i = ((i % w) + w) % w;
    }
    return j * w + i;
  };
  for (let k = 0; k < n; k++) {
    lat[k] = cl.lat[(k / w) | 0];
    if (!cl.land[k]) continue;
    mzone[k] = mountainZone(cl.height[k]);
    // Coast: sea right next to it (the map's own edge is not a coast).
    const i0 = k % w;
    const j0 = (k / w) | 0;
    for (let dj = -1; dj <= 1 && !coast[k]; dj++) for (let di = -1; di <= 1; di++) {
      const j = j0 + dj;
      let i = i0 + di;
      if (j < 0 || j >= h) continue;
      if (i < 0 || i >= w) {
        if (!cl.wrapKm) continue;
        i = (i + w) % w;
      }
      if (!cl.land[j * w + i]) {
        coast[k] = 1;
        break;
      }
    }
    const cover = cl.cover.main[k] >= 0 ? COVER_BRUSHES[cl.cover.main[k]] : 'grassland';
    const cf = COVER_FOOD[cover] ?? 0.8;
    for (const [s, se] of [[0, cl.summer], [1, cl.winter]] as const) {
      const warm = smooth(0, 18, se.temp[k]);
      const wet = smooth(0.02, 0.35, se.rain[k]);
      plant[s][k] = PLANT_K * warm * (0.15 + 0.85 * wet) * cf + (coast[k] ? 0.03 : 0);
    }
  }
  // Fresh water: rivers and lakes as painted.
  const fw = freshWaters(surface);
  for (const r of fw.rivers) for (let q = 0; q < r.pts.length; q += 2) {
    const k = cellAt(r.pts[q], r.pts[q + 1]);
    if (k >= 0) fresh[k] = 1;
  }
  for (const l of fw.lakes) for (let d = 0; d < l.dabs.length; d += 3) {
    const k = cellAt(l.dabs[d], l.dabs[d + 1]);
    if (k >= 0) fresh[k] = 1;
  }

  // Beasts: where each can live, from its preferred climates, ground cover and mountain zones.
  const beastK: Record<string, Float32Array> = {};
  const beastInfo: BeastInfo[] = [];
  const toLand = distanceToLand(cl);
  for (const b of lib.beasts) {
    const p = b.profile;
    const water = p.movement.includes('Swims') && !p.movement.includes('Walks');
    const K = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const onLand = cl.land[k] === 1;
      if (water) {
        if (onLand && !fresh[k]) continue;
        // In the sea: open water for the biggest, near coasts for the rest.
        const big = b.size === 'Giant';
        if (!onLand && !big && toLand[k] > 400) continue;
        const z = waterZone(cl.summer.temp[k] * 0.5 + cl.winter.temp[k] * 0.5);
        K[k] = (p.climates.length ? (p.climates.some((c) => zoneGroup(c) === z) ? 1 : 0.2) : 1) * (cl.summer.ice[k] && cl.winter.ice[k] ? 0.3 : 1);
        continue;
      }
      if (!onLand) continue;
      const zone = cl.zone[k];
      const cover = cl.cover.main[k] >= 0 ? COVER_BRUSHES[cl.cover.main[k]] : '';
      const cm = p.climates.length ? (p.climates.includes(zone) ? 1 : 0.1) : 1;
      const vm = p.covers.length ? (p.covers.includes(cover) ? 1 : 0.3) : 1;
      const zm = p.mountainZones.length ? (p.mountainZones.includes(mzone[k]) ? 1 : 0.1) : mzone[k] <= 2 ? 1 : 0.3;
      const food = Math.min(1, ((plant[0][k] + plant[1][k]) / 2 / PLANT_K) * 1.5);
      const diet = p.diet === 'Plants' ? 0.25 + 0.75 * food : 0.5 + 0.5 * food;
      K[k] = cm * vm * zm * diet;
    }
    beastK[b.id] = K;
    beastInfo.push({ id: b.id, name: b.name, water, meat: meatOf(b), catchRate: 1 / Math.max(1, b.hunting ?? 2), regrow: b.traits.includes('fertile') ? 0.14 : 0.08 });
  }
  return { w, h, n, step, x0: cl.x0, y0: cl.y0, wrapKm: cl.wrapKm, cellArea: step * step, land: cl.land, plant, temp, fresh, coast, mzone, lat, beastK, beastInfo };
}

/** How much meat a beast gives at full density, if it is hunted for food at all. */
function meatOf(b: Beast): number {
  const eaten = b.uses.includes('Food') || b.resources.some((r) => r === 'game' || r === 'livestock' || r === 'fish');
  return MEAT_K * (SIZE_MEAT[b.size ?? 'Medium'] ?? 0.5) * (eaten ? 1 : 0.15);
}
const zoneGroup = (zone: number) => (zone <= 2 ? 0 : zone <= 10 ? 1 : 2);
const waterZone = (t: number) => (t >= 20 ? 0 : t >= 8 ? 1 : 2);
/** Distance (km) from every point to the nearest land, along the grid. */
function distanceToLand(cl: Climate): Float32Array {
  const n = cl.w * cl.h;
  const hops = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let k = 0; k < n; k++) if (cl.land[k]) {
    hops[k] = 0;
    queue[tail++] = k;
  }
  for (let q = 0; q < tail; q++) {
    const k = queue[q];
    const i = k % cl.w;
    const j = (k / cl.w) | 0;
    const nbs = [i > 0 ? k - 1 : cl.wrapKm ? k + cl.w - 1 : -1, i < cl.w - 1 ? k + 1 : cl.wrapKm ? k - cl.w + 1 : -1, j > 0 ? k - cl.w : -1, j < cl.h - 1 ? k + cl.w : -1];
    for (const m of nbs) if (m >= 0 && hops[m] < 0) {
      hops[m] = hops[k] + 1;
      queue[tail++] = m;
    }
  }
  return Float32Array.from(hops, (v) => (v < 0 ? 1e6 : v * cl.step));
}
