import type { Library } from '../core/library';
import type { Env } from './env';
import { holderOf, provAt } from './land';
import { manaNow } from './mana';
import type { Settlement, SimState } from './state';
import { knows } from './tech';

/**
 * Rifts (REDESIGN.md 6A; Phase 11 step 2).
 *
 * - **Opening.** Permanent rifts open where mana is dense and nothing draws on it (no town
 *   near, no mountain range); short-lived rifts open the same way on less mana, where corruption
 *   runs high, and now and then anywhere at all. Short-lived rifts close after a few years.
 * - **Corruption** builds where mana is drawn on hard (mage towers, towns working mana) and round
 *   open rifts, and fades slowly.
 * - **What they give.** Each rift is of a kind, with goods rare or not found in the mortal plane
 *   (rift iron, mana crystals) and rare ordinary ones; some release fresh water (a spring the
 *   peoples can live by). Settlements are drawn toward them.
 * - **Holding.** The realm holding a rift's province chooses each year: an encampment (steady
 *   yield, keeps it down), soldiers (keep it down hardest, yield less), a party sent now and then
 *   (some yield, some keeping down), or nothing. What is gathered goes to its nearest town.
 * - **Strength.** A rift grows stronger each year, faster on denser mana; what holds it keeps it
 *   down. A rift at full strength is near breaking (rift breaks and monster tides: step 3).
 */

export type RiftHold = 'none' | 'encampment' | 'soldiers' | 'parties';

export interface Rift {
  id: number;
  name: string;
  kind: string;
  x: number;
  y: number;
  permanent: boolean;
  opened: number;
  /** A short-lived rift's closing day. */
  closes?: number;
  /** 0 (weak) to 1 (at breaking point). */
  strength: number;
  /** Fresh water from it (a spring). */
  water: boolean;
  /** Who holds it (the realm holding its province; −1 none) and how. */
  holder: number;
  hold: RiftHold;
  /** The last year a party went in. */
  partyYear?: number;
  /** The last time it was tested at full strength (monsters.ts). */
  lastStand?: number;
  /** Goods gathered from it in all (by resource id), and last year. */
  gathered: Record<string, number>;
  lastYield: Record<string, number>;
}

/** The kinds of rift: what each gives (units a year at full working, by resource id), and whether it tends to give water. */
export const RIFT_KINDS: { id: string; name: string; yields: Record<string, number>; water: number }[] = [
  { id: 'ember', name: 'Ember rift', yields: { 'rift-iron': 12, obsidian: 10, sulfur: 8 }, water: 0 },
  { id: 'crystal', name: 'Crystal rift', yields: { 'mana-crystal': 10, gems: 4 }, water: 0.2 },
  { id: 'verdant', name: 'Verdant rift', yields: { herbs: 14, 'exotic-wood': 10, honey: 6, 'mana-crystal': 2 }, water: 0.7 },
  { id: 'deep', name: 'Deep rift', yields: { 'rift-iron': 10, 'mana-crystal': 5, silver: 4, gold: 1 }, water: 0.2 },
  { id: 'tide', name: 'Tide rift', yields: { pearls: 5, salt: 10, 'mana-crystal': 3 }, water: 1 },
];
export const riftKind = (id: string) => RIFT_KINDS.find((k) => k.id === id) ?? RIFT_KINDS[0];
export const HOLD_NAMES: Record<RiftHold, string> = { none: 'Left alone', encampment: 'Encampment', soldiers: 'Soldiers stationed', parties: 'Parties sent' };

/** Per hold: share of the full yield gathered, and how much it keeps the rift's strength down a year. */
const HOLD_EFFECT: Record<RiftHold, { yield: number; down: number }> = {
  none: { yield: 0, down: 0 },
  encampment: { yield: 1, down: 0.1 },
  soldiers: { yield: 0.5, down: 0.16 },
  parties: { yield: 0.4, down: 0.08 },
};

/** Mana at least this dense, with nothing using it, can open a permanent rift; short-lived ones need less. */
export const PERMANENT_MANA = 0.75;
const SHORT_MANA = 0.6;
/** Corruption at which short-lived rifts begin to open. */
export const CORRUPTION_RIFT = 0.5;
/** Rifts keep at least this far apart (km), and this far from a town (km) to open by mana. */
const APART = 300;
const AWAY_FROM_TOWNS = 80;

export interface RiftContext {
  sim: SimState;
  env: Env;
  lib: Library;
  rand: () => number;
  dist: (ax: number, ay: number, bx: number, by: number) => number;
  log: (text: string, x?: number, y?: number) => void;
  name: () => string;
}

const live = (sim: SimState) => sim.settlements.filter((s) => !s.ruined);

/** Each year: corruption, rifts opening and closing, who holds them and how, what they give, and how strong they grow. */
export function riftsYear(c: RiftContext): void {
  const { sim, env } = c;
  sim.rifts ??= [];
  const mana = manaNow(sim, env);
  const corruption = (sim.corruption ??= new Float32Array(env.n));
  corruptionYear(c, corruption);
  // Short-lived rifts close.
  for (const r of [...sim.rifts]) {
    if (r.permanent || (r.closes ?? Infinity) > sim.day) continue;
    sim.rifts = sim.rifts.filter((q) => q !== r);
    c.log(`The ${r.name} closed.`, r.x, r.y);
  }
  openRifts(c, mana, corruption);
  for (const r of sim.rifts) holdRift(c, r, mana);
}

function corruptionYear(c: RiftContext, corruption: Float32Array): void {
  const { sim, env, lib } = c;
  for (let k = 0; k < env.n; k++) corruption[k] *= 0.93;
  const spread = (x: number, y: number, r: number, v: number) => {
    const reach = Math.ceil(r / env.step);
    const ci = Math.round((x - env.x0) / env.step);
    const cj = Math.round((y - env.y0) / env.step);
    for (let dj = -reach; dj <= reach; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= env.h) continue;
      for (let di = -reach; di <= reach; di++) {
        let i = ci + di;
        if (i < 0 || i >= env.w) {
          if (!env.wrapKm) continue;
          i = ((i % env.w) + env.w) % env.w;
        }
        const d2 = (di * di + dj * dj) * env.step * env.step;
        if (d2 > r * r) continue;
        const k = j * env.w + i;
        corruption[k] = Math.min(1, corruption[k] + v * (1 - d2 / (r * r)));
      }
    }
  };
  // Drawing on mana: mage towers, and towns that work mana crystals or run mana engines.
  for (const st of live(sim)) {
    let draw = st.tower !== undefined ? 0.05 : 0;
    if (knows(lib, st, 'mana-working')) draw += 0.03;
    if (knows(lib, st, 'mana-engine')) draw += 0.05;
    if (draw) spread(st.x, st.y, 120, draw);
  }
  // Round open rifts, the more the stronger they are.
  for (const r of sim.rifts ?? []) spread(r.x, r.y, 150, 0.04 + 0.08 * r.strength);
}

function openRifts(c: RiftContext, mana: Float32Array, corruption: Float32Array): void {
  const { sim, env } = c;
  const towns = live(sim);
  const xOf = (k: number) => env.x0 + (k % env.w) * env.step;
  const yOf = (k: number) => env.y0 + ((k / env.w) | 0) * env.step;
  const clear = (x: number, y: number, fromTowns: number) =>
    sim.rifts!.every((r) => c.dist(r.x, r.y, x, y) > APART) && towns.every((t) => c.dist(t.x, t.y, x, y) > fromTowns);
  // Candidates: land points dense enough, one picked at random of each sort a year.
  const perm: number[] = [];
  const short: number[] = [];
  const corrupt: number[] = [];
  const any: number[] = [];
  for (let k = 0; k < env.n; k++) {
    if (!env.land[k]) continue;
    if (env.mzone[k] < 3) any.push(k);
    if (mana[k] >= PERMANENT_MANA && env.mzone[k] < 2) perm.push(k);
    else if (mana[k] >= SHORT_MANA && env.mzone[k] < 3) short.push(k);
    if (corruption[k] >= CORRUPTION_RIFT) corrupt.push(k);
  }
  const one = (list: number[]) => (list.length ? list[Math.floor(c.rand() * list.length)] : -1);
  // A permanent rift on dense mana nothing uses (no town near, no mountain range).
  {
    const k = one(perm);
    if (k >= 0 && clear(xOf(k), yOf(k), AWAY_FROM_TOWNS) && c.rand() < 0.1 + 0.6 * (mana[k] - PERMANENT_MANA)) open(c, k, true, 'dense mana');
  }
  // Short-lived: on less mana, where corruption is high, and now and then anywhere.
  {
    const k = one(short);
    if (k >= 0 && clear(xOf(k), yOf(k), AWAY_FROM_TOWNS / 2) && c.rand() < 0.06) open(c, k, false, 'mana');
  }
  {
    const k = one(corrupt);
    if (k >= 0 && clear(xOf(k), yOf(k), 0) && c.rand() < 0.3 * corruption[k]) open(c, k, false, 'corruption');
  }
  if (c.rand() < 0.02) {
    const k = one(any);
    if (k >= 0 && clear(xOf(k), yOf(k), 0)) open(c, k, false, 'chance');
  }
}

function open(c: RiftContext, k: number, permanent: boolean, why: string): void {
  const { sim, env } = c;
  const kind = RIFT_KINDS[Math.floor(c.rand() * RIFT_KINDS.length)];
  const x = env.x0 + (k % env.w) * env.step;
  const y = env.y0 + ((k / env.w) | 0) * env.step;
  const r: Rift = {
    id: sim.nextId++,
    name: `${kind.name} of ${c.name()}`,
    kind: kind.id,
    x,
    y,
    permanent,
    opened: sim.day,
    ...(permanent ? {} : { closes: sim.day + 360 * (1 + Math.floor(c.rand() * 5)) }),
    strength: permanent ? 0.15 : 0.25,
    water: c.rand() < kind.water,
    holder: -1,
    hold: 'none',
    gathered: {},
    lastYield: {},
  };
  sim.rifts!.push(r);
  const because = why === 'dense mana' ? 'where mana runs dense and nothing draws on it' : why === 'corruption' ? 'where corruption ran too high' : why === 'mana' ? 'on the mana lines' : 'out of nowhere';
  c.log(`${permanent ? 'A permanent' : 'A short-lived'} rift opened ${because}: the ${r.name}${r.water ? ', with fresh water welling from it' : ''}.`, x, y);
}

/** The holder's choice for a rift, what it gathers, and how strong the rift grows. */
function holdRift(c: RiftContext, r: Rift, mana: Float32Array): void {
  const { sim, env, lib } = c;
  const p = provAt(env, r.x, r.y);
  const holder = holderOf(sim, p);
  if (holder !== r.holder) {
    r.holder = holder;
    r.hold = 'none';
  }
  const year = Math.floor(sim.day / 360);
  const towns = live(sim).filter((s) => s.clan === holder && s.economy);
  const near = towns.sort((a, b) => c.dist(a.x, a.y, r.x, r.y) - c.dist(b.x, b.y, r.x, r.y))[0];
  const d = near ? c.dist(near.x, near.y, r.x, r.y) : Infinity;
  const clan = sim.clans.find((q) => q.id === holder);
  const settled = !!clan?.realm && clan.realm.gov !== 'clan' && clan.realm.gov !== 'horde';
  // The choice: close and big enough for an encampment; a settled realm stations soldiers on a
  // strong one; within reach, parties; else nothing.
  let hold: RiftHold = 'none';
  if (holder >= 0 && near) {
    if (d <= 150 && near.pop >= 300 && r.strength < 0.7) hold = 'encampment';
    else if (settled && d <= 300 && r.strength >= 0.5) hold = 'soldiers';
    else if (d <= 350) hold = 'parties';
  }
  if (hold !== r.hold && hold !== 'none' && near) c.log(`${near.name} ${hold === 'encampment' ? 'set up an encampment at' : hold === 'soldiers' ? 'stationed soldiers at' : 'began sending parties into'} the ${r.name}.`, r.x, r.y);
  r.hold = hold;
  const fx = HOLD_EFFECT[hold];
  // Parties go in every other year or so (the year they go, they keep it down and bring goods back).
  const partyNow = hold === 'parties' && (r.partyYear === undefined || year - r.partyYear >= 1 + Math.floor(c.rand() * 2));
  if (partyNow) r.partyYear = year;
  const working = hold === 'parties' ? (partyNow ? 1 : 0) : 1;
  // What it gives: the kind's goods, by how the holder works it (rift goods need rift lore to bring out).
  r.lastYield = {};
  if (near && fx.yield * working > 0) {
    const kind = riftKind(r.kind);
    const lore = knows(lib, near, 'rift-lore');
    for (const [id, units] of Object.entries(kind.yields)) {
      if (!lib.resources.some((q) => q.id === id)) continue;
      const rift = id === 'mana-crystal' || id === 'rift-iron';
      if (rift && !lore) continue;
      const got = units * fx.yield * working * (0.6 + 0.6 * r.strength) * (r.permanent ? 1 : 0.7);
      near.economy!.stores[id] = (near.economy!.stores[id] ?? 0) + got;
      r.lastYield[id] = got;
      r.gathered[id] = (r.gathered[id] ?? 0) + got;
    }
  }
  // Strength: grows, faster on dense mana; the hold keeps it down.
  const k = cellAt(env, r.x, r.y);
  const m = k >= 0 ? mana[k] : 0.5;
  const before = r.strength;
  r.strength = Math.max(0.05, Math.min(1, r.strength + (r.permanent ? 0.035 : 0.07) * (0.5 + m) - fx.down * working));
  if (r.strength >= 1 && before < 1) c.log(`The ${r.name} has grown to breaking point: if nothing holds it down, it will break.`, r.x, r.y);
}

const cellAt = (env: Env, x: number, y: number) => {
  let i = Math.round((x - env.x0) / env.step);
  const j = Math.round((y - env.y0) / env.step);
  if (j < 0 || j >= env.h) return -1;
  if (i < 0 || i >= env.w) {
    if (!env.wrapKm) return -1;
    i = ((i % env.w) + env.w) % env.w;
  }
  return j * env.w + i;
};

/** How much a place draws settlers for its rifts: their wealth, and their springs (0 far from any). */
export function riftPull(sim: SimState, dist: (ax: number, ay: number, bx: number, by: number) => number, x: number, y: number): number {
  let pull = 0;
  for (const r of sim.rifts ?? []) {
    const d = dist(r.x, r.y, x, y);
    if (d < 40) return -1; // not on top of it
    if (d > 250) continue;
    pull = Math.max(pull, (0.3 + (r.water ? 0.3 : 0)) * (1 - d / 250));
  }
  return pull;
}

/** A spring from a rift near a place (fresh water to live by). */
export const riftSpringNear = (sim: SimState, dist: (ax: number, ay: number, bx: number, by: number) => number, x: number, y: number) => (sim.rifts ?? []).some((r) => r.water && dist(r.x, r.y, x, y) < 60);

/** The rifts a settlement works or could reach (for its card). */
export const riftsOf = (sim: SimState, st: Settlement, dist: (ax: number, ay: number, bx: number, by: number) => number) => (sim.rifts ?? []).filter((r) => r.holder === st.clan && dist(r.x, r.y, st.x, st.y) < 350);
