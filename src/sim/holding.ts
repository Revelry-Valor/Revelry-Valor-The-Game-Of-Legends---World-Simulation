import type { Env } from './env';
import { distOn, PK, provAt, provincesNear, setHolder, syncCells } from './land';
import type { SimState } from './state';

/**
 * Land and borders (REDESIGN.md 8.0, step 3): a realm holds the land its people live on and use.
 *
 * Once a year every province goes to whoever has the most people about it:
 * - settlements (each village counting for itself, joined or not), strongest at home and fading
 *   out to the edge of the land they work;
 * - tribes and clans, over the land they range over;
 * - the families living in the wild, for the realm of their own race whose people are already
 *   about them, or whose land is next to them (so a realm creeps out, a province a year, over the
 *   land its families spread into); families out in land nobody holds give nobody a claim.
 *
 * The province a settlement stands in is its realm's, whatever lives round it: that changes only
 * when the settlement does (taken in a war, ceded in a treaty). Elsewhere a holder keeps its land
 * while its presence stays near the strongest, so borders don't flicker; where two realms' people
 * mix, the land is contested (drawn faded) and goes, without a war, to whichever comes to
 * outnumber the other. Land nobody's people use any more is let go (gaps are filled whole after,
 * by tidyProvinces).
 */

/** People who give a claim: a settlement or a tribe. */
export interface Presence {
  clan: number;
  race: string;
  x: number;
  y: number;
  pop: number;
  /** How far its people work and range (km). */
  r: number;
  /** A settlement (its own province is held whatever else is about). */
  seat?: boolean;
}

/** Fewer people than this about a province gives no claim to it. */
export const HOLD_MIN = 4;
/** A holder keeps its land while it has this share of the strongest presence there. */
export const KEEP = 0.6;
/** A runner-up with this share of the holder's presence makes the land contested. */
export const CONTEST = 0.45;
/** Weight of the families in the wild against settled people. */
const WILD = 0.5;

/** Each province's presence, by clan. */
export function presenceByProvince(sim: SimState, env: Env, sources: Presence[], blocked: (x: number, y: number, k: number) => boolean): Map<number, number>[] {
  const P = env.prov;
  const out: Map<number, number>[] = Array.from({ length: P.count }, () => new Map());
  // Which clan of each race is about each province (for the families in the wild).
  const byRace: Map<string, Map<number, number>>[] = Array.from({ length: P.count }, () => new Map());
  const add = (p: number, clan: number, race: string, v: number) => {
    out[p].set(clan, (out[p].get(clan) ?? 0) + v);
    let m = byRace[p].get(race);
    if (!m) byRace[p].set(race, (m = new Map()));
    m.set(clan, (m.get(clan) ?? 0) + v);
  };
  const clanRace = new Map<number, Set<string>>();
  for (const s of sources) {
    if (!clanRace.has(s.clan)) clanRace.set(s.clan, new Set());
    clanRace.get(s.clan)!.add(s.race);
    if (s.pop <= 0) continue;
    const list = provincesNear(env, s.x, s.y, s.r);
    list.forEach((p, i) => {
      if (P.kind[p] !== PK.land) return;
      const d = i === 0 ? 0 : distOn(env, s.x, s.y, P.x[p], P.y[p]);
      // Strongest at home, a fifth of it at the edge; half across a river or mountains.
      let f = 1 - 0.8 * Math.min(1, d / Math.max(1, s.r));
      if (i > 0 && P.centre[p] >= 0 && blocked(s.x, s.y, P.centre[p])) f *= 0.5;
      add(p, s.clan, s.race, s.pop * f);
    });
  }
  // The families in the wild, for the clan of their race most about them (here or next door).
  if (sim.density) {
    for (let p = 0; p < P.count; p++) {
      if (P.kind[p] !== PK.land) continue;
      for (const [race, D] of Object.entries(sim.density)) {
        let wild = 0;
        for (let q = P.start[p]; q < P.start[p + 1]; q++) wild += D[P.cells[q]] ?? 0;
        if (wild <= 0) continue;
        let best = -1;
        let bv = 0;
        const look = (o: number) => {
          for (const [clan, v] of byRace[o].get(race) ?? []) if (v > bv) [best, bv] = [clan, v];
        };
        look(p);
        if (best < 0) for (let q = P.nbStart[p]; q < P.nbStart[p + 1]; q++) look(P.nb[q]);
        // Or the realm of their race holding the land next to them: a realm creeps out, a
        // province a year, over the land its families have spread into.
        if (best < 0 && sim.provOwner) for (let q = P.nbStart[p]; q < P.nbStart[p + 1]; q++) {
          const o = sim.provOwner[P.nb[q]];
          if (o >= 0 && clanRace.get(o)?.has(race)) {
            best = o;
            break;
          }
        }
        if (best >= 0) out[p].set(best, (out[p].get(best) ?? 0) + wild * WILD);
      }
    }
  }
  return out;
}

/** The yearly pass: every land province to the people about it (see the top of this file). */
export function holdYear(sim: SimState, env: Env, sources: Presence[], blocked: (x: number, y: number, k: number) => boolean): void {
  const P = env.prov;
  if (!sim.provOwner || !sim.provRival || !sim.provRivalUse) return;
  const pres = presenceByProvince(sim, env, sources, blocked);
  // The province each settlement stands in: its realm's (the biggest settlement's, if two).
  const seat = new Map<number, Presence>();
  for (const s of sources) {
    if (!s.seat) continue;
    const p = provAt(env, s.x, s.y);
    if (p < 0 || P.kind[p] !== PK.land) continue;
    const o = seat.get(p);
    if (!o || s.pop > o.pop) seat.set(p, s);
  }
  for (let p = 0; p < P.count; p++) {
    if (P.kind[p] !== PK.land) continue;
    const m = pres[p];
    const held = sim.provOwner[p];
    let lead = -1;
    let lv = 0;
    for (const [clan, v] of m) if (v > lv) [lead, lv] = [clan, v];
    const hv = held >= 0 ? (m.get(held) ?? 0) : 0;
    let next = held;
    const st = seat.get(p);
    if (st) next = st.clan;
    else if (lv < HOLD_MIN) next = hv >= HOLD_MIN / 2 ? held : -1;
    else if (held < 0 || hv < KEEP * lv) next = lead;
    // The strongest other presence: contested if near the holder's.
    const nv = next >= 0 ? (m.get(next) ?? 0) : 0;
    let rival = -1;
    let rv = 0;
    for (const [clan, v] of m) if (clan !== next && v > rv) [rival, rv] = [clan, v];
    const contested = next >= 0 && rival >= 0 && rv >= HOLD_MIN && rv >= CONTEST * nv;
    if (next !== held) setHolder(sim, env, p, next);
    sim.provRival[p] = contested ? rival : -1;
    // How near the rival's presence is to the holder's (percent; 100 and more: it outnumbers them).
    sim.provRivalUse[p] = contested ? Math.min(250, Math.round((100 * rv) / Math.max(1e-6, nv))) : 0;
  }
  syncCells(sim, env);
}
