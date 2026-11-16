import { giantTrees, giantVines } from './canopy';
import { fineGrid } from './finegeo';
import { layerGridKm, provincesFromMedium } from './layerprov';
import type { Surface, VineEnd } from './paint';
import { PROVINCE_SIZE_MI } from './provinces';
import type { WorldSettings } from './settings';
import type { SkyLayer } from './sky';
import type { Grid } from './terrain';
import { dabsOf } from './underdark';
import { milesToKm } from './units';

/**
 * Provinces of the canopy and the sky layers (the layers' provinces, step 2). The canopy is the
 * ground's own airspace; it and each sky layer are split all over (land and sea alike) into open-air
 * provinces, where airships fly, the way the seas are split for ships. On them:
 * - Islands (painted on that layer, the canopy's too) have land provinces of their own.
 * - Limbs (in the canopy, with the trunks they reach out from) and vines run as strings of
 *   provinces, a province every so far along, like rivers on the surface. A vine belongs to the layer
 *   of its lower end, the surface's counting as the canopy (the ground's airspace it climbs through).
 * Provinces grow from seeds kept with the world, a set for each layer.
 */

export interface AirSizes {
  /** How far across an open-air province is (miles). */
  airMi: number;
  /** How far across an island's province is. */
  islandMi: number;
  /** How long a stretch of limb or vine each of their provinces is. */
  strandMi: number;
}
export const AIR_SIZE_DEFAULTS: AirSizes = { airMi: 120, islandMi: 40, strandMi: 30 };
export const airSizesOf = (o: Partial<AirSizes> | null | undefined): AirSizes => {
  const mi = (v: number | undefined, d: number) => Math.max(PROVINCE_SIZE_MI.min, Math.min(PROVINCE_SIZE_MI.max, typeof v === 'number' && Number.isFinite(v) ? v : d));
  return { airMi: mi(o?.airMi, AIR_SIZE_DEFAULTS.airMi), islandMi: mi(o?.islandMi, AIR_SIZE_DEFAULTS.islandMi), strandMi: mi(o?.strandMi, AIR_SIZE_DEFAULTS.strandMi) };
};

export interface LayerSeeds {
  seeds: number[];
  ids: number[];
  nextId: number;
}
/** What the world keeps: the sizes, and each layer's seeds (by layer: 0 the canopy, 1–3 the sky layers). */
export interface SavedAirProvinces extends AirSizes {
  v: 1;
  layers: Partial<Record<'0' | '1' | '2' | '3', LayerSeeds>>;
}

export type AirProvKind = 'air' | 'island' | 'limb' | 'vine';
export interface AirProvince {
  id: number;
  kind: AirProvKind;
  x: number;
  y: number;
  area: number;
  terrain: string;
  neighbours: number[];
}
export interface AirProvinceMap {
  layer: SkyLayer;
  grid: Grid;
  wrapKm: number;
  label: Int32Array;
  provinces: AirProvince[];
  borders: { pts: number[]; a: number; b: number }[];
  rings: number[][][];
  seeds: LayerSeeds;
}

const AIR = 1;
const ISLAND = 2;
const LIMB = 3;
const VINE = 4;
const KIND: AirProvKind[] = ['air', 'air', 'island', 'limb', 'vine'];
const TERRAIN = ['Open air', 'Open air', 'Island', 'Limb', 'Giant vine'];

const LEVEL: Record<VineEnd, number> = { surface: 0, canopy: 0, sky1: 1, sky2: 2, sky3: 3 };
/** The layer a vine's provinces are on: its lower end's (the surface's counting as the canopy). */
export const vineLayer = (from: VineEnd, to: VineEnd): SkyLayer => Math.min(LEVEL[from], LEVEL[to]) as SkyLayer;

const sq = (v: number) => v * v;

/** One layer painted onto the fine grid: open air everywhere, its islands, and its limbs, trunks and vines (over open air). */
export function rasterAir(surface: Surface, grid: Grid, wrapKm: number, layer: SkyLayer): Uint8Array {
  const { w, h, px, x0, y0 } = grid;
  const medium = new Uint8Array(w * h).fill(AIR);
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
  /** A line at least one point wide. */
  const line = (p: number[], width: number, f: (k: number) => void) => {
    const half = Math.max(width / 2, px * 0.75);
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
        if (sq(x - ax - t * dx) + sq(y - ay - t * dy) <= half * half) f(k);
      });
    }
  };
  // Islands, in the order painted (erasing gives the air back).
  for (const st of surface.strokes) {
    if (st.brush !== 'skyisland' || (st.sky ?? 1) !== layer || st.pts.length < 2) continue;
    const d = dabsOf(st);
    for (let q = 0; q < d.length; q += 3) {
      const r = d[q + 2];
      visit(d[q], d[q + 1], r, (k, x, y) => {
        if (sq(x - d[q]) + sq(y - d[q + 1]) <= r * r) medium[k] = st.erase ? AIR : ISLAND;
      });
    }
  }
  // Limbs and the trunks they reach out from (the canopy's), over open air.
  if (layer === 0) {
    const limbs = new Uint8Array(w * h);
    for (const t of giantTrees(surface)) visit(t.x, t.y, Math.max(t.trunk, px * 0.75), (k, x, y) => {
      if (sq(x - t.x) + sq(y - t.y) <= sq(Math.max(t.trunk, px * 0.75))) limbs[k] = 1;
    });
    for (const st of surface.strokes) if (st.brush === 'limb' && st.pts.length >= 2) line(st.pts, st.size, (k) => (limbs[k] = st.erase ? 0 : 1));
    for (let k = 0; k < limbs.length; k++) if (limbs[k] && medium[k] === AIR) medium[k] = LIMB;
  }
  // Vines on this layer, over open air (all of them: whether their ends hold is the Trees tab's to say).
  for (const v of giantVines(surface, () => true)) {
    if (vineLayer(v.from, v.to) !== layer) continue;
    line(v.stroke.pts, v.stroke.size, (k) => {
      if (medium[k] === AIR) medium[k] = VINE;
    });
  }
  return medium;
}

/** Split one layer (0 the canopy, 1–3 the sky layers) into provinces. With `saved`, they grow from its seeds (keeping their ids). */
export function generateAirProvinces(surface: Surface, s: WorldSettings, layer: SkyLayer, opts: Partial<AirSizes> & { saved?: LayerSeeds | null }): AirProvinceMap {
  const sz = airSizesOf(opts);
  // Fine enough for the narrowest limb, vine, trunk or island painted (their edges are hard lines).
  const widths: number[] = [];
  for (const st of surface.strokes) {
    if (st.erase) continue;
    if (st.brush === 'limb' && layer === 0) widths.push(st.size);
    else if (st.brush === 'gianttree' && layer === 0) widths.push(st.size);
    else if (st.brush === 'vine' && vineLayer(st.vineFrom ?? 'surface', st.vineTo ?? st.vineFrom ?? 'surface') === layer) widths.push(st.size);
    else if (st.brush === 'skyisland' && (st.sky ?? 1) === layer) widths.push(st.size);
  }
  const grid = fineGrid(s, layerGridKm(s, [sz.airMi, sz.islandMi, sz.strandMi], widths.length ? Math.min(...widths) : Infinity));
  const wrapKm = s.edges === 'wrap' ? s.widthKm : 0;
  const medium = rasterAir(surface, grid, wrapKm, layer);
  const grown = provincesFromMedium(grid, wrapKm, medium, null, {
    size: (m) => milesToKm(m === ISLAND ? sz.islandMi : m === LIMB || m === VINE ? sz.strandMi : sz.airMi),
    strip: (m) => m === LIMB || m === VINE,
    kind: (m) => KIND[m] ?? 'air',
    terrain: (m) => TERRAIN[m] ?? 'Open air',
    coverOk: () => false,
  }, opts.saved ?? null, s.seed + 31 * (layer + 1), milesToKm(sz.airMi));
  return {
    layer,
    grid,
    wrapKm,
    label: grown.label,
    provinces: grown.provinces.map((p) => ({ id: p.id, kind: p.kind as AirProvKind, x: p.x, y: p.y, area: p.area, terrain: p.terrain, neighbours: p.neighbours })),
    borders: grown.borders,
    rings: grown.rings,
    seeds: { seeds: grown.seeds, ids: grown.ids, nextId: grown.nextId },
  };
}

/** Saved canopy and sky provinces, if whole. */
export function readAirProvinces(p: unknown): SavedAirProvinces | null {
  const v = p as Partial<SavedAirProvinces> | null | undefined;
  if (!v || typeof v !== 'object' || v.v !== 1 || !v.layers || typeof v.layers !== 'object') return null;
  const layers: SavedAirProvinces['layers'] = {};
  for (const k of ['0', '1', '2', '3'] as const) {
    const l = v.layers[k];
    if (!l || typeof l.nextId !== 'number' || !Array.isArray(l.seeds) || !Array.isArray(l.ids) || l.seeds.length !== l.ids.length * 2) continue;
    if (!l.seeds.every((x) => typeof x === 'number' && Number.isFinite(x)) || !l.ids.every((x) => Number.isInteger(x))) continue;
    layers[k] = { seeds: l.seeds, ids: l.ids, nextId: l.nextId };
  }
  return { v: 1, ...airSizesOf(v), layers };
}
