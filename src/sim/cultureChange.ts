import type { Library } from '../core/library';
import { cultureFx, cultureOf, MAX_TRADITIONS } from './culture';
import type { LiveCulture, Settlement, SimState, Tribe } from './state';

/**
 * How cultures change one another (REDESIGN.md 8.4e, Phase 8 step 3).
 *
 * - Acceptance between two cultures grows with contact, trade and shared heritage and shrinks with
 *   fights, raids and grudges; it eases or sharpens how readily they fight, trade and learn from
 *   each other.
 * - Big settlement pull: a small settlement beside a big one of another culture is drawn into the
 *   big one's culture, unless the small ones round it are together stronger, when the big one is
 *   drawn toward theirs; faster where acceptance is high.
 * - Divergence: a clan living far from its culture's heartland for generations, with no ties back,
 *   grows a culture of its own (a single city can).
 * - Hybrids: two cultures living side by side with high acceptance for decades blend into a new
 *   one where they mix.
 * Rulers enforcing their culture, and a nation's main culture pulling the rest, come with nations.
 */

export interface ChangeContext {
  sim: SimState;
  lib: Library;
  rand: () => number;
  dist: (ax: number, ay: number, bx: number, by: number) => number;
  log: (text: string, x?: number, y?: number) => void;
}

const COLOURS = ['#b5651d', '#5b8c5a', '#7a5195', '#d4a017', '#2a7f9e', '#c0504d', '#8e7cc3', '#3d9970', '#e07b39', '#4a6fa5', '#a64d79', '#6aa84f', '#cc7a00', '#45818e', '#b45f06', '#674ea7'];
/** A culture's colour on the map (given the first time it is asked for). */
export function cultureColour(sim: SimState, cu: LiveCulture): string {
  if (!cu.colour) cu.colour = COLOURS[(sim.cultures ?? []).indexOf(cu) % COLOURS.length];
  return cu.colour;
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function relation(sim: SimState, a: string, b: string) {
  const rel = (sim.relations ??= {});
  const k = key(a, b);
  if (!rel[k]) rel[k] = { acc: baseAcceptance(sim, a, b), fights: 0, trades: 0, together: 0 };
  return rel[k];
}
/** Shared heritage eases acceptance: the same race, the same species, a parent culture. */
function baseAcceptance(sim: SimState, a: string, b: string): number {
  const A = cultureOf(sim, a);
  const B = cultureOf(sim, b);
  if (!A || !B) return 0;
  if (A.parent === B.id || B.parent === A.id || A.blend?.includes(B.id) || B.blend?.includes(A.id)) return 0.45;
  if (A.races.some((r) => B.races.includes(r))) return 0.3;
  if (A.species.some((s) => B.species.includes(s))) return 0.15;
  return 0;
}
/** Acceptance between two cultures (−1 hostile … 1 close); a culture fully accepts itself. */
export function acceptance(sim: SimState, a: string, b: string): number {
  if (!a || !b || a === b) return 1;
  return sim.relations?.[key(a, b)]?.acc ?? baseAcceptance(sim, a, b);
}
/** Count a fight or a trade between two cultures toward how they come to see each other. */
export function noteBetween(sim: SimState, a: string, b: string, what: 'fights' | 'trades'): void {
  if (!a || !b || a === b) return;
  relation(sim, a, b)[what]++;
}
export const acceptanceWord = (v: number) => (v >= 0.6 ? 'close' : v >= 0.25 ? 'friendly' : v > -0.15 ? 'neutral' : v > -0.5 ? 'wary' : 'hostile');

type Member = Settlement | Tribe;
const membersOf = (sim: SimState, id: string): Member[] => [...sim.settlements.filter((s) => !s.ruined && s.culture === id), ...sim.tribes.filter((t) => t.culture === id)];

/** A new culture grown from (or blended of) others: their ways, a new name in their sounds. */
function offshoot(c: ChangeContext, from: LiveCulture[], idHint: string): LiveCulture {
  const { sim, rand } = c;
  const sounds = from.map((f) => f.sounds).join(' ').split(/\s+/).filter(Boolean);
  const pre = sounds.filter((p) => p.endsWith('-')).map((p) => p.slice(0, -1));
  const suf = sounds.filter((p) => p.startsWith('-')).map((p) => p.slice(1));
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  let name = pre.length && suf.length ? pick(pre) + pick(suf) : from[0].name + 'i';
  for (let i = 0; i < 6 && (sim.cultures ?? []).some((q) => q.name.toLowerCase() === name.toLowerCase()); i++) name = (pre.length ? pick(pre) : from[0].name) + (suf.length ? pick(suf) : 'an');
  name = name.charAt(0).toUpperCase() + name.slice(1);
  // Traditions: the strongest of theirs, up to six (locked ones are kept but may now change).
  const trads = new Map<string, { id: string; level: number; hold: string; progress: number }>();
  for (const f of from) for (const t of f.traditions) if (t.level >= 0) {
    const old = trads.get(t.id);
    if (!old || old.level < t.level) trads.set(t.id, { id: t.id, level: t.level, hold: t.hold === 'Locked' ? 'Encouraged' : t.hold, progress: 0 });
  }
  const traditions = [...trads.values()].sort((a, b) => b.level - a.level).slice(0, MAX_TRADITIONS);
  const big = from[0];
  const cu: LiveCulture = {
    id: `${idHint}-${sim.nextId++}`,
    name,
    source: '',
    species: [...new Set(from.flatMap((f) => f.species))],
    races: [...new Set(from.flatMap((f) => f.races))],
    language: from.length > 1 ? `${from.map((f) => f.language || f.name).join('-')} blend` : `${big.language || big.name} (its own way)`,
    sounds: [...new Set(sounds)].sort(() => rand() - 0.5).slice(0, 14).join(' '),
    ethos: from.length > 1 && rand() < 0.5 ? from[1].ethos : big.ethos,
    martial: big.martial,
    lifestyles: [...new Set(from.flatMap((f) => f.lifestyles))],
    traditions,
    specialties: from.flatMap((f) => f.specialties.map((s) => ({ ...s }))).slice(0, 4),
    behaviours: [...new Set(from.flatMap((f) => f.behaviours))],
    founded: sim.day,
    parent: from.length === 1 ? big.id : '',
    ...(from.length > 1 ? { blend: from.map((f) => f.id) } : {}),
    stats: { fights: 0, raids: 0, foreignTrade: 0, famines: 0, lastFight: -1e9 },
  };
  (sim.cultures ??= []).push(cu);
  // Kin cultures start close.
  for (const f of from) relation(sim, cu.id, f.id).acc = 0.5;
  return cu;
}

/** The year's changes between cultures. */
export function cultureChangeYear(c: ChangeContext): void {
  const { sim } = c;
  const cultures = (sim.cultures ?? []).filter((cu) => membersOf(sim, cu.id).length);
  const members = new Map(cultures.map((cu) => [cu.id, membersOf(sim, cu.id)]));
  const near = (a: string, b: string, km: number) => (members.get(a) ?? []).some((p) => (members.get(b) ?? []).some((q) => c.dist(p.x, p.y, q.x, q.y) < km));

  // ---- Acceptance.
  for (let i = 0; i < cultures.length; i++) for (let j = i + 1; j < cultures.length; j++) {
    const A = cultures[i];
    const B = cultures[j];
    const contact = near(A.id, B.id, 400);
    const rel = relation(sim, A.id, B.id);
    if (!contact && !rel.fights && !rel.trades) {
      rel.together = Math.max(0, rel.together - 1);
      continue;
    }
    const grudge = sim.grudges.some((g) => (A.races.includes(g.race) && B.races.includes(g.against)) || (B.races.includes(g.race) && A.races.includes(g.against)));
    const target = Math.max(-1, Math.min(1, baseAcceptance(sim, A.id, B.id) + (contact ? 0.15 : 0) + Math.min(0.5, rel.trades * 0.06) - Math.min(1.2, rel.fights * 0.2) - (grudge ? 0.5 : 0)));
    // Xenophobes warm slowly and the hospitable quickly (their readiness to deal with others).
    const warmth = Math.max(0.2, Math.min(2, (2 - cultureFx(sim, A.id).otherRace) * (2 - cultureFx(sim, B.id).otherRace)));
    const rate = target > rel.acc ? 0.08 * warmth : 0.25;
    rel.acc += (target - rel.acc) * Math.min(1, rate);
    rel.together = near(A.id, B.id, 150) ? rel.together + 1 : Math.max(0, rel.together - 1);
    rel.fights = 0;
    rel.trades = 0;
  }

  // ---- Big settlement pull.
  const live = sim.settlements.filter((s) => !s.ruined);
  for (const small of live) {
    const big = live.filter((b) => b !== small && b.culture !== small.culture && b.pop > small.pop * 3 && c.dist(b.x, b.y, small.x, small.y) < 120).sort((a, b) => b.pop - a.pop)[0];
    if (!big) {
      if (small.cultureShift) small.cultureShift.progress = Math.max(0, small.cultureShift.progress - 0.05);
      if (small.cultureShift && small.cultureShift.progress <= 0) delete small.cultureShift;
      continue;
    }
    // The small ones round the big one, of the small one's culture: together, are they the stronger?
    const ours = live.filter((s) => s.culture === small.culture && c.dist(s.x, s.y, big.x, big.y) < 120).reduce((n, s) => n + s.pop, 0);
    const theirs = live.filter((s) => s.culture === big.culture && c.dist(s.x, s.y, big.x, big.y) < 120).reduce((n, s) => n + s.pop, 0);
    const acc = acceptance(sim, small.culture, big.culture);
    const pace = 0.04 * (0.5 + Math.max(0, acc));
    const [who, to] = ours > theirs ? [big, small.culture] : [small, big.culture];
    if (!who.cultureShift || who.cultureShift.to !== to) who.cultureShift = { to, progress: 0 };
    who.cultureShift.progress += pace;
    if (who.cultureShift.progress >= 1) {
      const from = cultureOf(sim, who.culture)?.name ?? '?';
      who.culture = to;
      delete who.cultureShift;
      c.log(`${who.name} has taken on the ways of the ${cultureOf(sim, to)?.name ?? '?'} (once ${from}).`, who.x, who.y);
    }
  }

  // ---- A clan's culture follows most of its people.
  for (const clan of sim.clans) {
    const counts = new Map<string, number>();
    for (const m of [...sim.tribes.filter((t) => t.clan === clan.id), ...live.filter((s) => s.clan === clan.id)]) counts.set(m.culture, (counts.get(m.culture) ?? 0) + m.pop);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] && top[0] !== clan.culture) clan.culture = top[0];
  }

  // ---- Divergence: clans far from their culture's heartland, with no ties back.
  for (const cu of cultures) {
    const ms = members.get(cu.id) ?? [];
    if (ms.length < 2) continue;
    // The heartland: its biggest settlement, or where most of its people roam.
    const heart = [...ms].sort((a, b) => b.pop - a.pop)[0];
    const byClan = new Map<number, Member[]>();
    for (const m of ms) byClan.set(m.clan, [...(byClan.get(m.clan) ?? []), m]);
    for (const [clanId, list] of byClan) {
      const clan = sim.clans.find((q) => q.id === clanId);
      if (!clan || list.includes(heart)) continue;
      const pop = list.reduce((n, m) => n + m.pop, 0);
      const cx = list.reduce((n, m) => n + m.x * m.pop, 0) / pop;
      const cy = list.reduce((n, m) => n + m.y * m.pop, 0) / pop;
      const far = c.dist(cx, cy, heart.x, heart.y) > 500;
      const ties = sim.routes.some((r) => {
        const a = live.find((s) => s.id === r.a);
        const b = live.find((s) => s.id === r.b);
        return !!a && !!b && ((a.clan === clanId && b.culture === cu.id && b.clan !== clanId) || (b.clan === clanId && a.culture === cu.id && a.clan !== clanId));
      });
      clan.drift = far && !ties ? (clan.drift ?? 0) + 1 : Math.max(0, (clan.drift ?? 0) - 2);
      // Sixty years apart, from a culture old enough to have a heartland.
      if ((clan.drift ?? 0) < 60 || pop < 150 || sim.day - cu.founded < 360 * 60) continue;
      const nc = offshoot(c, [cu], 'drift');
      for (const m of list) m.culture = nc.id;
      clan.culture = nc.id;
      clan.drift = 0;
      c.log(`Far from their heartland, clan ${clan.name} of the ${cu.name} have grown into a people of their own: the ${nc.name}.`, cx, cy);
    }
  }

  // ---- Hybrids: two cultures long side by side, close to each other, blend where they mix.
  for (let i = 0; i < cultures.length; i++) for (let j = i + 1; j < cultures.length; j++) {
    const A = cultures[i];
    const B = cultures[j];
    const rel = sim.relations?.[key(A.id, B.id)];
    if (!rel || rel.acc < 0.6 || rel.together < 40) continue;
    const mA = members.get(A.id) ?? [];
    const mB = members.get(B.id) ?? [];
    const mixed = [...mA.filter((p) => mB.some((q) => c.dist(p.x, p.y, q.x, q.y) < 150)), ...mB.filter((p) => mA.some((q) => c.dist(p.x, p.y, q.x, q.y) < 150))];
    if (mixed.length < 2) continue;
    const popA = mA.reduce((n, m) => n + m.pop, 0);
    const popB = mB.reduce((n, m) => n + m.pop, 0);
    const hy = offshoot(c, popA >= popB ? [A, B] : [B, A], 'blend');
    for (const m of mixed) m.culture = hy.id;
    rel.together = 0;
    const at = mixed[0];
    c.log(`The ${A.name} and the ${B.name}, long living side by side, have blended into one people: the ${hy.name}.`, at.x, at.y);
  }
}

