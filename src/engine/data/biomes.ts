export enum Biome {
  DeepOcean,
  Ocean,
  Lake,
  Ice,
  Tundra,
  Taiga,
  TemperateForest,
  Grassland,
  Steppe,
  Desert,
  Savanna,
  TropicalForest,
  Wetland,
  Mountain,
}

export type BiomeKey =
  | 'deepOcean'
  | 'ocean'
  | 'lake'
  | 'ice'
  | 'tundra'
  | 'taiga'
  | 'temperateForest'
  | 'grassland'
  | 'steppe'
  | 'desert'
  | 'savanna'
  | 'tropicalForest'
  | 'wetland'
  | 'mountain';

export interface BiomeDef {
  key: BiomeKey;
  name: string;
  color: [number, number, number];
  water: boolean;
  /** Movement cost for overland travel (1 = open plains). */
  moveCost: number;
  /** Base soil fertility 0..1. */
  fertility: number;
  /** Timber density 0..1. */
  timber: number;
  /** Wild game abundance 0..1. */
  game: number;
}

export const BIOMES: BiomeDef[] = [
  { key: 'deepOcean', name: 'Deep Ocean', color: [22, 52, 96], water: true, moveCost: 1, fertility: 0, timber: 0, game: 0 },
  { key: 'ocean', name: 'Coastal Sea', color: [38, 84, 140], water: true, moveCost: 1, fertility: 0, timber: 0, game: 0 },
  { key: 'lake', name: 'Lake', color: [52, 110, 168], water: true, moveCost: 1, fertility: 0, timber: 0, game: 0 },
  { key: 'ice', name: 'Glacier', color: [232, 240, 245], water: false, moveCost: 6, fertility: 0, timber: 0, game: 0.05 },
  { key: 'tundra', name: 'Tundra', color: [160, 170, 150], water: false, moveCost: 1.8, fertility: 0.1, timber: 0.05, game: 0.35 },
  { key: 'taiga', name: 'Boreal Forest', color: [62, 102, 78], water: false, moveCost: 2, fertility: 0.3, timber: 0.9, game: 0.6 },
  { key: 'temperateForest', name: 'Temperate Forest', color: [58, 120, 60], water: false, moveCost: 1.6, fertility: 0.65, timber: 1, game: 0.7 },
  { key: 'grassland', name: 'Grassland', color: [128, 168, 82], water: false, moveCost: 1, fertility: 0.9, timber: 0.15, game: 0.6 },
  { key: 'steppe', name: 'Steppe', color: [176, 176, 110], water: false, moveCost: 1, fertility: 0.45, timber: 0.05, game: 0.55 },
  { key: 'desert', name: 'Desert', color: [216, 196, 136], water: false, moveCost: 2.2, fertility: 0.04, timber: 0, game: 0.1 },
  { key: 'savanna', name: 'Savanna', color: [182, 170, 84], water: false, moveCost: 1.2, fertility: 0.5, timber: 0.2, game: 0.8 },
  { key: 'tropicalForest', name: 'Tropical Forest', color: [34, 110, 50], water: false, moveCost: 2.6, fertility: 0.55, timber: 1, game: 0.75 },
  { key: 'wetland', name: 'Wetland', color: [84, 120, 100], water: false, moveCost: 2.8, fertility: 0.5, timber: 0.35, game: 0.7 },
  { key: 'mountain', name: 'Mountains', color: [132, 118, 106], water: false, moveCost: 4.5, fertility: 0.05, timber: 0.2, game: 0.25 },
];

export const BIOME_KEYS = BIOMES.map((b) => b.key);

export enum Relief {
  Water,
  Flat,
  Hills,
  Mountains,
}
