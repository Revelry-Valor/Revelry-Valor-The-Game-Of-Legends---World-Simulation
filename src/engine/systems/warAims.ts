import { GOOD_COUNT, GOOD_NAMES } from '../data/economy';
import type { Polity, Settlement } from '../types';
import type { World } from '../world';

/** Claims fade: after this many years a lost town is no longer thought of as rightfully one's own. */
export const CLAIM_YEARS = 150;

export interface Valuation {
  value: number;
  /** The strongest reason, for the chronicle. */
  reason: string;
  claim: boolean;
}

/** How strong `p`'s claim on a settlement it once held is, 0..1. */
export function claimStrength(world: World, p: number, s: Settlement): number {
  const lost = s.claims[p];
  if (lost === undefined) return 0;
  return Math.max(0, 1 - (world.year - lost) / CLAIM_YEARS);
}

/**
 * What a settlement is worth to a nation that might take it: its people and wealth, a claim
 * from having held it before, kinsfolk living there, goods the nation is short of, the way it
 * would join up or reconnect the nation's lands, the trade that passes through it, and whether
 * it is the enemy's seat of power. Towns far from the nation's own lands are worth less.
 */
export function settlementValue(world: World, p: Polity, s: Settlement): Valuation {
  const owner = world.polities[s.polityId];
  const reasons: [number, string][] = [];
  let value = Math.sqrt(s.pop) * 0.35 + Math.sqrt(Math.max(0, s.wealth)) * 0.08;
  const claim = claimStrength(world, p.id, s);
  if (claim > 0) reasons.push([15 + 30 * claim, `its claim to ${s.name}, lost in year ${s.claims[p.id]}`]);
  if (s.cultureId === p.cultureId && owner.cultureId !== p.cultureId) reasons.push([14, `the ${world.cultures[s.cultureId].adjective} kinsfolk of ${s.name} living under foreign rule`]);
  // Goods the nation lacks and this town has to spare.
  let res = 0;
  const wanted: string[] = [];
  for (let g = 0; g < GOOD_COUNT; g++) {
    if (!p.deficit[g] || s.produced[g] < s.target[g] * 1.1 + 1) continue;
    res += 8;
    wanted.push(GOOD_NAMES[g].toLowerCase());
  }
  if (res) reasons.push([Math.min(24, res), `the ${wanted.slice(0, 2).join(' and ')} of ${s.name}`]);
  // Joining up the nation's lands: many of its own towns nearby, or cut-off towns it could reach again.
  let near = 0;
  let stranded = 0;
  let nearest = Infinity;
  for (const id of p.settlementIds) {
    const o = world.settlements[id];
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    nearest = Math.min(nearest, d);
    if (d < 10) {
      near++;
      if (!o.connected) stranded++;
    }
  }
  if (stranded) reasons.push([12 + stranded * 6, `the need to reach its cut-off towns beyond ${s.name}`]);
  if (near >= 2) reasons.push([Math.min(16, near * 4), `the borderland of ${s.name}, wedged among its towns`]);
  // Trade: towns that sit on the caravan roads, the rival's market hub, a first harbour.
  const trade = Math.min(15, (s.transit / (s.pop * 0.3 + 20)) * 10) + (owner.hubId === s.id ? 8 : 0);
  if (s.coastal && !p.settlementIds.some((id) => world.settlements[id].coastal)) reasons.push([10, `a harbour at ${s.name}`]);
  if (trade > 4) reasons.push([trade, `control of the trade road through ${s.name}`]);
  if (owner.capitalId === s.id) value += 10;
  for (const [v] of reasons) value += v;
  // Distance and defences cut the value.
  value -= Math.max(0, nearest - 6) * 0.9;
  value /= 1 + owner.effects.defense * 0.5;
  reasons.sort((a, b) => b[0] - a[0]);
  return { value, reason: reasons[0]?.[1] ?? '', claim: claim > 0 };
}

/** The settlement of `target` most worth fighting `p` for. */
export function bestGoal(world: World, p: Polity, target: Polity): { settlement: Settlement; val: Valuation } | null {
  let best: { settlement: Settlement; val: Valuation } | null = null;
  for (const id of target.settlementIds) {
    const s = world.settlements[id];
    if (!s.alive) continue;
    if (s.landmass !== world.settlements[p.capitalId].landmass && p.effects.seaTravel < 1) continue;
    const val = settlementValue(world, p, s);
    if (!best || val.value > best.val.value) best = { settlement: s, val };
  }
  return best;
}
