import type { Library, Race, Species } from '../core/library';
import { COVER_BRUSHES } from '../core/paint';
import type { Env } from './env';
import type { LiveCulture, SimState } from './state';
import { clanKnows, knows } from './tech';

/**
 * Living cultures (REDESIGN.md 8.4e, Phase 8 step 2).
 *
 * Every people has a culture: the Library culture made for its race (or species), or, where none
 * was made, a folk culture grown from its homeland and way of life. Traditions are earned by
 * living a certain way for generations (about twenty years a degree) and fade the same way when
 * that life ends; a culture holds about six. Learned behaviours spread by practice, need and
 * contact. Both change how its people live: what they are good at, how readily they fight or
 * trade, how fast they learn.
 */

export const MAX_TRADITIONS = 6;
const YEARS_PER_DEGREE = 20;

export const cultureOf = (sim: SimState, id: string): LiveCulture | undefined => sim.cultures?.find((c) => c.id === id);

const SYLLABLES = ['ka', 'ra', 'mo', 'te', 'lu', 'an', 'or', 'vel', 'si', 'do', 'ma', 'ri', 'tha', 'gor', 'en', 'is', 'ul', 'bra', 'ne', 'kor', 'al', 'dur', 'ish', 'ven', 'zo', 'pe', 'qua', 'hil', 'ys', 'ou', 'ae', 'tor', 'sa', 'mi', 'fen', 'gal'];

/** The culture a people starts with: its Library culture, brought to life once; or its race's folk culture, grown now from its homeland. */
export function ensureCulture(sim: SimState, lib: Library, env: Env, species: Species, race: Race, x: number, y: number, rand: () => number): string {
  const cultures = (sim.cultures ??= []);
  const made = lib.cultures.find((c) => c.races.includes(race.id)) ?? lib.cultures.find((c) => c.species.includes(species.id));
  if (made) {
    if (!cultures.some((c) => c.id === made.id)) {
      cultures.push({
        id: made.id, name: made.name, source: made.id, species: made.species.length ? [...made.species] : [species.id], races: made.races.length ? [...made.races] : [race.id],
        language: made.language, sounds: made.sounds, ethos: made.ethos, martial: made.martial, lifestyles: [...made.lifestyles],
        // Its traditions as made: they hold at their level (locked ones never fade).
        traditions: made.traditions.map((t) => ({ id: t.id, level: t.level, hold: t.hold, progress: 0 })),
        specialties: made.specialties.map((s) => ({ ...s })), behaviours: [...made.behaviours], founded: sim.day, parent: '', stats: emptyStats(),
      });
    }
    return made.id;
  }
  const id = `folk-${race.id}`;
  if (!cultures.some((c) => c.id === id)) cultures.push(folkCulture(sim, lib, env, species, race, x, y, rand, id));
  return id;
}
const emptyStats = () => ({ fights: 0, raids: 0, foreignTrade: 0, famines: 0, lastFight: -1e9 });

/** A folk culture, grown from a race's homeland and way of life. */
function folkCulture(sim: SimState, lib: Library, env: Env, species: Species, race: Race, x: number, y: number, rand: () => number, id: string): LiveCulture {
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  // Its sounds: a handful of word beginnings and endings of its own.
  const pre = Array.from({ length: 6 }, () => pick(SYLLABLES) + (rand() < 0.4 ? pick(SYLLABLES) : ''));
  const suf = Array.from({ length: 6 }, () => pick(SYLLABLES));
  const sounds = [...new Set(pre)].map((p) => `${p}-`).concat([...new Set(suf)].map((s) => `-${s}`)).join(' ');
  const name = cap(pick(pre) + pick(suf));
  const lifestyle = race.lifestyle || species.lifestyle || 'Semi-nomadic';
  const k = cellAt(env, x, y);
  const place = k >= 0 ? placeOf(env, k) : null;
  const harsh = place ? place.desert || place.cold : false;
  const iq = race.stats.intelligence ?? 10;
  const mana = species.traits.includes('mana-sensitive') || race.addTraits.includes('mana-sensitive');
  // Ethos: born of how and where it lives.
  const ethos = mana && rand() < 0.6 ? 'Mystic' : iq >= 14 && rand() < 0.5 ? 'Inventive' : harsh ? (rand() < 0.5 ? 'Stoic' : 'Warlike') : lifestyle === 'Nomadic' ? pick(['Warlike', 'Egalitarian', 'Stoic']) : lifestyle === 'Settled' ? pick(['Communal', 'Spiritual', 'Commercial']) : pick(['Communal', 'Spiritual', 'Warlike', 'Egalitarian']);
  const martial = lifestyle === 'Nomadic' || harsh ? pick(['Everyone fights', 'Men fight', 'Everyone fights']) : pick(['Men fight', 'Men fight', 'Women fight', 'Everyone fights', 'A warrior caste']);
  const lifestyles = lifestyle === 'Settled' ? ['Settled'] : lifestyle === 'Nomadic' ? ['Nomadic'] : [];
  if (place?.coast) lifestyles.push('Seafaring');
  // The mild traditions its homeland already gives it.
  const traditions: LiveCulture['traditions'] = [];
  const give = (tid: string) => {
    if (lib.traditions.some((t) => t.id === tid) && traditions.length < 4) traditions.push({ id: tid, level: 0, hold: '', progress: 0 });
  };
  if (place?.fresh) give('river-folk');
  if (place?.hills) give('highlanders');
  if (place?.forest) give('woodland');
  if (place?.desert) give('desert-wanderers');
  if (place?.coast) give('seafaring');
  give(lifestyle === 'Settled' ? 'tillers' : 'hunters');
  give('clan-loyalty');
  const behaviours = lib.behaviours.filter((b) => ['oral-law', 'warbands'].includes(b.id) || (b.id === 'seasonal-migration' && lifestyle !== 'Settled')).map((b) => b.id);
  return { id, name, source: '', species: [species.id], races: [race.id], language: name, sounds, ethos, martial, lifestyles, traditions, specialties: [], behaviours, founded: sim.day, parent: '', stats: emptyStats() };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function cellAt(env: Env, x: number, y: number): number {
  let i = Math.round((x - env.x0) / env.step);
  const j = Math.round((y - env.y0) / env.step);
  if (j < 0 || j >= env.h) return -1;
  if (i < 0 || i >= env.w) {
    if (!env.wrapKm) return -1;
    i = ((i % env.w) + env.w) % env.w;
  }
  return j * env.w + i;
}
/** What kind of place a point is, for the traditions living there earns. */
function placeOf(env: Env, k: number) {
  const cover = env.cover[k] >= 0 ? COVER_BRUSHES[env.cover[k]] : '';
  return {
    coast: env.coast[k] === 1,
    fresh: env.fresh[k] === 1,
    hills: env.mzone[k] >= 1,
    forest: ['forest', 'jungle', 'taiga'].includes(cover),
    open: ['grassland', 'steppe', 'savanna'].includes(cover),
    desert: ['dunes', 'rockdesert', 'badlands', 'saltflats', 'scrub'].includes(cover),
    cold: ['tundra', 'glacier', 'taiga'].includes(cover),
  };
}

// ---------------------------------------------------------------------------------------------
// What a culture's traditions and behaviours do

export interface CultureFx {
  farm: number;
  herd: number;
  fish: number;
  hunt: number;
  craft: number;
  spoil: number;
  /** Deaths from hunger. */
  famine: number;
  /** Fighters' strength, readiness to send warbands, and to raid settlements. */
  fight: number;
  war: number;
  raid: number;
  /** Hostility toward other races, and readiness to trade (with other cultures). */
  otherRace: number;
  trade: number;
  /** Learning from others, finding things alone, and forgetting. */
  learn: number;
  discover: number;
  forget: number;
  births: number;
}
const NEUTRAL: CultureFx = { farm: 1, herd: 1, fish: 1, hunt: 1, craft: 1, spoil: 1, famine: 1, fight: 1, war: 1, raid: 1, otherRace: 1, trade: 1, learn: 1, discover: 1, forget: 1, births: 1 };

/** Each tradition's effect, by degree (1 for the mildest). */
const TRADITION_FX: Record<string, (d: number, f: CultureFx) => void> = {
  seafaring: (d, f) => { f.fish *= 1 + 0.15 * d; f.trade *= 1 + 0.05 * d; },
  'horse-lords': (d, f) => { f.fight *= 1 + 0.1 * d; f.herd *= 1 + 0.05 * d; },
  herders: (d, f) => { f.herd *= 1 + 0.12 * d; },
  hunters: (d, f) => { f.hunt *= 1 + 0.15 * d; },
  tillers: (d, f) => { f.farm *= 1 + 0.1 * d; },
  highlanders: (d, f) => { f.fight *= 1 + 0.03 * d; },
  woodland: (d, f) => { f.hunt *= 1 + 0.05 * d; f.craft *= 1 + 0.03 * d; },
  'desert-wanderers': (d, f) => { f.famine *= 1 - 0.1 * d; },
  'river-folk': (d, f) => { f.fish *= 1 + 0.08 * d; f.farm *= 1 + 0.03 * d; },
  xenophobia: (d, f) => { f.otherRace *= 1 + 0.4 * d; f.trade *= 1 - 0.2 * d; f.learn *= 1 - 0.1 * d; },
  hospitality: (d, f) => { f.otherRace *= 1 - 0.15 * d; f.trade *= 1 + 0.2 * d; f.learn *= 1 + 0.1 * d; },
  isolationism: (d, f) => { f.trade *= 1 - 0.25 * d; f.learn *= 1 - 0.25 * d; },
  martial: (d, f) => { f.fight *= 1 + 0.1 * d; f.war *= 1 + 0.25 * d; },
  raiders: (d, f) => { f.raid *= 1 + 0.6 * d; f.war *= 1 + 0.1 * d; },
  'honour-code': (d, f) => { f.fight *= 1 + 0.05 * d; },
  'clan-loyalty': (d, f) => { f.fight *= 1 + 0.02 * d; },
  artisans: (d, f) => { f.craft *= 1 + 0.12 * d; },
  traders: (d, f) => { f.trade *= 1 + 0.25 * d; },
  frugal: (d, f) => { f.spoil *= 1 - 0.1 * d; f.famine *= 1 - 0.15 * d; },
  lorekeepers: (d, f) => { f.discover *= 1 + 0.2 * d; f.learn *= 1 + 0.1 * d; f.forget *= 1 - 0.3 * d; },
  'oral-tradition': (d, f) => { f.forget *= 1 - 0.25 * d; },
  'ancestor-reverence': (d, f) => { f.forget *= 1 - 0.1 * d; f.discover *= 1 - 0.05 * d; },
  feasting: (d, f) => { f.births *= 1 + 0.05 * d; },
  pacifism: (d, f) => { f.war *= Math.max(0.1, 1 - 0.4 * d); f.raid *= Math.max(0.1, 1 - 0.4 * d); f.fight *= 1 - 0.05 * d; },
};
const BEHAVIOUR_FX: Record<string, (f: CultureFx) => void> = {
  granaries: (f) => { f.spoil *= 0.8; },
  'herding-rights': (f) => { f.herd *= 1.1; },
  'irrigation-rights': (f) => { f.farm *= 1.05; },
  apprenticeship: (f) => { f.craft *= 1.1; },
  'guild-charters': (f) => { f.craft *= 1.1; },
  markets: (f) => { f.trade *= 1.2; },
  'trade-fairs': (f) => { f.trade *= 1.2; },
  'record-keeping': (f) => { f.forget *= 0.7; },
  schools: (f) => { f.discover *= 1.25; },
  'standing-army': (f) => { f.fight *= 1.15; },
  retainers: (f) => { f.fight *= 1.1; },
  envoys: (f) => { f.learn *= 1.1; f.trade *= 1.1; },
};

const fxCache = new WeakMap<SimState, Map<string, CultureFx>>();
/** What a culture's traditions and behaviours do (worked out once a year). */
export function cultureFx(sim: SimState, id: string): CultureFx {
  let m = fxCache.get(sim);
  if (!m) fxCache.set(sim, (m = new Map()));
  let f = m.get(id);
  if (f) return f;
  f = { ...NEUTRAL };
  const c = cultureOf(sim, id);
  if (c) {
    for (const t of c.traditions) if (t.level >= 0) TRADITION_FX[t.id]?.(t.level + 1, f);
    for (const b of c.behaviours) BEHAVIOUR_FX[b]?.(f);
  }
  m.set(id, f);
  return f;
}
/** Does a culture's way of life push a technology forward (its behaviours)? */
export function pushes(sim: SimState, lib: Library, cultureId: string, techId: string): boolean {
  const c = cultureOf(sim, cultureId);
  return !!c && c.behaviours.some((b) => lib.behaviours.find((q) => q.id === b)?.pushesTech.includes(techId));
}

// ---------------------------------------------------------------------------------------------
// Earning traditions and adopting behaviours

export interface CultureContext {
  sim: SimState;
  env: Env;
  lib: Library;
  rand: () => number;
  dist: (ax: number, ay: number, bx: number, by: number) => number;
  log: (text: string, x?: number, y?: number) => void;
}

/** How its people live, taken together (weighted by people), for the traditions it earns. */
function profile(c: CultureContext, cult: LiveCulture) {
  const { sim, env, lib } = c;
  const settlements = sim.settlements.filter((s) => !s.ruined && s.culture === cult.id);
  const tribes = sim.tribes.filter((t) => t.culture === cult.id);
  const p = { pop: 0, coast: 0, fresh: 0, hills: 0, forest: 0, open: 0, desert: 0, farm: 0, herd: 0, hunt: 0, fish: 0, craft: 0, tribe: 0, caravans: 0, maxPop: 0, horses: 0, fed: 0, stored: 0 };
  const horse = env.beastInfo.find((b) => b.id === 'horse');
  const add = (x: number, y: number, pop: number, jobs: Record<string, number> | null) => {
    const k = cellAt(env, x, y);
    if (k < 0) return;
    const pl = placeOf(env, k);
    p.pop += pop;
    for (const key of ['coast', 'fresh', 'hills', 'forest', 'open', 'desert'] as const) if (pl[key]) p[key] += pop;
    if (horse && (env.beastK[horse.id]?.[k] ?? 0) > 0.2 && pl.open) p.horses += pop;
    if (jobs) {
      const total = Math.max(1, Object.values(jobs).reduce((a, b) => a + b, 0));
      const share = (pred: (key: string) => boolean) => Object.entries(jobs).filter(([key]) => pred(key)).reduce((n, [, v]) => n + v, 0) / total;
      p.farm += pop * share((key) => key.startsWith('farm:'));
      p.herd += pop * share((key) => key.startsWith('herd:'));
      p.hunt += pop * share((key) => key === 'hunt');
      p.fish += pop * share((key) => key.startsWith('fish:'));
      p.craft += pop * share((key) => !key.includes(':') && key !== 'hunt' && key !== 'gather');
    } else {
      p.hunt += pop * 0.5;
      p.tribe += pop;
    }
  };
  for (const s of settlements) {
    add(s.x, s.y, s.pop, s.economy?.jobs ?? {});
    p.caravans += s.economy?.traded?.caravans ?? 0;
    p.maxPop = Math.max(p.maxPop, s.pop);
    p.fed += s.pop * Math.min(1.2, s.fed);
  }
  for (const t of tribes) {
    add(t.x, t.y, t.pop, null);
    p.fed += t.pop * Math.min(1.2, t.fed);
  }
  const share = (v: number) => (p.pop > 0 ? v / p.pop : 0);
  const anyKnows = (tech: string) => settlements.some((s) => knows(lib, s, tech)) || [...new Set(tribes.map((t) => t.clan))].some((id) => clanKnows(lib, sim.clans.find((q) => q.id === id), tech));
  return { p, share, settlements, tribes, anyKnows };
}

/** How strongly a culture's life calls for each tradition (0 none … 1 fully). */
function traditionScore(c: CultureContext, cult: LiveCulture, id: string, pr: ReturnType<typeof profile>, others: LiveCulture[]): number {
  const { p, share, anyKnows } = pr;
  const s = cult.stats ?? emptyStats();
  const per1000 = (n: number) => (p.pop > 0 ? (n * 1000) / p.pop : 0);
  const age = (c.sim.day - cult.founded) / 360;
  const has = (b: string) => cult.behaviours.includes(b);
  switch (id) {
    case 'seafaring': return share(p.coast) >= 0.3 ? Math.min(1, share(p.coast) * 0.5 + share(p.fish) * 3) : 0;
    case 'horse-lords': return Math.min(1, share(p.horses) * (anyKnows('riding') ? 1.2 : 0.5));
    case 'herders': return Math.min(1, share(p.herd) * 2.5);
    case 'hunters': return Math.min(1, share(p.hunt) * 1.6);
    case 'tillers': return Math.min(1, share(p.farm) * 2);
    case 'highlanders': return share(p.hills);
    case 'woodland': return share(p.forest);
    case 'desert-wanderers': return share(p.desert);
    case 'river-folk': return share(p.fresh) * 0.9;
    case 'xenophobia': return Math.min(1, c.sim.grudges.filter((g) => cult.races.includes(g.race)).length * 0.35 + per1000(s.fights) * 0.1);
    case 'hospitality': return Math.min(1, per1000(s.foreignTrade) * 0.5);
    case 'isolationism': return others.length === 0 && age > 30 ? 0.7 : 0;
    case 'martial': return Math.min(1, per1000(s.fights) / 2);
    case 'raiders': return Math.min(1, per1000(s.raids) / 1.5);
    case 'honour-code': return has('feudal-oaths') || has('retainers') ? 0.7 : 0;
    case 'clan-loyalty': return Math.min(1, share(p.tribe) * 0.8 + (has('royal-court') ? 0 : 0.25));
    case 'artisans': return Math.min(1, share(p.craft) * 1.6);
    case 'traders': return Math.min(1, per1000(p.caravans) / 3);
    case 'monument-builders': return anyKnows('masonry') && p.maxPop > 1500 ? 0.7 : 0;
    case 'frugal': return Math.min(1, per1000(s.famines) * 0.3 + share(p.desert) * 0.4);
    case 'lorekeepers': return (anyKnows('writing') ? 0.35 : 0) + (anyKnows('libraries') ? 0.25 : 0) + (has('schools') ? 0.3 : 0);
    case 'oral-tradition': return !anyKnows('writing') && age > 40 ? 0.6 : 0;
    case 'ancestor-reverence': return age > 150 ? 0.5 : 0;
    case 'feasting': return p.pop > 0 && p.fed / p.pop > 1.02 ? 0.6 : 0;
    case 'pacifism': return c.sim.day - s.lastFight > 360 * 30 && age > 30 ? 0.7 : 0;
    // The underdark, giant trees, rifts and mana come with their layers.
    default: return 0;
  }
}

/** How much a culture's life calls for each behaviour (0 none … 1). */
function behaviourPractice(id: string, pr: ReturnType<typeof profile>): number {
  const { p, share, settlements, anyKnows } = pr;
  const settled = settlements.length > 0;
  switch (id) {
    case 'oral-law': case 'warbands': return 0.6;
    case 'tribal-council': return 0.4;
    case 'settling': case 'land-ownership': return settled ? 0.7 : 0;
    case 'seasonal-migration': return share(p.tribe);
    case 'herding-rights': return Math.min(1, share(p.herd) * 2 + share(p.tribe) * 0.3);
    case 'granaries': return settled ? 0.6 : 0;
    case 'irrigation-rights': return anyKnows('irrigation') ? 0.6 : 0;
    case 'markets': case 'trade-fairs': return Math.min(1, p.caravans * 0.2);
    case 'coinage-customs': return anyKnows('coinage') ? 0.6 : 0;
    case 'guild-charters': case 'apprenticeship': return Math.min(1, share(p.craft) * 2);
    case 'levies': return settlements.length >= 3 ? 0.5 : 0;
    case 'feudal-oaths': return settlements.length >= 4 ? 0.4 : 0;
    case 'royal-court': return p.pop > 3000 ? 0.4 : 0;
    case 'taxation': case 'standing-army': return p.pop > 6000 ? 0.4 : 0;
    case 'ship-building': return share(p.coast) * 1.2;
    case 'tunnel-building': return share(p.hills) * 0.6;
    case 'road-building': return settled ? 0.4 : 0;
    case 'record-keeping': case 'written-law': case 'schools': return anyKnows('writing') ? 0.5 : 0;
    case 'envoys': case 'marriage-alliances': return 0.3;
    case 'inheritance': return settled ? 0.4 : 0;
    case 'tree-settling': return 0;
    default: return 0.2;
  }
}

/** The year's change in every culture: traditions taking root, deepening and fading; behaviours taken up. */
export function cultureYear(c: CultureContext): void {
  const { sim, lib } = c;
  fxCache.delete(sim);
  const cultures = sim.cultures ?? [];
  const alive = cultures.filter((cu) => sim.settlements.some((s) => !s.ruined && s.culture === cu.id) || sim.tribes.some((t) => t.culture === cu.id));
  // Where each culture is (for contact with others).
  const places = new Map(alive.map((cu) => [cu.id, [...sim.settlements.filter((s) => !s.ruined && s.culture === cu.id), ...sim.tribes.filter((t) => t.culture === cu.id)]]));
  const near = (a: string, b: string, km: number) => (places.get(a) ?? []).some((p) => (places.get(b) ?? []).some((q) => c.dist(p.x, p.y, q.x, q.y) < km));
  for (const cult of alive) {
    const pr = profile(c, cult);
    if (pr.p.pop <= 0) continue;
    const others = alive.filter((o) => o !== cult && near(cult.id, o.id, 400));
    const name = `The ${cult.name}`;
    const where = places.get(cult.id)?.[0];
    // Traditions: every one the Library knows, scored by how the culture lives.
    const scores = new Map(lib.traditions.map((t) => [t.id, traditionScore(c, cult, t.id, pr, others)]));
    for (const t of lib.traditions) {
      const score = scores.get(t.id) ?? 0;
      const levels = Math.max(1, t.levels.length);
      // What this life calls for: none below 0.3, then up the degrees.
      const want = score < 0.3 ? -2 : Math.min(levels - 1, Math.floor(((score - 0.3) / 0.7) * levels));
      let entry = cult.traditions.find((q) => q.id === t.id);
      if (entry?.hold === 'Locked') continue;
      const up = (entry?.hold === 'Encouraged' ? 2 : 1) / YEARS_PER_DEGREE;
      const down = (entry?.hold === 'Encouraged' ? 0.5 : 1) / YEARS_PER_DEGREE;
      if (!entry) {
        if (want < 0) continue;
        entry = { id: t.id, level: -1, hold: '', progress: 0 };
        cult.traditions.push(entry);
      }
      if (want > entry.level) entry.progress += up;
      else if (want < entry.level) entry.progress -= down;
      else entry.progress *= 0.8;
      if (entry.progress >= 1) {
        // Room for it among the six: a new tradition pushes out the one its people live least.
        const held = cult.traditions.filter((q) => q.level >= 0);
        if (entry.level < 0 && held.length >= MAX_TRADITIONS) {
          const weakest = held.filter((q) => q.hold !== 'Locked').sort((a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0))[0];
          if (!weakest || (scores.get(weakest.id) ?? 0) >= score) {
            entry.progress = 1;
            continue;
          }
          cult.traditions = cult.traditions.filter((q) => q !== weakest);
          c.log(`${name} have let go of ${tradName(lib, weakest.id)}.`, where?.x, where?.y);
        }
        entry.level++;
        entry.progress = 0;
        const degree = t.levels[entry.level]?.name ?? t.name;
        c.log(`${name} have become ${degree}${degree !== t.name ? ` (${t.name})` : ''}.`, where?.x, where?.y);
      } else if (entry.progress <= -1) {
        entry.level--;
        entry.progress = 0;
        if (entry.level < 0) {
          cult.traditions = cult.traditions.filter((q) => q !== entry);
          c.log(`${name}'s ${t.name} has faded.`, where?.x, where?.y);
        } else c.log(`${name}'s ${t.name} has eased to ${t.levels[entry.level]?.name ?? 'a milder degree'}.`, where?.x, where?.y);
      }
    }
    // Forming traditions that the life no longer calls for are dropped quietly.
    cult.traditions = cult.traditions.filter((q) => !(q.level < 0 && q.progress <= 0 && (scores.get(q.id) ?? 0) < 0.3));
    // Behaviours: by practice, and far faster by contact with others who have them.
    for (const b of lib.behaviours) {
      if (cult.behaviours.includes(b.id)) continue;
      if (!b.requires.every((r) => cult.behaviours.includes(r) || !lib.behaviours.some((q) => q.id === r))) continue;
      if (!b.needsTech.every((t) => pr.anyKnows(t) || !lib.techs.some((q) => q.id === t))) continue;
      const practice = behaviourPractice(b.id, pr);
      const teachers = others.filter((o) => o.behaviours.includes(b.id)).length;
      const rate = 0.05 * practice + (teachers ? 0.12 * Math.min(3, teachers) * cultureFx(sim, cult.id).learn : 0);
      if (rate > 0 && c.rand() < 1 - Math.exp(-rate)) {
        cult.behaviours.push(b.id);
        c.log(`${name} took up ${b.name}${teachers ? ' from their neighbours' : ''}.`, where?.x, where?.y);
      }
    }
    // A folk culture's ways of life follow how its people live (a Library culture keeps what was made).
    if (!cult.source) {
      const settledShare = pr.p.pop > 0 ? (pr.p.pop - pr.p.tribe) / pr.p.pop : 0;
      const ways = new Set(cult.lifestyles);
      if (settledShare > 0.6) ways.add('Settled');
      if (settledShare < 0.2) ways.delete('Settled');
      if (cult.traditions.some((t) => t.id === 'seafaring' && t.level >= 0)) ways.add('Seafaring');
      else ways.delete('Seafaring');
      if (settledShare > 0.6) ways.delete('Nomadic');
      cult.lifestyles = [...ways];
    }
    // The year's doings are counted afresh.
    cult.stats = { ...emptyStats(), lastFight: cult.stats?.lastFight ?? -1e9 };
  }
}
const tradName = (lib: Library, id: string) => lib.traditions.find((t) => t.id === id)?.name ?? id;

/** Count a deed toward the traditions it earns (fights, raids, trade with other cultures, famine). */
export function note(sim: SimState, cultureId: string, what: 'fights' | 'raids' | 'foreignTrade' | 'famines'): void {
  const c = cultureOf(sim, cultureId);
  if (!c) return;
  c.stats ??= emptyStats();
  c.stats[what]++;
  if (what === 'fights' || what === 'raids') c.stats.lastFight = sim.day;
}
