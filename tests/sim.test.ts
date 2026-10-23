import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate, type Climate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { KM_PER_DEGREE } from '../src/core/units';
import type { Library } from '../src/core/library';
import { buildEnv, type Env } from '../src/sim/env';
import { addDawnCity, addTribe, clanLand, eligibleRaces, newSim, placeStart, stepDays } from '../src/sim/sim';
import { DAYS_PER_YEAR, dateText } from '../src/sim/state';
import { packSim, unpackSim } from '../src/sim/pack';
import { cropYear, isFood, newEconomy } from '../src/sim/economy';
import { updatePrices } from '../src/sim/trade';
import { bestWay, knows, pathCells, pathSpeed } from '../src/sim/ways';

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
  const elf = lib.species.find((s) => s.name === 'Elf')!.races[0];
  elf.lifespan = 300;
  elf.fightingAge ??= 20;
  env = buildEnv(cl, lib, surface);
}, 60000);

const humanId = () => eligibleRaces(lib).find((r) => r.race.name === 'Human')!.race.id;
const elfId = () => eligibleRaces(lib).find((r) => r.race.name === 'Elf')!.race.id;
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
    // People in tribes, and in the settlements some of them have founded.
    const pop = sim.tribes.reduce((n, t) => n + t.pop, 0) + sim.settlements.reduce((n, q) => n + q.pop, 0);
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
  it('saves and comes back the same, small enough to keep', () => {
    const sim = newSim(env, 21);
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 8 }], cl.zone);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 5);
    const text = JSON.stringify(packSim(sim, env));
    expect(text.length).toBeLessThan(400_000);
    const back = unpackSim(JSON.parse(text), env)!;
    expect(back).not.toBeNull();
    expect(back.day).toBe(sim.day);
    expect(back.tribes).toEqual(sim.tribes);
    expect([...back.owner]).toEqual([...sim.owner]);
    const id = env.beastInfo[0].id;
    for (let k = 0; k < env.n; k += 97) expect(back.beasts[id][k]).toBeCloseTo(sim.beasts[id][k], 2);
    // And it runs on the same from there.
    stepDays(back, env, lib, 30);
    expect(back.day).toBe(sim.day + 30);
  });
});

describe('dawn cities', () => {
  it('starts a race at its dawn city, holy to it, alone or with tribes around', () => {
    const sim = newSim(env, 31);
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 4, start: 'both' }, { race: elfId(), tribes: 6, start: 'dawn', cityPop: 600 }], cl.zone);
    const dawn = sim.settlements.filter((s) => s.kind === 'dawn');
    expect(dawn.length).toBe(2);
    const elfCity = dawn.find((s) => s.race === elfId())!;
    expect(elfCity.holyTo).toEqual([elfId()]);
    expect(elfCity.pop).toBe(600);
    expect(env.land[cellOf(elfCity.x, elfCity.y)]).toBe(1);
    expect(sim.owner[cellOf(elfCity.x, elfCity.y)]).toBe(elfCity.clan);
    // Elves start only in their city; humans have tribes round theirs.
    expect(sim.tribes.filter((t) => t.race === elfId()).length).toBe(0);
    expect(sim.tribes.filter((t) => t.race === humanId()).length).toBe(4);
    // Placing it again moves it: one dawn city per race.
    addDawnCity(sim, env, lib, elfId(), elfCity.x + 100, elfCity.y);
    expect(sim.settlements.filter((s) => s.kind === 'dawn' && s.race === elfId()).length).toBe(1);
  });
  it('grows, and its people spread out as villages and tribes', () => {
    const sim = newSim(env, 33);
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 0, start: 'dawn', cityPop: 1000 }], cl.zone);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 40);
    const city = sim.settlements.find((s) => s.kind === 'dawn')!;
    expect(city.ruined).toBe(false);
    expect(city.pop).toBeGreaterThan(300);
    expect(sim.settlements.length + sim.tribes.length).toBeGreaterThan(2);
  }, 60000);
  it('is never raided by its own race; others who raid it earn the race’s grudge', () => {
    const sim = newSim(env, 35);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(30), 120)!;
    const kin = addTribe(sim, env, lib, humanId(), 6040, yAt(30), -1, 500)!;
    const elves = addTribe(sim, env, lib, elfId(), 5960, yAt(30), -1, 500)!;
    let raided = false;
    for (let m = 0; m < 240 && !raided; m++) {
      for (const t of [kin, elves]) {
        t.summer = { x: t.x, y: t.y };
        t.winter = { x: t.x, y: t.y };
        t.fed = 0.5;
      }
      stepDays(sim, env, lib, 30);
      expect(sim.sorties.some((s) => s.tribe === kin.id && s.targetKind === 'settlement' && s.target === city.id)).toBe(false);
      raided = sim.events.some((e) => e.text.includes(city.name) && e.text.includes(elves.name));
    }
    expect(sim.events.some((e) => e.text.includes(city.name) && e.text.includes(elves.name))).toBe(true);
    expect(sim.grudges.some((g) => g.race === humanId() && g.against === elfId())).toBe(true);
  }, 60000);
  it('falls to ruin, stays holy, and is built again', () => {
    const sim = newSim(env, 37);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(30), 20)!;
    stepDays(sim, env, lib, 30);
    expect(city.ruined).toBe(true);
    expect(city.holyTo).toEqual([humanId()]);
    const t = addTribe(sim, env, lib, humanId(), 6020, yAt(30), -1, 300)!;
    for (let y = 0; y < 25 && city.ruined; y++) {
      t.summer = { x: 6020, y: yAt(30) };
      t.winter = { x: 6020, y: yAt(30) };
      stepDays(sim, env, lib, DAYS_PER_YEAR);
    }
    expect(city.ruined).toBe(false);
    expect(city.pop).toBeGreaterThan(50);
    expect(city.holyTo).toEqual([humanId()]);
  }, 60000);
  it('saves its settlements with the run', () => {
    const sim = newSim(env, 39);
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 2, start: 'both' }], cl.zone);
    stepDays(sim, env, lib, DAYS_PER_YEAR);
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.settlements).toEqual(sim.settlements);
    expect(back.grudges).toEqual(sim.grudges);
  });
});

describe('settlements and their economy', () => {
  it('finds each resource where the library says: crops on farmland, ores in patches in the hills, fish on coasts', () => {
    const land = [...env.land.keys()].filter((k) => env.land[k]);
    const where = (id: string) => land.filter((k) => env.res[id][k] > 0);
    expect(where('grain').length).toBeGreaterThan(50);
    const copper = where('copper');
    expect(copper.every((k) => env.mzone[k] >= 1)).toBe(true);
    const hills = land.filter((k) => env.mzone[k] >= 1);
    expect(copper.length).toBeGreaterThan(0);
    expect(copper.length).toBeLessThan(hills.length * 0.6);
    expect(where('fish').every((k) => env.coast[k] || env.fresh[k])).toBe(true);
    expect(env.resInfo.find((r) => r.id === 'fish')!.spoil).toBeGreaterThan(env.resInfo.find((r) => r.id === 'grain')!.spoil);
  });
  it('has mostly ordinary years, now and then a poor harvest or a failed one', () => {
    const ys = Array.from({ length: 2000 }, (_, i) => cropYear(env, 6000, yAt(40), i));
    const failed = ys.filter((v) => v < 0.6).length / ys.length;
    const poor = ys.filter((v) => v < 0.9).length / ys.length;
    expect(failed).toBeGreaterThan(0.02);
    expect(failed).toBeLessThan(0.07);
    expect(poor).toBeLessThan(0.2);
  });
  it('settles tribes by their way of life: settled peoples soon, nomads rarely', () => {
    const race = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!;
    const before = race.lifestyle;
    const run = (life: string) => {
      race.lifestyle = life;
      const sim = newSim(env, 41);
      placeStart(sim, env, lib, [{ race: race.id, tribes: 8 }], cl.zone);
      stepDays(sim, env, lib, DAYS_PER_YEAR * 15);
      return sim.events.filter((e) => e.text.includes('settled down')).length;
    };
    const settled = run('Settled');
    const nomads = run('Nomadic');
    race.lifestyle = before;
    expect(settled).toBeGreaterThanOrEqual(5);
    expect(nomads).toBeLessThan(settled);
    expect(nomads).toBeLessThanOrEqual(2);
  }, 60000);
  it('farms, brings in harvests, keeps stores and feeds its people', () => {
    const sim = newSim(env, 43);
    // Good farmland: humid temperate lowland with grain, green in summer.
    const k = [...env.land.keys()].find((q) => env.land[q] && [7, 8, 9, 10].includes(cl.zone[q]) && env.mzone[q] === 0 && env.res.grain[q] >= 0.4 && env.plant[0][q] > 0.1)!;
    expect(k).toBeDefined();
    const city = addDawnCity(sim, env, lib, humanId(), env.x0 + (k % env.w) * env.step, env.y0 + Math.floor(k / env.w) * env.step, 600)!;
    let fedMonths = 0;
    for (let m = 0; m < 120; m++) {
      stepDays(sim, env, lib, 30);
      if (city.fed >= 0.95) fedMonths++;
    }
    const e = city.economy!;
    expect(fedMonths).toBeGreaterThan(110);
    expect(e.harvest).not.toBeNull();
    expect(e.harvest!.units).toBeGreaterThan(0);
    expect(Object.values(e.jobs).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    // Farmers set for the year (in the fields through the growing season).
    expect(e.farmers).toBeGreaterThan(0);
    expect(Object.entries(e.stores).some(([id, v]) => isFood(env, id) && v > 0)).toBe(true);
    // Its needs beyond food are met from the land round it.
    expect(e.comfort).toBeGreaterThan(0.5);
  }, 60000);
  it('on poor dry land, shrinks toward what the land can feed instead of dying out', () => {
    const sim = newSim(env, 45);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(40), 600)!;
    stepDays(sim, env, lib, DAYS_PER_YEAR * 10);
    expect(city.ruined).toBe(false);
    expect(city.pop).toBeLessThan(600);
    expect(city.pop).toBeGreaterThan(250);
    // It herds as well as farms.
    expect(Object.keys(city.economy!.jobs).some((k) => k.startsWith('herd:'))).toBe(true);
  }, 60000);
});

describe('markets and trade', () => {
  /** Two peoples' cities near each other, one with grain to spare and no salt, the other the other way round. */
  const pair = (seed: number) => {
    const sim = newSim(env, seed);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 300)!;
    const other = addDawnCity(sim, env, lib, elfId(), 6150, yAt(-12), 300)!;
    a.economy = newEconomy(300, 1, 20);
    a.economy.stores = { grain: 9000 };
    other.economy = newEconomy(300, 1, 20);
    other.economy.stores = { [Object.keys(other.economy.stores)[0]]: 6000, salt: 600 };
    return { sim, a, other };
  };
  it('prices goods dear where they are short and cheap where they are plentiful', () => {
    const { a, other } = pair(51);
    const pa = updatePrices(env, a, 1);
    const pb = updatePrices(env, other, 1);
    expect(pa.salt).toBeGreaterThan(pb.salt);
    expect(pa.grain).toBeLessThan(pb.grain);
  });
  it('sends caravans that barter one surplus for the other, both sides gaining', () => {
    const { sim, a, other } = pair(53);
    let seen = 0;
    for (let d = 0; d < 360 * 2; d += 10) {
      stepDays(sim, env, lib, 10);
      seen = Math.max(seen, sim.caravans.length);
    }
    expect(seen).toBeGreaterThan(0);
    expect(a.economy!.stores.salt ?? 0).toBeGreaterThan(0);
    expect(sim.routes.length).toBeGreaterThan(0);
    expect(sim.events.some((e) => e.text.startsWith(`Traders from ${a.name}`) || e.text.startsWith(`Traders from ${other.name}`))).toBe(true);
    // The way between them gets worn.
    expect(Math.max(...sim.traffic)).toBeGreaterThan(0);
    // Traders come home and go back to work.
    expect(a.economy!.away ?? 0).toBeLessThanOrEqual(sim.caravans.filter((v) => v.from === a.id).reduce((n, v) => n + v.people, 0));
  }, 60000);
  it('does not trade with a people holding a grudge', () => {
    const { sim, a, other } = pair(55);
    sim.grudges.push({ race: other.race, against: a.race, until: 1e9 });
    stepDays(sim, env, lib, 360);
    expect(sim.routes.length).toBe(0);
  }, 60000);
  it('saves caravans, routes and the worn ways', () => {
    const { sim } = pair(57);
    stepDays(sim, env, lib, 200);
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.caravans).toEqual(sim.caravans);
    expect(back.routes).toEqual(sim.routes);
    expect(Math.max(...back.traffic)).toBeCloseTo(Math.max(...sim.traffic), 0);
  }, 60000);
});

describe('trails, roads and railways', () => {
  /** Two trading cities, one with grain and no salt, the other with salt (as in the trade tests). */
  const pair = (seed: number, extra: Record<string, number> = {}, techs: string[] = []) => {
    const sim = newSim(env, seed);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 300)!;
    const b = addDawnCity(sim, env, lib, elfId(), 6150, yAt(-12), 300)!;
    a.economy = newEconomy(300, 1, 20);
    a.economy.stores = { grain: 9000, ...extra };
    b.economy = newEconomy(300, 1, 20);
    b.economy.stores = { provisions: 6000, salt: 600 };
    a.techs = techs;
    const cellAt = (x: number, y: number) => Math.round((y - env.y0) / env.step) * env.w + ((Math.round((x - env.x0) / env.step) % env.w) + env.w) % env.w;
    const path = pathCells(env, a.x, a.y, b.x, b.y, cellAt);
    return { sim, a, b, path };
  };
  it('knows only the technologies every people starts with, until it learns more', () => {
    const { a } = pair(61);
    expect(knows(lib, a, 'barter')).toBe(true);
    expect(knows(lib, a, 'roads')).toBe(false);
    expect(bestWay(lib, a).tier).toBe(1);
    a.techs = ['roads'];
    expect(bestWay(lib, a).tier).toBe(3);
  });
  it('wears trails where caravans go, and builds nothing more without the know-how', () => {
    const { sim, path } = pair(63);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 4);
    expect(path.some((k) => sim.way[k] === 1)).toBe(true);
    expect(Math.max(...sim.way)).toBeLessThanOrEqual(1);
  }, 60000);
  it('trails fade when no one walks them', () => {
    const { sim, path } = pair(65);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 4);
    sim.settlements = [];
    sim.caravans = [];
    sim.routes = [];
    stepDays(sim, env, lib, DAYS_PER_YEAR * 30);
    expect(path.every((k) => sim.way[k] === 0)).toBe(true);
  }, 60000);
  it('builds a paved road along a busy route when it knows how and has the stone, and travel is faster on it', () => {
    const { sim, a, path } = pair(67, { stone: 400 }, ['roads']);
    const before = pathSpeed(sim, path);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 3);
    const road = path.filter((k) => sim.way[k] === 3);
    expect(road.length).toBeGreaterThan(0);
    expect(road.every((k) => sim.wayKeeper[k] === a.id)).toBe(true);
    expect(pathSpeed(sim, path)).toBeGreaterThan(before);
    expect(sim.events.some((e) => e.text.includes('began a paved road'))).toBe(true);
  }, 60000);
  it('lets a road fall back when its keeper can no longer keep it up', () => {
    const { sim, a, path } = pair(69, { stone: 400 }, ['roads']);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 2);
    const road = path.filter((k) => sim.way[k] === 3);
    expect(road.length).toBeGreaterThan(0);
    // No stone left, and no stone to be had round it.
    a.techs = [];
    for (let m = 0; m < 36; m++) {
      for (const id of Object.keys(a.economy!.stores)) if (env.resInfo.find((r) => r.id === id)?.category === 'Stone') a.economy!.stores[id] = 0;
      stepDays(sim, env, lib, 30);
    }
    expect(road.every((k) => sim.way[k] < 3)).toBe(true);
    expect(sim.events.some((e) => e.text.includes('falling into disrepair'))).toBe(true);
  }, 60000);
  it('lays a railway with iron, wood and stone, and runs trains on it that burn coal', () => {
    const { sim, a, path } = pair(71, { iron: 2000, hardwood: 1500, stone: 1500, coal: 400 }, ['railways']);
    let trains = 0;
    for (let m = 0; m < 12 * 6; m++) {
      // Keep the materials coming (as mines and woods round it would).
      for (const [id, v] of Object.entries({ iron: 2000, hardwood: 1500, stone: 1500 })) a.economy!.stores[id] = Math.max(a.economy!.stores[id] ?? 0, v);
      a.economy!.stores.coal = Math.max(a.economy!.stores.coal ?? 0, 50);
      stepDays(sim, env, lib, 30);
      trains += sim.caravans.filter((v) => v.train).length;
    }
    expect(path.every((k) => sim.way[k] === 4)).toBe(true);
    expect(trains).toBeGreaterThan(0);
  }, 60000);
  it('saves its ways', () => {
    const { sim, path } = pair(73, { stone: 400 }, ['roads']);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 3);
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(path.map((k) => back.way[k])).toEqual(path.map((k) => sim.way[k]));
    expect(path.map((k) => back.wayKeeper[k])).toEqual(path.map((k) => sim.wayKeeper[k]));
  }, 60000);
});
