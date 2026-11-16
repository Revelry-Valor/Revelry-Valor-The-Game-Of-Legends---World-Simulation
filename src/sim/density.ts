import type { Env } from './env';
import { markThinned } from './thinned';
import type { SimState } from './state';

/**
 * Wilderness density (REDESIGN.md 8.0, step 1): the small family groups living out in the wild,
 * kept as a population density over the land, one map for each race (people per climate point).
 *
 * - It starts only from something: settlements (dawn cities, pre-placed ones) send a trickle of
 *   their people out into the land round them, and a tribe settling down leaves families round
 *   its new village. Nothing is scattered over the world at the start.
 * - Each month the families eat what the land still has after the tribes and towns have foraged:
 *   wild plants (which grow back each season) and game (thinned by their hunting, breeding back
 *   slowly). Fed, they grow; hungry, they die back and more of them move on.
 * - They spread slowly into the land round them, toward land the race can live on and where food
 *   is left, and die out where it can't keep them. They never turn back into tribes.
 * - Races that can live together share the land; where they can't, the stronger presence pushes
 *   the weaker out.
 */

/** What the density needs to know about a race. */
export interface DensityRace {
  /** Food each person needs a month (person-months; Medium = 1). */
  need: number;
  /** Births and deaths a year per person in good times. */
  births: number;
  deaths: number;
  /** How readily it lives beside others: Welcoming, Indifferent or Wary. */
  attitude: string;
  species: string;
  /** How well it can live at a climate point (below 0: not at all), and whether it can go there. */
  live(k: number): number;
}

export interface DensityContext {
  sim: SimState;
  env: Env;
  race(id: string): DensityRace | null;
  /** Plant food still to be had this month (person-months), after the tribes and towns. */
  left: Float32Array;
  /** Points round a town (1): its pooled stores and market make life in the wild easier there. */
  boost?: Float32Array;
}

/** Below this many people, and hungry, a point's families are gone. */
const GONE = 0.1;
/** Share of the families that move on each month: a little always, more when hungry. */
const DRIFT = 0.02;
const HUNGRY_DRIFT = 0.1;
/** Of what they eat, the share from wild plants first (then game, then more plants if game is short). */
const PLANT_PART = 0.65;

/** Whether two races can live side by side (each must accept the other). */
export function canLiveTogether(a: DensityRace, aId: string, b: DensityRace, bId: string): boolean {
  if (aId === bId) return true;
  const accepts = (x: DensityRace, y: DensityRace) => x.attitude === 'Welcoming' || (x.attitude === 'Indifferent' && x.species === y.species);
  return accepts(a, b) && accepts(b, a);
}

/** The density map of a race (made on first use). */
export function densityOf(sim: SimState, env: Env, race: string): Float32Array {
  const all = (sim.density ??= {});
  let D = all[race];
  if (!D || D.length !== env.n) D = all[race] = new Float32Array(env.n);
  return D;
}

/**
 * Put people out into the land round a place: onto the best of its points (the most wild food),
 * a couple of families or more to each, so a trickle takes hold instead of thinning to nothing.
 */
export function seedDensity(sim: SimState, env: Env, race: string, cells: number[], people: number): void {
  if (!cells.length || people <= 0) return;
  const D = densityOf(sim, env, race);
  const land = cells.filter((k) => env.land[k]);
  if (!land.length) return;
  const food = (k: number) => env.plant[0][k] + env.plant[1][k];
  const best = land.sort((a, b) => food(b) - food(a)).slice(0, Math.max(1, Math.min(land.length, Math.floor(people / 2))));
  for (const k of best) D[k] += people / best.length;
}

/** One month of the wilderness: eating, growing or dying back, moving on, and races pressing on each other. */
export function densityMonth(c: DensityContext): void {
  const { sim, env, left } = c;
  const all = sim.density;
  if (!all) return;
  const { w, h, n } = env;
  const wrap = env.wrapKm > 0;
  const races = Object.keys(all).filter((id) => c.race(id));
  for (const id of races) {
    const r = c.race(id)!;
    const D = all[id];
    const fed = new Float32Array(n);
    const move = new Float32Array(n);
    // ---- Eating, growing and dying ----
    for (let k = 0; k < n; k++) {
      const P = D[k];
      if (P <= 0) continue;
      if (r.live(k) < 0) {
        D[k] = 0;
        continue;
      }
      const need = P * r.need;
      let got = Math.min(left[k], need * PLANT_PART);
      left[k] -= got;
      // Game: a little of what the beasts here are worth in meat, thinning them.
      for (const b of env.beastInfo) {
        if (b.water || got >= need) continue;
        const B = sim.beasts[b.id];
        const stock = B[k] * b.meat * env.cellArea;
        if (stock <= 0) continue;
        const take = Math.min(stock * 0.05 * b.catchRate, need - got);
        got += take;
        B[k] = Math.max(0, B[k] - take / (b.meat * env.cellArea));
        markThinned(sim, b.id, k);
      }
      // Short of game, more of the wild plants.
      if (got < need && left[k] > 0) {
        const more = Math.min(left[k], need - got);
        left[k] -= more;
        got += more;
      }
      const f = need > 0 ? Math.min(1.2, got / need) : 1;
      fed[k] = f;
      const births = (r.births / 12) * Math.min(1, f) * (f >= 1 ? 1.2 : 1) * (c.boost?.[k] ? 1.5 : 1);
      const deaths = r.deaths / 12 + (f < 1 ? ((1 - f) * 0.6) / 12 : 0);
      D[k] = P * (1 + births - deaths);
      // A last few, hungry, are gone (well fed, even a family or two at the edge holds on).
      if (D[k] < GONE && f < 1) D[k] = 0;
    }
    // ---- Moving on: toward land it can live on, where food is left ----
    const nbrs = (k: number) => {
      const i = k % w;
      const j = (k / w) | 0;
      const out: number[] = [];
      if (i > 0) out.push(k - 1);
      else if (wrap) out.push(k + w - 1);
      if (i < w - 1) out.push(k + 1);
      else if (wrap) out.push(k - w + 1);
      if (j > 0) out.push(k - w);
      if (j < h - 1) out.push(k + w);
      return out;
    };
    for (let k = 0; k < n; k++) {
      const P = D[k];
      if (P <= 0) continue;
      const movers = P * (DRIFT + HUNGRY_DRIFT * Math.max(0, 1 - fed[k]));
      if (movers < 0.05) continue;
      const nb = nbrs(k);
      let sum = 0;
      const wt = nb.map((m) => {
        const live = r.live(m);
        if (live < 0) return 0;
        // Food per head there (what is left, over the people already there).
        const room = left[m] / Math.max(1, D[m] * r.need);
        const v = Math.max(0.01, live) * (0.3 + Math.min(2, room));
        sum += v;
        return v;
      });
      if (sum <= 0) continue;
      D[k] -= movers;
      nb.forEach((m, q) => (move[m] += (movers * wt[q]) / sum));
    }
    for (let k = 0; k < n; k++) if (move[k]) D[k] += move[k];
  }
  // ---- Races that can't live together: the stronger presence pushes the weaker out ----
  for (let a = 0; a < races.length; a++) {
    for (let b = a + 1; b < races.length; b++) {
      const ra = c.race(races[a])!;
      const rb = c.race(races[b])!;
      if (canLiveTogether(ra, races[a], rb, races[b])) continue;
      const A = all[races[a]];
      const B = all[races[b]];
      for (let k = 0; k < n; k++) {
        if (A[k] <= 0 || B[k] <= 0) continue;
        const share = A[k] / (A[k] + B[k]);
        // Each loses in proportion to how much of the place the other holds; the weaker the more.
        A[k] *= 1 - 0.08 * (1 - share) * (share < 0.5 ? 1.5 : 0.5);
        B[k] *= 1 - 0.08 * share * (share > 0.5 ? 1.5 : 0.5);
        if (A[k] < GONE) A[k] = 0;
        if (B[k] < GONE) B[k] = 0;
      }
    }
  }
}

/** The wilderness people at a point: everyone, and by race. */
export function densityAt(sim: SimState, k: number): { total: number; byRace: [string, number][] } {
  const byRace: [string, number][] = [];
  let total = 0;
  for (const [id, D] of Object.entries(sim.density ?? {})) {
    const v = D[k] ?? 0;
    if (v <= 0) continue;
    byRace.push([id, v]);
    total += v;
  }
  byRace.sort((a, b) => b[1] - a[1]);
  return { total, byRace };
}

/** Totals over a set of points (a province's): the wilderness people by race, the game (meat) and this season's wild food. */
export function totalsOver(sim: SimState, env: Env, cells: ArrayLike<number>, season: 0 | 1): { people: Record<string, number>; game: number; plants: number } {
  const people: Record<string, number> = {};
  let game = 0;
  let plants = 0;
  for (let q = 0; q < cells.length; q++) {
    const k = cells[q];
    for (const [id, D] of Object.entries(sim.density ?? {})) if (D[k] > 0) people[id] = (people[id] ?? 0) + D[k];
    for (const b of env.beastInfo) if (!b.water) game += sim.beasts[b.id][k] * b.meat * env.cellArea;
    if (env.land[k]) plants += env.plant[season][k] * env.cellArea;
  }
  return { people, game, plants };
}
