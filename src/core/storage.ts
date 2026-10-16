import { CLIMATE_DEFAULTS, defaultSettings, validateSettings } from './settings';
import { newWorldId, WORLD_FORMAT, type World } from './world';
import { BRUSHES, emptySurface, type Surface } from './paint';

/** Where saved worlds live: the browser's local storage, or anything shaped like it (tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the Continue list shows for each saved world. */
export interface SavedWorldSummary {
  id: string;
  name: string;
  mapType: World['settings']['mapType'];
  widthKm: number;
  heightKm: number;
  radiusKm: number;
  updatedAt: number;
}

const INDEX_KEY = 'rv.worlds';
const worldKey = (id: string) => `rv.world.${id}`;

function readIndex(store: KeyValueStore): SavedWorldSummary[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as SavedWorldSummary[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function summary(w: World): SavedWorldSummary {
  const s = w.settings;
  return { id: w.id, name: s.name, mapType: s.mapType, widthKm: s.widthKm, heightKm: s.heightKm, radiusKm: s.radiusKm, updatedAt: w.updatedAt };
}

/** Saved worlds, most recently changed first. */
export function listWorlds(store: KeyValueStore): SavedWorldSummary[] {
  return readIndex(store).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Save (or overwrite) a world. Throws with a readable message if the browser refuses (for example, storage full). */
export function saveWorld(store: KeyValueStore, world: World): void {
  try {
    store.setItem(worldKey(world.id), JSON.stringify(world));
    const index = readIndex(store).filter((e) => e.id !== world.id);
    index.push(summary(world));
    store.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (err) {
    throw new Error(`The world could not be saved: ${(err as Error).message || 'storage is unavailable'}.`);
  }
}

/** Turn saved text back into a world, filling in anything an older save lacks. Throws if it isn't a world. */
export function parseWorld(text: string): World {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a saved world (it could not be read).');
  }
  const w = data as Partial<World>;
  if (!w || typeof w !== 'object' || !w.settings || typeof w.settings !== 'object') throw new Error('This is not a saved world.');
  if (typeof w.format === 'number' && w.format > WORLD_FORMAT) throw new Error('This world was saved by a newer version of the program.');
  const base = defaultSettings();
  const settings = { ...base, ...w.settings, climate: { ...CLIMATE_DEFAULTS, ...(w.settings.climate ?? {}) } };
  const problems = validateSettings(settings);
  if (problems.length) throw new Error(`This saved world has a problem: ${problems[0]}`);
  const now = Date.now();
  return {
    format: WORLD_FORMAT,
    id: typeof w.id === 'string' && w.id ? w.id : newWorldId(),
    settings,
    layers: { underdark: false, surface: true, canopy: false, sky1: false, sky2: false, sky3: false, ...(w.layers ?? {}) },
    surface: readSurface(w.surface),
    createdAt: typeof w.createdAt === 'number' ? w.createdAt : now,
    updatedAt: typeof w.updatedAt === 'number' ? w.updatedAt : now,
  };
}

/** Painted strokes from a save, dropping any that are damaged. Worlds from format 1 have none. */
function readSurface(raw: unknown): Surface {
  const s = raw as Partial<Surface> | undefined;
  if (!s || !Array.isArray(s.strokes)) return emptySurface();
  const strokes = s.strokes.filter(
    (k) => k && typeof k.id === 'number' && BRUSHES.some((b) => b.id === k.brush) && Array.isArray(k.pts) && k.pts.length >= 2 && k.pts.length % 2 === 0 && k.pts.every(Number.isFinite) && k.size > 0,
  );
  const top = strokes.reduce((m, k) => Math.max(m, k.id), 0);
  return { strokes, nextId: Math.max(top + 1, typeof s.nextId === 'number' ? s.nextId : 1) };
}

/** Load a saved world (null if there is none with this id or it can't be read). */
export function loadWorld(store: KeyValueStore, id: string): World | null {
  try {
    const raw = store.getItem(worldKey(id));
    return raw ? parseWorld(raw) : null;
  } catch {
    return null;
  }
}

export function deleteWorld(store: KeyValueStore, id: string): void {
  try {
    store.removeItem(worldKey(id));
    store.setItem(INDEX_KEY, JSON.stringify(readIndex(store).filter((e) => e.id !== id)));
  } catch {
    // Nothing more can be done if storage is unavailable.
  }
}

/** Bring in a world from exported text, saved as a new copy (so it never overwrites a world already here). */
export function importWorld(store: KeyValueStore, text: string): World {
  const w = { ...parseWorld(text), id: newWorldId(), updatedAt: Date.now() };
  saveWorld(store, w);
  return w;
}

/** A browser-backed store, or an in-memory one where the browser's storage is unavailable. */
export function browserStore(): KeyValueStore {
  try {
    const ls = window.localStorage;
    const probe = 'rv.probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}
