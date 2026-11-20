import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { offshoot } from '../src/sim/cultureChange';
import { pressures } from '../src/sim/culturetick';
import { driftTick, type DriftContext } from '../src/sim/drift';
import { newEconomy } from '../src/sim/economy';
import { buildEnv, type Env } from '../src/sim/env';
import { provAt } from '../src/sim/land';
import { barrier, driftSounds, ensureLanguages, langName, languageOf, languagesTick, relatedness, soundsFor, speechOf, type LanguageContext } from '../src/sim/languages';
import { packSim, unpackSim } from '../src/sim/pack';
import { mainOf, popsOf } from '../src/sim/pops';
import { addDawnCity, newSim, settlementTier } from '../src/sim/sim';
import type { LiveCulture, Settlement, SimState } from '../src/sim/state';

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
let r = 0.37;
const rand = () => (r = (r * 9301 + 0.49297) % 1);
const dctx = (sim: SimState, accept = 0.5): DriftContext => ({
  sim, env, lib, ...tick,
  press: pressures({ sim, env, lib, ...tick, enforce: () => 0, log: () => {} }),
  make: (from, hint) => offshoot({ sim, lib, rand, dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by), log: () => {} }, from, hint),
  acceptance: () => accept,
  log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }),
});
const lctx = (sim: SimState): LanguageContext => ({ sim, env, provAt: tick.provAt, rand, log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }) });
const both = (sim: SimState, accept = 0.5) => {
  driftTick(dctx(sim, accept));
  languagesTick(lctx(sim));
  sim.day += 360 * 5;
};
function town(sim: SimState, culture: string, race: string, x: number, y: number, pop: number, name = `T${sim.nextId}`): Settlement {
  const st: Settlement = { id: sim.nextId++, name, kind: 'village', seat: true, clan: -5, species: '', race, culture, x, y, pop, fed: 1, warband: 20, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(pop, 1, 3), techs: [] };
  sim.settlements.push(st);
  popsOf(sim, st);
  return st;
}

describe('languages (cultures as peoples, step 5)', () => {
  it('knows the tongues spoken before languages were kept, and how near tongues are', () => {
    const sim = newSim(env, 1);
    const city = addDawnCity(sim, env, lib, humanId(), 700, 1000, 2000, ['agriculture'])!;
    popsOf(sim, city);
    ensureLanguages(sim);
    const cu = sim.cultures!.find((c) => c.id === city.culture)!;
    const base = languageOf(sim, cu.language)!;
    expect(base.name).toBe(cu.language);
    sim.languages!.push({ id: 'd', name: 'D', sounds: '', parent: base.id, kind: 'dialect', founded: 0 }, { id: 'e', name: 'E', sounds: '', parent: base.id, kind: 'dialect', founded: 0 }, { id: 'f', name: 'F', sounds: '', parent: 'd', kind: 'language', founded: 0 }, { id: 'x', name: 'X', sounds: '', parent: '', kind: 'language', founded: 0 });
    expect(relatedness(sim, base.id, base.id)).toBe(1);
    expect(relatedness(sim, base.id, 'd')).toBe(0.7);
    expect(relatedness(sim, 'd', 'e')).toBe(0.6);
    expect(relatedness(sim, 'e', 'f')).toBe(0.35);
    expect(relatedness(sim, base.id, 'x')).toBe(0);
    expect(barrier(sim, base.id, 'd')).toBeGreaterThan(barrier(sim, base.id, 'x'));
    const drifted = driftSounds('ka- ra- mo- -dor -an -is', rand, 0.5);
    expect(drifted).not.toBe('ka- ra- mo- -dor -an -is');
    expect(drifted.split(' ').some((p) => p.endsWith('-'))).toBe(true);
  });

  it('gives a drifting region a dialect, and a people grown apart a language of its own', () => {
    const sim = newSim(env, 2);
    const heart = addDawnCity(sim, env, lib, humanId(), 700, 1000, 3000, ['agriculture'])!;
    popsOf(sim, heart);
    const far = town(sim, heart.culture, heart.race, 2300, 1000, 600, 'Isish');
    const parent = sim.cultures!.find((c) => c.id === heart.culture)!;
    ensureLanguages(sim);
    const tongue = parent.language;
    for (let t = 0; t < 3; t++) both(sim);
    // A dialect first.
    const dia = languageOf(sim, mainOf(far.pops!, 'language'))!;
    expect(dia.kind).toBe('dialect');
    expect(dia.parent).toBe(tongue);
    expect(dia.name).toBe(`Isish ${langName(sim, tongue)}`);
    expect(speechOf(sim, far)).toMatch(/a dialect of/);
    expect(mainOf(heart.pops!, 'language')).toBe(tongue);
    expect(sim.events.some((e) => e.text.includes('have come to speak a dialect of their own'))).toBe(true);
    // Then a language, once the region is a people of its own.
    for (let t = 0; t < 14 && far.culture === parent.id; t++) both(sim);
    const nc = sim.cultures!.find((c) => c.id === far.culture)!;
    expect(nc.id).not.toBe(parent.id);
    const lang = languageOf(sim, nc.language)!;
    expect(lang.kind).toBe('language');
    expect(lang.name).toBe(nc.name);
    expect(lang.id).toBe(dia.id);
    expect(lang.parent).toBe(tongue);
    expect(mainOf(far.pops!, 'language')).toBe(lang.id);
    expect(soundsFor(sim, nc)).toBe(lang.sounds);
    expect(sim.events.some((e) => e.text.includes('has grown into a language of its own'))).toBe(true);
    // Kept with the save.
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.languages!.find((l) => l.id === lang.id)!.name).toBe(lang.name);
  });

  it('makes a creole for two peoples blended, and marks tongues no one speaks as ended', () => {
    const sim = newSim(env, 3);
    const a = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 800, ['agriculture'])!;
    popsOf(sim, a);
    const human = sim.cultures!.find((c) => c.id === a.culture)!;
    sim.cultures!.push({ ...structuredClone(human), id: 'elvish', name: 'Elvish', language: 'Elvish', sounds: 'el- ar- -wen -dil' } as LiveCulture);
    const b = town(sim, 'elvish', a.race, 1500, 1000, 700);
    const hTongue = human.language;
    for (let t = 0; t < 12 && !sim.cultures!.some((c) => c.blend); t++) both(sim, 0.5);
    const hy = sim.cultures!.find((c) => c.blend)!;
    expect(hy).toBeDefined();
    const cr = languageOf(sim, hy.language)!;
    expect(cr.parents!.sort()).toEqual([hTongue, 'Elvish'].sort());
    expect(cr.name).toBe(hy.name);
    expect(mainOf(b.pops!, 'language')).toBe(cr.id);
    // No one speaks Elvish now.
    both(sim, 0.5);
    expect(languageOf(sim, 'Elvish')!.ended).toBeDefined();
  });
});
