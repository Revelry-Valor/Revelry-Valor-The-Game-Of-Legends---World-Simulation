import type { Climate } from '../core/climate';
import { COVER_BRUSHES } from '../core/paint';
import type { Beast, Library, Resource } from '../core/library';
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

/** A resource as the simulation uses it. */
export interface ResInfo {
  id: string;
  name: string;
  category: string;
  source: string;
  rarity: string;
  /** Food: eaten, one unit feeding one (Medium) person for a month. */
  food: boolean;
  /** Share of a store lost each month if kept (fresh fish rots fast, grain keeps). */
  spoil: number;
  /** Found as deposits (ores, stone, gems) in some places, rather than wherever the land suits. */
  deposit: boolean;
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
  /** On a volcano or lava flow. */
  volcanic: Uint8Array;
  /** Where each resource is (0–1: how good the land is for it, or how rich the deposit). */
  res: Record<string, Float32Array>;
  resInfo: ResInfo[];
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
  // Volcanic ground: round painted volcanoes and along lava flows.
  const volcanic = new Uint8Array(n);
  for (const st of surface.strokes) {
    if ((st.brush !== 'volcano' && st.brush !== 'lava') || st.erase) continue;
    const r = Math.max(step * 0.6, st.size * (st.brush === 'volcano' ? 1.2 : 2));
    for (let q = 0; q < st.pts.length; q += 2) {
      const span = Math.ceil(r / step);
      const ci = Math.round((st.pts[q] - cl.x0) / step);
      const cj = Math.round((st.pts[q + 1] - cl.y0) / step);
      for (let dj = -span; dj <= span; dj++) for (let di = -span; di <= span; di++) {
        if (Math.hypot(di, dj) * step > r) continue;
        const k = cellAt(cl.x0 + (ci + di) * step, cl.y0 + (cj + dj) * step);
        if (k >= 0 && cl.land[k]) volcanic[k] = 1;
      }
    }
  }
  const { res, resInfo } = resources(cl, lib.resources, { mzone, coast, fresh, volcanic });
  return { w, h, n, step, x0: cl.x0, y0: cl.y0, wrapKm: cl.wrapKm, cellArea: step * step, land: cl.land, plant, temp, fresh, coast, mzone, lat, beastK, beastInfo, volcanic, res, resInfo };
}

const RARITY_WEIGHT: Record<string, number> = { Common: 1, Uncommon: 0.6, Rare: 0.3, 'Very rare': 0.12 };
/** Of all the land that suits a deposit, the share that has one. */
const DEPOSIT_CHANCE: Record<string, number> = { Common: 0.45, Uncommon: 0.2, Rare: 0.08, 'Very rare': 0.03 };
const SPOIL: Record<string, number> = { fish: 0.25, shellfish: 0.3, game: 0.12, livestock: 0.08, fruit: 0.15, roots: 0.04, grain: 0.01, rice: 0.01, nuts: 0.02, honey: 0, sugar: 0.01, olives: 0.02, grapes: 0.2, fungus: 0.1 };
const DEPOSIT_CATEGORIES = new Set(['Metal', 'Gem', 'Mineral', 'Stone']);
/** A steady pseudo-random number for a place and a name (deposits stay where they are). */
function hash01(a: number, b: number, s: string): number {
  let x = (a * 374761393 + b * 668265263) | 0;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Where each of the library's resources is found, from its climates, ground covers and kinds of terrain. */
function resources(cl: Climate, list: Resource[], g: { mzone: Uint8Array; coast: Uint8Array; fresh: Uint8Array; volcanic: Uint8Array }): { res: Record<string, Float32Array>; resInfo: ResInfo[] } {
  const n = cl.w * cl.h;
  const res: Record<string, Float32Array> = {};
  const resInfo: ResInfo[] = [];
  for (const r of list) {
    const deposit = DEPOSIT_CATEGORIES.has(r.category) && (r.source === 'Mined' || r.source === 'Quarried' || r.source === 'Gathered');
    const food = r.category === 'Food';
    resInfo.push({ id: r.id, name: r.name, category: r.category, source: r.source, rarity: r.rarity, food, spoil: SPOIL[r.id] ?? (food ? 0.04 : 0.002), deposit });
    const A = new Float32Array(n);
    const weight = RARITY_WEIGHT[r.rarity] ?? 1;
    const chance = DEPOSIT_CHANCE[r.rarity] ?? 0.3;
    // Rift and underdark resources come with those layers.
    const terrains = r.terrain.filter((t) => t !== 'Underdark' && t !== 'Rift');
    if (r.terrain.length && !terrains.length) {
      res[r.id] = A;
      continue;
    }
    for (let k = 0; k < n; k++) {
      if (!cl.land[k]) continue;
      const mz = g.mzone[k];
      const fits = (t: string) =>
        t === 'Lowland' ? mz === 0 : t === 'Hills' ? mz === 1 || mz === 2 : t === 'Mountains' ? mz >= 3 : t === 'Coast' || t === 'Sea' ? g.coast[k] === 1 : t === 'Rivers and lakes' ? g.fresh[k] === 1 : t === 'Volcanic' ? g.volcanic[k] === 1 : false;
      if (terrains.length && !terrains.some(fits)) continue;
      const zone = cl.zone[k];
      if (r.climates.length && !r.climates.includes(zone)) continue;
      const cover = cl.cover.main[k] >= 0 ? COVER_BRUSHES[cl.cover.main[k]] : '';
      // Farmed crops can be grown on cleared land of other covers; wild things need their own.
      const coverFit = !r.covers.length || r.covers.includes(cover) ? 1 : r.source === 'Farmed' || r.source === 'Herded' ? 0.45 : r.source === 'Mined' || r.source === 'Quarried' ? 1 : 0.15;
      if (deposit) {
        // Deposits in patches about four points across: in some places, rich; elsewhere none.
        const i = k % cl.w;
        const j = (k / cl.w) | 0;
        const pi = Math.floor(i / 4);
        const pj = Math.floor(j / 4);
        if (hash01(pi, pj, r.id) >= chance) continue;
        A[k] = (0.5 + 0.5 * hash01(i, j, r.id)) * coverFit;
        continue;
      }
      let v = weight * coverFit;
      if (r.source === 'Fished') v *= g.coast[k] ? 1 + 0.6 * Math.max(cl.summer.upwell[k] ?? 0, cl.winter.upwell[k] ?? 0) : 0.6;
      if (r.source === 'Farmed' && g.fresh[k]) v *= 1.25;
      if (r.source === 'Farmed' && g.volcanic[k]) v *= 1.2;
      A[k] = Math.min(1.5, v);
    }
    res[r.id] = A;
  }
  return { res, resInfo };
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
