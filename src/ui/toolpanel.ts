import { BRUSHES, brushDefaults, brushInfo, ZONES, type BrushId, type ZoneId } from '../core/paint';
import { kmToMiles, milesToKm } from '../core/units';
import { choice, h, numberField } from './dom';
import type { BrushSettings, ToolState } from './mapview';

/** The brush picker and the selected brush's settings (REDESIGN.md, 6.2). */
export interface ToolPanel {
  el: HTMLElement;
  state: ToolState;
  select(tool: BrushId | 'pan'): void;
  setErase(on: boolean): void;
  /** Grow or shrink the brush (the [ and ] keys). */
  resize(factor: number): void;
}

export function createToolPanel(changed: () => void): ToolPanel {
  // Each brush remembers its own settings while you switch between them.
  const remembered = new Map<BrushId, BrushSettings>();
  const settingsFor = (id: BrushId) => {
    if (!remembered.has(id)) remembered.set(id, brushDefaults(id));
    return remembered.get(id)!;
  };
  const state: ToolState = { tool: 'land', erase: false, settings: settingsFor('land') };

  const pickers = h('div', { class: 'brushes' });
  const settings = h('div', { class: 'brush-settings' });
  const eraseBtn = h('button', { type: 'button', class: 'ghost', 'aria-pressed': 'false', title: 'Erase only the selected brush’s own layer (E)' }, 'Erase');
  const panBtn = h('button', { type: 'button', class: 'ghost', 'aria-pressed': 'false', title: 'Drag to move the map. You can also hold Space, or drag with the right mouse button.' }, 'Move map');

  const renderPickers = () => {
    const groups = new Map<string, HTMLElement[]>();
    for (const b of BRUSHES) {
      const btn = h('button', { type: 'button', class: 'brush', 'aria-pressed': state.tool === b.id ? 'true' : 'false', title: b.hint, onclick: () => select(b.id) }, b.name);
      groups.set(b.group, [...(groups.get(b.group) ?? []), btn]);
    }
    pickers.replaceChildren(...[...groups].map(([name, btns]) => h('div', { class: 'brush-group' }, h('h3', {}, name), h('div', { class: 'brush-row' }, ...btns))));
    panBtn.setAttribute('aria-pressed', state.tool === 'pan' ? 'true' : 'false');
    eraseBtn.setAttribute('aria-pressed', state.erase ? 'true' : 'false');
    eraseBtn.disabled = state.tool === 'pan';
  };

  const renderSettings = () => {
    if (state.tool === 'pan') {
      settings.replaceChildren(h('p', { class: 'muted small' }, 'Drag the map to move it. Scroll or pinch to zoom.'));
      return;
    }
    const b = brushInfo(state.tool);
    const s = state.settings;
    const pct = (label: string, key: 'strength' | 'softness' | 'roughness' | 'variation' | 'sideRidges' | 'erosion', hint: string) =>
      numberField({ label, value: Math.round((s[key] ?? 0) * 100), min: 0, max: 100, step: 1, unit: '%', slider: true, hint, change: (v) => { s[key] = Math.max(0, Math.min(100, v)) / 100; changed(); } });
    // A river's width comes from the water it carries, so its brush size only matters for erasing.
    const sized = !(state.tool === 'river' && !state.erase);
    const fields: (HTMLElement | null)[] = [
      h('p', { class: 'muted small hint' }, state.erase ? `Erasing ${b.name.toLowerCase()} only. Other layers are left alone.` : b.hint),
      !sized ? null : numberField({
        label: b.kind === 'point' ? 'Width' : 'Brush size',
        value: Math.round(kmToMiles(s.size) * 10) / 10,
        min: 0.5,
        max: 1500,
        step: 0.5,
        unit: 'miles',
        hint: 'Keys [ and ] make it smaller or larger.',
        change: (v) => { if (v > 0) s.size = milesToKm(v); changed(); },
      }),
    ];
    if (!state.erase) {
      if (state.tool === 'mountains') {
        fields.push(pct('Ridges & gullies', 'sideRidges', 'How deeply ridges and gullies are cut down the slopes.'));
      }
      if (state.tool === 'plateau' || state.tool === 'cliffs' || state.tool === 'canyon') {
        fields.push(pct('Erosion', 'erosion', 'How worn the rock faces are: gullies notch the edge and the layers step more.'));
      }
      if (state.tool === 'cliffs') {
        fields.push(choice<'1' | '-1'>('High side', [{ value: '1', label: 'Right of the line' }, { value: '-1', label: 'Left of the line' }], String(s.side ?? 1) as '1' | '-1', (v) => { s.side = v === '1' ? 1 : -1; changed(); }));
      }
      if (state.tool === 'zone') {
        fields.push(
          choice<string>('Zone', [{ value: '0', label: 'Automatic' }, ...ZONES.map((z) => ({ value: String(z.id), label: z.name }))], String(s.zone ?? 2), (v) => { s.zone = Number(v) as ZoneId; changed(); }),
        );
      }
      if (state.tool === 'river' || state.tool === 'lava') {
        fields.push(choice<'points' | 'draw'>('Course', [{ value: 'points', label: 'Points' }, { value: 'draw', label: 'Draw' }], s.route ?? 'points', (v) => { s.route = v; renderSettings(); changed(); }));
      }
      if (state.tool === 'volcano' || state.tool === 'lava') {
        fields.push(choice<string>('State', [{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Dormant' }], s.active === false ? 'no' : 'yes', (v) => { s.active = v === 'yes'; changed(); }));
      }
      if (state.tool === 'whirlpool') {
        fields.push(choice<string>('Ships', [{ value: 'yes', label: 'Dangerous to ships' }, { value: 'no', label: 'Harmless' }], s.dangerous === false ? 'no' : 'yes', (v) => { s.dangerous = v === 'yes'; changed(); }));
      }
      const strengthName = state.tool === 'river' ? 'Water at the source' : state.tool === 'volcano' ? 'Height' : b.group === 'Land & Sea' ? 'Opacity' : b.group === 'Ground cover' ? 'Density' : 'Strength';
      const strengthHint = state.tool === 'river' ? 'A spring-fed stream or a river from a big lake. Rivers grow on their way, and with every river that joins them.' : b.group === 'Relief' ? 'How bold: for mountains, bigger peaks.' : 'How fully it covers.';
      if (state.tool !== 'zone') fields.push(pct(strengthName, 'strength', strengthHint));
    }
    if ((b.kind !== 'point' || state.tool === 'crater' || state.tool === 'volcano') && (state.tool !== 'river' || state.erase)) {
      fields.push(
        pct('Softness', 'softness', 'How gradually the edge fades.'),
        pct('Roughness', 'roughness', 'How ragged the outline is.'),
      );
    }
    if (!state.erase && b.group === 'Relief') {
      fields.push(
        numberField({ label: 'Detail', value: Math.round(kmToMiles(s.detail) * 10) / 10, min: 0.2, max: 200, step: 0.1, unit: 'miles', hint: 'Size of single peaks or bumps.', change: (v) => { if (v > 0) s.detail = milesToKm(v); changed(); } }),
      );
    }
    if (!state.erase && b.kind !== 'point' && b.group !== 'Water' && b.group !== 'Volcanic') fields.push(pct('Variation', 'variation', 'So repeated strokes don’t look copied.'));
    fields.push(h('button', { type: 'button', class: 'ghost small', onclick: () => { remembered.set(b.id, brushDefaults(b.id)); state.settings = settingsFor(b.id); renderSettings(); changed(); } }, 'Reset this brush'));
    settings.replaceChildren(h('h3', {}, state.erase ? `Erase: ${b.name}` : b.name), ...fields.filter(Boolean) as HTMLElement[]);
  };

  const select = (tool: BrushId | 'pan') => {
    state.tool = tool;
    if (tool !== 'pan') state.settings = settingsFor(tool);
    renderPickers();
    renderSettings();
    changed();
  };
  const setErase = (on: boolean) => {
    if (state.tool === 'pan') return;
    state.erase = on;
    renderPickers();
    renderSettings();
    changed();
  };
  eraseBtn.addEventListener('click', () => setErase(!state.erase));
  panBtn.addEventListener('click', () => select(state.tool === 'pan' ? 'land' : 'pan'));

  renderPickers();
  renderSettings();
  return {
    el: h('section', { class: 'tools-panel' }, h('div', { class: 'tool-modes' }, panBtn, eraseBtn), pickers, settings),
    state,
    select,
    setErase,
    resize(factor) {
      if (state.tool === 'pan') return;
      state.settings.size = Math.max(milesToKm(0.5), Math.min(milesToKm(1500), state.settings.size * factor));
      renderSettings();
      changed();
    },
  };
}
