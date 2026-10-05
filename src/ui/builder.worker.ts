import { Rng } from '../engine/rng';
import type { WorldConfig } from '../engine/types';
import { generateMap } from '../engine/worldgen';

/**
 * Builds worlds off the page's own thread, so the editor stays smooth while the land is carved:
 * a quick preview while you draw, full detail when you stop.
 */
self.onmessage = (e: MessageEvent<{ id: number; cfg: WorldConfig }>) => {
  const { id, cfg } = e.data;
  const map = generateMap(cfg, new Rng(cfg.seed).fork('map'));
  // Hand the arrays over rather than copying them.
  const buffers = new Set<ArrayBuffer>();
  const collect = (v: unknown) => {
    if (ArrayBuffer.isView(v)) buffers.add(v.buffer as ArrayBuffer);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(map);
  (self as unknown as Worker).postMessage({ id, map }, [...buffers]);
};
