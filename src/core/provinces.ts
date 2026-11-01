import type { Climate } from './climate';
import { BAND, fineGeography, fineGrid, fineIndex, keepWhole, neighbours4, sampleGround } from './finegeo';
import { fbm } from './noise';
import type { Surface } from './paint';
import type { WorldSettings } from './settings';
import type { Grid } from './terrain';
import { assembleRings, traceChains } from './trace';
import { kmToMiles, milesToKm } from './units';

/**
 * Provinces (REDESIGN.md 8.6a), like Crusader Kings': the land and sea split into hundreds to
 * many thousands of pieces that follow the terrain. The generator works on a fine grid of the
 * painted ground:
 * - First it parts the world into zones that no province may cross: each natural region's land
 *   in its relief bands (lowland and hills; highlands; mountains; impassable peaks; plateaus),
 *   each lake, and each water (ocean, sea, gulf, bay), with big rivers and the coast between.
 *   Tiny slivers join the zone they border most.
 * - Each zone gets seeds about a province apart (sea provinces bigger), and the provinces grow
 *   out from them together, slower uphill and with a little noise so borders wander. Growth
 *   never leaves a zone, so a province never crosses a coast, a big river, a region's edge or a
 *   change of relief band, and every province is one piece.
 * - The seeds are kept with the world: updating the provinces after repainting grows them again
 *   from the same seeds (each keeps its id), adding seeds only where new ground needs them.
 */

export const PROVINCE_DEFAULTS = { sizeMi: 40, seaFactor: 3 };
export const PROVINCE_SIZE_MI = { min: 10, max: 150 };
/** At most this many fine points (so a huge map at a small province size stays workable). */
export const MAX_FINE_POINTS = 3_000_000;

/** What the world keeps: the settings and the seeds (km), each with its province's id. */
export interface SavedProvinces {
  v: 1;
  sizeMi: number;
  seaFactor: number;
  /** x, y of each seed (km). */
  seeds: number[];
  ids: number[];
  nextId: number;
  /** Changes painted by hand, in order (applied after the provinces grow). */
  edits?: ProvinceEdit[];
}

/** A stroke of the province paint tool: the ground under it (within `r` km of its line) goes to province `id`. */
export interface ProvinceEdit {
  id: number;
  r: number;
  pts: number[];
}

/** What a run keeps for the next (the provinces as grown, before hand edits), so painting needs only the last steps again. */
export interface ProvinceCache {
  key?: string;
  stage?: Stage;
}
interface Stage {
  grid: Grid;
  g: ReturnType<typeof sampleGround>;
  fg: ReturnType<typeof fineGeography>;
  zone: Int32Array;
  zm: Uint8Array;
  zg: Uint8Array;
  seedPix: number[];
  seedId: number[];
  nextId: number;
  label: Int32Array;
}

export type ProvinceKind = 'land' | 'sea' | 'lake' | 'wasteland';

export interface Province {
  id: number;
  kind: ProvinceKind;
  /** Its middle (km): where its label goes. */
  x: number;
  y: number;
  /** Area (km²). */
  area: number;
  /** "Forest", "Steppe hills", "Mountains", "Impassable peaks", "Sea", "Lake"… */
  terrain: string;
  /** Its main relief band (see BAND), on land. */
  band: number;
  /** Its natural region (land) and water (sea and lakes), −1 if none. */
  region: number;
  water: number;
  /** Land on the sea; a river runs through it. */
  coastal: boolean;
  river: boolean;
  /** The provinces next to it (indexes into the list). */
  neighbours: number[];
}

export interface ProvinceBorder {
  /** Points [x, y…] (km, the wrap seam unrolled). */
  pts: number[];
  /** The provinces on each side (indexes; −3 off the map's edge). */
  a: number;
  b: number;
}

export interface ProvinceMap {
  grid: Grid;
  wrapKm: number;
  /** The province (index into `provinces`) at each fine point. */
  label: Int32Array;
  provinces: Province[];
  borders: ProvinceBorder[];
  /** Each province's outline as closed rings (km). */
  rings: number[][][];
  saved: SavedProvinces;
}

export const OFF_MAP = -3;
const sq = (v: number) => v * v;

/** How far apart the fine points are for a province size: about six to a province across, coarser on a huge map. */
export function provinceGridKm(s: WorldSettings, sizeMi: number): number {
  return Math.max(milesToKm(sizeMi) / 6, Math.sqrt((s.widthKm * s.heightKm) / MAX_FINE_POINTS));
}

/** The smallest province size (miles) this map can hold well. */
export function smallestProvinceMi(s: WorldSettings): number {
  return Math.max(PROVINCE_SIZE_MI.min, Math.ceil(kmToMiles(Math.sqrt((s.widthKm * s.heightKm) / MAX_FINE_POINTS) * 6)));
}

/** Zone groups by relief band: lowland and hills together, then each higher band and plateaus on their own. */
const GROUP_OF_BAND = [0, 0, 1, 2, 3, 4];
const PEAKS_GROUP = 3;
const LAND = 0;
const LAKE = 1;
const SEA = 2;

/** Split the world into provinces. With `saved`, they grow from its seeds (keeping their ids); otherwise from new ones. */
export function generateProvinces(surface: Surface, s: WorldSettings, cl: Climate, opts: { sizeMi: number; seaFactor: number; saved?: SavedProvinces | null }, cache?: ProvinceCache): ProvinceMap {
  const sizeMi = Math.max(PROVINCE_SIZE_MI.min, Math.min(PROVINCE_SIZE_MI.max, opts.sizeMi));
  const seaFactor = Math.max(1, Math.min(8, opts.seaFactor));
  const fresh = !opts.saved || opts.saved.sizeMi !== sizeMi || opts.saved.seaFactor !== seaFactor;
  const keyBase = `${s.seed}|${s.widthKm}|${s.heightKm}|${s.edges}|${surface.nextId}|${surface.strokes.length}|${sizeMi}|${seaFactor}|`;
  const stage = !fresh && cache?.stage && cache.key === keyBase + seedSig(opts.saved!) ? cache.stage : growStage(surface, s, cl, sizeMi, seaFactor, fresh, opts.saved ?? null);
  const map = finish(stage, cl, sizeMi, seaFactor, opts.saved?.edits ?? []);
  if (cache) {
    cache.key = keyBase + seedSig(map.saved);
    cache.stage = stage;
  }
  return map;
}

const seedSig = (sv: SavedProvinces) => `${sv.nextId}:${sv.ids.length}:${Math.round(sv.seeds.reduce((a, b) => a + b, 0) * 100)}`;

/** Zones, seeds and growth: the provinces as grown, before hand edits. */
function growStage(surface: Surface, s: WorldSettings, cl: Climate, sizeMi: number, seaFactor: number, fresh: boolean, saved: SavedProvinces | null): Stage {
  const opts = { saved };
  const sizeKm = milesToKm(sizeMi);
  const grid = fineGrid(s, provinceGridKm(s, sizeMi));
  const g = sampleGround(surface, s, grid);
  const fg = fineGeography(cl, g, s.seed);
  const { w, h, px, x0, y0 } = grid;
  const n = w * h;
  const wrap = g.wrapKm > 0;
  const nb = neighbours4(w, h, wrap);
  const buf: number[] = [];

  // ---- Zones: what no province crosses ----
  // Keys: land by region and band group, lakes, and each water; big rivers are walls (−1).
  const key = new Int32Array(n);
  const medium = (k: number) => (!g.land[k] ? SEA : g.lake[k] ? LAKE : LAND);
  for (let k = 0; k < n; k++) {
    const m = medium(k);
    if (m === SEA) key[k] = -100 - (fg.water[k] + 1);
    else if (m === LAKE) key[k] = -10;
    else if (g.river[k] === 2) key[k] = -1;
    else key[k] = (fg.region[k] + 1) * 8 + GROUP_OF_BAND[g.band[k]];
  }
  const zone = new Int32Array(n).fill(-1);
  let zones = 0;
  {
    const stack: number[] = [];
    for (let k = 0; k < n; k++) {
      if (zone[k] >= 0 || key[k] === -1) continue;
      zone[k] = zones;
      stack.push(k);
      while (stack.length) {
        const c = stack.pop()!;
        for (const m of nb(c, buf)) if (zone[m] < 0 && key[m] === key[c]) {
          zone[m] = zones;
          stack.push(m);
        }
      }
      zones++;
    }
  }
  // Big rivers' own points go to the land beside them.
  {
    const queue: number[] = [];
    for (let k = 0; k < n; k++) if (zone[k] >= 0 && g.land[k]) queue.push(k);
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      for (const m of nb(k, buf)) if (zone[m] < 0) {
        zone[m] = zone[k];
        queue.push(m);
      }
    }
  }
  // What each zone is, and how big a province in it should be (fine points).
  const zMedium = new Uint8Array(zones);
  const zGroup = new Uint8Array(zones);
  for (let k = 0; k < n; k++) {
    const z = zone[k];
    if (z < 0 || key[k] === -1) continue;
    zMedium[z] = medium(k);
    zGroup[z] = medium(k) === LAND ? GROUP_OF_BAND[g.band[k]] : 0;
  }
  const pxArea = px * px;
  const landTarget = (sizeKm * sizeKm) / pxArea;
  const targetOf = (z: number) => (zMedium[z] === SEA ? sq(sizeKm * seaFactor) / pxArea : zMedium[z] === LAKE ? sq(sizeKm * 2) / pxArea : zGroup[z] === PEAKS_GROUP ? landTarget * 2.25 : landTarget);
  // Slivers join the zone they border most: land with land (lakes too small to stand alone
  // become land), water with water; a speck of land out at sea joins the sea.
  mergeSmallZones(zone, zones, nb, (z) => targetOf(z), zMedium);

  // Zones again, numbered 0…, with their points listed.
  const zoneIds = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const z = zone[k];
    if (z >= 0 && !zoneIds.has(z)) zoneIds.set(z, zoneIds.size);
  }
  const Z = zoneIds.size;
  const zm = new Uint8Array(Z);
  const zg = new Uint8Array(Z);
  for (const [old, nz] of zoneIds) {
    zm[nz] = zMedium[old];
    zg[nz] = zGroup[old];
  }
  const zoneSize = new Int32Array(Z);
  for (let k = 0; k < n; k++) {
    zone[k] = zoneIds.get(zone[k])!;
    zoneSize[zone[k]]++;
  }
  const target = (z: number) => (zm[z] === SEA ? sq(sizeKm * seaFactor) / pxArea : zm[z] === LAKE ? sq(sizeKm * 2) / pxArea : zg[z] === PEAKS_GROUP ? landTarget * 2.25 : landTarget);
  const zoneStart = new Int32Array(Z + 1);
  for (let z = 0; z < Z; z++) zoneStart[z + 1] = zoneStart[z] + zoneSize[z];
  const zonePix = new Int32Array(n);
  {
    const fill = zoneStart.slice(0, Z);
    for (let k = 0; k < n; k++) zonePix[fill[zone[k]]++] = k;
  }
  const xOf = (k: number) => x0 + (k % w) * px;
  const yOf = (k: number) => y0 + ((k / w) | 0) * px;
  const dxWrap = (dx: number) => (wrap ? dx - Math.round(dx / g.wrapKm) * g.wrapKm : dx);

  // ---- Seeds ----
  const seedPix: number[] = [];
  const seedId: number[] = [];
  const taken = new Set<number>();
  let nextId = opts.saved?.nextId ?? 1;
  const zoneSeeds: number[][] = Array.from({ length: Z }, () => []);
  if (!fresh && opts.saved) {
    const sv = opts.saved;
    for (let q = 0; q < sv.ids.length; q++) {
      const k = fineIndex(grid, g.wrapKm, sv.seeds[2 * q], sv.seeds[2 * q + 1]);
      if (k < 0 || taken.has(k)) continue;
      taken.add(k);
      zoneSeeds[zone[k]].push(seedPix.length);
      seedPix.push(k);
      seedId.push(sv.ids[q]);
    }
  }
  const hash = (a: number, b: number, c: number) => {
    let x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c + s.seed, 2246822519);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  for (let z = 0; z < Z; z++) {
    const size = zoneSize[z];
    const have = zoneSeeds[z].length;
    // Updating: new seeds only where provinces would otherwise come out over twice the size.
    if (have > 0 && size / have <= 2 * target(z)) continue;
    // About one seed to each cell of a lattice a province across (jittered), where the zone fills enough of the cell.
    const sp = Math.sqrt(target(z));
    const offX = hash(z, 1, 7) * sp;
    const offY = hash(z, 2, 7) * sp;
    const cells = new Map<number, { count: number; best: number; bd: number }>();
    for (let q = zoneStart[z]; q < zoneStart[z + 1]; q++) {
      const k = zonePix[q];
      const i = k % w;
      const j = (k / w) | 0;
      const ci = Math.floor((i + offX) / sp);
      const cj = Math.floor((j + offY) / sp);
      const tx = (ci + 0.25 + 0.5 * hash(ci, cj, z)) * sp - offX;
      const ty = (cj + 0.25 + 0.5 * hash(cj, ci, z + 99)) * sp - offY;
      const d = sq(i - tx) + sq(j - ty);
      const ck = ci * 1_000_003 + cj;
      const c = cells.get(ck);
      if (!c) cells.set(ck, { count: 1, best: k, bd: d });
      else {
        c.count++;
        if (d < c.bd) [c.best, c.bd] = [k, d];
      }
    }
    const old = zoneSeeds[z].map((si) => seedPix[si]);
    const farFromOld = (k: number) => old.every((o) => sq(dxWrap(xOf(o) - xOf(k))) + sq(yOf(o) - yOf(k)) > sq(sp * px * 0.6));
    // Cells the zone fills enough of first; then, while its provinces would still come out over
    // twice the size (a long, thin zone), the fullest of the rest; and at least one seed.
    const list = [...cells.values()].sort((p, q) => q.count - p.count);
    const sow = (k: number) => {
      taken.add(k);
      old.push(k);
      zoneSeeds[z].push(seedPix.length);
      seedPix.push(k);
      seedId.push(nextId++);
    };
    for (const c of list) if (c.count >= 0.35 * sp * sp && !taken.has(c.best) && farFromOld(c.best)) sow(c.best);
    for (const c of list) {
      if (zoneSeeds[z].length && size / zoneSeeds[z].length <= 2 * target(z)) break;
      if (!taken.has(c.best) && farFromOld(c.best)) sow(c.best);
    }
    if (!zoneSeeds[z].length && list.length && !taken.has(list[0].best)) sow(list[0].best);
  }

  // ---- Growth ----
  const noise = new Uint8Array(n);
  for (let k = 0; k < n; k++) noise[k] = Math.round(127.5 + 127.5 * Math.max(-1, Math.min(1, 1.8 * fbm(xOf(k), yOf(k), sizeKm * 0.4, px, s.seed + 611, 4))));
  let label = grow(seedPix, zone, noise, g.height, w, h, wrap, px);
  if (fresh) {
    // Even them out: each seed moves to its province's middle, and they grow again.
    for (let round = 0; round < 1; round++) {
      const S = seedPix.length;
      const sx = new Float64Array(S);
      const sy = new Float64Array(S);
      const cnt = new Int32Array(S);
      for (let k = 0; k < n; k++) {
        const l = label[k];
        if (l < 0) continue;
        sx[l] += dxWrap(xOf(k) - xOf(seedPix[l]));
        sy[l] += yOf(k);
        cnt[l]++;
      }
      const bd = new Float64Array(S).fill(Infinity);
      const best = seedPix.slice();
      for (let k = 0; k < n; k++) {
        const l = label[k];
        if (l < 0 || !cnt[l]) continue;
        const d = sq(dxWrap(xOf(k) - xOf(seedPix[l])) - sx[l] / cnt[l]) + sq(yOf(k) - sy[l] / cnt[l]);
        if (d < bd[l]) [bd[l], best[l]] = [d, k];
      }
      for (let l = 0; l < S; l++) seedPix[l] = best[l];
      label = grow(seedPix, zone, noise, g.height, w, h, wrap, px);
    }
  }
  // Each province in one piece (growing across corners can leave a corner cut off).
  wholeProvinces(label, zone, w, h, wrap);
  return { grid, g, fg, zone, zm, zg, seedPix, seedId, nextId, label };
}

/** Hand edits, then each province's record, borders and outline. */
function finish(st: Stage, cl: Climate, sizeMi: number, seaFactor: number, edits: ProvinceEdit[]): ProvinceMap {
  const { grid, g, fg, zone, zm, zg, seedPix, seedId, nextId } = st;
  const label = st.label.slice();
  const { w, h, px, x0, y0 } = grid;
  const n = w * h;
  const wrap = g.wrapKm > 0;
  const nb = neighbours4(w, h, wrap);
  const buf: number[] = [];
  const geo = cl.geo;
  const pxArea = px * px;
  const xOf = (k: number) => x0 + (k % w) * px;
  const yOf = (k: number) => y0 + ((k / w) | 0) * px;
  const dxWrap = (dx: number) => (wrap ? dx - Math.round(dx / g.wrapKm) * g.wrapKm : dx);
  if (edits.length) applyEdits(label, edits, seedId, g, grid);

  // ---- The provinces ----
  const S = seedPix.length;
  const cnt = new Int32Array(S);
  const sx = new Float64Array(S);
  const sy = new Float64Array(S);
  const bands = new Int32Array(S * 6);
  const river = new Uint8Array(S);
  const coastal = new Uint8Array(S);
  const pairs = new Set<number>();
  for (let k = 0; k < n; k++) {
    const l = label[k];
    if (l < 0) continue;
    cnt[l]++;
    sx[l] += dxWrap(xOf(k) - xOf(seedPix[l]));
    sy[l] += yOf(k);
    if (g.land[k]) bands[l * 6 + g.band[k]]++;
    if (g.river[k]) river[l] = 1;
    for (const m of nb(k, buf)) {
      const o = label[m];
      if (o < 0 || o === l) continue;
      if (g.land[k] && !g.land[m]) coastal[l] = 1;
      if (o > l) pairs.add(l * S + o);
    }
  }
  const neighbours: number[][] = Array.from({ length: S }, () => []);
  for (const p of pairs) {
    const a = Math.floor(p / S);
    const b = p - a * S;
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  // A province painted away entirely is gone (its seed stays, so the edit holds when the provinces are grown again).
  const rep = Int32Array.from(seedPix);
  for (let k = 0; k < n; k++) if (label[k] >= 0 && label[rep[label[k]]] !== label[k]) rep[label[k]] = k;
  const provinces: Province[] = [];
  for (let l = 0; l < S; l++) {
    const k0 = rep[l];
    const z = zone[k0];
    const md = zm[z];
    let band = 0;
    for (let b = 1; b < 6; b++) if (bands[l * 6 + b] > bands[l * 6 + band]) band = b;
    const region = md === SEA ? -1 : fg.region[k0];
    const water = md === SEA ? fg.water[k0] : -1;
    const kind: ProvinceKind = md === SEA ? 'sea' : md === LAKE ? 'lake' : zg[z] === PEAKS_GROUP ? 'wasteland' : 'land';
    const regionKind = region >= 0 ? geo?.regions[region]?.kind ?? 'Land' : 'Land';
    const terrain =
      kind === 'sea' ? geo?.waters[water]?.kind ?? 'Sea'
      : kind === 'lake' ? 'Lake'
      : kind === 'wasteland' ? 'Impassable peaks'
      : band === BAND.mountains ? 'Mountains'
      : band === BAND.highlands ? 'Highlands'
      : band === BAND.plateau ? 'Plateau'
      : band === BAND.hills && regionKind !== 'Mountains' && regionKind !== 'Highlands' ? `${regionKind} hills`
      : regionKind;
    let x = xOf(seedPix[l]) + (cnt[l] ? sx[l] / cnt[l] : 0);
    if (wrap) x = ((x % g.wrapKm) + g.wrapKm) % g.wrapKm;
    let y = cnt[l] ? sy[l] / cnt[l] : yOf(k0);
    // A crescent's middle can lie outside it: then its seed stands in.
    const km = fineIndex(grid, g.wrapKm, x, y);
    if (km < 0 || label[km] !== l) [x, y] = [xOf(k0), yOf(k0)];
    provinces.push({ id: seedId[l], kind, x, y, area: cnt[l] * pxArea, terrain, band, region, water, coastal: !!coastal[l], river: !!river[l], neighbours: neighbours[l] });
  }

  // ---- Borders and outlines ----
  const lx = (X: number) => x0 + (X - 0.5) * px;
  const ly = (Y: number) => y0 + (Y - 0.5) * px;
  const toKm = (p: number[]) => {
    const out = new Array<number>(p.length);
    for (let i = 0; i < p.length; i += 2) {
      out[i] = Math.round(lx(p[i]) * 100) / 100;
      out[i + 1] = Math.round(ly(p[i + 1]) * 100) / 100;
    }
    return out;
  };
  const held = (l: number) => l >= 0;
  const chains = traceChains(label, w, h, wrap, held, OFF_MAP, 0.9);
  const ringMap = assembleRings(chains, w, wrap, held);
  const borders = chains.map((c) => ({ pts: toKm(c.pts), a: c.left, b: c.right }));
  const rings = provinces.map((_, l) => (ringMap.get(l) ?? []).map(toKm));
  // Drop the provinces painted away, renumbering the rest.
  if (provinces.some((_, l) => !cnt[l])) {
    const to = new Int32Array(S).fill(-1);
    let m = 0;
    for (let l = 0; l < S; l++) if (cnt[l]) to[l] = m++;
    for (let k = 0; k < n; k++) if (label[k] >= 0) label[k] = to[label[k]];
    const keep = provinces.filter((_, l) => cnt[l]);
    for (const p of keep) p.neighbours = p.neighbours.map((q) => to[q]).filter((q) => q >= 0);
    for (const b of borders) {
      if (b.a >= 0) b.a = to[b.a];
      if (b.b >= 0) b.b = to[b.b];
    }
    const keptRings = rings.filter((_, l) => cnt[l]);
    provinces.length = 0;
    provinces.push(...keep);
    rings.length = 0;
    rings.push(...keptRings);
  }

  const saved: SavedProvinces = {
    v: 1,
    sizeMi,
    seaFactor,
    seeds: seedPix.flatMap((k) => [Math.round(xOf(k) * 100) / 100, Math.round(yOf(k) * 100) / 100]),
    ids: seedId.slice(),
    nextId,
    ...(edits.length ? { edits } : {}),
  };
  return { grid, wrapKm: g.wrapKm, label, provinces, borders, rings, saved };
}

/** Zones smaller than about a fifth of a province join the zone they border most (see generateProvinces). */
function mergeSmallZones(zone: Int32Array, zones: number, nb: (k: number, out: number[]) => number[], target: (z: number) => number, medium: Uint8Array): void {
  const n = zone.length;
  const buf: number[] = [];
  const parent = new Int32Array(zones);
  for (let z = 0; z < zones; z++) parent[z] = z;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let round = 0; round < 6; round++) {
    const size = new Float64Array(zones);
    for (let k = 0; k < n; k++) size[find(zone[k])]++;
    const small = (z: number) => {
      const t = target(z);
      return medium[z] === LAKE ? size[z] < t * 0.04 : medium[z] === SEA ? size[z] < t * 0.08 : size[z] < t * 0.2;
    };
    const border = new Map<number, Map<number, number>>();
    for (let k = 0; k < n; k++) {
      const a = find(zone[k]);
      if (!small(a)) continue;
      for (const m of nb(k, buf)) {
        const b = find(zone[m]);
        if (b === a) continue;
        let row = border.get(a);
        if (!row) border.set(a, (row = new Map()));
        row.set(b, (row.get(b) ?? 0) + 1);
      }
    }
    if (!border.size) return;
    let merged = 0;
    const landish = (z: number) => medium[z] !== SEA;
    for (const a of [...border.keys()].sort((p, q) => size[p] - size[q])) {
      const ra = find(a);
      if (ra !== a) continue;
      const row = border.get(a)!;
      // Same kind of ground first (land and lakes together, water with water); a tiny island may join the sea round it.
      let best = -1;
      let bc = 0;
      for (const [b, c] of row) {
        const rb = find(b);
        if (rb === a || landish(rb) !== landish(a)) continue;
        if (c > bc) [best, bc] = [rb, c];
      }
      if (best < 0 && (size[a] < 3 || !landish(a))) for (const [b, c] of row) {
        const rb = find(b);
        if (rb !== a && c > bc) [best, bc] = [rb, c];
      }
      if (best < 0) continue;
      parent[a] = best;
      merged++;
    }
    for (let k = 0; k < n; k++) zone[k] = find(zone[k]);
    if (!merged) return;
  }
}

/**
 * All provinces grow out from their seeds at once, each step costing more uphill and a little
 * more or less by the noise, never leaving the seed's zone (Dial's shortest paths: costs are
 * whole numbers, so a ring of buckets serves as the queue).
 */
function grow(seeds: number[], zone: Int32Array, noise: Uint8Array, height: Float32Array, w: number, h: number, wrap: boolean, px: number): Int32Array {
  const n = w * h;
  const B = 256;
  const MASK = B - 1;
  const dist = new Int32Array(n).fill(0x7fffffff);
  const label = new Int32Array(n).fill(-1);
  // How dear a step onto each point is (before slope), from the noise.
  const dear = new Float32Array(256);
  for (let v = 0; v < 256; v++) dear[v] = 0.45 + (1.1 * v) / 255;
  let cap = Math.max(1024, n >> 2);
  let nodePix = new Int32Array(cap);
  let nodeLab = new Int32Array(cap);
  let nodeNext = new Int32Array(cap);
  let used = 0;
  let free = -1;
  const head = new Int32Array(B).fill(-1);
  let pending = 0;
  const slopeK = 30 / px;
  // Steps (di, dj) and their base costs: four straight, four across corners, and eight knight's
  // moves, so borders can run at any angle (not only along the grid and its diagonals).
  const DI = [1, -1, 0, 0, 1, -1, 1, -1, 2, 2, -2, -2, 1, -1, 1, -1];
  const DJ = [0, 0, 1, -1, 1, 1, -1, -1, 1, -1, 1, -1, 2, 2, -2, -2];
  const BASE = [10, 10, 10, 10, 14, 14, 14, 14, 22, 22, 22, 22, 22, 22, 22, 22];
  const col = (i: number) => (i < 0 ? i + w : i >= w ? i - w : i);
  const enqueue = (d: number, p: number, l: number) => {
    dist[p] = d;
    let node: number;
    if (free >= 0) {
      node = free;
      free = nodeNext[node];
    } else {
      if (used === cap) {
        cap = Math.ceil(cap * 1.6);
        const a = new Int32Array(cap);
        a.set(nodePix);
        nodePix = a;
        const b = new Int32Array(cap);
        b.set(nodeLab);
        nodeLab = b;
        const c = new Int32Array(cap);
        c.set(nodeNext);
        nodeNext = c;
      }
      node = used++;
    }
    nodePix[node] = p;
    nodeLab[node] = l;
    const b = d & MASK;
    nodeNext[node] = head[b];
    head[b] = node;
    pending++;
  };
  for (let l = 0; l < seeds.length; l++) if (dist[seeds[l]] > 0) enqueue(0, seeds[l], l);
  let cur = 0;
  while (pending > 0) {
    const node = head[cur & MASK];
    if (node < 0) {
      cur++;
      continue;
    }
    head[cur & MASK] = nodeNext[node];
    pending--;
    const p = nodePix[node];
    const l = nodeLab[node];
    nodeNext[node] = free;
    free = node;
    if (label[p] >= 0 || dist[p] !== cur) continue;
    label[p] = l;
    const z = zone[p];
    const i = p % w;
    const j = (p - i) / w;
    const hp = height[p];
    for (let q = 0; q < 16; q++) {
      const jj = j + DJ[q];
      if (jj < 0 || jj >= h) continue;
      let ii = i + DI[q];
      if (ii < 0 || ii >= w) {
        if (!wrap) continue;
        ii = col(ii);
      }
      const m = jj * w + ii;
      if (label[m] >= 0 || zone[m] !== z) continue;
      // Across a corner only where the way round it is in the zone too.
      if (q >= 4 && q < 8 && zone[j * w + ii] !== z && zone[jj * w + i] !== z) continue;
      // A knight's move only past points in the zone (the two it passes between).
      if (q >= 8) {
        const di = DI[q];
        const dj = DJ[q];
        // The two points the move passes between: half way along its long side, on each side of the line.
        const longI = di === 2 || di === -2;
        const p1 = longI ? j * w + (wrap ? col(i + di / 2) : i + di / 2) : (j + dj / 2) * w + i;
        const p2 = longI ? jj * w + (wrap ? col(i + di / 2) : i + di / 2) : (j + dj / 2) * w + ii;
        if (zone[p1] !== z || zone[p2] !== z) continue;
      }
      let slope = slopeK * Math.abs(height[m] - hp);
      if (slope > 2.5) slope = 2.5;
      const c = (BASE[q] * dear[noise[m]] * (1 + slope) + 0.5) | 0;
      const d = cur + (c > 0 ? c : 1);
      if (d < dist[m]) enqueue(d, m, l);
    }
  }
  return label;
}

/**
 * Each province in one piece: a piece cut off from the rest of its province (where growth went
 * across a corner) joins the province in its zone that it borders most.
 */
function wholeProvinces(label: Int32Array, zone: Int32Array, w: number, h: number, wrap: boolean): void {
  const n = w * h;
  const piece = new Int32Array(n);
  const stack = new Int32Array(n);
  const nbr = new Int32Array(4);
  const around = (k: number): number => {
    const i = k % w;
    let c = 0;
    if (i > 0) nbr[c++] = k - 1;
    else if (wrap) nbr[c++] = k + w - 1;
    if (i < w - 1) nbr[c++] = k + 1;
    else if (wrap) nbr[c++] = k - w + 1;
    if (k >= w) nbr[c++] = k - w;
    if (k < n - w) nbr[c++] = k + w;
    return c;
  };
  for (let round = 0; round < 4; round++) {
    piece.fill(-1);
    const size: number[] = [];
    const of: number[] = [];
    for (let k = 0; k < n; k++) {
      if (piece[k] >= 0 || label[k] < 0) continue;
      const p = size.length;
      const l = label[k];
      let top = 0;
      let cnt = 0;
      piece[k] = p;
      stack[top++] = k;
      while (top) {
        const c = stack[--top];
        cnt++;
        const nc = around(c);
        for (let q = 0; q < nc; q++) {
          const m = nbr[q];
          if (piece[m] < 0 && label[m] === l) {
            piece[m] = p;
            stack[top++] = m;
          }
        }
      }
      size.push(cnt);
      of.push(l);
    }
    const main = new Map<number, number>();
    for (let p = 0; p < size.length; p++) {
      const m = main.get(of[p]);
      if (m === undefined || size[p] > size[m]) main.set(of[p], p);
    }
    if (main.size === size.length) return;
    const border = new Map<number, Map<number, number>>();
    for (let k = 0; k < n; k++) {
      const p = piece[k];
      if (p < 0 || main.get(of[p]) === p) continue;
      const nc = around(k);
      for (let q = 0; q < nc; q++) {
        const m = nbr[q];
        if (label[m] < 0 || label[m] === label[k] || zone[m] !== zone[k]) continue;
        let row = border.get(p);
        if (!row) border.set(p, (row = new Map()));
        row.set(label[m], (row.get(label[m]) ?? 0) + 1);
      }
    }
    if (!border.size) return;
    const into = new Map<number, number>();
    for (const [p, row] of border) {
      let best = -1;
      let bc = 0;
      for (const [l, c] of row) if (c > bc) [best, bc] = [l, c];
      if (best >= 0) into.set(p, best);
    }
    for (let k = 0; k < n; k++) {
      const p = piece[k];
      if (p < 0) continue;
      const t = into.get(p);
      if (t !== undefined) label[k] = t;
    }
  }
}

/**
 * Hand edits: the ground within each stroke goes to its province, land to land and sea to sea
 * (a stroke never turns land into a sea province, or the reverse). Afterwards every province is
 * one piece again: ground cut off from its province by the paint joins the province round it.
 */
function applyEdits(label: Int32Array, edits: ProvinceEdit[], seedId: number[], g: ReturnType<typeof sampleGround>, grid: Grid): void {
  const { w, h, px, x0, y0 } = grid;
  const wrap = g.wrapKm > 0;
  const index = new Map(seedId.map((id, l) => [id, l]));
  const wet = (k: number) => !g.land[k];
  for (const e of edits) {
    const l = index.get(e.id);
    if (l === undefined || e.r <= 0 || e.pts.length < 2) continue;
    // Which ground the province is (from any point it holds now).
    let mine = -1;
    for (let k = 0; k < label.length && mine < 0; k++) if (label[k] === l) mine = k;
    if (mine < 0) continue;
    const sea = wet(mine);
    const R = Math.ceil(e.r / px);
    const pts = e.pts.length === 2 ? [e.pts[0], e.pts[1], e.pts[0], e.pts[1]] : e.pts;
    for (let q = 0; q + 3 < pts.length; q += 2) {
      const ax = pts[q];
      const ay = pts[q + 1];
      let bx = pts[q + 2];
      const by = pts[q + 3];
      if (wrap && Math.abs(bx - ax) > g.wrapKm / 2) bx -= Math.sign(bx - ax) * g.wrapKm;
      const i0 = Math.floor((Math.min(ax, bx) - x0) / px) - R;
      const i1 = Math.ceil((Math.max(ax, bx) - x0) / px) + R;
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - y0) / px) - R);
      const j1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) - y0) / px) + R);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        let i = ii;
        if (i < 0 || i >= w) {
          if (!wrap) continue;
          i = ((i % w) + w) % w;
        }
        const x = x0 + ii * px;
        const y = y0 + j * px;
        const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 > e.r * e.r) continue;
        const k = j * w + i;
        if (wet(k) === sea) label[k] = l;
      }
    }
  }
  keepWhole(label, () => true, neighbours4(w, h, wrap), (k, m) => wet(k) === wet(m));
}
