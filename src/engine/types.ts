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
  /** Minimum distance in tiles between settlements. */
  settlementSpacing: number;
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
  /** A road from a settlement to its nation's hub (largest settlement). */
  hub?: boolean;
  /** Whether goods moved along it last year: only within a nation. */
  kind: 'internal' | 'closed';
}

export type TradeKind = 'internal' | 'caravan' | 'convoy';

/** What a nation lets another nation's traders do. */
export type AccessPolicy = 'open' | 'tolled' | 'transit' | 'closed';

export type CaravanKind = 'merchant' | 'family' | 'nomad' | 'convoy';

export interface Cargo {
  good: number;
  qty: number;
  /** Value per unit where it was loaded. */
  cost: number;
}

/**
 * Anything that carries goods across the map: free traders (merchant caravans, trading-family
 * caravans, nomad caravan tribes) and state convoys running a trade agreement.
 */
export interface Caravan {
  id: number;
  kind: CaravanKind;
  name: string;
  /** Settlement the caravan belongs to. */
  homeId: number;
  polityId: number;
  houseId: number;
  dealId: number;
  fromId: number;
  toId: number;
  path: number[];
  /** Index of the tile the caravan is on, and where it was last month (for smooth drawing). */
  step: number;
  prevStep: number;
  cargo: Cargo[];
  /** Pack animals, wagons or ships' holds. */
  size: number;
  /** Value it can carry at base prices. */
  capacity: number;
  /** Coin carried to buy with. */
  purse: number;
  tripCost: number;
  /** Nomads wander several markets before going home. */
  legs: number;
  returning: boolean;
  started: number;
}

/** A merchant family whose caravans grow with its fortune. */
export interface TradingHouse {
  id: number;
  name: string;
  homeId: number;
  wealth: number;
  founded: number;
  closed: number | null;
  trips: number;
}

/** A trade route in use by free traders or convoys (roads are separate). */
export interface TradeRoute {
  a: number;
  b: number;
  path: number[];
  kind: 'caravan' | 'convoy';
  volume: number;
  lastYear: number;
}

export interface Army {
  id: number;
  name: string;
  polityId: number;
  warId: number;
  /** Soldiers in the field. */
  size: number;
  raised: number;
  tile: number;
  /** Settlement it marches on, or -1 when hunting an enemy army. */
  targetSettlement: number;
  targetArmy: number;
  path: number[];
  step: number;
  /** Tile at the start of the month, for smooth drawing. */
  prevTile: number;
  /** Months spent besieging the current target. */
  siege: number;
  victories: number;
  /** Month (year * 12 + month) of its last field battle. */
  fought: number;
  alive: boolean;
}

export interface TradeAgreement {
  id: number;
  /**
   * market: open borders to each other's free traders, no tolls.
   * transit: a (grantor) lets b's traders cross its lands.
   * convoy: a state deal; a sends giveQty of giveGood to b each year, b pays in getGood or coin.
   */
  type: 'market' | 'transit' | 'convoy';
  name: string;
  a: number;
  b: number;
  start: number;
  end: number | null;
  goods: string[];
  endReason?: string;
  giveGood?: number;
  giveQty?: number;
  getGood?: number;
  getQty?: number;
  /** Coin paid per year instead of goods. */
  coin?: number;
  /** Convoy road between the two hubs, re-surveyed now and then. */
  route?: number[];
  routeYear?: number;
}

/** Aggregated modifiers from a culture's environmental traits. */
export interface TraitEffects {
  production: Partial<Record<SectorKey, number>>;
  habitat: Partial<Record<BiomeKey, number>>;
  famineResist: number;
  plagueResist: number;
  military: number;
  defense: number;
  tradeCapacity: number;
  foodNeed: number;
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
  /** Value traded last year by kind. */
  tradeByKind: Record<TradeKind, number>;
  /** Value of caravan goods passing through last year. */
  transit: number;
  /** Prices a year ago, for market trends. */
  lastPrice: Float64Array;
  /** Loyalty to the nation that holds it, 0..1. Low loyalty breeds revolt and defection. */
  loyalty: number;
  /** Noble house holding it as a fief (-1: held directly by the crown). */
  holder: number;
  /** Nations with a claim on it (they held it once), by the year they lost it. */
  claims: Record<number, number>;
  /** Linked to its capital through friendly land or sea. */
  connected: boolean;
  /** Years it has been cut off from its capital. */
  cutOff: number;
  /** Share of its surroundings held by hostile powers, 0..1. */
  surrounded: number;
  /** Year it came under its current nation. */
  heldSince: number;
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
  /** Environmental adaptations the people have developed (trait ids). */
  traits: string[];
  /** Progress towards (or away from) each trait, 1 = earned. */
  exposure: Record<string, number>;
  traitEffects: TraitEffects;
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
  /** Noble house the ruler belongs to. */
  houseId?: number;
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
  /** Largest settlement: the hub internal trade and roads converge on. */
  hubId: number;
  /** Partner polity id -> agreement ids (market, transit, convoy). */
  agreements: Map<number, number[]>;
  /** How this nation treats each other nation's traders (default tolled). */
  policy: Map<number, AccessPolicy>;
  /** Nations whose trade this nation blocks from passing through. */
  embargoes: Set<number>;
  /** National totals last year per good. */
  produced: Float64Array;
  needed: Float64Array;
  imported: Float64Array;
  /** 1 where the nation cannot meet its own needs. */
  deficit: Uint8Array;
  /** Share of a foreign caravan's sales taken at the border. */
  tariff: number;
  tariffIncome: number;
  /** Ruling dynasty (noble house id), -1 before there is a nobility. */
  dynasty: number;
  /** Marriage ties and alliances (pact ids). */
  pacts: Set<number>;
  confederation: number;
  /** Overlord nation if this is a vassal, else -1. */
  overlord: number;
  /** How content a vassal is with its overlord, 0..1. */
  vassalLoyalty: number;
  /** War tribute owed: to whom, how much a year, and until when. */
  tributeTo: number;
  tributeAmount: number;
  tributeUntil: number;
}

export interface NobleHouse {
  id: number;
  name: string;
  polityId: number;
  /** Settlement the house rules from. */
  seatId: number;
  prestige: number;
  loyalty: number;
  /** How hungry for power its head is, 0..1. */
  ambition: number;
  head: string;
  founded: number;
  extinct: number | null;
  /** Settlements held last year. */
  fiefs: number;
}

/** Marriage ties between ruling houses and defensive alliances. */
export interface Pact {
  id: number;
  type: 'marriage' | 'alliance';
  name: string;
  a: number;
  b: number;
  start: number;
  end: number | null;
  endReason?: string;
  /** Ruling houses joined by a marriage. */
  houseA?: number;
  houseB?: number;
}

/** Nations that stay independent but stand together under one banner. */
export interface Confederation {
  id: number;
  name: string;
  members: number[];
  leader: number;
  founded: number;
  dissolved: number | null;
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
  /** Set when this war was joined to honour an alliance. */
  parent?: number;
  /** Settlement the war is chiefly fought over, and why. */
  goal?: number;
  cause?: string;
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
  | 'milestone'
  | 'agreement'
  | 'army'
  | 'caravan'
  | 'road'
  | 'house'
  | 'nobility'
  | 'diplomacy'
  | 'defection';

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
  coinTrade: number;
  barterTrade: number;
  caravans: number;
  armies: number;
}
