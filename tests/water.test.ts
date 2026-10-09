import { describe, expect, it } from 'vitest';
import { erodeRelief } from '../src/engine/erosion';
import { applyWater, hollowAt } from '../src/engine/water';
import { TerrainEditor } from '../src/engine/editor';
import { ChunkCarver } from '../src/engine/terrainbuild';
import { carveScale, decodeRelief, encodeHeights, encodeRelief, generateMap } from '../src/engine/worldgen';
import { defaultConfig } from '../src/engine/config';
import { Rng } from '../src/engine/rng';

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
    const tilesBefore = Float32Array.from(hts);
    // Each stroke over a peak builds it higher, never past the height limit.
    for (let k = 0; k < 40; k++) {
      ed.beginStroke();
      ed.dab(20, 20, { tool: 'mountains', radius: 4, strength: 1, top: 0.3 });
    }
    let top = 0;
    for (let y = 14; y < 26; y += 0.25) for (let x = 14; x < 26; x += 0.25) top = Math.max(top, ed.heightAt(x, y));
    expect(top).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(top).toBeGreaterThan(0.25);
    // The Terrain tools shape the fine grid on top of the outline; the outline's tiles are untouched.
    expect(Array.from(hts)).toEqual(Array.from(tilesBefore));
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
    a.carve(surface, sea, null, dirty);
    // The change is there...
    let rise = 0;
    let cells = 0;
    for (let Y = dirty.y0 * 2; Y < (dirty.y1 + 1) * 2; Y++) for (let X = dirty.x0 * 2; X < (dirty.x1 + 1) * 2; X++) {
      rise += a.field.heights[Y * a.field.width + X] - before[Y * a.field.width + X];
      cells++;
    }
    expect(rise / cells).toBeGreaterThan(0.008);
    // ...and only where the land laid out from the changed tiles changed (they reach 2 tiles out).
    let moved = 0;
    for (let Y = 0; Y < a.field.height; Y++) {
      for (let X = 0; X < a.field.width; X++) {
        const tx = (X + 0.5) / 2;
        const ty = (Y + 0.5) / 2;
        const out = tx < dirty.x0 - 2 || tx > dirty.x1 + 3 || ty < dirty.y0 - 2 || ty > dirty.y1 + 3;
        if (out) expect(a.field.heights[Y * a.field.width + X]).toBe(before[Y * a.field.width + X]);
        else if (a.field.heights[Y * a.field.width + X] !== before[Y * a.field.width + X]) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('shows a stroke as drawn while it is drawn, and wears it with water only on the cells it touched', () => {
    const w = 60;
    const h = 40;
    const S = 2;
    const surface = new Float32Array(w * h).fill(0.02);
    const sea = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) sea[x] = sea[(h - 1) * w + x] = 1;
    const a = new ChunkCarver(w, h, { scale: S, seed: 5 });
    const relief = new Float32Array(w * S * h * S);
    a.carve(surface, sea, relief);
    const before = Float32Array.from(a.field.heights);
    // A round hill drawn on the fine grid: radius 3 tiles around (30, 20).
    const inside = (X: number, Y: number) => Math.hypot((X + 0.5) / S - 30, (Y + 0.5) / S - 20) < 3;
    for (let Y = 0; Y < h * S; Y++) for (let X = 0; X < w * S; X++) if (inside(X, Y)) relief[Y * w * S + X] = 0.15 * (1 - Math.hypot((X + 0.5) / S - 30, (Y + 0.5) / S - 20) / 3);
    const box = { x0: 27, y0: 17, x1: 33, y1: 23 };
    a.carve(surface, sea, relief, box, false);
    const shown = Float32Array.from(a.field.heights);
    a.carve(surface, sea, relief, box, true);
    let changedOutside = 0;
    let worn = 0;
    for (let Y = 0; Y < h * S; Y++) {
      for (let X = 0; X < w * S; X++) {
        const i = Y * w * S + X;
        if (!inside(X, Y)) {
          if (a.field.heights[i] !== before[i] || shown[i] !== before[i]) changedOutside++;
        } else if (Math.abs(a.field.heights[i] - shown[i]) > 1e-4) worn++;
      }
    }
    // Shown as drawn at once (the hill is up)...
    expect(shown[20 * S * w * S + 30 * S] - before[20 * S * w * S + 30 * S]).toBeGreaterThan(0.1);
    // ...worn by water once finished, and nothing outside the hill changed at either step.
    expect(worn).toBeGreaterThan(0);
    expect(changedOutside).toBe(0);
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
    ed.beginStroke();
    ed.ramp(10, 20, 50, 20, { tool: 'smooth', radius: 12, strength: 1 }, null);
    expect(Array.from(hts.map((v) => (v >= 0 ? 1 : 0)))).toEqual(Array.from(coast));
    expect(hts[2 * w + 2]).toBeCloseTo(-0.12, 5);
    // The land stays above the sea everywhere the tools went.
    for (let y = 10; y < 30; y += 0.25) for (let x = 20; x < 40; x += 0.25) if (hts[Math.floor(y) * w + Math.floor(x)] >= 0) expect(ed.heightAt(x, y)).toBeGreaterThan(0);
  });
});

describe('the hills sponge', () => {
  it('roughs up the land it passes over: lumps and hollows, not one rise', () => {
    const w = 60;
    const h = 40;
    const hts = new Float32Array(w * h).fill(0.1);
    const ed = new TerrainEditor(hts, w, h, 3);
    for (let k = 0; k < 4; k++) ed.line(10, 20, 50, 20, { tool: 'hills', radius: 8, strength: 0.6, top: 1 });
    const row: number[] = [];
    for (let x = 14; x < 46; x++) row.push(ed.heightAt(x + 0.5, 20.5));
    const lo = Math.min(...row);
    const hi = Math.max(...row);
    expect(hi).toBeGreaterThan(0.13);
    expect(lo).toBeLessThan(0.1);
    // Bumpy: the ground turns up and down several times along the stroke.
    let turns = 0;
    for (let i = 2; i < row.length; i++) if ((row[i] - row[i - 1]) * (row[i - 1] - row[i - 2]) < 0) turns++;
    expect(turns).toBeGreaterThanOrEqual(4);
    // Outside the brush, nothing changed.
    expect(ed.heightAt(30.5, 2.5)).toBeCloseTo(0.1, 6);
    // Only inside the brush: just past its edge, the land is as it was.
    expect(ed.heightAt(30.5, 20 + 8.2)).toBeCloseTo(0.1, 6);
  });
});

describe('the smooth drag', () => {
  it('lays an even slope from where it began to where it ends, and follows the pen', () => {
    const w = 60;
    const h = 40;
    const hts = new Float32Array(w * h);
    // A bumpy rise from 0.05 at the left to 0.45 at the right.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hts[y * w + x] = 0.05 + (0.4 * x) / (w - 1) + 0.06 * Math.sin(x * 1.3) * Math.cos(y * 0.9);
    const ed = new TerrainEditor(hts, w, h, 1);
    ed.beginStroke();
    const at = (x: number, y: number) => ed.heightAt(x, y);
    const off = at(23.1, 10.1);
    const a = at(10.5, 20.5);
    const b = at(50.5, 20.5);
    const far = at(30.1, 35.1);
    // First the pen goes one way, then ends somewhere else: the first slope is put back.
    let box = ed.ramp(10.5, 20.5, 30.5, 5.5, { tool: 'smooth', radius: 4, strength: 1 }, null);
    box = ed.ramp(10.5, 20.5, 50.5, 20.5, { tool: 'smooth', radius: 4, strength: 1 }, box);
    expect(at(23.1, 10.1)).toBeCloseTo(off, 6);
    for (let x = 12.5; x <= 48.5; x += 4) expect(at(x, 20.5)).toBeCloseTo(a + ((b - a) * (x - 10.5)) / 40, 2);
    // Away from the line, untouched.
    expect(at(30.1, 35.1)).toBeCloseTo(far, 6);
    expect(box.x1).toBeGreaterThanOrEqual(50);
  });
});

describe('the mountains ridge', () => {
  it('raises a crest along the stroke, as narrow as the brush, and nothing outside it', () => {
    const w = 60;
    const h = 40;
    const hts = new Float32Array(w * h).fill(0.02);
    const ed = new TerrainEditor(hts, w, h, 4);
    ed.beginStroke();
    ed.line(15, 20, 45, 20, { tool: 'mountains', radius: 2, strength: 0.6, top: 1 });
    // High along the crest, all the way along...
    for (let x = 18; x <= 42; x += 3) expect(ed.heightAt(x, 20.1)).toBeGreaterThan(0.06);
    // ...falling away down its flanks...
    for (let x = 18; x <= 42; x += 3) expect(ed.heightAt(x, 21.5)).toBeLessThan(ed.heightAt(x, 20.1));
    // ...and nothing beyond the brush's reach (2 tiles) changed at all.
    for (let x = 10; x < 50; x += 0.5) {
      expect(ed.heightAt(x, 22.3)).toBeCloseTo(0.02, 6);
      expect(ed.heightAt(x, 17.7)).toBeCloseTo(0.02, 6);
    }
    expect(ed.heightAt(12.6, 20.1)).toBeCloseTo(0.02, 6);
    // Going back over it in the same stroke doesn't pile it up; a new stroke builds it higher.
    // (one pass at this strength rises at most about 0.12 above the land).
    for (let k = 0; k < 3; k++) ed.line(45, 20, 15, 20, { tool: 'mountains', radius: 2, strength: 0.6, top: 1 });
    const once = ed.heightAt(30, 20.1);
    expect(once).toBeLessThan(0.02 + 0.13);
    ed.beginStroke();
    ed.line(15, 20, 45, 20, { tool: 'mountains', radius: 2, strength: 0.6, top: 1 });
    expect(ed.heightAt(30, 20.1)).toBeGreaterThan(once + 0.03);
  });

  it('is kept with the world, and the world stands as high as the land shaped on it', () => {
    const W = 120;
    const H = 80;
    const S = 4;
    const relief = new Float32Array(W * H);
    for (let i = 0; i < relief.length; i += 37) relief[i] = ((i % 200) - 100) / 400;
    const back = decodeRelief(encodeRelief(relief, W, H), W, H)!;
    for (let i = 0; i < relief.length; i++) expect(back[i]).toBeCloseTo(relief[i], 4);
    expect(decodeRelief(encodeRelief(relief, W, H), W + 1, H)).toBeNull();
    // A world of flat land, with a block raised by hand on the fine grid.
    const w = 30;
    const h = 20;
    const tiles = new Float32Array(w * h).fill(0.02);
    for (let x = 0; x < w; x++) tiles[x] = tiles[(h - 1) * w + x] = -0.1;
    const fine = new Float32Array(w * S * h * S);
    for (let Y = 8 * S; Y < 12 * S; Y++) for (let X = 10 * S; X < 14 * S; X++) fine[Y * w * S + X] = 0.3;
    const cfg = defaultConfig({ seed: 2, width: w, height: h, heightmap: encodeHeights(tiles, w, h), relief: encodeRelief(fine, w * S, h * S) });
    expect(carveScale(w, h)).toBe(S);
    const map = generateMap(cfg, new Rng(2).fork('map'));
    expect(map.elevation[10 * w + 12]).toBeGreaterThan(0.25);
    expect(map.elevation[3 * w + 3]).toBeLessThan(0.1);
  });
});
