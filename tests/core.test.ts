import { describe, expect, it } from 'vitest';
import { centreLatitude, defaultSettings, kmPerDegree, latitudeAt, northForCentre, placeAtLatitude, planetRadiusKm, SIZE_PRESETS, southLatitude, validateSettings } from '../src/core/settings';
import { EARTH_RADIUS_KM, formatDistance, formatLatitude, KM_PER_DEGREE, milesToKm } from '../src/core/units';
import { createWorld, expandWorld, expansionProblem, onMapShift } from '../src/core/world';
import { deleteWorld, importWorld, listWorlds, loadWorld, parseWorld, saveWorld, type KeyValueStore } from '../src/core/storage';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('world settings', () => {
  it('has three size presets in miles, and defaults that are valid', () => {
    expect(SIZE_PRESETS.map((p) => [p.widthMi, p.heightMi])).toEqual([[500, 300], [2000, 1200], [4000, 2400]]);
    expect(validateSettings(defaultSettings())).toEqual([]);
  });

  it('places a flat map on the globe by its latitudes, measured in real distance', () => {
    const s = defaultSettings({ heightKm: 2 * KM_PER_DEGREE * 10, northLatitude: northForCentre(30, 2 * KM_PER_DEGREE * 10) });
    expect(s.northLatitude).toBeCloseTo(40, 6);
    expect(southLatitude(s)).toBeCloseTo(20, 6);
    expect(latitudeAt(s, KM_PER_DEGREE * 5)).toBeCloseTo(35, 6);
  });

  it('refuses maps that run past a pole or are too small, and odd climate settings', () => {
    expect(validateSettings(defaultSettings({ northLatitude: 95 }))).toContain('The map reaches past the North Pole.');
    expect(validateSettings(defaultSettings({ widthKm: 10 })).join(' ')).toMatch(/at least/);
    expect(validateSettings(defaultSettings({ axialTilt: 120 })).length).toBe(1);
    expect(validateSettings(defaultSettings({ rainfall: { mode: 'manual', percent: 250 } })).length).toBe(1);
    expect(validateSettings(defaultSettings({ name: '  ' }))).toContain('The world needs a name.');
  });

  it('shows distances in miles with kilometres, and latitudes with N and S', () => {
    expect(formatDistance(milesToKm(2000))).toBe('2,000 mi (3,219 km)');
    expect(formatLatitude(23.44)).toBe('23.4°N');
    expect(formatLatitude(-12)).toBe('12°S');
    expect(formatLatitude(0)).toBe('0°');
  });
});

describe('expanding a flat map', () => {
  it('grows in any direction; north and south extend the latitudes; the original is left alone', () => {
    const w = createWorld(defaultSettings({ widthKm: 1000, heightKm: 800, northLatitude: 50 }));
    const g = expandWorld(w, { north: KM_PER_DEGREE * 2, south: 100, east: 300, west: 200 });
    expect(g.settings.widthKm).toBe(1500);
    expect(g.settings.heightKm).toBeCloseTo(800 + KM_PER_DEGREE * 2 + 100, 6);
    expect(g.settings.northLatitude).toBeCloseTo(52, 6);
    // The old south edge stays at the same latitude, 100 km further from the new one.
    expect(southLatitude(g.settings)).toBeCloseTo(southLatitude(w.settings) - 100 / KM_PER_DEGREE, 6);
    expect(w.settings.widthKm).toBe(1000);
  });

  it('moves whatever is on the map when it grows west or north, so nothing shifts against the land', () => {
    const moves: [number, number][] = [];
    onMapShift((_w, dx, dy) => moves.push([dx, dy]));
    const w = createWorld(defaultSettings({ widthKm: 1000, heightKm: 800, northLatitude: 50 }));
    expandWorld(w, { north: 50, south: 0, east: 0, west: 120 });
    expandWorld(w, { north: 0, south: 30, east: 40, west: 0 });
    expect(moves).toEqual([[120, 50]]);
  });

  it('will not grow past a pole, or a globe this way', () => {
    const w = createWorld(defaultSettings({ widthKm: 1000, heightKm: 800, northLatitude: 89 }));
    expect(expansionProblem(w, { north: KM_PER_DEGREE * 2, south: 0, east: 0, west: 0 })).toMatch(/North Pole/);
    expect(expansionProblem(w, { north: 0, south: 0, east: 0, west: 0 })).toMatch(/how far/);
    const globe = createWorld(defaultSettings({ mapType: 'globe' }));
    expect(expansionProblem(globe, { north: 10, south: 0, east: 0, west: 0 })).toMatch(/globe/);
  });
});

describe('saving worlds', () => {
  it('saves, lists (newest first), loads and deletes worlds', () => {
    const store = memoryStore();
    const a = createWorld(defaultSettings({ name: 'Aerth' }), 1000);
    const b = createWorld(defaultSettings({ name: 'Brin' }), 2000);
    saveWorld(store, a);
    saveWorld(store, b);
    expect(listWorlds(store).map((e) => e.name)).toEqual(['Brin', 'Aerth']);
    expect(loadWorld(store, a.id)).toEqual(a);
    saveWorld(store, { ...a, settings: { ...a.settings, name: 'Aerth II' }, updatedAt: 3000 });
    expect(listWorlds(store).map((e) => e.name)).toEqual(['Aerth II', 'Brin']);
    deleteWorld(store, b.id);
    expect(listWorlds(store).map((e) => e.name)).toEqual(['Aerth II']);
    expect(loadWorld(store, b.id)).toBeNull();
  });

  it('imports a world as a new copy, fills in what older saves lack, and refuses things that are not worlds', () => {
    const store = memoryStore();
    const a = createWorld(defaultSettings({ name: 'Aerth' }));
    saveWorld(store, a);
    const copy = importWorld(store, JSON.stringify(a));
    expect(copy.id).not.toBe(a.id);
    expect(listWorlds(store)).toHaveLength(2);
    const old = JSON.parse(JSON.stringify(a));
    delete old.settings.climate.reefMinC;
    delete old.layers;
    const back = parseWorld(JSON.stringify(old));
    expect(back.settings.climate.reefMinC).toBe(18);
    expect(back.layers.surface).toBe(true);
    expect(() => parseWorld('hello')).toThrow(/not a saved world/);
    expect(() => parseWorld(JSON.stringify({ ...a, format: 99 }))).toThrow(/newer version/);
  });

  it('reports a full store as a readable error instead of failing silently', () => {
    const store: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); }, removeItem: () => {} };
    expect(() => saveWorld(store, createWorld(defaultSettings()))).toThrow(/could not be saved: quota exceeded/);
  });
});

describe('the planet grows with a map bigger than Earth', () => {
  it('keeps Earth’s degrees for maps that fit on Earth', () => {
    const s = defaultSettings();
    expect(kmPerDegree(s)).toBeCloseTo(KM_PER_DEGREE, 6);
    expect(planetRadiusKm(s)).toBe(EARTH_RADIUS_KM);
  });
  it('grows the planet and its degrees when the map is taller than pole to pole', () => {
    const s = defaultSettings({ widthKm: 30000, heightKm: 30000 });
    s.northLatitude = placeAtLatitude(s, 0);
    expect(kmPerDegree(s)).toBeCloseTo(30000 / 180, 6);
    expect(s.northLatitude).toBeCloseTo(90, 6);
    expect(southLatitude(s)).toBeCloseTo(-90, 6);
    expect(validateSettings(s)).toEqual([]);
  });
  it('grows the planet when the map is wider than Earth is around', () => {
    const s = defaultSettings({ widthKm: 80000, heightKm: 5000 });
    expect(planetRadiusKm(s)).toBeGreaterThan(EARTH_RADIUS_KM * 1.9);
  });
  it('keeps a map between the poles when it is moved', () => {
    const s = defaultSettings({ heightKm: 4000 });
    s.northLatitude = placeAtLatitude(s, 89);
    expect(s.northLatitude).toBeCloseTo(90, 6);
  });
  it('rescales the degrees when the canvas grows past Earth, keeping the old part’s middle', () => {
    const w = createWorld(defaultSettings({ widthKm: 8000, heightKm: 16000, northLatitude: 72 }));
    const before = centreLatitude(w.settings);
    const g = expandWorld(w, { north: 5000, south: 5000, east: 0, west: 0 });
    expect(kmPerDegree(g.settings)).toBeGreaterThan(KM_PER_DEGREE);
    expect(g.settings.northLatitude).toBeCloseTo(90, 6);
    expect(southLatitude(g.settings)).toBeCloseTo(-90, 6);
    // The old part's middle stays near where it was.
    expect(Math.abs(latitudeAt(g.settings, 5000 + 8000) - before)).toBeLessThan(0.5);
  });
});
