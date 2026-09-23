/** Natural resources stored per map tile. */
export enum Res {
  Fertility,
  Timber,
  Game,
  Fish,
  Stone,
  Copper,
  Tin,
  Iron,
  Coal,
  Gold,
  Gems,
  Salt,
  Horses,
  Arcana,
}
export const RES_COUNT = 14;
export const RES_NAMES = [
  'Fertile soil', 'Timber', 'Wild game', 'Fish', 'Stone', 'Copper', 'Tin', 'Iron',
  'Coal', 'Gold', 'Gems', 'Salt', 'Wild horses', 'Ley lines',
];
export const RES_KEYS = [
  'fertility', 'timber', 'game', 'fish', 'stone', 'copper', 'tin', 'iron',
  'coal', 'gold', 'gems', 'salt', 'horses', 'arcana',
] as const;
export type ResKey = (typeof RES_KEYS)[number];

/** Tradeable goods held in settlement stockpiles. */
export enum Good {
  Food,
  Timber,
  Stone,
  Copper,
  Tin,
  Iron,
  Coal,
  Gold,
  Gems,
  Salt,
  Horses,
  Reagents,
  Tools,
  Weapons,
  Luxuries,
}
export const GOOD_COUNT = 15;
export const GOOD_NAMES = [
  'Food', 'Timber', 'Stone', 'Copper', 'Tin', 'Iron', 'Coal', 'Gold', 'Gems',
  'Salt', 'Horses', 'Reagents', 'Tools', 'Weapons', 'Luxuries',
];
/** Base price (in abstract silver) of one unit of each good. */
export const GOOD_BASE_PRICE = [1, 1, 1.3, 4, 6, 5, 2, 20, 25, 3, 12, 15, 8, 10, 14];
/** Fraction of a stockpile that decays each year (before tech modifiers for food). */
export const GOOD_DECAY = [0.35, 0.05, 0, 0, 0, 0.01, 0, 0, 0, 0.02, 0.1, 0.05, 0.15, 0.1, 0.05];

/** The good a natural resource yields once extracted. */
export const RES_TO_GOOD: Partial<Record<Res, Good>> = {
  [Res.Timber]: Good.Timber,
  [Res.Stone]: Good.Stone,
  [Res.Copper]: Good.Copper,
  [Res.Tin]: Good.Tin,
  [Res.Iron]: Good.Iron,
  [Res.Coal]: Good.Coal,
  [Res.Gold]: Good.Gold,
  [Res.Gems]: Good.Gems,
  [Res.Salt]: Good.Salt,
  [Res.Horses]: Good.Horses,
  [Res.Arcana]: Good.Reagents,
};

export type SectorKey =
  | 'foraging'
  | 'farming'
  | 'herding'
  | 'fishing'
  | 'forestry'
  | 'quarrying'
  | 'copperMining'
  | 'tinMining'
  | 'ironMining'
  | 'coalMining'
  | 'goldMining'
  | 'gemMining'
  | 'saltWorks'
  | 'horseBreeding'
  | 'arcanaGathering'
  | 'toolmaking'
  | 'weaponsmithing'
  | 'artisans';

export interface ExtractionSector {
  key: SectorKey;
  name: string;
  output: Good;
  /** Resource capacity per unit of resource on a tile, contributions summed over territory. */
  capacity: [Res, number][];
  /** Output per worker per year when the resource is untapped. */
  yieldPerWorker: number;
  /** Polity must know this tech (or have this metallurgy level) to use the sector. */
  requiresTech?: string;
  requiresMetallurgy?: number;
  /** Which tech-effect key multiplies this sector's capacity and yield. */
  effect?: 'food' | 'fish' | 'timber' | 'mining' | 'magic';
}

export const EXTRACTION_SECTORS: ExtractionSector[] = [
  { key: 'foraging', name: 'Hunting & gathering', output: Good.Food, capacity: [[Res.Game, 30], [Res.Fertility, 10]], yieldPerWorker: 2.1 },
  { key: 'farming', name: 'Farming', output: Good.Food, capacity: [[Res.Fertility, 320]], yieldPerWorker: 3.6, requiresTech: 'agriculture', effect: 'food' },
  { key: 'herding', name: 'Herding', output: Good.Food, capacity: [[Res.Game, 25], [Res.Horses, 40], [Res.Fertility, 20]], yieldPerWorker: 2.8, requiresTech: 'animal_husbandry', effect: 'food' },
  { key: 'fishing', name: 'Fishing', output: Good.Food, capacity: [[Res.Fish, 110]], yieldPerWorker: 2.6, effect: 'fish' },
  { key: 'forestry', name: 'Forestry', output: Good.Timber, capacity: [[Res.Timber, 140]], yieldPerWorker: 2.5, effect: 'timber' },
  { key: 'quarrying', name: 'Quarrying', output: Good.Stone, capacity: [[Res.Stone, 70]], yieldPerWorker: 1.4, effect: 'mining' },
  { key: 'copperMining', name: 'Copper mining', output: Good.Copper, capacity: [[Res.Copper, 30]], yieldPerWorker: 0.7, requiresMetallurgy: 1, effect: 'mining' },
  { key: 'tinMining', name: 'Tin mining', output: Good.Tin, capacity: [[Res.Tin, 20]], yieldPerWorker: 0.5, requiresMetallurgy: 1, effect: 'mining' },
  { key: 'ironMining', name: 'Iron mining', output: Good.Iron, capacity: [[Res.Iron, 30]], yieldPerWorker: 0.7, requiresMetallurgy: 3, effect: 'mining' },
  { key: 'coalMining', name: 'Coal mining', output: Good.Coal, capacity: [[Res.Coal, 40]], yieldPerWorker: 1, requiresMetallurgy: 3, effect: 'mining' },
  { key: 'goldMining', name: 'Gold panning & mining', output: Good.Gold, capacity: [[Res.Gold, 6]], yieldPerWorker: 0.12, effect: 'mining' },
  { key: 'gemMining', name: 'Gem cutting', output: Good.Gems, capacity: [[Res.Gems, 5]], yieldPerWorker: 0.1, effect: 'mining' },
  { key: 'saltWorks', name: 'Salt works', output: Good.Salt, capacity: [[Res.Salt, 40]], yieldPerWorker: 0.8 },
  { key: 'horseBreeding', name: 'Horse breeding', output: Good.Horses, capacity: [[Res.Horses, 8]], yieldPerWorker: 0.25, requiresTech: 'animal_husbandry' },
  { key: 'arcanaGathering', name: 'Reagent gathering', output: Good.Reagents, capacity: [[Res.Arcana, 12]], yieldPerWorker: 0.25, requiresTech: 'mysticism', effect: 'magic' },
];

export interface Recipe {
  /** Metallurgy level (0 stone .. 4 steel) needed; also the quality of the product. */
  quality: number;
  inputs: [Good, number][];
}

export interface CraftSector {
  key: SectorKey;
  name: string;
  output: Good;
  yieldPerWorker: number;
  /** Ordered best-first; the best recipe the polity knows and can supply is used. */
  recipes: Recipe[];
}

export const CRAFT_SECTORS: CraftSector[] = [
  {
    key: 'toolmaking',
    name: 'Toolmaking',
    output: Good.Tools,
    yieldPerWorker: 0.5,
    recipes: [
      { quality: 4, inputs: [[Good.Iron, 0.8], [Good.Coal, 0.8]] },
      { quality: 3, inputs: [[Good.Iron, 1], [Good.Timber, 0.5]] },
      { quality: 2, inputs: [[Good.Copper, 0.7], [Good.Tin, 0.2], [Good.Timber, 0.3]] },
      { quality: 1, inputs: [[Good.Copper, 1], [Good.Timber, 0.3]] },
      { quality: 0, inputs: [[Good.Stone, 0.6], [Good.Timber, 0.4]] },
    ],
  },
  {
    key: 'weaponsmithing',
    name: 'Weaponsmithing',
    output: Good.Weapons,
    yieldPerWorker: 0.35,
    recipes: [
      { quality: 4, inputs: [[Good.Iron, 1], [Good.Coal, 1]] },
      { quality: 3, inputs: [[Good.Iron, 1.2], [Good.Timber, 0.5]] },
      { quality: 2, inputs: [[Good.Copper, 0.8], [Good.Tin, 0.25], [Good.Timber, 0.4]] },
      { quality: 1, inputs: [[Good.Copper, 1.2], [Good.Timber, 0.4]] },
      { quality: 0, inputs: [[Good.Stone, 0.5], [Good.Timber, 0.8]] },
    ],
  },
  {
    key: 'artisans',
    name: 'Artisans & jewellers',
    output: Good.Luxuries,
    yieldPerWorker: 0.3,
    recipes: [
      { quality: 2, inputs: [[Good.Gems, 0.2], [Good.Gold, 0.1]] },
      { quality: 1, inputs: [[Good.Gold, 0.25]] },
      { quality: 1, inputs: [[Good.Gems, 0.25]] },
      { quality: 0, inputs: [[Good.Reagents, 0.3]] },
    ],
  },
];

export const SECTOR_COUNT = EXTRACTION_SECTORS.length + CRAFT_SECTORS.length;
export const SECTOR_NAMES = [...EXTRACTION_SECTORS.map((s) => s.name), ...CRAFT_SECTORS.map((s) => s.name)];
export const SECTOR_KEYS: SectorKey[] = [...EXTRACTION_SECTORS.map((s) => s.key), ...CRAFT_SECTORS.map((s) => s.key)];
