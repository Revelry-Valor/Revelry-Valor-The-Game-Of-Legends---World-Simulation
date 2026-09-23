import { BIOMES, Biome, Relief } from '../data/biomes';
import { Res } from '../data/economy';
import type { MapData, RaceDef } from '../types';

/** How much a race likes a single tile for living on, -1..1 (-Infinity if uninhabitable). */
export function tileAffinity(map: MapData, race: RaceDef, i: number): number {
  const b = map.biome[i];
  if (BIOMES[b].water || b === Biome.Ice) return -Infinity;
  const biomePref = race.biomes[BIOMES[b].key] ?? 0;
  const rel = map.relief[i];
  const reliefPref = rel === Relief.Mountains ? race.relief.mountains : rel === Relief.Hills ? race.relief.hills : race.relief.flat;
  return biomePref * 0.75 + reliefPref * 0.35;
}

/**
 * Score a candidate settlement site for a race: its preferred terrain, food potential,
 * fresh water, coast, and the resources its people are good at exploiting.
 */
export function siteScore(map: MapData, race: RaceDef, tile: number): number {
  const aff = tileAffinity(map, race, tile);
  if (aff === -Infinity || aff < -0.55) return -Infinity;
  const w = map.width;
  const h = map.height;
  const x0 = tile % w;
  const y0 = Math.floor(tile / w);
  let food = 0;
  let water = 0;
  let minerals = 0;
  const R = map.resources;
  const p = race.production;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x;
      food += R[Res.Fertility][j] * (0.8 + 0.4 * (p.farming ?? 1)) + R[Res.Game][j] * 0.25 * (p.foraging ?? 1) + R[Res.Fish][j] * 0.35 * (p.fishing ?? 1);
      if (map.elevation[j] < 0 && BIOMES[map.biome[j]].key === 'lake') water += 0.1;
      minerals +=
        R[Res.Stone][j] * 0.05 * ((p.quarrying ?? 1) - 0.6) +
        (R[Res.Copper][j] + R[Res.Tin][j] + R[Res.Iron][j]) * 0.4 * ((p.ironMining ?? 1) - 0.5) +
        (R[Res.Gold][j] + R[Res.Gems][j]) * 0.5 * ((p.gemMining ?? 1) - 0.5) +
        R[Res.Timber][j] * 0.05 * (p.forestry ?? 1) +
        R[Res.Arcana][j] * 0.3 * ((p.arcanaGathering ?? 1) - 0.5);
    }
  }
  let score = aff * 3 + food * 0.22 + minerals + water;
  if (map.river[tile] > 0) score += 1.2 * (1 + race.river);
  if (map.coastal[tile]) score += 0.6 * (1 + race.coastal);
  if (map.relief[tile] === Relief.Hills) score += 0.25; // defensible
  return score;
}
