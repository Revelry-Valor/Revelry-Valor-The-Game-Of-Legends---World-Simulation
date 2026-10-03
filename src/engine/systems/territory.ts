import { BIOMES } from '../data/biomes';
import { ringRadius, runLand } from './land';
import { pairKey, type World } from '../world';

/**
 * The realms on the map: every tile falls to the nearest settlement within reach (three times the
 * ring of land a settlement works), so a nation's lands are one continuous territory rather than
 * the patches its settlements farm. Coastal waters within a settlement's ring are its own too.
 */
function assignRegions(world: World): void {
  const map = world.map;
  const w = map.width;
  const ring = ringRadius(world);
  const R = ring * 3;
  const best = new Float32Array(map.size).fill(Infinity);
  map.region.fill(-1);
  for (const s of world.aliveSettlements()) {
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= map.height) continue;
        const d = Math.hypot(dx, dy);
        if (d > R + 0.5) continue;
        const t = y * w + x;
        if (BIOMES[map.biome[t]].water) {
          if (d > ring + 0.5) continue;
        } else if (map.landmass[t] !== s.landmass) continue;
        if (d < best[t] - 1e-6 || (d === best[t] && s.pop > world.settlements[map.region[t]].pop)) {
          best[t] = d;
          map.region[t] = s.id;
        }
      }
    }
  }
}

/**
 * Once a year: every settlement decides what to use the land it works for (see land.ts), the
 * realms are drawn, and the borders between nations are measured along them.
 */
export function updateTerritory(world: World): void {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  runLand(world);
  assignRegions(world);
  for (const s of world.aliveSettlements()) {
    s.river = map.river[s.tile] > 0;
    for (const t of [s.tile - 1, s.tile + 1, s.tile - w, s.tile + w]) if (t >= 0 && t < map.size && map.river[t] > 0) s.river = true;
  }

  world.borders.clear();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      const o = map.region[j];
      if (o < 0) continue;
      const pa = world.settlements[o].polityId;
      if (x + 1 < w) {
        const o2 = map.region[j + 1];
        if (o2 >= 0) {
          const pb = world.settlements[o2].polityId;
          if (pa !== pb) world.borders.set(pairKey(pa, pb), (world.borders.get(pairKey(pa, pb)) ?? 0) + 1);
        }
      }
      if (y + 1 < h) {
        const o2 = map.region[j + w];
        if (o2 >= 0) {
          const pb = world.settlements[o2].polityId;
          if (pa !== pb) world.borders.set(pairKey(pa, pb), (world.borders.get(pairKey(pa, pb)) ?? 0) + 1);
        }
      }
    }
  }
  world.territoryDirty = false;
}
