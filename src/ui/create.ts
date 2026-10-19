import { centreLatitude, defaultSettings, MAX_SIDE_KM, placeAtLatitude, SIZE_PRESETS, southLatitude, validateSettings, type SizePresetId } from '../core/settings';
import { formatDistance, formatLatitude, kmToMiles, milesToKm } from '../core/units';
import { createWorld } from '../core/world';
import type { App } from './main';
import { choice, h, numberField } from './dom';
import { planetFields } from './settingsform';
import { sizeMeter, worldLocator } from './worldsize';

/** The Create world form: the world's size, its place on the globe, and its planet. */
export function showCreate(app: App): void {
  const s = defaultSettings();
  let preset: SizePresetId | 'custom' = 'continent';
  let centre = 0;
  let widthMi = 2000;
  let heightMi = 1200;

  const summary = h('p', { class: 'summary' });
  const latField = numberField({
    label: 'Centre latitude',
    value: centre,
    min: -90,
    max: 90,
    step: 0.5,
    unit: '°',
    slider: true,
    hint: '0 puts the equator through the middle; positive moves the map north, negative south. You can change it later in World settings.',
    change: (v) => { centre = v; update(); },
  });
  const lonField = numberField({
    label: 'Centre longitude',
    value: 0,
    min: -180,
    max: 180,
    step: 1,
    unit: '°',
    slider: true,
    hint: 'East or west around the world. It places the map; the climate doesn’t depend on it.',
    change: (v) => { s.centreLongitude = v; update(); },
  });
  const problems = h('ul', { class: 'problems', role: 'alert' });
  const custom = h('div', { class: 'group' });
  const create = h('button', { type: 'submit', class: 'primary' }, 'Create world');

  const meter = sizeMeter();
  const setField = (field: HTMLElement, v: number) => field.querySelectorAll('input').forEach((i) => ((i as HTMLInputElement).value = String(Math.round(v * 10) / 10)));
  const locator = worldLocator((lat, lon) => {
    centre = lat;
    s.centreLongitude = lon;
    setField(latField, lat);
    setField(lonField, lon);
    update(true);
  });
  const update = (fromLocator = false) => {
    s.widthKm = milesToKm(widthMi);
    s.heightKm = milesToKm(heightMi);
    // Kept between the poles; on a planet grown to fit the map, the degrees grow too.
    s.northLatitude = placeAtLatitude(s, centre);
    if (!fromLocator) locator.update(s);
    if (Math.abs(centreLatitude(s) - centre) > 0.05) {
      centre = centreLatitude(s);
      setField(latField, centre);
    }
    meter.update(s);
    summary.textContent = `${formatDistance(s.widthKm)} wide, ${formatDistance(s.heightKm)} tall, from ${formatLatitude(s.northLatitude)} to ${formatLatitude(southLatitude(s))}.`;
    const list = validateSettings(s);
    problems.replaceChildren(...list.map((p) => h('li', {}, p)));
    create.disabled = list.length > 0;
  };

  const renderCustom = () => {
    custom.replaceChildren(
      ...(preset === 'custom'
        ? [
            numberField({ label: 'Width', value: widthMi, min: 35, max: Math.round(kmToMiles(MAX_SIDE_KM)), step: 10, unit: 'miles', change: (v) => { widthMi = v; update(); } }),
            numberField({ label: 'Height', value: heightMi, min: 35, max: Math.round(kmToMiles(MAX_SIDE_KM)), step: 10, unit: 'miles', change: (v) => { heightMi = v; update(); } }),
          ]
        : []),
    );
  };

  const sizeChoice = choice<SizePresetId | 'custom'>(
    'Size',
    [...SIZE_PRESETS.map((p) => ({ value: p.id as SizePresetId, label: `${p.name} · ${p.widthMi.toLocaleString('en-US')} × ${p.heightMi.toLocaleString('en-US')} mi` })), { value: 'custom', label: 'Custom…' }],
    preset,
    (v) => {
      preset = v;
      const p = SIZE_PRESETS.find((x) => x.id === v);
      if (p) {
        widthMi = p.widthMi;
        heightMi = p.heightMi;
      }
      renderCustom();
      update();
    },
  );

  const form = h(
    'form',
    { class: 'create', novalidate: true },
    h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'ghost', onclick: () => app.start() }, '← Back'), h('h1', {}, 'Create world')),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'The world'),
      h('div', { class: 'field' }, h('label', { for: 'world-name' }, 'Name'), h('input', { id: 'world-name', type: 'text', value: s.name, maxlength: 60, oninput: (e: Event) => { s.name = (e.target as HTMLInputElement).value; update(); } })),
      choice(
        'Map type',
        [
          { value: 'flat', label: 'Flat map (a region of a world)' },
          { value: 'globe', label: 'Globe (a whole planet) · later phase', disabled: true, title: 'The 3D globe is built in a later phase.' },
        ],
        'flat',
        () => {},
      ),
      sizeChoice,
      custom,
      h('h3', {}, 'Where it sits on its world'),
      locator.el,
      latField,
      lonField,
      choice('Past the east and west edges', [{ value: 'void', label: 'Nothing (no effect)' }, { value: 'wrap', label: 'The ocean wraps around' }], s.edges, (v) => { s.edges = v; }),
      summary,
      h('h3', {}, 'How big it is'),
      meter.el,
    ),
    h('section', { class: 'card' }, h('h2', {}, 'The planet'), planetFields(s, update)),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Seed'),
      numberField({ label: 'Seed', value: s.seed, min: 0, max: 999999999, step: 1, hint: 'Fixes all randomness: the same seed and drawing always give the same world.', change: (v) => { s.seed = Math.floor(v); } }),
    ),
    problems,
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => app.start() }, 'Cancel'), create),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (validateSettings(s).length) return update();
    const world = createWorld(s);
    if (app.save(world)) app.open(world);
  });

  renderCustom();
  update();
  app.root.append(h('main', { class: 'page' }, form));
}
