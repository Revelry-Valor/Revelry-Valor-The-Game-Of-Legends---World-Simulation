import type { World } from '../world';
import { siteScore } from './sites';

/**
 * Place each race's homelands on the terrain it likes best, spread apart,
 * and seed a few tribes around each homeland.
 */
export function placePeoples(world: World): void {
  const { map, rng, cfg } = world;
  const homelands: { x: number; y: number }[] = [];
  const minDist = Math.min(map.width, map.height) * 0.22;
  for (const race of world.races) {
    for (let h = 0; h < cfg.homelandsPerRace; h++) {
      let best = -1;
      let bestScore = -Infinity;
      for (let attempt = 0; attempt < 600; attempt++) {
        const t = rng.int(0, map.size - 1);
        let score = siteScore(map, race, t);
        if (score === -Infinity) continue;
        const x = t % map.width;
        const y = Math.floor(t / map.width);
        let nearest = Infinity;
        for (const o of homelands) nearest = Math.min(nearest, Math.hypot(o.x - x, o.y - y));
        if (nearest < minDist) score -= (minDist - nearest) * 0.6;
        score += rng.range(0, 1.5);
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best < 0) continue;
      const hx = best % map.width;
      const hy = Math.floor(best / map.width);
      homelands.push({ x: hx, y: hy });

      // One culture per homeland; each tribe is its own small polity at first.
      let culture = null as ReturnType<World['createCulture']> | null;
      const placed: number[] = [];
      for (let tIdx = 0; tIdx < cfg.tribesPerHomeland; tIdx++) {
        let tile = -1;
        let ts = -Infinity;
        for (let a = 0; a < 80; a++) {
          const spread = 5 + cfg.settlementSpacing;
          const x = hx + rng.int(-spread, spread);
          const y = hy + rng.int(-spread, spread);
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          const t = y * map.width + x;
          if (map.settlementAt[t] >= 0 || map.landmass[t] !== map.landmass[best]) continue;
          let tooClose = false;
          for (const o of world.settlements) if (Math.hypot(o.x - x, o.y - y) < cfg.settlementSpacing) tooClose = true;
          if (tooClose) continue;
          const sc = siteScore(map, race, t) + rng.range(0, 1);
          if (sc > ts) {
            ts = sc;
            tile = t;
          }
        }
        if (tile < 0) continue;
        placed.push(tile);
        const pop = rng.int(70, 150);
        if (!culture) culture = world.createCulture(race.id, null, world.settlements.length);
        const s = world.createSettlement(tile, -1, culture.id, { [race.id]: pop }, -1);
        const p = world.createPolity(culture.id, s);
        s.polityId = p.id;
      }
      if (culture) {
        world.log('culture', 3, `The ${culture.name} people, ${race.plural.toLowerCase()} of the ${culture.adjective} tongue, dwell in their ancestral homeland.`, { cultures: [culture.id], tile: best });
      }
    }
  }
}
