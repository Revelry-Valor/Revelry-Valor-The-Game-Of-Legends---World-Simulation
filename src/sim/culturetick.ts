import type { Library } from '../core/library';
import type { Env } from './env';
import { addPop, mainOf, materialOf, tidy, total, type Pop } from './pops';
import type { LiveCulture, Settlement, SimState } from './state';
import { similarity } from './traits';

/**
 * The culture tick (REDESIGN.md, "Cultures as peoples", step 3), every five years.
 *
 * 1. *Pressure:* each settlement sends out influence by its prestige (its size, a capital or a
 *    province's seat, its trade, holy ground), for its culture and its tongue. Influence travels
 *    from province to province, fading with distance (to about a third in 100 km of open lowland):
 *    roads and rivers carry it further, rough country and mountains less far, and a border of
 *    tongues cuts it. A realm
 *    presses its own culture on its places, as strongly as its orders reach them.
 * 2. *Pops change, a slice at a time,* toward the strongest outside pull, each trait at its speed:
 *    material culture fast (copied from whoever looks successful), its culture (customs, law,
 *    values) over decades, its tongue slowest (mostly at births: children take up the main
 *    tongue). How readily: elites before the middle class before commoners, city folk before
 *    villagers before those in the wild; a culture far from its own is taken up more slowly
 *    (similar peoples come together, the unlike stay apart); and conformity: a way few round them
 *    hold (half their own place, half who lives near by the pressure) spreads slowly, quickens past
 *    a fifth or so, and sweeps on once it is most of them.
 * 3. A settlement counts itself of whatever culture most of its people now are.
 *
 * Religion stays with the faiths (faith.ts) for now.
 */

export const CULTURE_TICK = 5;
/** Years for a people to take up another's material culture, culture, and tongue under full pressure. */
export const YEARS: Record<'material' | 'culture' | 'language', number> = { material: 20, culture: 50, language: 90 };
/** Influence fades by distance: to 1/e over this many km of open lowland (rough ground counts as further, roads and rivers as nearer); dropped below this share of its start. */
export const REACH_KM = 100;
const MAX_STEPS = 80;
const FLOOR = 0.03;
/** A border of tongues cuts influence by this. */
const LANGUAGE_BARRIER = 0.6;
/** How strongly a realm presses its culture on a place it fully controls (to the place's own pull). */
export const RULE_PRESS = 0.8;
/** Children learn their tongue mostly at home: the weight of their own place's speech (the rest, who lives near). */
export const LANGUAGE_HOME = 0.8;
/** The weight of a place's own ways in holding against an outside pull. */
const HOLD = 0.15;

const RECEPTIVE = { elite: 1.6, middle: 1, commoner: 0.7 } as const;
const PLACE = { city: 1.4, town: 1.1, village: 0.8, tribe: 0.6, wild: 0.5 } as const;
type Place = keyof typeof PLACE;

/** How readily a way spreads by the share of those round who already hold it: slow while rare, quick past a fifth or so, sweeping once most hold it. */
export function conformity(share: number): number {
  const s = 0.1 + 0.9 / (1 + Math.exp(-(share - 0.3) * 12));
  return share > 0.5 ? s * 1.5 : s;
}

export interface TickContext {
  sim: SimState;
  env: Env;
  lib: Library;
  provAt(x: number, y: number): number;
  /** A settlement's tier ('Village', 'Town', 'City', 'Dawn city'). */
  tier(st: Settlement): string;
  /** How firmly a clan's realm enforces its ways (0 none … 1), and a place's control (0–1). */
  enforce(clan: number): number;
  /** Whether a settlement is its realm's capital. */
  capital(st: Settlement): boolean;
  log(text: string, x?: number, y?: number): void;
}

/** A settlement's prestige: its size, a capital or seat, its trade, holy ground. */
export function prestige(c: TickContext, st: Settlement, routes: Map<number, number>): number {
  const tier = c.tier(st);
  let p = Math.pow(Math.max(0, st.pop) / 1000, 0.8);
  let m = 1;
  if (c.capital(st)) m += 1;
  if (st.seat) m += 0.3;
  m += Math.min(0.5, (routes.get(st.id) ?? 0) * 0.1);
  if (st.holyTo.length) m += 0.3;
  // A cohesive people draws its neighbours more (drift.ts).
  m *= 1 + 0.5 * (st.cohesion ?? 0);
  if (tier === 'Village') p *= 0.5;
  return p * m;
}

type Press = Map<string, number>;
export interface ProvPress {
  culture: Press;
  language: Press;
}
const bump = (m: Press, k: string, v: number) => {
  if (k && v > 0) m.set(k, (m.get(k) ?? 0) + v);
};

/** Each province's pressure, by culture and by tongue. */
export function pressures(c: TickContext): Map<number, ProvPress> {
  const { sim, env } = c;
  const P = env.prov;
  const live = sim.settlements.filter((s) => !s.ruined && !s.layer && s.partOf === undefined && s.pop > 0);
  // Each province's main tongue (for the borders of tongues), and how easy it is to get into.
  const tongues = new Map<number, Press>();
  const addT = (p: number, pops: readonly Pop[] | undefined) => {
    if (p < 0 || !pops) return;
    let m = tongues.get(p);
    if (!m) tongues.set(p, (m = new Map()));
    for (const q of pops) bump(m, q.language, q.n);
  };
  for (const st of sim.settlements) if (!st.ruined && !st.layer) addT(c.provAt(st.x, st.y), st.pops);
  for (let p = 0; p < P.count; p++) addT(p, sim.country?.[String(P.ids[p])]);
  const tongueOf = (p: number) => {
    const m = tongues.get(p);
    if (!m) return '';
    let best = '';
    let n = -1;
    for (const [k, v] of m) if (v > n) [best, n] = [k, v];
    return best;
  };
  const way = new Float32Array(P.count);
  const river = new Uint8Array(P.count);
  for (let p = 0; p < P.count; p++) {
    for (let q = P.start[p]; q < P.start[p + 1]; q++) {
      const k = P.cells[q];
      way[p] = Math.max(way[p], sim.way?.[k] ?? 0);
      if (env.fresh[k]) river[p] = 1;
    }
  }
  /** How far, in effect, from one province's middle to the next's: rough ground further, roads and a shared river nearer (Infinity: impassable). */
  const far = (from: number, to: number) => {
    const rough = P.rough[to];
    if (!isFinite(rough) || rough <= 0) return Infinity;
    let d = Math.hypot(P.x[to] - P.x[from], P.y[to] - P.y[from]) * Math.max(1, rough);
    if (way[to] >= 2) d /= 1.6;
    else if (way[to] >= 1) d /= 1.25;
    if (river[from] && river[to]) d /= 1.3;
    return d;
  };
  const routes = new Map<number, number>();
  for (const r of sim.routes ?? []) {
    routes.set(r.a, (routes.get(r.a) ?? 0) + 1);
    routes.set(r.b, (routes.get(r.b) ?? 0) + 1);
  }
  const out = new Map<number, ProvPress>();
  const at = (p: number) => {
    let x = out.get(p);
    if (!x) out.set(p, (x = { culture: new Map(), language: new Map() }));
    return x;
  };
  for (const st of live) {
    const p0 = c.provAt(st.x, st.y);
    if (p0 < 0) continue;
    const E = prestige(c, st, routes);
    if (E <= 0) continue;
    const culture = st.culture;
    const tongue = mainOf(st.pops ?? [], 'language') || tongueOf(p0);
    // Best-first spread over the provinces.
    const got = new Map<number, number>([[p0, E]]);
    let front = [p0];
    for (let step = 0; step < MAX_STEPS && front.length; step++) {
      const next: number[] = [];
      for (const p of front) {
        const v = got.get(p)!;
        for (let i = P.nbStart[p]; i < P.nbStart[p + 1]; i++) {
          const q = P.nb[i];
          let w = v * Math.exp(-far(p, q) / REACH_KM);
          if (tongue && tongueOf(q) && tongueOf(q) !== tongue) w *= LANGUAGE_BARRIER;
          if (w < E * FLOOR || w <= (got.get(q) ?? 0)) continue;
          got.set(q, w);
          next.push(q);
        }
      }
      front = next;
    }
    for (const [p, v] of got) {
      const x = at(p);
      bump(x.culture, culture, v);
      bump(x.language, tongue, v);
    }
  }
  // Rulers press their culture on the places they rule, as far as their orders reach.
  for (const st of live) {
    const clan = sim.clans.find((q) => q.id === st.clan);
    if (!clan?.culture || clan.culture === st.culture) continue;
    const press = RULE_PRESS * c.enforce(clan.id) * (st.control ?? 0) * Math.max(0.2, prestige(c, st, routes));
    const p = c.provAt(st.x, st.y);
    if (p >= 0 && press > 0) bump(at(p).culture, clan.culture, press);
  }
  return out;
}

/** One pop's slices toward the strongest outside pulls (material culture, culture, tongue). */
function shiftPop(q: Pop, place: Place, hold: number, press: ProvPress, local: { culture: Press; language: Press; material: Press; all: number }, alike: (a: string, b: string) => number, out: Pop[]): void {
  const r = RECEPTIVE[q.cls] * PLACE[place];
  // A cohesive people holds to its own culture and tongue (its goods change as readily).
  const firm = 1 - 0.5 * hold;
  const pull = (m: Press, own: string): { v: string; d: number } | null => {
    let best = '';
    let bv = 0;
    for (const [k, v] of m) if (k !== own && v > bv) [best, bv] = [k, v];
    if (!best) return null;
    const mine = m.get(own) ?? 0;
    return { v: best, d: bv / (bv + mine + HOLD) };
  };
  // Those round them: half their own place, half the pressure on it (who lives near, and how many).
  const pressAll = (m: Press) => [...m.values()].reduce((a, b) => a + b, 0);
  const pc = pressAll(press.culture);
  const pl = pressAll(press.language);
  const near = (m: Press, all: number, v: string) => (all > 0 ? (m.get(v) ?? 0) / all : 0);
  const share = (m: Press, v: string, pm: Press, pall: number, home = 0.5) => home * (local.all > 0 ? (m.get(v) ?? 0) / local.all : 0) + (1 - home) * near(pm, pall, v);
  let n = q.n;
  const moves: { key: 'material' | 'culture' | 'language'; v: string; f: number }[] = [];
  const mat = pull(press.culture, materialOf(q));
  if (mat) moves.push({ key: 'material', v: mat.v, f: (CULTURE_TICK / YEARS.material) * r * mat.d * conformity(share(local.material, mat.v, press.culture, pc)) });
  const cul = pull(press.culture, q.culture);
  if (cul) moves.push({ key: 'culture', v: cul.v, f: (CULTURE_TICK / YEARS.culture) * r * cul.d * conformity(share(local.culture, cul.v, press.culture, pc)) * (0.5 + 0.5 * alike(q.culture, cul.v)) * firm });
  const lang = q.language ? pull(press.language, q.language) : null;
  if (lang) moves.push({ key: 'language', v: lang.v, f: (CULTURE_TICK / YEARS.language) * r * lang.d * conformity(share(local.language, lang.v, press.language, pl, LANGUAGE_HOME)) * firm });
  for (const m of moves) {
    const f = Math.max(0, Math.min(0.5, m.f));
    const t = q.n * f;
    if (t < 0.05) continue;
    n -= t;
    const moved: Pop = { ...q, n: t };
    if (m.key === 'material') moved.material = m.v;
    else if (m.key === 'culture') {
      // Their goods and houses stay as they were until they change those too.
      moved.material = materialOf(q);
      moved.culture = m.v;
    } else moved.language = m.v;
    out.push(moved);
  }
  out.push({ ...q, n: Math.max(0, n) });
}

/** What a group of pops holds, by share (for conformity). */
function localOf(pops: readonly Pop[]) {
  const culture: Press = new Map();
  const language: Press = new Map();
  const material: Press = new Map();
  for (const q of pops) {
    bump(culture, q.culture, q.n);
    bump(language, q.language, q.n);
    bump(material, materialOf(q), q.n);
  }
  return { culture, language, material, all: total(pops) };
}

/** Every five years: pressure, then each pop's slices; settlements count themselves of their people's main culture. */
export function cultureTick(c: TickContext): Map<number, ProvPress> {
  const { sim, env, lib } = c;
  const press = pressures(c);
  const cultures = sim.cultures ?? [];
  const byId = new Map(cultures.map((q) => [q.id, q]));
  const simCache = new Map<string, number>();
  const alike = (a: string, b: string) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    let v = simCache.get(k);
    if (v === undefined) {
      const A = byId.get(a);
      const B = byId.get(b);
      v = A && B ? similarity(lib, cultures, A, B) : 0;
      simCache.set(k, v);
    }
    return v;
  };
  const shiftAll = (pops: Pop[] | undefined, p: number, place: Place, hold = 0): Pop[] | undefined => {
    if (!pops?.length || p < 0) return pops;
    const pr = press.get(p);
    if (!pr) return pops;
    const local = localOf(pops);
    const out: Pop[] = [];
    for (const q of pops) shiftPop(q, place, hold, pr, local, alike, out);
    const next: Pop[] = [];
    for (const q of out) addPop(next, q);
    return tidy(next);
  };
  const placeOf = (st: Settlement): Place => {
    const t = c.tier(st);
    return t === 'City' || t === 'Dawn city' ? 'city' : t === 'Town' ? 'town' : 'village';
  };
  for (const st of sim.settlements) {
    if (st.ruined || !st.pops?.length) continue;
    const before = st.culture;
    st.pops = shiftAll(st.pops, c.provAt(st.x, st.y), placeOf(st), st.cohesion ?? 0);
    // The strongest outside pull on it, for its card.
    const pr = press.get(c.provAt(st.x, st.y));
    let to = '';
    let v = 0;
    let all = 0;
    for (const [k, x] of pr?.culture ?? []) {
      all += x;
      if (k !== st.culture && x > v) [to, v] = [k, x];
    }
    st.pull = to && all > 0 ? { to, share: v / all } : undefined;
    delete st.cultureShift;
    // A settlement is of whatever culture most of its people now are.
    const main = mainOf(st.pops ?? [], 'culture');
    if (main && main !== before && byId.has(main)) {
      st.culture = main;
      if (st.partOf === undefined) c.log(`Most of the people of ${st.name} now count themselves ${byId.get(main)!.name} (once ${byId.get(before)?.name ?? 'another people'}).`, st.x, st.y);
    }
  }
  for (const t of sim.tribes) {
    if (!t.pops?.length) continue;
    t.pops = shiftAll(t.pops, c.provAt(t.x, t.y), 'tribe');
    const main = mainOf(t.pops ?? [], 'culture');
    if (main && byId.has(main)) t.culture = main;
  }
  const P = env.prov;
  for (let p = 0; p < P.count; p++) {
    const key = String(P.ids[p]);
    const cp = sim.country?.[key];
    if (cp?.length) sim.country![key] = shiftAll(cp, p, 'wild') ?? cp;
  }
  return press;
}

/** The culture a pop's goods, houses and dress come from (for its card). */
export const materialName = (cultures: LiveCulture[], q: Pop) => cultures.find((c) => c.id === materialOf(q))?.name ?? '';
