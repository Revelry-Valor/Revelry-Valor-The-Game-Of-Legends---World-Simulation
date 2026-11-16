import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { canLiveTogether, densityAt, densityMonth, densityOf, seedDensity, totalsOver, type DensityRace } from '../src/sim/density';
import { buildEnv, type Env } from '../src/sim/env';
import { packSim, unpackSim } from '../src/sim/pack';
import { addDawnCity, newSim, stepDays } from '../src/sim/sim';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });

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
const race = (o: Partial<DensityRace> = {}): DensityRace => ({ need: 1, births: 0.05, deaths: 0.02, attitude: 'Indifferent', species: 'a', live: (k) => (env.land[k] ? 1 : -1), ...o });

describe('wilderness density', () => {
  it('starts only from something: nothing in the wild until a settlement sends families out', () => {
    const sim = newSim(env, 1);
    expect(Object.keys(sim.density ?? {}).length).toBe(0);
    const humanId = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!.id;
    addDawnCity(sim, env, lib, humanId, 1500, 1000, 1200);
    stepDays(sim, env, lib, 360 * 15);
    const D = sim.density![humanId];
    let total = 0;
    let reach = 0;
    let far = 0;
    for (let k = 0; k < env.n; k++) {
      if (D[k] <= 0) continue;
      total += D[k];
      reach++;
      const x = env.x0 + (k % env.w) * env.step;
      const y = env.y0 + Math.floor(k / env.w) * env.step;
      far = Math.max(far, Math.hypot(x - 1500, y - 1000));
    }
    expect(total).toBeGreaterThan(10);
    // Spread out over the land round the city, but not across the continent.
    expect(reach).toBeGreaterThan(5);
    expect(far).toBeLessThan(600);
    // Saved and back.
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.density![humanId].reduce((a, b) => a + b, 0)).toBeCloseTo(total, -1);
  }, 120000);

  it('spreads into land it can live on and dies out where it cannot', () => {
    const sim = newSim(env, 2);
    const k = cellAt(1500, 1000);
    seedDensity(sim, env, 'r', [k], 200);
    const left = new Float32Array(env.n).fill(1000);
    // The land west of x = 1400 can't keep them.
    const r = race({ live: (q) => (!env.land[q] ? -1 : (q % env.w) * env.step + env.x0 < 1400 ? -1 : 1) });
    for (let m = 0; m < 24; m++) densityMonth({ sim, env, left: left.fill(1000), race: () => r });
    const D = sim.density!.r;
    expect(D[k + 1]).toBeGreaterThan(0.3);
    expect(D[cellAt(1300, 1000)]).toBe(0);
    // Without food they die back.
    const before = D.reduce((a, b) => a + b, 0);
    for (const b of env.beastInfo) sim.beasts[b.id].fill(0);
    for (let m = 0; m < 24; m++) densityMonth({ sim, env, left: left.fill(0), race: () => r });
    expect(D.reduce((a, b) => a + b, 0)).toBeLessThan(before * 0.6);
  });

  it('hunts the game down where the families live', () => {
    const sim = newSim(env, 3);
    const k = cellAt(1500, 1000);
    const game = env.beastInfo.filter((b) => !b.water && env.beastK[b.id][k] > 0);
    expect(game.length).toBeGreaterThan(0);
    const before = game.reduce((a, b) => a + sim.beasts[b.id][k], 0);
    densityOf(sim, env, 'r')[k] = 3000;
    for (let m = 0; m < 6; m++) densityMonth({ sim, env, left: new Float32Array(env.n), race: () => race() });
    expect(game.reduce((a, b) => a + sim.beasts[b.id][k], 0)).toBeLessThan(before * 0.9);
    const t = totalsOver(sim, env, [k], 0);
    expect(t.people.r).toBeGreaterThan(0);
  });

  it('lets races that can live together share the land, and pushes the weaker out where they cannot', () => {
    const elf = race({ attitude: 'Wary', species: 'elf' });
    const man = race({ attitude: 'Welcoming', species: 'man' });
    const friend = race({ attitude: 'Welcoming', species: 'dwarf' });
    expect(canLiveTogether(man, 'man', friend, 'dwarf')).toBe(true);
    expect(canLiveTogether(man, 'man', elf, 'elf')).toBe(false);
    const sim = newSim(env, 4);
    const k = cellAt(1500, 1000);
    densityOf(sim, env, 'man')[k] = 400;
    densityOf(sim, env, 'elf')[k] = 100;
    densityOf(sim, env, 'dwarf')[k] = 100;
    const races: Record<string, DensityRace> = { man, elf, dwarf: friend };
    for (let m = 0; m < 36; m++) densityMonth({ sim, env, left: new Float32Array(env.n).fill(5000), race: (id) => races[id] });
    const here = Object.fromEntries(densityAt(sim, k).byRace);
    // Where they met, the elves (outnumbered, and unwilling to share) are pushed out; the dwarves
    // (welcome, and welcoming) stay alongside the men. All of them spread a little as well.
    expect((here.elf ?? 0) / here.man).toBeLessThan(0.05);
    expect(here.dwarf / here.man).toBeGreaterThan(0.15);
    const total = (id: string) => sim.density![id].reduce((a, b) => a + b, 0);
    expect(total('dwarf')).toBeGreaterThan(90);
    expect(total('elf')).toBeLessThan(total('dwarf'));
  });
});
