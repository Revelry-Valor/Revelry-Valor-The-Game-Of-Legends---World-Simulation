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
  /** Its faith (a live faith id). */
  faith?: string;
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
  /** What its tribes know beyond survival (library tech ids). */
  techs?: string[];
  /** Years it has lived far from its culture's heartland with no ties back (toward a culture of its own). */
  drift?: number;
  /** How it is ruled (Phase 9): every clan is a realm, from a band under its chief to an empire. */
  realm?: Realm;
}

/** A ruler: a name, a house (the ruling line), and when they were born and came to rule. */
export interface Ruler {
  name: string;
  house: string;
  female: boolean;
  born: number;
  since: number;
}

/**
 * How a clan is ruled (REDESIGN.md 8.4a–c): its government (a Library government id), its capital,
 * its ruler, and how centralized it is (0–1: its real ability to make its orders felt).
 */
export interface Realm {
  gov: string;
  since: number;
  /** The capital (a settlement id), or −1 for a realm with no settlements. */
  capital: number;
  centralization: number;
  ruler: Ruler;
  /** Rulers so far of this realm (for the list of its reigns). */
  reigns: number;
  /** The ruler's children (the royal family), heirs where rule is handed down. */
  family?: Royal[];
  /** Those pressing a claim to the throne, with how much of the realm backs them (0–1). */
  claimants?: Claimant[];
  /** Treaties it broke without cause (remembered by everyone; fades slowly). */
  betrayals?: number;
  /** Its heroes and generals at home (they go out with its armies). */
  heroes?: Hero[];
}

/** Fighters by kind. */
export interface Units {
  foot?: number;
  archers?: number;
  riders?: number;
  specialists?: number;
}

/** A notable individual of war: a general, a god's champion, or a hero risen in battle. */
export interface Hero {
  name: string;
  kind: 'general' | 'champion' | 'hero';
  /** 1 (able) … 5 (legendary). */
  power: number;
  born: number;
  /** Battles won and duels. */
  deeds: number;
  female: boolean;
  god?: string;
}

/** A battle's full report (Phase 10 step 2). */
export interface BattleReport {
  ground: string;
  sides: { label: string; clan: number; units: Units; heroes: string[]; specialists: string }[];
  phases: { name: string; text: string; lost: [Units, Units] }[];
  notes: string[];
  outcome: string;
}

/** A member of a ruling family. */
export interface Royal {
  name: string;
  house: string;
  female: boolean;
  born: number;
}

/** A claimant to a throne: a rival heir, or the true line put aside. */
export interface Claimant extends Royal {
  /** Why they claim it: a passed-over child, or the old line. */
  why: 'heir' | 'true line' | 'marriage';
  backing: number;
  since: number;
}

/** A treaty between two realms (REDESIGN.md 8.5). */
export interface Pact {
  kind: 'peace' | 'defence' | 'trade' | 'marriage';
  since: number;
  /** Shared roads and bridges between the capitals, as a term (trade and defence pacts). */
  roads?: boolean;
}

/** How two realms stand: opinion (−1 … 1), remembered deeds, their treaties. */
export interface RealmRelation {
  opinion: number;
  /** Remembered wars, betrayals, gifts and help (fades slowly; grudges slower). */
  memory: number;
  pacts: Pact[];
  /** A defender's ally takes up its quarrel until this day. */
  hostileUntil?: number;
  /** Who last attacked whom, and when (for telling a justified break from a betrayal). */
  lastAttack?: { by: number; day: number };
  /** Attacks this year (only the first few sour memory further). */
  hits?: number;
  /** No war between them until this day (a truce after a war). */
  truceUntil?: number;
}

/** Why a war is fought (REDESIGN.md 8.5, reasons for war). */
export type WarReason = 'claim' | 'throne' | 'holy' | 'revenge' | 'liberate' | 'conquest';

/** A war between realms (Phase 10). Score is from the attackers' side (−100 … 100). */
export interface War {
  id: number;
  name: string;
  reason: WarReason;
  /** The realms that began it and that it was begun against (each side's leader first). */
  attackers: number[];
  defenders: number[];
  /** What the attackers want: a town (claim, holy site, kin to free), or a claimant's throne. */
  goalTown?: number;
  goalHouse?: string;
  started: number;
  score: number;
  /** War weariness by realm (0 … 1, at 1 it must make peace). */
  weariness: Record<number, number>;
  battles: number;
  /** Fighters each side has lost. */
  losses: { attackers: number; defenders: number };
  ended?: number;
  outcome?: string;
}

/** A named army in the field. */
export interface Army {
  id: number;
  name: string;
  clan: number;
  war: number;
  x: number;
  y: number;
  /** Fighters, and how many it set out with. */
  men: number;
  raised: number;
  /** 0 … 1.2: breaks below about 0.3. */
  morale: number;
  /** Food carried, in units (one feeds one fighter a month). */
  supply: number;
  /** Where its fighters came from (settlement id → men), to send them home. */
  from: Record<number, number>;
  /** What it is doing: marching on a town (attack or relieve), hunting an enemy army, or going home. */
  goal: 'attack' | 'defend' | 'home';
  target: number;
  general: string;
  /** Days spent investing a town before the assault, and the day it last fought. */
  siege?: { town: number; days: number };
  lastFight?: number;
  /** Its fighters by kind (sums to men), what its specialists are, and its heroes. */
  units?: Units;
  specialists?: string;
  heroes?: Hero[];
  /** Fighting a battle until this day (it holds where it is). */
  engagedUntil?: number;
}

/** A battle, for the map and the war's record (the full phased report comes with step 2). */
export interface Battle {
  id: number;
  war: number;
  name: string;
  x: number;
  y: number;
  day: number;
  /** The armies' realms and fighters before and after. */
  a: { clan: number; army: string; men: number; lost: number };
  b: { clan: number; army: string; men: number; lost: number };
  winner: number;
  /** A town assaulted (its garrison fought). */
  town?: number;
  /** The fighting goes on until this day; then the full report is known. */
  until?: number;
  report?: BattleReport;
}

/** A spy: a notable individual travelling town to town to reach a target. */
export interface Spy {
  id: number;
  name: string;
  from: number;
  /** The realm and town targeted. */
  against: number;
  target: number;
  mission: 'steal' | 'unrest' | 'sabotage' | 'watch';
  x: number;
  y: number;
  leg: 'out' | 'home';
}

/**
 * A settlement: people who stay in one place. A dawn city is where a race first woke, holy to all
 * of that race wherever they are; it grows, sends out tribes and founds villages, and can fall to
 * ruin (still holy) and be rebuilt. Villages are the settlements it (or another) founds.
 */
export interface Settlement {
  id: number;
  name: string;
  kind: 'dawn' | 'village';
  clan: number;
  species: string;
  race: string;
  culture: string;
  x: number;
  y: number;
  pop: number;
  fed: number;
  /** Its fighters, who stay to guard it. */
  warband: number;
  /** The races it is holy to (a dawn city: the race that woke there, for good). */
  holyTo: string[];
  ruined: boolean;
  founded: number;
  ruinedOn: number;
  /** Its economy (Phase 7): what it has in store and how its workers are split (both in units). */
  economy?: Economy;
  /** Technologies it knows beyond those every people starts with (library ids). */
  techs?: string[];
  /** Its archive (with Libraries and archives) keeps what it knows from being forgotten; burned in a raid, it is lost until this day. */
  archiveBurnedUntil?: number;
  /** Fights and famines lately (for the need that drives discovery). */
  hardship?: { famine: number; war: number };
  /** Drawn toward another culture (a big neighbour's, or the many small ones round it): how far along (0–1). */
  cultureShift?: { to: string; progress: number };
  /** How firmly its realm's orders reach it (0–1; the capital 1), from distance, ways and centralization. */
  control?: number;
  /** Its loyalty to its realm (0–1), and the years it has been discontented. */
  loyalty?: number;
  unrest?: number;
  /** Its faith (a live faith id), and whether it is being drawn to another. */
  faith?: string;
  faithShift?: { to: string; progress: number };
  /** Held by an enemy in a war: who, for which war, since when, and the men left to hold it. */
  occupied?: { by: number; war: number; since: number; garrison: number };
  /** Realms that once held it (a claim to take it back). */
  claimedBy?: number[];
}

/**
 * A settlement's economy, counted in units: one unit of a food feeds one (Medium) person for a
 * month; one unit of anything else meets one person's need of it for a month.
 */
export interface Economy {
  /** What is kept, by resource id. */
  stores: Record<string, number>;
  /** Workers by job: 'farm:<crop>', 'fish:<id>', 'herd:<id>', 'gather', 'hunt', or a resource id for the rest. */
  jobs: Record<string, number>;
  /** What was made last month, by resource id. */
  made: Record<string, number>;
  /** The crop growing this season (units, harvested at summer's end) and what it is. */
  crop: number;
  cropId: string;
  /** Farmers set at sowing for the year (they stay in the fields all season). */
  farmers?: number;
  /** The last harvest: units brought in, and how good the year was (1 = usual). */
  harvest: { units: number; year: number; day: number } | null;
  /** How well its needs beyond food (fuel, shelter, clothing, salt) were met last month, 0–1. */
  comfort: number;
  /** Its market (step 2): what each good is worth here now, in the one currency (a unit of staple food at ease is about 1). */
  prices?: Record<string, number>;
  /** Materials kept back for building and keeping up ways next year, by kind ('wood', 'stone' or a resource id); not traded away. */
  reserve?: Record<string, number>;
  /** People away with a caravan (not working at home). */
  away?: number;
  /** Trade over the last year, in worth: sent out and brought in. */
  traded?: { out: number; in: number; caravans: number; since: number };
}

/** A caravan: traders (and their pack animals) carrying goods to another settlement, bartering there, and coming home. */
export interface Caravan {
  id: number;
  from: number;
  to: number;
  clan: number;
  x: number;
  y: number;
  leg: 'out' | 'home';
  /** Goods carried, in units. */
  cargo: Record<string, number>;
  people: number;
  animals: number;
  speed: number;
  /** Worth (at home prices) of what it set out with. */
  worth: number;
  started: number;
  /** A train: the whole way is railway (faster, carries far more, burns coal). */
  train?: boolean;
}

/** A trade route between two settlements: how often it is used and how much goes along it. */
export interface Route {
  a: number;
  b: number;
  trips: number;
  worth: number;
  last: number;
  /** Trips at the start of this year (so the year's trips are trips − mark). */
  mark?: number;
}

/**
 * A culture living in the world (Phase 8 step 2): a Library culture brought to life, or a folk
 * culture grown from its people's homeland and way of life. Its traditions are earned by living
 * a certain way for generations and fade when that life ends; its learned behaviours spread by
 * practice, need and contact.
 */
export interface LiveCulture {
  id: string;
  name: string;
  /** The Library culture it comes from ('' for a folk culture). */
  source: string;
  /** Heritage: the species and races it began with. */
  species: string[];
  races: string[];
  language: string;
  /** Word parts for names ("ka-", "-dor"). */
  sounds: string;
  ethos: string;
  martial: string;
  lifestyles: string[];
  /** Traditions at a level (index into the tradition's levels; −1 while it is only taking root), with progress toward the next change (−1 … 1). */
  traditions: { id: string; level: number; hold: string; progress: number }[];
  specialties: { name: string; description: string }[];
  behaviours: string[];
  founded: number;
  /** The culture it grew from, if any (or the two it blended from). */
  parent: string;
  blend?: string[];
  /** Its colour on the map of cultures. */
  colour?: string;
  /** This year's doings, for the traditions they earn. */
  stats?: { fights: number; raids: number; foreignTrade: number; famines: number; lastFight: number };
}

/** Bad blood: a race against another (for raiding its holy place), until a day. */
export interface Grudge {
  race: string;
  against: string;
  until: number;
}

/** How a race begins: scattered tribes, a dawn city, or both. */
export type StartKind = 'tribes' | 'dawn' | 'both';

/** A warband away from its tribe: going to fight, or coming home. */
export interface Sortie {
  id: number;
  tribe: number;
  clan: number;
  target: number;
  /** What it is going to fight: a tribe, or a settlement (a raid). */
  targetKind?: 'tribe' | 'settlement';
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

/** A holy site of a faith: a place on the map; holding it strengthens the faith, losing it hurts. */
export interface HolySite {
  name: string;
  kind: string;
  x: number;
  y: number;
  held: boolean;
}

/**
 * A faith living in the world (Phase 9 step 3): a Library faith, or the folk belief a people
 * begins with. Organization grows with its followers' towns and learning; fervour rises with holy
 * sites held and the gods' deeds and falls with losses and age.
 */
export interface LiveFaith {
  id: string;
  name: string;
  /** The Library faith it is ('' for a folk belief or one grown during the run). */
  source: string;
  nature: string[];
  tenets: { id: string; level: number }[];
  /** How it sees other faiths (Tolerant … Hostile). */
  tolerance: string;
  leader: string;
  /** 0 loose (local shamans), 1 gathering (shrines), 2 organized (temples, priesthood), 3 hierarchy (a head of faith); and how far it can grow. */
  organization: number;
  maxOrganization: number;
  gods: string[];
  /** Story faiths: Locked (followers never leave it) or Encouraged (they hold to it firmly). */
  hold: string;
  founded: number;
  /** The faith it split from (a heresy or reformation), or the two it blended from. */
  parent: string;
  blend?: string[];
  colour?: string;
  /** Fervour, 0–1. */
  fervour: number;
  holySites: HolySite[];
  /** Where its head of faith sits (a settlement id), once it has one. */
  seat: number;
}

/** A god's champion: a notable individual raised up in a realm, for a time. */
export interface Champion {
  name: string;
  god: string;
  clan: number;
  since: number;
  until: number;
}

/** A prophecy: a god foretold a ruling house's fall; fate (and the god) see to it. */
export interface Prophecy {
  god: string;
  clan: number;
  house: string;
  until: number;
}

export interface SimState {
  /** Days since the simulation began. */
  day: number;
  seed: number;
  /** Set up (tribes being placed) or running. */
  started: boolean;
  tribes: Tribe[];
  settlements: Settlement[];
  /** The cultures alive in the world (clans, tribes and settlements name theirs by id). */
  cultures?: LiveCulture[];
  /** Between each pair of cultures ("a|b", ids in order): acceptance (−1 hostile … 1 close), this year's fights and trade, and years lived side by side. */
  relations?: Record<string, { acc: number; fights: number; trades: number; together: number }>;
  caravans: Caravan[];
  routes: Route[];
  /** How much people, herds and caravans travel over each point (for trails and roads; fades slowly). */
  traffic: Float32Array;
  /** Who first came to each technology, and when. */
  firsts?: Record<string, { day: number; by: string }>;
  /** The way at each point: 0 none, 1 trail, 2 cart track, 3 paved road, 4 railway (ways.ts). */
  way: Uint8Array;
  /** The settlement that built and keeps the way there (−1: none, for trails). */
  wayKeeper: Int32Array;
  /** Bridges (1) over rivers; elsewhere a river is forded (slow). */
  bridge?: Uint8Array;
  /** Between each pair of realms ("a|b", clan ids in order). */
  realmRelations?: Record<string, RealmRelation>;
  spies?: Spy[];
  /** The faiths alive in the world, the gods' champions and prophecies, and when each god last acted. */
  faiths?: LiveFaith[];
  champions?: Champion[];
  prophecies?: Prophecy[];
  godActs?: Record<string, number>;
  /** Wars (going on and past), armies in the field, and battles fought. */
  wars?: War[];
  armies?: Army[];
  battles?: Battle[];
  /** The world's setting for the gods (copied in from the world settings before each run). */
  gods?: { active: boolean; activity: number };
  grudges: Grudge[];
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
  setup: SetupRow[];
}

/** One race's start: how, how many tribes, and how many people in its dawn city. */
export interface SetupRow {
  race: string;
  tribes: number;
  start?: StartKind;
  cityPop?: number;
  /** What its first tribes and dawn city know beyond survival. */
  techs?: string[];
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
