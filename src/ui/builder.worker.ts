import { Rng } from '../engine/rng';
import type { ChunkCarver, Box } from '../engine/terrainbuild';
import type { WorldConfig } from '../engine/types';
import { carverFor, generateMap } from '../engine/worldgen';

/**
 * Builds the world off the page's own thread, so the editor stays smooth while the land is carved.
 * It keeps the carved land between builds and carves again only the part that changed.
 */
let carver: ChunkCarver | null = null;
let carveKey = '';

self.onmessage = (e: MessageEvent<{ id: number; cfg: WorldConfig; dirty: Box | null }>) => {
  const { id, cfg, dirty } = e.data;
  // New carving settings, map size or seed: everything is carved afresh.
  const key = JSON.stringify([cfg.width, cfg.height, cfg.seed, cfg.terrain?.mountains, cfg.terrain?.erosion, cfg.terrain?.softness, cfg.terrain?.downcutting]);
  let full = !carver || key !== carveKey;
  if (full) {
    carver = carverFor(cfg);
    carveKey = key;
  }
  const map = generateMap(cfg, new Rng(cfg.seed).fork('map'), { carver: carver!, dirty: full ? null : dirty });
  const changed = full || !dirty ? null : carver!.changed;
  full = full || !dirty;
  // Hand the arrays over rather than copying them.
  const buffers = new Set<ArrayBuffer>();
  const collect = (v: unknown) => {
    if (ArrayBuffer.isView(v)) buffers.add(v.buffer as ArrayBuffer);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(map);
  (self as unknown as Worker).postMessage({ id, map, changed, full }, [...buffers]);
};
