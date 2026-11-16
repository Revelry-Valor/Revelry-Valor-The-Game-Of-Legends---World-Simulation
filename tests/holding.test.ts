import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { densityOf } from '../src/sim/density';
import { buildEnv, type Env } from '../src/sim/env';
import { holdYear, type Presence } from '../src/sim/holding';
import { holderOf, provAt, setHolder } from '../src/sim/land';
import { newSim } from '../src/sim/sim';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });

let env: Env;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
}, 60000);

const open = () => false;
const town = (clan: number, x: number, pop: number, race = 'man'): Presence => ({ clan, race, x, y: 1000, pop, r: 150, seat: true });
const at = (x: number, y = 1000) => provAt(env, x, y);

describe('land held by the people living on it (step 3)', () => {
  it('gives a settlement its own province and the land its people work, fading out, and lets go of land nobody uses', () => {
    const sim = newSim(env, 1);
    // Old land far off, with nobody about it any more.
    setHolder(sim, env, at(800), 1);
    holdYear(sim, env, [town(1, 1500, 500)], open);
    expect(holderOf(sim, at(1500))).toBe(1);
    expect(holderOf(sim, at(1600))).toBe(1);
    expect(holderOf(sim, at(1900))).toBe(-1);
    expect(holderOf(sim, at(800))).toBe(-1);
    // A hamlet too small to claim more than where it stands.
    holdYear(sim, env, [town(1, 1500, 500), town(2, 2200, 3)], open);
    expect(holderOf(sim, at(2200))).toBe(2);
    expect(holderOf(sim, at(2280))).toBe(-1);
  });

  it('makes land contested where two realms’ people mix, and moves it without a war to whichever comes to outnumber the other', () => {
    const sim = newSim(env, 2);
    const mid = at(1600);
    holdYear(sim, env, [town(1, 1500, 600), town(2, 1720, 500)], open);
    expect(holderOf(sim, mid)).toBe(1);
    expect(sim.provRival![mid]).toBe(2);
    expect(sim.provRivalUse![mid]).toBeGreaterThan(45);
    // Far from either: firmly one realm's.
    expect(sim.provRival![at(1350)]).toBe(-1);
    // A little more of the other realm's people: the holder keeps it (borders don't flicker)...
    holdYear(sim, env, [town(1, 1500, 600), town(2, 1720, 800)], open);
    expect(holderOf(sim, mid)).toBe(1);
    // ...until they far outnumber the holder's.
    holdYear(sim, env, [town(1, 1500, 300), town(2, 1720, 1600)], open);
    expect(holderOf(sim, mid)).toBe(2);
    // The province a settlement stands in moves only with the settlement (war, treaties).
    expect(holderOf(sim, at(1500))).toBe(1);
    holdYear(sim, env, [town(2, 1500, 300), town(2, 1720, 1600)], open);
    expect(holderOf(sim, at(1500))).toBe(2);
  });

  it('counts the families in the wild for the realm of their race, creeping out over the land they spread into, and for nobody in empty land', () => {
    const sim = newSim(env, 3);
    const D = densityOf(sim, env, 'man');
    // Families all along a valley east of the town, out past its own reach; and a few far off on their own.
    for (let x = 1500; x <= 1900; x += env.step / 2) D[env.prov.centre[at(x)]] = 60;
    D[env.prov.centre[at(2500)]] = 60;
    const t: Presence = { ...town(1, 1500, 400), r: 160 };
    holdYear(sim, env, [t], open);
    expect(holderOf(sim, at(1880))).toBe(-1);
    for (let y = 0; y < 30; y++) holdYear(sim, env, [t], open);
    expect(holderOf(sim, at(1880))).toBe(1);
    expect(holderOf(sim, at(2500))).toBe(-1);
    // Families of another race give the town's realm nothing.
    const sim2 = newSim(env, 4);
    const E = densityOf(sim2, env, 'elf');
    for (let x = 1500; x <= 1900; x += env.step / 2) E[env.prov.centre[at(x)]] = 60;
    for (let y = 0; y < 30; y++) holdYear(sim2, env, [t], open);
    expect(holderOf(sim2, at(1880))).toBe(-1);
  });
});
