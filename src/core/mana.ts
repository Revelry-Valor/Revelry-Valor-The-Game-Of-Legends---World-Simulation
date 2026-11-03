import type { Climate } from './climate';
import { sketchCourse, type Stroke, type Surface } from './paint';
import { southLatitude, type WorldSettings } from './settings';
import { whirlpools } from './terrain';

/**
 * Mana (REDESIGN.md 6A; Phase 11 step 1). Mana flows along two kinds of line, neither of them a
 * physical feature: ley lines between nodes, and the roots of the world tree. Where lines meet,
 * cross or run alongside each other more mana is released; the heat map shows it.
 *
 * - Ley line nodes: volcanoes, whirlpools, the poles (globe maps only) and high-pressure zones from the start; dawn
 *   cities, temples (holy sites) and mage towers as the peoples build them. Each node is joined
 *   to its two or three nearest, a loose web that grows as nodes are added.
 * - World tree roots: drawn by hand (Root brush) or grown from the anchor you place, then edited
 *   freely. Main roots run out from the anchor along mountain chains, deep seas and coasts;
 *   sprouts reach toward nearby ranges; volcanoes burst roots in several directions.
 * - The heat map: each line spreads mana about it (main roots widest); where several reach the
 *   same place their product adds more, so crossings and lines running together are strongest.
 */

export type NodeKind = 'volcano' | 'whirlpool' | 'pole' | 'high' | 'dawn' | 'temple' | 'tower' | 'anchor';

export interface ManaNode {
  x: number;
  y: number;
  kind: NodeKind;
}

export interface ManaLine {
  kind: 'ley' | 'root' | 'sprout';
  /** Points [x, y…] (km; across the wrap seam unrolled). */
  pts: number[];
}

/** A grid of points the field is worked out on (the climate's). */
export interface ManaGrid {
  x0: number;
  y0: number;
  step: number;
  w: number;
  h: number;
  wrapKm: number;
}

export const NODE_NAMES: Record<NodeKind, string> = { volcano: 'Volcano', whirlpool: 'Whirlpool', pole: 'Pole', high: 'High-pressure zone', dawn: 'Dawn city', temple: 'Temple', tower: 'Mage tower', anchor: 'World tree anchor' };

/** The world tree's anchor (the last placed), if there is one. */
export function anchorOf(surface: Surface): { x: number; y: number } | null {
  let out: { x: number; y: number } | null = null;
  for (const st of surface.strokes) if (st.brush === 'treeAnchor' && !st.erase && st.pts.length >= 2) out = { x: st.pts[0], y: st.pts[1] };
  return out;
}

/** The roots as drawn (their courses), main roots and sprouts. */
export function rootLines(surface: Surface, wrapKm: number): ManaLine[] {
  const out: ManaLine[] = [];
  for (const st of surface.strokes) {
    if (st.brush !== 'root' || st.erase) continue;
    const pts = st.ctrl && st.ctrl.length >= 4 ? sketchCourse(st.ctrl, wrapKm) : st.pts;
    if (pts.length >= 4) out.push({ kind: st.rootSize === 'sprout' ? 'sprout' : 'root', pts });
  }
  return out;
}

/**
 * Where the poles are nodes. Only a globe has them: on a flat map a pole would sit in the middle of
 * an edge and its ley lines would draw a fixed line down the map.
 */
export function polesOf(s: WorldSettings): { widthKm: number; heightKm: number; north: boolean; south: boolean } {
  const globe = s.mapType === 'globe';
  return { widthKm: s.widthKm, heightKm: s.heightKm, north: globe && s.northLatitude >= 85, south: globe && southLatitude(s) <= -85 };
}

/** Nodes the world has from the start: volcanoes, whirlpools, the poles (where the map reaches them) and high-pressure zones. */
export function naturalNodes(surface: Surface, poles: { widthKm: number; heightKm: number; north: boolean; south: boolean }): ManaNode[] {
  const out: ManaNode[] = [];
  for (const st of surface.strokes) {
    if (st.erase || st.pts.length < 2) continue;
    if (st.brush === 'volcano') out.push({ x: st.pts[0], y: st.pts[1], kind: 'volcano' });
    else if (st.brush === 'high') out.push({ x: st.pts[0], y: st.pts[1], kind: 'high' });
  }
  for (const p of whirlpools(surface)) out.push({ x: p.x, y: p.y, kind: 'whirlpool' });
  if (poles.north) out.push({ x: poles.widthKm / 2, y: 0, kind: 'pole' });
  if (poles.south) out.push({ x: poles.widthKm / 2, y: poles.heightKm, kind: 'pole' });
  return out;
}

/** Ley lines: each node joined to its two nearest, and a third when it is nearly as near (no line twice). */
export function leyLines(nodes: ManaNode[], wrapKm: number): ManaLine[] {
  const dx = (a: ManaNode, b: ManaNode) => {
    let d = b.x - a.x;
    if (wrapKm && Math.abs(d) > wrapKm / 2) d -= Math.sign(d) * wrapKm;
    return d;
  };
  const dist = (a: ManaNode, b: ManaNode) => Math.hypot(dx(a, b), b.y - a.y);
  const seen = new Set<string>();
  const out: ManaLine[] = [];
  nodes.forEach((a, i) => {
    const near = nodes.map((b, j) => ({ j, d: j === i ? Infinity : dist(a, b) })).filter((q) => q.d > 1 && Number.isFinite(q.d)).sort((p, q) => p.d - q.d);
    const take = near.slice(0, 2);
    if (near[2] && near[2].d < near[1].d * 1.3) take.push(near[2]);
    for (const { j } of take) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = nodes[j];
      out.push({ kind: 'ley', pts: [a.x, a.y, a.x + dx(a, b), b.y] });
    }
  });
  return out;
}

/** How far (km) each kind of line spreads its mana, and how much it carries. */
const SPREAD = { ley: 80, root: 120, sprout: 70 };
const CARRY = { ley: 0.7, root: 1, sprout: 0.6 };

/**
 * The mana over a grid, 0 (none) to 1 (as dense as it gets): each line's mana about it, plus
 * what lines reaching the same place release together (crossings and lines alongside each
 * other), plus the anchor and the nodes themselves.
 */
export function manaField(grid: ManaGrid, lines: ManaLine[], nodes: ManaNode[] = [], anchor: { x: number; y: number } | null = null): Float32Array {
  const { x0, y0, step, w, h, wrapKm } = grid;
  const n = w * h;
  const sum = new Float32Array(n);
  const sq = new Float32Array(n);
  const best = new Float32Array(n);
  const touched: number[] = [];
  for (const line of lines) {
    const R = SPREAD[line.kind];
    const carry = CARRY[line.kind];
    const reach = Math.ceil((R * 2.2) / step);
    touched.length = 0;
    const p = line.pts;
    for (let q = 0; q + 3 < p.length; q += 2) {
      const ax = p[q];
      const ay = p[q + 1];
      const bx = p[q + 2];
      const by = p[q + 3];
      const i0 = Math.floor((Math.min(ax, bx) - x0) / step) - reach;
      const i1 = Math.ceil((Math.max(ax, bx) - x0) / step) + reach;
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - y0) / step) - reach);
      const j1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) - y0) / step) + reach);
      const ddx = bx - ax;
      const ddy = by - ay;
      const len2 = ddx * ddx + ddy * ddy;
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        let i = ii;
        if (i < 0 || i >= w) {
          if (!wrapKm) continue;
          i = ((i % w) + w) % w;
        }
        const x = x0 + ii * step;
        const y = y0 + j * step;
        const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * ddx + (y - ay) * ddy) / len2)) : 0;
        const d2 = (x - ax - t * ddx) ** 2 + (y - ay - t * ddy) ** 2;
        const c = carry * Math.exp(-d2 / (R * R));
        if (c < 0.01) continue;
        const k = j * w + i;
        if (best[k] === 0) touched.push(k);
        if (c > best[k]) best[k] = c;
      }
    }
    // Each line once at each point (its nearest stretch), however it winds.
    for (const k of touched) {
      sum[k] += best[k];
      sq[k] += best[k] * best[k];
      best[k] = 0;
    }
  }
  const out = new Float32Array(n);
  const bump = (bx: number, by: number, R: number, v: number) => {
    const reach = Math.ceil((R * 2.2) / step);
    const ci = Math.round((bx - x0) / step);
    const cj = Math.round((by - y0) / step);
    for (let dj = -reach; dj <= reach; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= h) continue;
      for (let di = -reach; di <= reach; di++) {
        let i = ci + di;
        if (i < 0 || i >= w) {
          if (!wrapKm) continue;
          i = ((i % w) + w) % w;
        }
        const d2 = (di * step) ** 2 + (dj * step) ** 2;
        sum[j * w + i] += v * Math.exp(-d2 / (R * R));
      }
    }
  };
  for (const nd of nodes) bump(nd.x, nd.y, 60, 0.35);
  if (anchor) bump(anchor.x, anchor.y, 200, 1.6);
  for (let k = 0; k < n; k++) {
    // Lines together release more: the sum of each pair's product.
    const together = (sum[k] * sum[k] - sq[k]) / 2;
    const heat = sum[k] + 1.5 * together;
    out[k] = 1 - Math.exp(-heat / 1.6);
  }
  return out;
}

/** A word for how dense mana is. */
export function manaWord(v: number): string {
  return v < 0.08 ? 'thin' : v < 0.3 ? 'faint' : v < 0.55 ? 'moderate' : v < 0.8 ? 'strong' : 'intense';
}

// ---------------------------------------------------------------------------------------------
// Growing the roots from the anchor

export interface GrownRoot {
  /** Points it runs through (km), for editing like any drawn root. */
  ctrl: number[];
  size: 'main' | 'sprout';
}

/**
 * Roots grown from the anchor: main roots run outward in several directions, each step choosing
 * among headings near straight on the one with the most to follow (mountains, deep sea, coasts),
 * never turning back toward the anchor. Sprouts branch off toward mountain ranges near a main
 * root, and a root reaching a volcano bursts into short roots all round it.
 */
export function growRoots(surface: Surface, s: WorldSettings, cl: Climate, anchor: { x: number; y: number }, opts: { mains?: number; seed?: number } = {}): GrownRoot[] {
  const W = s.widthKm;
  const H = s.heightKm;
  const wrap = s.edges === 'wrap';
  const mains = Math.max(2, Math.min(12, opts.mains ?? 6));
  let rnd = ((opts.seed ?? s.seed) >>> 0) || 1;
  const random = () => {
    rnd ^= rnd << 13;
    rnd ^= rnd >>> 17;
    rnd ^= rnd << 5;
    return (rnd >>> 0) / 4294967296;
  };
  const cellAt = (x: number, y: number) => {
    let i = Math.round((x - cl.x0) / cl.step);
    const j = Math.round((y - cl.y0) / cl.step);
    if (j < 0 || j >= cl.h) return -1;
    if (i < 0 || i >= cl.w) {
      if (!wrap) return -1;
      i = ((i % cl.w) + cl.w) % cl.w;
    }
    return j * cl.w + i;
  };
  // What a root likes to follow: mountain chains, deep sea, and coasts.
  const pull = (x: number, y: number) => {
    const k = cellAt(x, y);
    if (k < 0) return -1;
    if (cl.land[k]) {
      const coast = cl.distSea[k] < cl.step * 1.6 ? 0.6 : 0;
      return Math.min(1.5, cl.height[k] * 0.9) + coast;
    }
    return cl.ground[k] < 0.5 ? 0.8 : 0.3;
  };
  const volcanoes = surface.strokes.filter((st) => st.brush === 'volcano' && !st.erase).map((st) => ({ x: st.pts[0], y: st.pts[1], used: false }));
  const stepKm = Math.max(60, Math.min(W, H) / 40);
  const maxLen = Math.hypot(W, H) * 0.45;
  const out: GrownRoot[] = [];
  const unwrapX = (x: number) => x;
  const spot = (x: number) => (wrap ? ((x % W) + W) % W : x);
  const mainCourses: number[][] = [];
  const a0 = random() * Math.PI * 2;
  for (let r = 0; r < mains; r++) {
    let heading = a0 + (r / mains) * Math.PI * 2 + (random() - 0.5) * 0.4;
    let x = anchor.x;
    let y = anchor.y;
    const pts = [x, y];
    for (let len = 0; len < maxLen; len += stepKm) {
      let bestH = heading;
      let bestS = -Infinity;
      for (const turn of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const hh = heading + turn;
        const nx = x + Math.cos(hh) * stepKm;
        const ny = y + Math.sin(hh) * stepKm;
        if (ny < 0 || ny > H || (!wrap && (nx < 0 || nx > W))) continue;
        // Away from the anchor, and toward what it follows (looking a little ahead).
        const ax = nx - anchor.x;
        const ay = ny - anchor.y;
        const outward = (Math.cos(hh) * ax + Math.sin(hh) * ay) / (Math.hypot(ax, ay) || 1);
        const ahead = pull(nx, ny) + 0.5 * pull(nx + Math.cos(hh) * stepKm, ny + Math.sin(hh) * stepKm);
        const sc = ahead + 0.8 * outward - 0.15 * Math.abs(turn) + 0.1 * random();
        if (sc > bestS) [bestS, bestH] = [sc, hh];
      }
      if (bestS === -Infinity) break;
      heading = bestH;
      x += Math.cos(heading) * stepKm;
      y += Math.sin(heading) * stepKm;
      pts.push(unwrapX(x), y);
      // A volcano on the way bursts into roots all round it.
      for (const v of volcanoes) {
        if (v.used) continue;
        let dvx = Math.abs(spot(x) - v.x);
        if (wrap) dvx = Math.min(dvx, W - dvx);
        if (Math.hypot(dvx, y - v.y) > stepKm * 2.2) continue;
        v.used = true;
        const burst = 4;
        for (let b = 0; b < burst; b++) {
          const a = (b / burst) * Math.PI * 2 + random();
          const L = stepKm * (2 + random() * 2);
          out.push({ size: 'sprout', ctrl: [v.x, v.y, v.x + Math.cos(a) * L * 0.5, v.y + Math.sin(a) * L * 0.5 + (random() - 0.5) * stepKm * 0.3, v.x + Math.cos(a) * L, v.y + Math.sin(a) * L].map((q, i) => (i % 2 ? Math.max(0, Math.min(H, q)) : q)) });
        }
      }
    }
    mainCourses.push(pts);
    // Points every few steps, for editing.
    const ctrl: number[] = [];
    for (let i = 0; i < pts.length; i += 2) if ((i / 2) % 3 === 0 || i === pts.length - 2) ctrl.push(pts[i], pts[i + 1]);
    if (ctrl.length >= 4) out.push({ size: 'main', ctrl });
  }
  // Sprouts toward mountain ranges near a main root (a range already on a root needs none).
  const ranges = (cl.geo?.regions ?? []).filter((f) => f.kind === 'Mountains' || f.kind === 'Highlands');
  for (const f of ranges) {
    let bd = Infinity;
    let bx = 0;
    let by = 0;
    for (const pts of mainCourses) for (let i = 0; i < pts.length; i += 2) {
      let ddx = Math.abs(spot(pts[i]) - f.x);
      if (wrap) ddx = Math.min(ddx, W - ddx);
      const d = Math.hypot(ddx, pts[i + 1] - f.y);
      if (d < bd) [bd, bx, by] = [d, pts[i], pts[i + 1]];
    }
    if (bd < stepKm * 1.5 || bd > stepKm * 9) continue;
    let tx = f.x;
    if (wrap && Math.abs(tx - spot(bx)) > W / 2) tx += Math.sign(spot(bx) - tx) * W;
    const sx = spot(bx);
    const mx = (sx + tx) / 2 + (random() - 0.5) * bd * 0.3;
    const my = (by + f.y) / 2 + (random() - 0.5) * bd * 0.3;
    out.push({ size: 'sprout', ctrl: [sx, by, mx, my, tx, f.y] });
  }
  return out;
}

/** Grown roots as strokes of the Root brush (to add to the surface). */
export function rootStrokes(roots: GrownRoot[], base: Omit<Stroke, 'id' | 'pts'>, wrapKm: number, firstId: number): Stroke[] {
  return roots.map((r, i) => {
    const ctrl = r.ctrl.map((v) => Math.round(v * 100) / 100);
    return { ...base, id: firstId + i, brush: 'root', rootSize: r.size === 'sprout' ? 'sprout' : 'main', route: 'points', ctrl, pts: sketchCourse(ctrl, wrapKm).map((v) => Math.round(v * 100) / 100) } as Stroke;
  });
}
