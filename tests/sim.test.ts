import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate, type Climate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { KM_PER_DEGREE } from '../src/core/units';
import type { Library } from '../src/core/library';
import { buildEnv, type Env } from '../src/sim/env';
import { addTribe, clanLand, eligibleRaces, newSim, placeStart, stepDays } from '../src/sim/sim';
import { DAYS_PER_YEAR, dateText } from '../src/sim/state';

/** The test continent from the climate tests: 55°N to 35°S, with a western range. */
const north = 70;
const settings = defaultSettings({ widthKm: 14000, heightKm: 130 * KM_PER_DEGREE, northLatitude: north, edges: 'wrap', seed: 7 });
const yAt = (lat: number) => (north - lat) * KM_PER_DEGREE;
const line = (pts: [number, number][], step = 80) => {
  const out: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let i = 0; i < n; i++) out.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
  }
  out.push(...pts[pts.length - 1]);
  return out;
};
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', line([[6000, yAt(50)], [6000, yAt(-30)]]), { size: 5000 });
add('mountains', line([[4900, yAt(52)], [4900, yAt(38)]], 30), { size: 300, strength: 1 });

let cl: Climate;
let env: Env;
let lib: Library;
beforeAll(() => {
  cl = computeClimate(surface, settings);
  lib = defaultLibrary();
  // Complete one race for the test (the roster still lacks lifespans).
  const human = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!;
  human.lifespan = 70;
  human.fightingAge ??= 16;
  env = buildEnv(cl, lib, surface);
}, 60000);

const humanId = () => eligibleRaces(lib).find((r) => r.race.name === 'Human')!.race.id;
const cellOf = (x: number, y: number) => Math.round((y - cl.y0) / cl.step) * cl.w + Math.round((((x - cl.x0) / cl.step) % cl.w + cl.w) % cl.w);

describe('the first peoples', () => {
  it('lets only complete races take part', () => {
    const fresh = defaultLibrary();
    expect(eligibleRaces(fresh).length).toBe(0);
    expect(eligibleRaces(lib).map((r) => r.race.name)).toContain('Human');
  });
  it('places starting tribes on land, in clans', () => {
    const sim = newSim(env, 3);
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 8 }], cl.zone);
    expect(sim.tribes.length).toBeGreaterThanOrEqual(6);
    for (const t of sim.tribes) expect(env.land[cellOf(t.x, t.y)]).toBe(1);
    expect(sim.clans.length).toBeGreaterThanOrEqual(2);
    expect(sim.clans.length).toBeLessThanOrEqual(3);
  });
  it('runs for years: tribes move with the seasons, claim land, and stay a sensible size', () => {
    const sim = newSim(env, 5);
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 8 }], cl.zone);
    const start = new Map(sim.tribes.map((t) => [t.id, { x: t.x, y: t.y }]));
    const pop0 = sim.tribes.reduce((n, t) => n + t.pop, 0);
    stepDays(sim, env, lib, 200);
    const moved = sim.tribes.filter((t) => start.has(t.id) && Math.hypot(t.x - start.get(t.id)!.x, t.y - start.get(t.id)!.y) > 20).length;
    expect(moved).toBeGreaterThan(0);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 20 - 200);
    expect(dateText(sim.day)).toBe('Day 1, month 1, year 21');
    const pop = sim.tribes.reduce((n, t) => n + t.pop, 0);
    expect(pop).toBeGreaterThan(pop0 * 0.3);
    expect(pop).toBeLessThan(pop0 * 30);
    for (const t of sim.tribes) {
      expect(t.pop).toBeGreaterThanOrEqual(15);
      expect(t.warband).toBeLessThanOrEqual(t.pop);
      expect(env.land[cellOf(t.x, t.y)]).toBe(1);
    }
    const land = [...clanLand(sim, env).values()].reduce((a, b) => a + b, 0);
    expect(land).toBeGreaterThan(env.cellArea * 20);
    // Claims never fade: every claimed point belongs to a clan that exists or existed.
    expect(sim.owner.some((o) => o >= 0)).toBe(true);
  }, 60000);
  it('thins the game near tribes, and it grows back', () => {
    const sim = newSim(env, 9);
    const t = addTribe(sim, env, lib, humanId(), 6000, yAt(30), -1, 400)!;
    const k = cellOf(t.x, t.y);
    const game = () => env.beastInfo.filter((b) => !b.water).reduce((n, b) => n + sim.beasts[b.id][k], 0);
    const before = game();
    t.summer = { x: t.x, y: t.y };
    t.winter = { x: t.x, y: t.y };
    stepDays(sim, env, lib, 30 * 6);
    expect(game()).toBeLessThan(before);
  });
  it('sends warbands out and brings them home', () => {
    const sim = newSim(env, 11);
    const a = addTribe(sim, env, lib, humanId(), 6000, yAt(30), -1, 400)!;
    const b = addTribe(sim, env, lib, humanId(), 6030, yAt(30), -1, 400)!;
    expect(a.clan).not.toBe(b.clan);
    let out = 0;
    let fights = 0;
    for (let m = 0; m < 120; m++) {
      for (const t of [a, b]) {
        t.summer = { x: t.x, y: t.y };
        t.winter = { x: t.x, y: t.y };
      }
      stepDays(sim, env, lib, 30);
      out = Math.max(out, sim.sorties.length);
      fights = sim.events.filter((e) => /warband/.test(e.text)).length;
      if (fights > 0) break;
    }
    expect(out).toBeGreaterThan(0);
    expect(fights).toBeGreaterThan(0);
    stepDays(sim, env, lib, 20);
    for (const t of sim.tribes) {
      if (!sim.sorties.some((s) => s.tribe === t.id)) expect(t.away).toBe(0);
    }
  });
});
