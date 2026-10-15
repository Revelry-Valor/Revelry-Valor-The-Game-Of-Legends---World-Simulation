import { adjectiveOf } from '../names';
import type { Pact, Polity, War } from '../types';
import { pairKey, type World } from '../world';
import { absorb, startWar } from './politics';

/** Active pacts between two nations, optionally of one type. */
export function pactsBetween(world: World, a: number, b: number, type?: Pact['type']): Pact[] {
  const out: Pact[] = [];
  for (const id of world.polities[a]?.pacts ?? []) {
    const p = world.pacts[id];
    if (p.end === null && (p.a === b || p.b === b) && (!type || p.type === type)) out.push(p);
  }
  return out;
}

export function sameConfederation(world: World, a: number, b: number): boolean {
  const ca = world.polities[a]?.confederation ?? -1;
  return ca >= 0 && ca === world.polities[b]?.confederation;
}

export function vassalTie(world: World, a: number, b: number): boolean {
  return world.polities[a]?.overlord === b || world.polities[b]?.overlord === a;
}

/** Nations bound together — married, allied, confederated, or lord and vassal — do not fight one another. */
export function friendly(world: World, a: number, b: number): boolean {
  if (a === b) return true;
  return pactsBetween(world, a, b).length > 0 || sameConfederation(world, a, b) || vassalTie(world, a, b);
}

/** Everyone honour-bound to stand with `p` in a war. */
export function alliesOf(world: World, p: Polity): { id: number; bond: string; chance: number }[] {
  const out = new Map<number, { id: number; bond: string; chance: number }>();
  for (const id of p.pacts) {
    const pact = world.pacts[id];
    if (pact.end !== null) continue;
    const other = pact.a === p.id ? pact.b : pact.a;
    out.set(other, { id: other, bond: pact.type === 'marriage' ? 'marriage ties' : 'alliance', chance: pact.type === 'marriage' ? 0.35 : 0.6 });
  }
  if (p.confederation >= 0) {
    for (const m of world.confederations[p.confederation].members) if (m !== p.id) out.set(m, { id: m, bond: 'confederation oath', chance: 0.6 });
  }
  if (p.overlord >= 0) out.set(p.overlord, { id: p.overlord, bond: 'duty to protect its vassal', chance: 0.6 });
  for (const v of world.polities) if (v.alive && v.overlord === p.id) out.set(v.id, { id: v.id, bond: 'duty to its overlord', chance: 0.5 });
  return [...out.values()].filter((x) => world.polities[x.id].alive);
}

/** Can `x` reach `y` to fight it: a shared border or close dealings. */
function inReach(world: World, x: Polity, y: Polity): boolean {
  return world.borders.has(pairKey(x.id, y.id)) || (x.contacts.get(y.id) ?? 0) > 60;
}

/**
 * When war breaks out, the defender's allies, kin by marriage, confederates, overlord and
 * vassals may take up arms against the attacker, if they can reach it; an attacking overlord's
 * vassals on the enemy's borders may be ordered to join in.
 */
export function callToArms(world: World, war: War): void {
  const rng = world.rng;
  const A = world.polities[war.attacker];
  const B = world.polities[war.defender];
  for (const ally of alliesOf(world, B)) {
    const X = world.polities[ally.id];
    if (X.id === A.id || world.atWar(X.id, A.id) || friendly(world, X.id, A.id) || X.wars.size >= 2 || X.warExhaustion > 0.3 || !inReach(world, X, A)) continue;
    if (!rng.chance(ally.chance)) {
      if (ally.chance < 1) world.log('diplomacy', 1, `The ${X.name} ignored the call of the ${B.name} and stayed out of ${war.name}.`, { polities: [X.id, B.id] });
      continue;
    }
    startWar(world, X, A, `its ${ally.bond} with the ${B.name}`, war.id);
  }
  for (const v of world.polities) {
    if (!v.alive || v.overlord !== A.id || world.atWar(v.id, B.id) || friendly(world, v.id, B.id) || v.wars.size >= 2 || !world.borders.has(pairKey(v.id, B.id)) || !rng.chance(0.5)) continue;
    startWar(world, v, B, `the command of its overlord, the ${A.name}`, war.id);
  }
}

function addPact(world: World, type: Pact['type'], a: Polity, b: Polity, name: string): Pact {
  const pact: Pact = { id: world.pacts.length, type, name, a: a.id, b: b.id, start: world.year, end: null, houseA: a.dynasty, houseB: b.dynasty };
  world.pacts.push(pact);
  a.pacts.add(pact.id);
  b.pacts.add(pact.id);
  return pact;
}

export function endPact(world: World, pact: Pact, reason: string, log: boolean): void {
  if (pact.end !== null) return;
  pact.end = world.year;
  pact.endReason = reason;
  world.polities[pact.a].pacts.delete(pact.id);
  world.polities[pact.b].pacts.delete(pact.id);
  if (log) world.log('diplomacy', 2, `${pact.name.charAt(0).toUpperCase() + pact.name.slice(1)} between the ${world.polities[pact.a].name} and the ${world.polities[pact.b].name} came to an end: ${reason}.`, { polities: [pact.a, pact.b] });
}

/** A royal marriage between two ruling houses: an alliance by blood. */
export function arrangeMarriage(world: World, A: Polity, B: Polity, reason: string): Pact | null {
  if (A.dynasty < 0 || B.dynasty < 0 || pactsBetween(world, A.id, B.id, 'marriage').length) return null;
  const rng = world.rng;
  const ha = world.nobles[A.dynasty];
  const hb = world.nobles[B.dynasty];
  const brideA = world.names.person(rng, world.cultures[A.cultureId].language);
  const brideB = world.names.person(rng, world.cultures[B.cultureId].language);
  const pact = addPact(world, 'marriage', A, B, `the marriage of ${brideA} and ${brideB}`);
  const rel = Math.max(0.15, A.relations.get(B.id) ?? 0);
  A.relations.set(B.id, rel);
  B.relations.set(A.id, rel);
  world.log('diplomacy', A.pop + B.pop > 20000 ? 3 : 2, `${brideA} of ${ha.name}, of the ${A.name}, wed ${brideB} of ${hb.name}, of the ${B.name}${reason}; the two realms are bound by blood.`, { polities: [A.id, B.id] });
  return pact;
}

/** A common enemy: stronger than either nation and hostile to both. */
function commonThreat(world: World, A: Polity, B: Polity, factor: number): Polity | null {
  let worst: Polity | null = null;
  for (const [t, rel] of A.relations) {
    const T = world.polities[t];
    if (!T.alive || t === B.id || rel > -0.2 || (B.relations.get(t) ?? 0) > -0.2) continue;
    if (T.military < Math.max(A.military, B.military) * factor) continue;
    if (!worst || T.military > worst.military) worst = T;
  }
  return worst;
}

/**
 * The diplomacy of dynasties and leagues, once a year:
 * royal marriages and defensive alliances between friendly neighbours; confederations of kin
 * nations banding together against a common threat while keeping their own rulers; vassals
 * paying tribute, growing restless, or being folded into their overlord's realm.
 */
export function runDiplomacy(world: World, pairs: [number, number][]): void {
  const rng = world.rng;
  // Review pacts.
  for (const pact of world.pacts) {
    if (pact.end !== null) continue;
    const A = world.polities[pact.a];
    const B = world.polities[pact.b];
    if (!A.alive || !B.alive) endPact(world, pact, 'one of the realms fell', false);
    else if (pact.type === 'marriage' && (A.dynasty !== pact.houseA || B.dynasty !== pact.houseB)) endPact(world, pact, 'the ruling house it joined was overthrown', true);
    else if ((A.relations.get(B.id) ?? 0) < -0.2 && world.year - pact.start > 5) endPact(world, pact, 'bitter quarrels broke it', true);
  }

  for (const [a, b] of pairs) {
    const A = world.polities[a];
    const B = world.polities[b];
    if (!A.alive || !B.alive || world.atWar(a, b) || A.overlord === b || B.overlord === a) continue;
    const rel = A.relations.get(b) ?? 0;
    // Royal marriages.
    if (rel > 0.3 && A.pacts.size < 2 && B.pacts.size < 2 && rng.chance(0.006 * (1 + rel))) arrangeMarriage(world, A, B, '');
    // Defensive alliances against a common threat.
    if (rel > 0.35 && !pactsBetween(world, a, b, 'alliance').length && rng.chance(0.05)) {
      const threat = commonThreat(world, A, B, 1);
      if (threat) {
        const pact = addPact(world, 'alliance', A, B, `the Pact of ${world.settlements[rng.chance(0.5) ? A.capitalId : B.capitalId].name}`);
        world.log('diplomacy', 2, `Fearing the ${threat.name}, the ${A.name} and the ${B.name} swore ${pact.name}: an attack on one is an attack on both.`, { polities: [a, b, threat.id] });
      }
    }
    // Confederations of kin nations.
    const kin = A.cultureId === B.cultureId || world.cultures[A.cultureId].raceId === world.cultures[B.cultureId].raceId;
    if (!kin || rel < 0.4 || A.overlord >= 0 || B.overlord >= 0) continue;
    if (A.confederation < 0 && B.confederation < 0 && rng.chance(0.03)) {
      const threat = commonThreat(world, A, B, 0.8);
      if (!threat) continue;
      const leader = A.pop >= B.pop ? A : B;
      const name = rng.chance(0.5) ? `the ${adjectiveOf(world.cultures[leader.cultureId].name)} League` : `the Confederacy of ${world.settlements[leader.capitalId].name}`;
      const conf = { id: world.confederations.length, name, members: [a, b], leader: leader.id, founded: world.year, dissolved: null };
      world.confederations.push(conf);
      A.confederation = B.confederation = conf.id;
      world.log('diplomacy', 3, `Against the might of the ${threat.name}, the ${A.name} and the ${B.name} joined together as ${name}: one banner, two crowns.`, { polities: [a, b, threat.id] });
    } else if ((A.confederation < 0) !== (B.confederation < 0) && rng.chance(0.04)) {
      const [inside, outside] = A.confederation >= 0 ? [A, B] : [B, A];
      const conf = world.confederations[inside.confederation];
      const leader = world.polities[conf.leader];
      if ((outside.relations.get(leader.id) ?? 0) < 0.2 && leader.id !== outside.id) continue;
      if (conf.members.some((m) => world.atWar(m, outside.id))) continue;
      conf.members.push(outside.id);
      outside.confederation = conf.id;
      world.log('diplomacy', 2, `The ${outside.name} joined ${conf.name}, keeping its own ruler but raising its banner beside its kin.`, { polities: [outside.id, conf.leader] });
    }
  }

  // Confederations hold together or fall apart.
  for (const conf of world.confederations) {
    if (conf.dissolved !== null) continue;
    conf.members = conf.members.filter((m) => world.polities[m].alive && world.polities[m].confederation === conf.id);
    if (conf.members.length) conf.leader = conf.members.reduce((x, y) => (world.polities[y].pop > world.polities[x].pop ? y : x));
    for (const m of [...conf.members]) {
      const M = world.polities[m];
      if (m === conf.leader || (M.relations.get(conf.leader) ?? 0) > -0.1 || !rng.chance(0.3)) continue;
      M.confederation = -1;
      conf.members = conf.members.filter((x) => x !== m);
      world.log('diplomacy', 2, `The ${M.name} broke away from ${conf.name}.`, { polities: [m, conf.leader] });
    }
    if (conf.members.length < 2) {
      conf.dissolved = world.year;
      for (const m of conf.members) world.polities[m].confederation = -1;
      world.log('diplomacy', 2, `${conf.name.charAt(0).toUpperCase() + conf.name.slice(1)} was dissolved.`, { polities: conf.members });
    }
  }

  // Vassals and war tribute.
  for (const p of [...world.alivePolities()]) {
    if (p.tributeTo >= 0) {
      const to = world.polities[p.tributeTo];
      if (!to.alive || world.year > p.tributeUntil) p.tributeTo = -1;
      else {
        const pay = Math.min(p.tributeAmount, Math.max(0, p.treasury));
        p.treasury -= pay;
        to.treasury += pay;
      }
    }
    if (p.overlord < 0) continue;
    const O = world.polities[p.overlord];
    if (!O.alive) {
      p.overlord = -1;
      world.log('diplomacy', 2, `With the fall of its overlord, the ${p.name} was free again.`, { polities: [p.id] });
      continue;
    }
    const tribute = Math.max(0, p.treasury) * 0.08;
    p.treasury -= tribute;
    O.treasury += tribute;
    const rel = p.relations.get(O.id) ?? 0;
    const target = 0.6 + rel * 0.3 - (p.cultureId !== O.cultureId ? 0.2 : 0) - p.warExhaustion * 0.3 + (O.military > p.military * 3 ? 0.1 : -0.1);
    p.vassalLoyalty += (target - p.vassalLoyalty) * 0.1 + rng.normal() * 0.03;
    if (p.vassalLoyalty < 0.3 && p.military > O.military * 0.5 && rng.chance(0.12)) {
      p.overlord = -1;
      world.log('diplomacy', p.pop > 5000 ? 3 : 2, `The ${p.name} cast off the overlordship of the ${O.name} and declared itself independent.`, { polities: [p.id, O.id] });
      if (O.wars.size < 3 && rng.chance(0.6)) startWar(world, O, p, 'the need to bring a rebellious vassal to heel');
    } else if (p.vassalLoyalty > 0.8 && p.cultureId === O.cultureId && rng.chance(0.01)) {
      absorb(world, O, p, `After generations of loyal service, the ${p.name} was folded peacefully into the ${O.name}.`);
    }
  }
}

/** The peace a victor can impose: vassalage for a small beaten realm, tribute from a larger one, sometimes sealed by a marriage. */
export function peaceTerms(world: World, war: War, winner: Polity | null, loser: Polity | null): string {
  const rng = world.rng;
  const parts: string[] = [];
  if (winner && loser && winner.alive && loser.alive) {
    const dominance = winner.military / Math.max(1, loser.military);
    if (loser.settlementIds.length <= 3 && dominance > 2 && loser.overlord < 0 && loser.confederation < 0 && winner.government !== 'tribe' && rng.chance(0.5)) {
      loser.overlord = winner.id;
      loser.vassalLoyalty = 0.4;
      parts.push(`the ${loser.name} became a vassal of the ${winner.name}`);
    } else if (dominance > 1.2) {
      loser.tributeTo = winner.id;
      loser.tributeAmount = Math.max(5, loser.treasury * 0.05 + loser.pop * 0.01);
      loser.tributeUntil = world.year + 20;
      parts.push(`the ${loser.name} must pay tribute to the ${winner.name} for twenty years`);
    }
  }
  const A = world.polities[war.attacker];
  const B = world.polities[war.defender];
  if (A.alive && B.alive && rng.chance(0.15) && arrangeMarriage(world, A, B, ' to seal the peace')) parts.push('the peace was sealed by a royal marriage');
  return parts.length ? `; ${parts.join('; ')}` : '';
}

/** On a ruler's death, a marriage may pass their crown to the allied dynasty, uniting the realms. */
export function marriageInheritance(world: World, p: Polity): boolean {
  const rng = world.rng;
  for (const pact of [...p.pacts].map((id) => world.pacts[id])) {
    if (pact.type !== 'marriage' || pact.end !== null) continue;
    const other = world.polities[pact.a === p.id ? pact.b : pact.a];
    if (!other.alive || other.overlord >= 0 || other.pop < p.pop * 0.5 || !rng.chance(0.12)) continue;
    absorb(world, other, p, `With no heir of their own, the crown of the ${p.name} passed through ${pact.name} to ${other.ruler.title} ${other.ruler.name}: the ${p.name} and the ${other.name} were united under one crown.`);
    world.history[world.history.length - 1].importance = 3;
    return true;
  }
  return false;
}
