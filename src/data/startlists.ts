import { emptyProfile, STAT_KEYS, type Beast, type Resource, type Size, type Stats, type Trait } from '../core/library';

/**
 * The library's starting lists for traits, resources and beasts: ordinary, real-world entries
 * to build on, all editable and deletable. (The sentient peoples come from the author's roster.)
 *
 * Climate zones by number: 0 rainforest, 1 monsoon, 2 savanna, 3 hot desert, 4 cold desert,
 * 5 hot steppe, 6 cold steppe, 7 Mediterranean, 8 humid subtropical, 9 oceanic, 10 humid
 * continental, 11 subarctic, 12 tundra, 13 ice cap.
 */

const t = (id: string, name: string, description: string, forWho: Trait['for'], effects: [string, number][]): Trait => ({ id, name, description, for: forWho, effects: effects.map(([target, amount]) => ({ target, amount })) });
const S: Trait['for'] = ['sentient'];
const B: Trait['for'] = ['beast'];
const SB: Trait['for'] = ['sentient', 'beast'];

export const START_TRAITS: Trait[] = [
  t('tunneler', 'Tunneler', 'Digs tunnels and travels by them like roads; can build underground.', SB, [['Digs tunnels', 1]]),
  t('avian', 'Avian', 'Flies: crosses impassable ground and reaches the sky layers; lives and hunts from giant trees.', SB, [['Flies between layers', 1], ['Lives in trees', 1]]),
  t('mountain-born', 'Mountain-born', 'Crosses high mountains and settles on mountainsides.', SB, [['Crosses high mountains', 1], ['Altitude tolerance', 2]]),
  t('night-eyed', 'Night-eyed', 'Sees in the dark: active at night and at home underground.', SB, [['Sees in the dark', 1]]),
  t('long-lived', 'Long-lived', 'Lives far longer than most.', SB, [['Lifespan (%)', 100]]),
  t('fertile', 'Fertile', 'More children, sooner: grows fast.', SB, [['Offspring (%)', 40]]),
  t('hardy', 'Hardy', 'Shrugs off hardship, hunger and sickness.', SB, [['Constitution', 3], ['Stamina', 2]]),
  t('mana-sensitive', 'Mana-sensitive', 'Feels mana: drawn to dense mana, unsettled where it is thin.', S, [['Mana sensitivity', 1], ['Mana', 10]]),
  t('herd-keeper', 'Herd-keeper', 'Keeps and breeds herds well.', S, [['Herds animals', 1]]),
  t('seafarer', 'Seafarer', 'At home on the sea: fishing, sailing and sea trade come naturally.', S, [['Seafaring', 1], ['Swimming', 10]]),
  t('climber', 'Climber', 'Climbs cliffs and trees with ease.', SB, [['Climbing', 15]]),
  t('swimmer', 'Swimmer', 'Swims well and crosses rivers freely.', SB, [['Swimming', 20]]),
  t('tree-dweller', 'Tree-dweller', 'Lives in the canopy of giant trees.', SB, [['Lives in trees', 1]]),
  t('cold-adapted', 'Cold-adapted', 'Thrives in cold lands.', SB, [['Cold tolerance', 2], ['Heat tolerance', -1]]),
  t('heat-adapted', 'Heat-adapted', 'Thrives in hot lands.', SB, [['Heat tolerance', 2], ['Cold tolerance', -1]]),
  t('amphibious', 'Amphibious', 'Breathes water as well as air.', SB, [['Breathes water', 1], ['Swimming', 20]]),
  t('thick-hide', 'Thick hide', 'Hard to wound.', SB, [['Natural armour', 6]]),
  t('pack-hunter', 'Pack hunter', 'Hunts in packs: dangerous to herds and travellers.', B, [['Strength', 2]]),
  t('venomous', 'Venomous', 'A venomous bite or sting.', B, [['Strength', 4]]),
  t('burrower', 'Burrower', 'Lives in burrows.', B, [['Digs tunnels', 1]]),
];

const r = (id: string, name: string, category: string, source: string, rarity: string, climates: number[], covers: string[], terrain: string[], description: string): Resource => ({ id, name, category, source, rarity, description, climates, covers, terrain });
const TEMPERATE = [7, 8, 9, 10];
const TROPICS = [0, 1, 2];
const COLD = [11, 12];

export const START_RESOURCES: Resource[] = [
  r('grain', 'Grain', 'Food', 'Farmed', 'Common', [...TEMPERATE, 6, 5], ['grassland', 'steppe'], ['Lowland', 'Hills'], 'Wheat, barley and rye: the staple of most farming peoples.'),
  r('rice', 'Rice', 'Food', 'Farmed', 'Common', [0, 1, 8], ['marsh', 'grassland'], ['Lowland', 'Rivers and lakes'], 'Paddy farming on warm, wet, flat land.'),
  r('roots', 'Root crops', 'Food', 'Farmed', 'Common', [...TEMPERATE, 11, 1], [], ['Lowland', 'Hills'], 'Tubers and roots that grow where grain struggles.'),
  r('fruit', 'Fruit', 'Food', 'Gathered', 'Common', [...TROPICS, 7, 8], ['jungle', 'forest', 'savanna'], ['Lowland'], 'Orchards and wild fruit.'),
  r('olives', 'Olives', 'Food', 'Farmed', 'Uncommon', [7], ['scrub'], ['Lowland', 'Hills'], 'Oil for food, lamps and trade.'),
  r('grapes', 'Grapes', 'Food', 'Farmed', 'Uncommon', [7, 8], ['scrub', 'grassland'], ['Hills'], 'For wine.'),
  r('nuts', 'Nuts', 'Food', 'Gathered', 'Common', [...TEMPERATE], ['forest'], ['Lowland', 'Hills'], 'Forest food that keeps through winter.'),
  r('fish', 'Fish', 'Food', 'Fished', 'Common', [], [], ['Coast', 'Sea', 'Rivers and lakes'], 'Sea, river and lake fish.'),
  r('shellfish', 'Shellfish', 'Food', 'Fished', 'Common', [], ['beach'], ['Coast'], 'Gathered along shores and reefs.'),
  r('game', 'Game meat', 'Food', 'Hunted', 'Common', [], ['forest', 'taiga', 'grassland', 'savanna'], ['Lowland', 'Hills'], 'From wild animals.'),
  r('livestock', 'Livestock', 'Food', 'Herded', 'Common', [], ['grassland', 'steppe', 'savanna'], ['Lowland', 'Hills'], 'Meat and milk from herds.'),
  r('honey', 'Honey', 'Food', 'Gathered', 'Uncommon', [...TEMPERATE, ...TROPICS], ['forest', 'grassland'], ['Lowland'], 'From wild or kept bees; also wax.'),
  r('fungus', 'Fungus', 'Food', 'Farmed', 'Common', [], ['forest', 'jungle'], ['Underdark'], 'Mushrooms and cave fungus; grown in the dark.'),
  r('salt', 'Salt', 'Mineral', 'Mined', 'Uncommon', [3, 4], ['saltflats', 'beach'], ['Coast'], 'From salt flats, sea pans and rock salt: needed to keep food.'),
  r('spices', 'Spices', 'Luxury', 'Gathered', 'Rare', [0, 1], ['jungle'], ['Lowland'], 'Pepper, cinnamon and the like: carried far for trade.'),
  r('sugar', 'Sugar', 'Food', 'Farmed', 'Uncommon', [0, 1, 8], ['grassland'], ['Lowland'], 'Cane on hot, wet land.'),
  r('tea', 'Tea', 'Luxury', 'Farmed', 'Uncommon', [1, 8], ['forest'], ['Hills'], 'Leaves grown on warm, wet hills.'),
  r('cotton', 'Cotton', 'Plant', 'Farmed', 'Common', [1, 2, 5, 8], ['grassland', 'savanna'], ['Lowland'], 'For cloth.'),
  r('flax', 'Flax', 'Plant', 'Farmed', 'Common', [9, 10], ['grassland'], ['Lowland'], 'For linen and oil.'),
  r('herbs', 'Herbs', 'Plant', 'Gathered', 'Common', [], ['forest', 'grassland', 'scrub'], ['Lowland', 'Hills'], 'Medicine and flavour.'),
  r('dyes', 'Dyes', 'Plant', 'Gathered', 'Uncommon', [...TROPICS, 7], [], ['Lowland', 'Coast'], 'Plants, roots, lichens and sea snails for colour.'),
  r('reeds', 'Reeds', 'Plant', 'Gathered', 'Common', [], ['marsh'], ['Rivers and lakes'], 'Thatch, baskets and writing sheets.'),
  r('hardwood', 'Hardwood', 'Wood', 'Logged', 'Common', [...TEMPERATE], ['forest'], ['Lowland', 'Hills'], 'Oak and the like: ships, beams and tools.'),
  r('softwood', 'Softwood', 'Wood', 'Logged', 'Common', [10, 11], ['taiga', 'forest'], ['Lowland', 'Hills', 'Mountains'], 'Pine and fir: building timber, masts, pitch.'),
  r('exotic-wood', 'Exotic wood', 'Wood', 'Logged', 'Rare', [0, 1], ['jungle'], ['Lowland'], 'Dark, fine-grained tropical timber.'),
  r('stone', 'Building stone', 'Stone', 'Quarried', 'Common', [], [], ['Hills', 'Mountains'], 'For walls, roads and great buildings.'),
  r('marble', 'Marble', 'Stone', 'Quarried', 'Rare', [], [], ['Mountains', 'Hills'], 'Fine stone for temples and palaces.'),
  r('clay', 'Clay', 'Stone', 'Gathered', 'Common', [], [], ['Rivers and lakes', 'Lowland'], 'Bricks and pottery.'),
  r('sand', 'Glass sand', 'Mineral', 'Gathered', 'Common', [], ['dunes', 'beach'], ['Coast'], 'Pure sand for glass.'),
  r('copper', 'Copper', 'Metal', 'Mined', 'Uncommon', [], [], ['Hills', 'Mountains'], 'The first metal worked; with tin, bronze.'),
  r('tin', 'Tin', 'Metal', 'Mined', 'Rare', [], [], ['Hills', 'Mountains'], 'Scarce, and needed for bronze.'),
  r('iron', 'Iron', 'Metal', 'Mined', 'Common', [], [], ['Hills', 'Mountains', 'Rivers and lakes'], 'Tools and weapons once it can be smelted.'),
  r('lead', 'Lead', 'Metal', 'Mined', 'Uncommon', [], [], ['Hills', 'Mountains'], 'Pipes, weights and shot.'),
  r('silver', 'Silver', 'Metal', 'Mined', 'Rare', [], [], ['Mountains'], 'Coin and ornament.'),
  r('gold', 'Gold', 'Metal', 'Mined', 'Rare', [], [], ['Mountains', 'Rivers and lakes'], 'Coin, ornament and wealth.'),
  r('coal', 'Coal', 'Mineral', 'Mined', 'Uncommon', [], [], ['Hills', 'Lowland'], 'Fuel for forges and, later, steam.'),
  r('sulfur', 'Sulfur', 'Mineral', 'Mined', 'Uncommon', [], [], ['Volcanic'], 'For medicine, dyes and gunpowder.'),
  r('saltpeter', 'Saltpeter', 'Mineral', 'Gathered', 'Uncommon', [3, 4, 5], [], ['Lowland', 'Underdark'], 'For gunpowder.'),
  r('obsidian', 'Obsidian', 'Stone', 'Quarried', 'Uncommon', [], [], ['Volcanic'], 'Volcanic glass: blades and ornament.'),
  r('pumice', 'Pumice', 'Stone', 'Quarried', 'Common', [], [], ['Volcanic'], 'Light volcanic stone.'),
  r('gems', 'Gems', 'Gem', 'Mined', 'Very rare', [], [], ['Mountains', 'Volcanic'], 'Rubies, sapphires, emeralds.'),
  r('amber', 'Amber', 'Gem', 'Gathered', 'Rare', [9, 10, 11], ['forest', 'taiga', 'beach'], ['Coast'], 'Fossil resin washed up on cold coasts.'),
  r('pearls', 'Pearls', 'Gem', 'Fished', 'Rare', [0, 1, 2, 8], [], ['Sea', 'Coast'], 'From warm shallow seas.'),
  r('furs', 'Furs', 'Animal product', 'Hunted', 'Uncommon', [...COLD, 10], ['taiga', 'tundra', 'forest'], ['Lowland', 'Hills'], 'Warm, valuable pelts.'),
  r('leather', 'Leather', 'Animal product', 'Herded', 'Common', [], [], ['Lowland', 'Hills'], 'Hides, tanned.'),
  r('wool', 'Wool', 'Animal product', 'Herded', 'Common', [], ['grassland', 'steppe'], ['Hills', 'Mountains'], 'From sheep, goats, llamas and yaks.'),
  r('ivory', 'Ivory', 'Animal product', 'Hunted', 'Rare', [0, 2], ['savanna', 'jungle'], ['Lowland'], 'Tusks: carving and luxury.'),
  r('feathers', 'Feathers', 'Animal product', 'Herded', 'Common', [], [], ['Lowland'], 'Fletching, bedding and finery.'),
  r('horn', 'Horn', 'Animal product', 'Herded', 'Common', [], [], ['Lowland', 'Hills'], 'Bows, cups and tools.'),
  r('silk', 'Silk', 'Luxury', 'Farmed', 'Rare', [1, 8], ['forest'], ['Lowland'], 'From kept silkworms: the finest cloth.'),
  r('wine', 'Wine', 'Luxury', 'Crafted', 'Uncommon', [7, 8], [], ['Hills'], 'Made from grapes.'),
  r('incense', 'Incense', 'Luxury', 'Gathered', 'Rare', [3, 5], ['scrub', 'rockdesert'], ['Lowland', 'Hills'], 'Resins burned in temples.'),
  r('mana-crystal', 'Mana crystals', 'Rift and mana', 'Rift', 'Very rare', [], [], ['Rift'], 'Crystallised mana from rifts.'),
  r('rift-iron', 'Rift iron', 'Rift and mana', 'Rift', 'Very rare', [], [], ['Rift'], 'Iron changed by a rift: different, not always better.'),
];

const stats = (v: number[]): Stats => Object.fromEntries(STAT_KEYS.map((k, i) => [k, v[i] ?? 0])) as Stats;
interface BeastSpec {
  id: string;
  name: string;
  kind: string;
  size: Size;
  /** health, armour, strength, agility, constitution, willpower, intelligence, wisdom, mana, stamina, speed, flying, climbing, leaping, swimming */
  s: number[];
  life: number;
  diet: string;
  uses: string[];
  res: string[];
  herd: string;
  hunt: number;
  dom: number;
  climates: number[];
  covers: string[];
  zones?: number[];
  move?: string[];
  traits?: string[];
  notes?: string;
}
const b = (x: BeastSpec): Beast => ({
  id: x.id,
  name: x.name,
  kind: x.kind,
  size: x.size,
  stats: stats(x.s),
  lifespan: x.life,
  traits: x.traits ?? [],
  notes: x.notes ?? '',
  profile: { ...emptyProfile(), diet: x.diet, climates: x.climates, covers: x.covers, mountainZones: x.zones ?? [0, 1], movement: x.move ?? ['Walks'] },
  uses: x.uses,
  resources: x.res,
  herding: x.herd,
  hunting: x.hunt,
  domestication: x.dom,
});
const TEMP = [7, 8, 9, 10];
export const START_BEASTS: Beast[] = [
  b({ id: 'deer', name: 'Deer', kind: 'Mammal', size: 'Medium', s: [14, 0, 6, 14, 8, 3, 2, 4, 0, 8, 45, 0, 0, 15, 5], life: 15, diet: 'Plants', uses: ['Food'], res: ['game', 'leather', 'horn'], herd: 'Herds', hunt: 2, dom: 4, climates: [...TEMP, 11], covers: ['forest', 'taiga', 'grassland'] }),
  b({ id: 'boar', name: 'Wild boar', kind: 'Mammal', size: 'Medium', s: [18, 4, 10, 8, 12, 8, 2, 3, 0, 8, 35, 0, 0, 5, 5], life: 12, diet: 'Both', uses: ['Food'], res: ['game', 'leather'], herd: 'Small groups', hunt: 3, dom: 2, climates: [...TEMP, 1, 8], covers: ['forest'], notes: 'Tamed, it becomes the pig.' }),
  b({ id: 'pig', name: 'Pig', kind: 'Mammal', size: 'Medium', s: [16, 2, 8, 6, 12, 4, 2, 3, 0, 6, 25, 0, 0, 2, 5], life: 15, diet: 'Both', uses: ['Food'], res: ['livestock', 'leather'], herd: 'Small groups', hunt: 1, dom: 1, climates: [...TEMP, 1], covers: ['forest', 'grassland'] }),
  b({ id: 'wolf', name: 'Wolf', kind: 'Mammal', size: 'Medium', s: [14, 0, 10, 12, 10, 8, 3, 4, 0, 10, 45, 0, 0, 10, 5], life: 12, diet: 'Meat', uses: ['Hunting help'], res: ['furs'], herd: 'Small groups', hunt: 3, dom: 3, climates: [9, 10, 11, 12, 6], covers: ['forest', 'taiga', 'steppe', 'tundra'], traits: ['pack-hunter'], notes: 'Tamed, it becomes the dog.' }),
  b({ id: 'dog', name: 'Dog', kind: 'Mammal', size: 'Small', s: [10, 0, 6, 12, 8, 8, 3, 4, 0, 10, 40, 0, 0, 10, 5], life: 13, diet: 'Both', uses: ['Hunting help', 'Guarding', 'Hauling'], res: [], herd: 'Small groups', hunt: 1, dom: 1, climates: [], covers: [] }),
  b({ id: 'bear', name: 'Brown bear', kind: 'Mammal', size: 'Large', s: [40, 6, 20, 6, 16, 12, 3, 4, 0, 6, 35, 0, 10, 2, 10], life: 25, diet: 'Both', uses: ['Food'], res: ['furs', 'game'], herd: 'Solitary', hunt: 4, dom: 5, climates: [9, 10, 11], covers: ['forest', 'taiga'], zones: [0, 1, 2] }),
  b({ id: 'horse', name: 'Horse', kind: 'Mammal', size: 'Large', s: [25, 0, 14, 10, 14, 6, 3, 4, 0, 10, 60, 0, 0, 10, 5], life: 25, diet: 'Plants', uses: ['Riding', 'Hauling', 'Labour'], res: ['leather'], herd: 'Herds', hunt: 2, dom: 2, climates: [5, 6, 10, 9], covers: ['grassland', 'steppe'] }),
  b({ id: 'donkey', name: 'Donkey', kind: 'Mammal', size: 'Medium', s: [18, 0, 10, 6, 14, 8, 3, 4, 0, 10, 35, 0, 2, 2, 2], life: 30, diet: 'Plants', uses: ['Hauling', 'Labour', 'Riding'], res: ['leather'], herd: 'Small groups', hunt: 1, dom: 1, climates: [3, 5, 7], covers: ['scrub', 'steppe', 'rockdesert'] }),
  b({ id: 'cattle', name: 'Cattle', kind: 'Mammal', size: 'Large', s: [30, 2, 16, 4, 14, 6, 2, 3, 0, 8, 25, 0, 0, 2, 5], life: 20, diet: 'Plants', uses: ['Food', 'Labour', 'Hauling'], res: ['livestock', 'leather', 'horn'], herd: 'Herds', hunt: 1, dom: 2, climates: [...TEMP, 2, 5], covers: ['grassland', 'savanna', 'steppe'], notes: 'Wild cattle (aurochs) are far harder to hunt.' }),
  b({ id: 'bison', name: 'Bison', kind: 'Mammal', size: 'Large', s: [35, 4, 18, 6, 16, 8, 2, 3, 0, 10, 40, 0, 0, 5, 5], life: 20, diet: 'Plants', uses: ['Food'], res: ['game', 'leather', 'horn'], herd: 'Herds', hunt: 3, dom: 4, climates: [6, 10], covers: ['grassland', 'steppe'] }),
  b({ id: 'sheep', name: 'Sheep', kind: 'Mammal', size: 'Medium', s: [12, 0, 4, 6, 10, 2, 2, 3, 0, 8, 30, 0, 5, 5, 2], life: 12, diet: 'Plants', uses: ['Food'], res: ['wool', 'livestock'], herd: 'Herds', hunt: 1, dom: 1, climates: [6, 7, 9, 10], covers: ['grassland', 'steppe'], zones: [0, 1, 2] }),
  b({ id: 'goat', name: 'Goat', kind: 'Mammal', size: 'Medium', s: [12, 0, 6, 12, 10, 6, 3, 3, 0, 8, 35, 0, 20, 15, 2], life: 15, diet: 'Plants', uses: ['Food'], res: ['livestock', 'leather', 'wool'], herd: 'Herds', hunt: 2, dom: 1, climates: [5, 6, 7, 4], covers: ['scrub', 'steppe'], zones: [1, 2, 3], move: ['Walks', 'Climbs', 'Mountain-adapted'], traits: ['mountain-born'] }),
  b({ id: 'yak', name: 'Yak', kind: 'Mammal', size: 'Large', s: [30, 4, 16, 4, 18, 8, 2, 3, 0, 12, 25, 0, 10, 2, 2], life: 20, diet: 'Plants', uses: ['Hauling', 'Food', 'Riding'], res: ['wool', 'livestock', 'leather'], herd: 'Herds', hunt: 2, dom: 2, climates: [4, 6, 12], covers: ['steppe', 'tundra'], zones: [2, 3], move: ['Walks', 'Mountain-adapted'], traits: ['cold-adapted', 'mountain-born'] }),
  b({ id: 'llama', name: 'Llama', kind: 'Mammal', size: 'Medium', s: [16, 0, 10, 8, 12, 6, 3, 3, 0, 10, 35, 0, 15, 5, 2], life: 20, diet: 'Plants', uses: ['Hauling'], res: ['wool'], herd: 'Herds', hunt: 2, dom: 2, climates: [4, 6], covers: ['steppe', 'scrub'], zones: [1, 2, 3], move: ['Walks', 'Mountain-adapted'] }),
  b({ id: 'camel', name: 'Camel', kind: 'Mammal', size: 'Large', s: [28, 2, 16, 6, 18, 8, 2, 3, 0, 14, 40, 0, 0, 2, 2], life: 40, diet: 'Plants', uses: ['Riding', 'Hauling', 'Food'], res: ['wool', 'leather', 'livestock'], herd: 'Small groups', hunt: 2, dom: 2, climates: [3, 4, 5], covers: ['dunes', 'rockdesert', 'steppe'], traits: ['heat-adapted'] }),
  b({ id: 'reindeer', name: 'Reindeer', kind: 'Mammal', size: 'Medium', s: [18, 0, 10, 10, 14, 6, 2, 3, 0, 12, 45, 0, 0, 10, 15], life: 15, diet: 'Plants', uses: ['Riding', 'Hauling', 'Food'], res: ['furs', 'game', 'horn'], herd: 'Herds', hunt: 2, dom: 3, climates: [11, 12], covers: ['tundra', 'taiga'], traits: ['cold-adapted'] }),
  b({ id: 'elephant', name: 'Elephant', kind: 'Mammal', size: 'Giant', s: [60, 10, 28, 4, 20, 14, 5, 8, 0, 10, 30, 0, 0, 0, 10], life: 65, diet: 'Plants', uses: ['Labour', 'Riding', 'Hauling'], res: ['ivory', 'leather'], herd: 'Herds', hunt: 5, dom: 4, climates: [0, 1, 2], covers: ['savanna', 'jungle'], traits: ['thick-hide'] }),
  b({ id: 'lion', name: 'Lion', kind: 'Mammal', size: 'Large', s: [30, 2, 20, 14, 14, 12, 3, 4, 0, 8, 50, 0, 5, 20, 5], life: 15, diet: 'Meat', uses: [], res: ['furs'], herd: 'Small groups', hunt: 4, dom: 5, climates: [2, 5], covers: ['savanna', 'steppe'], traits: ['pack-hunter'] }),
  b({ id: 'tiger', name: 'Tiger', kind: 'Mammal', size: 'Large', s: [32, 2, 22, 14, 14, 14, 3, 4, 0, 8, 50, 0, 10, 20, 15], life: 15, diet: 'Meat', uses: [], res: ['furs'], herd: 'Solitary', hunt: 5, dom: 5, climates: [0, 1, 11], covers: ['jungle', 'forest', 'taiga'] }),
  b({ id: 'hare', name: 'Hare', kind: 'Mammal', size: 'Tiny', s: [3, 0, 1, 14, 4, 2, 1, 2, 0, 6, 50, 0, 0, 15, 2], life: 6, diet: 'Plants', uses: ['Food'], res: ['furs', 'game'], herd: 'Swarms', hunt: 1, dom: 2, climates: [], covers: ['grassland', 'steppe', 'tundra', 'forest'], traits: ['burrower', 'fertile'] }),
  b({ id: 'fox', name: 'Fox', kind: 'Mammal', size: 'Small', s: [6, 0, 3, 14, 6, 4, 3, 3, 0, 8, 45, 0, 0, 10, 5], life: 8, diet: 'Both', uses: [], res: ['furs'], herd: 'Solitary', hunt: 2, dom: 4, climates: [...TEMP, 11, 12, 6], covers: ['forest', 'grassland', 'tundra'] }),
  b({ id: 'beaver', name: 'Beaver', kind: 'Mammal', size: 'Small', s: [8, 0, 4, 6, 8, 4, 2, 3, 0, 8, 15, 0, 0, 0, 30], life: 15, diet: 'Plants', uses: [], res: ['furs'], herd: 'Pairs', hunt: 1, dom: 5, climates: [9, 10, 11], covers: ['forest', 'taiga'], move: ['Walks', 'Swims'] }),
  b({ id: 'seal', name: 'Seal', kind: 'Mammal', size: 'Medium', s: [18, 2, 8, 6, 14, 4, 3, 3, 0, 10, 10, 0, 0, 0, 50], life: 25, diet: 'Meat', uses: ['Food'], res: ['furs', 'game'], herd: 'Herds', hunt: 2, dom: 5, climates: [11, 12, 13, 9], covers: ['beach', 'glacier'], move: ['Swims'], traits: ['cold-adapted'], notes: 'Coasts and sea ice.' }),
  b({ id: 'whale', name: 'Whale', kind: 'Mammal', size: 'Giant', s: [90, 10, 30, 4, 24, 12, 6, 8, 0, 14, 0, 0, 0, 0, 60], life: 70, diet: 'Meat', uses: ['Food'], res: ['game'], herd: 'Small groups', hunt: 5, dom: 5, climates: [], covers: [], move: ['Swims'], notes: 'Open sea: oil, meat and bone.' }),
  b({ id: 'fish', name: 'Fish shoals', kind: 'Fish', size: 'Tiny', s: [1, 0, 1, 10, 2, 1, 1, 1, 0, 6, 0, 0, 0, 0, 40], life: 5, diet: 'Both', uses: ['Food'], res: ['fish'], herd: 'Swarms', hunt: 1, dom: 4, climates: [], covers: [], move: ['Swims'], notes: 'Seas, rivers and lakes; richest over upwelling.' }),
  b({ id: 'chicken', name: 'Chicken', kind: 'Bird', size: 'Tiny', s: [3, 0, 1, 6, 4, 2, 1, 2, 0, 4, 15, 2, 0, 5, 0], life: 8, diet: 'Both', uses: ['Food'], res: ['feathers', 'livestock'], herd: 'Small groups', hunt: 1, dom: 1, climates: [], covers: [] }),
  b({ id: 'eagle', name: 'Eagle', kind: 'Bird', size: 'Small', s: [6, 0, 6, 14, 6, 6, 3, 4, 0, 10, 10, 70, 0, 0, 0], life: 25, diet: 'Meat', uses: ['Hunting help'], res: ['feathers'], herd: 'Pairs', hunt: 3, dom: 4, climates: [], covers: [], zones: [1, 2, 3], move: ['Flies'], notes: 'Kept for falconry.' }),
  b({ id: 'hawk', name: 'Hawk', kind: 'Bird', size: 'Tiny', s: [3, 0, 3, 16, 4, 6, 3, 4, 0, 10, 10, 70, 0, 0, 0], life: 15, diet: 'Meat', uses: ['Hunting help'], res: ['feathers'], herd: 'Pairs', hunt: 3, dom: 3, climates: [], covers: [], move: ['Flies'] }),
  b({ id: 'ostrich', name: 'Ostrich', kind: 'Bird', size: 'Large', s: [18, 0, 12, 10, 12, 4, 1, 2, 0, 10, 70, 0, 0, 10, 0], life: 40, diet: 'Plants', uses: ['Food'], res: ['feathers', 'leather'], herd: 'Small groups', hunt: 3, dom: 3, climates: [2, 3, 5], covers: ['savanna', 'steppe'] }),
  b({ id: 'bees', name: 'Bees', kind: 'Insect', size: 'Tiny', s: [1, 0, 1, 12, 1, 4, 1, 2, 0, 6, 10, 30, 0, 0, 0], life: 1, diet: 'Plants', uses: [], res: ['honey'], herd: 'Swarms', hunt: 2, dom: 2, climates: [...TEMP, 0, 1, 2], covers: ['forest', 'grassland', 'scrub'], move: ['Flies'], traits: ['venomous'], notes: 'Kept in hives for honey and wax.' }),
  b({ id: 'silkworm', name: 'Silkworm', kind: 'Insect', size: 'Tiny', s: [1, 0, 0, 1, 1, 1, 1, 1, 0, 2, 1, 0, 2, 0, 0], life: 1, diet: 'Plants', uses: [], res: ['silk'], herd: 'Swarms', hunt: 1, dom: 2, climates: [1, 8], covers: ['forest'] }),
  b({ id: 'crocodile', name: 'Crocodile', kind: 'Reptile', size: 'Large', s: [40, 16, 20, 6, 16, 10, 2, 3, 0, 6, 20, 0, 0, 5, 40], life: 60, diet: 'Meat', uses: [], res: ['leather'], herd: 'Solitary', hunt: 4, dom: 5, climates: [0, 1, 2], covers: ['marsh', 'jungle', 'savanna'], move: ['Walks', 'Swims'], traits: ['thick-hide'], notes: 'Rivers, lakes and swamps of hot lands.' }),
  b({ id: 'snake', name: 'Venomous snake', kind: 'Reptile', size: 'Small', s: [4, 2, 4, 14, 4, 6, 1, 2, 0, 4, 15, 0, 10, 0, 15], life: 15, diet: 'Meat', uses: [], res: ['leather'], herd: 'Solitary', hunt: 2, dom: 5, climates: [0, 1, 2, 3, 5, 8], covers: ['jungle', 'savanna', 'scrub', 'rockdesert'], traits: ['venomous'] }),
];
