import type { BiomeKey } from './data/biomes';
import type { SectorKey } from './data/economy';
import type { TechCategory, TechEffects } from './data/techs';

export interface CultureValues {
  /** Readiness to wage war and glorify martial deeds. */
  militarism: number;
  /** Interest in trade and profit. */
  mercantilism: number;
  /** Devotion to gods, spirits and ritual. */
  piety: number;
  /** Appetite for new ideas and research. */
  curiosity: number;
  /** Distrust of outsiders and other cultures. */
  xenophobia: number;
  /** Resistance to change and assimilation. */
  tradition: number;
  /** Affinity for the sea. */
  seafaring: number;
  /** Drive to found new settlements. */
  expansionism: number;
}
export const VALUE_KEYS: (keyof CultureValues)[] = [
  'militarism', 'mercantilism', 'piety', 'curiosity', 'xenophobia', 'tradition', 'seafaring', 'expansionism',
];

export type Government = 'tribe' | 'chiefdom' | 'city-state' | 'kingdom' | 'empire' | 'republic' | 'theocracy';

export interface Phonemes {
  onsets: string[];
  vowels: string[];
  codas: string[];
  settlementSuffixes: string[];
  minSyllables: number;
  maxSyllables: number;
}

export interface RaceDef {
  id: string;
  name: string;
  plural: string;
  adjective: string;
  color: string;
  description: string;
  /** Maximum natural population growth per year (0.025 = 2.5%). */
  growth: number;
  /** Food consumed per person per year (1 = human baseline). */
  foodNeed: number;
  /** Typical lifespan in years (affects rulers' reigns). */
  lifespan: number;
  /** Preference for each biome, -1 (hostile) .. 1 (ideal). Missing = 0. */
  biomes: Partial<Record<BiomeKey, number>>;
  relief: { flat: number; hills: number; mountains: number };
  /**
   * Extra food this people can coax from particular biomes that others find barren
   * (dwarven terrace and fungus farms, elven forest gardens...), in fertility-equivalents per tile.
   */
  habitat?: Partial<Record<BiomeKey, number>>;
  /** Preference for sea coast and rivers, -1..1. */
  coastal: number;
  river: number;
  /** Combat strength multiplier. */
  military: number;
  /** Resistance to famine and disease deaths, 0..0.9 (optional). */
  hardiness?: number;
  /** Per-sector productivity multipliers. */
  production: Partial<Record<SectorKey, number>>;
  /** Research speed multipliers per tech category. */
  research: Partial<Record<TechCategory, number>>;
  /** Starting cultural values; missing keys default to 0.5. */
  values: Partial<CultureValues>;
  phonemes: Phonemes;
  /** Optional polity-name templates by government; "{name}" is replaced. */
  titles?: Partial<Record<Government, string>>;
}

export interface WorldConfig {
  name: string;
  seed: number;
  width: number;
  height: number;
  /** Share of the map that is land, 0.2..0.8. */
  landFraction: number;
  /** Shifts global temperature, -0.3 (ice age) .. 0.3 (hothouse). */
  temperature: number;
  /** Shifts global rainfall, -0.3 .. 0.3. */
  moisture: number;
  /** Multiplier on mineral deposits. */
  resourceAbundance: number;
  /** 0 = no magic, 1 = low magic, 2 = high magic. */
  magic: number;
  /** Multiplier for plagues, disasters and monsters. */
  calamity: number;
  /** Number of separate homelands per race. */
  homelandsPerRace: number;
  /** Tribes that start in each homeland. */
  tribesPerHomeland: number;
  races: RaceDef[];
}

export interface MapData {
  width: number;
  height: number;
  size: number;
  /** -1..0 below sea level, 0..1 above. */
  elevation: Float32Array;
  temperature: Float32Array;
  moisture: Float32Array;
  biome: Uint8Array;
  relief: Uint8Array;
  /** Accumulated river discharge (0 when no river). */
  river: Float32Array;
  landmass: Int32Array;
  /** 1 for land tiles touching sea or lake. */
  coastal: Uint8Array;
  /** One Float32Array per natural resource (see Res). */
  resources: Float32Array[];
  moveCost: Float32Array;
  /** Settlement id owning the tile, -1 if unclaimed. */
  owner: Int32Array;
  /** Settlement id sitting on the tile, -1 if none. */
  settlementAt: Int32Array;
  /** Emergent road quality from trade traffic, 0..3. */
  road: Float32Array;
  /** Recent trade traffic (decaying). */
  traffic: Float32Array;
  riverThreshold: number;
}

export interface TradeLink {
  a: number;
  b: number;
  cost: number;
  path: number[];
  sea: boolean;
  /** Value traded along the link last year. */
  volume: number;
}

export interface Settlement {
  id: number;
  name: string;
  tile: number;
  x: number;
  y: number;
  founded: number;
  alive: boolean;
  abandoned: number | null;
  polityId: number;
  cultureId: number;
  parentId: number;
  /** Population by race id. */
  races: Record<string, number>;
  pop: number;
  /** Housing capacity (built infrastructure). */
  housing: number;
  stock: Float64Array;
  price: Float64Array;
  target: Float64Array;
  produced: Float64Array;
  consumed: Float64Array;
  imported: Float64Array;
  exported: Float64Array;
  labor: Float64Array;
  toolQuality: number;
  weaponQuality: number;
  wealth: number;
  stability: number;
  foodRatio: number;
  /** Climate yield factor this year. */
  climate: number;
  territory: number[];
  /** Sum of each natural resource over the territory. */
  resSum: Float64Array;
  /** Race-specific habitat food bonus summed over the territory. */
  habitat: number;
  /** Food received as tribute last year (capitals only). */
  tributeIn: number;
  coastal: boolean;
  river: boolean;
  landmass: number;
  links: number[];
  plague: number;
  immunity: number;
  /** Cultural divergence from the parent culture; a new culture splits off above 1. */
  drift: number;
  lastColonized: number;
  greatWorks: string[];
  peakPop: number;
}

export interface Culture {
  id: number;
  name: string;
  adjective: string;
  raceId: string;
  parentId: number;
  founded: number;
  alive: boolean;
  extinct: number | null;
  color: string;
  values: CultureValues;
  language: Phonemes;
  originSettlement: number;
}

export interface Ruler {
  name: string;
  title: string;
  raceId: string;
  born: number;
  since: number;
  until: number | null;
  traits: string[];
  fate?: string;
}

export interface Polity {
  id: number;
  name: string;
  baseName: string;
  government: Government;
  capitalId: number;
  cultureId: number;
  founded: number;
  alive: boolean;
  dissolved: number | null;
  color: string;
  techs: Set<string>;
  researching: string | null;
  researchProgress: number;
  effects: TechEffects;
  ruler: Ruler;
  pastRulers: Ruler[];
  relations: Map<number, number>;
  contacts: Map<number, number>;
  truces: Map<number, number>;
  wars: Set<number>;
  warExhaustion: number;
  treasury: number;
  settlementIds: number[];
  pop: number;
  military: number;
  stability: number;
  /** Goods the polity can obtain (produced, stocked or imported recently). */
  access: Uint8Array;
  popHistory: [number, number][];
  parentPolity: number;
}

export interface War {
  id: number;
  name: string;
  attacker: number;
  defender: number;
  start: number;
  end: number | null;
  outcome: string | null;
  battles: number;
  attackerLosses: number;
  defenderLosses: number;
  conquered: number[];
}

export type EventKind =
  | 'founding'
  | 'abandonment'
  | 'polity'
  | 'government'
  | 'ruler'
  | 'war'
  | 'battle'
  | 'conquest'
  | 'peace'
  | 'rebellion'
  | 'union'
  | 'technology'
  | 'culture'
  | 'migration'
  | 'plague'
  | 'famine'
  | 'disaster'
  | 'monster'
  | 'wonder'
  | 'trade'
  | 'milestone';

export interface HistoryEvent {
  year: number;
  kind: EventKind;
  /** 1 = minor, 2 = notable, 3 = major. */
  importance: number;
  text: string;
  settlements?: number[];
  polities?: number[];
  cultures?: number[];
  tile?: number;
}

export interface YearStats {
  year: number;
  population: number;
  settlements: number;
  polities: number;
  cultures: number;
  byRace: Record<string, number>;
  wars: number;
  tradeVolume: number;
}
