import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { canLiveTogether, densityAt, densityMonth, densityOf, seedDensity, totalsOver, type DensityRace } from '../src/sim/density';
import { attachLandAt, buildEnv, landCell, type Env } from '../src/sim/env';
import { provAt, PK } from '../src/sim/land';
import { packSim, unpackSim } from '../src/sim/pack';
import { addDawnCity, DAY_WALK, moveSettlement, newSim, settlementTier, stepDays } from '../src/sim/sim';
import { newEconomy } from '../src/sim/economy';
import type { Settlement } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });
// A river across the middle (people live no further than a short walk from fresh water).
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

const cellAt = (x: number, y: number) => Math.round((y - env.y0) / env.step) * env.w + Math.round((x - env.x0) / env.step);
const race = (o: Partial<DensityRace> = {}): DensityRace => ({ need: 1, births: 0.05, deaths: 0.02, attitude: 'Indifferent', species: 'a', live: (k) => (env.land[k] ? 1 : -1), ...o });

describe('wilderness density', () => {
  it('starts only from something: nothing in the wild until a settlement sends families out', () => {
    const sim = newSim(env, 1);
    expect(Object.keys(sim.density ?? {}).length).toBe(0);
    const humanId = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!.id;
    addDawnCity(sim, env, lib, humanId, 1500, 1000, 1200);
    stepDays(sim, env, lib, 360 * 15);
    const D = sim.density![humanId];
    let total = 0;
    let reach = 0;
    let far = 0;
    for (let k = 0; k < env.n; k++) {
      if (D[k] <= 0) continue;
      total += D[k];
      reach++;
      const x = env.x0 + (k % env.w) * env.step;
      const y = env.y0 + Math.floor(k / env.w) * env.step;
      far = Math.max(far, Math.hypot(x - 1500, y - 1000));
    }
    expect(total).toBeGreaterThan(10);
    // Spread out over the land round the city, but not across the continent.
    expect(reach).toBeGreaterThan(5);
    expect(far).toBeLessThan(600);
    // Saved and back.
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.density![humanId].reduce((a, b) => a + b, 0)).toBeCloseTo(total, -1);
  }, 120000);

  it('spreads into land it can live on and dies out where it cannot', () => {
    const sim = newSim(env, 2);
    const k = cellAt(1500, 1000);
    seedDensity(sim, env, 'r', [k], 200);
    const left = new Float32Array(env.n).fill(1000);
    // The land west of x = 1400 can't keep them.
    const r = race({ live: (q) => (!env.land[q] ? -1 : (q % env.w) * env.step + env.x0 < 1400 ? -1 : 1) });
    for (let m = 0; m < 24; m++) densityMonth({ sim, env, left: left.fill(1000), race: () => r });
    const D = sim.density!.r;
    expect(D[k + 1]).toBeGreaterThan(0.3);
    expect(D[cellAt(1300, 1000)]).toBe(0);
    // Without food they die back.
    const before = D.reduce((a, b) => a + b, 0);
    for (const b of env.beastInfo) sim.beasts[b.id].fill(0);
    for (let m = 0; m < 24; m++) densityMonth({ sim, env, left: left.fill(0), race: () => r });
    expect(D.reduce((a, b) => a + b, 0)).toBeLessThan(before * 0.6);
  });

  it('spreads quickly through country that suits the race, and slowly where it does not', () => {
    const sim = newSim(env, 6);
    const k = cellAt(1500, 1000);
    seedDensity(sim, env, 'r', [k], 300);
    const east = (q: number) => (q % env.w) * env.step + env.x0 > 1500;
    // East of the start, easy country (a coast, say); west, country that doesn't suit them (a jungle for men).
    const r = race({ ease: (q) => (east(q) ? 1.5 : 0.25) });
    const left = new Float32Array(env.n);
    for (let m = 0; m < 36; m++) densityMonth({ sim, env, left: left.fill(1000), race: () => r });
    const D = sim.density!.r;
    let e = 0;
    let wv = 0;
    let far = { e: 0, w: 0 };
    for (let q = 0; q < env.n; q++) {
      if (D[q] <= 0 || q === k) continue;
      const d = Math.abs((q % env.w) - (k % env.w));
      if (east(q)) [e, far.e] = [e + D[q], Math.max(far.e, d)];
      else [wv, far.w] = [wv + D[q], Math.max(far.w, d)];
    }
    expect(e).toBeGreaterThan(wv * 2);
    expect(far.e).toBeGreaterThan(far.w);
  });

  it('hunts the game down where the families live', () => {
    const sim = newSim(env, 3);
    const k = cellAt(1500, 1000);
    const game = env.beastInfo.filter((b) => !b.water && env.beastK[b.id][k] > 0);
    expect(game.length).toBeGreaterThan(0);
    const before = game.reduce((a, b) => a + sim.beasts[b.id][k], 0);
    densityOf(sim, env, 'r')[k] = 3000;
    for (let m = 0; m < 6; m++) densityMonth({ sim, env, left: new Float32Array(env.n), race: () => race() });
    expect(game.reduce((a, b) => a + sim.beasts[b.id][k], 0)).toBeLessThan(before * 0.9);
    const t = totalsOver(sim, env, [k], 0);
    expect(t.people.r).toBeGreaterThan(0);
  });

  it('lets races that can live together share the land, and pushes the weaker out where they cannot', () => {
    const elf = race({ attitude: 'Wary', species: 'elf' });
    const man = race({ attitude: 'Welcoming', species: 'man' });
    const friend = race({ attitude: 'Welcoming', species: 'dwarf' });
    expect(canLiveTogether(man, 'man', friend, 'dwarf')).toBe(true);
    expect(canLiveTogether(man, 'man', elf, 'elf')).toBe(false);
    const sim = newSim(env, 4);
    const k = cellAt(1500, 1000);
    densityOf(sim, env, 'man')[k] = 400;
    densityOf(sim, env, 'elf')[k] = 100;
    densityOf(sim, env, 'dwarf')[k] = 100;
    const races: Record<string, DensityRace> = { man, elf, dwarf: friend };
    for (let m = 0; m < 36; m++) densityMonth({ sim, env, left: new Float32Array(env.n).fill(5000), race: (id) => races[id] });
    const here = Object.fromEntries(densityAt(sim, k).byRace);
    // Where they met, the elves (outnumbered, and unwilling to share) are pushed out; the dwarves
    // (welcome, and welcoming) stay alongside the men. All of them spread a little as well.
    expect((here.elf ?? 0) / here.man).toBeLessThan(0.05);
    expect(here.dwarf / here.man).toBeGreaterThan(0.15);
    const total = (id: string) => sim.density![id].reduce((a, b) => a + b, 0);
    expect(total('dwarf')).toBeGreaterThan(90);
    expect(total('elf')).toBeLessThan(total('dwarf'));
  });

  it('lets a dawn city stand right on the coast, where it is dropped, without snapping to the climate’s points', () => {
    const e2 = buildEnv(computeClimate(surface, settings), lib, surface);
    attachLandAt(e2, () => surface, settings.seed, 0);
    // A spot on the painted land whose climate point is sea (the coast between the points).
    let spot: { x: number; y: number } | null = null;
    for (let x = 2200; x < 2600 && !spot; x += 0.1) {
      const k = Math.round((1000 - e2.y0) / e2.step) * e2.w + Math.round((x - e2.x0) / e2.step);
      if (e2.landAt!(x, 1000) && !e2.land[k]) spot = { x, y: 1000 };
    }
    expect(spot).not.toBeNull();
    const sim = newSim(e2, 21);
    const humanId = lib.species.find((q) => q.name === 'Human')!.races.find((r) => r.name === 'Human')!.id;
    const city = addDawnCity(sim, e2, lib, humanId, 1500, 1000, 600, ['agriculture', 'husbandry', 'fishing'])!;
    moveSettlement(sim, e2, lib, city.id, spot!.x, spot!.y);
    expect([city.x, city.y]).toEqual([spot!.x, spot!.y]);
    // Its climate point (for food, trade and roads) is land, and its province a land one.
    expect(e2.land[landCell(e2, city.x, city.y)]).toBe(1);
    const p = provAt(e2, city.x, city.y);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(e2.prov.kind[p]).toBe(PK.land);
    // A year on, it is still exactly there.
    stepDays(sim, e2, lib, 360);
    expect([city.x, city.y]).toEqual([spot!.x, spot!.y]);
    expect(city.ruined).toBe(false);
  }, 120000);

  describe('settlements from the wild (step 2)', () => {
    const humanId = () => lib.species.find((q) => q.name === 'Human')!.races.find((r) => r.name === 'Human')!.id;
    const farming = ['agriculture', 'husbandry', 'fishing'];
    const village = (sim: ReturnType<typeof newSim>, x: number, y: number, clan: number, pop = 150): Settlement => {
      const v: Settlement = { id: sim.nextId++, name: `V${sim.nextId}`, kind: 'village', clan, species: 'human', race: humanId(), culture: '', x, y, pop, fed: 1, warband: 10, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(pop, 1, 3), techs: [...farming] };
      sim.settlements.push(v);
      return v;
    };

    it('gathers families living thick in the wild into a village, on its own in land nobody holds', () => {
      const sim = newSim(env, 7);
      const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 1200, farming)!;
      // Families gathered far out in unclaimed land.
      const k = cellAt(2100, 1000);
      const D = densityOf(sim, env, humanId());
      for (const q of [k - env.w - 1, k - env.w, k - env.w + 1, k - 1, k, k + 1, k + env.w - 1, k + env.w, k + env.w + 1]) D[q] += 30;
      stepDays(sim, env, lib, 360);
      const v = sim.settlements.find((q) => q !== city && Math.hypot(q.x - 2100, q.y - 1000) < 60);
      expect(v).toBeTruthy();
      expect(v!.kind).toBe('village');
      expect(v!.clan).not.toBe(city.clan);
      expect(v!.pop).toBeGreaterThan(80);
      expect(v!.techs).toContain('agriculture');
      expect(sim.events.some((e) => /settled together/.test(e.text))).toBe(true);
    }, 120000);

    it('lets a growing town keep its people: no bands sent off as new tribes', () => {
      const sim = newSim(env, 9);
      const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 1200, farming)!;
      stepDays(sim, env, lib, 360 * 8);
      expect(sim.tribes).toHaveLength(0);
      expect(sim.events.some((e) => /went out from/.test(e.text))).toBe(false);
      expect(city.pop).toBeGreaterThan(1000);
    }, 120000);

    it('joins villages within a day’s walk to the town of their realm, which feeds them all as one', () => {
      const sim = newSim(env, 8);
      const city = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 1500, farming)!;
      expect(settlementTier(city)).not.toBe('Village');
      const near = village(sim, 1500 + DAY_WALK * 0.7, 1000, city.clan);
      const far = village(sim, 1500 + DAY_WALK * 2.5, 1000, city.clan);
      const other = village(sim, 1500, 1000 + DAY_WALK * 0.7, city.clan + 999);
      stepDays(sim, env, lib, 360);
      expect(near.partOf).toBe(city.id);
      expect(far.partOf).toBeUndefined();
      expect(other.partOf).toBeUndefined();
      expect(sim.events.some((e) => e.text.includes(`${near.name} became part of ${city.name}`))).toBe(true);
      // Fed as the town is, from its stores.
      stepDays(sim, env, lib, 30);
      expect(near.fed).toBe(city.fed);
    }, 120000);
  });
});
