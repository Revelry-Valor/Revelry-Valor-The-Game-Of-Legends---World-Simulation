import { BIOMES, Relief } from '../data/biomes';
import { tileCost } from '../pathfinding';
import type { Army, Polity, Settlement, War } from '../types';
import type { World } from '../world';
import { captureSettlement, killPop, spreadLosses } from './politics';

/** Terrain cost an army marches in a year. */
const MARCH = 22;
const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const HOST_WORDS: Record<string, string> = { human: 'Legion', elf: 'Host', dwarf: 'Hammerhost', orc: 'Warband', halfling: 'Muster', lizardfolk: 'Swarm' };

/** Soldiers a polity can put in the field (before losses already suffered). */
export function levy(world: World, p: Polity): number {
  const mil = world.cultures[p.cultureId].values.militarism;
  return p.pop * (0.04 + 0.08 * mil);
}

/** Combat value of one soldier: weapons, horses, technology and warlike traits. */
export function soldierQuality(world: World, p: Polity): number {
  const l = levy(world, p);
  return l > 0 ? Math.max(0.5, p.military / l) : 1;
}

const dist = (world: World, a: number, b: number) => {
  const w = world.map.width;
  return Math.hypot((a % w) - (b % w), Math.floor(a / w) - Math.floor(b / w));
};

function enemiesOf(world: World, war: War, p: Polity): Polity {
  return world.polities[war.attacker === p.id ? war.defender : war.attacker];
}

/**
 * Wars are fought by armies on the map. Each side raises hosts at the settlement nearest
 * the enemy, marches them over the terrain, intercepts enemy armies that come close,
 * and besieges enemy towns. Armies suffer attrition, especially in harsh land, and
 * every soldier lost is a person lost at home.
 */
export function runMilitary(world: World): void {
  for (const war of world.wars) {
    if (war.end !== null) continue;
    const A = world.polities[war.attacker];
    const B = world.polities[war.defender];
    if (!A.alive || !B.alive) continue;
    raise(world, war, A, true);
    raise(world, war, B, false);
  }
  const alive = world.armies.filter((a) => a.alive);
  for (const army of alive) march(world, army);
  for (const army of alive) if (army.alive) engage(world, army);
  world.armies = world.armies.filter((a) => a.alive);
}

function raise(world: World, war: War, p: Polity, attacking: boolean): void {
  const mine = world.armies.filter((a) => a.alive && a.polityId === p.id);
  const inWar = mine.filter((a) => a.warId === war.id).length;
  const available = levy(world, p) - mine.reduce((s, a) => s + a.size, 0);
  const wanted = Math.min(attacking ? 3 : 2, 1 + Math.floor(levy(world, p) / 5000));
  if (inWar >= wanted || available < 40) return;
  const enemy = enemiesOf(world, war, p);
  // Muster at our settlement closest to the enemy.
  let staging: Settlement | null = null;
  let bd = Infinity;
  for (const id of p.settlementIds) {
    const s = world.settlements[id];
    for (const eid of enemy.settlementIds) {
      const d = dist(world, s.tile, world.settlements[eid].tile);
      if (d < bd) {
        bd = d;
        staging = s;
      }
    }
  }
  if (!staging) return;
  const size = Math.round(available * (0.6 / Math.max(1, wanted - inWar)));
  if (size < 30) return;
  const race = world.majorityRaceId(world.settlements[p.capitalId]);
  const count = world.armiesRaised.get(p.id) ?? 0;
  world.armiesRaised.set(p.id, count + 1);
  const army: Army = {
    id: world.nextArmyId++,
    name: `${ORDINALS[count % ORDINALS.length]} ${HOST_WORDS[race] ?? 'Host'} of ${p.baseName}`,
    polityId: p.id, warId: war.id, size, raised: size, tile: staging.tile,
    targetSettlement: -1, targetArmy: -1, path: [], step: 0, siege: 0, victories: 0, fought: -1, alive: true,
  };
  world.armies.push(army);
  world.log('army', size > 3000 ? 2 : 1, `The ${p.name} raised the ${army.name}, ${size.toLocaleString('en-US')} strong, at ${staging.name}.`, { polities: [p.id], settlements: [staging.id], tile: staging.tile });
}

function chooseTarget(world: World, army: Army): number {
  const war = world.wars[army.warId];
  const p = world.polities[army.polityId];
  const enemy = enemiesOf(world, war, p);
  // Intercept an enemy army that is close, especially one inside our lands.
  let best = -1;
  let bestScore = Infinity;
  for (const e of world.armies) {
    if (!e.alive || e.polityId !== enemy.id) continue;
    const d = dist(world, army.tile, e.tile);
    const inOurLand = world.map.owner[e.tile] >= 0 && world.settlements[world.map.owner[e.tile]].polityId === p.id;
    const score = d - (inOurLand ? 8 : 0);
    if (d < 12 && score < bestScore) {
      bestScore = score;
      best = e.id;
    }
  }
  army.targetArmy = best;
  if (best >= 0) return world.armies.find((a) => a.id === best)!.tile;
  // Otherwise march on the nearest, weakest enemy town.
  let target: Settlement | null = null;
  let ts = Infinity;
  for (const id of enemy.settlementIds) {
    const s = world.settlements[id];
    if (!s.alive) continue;
    let d = dist(world, army.tile, s.tile) + Math.sqrt(s.pop) * 0.05;
    if (s.landmass !== world.map.landmass[army.tile]) {
      if (p.effects.seaTravel < 1) continue;
      d += 8;
    }
    if (d < ts) {
      ts = d;
      target = s;
    }
  }
  army.targetSettlement = target ? target.id : -1;
  return target ? target.tile : -1;
}

function march(world: World, army: Army): void {
  const war = world.wars[army.warId];
  const p = world.polities[army.polityId];
  if (war.end !== null || !p.alive) {
    army.alive = false;
    return;
  }
  // Attrition: disease, desertion and hunger, worse in harsh country.
  const biome = BIOMES[world.map.biome[army.tile]].key;
  const harsh = biome === 'desert' || biome === 'tundra' || biome === 'ice' || biome === 'mountain' || biome === 'wetland' ? 0.05 : 0;
  const loss = army.size * (0.02 + harsh);
  army.size -= loss;
  spreadLosses(world, p, loss);
  if (army.size < 20) {
    army.alive = false;
    world.log('army', 1, `The ${army.name} of the ${p.name} dwindled away to nothing.`, { polities: [p.id], tile: army.tile });
    return;
  }
  const target = world.settlements[army.targetSettlement];
  const targetGone = army.targetSettlement >= 0 && (!target?.alive || target.polityId === p.id);
  const armyGone = army.targetArmy >= 0 && !world.armies.some((a) => a.id === army.targetArmy && a.alive);
  if (army.path.length === 0 || targetGone || armyGone || army.targetArmy >= 0 || world.year % 3 === 0) {
    const goal = chooseTarget(world, army);
    if (goal < 0) {
      army.path = [];
      return;
    }
    const pf = world.pathfinder;
    pf.run(army.tile, 160, p.effects.seaTravel, (tile) => tile === goal);
    army.path = pf.pathTo(goal);
    army.step = 0;
  }
  if (army.siege > 0 && army.targetSettlement >= 0 && dist(world, army.tile, world.settlements[army.targetSettlement].tile) <= 1) return;
  let budget = MARCH * (1 + p.effects.roads * 0.2);
  while (budget > 0 && army.step < army.path.length - 1) {
    const next = army.path[army.step + 1];
    const c = tileCost(world.map, next, p.effects.seaTravel);
    budget -= Number.isFinite(c) ? c : 2;
    army.step++;
    army.tile = next;
    // Stop to fight any enemy army met on the road.
    if (world.armies.some((e) => e.alive && e.polityId !== p.id && world.atWar(e.polityId, p.id) && dist(world, e.tile, next) <= 1.5)) break;
  }
}

function battleName(world: World, tile: number): { name: string; near: Settlement | null } {
  let near: Settlement | null = null;
  let bd = Infinity;
  for (const s of world.aliveSettlements()) {
    const d = dist(world, s.tile, tile);
    if (d < bd) {
      bd = d;
      near = s;
    }
  }
  const map = world.map;
  const where = map.river[tile] > 0 ? 'Ford' : map.relief[tile] === Relief.Mountains ? 'Pass' : map.relief[tile] === Relief.Hills ? 'Heights' : BIOMES[map.biome[tile]].timber > 0.6 ? 'Wood' : map.elevation[tile] < 0 ? 'Waters' : 'Fields';
  return { name: near ? (bd <= 1 ? `the Battle of ${near.name}` : `the Battle of ${near.name} ${where}`) : 'a nameless battle', near };
}

function recordLosses(world: World, war: War, side: number, n: number): void {
  if (side === war.attacker) war.attackerLosses += n;
  else war.defenderLosses += n;
}

function engage(world: World, army: Army): void {
  const rng = world.rng;
  const p = world.polities[army.polityId];
  const war = world.wars[army.warId];
  // Field battle against a hostile army close by.
  const foe = world.armies.find((e) => e.alive && e.id !== army.id && e.fought !== world.year && e.polityId !== p.id && world.atWar(e.polityId, p.id) && dist(world, e.tile, army.tile) <= 1.5);
  if (army.fought === world.year) return;
  if (foe) {
    const q = world.polities[foe.polityId];
    const ownLand = (a: Army) => world.map.owner[a.tile] >= 0 && world.settlements[world.map.owner[a.tile]].polityId === a.polityId;
    const terrain = world.map.relief[foe.tile] === Relief.Hills ? 1.15 : world.map.relief[foe.tile] === Relief.Mountains ? 1.3 : 1;
    const sa = army.size * soldierQuality(world, p) * (ownLand(army) ? 1.1 : 1) * rng.range(0.7, 1.3);
    const sb = foe.size * soldierQuality(world, q) * (ownLand(foe) ? 1.1 : 1) * terrain * rng.range(0.7, 1.3);
    const aWins = rng.chance((sa * sa) / (sa * sa + sb * sb));
    const [win, lose] = aWins ? [army, foe] : [foe, army];
    const winP = world.polities[win.polityId];
    const loseP = world.polities[lose.polityId];
    const wl = win.size * rng.range(0.08, 0.22);
    const ll = lose.size * rng.range(0.35, 0.65);
    win.size -= wl;
    lose.size -= ll;
    win.victories++;
    // Each army fights at most one field battle a year.
    army.fought = foe.fought = world.year;
    spreadLosses(world, winP, wl);
    spreadLosses(world, loseP, ll);
    winP.warExhaustion += (wl / Math.max(1, winP.pop)) * 4 + 0.01;
    loseP.warExhaustion += (ll / Math.max(1, loseP.pop)) * 4 + 0.04;
    recordLosses(world, war, winP.id, wl);
    recordLosses(world, war, loseP.id, ll);
    war.battles++;
    const destroyed = lose.size < lose.raised * 0.2 || lose.size < 30;
    if (destroyed) lose.alive = false;
    else {
      // Beaten armies fall back towards home.
      lose.path = [];
      lose.targetSettlement = -1;
      lose.siege = 0;
    }
    const { name, near } = battleName(world, army.tile);
    const dead = Math.round(wl + ll);
    world.log('battle', dead > 5000 ? 3 : dead > 800 ? 2 : 1, `At ${name}, the ${win.name} of the ${winP.name} ${destroyed ? 'destroyed' : 'routed'} the ${lose.name} of the ${loseP.name}; ${dead.toLocaleString('en-US')} fell.`, { polities: [winP.id, loseP.id], settlements: near ? [near.id] : [], tile: army.tile });
    return;
  }
  // Siege or storm of the target town.
  if (army.targetSettlement < 0 || army.fought === world.year) return;
  const target = world.settlements[army.targetSettlement];
  if (!target.alive || target.polityId === p.id || dist(world, army.tile, target.tile) > 1) return;
  const def = world.polities[target.polityId];
  if (!world.atWar(p.id, def.id)) return;
  const relief = world.map.relief[target.tile];
  const terrain = relief === Relief.Mountains ? 1.5 : relief === Relief.Hills ? 1.25 : 1;
  const walls = 1 + def.effects.defense + world.cultures[target.cultureId].traitEffects.defense;
  const garrison = target.pop * 0.07 * walls * terrain * soldierQuality(world, def) + 1;
  const force = army.size * soldierQuality(world, p) * rng.range(0.7, 1.3);
  const ratio = force / garrison;
  const stormed = ratio > 1.1 && rng.chance((ratio * ratio) / (1 + ratio * ratio));
  const attLoss = army.size * rng.range(0.05, 0.15) * (stormed ? 0.7 : 1);
  const defLoss = Math.min(target.pop * 0.1, garrison * rng.range(0.1, 0.3));
  army.size -= attLoss;
  spreadLosses(world, p, attLoss);
  killPop(target, defLoss);
  p.warExhaustion += (attLoss / Math.max(1, p.pop)) * 4;
  def.warExhaustion += (defLoss / Math.max(1, def.pop)) * 4 + 0.02;
  recordLosses(world, war, p.id, attLoss);
  recordLosses(world, war, def.id, defLoss);
  target.stability -= 0.1;
  target.stock[0] *= 0.7; // the besiegers eat the harvest
  if (stormed) {
    army.victories++;
    army.siege = 0;
    army.path = [];
    captureSettlement(world, war, p, def, target, `the ${army.name}`);
  } else {
    army.siege++;
    if (army.siege === 1 && target.pop > 1500) world.log('battle', 2, `The ${army.name} of the ${p.name} laid siege to ${target.name}.`, { polities: [p.id, def.id], settlements: [target.id] });
    if (army.siege > 3) {
      world.log('battle', 1, `The siege of ${target.name} was abandoned by the ${army.name}.`, { polities: [p.id, def.id], settlements: [target.id] });
      army.siege = 0;
      army.targetSettlement = -1;
      army.path = [];
    }
  }
}
