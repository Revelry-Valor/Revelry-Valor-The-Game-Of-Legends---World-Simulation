import { runLand } from './land';
import { pairKey, type World } from '../world';

/**
 * Once a year: every settlement takes up or gives back land and puts it to use (see land.ts),
 * then the borders between nations are measured from the land their settlements hold.
 */
export function updateTerritory(world: World): void {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  runLand(world);
  for (const s of world.aliveSettlements()) {
    s.river = map.river[s.tile] > 0;
    for (const t of [s.tile - 1, s.tile + 1, s.tile - w, s.tile + w]) if (t >= 0 && t < map.size && map.river[t] > 0) s.river = true;
  }

  world.borders.clear();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      const o = map.owner[j];
      if (o < 0) continue;
      const pa = world.settlements[o].polityId;
      if (x + 1 < w) {
        const o2 = map.owner[j + 1];
        if (o2 >= 0) {
          const pb = world.settlements[o2].polityId;
          if (pa !== pb) world.borders.set(pairKey(pa, pb), (world.borders.get(pairKey(pa, pb)) ?? 0) + 1);
        }
      }
      if (y + 1 < h) {
        const o2 = map.owner[j + w];
        if (o2 >= 0) {
          const pb = world.settlements[o2].polityId;
          if (pa !== pb) world.borders.set(pairKey(pa, pb), (world.borders.get(pairKey(pa, pb)) ?? 0) + 1);
        }
      }
    }
  }
  world.territoryDirty = false;
}
