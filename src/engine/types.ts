import type { WaterPlan } from './water';
import type { ReliefField } from './erosion';
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
  /**
   * How readily this people gives up wandering for a settled life: 'settled' peoples settle as soon
   * as farming or a rich site makes it pay, 'seminomadic' ones take longer, 'nomadic' ones hardly
   * ever, unless boxed in by settled lands. Missing = settled.
   */
  lifestyle?: Lifestyle;
}

export type Lifestyle = 'settled' | 'seminomadic' | 'nomadic';

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
  /** How peoples begin: as wandering bands of hunters and gatherers, or already settled in villages. */
  start?: 'bands' | 'settlements';
  /** Latitude of the map's top and bottom edges, in degrees (north positive). */
  latNorth?: number;
  latSouth?: number;
  /** Tilt of the world's axis in degrees: more tilt, harsher seasons and milder poles. */
  axialTilt?: number;
  /** Wind-driven ocean currents carrying warm and cold water along the coasts. */
  oceanCurrents?: boolean;
  /** Land shaped by hand in the world editor: heights encoded with encodeHeights(); replaces the generated land. */
  heightmap?: string;
  /** The land shaped by hand in the editor, on the fine grid it is carved on (see encodeRelief). */
  relief?: string;
  /** How the land is carved into terrain (see erodeRelief); unset settings take TERRAIN_DEFAULTS. */
  terrain?: {
    mountains?: number;
    erosion?: number;
    softness?: number;
    downcutting?: number;
    /** Rivers, as Gaea's Rivers node (see RIVER_DEFAULTS). */
    riverWater?: number;
    riverWidth?: number;
    riverDepth?: number;
    riverDowncutting?: number;
  };
  /** Carve the land at the tiles' own resolution: a quick, coarser preview (the world editor while you draw). */
  terrainPreview?: boolean;
  /** Rivers and lakes drawn by hand in the world editor. When set, the world has only these (no rivers or lakes of its own). */
  water?: WaterPlan;
  /** Where rivers must rise, in tiles: painted with the world editor's River source tool. */
  riverSources?: [number, number][];
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
  /** The shape of the land before lakes were filled in: what the world editor works on. */
  heights: Float32Array;
  /** Latitude of each row, in degrees (north positive). */
  latitude: Float32Array;
  /** Surface ocean current at each sea tile (tiles per step, east and south positive), and how much warmer or colder than usual the water it brings is. */
  currentU: Float32Array;
  currentV: Float32Array;
  seaAnomaly: Float32Array;
  biome: Uint8Array;
  relief: Uint8Array;
  /** Clan (tribe id) whose hunting grounds each tile is, -1 if unclaimed. */
  claim: Int32Array;
  /** Who holds each tile by force in a war still being fought: a nation id, a clan as clanCode (-2 and below), or -1. */
  occupier: Int32Array;
  /** Accumulated river discharge (0 when no river). */
  river: Float32Array;
  landmass: Int32Array;
  /** 1 for land tiles touching sea or lake. */
  coastal: Uint8Array;
  /** One Float32Array per natural resource (see Res). */
  resources: Float32Array[];
  moveCost: Float32Array;
  /** Settlement working the tile (the nearest within its ring of land), -1 if none. */
  owner: Int32Array;
  /** Settlement id sitting on the tile, -1 if none. */
  settlementAt: Int32Array;
  /**
   * Settlement whose realm each tile falls in: the nearest settlement within reach. This is what
   * nations hold, what the map shows and where borders run. (A settlement's working land, \`owner\`,
   * is only ever used inside the simulation.)
   */
  region: Int32Array;
  /** How worn the wild land is by bands hunting, gathering and grazing on it, 0..1; it recovers over time. */
  pressure: Float32Array;
  /** What the owning settlement uses each tile for (LandUse). */
  landUse: Uint8Array;
  /** Emergent road quality from trade traffic, 0..3. */
  road: Float32Array;
  /** Recent trade traffic (decaying). */
  traffic: Float32Array;
  riverThreshold: number;
  /** The land as carved into terrain, finer than the tiles (what the map is painted from). */
  carved?: ReliefField;
  /** The rivers as smooth curves along the carved valleys (see traceRivers). */
  riverCurves?: Float32Array;
  /** Hand-drawn rivers' courses, in tiles (x, y pairs), in the order they were drawn. */
  riverPaths?: Float32Array[];
  /** Hand-set lakes: water level, and the level their hollow spills at. */
  lakeInfo?: { level: number; spill: number; bottom: number }[];
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

/** A tribe: bands of one people under one chief and council, a nation once it settles. */
export interface Tribe {
  id: number;
  name: string;
  baseName: string;
  cultureId: number;
  color: string;
  founded: number;
  /** Year its last band settled or vanished. */
  dissolved: number | null;
  /** Nation it founded or joined by settling (-1 while it still only wanders). */
  polityId: number;
  /** What its people know, before they have a nation to know it for them. */
  techs: Set<string>;
  progress: Map<string, number>;
  /** Tribe it split from, -1 for the first tribes of a people. */
  parentId: number;
  /** Clans it has fought over land, with the year of the last fight. */
  feuds: Record<number, number>;
  /** Fights over hunting grounds won and lost. */
  wins: number;
  losses: number;
}

/** A band: one wandering group of a tribe, following its food through the seasons. */
export interface Band {
  id: number;
  name: string;
  tribeId: number;
  cultureId: number;
  races: Record<string, number>;
  pop: number;
  /** Hunting and gathering, or following herds. */
  way: 'foragers' | 'herders';
  tile: number;
  /** Where it is heading (its next seasonal ground), and the path there. */
  ground: number;
  path: number[];
  step: number;
  prevStep: number;
  /** Food carried and stored. */
  food: number;
  /** Months it went short this year and last. */
  hungry: number;
  lastHungry: number;
  founded: number;
  lastSplit: number;
  alive: boolean;
  /** Centre of the home range it has made its own (-1 while it is still searching for good land). */
  home: number;
  /** Years spent searching for a home range. */
  searching: number;
  /** Year it made its home range. */
  homeSince: number;
  /** Whether its clan's land around home is too little to feed it, so it claims more as it goes. */
  landHungry: boolean;
}

/**
 * A war over land between two powers, at least one of them a clan (wars between nations are Wars).
 * Sides are written as a nation id, or a clan as clanCode (-2 and below).
 */
export interface LandWar {
  id: number;
  name: string;
  attacker: number;
  defender: number;
  /** Month it was declared (year * 12 + month), and when it ended. */
  start: number;
  end: number | null;
  /** Centre of the land fought over. */
  aim: number;
  battles: number;
  attackerWins: number;
  defenderWins: number;
  attackerLosses: number;
  defenderLosses: number;
  /** Warbands each side has sent out. */
  raisedA: number;
  raisedB: number;
  outcome: string | null;
}

/** Where a warband's fighters came from, so the survivors go home to the right place. */
export interface WarbandSource {
  kind: 'band' | 'settlement';
  id: number;
  /** The clan a tribe belongs to, so survivors can join kin if their own tribe is gone. */
  clan: number;
  n: number;
}

/** A warband: the fighters of a clan's tribes or of an early settlement, out to take or hold land. */
export interface Warband {
  id: number;
  name: string;
  warId: number;
  /** Side it fights for (nation id, or clanCode). */
  side: number;
  size: number;
  raised: number;
  sources: WarbandSource[];
  /** Where it set out from and goes back to. */
  home: number;
  tile: number;
  target: number;
  path: number[];
  step: number;
  prevStep: number;
  /** Out to fight, or going home. */
  homeward: boolean;
  months: number;
  alive: boolean;
}

/** A column of settlers on its way to found a new settlement. */
export interface SettlerParty {
  id: number;
  /** Settlement they set out from. */
  fromId: number;
  polityId: number;
  cultureId: number;
  races: Record<string, number>;
  people: number;
  /** Tile they mean to settle. */
  targetTile: number;
  /** Whether the new settlement stays under the home nation. */
  joins: boolean;
  path: number[];
  step: number;
  prevStep: number;
  /** Month they set out. */
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
  /** The tile it stands on (the simulation keeps its books per tile). */
  x: number;
  y: number;
  /** Where exactly it stands on the land, in map coordinates (the tile's centre is x + 0.5). */
  px: number;
  py: number;
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
  /** Workers with no work this year. */
  idle: number;
  /** People living in the town at its heart rather than on the land: craftsmen, merchants and officials, with their families. */
  urbanPop: number;
  /** Settlement whose market it trades through (its own id if it is a market itself). */
  marketId: number;
  /** Tiles of its land built over as City. */
  cityTiles: number;
  /** How far it is packed beyond what it can hold in comfort (0 = comfortable). */
  crowding: number;
  /** What its buildings are made of (a key of BUILDINGS). */
  buildings: string;
  /** Last full year's accounts, good by good: made, used, bought and sold. */
  yearMade: Float64Array;
  yearUsed: Float64Array;
  yearBought: Float64Array;
  yearSold: Float64Array;
  /** Food paid in tribute to the capital this year and last (or, for the capital, received). */
  tributePaid: number;
  yearTributePaid: number;
  yearTributeIn: number;
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
  /** Size class (index into TIERS), with some slack before it drops a size. Its land is the ring around it whatever its size. */
  tier: number;
  /** Production capacity of each extraction sector, from the tiles put to its use and the common land around. */
  sectorCap: Float64Array;
  /** How hard each extraction sector's land was worked last year (workers' output over capacity; -1 if it has no land). */
  sectorPressure: Float64Array;
  /** Race-specific habitat food bonus summed over the territory. */
  habitat: number;
  /** Food received as tribute last year (capitals only). */
  tributeIn: number;
  /** Value traded last year by kind. */
  tradeByKind: Record<TradeKind, number>;
  /** Value of caravan goods passing through last year. */
  transit: number;
  /** Best price its goods would fetch at the markets it trades with, after carriage. */
  exportPrice: Float64Array;
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
  /** Food still to come in this year, by month: the harvest in autumn, game and fish all year. */
  foodSchedule: Float64Array;
  /** Food eaten and needed so far this year (the year's food ratio is their quotient). */
  foodEaten: number;
  foodNeeded: number;
  /** Months this year when the stores ran short, and how many last year. */
  hungryMonths: number;
  lastHungry: number;
  /** Enemy nation occupying it in wartime (-1 if none); it changes hands only at the peace. */
  occupiedBy: number;
  /** Month the occupation began. */
  occupiedSince: number;
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
  /** Progress towards every technology it is working its way to, by tech id. */
  progress: Map<string, number>;
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
  /** Who won (-1 for neither), set at the peace. */
  winner?: number;
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
  | 'defection'
  | 'tribe';

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
  /** People living in wandering bands, and how many bands. */
  wanderers?: number;
  bands?: number;
}
