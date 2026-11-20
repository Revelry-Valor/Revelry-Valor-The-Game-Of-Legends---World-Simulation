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
import { languagesTick, type LanguageContext } from '../src/sim/languages';
import { packSim, unpackSim } from '../src/sim/pack';
import { historyTick, MAX_SNAPS, snapshotAt } from '../src/sim/history';
import { popsOf } from '../src/sim/pops';
import { addDawnCity, newSim, settlementTier } from '../src/sim/sim';
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
  historyTick(sim, env, tick.provAt);
  sim.day += 360 * 5;
};
function town(sim: SimState, culture: string, race: string, x: number, y: number, pop: number, name = `T${sim.nextId}`): Settlement {
  const st: Settlement = { id: sim.nextId++, name, kind: 'village', seat: true, clan: -5, species: '', race, culture, x, y, pop, fed: 1, warband: 20, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(pop, 1, 3), techs: [] };
  sim.settlements.push(st);
  popsOf(sim, st);
  return st;
}

describe('the history of peoples (cultures as peoples, step 7)', () => {
  it('keeps snapshots of every culture, tongue and race, and reads splits, dialects grown into languages and endings from them', () => {
    const sim = newSim(env, 2);
    const heart = addDawnCity(sim, env, lib, humanId(), 700, 1000, 3000, ['agriculture'])!;
    popsOf(sim, heart);
    const far = town(sim, heart.culture, heart.race, 2300, 1000, 600, 'Isish');
    const parent = heart.culture;
    for (let t = 0; t < 18 && far.culture === parent; t++) both(sim);
    both(sim);
    const h = sim.history!;
    expect(h.snaps.length).toBeGreaterThan(5);
    const last = h.snaps[h.snaps.length - 1];
    expect(last.cultures[parent]).toBeGreaterThan(0);
    expect(last.races[heart.race]).toBeGreaterThan(0);
    expect(Object.values(last.provs)).toContain(far.culture);
    const ev = (track: string, kind: string, id?: string) => h.events.find((e) => e.track === track && e.kind === kind && (!id || e.id === id));
    expect(ev('culture', 'appeared', parent)!.text).toMatch(/at the start/);
    expect(ev('culture', 'split', far.culture)!.other).toBe(parent);
    expect(ev('language', 'split')).toBeDefined();
    expect(ev('language', 'promoted')).toBeDefined();
    expect(ev('race', 'appeared', heart.race)).toBeDefined();
    // The far people are taken in by the heartland's: absorbed.
    const nc = far.culture;
    far.pops = far.pops!.map((q) => ({ ...q, culture: parent }));
    far.culture = parent;
    for (const k of Object.keys(sim.country ?? {})) sim.country![k] = sim.country![k].map((q) => (q.culture === nc ? { ...q, culture: parent } : q));
    both(sim);
    expect(ev('culture', 'absorbed', nc)!.other).toBe(parent);
    expect(sim.cultures!.find((c) => c.id === nc)!.ended).toBeDefined();
    // A change of faith, without a split.
    const cu = sim.cultures!.find((c) => c.id === parent)!;
    cu.faith = 'old';
    both(sim);
    cu.faith = 'new';
    both(sim);
    expect(ev('culture', 'religion', parent)).toBeDefined();
    // The map at a moment.
    expect(snapshotAt(sim, h.snaps[2].day + 100)!.day).toBe(h.snaps[2].day);
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.history!.events.length).toBe(h.events.length);
  });

  it('thins old snapshots so a long history stays small, keeping the recent ones', () => {
    const sim = newSim(env, 3);
    const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 1000, ['agriculture'])!;
    popsOf(sim, city);
    for (let t = 0; t < MAX_SNAPS + 20; t++) {
      historyTick(sim, env, tick.provAt);
      sim.day += 360 * 5;
    }
    const s = sim.history!.snaps;
    expect(s.length).toBeLessThanOrEqual(MAX_SNAPS);
    expect(s[s.length - 1].day - s[s.length - 2].day).toBe(360 * 5);
    expect(s[1].day - s[0].day).toBeGreaterThan(360 * 5);
  });
});
