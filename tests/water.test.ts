import { describe, expect, it } from 'vitest';
import { brushDefaults, emptySurface, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { surfaceAt } from '../src/core/terrain';
import { finishCourse, flowAt, pointAt, riverNetwork, widthForFlow } from '../src/core/water';

const o = { seed: 5, wrapKm: 0 };
function world(...strokes: [BrushId, number[], Partial<Stroke>?][]): Surface {
  const s = emptySurface();
  for (const [brush, pts, extra] of strokes) s.strokes.push({ ...brushDefaults(brush), id: s.nextId++, pts, roughness: 0, variation: 0, ...extra });
  return s;
}
/** Add a river through clicked points and settle its course, as the map does. */
function river(s: Surface, ctrl: number[], extra: Partial<Stroke> = {}): Stroke {
  const st: Stroke = { ...brushDefaults('river'), id: s.nextId++, pts: ctrl.slice(0, 4), route: 'points', ctrl, ...extra };
  s.strokes = [...s.strokes, st];
  const c = finishCourse(s, st, o);
  const done = { ...st, pts: c.pts, joins: c.joins, falls: c.falls.length ? c.falls : undefined };
  s.strokes = s.strokes.map((x) => (x.id === st.id ? done : x));
  return done;
}
const land: [BrushId, number[], Partial<Stroke>?] = ['land', [0, 300, 1000, 300], { size: 700 }];

describe('rivers', () => {
  it('find a course around mountains instead of over them', () => {
    const s = world(land, ['mountains', [500, 150, 500, 350], { size: 120, strength: 1 }]);
    const r = river(s, [300, 250, 700, 250]);
    let maxMountain = 0;
    for (let k = 0; k < r.pts.length; k += 2) maxMountain = Math.max(maxMountain, surfaceAt(s, r.pts[k], r.pts[k + 1], o).mountain);
    expect(maxMountain).toBeLessThan(0.3);
    // It still runs from the first point to the last.
    expect([r.pts[0], r.pts[1]]).toEqual([300, 250]);
    expect([r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]]).toEqual([700, 250]);
  });

  it('grow downstream, and a river that ends in another makes it bigger from there on', () => {
    const s = world(land);
    const main = river(s, [100, 300, 900, 300]);
    // Click the last point on the main river, as you would on the map.
    let k = 0;
    while (main.pts[k] < 500) k += 2;
    const trib = river(s, [500, 100, main.pts[k], main.pts[k + 1]]);
    expect(trib.joins?.id).toBe(main.id);
    const net = riverNetwork(s);
    const m = net.get(main.id)!;
    const at = trib.joins!.at;
    expect(flowAt(m, at + 1)).toBeGreaterThan(flowAt(m, at - 1) + 0.25);
    expect(widthForFlow(flowAt(m, m.total))).toBeGreaterThan(widthForFlow(flowAt(m, 0)));
  });

  it('fall over a plateau rim, with a pool at the foot and green ground around (an oasis)', () => {
    const s = world(land, ['plateau', [400, 200, 600, 200], { size: 160 }], ['dunes', [500, 300, 500, 450], { size: 300 }]);
    const r = river(s, [500, 200, 500, 450]);
    expect(r.falls?.length).toBe(1);
    const fall = r.falls![0];
    expect(fall.to).toBeGreaterThanOrEqual(fall.at);
    // Just below the fall there is a pool, and well-watered ground in the dunes around it.
    const info = riverNetwork(s).get(r.id)!;
    let pool = false;
    let wet = 0;
    for (let d = 0; d < 3; d += 0.1) {
      const [x, y] = pointAt(info, fall.to + d);
      const p = surfaceAt(s, x, y, o);
      if (p.water === 'lake') pool = true;
      wet = Math.max(wet, surfaceAt(s, x + 3, y, o).wet);
    }
    expect(pool).toBe(true);
    expect(wet).toBeGreaterThan(0.5);
  });
});

describe('volcanoes and lakes', () => {
  it('a volcano is a mountain with zones, and volcanic ground', () => {
    const s = world(land, ['volcano', [500, 300], { size: 60, strength: 1 }]);
    const top = surfaceAt(s, 500, 305, o);
    expect(top.volcanic).toBe(true);
    expect(top.zone).toBeGreaterThanOrEqual(2);
    expect(surfaceAt(s, 500, 400, o).volcanic).toBe(false);
  });

  it('lakes are fresh water on land', () => {
    const s = world(land, ['lake', [500, 300], { size: 60 }]);
    expect(surfaceAt(s, 500, 300, o).water).toBe('lake');
    expect(surfaceAt(s, 500, 300, o).ground).toBe('land');
  });
});
