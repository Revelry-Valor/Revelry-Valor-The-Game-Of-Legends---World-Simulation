import { fineIndex, neighbours4 } from './finegeo';
import { fbm } from './noise';
import { grow, MAX_FINE_POINTS, OFF_MAP, wholeProvinces } from './provinces';
import type { WorldSettings } from './settings';
import { milesToKm } from './units';
import type { Grid } from './terrain';
import { assembleRings, traceChains } from './trace';

/**
 * Provinces grown on a layer's own ground (the Underdark, the canopy and the sky layers): the
 * same way as the surface's, from a grid of what each point is (its "medium": 0 for nothing, then
 * the layer's own kinds of ground). Each connected stretch of one medium is a zone no province
 * crosses (never merged across kinds: painted edges are hard lines); strips (tunnels, limbs, vines)
 * get a province every so far along; provinces grow from seeds kept with the world, so growing them
 * again after repainting keeps each where it was, with its id.
 */

export interface MediumSpec {
  /** How far across a province of this medium is (km), or how long a stretch of a strip. */
  size(m: number): number;
  strip(m: number): boolean;
  kind(m: number): string;
  terrain(m: number): string;
  /** Whether a cover (1–3 in the cover grid) can be noted for it. */
  coverOk(m: number): boolean;
}

export interface LayerProvince {
  id: number;
  medium: number;
  kind: string;
  x: number;
  y: number;
  area: number;
  terrain: string;
  /** The cover over most of it (1–3), 0 for none. */
  cover: number;
  neighbours: number[];
}

export interface GrownProvinces {
  label: Int32Array;
  provinces: LayerProvince[];
  borders: { pts: number[]; a: number; b: number }[];
  rings: number[][][];
  seeds: number[];
  ids: number[];
  nextId: number;
}

const sq = (v: number) => v * v;

/**
 * How far apart a layer's fine points are: fine enough for its provinces (about six to a province
 * across) and for its narrowest painted feature (a tunnel's, limb's or vine's width, two and a half
 * points across), so the provinces keep to the painted edges; never finer than the map can hold.
 */
export function layerGridKm(s: WorldSettings, sizesMi: number[], finestKm: number): number {
  const floor = Math.sqrt((s.widthKm * s.heightKm) / MAX_FINE_POINTS);
  return Math.max(floor, Math.min(milesToKm(Math.min(...sizesMi)) / 6, finestKm / 2.5));
}

export function provincesFromMedium(grid: Grid, wrapKm: number, medium: Uint8Array, cover: Uint8Array | null, spec: MediumSpec, saved: { seeds: number[]; ids: number[]; nextId: number } | null, seed: number, noiseKm: number): GrownProvinces {
  const { w, h, px, x0, y0 } = grid;
  const n = w * h;
  const wrap = wrapKm > 0;
  const nb = neighbours4(w, h, wrap);
  const buf: number[] = [];
  // ---- Zones: each connected stretch of one medium ----
  const zone = new Int32Array(n).fill(-1);
  let zones = 0;
  const stack: number[] = [];
  for (let k = 0; k < n; k++) {
    if (zone[k] >= 0 || medium[k] === 0) continue;
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
  const sizeFor = (m: number) => sq(spec.size(m)) / pxArea;
  const strip = (m: number) => spec.strip(m);
  // No merging across kinds of ground: every painted edge (a cave's, a tunnel's, a limb's, a vine's,
  // an island's) is a hard line provinces form round, however small the piece it leaves.

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
    let x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c + seed + 4049, 2246822519);
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
  for (let k = 0; k < n; k++) noise[k] = Math.round(127.5 + 127.5 * Math.max(-1, Math.min(1, 1.8 * fbm(xOf(k), yOf(k), noiseKm * 0.4, px, seed + 977, 4))));
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
    if (cover) covers[l * 4 + cover[k]]++;
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
  const provinces: LayerProvince[] = keep.map((l) => {
    const k0 = seedPix[l];
    const m = zm[zone[k0]];
    let c = 0;
    for (let q = 1; q < 4; q++) if (covers[l * 4 + q] > covers[l * 4 + c]) c = q;
    // A cover counts when it is on a good share of the floor.
    const coverHere = spec.coverOk(m) && c > 0 && covers[l * 4 + c] >= cnt[l] * 0.25 ? c : 0;
    let x = xOf(k0) + sx[l] / cnt[l];
    if (wrap) x = ((x % wrapKm) + wrapKm) % wrapKm;
    let y = sy[l] / cnt[l];
    const kc = fineIndex(grid, wrapKm, x, y);
    if (kc < 0 || label[kc] !== to[l]) [x, y] = [xOf(k0), yOf(k0)];
    return { id: seedId[l], medium: m, kind: spec.kind(m), x, y, area: cnt[l] * pxArea, terrain: spec.terrain(m), cover: coverHere, neighbours: neighbours[l].map((q) => to[q]).filter((q) => q >= 0) };
  });
  const lx = (X: number) => x0 + (X - 0.5) * px;
  const ly = (Y: number) => y0 + (Y - 0.5) * px;
  const toKm = (p: number[]) => p.map((v, i) => Math.round((i % 2 ? ly(v) : lx(v)) * 100) / 100);
  const held = (l: number) => l >= 0;
  const narrow = (l: number) => l >= 0 && !!provinces[l] && spec.strip(provinces[l].medium);
  const chains = traceChains(label, w, h, wrap, held, OFF_MAP, (a, b) => (narrow(a) || narrow(b) ? 0.35 : 0.9));
  const ringMap = assembleRings(chains, w, wrap, held);
  return {
    label,
    provinces,
    borders: chains.map((c) => ({ pts: toKm(c.pts), a: c.left, b: c.right })),
    rings: provinces.map((_, l) => (ringMap.get(l) ?? []).map(toKm)),
    seeds: keep.flatMap((l) => [Math.round(xOf(seedPix[l]) * 100) / 100, Math.round(yOf(seedPix[l]) * 100) / 100]),
    ids: keep.map((l) => seedId[l]),
    nextId,
  };
}
