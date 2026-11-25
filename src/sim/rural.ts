import type { Library } from '../core/library';
import type { Env } from './env';
import { arableAt, fertilityAt, foodTechFrom, provinceFood, provinceLand, type FoodTech } from './food';
import type { Clan, Settlement, SimState } from './state';
import { TIERS, tierOf } from './tiers';

/**
 * Rural people and village sites (REDESIGN.md, "Settlements and population", step 2).
 *
 * *Farmed provinces:* a province is farmed when its holder knows agriculture. Each month its land's
 * food (food.ts: farms, herds and fish, with what the holder knows, less what the people of its
 * towns eat) is added to the food the families living there can eat, laid over its points by
 * their farmland and fertility. The families there are its rural people: they grow toward what
 * the land feeds, and hungry ones move on to land with room (density.ts), so a full province sends
 * its migrants out. Peoples who don't farm live off the wild as before.
 *
 * *Village sites:* the rural people of a farmed province live in villages, each a lasting site
 * (its spot, its name, its people, when it began). A province keeps as many as its rural people
 * fill (about 200 to a village), up to 30 sites; beyond that the rest are scattered hamlets and
 * farms. Sites are spaced by how much farmland a village needs: 1.07 × √(200 people × 1 ha each ÷
 * the province's arable share), about 2 km on rich river plains, 3 in hills, 5 in mountains. New
 * ones go to the best spot (farmland and fertility, fresh water, a coast, a river crossing, a road,
 * traffic passing), never inside a town's footprint. Each year the villagers are shared out over
 * the sites by their draw: their spot, and the traffic passing them (a site on a busy trade route
 * draws up to three times its share), each moving a fifth of the way there a year. So a village on
 * a busy route grows past village size (step 3 makes it a town on the same spot).
 */

export const VILLAGE_POP = 200;
export const HAMLET_POP = 20;
export const SITE_MAX = 30;
export const HA_PER_PERSON = 1;
/** A settlement's footprint: no village site inside it (km). */
export const FOOTPRINT_KM = 1.5;
/** Traffic at which a site's draw doubles (a trail forms at about 20). */
const BUSY = 40;
const SITE_PACE = 0.2;

export interface VillageSite {
  id: number;
  name: string;
  x: number;
  y: number;
  /** Its people now. */
  pop: number;
  founded: number;
  /** Its culture (the province's rural people's main one when it began). */
  culture: string;
}

/** Each farmed province's food, laid over its points (rations a month), and which points are farmed. */
export interface FarmLayer {
  farm: Float32Array;
  farmed: Uint8Array;
  /** By province: its food a year with what its holder knows (rations), and what its rural people may have of it. */
  food: Float32Array;
  rural: Float32Array;
}

export interface RuralContext {
  sim: SimState;
  env: Env;
  lib: Library;
  /** Whether a clan knows a technology. */
  knows(clan: Clan, id: string): boolean;
  /** Food a settlement's people eat a year (rations: its race's size). */
  eats(st: Settlement): number;
  provAt(x: number, y: number): number;
  name(culture: string): string;
}

const layers = new WeakMap<SimState, FarmLayer>();
export const farmLayer = (sim: SimState): FarmLayer | undefined => layers.get(sim);

/** Once a year: which provinces are farmed, and the food their land lays over their points. */
export function farmYear(c: RuralContext): FarmLayer {
  const { sim, env } = c;
  const P = env.prov;
  const land = provinceLand(env);
  const farm = new Float32Array(env.n);
  const farmed = new Uint8Array(env.n);
  const food = new Float32Array(P.count);
  const rural = new Float32Array(P.count);
  const townsEat = new Float32Array(P.count);
  for (const st of sim.settlements) {
    if (st.ruined || st.layer) continue;
    const p = c.provAt(st.x, st.y);
    if (p >= 0) townsEat[p] += c.eats(st);
  }
  const clans = new Map(sim.clans.map((q) => [q.id, q]));
  const techOf = new Map<number, FoodTech>();
  for (let p = 0; p < P.count; p++) {
    const holder = sim.provOwner?.[p] ?? -1;
    const clan = holder >= 0 ? clans.get(holder) : undefined;
    if (!clan) continue;
    let t = techOf.get(clan.id);
    if (!t) techOf.set(clan.id, (t = foodTechFrom((id) => c.knows(clan, id))));
    if (!t.agriculture) continue;
    const f = provinceFood(land[p], t).total;
    food[p] = f;
    rural[p] = Math.max(0, f - townsEat[p]);
    if (rural[p] <= 0) continue;
    // Laid over its points by farmland and fertility (a little everywhere it is land: herds, fish).
    let sum = 0;
    const wt: number[] = [];
    for (let q = P.start[p]; q < P.start[p + 1]; q++) {
      const k = P.cells[q];
      const v = env.land[k] ? arableAt(env, k) * fertilityAt(env, k, t.irrigation) + 0.02 : 0;
      wt.push(v);
      sum += v;
    }
    if (sum <= 0) continue;
    let i = 0;
    for (let q = P.start[p]; q < P.start[p + 1]; q++, i++) {
      const k = P.cells[q];
      if (!env.land[k]) continue;
      farmed[k] = 1;
      farm[k] = (rural[p] * wt[i]) / sum / 12;
    }
  }
  const layer = { farm, farmed, food, rural };
  layers.set(sim, layer);
  return layer;
}

/** Each month, before the families eat: the farmed land's food added to what they can have. */
export function addFarmFood(sim: SimState, left: Float32Array): void {
  const layer = layers.get(sim);
  if (!layer) return;
  const F = layer.farm;
  for (let k = 0; k < F.length; k++) if (F[k] > 0) left[k] += F[k];
}

/** Whether a point is farmed (its province's holder knows agriculture). */
export const isFarmed = (sim: SimState, k: number) => (layers.get(sim)?.farmed[k] ?? 0) === 1;

// ---- Village sites.

/** Spacing between villages in a province (km), by its arable share. */
export function villageSpacing(arableShare: number): number {
  const landKm2 = (VILLAGE_POP * HA_PER_PERSON) / 100 / Math.max(0.03, arableShare);
  return 1.07 * Math.sqrt(landKm2);
}

/** A repeatable number in [0, 1) for a province, point and try (so sites land in the same spots). */
function hash(a: number, b: number, c: number): number {
  let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** How a spot draws villagers: its farmland and fertility, fresh water, a coast, a river crossing, a road, and the traffic passing. */
export function siteDraw(sim: SimState, env: Env, k: number): number {
  if (k < 0 || !env.land[k]) return 0;
  const base = 0.2 + arableAt(env, k) * fertilityAt(env, k) + (env.fresh[k] ? 0.5 : 0) + (env.coast[k] ? 0.3 : 0) + (env.fresh[k] && (sim.way?.[k] ?? 0) > 0 ? 0.4 : 0) + 0.15 * (sim.way?.[k] ?? 0) + (env.mzone[k] === 1 ? 0.1 : 0);
  return base * (1 + Math.min(2, (sim.traffic?.[k] ?? 0) / BUSY));
}

const cellAt = (env: Env, x: number, y: number) => {
  const i = Math.round((x - env.x0) / env.step);
  const j = Math.round((y - env.y0) / env.step);
  if (i < 0 || j < 0 || i >= env.w || j >= env.h) return -1;
  return j * env.w + i;
};

/** Once a year: each farmed province's village sites, as many as its rural people fill, and their people. */
export function sitesYear(c: RuralContext): void {
  const { sim, env } = c;
  const P = env.prov;
  const layer = layers.get(sim);
  const land = provinceLand(env);
  const all = (sim.sites ??= {});
  // Rural people and their main culture by province.
  const people = new Float32Array(P.count);
  for (const D of Object.values(sim.density ?? {})) for (let k = 0; k < D.length; k++) if (D[k] > 0 && P.of[k] >= 0) people[P.of[k]] += D[k];
  const towns = sim.settlements.filter((s) => !s.ruined && !s.layer);
  for (let p = 0; p < P.count; p++) {
    const key = String(P.ids[p]);
    const farmedHere = (layer?.rural[p] ?? 0) > 0;
    const R = people[p];
    let sites = all[key] ?? [];
    if (!farmedHere || R < HAMLET_POP) {
      // Not farmed (or nobody left): its villages empty out over the years, and go.
      for (const s of sites) s.pop *= 1 - SITE_PACE * 2;
      sites = sites.filter((s) => s.pop >= HAMLET_POP / 2);
      if (sites.length) all[key] = sites;
      else delete all[key];
      continue;
    }
    const want = Math.min(SITE_MAX, Math.max(1, Math.floor(R / VILLAGE_POP + 1e-6)));
    const area = Math.max(1, P.area[p]);
    const spacing = villageSpacing(land[p].arableHa / 100 / area);
    const tooNear = (x: number, y: number) =>
      sites.some((s) => Math.hypot(s.x - x, s.y - y) < spacing) || towns.some((t) => Math.hypot(t.x - x, t.y - y) < Math.max(TIERS[tierOf(t)].footprint, FOOTPRINT_KM, spacing * 0.5));
    // New sites at the best free spots.
    if (sites.length < want) {
      const country = sim.country?.[key] ?? [];
      const by = new Map<string, number>();
      for (const q of country) by.set(q.culture, (by.get(q.culture) ?? 0) + q.n);
      const culture = [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const cand: { x: number; y: number; v: number }[] = [];
      // Enough candidate spots for the villages wanted (at least three each), spread over its points.
      const landPts = [...P.cells.subarray(P.start[p], P.start[p + 1])].filter((k) => env.land[k]).length || 1;
      const tries = Math.max(4, Math.ceil((want * 3) / landPts));
      for (let q = P.start[p]; q < P.start[p + 1]; q++) {
        const k = P.cells[q];
        if (!env.land[k]) continue;
        const cx = env.x0 + (k % env.w) * env.step;
        const cy = env.y0 + Math.floor(k / env.w) * env.step;
        for (let t = 0; t < tries; t++) {
          const x = cx + (hash(P.ids[p], k, t * 2) - 0.5) * env.step;
          const y = cy + (hash(P.ids[p], k, t * 2 + 1) - 0.5) * env.step;
          const kk = cellAt(env, x, y);
          if (kk < 0 || !env.land[kk] || P.of[kk] !== p) continue;
          cand.push({ x, y, v: siteDraw(sim, env, kk) * (0.9 + 0.2 * hash(k, t, 7)) });
        }
      }
      cand.sort((a, b) => b.v - a.v);
      for (const s of cand) {
        if (sites.length >= want) break;
        if (tooNear(s.x, s.y)) continue;
        sites.push({ id: sim.nextId++, name: c.name(culture), x: s.x, y: s.y, pop: 0, founded: sim.day, culture });
      }
    } else if (sites.length > want + 1) {
      // Fewer people: the least of them empty out first.
      sites.sort((a, b) => b.pop - a.pop);
      sites = sites.slice(0, want + 1);
    }
    // The villagers shared out by each site's draw (the rest scattered hamlets and farms).
    const villagers = Math.min(R, sites.length * VILLAGE_POP);
    const draws = sites.map((s) => siteDraw(sim, env, cellAt(env, s.x, s.y)));
    const sum = draws.reduce((a, b) => a + b, 0) || 1;
    sites.forEach((s, i) => {
      const target = (villagers * draws[i]) / sum;
      s.pop += SITE_PACE * (target - s.pop);
    });
    all[key] = sites;
  }
}

/** A province's villages in brief: how many, their people, and the scattered rest. */
export function villagesOf(sim: SimState, env: Env, p: number): { sites: VillageSite[]; villagers: number } {
  const sites = sim.sites?.[String(env.prov.ids[p])] ?? [];
  return { sites, villagers: sites.reduce((n, s) => n + s.pop, 0) };
}
