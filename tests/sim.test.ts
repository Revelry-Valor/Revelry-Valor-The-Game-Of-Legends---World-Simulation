import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate, type Climate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { KM_PER_DEGREE } from '../src/core/units';
import type { Library } from '../src/core/library';
import { buildEnv, type Env } from '../src/sim/env';
import { addDawnCity, addTribe, clanLand, eligibleRaces, newSim, placeStart, stepDays } from '../src/sim/sim';
import { DAYS_PER_YEAR, dateText, type Clan, type Hero, type Settlement, type SimState } from '../src/sim/state';
import { fight, total, type Ground, type Side } from '../src/sim/battle';
import { ensureRealm, nationsYear, type NationContext } from '../src/sim/nations';
import { hasPact, noteAttack, politicsYear, relationOf, spiesDay, type PoliticsContext } from '../src/sim/politics';
import { waysYear } from '../src/sim/ways';
import { armiesDay, declareWar, raiseArmy, warsMonth, warsYear, type WarContext } from '../src/sim/wars';
import { newCulture, newFaith, newGod, newGovernment } from '../src/core/library';
import { championMight, faithLoyalty, faithOf, faithYear, type FaithContext } from '../src/sim/faith';
import { packSim, unpackSim } from '../src/sim/pack';
import { cropYear, isFood, newEconomy } from '../src/sim/economy';
import { updatePrices } from '../src/sim/trade';
import { bestWay, knows, pathCells, pathSpeed } from '../src/sim/ways';
import { armsMight, clanKnows } from '../src/sim/tech';
import { acceptance, noteBetween } from '../src/sim/cultureChange';

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
    // How far each tribe has gone from where it began (at most), over the seasons.
    const far = new Map<number, number>();
    for (let d = 0; d < 360; d += 10) {
      stepDays(sim, env, lib, 10);
      for (const t of sim.tribes) if (start.has(t.id)) far.set(t.id, Math.max(far.get(t.id) ?? 0, Math.hypot(t.x - start.get(t.id)!.x, t.y - start.get(t.id)!.y)));
    }
    expect([...far.values()].some((v) => v > 20)).toBe(true);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 19);
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
    const sim = newSim(env, 14);
    const a = addTribe(sim, env, lib, humanId(), 6000, yAt(30), -1, 400)!;
    // Neighbours of another people (kin of one culture are slow to fight each other).
    const b = addTribe(sim, env, lib, elfId(), 6030, yAt(30), -1, 400)!;
    expect(a.clan).not.toBe(b.clan);
    let out = 0;
    let fights = 0;
    for (let d = 0; d < 360 * 40; d += 5) {
      for (const t of sim.tribes) {
        t.summer = { x: t.x, y: t.y };
        t.winter = { x: t.x, y: t.y };
      }
      // Keep them roaming tribes (knowing nothing that would let them settle down).
      for (const c of sim.clans) c.techs = [];
      stepDays(sim, env, lib, 5);
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
  }, 120000);
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
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 0, start: 'dawn', cityPop: 1000, techs: ['agriculture', 'husbandry', 'fishing'] }], cl.zone);
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
    // Ten years of hungry kin next door: they never send a warband against their holy city.
    for (let m = 0; m < 120; m++) {
      for (const t of [kin, elves]) {
        t.summer = { x: t.x, y: t.y };
        t.winter = { x: t.x, y: t.y };
        const clan = sim.clans.find((c) => c.id === t.clan);
        if (clan) clan.techs = [];
      }
      stepDays(sim, env, lib, 30);
      expect(sim.sorties.some((s) => s.tribe === kin.id && s.targetKind === 'settlement' && s.target === city.id)).toBe(false);
    }
    // An Elf warband falls on it.
    if (sim.tribes.includes(elves)) {
      sim.sorties.push({ id: sim.nextId++, tribe: elves.id, clan: elves.clan, target: city.id, targetKind: 'settlement', strength: 60, x: elves.x, y: elves.y, leg: 'out' });
      elves.away += 60;
      stepDays(sim, env, lib, 30);
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
    const city = addDawnCity(sim, env, lib, humanId(), env.x0 + (k % env.w) * env.step, env.y0 + Math.floor(k / env.w) * env.step, 600, ['agriculture', 'husbandry', 'fishing'])!;
    let fedMonths = 0;
    for (let m = 0; m < 120; m++) {
      stepDays(sim, env, lib, 30);
      if (city.fed >= 0.95) fedMonths++;
    }
    const e = city.economy!;
    expect(fedMonths).toBeGreaterThan(110);
    expect(e.harvest).not.toBeNull();
    expect(e.harvest!.units).toBeGreaterThan(0);
    // Farmers set for the year (in the fields through the growing season).
    expect(e.farmers).toBeGreaterThan(0);
    expect(Object.entries(e.stores).some(([id, v]) => isFood(env, id) && v > 0)).toBe(true);
    // Its needs beyond food are met from the land round it.
    expect(e.comfort).toBeGreaterThan(0.5);
  }, 60000);
  it('on poor dry land, shrinks toward what the land can feed instead of dying out', () => {
    const sim = newSim(env, 45);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(40), 600, ['agriculture', 'husbandry'])!;
    stepDays(sim, env, lib, DAYS_PER_YEAR * 10);
    expect(city.ruined).toBe(false);
    expect(city.pop).toBeLessThan(600);
    expect(city.pop).toBeGreaterThan(200);
    // It herds as well as farms.
    expect(Object.keys(city.economy!.jobs).some((k) => k.startsWith('herd:'))).toBe(true);
  }, 60000);
});

describe('markets and trade', () => {
  /** Two peoples' cities near each other, one with grain to spare and no salt, the other the other way round. */
  const pair = (seed: number) => {
    const sim = newSim(env, seed);
    const farming = ['agriculture', 'husbandry', 'fishing'];
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 300, farming)!;
    const other = addDawnCity(sim, env, lib, elfId(), 6150, yAt(-12), 300, farming)!;
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
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 300, ['agriculture', 'husbandry', 'fishing'])!;
    const b = addDawnCity(sim, env, lib, elfId(), 6150, yAt(-12), 300, ['agriculture', 'husbandry', 'fishing'])!;
    a.economy = newEconomy(300, 1, 20);
    a.economy.stores = { grain: 9000, ...extra };
    b.economy = newEconomy(300, 1, 20);
    b.economy.stores = { provisions: 6000, salt: 600 };
    a.techs = [...a.techs!, ...techs];
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

describe('technology', () => {
  const at = (x: number, lat: number) => ({ x, y: yAt(lat) });
  it('farms only with agriculture: basic survival (gathering, hunting) is free', () => {
    const run = (techs: string[]) => {
      const sim = newSim(env, 81);
      const p = at(6000, -12);
      const city = addDawnCity(sim, env, lib, humanId(), p.x, p.y, 400, techs)!;
      let farmed = false;
      for (let m = 0; m < 24; m++) {
        stepDays(sim, env, lib, 30);
        if (Object.keys(city.economy!.jobs).some((k) => k.startsWith('farm:'))) farmed = true;
      }
      return { farmed, city };
    };
    const without = run([]);
    expect(without.farmed).toBe(false);
    // It lives by gathering, hunting, simple fishing (or herding, once it discovers husbandry by hunting).
    expect(Object.keys(without.city.economy!.jobs).some((k) => k === 'gather' || k === 'hunt' || k.startsWith('fish:') || k.startsWith('herd:'))).toBe(true);
    expect(run(['agriculture']).farmed).toBe(true);
  }, 60000);
  it('settles only peoples who know a way to feed a village', () => {
    const race = lib.species.find((s) => s.name === 'Human')!.races.find((r) => r.name === 'Human')!;
    const before = race.lifestyle;
    race.lifestyle = 'Settled';
    const run = (techs: string[]) => {
      const sim = newSim(env, 83);
      placeStart(sim, env, lib, [{ race: race.id, tribes: 6, techs }], cl.zone);
      // Keep them from discovering farming for themselves in the meantime.
      for (let y = 0; y < 8; y++) {
        for (const c of sim.clans) c.techs = [...techs];
        stepDays(sim, env, lib, DAYS_PER_YEAR);
      }
      return sim.events.filter((e) => e.text.includes('settled down')).length;
    };
    const foragers = run([]);
    const farmers = run(['agriculture']);
    race.lifestyle = before;
    expect(foragers).toBe(0);
    expect(farmers).toBeGreaterThan(0);
  }, 60000);
  it('lets foragers discover agriculture in time, by tending wild plants', () => {
    let found = 0;
    for (const seed of [91, 92, 93, 94, 95, 96]) {
      const sim = newSim(env, seed);
      const p = at(6000, -12);
      const city = addDawnCity(sim, env, lib, humanId(), p.x, p.y, 600)!;
      for (let y = 0; y < 80 && !city.techs!.includes('agriculture'); y++) stepDays(sim, env, lib, DAYS_PER_YEAR);
      if (city.techs!.includes('agriculture')) found++;
    }
    expect(found).toBeGreaterThanOrEqual(2);
  }, 120000);
  it('learns from neighbours what they know, far faster than finding it alone', () => {
    const sim = newSim(env, 95);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 400, ['agriculture', 'writing'])!;
    const b = addDawnCity(sim, env, lib, elfId(), 6120, yAt(-12), 400, ['agriculture'])!;
    let years = 0;
    while (years < 25 && !b.techs!.includes('writing')) {
      stepDays(sim, env, lib, DAYS_PER_YEAR);
      years++;
    }
    expect(b.techs).toContain('writing');
    void a;
  }, 120000);
  it('never knows a technology before what it builds on', () => {
    const sim = newSim(env, 97);
    placeStart(sim, env, lib, [{ race: humanId(), tribes: 6, start: 'both', techs: ['agriculture', 'husbandry', 'copper'] }], cl.zone);
    stepDays(sim, env, lib, DAYS_PER_YEAR * 40);
    const ok = (known: string[]) => known.every((id) => (lib.techs.find((t) => t.id === id)?.requires ?? []).every((r) => known.includes(r) || lib.techs.find((t) => t.id === r)?.start));
    for (const st of sim.settlements) if (!st.ruined) expect(ok(st.techs ?? [])).toBe(true);
    for (const c of sim.clans) expect(ok(c.techs ?? [])).toBe(true);
  }, 120000);
  it('forgets deep knowledge where too few are left and no one near knows it, unless an archive keeps it', () => {
    const deep = ['agriculture', 'husbandry', 'fishing', 'copper', 'bronze', 'iron', 'steel', 'pottery', 'mudbrick', 'masonry', 'writing', 'mathematics', 'engineering'];
    const run = (extra: string[]) => {
      const sim = newSim(env, 99);
      const v = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 70, [...deep, ...extra])!;
      stepDays(sim, env, lib, DAYS_PER_YEAR * 20);
      expect(v.ruined).toBe(false);
      return v.techs!;
    };
    // Steel and engineering need about 140 people to keep alive.
    const alone = run([]);
    expect(alone.includes('engineering') && alone.includes('steel')).toBe(false);
    const archived = run(['libraries']);
    expect(archived.includes('engineering') && archived.includes('steel')).toBe(true);
  }, 120000);
  it('arms its fighters with what it knows', () => {
    expect(armsMight(() => false)).toBe(1);
    expect(armsMight((id) => id === 'iron-arms')).toBeGreaterThan(armsMight((id) => id === 'bronze-arms'));
    const sim = newSim(env, 101);
    const t = addTribe(sim, env, lib, humanId(), 6000, yAt(-12), -1, 200)!;
    const clan = sim.clans.find((c) => c.id === t.clan)!;
    expect(clanKnows(lib, clan, 'spears')).toBe(true);
    expect(clanKnows(lib, clan, 'iron-arms')).toBe(false);
  });
});

describe('culture change', () => {
  const farming = ['agriculture', 'husbandry', 'fishing'];
  it('comes to accept those it trades with, and to distrust those it fights', () => {
    const sim = newSim(env, 201);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 500, farming)!;
    const b = addDawnCity(sim, env, lib, elfId(), 6150, yAt(-12), 500, farming)!;
    const start = acceptance(sim, a.culture, b.culture);
    for (let y = 0; y < 6; y++) {
      for (let i = 0; i < 10; i++) noteBetween(sim, a.culture, b.culture, 'trades');
      stepDays(sim, env, lib, DAYS_PER_YEAR);
    }
    const traded = acceptance(sim, a.culture, b.culture);
    expect(traded).toBeGreaterThan(start + 0.1);
    for (let y = 0; y < 3; y++) {
      for (let i = 0; i < 8; i++) noteBetween(sim, a.culture, b.culture, 'fights');
      stepDays(sim, env, lib, DAYS_PER_YEAR);
    }
    expect(acceptance(sim, a.culture, b.culture)).toBeLessThan(traded - 0.2);
  }, 120000);
  it('draws a small settlement into the culture of the big one beside it', () => {
    const sim = newSim(env, 203);
    const big = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 2500, farming)!;
    const small = addDawnCity(sim, env, lib, elfId(), 6070, yAt(-12), 150, farming)!;
    for (let y = 0; y < 40 && small.culture !== big.culture; y++) stepDays(sim, env, lib, DAYS_PER_YEAR);
    expect(small.ruined || small.culture === big.culture).toBe(true);
    if (!small.ruined) expect(sim.events.some((e) => e.text.includes(`${small.name} has taken on the ways`))).toBe(true);
  }, 120000);
  it('lets a clan far from its heartland, with no ties back, grow a culture of its own', () => {
    const sim = newSim(env, 205);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 800, farming)!;
    const far = addTribe(sim, env, lib, humanId(), 6000, yAt(-20), -1, 300)!;
    expect(far.culture).toBe(city.culture);
    const parent = city.culture;
    for (let y = 0; y < 75; y++) {
      for (const t of sim.tribes) if (t.clan === far.clan) {
        t.summer = { x: 6000, y: yAt(-20) };
        t.winter = { x: 6000, y: yAt(-20) };
        t.pop = Math.max(t.pop, 200);
      }
      const clan = sim.clans.find((c) => c.id === far.clan);
      if (clan) clan.techs = [];
      stepDays(sim, env, lib, DAYS_PER_YEAR);
    }
    const kin = sim.tribes.filter((t) => t.clan === far.clan);
    expect(kin.length).toBeGreaterThan(0);
    const now = sim.cultures!.find((c) => c.id === kin[0].culture)!;
    expect(now.id).not.toBe(parent);
    expect(now.parent).toBe(parent);
  }, 180000);
  it('blends two cultures long living side by side and close to each other', () => {
    const sim = newSim(env, 207);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 600, farming)!;
    const b = addDawnCity(sim, env, lib, elfId(), 6080, yAt(-12), 600, farming)!;
    const before = [a.culture, b.culture];
    for (let y = 0; y < 50; y++) {
      // They come to hold each other close.
      for (let i = 0; i < 10; i++) noteBetween(sim, a.culture, b.culture, 'trades');
      stepDays(sim, env, lib, DAYS_PER_YEAR);
      if (sim.cultures!.some((c) => c.blend)) break;
    }
    const blend = sim.cultures!.find((c) => c.blend);
    expect(blend).toBeDefined();
    expect(blend!.blend!.sort()).toEqual([...before].sort());
    expect([a.culture, b.culture]).toContain(blend!.id);
  }, 180000);
});

describe('realms', () => {
  const farming = ['agriculture', 'husbandry', 'fishing'];
  const ctx = (sim: SimState, L = lib): NationContext => ({
    sim,
    env,
    lib: L,
    rand: () => Math.random(),
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    cellAt: cellOf,
    log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }),
    name: () => 'Ana',
    lifespan: () => 70,
  });
  /** Another town of the same clan and culture, some km away. */
  const town = (sim: SimState, base: Settlement, dx: number, dy: number, pop: number): Settlement => {
    const st: Settlement = { ...base, id: sim.nextId++, kind: 'village', holyTo: [], x: base.x + dx, y: base.y + dy, pop, economy: newEconomy(pop, 1, 6), techs: [...(base.techs ?? [])] };
    sim.settlements.push(st);
    return st;
  };
  const learn = (sim: SimState, cultureId: string, ids: string[]) => {
    const cu = sim.cultures!.find((c) => c.id === cultureId)!;
    cu.behaviours = [...new Set([...cu.behaviours, ...ids])];
  };

  it('makes every clan a realm under a chief, and a settled clan that learned to rule together a chiefdom', () => {
    const sim = newSim(env, 301);
    const t = addTribe(sim, env, lib, humanId(), 6000, yAt(-12), -1, 150)!;
    const clan = sim.clans.find((c) => c.id === t.clan)!;
    expect(clan.realm?.gov).toBe('clan');
    expect(clan.realm?.ruler.house).toBe(clan.name);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 600, farming)!;
    town(sim, city, 80, 0, 200);
    stepDays(sim, env, lib, 1);
    learn(sim, city.culture, ['oral-law', 'tribal-council', 'settling']);
    nationsYear(ctx(sim));
    const realm = sim.clans.find((c) => c.id === city.clan)!.realm!;
    expect(realm.gov).toBe('chiefdom');
    expect(realm.capital).toBe(city.id);
    // Kept with the save.
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.clans.find((c) => c.id === city.clan)!.realm!.gov).toBe('chiefdom');
  });

  it('keeps a government its culture locks, once its people can have it', () => {
    const L = structuredClone(lib);
    const cu = newCulture('rabbit-ways', 'Rabbit ways');
    cu.races = [humanId()];
    cu.government = 'theocracy';
    cu.governmentHold = 'Locked';
    L.cultures.push(cu);
    const sim = newSim(env, 303);
    const city = addDawnCity(sim, env, L, humanId(), 6000, yAt(-12), 1200, farming)!;
    stepDays(sim, env, L, 1);
    expect(sim.cultures!.find((c) => c.id === city.culture)!.source).toBe('rabbit-ways');
    for (let y = 0; y < 3; y++) nationsYear(ctx(sim, L));
    expect(sim.clans.find((c) => c.id === city.clan)!.realm!.gov).toBe('theocracy');
  });

  it('holds near towns more firmly than far ones, and holds the far ones better along a road', () => {
    const sim = newSim(env, 305);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, farming)!;
    const near = town(sim, city, 60, 0, 200);
    const far = town(sim, city, 0, 400, 200);
    stepDays(sim, env, lib, 1);
    nationsYear(ctx(sim));
    expect(near.control!).toBeGreaterThan(far.control!);
    const before = far.control!;
    for (const k of pathCells(env, city.x, city.y, far.x, far.y, cellOf)) sim.way[k] = 3;
    nationsYear(ctx(sim));
    expect(far.control!).toBeGreaterThan(before * 1.3);
  });

  it('presses its culture on the towns it holds (an empire hard, a band of clans hardly at all)', () => {
    const L = structuredClone(lib);
    const cu = newCulture('imperial', 'Imperial');
    cu.races = [humanId()];
    cu.government = 'empire';
    cu.governmentHold = 'Locked';
    L.cultures.push(cu);
    const sim = newSim(env, 307);
    const city = addDawnCity(sim, env, L, humanId(), 6000, yAt(-12), 1500, farming)!;
    const elves = addDawnCity(sim, env, L, elfId(), 6000, yAt(-14), 200, farming)!;
    stepDays(sim, env, L, 1);
    learn(sim, city.culture, ['oral-law', 'tribal-council', 'royal-court', 'taxation']);
    // The elf town is taken into the human realm.
    elves.clan = city.clan;
    elves.holyTo = [];
    const was = elves.culture;
    for (let y = 0; y < 150 && elves.culture === was; y++) {
      nationsYear(ctx(sim, L));
      sim.day += DAYS_PER_YEAR;
    }
    expect(sim.clans.find((c) => c.id === city.clan)!.realm!.gov).toBe('empire');
    expect(elves.culture).toBe(city.culture);
    expect(sim.events.some((e) => e.text.includes(`${elves.name} has taken on the ways`))).toBe(true);
  });

  it('draws a small kindred clan nearby into a settled realm', () => {
    const sim = newSim(env, 309);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 2500, farming)!;
    town(sim, city, 90, 0, 600);
    town(sim, city, -90, 0, 600);
    stepDays(sim, env, lib, 1);
    learn(sim, city.culture, lib.behaviours.map((b) => b.id));
    const small = addTribe(sim, env, lib, humanId(), 6000, yAt(-13), -1, 100)!;
    small.culture = city.culture;
    sim.clans.find((c) => c.id === small.clan)!.culture = city.culture;
    for (let y = 0; y < 80 && small.clan !== city.clan; y++) nationsYear(ctx(sim));
    expect(sim.clans.find((c) => c.id === city.clan)!.realm!.gov).not.toBe('clan');
    expect(small.clan).toBe(city.clan);
  });
});

describe('politics', () => {
  const farming = ['agriculture', 'husbandry', 'fishing'];
  const ctx = (sim: SimState, L = lib): PoliticsContext => {
    const c: PoliticsContext = {
      sim,
      env,
      lib: L,
      rand: () => Math.random(),
      dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
      cellAt: cellOf,
      log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }),
      name: () => `N${sim.nextId++}`,
      lifespan: () => 70,
      newClan: (from) => {
        const nc: Clan = { id: sim.nextId++, name: 'Rebels', colour: '#000', species: from.species, race: from.race, culture: from.culture, founded: sim.day, parent: from.id, techs: [] };
        ensureRealm(c, nc);
        sim.clans.push(nc);
        return nc;
      },
    };
    return c;
  };
  const town = (sim: SimState, base: Settlement, dx: number, dy: number, pop: number): Settlement => {
    const st: Settlement = { ...base, id: sim.nextId++, kind: 'village', holyTo: [], x: base.x + dx, y: base.y + dy, pop, economy: newEconomy(pop, 1, 6), techs: [...(base.techs ?? [])] };
    sim.settlements.push(st);
    return st;
  };
  const realmOf = (sim: SimState, st: Settlement) => sim.clans.find((c) => c.id === st.clan)!;
  const old = (sim: SimState) => sim.day - 69 * DAYS_PER_YEAR;
  const kid = (sim: SimState, house: string, name: string, age: number) => ({ name, house, female: false, born: sim.day - age * DAYS_PER_YEAR });

  it('passes the throne to the eldest child where the eldest inherits', () => {
    const sim = newSim(env, 401);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, farming)!;
    stepDays(sim, env, lib, 1);
    const realm = realmOf(sim, city).realm!;
    realm.gov = 'petty-kingdom';
    const house = realm.ruler.house;
    for (let y = 0; y < 40 && realm.reigns === 1; y++) {
      realm.ruler.born = old(sim);
      realm.family = [kid(sim, house, 'Younger', 20), kid(sim, house, 'Eldest', 30)];
      politicsYear(ctx(sim));
    }
    expect(realm.ruler.name).toBe('Eldest');
    expect(realm.ruler.house).toBe(house);
  });

  it('makes the old line a claimant when a new house takes a true-line throne', () => {
    const L = structuredClone(lib);
    const g = newGovernment('lords-choose', 'Lords choose');
    Object.assign(g, { head: 'King or queen', land: 'Great lords with vassals (feudal)', succession: 'Election by lords', legitimacy: 'True line / sacred blood' });
    L.governments.push(g);
    const sim = newSim(env, 403);
    const city = addDawnCity(sim, env, L, humanId(), 6000, yAt(-12), 900, farming)!;
    stepDays(sim, env, L, 1);
    const realm = realmOf(sim, city).realm!;
    realm.gov = 'lords-choose';
    for (let y = 0; y < 80 && !realm.claimants?.length; y++) {
      realm.ruler.born = old(sim);
      realm.family = [kid(sim, realm.ruler.house, 'Heir', 25)];
      politicsYear(ctx(sim, L));
    }
    expect(realm.claimants?.[0]?.why).toBe('true line');
  });

  it('makes treaties between realms that send envoys, and remembers a broken one as a betrayal; allies take up the quarrel', () => {
    const sim = newSim(env, 405);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, farming)!;
    const b = addTribe(sim, env, lib, humanId(), 6200, yAt(-12), -1, 300)!;
    const c3 = addDawnCity(sim, env, lib, elfId(), 6100, yAt(-13), 900, farming)!;
    stepDays(sim, env, lib, 1);
    for (const cu of sim.cultures!) cu.behaviours.push('envoys');
    const B = sim.clans.find((q) => q.id === b.clan)!;
    const [A, C] = [realmOf(sim, a), realmOf(sim, c3)];
    for (let y = 0; y < 40 && !hasPact(sim, A.id, B.id, 'peace'); y++) politicsYear(ctx(sim));
    expect(hasPact(sim, A.id, B.id, 'peace')).toBe(true);
    // B and C are allies.
    sim.realmRelations![B.id < C.id ? `${B.id}|${C.id}` : `${C.id}|${B.id}`] = { opinion: 0.6, memory: 0, pacts: [{ kind: 'defence', since: sim.day }] };
    noteAttack(sim, lib, (text) => sim.events.push({ day: sim.day, text }), A.id, B.id);
    expect(hasPact(sim, A.id, B.id, 'peace')).toBe(false);
    expect(A.realm!.betrayals).toBe(1);
    expect(relationOf(sim, C.id, A.id)!.hostileUntil!).toBeGreaterThan(sim.day);
    // B striking back at A is justified: no betrayal.
    relationOf(sim, A.id, B.id)!.pacts.push({ kind: 'peace', since: sim.day });
    noteAttack(sim, lib, (text) => sim.events.push({ day: sim.day, text }), B.id, A.id);
    expect(B.realm!.betrayals ?? 0).toBe(0);
  });

  it('joins two realms by marriage when a line dies out', () => {
    const sim = newSim(env, 407);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, farming)!;
    const b = addDawnCity(sim, env, lib, elfId(), 6200, yAt(-12), 900, farming)!;
    stepDays(sim, env, lib, 1);
    const [A, B] = [realmOf(sim, a), realmOf(sim, b)];
    A.realm!.gov = 'petty-kingdom';
    B.realm!.gov = 'petty-kingdom';
    sim.realmRelations = { [A.id < B.id ? `${A.id}|${B.id}` : `${B.id}|${A.id}`]: { opinion: 0.5, memory: 0.2, pacts: [{ kind: 'marriage', since: sim.day }] } };
    for (let y = 0; y < 60 && sim.clans.includes(A); y++) {
      A.realm!.ruler.born = old(sim);
      A.realm!.family = [];
      A.realm!.claimants = [];
      B.realm!.ruler.born = sim.day;
      politicsYear(ctx(sim));
    }
    expect(sim.clans.includes(A)).toBe(false);
    expect(a.clan).toBe(B.id);
  });

  it('lets long-discontented towns far from the capital break away when they are the stronger', () => {
    const sim = newSim(env, 409);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, farming)!;
    stepDays(sim, env, lib, 1);
    const realm = realmOf(sim, city);
    realm.realm!.gov = 'feudal-kingdom';
    const near = town(sim, city, 50, 0, 200);
    const far = [town(sim, city, 0, 700, 400), town(sim, city, 60, 700, 400)];
    for (let y = 0; y < 80 && far[0].clan === realm.id; y++) {
      for (const s of far) {
        s.control = 0;
        s.warband = 300;
        s.fed = 0.5;
      }
      near.warband = 5;
      city.warband = 5;
      politicsYear(ctx(sim));
    }
    expect(far[0].clan).not.toBe(realm.id);
    expect(far[1].clan).toBe(far[0].clan);
    expect(sim.clans.find((c) => c.id === far[0].clan)!.parent).toBe(realm.id);
  });

  it('sends spies from a royal court to steal what a rival knows', () => {
    const sim = newSim(env, 411);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, farming)!;
    addDawnCity(sim, env, lib, elfId(), 6200, yAt(-12), 900, [...farming, 'pottery'])!;
    stepDays(sim, env, lib, 1);
    sim.cultures!.find((c) => c.id === a.culture)!.behaviours.push('royal-court');
    const c = ctx(sim);
    // Chance plays a part (a spy may not be sent, may watch instead, or be caught): a century is ample.
    for (let y = 0; y < 100 && !(a.techs ?? []).includes('pottery'); y++) {
      nationsYear(c);
      politicsYear(c);
      for (let d = 0; d < 30; d++) spiesDay(c);
    }
    expect(a.techs).toContain('pottery');
  });

  it('bridges a river on a settled realm’s road, which makes the crossing faster than fording', () => {
    const sim = newSim(env, 413);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, [...farming, 'roads', 'bridges', 'masonry'])!;
    const b = addDawnCity(sim, env, lib, elfId(), 6000 + env.step * 6, yAt(-12), 900, farming)!;
    const cells = pathCells(env, a.x, a.y, b.x, b.y, cellOf);
    const k = cells[Math.floor(cells.length / 2)];
    const was = env.fresh[k];
    env.fresh[k] = 1;
    try {
      const ford = pathSpeed(sim, cells, env.fresh);
      a.economy!.stores = { ...a.economy!.stores, stone: 500, hardwood: 500 };
      for (let y = 0; y < 5 && !sim.bridge?.[k]; y++) waysYear({ sim, env, lib, cellAt: cellOf, log: () => {}, royalRoads: [[a.id, b.id]], bridges: () => true });
      expect(sim.bridge![k]).toBe(1);
      expect(pathSpeed(sim, cells, env.fresh)).toBeGreaterThan(ford * 1.5);
    } finally {
      env.fresh[k] = was;
    }
  });
});

describe('faiths and gods', () => {
  const farming = ['agriculture', 'husbandry', 'fishing'];
  const ctx = (sim: SimState, L = lib): FaithContext => ({
    sim,
    env,
    lib: L,
    rand: () => Math.random(),
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    cellAt: cellOf,
    log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }),
    name: () => `N${sim.nextId++}`,
    lifespan: () => 70,
  });
  const town = (sim: SimState, base: Settlement, dx: number, dy: number, pop: number): Settlement => {
    const st: Settlement = { ...base, id: sim.nextId++, kind: 'village', holyTo: [], x: base.x + dx, y: base.y + dy, pop, economy: newEconomy(pop, 1, 6), techs: [...(base.techs ?? [])] };
    sim.settlements.push(st);
    return st;
  };
  const elfSpecies = () => lib.species.find((s) => s.name === 'Elf')!.id;
  const humanSpecies = () => lib.species.find((s) => s.name === 'Human')!.id;

  it('gives every people a faith from the start: the Library faith of its people, else its folk belief with a holy site', () => {
    const L = structuredClone(lib);
    const f = newFaith('starlight', 'The Starlight');
    f.species = [elfSpecies()];
    f.organization = 'Organized (temples and priesthood)';
    f.holySites = [{ name: 'The Star Pool', kind: 'Lake or spring', description: '' }];
    L.faiths.push(f);
    const sim = newSim(env, 501);
    const h = addDawnCity(sim, env, L, humanId(), 6000, yAt(-12), 900, farming)!;
    const e = addDawnCity(sim, env, L, elfId(), 6400, yAt(-12), 900, farming)!;
    stepDays(sim, env, L, DAYS_PER_YEAR);
    expect(e.faith).toBe('starlight');
    const folk = faithOf(sim, h.faith)!;
    expect(folk.source).toBe('');
    expect(folk.holySites[0].name).toBe(h.name);
    expect(faithOf(sim, 'starlight')!.maxOrganization).toBe(2);
    // Kept with the save.
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.settlements.find((q) => q.id === e.id)!.faith).toBe('starlight');
    expect(back.faiths!.length).toBe(sim.faiths!.length);
  });

  it('draws a small town into the faith of the big, fervent one beside it', () => {
    const sim = newSim(env, 503);
    const big = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 4000, [...farming, 'writing'])!;
    const small = addDawnCity(sim, env, lib, elfId(), 6060, yAt(-12), 150, farming)!;
    const c = ctx(sim);
    faithYear(c);
    expect(small.faith).not.toBe(big.faith);
    for (let y = 0; y < 40 && small.faith !== big.faith; y++) faithYear(c);
    expect(small.faith).toBe(big.faith);
  });

  it('lets an intolerant ruler press its faith on its towns, which are less loyal meanwhile', () => {
    const sim = newSim(env, 505);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 900, farming)!;
    const elves = addDawnCity(sim, env, lib, elfId(), 6000, yAt(-16), 300, farming)!;
    const c = ctx(sim);
    nationsYear(c);
    faithYear(c);
    elves.clan = city.clan;
    elves.holyTo = [];
    elves.control = 0.9;
    const rf = faithOf(sim, city.faith)!;
    rf.tolerance = 'Hostile';
    const clan = sim.clans.find((q) => q.id === city.clan)!;
    expect(faithLoyalty(sim, clan, elves)).toBeGreaterThan(0.25);
    for (let y = 0; y < 60 && elves.faith !== city.faith; y++) {
      elves.control = 0.9;
      faithYear(c);
    }
    expect(elves.faith).toBe(city.faith);
    expect(faithLoyalty(sim, clan, elves)).toBe(0);
  });

  it('lets the gods act when the world allows, and never when religion is belief only', () => {
    const L = structuredClone(lib);
    const g = newGod('sela', 'Sela');
    Object.assign(g, { domains: ['Harvest'], powers: ['Blessings', 'Choosing champions'], favouredSpecies: [humanSpecies()], activity: 5 });
    L.gods.push(g);
    for (const active of [false, true]) {
      const sim = newSim(env, 507);
      const city = addDawnCity(sim, env, L, humanId(), 6000, yAt(-12), 900, farming)!;
      sim.gods = { active, activity: 100 };
      const c = ctx(sim, L);
      nationsYear(c);
      for (let y = 0; y < 30; y++) faithYear(c);
      expect(faithOf(sim, city.faith)!.gods).toContain('sela');
      const acts = sim.events.filter((e) => e.text.startsWith('Sela')).length;
      if (!active) expect(acts).toBe(0);
      else {
        expect(acts).toBeGreaterThan(2);
        expect(sim.champions!.some((ch) => ch.clan === city.clan)).toBe(true);
        expect(championMight(sim, city.clan)).toBeGreaterThan(1);
      }
    }
  });

  it('lets far followers of an organized faith break off in a heresy', () => {
    const sim = newSim(env, 509);
    const city = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 3000, [...farming, 'writing'])!;
    town(sim, city, 80, 0, 500);
    const far = [town(sim, city, 0, 900, 700), town(sim, city, 80, 900, 700)];
    const c = ctx(sim);
    faithYear(c);
    const f = faithOf(sim, city.faith)!;
    for (let y = 0; y < 400 && far[0].faith === f.id; y++) {
      f.founded = sim.day - 100 * DAYS_PER_YEAR;
      f.fervour = 0.2;
      faithYear(c);
    }
    const nf = faithOf(sim, far[0].faith)!;
    expect(nf.id).not.toBe(f.id);
    expect(nf.parent).toBe(f.id);
    expect(far[1].faith).toBe(nf.id);
    expect(city.faith).toBe(f.id);
  });
});

describe('wars and armies', () => {
  const farming = ['agriculture', 'husbandry', 'fishing'];
  const ctx = (sim: SimState): WarContext => ({
    sim,
    env,
    lib,
    rand: () => Math.random(),
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    cellAt: cellOf,
    log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }),
    name: () => `N${sim.nextId++}`,
    lifespan: () => 70,
    might: () => 1,
    speed: () => 20,
  });
  const town = (sim: SimState, base: Settlement, dx: number, dy: number, pop: number): Settlement => {
    const st: Settlement = { ...base, id: sim.nextId++, name: `T${sim.nextId}`, kind: 'village', holyTo: [], x: base.x + dx, y: base.y + dy, pop, warband: pop * 0.1, economy: newEconomy(pop, 1, 6), techs: [...(base.techs ?? [])] };
    st.economy!.stores = { ...st.economy!.stores, grain: pop * 3 };
    sim.settlements.push(st);
    return st;
  };
  /** Two settled realms: a strong one and a weak one beside it. */
  const setup = (seed: number) => {
    const sim = newSim(env, seed);
    const a = addDawnCity(sim, env, lib, humanId(), 6000, yAt(-12), 3000, farming)!;
    const b = addDawnCity(sim, env, lib, elfId(), 6000, yAt(-14.5), 600, farming)!;
    a.economy!.stores = { ...a.economy!.stores, grain: 20000 };
    b.economy!.stores = { ...b.economy!.stores, grain: 4000 };
    a.warband = 600;
    b.warband = 60;
    const bt = town(sim, b, 60, 0, 300);
    const c = ctx(sim);
    nationsYear(c);
    const A = sim.clans.find((q) => q.id === a.clan)!;
    const B = sim.clans.find((q) => q.id === b.clan)!;
    A.realm!.gov = 'feudal-kingdom';
    B.realm!.gov = 'feudal-kingdom';
    return { sim, c, a, b, bt, A, B };
  };

  it('goes to war for a claim when it has the stronger army', () => {
    const { sim, c, bt, A, B } = setup(601);
    bt.claimedBy = [A.id];
    for (let y = 0; y < 200 && !sim.wars?.length; y++) warsYear(c);
    const w = sim.wars![0];
    expect(w.reason).toBe('claim');
    expect(w.goalTown).toBe(bt.id);
    expect(w.attackers[0]).toBe(A.id);
    expect(w.defenders[0]).toBe(B.id);
  });

  it('calls a defender’s allies into the war', () => {
    const { sim, c, A, B } = setup(603);
    // A separate realm (its own clan).
    const third = addTribe(sim, env, lib, humanId(), 6400, yAt(-14), -1, 300)!;
    const C = sim.clans.find((q) => q.id === third.clan)!;
    sim.realmRelations = { [B.id < C.id ? `${B.id}|${C.id}` : `${C.id}|${B.id}`]: { opinion: 0.6, memory: 0, pacts: [{ kind: 'defence', since: 0 }] } };
    let joined = false;
    for (let i = 0; i < 20 && !joined; i++) {
      sim.wars = [];
      const w = declareWar(c, A, B, { reason: 'revenge' });
      joined = w.defenders.includes(C.id);
    }
    expect(joined).toBe(true);
  });

  it('raises an army from its towns, feeds it from their stores, and sends the fighters home after', () => {
    const { sim, c, a, A, B } = setup(605);
    const before = a.pop;
    const w = declareWar(c, A, B, { reason: 'revenge' });
    const army = raiseArmy(c, A, w)!;
    expect(army.men).toBeGreaterThan(300);
    expect(a.pop).toBeLessThan(before);
    expect(army.supply).toBeGreaterThan(army.men);
    army.goal = 'home';
    armiesDay(c);
    expect(sim.armies!.includes(army)).toBe(false);
    expect(a.pop).toBeCloseTo(before, -1);
  });

  it('marches, fights and takes towns; peace cedes what it holds, with a truce', () => {
    const { sim, c, b, bt, A, B } = setup(607);
    bt.claimedBy = [A.id];
    declareWar(c, A, B, { reason: 'claim', town: bt });
    for (let d = 0; d < 360 * 6 && sim.wars![0].ended === undefined; d++) {
      armiesDay(c);
      sim.day++;
      if (sim.day % 30 === 0) warsMonth(c);
    }
    const w = sim.wars![0];
    expect(w.ended).toBeDefined();
    expect(w.outcome).toContain('won');
    expect(sim.battles!.length).toBeGreaterThan(0);
    expect([bt.clan, b.clan]).toContain(A.id);
    const lost = [bt, b].find((s) => s.clan === A.id)!;
    expect(lost.claimedBy).toContain(B.id);
    expect(relationOf(sim, A.id, B.id)!.truceUntil!).toBeGreaterThan(sim.day);
    // Kept with the save.
    const back = unpackSim(JSON.parse(JSON.stringify(packSim(sim, env))), env)!;
    expect(back.wars!.length).toBe(1);
    expect(back.battles!.length).toBe(sim.battles!.length);
  });

  it('raises foot, archers and riders by what the realm knows, and keeps a full report of each battle', () => {
    const { sim, c, a, b, A, B } = setup(611);
    a.techs = [...(a.techs ?? []), 'bows', 'riding'];
    const w = declareWar(c, A, B, { reason: 'revenge' });
    const ours = raiseArmy(c, A, w)!;
    expect(ours.units!.archers!).toBeGreaterThan(ours.men * 0.15);
    expect(ours.units!.riders!).toBeGreaterThan(ours.men * 0.05);
    expect(ours.heroes![0].kind).toBe('general');
    b.warband = 400;
    const theirs = raiseArmy(c, B, w)!;
    // Bring them face to face.
    theirs.x = ours.x + 3;
    theirs.y = ours.y;
    armiesDay(c);
    const battle = sim.battles!.find((q) => q.report)!;
    expect(battle.report!.phases.map((p) => p.name)).toEqual(['Skirmish', 'Clash', 'Pursuit']);
    expect(battle.report!.sides[0].units.archers!).toBeGreaterThan(0);
    expect(battle.until!).toBeGreaterThan(sim.day);
    // Both hold where they are while the fighting lasts.
    const at = { x: ours.x, y: ours.y };
    sim.day++;
    armiesDay(c);
    if ((ours.engagedUntil ?? 0) > sim.day) expect({ x: ours.x, y: ours.y }).toEqual(at);
  });

  it('wears down an army that has no food and no land to forage', () => {
    const { c, A, B } = setup(609);
    const w = declareWar(c, A, B, { reason: 'revenge' });
    const army = raiseArmy(c, A, w)!;
    army.supply = 0;
    // Out at sea, far from anything (no forage, no towns of its own).
    army.x = 6000 + 9000;
    army.y = yAt(-12);
    const men = army.men;
    for (let d = 0; d < 20; d++) armiesDay(c);
    expect(army.men).toBeLessThan(men * 0.9);
  });
});

describe('phased battles', () => {
  /** A seeded random stream, so the counts below repeat. */
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const side = (o: Partial<Side>): Side => ({ label: 'side', heroes: [], morale: 1, might: 1, arms: 1, ranged: 1, defending: false, walls: 1, mountain: false, flies: false, specialistName: 'specialists', ...o, units: { foot: 0, archers: 0, riders: 0, specialists: 0, ...(o.units ?? { foot: 1000 }) } });
  const open: Ground = { name: 'on open ground', hills: 0, river: false, forest: false, marsh: false };
  const forest: Ground = { name: 'in the forest', hills: 0, river: false, forest: true, marsh: false };
  const wins = (g: Ground, a: () => Side, b: () => Side, n = 300) => {
    const r = seeded(7);
    let w = 0;
    for (let i = 0; i < n; i++) if (fight(r, g, a(), b()).winner === 0) w++;
    return w / n;
  };

  it('fights in three phases, with losses by kind', () => {
    const r = fight(seeded(1), open, side({ units: { foot: 600, archers: 300, riders: 100 } }), side({ units: { foot: 900 } }));
    expect(r.phases.map((p) => p.name)).toEqual(['Skirmish', 'Clash', 'Pursuit']);
    expect(r.lost[1].foot!).toBeGreaterThan(0);
    // Only the side with archers did harm before the clash.
    expect(total(r.phases[0].lost[1])).toBeGreaterThan(total(r.phases[0].lost[0]));
  });

  it('lets riders win on open ground more than in forest', () => {
    const riders = () => side({ units: { foot: 300, riders: 500 } });
    const foot = () => side({ units: { foot: 900 } });
    expect(wins(open, riders, foot)).toBeGreaterThan(wins(forest, riders, foot) + 0.2);
  });

  it('gives defenders the edge on hills, behind rivers and behind walls', () => {
    const att = () => side({ units: { foot: 1000 } });
    const flat = wins(open, att, () => side({ units: { foot: 900 }, defending: true }));
    const river = wins({ ...open, river: true, hills: 1 }, att, () => side({ units: { foot: 900 }, defending: true }));
    const walled = wins(open, att, () => side({ units: { foot: 900 }, defending: true, walls: 1.8 }));
    expect(river).toBeLessThan(flat - 0.15);
    expect(walled).toBeLessThan(flat - 0.3);
  });

  it('lets heroes lift their side, duel, fall, and rise', () => {
    const hero = (name: string, power: number): Hero => ({ name, kind: 'hero', power, born: 0, deeds: 0, female: false });
    const even = wins(open, () => side({}), () => side({}));
    const led = wins(open, () => side({ heroes: [hero('Ara', 5), hero('Bel', 4)] }), () => side({}));
    expect(led).toBeGreaterThan(even + 0.1);
    const r = seeded(3);
    let duels = 0;
    let fell = 0;
    let rose = 0;
    for (let i = 0; i < 200; i++) {
      const out = fight(r, open, side({ heroes: [hero('Ara', 3)] }), side({ heroes: [hero('Cor', 3)] }));
      if (out.notes.some((n) => n.includes('between the lines'))) duels++;
      fell += out.fallen[0].length + out.fallen[1].length;
      if (out.risen) rose++;
    }
    expect(duels).toBeGreaterThan(50);
    expect(fell).toBeGreaterThan(20);
    expect(rose).toBeGreaterThan(10);
  });

  it('cuts down a routed side with riders, while its own riders screen it', () => {
    const chased = (screen: number) => {
      const r = seeded(11);
      let lost = 0;
      for (let i = 0; i < 200; i++) {
        const out = fight(r, open, side({ units: { foot: 1500, riders: 600 } }), side({ units: { foot: 600 - screen, riders: screen } }));
        lost += total(out.phases[2].lost[1]);
      }
      return lost;
    };
    expect(chased(0)).toBeGreaterThan(chased(250) * 1.3);
  });
});
