import './styles.css';
import { browserStore, saveWorld } from '../core/storage';
import type { World } from '../core/world';
import { showCreate } from './create';
import { showStart } from './start';
import { showWorld } from './worldview';

/**
 * The app: a start screen (Create world / Continue sim), the Create world form, and the world
 * itself. Screens replace each other in one root element.
 */
const root = document.getElementById('app')!;
const store = browserStore();

export interface App {
  root: HTMLElement;
  store: ReturnType<typeof browserStore>;
  start(): void;
  create(): void;
  open(world: World): void;
  /** Save a world, reporting failure to the person rather than losing it silently. */
  save(world: World): boolean;
}

let dispose: (() => void) | null = null;
const swap = (next: () => (() => void) | void) => {
  dispose?.();
  dispose = null;
  root.replaceChildren();
  window.scrollTo(0, 0);
  dispose = next() || null;
};

const app: App = {
  root,
  store,
  start: () => swap(() => showStart(app)),
  create: () => swap(() => showCreate(app)),
  open: (world) => swap(() => showWorld(app, world)),
  save(world) {
    try {
      saveWorld(store, world);
      return true;
    } catch (err) {
      alert((err as Error).message);
      return false;
    }
  },
};

app.start();
