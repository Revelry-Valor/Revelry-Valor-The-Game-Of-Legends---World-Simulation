import { DEFAULT_RACES } from './data/races';
import type { WorldConfig } from './types';

export const MAP_SIZES: Record<string, [number, number]> = {
  small: [120, 80],
  medium: [180, 110],
  large: [240, 150],
  huge: [320, 200],
};

export function defaultConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    name: 'Aerth',
    seed: 1337,
    width: MAP_SIZES.medium[0],
    height: MAP_SIZES.medium[1],
    landFraction: 0.42,
    temperature: 0,
    moisture: 0,
    resourceAbundance: 1,
    magic: 1,
    calamity: 1,
    homelandsPerRace: 1,
    tribesPerHomeland: 3,
    settlementSpacing: 4,
    races: structuredClone(DEFAULT_RACES),
    ...overrides,
  };
}
