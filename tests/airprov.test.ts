import { describe, expect, it } from 'vitest';
import { generateAirProvinces, readAirProvinces, vineLayer } from '../src/core/airprov';
import { fineIndex } from '../src/core/finegeo';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';

const settings = defaultSettings({ widthKm: 2000, heightKm: 1400, northLatitude: 40, seed: 5 });
const mk = () => {
  const surface: Surface = { strokes: [], nextId: 1 };
  const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => {
    const st = { ...brushDefaults(brush), id: surface.nextId++, pts, ...o } as Stroke;
    surface.strokes = [...surface.strokes, st];
    return st;
  };
  add('land', [1000, 700], { size: 1000 });
  return { surface, add };
};
const at = (m: ReturnType<typeof generateAirProvinces>, x: number, y: number) => {
  const k = fineIndex(m.grid, m.wrapKm, x, y);
  return k >= 0 && m.label[k] >= 0 ? m.provinces[m.label[k]] : null;
};

describe('canopy and sky provinces', () => {
  it('splits a whole layer, over land and sea, into open-air provinces', () => {
    const { surface } = mk();
    const m = generateAirProvinces(surface, settings, 2, {});
    expect(m.provinces.length).toBeGreaterThan(20);
    expect(m.provinces.every((p) => p.kind === 'air')).toBe(true);
    expect(at(m, 60, 60)?.kind).toBe('air');
    expect(at(m, 1000, 700)?.kind).toBe('air');
  }, 60000);

  it('gives a layer’s islands, the canopy’s limbs and trunks, and its vines provinces of their own', () => {
    const { surface, add } = mk();
    add('skyisland', [600, 400, 700, 420], { size: 120, sky: 1, roughness: 0 });
    add('skyisland', [1500, 900], { size: 120, sky: 0, roughness: 0 });
    add('gianttree', [800, 900], { size: 4 });
    add('gianttree', [1100, 900], { size: 4 });
    add('limb', [800, 900, 1100, 900], { size: 2 });
    add('vine', [1100, 900, 1450, 900], { vineFrom: 'canopy', vineTo: 'canopy' });
    add('vine', [700, 600, 650, 420], { vineFrom: 'surface', vineTo: 'sky1', size: 4 });
    const canopy = generateAirProvinces(surface, settings, 0, {});
    expect(at(canopy, 1500, 900)?.kind).toBe('island');
    expect(at(canopy, 950, 900)?.kind).toBe('limb');
    expect(at(canopy, 1300, 900)?.kind).toBe('vine');
    expect(canopy.provinces.filter((p) => p.kind === 'limb').length).toBeGreaterThanOrEqual(3);
    // The vine from the ground to sky layer 1 climbs through the canopy: its provinces are there.
    expect(at(canopy, 688.9, 560)?.kind).toBe('vine');
    // Right beside a vine or limb is open air: provinces keep to their edges.
    expect(at(canopy, 695, 560)?.kind).toBe('air');
    expect(at(canopy, 950, 905)?.kind).toBe('air');
    expect(at(canopy, 650, 410)?.kind).toBe('air');
    const sky1 = generateAirProvinces(surface, settings, 1, {});
    expect(at(sky1, 650, 410)?.kind).toBe('island');
    expect(at(sky1, 950, 900)?.kind).toBe('air');
    expect(vineLayer('sky2', 'sky1')).toBe(1);
  }, 60000);

  it('keeps each province and its id when grown again from its seeds', () => {
    const { surface, add } = mk();
    const a = generateAirProvinces(surface, settings, 1, {});
    add('skyisland', [1500, 300], { size: 100, sky: 1, roughness: 0 });
    const b = generateAirProvinces(surface, settings, 1, { saved: a.seeds });
    expect(at(b, 1500, 300)?.kind).toBe('island');
    expect(at(b, 300, 1100)?.id).toBe(at(a, 300, 1100)?.id);
    const saved = readAirProvinces(JSON.parse(JSON.stringify({ v: 1, airMi: 120, islandMi: 40, strandMi: 30, layers: { 1: b.seeds } })))!;
    expect(saved.layers['1']?.ids.length).toBe(b.seeds.ids.length);
  }, 60000);
});
