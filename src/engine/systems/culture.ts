import { BIOMES, Relief, type BiomeKey } from '../data/biomes';
import { GOOD_BASE_PRICE, GOOD_COUNT, Res, SECTOR_KEYS, type SectorKey } from '../data/economy';
import { MAX_TRAITS, TRAITS, TRAIT_BY_ID, combineTraits, type CultureEnvironment } from '../data/traits';
import type { Culture, CultureValues, Settlement } from '../types';
import { VALUE_KEYS } from '../types';
import type { World } from '../world';

interface CultureAgg {
  n: number;
  pop: number;
  coastal: number;
  war: number;
  hardship: number;
  trade: number;
  research: number;
  core: Settlement | null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Cultures adapt their values to how their people live, drift apart when separated by
 * distance, sea or foreign rule (eventually splitting into new cultures with their own
 * dialects), and are absorbed by the dominant culture of the realm they live in.
 */
export function runCulture(world: World): void {
  const agg: CultureAgg[] = world.cultures.map(() => ({ n: 0, pop: 0, coastal: 0, war: 0, hardship: 0, trade: 0, research: 0, core: null }));
  for (const s of world.aliveSettlements()) {
    const a = agg[s.cultureId];
    const pol = world.polities[s.polityId];
    a.n++;
    a.pop += s.pop;
    if (s.coastal) a.coastal += s.pop;
    if (pol.wars.size > 0) a.war += s.pop;
    a.hardship += (Math.max(0, 1 - s.foodRatio) + s.plague) * s.pop;
    for (const li of s.links) a.trade += world.links[li].volume * 0.5;
    if (!a.core || s.pop > a.core.pop) a.core = s;
  }

  for (const c of world.cultures) {
    if (!c.alive) continue;
    const a = agg[c.id];
    if (a.n === 0) {
      c.alive = false;
      c.extinct = world.year;
      world.log('culture', 2, `The last communities of the ${c.name} culture were lost or absorbed; their ways live on only in memory.`, { cultures: [c.id] });
      continue;
    }
    const v = c.values;
    const r = 0.004;
    v.seafaring = clamp01(lerp(v.seafaring, (a.coastal / a.pop) * 0.9, r));
    v.militarism = clamp01(lerp(v.militarism, 0.25 + 0.7 * (a.war / a.pop), r * 0.6));
    v.mercantilism = clamp01(lerp(v.mercantilism, Math.min(0.95, (a.trade / Math.max(1, a.pop)) * 2), r * 0.5));
    v.piety = clamp01(lerp(v.piety, 0.35 + Math.min(0.6, (a.hardship / a.pop) * 3), r * 0.5));
    v.tradition = clamp01(v.tradition + 0.0008 * (0.95 - v.tradition));
    // Traits pull values towards the way of life they reflect.
    for (const id of c.traits) {
      const tv = TRAIT_BY_ID.get(id)?.values;
      if (tv) for (const k of VALUE_KEYS) if (tv[k] !== undefined) v[k] = clamp01(lerp(v[k], tv[k]!, 0.01));
    }
  }
  if (world.year % 5 === 0) developTraits(world);

  const alive = [...world.aliveSettlements()];
  for (const s of alive) {
    const c = world.cultures[s.cultureId];
    // Cultures born earlier in this loop have no aggregate yet.
    const core = agg[s.cultureId]?.core;
    if (core === undefined) continue;
    if (!core || core.id === s.id) {
      s.drift = Math.max(0, s.drift - 0.01);
      continue;
    }
    let sameLinks = 0;
    for (const li of s.links) {
      const l = world.links[li];
      const o = world.settlements[l.a === s.id ? l.b : l.a];
      if (o.alive && o.cultureId === s.cultureId) sameLinks++;
    }
    const dCore = Math.hypot(s.x - core.x, s.y - core.y);
    const isolation = 1 / (1 + sameLinks);
    const overseas = s.landmass !== core.landmass ? 0.006 : 0;
    const foreign = world.polities[s.polityId].cultureId !== s.cultureId ? 0.002 : 0;
    s.drift += (0.0012 * Math.min(dCore, 50)) / 10 + 0.0025 * isolation + overseas + foreign - 0.0006 * sameLinks * (1 - isolation) - (dCore < 10 ? 0.004 : 0);
    s.drift = Math.max(0, s.drift * (1 - 0.1 * (1 - c.values.tradition) * 0.1));
    if (s.drift > 1.5 && s.pop > 400) splitCulture(world, s);
  }

  // Assimilation into the ruling culture.
  for (const s of alive) {
    const pol = world.polities[s.polityId];
    if (pol.cultureId === s.cultureId) continue;
    const c = world.cultures[s.cultureId];
    const ruling = world.cultures[pol.cultureId];
    let chance = 0.01 * (1 - c.values.tradition * 0.8) * (1 - c.values.xenophobia * 0.3);
    if (c.raceId !== ruling.raceId) chance *= 0.4;
    if (world.majorityRaceId(s) !== ruling.raceId) chance *= 0.4;
    if (world.rng.chance(chance)) {
      world.log('culture', 1, `The people of ${s.name} adopted the ${ruling.adjective} tongue and customs of ${pol.name}.`, { settlements: [s.id], cultures: [c.id, ruling.id], polities: [pol.id] });
      s.cultureId = pol.cultureId;
      s.drift = 0;
    }
  }
}

function splitCulture(world: World, s: Settlement): void {
  const parent = world.cultures[s.cultureId];
  // A mixed town may give rise to a culture of whichever people now predominate.
  const raceId = world.majorityRaceId(s) || parent.raceId;
  const values: CultureValues = { ...parent.values };
  const nc: Culture = world.createCulture(raceId, parent, s.id, values);
  const group = [s];
  for (const li of s.links) {
    const l = world.links[li];
    const o = world.settlements[l.a === s.id ? l.b : l.a];
    if (o.alive && o.cultureId === parent.id && o.drift > 0.75 && Math.hypot(o.x - s.x, o.y - s.y) < 10) group.push(o);
  }
  for (const g of group) {
    g.cultureId = nc.id;
    g.drift = 0;
  }
  world.log(
    'culture',
    2,
    `Around ${s.name}, the ${parent.adjective} ways had drifted so far that a new people arose: the ${nc.name}${group.length > 1 ? `, spanning ${group.length} settlements` : ''}.`,
    { settlements: group.map((g) => g.id), cultures: [nc.id, parent.id], polities: [s.polityId] },
  );
}

/** What each culture's people live with: their land, their work, their hardships. */
function measureEnvironments(world: World): Map<number, CultureEnvironment> {
  const map = world.map;
  const acc = new Map<number, { tiles: number; biome: Record<string, number>; hills: number; mountains: number; horses: number; pop: number; coastal: number; river: number; labor: Float64Array; imports: number; output: number; famine: number; plague: number; war: number }>();
  for (const s of world.aliveSettlements()) {
    let a = acc.get(s.cultureId);
    if (!a) {
      a = { tiles: 0, biome: {}, hills: 0, mountains: 0, horses: 0, pop: 0, coastal: 0, river: 0, labor: new Float64Array(SECTOR_KEYS.length), imports: 0, output: 0, famine: 0, plague: 0, war: 0 };
      acc.set(s.cultureId, a);
    }
    for (const t of s.territory) {
      if (map.elevation[t] < 0) continue;
      a.tiles++;
      const key = BIOMES[map.biome[t]].key;
      a.biome[key] = (a.biome[key] ?? 0) + 1;
      if (map.relief[t] === Relief.Hills) a.hills++;
      else if (map.relief[t] === Relief.Mountains) a.mountains++;
    }
    a.horses += s.resSum[Res.Horses];
    a.pop += s.pop;
    if (s.coastal) a.coastal += s.pop;
    if (s.river) a.river += s.pop;
    for (let k = 0; k < a.labor.length; k++) a.labor[k] += s.labor[k];
    for (let g = 0; g < GOOD_COUNT; g++) {
      a.imports += (s.tradeByKind.caravan + s.tradeByKind.convoy) > 0 ? s.imported[g] * GOOD_BASE_PRICE[g] : 0;
      a.output += s.produced[g] * GOOD_BASE_PRICE[g];
    }
    a.famine += Math.max(0, 1 - s.foodRatio) * s.pop;
    a.plague += s.plague * s.pop;
    if (world.polities[s.polityId].wars.size > 0) a.war += s.pop;
  }
  const out = new Map<number, CultureEnvironment>();
  for (const [id, a] of acc) {
    const tiles = Math.max(1, a.tiles);
    const pop = Math.max(1, a.pop);
    const laborTotal = a.labor.reduce((x, y) => x + y, 0) || 1;
    const biome: Partial<Record<BiomeKey, number>> = {};
    for (const k in a.biome) biome[k as BiomeKey] = a.biome[k] / tiles;
    const labor: Partial<Record<SectorKey, number>> = {};
    SECTOR_KEYS.forEach((k, i) => (labor[k] = a.labor[i] / laborTotal));
    out.set(id, {
      biome, hills: a.hills / tiles, mountains: a.mountains / tiles, horses: a.horses / tiles,
      coastal: a.coastal / pop, river: a.river / pop, labor,
      tradeReliance: a.output > 0 ? a.imports / a.output : 0,
      famine: a.famine / pop, plague: a.plague / pop, war: a.war / pop,
    });
  }
  return out;
}

/**
 * Cultures adapt to survive where they live. Pressure from the environment builds exposure
 * to a trait over the generations; once it is strong enough the culture earns the trait,
 * and if it moves away from that way of life the trait fades again.
 */
function developTraits(world: World): void {
  const envs = measureEnvironments(world);
  for (const c of world.cultures) {
    if (!c.alive) continue;
    const env = envs.get(c.id);
    if (!env) continue;
    let changed = false;
    for (const t of TRAITS) {
      const p = t.pressure(env);
      const e = Math.max(0, Math.min(1.6, (c.exposure[t.id] ?? 0) + 0.12 * Math.max(-1, Math.min(1.5, p - 1))));
      c.exposure[t.id] = e;
      const has = c.traits.includes(t.id);
      if (has && e < 0.3) {
        c.traits = c.traits.filter((x) => x !== t.id);
        changed = true;
        world.log('culture', 1, `The ${c.name} lost the ways of the ${t.name}, their old life left behind.`, { cultures: [c.id] });
      } else if (!has && e >= 1) {
        if (c.traits.length >= MAX_TRAITS) {
          const weakest = c.traits.reduce((a, b) => ((c.exposure[a] ?? 0) <= (c.exposure[b] ?? 0) ? a : b));
          if ((c.exposure[weakest] ?? 0) > e - 0.3) continue;
          c.traits = c.traits.filter((x) => x !== weakest);
        }
        c.traits.push(t.id);
        changed = true;
        world.log('culture', 2, t.earned.replace('{c}', c.name), { cultures: [c.id] });
      }
    }
    if (changed) {
      c.traitEffects = combineTraits(c.traits);
      world.territoryDirty = true;
    }
  }
}
