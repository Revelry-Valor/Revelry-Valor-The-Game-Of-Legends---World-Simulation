import { centreLatitude, kmPerDegree, southLatitude, validateSettings, type WorldSettings } from './settings';
import { emptySurface, shiftSurface, type Surface } from './paint';

/** The world's layers, bottom to top (REDESIGN.md, section 5). Only the surface is always on. */
export const LAYERS = [
  { id: 'underdark', name: 'Underdark' },
  { id: 'surface', name: 'Surface' },
  { id: 'canopy', name: 'Canopy' },
  { id: 'sky1', name: 'Sky layer 1' },
  { id: 'sky2', name: 'Sky layer 2' },
  { id: 'sky3', name: 'Sky layer 3' },
] as const;

export type LayerId = (typeof LAYERS)[number]['id'];

/** A place on a flat map: kilometres east and south of its north-west corner. */
export interface FlatPoint {
  x: number;
  y: number;
}

/** Version of the saved-world format; bumped when it changes. */
export const WORLD_FORMAT = 2;

export interface World {
  format: number;
  id: string;
  settings: WorldSettings;
  /** Which optional layers this world uses (the surface is always on). */
  layers: Record<LayerId, boolean>;
  /** The painted surface layer: land, sea, relief and ground cover (Phase 1). */
  surface: Surface;
  createdAt: number;
  updatedAt: number;
}

export function newWorldId(): string {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** A new, empty world: a blank ocean with these settings. Throws if the settings are invalid. */
export function createWorld(settings: WorldSettings, now = Date.now()): World {
  const problems = validateSettings(settings);
  if (problems.length) throw new Error(problems.join(' '));
  return {
    format: WORLD_FORMAT,
    id: newWorldId(),
    settings: { ...settings, climate: { ...settings.climate } },
    layers: { underdark: false, surface: true, canopy: false, sky1: false, sky2: false, sky3: false },
    surface: emptySurface(),
    createdAt: now,
    updatedAt: now,
  };
}

/** How far to grow a flat map in each direction, in km (0 or more). */
export interface Expansion {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Anything placed on the map registers here to be moved when the map grows west or north (so
 * nothing already drawn moves relative to the land). Later phases add their own.
 */
type Translator = (world: World, dxKm: number, dyKm: number) => void;
const translators: Translator[] = [];
export function onMapShift(t: Translator): void {
  translators.push(t);
}
// Painted strokes keep their place on the land.
onMapShift((w, dx, dy) => {
  w.surface = shiftSurface(w.surface, dx, dy);
});

/**
 * The settings after growing a flat map. The old part keeps its latitudes; if the map outgrows
 * its planet (past Earth's size, unless a planet size is set), the planet grows and every degree
 * covers more ground, with the old part's middle staying where it was.
 */
export function expandedSettings(s: WorldSettings, e: Expansion): WorldSettings {
  const next = { ...s, widthKm: s.widthKm + e.east + e.west, heightKm: s.heightKm + e.north + e.south };
  const k = kmPerDegree(next);
  const span = next.heightKm / k;
  let north = centreLatitude(s) + (e.north + s.heightKm / 2) / k;
  // A map as tall as its planet runs pole to pole.
  if (span >= 179.99) north = 90;
  return { ...next, northLatitude: north };
}

/** Why an expansion can't be made (null if it can). */
export function expansionProblem(world: World, e: Expansion): string | null {
  const s = world.settings;
  if (s.mapType !== 'flat') return 'Only flat maps grow this way; a globe grows by its radius.';
  if ([e.north, e.south, e.east, e.west].some((v) => !(v >= 0))) return 'Expansion amounts must be zero or more.';
  if (e.north + e.south + e.east + e.west === 0) return 'Choose how far to expand.';
  const next = expandedSettings(s, e);
  if (next.northLatitude > 90 + 1e-6) return 'That would reach past the North Pole.';
  if (southLatitude(next) < -90 - 1e-6) return 'That would reach past the South Pole.';
  const problems = validateSettings(next);
  return problems.length ? problems[0] : null;
}

/**
 * Grow a flat map. Growing north or south extends its latitudes; nothing already on the map
 * moves or changes. Returns the grown world (the original is left as it was).
 */
export function expandWorld(world: World, e: Expansion, now = Date.now()): World {
  const problem = expansionProblem(world, e);
  if (problem) throw new Error(problem);
  const s = world.settings;
  const grown: World = {
    ...world,
    settings: expandedSettings(s, e),
    updatedAt: now,
  };
  if (e.west || e.north) for (const t of translators) t(grown, e.west, e.north);
  return grown;
}
