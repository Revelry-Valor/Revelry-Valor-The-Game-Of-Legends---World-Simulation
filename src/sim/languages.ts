import type { Env } from './env';
import { addPop, tidy, type Pop } from './pops';
import type { LiveCulture, LiveLanguage, Settlement, SimState } from './state';

/**
 * Languages (REDESIGN.md, "Cultures as peoples", step 5): a lineage of their own.
 *
 * Every tongue spoken is a language with its sounds (word beginnings and endings, for names) and
 * its parent. A region drifting from its culture's heartland (drift.ts) comes to speak a dialect
 * of the culture's tongue past 0.2 core distance, named for its main town ("Isish Toral"); when
 * the region splits off as a people of its own, its dialect becomes a language of its own, named
 * for the new people; two cultures blending make a creole with both tongues as parents. Each new
 * tongue's sounds drift a little from its parent's, so its place names do too. A tongue no one
 * speaks any more has ended (kept for the history).
 *
 * How near two tongues are: the same 1; a dialect and its language, or a language and the one it
 * grew from, 0.7; sisters 0.6; one family 0.35; otherwise none. Influence crosses a border of
 * tongues more easily between near ones, and cultures sharing near tongues are more alike.
 *
 * (Ids: a tongue from before languages were kept is known by its name, which is its id.)
 */

/** Core distance at which a region speaks a dialect of its own. */
export const DIALECT_AT = 0.2;

export const languagesOf = (sim: SimState): LiveLanguage[] => (sim.languages ??= []);
export const languageOf = (sim: SimState, id: string): LiveLanguage | undefined => sim.languages?.find((l) => l.id === id);
/** A tongue's name (an old one's id is its name). */
export const langName = (sim: SimState, id: string) => languageOf(sim, id)?.name ?? id;

/** A language's family: its root, through its parents. */
export function langRoot(sim: SimState, l: LiveLanguage): LiveLanguage {
  let r = l;
  for (let i = 0; i < 30; i++) {
    const up = r.parent ? languageOf(sim, r.parent) : undefined;
    if (!up) break;
    r = up;
  }
  return r;
}

/** How near two tongues are (0–1). */
export function relatedness(sim: SimState, a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = languageOf(sim, a);
  const B = languageOf(sim, b);
  if (!A || !B) return 0;
  if (A.parent === b || B.parent === a || A.parents?.includes(b) || B.parents?.includes(a)) return 0.7;
  if (A.parent && A.parent === B.parent) return 0.6;
  return langRoot(sim, A) === langRoot(sim, B) ? 0.35 : 0;
}

/** Influence crossing into a province of another tongue keeps this much: more between near tongues. */
export const barrier = (sim: SimState, a: string, b: string) => 0.6 + 0.4 * relatedness(sim, a, b);

/** Sounds drifted from a parent's: some word parts changed, a vowel shifted, a new part or two. */
export function driftSounds(sounds: string, rand: () => number, strength: number): string {
  const parts = sounds.split(/\s+/).filter(Boolean);
  const vowels = ['a', 'e', 'i', 'o', 'u', 'y', 'ae', 'ou'];
  const shift = (p: string) => p.replace(/[aeiouy]+/, () => vowels[Math.floor(rand() * vowels.length)]);
  const out = parts.map((p) => (rand() < strength ? shift(p) : p));
  const extra = Math.round(strength * 3);
  for (let i = 0; i < extra && parts.length; i++) {
    const p = parts[Math.floor(rand() * parts.length)];
    out.push(p.endsWith('-') ? `${shift(p.slice(0, -1))}r-` : p.startsWith('-') ? `-${shift(p.slice(1))}n` : shift(p));
  }
  return [...new Set(out)].join(' ');
}

/** Make sure every tongue a culture or a pop speaks is a known language (tongues from before languages were kept: by name). */
export function ensureLanguages(sim: SimState): void {
  const langs = languagesOf(sim);
  const known = new Set(langs.map((l) => l.id));
  const add = (id: string, cu?: LiveCulture) => {
    if (!id || known.has(id)) return;
    known.add(id);
    langs.push({ id, name: id, sounds: cu?.sounds ?? '', parent: '', kind: 'language', founded: cu?.founded ?? sim.day, culture: cu?.id });
  };
  // (A blend's tongue is made for it: a creole.)
  for (const cu of sim.cultures ?? []) if (!cu.blend?.length) add(cu.language || cu.name, cu);
  const seen = (pops: readonly Pop[] | undefined) => {
    for (const q of pops ?? []) add(q.language);
  };
  for (const st of sim.settlements) seen(st.pops);
  for (const t of sim.tribes) seen(t.pops);
  for (const ps of Object.values(sim.country ?? {})) seen(ps);
}

/** A new tongue grown from others. */
function newLanguage(sim: SimState, o: { name: string; sounds: string; parent?: string; parents?: string[]; kind: 'language' | 'dialect'; culture: string; region?: number[] }): LiveLanguage {
  const l: LiveLanguage = { id: `lang-${sim.nextId++}`, name: o.name, sounds: o.sounds, parent: o.parent ?? '', ...(o.parents ? { parents: o.parents } : {}), kind: o.kind, founded: sim.day, culture: o.culture, ...(o.region ? { region: o.region } : {}) };
  languagesOf(sim).push(l);
  return l;
}

export interface LanguageContext {
  sim: SimState;
  env: Env;
  provAt(x: number, y: number): number;
  rand(): number;
  log(text: string, x?: number, y?: number): void;
}

/** Change one tongue to another among some pops (of a culture, where given). */
function speak(pops: Pop[] | undefined, from: string | ((l: string) => boolean), to: string, culture?: string): Pop[] | undefined {
  if (!pops) return pops;
  const is = typeof from === 'string' ? (l: string) => l === from : from;
  const out: Pop[] = [];
  for (const q of pops) addPop(out, is(q.language) && (!culture || q.culture === culture) ? { ...q, language: to } : q);
  return tidy(out);
}

/** Every culture tick (after drift): dialects where regions drift, languages for new peoples, creoles for blends, the silent tongues ended. */
export function languagesTick(c: LanguageContext): void {
  const { sim, env } = c;
  ensureLanguages(sim);
  const P = env.prov;
  const cultures = sim.cultures ?? [];
  const byId = new Map(cultures.map((q) => [q.id, q]));
  const provIndex = new Map<number, number>();
  for (let p = 0; p < P.count; p++) provIndex.set(P.ids[p], p);
  const townsIn = (p: number, cu: string) => c.sim.settlements.filter((s) => !s.ruined && !s.layer && s.culture === cu && s.partOf === undefined && c.provAt(s.x, s.y) === p).sort((a, b) => b.pop - a.pop);
  const eachPopsIn = (p: number, f: (pops: Pop[] | undefined) => Pop[] | undefined) => {
    for (const st of sim.settlements) if (!st.ruined && !st.layer && c.provAt(st.x, st.y) === p) st.pops = f(st.pops);
    for (const t of sim.tribes) if (c.provAt(t.x, t.y) === p) t.pops = f(t.pops);
    const k = String(P.ids[p]);
    if (sim.country?.[k]) sim.country[k] = f(sim.country[k]) ?? sim.country[k];
  };

  // ---- New peoples: a subculture or blend still speaking another's tongue gets its own.
  for (const cu of cultures) {
    const own = languageOf(sim, cu.language);
    if (cu.blend?.length && (!own || own.culture !== cu.id || !own.parents)) {
      // A creole of its parents' tongues.
      const parents = cu.blend.map((id) => byId.get(id)?.language).filter((x): x is string => !!x);
      const sounds = parents.map((id) => languageOf(sim, id)?.sounds ?? '').join(' ');
      const cr = newLanguage(sim, { name: cu.name, sounds: driftSounds(sounds, c.rand, 0.3), parents, parent: parents[0], kind: 'language', culture: cu.id });
      cu.language = cr.id;
      for (let p = 0; p < P.count; p++) eachPopsIn(p, (pops) => speak(pops, (l) => parents.includes(l), cr.id, cu.id));
      continue;
    }
    if (cu.level === 'subculture' && cu.parent && (!own || own.culture !== cu.id)) {
      // Its dialect (the one most of its people speak, if a dialect) becomes a language of its own; else one grows from its parent's tongue.
      const spoken = new Map<string, number>();
      const count = (pops: readonly Pop[] | undefined) => {
        for (const q of pops ?? []) if (q.culture === cu.id) spoken.set(q.language, (spoken.get(q.language) ?? 0) + q.n);
      };
      for (const st of sim.settlements) count(st.pops);
      for (const t of sim.tribes) count(t.pops);
      for (const ps of Object.values(sim.country ?? {})) count(ps);
      const main = [...spoken].sort((a, b) => b[1] - a[1])[0]?.[0] ?? cu.language;
      const d = languageOf(sim, main);
      let lang: LiveLanguage;
      if (d?.kind === 'dialect') {
        lang = d;
        const was = d.name;
        Object.assign(d, { kind: 'language', name: cu.name, culture: cu.id, sounds: driftSounds(d.sounds, c.rand, 0.25) });
        delete d.region;
        const at = sim.settlements.find((s) => !s.ruined && s.culture === cu.id);
        c.log(`${was}, the speech of the ${cu.name}, has grown into a language of its own: ${cu.name}.`, at?.x, at?.y);
      } else {
        const base = d ?? own;
        lang = newLanguage(sim, { name: cu.name, sounds: driftSounds(base?.sounds ?? cu.sounds, c.rand, 0.3), parent: base?.id ?? '', kind: 'language', culture: cu.id });
        for (let p = 0; p < P.count; p++) eachPopsIn(p, (pops) => speak(pops, main, lang.id, cu.id));
      }
      cu.language = lang.id;
      cu.sounds = lang.sounds;
    }
  }

  // ---- Dialects: a region of a culture past DIALECT_AT speaks its own form of the culture's tongue.
  for (const [k, d] of Object.entries(sim.coreDist ?? {})) {
    if (d < DIALECT_AT) continue;
    const bar = k.lastIndexOf('|');
    const cuId = k.slice(0, bar);
    const p = provIndex.get(Number(k.slice(bar + 1)));
    const cu = byId.get(cuId);
    if (p === undefined || !cu) continue;
    const base = languageOf(sim, cu.language);
    if (!base) continue;
    // A dialect of it already spoken here or next door, by this culture; else a new one.
    const pid = P.ids[p];
    const nbIds = new Set<number>([pid]);
    for (let i = P.nbStart[p]; i < P.nbStart[p + 1]; i++) nbIds.add(P.ids[P.nb[i]]);
    let dia = languagesOf(sim).find((l) => l.kind === 'dialect' && l.parent === base.id && l.culture === cu.id && !l.ended && l.region?.some((r) => nbIds.has(r)));
    if (!dia) {
      // Named for its main town there, else the nearest settlement within 200 km.
      const town = townsIn(p, cu.id)[0] ?? sim.settlements.filter((q) => !q.ruined && !q.layer && Math.hypot(q.x - P.x[p], q.y - P.y[p]) < 200).sort((a, b) => Math.hypot(a.x - P.x[p], a.y - P.y[p]) - Math.hypot(b.x - P.x[p], b.y - P.y[p]))[0];
      const name = `${town ? town.name : 'Far'} ${base.name}`;
      dia = newLanguage(sim, { name, sounds: driftSounds(base.sounds, c.rand, 0.15), parent: base.id, kind: 'dialect', culture: cu.id, region: [pid] });
      c.log(`The ${cu.name} round ${town ? town.name : 'their far country'} have come to speak a dialect of their own: ${name}.`, town?.x ?? P.x[p], town?.y ?? P.y[p]);
    } else if (!dia.region!.includes(pid)) dia.region!.push(pid);
    eachPopsIn(p, (pops) => speak(pops, base.id, dia!.id, cu.id));
  }

  // ---- Tongues no one speaks any more have ended.
  const spoken = new Set<string>();
  const mark = (pops: readonly Pop[] | undefined) => {
    for (const q of pops ?? []) if (q.n >= 0.5) spoken.add(q.language);
  };
  for (const st of sim.settlements) if (!st.ruined) mark(st.pops);
  for (const t of sim.tribes) mark(t.pops);
  for (const ps of Object.values(sim.country ?? {})) mark(ps);
  for (const cu of cultures) if (sim.settlements.some((s) => !s.ruined && s.culture === cu.id) || sim.tribes.some((t) => t.culture === cu.id)) spoken.add(cu.language);
  for (const l of languagesOf(sim)) {
    if (spoken.has(l.id)) delete l.ended;
    else if (l.ended === undefined) l.ended = sim.day;
  }
}

/** The sounds names are made from for a culture: its tongue's, else its own. */
export function soundsFor(sim: SimState, cu: LiveCulture | undefined): string {
  if (!cu) return '';
  return languageOf(sim, cu.language)?.sounds || cu.sounds;
}

/** Speakers of each living tongue (people). */
export function speakers(sim: SimState): Map<string, number> {
  const out = new Map<string, number>();
  const add = (pops: readonly Pop[] | undefined) => {
    for (const q of pops ?? []) out.set(q.language, (out.get(q.language) ?? 0) + q.n);
  };
  for (const st of sim.settlements) if (!st.ruined) add(st.pops);
  for (const t of sim.tribes) add(t.pops);
  for (const ps of Object.values(sim.country ?? {})) add(ps);
  return out;
}

/** A settlement's speech, for its card: its people's main tongue and what it is ("Isish Toral, a dialect of Toral"). */
export function speechOf(sim: SimState, st: Settlement): string {
  const by = new Map<string, number>();
  for (const q of st.pops ?? []) by.set(q.language, (by.get(q.language) ?? 0) + q.n);
  const main = [...by].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!main) return '';
  const l = languageOf(sim, main);
  if (!l) return main;
  const up = l.parent ? languageOf(sim, l.parent) : undefined;
  return l.kind === 'dialect' && up ? `${l.name}, a dialect of ${up.name}` : up ? `${l.name} (grown from ${up.name})` : l.name;
}
