import type { BiomeKey } from './biomes';
import type { SectorKey } from './economy';
import type { CultureValues, TraitEffects } from '../types';

/**
 * What a culture's people experience, averaged over its settlements. Measured every few years
 * and used to decide which survival traits the culture develops.
 */
export interface CultureEnvironment {
  /** Share of worked land in each biome. */
  biome: Partial<Record<BiomeKey, number>>;
  hills: number;
  mountains: number;
  coastal: number;
  river: number;
  horses: number;
  /** Share of the workforce in each sector. */
  labor: Partial<Record<SectorKey, number>>;
  /** Imported value relative to what is produced. */
  tradeReliance: number;
  famine: number;
  plague: number;
  war: number;
}

export interface TraitDef {
  id: string;
  name: string;
  description: string;
  /** How strongly the environment pushes the culture towards this trait (1 = at the threshold). */
  pressure: (env: CultureEnvironment) => number;
  effects: Partial<Omit<TraitEffects, 'production' | 'habitat'>> & {
    production?: Partial<Record<SectorKey, number>>;
    habitat?: Partial<Record<BiomeKey, number>>;
  };
  /** Cultural values the trait nudges over time. */
  values?: Partial<CultureValues>;
  /** Chronicle line when earned; {c} is the culture name. */
  earned: string;
}

const b = (env: CultureEnvironment, ...keys: BiomeKey[]) => keys.reduce((s, k) => s + (env.biome[k] ?? 0), 0);
const mining = (env: CultureEnvironment) =>
  (['quarrying', 'copperMining', 'tinMining', 'ironMining', 'coalMining', 'goldMining', 'gemMining'] as SectorKey[]).reduce((s, k) => s + (env.labor[k] ?? 0), 0);

export const TRAITS: TraitDef[] = [
  {
    id: 'seafarers', name: 'Seafarers',
    description: 'Raised on the shore: bold fishers and sailors who read wind and tide.',
    pressure: (e) => e.coastal / 0.55,
    effects: { production: { fishing: 1.3 }, tradeCapacity: 0.1 },
    values: { seafaring: 0.85 },
    earned: 'The {c} took to the sea for their bread, and became a seafaring people.',
  },
  {
    id: 'river_tamers', name: 'River-Tamers',
    description: 'Masters of flood and channel who wring rich harvests from river silt.',
    pressure: (e) => e.river / 0.45,
    effects: { production: { farming: 1.2, fishing: 1.1 } },
    earned: 'Living by the great rivers, the {c} learned to tame the floods and feed on the silt.',
  },
  {
    id: 'mountain_folk', name: 'Mountain Folk',
    description: 'At home on steep slopes: terrace farmers, quarrymen and miners behind natural walls.',
    pressure: (e) => (e.mountains * 1.5 + e.hills * 0.6) / 0.4,
    effects: { production: { quarrying: 1.3, copperMining: 1.2, tinMining: 1.2, ironMining: 1.2, gemMining: 1.2 }, defense: 0.15, habitat: { mountain: 0.35 } },
    values: { tradition: 0.8 },
    earned: 'Among the peaks the {c} learned to terrace the slopes and delve the rock: they became Mountain Folk.',
  },
  {
    id: 'woodwise', name: 'Woodwise',
    description: 'Children of the forest who hunt, gather and build from the living wood.',
    pressure: (e) => b(e, 'temperateForest', 'tropicalForest', 'taiga') / 0.5,
    effects: { production: { forestry: 1.25, foraging: 1.25 }, habitat: { temperateForest: 0.15, tropicalForest: 0.15, taiga: 0.1 } },
    earned: 'The deep woods fed and sheltered the {c}, who became Woodwise.',
  },
  {
    id: 'horse_lords', name: 'Horse Lords',
    description: 'Riders of the open plains whose wealth walks on four legs.',
    pressure: (e) => (b(e, 'steppe', 'grassland', 'savanna') * 0.6 + e.horses * 2) / 0.55,
    effects: { production: { herding: 1.3, horseBreeding: 1.6 }, military: 0.1, habitat: { steppe: 0.15 } },
    values: { expansionism: 0.75 },
    earned: 'On the endless grass the {c} tamed the wild horse and became Horse Lords.',
  },
  {
    id: 'sand_walkers', name: 'Sand-Walkers',
    description: 'Desert folk who need little water, know every well, and harvest salt from the waste.',
    pressure: (e) => b(e, 'desert') / 0.3,
    effects: { production: { saltWorks: 1.4 }, foodNeed: -0.1, famineResist: 0.15, habitat: { desert: 0.25 } },
    earned: 'The {c} learned the secrets of wells and dunes, and became Sand-Walkers.',
  },
  {
    id: 'frostborn', name: 'Frostborn',
    description: 'Hardy people of the cold who hunt, store and endure through long winters.',
    pressure: (e) => b(e, 'tundra', 'taiga', 'ice') / 0.4,
    effects: { production: { foraging: 1.25 }, famineResist: 0.25, habitat: { tundra: 0.25, taiga: 0.1 } },
    earned: 'Winter after winter hardened the {c}; they became Frostborn.',
  },
  {
    id: 'marsh_dwellers', name: 'Marsh-Dwellers',
    description: 'Stilt-house folk of the fens, rich in fish and fowl and strangely untouched by fevers.',
    pressure: (e) => b(e, 'wetland') / 0.25,
    effects: { production: { fishing: 1.15, foraging: 1.2 }, plagueResist: 0.25, habitat: { wetland: 0.25 } },
    earned: 'The {c} built their homes on stilts among the reeds and became Marsh-Dwellers.',
  },
  {
    id: 'great_hunters', name: 'Great Hunters',
    description: 'A people who live by the spear and the snare.',
    pressure: (e) => (e.labor.foraging ?? 0) / 0.45,
    effects: { production: { foraging: 1.25 }, military: 0.05 },
    earned: 'The hunt shaped every part of {c} life; they became renowned Great Hunters.',
  },
  {
    id: 'tillers', name: 'Tillers of the Soil',
    description: 'Patient farmers who know every field, season and seed.',
    pressure: (e) => ((e.labor.farming ?? 0) * (e.biome.grassland ?? 0) * 2) / 0.5,
    effects: { production: { farming: 1.15, herding: 1.05 } },
    values: { tradition: 0.7 },
    earned: 'Generations at the plough made the {c} Tillers of the Soil.',
  },
  {
    id: 'deep_delvers', name: 'Deep Delvers',
    description: 'Miners and smiths whose lives revolve around the ore.',
    pressure: (e) => mining(e) / 0.12,
    effects: { production: { copperMining: 1.2, tinMining: 1.2, ironMining: 1.25, coalMining: 1.2, toolmaking: 1.15, weaponsmithing: 1.15 } },
    earned: 'The {c} followed the veins of ore ever deeper and became Deep Delvers.',
  },
  {
    id: 'merchant_folk', name: 'Merchant Folk',
    description: 'A people who survive by trade, bringing from afar what their own land cannot give.',
    pressure: (e) => e.tradeReliance / 0.25,
    effects: { tradeCapacity: 0.35 },
    values: { mercantilism: 0.8, xenophobia: 0.25 },
    earned: 'Lacking much of what they needed, the {c} learned to trade for it and became Merchant Folk.',
  },
  {
    id: 'hardship_hardened', name: 'Hardship-Hardened',
    description: 'Famine taught them to ration, store and survive.',
    pressure: (e) => e.famine / 0.08,
    effects: { famineResist: 0.3, foodNeed: -0.05 },
    values: { piety: 0.7 },
    earned: 'Hunger visited the {c} again and again until they learned to endure it.',
  },
  {
    id: 'plague_hardened', name: 'Plague-Hardened',
    description: 'Survivors of many pestilences, with remedies and customs against disease.',
    pressure: (e) => e.plague / 0.04,
    effects: { plagueResist: 0.35 },
    earned: 'After many plagues the {c} developed customs and cures that kept sickness at bay.',
  },
  {
    id: 'warrior_tradition', name: 'Warrior Tradition',
    description: 'Every generation has known war; every child learns the blade.',
    pressure: (e) => e.war / 0.35,
    effects: { military: 0.15, defense: 0.05 },
    values: { militarism: 0.8 },
    earned: 'Endless war forged a Warrior Tradition among the {c}.',
  },
];

export const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));
export const MAX_TRAITS = 4;

export function emptyTraitEffects(): TraitEffects {
  return { production: {}, habitat: {}, famineResist: 0, plagueResist: 0, military: 0, defense: 0, tradeCapacity: 0, foodNeed: 0 };
}

export function combineTraits(ids: string[]): TraitEffects {
  const fx = emptyTraitEffects();
  for (const id of ids) {
    const t = TRAIT_BY_ID.get(id);
    if (!t) continue;
    const e = t.effects;
    for (const [k, v] of Object.entries(e.production ?? {}) as [SectorKey, number][]) fx.production[k] = (fx.production[k] ?? 1) * v;
    for (const [k, v] of Object.entries(e.habitat ?? {}) as [BiomeKey, number][]) fx.habitat[k] = (fx.habitat[k] ?? 0) + v;
    fx.famineResist += e.famineResist ?? 0;
    fx.plagueResist += e.plagueResist ?? 0;
    fx.military += e.military ?? 0;
    fx.defense += e.defense ?? 0;
    fx.tradeCapacity += e.tradeCapacity ?? 0;
    fx.foodNeed += e.foodNeed ?? 0;
  }
  return fx;
}
