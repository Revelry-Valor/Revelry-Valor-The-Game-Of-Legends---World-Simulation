/** The calendar: twelve months and four seasons. Month 0 is midwinter. */
export const MONTHS = ['Deepwinter', 'Thawing', 'Seedtime', 'Rainmoon', 'Bloomtide', 'Highsun', 'Midsummer', 'Harvest', 'Leaffall', 'Mistmoon', 'Frostfall', 'Longnight'];

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export const SEASONS: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

export const seasonOf = (month: number): Season => SEASONS[((month % 12) + 12) % 12];

/** Month settlers set out and armies take the field. */
export const SPRING_MUSTER = 2;

function profile(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

/**
 * When each kind of food comes in over the year. Farmers bring in the grain at harvest;
 * hunters and gatherers find most from spring to autumn; herds and fish feed people all year,
 * leaner in winter.
 */
export const FOOD_SEASON: Record<string, number[]> = {
  farming: profile([0, 0, 0, 0, 0.3, 0.3, 0.6, 3, 4.5, 1.8, 0.3, 0]),
  foraging: profile([0.45, 0.5, 0.75, 1.1, 1.25, 1.3, 1.3, 1.35, 1.3, 1.15, 0.8, 0.55]),
  herding: profile([0.7, 0.8, 1.1, 1.3, 1.2, 1.1, 1.1, 1, 1, 0.9, 0.8, 0.7]),
  fishing: profile([0.5, 0.6, 0.9, 1.2, 1.3, 1.3, 1.3, 1.2, 1.1, 0.9, 0.7, 0.5]),
  default: profile([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
};

/** How far armies and caravans get in a month of each season. */
export const TRAVEL_SEASON: Record<Season, number> = { winter: 0.55, spring: 0.9, summer: 1.1, autumn: 1 };
