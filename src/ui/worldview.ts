import { latitudeAt, southLatitude, validateSettings } from '../core/settings';
import { formatDistance, formatLatitude, KM_PER_DEGREE, kmToMiles, milesToKm } from '../core/units';
import { expandWorld, expansionProblem, LAYERS, type Expansion, type LayerId, type World } from '../core/world';
import type { App } from './main';
import { h, numberField } from './dom';
import { planetFields } from './settingsform';

/**
 * The world screen (Phase 0): the empty map with its latitudes, the layer list, the world's
 * settings, and growing the canvas. Later phases add the painting tools on top.
 */
export function showWorld(app: App, start: World): () => void {
  let world = start;
  let dirty = false;
  let activeLayer: LayerId = 'surface';

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

  // ---- Map canvas ----
  const canvas = h('canvas', { class: 'map', 'aria-label': 'World map' });
  const readout = h('div', { class: 'readout small' }, 'Move over the map to measure.');
  const view = { cx: 0, cy: 0, scale: 1 }; // centre in km, pixels per km
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const s = world.settings;
    view.cx = s.widthKm / 2;
    view.cy = s.heightKm / 2;
    view.scale = Math.min(r.width / s.widthKm, r.height / s.heightKm) * 0.9 || 1;
    draw();
  };
  const toScreen = (x: number, y: number, r: DOMRect) => [r.width / 2 + (x - view.cx) * view.scale, r.height / 2 + (y - view.cy) * view.scale];
  const toWorld = (px: number, py: number, r: DOMRect) => [view.cx + (px - r.width / 2) / view.scale, view.cy + (py - r.height / 2) / view.scale];

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function draw() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css('--void');
    g.fillRect(0, 0, r.width, r.height);
    const s = world.settings;
    const [x0, y0] = toScreen(0, 0, r);
    const [x1, y1] = toScreen(s.widthKm, s.heightKm, r);

    // Wrapped maps show a faded copy either side so the wrap is visible.
    const copies = s.edges === 'wrap' ? [-1, 0, 1] : [0];
    for (const c of copies) {
      const off = c * (x1 - x0);
      g.globalAlpha = c === 0 ? 1 : 0.35;
      const sea = g.createLinearGradient(0, y0, 0, y1);
      sea.addColorStop(0, css('--sea-a'));
      sea.addColorStop(1, css('--sea-b'));
      g.fillStyle = sea;
      g.fillRect(x0 + off, y0, x1 - x0, y1 - y0);
    }
    g.globalAlpha = 1;

    // Latitude lines: every 5° or 10°, depending on zoom.
    const pxPerDeg = KM_PER_DEGREE * view.scale;
    const step = pxPerDeg > 40 ? 1 : pxPerDeg > 8 ? 5 : 10;
    const north = s.northLatitude;
    const south = southLatitude(s);
    const yAt = (lat: number) => toScreen(0, (north - lat) * KM_PER_DEGREE, r)[1];
    g.font = `11px ${css('--mono')}`;
    g.textBaseline = 'middle';
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      const y = yAt(lat);
      g.strokeStyle = css('--grid');
      g.lineWidth = 1;
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = css('--grid-text');
      g.fillText(formatLatitude(lat), Math.max(x0, 0) + 6, y - 7 < y0 + 8 ? y + 9 : y - 7);
    }

    // Named circles: equator, tropics and polar circles.
    const tilt = s.axialTilt;
    const named: [number, string][] = [[0, 'Equator']];
    if (tilt > 0) named.push([tilt, 'Tropic (north)'], [-tilt, 'Tropic (south)']);
    if (tilt < 90) named.push([90 - tilt, 'Arctic circle'], [-(90 - tilt), 'Antarctic circle']);
    for (const [lat, name] of named) {
      if (lat > north || lat < south) continue;
      const y = yAt(lat);
      g.strokeStyle = lat === 0 ? css('--equator') : css('--circle');
      g.lineWidth = lat === 0 ? 1.5 : 1;
      g.setLineDash(lat === 0 ? [] : [6, 5]);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = g.strokeStyle;
      const label = `${name} ${formatLatitude(lat)}`;
      g.fillText(label, Math.min(x1, r.width) - g.measureText(label).width - 6, y - 7);
    }

    // Border: solid for nothing-beyond, dashed east and west when it wraps.
    g.strokeStyle = css('--border-map');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y0);
    g.moveTo(x0, y1);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash(s.edges === 'wrap' ? [8, 6] : []);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0, y1);
    g.moveTo(x1, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);

    drawScale(g, r);
  }

  function drawScale(g: CanvasRenderingContext2D, r: DOMRect) {
    const targetPx = 140;
    const miles = kmToMiles(targetPx / view.scale);
    const p = 10 ** Math.floor(Math.log10(miles));
    const nice = [1, 2, 5, 10].map((m) => m * p).filter((m) => m <= miles).pop() ?? p;
    const px = milesToKm(nice) * view.scale;
    const x = 16;
    const y = r.height - 22;
    g.fillStyle = css('--panel');
    g.globalAlpha = 0.85;
    g.fillRect(x - 8, y - 22, px + 16, 34);
    g.globalAlpha = 1;
    g.strokeStyle = css('--ink');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y - 4);
    g.lineTo(x, y);
    g.lineTo(x + px, y);
    g.lineTo(x + px, y - 4);
    g.stroke();
    g.fillStyle = css('--ink');
    g.font = `11px ${css('--mono')}`;
    g.textBaseline = 'alphabetic';
    g.fillText(`${nice.toLocaleString('en-US')} mi (${Math.round(milesToKm(nice)).toLocaleString('en-US')} km)`, x, y - 8);
  }

  // Pan with drag (mouse or one finger), zoom with the wheel or two fingers.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const zoomAt = (factor: number, px: number, py: number) => {
    const r = canvas.getBoundingClientRect();
    const [wx, wy] = toWorld(px, py, r);
    const s = world.settings;
    const min = Math.min(r.width / s.widthKm, r.height / s.heightKm) * 0.2;
    view.scale = Math.min(Math.max(view.scale * factor, min), 50);
    view.cx = wx - (px - r.width / 2) / view.scale;
    view.cy = wy - (py - r.height / 2) / view.scale;
    draw();
  };
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const prev = pointers.get(e.pointerId);
    if (prev) {
      if (pointers.size === 1) {
        view.cx -= (e.clientX - prev.x) / view.scale;
        view.cy -= (e.clientY - prev.y) / view.scale;
        draw();
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch = d;
      }
    }
    const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top, r);
    const s = world.settings;
    if (y < 0 || y > s.heightKm || (s.edges === 'void' && (x < 0 || x > s.widthKm))) {
      readout.textContent = 'Off the map';
      return;
    }
    const xw = ((x % s.widthKm) + s.widthKm) % s.widthKm;
    readout.textContent = `${formatLatitude(latitudeAt(s, y))} · ${formatDistance(xw)} from the west edge · ${formatDistance(y)} from the north edge`;
  });
  canvas.addEventListener('pointerleave', () => (readout.textContent = 'Move over the map to measure.'));

  const resize = new ResizeObserver(() => draw());

  // ---- Layers ----
  const layerList = h('ul', { class: 'layers' });
  const renderLayers = () => {
    layerList.replaceChildren(
      ...LAYERS.map((l) => {
        const on = world.layers[l.id];
        const pick = h(
          'button',
          {
            type: 'button',
            class: 'layer-pick',
            'aria-pressed': activeLayer === l.id ? 'true' : 'false',
            disabled: !on || l.id !== 'surface',
            title: l.id === 'surface' ? 'The surface' : 'Each layer gets its own view in a later phase.',
            onclick: () => {
              activeLayer = l.id;
              renderLayers();
            },
          },
          l.name,
        );
        const toggle =
          l.id === 'surface'
            ? h('span', { class: 'muted small' }, 'Always on')
            : h('input', {
                type: 'checkbox',
                checked: on,
                'aria-label': `Use the ${l.name} layer`,
                onchange: (e: Event) => {
                  world = { ...world, layers: { ...world.layers, [l.id]: (e.target as HTMLInputElement).checked } };
                  changed();
                  renderLayers();
                },
              });
        return h('li', {}, pick, toggle);
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
      changed();
      save();
      dialog.close();
      updateHead();
      fit();
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
      draw();
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
          status,
          h('button', { type: 'button', class: 'primary', onclick: save }, 'Save'),
          h('button', { type: 'button', class: 'ghost', onclick: canvasOptions }, 'Canvas options'),
          h('button', { type: 'button', class: 'ghost', onclick: worldSettings }, 'World settings'),
          h('button', { type: 'button', class: 'ghost', onclick: leave }, 'Main menu'),
        ),
      ),
      h(
        'div',
        { class: 'workspace' },
        h('aside', { class: 'side' }, h('h2', {}, 'Layers'), layerList, h('p', { class: 'muted small' }, 'Painting tools arrive in Phase 1: land, sea depths, mountains and ground cover.')),
        h('div', { class: 'stage' }, canvas, h('div', { class: 'stage-controls' }, h('button', { type: 'button', class: 'ghost', onclick: fit }, 'Fit')), readout),
      ),
      dialog,
    ),
  );

  updateHead();
  renderLayers();
  resize.observe(canvas);
  requestAnimationFrame(fit);
  const beforeUnload = () => dirty && save();
  window.addEventListener('beforeunload', beforeUnload);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', draw);

  return () => {
    window.clearInterval(autosave);
    resize.disconnect();
    window.removeEventListener('beforeunload', beforeUnload);
    scheme.removeEventListener('change', draw);
  };
}
