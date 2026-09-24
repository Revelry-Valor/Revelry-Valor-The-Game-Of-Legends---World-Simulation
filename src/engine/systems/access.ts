import type { AccessPolicy, Polity, TradeAgreement } from '../types';
import type { World } from '../world';

export const POLICY_LABEL: Record<AccessPolicy, string> = {
  open: 'Open market',
  tolled: 'Tolled',
  transit: 'Passage only',
  closed: 'Closed',
};

/** Active agreements between two nations, optionally of one type. */
export function dealsBetween(world: World, a: number, b: number, type?: TradeAgreement['type']): TradeAgreement[] {
  const ids = world.polities[a]?.agreements.get(b) ?? [];
  return ids.map((id) => world.agreements[id]).filter((d) => d.end === null && (!type || d.type === type));
}

/** Transit rights `host` has granted `guest`. */
function transitGranted(world: World, host: number, guest: number): boolean {
  return dealsBetween(world, host, guest, 'transit').some((d) => d.a === host && d.b === guest);
}

/** How `host` treats traders from `guest`. */
export function accessPolicy(world: World, host: Polity, guest: Polity): AccessPolicy {
  if (host.id === guest.id) return 'open';
  if (world.atWar(host.id, guest.id)) return 'closed';
  if (dealsBetween(world, host.id, guest.id, 'market').length) return 'open';
  const base = host.policy.get(guest.id) ?? 'tolled';
  if (base === 'closed' && transitGranted(world, host.id, guest.id)) return 'transit';
  return base;
}

/** May `guest`'s traders buy and sell in `host`'s towns? */
export function canTradeIn(world: World, host: Polity, guest: Polity): boolean {
  if (host.id === guest.id) return true;
  if (host.embargoes.has(guest.id)) return false;
  const p = accessPolicy(world, host, guest);
  return p === 'open' || p === 'tolled';
}

/** Share of a sale (or of goods in transit) taken by `host` from `guest`'s traders. */
export function tollRate(world: World, host: Polity, guest: Polity, passingThrough: boolean): number {
  const p = accessPolicy(world, host, guest);
  if (p === 'open') return 0;
  return passingThrough ? host.tariff * 0.3 : host.tariff;
}

/**
 * A tile filter for pathfinding: traders of `guest` cannot enter lands closed to them, nor
 * cross a nation that embargoes the nation they are heading for.
 */
export function passable(world: World, guest: Polity, destPolity = -1): (tile: number) => boolean {
  const map = world.map;
  const cache = new Map<number, boolean>();
  return (tile) => {
    const o = map.owner[tile];
    if (o < 0) return true;
    const pid = world.settlements[o].polityId;
    if (pid === guest.id || pid === destPolity) return true;
    let ok = cache.get(pid);
    if (ok === undefined) {
      const host = world.polities[pid];
      ok = accessPolicy(world, host, guest) !== 'closed' && !(destPolity >= 0 && host.embargoes.has(destPolity));
      cache.set(pid, ok);
    }
    return ok;
  };
}

/**
 * Each year nations decide how to treat each other's traders: welcome at a toll, allowed to pass
 * but not to trade, or shut out entirely; and they embargo trade bound for their enemies.
 */
export function updatePolicies(world: World, pairs: [number, number][]): void {
  for (const p of world.alivePolities()) p.embargoes.clear();
  for (const [a, b] of pairs) {
    for (const [h, g] of [[a, b], [b, a]]) {
      const host = world.polities[h];
      const rel = host.relations.get(g) ?? 0;
      const war = world.atWar(h, g);
      const prev = host.policy.get(g) ?? 'tolled';
      // Hysteresis: a policy only changes once relations clearly cross the line.
      const m = 0.05;
      const closedAt = prev === 'closed' ? -0.6 + m : -0.6 - m;
      const transitAt = prev === 'tolled' ? -0.35 - m : -0.35 + m;
      const next: AccessPolicy = war || rel < closedAt ? 'closed' : rel < transitAt ? 'transit' : 'tolled';
      if (next !== prev) {
        host.policy.set(g, next);
        const guest = world.polities[g];
        const key = `border:${h}:${g}:${Math.floor(world.year / 30)}`;
        if (!war && host.pop > 15000 && guest.pop > 15000 && !world.flags.has(key)) {
          world.flags.add(key);
          if (next === 'closed') world.log('agreement', 2, `The ${host.name} closed its borders to the traders of the ${guest.name}.`, { polities: [h, g] });
          else if (prev === 'closed') world.log('agreement', 1, `The ${host.name} reopened its roads to the merchants of the ${guest.name}.`, { polities: [h, g] });
        }
      }
      if (war || rel < -0.55) host.embargoes.add(g);
    }
  }
}
