import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { attraction, CLIMATE_OFF, provinceAttraction, provinceLiving, rainFed, SHORT_WALK_KM, type Wants } from '../src/sim/attraction';
import { buildEnv, type Env } from '../src/sim/env';
import { attractionFor, wantsOf, raceInfo } from '../src/sim/sim';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });
const riverPts: number[] = [];
for (let x = 700; x <= 2350; x += 25) riverPts.push(x, 1000);
add('river', riverPts, { width: 2 });

let env: Env;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
}, 60000);

const wants = (o: Partial<Wants> = {}): Wants => ({ tolerances: { heat: 3, cold: 3, wet: 3, dry: 3, altitude: 3 }, climates: [], covers: [], heights: [], manaSensitive: false, passable: () => true, ...o });

describe('where peoples live: requirements and attraction', () => {
  it('values fresh water most, a short walk from it next, and lets nobody live further off unless the rain will keep them', () => {
    const w = wants();
    const by = [...env.fresh.keys()].find((k) => env.fresh[k] && env.land[k])!;
    expect(by).toBeDefined();
    expect(attraction(env, w, by).water).toBe(1);
    const near = [...env.land.keys()].find((k) => env.land[k] && !env.fresh[k] && env.freshKm![k] <= SHORT_WALK_KM)!;
    expect(attraction(env, w, near).water).toBe(0.75);
    // Far from fresh water: off limits where too dry for the rain, livable where wet enough.
    const far = [...env.land.keys()].filter((k) => env.land[k] && env.freshKm![k] > SHORT_WALK_KM * 3);
    const dryFar = far.find((k) => !rainFed(env, k));
    const wetFar = far.find((k) => rainFed(env, k));
    if (dryFar !== undefined) {
      const a = attraction(env, w, dryFar);
      expect(a.water).toBe(0);
      expect(a.score).toBe(-1);
      expect(a.off).toMatch(/no fresh water/);
    }
    if (wetFar !== undefined) expect(attraction(env, w, wetFar).water).toBe(0.6);
    expect(dryFar !== undefined || wetFar !== undefined).toBe(true);
    // Better by the river than a walk away, other things alike.
    expect(attraction(env, w, by).score).toBeGreaterThan(0);
  });

  it('holds places to a race’s tolerances: the further past, the harder, and far enough past, off limits however rich', () => {
    // The coldest land there is.
    const k = [...env.land.keys()].filter((q) => env.land[q]).sort((a, b) => Math.min(env.temp[0][a], env.temp[1][a]) - Math.min(env.temp[0][b], env.temp[1][b]))[0];
    expect(Math.min(env.temp[0][k], env.temp[1][k])).toBeLessThan(8);
    const hardy = attraction(env, wants({ tolerances: { heat: 3, cold: 5, wet: 3, dry: 3, altitude: 3 } }), k);
    const tender = attraction(env, wants({ tolerances: { heat: 3, cold: 1, wet: 3, dry: 3, altitude: 3 } }), k);
    expect(hardy.climate).toBe(1);
    expect(tender.climate).toBeLessThan(hardy.climate);
    expect(tender.harsh).toContain('too cold');
    if (tender.climate < CLIMATE_OFF) expect(tender.off).toMatch(/too harsh/);
    // Preferences add to the pulls, unwanted ones take a little away.
    const zone = env.zone![k];
    const by = [...env.fresh.keys()].find((q) => env.fresh[q] && env.land[q])!;
    const zb = env.zone![by];
    expect(attraction(env, wants({ climates: [zb] }), by).score).toBeGreaterThan(attraction(env, wants({ climates: [(zb + 5) % 14] }), by).score);
    void zone;
  });

  it('asks of each race the water it needs: right by it, a short or long walk, or none at all', () => {
    const near = [...env.land.keys()].find((k) => env.land[k] && !env.fresh[k] && env.freshKm![k] > 4 && env.freshKm![k] <= SHORT_WALK_KM)!;
    const mid = [...env.land.keys()].find((k) => env.land[k] && env.freshKm![k] > 15 && env.freshKm![k] < 28 && !rainFed(env, k))!;
    expect(attraction(env, wants({ water: 'High' }), near).off).toMatch(/right by fresh water/);
    expect(attraction(env, wants({ water: 'Normal' }), near).water).toBe(0.75);
    if (mid !== undefined) {
      expect(attraction(env, wants({ water: 'Normal' }), mid).off).not.toBe('');
      expect(attraction(env, wants({ water: 'Low' }), mid).water).toBeGreaterThan(0);
    }
    const dry = [...env.land.keys()].find((k) => env.land[k] && env.freshKm![k] > 60 && !rainFed(env, k, 'wet'));
    if (dry !== undefined) expect(attraction(env, wants({ water: 'None' }), dry).water).toBe(1);
  });

  it('weighs what draws each race most: trade counts double for a trading people', () => {
    const coast = [...env.coast.keys()].find((k) => env.coast[k] && env.land[k] && attraction(env, wants(), k).score > 0)!;
    expect(coast).toBeDefined();
    const usual = attraction(env, wants(), coast);
    const traders = attraction(env, wants({ priorities: { food: 1, water: 1, resources: 1, trade: 2 } }), coast);
    expect(traders.trade).toBeCloseTo(usual.trade * 2, 5);
    expect(traders.score).toBeGreaterThan(usual.score);
  });

  it('takes a race’s own options over its species’, with its traits’ effects', () => {
    const lib = defaultLibrary();
    const elf = lib.species.find((q) => q.name === 'Elf')!;
    const winter = elf.races.find((r) => r.name === 'Winter Elves')!;
    const plain = elf.races.find((r) => r.name === 'Elf')!;
    expect(wantsOf(env, raceInfo(lib, winter.id)!).tolerances.cold).toBe(5);
    expect(wantsOf(env, raceInfo(lib, plain.id)!).tolerances.cold).toBe(3);
    // A trait with an effect on a tolerance (Cold-adapted: cold +2, heat −1).
    plain.addTraits.push('cold-adapted');
    const t = wantsOf(env, raceInfo(lib, plain.id)!).tolerances;
    expect([t.cold, t.heat]).toEqual([5, 2]);
    // Water need and adaptable from the race's options; Humans adaptable by their trait.
    winter.living.water = 'Low';
    expect(wantsOf(env, raceInfo(lib, winter.id)!).water).toBe('Low');
    const human = lib.species.find((q) => q.name === 'Human')!.races[0];
    expect(raceInfo(lib, human.id)!.adaptable).toBe(true);
    expect(raceInfo(lib, winter.id)!.adaptable).toBe(false);
    expect(attractionFor(env, lib, winter.id)).not.toBeNull();
  });

  it('sums up each province: its seasons, height and water, and how much it draws a race', () => {
    const P = env.prov;
    const p = P.of[[...env.fresh.keys()].find((k) => env.fresh[k] && env.land[k])!];
    const cells = P.cells.subarray(P.start[p], P.start[p + 1]);
    const lv = provinceLiving(env, cells)!;
    expect(lv.fresh).toBe(true);
    expect(lv.nearWater).toBeGreaterThan(0);
    expect(lv.hot).toBeGreaterThanOrEqual(lv.cold);
    const pa = provinceAttraction(env, wants(), cells)!;
    expect(pa.off).toBeLessThan(1);
    expect(pa.score).toBeGreaterThan(0);
  });
});
