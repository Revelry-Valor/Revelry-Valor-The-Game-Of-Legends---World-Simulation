import { giantTrees, giantVines, treeCities } from '../core/canopy';
import type { Climate } from '../core/climate';
import type { Library, Species, Race } from '../core/library';
import type { Surface, VineEnd } from '../core/paint';
import { islandArea, skyIslands, skyPaintedCover, type SkyLayer } from '../core/sky';
import { autoSkyCover, driftPerYear, skyClimate } from '../core/skyclimate';
import { shapeOf, underdarkAt, underStrokes, waysDown } from '../core/underdark';
import type { Settlement, SimState } from './state';

/**
 * The peoples on every layer (Phase 12 step 4). A town on another layer stands at a place on the
 * map like any other (it holds the province over or under it) and is tagged with its layer:
 * the Underdark, the canopy, or a sky layer. Towns there are founded the way villages always are,
 * by a full town sending people out, when the way is open to them:
 *
 * - The Underdark: down a cave entrance (anyone), a shaft (climbers and flyers), or a way the
 *   people dig themselves (tunnelers, who also join their towns with tunnels).
 * - The canopy: up a giant tree's trunk (anyone can climb its bark), to a tree-city site or a crown.
 * - A sky layer: on wings, up a giant vine whose foot is near, or by airship.
 *
 * Each layer feeds and holds people its own way (fungus farms below, the tree's fruit, an island's
 * fields), is harder to storm (only flyers and airships reach the islands easily), and drifting
 * islands carry their towns with them.
 */

export type LayerTag = 'underdark' | 'canopy' | 'sky1' | 'sky2' | 'sky3';
export const LAYER_NAMES: Record<LayerTag, string> = { underdark: 'the Underdark', canopy: 'the canopy', sky1: 'sky layer 1', sky2: 'sky layer 2', sky3: 'sky layer 3' };

/** A place to live below: an open spot of the Underdark (on a grid), with what grows there. */
interface UnderSpot {
  x: number;
  y: number;
  sea: boolean;
  /** 0 bare floor, 1 fungus, 2 glowing caves, 3 crystal caverns. */
  cover: number;
}
export interface IslandInfo {
  id: number;
  layer: SkyLayer;
  x: number;
  y: number;
  area: number;
  /** Spots on it (x, y pairs, as painted: add the island's drift). */
  spots: number[];
  summerT: number;
  winterT: number;
  /** Good ground (meadow or forest) 1, tundra 0.5, rock or snow 0. */
  good: number;
  drift: 'fixed' | 'wind' | 'path';
  path: number[] | null;
  /** Its drift direction with the wind (unit vector, km east and south) and pace (km a year). */
  ux: number;
  uy: number;
  pace: number;
}

export interface LayerLand {
  under: UnderSpot[];
  underStep: number;
  /** Ways down: cave entrances (walked) and shafts (climbed or flown), each opening somewhere. */
  ways: { x: number; y: number; shaft: boolean }[];
  islands: IslandInfo[];
  trees: { x: number; y: number; crown: number }[];
  cities: { x: number; y: number }[];
  /** Vines whose ends both hold. */
  vines: { from: VineEnd; to: VineEnd; ax: number; ay: number; bx: number; by: number }[];
}

/** The other layers' land, read from the painting once (with the climate's grid for the land). */
export function buildLayerLand(surface: Surface, cl: Climate): LayerLand {
  const landAt = (x: number, y: number) => {
    let i = Math.round((x - cl.x0) / cl.step);
    const j = Math.round((y - cl.y0) / cl.step);
    if (cl.wrapKm) i = ((i % cl.w) + cl.w) % cl.w;
    return j >= 0 && j < cl.h && i >= 0 && i < cl.w && cl.land[j * cl.w + i] === 1;
  };
  // The Underdark, sampled on a grid fine enough for caverns (only where something is painted).
  const strokes = underStrokes(surface);
  const under: UnderSpot[] = [];
  const underStep = Math.max(8, Math.min(cl.step, 25));
  if (strokes.some((s) => !s.erase && (s.brush === 'cavern' || s.brush === 'tunnel' || s.brush === 'undersea'))) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of strokes) {
      for (let i = 0; i < s.pts.length; i += 2) {
        x0 = Math.min(x0, s.pts[i] - s.size);
        x1 = Math.max(x1, s.pts[i] + s.size);
        y0 = Math.min(y0, s.pts[i + 1] - s.size);
        y1 = Math.max(y1, s.pts[i + 1] + s.size);
      }
    }
    for (let y = y0; y <= y1; y += underStep) {
      for (let x = x0; x <= x1; x += underStep) {
        if (!landAt(x, y)) continue;
        const u = underdarkAt(strokes, x, y);
        if (u.kind === 'rock') continue;
        under.push({ x, y, sea: u.kind === 'sea', cover: u.cover === 'fungus' ? 1 : u.cover === 'glowcave' ? 2 : u.cover === 'crystalcave' ? 3 : 0 });
      }
    }
  }
  const ways = waysDown(surface).filter((w) => w.below !== 'rock').map((w) => ({ x: w.x, y: w.y, shaft: w.kind === 'shaft' }));
  // Sky islands: their size, climate, good ground and drift.
  const islands: IslandInfo[] = skyIslands(surface).map((isl) => {
    const k = skyClimate(cl, null, isl.layer, isl.x, isl.y);
    const cover = skyPaintedCover(surface, isl.layer, isl.x, isl.y) ?? autoSkyCover(k);
    // Places to build on it: the middles of its painted dabs.
    const spots: number[] = [];
    for (const s of isl.strokes) {
      const d = shapeOf(s).dabs;
      for (let i = 0; i < d.length; i += 3) spots.push(d[i], d[i + 1]);
    }
    const m = Math.hypot(k.windU, k.windV) || 1;
    return {
      id: isl.id,
      layer: isl.layer,
      x: isl.x,
      y: isl.y,
      area: islandArea(surface, isl),
      spots,
      summerT: k.summerT,
      winterT: k.winterT,
      good: cover === 'meadow' || cover === 'forest' ? 1 : cover === 'tundra' ? 0.5 : 0,
      drift: isl.drift,
      path: isl.path,
      ux: k.windU / m,
      uy: -k.windV / m,
      pace: driftPerYear(isl, k),
    };
  });
  const trees = giantTrees(surface).map((t) => ({ x: t.x, y: t.y, crown: t.crown }));
  const cities = treeCities(surface).filter((c) => c.tree).map((c) => ({ x: c.x, y: c.y }));
  const vines = giantVines(surface, landAt)
    .filter((v) => !v.problem)
    .map((v) => {
      const p = v.stroke.pts;
      return { from: v.from, to: v.to, ax: p[0], ay: p[1], bx: p[p.length - 2], by: p[p.length - 1] };
    });
  return { under, underStep, ways, islands, trees, cities, vines };
}

// ---- Who goes where ----

/** What a race brings to the other layers, from its traits, movement and preferred layers. */
export interface LayerWays {
  digs: boolean;
  /** Prefers to live there. */
  under: boolean;
  trees: boolean;
  sky: boolean;
  /** Sees in the dark (at home below). */
  dark: boolean;
}
export function layerWays(lib: Library, species: Species, race: Race): LayerWays {
  const ids = new Set([...species.traits.filter((t) => !race.removeTraits.includes(t)), ...race.addTraits]);
  const fx = new Set<string>();
  for (const id of ids) for (const e of lib.traits.find((t) => t.id === id)?.effects ?? []) if (e.amount > 0) fx.add(e.target);
  const p = species.profile;
  const prefers = (l: string) => (p.layers ?? []).includes(l);
  const moves = (m: string) => (p.movement ?? []).includes(m);
  const digs = fx.has('Digs tunnels') || moves('Digs');
  return {
    digs,
    under: prefers('Underdark') || digs,
    trees: prefers('Trees') || fx.has('Lives in trees') || moves('Tree-dwelling'),
    sky: prefers('Sky') || fx.has('Flies between layers'),
    dark: fx.has('Sees in the dark') || prefers('Underdark'),
  };
}

/** Everything the layer rules need from the simulation. */
export interface LayerContext {
  sim: SimState;
  layers: LayerLand;
  dist(ax: number, ay: number, bx: number, by: number): number;
  rand(): number;
  /** The settlement's people know a technology. */
  has(st: Settlement, id: string): boolean;
  log(text: string, x: number, y: number): void;
}

/** Where an island is now (its drift so far). */
export function islandShift(sim: SimState, id: number): { dx: number; dy: number } {
  const d = sim.drift?.[id];
  return d ? { dx: d.dx, dy: d.dy } : { dx: 0, dy: 0 };
}

const REACH = 150;

/**
 * A spot for a new village on another layer, from a full town, if the way there is open to its
 * people (null otherwise). `ri` says how they move; `lw` what they bring to the layers.
 */
export function layerSpot(c: LayerContext, st: Settlement, ri: { flies: boolean; mountains: boolean }, lw: LayerWays, spacing: number): { x: number; y: number; layer: LayerTag; island?: number; s: number; dug?: boolean } | null {
  const { sim, layers: L } = c;
  const near = (x: number, y: number, r: number) => c.dist(st.x, st.y, x, y) <= r;
  const crowded = (x: number, y: number, layer: LayerTag) => sim.settlements.some((o) => !o.ruined && o.layer === layer && c.dist(o.x, o.y, x, y) < spacing);
  const from = st.layer ?? 'surface';
  const options: { x: number; y: number; layer: LayerTag; island?: number; s: number; dug?: boolean }[] = [];

  // The Underdark.
  if (L.under.length) {
    const walk = L.ways.some((w) => (!w.shaft || ri.mountains || ri.flies) && near(w.x, w.y, REACH));
    const open = from === 'underdark' || walk || lw.digs;
    if (open) {
      const pref = (lw.under ? 0.6 : 0) + (lw.dark ? 0.2 : -0.3);
      // Look at a few open spots within reach (not the whole Underdark).
      const reach = from === 'underdark' || lw.digs ? 260 : REACH + 120;
      const inReach = L.under.filter((u) => !u.sea && Math.abs(u.y - st.y) <= reach && near(u.x, u.y, reach));
      for (let i = 0; i < 16 && inReach.length; i++) {
        const u = inReach[Math.floor(c.rand() * inReach.length)];
        if (crowded(u.x, u.y, 'underdark')) continue;
        const sea = L.under.some((q) => q.sea && Math.hypot(q.x - u.x, q.y - u.y) < 40);
        const s = 0.3 + pref + (u.cover === 1 ? 0.5 : u.cover === 3 ? 0.35 : u.cover === 2 ? 0.2 : 0) + (sea ? 0.3 : 0);
        options.push({ x: u.x, y: u.y, layer: 'underdark', s, dug: from !== 'underdark' && !walk && lw.digs });
      }
    }
  }
  // The canopy: up a giant tree.
  if (L.trees.length && from !== 'underdark') {
    const pref = lw.trees ? 0.7 : 0;
    for (const city of L.cities) {
      if (!near(city.x, city.y, 220) || crowded(city.x, city.y, 'canopy')) continue;
      options.push({ x: city.x, y: city.y, layer: 'canopy', s: 0.7 + pref });
    }
    for (const t of L.trees) {
      if (!near(t.x, t.y, 220) || crowded(t.x, t.y, 'canopy')) continue;
      options.push({ x: t.x, y: t.y, layer: 'canopy', s: 0.35 + pref });
    }
  }
  // The sky layers: on wings, by airship, or up a vine.
  if (L.islands.length && from !== 'underdark') {
    const ships = c.has(st, 'airships') || c.has(st, 'mana-airships');
    for (const isl of L.islands) {
      const tag = `sky${isl.layer}` as LayerTag;
      const { dx, dy } = islandShift(sim, isl.id);
      let reach = 0;
      if (ri.flies) reach = 400;
      else if (ships) reach = 600;
      else if (from === tag) reach = 200;
      else {
        // A vine from this town's layer, its foot near, up to this layer.
        for (const v of L.vines) {
          for (const [a, b, ax, ay] of [[v.from, v.to, v.ax, v.ay], [v.to, v.from, v.bx, v.by]] as [VineEnd, VineEnd, number, number][]) {
            if (a === from && b === tag && near(ax, ay, REACH)) reach = Math.max(reach, 300);
          }
        }
      }
      if (!reach) continue;
      const cold = isl.summerT < 5 ? 0.6 : isl.summerT < 10 ? 0.25 : 0;
      const pref = lw.sky ? 0.6 : ri.flies ? 0.3 : -0.1;
      for (let i = 0; i < 6; i++) {
        const k = Math.floor((c.rand() * isl.spots.length) / 2) * 2;
        const x = isl.spots[k] + dx;
        const y = isl.spots[k + 1] + dy;
        if (!near(x, y, reach) || crowded(x, y, tag)) continue;
        options.push({ x, y, layer: tag, island: isl.id, s: 0.3 + pref + 0.3 * isl.good - cold - 0.08 * (isl.layer - 1) });
      }
    }
  }
  let best: (typeof options)[number] | null = null;
  for (const o of options) if (!best || o.s > best.s) best = o;
  return best;
}

/** Food on another layer: what the land below still gives (a share), and what the layer itself grows (a floor). */
export function layerFood(c: LayerContext, st: Settlement): { mul: number; floor: number } {
  if (!st.layer) return { mul: 1, floor: 0 };
  const L = c.layers;
  if (st.layer === 'underdark') {
    let fungus = 0;
    let sea = false;
    let n = 0;
    for (const u of L.under) {
      if (Math.hypot(u.x - st.x, u.y - st.y) > 60) continue;
      n++;
      if (u.cover === 1) fungus++;
      if (u.sea) sea = true;
    }
    return { mul: 0.7, floor: 0.55 + 0.5 * (n ? Math.min(1, (fungus / n) * 2) : 0) + (sea ? 0.1 : 0) };
  }
  if (st.layer === 'canopy') return { mul: 0.9, floor: 0.9 };
  const isl = L.islands.find((i) => i.id === st.island);
  if (!isl) return { mul: 0.6, floor: 0.6 };
  const cold = isl.summerT < 5 ? 0.3 : isl.summerT < 10 ? 0.12 : 0;
  return { mul: 0.6, floor: 0.75 + 0.3 * isl.good - cold - 0.04 * (isl.layer - 1) };
}

/** How many people a town on another layer has room for (Infinity on the surface). */
export function layerRoom(c: LayerContext, st: Settlement): number {
  if (!st.layer) return Infinity;
  const L = c.layers;
  const live = c.sim.settlements.filter((o) => !o.ruined && o.layer === st.layer);
  if (st.layer === 'underdark') {
    const open = L.under.filter((u) => !u.sea && Math.hypot(u.x - st.x, u.y - st.y) < 60).length * L.underStep * L.underStep;
    return Math.max(150, open * 4);
  }
  if (st.layer === 'canopy') {
    const t = L.trees.find((q) => Math.hypot(q.x - st.x, q.y - st.y) <= q.crown + 20);
    const sharing = Math.max(1, live.filter((o) => t && Math.hypot(o.x - t.x, o.y - t.y) <= t.crown + 20).length);
    return t ? Math.max(150, (Math.PI * t.crown * t.crown * 8) / sharing) : 300;
  }
  const isl = L.islands.find((i) => i.id === st.island);
  if (!isl) return 300;
  const sharing = Math.max(1, live.filter((o) => o.island === isl.id).length);
  return Math.max(150, (isl.area * 3) / sharing);
}

/**
 * How much harder a town is to storm for being on another layer. Sky towns are reached only by
 * stairs of vines: easy for flyers and airships; Underdark halls are held in narrow tunnels, less so
 * against diggers; a tree city is reached up its trunk.
 */
export function layerWalls(st: Settlement, attacker: { flies: boolean; airships: boolean; digs: boolean }): number {
  if (!st.layer) return 1;
  if (st.layer === 'canopy') return attacker.flies ? 1.1 : 1.3;
  if (st.layer === 'underdark') return attacker.digs ? 1.1 : 1.4;
  return attacker.flies || attacker.airships ? 1.15 : 1.8;
}

/** Monster tides and hordes walk the land: they can't reach the sky islands or the treetops easily. */
export const beyondMonsters = (st: Settlement) => !!st.layer && st.layer !== 'underdark';

/**
 * Drifting islands move each year, carrying their towns: with the wind (bouncing back off the
 * edge of a map that leads nowhere) or along their path, there and back.
 */
export function driftYear(c: LayerContext, widthKm: number, heightKm: number, wrapKm: number): void {
  const { sim } = c;
  for (const isl of c.layers.islands) {
    if (isl.drift === 'fixed' || !isl.pace) continue;
    const d = (sim.drift ??= {})[isl.id] ?? { dx: 0, dy: 0, t: 0, dir: 1 };
    const before = { dx: d.dx, dy: d.dy };
    if (isl.drift === 'path' && isl.path && isl.path.length >= 4) {
      const p = isl.path;
      const segs: number[] = [];
      let total = 0;
      for (let i = 2; i < p.length; i += 2) {
        const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
        segs.push(l);
        total += l;
      }
      d.t += d.dir * isl.pace;
      if (d.t >= total) [d.t, d.dir] = [Math.max(0, 2 * total - d.t), -1];
      if (d.t <= 0) [d.t, d.dir] = [Math.min(total, -d.t), 1];
      // The point that far along the path, from its start.
      let left = d.t;
      let px = p[0];
      let py = p[1];
      for (let i = 0; i < segs.length; i++) {
        if (left <= segs[i]) {
          const f = segs[i] ? left / segs[i] : 0;
          px = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * f;
          py = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * f;
          break;
        }
        left -= segs[i];
        px = p[i * 2 + 2];
        py = p[i * 2 + 3];
      }
      d.dx = px - p[0];
      d.dy = py - p[1];
    } else {
      d.dx += isl.ux * isl.pace * d.dir;
      d.dy += isl.uy * isl.pace * d.dir;
      const cx = isl.x + d.dx;
      const cy = isl.y + d.dy;
      if (cy < 0 || cy > heightKm || (!wrapKm && (cx < 0 || cx > widthKm))) {
        // Off the edge of the world: blown back.
        d.dx -= isl.ux * isl.pace * d.dir;
        d.dy -= isl.uy * isl.pace * d.dir;
        d.dir = -d.dir;
      } else if (wrapKm) d.dx = ((((cx % wrapKm) + wrapKm) % wrapKm) - isl.x);
    }
    sim.drift![isl.id] = d;
    const mx = d.dx - before.dx;
    const my = d.dy - before.dy;
    for (const st of sim.settlements) {
      if (st.island !== isl.id) continue;
      st.x += mx;
      st.y += my;
      if (wrapKm) st.x = ((st.x % wrapKm) + wrapKm) % wrapKm;
    }
  }
}

/**
 * Tunnelers join their towns underground: each year a digging realm may cut a tunnel between two
 * of its towns not yet joined (within about 160 miles), an underground road.
 */
export function digYear(c: LayerContext, diggers: (st: Settlement) => boolean): void {
  const { sim } = c;
  const tunnels = (sim.tunnels ??= []);
  const joined = (a: number, b: number) => tunnels.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
  const byClan = new Map<number, Settlement[]>();
  for (const st of sim.settlements) if (!st.ruined && !st.layer?.startsWith('sky') && st.layer !== 'canopy' && diggers(st)) byClan.set(st.clan, [...(byClan.get(st.clan) ?? []), st]);
  for (const [clan, towns] of byClan) {
    if (towns.length < 2 || c.rand() >= 0.15) continue;
    let best: [Settlement, Settlement, number] | null = null;
    for (let i = 0; i < towns.length; i++) {
      for (let j = 0; j < i; j++) {
        const d = c.dist(towns[i].x, towns[i].y, towns[j].x, towns[j].y);
        if (d > 260 || joined(towns[i].id, towns[j].id)) continue;
        if (!best || d < best[2]) best = [towns[i], towns[j], d];
      }
    }
    if (!best) continue;
    const [a, b] = best;
    tunnels.push({ a: a.id, b: b.id, ax: a.x, ay: a.y, bx: b.x, by: b.y, clan, day: sim.day });
    c.log(`The people of ${a.name} and ${b.name} dug a tunnel between their towns.`, a.x, a.y);
  }
}

/** The tunnel joining two towns, if there is one (its length, km). */
export function tunnelBetween(sim: SimState, a: Settlement, b: Settlement): number | null {
  const t = sim.tunnels?.find((q) => (q.a === a.id && q.b === b.id) || (q.a === b.id && q.b === a.id));
  return t ? Math.hypot(t.ax - t.bx, t.ay - t.by) : null;
}
