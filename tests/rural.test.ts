import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { buildEnv, type Env } from '../src/sim/env';
import { provAt } from '../src/sim/land';
import { packSim, unpackSim } from '../src/sim/pack';
import { farmYear, isFarmed, sitesYear, villageSpacing, villagesOf, VILLAGE_POP, type RuralContext } from '../src/sim/rural';
import { addDawnCity, newSim, stepDays } from '../src/sim/sim';
import { clanKnows } from '../src/sim/tech';
import type { SimState } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });
const riverPts: number[] = [];
for (let x = 700; x <= 2350; x += 25) riverPts.push(x, 1000 + 15 * Math.sin(x / 150));
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
let nm = 0;
const rctx = (sim: SimState): RuralContext => ({ sim, env, lib, knows: (clan, id) => clanKnows(lib, clan, id), eats: (st) => st.pop, provAt: (x, y) => provAt(env, x, y), name: () => `V${nm++}` });
/** The density of a race living in a province, as given. */
function settle(sim: SimState, p: number, people: number) {
  const P = env.prov;
  const D = (sim.density ??= {})[humanId()] ?? (sim.density[humanId()] = new Float32Array(env.n));
  const cells = [...P.cells.subarray(P.start[p], P.start[p + 1])].filter((k) => env.land[k]);
  for (const k of cells) D[k] = people / cells.length;
}

describe('rural people and village sites (settlements and population, step 2)', () => {
  it('spaces villages by the farmland each needs: closer on rich plains, wider in hills and mountains', () => {
    expect(villageSpacing(0.7)).toBeCloseTo(1.81, 1);
    expect(villageSpacing(0.5)).toBeCloseTo(2.14, 1);
    expect(villageSpacing(0.25)).toBeCloseTo(3.03, 1);
    expect(villageSpacing(0.1)).toBeCloseTo(4.79, 1);
  });

  it('lays a farmed province’s food over its land for the families living there, and none where its holder doesn’t farm', () => {
    const sim = newSim(env, 1);
    const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 800, ['agriculture'])!;
    const p = provAt(env, 1500, 1000);
    sim.provOwner![p] = city.clan;
    const L = farmYear(rctx(sim));
    expect(L.food[p]).toBeGreaterThan(0);
    expect(L.rural[p]).toBeLessThan(L.food[p]);
    const k = [...env.prov.cells.subarray(env.prov.start[p], env.prov.start[p + 1])].find((q) => env.land[q])!;
    expect(isFarmed(sim, k)).toBe(true);
    // A clan that doesn't farm: nothing.
    sim.clans.find((c) => c.id === city.clan)!.techs = [];
    city.techs = [];
    const L2 = farmYear(rctx(sim));
    expect(L2.food[p]).toBe(0);
    expect(isFarmed(sim, k)).toBe(false);
  });

  it('settles a farmed province’s rural people in village sites, spaced, on the best spots; a busy way draws more', () => {
    const sim = newSim(env, 2);
    const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 800, ['agriculture'])!;
    const p = provAt(env, 1300, 1000);
    sim.provOwner![p] = city.clan;
    settle(sim, p, 1000);
    const c = rctx(sim);
    farmYear(c);
    for (let y = 0; y < 15; y++) sitesYear(c);
    const { sites, villagers } = villagesOf(sim, env, p);
    expect(sites.length).toBe(1000 / VILLAGE_POP);
    expect(villagers).toBeGreaterThan(900);
    for (const a of sites) for (const b of sites) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1.5);
    // A trade route through one of them: it draws more people.
    const busy = sites[sites.length - 1];
    // (On its own point: this test world's provinces are single points, so all its villages share one.)
    busy.x += env.step;
    const before = busy.pop;
    const k = Math.round((busy.y - env.y0) / env.step) * env.w + Math.round((busy.x - env.x0) / env.step);
    sim.traffic[k] = 80;
    for (let y = 0; y < 10; y++) sitesYear(c);
    expect(busy.pop).toBeGreaterThan(before * 1.4);
    // Fewer people: fewer villages.
    settle(sim, p, 300);
    for (let y = 0; y < 3; y++) sitesYear(c);
    expect(villagesOf(sim, env, p).sites.length).toBeLessThanOrEqual(2);
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(Object.keys(back.sites ?? {})).toContain(String(env.prov.ids[p]));
  });

  it('lets farming peoples fill their land far beyond what the wild feeds', () => {
    const run = (farm: boolean) => {
      const sim = newSim(env, 3);
      addDawnCity(sim, env, lib, humanId(), 1500, 1000, 1200, farm ? ['agriculture', 'plough'] : [])!;
      stepDays(sim, env, lib, 360 * 30);
      return Object.values(sim.density ?? {}).reduce((n, D) => n + D.reduce((a, b) => a + b, 0), 0);
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.5);
  }, 240000);
});
