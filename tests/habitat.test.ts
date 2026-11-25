import { beforeAll, describe, expect, it } from 'vitest';
import { computeClimate } from '../src/core/climate';
import { defaultLibrary } from '../src/core/libstore';
import { parseLibraryFile, libraryFile } from '../src/core/libstore';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { altKmAt, altPos, ALT, COLD, DRY, fromTolerances, harshness, HEAT, limitAt, rainPos, readRange, skyPos, WET, widen, type Ranges } from '../src/core/habitat';
import { attraction } from '../src/sim/attraction';
import { buildEnv, type Env } from '../src/sim/env';
import { layerWays } from '../src/sim/layers';
import { childrenPerFamily, raceInfo, wantsOf } from '../src/sim/sim';

const settings = defaultSettings({ widthKm: 3000, heightKm: 2000, northLatitude: 60, seed: 12 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0.2, ...o } as Stroke);
add('land', [1500, 1000], { size: 2200, roughness: 0.1 });
let env: Env;
beforeAll(() => {
  env = buildEnv(computeClimate(surface, settings), defaultLibrary(), surface);
}, 60000);

/** The designer's example: Humans comfortable from sea level to the highlands, surviving up to the first sky layer. */
const human: Ranges = { temp: { min: -20, lo: -5, hi: 30, max: 38 }, rain: { min: 1, lo: 3, hi: 6, max: 7 }, alt: { min: 0, lo: 0, hi: 3, max: skyPos(1) } };
const place = (o: Partial<{ hot: number; cold: number; wetSeason: number; drySeason: number; heightKm: number; altPos: number }>) => ({ hot: 20, cold: 5, wetSeason: 0.35, drySeason: 0.35, heightKm: 0.1, ...o });

describe('habitat ranges (the Library’s four-dot sliders)', () => {
  it('is easy inside the comfortable range, harder out toward the survivable limit, much harder past it', () => {
    const easy = harshness(human, place({}));
    expect(easy.past).toBe(0);
    expect(easy.comfortable).toBe(true);
    // High mountains: between the highlands (comfort) and sky layer 1 (limit).
    const high = harshness(human, place({ heightKm: altKmAt(4) }));
    expect(high.past).toBeCloseTo(0.5 * (4 - 3) / (skyPos(1) - 3), 5);
    expect(high.comfortable).toBe(false);
    // At the limit, half as hard as it gets before it; past it, much harder.
    const limit = harshness(human, place({ altPos: skyPos(1) }));
    expect(limit.past).toBeCloseTo(0.5, 5);
    const beyond = harshness(human, place({ altPos: skyPos(2) }));
    expect(beyond.past).toBeGreaterThan(1.5);
    expect(beyond.harsh).toContain('too high');
    expect(beyond.over.altitude).toBeGreaterThan(0);
    // Too cold, too hot, too dry, too wet, each the same way.
    expect(harshness(human, place({ cold: -12 })).past).toBeCloseTo(0.5 * 7 / 15, 5);
    expect(harshness(human, place({ hot: 44 })).past).toBeCloseTo(0.5 + 6 / 6, 5);
    expect(harshness(human, place({ wetSeason: 0.06 })).harsh).toContain('too dry');
    expect(harshness(human, place({ drySeason: 1.3 })).harsh).toContain('too wet');
  });

  it('gives a race nobody has redrawn exactly the life it had under its old 1–5 tolerances', () => {
    for (const lv of [1, 3, 5]) {
      const t = { heat: lv, cold: lv, wet: lv, dry: lv, altitude: lv };
      const r = fromTolerances(t);
      for (const p of [place({ hot: 40 }), place({ cold: -30 }), place({ wetSeason: 0.04 }), place({ drySeason: 2.5 }), place({ heightKm: 4.2 }), place({})]) {
        let old = 0;
        old += Math.max(0, p.hot - limitAt(HEAT, lv)) / 6;
        old += Math.max(0, limitAt(COLD, lv) - p.cold) / 8;
        old += Math.max(0, limitAt(DRY, lv) - p.wetSeason) / 0.08;
        old += Math.max(0, p.drySeason - limitAt(WET, lv)) / 0.3;
        old += Math.max(0, p.heightKm - limitAt(ALT, lv)) / 0.7;
        expect(harshness(r, p).past).toBeCloseTo(old, 4);
      }
    }
    // And the scales read back the values they were built from.
    expect(altPos(1.6)).toBeCloseTo(3, 6);
    expect(rainPos(0.6)).toBeCloseTo(5, 6);
  });

  it('keeps a saved range in order and on its scale, and saves and loads it with the library', () => {
    expect(readRange({ min: 3, lo: 1, hi: 2, max: 0 }, 'alt')).toEqual({ min: 3, lo: 3, hi: 3, max: 3 });
    expect(readRange({ min: -99, lo: 0, hi: 10, max: 99 }, 'temp')).toEqual({ min: -50, lo: 0, hi: 10, max: 50 });
    expect(readRange({ min: 0 }, 'rain')).toBeNull();
    const lib = defaultLibrary();
    const sp = lib.species.find((q) => q.name === 'Human')!;
    sp.races[0].living.ranges = { alt: human.alt };
    sp.profile.ranges = { temp: human.temp };
    const back = parseLibraryFile(libraryFile(lib));
    const sp2 = back.species.find((q) => q.name === 'Human')!;
    expect(sp2.races[0].living.ranges.alt).toEqual(human.alt);
    expect(sp2.profile.ranges.temp).toEqual(human.temp);
  });

  it('uses a race’s drawn ranges (else its species’), widened by its traits; draws it to places it is comfortable in', () => {
    const lib = defaultLibrary();
    const sp = lib.species.find((q) => q.name === 'Human')!;
    const race = sp.races.find((r) => r.name === 'Human')!;
    const before = wantsOf(env, raceInfo(lib, race.id)!);
    expect(before.ranges).toBeUndefined();
    sp.profile.ranges = { temp: human.temp };
    race.living.ranges = { alt: human.alt };
    const w = wantsOf(env, raceInfo(lib, race.id)!);
    expect(w.drawn).toBe(true);
    expect(w.ranges!.alt).toEqual(human.alt);
    expect(w.ranges!.temp).toEqual(human.temp);
    // Rain not drawn: from the tolerances, as before.
    expect(w.ranges!.rain).toEqual(fromTolerances(before.tolerances).rain);
    // Cold-adapted (cold +2, heat −1): the cold limits move two steps out, the hot ones one in.
    race.addTraits.push('cold-adapted');
    const c = wantsOf(env, raceInfo(lib, race.id)!).ranges!.temp;
    expect(widen({ ...w.ranges! }, { cold: 2, heat: -1 }).temp).toEqual(c);
    expect(c.min).toBeLessThan(human.temp.min);
    // A comfortable place draws it more than an uncomfortable one, other things alike.
    const k = [...env.land.keys()].find((q) => env.land[q])!;
    const cosy = attraction(env, { ...w, water: 'None', passable: () => true, ranges: { ...w.ranges!, temp: { min: -60, lo: -60, hi: 60, max: 60 }, rain: { min: 0, lo: 0, hi: 8, max: 8 }, alt: { min: 0, lo: 0, hi: 8, max: 8 } } }, k);
    const edgy = attraction(env, { ...w, water: 'None', passable: () => true, ranges: { ...w.ranges!, temp: { min: -60, lo: 59, hi: 60, max: 60 }, rain: { min: 0, lo: 0, hi: 8, max: 8 }, alt: { min: 0, lo: 0, hi: 8, max: 8 } } }, k);
    expect(cosy.prefer).toBeGreaterThan(edgy.prefer);
  });

  it('lets a race live on the sky layers its altitude range reaches', () => {
    const lib = defaultLibrary();
    const sp = lib.species.find((q) => q.name === 'Human')!;
    const race = sp.races[0];
    expect(layerWays(lib, sp, race).alt).toBeUndefined();
    race.living.ranges = { alt: { min: 0, lo: 0, hi: skyPos(1), max: skyPos(2) } };
    const lw = layerWays(lib, sp, race);
    expect(lw.sky).toBe(true);
    expect(lw.alt!.max).toBe(skyPos(2));
  });
});

describe('children per family (the Library’s Life section)', () => {
  it('births a year are deaths a year times children per family over two; blank, as before', () => {
    const lib = defaultLibrary();
    const sp = lib.species.find((q) => q.name === 'Human')!;
    const race = sp.races[0];
    const L = race.lifespan ?? 70;
    // Blank: by its size, exactly the old young-per-birth and years-between-births rule.
    sp.profile.children = null;
    expect(childrenPerFamily(sp.profile, 'Medium', L)).toBeCloseTo((0.128 * 0.8 * L) / Math.max(1, Math.min(40, L / 25)), 6);
    const fertile = (sp.traits.includes('fertile') && !race.removeTraits.includes('fertile')) || race.addTraits.includes('fertile') ? 1.4 : 1;
    expect(raceInfo(lib, race.id)!.births).toBeCloseTo((0.128 / Math.max(1, Math.min(40, L / 25))) * fertile, 6);
    // Two just replaces the parents.
    sp.profile.children = 2;
    const two = raceInfo(lib, race.id)!;
    expect(two.births / fertile).toBeCloseTo(two.deaths, 6);
    sp.profile.children = 5;
    expect(raceInfo(lib, race.id)!.births).toBeCloseTo(two.births * 2.5, 6);
  });
});
