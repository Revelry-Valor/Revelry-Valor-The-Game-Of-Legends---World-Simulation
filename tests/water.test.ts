import { describe, expect, it } from 'vitest';
import { erodeRelief } from '../src/engine/erosion';
import { applyWater, hollowAt } from '../src/engine/water';
import { TerrainEditor } from '../src/engine/editor';
import { ChunkCarver } from '../src/engine/terrainbuild';

/** Land falling east to the sea, with a bowl in the west and a ridge across the middle. */
function land(w = 60, h = 40) {
  const surface = new Float32Array(w * h);
  const sea = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x >= 52) {
        sea[i] = 1;
        continue;
      }
      const bowl = Math.max(0, 1 - Math.hypot(x - 12, y - 20) / 7) * 0.2;
      const ridge = Math.max(0, 1 - Math.abs(x - 32) / 3) * 0.15;
      surface[i] = 0.05 + (52 - x) * 0.006 - bowl + ridge;
    }
  }
  return { w, h, surface, sea, relief: () => erodeRelief(surface, sea, w, h, { scale: 2, stage: 'layout' }) };
}

describe('water drawn by hand', () => {
  it('fills a hollow to where it spills over, or to a chosen level', () => {
    const L = land();
    const r = L.relief();
    const S = r.scale;
    const cell = Math.round((20 + 0.5) * S - 0.5) * r.width + Math.round((12 + 0.5) * S - 0.5);
    const hollow = hollowAt(r, cell);
    expect(hollow.spill).toBeGreaterThan(r.heights[hollow.bottom] + 0.05);
    const full = applyWater(L.relief(), L.w, L.h, { rivers: [], lakes: [{ x: 12, y: 20, level: 1 }], edits: [] }, 5);
    const half = applyWater(L.relief(), L.w, L.h, { rivers: [], lakes: [{ x: 12, y: 20, level: 0.5 }], edits: [] }, 5);
    const count = (a: Uint8Array) => a.reduce((n, v) => n + v, 0);
    expect(full.lake[20 * L.w + 12]).toBe(1);
    expect(count(full.lake)).toBeGreaterThan(count(half.lake));
    expect(full.lakes[0].level).toBeCloseTo(full.lakes[0].spill, 5);
    // Painted land takes water away; painted water adds it.
    const less = applyWater(L.relief(), L.w, L.h, { rivers: [], lakes: [{ x: 12, y: 20, level: 1 }], edits: [{ x: 12, y: 20, r: 2, add: false }] }, 5);
    expect(less.lake[20 * L.w + 12]).toBe(0);
    const pond = applyWater(L.relief(), L.w, L.h, { rivers: [], lakes: [], edits: [{ x: 40, y: 10, r: 2, add: true }] }, 5);
    expect(pond.lake[10 * L.w + 40]).toBe(1);
  });

  it('runs a river through its points to the sea, cutting through the ridge in its way', () => {
    const L = land();
    const r = L.relief();
    const before = Float32Array.from(r.heights);
    const res = applyWater(r, L.w, L.h, { rivers: [{ points: [[22, 20], [40, 22], [55, 22]] }], lakes: [], edits: [] }, 5);
    const path = res.paths[0];
    expect(path.length).toBeGreaterThan(20);
    // It ends at the sea.
    const ex = path[path.length - 2];
    expect(ex).toBeGreaterThanOrEqual(51);
    // Its bed always falls, so it was cut down through the ridge.
    const S = r.scale;
    let last = Infinity;
    let rises = 0;
    for (let i = 0; i < path.length; i += 2) {
      const c = Math.round((path[i + 1] + 0.5) * S - 0.5) * r.width + Math.round((path[i] + 0.5) * S - 0.5);
      if (r.water[c]) continue;
      if (r.heights[c] > last + 1e-4) rises++;
      last = r.heights[c];
    }
    expect(rises).toBe(0);
    // Where it crosses the ridge's crest, the land has been cut down.
    let cross = -1;
    for (let i = 0; i < path.length; i += 2) if (Math.abs(path[i] - 32) < 0.3) cross = i;
    expect(cross).toBeGreaterThanOrEqual(0);
    const ridgeCell = Math.round((path[cross + 1] + 0.5) * S - 0.5) * r.width + Math.round((path[cross] + 0.5) * S - 0.5);
    expect(r.heights[ridgeCell]).toBeLessThan(before[ridgeCell] - 0.05);
    // The tiles it runs through are river tiles.
    expect(res.river.some((v) => v > 0)).toBe(true);
  });

  it('a river ending at another becomes its tributary and makes it bigger downstream', () => {
    const L = land();
    const res = applyWater(L.relief(), L.w, L.h, {
      rivers: [
        { points: [[40, 8], [45, 20], [55, 20]] },
        { points: [[40, 32], [45.5, 20.5]] },
      ],
      lakes: [],
      edits: [],
    }, 5);
    // The second river joins the first rather than wandering on.
    const p = res.paths[1];
    const ex = p[p.length - 2];
    const ey = p[p.length - 1];
    const main = res.paths[0];
    let near = Infinity;
    for (let i = 0; i < main.length; i += 2) near = Math.min(near, Math.hypot(main[i] - ex, main[i + 1] - ey));
    expect(near).toBeLessThan(1);
  });
});

describe('land and sea brushes', () => {
  it('paint land, sea, shallows and deeps, and keep to the height limit', () => {
    const w = 60;
    const h = 40;
    const hts = new Float32Array(w * h).fill(-0.12);
    const ed = new TerrainEditor(hts, w, h, 1);
    ed.dab(20, 20, { tool: 'land', radius: 6, strength: 1, roughness: 0 });
    expect(hts[20 * w + 20]).toBeGreaterThan(0);
    ed.dab(45, 20, { tool: 'shallows', radius: 4, strength: 1, roughness: 0 });
    expect(hts[20 * w + 45]).toBeGreaterThan(-0.05);
    expect(hts[20 * w + 45]).toBeLessThan(0);
    for (let k = 0; k < 6; k++) ed.dab(10, 5, { tool: 'deep', radius: 4, strength: 1, roughness: 0 });
    expect(hts[5 * w + 10]).toBeLessThan(-0.3);
    for (let k = 0; k < 40; k++) ed.dab(20, 20, { tool: 'mountains', radius: 4, strength: 1, top: 0.3 });
    expect(Math.max(...hts)).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(hts[20 * w + 20]).toBeGreaterThan(0.25);
    ed.dab(20, 20, { tool: 'sea', radius: 2, strength: 1, roughness: 0 });
    expect(hts[20 * w + 20]).toBeLessThan(0);
  });
});

describe('carving piece by piece', () => {
  it('carves again only where the land changed, leaving the rest exactly as it was', () => {
    const w = 90;
    const h = 60;
    const surface = new Float32Array(w * h);
    const sea = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 45, y - 30);
      if (d > 26) sea[y * w + x] = 1;
      else surface[y * w + x] = 0.4 * (1 - d / 26);
    }
    const a = new ChunkCarver(w, h, { scale: 2, seed: 3 });
    a.carve(surface, sea);
    const before = Float32Array.from(a.field.heights);
    // Change a little land.
    const dirty = { x0: 30, y0: 22, x1: 35, y1: 27 };
    for (let y = dirty.y0; y <= dirty.y1; y++) for (let x = dirty.x0; x <= dirty.x1; x++) surface[y * w + x] += 0.1;
    a.carve(surface, sea, dirty);
    // The change is there...
    let rise = 0;
    let cells = 0;
    for (let Y = dirty.y0 * 2; Y < (dirty.y1 + 1) * 2; Y++) for (let X = dirty.x0 * 2; X < (dirty.x1 + 1) * 2; X++) {
      rise += a.field.heights[Y * a.field.width + X] - before[Y * a.field.width + X];
      cells++;
    }
    expect(rise / cells).toBeGreaterThan(0.008);
    // ...and nothing more than a few tiles from it moved at all.
    for (let Y = 0; Y < a.field.height; Y++) {
      for (let X = 0; X < a.field.width; X++) {
        const tx = (X + 0.5) / 2;
        const ty = (Y + 0.5) / 2;
        const out = tx < dirty.x0 - 3 || tx > dirty.x1 + 4 || ty < dirty.y0 - 3 || ty > dirty.y1 + 4;
        if (out) expect(a.field.heights[Y * a.field.width + X]).toBe(before[Y * a.field.width + X]);
      }
    }
    expect(a.changed).toEqual({ x0: dirty.x0 - 3, y0: dirty.y0 - 3, x1: dirty.x1 + 3, y1: dirty.y1 + 3 });
  });
});

describe('the terrain tools', () => {
  it('shape only the land, never the coast or the sea', () => {
    const w = 60;
    const h = 40;
    const hts = new Float32Array(w * h).fill(-0.12);
    const ed = new TerrainEditor(hts, w, h, 1);
    ed.dab(30, 20, { tool: 'land', radius: 8, strength: 1, roughness: 0 });
    const coast = hts.map((v) => (v >= 0 ? 1 : 0));
    for (const tool of ['mountains', 'hills', 'raise', 'lower', 'valley', 'plateau', 'cliff', 'smooth'] as const) {
      for (let k = 0; k < 10; k++) ed.line(18, 20, 42, 21, { tool, radius: 9, strength: 1, top: 0.6, floor: 0, level: 0.3 });
    }
    expect(Array.from(hts.map((v) => (v >= 0 ? 1 : 0)))).toEqual(Array.from(coast));
    expect(hts[2 * w + 2]).toBeCloseTo(-0.12, 5);
  });
});
