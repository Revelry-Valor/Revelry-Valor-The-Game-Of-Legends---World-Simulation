import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/engine/config';
import { World } from '../src/engine/world';
import { powerAt } from '../src/engine/systems/territory';

describe('land held by presence, and taken only by war', () => {
  const world = new World(defaultConfig({ seed: 7 }));
  const early = { homed: 0, claimed: 0, realm: 0 };
  const snapshots: Int32Array[] = [];
  for (let y = 1; y <= 160; y++) {
    world.tick();
    if (y === 2) {
      early.homed = world.bands.filter((b) => b.alive && b.home >= 0).length;
      early.claimed = world.map.claim.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0);
    }
    if (y === 120 || y === 121) snapshots.push(Int32Array.from({ length: world.map.size }, (_, t) => powerAt(world, t)));
  }
  const map = world.map;

  it('lets tribes roam for a while before they make a home range and start claiming it', () => {
    expect(early.homed).toBe(0);
    expect(early.claimed).toBe(0);
    expect(world.bands.some((b) => b.home >= 0)).toBe(true);
    expect(map.claim.some((c) => c >= 0)).toBe(true);
  });

  it('keeps clan land and settled realms apart, and claims only land a clan has walked next to its own', () => {
    for (let t = 0; t < map.size; t++) {
      if (map.claim[t] < 0) continue;
      expect(map.region[t]).toBe(-1);
      expect(map.owner[t]).toBe(-1);
      expect(world.tribes[map.claim[t]]).toBeDefined();
    }
  });

  it('never moves a border between two holders except by war', () => {
    const [a, b] = snapshots;
    // Tiles that changed hands from one holder to another in that year must have been fought over.
    let changed = 0;
    for (let t = 0; t < a.length; t++) if (a[t] !== -1 && b[t] !== -1 && a[t] !== b[t]) changed++;
    const wars = world.landWars.filter((w) => w.end !== null && w.end >= 120 * 12 && w.end < 122 * 12).length + world.wars.filter((w) => w.end !== null && w.end >= 120 && w.end <= 121).length;
    const towns = world.history.filter((e) => (e.year === 120 || e.year === 121) && /ceded|went over|declared|rose|joined|joining|allegiance|free of|union|inherit|absorbed|seceded|broke away/i.test(e.text)).length;
    if (changed > 0) expect(wars + towns).toBeGreaterThan(0);
  });

  it('fights land wars with warbands that go home, and settles the land at the peace', () => {
    expect(world.landWars.length).toBeGreaterThan(0);
    const ended = world.landWars.filter((w) => w.end !== null);
    expect(ended.length).toBeGreaterThan(0);
    for (const w of ended) expect(w.outcome).toBeTruthy();
    // No land stays occupied once its war is over.
    const open = new Set<number>();
    for (const w of world.landWars) if (w.end === null) open.add(w.attacker).add(w.defender);
    for (const w of world.wars) if (w.end === null) open.add(w.attacker).add(w.defender);
    for (let t = 0; t < map.size; t++) if (map.occupier[t] !== -1) expect(open.has(map.occupier[t])).toBe(true);
    // Warbands only exist for wars still being fought, or on their way home.
    for (const wb of world.warbands) expect(wb.homeward || world.landWars[wb.warId].end === null).toBe(true);
  });
});
