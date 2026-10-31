import { brushDefaults, strokeBounds, ZONES, type Stroke } from '../core/paint';
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
import { planetFields, worldTabFields } from './settingsform';
import { createToolPanel, type NameOps } from './toolpanel';
import { freshWaters, geoCell, geoNames, GEO_DEFAULTS, lakeAt, REGION_KINDS, riverAt, type NameOf } from '../core/geography';
import { degreeChoice, sizeMeter, worldLocator } from './worldsize';
import { climateReport } from './report';
import { createPeoples, type Peoples } from './peoples';
import { loadSharedLibrary } from '../core/libstore';
import { createInfoPanel, createResourcePanel } from './info';

/**
 * The world screen: the map, the painting tools (Phase 1), the layer list, the world's
 * settings, and growing the canvas.
 */
export function showWorld(app: App, start: World): () => void {
  let world = start;
  let dirty = false;
  const look = { style: 'satellite' as MapStyle, zones: false, grid: true, view: 'land' as MapView, season: 1 as 1 | -1, labels: 'all' as 'all' | 'main' | 'off' };

  const status = h('span', { class: 'muted small', 'aria-live': 'polite' }, 'Saved');
  const save = () => {
    world = { ...world, ...(peoples ? { sim: peoples.pack() } : {}), updatedAt: Date.now() };
    if (app.save(world)) {
      dirty = false;
      status.textContent = `Saved ${new Date(world.updatedAt).toLocaleTimeString()}`;
    }
  };
  const changed = () => {
    dirty = true;
    status.textContent = 'Unsaved changes';
  };
  let peoples: Peoples | null = null;
  let climateBusy = true;
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
  let showRainView: (() => void) | null = null;
  const tools = createToolPanel(() => {
    map?.redraw();
    // Drawing currents is done on the currents map.
    if (tools?.state.tool === 'current' && look.view !== 'currents') showCurrentsView?.();
    if ((tools?.state.tool === 'high' || tools?.state.tool === 'wind') && look.view !== 'pressure') showPressureView?.();
    if (tools?.state.tool === 'itcz' && look.view !== 'rain' && look.view !== 'pressure') showRainView?.();
  }, () => map?.sketch ?? null, () => map?.high ?? null, () => nameOps);
  // The right-hand readers: what is under the cursor, and the selection's resources.
  const info = createInfoPanel();
  const resources = createResourcePanel();
  const map = createMapView({
    hover: (items) => info.show(items),
    world: () => world,
    tool: () => tools.state,
    look: () => look,
    notice: showNotice,
    begin(stroke) {
      const id = world.surface.nextId;
      const live: Stroke = { ...stroke, id };
      // Currents, winds and highs drawn for "the season shown" belong to the season on the map.
      if (live.season === 'shown') live.season = look.season === 1 ? 'summer' : 'winter';
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
    referenceEditing: () => refEdit && !!world.reference?.shown,
    referenceKeepShape: () => refKeep,
    setReference(ref, done) {
      world = { ...world, reference: ref };
      changed();
      if (done) renderRef();
    },
    overlay: () => peoples?.overlay ?? null,
  });

  // ---- Names: pins on the map that name the feature under them ----
  const riverTol = () => Math.max(3, map.pxKm() * 14);
  const featureAt = (x: number, y: number, of: NameOf): number => {
    if (of === 'lake') return lakeAt(world.surface, x, y, map.pxKm() * 6);
    if (of === 'river') return riverAt(world.surface, x, y, riverTol())?.id ?? -1;
    const cl = climate.climate;
    const g = cl?.geo;
    if (!cl || !g) return -1;
    const k = geoCell(cl, x, y);
    if (k < 0) return -1;
    if (of === 'land') return g.land[k];
    if (of === 'archipelago') return g.land[k] >= 0 ? g.archipelagoOf.get(g.land[k]) ?? -1 : -1;
    if (of === 'water') return g.water[k];
    return g.region[k];
  };
  const nameOps: NameOps = {
    picked: () => map.namePick(),
    at(x, y) {
      const cl = climate.climate;
      const g = cl?.geo;
      if (!cl || !g) return [];
      const k = geoCell(cl, x, y);
      if (k < 0) return [];
      const names = geoNames(world.surface, cl);
      const out: ReturnType<NameOps['at']> = [];
      const lk = lakeAt(world.surface, x, y, map.pxKm() * 6);
      if (lk >= 0) out.push({ of: 'lake', kind: 'Lake', name: names.lake.get(lk) ?? '' });
      const rv = riverAt(world.surface, x, y, riverTol());
      if (rv) out.push({ of: 'river', kind: 'River', name: names.river.get(rv.id) ?? '' });
      if (g.land[k] >= 0) {
        const f = g.landmasses.find((q) => q.id === g.land[k]);
        out.push({ of: 'land', kind: f?.kind ?? 'Land', name: names.land.get(g.land[k]) ?? '' });
        const a = g.archipelagoOf.get(g.land[k]);
        if (a !== undefined) out.push({ of: 'archipelago', kind: 'Islands', name: names.archipelago.get(a) ?? '' });
      }
      if (g.water[k] >= 0) out.push({ of: 'water', kind: g.waters.find((q) => q.id === g.water[k])?.kind ?? 'Sea', name: names.water.get(g.water[k]) ?? '' });
      if (g.region[k] >= 0) out.push({ of: 'region', kind: g.regions[g.region[k]]?.kind ?? 'Region', name: names.region.get(g.region[k]) ?? '' });
      return out;
    },
    set(x, y, of, label) {
      const target = featureAt(x, y, of);
      if (target < 0) return;
      // Pins already naming this feature: the latest is renamed; an empty name removes them all.
      const pins = world.surface.strokes.filter((st) => st.brush === 'name' && !st.erase && (st.nameOf ?? 'land') === of && (of === 'lake' ? lakeAt(world.surface, st.pts[0], st.pts[1], 2) : of === 'river' ? riverAt(world.surface, st.pts[0], st.pts[1], 5)?.id ?? -1 : featureAt(st.pts[0], st.pts[1], of)) === target);
      snapshot();
      if (!label) setStrokes(world.surface.strokes.filter((st) => !pins.includes(st)));
      else if (pins.length) {
        const last = pins[pins.length - 1];
        setStrokes(world.surface.strokes.map((st) => (st === last ? { ...st, label } : st)));
      } else {
        const id = world.surface.nextId;
        // A river's pin goes on the river itself, so it stays with it.
        let at = of === 'river' ? riverAt(world.surface, x, y, riverTol()) ?? { x, y } : { x, y };
        // A lake's pin goes in the lake: at the nearest of its dabs' middles.
        if (of === 'lake') {
          const l = freshWaters(world.surface).lakes.find((q) => q.id === target);
          if (l) {
            let bd = Infinity;
            for (let d = 0; d < l.dabs.length; d += 3) {
              const dd = Math.hypot(l.dabs[d] - x, l.dabs[d + 1] - y);
              if (dd < bd) {
                bd = dd;
                at = { x: l.dabs[d], y: l.dabs[d + 1] };
              }
            }
          }
        }
        const pin: Stroke = { ...brushDefaults('name'), id, pts: [Math.round(at.x * 100) / 100, Math.round(at.y * 100) / 100], label, nameOf: of };
        world = { ...world, surface: { strokes: [...world.surface.strokes, pin], nextId: id + 1 } };
        setStrokes(world.surface.strokes);
      }
      map.redraw();
    },
  };

  // ---- Reference picture: an image to paint from, laid over the map ----
  let refEdit = false;
  let refKeep = true;
  const refPanel = h('section', { class: 'view-panel' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true }) as HTMLInputElement;
  const importImage = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Scaled down so it saves with the world without filling the browser's storage.
      const max = 2048;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const cw = Math.max(1, Math.round(img.naturalWidth * k));
      const ch = Math.max(1, Math.round(img.naturalHeight * k));
      const cv = h('canvas', { width: cw, height: ch }) as HTMLCanvasElement;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, cw, ch);
      g.drawImage(img, 0, 0, cw, ch);
      const src = cv.toDataURL('image/jpeg', 0.85);
      const s = world.settings;
      const aspect = img.naturalWidth / img.naturalHeight;
      // Fit to the map's width, keeping its shape, centred top to bottom.
      const w = s.widthKm;
      const hh = w / aspect;
      const old = world.reference;
      world = { ...world, reference: { src, aspect, x: 0, y: (s.heightKm - hh) / 2, w, h: hh, opacity: old?.opacity ?? 0.5, shown: true, name: file.name } };
      changed();
      save();
      refEdit = false;
      renderRef();
      map.redraw();
      toast(`Imported "${file.name}". Line it up with Move & size on the map, or the fields here.`);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('That file could not be read as a picture.');
    };
    img.src = url;
  };
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) importImage(f);
    fileInput.value = '';
  });
  const setRef = (patch: Partial<NonNullable<World['reference']>>) => {
    if (!world.reference) return;
    world = { ...world, reference: { ...world.reference, ...patch } };
    changed();
    map.redraw();
  };
  const renderRef = () => {
    const ref = world.reference;
    const pick = h('button', { type: 'button', class: 'ghost small', onclick: () => fileInput.click() }, ref ? 'Replace image…' : 'Import image…');
    if (!ref) {
      refPanel.replaceChildren(h('p', { class: 'muted small' }, 'Lay a picture over the map to paint from: an atlas page, a sketch of your world, or a map of Earth. Stretch it, size it and fade it as you like. It is only for looking at; the world never reads it.'), pick, fileInput);
      return;
    }
    const mi = (km: number) => Math.round(kmToMiles(km));
    const sizeFields: Partial<Record<'w' | 'h', HTMLElement>> = {};
    const showSize = (key: 'w' | 'h', km: number) => sizeFields[key]?.querySelectorAll('input').forEach((i) => ((i as HTMLInputElement).value = String(mi(km))));
    const sizeField = (label: string, key: 'w' | 'h') =>
      (sizeFields[key] = numberField({ label, value: mi(ref[key]), min: 10, max: Math.round(kmToMiles(MAX_SIDE_KM * 2)), step: 10, unit: 'miles', change: (v) => {
        if (!(v > 0)) return;
        const km = milesToKm(v);
        const cur = world.reference!;
        const ratio = cur.w / cur.h;
        if (refKeep) {
          const patch = key === 'w' ? { w: km, h: km / ratio } : { h: km, w: km * ratio };
          setRef(patch);
          showSize(key === 'w' ? 'h' : 'w', key === 'w' ? patch.h : patch.w);
        } else setRef({ [key]: km });
      } }));
    const posField = (label: string, key: 'x' | 'y', hint: string) =>
      numberField({ label, value: mi(ref[key]), min: -60000, max: 60000, step: 10, unit: 'miles', hint, change: (v) => { if (Number.isFinite(v)) setRef({ [key]: milesToKm(v) }); } });
    const s = world.settings;
    refPanel.replaceChildren(
      h('p', { class: 'muted small' }, ref.name ? `“${ref.name}”` : 'A picture to paint from.'),
      choice<'on' | 'off'>('Show', [{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }], ref.shown ? 'on' : 'off', (v) => { setRef({ shown: v === 'on' }); if (v === 'off') { refEdit = false; renderRef(); } }),
      numberField({ label: 'Opacity', value: Math.round(ref.opacity * 100), min: 0, max: 100, step: 1, unit: '%', slider: true, hint: 'See-through at 0%, solid at 100%.', change: (v) => setRef({ opacity: Math.max(0, Math.min(100, v)) / 100 }) }),
      h('label', { class: 'field-row small' }, h('input', { type: 'checkbox', checked: refEdit, disabled: !ref.shown, onchange: (e: Event) => { refEdit = (e.target as HTMLInputElement).checked; map.redraw(); } }), 'Move & size on the map'),
      h('p', { class: 'muted small' }, 'While this is ticked, drag the picture to move it and drag a corner to stretch it (the map pans only outside the picture). Untick it to paint again.'),
      h('label', { class: 'field-row small' }, h('input', { type: 'checkbox', checked: refKeep, onchange: (e: Event) => { refKeep = (e.target as HTMLInputElement).checked; } }), 'Keep its shape when sizing'),
      sizeField('Width', 'w'),
      sizeField('Height', 'h'),
      posField('From the west edge', 'x', 'Where its left side sits.'),
      posField('From the north edge', 'y', 'Where its top sits.'),
      h('div', { class: 'sketch-actions' },
        h('button', { type: 'button', class: 'ghost small', title: 'Stretch it to cover the whole map exactly (for a world map with the same edges)', onclick: () => { setRef({ x: 0, y: 0, w: s.widthKm, h: s.heightKm }); renderRef(); } }, 'Stretch to the map'),
        h('button', { type: 'button', class: 'ghost small', title: 'As wide as the map, in its own shape', onclick: () => { const hh = s.widthKm / ref.aspect; setRef({ x: 0, y: (s.heightKm - hh) / 2, w: s.widthKm, h: hh }); renderRef(); } }, 'Fit to the width'),
        h('button', { type: 'button', class: 'ghost small', title: 'Undo any stretching: back to its own shape, keeping its width', onclick: () => { setRef({ h: world.reference!.w / ref.aspect }); renderRef(); } }, 'Its own shape'),
      ),
      h('div', { class: 'sketch-actions' }, pick, h('button', { type: 'button', class: 'ghost small danger', onclick: () => { world = { ...world, reference: null }; refEdit = false; changed(); renderRef(); map.redraw(); } }, 'Remove')),
      fileInput,
    );
  };
  renderRef();

  // ---- Climate: worked out again a moment after painting pauses, or at once with the button. ----
  const climateStatus = h('span', { class: 'muted small', 'aria-live': 'polite' }, 'Working out the climate…');
  const climateBtn = h('button', { type: 'button', class: 'ghost small', title: 'Work the climate out again now.' }, 'Update climate');
  const climate = createClimateRunner(
    () => ({ surface: world.surface, settings: world.settings }),
    () => {
      map.climateChanged();
      peoples?.climateChanged();
    },
    (st) => {
      climateBusy = st !== 'idle';
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
    const itcz = key('#ffffff', 'Dashed white line: the ITCZ, the belt of tropical rain (draw it by hand with the ITCZ brush; yellow lines)', true);
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
        climateLegend.replaceChildren(key('#d67860', 'High pressure (H): dry, settled air; place them with the High pressure brush'), key('#14181e', 'Winds, as drawn with the Wind brush'), key('#96969e', 'Grey zone: fronts, where winds run into each other (clouds, rain)'), itcz);
        break;
      case 'currents':
        climateLegend.replaceChildren(key('#d23a2a', 'Warm current'), key('#2a6fd2', 'Cold current'), key('#111418', 'Neutral current (thin lines: secondary currents)'), key('#78dce6', 'Upwelling: cold, rich water (fishing, fog)'), key('#e4ecf1', 'Sea ice'), key('#5fd2c3', 'Coral reef'));
        break;
      case 'geo':
        climateLegend.replaceChildren(
          ...Object.entries(REGION_KINDS).map(([k, c]) => key(c, k)),
          key('#2e588c', 'Ocean'),
          key('#467ab2', 'Sea'),
          key('#609cc8', 'Gulf'),
          key('#7ebad8', 'Bay'),
          h('p', { class: 'muted' }, 'Natural regions, worked out from the land, its height, climate and ground cover, and parted by mountain crests and big rivers. Change them in the Geography tab: Divide, Join and Name.'),
        );
        break;
      case 'air':
        climateLegend.replaceChildren(
          ramp(['#e6e0cc', '#8fbfb8', '#16808c']),
          h('div', { class: 'ramp-labels' }, h('span', {}, 'Dry air'), h('span', {}, 'Moist air')),
          h('p', { class: 'muted' }, 'How much moisture the air carries in the season shown. Over the sea it is refilled (lots over warm water, little over cold); from the coast inland it is spent as rain and fades with distance (Climate fine-tuning: moisture reach). Each drawn wind is coloured by the temperature of the air it carries.'),
          ramp(TEMP_LEGEND.map(([, c]) => c)),
          h('div', { class: 'ramp-labels' }, ...TEMP_LEGEND.map(([t]) => h('span', {}, `${t}°F`))),
          itcz,
        );
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
    choice<MapStyle>('Look', [{ value: 'satellite', label: 'Satellite' }, { value: 'paper', label: 'Paper' }], look.style, (v) => { look.style = v; map.redraw(); }),
    choice<'on' | 'off'>('Latitude lines', [{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }], 'on', (v) => { look.grid = v === 'on'; map.redraw(); }),
    choice<'all' | 'main' | 'off'>('Labels', [{ value: 'all', label: 'All' }, { value: 'main', label: 'Land & sea only' }, { value: 'off', label: 'Hidden' }], look.labels, (v) => { look.labels = v; map.redraw(); }),
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
      { value: 'air', label: 'Air & moisture' },
      { value: 'geo', label: 'Geography' },
    ],
    look.view,
    (v) => { look.view = v; renderClimateLegend(); map.redraw(); },
  );
  showCurrentsView = () => mapChoice.querySelector<HTMLButtonElement>('button:nth-child(6)')?.click();
  showPressureView = () => mapChoice.querySelector<HTMLButtonElement>('button:nth-child(5)')?.click();
  showRainView = () => mapChoice.querySelector<HTMLButtonElement>('button:nth-child(4)')?.click();
  // The Climate tab (creating): working the climate out, and the report.
  const climatePanel = h(
    'section',
    { class: 'view-panel' },
    h('h2', {}, 'Climate'),
    h('div', { class: 'climate-run' }, climateBtn, climateStatus),
    h('button', { type: 'button', class: 'ghost small', title: 'Text describing the continents, the ITCZ and the currents, plus a compact copy of this world, to paste into a conversation.', onclick: () => void showReport() }, 'Climate report…'),
    h('p', { class: 'muted small' }, 'Choose which climate map to look at in the View panel on the right.'),
  );
  // The View panel (looking): which map, which season, and how it looks.
  const seasonChoice = choice<'1' | '-1'>('Season', [{ value: '1', label: 'Northern summer' }, { value: '-1', label: 'Northern winter' }], '1', (v) => { look.season = v === '1' ? 1 : -1; tools.refresh(); map.redraw(); });
  const mapPanel = h(
    'section',
    { class: 'view-panel' },
    mapChoice,
    seasonChoice,
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
      planetFields(s, check, { climate: false }),
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
  const layersPanel = h('section', { class: 'view-panel' }, layerList, h('p', { class: 'muted small' }, 'Other layers get their own views in a later phase.'));
  // Tabs: each shows only the tools and options for one kind of work.
  // The World tab: temperature, rain and the rest of the world's climate, applied as you go.
  const worldPanel = h('div', {});
  const renderWorldTab = () => {
    const s = { ...world.settings, climate: { ...world.settings.climate }, rainfall: { ...world.settings.rainfall } };
    const problems = h('ul', { class: 'problems', role: 'alert' });
    worldPanel.replaceChildren(
      worldTabFields(s, () => {
        const next = { ...world.settings, axialTilt: s.axialTilt, dayLengthHours: s.dayLengthHours, averageTemperatureC: s.averageTemperatureC, rainfall: { ...s.rainfall }, climate: { ...s.climate }, ...(s.gods ? { gods: { ...s.gods } } : {}) };
        const list = validateSettings(next);
        problems.replaceChildren(...list.map((p) => h('li', {}, p)));
        if (list.length) return;
        world = { ...world, settings: next };
        changed();
        climate.changed();
        map.redraw();
      }),
      problems,
    );
  };
  // The Geography tab's own settings: when land counts as a continent, and how big regions are.
  const geoPanel = h('div', {});
  const renderGeoPanel = () => {
    const gs = { ...GEO_DEFAULTS, ...(world.settings.geography ?? {}) };
    const apply = (patch: Partial<typeof gs>) => {
      world = { ...world, settings: { ...world.settings, geography: { ...gs, ...patch } } };
      Object.assign(gs, patch);
      changed();
      climate.changed();
    };
    geoPanel.replaceChildren(
      h('section', { class: 'view-panel' },
        h('h2', {}, 'Geography'),
        h('p', { class: 'muted small' }, 'Continents, islands, oceans, seas, gulfs, bays and natural regions are worked out with the climate. Divide cuts one in two, Join makes several one, and Name names them. Labels and the Geography map are in the View panel.'),
        numberField({ label: 'Smallest continent', value: gs.continentMinSqMi, min: 10000, max: 20000000, step: 10000, unit: 'sq mi', hint: 'Landmasses at least this big are continents; smaller ones are islands. Earth: Australia (about 3 million) is the smallest continent, Greenland (about 840,000) the biggest island.', change: (v) => { if (v > 0) apply({ continentMinSqMi: v }); } }),
        numberField({ label: 'Region size', value: gs.regionMi, min: 60, max: 1200, step: 10, unit: 'miles', slider: true, hint: 'About how far across a natural region usually is.', change: (v) => { if (v > 0) apply({ regionMi: v }); } }),
      ),
    );
  };
  // The Peoples tab: the first peoples, placed and run on (Phase 6).
  peoples = createPeoples({
    world: () => world,
    library: () => world.library ?? loadSharedLibrary(app.store),
    climate: () => climate.climate,
    surface: () => world.surface,
    redraw: () => map.redraw(),
    changed,
    setSeason(season) {
      if (look.season === season) return;
      look.season = season;
      requestAnimationFrame(() => refreshDrops());
      seasonChoice.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', (i === 0) === (season === 1) ? 'true' : 'false'));
      tools.refresh();
      map.redraw();
    },
    climateBusy: () => climateBusy,
    selectionChanged: () => resources.show(peoples?.resources() ?? null),
    openPeoples: () => showTab('peoples'),
    openLibrary: () => {
      save();
      app.library(world);
    },
  });
  map.el.append(peoples.bar);
  if (climate.climate) peoples.climateChanged();
  const TABS: { id: string; name: string; groups: string[]; extra: HTMLElement[] }[] = [
    { id: 'land', name: 'Land & water', groups: ['Land & Sea', 'Water', 'Sea'], extra: [] },
    { id: 'terrain', name: 'Terrain', groups: ['Relief', 'Volcanic', 'Mountain zones'], extra: [] },
    { id: 'cover', name: 'Ground cover', groups: ['Ground cover'], extra: [] },
    { id: 'climate', name: 'Climate', groups: ['Climate'], extra: [climatePanel] },
    { id: 'geo', name: 'Geography', groups: ['Geography'], extra: [geoPanel] },
    { id: 'world', name: 'World', groups: [], extra: [worldPanel] },
    { id: 'peoples', name: 'Peoples', groups: [], extra: [peoples.panel] },
  ];
  const tabBody = h('div', { class: 'tab-body' });
  const tabButtons = TABS.map((t) =>
    h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': 'false', onclick: () => showTab(t.id) }, t.name),
  );
  const showTab = (id: string) => {
    const t = TABS.find((x) => x.id === id) ?? TABS[0];
    if (t.id === 'world') renderWorldTab();
    if (t.id === 'geo') renderGeoPanel();
    peoples?.setActive(t.id === 'peoples');
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', TABS[i] === t ? 'true' : 'false'));
    if (t.groups.length) tools.showGroups(t.groups);
    tabBody.replaceChildren(...(t.groups.length ? [notice, tools.el] : []), ...t.extra);
    map.redraw();
  };
  // The creation panel folds away to the left; a slim tab on the map's edge brings it back.
  const setSide = (open: boolean) => {
    side.classList.toggle('closed', !open);
    sideStrip.hidden = open;
    sideToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    map.redraw();
  };
  const collapse = h('button', { type: 'button', class: 'ghost small collapse', title: 'Fold the creation panel away', 'aria-label': 'Fold the creation panel away', onclick: () => setSide(false) }, '«');
  const side = h('aside', { class: 'side' }, h('div', { class: 'side-head' }, h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Tool sets' }, ...tabButtons), collapse), tabBody);
  const sideStrip = h('button', { type: 'button', class: 'side-strip', hidden: true, title: 'Open the creation panel', onclick: () => setSide(true) }, 'Create »');
  showTab('land');
  sideToggle.addEventListener('click', () => setSide(side.classList.contains('closed')));
  // The View panel on the right: what you're looking at, kept apart from the tools for making.
  // Each section is a drop-down: its title and what it is set to now, opened to change it.
  const MAP_NAMES: Record<string, string> = { land: 'Land', zones: 'Climate zones', temp: 'Temperature', rain: 'Rainfall', pressure: 'Pressure & winds', currents: 'Currents & sea', air: 'Air & moisture', geo: 'Geography' };
  const drop = (title: string, now: () => string, open: boolean, ...body: HTMLElement[]) => {
    const value = h('span', { class: 'drop-now' }, now());
    const el = h('details', { class: 'drop', open }, h('summary', {}, h('span', { class: 'drop-title' }, title), value), h('div', { class: 'drop-body' }, ...body));
    return { el, refresh: () => (value.textContent = now()) };
  };
  const drops = [
    drop('View', () => `${MAP_NAMES[look.view] ?? look.view} · ${look.season === 1 ? 'northern summer' : 'northern winter'}`, false, mapPanel),
    drop('Map look', () => `${look.style === 'paper' ? 'Paper' : 'Satellite'}${look.zones ? ' · mountain zones' : ''}`, false, lookPanel, zonesPanel),
    drop('Layers', () => LAYERS.filter((l) => world.layers[l.id]).map((l) => l.name).join(', ') || 'Surface', false, layersPanel),
    drop('Reference image', () => (world.reference ? 'One laid over the map' : 'None'), false, refPanel),
  ];
  const refreshDrops = () => drops.forEach((d) => d.refresh());
  const viewSide = h('aside', { class: 'side view-side', 'aria-label': 'View' },
    resources.el,
    h('div', { class: 'drops' }, ...drops.map((d) => d.el)),
    info.el,
  );
  // The summaries follow any change made in them.
  viewSide.addEventListener('click', () => requestAnimationFrame(refreshDrops));
  viewSide.addEventListener('change', () => requestAnimationFrame(refreshDrops));
  const viewToggle = h('button', { type: 'button', class: 'ghost side-toggle', 'aria-expanded': 'true', title: 'Show or hide the View panel' }, 'View');
  // On a phone the screen is too small for both panels and the map: the View panel starts hidden.
  if (window.matchMedia?.('(max-width: 720px)').matches) {
    viewSide.classList.add('closed');
    viewToggle.setAttribute('aria-expanded', 'false');
  }
  viewToggle.addEventListener('click', () => {
    const open = viewSide.classList.toggle('closed');
    viewToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
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
          viewToggle,
          undoBtn,
          redoBtn,
          status,
          h('button', { type: 'button', class: 'primary', onclick: save }, 'Save'),
          h('button', { type: 'button', class: 'ghost', onclick: canvasOptions }, 'Canvas options'),
          h('button', { type: 'button', class: 'ghost', onclick: worldSettings }, 'World settings'),
          h('button', { type: 'button', class: 'ghost', title: 'This world’s peoples, beasts, traits and resources', onclick: () => { save(); app.library(world); } }, 'Library'),
          h('button', { type: 'button', class: 'ghost', onclick: leave }, 'Main menu'),
        ),
      ),
      h('div', { class: 'workspace' }, side, sideStrip, map.el, viewSide),
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
    peoples?.dispose();
    map.dispose();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('keydown', keydown);
  };
}
