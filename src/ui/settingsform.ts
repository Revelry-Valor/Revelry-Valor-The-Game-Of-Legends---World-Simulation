import { CLIMATE_DEFAULTS, type ClimateSliders, type WorldSettings } from '../core/settings';
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
  return h(
    'div',
    { class: 'group' },
    numberField({ label: 'Axial tilt', value: s.axialTilt, min: 0, max: 90, step: 0.5, unit: '°', slider: true, hint: 'Earth 23.5°. More tilt, harsher seasons; it also moves the tropics and polar circles.', change: (v) => set('axialTilt', v) }),
    numberField({ label: 'Day length', value: s.dayLengthHours, min: 4, max: 1000, step: 1, unit: 'hours', hint: 'Earth 24. Changes where the wind belts sit.', change: (v) => set('dayLengthHours', v) }),
    choice('Spin', [{ value: 'east', label: 'Eastward (like Earth)' }, { value: 'west', label: 'Westward' }], s.rotation, (v) => set('rotation', v)),
    numberField({ label: 'Average temperature', value: s.averageTemperatureC, min: -30, max: 50, step: 0.5, unit: '°C', slider: true, hint: 'Earth 15 °C. Drives rainfall unless you set it yourself.', change: (v) => set('averageTemperatureC', v) }),
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
    climateSliders(s.climate, changed),
  );
}

/** The climate's tuning sliders, folded away, with a reset to Earth's values. */
function climateSliders(c: ClimateSliders, changed: () => void): HTMLElement {
  const body = h('div', {});
  const render = () => {
    const f = (k: keyof ClimateSliders, label: string, min: number, max: number, step: number, unit: string, hint: string) =>
      numberField({ label, value: c[k], min, max, step, unit, slider: true, hint, change: (v) => { c[k] = v; changed(); } });
    body.replaceChildren(
      f('moistureCarryKm', 'Moisture carry distance', 200, 6000, 100, 'km', 'How far rain-bearing air travels inland before drying out.'),
      f('blockingReliefKm', 'Rain shadow height', 0.2, 5, 0.1, 'km', 'Ranges this high stop moisture and cast a rain shadow.'),
      f('warmCurrentC', 'Warm current strength', 0, 30, 0.5, '°C', 'Peak warming of coasts by warm currents.'),
      f('coldCurrentC', 'Cold current strength', -25, 0, 0.5, '°C', 'Peak cooling of coasts by cold currents.'),
      f('reefMinC', 'Reef water temperature', 10, 30, 0.5, '°C', 'Coldest-season sea temperature reefs need.'),
      f('altitudeCoolingC', 'Cooling with height', 2, 12, 0.1, '°C per km', 'How much colder it gets higher up.'),
      f('minCurrentTravelDeg', 'Minimum current travel', 5, 60, 1, '° latitude', 'Shorter currents don’t change the climate.'),
      h('button', { type: 'button', class: 'ghost', onclick: () => { Object.assign(c, CLIMATE_DEFAULTS); changed(); render(); } }, 'Reset to Earth’s values'),
    );
  };
  render();
  return h('details', { class: 'fold' }, h('summary', {}, 'Climate fine-tuning'), body);
}
