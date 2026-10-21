import { CLIMATE_DEFAULTS, cToF, fToC, type ClimateSliders, type WorldSettings } from '../core/settings';
import { kmToMiles, milesToKm } from '../core/units';
import { choice, h, numberField } from './dom';

/**
 * The planet and climate settings (REDESIGN.md, sections 4 and 7.2), shared by Create world and
 * the world's own settings panel. Edits `s` in place and calls `changed` after each edit.
 */
export function planetFields(s: WorldSettings, changed: () => void): HTMLElement {
  const set = <K extends keyof WorldSettings>(k: K, v: WorldSettings[K]) => {
    s[k] = v;
    changed();
  };
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
            change: (v) => set('rainfall', { mode: 'manual', percent: v }),
          })
        : h('p', { class: 'muted small' }, 'Rainfall follows the world’s temperature.'),
    );
  };
  renderRain();
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
    numberField({ label: 'Axial tilt', value: s.axialTilt, min: 0, max: 90, step: 0.5, unit: '°', slider: true, hint: 'Earth 23.5°. More tilt, harsher seasons; it also moves the tropics and polar circles.', change: (v) => set('axialTilt', v) }),
    numberField({ label: 'Day length', value: s.dayLengthHours, min: 4, max: 1000, step: 1, unit: 'hours', hint: 'Earth 24. Changes where the wind belts sit.', change: (v) => set('dayLengthHours', v) }),
    choice('Spin', [{ value: 'east', label: 'Eastward (like Earth)' }, { value: 'west', label: 'Westward' }], s.rotation, (v) => set('rotation', v)),
    numberField({ label: 'Average temperature', value: Math.round(cToF(s.averageTemperatureC)), min: -22, max: 122, step: 1, unit: '°F', slider: true, hint: 'Earth 59 °F. Drives rainfall unless you set it yourself.', change: (v) => set('averageTemperatureC', fToC(v)) }),
    choice(
      'Rainfall',
      [{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Set by hand' }],
      s.rainfall.mode,
      (v) => {
        set('rainfall', v === 'auto' ? { mode: 'auto' } : { mode: 'manual', percent: 100 });
        renderRain();
      },
    ),
    rainSlider,
    s.mapType === 'flat' ? sizeFields : null,
    climateSliders(s.climate, changed),
  );
}

/** The climate's tuning sliders, folded away, with a reset to Earth's values. Shown in °F and miles, kept in °C and km. */
function climateSliders(c: ClimateSliders, changed: () => void): HTMLElement {
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
      f('moistureCarryKm', 'Moisture carry distance', 100, 4000, 50, 'miles', 'How far rain-bearing air travels inland before drying out.', ...mi),
      f('blockingReliefKm', 'Rain shadow height', 500, 16000, 100, 'ft', 'Ranges this high stop moisture and cast a rain shadow.', (v) => v * 3280.84, (v) => v / 3280.84),
      heading('Temperature'),
      f('altitudeCoolingC', 'Cooling with height', 1, 7, 0.1, '°F per 1,000 ft', 'How much colder it gets higher up (Earth about 3.6).', ...lapse),
      heading('Ocean currents'),
      f('warmCurrentC', 'Warm current strength', 0, 54, 1, '°F', 'Peak warming of coasts by warm currents.', ...dF),
      f('coldCurrentC', 'Cold current strength', -45, 0, 1, '°F', 'Peak cooling of coasts by cold currents.', ...dF),
      f('currentSlopeKm', 'Current slope in open sea', 30, 600, 5, 'miles per degree', 'How far a current crosses open sea for each degree it moves north or south: smaller turns it toward the pole faster (Earth about 155).', ...mi),
      f('minCurrentTravelDeg', 'Minimum current travel', 5, 60, 1, '° latitude', 'Shorter currents change the climate less.'),
      heading('Coral reefs'),
      f('reefMinC', 'Coldest water reefs live in', 50, 86, 1, '°F', 'Reefs need the sea at least this warm all year (Earth about 64 °F).', ...F),
      f('reefMaxC', 'Warmest water reefs live in', 70, 100, 1, '°F', 'Hotter water bleaches reefs (Earth about 86 °F).', ...F),
      heading('Tropical rain belt (ITCZ)'),
      f('itczLandKm', 'Land width for full reach', 300, 6000, 50, 'miles', 'How wide a landmass must be for the rain belt to reach the tropic line over it.', ...mi),
      f('itczSeaKm', 'Sea width for full reach', 300, 8000, 50, 'miles', 'How wide open sea must be for the rain belt to sink to its lowest over it.', ...mi),
      f('itczRampKm', 'Coastal ramp', 0, 1500, 10, 'miles', 'How far offshore the belt starts bending toward the coast.', ...mi),
      h('button', { type: 'button', class: 'ghost', onclick: () => { Object.assign(c, CLIMATE_DEFAULTS); changed(); render(); } }, 'Reset to Earth’s values'),
    );
  };
  render();
  return h('details', { class: 'fold' }, h('summary', {}, 'Climate fine-tuning'), body);
}
