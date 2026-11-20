import type { Library } from '../core/library';
import type { Env } from './env';
import { addPop, total, type Pop } from './pops';
import type { LiveCulture, Settlement, SimState } from './state';
import { similarity } from './traits';
import { relatedness } from './languages';

/**
 * Drift, splits, blends and cohesion (REDESIGN.md, "Cultures as peoples", step 4), with the
 * culture tick, every five years.
 *
 * *Core distance:* each region of a culture (its people in a province) settles toward a balance
 * between what pushes it away and its contact with the culture's heartland: roughly push ÷ (push
 * + contact). Pushing away: a little random drift always; its towns' own local ways (the land's
 * pull); foreign neighbours (the share of the pressure there from other cultures); a great city of
 * its own there to look to. Pulling back: the heartland's influence reaching it, carried by roads
 * and rivers, fading with distance. So geography decides who drifts.
 *
 * Stages: under 0.15 an accent and local dishes; 0.15–0.30 a strong dialect and its own customs;
 * 0.30–0.50 a regional identity; past 0.50 a people of its own: the region (connected provinces
 * past it, with enough people) splits off as a subculture of its parent.
 *
 * *Blends:* two cultures sharing a province, each a good part of it (neither past 70%), on good
 * terms, for sixty years, blend there into a new culture with both as parents.
 *
 * *Cohesion* (asabiya): rises where a people faces very different ones round it or war, decays in
 * safe, crowded heartlands. It strengthens its fighters and its hold on its own ways.
 */

/** Stages of core distance. */
export const STAGES = [
  { from: 0, name: 'an accent and local dishes' },
  { from: 0.15, name: 'a strong dialect and its own customs' },
  { from: 0.3, name: 'a regional identity' },
  { from: 0.5, name: 'a people of its own' },
];
export const stageOf = (d: number) => [...STAGES].reverse().find((s) => d >= s.from)!.name;
export const SPLIT_AT = 0.5;
/** People a region needs to split off. */
export const SPLIT_PEOPLE = 200;
/** Share of the gap to its balance a region closes each tick (about fifty years to settle). */
export const DRIFT_PACE = 0.1;
/** Pushes: random drift always; per local way of its towns (up to three); foreign neighbours (times their share); a great city of its own. */
export const DRIFT_BASE = 0.1;
const PUSH_WAY = 0.1;
const PUSH_FOREIGN = 0.4;
const PUSH_CITY = 0.2;
/** How strongly contact with the heartland holds a region, and how far it reaches (km of open lowland to 1/e). */
const CONTACT = 3;
export const CONTACT_KM = 150;
/** Blends: shares each culture needs, acceptance, and ticks together. */
const BLEND_MIN = 0.3;
const BLEND_MAX = 0.7;
const BLEND_ACCEPT = 0.3;
export const BLEND_TICKS = 12;
/** Cohesion: a culture this unlike counts as very different, at this share of the pull; and the yearly rise and fall (per tick). */
const UNLIKE = 0.3;
const THREAT = 0.15;
const COHESION_UP = 0.08;
const COHESION_DOWN = 0.04;

export interface DriftContext {
  sim: SimState;
  env: Env;
  lib: Library;
  provAt(x: number, y: number): number;
  tier(st: Settlement): string;
  capital(st: Settlement): boolean;
  /** Each province's pressure by culture (this tick's, culturetick.ts). */
  press: Map<number, { culture: Map<string, number> }>;
  /** A new culture grown from others (cultureChange.ts): parents, an id hint. */
  make(from: LiveCulture[], hint: string): LiveCulture;
  acceptance(a: string, b: string): number;
  log(text: string, x?: number, y?: number): void;
}

const key = (cu: string, p: number | string) => `${cu}|${p}`;

/** Every culture's people by province (towns, tribes, the wild). */
function peopleByProvince(c: DriftContext): Map<number, Map<string, number>> {
  const { sim, env } = c;
  const out = new Map<number, Map<string, number>>();
  const add = (p: number, pops: readonly Pop[] | undefined) => {
    if (p < 0 || !pops) return;
    let m = out.get(p);
    if (!m) out.set(p, (m = new Map()));
    for (const q of pops) if (q.culture) m.set(q.culture, (m.get(q.culture) ?? 0) + q.n);
  };
  for (const st of sim.settlements) if (!st.ruined && !st.layer) add(c.provAt(st.x, st.y), st.pops);
  for (const t of sim.tribes) add(c.provAt(t.x, t.y), t.pops);
  const P = env.prov;
  for (let p = 0; p < P.count; p++) add(p, sim.country?.[String(P.ids[p])]);
  return out;
}

/** A culture's heartland: its capital, else its most populous settlement, else its biggest tribe. */
function heartOf(c: DriftContext, cu: string): { x: number; y: number } | null {
  const towns = c.sim.settlements.filter((s) => !s.ruined && !s.layer && s.culture === cu && s.partOf === undefined);
  const cap = towns.find((s) => c.capital(s));
  if (cap) return cap;
  const big = towns.sort((a, b) => b.pop - a.pop)[0];
  if (big) return big;
  return c.sim.tribes.filter((t) => t.culture === cu).sort((a, b) => b.pop - a.pop)[0] ?? null;
}

/** Contact with a point over the provinces (1 there, fading with distance: rough ground further, roads and shared rivers nearer). */
function contactFrom(c: DriftContext, p0: number): Float32Array {
  const { env, sim } = c;
  const P = env.prov;
  const got = new Float32Array(P.count);
  if (p0 < 0) return got;
  const way = (p: number) => {
    let w = 0;
    for (let q = P.start[p]; q < P.start[p + 1]; q++) w = Math.max(w, sim.way?.[P.cells[q]] ?? 0);
    return w;
  };
  got[p0] = 1;
  let front = [p0];
  for (let step = 0; step < 120 && front.length; step++) {
    const next: number[] = [];
    for (const p of front) {
      for (let i = P.nbStart[p]; i < P.nbStart[p + 1]; i++) {
        const q = P.nb[i];
        const rough = P.rough[q];
        if (!isFinite(rough) || rough <= 0) continue;
        let d = Math.hypot(P.x[q] - P.x[p], P.y[q] - P.y[p]) * Math.max(1, rough);
        const w = way(q);
        if (w >= 2) d /= 1.6;
        else if (w >= 1) d /= 1.25;
        const v = got[p] * Math.exp(-d / CONTACT_KM);
        if (v < 0.005 || v <= got[q]) continue;
        got[q] = v;
        next.push(q);
      }
    }
    front = next;
  }
  return got;
}

/** Every five years (after the culture tick): core distances, splits, blends, cohesion. */
export function driftTick(c: DriftContext): void {
  const { sim, env, lib } = c;
  const P = env.prov;
  const dist = (sim.coreDist ??= {});
  const people = peopleByProvince(c);
  const cultures = sim.cultures ?? [];
  const byId = new Map(cultures.map((q) => [q.id, q]));

  // ---- Core distance.
  const living = new Set<string>();
  for (const m of people.values()) for (const [cu, n] of m) if (n >= 1) living.add(cu);
  const next: Record<string, number> = {};
  for (const cu of living) {
    const heart = heartOf(c, cu);
    const hp = heart ? c.provAt(heart.x, heart.y) : -1;
    const contact = contactFrom(c, hp);
    for (const [p, m] of people) {
      const n = m.get(cu) ?? 0;
      if (n < 1) continue;
      // Pushes.
      const towns = sim.settlements.filter((s) => !s.ruined && !s.layer && s.culture === cu && s.partOf === undefined && c.provAt(s.x, s.y) === p);
      const ways = Math.min(3, towns.reduce((k, s) => k + (s.local ?? []).filter((q) => q.level >= 0 && !q.from).length, 0));
      const pr = c.press.get(p)?.culture;
      let all = 0;
      let foreign = 0;
      for (const [k, v] of pr ?? []) {
        all += v;
        if (k !== cu) foreign += v;
      }
      const city = towns.some((s) => p !== hp && (c.tier(s) === 'City' || c.tier(s) === 'Dawn city'));
      const push = DRIFT_BASE + PUSH_WAY * ways + PUSH_FOREIGN * (all > 0 ? foreign / all : 0) + (city ? PUSH_CITY : 0);
      const target = p === hp ? 0 : push / (push + CONTACT * contact[p]);
      const was = dist[key(cu, P.ids[p])] ?? 0;
      next[key(cu, P.ids[p])] = was + DRIFT_PACE * (target - was);
    }
  }
  sim.coreDist = next;

  // ---- Splits: connected provinces of a culture past the threshold, with enough people.
  for (const cu of living) {
    const parent = byId.get(cu);
    if (!parent) continue;
    const heart = heartOf(c, cu);
    const hp = heart ? c.provAt(heart.x, heart.y) : -1;
    const far = new Set<number>();
    for (const [p, m] of people) if (p !== hp && (m.get(cu) ?? 0) >= 1 && (next[key(cu, P.ids[p])] ?? 0) >= SPLIT_AT) far.add(p);
    const seen = new Set<number>();
    for (const p0 of far) {
      if (seen.has(p0)) continue;
      const region = [p0];
      seen.add(p0);
      for (let i = 0; i < region.length; i++) for (let j = P.nbStart[region[i]]; j < P.nbStart[region[i] + 1]; j++) {
        const q = P.nb[j];
        if (far.has(q) && !seen.has(q)) {
          seen.add(q);
          region.push(q);
        }
      }
      const n = region.reduce((s, p) => s + (people.get(p)?.get(cu) ?? 0), 0);
      if (n < SPLIT_PEOPLE) continue;
      const nc = c.make([parent], 'drift');
      nc.level = 'subculture';
      // The same tongue for now: a dialect first, a language of its own later.
      nc.language = parent.language || parent.name;
      const inRegion = new Set(region);
      convert(c, inRegion, cu, nc.id);
      for (const p of region) {
        next[key(nc.id, P.ids[p])] = 0;
        delete next[key(cu, P.ids[p])];
      }
      const big = sim.settlements.filter((s) => !s.ruined && s.culture === nc.id && s.partOf === undefined).sort((a, b) => b.pop - a.pop)[0];
      const at = big ?? { x: P.x[p0], y: P.y[p0] };
      c.log(`Long apart from their heartland, the ${parent.name}${big ? ` of ${big.name}` : ''} have become a people of their own: the ${nc.name}, of the ${parent.name} family.`, at.x, at.y);
    }
  }

  // ---- Blends: two cultures sharing a province, each a good part of it, on good terms.
  const mixed = (sim.mixed ??= {});
  const nowMixed: Record<string, number> = {};
  for (const [p, m] of people) {
    const all = [...m.values()].reduce((a, b) => a + b, 0);
    if (all < SPLIT_PEOPLE) continue;
    const big = [...m].filter(([, n]) => n / all >= BLEND_MIN && n / all <= BLEND_MAX).sort((a, b) => b[1] - a[1]);
    if (big.length < 2) continue;
    const [[a], [b]] = big;
    if (c.acceptance(a, b) < BLEND_ACCEPT || !byId.has(a) || !byId.has(b)) continue;
    const k = `${P.ids[p]}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
    nowMixed[k] = (mixed[k] ?? 0) + 1;
    if (nowMixed[k] < BLEND_TICKS) continue;
    const A = byId.get(a)!;
    const B = byId.get(b)!;
    const hy = c.make([A, B], 'blend');
    convert(c, new Set([p]), a, hy.id);
    convert(c, new Set([p]), b, hy.id);
    delete nowMixed[k];
    c.log(`The ${A.name} and the ${B.name}, long living side by side, have blended into one people: the ${hy.name}.`, P.x[p], P.y[p]);
  }
  sim.mixed = nowMixed;

  // ---- Cohesion: frontiers facing the very different, or war, harden; safe crowded heartlands soften.
  const alike = (a: string, b: string) => {
    const A = byId.get(a);
    const B = byId.get(b);
    return A && B ? similarity(lib, cultures, A, B, (x, y) => relatedness(sim, x, y)) : 0;
  };
  for (const st of sim.settlements) {
    if (st.ruined) continue;
    const p = c.provAt(st.x, st.y);
    let all = 0;
    let unlike = 0;
    const look = (q: number) => {
      for (const [k, v] of c.press.get(q)?.culture ?? []) {
        all += v;
        if (k !== st.culture && alike(k, st.culture) < UNLIKE) unlike += v;
      }
    };
    if (p >= 0) {
      look(p);
      for (let i = P.nbStart[p]; i < P.nbStart[p + 1]; i++) look(P.nb[i]);
    }
    const threat = (all > 0 && unlike / all >= THREAT) || (st.hardship?.war ?? 0) > 0.5;
    const safe = all > 0 && unlike / all < 0.02 && c.tier(st) !== 'Village';
    const was = st.cohesion ?? 0;
    st.cohesion = Math.max(0, Math.min(1, threat ? was + COHESION_UP : safe ? was - COHESION_DOWN : was - COHESION_DOWN / 4));
    if (st.cohesion < 0.005) delete st.cohesion;
  }
}

/** The people of one culture in some provinces become another (a split, a blend): towns, tribes and the wild there. */
function convert(c: DriftContext, provinces: Set<number>, from: string, to: string): void {
  const { sim, env } = c;
  const turn = (pops: Pop[] | undefined): Pop[] | undefined => {
    if (!pops) return pops;
    const out: Pop[] = [];
    for (const q of pops) addPop(out, q.culture === from ? { ...q, culture: to, material: q.material || from } : q);
    return out;
  };
  for (const st of sim.settlements) {
    if (st.ruined || !provinces.has(c.provAt(st.x, st.y))) continue;
    st.pops = turn(st.pops);
    if (st.culture === from) {
      st.culture = to;
      st.lastCulture = to;
      delete st.local;
    }
  }
  for (const t of sim.tribes) {
    if (!provinces.has(c.provAt(t.x, t.y))) continue;
    t.pops = turn(t.pops);
    if (t.culture === from) t.culture = to;
  }
  const P = env.prov;
  for (const p of provinces) {
    const k = String(P.ids[p]);
    if (sim.country?.[k]) sim.country[k] = turn(sim.country[k])!;
  }
  // A clan whose people are now mostly the new culture is of it.
  for (const clan of sim.clans) {
    if (clan.culture !== from) continue;
    const mine = [...sim.settlements.filter((s) => !s.ruined && s.clan === clan.id), ...sim.tribes.filter((t) => t.clan === clan.id)];
    const now = mine.filter((m) => m.culture === to).reduce((n, m) => n + m.pop, 0);
    if (now > total(mine.map((m) => ({ n: m.pop }) as Pop)) / 2) clan.culture = to;
  }
}

/** A settlement's region's core distance from its culture's heartland ('' unknown). */
export function coreDistanceOf(sim: SimState, env: Env, st: Settlement, provAt: (x: number, y: number) => number): number | null {
  const p = provAt(st.x, st.y);
  if (p < 0) return null;
  return sim.coreDist?.[key(st.culture, env.prov.ids[p])] ?? null;
}
