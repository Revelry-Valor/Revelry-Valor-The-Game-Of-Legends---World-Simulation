import { computeClimate, type Climate } from '../core/climate';
import type { Surface } from '../core/paint';
import type { WorldSettings } from '../core/settings';
import ClimateWorker from '../render/climateworker?worker&inline';

/**
 * Keeps the climate up to date: it is worked out again a moment after painting pauses or the
 * settings change, or at once with `now()`. Only one run happens at a time; changes made during
 * a run start another when it ends.
 */
export interface ClimateRunner {
  /** Something changed: update after a pause. */
  changed(): void;
  /** Update straight away. */
  now(): void;
  readonly climate: Climate | null;
  dispose(): void;
}

export type ClimateState = 'idle' | 'waiting' | 'working';

const PAUSE_MS = 1500;

export function createClimateRunner(input: () => { surface: Surface; settings: WorldSettings }, ready: (cl: Climate) => void, state: (s: ClimateState) => void): ClimateRunner {
  let climate: Climate | null = null;
  let worker: Worker | null = null;
  let running = 0;
  let again = false;
  let timer = 0;
  let nextId = 1;
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
    if (again) start();
    else state('idle');
  };

  const start = () => {
    clearTimeout(timer);
    if (running) {
      again = true;
      return;
    }
    again = false;
    running = nextId++;
    state('working');
    const { surface, settings } = input();
    if (worker) worker.postMessage({ id: running, surface, settings });
    else setTimeout(() => done(computeClimate(surface, settings)), 30);
  };

  return {
    changed() {
      clearTimeout(timer);
      if (!running) state('waiting');
      else again = true;
      timer = window.setTimeout(start, PAUSE_MS);
    },
    now: start,
    get climate() {
      return climate;
    },
    dispose() {
      clearTimeout(timer);
      worker?.terminate();
    },
  };
}
