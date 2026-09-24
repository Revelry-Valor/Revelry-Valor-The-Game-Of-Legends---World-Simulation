import { describe, expect, it } from 'vitest';
import { chronicleMarkdown, worldSnapshot } from '../src/engine/chronicle';
import { defaultConfig } from '../src/engine/config';
import { DEFAULT_RACES } from '../src/engine/data/races';
import { TECH_BY_ID } from '../src/engine/data/techs';
import { Rng } from '../src/engine/rng';
import { World } from '../src/engine/world';
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

  it('only trades across borders under an agreement', () => {
    for (const l of [...w.links, ...w.hubLinks]) {
      const A = w.settlements[l.a];
      const B = w.settlements[l.b];
      if (l.kind === 'treaty') expect(w.polities[A.polityId].agreements.has(B.polityId)).toBe(true);
      if (l.hub) expect(A.polityId === B.polityId || l.kind !== 'treaty').toBe(true);
    }
    for (const d of w.agreements.filter((x) => x.end === null)) {
      expect(w.polities[d.a].agreements.get(d.b)).toBe(d.id);
      expect(w.polities[d.b].agreements.get(d.a)).toBe(d.id);
    }
  });

  it('runs free-trader caravans that reach their markets', () => {
    expect(w.caravanTrips).toBeGreaterThan(0);
    for (const c of w.caravans) {
      expect(c.step).toBeLessThan(c.path.length);
      expect(c.qty).toBeGreaterThanOrEqual(0);
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
