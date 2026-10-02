import { describe, expect, it } from 'vitest';
import { chronicleMarkdown, worldSnapshot } from '../src/engine/chronicle';
import { defaultConfig } from '../src/engine/config';
import { DEFAULT_RACES } from '../src/engine/data/races';
import { PRACTICE, TECHS, TECH_BY_ID } from '../src/engine/data/techs';
import { Rng } from '../src/engine/rng';
import { World } from '../src/engine/world';
import { LandUse } from '../src/engine/data/settlements';
import { ringRadius, useAllowed } from '../src/engine/systems/land';
import { friendly } from '../src/engine/systems/diplomacy';
import { settlementValue } from '../src/engine/systems/warAims';
import { generateMap } from '../src/engine/worldgen';

const small = (over = {}) => defaultConfig({ seed: 42, width: 120, height: 80, ...over });

describe('world generation', () => {
  it('honours the requested land fraction and produces rivers and varied biomes', () => {
    const cfg = small({ landFraction: 0.45 });
    const map = generateMap(cfg, new Rng(cfg.seed));
    let land = 0;
    let rivers = 0;
    const biomes = new Set<number>();
    for (let i = 0; i < map.size; i++) {
      if (map.elevation[i] >= 0) land++;
      if (map.river[i] > 0) rivers++;
      biomes.add(map.biome[i]);
    }
    expect(land / map.size).toBeGreaterThan(0.38);
    expect(land / map.size).toBeLessThan(0.5);
    expect(rivers).toBeGreaterThan(50);
    expect(biomes.size).toBeGreaterThanOrEqual(8);
  });

  it('places no ley lines in a world without magic', () => {
    const cfg = small({ magic: 0 });
    const map = generateMap(cfg, new Rng(cfg.seed));
    expect(map.resources[13].every((v) => v === 0)).toBe(true);
  });
});

describe('simulation', () => {
  it('is fully deterministic for a given seed and config', () => {
    const a = new World(small());
    const b = new World(small());
    a.run(80);
    b.run(80);
    expect(a.history.map((e) => e.text)).toEqual(b.history.map((e) => e.text));
    expect(a.stats.at(-1)).toEqual(b.stats.at(-1));
  });

  it('grows civilisations and keeps its bookkeeping consistent', () => {
    const w = new World(small());
    const start = w.stats[0].population;
    w.run(250);
    const st = w.stats.at(-1)!;
    expect(st.population).toBeGreaterThan(start * 3);
    expect(st.settlements).toBeGreaterThan(w.cfg.races.length * w.cfg.tribesPerHomeland);
    expect([...w.alivePolities()].some((p) => p.techs.has('agriculture'))).toBe(true);

    for (const s of w.settlements) {
      expect(Number.isFinite(s.pop)).toBe(true);
      if (!s.alive) continue;
      expect(w.map.settlementAt[s.tile]).toBe(s.id);
      expect(w.polities[s.polityId].alive).toBe(true);
      expect(w.cultures[s.cultureId]).toBeDefined();
      const sum = Object.values(s.races).reduce((x, y) => x + y, 0);
      expect(Math.abs(sum - s.pop)).toBeLessThan(1e-6 * Math.max(1, s.pop) + 1e-6);
    }
    for (const p of w.alivePolities()) {
      for (const id of p.settlementIds) expect(w.settlements[id].polityId).toBe(p.id);
      expect(w.settlements[p.capitalId].polityId).toBe(p.id);
      for (const t of p.techs) for (const pre of TECH_BY_ID.get(t)!.prereqs) expect(p.techs.has(pre)).toBe(true);
    }
    for (const war of w.wars) if (war.end === null) {
      expect(w.polities[war.attacker].alive && w.polities[war.defender].alive).toBe(true);
    }
  });

  it('never researches arcane techs or spawns monsters without magic', () => {
    const w = new World(small({ magic: 0, calamity: 3 }));
    w.run(200);
    for (const p of w.polities) for (const t of p.techs) expect(TECH_BY_ID.get(t)!.arcane).toBeFalsy();
    expect(w.history.some((e) => e.kind === 'monster')).toBe(false);
  });

  it('accepts a custom roster of peoples', () => {
    const giants = { ...DEFAULT_RACES[2], id: 'giant', name: 'Giant', plural: 'Giants', growth: 0.01 };
    const w = new World(small({ races: [DEFAULT_RACES[0], giants], tribesPerHomeland: 2 }));
    w.run(50);
    const raceIds = new Set(w.settlements.flatMap((s) => Object.keys(s.races)));
    expect([...raceIds].sort()).toEqual(['giant', 'human']);
  });
});

describe('trade, armies and cultures', () => {
  const w = new World(small());
  w.run(350);

  it('keeps settlements at least the configured spacing apart', () => {
    const alive = [...w.aliveSettlements()];
    for (const a of alive) for (const b of alive) {
      if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(w.cfg.settlementSpacing - 1e-9);
    }
  });

  it('records agreements on both sides', () => {
    for (const d of w.agreements.filter((x) => x.end === null)) {
      expect(w.polities[d.a].agreements.get(d.b)).toContain(d.id);
      expect(w.polities[d.b].agreements.get(d.a)).toContain(d.id);
      if (d.type === 'convoy') expect(d.giveGood).toBeDefined();
    }
  });

  it('builds roads no better than a nation knows how to', () => {
    for (let i = 0; i < w.map.size; i++) {
      const lvl = w.map.road[i] | 0;
      expect(lvl).toBeGreaterThanOrEqual(0);
      expect(lvl).toBeLessThanOrEqual(4);
    }
    expect([...w.map.road].some((r) => r >= 1)).toBe(true);
  });

  it('runs free-trader caravans that reach their markets', () => {
    expect(w.caravanTrips).toBeGreaterThan(0);
    for (const c of w.caravans) {
      expect(c.step).toBeLessThan(c.path.length);
      for (const x of c.cargo) expect(x.qty).toBeGreaterThanOrEqual(0);
      expect(c.capacity).toBeGreaterThan(0);
    }
  });

  it('fields armies only for wars that are being fought', () => {
    for (const a of w.armies) {
      expect(a.alive).toBe(true);
      expect(w.wars[a.warId].end).toBeNull();
      expect(a.size).toBeGreaterThan(0);
    }
    expect(w.history.some((e) => e.kind === 'army')).toBe(true);
  });

  it('develops survival traits from the environment', () => {
    expect(w.cultures.some((c) => c.traits.length > 0)).toBe(true);
    for (const c of w.cultures) expect(c.traits.length).toBeLessThanOrEqual(4);
  });
});

describe('politics, nobility and cohesion', () => {
  const w = new World(small({ seed: 3 }));
  w.run(400);
  const alive = [...w.alivePolities()];

  it('gives every nation past the tribal stage a ruling dynasty', () => {
    for (const p of alive) {
      if (p.government === 'tribe' || p.dynasty < 0) continue;
      const h = w.nobles[p.dynasty];
      expect(h.polityId).toBe(p.id);
      expect(h.extinct).toBeNull();
    }
    expect(alive.some((p) => p.dynasty >= 0)).toBe(true);
    expect(w.history.some((e) => e.kind === 'nobility')).toBe(true);
  });

  it('grants fiefs only to houses of the same nation', () => {
    for (const s of w.aliveSettlements()) {
      if (s.holder < 0) continue;
      expect(w.nobles[s.holder].polityId).toBe(s.polityId);
    }
  });

  it('keeps pacts and confederations consistent and never at war with a friend', () => {
    for (const x of w.pacts.filter((x) => x.end === null)) {
      expect(w.polities[x.a].pacts.has(x.id)).toBe(true);
      expect(w.polities[x.b].pacts.has(x.id)).toBe(true);
    }
    for (const c of w.confederations.filter((c) => c.dissolved === null)) {
      expect(c.members.length).toBeGreaterThanOrEqual(2);
      for (const m of c.members) expect(w.polities[m].confederation).toBe(c.id);
    }
    for (const war of w.wars.filter((x) => x.end === null)) {
      expect(friendly(w, war.attacker, war.defender)).toBe(false);
    }
    for (const p of alive) if (p.overlord >= 0) expect(p.overlord).not.toBe(p.id);
  });

  it('tracks loyalty, claims and connection to the capital', () => {
    for (const s of w.aliveSettlements()) {
      expect(s.loyalty).toBeGreaterThanOrEqual(0);
      expect(s.loyalty).toBeLessThanOrEqual(1);
      expect(s.claims[s.polityId]).toBeUndefined();
      if (w.polities[s.polityId].capitalId === s.id) expect(s.connected).toBe(true);
    }
    expect([...w.aliveSettlements()].some((s) => Object.keys(s.claims).length > 0)).toBe(true);
  });

  it('values a claimed town more than it would otherwise', () => {
    const s = [...w.aliveSettlements()].find((x) => Object.keys(x.claims).length > 0)!;
    const claimant = w.polities[+Object.keys(s.claims)[0]];
    const withClaim = settlementValue(w, claimant, s).value;
    const saved = s.claims;
    s.claims = {};
    const without = settlementValue(w, claimant, s).value;
    s.claims = saved;
    expect(withClaim).toBeGreaterThan(without);
  });
});

describe('seasons, settlers and occupation', () => {
  const w = new World(small({ seed: 5 }));
  w.run(250);

  it('brings in the harvest in autumn and eats it through the year', () => {
    const farms = [...w.aliveSettlements()].filter((s) => s.labor[1] > s.labor[0]);
    expect(farms.length).toBeGreaterThan(0);
    const food = () => farms.reduce((n, s) => n + s.stock[0], 0);
    for (let m = 0; m < 6; m++) w.stepMonth();
    const summer = food();
    for (let m = 6; m < 10; m++) w.stepMonth();
    expect(food()).toBeGreaterThan(summer);
    while (w.month !== 0) w.stepMonth();
    for (const s of w.aliveSettlements()) expect(s.foodSchedule.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('sends settlers on the road and founds settlements where they arrive', () => {
    expect(w.history.some((e) => e.kind === 'founding' && e.text.includes('on the road'))).toBe(true);
    for (const p of w.settlers) {
      expect(p.path.length).toBeGreaterThan(1);
      expect(p.step).toBeLessThan(p.path.length);
      expect(p.people).toBeGreaterThan(0);
    }
  });

  it('occupies towns only in wartime and only hands them over at the peace', () => {
    for (const s of w.aliveSettlements()) {
      if (s.occupiedBy < 0) continue;
      expect(s.occupiedBy).not.toBe(s.polityId);
      expect(w.atWar(s.occupiedBy, s.polityId)).toBe(true);
    }
  });
});

describe('land', () => {
  const w = new World(small({ seed: 9 }));
  w.run(300);

  it('gives each settlement the ring of land around its own tile, shared out with its neighbours', () => {
    const seen = new Set<number>();
    const R = ringRadius(w);
    for (const s of w.aliveSettlements()) {
      expect(w.map.owner[s.tile]).toBe(s.id);
      expect(s.territory.length).toBeLessThanOrEqual((2 * R + 1) ** 2);
      for (const t of s.territory) {
        expect(w.map.owner[t]).toBe(s.id);
        expect(Math.max(Math.abs((t % w.map.width) - s.x), Math.abs(Math.floor(t / w.map.width) - s.y))).toBeLessThanOrEqual(R);
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
    for (let t = 0; t < w.map.size; t++) if (w.map.owner[t] >= 0) expect(seen.has(t)).toBe(true);
  });

  it('puts each tile to a use the ground allows, and grows past a single tile', () => {
    for (const s of w.aliveSettlements()) for (const t of s.territory) {
      const u = w.map.landUse[t];
      if (u !== LandUse.None) expect(useAllowed(w, t, u)).toBe(true);
    }
    expect([...w.aliveSettlements()].some((s) => s.territory.length >= 12)).toBe(true);
    expect([...w.aliveSettlements()].some((s) => s.territory.some((t) => w.map.landUse[t] === LandUse.Fields))).toBe(true);
  });
});

describe('work and trade', () => {
  const w = new World(small({ seed: 13 }));
  w.run(250);

  it('keeps people in their trades, changing slowly when not hungry', () => {
    const before = new Map([...w.aliveSettlements()].map((s) => [s.id, Float64Array.from(s.labor)]));
    w.tick();
    let checked = 0;
    for (const s of w.aliveSettlements()) {
      const old = before.get(s.id);
      if (!old || s.foodRatio < 0.95 || s.lastHungry > 1) continue;
      const total = old.reduce((a, b) => a + b, 0);
      if (total < 50) continue;
      let moved = 0;
      for (let k = 0; k < old.length; k++) moved += Math.max(0, s.labor[k] - old[k]);
      expect(moved).toBeLessThan(total * 0.35);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('has every village and hamlet trade through a market of its own nation', () => {
    for (const s of w.aliveSettlements()) {
      const m = w.settlements[s.marketId];
      expect(m.alive).toBe(true);
      expect(m.polityId).toBe(s.polityId);
      expect(m.marketId).toBe(m.id);
      if (s.tier >= 3) expect(s.marketId).toBe(s.id);
    }
    for (const c of w.caravans) if (c.kind !== 'convoy') expect(w.settlements[c.homeId].marketId).toBe(c.homeId);
  });

  it('rarely has a settlement both buy and sell the same good', () => {
    const towns = [...w.aliveSettlements()];
    const both = towns.filter((s) => s.yearSold.some((q, g) => q > 1 && s.yearBought[g] > 1));
    expect(both.length).toBeLessThan(towns.length * 0.15);
  });
});

describe('development', () => {
  const w = new World(small({ seed: 21 }));
  w.run(400);

  it('builds towns over their least needed land, from their own tile out, and never farms it again', () => {
    const towns = [...w.aliveSettlements()].filter((s) => s.cityTiles > 0);
    expect(towns.length).toBeGreaterThan(0);
    for (const s of towns) {
      expect(w.map.landUse[s.tile]).toBe(LandUse.City);
      expect(s.territory.filter((t) => w.map.landUse[t] === LandUse.City).length).toBe(s.cityTiles);
    }
    // Villages that were never towns have no City land; a town that shrinks keeps its streets.
    for (const s of w.aliveSettlements()) if (s.peakPop < 2000) expect(s.cityTiles).toBe(0);
  });

  it('lets settlements grow past what their building skills hold in comfort, at a cost', () => {
    for (const s of w.aliveSettlements()) {
      expect(s.crowding).toBeGreaterThanOrEqual(0);
      expect(s.urbanPop).toBeLessThanOrEqual(s.pop + 1e-6);
    }
    const crafts = [...w.aliveSettlements()].map((s) => s.labor.slice(15).reduce((a, b) => a + b, 0) / Math.max(1, s.labor.reduce((a, b) => a + b, 0) + s.idle));
    expect(Math.max(...crafts)).toBeLessThanOrEqual(0.6);
  });
});

describe('technology', () => {
  const w = new World(small({ seed: 4 }));
  w.run(300);

  it('learns technology through practice, never knowing a tech without its prerequisites', () => {
    const known = [...w.alivePolities()].reduce((n, p) => n + p.techs.size, 0);
    expect(known).toBeGreaterThan(0);
    for (const p of w.alivePolities()) {
      for (const [id] of p.progress) {
        expect(p.techs.has(id)).toBe(false);
        expect(PRACTICE[id]?.length ?? 0).toBeGreaterThan(0);
      }
    }
    for (const t of TECHS) expect(PRACTICE[t.id]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('real time', () => {
  it('advances month by month and reaches the same year as whole-year steps', () => {
    const a = new World(small());
    const b = new World(small());
    a.run(3);
    for (let m = 0; m < 36; m++) b.stepMonth();
    expect(b.year).toBe(3);
    expect(b.month).toBe(0);
    expect(b.stats.at(-1)).toEqual(a.stats.at(-1));
  });
});

describe('exports', () => {
  it('writes a readable chronicle and a JSON-safe snapshot', () => {
    const w = new World(small());
    w.run(120);
    const md = chronicleMarkdown(w, 1);
    expect(md).toContain('# The World of');
    expect(md).toContain('## Chronicle');
    expect(md).toContain('## Nations');
    const snap = JSON.parse(JSON.stringify(worldSnapshot(w))) as { settlements: unknown[]; year: number };
    expect(snap.year).toBe(120);
    expect(snap.settlements.length).toBe(w.settlements.length);
  });
});
