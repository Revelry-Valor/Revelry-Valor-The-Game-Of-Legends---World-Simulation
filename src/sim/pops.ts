import type { Env } from './env';
import type { Settlement, SimState, Tribe } from './state';

/**
 * Pops (REDESIGN.md, "Cultures as peoples", step 1).
 *
 * The people of a place are groups (pops) sharing a race, culture, language, faith and class. A
 * settlement's or tribe's own number (`pop`) stays the count of its people, as before; its pops say
 * who those people are, and are brought back in line with the count whenever it changes (births
 * shared out by size, losses falling hardest on commoners). Moves between places carry real pops:
 * a slice of each, so migrants bring their culture with them.
 *
 * The families living in the wild (density.ts, per race and point) are the country pops: kept by
 * province, they say who the wild folk there are (of the 3,000 humans here, 70% Celtic, 30% Roman);
 * the density still says how many and where. Their make-up mixes a little with the neighbouring
 * provinces each year as families spread, and takes in those who leave the towns.
 *
 * Kept small: a pop under a thousandth of its class there (or half a person) merges into the most
 * alike one, and a place keeps at most 24 pops (a slow trickle of change still adds up).
 */

export type PopClass = 'elite' | 'middle' | 'commoner';
export const CLASSES: PopClass[] = ['elite', 'middle', 'commoner'];

export interface Pop {
  race: string;
  culture: string;
  /** The tongue it speaks (a language name; for now a culture's language). */
  language: string;
  /** Its faith (a live faith id, '' none). */
  faith: string;
  /** Whose material culture it lives by (building, dress, food: a culture id); unset: its own culture's. */
  material?: string;
  cls: PopClass;
  n: number;
}

/** Something that holds people: a settlement or a tribe. */
export type Holder = Pick<Settlement | Tribe, 'race' | 'culture' | 'faith' | 'pop'> & { pops?: Pop[] };

/** Smallest pop kept: a share of its place, or a count. */
export const MIN_SHARE = 0.001;
export const MIN_PEOPLE = 0.5;
/** At most this many pops a place (the smallest folded into the most alike past it). */
export const MAX_POPS = 24;
/** Who bears losses: commoners most, elites least. */
const LOSS: Record<PopClass, number> = { elite: 0.5, middle: 1, commoner: 1.2 };
/** Who leaves with migrants: elites seldom. */
const LEAVE: Record<PopClass, number> = { elite: 0.2, middle: 1, commoner: 1.1 };
/** A year's share of the wild folk's make-up that comes from each neighbouring province. */
export const COUNTRY_MIX = 0.05;
/** Classes move toward what a place's life calls for by this share of the gap a year. */
const CLASS_PACE = 0.1;

/** Whose material culture a pop lives by. */
export const materialOf = (p: Pop) => p.material || p.culture;
const same = (a: Pop, b: Pop) => a.race === b.race && a.culture === b.culture && a.language === b.language && a.faith === b.faith && a.cls === b.cls && materialOf(a) === materialOf(b);
/** How alike two pops are (to merge the small into the most alike). */
const likeness = (a: Pop, b: Pop) => (a.race === b.race ? 8 : 0) + (a.culture === b.culture ? 4 : 0) + (a.cls === b.cls ? 2 : 0) + (a.language === b.language ? 1 : 0) + (a.faith === b.faith ? 1 : 0) + (materialOf(a) === materialOf(b) ? 1 : 0);

export const total = (pops: readonly Pop[]) => pops.reduce((n, p) => n + p.n, 0);

/** A culture's tongue (its language, else its name). */
export function tongueOf(sim: SimState, culture: string): string {
  const cu = sim.cultures?.find((c) => c.id === culture);
  return cu?.language || cu?.name || '';
}

/** Add people to a list of pops, joining the same pop where there is one. */
export function addPop(pops: Pop[], p: Pop): void {
  if (p.n <= 0) return;
  const o = pops.find((q) => same(q, p));
  if (o) o.n += p.n;
  else {
    const q = { ...p };
    // Its own culture's material culture needs no mark.
    if (q.material === q.culture) delete q.material;
    pops.push(q);
  }
}

/** Merge pops alike in every way, drop the empty, and fold the small into the most alike. */
export function tidy(pops: Pop[]): Pop[] {
  const out: Pop[] = [];
  for (const p of pops) if (p.n > 0.01) addPop(out, p);
  // Small by its own class (a town's few elites are many of its elites).
  const byCls = new Map<string, number>();
  for (const p of out) byCls.set(p.cls, (byCls.get(p.cls) ?? 0) + p.n);
  const small = (p: Pop) => {
    const all = byCls.get(p.cls) ?? 0;
    return p.n < Math.max(Math.min(MIN_PEOPLE, all * 0.25), all * MIN_SHARE);
  };
  out.sort((a, b) => a.n - b.n);
  for (let i = 0; i < out.length && out.length > 1; ) {
    const p = out[i];
    if (!small(p)) {
      i++;
      continue;
    }
    // Into the most alike of its own class (a class is never folded away while it has people: a
    // village's few elites stay its elites); with none of its class left, kept unless under one person.
    let best: Pop | null = null;
    for (const q of out) if (q !== p && q.cls === p.cls && (!best || likeness(p, q) > likeness(p, best) || (likeness(p, q) === likeness(p, best) && q.n > best.n))) best = q;
    if (!best && p.n < 1) for (const q of out) if (q !== p && (!best || likeness(p, q) > likeness(p, best))) best = q;
    if (!best) {
      i++;
      continue;
    }
    best.n += p.n;
    out.splice(i, 1);
  }
  // Too many: the smallest folded into the most alike (of its class where there is one).
  while (out.length > MAX_POPS) {
    const p = out[0];
    let best: Pop | null = null;
    for (const q of out) if (q !== p && (!best || likeness(p, q) + (q.cls === p.cls ? 4 : 0) > likeness(p, best) + (best.cls === p.cls ? 4 : 0))) best = q;
    if (!best) break;
    best.n += p.n;
    out.shift();
  }
  return out.sort((a, b) => b.n - a.n);
}

/** The biggest share of something among pops (culture, language, faith, race), or ''. */
export function mainOf(pops: readonly Pop[], key: 'culture' | 'language' | 'faith' | 'race'): string {
  const by = new Map<string, number>();
  for (const p of pops) by.set(p[key], (by.get(p[key]) ?? 0) + p.n);
  let best = '';
  let n = -1;
  for (const [k, v] of by) if (v > n) [best, n] = [k, v];
  return best;
}

/** Shares by something among pops, biggest first. */
export function sharesOf(pops: readonly Pop[], key: 'culture' | 'language' | 'faith' | 'race' | 'cls'): [string, number][] {
  const all = total(pops) || 1;
  const by = new Map<string, number>();
  for (const p of pops) by.set(p[key], (by.get(p[key]) ?? 0) + p.n);
  return [...by].map(([k, v]) => [k, v / all] as [string, number]).sort((a, b) => b[1] - a[1]);
}

/** A first make-up for a place that has none: all of its race, culture and faith, in classes. */
function firstPops(sim: SimState, h: Holder, classes: Record<PopClass, number>): Pop[] {
  const base = { race: h.race, culture: h.culture, language: tongueOf(sim, h.culture), faith: h.faith ?? '' };
  return CLASSES.map((cls) => ({ ...base, cls, n: h.pop * classes[cls] })).filter((p) => p.n > 0);
}

/**
 * A place's pops, in line with its count and its culture (made the first time they are asked
 * for). A count that has grown shares the growth out by size (births); one that has fallen takes
 * the loss most from commoners. Where something has given the place another culture or faith
 * (rulers, a big neighbour, a split), its people of the old main one take the new: for now the
 * whole of them; slowly, a slice at a time, once cultures move by pops (step 3).
 */
export function popsOf(sim: SimState, h: Holder, classes: Record<PopClass, number> = { elite: 0, middle: 0, commoner: 1 }): Pop[] {
  if (!h.pops || !h.pops.length) {
    h.pops = h.pop > 0 ? firstPops(sim, h, classes) : [];
    return h.pops;
  }
  const pops = h.pops;
  const sum = total(pops);
  const want = Math.max(0, h.pop);
  if (want <= 0) {
    h.pops = [];
    return h.pops;
  }
  if (sum <= 0) {
    h.pops = firstPops(sim, h, classes);
    return h.pops;
  }
  if (want > sum + 0.01) {
    const f = want / sum;
    for (const p of pops) p.n *= f;
  } else if (want < sum - 0.01) {
    let lose = sum - want;
    // Losses by weight, more from commoners; a pop can't lose more than it has (the rest then from the others).
    for (let pass = 0; pass < 4 && lose > 0.01; pass++) {
      const w = pops.reduce((n, p) => n + (p.n > 0 ? p.n * LOSS[p.cls] : 0), 0);
      if (w <= 0) break;
      let took = 0;
      for (const p of pops) {
        if (p.n <= 0) continue;
        const t = Math.min(p.n, (lose * p.n * LOSS[p.cls]) / w);
        p.n -= t;
        took += t;
      }
      lose -= took;
    }
  }
  // Another culture or faith given to the place as a whole.
  const cul = mainOf(pops, 'culture');
  if (h.culture && cul !== h.culture) for (const p of pops) if (p.culture === cul) p.culture = h.culture;
  const fa = mainOf(pops, 'faith');
  if ((h.faith ?? '') !== fa && h.faith) for (const p of pops) if (p.faith === fa) p.faith = h.faith;
  h.pops = tidy(pops);
  return h.pops;
}

/**
 * Take a slice of people from a place's pops (elites seldom go), as pops of their own. The place's
 * count is lowered to match; the caller adds them where they go (`joinPops`, or the wild).
 */
export function takePops(sim: SimState, from: Holder, n: number, leave: Record<PopClass, number> = LEAVE): Pop[] {
  const pops = popsOf(sim, from);
  n = Math.min(n, total(pops));
  if (n <= 0) return [];
  const w = pops.reduce((s, p) => s + p.n * leave[p.cls], 0);
  const out: Pop[] = [];
  let took = 0;
  if (w > 0) for (const p of pops) {
    const t = Math.min(p.n, (n * p.n * leave[p.cls]) / w);
    if (t <= 0) continue;
    p.n -= t;
    took += t;
    out.push({ ...p, n: t });
  }
  // Rounding: what is still owed, from whoever has it.
  for (const p of pops) {
    if (took >= n - 0.01) break;
    const t = Math.min(p.n, n - took);
    p.n -= t;
    took += t;
    addPop(out, { ...p, n: t });
  }
  from.pop = Math.max(0, from.pop - took);
  from.pops = tidy(pops);
  return out;
}

/** People joining a place: its count grows by them, and they are its pops now. */
export function joinPops(sim: SimState, to: Holder, pops: Pop[]): void {
  const mine = popsOf(sim, to);
  for (const p of pops) addPop(mine, p);
  to.pop += total(pops);
  to.pops = tidy(mine);
}

/** People moved from one place to another, as pops. */
export function movePeople(sim: SimState, from: Holder, to: Holder, n: number): void {
  joinPops(sim, to, takePops(sim, from, n));
}

/** A new place made of people taken from another: its pops are theirs (its count already set to them). */
export function startPops(sim: SimState, h: Holder, pops: Pop[]): void {
  h.pops = tidy(pops.map((p) => ({ ...p })));
  const t = total(h.pops);
  if (t > 0 && Math.abs(t - h.pop) > 0.5) for (const p of h.pops) p.n *= h.pop / t;
}

// ---- Classes in towns.

/** The class shares a settlement's life calls for: elites by its size and seat, the middle by its hands off the food jobs (crafts, mines, trade). */
export function classShares(st: Settlement, tier: string): Record<PopClass, number> {
  const elite = (tier === 'City' || tier === 'Dawn city' ? 0.05 : tier === 'Town' ? 0.03 : 0.01) + (st.seat ? 0.01 : 0);
  const jobs = st.economy?.jobs ?? {};
  let all = 0;
  let off = 0;
  for (const [k, v] of Object.entries(jobs)) {
    all += v;
    if (!(k.startsWith('farm:') || k.startsWith('fish:') || k.startsWith('herd:') || k === 'gather' || k === 'hunt')) off += v;
  }
  const middle = Math.min(0.4, (all > 0 ? off / all : 0) * 0.8 + (tier === 'Village' ? 0 : 0.05));
  return { elite, middle, commoner: Math.max(0, 1 - elite - middle) };
}

/** Once a year: a settlement's classes move toward what its life calls for (each people of it on its own). */
export function classYear(sim: SimState, st: Settlement, tier: string): void {
  const pops = popsOf(sim, st);
  const want = classShares(st, tier);
  const groups = new Map<string, Pop[]>();
  for (const p of pops) {
    const k = `${p.race}|${p.culture}|${p.language}|${p.faith}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const g of groups.values()) {
    const all = total(g);
    if (all <= 0) continue;
    const proto = g[0];
    for (const cls of CLASSES) {
      const has = g.filter((p) => p.cls === cls).reduce((n, p) => n + p.n, 0);
      const d = (want[cls] * all - has) * CLASS_PACE;
      if (Math.abs(d) < 0.01) continue;
      // Moved to or from the other classes of the same people, by their size.
      const others = g.filter((p) => p.cls !== cls);
      const on = total(others);
      if (on <= 0) continue;
      const move = d > 0 ? Math.min(d, on) : Math.max(d, -has);
      for (const o of others) o.n -= (move * o.n) / on;
      const mine = g.find((p) => p.cls === cls);
      if (mine) mine.n += move;
      else {
        const p = { ...proto, cls, n: move };
        pops.push(p);
        g.push(p);
      }
    }
  }
  st.pops = tidy(pops);
}

// ---- The wild folk (country pops, by province).

const countryKey = (env: Env, p: number) => String(env.prov.ids[p]);

/** The wild folk of a province (by its kept id). */
export function countryOf(sim: SimState, env: Env, p: number): Pop[] {
  if (p < 0) return [];
  const all = (sim.country ??= {});
  return (all[countryKey(env, p)] ??= []);
}

/** People going out to live in the wild in a province: they are its wild folk now (the density is added by the caller). */
export function toCountry(sim: SimState, env: Env, p: number, pops: Pop[]): void {
  if (p < 0) return;
  const c = countryOf(sim, env, p);
  for (const q of pops) addPop(c, { ...q, cls: 'commoner' });
}

/**
 * Take wild folk of a race from a province, as pops (a village forming, people drawn to a town).
 * Falls back to `kin` (the nearest town of that race) where the province's wild folk are not known yet.
 */
export function fromCountry(sim: SimState, env: Env, p: number, race: string, n: number, kin: Holder | null): Pop[] {
  const c = p >= 0 ? countryOf(sim, env, p) : [];
  const mine = c.filter((q) => q.race === race && q.n > 0);
  const have = total(mine);
  if (have <= 0) {
    if (!kin) return [];
    return [{ race, culture: kin.culture, language: tongueOf(sim, kin.culture), faith: kin.faith ?? '', cls: 'commoner', n }];
  }
  const out: Pop[] = [];
  for (const q of mine) {
    const t = (n * q.n) / have;
    out.push({ ...q, n: t });
    q.n = Math.max(0, q.n - t);
  }
  return out;
}

/**
 * Once a year: each province's wild folk brought in line with the density there (by race), their
 * make-up mixing a little with the neighbouring provinces' as families spread. Where a race lives
 * in the wild with no make-up known (it spread there this year), it takes its neighbours', else its
 * nearest kin town's.
 */
export function countryYear(sim: SimState, env: Env, nearestKin: (race: string, x: number, y: number) => Holder | null): void {
  const P = env.prov;
  const dens = sim.density ?? {};
  const races = Object.keys(dens);
  // Wild people by province and race.
  const wild = new Map<number, Map<string, number>>();
  for (const race of races) {
    const d = dens[race];
    for (let k = 0; k < d.length; k++) {
      const v = d[k];
      if (v <= 0) continue;
      const p = P.of[k];
      if (p < 0) continue;
      let m = wild.get(p);
      if (!m) wild.set(p, (m = new Map()));
      m.set(race, (m.get(race) ?? 0) + v);
    }
  }
  const before = new Map<number, Pop[]>();
  for (let p = 0; p < P.count; p++) {
    const c = sim.country?.[countryKey(env, p)];
    if (c?.length) before.set(p, c.map((q) => ({ ...q })));
  }
  const next: Record<string, Pop[]> = {};
  for (const [p, byRace] of wild) {
    const out: Pop[] = [];
    const own = before.get(p) ?? [];
    for (const [race, n] of byRace) {
      if (n < 1) continue;
      const mix: Pop[] = [];
      for (const q of own) if (q.race === race) addPop(mix, q);
      const ownN = total(mix);
      for (let i = P.nbStart[p]; i < P.nbStart[p + 1]; i++) {
        const nb = before.get(P.nb[i]);
        if (!nb) continue;
        for (const q of nb) if (q.race === race) addPop(mix, { ...q, n: q.n * (ownN > 0 ? COUNTRY_MIX : 1) });
      }
      if (total(mix) <= 0) {
        const kin = nearestKin(race, P.x[p], P.y[p]);
        mix.push({ race, culture: kin?.culture ?? '', language: kin ? tongueOf(sim, kin.culture) : '', faith: kin?.faith ?? '', cls: 'commoner', n: 1 });
      }
      const t = total(mix);
      for (const q of mix) out.push({ ...q, cls: 'commoner', n: (q.n * n) / t });
    }
    if (out.length) next[countryKey(env, p)] = tidy(out);
  }
  sim.country = next;
}

/** Everyone of a province: its wild folk and the people of its settlements (for its make-up). */
export function provincePops(sim: SimState, env: Env, p: number, provOf: (st: Settlement) => number): Pop[] {
  const out: Pop[] = [];
  for (const q of sim.country?.[countryKey(env, p)] ?? []) addPop(out, q);
  for (const st of sim.settlements) if (!st.ruined && st.pops && provOf(st) === p) for (const q of st.pops) addPop(out, q);
  return out;
}
