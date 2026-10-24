import { techTiers, type Library, type Tech } from '../core/library';
import { COVER_BRUSHES } from '../core/paint';
import type { Env } from './env';
import type { Clan, Settlement, SimState } from './state';

/**
 * Technology in the world (REDESIGN.md 8.4f, Phase 8 step 1).
 *
 * Settlements hold technologies; a clan's tribes carry what the clan knows. Basic survival
 * (gathering, hunting, simple fishing) is free; everything above it is learned. A technology is
 * discovered through practice (doing the work that leads to it) and need (hunger, war, trade), by
 * peoples clever enough, where its resources and places are to hand, once what it builds on is
 * known; it is learned far faster by contact with those who know it (neighbours, trading partners,
 * kin). It is forgotten where too few people are left to keep it and no one near knows it, unless
 * an archive keeps it (Libraries and archives), and an archive can burn.
 */

export interface TechContext {
  sim: SimState;
  env: Env;
  lib: Library;
  /** The race's intelligence (10 ordinary). */
  intelligence: (race: string) => number;
  cellsNear: (x: number, y: number, r: number) => number[];
  dist: (ax: number, ay: number, bx: number, by: number) => number;
  rand: () => number;
  log: (text: string, x?: number, y?: number) => void;
  /** What a culture does to learning: finding things alone, learning from others, forgetting; and whether its way of life pushes a technology. */
  culture?: (id: string) => { discover: number; learn: number; forget: number };
  pushes?: (cultureId: string, techId: string) => boolean;
}

const startTech = (lib: Library, id: string) => lib.techs.find((t) => t.id === id)?.start ?? false;
/** Whether a settlement knows a technology: every people's starting ones, and those it has learned. */
export function knows(lib: Library, st: Settlement, techId: string): boolean {
  return startTech(lib, techId) || (st.techs ?? []).includes(techId);
}
/** Whether a clan (its tribes) knows a technology. */
export function clanKnows(lib: Library, clan: Clan | undefined, techId: string): boolean {
  return startTech(lib, techId) || (clan?.techs ?? []).includes(techId);
}

// ---------------------------------------------------------------------------------------------
// What technology does

/** The resources that need a technology before they can be worked. */
export const RESOURCE_TECH: Record<string, string> = {
  copper: 'copper', tin: 'bronze', lead: 'bronze', silver: 'copper', gold: 'copper', iron: 'iron', coal: 'iron',
  sulfur: 'alchemy', saltpeter: 'alchemy', 'mana-crystal': 'mana-working', 'rift-iron': 'rift-materials',
  sand: 'glass', marble: 'masonry', cotton: 'weaving', flax: 'weaving', silk: 'weaving', wine: 'pottery', clay: 'pottery',
};
/** May a settlement work a resource of this source and id? Farmed things need agriculture, herded ones husbandry. */
export function canWork(has: (id: string) => boolean, source: string, id: string): boolean {
  if (source === 'Farmed' && !has('agriculture')) return false;
  if (source === 'Herded' && !has('husbandry')) return false;
  const t = RESOURCE_TECH[id];
  return !t || has(t);
}
/** How technology changes a settlement's work. */
export interface TechEffects {
  farm: number;
  herd: number;
  fish: number;
  /** Other work (logging, quarrying, mining, gathering goods): better tools. */
  craft: number;
  /** Multiplies how fast stores spoil. */
  spoil: number;
  /** Hides from hunting and herds. */
  hides: number;
  /** Irrigation: dry land by rivers grows crops as if well watered. */
  irrigation: boolean;
}
export function techEffects(has: (id: string) => boolean): TechEffects {
  return {
    farm: (has('plough') ? 1.3 : 1) * (has('crop-rotation') ? 1.15 : 1),
    herd: has('breeding') ? 1.25 : 1,
    // Simple fishing from the shore is free; nets and boats are learned.
    fish: has('fishing') ? 1 : 0.45,
    craft: has('steel') ? 1.45 : has('iron') ? 1.3 : has('bronze') ? 1.15 : 1,
    spoil: (has('preserving') ? 0.6 : 1) * (has('pottery') ? 0.85 : 1),
    hides: has('tanning') ? 2 : 1,
    irrigation: has('irrigation'),
  };
}
/** How much stronger fighters are with their weapons (spears, which all know, = 1). */
export function armsMight(has: (id: string) => boolean): number {
  const lines: [string, number][] = [['mechanized', 3], ['mana-arms', 2.6], ['firearms', 2.3], ['crossbows', 1.8], ['steel-arms', 1.7], ['iron-arms', 1.45], ['bronze-arms', 1.25], ['bows', 1.1]];
  let m = 1;
  for (const [id, v] of lines) if (has(id)) m = Math.max(m, v);
  if (has('cavalry')) m *= 1.15;
  return m;
}
/** Walls: a settlement that knows fortification defends half as well again. */
export const wallsMight = (has: (id: string) => boolean) => (has('fortification') ? 1.5 : 1);
/** Can a clan's tribe settle down here: it needs a way to feed a village. */
export function canSettle(has: (id: string) => boolean, byWater: boolean): boolean {
  return has('agriculture') || has('husbandry') || (has('fishing') && byWater);
}

// ---------------------------------------------------------------------------------------------
// Discovery, learning and forgetting

interface Holder {
  kind: 'settlement' | 'clan';
  id: number;
  name: string;
  race: string;
  x: number;
  y: number;
  pop: number;
  techs: string[];
  /** The settlement (for jobs, stores, hardship), if it is one. */
  st?: Settlement;
  clan: number;
  culture: string;
}

function holders(sim: SimState): Holder[] {
  const out: Holder[] = [];
  for (const st of sim.settlements) if (!st.ruined) out.push({ kind: 'settlement', id: st.id, name: st.name, race: st.race, x: st.x, y: st.y, pop: st.pop, techs: (st.techs ??= []), st, clan: st.clan, culture: st.culture });
  for (const c of sim.clans) {
    const tribes = sim.tribes.filter((t) => t.clan === c.id);
    if (!tribes.length) continue;
    const pop = tribes.reduce((n, t) => n + t.pop, 0);
    const x = tribes[0].x;
    const y = tribes[0].y;
    out.push({ kind: 'clan', id: c.id, name: `clan ${c.name}`, race: c.race, x, y, pop, techs: (c.techs ??= []), clan: c.id, culture: c.culture });
  }
  return out;
}

/** Is a technology's needed resources and places to hand round a place? */
function toHand(c: TechContext, t: Tech, h: Holder): boolean {
  const { env } = c;
  const cells = c.cellsNear(h.x, h.y, 60).filter((k) => env.land[k]);
  for (const r of t.resources) {
    const A = env.res[r];
    const inStore = (h.st?.economy?.stores[r] ?? 0) > 0;
    if (!inStore && !(A && cells.some((k) => A[k] > 0))) return false;
  }
  const placeOk = (p: string) =>
    p === 'Hills' ? cells.some((k) => env.mzone[k] === 1 || env.mzone[k] === 2)
    : p === 'Mountains' ? cells.some((k) => env.mzone[k] >= 3)
    : p === 'Rivers' ? cells.some((k) => env.fresh[k])
    : p === 'Sea or lake' ? cells.some((k) => env.coast[k] || env.fresh[k])
    : p === 'Forest' ? cells.some((k) => env.cover[k] >= 0 && ['forest', 'jungle', 'taiga'].includes(COVER_BRUSHES[env.cover[k]]))
    : false; // Giant trees, the sky, the underdark and rifts come with their layers.
  // A technology listing several places needs any one of them.
  if (t.places.length && !t.places.some(placeOk)) return false;
  return true;
}


/** How much the holder's way of life practises toward a technology (0 none … about 2 a lot). */
function practice(c: TechContext, t: Tech, h: Holder): number {
  const { sim, env } = c;
  const jobs = h.st?.economy?.jobs ?? {};
  const workers = Math.max(1, Object.values(jobs).reduce((a, b) => a + b, 0));
  const share = (pred: (k: string) => boolean) => Object.entries(jobs).filter(([k]) => pred(k)).reduce((n, [, v]) => n + v, 0) / workers;
  const byWater = c.cellsNear(h.x, h.y, 40).some((k) => env.coast[k] || env.fresh[k]);
  // Tribes live by gathering and hunting.
  const tribe = h.kind === 'clan';
  const gather = tribe ? 0.6 : share((k) => k === 'gather');
  const hunt = tribe ? 0.6 : share((k) => k === 'hunt');
  const farm = share((k) => k.startsWith('farm:'));
  const herd = share((k) => k.startsWith('herd:'));
  const fish = share((k) => k.startsWith('fish:'));
  const food = tribe ? 1 : gather + hunt + farm + herd + fish;
  switch (t.id) {
    case 'agriculture': return gather * 3 + 0.15;
    case 'husbandry': return hunt * 2.5 + 0.1;
    case 'fishing': return byWater ? 0.8 + fish * 2 : 0;
    case 'preserving': return (hunt + fish) * 2 + 0.2;
    case 'irrigation': return byWater ? farm * 2 : 0;
    case 'plough': case 'crop-rotation': return farm * 2;
    case 'breeding': case 'riding': return herd * 2;
    case 'tanning': return hunt * 2 + herd;
    case 'weaving': return gather + herd + 0.2;
  }
  const trade = h.st?.economy?.traded ? Math.min(2, (h.st.economy.traded.caravans ?? 0) * 0.3) : 0;
  const scale = Math.min(1.5, h.pop / 800);
  switch (t.field) {
    case 'Food and land': return food;
    case 'Materials and crafts': return tribe ? 0.3 : (1 - food) * 2 + 0.2;
    case 'Building': return tribe ? 0.1 : Math.min(1.5, h.pop / 400);
    case 'Travel': return (byWater && (t.id === 'rafts' || t.id === 'sailing') ? 0.8 : 0) + trade + (tribe ? 0.4 : 0.2);
    case 'Knowledge': return tribe ? 0.1 : scale;
    case 'Commerce': return trade + 0.1;
    case 'War': return Math.min(2, (h.st?.hardship?.war ?? sim.sorties.filter((s) => s.clan === h.clan).length) * 0.5 + 0.2);
    default: return tribe ? 0.05 : scale * 0.5;
  }
}
/** How hard need presses toward a technology (1 none … 3 great). */
function need(t: Tech, h: Holder): number {
  const hard = h.st?.hardship;
  const hungry = h.st ? Math.max(0, 1 - Math.min(1, h.st.fed)) + (hard?.famine ?? 0) * 0.5 : 0;
  if (t.field === 'Food and land') return 1 + Math.min(2, hungry * 2);
  if (t.field === 'War') return 1 + Math.min(2, hard?.war ?? 0);
  return 1;
}

/** Yearly chance a holder gains a technology: by discovering it, and by learning it from those it meets. */
export function chanceOf(c: TechContext, t: Tech, h: Holder, near: Holder[], tier = 1): { discover: number; learn: number } {
  const d = Math.max(1, t.difficulty ?? 3);
  const iq = Math.max(0.3, c.intelligence(h.race) / 10);
  const writing = h.techs.includes('writing') ? 1.25 : 1;
  // Finding something new is slow, slower the deeper it lies in the tree: what feeds and clothes
  // a people comes within generations, learning and great works over centuries.
  const base = t.field === 'Food and land' || (t.field === 'Materials and crafts' && tier <= 2) ? 0.03 : 0.006;
  const cf = c.culture?.(h.culture) ?? { discover: 1, learn: 1, forget: 1 };
  // A way of life that leans on a technology (its learned behaviours) finds it twice as readily.
  const pushed = c.pushes?.(h.culture, t.id) ? 2 : 1;
  const discover = toHand(c, t, h) ? (base * practice(c, t, h) * need(t, h) * iq * writing * cf.discover * pushed) / (Math.pow(d, 1.3) * Math.max(1, tier)) : 0;
  // Contact: those near who know it teach it, kin and trading partners best.
  let teachers = 0;
  for (const o of near) if (o.techs.includes(t.id)) teachers += o.clan === h.clan ? 1.5 : 0.8;
  const learn = teachers > 0 && toHand(c, t, h) ? (0.18 * Math.min(4, teachers) * iq * cf.learn) / Math.pow(d, 0.7) : 0;
  return { discover, learn };
}

/** Who a holder is in touch with: its trading partners, its kin, and anyone within a few days' walk. */
function contacts(c: TechContext, h: Holder, all: Holder[]): Holder[] {
  const { sim } = c;
  const partners = new Set<number>();
  if (h.st) for (const r of sim.routes) {
    if (r.a === h.id) partners.add(r.b);
    if (r.b === h.id) partners.add(r.a);
  }
  return all.filter((o) => o !== h && ((o.kind === 'settlement' && partners.has(o.id)) || o.clan === h.clan || c.dist(o.x, o.y, h.x, h.y) < 220));
}

/** How many people it takes to keep a technology alive, by its depth in the tree. */
export const keepers = (tier: number) => Math.round(15 * Math.pow(Math.max(1, tier), 1.6));
/** Does the holder keep an archive (and is it standing)? */
export const hasArchive = (lib: Library, st: Settlement | undefined, day: number) => !!st && knows(lib, st, 'libraries') && knows(lib, st, 'writing') && !(st.archiveBurnedUntil && st.archiveBurnedUntil > day);

/** The year's discoveries, learning and forgetting, everywhere. */
export function techYear(c: TechContext): void {
  const { sim, lib } = c;
  // The land round each place, worked out once a year.
  const memo = new Map<string, number[]>();
  const cc: TechContext = { ...c, cellsNear: (x, y, r) => {
    const key = `${Math.round(x)},${Math.round(y)},${r}`;
    let v = memo.get(key);
    if (!v) memo.set(key, (v = c.cellsNear(x, y, r)));
    return v;
  } };
  const all = holders(sim);
  const tiers = techTiers(lib.techs);
  const firstEver = new Set([...Object.keys(sim.firsts ?? {}), ...all.flatMap((h) => h.techs)]);
  const gained: [Holder, Tech, boolean][] = [];
  for (const h of all) {
    const known = new Set([...h.techs, ...lib.techs.filter((t) => t.start).map((t) => t.id)]);
    const near = contacts(cc, h, all);
    for (const t of lib.techs) {
      if (known.has(t.id) || !t.requires.every((r) => known.has(r) || !lib.techs.some((q) => q.id === r))) continue;
      const { discover, learn } = chanceOf(cc, t, h, near, tiers.get(t.id) ?? 1);
      const p = 1 - Math.exp(-(discover + learn));
      if (p > 0 && c.rand() < p) gained.push([h, t, c.rand() * (discover + learn) < discover]);
    }
    // Forgetting: too few to keep the deepest knowledge, no one near who knows it, and no archive.
    if (hasArchive(lib, h.st, sim.day)) continue;
    for (const id of [...h.techs].sort((a, b) => (tiers.get(b) ?? 0) - (tiers.get(a) ?? 0))) {
      const tier = tiers.get(id) ?? 1;
      if (h.pop >= keepers(tier) || near.some((o) => o.techs.includes(id))) continue;
      if (c.rand() < 0.15 * (c.culture?.(h.culture).forget ?? 1)) {
        h.techs.splice(h.techs.indexOf(id), 1);
        c.log(`${cap(h.name)} has forgotten ${lib.techs.find((q) => q.id === id)?.name ?? id}: too few are left who know it.`, h.x, h.y);
      }
      break;
    }
  }
  const firsts = (sim.firsts ??= {});
  for (const [h, t, discovered] of gained) {
    if (h.techs.includes(t.id)) continue;
    h.techs.push(t.id);
    if (!firsts[t.id]) firsts[t.id] = { day: sim.day, by: cap(h.name) };
    if (discovered) c.log(`${cap(h.name)} discovered ${t.name}${firstEver.has(t.id) ? '' : ', the first in the world'}.`, h.x, h.y);
    firstEver.add(t.id);
  }
  // Hardship fades.
  for (const st of sim.settlements) if (st.hardship) {
    st.hardship.famine *= 0.5;
    st.hardship.war *= 0.5;
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a settlement or clan may come to next, and the yearly chance of each (for the Peoples tab). */
export function outlook(c: TechContext, who: { settlement?: number; clan?: number }, count = 5): { tech: Tech; chance: number; how: 'discover' | 'learn' }[] {
  const { lib } = c;
  const all = holders(c.sim);
  const h = all.find((q) => (who.settlement !== undefined ? q.kind === 'settlement' && q.id === who.settlement : q.kind === 'clan' && q.id === who.clan));
  if (!h) return [];
  const tiers = techTiers(lib.techs);
  const known = new Set([...h.techs, ...lib.techs.filter((t) => t.start).map((t) => t.id)]);
  const near = contacts(c, h, all);
  const out: { tech: Tech; chance: number; how: 'discover' | 'learn' }[] = [];
  for (const t of lib.techs) {
    if (known.has(t.id) || !t.requires.every((r) => known.has(r) || !lib.techs.some((q) => q.id === r))) continue;
    const { discover, learn } = chanceOf(c, t, h, near, tiers.get(t.id) ?? 1);
    const p = 1 - Math.exp(-(discover + learn));
    if (p > 0.0005) out.push({ tech: t, chance: p, how: learn > discover ? 'learn' : 'discover' });
  }
  return out.sort((a, b) => b.chance - a.chance).slice(0, count);
}
