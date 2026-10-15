import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/engine/config';
import { pointAlong, riverNext, riverPoint, sampleField, siteOf, type Point } from '../src/engine/geometry';
import { World } from '../src/engine/world';

describe('continuous positions', () => {
  const world = new World(defaultConfig({ seed: 11, width: 120, height: 80, start: 'settlements' }));
  for (let y = 0; y < 60; y++) world.tick();
  const map = world.map;

  it('stands every settlement on dry land within its own tile, off the tile centre where the land invites it', () => {
    let offCentre = 0;
    for (const s of world.settlements) {
      expect(s.px).toBeGreaterThanOrEqual(s.x);
      expect(s.px).toBeLessThan(s.x + 1);
      expect(s.py).toBeGreaterThanOrEqual(s.y);
      expect(s.py).toBeLessThan(s.y + 1);
      expect(sampleField(map.elevation, map.width, map.height, s.px, s.py)).toBeGreaterThanOrEqual(0);
      if (Math.hypot(s.px - s.x - 0.5, s.py - s.y - 0.5) > 0.05) offCentre++;
    }
    expect(offCentre).toBeGreaterThan(world.settlements.length * 0.5);
    // The same tile always gives the same site.
    const s = world.settlements[0];
    expect(siteOf(map, s.tile, s.id)).toEqual([s.px, s.py]);
  });

  it('keeps riverside towns on the bank rather than in the river', () => {
    let checked = 0;
    for (const s of world.settlements) {
      if (map.river[s.tile] <= 0) continue;
      const n = riverNext(map, s.tile);
      if (n < 0) continue;
      const [a, b] = [riverPoint(map, s.tile), riverPoint(map, n)];
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((s.px - a[0]) * vx + (s.py - a[1]) * vy) / (vx * vx + vy * vy)));
      expect(Math.hypot(s.px - a[0] - vx * t, s.py - a[1] - vy * t)).toBeGreaterThanOrEqual(0.06);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('moves travellers continuously along the curve the map draws', () => {
    const pts: Point[] = [[0, 0], [2, 0], [2, 2], [4, 3], [6, 3]];
    let prev = pointAlong(pts, 0);
    expect(prev).toEqual([0, 0]);
    for (let pos = 0.01; pos <= 4; pos += 0.01) {
      const p = pointAlong(pts, pos);
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1])).toBeLessThan(0.1);
      prev = p;
    }
    expect(pointAlong(pts, 4)).toEqual([6, 3]);
    // Corners are rounded: halfway through the turn it cuts inside the corner point.
    const corner = pointAlong(pts, 1);
    expect(corner[0]).toBeLessThan(2);
    expect(corner[1]).toBeGreaterThan(0);
  });
});
