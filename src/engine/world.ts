import { GOOD_BASE_PRICE, GOOD_COUNT, Good, RES_COUNT, SECTOR_COUNT } from './data/economy';
import { MAX_EFFECTS, TECH_BY_ID, baseEffects, type TechEffects } from './data/techs';
import { NameBook, adjectiveOf, deriveLanguage, mutateLanguage, randomColor } from './names';
import { Pathfinder } from './pathfinding';
import { Rng } from './rng';
import { runCulture } from './systems/culture';
import { runConsumption, runProduction } from './systems/economy';
import { runEvents } from './systems/events';
import { runMigration } from './systems/migration';
import { runPolitics } from './systems/politics';
import { placePeoples } from './systems/setup';
import { runTechnology } from './systems/technology';
import { updateTerritory } from './systems/territory';
import { buildTradeLinks, runTrade, runTribute, updateRoads } from './systems/trade';
import type {
  Culture, CultureValues, EventKind, Government, HistoryEvent, MapData, Polity, RaceDef, Ruler,
  Settlement, TradeLink, War, WorldConfig, YearStats,
} from './types';
import { VALUE_KEYS } from './types';
import { generateMap } from './worldgen';

export interface EventRefs {
  settlements?: number[];
  polities?: number[];
  cultures?: number[];
  tile?: number;
}

const RULER_TRAITS = ['ambitious', 'wise', 'cruel', 'pious', 'merchant', 'builder', 'just', 'weak', 'warlike', 'scholarly'];

export class World {
  readonly cfg: WorldConfig;
  readonly rng: Rng;
  readonly map: MapData;
  readonly races: RaceDef[];
  readonly raceById: Map<string, RaceDef>;
  year = 0;
  settlements: Settlement[] = [];
  polities: Polity[] = [];
  cultures: Culture[] = [];
  wars: War[] = [];
  links: TradeLink[] = [];
  history: HistoryEvent[] = [];
  stats: YearStats[] = [];
  /** Border length (tiles) between pairs of polities, key = pairKey(a, b). */
  borders = new Map<number, number>();
  /** First polity to discover each tech. */
  firstTech = new Map<string, number>();
  readonly names = new NameBook();
  readonly pathfinder: Pathfinder;
  linksDirty = true;
  territoryDirty = true;
  tradeVolume = 0;
  /** One-off markers (milestones reached, throttled log keys). */
  flags = new Set<string>();

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.map = generateMap(cfg, this.rng.fork('map'));
    this.races = cfg.races;
    this.raceById = new Map(this.races.map((r) => [r.id, r]));
    this.pathfinder = new Pathfinder(this.map);
    placePeoples(this);
    updateTerritory(this);
    this.recordStats();
  }

  // ---------------------------------------------------------------- main loop

  /** Advance the world by one year. */
  tick(): void {
    this.year++;
    if (this.territoryDirty || this.year % 5 === 0) updateTerritory(this);
    if (this.year % 10 === 0) {
      updateRoads(this);
      buildTradeLinks(this, true);
    } else if (this.linksDirty) buildTradeLinks(this, false);
    runEvents(this);
    runProduction(this);
    runTrade(this);
    runTribute(this);
    runConsumption(this);
    runMigration(this);
    runCulture(this);
    runPolitics(this);
    runTechnology(this);
    this.recordStats();
  }

  run(years: number): void {
    for (let i = 0; i < years; i++) this.tick();
  }

  // ---------------------------------------------------------------- helpers

  log(kind: EventKind, importance: number, text: string, refs: EventRefs = {}): void {
    this.history.push({ year: this.year, kind, importance, text, ...refs });
  }

  *aliveSettlements(): Generator<Settlement> {
    for (const s of this.settlements) if (s.alive) yield s;
  }

  *alivePolities(): Generator<Polity> {
    for (const p of this.polities) if (p.alive) yield p;
  }

  majorityRaceId(s: Settlement): string {
    let best = '';
    let bn = -1;
    for (const r in s.races) {
      if (s.races[r] > bn) {
        bn = s.races[r];
        best = r;
      }
    }
    return best;
  }

  majorityRace(s: Settlement): RaceDef {
    return this.raceById.get(this.majorityRaceId(s)) ?? this.races[0];
  }

  polityOf(s: Settlement): Polity {
    return this.polities[s.polityId];
  }

  cultureOf(s: Settlement): Culture {
    return this.cultures[s.cultureId];
  }

  atWar(a: number, b: number): boolean {
    if (a === b) return false;
    const pa = this.polities[a];
    for (const wid of pa.wars) {
      const w = this.wars[wid];
      if ((w.attacker === a && w.defender === b) || (w.attacker === b && w.defender === a)) return true;
    }
    return false;
  }

  tileName(tile: number): string {
    return `(${tile % this.map.width}, ${Math.floor(tile / this.map.width)})`;
  }

  // ---------------------------------------------------------------- creation

  createCulture(raceId: string, parent: Culture | null, originSettlement: number, values?: CultureValues): Culture {
    const race = this.raceById.get(raceId)!;
    const language = parent ? mutateLanguage(this.rng, parent.language) : deriveLanguage(this.rng, race.phonemes);
    const { name, adjective } = this.names.culture(this.rng, language);
    const baseValues: CultureValues = values ?? (Object.fromEntries(VALUE_KEYS.map((k) => [k, race.values[k] ?? 0.5])) as unknown as CultureValues);
    const v = { ...baseValues };
    for (const k of VALUE_KEYS) v[k] = Math.min(1, Math.max(0, v[k] + this.rng.normal() * (parent ? 0.08 : 0.05)));
    const c: Culture = {
      id: this.cultures.length,
      name,
      adjective,
      raceId,
      parentId: parent ? parent.id : -1,
      founded: this.year,
      alive: true,
      extinct: null,
      color: randomColor(this.rng, [35, 70], [45, 65]),
      values: v,
      language,
      originSettlement,
    };
    this.cultures.push(c);
    return c;
  }

  createSettlement(tile: number, polityId: number, cultureId: number, races: Record<string, number>, parentId: number): Settlement {
    const culture = this.cultures[cultureId];
    const map = this.map;
    const pop = Object.values(races).reduce((a, b) => a + b, 0);
    const s: Settlement = {
      id: this.settlements.length,
      name: this.names.settlement(this.rng, culture.language),
      tile,
      x: tile % map.width,
      y: Math.floor(tile / map.width),
      founded: this.year,
      alive: true,
      abandoned: null,
      polityId,
      cultureId,
      parentId,
      races: { ...races },
      pop,
      housing: pop * 1.3 + 40,
      stock: new Float64Array(GOOD_COUNT),
      price: Float64Array.from(GOOD_BASE_PRICE),
      target: new Float64Array(GOOD_COUNT),
      produced: new Float64Array(GOOD_COUNT),
      consumed: new Float64Array(GOOD_COUNT),
      imported: new Float64Array(GOOD_COUNT),
      exported: new Float64Array(GOOD_COUNT),
      labor: new Float64Array(SECTOR_COUNT),
      toolQuality: 0,
      weaponQuality: 0,
      wealth: pop * 0.2,
      stability: 0.75,
      foodRatio: 1,
      climate: 1,
      territory: [],
      resSum: new Float64Array(RES_COUNT),
      habitat: 0,
      tributeIn: 0,
      coastal: map.coastal[tile] === 1,
      river: map.river[tile] > 0,
      landmass: map.landmass[tile],
      links: [],
      plague: 0,
      immunity: 0,
      drift: 0,
      lastColonized: this.year,
      greatWorks: [],
      peakPop: pop,
    };
    s.stock[Good.Food] = pop * 0.6;
    s.stock[Good.Timber] = pop * 0.2;
    this.settlements.push(s);
    map.settlementAt[tile] = s.id;
    this.territoryDirty = true;
    this.linksDirty = true;
    return s;
  }

  createPolity(cultureId: number, capital: Settlement, parentPolity = -1, techs?: Iterable<string>): Polity {
    const culture = this.cultures[cultureId];
    const p: Polity = {
      id: this.polities.length,
      name: '',
      baseName: this.names.polity(this.rng, culture.language),
      government: 'tribe',
      capitalId: capital.id,
      cultureId,
      founded: this.year,
      alive: true,
      dissolved: null,
      color: randomColor(this.rng),
      techs: new Set(techs ?? []),
      researching: null,
      researchProgress: 0,
      effects: baseEffects(),
      ruler: null as unknown as Ruler,
      pastRulers: [],
      relations: new Map(),
      contacts: new Map(),
      truces: new Map(),
      wars: new Set(),
      warExhaustion: 0,
      treasury: 0,
      settlementIds: [capital.id],
      pop: capital.pop,
      military: 0,
      stability: 0.75,
      access: new Uint8Array(GOOD_COUNT),
      popHistory: [],
      parentPolity,
    };
    this.polities.push(p);
    capital.polityId = p.id;
    this.recomputeEffects(p);
    p.ruler = this.newRuler(p);
    p.name = this.polityName(p);
    return p;
  }

  recomputeEffects(p: Polity): void {
    const fx: TechEffects = baseEffects();
    for (const id of p.techs) {
      const t = TECH_BY_ID.get(id);
      if (!t) continue;
      for (const [k, v] of Object.entries(t.effects) as [keyof TechEffects, number][]) {
        if (MAX_EFFECTS.includes(k)) fx[k] = Math.max(fx[k], v);
        else fx[k] += v;
      }
    }
    p.effects = fx;
  }

  rulerTitle(gov: Government, female: boolean): string {
    switch (gov) {
      case 'tribe': return female ? 'Chieftess' : 'Chieftain';
      case 'chiefdom': return 'High Chief';
      case 'city-state': return 'Archon';
      case 'kingdom': return female ? 'Queen' : 'King';
      case 'empire': return female ? 'Empress' : 'Emperor';
      case 'republic': return 'First Consul';
      case 'theocracy': return female ? 'High Priestess' : 'High Priest';
    }
  }

  newRuler(p: Polity): Ruler {
    const capital = this.settlements[p.capitalId];
    const raceId = capital ? this.majorityRaceId(capital) : this.cultures[p.cultureId].raceId;
    const race = this.raceById.get(raceId) ?? this.races[0];
    const female = this.rng.chance(0.5);
    const traits: string[] = [];
    const nTraits = this.rng.int(1, 2);
    while (traits.length < nTraits) {
      const t = this.rng.pick(RULER_TRAITS);
      if (!traits.includes(t)) traits.push(t);
    }
    const age = Math.round(race.lifespan * this.rng.range(0.25, 0.5));
    return {
      name: this.names.person(this.rng, this.cultures[p.cultureId].language),
      title: this.rulerTitle(p.government, female),
      raceId,
      born: this.year - age,
      since: this.year,
      until: null,
      traits,
    };
  }

  polityName(p: Polity): string {
    const culture = this.cultures[p.cultureId];
    const race = this.raceById.get(culture.raceId);
    const capital = this.settlements[p.capitalId];
    const defaults: Record<Government, string> = {
      tribe: '{name} Tribe',
      chiefdom: '{name} Chiefdom',
      'city-state': 'City-State of {capital}',
      kingdom: 'Kingdom of {name}',
      empire: '{adj} Empire',
      republic: 'Republic of {name}',
      theocracy: 'Holy Dominion of {name}',
    };
    const tpl = race?.titles?.[p.government] ?? defaults[p.government];
    return tpl
      .replace('{name}', p.baseName)
      .replace('{capital}', capital ? capital.name : p.baseName)
      .replace('{adj}', adjectiveOf(p.baseName));
  }

  // ---------------------------------------------------------------- stats

  recordStats(): void {
    const byRace: Record<string, number> = {};
    let population = 0;
    let settlements = 0;
    for (const s of this.aliveSettlements()) {
      settlements++;
      population += s.pop;
      for (const r in s.races) byRace[r] = (byRace[r] ?? 0) + s.races[r];
    }
    let polities = 0;
    for (const p of this.alivePolities()) {
      polities++;
      if (this.year % 5 === 0) p.popHistory.push([this.year, Math.round(p.pop)]);
    }
    let cultures = 0;
    for (const c of this.cultures) if (c.alive) cultures++;
    let wars = 0;
    for (const w of this.wars) if (w.end === null) wars++;
    this.stats.push({ year: this.year, population, settlements, polities, cultures, byRace, wars, tradeVolume: this.tradeVolume });
  }
}

export function pairKey(a: number, b: number): number {
  return a < b ? a * 65536 + b : b * 65536 + a;
}
