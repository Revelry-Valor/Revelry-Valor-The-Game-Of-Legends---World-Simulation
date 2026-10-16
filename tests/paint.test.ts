import { describe, expect, it } from 'vitest';
import { brushDefaults, emptySurface, snapSpur, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { evaluate, surfaceAt, whirlpools } from '../src/core/terrain';
import { createWorld, expandWorld } from '../src/core/world';
import { parseWorld } from '../src/core/storage';
import { renderPicture } from '../src/render/paintmap';

const o = { seed: 7, wrapKm: 0 };
function paint(...strokes: [BrushId, number[], Partial<Stroke>?][]): Surface {
  const s = emptySurface();
  for (const [brush, pts, extra] of strokes) s.strokes.push({ ...brushDefaults(brush), id: s.nextId++, pts, roughness: 0, variation: 0, ...extra });
  return s;
}

describe('painting land and sea', () => {
  it('starts as deep sea; land, shallow and deep brushes set the ground where painted', () => {
    expect(surfaceAt(emptySurface(), 100, 100, o).ground).toBe('deep');
    const s = paint(['land', [0, 0, 400, 0], { size: 200 }], ['shallow', [200, 0], { size: 60 }], ['deep', [350, 0], { size: 40 }]);
    expect(surfaceAt(s, 50, 0, o).ground).toBe('land');
    expect(surfaceAt(s, 200, 0, o).ground).toBe('shallow');
    expect(surfaceAt(s, 350, 0, o).ground).toBe('deep');
    expect(surfaceAt(s, 50, 300, o).ground).toBe('deep');
  });

  it('gives the same answer every time, at any sampling', () => {
    const s = paint(['land', [0, 0, 500, 200], { size: 300, roughness: 0.6 }]);
    const a = evaluate(s, { x0: 100, y0: 50, px: 2, w: 40, h: 30 }, o);
    const b = evaluate(s, { x0: 100, y0: 50, px: 2, w: 40, h: 30 }, o);
    expect([...a.ground]).toEqual([...b.ground]);
  });

  it('a soft land edge leaves a strip of shallow sea', () => {
    const s = paint(['land', [0, 0], { size: 400, softness: 0.6 }]);
    const along = [0, 100, 150, 170, 190, 210].map((x) => surfaceAt(s, x, 0, o).ground);
    expect(along[0]).toBe('land');
    expect(along).toContain('shallow');
    expect(along[along.length - 1]).toBe('deep');
  });
});

describe('features and layers', () => {
  it('erasing removes only the selected layer', () => {
    const s = paint(['land', [0, 0, 600, 0], { size: 400 }], ['forest', [300, 0], { size: 200 }], ['hills', [300, 0], { size: 200 }], ['forest', [300, 0], { size: 120, erase: true }]);
    const p = surfaceAt(s, 300, 0, o);
    expect(p.ground).toBe('land');
    expect(p.cover.forest ?? 0).toBeLessThan(0.05);
    expect(surfaceAt(s, 300, 80, o).cover.forest).toBeGreaterThan(0.5);
  });

  it('mountains get zones: peaks or high ground on the crest, foothills at the edge', () => {
    const s = paint(['land', [0, 0, 1000, 0], { size: 800 }], ['mountains', [200, 0, 800, 0], { size: 200, strength: 1 }]);
    const across = Array.from({ length: 31 }, (_, k) => surfaceAt(s, 500, k * 4, o).zone);
    expect(across[0]).toBeGreaterThanOrEqual(3);
    expect(across).toContain(2);
    expect(across).toContain(1);
    expect(surfaceAt(s, 500, 300, o).zone).toBe(0);
  });

  it('mountains build up: painting over a range makes it higher and wider', () => {
    const one = paint(['land', [0, 0, 1000, 0], { size: 800 }], ['mountains', [200, 0, 800, 0], { size: 200, strength: 0.5 }]);
    const two = paint(['land', [0, 0, 1000, 0], { size: 800 }], ['mountains', [200, 0, 800, 0], { size: 200, strength: 0.5 }], ['mountains', [200, 0, 800, 0], { size: 260, strength: 0.5 }]);
    expect(surfaceAt(two, 500, 0, o).mountain).toBeGreaterThan(surfaceAt(one, 500, 0, o).mountain * 1.4);
    expect(surfaceAt(one, 500, 110, o).mountain).toBe(0);
    expect(surfaceAt(two, 500, 110, o).mountain).toBeGreaterThan(0);
  });

  it('the zone brush overrides the automatic zones, and Automatic puts them back', () => {
    const s = paint(['land', [0, 0, 1000, 0], { size: 800 }], ['mountains', [200, 0, 800, 0], { size: 200, strength: 1 }], ['zone', [500, 0], { size: 60, zone: 2 }]);
    expect(surfaceAt(s, 500, 0, o).zone).toBe(2);
    s.strokes.push({ ...brushDefaults('zone'), id: 99, pts: [500, 0], size: 60, zone: 0, roughness: 0, variation: 0 });
    expect(surfaceAt(s, 500, 0, o).zone).toBeGreaterThanOrEqual(3);
  });

  it('a spur snaps onto an existing range', () => {
    const s = paint(['mountains', [0, 0, 400, 0], { size: 100 }]);
    const snap = snapSpur(s, 210, 30)!;
    expect(snap.x).toBeCloseTo(210, 5);
    expect(snap.y).toBeCloseTo(0, 5);
    expect(snap.size).toBeCloseTo(100, 5);
    expect(snapSpur(s, 210, 300)).toBeNull();
  });

  it('canyons and ravines block travel; whirlpools can be placed and erased', () => {
    const s = paint(['land', [0, 0, 600, 0], { size: 400 }], ['canyon', [300, -100, 300, 100]]);
    expect(surfaceAt(s, 300, 0, o).blocksTravel).toBe(true);
    expect(surfaceAt(s, 200, 0, o).blocksTravel).toBe(false);
    const w = paint(['whirlpool', [50, 50], { dangerous: false }], ['whirlpool', [500, 50]], ['whirlpool', [500, 50], { erase: true, size: 30 }]);
    expect(whirlpools(w).map((p) => [p.x, p.dangerous])).toEqual([[50, false]]);
  });
});

describe('the painted world', () => {
  it('keeps painting in place when the map grows west or north', () => {
    const w = createWorld(defaultSettings({ widthKm: 1000, heightKm: 800, northLatitude: 50 }));
    w.surface = paint(['land', [100, 200]]);
    const g = expandWorld(w, { north: 50, south: 0, east: 0, west: 120 });
    expect(g.surface.strokes[0].pts).toEqual([220, 250]);
    expect(w.surface.strokes[0].pts).toEqual([100, 200]);
  });

  it('saves and loads its strokes, dropping damaged ones; older saves get an empty surface', () => {
    const w = createWorld(defaultSettings());
    w.surface = paint(['land', [1, 2, 3, 4]]);
    const text = JSON.stringify({ ...w, surface: { ...w.surface, strokes: [...w.surface.strokes, { id: 5, brush: 'nonsense', pts: [1, 2], size: 3 }] } });
    const back = parseWorld(text);
    expect(back.surface.strokes.length).toBe(1);
    expect(back.surface.nextId).toBe(2);
    const old = parseWorld(JSON.stringify({ format: 1, id: 'x', settings: defaultSettings() }));
    expect(old.surface).toEqual(emptySurface());
  });

  it('draws pictures in both looks, transparent outside the map', () => {
    const s = paint(['land', [50, 50], { size: 60 }], ['mountains', [40, 50, 60, 50], { size: 30 }]);
    for (const style of ['satellite', 'paper'] as const) {
      const img = renderPicture(s, { x0: 0, y0: 0, px: 1, w: 120, h: 120, style, zones: true, seed: 1, widthKm: 100, heightKm: 100, wrap: false });
      expect(img[(50 * 120 + 50) * 4 + 3]).toBe(255);
      expect(img[(110 * 120 + 110) * 4 + 3]).toBe(0);
    }
  });
});
