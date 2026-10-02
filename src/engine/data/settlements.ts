/**
 * Sizes of settlement by population. Every settlement sits on a single tile whatever its size and
 * works the ring of land around it; size decides how many people it holds and what trades it supports.
 */
export interface SettlementTier {
  name: string;
  /** Population at which a settlement reaches this size. */
  minPop: number;
}

export const TIERS: SettlementTier[] = [
  { name: 'Camp', minPop: 0 },
  { name: 'Hamlet', minPop: 150 },
  { name: 'Village', minPop: 600 },
  { name: 'Town', minPop: 2000 },
  { name: 'City', minPop: 8000 },
  { name: 'Great City', minPop: 30000 },
  { name: 'Metropolis', minPop: 100000 },
];

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
