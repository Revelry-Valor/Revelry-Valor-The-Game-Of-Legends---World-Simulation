import { cloneLibrary, emptyProfile, emptyStats, LIBRARY_FORMAT, readLibrary, STAT_KEYS, type Library, type Size, type Species } from './library';
import { ROSTER } from '../data/roster';
import { START_BEASTS, START_RESOURCES, START_TRAITS } from '../data/startlists';
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
        return { id: `${id}.${i + 1}`, name: r.name, size: r.size as Size | null, stats, fightingAge: r.fightingAge, lifespan: r.lifespan, affinity: r.affinity, affinity2: r.affinity2, specialty: r.specialty, notes: r.notes, addTraits: [], removeTraits: [], lifestyle: '', climates: [] };
      }),
    };
  });
  return cloneLibrary({ format: LIBRARY_FORMAT, traits: START_TRAITS, resources: START_RESOURCES, species, beasts: START_BEASTS });
}

const KEY = 'rv.library';

/** The shared library on this device (the starting one until it is first saved). */
export function loadSharedLibrary(store: KeyValueStore): Library {
  try {
    const raw = store.getItem(KEY);
    if (raw) return readLibrary(JSON.parse(raw));
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
  const lib = readLibrary(inner);
  if (!lib.species.length && !lib.beasts.length && !lib.traits.length && !lib.resources.length) throw new Error('This file has no library in it.');
  return lib;
}

export function libraryFile(lib: Library): string {
  return JSON.stringify({ kind: 'revelry-valor-library', library: lib }, null, 1);
}
