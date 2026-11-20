import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import type { Library } from '../src/core/library';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { cultureTick } from '../src/sim/culturetick';
import { newEconomy } from '../src/sim/economy';
import { buildEnv, type Env } from '../src/sim/env';
import { acceptedBy, identityYear, identitySummary, peopleLoyalty, type IdentityContext } from '../src/sim/identity';
import { provAt } from '../src/sim/land';
import { popsOf, sharesOf, type Pop } from '../src/sim/pops';
import { addDawnCity, newSim, settlementTier } from '../src/sim/sim';
import type { Clan, LiveCulture, Realm, Settlement, SimState } from '../src/sim/state';

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
const humanId = () => lib.species.find((s) => s.name === 'Human')!.races[0].id;
const pop = (o: Partial<Pop>): Pop => ({ race: 'h', culture: 'rome', language: 'Latin', faith: '', cls: 'commoner', n: 100, ...o });

/** A realm of the Romans with one town, its people as given. */
function world(pops: Pop[], o: { enforce?: number; accept?: number; control?: number; dist?: number; kin?: boolean } = {}) {
  const sim = newSim(env, 1) as SimState;
  const base = { source: '', species: [], races: [], sounds: '', ethos: '', martial: '', lifestyles: [], traditions: [], specialties: [], behaviours: [], founded: 0, parent: '' };
  sim.cultures = [{ ...base, id: 'rome', name: 'Roman', language: 'Latin' }, { ...base, id: 'celt', name: 'Celtic', language: 'Celtic' }] as LiveCulture[];
  const realm = { gov: 'kingdom', since: 0, capital: -1, centralization: 0.5, ruler: { name: 'R', house: 'H', female: false, born: 0, since: 0 }, reigns: 1 } as Realm;
  const clan = { id: 1, name: 'Rome', colour: '', species: '', race: 'h', culture: 'rome', founded: 0, parent: -1, techs: [], realm } as Clan;
  sim.clans = [clan];
  const st: Settlement = { id: 10, name: 'Alesia', kind: 'village', clan: 1, species: '', race: 'h', culture: 'rome', x: 1500, y: 1000, pop: 0, fed: 1, warband: 10, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(100, 1, 3), techs: [], control: o.control ?? 1, pops };
  st.pop = pops.reduce((n, q) => n + q.n, 0);
  sim.settlements = [st];
  if (o.kin) {
    const kin = { ...clan, id: 2, culture: 'celt', realm: { ...realm } } as Clan;
    sim.clans.push(kin);
    sim.settlements.push({ ...st, id: 11, clan: 2, culture: 'celt', x: 1600, pops: [pop({ culture: 'celt', n: 500 })] });
  }
  const c: IdentityContext = {
    sim,
    enforce: () => o.enforce ?? 0.5,
    acceptance: (a, b) => (a === b ? 1 : o.accept ?? 0),
    faithAgainst: () => 0,
    coreDistance: () => o.dist ?? 0,
    atWar: () => false,
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  };
  return { sim, st, clan, c };
}
const run = (c: IdentityContext, years = 30) => {
  for (let y = 0; y < years; y++) {
    identityYear(c);
    c.sim.day += 360;
  }
};
const of = (st: Settlement, culture: string) => st.pops!.find((q) => q.culture === culture)!;

describe('national identity, grievance and stance (cultures as peoples, step 6)', () => {
  it('accepts the cultures a realm holds close, and gives each minority a stance by tolerance and its own strength', () => {
    // Pressed hard, a small minority is marginalized; a big one keeps apart.
    const small = world([pop({ n: 900 }), pop({ culture: 'celt', language: 'Celtic', n: 100 })], { enforce: 1 });
    run(small.c, 1);
    expect(of(small.st, 'celt').stance).toBe('marginalized');
    expect(of(small.st, 'rome').stance).toBeUndefined();
    const big = world([pop({ n: 400 }), pop({ culture: 'celt', language: 'Celtic', n: 600 })], { enforce: 1 });
    run(big.c, 1);
    expect(of(big.st, 'celt').stance).toBe('separate');
    // Held close (accepted): the small assimilate, the big integrate.
    const okSmall = world([pop({ n: 900 }), pop({ culture: 'celt', language: 'Celtic', n: 100 })], { enforce: 1, accept: 0.6 });
    run(okSmall.c, 1);
    expect(acceptedBy(okSmall.c, okSmall.clan)).toEqual(['rome', 'celt']);
    expect(okSmall.clan.realm!.accepted).toEqual(['celt']);
    expect(of(okSmall.st, 'celt').stance).toBe('assimilate');
    const okBig = world([pop({ n: 400 }), pop({ culture: 'celt', language: 'Celtic', n: 600 })], { enforce: 1, accept: 0.6 });
    run(okBig.c, 1);
    expect(of(okBig.st, 'celt').stance).toBe('integrate');
  });

  it('builds grievance from forced customs and hunger, and national identity from the realm’s reach, lowered by distance and kin across the border', () => {
    const w = world([pop({ n: 600 }), pop({ culture: 'celt', language: 'Celtic', n: 400 })], { enforce: 1 });
    run(w.c);
    expect(of(w.st, 'celt').grievance!).toBeGreaterThan(of(w.st, 'rome').grievance! + 0.2);
    expect(of(w.st, 'rome').identity!).toBeGreaterThan(of(w.st, 'celt').identity!);
    w.st.fed = 0.5;
    const was = of(w.st, 'rome').grievance!;
    run(w.c, 5);
    expect(of(w.st, 'rome').grievance!).toBeGreaterThan(was + 0.15);
    // Far from its heartland, and with a Celtic realm next door.
    const near = world([pop({ culture: 'celt', language: 'Celtic', n: 500 }), pop({ n: 500 })], { enforce: 0.3, control: 0.8 });
    const far = world([pop({ culture: 'celt', language: 'Celtic', n: 500 }), pop({ n: 500 })], { enforce: 0.3, control: 0.8, dist: 0.6, kin: true });
    run(near.c, 60);
    run(far.c, 60);
    expect(of(far.st, 'celt').identity!).toBeLessThan(of(near.st, 'celt').identity! - 0.15);
  });

  it('costs a town loyalty for grievances and its marginalized, and shows its people in brief', () => {
    const calm = world([pop({ n: 1000 })], { enforce: 0.3 });
    run(calm.c);
    const tense = world([pop({ n: 700 }), pop({ culture: 'celt', language: 'Celtic', n: 300 })], { enforce: 1 });
    tense.st.fed = 0.6;
    run(tense.c);
    expect(peopleLoyalty(tense.st)).toBeLessThan(peopleLoyalty(calm.st) - 0.1);
    expect(identitySummary(tense.st, (id) => (id === 'celt' ? 'Celtic' : 'Roman'))).toMatch(/Belonging to the realm \d+%, grievance \d+%; 30% Celtic marginalized/);
  });

  it('lets an assimilating people take up the realm’s ways faster than one keeping apart', () => {
    const shift = (stance: Pop['stance']) => {
      const sim = newSim(env, 2);
      const rome = addDawnCity(sim, env, lib, humanId(), 1500, 1000, 6000, ['agriculture'])!;
      popsOf(sim, rome);
      const cu = sim.cultures!.find((q) => q.id === rome.culture)!;
      sim.cultures!.push({ ...structuredClone(cu), id: 'celt', name: 'Celtic', language: 'Celtic' });
      const st: Settlement = { id: sim.nextId++, name: 'Alesia', kind: 'village', clan: rome.clan, species: rome.species, race: rome.race, culture: 'celt', x: 1540, y: 1000, pop: 500, fed: 1, warband: 10, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, economy: newEconomy(500, 1, 3), techs: [], pops: [{ race: rome.race, culture: 'celt', language: 'Celtic', faith: '', cls: 'commoner', n: 500, stance }] };
      sim.settlements.push(st);
      const tc = { sim, env, lib, provAt: (x: number, y: number) => provAt(env, x, y), tier: (q: Settlement) => settlementTier(q), enforce: () => 0, capital: (q: Settlement) => q.kind === 'dawn', log: () => {} };
      for (let t = 0; t < 3; t++) cultureTick(tc);
      return sharesOf(st.pops!, 'culture').find(([k]) => k === rome.culture)?.[1] ?? 0;
    };
    expect(shift('assimilate')).toBeGreaterThan(shift('separate') * 2);
  });
});
