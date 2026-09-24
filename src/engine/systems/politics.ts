import { GOOD_COUNT, Good } from '../data/economy';
import { adjectiveOf } from '../names';
import type { Government, Polity, Settlement, War } from '../types';
import { pairKey, type World } from '../world';
import { controlRange } from './migration';
import { updatePolicies } from './access';
import { endAllDeals, runAgreements } from './agreements';
import { raiseArmies } from './military';

const GOV_STABILITY: Record<Government, number> = {
  tribe: 0.1, chiefdom: 0.03, 'city-state': 0.06, kingdom: 0.04, empire: -0.02, republic: 0.03, theocracy: 0.07,
};
const TRAIT_STABILITY: Record<string, number> = { just: 0.06, cruel: -0.06, weak: -0.08, pious: 0.03, builder: 0.02 };
const TRAIT_AGGRESSION: Record<string, number> = { warlike: 0.3, ambitious: 0.2, cruel: 0.12, merchant: -0.12, scholarly: -0.05, pious: 0.03 };
const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X', ' XI', ' XII'];

export function runPolitics(world: World): void {
  refreshPolities(world);
  updateStability(world);
  updateGovernments(world);
  updateRulers(world);
  updateRelations(world);
  const pairs = contactPairs(world);
  updatePolicies(world, pairs);
  runAgreements(world, pairs);
  declareWars(world);
  raiseArmies(world);
  resolveWars(world);
  rebellions(world);
  unions(world);
}

/** Remove `n` people from a settlement, proportionally across races. */
export function killPop(s: Settlement, n: number): void {
  if (s.pop <= 0 || n <= 0) return;
  const f = Math.max(0, 1 - n / s.pop);
  let pop = 0;
  for (const r in s.races) {
    s.races[r] *= f;
    pop += s.races[r];
  }
  s.pop = pop;
}

export function refreshPolities(world: World): void {
  for (const p of world.polities) {
    p.settlementIds = [];
    p.pop = 0;
  }
  for (const s of world.aliveSettlements()) {
    const p = world.polities[s.polityId];
    p.settlementIds.push(s.id);
    p.pop += s.pop;
  }
  for (const p of world.alivePolities()) {
    if (p.settlementIds.length === 0) {
      dissolve(world, p, `The ${p.name} passed from history.`);
      continue;
    }
    const capital = world.settlements[p.capitalId];
    if (!capital.alive || capital.polityId !== p.id) {
      const nc = p.settlementIds.map((id) => world.settlements[id]).reduce((a, b) => (b.pop > a.pop ? b : a));
      p.capitalId = nc.id;
      world.log('polity', 2, `The ${p.name} moved its seat of power to ${nc.name}.`, { polities: [p.id], settlements: [nc.id] });
    }
    // Dominant culture follows the population.
    const byCulture = new Map<number, number>();
    for (const id of p.settlementIds) {
      const s = world.settlements[id];
      byCulture.set(s.cultureId, (byCulture.get(s.cultureId) ?? 0) + s.pop);
    }
    let dom = p.cultureId;
    let domPop = byCulture.get(p.cultureId) ?? 0;
    for (const [c, n] of byCulture) if (n > domPop * 1.3) {
      dom = c;
      domPop = n;
    }
    if (dom !== p.cultureId) {
      const old = world.cultures[p.cultureId];
      p.cultureId = dom;
      world.log('culture', 2, `The ${world.cultures[dom].adjective} majority now shaped the ${p.name}, eclipsing its ${old.adjective} founders.`, { polities: [p.id], cultures: [dom, old.id] });
    }
    // Military strength.
    const culture = world.cultures[p.cultureId];
    let mil = 0;
    for (const id of p.settlementIds) {
      const s = world.settlements[id];
      const race = world.majorityRace(s);
      const weapons = Math.min(1, s.stock[Good.Weapons] / (s.pop * 0.02 + 1));
      const horses = Math.min(1, s.stock[Good.Horses] / (s.pop * 0.004 + 1));
      const mob = 0.04 + 0.08 * culture.values.militarism;
      const trait = world.cultures[s.cultureId].traitEffects.military;
      mil += s.pop * mob * race.military * (1 + p.effects.military + trait) * (1 + weapons * (0.3 + 0.2 * s.weaponQuality) + horses * 0.2);
    }
    p.military = mil;
    // The hub is the largest settlement: internal trade and roads converge on it.
    const hub = p.settlementIds.map((id) => world.settlements[id]).reduce((a, b) => (b.pop > a.pop ? b : a));
    if (hub.id !== p.hubId) {
      p.hubId = hub.id;
      world.hubsDirty = true;
    }
    // National accounts: what the nation makes, what it needs, and what it cannot supply itself.
    p.produced.fill(0);
    p.needed.fill(0);
    for (const id of p.settlementIds) {
      const s = world.settlements[id];
      for (let g = 0; g < GOOD_COUNT; g++) {
        p.produced[g] += s.produced[g];
        p.needed[g] += s.target[g] * 0.8;
      }
    }
    for (let g = 0; g < GOOD_COUNT; g++) p.deficit[g] = p.needed[g] > 1 && p.produced[g] < p.needed[g] * 0.75 ? 1 : 0;
    const TARIFF: Record<Government, number> = { tribe: 0.04, chiefdom: 0.08, 'city-state': 0.06, kingdom: 0.12, empire: 0.15, republic: 0.05, theocracy: 0.12 };
    p.tariff = Math.max(0, TARIFF[p.government] - culture.values.mercantilism * 0.06 + culture.values.xenophobia * 0.08);
    p.tariffIncome *= 0.5;
    for (const [k, v] of p.contacts) {
      if (v * 0.7 < 1) p.contacts.delete(k);
      else p.contacts.set(k, v * 0.7);
    }
  }
  // Neighbours learn of each other across their borders even without trade.
  for (const [key, len] of world.borders) {
    const a = world.polities[Math.floor(key / 65536)];
    const b = world.polities[key % 65536];
    if (!a?.alive || !b?.alive) continue;
    a.contacts.set(b.id, (a.contacts.get(b.id) ?? 0) + len * 3);
    b.contacts.set(a.id, (b.contacts.get(a.id) ?? 0) + len * 3);
  }
  for (const p of world.alivePolities()) {
    p.treasury *= 0.98;
    if (p.wars.size === 0) p.warExhaustion = Math.max(0, p.warExhaustion - 0.08);
  }
}

function dissolve(world: World, p: Polity, text: string): void {
  p.alive = false;
  p.dissolved = world.year;
  p.ruler.until = world.year;
  for (const wid of [...p.wars]) endWar(world, world.wars[wid], `${p.name} ceased to exist`);
  for (const partner of [...p.agreements.keys()]) for (const id of p.agreements.get(partner) ?? []) {
    const d = world.agreements[id];
    d.end = world.year;
    d.endReason = `the ${p.name} ceased to exist`;
    world.polities[partner].agreements.delete(p.id);
  }
  p.agreements.clear();
  world.hubsDirty = true;
  world.log('polity', p.pop > 5000 || p.settlementIds.length > 3 ? 3 : p.pop > 800 ? 2 : 1, text, { polities: [p.id] });
}

function updateStability(world: World): void {
  const rng = world.rng;
  const acc = new Map<number, [number, number]>();
  for (const s of world.aliveSettlements()) {
    const p = world.polities[s.polityId];
    const capital = world.settlements[p.capitalId];
    const culture = world.cultures[s.cultureId];
    let target = 0.52 + p.effects.stability * 0.6 + GOV_STABILITY[p.government];
    if (s.cultureId !== p.cultureId) target -= 0.12 * (0.5 + culture.values.xenophobia);
    if (world.majorityRaceId(s) !== world.cultures[p.cultureId].raceId) target -= 0.05;
    target -= (1 - Math.min(1, s.foodRatio)) * 0.8;
    if (s.id === capital.id) target += 0.1;
    else {
      const ratio = Math.hypot(s.x - capital.x, s.y - capital.y) / controlRange(world, p.id);
      target -= 0.25 * Math.max(0, ratio - 1);
    }
    target -= p.warExhaustion * 0.3 + s.plague * 0.3;
    // Overextension: vast realms are hard to hold together.
    target -= Math.min(0.3, Math.max(0, p.settlementIds.length - 10) * 0.006 + Math.max(0, p.pop - 100000) / 1e6);
    for (const t of p.ruler.traits) target += TRAIT_STABILITY[t] ?? 0;
    target += Math.min(0.08, s.greatWorks.length * 0.03);
    s.stability = Math.max(0, Math.min(1, s.stability + (target - s.stability) * 0.15 + rng.normal() * 0.015));
    const a = acc.get(p.id) ?? [0, 0];
    a[0] += s.stability * s.pop;
    a[1] += s.pop;
    acc.set(p.id, a);
  }
  for (const [id, [sum, pop]] of acc) world.polities[id].stability = pop > 0 ? sum / pop : 0.5;
}

function idealGovernment(world: World, p: Polity): Government {
  const n = p.settlementIds.length;
  const v = world.cultures[p.cultureId].values;
  if (!p.techs.has('writing')) return n <= 1 ? 'tribe' : 'chiefdom';
  if (n <= 1) return v.piety > 0.72 && p.techs.has('ancestor_worship') ? 'theocracy' : v.mercantilism > 0.6 ? 'republic' : 'city-state';
  const cultures = new Set(p.settlementIds.map((id) => world.settlements[id].cultureId)).size;
  if ((n >= 12 && (cultures >= 2 || p.pop > 120000)) || (p.government === 'empire' && n >= 8)) return 'empire';
  if (v.piety > 0.72 && p.techs.has('ancestor_worship')) return 'theocracy';
  if (v.mercantilism > 0.62 && v.militarism < 0.5 && p.techs.has('code_of_laws')) return 'republic';
  return 'kingdom';
}

function updateGovernments(world: World): void {
  for (const p of world.alivePolities()) {
    const g = idealGovernment(world, p);
    if (g === p.government || !world.rng.chance(0.15)) continue;
    const oldName = p.name;
    const old = p.government;
    p.government = g;
    p.name = world.polityName(p);
    p.ruler.title = world.rulerTitle(g, /ess|Queen|Empress/.test(p.ruler.title));
    const imp = g === 'empire' ? 3 : p.pop > 3000 ? 2 : 1;
    const verb = g === 'empire' ? 'was proclaimed an empire' : g === 'republic' ? 'overthrew its monarchy and became a republic' : `became a ${g}`;
    world.log('government', imp, `The ${oldName} ${verb}: the ${p.name}${old === 'tribe' ? ' was born' : ''}.`, { polities: [p.id] });
  }
}

function updateRulers(world: World): void {
  const rng = world.rng;
  for (const p of world.alivePolities()) {
    const r = p.ruler;
    const race = world.raceById.get(r.raceId) ?? world.races[0];
    const L = race.lifespan;
    const age = world.year - r.born;
    let pDeath = 0.006 + (age > 0.55 * L ? ((age - 0.55 * L) / (0.45 * L)) ** 2 * 0.3 : 0);
    if (p.wars.size > 0) pDeath += 0.01;
    if (p.stability < 0.35) pDeath += 0.02;
    const termEnd = p.government === 'republic' && world.year - r.since >= 8;
    if (!termEnd && !rng.chance(pDeath)) continue;
    let fate: string;
    if (termEnd) fate = 'stepped down at the end of their term';
    else if (age > 0.75 * L) fate = 'died of old age';
    else if (p.wars.size > 0 && rng.chance(0.4)) fate = 'fell in battle';
    else if (p.stability < 0.4 && rng.chance(0.5)) fate = 'was assassinated';
    else fate = rng.pick(['died of a fever', 'died in a hunting accident', 'died suddenly', 'was lost at sea', 'died of illness']);
    r.until = world.year;
    r.fate = fate;
    p.pastRulers.push(r);
    const next = world.newRuler(p);
    const sameName = p.pastRulers.filter((x) => x.name === next.name || x.name.startsWith(next.name + ' ')).length;
    if (sameName > 0) next.name += ROMAN[Math.min(ROMAN.length - 1, sameName + 1)];
    p.ruler = next;
    const big = p.pop > 20000;
    world.log('ruler', big ? 2 : 1, `${r.title} ${r.name} of the ${p.name} ${fate}${termEnd ? '' : ` after ${world.year - r.since} years`}; ${next.title} ${next.name} (${next.traits.join(', ')}) ${p.government === 'republic' ? 'was elected' : 'took power'}.`, { polities: [p.id] });
    if (!termEnd && p.stability < 0.45 && p.settlementIds.length >= 2 && rng.chance(0.35)) {
      for (const id of p.settlementIds) world.settlements[id].stability -= 0.15;
      world.log('rebellion', 2, `A succession crisis shook the ${p.name} as rival claimants contested the throne of ${next.name}.`, { polities: [p.id] });
    }
  }
}

export function contactPairs(world: World): [number, number][] {
  const keys = new Set<number>();
  for (const k of world.borders.keys()) keys.add(k);
  for (const p of world.alivePolities()) for (const q of p.contacts.keys()) keys.add(pairKey(p.id, q));
  const pairs: [number, number][] = [];
  for (const k of [...keys].sort((a, b) => a - b)) {
    const a = Math.floor(k / 65536);
    const b = k % 65536;
    if (world.polities[a]?.alive && world.polities[b]?.alive) pairs.push([a, b]);
  }
  return pairs;
}

function updateRelations(world: World): void {
  for (const [a, b] of contactPairs(world)) {
    const A = world.polities[a];
    const B = world.polities[b];
    const ca = world.cultures[A.cultureId];
    const cb = world.cultures[B.cultureId];
    let target = 0.1;
    if (ca.id === cb.id) target += 0.3;
    else target -= ((ca.values.xenophobia + cb.values.xenophobia) / 2) * 0.45;
    target += ca.raceId === cb.raceId ? 0.12 : -0.08;
    target += Math.min(0.35, (A.contacts.get(b) ?? 0) / 600);
    const border = world.borders.get(pairKey(a, b)) ?? 0;
    target -= Math.min(0.35, border / 30) * (ca.values.militarism + cb.values.militarism);
    for (const t of [...A.ruler.traits, ...B.ruler.traits]) target -= (TRAIT_AGGRESSION[t] ?? 0) * 0.4;
    // Great powers that share a border become rivals.
    if (border > 0 && A.pop > 30000 && B.pop > 30000) target -= 0.2;
    if (A.agreements.has(b)) target += 0.12;
    if (world.atWar(a, b)) target = -0.8;
    const cur = A.relations.get(b) ?? 0;
    const next = Math.max(-1, Math.min(1, cur + (target - cur) * 0.08 + world.rng.normal() * 0.03));
    A.relations.set(b, next);
    B.relations.set(a, next);
  }
}

function declareWars(world: World): void {
  const rng = world.rng;
  for (const [a, b] of contactPairs(world)) {
    const rel = world.polities[a].relations.get(b) ?? 0;
    if (rel > -0.12 || world.atWar(a, b)) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      const A = world.polities[x];
      const B = world.polities[y];
      if ((A.truces.get(y) ?? -1) > world.year || A.wars.size >= 2 || A.warExhaustion > 0.3) continue;
      const ratio = A.military / Math.max(1, B.military);
      if (ratio < 0.8) continue;
      let aggression = world.cultures[A.cultureId].values.militarism;
      for (const t of A.ruler.traits) aggression += TRAIT_AGGRESSION[t] ?? 0;
      const p = (-rel - 0.1) * Math.max(0, aggression) * 0.12 * Math.min(2, ratio);
      if (!rng.chance(p)) continue;
      const border = world.borders.get(pairKey(x, y)) ?? 0;
      const sameCulture = A.cultureId === B.cultureId;
      const cause = sameCulture ? rng.pick(['a blood feud between their ruling houses', 'a disputed claim of kinship and tribute', 'rival claims to the same ancestral lands'])
        : border > 0 ? rng.pick(['disputed borderlands', 'raids along the frontier', 'hunger for fertile land'])
        : rng.pick(['a bitter trade rivalry', 'an insult to their envoys', 'fear of a rising power']);
      startWar(world, A, B, cause);
      break;
    }
  }
}

export function startWar(world: World, A: Polity, B: Polity, cause: string): War {
  const rng = world.rng;
  const nameOptions = [
    `The ${adjectiveOf(A.baseName)}-${adjectiveOf(B.baseName)} War`,
    `The War of ${world.settlements[B.capitalId].name}`,
    `The ${rng.pick(['Crimson', 'Long', 'Bitter', 'Ashen', 'Iron', 'Hollow', 'Winter', 'Thorn', 'Broken Crown', 'Sorrowful'])} War`,
  ];
  const war: War = {
    id: world.wars.length,
    name: rng.pick(nameOptions),
    attacker: A.id,
    defender: B.id,
    start: world.year,
    end: null,
    outcome: null,
    battles: 0,
    attackerLosses: 0,
    defenderLosses: 0,
    conquered: [],
  };
  world.wars.push(war);
  endAllDeals(world, A.id, B.id, 'war broke out between them');
  A.wars.add(war.id);
  B.wars.add(war.id);
  const imp = A.pop + B.pop > 8000 && Math.min(A.pop, B.pop) > 1500 ? 3 : A.pop + B.pop > 2000 ? 2 : 1;
  world.log('war', imp, `${war.name} began: the ${A.name} (${A.ruler.title} ${A.ruler.name}) marched on the ${B.name} over ${cause}.`, { polities: [A.id, B.id] });
  return war;
}

function endWar(world: World, war: War, outcome: string): void {
  if (war.end !== null) return;
  war.end = world.year;
  war.outcome = outcome;
  const A = world.polities[war.attacker];
  const B = world.polities[war.defender];
  A.wars.delete(war.id);
  B.wars.delete(war.id);
  const truce = world.year + world.rng.int(15, 35);
  A.truces.set(B.id, truce);
  B.truces.set(A.id, truce);
  A.relations.set(B.id, -0.25);
  B.relations.set(A.id, -0.25);
  for (const army of world.armies) if (army.warId === war.id) army.alive = false;
  world.armies = world.armies.filter((a) => a.alive);
}

export function spreadLosses(world: World, p: Polity, n: number): void {
  if (p.pop <= 0) return;
  for (const id of p.settlementIds) {
    const s = world.settlements[id];
    if (s.alive) killPop(s, (n * s.pop) / p.pop);
  }
}

/** Transfer a conquered settlement to the victor. */
export function captureSettlement(world: World, war: War, att: Polity, def: Polity, target: Settlement, by: string): void {
  const wasCapital = def.capitalId === target.id;
  target.polityId = att.id;
  target.stability = 0.25;
  att.treasury += target.wealth * 0.4;
  target.wealth *= 0.5;
  war.conquered.push(target.id);
  def.settlementIds = def.settlementIds.filter((id) => id !== target.id);
  att.settlementIds.push(target.id);
  def.pop -= target.pop;
  att.pop += target.pop;
  world.territoryDirty = true;
  world.hubsDirty = true;
  world.log('conquest', (wasCapital && def.pop > 3000) || target.pop > 5000 ? 3 : wasCapital || target.pop > 800 ? 2 : 1, `${by.charAt(0).toUpperCase() + by.slice(1)} of the ${att.name} stormed ${target.name}${wasCapital ? `, capital of the ${def.name}` : ` and took it from the ${def.name}`}.`, { polities: [att.id, def.id], settlements: [target.id] });
  if (wasCapital) def.warExhaustion += 0.25;
  if (def.settlementIds.length === 0) {
    endWar(world, war, `the ${att.name} conquered the ${def.name}`);
    dissolve(world, def, `The ${def.name} fell to the ${att.name}.`);
  }
}

/** Collapsed belligerents end their wars; exhausted ones make peace. The fighting itself is in military.ts. */
function resolveWars(world: World): void {
  const rng = world.rng;
  for (const war of world.wars) {
    if (war.end !== null) continue;
    const A = world.polities[war.attacker];
    const B = world.polities[war.defender];
    if (!A.alive || !B.alive) {
      endWar(world, war, !A.alive ? `${A.name} collapsed` : `${B.name} was destroyed`);
      continue;
    }
    const years = world.year - war.start;
    const fighting = world.armies.some((a) => a.warId === war.id && a.path.length > 0);
    const pPeace = 0.02 + (A.warExhaustion + B.warExhaustion) * 0.3 + years * 0.006 + (fighting || years < 2 ? 0 : 0.12);
    if (rng.chance(pPeace)) {
      const gained = war.conquered.filter((id) => world.settlements[id].alive && world.settlements[id].polityId === A.id).length;
      const lost = war.conquered.filter((id) => world.settlements[id].alive && world.settlements[id].polityId === B.id).length;
      const place = world.settlements[rng.chance(0.5) ? A.capitalId : B.capitalId];
      let outcome: string;
      if (gained > lost) outcome = `the ${A.name} won ${gained} settlement${gained > 1 ? 's' : ''}`;
      else if (lost > gained) outcome = `the ${B.name} turned the tide and took ${lost} settlement${lost > 1 ? 's' : ''}`;
      else outcome = 'neither side gained ground';
      endWar(world, war, outcome);
      A.warExhaustion *= 0.5;
      B.warExhaustion *= 0.5;
      world.log('peace', A.pop + B.pop > 8000 && Math.min(A.pop, B.pop) > 1500 ? 3 : A.pop + B.pop > 2000 ? 2 : 1, `The Treaty of ${place.name} ended ${war.name} after ${years} year${years === 1 ? '' : 's'} and ${war.battles} battle${war.battles === 1 ? '' : 's'}; ${outcome}.`, { polities: [A.id, B.id] });
    }
  }
}

function rebellions(world: World): void {
  const rng = world.rng;
  for (const s of [...world.aliveSettlements()]) {
    const p = world.polities[s.polityId];
    if (!p.alive || p.capitalId === s.id || p.settlementIds.length < 2) continue;
    if (s.stability >= 0.22 || !rng.chance((0.22 - s.stability) * 0.6)) continue;
    const rebels = [s];
    for (const li of s.links) {
      const l = world.links[li];
      const o = world.settlements[l.a === s.id ? l.b : l.a];
      if (o.alive && o.polityId === p.id && o.id !== p.capitalId && o.stability < 0.35 && o.cultureId === s.cultureId) rebels.push(o);
    }
    const np = world.createPolity(s.cultureId, s, p.id, p.techs);
    for (const r of rebels) {
      r.polityId = np.id;
      r.stability = 0.6;
    }
    np.settlementIds = rebels.map((r) => r.id);
    p.settlementIds = p.settlementIds.filter((id) => !rebels.includes(world.settlements[id]));
    np.relations.set(p.id, -0.5);
    p.relations.set(np.id, -0.5);
    world.territoryDirty = true;
    world.hubsDirty = true;
    const imp = rebels.length > 2 || s.pop > 5000 ? 3 : s.pop > 800 ? 2 : 1;
    world.log('rebellion', imp, `${s.name}${rebels.length > 1 ? ` and ${rebels.length - 1} other settlement${rebels.length > 2 ? 's' : ''}` : ''} rose against the ${p.name}, proclaiming the ${np.name}.`, { polities: [np.id, p.id], settlements: rebels.map((r) => r.id) });
    const mil = world.cultures[p.cultureId].values.militarism;
    if (p.wars.size < 2 && rng.chance(0.3 + mil * 0.4)) startWar(world, p, np, 'the need to crush the rebellion');
  }
}

function unions(world: World): void {
  const rng = world.rng;
  for (const p of [...world.alivePolities()]) {
    if (p.settlementIds.length > 2 || !['tribe', 'chiefdom', 'city-state'].includes(p.government) || p.wars.size > 0) continue;
    let best: Polity | null = null;
    for (const [q, rel] of p.relations) {
      const Q = world.polities[q];
      if (!Q.alive || Q.wars.size > 0 || rel < 0.3 || Q.pop < p.pop * 2.5) continue;
      const qc = world.cultures[Q.cultureId];
      const pc = world.cultures[p.cultureId];
      if (qc.id !== pc.id && qc.raceId !== pc.raceId) continue;
      if (!world.borders.has(pairKey(p.id, q)) && (p.contacts.get(q) ?? 0) < 20) continue;
      if (!best || Q.pop > best.pop) best = Q;
    }
    if (!best) continue;
    const chance = 0.02 + (best.government !== 'tribe' ? 0.02 : 0) + (best.cultureId === p.cultureId ? 0.02 : 0);
    if (!rng.chance(chance)) continue;
    for (const id of p.settlementIds) {
      world.settlements[id].polityId = best.id;
      best.settlementIds.push(id);
    }
    best.pop += p.pop;
    p.settlementIds = [];
    world.territoryDirty = true;
    dissolve(world, p, `The ${p.name} swore allegiance to the ${best.name}, joining it peacefully.`);
    world.history[world.history.length - 1].kind = 'union';
    world.history[world.history.length - 1].polities = [p.id, best.id];
  }
}
