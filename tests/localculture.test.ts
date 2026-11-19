import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { cultureYear, localText, localYear, pushes, townFx, traditionsHere, type CultureContext } from '../src/sim/culture';
import { attraction } from '../src/sim/attraction';
import { raceInfo, wantsOf } from '../src/sim/sim';
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

  describe('step 2', () => {
    it('lets a conquered town keep its old culture’s ways for a while as it becomes the new one', () => {
      const sim = newSim(env, 3);
      const inlandK = [...env.land.keys()].find((k) => env.land[k] && !env.coast[k] && !env.fresh[k] && env.mzone[k] === 0)!;
      const rome = addDawnCity(sim, env, lib, humanId(), at(inlandK).x, at(inlandK).y, 1500, ['agriculture'])!;
      rome.economy!.jobs = { 'farm:grain': 300 };
      const romans = sim.cultures!.find((c) => c.id === rome.culture)!;
      romans.traditions = romans.traditions.filter((t) => t.id !== 'clan-loyalty' && t.id !== 'oral-tradition');
      const celtic = { ...sim.cultures!.find((c) => c.id === rome.culture)!, id: 'celtic', name: 'Celtic', traditions: [{ id: 'clan-loyalty', level: 1, hold: '', progress: 0 }, { id: 'oral-tradition', level: 0, hold: '', progress: 0 }] };
      sim.cultures!.push(celtic);
      const taken = town(sim, rome, inlandK + 5, { 'farm:grain': 300 });
      taken.culture = 'celtic';
      sim.day += 360;
      localYear(ctx(sim));
      // Rome's rulers win it over.
      taken.culture = rome.culture;
      sim.day += 360;
      localYear(ctx(sim));
      expect(traditionsHere(sim, taken).map((t) => t.id)).toEqual(expect.arrayContaining(['clan-loyalty', 'oral-tradition']));
      expect(localText(sim, lib, taken)).toMatch(/Celtic ways: \+ Clan loyalty/);
      expect(sim.events.some((e) => e.text.includes(`${taken.name} keeps its old Celtic ways`))).toBe(true);
      // Generations on, ways its life no longer calls for fade: it is Roman now.
      for (let y = 0; y < 90; y++) {
        sim.day += 360;
        localYear(ctx(sim));
      }
      expect(traditionsHere(sim, taken).some((t) => t.id === 'clan-loyalty' || t.id === 'oral-tradition')).toBe(false);
      expect(sim.events.some((e) => /old Celtic .* has faded/.test(e.text))).toBe(true);
    });

    it('makes a way most of its towns live by the culture’s own, and lets its ways draw its people', () => {
      const sim = newSim(env, 4);
      const coasts = [...env.coast.keys()].filter((k) => env.coast[k] && env.land[k] && env.mzone[k] === 0);
      const first = coasts[0];
      const city = addDawnCity(sim, env, lib, humanId(), at(first).x, at(first).y, 1500, ['agriculture', 'fishing'])!;
      city.economy!.jobs = { 'fish:fish': 300 };
      const cult = sim.cultures!.find((c) => c.id === city.culture)!;
      cult.traditions = cult.traditions.filter((t) => t.id !== 'seafaring');
      const others = [coasts[Math.floor(coasts.length / 3)], coasts[Math.floor((2 * coasts.length) / 3)], coasts[coasts.length - 1]].map((k) => town(sim, city, k, { 'fish:fish': 300 }));
      for (let y = 0; y < 60; y++) {
        sim.day += 360;
        localYear(ctx(sim));
      }
      expect(cult.traditions.some((t) => t.id === 'seafaring' && t.level >= 0)).toBe(true);
      expect(sim.events.some((e) => /as a whole have taken to Seafaring/.test(e.text))).toBe(true);
      // No longer a change of their own: it is the culture's.
      for (const st of [city, ...others]) expect((st.local ?? []).some((q) => q.id === 'seafaring')).toBe(false);
      // Its people are drawn to the coast more than before.
      const ri = raceInfo(lib, humanId(), cult.id, sim.cultures!)!;
      const plain = raceInfo(lib, humanId())!;
      const k = coasts.find((q) => attraction(env, wantsOf(env, plain), q).score > 0)!;
      expect(attraction(env, wantsOf(env, ri), k).prefer).toBeGreaterThan(attraction(env, wantsOf(env, plain), k).prefer);
    });

    it('keeps what a race always has in every culture of it', () => {
      const sim = newSim(env, 5);
      const human = lib.species.find((s) => s.name === 'Human')!.races[0];
      human.living.always = ['martial'];
      const k = [...env.land.keys()].find((q) => env.land[q] && env.mzone[q] === 0)!;
      const city = addDawnCity(sim, env, lib, human.id, at(k).x, at(k).y, 800, ['agriculture'])!;
      sim.day += 360;
      cultureYear(ctx(sim));
      const entry = sim.cultures!.find((c) => c.id === city.culture)!.traditions.find((t) => t.id === 'martial')!;
      expect(entry.hold).toBe('Locked');
      expect(entry.level).toBeGreaterThanOrEqual(0);
      expect(townFx(sim, city).fight).toBeGreaterThan(1);
      human.living.always = [];
    });
  });
});
