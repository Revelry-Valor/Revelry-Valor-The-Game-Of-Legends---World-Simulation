import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { catchmentYear, DEAL, deliverMonth, reachOf, RENT, surplusGoesTo, type CatchmentContext } from '../src/sim/catchment';
import { cropYear, newEconomy, PROVISIONS } from '../src/sim/economy';
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
  return { farm: new Float32Array(env.n), farmed: new Uint8Array(env.n), food: new Float32Array(n), rural: new Float32Array(n), labour: new Float32Array(n).fill(1), surplus: Float32Array.from({ length: n }, (_, p) => surplus(p)), ate: new Float32Array(n) };
};
/** A river point near an x (km): the river is drawn on whichever grid row it falls nearest. */
const onRiver = (x: number) => {
  const k = [...env.fresh.keys()].filter((q) => env.fresh[q] && env.land[q]).sort((a, b) => Math.abs(env.x0 + (a % env.w) * env.step - x) - Math.abs(env.x0 + (b % env.w) * env.step - x))[0];
  return { x: env.x0 + (k % env.w) * env.step, y: env.y0 + Math.floor(k / env.w) * env.step };
};
const riverY = () => onRiver(1500).y;
/** A year whose harvest in a province is an ordinary one (at least as good as usual). */
const fairYear = (p: number) => {
  for (let y = 0; y < 200; y++) if (cropYear(env, env.prov.x[p], env.prov.y[p], y) >= 1) return y;
  return 0;
};
const harvest = (sim: SimState, p: number) => cropYear(env, env.prov.x[p], env.prov.y[p], Math.floor(sim.day / 360));

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
    sim.day = fairYear(p0) * 360;
    const yr = harvest(sim, p0);
    catchmentYear(cctx(sim, layer((p) => (p === p0 ? 1000 : 0))));
    const a = near.imports?.from.find((f) => f[0] === env.prov.ids[p0])?.[1] ?? 0;
    const b = far.imports?.from.find((f) => f[0] === env.prov.ids[p0])?.[1] ?? 0;
    expect(a + b).toBeCloseTo(1000 * yr, -1);
    expect(a).toBeGreaterThan(b);
    expect(surplusGoesTo(sim, env.prov.ids[p0])[0].st).toBe(near);
    // A small town takes no more than it needs; the rest goes to the other.
    near.pop = 100;
    catchmentYear(cctx(sim, layer((p) => (p === p0 ? 1000 : 0))));
    expect(near.imports!.rations).toBeLessThanOrEqual(110);
    expect(far.imports!.rations).toBeGreaterThan(800);
  });

  it('takes rent and tax for the lord’s seat and the capital first, then the market sells the rest for goods', () => {
    const sim = newSim(env, 4);
    const a0 = onRiver(1500);
    const p0 = provAt(env, a0.x, a0.y);
    const seat = town(1, a0.x, a0.y, 2000);
    sim.settlements = [seat];
    sim.day = fairYear(p0) * 360;
    const yr = harvest(sim, p0);
    const farms = layer((p) => (p === p0 ? 1000 : 0));
    farms.ate[p0] = 4000;
    farms.rural[p0] = 4000;
    const feudal = RENT['Great lords with vassals (feudal)'];
    catchmentYear({ ...cctx(sim, farms), lords: (p) => (p === p0 ? { share: feudal.share, toCapital: feudal.capital, seat, capital: null } : null) });
    const im = seat.imports!;
    // The feudal share of the crop (5,000 rations in a usual year) as rent; the rest of the surplus at market.
    expect(im.rent).toBeCloseTo(5000 * yr * feudal.share, -1);
    expect(im.market).toBeCloseTo(5000 * yr - 4000 - im.rent!, -1);
    expect(im.from.some((f) => f[2] === 'rent')).toBe(true);
    // Rent past the farmers' surplus bites into their own food.
    const lean = layer((p) => (p === p0 ? 100 : 0));
    lean.ate[p0] = 4000;
    lean.rural[p0] = 4000;
    lean.farm.fill(1);
    catchmentYear({ ...cctx(sim, lean), lords: (p) => (p === p0 ? { share: 0.15, toCapital: 0, seat, capital: null } : null) });
    const k = env.prov.cells[env.prov.start[p0]];
    expect(lean.farm[k]).toBeLessThan(1);
    // The market is paid for in goods: a town with nothing to spare gets only its rent.
    seat.imports = { rations: 300, from: [], rent: 100, market: 200 };
    seat.economy = newEconomy(2000, 1, 3);
    const before = seat.economy.stores[PROVISIONS];
    deliverMonth(env, seat, 1);
    expect(seat.economy.stores[PROVISIONS] - before).toBeCloseTo(100, 3);
    // With wares to sell it buys it all, and the wares go to the country.
    const ware = env.resInfo.find((r) => !r.food && r.category === 'Metal')!.id;
    seat.economy.stores[ware] = 5000;
    const had = seat.economy.stores[PROVISIONS];
    deliverMonth(env, seat, 1);
    expect(seat.economy.stores[PROVISIONS] - had).toBeCloseTo(300, 3);
    expect(seat.economy.stores[ware]).toBeLessThan(5000);
    expect(seat.imports.bought).toBeCloseTo(200, 3);
  });

  it('lets a town on the water buy grain beyond its own need, to deal in; a failed harvest leaves less', () => {
    const sim = newSim(env, 5);
    const a0 = onRiver(1500);
    const p0 = provAt(env, a0.x, a0.y);
    const port = town(1, a0.x, a0.y, 1000, ['rafts']);
    const inland = town(2, a0.x, a0.y, 1000);
    sim.day = fairYear(p0) * 360;
    sim.settlements = [port];
    catchmentYear(cctx(sim, layer(() => 100000)));
    expect(port.imports!.rations).toBeGreaterThan(1000 * (1.1 + DEAL) - 5);
    sim.settlements = [inland];
    catchmentYear(cctx(sim, layer(() => 100000)));
    expect(inland.imports!.rations).toBeLessThanOrEqual(1100 + 1);
    // A failed harvest: what the farmers grow falls short of what they eat; nothing to sell, and they go hungry.
    let bad = 0;
    while (cropYear(env, env.prov.x[p0], env.prov.y[p0], bad) > 0.6) bad++;
    sim.day = bad * 360;
    const farms = layer((p) => (p === p0 ? 400 : 0));
    farms.ate[p0] = 4000;
    farms.farm.fill(1);
    catchmentYear(cctx(sim, farms));
    expect(inland.imports).toBeUndefined();
    expect(farms.farm[env.prov.cells[env.prov.start[p0]]]).toBeLessThan(1);
  });

  it('feeds a farming town from its countryside’s surplus as the world runs', () => {
    const sim = newSim(env, 3);
    const city = addDawnCity(sim, env, lib, humanId(), onRiver(1500).x, riverY(), 1500, ['agriculture', 'plough', 'crop-rotation', 'rafts'])!;
    stepDays(sim, env, lib, 360 * 25);
    expect(city.ruined).toBe(false);
    expect(city.imports?.rations ?? 0).toBeGreaterThan(0);
  }, 240000);
});
