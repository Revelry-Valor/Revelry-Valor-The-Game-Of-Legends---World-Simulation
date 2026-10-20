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
  /** Warmest-season sea temperature reefs can stand (°C); hotter water bleaches them. */
  reefMaxC: number;
  /** ITCZ: width of land (km) needed for the path to reach the tilt line. */
  itczLandKm: number;
  /** ITCZ: width of open sea (km) needed for the path to sink to its lowest point. */
  itczSeaKm: number;
  /** ITCZ: how far (km) offshore the path starts ramping toward a coast. */
  itczRampKm: number;
  /** Strength of the subtropical highs (1 = Earth). */
  subtropicalHigh: number;
  /** How much colder than the sea (°C) land must be for a winter continental high. */
  continentalHighC: number;
  /** Strength of summer thermal lows (1 = Earth). */
  thermalLow: number;
  /** Moves the polar front (degrees; positive is poleward). */
  polarFrontShift: number;
  /** Landmasses closer than this (km) count as one. */
  landJoinKm: number;
  /** Ocean currents crossing open sea travel this far (km) for each degree they move north or south. */
  currentSlopeKm: number;
}

export const CLIMATE_DEFAULTS: ClimateSliders = {
  moistureCarryKm: 2000,
  blockingReliefKm: 1,
  warmCurrentC: 15,
  coldCurrentC: -10,
  reefMinC: 18,
  altitudeCoolingC: 6.5,
  minCurrentTravelDeg: 30,
  reefMaxC: 30,
  itczLandKm: 2500,
  itczSeaKm: 4000,
  itczRampKm: 500,
  subtropicalHigh: 1,
  continentalHighC: 7,
  thermalLow: 1,
  polarFrontShift: 0,
  landJoinKm: 300,
  currentSlopeKm: 250,
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
  /** Flat maps: longitude of the map's middle (where it sits around the world; no effect on climate). */
  centreLongitude: number;
  /** Flat maps: what lies past the east and west edges. */
  edges: EdgeMode;
  /** Globes: the planet's radius in km. Flat maps use it only when `useRadius` is on. */
  radiusKm: number;
  /** Flat maps: use `radiusKm` for the climate (otherwise an Earth-sized planet is assumed). */
  useRadius: boolean;
  /**
   * Flat maps, how degrees relate to distance: 'earth' keeps Earth's planet (it grows only once
   * the map outgrows Earth); 'map' makes the map the whole world, so the planet (and each degree)
   * shrinks or grows with the map.
   */
  degreeScale: 'earth' | 'map';
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
/** Up to about three Earths around: past Earth's size the planet grows with the map. */
export const MAX_SIDE_KM = 120000;

export function defaultSettings(overrides: Partial<WorldSettings> = {}): WorldSettings {
  const preset = SIZE_PRESETS[1];
  const heightKm = milesToKm(preset.heightMi);
  return {
    name: 'New World',
    mapType: 'flat',
    widthKm: milesToKm(preset.widthMi),
    heightKm,
    // The equator runs through the middle of the map by default.
    northLatitude: heightKm / KM_PER_DEGREE / 2,
    centreLongitude: 0,
    edges: 'void',
    radiusKm: EARTH_RADIUS_KM,
    useRadius: false,
    degreeScale: 'earth',
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

/**
 * The planet's radius (km). Set by hand for globes (or when a flat map uses its own planet size);
 * otherwise Earth's, until the map outgrows Earth (taller than pole to pole, or wider than the
 * equator): then the planet grows to fit, and each degree covers more ground.
 */
export function planetRadiusKm(s: PlanetSize): number {
  if (s.mapType === 'globe' || s.useRadius) return s.radiusKm;
  // The smallest planet the map fits on: pole to pole, or once around.
  const fit = Math.max((EARTH_RADIUS_KM * s.heightKm) / (180 * KM_PER_DEGREE), (EARTH_RADIUS_KM * s.widthKm) / (360 * KM_PER_DEGREE));
  return s.degreeScale === 'map' ? fit : Math.max(EARTH_RADIUS_KM, fit);
}

type PlanetSize = Pick<WorldSettings, 'mapType' | 'useRadius' | 'radiusKm' | 'widthKm' | 'heightKm'> & { degreeScale?: WorldSettings['degreeScale'] };

/** Kilometres in one degree of latitude on this world's planet. */
export function kmPerDegree(s: PlanetSize): number {
  return (KM_PER_DEGREE * planetRadiusKm(s)) / EARTH_RADIUS_KM;
}

/** Latitude of the south edge of a flat map. */
export function southLatitude(s: WorldSettings): number {
  return s.northLatitude - s.heightKm / kmPerDegree(s);
}

/** Latitude at a distance (km) south of a flat map's north edge. */
export function latitudeAt(s: WorldSettings, yKm: number): number {
  return s.northLatitude - yKm / kmPerDegree(s);
}

/** Latitude of the middle of a flat map. */
export function centreLatitude(s: WorldSettings): number {
  return s.northLatitude - s.heightKm / kmPerDegree(s) / 2;
}

/** Latitude of the north edge that centres a map of this height on a given latitude. */
export function northForCentre(centreLatitude: number, heightKm: number, kmPerDeg = KM_PER_DEGREE): number {
  return centreLatitude + heightKm / kmPerDeg / 2;
}

/** Put a flat map's middle at a latitude, kept between the poles. */
export function placeAtLatitude(s: WorldSettings, centre: number): number {
  const half = s.heightKm / kmPerDegree(s) / 2;
  const c = Math.max(-90 + half, Math.min(90 - half, centre));
  return c + half;
}

/** The planet radius the climate uses (km). */
export function climateRadiusKm(s: WorldSettings): number {
  return planetRadiusKm(s);
}

/** Surface area of the world's planet and of the map (km²). */
export function planetAreaKm2(s: WorldSettings): number {
  const r = planetRadiusKm(s);
  return 4 * Math.PI * r * r;
}

/** Fahrenheit for people to read; settings are kept in °C. */
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

/** Problems with a world's settings, for people to read (empty when they are fine). */
export function validateSettings(s: WorldSettings): string[] {
  const problems: string[] = [];
  if (!s.name.trim()) problems.push('The world needs a name.');
  if (s.mapType === 'flat') {
    for (const [side, v] of [['width', s.widthKm], ['height', s.heightKm]] as const) {
      if (!(v >= MIN_SIDE_KM)) problems.push(`The map's ${side} must be at least ${MIN_SIDE_KM} km.`);
      if (v > MAX_SIDE_KM) problems.push(`The map's ${side} can be at most ${MAX_SIDE_KM.toLocaleString('en-US')} km.`);
    }
    if (s.northLatitude > 90 + 1e-6) problems.push('The map reaches past the North Pole.');
    if (southLatitude(s) < -90 - 1e-6) problems.push('The map reaches past the South Pole.');
    if (s.useRadius && s.widthKm > 2 * Math.PI * s.radiusKm * 1.0001) problems.push('The map is wider than its planet is around.');
  }
  if ((s.mapType === 'globe' || s.useRadius) && !(s.radiusKm >= 500 && s.radiusKm <= 100000)) {
    problems.push('The planet radius must be between 500 and 100,000 km.');
  }
  if (!(s.axialTilt >= 0 && s.axialTilt <= 90)) problems.push('Axial tilt must be between 0° and 90°.');
  if (!(s.dayLengthHours >= 4 && s.dayLengthHours <= 1000)) problems.push('Day length must be between 4 and 1,000 hours.');
  if (!(s.averageTemperatureC >= -30 && s.averageTemperatureC <= 50)) problems.push('Average temperature must be between −22 °F and 122 °F.');
  if (s.rainfall.mode === 'manual' && !(s.rainfall.percent >= 0 && s.rainfall.percent <= 200)) problems.push('Rainfall must be between 0% and 200%.');
  return problems;
}
