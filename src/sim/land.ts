import type { ProvinceMap } from '../core/provinces';
import type { Env } from './env';
import type { SimState } from './state';

/**
 * Land held by province (REDESIGN.md 8.6a, step 2). A realm or tribe holds whole provinces: who
 * holds each province, and who is using it against its holder (a year of that use takes it), are
 * kept by province. Every climate point of a province mirrors its holder in `sim.owner` (and the
 * rival use in `sim.rival` / `sim.rivalUse`), so everything that reads the land point by point
 * (the economy, wars, politics) sees the provinces.
 *
 * Without a province map (tests, or before provinces are made) each climate point is a province of
 * its own, so the same rules hold on the points.
 */

/** Province kinds as the simulation sees them. */
export const PK = { land: 0, sea: 1, lake: 2, waste: 3 } as const;

export interface ProvIndex {
  /** From the province generator (false: each climate point is a province). */
  real: boolean;
  count: number;
  /** Each province's id (kept across updates of the provinces). */
  ids: Int32Array;
  /** The province each climate point lies in (−1 none). */
  of: Int32Array;
  /** The climate points of each province (land points for land provinces): cells[start[p] … start[p+1]). */
  start: Int32Array;
  cells: Int32Array;
  /** Its middle (km), area (km²), kind (PK) and the climate point at its middle. */
  x: Float32Array;
  y: Float32Array;
  area: Float32Array;
  kind: Uint8Array;
  centre: Int32Array;
  /** Neighbours: nb[nbStart[p] … nbStart[p+1]). */
  nbStart: Int32Array;
  nb: Int32Array;
  /** How hard it is to cross (1 open lowland; hills, forest, highlands and mountains more; Infinity impassable). */
  rough: Float32Array;
}

/** How hard a province's ground is to cross, from its relief band and terrain. */
export function roughOf(band: number, terrain: string): number {
  const relief = [1, 1.4, 1.8, 3, Infinity, 1.5][band] ?? 1;
  const cover = /Forest|Jungle|Taiga/.test(terrain) ? 1.3 : /Desert|Icefield/.test(terrain) ? 1.2 : 1;
  return relief * cover;
}

const cellOf = (env: Env, x: number, y: number) => {
  let i = Math.round((x - env.x0) / env.step);
  const j = Math.round((y - env.y0) / env.step);
  if (j < 0 || j >= env.h) return -1;
  if (i < 0 || i >= env.w) {
    if (!env.wrapKm) return -1;
    i = ((i % env.w) + env.w) % env.w;
  }
  return j * env.w + i;
};
const distOn = (env: Env, ax: number, ay: number, bx: number, by: number) => {
  let dx = Math.abs(ax - bx);
  if (env.wrapKm) dx = Math.min(dx, env.wrapKm - dx);
  return Math.hypot(dx, ay - by);
};

/** Each climate point a province of its own. */
export function cellProvinces(env: Env): ProvIndex {
  const { w, h, n } = env;
  const ids = new Int32Array(n);
  const of = new Int32Array(n);
  const start = new Int32Array(n + 1);
  const cells = new Int32Array(n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const area = new Float32Array(n).fill(env.cellArea);
  const kind = new Uint8Array(n);
  const centre = new Int32Array(n);
  const nbStart = new Int32Array(n + 1);
  const nbList: number[] = [];
  for (let k = 0; k < n; k++) {
    ids[k] = k + 1;
    of[k] = k;
    start[k + 1] = k + 1;
    cells[k] = k;
    x[k] = env.x0 + (k % w) * env.step;
    y[k] = env.y0 + ((k / w) | 0) * env.step;
    kind[k] = env.land[k] ? PK.land : PK.sea;
    centre[k] = k;
    const i = k % w;
    const j = (k / w) | 0;
    if (i > 0) nbList.push(k - 1);
    else if (env.wrapKm) nbList.push(k + w - 1);
    if (i < w - 1) nbList.push(k + 1);
    else if (env.wrapKm) nbList.push(k - w + 1);
    if (j > 0) nbList.push(k - w);
    if (j < h - 1) nbList.push(k + w);
    nbStart[k + 1] = nbList.length;
  }
  const rough = Float32Array.from(env.mzone, (z, k) => (env.land[k] ? [1, 1.3, 1.8, 3, Infinity][z] : 0.7));
  return { real: false, count: n, ids, of, start, cells, x, y, area, kind, centre, nbStart, nb: Int32Array.from(nbList), rough };
}

/** The provinces from the generator, on the climate's points: each point to the province covering most of it. */
export function provinceIndex(env: Env, pm: ProvinceMap): ProvIndex {
  const P = pm.provinces.length;
  const { grid } = pm;
  const fw = grid.w;
  const fh = grid.h;
  const kindOf = (p: number) => {
    const k = pm.provinces[p].kind;
    return k === 'land' ? PK.land : k === 'sea' ? PK.sea : k === 'lake' ? PK.lake : PK.waste;
  };
  const kinds = new Uint8Array(P);
  for (let p = 0; p < P; p++) kinds[p] = kindOf(p);
  const of = new Int32Array(env.n).fill(-1);
  const count = new Map<number, number>();
  const r = Math.max(0, Math.floor(env.step / grid.px / 2));
  for (let k = 0; k < env.n; k++) {
    const cx = env.x0 + (k % env.w) * env.step;
    const cy = env.y0 + ((k / env.w) | 0) * env.step;
    const ci = Math.round((cx - grid.x0) / grid.px);
    const cj = Math.round((cy - grid.y0) / grid.px);
    const wantLand = env.land[k] === 1;
    count.clear();
    let best = -1;
    let bc = 0;
    for (let rr = r; rr <= r + 6 && best < 0; rr += 2) {
      for (let dj = -rr; dj <= rr; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= fh) continue;
        for (let di = -rr; di <= rr; di++) {
          let i = ci + di;
          if (i < 0 || i >= fw) {
            if (!pm.wrapKm) continue;
            i = ((i % fw) + fw) % fw;
          }
          const l = pm.label[j * fw + i];
          if (l < 0 || (kinds[l] !== PK.sea) !== wantLand) continue;
          const c = (count.get(l) ?? 0) + 1;
          count.set(l, c);
          if (c > bc) [best, bc] = [l, c];
        }
      }
      if (!wantLand) break;
    }
    of[k] = best;
  }
  const size = new Int32Array(P);
  for (let k = 0; k < env.n; k++) if (of[k] >= 0) size[of[k]]++;
  const start = new Int32Array(P + 1);
  for (let p = 0; p < P; p++) start[p + 1] = start[p] + size[p];
  const cells = new Int32Array(start[P]);
  const fill = start.slice(0, P);
  for (let k = 0; k < env.n; k++) if (of[k] >= 0) cells[fill[of[k]]++] = k;
  const nbStart = new Int32Array(P + 1);
  for (let p = 0; p < P; p++) nbStart[p + 1] = nbStart[p] + pm.provinces[p].neighbours.length;
  const nb = new Int32Array(nbStart[P]);
  for (let p = 0; p < P; p++) nb.set(pm.provinces[p].neighbours, nbStart[p]);
  return {
    real: true,
    count: P,
    ids: Int32Array.from(pm.provinces, (p) => p.id),
    of,
    start,
    cells,
    x: Float32Array.from(pm.provinces, (p) => p.x),
    y: Float32Array.from(pm.provinces, (p) => p.y),
    area: Float32Array.from(pm.provinces, (p) => p.area),
    kind: kinds,
    centre: Int32Array.from(pm.provinces, (p) => cellOf(env, p.x, p.y)),
    nbStart,
    nb,
    rough: Float32Array.from(pm.provinces, (p) => (p.kind === 'sea' ? 0.7 : p.kind === 'lake' ? 1.5 : roughOf(p.band, p.terrain))),
  };
}

/** Use the generator's provinces from now on. */
export function attachProvinces(env: Env, pm: ProvinceMap | null): void {
  env.prov = pm ? provinceIndex(env, pm) : cellProvinces(env);
}

/** The province at a place (−1 none). */
export function provAt(env: Env, x: number, y: number): number {
  const k = cellOf(env, x, y);
  return k >= 0 ? env.prov.of[k] : -1;
}
/** The province a climate point lies in. */
export const provOfCell = (env: Env, k: number) => (k >= 0 ? env.prov.of[k] : -1);
/** Land a people can hold (not sea, lake or impassable peaks). */
export const holdable = (env: Env, p: number) => p >= 0 && env.prov.kind[p] === PK.land;

/**
 * Fit the simulation's provinces to the environment's: values carried over by province id; a
 * province new to it (or a simulation from before provinces) goes to whoever holds most of its
 * points. Then every point mirrors its province.
 */
export function bindProvinces(sim: SimState, env: Env): void {
  const P = env.prov;
  // Saved by the generator's provinces, which have not been grown again yet: wait for them (the points hold the land meanwhile).
  if (!P.real && sim.provIds && sim.provIds.length !== P.count) return;
  const same = sim.provIds && sim.provIds.length === P.count && sim.provIds.every((v, i) => v === P.ids[i]);
  if (!same) {
    const old = new Map<number, number>();
    if (sim.provIds && sim.provOwner) sim.provIds.forEach((id, i) => old.set(id, i));
    const owner = new Int32Array(P.count).fill(-1);
    const rival = new Int32Array(P.count).fill(-1);
    const use = new Float32Array(P.count);
    const tally = new Map<number, number>();
    for (let p = 0; p < P.count; p++) {
      const o = old.get(P.ids[p]);
      if (o !== undefined && sim.provOwner) {
        owner[p] = sim.provOwner[o];
        rival[p] = sim.provRival?.[o] ?? -1;
        use[p] = sim.provRivalUse?.[o] ?? 0;
        continue;
      }
      // Whoever holds most of its points.
      tally.clear();
      let best = -1;
      let bc = 0;
      for (let q = P.start[p]; q < P.start[p + 1]; q++) {
        const c = sim.owner[P.cells[q]];
        if (c < 0) continue;
        const v = (tally.get(c) ?? 0) + 1;
        tally.set(c, v);
        if (v > bc) [best, bc] = [c, v];
      }
      if (best < 0 && P.centre[p] >= 0) best = sim.owner[P.centre[p]];
      owner[p] = P.kind[p] === PK.land ? best : -1;
    }
    sim.provIds = Int32Array.from(P.ids);
    sim.provOwner = owner;
    sim.provRival = rival;
    sim.provRivalUse = use;
  }
  syncCells(sim, env);
}

/** Every climate point to its province's holder (points in no province are let go). */
export function syncCells(sim: SimState, env: Env): void {
  const P = env.prov;
  for (let k = 0; k < env.n; k++) {
    const p = P.of[k];
    if (p < 0 || !sim.provOwner) {
      sim.owner[k] = -1;
      sim.rival[k] = -1;
      sim.rivalUse[k] = 0;
      continue;
    }
    sim.owner[k] = sim.provOwner[p];
    sim.rival[k] = sim.provRival![p];
    sim.rivalUse[k] = sim.provRivalUse![p];
  }
}

const mirror = (sim: SimState, env: Env, p: number) => {
  const P = env.prov;
  for (let q = P.start[p]; q < P.start[p + 1]; q++) {
    const k = P.cells[q];
    sim.owner[k] = sim.provOwner![p];
    sim.rival[k] = sim.provRival![p];
    sim.rivalUse[k] = sim.provRivalUse![p];
  }
};

/** Who holds a province (−1 none). */
export const holderOf = (sim: SimState, p: number) => (p >= 0 && sim.provOwner ? sim.provOwner[p] : -1);

/** A province changes hands (any rival use of it ends). */
export function setHolder(sim: SimState, env: Env, p: number, clan: number): void {
  if (p < 0 || !sim.provOwner) return;
  sim.provOwner[p] = clan;
  sim.provRival![p] = -1;
  sim.provRivalUse![p] = 0;
  mirror(sim, env, p);
}

/** All of one clan's land goes to another (or is let go, to −1). */
export function transferAll(sim: SimState, env: Env, from: number, to: number): void {
  if (!sim.provOwner) return;
  for (let p = 0; p < sim.provOwner.length; p++) if (sim.provOwner[p] === from) setHolder(sim, env, p, to);
}

/**
 * The provinces near a place: the one it is in, and those reached from it, province to province,
 * that reach within `r` km (their middles within `r` and half their width; only across land a people can hold).
 */
export function provincesNear(env: Env, x: number, y: number, r: number): number[] {
  const P = env.prov;
  const p0 = provAt(env, x, y);
  if (p0 < 0) return [];
  const out = [p0];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (i > 0 && P.kind[p] !== PK.land) continue;
    for (let q = P.nbStart[p]; q < P.nbStart[p + 1]; q++) {
      const m = P.nb[q];
      if (seen.has(m)) continue;
      seen.add(m);
      if (P.kind[m] !== PK.land || distOn(env, x, y, P.x[m], P.y[m]) > r + 0.5 * Math.sqrt(P.area[m])) continue;
      out.push(m);
    }
  }
  return out;
}

/** How far apart provinces are here (km): about the width of the one at a place. */
export function provinceSpan(env: Env, x: number, y: number): number {
  const p = provAt(env, x, y);
  return p >= 0 ? Math.sqrt(env.prov.area[p]) : env.step;
}

/**
 * Claim the unheld land near a place: the province it is in and those round it within `r` km,
 * unless `blocked` says a river or mountains lie between (claimed by going there, not over them).
 */
export function claimNear(sim: SimState, env: Env, x: number, y: number, r: number, clan: number, blocked: (x: number, y: number, k: number) => boolean): void {
  const P = env.prov;
  const list = provincesNear(env, x, y, r);
  list.forEach((p, i) => {
    if (P.kind[p] !== PK.land || holderOf(sim, p) >= 0) return;
    if (i > 0 && P.centre[p] >= 0 && blocked(x, y, P.centre[p])) return;
    setHolder(sim, env, p, clan);
  });
}

/**
 * A people working land: the unheld provinces among the points they work become theirs; others'
 * provinces build up their use, and after a year of it one changes hands unless its holders are
 * still about (`ownerHere`).
 */
export function useProvinces(sim: SimState, env: Env, cells: number[], clan: number, from: { x: number; y: number } | undefined, blocked: (x: number, y: number, k: number) => boolean, ownerHere: (owner: number, x: number, y: number) => boolean): void {
  const P = env.prov;
  // Each province once, and whether any of its worked points is within reach.
  const reach = new Map<number, boolean>();
  for (const c of cells) {
    if (!env.land[c]) continue;
    const p = P.of[c];
    if (p < 0 || P.kind[p] !== PK.land) continue;
    const ok = !from || !blocked(from.x, from.y, c);
    reach.set(p, (reach.get(p) ?? false) || ok);
  }
  for (const [p, ok] of reach) {
    const o = sim.provOwner![p];
    if (o < 0) {
      if (ok) setHolder(sim, env, p, clan);
      continue;
    }
    if (o === clan) {
      if (sim.provRivalUse![p] > 0) {
        sim.provRivalUse![p] = Math.max(0, sim.provRivalUse![p] - 1);
        if (!sim.provRivalUse![p]) sim.provRival![p] = -1;
        mirror(sim, env, p);
      }
      continue;
    }
    if (!ok) continue;
    if (sim.provRival![p] === clan) sim.provRivalUse![p] += 1;
    else {
      sim.provRival![p] = clan;
      sim.provRivalUse![p] = 1;
    }
    mirror(sim, env, p);
    if (sim.provRivalUse![p] < 12) continue;
    if (!ownerHere(o, P.x[p], P.y[p])) setHolder(sim, env, p, clan);
  }
}

/**
 * Tidy the map once a year: an unheld province ringed by one realm's land (three quarters of its
 * holdable neighbours, at least two) joins it; a lone province of one realm inside another's
 * (no neighbour of its own, three quarters the other's) goes to the land round it, unless a
 * settlement of its holder stands in it.
 */
export function tidyProvinces(sim: SimState, env: Env, seats: Set<number>): void {
  const P = env.prov;
  const own = sim.provOwner!;
  const next = Int32Array.from(own);
  const count = new Map<number, number>();
  for (let p = 0; p < P.count; p++) {
    if (P.kind[p] !== PK.land) continue;
    count.clear();
    let m = 0;
    let mine = 0;
    for (let q = P.nbStart[p]; q < P.nbStart[p + 1]; q++) {
      const o = P.nb[q];
      if (P.kind[o] !== PK.land) continue;
      m++;
      if (own[o] === own[p]) mine++;
      if (own[o] >= 0) count.set(own[o], (count.get(own[o]) ?? 0) + 1);
    }
    let best = -1;
    let n = 0;
    for (const [o, c] of count) if (c > n) [best, n] = [o, c];
    if (n < 2 || n < 0.75 * m) continue;
    if (own[p] < 0) next[p] = best;
    else if (mine === 0 && best !== own[p] && !seats.has(p)) next[p] = best;
  }
  for (let p = 0; p < P.count; p++) if (next[p] !== own[p]) setHolder(sim, env, p, next[p]);
}

/** Area (km²) each clan holds. */
export function heldArea(sim: SimState, env: Env): Map<number, number> {
  const out = new Map<number, number>();
  if (!sim.provOwner) return out;
  for (let p = 0; p < sim.provOwner.length; p++) {
    const o = sim.provOwner[p];
    if (o >= 0) out.set(o, (out.get(o) ?? 0) + env.prov.area[p]);
  }
  return out;
}

/** Hand each of a clan's provinces to whichever of the given places is nearest it (its middle). */
export function splitByNearest(sim: SimState, env: Env, clan: number, places: { x: number; y: number; clan: number }[], maxKm = Infinity): void {
  const P = env.prov;
  if (!sim.provOwner || !places.length) return;
  for (let p = 0; p < P.count; p++) {
    if (sim.provOwner[p] !== clan) continue;
    let best: { clan: number } | null = null;
    let bd = Infinity;
    for (const s of places) {
      const d = distOn(env, P.x[p], P.y[p], s.x, s.y);
      if (d < bd) [best, bd] = [s, d];
    }
    if (best && bd <= maxKm && best.clan !== clan) setHolder(sim, env, p, best.clan);
  }
}
