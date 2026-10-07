import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/engine/config';
import { TerrainEditor, strokeLevel } from '../src/engine/editor';
import { erodeRelief, traceRivers } from '../src/engine/erosion';
import { Rng } from '../src/engine/rng';
import { decodeHeights, encodeHeights, generateMap } from '../src/engine/worldgen';
import { World } from '../src/engine/world';

const W = 180;
const H = 110;

/** Two rectangular continents in an open ocean. */
function boxWorld(): Float32Array {
  const hts = new Float32Array(W * H).fill(-0.3);
  for (let y = 15; y < 95; y++) for (let x = 40; x < 90; x++) hts[y * W + x] = 0.1;
  for (let y = 25; y < 85; y++) for (let x = 120; x < 150; x++) hts[y * W + x] = 0.1;
  return hts;
}

const mapOf = (over: Parameters<typeof defaultConfig>[0]) => {
  const cfg = defaultConfig({ seed: 3, width: W, height: H, ...over });
  return generateMap(cfg, new Rng(cfg.seed).fork('map'));
};

describe('world building', () => {
  it('saves hand-shaped land as a code and reads it back, resampling to other map sizes', () => {
    const hts = boxWorld();
    const code = encodeHeights(hts, W, H);
    const back = decodeHeights(code, W, H)!;
    for (let i = 0; i < hts.length; i++) expect(Math.abs(back[i] - hts[i])).toBeLessThan(1e-4);
    const small = decodeHeights(code, 90, 55)!;
    expect(small.length).toBe(90 * 55);
    expect(small[27 * 90 + 30]).toBeGreaterThan(0); // inside the first continent
    expect(small[5 * 90 + 5]).toBeLessThan(0);
    expect(decodeHeights('nonsense', W, H)).toBeNull();
  });

  it('builds the world on the hand-shaped land', () => {
    const m = mapOf({ heightmap: encodeHeights(boxWorld(), W, H) });
    let wrong = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = (y >= 15 && y < 95 && x >= 40 && x < 90) || (y >= 25 && y < 85 && x >= 120 && x < 150);
        const i = y * W + x;
        // Lakes may form in hollows; otherwise land is exactly where it was painted.
        if (inside !== (m.heights[i] >= 0)) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  it('places the map on the globe by the latitudes of its edges', () => {
    const tropics = mapOf({ latNorth: 25, latSouth: -25 });
    expect(tropics.latitude[0]).toBeLessThanOrEqual(25);
    expect(tropics.latitude[H - 1]).toBeGreaterThanOrEqual(-25);
    const whole = mapOf({});
    const meanT = (m: typeof whole) => m.temperature.reduce((a, b) => a + b, 0) / m.size;
    expect(meanT(tropics)).toBeGreaterThan(meanT(whole) + 0.15);
    // A northern map runs from cold at the top to warm at the bottom.
    const north = mapOf({ latNorth: 80, latSouth: 20 });
    const rowT = (m: typeof whole, y: number) => {
      let s = 0;
      for (let x = 0; x < W; x++) s += m.temperature[y * W + x];
      return s / W;
    };
    expect(rowT(north, 5)).toBeLessThan(rowT(north, H - 5) - 0.3);
  });

  it('sends warm currents poleward along eastern coasts and cold ones towards the equator along western coasts', () => {
    const m = mapOf({ heightmap: encodeHeights(boxWorld(), W, H) });
    const rowOf = (lat: number) => {
      let best = 0;
      for (let y = 0; y < H; y++) if (Math.abs(m.latitude[y] - lat) < Math.abs(m.latitude[best] - lat)) best = y;
      return best;
    };
    const mean = (x0: number, x1: number, lat0: number, lat1: number) => {
      let s = 0;
      let n = 0;
      for (let y = Math.min(rowOf(lat0), rowOf(lat1)); y <= Math.max(rowOf(lat0), rowOf(lat1)); y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          if (m.elevation[i] < 0) {
            s += m.seaAnomaly[i];
            n++;
          }
        }
      }
      return s / n;
    };
    // East coast of the first continent, 25-40°N: the warm western boundary current.
    expect(mean(90, 95, 25, 40)).toBeGreaterThan(0.02);
    // West coast of the second continent, 15-30°N: the cold current running south.
    expect(mean(114, 119, 15, 30)).toBeLessThan(-0.02);
    // Turned off, the sea keeps the temperature of its latitude.
    const calm = mapOf({ heightmap: encodeHeights(boxWorld(), W, H), oceanCurrents: false });
    expect(calm.seaAnomaly.every((v) => v === 0)).toBe(true);
  });

  it('raises land and ranges, lowers it again, flattens plateaus, and undoes strokes', () => {
    const hts = new Float32Array(W * H).fill(-0.2);
    const ed = new TerrainEditor(hts, W, H, 1);
    const raise = { tool: 'raise' as const, radius: 8, strength: 1 };
    ed.beginStroke();
    for (let k = 0; k < 2; k++) ed.line(60, 50, 100, 50, raise);
    expect(hts[50 * W + 80]).toBeGreaterThanOrEqual(0);
    expect(hts[10 * W + 10]).toBeLessThan(0);
    // The middle of the stroke rises most: a range is highest along its spine.
    expect(hts[50 * W + 80]).toBeGreaterThan(hts[55 * W + 80]);
    ed.beginStroke();
    for (let k = 0; k < 12; k++) ed.dab(80, 50, { tool: 'lower', radius: 3, strength: 1, floor: -1 });
    expect(hts[50 * W + 80]).toBeLessThan(0);
    ed.undoStroke();
    expect(hts[50 * W + 80]).toBeGreaterThanOrEqual(0);
    // A narrow brush makes a narrower rise than a wide one.
    ed.beginStroke();
    for (let k = 0; k < 4; k++) ed.dab(30, 20, { tool: 'raise', radius: 2, strength: 1 });
    expect(hts[20 * W + 30]).toBeGreaterThan(-0.1);
    expect(hts[20 * W + 34]).toBeCloseTo(-0.2, 5);
    ed.beginStroke();
    for (let k = 0; k < 6; k++) ed.dab(70, 50, raise);
    const level = strokeLevel('plateau', ed.heightAt(70, 50))!;
    expect(strokeLevel('raise', 0.5)).toBeUndefined();
    for (let k = 0; k < 5; k++) ed.dab(70, 50, { tool: 'plateau', radius: 4, strength: 1, level });
    // However often the tool passes, the top settles level: a plateau.
    expect(hts[50 * W + 70]).toBeCloseTo(level, 2);
    expect(hts[50 * W + 69]).toBeCloseTo(level, 2);
  });

  it('carves a range into ridges and valleys, leaving the water alone', () => {
    // A ridge running east-west, with sea all round.
    const w = 40;
    const h = 30;
    const surface = new Float32Array(w * h);
    const water = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const land = x > 3 && x < w - 4 && y > 3 && y < h - 4;
        water[i] = land ? 0 : 1;
        surface[i] = land ? Math.max(0.01, 0.7 - Math.abs(y - h / 2) * 0.07) : 0;
      }
    }
    const a = erodeRelief(surface, water, w, h, { scale: 3, seed: 2 });
    const b = erodeRelief(surface, water, w, h, { scale: 3, seed: 2 });
    expect(a.width).toBe(w * 3);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    // The sea is untouched and the land stays above it.
    expect(a.heights[0]).toBe(0);
    let lowest = Infinity;
    for (let Y = 15; Y < 75; Y++) for (let X = 15; X < 105; X++) lowest = Math.min(lowest, a.heights[Y * a.width + X]);
    expect(lowest).toBeGreaterThan(0);
    // Along the flank, valleys have been cut between spurs: the height across it is no longer even.
    const row = 45 + 12;
    let lo = Infinity;
    let hi = -Infinity;
    for (let X = 20; X < 100; X++) {
      lo = Math.min(lo, a.heights[row * a.width + X]);
      hi = Math.max(hi, a.heights[row * a.width + X]);
    }
    expect(hi - lo).toBeGreaterThan(0.05);
    // It leaves the maps a landscape is coloured by: worn ground, settled soil and running water.
    const some = (m: Float32Array) => m.some((v) => v > 0.3);
    expect(some(a.wear) && some(a.deposits) && some(a.flow)).toBe(true);
    for (const m of [a.wear, a.deposits, a.flow]) expect(m.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(a.wear[0] + a.deposits[0] + a.flow[0]).toBe(0);
  });

  it('builds the terrain in stages, each adding to the last', () => {
    const w = 40;
    const h = 30;
    const surface = new Float32Array(w * h);
    const water = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const land = x > 3 && x < w - 4 && y > 3 && y < h - 4;
        water[y * w + x] = land ? 0 : 1;
        surface[y * w + x] = land ? Math.max(0.01, 0.7 - Math.abs(y - h / 2) * 0.07) : 0;
      }
    }
    const rough = (r: { heights: Float32Array; width: number }) => {
      let g = 0;
      for (let i = 1; i < r.heights.length - 1; i++) g += Math.abs(r.heights[i + 1] - r.heights[i]);
      return g;
    };
    const layout = erodeRelief(surface, water, w, h, { scale: 3, stage: 'layout' });
    const shaped = erodeRelief(surface, water, w, h, { scale: 3, stage: 'mountains' });
    // The mountain shapes make the smooth heightmap far more rugged; with none asked for, nothing changes.
    expect(rough(shaped)).toBeGreaterThan(rough(layout) * 1.3);
    expect(Array.from(erodeRelief(surface, water, w, h, { scale: 3, stage: 'mountains', mountains: 0 }).heights)).toEqual(Array.from(layout.heights));
  });

  it('runs rivers down the carved valleys, and the world lives by those rivers', () => {
    const map = mapOf({ seed: 3 });
    expect(map.carved).toBeDefined();
    const curves = map.riverCurves!;
    expect(curves.length).toBeGreaterThan(0);
    expect(curves.length % 7).toBe(0);
    let land = 0;
    let wet = 0;
    for (let i = 0; i < map.size; i++) {
      if (map.elevation[i] < 0) {
        expect(map.river[i]).toBe(0);
        continue;
      }
      land++;
      if (map.river[i] > 0) wet++;
    }
    // About as much of the land lies on a river as a map-maker would draw.
    expect(wet / land).toBeGreaterThan(0.02);
    expect(wet / land).toBeLessThan(0.15);
    // Every river runs on the map, and the carved land under its course is low ground: the
    // river sits in its valley, below the land on either side.
    const c = map.carved!;
    let lower = 0;
    let total = 0;
    for (let k = 0; k < curves.length; k += 7) {
      for (const v of [curves[k], curves[k + 2], curves[k + 4]]) expect(v).toBeGreaterThanOrEqual(-0.5);
      const x = Math.round((curves[k + 2] + 0.5) * c.scale - 0.5);
      const y = Math.round((curves[k + 3] + 0.5) * c.scale - 0.5);
      if (x < 3 || y < 3 || x >= c.width - 3 || y >= c.height - 3) continue;
      const at = (xx: number, yy: number) => c.heights[yy * c.width + xx];
      const around = (at(x + 3, y) + at(x - 3, y) + at(x, y + 3) + at(x, y - 3)) / 4;
      total++;
      if (at(x, y) <= around) lower++;
    }
    expect(lower / total).toBeGreaterThan(0.8);
  });

  it('makes rivers as Gaea does: more water more rivers, and a river from every painted source', () => {
    const wet = (m: ReturnType<typeof mapOf>) => {
      let n = 0;
      for (let i = 0; i < m.size; i++) if (m.river[i] > 0) n++;
      return n;
    };
    const none = mapOf({ seed: 3, terrain: { riverWater: 0 } });
    expect(wet(none)).toBe(0);
    const few = mapOf({ seed: 3, terrain: { riverWater: 0.5 } });
    const many = mapOf({ seed: 3, terrain: { riverWater: 1.5 } });
    expect(wet(many)).toBeGreaterThan(wet(few));
    // A river source on high land, with no other rivers: a river runs from it.
    let best = -1;
    for (let i = 0; i < none.size; i++) if (none.elevation[i] > 0.3 && (best < 0 || none.elevation[i] > none.elevation[best])) best = i;
    expect(best).toBeGreaterThanOrEqual(0);
    const sx = best % none.width;
    const sy = Math.floor(best / none.width);
    const one = mapOf({ seed: 3, terrain: { riverWater: 0 }, riverSources: [[sx, sy]] });
    expect(one.river[sy * one.width + sx]).toBeGreaterThan(0);
    expect(wet(one)).toBeGreaterThan(3);
  });

  it('fills wet basins into lakes that spill out in a river, and leaves dry ones without an outlet', () => {
    // Land falling east to the sea, with a deep bowl in the west.
    const w = 40;
    const h = 30;
    const surface = new Float32Array(w * h);
    const sea = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x >= 34) {
          sea[i] = 1;
          continue;
        }
        const bowl = Math.max(0, 1 - Math.hypot(x - 10, y - 15) / 7) * 0.25;
        surface[i] = 0.05 + (34 - x) * 0.012 + Math.abs(y - 15) * 0.006 - bowl;
      }
    }
    const lakeFlow = (wetness: number) => {
      const relief = erodeRelief(surface, sea, w, h, { scale: 2, stage: 'layout' });
      const moist = new Float32Array(w * h).fill(wetness);
      const rain = moist.map((m) => 0.05 + m);
      return traceRivers(relief, rain, moist, w, h, 6, 1);
    };
    const wet = lakeFlow(0.9);
    expect(wet.lake[15 * w + 10]).toBe(1);
    // A river runs on from the lake, all the way down to the coast.
    let downstream = 0;
    for (let x = 18; x < 34; x++) for (let y = 0; y < h; y++) if (wet.river[y * w + x] > 0) downstream++;
    expect(downstream).toBeGreaterThan(8);
    expect(wet.river[15 * w + 33] + wet.river[14 * w + 33] + wet.river[16 * w + 33]).toBeGreaterThan(0);
    // In a desert the bowl keeps its water: a smaller lake or a salt flat, and no river out.
    const dry = lakeFlow(0.05);
    let lakeWet = 0;
    let lakeDry = 0;
    for (let i = 0; i < w * h; i++) {
      lakeWet += wet.lake[i];
      lakeDry += dry.lake[i];
    }
    expect(lakeDry).toBeLessThan(lakeWet);
    // Just past the bowl's rim the wet land has its lake's river; the dry land has none.
    const rim = (r: Float32Array) => {
      let v = 0;
      for (let y = 12; y <= 18; y++) for (let x = 17; x <= 19; x++) v += r[y * w + x];
      return v;
    };
    expect(rim(wet.river)).toBeGreaterThan(0);
    expect(rim(dry.river)).toBe(0);
  });

  it('runs a history on hand-shaped land', () => {
    const world = new World(defaultConfig({ seed: 5, width: W, height: H, heightmap: encodeHeights(boxWorld(), W, H) }));
    for (let y = 0; y < 40; y++) world.tick();
    expect(world.settlements.length + world.bands.length).toBeGreaterThan(0);
    for (const s of world.settlements) expect(world.map.elevation[s.tile]).toBeGreaterThanOrEqual(0);
  });
});
