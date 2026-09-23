import type { Settlement } from '../types';
import type { World } from '../world';
import { siteScore } from './sites';

/** How desirable a settlement looks to a would-be migrant. */
export function attractiveness(world: World, s: Settlement): number {
  const room = 1 - s.pop / Math.max(1, s.housing);
  const wealthPerCap = s.wealth / Math.max(1, s.pop);
  const war = world.polities[s.polityId].wars.size > 0 ? 0.15 : 0;
  return (
    0.5 * Math.min(1.2, s.foodRatio) +
    0.35 * Math.max(-0.5, Math.min(0.5, room)) +
    0.25 * s.stability +
    0.15 * Math.log10(1 + wealthPerCap * 5) +
    0.05 * Math.log10(1 + s.pop) -
    s.plague * 0.4 -
    war
  );
}

function compatibility(world: World, from: Settlement, to: Settlement): number {
  if (from.cultureId === to.cultureId) return 1;
  const toCulture = world.cultures[to.cultureId];
  if (world.majorityRaceId(from) === world.majorityRaceId(to)) return 0.6;
  return 0.3 * (1 - toCulture.values.xenophobia);
}

function moveRaces(from: Settlement, to: Settlement, count: number): void {
  if (count <= 0 || from.pop <= 0) return;
  const frac = Math.min(1, count / from.pop);
  for (const r in from.races) {
    const n = from.races[r] * frac;
    from.races[r] -= n;
    to.races[r] = (to.races[r] ?? 0) + n;
  }
  from.pop -= count;
  to.pop += count;
}

/**
 * People move from struggling places (famine, crowding, plague, war, unrest) to better
 * ones along trade routes, preferring their own culture and kin. Crowded or ambitious
 * settlements send out colonists to found new villages on the best land they can reach.
 */
export function runMigration(world: World): void {
  const alive = [...world.aliveSettlements()];
  const attr = new Map<number, number>();
  for (const s of alive) attr.set(s.id, attractiveness(world, s));

  for (const s of alive) {
    if (s.pop < 30) continue;
    const push =
      Math.max(0, 1 - s.foodRatio) * 0.6 +
      Math.max(0, s.pop / Math.max(1, s.housing) - 0.95) * 1.5 +
      s.plague * 0.3 +
      Math.max(0, 0.35 - s.stability) * 0.5;
    const a0 = attr.get(s.id)!;
    const dests: { d: Settlement; w: number }[] = [];
    for (const li of s.links) {
      const link = world.links[li];
      const d = world.settlements[link.a === s.id ? link.b : link.a];
      if (!d.alive) continue;
      const gain = attr.get(d.id)! - a0;
      if (gain <= 0.05) continue;
      dests.push({ d, w: gain * compatibility(world, s, d) / (1 + link.cost * 0.05) });
    }
    if (dests.length === 0) continue;
    // A small steady drift toward opportunity even in good times (urbanisation).
    const rate = Math.min(0.12, push * 0.12 + 0.004);
    const migrants = s.pop * rate;
    const totalW = dests.reduce((acc, x) => acc + x.w, 0);
    if (totalW <= 0) continue;
    for (const { d, w } of dests) moveRaces(s, d, migrants * (w / totalW));
    if (migrants > 500 && push > 0.3) {
      const top = dests.reduce((a, b) => (b.w > a.w ? b : a)).d;
      world.log('migration', 2, `Fleeing ${s.foodRatio < 0.8 ? 'famine' : s.plague > 0.2 ? 'pestilence' : 'hardship'}, some ${Math.round(migrants)} people left ${s.name}, many settling in ${top.name}.`, { settlements: [s.id, top.id], polities: [s.polityId] });
    }
  }

  for (const s of alive) colonize(world, s);
  for (const s of alive) {
    if (s.pop < 8) abandon(world, s);
  }
}

function colonize(world: World, s: Settlement): void {
  if (s.pop < 110 || world.year - s.lastColonized < 12) return;
  const rng = world.rng;
  const culture = world.cultures[s.cultureId];
  const crowding = s.pop / Math.max(1, s.housing);
  const pol = world.polities[s.polityId];
  const chance =
    (0.03 + 0.35 * Math.max(0, crowding - 0.8) + 0.25 * Math.max(0, 1 - s.foodRatio) + (s.pop > 2000 ? 0.05 : 0)) *
    (0.4 + culture.values.expansionism * 1.2);
  if (!rng.chance(chance)) return;

  const map = world.map;
  const race = world.majorityRace(s);
  const fx = pol.effects;
  const R = Math.round(5 + fx.tradeRange * 4 + (fx.seaTravel > 0 ? 3 + fx.seaTravel * 3 : 0));
  let best = -1;
  let bestScore = -Infinity;
  for (let a = 0; a < 50; a++) {
    const x = s.x + rng.int(-R, R);
    const y = s.y + rng.int(-R, R);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const t = y * map.width + x;
    if (map.elevation[t] < 0) continue;
    const dist = Math.hypot(x - s.x, y - s.y);
    if (dist < 3) continue;
    const sameLand = map.landmass[t] === s.landmass;
    if (!sameLand && !(fx.seaTravel >= 1 && s.coastal && map.coastal[t])) continue;
    // Keep clear of other towns and of land another polity already works.
    let blocked = false;
    for (let dy = -2; dy <= 2 && !blocked; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (map.settlementAt[ny * map.width + nx] >= 0) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) continue;
    const owner = map.owner[t];
    if (owner >= 0 && world.settlements[owner].polityId !== s.polityId) continue;
    let score = siteScore(map, race, t);
    if (score === -Infinity) continue;
    score -= dist * 0.12;
    if (!sameLand) score += culture.values.seafaring * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best < 0 || bestScore < 0.5) return;

  const colonists = Math.max(25, s.pop * rng.range(0.1, 0.18));
  const races: Record<string, number> = {};
  for (const r in s.races) races[r] = (s.races[r] / s.pop) * colonists;
  for (const r in s.races) s.races[r] -= races[r];
  s.pop -= colonists;
  s.lastColonized = world.year;

  // Colonies stay under the parent polity if they are within its reach; otherwise they strike out alone.
  const capital = world.settlements[pol.capitalId];
  const reach = controlRange(world, pol.id);
  const d = Math.hypot((best % map.width) - capital.x, Math.floor(best / map.width) - capital.y);
  const joins = d <= reach || rng.chance(0.25);
  const ns = world.createSettlement(best, s.polityId, s.cultureId, races, s.id);
  ns.stock.set(ns.stock.map((_, g) => s.stock[g] * 0.1));
  ns.wealth = colonists * 0.3;
  if (joins) {
    pol.settlementIds.push(ns.id);
    world.log('founding', 1, `Settlers from ${s.name} founded ${ns.name}.`, { settlements: [ns.id, s.id], polities: [pol.id] });
  } else {
    const np = world.createPolity(s.cultureId, ns, pol.id, pol.techs);
    ns.polityId = np.id;
    np.relations.set(pol.id, 0.4);
    pol.relations.set(np.id, 0.4);
    world.log('founding', 2, `Pioneers from ${s.name} crossed into the wilds and founded ${ns.name}, free of ${pol.name}.`, { settlements: [ns.id, s.id], polities: [np.id, pol.id] });
  }
}

/** Distance (tiles) over which a polity can govern effectively. */
export function controlRange(world: World, polityId: number): number {
  const p = world.polities[polityId];
  const fx = p.effects;
  const govBonus = { tribe: 0, chiefdom: 3, 'city-state': 2, kingdom: 7, empire: 11, republic: 6, theocracy: 6 }[p.government];
  return 7 + govBonus + fx.control * 8 + fx.roads * 4 + fx.seaTravel * 2;
}

export function abandon(world: World, s: Settlement): void {
  s.alive = false;
  s.abandoned = world.year;
  world.map.settlementAt[s.tile] = -1;
  // Remaining folk go to the nearest linked settlement.
  const dest = s.links.map((li) => world.links[li]).map((l) => world.settlements[l.a === s.id ? l.b : l.a]).find((d) => d.alive);
  if (dest) moveRaces(s, dest, s.pop);
  s.pop = 0;
  const pol = world.polities[s.polityId];
  pol.settlementIds = pol.settlementIds.filter((id) => id !== s.id);
  world.territoryDirty = true;
  world.linksDirty = true;
  const imp = s.peakPop > 5000 ? 3 : s.peakPop > 800 ? 2 : 1;
  world.log('abandonment', imp, `${s.name} was abandoned${s.peakPop > 800 ? `, its ruins a memory of ${Math.round(s.peakPop).toLocaleString('en-US')} souls` : ''}.`, { settlements: [s.id], polities: [pol.id] });
}
