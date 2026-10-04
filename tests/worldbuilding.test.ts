import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/engine/config';
import { TerrainEditor, strokeLevel } from '../src/engine/editor';
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
    for (let k = 0; k < 6; k++) ed.dab(80, 50, { tool: 'lower', radius: 3, strength: 1 });
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
    const level = strokeLevel('flatten', ed.heightAt(70, 50))!;
    expect(strokeLevel('raise', 0.5)).toBeUndefined();
    for (let k = 0; k < 5; k++) ed.dab(70, 50, { tool: 'flatten', radius: 4, strength: 1, level });
    // However often the tool passes, the top settles level: a plateau.
    expect(hts[50 * W + 70]).toBeCloseTo(level, 2);
    expect(hts[50 * W + 69]).toBeCloseTo(level, 2);
  });

  it('runs a history on hand-shaped land', () => {
    const world = new World(defaultConfig({ seed: 5, width: W, height: H, heightmap: encodeHeights(boxWorld(), W, H) }));
    for (let y = 0; y < 40; y++) world.tick();
    expect(world.settlements.length + world.bands.length).toBeGreaterThan(0);
    for (const s of world.settlements) expect(world.map.elevation[s.tile]).toBeGreaterThanOrEqual(0);
  });
});
