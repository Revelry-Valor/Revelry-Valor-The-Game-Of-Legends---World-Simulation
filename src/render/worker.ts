import type { Climate } from '../core/climate';
import type { Stroke, Surface } from '../core/paint';
import { renderPicture, type RenderJob } from './paintmap';

/** Draws pieces of the map away from the page, so painting and panning stay smooth. */
let surface: Surface = { strokes: [], nextId: 1 };
let climate: Climate | null = null;

type Message = { type: 'surface'; surface: Surface } | { type: 'stroke'; stroke: Stroke } | { type: 'climate'; climate: Climate | null } | { type: 'job'; id: number; job: RenderJob };

self.onmessage = (e: MessageEvent) => {
  const m = e.data as Message;
  if (m.type === 'surface') {
    surface = m.surface;
    return;
  }
  if (m.type === 'climate') {
    climate = m.climate;
    return;
  }
  if (m.type === 'stroke') {
    // A stroke being painted: replace it, or add it if new.
    const i = surface.strokes.findIndex((s) => s.id === m.stroke.id);
    const strokes = surface.strokes.slice();
    if (i >= 0) strokes[i] = m.stroke;
    else strokes.push(m.stroke);
    surface = { strokes, nextId: Math.max(surface.nextId, m.stroke.id + 1) };
    return;
  }
  const pixels = renderPicture(surface, m.job, climate);
  (self as unknown as Worker).postMessage({ id: m.id, pixels }, [pixels.buffer]);
};
