import { fight, total, type Ground, type Side } from './battle';
import { PK } from './land';
import { riftKind, type Rift } from './rifts';
import type { Hero, Settlement, SimState, Units } from './state';
import { WALL_MIGHT, wallLevel, type WarContext } from './wars';

/**
 * When rifts go wrong (REDESIGN.md 6A; Phase 11 step 3).
 *
 * 1. **Rift break.** Once a year a rift at full strength tests what holds it: an encampment or
 *    soldiers fight what spills out (win, and the rift is pushed back); with no defences, or if
 *    they fall, the rift breaks.
 * 2. **Monster tide.** From a broken rift monsters pour out month by month and spread slowly,
 *    province by province, besieging and overrunning the towns they reach. Realms whose land
 *    it covers fight back; beaten down far enough, the tide ebbs and the rift sinks back.
 * 3. **Monster hordes.** After a year and a half, alphas come through: a horde led by one charges
 *    out toward the nearest towns and destroys those it beats, until it is beaten itself.
 *
 * Monsters fight with the phased battles (battle.ts): the lesser spawn as foot, the brutes as
 * specialists, an alpha as a hero.
 */

export interface MonsterKind {
  spawn: string;
  brute: string;
  alpha: string;
  /** How strong each monster is (an ordinary human fighter is 1), and how far a horde goes in a day (km). */
  might: number;
  speed: number;
  flies?: boolean;
}

/** The monsters behind each kind of rift. */
export const MONSTERS: Record<string, MonsterKind> = {
  ember: { spawn: 'Cinderlings', brute: 'Magma brutes', alpha: 'Ember wyrm', might: 1.2, speed: 22 },
  crystal: { spawn: 'Shardlings', brute: 'Prism golems', alpha: 'Crystal tyrant', might: 1.1, speed: 18 },
  verdant: { spawn: 'Thorn spawn', brute: 'Bramble hulks', alpha: 'Elder blightwood', might: 1, speed: 16 },
  deep: { spawn: 'Gloom crawlers', brute: 'Void brutes', alpha: 'Abyssal maw', might: 1.3, speed: 20 },
  tide: { spawn: 'Brine wretches', brute: 'Reef horrors', alpha: 'Leviathan spawn', might: 1.1, speed: 18 },
};
export const monstersOf = (kind: string) => MONSTERS[kind] ?? MONSTERS.ember;

export interface Tide {
  id: number;
  rift: number;
  kind: string;
  name: string;
  /** Where it broke out (km). */
  x: number;
  y: number;
  /** The provinces it covers (by id). */
  provinces: number[];
  /** How many monsters it holds. */
  strength: number;
  started: number;
  /** When the next horde comes through. */
  nextHorde: number;
}

export interface Horde {
  id: number;
  tide: number;
  kind: string;
  name: string;
  alpha: string;
  x: number;
  y: number;
  strength: number;
  /** The settlement it is marching on (−1: looking). */
  target: number;
  /** Settlements it has destroyed. */
  razed: string[];
}

/** A tide with fewer monsters than this has ebbed away. */
const TIDE_ENDS = 40;

const live = (sim: SimState) => sim.settlements.filter((s) => !s.ruined);
const cellAt = (c: WarContext, x: number, y: number) => c.cellAt(x, y);

/** The ground at a place, for a battle. */
function groundAt(c: WarContext, x: number, y: number, name: string): Ground {
  const k = cellAt(c, x, y);
  const cover = k >= 0 ? c.env.cover[k] : -1;
  return { name, hills: k >= 0 ? Math.min(3, c.env.mzone[k]) : 0, river: k >= 0 && !!c.env.fresh[k], forest: cover === 0 || cover === 1, marsh: cover === 4 };
}

/** The monsters' side: lesser spawn as foot, brutes as specialists, an alpha as a hero. */
function monsterSide(kind: string, strength: number, alpha?: string): Side {
  const m = monstersOf(kind);
  const heroes: Hero[] = alpha ? [{ name: alpha, kind: 'champion', power: 4, born: 0, deeds: 0, female: false }] : [];
  return {
    label: alpha ? `the horde of ${alpha}` : `the ${m.spawn.toLowerCase()}`,
    units: { foot: strength * 0.72, archers: 0, riders: 0, specialists: strength * 0.28 },
    heroes,
    morale: 1.1,
    might: m.might,
    arms: 1,
    ranged: 0,
    defending: false,
    walls: 1,
    mountain: false,
    flies: !!m.flies,
    specialistName: m.brute.toLowerCase(),
  };
}

/** A town's side: its warband (a fifth of it archers), behind its walls. */
function townSide(c: WarContext, st: Settlement, defending: boolean): Side {
  const capital = c.sim.clans.find((q) => q.id === st.clan)?.realm?.capital === st.id;
  const walls = WALL_MIGHT[wallLevel(c.lib, st, capital)] ?? 1;
  const n = Math.max(0, st.warband);
  return {
    label: st.name,
    units: { foot: n * 0.8, archers: n * 0.2, riders: 0, specialists: 0 },
    heroes: [],
    morale: 1,
    might: c.might(st.race, st.culture),
    arms: 1,
    ranged: 1,
    defending,
    walls: defending ? walls : 1,
    mountain: false,
    flies: false,
    specialistName: 'specialists',
  };
}

/** Losses on a side, all kinds together. */
const lostOf = (u: Units) => total(u);

/** Each month: rifts at full strength tested, tides grow, spread and besiege, realms strike back, hordes come through. */
export function monstersMonth(c: WarContext & { name: () => string }): void {
  const { sim } = c;
  sim.tides ??= [];
  sim.hordes ??= [];
  for (const r of sim.rifts ?? []) riftBreak(c, r);
  for (const t of [...sim.tides]) tideMonth(c, t);
}

/** A rift at full strength, once a year: its defences hold it, or it breaks. */
function riftBreak(c: WarContext & { name: () => string }, r: Rift): void {
  const { sim } = c;
  if (r.strength < 1 || sim.tides!.some((t) => t.rift === r.id)) return;
  if (r.lastStand !== undefined && sim.day - r.lastStand < 360) return;
  r.lastStand = sim.day;
  const wave = 120 + 200 * (r.permanent ? 1 : 0.6);
  const towns = live(sim).filter((s) => s.clan === r.holder).sort((a, b) => c.dist(a.x, a.y, r.x, r.y) - c.dist(b.x, b.y, r.x, r.y));
  const near = towns[0];
  if ((r.hold === 'encampment' || r.hold === 'soldiers') && near) {
    // The defenders: from the nearest town (an encampment), or from the realm's towns round it (soldiers).
    const share = r.hold === 'soldiers' ? 0.35 : 0.3;
    const from = r.hold === 'soldiers' ? towns.filter((s) => c.dist(s.x, s.y, r.x, r.y) < 400) : [near];
    const men = from.reduce((n, s) => n + Math.max(0, s.warband) * share, 0);
    const def = townSide(c, near, true);
    def.label = `the ${r.hold === 'soldiers' ? 'soldiers' : 'encampment'} at the ${r.name}`;
    def.units = { foot: men * 0.8, archers: men * 0.2, riders: 0, specialists: 0 };
    def.walls = 1.2;
    const res = fight(c.rand, groundAt(c, r.x, r.y, 'at the rift'), monsterSide(r.kind, wave), def);
    const lost = lostOf(res.lost[1]);
    for (const s of from) s.warband = Math.max(0, s.warband - (lost * Math.max(0, s.warband) * share) / Math.max(1, men));
    if (res.winner === 1) {
      r.strength = 0.75;
      c.log(`The ${r.name} broke open, but ${def.label} held it: ${Math.round(lostOf(res.lost[0]))} monsters and ${Math.round(lost)} defenders fell, and the rift sank back.`, r.x, r.y);
      return;
    }
    c.log(`The ${r.name} broke and its defences fell (${Math.round(lost)} defenders lost): a monster tide pours out.`, r.x, r.y);
  } else c.log(`The ${r.name} broke with nothing to hold it: a monster tide pours out.`, r.x, r.y);
  startTide(c, r, wave);
}

function startTide(c: WarContext & { name: () => string }, r: Rift, strength: number): void {
  const { sim, env } = c;
  const k = cellAt(c, r.x, r.y);
  const p = k >= 0 ? env.prov.of[k] : -1;
  const m = monstersOf(r.kind);
  sim.tides!.push({ id: sim.nextId++, rift: r.id, kind: r.kind, name: `${m.spawn} of the ${r.name}`, x: r.x, y: r.y, provinces: p >= 0 ? [env.prov.ids[p]] : [], strength, started: sim.day, nextHorde: sim.day + 540 });
}

function tideMonth(c: WarContext & { name: () => string }, t: Tide): void {
  const { sim, env } = c;
  const P = env.prov;
  const index = new Map<number, number>();
  for (let p = 0; p < P.count; p++) index.set(P.ids[p], p);
  const here = t.provinces.map((id) => index.get(id) ?? -1).filter((p) => p >= 0);
  const rift = (sim.rifts ?? []).find((r) => r.id === t.rift);
  // More pour out while the rift is still strong; breaking spends it, so in time it stops (and
  // regrows toward its next break). Monsters dwindle on their own, faster once nothing feeds them.
  const fed = !!rift && rift.strength >= 0.7;
  if (rift) rift.strength = Math.max(0.3, rift.strength - 0.015);
  if (fed) t.strength += 45 * (rift!.permanent ? 1 : 0.6);
  t.strength *= fed ? 0.99 : 0.96;
  // As it shrinks it draws back out of the provinces it held.
  while (here.length > 1 && t.strength < 60 * here.length) {
    t.provinces.pop();
    here.pop();
  }
  t.strength = Math.min(t.strength, 600 + 500 * Math.sqrt(Math.max(1, here.length)));
  // It spreads slowly, province by province (over land, never water or the high peaks).
  if (c.rand() < 0.3 && t.strength > 150 * here.length) {
    const edge: number[] = [];
    for (const p of here) for (let q = P.nbStart[p]; q < P.nbStart[p + 1]; q++) {
      const m = P.nb[q];
      if (P.kind[m] === PK.land && !here.includes(m) && !edge.includes(m)) edge.push(m);
    }
    if (edge.length) {
      // Drawn toward people: most often the way to the nearest town.
      const towns = live(sim);
      const nearTown = (p: number) => towns.reduce((b, st) => Math.min(b, c.dist(st.x, st.y, P.x[p], P.y[p])), Infinity);
      const m = towns.length && c.rand() < 0.7 ? edge.reduce((a, b) => (nearTown(b) < nearTown(a) ? b : a)) : edge[Math.floor(c.rand() * edge.length)];
      t.provinces.push(P.ids[m]);
      here.push(m);
    }
  }
  const inTide = (x: number, y: number) => {
    const k = cellAt(c, x, y);
    return k >= 0 && here.includes(P.of[k]);
  };
  // Towns it covers are besieged: each month the monsters throw themselves at the walls.
  for (const st of live(sim)) {
    if (!inTide(st.x, st.y)) continue;
    const share = t.strength / Math.max(1, here.length);
    const res = fight(c.rand, groundAt(c, st.x, st.y, `at the walls of ${st.name}`), monsterSide(t.kind, share * 0.6), townSide(c, st, true));
    const lostM = lostOf(res.lost[0]);
    const lostT = lostOf(res.lost[1]);
    t.strength = Math.max(0, t.strength - lostM);
    st.warband = Math.max(0, st.warband - lostT);
    st.pop = Math.max(0, st.pop - lostT - (res.winner === 0 ? st.pop * 0.05 : 0));
    st.hardship = { famine: st.hardship?.famine ?? 0, war: (st.hardship?.war ?? 0) + 1 };
    if (res.winner === 0 && (st.warband < 5 || st.pop < 40)) overrun(c, st, t.name);
  }
  // Realms whose land it covers strike back, every few months: half the warbands of their towns near it.
  if (sim.day % 90 < 30) {
    const holders = new Set<number>();
    for (const p of here) if (sim.provOwner && sim.provOwner[p] >= 0) holders.add(sim.provOwner[p]);
    for (const h of holders) {
      const towns = live(sim).filter((s) => s.clan === h && c.dist(s.x, s.y, t.x, t.y) < 500 && !inTide(s.x, s.y));
      const men = towns.reduce((n, s) => n + Math.max(0, s.warband) * 0.5, 0);
      if (men < 30 || t.strength <= 0) continue;
      const lead = towns.sort((a, b) => b.warband - a.warband)[0];
      const side = townSide(c, lead, false);
      side.label = `the warriors of ${sim.clans.find((q) => q.id === h)?.name ?? lead.name}`;
      side.units = { foot: men * 0.8, archers: men * 0.2, riders: 0, specialists: 0 };
      const res = fight(c.rand, groundAt(c, t.x, t.y, 'against the tide'), monsterSide(t.kind, Math.min(t.strength, men * 1.5)), side);
      t.strength = Math.max(0, t.strength - lostOf(res.lost[0]));
      const lost = lostOf(res.lost[1]);
      for (const s of towns) s.warband = Math.max(0, s.warband - (lost * Math.max(0, s.warband) * 0.5) / Math.max(1, men));
      if (res.winner === 1 && here.length > 1) t.provinces.pop();
    }
  }
  // Hordes: after a year and a half, alphas come through, every two years while it lasts.
  if (sim.day >= t.nextHorde && t.strength > 300) {
    t.nextHorde = sim.day + 720;
    const m = monstersOf(t.kind);
    const strength = t.strength * 0.35;
    t.strength -= strength;
    const alpha = `${c.name()} the ${m.alpha}`;
    sim.hordes!.push({ id: sim.nextId++, tide: t.id, kind: t.kind, name: `the horde of ${alpha}`, alpha, x: t.x, y: t.y, strength, target: -1, razed: [] });
    c.log(`An alpha came through the ${rift?.name ?? 'broken rift'}: ${alpha} leads a horde of ${Math.round(strength)} out of the tide.`, t.x, t.y);
  }
  // Beaten down far enough, it ebbs, and the rift sinks back.
  if (t.strength < TIDE_ENDS) {
    sim.tides = sim.tides!.filter((q) => q !== t);
    if (rift) {
      rift.strength = 0.5;
      rift.lastStand = sim.day;
    }
    c.log(`The ${t.name} ebbed away: the land is free of them${rift ? `, and the ${rift.name} sank back` : ''}.`, t.x, t.y);
  }
}

/** A town overrun by monsters: left in ruins. */
function overrun(c: WarContext, st: Settlement, by: string): void {
  st.ruined = true;
  st.ruinedOn = c.sim.day;
  st.pop = 0;
  st.warband = 0;
  delete st.besieged;
  delete st.occupied;
  c.log(`${st.name} was overrun by the ${by} and left in ruins.`, st.x, st.y);
}

/** Each day: hordes march on the nearest town, fight it, and destroy it if they win. */
export function hordesDay(c: WarContext): void {
  const { sim } = c;
  for (const h of [...(sim.hordes ?? [])]) {
    let target = live(sim).find((s) => s.id === h.target);
    if (!target) {
      target = live(sim).filter((s) => c.dist(s.x, s.y, h.x, h.y) < 700).sort((a, b) => c.dist(a.x, a.y, h.x, h.y) - c.dist(b.x, b.y, h.x, h.y))[0];
      h.target = target?.id ?? -1;
    }
    if (!target) {
      // Nothing left in reach: it goes back into the tide (or melts away).
      sim.hordes = sim.hordes!.filter((q) => q !== h);
      const tide = sim.tides?.find((t) => t.id === h.tide);
      if (tide) tide.strength += h.strength;
      c.log(`${cap(h.name)} found nothing more in reach and went back.`, h.x, h.y);
      continue;
    }
    const step = monstersOf(h.kind).speed;
    let dx = target.x - h.x;
    if (c.env.wrapKm && Math.abs(dx) > c.env.wrapKm / 2) dx -= Math.sign(dx) * c.env.wrapKm;
    const dy = target.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d > step) {
      h.x += (dx * step) / d;
      h.y += (dy * step) / d;
      if (c.env.wrapKm) h.x = ((h.x % c.env.wrapKm) + c.env.wrapKm) % c.env.wrapKm;
      continue;
    }
    h.x = target.x;
    h.y = target.y;
    const res = fight(c.rand, groundAt(c, target.x, target.y, `at the walls of ${target.name}`), monsterSide(h.kind, h.strength, h.alpha), townSide(c, target, true));
    const lostM = lostOf(res.lost[0]);
    const lostT = lostOf(res.lost[1]);
    h.strength = Math.max(0, h.strength - lostM);
    target.warband = Math.max(0, target.warband - lostT);
    target.pop = Math.max(0, target.pop - lostT);
    if (res.winner === 0) {
      h.razed.push(target.name);
      overrun(c, target, h.name);
      h.target = -1;
    } else {
      c.log(`${target.name} beat off ${h.name}: ${Math.round(lostM)} monsters and ${Math.round(lostT)} defenders fell.`, target.x, target.y);
      if (res.fallen[0].length || h.strength < 60) {
        sim.hordes = sim.hordes!.filter((q) => q !== h);
        c.log(`${cap(h.name)} was destroyed${res.fallen[0].length ? `, ${h.alpha} slain` : ''}.`, target.x, target.y);
      } else h.target = -1;
    }
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whether a place is covered by a monster tide (and which). */
export function tideAt(sim: SimState, env: { prov: { of: Int32Array; ids: Int32Array } }, k: number): Tide | undefined {
  if (k < 0) return undefined;
  const p = env.prov.of[k];
  if (p < 0) return undefined;
  const id = env.prov.ids[p];
  return sim.tides?.find((t) => t.provinces.includes(id));
}

export { riftKind };
