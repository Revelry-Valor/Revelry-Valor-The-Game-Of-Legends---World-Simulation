import { describe, expect, it } from 'vitest';
import { defaultLibrary, libraryFile, parseLibraryFile } from '../src/core/libstore';
import { raceMissing, statTotal } from '../src/core/library';

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
