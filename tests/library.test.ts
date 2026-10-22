import { describe, expect, it } from 'vitest';
import { defaultLibrary, libraryFile, parseLibraryFile, upgradeLibrary } from '../src/core/libstore';
import { raceMissing, statTotal, techTiers } from '../src/core/library';

describe('the library', () => {
  const lib = defaultLibrary();
  it('loads the author’s roster: every species and race, with the sheet’s stats', () => {
    expect(lib.species.length).toBe(44);
    expect(lib.species.reduce((n, s) => n + s.races.length, 0)).toBe(65);
    const human = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!;
    expect(statTotal(human.stats)).toBe(149);
    expect(human.fightingAge).toBe(18);
    expect(human.specialty).toBe('Audacity of Man');
  });
  it('leaves missing values blank, and says what each race still needs', () => {
    const owls = lib.species.find((s) => s.name === 'Bird-folk')!.races.find((r) => r.name === 'Owls')!;
    expect(statTotal(owls.stats)).toBeNull();
    expect(raceMissing(owls)).toContain('all stats');
    const taluty = lib.species.find((s) => s.name === 'Taluty')!.races[0];
    expect(taluty.size).toBeNull();
    expect(taluty.stats.health).toBe(5);
    expect(raceMissing(taluty)).toContain('size');
  });
  it('starts with traits, resources and beasts, and survives a file round trip', () => {
    expect(lib.traits.length).toBeGreaterThan(15);
    expect(lib.resources.length).toBeGreaterThan(40);
    expect(lib.beasts.length).toBeGreaterThan(25);
    for (const b of lib.beasts) for (const r of b.resources) expect(lib.resources.some((x) => x.id === r)).toBe(true);
    for (const s of lib.species) for (const t of s.traits) expect(lib.traits.some((x) => x.id === t)).toBe(true);
    expect(parseLibraryFile(libraryFile(lib))).toEqual(lib);
  });
});

describe('technology and culture in the library', () => {
  const lib = defaultLibrary();
  const has = <T extends { id: string }>(list: T[], id: string) => list.some((x) => x.id === id);
  it('the tech tree only refers to things that exist, with no loops, up to steam and mana tech', () => {
    for (const t of lib.techs) {
      for (const r of t.requires) expect(has(lib.techs, r)).toBe(true);
      for (const r of t.resources) expect(has(lib.resources, r)).toBe(true);
    }
    const tiers = techTiers(lib.techs);
    for (const t of lib.techs) for (const r of t.requires) expect(tiers.get(t.id)!).toBeGreaterThan(tiers.get(r)!);
    expect(lib.techs.some((t) => t.field === 'Steam' && t.name.includes('train'))).toBe(true);
    expect(lib.techs.some((t) => t.field === 'Mana tech')).toBe(true);
    expect(lib.techs.some((t) => t.id === 'gunpowder')).toBe(true);
    expect(lib.techs.filter((t) => t.start).length).toBeGreaterThan(5);
  });
  it('behaviours and traditions refer to real technologies, behaviours and beasts', () => {
    for (const b of lib.behaviours) {
      for (const r of b.requires) expect(has(lib.behaviours, r)).toBe(true);
      for (const r of [...b.needsTech, ...b.pushesTech]) expect(has(lib.techs, r)).toBe(true);
    }
    for (const t of lib.traditions) {
      expect(t.levels.length).toBeGreaterThan(0);
      for (const b of t.beasts) expect(has(lib.beasts, b)).toBe(true);
    }
    expect(lib.cultures).toEqual([]);
  });
  it('an older library gets the new lists, keeping what it had', () => {
    const old = { format: 1, traits: [], resources: [], species: lib.species.slice(0, 2), beasts: [] };
    const up = upgradeLibrary(old);
    expect(up.species.length).toBe(2);
    expect(up.traits).toEqual([]);
    expect(up.techs.length).toBe(lib.techs.length);
    expect(up.traditions.length).toBe(lib.traditions.length);
  });
});

describe('governments and religion in the library', () => {
  const lib = defaultLibrary();
  it('has the built-in government types, each built from parts and needing real behaviours', () => {
    const names = lib.governments.map((g) => g.name);
    for (const n of ['Clan', 'Horde', 'Chiefdom', 'Petty kingdom', 'City-state', 'Theocracy', 'Magocracy', 'Feudal kingdom', 'Empire', 'Republic', 'Merchant republic', 'Elective monarchy', 'Gerontocracy']) expect(names).toContain(n);
    for (const g of lib.governments) {
      expect(g.builtIn).toBe(true);
      expect(g.head && g.land && g.succession && g.legitimacy && g.law).toBeTruthy();
      for (const b of g.needs) expect(lib.behaviours.some((x) => x.id === b)).toBe(true);
    }
  });
  it('starts with tenets, and no faiths or gods (those are the author’s)', () => {
    expect(lib.tenets.length).toBeGreaterThan(15);
    for (const t of lib.tenets) expect(t.levels.length).toBeGreaterThan(0);
    expect(lib.faiths).toEqual([]);
    expect(lib.gods).toEqual([]);
  });
  it('links a culture’s government named before the creator existed', () => {
    const up = upgradeLibrary({ ...lib, cultures: [{ id: 'c', name: 'C', government: 'Feudal kingdom' }] });
    expect(up.cultures[0].government).toBe('feudal-kingdom');
  });
});
