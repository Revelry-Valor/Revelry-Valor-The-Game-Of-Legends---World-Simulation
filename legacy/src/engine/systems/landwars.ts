import { BIOMES, Relief } from '../data/biomes';
import { TRAVEL_SEASON } from '../calendar';
import type { Band, LandWar, Settlement, Warband, WarbandSource } from '../types';
import type { World } from '../world';
import { armyStage } from './military';
import { clanCode, clanOfCode, giveToNation, holdable, isClan, neighbours, powerAt } from './territory';

/** Terrain cost a warband covers in a month: lightly laden fighters, faster than a tribe on the move. */
const WARBAND_PACE = 7;
/** How far around the land fought over a side gathers its fighters. */
const MUSTER_R = 14;
/** Most warbands a side sends out in one war. */
const MAX_SENT = 3;
/** Months a warband stays out before it heads home, win or lose. */
const CAMPAIGN = 10;
/** Years of truce after a land war. */
const TRUCE = 12;

const sideKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** A side's name for the chronicle: "the Azouda clan", "the Kingdom of Gruinar". */
export function sideName(world: World, code: number): string {
  if (isClan(code)) return `the ${world.tribes[clanOfCode(code)].name} clan`;
  return `the ${world.polities[code]?.name ?? 'unknown'}`;
}

export function sideColor(world: World, code: number): string {
  return isClan(code) ? world.tribes[clanOfCode(code)].color : world.polities[code]?.color ?? '#888';
}

function sideAlive(world: World, code: number): boolean {
  if (isClan(code)) return world.bands.some((b) => b.alive && b.tribeId === clanOfCode(code));
  return world.polities[code]?.alive ?? false;
}

function cultureOf(world: World, code: number): number {
  return isClan(code) ? world.tribes[clanOfCode(code)].cultureId : world.polities[code].cultureId;
}

function chebyshev(world: World, a: number, b: number): number {
  const w = world.map.width;
  return Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
}

/** The land war (if any) being fought between two sides. */
export function landWarBetween(world: World, a: number, b: number): LandWar | undefined {
  return world.landWars.find((w) => w.end === null && ((w.attacker === a && w.defender === b) || (w.attacker === b && w.defender === a)));
}

const placeOf = (world: World, t: number) => {
  const map = world.map;
  if (BIOMES[map.biome[t]].water) return 'the shore';
  const key = BIOMES[map.biome[t]].name.toLowerCase();
  return map.river[t] > 0 ? `the ${key} by the river` : map.relief[t] === Relief.Hills ? `the ${key} hills` : `the ${key}`;
};

/**
 * One side declares war on another to take land it holds: there is no taking held land quietly.
 * Returns null if they are already at war, under a truce, or either is gone.
 */
export function declareLandWar(world: World, attacker: number, defender: number, aim: number, why: string): LandWar | null {
  if (attacker === defender || !sideAlive(world, attacker) || !sideAlive(world, defender)) return null;
  if (landWarBetween(world, attacker, defender)) return null;
  if ((world.landTruces.get(sideKey(attacker, defender)) ?? -1) > world.year) return null;
  const war: LandWar = {
    id: world.landWars.length, name: `the war for ${placeOf(world, aim)}`, attacker, defender, start: world.monthIndex, end: null, aim,
    battles: 0, attackerWins: 0, defenderWins: 0, attackerLosses: 0, defenderLosses: 0, raisedA: 0, raisedB: 0, outcome: null,
  };
  world.landWars.push(war);
  const clans = [attacker, defender].filter(isClan).map(clanOfCode);
  for (const c of clans) for (const o of clans) if (c !== o) world.tribes[c].feuds[o] = world.year;
  world.log(isClan(attacker) && isClan(defender) ? 'tribe' : 'war', 1, `${cap(sideName(world, attacker))} declared war on ${sideName(world, defender)} ${why}, and sent out its warriors to take ${placeOf(world, aim)}.`, {
    cultures: [cultureOf(world, attacker), cultureOf(world, defender)],
    polities: [attacker, defender].filter((c) => !isClan(c)),
    tile: aim,
  });
  raiseWarband(world, war, attacker, aim);
  return war;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Fighting strength of one warrior of a side: weapons, horses and warlike ways. */
function quality(world: World, code: number): number {
  const techs = isClan(code) ? world.tribes[clanOfCode(code)].techs : world.polities[code].techs;
  const culture = world.cultures[cultureOf(world, code)];
  let q = 0.8 + culture.values.militarism * 0.4;
  if (techs.has('copper_working')) q += 0.1;
  if (techs.has('bronze_working')) q += 0.25;
  if (techs.has('horseback_riding')) q += 0.2;
  if (techs.has('iron_working')) q += 0.3;
  return q;
}

/**
 * Gather a warband: a clan calls out the fighting men and women of its tribes near the land fought
 * over; a nation calls out a levy from its settlements near it. They leave their homes for the
 * campaign and go back to them when it is done.
 */
function raiseWarband(world: World, war: LandWar, side: number, target: number): Warband | null {
  const sources: WarbandSource[] = [];
  let size = 0;
  let home = -1;
  let biggest = 0;
  const culture = world.cultures[cultureOf(world, side)];
  // Clans and early settlements send every able fighter; a levy takes far fewer, a standing army fewer still.
  const rate = isClan(side) ? 0.2 : { warband: 0.15, levy: 0.05, professional: 0.03 }[armyStage(world.polities[side])];
  const take = (pop: number) => Math.floor(pop * rate * (0.6 + culture.values.militarism * 0.8));
  if (isClan(side)) {
    const clan = clanOfCode(side);
    for (const b of world.bands) {
      if (!b.alive || b.tribeId !== clan) continue;
      const at = b.home >= 0 ? b.home : b.tile;
      if (chebyshev(world, at, war.aim) > MUSTER_R) continue;
      const n = take(b.pop);
      if (n < 3) continue;
      cut(b.races, n / b.pop);
      b.pop -= n;
      sources.push({ kind: 'band', id: b.id, clan, n });
      size += n;
      if (n > biggest) {
        biggest = n;
        home = b.tile;
      }
    }
  } else {
    // A nation calls out its three settlements nearest the land fought over.
    const p = world.polities[side];
    const near = p.settlementIds
      .map((id) => world.settlements[id])
      .filter((s) => s.alive)
      .sort((a, b) => chebyshev(world, a.tile, war.aim) - chebyshev(world, b.tile, war.aim))
      .slice(0, 3);
    for (const s of near) {
      const n = Math.min(take(s.pop), 2000);
      if (n < 5) continue;
      cut(s.races, n / s.pop);
      s.pop -= n;
      sources.push({ kind: 'settlement', id: s.id, clan: -1, n });
      size += n;
      if (n > biggest) {
        biggest = n;
        home = s.tile;
      }
    }
  }
  if (size < 8 || home < 0) {
    for (const src of sources) giveBack(world, src, src.n);
    return null;
  }
  if (side === war.attacker) war.raisedA++;
  else war.raisedB++;
  const from = isClan(side) ? `of ${sideName(world, side)}` : `of ${world.settlements[sources.sort((a, b) => b.n - a.n)[0].id].name}`;
  const wb: Warband = {
    id: world.nextWarbandId++, name: `the warband ${from}`, warId: war.id, side, size, raised: size, sources, home,
    tile: home, target, path: [], step: 0, prevStep: 0, homeward: false, months: 0, alive: true,
  };
  world.warbands.push(wb);
  return wb;
}

function cut(races: Record<string, number>, share: number): void {
  const k = Math.max(0, 1 - share);
  for (const r in races) races[r] *= k;
}

/** Survivors go home to the tribe or settlement they came from (or to kin, if it is gone). */
function giveBack(world: World, src: WarbandSource, n: number): void {
  if (n <= 0) return;
  if (src.kind === 'settlement') {
    const s: Settlement | undefined = world.settlements[src.id];
    if (s?.alive) return addPeople(s, n);
    return;
  }
  const b: Band | undefined = world.bands.find((x) => x.id === src.id && x.alive) ?? world.bands.find((x) => x.alive && x.tribeId === src.clan);
  if (b) addPeople(b, n);
}

function addPeople(o: { races: Record<string, number>; pop: number }, n: number): void {
  const total = o.pop > 0 ? o.pop : 1;
  const keys = Object.keys(o.races);
  if (!keys.length) return;
  for (const r of keys) o.races[r] += (n * (o.races[r] || total / keys.length)) / total;
  o.pop += n;
}

/**
 * Marching through land: an enemy's land (in this war) is occupied as the warband or army passes;
 * open land next to its own side's is claimed; its own side's land the enemy occupied is freed.
 */
export function passThrough(world: World, side: number, enemy: number, t: number): void {
  const map = world.map;
  const spots = [t];
  neighbours(map.width, map.height, t, (n) => spots.push(n));
  for (const n of spots) {
    if (!holdable(world, n)) continue;
    const holder = powerAt(world, n);
    if (holder === enemy) map.occupier[n] = side;
    else if (holder === side && map.occupier[n] === enemy) map.occupier[n] = -1;
    else if (holder === -1 && map.elevation[n] >= 0 && touchesSide(world, n, side)) claimFor(world, n, side);
  }
}

function touchesSide(world: World, t: number, side: number): boolean {
  let yes = false;
  neighbours(world.map.width, world.map.height, t, (n) => {
    if (!yes && powerAt(world, n) === side) yes = true;
  });
  return yes;
}

function claimFor(world: World, t: number, side: number): void {
  if (isClan(side)) {
    world.map.region[t] = -1;
    world.map.claim[t] = clanOfCode(side);
  } else giveToNation(world, t, side);
}

/** Every month: warbands march, occupy, fight and go home; wars end when the fighting is done. */
export function warbandsMonth(world: World): void {
  const rng = world.rng;
  for (const war of world.landWars) {
    if (war.end !== null) continue;
    const age = world.monthIndex - war.start;
    const out = (side: number) => world.warbands.filter((b) => b.alive && b.warId === war.id && b.side === side && !b.homeward);
    if (!sideAlive(world, war.attacker) || !sideAlive(world, war.defender)) {
      endLandWar(world, war);
      continue;
    }
    // Further raids in the first year if the first went home.
    if (!out(war.attacker).length && war.raisedA < MAX_SENT && age < 14 && age % 4 === 3 && world.season !== 'winter') raiseWarband(world, war, war.attacker, war.aim);
    // Defenders gather when an enemy warband is in or near their land.
    const raiders = out(war.attacker);
    if (raiders.length && !out(war.defender).length && war.raisedB < MAX_SENT) {
      const near = raiders.find((r) => chebyshev(world, r.tile, war.aim) <= 8);
      if (near) raiseWarband(world, war, war.defender, near.tile);
    }
    const busy = world.warbands.some((b) => b.alive && b.warId === war.id && !b.homeward);
    if ((!busy && age >= 4 && (war.raisedA >= MAX_SENT || age >= 14)) || age >= 36) endLandWar(world, war);
  }
  for (const wb of world.warbands) {
    if (!wb.alive) continue;
    wb.prevStep = wb.step;
    wb.months++;
    const war = world.landWars[wb.warId];
    const enemy = war.attacker === wb.side ? war.defender : war.attacker;
    if (!wb.homeward && (war.end !== null || wb.months > CAMPAIGN)) goHome(world, wb);
    if (!wb.homeward) {
      // Hunt the enemy's warband if it is near, otherwise make for the land fought over.
      const foe = world.warbands.find((o) => o.alive && o.warId === wb.warId && o.side === enemy && !o.homeward && chebyshev(world, o.tile, wb.tile) <= 10);
      const goal = foe ? foe.tile : wb.side === war.attacker ? war.aim : wb.target;
      if (goal !== wb.target || wb.path.length === 0 || wb.months % 2 === 0) plot(world, wb, goal);
    }
    let budget = WARBAND_PACE * TRAVEL_SEASON[world.season];
    while (budget > 0 && wb.step < wb.path.length - 1) {
      wb.step++;
      const t = wb.path[wb.step];
      const c = world.map.moveCost[t];
      budget -= Number.isFinite(c) ? c : 1.5;
      wb.tile = t;
      if (!wb.homeward && world.map.elevation[t] >= 0) passThrough(world, wb.side, enemy, t);
    }
    // Hardship in the field.
    wb.size *= 1 - (world.season === 'winter' ? 0.02 : 0.008);
    if (wb.homeward && wb.step >= wb.path.length - 1) {
      disband(world, wb);
      continue;
    }
    // At the land fought over: take it all around, then (after a while) go home.
    if (!wb.homeward && wb.side === war.attacker && chebyshev(world, wb.tile, war.aim) <= 1) {
      around(world, war.aim, 2, (t) => passThrough(world, wb.side, enemy, t));
      if (rng.chance(0.35)) goHome(world, wb);
    }
  }
  // Battles between warbands that meet.
  for (const a of world.warbands) {
    if (!a.alive || a.homeward) continue;
    const war = world.landWars[a.warId];
    const b = world.warbands.find((o) => o.alive && !o.homeward && o.warId === a.warId && o.side !== a.side && chebyshev(world, o.tile, a.tile) <= 1);
    if (b) battle(world, war, a, b);
  }
  world.warbands = world.warbands.filter((b) => b.alive);
}

function around(world: World, t: number, r: number, fn: (n: number) => void): void {
  const w = world.map.width;
  const x0 = t % w;
  const y0 = (t - x0) / w;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x >= 0 && y >= 0 && x < w && y < world.map.height) fn(y * w + x);
    }
  }
}

function plot(world: World, wb: Warband, goal: number): void {
  wb.target = goal;
  const pf = world.pathfinder;
  pf.run(wb.tile, 120, 0, (t) => t === goal);
  const path = pf.pathTo(goal);
  wb.path = path.length > 1 ? path : [wb.tile];
  wb.step = 0;
  wb.prevStep = 0;
}

function goHome(world: World, wb: Warband): void {
  wb.homeward = true;
  plot(world, wb, wb.home);
  if (wb.path.length <= 1) disband(world, wb);
}

function disband(world: World, wb: Warband): void {
  wb.alive = false;
  const share = wb.raised > 0 ? Math.max(0, wb.size) / wb.raised : 0;
  for (const src of wb.sources) giveBack(world, src, src.n * share);
}

function battle(world: World, war: LandWar, a: Warband, b: Warband): void {
  const rng = world.rng;
  const map = world.map;
  const onOwn = (wb: Warband) => (powerAt(world, wb.tile) === wb.side ? 1.15 : 1);
  const terrain = map.relief[b.tile] === Relief.Hills ? 1.1 : map.relief[b.tile] === Relief.Mountains ? 1.25 : 1;
  const sa = a.size * quality(world, a.side) * onOwn(a) * rng.range(0.7, 1.3);
  const sb = b.size * quality(world, b.side) * onOwn(b) * terrain * rng.range(0.7, 1.3);
  const [win, lose] = rng.chance((sa * sa) / (sa * sa + sb * sb)) ? [a, b] : [b, a];
  const wl = win.size * rng.range(0.06, 0.18);
  const ll = lose.size * rng.range(0.3, 0.6);
  win.size -= wl;
  lose.size -= ll;
  war.battles++;
  if (win.side === war.attacker) {
    war.attackerWins++;
    war.attackerLosses += wl;
    war.defenderLosses += ll;
  } else {
    war.defenderWins++;
    war.defenderLosses += wl;
    war.attackerLosses += ll;
    // Defenders who win throw the raiders out of the land around.
    around(world, win.tile, 3, (t) => {
      if (map.occupier[t] === lose.side && powerAt(world, t) === win.side) map.occupier[t] = -1;
    });
  }
  goHome(world, lose);
  world.battleMarks.push({ tile: win.tile, at: world.monthIndex, size: wl + ll, kind: 'battle' });
  const dead = Math.round(wl + ll);
  const clansOnly = isClan(war.attacker) && isClan(war.defender);
  const label = (wb: Warband) => (isClan(wb.side) ? wb.name : `${wb.name} (${sideName(world, wb.side)})`);
  world.log(clansOnly ? 'tribe' : 'battle', dead > 150 ? 2 : 1, `In ${placeOf(world, win.tile)}, ${label(win)} routed ${label(lose)}; ${dead} fell.`, {
    cultures: [cultureOf(world, win.side), cultureOf(world, lose.side)],
    polities: [win.side, lose.side].filter((c) => !isClan(c)),
    tile: win.tile,
  });
}

/**
 * The war ends. Land a side took and still holds goes to it if it won the war; if it lost, the land
 * goes back. The side that won more of the fighting (holding its own counts for the defender) wins.
 */
function endLandWar(world: World, war: LandWar): void {
  const map = world.map;
  const A = war.attacker;
  const B = war.defender;
  let takenA = 0;
  let takenB = 0;
  for (let t = 0; t < map.size; t++) {
    if (map.occupier[t] === A && powerAt(world, t) === B) takenA++;
    else if (map.occupier[t] === B && powerAt(world, t) === A) takenB++;
  }
  const aliveA = sideAlive(world, A);
  const aliveB = sideAlive(world, B);
  const scoreA = war.attackerWins * 2 + takenA / 8;
  const scoreB = war.defenderWins * 2 + takenB / 8 + 1;
  const winner = !aliveB ? A : !aliveA ? B : scoreA > scoreB ? A : B;
  const loser = winner === A ? B : A;
  let gained = 0;
  for (let t = 0; t < map.size; t++) {
    const occ = map.occupier[t];
    if (occ !== A && occ !== B) continue;
    const holder = powerAt(world, t);
    if (holder !== A && holder !== B) {
      map.occupier[t] = -1;
      continue;
    }
    if (occ === winner && holder === loser) {
      claimFor(world, t, winner);
      gained++;
    }
    map.occupier[t] = -1;
  }
  war.end = world.monthIndex;
  world.landTruces.set(sideKey(A, B), world.year + TRUCE);
  for (const wb of world.warbands) if (wb.alive && wb.warId === war.id && !wb.homeward) goHome(world, wb);
  if (isClan(winner)) world.tribes[clanOfCode(winner)].wins++;
  if (isClan(loser)) world.tribes[clanOfCode(loser)].losses++;
  // Tribes whose home range is no longer their clan's must look for new land.
  for (const b of world.bands) {
    if (!b.alive || b.home < 0) continue;
    if (powerAt(world, b.home) !== clanCode(b.tribeId) && map.claim[b.home] !== b.tribeId) {
      b.home = -1;
      b.searching = 0;
    }
  }
  const lost = Math.round(war.attackerLosses + war.defenderLosses);
  war.outcome = winner === A ? `${sideName(world, A)} took ${gained ? 'the land' : 'nothing worth keeping'}` : `${sideName(world, B)} held its land`;
  world.log(isClan(A) && isClan(B) ? 'tribe' : 'peace', gained > 20 || lost > 300 ? 2 : 1,
    winner === A
      ? `${cap(war.name)} ended: ${sideName(world, A)} won and kept ${gained} tiles of land taken from ${sideName(world, B)} (${lost} fell in ${war.battles} fight${war.battles === 1 ? '' : 's'}).`
      : `${cap(war.name)} ended: ${sideName(world, B)} held its land against ${sideName(world, A)}, and what was taken went back (${lost} fell in ${war.battles} fight${war.battles === 1 ? '' : 's'}).`,
    { cultures: [cultureOf(world, A), cultureOf(world, B)], polities: [A, B].filter((c) => !isClan(c)), tile: war.aim });
  world.territoryDirty = true;
}

/** At the end of a war between nations: land a nation's armies hold goes to the winner, or back. */
export function settleOccupiedLand(world: World, a: number, b: number, winner: number | null): number {
  const map = world.map;
  let moved = 0;
  for (let t = 0; t < map.size; t++) {
    const occ = map.occupier[t];
    if (occ !== a && occ !== b) continue;
    const holder = powerAt(world, t);
    if (holder !== a && holder !== b) {
      map.occupier[t] = -1;
      continue;
    }
    if (occ === winner && holder !== winner && giveToNation(world, t, winner)) moved++;
    map.occupier[t] = -1;
  }
  return moved;
}
