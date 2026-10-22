import type { Tech } from '../core/library';

/**
 * The starting technology tree (REDESIGN.md 8.4f): fields of levelled lines, from what every
 * people knows at the start up to steam, trains, airships and mechanized troops, with a separate
 * mana tech line alongside. All editable: add, change or remove anything.
 */
const T = (id: string, name: string, field: string, requires: string[], o: Partial<Tech> = {}): Tech => ({
  id,
  name,
  field,
  description: '',
  start: false,
  requires,
  resources: [],
  places: [],
  practice: '',
  need: '',
  difficulty: requires.length ? Math.min(5, 1 + Math.floor(requires.length / 2)) : 1,
  unlocks: '',
  ...o,
});
const F = 'Food and land';
const M = 'Materials and crafts';
const B = 'Building';
const V = 'Travel';
const K = 'Knowledge';
const C = 'Commerce';
const W = 'War';
const R = 'Rift and mana lore';
const S = 'Steam';
const N = 'Mana tech';

export const START_TECHS: Tech[] = [
  // Food and land
  T('foraging', 'Foraging', F, [], { start: true, description: 'Knowing which plants, roots and nuts feed you.', unlocks: 'Gathering' }),
  T('hunting', 'Hunting', F, [], { start: true, description: 'Tracking and bringing down game.', unlocks: 'Hunting grounds' }),
  T('fishing', 'Fishing', F, ['foraging'], { places: ['Sea or lake', 'Rivers'], practice: 'Living by water', unlocks: 'Fishing camps, fish' }),
  T('husbandry', 'Animal husbandry', F, ['hunting'], { practice: 'Following and penning herds', need: 'Game running short', description: 'Keeping animals: each beast still has its own domestication difficulty.', unlocks: 'Herding, livestock, wool, milk' }),
  T('agriculture', 'Agriculture', F, ['foraging'], { practice: 'Tending wild plants', need: 'Too many mouths for foraging', unlocks: 'Farms, grain, settling down' }),
  T('preserving', 'Preserving', F, ['hunting', 'fishing'], { resources: ['salt'], practice: 'Drying, salting and smoking', need: 'Lean seasons', unlocks: 'Food that keeps through winter' }),
  T('irrigation', 'Irrigation', F, ['agriculture'], { places: ['Rivers'], practice: 'Farming by rivers', need: 'Dry growing seasons', unlocks: 'Canals, farming dry land by rivers' }),
  T('plough', 'The plough', F, ['agriculture', 'husbandry'], { unlocks: 'Bigger, heavier fields' }),
  T('crop-rotation', 'Crop rotation', F, ['plough'], { need: 'Tired fields', unlocks: 'Higher yields' }),
  T('breeding', 'Selective breeding', F, ['husbandry'], { unlocks: 'Better herds and mounts' }),
  T('fungus-farming', 'Fungus farming', F, ['foraging'], { places: ['Underdark', 'Forest'], practice: 'Living in caves or deep forest', unlocks: 'Fungus farms' }),
  T('canopy-farming', 'Canopy and bark farming', F, ['foraging'], { places: ['Giant trees'], practice: 'Living in giant trees', unlocks: 'Farms in the canopy' }),
  // Materials and crafts
  T('stone-tools', 'Stone tools', M, [], { start: true, unlocks: 'Tools, spears, knives' }),
  T('fire', 'Fire', M, [], { start: true, unlocks: 'Cooking, warmth, firing clay' }),
  T('pottery', 'Pottery', M, ['fire'], { resources: ['clay'], unlocks: 'Pots, storage, kilns' }),
  T('weaving', 'Weaving', M, ['foraging'], { unlocks: 'Cloth, baskets, nets, sails' }),
  T('tanning', 'Tanning', M, ['hunting'], { unlocks: 'Leather' }),
  T('copper', 'Copper working', M, ['fire'], { resources: ['copper'], practice: 'Firing ores', unlocks: 'Copper tools and ornaments' }),
  T('bronze', 'Bronze working', M, ['copper'], { resources: ['copper', 'tin'], unlocks: 'Bronze tools, weapons and armour' }),
  T('iron', 'Iron working', M, ['bronze'], { resources: ['iron'], need: 'Tin running short', unlocks: 'Iron tools and weapons' }),
  T('steel', 'Steel', M, ['iron'], { resources: ['iron', 'coal'], unlocks: 'Steel tools, weapons and springs' }),
  T('glass', 'Glassmaking', M, ['pottery'], { resources: ['sand'], unlocks: 'Glass, lenses' }),
  T('clockwork', 'Clockwork', M, ['steel', 'mathematics'], { difficulty: 4, unlocks: 'Clocks, automata, fine mechanisms' }),
  // Building
  T('timber-framing', 'Timber framing', B, ['stone-tools'], { resources: ['hardwood'], unlocks: 'Halls, longhouses' }),
  T('mudbrick', 'Mudbrick', B, ['pottery'], { unlocks: 'Brick houses and walls' }),
  T('masonry', 'Masonry', B, ['mudbrick'], { resources: ['stone'], unlocks: 'Stone buildings and walls' }),
  T('tunnels', 'Tunnel building', B, ['stone-tools'], { places: ['Hills', 'Mountains'], practice: 'Digging', unlocks: 'Tunnels, underground halls, travel tunnels' }),
  T('cliff-building', 'Cliff building', B, ['masonry'], { places: ['Mountains'], unlocks: 'Cliff dwellings and mountainside towns' }),
  T('tree-building', 'Tree building', B, ['timber-framing'], { places: ['Giant trees'], unlocks: 'Settlements in giant trees' }),
  T('fortification', 'Fortification', B, ['masonry'], { need: 'War', unlocks: 'Stone walls, castles' }),
  T('roads', 'Paved roads', B, ['masonry'], { unlocks: 'Better roads' }),
  T('bridges', 'Stone bridges', B, ['masonry', 'engineering'], { unlocks: 'Bridges over wide rivers and gorges' }),
  T('aqueducts', 'Aqueducts', B, ['masonry', 'mathematics'], { unlocks: 'Water for big cities' }),
  T('sky-docks', 'Sky docks', B, ['airships'], { places: ['Sky'], unlocks: 'Docks for airships' }),
  // Travel
  T('rafts', 'Rafts and canoes', V, ['stone-tools'], { places: ['Sea or lake', 'Rivers'], unlocks: 'River and coastal travel' }),
  T('sailing', 'Sailing', V, ['rafts', 'weaving'], { places: ['Sea or lake'], unlocks: 'Sailing ships along coasts' }),
  T('navigation', 'Navigation', V, ['sailing', 'astronomy'], { unlocks: 'Crossing open sea' }),
  T('ocean-ships', 'Ocean ships', V, ['navigation', 'iron'], { unlocks: 'Large seagoing ships' }),
  T('riding', 'Riding', V, ['husbandry'], { description: 'Needs a beast that can be ridden (each mount species tamed in its own right).', unlocks: 'Mounts, faster travel' }),
  T('wheel', 'The wheel', V, ['timber-framing'], { unlocks: 'Carts and wagons' }),
  T('carts', 'Wagons and caravans', V, ['wheel', 'husbandry'], { unlocks: 'Overland trade caravans' }),
  T('flight-gear', 'Flight gear', V, ['clockwork', 'weaving'], { difficulty: 4, unlocks: 'Gliders and wings for those who can’t fly' }),
  // Knowledge
  T('counting', 'Counting', K, [], { start: true, unlocks: 'Tallies' }),
  T('writing', 'Writing', K, ['counting'], { need: 'Keeping records', unlocks: 'Written records, written law' }),
  T('mathematics', 'Mathematics', K, ['writing'], { unlocks: 'Measurement, building plans' }),
  T('astronomy', 'Astronomy', K, ['mathematics'], { unlocks: 'Calendars, star navigation' }),
  T('medicine', 'Medicine', K, ['writing'], { resources: ['herbs'], unlocks: 'Healers, fewer deaths from sickness' }),
  T('libraries', 'Libraries and archives', K, ['writing'], { description: 'Lets a nation keep a tech library, so knowledge outlives the settlements that held it.', unlocks: 'Libraries, archives, academies' }),
  T('engineering', 'Engineering', K, ['mathematics', 'masonry'], { unlocks: 'Great buildings, machines, siege engines' }),
  T('alchemy', 'Alchemy', K, ['mathematics', 'glass'], { unlocks: 'Acids, dyes, powders' }),
  T('printing', 'Printing', K, ['clockwork', 'libraries'], { unlocks: 'Books, faster spread of knowledge' }),
  // Commerce
  T('barter', 'Barter', C, [], { start: true, unlocks: 'Trade between peoples' }),
  T('coinage', 'Coinage', C, ['copper', 'writing'], { unlocks: 'Coins, markets' }),
  T('banking', 'Banking', C, ['coinage', 'mathematics'], { unlocks: 'Loans, merchant houses' }),
  T('trade-companies', 'Trade companies', C, ['banking', 'ocean-ships'], { unlocks: 'Far trade, chartered companies' }),
  // War
  T('spears', 'Spears', W, [], { start: true, unlocks: 'Spearmen' }),
  T('bows', 'Bows', W, ['stone-tools'], { unlocks: 'Archers' }),
  T('bronze-arms', 'Bronze weapons and armour', W, ['bronze'], { unlocks: 'Armoured troops' }),
  T('iron-arms', 'Iron weapons', W, ['iron'], { unlocks: 'Better-armed troops' }),
  T('steel-arms', 'Steel weapons and armour', W, ['steel'], { unlocks: 'Heavy infantry, plate' }),
  T('cavalry', 'Cavalry', W, ['riding'], { unlocks: 'Mounted troops' }),
  T('siege', 'Siege engines', W, ['engineering'], { unlocks: 'Rams, catapults, siege towers' }),
  T('crossbows', 'Crossbows', W, ['steel', 'engineering'], { unlocks: 'Crossbowmen' }),
  T('gunpowder', 'Gunpowder', W, ['alchemy'], { resources: ['sulfur', 'saltpeter', 'coal'], difficulty: 4, unlocks: 'Powder, bombs' }),
  T('firearms', 'Firearms', W, ['gunpowder', 'steel'], { unlocks: 'Musketeers' }),
  T('cannons', 'Cannons', W, ['gunpowder', 'iron'], { unlocks: 'Artillery, gun ships' }),
  // Rift and mana lore (knowledge of them, not a magic system)
  T('mana-lore', 'Mana lore', R, [], { start: true, description: 'Knowing where mana gathers and thins.', unlocks: 'Finding dense mana' }),
  T('rift-lore', 'Rift lore', R, ['mana-lore'], { places: ['Rift'], practice: 'Living near rifts', unlocks: 'Understanding rift tides' }),
  T('ley-mapping', 'Ley line mapping', R, ['mana-lore', 'astronomy'], { unlocks: 'Charting ley lines and nodes' }),
  T('rift-warding', 'Rift warding', R, ['rift-lore', 'masonry'], { unlocks: 'Wards and watch-forts on rifts' }),
  T('rift-materials', 'Working rift materials', R, ['rift-lore', 'iron'], { resources: ['rift-iron'], unlocks: 'Rift iron and other rift goods' }),
  // Steam (the top of the tree)
  T('steam-engine', 'Steam engine', S, ['steel', 'engineering'], { resources: ['coal'], difficulty: 5, unlocks: 'Steam power, pumps, mills' }),
  T('railways', 'Railways and trains', S, ['steam-engine', 'roads'], { resources: ['iron', 'coal'], difficulty: 5, unlocks: 'Trains' }),
  T('steamships', 'Steamships', S, ['steam-engine', 'ocean-ships'], { unlocks: 'Steam-driven ships' }),
  T('airships', 'Airships', S, ['steam-engine', 'weaving', 'navigation'], { difficulty: 5, unlocks: 'Airships (with sky docks)' }),
  T('mechanized', 'Mechanized troops', S, ['railways', 'firearms'], { difficulty: 5, unlocks: 'Mechanized infantry and war vehicles' }),
  // Mana tech (alongside steam)
  T('mana-working', 'Mana crystal working', N, ['rift-lore', 'clockwork'], { resources: ['mana-crystal'], difficulty: 4, unlocks: 'Mana-charged devices' }),
  T('mana-engine', 'Mana engine', N, ['mana-working', 'engineering'], { resources: ['mana-crystal'], difficulty: 5, unlocks: 'Mana power in place of steam' }),
  T('mana-rail', 'Mana rail', N, ['mana-engine', 'roads'], { difficulty: 5, unlocks: 'Mana-driven trains' }),
  T('mana-airships', 'Mana airships', N, ['mana-engine', 'weaving', 'navigation'], { difficulty: 5, unlocks: 'Mana-lifted airships' }),
  T('mana-arms', 'Mana weapons', N, ['mana-engine', 'steel-arms'], { difficulty: 5, unlocks: 'Mana-charged arms and war machines' }),
];
