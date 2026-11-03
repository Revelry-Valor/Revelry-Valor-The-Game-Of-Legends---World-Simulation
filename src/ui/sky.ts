import type { Climate } from '../core/climate';
import { RAIN_NAMES, rainClass } from '../core/climate';
import { cToF } from '../core/settings';
import { islandArea, islandAt, skyFalls, skyIslands, skyPaintedCover, SKY_ALT_KM, SKY_COVER_NAMES, SKY_LAYERS, type SkyIsland, type SkyLayer } from '../core/sky';
import { autoSkyCover, driftPerYear, skyClimate, type SkyClimate } from '../core/skyclimate';
import { kmToMiles } from '../core/units';
import type { World } from '../core/world';
import { choice, h } from './dom';
import type { InfoItem } from './info';
import type { MapOverlay } from './mapview';
import { paintShape } from './underdark';

/**
 * The Sky tab and map layer (Phase 12 step 2): floating islands on three sky layers, each with its
 * own colder, windier climate, their cover, waterfalls and drift. Viewing a sky layer draws it over
 * a hazy copy of the land, with the lower sky layers faint beneath it.
 */

export interface SkyDeps {
  world(): World;
  climate(): Climate | null;
  /** The sky layer chosen under View (shown outside the tab too), if any. */
  shownElsewhere(): SkyLayer | null;
  /** The sky layer chosen in the tab changed (the map shows it). */
  layerPicked(l: SkyLayer): void;
  /** Switch a sky layer on or off for this world. */
  setUsed(l: SkyLayer, on: boolean): void;
  /** Set how an island drifts (one undo step). */
  setDrift(isl: SkyIsland, drift: SkyIsland['drift']): void;
}

export interface Sky {
  panel: HTMLElement;
  overlay: MapOverlay;
  setActive(on: boolean): void;
  /** The sky layer the map shows now, if any. */
  showing(): SkyLayer | null;
  /** The layer new sky strokes go on (the tab's choice). */
  paintLayer(): SkyLayer;
  invalidate(): void;
}

const LAYER_ID = { 1: 'sky1', 2: 'sky2', 3: 'sky3' } as const;
const COVER_COLOUR = { meadow: '#86b25a', forest: '#3f7a3a', rock: '#9a9088', tundra: '#a9b59a', snow: '#eef3f7' } as const;
const PAINTED = { skymeadow: COVER_COLOUR.meadow, skyforest: COVER_COLOUR.forest, skyrock: COVER_COLOUR.rock } as Record<string, string>;
const UNDERSIDE = '#4d4036';

const fmtT = (c: number) => `${Math.round(cToF(c))}°F`;
const windWord = (w: number) => (w < 0.25 ? 'light winds' : w < 0.55 ? 'steady winds' : w < 0.85 ? 'strong winds' : 'gales');

export function createSky(d: SkyDeps): Sky {
  let active = false;
  let layer: SkyLayer = 1;
  const cvs: HTMLCanvasElement[] = [];
  const showing = (): SkyLayer | null => {
    if (active) return layer;
    const l = d.shownElsewhere();
    return l && d.world().layers[LAYER_ID[l]] ? l : null;
  };
  const climateOf = (isl: SkyIsland): SkyClimate | null => {
    const cl = d.climate();
    return cl ? skyClimate(cl, d.world().settings, isl.layer, isl.x, isl.y) : null;
  };
  const off = (i: number, like: HTMLCanvasElement): CanvasRenderingContext2D => {
    let cv = cvs[i];
    if (!cv) cv = cvs[i] = document.createElement('canvas');
    if (cv.width !== like.width || cv.height !== like.height) {
      cv.width = like.width;
      cv.height = like.height;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, cv.width, cv.height);
    return g;
  };

  /** One layer's islands: their ground (coloured by cover), a rocky underside, falls and drift. */
  const drawLayer = (g: CanvasRenderingContext2D, l: SkyLayer, faint: boolean, at: (x: number, y: number, c: number) => [number, number], scale: number, copies: number[]) => {
    const w = d.world();
    const strokes = w.surface.strokes.filter((s) => (s.sky ?? 1) === l);
    if (!strokes.some((s) => s.brush === 'skyisland' && !s.erase)) return;
    const islands = skyIslands(w.surface).filter((i) => i.layer === l);
    const colourOf = new Map<number, string>();
    for (const isl of islands) {
      const k = climateOf(isl);
      const c = COVER_COLOUR[k ? autoSkyCover(k) : 'meadow'];
      for (const s of isl.strokes) colourOf.set(s.id, c);
    }
    const cv = g.canvas as HTMLCanvasElement;
    const tf = g.getTransform();
    const ground = off(0, cv);
    const cover = off(1, cv);
    const under = off(2, cv);
    ground.setTransform(tf);
    cover.setTransform(tf);
    for (const st of strokes) {
      if (st.brush === 'skyisland') paintShape(ground, st, colourOf.get(st.id) ?? COVER_COLOUR.meadow, at, scale, copies);
      else if (PAINTED[st.brush]) paintShape(cover, st, PAINTED[st.brush], at, scale, copies);
    }
    ground.setTransform(1, 0, 0, 1, 0, 0);
    cover.setTransform(1, 0, 0, 1, 0, 0);
    cover.globalCompositeOperation = 'destination-in';
    cover.drawImage(ground.canvas, 0, 0);
    ground.globalCompositeOperation = 'source-over';
    ground.drawImage(cover.canvas, 0, 0);
    // The underside: the island's shape in dark rock, hanging a little below it.
    under.drawImage(ground.canvas, 0, 0);
    under.globalCompositeOperation = 'source-in';
    under.fillStyle = UNDERSIDE;
    under.fillRect(0, 0, cv.width, cv.height);
    const dpr = Math.abs(tf.d) || 1;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = faint ? 0.5 : 1;
    for (const dy of faint ? [4] : [3, 6, 9]) g.drawImage(under.canvas, 0, dy * dpr);
    g.shadowColor = 'rgba(20,30,40,0.55)';
    g.shadowBlur = faint ? 4 : 10;
    g.shadowOffsetY = (faint ? 6 : 14) * dpr;
    g.drawImage(ground.canvas, 0, 0);
    g.restore();
    if (faint) return;
    // Waterfalls: a white streak off the edge; a pool below only from a fixed island.
    g.save();
    for (const f of skyFalls(w.surface)) {
      if ((f.stroke.sky ?? 1) !== l) continue;
      for (const c of copies) {
        const [x, y] = at(f.stroke.pts[0], f.stroke.pts[1], c);
        const grad = g.createLinearGradient(x, y, x, y + 22);
        grad.addColorStop(0, 'rgba(235,248,255,0.95)');
        grad.addColorStop(1, f.lands ? 'rgba(160,210,240,0.85)' : 'rgba(235,248,255,0)');
        g.strokeStyle = grad;
        g.lineWidth = 3.5;
        g.lineCap = 'round';
        g.setLineDash(f.lands ? [] : [3, 3]);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 22);
        g.stroke();
        g.setLineDash([]);
        if (f.lands) {
          g.fillStyle = 'rgba(120,190,235,0.8)';
          g.beginPath();
          g.ellipse(x, y + 24, 5, 2.5, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // Drift: an arrow with the wind, or the drawn path.
    g.lineWidth = 2;
    for (const isl of islands) {
      if (isl.drift === 'fixed') continue;
      g.strokeStyle = '#21547f';
      g.fillStyle = '#21547f';
      for (const c of copies) {
        let tip: [number, number];
        let from: [number, number];
        if (isl.drift === 'path' && isl.path) {
          g.setLineDash([6, 4]);
          g.beginPath();
          for (let i = 0; i < isl.path.length; i += 2) {
            const [x, y] = at(isl.path[i], isl.path[i + 1], c);
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.stroke();
          g.setLineDash([]);
          const n = isl.path.length;
          tip = at(isl.path[n - 2], isl.path[n - 1], c);
          from = at(isl.path[n - 4], isl.path[n - 3], c);
        } else {
          const k = climateOf(isl);
          const u = k?.windU ?? 1;
          const v = k?.windV ?? 0;
          const m = Math.hypot(u, v) || 1;
          from = at(isl.x, isl.y, c);
          tip = [from[0] + (u / m) * 34, from[1] - (v / m) * 34];
          g.beginPath();
          g.moveTo(...from);
          g.lineTo(...tip);
          g.stroke();
        }
        const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
        g.beginPath();
        g.moveTo(...tip);
        g.lineTo(tip[0] - 9 * Math.cos(a - 0.45), tip[1] - 9 * Math.sin(a - 0.45));
        g.lineTo(tip[0] - 9 * Math.cos(a + 0.45), tip[1] - 9 * Math.sin(a + 0.45));
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  };

  // ---- The tab ----
  const body = h('div', {});
  const panel = h('section', { class: 'view-panel sky-panel' }, h('h2', {}, 'Sky islands'), body);
  const render = () => {
    const w = d.world();
    const islands = skyIslands(w.surface).filter((i) => i.layer === layer);
    const falls = skyFalls(w.surface);
    const used = w.layers[LAYER_ID[layer]];
    const rows = islands.map((isl, n) => {
      const k = climateOf(isl);
      const sq = Math.round(kmToMiles(kmToMiles(islandArea(w.surface, isl))));
      const painted = skyPaintedCover(w.surface, layer, isl.x, isl.y);
      const cov = painted ?? (k ? autoSkyCover(k) : null);
      const nf = falls.filter((f) => f.island?.id === isl.id).length;
      const per = k ? driftPerYear(isl, k) : 0;
      return h('div', { class: 'sky-island' },
        h('p', { class: 'small' }, h('strong', {}, `Island ${n + 1}`), ` · about ${sq.toLocaleString('en-US')} sq mi${cov ? ` · ${SKY_COVER_NAMES[cov].toLowerCase()}` : ''}${nf ? ` · ${nf} waterfall${nf === 1 ? '' : 's'}` : ''}`),
        h('p', { class: 'muted small' }, k ? `Summer ${fmtT(k.summerT)}, ${RAIN_NAMES[rainClass(k.summerRain)]}; winter ${fmtT(k.winterT)}, ${RAIN_NAMES[rainClass(k.winterRain)]}; ${windWord(k.wind)}.` : 'Working out its climate…'),
        choice<SkyIsland['drift']>('Drift', [{ value: 'fixed', label: 'Fixed' }, { value: 'wind', label: 'With the wind' }, { value: 'path', label: isl.path ? 'Along its path' : 'Along a path (draw one)' }], isl.drift, (v) => {
          if (v === 'path' && !isl.path) {
            render();
            return;
          }
          d.setDrift(isl, v);
          render();
        }),
        isl.drift !== 'fixed' ? h('p', { class: 'muted small' }, `Drifts about ${Math.round(kmToMiles(per))} miles a year once the peoples live (step 4); its waterfalls blow away to mist.`) : null,
      );
    });
    body.replaceChildren(
      choice<string>('Sky layer', SKY_LAYERS.map((l) => ({ value: String(l), label: `${l}: about ${Math.round(kmToMiles(SKY_ALT_KM[l]) * 10) / 10} miles up` })), String(layer), (v) => {
        layer = Number(v) as SkyLayer;
        d.layerPicked(layer);
        render();
      }),
      h('label', { class: 'field-row small' },
        h('input', { type: 'checkbox', checked: used, onchange: (e: Event) => { d.setUsed(layer, (e.target as HTMLInputElement).checked); render(); } }),
        `This world uses sky layer ${layer}`),
      h('p', { class: 'muted small' }, 'Islands float over the land and sea without blocking its sun, rain or wind. Each layer is colder and windier than the one below; islands with no painted cover take meadow, tundra or snow from their climate. Strokes that touch make one island. The brushes paint on the layer chosen here.'),
      h('h3', {}, `Islands on layer ${layer}`),
      ...(rows.length ? rows : [h('p', { class: 'small' }, 'None yet: paint one with the Sky island brush.')]),
      h('p', { class: 'muted small' }, 'While this tab is open the map shows this layer over a hazy copy of the land (the layers below faint beneath it). To see a sky layer from other tabs, choose it under View → Layers.'),
    );
  };

  // ---- The map layer ----
  const overlay: MapOverlay = {
    draw(g, at, scale, copies) {
      const l = showing();
      if (!l) return;
      const cv = g.canvas as HTMLCanvasElement;
      const tf = g.getTransform();
      const haze = (a: number) => {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = `rgba(214,228,242,${a})`;
        g.fillRect(0, 0, cv.width, cv.height);
        g.restore();
      };
      haze(0.5);
      for (const lower of SKY_LAYERS) {
        if (lower >= l) break;
        drawLayer(g, lower, true, at, scale, copies);
        haze(0.3);
      }
      g.setTransform(tf);
      drawLayer(g, l, false, at, scale, copies);
      g.setTransform(tf);
    },
    describe(x, y) {
      const l = showing();
      if (!l) return null;
      const w = d.world();
      const isl = islandAt(w.surface, l, x, y);
      const items: InfoItem[] = [];
      if (!isl) {
        items.push({ label: `Sky layer ${l}`, value: 'Open sky' });
        return items;
      }
      const n = skyIslands(w.surface).filter((i) => i.layer === l).indexOf(isl) + 1;
      const k = climateOf(isl);
      const cl = d.climate();
      const here = cl ? skyClimate(cl, w.settings, l, x, y) : null;
      const cov = skyPaintedCover(w.surface, l, x, y) ?? (k ? autoSkyCover(k) : null);
      items.push({ label: `Sky layer ${l}`, value: `Island ${n}${cov ? ` · ${SKY_COVER_NAMES[cov].toLowerCase()}` : ''} · ${isl.drift === 'fixed' ? 'fixed' : isl.drift === 'wind' ? 'drifts with the wind' : 'drifts along its path'}` });
      if (here) {
        items.push({ label: 'Up here, summer', value: `${fmtT(here.summerT)}, ${RAIN_NAMES[rainClass(here.summerRain)]}` });
        items.push({ label: 'Up here, winter', value: `${fmtT(here.winterT)}, ${RAIN_NAMES[rainClass(here.winterRain)]}` });
        items.push({ label: 'Wind up here', value: windWord(here.wind) });
      }
      return items;
    },
  };

  render();
  return {
    panel,
    overlay,
    setActive(on) {
      active = on;
      if (on) {
        d.layerPicked(layer);
        render();
      }
    },
    showing,
    paintLayer: () => layer,
    invalidate() {
      if (active) render();
    },
  };
}
