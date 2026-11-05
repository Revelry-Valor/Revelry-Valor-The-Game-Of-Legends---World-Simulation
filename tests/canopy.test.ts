import { describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { canopyGround, crownAt, giantTrees, giantVines, limbLength, treeCities } from '../src/core/canopy';
import { brushDefaults, offSurface, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';

const mk = () => {
  const surface: Surface = { strokes: [], nextId: 1 };
  const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => {
    const st = { ...brushDefaults(brush), id: surface.nextId++, pts, ...o } as Stroke;
    surface.strokes = [...surface.strokes, st];
    return st;
  };
  return { surface, add };
};
const everywhereLand = () => true;

describe('giant trees, the canopy and giant vines', () => {
  it('plants trees whose crowns make canopy ground, and fells them by erasing at the trunk', () => {
    const { surface, add } = mk();
    add('gianttree', [100, 100], { size: 32 });
    add('gianttree', [300, 100], { size: 32 });
    expect(giantTrees(surface).length).toBe(2);
    expect(crownAt(surface, 108, 100)?.id).toBe(1);
    expect(canopyGround(surface, 200, 100)).toBe(false);
    add('gianttree', [301, 101], { size: 2, erase: true });
    expect(giantTrees(surface).map((t) => t.id)).toEqual([1]);
    expect(canopyGround(surface, 300, 100)).toBe(false);
  });

  it('bridges crowns with limbs, which can be cut', () => {
    const { surface, add } = mk();
    add('gianttree', [100, 100], { size: 32 });
    add('gianttree', [200, 100], { size: 32 });
    add('limb', [110, 100, 190, 100], { size: 2 });
    expect(canopyGround(surface, 150, 100)).toBe(true);
    expect(canopyGround(surface, 150, 104)).toBe(false);
    expect(limbLength(surface)).toBeCloseTo(80, 0);
    add('limb', [150, 95, 150, 105], { size: 4, erase: true });
    expect(canopyGround(surface, 150, 100)).toBe(false);
    expect(canopyGround(surface, 130, 100)).toBe(true);
  });

  it('marks tree city sites, telling which stand on nothing', () => {
    const { surface, add } = mk();
    add('gianttree', [100, 100], { size: 32 });
    add('limb', [110, 100, 190, 100], { size: 2 });
    add('treecity', [100, 100]);
    add('treecity', [170, 100]);
    add('treecity', [500, 500]);
    const c = treeCities(surface);
    expect(c.map((k) => [!!k.tree, k.onLimb])).toEqual([[true, false], [true, true], [false, false]]);
  });

  it('runs vines between layers, checking that both ends hold', () => {
    const { surface, add } = mk();
    add('skyisland', [400, 100], { size: 40, sky: 1, roughness: 0 });
    add('gianttree', [100, 100], { size: 32 });
    add('vine', [100, 100, 250, 100, 400, 100], { vineFrom: 'canopy', vineTo: 'sky1' });
    add('vine', [100, 300, 400, 300], { vineFrom: 'surface', vineTo: 'sky2' });
    const v = giantVines(surface, everywhereLand);
    expect(v[0].problem).toBe('');
    expect(v[1].problem).toMatch(/end isn’t on an island on sky layer 2/);
    // Erasing over a vine takes it away.
    add('vine', [250, 100], { size: 3, erase: true });
    expect(giantVines(surface, everywhereLand).map((k) => k.id)).toEqual([4]);
  });

  it('never changes the surface or its climate', () => {
    const settings = defaultSettings({ widthKm: 2000, heightKm: 1500, northLatitude: 45, seed: 5 });
    const { surface, add } = mk();
    add('land', [1000, 750], { size: 900 });
    const before = computeClimate(surface, settings);
    add('gianttree', [1000, 750], { size: 40 });
    add('limb', [1000, 750, 1100, 750]);
    add('treecity', [1000, 750]);
    add('vine', [1000, 750, 1200, 700], { vineFrom: 'surface', vineTo: 'canopy' });
    for (const s of surface.strokes.slice(1)) expect(offSurface(s.brush)).toBe(true);
    const after = computeClimate(surface, settings);
    expect(Array.from(after.land)).toEqual(Array.from(before.land));
    expect(Array.from(after.summer.temp)).toEqual(Array.from(before.summer.temp));
  });
});
