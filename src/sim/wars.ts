import type { Library } from '../core/library';
import { cultureFx, cultureOf } from './culture';
import { noteBetween } from './cultureChange';
import { isFood } from './economy';
import { PLANT_K } from './env';
import { realmFaith } from './faith';
import { govOf, realmName, tribalRule, type NationContext } from './nations';
import { hasPact, noteAttack, relationOf } from './politics';
import type { Army, Battle, Clan, RealmRelation, Settlement, SimState, War, WarReason } from './state';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, northernSummer } from './state';
import { armsMight, knows, wallsMight } from './tech';
import { FORD_SLOW, WAYS } from './ways';

/**
 * Wars and armies (REDESIGN.md 8.4i and 8.5; Phase 10 step 1).
 *
 * Settled realms go to war for a reason: a claim to towns they once held, a claimant of their own
 * house to a throne, holy war (their faith calls for it, or the other holds their holy site),
 * revenge for old wrongs, freeing their own people under foreign rule, or (warlike peoples only,
 * angering everyone) plain conquest. How readily depends on their culture, the odds, what they
 * think of each other, and treaties (breaking one is a betrayal unless justified). Allies with a
 * defensive pact are called in.
 *
 * Armies are raised by the realm's army custom (warbands, levies, retainers, a standing army…):
 * fighters are taken from its towns (as far as its hold reaches) and fed from their stores, march
 * at their race's pace (faster on roads, slowed by mountains, fords and winter), forage where the
 * land allows, take food from their own towns, and starve, sicken and desert when they cannot.
 * Armies meeting fight a battle (a simple one in this step; phased battles come in step 2); an
 * army reaching an enemy town assaults its guards (walls help) and holds it.
 *
 * Every month war weariness grows with time, losses and occupied towns. A side worn out (or beaten
 * badly) makes peace on the winner's terms: the towns it holds are ceded (they keep a claim to
 * come back), a throne goes to the winner's claimant, or stores are paid; a truce follows.
 * Tribal raids go on as before beside wars.
 */

export interface WarContext extends NationContext {
  /** How strong each fighter of a people is (race and culture), and how far an army of them marches in a day (km). */
  might: (race: string, culture: string) => number;
  speed: (race: string, culture: string) => number;
}

/** Share of a town's people raised by each army custom (warbands come from the town's own fighters). */
const LEVY: Record<string, number> = {
  'Clan warbands': 0,
  Levies: 0.08,
  'Lords’ retainers (samurai-like)': 0.02,
  'Standing army': 0.03,
  'Specialized troops': 0.01,
  Mercenaries: 0.02,
  Militia: 0.03,
  'Religious or magic orders': 0.01,
};
const ARMY_WORD: Record<string, string> = { 'Clan warbands': 'Warband', Levies: 'Host', 'Lords’ retainers (samurai-like)': 'Banner', 'Standing army': 'Army', Mercenaries: 'Company', Militia: 'Muster', 'Religious or magic orders': 'Order' };
const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
const REASON_WEIGHT: Record<WarReason, number> = { claim: 1.3, throne: 1.5, holy: 1.5, revenge: 1.1, liberate: 1.2, conquest: 0.35 };
export const REASON_WORDS: Record<WarReason, string> = { claim: 'to take back towns it once held', throne: 'to put its own claimant on the throne', holy: 'a holy war', revenge: 'for vengeance', liberate: 'to free its own people', conquest: 'for conquest alone' };

const live = (sim: SimState) => sim.settlements.filter((s) => !s.ruined);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const relKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function relation(sim: SimState, a: number, b: number): RealmRelation {
  return ((sim.realmRelations ??= {})[relKey(a, b)] ??= { opinion: 0, memory: 0, pacts: [] });
}

export const activeWars = (sim: SimState) => (sim.wars ?? []).filter((w) => w.ended === undefined);
export const sideOf = (w: War, clan: number): 'attackers' | 'defenders' | null => (w.attackers.includes(clan) ? 'attackers' : w.defenders.includes(clan) ? 'defenders' : null);
/** The war two realms are fighting on opposite sides, if any. */
export function warBetween(sim: SimState, a: number, b: number): War | undefined {
  return activeWars(sim).find((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)));
}
/** Every realm a realm is at war with. */
export function enemiesOf(sim: SimState, clan: number): Set<number> {
  const out = new Set<number>();
  for (const w of activeWars(sim)) {
    const side = sideOf(w, clan);
    if (side) for (const e of side === 'attackers' ? w.defenders : w.attackers) out.add(e);
  }
  return out;
}

const towns = (sim: SimState, clan: number) => live(sim).filter((s) => s.clan === clan);
const capitalOf = (sim: SimState, clan: Clan | undefined) => sim.settlements.find((s) => s.id === clan?.realm?.capital && !s.ruined);

function levyShare(lib: Library, clan: Clan): number {
  const g = govOf(lib, clan.realm?.gov ?? '');
  const parts = g?.army.length ? g.army : ['Clan warbands'];
  return parts.reduce((n, p) => n + (LEVY[p] ?? 0.02), 0);
}
function armsOf(c: WarContext, clan: Clan): number {
  const cap = capitalOf(c.sim, clan);
  return cap ? armsMight((id) => knows(c.lib, cap, id)) : 1;
}
/** What a realm could field: fighters and levies from the towns it holds, by their strength. */
function potential(c: WarContext, clan: Clan): number {
  const share = levyShare(c.lib, clan);
  let men = 0;
  for (const st of towns(c.sim, clan.id)) if (!st.occupied) men += st.warband * 0.7 + st.pop * share * (st.control ?? 1);
  return men * c.might(clan.race, clan.culture) * armsOf(c, clan);
}

// ---------------------------------------------------------------------------------------------
// Going to war

/** Why realm A might go to war with B (the best reason, and the town or house it is for). */
function reasons(c: WarContext, A: Clan, B: Clan): { reason: WarReason; town?: Settlement; house?: string } | null {
  const { sim } = c;
  const theirs = towns(sim, B.id);
  const claim = theirs.find((s) => s.claimedBy?.includes(A.id));
  const claimant = (B.realm?.claimants ?? []).find((q) => q.house === A.realm?.ruler.house);
  const fa = realmFaith(sim, A);
  const fb = realmFaith(sim, B);
  const holySite = fa && fa !== fb ? theirs.find((s) => fa.holySites.some((h) => c.dist(h.x, h.y, s.x, s.y) < 65)) : undefined;
  const holyWar = !!fa && !!fb && fa !== fb && fa.tenets.some((t) => t.id === 'holy-war' && t.level >= 0);
  const kin = A.culture !== B.culture ? theirs.filter((s) => s.culture === A.culture).sort((a, b) => b.pop - a.pop)[0] : undefined;
  const rel = relationOf(sim, A.id, B.id);
  if (claimant) return { reason: 'throne', house: claimant.house };
  if (holySite) return { reason: 'holy', town: holySite };
  if (claim) return { reason: 'claim', town: claim };
  if (kin && kin.pop >= 300) return { reason: 'liberate', town: kin };
  if (holyWar) return { reason: 'holy' };
  if (rel && rel.memory <= -0.5) return { reason: 'revenge' };
  const fx = cultureFx(sim, A.culture);
  if (cultureOf(sim, A.culture)?.ethos === 'Warlike' || fx.war > 1.2) return { reason: 'conquest' };
  return null;
}

function warName(c: WarContext, A: Clan, B: Clan, r: { reason: WarReason; town?: Settlement; house?: string }): string {
  switch (r.reason) {
    case 'throne':
      return `War of the ${B.name} Succession`;
    case 'holy':
      return `Holy War of ${realmFaith(c.sim, A)?.name ?? A.name}${r.town ? ` for ${r.town.name}` : ''}`;
    case 'claim':
      return `War for ${r.town?.name ?? B.name}`;
    case 'liberate':
      return `War to free the ${cultureOf(c.sim, A.culture)?.name ?? A.name} of ${r.town?.name ?? B.name}`;
    case 'revenge':
      return `War of ${A.name}'s Vengeance`;
    default:
      return `War of ${A.name}'s Conquest`;
  }
}
/** A war's name, numbered if one of that name was fought before. */
function uniqueName(sim: SimState, base: string): string {
  const n = (sim.wars ?? []).filter((w) => w.name === base || w.name.endsWith(` ${base}`)).length;
  return n ? `${ORDINAL[Math.min(n, ORDINAL.length - 1)]} ${base}` : base;
}

function contacts(c: WarContext, A: Clan): Clan[] {
  const { sim } = c;
  const mine = towns(sim, A.id);
  return sim.clans.filter((B) => B !== A && towns(sim, B.id).some((s) => mine.some((m) => c.dist(m.x, m.y, s.x, s.y) < 400)));
}

/** Declare war: allies called in, treaties broken (a betrayal unless justified), neighbours angered by a war without cause. */
export function declareWar(c: WarContext, A: Clan, B: Clan, r: { reason: WarReason; town?: Settlement; house?: string }): War {
  const { sim, lib } = c;
  // Breaking a treaty to do it.
  if (hasPact(sim, A.id, B.id)) noteAttack(sim, lib, c.log, A.id, B.id);
  relation(sim, A.id, B.id).pacts = relation(sim, A.id, B.id).pacts.filter((p) => p.kind === 'marriage');
  const war: War = { id: sim.nextId++, name: uniqueName(sim, warName(c, A, B, r)), reason: r.reason, attackers: [A.id], defenders: [B.id], ...(r.town ? { goalTown: r.town.id } : {}), ...(r.house ? { goalHouse: r.house } : {}), started: sim.day, score: 0, weariness: { [A.id]: 0, [B.id]: 0 }, battles: 0, losses: { attackers: 0, defenders: 0 } };
  (sim.wars ??= []).push(war);
  const cap = capitalOf(sim, A);
  c.log(`${realmName(lib, A)} declared war on ${realmName(lib, B)} ${REASON_WORDS[r.reason]}: the ${war.name}.`, cap?.x, cap?.y);
  // Allies: the defender's defensive allies are called in; the attacker's may join.
  for (const C of sim.clans) {
    if (C === A || C === B || enemiesOf(sim, C.id).size) continue;
    if (hasPact(sim, B.id, C.id, 'defence') && !hasPact(sim, A.id, C.id, 'defence') && c.rand() < 0.85) {
      war.defenders.push(C.id);
      war.weariness[C.id] = 0;
      relation(sim, A.id, C.id).pacts = relation(sim, A.id, C.id).pacts.filter((p) => p.kind === 'marriage');
      c.log(`${realmName(lib, C)} answers its ally's call and joins the ${war.name} against ${realmName(lib, A)}.`);
    } else if (hasPact(sim, A.id, C.id, 'defence') && !hasPact(sim, B.id, C.id) && (relationOf(sim, A.id, C.id)?.opinion ?? 0) > 0.4 && c.rand() < 0.3) {
      war.attackers.push(C.id);
      war.weariness[C.id] = 0;
      c.log(`${realmName(lib, C)} joins its ally ${realmName(lib, A)} in the ${war.name}.`);
    }
  }
  // A war without cause angers everyone, its own people too.
  if (r.reason === 'conquest') {
    for (const C of sim.clans) if (C !== A) relation(sim, A.id, C.id).memory -= 0.1;
    for (const st of towns(sim, A.id)) st.unrest = (st.unrest ?? 0) + 1;
  }
  return war;
}

/** How likely realm A is to go to war with B this year, and why (null: no reason, or the odds are against it). */
export function warOutlook(c: WarContext, A: Clan, B: Clan): { reason: WarReason; town?: Settlement; house?: string; odds: number; chance: number } | null {
  const { sim } = c;
  const rel = relationOf(sim, A.id, B.id);
  if ((rel?.truceUntil ?? -1) > sim.day) return null;
  const r = reasons(c, A, B);
  if (!r) return null;
  const odds = potential(c, A) / Math.max(1, potential(c, B));
  if (odds < 0.8) return { ...r, odds, chance: 0 };
  let p = 0.03 * cultureFx(sim, A.culture).war * Math.min(2, odds - 0.6) * REASON_WEIGHT[r.reason] * (1 - 0.6 * (rel?.opinion ?? 0));
  if (hasPact(sim, A.id, B.id, 'peace') || hasPact(sim, A.id, B.id, 'defence') || hasPact(sim, A.id, B.id, 'marriage')) p *= 0.15;
  const pacifist = realmFaith(sim, A)?.tenets.find((t) => t.id === 'pacifism');
  if (pacifist) p *= pacifist.level >= 1 ? 0.05 : 0.3;
  return { ...r, odds, chance: Math.max(0, p) };
}

/** Each year: settled realms at peace weigh going to war. */
export function warsYear(c: WarContext): void {
  const { sim, lib } = c;
  for (const A of [...sim.clans]) {
    if (tribalRule(lib, A) || !capitalOf(sim, A) || enemiesOf(sim, A.id).size) continue;
    // Resting from a war lately ended.
    if ((sim.wars ?? []).some((w) => w.ended !== undefined && sim.day - w.ended < 5 * DAYS_PER_YEAR && sideOf(w, A.id))) continue;
    for (const B of contacts(c, A)) {
      if (enemiesOf(sim, B.id).size && !enemiesOf(sim, B.id).has(A.id) && c.rand() < 0.5) continue;
      const o = warOutlook(c, A, B);
      if (!o || c.rand() >= o.chance) continue;
      declareWar(c, A, B, o);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Armies

function foodStores(env: WarContext['env'], st: Settlement): [string, number][] {
  const S = st.economy?.stores ?? {};
  return Object.entries(S).filter(([id, v]) => v > 0 && isFood(env, id));
}
function takeFood(c: WarContext, st: Settlement, want: number): number {
  let got = 0;
  for (const [id, v] of foodStores(c.env, st)) {
    // A town keeps a month's food for itself.
    const spare = Math.max(0, v - st.pop * 0.5);
    const take = Math.min(spare, want - got);
    st.economy!.stores[id] = v - take;
    got += take;
    if (got >= want) break;
  }
  return got;
}

/** Raise an army for a war: fighters from the realm's towns (as far as its hold reaches), food from their stores. */
export function raiseArmy(c: WarContext, clan: Clan, war: War): Army | null {
  const { sim, lib } = c;
  const cap = capitalOf(sim, clan);
  if (!cap) return null;
  const share = levyShare(lib, clan);
  const from: Record<number, number> = {};
  let men = 0;
  for (const st of towns(sim, clan.id)) {
    if (st.occupied) continue;
    const reach = st === cap ? 1 : st.control ?? 0.5;
    if (reach < 0.2) continue;
    const fighters = Math.floor(st.warband * 0.6 * reach);
    const levy = Math.floor(st.pop * share * reach);
    if (fighters + levy < 1) continue;
    st.warband -= fighters;
    st.pop -= levy + fighters;
    from[st.id] = fighters + levy;
    men += fighters + levy;
  }
  if (men < 30) {
    // Too few to field: give them back.
    for (const [id, n] of Object.entries(from)) {
      const st = sim.settlements.find((q) => q.id === Number(id))!;
      st.pop += n;
      st.warband += n * 0.5;
    }
    return null;
  }
  let supply = 0;
  for (const st of towns(sim, clan.id)) if (from[st.id]) supply += takeFood(c, st, from[st.id] * 2);
  const g = govOf(lib, clan.realm?.gov ?? '');
  const word = ARMY_WORD[g?.army[0] ?? 'Clan warbands'] ?? 'Army';
  const n = (sim.armies ?? []).filter((a) => a.clan === clan.id).length + (sim.battles ?? []).filter((b) => b.a.clan === clan.id || b.b.clan === clan.id).length % 3;
  const army: Army = { id: sim.nextId++, name: `${ORDINAL[n % ORDINAL.length]} ${word} of ${clan.name}`, clan: clan.id, war: war.id, x: cap.x, y: cap.y, men, raised: men, morale: 1, supply, from, goal: sideOf(war, clan.id) === 'attackers' ? 'attack' : 'defend', target: -1, general: c.name(clan.culture) };
  (sim.armies ??= []).push(army);
  c.log(`${realmName(lib, clan)} raised the ${army.name}: ${men.toLocaleString()} under ${army.general}.`, cap.x, cap.y);
  return army;
}

/** An army home again: its fighters go back to their towns (those still living). */
function disband(c: WarContext, a: Army): void {
  const { sim } = c;
  const alive = a.raised > 0 ? clamp(a.men / a.raised, 0, 1) : 0;
  for (const [id, n] of Object.entries(a.from)) {
    const st = sim.settlements.find((q) => q.id === Number(id) && !q.ruined);
    if (!st) continue;
    const back = n * alive;
    st.pop += back;
    st.warband += back * 0.6;
  }
  sim.armies = (sim.armies ?? []).filter((q) => q !== a);
}

/** Where an army is going now: a town to take or free, an enemy army to meet, or home. */
function chooseTarget(c: WarContext, a: Army, war: War): { x: number; y: number; town?: Settlement; army?: Army } | null {
  const { sim } = c;
  const clan = sim.clans.find((q) => q.id === a.clan);
  const home = capitalOf(sim, clan);
  if (a.goal === 'home') return home ? { x: home.x, y: home.y } : null;
  const side = sideOf(war, a.clan)!;
  const foes = new Set(side === 'attackers' ? war.defenders : war.attackers);
  const friends = new Set(side === 'attackers' ? war.attackers : war.defenders);
  // An enemy army near (within its reach, about 15 days' march): meet it.
  const reach = c.speed(clan?.race ?? '', clan?.culture ?? '') * 15;
  const near = (sim.armies ?? []).filter((e) => e.war === war.id && foes.has(e.clan)).sort((p, q) => c.dist(a.x, a.y, p.x, p.y) - c.dist(a.x, a.y, q.x, q.y))[0];
  if (near && c.dist(a.x, a.y, near.x, near.y) < (a.goal === 'defend' ? reach * 1.5 : reach * 0.5)) return { x: near.x, y: near.y, army: near };
  // Our towns the enemy holds: free them.
  const ours = live(sim).filter((s) => friends.has(s.clan) && s.occupied && foes.has(s.occupied.by)).sort((p, q) => c.dist(a.x, a.y, p.x, p.y) - c.dist(a.x, a.y, q.x, q.y))[0];
  if (ours) return { x: ours.x, y: ours.y, town: ours };
  if (a.goal === 'defend') {
    // Nothing to free: take the war to them once their armies are beaten, else guard the capital.
    if (war.score < -20 || !(sim.armies ?? []).some((e) => e.war === war.id && foes.has(e.clan))) {
      const t = live(sim).filter((s) => foes.has(s.clan) && !s.occupied).sort((p, q) => c.dist(a.x, a.y, p.x, p.y) - c.dist(a.x, a.y, q.x, q.y))[0];
      if (t && c.dist(a.x, a.y, t.x, t.y) < reach * 2) return { x: t.x, y: t.y, town: t };
    }
    return home ? { x: home.x, y: home.y } : null;
  }
  // Attack: the town the war is for, else the nearest enemy town not yet held (their capital if near).
  const goal = sim.settlements.find((s) => s.id === war.goalTown && !s.ruined && foes.has(s.clan) && !s.occupied);
  if (goal) return { x: goal.x, y: goal.y, town: goal };
  const theirs = live(sim).filter((s) => foes.has(s.clan) && !(s.occupied && friends.has(s.occupied.by)));
  const capitals = new Set([...foes].map((f) => sim.clans.find((q) => q.id === f)?.realm?.capital));
  const t = theirs.sort((p, q) => c.dist(a.x, a.y, p.x, p.y) * (capitals.has(p.id) ? 0.6 : 1) - c.dist(a.x, a.y, q.x, q.y) * (capitals.has(q.id) ? 0.6 : 1))[0];
  return t ? { x: t.x, y: t.y, town: t } : home ? { x: home.x, y: home.y } : null;
}

function nearestName(c: WarContext, x: number, y: number): string {
  const t = live(c.sim).sort((p, q) => c.dist(x, y, p.x, p.y) - c.dist(x, y, q.x, q.y))[0];
  if (t && c.dist(x, y, t.x, t.y) < 120) return t.name;
  const k = c.cellAt(x, y);
  const env = c.env;
  return k >= 0 && env.mzone[k] >= 2 ? 'the Heights' : k >= 0 && env.fresh[k] ? 'the River' : 'the Plain';
}

/** How a side's strength in a fight is set: fighters, their might and arms, morale, and the ground (defenders gain on hills and behind rivers). */
function power(c: WarContext, clan: Clan | undefined, men: number, morale: number, defending: boolean, x: number, y: number): number {
  if (!clan) return men;
  const k = c.cellAt(x, y);
  let ground = 1;
  if (defending && k >= 0) {
    if (c.env.mzone[k] >= 1) ground *= 1.15 + 0.05 * Math.min(3, c.env.mzone[k]);
    if (c.env.fresh[k]) ground *= 1.25;
  }
  return men * c.might(clan.race, clan.culture) * armsOf(c, clan) * clamp(morale, 0.2, 1.2) * ground * (0.7 + 0.6 * c.rand());
}

function record(c: WarContext, war: War, b: Battle): void {
  const { sim } = c;
  (sim.battles ??= []).push(b);
  if (sim.battles.length > 120) sim.battles.splice(0, sim.battles.length - 120);
  war.battles++;
  const aSide = sideOf(war, b.a.clan);
  const lostAtt = aSide === 'attackers' ? b.a.lost : b.b.lost;
  const lostDef = aSide === 'attackers' ? b.b.lost : b.a.lost;
  war.losses.attackers += lostAtt;
  war.losses.defenders += lostDef;
  const winAtt = sideOf(war, b.winner) === 'attackers';
  war.score = clamp(war.score + (winAtt ? 1 : -1) * (6 + 14 * (winAtt ? lostDef : lostAtt) / Math.max(1, lostAtt + lostDef)), -100, 100);
  // Losses wear on each realm.
  for (const [clanId, lost] of [[b.a.clan, b.a.lost], [b.b.clan, b.b.lost]] as const) {
    const cl = sim.clans.find((q) => q.id === clanId);
    if (!cl) continue;
    // Against all its people (those at home and in its armies); no one battle wears a realm out.
    const pop = towns(sim, clanId).reduce((n, s) => n + s.pop, 0) + (sim.armies ?? []).filter((a) => a.clan === clanId).reduce((n, a) => n + a.men, 0);
    war.weariness[clanId] = clamp((war.weariness[clanId] ?? 0) + Math.min(0.2, (3 * lost) / Math.max(300, pop)), 0, 2);
  }
}

/** Two armies meet. */
function fieldBattle(c: WarContext, war: War, A: Army, B: Army): void {
  const { sim, lib } = c;
  const ca = sim.clans.find((q) => q.id === A.clan);
  const cb = sim.clans.find((q) => q.id === B.clan);
  const k = c.cellAt(B.x, B.y);
  // The side on its own land, or holding its ground, defends.
  const bDefends = k >= 0 && sim.owner[k] === B.clan;
  const pa = power(c, ca, A.men, A.morale, !bDefends, A.x, A.y);
  const pb = power(c, cb, B.men, B.morale, bDefends, B.x, B.y);
  const aWins = pa > pb;
  const edge = Math.max(pa, pb) / Math.max(1, Math.min(pa, pb));
  const loseW = (0.04 + 0.08 * c.rand()) / Math.min(2, edge);
  const loseL = Math.min(0.6, (0.15 + 0.15 * c.rand()) * Math.min(2, edge));
  const [W, L] = aWins ? [A, B] : [B, A];
  const lw = Math.round(W.men * loseW);
  const ll = Math.round(L.men * loseL);
  const before = { a: A.men, b: B.men };
  W.men -= lw;
  L.men -= ll;
  W.morale = Math.min(1.2, W.morale + 0.1);
  L.morale -= 0.3;
  if (L.morale < 0.4 || L.men < L.raised * 0.3) L.goal = 'home';
  if (ca && cb) noteBetween(sim, ca.culture, cb.culture, 'fights');
  const name = `Battle of ${nearestName(c, B.x, B.y)}`;
  record(c, war, { id: sim.nextId++, war: war.id, name, x: B.x, y: B.y, day: sim.day, a: { clan: A.clan, army: A.name, men: before.a, lost: aWins ? lw : ll }, b: { clan: B.clan, army: B.name, men: before.b, lost: aWins ? ll : lw }, winner: W.clan });
  const wc = sim.clans.find((q) => q.id === W.clan)!;
  c.log(`${name} (${war.name}): the ${W.name} of ${realmName(lib, wc)} beat the ${L.name}; ${lw.toLocaleString()} and ${ll.toLocaleString()} fell.${L.goal === 'home' ? ` The ${L.name} falls back.` : ''}`, B.x, B.y);
  A.supply = Math.max(0, A.supply);
}

/** An army falls on a town: its guards (behind walls) or the enemy holding it. Winning, the army takes it (or frees it). */
function assault(c: WarContext, war: War, a: Army, st: Settlement): void {
  const { sim, lib } = c;
  const clan = sim.clans.find((q) => q.id === a.clan);
  const owner = sim.clans.find((q) => q.id === st.clan);
  const freeing = !!st.occupied && sideOf(war, st.clan) === sideOf(war, a.clan);
  const holder = freeing ? sim.clans.find((q) => q.id === st.occupied!.by) : owner;
  // The town's guards, and its townsfolk on the walls (half as strong).
  const guards = freeing ? st.occupied!.garrison : Math.max(1, st.warband + st.pop * 0.05);
  const walls = !freeing ? wallsMight((id) => knows(lib, st, id)) : 1;
  const pa = power(c, clan, a.men, a.morale, false, st.x, st.y);
  const pd = power(c, holder, guards, 1, true, st.x, st.y) * walls * 1.2;
  const win = pa > pd;
  const edge = Math.max(pa, pd) / Math.max(1, Math.min(pa, pd));
  const lostA = Math.round(a.men * (win ? 0.04 + 0.06 * c.rand() : 0.15 + 0.15 * c.rand()) * (win ? 1 / Math.min(2, edge) : Math.min(2, edge)) * walls);
  const lostD = Math.round(guards * (win ? 0.5 + 0.3 * c.rand() : 0.05 + 0.1 * c.rand()));
  a.men -= lostA;
  if (freeing) st.occupied!.garrison -= lostD;
  else {
    st.warband = Math.max(0, st.warband - lostD);
    st.pop = Math.max(10, st.pop - lostD);
  }
  const name = `Assault on ${st.name}`;
  record(c, war, { id: sim.nextId++, war: war.id, name, x: st.x, y: st.y, day: sim.day, a: { clan: a.clan, army: a.name, men: a.men + lostA, lost: lostA }, b: { clan: holder?.id ?? st.clan, army: freeing ? 'its garrison' : `the guards of ${st.name}`, men: guards, lost: lostD }, winner: win ? a.clan : holder?.id ?? st.clan, town: st.id });
  if (!win) {
    a.morale -= 0.15;
    if (a.morale < 0.4) a.goal = 'home';
    c.log(`${name} (${war.name}) failed: the ${a.name} lost ${lostA.toLocaleString()}.`, st.x, st.y);
    return;
  }
  if (freeing) {
    delete st.occupied;
    c.log(`The ${a.name} freed ${st.name} (${war.name}).`, st.x, st.y);
    return;
  }
  // Taken: a garrison stays; the army eats from its stores.
  const garrison = Math.max(20, Math.round(a.men * 0.1));
  a.men -= garrison;
  st.occupied = { by: a.clan, war: war.id, since: sim.day, garrison };
  a.supply += takeFood(c, st, a.men * 2);
  if (owner && clan) noteBetween(sim, clan.culture, owner.culture, 'fights');
  const cap = owner?.realm?.capital === st.id;
  c.log(`The ${a.name} took ${st.name}${cap ? `, the capital of ${owner ? realmName(lib, owner) : '?'}` : ''} (${war.name}).`, st.x, st.y);
}

/** Each day: armies march, eat, forage or starve, and fight what they meet. */
export function armiesDay(c: WarContext): void {
  const { sim, env } = c;
  if (!sim.armies?.length) return;
  const sIdx = northernSummer(sim.day) ? 0 : 1;
  for (const a of [...sim.armies]) {
    if (!sim.armies.includes(a)) continue;
    const war = (sim.wars ?? []).find((w) => w.id === a.war);
    const clan = sim.clans.find((q) => q.id === a.clan);
    if (!clan) {
      sim.armies = sim.armies.filter((q) => q !== a);
      continue;
    }
    if (!war || war.ended !== undefined) a.goal = 'home';
    type Dest = { x: number; y: number; town?: Settlement; army?: Army };
    const homeDest = (): Dest | null => {
      const h = capitalOf(sim, clan);
      return h ? { x: h.x, y: h.y } : null;
    };
    const to: Dest | null = war ? chooseTarget(c, a, war) : homeDest();
    if (!to) {
      disband(c, a);
      continue;
    }
    a.target = to.town?.id ?? to.army?.id ?? -1;
    // March.
    const k = c.cellAt(a.x, a.y);
    const slow = k >= 0 ? [1, 0.8, 0.6, 0.4, 0.3][env.mzone[k]] : 1;
    const cold = k >= 0 && env.temp[sIdx][k] < 0 ? 0.6 : 1;
    const ford = k >= 0 && env.fresh[k] && !sim.bridge?.[k] ? 1 / FORD_SLOW : 1;
    const step = c.speed(clan.race, clan.culture) * slow * cold * ford * (k >= 0 ? WAYS[sim.way[k]].speed : 1) * (a.supply <= 0 ? 0.8 : 1);
    const d = c.dist(a.x, a.y, to.x, to.y);
    if (d > step) {
      a.x += ((to.x - a.x) * step) / d;
      a.y += ((to.y - a.y) * step) / d;
    } else {
      a.x = to.x;
      a.y = to.y;
    }
    // Eat: a fighter eats a unit a month; the land feeds some, its own towns more.
    const need = a.men / DAYS_PER_MONTH;
    const forage = k >= 0 && env.land[k] ? Math.min(0.6, (0.4 * env.plant[sIdx][k]) / PLANT_K) : 0;
    a.supply -= need * (1 - forage);
    if (a.supply < need * 10 && k >= 0 && sim.owner[k] === a.clan) {
      const st = towns(sim, a.clan).filter((s) => !s.occupied).sort((p, q) => c.dist(a.x, a.y, p.x, p.y) - c.dist(a.x, a.y, q.x, q.y))[0];
      if (st && c.dist(a.x, a.y, st.x, st.y) < 120) a.supply += takeFood(c, st, a.men);
    }
    if (a.supply < 0) {
      // Hunger: sickness and desertion.
      a.supply = 0;
      a.men = Math.floor(a.men * 0.99);
      a.morale -= 0.01;
    }
    // Arrived home (going home): disband.
    if (a.goal === 'home') {
      const h = capitalOf(sim, clan);
      if (!h || c.dist(a.x, a.y, h.x, h.y) < 5) disband(c, a);
      continue;
    }
    if (!war) continue;
    if (a.men < 15 || a.morale < 0.25) {
      a.goal = 'home';
      continue;
    }
    // Meeting an enemy army.
    const foes = new Set(sideOf(war, a.clan) === 'attackers' ? war.defenders : war.attackers);
    const rested = (q: Army) => sim.day - (q.lastFight ?? -1e9) >= 7;
    const enemy = rested(a) ? sim.armies.find((e) => e !== a && e.war === war.id && foes.has(e.clan) && e.goal !== 'home' && rested(e) && c.dist(a.x, a.y, e.x, e.y) < 15) : undefined;
    if (enemy) {
      a.lastFight = sim.day;
      enemy.lastFight = sim.day;
      fieldBattle(c, war, a, enemy);
      continue;
    }
    // At a town: invest it, then assault.
    if (to.town && c.dist(a.x, a.y, to.town.x, to.town.y) < 5) {
      if (!a.siege || a.siege.town !== to.town.id) a.siege = { town: to.town.id, days: 0 };
      a.siege.days++;
      // A week for a village, longer for a town, far longer behind walls (sieges proper come in step 3).
      const need = (7 + to.town.pop / 50) * (to.town.occupied ? 1 : wallsMight((id) => knows(c.lib, to.town!, id)) ** 3);
      if (a.siege.days >= need && rested(a)) {
        a.lastFight = sim.day;
        delete a.siege;
        assault(c, war, a, to.town);
      }
    } else delete a.siege;
  }
}

// ---------------------------------------------------------------------------------------------
// Weariness and peace

/** Cede a town to another realm, with the land round it; the old realm keeps a claim. */
function cede(c: WarContext, st: Settlement, to: number): void {
  const { sim, env } = c;
  const from = st.clan;
  st.claimedBy = [...new Set([...(st.claimedBy ?? []), from])].filter((q) => q !== to);
  st.clan = to;
  delete st.occupied;
  st.unrest = 0;
  const left = towns(sim, from);
  for (let k = 0; k < env.n; k++) {
    if (sim.owner[k] !== from) continue;
    const x = env.x0 + (k % env.w) * env.step;
    const y = env.y0 + ((k / env.w) | 0) * env.step;
    const d = c.dist(x, y, st.x, st.y);
    if (d < 80 && left.every((o) => c.dist(x, y, o.x, o.y) > d)) sim.owner[k] = to;
  }
}

function makePeace(c: WarContext, war: War, winner: 'attackers' | 'defenders' | null): void {
  const { sim, lib } = c;
  const leader = (side: 'attackers' | 'defenders') => sim.clans.find((q) => q.id === war[side][0]);
  const A = leader('attackers');
  const D = leader('defenders');
  const terms: string[] = [];
  const held = live(sim).filter((s) => s.occupied?.war === war.id);
  if (winner) {
    const W = winner === 'attackers' ? war.attackers : war.defenders;
    const loser = winner === 'attackers' ? D : A;
    // Towns held by the winners are ceded to whoever holds them, as many as the win earned
    // (the town the war was for first, then those nearest the winner), up to half the loser's people.
    const L = winner === 'attackers' ? war.defenders : war.attackers;
    const loserPop = live(sim).filter((s) => L.includes(s.clan)).reduce((n, s) => n + s.pop, 0);
    let room = loserPop * Math.min(0.5, 0.15 + Math.abs(war.score) / 200);
    const wcap = capitalOf(sim, winner === 'attackers' ? A : D);
    const taken = held
      .filter((st) => W.includes(st.occupied!.by) && !W.includes(st.clan))
      .sort((p, q) => (p.id === war.goalTown ? -1 : q.id === war.goalTown ? 1 : 0) || (wcap ? c.dist(wcap.x, wcap.y, p.x, p.y) - c.dist(wcap.x, wcap.y, q.x, q.y) : 0));
    for (const st of taken) {
      if (st.pop > room && st.id !== war.goalTown) continue;
      room -= st.pop;
      const to = st.occupied!.by;
      terms.push(`${st.name} to ${realmName(lib, sim.clans.find((q) => q.id === to)!)}`);
      cede(c, st, to);
    }
    // A throne: the winner's claimant takes it.
    if (winner === 'attackers' && war.reason === 'throne' && D?.realm) {
      const q = (D.realm.claimants ?? []).find((x) => x.house === war.goalHouse);
      if (q) {
        D.realm.ruler = { name: q.name, house: q.house, female: q.female, born: q.born, since: sim.day };
        D.realm.claimants = D.realm.claimants!.filter((x) => x !== q);
        D.realm.family = [];
        D.realm.reigns++;
        terms.push(`${q.name} of the house of ${q.house} takes the throne of ${realmName(lib, D)}`);
      }
    }
    // Payment, when little land changed hands.
    if (terms.length < 1 && loser) {
      const lc = capitalOf(sim, loser);
      const wc = capitalOf(sim, winner === 'attackers' ? A : D);
      if (lc?.economy && wc?.economy) {
        let worth = 0;
        for (const [id, v] of Object.entries(lc.economy.stores)) {
          const t = v * 0.3;
          lc.economy.stores[id] = v - t;
          wc.economy.stores[id] = (wc.economy.stores[id] ?? 0) + t;
          worth += t;
        }
        if (worth > 0) terms.push(`${realmName(lib, loser)} pays ${Math.round(worth).toLocaleString()} units of goods`);
      }
    }
  }
  // All other occupations end.
  for (const st of live(sim)) if (st.occupied?.war === war.id) delete st.occupied;
  // A truce between every pair on opposite sides.
  for (const a of war.attackers) for (const d of war.defenders) relation(sim, a, d).truceUntil = sim.day + 15 * DAYS_PER_YEAR;
  for (const a of sim.armies ?? []) if (a.war === war.id) a.goal = 'home';
  war.ended = sim.day;
  const who = winner ? (winner === 'attackers' ? A : D) : null;
  war.outcome = who ? `${realmName(lib, who)} won${terms.length ? `: ${terms.join('; ')}` : ''}.` : 'A white peace: nothing changed hands.';
  const cap = capitalOf(sim, D);
  c.log(`The ${war.name} has ended. ${war.outcome}`, cap?.x, cap?.y);
  // A realm left with no towns has fallen (its fate, and its rulers', come with conquest in step 3).
  const loserClan = winner === 'attackers' ? D : winner === 'defenders' ? A : undefined;
  if (loserClan && !towns(sim, loserClan.id).length && who) c.log(`${realmName(lib, loserClan)} has fallen to ${realmName(lib, who)}.`);
}

/** Each month: weariness grows; a worn-out or badly beaten side makes peace; realms at war without an army raise one. */
export function warsMonth(c: WarContext): void {
  const { sim } = c;
  for (const war of activeWars(sim)) {
    // Drop realms that are gone.
    war.attackers = war.attackers.filter((q) => sim.clans.some((x) => x.id === q));
    war.defenders = war.defenders.filter((q) => sim.clans.some((x) => x.id === q));
    if (!war.attackers.length || !war.defenders.length) {
      makePeace(c, war, war.attackers.length ? 'attackers' : war.defenders.length ? 'defenders' : null);
      continue;
    }
    // Score from towns held.
    const held = live(sim).filter((s) => s.occupied?.war === war.id);
    const popOf = (side: number[]) => live(sim).filter((s) => side.includes(s.clan)).reduce((n, s) => n + s.pop, 0) || 1;
    const attHeld = held.filter((s) => war.attackers.includes(s.occupied!.by)).reduce((n, s) => n + s.pop, 0) / popOf(war.defenders);
    const defHeld = held.filter((s) => war.defenders.includes(s.occupied!.by)).reduce((n, s) => n + s.pop, 0) / popOf(war.attackers);
    const capTaken = (side: number[], by: number[]) => held.some((s) => by.includes(s.occupied!.by) && side.some((q) => sim.clans.find((x) => x.id === q)?.realm?.capital === s.id));
    const towardTowns = 70 * attHeld + (capTaken(war.defenders, war.attackers) ? 25 : 0) - 70 * defHeld - (capTaken(war.attackers, war.defenders) ? 25 : 0);
    war.score = clamp(war.score + (towardTowns - war.score) * 0.1, -100, 100);
    for (const clanId of [...war.attackers, ...war.defenders]) {
      const att = war.attackers.includes(clanId);
      const lostShare = att ? defHeld : attHeld;
      const fervent = realmFaith(sim, sim.clans.find((x) => x.id === clanId))?.fervour ?? 0.5;
      const holy = war.reason === 'holy' ? 0.7 + 0.3 * (1 - fervent) : 1;
      war.weariness[clanId] = clamp((war.weariness[clanId] ?? 0) + (0.011 + 0.06 * lostShare + (att && war.reason === 'conquest' ? 0.004 : 0)) * holy, 0, 2);
    }
    const wa = war.weariness[war.attackers[0]] ?? 0;
    const wd = war.weariness[war.defenders[0]] ?? 0;
    const months = (sim.day - war.started) / DAYS_PER_MONTH;
    if ((war.score >= 85 && months >= 6) || wd >= 1) makePeace(c, war, war.score > -15 ? 'attackers' : null);
    else if ((war.score <= -85 && months >= 6) || wa >= 1) makePeace(c, war, war.score < 15 ? 'defenders' : null);
    else if (sim.day - war.started > 15 * DAYS_PER_YEAR) makePeace(c, war, Math.abs(war.score) < 30 ? null : war.score > 0 ? 'attackers' : 'defenders');
    if (war.ended !== undefined) continue;
    // Realms in it without an army raise one (not too often, and not when worn out).
    for (const clanId of [...war.attackers, ...war.defenders]) {
      if ((sim.armies ?? []).some((a) => a.clan === clanId && a.war === war.id)) continue;
      if ((war.weariness[clanId] ?? 0) > 0.8) continue;
      const lastLost = (sim.battles ?? []).filter((b) => b.war === war.id && (b.a.clan === clanId || b.b.clan === clanId)).pop();
      if (lastLost && sim.day - lastLost.day < 4 * DAYS_PER_MONTH) continue;
      const clan = sim.clans.find((x) => x.id === clanId);
      if (clan) raiseArmy(c, clan, war);
    }
  }
}

