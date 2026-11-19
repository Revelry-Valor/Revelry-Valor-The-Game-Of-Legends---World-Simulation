import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { acceptance, cultureChangeYear, type ChangeContext } from '../src/sim/cultureChange';
import { newEconomy } from '../src/sim/economy';
import { buildEnv, type Env } from '../src/sim/env';
import { addDawnCity, newSim } from '../src/sim/sim';
import { familyOf, SISTER_YEARS } from '../src/sim/sister';
import type { Settlement, SimState } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 45, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });

let env: Env;
let lib: Library;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
  lib = defaultLibrary();
}, 60000);

const at = (k: number) => ({ x: env.x0 + (k % env.w) * env.step, y: env.y0 + Math.floor(k / env.w) * env.step });
const ctx = (sim: SimState): ChangeContext => ({ sim, lib, rand: () => 0.5, dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by), log: (text, x, y) => sim.events.push({ day: sim.day, text, x, y }) });
const humanId = () => lib.species.find((s) => s.name === 'Human')!.races[0].id;
const town = (sim: SimState, city: Settlement, k: number, pop: number): Settlement => {
  const p = at(k);
  const st: Settlement = { id: sim.nextId++, name: `T${sim.nextId}`, kind: 'town', clan: city.clan, species: city.species, race: city.race, culture: city.culture, x: p.x, y: p.y, pop, fed: 1, warband: 50, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(pop, 1, 3), techs: [] };
  sim.settlements.push(st);
  return st;
};
const ways = (...ids: string[]) => ids.map((id) => ({ id, change: 'add' as const, level: 0, progress: 0 }));

/** A culture of an inland heartland (a city and two towns) and two ports near each other, far from it. */
function world(seed: number) {
  const sim = newSim(env, seed);
  const inland = [...env.land.keys()].filter((k) => env.land[k] && !env.coast[k] && env.mzone[k] === 0);
  const mid = inland.sort((a, b) => Math.hypot(at(a).x - 1500, at(a).y - 1000) - Math.hypot(at(b).x - 1500, at(b).y - 1000))[0];
  const city = addDawnCity(sim, env, lib, humanId(), at(mid).x, at(mid).y, 3000, ['agriculture'])!;
  town(sim, city, mid + 3, 2000);
  town(sim, city, mid + 3 * env.w, 2000);
  const coasts = [...env.coast.keys()].filter((k) => env.coast[k] && env.land[k]);
  const a = coasts[0];
  const b = coasts.find((k) => {
    const d = Math.hypot(at(k).x - at(a).x, at(k).y - at(a).y);
    return d > 40 && d < 200;
  })!;
  const ports = [town(sim, city, a, 900), town(sim, city, b, 700)];
  return { sim, city, ports, cult: sim.cultures!.find((c) => c.id === city.culture)! };
}

describe('sister cultures (regional cultures step 3)', () => {
  it('lets a region long living its own way become a sister culture of the same family', () => {
    const { sim, city, ports, cult } = world(1);
    cult.traditions = cult.traditions.filter((t) => t.id !== 'seafaring' && t.id !== 'traders');
    for (const p of ports) p.local = ways('seafaring', 'traders');
    // A village joined to the first port goes with it.
    const v = town(sim, ports[0], [...env.coast.keys()].find((k) => env.coast[k] && env.land[k])! + 1, 100);
    v.kind = 'village';
    v.partOf = ports[0].id;
    for (let y = 0; y < SISTER_YEARS - 1; y++) cultureChangeYear(ctx(sim));
    expect(ports.every((p) => p.culture === cult.id)).toBe(true);
    cultureChangeYear(ctx(sim));
    const sis = sim.cultures!.find((q) => q.id === ports[0].culture)!;
    expect(sis.id).not.toBe(cult.id);
    expect(ports[1].culture).toBe(sis.id);
    expect(v.culture).toBe(sis.id);
    expect(city.culture).toBe(cult.id);
    // Its parent's ways, with the region's changes its own.
    expect(sis.parent).toBe(cult.id);
    expect(sis.sister).toEqual(['+seafaring', '+traders']);
    expect(sis.traditions.map((t) => t.id)).toEqual(expect.arrayContaining(['seafaring', 'traders']));
    expect(ports.every((p) => !(p.local ?? []).length)).toBe(true);
    expect(acceptance(sim, sis.id, cult.id)).toBeGreaterThanOrEqual(0.45);
    expect(sim.events.some((e) => e.text.includes(`a sister culture of the ${cult.name}`))).toBe(true);
    const fam = familyOf(sim.cultures!, sis);
    expect(fam.root).toBe(cult);
    expect(fam.kin).toContain(cult);
  });

  it('does not split off a town alone, towns sharing only one change, or a region that is most of the culture', () => {
    // Only one shared change.
    const one = world(2);
    one.ports[0].local = ways('seafaring', 'traders');
    one.ports[1].local = ways('seafaring', 'miners');
    for (let y = 0; y < SISTER_YEARS + 5; y++) cultureChangeYear(ctx(one.sim));
    expect(one.ports.every((p) => p.culture === one.cult.id)).toBe(true);
    // One town alone.
    const alone = world(3);
    alone.ports[0].local = ways('seafaring', 'traders');
    for (let y = 0; y < SISTER_YEARS + 5; y++) cultureChangeYear(ctx(alone.sim));
    expect(alone.ports[0].culture).toBe(alone.cult.id);
    // Most of the culture: it is the culture's own way then (its core follows it), not a split.
    const most = world(4);
    for (const p of most.ports) {
      p.pop = 6000;
      p.local = ways('seafaring', 'traders');
    }
    for (let y = 0; y < SISTER_YEARS + 5; y++) cultureChangeYear(ctx(most.sim));
    expect(most.ports.every((p) => p.culture === most.cult.id)).toBe(true);
    // Years apart wear off when a town no longer lives its own way.
    one.ports[0].local = [];
    cultureChangeYear(ctx(one.sim));
    expect(one.ports[0].apart).toBe(SISTER_YEARS + 3);
  });
});
