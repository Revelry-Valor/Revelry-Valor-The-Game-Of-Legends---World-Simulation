/**
 * Sizes of settlement by population. Every settlement sits on a single tile whatever its size and
 * works the ring of land around it; size decides how many people it holds and what trades it supports.
 */
export interface SettlementTier {
  name: string;
  /** Population at which a settlement reaches this size. */
  minPop: number;
  /** Largest share of its workers a settlement this size can keep busy in crafts: bigger markets support more specialists. */
  crafts: number;
  /** Whether it has a town at its heart, built up on City land. */
  urban: boolean;
}

export const TIERS: SettlementTier[] = [
  { name: 'Camp', minPop: 0, crafts: 0.03, urban: false },
  { name: 'Hamlet', minPop: 150, crafts: 0.06, urban: false },
  { name: 'Village', minPop: 600, crafts: 0.1, urban: false },
  { name: 'Town', minPop: 2000, crafts: 0.2, urban: true },
  { name: 'City', minPop: 8000, crafts: 0.32, urban: true },
  { name: 'Great City', minPop: 30000, crafts: 0.42, urban: true },
  { name: 'Metropolis', minPop: 100000, crafts: 0.5, urban: true },
];

/** People one tile of City land holds before the town spills onto the next. */
export const CITY_TILE_PEOPLE = 2500;

/** What a settlement's buildings are made of, and how readily they burn. */
export const BUILDINGS: Record<string, { name: string; fire: number }> = {
  tents: { name: 'hide tents', fire: 0.8 },
  huts: { name: 'huts of reed and earth', fire: 0.6 },
  timber: { name: 'timber halls and houses', fire: 1 },
  mudbrick: { name: 'mud brick', fire: 0.3 },
  stone: { name: 'stone', fire: 0.25 },
};

export function tierIndex(pop: number): number {
  let i = 0;
  while (i + 1 < TIERS.length && pop >= TIERS[i + 1].minPop) i++;
  return i;
}

export const tierOf = (pop: number): SettlementTier => TIERS[tierIndex(pop)];

/** What a settlement puts each of its tiles to. */
export enum LandUse {
  None,
  Fields,
  Pasture,
  Forestry,
  Hunting,
  Mine,
  Quarry,
  Salt,
  Fishing,
  City,
}

export const LAND_USE_COUNT = 10;

export const LAND_USE_NAMES = ['Unused', 'Fields', 'Pasture', 'Forestry', 'Hunting grounds', 'Mine', 'Quarry', 'Salt works', 'Fishing waters', 'City'];

/** Map colours for the land use layer. */
export const LAND_USE_COLORS: [number, number, number][] = [
  [0, 0, 0],
  [222, 196, 92],
  [146, 196, 92],
  [36, 104, 52],
  [112, 140, 88],
  [122, 92, 78],
  [150, 150, 150],
  [236, 236, 228],
  [72, 170, 220],
  [176, 52, 52],
];

/** The production sectors each land use supports (by sector key), with how fully. */
export const USE_SECTORS: Record<LandUse, [string, number][]> = {
  [LandUse.None]: [],
  [LandUse.Fields]: [['farming', 1]],
  [LandUse.Pasture]: [['herding', 1], ['horseBreeding', 1]],
  [LandUse.Forestry]: [['forestry', 1], ['foraging', 0.3]],
  [LandUse.Hunting]: [['foraging', 1], ['arcanaGathering', 1]],
  [LandUse.Mine]: [['copperMining', 1], ['tinMining', 1], ['ironMining', 1], ['coalMining', 1], ['goldMining', 1], ['gemMining', 1]],
  [LandUse.Quarry]: [['quarrying', 1]],
  [LandUse.Salt]: [['saltWorks', 1]],
  [LandUse.Fishing]: [['fishing', 1]],
  [LandUse.City]: [],
};
