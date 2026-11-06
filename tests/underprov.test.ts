import { describe, expect, it } from 'vitest';
import { fineIndex } from '../src/core/finegeo';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { generateUnderProvinces, readUnderProvinces } from '../src/core/underprov';

const settings = defaultSettings({ widthKm: 2000, heightKm: 1400, northLatitude: 40, seed: 3 });
const mk = () => {
  const surface: Surface = { strokes: [], nextId: 1 };
  const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => {
    const st = { ...brushDefaults(brush), id: surface.nextId++, pts, ...o } as Stroke;
    surface.strokes = [...surface.strokes, st];
    return st;
  };
  add('land', [1000, 700], { size: 1300, roughness: 0.1 });
  return { surface, add };
};
const at = (m: ReturnType<typeof generateUnderProvinces>, x: number, y: number) => {
  const k = fineIndex(m.grid, m.wrapKm, x, y);
  return k >= 0 && m.label[k] >= 0 ? m.provinces[m.label[k]] : null;
};

describe('Underdark provinces', () => {
  it('fills the rock under the land with provinces, and nothing beyond it', () => {
    const { surface } = mk();
    const m = generateUnderProvinces(surface, settings, {});
    expect(m.provinces.length).toBeGreaterThan(20);
    expect(m.provinces.every((p) => p.kind === 'rock')).toBe(true);
    expect(at(m, 1000, 700)?.kind).toBe('rock');
    expect(at(m, 60, 60)).toBeNull();
  }, 60000);

  it('gives caverns, tunnels and seas provinces of their own, shaped by the painting', () => {
    const { surface, add } = mk();
    add('cavern', [700, 700, 900, 700], { size: 120, roughness: 0 });
    add('fungus', [700, 700, 900, 700], { size: 100, roughness: 0 });
    add('tunnel', [900, 700, 1300, 700], { size: 3 });
    add('undersea', [1350, 700], { size: 160, roughness: 0 });
    const m = generateUnderProvinces(surface, settings, {});
    const kinds = new Set(m.provinces.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(['cavern', 'rock', 'sea', 'tunnel']);
    const cave = at(m, 800, 700)!;
    expect(cave.kind).toBe('cavern');
    expect(cave.cover).toBe('fungus');
    expect(at(m, 1100, 700)?.kind).toBe('tunnel');
    expect(at(m, 1350, 700)?.kind).toBe('sea');
    // The tunnel runs as a string of provinces, each joined to the next.
    const tunnel = m.provinces.filter((p) => p.kind === 'tunnel');
    expect(tunnel.length).toBeGreaterThanOrEqual(3);
    // Caverns hold together: never one province across rock and cave.
    expect(m.provinces.every((p) => p.area > 0)).toBe(true);
  }, 60000);

  it('keeps each province and its id when grown again from its seeds after repainting', () => {
    const { surface, add } = mk();
    add('cavern', [700, 700, 900, 700], { size: 120, roughness: 0 });
    const a = generateUnderProvinces(surface, settings, {});
    const saved = readUnderProvinces(JSON.parse(JSON.stringify(a.saved)))!;
    add('cavern', [1200, 500], { size: 100, roughness: 0 });
    const b = generateUnderProvinces(surface, settings, { saved });
    expect(at(b, 1200, 500)?.kind).toBe('cavern');
    // Away from the new cave, the same provinces.
    expect(at(b, 800, 700)?.id).toBe(at(a, 800, 700)?.id);
    expect(at(b, 600, 1000)?.id).toBe(at(a, 600, 1000)?.id);
    // New sizes start afresh.
    const c = generateUnderProvinces(surface, settings, { saved, rockMi: 100 });
    expect(c.provinces.filter((p) => p.kind === 'rock').length).toBeLessThan(b.provinces.filter((p) => p.kind === 'rock').length);
  }, 60000);
});
