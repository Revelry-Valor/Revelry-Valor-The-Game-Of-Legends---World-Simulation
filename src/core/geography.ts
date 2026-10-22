import type { Climate } from './climate';
import { COVER_BRUSHES, sketchCourse, type Stroke, type Surface } from './paint';
import type { WorldSettings } from './settings';
import { flowAt, riverNetwork } from './water';

/**
 * Geography (REDESIGN.md, section 8.13): the land split into continents, islands and
 * archipelagos; the water into oceans, seas, gulfs and bays; and the land again into natural
 * regions (Highlands, Steppe, Forest, Desert and so on). Worked out on the climate's points,
 * after the climate, because regions follow climate and ground cover.
 *
 * What you change by hand lives in strokes: Divide lines cut a landmass, a water or a region in
 * two; Join lines make the features they cross one; Name pins name whatever lies under them.
 * Names are looked up through the pins, so they stay with the land even as it is repainted.
 */

export type GeoLevel = 'continent' | 'island' | 'archipelago' | 'ocean' | 'sea' | 'gulf' | 'bay' | 'region';

export interface GeoFeature {
  id: number;
  level: GeoLevel;
  /** What it is, for its label until it has a name ("Continent", "Gulf", "Steppe"). */
  kind: string;
  /** Area (km²). */
  area: number;
  /** Where its label goes (km), the direction it runs (radians, east = 0, clockwise on screen) and its length and width along that (km). */
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  /** Other good spots for the label, if the first is crowded. */
  alt: [number, number][];
}

export interface Geography {
  /** The landmass, water body and region at each climate point (−1 for none). Waters hold the most specific feature (a bay rather than its sea). */
  land: Int32Array;
  water: Int32Array;
  region: Int32Array;
  /** For each island, its archipelago (−1 if none). */
  archipelagoOf: Map<number, number>;
  landmasses: GeoFeature[];
  archipelagos: GeoFeature[];
  waters: GeoFeature[];
  regions: GeoFeature[];
}

export const GEO_DEFAULTS = { continentMinSqMi: 1_000_000, regionMi: 250 };
const SQMI = 2.589988;

/** Region kinds and their colours on the Geography map. */
export const REGION_KINDS: Record<string, string> = {
  Mountains: '#8d7b6a',
  Highlands: '#b49a72',
  Icefield: '#e8eef2',
  Tundra: '#a9b5a6',
  Taiga: '#4f6f58',
  Forest: '#5f8f4e',
  Jungle: '#2f7a46',
  Savanna: '#c2b866',
  Plains: '#a8c06a',
  Steppe: '#cdbb7e',
  Scrubland: '#a3a464',
  Desert: '#e2c487',
};

const COVER_KIND: Record<string, string> = {
  forest: 'Forest',
  jungle: 'Jungle',
  grassland: 'Plains',
  tundra: 'Tundra',
  marsh: 'Plains',
  dunes: 'Desert',
  badlands: 'Desert',
  saltflats: 'Desert',
  glacier: 'Icefield',
  beach: 'Plains',
  savanna: 'Savanna',
  scrub: 'Scrubland',
  taiga: 'Taiga',
  steppe: 'Steppe',
  rockdesert: 'Desert',
};

/** Work out the geography of a world from its strokes and climate. */
export function computeGeography(surface: Surface, s: WorldSettings, cl: Climate): Geography {
  const { w, h, step } = cl;
  const n = w * h;
  const wrap = cl.wrapKm > 0;
  const geo = { ...GEO_DEFAULTS, ...(s.geography ?? {}) };
  const cellArea = step * step;
  const xOf = (k: number) => cl.x0 + (k % w) * step;
  const yOf = (k: number) => cl.y0 + ((k / w) | 0) * step;
  const cellAt = (x: number, y: number): number => {
    let i = Math.round((x - cl.x0) / step);
    const j = Math.round((y - cl.y0) / step);
    if (j < 0 || j >= h) return -1;
    if (i < 0 || i >= w) {
      if (!wrap) return -1;
      i = ((i % w) + w) % w;
    }
    return j * w + i;
  };
  const nb = (k: number, out: number[]): number[] => {
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
  const buf: number[] = [];

  // Cells under a line (sampled densely so the line has no gaps).
  const cellsAlong = (st: Stroke): number[] => {
    const p = st.ctrl && st.ctrl.length >= 4 ? sketchCourse(st.ctrl, cl.wrapKm) : st.pts;
    const out = new Set<number>();
    for (let q = 0; q + 3 < p.length; q += 2) {
      const len = Math.hypot(p[q + 2] - p[q], p[q + 3] - p[q + 1]);
      const steps = Math.max(1, Math.ceil(len / (step * 0.3)));
      for (let t = 0; t <= steps; t++) {
        const k = cellAt(p[q] + ((p[q + 2] - p[q]) * t) / steps, p[q + 1] + ((p[q + 3] - p[q + 1]) * t) / steps);
        if (k >= 0) out.add(k);
      }
    }
    if (p.length === 2) {
      const k = cellAt(p[0], p[1]);
      if (k >= 0) out.add(k);
    }
    return [...out];
  };
  const wall = new Uint8Array(n);
  const joins: number[][] = [];
  for (const st of surface.strokes) {
    if (st.erase) continue;
    if (st.brush === 'divide') for (const k of cellsAlong(st)) wall[k] = 1;
    else if (st.brush === 'join') joins.push(cellsAlong(st));
  }

  // ---- Landmasses: connected land, cut by Divide lines, joined by Join lines ----
  const landId = labelComponents(n, (k) => cl.land[k] === 1, wall, nb, buf);
  absorbWalls(landId, (k) => cl.land[k] === 1, wall, nb, buf);
  unionByJoins(landId, joins);
  const landmasses: GeoFeature[] = [];
  const landCells = groupCells(landId);
  const minContinent = geo.continentMinSqMi * SQMI;
  for (const [id, cells] of landCells) {
    const area = cells.length * cellArea;
    landmasses.push(feature(id, area >= minContinent ? 'continent' : 'island', area >= minContinent ? 'Continent' : 'Island', cells));
  }
  // Archipelagos: three or more islands within a short sail of each other.
  const archipelagoOf = new Map<number, number>();
  const archipelagos: GeoFeature[] = [];
  {
    const islands = new Set(landmasses.filter((f) => f.level === 'island').map((f) => f.id));
    const gap = Math.max(100, step * 2.5);
    const reach = new Int32Array(n).fill(-1);
    const dist = new Float32Array(n).fill(Infinity);
    const queue: number[] = [];
    for (let k = 0; k < n; k++) if (landId[k] >= 0 && islands.has(landId[k])) {
      reach[k] = landId[k];
      dist[k] = 0;
      queue.push(k);
    }
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      let r = a;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    for (const id of islands) parent.set(id, id);
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      for (const m of nb(k, buf).slice()) {
        if (cl.land[m] && !islands.has(landId[m])) continue;
        if (reach[m] >= 0) {
          if (reach[m] !== reach[k] && dist[k] + dist[m] + step <= gap) {
            const a = find(reach[k]);
            const b = find(reach[m]);
            if (a !== b) parent.set(a, b);
          }
          continue;
        }
        if (dist[k] + step > gap / 2) continue;
        reach[m] = reach[k];
        dist[m] = dist[k] + step;
        queue.push(m);
      }
    }
    const groups = new Map<number, number[]>();
    for (const id of islands) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
    let next = 0;
    for (const members of groups.values()) {
      if (members.length < 3) continue;
      const id = next++;
      const cells: number[] = [];
      for (const m of members) {
        archipelagoOf.set(m, id);
        cells.push(...(landCells.get(m) ?? []));
      }
      archipelagos.push(feature(id, 'archipelago', 'Islands', cells));
    }
  }

  // ---- Waters: a watershed on the distance from land, split at narrow straits ----
  const isWater = (k: number) => cl.land[k] === 0;
  const dLand = distanceFrom(n, (k) => cl.land[k] === 1 || wall[k] === 1, nb, buf, step, isWater);
  const waterId = new Int32Array(n).fill(-1);
  const basinPeak: number[] = [];
  const parent: number[] = [];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const order: number[] = [];
  for (let k = 0; k < n; k++) if (isWater(k) && !wall[k]) order.push(k);
  order.sort((a, b) => dLand[b] - dLand[a]);
  const minPeak = Math.max(60, step * 2);
  const onEdge = (k: number) => {
    const i = k % w;
    const j = (k / w) | 0;
    return j === 0 || j === h - 1 || (!wrap && (i === 0 || i === w - 1));
  };
  for (const k of order) {
    const roots = new Set<number>();
    for (const m of nb(k, buf)) if (waterId[m] >= 0) roots.add(find(waterId[m]));
    if (!roots.size) {
      const b = basinPeak.length;
      basinPeak.push(dLand[k]);
      parent.push(b);
      waterId[k] = b;
      continue;
    }
    const list = [...roots].sort((a, b) => basinPeak[b] - basinPeak[a]);
    let keep = list[0];
    for (const r of list.slice(1)) {
      const a = find(keep);
      const b = find(r);
      if (a === b) continue;
      // Two basins meeting: one water if the passage between them is wide for the smaller one.
      const small = Math.min(basinPeak[a], basinPeak[b]);
      // Water meeting at the map's edge carries on past it: that is no strait.
      if (small < minPeak || dLand[k] >= 0.5 * small || onEdge(k)) {
        const [big, sm] = basinPeak[a] >= basinPeak[b] ? [a, b] : [b, a];
        parent[sm] = big;
        keep = big;
      }
    }
    waterId[k] = find(keep);
  }
  for (let k = 0; k < n; k++) if (waterId[k] >= 0) waterId[k] = find(waterId[k]);
  absorbWalls(waterId, isWater, wall, nb, buf);
  unionByJoins(waterId, joins);
  const waters: GeoFeature[] = [];
  const minOcean = 3_000_000 * SQMI;
  const edgeTouch = (cells: number[]) => cells.some((k) => {
    const i = k % w;
    const j = (k / w) | 0;
    return j === 0 || j === h - 1 || (!wrap && (i === 0 || i === w - 1));
  });
  let nextWater = 0;
  const basinCells = groupCells(waterId);
  const relabel = new Int32Array(n).fill(-1);
  for (const [, cells] of basinCells) {
    const id = nextWater++;
    for (const k of cells) relabel[k] = id;
    const area = cells.length * cellArea;
    const peak = Math.max(...cells.map((k) => dLand[k]));
    const ocean = area >= minOcean || (edgeTouch(cells) && peak >= 400 && area >= 250_000 * SQMI);
    waters.push(feature(id, ocean ? 'ocean' : 'sea', ocean ? 'Ocean' : 'Sea', cells));
  }
  waterId.set(relabel);
  // Gulfs and bays: water mostly ringed by land, opening onto bigger water.
  {
    const enclosed = new Uint8Array(n);
    const R = Math.max(300, step * 6);
    const dirs = 16;
    for (let k = 0; k < n; k++) {
      if (waterId[k] < 0) continue;
      let hits = 0;
      for (let d = 0; d < dirs; d++) {
        const a = (d / dirs) * Math.PI * 2;
        for (let t = step; t <= R; t += step) {
          const m = cellAt(xOf(k) + Math.cos(a) * t, yOf(k) + Math.sin(a) * t);
          if (m < 0) break;
          if (cl.land[m]) {
            hits++;
            break;
          }
        }
      }
      if (hits / dirs >= 0.62) enclosed[k] = 1;
    }
    const inletId = labelComponents(n, (k) => enclosed[k] === 1, wall, nb, buf);
    for (const [, cells] of groupCells(inletId)) {
      const parentWater = waterId[cells[0]];
      const total = waters[parentWater]?.area ?? 0;
      const area = cells.length * cellArea;
      if (cells.length < 3 || area > total * 0.45) continue;
      const id = nextWater++;
      const gulf = area >= 120_000;
      waters.push(feature(id, gulf ? 'gulf' : 'bay', gulf ? 'Gulf' : 'Bay', cells));
      for (const k of cells) waterId[k] = id;
    }
  }

  // ---- Natural regions: land of one kind, split at mountain crests, big rivers and Divide lines, sized to about the region size ----
  const kind: string[] = new Array(n).fill('');
  for (let k = 0; k < n; k++) {
    if (!cl.land[k]) continue;
    const z = cl.zone[k];
    const hk = cl.height[k];
    if (z === 13) kind[k] = 'Icefield';
    else if (hk >= 1.8) kind[k] = 'Mountains';
    else if (hk >= 0.85) kind[k] = 'Highlands';
    else {
      const c = cl.cover;
      const main = c.share[k] > 0.5 ? c.second[k] : c.main[k];
      kind[k] = main >= 0 ? COVER_KIND[COVER_BRUSHES[main]] ?? 'Plains' : 'Plains';
    }
  }
  // Smooth out specks, so regions are not broken up by single odd points.
  for (let pass = 0; pass < 2; pass++) {
    const next = kind.slice();
    for (let k = 0; k < n; k++) {
      if (!kind[k]) continue;
      const count = new Map<string, number>();
      for (const m of nb(k, buf)) if (kind[m]) count.set(kind[m], (count.get(kind[m]) ?? 0) + 1);
      let best = kind[k];
      let bc = (count.get(kind[k]) ?? 0) + 1;
      for (const [kk, c] of count) if (c > bc) {
        best = kk;
        bc = c;
      }
      next[k] = best;
    }
    for (let k = 0; k < n; k++) kind[k] = next[k];
  }
  // Big rivers part regions as well as Divide lines do.
  const regionWall = wall.slice();
  for (const r of riverNetwork(surface).values()) {
    const p = r.stroke.pts;
    for (let q = 2; q < p.length; q += 2) {
      if (Math.sqrt(flowAt(r, r.cum[q / 2])) < 2.2) continue;
      const k = cellAt(p[q], p[q + 1]);
      if (k >= 0 && cl.land[k]) regionWall[k] = 1;
    }
  }
  const D = Math.max(60, geo.regionMi * 1.609344);
  const sameKind = (a: number, b: number) => kind[a] === kind[b] && landId[a] === landId[b];
  let regionId = labelComponents(n, (k) => cl.land[k] === 1, regionWall, nb, buf, sameKind);
  absorbWalls(regionId, (k) => cl.land[k] === 1, regionWall, nb, buf, (a, b) => landId[a] === landId[b]);
  regionId = mergeSmall(regionId, n, nb, buf, (0.4 * D) ** 2 / cellArea, (a, b) => landId[a] === landId[b]);
  regionId = splitLarge(regionId, n, nb, buf, (D * D) / cellArea, xOf, yOf, (1.6 * D) ** 2 / cellArea, s.seed);
  unionByJoins(regionId, joins);
  const regions: GeoFeature[] = [];
  const regionCells = groupCells(regionId);
  const relabelR = new Int32Array(n).fill(-1);
  let nextRegion = 0;
  for (const [, cells] of regionCells) {
    const id = nextRegion++;
    for (const k of cells) relabelR[k] = id;
    const count = new Map<string, number>();
    for (const k of cells) count.set(kind[k], (count.get(kind[k]) ?? 0) + 1);
    const top = [...count].sort((a, b) => b[1] - a[1])[0][0] || 'Plains';
    regions.push(feature(id, 'region', top, cells));
  }

  return { land: landId, water: waterId, region: relabelR, archipelagoOf, landmasses, archipelagos, waters, regions };

  /** A feature's label anchor: the point deepest inside it, and the way it runs. */
  function feature(id: number, level: GeoLevel, kindName: string, cells: number[]): GeoFeature {
    // Unwrap x around the first cell, so a feature across a wrapping edge stays in one piece.
    const x0 = xOf(cells[0]);
    const xs = cells.map((k) => {
      let x = xOf(k);
      if (wrap) {
        if (x - x0 > cl.wrapKm / 2) x -= cl.wrapKm;
        else if (x0 - x > cl.wrapKm / 2) x += cl.wrapKm;
      }
      return x;
    });
    const ys = cells.map(yOf);
    const m = cells.length;
    const mx = xs.reduce((a, b) => a + b, 0) / m;
    const my = ys.reduce((a, b) => a + b, 0) / m;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let q = 0; q < m; q++) {
      const dx = xs[q] - mx;
      const dy = ys[q] - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // Keep text readable: never upside down, and never steeper than about 60°.
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    angle = Math.max(-1.05, Math.min(1.05, angle));
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    let lo = Infinity;
    let hi = -Infinity;
    let wlo = Infinity;
    let whi = -Infinity;
    for (let q = 0; q < m; q++) {
      const u = (xs[q] - mx) * ca + (ys[q] - my) * sa;
      const v = -(xs[q] - mx) * sa + (ys[q] - my) * ca;
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
      wlo = Math.min(wlo, v);
      whi = Math.max(whi, v);
    }
    // The label sits on the cell deepest inside the feature nearest its middle (so a C-shaped
    // bay or a crescent of land still has its name on it).
    const set = new Set(cells);
    const depth = new Map<number, number>();
    const queue: number[] = [];
    // Measured from its shores only: the map's edge is not a shore (the land or water goes on past it).
    for (const k of cells) if (nb(k, buf).some((q) => !set.has(q))) {
      depth.set(k, 1);
      queue.push(k);
    }
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      for (const t of nb(k, buf)) if (set.has(t) && !depth.has(t)) {
        depth.set(t, depth.get(k)! + 1);
        queue.push(t);
      }
    }
    // Far from its shores, and not up against the map's edge (where the label would be cut off).
    const edgeKm = (k: number) => {
      const i = k % w;
      const j = (k / w) | 0;
      return Math.min(j, h - 1 - j, wrap ? Infinity : Math.min(i, w - 1 - i)) * step + step;
    };
    const scores = cells.map((k, q) => Math.min((depth.get(k) ?? 1e4) * step, edgeKm(k) * 1.5) - 0.25 * Math.hypot(xs[q] - mx, ys[q] - my));
    const rank = scores.map((_, q) => q).sort((a, b) => scores[b] - scores[a]);
    // The best spot, then up to two more well away from it (in case the first is crowded).
    const picks: number[] = [];
    const apart = Math.max(step * 3, (hi - lo) / 4);
    for (const q of rank) {
      if (picks.length >= 3) break;
      if (picks.every((p) => Math.hypot(xs[p] - xs[q], ys[p] - ys[q]) > apart)) picks.push(q);
    }
    const norm = (x: number) => (cl.wrapKm ? ((x % cl.wrapKm) + cl.wrapKm) % cl.wrapKm : x);
    const [b0, ...rest] = picks;
    return { id, level, kind: kindName, area: m * cellArea, x: norm(xs[b0]), y: ys[b0], angle, length: hi - lo + step, width: whi - wlo + step, alt: rest.map((q) => [norm(xs[q]), ys[q]] as [number, number]) };
  }
}

/** Connected parts (4 neighbours) of the cells where `inside` holds, not crossing walls; optionally only between cells `same` accepts. */
function labelComponents(n: number, inside: (k: number) => boolean, wall: Uint8Array, nb: (k: number, out: number[]) => number[], buf: number[], same?: (a: number, b: number) => boolean): Int32Array {
  const id = new Int32Array(n).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let k = 0; k < n; k++) {
    if (id[k] >= 0 || !inside(k) || wall[k]) continue;
    id[k] = next;
    stack.push(k);
    while (stack.length) {
      const c = stack.pop()!;
      for (const m of nb(c, buf)) if (id[m] < 0 && inside(m) && !wall[m] && (!same || same(c, m))) {
        id[m] = next;
        stack.push(m);
      }
    }
    next++;
  }
  return id;
}

/** Cells under a line take the part beside them. */
function absorbWalls(id: Int32Array, inside: (k: number) => boolean, wall: Uint8Array, nb: (k: number, out: number[]) => number[], buf: number[], same?: (a: number, b: number) => boolean): void {
  let left = true;
  for (let pass = 0; pass < 8 && left; pass++) {
    left = false;
    for (let k = 0; k < id.length; k++) {
      if (id[k] >= 0 || !inside(k) || !wall[k]) continue;
      const m = nb(k, buf).find((q) => id[q] >= 0 && (!same || same(k, q)));
      if (m !== undefined) id[k] = id[m];
      else left = true;
    }
  }
  // A line drawn on a speck of land on its own: the speck is its own part.
  let next = Math.max(-1, ...id) + 1;
  for (let k = 0; k < id.length; k++) if (id[k] < 0 && inside(k) && wall[k]) id[k] = next++;
}

/** Join lines: every part a line touches becomes one. */
function unionByJoins(id: Int32Array, joins: number[][]): void {
  for (const cells of joins) {
    const touched = [...new Set(cells.map((k) => id[k]).filter((v) => v >= 0))];
    if (touched.length < 2) continue;
    const to = touched[0];
    const from = new Set(touched.slice(1));
    for (let k = 0; k < id.length; k++) if (from.has(id[k])) id[k] = to;
  }
}

function groupCells(id: Int32Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let k = 0; k < id.length; k++) {
    const v = id[k];
    if (v < 0) continue;
    let list = out.get(v);
    if (!list) out.set(v, (list = []));
    list.push(k);
  }
  return out;
}

/** Distance (km, along the grid) from the cells where `seed` holds, through cells `through` accepts. */
function distanceFrom(n: number, seed: (k: number) => boolean, nb: (k: number, out: number[]) => number[], buf: number[], step: number, through: (k: number) => boolean): Float32Array {
  const d = new Float32Array(n).fill(Infinity);
  const queue: number[] = [];
  for (let k = 0; k < n; k++) if (seed(k)) {
    d[k] = 0;
    queue.push(k);
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    for (const m of nb(k, buf)) if (d[m] === Infinity && through(m)) {
      d[m] = d[k] + step;
      queue.push(m);
    }
  }
  // Water with no land in reach (an empty map): very far.
  for (let k = 0; k < n; k++) if (d[k] === Infinity) d[k] = 1e6;
  return d;
}

/** Parts smaller than `minCells` join the neighbour they share the longest border with. */
function mergeSmall(id: Int32Array, n: number, nb: (k: number, out: number[]) => number[], buf: number[], minCells: number, may: (a: number, b: number) => boolean): Int32Array {
  for (let round = 0; round < 6; round++) {
    const size = new Map<number, number>();
    for (let k = 0; k < n; k++) if (id[k] >= 0) size.set(id[k], (size.get(id[k]) ?? 0) + 1);
    const border = new Map<number, Map<number, number>>();
    for (let k = 0; k < n; k++) {
      const a = id[k];
      if (a < 0 || size.get(a)! >= minCells) continue;
      for (const m of nb(k, buf)) {
        const b = id[m];
        if (b < 0 || b === a || !may(k, m)) continue;
        let row = border.get(a);
        if (!row) border.set(a, (row = new Map()));
        row.set(b, (row.get(b) ?? 0) + 1);
      }
    }
    if (!border.size) break;
    const into = new Map<number, number>();
    // Smallest first, so specks join whole regions rather than each other.
    for (const a of [...border.keys()].sort((p, q) => size.get(p)! - size.get(q)!)) {
      const row = border.get(a)!;
      let best = -1;
      let bc = -1;
      for (const [b, c] of row) if (c > bc && into.get(b) !== a) {
        best = b;
        bc = c;
      }
      if (best >= 0) into.set(a, best);
    }
    const root = (a: number): number => {
      let r = a;
      for (let guard = 0; into.has(r) && guard < 50; guard++) r = into.get(r)!;
      return r;
    };
    for (let k = 0; k < n; k++) if (id[k] >= 0 && into.has(id[k])) id[k] = root(id[k]);
  }
  return id;
}

/** Parts much bigger than the region size are cut into about region-sized pieces, with ragged, natural-looking borders. */
function splitLarge(id: Int32Array, n: number, nb: (k: number, out: number[]) => number[], buf: number[], targetCells: number, xOf: (k: number) => number, yOf: (k: number) => number, maxCells: number, seed: number): Int32Array {
  const groups = groupCells(id);
  let next = Math.max(-1, ...id) + 1;
  const out = id.slice();
  let rnd = (seed >>> 0) || 1;
  const random = () => {
    rnd ^= rnd << 13;
    rnd ^= rnd >>> 17;
    rnd ^= rnd << 5;
    return (rnd >>> 0) / 4294967296;
  };
  for (const [, cells] of groups) {
    if (cells.length <= maxCells) continue;
    const parts = Math.max(2, Math.round(cells.length / targetCells));
    // Seeds spread out: each new one as far as possible from those already chosen.
    const seeds = [cells[Math.floor(random() * cells.length)]];
    const far = new Float64Array(cells.length).fill(Infinity);
    while (seeds.length < parts) {
      const last = seeds[seeds.length - 1];
      let bi = 0;
      let bd = -1;
      for (let q = 0; q < cells.length; q++) {
        far[q] = Math.min(far[q], Math.hypot(xOf(cells[q]) - xOf(last), yOf(cells[q]) - yOf(last)));
        if (far[q] > bd) {
          bd = far[q];
          bi = q;
        }
      }
      seeds.push(cells[bi]);
    }
    // Grow the pieces outward together, at a slightly uneven pace, so borders wander.
    const inside = new Set(cells);
    const cost = new Map<number, number>();
    const label = new Map<number, number>();
    const heap: [number, number, number][] = [];
    const push = (c: number, k: number, l: number) => {
      heap.push([c, k, l]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): [number, number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const a = 2 * i + 1;
          const b = a + 1;
          let m = i;
          if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
          if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    seeds.forEach((k, l) => push(0, k, next + l));
    while (heap.length) {
      const [c, k, l] = pop();
      if (label.has(k)) continue;
      label.set(k, l);
      cost.set(k, c);
      for (const m of nb(k, buf)) if (inside.has(m) && !label.has(m)) push(c + 0.6 + random() * 0.8, m, l);
    }
    for (const [k, l] of label) out[k] = l;
    next += parts;
  }
  return out;
}

/** The names given by Name pins: the latest pin inside each feature wins. */
export function geoNames(surface: Surface, cl: Climate): { land: Map<number, string>; water: Map<number, string>; region: Map<number, string>; archipelago: Map<number, string> } {
  const out = { land: new Map<number, string>(), water: new Map<number, string>(), region: new Map<number, string>(), archipelago: new Map<number, string>() };
  const g = cl.geo;
  if (!g) return out;
  for (const st of surface.strokes) {
    if (st.brush !== 'name' || st.erase || !st.label || st.pts.length < 2) continue;
    const k = geoCell(cl, st.pts[0], st.pts[1]);
    if (k < 0) continue;
    const of = st.nameOf ?? 'land';
    if (of === 'land' && g.land[k] >= 0) out.land.set(g.land[k], st.label);
    else if (of === 'archipelago' && g.land[k] >= 0 && g.archipelagoOf.has(g.land[k])) out.archipelago.set(g.archipelagoOf.get(g.land[k])!, st.label);
    else if (of === 'water' && g.water[k] >= 0) out.water.set(g.water[k], st.label);
    else if (of === 'region' && g.region[k] >= 0) out.region.set(g.region[k], st.label);
  }
  return out;
}

/** The climate point under a place (km), or −1 off the map. */
export function geoCell(cl: Climate, x: number, y: number): number {
  let i = Math.round((x - cl.x0) / cl.step);
  const j = Math.round((y - cl.y0) / cl.step);
  if (j < 0 || j >= cl.h) return -1;
  if (i < 0 || i >= cl.w) {
    if (!cl.wrapKm) return -1;
    i = ((i % cl.w) + cl.w) % cl.w;
  }
  return j * cl.w + i;
}
