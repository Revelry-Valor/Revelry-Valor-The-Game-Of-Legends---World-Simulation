import { GOOD_BASE_PRICE, GOOD_COUNT, GOOD_NAMES, Good } from '../data/economy';
import { tileCost } from '../pathfinding';
import type { Caravan, Settlement } from '../types';
import type { World } from '../world';
import { hasAgreement, reprice, tradeRange } from './trade';

const MAX_CARAVANS = 320;
/** Terrain cost a caravan covers in a year. */
const SPEED = 30;

interface Plan {
  dest: Settlement;
  tile: number;
  cost: number;
  good: Good;
  qty: number;
  profit: number;
}

/** Share of a caravan's sale the destination's rulers take at the border. */
export function tariffFor(world: World, home: Settlement, dest: Settlement): number {
  const hp = world.polities[home.polityId];
  const dp = world.polities[dest.polityId];
  return hasAgreement(world, hp, dp) ? 0 : dp.tariff;
}

/**
 * Free traders: merchant caravans owned by a town's trading houses. Each one looks for the
 * most profitable single cargo it can carry to any market within reach, crosses borders
 * (paying tariffs where there is no trade agreement), sells, buys a return cargo and comes
 * home. They travel across the map over one or more years and can be robbed or seized.
 */
export function runCaravans(world: World): void {
  moveCaravans(world);
  spawnCaravans(world);
}

/** Best cargo to carry from one market to another over a known route cost. */
function bestCargo(world: World, from: Settlement, d: Settlement, home: Settlement, cost: number, tile: number): Plan | null {
  const tariff = d.polityId === home.polityId ? 0 : tariffFor(world, home, d);
  const capacity = 100 + Math.sqrt(home.pop) * 4;
  let best: Plan | null = null;
  for (let g = 0 as Good; g < GOOD_COUNT; g++) {
    if (g === Good.Food && cost > 15) continue; // grain spoils on long roads
    const surplus = from.stock[g] - from.target[g] * 0.8;
    if (surplus < 1) continue;
    const want = d.target[g] * 1.3 - d.stock[g];
    if (want < 1) continue;
    const qty = Math.min(surplus * 0.5, want * 0.5, capacity / GOOD_BASE_PRICE[g]);
    const margin = d.price[g] * (1 - tariff) - from.price[g] - cost * 0.015 * GOOD_BASE_PRICE[g];
    const profit = qty * margin;
    if (!best || profit > best.profit) best = { dest: d, tile, cost, good: g, qty, profit };
  }
  return best;
}

/**
 * Search outward from a market for the most profitable cargo and destination.
 * The winning route is left in the pathfinder, so pathTo(plan.tile) gives the road.
 */
function planTrip(world: World, from: Settlement, home: Settlement): Plan | null {
  const pf = world.pathfinder;
  const map = world.map;
  const hp = world.polities[home.polityId];
  const found: { s: Settlement; tile: number; cost: number }[] = [];
  let explored = 0;
  pf.run(from.tile, tradeRange(world, home) * 2, hp.effects.seaTravel, (tile, cost) => {
    // Merchants scout a bounded region, not the whole world.
    if (++explored > 2500) return true;
    const o = map.settlementAt[tile];
    if (o < 0 || o === from.id) return false;
    const s = world.settlements[o];
    if (s.alive) found.push({ s, tile, cost });
    return found.length >= 20;
  });
  let best: Plan | null = null;
  for (const { s: d, tile, cost } of found) {
    if (world.atWar(home.polityId, d.polityId)) continue;
    const plan = bestCargo(world, from, d, home, cost, tile);
    if (plan && (!best || plan.profit > best.profit)) best = plan;
  }
  return best && best.profit >= 6 ? best : null;
}

function spawnCaravans(world: World): void {
  const rng = world.rng;
  const owned = new Map<number, number>();
  for (const c of world.caravans) owned.set(c.homeId, (owned.get(c.homeId) ?? 0) + 1);
  for (const s of world.aliveSettlements()) {
    if (world.caravans.length >= MAX_CARAVANS) return;
    if (s.pop < 400) continue;
    const culture = world.cultures[s.cultureId];
    const merchants = culture.values.mercantilism + culture.traitEffects.tradeCapacity;
    const maxOwn = Math.min(4, 1 + Math.floor(s.pop / 3000));
    if ((owned.get(s.id) ?? 0) >= maxOwn) continue;
    const chance = 0.15 * (0.3 + merchants) * Math.min(1, s.wealth / (s.pop * 0.5 + 1));
    if (!rng.chance(chance)) continue;
    const plan = planTrip(world, s, s);
    if (!plan) continue;
    const path = world.pathfinder.pathTo(plan.tile);
    if (path.length < 2) continue;
    s.stock[plan.good] -= plan.qty;
    s.exported[plan.good] += plan.qty;
    reprice(s, plan.good);
    world.caravans.push({
      id: world.nextCaravanId++, homeId: s.id, polityId: s.polityId, fromId: s.id, toId: plan.dest.id, path, step: 0,
      good: plan.good, qty: plan.qty, cost: s.price[plan.good], tripCost: plan.cost, returning: false, started: world.year,
    });
    owned.set(s.id, (owned.get(s.id) ?? 0) + 1);
  }
}

function moveCaravans(world: World): void {
  const rng = world.rng;
  const map = world.map;
  const keep: Caravan[] = [];
  for (const c of world.caravans) {
    const home = world.settlements[c.homeId];
    const dest = world.settlements[c.toId];
    if (!home.alive || !dest.alive) continue;
    const sea = world.polities[home.polityId].effects.seaTravel;
    let budget = SPEED;
    let lost = false;
    while (budget > 0 && c.step < c.path.length - 1) {
      const next = c.path[c.step + 1];
      const step = tileCost(map, next, sea);
      budget -= Number.isFinite(step) ? step : 1;
      c.step++;
      const o = map.owner[next];
      if (o >= 0) {
        const owner = world.settlements[o].polityId;
        if (owner !== home.polityId && world.atWar(owner, home.polityId) && rng.chance(0.2)) {
          lost = true;
          if (c.qty * GOOD_BASE_PRICE[c.good] > 400) world.log('caravan', 1, `Soldiers of the ${world.polities[owner].name} seized a ${home.name} caravan laden with ${GOOD_NAMES[c.good].toLowerCase()}.`, { settlements: [home.id], polities: [owner, home.polityId], tile: next });
          break;
        }
      } else if (map.elevation[next] >= 0 && rng.chance(0.004 * (1 + world.cfg.magic * 0.5) * world.cfg.calamity)) {
        lost = true;
        if (c.qty * GOOD_BASE_PRICE[c.good] > 400) world.log('caravan', 1, `A caravan from ${home.name} vanished in the wilds, its ${GOOD_NAMES[c.good].toLowerCase()} lost to bandits.`, { settlements: [home.id], tile: next });
        break;
      }
    }
    if (lost) continue;
    if (c.good === Good.Food) c.qty *= 0.85;
    if (c.step < c.path.length - 1) {
      keep.push(c);
      continue;
    }
    // Arrived: sell the cargo.
    if (c.qty > 0) sell(world, c, home, dest);
    if (c.returning) continue; // home again; the venture is over
    const back = bestCargo(world, dest, home, home, c.tripCost, home.tile);
    c.returning = true;
    c.fromId = dest.id;
    c.toId = home.id;
    c.path = [...c.path].reverse();
    c.step = 0;
    if (back && back.profit > 0.5) {
      c.good = back.good;
      c.qty = back.qty;
      c.cost = dest.price[back.good];
      dest.stock[back.good] -= back.qty;
      dest.exported[back.good] += back.qty;
      reprice(dest, back.good);
    } else c.qty = 0;
    keep.push(c);
  }
  world.caravans = keep;
}

function sell(world: World, c: Caravan, home: Settlement, dest: Settlement): void {
  const g = c.good as Good;
  const gross = c.qty * dest.price[g];
  const tariff = dest.polityId === home.polityId ? 0 : tariffFor(world, home, dest);
  const tax = gross * tariff;
  const dp = world.polities[dest.polityId];
  dp.treasury += tax;
  dp.tariffIncome += tax;
  dest.stock[g] += c.qty;
  dest.imported[g] += c.qty;
  const value = c.qty * GOOD_BASE_PRICE[g];
  dest.tradeByKind.caravan += value;
  home.tradeByKind.caravan += value;
  if (dest.polityId !== c.polityId) dp.imported[g] += c.qty;
  home.wealth += Math.max(0, gross - tax - c.qty * c.cost) + c.qty * c.cost * 0.1;
  dest.wealth += gross * 0.05;
  reprice(dest, g);
  world.caravanTrips++;
  world.tradeVolume += value;
  if (dest.polityId !== home.polityId) {
    const hp = world.polities[home.polityId];
    hp.contacts.set(dp.id, (hp.contacts.get(dp.id) ?? 0) + value);
    dp.contacts.set(hp.id, (dp.contacts.get(hp.id) ?? 0) + value);
    const key = `caravan:${Math.min(hp.id, dp.id)}:${Math.max(hp.id, dp.id)}`;
    if (!world.flags.has(key)) {
      world.flags.add(key);
      world.log('caravan', 1, `The first merchants of ${home.name} (${hp.name}) reached ${dest.name} in the ${dp.name}, trading ${GOOD_NAMES[g].toLowerCase()}.`, { settlements: [home.id, dest.id], polities: [hp.id, dp.id] });
    }
  }
}
