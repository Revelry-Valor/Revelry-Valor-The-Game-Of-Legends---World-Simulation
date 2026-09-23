import { BIOMES, Biome } from '../data/biomes';
import { RES_COUNT } from '../data/economy';
import { pairKey, type World } from '../world';

/** Radius (tiles) of land a settlement works, growing with its population. */
export function territoryRadius(pop: number): number {
  return Math.max(2, Math.min(7, 2 + Math.floor(Math.log(Math.max(1, pop) / 150) / Math.log(3))));
}

/**
 * Assign every tile to the settlement with the strongest influence over it, then
 * cache the resources each settlement can draw on and the borders between polities.
 */
export function updateTerritory(world: World): void {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  map.owner.fill(-1);
  const influence = new Float32Array(map.size);
  const alive = [...world.aliveSettlements()].sort((a, b) => b.pop - a.pop);
  for (const s of alive) {
    const r = territoryRadius(s.pop);
    const strength = Math.sqrt(s.pop);
    const fishR = Math.min(r, 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r + r * 0.5) continue;
        const x = s.x + dx;
        const y = s.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const j = y * w + x;
        const b = map.biome[j];
        if (b === Biome.DeepOcean) continue;
        if (map.elevation[j] < 0) {
          if (d2 > fishR * fishR + 1) continue;
        } else if (map.landmass[j] !== s.landmass) continue;
        const infl = strength / (1 + d2);
        if (map.owner[j] === -1 || infl > influence[j]) {
          map.owner[j] = s.id;
          influence[j] = infl;
        }
      }
    }
  }
  for (const s of alive) {
    map.owner[s.tile] = s.id;
    s.territory = [];
    s.resSum.fill(0);
  }
  const R = map.resources;
  for (let j = 0; j < map.size; j++) {
    const o = map.owner[j];
    if (o < 0) continue;
    const s = world.settlements[o];
    s.territory.push(j);
    for (let r = 0; r < RES_COUNT; r++) s.resSum[r] += R[r][j];
  }
  for (const s of alive) {
    const habitat = world.majorityRace(s).habitat;
    s.habitat = 0;
    if (habitat) for (const j of s.territory) s.habitat += habitat[BIOMES[map.biome[j]].key] ?? 0;
    s.river = false;
    for (const j of s.territory) if (map.river[j] > 0 && Math.abs((j % w) - s.x) <= 1 && Math.abs(Math.floor(j / w) - s.y) <= 1) s.river = true;
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
