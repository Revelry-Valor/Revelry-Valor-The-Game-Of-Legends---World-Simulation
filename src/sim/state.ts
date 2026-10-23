/**
 * The simulation's state (Phase 6: first peoples). Tribes are the groups that move on the map;
 * each carries its bands and its warband (the fighters) inside it. Clans hold tribes. Land is
 * claimed by walking and hunting it, and the claim never fades on its own; another clan can
 * take it by using it. Beasts live as density maps, thinned by hunting and growing back.
 *
 * Fields over the land (claims, beast densities) live on the climate's points.
 */

/** The calendar: 12 months of 30 days. */
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export interface Point {
  x: number;
  y: number;
}

export interface Tribe {
  id: number;
  name: string;
  clan: number;
  /** Species and race ids in the library, and the culture (if any). */
  species: string;
  race: string;
  culture: string;
  /** Where it is now (km). */
  x: number;
  y: number;
  /** Where it is heading, and its summer and winter grounds. */
  target: Point | null;
  summer: Point;
  winter: Point;
  pop: number;
  /** Food last month, as a share of what it needed (1 = enough). */
  fed: number;
  /** The warband: the tribe's fighters. Away (with a sortie) or with the tribe. */
  warband: number;
  away: number;
  founded: number;
}

export interface Clan {
  id: number;
  name: string;
  colour: string;
  species: string;
  race: string;
  culture: string;
  founded: number;
  /** The clan it split from, if any (kin are slower to fight). */
  parent: number;
}

/** A warband away from its tribe: going to fight, or coming home. */
export interface Sortie {
  id: number;
  tribe: number;
  clan: number;
  target: number;
  strength: number;
  x: number;
  y: number;
  /** 'out' heading to the enemy, 'home' going back. */
  leg: 'out' | 'home';
}

export interface SimEvent {
  day: number;
  text: string;
  x?: number;
  y?: number;
}

export interface SimState {
  /** Days since the simulation began. */
  day: number;
  seed: number;
  /** Set up (tribes being placed) or running. */
  started: boolean;
  tribes: Tribe[];
  clans: Clan[];
  sorties: Sortie[];
  nextId: number;
  /** The grid the fields live on (the climate's points when they were made). */
  w: number;
  h: number;
  /** The clan claiming each point (−1 for none); a rival clan's use builds up toward taking it. */
  owner: Int32Array;
  rival: Int32Array;
  rivalUse: Float32Array;
  /** Beast densities, 0–1 of what the land can carry, per beast (library id). */
  beasts: Record<string, Float32Array>;
  events: SimEvent[];
  /** The races taking part and how many starting tribes each (for placing again). */
  setup: { race: string; tribes: number }[];
}

export const yearOf = (day: number) => Math.floor(day / DAYS_PER_YEAR) + 1;
export const monthOf = (day: number) => Math.floor(day / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
/** The date, plainly (the calendar's own names can come with cultures). */
export function dateText(day: number): string {
  return `Day ${(day % DAYS_PER_MONTH) + 1}, month ${monthOf(day) + 1}, year ${yearOf(day)}`;
}
/** Months 4–9 are the northern summer half of the year; the southern hemisphere has it the other way round. */
export const northernSummer = (day: number) => {
  const m = monthOf(day);
  return m >= 3 && m <= 8;
};
