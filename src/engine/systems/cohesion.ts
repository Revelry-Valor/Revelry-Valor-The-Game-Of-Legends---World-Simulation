import { Biome } from '../data/biomes';
import type { Polity, Settlement } from '../types';
import type { World } from '../world';
import { DX, DY } from '../worldgen';
import { accessPolicy } from './access';
import { friendly } from './diplomacy';
import { transferSettlement } from './politics';
import { CLAIM_YEARS } from './warAims';

/** Years cut off from the capital before a disloyal town will think of leaving. */
export const BREAKAWAY_YEARS = 6;

function hostile(world: World, p: Polity, q: number): boolean {
  return world.atWar(p.id, q) || (p.relations.get(q) ?? 0) < -0.3;
}

/**
 * Which of a nation's settlements can still be reached from its capital, overland through its
 * own, allied, unclaimed or neutral land (not through enemies or closed borders), or by sea
 * once it can sail.
 */
function markConnected(world: World, p: Polity): void {
  const map = world.map;
  const w = map.width;
  const h = map.height;
  const open = new Map<number, boolean>();
  const canPass = (pid: number) => {
    if (pid === p.id) return true;
    let ok = open.get(pid);
    if (ok === undefined) {
      const q = world.polities[pid];
      ok = friendly(world, p.id, pid) || (!world.atWar(p.id, pid) && accessPolicy(world, q, p) !== 'closed');
      open.set(pid, ok);
    }
    return ok;
  };
  const seen = new Uint8Array(map.size);
  const start = world.settlements[p.capitalId].tile;
  const queue = [start];
  seen[start] = 1;
  const reached = new Set<number>();
  const sea = p.effects.seaTravel;
  const dxs = DX;
  const dys = DY;
  const ocean = Biome.Ocean;
  const deep = Biome.DeepOcean;
  const { biome, owner, moveCost } = map;
  const want = new Set(p.settlementIds);
  for (let qi = 0; qi < queue.length && reached.size < want.size; qi++) {
    const t = queue[qi];
    const o = owner[t];
    if (o >= 0 && want.has(o)) reached.add(o);
    const x = t % w;
    const y = (t - x) / w;
    for (let d = 0; d < 8; d++) {
      const nx = x + dxs[d];
      const ny = y + dys[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen[n]) continue;
      seen[n] = 1;
      const b = biome[n];
      if (b === ocean ? sea < 1 : b === deep ? sea < 2 : !Number.isFinite(moveCost[n])) continue;
      const no = owner[n];
      if (no >= 0 && !canPass(world.settlements[no].polityId)) continue;
      queue.push(n);
    }
  }
  for (const id of p.settlementIds) world.settlements[id].connected = reached.has(id) || world.settlements[id].tile === start;
}

/** Share of the land around a settlement held by hostile powers, and the strongest of them. */
function surroundings(world: World, s: Settlement, p: Polity): { share: number; power: number } {
  const map = world.map;
  const w = map.width;
  const R = 6;
  let owned = 0;
  let hostileTiles = 0;
  const count = new Map<number, number>();
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= map.height || dx * dx + dy * dy > R * R) continue;
      const o = map.owner[y * w + x];
      if (o < 0) continue;
      owned++;
      const q = world.settlements[o].polityId;
      if (q === p.id) continue;
      count.set(q, (count.get(q) ?? 0) + 1);
      if (hostile(world, p, q)) hostileTiles++;
    }
  }
  let power = -1;
  let most = 0;
  for (const [q, n] of count) if (n > most) {
    most = n;
    power = q;
  }
  return { share: owned ? hostileTiles / owned : 0, power };
}

/**
 * Cohesion, once a year. Each settlement's loyalty to its nation drifts towards a target set by
 * its stability, whether it shares the ruling culture, how long the nation has held it, its noble
 * lord, and above all whether it is cut off from the capital and ringed by hostile powers. A
 * town cut off for years, with no trade getting through and loyalty worn thin, goes over to the
 * power that surrounds it (if it has any sympathy for it) or declares itself independent.
 * Towns whose loyalty is high enough hold out for their nation however long it takes.
 */
export function runCohesion(world: World): void {
  const rng = world.rng;
  const everyOther = world.year % 2 === 0;
  const power = new Map<number, number>();
  for (const p of world.alivePolities()) {
    if (everyOther && p.settlementIds.length > 1) markConnected(world, p);
    else if (p.settlementIds.length <= 1) for (const id of p.settlementIds) world.settlements[id].connected = true;
  }
  for (const s of world.aliveSettlements()) {
    const p = world.polities[s.polityId];
    for (const k in s.claims) {
      const q = world.polities[+k];
      if (!q?.alive || world.year - s.claims[k] > CLAIM_YEARS || +k === p.id) delete s.claims[k];
    }
    if (s.id === p.capitalId) {
      s.connected = true;
      s.cutOff = 0;
      s.surrounded = 0;
      s.loyalty += (1 - s.loyalty) * 0.2;
      continue;
    }
    if (everyOther) s.cutOff = s.connected ? 0 : s.cutOff + 2;
    const sur = surroundings(world, s, p);
    s.surrounded = sur.share;
    power.set(s.id, sur.power);
    let target = 0.55 + 0.3 * s.stability + Math.min(0.15, (world.year - s.heldSince) / 200);
    target += s.cultureId === p.cultureId ? 0.1 : -0.15;
    if (s.holder >= 0 && s.holder !== p.dynasty) target += (world.nobles[s.holder].loyalty - 0.6) * 0.3;
    for (const t of p.ruler.traits) target += t === 'just' ? 0.05 : t === 'cruel' ? -0.06 : t === 'weak' ? -0.04 : 0;
    // A rival with a claim who shares the townsfolk's culture pulls at their loyalty.
    for (const k in s.claims) if (world.polities[+k].cultureId === s.cultureId && s.cultureId !== p.cultureId) target -= 0.12;
    if (!s.connected) target -= Math.min(0.55, 0.15 + s.cutOff * 0.05);
    target -= s.surrounded * 0.15;
    if (p.overlord >= 0) target -= 0.03;
    s.loyalty = Math.max(0, Math.min(1, s.loyalty + (target - s.loyalty) * 0.12 + rng.normal() * 0.02));
  }

  // Breakaways of stranded towns.
  const done = new Set<number>();
  for (const s of [...world.aliveSettlements()]) {
    if (done.has(s.id) || s.connected || s.cutOff < BREAKAWAY_YEARS || s.loyalty >= 0.35) continue;
    const p = world.polities[s.polityId];
    if (!p.alive || s.id === p.capitalId || !rng.chance(0.25 + (0.35 - s.loyalty))) continue;
    // The pocket: this town and its stranded, disloyal neighbours of the same nation.
    const pocket = [s];
    for (const li of s.links) {
      const l = world.links[li];
      const o = world.settlements[l.a === s.id ? l.b : l.a];
      if (o.alive && o.polityId === p.id && !o.connected && o.id !== p.capitalId && o.loyalty < 0.45 && !done.has(o.id)) pocket.push(o);
    }
    for (const o of pocket) done.add(o.id);
    const names = pocket.map((o) => o.name).join(', ');
    const years = s.cutOff;
    const qid = power.get(s.id) ?? -1;
    const Q = qid >= 0 ? world.polities[qid] : null;
    const sympathy = Q ? (Q.cultureId === s.cultureId ? 0.5 : 0) + claimOf(world, s, Q.id) + (Q.military > p.military ? 0.2 : 0) + rng.range(0, 0.4) : 0;
    if (Q && Q.alive && sympathy > 0.45) {
      for (const o of pocket) transferSettlement(world, o, p, Q, 0.55);
      world.log('defection', pocket.length > 1 || s.pop > 3000 ? 3 : 2, `Cut off from the ${p.name} for ${years} years and ringed by the lands of the ${Q.name}, ${names} opened ${pocket.length > 1 ? 'their' : 'its'} gates and went over to the ${Q.name}.`, { polities: [Q.id, p.id], settlements: pocket.map((o) => o.id) });
      continue;
    }
    const np = world.createPolity(s.cultureId, s, p.id, p.techs);
    np.settlementIds = [];
    for (const o of pocket) transferSettlement(world, o, p, np, 0.85);
    np.pop = pocket.reduce((n, o) => n + o.pop, 0);
    np.relations.set(p.id, -0.2);
    p.relations.set(np.id, -0.2);
    world.log('defection', pocket.length > 1 || s.pop > 3000 ? 3 : 2, `Abandoned behind enemy lines for ${years} years, ${names} gave up waiting for the ${p.name} and declared ${pocket.length > 1 ? 'themselves' : 'itself'} free: the ${np.name}.`, { polities: [np.id, p.id], settlements: pocket.map((o) => o.id) });
  }
}

function claimOf(world: World, s: Settlement, q: number): number {
  const y = s.claims[q];
  return y === undefined ? 0 : Math.max(0, 0.4 * (1 - (world.year - y) / CLAIM_YEARS));
}
