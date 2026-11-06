import type { Climate } from '../core/climate';
import type { Surface } from '../core/paint';
import { generateProvinces, type ProvinceCache, type ProvinceSizes, type SavedProvinces } from '../core/provinces';
import type { WorldSettings } from '../core/settings';
import { generateUnderProvinces } from '../core/underprov';

/** The provinces as last grown, so painting needs only the last steps again. */
const cache: ProvinceCache = {};

/** Makes provinces away from the page, so the map stays smooth while it works. */
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { id: number; layer?: 'underdark'; surface: Surface; settings: WorldSettings; climate: Climate; sizeMi: number; seaFactor: number; saved: SavedProvinces | null } & Partial<ProvinceSizes>;
  try {
    // The Underdark's provinces (underprov.ts), or the surface's.
    const map = m.layer === 'underdark' ? generateUnderProvinces(m.surface, m.settings, m as unknown as Parameters<typeof generateUnderProvinces>[2]) : generateProvinces(m.surface, m.settings, m.climate, m, cache);
    (self as unknown as Worker).postMessage({ id: m.id, map }, [map.label.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: (err as Error).message || String(err) });
  }
};
