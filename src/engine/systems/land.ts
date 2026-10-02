import { BIOMES, Biome } from '../data/biomes';
import { EXTRACTION_SECTORS, Good, RES_COUNT, Res } from '../data/economy';
import { LandUse, TIERS, USE_SECTORS, tierIndex } from '../data/settlements';
import type { Polity, Settlement } from '../types';
import type { World } from '../world';

const EXT = EXTRACTION_SECTORS.length;
const SECTOR_INDEX = new Map(EXTRACTION_SECTORS.map((s, i) => [s.key as string, i]));
/** Sectors (index, weight) each land use supports. */
const USE_IDX: [number, number][][] = Object.values(LandUse)
  .filter((v): v is LandUse => typeof v === 'number')
  .map((u) => USE_SECTORS[u].map(([key, w]) => [SECTOR_INDEX.get(key)!, w] as [number, number]));
const WORKABLE: LandUse[] = [LandUse.Fields, LandUse.Pasture, LandUse.Forestry, LandUse.Hunting, LandUse.Mine, LandUse.Quarry, LandUse.Salt, LandUse.Fishing];
/** Sectors that can also draw on unclaimed common land: hunting, grazing, gathering wood. */
const COMMON_SECTORS = ['foraging', 'herding', 'forestry', 'arcanaGathering'].map((k) => SECTOR_INDEX.get(k)!);

/** How much a settlement's own, worked tile yields compared with the raw resource. */
const LAND_SCALE = 2.4;
/** Common land is shared and worked loosely: a fraction of a claimed tile's worth. */
const COMMONS_SCALE = 0.55;
const COMMONS_RADIUS = 2;
/** A tile changes use only if the new use is worth this much more (people keep to what they know). */
const INERTIA = 1.3;
/** A settlement drops a size only when its people fall this far below the size's threshold. */
const SHRINK_SLACK = 0.8;

const ORES = [Res.Copper, Res.Tin, Res.Iron, Res.Coal, Res.Gold, Res.Gems];

function isWater(world: World, t: number): boolean {
  return BIOMES[world.map.biome[t]].water;
}

/** Can this land use be put on this tile at all? */
export function useAllowed(world: World, t: number, u: LandUse): boolean {
  const map = world.map;
  const R = map.resources;
  const b = map.biome[t];
  if (b === Biome.DeepOcean || b === Biome.Ice) return false;
  if (u === LandUse.Fishing) return isWater(world, t) || R[Res.Fish][t] > 0.15;
  if (isWater(world, t)) return false;
  switch (u) {
    case LandUse.Mine: return ORES.some((r) => R[r][t] > 0.1);
    case LandUse.Quarry: return R[Res.Stone][t] > 0.15;
    case LandUse.Salt: return R[Res.Salt][t] > 0.1;
    default: return true;
  }
}

function sectorAvailable(world: World, p: Polity, k: number): boolean {
  const sec = EXTRACTION_SECTORS[k];
  if (sec.requiresTech && !p.techs.has(sec.requiresTech)) return false;
  if (sec.requiresMetallurgy !== undefined && p.effects.metallurgy < sec.requiresMetallurgy) return false;
  if (sec.key === 'arcanaGathering' && world.cfg.magic <= 0) return false;
  return true;
}

/** Context for valuing tiles for one settlement: its people's gifts and the state of its economy. */
interface Valuer {
  s: Settlement;
  habitat: Record<string, number>;
  available: boolean[];
  /** How much more land each sector wants, 0..1. */
  want: number[];
}

function valuer(world: World, s: Settlement): Valuer {
  const race = world.majorityRace(s);
  const learned = world.cultures[s.cultureId].traitEffects.habitat;
  const habitat: Record<string, number> = { ...(race.habitat ?? {}) };
  for (const k in learned) habitat[k] = (habitat[k] ?? 0) + (learned as Record<string, number>)[k];
  const p = world.polities[s.polityId];
  const available: boolean[] = [];
  const want: number[] = [];
  for (let k = 0; k < EXT; k++) {
    available[k] = sectorAvailable(world, p, k);
    const x = s.sectorPressure[k];
    // A sector with no land yet has a latent want; otherwise it wants land as its workers crowd what it has.
    want[k] = !available[k] ? 0 : x < 0 ? 0.6 : 1 - Math.exp(-x) * (1 + x);
  }
  return { s, habitat, available, want };
}

/** Raw capacity of one tile for one sector (before scaling). */
function tileSectorCap(world: World, v: Valuer, t: number, k: number): number {
  const sec = EXTRACTION_SECTORS[k];
  const R = world.map.resources;
  let c = 0;
  for (const [r, scale] of sec.capacity) c += R[r][t] * scale;
  if (sec.key === 'farming' || sec.key === 'foraging') {
    // Peoples gifted at living off land others find barren (dwarves in the hills, elves in the woods...).
    const h = v.habitat[BIOMES[world.map.biome[t]].key] ?? 0;
    if (h) c += h * (sec.key === 'farming' ? 200 : 35);
  }
  return Math.max(0, c);
}

/** What a tile is worth to a settlement if put to a given use, at its local prices and needs. */
function useValue(world: World, v: Valuer, t: number, u: LandUse): number {
  if (!useAllowed(world, t, u)) return -1;
  let val = 0;
  for (const [k, w] of USE_IDX[u]) {
    if (!v.available[k]) continue;
    val += tileSectorCap(world, v, t, k) * w * v.want[k] * v.s.price[EXTRACTION_SECTORS[k].output];
  }
  return val;
}

function bestUse(world: World, v: Valuer, t: number): [LandUse, number] {
  let best = LandUse.None;
  let bv = 0;
  for (const u of WORKABLE) {
    const val = useValue(world, v, t, u);
    if (val > bv) {
      bv = val;
      best = u;
    }
  }
  if (best === LandUse.None && !isWater(world, t)) best = LandUse.Hunting;
  return [best, bv];
}

function chebyshev(world: World, a: number, b: number): number {
  const w = world.map.width;
  return Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
}

/** Claim a tile for a settlement, taking it from whoever held it. */
export function claimTile(world: World, s: Settlement, t: number, use: LandUse): void {
  const map = world.map;
  const prev = map.owner[t];
  if (prev === s.id) return;
  if (prev >= 0) {
    const o = world.settlements[prev];
    o.territory = o.territory.filter((x) => x !== t);
  }
  map.owner[t] = s.id;
  map.landUse[t] = use;
  s.territory.push(t);
  world.territoryDirty = true;
}

function releaseTile(world: World, s: Settlement, t: number): void {
  world.map.owner[t] = -1;
  world.map.landUse[t] = LandUse.None;
  s.territory = s.territory.filter((x) => x !== t);
  world.territoryDirty = true;
}

/** Let go of all land: the settlement is gone. */
export function releaseAll(world: World, s: Settlement): void {
  for (const t of s.territory) {
    if (world.map.owner[t] === s.id) {
      world.map.owner[t] = -1;
      world.map.landUse[t] = LandUse.None;
    }
  }
  s.territory = [];
  world.territoryDirty = true;
}

/**
 * Tiles a settlement could claim next: unclaimed, within its reach, joined to its land. Land
 * spreads tile by tile along the ground; it does not jump a river to the far bank (a river tile
 * itself can be taken) unless the settlement is a city able to bridge it and has no room on its own side.
 */
function frontier(world: World, s: Settlement, reach: number): number[] {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  const claimed = new Set(s.territory);
  const bridging = s.tier >= 4;
  const homeOnRiver = map.river[s.tile] > 0;
  const firstBank = homeOnRiver && !s.territory.some((t) => t !== s.tile && !isWater(world, t) && map.river[t] <= 0);
  const out = new Set<number>();
  const near: number[] = [];
  const far: number[] = [];
  for (const c of s.territory) {
    const cx = c % w;
    const cy = (c - cx) / w;
    const cWater = isWater(world, c);
    const cRiver = !cWater && map.river[c] > 0 && !(c === s.tile && (firstBank || !homeOnRiver));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const n = y * w + x;
        if (claimed.has(n) || out.has(n) || map.owner[n] >= 0) continue;
        if (chebyshev(world, n, s.tile) > reach) continue;
        const b = map.biome[n];
        if (b === Biome.DeepOcean || b === Biome.Ice) continue;
        const nWater = isWater(world, n);
        if (nWater) {
          out.add(n);
          near.push(n);
          continue;
        }
        if (map.landmass[n] !== s.landmass || cWater) continue;
        const diagonal = dx !== 0 && dy !== 0;
        if (diagonal) continue; // land spreads edge to edge, so it cannot slip diagonally past a river
        if (map.river[n] > 0) {
          out.add(n);
          near.push(n);
        } else if (!cRiver) {
          out.add(n);
          near.push(n);
        } else if (bridging) {
          // Across the river: only once a city can bridge it, and only when its own bank is full.
          out.add(n);
          far.push(n);
        }
      }
    }
  }
  return near.length ? near : far;
}

/** The size a settlement counts as, with slack so it does not flicker between sizes. */
function updateTier(s: Settlement): void {
  const now = tierIndex(s.pop);
  if (now > s.tier) s.tier = now;
  else while (s.tier > now && s.pop < TIERS[s.tier].minPop * SHRINK_SLACK) s.tier--;
}

function claimAndRelease(world: World, s: Settlement, v: Valuer): void {
  const map = world.map;
  if (map.owner[s.tile] !== s.id) {
    const [use] = bestUse(world, v, s.tile);
    claimTile(world, s, s.tile, use);
  }
  const tier = TIERS[s.tier];
  // Growing into a new size, a settlement takes up its new land over a few years.
  let toClaim = Math.min(tier.tiles - s.territory.length, Math.max(2, Math.ceil(tier.tiles / 4)));
  s.hemmedIn = false;
  while (toClaim > 0) {
    const cand = frontier(world, s, tier.reach);
    if (!cand.length) {
      s.hemmedIn = true;
      break;
    }
    let best = -1;
    let bs = -Infinity;
    for (const t of cand) {
      const [, val] = bestUse(world, v, t);
      // Rough or far ground is claimed last; tiles that round off the settlement's land first.
      const rough = 1 + Math.max(0, map.moveCost[t] - 1) * 0.25;
      const d = chebyshev(world, t, s.tile);
      const score = (val + 0.01) / rough / (1 + d * 0.15);
      if (score > bs) {
        bs = score;
        best = t;
      }
    }
    const [use] = bestUse(world, v, best);
    claimTile(world, s, best, use);
    toClaim--;
  }
  // A shrinking settlement lets its least valuable land go back to the wild.
  let excess = Math.min(2, s.territory.length - tier.tiles);
  while (excess > 0) {
    let worst = -1;
    let wv = Infinity;
    for (const t of s.territory) {
      if (t === s.tile) continue;
      const val = useValue(world, v, t, map.landUse[t] as LandUse);
      const d = chebyshev(world, t, s.tile);
      const score = val / (1 + d * 0.3);
      if (score < wv) {
        wv = score;
        worst = t;
      }
    }
    if (worst < 0) break;
    releaseTile(world, s, worst);
    excess--;
  }
}

/**
 * Put tiles to new uses where the need is great enough. People keep to what they know: a tile
 * changes use only when the new use is clearly worth more, and only a few change in a year,
 * more in hungry times. Clearing woodland for fields brings in its timber.
 */
function reassignUses(world: World, s: Settlement, v: Valuer): void {
  const map = world.map;
  const hungry = s.foodRatio < 0.95 || s.lastHungry > 2;
  const changes = 1 + (hungry ? 2 : 0) + (s.foodRatio < 0.8 ? 2 : 0);
  const options: { t: number; u: LandUse; gain: number }[] = [];
  for (const t of s.territory) {
    const cur = map.landUse[t] as LandUse;
    if (cur === LandUse.City) continue;
    const curV = Math.max(0, useValue(world, v, t, cur));
    const [u, val] = bestUse(world, v, t);
    const gain = val - curV * INERTIA;
    if (u !== cur && gain > 0) options.push({ t, u, gain });
  }
  options.sort((a, b) => b.gain - a.gain);
  for (const { t, u } of options.slice(0, changes)) {
    const cur = map.landUse[t] as LandUse;
    // Felling the woods to clear the fields brings in their timber.
    if (u === LandUse.Fields && (cur === LandUse.Forestry || cur === LandUse.Hunting)) s.stock[Good.Timber] += map.resources[Res.Timber][t] * 140 * 0.6;
    map.landUse[t] = u;
  }
}

/** Sum up what the settlement's land and its share of the common land can yield, sector by sector. */
function computeCapacity(world: World, s: Settlement, v: Valuer): void {
  const map = world.map;
  const R = map.resources;
  s.sectorCap.fill(0);
  s.resSum.fill(0);
  for (const t of s.territory) {
    for (const [k, w] of USE_IDX[map.landUse[t]]) s.sectorCap[k] += tileSectorCap(world, v, t, k) * w * LAND_SCALE;
    for (let r = 0; r < RES_COUNT; r++) s.resSum[r] += R[r][t];
  }
  // Common land: unclaimed wild land within a short walk, shared with the other settlements around it.
  const w = map.width;
  let commons = 0;
  for (let dy = -COMMONS_RADIUS; dy <= COMMONS_RADIUS; dy++) {
    for (let dx = -COMMONS_RADIUS; dx <= COMMONS_RADIUS; dx++) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= map.height) continue;
      const t = y * w + x;
      if (map.owner[t] >= 0 || isWater(world, t) || map.biome[t] === Biome.Ice || map.landmass[t] !== s.landmass) continue;
      const share = COMMONS_SCALE / Math.max(1, map.commons[t]);
      commons++;
      for (const k of COMMON_SECTORS) s.sectorCap[k] += tileSectorCap(world, v, t, k) * share;
      for (let r = 0; r < RES_COUNT; r++) s.resSum[r] += R[r][t] * 0.5;
    }
  }
  s.commonTiles = commons;
}

/** Count how many settlements share each unclaimed tile as common land. */
function countCommons(world: World): void {
  const map = world.map;
  const w = map.width;
  map.commons.fill(0);
  for (const s of world.aliveSettlements()) {
    for (let dy = -COMMONS_RADIUS; dy <= COMMONS_RADIUS; dy++) {
      for (let dx = -COMMONS_RADIUS; dx <= COMMONS_RADIUS; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= map.height) continue;
        const t = y * w + x;
        if (map.owner[t] < 0 && map.commons[t] < 255) map.commons[t]++;
      }
    }
  }
}

/**
 * Once a year, every settlement takes up or gives back land to match its size, puts its tiles
 * to the uses its people most need, and works out what its land can yield.
 */
export function runLand(world: World): void {
  for (const s of world.settlements) if (!s.alive && s.territory.length) releaseAll(world, s);
  const alive = [...world.aliveSettlements()].sort((a, b) => b.pop - a.pop);
  for (const s of alive) {
    updateTier(s);
    const v = valuer(world, s);
    claimAndRelease(world, s, v);
    reassignUses(world, s, v);
  }
  countCommons(world);
  for (const s of alive) computeCapacity(world, s, valuer(world, s));
}

export { EXT as EXTRACTION_COUNT };
