import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { conformity, cultureTick, pressures, type TickContext } from '../src/sim/culturetick';
import { newEconomy } from '../src/sim/economy';
import { buildEnv, type Env } from '../src/sim/env';
import { provAt } from '../src/sim/land';
import { materialOf, popsOf, sharesOf, total } from '../src/sim/pops';
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
const tctx = (sim: SimState, enforce = 0): TickContext => ({
  sim, env, lib,
  provAt: (x, y) => provAt(env, x, y),
  tier: (st) => settlementTier(st),
  enforce: () => enforce,
  capital: (st) => st.kind === 'dawn',
  log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }),
});
/** A town of another culture (the Celts) near a point, with its own tongue. */
function celts(sim: SimState, near: Settlement, dx: number, pop: number, clan = -99): Settlement {
  const base = sim.cultures!.find((c) => c.id === near.culture)!;
  if (!sim.cultures!.some((c) => c.id === 'celtic')) sim.cultures!.push({ ...structuredClone(base), id: 'celtic', name: 'Celtic', language: 'Celtic', ethos: 'Warlike', traditions: [], parent: '' } as LiveCulture);
  const st: Settlement = { id: sim.nextId++, name: 'Alesia', kind: 'village', seat: true, clan, species: near.species, race: near.race, culture: 'celtic', x: near.x + dx, y: near.y, pop, fed: 1, warband: 20, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(pop, 1, 3), techs: [] };
  sim.settlements.push(st);
  popsOf(sim, st, { elite: 0.05, middle: 0.15, commoner: 0.8 });
  return st;
}
const shareOf = (st: Settlement, key: 'culture' | 'language', v: string) => sharesOf(st.pops!, key).find(([k]) => k === v)?.[1] ?? 0;
const materialShare = (st: Settlement, v: string) => st.pops!.filter((q) => materialOf(q) === v).reduce((n, q) => n + q.n, 0) / total(st.pops!);

describe('the culture tick (cultures as peoples, step 3)', () => {
  it('spreads slowly while a way is rare, quickly past a fifth or so, and sweeps on once most hold it', () => {
    expect(conformity(0)).toBeLessThan(0.15);
    expect(conformity(0.3)).toBeGreaterThan(conformity(0.1) * 3);
    expect(conformity(0.6)).toBeGreaterThan(conformity(0.45));
  });

  it('sends a settlement’s influence out by its prestige, fading with distance', () => {
    const sim = newSim(env, 1);
    const rome = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 5000, ['agriculture'])!;
    popsOf(sim, rome);
    const pr = pressures(tctx(sim));
    const at = (dx: number) => pr.get(provAt(env, 1500 + dx, 1000))?.culture.get(rome.culture) ?? 0;
    expect(at(0)).toBeGreaterThan(at(60));
    expect(at(60)).toBeGreaterThan(at(150));
    expect(at(150)).toBeGreaterThanOrEqual(0);
  });

  it('wins a conquered town over a slice at a time: goods and houses first, then its ways, its tongue last; elites first', () => {
    const sim = newSim(env, 2);
    const rome = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 6000, ['agriculture'])!;
    popsOf(sim, rome, { elite: 0.05, middle: 0.2, commoner: 0.75 });
    const town = celts(sim, rome, 40, 900, rome.clan);
    town.control = 1;
    const roman = rome.culture;
    const romanTongue = sim.cultures!.find((c) => c.id === roman)!.language || sim.cultures!.find((c) => c.id === roman)!.name;
    // Twenty years under Rome.
    for (let t = 0; t < 4; t++) cultureTick(tctx(sim, 1));
    const mat = materialShare(town, roman);
    const cul = shareOf(town, 'culture', roman);
    const lang = shareOf(town, 'language', romanTongue);
    expect(mat).toBeGreaterThan(0.1);
    expect(mat).toBeGreaterThan(cul);
    expect(cul).toBeGreaterThan(lang);
    // The elites take to it before the commoners.
    const of = (cls: string) => {
      const g = town.pops!.filter((q) => q.cls === cls);
      return g.filter((q) => q.culture === roman).reduce((n, q) => n + q.n, 0) / total(g);
    };
    expect(of('elite')).toBeGreaterThan(of('commoner'));
    // Generations on, it counts itself Roman; many still speak Celtic.
    let ticks = 4;
    for (; ticks < 60 && town.culture !== roman; ticks++) cultureTick(tctx(sim, 1));
    expect(town.culture).toBe(roman);
    // Not overnight: some generations.
    expect(ticks * 5).toBeGreaterThan(40);
    expect(sim.events.some((e) => e.text.includes(`Most of the people of ${town.name} now count themselves`))).toBe(true);
    expect(shareOf(town, 'language', 'Celtic')).toBeGreaterThan(0.1);
  });

  it('draws a small settlement into the culture of the big one beside it, with no realm pressing', () => {
    const sim = newSim(env, 3);
    const big = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 6000, ['agriculture'])!;
    popsOf(sim, big);
    const small = celts(sim, big, 30, 150);
    small.seat = false;
    for (let t = 0; t < 60 && small.culture !== big.culture; t++) cultureTick(tctx(sim));
    expect(small.culture).toBe(big.culture);
    // The big one hardly moves.
    expect(shareOf(big, 'culture', 'celtic')).toBeLessThan(0.05);
  });

  it('brings similar peoples together faster than unlike ones', () => {
    const run = (alike: boolean) => {
      const sim = newSim(env, 4);
      const big = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 6000, ['agriculture'])!;
      popsOf(sim, big);
      const small = celts(sim, big, 40, 400);
      const cu = sim.cultures!.find((c) => c.id === 'celtic')!;
      const rc = sim.cultures!.find((c) => c.id === big.culture)!;
      if (alike) Object.assign(cu, { parent: rc.id, ethos: rc.ethos, traditions: structuredClone(rc.traditions), material: rc.material });
      else Object.assign(cu, { species: ['other'], races: ['other'] });
      for (let t = 0; t < 6; t++) cultureTick(tctx(sim));
      return shareOf(small, 'culture', big.culture);
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.2);
  });
});
