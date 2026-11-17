import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { buildEnv, type Env } from '../src/sim/env';
import { betterWays, findWay, groundCost, SCOUT_TRIPS, traderWay, wayCost } from '../src/sim/roads';
import { addDawnCity, newSim, stepDays } from '../src/sim/sim';
import { newEconomy } from '../src/sim/economy';
import type { Route } from '../src/sim/state';
import { waysYear } from '../src/sim/ways';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 21 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2400, roughness: 0.1 });
// A mountain range standing between west and east, with open country round its ends.
const ridge: number[] = [];
for (let y = 700; y <= 1300; y += 25) ridge.push(1500, y);
add('mountains', ridge, { size: 160, strength: 1 });

let env: Env;
let lib: Library;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
  lib = defaultLibrary();
  const human = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!;
  human.lifespan = 70;
  human.fightingAge ??= 16;
}, 60000);

const cellAt = (x: number, y: number) => Math.round((y - env.y0) / env.step) * env.w + Math.round((x - env.x0) / env.step);
const xOf = (k: number) => env.x0 + (k % env.w) * env.step;
const yOf = (k: number) => env.y0 + Math.floor(k / env.w) * env.step;

describe('roads (step 4)', () => {
  it('finds the easiest way over the land: round the mountains, never a straight line over them', () => {
    const sim = newSim(env, 1);
    const from = cellAt(1200, 1000);
    const to = cellAt(1800, 1000);
    expect(groundCost(env, cellAt(1500, 1000))).toBeGreaterThan(2);
    const way = findWay(sim, env, from, to)!;
    expect(way.cells[0]).toBe(from);
    expect(way.cells[way.cells.length - 1]).toBe(to);
    // Through easier ground than the straight line's, at a lower cost.
    const straight: number[] = [];
    for (let x = 1200; x <= 1800; x += env.step / 2) {
      const k = cellAt(x, 1000);
      if (straight[straight.length - 1] !== k) straight.push(k);
    }
    expect(way.cost).toBeLessThan(wayCost(sim, env, straight));
    expect(Math.max(...way.cells.map((k) => groundCost(env, k)))).toBeLessThan(Math.max(...straight.map((k) => groundCost(env, k))));
  });

  it('follows worn ways as far as they help, then breaks off onto a path of its own', () => {
    const sim = newSim(env, 2);
    // A road running east, along y = 1500, south of the ridge.
    const road: number[] = [];
    for (let x = 900; x <= 1300; x += env.step / 2) {
      const k = cellAt(x, 1500);
      if (road[road.length - 1] !== k) road.push(k);
    }
    expect(road.every((k) => env.land[k])).toBe(true);
    for (const k of road) sim.way[k] = 3;
    // Somewhere a little north of the road's far end.
    const way = findWay(sim, env, road[0], cellAt(1300, 1350))!;
    const onRoad = way.cells.filter((k) => sim.way[k] === 3).length;
    expect(onRoad).toBeGreaterThan(road.length * 0.6);
    // Off it at the end: a branch.
    expect(sim.way[way.cells[way.cells.length - 1]]).toBe(0);
  });

  it('scouts a route over its first trips, keeps the best way found, and then always goes that way', () => {
    const sim = newSim(env, 3);
    const from = cellAt(1200, 900);
    const to = cellAt(1800, 1100);
    const route: Route = { a: 1, b: 2, trips: 0, worth: 0, last: 0 };
    const costs: number[] = [];
    for (let t = 0; t < SCOUT_TRIPS + 3; t++) {
      const way = traderWay(sim, env, route, t % 2 ? to : from, t % 2 ? from : to)!;
      expect(way[0]).toBe(t % 2 ? to : from);
      costs.push(wayCost(sim, env, route.path!));
    }
    // Never worse than what was found before; settled once scouted.
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeLessThanOrEqual(costs[i - 1] + 1e-9);
    expect(route.scouted).toBe(SCOUT_TRIPS);
    const settled = route.path!.join();
    traderWay(sim, env, route, from, to);
    expect(route.path!.join()).toBe(settled);
  });

  it('moves a route to a much better way when one is made, and lets the old way fade as it goes unused', () => {
    const sim = newSim(env, 4);
    const from = cellAt(1100, 1600);
    const to = cellAt(1900, 1600);
    const via = cellAt(1500, 1900);
    // Its traders have gone the long way round, by a worn trail.
    const old = [...findWay(sim, env, from, via)!.cells, ...findWay(sim, env, via, to)!.cells.slice(1)];
    const route: Route = { a: 1, b: 2, trips: 10, worth: 0, last: 0, path: old, scouted: SCOUT_TRIPS };
    sim.routes.push(route);
    for (const k of old) [sim.way[k], sim.traffic[k]] = [1, 30];
    // A paved road is made straight across.
    for (let x = 1100; x <= 1900; x += env.step / 2) [sim.way[cellAt(x, 1600)], sim.traffic[cellAt(x, 1600)]] = [3, 30];
    expect(betterWays(sim, env, () => 0)).toEqual([route]);
    expect(route.path!.every((k) => Math.abs(yOf(k) - 1600) < env.step * 1.5)).toBe(true);
    expect(betterWays(sim, env, () => 0)).toHaveLength(0);
    // Nobody walks the old way now: it fades.
    const left = old.filter((k) => !route.path!.includes(k));
    for (const k of left) sim.traffic[k] = 0;
    waysYear({ sim, env, lib, cellAt, log: () => {} });
    expect(left.every((k) => sim.way[k] === 0)).toBe(true);
    // And a paved road nobody walks is not kept up: it falls back a tier a year.
    for (const k of route.path!) sim.traffic[k] = 0;
    waysYear({ sim, env, lib, cellAt, log: () => {} });
    expect(route.path!.filter((k) => sim.way[k] === 3)).toHaveLength(0);
    void xOf;
  });

  it('walks trading caravans along their routes’ ways, wearing trails over the land', () => {
    const sim = newSim(env, 5);
    const humanId = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!.id;
    const farming = ['agriculture', 'husbandry', 'fishing', 'pottery'];
    const elfId = lib.species.find((s) => s.name === 'Elf')!.races[0].id;
    const a = addDawnCity(sim, env, lib, humanId, 1000, 1000, 300, farming)!;
    const b = addDawnCity(sim, env, lib, elfId, 1000, 1200, 300, farming)!;
    a.economy = newEconomy(300, 1, 20);
    a.economy.stores = { grain: 9000 };
    b.economy = newEconomy(300, 1, 20);
    b.economy.stores = { provisions: 6000, salt: 600 };
    stepDays(sim, env, lib, 360 * 3);
    const routes = sim.routes.filter((r) => r.path && r.path.length > 2);
    expect(routes.length).toBeGreaterThan(0);
    const r = routes.sort((p, q) => q.trips - p.trips)[0];
    expect(r.trips).toBeGreaterThan(2);
    // Worn along its way.
    const worn = r.path!.filter((k) => sim.way[k] >= 1).length;
    expect(worn).toBeGreaterThan(r.path!.length * 0.5);
  }, 180000);
});
