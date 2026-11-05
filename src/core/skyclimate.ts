import { climateAt, sampleField, type Climate } from './climate';
import { pathLength } from './paint';
import { CLIMATE_DEFAULTS } from './settings';
import { SKY_ALT_KM, SKY_RAIN, SKY_WIND, type SkyCover, type SkyIsland, type SkyLayer } from './sky';

/** The climate up on the sky layers (kept apart from sky.ts, which the terrain reads). */

export interface SkyClimate {
  summerT: number;
  winterT: number;
  summerRain: number;
  winterRain: number;
  /** Wind toward east and north (the climate's units, stronger with height), summer and winter averaged. */
  windU: number;
  windV: number;
  /** Wind strength: 0 calm, 1 a strong steady wind. */
  wind: number;
}

/**
 * The climate up on a sky layer above a place: the air cools with height (from sea level, at the
 * world's altitude cooling), the winds blow harder and less rain falls the higher it is. Over the
 * sea the islands still get a sea-air share of rain.
 */
export function skyClimate(cl: Climate, settings: { climate?: { altitudeCoolingC?: number } } | null, layer: SkyLayer, x: number, y: number): SkyClimate {
  const c = climateAt(cl, x, y);
  const cooling = settings?.climate?.altitudeCoolingC ?? CLIMATE_DEFAULTS.altitudeCoolingC;
  const ground = Math.max(0, sampleField(cl, cl.height, x, y));
  // The ground's own air, brought back to sea level, then up to the layer.
  const lift = cooling * (SKY_ALT_KM[layer] - (c.land ? ground : 0));
  const rain = (r: number) => (c.land ? r : Math.max(r, 0.25)) * SKY_RAIN[layer];
  const u = ((sampleField(cl, cl.summer.windU, x, y) + sampleField(cl, cl.winter.windU, x, y)) / 2) * SKY_WIND[layer];
  const v = ((sampleField(cl, cl.summer.windV, x, y) + sampleField(cl, cl.winter.windV, x, y)) / 2) * SKY_WIND[layer];
  return { summerT: c.summerT - lift, winterT: c.winterT - lift, summerRain: rain(c.summerRain), winterRain: rain(c.winterRain), windU: u, windV: v, wind: Math.min(1, Math.hypot(u, v) / 2) };
}

/** An island's own cover where nothing is painted, from its climate. */
export function autoSkyCover(k: SkyClimate): SkyCover {
  if (k.summerT <= 0) return 'snow';
  if (k.summerT < 9 || k.wind > 0.85) return 'tundra';
  return 'meadow';
}

/** How far a drifting island goes in a year (km): with the wind, by its strength; along a path, steadily. */
export function driftPerYear(isl: SkyIsland, k: SkyClimate | null): number {
  if (isl.drift === 'fixed') return 0;
  if (isl.drift === 'path') return Math.min(pathLength(isl.path ?? []), 40);
  return 20 + 100 * (k?.wind ?? 0.3);
}
