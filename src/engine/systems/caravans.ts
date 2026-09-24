import { GOOD_BASE_PRICE, GOOD_COUNT, Good } from '../data/economy';
import { tileCost } from '../pathfinding';
import type { Caravan, CaravanKind, Cargo, Polity, Settlement, TradingHouse } from '../types';
import { pairKey, type World } from '../world';
import { canTradeIn, dealsBetween, passable, tollRate } from './access';
import { reprice, tradeRange, usesCoin } from './trade';

const MAX_CARAVANS = 360;
/** Terrain cost a caravan covers in a year; it moves a twelfth of this each month. */
const SPEED = 30;
/** Value one pack animal can carry at base prices. */
const BEAST_LOAD = 8;

interface Plan {
  dest: Settlement;
  tile: number;
  cost: number;
  cargo: Cargo[];
  profit: number;
}

const cargoValue = (c: Caravan) => c.cargo.reduce((s, x) => s + x.qty * GOOD_BASE_PRICE[x.good], 0);

/**
 * How big an outfit a caravan can field and how much it can carry: more beasts for bigger
 * towns, richer houses and nomad tribes; horses to carry more, wagons once the wheel is known.
 */
function outfit(world: World, home: Settlement, kind: CaravanKind, house?: TradingHouse): { size: number; capacity: number } {
  const pol = world.polities[home.polityId];
  const culture = world.cultures[home.cultureId];
  const horses = home.stock[Good.Horses] > 2 || culture.traits.includes('horse_lords');
  let size: number;
  switch (kind) {
    case 'family': size = 6 + Math.sqrt(house?.wealth ?? 0) * 0.25; break;
    case 'nomad': size = (8 + Math.sqrt(home.pop) * 0.15) * (culture.traits.some((t) => t === 'horse_lords' || t === 'sand_walkers') ? 1.5 : 1); break;
    case 'convoy': size = 12 + Math.sqrt(pol.pop) * 0.05; break;
    default: size = 4 + Math.sqrt(home.pop) * 0.08;
  }
  size = Math.round(Math.min(120, size));
  const load = BEAST_LOAD * (horses ? 1.4 : 1) * (pol.techs.has('the_wheel') && kind !== 'nomad' ? 1.8 : 1);
  return { size, capacity: size * load };
}

/** Load the most profitable mix of goods (up to three) that `from` can spare and `to` wants. */
function fillCargo(from: Settlement, to: Settlement, capacity: number, routeCost: number, toll: number): { cargo: Cargo[]; profit: number } {
  const options: { g: Good; margin: number; qty: number }[] = [];
  for (let g = 0 as Good; g < GOOD_COUNT; g++) {
    if (g === Good.Food && routeCost > 15) continue; // grain spoils on long roads
    const surplus = from.stock[g] - from.target[g] * 0.8;
    const want = to.target[g] * 1.3 - to.stock[g];
    if (surplus < 1 || want < 1) continue;
    const margin = to.price[g] * (1 - toll) - from.price[g] - routeCost * 0.015 * GOOD_BASE_PRICE[g];
    if (margin > 0) options.push({ g, margin, qty: Math.min(surplus * 0.5, want * 0.5) });
  }
  options.sort((a, b) => b.margin / GOOD_BASE_PRICE[b.g] - a.margin / GOOD_BASE_PRICE[a.g]);
  const cargo: Cargo[] = [];
  let left = capacity;
  let profit = 0;
  for (const o of options.slice(0, 3)) {
    const qty = Math.min(o.qty, left / GOOD_BASE_PRICE[o.g]);
    if (qty < 0.2) continue;
    cargo.push({ good: o.g, qty, cost: from.price[o.g] });
    left -= qty * GOOD_BASE_PRICE[o.g];
    profit += qty * o.margin;
  }
  return { cargo, profit };
}

/** Does the path cross a nation that embargoes trade with `destPolity`? */
function embargoed(world: World, path: number[], guest: number, destPolity: number): boolean {
  let last = -1;
  for (const t of path) {
    const o = world.map.owner[t];
    if (o < 0) continue;
    const pid = world.settlements[o].polityId;
    if (pid === last) continue;
    last = pid;
    if (pid !== guest && pid !== destPolity && world.polities[pid].embargoes.has(destPolity)) return true;
  }
  return false;
}

/** Scout the markets within reach of `from` for the best venture for `owner`'s merchants. */
function planTrip(world: World, from: Settlement, owner: Polity, capacity: number): (Plan & { path: number[] }) | null {
  const pf = world.pathfinder;
  const map = world.map;
  const found: { s: Settlement; tile: number; cost: number }[] = [];
  let explored = 0;
  pf.run(from.tile, tradeRange(world, from) * 2, owner.effects.seaTravel, (tile, cost) => {
    if (++explored > 1500) return true;
    const o = map.settlementAt[tile];
    if (o < 0 || o === from.id) return false;
    const s = world.settlements[o];
    if (s.alive) found.push({ s, tile, cost });
    return found.length >= 14;
  }, passable(world, owner));
  const plans: Plan[] = [];
  for (const { s: d, tile, cost } of found) {
    const destPol = world.polities[d.polityId];
    if (!canTradeIn(world, destPol, owner)) continue;
    const toll = d.polityId === owner.id ? 0 : tollRate(world, destPol, owner, false);
    const { cargo, profit } = fillCargo(from, d, capacity, cost, toll);
    if (cargo.length && profit > 4) plans.push({ dest: d, tile, cost, cargo, profit });
  }
  plans.sort((a, b) => b.profit - a.profit);
  for (const plan of plans.slice(0, 4)) {
    const path = pf.pathTo(plan.tile);
    if (path.length > 1 && !embargoed(world, path, owner.id, plan.dest.polityId)) return { ...plan, path };
  }
  return null;
}

function load(from: Settlement, cargo: Cargo[]): void {
  for (const c of cargo) {
    from.stock[c.good] -= c.qty;
    from.exported[c.good] += c.qty;
    reprice(from, c.good as Good);
  }
}

function launch(world: World, kind: CaravanKind, home: Settlement, plan: { dest: Settlement; path: number[]; cost: number; cargo: Cargo[] }, extra: Partial<Caravan>): void {
  const house = extra.houseId !== undefined && extra.houseId >= 0 ? world.houses[extra.houseId] : undefined;
  const kit = outfit(world, home, kind, house);
  const culture = world.cultures[home.cultureId];
  const name = kind === 'family' ? `${house!.name} caravan` : kind === 'nomad' ? `${culture.adjective} caravan tribe` : kind === 'convoy' ? 'state convoy' : `${home.name} caravan`;
  world.caravans.push({
    id: world.nextCaravanId++, kind, name, homeId: home.id, polityId: home.polityId, houseId: -1, dealId: -1,
    fromId: home.id, toId: plan.dest.id, path: plan.path, step: 0, prevStep: 0, cargo: plan.cargo,
    size: kit.size, capacity: kit.capacity, purse: 0, tripCost: plan.cost, legs: kind === 'nomad' ? 3 : 1,
    returning: false, started: world.year, ...extra,
  });
}

/**
 * Once a year: trading houses rise and fall, merchants and nomad tribes set out on new
 * ventures, and every convoy compact sends its yearly shipment.
 */
export function planCaravans(world: World): void {
  const rng = world.rng;
  // Old routes fade from memory.
  for (const [k, r] of world.routes) {
    r.volume *= 0.5;
    if (r.volume < 1 && world.year - r.lastYear > 3) world.routes.delete(k);
  }
  // Trading houses.
  for (const h of world.houses) {
    if (h.closed !== null) continue;
    h.wealth *= 0.97;
    const home = world.settlements[h.homeId];
    if (!home.alive || (h.wealth < 2 && world.year - h.founded > 30)) {
      h.closed = world.year;
      world.log('house', 1, `${h.name} of ${home.name} ${home.alive ? 'went bankrupt and closed its counting-house' : 'was scattered when its city fell to ruin'}.`, { settlements: [home.id] });
    }
  }
  const houseAt = new Map<number, TradingHouse>();
  for (const h of world.houses) if (h.closed === null) houseAt.set(h.homeId, h);
  const owned = new Map<number, number>();
  const byHouse = new Map<number, number>();
  for (const c of world.caravans) {
    owned.set(c.homeId, (owned.get(c.homeId) ?? 0) + 1);
    if (c.houseId >= 0) byHouse.set(c.houseId, (byHouse.get(c.houseId) ?? 0) + 1);
  }

  for (const s of world.aliveSettlements()) {
    const culture = world.cultures[s.cultureId];
    const merchants = culture.values.mercantilism + culture.traitEffects.tradeCapacity;
    const pol = world.polities[s.polityId];
    if (!houseAt.has(s.id) && s.pop > 3000 && s.wealth > s.pop * 1.5 && merchants > 0.4 && rng.chance(0.004 * (0.5 + merchants))) {
      const h: TradingHouse = { id: world.houses.length, name: `House ${world.names.person(rng, culture.language)}`, homeId: s.id, wealth: s.wealth * 0.1, founded: world.year, closed: null, trips: 0 };
      s.wealth *= 0.9;
      world.houses.push(h);
      houseAt.set(s.id, h);
      world.log('house', 2, `The merchant family ${h.name} rose to prominence in ${s.name}, sending its own caravans far and wide.`, { settlements: [s.id], polities: [s.polityId] });
    }
    if (world.caravans.length >= MAX_CARAVANS || s.pop < 300) continue;
    const house = houseAt.get(s.id);
    let kind: CaravanKind | null = null;
    if (house && (byHouse.get(house.id) ?? 0) < Math.min(4, 1 + Math.floor(house.wealth / 1500)) && rng.chance(0.5)) kind = 'family';
    else {
      const tribal = pol.government === 'tribe' || pol.government === 'chiefdom' || culture.traits.some((t) => t === 'horse_lords' || t === 'sand_walkers');
      const maxOwn = Math.min(4, 1 + Math.floor(s.pop / 3000));
      if ((owned.get(s.id) ?? 0) >= maxOwn) continue;
      if (!rng.chance(0.25 * (0.3 + merchants) * Math.min(1, s.wealth / (s.pop * 0.5 + 1)))) continue;
      kind = tribal && rng.chance(0.5) ? 'nomad' : 'merchant';
    }
    const kit = outfit(world, s, kind, house);
    const plan = planTrip(world, s, pol, kit.capacity);
    if (!plan) continue;
    load(s, plan.cargo);
    launch(world, kind, s, plan, { houseId: kind === 'family' ? house!.id : -1 });
    owned.set(s.id, (owned.get(s.id) ?? 0) + 1);
    if (kind === 'family') byHouse.set(house!.id, (byHouse.get(house!.id) ?? 0) + 1);
  }

  // State convoys for each convoy compact.
  for (const d of world.agreements) {
    if (d.end !== null || d.type !== 'convoy') continue;
    const giver = world.polities[d.a];
    const taker = world.polities[d.b];
    const from = world.settlements[giver.hubId];
    const to = world.settlements[taker.hubId];
    if (!from?.alive || !to?.alive) continue;
    const g = d.giveGood!;
    const qty = Math.min(d.giveQty!, Math.max(0, from.stock[g] - from.target[g] * 0.5));
    if (qty < 0.5) continue;
    // Survey the convoy road once, and again every ten years or if a hub moves.
    let path = d.route ?? [];
    if (!path.length || path[0] !== from.tile || path[path.length - 1] !== to.tile || world.year - (d.routeYear ?? 0) >= 10) {
      const pf = world.pathfinder;
      let explored = 0;
      pf.run(from.tile, 250, giver.effects.seaTravel, (tile) => tile === to.tile || ++explored > 6000, passable(world, giver, taker.id));
      path = pf.pathTo(to.tile);
      d.route = path;
      d.routeYear = world.year;
    }
    if (path.length < 2) continue;
    const cargo = [{ good: g, qty, cost: from.price[g] }];
    load(from, cargo);
    launch(world, 'convoy', from, { dest: to, path, cost: path.length, cargo }, { dealId: d.id, name: `convoy of ${d.name}` });
  }
}

/** Each month every caravan and convoy moves along its road, trading in the towns it passes through. */
export function caravansMonth(world: World): void {
  const rng = world.rng;
  const map = world.map;
  const keep: Caravan[] = [];
  for (const c of world.caravans) {
    c.prevStep = c.step;
    const home = world.settlements[c.homeId];
    const dest = world.settlements[c.toId];
    if (!home.alive || !dest.alive) continue;
    const owner = world.polities[c.polityId];
    let budget = SPEED / 12;
    let lost = false;
    const value = cargoValue(c);
    while (budget > 0 && c.step < c.path.length - 1) {
      const next = c.path[c.step + 1];
      const step = tileCost(map, next, owner.effects.seaTravel);
      budget -= Number.isFinite(step) ? step : 1;
      c.step++;
      map.traffic[next] += value * 0.4 + c.size;
      const o = map.owner[next];
      if (o >= 0) {
        const hostId = world.settlements[o].polityId;
        if (hostId !== c.polityId && world.atWar(hostId, c.polityId) && rng.chance(0.2)) {
          lost = true;
          if (value > 400) world.log('caravan', 1, `Soldiers of the ${world.polities[hostId].name} seized the ${c.name} from ${home.name}.`, { settlements: [home.id], polities: [hostId, c.polityId], tile: next });
          break;
        }
        // Passing through a town: the caravan trades a little there, and the town profits from the traffic.
        const at = map.settlementAt[next];
        if (at >= 0 && at !== c.toId && at !== c.fromId) waypoint(world, c, world.settlements[at]);
      } else if (map.elevation[next] >= 0 && rng.chance(0.004 * (1 + world.cfg.magic * 0.5) * world.cfg.calamity * (c.kind === 'convoy' ? 0.3 : 1))) {
        lost = true;
        if (value > 400) world.log('caravan', 1, `The ${c.name} from ${home.name} vanished in the wilds, its goods lost to bandits.`, { settlements: [home.id], tile: next });
        break;
      }
    }
    if (lost) continue;
    for (const x of c.cargo) if (x.good === Good.Food) x.qty *= 0.985;
    if (c.step < c.path.length - 1) {
      keep.push(c);
      continue;
    }
    if (arrive(world, c)) keep.push(c);
  }
  world.caravans = keep;
}

function waypoint(world: World, c: Caravan, s: Settlement): void {
  const v = cargoValue(c);
  s.transit += v;
  s.wealth += v * 0.01 + c.size * 0.2;
  if (!canTradeIn(world, world.polities[s.polityId], world.polities[c.polityId]) || c.kind === 'convoy') return;
  for (const x of c.cargo) {
    if (s.price[x.good] < x.cost * 1.4 || x.qty < 1) continue;
    const q = x.qty * 0.1;
    x.qty -= q;
    s.stock[x.good] += q;
    s.imported[x.good] += q;
    s.tradeByKind.caravan += q * GOOD_BASE_PRICE[x.good];
    credit(world, c, q * (s.price[x.good] - x.cost));
    reprice(s, x.good as Good);
  }
}

/** Profit goes to whoever owns the caravan: its trading house, or its home town's merchants. */
function credit(world: World, c: Caravan, amount: number): void {
  if (c.houseId >= 0) {
    const h = world.houses[c.houseId];
    h.wealth += amount * 0.7;
    world.settlements[c.homeId].wealth += amount * 0.3;
  } else world.settlements[c.homeId].wealth += amount;
}

function recordRoute(world: World, c: Caravan, value: number): void {
  const key = pairKey(c.fromId, c.toId);
  const r = world.routes.get(key);
  if (r) {
    r.volume += value;
    r.lastYear = world.year;
    if (c.kind === 'convoy') r.kind = 'convoy';
  } else world.routes.set(key, { a: c.fromId, b: c.toId, path: c.path, kind: c.kind === 'convoy' ? 'convoy' : 'caravan', volume: value, lastYear: world.year });
}

/** Tolls levied by the nations a caravan passed through on the way. */
function transitTolls(world: World, c: Caravan, value: number, destPolity: number): number {
  const guest = world.polities[c.polityId];
  const seen = new Set<number>();
  let paid = 0;
  for (const t of c.path) {
    const o = world.map.owner[t];
    if (o < 0) continue;
    const pid = world.settlements[o].polityId;
    if (pid === c.polityId || pid === destPolity || seen.has(pid)) continue;
    seen.add(pid);
    const host = world.polities[pid];
    const toll = value * tollRate(world, host, guest, true);
    host.treasury += toll;
    host.tariffIncome += toll;
    paid += toll;
  }
  return paid;
}

/**
 * Selling at the market. With coin on both sides the town pays silver; otherwise it is barter,
 * and the town pays in its own goods — which become the caravan's cargo for the road home.
 * Returns true if the caravan carries on (home, or to another market).
 */
function arrive(world: World, c: Caravan): boolean {
  const dest = world.settlements[c.toId];
  const home = world.settlements[c.homeId];
  const guest = world.polities[c.polityId];
  const destPol = world.polities[dest.polityId];
  const value = cargoValue(c);
  recordRoute(world, c, value);
  if (c.returning) {
    // Home again: unload and settle accounts.
    for (const x of c.cargo) {
      dest.stock[x.good] += x.qty;
      dest.imported[x.good] += x.qty;
      reprice(dest, x.good as Good);
    }
    if (c.kind === 'convoy') dest.tradeByKind.convoy += value;
    else {
      dest.tradeByKind.caravan += value;
      credit(world, c, c.purse + c.cargo.reduce((s, x) => s + x.qty * Math.max(0, dest.price[x.good] - x.cost), 0));
      if (c.houseId >= 0) world.houses[c.houseId].trips++;
    }
    world.caravanTrips++;
    return false;
  }

  if (c.kind === 'convoy') return deliverConvoy(world, c);

  const toll = dest.polityId === c.polityId ? 0 : tollRate(world, destPol, guest, false);
  const coin = usesCoin(guest) && usesCoin(destPol);
  let barterCredit = 0;
  const tolls = transitTolls(world, c, value, dest.polityId);
  for (const x of c.cargo) {
    let qty = x.qty;
    let gross = qty * dest.price[x.good];
    if (coin && gross > dest.wealth * 0.5) {
      qty *= (dest.wealth * 0.5) / gross;
      gross = dest.wealth * 0.5;
    }
    if (qty <= 0) continue;
    const tax = gross * toll;
    destPol.treasury += tax;
    destPol.tariffIncome += tax;
    dest.stock[x.good] += qty;
    dest.imported[x.good] += qty;
    if (dest.polityId !== c.polityId) destPol.imported[x.good] += qty;
    const v = qty * GOOD_BASE_PRICE[x.good];
    dest.tradeByKind.caravan += v;
    world.tradeVolume += v;
    if (coin) {
      dest.wealth -= gross;
      c.purse += gross - tax;
      world.coinTrade += v;
    } else {
      barterCredit += (gross - tax) * 0.85; // haggling over goods for goods loses something
      world.barterTrade += v;
    }
    x.qty -= qty;
    reprice(dest, x.good as Good);
  }
  c.cargo = c.cargo.filter((x) => x.qty > 0.2);
  dest.wealth += value * 0.05;
  if (dest.polityId !== c.polityId) {
    guest.contacts.set(destPol.id, (guest.contacts.get(destPol.id) ?? 0) + value);
    destPol.contacts.set(guest.id, (destPol.contacts.get(guest.id) ?? 0) + value);
    const key = `caravan:${Math.min(guest.id, destPol.id)}:${Math.max(guest.id, destPol.id)}`;
    if (!world.flags.has(key)) {
      world.flags.add(key);
      world.log('caravan', 1, `The first ${c.kind === 'nomad' ? 'nomad traders' : 'merchants'} of ${home.name} (${guest.name}) reached ${dest.name} in the ${destPol.name}.`, { settlements: [home.id, dest.id], polities: [guest.id, destPol.id] });
    }
  }
  // Tolls paid to the nations crossed on the way come out of the takings.
  if (coin) c.purse = Math.max(0, c.purse - tolls);
  else barterCredit = Math.max(0, barterCredit - tolls);

  // Next leg: nomads wander on to another market; everyone else heads home.
  const next = c.kind === 'nomad' && c.legs > 1 ? planTrip(world, dest, guest, c.capacity) : null;
  const buyFor = next ? next.dest : home;
  if (barterCredit > 0) c.cargo.push(...barterGoods(dest, buyFor, barterCredit));
  else if (coin && c.purse > 0) {
    // Spend the silver on goods worth more back home.
    const { cargo } = fillCargo(dest, buyFor, Math.min(c.capacity, c.purse * 0.8), c.tripCost, 0);
    for (const x of cargo) {
      const cost = x.qty * dest.price[x.good];
      if (cost > c.purse) continue;
      c.purse -= cost;
      dest.wealth += cost;
      load(dest, [x]);
      c.cargo.push(x);
    }
  }
  c.fromId = dest.id;
  c.step = 0;
  c.prevStep = 0;
  if (next) {
    c.toId = next.dest.id;
    c.path = next.path;
    c.tripCost = next.cost;
    c.legs--;
    const extra = fillCargo(dest, next.dest, c.capacity - cargoValue(c), next.cost, 0).cargo;
    load(dest, extra);
    c.cargo.push(...extra);
    return true;
  }
  c.toId = home.id;
  c.returning = true;
  if (c.path[0] === home.tile) c.path = [...c.path].reverse();
  else {
    const pf = world.pathfinder;
    let explored = 0;
    pf.run(dest.tile, 250, guest.effects.seaTravel, (tile) => tile === home.tile || ++explored > 6000, passable(world, guest));
    c.path = pf.pathTo(home.tile);
    if (c.path.length < 2) return false;
  }
  return true;
}

/** Goods a barter market hands over as payment: whatever it can spare that is worth most where the caravan goes next. */
function barterGoods(market: Settlement, to: Settlement, credit: number): Cargo[] {
  const options: { g: Good; ratio: number; spare: number }[] = [];
  for (let g = 0 as Good; g < GOOD_COUNT; g++) {
    const spare = market.stock[g] - market.target[g] * 0.8;
    if (spare < 1) continue;
    options.push({ g, ratio: to.price[g] / market.price[g], spare });
  }
  options.sort((a, b) => b.ratio - a.ratio);
  const out: Cargo[] = [];
  let left = credit;
  for (const o of options.slice(0, 3)) {
    if (left <= 0.5) break;
    const qty = Math.min(o.spare * 0.5, left / market.price[o.g]);
    if (qty < 0.2) continue;
    market.stock[o.g] -= qty;
    market.exported[o.g] += qty;
    out.push({ good: o.g, qty, cost: market.price[o.g] });
    left -= qty * market.price[o.g];
    reprice(market, o.g);
  }
  return out;
}

/** A convoy reaches the partner's hub: hand over the goods and collect the agreed payment. */
function deliverConvoy(world: World, c: Caravan): boolean {
  const deal = world.agreements[c.dealId];
  const dest = world.settlements[c.toId];
  const giver = world.polities[c.polityId];
  const taker = world.polities[dest.polityId];
  const value = cargoValue(c);
  for (const x of c.cargo) {
    dest.stock[x.good] += x.qty;
    dest.imported[x.good] += x.qty;
    taker.imported[x.good] += x.qty;
    reprice(dest, x.good as Good);
  }
  dest.tradeByKind.convoy += value;
  world.tradeVolume += value;
  c.cargo = [];
  if (deal?.coin) {
    const pay = Math.min(deal.coin, Math.max(0, taker.treasury));
    taker.treasury -= pay;
    giver.treasury += pay;
    world.coinTrade += value;
  } else if (deal?.getGood !== undefined) {
    const g = deal.getGood;
    const qty = Math.min(deal.getQty!, Math.max(0, dest.stock[g] - dest.target[g] * 0.5));
    if (qty > 0.2) {
      dest.stock[g] -= qty;
      dest.exported[g] += qty;
      reprice(dest, g as Good);
      c.cargo.push({ good: g, qty, cost: dest.price[g] });
    }
    world.barterTrade += value;
  }
  if (!dealsBetween(world, giver.id, taker.id, 'convoy').length) return false;
  c.fromId = dest.id;
  c.toId = c.homeId;
  c.returning = true;
  c.path = [...c.path].reverse();
  c.step = 0;
  c.prevStep = 0;
  return true;
}

