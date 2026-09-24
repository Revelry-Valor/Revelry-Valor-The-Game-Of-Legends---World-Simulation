import { ROAD_SPEED } from '../pathfinding';
import type { Polity } from '../types';
import type { World } from '../world';

export const ROAD_NAMES = ['None', 'Trail', 'Cart track', 'Paved road', 'Highway'];
export { ROAD_SPEED };
/** Yearly traffic (value of goods carried past a tile) that justifies each road level. */
export const ROAD_TRAFFIC = [0, 30, 220, 900, 3200];
/** Treasury cost per tile to build each level, before terrain difficulty. */
const ROAD_COST = [0, 0, 6, 25, 80];

/** Best road a nation knows how to build: trails always, cart tracks with the wheel, paved roads with construction, highways with engineering. */
export function roadTechLevel(p: Polity): number {
  if (p.techs.has('engineering')) return 4;
  if (p.techs.has('construction')) return 3;
  if (p.techs.has('the_wheel')) return 2;
  return 1;
}

/**
 * Roads grow from use. Feet and hooves wear trails along any busy way for free; above that,
 * each nation spends from its treasury to upgrade its most important stretches, as far as its
 * road-building knowledge allows. Neglected roads crumble back a level.
 */
export function updateRoads(world: World): void {
  const map = world.map;
  const rng = world.rng;
  const budget = new Map<number, number>();
  for (const p of world.alivePolities()) budget.set(p.id, p.treasury * 0.15);
  const upgrades: { tile: number; polity: number; level: number; importance: number }[] = [];
  for (let i = 0; i < map.size; i++) {
    const t = map.traffic[i];
    const cur = map.road[i];
    if (t <= 0 && cur <= 0) continue;
    if (map.elevation[i] < 0) {
      map.road[i] = 0;
      map.traffic[i] = t * 0.6;
      continue;
    }
    const o = map.owner[i];
    const polity = o >= 0 ? world.settlements[o].polityId : -1;
    const max = polity >= 0 ? roadTechLevel(world.polities[polity]) : 1;
    let want = 0;
    for (let l = 1; l < ROAD_TRAFFIC.length; l++) if (t >= ROAD_TRAFFIC[l]) want = l;
    want = Math.min(want, max);
    if (want > cur) {
      if (cur === 0) map.road[i] = 1; // a trail wears in by itself
      else if (polity >= 0) upgrades.push({ tile: i, polity, level: cur + 1, importance: t });
    } else if (cur > 0 && (t < ROAD_TRAFFIC[cur] * 0.25 || cur > max) && rng.chance(0.08)) {
      map.road[i] = cur - 1;
    }
    map.traffic[i] = t * 0.6;
  }
  // The busiest stretches are upgraded first, as far as each treasury allows.
  upgrades.sort((a, b) => b.importance - a.importance);
  const firsts = new Map<number, number>();
  for (const u of upgrades) {
    const left = budget.get(u.polity) ?? 0;
    const cost = ROAD_COST[u.level] * map.moveCost[u.tile];
    if (left < cost) continue;
    budget.set(u.polity, left - cost);
    const p = world.polities[u.polity];
    p.treasury -= cost;
    map.road[u.tile] = u.level;
    if (u.level >= 3) firsts.set(u.polity, Math.max(firsts.get(u.polity) ?? 0, u.level));
  }
  for (const [pid, level] of firsts) {
    const key = `road:${pid}:${level}`;
    if (world.flags.has(key)) continue;
    world.flags.add(key);
    const p = world.polities[pid];
    world.log('road', 2, level === 4 ? `The ${p.name} began building great engineered highways between its cities.` : `The ${p.name} laid its first paved roads, stone by stone, along its busiest ways.`, { polities: [pid] });
  }
}
