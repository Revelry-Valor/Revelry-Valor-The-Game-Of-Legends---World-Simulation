import type { Env } from './env';
import type { VillageSite } from './rural';
import type { Settlement, SimState } from './state';

/**
 * Settlement tiers and spacing (REDESIGN.md, "Settlements and population", step 3).
 *
 * Six tiers. A settlement rises into a tier at its threshold and drops back only below 80% of it,
 * so one near a threshold doesn't flicker. It rises only if no settlement of that tier or higher
 * lies within the tier's exclusion radius (lower tiers pack round higher ones; equal ones keep
 * apart); a city fed by water (on a river or coast) needs only half the room. Each has a footprint
 * nothing may be founded inside.
 *
 * Village sites (rural.ts) grow into market towns on the same spot, keeping their name and story:
 * one that reaches 500 people, or 300 where its province has a surplus to feed a market, with no
 * market (or bigger) within 10 km. A small settlement on farmed land that has dwindled below 240
 * (80% of the least a village needs to become a market town) for five years goes back to being a village site (not a dawn city, a
 * capital, a holy place, a town on another layer, one with villages joined to it or one an army
 * is about).
 */

export interface TierInfo {
  name: string;
  /** People to rise into it. */
  min: number;
  /** Nothing founded inside (km), and no settlement of this tier or higher may rise within (km). */
  footprint: number;
  exclusion: number;
}

export const TIERS: TierInfo[] = [
  { name: 'Hamlet', min: 0, footprint: 0.3, exclusion: 1 },
  { name: 'Village', min: 100, footprint: 0.5, exclusion: 1.5 },
  { name: 'Market town', min: 500, footprint: 1, exclusion: 10 },
  { name: 'Large town', min: 2000, footprint: 1.5, exclusion: 30 },
  { name: 'City', min: 10000, footprint: 2.5, exclusion: 60 },
  { name: 'Great city', min: 100000, footprint: 5, exclusion: 150 },
];
export const MARKET = 2;
export const CITY = 4;
/** Drops a tier below this share of what it needed to rise. */
export const HYSTERESIS = 0.8;
/** A village site becomes a market town at this many people, or this many where its province has a surplus to feed a market. */
export const PROMOTE = 500;
export const PROMOTE_SURPLUS = 300;
/** Years below a market town's hold before a small settlement goes back to being a village site. */
export const DEMOTE_YEARS = 5;
/** Below this a town that grew from a village goes back to being one (80% of the least a village needs to become a market town). */
export const DEMOTE_BELOW = PROMOTE_SURPLUS * HYSTERESIS;

/** The tier its people alone would give (no hysteresis, no room asked). */
export function tierByPop(pop: number): number {
  let t = 0;
  for (let i = 1; i < TIERS.length; i++) if (pop >= TIERS[i].min) t = i;
  return t;
}
/** A settlement's tier (kept on it; worked out from its people the first time). */
export const tierOf = (st: Settlement): number => st.tier ?? tierByPop(st.pop);
export const tierName = (st: Settlement): string => TIERS[tierOf(st)].name;

/** A settlement's exclusion radius for a tier: a city on a river or coast needs half the room. */
export function exclusionFor(tier: number, waterFed: boolean): number {
  const e = TIERS[tier].exclusion;
  return tier >= CITY && waterFed ? e / 2 : e;
}

export interface TiersContext {
  sim: SimState;
  env: Env;
  provAt(x: number, y: number): number;
  /** Whether a settlement stands on a river or coast. */
  waterFed(st: Settlement): boolean;
  dist(ax: number, ay: number, bx: number, by: number): number;
  /** Whether a province is farmed, and the food its rural people may have beyond what they eat (rations). */
  farmed(p: number): boolean;
  surplus(p: number): number;
  /** Make a market town on a village site (its people out of the countryside), and turn a settlement back into a village site. */
  found(site: VillageSite, p: number): Settlement | null;
  unfound(st: Settlement): void;
  /** Whether something (an army, a siege) needs a settlement to stay. */
  pinned(st: Settlement): boolean;
  log(text: string, x?: number, y?: number): void;
}

/** Whether a settlement of at least this tier stands within this distance of a point. */
function crowded(c: TiersContext, x: number, y: number, tier: number, km: number, except?: Settlement): boolean {
  return c.sim.settlements.some((o) => o !== except && !o.ruined && !o.layer && tierOf(o) >= tier && c.dist(o.x, o.y, x, y) < km);
}

/** Once a year: each settlement's tier; village sites grown into market towns; small settlements back to village sites. */
export function tiersYear(c: TiersContext): void {
  const { sim, env } = c;
  // ---- Tiers, with hysteresis and room: the biggest first (so it is the one that rises where there is room
  // for one); a settlement new to tiers starts as a hamlet and rises as far as its people and the room allow.
  const fresh = new Set(sim.settlements.filter((st) => st.tier === undefined));
  for (const st of fresh) st.tier = 0;
  for (const st of [...sim.settlements].sort((a, b) => b.pop - a.pop)) {
    if (st.ruined) continue;
    let t = tierOf(st);
    // Down: below 80% of what it needed (a market town grown from a village site, which may have risen at
    // 300 with a surplus to feed it, holds while it keeps 240).
    const floor = (q: number) => (q === MARKET && st.villageSince !== undefined ? DEMOTE_BELOW : TIERS[q].min * HYSTERESIS);
    while (t > 0 && st.pop < floor(t)) t--;
    // Up: past the next threshold, if there is room for one of that tier.
    while (t < TIERS.length - 1 && st.pop >= TIERS[t + 1].min && (st.layer || !crowded(c, st.x, st.y, t + 1, exclusionFor(t + 1, c.waterFed(st)), st))) t++;
    if (!fresh.has(st) && t > tierOf(st) && t >= MARKET && st.partOf === undefined) c.log(`${st.name} has grown into a ${TIERS[t].name.toLowerCase()}.`, st.x, st.y);
    st.tier = t;
  }

  // ---- Village sites growing into market towns.
  const P = env.prov;
  for (const [key, sites] of Object.entries(sim.sites ?? {})) {
    const p = P.ids.indexOf(Number(key));
    if (p < 0 || !c.farmed(p)) continue;
    const surplus = c.surplus(p);
    for (const site of [...sites].sort((a, b) => b.pop - a.pop)) {
      const enough = site.pop >= PROMOTE || (site.pop >= PROMOTE_SURPLUS && surplus >= PROMOTE_SURPLUS);
      if (!enough) break;
      if (crowded(c, site.x, site.y, MARKET, TIERS[MARKET].exclusion)) continue;
      if (sim.settlements.some((o) => !o.ruined && !o.layer && c.dist(o.x, o.y, site.x, site.y) < TIERS[tierOf(o)].footprint + TIERS[MARKET].footprint)) continue;
      const st = c.found(site, p);
      if (!st) continue;
      st.tier = MARKET;
      st.villageSince = site.founded;
      sim.sites![key] = sim.sites![key].filter((q) => q !== site);
      c.log(`${st.name}, a village since year ${Math.floor(site.founded / 360) + 1}, has grown into a market town.`, st.x, st.y);
      break;
    }
  }

  // ---- Small settlements on farmed land back to village sites.
  for (const st of [...sim.settlements]) {
    if (st.ruined || st.layer || st.kind === 'dawn' || st.holyTo.length || st.partOf !== undefined) continue;
    const p = c.provAt(st.x, st.y);
    const small = p >= 0 && c.farmed(p) && st.pop < DEMOTE_BELOW && !sim.clans.some((q) => q.realm?.capital === st.id) && !sim.settlements.some((q) => q.partOf === st.id) && !c.pinned(st);
    st.smallYears = small ? (st.smallYears ?? 0) + 1 : 0;
    if (st.smallYears < DEMOTE_YEARS) continue;
    c.log(`${st.name} has dwindled back into a village.`, st.x, st.y);
    c.unfound(st);
  }
}
