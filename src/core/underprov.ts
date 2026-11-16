import { fineGrid, fineIndex, sampleGround } from './finegeo';
import { layerGridKm, provincesFromMedium } from './layerprov';
import type { Surface } from './paint';
import { PROVINCE_SIZE_MI, provinceGridKm } from './provinces';
import type { WorldSettings } from './settings';
import type { Grid } from './terrain';
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
  // Fine enough for the narrowest tunnel or cave painted (its walls are hard lines).
  const painted = underStrokes(surface).filter((st) => !st.erase && (st.brush === 'cavern' || st.brush === 'tunnel' || st.brush === 'undersea'));
  const finest = painted.length ? Math.min(...painted.map((st) => st.size)) : Infinity;
  const grid = fineGrid(s, layerGridKm(s, [sz.rockMi, sz.cavernMi, sz.tunnelMi, sz.seaMi], finest));
  // The land (where there is anything below), from a coarser grid: the coast needs no finer.
  const coarse = fineGrid(s, provinceGridKm(s, sz.rockMi));
  const g = sampleGround(surface, s, coarse);
  const land = new Uint8Array(grid.w * grid.h);
  for (let k = 0; k < land.length; k++) {
    const c = fineIndex(coarse, g.wrapKm, grid.x0 + (k % grid.w) * grid.px, grid.y0 + Math.floor(k / grid.w) * grid.px);
    land[k] = c >= 0 ? g.land[c] : 0;
  }
  const { medium, cover } = rasterUnderdark(surface, grid, g.wrapKm, land);

  const grown = provincesFromMedium(grid, g.wrapKm, medium, cover, {
    size: (m) => milesToKm(m === SEA ? sz.seaMi : m === CAVERN ? sz.cavernMi : m === TUNNEL ? sz.tunnelMi : sz.rockMi),
    strip: (m) => m === TUNNEL,
    kind: (m) => KIND[m] ?? 'rock',
    terrain: (m) => (m === SEA ? UNDER_NAMES.sea : m === TUNNEL ? UNDER_NAMES.tunnel : m === CAVERN ? UNDER_NAMES.cavern : UNDER_NAMES.rock),
    coverOk: (m) => m === CAVERN || m === TUNNEL,
  }, saved, s.seed, milesToKm(sz.rockMi));
  return {
    grid,
    wrapKm: g.wrapKm,
    label: grown.label,
    provinces: grown.provinces.map((p) => ({ id: p.id, kind: p.kind as UnderProvKind, x: p.x, y: p.y, area: p.area, terrain: p.terrain, cover: COVER[p.cover] ?? null, neighbours: p.neighbours })),
    borders: grown.borders,
    rings: grown.rings,
    saved: { v: 1, ...sz, seeds: grown.seeds, ids: grown.ids, nextId: grown.nextId },
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
