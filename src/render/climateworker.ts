import { computeClimate } from '../core/climate';
import type { Surface } from '../core/paint';
import type { WorldSettings } from '../core/settings';

/** Works out the climate away from the page, so painting stays smooth while it runs. */
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { id: number; surface: Surface; settings: WorldSettings };
  const climate = computeClimate(m.surface, m.settings);
  (self as unknown as Worker).postMessage({ id: m.id, climate });
};
