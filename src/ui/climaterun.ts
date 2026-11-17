import { computeClimate, type Climate } from '../core/climate';
import type { Surface } from '../core/paint';
import type { WorldSettings } from '../core/settings';
import ClimateWorker from '../render/climateworker?worker&inline';

/**
 * Keeps the climate up to date: with auto update on, it is worked out again a moment after
 * painting pauses or the settings change; with it off (the default), a change only marks it out
 * of date until `now()` (the Update climate button). Only one run happens at a time; with auto
 * update on, changes made during a run start another when it ends.
 */
export interface ClimateRunner {
  /** Something changed: update after a pause. */
  changed(): void;
  /** Update straight away. */
  now(): void;
  /** Update by itself after each pause in painting (off: only when asked). */
  auto: boolean;
  readonly climate: Climate | null;
  dispose(): void;
}

export type ClimateState = 'idle' | 'waiting' | 'working' | 'stale';

const PAUSE_MS = 1500;

export function createClimateRunner(input: () => { surface: Surface; settings: WorldSettings }, ready: (cl: Climate) => void, state: (s: ClimateState) => void): ClimateRunner {
  let climate: Climate | null = null;
  let worker: Worker | null = null;
  let running = 0;
  let again = false;
  let timer = 0;
  let nextId = 1;
  let auto = false;
  let stale = false;
  try {
    worker = new ClimateWorker();
    worker.onmessage = (e) => done((e.data as { id: number; climate: Climate }).climate);
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (running) {
        running = 0;
        start();
      }
    };
  } catch {
    worker = null;
  }

  const done = (cl: Climate) => {
    running = 0;
    climate = cl;
    ready(cl);
    if (again && auto) start();
    else state(stale ? 'stale' : 'idle');
  };

  const start = () => {
    clearTimeout(timer);
    if (running) {
      again = true;
      return;
    }
    again = false;
    stale = false;
    running = nextId++;
    state('working');
    const { surface, settings } = input();
    if (worker) worker.postMessage({ id: running, surface, settings });
    else setTimeout(() => done(computeClimate(surface, settings)), 30);
  };

  return {
    changed() {
      clearTimeout(timer);
      if (!auto) {
        // Only marked out of date: worked out when asked.
        stale = true;
        if (!running) state('stale');
        return;
      }
      if (!running) state('waiting');
      else again = true;
      timer = window.setTimeout(start, PAUSE_MS);
    },
    now: start,
    get auto() {
      return auto;
    },
    set auto(v: boolean) {
      auto = v;
      // Turned on with changes waiting: update after a pause.
      if (v && stale && !running) {
        state('waiting');
        timer = window.setTimeout(start, PAUSE_MS);
      }
    },
    get climate() {
      return climate;
    },
    dispose() {
      clearTimeout(timer);
      worker?.terminate();
    },
  };
}
