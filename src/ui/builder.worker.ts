import { Rng } from '../engine/rng';
import { copyField, type Box, type ChunkCarver } from '../engine/terrainbuild';
import type { MapData, WorldConfig } from '../engine/types';
import { carverFor, generateMap } from '../engine/worldgen';
import { TerrainShader, type MapStyle } from './terrain';

/** What to paint after a build: everything, or a box of tiles (with whatever else changed). */
export interface PaintJob {
  style: MapStyle;
  contours: boolean;
  /** Pixels per tile. */
  scale: number;
  box: Box | 'all' | null;
}

export interface BuildReply {
  id: number;
  map: MapData;
  /** The painted pixels and the tiles they cover (null if nothing needed painting). */
  painted: { box: Box; width: number; height: number; pixels: Uint8ClampedArray } | null;
}

/**
 * Builds the world, and paints it, off the page's own thread, so the editor never stalls while
 * the land is carved or coloured. It keeps the carved land between builds; a change is carved
 * again only where it was made, and only that part of the map is painted again.
 */
let carver: ChunkCarver | null = null;
let carveKey = '';

const union = (a: Box | null, b: Box | null): Box | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

self.onmessage = (e: MessageEvent<{ id: number; cfg: WorldConfig; dirty: Box | null; paint: PaintJob } | { kept: true }>) => {
  if ('kept' in e.data) {
    // The land as carved, to make the world from.
    const f = carver ? copyField(carver.field) : null;
    (self as unknown as Worker).postMessage({ kept: f }, f ? [f.heights.buffer, f.wear.buffer, f.deposits.buffer, f.flow.buffer, f.water.buffer] as ArrayBuffer[] : []);
    return;
  }
  const { id, cfg, dirty, paint } = e.data;
  // New carving settings, map size or seed: everything is carved afresh.
  const key = JSON.stringify([cfg.width, cfg.height, cfg.seed, cfg.terrain?.mountains, cfg.terrain?.erosion, cfg.terrain?.softness, cfg.terrain?.downcutting]);
  const fresh = !carver || key !== carveKey || !dirty;
  if (!carver || key !== carveKey) {
    carver = carverFor(cfg);
    carveKey = key;
  }
  const map = generateMap(cfg, new Rng(cfg.seed).fork('map'), { carver: carver!, dirty: fresh ? null : dirty });
  // Paint what the carving changed and whatever the editor asked for.
  let box: Box | null = fresh || paint.box === 'all' ? { x0: 0, y0: 0, x1: map.width - 1, y1: map.height - 1 } : union(carver!.changed, paint.box);
  let painted: BuildReply['painted'] = null;
  if (box) {
    box = { x0: Math.max(0, box.x0 - 1), y0: Math.max(0, box.y0 - 1), x1: Math.min(map.width - 1, box.x1 + 1), y1: Math.min(map.height - 1, box.y1 + 1) };
    const S = paint.scale;
    const width = (box.x1 - box.x0 + 1) * S;
    const height = (box.y1 - box.y0 + 1) * S;
    const pixels = new Uint8ClampedArray(width * height * 4);
    new TerrainShader(map, paint.style, undefined, paint.contours).paint({ width, height, data: pixels } as ImageData, box.x0, box.y0, 1 / S, 1 / S);
    painted = { box, width, height, pixels };
  }
  // Hand the arrays over rather than copying them.
  const buffers = new Set<ArrayBuffer>();
  const collect = (v: unknown) => {
    if (ArrayBuffer.isView(v)) buffers.add(v.buffer as ArrayBuffer);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(map);
  if (painted) buffers.add(painted.pixels.buffer as ArrayBuffer);
  const reply: BuildReply = { id, map, painted };
  (self as unknown as Worker).postMessage(reply, [...buffers]);
};
