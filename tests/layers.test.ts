import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate, type Climate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { buildEnv, type Env } from '../src/sim/env';
import { buildLayerLand, digYear, driftYear, layerFood, layerRoom, layerSpot, layerWalls, tunnelBetween, type LayerContext, type LayerWays } from '../src/sim/layers';
import { packSim, unpackSim } from '../src/sim/pack';
import { addDawnCity, eligibleRaces, newSim, stepDays } from '../src/sim/sim';
import type { Settlement, SimState } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 50, seed: 11 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => {
  const st = { ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke;
  surface.strokes.push(st);
  return st;
};
add('land', [1500, 1000], { size: 2400, roughness: 0.1 });
// The Underdark: a fungus-grown cavern with an entrance, and a sea beside it.
add('cavern', [1300, 1000, 1500, 1000], { size: 120 });
add('fungus', [1300, 1000, 1500, 1000], { size: 100 });
add('undersea', [1600, 1000], { size: 90 });
add('entrance', [1300, 1000]);
// A giant tree with a city site, and a sky island reached by a vine.
add('gianttree', [1000, 700], { size: 60 });
add('treecity', [1000, 700]);
const island = add('skyisland', [1400, 600, 1550, 620], { size: 120, sky: 1, roughness: 0 });
add('vine', [1250, 640, 1400, 610], { vineFrom: 'surface', vineTo: 'sky1' });

let cl: Climate;
let env: Env;
let lib: Library;
beforeAll(() => {
  cl = computeClimate(surface, settings);
  lib = defaultLibrary();
  env = buildEnv(cl, lib, surface);
}, 60000);

const ways = (o: Partial<LayerWays> = {}): LayerWays => ({ digs: false, under: false, trees: false, sky: false, dark: false, ...o });
const town = (x: number, y: number, o: Partial<Settlement> = {}): Settlement => ({ id: 1, name: 'Test', kind: 'village', clan: 1, species: 's', race: 'r', culture: 'c', x, y, pop: 400, fed: 1, warband: 40, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, ...o });
let seq = 1;
const ctx = (sim: SimState, has: string[] = []): LayerContext => ({
  sim,
  layers: env.layers,
  dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  rand: () => ((seq = (seq * 16807) % 2147483647) / 2147483647),
  has: (_st, id) => has.includes(id),
  log: () => {},
});

describe('the peoples on every layer', () => {
  it('reads the other layers’ land from the painting', () => {
    const L = env.layers;
    expect(L.under.filter((u) => !u.sea).length).toBeGreaterThan(5);
    expect(L.under.some((u) => u.sea)).toBe(true);
    expect(L.under.some((u) => u.cover === 1)).toBe(true);
    expect(L.ways.length).toBe(1);
    expect(L.trees.length).toBe(1);
    expect(L.cities.length).toBe(1);
    expect(L.islands.length).toBe(1);
    expect(L.islands[0].area).toBeGreaterThan(10000);
    expect(L.vines.length).toBe(1);
    expect(buildLayerLand({ strokes: [], nextId: 1 }, cl).under.length).toBe(0);
  });

  it('opens a layer only to those who can get there', () => {
    const sim = newSim(env, 3);
    // By the cave entrance anyone can go down; a cave people wants to.
    const below = layerSpot(ctx(sim), town(1280, 1000), { flies: false, mountains: false }, ways({ under: true, dark: true }), 40);
    expect(below?.layer).toBe('underdark');
    // Far from any way down, only diggers can, and they dig their own.
    const far = town(1350, 1230);
    const digger = layerSpot(ctx(sim), far, { flies: false, mountains: false }, ways({ digs: true, under: true, dark: true }), 40);
    expect(digger?.layer).toBe('underdark');
    expect(digger?.dug).toBe(true);
    // Tree folk climb to the city site in the canopy.
    const trees = layerSpot(ctx(sim), town(950, 750), { flies: false, mountains: false }, ways({ trees: true }), 40);
    expect(trees?.layer).toBe('canopy');
    // The sky: by the vine's foot, on wings, or by airship; not otherwise.
    const sky = ways({ sky: true });
    expect(layerSpot(ctx(sim), town(1240, 650), { flies: false, mountains: false }, sky, 40)?.layer).toBe('sky1');
    expect(layerSpot(ctx(sim), town(1800, 450), { flies: false, mountains: false }, sky, 40)).toBeNull();
    expect(layerSpot(ctx(sim), town(1800, 450), { flies: true, mountains: true }, sky, 40)?.layer).toBe('sky1');
    expect(layerSpot(ctx(sim, ['airships']), town(1800, 450), { flies: false, mountains: false }, sky, 40)?.layer).toBe('sky1');
  });

  it('feeds, holds and guards each layer its own way', () => {
    const sim = newSim(env, 3);
    const c = ctx(sim);
    const under = town(1400, 1000, { layer: 'underdark' });
    const bare = town(1400, 1500, { layer: 'underdark' });
    const sky = town(1450, 610, { layer: 'sky1', island: island.id });
    sim.settlements.push(under, sky);
    expect(layerFood(c, under).floor).toBeGreaterThan(layerFood(c, bare).floor);
    expect(layerFood(c, town(1, 1)).mul).toBe(1);
    expect(layerRoom(c, sky)).toBeGreaterThan(1000);
    expect(layerRoom(c, town(1, 1))).toBe(Infinity);
    expect(layerWalls(sky, { flies: false, airships: false, digs: false })).toBeGreaterThan(layerWalls(sky, { flies: true, airships: false, digs: false }));
    expect(layerWalls(under, { flies: false, airships: false, digs: true })).toBeLessThan(layerWalls(under, { flies: false, airships: false, digs: false }));
    expect(layerWalls(town(1, 1), { flies: false, airships: false, digs: false })).toBe(1);
  });

  it('carries towns with drifting islands, and joins diggers’ towns by tunnels', () => {
    const sim = newSim(env, 3);
    const L = { ...env.layers, islands: env.layers.islands.map((i) => ({ ...i, drift: 'wind' as const, pace: 50 })) };
    const c = { ...ctx(sim), layers: L };
    const sky = town(1450, 610, { id: 5, layer: 'sky1', island: island.id });
    sim.settlements.push(sky);
    driftYear(c, 3000, 2000, 0);
    driftYear(c, 3000, 2000, 0);
    const d = sim.drift![island.id];
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(100, 0);
    expect(Math.hypot(sky.x - 1450 - d.dx, sky.y - 610 - d.dy)).toBeLessThan(0.01);
    // Tunnelers.
    const a = town(1000, 1000, { id: 7, clan: 9 });
    const b = town(1150, 1000, { id: 8, clan: 9 });
    sim.settlements.push(a, b);
    for (let i = 0; i < 40 && !sim.tunnels?.length; i++) digYear(c, (st) => st.clan === 9);
    expect(tunnelBetween(sim, a, b)).toBeCloseTo(150, 0);
  });

  it('lets a cave people found towns in the Underdark as the years pass, and keeps them when saved', () => {
    const species = lib.species.find((s) => s.name === 'Human')!;
    const human = species.races.find((r) => r.name === 'Human')!;
    human.lifespan = 70;
    human.fightingAge ??= 16;
    const race = eligibleRaces(lib).find((r) => r.race.id === human.id)!;
    race.species.profile.layers = ['Underdark'];
    const sim = newSim(env, 5);
    addDawnCity(sim, env, lib, race.race.id, 1250, 980, 1500);
    stepDays(sim, env, lib, 360 * 40);
    const below = sim.settlements.filter((s) => s.layer === 'underdark');
    expect(below.length).toBeGreaterThan(0);
    expect(sim.events.some((e) => /into the Underdark/.test(e.text))).toBe(true);
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.settlements.filter((s) => s.layer === 'underdark').length).toBe(below.length);
    race.species.profile.layers = [];
  }, 120000);
});
