import type { NobleHouse, Polity, Ruler, Settlement } from '../types';
import type { World } from '../world';
import { controlRange } from './migration';
import { startWar, transferSettlement } from './politics';

const LOYALTY_TRAITS: Record<string, number> = { just: 0.1, cruel: -0.1, weak: -0.15, pious: 0.03, ambitious: -0.04, warlike: 0.03, builder: 0.03 };

/** Noble houses of a nation, besides the ruling dynasty. */
export function greatHouses(world: World, p: Polity): NobleHouse[] {
  return world.nobles.filter((h) => h.extinct === null && h.polityId === p.id && h.id !== p.dynasty);
}

function hasNobility(p: Polity): boolean {
  return p.government !== 'tribe';
}

function foundHouse(world: World, p: Polity, seat: Settlement, head?: string): NobleHouse {
  const rng = world.rng;
  const lang = world.cultures[seat.cultureId].language;
  const house: NobleHouse = {
    id: world.nobles.length,
    name: `House ${world.names.polity(rng, lang)}`,
    polityId: p.id,
    seatId: seat.id,
    prestige: Math.sqrt(seat.pop) / 10,
    loyalty: rng.range(0.55, 0.85),
    ambition: rng.range(0.1, 0.9),
    head: head ?? world.names.person(rng, lang),
    founded: world.year,
    extinct: null,
    fiefs: 0,
  };
  world.nobles.push(house);
  return house;
}

/** Make `house` the ruling dynasty of `p`. */
function crown(world: World, p: Polity, house: NobleHouse): void {
  p.dynasty = house.id;
  house.polityId = p.id;
  house.seatId = p.capitalId;
  house.loyalty = 1;
  p.ruler.houseId = house.id;
}

/** The fiefs a house holds and the share of the nation's people living in them. */
function fiefsOf(world: World, p: Polity, h: NobleHouse): { fiefs: Settlement[]; share: number } {
  const fiefs = p.settlementIds.map((id) => world.settlements[id]).filter((s) => s.holder === h.id && s.id !== p.capitalId);
  const pop = fiefs.reduce((n, s) => n + s.pop, 0);
  return { fiefs, share: pop / Math.max(1, p.pop) };
}

/**
 * Nobility, once a year. Every nation past the tribal stage has a ruling dynasty; larger
 * nations grow great houses seated in their chief towns, and every settlement is held as a
 * fief by the nearest house or directly by the crown. Houses gain prestige with their fiefs
 * and grow loyal or restless with the ruler's character, the nation's fortunes and their own
 * ambition. Disloyal, powerful houses plot: they seize the throne, break away with their fiefs
 * to found a realm of their own, or take their lands over to a hostile neighbour.
 */
export function runNobility(world: World): void {
  const rng = world.rng;
  // Houses whose seat changed hands follow it, or die out with it.
  for (const h of world.nobles) {
    if (h.extinct !== null) continue;
    const seat = world.settlements[h.seatId];
    const owner = world.polities[h.polityId];
    if (!seat.alive || (!owner.alive && h.id === owner.dynasty && !world.polities[seat.polityId].alive)) {
      h.extinct = world.year;
      continue;
    }
    if (seat.polityId !== h.polityId && world.polities[h.polityId].dynasty !== h.id) {
      const q = world.polities[seat.polityId];
      h.polityId = q.id;
      h.loyalty = 0.35;
      if (h.prestige > 3) world.log('nobility', 1, `${h.name} of ${seat.name} bent the knee to its new masters, the ${q.name}.`, { polities: [q.id], settlements: [seat.id] });
    }
  }

  for (const p of [...world.alivePolities()]) {
    if (!p.alive || !hasNobility(p)) continue;
    // The ruling dynasty.
    const dyn = p.dynasty >= 0 ? world.nobles[p.dynasty] : null;
    if (!dyn || dyn.extinct !== null || dyn.polityId !== p.id) {
      const house = foundHouse(world, p, world.settlements[p.capitalId], p.ruler.name);
      crown(world, p, house);
      if (p.pop > 3000) world.log('nobility', 1, `${p.ruler.title} ${p.ruler.name} of the ${p.name} founded ${house.name}, a new ruling dynasty.`, { polities: [p.id] });
    } else dyn.seatId = p.capitalId;

    // Great houses rise in the nation's chief towns.
    const houses = greatHouses(world, p);
    const wanted = p.government === 'republic' ? Math.min(6, Math.floor(p.settlementIds.length / 3)) : Math.min(8, Math.floor(p.settlementIds.length / 4));
    if (houses.length < wanted && rng.chance(0.3)) {
      const seats = new Set(houses.map((h) => h.seatId));
      const cand = p.settlementIds
        .map((id) => world.settlements[id])
        .filter((s) => s.id !== p.capitalId && !seats.has(s.id) && s.pop > 400)
        .sort((a, b) => b.pop - a.pop)[0];
      if (cand) {
        const h = foundHouse(world, p, cand);
        houses.push(h);
        world.log('nobility', 1, `${h.name} rose to greatness at ${cand.name} in the ${p.name}.`, { polities: [p.id], settlements: [cand.id] });
      }
    }

    // Fiefs: each settlement is held by the nearest noble seat within reach, or by the crown.
    const reach = controlRange(world, p.id) * 0.8;
    for (const h of houses) h.fiefs = 0;
    for (const id of p.settlementIds) {
      const s = world.settlements[id];
      if (id === p.capitalId) {
        s.holder = p.dynasty;
        continue;
      }
      let best = -1;
      let bd = reach;
      for (const h of houses) {
        const seat = world.settlements[h.seatId];
        const d = Math.hypot(s.x - seat.x, s.y - seat.y);
        if (d < bd) {
          bd = d;
          best = h.id;
        }
      }
      s.holder = best;
      if (best >= 0) world.nobles[best].fiefs++;
    }

    // Prestige and loyalty.
    let traitMood = 0;
    for (const t of p.ruler.traits) traitMood += LOYALTY_TRAITS[t] ?? 0;
    for (const h of houses) {
      const { share } = fiefsOf(world, p, h);
      const seat = world.settlements[h.seatId];
      h.prestige += (Math.sqrt(p.pop * share + seat.pop) / 10 - h.prestige) * 0.2;
      let target = 0.62 + traitMood + (p.stability - 0.5) * 0.5 - h.ambition * 0.25 - p.warExhaustion * 0.3 - Math.max(0, share - 0.15);
      if (seat.cultureId !== p.cultureId) target -= 0.15;
      if (p.tributeTo >= 0 || p.overlord >= 0) target -= 0.08;
      h.loyalty = Math.max(0, Math.min(1, h.loyalty + (target - h.loyalty) * 0.15 + rng.normal() * 0.04));
      if (rng.chance(0.04)) {
        h.head = world.names.person(rng, world.cultures[seat.cultureId].language);
        h.ambition = Math.max(0, Math.min(1, h.ambition * 0.5 + rng.range(0, 0.5)));
      }
    }

    // Plots of disloyal houses.
    for (const h of houses) {
      if (!p.alive || h.extinct !== null || h.polityId !== p.id) continue;
      if (h.loyalty > 0.3 || h.ambition < 0.45) continue;
      const { fiefs, share } = fiefsOf(world, p, h);
      if (share > 0.2 && p.stability < 0.5 && p.government !== 'republic' && rng.chance(0.06 * h.ambition)) {
        usurp(world, p, h);
        break;
      }
      if (share > 0.08 && fiefs.length >= 1 && rng.chance(0.03 * h.ambition * (1 - h.loyalty))) {
        secede(world, p, h, fiefs);
        continue;
      }
      const rival = hostileNeighbour(world, p, h);
      if (rival && rng.chance(0.04 * (1 - h.loyalty))) defect(world, p, h, fiefs, rival);
    }

    // Lesser houses die out now and then.
    for (const h of houses) if (h.extinct === null && rng.chance(0.004)) {
      h.extinct = world.year;
      if (h.prestige > 5) world.log('nobility', 1, `${h.name} of the ${p.name} died out; its lands passed to the crown.`, { polities: [p.id] });
    }
  }
}

function usurp(world: World, p: Polity, h: NobleHouse): void {
  const old = world.nobles[p.dynasty];
  const r = p.ruler;
  r.until = world.year;
  r.fate = `was overthrown by ${h.name}`;
  p.pastRulers.push(r);
  const next = world.newRuler(p);
  next.name = h.head;
  p.ruler = next;
  crown(world, p, h);
  if (old) old.loyalty = 0.15;
  for (const id of p.settlementIds) world.settlements[id].stability -= 0.1;
  world.log('nobility', p.pop > 5000 ? 3 : 2, `${h.name} seized the throne of the ${p.name}: ${r.title} ${r.name}${old ? ` of ${old.name}` : ''} was overthrown and ${next.title} ${next.name} crowned.`, { polities: [p.id] });
}

function secede(world: World, p: Polity, h: NobleHouse, fiefs: Settlement[]): void {
  const seat = world.settlements[h.seatId];
  if (!seat.alive || seat.polityId !== p.id || seat.id === p.capitalId) return;
  const lands = [seat, ...fiefs.filter((s) => s.id !== seat.id)];
  const np = world.createPolity(seat.cultureId, seat, p.id, p.techs);
  np.government = p.government === 'empire' ? 'kingdom' : p.government;
  np.name = world.polityName(np);
  np.ruler.title = world.rulerTitle(np.government, /ess|Queen/.test(np.ruler.title));
  np.ruler.name = h.head;
  np.settlementIds = [];
  for (const s of lands) transferSettlement(world, s, p, np, 0.75);
  np.pop = lands.reduce((n, s) => n + s.pop, 0);
  crown(world, np, h);
  np.relations.set(p.id, -0.45);
  p.relations.set(np.id, -0.45);
  world.log('nobility', lands.length > 2 || np.pop > 5000 ? 3 : 2, `${h.name} renounced its oath to the ${p.name} and broke away with ${lands.map((s) => s.name).join(', ')}, founding the ${np.name}.`, { polities: [np.id, p.id], settlements: lands.map((s) => s.id) });
  if (p.wars.size < 2 && world.rng.chance(0.35 + world.cultures[p.cultureId].values.militarism * 0.3)) startWar(world, p, np, `the treason of ${h.name}`);
}

function hostileNeighbour(world: World, p: Polity, h: NobleHouse): Polity | null {
  const seat = world.settlements[h.seatId];
  let best: Polity | null = null;
  for (const [q, rel] of p.relations) {
    const Q = world.polities[q];
    if (!Q.alive || rel > -0.3 || Q.military < p.military * 0.8) continue;
    const near = Q.settlementIds.some((id) => {
      const o = world.settlements[id];
      return Math.hypot(o.x - seat.x, o.y - seat.y) < 12;
    });
    if (near && (!best || Q.military > best.military)) best = Q;
  }
  return best;
}

function defect(world: World, p: Polity, h: NobleHouse, fiefs: Settlement[], q: Polity): void {
  const seat = world.settlements[h.seatId];
  if (seat.id === p.capitalId) return;
  const lands = [seat, ...fiefs.filter((s) => s.id !== seat.id)];
  for (const s of lands) transferSettlement(world, s, p, q, 0.6);
  h.polityId = q.id;
  h.loyalty = 0.7;
  world.log('defection', lands.length > 2 ? 3 : 2, `${h.name} betrayed the ${p.name} and swore fealty to the ${q.name}, bringing ${lands.map((s) => s.name).join(', ')} with it.`, { polities: [q.id, p.id], settlements: lands.map((s) => s.id) });
}

/**
 * Choose who follows a ruler who has died. Usually the dynasty's heir; if the line fails, the
 * strongest great house claims the throne or a new house is founded. A republic elects its
 * First Consul from among its great families. Returns words to add to the chronicle.
 */
export function succession(world: World, p: Polity, next: Ruler): string {
  if (p.dynasty < 0) return '';
  const rng = world.rng;
  const dyn = world.nobles[p.dynasty];
  const houses = greatHouses(world, p);
  if (p.government === 'republic') {
    if (houses.length && rng.chance(0.7)) {
      const h = rng.pick(houses);
      next.name = h.head;
      next.houseId = h.id;
      crown(world, p, h);
      if (dyn) dyn.loyalty = 0.6;
      return ` of ${h.name}`;
    }
    next.houseId = p.dynasty;
    return dyn ? ` of ${dyn.name}` : '';
  }
  if (rng.chance(p.stability < 0.4 ? 0.8 : 0.93)) {
    next.houseId = p.dynasty;
    return dyn ? ` of ${dyn.name}` : '';
  }
  // The line fails.
  const claimant = houses.sort((a, b) => b.prestige * (1.5 - b.loyalty) - a.prestige * (1.5 - a.loyalty))[0];
  if (claimant && rng.chance(0.7)) {
    next.name = claimant.head;
    crown(world, p, claimant);
    next.houseId = claimant.id;
    if (dyn) dyn.extinct = world.year;
    world.log('nobility', p.pop > 8000 ? 3 : 2, `The line of ${dyn?.name ?? 'the old rulers'} failed in the ${p.name}; ${claimant.name} claimed the throne.`, { polities: [p.id] });
    // Rivals who would not accept the new line.
    for (const h of houses) if (h.id !== claimant.id && h.loyalty < 0.35 && h.ambition > 0.5) h.loyalty -= 0.15;
    return ` of ${claimant.name}`;
  }
  if (dyn) dyn.extinct = world.year;
  const house = foundHouse(world, p, world.settlements[p.capitalId], next.name);
  p.dynasty = house.id;
  house.loyalty = 1;
  next.houseId = house.id;
  world.log('nobility', p.pop > 8000 ? 2 : 1, `${dyn?.name ?? 'The old dynasty'} of the ${p.name} died out; ${next.name} founded ${house.name}.`, { polities: [p.id] });
  return ` of ${house.name}`;
}

/** In a succession crisis, a disloyal great house may break away rather than bow. */
export function crisisSecession(world: World, p: Polity): boolean {
  const cand = greatHouses(world, p).filter((h) => h.loyalty < 0.45).sort((a, b) => b.prestige - a.prestige)[0];
  if (!cand) return false;
  const { fiefs } = fiefsOf(world, p, cand);
  const before = p.settlementIds.length;
  secede(world, p, cand, fiefs);
  return p.settlementIds.length < before;
}
