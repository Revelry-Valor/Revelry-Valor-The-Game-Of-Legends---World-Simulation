import type { Climate } from '../core/climate';
import type { Surface } from '../core/paint';
import { generateProvinces, type SavedProvinces } from '../core/provinces';
import type { WorldSettings } from '../core/settings';

/** Makes provinces away from the page, so the map stays smooth while it works. */
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { id: number; surface: Surface; settings: WorldSettings; climate: Climate; sizeMi: number; seaFactor: number; saved: SavedProvinces | null };
  try {
    const map = generateProvinces(m.surface, m.settings, m.climate, { sizeMi: m.sizeMi, seaFactor: m.seaFactor, saved: m.saved });
    (self as unknown as Worker).postMessage({ id: m.id, map }, [map.label.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: (err as Error).message || String(err) });
  }
};
