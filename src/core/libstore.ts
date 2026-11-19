import { cloneLibrary, emptyLiving, emptyProfile, emptyStats, LIBRARY_FORMAT, readLibrary, STAT_KEYS, type Library, type RaceLiving, type Size, type Species } from './library';
import { ROSTER } from '../data/roster';
import { START_BEASTS, START_RESOURCES, START_TRAITS } from '../data/startlists';
import { START_TECHS } from '../data/techs';
import { START_BEHAVIOURS, START_TRADITIONS } from '../data/culture';
import { START_GOVERNMENTS, START_TENETS } from '../data/rule';
import type { KeyValueStore } from './storage';

/** The starting library: the author's roster of peoples and the starting traits, resources and beasts. */
export function defaultLibrary(): Library {
  const taken = new Set<string>();
  const idOf = (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'species';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  };
  const species: Species[] = ROSTER.map((sp) => {
    const id = idOf(sp.name);
    return {
      id,
      name: sp.name,
      kind: sp.kind,
      setAside: sp.setAside,
      traits: sp.traits.slice(),
      notes: sp.notes,
      profile: { ...emptyProfile(), movement: sp.movement.slice() },
      social: '',
      lifestyle: '',
      temperament: '',
      building: [],
      troops: '',
      races: sp.races.map((r, i) => {
        const stats = emptyStats();
        STAT_KEYS.forEach((k, j) => (stats[k] = r.stats[j]));
        return { id: `${id}.${i + 1}`, name: r.name, size: r.size as Size | null, stats, fightingAge: r.fightingAge, lifespan: r.lifespan, affinity: r.affinity, affinity2: r.affinity2, specialty: r.specialty, notes: r.notes, addTraits: [], removeTraits: [], lifestyle: '', climates: [], living: emptyLiving() };
      }),
    };
  });
  return cultureAdditions(livingDefaults(cloneLibrary({ format: LIBRARY_FORMAT, traits: START_TRAITS, resources: START_RESOURCES, species, beasts: START_BEASTS, techs: START_TECHS, behaviours: START_BEHAVIOURS, traditions: START_TRADITIONS, cultures: [], governments: START_GOVERNMENTS, tenets: START_TENETS, faiths: [], gods: [] })));
}

type Tol = Partial<Pick<RaceLiving, 'heat' | 'cold' | 'wet' | 'dry' | 'altitude'>>;
/**
 * Where the roster's peoples live (REDESIGN.md, "Where peoples live", step 2), filled in once:
 * the Adaptable trait (Humans have it), and tolerances and water needs only where the people
 * plainly calls for them (the rest stay unset: the middle, 3). Only values still unset are
 * filled, and never again once the author has had the library (so their changes stand).
 */
function livingDefaults(lib: Library): Library {
  const done = new Set(lib.applied ?? []);
  if (done.has('living-1')) return lib;
  if (!lib.traits.some((t) => t.id === 'adaptable')) lib.traits.push({ id: 'adaptable', name: 'Adaptable', description: 'Takes to new lands quickly: over generations its people come to bear climates past what their kind once could.', for: ['sentient'], effects: [] });
  const sp = (name: string) => lib.species.find((s) => s.name === name);
  const species = (name: string, t: Tol) => {
    const s = sp(name);
    if (!s) return;
    for (const [k, v] of Object.entries(t) as [keyof Tol, number][]) if (s.profile[k] === null) s.profile[k] = v;
  };
  const races = (name: string, o: { race?: string; t?: Tol; water?: string; covers?: string[] }) => {
    for (const r of sp(name)?.races ?? []) {
      if (o.race && r.name !== o.race) continue;
      for (const [k, v] of Object.entries(o.t ?? {}) as [keyof Tol, number][]) if (r.living[k] === null) r.living[k] = v;
      if (o.water && !r.living.water) r.living.water = o.water;
      if (o.covers && !r.living.covers.length) r.living.covers = o.covers.slice();
    }
  };
  const human = sp('Human');
  if (human && !human.traits.includes('adaptable')) human.traits.push('adaptable');
  races('Elf', { race: 'Winter Elves', t: { cold: 5, heat: 2 } });
  species('Dwarf', { altitude: 4, cold: 4 });
  species('Capra', { altitude: 5, cold: 4 });
  species('Bird-folk', { altitude: 4 });
  species('Bear-folk', { cold: 4 });
  races('Bear-folk', { race: 'GoatBear', t: { altitude: 4 } });
  species('Crocodile-folk', { heat: 4, wet: 5, cold: 2 });
  races('Crocodile-folk', { water: 'High' });
  species('Lizard-folk', { heat: 4, dry: 4, cold: 2 });
  species('Shwana', { wet: 5 });
  races('Shwana', { water: 'High' });
  species('Taluty', { heat: 4, wet: 4 });
  races('Taluty', { covers: ['jungle'] });
  // Constructs don't drink.
  for (const c of ['Gargoyle', 'Toy Soldier', 'Vasaleth']) races(c, { water: 'None' });
  species('Gargoyle', { heat: 5, cold: 5, altitude: 5 });
  lib.applied = [...done, 'living-1'];
  return lib;
}

/** New traditions for regional versions of cultures (the Miners), added once to a library without them. */
function cultureAdditions(lib: Library): Library {
  const done = new Set(lib.applied ?? []);
  if (done.has('cultures-1')) return lib;
  for (const id of ['miners']) {
    const t = START_TRADITIONS.find((q) => q.id === id);
    if (t && !lib.traditions.some((q) => q.id === id)) lib.traditions.push(JSON.parse(JSON.stringify(t)));
  }
  lib.applied = [...(lib.applied ?? []), 'cultures-1'];
  return lib;
}

/**
 * A saved library, brought up to date: parts it was saved without (an older library has no
 * technology or traditions yet) come from the starting library; parts it has are kept as they are.
 */
export function upgradeLibrary(raw: unknown): Library {
  const lib = readLibrary(raw);
  const o = (raw ?? {}) as Record<string, unknown>;
  const start = defaultLibrary();
  for (const key of ['traits', 'resources', 'species', 'beasts', 'techs', 'behaviours', 'traditions', 'cultures', 'governments', 'tenets', 'faiths', 'gods'] as const) {
    if (!Array.isArray(o[key])) (lib[key] as unknown[]) = start[key] as unknown[];
  }
  // Where its peoples live (step 2 of "Where peoples live"), filled in once where still unset.
  livingDefaults(lib);
  cultureAdditions(lib);
  // Cultures named their preferred government before there was a creator: link the name to the government.
  for (const c of lib.cultures) {
    if (c.government && !lib.governments.some((gv) => gv.id === c.government)) {
      const byName = lib.governments.find((gv) => gv.name.toLowerCase() === c.government.toLowerCase());
      if (byName) c.government = byName.id;
    }
  }
  return lib;
}

const KEY = 'rv.library';

/** The shared library on this device (the starting one until it is first saved). */
export function loadSharedLibrary(store: KeyValueStore): Library {
  try {
    const raw = store.getItem(KEY);
    if (raw) return upgradeLibrary(JSON.parse(raw));
  } catch {
    // Damaged: fall back to the starting library.
  }
  return defaultLibrary();
}

export function saveSharedLibrary(store: KeyValueStore, lib: Library): void {
  try {
    store.setItem(KEY, JSON.stringify(lib));
  } catch (err) {
    throw new Error(`The library could not be saved: ${(err as Error).message || 'storage is unavailable'}.`);
  }
}

/** A library from an exported file. */
export function parseLibraryFile(text: string): Library {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a library file (it could not be read).');
  }
  const o = data as Record<string, unknown>;
  const inner = o && typeof o === 'object' && o.library ? o.library : o;
  const lib = upgradeLibrary(inner);
  if (!lib.species.length && !lib.beasts.length && !lib.traits.length && !lib.resources.length) throw new Error('This file has no library in it.');
  return lib;
}

export function libraryFile(lib: Library): string {
  return JSON.stringify({ kind: 'revelry-valor-library', library: lib }, null, 1);
}
