import { BIOMES } from '../data/biomes';
import { Good, SECTOR_KEYS } from '../data/economy';
import { BUILDINGS, CITY_TILE_PEOPLE, TIERS } from '../data/settlements';
import type { Settlement } from '../types';
import type { World } from '../world';
import { killPop } from './politics';

/**
 * How many people a settlement holds in comfort: what its building and sanitation skills allow,
 * plus room on the City land it has spread over. Technology never stops a settlement growing;
 * it only decides how crowded, filthy and dangerous it is when it does.
 */
export function comfort(world: World, s: Settlement): number {
  return world.polities[s.polityId].effects.housingMax + s.cityTiles * CITY_TILE_PEOPLE * 0.6;
}

/** What a settlement builds with: what its land gives and what its people know. */
function buildingsOf(world: World, s: Settlement): string {
  const pol = world.polities[s.polityId];
  const share = (key: string) => s.labor[SECTOR_KEYS.indexOf(key as (typeof SECTOR_KEYS)[number])] ?? 0;
  if (pol.techs.has('masonry') && s.stock[Good.Stone] > s.pop * 0.01 && TIERS[s.tier].urban) return 'stone';
  const wood = s.stock[Good.Timber] > s.pop * 0.05 || share('forestry') > 0;
  const roaming = share('herding') + share('foraging') > share('farming');
  if (roaming && (!wood || s.tier < 3)) return 'tents';
  if (wood) return 'timber';
  const biome = BIOMES[world.map.biome[s.tile]].key;
  return biome === 'desert' || biome === 'steppe' || biome === 'savanna' ? 'mudbrick' : 'huts';
}

/**
 * Once a year: how crowded every settlement is, what it is built of, and the fires that sweep
 * crowded towns of timber and tents.
 */
export function runDevelopment(world: World): void {
  const rng = world.rng;
  for (const s of world.aliveSettlements()) {
    s.crowding = Math.max(0, s.pop / comfort(world, s) - 1);
    s.buildings = buildingsOf(world, s);
    if (s.tier < 2) continue;
    const risk = 0.005 * BUILDINGS[s.buildings].fire * (0.4 + Math.min(3, s.crowding)) * world.cfg.calamity;
    if (!rng.chance(risk)) continue;
    const dead = s.pop * rng.range(0.005, 0.03);
    killPop(s, dead);
    s.housing *= rng.range(0.7, 0.9);
    s.wealth *= 0.85;
    s.stock[Good.Timber] *= 0.6;
    if (s.pop > 800) world.log('disaster', s.pop > 10000 ? 3 : s.pop > 3000 ? 2 : 1, `A great fire swept through the ${s.crowding > 0.5 ? 'crowded ' : ''}${BUILDINGS[s.buildings].name} of ${s.name}, killing some ${Math.round(dead).toLocaleString('en-US')}.`, { settlements: [s.id], polities: [s.polityId] });
  }
}
