import { BIOMES, Biome } from '../data/biomes';
import { EXTRACTION_SECTORS, Good, RES_COUNT, Res } from '../data/economy';
import { CITY_TILE_PEOPLE, LAND_USE_COUNT, LandUse, TIERS, USE_SECTORS, tierIndex } from '../data/settlements';
import type { Polity, Settlement } from '../types';
import type { World } from '../world';

const EXT = EXTRACTION_SECTORS.length;
const SECTOR_INDEX = new Map(EXTRACTION_SECTORS.map((s, i) => [s.key as string, i]));
/** Sectors (index, weight) each land use supports. */
const USE_IDX: [number, number][][] = Object.values(LandUse)
  .filter((v): v is LandUse => typeof v === 'number')
  .map((u) => USE_SECTORS[u].map(([key, w]) => [SECTOR_INDEX.get(key)!, w] as [number, number]));
const WORKABLE: LandUse[] = [LandUse.Fields, LandUse.Pasture, LandUse.Forestry, LandUse.Hunting, LandUse.Mine, LandUse.Quarry, LandUse.Salt, LandUse.Fishing];

/** How much a worked tile yields compared with the raw resource on it. */
const LAND_SCALE = 1.8;
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

/** How far, in tiles, the ring of land a settlement works reaches from its own tile: half the spacing between settlements. */
export function ringRadius(world: World): number {
  return Math.max(1, Math.ceil(world.cfg.settlementSpacing / 2));
}

/** A new settlement holds its own tile at once; the ring around it is shared out at the year's end. */
export function claimTile(world: World, s: Settlement, t: number, use: LandUse): void {
  const map = world.map;
  const prev = map.owner[t];
  if (prev >= 0 && prev !== s.id) {
    const o = world.settlements[prev];
    o.territory = o.territory.filter((x) => x !== t);
  }
  map.owner[t] = s.id;
  if (use !== LandUse.None || map.landUse[t] === LandUse.None) map.landUse[t] = use;
  if (!s.territory.includes(t)) s.territory.push(t);
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
 * Every settlement sits on one tile and works the ring of land around it. Where two rings
 * overlap, each tile goes to the nearer settlement (the larger one if they are as near).
 * Water in the ring can be fished; ice and the open ocean cannot be worked.
 */
function assignRings(world: World, alive: Settlement[]): void {
  const map = world.map;
  const w = map.width;
  const R = ringRadius(world);
  const best = new Float32Array(map.size).fill(Infinity);
  const owner = new Int32Array(map.size).fill(-1);
  for (const s of alive) {
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= map.height) continue;
        const t = y * w + x;
        const b = map.biome[t];
        if (b === Biome.DeepOcean || b === Biome.Ice) continue;
        if (!isWater(world, t) && map.landmass[t] !== s.landmass) continue;
        const d = dx === 0 && dy === 0 ? -1 : Math.hypot(dx, dy);
        if (d < best[t] - 1e-6) {
          best[t] = d;
          owner[t] = s.id;
        }
      }
    }
  }
  for (const s of alive) s.territory = [];
  for (let t = 0; t < map.size; t++) {
    const o = owner[t];
    if (o !== map.owner[t]) world.territoryDirty = true;
    map.owner[t] = o;
    if (o < 0) map.landUse[t] = LandUse.None;
    else world.settlements[o].territory.push(t);
  }
}

/** The size a settlement counts as, with slack so it does not flicker between sizes. */
function updateTier(s: Settlement): void {
  const now = tierIndex(s.pop);
  if (now > s.tier) s.tier = now;
  else while (s.tier > now && s.pop < TIERS[s.tier].minPop * SHRINK_SLACK) s.tier--;
}

/**
 * Newly worked land is shared out between uses: enough food land to feed the settlement first,
 * then each tile to what it is best for, with every extra tile of a use worth a little less, so
 * a settlement keeps a mix of fields, pasture, woods and hunting grounds rather than one of each.
 */
function fillNewLand(world: World, s: Settlement, v: Valuer): void {
  const map = world.map;
  const fresh = s.territory.filter((t) => map.landUse[t] === LandUse.None);
  if (!fresh.length) return;
  const count = new Array(LAND_USE_COUNT).fill(0);
  let food = 0;
  for (const t of s.territory) {
    const u = map.landUse[t];
    count[u]++;
    for (const [k, w] of USE_IDX[u]) if (EXTRACTION_SECTORS[k].output === Good.Food) food += tileSectorCap(world, v, t, k) * w * LAND_SCALE;
  }
  const need = Math.max(30, s.pop) * 1.5;
  // Best tiles first, so the richest ground is shared out before the poor.
  const ranked = fresh.map((t) => ({ t, v: bestUse(world, v, t)[1] })).sort((a, b) => b.v - a.v);
  for (const { t } of ranked) {
    let best = isWater(world, t) ? LandUse.None : LandUse.Hunting;
    let bv = 0;
    for (const u of WORKABLE) {
      let val = useValue(world, v, t, u);
      if (val <= 0) continue;
      const feeds = USE_IDX[u].some(([k]) => EXTRACTION_SECTORS[k].output === Good.Food);
      if (feeds && food < need) val *= 3;
      val /= 1 + count[u] * 0.25;
      if (val > bv) {
        bv = val;
        best = u;
      }
    }
    map.landUse[t] = best;
    count[best]++;
    for (const [k, w] of USE_IDX[best]) if (EXTRACTION_SECTORS[k].output === Good.Food) food += tileSectorCap(world, v, t, k) * w * LAND_SCALE;
  }
}

/**
 * Decide what the land is used for. Newly worked tiles go to whatever is most needed. After that
 * people keep to what they know: a tile changes use only when the new use is clearly worth more,
 * and only a few change in a year, more in hungry times. Clearing woodland for fields brings in its timber.
 */
function reassignUses(world: World, s: Settlement, v: Valuer): void {
  const map = world.map;
  fillNewLand(world, s, v);
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

/**
 * The town at a settlement's heart grows onto its land as its townsfolk (craftsmen, the idle and
 * their families) outgrow the City land they have. Its own tile is built over first; after that the
 * town eats whatever land is least needed. City land is never farmed again. Some peoples build
 * wide and low, others pack tight behind their walls.
 */
function growCity(world: World, s: Settlement, v: Valuer): void {
  const map = world.map;
  let city = 0;
  for (const t of s.territory) if (map.landUse[t] === LandUse.City) city++;
  if (TIERS[s.tier].urban) {
    const values = world.cultures[s.cultureId].values;
    const pack = Math.max(0.6, 1 + values.tradition * 0.5 - values.expansionism * 0.4);
    const wanted = Math.max(1, Math.ceil(s.urbanPop / (CITY_TILE_PEOPLE * pack)));
    let add = Math.min(wanted - city, s.crowding > 0.5 ? 2 : 1);
    while (add > 0) {
      let pick = map.landUse[s.tile] !== LandUse.City ? s.tile : -1;
      if (pick < 0) {
        let least = Infinity;
        for (const t of s.territory) {
          const u = map.landUse[t] as LandUse;
          if (u === LandUse.City || isWater(world, t)) continue;
          const val = Math.max(0, useValue(world, v, t, u)) * (1 + Math.hypot((t % map.width) - s.x, Math.floor(t / map.width) - s.y) * 0.1);
          if (val < least) {
            least = val;
            pick = t;
          }
        }
      }
      if (pick < 0) break;
      map.landUse[pick] = LandUse.City;
      city++;
      add--;
    }
  }
  s.cityTiles = city;
}

/** Sum up what the settlement's land can yield, sector by sector. */
function computeCapacity(world: World, s: Settlement, v: Valuer): void {
  const map = world.map;
  const R = map.resources;
  s.sectorCap.fill(0);
  s.resSum.fill(0);
  for (const t of s.territory) {
    for (const [k, w] of USE_IDX[map.landUse[t]]) s.sectorCap[k] += tileSectorCap(world, v, t, k) * w * LAND_SCALE;
    for (let r = 0; r < RES_COUNT; r++) s.resSum[r] += R[r][t];
  }
}

/**
 * Once a year: the rings of land are shared out between settlements, every settlement decides
 * what to use its land for, and works out what its land can yield.
 */
export function runLand(world: World): void {
  for (const s of world.settlements) if (!s.alive && s.territory.length) releaseAll(world, s);
  const alive = [...world.aliveSettlements()].sort((a, b) => b.pop - a.pop);
  assignRings(world, alive);
  for (const s of alive) {
    updateTier(s);
    const v = valuer(world, s);
    reassignUses(world, s, v);
    growCity(world, s, v);
    computeCapacity(world, s, v);
  }
}
