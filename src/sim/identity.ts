import type { Clan, Settlement, SimState } from './state';
import { total } from './pops';

/**
 * National identity, grievance and stance (REDESIGN.md, "Cultures as peoples", step 6), yearly.
 *
 * Each pop of a realm's settlements carries:
 * - *national identity* (0–1): how much it counts itself one of the realm, apart from how different
 *   its ways are. Raised by its realm's culture or one accepted, its institutions reaching it
 *   (control), time inside the realm, a shared war; lowered by distance from its culture's
 *   heartland (core distance), grievance, and a neighbouring realm of its own culture.
 * - *grievance* (0–1): hunger, forced customs (a realm pressing its culture on a people it does
 *   not accept, as hard as it enforces and reaches), a faith persecuted, war on its doorstep, the
 *   weight of a strong realm far from its capital, and, for the elites of a people not accepted,
 *   being kept from office.
 * - *stance*, for a people not of the realm's culture: by the realm's tolerance of it and its own
 *   strength (its share there, its cohesion): tolerated and weak, it *assimilates*; tolerated and
 *   strong, it *integrates*; untolerated and strong, it *separates* (keeps apart, its own ways);
 *   untolerated and weak, it is *marginalized* (losing its old ways, not accepted in the new).
 *
 * The realm's *accepted cultures*: its own and those it holds close (acceptance 0.5 or more).
 * Their people are counted as its own: privileges, so their elites have reason to take up its ways.
 *
 * Effects: stance sets how readily a people takes up the realm's ways (culturetick.ts); a town's
 * loyalty counts its people's identity and grievance, its marginalized and its separated minorities
 * (politics.ts); and discontented towns rise together along cultural lines.
 */

export type Stance = 'assimilate' | 'integrate' | 'separate' | 'marginalized';
export const STANCE_WORDS: Record<Stance, string> = { assimilate: 'assimilating', integrate: 'integrating', separate: 'keeping apart', marginalized: 'marginalized' };
/** How readily a people of each stance takes up another's culture and tongue. */
export const STANCE_RECEPTIVE: Record<Stance, number> = { assimilate: 1.5, integrate: 1, separate: 0.4, marginalized: 0.3 };
/** Acceptance at which a realm counts another culture as accepted. */
export const ACCEPTED_AT = 0.5;
/** Shares of the gap to its balance a pop's identity and grievance close each year. */
const IDENTITY_PACE = 0.05;
const GRIEVANCE_PACE = 0.2;

export interface IdentityContext {
  sim: SimState;
  /** How firmly a clan's realm enforces its ways (0–1). */
  enforce(clan: number): number;
  acceptance(a: string, b: string): number;
  /** How much a town's faith costs its loyalty under its ruler (0 none; persecuted more). */
  faithAgainst(clan: Clan, st: Settlement): number;
  /** A town's region's core distance from its culture's heartland (0 none known). */
  coreDistance(st: Settlement): number;
  /** Whether a clan is at war. */
  atWar(clan: number): boolean;
  dist(ax: number, ay: number, bx: number, by: number): number;
}

/** The cultures a realm accepts: its own and those it holds close. */
export function acceptedBy(c: Pick<IdentityContext, 'sim' | 'acceptance'>, clan: Clan): string[] {
  const own = clan.culture;
  if (!own) return [];
  return [own, ...(c.sim.cultures ?? []).filter((cu) => cu.id !== own && c.acceptance(own, cu.id) >= ACCEPTED_AT).map((cu) => cu.id)];
}

/** Once a year: each realm's accepted cultures, and each of its people's identity, grievance and stance. */
export function identityYear(c: IdentityContext): void {
  const { sim } = c;
  const clans = new Map(sim.clans.map((q) => [q.id, q]));
  const accepted = new Map<number, Set<string>>();
  for (const clan of sim.clans) {
    if (!clan.realm) continue;
    const list = acceptedBy(c, clan);
    clan.realm.accepted = list.slice(1);
    accepted.set(clan.id, new Set(list));
  }
  for (const st of sim.settlements) {
    if (st.ruined || !st.pops?.length) continue;
    const clan = clans.get(st.clan);
    if (!clan?.realm) {
      // Under no realm: no nation to belong to, nothing held against one.
      for (const q of st.pops) {
        delete q.stance;
        delete q.identity;
        delete q.grievance;
      }
      continue;
    }
    if (st.heldBy?.clan !== st.clan) st.heldBy = { clan: st.clan, since: sim.day };
    const years = (sim.day - st.heldBy.since) / 360;
    const ok = accepted.get(clan.id) ?? new Set<string>();
    const own = clan.culture;
    const enforce = c.enforce(clan.id);
    const control = clan.realm.capital === st.id ? 1 : st.control ?? 0;
    const capital = clan.realm.capital === st.id;
    const war = c.atWar(clan.id);
    const d = c.coreDistance(st);
    const all = total(st.pops);
    const shares = new Map<string, number>();
    for (const q of st.pops) shares.set(q.culture, (shares.get(q.culture) ?? 0) + q.n / all);
    // A neighbouring realm of a people's own culture draws its hearts (within 300 km).
    const kinRealm = (culture: string) => sim.clans.some((o) => o.id !== clan.id && o.realm && o.culture === culture && sim.settlements.some((s) => !s.ruined && s.clan === o.id && c.dist(s.x, s.y, st.x, st.y) < 300));
    const faith = c.faithAgainst(clan, st);
    for (const q of st.pops) {
      const mine = q.culture === own;
      const isAccepted = ok.has(q.culture);
      // Grievance.
      let g = 0;
      if (st.fed < 0.8) g += 0.3;
      if (!isAccepted) g += 0.3 * enforce * control;
      g += Math.min(0.3, faith * 1.5);
      if ((st.hardship?.war ?? 0) > 0.5) g += 0.1;
      if (!capital) g += 0.1 * (clan.realm.centralization ?? 0);
      if (!isAccepted && q.cls === 'elite') g += 0.2;
      g = Math.min(1, g);
      q.grievance = (q.grievance ?? g) + GRIEVANCE_PACE * (g - (q.grievance ?? g));
      // National identity.
      let t = 0.2 + 0.4 * control + Math.min(0.2, years * 0.002);
      t += mine ? 0.3 : isAccepted ? 0.15 : 0;
      if (war) t += 0.1;
      t -= 0.3 * d + 0.4 * q.grievance;
      if (!mine && kinRealm(q.culture)) t -= 0.2;
      t = Math.max(0, Math.min(1, t));
      q.identity = (q.identity ?? t) + IDENTITY_PACE * (t - (q.identity ?? t));
      // Stance, for a people not of the realm's culture.
      if (mine) {
        delete q.stance;
        continue;
      }
      const tolerance = isAccepted ? 1 : Math.max(0, Math.min(1, 0.5 + c.acceptance(own, q.culture) - 0.5 * enforce * control));
      const strength = Math.min(1, (shares.get(q.culture) ?? 0) + (st.cohesion ?? 0) * 0.5 + (q.culture === st.culture ? 0.3 : 0));
      q.stance = tolerance >= 0.5 ? (strength >= 0.5 ? 'integrate' : 'assimilate') : strength >= 0.5 ? 'separate' : 'marginalized';
    }
  }
}

/** What a town's people add to (or take from) its loyalty: identity, grievance, the marginalized, a separated minority. */
export function peopleLoyalty(st: Settlement): number {
  const pops = st.pops ?? [];
  const all = total(pops);
  if (all <= 0) return 0;
  let id = 0;
  let gr = 0;
  let marg = 0;
  let sep = 0;
  for (const q of pops) {
    id += (q.identity ?? 0.5) * q.n;
    gr += (q.grievance ?? 0) * q.n;
    if (q.stance === 'marginalized') marg += q.n;
    if (q.stance === 'separate' && (q.identity ?? 0.5) < 0.4) sep += q.n;
  }
  return 0.3 * (id / all - 0.5) - 0.3 * (gr / all) - 0.2 * (marg / all) - 0.2 * Math.min(1, (sep / all) * 2);
}

/** A town's people in brief, for its card: belonging, grievance and the stances of its minorities. */
export function identitySummary(st: Settlement, cultureName: (id: string) => string): string {
  const pops = (st.pops ?? []).filter((q) => q.identity !== undefined);
  const all = total(pops);
  if (all <= 0) return '';
  const id = pops.reduce((n, q) => n + (q.identity ?? 0) * q.n, 0) / all;
  const gr = pops.reduce((n, q) => n + (q.grievance ?? 0) * q.n, 0) / all;
  const by = new Map<string, number>();
  for (const q of pops) if (q.stance) by.set(`${q.culture}|${q.stance}`, (by.get(`${q.culture}|${q.stance}`) ?? 0) + q.n);
  const minorities = [...by].filter(([, n]) => n / all >= 0.02).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => {
    const [cu, stance] = k.split('|');
    return `${Math.round((n / all) * 100)}% ${cultureName(cu)} ${STANCE_WORDS[stance as Stance]}`;
  });
  return `Belonging to the realm ${Math.round(id * 100)}%, grievance ${Math.round(gr * 100)}%${minorities.length ? `; ${minorities.join(', ')}` : ''}.`;
}
