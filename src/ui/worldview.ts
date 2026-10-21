import { strokeBounds, ZONES, type Stroke } from '../core/paint';
import { centreLatitude, kmPerDegree, MAX_SIDE_KM, placeAtLatitude, southLatitude, validateSettings } from '../core/settings';
import { formatDistance, formatLatitude, kmToMiles, milesToKm } from '../core/units';
import { expandedSettings, expandWorld, expansionProblem, LAYERS, type Expansion, type World } from '../core/world';
import { ZONE_INFO } from '../core/climate';
import { RAIN_LEGEND, TEMP_LEGEND, type MapStyle, type MapView } from '../render/paintmap';
import { createClimateRunner } from './climaterun';
import type { App } from './main';
import { choice, h, numberField, toast } from './dom';
import { deleteWorld } from '../core/storage';
import { createMapView } from './mapview';
import { planetFields } from './settingsform';
import { createToolPanel } from './toolpanel';
import { degreeChoice, sizeMeter, worldLocator } from './worldsize';
import { climateReport } from './report';

/**
 * The world screen: the map, the painting tools (Phase 1), the layer list, the world's
 * settings, and growing the canvas.
 */
export function showWorld(app: App, start: World): () => void {
  let world = start;
  let dirty = false;
  const look = { style: 'satellite' as MapStyle, zones: false, grid: true, view: 'land' as MapView, season: 1 as 1 | -1 };

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
    climate.changed();
    updateUndo();
    tools.refresh();
  };
  const snapshot = () => {
    undoStack.push(world.surface.strokes);
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
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
  let showCurrentsView: (() => void) | null = null;
  let showPressureView: (() => void) | null = null;
  const tools = createToolPanel(() => {
    map?.redraw();
    // Drawing currents is done on the currents map.
    if (tools?.state.tool === 'current' && look.view !== 'currents') showCurrentsView?.();
    if (tools?.state.tool === 'high' && look.view !== 'pressure') showPressureView?.();
  }, () => map?.sketch ?? null, () => map?.high ?? null);
  const map = createMapView({
    world: () => world,
    tool: () => tools.state,
    look: () => look,
    notice: showNotice,
    begin(stroke) {
      const id = world.surface.nextId;
      const live: Stroke = { ...stroke, id };
      undoStack.push(world.surface.strokes);
      if (undoStack.length > 300) undoStack.shift();
      redoStack.length = 0;
      world = { ...world, surface: { strokes: [...world.surface.strokes, live], nextId: id + 1 } };
      changed();
      climate.changed();
      updateUndo();
      return live;
    },
    update(stroke) {
      const strokes = world.surface.strokes.slice();
      const i = strokes.findIndex((s) => s.id === stroke.id);
      if (i < 0) return;
      strokes[i] = stroke;
      world = { ...world, surface: { ...world.surface, strokes } };
      changed();
      climate.changed();
    },
    cancel: undo,
    snapshot,
    remove(id) {
      snapshot();
      setStrokes(world.surface.strokes.filter((x) => x.id !== id));
    },
    sketchSelected: () => tools.refresh(),
    climate: () => climate.climate,
  });

  // ---- Climate: worked out again a moment after painting pauses, or at once with the button. ----
  const climateStatus = h('span', { class: 'muted small', 'aria-live': 'polite' }, 'Working out the climate…');
  const climateBtn = h('button', { type: 'button', class: 'ghost small', title: 'Work the climate out again now.' }, 'Update climate');
  const climate = createClimateRunner(
    () => ({ surface: world.surface, settings: world.settings }),
    () => map.climateChanged(),
    (st) => {
      climateStatus.textContent = st === 'working' ? 'Working out the climate…' : st === 'waiting' ? 'Climate will update when you pause.' : 'Climate is up to date.';
      climateBtn.disabled = st === 'working';
    },
  );
  climateBtn.addEventListener('click', () => climate.now());
  climate.now();

  // ---- View options ----
  const legend = h(
    'table',
    { class: 'zone-legend small', hidden: true },
    h('thead', {}, h('tr', {}, h('th', {}, 'Zone'), h('th', {}, 'Travel · who can settle'))),
    h('tbody', {}, ...ZONES.map((z) => h('tr', {}, h('td', {}, h('span', { class: `swatch z${z.id}` }), z.name), h('td', {}, `${z.travel}. ${z.settle}.`)))),
  );
  const climateLegend = h('div', { class: 'climate-legend small' });
  const ramp = (stops: string[]) => h('div', { class: 'ramp', style: `background: linear-gradient(to right, ${stops.join(', ')})` });
  const key = (colour: string, text: string, line = false) => h('div', { class: 'key' }, h('span', { class: line ? 'swatch line' : 'swatch', style: `background: ${colour}` }), text);
  const renderClimateLegend = () => {
    const toHex = (c: number[]) => `rgb(${c.join(',')})`;
    const itcz = key('#ffffff', 'Dashed white line: the ITCZ, the belt of tropical rain', true);
    switch (look.view) {
      case 'zones':
        climateLegend.replaceChildren(...ZONE_INFO.map((z) => key(z.colour, z.name)), itcz);
        break;
      case 'temp':
        climateLegend.replaceChildren(ramp(TEMP_LEGEND.map(([, c]) => c)), h('div', { class: 'ramp-labels' }, ...TEMP_LEGEND.map(([t]) => h('span', {}, `${t}°F`))), h('p', { class: 'muted' }, 'Average temperature in the season shown; sea surface temperature at sea.'), itcz);
        break;
      case 'rain':
        climateLegend.replaceChildren(ramp(RAIN_LEGEND.map(toHex)), h('div', { class: 'ramp-labels' }, h('span', {}, 'Dry'), h('span', {}, 'Wet'), h('span', {}, 'Very wet')), h('p', { class: 'muted' }, `Rain in the season shown. White speckle on land is winter snow cover.`), itcz);
        break;
      case 'pressure':
        climateLegend.replaceChildren(key('#d67860', 'High pressure (H): dry, settled air; place them with the High pressure brush'), key('#96969e', 'Grey zone: fronts, where two highs’ winds meet (clouds, rain)'), key('#14181e', 'Arrows: winds circling each high and on to the ITCZ'), itcz);
        break;
      case 'currents':
        climateLegend.replaceChildren(key('#d23a2a', 'Warm current'), key('#2a6fd2', 'Cold current'), key('#111418', 'Neutral current (thin lines: secondary currents)'), key('#78dce6', 'Upwelling: cold, rich water (fishing, fog)'), key('#e4ecf1', 'Sea ice'), key('#5fd2c3', 'Coral reef'));
        break;
      default:
        climateLegend.replaceChildren();
    }
    climateLegend.hidden = look.view === 'land';
  };
  renderClimateLegend();
  const lookPanel = h(
    'section',
    { class: 'view-panel' },
    h('h2', {}, 'Map look'),
    choice<MapStyle>('Look', [{ value: 'satellite', label: 'Satellite' }, { value: 'paper', label: 'Paper' }], look.style, (v) => { look.style = v; map.redraw(); }),
    choice<'on' | 'off'>('Latitude lines', [{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }], 'on', (v) => { look.grid = v === 'on'; map.redraw(); }),
  );
  const zonesPanel = h(
    'section',
    { class: 'view-panel' },
    choice<'off' | 'on'>('Mountain zones', [{ value: 'off', label: 'Hidden' }, { value: 'on', label: 'Shown' }], 'off', (v) => { look.zones = v === 'on'; legend.hidden = !look.zones; map.redraw(); }),
    legend,
  );
  const mapChoice = choice<MapView>(
    'Map',
    [
      { value: 'land', label: 'Land' },
      { value: 'zones', label: 'Climate zones' },
      { value: 'temp', label: 'Temperature' },
      { value: 'rain', label: 'Rainfall' },
      { value: 'pressure', label: 'Pressure & winds' },
      { value: 'currents', label: 'Currents & sea' },
    ],
    look.view,
    (v) => { look.view = v; renderClimateLegend(); map.redraw(); },
  );
  showCurrentsView = () => mapChoice.querySelector<HTMLButtonElement>('button:nth-child(6)')?.click();
  showPressureView = () => mapChoice.querySelector<HTMLButtonElement>('button:nth-child(5)')?.click();
  const climatePanel = h(
    'section',
    { class: 'view-panel' },
    h('h2', {}, 'Climate maps'),
    h('div', { class: 'climate-run' }, climateBtn, climateStatus),
    h('button', { type: 'button', class: 'ghost small', title: 'Text describing the continents, the ITCZ and the currents, plus a compact copy of this world, to paste into a conversation.', onclick: () => void showReport() }, 'Climate report…'),
    mapChoice,
    choice<'1' | '-1'>('Season', [{ value: '1', label: 'Northern summer' }, { value: '-1', label: 'Northern winter' }], '1', (v) => { look.season = v === '1' ? 1 : -1; map.redraw(); }),
    climateLegend,
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

  const showReport = async () => {
    const box = h('textarea', { class: 'report-box', readonly: true, rows: 14, 'aria-label': 'Climate report' }) as HTMLTextAreaElement;
    const status = h('p', { class: 'muted small', 'aria-live': 'polite' }, climate.climate ? '' : 'The climate is still being worked out: the report has the world but no currents yet.');
    const copy = h('button', { type: 'button', class: 'primary' }, 'Copy');
    copy.addEventListener('click', async () => {
      box.focus();
      box.select();
      try {
        await navigator.clipboard.writeText(box.value);
        status.textContent = 'Copied. Paste it into the conversation.';
      } catch {
        const ok = document.execCommand?.('copy');
        status.textContent = ok ? 'Copied. Paste it into the conversation.' : 'Copying was blocked here: the text is selected, so use your device’s Copy (or long-press, Select all, Copy).';
      }
    });
    openDialog(
      h('h2', {}, 'Climate report'),
      h('p', { class: 'muted small' }, 'Where the continents sit, the ITCZ, and every major current (warm, cold or neutral, from where to where), for both seasons. The last line is a compact copy of this world, so the same climate can be rebuilt and checked.'),
      box,
      status,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => dialog.close() }, 'Close'), copy),
    );
    box.value = 'Writing the report…';
    box.value = await climateReport(world, climate.climate);
  };

  const canvasOptions = () => {
    const e: Expansion = { north: 0, south: 0, east: 0, west: 0 };
    // Dragging the size bar grows the map evenly on all sides, keeping its shape.
    const meter = sizeMeter((target) => {
      const s = world.settings;
      const a0 = s.widthKm * s.heightKm;
      const f = Math.max(1, Math.min(Math.sqrt(target / a0), MAX_SIDE_KM / Math.max(s.widthKm, s.heightKm)));
      const dw = s.widthKm * (f - 1);
      const dh = s.heightKm * (f - 1);
      const round = (km: number) => milesToKm(Math.round(kmToMiles(km) / 10) * 10);
      e.east = e.west = round(dw / 2);
      e.north = e.south = round(dh / 2);
      for (const [k, field] of Object.entries(fields)) field.querySelectorAll('input').forEach((i) => ((i as HTMLInputElement).value = String(Math.round(kmToMiles(e[k as keyof Expansion])))));
      update();
    });
    const preview = h('p', { class: 'summary' });
    const problem = h('p', { class: 'problems', role: 'alert' });
    const apply = h('button', { type: 'button', class: 'primary' }, 'Expand');
    const update = () => {
      const s = world.settings;
      const err = expansionProblem(world, e);
      apply.disabled = !!err;
      problem.textContent = err && err !== 'Choose how far to expand.' ? err : '';
      const next = expandedSettings(s, e);
      const grew = kmPerDegree(next) > kmPerDegree(s) + 1e-6;
      preview.textContent = `New size ${formatDistance(next.widthKm)} × ${formatDistance(next.heightKm)}, from ${formatLatitude(next.northLatitude)} to ${formatLatitude(southLatitude(next))}.${grew ? ' The map is now bigger than Earth: its planet grows, and each degree covers more ground.' : ''}`;
      meter.update(next, s);
    };
    const fields: Partial<Record<keyof Expansion, HTMLElement>> = {};
    const side = (k: keyof Expansion, label: string) =>
      (fields[k] = numberField({ label, value: 0, min: 0, max: 60000, step: 10, unit: 'miles', change: (v) => { e[k] = milesToKm(Math.max(0, v)); update(); } }));
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
      climate.now();
    });
    update();
    openDialog(
      h('h2', {}, 'Canvas options'),
      h('p', { class: 'muted small' }, 'Add ocean to any side. Nothing already on the map moves; growing north or south extends its latitudes.'),
      h('div', { class: 'expand-grid' }, side('north', 'North'), side('west', 'West'), side('east', 'East'), side('south', 'South')),
      preview,
      h('h3', {}, 'How big it is'),
      meter.el,
      degreeChoice(world.settings.degreeScale, (v) => {
        // Applies straight away: the painting stays, its latitudes rescale around the map's middle.
        const s = world.settings;
        const next = { ...s, degreeScale: v };
        next.northLatitude = placeAtLatitude(next, centreLatitude(s));
        world = { ...world, settings: next };
        changed();
        save();
        updateHead();
        map.worldReset();
        climate.now();
        update();
      }),
      h('p', { class: 'muted small' }, 'Degrees — Earth scale: the planet is Earth-sized and grows only once the map outgrows Earth. Match the map: the map is its whole world, so its planet and each degree shrink or grow with it.'),
      h('p', { class: 'muted small' }, 'Drag along the bar to grow the map (evenly on all sides), or click a planet to match its size. Hollow dot: the map now. Solid dot: after growing. Red line: its planet’s whole surface (when not Earth-sized).'),
      problem,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => dialog.close() }, 'Cancel'), apply),
    );
  };

  const worldSettings = () => {
    const s = { ...world.settings, climate: { ...world.settings.climate }, rainfall: { ...world.settings.rainfall } };
    const problems = h('ul', { class: 'problems', role: 'alert' });
    const apply = h('button', { type: 'button', class: 'primary' }, 'Apply');
    const setField = (field: HTMLElement, v: number) => field.querySelectorAll('input').forEach((i) => ((i as HTMLInputElement).value = String(Math.round(v * 10) / 10)));
    const locator = worldLocator((lat, lon) => {
      s.northLatitude = placeAtLatitude(s, lat);
      s.centreLongitude = lon;
      setField(latField, lat);
      check(true);
    });
    const latField = numberField({
      label: 'Centre latitude',
      value: Math.round(centreLatitude(s) * 10) / 10,
      min: -90,
      max: 90,
      step: 0.5,
      unit: '°',
      slider: true,
      hint: 'Moves the map north or south on its world (0: the equator runs through the middle). The painting stays; the climate follows.',
      change: (v) => { s.northLatitude = placeAtLatitude(s, v); check(); },
    });
    const check = (fromLocator = false) => {
      // A planet size change rescales the degrees: keep the map between the poles.
      s.northLatitude = placeAtLatitude(s, centreLatitude(s));
      if (s.mapType === 'flat' && !fromLocator) locator.update(s);
      const list = validateSettings(s);
      problems.replaceChildren(...list.map((p) => h('li', {}, p)));
      apply.disabled = list.length > 0;
    };
    // Deleting the world: asked here on the page (pop-ups can be blocked where the app is hosted).
    const dangerZone = h('div', { class: 'danger-zone' });
    const askDelete = () =>
      dangerZone.replaceChildren(
        h('span', { class: 'small' }, `Delete "${world.settings.name}" for good? This can't be undone.`),
        h('button', { type: 'button', class: 'danger-solid', onclick: () => {
          dirty = false;
          dialog.close();
          deleteWorld(app.store, world.id);
          toast(`Deleted "${world.settings.name}".`);
          app.start();
        } }, 'Delete'),
        h('button', { type: 'button', class: 'ghost', onclick: idleDelete }, 'Keep'),
      );
    const idleDelete = () => dangerZone.replaceChildren(h('button', { type: 'button', class: 'ghost danger', onclick: askDelete }, 'Delete this world…'));
    idleDelete();
    apply.addEventListener('click', () => {
      world = { ...world, settings: { ...s } };
      changed();
      save();
      dialog.close();
      updateHead();
      map.worldReset();
      climate.now();
    });
    check();
    openDialog(
      h('h2', {}, 'World settings'),
      h('div', { class: 'field' }, h('label', { for: 'ws-name' }, 'Name'), h('input', { id: 'ws-name', type: 'text', value: s.name, maxlength: 60, oninput: (ev: Event) => { s.name = (ev.target as HTMLInputElement).value; check(); } })),
      s.mapType === 'flat' ? h('div', {}, h('h3', {}, 'Where it sits on its world'), locator.el, latField) : '',
      planetFields(s, check),
      problems,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => dialog.close() }, 'Cancel'), apply),
      dangerZone,
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
  const layersPanel = h('section', {}, h('h2', {}, 'Layers'), layerList, h('p', { class: 'muted small' }, 'Other layers get their own views in a later phase.'));
  // Tabs: each shows only the tools and options for one kind of work.
  const TABS: { id: string; name: string; groups: string[]; extra: HTMLElement[] }[] = [
    { id: 'land', name: 'Land & water', groups: ['Land & Sea', 'Water', 'Sea'], extra: [] },
    { id: 'terrain', name: 'Terrain', groups: ['Relief', 'Volcanic', 'Mountain zones'], extra: [zonesPanel] },
    { id: 'cover', name: 'Ground cover', groups: ['Ground cover'], extra: [] },
    { id: 'climate', name: 'Climate', groups: ['Climate'], extra: [climatePanel] },
    { id: 'view', name: 'View', groups: [], extra: [lookPanel, layersPanel] },
  ];
  const tabBody = h('div', { class: 'tab-body' });
  const tabButtons = TABS.map((t) =>
    h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': 'false', onclick: () => showTab(t.id) }, t.name),
  );
  const showTab = (id: string) => {
    const t = TABS.find((x) => x.id === id) ?? TABS[0];
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', TABS[i] === t ? 'true' : 'false'));
    if (t.groups.length) tools.showGroups(t.groups);
    tabBody.replaceChildren(...(t.groups.length ? [notice, tools.el] : []), ...t.extra);
    map.redraw();
  };
  const side = h('aside', { class: 'side' }, h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Tool sets' }, ...tabButtons), tabBody);
  showTab('land');
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
    climate.dispose();
    map.dispose();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('keydown', keydown);
  };
}
