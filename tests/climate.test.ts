import { beforeAll, describe, expect, it } from 'vitest';
import { freshWaters, geoCell, geoNames } from '../src/core/geography';
import { autoCoverName, cellEdges, climateAt, computeClimate, nearestPoint, rainClass, ZONE_INFO, type Climate } from '../src/core/climate';
import { brushDefaults, COVER_BRUSHES, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { cToF, defaultSettings, fToC, latitudeAt, southLatitude } from '../src/core/settings';
import { KM_PER_DEGREE } from '../src/core/units';

/** A test world: one wide continent from 50°N to 40°S with a western mountain range, in a wrapping ocean. */
const north = 70;
const settings = defaultSettings({ widthKm: 14000, heightKm: 130 * KM_PER_DEGREE, northLatitude: north, edges: 'wrap', seed: 7 });
const yAt = (lat: number) => (north - lat) * KM_PER_DEGREE;
const line = (pts: [number, number][], step = 80) => {
  const out: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let i = 0; i < n; i++) out.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n);
  }
  out.push(...pts[pts.length - 1]);
  return out;
};
const world = (extra: (add: (b: BrushId, pts: number[], o?: Partial<Stroke>) => void) => void = () => {}): Surface => {
  const s: Surface = { strokes: [], nextId: 1 };
  const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => {
    s.strokes.push({ ...brushDefaults(brush), id: s.nextId++, pts, roughness: 0.2, ...o } as Stroke);
  };
  // A continent 5,000 km wide, from 55°N to 35°S.
  add('land', line([[6000, yAt(50)], [6000, yAt(-30)]]), { size: 5000 });
  // A mountain range near the west coast, in the westerlies.
  add('mountains', line([[4900, yAt(52)], [4900, yAt(38)]], 30), { size: 300, strength: 1 });
  extra(add);
  return s;
};

let cl: Climate;
beforeAll(() => {
  cl = computeClimate(world(), settings);
}, 60000);

const at = (x: number, lat: number) => climateAt(cl, x, yAt(lat));
const sumRain = (x: number, lat: number) => {
  const c = at(x, lat);
  return c.summerRain + c.winterRain;
};

describe('settings for the climate', () => {
  it('puts the equator through the middle of a new flat map', () => {
    const s = defaultSettings();
    expect(s.northLatitude).toBeCloseTo(-southLatitude(s), 6);
    expect(latitudeAt(s, s.heightKm / 2)).toBeCloseTo(0, 6);
  });
  it('shows °F and stores °C', () => {
    expect(cToF(18)).toBeCloseTo(64.4, 5);
    expect(fToC(86)).toBeCloseTo(30, 5);
  });
  it('places the wind cells by day length', () => {
    expect(cellEdges(24, 15)).toEqual([30, 60]);
    expect(cellEdges(12, 15).length).toBe(4);
    expect(cellEdges(500, 15)).toEqual([70]);
  });
});

describe('the climate of a test continent', () => {
  it('is worked out on a grid of climate points', () => {
    expect(cl.w).toBeGreaterThan(50);
    expect(cl.w).toBeLessThanOrEqual(300);
    expect(cl.zone.some((z) => z >= 0 && z < ZONE_INFO.length)).toBe(true);
  });

  it('rains heavily near the equator inland, and is dry on the subtropical west coast', () => {
    // The trade winds bring sea air to the east coast; the rain belt crosses the interior twice a year.
    expect(rainClass(Math.max(at(7700, 0).summerRain, at(7700, 0).winterRain))).toBe(2);
    expect(rainClass(Math.min(at(6000, 0).summerRain, at(6000, 0).winterRain))).toBeGreaterThanOrEqual(1);
    expect([0, 1]).toContain(at(6000, 0).zone);
    // About 22°S on the west coast: under the subtropical high, beside a cold current.
    const west = at(4100, -22);
    expect(sumRain(4100, -22)).toBeLessThan(sumRain(7700, -22) / 4);
    expect([3, 5]).toContain(west.zone);
  });

  it('grows ground cover that fits each zone, everywhere on land', () => {
    const coverAt = (x: number, lat: number) => COVER_BRUSHES[cl.cover.main[nearestPoint(cl, x, yAt(lat))]];
    for (let k = 0; k < cl.zone.length; k++) expect(cl.cover.main[k] >= 0).toBe(cl.zone[k] >= 0);
    // The rain belt grows jungle; the dry subtropical west coast is desert or steppe.
    expect(coverAt(6000, 0)).toBe('jungle');
    expect(['dunes', 'rockdesert', 'steppe']).toContain(coverAt(4100, -22));
    expect(autoCoverName(cl, nearestPoint(cl, 6000, yAt(0)))).toMatch(/Jungle/);
    // Every zone's cover is one the zone allows.
    const allowed: string[][] = [['jungle'], ['jungle'], ['savanna'], ['dunes'], ['rockdesert'], ['steppe'], ['steppe'], ['scrub'], ['forest'], ['forest'], ['forest'], ['taiga'], ['tundra'], ['glacier']];
    for (let k = 0; k < cl.zone.length; k++) if (cl.zone[k] >= 0) expect(allowed[cl.zone[k]]).toContain(COVER_BRUSHES[cl.cover.main[k]]);
  });

  it('is hot at the equator and colder toward the poles', () => {
    expect(at(6000, 0).summerT).toBeGreaterThan(at(6000, 45).summerT);
    expect(at(6000, 0).winterT).toBeGreaterThan(20);
  });

  it('has a colder winter inland than on the coast at the same latitude', () => {
    const inland = at(6500, 47);
    const coast = at(4300, 47);
    expect(inland.winterT).toBeLessThan(coast.winterT);
    expect(inland.summerT - inland.winterT).toBeGreaterThan(coast.summerT - coast.winterT);
  });

  it('casts a rain shadow east of the mountains in the westerlies', () => {
    expect(sumRain(5400, 45)).toBeLessThan(sumRain(4500, 45) * 0.8);
  });

  it('pulls the tropical rain belt over land toward the tropic in summer', () => {
    const col = (x: number) => Math.round((x - cl.x0) / cl.step);
    const overLand = cl.summer.itcz[col(6000)];
    const overSea = cl.summer.itcz[col(500)];
    expect(overLand).toBeGreaterThan(overSea + 3);
    expect(overLand).toBeLessThanOrEqual(settings.axialTilt + 0.5);
    // In northern winter it swings south of the equator over the southern land.
    expect(cl.winter.itcz[col(6000)]).toBeLessThan(0);
  });

  it('freezes the sea at high latitudes in winter, not in the tropics', () => {
    // Warm currents can keep patches near the pole open (rule 11), so count rather than test one spot.
    let polar = 0;
    let polarIce = 0;
    let tropicIce = 0;
    for (let k = 0; k < cl.reef.length; k++) {
      if (cl.land[k]) continue;
      const la = cl.lat[(k / cl.w) | 0];
      if (la >= 62) {
        polar++;
        polarIce += cl.winter.ice[k];
      }
      if (Math.abs(la) < 25) tropicIce += cl.winter.ice[k];
    }
    expect(polarIce / polar).toBeGreaterThan(0.1);
    expect(tropicIce).toBe(0);
  });

  it('blows the winds as drawn, with a front where two run into each other', () => {
    const hc = computeClimate(
      world((add) => {
        add('wind', line([[9000, yAt(30)], [12800, yAt(30)]]), { strength: 0.8 });
        add('wind', line([[17000, yAt(30)], [13400, yAt(30)]]), { strength: 0.8 });
        add('high', [11000, yAt(35)], { strength: 0.6, size: 2000 });
      }),
      settings,
    );
    const k = (x: number, lat: number) => Math.floor(yAt(lat) / (settings.heightKm / hc.h)) * hc.w + Math.floor(x / hc.step);
    // Along the first wind it blows east, along the second west.
    expect(hc.summer.windU[k(10500, 30)]).toBeGreaterThan(1);
    expect(hc.summer.windU[k(15500, 30)]).toBeLessThan(-1);
    // Where they run into each other: a front; well away from both, none.
    expect(hc.summer.front[k(13100, 30)]).toBeGreaterThan(0.3);
    expect(hc.summer.front[k(11000, -20)]).toBeLessThan(0.2);
    // A placed high raises the pressure under it.
    expect(hc.summer.pressure[k(11000, 35)]).toBeGreaterThan(4);
    // Nothing drawn: no traced winds, no highs.
    expect(cl.summer.centres.length).toBe(0);
    expect(cl.summer.windPaths[0].length).toBe(0);
  }, 60000);

  it('carries a drawn wind on where its pieces touch, wets the windward side of a range and leaves its lee dry', () => {
    const wc = computeClimate(
      world((add) => {
        // A westerly onto the west coast, drawn in two pieces that touch over the range.
        add('wind', line([[300, yAt(45)], [4500, yAt(45)]]), { strength: 0.8 });
        add('wind', line([[4500, yAt(45)], [13500, yAt(45)]]), { strength: 0.8 });
      }),
      settings,
    );
    const k = (x: number, lat: number) => Math.floor(yAt(lat) / (settings.heightKm / wc.h)) * wc.w + Math.floor(x / wc.step);
    // Where the pieces touch it still blows east, about as strongly as along them.
    expect(wc.summer.windU[k(4500, 45)]).toBeGreaterThan(0.6 * wc.summer.windU[k(2000, 45)]);
    // The air carries moisture off the sea and spends it inland.
    expect(wc.summer.moist[k(1500, 45)]).toBeGreaterThan(wc.summer.moist[k(7500, 45)]);
    // Each place knows which drawn wind holds sway there.
    expect(wc.summer.windLine[k(2000, 45)]).toBeGreaterThan(0);
    const rain = (x: number) => (wc.summer.rain[k(x, 45)] + wc.winter.rain[k(x, 45)]) / 2;
    // Windward of the range (it runs at x 4,900) is wetter than far behind it.
    expect(rain(4500)).toBeGreaterThan(rain(5600) * 2);
  }, 60000);

  it('uses each season’s own currents, winds and highs', () => {
    const sc = computeClimate(
      world((add) => {
        add('current', line([[8900, yAt(10)], [8900, yAt(40)]]), { current: 'warm', season: 'summer' });
        add('wind', line([[9000, yAt(30)], [13000, yAt(30)]]), { strength: 0.8, season: 'winter' });
        add('high', [11000, yAt(35)], { strength: 0.6, size: 2000, season: 'winter' });
        add('wind', line([[9000, yAt(-20)], [13000, yAt(-20)]]), { strength: 0.8, season: 'both' });
      }),
      settings,
    );
    const k = (x: number, lat: number) => Math.floor(yAt(lat) / (settings.heightKm / sc.h)) * sc.w + Math.floor(x / sc.step);
    expect(sc.summer.curAnomaly[k(8950, 25)]).toBeGreaterThan(1);
    expect(Math.abs(sc.winter.curAnomaly[k(8950, 25)])).toBeLessThan(0.3);
    expect(sc.winter.windU[k(11000, 30)]).toBeGreaterThan(1);
    expect(sc.summer.windLine[k(11000, 30)]).not.toBe(sc.winter.windLine[k(11000, 30)]);
    expect(sc.winter.centres.length).toBe(1);
    expect(sc.summer.centres.length).toBe(0);
    // One for both seasons blows in both.
    expect(sc.summer.windU[k(11000, -20)]).toBeGreaterThan(1);
    expect(sc.winter.windU[k(11000, -20)]).toBeGreaterThan(1);
  }, 60000);

  it('has no currents until they are drawn, then warms and cools the water by them', () => {
    expect(new Set(cl.summer.current).has(1)).toBe(false);
    expect(new Set(cl.summer.current).has(-1)).toBe(false);
    const drawn = computeClimate(
      world((add) => {
        add('current', line([[8900, yAt(10)], [8900, yAt(40)]]), { current: 'warm' });
        add('current', line([[3100, yAt(40)], [3100, yAt(10)]]), { current: 'cold' });
        add('current', line([[3100, yAt(-30)], [3100, yAt(-10)]]), { current: 'cold', currentSize: 'secondary' });
      }),
      settings,
    );
    const anom = (x: number, lat: number) => drawn.summer.curAnomaly[(Math.floor(yAt(lat) / drawn.step)) * drawn.w + Math.floor(x / drawn.step)];
    expect(anom(8950, 25)).toBeGreaterThan(1);
    expect(anom(3050, 25)).toBeLessThan(-1);
    // A secondary current reaches less far than a major one.
    expect(Math.abs(anom(3100 - 450, -20))).toBeLessThan(Math.abs(anom(3100 - 450, 25)));
  }, 60000);

  it('grows reefs only in warm water', () => {
    let tropical = 0;
    let cold = 0;
    for (let k = 0; k < cl.reef.length; k++) {
      if (!cl.reef[k]) continue;
      if (Math.abs(cl.lat[(k / cl.w) | 0]) < 25) tropical++;
      if (Math.abs(cl.lat[(k / cl.w) | 0]) > 40) cold++;
    }
    expect(tropical).toBeGreaterThan(0);
    expect(cold).toBe(0);
  });
});

describe('climate tools', () => {
  it('a heat crystal warms the land around it, and erasing it takes it away', () => {
    const hot = computeClimate(world((add) => add('crystal', [6000, yAt(40)], { size: 1000, crystal: 'heat' })), settings);
    const gone = computeClimate(world((add) => {
      add('crystal', [6000, yAt(40)], { size: 1000, crystal: 'heat' });
      add('crystal', [6000, yAt(40)], { size: 200, erase: true });
    }), settings);
    const t = (c: Climate) => climateAt(c, 6000, yAt(40)).summerT;
    expect(t(hot)).toBeGreaterThan(t(cl) + 4);
    expect(t(gone)).toBeCloseTo(t(cl), 3);
  }, 60000);

  it('the Rain Shadow Pen can flatten a range for the climate', () => {
    const flat = computeClimate(world((add) => add('shadowpen', line([[4900, yAt(53)], [4900, yAt(37)]], 30), { size: 500, penHeight: 0 })), settings);
    // With the range flattened for the climate, the east side is no longer in shadow.
    expect(climateAt(flat, 5400, yAt(45)).summerRain + climateAt(flat, 5400, yAt(45)).winterRain).toBeGreaterThan(sumRain(5400, 45));
  }, 60000);
});

describe('the ITCZ follows the land, not past it', () => {
  it('stops near how far the land reaches toward the pole, and never passes the tilt line', () => {
    const n2 = 50;
    const set2 = defaultSettings({ widthKm: 16000, heightKm: 100 * KM_PER_DEGREE, northLatitude: n2, edges: 'wrap', seed: 3 });
    const y2 = (lat: number) => (n2 - lat) * KM_PER_DEGREE;
    const s: Surface = { strokes: [], nextId: 1 };
    const add = (pts: number[], size: number) => s.strokes.push({ ...brushDefaults('land'), id: s.nextId++, pts, size, roughness: 0.1 } as Stroke);
    // Wide land reaching only about 12°N, and wide land reaching 30°N.
    add(line([[1000, y2(5)], [5000, y2(5)]]), 1500);
    add(line([[7000, y2(15)], [10000, y2(15)]]), 3300);
    const c2 = computeClimate(s, set2);
    const col = (x: number) => Math.round((x - c2.x0) / c2.step);
    expect(c2.summer.itcz[col(3000)]).toBeLessThan(14);
    expect(c2.summer.itcz[col(8500)]).toBeGreaterThan(20);
    for (const v of c2.summer.itcz) expect(v).toBeLessThanOrEqual(set2.axialTilt + 1e-3);
  }, 60000);
});

describe('the ITCZ drawn by hand and the life balance', () => {
  it('follows a drawn ITCZ line in its season, easing back to the automatic path past its ends', () => {
    const s2 = world((add) => add('itcz', line([[2000, yAt(-12)], [9000, yAt(-12)]], 200), { season: 'summer' }));
    const c2 = computeClimate(s2, settings);
    const col = (x: number) => Math.floor(x / c2.step);
    // Where it runs, the belt sits on the line.
    expect(c2.summer.itcz[col(5000)]).toBeCloseTo(-12, 0);
    // Far past its ends it is the automatic path again.
    expect(Math.abs(c2.summer.itcz[col(12500)] - cl.summer.itcz[col(12500)])).toBeLessThan(1);
    // Winter keeps its own (automatic) path.
    expect(c2.winter.itcz[col(5000)]).toBeCloseTo(cl.winter.itcz[col(5000)], 3);
  }, 60000);

  it('the life balance shrinks deserts one way and spreads them the other', () => {
    const desert = (b: number) => {
      const c = computeClimate(world(), { ...settings, climate: { ...settings.climate, lifeBalance: b } });
      let d = 0;
      for (const z of c.zone) if (z === 3 || z === 4) d++;
      return d;
    };
    const base = desert(0);
    expect(desert(80)).toBeLessThan(base);
    expect(desert(-80)).toBeGreaterThan(base);
  }, 120000);
});

describe('lakes and the climate', () => {
  it('a big lake moistens the air round it and softens its shores’ seasons', () => {
    const lakeAt: [number, number] = [6200, yAt(28)];
    const c2 = computeClimate(world((add) => add('lake', [...lakeAt], { size: 600 })), settings);
    const ring = (c: Climate) => {
      let sum = 0;
      let cnt = 0;
      for (let k = 0; k < c.zone.length; k++) {
        const x = ((k % c.w) + 0.5) * c.step;
        const y = (((k / c.w) | 0) + 0.5) * c.step;
        const d = Math.hypot(x - lakeAt[0], y - lakeAt[1]);
        if (!c.land[k] || d < 350 || d > 900) continue;
        sum += c.summer.rain[k] + c.winter.rain[k];
        cnt++;
      }
      return sum / cnt;
    };
    expect(ring(c2)).toBeGreaterThan(ring(cl) * 1.05);
    const k = nearestPoint(c2, lakeAt[0] + 340, lakeAt[1]);
    const range = (c: Climate) => Math.abs(c.summer.temp[k] - c.winter.temp[k]);
    expect(range(c2)).toBeLessThan(range(cl));
  }, 60000);
});

describe('geography', () => {
  const g0 = () => cl.geo!;
  const landAt = (c: Climate, x: number, lat: number) => c.geo!.land[geoCell(c, x, yAt(lat))];
  it('finds the continent, and an island off its coast', () => {
    const c = computeClimate(world((add) => add('land', [11000, yAt(10)], { size: 400 })), settings);
    const cont = c.geo!.landmasses.find((f) => f.id === landAt(c, 6000, 10))!;
    const isl = c.geo!.landmasses.find((f) => f.id === landAt(c, 11000, 10))!;
    expect(cont.level).toBe('continent');
    expect(isl.level).toBe('island');
  }, 60000);
  it('a Divide line cuts a landmass in two; a Join line makes two one', () => {
    expect(landAt(cl, 6000, 30)).toBe(landAt(cl, 6000, -10));
    const cut = computeClimate(world((add) => add('divide', line([[2500, yAt(10)], [9500, yAt(10)]], 100))), settings);
    expect(landAt(cut, 6000, 30)).not.toBe(landAt(cut, 6000, -10));
    const both = computeClimate(world((add) => {
      add('land', [11000, yAt(10)], { size: 400 });
      add('join', line([[7500, yAt(10)], [11000, yAt(10)]], 100));
    }), settings);
    expect(landAt(both, 11000, 10)).toBe(landAt(both, 6000, 10));
  }, 120000);
  it('names a place with a Name pin', () => {
    const s2 = world((add) => add('name', [6000, yAt(20)], { label: 'Aerth', nameOf: 'land' }));
    const c = computeClimate(s2, settings);
    expect(geoNames(s2, c).land.get(landAt(c, 6000, -20))).toBe('Aerth');
  }, 60000);
  it('splits the water at narrow straits, and parts the land into regions of about the region size', () => {
    // A sea almost closed off by land, opening through a narrow strait.
    const c = computeClimate(world((add) => {
      add('land', line([[8500, yAt(45)], [12500, yAt(45)], [12500, yAt(20)], [8500, yAt(20)]], 60), { size: 400 });
      add('land', line([[12500, yAt(20)], [12500, yAt(45)]], 60), { size: 400 });
      add('land', line([[8500, yAt(20)], [10200, yAt(20)]], 60), { size: 600 });
      add('land', line([[10600, yAt(20)], [12500, yAt(20)]], 60), { size: 600 });
    }), settings);
    const w = (x: number, lat: number) => c.geo!.water[geoCell(c, x, yAt(lat))];
    expect(w(10500, 33)).toBeGreaterThanOrEqual(0);
    expect(w(10500, 33)).not.toBe(w(10500, 0));
    const g = g0();
    expect(g.regions.length).toBeGreaterThan(10);
    for (let k = 0; k < cl.land.length; k++) if (cl.land[k]) expect(g.region[k]).toBeGreaterThanOrEqual(0);
    const sizes = g.regions.map((r) => Math.sqrt(r.area) / 1.609).sort((a, b) => a - b);
    expect(sizes[sizes.length >> 1]).toBeGreaterThan(120);
    expect(sizes[sizes.length >> 1]).toBeLessThan(450);
  }, 60000);
});

describe('geography: ranges, lakes and rivers keep their own names', () => {
  it('mountains are never swallowed by the regions around them', () => {
    const g = cl.geo!;
    let m = 0;
    for (let k = 0; k < cl.land.length; k++) if (cl.land[k] && cl.height[k] >= 1.8) {
      m++;
      expect(g.regions[g.region[k]].kind).toBe('Mountains');
    }
    expect(m).toBeGreaterThan(0);
  });
  it('names lakes and rivers with pins', () => {
    const s2 = world((add) => {
      add('lake', [6500, yAt(10)], { size: 120 });
      add('river', line([[6000, yAt(30)], [7500, yAt(25)]], 20), { size: 12, strength: 1 });
      add('name', [6500, yAt(10)], { label: 'Mirrormere', nameOf: 'lake' });
      add('name', [6750, yAt(30 - 2.5)], { label: 'Long Water', nameOf: 'river' });
    });
    const names = geoNames(s2, null);
    expect([...names.lake.values()]).toEqual(['Mirrormere']);
    expect([...names.river.values()]).toEqual(['Long Water']);
    expect(freshWaters(s2).lakes.length).toBe(1);
  });
});
