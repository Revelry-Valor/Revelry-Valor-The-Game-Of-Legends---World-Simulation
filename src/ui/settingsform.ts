import { CLIMATE_DEFAULTS, cToF, fToC, type ClimateSliders, type WorldSettings } from '../core/settings';
import { kmToMiles, milesToKm } from '../core/units';
import { choice, h, numberField } from './dom';

/**
 * The planet and climate settings (REDESIGN.md, sections 4 and 7.2). Create world shows them all;
 * on the world screen the planet's shape and spin stay in World settings, and everything that
 * changes the climate lives in the World tab. Each edits `s` in place and calls `changed` after
 * each edit.
 */
export function planetFields(s: WorldSettings, changed: () => void, opts: { climate?: boolean } = {}): HTMLElement {
  const climate = opts.climate ?? true;
  const set = <K extends keyof WorldSettings>(k: K, v: WorldSettings[K]) => {
    s[k] = v;
    changed();
  };
  // Flat maps: the planet's size is optional (Earth's is assumed otherwise).
  const sizeFields = h('div', {});
  const renderSize = () => {
    sizeFields.replaceChildren(
      choice('Planet size', [{ value: 'earth', label: 'Like Earth' }, { value: 'set', label: 'Set it' }], s.useRadius ? 'set' : 'earth', (v) => { set('useRadius', v === 'set'); renderSize(); }),
      s.useRadius
        ? numberField({ label: 'Planet radius', value: Math.round(kmToMiles(s.radiusKm)), min: 300, max: 62000, step: 10, unit: 'miles', hint: 'Earth 3,959 miles. A smaller planet has shorter distances between the climate belts.', change: (v) => set('radiusKm', milesToKm(v)) })
        : h('p', { class: 'muted small' }, 'An Earth-sized planet is assumed.'),
    );
  };
  renderSize();
  return h(
    'div',
    { class: 'group' },
    climate ? orbitFields(s, changed) : null,
    choice('Spin', [{ value: 'east', label: 'Eastward (like Earth)' }, { value: 'west', label: 'Westward' }], s.rotation, (v) => set('rotation', v)),
    s.mapType === 'flat' ? sizeFields : null,
    climate ? weatherFields(s, changed) : h('p', { class: 'muted small' }, 'Temperature, rainfall, tilt and the rest of the climate are in the World tab of the tools panel.'),
  );
}

function orbitFields(s: WorldSettings, changed: () => void): HTMLElement {
  return h(
    'div',
    { class: 'group' },
    numberField({ label: 'Axial tilt', value: s.axialTilt, min: 0, max: 90, step: 0.5, unit: '°', slider: true, hint: 'Earth 23.5°. More tilt, harsher seasons; it also moves the tropics, the polar circles and how far the ITCZ swings.', change: (v) => { s.axialTilt = v; changed(); } }),
    numberField({ label: 'Day length', value: s.dayLengthHours, min: 4, max: 1000, step: 1, unit: 'hours', hint: 'Earth 24. Changes where the wind belts sit.', change: (v) => { s.dayLengthHours = v; changed(); } }),
  );
}

/** Temperature, rainfall and the life balance, then the fine-tuning. */
function weatherFields(s: WorldSettings, changed: () => void, open = false): HTMLElement {
  const rainSlider = h('div', {});
  const renderRain = () => {
    rainSlider.replaceChildren(
      s.rainfall.mode === 'manual'
        ? numberField({
            label: 'Rainfall',
            value: s.rainfall.percent,
            min: 0,
            max: 200,
            step: 5,
            unit: '%',
            slider: true,
            hint: '100% is what the temperature would give. Lower is drier, higher is wetter.',
            change: (v) => { s.rainfall = { mode: 'manual', percent: v }; changed(); },
          })
        : h('p', { class: 'muted small' }, 'Rainfall follows the world’s temperature (a warmer world is wetter).'),
    );
  };
  renderRain();
  return h(
    'div',
    { class: 'group' },
    numberField({ label: 'Average temperature', value: Math.round(cToF(s.averageTemperatureC)), min: -22, max: 122, step: 1, unit: '°F', slider: true, hint: 'Earth 59 °F. Warms or cools the whole world; drives rainfall unless you set it yourself.', change: (v) => { s.averageTemperatureC = fToC(v); changed(); } }),
    choice('Rainfall', [{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Set by hand' }], s.rainfall.mode, (v) => {
      s.rainfall = v === 'auto' ? { mode: 'auto' } : { mode: 'manual', percent: 100 };
      changed();
      renderRain();
    }),
    rainSlider,
    lifeBalanceField(s.climate, changed),
    climateSliders(s.climate, changed, open),
  );
}

/** The life balance: 0 leaves the climate alone; one way favours living climates, the other deserts. */
export function lifeBalanceField(c: ClimateSliders, changed: () => void): HTMLElement {
  const describe = (v: number) =>
    v === 0 ? 'No push either way: the climate as the winds, currents and land make it.' : v > 0 ? `Greener: deserts lose ${v}% of their hold (highs, rain shadows and cold coasts dry the land less, and moisture reaches further); forests, savannas and grasslands spread.` : `Drier: deserts gain ${-v}% more hold (highs, rain shadows and cold coasts dry the land more, and moisture gives out sooner); deserts and steppes spread.`;
  const note = h('small', {}, describe(c.lifeBalance ?? 0));
  const field = numberField({
    label: 'Life balance',
    value: c.lifeBalance ?? 0,
    min: -100,
    max: 100,
    step: 5,
    slider: true,
    change: (v) => {
      c.lifeBalance = Math.max(-100, Math.min(100, Math.round(v)));
      note.textContent = describe(c.lifeBalance);
      changed();
    },
  });
  return h('div', { class: 'field' }, field, h('div', { class: 'balance-ends small muted' }, h('span', {}, '← Deserts stronger'), h('span', {}, 'Life stronger →')), note);
}

/** The climate's tuning sliders, with a reset to Earth's values. Shown in °F and miles, kept in °C and km. */
function climateSliders(c: ClimateSliders, changed: () => void, open = false): HTMLElement {
  const body = h('div', {});
  const round = (v: number, step: number) => Math.round(v / step) * step;
  const render = () => {
    const f = (k: keyof ClimateSliders, label: string, min: number, max: number, step: number, unit: string, hint: string, to: (v: number) => number = (v) => v, from: (v: number) => number = (v) => v) =>
      numberField({ label, value: round(to(c[k]), step), min, max, step, unit, slider: true, hint, change: (v) => { c[k] = from(v); changed(); } });
    const mi = [kmToMiles, milesToKm] as const;
    const dF = [(v: number) => v * 1.8, (v: number) => v / 1.8] as const;
    const F = [cToF, fToC] as const;
    const lapse = [(v: number) => (v * 1.8) / 3.28084, (v: number) => (v * 3.28084) / 1.8] as const;
    const heading = (t: string) => h('h4', { class: 'fold-head' }, t);
    body.replaceChildren(
      heading('Rain'),
      f('moistureCarryKm', 'Rain travel distance', 100, 4000, 50, 'miles', 'How far rain-bearing air travels inland from the coast before drying out (Earth about 1,250).', ...mi),
      f('blockingReliefKm', 'Rain shadow height', 500, 16000, 100, 'ft', 'Ranges this high stop moisture and cast a rain shadow.', (v) => v * 3280.84, (v) => v / 3280.84),
      heading('Temperature'),
      f('altitudeCoolingC', 'Cooling with height', 1, 7, 0.1, '°F per 1,000 ft', 'How much colder it gets higher up (Earth about 3.6).', ...lapse),
      heading('Ocean currents'),
      f('warmCurrentC', 'Warm current strength', 0, 54, 1, '°F', 'Peak warming of the water by warm currents.', ...dF),
      f('coldCurrentC', 'Cold current strength', -45, 0, 1, '°F', 'Peak cooling of the water by cold currents.', ...dF),
      heading('Coral reefs (comfort zone)'),
      f('reefMinC', 'Coldest water reefs live in', 50, 86, 1, '°F', 'Reefs need the sea at least this warm all year (Earth about 64 °F).', ...F),
      f('reefMaxC', 'Warmest water reefs live in', 70, 100, 1, '°F', 'Hotter water bleaches reefs (Earth about 86 °F).', ...F),
      heading('Tropical rain belt (ITCZ), automatic path'),
      f('itczLandKm', 'Land width for full reach', 300, 6000, 50, 'miles', 'How wide a landmass must be for the rain belt to reach the tropic line over it.', ...mi),
      f('itczSeaKm', 'Sea width for full reach', 300, 8000, 50, 'miles', 'How wide open sea must be for the rain belt to sink to its lowest over it.', ...mi),
      f('itczRampKm', 'Coastal ramp', 0, 1500, 10, 'miles', 'How far offshore the belt starts bending toward the coast. (Draw the ITCZ with its brush in the Climate tab to set it by hand.)', ...mi),
      h('button', { type: 'button', class: 'ghost', onclick: () => { Object.assign(c, CLIMATE_DEFAULTS); changed(); render(); } }, 'Reset to Earth’s values'),
    );
  };
  render();
  return h('details', { class: 'fold', open }, h('summary', {}, 'Climate fine-tuning'), body);
}

/** The World tab: everything that changes the whole world's climate, applied as you go. */
export function worldTabFields(s: WorldSettings, changed: () => void): HTMLElement {
  return h(
    'section',
    { class: 'view-panel' },
    h('h2', {}, 'World'),
    h('p', { class: 'muted small' }, 'Changes here apply to the whole world straight away; the climate updates when you pause.'),
    h('h3', {}, 'Seasons'),
    orbitFields(s, changed),
    h('h3', {}, 'Temperature and rain'),
    weatherFields(s, changed, true),
    h('h3', {}, 'The gods'),
    godFields(s, changed),
  );
}

/** Whether the gods act in this world, and how much (each god also has its own activity, in the Library). */
function godFields(s: WorldSettings, changed: () => void): HTMLElement {
  const g = { active: true, activity: 50, ...(s.gods ?? {}) };
  const set = () => {
    s.gods = { ...g };
    changed();
  };
  const level = h('div', {});
  const render = () =>
    level.replaceChildren(
      g.active
        ? numberField({ label: 'How active', value: g.activity, min: 0, max: 100, step: 5, slider: true, hint: '0: distant, they act once in an age. 100: meddling, always at work. Each god also has its own activity.', change: (v) => { g.activity = Math.max(0, Math.min(100, v)); set(); } })
        : h('p', { class: 'muted small' }, 'Religion is belief only: no miracles, blessings, champions or gods in person.'),
    );
  render();
  return h('div', { class: 'group' }, choice('Gods', [{ value: 'on', label: 'Act in the world' }, { value: 'off', label: 'Belief only' }], g.active ? 'on' : 'off', (v) => { g.active = v === 'on'; set(); render(); }), level);
}
