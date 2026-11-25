import { describe, expect, it } from 'vitest';
import type { VillageSite } from '../src/sim/rural';
import type { Settlement, SimState } from '../src/sim/state';
import { exclusionFor, HYSTERESIS, MARKET, tierByPop, tierName, tierOf, TIERS, tiersYear, type TiersContext } from '../src/sim/tiers';

const town = (id: number, x: number, pop: number, o: Partial<Settlement> = {}): Settlement => ({ id, name: `T${id}`, kind: 'village', clan: 1, species: '', race: 'h', culture: 'c', x, y: 0, pop, fed: 1, warband: 0, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, techs: [], ...o });
/** A tiny world: settlements on a line, one farmed province (id 7) with village sites. */
function world(settlements: Settlement[], sites: VillageSite[] = [], o: { surplus?: number; water?: boolean } = {}) {
  const sim = { day: 360 * 50, settlements, clans: [], armies: [], sites: { '7': sites }, events: [] } as unknown as SimState;
  const founded: VillageSite[] = [];
  const unfounded: Settlement[] = [];
  const c: TiersContext = {
    sim,
    env: { prov: { ids: Int32Array.from([7]) } } as never,
    provAt: () => 0,
    waterFed: () => !!o.water,
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    farmed: () => true,
    surplus: () => o.surplus ?? 0,
    found: (site) => {
      founded.push(site);
      const st = town(100 + founded.length, site.x, site.pop, { name: site.name });
      sim.settlements.push(st);
      return st;
    },
    unfound: (st) => {
      unfounded.push(st);
      sim.settlements = sim.settlements.filter((q) => q !== st);
    },
    pinned: () => false,
    log: (text) => sim.events.push({ day: sim.day, text }),
  };
  return { sim, c, founded, unfounded };
}
const site = (id: number, x: number, pop: number): VillageSite => ({ id, name: `V${id}`, x, y: 0, pop, founded: 360 * 10, culture: 'c' });

describe('tiers and spacing (settlements and population, step 3)', () => {
  it('has six tiers, rising at each threshold and dropping only below 80% of it', () => {
    expect(TIERS.map((t) => t.name)).toEqual(['Hamlet', 'Village', 'Market town', 'Large town', 'City', 'Great city']);
    expect(tierByPop(50)).toBe(0);
    expect(tierByPop(600)).toBe(MARKET);
    expect(tierByPop(12000)).toBe(4);
    const st = town(1, 0, 600);
    const { c } = world([st]);
    tiersYear(c);
    expect(tierName(st)).toBe('Market town');
    st.pop = 450;
    tiersYear(c);
    expect(tierOf(st)).toBe(MARKET);
    st.pop = TIERS[MARKET].min * HYSTERESIS - 1;
    tiersYear(c);
    expect(tierName(st)).toBe('Village');
  });

  it('lets lower tiers pack round higher ones while equal ones keep apart; a water-fed city needs half the room', () => {
    const a = town(1, 0, 2500);
    const b = town(2, 20, 2600);
    const v = town(3, -15, 600);
    const w = town(4, 5, 600);
    const { c } = world([a, b, v, w]);
    tiersYear(c);
    // Within 30 km only one large town; a market town 15 km off is fine, but none within 10 km of another market or bigger (a large town holds a market too).
    expect([tierOf(a), tierOf(b)].sort()).toEqual([MARKET, 3]);
    expect(tierOf(v)).toBe(MARKET);
    expect(tierOf(w)).toBe(1);
    expect(exclusionFor(4, true)).toBe(exclusionFor(4, false) / 2);
  });

  it('grows a busy village site into a market town on its spot, keeping its name and story, where no market lies within 10 km', () => {
    const big = site(1, 50, 620);
    const mid = site(2, 80, 350);
    const { sim, c, founded } = world([town(1, 0, 3000)], [big, mid], { surplus: 0 });
    tiersYear(c);
    expect(founded).toEqual([big]);
    const st = sim.settlements.find((q) => q.name === 'V1')!;
    expect(st.x).toBe(50);
    expect(st.villageSince).toBe(360 * 10);
    expect(tierOf(st)).toBe(MARKET);
    expect(sim.sites!['7']).toEqual([mid]);
    expect(sim.events.some((e) => e.text === 'V1, a village since year 11, has grown into a market town.')).toBe(true);
    // A village of 300 with a surplus to feed a market grows into one too; a big village under a town's nose doesn't.
    const near = world([town(1, 0, 3000)], [site(3, 6, 900), site(4, 60, 320)], { surplus: 400 });
    tiersYear(near.c);
    expect(near.founded.map((q) => q.id)).toEqual([4]);
  });

  it('turns a settlement dwindled on farmed land back into a village site after five years', () => {
    const small = town(1, 0, 200);
    const capital = town(2, 40, 200, { kind: 'dawn' });
    const { c, unfounded } = world([small, capital]);
    for (let y = 0; y < 4; y++) tiersYear(c);
    expect(unfounded).toEqual([]);
    tiersYear(c);
    expect(unfounded).toEqual([small]);
  });
});
