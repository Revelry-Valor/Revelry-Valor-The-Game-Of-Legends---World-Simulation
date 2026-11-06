import type { Climate } from '../core/climate';
import { fineIndex } from '../core/finegeo';
import { PROVINCE_SIZE_MI } from '../core/provinces';
import { UNDER_NAMES } from '../core/underdark';
import { generateUnderProvinces, underSizesOf, type SavedUnderProvinces, type UnderProvinceMap, type UnderSizes } from '../core/underprov';
import type { World } from '../core/world';
import ProvinceWorker from '../render/provinceworker?worker&inline';
import { h, numberField } from './dom';
import type { InfoItem } from './info';
import type { MapOverlay } from './mapview';
import type { ProvinceDisplay } from './provinces';

/**
 * The Underdark's provinces (Phase 12, the layers' provinces, step 1): their part of the Provinces
 * tab (sizes; make, update, remove) and the map layer that shows them in the Underdark view.
 */

export interface UnderProvincesDeps {
  world(): World;
  setSaved(saved: SavedUnderProvinces | null): void;
  climate(): Climate | null;
  redraw(): void;
  display(): ProvinceDisplay;
  /** The Provinces tab is open. */
  tabOpen(): boolean;
  /** The map shows the Underdark now. */
  showing(): boolean;
  /** Show the Underdark (or the surface) on the map. */
  show(on: boolean): void;
  mapChanged?(): void;
}

export interface UnderProvinces {
  panel: HTMLElement;
  overlay: MapOverlay;
  climateChanged(): void;
  map(): UnderProvinceMap | null;
  dispose(): void;
}

const SQ_KM_PER_SQ_MI = 2.589988;
const fmt = (v: number) => Math.round(v).toLocaleString();
const BASE: Record<string, string> = { rock: '#6d5f54', cavern: '#a8916f', tunnel: '#c9a35c', sea: '#2f6a96' };

export function createUnderProvinces(d: UnderProvincesDeps): UnderProvinces {
  let map: UnderProvinceMap | null = null;
  let basis: unknown = null;
  let busy = false;
  let error = '';
  let selected: number | null = null;
  const opts: UnderSizes = underSizesOf(d.world().underProvinces);
  let paths: Path2D[] = [];
  let lines: Path2D | null = null;
  let colours: string[] = [];

  let worker: Worker | null = null;
  let jobId = 0;
  let pending: ((m: UnderProvinceMap | null, err?: string) => void) | null = null;
  try {
    worker = new ProvinceWorker();
    worker.onmessage = (e) => {
      const r = e.data as { id: number; map?: UnderProvinceMap; error?: string };
      if (r.id !== jobId || !pending) return;
      const done = pending;
      pending = null;
      done(r.map ?? null, r.error);
    };
  } catch {
    worker = null;
  }

  const run = (fresh: boolean) => {
    const w = d.world();
    if (busy || !d.climate()) return;
    busy = true;
    error = '';
    render();
    const job = { layer: 'underdark' as const, surface: w.surface, settings: w.settings, ...opts, saved: fresh ? null : w.underProvinces ?? null };
    const madeFrom = w.surface.strokes;
    const done = (m: UnderProvinceMap | null, err?: string) => {
      busy = false;
      if (m) {
        setMap(m);
        basis = madeFrom;
        d.setSaved(m.saved);
        d.mapChanged?.();
      } else error = err || 'The Underdark provinces could not be made.';
      if (selected !== null && !map?.provinces.some((p) => p.id === selected)) selected = null;
      render();
      d.redraw();
    };
    jobId++;
    if (worker) {
      pending = done;
      worker.postMessage({ id: jobId, climate: d.climate(), ...job });
    } else
      setTimeout(() => {
        try {
          done(generateUnderProvinces(job.surface, job.settings, job));
        } catch (err) {
          done(null, (err as Error).message);
        }
      }, 30);
  };

  const setMap = (m: UnderProvinceMap) => {
    map = m;
    paths = m.rings.map((rings) => {
      const p = new Path2D();
      for (const r of rings) {
        p.moveTo(r[0], r[1]);
        for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
        p.closePath();
      }
      return p;
    });
    lines = new Path2D();
    for (const b of m.borders) {
      if (b.a < 0 || b.b < 0) continue;
      lines.moveTo(b.pts[0], b.pts[1]);
      for (let i = 2; i < b.pts.length; i += 2) lines.lineTo(b.pts[i], b.pts[i + 1]);
    }
    colours = m.provinces.map((p) => {
      const n = parseInt((BASE[p.kind] ?? '#777777').slice(1), 16);
      const v = 0.8 + 0.4 * hash01(p.id);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.min(255, Math.round(x * v)));
      return `rgba(${c[0]},${c[1]},${c[2]},0.75)`;
    });
  };

  // ---- Its part of the Provinces tab ----
  const settings = h('div', {});
  const actions = h('div', { class: 'sketch-actions' });
  const status = h('div', { class: 'small' });
  const card = h('div', { class: 'prov-card small' });
  const panel = h('section', { class: 'view-panel under-prov-panel' },
    h('h2', {}, 'Underdark provinces'),
    h('p', { class: 'muted small' }, 'All the rock under the land is split into provinces too, shaped by what is painted below: each cave system has provinces of its own, tunnels run as strings of provinces (like rivers on the surface), and underground seas have theirs. Solid rock provinces can be held; the main roads run through the caverns and tunnels, and through the rock only along tunnels the peoples dig.'),
    settings,
    actions,
    status,
    card,
  );
  const slider = (label: string, key: keyof UnderSizes, hint: string) =>
    numberField({ label, value: opts[key], min: PROVINCE_SIZE_MI.min, max: PROVINCE_SIZE_MI.max, step: 5, unit: 'miles', slider: true, hint, change: (v) => { if (v > 0) { opts[key] = Math.max(PROVINCE_SIZE_MI.min, Math.min(PROVINCE_SIZE_MI.max, v)); render(); } } });
  const renderSettings = () =>
    settings.replaceChildren(
      slider('Rock provinces', 'rockMi', 'About how far across a province of solid rock is.'),
      slider('Cavern provinces', 'cavernMi', 'About how far across a cavern province is.'),
      slider('Tunnel provinces', 'tunnelMi', 'About how long a stretch of tunnel each tunnel province is.'),
      slider('Underground sea provinces', 'seaMi', 'About how far across an underground sea province is.'),
    );
  const render = () => {
    const w = d.world();
    const saved = w.underProvinces;
    const was = saved ? underSizesOf(saved) : null;
    const resized = !!was && (Object.keys(opts) as (keyof UnderSizes)[]).some((k) => was[k] !== opts[k]);
    const outOfDate = !!map && basis !== w.surface.strokes;
    const noClimate = !d.climate();
    actions.replaceChildren(
      h('button', { type: 'button', class: 'primary', disabled: busy || noClimate, title: 'Make a new set of Underdark provinces (new ids).', onclick: () => run(true) }, saved ? 'Generate new' : 'Generate Underdark provinces'),
      ...(saved && !resized ? [h('button', { type: 'button', class: 'ghost', disabled: busy || noClimate || !outOfDate, title: 'Fit them to the painting as it is now, keeping each province (and its id) where it was.', onclick: () => run(false) }, 'Update to the map')] : []),
      ...(saved ? [h('button', { type: 'button', class: 'ghost danger', disabled: busy, onclick: () => { map = null; basis = null; d.setSaved(null); d.mapChanged?.(); render(); d.redraw(); } }, 'Remove')] : []),
      h('button', { type: 'button', class: 'ghost', onclick: () => { d.show(!d.showing()); render(); } }, d.showing() ? 'Show the surface' : 'Show the Underdark'),
    );
    const out: HTMLElement[] = [];
    if (busy) out.push(h('p', {}, 'Making the Underdark provinces…'));
    if (error) out.push(h('p', { class: 'warn' }, error));
    if (map) {
      const count = { rock: 0, cavern: 0, tunnel: 0, sea: 0 };
      for (const p of map.provinces) count[p.kind]++;
      out.push(h('p', {}, h('strong', {}, `${fmt(map.provinces.length)} Underdark provinces`), `: ${fmt(count.rock)} rock, ${fmt(count.cavern)} cavern, ${fmt(count.tunnel)} tunnel, ${fmt(count.sea)} underground sea.`));
      if (outOfDate) out.push(h('p', { class: 'warn' }, 'The map has changed since: update them to fit it (each keeps its place and id), or generate new ones.'));
      if (resized) out.push(h('p', { class: 'warn' }, 'The sizes have changed: generate new provinces to use them.'));
    } else if (!busy && saved && !noClimate) out.push(h('p', { class: 'muted' }, 'Growing them again from their saved seeds…'));
    else if (!busy) out.push(h('p', { class: 'muted' }, 'None yet. They show in the Underdark view (Show the Underdark, or the Underdark tab).'));
    status.replaceChildren(...out);
    renderCard();
  };
  const renderCard = () => {
    const p = map && selected !== null ? map.provinces.find((q) => q.id === selected) : null;
    if (!p || !map) {
      card.replaceChildren();
      return;
    }
    card.replaceChildren(
      h('h3', {}, `Underdark province No. ${p.id}`),
      h('dl', { class: 'info-list' },
        ...[
          ['Ground', `${p.terrain}${p.cover ? ` · ${UNDER_NAMES[p.cover].toLowerCase()}` : ''}`],
          ['Size', `${fmt(p.area / SQ_KM_PER_SQ_MI)} sq mi`],
          ['Neighbours', `${p.neighbours.length}`],
        ].flatMap(([a, b]) => [h('dt', {}, a), h('dd', {}, b)]),
      ),
    );
  };
  const pick = (x: number, y: number) => {
    if (!map) return null;
    const k = fineIndex(map.grid, map.wrapKm, x, y);
    return k >= 0 && map.label[k] >= 0 ? map.provinces[map.label[k]] : null;
  };

  // ---- The map layer (in the Underdark view) ----
  const overlay: MapOverlay = {
    down(x, y) {
      if (!d.tabOpen() || !d.showing() || !map) return false;
      selected = pick(x, y)?.id ?? null;
      render();
      d.redraw();
      return false;
    },
    draw(g, at, scale, copies) {
      if (!map || !d.showing()) return;
      const show: ProvinceDisplay = d.tabOpen() ? 'colour' : d.display();
      if (show === 'off') return;
      const sel = selected !== null && d.tabOpen() ? map.provinces.findIndex((p) => p.id === selected) : -1;
      for (const c of copies) {
        const [ox, oy] = at(0, 0, c);
        g.save();
        g.translate(ox, oy);
        g.scale(scale, scale);
        if (show === 'colour') for (let i = 0; i < paths.length; i++) {
          g.fillStyle = colours[i];
          g.fill(paths[i]);
        }
        g.lineJoin = 'round';
        if (lines) {
          g.strokeStyle = show === 'colour' ? 'rgba(14,10,8,0.85)' : 'rgba(235,220,190,0.45)';
          g.lineWidth = 1 / scale;
          g.stroke(lines);
        }
        if (sel >= 0) {
          g.strokeStyle = 'rgba(255,255,255,0.95)';
          g.lineWidth = 3.5 / scale;
          g.stroke(paths[sel]);
        }
        g.restore();
      }
    },
    describe(x, y) {
      if (!d.showing()) return null;
      const p = pick(x, y);
      if (!p) return null;
      const items: InfoItem[] = [{ label: 'Underdark province', value: `No. ${p.id} · ${p.terrain}${p.cover ? ` (${UNDER_NAMES[p.cover].toLowerCase()})` : ''} · ${fmt(p.area / SQ_KM_PER_SQ_MI)} sq mi · ${p.neighbours.length} neighbours` }];
      return items;
    },
  };

  renderSettings();
  render();
  return {
    panel,
    overlay,
    climateChanged() {
      const w = d.world();
      if (!map && w.underProvinces && !busy) {
        Object.assign(opts, underSizesOf(w.underProvinces));
        renderSettings();
        run(false);
        return;
      }
      render();
    },
    map: () => map,
    dispose() {
      worker?.terminate();
    },
  };
}

function hash01(v: number): number {
  let x = Math.imul(v ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
