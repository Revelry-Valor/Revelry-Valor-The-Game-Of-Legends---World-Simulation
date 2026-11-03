import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate, type Climate } from '../src/core/climate';
import { anchorOf, growRoots, leyLines, manaField, naturalNodes, polesOf, rootLines, rootStrokes, type ManaNode } from '../src/core/mana';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { KM_PER_DEGREE } from '../src/core/units';

const north = 40;
const settings = defaultSettings({ widthKm: 6000, heightKm: 50 * KM_PER_DEGREE, northLatitude: north, edges: 'wrap', seed: 21 });
const yAt = (lat: number) => (north - lat) * KM_PER_DEGREE;
const line = (pts: [number, number][], step = 60) => {
  const out: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let i = 0; i < n; i++) out.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
  }
  out.push(...pts[pts.length - 1]);
  return out;
};
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', line([[3000, yAt(30)], [3000, yAt(-5)]]), { size: 2200 });
add('mountains', line([[2200, yAt(30)], [2400, yAt(5)]], 25), { size: 200, strength: 1 });
add('mountains', line([[3800, yAt(28)], [3900, yAt(15)]], 25), { size: 180, strength: 1 });
add('volcano', [3300, yAt(20)]);
add('volcano', [2700, yAt(0)]);
add('treeAnchor', [3000, yAt(15)]);

let cl: Climate;
beforeAll(() => {
  cl = computeClimate(surface, settings);
}, 60000);
const grid = () => ({ x0: cl.x0, y0: cl.y0, step: cl.step, w: cl.w, h: cl.h, wrapKm: cl.wrapKm });
const at = (field: Float32Array, x: number, y: number) => field[Math.round((y - cl.y0) / cl.step) * cl.w + Math.round((x - cl.x0) / cl.step)];

describe('ley lines and the heat map', () => {
  it('joins each node to its nearest, without doubling lines', () => {
    const nodes: ManaNode[] = [{ x: 0, y: 0, kind: 'volcano' }, { x: 100, y: 0, kind: 'volcano' }, { x: 0, y: 120, kind: 'tower' }, { x: 2000, y: 2000, kind: 'temple' }];
    const lines = leyLines(nodes, 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const keys = lines.map((l) => [l.pts[0], l.pts[1], l.pts[2], l.pts[3]].join(','));
    expect(new Set(keys).size).toBe(keys.length);
    // The far node is still joined to the web.
    expect(lines.some((l) => (l.pts[0] === 2000 && l.pts[1] === 2000) || (l.pts[2] === 2000 && l.pts[3] === 2000))).toBe(true);
  });
  it('is strongest where lines cross', () => {
    const lines = [
      { kind: 'ley' as const, pts: [1000, yAt(15), 5000, yAt(15)] },
      { kind: 'ley' as const, pts: [3000, yAt(35), 3000, yAt(-5)] },
    ];
    const f = manaField(grid(), lines);
    const cross = at(f, 3000, yAt(15));
    const single = at(f, 4500, yAt(15));
    const none = at(f, 4500, yAt(30));
    expect(cross).toBeGreaterThan(single * 1.5);
    expect(single).toBeGreaterThan(none + 0.2);
  });
  it('has nodes from the land itself: volcanoes, and the poles where the map reaches them', () => {
    const nodes = naturalNodes(surface, polesOf(settings));
    expect(nodes.filter((n) => n.kind === 'volcano').length).toBe(2);
    expect(nodes.some((n) => n.kind === 'pole')).toBe(false);
    expect(naturalNodes(surface, { ...polesOf(settings), north: true }).some((n) => n.kind === 'pole')).toBe(true);
    // A flat map never has pole nodes, even reaching the poles; a globe does.
    const full = { ...settings, northLatitude: 90 };
    expect(polesOf({ ...full, mapType: 'flat' }).north).toBe(false);
    expect(polesOf({ ...full, mapType: 'globe' }).north).toBe(true);
  });
});

describe('the world tree', () => {
  it('grows main roots out from the anchor, following mountains, with sprouts and bursts at volcanoes', () => {
    const anchor = anchorOf(surface)!;
    expect(anchor).not.toBeNull();
    const roots = growRoots(surface, settings, cl, anchor, { mains: 5, seed: 3 });
    const mains = roots.filter((r) => r.size === 'main');
    expect(mains.length).toBe(5);
    for (const r of mains) {
      expect(Math.hypot(r.ctrl[0] - anchor.x, r.ctrl[1] - anchor.y)).toBeLessThan(1);
      // It runs away from the anchor.
      const n = r.ctrl.length;
      expect(Math.hypot(r.ctrl[n - 2] - anchor.x, r.ctrl[n - 1] - anchor.y)).toBeGreaterThan(500);
    }
    expect(roots.some((r) => r.size === 'sprout')).toBe(true);
  });
  it('makes roots strokes you can edit, and mana follows them (removing a root takes its mana)', () => {
    const anchor = anchorOf(surface)!;
    const grown = growRoots(surface, settings, cl, anchor, { mains: 4, seed: 5 });
    const strokes = rootStrokes(grown, brushDefaults('root'), cl.wrapKm, 1000);
    expect(strokes.every((s) => s.brush === 'root' && s.route === 'points' && (s.ctrl?.length ?? 0) >= 4)).toBe(true);
    const withRoots: Surface = { strokes: [...surface.strokes, ...strokes], nextId: 2000 };
    const lines = rootLines(withRoots, cl.wrapKm);
    expect(lines.length).toBe(strokes.length);
    const f1 = manaField(grid(), lines, [], anchor);
    // Somewhere along the first main root, a long way from the anchor.
    const r0 = strokes.find((s) => s.rootSize === 'main')!;
    const mid = Math.floor(r0.pts.length / 4) * 2;
    const [mx, my] = [r0.pts[mid], r0.pts[mid + 1]];
    const without = rootLines({ strokes: withRoots.strokes.filter((s) => s !== r0), nextId: 2000 }, cl.wrapKm);
    const f2 = manaField(grid(), without, [], anchor);
    const wx = ((mx % 6000) + 6000) % 6000;
    expect(at(f1, wx, my)).toBeGreaterThan(at(f2, wx, my));
  });
});
