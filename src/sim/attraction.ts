import { RAIN_VERY_WET, RAIN_WET } from '../core/climate';
import { COVER_BRUSHES } from '../core/paint';
import { PLANT_K, type Env } from './env';

/**
 * Where a people wants to live (REDESIGN.md, "Where peoples live: requirements and attraction").
 *
 * Each place is first held up to the race's requirements, then its pulls are added up:
 *
 * - **Water (a requirement).** Right by fresh water (a river or lake at the place) is best; a short
 *   walk from it will do. Further than that people won't live, unless the country is wet enough
 *   to live off the rain (very wet in one season, wet in the other: rainforest, monsoon). Salt
 *   water alone is no use: an island people lives off its rain, or not at all (until a later
 *   technology: wells, carrying water).
 * - **Climate (a requirement).** The race's tolerances (1 poor to 5 excellent) for heat, cold,
 *   wet, dry and altitude, against the place's hottest and coldest seasons, its rain and its
 *   height. The further past a tolerance, the harder the place; far enough past, and they won't
 *   even try to live there, however rich it is.
 * - **Pulls (added up).** Food (wild plants, game, fish), the race's preferred climates, ground
 *   covers and heights, resources, trade (a coast, a river), and mana for those who feel it.
 * - Pushes (crowding, others' land, enemies) depend on who is about, and are taken off where
 *   places are chosen.
 *
 * The score is water × climate × pulls; a place failing a requirement is off limits.
 */

/**
 * Hardship past a race's tolerance (step 3), from a place's climate factor (1 within all its
 * tolerances): births fall to half, and deaths rise, the harsher it is.
 */
export const hardBirths = (climate: number) => 0.5 + 0.5 * Math.max(0, Math.min(1, climate));
export const hardDeaths = (climate: number) => 0.08 * (1 - Math.max(0, Math.min(1, climate))) ** 2;

/** A short walk (km): people live no further than this from fresh water (wet country aside). */
export const SHORT_WALK_KM = 10;
/** Below this the climate is too harsh to try at all. */
export const CLIMATE_OFF = 0.15;

/** How well a race bears heat, cold, wet, dry and altitude (1 poor to 5 excellent). */
export interface Tolerances {
  heat: number;
  cold: number;
  wet: number;
  dry: number;
  altitude: number;
}

/** What a race asks of a place, and what draws it. */
export interface Wants {
  tolerances: Tolerances;
  /** Preferred climate zones, ground covers and mountain zones (empty: no preference). */
  climates: number[];
  covers: string[];
  heights: number[];
  manaSensitive: boolean;
  /** Can it go there at all (high mountains, water). */
  passable(k: number): boolean;
  /** How much fresh water it needs: High, Normal, Low or None (see WATER). */
  water?: string;
  /** What draws it most: food, water, resources and trade, each 0 to 2 (1 usual). */
  priorities?: { food: number; water: number; resources: number; trade: number };
}

/**
 * Water needs: how far from fresh water it will live (km), and what rain will do instead
 * ('very': very wet in one season and wet in the other; 'wet': wet in one season; 'never').
 */
export const WATER: Record<string, { walkKm: number; rain: 'very' | 'wet' | 'never'; none?: boolean }> = {
  High: { walkKm: 3, rain: 'never' },
  Normal: { walkKm: 10, rain: 'very' },
  Low: { walkKm: 30, rain: 'wet' },
  None: { walkKm: Infinity, rain: 'very', none: true },
};


// Each tolerance's limit, by level 1–5, and how much past the limit makes the place one step harsher.
/** Hottest season's mean temperature (°C). */
export const HEAT = [26, 30, 34, 38, 44];
/** Coldest season's mean temperature (°C). */
export const COLD = [8, 0, -10, -20, -35];
/** The wetter season's rain index at least (dry country). */
export const DRY = [0.35, 0.22, 0.12, 0.06, 0.02];
/** The drier season's rain index at most (rain all year): a middling tolerance bears rainforest. */
export const WET = [0.35, 0.6, 0.9, 1.3, 2];
/** Height (km). */
export const ALT = [0.8, 1.6, 2.5, 3.5, 5];
/**
 * A tolerance's limit at a level, between the levels too (a people part way adapted), and past
 * 5 by the last step again (up to 7: a people adapted past what its kind could ever bear).
 */
export function limitAt(table: number[], level: number): number {
  const t = Math.max(1, Math.min(7, level || 3)) - 1;
  if (t >= 4) return table[4] + (table[4] - table[3]) * (t - 4);
  const i = Math.floor(t);
  return table[i] + (table[i + 1] - table[i]) * (t - i);
}
/** The tolerance level a place calls for (continuous; 1 when it is easy), for each kind. */
export function levelNeeded(table: number[], value: number, higherIsHarder: boolean): number {
  // Find the level whose limit just covers the value (tables run easy to hard as level rises).
  for (let l = 1; l <= 7; l += 0.05) {
    const lim = limitAt(table, l);
    if (higherIsHarder ? value <= lim : value >= lim) return l;
  }
  return 7;
}

/** The parts of a place's attraction, each shown in the breakdown. */
export interface Attraction {
  /** Off limits: why (a requirement failed), or ''. */
  off: string;
  /** Water: 1 by fresh water, 0.75 a short walk from it, 0.6 living off the rain, 0 none. */
  water: number;
  waterWhy: string;
  /** Climate: 1 within all tolerances, less the harsher it is; and what is too much. */
  climate: number;
  harsh: string[];
  /** Pulls. */
  food: number;
  prefer: number;
  resources: number;
  trade: number;
  mana: number;
  /** The total: water × climate × pulls (−1 off limits). */
  score: number;
}

/** Whether a place's rain is enough to live on without a river or lake (for a people needing the usual; 'wet' for those needing little). */
export const rainFed = (env: Env, k: number, how: 'very' | 'wet' | 'never' = 'very') => {
  if (how === 'never') return false;
  const a = env.rain?.[0][k] ?? 0;
  const b = env.rain?.[1][k] ?? 0;
  return how === 'wet' ? Math.max(a, b) >= RAIN_WET : Math.max(a, b) >= RAIN_VERY_WET && Math.min(a, b) >= RAIN_WET;
};

/** How much a place draws a people, and why (see the top of this file). */
export function attraction(env: Env, w: Wants, k: number): Attraction {
  const none: Attraction = { off: '', water: 0, waterWhy: '', climate: 0, harsh: [], food: 0, prefer: 0, resources: 0, trade: 0, mana: 0, score: -1 };
  if (k < 0 || !env.land[k]) return { ...none, off: 'not land' };
  if (!w.passable(k)) return { ...none, off: 'they cannot go there' };
  // ---- Water (by how much it needs) ----
  const need = WATER[w.water || 'Normal'] ?? WATER.Normal;
  const fk = env.freshKm?.[k] ?? (env.fresh[k] ? 0 : Infinity);
  let water = 0;
  let waterWhy = '';
  if (need.none) [water, waterWhy] = [1, 'needs no water'];
  else if (env.fresh[k]) [water, waterWhy] = [1, 'by a river or lake'];
  else if (fk <= need.walkKm) [water, waterWhy] = [need.walkKm > SHORT_WALK_KM ? Math.max(0.6, 0.85 - fk / 100) : 0.75, `fresh water ${Math.round(fk)} km off`];
  else if (rainFed(env, k, need.rain)) [water, waterWhy] = [0.6, 'wet enough to live off the rain'];
  else waterWhy = need.rain === 'never' ? `must live right by fresh water (nearest ${Number.isFinite(fk) ? `${Math.round(fk)} km` : 'far'} off)` : Number.isFinite(fk) ? `no fresh water within a ${need.walkKm > SHORT_WALK_KM ? 'long' : 'short'} walk (nearest ${Math.round(fk)} km), and too dry to live off the rain` : 'no fresh water, and too dry to live off the rain';
  const pri = w.priorities ?? { food: 1, water: 1, resources: 1, trade: 1 };
  // How much being right by the water matters to them (1 usual; 0 not at all, 2 twice as much).
  if (water > 0) water = Math.pow(water, pri.water);
  // ---- Climate ----
  const t = w.tolerances;
  const hot = Math.max(env.temp[0][k], env.temp[1][k]);
  const cold = Math.min(env.temp[0][k], env.temp[1][k]);
  const wetSeason = Math.max(env.rain?.[0][k] ?? 0.2, env.rain?.[1][k] ?? 0.2);
  const drySeason = Math.min(env.rain?.[0][k] ?? 0.2, env.rain?.[1][k] ?? 0.2);
  const height = env.height?.[k] ?? 0;
  const harsh: string[] = [];
  let past = 0;
  const over = (amount: number, step: number, what: string) => {
    if (amount <= 0) return;
    past += amount / step;
    harsh.push(what);
  };
  over(hot - limitAt(HEAT, t.heat), 6, 'too hot');
  over(limitAt(COLD, t.cold) - cold, 8, 'too cold');
  over(limitAt(DRY, t.dry) - wetSeason, 0.08, 'too dry');
  over(drySeason - limitAt(WET, t.wet), 0.3, 'too wet');
  over(height - limitAt(ALT, t.altitude), 0.7, 'too high');
  const climate = Math.exp(-past);
  // ---- Pulls ----
  const plants = (env.plant[0][k] + env.plant[1][k]) / 2 / PLANT_K;
  let game = 0;
  for (const b of env.beastInfo) if (!b.water) game += env.beastK[b.id][k] * b.meat;
  const fish = env.coast[k] ? 0.2 : env.fresh[k] ? 0.15 : 0;
  const food = plants + Math.min(1, game / 8) * 0.6 + fish;
  const zone = env.zone?.[k] ?? -1;
  const cover = env.cover[k] >= 0 ? COVER_BRUSHES[env.cover[k]] : '';
  let prefer = 0;
  if (w.climates.length && zone >= 0) prefer += w.climates.includes(zone) ? 0.3 : -0.2;
  if (w.covers.length && cover) prefer += w.covers.includes(cover) ? 0.15 : -0.05;
  if (w.heights.length) prefer += w.heights.includes(env.mzone[k]) ? 0.15 : -0.1;
  let res = 0;
  for (const r of env.resInfo) if ((env.res[r.id]?.[k] ?? 0) > 0.4) res += 0.03;
  const resources = Math.min(0.3, res);
  const trade = Math.min(0.25, (env.coast[k] ? 0.15 : 0) + (env.fresh[k] ? 0.15 : 0));
  const mana = w.manaSensitive ? 0.5 * (env.manaBase[k] - 0.2) : 0;
  const pulls = Math.max(0, food * pri.food + prefer + resources * pri.resources + trade * pri.trade) + mana;
  const a: Attraction = { off: '', water, waterWhy, climate, harsh, food: food * pri.food, prefer, resources: resources * pri.resources, trade: trade * pri.trade, mana, score: water * climate * pulls };
  if (!water) a.off = waterWhy;
  else if (climate < CLIMATE_OFF) a.off = `too harsh: ${harsh.join(', ')}`;
  if (a.off) a.score = -1;
  return a;
}

/** How far (km) each climate point is from fresh water (a river or lake), across the land. */
export function freshDistance(env: Pick<Env, 'w' | 'h' | 'n' | 'step' | 'fresh' | 'wrapKm'>): Float32Array {
  const { w, h, n, step } = env;
  const d = new Float32Array(n).fill(Infinity);
  for (let k = 0; k < n; k++) if (env.fresh[k]) d[k] = 0;
  const D = step * Math.SQRT2;
  // Two sweeps (a chamfer distance): close enough to the true distance for "a short walk".
  const relax = (k: number, i: number, j: number, di: number, dj: number, c: number) => {
    let ii = i + di;
    const jj = j + dj;
    if (jj < 0 || jj >= h) return;
    if (ii < 0 || ii >= w) {
      if (!env.wrapKm) return;
      ii = (ii + w) % w;
    }
    const v = d[jj * w + ii] + c;
    if (v < d[k]) d[k] = v;
  };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    relax(k, i, j, -1, 0, step);
    relax(k, i, j, 0, -1, step);
    relax(k, i, j, -1, -1, D);
    relax(k, i, j, 1, -1, D);
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    relax(k, i, j, 1, 0, step);
    relax(k, i, j, 0, 1, step);
    relax(k, i, j, 1, 1, D);
    relax(k, i, j, -1, 1, D);
  }
  // From a point's edge, not its middle: water anywhere in a neighbouring point is that much nearer.
  for (let k = 0; k < n; k++) if (d[k] > 0) d[k] = Math.max(0, d[k] - step / 2);
  return d;
}

/** What a province offers for living (its land points taken together), for its card. */
export interface ProvinceLiving {
  /** Mean temperature of its hottest and coldest seasons (°C), and its mean height (km). */
  hot: number;
  cold: number;
  heightKm: number;
  /** The rain in its wetter and drier seasons (rain index). */
  wetSeason: number;
  drySeason: number;
  /** A river or lake in it; or else how far the nearest fresh water is (km, from its nearest point). */
  fresh: boolean;
  freshKm: number;
  /** Share of it wet enough to live off the rain, and share within a short walk of fresh water. */
  rainFed: number;
  nearWater: number;
  coast: boolean;
}

export function provinceLiving(env: Env, cells: ArrayLike<number>): ProvinceLiving | null {
  let n = 0;
  const o: ProvinceLiving = { hot: 0, cold: 0, heightKm: 0, wetSeason: 0, drySeason: 0, fresh: false, freshKm: Infinity, rainFed: 0, nearWater: 0, coast: false };
  for (let q = 0; q < cells.length; q++) {
    const k = cells[q];
    if (!env.land[k]) continue;
    n++;
    o.hot += Math.max(env.temp[0][k], env.temp[1][k]);
    o.cold += Math.min(env.temp[0][k], env.temp[1][k]);
    o.heightKm += env.height?.[k] ?? 0;
    o.wetSeason += Math.max(env.rain?.[0][k] ?? 0, env.rain?.[1][k] ?? 0);
    o.drySeason += Math.min(env.rain?.[0][k] ?? 0, env.rain?.[1][k] ?? 0);
    if (env.fresh[k]) o.fresh = true;
    const fk = env.freshKm?.[k] ?? Infinity;
    o.freshKm = Math.min(o.freshKm, fk);
    if (rainFed(env, k)) o.rainFed++;
    if (env.fresh[k] || fk <= SHORT_WALK_KM) o.nearWater++;
    if (env.coast[k]) o.coast = true;
  }
  if (!n) return null;
  for (const f of ['hot', 'cold', 'heightKm', 'wetSeason', 'drySeason', 'rainFed', 'nearWater'] as const) o[f] /= n;
  return o;
}

/** A race's attraction over a province: the mean over its land points (off-limits points count 0), the share off limits, and why most often. */
export function provinceAttraction(env: Env, w: Wants, cells: ArrayLike<number>, score?: (k: number) => number): { score: number; off: number; why: string } | null {
  let n = 0;
  let sum = 0;
  let off = 0;
  const whys = new Map<string, number>();
  for (let q = 0; q < cells.length; q++) {
    const k = cells[q];
    if (!env.land[k]) continue;
    n++;
    const s = score ? score(k) : attraction(env, w, k).score;
    if (s < 0) {
      off++;
      const a = attraction(env, w, k);
      const why = a.off.startsWith('too harsh') ? a.off : !a.water ? 'no fresh water near, too dry to live off the rain' : a.off;
      whys.set(why, (whys.get(why) ?? 0) + 1);
    } else sum += s;
  }
  if (!n) return null;
  let why = '';
  let wc = 0;
  for (const [k, c] of whys) if (c > wc) [why, wc] = [k, c];
  return { score: sum / n, off: off / n, why };
}
