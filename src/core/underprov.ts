import { fineGrid, fineIndex, neighbours4, sampleGround } from './finegeo';
import { fbm } from './noise';
import type { Surface } from './paint';
import { grow, mergeSmallZones, OFF_MAP, PROVINCE_SIZE_MI, provinceGridKm, wholeProvinces } from './provinces';
import type { WorldSettings } from './settings';
import type { Grid } from './terrain';
import { assembleRings, traceChains } from './trace';
import { dabsOf, underStrokes, UNDER_NAMES, type UnderCover } from './underdark';
import { milesToKm } from './units';

/**
 * Underdark provinces (Phase 12, the layers' provinces, step 1). All the rock under the land is
 * split into provinces, as the surface is, and the painting shapes them the way canyons and rivers
 * shape the surface's:
 * - Solid rock: provinces like the land's (held like any; only diggers cross them, by the tunnels
 *   they dig, which become their roads).
 * - Caverns: each cave system its own zone, split into provinces of their own (the main roads of
 *   the Underdark run through them and the tunnels).
 * - Tunnels: strips, a province every so far along (like rivers on the surface).
 * - Underground seas: provinces of their own, bigger.
 * Beyond the land there is nothing below (sea). Like the surface's, the provinces are grown from
 * seeds kept with the world, so updating them after repainting keeps each where it was (and its id).
 */

export type UnderProvKind = 'rock' | 'cavern' | 'tunnel' | 'sea';

/** The sizes (miles): how far across a rock, cavern and sea province is, and how long a stretch of tunnel. */
export interface UnderSizes {
  rockMi: number;
  cavernMi: number;
  tunnelMi: number;
  seaMi: number;
}
export const UNDER_SIZE_DEFAULTS: UnderSizes = { rockMi: 60, cavernMi: 40, tunnelMi: 40, seaMi: 80 };
export const underSizesOf = (o: Partial<UnderSizes> | null | undefined): UnderSizes => {
  const mi = (v: number | undefined, d: number) => Math.max(PROVINCE_SIZE_MI.min, Math.min(PROVINCE_SIZE_MI.max, typeof v === 'number' && Number.isFinite(v) ? v : d));
  return { rockMi: mi(o?.rockMi, UNDER_SIZE_DEFAULTS.rockMi), cavernMi: mi(o?.cavernMi, UNDER_SIZE_DEFAULTS.cavernMi), tunnelMi: mi(o?.tunnelMi, UNDER_SIZE_DEFAULTS.tunnelMi), seaMi: mi(o?.seaMi, UNDER_SIZE_DEFAULTS.seaMi) };
};

/** What the world keeps: the sizes and the seeds (km), each with its province's id. */
export interface SavedUnderProvinces extends UnderSizes {
  v: 1;
  seeds: number[];
  ids: number[];
  nextId: number;
}

export interface UnderProvince {
  id: number;
  kind: UnderProvKind;
  x: number;
  y: number;
  /** km². */
  area: number;
  /** "Solid rock", "Cavern", "Tunnel", "Underground sea". */
  terrain: string;
  /** The ground cover over most of its floor, if any. */
  cover: UnderCover | null;
  neighbours: number[];
}

export interface UnderProvinceMap {
  grid: Grid;
  wrapKm: number;
  label: Int32Array;
  provinces: UnderProvince[];
  borders: { pts: number[]; a: number; b: number }[];
  rings: number[][][];
  saved: SavedUnderProvinces;
}

// The medium of each fine point (0: nothing below, beyond the land).
const NONE = 0;
const ROCK = 1;
const CAVERN = 2;
const TUNNEL = 3;
const SEA = 4;
const KIND: UnderProvKind[] = ['rock', 'rock', 'cavern', 'tunnel', 'sea'];
const COVER: (UnderCover | null)[] = [null, 'fungus', 'glowcave', 'crystalcave'];

const sq = (v: number) => v * v;

/**
 * The Underdark painted onto the fine grid: what each point is (rock, cavern, tunnel, sea, or
 * nothing beyond the land) and its cover, the strokes taken in order as `underdarkAt` takes them.
 * Tunnels are at least one point wide, so even a narrow one runs unbroken.
 */
export function rasterUnderdark(surface: Surface, grid: Grid, wrapKm: number, land: Uint8Array): { medium: Uint8Array; cover: Uint8Array } {
  const { w, h, px, x0, y0 } = grid;
  const n = w * h;
  const open = new Uint8Array(n); // 0 none, 1 cavern, 2 tunnel
  const sea = new Uint8Array(n);
  const cover = new Uint8Array(n); // 0 none, 1 fungus, 2 glow, 3 crystal
  const visit = (cx: number, cy: number, r: number, f: (k: number, x: number, y: number) => void) => {
    const j0 = Math.max(0, Math.floor((cy - r - y0) / px));
    const j1 = Math.min(h - 1, Math.ceil((cy + r - y0) / px));
    const i0 = Math.floor((cx - r - x0) / px);
    const i1 = Math.ceil((cx + r - x0) / px);
    for (let j = j0; j <= j1; j++) {
      for (let ii = i0; ii <= i1; ii++) {
        let i = ii;
        if (i < 0 || i >= w) {
          if (!wrapKm) continue;
          i = ((i % w) + w) % w;
        }
        f(j * w + i, x0 + ii * px, y0 + j * px);
      }
    }
  };
  for (const st of underStrokes(surface)) {
    const apply = (k: number) => {
      const b = st.brush;
      if (b === 'cavern' || b === 'tunnel') open[k] = st.erase ? 0 : open[k] === 1 ? 1 : b === 'cavern' ? 1 : 2;
      else if (b === 'undersea') sea[k] = st.erase ? 0 : 1;
      else cover[k] = st.erase ? 0 : b === 'fungus' ? 1 : b === 'glowcave' ? 2 : 3;
    };
    if (st.brush === 'tunnel') {
      const half = Math.max(st.size / 2, px * 0.75);
      const p = st.pts;
      const segs = p.length >= 4 ? p.length / 2 - 1 : 1;
      for (let s = 0; s < segs; s++) {
        const ax = p[s * 2];
        const ay = p[s * 2 + 1];
        const bx = p.length >= 4 ? p[s * 2 + 2] : ax;
        const by = p.length >= 4 ? p[s * 2 + 3] : ay;
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy;
        visit((ax + bx) / 2, (ay + by) / 2, Math.sqrt(l2) / 2 + half, (k, x, y) => {
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
          if (sq(x - ax - t * dx) + sq(y - ay - t * dy) <= half * half) apply(k);
        });
      }
      continue;
    }
    const d = dabsOf(st);
    // Mark each point once per stroke (dabs overlap), then apply.
    const hit = new Set<number>();
    for (let q = 0; q < d.length; q += 3) {
      const r = d[q + 2];
      visit(d[q], d[q + 1], r, (k, x, y) => {
        if (sq(x - d[q]) + sq(y - d[q + 1]) <= r * r) hit.add(k);
      });
    }
    for (const k of hit) apply(k);
  }
  const medium = new Uint8Array(n);
  for (let k = 0; k < n; k++) medium[k] = !land[k] ? NONE : sea[k] ? SEA : open[k] === 1 ? CAVERN : open[k] === 2 ? TUNNEL : ROCK;
  return { medium, cover };
}

/** Split the Underdark into provinces. With `saved`, they grow from its seeds (keeping their ids); otherwise from new ones. */
export function generateUnderProvinces(surface: Surface, s: WorldSettings, opts: Partial<UnderSizes> & { saved?: SavedUnderProvinces | null }): UnderProvinceMap {
  const sz = underSizesOf(opts);
  const saved = opts.saved && sameSizes(underSizesOf(opts.saved), sz) ? opts.saved : null;
  const grid = fineGrid(s, provinceGridKm(s, Math.min(sz.rockMi, sz.cavernMi, sz.tunnelMi, sz.seaMi)));
  const g = sampleGround(surface, s, grid);
  const { w, h, px, x0, y0 } = grid;
  const n = w * h;
  const wrapKm = g.wrapKm;
  const wrap = wrapKm > 0;
  const nb = neighbours4(w, h, wrap);
  const buf: number[] = [];
  const { medium, cover } = rasterUnderdark(surface, grid, wrapKm, g.land);

  // ---- Zones: each connected stretch of one medium ----
  const zone = new Int32Array(n).fill(-1);
  let zones = 0;
  const stack: number[] = [];
  for (let k = 0; k < n; k++) {
    if (zone[k] >= 0 || medium[k] === NONE) continue;
    zone[k] = zones;
    stack.push(k);
    while (stack.length) {
      const c = stack.pop()!;
      for (const m of nb(c, buf)) if (zone[m] < 0 && medium[m] === medium[c]) {
        zone[m] = zones;
        stack.push(m);
      }
    }
    zones++;
  }
  const zMed = new Uint8Array(zones);
  for (let k = 0; k < n; k++) if (zone[k] >= 0) zMed[zone[k]] = medium[k];
  const pxArea = px * px;
  const km = (mi: number) => milesToKm(mi);
  const sizeFor = (m: number) => (m === SEA ? sq(km(sz.seaMi)) : m === CAVERN ? sq(km(sz.cavernMi)) : m === TUNNEL ? sq(km(sz.tunnelMi)) : sq(km(sz.rockMi))) / pxArea;
  const strip = (m: number) => m === TUNNEL;
  // Slivers join the zone they border most: rock and caverns together (a cave pocket too small for
  // a province is part of the rock's), seas with seas, tunnels with tunnels.
  const mergeClass = Uint8Array.from(zMed, (m) => (m === SEA ? 2 : m === TUNNEL ? 3 : 0));
  // (mergeSmallZones skips the points outside every zone.)
  const zoneForMerge = Int32Array.from(zone, (z) => (z < 0 ? zones : z));
  mergeSmallZones(zoneForMerge, zones + 1, (k, out) => nb(k, out).filter((m) => zone[m] >= 0), (z) => (z === zones ? 0 : strip(zMed[z]) ? 15 : sizeFor(zMed[z])), Uint8Array.from([...mergeClass, 9]));
  for (let k = 0; k < n; k++) if (zone[k] >= 0) zone[k] = zoneForMerge[k];

  // Renumber, and list each zone's points.
  const ids = new Map<number, number>();
  for (let k = 0; k < n; k++) if (zone[k] >= 0 && !ids.has(zone[k])) ids.set(zone[k], ids.size);
  const Z = ids.size;
  const zm = new Uint8Array(Z);
  for (const [old, nz] of ids) zm[nz] = zMed[old];
  const zoneSize = new Int32Array(Z);
  for (let k = 0; k < n; k++) if (zone[k] >= 0) {
    zone[k] = ids.get(zone[k])!;
    zoneSize[zone[k]]++;
  }
  const edge = new Int32Array(Z);
  for (let k = 0; k < n; k++) if (zone[k] >= 0) for (const m of nb(k, buf)) if (zone[m] !== zone[k]) edge[zone[k]]++;
  const zoneWidth = Float64Array.from({ length: Z }, (_, z) => (strip(zm[z]) ? Math.max(1, (2 * zoneSize[z]) / Math.max(1, edge[z])) : 1));
  const target = (z: number) => (strip(zm[z]) ? Math.sqrt(sizeFor(zm[z])) * zoneWidth[z] : sizeFor(zm[z]));
  const zonePts: number[][] = Array.from({ length: Z }, () => []);
  for (let k = 0; k < n; k++) if (zone[k] >= 0) zonePts[zone[k]].push(k);
  const xOf = (k: number) => x0 + (k % w) * px;
  const yOf = (k: number) => y0 + ((k / w) | 0) * px;
  const dxWrap = (dx: number) => (wrap ? dx - Math.round(dx / wrapKm) * wrapKm : dx);

  // ---- Seeds: the saved ones where they still fall, then new ones where ground needs them ----
  const seedPix: number[] = [];
  const seedId: number[] = [];
  const taken = new Set<number>();
  const zoneSeeds: number[][] = Array.from({ length: Z }, () => []);
  let nextId = saved?.nextId ?? 1;
  if (saved) {
    for (let q = 0; q < saved.ids.length; q++) {
      const k = fineIndex(grid, wrapKm, saved.seeds[2 * q], saved.seeds[2 * q + 1]);
      if (k < 0 || zone[k] < 0 || taken.has(k)) continue;
      taken.add(k);
      zoneSeeds[zone[k]].push(k);
      seedPix.push(k);
      seedId.push(saved.ids[q]);
    }
  }
  const hash = (a: number, b: number, c: number) => {
    let x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c + s.seed + 4049, 2246822519);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  for (let z = 0; z < Z; z++) {
    const size = zoneSize[z];
    const have = zoneSeeds[z].length;
    if (have > 0 && size / have <= 2 * target(z)) continue;
    const sp = strip(zm[z]) ? Math.sqrt(sizeFor(zm[z])) : Math.sqrt(target(z));
    const enough = strip(zm[z]) ? 0.35 * sp * zoneWidth[z] : 0.35 * sp * sp;
    const offX = hash(z, 1, 7) * sp;
    const offY = hash(z, 2, 7) * sp;
    const cells = new Map<number, { count: number; best: number; bd: number }>();
    for (const k of zonePts[z]) {
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
    const old = zoneSeeds[z].slice();
    const far = (k: number) => old.every((o) => sq(dxWrap(xOf(o) - xOf(k))) + sq(yOf(o) - yOf(k)) > sq(sp * px * 0.6));
    const sow = (k: number) => {
      taken.add(k);
      old.push(k);
      zoneSeeds[z].push(k);
      seedPix.push(k);
      seedId.push(nextId++);
    };
    const list = [...cells.values()].sort((p, q) => q.count - p.count);
    for (const c of list) if (c.count >= enough && !taken.has(c.best) && far(c.best)) sow(c.best);
    for (const c of list) {
      if (zoneSeeds[z].length && size / zoneSeeds[z].length <= 2 * target(z)) break;
      if (!taken.has(c.best) && far(c.best)) sow(c.best);
    }
    if (!zoneSeeds[z].length && list.length && !taken.has(list[0].best)) sow(list[0].best);
  }

  // ---- Growth (flat: no slopes or cliffs down here, a little noise so borders wander) ----
  const noise = new Uint8Array(n);
  for (let k = 0; k < n; k++) noise[k] = Math.round(127.5 + 127.5 * Math.max(-1, Math.min(1, 1.8 * fbm(xOf(k), yOf(k), km(sz.rockMi) * 0.4, px, s.seed + 977, 4))));
  const flat = new Float32Array(n);
  const noCliff = new Uint8Array(n);
  let label = grow(seedPix, zone, noise, flat, noCliff, w, h, wrap, px);
  if (!saved) {
    // Even them out once: each seed to its province's middle, and grow again.
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
    label = grow(seedPix, zone, noise, flat, noCliff, w, h, wrap, px);
  }
  // Anything growth missed joins the province beside it in its zone; then each province one piece.
  {
    const queue: number[] = [];
    for (let k = 0; k < n; k++) if (label[k] >= 0) queue.push(k);
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      for (const m of nb(k, buf)) if (label[m] < 0 && zone[m] >= 0 && zone[m] === zone[k]) {
        label[m] = label[k];
        queue.push(m);
      }
    }
  }
  wholeProvinces(label, zone, w, h, wrap);

  // ---- The provinces: their records, borders and outlines ----
  const S = seedPix.length;
  const cnt = new Int32Array(S);
  const sx = new Float64Array(S);
  const sy = new Float64Array(S);
  const covers = new Int32Array(S * 4);
  const pairs = new Set<number>();
  for (let k = 0; k < n; k++) {
    const l = label[k];
    if (l < 0) continue;
    cnt[l]++;
    sx[l] += dxWrap(xOf(k) - xOf(seedPix[l]));
    sy[l] += yOf(k);
    covers[l * 4 + cover[k]]++;
    for (const m of nb(k, buf)) {
      const o = label[m];
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
  const keep: number[] = [];
  for (let l = 0; l < S; l++) if (cnt[l]) keep.push(l);
  const to = new Int32Array(S).fill(-1);
  keep.forEach((l, i) => (to[l] = i));
  for (let k = 0; k < n; k++) if (label[k] >= 0) label[k] = to[label[k]];
  const provinces: UnderProvince[] = keep.map((l) => {
    const k0 = seedPix[l];
    const kind = KIND[zm[zone[k0]] ?? ROCK] ?? 'rock';
    let c = 0;
    for (let q = 1; q < 4; q++) if (covers[l * 4 + q] > covers[l * 4 + c]) c = q;
    // A cover counts when it is on a good share of the floor.
    const coverHere = kind !== 'rock' && kind !== 'sea' && c > 0 && covers[l * 4 + c] >= cnt[l] * 0.25 ? COVER[c] : null;
    let x = xOf(k0) + sx[l] / cnt[l];
    if (wrap) x = ((x % wrapKm) + wrapKm) % wrapKm;
    let y = sy[l] / cnt[l];
    const kc = fineIndex(grid, wrapKm, x, y);
    if (kc < 0 || label[kc] !== to[l]) [x, y] = [xOf(k0), yOf(k0)];
    return {
      id: seedId[l],
      kind,
      x,
      y,
      area: cnt[l] * pxArea,
      terrain: kind === 'rock' ? UNDER_NAMES.rock : kind === 'sea' ? UNDER_NAMES.sea : kind === 'tunnel' ? UNDER_NAMES.tunnel : UNDER_NAMES.cavern,
      cover: coverHere,
      neighbours: neighbours[l].map((q) => to[q]).filter((q) => q >= 0),
    };
  });
  const lx = (X: number) => x0 + (X - 0.5) * px;
  const ly = (Y: number) => y0 + (Y - 0.5) * px;
  const toKm = (p: number[]) => p.map((v, i) => Math.round((i % 2 ? ly(v) : lx(v)) * 100) / 100);
  const held = (l: number) => l >= 0;
  const narrow = (l: number) => l >= 0 && provinces[l]?.kind === 'tunnel';
  const chains = traceChains(label, w, h, wrap, held, OFF_MAP, (a, b) => (narrow(a) || narrow(b) ? 0.35 : 0.9));
  const ringMap = assembleRings(chains, w, wrap, held);
  return {
    grid,
    wrapKm,
    label,
    provinces,
    borders: chains.map((c) => ({ pts: toKm(c.pts), a: c.left, b: c.right })),
    rings: provinces.map((_, l) => (ringMap.get(l) ?? []).map(toKm)),
    saved: {
      v: 1,
      ...sz,
      seeds: keep.flatMap((l) => [Math.round(xOf(seedPix[l]) * 100) / 100, Math.round(yOf(seedPix[l]) * 100) / 100]),
      ids: keep.map((l) => seedId[l]),
      nextId,
    },
  };
}

const sameSizes = (a: UnderSizes, b: UnderSizes) => a.rockMi === b.rockMi && a.cavernMi === b.cavernMi && a.tunnelMi === b.tunnelMi && a.seaMi === b.seaMi;

/** Saved Underdark provinces, if whole. */
export function readUnderProvinces(p: unknown): SavedUnderProvinces | null {
  const v = p as Partial<SavedUnderProvinces> | null | undefined;
  if (!v || typeof v !== 'object' || v.v !== 1 || typeof v.nextId !== 'number') return null;
  if (!Array.isArray(v.seeds) || !Array.isArray(v.ids) || v.seeds.length !== v.ids.length * 2) return null;
  if (!v.seeds.every((x) => typeof x === 'number' && Number.isFinite(x)) || !v.ids.every((x) => Number.isInteger(x))) return null;
  return { v: 1, ...underSizesOf(v), seeds: v.seeds, ids: v.ids, nextId: v.nextId };
}
