import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { ADAPT_MAX, adaptYear, levelsNeeded } from '../src/sim/adapt';
import { hardBirths, hardDeaths, type Wants } from '../src/sim/attraction';
import { densityMonth, type DensityRace } from '../src/sim/density';
import { buildEnv, type Env } from '../src/sim/env';
import { newSim, raceInfo, wantsOf } from '../src/sim/sim';
import type { LiveCulture } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 70, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });

let env: Env;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
}, 60000);

const wants = (cold: number): Wants => ({ tolerances: { heat: 3, cold, wet: 3, dry: 3, altitude: 3 }, climates: [], covers: [], heights: [], manaSensitive: false, passable: () => true });
const culture = (id: string): LiveCulture => ({ id, name: id, source: '', species: [], races: [], language: '', sounds: '', ethos: '', martial: '', lifestyles: [], traditions: [], specialties: [], behaviours: [], founded: 0, parent: '' });
/** The coldest land point (a far-northern world). */
const coldest = () => [...env.land.keys()].filter((k) => env.land[k]).sort((a, b) => Math.min(env.temp[0][a], env.temp[1][a]) - Math.min(env.temp[0][b], env.temp[1][b]))[0];

describe('hard country and adapting to it (step 3)', () => {
  it('makes life harder past a race’s tolerance: fewer births, more deaths, the harsher the more', () => {
    expect(hardBirths(1)).toBe(1);
    expect(hardDeaths(1)).toBe(0);
    expect(hardBirths(0.3)).toBeLessThan(hardBirths(0.7));
    expect(hardDeaths(0.3)).toBeGreaterThan(hardDeaths(0.7));
    // Families in the wild grow more slowly where the climate is hard on them.
    const k = Math.round((1000 - env.y0) / env.step) * env.w + Math.round((1500 - env.x0) / env.step);
    const run = (hard: number) => {
      const sim = newSim(env, 1);
      sim.density = { r: new Float32Array(env.n) };
      sim.density.r[k] = 200;
      const r: DensityRace = { need: 1, births: 0.06, deaths: 0.02, attitude: 'Indifferent', species: 'a', live: () => 1, hard: () => hard };
      for (let m = 0; m < 60; m++) densityMonth({ sim, env, left: new Float32Array(env.n).fill(5000), race: () => r });
      return sim.density.r.reduce((a, b) => a + b, 0);
    };
    expect(run(0.3)).toBeLessThan(run(1) * 0.85);
  });

  it('lets a culture living past its tolerance adapt over the generations, adaptable peoples faster, up to a limit', () => {
    const k = coldest();
    const need = levelsNeeded(env, k).cold;
    expect(need).toBeGreaterThan(2);
    const sim = newSim(env, 2);
    const slow = culture('slow');
    const fast = culture('fast');
    sim.cultures = [slow, fast];
    const logs: string[] = [];
    const people = (cu: LiveCulture) => [{ k, pop: 300, wants: wants(1 + (cu.adapt?.cold ?? 0)), adaptable: cu === fast }];
    for (let y = 0; y < 20; y++) adaptYear({ sim, env, people, log: (t) => logs.push(t) });
    expect(slow.adapt!.cold).toBeGreaterThan(0.2);
    expect(fast.adapt!.cold).toBeGreaterThan(slow.adapt!.cold * 2);
    expect(slow.adapt!.heat).toBe(0);
    expect(logs.some((t) => /grown used to the cold/.test(t))).toBe(true);
    for (let y = 0; y < 200; y++) adaptYear({ sim, env, people, log: () => {} });
    expect(fast.adapt!.cold).toBeLessThanOrEqual(ADAPT_MAX);
    // Moved to easy country: what it gained fades, very slowly.
    const warm = [...env.land.keys()].filter((q) => env.land[q]).sort((a, b) => Math.min(env.temp[0][b], env.temp[1][b]) - Math.min(env.temp[0][a], env.temp[1][a]))[0];
    const was = fast.adapt!.cold;
    for (let y = 0; y < 20; y++) adaptYear({ sim, env, people: () => [{ k: warm, pop: 300, wants: wants(5), adaptable: true }], log: () => {} });
    expect(fast.adapt!.cold).toBeLessThan(was);
    expect(fast.adapt!.cold).toBeGreaterThan(was - 0.2);
  });

  it('gives a culture’s people the tolerance they have gained (their kin elsewhere none)', () => {
    const lib = defaultLibrary();
    const elf = lib.species.find((q) => q.name === 'Elf')!.races.find((r) => r.name === 'Elf')!;
    const north = { ...culture('north'), adapt: { heat: 0, cold: 1.5, wet: 0, dry: 0, altitude: 0 } };
    const base = wantsOf(env, raceInfo(lib, elf.id)!).tolerances.cold;
    expect(wantsOf(env, raceInfo(lib, elf.id, 'north', [north])!).tolerances.cold).toBeCloseTo(base + 1.5, 5);
    expect(wantsOf(env, raceInfo(lib, elf.id, 'other', [north])!).tolerances.cold).toBe(base);
  });
});
