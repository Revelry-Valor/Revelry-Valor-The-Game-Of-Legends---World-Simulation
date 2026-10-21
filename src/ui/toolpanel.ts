import { BRUSHES, brushDefaults, brushInfo, ZONES, type BrushId, type ZoneId } from '../core/paint';
import { kmToMiles, milesToKm } from '../core/units';
import { choice, h, numberField } from './dom';
import type { BrushSettings, HighOps, SketchOps, ToolState } from './mapview';

/** The brush picker and the selected brush's settings (REDESIGN.md, 6.2). */
export interface ToolPanel {
  el: HTMLElement;
  state: ToolState;
  select(tool: BrushId | 'pan'): void;
  setErase(on: boolean): void;
  /** Grow or shrink the brush (the [ and ] keys). */
  resize(factor: number): void;
  /** Show only the brushes of these groups (a sidebar tab). */
  showGroups(groups: string[]): void;
  /** Show the settings again (for example, a different current sketch was picked). */
  refresh(): void;
}

export function createToolPanel(changed: () => void, sketch: () => SketchOps | null = () => null, highOps: () => HighOps | null = () => null): ToolPanel {
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

  let shown: string[] | null = null;
  const renderPickers = () => {
    const groups = new Map<string, HTMLElement[]>();
    for (const b of BRUSHES) {
      if (shown && !shown.includes(b.group)) continue;
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
    if (state.tool === 'high') {
      settings.replaceChildren(h('h3', {}, state.erase ? 'Erase: high pressure' : b.name), ...highFields());
      return;
    }
    if (state.tool === 'current') {
      settings.replaceChildren(h('h3', {}, state.erase ? 'Erase: current sketch' : b.name), ...currentFields());
      return;
    }
    const pct = (label: string, key: 'strength' | 'softness' | 'roughness' | 'variation' | 'sideRidges' | 'erosion', hint: string) =>
      numberField({ label, value: Math.round((s[key] ?? 0) * 100), min: 0, max: 100, step: 1, unit: '%', slider: true, hint, change: (v) => { s[key] = Math.max(0, Math.min(100, v)) / 100; changed(); } });
    // A river's width comes from the water it carries, so its brush size only matters for erasing.
    const sized = !(state.tool === 'river' && !state.erase);
    const fields: (HTMLElement | null)[] = [
      h('p', { class: 'muted small hint' }, state.erase ? `Erasing ${b.name.toLowerCase()} only. Other layers are left alone.` : b.hint),
      !sized ? null : numberField({
        label: state.tool === 'crystal' ? 'Reach' : b.kind === 'point' ? 'Width' : 'Brush size',
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
      if (state.tool === 'river') {
        fields.push(
          numberField({ label: 'Width', value: Math.round(kmToMiles(s.width ?? 0.2) * 100) / 100, min: 0.01, max: 3, step: 0.01, unit: 'miles', slider: true, hint: 'Width at the source. It widens downstream, and wherever another river joins.', change: (v) => { if (v > 0) s.width = milesToKm(v); changed(); } }),
          numberField({ label: 'Wandering', value: Math.round(kmToMiles(s.wander ?? 5) * 10) / 10, min: 0, max: 50, step: 0.5, unit: 'miles', slider: true, hint: 'How far the river may wander from its course in winding bends. 0 is no wandering. (Points mode.)', change: (v) => { s.wander = milesToKm(Math.max(0, v)); changed(); } }),
        );
      }
      if (state.tool === 'river' || state.tool === 'lava') {
        fields.push(choice<'points' | 'draw'>('Course', [{ value: 'points', label: 'Points' }, { value: 'draw', label: 'Draw' }], s.route ?? 'points', (v) => { s.route = v; renderSettings(); changed(); }));
      }
      if (state.tool === 'volcano' || state.tool === 'lava') {
        fields.push(choice<string>('State', [{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Dormant' }], s.active === false ? 'no' : 'yes', (v) => { s.active = v === 'yes'; changed(); }));
      }
      if (state.tool === 'crystal') {
        fields.push(choice<'heat' | 'cold' | 'rain'>('Crystal', [{ value: 'heat', label: 'Heat (sun)' }, { value: 'cold', label: 'Cold' }, { value: 'rain', label: 'Rain' }], s.crystal ?? 'heat', (v) => { s.crystal = v; changed(); }));
      }
      if (state.tool === 'shadowpen') {
        const presets: [string, number][] = [['Coastal cliff', 0.6], ['Low hills', 0.5], ['High hills', 1], ['Escarpment', 1.5], ['Mountains', 2.5], ['High mountains', 4]];
        const ft = (km: number) => `${Math.round((km * 3280.84) / 100) * 100} ft`;
        fields.push(
          choice<string>('Height', presets.map(([label, km]) => ({ value: String(km), label: `${label} · ${ft(km)}` })), String(s.penHeight ?? 2.5), (v) => { s.penHeight = Number(v); renderSettings(); changed(); }),
          numberField({ label: 'Exact height', value: Math.round((s.penHeight ?? 2.5) * 3280.84), min: 0, max: 30000, step: 100, unit: 'ft', hint: 'Overrides the height the climate sees along the line. 0 flattens it for the climate only.', change: (v) => { s.penHeight = Math.max(0, v) / 3280.84; changed(); } }),
        );
      }
      if (state.tool === 'whirlpool') {
        fields.push(choice<string>('Ships', [{ value: 'yes', label: 'Dangerous to ships' }, { value: 'no', label: 'Harmless' }], s.dangerous === false ? 'no' : 'yes', (v) => { s.dangerous = v === 'yes'; changed(); }));
      }
      const strengthName = state.tool === 'river' ? 'Water at the source' : state.tool === 'volcano' ? 'Height' : b.group === 'Land & Sea' ? 'Opacity' : b.group === 'Ground cover' ? 'Density' : 'Strength';
      const strengthHint = state.tool === 'river' ? 'A spring-fed stream or a river from a big lake. Rivers grow on their way, and with every river that joins them.' : b.group === 'Relief' ? 'How bold: for mountains, bigger peaks.' : 'How fully it covers.';
      if (state.tool !== 'zone' && state.tool !== 'river' && state.tool !== 'shadowpen' && state.tool !== 'gap') fields.push(pct(strengthName, 'strength', strengthHint));
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
    if (!state.erase && b.kind !== 'point' && b.group !== 'Water' && b.group !== 'Volcanic' && b.group !== 'Climate') fields.push(pct('Variation', 'variation', 'So repeated strokes don’t look copied.'));
    fields.push(h('button', { type: 'button', class: 'ghost small', onclick: () => { remembered.set(b.id, brushDefaults(b.id)); state.settings = settingsFor(b.id); renderSettings(); changed(); } }, 'Reset this brush'));
    settings.replaceChildren(h('h3', {}, state.erase ? `Erase: ${b.name}` : b.name), ...fields.filter(Boolean) as HTMLElement[]);
  };

  type Season = 'both' | 'summer' | 'winter';
  const SEASONS: { value: Season; label: string }[] = [{ value: 'both', label: 'All year' }, { value: 'summer', label: 'Northern summer' }, { value: 'winter', label: 'Northern winter' }];
  let editedHigh: number | null = null;
  /** Settings for high-pressure zones: place them, then pick one to change how strong it is. */
  const highFields = (): HTMLElement[] => {
    const s = state.settings;
    if (state.erase) return [h('p', { class: 'muted small hint' }, 'Tap a high to delete it.')];
    const mode = state.sketchMode ?? 'draw';
    const fields = (v: { strength: number; size: number; highSeason?: Season }, set: (patch: Partial<BrushSettings>) => void) => [
      numberField({ label: 'Strength', value: Math.round(v.strength * 100), min: 5, max: 100, step: 1, unit: '%', slider: true, hint: 'Stronger highs push their air further and win where they meet a weaker one; the air under them is drier.', change: (x) => set({ strength: Math.max(5, Math.min(100, x)) / 100 }) }),
      numberField({ label: 'Reach', value: Math.round(kmToMiles(v.size)), min: 100, max: 6000, step: 10, unit: 'miles', hint: 'How far out its winds reach (the dashed circle).', change: (x) => { if (x > 0) set({ size: milesToKm(x) }); } }),
      choice<Season>('Season', SEASONS, v.highSeason ?? 'both', (x) => set({ highSeason: x })),
    ];
    const out: HTMLElement[] = [
      h('p', { class: 'muted small hint' }, 'High-pressure zones drive the winds. Picture a line through each high, east to west. On its equator side the air curves away to the ITCZ. On its pole side the air circles round the high (clockwise in the north, anticlockwise in the south) from the west end to the east end, each stream outside the last, then on to the ITCZ. The nearer the ITCZ, the further toward the pole the line sits, so more air goes straight to it. Mountains turn the winds; where two highs’ winds meet, a front forms, with clouds and rain.'),
      choice<'draw' | 'adjust'>('Mode', [{ value: 'draw', label: 'Place' }, { value: 'adjust', label: 'Adjust' }], mode, (v) => { state.sketchMode = v; renderSettings(); changed(); }),
    ];
    if (mode === 'draw') {
      out.push(...fields(s as { strength: number; size: number; highSeason?: Season }, (patch) => { Object.assign(s, patch); changed(); }), h('p', { class: 'muted small' }, 'Click the map to place a high.'));
      return out;
    }
    const ops = highOps();
    const sel = ops?.selected() ?? null;
    if (!ops || !sel) {
      out.push(h('p', { class: 'muted small' }, 'Tap a high to pick it; drag it to move it.'));
      return out;
    }
    out.push(
      ...fields(sel, (patch) => {
        // One undo step for each high's run of changes.
        ops.set(patch, editedHigh !== sel.id);
        editedHigh = sel.id;
      }),
      h('div', { class: 'sketch-actions' }, h('button', { type: 'button', class: 'ghost small danger', onclick: () => { ops.remove(); renderSettings(); } }, 'Delete')),
    );
    return out;
  };
  type Kind = 'warm' | 'cold' | 'neutral';
  const KINDS: { value: Kind; label: string }[] = [{ value: 'warm', label: 'Warm' }, { value: 'cold', label: 'Cold' }, { value: 'neutral', label: 'Neutral' }];
  type Size = 'major' | 'secondary';
  const SIZES: { value: Size; label: string; title: string }[] = [
    { value: 'major', label: 'Major', title: 'An ocean-wide current: the gyres, the equatorial and polar currents.' },
    { value: 'secondary', label: 'Secondary', title: 'A smaller current running in and out of a bay or shallow sea, to set the water temperature there.' },
  ];
  /** Settings for ocean currents, placed by hand; they warm or cool the water near them. */
  const currentFields = (): HTMLElement[] => {
    const s = state.settings;
    if (state.erase) return [h('p', { class: 'muted small hint' }, 'Tap a current to delete it.'), currentRules()];
    const mode = state.sketchMode ?? 'draw';
    const out: HTMLElement[] = [
      h('p', { class: 'muted small hint' }, 'Draw the ocean currents yourself. Warm currents warm the water and coasts near them, cold ones cool them; the climate follows. The rules below say which way they run.'),
      choice<'draw' | 'adjust'>('Mode', [{ value: 'draw', label: 'Draw' }, { value: 'adjust', label: 'Adjust' }], mode, (v) => { state.sketchMode = v; renderSettings(); changed(); }),
    ];
    if (mode === 'draw') {
      out.push(
        choice<Kind>('Current', KINDS, s.current ?? 'warm', (v) => { s.current = v; changed(); }),
        choice<Size>('Size', SIZES, s.currentSize ?? 'major', (v) => { s.currentSize = v; changed(); }),
        h('p', { class: 'muted small' }, 'Tap points along the course, then tap the last point again to finish. Esc cancels.'),
        currentRules(),
      );
      return out;
    }
    const ops = sketch();
    const sel = ops?.selected() ?? null;
    if (!ops || !sel) {
      out.push(h('p', { class: 'muted small' }, 'Tap a current to pick it. Drag its dots to move them; drag the line to add a bend.'), currentRules());
      return out;
    }
    out.push(
      choice<Kind>('This current', KINDS, sel.current ?? 'warm', (v) => { ops.setKind(v); renderSettings(); }),
      choice<Size>('Size', SIZES, sel.currentSize ?? 'major', (v) => { ops.setSize(v); renderSettings(); }),
      h('p', { class: 'muted small' }, 'Drag its dots to move them; drag the line to add a bend.'),
      h('div', { class: 'sketch-actions' },
        h('button', { type: 'button', class: 'ghost small', title: 'Make it flow the other way.', onclick: () => { ops.reverse(); renderSettings(); } }, 'Reverse'),
        h('button', { type: 'button', class: 'ghost small danger', onclick: () => { ops.remove(); renderSettings(); } }, 'Delete'),
      ),
      currentRules(),
    );
    return out;
  };
  let rulesOpen = true;
  /** How currents run, latitude by latitude (docs/REDESIGN.md, "Ocean current rules"). */
  const currentRules = (): HTMLElement => {
    const sec = (title: string, items: string[]) => h('div', { class: 'rules-sec' }, h('h4', {}, title), h('ul', {}, ...items.map((t) => h('li', {}, t))));
    const d = h(
      'details',
      { class: 'current-rules', open: rulesOpen },
      h('summary', {}, 'How currents run'),
      h('p', { class: 'muted small' }, 'Degrees are for an Earth-like world; on other worlds the bands move with the wind belts. In the southern hemisphere, mirror everything (north ↔ south).'),
      sec('Near the equator (neutral, black)', [
        'Countercurrent: west → east, right on the ITCZ line (the dotted line).',
        'Two equatorial currents: east → west, 5° north and 5° south of it.',
        'On an ocean’s west side the equatorial currents turn toward the pole as warm currents; on its east side the countercurrent splits into the two westward ones.',
        'They run round small tropical islands along the coast.',
      ]),
      sec('Warm currents (red): toward the pole', [
        'Up the east coasts of continents (each ocean’s west side).',
        'At about 40° they turn east, arcing slowly up to about 50° if the sea is wide enough.',
        'Along a coast they stay warm while poleward of about 40°.',
      ]),
      sec('Cold currents (blue): toward the equator', [
        'Down the west coasts of continents (each ocean’s east side) to join the westward equatorial current.',
        'A current that hits land splits: warm toward the pole, cold toward the equator.',
        'Coming down to a warm current that turns east at 40°, a cold current carries on past 50° and merges into it; with none to meet, it turns east at about 50°.',
        'Land nearer the equator than the 40–50° current still gets cold water: it branches off that current and runs down the land’s west coast.',
      ]),
      sec('Polar currents (about 70°)', [
        'The polar current runs east → west (neutral) at about 70°.',
        'A warm current reaching it takes its place and flows west, still warm; the polar current moves about 5° further toward the pole beside it.',
        'When that warm current hits land it turns cold and runs toward the equator without splitting, meeting the warm current at 40–50°.',
        'Land whose polar end lies between about 45° and 70° gets a cold current curving off the polar current, down its east coast.',
      ]),
      sec('Everywhere', [
        'A current follows a coast only while it runs roughly its way (within about 25°); otherwise it carries straight on.',
        'Currents never cross: they join.',
        'In open sea they turn in wide arcs; coasts can turn them sharply.',
        'A small neutral loop runs west round the end of a land, from the warm current on one side to the cold current on the other.',
      ]),
      sec('Secondary currents (thin)', [
        'For bays, inlets and shallow seas the major currents don’t reach, to set the water temperature there.',
        'They take the major current’s water at the mouth: in along one side, out along the other.',
        'A bay off the 40–50° current: in along its east side (warm), out along its west side (cold).',
      ]),
    );
    d.addEventListener('toggle', () => (rulesOpen = d.open));
    return d;
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
    showGroups(groups) {
      shown = groups;
      if (state.tool !== 'pan' && !groups.includes(brushInfo(state.tool).group)) {
        const first = BRUSHES.find((b) => groups.includes(b.group));
        if (first) {
          select(first.id);
          return;
        }
      }
      renderPickers();
    },
    refresh: () => renderSettings(),
    resize(factor) {
      if (state.tool === 'pan') return;
      state.settings.size = Math.max(milesToKm(0.5), Math.min(milesToKm(1500), state.settings.size * factor));
      renderSettings();
      changed();
    },
  };
}
