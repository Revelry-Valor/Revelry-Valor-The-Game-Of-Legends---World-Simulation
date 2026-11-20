import type { Env } from './env';
import type { Pop } from './pops';
import type { SimState } from './state';

/**
 * The history of peoples (REDESIGN.md, "Cultures as peoples", step 7): what the timeline view draws.
 *
 * Each culture tick (five years) a snapshot: the people of every culture, language and race, and
 * each province's main culture (for the map at that moment). Lineage events are read from the
 * changes between snapshots: a culture or tongue that appeared (a split from its parent, a blend
 * or creole of two), a dialect grown into a language (promoted), one that ended (absorbed into the
 * culture its last town took on, or extinct), and major changes without a split (a people's
 * religion or tongue changing). Old snapshots are thinned (every other one) past 240, so a long
 * history stays small; events are kept in full.
 */

export type Track = 'culture' | 'language' | 'race';
export type LineageKind = 'appeared' | 'split' | 'hybrid' | 'promoted' | 'absorbed' | 'extinct' | 'religion' | 'language' | 'revived';

export interface Snapshot {
  day: number;
  cultures: Record<string, number>;
  languages: Record<string, number>;
  races: Record<string, number>;
  /** Each province's main culture (by province id). */
  provs: Record<string, string>;
}

export interface LineageEvent {
  day: number;
  track: Track;
  kind: LineageKind;
  /** The line it happened to, and another it involves (the parent split from, the absorber, the second parent). */
  id: string;
  other?: string;
  text: string;
}

export interface History {
  snaps: Snapshot[];
  events: LineageEvent[];
  /** Last known, for reading changes: each culture's faith, tongue and biggest town; each tongue's kind. */
  last?: { faith: Record<string, string>; tongue: Record<string, string>; seat: Record<string, number>; kind: Record<string, string> };
}

export const MAX_SNAPS = 240;

const add = (m: Record<string, number>, k: string, n: number) => {
  if (k && n > 0) m[k] = (m[k] ?? 0) + n;
};

/** Every culture tick: a snapshot, and the lineage events since the last. */
export function historyTick(sim: SimState, env: Env, provAt: (x: number, y: number) => number): void {
  const h = (sim.history ??= { snaps: [], events: [] });
  const cultures: Record<string, number> = {};
  const languages: Record<string, number> = {};
  const races: Record<string, number> = {};
  const byProv = new Map<number, Record<string, number>>();
  const count = (pops: readonly Pop[] | undefined, p: number) => {
    let m = byProv.get(p);
    if (p >= 0 && !m) byProv.set(p, (m = {}));
    for (const q of pops ?? []) {
      add(cultures, q.culture, q.n);
      add(languages, q.language, q.n);
      add(races, q.race, q.n);
      if (m) add(m, q.culture, q.n);
    }
  };
  for (const st of sim.settlements) if (!st.ruined) count(st.pops, st.layer ? -1 : provAt(st.x, st.y));
  for (const t of sim.tribes) count(t.pops, provAt(t.x, t.y));
  const P = env.prov;
  const idx = new Map<number, number>();
  for (let p = 0; p < P.count; p++) idx.set(P.ids[p], p);
  for (const [k, ps] of Object.entries(sim.country ?? {})) count(ps, idx.get(Number(k)) ?? -1);
  const provs: Record<string, string> = {};
  for (const [p, m] of byProv) {
    const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    if (top) provs[String(P.ids[p])] = top[0];
  }
  const round = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)]));
  const snap: Snapshot = { day: sim.day, cultures: round(cultures), languages: round(languages), races: round(races), provs };
  const prev = h.snaps[h.snaps.length - 1];
  const ev = (track: Track, kind: LineageKind, id: string, text: string, other?: string) => h.events.push({ day: sim.day, track, kind, id, ...(other ? { other } : {}), text });
  const cuName = (id: string) => sim.cultures?.find((c) => c.id === id)?.name ?? id;
  const lgName = (id: string) => sim.languages?.find((l) => l.id === id)?.name ?? id;
  const last = h.last ?? { faith: {}, tongue: {}, seat: {}, kind: {} };

  // ---- Cultures.
  for (const cu of sim.cultures ?? []) {
    const now = snap.cultures[cu.id] ?? 0;
    const was = prev?.cultures[cu.id] ?? 0;
    const seen = !!prev && cu.id in (prev.cultures ?? {});
    const known = h.events.some((e) => e.track === 'culture' && e.id === cu.id);
    if (now > 0 && !known) {
      if (cu.blend?.length) ev('culture', 'hybrid', cu.id, `The ${cu.name} formed, a blend of the ${cu.blend.map(cuName).join(' and the ')}.`, cu.blend[0]);
      else if (cu.parent && prev) ev('culture', 'split', cu.id, `The ${cu.name} grew apart from the ${cuName(cu.parent)}.`, cu.parent);
      else ev('culture', 'appeared', cu.id, `The ${cu.name} ${prev ? 'appeared' : 'were there at the start'}.`);
    } else if (now > 0 && cu.ended !== undefined) {
      delete cu.ended;
      ev('culture', 'revived', cu.id, `The ${cu.name} lived again.`);
    }
    if (now <= 0 && (was > 0 || seen) && cu.ended === undefined) {
      cu.ended = sim.day;
      const seat = sim.settlements.find((s) => s.id === last.seat[cu.id] && !s.ruined && s.culture !== cu.id);
      if (seat) ev('culture', 'absorbed', cu.id, `The last of the ${cu.name} became ${cuName(seat.culture)}.`, seat.culture);
      else ev('culture', 'extinct', cu.id, `The ${cu.name} are no more.`);
    }
    if (now > 0) {
      if (cu.faith && last.faith[cu.id] && last.faith[cu.id] !== cu.faith) ev('culture', 'religion', cu.id, `Most of the ${cu.name} now keep the ${sim.faiths?.find((f) => f.id === cu.faith)?.name ?? 'a new faith'}.`);
      if (last.tongue[cu.id] && last.tongue[cu.id] !== cu.language) ev('culture', 'language', cu.id, `The ${cu.name} now speak ${lgName(cu.language)}.`);
      if (cu.faith) last.faith[cu.id] = cu.faith;
      last.tongue[cu.id] = cu.language;
      const big = sim.settlements.filter((s) => !s.ruined && s.culture === cu.id).sort((a, b) => b.pop - a.pop)[0];
      if (big) last.seat[cu.id] = big.id;
    }
  }

  // ---- Languages.
  for (const l of sim.languages ?? []) {
    const now = snap.languages[l.id] ?? 0;
    const known = h.events.some((e) => e.track === 'language' && e.id === l.id);
    if (now > 0 && !known) {
      if (l.parents && l.parents.length > 1) ev('language', 'hybrid', l.id, `${l.name} formed, a creole of ${l.parents.map(lgName).join(' and ')}.`, l.parents[0]);
      else if (l.parent && prev) ev('language', 'split', l.id, `${l.name} grew from ${lgName(l.parent)}${l.kind === 'dialect' ? ' (a dialect)' : ''}.`, l.parent);
      else ev('language', 'appeared', l.id, `${l.name} ${prev ? 'appeared' : 'was spoken at the start'}.`);
    }
    if (last.kind[l.id] === 'dialect' && l.kind === 'language') ev('language', 'promoted', l.id, `${l.name} became a language of its own.`);
    last.kind[l.id] = l.kind;
    if (l.ended !== undefined && !h.events.some((e) => e.track === 'language' && e.id === l.id && (e.kind === 'extinct' || e.kind === 'absorbed') && e.day >= l.ended!)) {
      if (known || (prev?.languages[l.id] ?? 0) > 0) ev('language', l.parent ? 'absorbed' : 'extinct', l.id, `No one speaks ${l.name} any more.`, l.parent || undefined);
    }
  }

  // ---- Races (lines only: a race appearing, or dying out).
  for (const [id, n] of Object.entries(snap.races)) if (n > 0 && !h.events.some((e) => e.track === 'race' && e.id === id)) ev('race', 'appeared', id, prev ? 'Appeared.' : 'There at the start.');
  for (const id of Object.keys(prev?.races ?? {})) if (!(snap.races[id] > 0) && !h.events.some((e) => e.track === 'race' && e.id === id && e.kind === 'extinct' && e.day > (prev?.day ?? 0) - 1)) ev('race', 'extinct', id, 'Died out.');

  h.last = last;
  h.snaps.push(snap);
  // Thin the old half when there are too many.
  if (h.snaps.length > MAX_SNAPS) {
    const half = Math.floor(h.snaps.length / 2);
    h.snaps = [...h.snaps.slice(0, half).filter((_, i) => i % 2 === 0), ...h.snaps.slice(half)];
  }
}

/** The snapshot nearest a day (for the map at that moment). */
export function snapshotAt(sim: SimState, day: number): Snapshot | undefined {
  const s = sim.history?.snaps ?? [];
  let best: Snapshot | undefined;
  for (const q of s) if (!best || Math.abs(q.day - day) < Math.abs(best.day - day)) best = q;
  return best;
}
