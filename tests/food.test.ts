import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { ALL_FOOD_TECH, arableAt, fertilityAt, foodTechFrom, netYield, provinceFood, provinceLand, surplusOf } from '../src/sim/food';
import { buildEnv, type Env } from '../src/sim/env';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 60, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });
const riverPts: number[] = [];
for (let x = 700; x <= 2350; x += 25) riverPts.push(x, 1100);
add('river', riverPts, { width: 2 });
add('mountains', [1500, 700, 1700, 700], { size: 120 } as Partial<Stroke>);

let env: Env;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
}, 60000);
const land = () => [...env.land.keys()].filter((k) => env.land[k]);

describe('what the land can feed (settlements and population, step 1)', () => {
  it('reads farmland from ground and relief, and fertility from the warm season and water', () => {
    const river = land().find((k) => env.fresh[k] && env.mzone[k] === 0)!;
    expect(arableAt(env, river)).toBeGreaterThanOrEqual(0.6);
    const flat = land().filter((k) => env.mzone[k] === 0 && !env.fresh[k]);
    const high = land().filter((k) => env.mzone[k] >= 2);
    const mean = (ks: number[], f: (k: number) => number) => ks.reduce((n, k) => n + f(k), 0) / Math.max(1, ks.length);
    expect(high.length).toBeGreaterThan(0);
    expect(mean(high, (k) => arableAt(env, k))).toBeLessThan(mean(flat, (k) => arableAt(env, k)) * 0.5);
    // The cold north is less fertile than the warm south.
    const byLat = [...flat].sort((a, b) => env.lat[a] - env.lat[b]);
    const south = byLat.slice(0, 50);
    const north = byLat.slice(-50);
    expect(mean(north, (k) => fertilityAt(env, k))).toBeLessThan(mean(south, (k) => fertilityAt(env, k)));
    // Irrigation helps dry land by water, never hurts.
    expect(fertilityAt(env, river, true)).toBeGreaterThanOrEqual(fertilityAt(env, river));
  });

  it('nets a hectare a quarter over its farmer’s food with the plough and crop rotation, less with two fields, nothing without farming', () => {
    expect(netYield(1, ALL_FOOD_TECH)).toBeCloseTo(1.25, 2);
    const twoField = { ...ALL_FOOD_TECH, rotation: false };
    expect(netYield(1, twoField)).toBeCloseTo(0.9375, 3);
    expect(netYield(1, { ...ALL_FOOD_TECH, plough: false })).toBeLessThan(netYield(1, ALL_FOOD_TECH));
    expect(netYield(1, { ...ALL_FOOD_TECH, agriculture: false })).toBe(0);
    expect(foodTechFrom((id) => id === 'agriculture').rotation).toBe(false);
  });

  it('feeds more on rich lowland by a river than in the mountains, and leaves a surplus for towns', () => {
    const L = provinceLand(env);
    const P = env.prov;
    const per = (p: number) => provinceFood(L[p], ALL_FOOD_TECH).total / Math.max(1, P.area[p]);
    const riverP = P.of[land().find((k) => env.fresh[k] && env.mzone[k] === 0)!];
    const mountP = P.of[land().find((k) => env.mzone[k] >= 3) ?? land().find((k) => env.mzone[k] >= 2)!];
    expect(per(riverP)).toBeGreaterThan(per(mountP) * 2);
    // Good farmland feeds tens of people a square km (England c. 1300: about 35).
    expect(per(riverP)).toBeGreaterThan(15);
    expect(per(riverP)).toBeLessThan(150);
    // Herds and fish only with what the people know.
    const f = provinceFood(L[riverP], { ...ALL_FOOD_TECH, husbandry: false, fishing: false });
    expect(f.herds).toBe(0);
    expect(f.fish).toBe(0);
    const s = surplusOf(provinceFood(L[riverP], ALL_FOOD_TECH), provinceFood(L[riverP], ALL_FOOD_TECH).total * 0.8);
    expect(s.urbanShare).toBeCloseTo(0.2, 5);
  });
});
