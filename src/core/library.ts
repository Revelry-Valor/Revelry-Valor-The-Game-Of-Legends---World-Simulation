/**
 * The library (REDESIGN.md, 8.2–8.3 and SPECIES.md): the data the simulation reads, made in the
 * creators: traits, resources, sentient species and their races, and beasts. One shared library
 * lives on the device; each world starts with a copy of it and may change its copy freely.
 */

/** The race stat block, as in the author's sheet (Human is the yardstick). */
export const STAT_KEYS = ['health', 'armor', 'strength', 'agility', 'constitution', 'willpower', 'intelligence', 'wisdom', 'mana', 'stamina', 'speed', 'flying', 'climbing', 'leaping', 'swimming'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_NAMES: Record<StatKey, string> = {
  health: 'Health',
  armor: 'Natural armour',
  strength: 'Strength',
  agility: 'Agility',
  constitution: 'Constitution',
  willpower: 'Willpower',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  mana: 'Mana',
  stamina: 'Stamina',
  speed: 'Speed',
  flying: 'Flying',
  climbing: 'Climbing',
  leaping: 'Leaping',
  swimming: 'Swimming',
};
/** What each stat becomes in the simulation (SPECIES.md, "How the stats translate"). */
export const STAT_HINTS: Partial<Record<StatKey, string>> = {
  health: 'Toughness: how much harm it takes to bring one down.',
  armor: 'Hide, scales, bark or stone.',
  willpower: 'Morale: how long troops hold before breaking.',
  intelligence: 'Learning and technology speed.',
  wisdom: 'Leadership, judgement, diplomacy.',
  mana: 'Power level of hero mages.',
  stamina: 'How long they can march or work before resting.',
  speed: 'Marching speed: 30 (Human) is an ordinary day’s march.',
  flying: 'Flying speed (0 = cannot fly). Flyers cross layers and impassable ground.',
  climbing: 'Climbing (0 = cannot). Helps in mountains and trees.',
  leaping: 'Leaping.',
  swimming: 'Swimming (0 = cannot).',
};
export type Stats = Record<StatKey, number | null>;
export const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Giant'] as const;
export type Size = (typeof SIZES)[number];

export const emptyStats = (): Stats => Object.fromEntries(STAT_KEYS.map((k) => [k, null])) as Stats;
/** The sum of the stats (as the sheet's Total), or null while any is missing. */
export function statTotal(s: Stats): number | null {
  let t = 0;
  for (const k of STAT_KEYS) {
    if (s[k] === null || s[k] === undefined) return null;
    t += s[k]!;
  }
  return t;
}

/** What a trait can change, for the simulation to read. */
export const EFFECT_TARGETS = [
  ...STAT_KEYS.map((k) => STAT_NAMES[k]),
  'Lifespan (%)',
  'Offspring (%)',
  'Food needs (%)',
  'Learning speed (%)',
  'Heat tolerance',
  'Cold tolerance',
  'Altitude tolerance',
  'Mana sensitivity',
  'Digs tunnels',
  'Crosses high mountains',
  'Flies between layers',
  'Lives in trees',
  'Breathes water',
  'Sees in the dark',
  'Herds animals',
  'Seafaring',
] as const;

export interface Trait {
  id: string;
  name: string;
  description: string;
  /** Who can have it. */
  for: ('sentient' | 'beast')[];
  /** What it changes: a target and an amount (points, percent, or 1 for yes). */
  effects: { target: string; amount: number }[];
}

export const RESOURCE_CATEGORIES = ['Food', 'Plant', 'Animal product', 'Wood', 'Stone', 'Metal', 'Gem', 'Mineral', 'Luxury', 'Rift and mana'] as const;
export const RESOURCE_SOURCES = ['Farmed', 'Gathered', 'Hunted', 'Herded', 'Fished', 'Mined', 'Quarried', 'Logged', 'Crafted', 'Rift'] as const;
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Very rare'] as const;
export const TERRAINS = ['Lowland', 'Hills', 'Mountains', 'Coast', 'Sea', 'Rivers and lakes', 'Volcanic', 'Underdark', 'Rift'] as const;

export interface Resource {
  id: string;
  name: string;
  category: string;
  source: string;
  rarity: string;
  description: string;
  /** Where it is found: climate zones (indices into ZONE_INFO), ground covers and kinds of terrain. */
  climates: number[];
  covers: string[];
  terrain: string[];
}

export const LIMBS = ['Arms', 'Legs', 'Wings', 'Tail', 'Hands', 'Claws', 'Talons', 'Hooves', 'Tentacles', 'Fins', 'Roots'] as const;
export const SENSES = ['Night vision', 'Keen sight', 'Keen smell', 'Keen hearing', 'Tremor sense', 'Echolocation', 'Mana sense'] as const;
export const MOVES = ['Walks', 'Climbs', 'Digs', 'Swims', 'Flies', 'Glides', 'Mountain-adapted', 'Tree-dwelling'] as const;
export const DIETS = ['Plants', 'Meat', 'Both', 'Special'] as const;
export const ACTIVE = ['Day', 'Night', 'Dusk and dawn', 'Any time'] as const;
export const LAYERS_PREF = ['Surface', 'Underdark', 'Trees', 'Sky'] as const;
export const ATTITUDES = ['Wary', 'Indifferent', 'Welcoming'] as const;
export const SOCIAL = ['Solitary', 'Family', 'Pack', 'Clan', 'Hive'] as const;
export const LIFESTYLES = ['Settled', 'Semi-nomadic', 'Nomadic'] as const;
export const BUILDING = ['Ground', 'Tunnel', 'Tree', 'Cliff', 'Sky', 'Water'] as const;
export const BEAST_USES = ['Food', 'Labour', 'Riding', 'Hunting help', 'Guarding', 'Hauling'] as const;
export const HERDING = ['Solitary', 'Pairs', 'Small groups', 'Herds', 'Swarms'] as const;

/** A creature's biology and where it lives: shared by a species' races, and by beasts. */
export interface Profile {
  build: string;
  limbs: string[];
  senses: string[];
  naturalWeapons: string;
  movement: string[];
  adulthood: number | null;
  offspring: number | null;
  birthEveryYears: number | null;
  diet: string;
  dietSpecial: string;
  active: string;
  /** Preferred climate zones (indices into ZONE_INFO), ground covers and mountain zones (0 lowland to 4 peaks). */
  climates: number[];
  covers: string[];
  mountainZones: number[];
  /** Tolerances, 1 (poor) to 5 (excellent). */
  heat: number | null;
  cold: number | null;
  wet: number | null;
  dry: number | null;
  altitude: number | null;
  layers: string[];
  needs: string;
  attitude: string;
  /** Per-species exceptions to the general attitude, and who they can have children with. */
  attitudes: { species: string; attitude: string }[];
  interbreeds: { species: string; result: string }[];
}

export interface Race {
  id: string;
  name: string;
  size: Size | null;
  stats: Stats;
  fightingAge: number | null;
  lifespan: number | null;
  affinity: string;
  affinity2: string;
  specialty: string;
  notes: string;
  /** Traits on top of the species', and species traits this race lacks. */
  addTraits: string[];
  removeTraits: string[];
  /** Overrides of the species' lifestyle and preferred climates (empty: as the species). */
  lifestyle: string;
  climates: number[];
}

export interface Species {
  id: string;
  name: string;
  /** Broad kind (Humanoid, Mammalian, Avian...). */
  kind: string;
  /** Set aside for later: kept, but not used by the simulation yet. */
  setAside: boolean;
  traits: string[];
  notes: string;
  profile: Profile;
  social: string;
  lifestyle: string;
  temperament: string;
  building: string[];
  /** Racial troop types (for specialized troops). */
  troops: string;
  races: Race[];
}

export interface Beast {
  id: string;
  name: string;
  kind: string;
  size: Size | null;
  stats: Stats;
  lifespan: number | null;
  traits: string[];
  notes: string;
  profile: Profile;
  uses: string[];
  resources: string[];
  herding: string;
  /** 1 (easy) to 5 (very hard). */
  hunting: number | null;
  domestication: number | null;
}

// ---- Technology (REDESIGN.md 8.4f): fields of levelled lines, not eras ----

export const TECH_FIELDS = ['Food and land', 'Materials and crafts', 'Building', 'Travel', 'Knowledge', 'Commerce', 'War', 'Rift and mana lore', 'Steam', 'Mana tech'] as const;
export const PLACES = ['Sea or lake', 'Rivers', 'Forest', 'Giant trees', 'Grassland', 'Hills', 'Mountains', 'Desert', 'Cold lands', 'Volcanic', 'Underdark', 'Rift', 'Sky'] as const;

export interface Tech {
  id: string;
  name: string;
  field: string;
  description: string;
  /** Known by every people from the start. */
  start: boolean;
  /** Technologies needed first. */
  requires: string[];
  /** Resources it needs to hand (bronze needs copper and tin), and places (sailing needs water). */
  resources: string[];
  places: string[];
  /** What drives its discovery: the practice that leads to it, and the need that pushes it. */
  practice: string;
  need: string;
  /** 1 (easy) to 5 (very hard). */
  difficulty: number | null;
  /** What it makes possible: buildings, goods, troops, abilities. */
  unlocks: string;
}

// ---- Culture (REDESIGN.md 8.4e): pillars, traditions with severity, specialties, learned behaviours ----

export const ETHOS = ['Warlike', 'Communal', 'Mystic', 'Commercial', 'Spiritual', 'Stoic', 'Egalitarian', 'Courtly', 'Inventive'] as const;
export const MARTIAL = ['Men fight', 'Women fight', 'Everyone fights', 'A warrior caste', 'None (others fight for them)'] as const;
export const CULTURE_LIFESTYLES = ['Settled', 'Nomadic', 'Seafaring', 'Tree-dwelling', 'Underground', 'Sky-dwelling'] as const;
export const TRADITION_CATEGORIES = ['Land and living', 'Outsiders', 'War', 'Work and trade', 'Society', 'Belief and lore'] as const;
export const BEHAVIOUR_CATEGORIES = ['Law and rule', 'Land and food', 'Work and trade', 'War', 'Building and travel', 'Society and lore'] as const;
export const HOLD = ['', 'Encouraged', 'Locked'] as const;

/** A tradition: earned by living a certain way long enough, held at a severity. */
export interface Tradition {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Its degrees, mildest first, each with what it means. */
  levels: { name: string; description: string }[];
  /** What it takes to earn it: in words, and the places or beasts it needs. */
  conditions: string;
  places: string[];
  beasts: string[];
  effects: string;
}

/** A learned behaviour (the culture tree): spreads by practice, need and contact. */
export interface Behaviour {
  id: string;
  name: string;
  category: string;
  description: string;
  requires: string[];
  /** Technologies it needs, and technologies it pushes forward. */
  needsTech: string[];
  pushesTech: string[];
  unlocks: string;
}

export interface Culture {
  id: string;
  name: string;
  /** Pillars: heritage (species and races, and the ancestral group), language, ethos, martial custom, lifestyles. */
  species: string[];
  races: string[];
  ancestry: string;
  language: string;
  /** The language's sounds: word parts and example names, for naming places later. */
  sounds: string;
  ethos: string;
  martial: string;
  lifestyles: string[];
  /** About six traditions, each at a level; story cultures can lock or encourage them. */
  traditions: { id: string; level: number; hold: string }[];
  /** Shared memories and their customs: flavour outside the six. */
  specialties: { name: string; description: string }[];
  /** Learned behaviours it starts with. */
  behaviours: string[];
  /** The government it prefers (the government creator comes later), and how firmly. */
  government: string;
  governmentHold: string;
  notes: string;
}

export interface Library {
  format: number;
  traits: Trait[];
  resources: Resource[];
  species: Species[];
  beasts: Beast[];
  techs: Tech[];
  behaviours: Behaviour[];
  traditions: Tradition[];
  cultures: Culture[];
}

export const LIBRARY_FORMAT = 1;

export const emptyProfile = (): Profile => ({
  build: '',
  limbs: [],
  senses: [],
  naturalWeapons: '',
  movement: [],
  adulthood: null,
  offspring: null,
  birthEveryYears: null,
  diet: '',
  dietSpecial: '',
  active: '',
  climates: [],
  covers: [],
  mountainZones: [],
  heat: null,
  cold: null,
  wet: null,
  dry: null,
  altitude: null,
  layers: [],
  needs: '',
  attitude: '',
  attitudes: [],
  interbreeds: [],
});

export const newRace = (id: string, name: string): Race => ({ id, name, size: null, stats: emptyStats(), fightingAge: null, lifespan: null, affinity: '', affinity2: '', specialty: '', notes: '', addTraits: [], removeTraits: [], lifestyle: '', climates: [] });
export const newSpecies = (id: string, name: string, kind = ''): Species => ({ id, name, kind, setAside: false, traits: [], notes: '', profile: emptyProfile(), social: '', lifestyle: '', temperament: '', building: [], troops: '', races: [newRace(`${id}.1`, name)] });
export const newBeast = (id: string, name: string): Beast => ({ id, name, kind: '', size: null, stats: emptyStats(), lifespan: null, traits: [], notes: '', profile: emptyProfile(), uses: [], resources: [], herding: '', hunting: null, domestication: null });
export const newTrait = (id: string, name: string): Trait => ({ id, name, description: '', for: ['sentient', 'beast'], effects: [] });
export const newResource = (id: string, name: string): Resource => ({ id, name, category: '', source: '', rarity: 'Common', description: '', climates: [], covers: [], terrain: [] });
export const newTech = (id: string, name: string, field = ''): Tech => ({ id, name, field, description: '', start: false, requires: [], resources: [], places: [], practice: '', need: '', difficulty: null, unlocks: '' });
export const newTradition = (id: string, name: string): Tradition => ({ id, name, category: '', description: '', levels: [{ name: 'Mild', description: '' }, { name: 'Strong', description: '' }, { name: 'Extreme', description: '' }], conditions: '', places: [], beasts: [], effects: '' });
export const newBehaviour = (id: string, name: string): Behaviour => ({ id, name, category: '', description: '', requires: [], needsTech: [], pushesTech: [], unlocks: '' });
export const newCulture = (id: string, name: string): Culture => ({ id, name, species: [], races: [], ancestry: '', language: '', sounds: '', ethos: '', martial: '', lifestyles: [], traditions: [], specialties: [], behaviours: [], government: '', governmentHold: '', notes: '' });

/** How deep a technology sits in its tree: 0 for those needing nothing, then one more than its deepest requirement. */
export function techTiers(techs: Tech[]): Map<string, number> {
  const byId = new Map(techs.map((t) => [t.id, t]));
  const tier = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (tier.has(id)) return tier.get(id)!;
    const t = byId.get(id);
    if (!t || seen.has(id)) return 0;
    seen.add(id);
    const v = t.requires.length ? 1 + Math.max(...t.requires.map((r) => visit(r, seen))) : 0;
    seen.delete(id);
    tier.set(id, v);
    return v;
  };
  for (const t of techs) visit(t.id, new Set());
  return tier;
}

/** What a race still lacks before the simulation can use it (empty when complete). */
export function raceMissing(r: Race): string[] {
  const out: string[] = [];
  if (!r.size) out.push('size');
  const stats = STAT_KEYS.filter((k) => r.stats[k] === null || r.stats[k] === undefined);
  if (stats.length) out.push(stats.length === STAT_KEYS.length ? 'all stats' : stats.map((k) => STAT_NAMES[k].toLowerCase()).join(', '));
  if (r.fightingAge === null) out.push('fighting age');
  if (r.lifespan === null) out.push('lifespan');
  return out;
}

/** A unique id from a name. */
export function makeId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// ---- Keeping data whole: anything missing or damaged in a saved library falls back to defaults ----

const arr = <T>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => x !== null) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown) => arr(v, (x) => (typeof x === 'string' ? x : null));
const nums = (v: unknown) => arr(v, (x) => (typeof x === 'number' ? x : null));

function readStats(v: unknown): Stats {
  const o = (v ?? {}) as Record<string, unknown>;
  return Object.fromEntries(STAT_KEYS.map((k) => [k, num(o[k])])) as Stats;
}
function readProfile(v: unknown): Profile {
  const o = (v ?? {}) as Record<string, unknown>;
  const p = emptyProfile();
  for (const k of ['build', 'naturalWeapons', 'diet', 'dietSpecial', 'active', 'needs', 'attitude'] as const) p[k] = str(o[k]);
  for (const k of ['limbs', 'senses', 'movement', 'covers', 'layers'] as const) p[k] = strs(o[k]);
  for (const k of ['climates', 'mountainZones'] as const) p[k] = nums(o[k]);
  for (const k of ['adulthood', 'offspring', 'birthEveryYears', 'heat', 'cold', 'wet', 'dry', 'altitude'] as const) p[k] = num(o[k]);
  p.attitudes = arr(o.attitudes, (x) => (x && typeof x === 'object' ? { species: str((x as Record<string, unknown>).species), attitude: str((x as Record<string, unknown>).attitude) } : null));
  p.interbreeds = arr(o.interbreeds, (x) => (x && typeof x === 'object' ? { species: str((x as Record<string, unknown>).species), result: str((x as Record<string, unknown>).result) } : null));
  return p;
}
const sizeOf = (v: unknown): Size | null => ((SIZES as readonly string[]).includes(v as string) ? (v as Size) : null);

/** A library from saved data, keeping what is whole. */
export function readLibrary(raw: unknown): Library {
  const o = (raw ?? {}) as Record<string, unknown>;
  const hasId = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).id === 'string';
  return {
    format: LIBRARY_FORMAT,
    traits: arr(o.traits, (x) => (hasId(x) ? { id: x.id as string, name: str(x.name), description: str(x.description), for: strs(x.for).filter((f) => f === 'sentient' || f === 'beast') as Trait['for'], effects: arr(x.effects, (e) => (e && typeof e === 'object' ? { target: str((e as Record<string, unknown>).target), amount: num((e as Record<string, unknown>).amount) ?? 0 } : null)) } : null)),
    resources: arr(o.resources, (x) => (hasId(x) ? { id: x.id as string, name: str(x.name), category: str(x.category), source: str(x.source), rarity: str(x.rarity) || 'Common', description: str(x.description), climates: nums(x.climates), covers: strs(x.covers), terrain: strs(x.terrain) } : null)),
    species: arr(o.species, (x) => {
      if (!hasId(x)) return null;
      return {
        id: x.id as string,
        name: str(x.name),
        kind: str(x.kind),
        setAside: x.setAside === true,
        traits: strs(x.traits),
        notes: str(x.notes),
        profile: readProfile(x.profile),
        social: str(x.social),
        lifestyle: str(x.lifestyle),
        temperament: str(x.temperament),
        building: strs(x.building),
        troops: str(x.troops),
        races: arr(x.races, (r) => (hasId(r) ? { id: r.id as string, name: str(r.name), size: sizeOf(r.size), stats: readStats(r.stats), fightingAge: num(r.fightingAge), lifespan: num(r.lifespan), affinity: str(r.affinity), affinity2: str(r.affinity2), specialty: str(r.specialty), notes: str(r.notes), addTraits: strs(r.addTraits), removeTraits: strs(r.removeTraits), lifestyle: str(r.lifestyle), climates: nums(r.climates) } : null)),
      };
    }),
    beasts: arr(o.beasts, (x) => (hasId(x) ? { id: x.id as string, name: str(x.name), kind: str(x.kind), size: sizeOf(x.size), stats: readStats(x.stats), lifespan: num(x.lifespan), traits: strs(x.traits), notes: str(x.notes), profile: readProfile(x.profile), uses: strs(x.uses), resources: strs(x.resources), herding: str(x.herding), hunting: num(x.hunting), domestication: num(x.domestication) } : null)),
    techs: arr(o.techs, (x) => (hasId(x) ? { id: x.id as string, name: str(x.name), field: str(x.field), description: str(x.description), start: x.start === true, requires: strs(x.requires), resources: strs(x.resources), places: strs(x.places), practice: str(x.practice), need: str(x.need), difficulty: num(x.difficulty), unlocks: str(x.unlocks) } : null)),
    behaviours: arr(o.behaviours, (x) => (hasId(x) ? { id: x.id as string, name: str(x.name), category: str(x.category), description: str(x.description), requires: strs(x.requires), needsTech: strs(x.needsTech), pushesTech: strs(x.pushesTech), unlocks: str(x.unlocks) } : null)),
    traditions: arr(o.traditions, (x) => (hasId(x) ? { id: x.id as string, name: str(x.name), category: str(x.category), description: str(x.description), levels: arr(x.levels, (l) => (l && typeof l === 'object' ? { name: str((l as Record<string, unknown>).name), description: str((l as Record<string, unknown>).description) } : null)), conditions: str(x.conditions), places: strs(x.places), beasts: strs(x.beasts), effects: str(x.effects) } : null)),
    cultures: arr(o.cultures, (x) => (hasId(x) ? { id: x.id as string, name: str(x.name), species: strs(x.species), races: strs(x.races), ancestry: str(x.ancestry), language: str(x.language), sounds: str(x.sounds), ethos: str(x.ethos), martial: str(x.martial), lifestyles: strs(x.lifestyles), traditions: arr(x.traditions, (t) => (t && typeof t === 'object' && typeof (t as Record<string, unknown>).id === 'string' ? { id: (t as Record<string, unknown>).id as string, level: num((t as Record<string, unknown>).level) ?? 0, hold: str((t as Record<string, unknown>).hold) } : null)), specialties: arr(x.specialties, (t) => (t && typeof t === 'object' ? { name: str((t as Record<string, unknown>).name), description: str((t as Record<string, unknown>).description) } : null)), behaviours: strs(x.behaviours), government: str(x.government), governmentHold: str(x.governmentHold), notes: str(x.notes) } : null)),
  };
}

export const cloneLibrary = (l: Library): Library => readLibrary(JSON.parse(JSON.stringify(l)));
