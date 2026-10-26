import type { Government } from '../core/library';
import { cultureOf } from './culture';
import { acceptance } from './cultureChange';
import { govOf, realmName, rulerTitle, tribalRule, type NationContext } from './nations';
import type { Claimant, Clan, Pact, Realm, RealmRelation, Royal, Ruler, Settlement, SimState, Spy } from './state';
import { DAYS_PER_YEAR } from './state';
import { knows } from './tech';
import { faithLoyalty, faithOpinion } from './faith';

/**
 * Inside and between realms (REDESIGN.md 8.4a, 8.4d, 8.5; Phase 9 step 2).
 *
 * - Royal families: rulers have children; where rule is handed down the heir takes the throne by
 *   the realm's succession, and passed-over heirs may press claims. Where a true line is put aside
 *   by a new house, the old line becomes a claimant. A line that dies out may pass, by a royal
 *   marriage, to the other realm's ruler (a personal union: the two become one realm).
 * - Loyalty and factions: each town's loyalty comes from how firmly it is held, its culture, hard
 *   times, and rival claims. Discontented towns near each other make a faction; one that stays
 *   discontented rises, and if its fighters are the stronger it breaks away as a realm of its
 *   own. A claimant backed by enough of the realm fights for the throne.
 * - Opinion and diplomacy between realms in contact: from how their cultures accept each other,
 *   remembered deeds (attacks, betrayals, marriages) and their treaties. Realms whose people have
 *   learned to send envoys make pacts: peace, trade (with an optional term to build shared roads
 *   and bridges between the capitals), defence (the same term), and royal marriages. Attacking a
 *   realm one has a pact with is a betrayal, remembered by everyone, unless justified (defending an
 *   ally, or the other struck first). A defender's allies take up its quarrel.
 * - Spies travel from a court to a rival's capital to steal knowledge, stir unrest, sabotage its
 *   stores or watch; they can be caught.
 */

export interface PoliticsContext extends NationContext {
  /** A new clan grown from another (for breakaways). */
  newClan: (from: Clan) => Clan;
}

const lifeOf = (c: NationContext, clan: Clan) => c.lifespan(clan.race);
const ageOf = (sim: SimState, born: number) => (sim.day - born) / DAYS_PER_YEAR;
const adult = (c: NationContext, clan: Clan, r: Royal) => ageOf(c.sim, r.born) >= Math.max(14, 0.2 * lifeOf(c, clan));
const cultureHas = (sim: SimState, clan: Clan, b: string) => !!cultureOf(sim, clan.culture)?.behaviours.includes(b);
const hereditary = (g: Government | undefined) => !!g && g.succession.startsWith('Hereditary');
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------------------------
// Relations between realms

const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function relationOf(sim: SimState, a: number, b: number): RealmRelation | undefined {
  return sim.realmRelations?.[key(a, b)];
}
function relation(sim: SimState, a: number, b: number): RealmRelation {
  const rel = (sim.realmRelations ??= {});
  return (rel[key(a, b)] ??= { opinion: 0, memory: 0, pacts: [] });
}
export const hasPact = (sim: SimState, a: number, b: number, kind?: Pact['kind']) => !!relationOf(sim, a, b)?.pacts.some((p) => !kind || p.kind === kind);
export const opinionWord = (v: number) => (v >= 0.5 ? 'friends' : v >= 0.2 ? 'cordial' : v > -0.2 ? 'neutral' : v > -0.5 ? 'cold' : 'hostile');
export const PACT_NAMES: Record<Pact['kind'], string> = { peace: 'Non-aggression pact', defence: 'Defensive pact', trade: 'Trade agreement', marriage: 'Royal marriage', vassal: 'Vassalage' };

const atWar = (sim: SimState, a: number, b: number) => !!sim.wars?.some((w) => w.ended === undefined && ((w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a))));
/** How a realm's warbands look on another's (multiplies hostility): pacts keep the peace, ill will and an ally's quarrel sharpen it. */
export function diplomacyFactor(sim: SimState, a: number, b: number): number {
  const rel = relationOf(sim, a, b);
  if (!rel) return 1;
  let f = 1 - 0.6 * rel.opinion;
  if (rel.pacts.some((p) => p.kind === 'peace' || p.kind === 'defence' || p.kind === 'marriage' || p.kind === 'vassal')) f *= 0.08;
  if ((rel.hostileUntil ?? -1) > sim.day) f *= 2.5;
  // At war: their warbands raid each other the more.
  if (atWar(sim, a, b)) f *= 2;
  return Math.max(0.03, f);
}
/** How readily realms trade (multiplies willingness). */
export function tradeFactor(sim: SimState, a: number, b: number): number {
  const rel = relationOf(sim, a, b);
  if (atWar(sim, a, b)) return 0;
  if (!rel) return 1;
  return Math.max(0.2, (1 + 0.4 * rel.opinion) * (rel.pacts.some((p) => p.kind === 'trade') ? 1.4 : 1));
}

/** A realm's warband went out against another's people: remembered; a betrayal if they had a pact (unless justified); the defender's allies take up its quarrel. */
export function noteAttack(sim: SimState, lib: NationContext['lib'], log: NationContext['log'], att: number, def: number): void {
  if (att === def) return;
  const A = sim.clans.find((q) => q.id === att);
  const D = sim.clans.find((q) => q.id === def);
  if (!A || !D) return;
  const rel = relation(sim, att, def);
  // Raids are remembered, but a year of them counts as one quarrel more than as many.
  rel.hits = (rel.hits ?? 0) + 1;
  if (rel.hits <= 1) rel.memory = Math.max(-1, rel.memory - 0.04);
  const recent = (r: RealmRelation | undefined, by: number) => !!r?.lastAttack && r.lastAttack.by === by && sim.day - r.lastAttack.day < 2 * DAYS_PER_YEAR;
  // Fighting ends a trade agreement; breaking a promise of peace (peace, defence, marriage) is a betrayal unless justified.
  rel.pacts = rel.pacts.filter((p) => p.kind !== 'trade');
  const kept = rel.pacts.filter((p) => p.kind === 'peace' || p.kind === 'defence' || p.kind === 'marriage' || p.kind === 'vassal');
  if (kept.length) {
    // Justified: the other struck first, or struck one of our defensive allies.
    const allies = sim.clans.filter((q) => q !== A && hasPact(sim, att, q.id, 'defence'));
    const justified = recent(rel, def) || allies.some((q) => recent(relationOf(sim, def, q.id), def));
    rel.pacts = rel.pacts.filter((p) => !kept.includes(p));
    if (justified) log(`${realmName(lib, A)} broke its treaty with ${realmName(lib, D)} for cause: a justified break.`);
    else {
      A.realm && (A.realm.betrayals = (A.realm.betrayals ?? 0) + 1);
      for (const [k, r] of Object.entries(sim.realmRelations ?? {})) if (k.split('|').includes(String(att))) r.memory = Math.max(-1, r.memory - 0.1);
      rel.memory = Math.max(-1, rel.memory - 0.4);
      log(`${realmName(lib, A)} broke its treaty with ${realmName(lib, D)} and attacked: a betrayal all will remember.`);
    }
  }
  rel.lastAttack = { by: att, day: sim.day };
  // The defender's allies.
  for (const C of sim.clans) {
    if (C === A || C === D || !hasPact(sim, def, C.id, 'defence')) continue;
    const rc = relation(sim, C.id, att);
    if ((rc.hostileUntil ?? -1) > sim.day) continue;
    // Still at odds from the last time: the quarrel goes on, unannounced.
    const ongoing = (rc.hostileUntil ?? -1e9) > sim.day - 2 * DAYS_PER_YEAR;
    rc.hostileUntil = sim.day + 3 * DAYS_PER_YEAR;
    if (ongoing) continue;
    rc.memory = Math.max(-1, rc.memory - 0.2);
    const peace = rc.pacts.some((p) => p.kind === 'peace' || p.kind === 'trade');
    rc.pacts = rc.pacts.filter((p) => p.kind === 'marriage');
    log(`${realmName(lib, C)} takes up the quarrel of its ally ${realmName(lib, D)} against ${realmName(lib, A)}${peace ? ', setting aside their treaty (a justified break)' : ''}.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Royal families and succession

function rulerFrom(c: NationContext, r: Royal): Ruler {
  return { name: r.name, house: r.house, female: r.female, born: r.born, since: c.sim.day };
}

/** The throne passes; returns false if the realm was joined to another (a personal union). */
function succeed(c: PoliticsContext, clan: Clan, realm: Realm, g: Government | undefined, at: { x: number; y: number } | undefined): boolean {
  const { sim, lib } = c;
  const old = realm.ruler;
  const title = rulerTitle(lib, clan);
  const kids = (realm.family ?? []).filter((k) => k.house === old.house);
  const grown = kids.filter((k) => adult(c, clan, k));
  const trueLine = g?.legitimacy === 'True line / sacred blood';
  let next: Ruler | null = null;
  let how = '';
  if (hereditary(g)) {
    const pool = grown.length ? grown : kids;
    let heir: Royal | undefined;
    if (pool.length) {
      if (g!.succession === 'Hereditary: eldest') heir = [...pool].sort((a, b) => a.born - b.born)[0];
      else heir = pool[Math.floor(c.rand() * pool.length)];
      // Passed-over grown children may press a claim (more so where any child, or the strongest, may inherit).
      const press = g!.succession === 'Hereditary: eldest' ? 0.08 : 0.35;
      for (const k of grown) if (k !== heir && c.rand() < press) (realm.claimants ??= []).push({ ...k, why: 'heir', backing: 0.15 + 0.2 * c.rand(), since: sim.day });
      next = rulerFrom(c, heir);
      how = `${heir.female ? 'daughter' : 'son'} of ${old.name}`;
    } else {
      // No children: a claimant of the line, or by marriage another realm's ruler, or a new house.
      const line = (realm.claimants ?? []).filter((q) => q.house === old.house).sort((a, b) => b.backing - a.backing)[0];
      if (line) {
        realm.claimants = (realm.claimants ?? []).filter((q) => q !== line);
        next = rulerFrom(c, line);
        how = 'of the old line';
      } else {
        const wed = sim.clans.find((q) => q !== clan && q.realm && hasPact(sim, clan.id, q.id, 'marriage') && hereditary(govOf(lib, q.realm.gov)));
        if (wed && c.rand() < 0.6) {
          union(c, clan, wed);
          c.log(`The line of ${old.house} has ended: by marriage, ${realmName(lib, wed)} inherits ${realmName(lib, clan)}, and the two are now one realm under ${rulerTitle(lib, wed)} ${wed.realm!.ruler.name}.`, at?.x, at?.y);
          return false;
        }
        how = `the line of ${old.house} having ended`;
      }
    }
  }
  if (!next) {
    const house = !hereditary(g) && c.rand() < 0.3 ? old.house : c.name(clan.culture);
    const life = lifeOf(c, clan);
    next = { name: c.name(clan.culture), house, female: c.rand() < 0.5, born: sim.day - Math.round(life * (0.25 + 0.3 * c.rand()) * DAYS_PER_YEAR), since: sim.day };
    // A true line set aside: its eldest grown child claims the throne.
    if (trueLine && house !== old.house && grown.length) {
      const k = [...grown].sort((a, b) => a.born - b.born)[0];
      (realm.claimants ??= []).push({ ...k, why: 'true line', backing: 0.25 + 0.15 * c.rand(), since: sim.day });
    }
  }
  realm.ruler = next;
  realm.family = [];
  realm.reigns++;
  if (realm.gov !== 'clan' || sim.settlements.some((s) => !s.ruined && s.clan === clan.id)) {
    const newHouse = next.house !== old.house;
    c.log(`${title} ${old.name} of ${realmName(lib, clan)} has died; ${rulerTitle(lib, clan)} ${next.name}${how ? ` (${how})` : ''} rules now${newHouse ? `, of the house of ${next.house} (a new house)` : ''}.`, at?.x, at?.y);
  }
  return true;
}

/** One realm joins another (its places, land and people). */
function union(c: PoliticsContext, from: Clan, into: Clan): void {
  const { sim } = c;
  for (const p of [...sim.settlements.filter((s) => s.clan === from.id), ...sim.tribes.filter((t) => t.clan === from.id)]) p.clan = into.id;
  for (let k = 0; k < sim.owner.length; k++) if (sim.owner[k] === from.id) sim.owner[k] = into.id;
  for (const so of sim.sorties) if (so.clan === from.id) so.clan = into.id;
  for (const cv of sim.caravans) if (cv.clan === from.id) cv.clan = into.id;
  into.techs = [...new Set([...(into.techs ?? []), ...(from.techs ?? [])])];
  sim.clans = sim.clans.filter((q) => q !== from);
  for (const k of Object.keys(sim.realmRelations ?? {})) if (k.split('|').includes(String(from.id))) delete sim.realmRelations![k];
}

function familyYear(c: PoliticsContext, clan: Clan, realm: Realm, g: Government | undefined, at: { x: number; y: number } | undefined): boolean {
  const { sim } = c;
  const life = lifeOf(c, clan);
  const age = ageOf(sim, realm.ruler.born);
  realm.family ??= [];
  // Children, while the ruler is of an age to have them.
  if (age >= 0.2 * life && age <= 0.6 * life && realm.family.length < 6 && c.rand() < 0.15) realm.family.push({ name: c.name(clan.culture), house: realm.ruler.house, female: c.rand() < 0.5, born: sim.day });
  const lives = (r: Royal) => {
    const a = ageOf(sim, r.born) / life;
    return !(c.rand() < (a < 0.1 ? 0.01 : a > 0.5 ? 0.04 + 2 * (a - 0.5) * (a - 0.5) : 0.005));
  };
  realm.family = realm.family.filter(lives);
  realm.claimants = (realm.claimants ?? []).filter(lives);
  // The ruler's death.
  const dies = age > life * 0.5 && c.rand() < Math.min(0.5, 0.04 + 2 * Math.pow(Math.max(0, age / life - 0.5), 2));
  return dies ? succeed(c, clan, realm, g, at) : true;
}

// ---------------------------------------------------------------------------------------------
// Loyalty, factions, risings

/** A town's loyalty to its realm this year. */
function loyaltyOf(sim: SimState, lib: NationContext['lib'], clan: Clan, st: Settlement, towns: number): number {
  if (clan.realm?.capital === st.id) return 1;
  let v = 0.3 + 0.5 * (st.control ?? 0);
  v += st.culture === clan.culture ? 0.15 : 0.15 * acceptance(sim, st.culture, clan.culture);
  if ((st.hardship?.famine ?? 0) > 0) v -= 0.1;
  if ((st.hardship?.war ?? 0) > 0) v -= 0.05;
  if (st.fed < 0.8) v -= 0.1;
  const rival = Math.max(0, ...(clan.realm?.claimants ?? []).map((q) => q.backing));
  v -= 0.15 * rival;
  // Of another faith than its ruler's (persecuted under an intolerant one).
  v -= faithLoyalty(sim, clan, st);
  // Ruled for the realm by a high prince of its old line: held fast while the prince is content.
  if (st.prince) v += 0.1;
  // Great lords grow ambitious in a big realm (a feudal one most of all).
  const land = govOf(lib, clan.realm?.gov ?? '')?.land ?? '';
  v -= Math.min(0.3, towns * (land === 'Great lords with vassals (feudal)' ? 0.005 : land === 'Clans and tribes' ? 0.004 : 0.002));
  return clamp(v, 0, 1);
}

/** Discontented towns near one another (chains within 150 km). */
function factions(c: NationContext, towns: Settlement[]): Settlement[][] {
  const left = towns.filter((s) => (s.unrest ?? 0) > 0);
  const out: Settlement[][] = [];
  while (left.length) {
    const group = [left.pop()!];
    for (let i = 0; i < group.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) if (c.dist(group[i].x, group[i].y, left[j].x, left[j].y) < 150) group.push(...left.splice(j, 1));
    }
    out.push(group);
  }
  return out;
}

function breakAway(c: PoliticsContext, clan: Clan, group: Settlement[]): void {
  const { sim, lib, env } = c;
  const nc = c.newClan(clan);
  nc.culture = [...group].sort((a, b) => b.pop - a.pop)[0].culture || clan.culture;
  const lord = [...group].sort((a, b) => b.pop - a.pop)[0];
  nc.realm!.capital = lord.id;
  for (const st of group) {
    st.clan = nc.id;
    st.unrest = 0;
  }
  // The land round the towns that rose goes with them.
  const mine = sim.settlements.filter((s) => !s.ruined && (s.clan === clan.id || s.clan === nc.id));
  for (let k = 0; k < env.n; k++) {
    if (sim.owner[k] !== clan.id) continue;
    const x = env.x0 + (k % env.w) * env.step;
    const y = env.y0 + ((k / env.w) | 0) * env.step;
    let best: Settlement | null = null;
    let bd = Infinity;
    for (const s of mine) {
      const d = c.dist(x, y, s.x, s.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best?.clan === nc.id) sim.owner[k] = nc.id;
  }
  // Tribes roaming nearest the risen towns go with them too.
  for (const t of sim.tribes.filter((q) => q.clan === clan.id)) {
    const near = [...mine].sort((a, b) => c.dist(t.x, t.y, a.x, a.y) - c.dist(t.x, t.y, b.x, b.y))[0];
    if (near?.clan === nc.id) t.clan = nc.id;
  }
  const rel = relation(sim, clan.id, nc.id);
  rel.memory = -0.6;
  rel.opinion = -0.4;
  c.log(`${lord.name} and ${group.length - 1 ? `${group.length - 1} town${group.length === 2 ? '' : 's'} round it` : 'its lands'} broke away from ${realmName(lib, clan)}: a realm of their own, ${realmName(lib, nc)}, under ${nc.realm!.ruler.name} of the house of ${nc.realm!.ruler.house}.`, lord.x, lord.y);
}

/**
 * High princes (REDESIGN.md 8.4b): a conquered ruling house that rules its old lands for the
 * realm. They hold them fast, but may rise to restore their own realm, more readily the less loyal
 * their towns and the weaker the realm's hold, and most when the realm is at war.
 */
function highPrincesYear(c: PoliticsContext, clan: Clan, towns: Settlement[]): void {
  const { sim, lib } = c;
  const realm = clan.realm;
  if (!realm?.highPrinces?.length) return;
  const atWarNow = !!sim.wars?.some((w) => w.ended === undefined && (w.attackers.includes(clan.id) || w.defenders.includes(clan.id)));
  for (const hp of [...realm.highPrinces]) {
    const lands = towns.filter((s) => s.prince === hp.house);
    if (!lands.length) {
      realm.highPrinces = realm.highPrinces.filter((q) => q !== hp);
      continue;
    }
    const loyal = lands.reduce((n, s) => n + (s.loyalty ?? 0.5), 0) / lands.length;
    const p = 0.03 * Math.max(0, 1 - loyal) * (atWarNow ? 2 : 1) * (1.5 - realm.centralization);
    if (c.rand() >= p) continue;
    const others = towns.filter((s) => !lands.includes(s));
    const rebels = lands.reduce((n, s) => n + s.warband * 1.2 + s.pop * 0.05, 0);
    const loyalists = others.reduce((n, s) => n + s.warband * (0.3 + (s.control ?? 0)), 0) * 0.6;
    if (rebels * (0.5 + c.rand()) > loyalists * (0.5 + c.rand())) {
      breakAway(c, clan, lands);
      const nc = sim.clans.find((q) => q.id === lands[0].clan)!;
      nc.realm!.ruler.house = hp.house;
      nc.realm!.ruler.name = hp.name;
      for (const s of lands) delete s.prince;
      realm.highPrinces = realm.highPrinces.filter((q) => q !== hp);
      c.log(`The high prince ${hp.name} of the house of ${hp.house} rose against ${realmName(lib, clan)} and restored ${hp.was} as ${realmName(lib, nc)}.`, lands[0].x, lands[0].y);
    } else {
      for (const s of lands) s.unrest = 0;
      c.log(`The high prince ${hp.name} of the house of ${hp.house} rose against ${realmName(lib, clan)} and was put down; the house still holds its lands.`, lands[0].x, lands[0].y);
    }
  }
}

/** The towns' loyalty and unrest; factions that rise; claimants who fight for the throne. */
function factionsYear(c: PoliticsContext, clan: Clan, realm: Realm): void {
  const { sim, lib } = c;
  const towns = sim.settlements.filter((s) => !s.ruined && s.clan === clan.id);
  for (const st of towns) {
    st.loyalty = Math.round(loyaltyOf(sim, lib, clan, st, towns.length) * 100) / 100;
    st.unrest = st.loyalty < 0.4 ? (st.unrest ?? 0) + 1 : Math.max(0, (st.unrest ?? 0) - 1);
  }
  const pop = towns.reduce((n, s) => n + s.pop, 0);
  highPrincesYear(c, clan, towns);
  // Claimants gather backing where the realm is restless.
  const restless = pop ? towns.filter((s) => (s.loyalty ?? 1) < 0.5).reduce((n, s) => n + s.pop, 0) / pop : 0;
  for (const q of realm.claimants ?? []) q.backing = clamp(q.backing + 0.06 * restless - 0.02, 0, 1);
  realm.claimants = (realm.claimants ?? []).filter((q) => q.backing > 0.02);
  // (A ruler in exile abroad comes back only by a war its host fights for it.)
  const pretender = [...(realm.claimants ?? [])].filter((q) => q.why !== 'exile').sort((a, b) => b.backing - a.backing)[0];
  if (pretender && pretender.backing >= 0.45 && c.rand() < 0.3) {
    const cap = towns.find((s) => s.id === realm.capital);
    realm.claimants = (realm.claimants ?? []).filter((q) => q !== pretender);
    if (c.rand() < pretender.backing) {
      const old = realm.ruler;
      realm.ruler = rulerFrom(c, pretender);
      realm.family = [];
      realm.reigns++;
      c.log(`Civil war in ${realmName(lib, clan)}: the claimant ${pretender.name} of the house of ${pretender.house} (${pretender.why === 'true line' ? 'the true line' : `a passed-over heir`}) overthrew ${old.name} and rules now.`, cap?.x, cap?.y);
    } else c.log(`Civil war in ${realmName(lib, clan)}: the claimant ${pretender.name} rose against ${realm.ruler.name} and was defeated.`, cap?.x, cap?.y);
    for (const st of towns) st.pop *= 0.96;
  }
  if (towns.length < 3) return;
  // Factions of discontented towns: one long discontented, strong enough, rises.
  for (const group of factions(c, towns)) {
    if (group.some((s) => s.id === realm.capital)) continue;
    const gp = group.reduce((n, s) => n + s.pop, 0);
    const years = group.reduce((n, s) => n + (s.unrest ?? 0) * s.pop, 0) / gp;
    if (years < 10 || gp < 300 || c.rand() >= 0.2) continue;
    const others = towns.filter((s) => !group.includes(s));
    const rebels = group.reduce((n, s) => n + s.warband * (1.5 - (s.control ?? 0)), 0);
    const loyal = others.reduce((n, s) => n + s.warband * (0.3 + (s.control ?? 0)), 0) * 0.6;
    const at = group[0];
    if (rebels * (0.5 + c.rand()) > loyal * (0.5 + c.rand())) breakAway(c, clan, group);
    else {
      for (const s of group) {
        s.unrest = 0;
        s.pop *= 0.9;
      }
      c.log(`${at.name}${group.length > 1 ? ` and the towns round it` : ''} rose against ${realmName(lib, clan)} and ${group.length > 1 ? 'were' : 'was'} put down.`, at.x, at.y);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Diplomacy

function contacts(c: NationContext): [Clan, Clan][] {
  const { sim } = c;
  const places = new Map<number, { x: number; y: number }[]>();
  for (const p of [...sim.settlements.filter((s) => !s.ruined), ...sim.tribes]) {
    const l = places.get(p.clan) ?? [];
    l.push(p);
    places.set(p.clan, l);
  }
  const out: [Clan, Clan][] = [];
  for (let i = 0; i < sim.clans.length; i++) for (let j = i + 1; j < sim.clans.length; j++) {
    const A = places.get(sim.clans[i].id) ?? [];
    const B = places.get(sim.clans[j].id) ?? [];
    if (A.some((p) => B.some((q) => c.dist(p.x, p.y, q.x, q.y) < 300))) out.push([sim.clans[i], sim.clans[j]]);
  }
  return out;
}

/** Treaties warm opinion; a vassal resents its overlord a little. */
const PACT_OPINION: Record<Pact['kind'], number> = { peace: 0.05, trade: 0.1, defence: 0.1, marriage: 0.15, vassal: -0.1 };

function diplomacyYear(c: PoliticsContext): [number, number][] {
  const { sim, lib } = c;
  const pairs = contacts(c);
  const inContact = new Set(pairs.map(([a, b]) => key(a.id, b.id)));
  // Opinion drifts toward what culture, memory and treaties make it; memories fade (grudges slower).
  for (const [k, rel] of Object.entries(sim.realmRelations ?? {})) {
    const [a, b] = k.split('|').map(Number);
    const A = sim.clans.find((q) => q.id === a);
    const B = sim.clans.find((q) => q.id === b);
    if (!A || !B) {
      delete sim.realmRelations![k];
      continue;
    }
    if (!inContact.has(k) && !rel.pacts.length && Math.abs(rel.memory) < 0.05) {
      delete sim.realmRelations![k];
      continue;
    }
  }
  for (const [A, B] of pairs) {
    const rel = relation(sim, A.id, B.id);
    const target = clamp(0.5 * acceptance(sim, A.culture, B.culture) + faithOpinion(sim, A, B) + rel.memory + rel.pacts.reduce((n, p) => n + PACT_OPINION[p.kind], 0) - 0.1 * ((A.realm?.betrayals ?? 0) + (B.realm?.betrayals ?? 0)), -1, 1);
    rel.opinion += (target - rel.opinion) * 0.2;
    rel.memory *= rel.memory > 0 ? 0.93 : 0.92;
    rel.hits = 0;
  }
  for (const rel of Object.values(sim.realmRelations ?? {})) if (!rel.pacts.length) rel.memory *= 0.98;
  // Treaties.
  const roads: [number, number][] = [];
  for (const [A, B] of pairs) {
    const rel = relation(sim, A.id, B.id);
    const name = (x: Clan) => realmName(lib, x);
    const at = sim.settlements.find((s) => s.id === A.realm?.capital) ?? sim.tribes.find((t) => t.clan === A.id);
    if (rel.opinion < -0.15 && rel.pacts.some((p) => p.kind !== 'vassal')) {
      // (Vassalage is not ended by ill will: only by a war for independence.)
      rel.pacts = rel.pacts.filter((p) => p.kind === 'vassal');
      c.log(`Relations between ${name(A)} and ${name(B)} have soured; their treaties are ended.`, at?.x, at?.y);
      continue;
    }
    if ((rel.hostileUntil ?? -1) > sim.day) continue;
    if (!cultureHas(sim, A, 'envoys') && !cultureHas(sim, B, 'envoys')) continue;
    const settled = !tribalRule(lib, A) && !tribalRule(lib, B);
    const has = (k: Pact['kind']) => rel.pacts.some((p) => p.kind === k);
    const canRoads = settled && [A, B].some((x) => {
      const cap = sim.settlements.find((s) => s.id === x.realm?.capital);
      return !!cap && (knows(lib, cap, 'roads') || knows(lib, cap, 'wheel'));
    });
    const add = (kind: Pact['kind'], roadsTerm = false) => {
      rel.pacts.push({ kind, since: sim.day, ...(roadsTerm ? { roads: true } : {}) });
      c.log(`${name(A)} and ${name(B)} made a ${PACT_NAMES[kind].toLowerCase()}${roadsTerm ? ', with shared roads and bridges between their capitals' : ''}.`, at?.x, at?.y);
    };
    if (!has('peace') && rel.opinion >= 0.1 && c.rand() < 0.25) add('peace');
    else if (!has('trade') && rel.opinion >= 0.05 && tradeTies(sim, A.id, B.id) && c.rand() < 0.3) add('trade', canRoads && c.rand() < 0.5);
    else if (!has('defence') && settled && rel.opinion >= 0.35 && c.rand() < 0.15) add('defence', canRoads && c.rand() < 0.4);
    else if (!has('marriage') && rel.opinion >= 0.2 && cultureHas(sim, A, 'marriage-alliances') && cultureHas(sim, B, 'marriage-alliances') && hereditary(govOf(lib, A.realm?.gov ?? '')) && hereditary(govOf(lib, B.realm?.gov ?? '')) && c.rand() < 0.12) {
      add('marriage');
      rel.memory = Math.min(1, rel.memory + 0.15);
    }
    // Shared roads between the capitals: each builds from its own end.
    if (rel.pacts.some((p) => p.roads)) {
      const ca = A.realm?.capital ?? -1;
      const cb = B.realm?.capital ?? -1;
      if (ca >= 0 && cb >= 0) roads.push([ca, cb], [cb, ca]);
    }
  }
  return roads;
}
function tradeTies(sim: SimState, a: number, b: number): boolean {
  const clanOf = (id: number) => sim.settlements.find((s) => s.id === id)?.clan;
  return sim.routes.some((r) => {
    const x = clanOf(r.a);
    const y = clanOf(r.b);
    return (x === a && y === b) || (x === b && y === a);
  });
}

// ---------------------------------------------------------------------------------------------
// Spies

const SPY_KM_DAY = 40;

function sendSpies(c: PoliticsContext, pairs: [Clan, Clan][]): void {
  const { sim, lib } = c;
  sim.spies ??= [];
  for (const A of sim.clans) {
    if (!cultureHas(sim, A, 'royal-court') || sim.spies.some((s) => s.from === A.id) || c.rand() >= 0.2) continue;
    const home = sim.settlements.find((s) => s.id === A.realm?.capital);
    if (!home) continue;
    const rivals = pairs.filter(([x, y]) => x === A || y === A).map(([x, y]) => (x === A ? y : x)).filter((B) => sim.settlements.some((s) => s.id === B.realm?.capital));
    if (!rivals.length) continue;
    // The one they like least, or one that knows what they lack.
    const lacks = (B: Clan) => {
      const cap = sim.settlements.find((s) => s.id === B.realm!.capital)!;
      return (cap.techs ?? []).filter((t) => !(home.techs ?? []).includes(t)).length;
    };
    const B = [...rivals].sort((x, y) => (relationOf(sim, A.id, x.id)?.opinion ?? 0) - lacks(x) * 0.05 - ((relationOf(sim, A.id, y.id)?.opinion ?? 0) - lacks(y) * 0.05))[0];
    const op = relationOf(sim, A.id, B.id)?.opinion ?? 0;
    if (op > 0.3 && !lacks(B)) continue;
    const target = sim.settlements.find((s) => s.id === B.realm!.capital)!;
    const mission: Spy['mission'] = lacks(B) && c.rand() < 0.6 ? 'steal' : op < -0.2 ? (c.rand() < 0.5 ? 'unrest' : 'sabotage') : 'watch';
    sim.spies.push({ id: sim.nextId++, name: c.name(A.culture), from: A.id, against: B.id, target: target.id, mission, x: home.x, y: home.y, leg: 'out' });
  }
  void lib;
}

/** Spies on the move: a day's travel; on reaching the target, the deed (or capture); home with what they learned. */
export function spiesDay(c: Pick<NationContext, 'sim' | 'lib' | 'rand' | 'dist' | 'log'>): void {
  const { sim, lib } = c;
  if (!sim.spies?.length) return;
  const keep: Spy[] = [];
  for (const s of sim.spies) {
    const A = sim.clans.find((q) => q.id === s.from);
    const B = sim.clans.find((q) => q.id === s.against);
    const home = sim.settlements.find((q) => q.id === A?.realm?.capital && !q.ruined);
    const target = sim.settlements.find((q) => q.id === s.target && !q.ruined);
    if (!A || !home || (s.leg === 'out' && (!B || !target))) continue;
    const to = s.leg === 'out' ? target! : home;
    const d = c.dist(s.x, s.y, to.x, to.y);
    if (d > SPY_KM_DAY) {
      s.x += ((to.x - s.x) * SPY_KM_DAY) / d;
      s.y += ((to.y - s.y) * SPY_KM_DAY) / d;
      keep.push(s);
      continue;
    }
    s.x = to.x;
    s.y = to.y;
    if (s.leg === 'home') {
      if (s.mission === 'steal') {
        const known = new Set(home.techs ?? []);
        const can = (target?.techs ?? []).filter((t) => !known.has(t) && (lib.techs.find((q) => q.id === t)?.requires ?? []).every((r) => known.has(r) || lib.techs.find((q) => q.id === r)?.start));
        if (can.length) {
          const t = can[Math.floor(c.rand() * can.length)];
          home.techs = [...known, t];
          c.log(`The spy ${s.name} came home to ${home.name} with the secret of ${lib.techs.find((q) => q.id === t)?.name ?? t}.`, home.x, home.y);
        }
      }
      continue;
    }
    // At the target.
    if (c.rand() < 0.3) {
      const rel = relation(sim, A.id, B!.id);
      rel.memory = Math.max(-1, rel.memory - 0.25);
      c.log(`A spy of ${realmName(lib, A)}, ${s.name}, was caught in ${target!.name}.`, target!.x, target!.y);
      continue;
    }
    if (s.mission === 'unrest') {
      target!.unrest = (target!.unrest ?? 0) + 4;
      const towns = sim.settlements.filter((q) => !q.ruined && q.clan === B!.id && q.id !== target!.id);
      for (const q of towns) q.unrest = (q.unrest ?? 0) + 2;
      const claim = B!.realm?.claimants?.[0];
      if (claim) claim.backing = Math.min(1, claim.backing + 0.1);
    } else if (s.mission === 'sabotage' && target!.economy) {
      for (const [id, v] of Object.entries(target!.economy.stores)) target!.economy.stores[id] = v * 0.7;
      c.log(`Stores burned in ${target!.name}: sabotage, though no one knows by whom.`, target!.x, target!.y);
    }
    s.leg = 'home';
    keep.push(s);
  }
  sim.spies = keep;
}

// ---------------------------------------------------------------------------------------------

/** The year inside and between realms. Returns the roads pacts call for (from, to: capitals). */
export function politicsYear(c: PoliticsContext): { pactRoads: [number, number][] } {
  const { sim, lib } = c;
  for (const clan of [...sim.clans]) {
    const realm = clan.realm;
    if (!realm || !sim.clans.includes(clan)) continue;
    const g = govOf(lib, realm.gov);
    const at = sim.settlements.find((s) => s.id === realm.capital) ?? sim.tribes.find((t) => t.clan === clan.id);
    if (!familyYear(c, clan, realm, g, at)) continue;
    factionsYear(c, clan, realm);
  }
  const pactRoads = diplomacyYear(c);
  sendSpies(c, contacts(c));
  return { pactRoads };
}

export type { Claimant };
