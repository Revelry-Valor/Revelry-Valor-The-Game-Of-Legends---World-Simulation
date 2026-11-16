import { beforeAll, describe, expect, it } from 'vitest';
import { generateAirProvinces } from '../src/core/airprov';
import { brushDefaults, type BrushId, type Stroke, type Surface } from '../src/core/paint';
import { defaultSettings } from '../src/core/settings';
import { generateUnderProvinces } from '../src/core/underprov';
import { holdLayersYear, layerHolder, layerProvAt, rockSites, underRouteKm, type LayerProvMap } from '../src/sim/layerprovs';
import type { Settlement, SimState } from '../src/sim/state';

const settings = defaultSettings({ widthKm: 2000, heightKm: 1400, northLatitude: 40, seed: 8 });
const surface: Surface = { strokes: [], nextId: 1 };
const add = (brush: BrushId, pts: number[], o: Partial<Stroke> = {}) => surface.strokes.push({ ...brushDefaults(brush), id: surface.nextId++, pts, roughness: 0, ...o } as Stroke);
add('land', [1000, 700], { size: 1300, roughness: 0.1 });
// Two caves joined by a tunnel, and a third cave cut off in the rock.
add('cavern', [600, 700], { size: 120 });
add('tunnel', [600, 700, 1000, 700], { size: 4 });
add('cavern', [1000, 700], { size: 120 });
add('cavern', [1000, 1050], { size: 100 });
// The canopy: an island floating in it.
add('skyisland', [1400, 400], { size: 140, sky: 0 });

let below: LayerProvMap;
let canopy: LayerProvMap;
beforeAll(() => {
  below = generateUnderProvinces(surface, settings, {});
  canopy = generateAirProvinces(surface, settings, 0, {});
}, 60000);

const town = (id: number, clan: number, x: number, y: number, layer: Settlement['layer']): Settlement => ({ id, name: `T${id}`, kind: 'village', clan, species: 's', race: 'r', culture: 'c', x, y, pop: 300, fed: 1, warband: 30, holyTo: [], ruined: false, founded: 0, ruinedOn: -1, layer });
const sim = (towns: Settlement[]) => ({ settlements: towns, clans: [] } as unknown as SimState);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

describe('the peoples on the layers’ provinces', () => {
  it('lets towns hold the provinces round them, never open air or underground seas', () => {
    const s = sim([town(1, 7, 600, 700, 'underdark'), town(2, 9, 1000, 700, 'underdark'), town(3, 4, 1400, 400, 'canopy')]);
    holdLayersYear(s, { underdark: below, canopy }, () => 120, dist);
    const idAt = (m: LayerProvMap, x: number, y: number) => m.provinces[layerProvAt(m, x, y)].id;
    expect(layerHolder(s, 'underdark', idAt(below, 600, 700))).toBe(7);
    expect(layerHolder(s, 'underdark', idAt(below, 1000, 700))).toBe(9);
    // Rock round a town can be held too.
    const rockNear = below.provinces.find((p) => p.kind === 'rock' && dist(600, 700, p.x, p.y) < 110);
    expect(rockNear && layerHolder(s, 'underdark', rockNear.id)).toBe(7);
    // In the canopy: the island's provinces, not the open air round it.
    expect(layerHolder(s, 'canopy', idAt(canopy, 1400, 400))).toBe(4);
    const air = canopy.provinces.find((p) => p.kind === 'air' && dist(1400, 400, p.x, p.y) < 200);
    expect(air && layerHolder(s, 'canopy', air.id)).toBeUndefined();
  });

  it('runs main roads below through the caverns and tunnels only', () => {
    const joined = underRouteKm(below, 600, 700, 1000, 700);
    expect(joined).not.toBeNull();
    expect(joined!).toBeGreaterThan(300);
    expect(joined!).toBeLessThan(600);
    // The cave out in the rock has no road to them: only a dug tunnel would join it.
    expect(underRouteKm(below, 600, 700, 1000, 1050)).toBeNull();
  });

  it('offers tunnelers rock to dig out to and build in', () => {
    const sites = rockSites(below, 800, 900, 200, dist);
    expect(sites.length).toBeGreaterThan(2);
    expect(sites.every((q) => dist(800, 900, q.x, q.y) <= 200)).toBe(true);
    expect(rockSites(undefined, 800, 900, 200, dist)).toEqual([]);
  });
});
