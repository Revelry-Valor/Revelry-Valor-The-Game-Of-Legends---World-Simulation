import { describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { evaluate } from '../src/core/terrain';
import { brushDefaults, isUnderdark, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { tunnelLength, underdarkAt, underdarkSummary, underStrokes, waysDown } from '../src/core/underdark';

const mk = () => {
  const surface: Surface = { strokes: [], nextId: 1 };
  const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => {
    const st = { ...brushDefaults(brush), id: surface.nextId++, pts, ...o } as Stroke;
    surface.strokes.push(st);
    return st;
  };
  return { surface, add };
};
const at = (s: Surface, x: number, y: number) => underdarkAt(underStrokes(s), x, y);

describe('the Underdark', () => {
  it('is solid rock until hollowed; caverns and tunnels open it, erasing fills it back', () => {
    const { surface, add } = mk();
    expect(at(surface, 100, 100).kind).toBe('rock');
    add('cavern', [100, 100, 160, 100], { size: 40, roughness: 0 });
    add('tunnel', [180, 100, 300, 100], { size: 3 });
    expect(at(surface, 130, 100).kind).toBe('cavern');
    expect(at(surface, 250, 100).kind).toBe('tunnel');
    expect(at(surface, 250, 110).kind).toBe('rock');
    add('cavern', [130, 100], { size: 10, roughness: 0, erase: true });
    expect(at(surface, 130, 100).kind).toBe('rock');
    expect(at(surface, 105, 100).kind).toBe('cavern');
    expect(tunnelLength(surface)).toBeCloseTo(120, 0);
  });

  it('floods with underground seas, which drain back to what was under them', () => {
    const { surface, add } = mk();
    add('cavern', [0, 0, 100, 0], { size: 40, roughness: 0 });
    add('undersea', [50, 0], { size: 30, roughness: 0 });
    expect(at(surface, 50, 0).kind).toBe('sea');
    // A sea also floods solid rock.
    add('undersea', [300, 0], { size: 30, roughness: 0 });
    expect(at(surface, 300, 0).kind).toBe('sea');
    add('undersea', [50, 0, 300, 0], { size: 40, roughness: 0, erase: true });
    expect(at(surface, 50, 0).kind).toBe('cavern');
    expect(at(surface, 300, 0).kind).toBe('rock');
  });

  it('grows ground cover only on open, dry floor', () => {
    const { surface, add } = mk();
    add('cavern', [0, 0, 100, 0], { size: 40, roughness: 0 });
    add('fungus', [0, 0, 200, 0], { size: 30, roughness: 0 });
    expect(at(surface, 50, 0)).toEqual({ kind: 'cavern', cover: 'fungus' });
    expect(at(surface, 180, 0)).toEqual({ kind: 'rock', cover: null });
    add('crystalcave', [80, 0], { size: 10, roughness: 0 });
    expect(at(surface, 80, 0).cover).toBe('crystalcave');
    add('glowcave', [50, 0], { size: 10, roughness: 0, erase: true });
    expect(at(surface, 50, 0).cover).toBeNull();
    expect(at(surface, 20, 0).cover).toBe('fungus');
  });

  it('joins the surface by entrances and shafts, telling which lead nowhere', () => {
    const { surface, add } = mk();
    add('cavern', [0, 0], { size: 40, roughness: 0 });
    add('entrance', [5, 0]);
    add('shaft', [500, 500]);
    add('entrance', [900, 900]);
    add('entrance', [900, 900], { erase: true });
    const ways = waysDown(surface);
    expect(ways.map((w) => [w.kind, w.below])).toEqual([['entrance', 'cavern'], ['shaft', 'rock']]);
  });

  it('never changes the surface: the land, its climate and its picture are the same with or without it', () => {
    const settings = defaultSettings({ widthKm: 2000, heightKm: 1500, northLatitude: 45, seed: 5 });
    const { surface, add } = mk();
    add('land', [1000, 750], { size: 900 });
    const before = computeClimate(surface, settings);
    const grid = { x0: 500, y0: 500, px: 20, w: 50, h: 25 };
    const fBefore = evaluate(surface, grid, { seed: 5, wrapKm: 0 });
    add('cavern', [1000, 750, 1100, 760], { size: 120 });
    add('undersea', [900, 700], { size: 80 });
    add('fungus', [1000, 750], { size: 60 });
    add('tunnel', [800, 750, 1200, 750], { size: 4 });
    add('entrance', [1000, 750]);
    expect(surface.strokes.filter((s) => isUnderdark(s.brush)).length).toBe(5);
    const after = computeClimate(surface, settings);
    expect(Array.from(after.land)).toEqual(Array.from(before.land));
    expect(Array.from(after.summer.temp)).toEqual(Array.from(before.summer.temp));
    expect(Array.from(after.summer.rain)).toEqual(Array.from(before.summer.rain));
    expect(Array.from(evaluate(surface, grid, { seed: 5, wrapKm: 0 }).ground)).toEqual(Array.from(fBefore.ground));
    // And only what is under land counts.
    const sum = underdarkSummary(surface, after, (k) => after.land[k] === 1);
    expect(sum.cavern).toBeGreaterThan(5000);
    expect(sum.sea).toBeGreaterThan(2000);
  });
});
