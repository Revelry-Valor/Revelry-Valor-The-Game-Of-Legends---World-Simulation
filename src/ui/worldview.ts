import { strokeBounds, ZONES, type Stroke } from '../core/paint';
import { southLatitude, validateSettings } from '../core/settings';
import { formatDistance, formatLatitude, KM_PER_DEGREE, milesToKm } from '../core/units';
import { expandWorld, expansionProblem, LAYERS, type Expansion, type World } from '../core/world';
import type { MapStyle } from '../render/paintmap';
import type { App } from './main';
import { choice, h, numberField } from './dom';
import { createMapView } from './mapview';
import { planetFields } from './settingsform';
import { createToolPanel } from './toolpanel';

/**
 * The world screen: the map, the painting tools (Phase 1), the layer list, the world's
 * settings, and growing the canvas.
 */
export function showWorld(app: App, start: World): () => void {
  let world = start;
  let dirty = false;
  const look = { style: 'satellite' as MapStyle, zones: false, grid: true };

  const status = h('span', { class: 'muted small', 'aria-live': 'polite' }, 'Saved');
  const save = () => {
    world = { ...world, updatedAt: Date.now() };
    if (app.save(world)) {
      dirty = false;
      status.textContent = `Saved ${new Date(world.updatedAt).toLocaleTimeString()}`;
    }
  };
  const changed = () => {
    dirty = true;
    status.textContent = 'Unsaved changes';
  };
  const autosave = window.setInterval(() => dirty && save(), 30000);

  const title = h('h1', {}, world.settings.name);
  const sizeLine = h('span', { class: 'muted small' });
  const updateHead = () => {
    const s = world.settings;
    title.textContent = s.name;
    sizeLine.textContent = `${formatDistance(s.widthKm)} × ${formatDistance(s.heightKm)} · ${formatLatitude(s.northLatitude)} to ${formatLatitude(southLatitude(s))} · ${s.edges === 'wrap' ? 'wraps east–west' : 'edges lead nowhere'}`;
  };

  // ---- Undo and redo: each step is the stroke list before a change. ----
  const undoStack: Stroke[][] = [];
  const redoStack: Stroke[][] = [];
  const undoBtn = h('button', { type: 'button', class: 'ghost', title: 'Undo (Ctrl+Z)', disabled: true }, 'Undo');
  const redoBtn = h('button', { type: 'button', class: 'ghost', title: 'Redo (Ctrl+Shift+Z)', disabled: true }, 'Redo');
  const updateUndo = () => {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  };
  /** Bounds of every stroke in one list but not the other. */
  const diffBounds = (a: Stroke[], b: Stroke[]): [number, number, number, number] | null => {
    const ids = (l: Stroke[]) => new Set(l.map((s) => s.id));
    const ia = ids(a);
    const ib = ids(b);
    const changedStrokes = [...a.filter((s) => !ib.has(s.id)), ...b.filter((s) => !ia.has(s.id))];
    if (!changedStrokes.length) return null;
    return changedStrokes.map(strokeBounds).reduce((m, k) => [Math.min(m[0], k[0]), Math.min(m[1], k[1]), Math.max(m[2], k[2]), Math.max(m[3], k[3])]);
  };
  const setStrokes = (strokes: Stroke[]) => {
    const before = world.surface.strokes;
    world = { ...world, surface: { ...world.surface, strokes } };
    const b = diffBounds(before, strokes);
    if (b) map.surfaceChanged(b);
    changed();
    updateUndo();
  };
  const undo = () => {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(world.surface.strokes);
    setStrokes(prev);
  };
  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(world.surface.strokes);
    setStrokes(next);
  };
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // ---- Tools and map ----
  const notice = h('p', { class: 'notice small', role: 'status', hidden: true });
  let noticeTimer = 0;
  const showNotice = (text: string) => {
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice.hidden = true), 4000);
  };
  const tools = createToolPanel(() => map?.redraw());
  const map = createMapView({
    world: () => world,
    tool: () => tools.state,
    look: () => look,
    notice: showNotice,
    commit(stroke) {
      const id = world.surface.nextId;
      undoStack.push(world.surface.strokes);
      if (undoStack.length > 300) undoStack.shift();
      redoStack.length = 0;
      world = { ...world, surface: { strokes: [...world.surface.strokes, { ...stroke, id }], nextId: id + 1 } };
      changed();
      updateUndo();
    },
  });

  // ---- View options ----
  const legend = h(
    'table',
    { class: 'zone-legend small', hidden: true },
    h('thead', {}, h('tr', {}, h('th', {}, 'Zone'), h('th', {}, 'Travel · who can settle'))),
    h('tbody', {}, ...ZONES.map((z) => h('tr', {}, h('td', {}, h('span', { class: `swatch z${z.id}` }), z.name), h('td', {}, `${z.travel}. ${z.settle}.`)))),
  );
  const viewPanel = h(
    'section',
    { class: 'view-panel' },
    h('h2', {}, 'View'),
    choice<MapStyle>('Look', [{ value: 'satellite', label: 'Satellite' }, { value: 'paper', label: 'Paper' }], look.style, (v) => { look.style = v; map.redraw(); }),
    choice<'off' | 'on'>('Mountain zones', [{ value: 'off', label: 'Hidden' }, { value: 'on', label: 'Shown' }], 'off', (v) => { look.zones = v === 'on'; legend.hidden = !look.zones; map.redraw(); }),
    legend,
    choice<'on' | 'off'>('Latitude lines', [{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }], 'on', (v) => { look.grid = v === 'on'; map.redraw(); }),
  );

  // ---- Layers ----
  const layerList = h('ul', { class: 'layers' });
  const renderLayers = () => {
    layerList.replaceChildren(
      ...LAYERS.map((l) => {
        const on = world.layers[l.id];
        const toggle =
          l.id === 'surface'
            ? h('span', { class: 'muted small' }, 'Painting')
            : h('input', {
                type: 'checkbox',
                checked: on,
                'aria-label': `Use the ${l.name} layer`,
                title: 'Each layer gets its own view in a later phase.',
                onchange: (e: Event) => {
                  world = { ...world, layers: { ...world.layers, [l.id]: (e.target as HTMLInputElement).checked } };
                  changed();
                  renderLayers();
                },
              });
        return h('li', { class: l.id === 'surface' ? 'current' : '' }, h('span', {}, l.name), toggle);
      }),
    );
  };

  // ---- Dialogs ----
  const dialog = h('dialog', { class: 'dialog' });
  const openDialog = (...content: (Node | string)[]) => {
    dialog.replaceChildren(...content);
    dialog.showModal();
  };

  const canvasOptions = () => {
    const e: Expansion = { north: 0, south: 0, east: 0, west: 0 };
    const preview = h('p', { class: 'summary' });
    const problem = h('p', { class: 'problems', role: 'alert' });
    const apply = h('button', { type: 'button', class: 'primary' }, 'Expand');
    const update = () => {
      const s = world.settings;
      const err = expansionProblem(world, e);
      apply.disabled = !!err;
      problem.textContent = err && err !== 'Choose how far to expand.' ? err : '';
      const w = s.widthKm + e.east + e.west;
      const hk = s.heightKm + e.north + e.south;
      const n = s.northLatitude + e.north / KM_PER_DEGREE;
      preview.textContent = `New size ${formatDistance(w)} × ${formatDistance(hk)}, from ${formatLatitude(n)} to ${formatLatitude(n - hk / KM_PER_DEGREE)}.`;
    };
    const side = (k: keyof Expansion, label: string) =>
      numberField({ label, value: 0, min: 0, max: 20000, step: 10, unit: 'miles', change: (v) => { e[k] = milesToKm(Math.max(0, v)); update(); } });
    apply.addEventListener('click', () => {
      world = expandWorld(world, e);
      // Undo steps hold strokes at their old positions, so they no longer apply.
      undoStack.length = 0;
      redoStack.length = 0;
      updateUndo();
      changed();
      save();
      dialog.close();
      updateHead();
      map.worldReset();
      map.fit();
    });
    update();
    openDialog(
      h('h2', {}, 'Canvas options'),
      h('p', { class: 'muted small' }, 'Add ocean to any side. Nothing already on the map moves; growing north or south extends its latitudes.'),
      h('div', { class: 'expand-grid' }, side('north', 'North'), side('west', 'West'), side('east', 'East'), side('south', 'South')),
      preview,
      problem,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => dialog.close() }, 'Cancel'), apply),
    );
  };

  const worldSettings = () => {
    const s = { ...world.settings, climate: { ...world.settings.climate }, rainfall: { ...world.settings.rainfall } };
    const problems = h('ul', { class: 'problems', role: 'alert' });
    const apply = h('button', { type: 'button', class: 'primary' }, 'Apply');
    const check = () => {
      const list = validateSettings(s);
      problems.replaceChildren(...list.map((p) => h('li', {}, p)));
      apply.disabled = list.length > 0;
    };
    apply.addEventListener('click', () => {
      world = { ...world, settings: s };
      changed();
      save();
      dialog.close();
      updateHead();
      map.redraw();
    });
    check();
    openDialog(
      h('h2', {}, 'World settings'),
      h('div', { class: 'field' }, h('label', { for: 'ws-name' }, 'Name'), h('input', { id: 'ws-name', type: 'text', value: s.name, maxlength: 60, oninput: (ev: Event) => { s.name = (ev.target as HTMLInputElement).value; check(); } })),
      planetFields(s, check),
      problems,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => dialog.close() }, 'Cancel'), apply),
    );
  };

  const leave = () => {
    if (dirty) save();
    app.start();
  };

  // ---- Keyboard shortcuts ----
  const keydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    } else if (!mod && e.key.toLowerCase() === 'e') {
      tools.setErase(!tools.state.erase);
    } else if (!mod && e.key === '[') {
      tools.resize(1 / 1.25);
    } else if (!mod && e.key === ']') {
      tools.resize(1.25);
    }
  };
  window.addEventListener('keydown', keydown);

  const sideToggle = h('button', { type: 'button', class: 'ghost side-toggle', 'aria-expanded': 'true' }, 'Tools');
  const side = h(
    'aside',
    { class: 'side' },
    h('h2', {}, 'Paint'),
    notice,
    tools.el,
    viewPanel,
    h('section', {}, h('h2', {}, 'Layers'), layerList, h('p', { class: 'muted small' }, 'Other layers get their own views in a later phase.')),
  );
  sideToggle.addEventListener('click', () => {
    const open = side.classList.toggle('closed');
    sideToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    map.redraw();
  });

  app.root.append(
    h(
      'div',
      { class: 'world' },
      h(
        'header',
        { class: 'topbar' },
        h('div', { class: 'title' }, title, sizeLine),
        h(
          'nav',
          { class: 'tools' },
          sideToggle,
          undoBtn,
          redoBtn,
          status,
          h('button', { type: 'button', class: 'primary', onclick: save }, 'Save'),
          h('button', { type: 'button', class: 'ghost', onclick: canvasOptions }, 'Canvas options'),
          h('button', { type: 'button', class: 'ghost', onclick: worldSettings }, 'World settings'),
          h('button', { type: 'button', class: 'ghost', onclick: leave }, 'Main menu'),
        ),
      ),
      h('div', { class: 'workspace' }, side, map.el),
      dialog,
    ),
  );

  updateHead();
  renderLayers();
  const beforeUnload = () => dirty && save();
  window.addEventListener('beforeunload', beforeUnload);

  return () => {
    window.clearInterval(autosave);
    clearTimeout(noticeTimer);
    map.dispose();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('keydown', keydown);
  };
}
