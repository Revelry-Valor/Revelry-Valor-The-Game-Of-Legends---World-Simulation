import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { catchmentYear, reachOf, surplusGoesTo, type CatchmentContext } from '../src/sim/catchment';
import { newEconomy } from '../src/sim/economy';
import { buildEnv, landCell, type Env } from '../src/sim/env';
import { ALL_FOOD_TECH } from '../src/sim/food';
import { provAt } from '../src/sim/land';
import { surplusPerFarmer, workersFor, type FarmLayer } from '../src/sim/rural';
import { addDawnCity, newSim, stepDays } from '../src/sim/sim';
import type { Settlement, SimState } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });
const riverPts: number[] = [];
for (let x = 700; x <= 2350; x += 25) riverPts.push(x, 1000);
add('river', riverPts, { width: 2 });

let env: Env;
let lib: Library;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
  lib = defaultLibrary();
  const human = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!;
  human.lifespan = 70;
  human.fightingAge ??= 16;
}, 60000);
const humanId = () => lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!.id;
const town = (id: number, x: number, y: number, pop: number, techs: string[] = []): Settlement => ({ id, name: `T${id}`, kind: 'village', clan: 1, species: '', race: 'h', culture: 'c', x, y, pop, fed: 1, warband: 0, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, techs, tier: 2, economy: newEconomy(pop, 1, 3) });
const cctx = (sim: SimState, farms: FarmLayer): CatchmentContext => ({ sim, env, farms, provAt: (x, y) => provAt(env, x, y), cellOf: (x, y) => landCell(env, x, y), eats: (st) => st.pop, knows: (st, id) => (st.techs ?? []).includes(id), dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) });
const layer = (surplus: (p: number) => number): FarmLayer => {
  const n = env.prov.count;
  return { farm: new Float32Array(env.n), farmed: new Uint8Array(env.n), food: new Float32Array(n), rural: new Float32Array(n), labour: new Float32Array(n).fill(1), surplus: Float32Array.from({ length: n }, (_, p) => surplus(p)) };
};
/** A river point near an x (km): the river is drawn on whichever grid row it falls nearest. */
const onRiver = (x: number) => {
  const k = [...env.fresh.keys()].filter((q) => env.fresh[q] && env.land[q]).sort((a, b) => Math.abs(env.x0 + (a % env.w) * env.step - x) - Math.abs(env.x0 + (b % env.w) * env.step - x))[0];
  return { x: env.x0 + (k % env.w) * env.step, y: env.y0 + Math.floor(k / env.w) * env.step };
};
const riverY = () => onRiver(1500).y;

describe('catchments and food competition (settlements and population, step 4)', () => {
  it('lets the land employ as many as grow its food, each sparing a tenth to a quarter more by their tools: the rest its surplus', () => {
    expect(surplusPerFarmer({ ...ALL_FOOD_TECH, plough: false, rotation: false })).toBeCloseTo(0.1, 5);
    expect(surplusPerFarmer({ ...ALL_FOOD_TECH, rotation: false })).toBeCloseTo(0.15, 5);
    expect(surplusPerFarmer(ALL_FOOD_TECH)).toBeCloseTo(0.25, 5);
    expect(surplusPerFarmer({ ...ALL_FOOD_TECH, agriculture: false })).toBe(0);
    // 1,250 people's food takes 1,000 farmers with the plough and rotation: 250 to spare.
    expect(workersFor(1250, ALL_FOOD_TECH)).toBeCloseTo(1000, 5);
  });

  it('reaches about 15 km over land, far along a river with boats, and across the sea with sailing', () => {
    const sim = newSim(env, 1);
    const { x, y } = onRiver(1500);
    const byLand = reachOf(cctx(sim, layer(() => 1)), town(1, x, y, 1000));
    const byRiver = reachOf(cctx(sim, layer(() => 1)), town(2, x, y, 1000, ['rafts']));
    expect(byRiver.size).toBeGreaterThan(byLand.size + 5);
    expect([...byRiver.values()].some((r) => r.mode === 'river')).toBe(true);
    for (const [p, r] of byLand) expect(Math.hypot(env.prov.x[p] - x, env.prov.y[p] - y)).toBeLessThan(15 + 2 * env.step + r.e);
    const coast = [...env.coast.keys()].find((k) => env.coast[k] && env.land[k])!;
    const cx = env.x0 + (coast % env.w) * env.step;
    const cy = env.y0 + Math.floor(coast / env.w) * env.step;
    const port = reachOf(cctx(sim, layer(() => 1)), town(3, cx, cy, 1000, ['sailing']));
    expect([...port.values()].filter((r) => r.mode === 'sea').length).toBeGreaterThan(10);
  });

  it('splits a province’s surplus among the towns reaching it by how cheaply each does, none past its need', () => {
    const sim = newSim(env, 2);
    const a0 = onRiver(1500);
    const b0 = onRiver(1600);
    const p0 = provAt(env, a0.x, a0.y);
    // Two towns reach the same province: one in it, one by river from 100 km off.
    const near = town(1, a0.x, a0.y, 2000);
    const far = town(2, b0.x, b0.y, 2000, ['rafts']);
    sim.settlements = [near, far];
    catchmentYear(cctx(sim, layer((p) => (p === p0 ? 1000 : 0))));
    const a = near.imports?.from.find((f) => f[0] === env.prov.ids[p0])?.[1] ?? 0;
    const b = far.imports?.from.find((f) => f[0] === env.prov.ids[p0])?.[1] ?? 0;
    expect(a + b).toBeCloseTo(1000, -1);
    expect(a).toBeGreaterThan(b);
    expect(surplusGoesTo(sim, env.prov.ids[p0])[0].st).toBe(near);
    // A small town takes no more than it needs; the rest goes to the other.
    near.pop = 100;
    catchmentYear(cctx(sim, layer((p) => (p === p0 ? 1000 : 0))));
    expect(near.imports!.rations).toBeLessThanOrEqual(110);
    expect(far.imports!.rations).toBeGreaterThan(800);
  });

  it('feeds a farming town from its countryside’s surplus as the world runs', () => {
    const sim = newSim(env, 3);
    const city = addDawnCity(sim, env, lib, humanId(), onRiver(1500).x, riverY(), 1500, ['agriculture', 'plough', 'crop-rotation', 'rafts'])!;
    stepDays(sim, env, lib, 360 * 25);
    expect(city.ruined).toBe(false);
    expect(city.imports?.rations ?? 0).toBeGreaterThan(0);
  }, 240000);
});
