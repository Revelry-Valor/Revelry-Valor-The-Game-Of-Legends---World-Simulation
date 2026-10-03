import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/engine/config';
import { World } from '../src/engine/world';

describe('clans and their hunting grounds', () => {
  const world = new World(defaultConfig({ seed: 7 }));
  const early = { homed: 0, claimed: 0 };
  for (let y = 1; y <= 160; y++) {
    world.tick();
    if (y === 2) {
      early.homed = world.bands.filter((b) => b.alive && b.home >= 0).length;
      early.claimed = world.map.claim.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0);
    }
  }
  const map = world.map;

  it('lets tribes roam for a while before they make a home range and claim it', () => {
    expect(early.homed).toBe(0);
    expect(early.claimed).toBe(0);
    expect(world.bands.some((b) => b.home >= 0)).toBe(true);
    expect(map.claim.some((c) => c >= 0)).toBe(true);
  });

  it('claims only wild land, held by clans that exist, and big enough to live off', () => {
    const tiles = new Map<number, number>();
    for (let t = 0; t < map.size; t++) {
      const c = map.claim[t];
      if (c < 0) continue;
      expect(map.owner[t]).toBe(-1);
      expect(world.tribes[c]).toBeDefined();
      expect(world.year - map.claimSeen[t]).toBeLessThanOrEqual(12);
      tiles.set(c, (tiles.get(c) ?? 0) + 1);
    }
    // A clan with a settled tribe holds a real range, not a handful of tiles.
    for (const b of world.bands) {
      if (b.home < 0 || world.year - b.homeSince < 3) continue;
      expect(tiles.get(b.tribeId) ?? 0).toBeGreaterThan(10);
    }
  });

  it('fights neighbouring clans over land, the winners taking it', () => {
    const fights = world.history.filter((e) => e.kind === 'tribe' && /fought the .* clan for the hunting grounds|held their hunting grounds/.test(e.text));
    expect(fights.length).toBeGreaterThan(0);
    const wins = world.tribes.reduce((n, t) => n + t.wins, 0);
    const lost = world.tribes.reduce((n, t) => n + t.losses, 0);
    expect(wins).toBe(lost);
    expect(world.tribes.some((t) => Object.keys(t.feuds).length > 0)).toBe(true);
  });
});
