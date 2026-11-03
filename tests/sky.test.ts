import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate, type Climate } from '../src/core/climate';
import { evaluate } from '../src/core/terrain';
import { brushDefaults, offSurface, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { islandArea, islandAt, skyFalls, skyGround, skyIslands, skyPaintedCover } from '../src/core/sky';
import { autoSkyCover, driftPerYear, skyClimate } from '../src/core/skyclimate';

const settings = defaultSettings({ widthKm: 2000, heightKm: 1500, northLatitude: 50, seed: 9 });
const mk = () => {
  const surface: Surface = { strokes: [], nextId: 1 };
  const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => {
    const st = { ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0, ...o } as Stroke;
    surface.strokes.push(st);
    surface.strokes = surface.strokes.slice();
    return st;
  };
  return { surface, add };
};

describe('sky islands', () => {
  it('makes one island of strokes that touch, apart on each layer', () => {
    const { surface, add } = mk();
    add('skyisland', [100, 100, 150, 100], { size: 40, sky: 1 });
    add('skyisland', [170, 100, 200, 110], { size: 40, sky: 1 });
    add('skyisland', [600, 100], { size: 40, sky: 1 });
    add('skyisland', [100, 100], { size: 40, sky: 2 });
    const isl = skyIslands(surface);
    expect(isl.filter((i) => i.layer === 1).length).toBe(2);
    expect(isl.filter((i) => i.layer === 2).length).toBe(1);
    expect(islandAt(surface, 1, 190, 105)?.id).toBe(1);
    expect(islandAt(surface, 3, 100, 100)).toBeNull();
    expect(islandArea(surface, isl[0])).toBeGreaterThan(4000);
  });

  it('erases island ground and its cover', () => {
    const { surface, add } = mk();
    add('skyisland', [100, 100, 200, 100], { size: 60, sky: 1 });
    add('skyforest', [100, 100, 200, 100], { size: 30, sky: 1 });
    expect(skyPaintedCover(surface, 1, 150, 100)).toBe('forest');
    add('skyisland', [150, 100], { size: 20, sky: 1, erase: true });
    expect(skyGround(surface, 1, 150, 100)).toBe(false);
    expect(skyGround(surface, 1, 110, 100)).toBe(true);
    add('skyrock', [110, 100], { size: 10, sky: 1, erase: true });
    expect(skyPaintedCover(surface, 1, 110, 100)).toBeNull();
  });

  it('drifts along a path drawn from it, or with the wind, or stays fixed', () => {
    const { surface, add } = mk();
    const first = add('skyisland', [100, 100], { size: 40, sky: 1 });
    expect(skyIslands(surface)[0].drift).toBe('fixed');
    add('skypath', [100, 100, 300, 100, 400, 200], { sky: 1 });
    expect(skyIslands(surface)[0].drift).toBe('path');
    expect(driftPerYear(skyIslands(surface)[0], null)).toBeGreaterThan(0);
    first.drift = 'wind';
    surface.strokes = surface.strokes.slice();
    expect(skyIslands(surface)[0].drift).toBe('wind');
    first.drift = 'path';
    add('skypath', [300, 100], { sky: 1, size: 10, erase: true });
    expect(skyIslands(surface)[0].path).toBeNull();
    expect(skyIslands(surface)[0].drift).toBe('fixed');
  });

  it('lands a fixed island’s waterfalls on the ground below, never a drifting one’s', () => {
    const { surface, add } = mk();
    add('land', [1000, 750], { size: 1200, softness: 0.2 });
    const isl = add('skyisland', [1000, 750], { size: 60, sky: 1 });
    add('skyfall', [1029, 750], { sky: 1 });
    expect(skyFalls(surface)[0].lands).toBe(true);
    const grid = { x0: 1000, y0: 730, px: 1, w: 60, h: 40 };
    const pool = (s: Surface) => Array.from(evaluate(s, grid, { seed: 9, wrapKm: 0 }).water).reduce((a, b) => a + b, 0);
    const fixed = pool(surface);
    expect(fixed).toBeGreaterThan(1);
    isl.drift = 'wind';
    surface.strokes = surface.strokes.slice();
    expect(skyFalls(surface)[0].lands).toBe(false);
    expect(pool(surface)).toBeLessThan(fixed * 0.1);
  });

  describe('climate up there', () => {
    let cl: Climate;
    beforeAll(() => {
      const { surface, add } = mk();
      add('land', [1000, 750], { size: 1200 });
      cl = computeClimate(surface, settings);
    });
    it('is colder, windier and drier the higher the layer', () => {
      const [a, b, c] = ([1, 2, 3] as const).map((l) => skyClimate(cl, settings, l, 1000, 750));
      const ground = cl.summer.temp[Math.round((750 - cl.y0) / cl.step) * cl.w + Math.round((1000 - cl.x0) / cl.step)];
      expect(a.summerT).toBeLessThan(ground);
      expect(b.summerT).toBeLessThan(a.summerT - 5);
      expect(c.summerT).toBeLessThan(b.summerT - 5);
      expect(c.wind).toBeGreaterThanOrEqual(a.wind);
      expect(c.summerRain).toBeLessThanOrEqual(a.summerRain);
      expect(['meadow', 'tundra']).toContain(autoSkyCover(a));
      expect(autoSkyCover({ ...c, summerT: -3 })).toBe('snow');
    });
  });

  it('never changes the surface or its climate (only fixed islands’ waterfalls reach it)', () => {
    const { surface, add } = mk();
    add('land', [1000, 750], { size: 900 });
    const before = computeClimate(surface, settings);
    add('skyisland', [1000, 750, 1100, 760], { size: 120, sky: 2 });
    add('skyforest', [1000, 750], { size: 60, sky: 2 });
    add('skypath', [1000, 750, 1400, 700], { sky: 2 });
    for (const s of surface.strokes.slice(1)) expect(offSurface(s.brush)).toBe(true);
    expect(offSurface('skyfall')).toBe(false);
    const after = computeClimate(surface, settings);
    expect(Array.from(after.land)).toEqual(Array.from(before.land));
    expect(Array.from(after.summer.temp)).toEqual(Array.from(before.summer.temp));
    expect(Array.from(after.summer.rain)).toEqual(Array.from(before.summer.rain));
  });
});
