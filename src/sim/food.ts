import { COVER_BRUSHES } from '../core/paint';
import type { Env } from './env';

/**
 * How many people a province's land can feed (REDESIGN.md, "Settlements and population", step 1).
 *
 * food = arable ha × base yield × fertility × technology × (1 − seed share) × (1 − fallow share)
 *
 * - *Arable share* of each climate point, by its ground cover (grassland about half, forest a
 *   third once cleared, jungle a fifth, desert next to none) and its relief (hills half, highlands
 *   a third, high mountains a seventh, peaks none); a river or lake's floodplain at least 0.6
 *   (save ice and salt).
 * - *Fertility*, by the warm season: warmth (none under 4 °C, full from 16 °C, falling off past
 *   32 °C) times water (the season's rain; by a river or lake the river's water, more with
 *   irrigation) times the soil (rainforest soils, leached, half; taiga and tundra thin; marsh
 *   waterlogged).
 * - *Base yield* 2.5 people's food a year per hectare sown, less a quarter kept as seed; half the
 *   land lies fallow (two fields), a third with crop rotation (three fields), so at fertility 1
 *   with crop rotation a hectare feeds 1.25 people (each farmer feeds themselves and a quarter of
 *   another). Without the plough, yields are four-fifths.
 * - *Herds* (with animal husbandry) graze the land that isn't farmed: a tenth of a person a hectare
 *   at best; *fish* (with fishing) feed people along coasts and lakes.
 *
 * Food is counted in rations: what a person of a medium-sized race eats in a year.
 */

export const BASE_YIELD = 2.5;
export const SEED_SHARE = 0.25;
export const FALLOW_TWO_FIELD = 0.5;
export const FALLOW_THREE_FIELD = 1 / 3;
export const NO_PLOUGH = 0.8;
/** Rations a hectare of pasture yields at best, and per km of shore a year (fish). */
export const PASTURE = 0.1;
export const FISH_PER_KM = 150;

const COVER_ARABLE: Record<string, number> = {
  grassland: 0.55,
  steppe: 0.4,
  savanna: 0.4,
  forest: 0.35,
  jungle: 0.2,
  taiga: 0.15,
  scrub: 0.2,
  marsh: 0.1,
  tundra: 0.03,
  glacier: 0,
  dunes: 0.02,
  rockdesert: 0.02,
  saltflats: 0,
  badlands: 0.05,
  beach: 0.05,
};
/** Grazing by ground cover (share of the land herds can use). */
const COVER_PASTURE: Record<string, number> = {
  grassland: 1,
  steppe: 1,
  savanna: 0.9,
  scrub: 0.6,
  tundra: 0.4,
  forest: 0.3,
  taiga: 0.3,
  jungle: 0.1,
  marsh: 0.3,
  badlands: 0.2,
  beach: 0.1,
  dunes: 0.05,
  rockdesert: 0.1,
  saltflats: 0,
  glacier: 0,
};
const RELIEF = [1, 0.5, 0.33, 0.15, 0];
/** Soil: leached rainforest soils, thin northern ones and waterlogged marsh give less. */
const COVER_SOIL: Record<string, number> = { jungle: 0.5, taiga: 0.65, tundra: 0.5, marsh: 0.8 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One climate point's arable share (0–1). */
export function arableAt(env: Env, k: number): number {
  if (!env.land[k]) return 0;
  const cover = env.cover[k] >= 0 ? COVER_BRUSHES[env.cover[k]] : 'grassland';
  let a = (COVER_ARABLE[cover] ?? 0.3) * (RELIEF[env.mzone[k]] ?? 0);
  if (env.fresh[k] && env.mzone[k] <= 1 && cover !== 'glacier' && cover !== 'saltflats') a = Math.max(a, 0.6);
  return a;
}

/** One climate point's fertility (0–1), by its warm season; `irrigation` makes the most of a river's water in dry country. */
export function fertilityAt(env: Env, k: number, irrigation = false): number {
  if (!env.land[k]) return 0;
  const s = env.temp[0][k] >= env.temp[1][k] ? 0 : 1;
  const t = env.temp[s][k];
  const warm = smooth(4, 16, t) * (1 - 0.6 * smooth(32, 42, t));
  const cover = env.cover[k] >= 0 ? COVER_BRUSHES[env.cover[k]] : 'grassland';
  const soil = COVER_SOIL[cover] ?? 1;
  const rain = env.rain?.[s][k] ?? 0.2;
  let water = smooth(0.03, 0.25, rain);
  if (env.fresh[k]) water = Math.max(water, irrigation ? 0.95 : 0.6);
  return warm * water * soil;
}

/** What a province's land gives, before what its people know: per province. */
export interface ProvinceLand {
  /** Hectares that could be farmed, and their mean fertility (by area). */
  arableHa: number;
  fertility: number;
  /** The same with irrigation (more where dry land lies by water). */
  fertilityIrrigated: number;
  /** Hectares herds could graze (not farmed), and their mean quality. */
  pastureHa: number;
  pastureQuality: number;
  /** Km of shore (sea or lake) to fish. */
  shoreKm: number;
}

const landCache = new WeakMap<Env, ProvinceLand[]>();

/** Each province's farmland, pasture and shore (worked out once for a climate). */
export function provinceLand(env: Env): ProvinceLand[] {
  const hit = landCache.get(env);
  if (hit && hit.length === env.prov.count) return hit;
  const P = env.prov;
  const ha = env.cellArea * 100;
  const out: ProvinceLand[] = [];
  for (let p = 0; p < P.count; p++) {
    let arable = 0;
    let fert = 0;
    let fertI = 0;
    let pasture = 0;
    let pq = 0;
    let shore = 0;
    for (let q = P.start[p]; q < P.start[p + 1]; q++) {
      const k = P.cells[q];
      if (!env.land[k]) continue;
      const a = arableAt(env, k);
      const f = fertilityAt(env, k);
      arable += a * ha;
      fert += a * ha * f;
      fertI += a * ha * fertilityAt(env, k, true);
      const cover = env.cover[k] >= 0 ? COVER_BRUSHES[env.cover[k]] : 'grassland';
      const g = (1 - a) * (COVER_PASTURE[cover] ?? 0.3) * (RELIEF[env.mzone[k]] > 0 ? Math.max(0.3, RELIEF[env.mzone[k]]) : 0);
      pasture += g * ha;
      pq += g * ha * Math.max(0.25, f);
      if (env.coast[k] || env.fresh[k]) shore += env.step;
    }
    out.push({ arableHa: arable, fertility: arable > 0 ? fert / arable : 0, fertilityIrrigated: arable > 0 ? fertI / arable : 0, pastureHa: pasture, pastureQuality: pasture > 0 ? pq / pasture : 0, shoreKm: shore });
  }
  landCache.set(env, out);
  return out;
}

/** What a people knows of farming, herding and fishing. */
export interface FoodTech {
  agriculture: boolean;
  plough: boolean;
  rotation: boolean;
  irrigation: boolean;
  husbandry: boolean;
  fishing: boolean;
}
export const ALL_FOOD_TECH: FoodTech = { agriculture: true, plough: true, rotation: true, irrigation: true, husbandry: true, fishing: true };
export const foodTechFrom = (has: (id: string) => boolean): FoodTech => ({ agriculture: has('agriculture'), plough: has('plough'), rotation: has('crop-rotation'), irrigation: has('irrigation'), husbandry: has('husbandry'), fishing: has('fishing') });

/** A province's food a year (rations), by source, with what its people know. */
export interface ProvinceFood {
  farms: number;
  herds: number;
  fish: number;
  total: number;
}

/** Net rations a hectare of farmland gives a year at a fertility, with what is known. */
export function netYield(fertility: number, t: FoodTech): number {
  if (!t.agriculture) return 0;
  return BASE_YIELD * fertility * (t.plough ? 1 : NO_PLOUGH) * (1 - SEED_SHARE) * (1 - (t.rotation ? FALLOW_THREE_FIELD : FALLOW_TWO_FIELD));
}

export function provinceFood(land: ProvinceLand, t: FoodTech): ProvinceFood {
  const farms = land.arableHa * netYield(t.irrigation ? land.fertilityIrrigated : land.fertility, t);
  const herds = t.husbandry ? land.pastureHa * PASTURE * land.pastureQuality : 0;
  const fish = t.fishing ? land.shoreKm * FISH_PER_KM : 0;
  return { farms, herds, fish, total: farms + herds + fish };
}

/** What the farms, herds and shore leave over the farmers' own food: the people towns can draw on (rations), and the urban share it allows. */
export function surplusOf(food: ProvinceFood, ruralRations: number): { surplus: number; urbanShare: number } {
  const surplus = food.total - ruralRations;
  return { surplus, urbanShare: food.total > 0 ? Math.max(0, surplus) / food.total : 0 };
}
