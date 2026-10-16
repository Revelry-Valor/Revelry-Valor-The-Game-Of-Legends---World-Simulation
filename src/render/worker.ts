import type { Surface } from '../core/paint';
import { renderPicture, type RenderJob } from './paintmap';

/** Draws pieces of the map away from the page, so painting and panning stay smooth. */
let surface: Surface = { strokes: [], nextId: 1 };

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: 'surface'; surface: Surface } | { type: 'job'; id: number; job: RenderJob };
  if (m.type === 'surface') {
    surface = m.surface;
    return;
  }
  const pixels = renderPicture(surface, m.job);
  (self as unknown as Worker).postMessage({ id: m.id, pixels }, [pixels.buffer]);
};
