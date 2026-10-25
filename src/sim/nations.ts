import type { Government, Library } from '../core/library';
import { cultureOf } from './culture';
import { acceptance } from './cultureChange';
import type { Env } from './env';
import type { Clan, Realm, Ruler, Settlement, SimState } from './state';
import { DAYS_PER_YEAR } from './state';
import { clanKnows, knows } from './tech';
import { pathCells, pathSpeed } from './ways';

/**
 * Nations and how they are ruled (REDESIGN.md 8.4a–c, Phase 9 step 1).
 *
 * Every clan is a realm: a band of tribes under its chief at first, and, as it settles, grows and
 * learns the ways of rule, a chiefdom, a kingdom, an empire or a republic. Its people's culture
 * prefers a government: a locked one is always kept once the people can have it; a strong pull
 * wins out unless something else fits far better, and draws the realm back after; a free culture
 * goes where its conditions lead. Cultures far from the source of that preference hold it less
 * firmly. The built-in types are chosen by conditions (size, way of life, trade, peoples ruled).
 *
 * Centralization is the realm's real ability to make its orders felt: set by how it holds its land,
 * raised by writing, records, riders and roads. Each settlement's control falls off with the days
 * it takes an order to reach it from the capital, so better ways hold a realm together. Realms
 * press their culture on the places they hold, most where control is strong; far places change
 * by their neighbours instead. Realms with settled government build royal roads from the capital.
 */

export interface NationContext {
  sim: SimState;
  env: Env;
  lib: Library;
  rand: () => number;
  dist: (ax: number, ay: number, bx: number, by: number) => number;
  cellAt: (x: number, y: number) => number;
  log: (text: string, x?: number, y?: number) => void;
  /** A personal name in a culture's sounds. */
  name: (cultureId: string) => string;
  /** A race's lifespan in years. */
  lifespan: (raceId: string) => number;
}

/** How firmly each way of holding land lets a realm rule (before learning and roads). */
const LAND_CENTRAL: Record<string, number> = {
  'Clans and tribes': 0.2,
  'Great lords with vassals (feudal)': 0.3,
  'Free cities': 0.35,
  Temples: 0.4,
  'Appointed governors': 0.5,
  'The state directly': 0.55,
};
/** How hard each kind of government presses its culture on those it rules (by who holds the land). */
const LAND_ENFORCE: Record<string, number> = {
  'Clans and tribes': 0.3,
  'Great lords with vassals (feudal)': 0.6,
  'Free cities': 0.3,
  Temples: 0.8,
  'Appointed governors': 1,
  'The state directly': 0.8,
};
/** Days an order takes to cross open country: km a day on foot, and with riders. */
const FOOT_KM = 25;
const RIDER_KM = 60;
/** At least this many years between changes of government (unless the old one can no longer be). */
const SETTLE_YEARS = 10;

export const govOf = (lib: Library, id: string): Government | undefined => lib.governments.find((g) => g.id === id);
/** The realm's government name, plainly. */
export function realmName(lib: Library, clan: Clan): string {
  const g = clan.realm ? govOf(lib, clan.realm.gov) : undefined;
  if (!g || g.id === 'clan') return `Clan ${clan.name}`;
  if (g.id === 'horde') return `the ${clan.name} Horde`;
  return `the ${g.name} of ${clan.name}`;
}
/** Is the realm still ruled as clans and tribes (whose tribes can go their own way)? */
export function tribalRule(lib: Library, clan: Clan): boolean {
  const g = clan.realm ? govOf(lib, clan.realm.gov) : undefined;
  return !g || g.land === 'Clans and tribes';
}
/** A ruler's title, from the government's head of state. */
export function rulerTitle(lib: Library, clan: Clan): string {
  const r = clan.realm;
  const head = (r ? govOf(lib, r.gov)?.head : '') || 'Chief';
  const f = !!r?.ruler.female;
  const titles: Record<string, string> = {
    Chief: 'Chief',
    'Council of elders': 'Eldest of the council',
    'King or queen': f ? 'Queen' : 'King',
    Emperor: f ? 'Empress' : 'Emperor',
    Khan: f ? 'Khatun' : 'Khan',
    'High priest': f ? 'High priestess' : 'High priest',
    Archmage: 'Archmage',
    'Elected leader': 'First speaker',
    Assembly: 'Speaker of the assembly',
    'None (a council rules)': 'First of the council',
  };
  return titles[head] ?? head;
}

/** The government a culture prefers and how firmly, from its Library culture, or (more loosely) from the culture it grew from. */
export function preferredGov(sim: SimState, lib: Library, cultureId: string): { gov: string; hold: string } {
  const loosen = (hold: string) => (hold === 'Locked' ? 'Strong pull' : '');
  let cu = cultureOf(sim, cultureId);
  let steps = 0;
  for (let guard = 0; cu && guard < 8; guard++) {
    const src = cu.source ? lib.cultures.find((c) => c.id === cu!.source) : lib.cultures.find((c) => c.id === cu!.id);
    if (src?.government) {
      let hold = src.governmentHold;
      for (let i = 0; i < steps; i++) hold = loosen(hold);
      return { gov: src.government, hold };
    }
    const up = cu.parent || cu.blend?.[0] || '';
    if (!up) break;
    cu = cultureOf(sim, up);
    steps++;
  }
  const direct = lib.cultures.find((c) => c.id === cultureId);
  return { gov: direct?.government ?? '', hold: direct?.governmentHold ?? '' };
}

/** What a realm is like this year, for choosing its government. */
interface RealmFacts {
  clan: Clan;
  towns: Settlement[];
  tribes: number;
  pop: number;
  townPop: number;
  biggest: Settlement | undefined;
  cultures: number;
  nomadic: boolean;
  riders: boolean;
  tradeShare: number;
  ethos: string;
  behaviours: Set<string>;
  lifespan: number;
  elders: boolean;
}

function facts(c: NationContext, clan: Clan): RealmFacts {
  const { sim, lib } = c;
  const towns = sim.settlements.filter((s) => !s.ruined && s.clan === clan.id);
  const tribes = sim.tribes.filter((t) => t.clan === clan.id);
  const townPop = towns.reduce((n, s) => n + s.pop, 0);
  const pop = townPop + tribes.reduce((n, t) => n + t.pop, 0);
  const cu = cultureOf(sim, clan.culture);
  const cultures = new Set([...towns.map((s) => s.culture), ...tribes.map((t) => t.culture)].filter(Boolean)).size;
  const traded = towns.reduce((n, s) => n + (s.economy?.traded?.out ?? 0) + (s.economy?.traded?.in ?? 0), 0);
  return {
    clan,
    towns,
    tribes: tribes.length,
    pop,
    townPop,
    biggest: [...towns].sort((a, b) => b.pop - a.pop)[0],
    cultures,
    nomadic: !!cu?.lifestyles.includes('Nomadic') || (tribes.length > 0 && towns.length === 0 && tribes.length >= 3),
    riders: clanKnows(lib, clan, 'riding') || towns.some((s) => knows(lib, s, 'riding')),
    tradeShare: pop > 0 ? traded / pop : 0,
    ethos: cu?.ethos ?? '',
    behaviours: new Set(cu?.behaviours ?? []),
    lifespan: c.lifespan(clan.race),
    elders: !!cu?.traditions.some((t) => t.id === 'ancestor-reverence' && t.level >= 0),
  };
}

/** Can this realm have that government at all (its people know the ways it needs, and it is settled where it must be)? */
function canHave(f: RealmFacts, g: Government): boolean {
  if (!g.needs.every((b) => f.behaviours.has(b))) return false;
  // Lords, governors, temples and free cities need towns to hold.
  if (g.land && g.land !== 'Clans and tribes' && (f.towns.length < 2 && (f.biggest?.pop ?? 0) < 1000)) return false;
  return true;
}

/** How well a built-in type fits the realm's conditions (0: not at all). */
function fit(f: RealmFacts, id: string): number {
  const S = f.towns.length;
  const e = f.ethos;
  const plus = (cond: boolean, v: number) => (cond ? v : 0);
  switch (id) {
    case 'clan':
      return 1;
    case 'gerontocracy':
      return f.lifespan >= 200 || f.elders ? 1.3 + plus(f.elders, 0.5) + plus(e === 'Communal', 0.2) : 0;
    case 'horde':
      return f.nomadic && f.riders && f.tribes >= 3 ? 2 + plus(e === 'Warlike', 0.4) : 0;
    case 'chiefdom':
      return S >= 1 && S + f.tribes >= 2 ? 1.5 + 0.05 * Math.min(6, S) + plus(e === 'Communal', 0.2) : 0;
    case 'petty-kingdom':
      return S >= 3 && f.pop >= 1500 ? 2.2 + plus(e === 'Courtly', 0.3) : 0;
    case 'feudal-kingdom':
      return S >= 6 && f.pop >= 4000 ? 2.8 + plus(e === 'Courtly' || e === 'Warlike', 0.2) : 0;
    case 'empire':
      return (S >= 10 && f.cultures >= 3) || S >= 16 ? 3.5 + plus(e === 'Warlike', 0.3) : 0;
    case 'city-state':
      return f.biggest && f.biggest.pop >= 1500 && f.biggest.pop >= f.townPop * 0.6 && f.tradeShare >= 0.5 ? 2.5 + plus(e === 'Commercial', 0.5) : 0;
    case 'merchant-republic':
      return S >= 2 && f.tradeShare >= 1 ? 2.7 + plus(e === 'Commercial', 0.6) : 0;
    case 'republic':
      return S >= 4 && f.pop >= 3000 ? 1.4 + plus(e === 'Egalitarian', 1.4) : 0;
    case 'elective-monarchy':
      return S >= 4 && f.towns.filter((s) => s.pop >= 1000).length >= 3 ? 2 : 0;
    // Theocracies come with faiths, and magocracies with mana; until then only a culture's preference brings them.
    default:
      return 0;
  }
}

/** The government a realm should have now. */
function chooseGov(c: NationContext, f: RealmFacts): string {
  const { sim, lib } = c;
  const pref = preferredGov(sim, lib, f.clan.culture);
  const pg = pref.gov ? govOf(lib, pref.gov) : undefined;
  if (pg && pref.hold === 'Locked' && canHave(f, pg)) return pg.id;
  const cur = f.clan.realm?.gov ?? 'clan';
  let best = 'clan';
  let bestScore = -1;
  for (const g of lib.governments) {
    if (!canHave(f, g)) continue;
    let s = g.builtIn ? fit(f, g.id) : 0;
    if (g === pg) s = Math.max(s, 1.2) + (pref.hold === 'Strong pull' ? 2 : 0.6);
    if (s <= 0) continue;
    if (g.id === cur) s += 0.5;
    if (s > bestScore) {
      bestScore = s;
      best = g.id;
    }
  }
  return best;
}

type RulerContext = Pick<NationContext, 'sim' | 'rand' | 'name' | 'lifespan'>;

function newRuler(c: RulerContext, clan: Clan, house: string): Ruler {
  const life = c.lifespan(clan.race);
  // Comes to rule as a grown adult: between a fifth and a half of a lifespan old.
  const age = life * (0.2 + 0.3 * c.rand());
  return { name: c.name(clan.culture), house, female: c.rand() < 0.5, born: c.sim.day - Math.round(age * DAYS_PER_YEAR), since: c.sim.day };
}

/** A new realm for a clan (its first chief, of its own house). */
export function ensureRealm(c: RulerContext, clan: Clan): Realm {
  if (!clan.realm) clan.realm = { gov: 'clan', since: c.sim.day, capital: -1, centralization: 0.2, ruler: newRuler(c, clan, clan.name), reigns: 1 };
  return clan.realm;
}

/** Days for an order from the capital to reach a place, by the ways between them. */
function orderDays(c: NationContext, from: Settlement, to: Settlement, riders: boolean): number {
  const km = c.dist(from.x, from.y, to.x, to.y);
  if (km < 1) return 0;
  const speed = pathSpeed(c.sim, pathCells(c.env, from.x, from.y, to.x, to.y, c.cellAt), c.env.fresh);
  return km / ((riders ? RIDER_KM : FOOT_KM) * speed);
}

/** The realm's centralization from how it holds its land, and what its capital knows. */
function centralization(c: NationContext, clan: Clan, g: Government | undefined, capital: Settlement | undefined): number {
  const has = (id: string) => (capital ? knows(c.lib, capital, id) : clanKnows(c.lib, clan, id));
  const cu = cultureOf(c.sim, clan.culture);
  const bh = (id: string) => !!cu?.behaviours.includes(id);
  let v = LAND_CENTRAL[g?.land ?? ''] ?? 0.3;
  if (has('writing')) v += 0.08;
  if (bh('record-keeping')) v += 0.05;
  if (bh('taxation')) v += 0.06;
  if (bh('written-law') || g?.law === 'Written law') v += 0.05;
  if (has('riding')) v += 0.04;
  if (has('roads')) v += 0.04;
  if (has('printing')) v += 0.05;
  if (has('railways') || has('mana-rail')) v += 0.06;
  return Math.max(0.05, Math.min(0.95, v));
}

/** How firmly an order reaches a place `days` away, for a realm of this centralization. */
export const controlAt = (central: number, days: number) => Math.max(0, Math.min(1, central * 1.4 * Math.exp(-days / (4 + 30 * central))));

/** The year for every realm: its capital, government, ruler, reach, culture pressed on its places, and the royal roads it wants. */
export function nationsYear(c: NationContext): { royalRoads: [number, number][] } {
  const { sim, lib } = c;
  const royalRoads: [number, number][] = [];
  for (const clan of sim.clans) {
    const realm = ensureRealm(c, clan);
    const f = facts(c, clan);
    // The capital: kept while it stands and is theirs; else their greatest town (their dawn city if near as great).
    let capital = f.towns.find((s) => s.id === realm.capital);
    if (!capital && f.towns.length) {
      capital = [...f.towns].sort((a, b) => b.pop * (b.kind === 'dawn' ? 1.5 : 1) - a.pop * (a.kind === 'dawn' ? 1.5 : 1))[0];
      if (realm.capital >= 0) c.log(`${realmName(lib, clan)} has a new capital: ${capital.name}.`, capital.x, capital.y);
    }
    realm.capital = capital?.id ?? -1;
    // Government.
    const curOk = (() => {
      const g = govOf(lib, realm.gov);
      return !!g && canHave(f, g);
    })();
    const want = chooseGov(c, f);
    if (want !== realm.gov && (realm.gov === 'clan' || !curOk || sim.day - realm.since >= SETTLE_YEARS * DAYS_PER_YEAR)) {
      const before = realmName(lib, clan);
      const old = realm.gov;
      realm.gov = want;
      realm.since = sim.day;
      const g = govOf(lib, want);
      const at = capital ?? sim.tribes.find((t) => t.clan === clan.id);
      if (old !== want) c.log(`${before} is now ${realmName(lib, clan)}${g ? ` (${g.name.toLowerCase()})` : ''}, under ${rulerTitle(lib, clan)} ${realm.ruler.name}.`, at?.x, at?.y);
    }
    const g = govOf(lib, realm.gov);
    // Centralization, and each place's control.
    realm.centralization = centralization(c, clan, g, capital);
    for (const st of f.towns) {
      if (!capital || st === capital) {
        st.control = capital ? 1 : realm.centralization;
        continue;
      }
      st.control = Math.round(controlAt(realm.centralization, orderDays(c, capital, st, f.riders)) * 100) / 100;
    }
    // Pressing the realm's culture on its places: strongest where its orders reach.
    const enforce = LAND_ENFORCE[g?.land ?? ''] ?? 0.4;
    for (const st of f.towns) {
      if (!clan.culture || st.culture === clan.culture) continue;
      const pace = 0.08 * enforce * (st.control ?? 0) * (0.6 + 0.4 * Math.max(0, acceptance(sim, st.culture, clan.culture)));
      if (pace <= 0.001) continue;
      const sh = st.cultureShift;
      if (sh && sh.to !== clan.culture) {
        // Another pull is at work: the realm holds it back first.
        sh.progress -= pace;
        if (sh.progress <= 0) st.cultureShift = { to: clan.culture, progress: 0 };
        continue;
      }
      st.cultureShift = { to: clan.culture, progress: (sh?.progress ?? 0) + pace };
      if (st.cultureShift.progress >= 1) {
        const from = cultureOf(sim, st.culture)?.name ?? '?';
        st.culture = clan.culture;
        delete st.cultureShift;
        c.log(`Under ${realmName(lib, clan)}, ${st.name} has taken on the ways of the ${cultureOf(sim, clan.culture)?.name ?? '?'} (once ${from}).`, st.x, st.y);
      }
    }
    // Royal roads: a realm settled under lords, governors or the state ties its towns to the capital.
    if (capital && g && g.land !== 'Clans and tribes') {
      const towns = f.towns.filter((s) => s !== capital && s.pop >= 150).sort((a, b) => c.dist(a.x, a.y, capital!.x, capital!.y) - c.dist(b.x, b.y, capital!.x, capital!.y)).slice(0, 6);
      for (const t of towns) royalRoads.push([capital.id, t.id]);
    }
  }
  unions(c);
  return { royalRoads };
}

/**
 * Small clans near a settled realm, of its culture or close to it, may swear themselves to it:
 * more readily the stronger its reach where they live and the smaller they are beside it.
 */
function unions(c: NationContext): void {
  const { sim, lib } = c;
  const popOf = (id: number) => sim.settlements.filter((s) => !s.ruined && s.clan === id).reduce((n, s) => n + s.pop, 0) + sim.tribes.filter((t) => t.clan === id).reduce((n, t) => n + t.pop, 0);
  const pops = new Map(sim.clans.map((q) => [q.id, popOf(q.id)]));
  for (const big of [...sim.clans]) {
    if (tribalRule(lib, big) || !big.realm || big.realm.capital < 0) continue;
    const capital = sim.settlements.find((s) => s.id === big.realm!.capital);
    if (!capital) continue;
    for (const small of [...sim.clans]) {
      if (small === big || (pops.get(small.id) ?? 0) * 4 > (pops.get(big.id) ?? 0)) continue;
      // Only a clan not itself a settled realm of any size.
      if (!tribalRule(lib, small) && sim.settlements.filter((s) => !s.ruined && s.clan === small.id).length > 2) continue;
      const acc = acceptance(sim, small.culture, big.culture);
      if (acc < 0.4) continue;
      const places = [...sim.settlements.filter((s) => !s.ruined && s.clan === small.id), ...sim.tribes.filter((t) => t.clan === small.id)];
      if (!places.length) continue;
      const near = Math.min(...places.map((p) => c.dist(p.x, p.y, capital.x, capital.y)));
      const reach = controlAt(big.realm.centralization, near / FOOT_KM);
      if (reach < 0.3 || c.rand() >= 0.08 * reach * acc) continue;
      for (const p of places) p.clan = big.id;
      for (let k = 0; k < sim.owner.length; k++) if (sim.owner[k] === small.id) sim.owner[k] = big.id;
      for (const so of sim.sorties) if (so.clan === small.id) so.clan = big.id;
      for (const cv of sim.caravans) if (cv.clan === small.id) cv.clan = big.id;
      big.techs = [...new Set([...(big.techs ?? []), ...(small.techs ?? [])])];
      sim.clans = sim.clans.filter((q) => q !== small);
      pops.set(big.id, (pops.get(big.id) ?? 0) + (pops.get(small.id) ?? 0));
      c.log(`Clan ${small.name} swore itself to ${realmName(lib, big)}.`, places[0].x, places[0].y);
    }
  }
}
