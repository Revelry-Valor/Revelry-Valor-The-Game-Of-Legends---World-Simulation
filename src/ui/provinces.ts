import type { Climate } from '../core/climate';
import { fineIndex } from '../core/finegeo';
import { REGION_KINDS } from '../core/geography';
import { generateProvinces, PROVINCE_DEFAULTS, PROVINCE_SIZE_MI, smallestProvinceMi, type ProvinceMap, type SavedProvinces } from '../core/provinces';
import type { World } from '../core/world';
import ProvinceWorker from '../render/provinceworker?worker&inline';
import { h, numberField } from './dom';
import type { InfoItem } from './info';
import type { MapOverlay } from './mapview';

/**
 * The province generator (REDESIGN.md 8.6a): the Provinces tab, where provinces are made from the
 * finished map and updated after repainting, and the map layer that shows them (outlines, or
 * coloured by terrain while the tab is open).
 */

export type ProvinceDisplay = 'off' | 'lines' | 'colour';

export interface ProvincesDeps {
  world(): World;
  /** Keep these provinces with the world (null: none). */
  setSaved(saved: SavedProvinces | null): void;
  climate(): Climate | null;
  climateBusy(): boolean;
  redraw(): void;
  /** How provinces show on the map outside the Provinces tab. */
  display(): ProvinceDisplay;
  /** The provinces were made, updated or removed. */
  mapChanged?(): void;
}

export interface Provinces {
  panel: HTMLElement;
  overlay: MapOverlay;
  /** A new climate is ready (after painting or a settings change). */
  climateChanged(): void;
  setActive(on: boolean): void;
  map(): ProvinceMap | null;
  dispose(): void;
}

const SQ_KM_PER_SQ_MI = 2.589988;
const fmtInt = (v: number) => Math.round(v).toLocaleString();

export function createProvinces(d: ProvincesDeps): Provinces {
  let map: ProvinceMap | null = null;
  /** What the provinces were made from, to tell when the map has changed since. */
  let basis: { strokes: unknown; settings: unknown } | null = null;
  let busy = false;
  let error = '';
  let active = false;
  const saved0 = d.world().provinces;
  const opts = { sizeMi: saved0?.sizeMi ?? PROVINCE_DEFAULTS.sizeMi, seaFactor: saved0?.seaFactor ?? PROVINCE_DEFAULTS.seaFactor };
  // Drawing: each province's outline as a path (km), and the borders by kind.
  let paths: Path2D[] = [];
  let boxes: Float32Array = new Float32Array(0);
  let landLines: Path2D | null = null;
  let seaLines: Path2D | null = null;
  let coastLines: Path2D | null = null;
  let colours: string[] = [];

  // ---- Making them, away from the page ----
  let worker: Worker | null = null;
  let jobId = 0;
  let pending: ((m: ProvinceMap | null, err?: string) => void) | null = null;
  try {
    worker = new ProvinceWorker();
    worker.onmessage = (e) => {
      const r = e.data as { id: number; map?: ProvinceMap; error?: string };
      if (r.id !== jobId || !pending) return;
      const done = pending;
      pending = null;
      done(r.map ?? null, r.error);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (pending) {
        const done = pending;
        pending = null;
        done(null, 'The province generator stopped unexpectedly.');
      }
    };
  } catch {
    worker = null;
  }

  const run = (fresh: boolean) => {
    const cl = d.climate();
    const w = d.world();
    if (!cl || busy) return;
    busy = true;
    error = '';
    render();
    const job = { surface: w.surface, settings: w.settings, sizeMi: opts.sizeMi, seaFactor: opts.seaFactor, saved: fresh ? null : w.provinces ?? null };
    const madeFrom = { strokes: w.surface.strokes, settings: w.settings };
    const done = (m: ProvinceMap | null, err?: string) => {
      busy = false;
      if (m) {
        setMap(m);
        basis = madeFrom;
        if (!sameSaved(d.world().provinces, m.saved)) d.setSaved(m.saved);
        d.mapChanged?.();
      } else error = err || 'The provinces could not be made.';
      render();
      d.redraw();
    };
    jobId++;
    if (worker) {
      pending = done;
      worker.postMessage({ id: jobId, climate: cl, ...job });
    } else
      setTimeout(() => {
        try {
          done(generateProvinces(job.surface, job.settings, cl, job));
        } catch (err) {
          done(null, (err as Error).message);
        }
      }, 30);
  };

  const setMap = (m: ProvinceMap) => {
    map = m;
    const geo = d.climate()?.geo;
    paths = m.rings.map((rings) => {
      const p = new Path2D();
      for (const r of rings) {
        p.moveTo(r[0], r[1]);
        for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
        p.closePath();
      }
      return p;
    });
    boxes = new Float32Array(m.rings.length * 4);
    m.rings.forEach((rings, i) => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const r of rings) for (let q = 0; q < r.length; q += 2) {
        x0 = Math.min(x0, r[q]);
        x1 = Math.max(x1, r[q]);
        y0 = Math.min(y0, r[q + 1]);
        y1 = Math.max(y1, r[q + 1]);
      }
      boxes.set([x0, y0, x1, y1], i * 4);
    });
    landLines = new Path2D();
    seaLines = new Path2D();
    coastLines = new Path2D();
    const wet = (i: number) => i >= 0 && (m.provinces[i].kind === 'sea');
    for (const b of m.borders) {
      if (b.a < 0 || b.b < 0) continue;
      const target = wet(b.a) !== wet(b.b) ? coastLines : wet(b.a) ? seaLines : landLines;
      target.moveTo(b.pts[0], b.pts[1]);
      for (let i = 2; i < b.pts.length; i += 2) target.lineTo(b.pts[i], b.pts[i + 1]);
    }
    colours = m.provinces.map((p) => {
      const v = 0.82 + 0.36 * hash01(p.id);
      const tint = (hex: string, a: number) => {
        const n = parseInt(hex.slice(1), 16);
        const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * v))));
        return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      };
      if (p.kind === 'sea') return tint(p.terrain === 'Ocean' ? '#2e588c' : p.terrain === 'Sea' ? '#467ab2' : p.terrain === 'Gulf' ? '#609cc8' : '#7ebad8', 0.8);
      if (p.kind === 'lake') return tint('#86c4e0', 0.85);
      if (p.kind === 'wasteland') return tint('#7c7670', 0.9);
      const kind = p.region >= 0 ? geo?.regions[p.region]?.kind ?? '' : '';
      const base = p.terrain === 'Mountains' ? '#8d7b6a' : p.terrain === 'Highlands' ? '#b49a72' : p.terrain === 'Plateau' ? '#c09a6a' : REGION_KINDS[kind] ?? '#a8a08a';
      return tint(base, 0.85);
    });
  };

  // ---- The tab ----
  const status = h('div', { class: 'prov-status small', 'aria-live': 'polite' });
  const actions = h('div', { class: 'sketch-actions' });
  const settingsBox = h('div', {});
  const panel = h('section', { class: 'view-panel prov-panel' },
    h('h2', {}, 'Provinces'),
    h('p', { class: 'muted small' }, 'Split the finished map into provinces, as in Crusader Kings: land and sea in hundreds to thousands of pieces that follow the terrain. A province never crosses a coast, a big river, the edge of a natural region or a change between lowland, highlands, mountains, impassable peaks and plateaus, and every province is one piece. Lakes are provinces of their own.'),
    settingsBox,
    actions,
    status,
  );
  const renderSettings = () => {
    const w = d.world();
    const smallest = smallestProvinceMi(w.settings);
    settingsBox.replaceChildren(
      numberField({ label: 'Province size', value: opts.sizeMi, min: PROVINCE_SIZE_MI.min, max: PROVINCE_SIZE_MI.max, step: 5, unit: 'miles', slider: true, hint: `About how far across a land province is.${smallest > PROVINCE_SIZE_MI.min ? ` This map is big enough that provinces under about ${smallest} miles across come out blocky.` : ''}`, change: (v) => { if (v > 0) { opts.sizeMi = Math.max(PROVINCE_SIZE_MI.min, Math.min(PROVINCE_SIZE_MI.max, v)); render(); } } }),
      numberField({ label: 'Sea provinces', value: opts.seaFactor, min: 1, max: 8, step: 0.5, unit: '× as wide', slider: true, hint: 'How much wider sea provinces are than land provinces.', change: (v) => { if (v > 0) { opts.seaFactor = Math.max(1, Math.min(8, v)); render(); } } }),
    );
  };
  const render = () => {
    const w = d.world();
    const saved = w.provinces;
    const changedSettings = !!saved && (saved.sizeMi !== opts.sizeMi || saved.seaFactor !== opts.seaFactor);
    const outOfDate = !!map && !!basis && (basis.strokes !== w.surface.strokes || basis.settings !== w.settings);
    const noClimate = !d.climate();
    const gen = h('button', { type: 'button', class: 'primary', disabled: busy || noClimate, title: 'Make a new set of provinces (new ids).', onclick: () => run(true) }, saved ? 'Generate new provinces' : 'Generate provinces');
    const upd = saved && !changedSettings ? h('button', { type: 'button', class: 'ghost', disabled: busy || noClimate || !outOfDate, title: 'Fit the provinces to the map as it is now, keeping each province (and its id) where it was.', onclick: () => run(false) }, 'Update to the map') : null;
    const remove = saved ? h('button', { type: 'button', class: 'ghost danger', disabled: busy, onclick: () => {
      actions.replaceChildren(h('span', { class: 'small' }, 'Remove the provinces?'), h('button', { type: 'button', class: 'danger-solid', onclick: () => { map = null; basis = null; d.setSaved(null); d.mapChanged?.(); render(); d.redraw(); } }, 'Remove'), h('button', { type: 'button', class: 'ghost', onclick: render }, 'Keep'));
    } }, 'Remove') : null;
    actions.replaceChildren(gen, ...(upd ? [upd] : []), ...(remove ? [remove] : []));
    const lines: (HTMLElement | string)[] = [];
    if (busy) lines.push(h('p', {}, 'Making provinces… This takes a few seconds; big maps and small provinces take longer.'));
    else if (noClimate || (d.climateBusy() && !map)) lines.push(h('p', { class: 'muted' }, 'Waiting for the climate (provinces follow the regions it works out).'));
    if (error) lines.push(h('p', { class: 'warn' }, error));
    if (map) {
      const count = { land: 0, sea: 0, lake: 0, wasteland: 0 };
      let landArea = 0;
      for (const p of map.provinces) {
        count[p.kind]++;
        if (p.kind === 'land') landArea += p.area;
      }
      lines.push(
        h('p', {}, h('strong', {}, `${fmtInt(map.provinces.length)} provinces`), `: ${fmtInt(count.land)} land, ${fmtInt(count.sea)} sea, ${fmtInt(count.lake)} lake${count.lake === 1 ? '' : 's'}, ${fmtInt(count.wasteland)} impassable.`),
        h('p', { class: 'muted' }, count.land ? `A land province averages about ${fmtInt(landArea / count.land / SQ_KM_PER_SQ_MI)} sq mi.` : ''),
      );
      if (outOfDate) lines.push(h('p', { class: 'warn' }, 'The map has changed since the provinces were made. Update them to fit it (each keeps its place and id), or generate new ones.'));
      if (changedSettings) lines.push(h('p', { class: 'warn' }, 'The sizes have changed: generate new provinces to use them.'));
    } else if (!busy && !saved && !noClimate) lines.push(h('p', { class: 'muted' }, 'No provinces yet. Make them whenever the map is ready; you can update them after repainting.'));
    else if (!busy && saved && !map) lines.push(h('p', { class: 'muted' }, 'Growing the provinces again from their saved seeds…'));
    lines.push(h('p', { class: 'muted' }, 'Hover over the map to see a province in the Under the cursor panel. While this tab is open provinces are coloured by terrain; elsewhere choose how they show under View.'));
    status.replaceChildren(...lines);
  };

  // ---- The map layer ----
  const overlay: MapOverlay = {
    // While the tab is open, pressing the map pans (it never paints).
    get noPaint() {
      return active;
    },
    draw(g, at, scale, copies) {
      if (!map) return;
      const show: ProvinceDisplay = active ? 'colour' : d.display();
      if (show === 'off') return;
      const t = g.getTransform();
      const cw = g.canvas.width / (t.a || 1);
      const ch = g.canvas.height / (t.d || 1);
      for (const c of copies) {
        const [ox, oy] = at(0, 0, c);
        // The part of the map in view (km).
        const vx0 = -ox / scale;
        const vx1 = (cw - ox) / scale;
        const vy0 = -oy / scale;
        const vy1 = (ch - oy) / scale;
        g.save();
        g.translate(ox, oy);
        g.scale(scale, scale);
        if (show === 'colour') {
          for (let i = 0; i < paths.length; i++) {
            if (boxes[i * 4 + 2] < vx0 || boxes[i * 4] > vx1 || boxes[i * 4 + 3] < vy0 || boxes[i * 4 + 1] > vy1) continue;
            g.fillStyle = colours[i];
            g.fill(paths[i]);
          }
        }
        g.lineJoin = 'round';
        // Lines a steady width on screen, thinner when zoomed far out.
        const px = 1 / scale;
        const thin = Math.min(1, Math.max(0.35, scale * 12));
        if (seaLines) {
          g.strokeStyle = show === 'colour' ? 'rgba(16,32,58,0.55)' : 'rgba(24,48,80,0.35)';
          g.lineWidth = px * 0.8 * thin;
          g.stroke(seaLines);
        }
        if (landLines) {
          g.strokeStyle = show === 'colour' ? 'rgba(28,22,16,0.8)' : 'rgba(36,28,20,0.6)';
          g.lineWidth = px * 1 * thin;
          g.stroke(landLines);
        }
        if (coastLines && show === 'colour') {
          g.strokeStyle = 'rgba(16,14,12,0.9)';
          g.lineWidth = px * 1.4;
          g.stroke(coastLines);
        }
        g.restore();
      }
    },
    describe(x, y) {
      if (!map) return null;
      const k = fineIndex(map.grid, map.wrapKm, x, y);
      if (k < 0 || map.label[k] < 0) return null;
      const p = map.provinces[map.label[k]];
      const items: InfoItem[] = [];
      const kind = p.kind === 'wasteland' ? 'impassable' : p.kind;
      const extra = [p.coastal ? 'coastal' : '', p.river ? 'on a river' : ''].filter(Boolean).join(', ');
      items.push({ label: 'Province', value: `No. ${p.id} · ${p.terrain} (${kind}) · ${fmtInt(p.area / SQ_KM_PER_SQ_MI)} sq mi${extra ? ` · ${extra}` : ''} · ${p.neighbours.length} neighbours` });
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
      // Opening a world with provinces: grow them again from their seeds.
      if (!map && w.provinces && !busy) {
        opts.sizeMi = w.provinces.sizeMi;
        opts.seaFactor = w.provinces.seaFactor;
        renderSettings();
        run(false);
        return;
      }
      render();
    },
    setActive(on) {
      active = on;
      if (on) {
        renderSettings();
        render();
      }
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

function sameSaved(a: SavedProvinces | null | undefined, b: SavedProvinces): boolean {
  if (!a || a.nextId !== b.nextId || a.sizeMi !== b.sizeMi || a.seaFactor !== b.seaFactor || a.ids.length !== b.ids.length) return false;
  for (let i = 0; i < a.ids.length; i++) if (a.ids[i] !== b.ids[i]) return false;
  for (let i = 0; i < a.seeds.length; i++) if (a.seeds[i] !== b.seeds[i]) return false;
  return true;
}
