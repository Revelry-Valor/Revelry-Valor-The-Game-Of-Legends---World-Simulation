import { Rng } from '../engine/rng';
import { copyField, type Box, type ChunkCarver } from '../engine/terrainbuild';
import type { MapData, WorldConfig } from '../engine/types';
import { carverFor, decodeHeights, generateMap } from '../engine/worldgen';
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
  /** The world as built (null when only the land being drawn was shown again: the map is as it was). */
  map: MapData | null;
  /** The painted pixels and the tiles they cover (null if nothing needed painting). */
  painted: Painted | null;
  /** The same, painted again in full detail where it shows close in (see DetailRequest). */
  detail?: Painted | null;
}

export interface Painted {
  box: Box;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** Pixels per tile. */
  scale?: number;
}

/** Paint the part of the map in view in full detail (close in), and keep it so as the land changes. */
export interface DetailRequest {
  detail: { id: number; box: Box; scale: number; look: string } | null;
}

export interface BuildRequest {
  id: number;
  cfg: WorldConfig;
  /** The land shaped by hand on the fine grid. */
  relief: Float32Array | null;
  /** Wear the change with water (false while a stroke is still being drawn). */
  erode: boolean;
  dirty: Box | null;
  paint: PaintJob;
}

/**
 * Builds the world, and paints it, off the page's own thread, so the editor never stalls while
 * the land is carved or coloured. It keeps the carved land between builds; a change is carved
 * again only where it was made, and only that part of the map is painted again.
 *
 * While a Terrain stroke is being drawn, only the land under it changes: the land is shown again
 * there, as drawn, without working out the rest of the world again. When the stroke is finished
 * the world is built again in full (the land worn by water, the climate, rivers and lakes).
 */
let carver: ChunkCarver | null = null;
let carveKey = '';
/** The last world built, its outline, and the painter for it, kept for showing strokes as drawn. */
let last: { map: MapData; heightmap: string; shader: TerrainShader; look: string } | null = null;
/** The part of the map shown close in, painted in full detail. */
let detailView: { box: Box; scale: number; look: string } | null = null;

const meet = (a: Box, b: Box): Box | null => {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 < r.x0 || r.y1 < r.y0 ? null : r;
};

/** The changed tiles that show close in, painted in full detail. */
function detailOf(painted: Painted | null): Painted | null {
  const dv = detailView;
  if (!painted || !dv || !last || last.look !== dv.look) return null;
  const b = meet(painted.box, dv.box);
  return b ? { ...paintBox(last.shader, last.map, b, dv.scale, 0)!, scale: dv.scale } : null;
}

const union = (a: Box | null, b: Box | null): Box | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

function paintBox(shader: TerrainShader, map: MapData, box: Box, S: number, pad = 1): Painted {
  const b = { x0: Math.max(0, box.x0 - pad), y0: Math.max(0, box.y0 - pad), x1: Math.min(map.width - 1, box.x1 + pad), y1: Math.min(map.height - 1, box.y1 + pad) };
  const width = (b.x1 - b.x0 + 1) * S;
  const height = (b.y1 - b.y0 + 1) * S;
  const pixels = new Uint8ClampedArray(width * height * 4);
  shader.paint({ width, height, data: pixels } as ImageData, b.x0, b.y0, 1 / S, 1 / S);
  return { box: b, width, height, pixels };
}

const transfers = (r: BuildReply) => [r.painted, r.detail].filter((p): p is Painted => !!p).map((p) => p.pixels.buffer as ArrayBuffer);

self.onmessage = (e: MessageEvent<BuildRequest | DetailRequest | { kept: true }>) => {
  const post = (self as unknown as Worker).postMessage.bind(self);
  if ('detail' in e.data) {
    const d = e.data.detail;
    detailView = d ? { box: d.box, scale: d.scale, look: d.look } : null;
    if (!d || !last || last.look !== d.look) return;
    const p: Painted = { ...paintBox(last.shader, last.map, d.box, d.scale, 0), scale: d.scale };
    post({ detailId: d.id, detail: p }, [p.pixels.buffer as ArrayBuffer]);
    return;
  }
  if ('kept' in e.data) {
    // The land as carved, to make the world from.
    const f = carver ? copyField(carver.field) : null;
    post({ kept: f }, f ? ([f.heights.buffer, f.wear.buffer, f.deposits.buffer, f.flow.buffer, f.water.buffer] as ArrayBuffer[]) : []);
    return;
  }
  const { id, cfg, relief, erode, dirty, paint } = e.data;
  // New carving settings, map size or seed: everything is carved afresh.
  const key = JSON.stringify([cfg.width, cfg.height, cfg.seed, cfg.terrain?.mountains, cfg.terrain?.erosion, cfg.terrain?.softness, cfg.terrain?.downcutting]);
  const fresh = !carver || key !== carveKey || !dirty;
  const look = `${paint.style}|${paint.contours}`;
  // A Terrain stroke being drawn (the outline as it was): show the land under it as drawn.
  if (!fresh && !erode && last && dirty && cfg.heightmap === last.heightmap && last.look === look && paint.box !== 'all') {
    const { map, shader } = last;
    const w = cfg.width;
    const h = cfg.height;
    const outline = decodeHeights(cfg.heightmap!, w, h)!;
    const surface = new Float32Array(w * h);
    const sea = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (outline[i] < 0) sea[i] = 1;
      else surface[i] = outline[i];
    }
    const f = carver!.carve(surface, sea, relief, dirty, false);
    const box = union(carver!.changed, paint.box);
    let painted: Painted | null = null;
    if (box) {
      // The map's own copy of the land (with its rivers and lakes) takes the land as drawn here.
      const c = map.carved!;
      const S = f.scale;
      for (let Y = Math.max(0, box.y0 * S); Y < Math.min(f.height, (box.y1 + 1) * S); Y++) {
        const a = Y * f.width + Math.max(0, box.x0 * S);
        const b = Y * f.width + Math.min(f.width, (box.x1 + 1) * S);
        c.heights.set(f.heights.subarray(a, b), a);
        c.wear.set(f.wear.subarray(a, b), a);
        c.deposits.set(f.deposits.subarray(a, b), a);
        c.flow.set(f.flow.subarray(a, b), a);
      }
      shader.refresh(box);
      painted = paintBox(shader, map, box, paint.scale);
    }
    const reply: BuildReply = { id, map: null, painted, detail: detailOf(painted) };
    post(reply, transfers(reply));
    return;
  }
  if (!carver || key !== carveKey) {
    carver = carverFor(cfg);
    carveKey = key;
  }
  const map = generateMap(cfg, new Rng(cfg.seed).fork('map'), { carver: carver!, dirty: fresh ? null : dirty, relief, erode });
  const shader = new TerrainShader(map, paint.style, undefined, paint.contours);
  // Paint what the carving changed and whatever the editor asked for.
  const box: Box | null = fresh || paint.box === 'all' ? { x0: 0, y0: 0, x1: map.width - 1, y1: map.height - 1 } : union(carver!.changed, paint.box);
  const painted = box ? paintBox(shader, map, box, paint.scale) : null;
  last = { map, heightmap: cfg.heightmap ?? '', shader, look };
  // The map is copied over (it is kept here, for showing strokes as drawn); the pixels handed over.
  const reply: BuildReply = { id, map, painted, detail: detailOf(painted) };
  post(reply, transfers(reply));
};
