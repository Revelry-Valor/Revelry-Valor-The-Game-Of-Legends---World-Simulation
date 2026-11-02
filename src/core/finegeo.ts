import { nearestPoint, type Climate } from './climate';
import { fbm } from './noise';
import { sketchCourse, type Surface } from './paint';
import { flowAt, riverNetwork, widthForFlow } from './water';
import type { WorldSettings } from './settings';
import { evaluate, type Grid } from './terrain';

/**
 * Fine geography (REDESIGN.md 8.13): the natural regions and waters, worked out on the climate's
 * points, carried down to a fine grid so their borders follow what is painted (the coast, the
 * mountain zones, the ground cover as it is drawn) instead of the climate's coarse points. Each
 * region and each water is kept in one piece: a fragment cut off from the rest of its region
 * joins the region round it.
 *
 * The same fine ground is what the province generator splits into provinces.
 */

/**
 * The climate point whose climate shows at a place: the nearest one, nudged by noise so borders
 * between climates never run straight (two scales: broad bends and ragged edges). On land
 * (`onLand`), a coastal place borrows the nearest land point's climate; −1 if there is none.
 * The map's drawing and the fine geography both use this, so the regions match the cover drawn.
 */
export function coverPoint(cl: Climate, x: number, y: number, px: number, seed: number, onLand: boolean): number {
  const big = Math.max(cl.step * 3, 60);
  const jx = x + big * fbm(x, y, big * 3, Math.max(px, big * 0.15), seed + 203, 3) + cl.step * 0.7 * fbm(x, y, cl.step * 1.4, Math.max(px, cl.step * 0.08), seed + 201, 4);
  const jy = y + big * fbm(x, y, big * 3, Math.max(px, big * 0.15), seed + 204, 3) + cl.step * 0.7 * fbm(x, y, cl.step * 1.4, Math.max(px, cl.step * 0.08), seed + 202, 4);
  let k = nearestPoint(cl, jx, jy);
  if (onLand && !cl.land[k]) {
    const k2 = nearestPoint(cl, x, y);
    k = cl.land[k2] ? k2 : -1;
    if (k < 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const k3 = nearestPoint(cl, x + dx * cl.step, y + dy * cl.step);
      if (cl.land[k3]) {
        k = k3;
        break;
      }
    }
  }
  return k;
}

/** Relief bands of the fine ground. */
export const BAND = { lowland: 0, hills: 1, highlands: 2, mountains: 3, peaks: 4, plateau: 5, foothills: 6 } as const;
export const BAND_NAMES = ['Lowland', 'Hills', 'Highlands', 'Mountains', 'Peaks', 'Plateau', 'Foothills'];
export const BANDS = BAND_NAMES.length;

/** The painted ground on a fine grid: only what geography and provinces need. */
export interface FineGround {
  grid: Grid;
  /** The map's width when it wraps east–west (0 when it does not). */
  wrapKm: number;
  /** 1 land, 0 sea. */
  land: Uint8Array;
  /** Relief band (see BAND). */
  band: Uint8Array;
  /** Height the climate sees (km). */
  height: Float32Array;
  /** 1 lake; 1 river, 2 big river (one that parts regions and provinces). */
  lake: Uint8Array;
  river: Uint8Array;
  /** 1 on a cliff or other bare rock face outside a canyon (a cut provinces form round); inside a canyon 1, a ravine 2. */
  cliff: Uint8Array;
  gorge: Uint8Array;
}

/** Rivers at least this wide (km) part provinces, as they part regions (REDESIGN.md 8.13). */
export const BIG_RIVER_KM = 1.0;

/** Sample the painted surface on a fine grid, a strip at a time (so a big grid needs little memory). */
export function sampleGround(surface: Surface, s: WorldSettings, grid: Grid, bigRiverKm = BIG_RIVER_KM): FineGround {
  const { w, h } = grid;
  const n = w * h;
  const wrapKm = s.edges === 'wrap' ? s.widthKm : 0;
  const out: FineGround = { grid, wrapKm, land: new Uint8Array(n), band: new Uint8Array(n), height: new Float32Array(n), lake: new Uint8Array(n), river: new Uint8Array(n), cliff: new Uint8Array(n), gorge: new Uint8Array(n) };
  const rows = Math.max(1, Math.floor(250_000 / Math.max(1, w)));
  for (let j0 = 0; j0 < h; j0 += rows) {
    const hh = Math.min(rows, h - j0);
    const f = evaluate(surface, { x0: grid.x0, y0: grid.y0 + j0 * grid.px, px: grid.px, w, h: hh }, { seed: s.seed, wrapKm, noRelief: true });
    const base = j0 * w;
    for (let q = 0; q < w * hh; q++) {
      const k = base + q;
      const land = f.ground[q] >= 1.5;
      out.land[k] = land ? 1 : 0;
      out.height[k] = f.climateH[q];
      if (!land) continue;
      const z = f.zone[q];
      // The foot of a mountain (its lowest zone) belongs to the mountain; hills painted on their own are hills.
      out.band[k] = z >= 4 ? BAND.peaks : z === 3 ? BAND.mountains : z === 2 ? BAND.highlands : f.plateau[q] > 0.5 ? BAND.plateau : z === 1 ? BAND.foothills : f.hill[q] > 0.35 ? BAND.hills : BAND.lowland;
      // Canyons and ravines (their whole width), and cliffs and other rock faces outside them.
      if (f.canyon[q] > 0.5) out.gorge[k] = 1;
      else if (f.ravine[q] > 0.5) out.gorge[k] = 2;
      else if (f.face[q] > 0.25) out.cliff[k] = 1;
      if (f.water[q] > 0.5 && f.waterKind[q] === 2) out.lake[k] = 1;
      // A river here (as drawn: a little wider than life, so it shows); the big ones are traced below.
      else if (f.water[q] > 0.3 && f.waterKind[q] === 1) out.river[k] = 1;
    }
  }
  // Cliffs, ravines and canyons narrower than the grid: their painted lines, traced unbroken.
  const { px, x0, y0 } = grid;
  const at = (x: number, y: number) => {
    let i = Math.round((x - x0) / px);
    const j = Math.round((y - y0) / px);
    if (j < 0 || j >= h) return -1;
    if (i < 0 || i >= w) {
      if (!wrapKm) return -1;
      i = ((i % w) + w) % w;
    }
    return j * w + i;
  };
  // Cliffs: a cut. Ravines and canyons: their line always inside them (with the points either
  // side, so even a narrow one holds provinces of its own; their edges are the cut).
  let wide = 0;
  const mark = (k: number) => {
    if (k < 0 || !out.land[k]) return;
    if (!wide) {
      if (!out.gorge[k]) out.cliff[k] = 1;
      return;
    }
    out.gorge[k] ||= wide;
    out.cliff[k] = 0;
    const i = k % w;
    for (const m of [i > 0 ? k - 1 : wrapKm ? k + w - 1 : -1, i < w - 1 ? k + 1 : wrapKm ? k - w + 1 : -1, k - w, k + w]) if (m >= 0 && m < n && out.land[m]) {
      out.gorge[m] ||= wide;
      out.cliff[m] = 0;
    }
  };
  for (const st of surface.strokes) {
    if (st.erase || (st.brush !== 'cliffs' && st.brush !== 'ravine' && st.brush !== 'canyon')) continue;
    wide = st.brush === 'canyon' ? 1 : st.brush === 'ravine' ? 2 : 0;
    const p = st.ctrl && st.ctrl.length >= 4 ? sketchCourse(st.ctrl, wrapKm) : st.pts;
    let last = -1;
    for (let q = 0; q + 3 < p.length; q += 2) {
      const len = Math.hypot(p[q + 2] - p[q], p[q + 3] - p[q + 1]);
      const steps = Math.max(1, Math.ceil(len / (px * 0.3)));
      for (let t = 0; t <= steps; t++) {
        const k = at(p[q] + ((p[q + 2] - p[q]) * t) / steps, p[q + 1] + ((p[q + 3] - p[q + 1]) * t) / steps);
        if (k < 0 || k === last) continue;
        mark(k);
        // Diagonal steps filled in, so the line is unbroken point to point (nothing slips past a corner).
        if (last >= 0) {
          const li = last % w;
          const lj = (last / w) | 0;
          const ki = k % w;
          const kj = (k / w) | 0;
          if (li !== ki && lj !== kj) mark(lj * w + ki);
        }
        last = k;
      }
    }
  }
  // Big rivers (at least `bigRiverKm` wide) traced from their own course at their true width,
  // never less than one point and unbroken point to point: the river itself, not the drawing of it.
  const wet = (k: number) => {
    if (k >= 0 && out.land[k] && !out.lake[k]) out.river[k] = 2;
  };
  for (const r of riverNetwork(surface).values()) {
    const p = r.stroke.pts;
    let last = -1;
    for (let q = 0; q + 3 < p.length; q += 2) {
      const len = Math.hypot(p[q + 2] - p[q], p[q + 3] - p[q + 1]);
      const steps = Math.max(1, Math.ceil(len / (px * 0.3)));
      for (let t = 0; t <= steps; t++) {
        const width = widthForFlow(flowAt(r, r.cum[q / 2] + (len * t) / steps));
        if (width < bigRiverKm) {
          last = -1;
          continue;
        }
        const x = p[q] + ((p[q + 2] - p[q]) * t) / steps;
        const y = p[q + 1] + ((p[q + 3] - p[q + 1]) * t) / steps;
        const k = at(x, y);
        if (k < 0 || k === last) continue;
        wet(k);
        if (last >= 0) {
          const li = last % w;
          const lj = (last / w) | 0;
          const ki = k % w;
          const kj = (k / w) | 0;
          if (li !== ki && lj !== kj) wet(lj * w + ki);
        }
        // A river wider than a point covers the points within its banks.
        const half = width / 2;
        if (half > px * 0.5) {
          const R = Math.ceil(half / px);
          for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if ((di * di + dj * dj) * px * px <= half * half) wet(at(x + di * px, y + dj * px));
        }
        last = k;
      }
    }
  }
  return out;
}

/** A fine grid over the whole map with points `px` km apart (rounded so the width divides evenly). */
export function fineGrid(s: WorldSettings, px: number): Grid {
  const w = Math.max(4, Math.round(s.widthKm / px));
  const p = s.widthKm / w;
  const h = Math.max(4, Math.round(s.heightKm / p));
  return { x0: p / 2, y0: p / 2, px: p, w, h };
}

/** Natural regions and waters on a fine grid. */
export interface FineGeo {
  grid: Grid;
  wrapKm: number;
  /** The region at each fine point (−1 at sea), and the water (−1 on land). */
  region: Int32Array;
  water: Int32Array;
}

const RELIEF_KINDS = new Set(['Mountains', 'Highlands']);

/** Carry the climate's regions and waters down to the fine ground. */
export function fineGeography(cl: Climate, g: FineGround, seed: number): FineGeo {
  const geo = cl.geo;
  const { w, h, px, x0, y0 } = g.grid;
  const n = w * h;
  const wrap = g.wrapKm > 0;
  const region = new Int32Array(n).fill(-1);
  const water = new Int32Array(n).fill(-1);
  if (!geo) return { grid: g.grid, wrapKm: g.wrapKm, region, water };
  const kindOf = (r: number) => geo.regions[r]?.kind ?? '';
  const cw = cl.w;
  // The nearest climate point (within two and a half steps) that passes a test.
  const nearestWhere = (x: number, y: number, ok: (k: number) => boolean): number => {
    const ci = Math.floor(x / cl.step);
    const cj = Math.floor(y / cl.step);
    let best = -1;
    let bd = Infinity;
    for (let dj = -2; dj <= 2; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= cl.h) continue;
      for (let di = -2; di <= 2; di++) {
        let i = ci + di;
        if (i < 0 || i >= cw) {
          if (!cl.wrapKm) continue;
          i = ((i % cw) + cw) % cw;
        }
        const k = j * cw + i;
        if (!ok(k)) continue;
        let dx = Math.abs(cl.x0 + i * cl.step - x);
        if (cl.wrapKm) dx = Math.min(dx, cl.wrapKm - dx);
        const d = dx * dx + (cl.y0 + j * cl.step - y) ** 2;
        if (d < bd) [best, bd] = [k, d];
      }
    }
    return best;
  };
  for (let j = 0; j < h; j++) {
    const y = y0 + j * px;
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = x0 + i * px;
      if (g.land[k]) {
        // The region whose cover is drawn here...
        const c = coverPoint(cl, x, y, px, seed, true);
        let r = c >= 0 ? geo.region[c] : -1;
        if (r < 0) {
          const c2 = nearestWhere(x, y, (q) => cl.land[q] === 1 && geo.region[q] >= 0);
          r = c2 >= 0 ? geo.region[c2] : -1;
        }
        // ...unless the painted relief says otherwise: painted mountains belong to a range near
        // them, and lowland to the lowland round it, not to a range the coarse points spread over it.
        const b = g.band[k];
        const high = b === BAND.highlands || b === BAND.mountains || b === BAND.peaks;
        if (r >= 0 && high && !RELIEF_KINDS.has(kindOf(r))) {
          const c2 = nearestWhere(x, y, (q) => cl.land[q] === 1 && RELIEF_KINDS.has(kindOf(geo.region[q])));
          if (c2 >= 0) r = geo.region[c2];
        } else if (r >= 0 && (b === BAND.lowland || b === BAND.hills) && kindOf(r) === 'Mountains') {
          const c2 = nearestWhere(x, y, (q) => cl.land[q] === 1 && geo.region[q] >= 0 && kindOf(geo.region[q]) !== 'Mountains');
          if (c2 >= 0) r = geo.region[c2];
        }
        region[k] = r;
      } else {
        let c = nearestPoint(cl, x, y);
        if (cl.land[c] || geo.water[c] < 0) c = nearestWhere(x, y, (q) => !cl.land[q] && geo.water[q] >= 0);
        water[k] = c >= 0 ? geo.water[c] : -1;
      }
    }
  }
  const nb = neighbours4(w, h, wrap);
  fillGaps(region, (k) => g.land[k] === 1, nb);
  fillGaps(water, (k) => g.land[k] === 0, nb);
  keepWhole(region, (k) => g.land[k] === 1, nb);
  keepWhole(water, (k) => g.land[k] === 0, nb);
  return { grid: g.grid, wrapKm: g.wrapKm, region, water };
}

/** The four neighbours of a fine point (wrapping east–west if the map does), into `out`. */
export function neighbours4(w: number, h: number, wrap: boolean): (k: number, out: number[]) => number[] {
  return (k, out) => {
    out.length = 0;
    const i = k % w;
    const j = (k / w) | 0;
    if (i > 0) out.push(k - 1);
    else if (wrap) out.push(k + w - 1);
    if (i < w - 1) out.push(k + 1);
    else if (wrap) out.push(k - w + 1);
    if (j > 0) out.push(k - w);
    if (j < h - 1) out.push(k + w);
    return out;
  };
}

/** Points left without a label (where `inside`) take one from beside them. */
function fillGaps(id: Int32Array, inside: (k: number) => boolean, nb: (k: number, out: number[]) => number[]): void {
  const buf: number[] = [];
  const queue: number[] = [];
  for (let k = 0; k < id.length; k++) if (id[k] >= 0 && inside(k)) queue.push(k);
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    for (const m of nb(k, buf)) if (id[m] < 0 && inside(m)) {
      id[m] = id[k];
      queue.push(m);
    }
  }
}

/**
 * Each label in one piece: its biggest piece stays, and any other piece joins the label it
 * borders most (among points where `inside`, and only across edges `may` allows). A piece with nothing to join (an island of its
 * own) keeps its label.
 */
export function keepWhole(id: Int32Array, inside: (k: number) => boolean, nb: (k: number, out: number[]) => number[], may?: (k: number, m: number) => boolean): void {
  const n = id.length;
  const buf: number[] = [];
  const piece = new Int32Array(n);
  const stack = new Int32Array(n);
  for (let round = 0; round < 4; round++) {
    // Pieces: connected points with the same label.
    piece.fill(-1);
    const pieceLabel: number[] = [];
    const pieceSize: number[] = [];
    for (let k = 0; k < n; k++) {
      if (piece[k] >= 0 || id[k] < 0 || !inside(k)) continue;
      const p = pieceLabel.length;
      const l = id[k];
      pieceLabel.push(l);
      let size = 0;
      let top = 0;
      piece[k] = p;
      stack[top++] = k;
      while (top) {
        const c = stack[--top];
        size++;
        for (const m of nb(c, buf)) if (piece[m] < 0 && id[m] === l && inside(m)) {
          piece[m] = p;
          stack[top++] = m;
        }
      }
      pieceSize.push(size);
    }
    const main = new Map<number, number>();
    for (let p = 0; p < pieceLabel.length; p++) {
      const m = main.get(pieceLabel[p]);
      if (m === undefined || pieceSize[p] > pieceSize[m]) main.set(pieceLabel[p], p);
    }
    const stray = new Uint8Array(pieceLabel.length);
    let any = false;
    for (let p = 0; p < pieceLabel.length; p++) if (main.get(pieceLabel[p]) !== p) {
      stray[p] = 1;
      any = true;
    }
    if (!any) return;
    // For each stray piece, how much it borders each other label.
    const border = new Map<number, Map<number, number>>();
    for (let k = 0; k < n; k++) {
      const p = piece[k];
      if (p < 0 || !stray[p]) continue;
      for (const m of nb(k, buf)) {
        if (id[m] < 0 || id[m] === id[k] || !inside(m) || (may && !may(k, m))) continue;
        let row = border.get(p);
        if (!row) border.set(p, (row = new Map()));
        row.set(id[m], (row.get(id[m]) ?? 0) + 1);
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
      if (p < 0 || !stray[p]) continue;
      const t = into.get(p);
      if (t !== undefined) id[k] = t;
    }
  }
}

/** The fine point under a place (km), or −1 off the map. */
export function fineIndex(grid: Grid, wrapKm: number, x: number, y: number): number {
  let i = Math.round((x - grid.x0) / grid.px);
  const j = Math.round((y - grid.y0) / grid.px);
  if (j < 0 || j >= grid.h) return -1;
  if (i < 0 || i >= grid.w) {
    if (!wrapKm) return -1;
    i = ((i % grid.w) + grid.w) % grid.w;
  }
  return j * grid.w + i;
}

/** The natural region at a place: from the fine geography when there is one. */
export function regionAt(cl: Climate, x: number, y: number): number {
  const geo = cl.geo;
  if (!geo) return -1;
  const fine = geo.fine;
  if (fine) {
    const k = fineIndex(fine.grid, fine.wrapKm, x, y);
    if (k >= 0 && fine.region[k] >= 0) return fine.region[k];
  }
  const k = nearestPoint(cl, x, y);
  return geo.region[k];
}

/** The water at a place: from the fine geography when there is one. */
export function waterAt(cl: Climate, x: number, y: number): number {
  const geo = cl.geo;
  if (!geo) return -1;
  const fine = geo.fine;
  if (fine) {
    const k = fineIndex(fine.grid, fine.wrapKm, x, y);
    if (k >= 0 && fine.water[k] >= 0) return fine.water[k];
  }
  return geo.water[nearestPoint(cl, x, y)];
}

/** The fine geography made with the climate: about four fine points to each climate step, at most about 900,000. */
export function climateFineGeo(surface: Surface, s: WorldSettings, cl: Climate): FineGeo {
  const F = Math.max(1, Math.min(4, Math.floor(Math.sqrt(900_000 / (cl.w * cl.h)))));
  const grid = fineGrid(s, cl.step / F);
  return fineGeography(cl, sampleGround(surface, s, grid), s.seed);
}
