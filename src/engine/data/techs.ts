import { Res } from './economy';

export type TechCategory = 'agriculture' | 'industry' | 'military' | 'maritime' | 'society' | 'science' | 'arcane';
export const TECH_CATEGORIES: TechCategory[] = ['agriculture', 'industry', 'military', 'maritime', 'society', 'science', 'arcane'];

/**
 * Aggregated modifiers a polity gets from its known technologies.
 * Keys in MAX_EFFECTS take the best value among known techs; all others add up.
 */
export interface TechEffects {
  food: number;
  fish: number;
  timber: number;
  mining: number;
  craft: number;
  /** Largest settlement size the building techniques support. */
  housingMax: number;
  tradeRange: number;
  tradeEff: number;
  research: number;
  military: number;
  defense: number;
  sanitation: number;
  /** 0 none, 1 coastal waters, 2 open sea, 3 oceanic voyages. */
  seaTravel: number;
  /** 0 trails, 1 paved roads, 2 engineered highways. */
  roads: number;
  stability: number;
  storage: number;
  control: number;
  magic: number;
  /** 0 stone, 1 copper, 2 bronze, 3 iron, 4 steel. */
  metallurgy: number;
}

export const MAX_EFFECTS: (keyof TechEffects)[] = ['housingMax', 'seaTravel', 'roads', 'metallurgy'];

export function baseEffects(): TechEffects {
  return {
    food: 0, fish: 0, timber: 0, mining: 0, craft: 0, housingMax: 700, tradeRange: 0, tradeEff: 0,
    research: 0, military: 0, defense: 0, sanitation: 0, seaTravel: 0, roads: 0, stability: 0,
    storage: 0, control: 0, magic: 0, metallurgy: 0,
  };
}

export interface TechDef {
  id: string;
  name: string;
  era: number;
  category: TechCategory;
  prereqs: string[];
  /** Every listed natural resource must be present in the polity's lands or reachable through trade. */
  requires?: Res[];
  /** Needs coastal or river settlements. */
  requiresWater?: boolean;
  /** Only exists in worlds with magic. */
  arcane?: boolean;
  effects: Partial<TechEffects>;
  description: string;
}

export const ERA_NAMES = ['Stone Age', 'Early Age', 'Bronze Age', 'Iron Age', 'Classical Age', 'Medieval Age', 'Renaissance', 'Industrial Age'];
export const ERA_COST = [60, 220, 650, 1600, 3600, 7000, 12000, 20000];

export const TECHS: TechDef[] = [
  // Era 0 — Stone Age
  { id: 'agriculture', name: 'Agriculture', era: 0, category: 'agriculture', prereqs: [], requires: [Res.Fertility], effects: { food: 0.2, housingMax: 2500 }, description: 'Sowing and harvesting crops; settled villages become possible.' },
  { id: 'animal_husbandry', name: 'Animal Husbandry', era: 0, category: 'agriculture', prereqs: [], requires: [Res.Game], effects: { food: 0.1 }, description: 'Domesticated herds provide meat, milk and hides.' },
  { id: 'fishing', name: 'Fishing', era: 0, category: 'maritime', prereqs: [], requiresWater: true, effects: { fish: 0.4 }, description: 'Nets, weirs and dugout canoes.' },
  { id: 'pottery', name: 'Pottery', era: 0, category: 'industry', prereqs: [], effects: { storage: 0.25 }, description: 'Fired clay vessels store grain and water.' },
  { id: 'carpentry', name: 'Carpentry', era: 0, category: 'industry', prereqs: [], requires: [Res.Timber], effects: { timber: 0.3, craft: 0.05 }, description: 'Shaped timber for homes, tools and boats.' },
  { id: 'mysticism', name: 'Mysticism', era: 0, category: 'arcane', prereqs: [], arcane: true, effects: { stability: 0.03, magic: 0.2 }, description: 'Shamans and seers commune with the unseen currents of the world.' },
  // Era 1 — Early Age
  { id: 'masonry', name: 'Masonry', era: 1, category: 'industry', prereqs: ['pottery'], requires: [Res.Stone], effects: { housingMax: 7000, defense: 0.2 }, description: 'Dressed stone walls, granaries and fortifications.' },
  { id: 'copper_working', name: 'Copper Working', era: 1, category: 'industry', prereqs: ['carpentry'], requires: [Res.Copper], effects: { metallurgy: 1, mining: 0.1 }, description: 'Smelting copper for the first metal tools.' },
  { id: 'sailing', name: 'Sailing', era: 1, category: 'maritime', prereqs: ['fishing', 'carpentry'], requires: [Res.Timber], requiresWater: true, effects: { seaTravel: 1, tradeRange: 0.15 }, description: 'Sailed vessels hug the coasts, linking distant shores.' },
  { id: 'the_wheel', name: 'The Wheel', era: 1, category: 'industry', prereqs: ['carpentry'], effects: { tradeRange: 0.25, tradeEff: 0.1 }, description: 'Carts and wagons carry heavy loads overland.' },
  { id: 'irrigation', name: 'Irrigation', era: 1, category: 'agriculture', prereqs: ['agriculture'], effects: { food: 0.25 }, description: 'Canals and ditches bring river water to the fields.' },
  { id: 'writing', name: 'Writing', era: 1, category: 'society', prereqs: ['pottery'], effects: { research: 0.3, stability: 0.03, control: 0.2 }, description: 'Records, laws and knowledge preserved beyond memory.' },
  { id: 'horseback_riding', name: 'Horseback Riding', era: 1, category: 'military', prereqs: ['animal_husbandry'], requires: [Res.Horses], effects: { military: 0.2, tradeRange: 0.1, control: 0.2 }, description: 'Mounted riders cross the plains swiftly.' },
  { id: 'ancestor_worship', name: 'Organised Faith', era: 1, category: 'society', prereqs: ['pottery'], effects: { stability: 0.06 }, description: 'Priesthoods, temples and shared rites bind communities together.' },
  // Era 2 — Bronze Age
  { id: 'bronze_working', name: 'Bronze Working', era: 2, category: 'industry', prereqs: ['copper_working'], requires: [Res.Copper, Res.Tin], effects: { metallurgy: 2, military: 0.25, craft: 0.1 }, description: 'Alloying copper with scarce tin — a prize worth long trade routes.' },
  { id: 'mathematics', name: 'Mathematics', era: 2, category: 'science', prereqs: ['writing'], effects: { research: 0.25 }, description: 'Numbers, geometry and measurement.' },
  { id: 'currency', name: 'Currency', era: 2, category: 'society', prereqs: ['writing', 'copper_working'], effects: { tradeEff: 0.3 }, description: 'Coinage makes exchange simple and taxable.' },
  { id: 'construction', name: 'Construction', era: 2, category: 'industry', prereqs: ['masonry', 'the_wheel'], effects: { housingMax: 18000, roads: 1, control: 0.2 }, description: 'Paved roads, large buildings and city walls.' },
  { id: 'code_of_laws', name: 'Code of Laws', era: 2, category: 'society', prereqs: ['writing'], effects: { stability: 0.08, control: 0.3 }, description: 'Written law and courts replace custom and feud.' },
  { id: 'arcane_lore', name: 'Arcane Lore', era: 2, category: 'arcane', prereqs: ['mysticism', 'writing'], requires: [Res.Arcana], arcane: true, effects: { magic: 0.5, research: 0.1 }, description: 'Scholars codify the patterns of ley lines into spells.' },
  { id: 'warrior_code', name: 'Warrior Code', era: 2, category: 'military', prereqs: ['bronze_working'], effects: { military: 0.2 }, description: 'Professional soldiers, drills and formations.' },
  // Era 3 — Iron Age
  { id: 'iron_working', name: 'Iron Working', era: 3, category: 'industry', prereqs: ['bronze_working'], requires: [Res.Iron], effects: { metallurgy: 3, military: 0.3, mining: 0.2, food: 0.1 }, description: 'Bloomeries smelt abundant iron into tools and blades.' },
  { id: 'philosophy', name: 'Philosophy', era: 3, category: 'science', prereqs: ['mathematics', 'code_of_laws'], effects: { research: 0.3, stability: 0.03 }, description: 'Schools of thought question the nature of all things.' },
  { id: 'engineering', name: 'Engineering', era: 3, category: 'industry', prereqs: ['construction', 'mathematics'], effects: { housingMax: 45000, sanitation: 0.2, defense: 0.2 }, description: 'Aqueducts, bridges and siege engines.' },
  { id: 'navigation', name: 'Navigation', era: 3, category: 'maritime', prereqs: ['sailing', 'mathematics'], effects: { seaTravel: 2, tradeRange: 0.25 }, description: 'Stars and charts guide ships across open sea.' },
  { id: 'crop_rotation', name: 'Crop Rotation', era: 3, category: 'agriculture', prereqs: ['irrigation', 'mathematics'], effects: { food: 0.25 }, description: 'Fields rest in turn and never exhaust.' },
  { id: 'enchanting', name: 'Enchanting', era: 3, category: 'arcane', prereqs: ['arcane_lore', 'bronze_working'], arcane: true, effects: { magic: 0.5, military: 0.2, craft: 0.15 }, description: 'Runes and wards bound into metal.' },
  { id: 'monasticism', name: 'Monasticism', era: 3, category: 'society', prereqs: ['ancestor_worship', 'code_of_laws'], effects: { research: 0.1, stability: 0.05, sanitation: 0.05 }, description: 'Cloistered orders copy books and tend the sick.' },
  // Era 4 — Classical Age
  { id: 'medicine', name: 'Medicine', era: 4, category: 'science', prereqs: ['philosophy'], effects: { sanitation: 0.3 }, description: 'Herbalists and physicians fight disease.' },
  { id: 'steel', name: 'Steel', era: 4, category: 'industry', prereqs: ['iron_working'], requires: [Res.Iron, Res.Coal], effects: { metallurgy: 4, military: 0.3, craft: 0.15 }, description: 'Carbonised iron — the finest blades and tools.' },
  { id: 'banking', name: 'Banking', era: 4, category: 'society', prereqs: ['currency', 'philosophy'], effects: { tradeEff: 0.35 }, description: 'Credit, bills of exchange and merchant houses.' },
  { id: 'feudalism', name: 'Feudalism', era: 4, category: 'military', prereqs: ['code_of_laws', 'horseback_riding', 'iron_working'], effects: { military: 0.2, control: 0.4, stability: 0.03 }, description: 'Vassals hold land in return for military service.' },
  { id: 'architecture', name: 'Architecture', era: 4, category: 'industry', prereqs: ['engineering'], effects: { housingMax: 90000, stability: 0.03 }, description: 'Domes, arches and great civic works.' },
  { id: 'astronomy', name: 'Astronomy', era: 4, category: 'science', prereqs: ['philosophy', 'navigation'], effects: { research: 0.2, tradeRange: 0.1 }, description: 'Charting the heavens, the calendar and the seasons.' },
  { id: 'heavy_plough', name: 'Heavy Plough', era: 4, category: 'agriculture', prereqs: ['iron_working', 'crop_rotation'], effects: { food: 0.3 }, description: 'Iron ploughs break heavy, rich soils.' },
  { id: 'high_sorcery', name: 'High Sorcery', era: 4, category: 'arcane', prereqs: ['enchanting', 'philosophy'], arcane: true, effects: { magic: 0.8, research: 0.2, military: 0.2, food: 0.1 }, description: 'Academies of mages bend weather, harvest and war.' },
  // Era 5 — Medieval Age
  { id: 'printing_press', name: 'Printing Press', era: 5, category: 'science', prereqs: ['astronomy', 'engineering'], effects: { research: 0.5, stability: -0.02 }, description: 'Books for the many — and dangerous ideas with them.' },
  { id: 'alchemy', name: 'Alchemy', era: 5, category: 'science', prereqs: ['medicine'], effects: { research: 0.1, sanitation: 0.05, craft: 0.1 }, description: 'Distillation and the search for transmutation.' },
  { id: 'gunpowder', name: 'Gunpowder', era: 5, category: 'military', prereqs: ['alchemy', 'steel'], requires: [Res.Coal], effects: { military: 0.5, defense: -0.1 }, description: 'Black powder, cannon and the end of castle walls.' },
  { id: 'cartography', name: 'Cartography', era: 5, category: 'maritime', prereqs: ['astronomy'], effects: { seaTravel: 3, tradeRange: 0.3 }, description: 'Compasses and accurate charts open the oceans.' },
  { id: 'sanitation', name: 'Sanitation', era: 5, category: 'society', prereqs: ['medicine', 'architecture'], effects: { sanitation: 0.35, housingMax: 200000 }, description: 'Sewers and clean water tame the great cities.' },
  { id: 'guilds', name: 'Guilds', era: 5, category: 'society', prereqs: ['banking'], effects: { craft: 0.25, tradeEff: 0.15 }, description: 'Masters and apprentices organise the trades.' },
  { id: 'archmagic', name: 'Archmagic', era: 5, category: 'arcane', prereqs: ['high_sorcery', 'alchemy'], arcane: true, effects: { magic: 1, research: 0.3, sanitation: 0.2, military: 0.3 }, description: 'Towers of archmages reshape the land itself.' },
  // Era 6 — Renaissance
  { id: 'joint_stock', name: 'Chartered Companies', era: 6, category: 'society', prereqs: ['banking', 'cartography'], effects: { tradeEff: 0.4, tradeRange: 0.3 }, description: 'Investors pool capital for great trading ventures.' },
  { id: 'machinery', name: 'Machinery', era: 6, category: 'industry', prereqs: ['steel', 'engineering', 'guilds'], effects: { mining: 0.4, craft: 0.3, timber: 0.3 }, description: 'Water mills, cranes and mechanised workshops.' },
  { id: 'scientific_method', name: 'Scientific Method', era: 6, category: 'science', prereqs: ['printing_press', 'alchemy'], effects: { research: 0.6 }, description: 'Experiment and observation over authority.' },
  // Era 7 — Industrial Age
  { id: 'steam_power', name: 'Steam Power', era: 7, category: 'industry', prereqs: ['machinery', 'scientific_method'], requires: [Res.Coal], effects: { mining: 0.6, craft: 0.5, tradeRange: 0.4, roads: 2 }, description: 'Coal-fired engines drive mines, mills and ships.' },
  { id: 'industrialization', name: 'Industrialization', era: 7, category: 'industry', prereqs: ['steam_power'], effects: { housingMax: 600000, craft: 0.6, food: 0.3 }, description: 'Factories, railways and vast industrial cities.' },
];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

export function techCost(t: TechDef): number {
  return ERA_COST[t.era];
}
