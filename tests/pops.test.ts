import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { buildEnv, type Env } from '../src/sim/env';
import { provAt } from '../src/sim/land';
import { packSim, unpackSim } from '../src/sim/pack';
import { classShares, classYear, countryOf, countryYear, COUNTRY_MIX, mainOf, movePeople, popsOf, sharesOf, takePops, tidy, total, type Pop } from '../src/sim/pops';
import { addDawnCity, newSim, settlementTier, stepDays } from '../src/sim/sim';
import type { SimState } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });
const riverPts: number[] = [];
for (let x = 700; x <= 2350; x += 25) riverPts.push(x, 1000 + 15 * Math.sin(x / 150));
add('river', riverPts, { width: 2 });

let env: Env;
let lib: Library;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
  lib = defaultLibrary();
  const human = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!;
  human.lifespan = 70;
  human.fightingAge ??= 16;
}, 60000);
const humanId = () => lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!.id;
const pop = (o: Partial<Pop>): Pop => ({ race: 'h', culture: 'a', language: 'A', faith: '', cls: 'commoner', n: 100, ...o });
const holder = (pops: Pop[], o: { culture?: string; faith?: string } = {}) => ({ race: 'h', culture: o.culture ?? 'a', faith: o.faith ?? '', pop: total(pops), pops });
const bare = () => newSim(env, 1) as SimState;

describe('pops (cultures as peoples, step 1)', () => {
  it('keeps a place’s pops in line with its count: growth by size, losses mostly from commoners', () => {
    const sim = bare();
    const h = holder([pop({ n: 600 }), pop({ culture: 'b', language: 'B', n: 300 }), pop({ cls: 'elite', n: 100 })]);
    h.pop = 2000;
    popsOf(sim, h);
    expect(total(h.pops)).toBeCloseTo(2000, 3);
    expect(sharesOf(h.pops, 'culture')[1][1]).toBeCloseTo(0.3, 3);
    h.pop = 1000;
    popsOf(sim, h);
    expect(total(h.pops)).toBeCloseTo(1000, 3);
    // The elites lost less than their share.
    const elite = h.pops.find((q) => q.cls === 'elite')!.n;
    expect(elite / 1000).toBeGreaterThan(0.1);
  });

  it('gives the place’s main people a culture or faith given to the place as a whole, and keeps the rest', () => {
    const sim = bare();
    const h = holder([pop({ n: 700 }), pop({ culture: 'b', language: 'B', n: 300 })]);
    h.culture = 'r';
    popsOf(sim, h);
    expect(sharesOf(h.pops, 'culture').map(([c]) => c)).toEqual(['r', 'b']);
    // Their tongue is theirs still.
    expect(h.pops.find((q) => q.culture === 'r')!.language).toBe('A');
  });

  it('moves real people between places, slices of each pop (elites seldom), and folds the tiny into the most alike', () => {
    const sim = bare();
    const a = holder([pop({ n: 800 }), pop({ culture: 'b', language: 'B', n: 200 }), pop({ cls: 'elite', n: 50 })]);
    const b = holder([pop({ culture: 'c', language: 'C', n: 500 })], { culture: 'c' });
    movePeople(sim, a, b, 300);
    expect(a.pop + b.pop).toBeCloseTo(1550, 3);
    expect(total(a.pops!)).toBeCloseTo(a.pop, 3);
    expect(total(b.pops!)).toBeCloseTo(b.pop, 3);
    expect(b.pops!.some((q) => q.culture === 'b')).toBe(true);
    expect(a.pops!.find((q) => q.cls === 'elite')!.n).toBeGreaterThan(45);
    const t = tidy([pop({ n: 994.6 }), pop({ cls: 'middle', n: 5 }), pop({ culture: 'z', n: 0.4 })]);
    // The stray of another culture joins the commoners; the few middle-class are kept as such.
    expect(t.map((q) => q.cls).sort()).toEqual(['commoner', 'middle']);
    expect(total(t)).toBeCloseTo(1000, 5);
    expect(takePops(sim, holder([]), 50)).toEqual([]);
  });

  it('moves a town’s classes toward what its life calls for: elites by size, the middle by its hands off the food jobs', () => {
    const sim = newSim(env, 2);
    const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 3000, ['agriculture'])!;
    city.economy!.jobs = { 'farm:grain': 1000, stone: 400, copper: 200 };
    const want = classShares(city, settlementTier(city));
    expect(want.elite).toBeGreaterThan(0.04);
    expect(want.middle).toBeGreaterThan(0.25);
    for (let y = 0; y < 40; y++) classYear(sim, city, settlementTier(city));
    const sh = Object.fromEntries(sharesOf(city.pops!, 'cls'));
    expect(sh.elite).toBeCloseTo(want.elite, 2);
    expect(sh.middle).toBeCloseTo(want.middle, 2);
  });

  it('keeps the wild folk by province, in line with the families living there, mixing a little with their neighbours', () => {
    const sim = newSim(env, 3);
    const P = env.prov;
    const p = provAt(env, 1500, 1000);
    const q = P.nb[P.nbStart[p]];
    sim.density = { h: new Float32Array(env.n) };
    sim.density.h[P.cells[P.start[p]]] = 1000;
    sim.density.h[P.cells[P.start[q]]] = 1000;
    countryOf(sim, env, p).push(pop({ n: 1000 }));
    countryOf(sim, env, q).push(pop({ culture: 'b', language: 'B', n: 1000 }));
    countryYear(sim, env, () => null);
    const here = countryOf(sim, env, p);
    expect(total(here)).toBeCloseTo(1000, 1);
    const b = here.find((x) => x.culture === 'b')?.n ?? 0;
    expect(b / 1000).toBeGreaterThan(COUNTRY_MIX * 0.5);
    expect(b / 1000).toBeLessThan(COUNTRY_MIX * 2);
    expect(mainOf(here, 'culture')).toBe('a');
  });

  it('runs with the world: every place’s pops add up, the wild folk are who left the towns, and they keep with the save', () => {
    const sim = newSim(env, 1);
    const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 1200)!;
    stepDays(sim, env, lib, 360 * 15);
    for (const st of sim.settlements.filter((s) => !s.ruined)) expect(total(popsOf(sim, st))).toBeCloseTo(st.pop, 0);
    for (const t of sim.tribes) expect(total(popsOf(sim, t))).toBeCloseTo(t.pop, 0);
    // The families in the wild are of the city's culture.
    const wild = Object.values(sim.country ?? {}).flat();
    expect(total(wild)).toBeGreaterThan(10);
    expect(mainOf(wild, 'culture')).toBe(city.culture);
    // Each province's wild folk match the families living there.
    const dens = Object.values(sim.density ?? {})[0];
    let densAll = 0;
    for (let k = 0; k < env.n; k++) if (env.prov.of[k] >= 0 && dens[k] > 0) densAll += dens[k];
    expect(total(wild) / densAll).toBeGreaterThan(0.8);
    expect(total(wild) / densAll).toBeLessThan(1.25);
    // The city has classes now.
    expect(sharesOf(city.pops!, 'cls').some(([c]) => c === 'elite')).toBe(true);
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(Object.keys(back.country ?? {}).length).toBe(Object.keys(sim.country ?? {}).length);
    expect(back.settlements.find((s) => s.id === city.id)!.pops!.length).toBe(city.pops!.length);
  });
});
