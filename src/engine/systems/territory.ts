import { BIOMES, Biome } from '../data/biomes';
import { ringRadius, runLand } from './land';
import { pairKey, type World } from '../world';
import { declareLandWar } from './landwars';

/** Who holds a tile: a nation (its id), a clan (clanCode), or nobody (-1). */
export function powerAt(world: World, t: number): number {
  const map = world.map;
  const o = map.region[t];
  if (o >= 0) return world.settlements[o].polityId;
  const c = map.claim[t];
  return c >= 0 ? clanCode(c) : -1;
}

/** Clans are written as negative numbers below -1 wherever nations and clans share a slot. */
export const clanCode = (clan: number) => -clan - 2;
export const isClan = (code: number) => code <= -2;
export const clanOfCode = (code: number) => -code - 2;

/** Tiles of the eight around (x, y) that are on the map. */
export function neighbours(w: number, h: number, t: number, fn: (n: number) => void): void {
  const x = t % w;
  const y = (t - x) / w;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) fn(ny * w + nx);
    }
  }
}

/** Whether a tile touches land held by a power (or is held by it). */
export function touches(world: World, t: number, power: number): boolean {
  if (powerAt(world, t) === power) return true;
  let yes = false;
  neighbours(world.map.width, world.map.height, t, (n) => {
    if (!yes && powerAt(world, n) === power) yes = true;
  });
  return yes;
}

/**
 * Is there room to found a settlement here: the spot itself and most of the land around it (the
 * ring it would work) open, or already its own nation's or clan's? Nobody founds a village where
 * every field it could plough is someone else's.
 */
export function roomToSettle(world: World, t: number, polityId: number, clan: number): boolean {
  const map = world.map;
  const w = map.width;
  const mine = (n: number) => {
    const o = map.region[n];
    if (o >= 0) return polityId >= 0 && world.settlements[o].polityId === polityId;
    const c = map.claim[n];
    return c < 0 || c === clan;
  };
  if (!mine(t)) return false;
  const R = ringRadius(world);
  const x0 = t % w;
  const y0 = (t - x0) / w;
  let land = 0;
  let free = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= map.height) continue;
      const n = y * w + x;
      if (map.elevation[n] < 0 || !holdable(world, n)) continue;
      land++;
      if (mine(n)) free++;
    }
  }
  return land > 0 && free >= land * 0.6;
}

/** Nobody can hold the open ocean or the ice. */
export function holdable(world: World, t: number): boolean {
  const b = world.map.biome[t];
  return b !== Biome.DeepOcean && b !== Biome.Ice;
}

/**
 * Hand a tile to a nation: it joins the district of that nation's nearest settlement on the same
 * land (or, over water, any). Returns false if the nation has no settlement to hold it.
 */
export function giveToNation(world: World, t: number, polityId: number): boolean {
  const map = world.map;
  const p = world.polities[polityId];
  if (!p?.alive) return false;
  const x = t % map.width;
  const y = (t - x) / map.width;
  let best = -1;
  let bd = Infinity;
  for (const id of p.settlementIds) {
    const s = world.settlements[id];
    if (!s.alive) continue;
    const d = Math.hypot(s.px - x - 0.5, s.py - y - 0.5) + (s.landmass === map.landmass[t] || map.elevation[t] < 0 ? 0 : 50);
    if (d < bd) {
      bd = d;
      best = s.id;
    }
  }
  if (best < 0) return false;
  map.region[t] = best;
  map.claim[t] = -1;
  return true;
}

/**
 * Land is held by being there. Each year every settlement holds the land its people work, and its
 * hunters, herders and woodcutters range a little further into open land next to what it already
 * holds, a few tiles a year more as it grows, out to about three times the ring of land it works.
 * Land someone else holds is never taken this way: only war moves a border that meets another.
 * A settlement founded by a clan takes over the clan's hunting grounds around it; a settlement
 * that dies leaves its land to its nation's neighbouring districts, or to nobody.
 */
function growRealms(world: World): void {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  const ring = ringRadius(world);
  const reach = ring * 3;
  const rng = world.rng;
  // Land of settlements that are gone: to the same nation's neighbouring districts, or to nobody.
  const orphan: number[] = [];
  for (let t = 0; t < map.size; t++) {
    const o = map.region[t];
    if (o >= 0 && !world.settlements[o].alive) orphan.push(t);
  }
  if (orphan.length) {
    const was = orphan.map((t) => world.settlements[map.region[t]].polityId);
    for (const t of orphan) map.region[t] = -1;
    for (let pass = 0; pass < 6; pass++) {
      for (let k = 0; k < orphan.length; k++) {
        const t = orphan[k];
        if (map.region[t] >= 0) continue;
        let into = -1;
        neighbours(w, h, t, (n) => {
          const o = map.region[n];
          if (into < 0 && o >= 0 && world.settlements[o].alive && world.settlements[o].polityId === was[k]) into = o;
        });
        if (into >= 0) map.region[t] = into;
      }
    }
  }
  const founders = new Map<number, number>();
  for (const tr of world.tribes) if (tr.polityId >= 0) founders.set(tr.polityId, tr.id);
  for (const s of world.aliveSettlements()) {
    if (s.polityId < 0) continue;
    const own = s.polityId;
    const clan = founders.get(own) ?? -2;
    // Its own tile, and the land it works.
    for (const t of [s.tile, ...s.territory]) {
      if (map.region[t] < 0 && (map.claim[t] < 0 || map.claim[t] === clan)) {
        map.region[t] = s.id;
        map.claim[t] = -1;
      }
    }
    // The hunting grounds of the clan that founded its nation become its land.
    if (clan >= 0) {
      const R = ring * 2;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const t = y * w + x;
          if (map.claim[t] === clan && map.region[t] < 0) {
            map.region[t] = s.id;
            map.claim[t] = -1;
          }
        }
      }
    }
    // Ranging out into open land next to its own.
    const want = 2 + Math.floor(Math.sqrt(s.pop) / 6);
    const options: [number, number][] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const t = y * w + x;
        if (map.region[t] >= 0 || map.claim[t] >= 0 || !holdable(world, t)) continue;
        const d = Math.hypot(x + 0.5 - s.px, y + 0.5 - s.py);
        const water = BIOMES[map.biome[t]].water;
        if (d > reach + 0.5 || (water && d > ring + 0.5) || (!water && map.landmass[t] !== s.landmass)) continue;
        let next = false;
        neighbours(w, h, t, (n) => {
          if (!next && map.region[n] === s.id) next = true;
        });
        if (!next) continue;
        // Easy, near country first; rough ground and steep hills last.
        options.push([t, d + Math.min(3, map.moveCost[t]) * 0.6 + rng.next() * 1.5]);
      }
    }
    options.sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < options.length && k < want; k++) map.region[options[k][0]] = s.id;
    // Hemmed in by a clan's hunting grounds: a growing settlement may go to war to clear them.
    if (options.length === 0 && s.pop > 300 && s.crowding > 0.1) {
      let aim = -1;
      let foe = -1;
      for (let dy = -reach; dy <= reach && aim < 0; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const t = y * w + x;
          const c = map.claim[t];
          if (c < 0 || c === clan || map.landmass[t] !== s.landmass) continue;
          let next = false;
          neighbours(w, h, t, (n) => {
            if (!next && map.region[n] === s.id) next = true;
          });
          if (next) {
            aim = t;
            foe = c;
            break;
          }
        }
      }
      const mil = world.cultures[s.cultureId].values.militarism;
      if (aim >= 0 && rng.chance(0.04 + mil * 0.1)) declareLandWar(world, s.polityId, clanCode(foe), aim, `to clear the hunting grounds next to ${s.name} for its people`);
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
  growRealms(world);
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
