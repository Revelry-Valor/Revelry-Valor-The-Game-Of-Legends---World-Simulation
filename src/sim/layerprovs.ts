import type { Grid } from '../core/terrain';
import type { LayerTag } from './layers';
import type { Settlement, SimState } from './state';

/**
 * The peoples on the other layers' provinces (the layers' provinces, step 3).
 * - Holding: each year every town on another layer holds the provinces of its layer round it (its
 *   own, and those within its reach), the nearest town's realm where two reach the same one. Rock,
 *   caverns, tunnels, limbs and trunks, vines and islands can be held; open air and underground
 *   seas are nobody's (airships cross the air, boats the seas).
 * - Roads below: the Underdark's main roads run through its open caverns and tunnels (an
 *   underground route between two towns, province to province); through the solid rock the only
 *   roads are the tunnels the peoples dig (layers.ts), and tunnelers found towns out in the rock
 *   at the end of the tunnels they dig.
 */

export interface LayerProvMap {
  grid: Grid;
  wrapKm: number;
  label: Int32Array;
  provinces: { id: number; kind: string; x: number; y: number; area: number; neighbours: number[] }[];
}
export type LayerProvs = Partial<Record<LayerTag, LayerProvMap>>;

/** Whether a province on another layer can be held (open air and underground seas cannot). */
export const holdable = (kind: string) => kind !== 'air' && kind !== 'sea';
/** Open ground the Underdark's main roads run through. */
const openBelow = (kind: string) => kind === 'cavern' || kind === 'tunnel';

/** The province (index) at a place, or −1. */
export function layerProvAt(m: LayerProvMap, x: number, y: number): number {
  const g = m.grid;
  let i = Math.round((x - g.x0) / g.px);
  const j = Math.round((y - g.y0) / g.px);
  if (j < 0 || j >= g.h) return -1;
  if (i < 0 || i >= g.w) {
    if (!m.wrapKm) return -1;
    i = ((i % g.w) + g.w) % g.w;
  }
  return m.label[j * g.w + i];
}

/** The province of its layer a town stands in (index), or −1. */
export function townProv(provs: LayerProvs | undefined, st: Settlement): number {
  const m = st.layer ? provs?.[st.layer] : undefined;
  return m ? layerProvAt(m, st.x, st.y) : -1;
}

/**
 * Who holds each province of the other layers (by province id), worked out again each year from
 * the towns there: each town reaches out province to province over holdable ground, as far as its
 * reach, and each province goes to the nearest town that reaches it.
 */
export function holdLayersYear(sim: SimState, provs: LayerProvs | undefined, reach: (st: Settlement) => number, dist: (ax: number, ay: number, bx: number, by: number) => number): void {
  const out: NonNullable<SimState['layerHold']> = {};
  for (const [tag, m] of Object.entries(provs ?? {}) as [LayerTag, LayerProvMap][]) {
    if (!m) continue;
    const best = new Map<number, { clan: number; d: number }>();
    for (const st of sim.settlements) {
      if (st.ruined || st.layer !== tag) continue;
      const p0 = layerProvAt(m, st.x, st.y);
      if (p0 < 0) continue;
      const R = reach(st);
      const seen = new Set([p0]);
      const queue = [p0];
      for (let q = 0; q < queue.length; q++) {
        const p = queue[q];
        const pr = m.provinces[p];
        // Reached when its near side is within reach (its middle less about half its width).
        const d = p === p0 ? 0 : Math.max(0, dist(st.x, st.y, pr.x, pr.y) - Math.sqrt(pr.area) / 2);
        if (p !== p0 && (!holdable(pr.kind) || d > R)) continue;
        const was = best.get(pr.id);
        if (!was || d < was.d) best.set(pr.id, { clan: st.clan, d });
        for (const n of pr.neighbours) if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    const held: Record<number, number> = {};
    for (const [id, v] of best) held[id] = v.clan;
    out[tag] = held;
  }
  sim.layerHold = out;
}

/** Who holds a province of another layer (by its id), if anyone. */
export const layerHolder = (sim: SimState, tag: LayerTag, id: number): number | undefined => sim.layerHold?.[tag]?.[id];

/**
 * The length (km) of the Underdark's main road between two places below: through open caverns and
 * tunnels, province to province (null if they aren't joined that way).
 */
export function underRouteKm(m: LayerProvMap, ax: number, ay: number, bx: number, by: number): number | null {
  const a = layerProvAt(m, ax, ay);
  const b = layerProvAt(m, bx, by);
  if (a < 0 || b < 0) return null;
  if (a === b) return Math.hypot(ax - bx, ay - by);
  if (!openBelow(m.provinces[a].kind) || !openBelow(m.provinces[b].kind)) return null;
  // Dijkstra over the open provinces (few enough to scan for the nearest each step).
  const dist = new Map<number, number>([[a, 0]]);
  const done = new Set<number>();
  while (true) {
    let p = -1;
    let pd = Infinity;
    for (const [q, d] of dist) if (!done.has(q) && d < pd) [p, pd] = [q, d];
    if (p < 0) return null;
    if (p === b) return pd;
    done.add(p);
    const P = m.provinces[p];
    for (const n of P.neighbours) {
      const N = m.provinces[n];
      if (!openBelow(N.kind) || done.has(n)) continue;
      const nd = pd + Math.hypot(P.x - N.x, P.y - N.y);
      if (nd < (dist.get(n) ?? Infinity)) dist.set(n, nd);
    }
  }
}

/** Rock provinces a tunneler could dig out to and found a town in, within reach of a place. */
export function rockSites(m: LayerProvMap | undefined, x: number, y: number, reach: number, dist: (ax: number, ay: number, bx: number, by: number) => number): { x: number; y: number }[] {
  if (!m) return [];
  return m.provinces.filter((p) => p.kind === 'rock' && dist(x, y, p.x, p.y) <= reach).map((p) => ({ x: p.x, y: p.y }));
}
