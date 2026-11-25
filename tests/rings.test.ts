import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { catchmentYear, reachOf, type CatchmentContext } from '../src/sim/catchment';
import { fieldRings, newEconomy } from '../src/sim/economy';
import { buildEnv, landCell, type Env } from '../src/sim/env';
import { provAt } from '../src/sim/land';
import { farmYear, sitesYear, villageSpacing, villagesOf, type FarmLayer, type RuralContext } from '../src/sim/rural';
import { addDawnCity, newSim } from '../src/sim/sim';
import type { Settlement, SimState } from '../src/sim/state';
import { clanKnows } from '../src/sim/tech';
import { GRAZING_KM, INNER_RING_SPACING, INNER_RING_YIELD, MARKET, ringOf, TIERS } from '../src/sim/tiers';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });

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

describe('rings round a city (settlements and population, step 5)', () => {
  it('measures the rings from a town’s edge, and works the inner ring half as hard again', () => {
    const st = { x: 0, y: 0, tier: MARKET, pop: 1000 } as Settlement;
    const fp = TIERS[MARKET].footprint;
    expect(ringOf(st, fp * 0.5, 0)).toBe(0);
    expect(ringOf(st, fp + 1, 0)).toBe(1);
    expect(ringOf(st, fp + 4, 0)).toBe(2);
    expect(ringOf(st, fp + 10, 0)).toBe(3);
    expect(ringOf(st, fp + 20, 0)).toBe(4);
    expect(ringOf(st, fp + 40, 0)).toBe(5);
    // Fields from the edge (1 km) out to 6 km: the first 3 km counted at 1.5×.
    expect(fieldRings(1, 6)).toBeCloseTo(Math.PI * (16 - 1) * INNER_RING_YIELD + Math.PI * (36 - 16), 6);
    expect(fieldRings(1, 3)).toBeCloseTo(Math.PI * (9 - 1) * INNER_RING_YIELD, 6);
  });

  it('packs hamlets close round a market town, no more than half of its province’s villages, drawing more people', () => {
    const sim = newSim(env, 3);
    const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 1200, ['agriculture'])!;
    city.tier = MARKET;
    const p = provAt(env, city.x, city.y);
    sim.provOwner![p] = city.clan;
    const P = env.prov;
    const D = ((sim.density ??= {})[humanId()] = new Float32Array(env.n));
    const cells = [...P.cells.subarray(P.start[p], P.start[p + 1])].filter((k) => env.land[k]);
    for (const k of cells) D[k] = 2000 / cells.length;
    const c = rctx(sim);
    farmYear(c);
    for (let y = 0; y < 15; y++) sitesYear(c);
    const { sites } = villagesOf(sim, env, p);
    const inner = sites.filter((s) => ringOf(city, s.x, s.y) === 1);
    const outer = sites.filter((s) => ringOf(city, s.x, s.y) !== 1);
    expect(inner.length).toBeGreaterThan(1);
    // (Half the villages its 2,000 country people fill, at 200 each.)
    expect(inner.length).toBeLessThanOrEqual(5);
    expect(outer.length).toBeGreaterThan(0);
    for (const s of sites) expect(Math.hypot(s.x - city.x, s.y - city.y)).toBeGreaterThan(TIERS[MARKET].footprint);
    // Closer together than the land's own spacing, but no closer than a hamlet's.
    const spacing = villageSpacing(0.5);
    const gaps = inner.map((a) => Math.min(...inner.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(INNER_RING_SPACING - 1e-6);
    expect(Math.min(...gaps)).toBeLessThan(spacing);
    const avg = (l: typeof sites) => l.reduce((n, s) => n + s.pop, 0) / Math.max(1, l.length);
    expect(avg(inner)).toBeGreaterThan(avg(outer));
  });

  it('brings only the herds in from the grazing ring, 15–30 km off', () => {
    const sim = newSim(env, 4);
    const x = 1500;
    const y = 1000;
    const town: Settlement = { id: 1, name: 'T', kind: 'village', clan: 1, species: '', race: 'h', culture: 'c', x, y, pop: 5000, fed: 1, warband: 0, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, techs: [], tier: MARKET, economy: newEconomy(5000, 1, 3) };
    sim.settlements = [town];
    const n = env.prov.count;
    const farms: FarmLayer = { farm: new Float32Array(env.n), farmed: new Uint8Array(env.n), food: new Float32Array(n), rural: new Float32Array(n), labour: new Float32Array(n).fill(1), surplus: new Float32Array(n), ate: new Float32Array(n), herds: new Float32Array(n).fill(0.25) };
    const c: CatchmentContext = { sim, env, farms, provAt: (a, b) => provAt(env, a, b), cellOf: (a, b) => landCell(env, a, b), eats: (st) => st.pop, knows: () => false, dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) };
    const reach = reachOf(c, town);
    const grazing = [...reach].filter(([, r]) => r.mode === 'herd');
    expect(grazing.length).toBeGreaterThan(0);
    for (const [, r] of grazing) expect(r.e).toBeLessThanOrEqual(GRAZING_KM);
    // Surplus only in one grazing province: a quarter of it (its herds) comes in, every year's harvest as it is.
    const [q] = grazing[0];
    farms.surplus[q] = 1000;
    sim.day = 0;
    catchmentYear(c);
    const got = town.imports?.from.find((f) => f[0] === env.prov.ids[q]);
    expect(got?.[2]).toBe('herd');
    expect(got![1]).toBeLessThanOrEqual(1000 * 1.3 * 0.25 + 1);
    expect(got![1]).toBeGreaterThan(0);
  });
});
