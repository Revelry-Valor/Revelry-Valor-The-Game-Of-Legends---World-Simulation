import { airSizesOf, generateAirProvinces, type AirProvinceMap, type AirSizes, type LayerSeeds, type SavedAirProvinces } from '../core/airprov';
import { fineIndex } from '../core/finegeo';
import { giantTrees, giantVines, VINE_END_NAMES } from '../core/canopy';
import type { VineEnd } from '../core/paint';
import { PROVINCE_SIZE_MI } from '../core/provinces';
import { SKY_LAYERS, skyLayerId, type SkyLayer } from '../core/sky';
import type { World } from '../core/world';
import ProvinceWorker from '../render/provinceworker?worker&inline';
import { h, numberField } from './dom';
import type { MapOverlay } from './mapview';
import type { ProvinceDisplay } from './provinces';

/**
 * The canopy's and the sky layers' provinces (the layers' provinces, step 2): their part of the
 * Provinces tab (sizes; make, update, remove; which layer to look at) and the map layer that shows a
 * layer's provinces in its view (the canopy view, or a sky layer's).
 */

export interface AirProvincesDeps {
  world(): World;
  setSaved(saved: SavedAirProvinces | null): void;
  ready(): boolean;
  redraw(): void;
  display(): ProvinceDisplay;
  tabOpen(): boolean;
  /** The canopy or sky layer the map shows now (0 the canopy), or null. */
  shown(): SkyLayer | null;
  /** Show this layer on the map (null: the surface). */
  show(l: SkyLayer | null): void;
  mapChanged?(): void;
  /** Who holds a province of a layer (by id), when the peoples live. */
  holder?(l: SkyLayer, id: number): { name: string; colour: string } | null;
}

export interface AirProvinces {
  panel: HTMLElement;
  overlay: MapOverlay;
  climateChanged(): void;
  /** Each layer's provinces made so far (0 the canopy). */
  maps(): Map<SkyLayer, AirProvinceMap>;
  dispose(): void;
}

const SQ_KM_PER_SQ_MI = 2.589988;
const fmt = (v: number) => Math.round(v).toLocaleString();
const NAME = (l: SkyLayer) => (l === 0 ? 'Canopy' : `Sky layer ${l}`);
const BASE: Record<string, [number, number, number, number]> = { air: [150, 190, 235, 0.28], island: [110, 160, 80, 0.7], limb: [120, 85, 45, 0.85], vine: [70, 140, 50, 0.85] };

interface Drawn {
  paths: Path2D[];
  lines: Path2D;
  colours: string[];
}

export function createAirProvinces(d: AirProvincesDeps): AirProvinces {
  const maps = new Map<SkyLayer, AirProvinceMap>();
  const drawn = new Map<SkyLayer, Drawn>();
  let basis: unknown = null;
  let busy = false;
  let error = '';
  let selected: { layer: SkyLayer; id: number } | null = null;
  const opts: AirSizes = airSizesOf(d.world().airProvinces);

  let worker: Worker | null = null;
  let jobId = 0;
  let pending: ((m: AirProvinceMap | null, err?: string) => void) | null = null;
  try {
    worker = new ProvinceWorker();
    worker.onmessage = (e) => {
      const r = e.data as { id: number; map?: AirProvinceMap; error?: string };
      if (r.id !== jobId || !pending) return;
      const done = pending;
      pending = null;
      done(r.map ?? null, r.error);
    };
  } catch {
    worker = null;
  }

  /** The layers that get provinces: the canopy always (it is the ground's airspace), and each sky layer in use. */
  const layersInUse = (): SkyLayer[] => SKY_LAYERS.filter((l) => l === 0 || d.world().layers[skyLayerId(l)]);

  const one = (l: SkyLayer, saved: LayerSeeds | null): Promise<AirProvinceMap> =>
    new Promise((resolve, reject) => {
      const w = d.world();
      const job = { layer: 'air' as const, skyLayer: l, surface: w.surface, settings: w.settings, ...opts, saved };
      if (worker) {
        jobId++;
        pending = (m, err) => (m ? resolve(m) : reject(new Error(err || 'The provinces could not be made.')));
        worker.postMessage({ id: jobId, ...job });
      } else
        setTimeout(() => {
          try {
            resolve(generateAirProvinces(job.surface, job.settings, l, job));
          } catch (err) {
            reject(err);
          }
        }, 30);
    });

  const run = async (fresh: boolean) => {
    if (busy || !d.ready()) return;
    busy = true;
    error = '';
    render();
    const w = d.world();
    const madeFrom = w.surface.strokes;
    const prev = w.airProvinces;
    const sameSizes = !!prev && (Object.keys(opts) as (keyof AirSizes)[]).every((k) => airSizesOf(prev)[k] === opts[k]);
    const layers: SavedAirProvinces['layers'] = {};
    try {
      maps.clear();
      drawn.clear();
      for (const l of layersInUse()) {
        const m = await one(l, !fresh && sameSizes ? prev?.layers[String(l) as '0'] ?? null : null);
        maps.set(l, m);
        drawn.set(l, toDrawn(m));
        layers[String(l) as '0'] = m.seeds;
      }
      basis = madeFrom;
      d.setSaved({ v: 1, ...opts, layers });
      d.mapChanged?.();
    } catch (err) {
      error = (err as Error).message;
    }
    busy = false;
    if (selected && !maps.get(selected.layer)?.provinces.some((p) => p.id === selected!.id)) selected = null;
    render();
    d.redraw();
  };

  const toDrawn = (m: AirProvinceMap): Drawn => {
    const paths = m.rings.map((rings) => {
      const p = new Path2D();
      for (const r of rings) {
        p.moveTo(r[0], r[1]);
        for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
        p.closePath();
      }
      return p;
    });
    const lines = new Path2D();
    for (const b of m.borders) {
      if (b.a < 0 || b.b < 0) continue;
      lines.moveTo(b.pts[0], b.pts[1]);
      for (let i = 2; i < b.pts.length; i += 2) lines.lineTo(b.pts[i], b.pts[i + 1]);
    }
    const colours = m.provinces.map((p) => {
      const [r, g, b, a] = BASE[p.kind] ?? BASE.air;
      const v = 0.82 + 0.36 * hash01(p.id * 7 + m.layer);
      return `rgba(${Math.min(255, Math.round(r * v))},${Math.min(255, Math.round(g * v))},${Math.min(255, Math.round(b * v))},${a})`;
    });
    return { paths, lines, colours };
  };

  // ---- Its part of the Provinces tab ----
  const settings = h('div', {});
  const actions = h('div', { class: 'sketch-actions' });
  const showRow = h('div', { class: 'sketch-actions' });
  const status = h('div', { class: 'small' });
  const card = h('div', { class: 'prov-card small' });
  const panel = h('section', { class: 'view-panel air-prov-panel' },
    h('h2', {}, 'Canopy and sky provinces'),
    h('p', { class: 'muted small' }, 'The canopy is the ground’s own airspace, and it and each sky layer in use are split all over, land and sea alike, into open-air provinces: where airships fly, as ships sail the sea provinces. Islands have land provinces of their own; limbs (with the trunks they reach out from) and vines run as strings of provinces, like rivers. A vine’s provinces are on the layer of its lower end (the ground’s count as the canopy’s).'),
    settings,
    actions,
    showRow,
    status,
    card,
  );
  const slider = (label: string, key: keyof AirSizes, hint: string) =>
    numberField({ label, value: opts[key], min: PROVINCE_SIZE_MI.min, max: PROVINCE_SIZE_MI.max, step: 5, unit: 'miles', slider: true, hint, change: (v) => { if (v > 0) { opts[key] = Math.max(PROVINCE_SIZE_MI.min, Math.min(PROVINCE_SIZE_MI.max, v)); render(); } } });
  const renderSettings = () =>
    settings.replaceChildren(
      slider('Open-air provinces', 'airMi', 'About how far across an open-air province is (where airships fly).'),
      slider('Island provinces', 'islandMi', 'About how far across a province on an island is.'),
      slider('Limb and vine provinces', 'strandMi', 'About how long a stretch of limb or vine each of their provinces is.'),
    );
  const render = () => {
    const w = d.world();
    const saved = w.airProvinces;
    const was = saved ? airSizesOf(saved) : null;
    const resized = !!was && (Object.keys(opts) as (keyof AirSizes)[]).some((k) => was[k] !== opts[k]);
    const outOfDate = maps.size > 0 && basis !== w.surface.strokes;
    const notReady = !d.ready();
    actions.replaceChildren(
      h('button', { type: 'button', class: 'primary', disabled: busy || notReady, title: 'Make new canopy and sky provinces (new ids).', onclick: () => void run(true) }, saved ? 'Generate new' : 'Generate canopy and sky provinces'),
      ...(saved && !resized ? [h('button', { type: 'button', class: 'ghost', disabled: busy || notReady || !outOfDate, title: 'Fit them to the painting as it is now, keeping each province (and its id) where it was.', onclick: () => void run(false) }, 'Update to the map')] : []),
      ...(saved ? [h('button', { type: 'button', class: 'ghost danger', disabled: busy, onclick: () => { maps.clear(); drawn.clear(); basis = null; d.setSaved(null); d.mapChanged?.(); render(); d.redraw(); } }, 'Remove')] : []),
    );
    const shown = d.shown();
    showRow.replaceChildren(
      h('span', { class: 'small muted' }, 'Show: '),
      ...[null, ...layersInUse()].map((l) => h('button', { type: 'button', class: 'ghost small', 'aria-pressed': shown === l ? 'true' : 'false', onclick: () => { d.show(l); render(); } }, l === null ? 'Surface' : NAME(l))),
    );
    const out: HTMLElement[] = [];
    if (busy) out.push(h('p', {}, 'Making the canopy and sky provinces…'));
    if (error) out.push(h('p', { class: 'warn' }, error));
    for (const [l, m] of maps) {
      const c = { air: 0, island: 0, limb: 0, vine: 0 };
      for (const p of m.provinces) c[p.kind]++;
      out.push(h('p', {}, h('strong', {}, `${NAME(l)}: ${fmt(m.provinces.length)} provinces`), ` (${fmt(c.air)} open air, ${fmt(c.island)} island, ${fmt(c.limb)} limb, ${fmt(c.vine)} vine).`));
    }
    if (outOfDate) out.push(h('p', { class: 'warn' }, 'The map has changed since: update them to fit it (each keeps its place and id), or generate new ones.'));
    if (resized) out.push(h('p', { class: 'warn' }, 'The sizes have changed: generate new provinces to use them.'));
    if (!maps.size && !busy) out.push(h('p', { class: 'muted' }, saved && !notReady ? 'Growing them again from their saved seeds…' : 'None yet. They show in the canopy view and each sky layer’s view.'));
    status.replaceChildren(...out);
    renderCard();
  };
  const renderCard = () => {
    const m = selected ? maps.get(selected.layer) : null;
    const p = m?.provinces.find((q) => q.id === selected!.id);
    if (!m || !p) {
      card.replaceChildren();
      return;
    }
    card.replaceChildren(
      h('h3', {}, `${NAME(m.layer)} province No. ${p.id}`),
      h('dl', { class: 'info-list' }, ...[['Kind', p.terrain], ['Size', `${fmt(p.area / SQ_KM_PER_SQ_MI)} sq mi`], ['Neighbours', `${p.neighbours.length}`]].flatMap(([a, b]) => [h('dt', {}, a), h('dd', {}, b)])),
    );
  };
  const pick = (l: SkyLayer, x: number, y: number) => {
    const m = maps.get(l);
    if (!m) return null;
    const k = fineIndex(m.grid, m.wrapKm, x, y);
    return k >= 0 && m.label[k] >= 0 ? m.provinces[m.label[k]] : null;
  };

  // ---- The map layer ----
  const overlay: MapOverlay = {
    down(x, y) {
      const l = d.shown();
      if (!d.tabOpen() || l === null || !maps.has(l)) return false;
      const p = pick(l, x, y);
      selected = p ? { layer: l, id: p.id } : null;
      render();
      d.redraw();
      return false;
    },
    draw(g, at, scale, copies) {
      const l = d.shown();
      if (l === null) return;
      const m = maps.get(l);
      const dr = drawn.get(l);
      if (!m || !dr) return;
      const show: ProvinceDisplay = d.tabOpen() ? 'colour' : d.display();
      if (show === 'off') return;
      const sel = selected && selected.layer === l && d.tabOpen() ? m.provinces.findIndex((p) => p.id === selected!.id) : -1;
      for (const c of copies) {
        const [ox, oy] = at(0, 0, c);
        g.save();
        g.translate(ox, oy);
        g.scale(scale, scale);
        if (show === 'colour') for (let i = 0; i < dr.paths.length; i++) {
          g.fillStyle = dr.colours[i];
          g.fill(dr.paths[i]);
        }
        else if (d.holder) {
          g.globalAlpha = 0.45;
          for (let i = 0; i < dr.paths.length; i++) {
            const hd = d.holder(l, m.provinces[i].id);
            if (!hd) continue;
            g.fillStyle = hd.colour;
            g.fill(dr.paths[i]);
          }
          g.globalAlpha = 1;
        }
        g.lineJoin = 'round';
        g.strokeStyle = show === 'colour' ? 'rgba(20,40,70,0.55)' : 'rgba(40,70,110,0.4)';
        g.lineWidth = 1 / scale;
        g.stroke(dr.lines);
        if (sel >= 0) {
          g.strokeStyle = 'rgba(255,255,255,0.95)';
          g.lineWidth = 3.5 / scale;
          g.stroke(dr.paths[sel]);
        }
        g.restore();
      }
    },
    describe(x, y) {
      const l = d.shown();
      if (l === null) return null;
      const p = pick(l, x, y);
      if (!p) return null;
      // Its links to the other layers: trunks down to the ground, and vine ends.
      const links: string[] = [];
      const surf = d.world().surface;
      if (l === 0) {
        const trunks = giantTrees(surf).filter((t) => pick(l, t.x, t.y) === p).length;
        if (trunks) links.push(`${trunks} trunk${trunks === 1 ? '' : 's'} down to the ground`);
      }
      for (const v of giantVines(surf, () => true)) {
        const pts = v.stroke.pts;
        for (const [x, y, here, there] of [[pts[0], pts[1], v.from, v.to], [pts[pts.length - 2], pts[pts.length - 1], v.to, v.from]] as [number, number, VineEnd, VineEnd][]) {
          const onThis = here === skyLayerId(l) || (l === 0 && here === 'surface');
          if (onThis && there !== here && pick(l, x, y) === p) links.push(`a vine to ${VINE_END_NAMES[there]}`);
        }
      }
      const hd = d.holder?.(l, p.id);
      return [{ label: `${NAME(l)} province`, value: `No. ${p.id} · ${p.terrain}${p.kind === 'air' ? ' (airships fly here)' : ''} · ${fmt(p.area / SQ_KM_PER_SQ_MI)} sq mi · ${p.neighbours.length} neighbours` }, ...(hd ? [{ label: 'Held by', value: hd.name }] : []), ...(links.length ? [{ label: 'Links', value: links.join('; ') }] : [])];
    },
  };

  renderSettings();
  render();
  return {
    panel,
    overlay,
    climateChanged() {
      const w = d.world();
      if (!maps.size && w.airProvinces && !busy) {
        Object.assign(opts, airSizesOf(w.airProvinces));
        renderSettings();
        void run(false);
        return;
      }
      render();
    },
    maps: () => maps,
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
