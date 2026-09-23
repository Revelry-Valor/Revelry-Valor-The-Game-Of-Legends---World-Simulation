import { GOOD_COUNT, RES_TO_GOOD, Res } from '../data/economy';
import { ERA_NAMES, TECHS, TECH_BY_ID, techCost, type TechDef } from '../data/techs';
import type { Polity } from '../types';
import type { World } from '../world';

const GOV_RESEARCH = { tribe: 0.8, chiefdom: 0.9, 'city-state': 1.15, kingdom: 1, empire: 1.05, republic: 1.2, theocracy: 0.85 };
const TRAIT_RESEARCH: Record<string, number> = { wise: 0.15, scholarly: 0.3, warlike: -0.05 };

/** Whether a polity can obtain a natural resource: in its lands, in its stores, or through trade. */
function hasResource(world: World, p: Polity, r: Res): boolean {
  const g = RES_TO_GOOD[r];
  if (g !== undefined && p.access[g]) return true;
  for (const id of p.settlementIds) if (world.settlements[id].resSum[r] > 0.05) return true;
  return false;
}

export function canResearch(world: World, p: Polity, t: TechDef): boolean {
  if (p.techs.has(t.id)) return false;
  if (t.arcane && world.cfg.magic <= 0) return false;
  for (const pre of t.prereqs) if (!p.techs.has(pre)) return false;
  if (t.requires) for (const r of t.requires) if (!hasResource(world, p, r)) return false;
  if (t.requiresWater) {
    let water = false;
    for (const id of p.settlementIds) {
      const s = world.settlements[id];
      if (s.coastal || s.river || s.resSum[Res.Fish] > 0.5) water = true;
    }
    if (!water) return false;
  }
  return true;
}

/** Share of a polity's contacts (weighted by trade and borders) who already know a tech. */
function diffusion(world: World, p: Polity, techId: string): number {
  let known = 0;
  let total = 0;
  for (const [q, v] of p.contacts) {
    const Q = world.polities[q];
    if (!Q.alive) continue;
    const w = Math.log10(1 + v);
    total += w;
    if (Q.techs.has(techId)) known += w;
  }
  return total > 0 ? known / total : 0;
}

/**
 * Polities accumulate research from their population (faster with writing, curiosity,
 * wise rulers and a suitable government), choose what to study based on their surroundings,
 * and learn much faster what their neighbours and trade partners already know.
 */
export function runTechnology(world: World): void {
  for (const p of world.alivePolities()) {
    // What can this polity get its hands on?
    p.access.fill(0);
    for (const id of p.settlementIds) {
      const s = world.settlements[id];
      for (let g = 0; g < GOOD_COUNT; g++) if (s.produced[g] > 0.01 || s.imported[g] > 0.01 || s.stock[g] > 0.5) p.access[g] = 1;
    }
    const culture = world.cultures[p.cultureId];
    const race = world.raceById.get(culture.raceId) ?? world.races[0];
    let base = 0;
    for (const id of p.settlementIds) base += Math.pow(world.settlements[id].pop, 0.72);
    let mult = (1 + p.effects.research) * (0.55 + culture.values.curiosity * 0.9) * GOV_RESEARCH[p.government];
    for (const t of p.ruler.traits) mult += TRAIT_RESEARCH[t] ?? 0;
    // Diminishing returns: a sprawling realm is not a hundred times as inventive as one city.
    const points = Math.pow(base, 0.7) * 0.045 * mult * (0.5 + p.stability * 0.7);

    if (!p.researching || !canResearch(world, p, TECH_BY_ID.get(p.researching)!)) {
      p.researching = chooseResearch(world, p);
      p.researchProgress = 0;
    }
    if (!p.researching) continue;
    const tech = TECH_BY_ID.get(p.researching)!;
    const affinity = race.research[tech.category] ?? 1;
    p.researchProgress += points * affinity;
    const cost = techCost(tech) * (1 - 0.65 * diffusion(world, p, tech.id));
    if (p.researchProgress >= cost) {
      p.techs.add(tech.id);
      world.recomputeEffects(p);
      p.researching = null;
      p.researchProgress = 0;
      const first = !world.firstTech.has(tech.id);
      if (first) {
        world.firstTech.set(tech.id, p.id);
        const eraKey = `era:${tech.era}`;
        const eraNote = tech.era > 0 && !world.flags.has(eraKey) ? ` The ${ERA_NAMES[tech.era]} had dawned.` : '';
        for (let e = 0; e <= tech.era; e++) world.flags.add(`era:${e}`);
        world.log('technology', tech.era >= 2 || eraNote ? 3 : 2, `The ${p.name} became the first people to master ${tech.name}: ${tech.description}${eraNote}`, { polities: [p.id], settlements: [p.capitalId] });
      } else {
        world.log('technology', 1, `The ${p.name} learned ${tech.name}.`, { polities: [p.id] });
      }
    }
  }
}

function chooseResearch(world: World, p: Polity): string | null {
  const culture = world.cultures[p.cultureId];
  const race = world.raceById.get(culture.raceId) ?? world.races[0];
  const v = culture.values;
  let coastal = 0;
  for (const id of p.settlementIds) if (world.settlements[id].coastal) coastal++;
  const coastShare = coastal / Math.max(1, p.settlementIds.length);
  const options = TECHS.filter((t) => canResearch(world, p, t));
  const pick = world.rng.weighted(options, (t) => {
    let w = (race.research[t.category] ?? 1) / (1 + t.era * 0.3);
    if (t.category === 'maritime') w *= 0.4 + coastShare * 1.5 + v.seafaring;
    if (t.category === 'military') w *= 0.5 + v.militarism + (p.wars.size > 0 ? 0.8 : 0);
    if (t.category === 'society') w *= 0.6 + v.mercantilism * 0.5 + v.piety * 0.3;
    if (t.category === 'science') w *= 0.5 + v.curiosity;
    if (t.category === 'arcane') w *= 0.4 + v.piety * 0.4 + v.curiosity * 0.4 + world.cfg.magic * 0.3;
    if (t.category === 'agriculture') w *= 1.3;
    w *= 1 + 2 * diffusion(world, p, t.id);
    return w;
  });
  return pick ? pick.id : null;
}
