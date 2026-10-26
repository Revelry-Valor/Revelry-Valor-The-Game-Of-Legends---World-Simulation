import type { Hero, Units } from './state';

/**
 * Phased battles (REDESIGN.md 8.4i; Phase 10 step 2).
 *
 * Each side is its fighters grouped by kind (foot, archers, riders, specialists) and its heroes,
 * with the people's might, their arms and missile weapons, morale, and the ground. A battle runs in
 * three phases, each favouring different kinds:
 * - Skirmish: archers (and flying specialists) loose on the enemy; cover (walls, hills, forest)
 *   shelters the defenders.
 * - Clash: the lines meet. Heroes may duel first (the loser falls, his side shaken). Foot hold the
 *   line, riders charge (strong on open ground, weak in forest, marsh and mountains), specialists
 *   fight hard (mountain troops on the heights, sky scouts everywhere), archers fight poorly hand to
 *   hand. Defenders gain on hills, behind rivers and behind walls; heroes lift their side.
 * - Pursuit: a side whose morale breaks routs, and the winners' riders cut it down (its own riders
 *   screen the retreat); one that holds falls back in order.
 * Heroes can fall; a warrior may rise as a hero from a victory.
 */

export const UNIT_KINDS = ['foot', 'archers', 'riders', 'specialists'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export interface Ground {
  /** Where, as a phrase ("in the forest", "at a river crossing"). */
  name: string;
  /** Mountain zone (0 lowland … 4 peaks), and river, forest, marsh. */
  hills: number;
  river: boolean;
  forest: boolean;
  marsh: boolean;
}

export interface Side {
  label: string;
  units: Units;
  heroes: Hero[];
  morale: number;
  /** How strong each fighter of its people is, and its arms (melee) and missile weapons. */
  might: number;
  arms: number;
  ranged: number;
  defending: boolean;
  /** Walls (1 none). */
  walls: number;
  /** Its specialists' kind: mountain troops gain on the heights, sky scouts everywhere. */
  mountain: boolean;
  flies: boolean;
  specialistName: string;
}

export interface Phase {
  name: string;
  text: string;
  lost: [Units, Units];
}

export interface FightResult {
  winner: 0 | 1;
  lost: [Units, Units];
  phases: Phase[];
  notes: string[];
  routed: boolean;
  days: number;
  morale: [number, number];
  /** Heroes who fell, by side; a hero risen from the winners' ranks. */
  fallen: [string[], string[]];
  risen?: Hero;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const total = (u: Units) => UNIT_KINDS.reduce((n, k) => n + (u[k] ?? 0), 0);
const empty = (): Units => ({ foot: 0, archers: 0, riders: 0, specialists: 0 });
const fmt = (n: number) => Math.round(n).toLocaleString();
export const kindName = (k: UnitKind, specialists = 'specialists') => (k === 'specialists' ? specialists : k);

/** Take `kills` from a side, spread over its kinds by how exposed each is. */
function spread(u: Units, kills: number, weight: Record<UnitKind, number>): Units {
  const out = empty();
  const w = UNIT_KINDS.reduce((n, k) => n + (u[k] ?? 0) * weight[k], 0);
  if (w <= 0 || kills <= 0) return out;
  for (const k of UNIT_KINDS) {
    const take = Math.min(u[k] ?? 0, (kills * (u[k] ?? 0) * weight[k]) / w);
    out[k] = take;
    u[k] = (u[k] ?? 0) - take;
  }
  return out;
}
const add = (a: Units, b: Units) => {
  for (const k of UNIT_KINDS) a[k] = (a[k] ?? 0) + (b[k] ?? 0);
};

/** Fight a battle between two sides on this ground. The sides' units are reduced in place. */
export function fight(rand: () => number, g: Ground, A: Side, B: Side): FightResult {
  const sides = [A, B];
  const lost: [Units, Units] = [empty(), empty()];
  const phases: Phase[] = [];
  const notes: string[] = [];
  const fallen: [string[], string[]] = [[], []];
  const ridersMod = g.forest ? 0.6 : g.marsh ? 0.5 : g.hills >= 2 ? 0.6 : g.hills === 1 ? 0.85 : 1.15;
  const archersMod = g.forest ? 0.7 : 1;
  const specMod = (s: Side) => (s.mountain && g.hills >= 1 ? 1.5 : s.flies ? 1.3 : 1);
  const moraleF = (s: Side) => clamp(s.morale, 0.2, 1.2);
  const heroBonus = (s: Side) => 1 + Math.min(0.4, 0.05 * s.heroes.reduce((n, h) => n + h.power, 0));
  const cover = (s: Side) => (!s.defending ? (g.forest ? 0.8 : 1) : s.walls > 1 ? 0.5 : g.hills >= 1 ? 0.8 : g.forest ? 0.7 : 1);
  const holdGround = (s: Side) => (s.defending ? (1 + 0.08 * Math.min(3, g.hills) + (g.river ? 0.25 : 0)) * s.walls : 1);

  // ---- Skirmish.
  const shoot = (s: Side) => ((s.units.archers ?? 0) * archersMod * s.ranged + (s.units.specialists ?? 0) * 0.3 * (s.flies ? 2 : 1)) * s.might * moraleF(s) * (0.7 + 0.6 * rand());
  const volley = sides.map(shoot);
  const skLost: [Units, Units] = [empty(), empty()];
  for (const i of [0, 1] as const) {
    const t = sides[1 - i];
    const kills = Math.min(total(t.units) * 0.15, volley[i] * 0.05 * cover(t));
    skLost[1 - i] = spread(t.units, kills, { foot: 1, archers: 0.8, riders: 1.2, specialists: 0.8 });
  }
  add(lost[0], skLost[0]);
  add(lost[1], skLost[1]);
  const skA = total(skLost[0]);
  const skB = total(skLost[1]);
  if (skA > skB * 1.5) A.morale -= 0.05;
  if (skB > skA * 1.5) B.morale -= 0.05;
  const shooters = (s: Side) => (s.units.archers ?? 0) + (s.flies ? s.units.specialists ?? 0 : 0);
  phases.push({
    name: 'Skirmish',
    text: shooters(A) + shooters(B) < 1 ? 'Neither side had archers to speak of; the lines closed at once.' : `Arrows flew: ${A.label} lost ${fmt(skA)}, ${B.label} lost ${fmt(skB)}${B.defending && B.walls > 1 ? ' (behind its walls)' : ''}.`,
    lost: skLost,
  });

  // ---- Clash: heroes may duel first.
  const best = (s: Side) => [...s.heroes].sort((p, q) => q.power - p.power)[0];
  const ha = best(A);
  const hb = best(B);
  if (ha && hb && rand() < 0.6) {
    const aWins = ha.power * (0.5 + rand()) > hb.power * (0.5 + rand());
    const [w, l, wi] = aWins ? [ha, hb, 0] : [hb, ha, 1];
    const killed = rand() < 0.6;
    notes.push(`${w.name} met ${l.name} between the lines and ${killed ? 'slew' : 'struck down'} ${l.female ? 'her' : 'him'}.`);
    sides[wi].morale += 0.1;
    sides[1 - wi].morale -= 0.12;
    w.deeds++;
    if (killed) {
      fallen[1 - wi].push(l.name);
      sides[1 - wi].heroes = sides[1 - wi].heroes.filter((h) => h !== l);
    }
  }
  const melee = (s: Side) =>
    ((s.units.foot ?? 0) + (s.units.riders ?? 0) * 1.6 * ridersMod + (s.units.specialists ?? 0) * 1.4 * specMod(s) + (s.units.archers ?? 0) * 0.5) * s.might * s.arms * moraleF(s) * heroBonus(s) * holdGround(s) * (0.75 + 0.5 * rand());
  const pa = melee(A);
  const pb = melee(B);
  const winner: 0 | 1 = pa >= pb ? 0 : 1;
  const W = sides[winner];
  const L = sides[1 - winner];
  const edge = Math.max(pa, pb) / Math.max(1, Math.min(pa, pb));
  const exposure = { foot: 1.2, archers: 0.6, riders: 0.8, specialists: 0.9 };
  const lostL = spread(L.units, total(L.units) * clamp((0.1 + 0.12 * rand()) * Math.min(2.5, edge), 0, 0.5), exposure);
  const lostW = spread(W.units, total(W.units) * clamp((0.03 + 0.06 * rand()) / Math.min(2, edge), 0, 0.2) * (L.defending ? L.walls : 1), exposure);
  const clashLost: [Units, Units] = winner === 0 ? [lostW, lostL] : [lostL, lostW];
  add(lost[0], clashLost[0]);
  add(lost[1], clashLost[1]);
  W.morale += 0.08;
  // The more outmatched, and the more it lost, the nearer the loser is to breaking.
  const share = total(lostL) / Math.max(1, total(L.units) + total(lostL));
  L.morale -= 0.2 + 0.2 * Math.min(2, edge - 1) + (share > 0.25 ? 0.15 : 0);
  const charge = (W.units.riders ?? 0) > total(W.units) * 0.15 && ridersMod >= 1;
  phases.push({
    name: 'Clash',
    text: `${W.label} ${edge > 2 ? 'overwhelmed' : edge > 1.3 ? 'broke' : 'pushed back'} ${L.label}${charge ? ', its riders charging on the open ground' : ''}${L.defending && g.river ? ' at the river' : L.defending && g.hills ? ' on the heights' : ''}. ${W.label} lost ${fmt(total(clashLost[winner]))}, ${L.label} ${fmt(total(clashLost[1 - winner]))}.`,
    lost: clashLost,
  });

  // ---- Pursuit.
  const routed = L.morale < 0.45;
  const pLost: [Units, Units] = [empty(), empty()];
  if (routed) {
    const chase = ((W.units.riders ?? 0) * 0.15 * ridersMod + (W.units.foot ?? 0) * 0.01 + (W.units.specialists ?? 0) * (W.flies ? 0.1 : 0.02)) * (0.7 + 0.6 * rand());
    // Its own riders screen the flight.
    const screen = total(L.units) > 0 ? Math.min(0.8, (1.5 * (L.units.riders ?? 0)) / total(L.units)) : 0;
    const kills = Math.min(total(L.units) * 0.35, chase * (1 - screen));
    pLost[1 - winner] = spread(L.units, kills, { foot: 1.3, archers: 1.1, riders: 0.4, specialists: 0.8 });
  } else pLost[1 - winner] = spread(L.units, total(L.units) * 0.02, { foot: 1, archers: 1, riders: 0.5, specialists: 1 });
  add(lost[0], pLost[0]);
  add(lost[1], pLost[1]);
  phases.push({
    name: 'Pursuit',
    text: routed ? `${L.label} broke and fled; ${(W.units.riders ?? 0) > 0 ? 'the riders of ' : ''}${W.label} cut down ${fmt(total(pLost[1 - winner]))} more.` : `${L.label} fell back in good order (${fmt(total(pLost[1 - winner]))} lost).`,
    lost: pLost,
  });

  // ---- Heroes: some fall; a warrior may rise from the winners.
  for (const i of [0, 1] as const) {
    const s = sides[i];
    const p = i === winner ? 0.03 : routed ? 0.2 : 0.1;
    for (const h of [...s.heroes]) {
      if (rand() >= p) continue;
      fallen[i].push(h.name);
      s.heroes = s.heroes.filter((x) => x !== h);
      notes.push(`${h.name} fell in the fighting.`);
    }
  }
  for (const h of W.heroes) h.deeds++;
  const total0 = total(A.units) + total(lost[0]);
  const total1 = total(B.units) + total(lost[1]);
  const size = total0 + total1;
  return {
    winner,
    lost,
    phases,
    notes,
    routed,
    days: 1 + (size > 2000 ? 1 : 0) + (size > 8000 ? 1 : 0),
    morale: [clamp(A.morale, 0, 1.2), clamp(B.morale, 0, 1.2)],
    fallen,
    ...(rand() < 0.15 ? { risen: { name: '', kind: 'hero' as const, power: 1 + Math.floor(rand() * 2), born: 0, deeds: 1, female: rand() < 0.5 } } : {}),
  };
}
