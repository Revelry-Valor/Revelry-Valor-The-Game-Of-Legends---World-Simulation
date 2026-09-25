import { GOOD_BASE_PRICE, GOOD_COUNT, Good } from '../data/economy';
import type { Polity, Settlement, TradeLink } from '../types';
import { pairKey, type World } from '../world';

const MAX_PARTNERS = 6;
const TRADE_GOODS = Array.from({ length: GOOD_COUNT }, (_, g) => g as Good);

/**
 * How far a settlement's merchants will travel (in terrain cost units).
 * Grows with transport technology, sea travel and a trade-minded culture.
 */
export function tradeRange(world: World, s: Settlement): number {
  const fx = world.polities[s.polityId].effects;
  const merchants = world.cultures[s.cultureId].values.mercantilism;
  return 14 * (1 + fx.tradeRange) * (0.85 + 0.3 * merchants) + fx.seaTravel * 4;
}

function searchLinks(world: World, s: Settlement, found: Map<number, TradeLink>): void {
  const map = world.map;
  const pf = world.pathfinder;
  const sea = world.polities[s.polityId].effects.seaTravel;
  const reached: { id: number; tile: number; cost: number }[] = [];
  pf.run(s.tile, tradeRange(world, s), sea, (tile, cost) => {
    const o = map.settlementAt[tile];
    if (o >= 0 && o !== s.id && world.settlements[o].alive) reached.push({ id: o, tile, cost });
    return reached.length >= MAX_PARTNERS;
  });
  for (const r of reached) {
    const key = pairKey(s.id, r.id);
    const existing = found.get(key);
    if (existing && existing.cost <= r.cost) continue;
    const path = pf.pathTo(r.tile);
    let isSea = false;
    for (const t of path) if (map.elevation[t] < 0) isSea = true;
    found.set(key, { a: Math.min(s.id, r.id), b: Math.max(s.id, r.id), cost: r.cost, path, sea: isSea, volume: existing?.volume ?? 0, kind: 'internal' });
  }
}

function indexLinks(world: World): void {
  for (const s of world.settlements) s.links = [];
  world.links.forEach((l, idx) => {
    world.settlements[l.a].links.push(idx);
    world.settlements[l.b].links.push(idx);
  });
}

/**
 * Every settlement searches outward over the terrain (with its polity's roads and ships)
 * and connects to its nearest reachable neighbours. A full rebuild runs periodically; in
 * between, only settlements without links (newly founded) search.
 */
export function buildTradeLinks(world: World, full = true): void {
  const found = new Map<number, TradeLink>();
  if (full) {
    for (const s of world.aliveSettlements()) searchLinks(world, s, found);
  } else {
    for (const l of world.links) {
      if (world.settlements[l.a].alive && world.settlements[l.b].alive) found.set(pairKey(l.a, l.b), l);
    }
    for (const s of world.aliveSettlements()) if (s.links.length === 0) searchLinks(world, s, found);
  }
  const old = new Map(world.links.map((l) => [pairKey(l.a, l.b), l]));
  world.links = [...found.values()].sort((x, y) => x.a - y.a || x.b - y.b);
  for (const l of world.links) {
    const o = old.get(pairKey(l.a, l.b));
    if (o) {
      l.volume = o.volume;
      l.kind = o.kind;
    }
  }
  indexLinks(world);
  world.linksDirty = false;
}

/**
 * Internal trade routes: every settlement of a nation is tied by road to the nation's hub,
 * its largest settlement, so goods (and roads) converge on the heart of the realm.
 */
export function buildHubLinks(world: World): void {
  const pf = world.pathfinder;
  const map = world.map;
  const old = new Map(world.hubLinks.map((l) => [pairKey(l.a, l.b), l.volume]));
  const local = new Set(world.links.map((l) => pairKey(l.a, l.b)));
  const out: TradeLink[] = [];
  for (const p of world.alivePolities()) {
    if (p.settlementIds.length < 2) continue;
    const hub = world.settlements[p.hubId];
    if (!hub?.alive || hub.polityId !== p.id) continue;
    const members = new Set(p.settlementIds.filter((id) => id !== hub.id));
    let remaining = members.size;
    const reach = 45 + p.effects.roads * 20 + p.effects.seaTravel * 10;
    const hits: number[] = [];
    let explored = 0;
    pf.run(hub.tile, reach, p.effects.seaTravel, (tile) => {
      if (++explored > 8000) return true;
      const o = map.settlementAt[tile];
      if (o >= 0 && members.has(o)) {
        hits.push(tile);
        remaining--;
      }
      return remaining <= 0;
    });
    for (const tile of hits) {
      const id = map.settlementAt[tile];
      const key = pairKey(hub.id, id);
      if (local.has(key)) continue;
      const path = pf.pathTo(tile);
      out.push({
        a: Math.min(hub.id, id), b: Math.max(hub.id, id), cost: pf.costTo(tile), path,
        sea: path.some((t) => map.elevation[t] < 0), volume: old.get(key) ?? 0, hub: true, kind: 'internal',
      });
    }
  }
  world.hubLinks = out;
  world.hubsDirty = false;
  world.lastHubBuild = world.year;
}

/** Settlement-level trade happens only inside a nation; foreign goods travel with caravans and convoys. */
export function linkKind(A: Settlement, B: Settlement): TradeLink['kind'] {
  return A.polityId === B.polityId ? 'internal' : 'closed';
}

/** Whether a nation's people pay in coin (after Currency) or barter goods for goods. */
export function usesCoin(p: Polity): boolean {
  return p.techs.has('currency');
}

/**
 * Internal trade: the everyday exchange between a nation's own towns and villages, along
 * neighbour roads and the roads to the nation's hub. Goods flow from where they are plentiful
 * to where they are needed. Before coinage it is barter — clumsier, so less of it happens.
 * The traffic it carries is what builds the nation's roads.
 */
export function runTrade(world: World): void {
  for (const p of world.alivePolities()) p.imported.fill(0);
  for (const s of world.aliveSettlements()) {
    s.tradeByKind = { internal: 0, caravan: 0, convoy: 0 };
    s.lastPrice.set(s.price);
  }
  const all = [...world.links, ...world.hubLinks];
  const order = all.map((_, i) => i);
  world.rng.shuffle(order);
  let total = 0;
  for (const idx of order) {
    const link = all[idx];
    const A = world.settlements[link.a];
    const B = world.settlements[link.b];
    link.volume *= 0.5;
    if (!A.alive || !B.alive) continue;
    link.kind = linkKind(A, B);
    if (link.kind === 'closed') continue;
    // A town cut off from its capital cannot trade with the rest of the nation across enemy lines.
    if (A.connected !== B.connected) continue;
    const pa = world.polities[A.polityId];
    const ca = world.cultures[A.cultureId];
    const cb = world.cultures[B.cultureId];
    const coin = usesCoin(pa);
    const eff = pa.effects.tradeEff;
    const merc = (ca.values.mercantilism + cb.values.mercantilism) / 2;
    const traitBonus = 1 + (ca.traitEffects.tradeCapacity + cb.traitEffects.tradeCapacity) / 2;
    const transport = (link.cost * 0.008) / (1 + eff);
    const size = Math.sqrt(A.pop * B.pop);
    let capacity = (40 + size * 0.45) * (1 + eff) * (0.7 + merc * 0.6) * (link.hub ? 1.3 : 1) * traitBonus * (coin ? 1 : 0.7);
    let volume = 0;
    const start = world.rng.int(0, GOOD_COUNT - 1);
    for (let n = 0; n < GOOD_COUNT && capacity > 0; n++) {
      const g = TRADE_GOODS[(start + n) % GOOD_COUNT];
      let src: Settlement;
      let dst: Settlement;
      if (B.price[g] > A.price[g] * (1 + transport) + 0.02) {
        src = A;
        dst = B;
      } else if (A.price[g] > B.price[g] * (1 + transport) + 0.02) {
        src = B;
        dst = A;
      } else continue;
      const surplus = Math.max(0, src.stock[g] - src.target[g] * 0.6);
      const want = Math.max(0, dst.target[g] * 1.3 - dst.stock[g]);
      let q = Math.min(surplus, want) * 0.5;
      q = Math.min(q, capacity / GOOD_BASE_PRICE[g]);
      if (q < 0.05) continue;
      const margin = dst.price[g] - src.price[g] * (1 + transport);
      src.stock[g] -= q;
      dst.stock[g] += q;
      src.exported[g] += q;
      dst.imported[g] += q;
      const value = q * GOOD_BASE_PRICE[g];
      capacity -= value;
      volume += value;
      const profit = q * margin;
      src.wealth += profit * 0.6 + value * 0.05;
      dst.wealth += profit * 0.4;
      src.tradeByKind.internal += value;
      dst.tradeByKind.internal += value;
      reprice(src, g);
      reprice(dst, g);
    }
    link.volume += volume;
    total += volume;
    if (coin) world.coinTrade += volume;
    else world.barterTrade += volume;
  }
  world.tradeVolume = total;
  // Traffic wears roads into the land; the roads to the hub carry the most.
  const traffic = world.map.traffic;
  for (const link of all) {
    if (link.volume <= 0 || link.kind !== 'internal') continue;
    const w = link.hub ? link.volume * 2 : link.volume;
    for (const t of link.path) traffic[t] += w;
  }
}

const TRIBUTE_RATE = { tribe: 0, chiefdom: 0.05, 'city-state': 0.04, kingdom: 0.08, empire: 0.11, republic: 0.05, theocracy: 0.09 };

/**
 * Rents, tithes and taxes in kind: the countryside sends part of its harvest to the seat of
 * power, feeding a capital far larger than its own fields could, and freeing its people for
 * crafts, trade and government. Some is lost on the road.
 */
export function runTribute(world: World): void {
  for (const p of world.alivePolities()) {
    const rate = TRIBUTE_RATE[p.government];
    if (rate <= 0 || p.settlementIds.length < 2) continue;
    const capital = world.settlements[p.capitalId];
    if (!capital.alive) continue;
    capital.tributeIn = 0;
    for (const id of p.settlementIds) {
      if (id === capital.id) continue;
      const s = world.settlements[id];
      if (!s.connected) continue;
      const d = Math.hypot(s.x - capital.x, s.y - capital.y);
      const reach = Math.max(0, 1 - d / (25 + p.effects.roads * 10 + p.effects.seaTravel * 5));
      if (reach <= 0) continue;
      const q = Math.min(s.stock[Good.Food] * 0.3, s.produced[Good.Food] * rate * s.stability);
      if (q <= 0) continue;
      s.stock[Good.Food] -= q;
      s.exported[Good.Food] += q;
      capital.stock[Good.Food] += q * reach;
      capital.imported[Good.Food] += q * reach;
      capital.tributeIn += q * reach;
    }
    reprice(capital, Good.Food);
  }
}

export function reprice(s: Settlement, g: Good): void {
  const e = Math.max(0.5, s.target[g] * 0.05);
  const ratio = (s.target[g] + e) / (s.stock[g] + e);
  s.price[g] = GOOD_BASE_PRICE[g] * Math.pow(Math.min(5, Math.max(0.2, ratio)), 0.8);
}
