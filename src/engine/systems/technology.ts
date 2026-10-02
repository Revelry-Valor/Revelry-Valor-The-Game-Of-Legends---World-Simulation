import { GOOD_COUNT, Good, RES_TO_GOOD, Res, SECTOR_KEYS } from '../data/economy';
import { ERA_NAMES, PRACTICE, TECHS, techCost, type Practice, type TechDef } from '../data/techs';
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

/** Learning speed: how much a year of practice by N people moves a technology on. */
const LEARN = 0.03;

/** How many people practise each kind of work across a realm. */
function practices(world: World, p: Polity): Map<Practice, number> {
  const out = new Map<Practice, number>();
  const add = (k: Practice, v: number) => out.set(k, (out.get(k) ?? 0) + v);
  const writing = p.techs.has('writing');
  for (const id of p.settlementIds) {
    const s = world.settlements[id];
    const values = world.cultures[s.cultureId].values;
    for (let k = 0; k < SECTOR_KEYS.length; k++) if (s.labor[k] > 0) add(SECTOR_KEYS[k] as Practice, s.labor[k]);
    add('urban', s.urbanPop);
    add('trade', (s.tradeByKind.internal + s.tradeByKind.caravan + s.tradeByKind.convoy) / 4);
    add('faith', s.pop * values.piety * 0.1);
    add('scholars', s.urbanPop * values.curiosity * (writing ? 0.5 : 0.12));
    if (s.coastal) add('sea', s.pop * 0.15 * (0.5 + values.seafaring));
  }
  if (p.settlementIds.length > 1) add('admin', p.pop * 0.03 * Math.log2(p.settlementIds.length));
  let soldiers = 0;
  for (const a of world.armies) if (a.alive && a.polityId === p.id) soldiers += a.size;
  add('war', soldiers + (p.wars.size ? p.military * 0.2 : 0));
  return out;
}

const METALS = new Set(['copper_working', 'bronze_working', 'iron_working', 'steel']);

/** Necessity, the mother of invention: what the realm is short of makes it try harder. */
function need(world: World, p: Polity, t: TechDef): number {
  let hunger = 0;
  let crowding = 0;
  for (const id of p.settlementIds) {
    const s = world.settlements[id];
    hunger += s.lastHungry / 12;
    crowding += s.crowding;
  }
  const n = Math.max(1, p.settlementIds.length);
  if (t.category === 'agriculture') return 1 + Math.min(2, (hunger / n) * 4 + (p.deficit[Good.Food] ? 0.5 : 0));
  if (t.id === 'sanitation' || t.id === 'medicine' || t.id === 'engineering') return 1 + Math.min(2, (crowding / n) * 2);
  if (t.category === 'military') return p.wars.size > 0 ? 1.8 : 1;
  if (t.id === 'masonry' && p.deficit[Good.Timber]) return 1.5;
  if (METALS.has(t.id) && p.deficit[Good.Tools]) return 1.4;
  return 1;
}

/**
 * Knowledge grows out of practice. Every technology a realm could take up next moves on each
 * year according to how many of its people do the related work (farmers improving farming,
 * smiths metalworking, fishers and traders seafaring, townsfolk writing and law), faster when
 * the realm needs it, with curious peoples, learned institutions and wise rulers, and much faster
 * when neighbours and trading partners already know it. Technology improves what people do and
 * opens new work; it never decides how big a settlement can grow.
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
    let mult = (1 + p.effects.research) * (0.55 + culture.values.curiosity * 0.9) * GOV_RESEARCH[p.government];
    for (const t of p.ruler.traits) mult += TRAIT_RESEARCH[t] ?? 0;
    mult *= 0.5 + p.stability * 0.7;
    const done = practices(world, p);
    let lead: TechDef | null = null;
    let leadShare = -1;
    for (const tech of TECHS) {
      if (!canResearch(world, p, tech)) continue;
      let amount = 0;
      for (const k of PRACTICE[tech.id] ?? []) amount += done.get(k) ?? 0;
      const known = diffusion(world, p, tech.id);
      const rate = LEARN * Math.pow(amount, 0.6) * mult * (race.research[tech.category] ?? 1) * need(world, p, tech) * (1 + 2 * known);
      const progress = (p.progress.get(tech.id) ?? 0) + rate;
      const cost = techCost(tech) * (1 - 0.65 * known);
      if (progress < cost) {
        p.progress.set(tech.id, progress);
        if (progress / cost > leadShare) {
          leadShare = progress / cost;
          lead = tech;
        }
        continue;
      }
      p.progress.delete(tech.id);
      p.techs.add(tech.id);
      world.recomputeEffects(p);
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
    // For display: the technology the realm is closest to mastering.
    p.researching = lead ? lead.id : null;
    p.researchProgress = lead ? p.progress.get(lead.id) ?? 0 : 0;
  }
}
