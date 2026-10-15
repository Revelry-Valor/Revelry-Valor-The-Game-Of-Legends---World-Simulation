import { EARTH_RADIUS_KM, KM_PER_DEGREE, milesToKm } from './units';

/** A flat map is a region of a world; a globe is a whole planet (see REDESIGN.md, section 3). */
export type MapType = 'flat' | 'globe';

/** What happens at the east and west edges of a flat map. */
export type EdgeMode = 'wrap' | 'void';

/** The climate's tuning sliders (REDESIGN.md, section 7.2), with Earth-fitted defaults. */
export interface ClimateSliders {
  /** How far rain-bearing air travels inland before drying out (km). */
  moistureCarryKm: number;
  /** Height of relief that stops moisture and makes a rain shadow (km). */
  blockingReliefKm: number;
  /** Peak warming of coasts by poleward currents (°C). */
  warmCurrentC: number;
  /** Peak cooling of coasts by equatorward currents (°C, negative). */
  coldCurrentC: number;
  /** Coldest-season sea temperature reefs need (°C). */
  reefMinC: number;
  /** Temperature drop with height (°C per km). */
  altitudeCoolingC: number;
  /** Currents travelling less than this many degrees of latitude have no temperature effect. */
  minCurrentTravelDeg: number;
}

export const CLIMATE_DEFAULTS: ClimateSliders = {
  moistureCarryKm: 2000,
  blockingReliefKm: 1,
  warmCurrentC: 15,
  coldCurrentC: -10,
  reefMinC: 18,
  altitudeCoolingC: 6.5,
  minCurrentTravelDeg: 30,
};

/** Rainfall follows the world's temperature automatically, or is set by hand (100% = what the temperature would give). */
export type Rainfall = { mode: 'auto' } | { mode: 'manual'; percent: number };

export interface WorldSettings {
  name: string;
  mapType: MapType;
  /** Flat maps: width and height in km. */
  widthKm: number;
  heightKm: number;
  /** Flat maps: latitude of the north edge (degrees, negative south of the equator). */
  northLatitude: number;
  /** Flat maps: what lies past the east and west edges. */
  edges: EdgeMode;
  /** Globes: the planet's radius in km. */
  radiusKm: number;
  /** Axial tilt in degrees: how harsh the seasons are, and how far the climate belts shift. */
  axialTilt: number;
  /** Length of a day in hours (Earth 24): sets where the wind belts sit. */
  dayLengthHours: number;
  /** Which way the planet spins. */
  rotation: 'east' | 'west';
  /** Average world temperature (°C, Earth 15). */
  averageTemperatureC: number;
  rainfall: Rainfall;
  climate: ClimateSliders;
  /** One number that fixes all randomness, so the same drawing gives the same world. */
  seed: number;
}

/** The three starting sizes of a flat map (REDESIGN.md, section 3), in miles. */
export const SIZE_PRESETS = [
  { id: 'region', name: 'Region', widthMi: 500, heightMi: 300 },
  { id: 'continent', name: 'Continent', widthMi: 2000, heightMi: 1200 },
  { id: 'large', name: 'Large continent', widthMi: 4000, heightMi: 2400 },
] as const;

export type SizePresetId = (typeof SIZE_PRESETS)[number]['id'];

/** Smallest and largest flat maps allowed, in km. */
export const MIN_SIDE_KM = 50;
export const MAX_SIDE_KM = 40000;

export function defaultSettings(overrides: Partial<WorldSettings> = {}): WorldSettings {
  const preset = SIZE_PRESETS[1];
  const heightKm = milesToKm(preset.heightMi);
  return {
    name: 'New World',
    mapType: 'flat',
    widthKm: milesToKm(preset.widthMi),
    heightKm,
    // Centred on 40°N by default.
    northLatitude: 40 + heightKm / KM_PER_DEGREE / 2,
    edges: 'void',
    radiusKm: EARTH_RADIUS_KM,
    axialTilt: 23.5,
    dayLengthHours: 24,
    rotation: 'east',
    averageTemperatureC: 15,
    rainfall: { mode: 'auto' },
    climate: { ...CLIMATE_DEFAULTS },
    seed: Math.floor(Math.random() * 1e9),
    ...overrides,
  };
}

/** Latitude of the south edge of a flat map. */
export function southLatitude(s: WorldSettings): number {
  return s.northLatitude - s.heightKm / KM_PER_DEGREE;
}

/** Latitude at a distance (km) south of a flat map's north edge. */
export function latitudeAt(s: WorldSettings, yKm: number): number {
  return s.northLatitude - yKm / KM_PER_DEGREE;
}

/** Latitude of the north edge that centres a map of this height on a given latitude. */
export function northForCentre(centreLatitude: number, heightKm: number): number {
  return centreLatitude + heightKm / KM_PER_DEGREE / 2;
}

/** Problems with a world's settings, for people to read (empty when they are fine). */
export function validateSettings(s: WorldSettings): string[] {
  const problems: string[] = [];
  if (!s.name.trim()) problems.push('The world needs a name.');
  if (s.mapType === 'flat') {
    for (const [side, v] of [['width', s.widthKm], ['height', s.heightKm]] as const) {
      if (!(v >= MIN_SIDE_KM)) problems.push(`The map's ${side} must be at least ${MIN_SIDE_KM} km.`);
      if (v > MAX_SIDE_KM) problems.push(`The map's ${side} can be at most ${MAX_SIDE_KM.toLocaleString('en-US')} km.`);
    }
    if (s.northLatitude > 90) problems.push('The map reaches past the North Pole.');
    if (southLatitude(s) < -90) problems.push('The map reaches past the South Pole.');
  } else if (!(s.radiusKm >= 500 && s.radiusKm <= 100000)) {
    problems.push('The planet radius must be between 500 and 100,000 km.');
  }
  if (!(s.axialTilt >= 0 && s.axialTilt <= 90)) problems.push('Axial tilt must be between 0° and 90°.');
  if (!(s.dayLengthHours >= 4 && s.dayLengthHours <= 1000)) problems.push('Day length must be between 4 and 1,000 hours.');
  if (!(s.averageTemperatureC >= -30 && s.averageTemperatureC <= 50)) problems.push('Average temperature must be between −30 °C and 50 °C.');
  if (s.rainfall.mode === 'manual' && !(s.rainfall.percent >= 0 && s.rainfall.percent <= 200)) problems.push('Rainfall must be between 0% and 200%.');
  return problems;
}
