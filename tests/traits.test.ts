import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { buildEnv, landCell, type Env } from '../src/sim/env';
import { addDawnCity, newSim, settlementTier } from '../src/sim/sim';
import type { LiveCulture, SimState } from '../src/sim/state';
import { bundleOf, familyName, levelOf, similarity, traitInfo, traitsYear, treeNearness, type TraitsContext } from '../src/sim/traits';

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
const culture = (id: string, o: Partial<LiveCulture> = {}): LiveCulture => ({ id, name: id, source: '', species: ['s'], races: ['r'], language: id, sounds: '', ethos: 'Communal', martial: 'Men fight', lifestyles: [], traditions: [], specialties: [], behaviours: [], founded: 0, parent: '', ...o });
const tctx = (sim: SimState, law = ''): TraitsContext => ({ sim, env, lib, cellOf: (x, y) => landCell(env, x, y), knows: () => false, lawOfClan: () => law, isTown: (st) => settlementTier(st) !== 'Village' });
const trad = (id: string, level = 0) => ({ id, level, hold: '', progress: 0 });

describe('a culture as a bundle of traits (cultures as peoples, step 2)', () => {
  it('splits its traditions into core customs and regional ways, and reads its law and kinship', () => {
    const cu = culture('a', { traditions: [trad('seafaring'), trad('clan-loyalty', 1), trad('oral-tradition'), trad('miners')], behaviours: ['oral-law', 'written-law'] });
    const b = bundleOf(lib, cu);
    expect(b.ways.sort()).toEqual(['miners', 'seafaring']);
    expect(b.customs.sort()).toEqual(['clan-loyalty', 'oral-tradition']);
    expect(b.law).toBe('Written law');
    expect(b.kinship).toBe('Clan above all');
    // Speeds, fastest to slowest; core and regional.
    expect(traitInfo('material').years).toBeLessThan(traitInfo('customs').years);
    expect(traitInfo('religion').years).toBeGreaterThan(traitInfo('law').years);
    expect(traitInfo('material').core).toBe(false);
    expect(traitInfo('language').core).toBe(true);
  });

  it('takes its material culture, religion and law from how and where its people live', () => {
    const sim = newSim(env, 1);
    const k = [...env.land.keys()].find((q) => env.land[q] && env.coast[q] && env.mzone[q] === 0)!;
    const x = env.x0 + (k % env.w) * env.step;
    const y = env.y0 + Math.floor(k / env.w) * env.step;
    const city = addDawnCity(sim, env, lib, humanId(), x, y, 1200, ['agriculture', 'fishing'])!;
    city.economy!.jobs = { 'fish:fish': 400, 'farm:wheat': 100 };
    city.pops = [{ race: city.race, culture: city.culture, language: 'L', faith: 'sea-god', cls: 'commoner', n: 800 }, { race: city.race, culture: city.culture, language: 'L', faith: 'sky-god', cls: 'commoner', n: 400 }];
    traitsYear(tctx(sim, 'Lords’ justice'));
    const cu = sim.cultures!.find((c) => c.id === city.culture)!;
    expect(cu.material!.food).toBe('Fish');
    expect(cu.material!.building).not.toBe('');
    expect(cu.material!.dress).not.toBe('');
    expect(cu.faith).toBe('sea-god');
    expect(cu.law).toBe('Lords’ justice');
    // A people on the move lives in tents.
    const nomads = culture('nomads');
    sim.cultures!.push(nomads);
    sim.tribes.push({ ...JSON.parse(JSON.stringify(sim.tribes[0] ?? {})), id: 999, culture: 'nomads', x, y, pop: 300 } as never);
    traitsYear(tctx(sim));
    expect(nomads.material!.building).toBe('Tents of hide and felt');
  });

  it('places cultures in a tree and judges how alike they are by the tree and their traits', () => {
    const ways = { traditions: [trad('seafaring'), trad('clan-loyalty')], material: { building: 'Timber halls', dress: 'Wool and linen', food: 'Fish' }, faith: 'f' };
    const root = culture('root', ways);
    const sis = culture('sis', { ...ways, parent: 'root', sister: ['+traders'], traditions: [...ways.traditions, trad('traders')] });
    const grand = culture('grand', { ...ways, parent: 'sis' });
    const other = culture('other', { language: 'Elsewise', ethos: 'Warlike', traditions: [trad('herders'), trad('raiders')], material: { building: 'Tents of hide and felt', dress: 'Furs and hides', food: 'Game and wild plants' }, faith: 'g' });
    const all = [root, sis, grand, other];
    expect(levelOf(sis)).toBe('subculture');
    expect(levelOf(root)).toBe('culture');
    expect(familyName(all, grand)).toBe('the root family');
    expect(treeNearness(all, root, sis)).toBe(0.75);
    expect(treeNearness(all, root, grand)).toBe(0.4);
    expect(treeNearness(all, root, other)).toBe(0);
    expect(similarity(lib, all, root, root)).toBe(1);
    expect(similarity(lib, all, root, sis)).toBeGreaterThan(similarity(lib, all, root, grand) - 0.2);
    expect(similarity(lib, all, root, sis)).toBeGreaterThan(similarity(lib, all, root, other) + 0.3);
    expect(similarity(lib, all, root, other)).toBeLessThan(0.3);
  });
});
