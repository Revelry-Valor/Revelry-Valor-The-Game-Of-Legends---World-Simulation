import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { localText, localYear, pushes, townFx, traditionsHere, type CultureContext } from '../src/sim/culture';
import { newEconomy } from '../src/sim/economy';
import { buildEnv, type Env } from '../src/sim/env';
import { addDawnCity, newSim } from '../src/sim/sim';
import type { Settlement, SimState } from '../src/sim/state';

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

const at = (k: number) => ({ x: env.x0 + (k % env.w) * env.step, y: env.y0 + Math.floor(k / env.w) * env.step });
const ctx = (sim: SimState): CultureContext => ({ sim, env, lib, rand: () => 0.5, dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by), log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }) });
const humanId = () => lib.species.find((s) => s.name === 'Human')!.races[0].id;
/** A town of the city's culture at a point, living by the given jobs. */
const town = (sim: SimState, city: Settlement, k: number, jobs: Record<string, number>): Settlement => {
  const p = at(k);
  const st: Settlement = { id: sim.nextId++, name: `T${sim.nextId}`, kind: 'village', clan: city.clan, species: city.species, race: city.race, culture: city.culture, x: p.x, y: p.y, pop: 800, fed: 1, warband: 50, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: { ...newEconomy(800, 1, 3), jobs }, techs: [] };
  sim.settlements.push(st);
  return st;
};

describe('regional versions of a culture (step 1)', () => {
  it('lets a coastal fishing town take up seafaring ways while an inland farming town of the same culture does not', () => {
    const sim = newSim(env, 1);
    const inlandK = [...env.land.keys()].find((k) => env.land[k] && !env.coast[k] && !env.fresh[k] && env.mzone[k] === 0)!;
    const coastK = [...env.coast.keys()].find((k) => env.coast[k] && env.land[k] && env.mzone[k] === 0)!;
    const city = addDawnCity(sim, env, lib, humanId(), at(inlandK).x, at(inlandK).y, 1500, ['agriculture', 'fishing'])!;
    city.economy!.jobs = { 'farm:grain': 300 };
    const port = town(sim, city, coastK, { 'fish:fish': 300, 'farm:grain': 20 });
    const farm = town(sim, city, inlandK + 3, { 'farm:grain': 300 });
    for (let y = 0; y < 60; y++) {
      sim.day += 360;
      localYear(ctx(sim));
    }
    // Still the same culture; the port its own version of it.
    expect(port.culture).toBe(city.culture);
    expect(traditionsHere(sim, port).some((t) => t.id === 'seafaring')).toBe(true);
    expect(traditionsHere(sim, farm).some((t) => t.id === 'seafaring')).toBe(false);
    expect(localText(sim, lib, port)).toMatch(/\+ Seafaring/);
    expect(sim.events.some((e) => e.text.includes(`${port.name} has taken to Seafaring`))).toBe(true);
    // What it does: more from fishing, faster ships, and a lean toward sailing.
    expect(townFx(sim, port).fish).toBeGreaterThan(townFx(sim, farm).fish);
    expect(townFx(sim, port).sail).toBeGreaterThan(1);
    expect(pushes(sim, lib, port.culture, 'sailing', port.id)).toBe(true);
    expect(pushes(sim, lib, farm.culture, 'sailing', farm.id)).toBe(false);
    // A joined village lives by its town's version.
    const v = town(sim, city, coastK + 1, {});
    v.partOf = port.id;
    expect(traditionsHere(sim, v).some((t) => t.id === 'seafaring')).toBe(true);
  });

  it('lets an inland town drop a tradition of the land its land is wrong for, and a town fought over become warlike', () => {
    const sim = newSim(env, 2);
    const inlandK = [...env.land.keys()].find((k) => env.land[k] && !env.coast[k] && !env.fresh[k] && env.mzone[k] === 0)!;
    const city = addDawnCity(sim, env, lib, humanId(), at(inlandK).x, at(inlandK).y, 1500, ['agriculture'])!;
    // The culture is a seafaring one; this town lives far from the sea.
    sim.cultures!.find((c) => c.id === city.culture)!.traditions.push({ id: 'seafaring', level: 0, hold: '', progress: 0 });
    city.economy!.jobs = { 'farm:grain': 300 };
    const frontier = town(sim, city, inlandK + 4, { 'farm:grain': 300 });
    for (let y = 0; y < 60; y++) {
      sim.day += 360;
      frontier.hardship = { famine: 0, war: 4 };
      localYear(ctx(sim));
    }
    expect(traditionsHere(sim, city).some((t) => t.id === 'seafaring')).toBe(false);
    expect(localText(sim, lib, city)).toMatch(/− Seafaring/);
    expect(traditionsHere(sim, frontier).some((t) => t.id === 'martial')).toBe(true);
    expect(townFx(sim, frontier).fight).toBeGreaterThan(townFx(sim, city).fight);
    // Never more than a few changes a town.
    for (const st of sim.settlements) expect((st.local ?? []).filter((q) => q.level >= 0).length).toBeLessThanOrEqual(3);
  });
});
