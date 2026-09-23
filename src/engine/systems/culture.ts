import type { Culture, CultureValues, Settlement } from '../types';
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
  }

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
