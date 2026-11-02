import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate, type Climate } from '../src/core/climate';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { KM_PER_DEGREE } from '../src/core/units';
import { fineGeography, sampleGround } from '../src/core/finegeo';
import { generateProvinces, type ProvinceCache, type ProvinceMap } from '../src/core/provinces';
import { createWorld } from '../src/core/world';
import { parseWorld } from '../src/core/storage';

/** A continent with a mountain range, a forest, a big river and a lake. */
const north = 40;
const settings = defaultSettings({ widthKm: 6000, heightKm: 50 * KM_PER_DEGREE, northLatitude: north, edges: 'wrap', seed: 11 });
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
add('mountains', line([[2300, yAt(28)], [2300, yAt(12)]], 25), { size: 200, strength: 1 });
add('forest', line([[3300, yAt(25)], [3500, yAt(15)]]), { size: 500 });
add('river', line([[2600, yAt(20)], [3200, yAt(10)], [4100, yAt(5)]]), { width: 2 });
add('lake', line([[3700, yAt(22)], [3760, yAt(22)]]), { size: 120 });
add('cliffs', line([[2700, yAt(5)], [3100, yAt(0)]], 10));
add('canyon', line([[3500, yAt(12)], [3800, yAt(4)]], 10), { size: 70 });
add('ravine', line([[2500, yAt(8)], [2750, yAt(14)]], 10));

let cl: Climate;
let pm: ProvinceMap;
const SIZE_MI = 50;
beforeAll(() => {
  cl = computeClimate(surface, settings);
  pm = generateProvinces(surface, settings, cl, { sizeMi: SIZE_MI, seaFactor: 3 });
}, 120000);

/** Connected pieces (4 neighbours, wrapping east–west) of each label. */
function pieces(label: Int32Array, w: number, h: number): Map<number, number> {
  const seen = new Uint8Array(w * h);
  const out = new Map<number, number>();
  for (let k = 0; k < w * h; k++) {
    if (seen[k] || label[k] < 0) continue;
    const l = label[k];
    out.set(l, (out.get(l) ?? 0) + 1);
    const st = [k];
    seen[k] = 1;
    while (st.length) {
      const c = st.pop()!;
      const i = c % w;
      const j = (c / w) | 0;
      for (const m of [i > 0 ? c - 1 : c + w - 1, i < w - 1 ? c + 1 : c - w + 1, j > 0 ? c - w : -1, j < h - 1 ? c + w : -1]) {
        if (m >= 0 && !seen[m] && label[m] === l) {
          seen[m] = 1;
          st.push(m);
        }
      }
    }
  }
  return out;
}

describe('fine geography', () => {
  it('keeps every region and water in one piece', () => {
    const fine = cl.geo!.fine!;
    for (const arr of [fine.region, fine.water]) {
      const split = [...pieces(arr, fine.grid.w, fine.grid.h)].filter(([, c]) => c > 1);
      expect(split).toEqual([]);
    }
  });
  it('puts painted mountains in a mountain or highland region', () => {
    const fine = cl.geo!.fine!;
    const g = sampleGround(surface, settings, fine.grid);
    let high = 0;
    let inRange = 0;
    for (let k = 0; k < g.band.length; k++) {
      // High mountains and peaks (not foothills, highlands or plateaus).
      if (g.band[k] < 3 || g.band[k] >= 5) continue;
      high++;
      const kind = cl.geo!.regions[fine.region[k]]?.kind;
      if (kind === 'Mountains' || kind === 'Highlands') inRange++;
    }
    expect(high).toBeGreaterThan(20);
    expect(inRange / high).toBeGreaterThan(0.9);
  });
});

describe('provinces', () => {
  it('splits land and sea into provinces about the size asked for', () => {
    const land = pm.provinces.filter((p) => p.kind === 'land');
    const sea = pm.provinces.filter((p) => p.kind === 'sea');
    expect(land.length).toBeGreaterThan(100);
    expect(sea.length).toBeGreaterThan(10);
    const across = land.map((p) => Math.sqrt(p.area) / 1.609344).sort((a, b) => a - b);
    const median = across[Math.floor(across.length / 2)];
    expect(median).toBeGreaterThan(SIZE_MI * 0.75);
    expect(median).toBeLessThan(SIZE_MI * 1.25);
    // Sea provinces are bigger.
    const seaMedian = sea.map((p) => p.area).sort((a, b) => a - b)[Math.floor(sea.length / 2)];
    expect(seaMedian).toBeGreaterThan(land[Math.floor(land.length / 2)].area * 3);
  });
  it('makes every province one piece', () => {
    const split = [...pieces(pm.label, pm.grid.w, pm.grid.h)].filter(([, c]) => c > 1);
    expect(split).toEqual([]);
  });
  it('never mixes land and sea, or crosses a region border', () => {
    const g = sampleGround(surface, settings, pm.grid);
    const fg = fineGeography(cl, g, settings.seed);
    let mixed = 0;
    let crossed = 0;
    let landPts = 0;
    for (let k = 0; k < pm.label.length; k++) {
      const p = pm.provinces[pm.label[k]];
      if (g.land[k] && !g.lake[k]) {
        landPts++;
        if (p.kind === 'sea') mixed++;
        // Lowland provinces keep to their region (a mountain range or canyon is one zone across regions).
        else if (p.kind === 'land' && !['Mountains', 'Highlands', 'Foothills', 'Plateau', 'Canyon'].includes(p.terrain) && fg.region[k] !== p.region) crossed++;
      } else if (!g.land[k] && p.kind !== 'sea') mixed++;
    }
    // Only slivers too small to stand alone are folded in.
    expect(mixed / pm.label.length).toBeLessThan(0.002);
    expect(crossed / landPts).toBeLessThan(0.01);
  });
  it('gives mountains, lakes and big rivers their due', () => {
    // A range is split into mountain provinces (only the heart of a wide one is impassable).
    const mountains = pm.provinces.filter((p) => p.kind === 'land' && (p.terrain === 'Mountains' || p.terrain === 'Highlands'));
    const waste = pm.provinces.filter((p) => p.kind === 'wasteland');
    expect(mountains.length).toBeGreaterThan(2);
    expect(mountains.reduce((a, p) => a + p.area, 0)).toBeGreaterThan(waste.reduce((a, p) => a + p.area, 0));
    expect(pm.provinces.some((p) => p.kind === 'lake')).toBe(true);
    expect(pm.provinces.some((p) => p.river)).toBe(true);
    // No province holds land on both banks of the big river: walk across it and the province changes.
    const g = sampleGround(surface, settings, pm.grid);
    const { w } = pm.grid;
    let crossings = 0;
    let same = 0;
    for (let k = 0; k < pm.label.length - 3 * w; k++) {
      // A straight run north–south: land, big river, land.
      if (!g.land[k] || g.river[k] || g.lake[k]) continue;
      let q = k + w;
      let wide = 0;
      while (q < pm.label.length && g.river[q] === 2 && wide < 6) {
        q += w;
        wide++;
      }
      if (!wide || q >= pm.label.length || !g.land[q] || g.river[q] || g.lake[q]) continue;
      crossings++;
      if (pm.label[k] === pm.label[q]) same++;
    }
    expect(crossings).toBeGreaterThan(10);
    expect(same / crossings).toBeLessThan(0.05);
  });
  it('lists each province’s neighbours both ways', () => {
    for (let i = 0; i < pm.provinces.length; i++) for (const j of pm.provinces[i].neighbours) expect(pm.provinces[j].neighbours).toContain(i);
    expect(pm.provinces.some((p) => p.coastal)).toBe(true);
  });
  it('keeps each province (and its id) in place when updated after repainting', () => {
    const more: Surface = { strokes: [...surface.strokes, { ...brushDefaults('land'), id: 999, pts: line([[4400, yAt(10)], [4700, yAt(12)]]), size: 400, roughness: 0.2 } as Stroke], nextId: 1000 };
    const cl2 = computeClimate(more, settings);
    const next = generateProvinces(more, settings, cl2, { sizeMi: SIZE_MI, seaFactor: 3, saved: pm.saved });
    const idAt = (m: ProvinceMap, k: number) => m.provinces[m.label[k]].id;
    // Away from the new land, provinces stay as they were.
    let kept = 0;
    let total = 0;
    for (let k = 0; k < pm.label.length; k++) {
      const x = pm.grid.x0 + (k % pm.grid.w) * pm.grid.px;
      if (x > 3900) continue;
      total++;
      if (idAt(pm, k) === idAt(next, k)) kept++;
    }
    expect(kept / total).toBeGreaterThan(0.95);
    expect(next.saved.nextId).toBeGreaterThan(pm.saved.nextId);
  }, 60000);
  it('is saved with the world', () => {
    const w = { ...createWorld(settings), surface, provinces: pm.saved };
    const back = parseWorld(JSON.stringify(w));
    expect(back.provinces?.ids.length).toBe(pm.saved.ids.length);
    expect(back.provinces?.seeds).toEqual(pm.saved.seeds);
    expect(parseWorld(JSON.stringify({ ...w, provinces: { v: 1, sizeMi: 40 } })).provinces).toBeUndefined();
  });
  it('reshapes and merges provinces with the paint tool, and keeps the edits', () => {
    // Two neighbouring land provinces: paint all of the second with the first.
    const a = pm.provinces.findIndex((p) => p.kind === 'land' && p.neighbours.some((q) => pm.provinces[q].kind === 'land'));
    const b = pm.provinces[a].neighbours.find((q) => pm.provinces[q].kind === 'land')!;
    const A = pm.provinces[a];
    const B = pm.provinces[b];
    const r = Math.sqrt(B.area) * 1.5;
    const saved = { ...pm.saved, edits: [{ id: A.id, r, pts: [B.x, B.y] }] };
    const cache: ProvinceCache = {};
    const first = generateProvinces(surface, settings, cl, { sizeMi: SIZE_MI, seaFactor: 3, saved: pm.saved }, cache);
    const edited = generateProvinces(surface, settings, cl, { sizeMi: SIZE_MI, seaFactor: 3, saved }, cache);
    const grownA = edited.provinces.find((p) => p.id === A.id)!;
    expect(grownA.area).toBeGreaterThan(A.area + B.area * 0.5);
    // B is gone (or nearly all of it), and nothing went from land to sea.
    const bAfter = edited.provinces.find((p) => p.id === B.id);
    expect(bAfter ? bAfter.area : 0).toBeLessThan(B.area * 0.3);
    expect(grownA.kind).toBe('land');
    // Still every province one piece.
    expect([...pieces(edited.label, edited.grid.w, edited.grid.h)].filter(([, c]) => c > 1)).toEqual([]);
    // The edit is kept, and grown again without the cache it comes out the same.
    expect(edited.saved.edits?.length).toBe(1);
    const again = generateProvinces(surface, settings, cl, { sizeMi: SIZE_MI, seaFactor: 3, saved: edited.saved });
    expect(Array.from(again.label)).toEqual(Array.from(edited.label));
    expect(first.provinces.length).toBe(pm.provinces.length);
  }, 60000);
  it('starts mountain provinces at the foot of the range, cuts at cliffs, and gives canyons their own', () => {
    const g = sampleGround(surface, settings, pm.grid);
    const { w } = pm.grid;
    // The foothills belong to the mountain provinces.
    let foot = 0;
    let inRange = 0;
    for (let k = 0; k < g.band.length; k++) {
      if (!g.land[k] || g.band[k] !== 6) continue;
      foot++;
      if (['Mountains', 'Highlands', 'Foothills'].includes(pm.provinces[pm.label[k]].terrain) || pm.provinces[pm.label[k]].kind === 'wasteland') inRange++;
    }
    expect(foot).toBeGreaterThan(10);
    expect(inRange / foot).toBeGreaterThan(0.8);
    // Across a cliff the province changes.
    let across = 0;
    let same = 0;
    for (let k = w; k < g.cliff.length - w; k++) {
      if (!g.cliff[k]) continue;
      // Along the painted cliff, away from its ends (a province may go round the tip of a cliff).
      const x = pm.grid.x0 + (k % w) * pm.grid.px;
      if (x < 2800 || x > 3000) continue;
      for (const [a, b] of [[k - 1, k + 1], [k - w, k + w]]) {
        if (!g.land[a] || !g.land[b] || g.cliff[a] || g.cliff[b] || g.gorge[a] || g.gorge[b]) continue;
        if (pm.provinces[pm.label[a]].kind !== 'land' || pm.provinces[pm.label[b]].kind !== 'land') continue;
        across++;
        if (pm.label[a] === pm.label[b]) {
          same++;
        }
      }
    }
    expect(across).toBeGreaterThan(3);
    expect(same / across).toBeLessThan(0.15);
    // Inside the canyon: provinces of its own, not shared with the land round it.
    expect(pm.provinces.some((p) => p.terrain === 'Canyon')).toBe(true);
    // Even a narrow ravine holds provinces of its own.
    expect(pm.provinces.some((p) => p.terrain === 'Ravine')).toBe(true);
    let gorge = 0;
    let mixed = 0;
    for (let k = 0; k < g.gorge.length; k++) if (g.gorge[k]) {
      gorge++;
      if (!['Canyon', 'Ravine'].includes(pm.provinces[pm.label[k]].terrain)) mixed++;
    }
    expect(mixed / gorge).toBeLessThan(0.1);
    // Ravine and canyon edges are hard: no province holds ground both in and out.
    const leak: string[] = [];
    for (let k = 0; k < g.gorge.length; k++) if (g.land[k] && !g.gorge[k] && !g.lake[k] && ['Canyon', 'Ravine'].includes(pm.provinces[pm.label[k]].terrain)) leak.push(`${k}:c${g.cliff[k]}r${g.river[k]}b${g.band[k]}`);
    expect(leak).toEqual([]);
  });
  it('has its own size for mountain provinces', () => {
    const big = generateProvinces(surface, settings, cl, { sizeMi: SIZE_MI, seaFactor: 3, mountainMi: SIZE_MI * 2 });
    const median = (m: ProvinceMap) => {
      const a = m.provinces.filter((p) => p.kind === 'land' && ['Mountains', 'Highlands', 'Foothills'].includes(p.terrain)).map((p) => p.area).sort((x, y) => x - y);
      return a[Math.floor(a.length / 2)];
    };
    expect(median(big)).toBeGreaterThan(median(pm) * 1.8);
    expect(big.saved.mountainMi).toBe(SIZE_MI * 2);
    // Lowland provinces stay their own size.
    const low = (m: ProvinceMap) => m.provinces.filter((p) => p.terrain === 'Forest').length;
    expect(Math.abs(low(big) - low(pm))).toBeLessThan(low(pm) * 0.2);
  });
  it('gives wide rivers provinces of their own, and sizes rivers, canyons and ravines by their own adjusters', () => {
    const rivers = pm.provinces.filter((p) => p.kind === 'river');
    expect(rivers.length).toBeGreaterThan(1);
    expect(rivers.every((p) => p.terrain === 'River')).toBe(true);
    // The land beside them knows it is on a river.
    expect(pm.provinces.some((p) => p.kind === 'land' && p.river && p.neighbours.some((q) => pm.provinces[q].kind === 'river'))).toBe(true);
    const count = (m: ProvinceMap, t: string) => m.provinces.filter((p) => p.terrain === t).length;
    const bigger = generateProvinces(surface, settings, cl, { sizeMi: SIZE_MI, seaFactor: 3, riverMi: SIZE_MI * 3, canyonMi: SIZE_MI * 3, ravineMi: SIZE_MI * 3 });
    expect(count(bigger, 'River')).toBeLessThan(count(pm, 'River'));
    expect(count(bigger, 'Canyon')).toBeLessThan(count(pm, 'Canyon'));
    expect(count(bigger, 'River')).toBeGreaterThan(0);
    expect(bigger.saved.riverMi).toBe(SIZE_MI * 3);
    // Only rivers at least so wide have provinces.
    const none = generateProvinces(surface, settings, cl, { sizeMi: SIZE_MI, seaFactor: 3, riverMinKm: 9 });
    expect(count(none, 'River')).toBe(0);
  }, 60000);
});
