import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { offshoot } from '../src/sim/cultureChange';
import { pressures } from '../src/sim/culturetick';
import { coreDistanceOf, driftTick, BLEND_TICKS, SPLIT_AT, type DriftContext } from '../src/sim/drift';
import { townFx } from '../src/sim/culture';
import { newEconomy } from '../src/sim/economy';
import { buildEnv, type Env } from '../src/sim/env';
import { provAt } from '../src/sim/land';
import { popsOf, sharesOf } from '../src/sim/pops';
import { addDawnCity, newSim, settlementTier } from '../src/sim/sim';
import type { LiveCulture, Settlement, SimState } from '../src/sim/state';
import { levelOf } from '../src/sim/traits';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });

let env: Env;
let lib: Library;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
  lib = defaultLibrary();
}, 60000);
const humanId = () => lib.species.find((s) => s.name === 'Human')!.races[0].id;
const tick = { provAt: (x: number, y: number) => provAt(env, x, y), tier: (st: Settlement) => settlementTier(st), capital: (st: Settlement) => st.kind === 'dawn' };
const dctx = (sim: SimState, accept = 0.5): DriftContext => ({
  sim, env, lib, ...tick,
  press: pressures({ sim, env, lib, ...tick, enforce: () => 0, log: () => {} }),
  make: (from, hint) => offshoot({ sim, lib, rand: () => 0.5, dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by), log: () => {} }, from, hint),
  acceptance: () => accept,
  log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }),
});
/** A town of a culture at a point. */
function town(sim: SimState, culture: string, race: string, x: number, y: number, pop: number): Settlement {
  const st: Settlement = { id: sim.nextId++, name: `T${sim.nextId}`, kind: 'village', seat: true, clan: -5, species: '', race, culture, x, y, pop, fed: 1, warband: 20, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(pop, 1, 3), techs: [] };
  sim.settlements.push(st);
  popsOf(sim, st);
  return st;
}

describe('drift, splits, blends and cohesion (cultures as peoples, step 4)', () => {
  it('lets a region far from its heartland drift away and split off as a subculture, while one near stays close', () => {
    const sim = newSim(env, 1);
    const heart = addDawnCity(sim, env, lib, humanId(), 700, 1000, 3000, ['agriculture'])!;
    popsOf(sim, heart);
    const near = town(sim, heart.culture, heart.race, 750, 1000, 400);
    const far = town(sim, heart.culture, heart.race, 2300, 1000, 600);
    const parent = sim.cultures!.find((c) => c.id === heart.culture)!;
    const d = (st: Settlement) => coreDistanceOf(sim, env, st, tick.provAt) ?? 0;
    for (let t = 0; t < 3; t++) driftTick(dctx(sim));
    expect(d(far)).toBeGreaterThan(d(near));
    expect(d(far)).toBeLessThan(SPLIT_AT);
    for (let t = 0; t < 12 && far.culture === parent.id; t++) driftTick(dctx(sim));
    expect(d(near)).toBeLessThan(0.15);
    expect(near.culture).toBe(parent.id);
    const nc = sim.cultures!.find((c) => c.id === far.culture)!;
    expect(nc.id).not.toBe(parent.id);
    expect(nc.parent).toBe(parent.id);
    expect(levelOf(nc)).toBe('subculture');
    // Still the same tongue (a dialect first).
    expect(nc.language).toBe(parent.language || parent.name);
    expect(sharesOf(far.pops!, 'culture')[0][0]).toBe(nc.id);
    expect(sim.events.some((e) => e.text.includes(`have become a people of their own: the ${nc.name}`))).toBe(true);
  });

  it('holds a region close where roads tie it to the heartland', () => {
    const run = (road: boolean) => {
      const sim = newSim(env, 2);
      const heart = addDawnCity(sim, env, lib, humanId(), 700, 1000, 3000, ['agriculture'])!;
      popsOf(sim, heart);
      const t = town(sim, heart.culture, heart.race, 1000, 1000, 400);
      if (road) for (let x = 700; x <= 1000; x += env.step / 2) {
        const k = Math.round((1000 - env.y0) / env.step) * env.w + Math.round((x - env.x0) / env.step);
        sim.way[k] = 3;
      }
      for (let i = 0; i < 6; i++) driftTick(dctx(sim));
      return coreDistanceOf(sim, env, t, tick.provAt) ?? 0;
    };
    expect(run(true)).toBeLessThan(run(false) * 0.8);
  });

  it('blends two cultures long sharing a province, each a good part of it, on good terms', () => {
    const sim = newSim(env, 3);
    const a = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 800, ['agriculture'])!;
    popsOf(sim, a);
    const other = { ...structuredClone(sim.cultures!.find((c) => c.id === a.culture)!), id: 'elvish', name: 'Elvish', language: 'Elvish' } as LiveCulture;
    sim.cultures!.push(other);
    const b = town(sim, 'elvish', a.race, 1500, 1000, 700);
    const human = a.culture;
    for (let t = 0; t < BLEND_TICKS; t++) driftTick(dctx(sim, 0.5));
    const hy = sim.cultures!.find((c) => c.blend);
    expect(hy).toBeDefined();
    expect(hy!.blend!.sort()).toEqual([human, 'elvish'].sort());
    expect(b.culture).toBe(hy!.id);
    expect(sim.events.some((e) => e.text.includes('have blended into one people'))).toBe(true);
    // Not between those who distrust each other.
    const sim2 = newSim(env, 4);
    const a2 = addDawnCity(sim2, env, lib, humanId(), 1500, 1000, 800, ['agriculture'])!;
    popsOf(sim2, a2);
    sim2.cultures!.push({ ...other });
    town(sim2, 'elvish', a2.race, 1500, 1000, 700);
    for (let t = 0; t < BLEND_TICKS + 2; t++) driftTick(dctx(sim2, 0.1));
    expect(sim2.cultures!.some((c) => c.blend)).toBe(false);
  });

  it('hardens a frontier people facing very different ones, who then fight harder; a safe heartland softens', () => {
    const sim = newSim(env, 5);
    const city = addDawnCity(sim, env, lib, humanId(), 700, 1000, 3000, ['agriculture'])!;
    popsOf(sim, city);
    const alien = { ...structuredClone(sim.cultures!.find((c) => c.id === city.culture)!), id: 'alien', name: 'Alien', language: 'Alien', ethos: 'Warlike', traditions: [], species: ['other'], races: ['other'], material: { building: 'x', dress: 'y', food: 'z' } } as LiveCulture;
    sim.cultures!.push(alien);
    const front = town(sim, city.culture, city.race, 2000, 1000, 600);
    town(sim, 'alien', 'other', 2050, 1000, 2000);
    const before = townFx(sim, front).fight;
    for (let t = 0; t < 5; t++) driftTick(dctx(sim));
    expect(front.cohesion ?? 0).toBeGreaterThan(0.3);
    expect(townFx(sim, front).fight).toBeGreaterThan(before);
    city.cohesion = 0.5;
    for (let t = 0; t < 3; t++) driftTick(dctx(sim));
    expect(city.cohesion ?? 0).toBeLessThan(0.5);
  });
});
