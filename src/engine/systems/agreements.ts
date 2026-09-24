import { GOOD_COUNT, GOOD_NAMES } from '../data/economy';
import type { Polity, TradeAgreement } from '../types';
import type { World } from '../world';
import { accessPolicy, dealsBetween } from './access';
import { usesCoin } from './trade';

function addDeal(world: World, deal: Omit<TradeAgreement, 'id' | 'start' | 'end'>): TradeAgreement {
  const d: TradeAgreement = { ...deal, id: world.agreements.length, start: world.year, end: null };
  world.agreements.push(d);
  for (const [x, y] of [[d.a, d.b], [d.b, d.a]]) {
    const p = world.polities[x];
    p.agreements.set(y, [...(p.agreements.get(y) ?? []), d.id]);
  }
  return d;
}

export function endDeal(world: World, d: TradeAgreement, reason: string, log: boolean): void {
  if (d.end !== null) return;
  d.end = world.year;
  d.endReason = reason;
  for (const [x, y] of [[d.a, d.b], [d.b, d.a]]) {
    const p = world.polities[x];
    const left = (p.agreements.get(y) ?? []).filter((id) => id !== d.id);
    if (left.length) p.agreements.set(y, left);
    else p.agreements.delete(y);
  }
  if (log) {
    const A = world.polities[d.a];
    const B = world.polities[d.b];
    world.log('agreement', d.type === 'transit' ? 1 : 2, `${d.name.charAt(0).toUpperCase() + d.name.slice(1)} between the ${A.name} and the ${B.name} came to an end: ${reason}.`, { polities: [d.a, d.b] });
  }
}

export function endAllDeals(world: World, a: number, b: number, reason: string): void {
  for (const d of dealsBetween(world, a, b)) endDeal(world, d, reason, true);
}

/** The value a nation places on a good: the price at its hub, where its trade converges. */
export function nationalValue(world: World, p: Polity, g: number): number {
  return world.settlements[p.hubId]?.price[g] ?? 1;
}

const shortfall = (p: Polity, g: number) => Math.max(0, p.needed[g] - p.produced[g] - p.imported[g]);
const spare = (p: Polity, g: number) => Math.max(0, p.produced[g] - p.needed[g] * 1.25);

/**
 * Diplomacy of trade, once a year for every pair of nations in contact:
 * - Open market accords: friendly, trade-minded neighbours let each other's free traders in toll-free.
 * - Transit rights: a nation shut out of a neighbour's lands asks for passage for its caravans.
 * - Convoy compacts: when free traders cannot bring in enough of something a nation needs, its
 *   rulers strike a state deal with a nation that has it to spare — iron for grain, timber for
 *   silver — and send official convoys each year.
 */
export function runAgreements(world: World, pairs: [number, number][]): void {
  const rng = world.rng;
  for (const [a, b] of pairs) {
    const A = world.polities[a];
    const B = world.polities[b];
    if (!A.alive || !B.alive || world.atWar(a, b)) continue;
    const rel = A.relations.get(b) ?? 0;

    // Review what already exists.
    for (const d of dealsBetween(world, a, b)) {
      if (rel < -0.1 && rng.chance(0.25)) endDeal(world, d, 'relations soured', true);
      else if (d.type === 'transit' && world.year - d.start > 25) endDeal(world, d, 'the grant of passage lapsed', true);
      else if (d.type === 'convoy' && (world.year - d.start) % 10 === 9) {
        const giver = world.polities[d.a];
        const taker = world.polities[d.b];
        if (!taker.deficit[d.giveGood!] || spare(giver, d.giveGood!) <= 0) endDeal(world, d, 'the need had passed', true);
      }
    }
    const merc = (world.cultures[A.cultureId].values.mercantilism + world.cultures[B.cultureId].values.mercantilism) / 2;
    const place = world.settlements[rng.chance(0.5) ? A.hubId : B.hubId];

    // Open market accord.
    if (!dealsBetween(world, a, b, 'market').length && rel > 0.25 && (A.contacts.get(b) ?? 0) > 60 && rng.chance(0.03 * (rel + 0.2) * (0.4 + merc))) {
      const d = addDeal(world, { type: 'market', name: `the Open Market Accord of ${place.name}`, a, b, goods: [] });
      world.log('agreement', A.pop + B.pop > 20000 ? 3 : 2, `The ${A.name} and the ${B.name} signed ${d.name}: their merchants may come and go toll-free.`, { polities: [a, b], settlements: [place.id] });
    }

    // Transit rights for traders shut out.
    for (const [host, guest] of [[A, B], [B, A]]) {
      if (accessPolicy(world, host, guest) !== 'closed' || rel < -0.65) continue;
      const guestMerc = world.cultures[guest.cultureId].values.mercantilism;
      if (!rng.chance(0.04 * (0.5 + guestMerc))) continue;
      const hostMerc = world.cultures[host.cultureId].values.mercantilism;
      if (rng.chance(0.3 + hostMerc * 0.4 + rel)) {
        const d = addDeal(world, { type: 'transit', name: `the Right of Passage of ${world.settlements[host.hubId].name}`, a: host.id, b: guest.id, goods: [] });
        world.log('agreement', 2, `The ${host.name} granted the traders of the ${guest.name} passage through its lands (${d.name}).`, { polities: [host.id, guest.id] });
      } else {
        host.relations.set(guest.id, rel - 0.05);
        guest.relations.set(host.id, rel - 0.05);
        world.log('agreement', 1, `The ${host.name} refused the ${guest.name}'s request for its caravans to pass.`, { polities: [host.id, guest.id] });
      }
    }

    // Convoy compacts for needs free traders cannot meet.
    if (rel <= 0) continue;
    for (const [taker, giver] of [[A, B], [B, A]]) {
      if (accessPolicy(world, giver, taker) === 'closed') continue;
      const existing = dealsBetween(world, a, b, 'convoy').filter((d) => d.b === taker.id);
      if (existing.length >= 2) continue;
      let need = -1;
      let needValue = 0;
      for (let g = 0; g < GOOD_COUNT; g++) {
        if (!taker.deficit[g] || spare(giver, g) <= 0 || existing.some((d) => d.giveGood === g)) continue;
        const v = Math.min(shortfall(taker, g), spare(giver, g)) * nationalValue(world, taker, g);
        if (v > needValue) {
          needValue = v;
          need = g;
        }
      }
      if (need < 0 || needValue < 20 || !rng.chance(0.08)) continue;
      const qty = Math.min(shortfall(taker, need), spare(giver, need)) * 0.4;
      // The giver is paid what the goods are worth to it: in goods it lacks, or in coin.
      const value = qty * nationalValue(world, giver, need);
      let pay = -1;
      let payScore = 0;
      for (let h = 0; h < GOOD_COUNT; h++) {
        if (h === need || !giver.deficit[h] || spare(taker, h) <= 0) continue;
        const score = nationalValue(world, giver, h) / Math.max(0.1, nationalValue(world, taker, h));
        if (score > payScore) {
          payScore = score;
          pay = h;
        }
      }
      let deal: Omit<TradeAgreement, 'id' | 'start' | 'end'> | null = null;
      const hub = world.settlements[taker.hubId];
      if (pay >= 0) {
        const getQty = Math.min(spare(taker, pay) * 0.5, value / nationalValue(world, giver, pay));
        deal = { type: 'convoy', name: `the ${GOOD_NAMES[need]}-for-${GOOD_NAMES[pay]} Compact of ${hub.name}`, a: giver.id, b: taker.id, goods: [GOOD_NAMES[need], GOOD_NAMES[pay]], giveGood: need, giveQty: qty, getGood: pay, getQty };
      } else if (usesCoin(giver) && usesCoin(taker) && taker.treasury > value * 3) {
        deal = { type: 'convoy', name: `the ${GOOD_NAMES[need]} Purchase of ${hub.name}`, a: giver.id, b: taker.id, goods: [GOOD_NAMES[need]], giveGood: need, giveQty: qty, coin: value };
      }
      if (!deal) continue;
      const d = addDeal(world, deal);
      const terms = d.coin ? `${Math.round(d.giveQty!)} ${GOOD_NAMES[need].toLowerCase()} a year for ${Math.round(d.coin)} silver` : `${Math.round(d.giveQty!)} ${GOOD_NAMES[need].toLowerCase()} a year for ${Math.round(d.getQty!)} ${GOOD_NAMES[d.getGood!].toLowerCase()}`;
      world.log('agreement', taker.pop + giver.pop > 20000 ? 3 : 2, `Short of ${GOOD_NAMES[need].toLowerCase()}, the ${taker.name} struck ${d.name} with the ${giver.name}: ${terms}, carried by state convoys.`, { polities: [taker.id, giver.id], settlements: [hub.id] });
    }
  }
}
