import { freshWaters, geoCell, geoNames, lakeAt, riverAt, type GeoFeature } from '../core/geography';
import { autoCoverName, climateAt, climateCrystals, nearestPoint, rainClass, RAIN_NAMES, sampleField, ZONE_INFO, type Climate, type FlowPath } from '../core/climate';
import { brushInfo, inSeason, penColour, roundPath, sketchCourse, strokeBounds, ZONES, type BrushId, type Stroke } from '../core/paint';
import { cToF, kmPerDegree, latitudeAt, southLatitude } from '../core/settings';
import { surfaceAt } from '../core/terrain';
import { finishCourse, onWater } from '../core/water';
import { formatDistance, formatLatitude, kmToMiles, milesToKm } from '../core/units';
import type { ReferenceImage, World } from '../core/world';
import { MapCache, type MapLook } from '../render/mapcache';
import { tempColourF } from '../render/paintmap';
import { h } from './dom';
import type { InfoItem } from './info';

/** Brush settings without a path: what the tool panel edits. */
export type BrushSettings = Omit<Stroke, 'id' | 'pts'>;

export interface ToolState {
  /** The selected brush, or 'pan' to move the map. */
  tool: BrushId | 'pan';
  erase: boolean;
  settings: BrushSettings;
  /** Current sketches: draw new ones, or adjust the ones drawn. */
  sketchMode?: 'draw' | 'adjust';
  /** ITCZ: draw a new line instead of dragging the belt (dragging is the default). */
  itczDraw?: boolean;
}

/** Whether a sketch tool is picking and dragging (rather than drawing a new line). */
const adjustMode = (t: ToolState) => (t.tool === 'itcz' ? !t.itczDraw : t.sketchMode === 'adjust');

/** What can be done to the selected high-pressure zone (for the tool panel). */
export interface HighOps {
  selected(): Stroke | null;
  /** Change it (strength, reach, season); `undoStep` saves an undo step first. */
  set(patch: Partial<Stroke>, undoStep?: boolean): void;
  remove(): void;
  /** Copy it into the other season. */
  copyToOtherSeason(): void;
}

/** What can be done to the selected current sketch (for the tool panel). */
export interface SketchOps {
  selected(): Stroke | null;
  setKind(kind: 'warm' | 'cold' | 'neutral'): void;
  setSize(size: 'major' | 'secondary'): void;
  /** Copy it into the other season (for a current, wind or high that holds in one season). */
  copyToOtherSeason(): void;
  /** Change it; `undoStep` saves an undo step first. */
  set(patch: Partial<Stroke>, undoStep?: boolean): void;
  reverse(): void;
  remove(): void;
  /** ITCZ: draw a line along the path the climate worked out for the season shown, to adjust by hand. */
  traceItcz(): boolean;
}

export interface MapViewOptions {
  world(): World;
  tool(): ToolState;
  look(): MapLook & { grid: boolean; labels?: 'all' | 'main' | 'off' };
  /** The latest climate, if worked out yet. */
  climate(): Climate | null;
  /** Start a stroke: it joins the world at once and gets its id. */
  begin(stroke: Omit<Stroke, 'id'>): Stroke;
  /** The stroke being painted grew. */
  update(stroke: Stroke): void;
  /** Take back the stroke just started (a second finger turned it into a pinch). */
  cancel(): void;
  /** A short message for the person (for example, why a spur did not start). */
  notice(text: string): void;
  /** Save the strokes as an undo step before editing one in place. */
  snapshot(): void;
  /** Delete a stroke (undoable). */
  remove(id: number): void;
  /** The selected current sketch changed. */
  sketchSelected?(): void;
  /** The reference picture: whether it is being moved and sized on the map, and changing it (`done` at the end of a drag). */
  referenceEditing?(): boolean;
  /** Stretching keeps the picture's shape. */
  referenceKeepShape?(): boolean;
  setReference?(ref: ReferenceImage, done: boolean): void;
  overlay?(): MapOverlay | null;
  /** What is under the cursor, as named fields (null when the pointer leaves the map). */
  hover?(items: InfoItem[] | null): void;
}

/** Something drawn over the map and worked with the pointer (the peoples of the simulation). */
export interface MapOverlay {
  /** Draw it; `at` turns a place (km) on the map's copy `c` into screen points. */
  draw(g: CanvasRenderingContext2D, at: (x: number, y: number, c: number) => [number, number], scale: number, copies: number[]): void;
  /** A press on the map: true if the overlay takes it (then drags and the release go to it too). */
  down?(x: number, y: number, pxKm: number): boolean;
  drag?(x: number, y: number): void;
  up?(x: number, y: number): void;
  /** What it has at a place, as named fields, for the "Under the cursor" panel. */
  describe?(x: number, y: number): InfoItem[] | null;
  /** While shown, pressing the map never paints (it pans instead). */
  noPaint?: boolean;
  /** The hand tool: select what is at a place (a city, a tribe…) without moving or changing anything. */
  pick?(x: number, y: number, pxKm: number): boolean;
}

export interface MapView {
  el: HTMLElement;
  redraw(): void;
  fit(): void;
  /** The strokes changed inside these bounds (km); null for everywhere. */
  surfaceChanged(bounds: [number, number, number, number] | null): void;
  /** A new climate is ready. */
  climateChanged(): void;
  /** The selected current sketch and what can be done to it. */
  sketch: SketchOps;
  /** The selected high-pressure zone and what can be done to it. */
  high: HighOps;
  /** The map's size or position changed (canvas options). */
  worldReset(): void;
  /** The spot last clicked with the Name tool (km). */
  namePick(): { x: number; y: number } | null;
  /** Kilometres per screen pixel at the current zoom. */
  pxKm(): number;
  dispose(): void;
}

const SKETCH_COLOUR = { warm: '#e0301e', cold: '#1f66e0', neutral: '#0d1014' };
/** Brushes drawn as a course through points and adjusted afterwards: ocean currents and winds. */
type SketchBrush = 'current' | 'wind' | 'itcz' | 'divide' | 'join';
const isSketch = (t: string): t is SketchBrush => t === 'current' || t === 'wind' || t === 'itcz' || t === 'divide' || t === 'join';
const GEO_LINE = { divide: '#d1347f', join: '#1f9e62' } as const;

export function createMapView(o: MapViewOptions): MapView {
  const canvas = h('canvas', { class: 'map', 'aria-label': 'World map. Drag to paint with the selected brush.' });
  const busy = h('div', { class: 'busy small', hidden: true }, 'Drawing…');
  // Measuring: points placed along a path (left click), stopped with a right click; the total in miles.
  let measure: { pts: [number, number][]; placing: boolean } | null = null;
  const measureBox = h('div', { class: 'measure-box small', hidden: true });
  const pathKm = (pts: [number, number][]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const updateMeasure = () => {
    measureBox.hidden = !measure;
    measureBtn.setAttribute('aria-pressed', measure ? 'true' : 'false');
    if (!measure) return;
    const n = measure.pts.length;
    measureBox.replaceChildren(
      h('strong', {}, n > 1 ? `Path: ${formatDistance(pathKm(measure.pts))}` : 'Measure a path'),
      h('div', { class: 'muted' }, n > 1 ? `${n} points, ${n - 1} leg${n === 2 ? '' : 's'}` : 'Left-click to place points along a path.'),
      h('div', { class: 'muted' }, measure.placing ? 'Right-click to stop placing points.' : 'Stopped. Click to measure a new path; Esc clears.'),
    );
  };
  const measureBtn = h('button', { type: 'button', class: 'ghost', 'aria-pressed': 'false', title: 'Measure the distance along a path you place (right-click to stop)', onclick: () => {
    measure = measure ? null : { pts: [], placing: true };
    if (measure) setHand(false);
    updateMeasure();
    schedule();
  } }, 'Measure');
  // The hand: pressing the map only selects (cities, tribes, battles, a realm's land) and drags only pan; nothing is painted or moved.
  let hand = false;
  const handBtn = h('button', { type: 'button', class: 'ghost', 'aria-pressed': 'false', title: 'Hand: click to select cities and tribes, drag to pan; nothing is painted or moved', onclick: () => setHand(!hand) }, 'Hand');
  const setHand = (on: boolean) => {
    hand = on;
    handBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    canvas.classList.toggle('hand', on);
    if (on && measure) {
      measure = null;
      updateMeasure();
    }
    schedule();
  };
  // While placing points along a course (river, lava, current, wind): finish or cancel it.
  const finishBtn = h('button', { type: 'button', class: 'primary', hidden: true, title: 'Finish this course (Enter)', onclick: () => finishRoute() }, 'Finish');
  const cancelBtn = h('button', { type: 'button', class: 'ghost', hidden: true, title: 'Cancel this course (Esc)', onclick: () => { routing = null; o.notice('Cancelled.'); schedule(); } }, 'Cancel');
  const view = { cx: 0, cy: 0, scale: 1 };
  const info = () => {
    const s = o.world().settings;
    return { seed: s.seed, widthKm: s.widthKm, heightKm: s.heightKm, wrap: s.edges === 'wrap' };
  };
  let frame = 0;
  const cache = new MapCache(o.world().surface, info(), () => draw());
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const rect = () => canvas.getBoundingClientRect();
  const toScreen = (x: number, y: number, r: DOMRect) => [r.width / 2 + (x - view.cx) * view.scale, r.height / 2 + (y - view.cy) * view.scale];
  const toWorld = (sx: number, sy: number, r: DOMRect) => [view.cx + (sx - r.width / 2) / view.scale, view.cy + (sy - r.height / 2) / view.scale];

  // The stroke being painted, and where the brush is.
  let drawing: { stroke: Stroke; pointer: number } | null = null;
  let hover: { x: number; y: number } | null = null;

  function draw() {
    cancelAnimationFrame(frame);
    const r = rect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css('--void');
    g.fillRect(0, 0, r.width, r.height);
    const s = o.world().settings;
    const look = o.look();
    cache.setLook(look);
    const [x0, y0] = toScreen(0, 0, r);
    const [x1, y1] = toScreen(s.widthKm, s.heightKm, r);
    const span = x1 - x0;
    const copies = s.edges === 'wrap' ? [-1, 0, 1] : [0];
    // Open ocean under everything, until the painting arrives.
    g.fillStyle = look.style === 'paper' ? '#a9c0c1' : '#0c2a4a';
    for (const c of copies) g.fillRect(x0 + c * span, y0, span, y1 - y0);
    cache.draw(g, view, r.width, r.height);
    // Wrapped copies are dimmed so the real map stands out.
    if (s.edges === 'wrap') {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x0 - span, y0, span, y1 - y0);
      g.fillRect(x1, y0, span, y1 - y0);
    }
    drawReference(g, r);
    const cl = o.climate();
    if (cl && look.view !== 'land') drawClimate(g, r, cl, look, x0, span, copies);
    if (look.view === 'currents' || o.tool().tool === 'current') drawSketches(g, r, x0, span, copies, 'current');
    if (cl && o.tool().tool === 'wind') drawWindSway(g, r, cl, look.season, x0, span, copies);
    if (look.view === 'pressure' || look.view === 'air' || o.tool().tool === 'wind') drawSketches(g, r, x0, span, copies, 'wind');
    if (look.view === 'pressure' || o.tool().tool === 'high') drawHighs(g, r, x0, span, copies);
    for (const gl of ['divide', 'join'] as const) if (o.tool().tool === gl || (look.view === 'geo' && (o.tool().tool === 'divide' || o.tool().tool === 'join'))) drawSketches(g, r, x0, span, copies, gl);
    const ov = o.overlay?.();
    if (ov) {
      const yTop = toScreen(0, 0, r)[1];
      ov.draw(g, (x, y, c) => [x0 + c * span + x * view.scale, yTop + y * view.scale], view.scale, copies);
    }
    const labels = look.labels ?? 'all';
    if (cl?.geo && labels !== 'off') drawLabels(g, r, cl, x0, span, copies, labels);
    if (o.tool().tool === 'name') drawNamePins(g, r);
    if (o.tool().tool === 'itcz') {
      drawSketches(g, r, x0, span, copies, 'itcz');
      drawItczGhost(g, r);
    }
    if (look.grid) drawLatitudes(g, r, x0, x1, y0);
    drawBorder(g, x0, y0, x1, y1, s.edges === 'wrap');
    drawClimateTools(g, r, x0, span, copies);
    drawRoute(g, r);
    drawMeasure(g, r);
    drawCursor(g, r);
    drawScale(g, r);
    busy.hidden = !cache.busy;
    finishBtn.hidden = !routing || routing.ctrl.length < 4;
    cancelBtn.hidden = !routing;
  }

  function drawLatitudes(g: CanvasRenderingContext2D, r: DOMRect, x0: number, x1: number, y0: number) {
    const s = o.world().settings;
    const kpd = kmPerDegree(s);
    const pxPerDeg = kpd * view.scale;
    const step = pxPerDeg > 40 ? 1 : pxPerDeg > 8 ? 5 : 10;
    const north = s.northLatitude;
    const south = southLatitude(s);
    const yAt = (lat: number) => toScreen(0, (north - lat) * kpd, r)[1];
    g.font = `11px ${css('--mono')}`;
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
      const y = yAt(lat);
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      // Northern labels sit just below their lines and southern ones just above, so the labels at
      // the poles (the map's edges) never crowd the next ones in.
      // (The equator has its own label on the right.)
      if (lat !== 0) g.fillText(formatLatitude(lat), Math.max(x0, 0) + 6, lat > 0 ? y + 9 : y - 7);
    }
    const tilt = s.axialTilt;
    const named: [number, string][] = [[0, 'Equator']];
    if (tilt > 0) named.push([tilt, 'Tropic (north)'], [-tilt, 'Tropic (south)']);
    if (tilt < 90) named.push([90 - tilt, 'Arctic circle'], [-(90 - tilt), 'Antarctic circle']);
    for (const [lat, name] of named) {
      if (lat > north || lat < south) continue;
      const y = yAt(lat);
      g.strokeStyle = lat === 0 ? '#f2c36b' : 'rgba(242,195,107,0.75)';
      g.lineWidth = lat === 0 ? 1.5 : 1;
      g.setLineDash(lat === 0 ? [] : [6, 5]);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = g.strokeStyle;
      const label = `${name} ${formatLatitude(lat)}`;
      g.fillText(label, Math.min(x1, r.width) - g.measureText(label).width - 6, y - 7);
    }
  }

  /** Climate marks over the map: the ITCZ, winds and pressure centres, or currents. */
  function drawClimate(g: CanvasRenderingContext2D, r: DOMRect, cl: Climate, look: MapLook, x0: number, span: number, copies: number[]) {
    const se = look.season === 1 ? cl.summer : cl.winter;
    const s = o.world().settings;
    const yOfLat = (lat: number) => toScreen(0, (s.northLatitude - lat) * kmPerDegree(s), r)[1];
    g.save();
    // The ITCZ: where the trade winds meet and the tropical rains follow.
    {
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.setLineDash([8, 6]);
      for (const c of copies) {
        g.beginPath();
        for (let i = 0; i < cl.w; i++) {
          const sx = x0 + c * span + (cl.x0 + i * cl.step) * view.scale;
          const sy = yOfLat(se.itcz[i]);
          if (i) g.lineTo(sx, sy);
          else g.moveTo(sx, sy);
        }
        g.stroke();
      }
      g.setLineDash([]);
    }
    if (look.view === 'pressure') {
      drawPaths(g, r, se.windPaths, x0, span, copies, () => 'rgba(16,20,26,0.7)', () => 1.4);
    }
    if (look.view === 'currents') {
      const colour = (p: FlowPath, k: number) => {
        const c = p.kind[k];
        if (p.major) return c > 0 ? '#d8321f' : c < 0 ? '#1f63d8' : '#101418';
        return c > 0 ? 'rgba(232,110,90,0.9)' : c < 0 ? 'rgba(90,150,240,0.9)' : 'rgba(40,46,54,0.75)';
      };
      drawPaths(g, r, se.currentPaths, x0, span, copies, colour, (p) => (p.major ? 2.4 : 1.2));
    }
    g.restore();
  }

  /**
   * Flow paths (winds or currents), fixed to the map: lines with arrowheads at fixed distances
   * along them, so they don't move when the map does. Finer paths show when zoomed in.
   */
  function drawPaths(g: CanvasRenderingContext2D, r: DOMRect, levels: FlowPath[][], x0: number, span: number, copies: number[], colour: (p: FlowPath, k: number) => string, width: (p: FlowPath) => number) {
    if (!levels.length) return;
    const s = o.world().settings;
    const coarse = Math.max(s.widthKm, s.heightKm) / 24;
    const lv = coarse * view.scale > 230 && levels[1] ? 1 : 0;
    const gapKm = (lv ? coarse / 3 : coarse) * 1.6;
    const yTop = toScreen(0, 0, r)[1];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const p of levels[lv]) {
      const pts = p.pts;
      for (const c of copies) {
        const ox = x0 + c * span;
        const sx = (q: number) => ox + pts[q] * view.scale;
        const sy = (q: number) => yTop + pts[q + 1] * view.scale;
        // Skip paths entirely off screen.
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let q = 0; q < pts.length; q += 2) {
          minX = Math.min(minX, pts[q]);
          maxX = Math.max(maxX, pts[q]);
          minY = Math.min(minY, pts[q + 1]);
          maxY = Math.max(maxY, pts[q + 1]);
        }
        if (ox + maxX * view.scale < -20 || ox + minX * view.scale > r.width + 20 || yTop + maxY * view.scale < -20 || yTop + minY * view.scale > r.height + 20) continue;
        g.lineWidth = width(p);
        // Segments in runs of one colour.
        let q = 0;
        while (q < pts.length - 2) {
          const col = colour(p, q / 2);
          g.strokeStyle = col;
          g.beginPath();
          g.moveTo(sx(q), sy(q));
          while (q < pts.length - 2 && colour(p, q / 2) === col) {
            q += 2;
            g.lineTo(sx(q), sy(q));
          }
          g.stroke();
        }
        // Arrowheads every so far along the path, measured from its start.
        let along = 0;
        let next = gapKm * 0.5;
        for (let q2 = 2; q2 < pts.length; q2 += 2) {
          const dx = pts[q2] - pts[q2 - 2];
          const dy = pts[q2 + 1] - pts[q2 - 1];
          along += Math.hypot(dx, dy);
          if (along < next) continue;
          next += gapKm;
          const hx = sx(q2);
          const hy = sy(q2);
          if (hx < -10 || hx > r.width + 10 || hy < -10 || hy > r.height + 10) continue;
          const a = Math.atan2(dy, dx);
          const len = 4 + width(p) * 2.2;
          g.fillStyle = colour(p, q2 / 2);
          g.beginPath();
          g.moveTo(hx + Math.cos(a) * len * 0.6, hy + Math.sin(a) * len * 0.6);
          g.lineTo(hx - Math.cos(a - 0.45) * len, hy - Math.sin(a - 0.45) * len);
          g.lineTo(hx - Math.cos(a + 0.45) * len, hy - Math.sin(a + 0.45) * len);
          g.closePath();
          g.fill();
        }
      }
    }
  }

  // The area each drawn wind holds sway over (grey), the selected wind's darker; an image of the
  // climate grid, rebuilt when the climate, season or selection changes.
  let sway: { key: string; img: HTMLCanvasElement } | null = null;
  function drawWindSway(g: CanvasRenderingContext2D, r: DOMRect, cl: Climate, season: number, x0: number, span: number, copies: number[]) {
    const se = season === 1 ? cl.summer : cl.winter;
    const key = `${season}:${sel}`;
    if (!sway || sway.key !== key || swayFor !== cl) {
      const img = document.createElement('canvas');
      img.width = cl.w;
      img.height = cl.h;
      const ig = img.getContext('2d')!;
      const data = ig.createImageData(cl.w, cl.h);
      for (let k = 0; k < cl.w * cl.h; k++) {
        const id = se.windLine[k];
        if (id < 0) continue;
        const picked = id === sel;
        const a = Math.min(1, se.windSway[k] * 1.3) * (picked ? 0.55 : 0.22);
        const v = picked ? 20 : 70;
        data.data.set([v, v, v + 4, Math.round(a * 255)], k * 4);
      }
      ig.putImageData(data, 0, 0);
      sway = { key, img };
      swayFor = cl;
    }
    const yTop = toScreen(0, 0, r)[1];
    const s = o.world().settings;
    g.save();
    g.imageSmoothingEnabled = true;
    for (const c of copies) g.drawImage(sway.img, x0 + c * span, yTop, s.widthKm * view.scale, s.heightKm * view.scale);
    g.restore();
  }
  let swayFor: Climate | null = null;

  /** High-pressure zones as placed: an H with its strength; the selected one shows its reach. */
  function drawHighs(g: CanvasRenderingContext2D, r: DOMRect, x0: number, span: number, copies: number[]) {
    const t = o.tool();
    const yTop = toScreen(0, 0, r)[1];
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const st of highs()) {
      const picked = st.id === highSel && t.tool === 'high';
      for (const c of copies) {
        const sx = x0 + c * span + st.pts[0] * view.scale;
        const sy = yTop + st.pts[1] * view.scale;
        const rr = st.size * view.scale;
        if (sx < -rr - 30 || sx > r.width + rr + 30) continue;
        if (t.tool === 'high') {
          g.setLineDash([6, 6]);
          g.lineWidth = picked ? 2 : 1;
          g.strokeStyle = picked ? 'rgba(184,64,46,0.9)' : 'rgba(184,64,46,0.4)';
          g.beginPath();
          g.arc(sx, sy, rr, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
        g.fillStyle = picked ? '#ffffff' : 'rgba(255,255,255,0.85)';
        g.strokeStyle = '#b8402e';
        g.lineWidth = picked ? 3 : 2;
        g.beginPath();
        g.arc(sx, sy, 13, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#b8402e';
        g.font = `bold 15px ${css('--mono')}`;
        g.fillText('H', sx, sy + 1);
        g.font = `11px ${css('--mono')}`;
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        const label = `${Math.round(st.strength * 100)}%`;
        g.strokeText(label, sx, sy + 23);
        g.fillStyle = '#5a2016';
        g.fillText(label, sx, sy + 23);
      }
    }
    g.restore();
  }

  /**
   * Ocean currents and winds as drawn: bold lines (thinner for secondary currents and light winds)
   * with an edge and arrows; points shown while adjusting.
   */
  // ---- The reference picture: drawn over the map at its opacity; moved and sized by dragging. ----
  const refImg = new Image();
  refImg.onload = () => schedule();
  const REF_HANDLE = 16;
  function drawReference(g: CanvasRenderingContext2D, r: DOMRect) {
    const ref = o.world().reference;
    if (!ref || !ref.shown) return;
    if (refImg.getAttribute('src') !== ref.src) refImg.src = ref.src;
    const [ax, ay] = toScreen(ref.x, ref.y, r);
    const [bx, by] = toScreen(ref.x + ref.w, ref.y + ref.h, r);
    if (refImg.complete && refImg.naturalWidth) {
      g.save();
      // Kept inside the map's frame (a wrapping map shows it on the wrapped copies too).
      const s = o.world().settings;
      const [mx0, my0] = toScreen(0, 0, r);
      const [mx1, my1] = toScreen(s.widthKm, s.heightKm, r);
      const wrapped = s.edges === 'wrap';
      g.beginPath();
      g.rect(wrapped ? mx0 - (mx1 - mx0) : mx0, my0, (mx1 - mx0) * (wrapped ? 3 : 1), my1 - my0);
      g.clip();
      g.globalAlpha = ref.opacity;
      g.imageSmoothingQuality = 'high';
      g.drawImage(refImg, ax, ay, bx - ax, by - ay);
      g.restore();
    }
    if (o.referenceEditing?.()) {
      g.save();
      g.setLineDash([6, 4]);
      g.strokeStyle = '#f2c36b';
      g.lineWidth = 2;
      g.strokeRect(ax, ay, bx - ax, by - ay);
      g.setLineDash([]);
      g.fillStyle = '#f2c36b';
      g.strokeStyle = '#2a241b';
      for (const [hx, hy] of [[bx, by], [ax, ay], [bx, ay], [ax, by]]) {
        g.fillRect(hx - REF_HANDLE / 2 + 3, hy - REF_HANDLE / 2 + 3, REF_HANDLE - 6, REF_HANDLE - 6);
        g.strokeRect(hx - REF_HANDLE / 2 + 3, hy - REF_HANDLE / 2 + 3, REF_HANDLE - 6, REF_HANDLE - 6);
      }
      g.restore();
    }
  }
  let refDrag: { pointer: number; corner: number; x: number; y: number; start: ReferenceImage; keep: boolean } | null = null;
  /** Corners 0 NW, 1 NE, 2 SE, 3 SW; −1 moves the whole picture. */
  const refPointer = (e: PointerEvent, x: number, y: number): boolean => {
    const ref = o.world().reference;
    if (!ref) return false;
    const corners = [[ref.x, ref.y], [ref.x + ref.w, ref.y], [ref.x + ref.w, ref.y + ref.h], [ref.x, ref.y + ref.h]];
    let corner = corners.findIndex(([cx, cy]) => Math.hypot(cx - x, cy - y) * view.scale < REF_HANDLE);
    if (corner < 0) {
      if (x < ref.x || x > ref.x + ref.w || y < ref.y || y > ref.y + ref.h) return false;
      corner = -1;
    }
    // Shift (or the panel's Keep its shape) keeps the picture's shape while stretching.
    refDrag = { pointer: e.pointerId, corner, x, y, start: { ...ref }, keep: e.shiftKey || !!o.referenceKeepShape?.() };
    return true;
  };
  const dragReference = (x: number, y: number, done: boolean) => {
    if (!refDrag) return;
    const a = refDrag.start;
    const dx = x - refDrag.x;
    const dy = y - refDrag.y;
    let next: ReferenceImage;
    if (refDrag.corner < 0) next = { ...a, x: a.x + dx, y: a.y + dy };
    else {
      // The opposite corner stays put.
      const left = refDrag.corner === 0 || refDrag.corner === 3;
      const top = refDrag.corner === 0 || refDrag.corner === 1;
      const min = 10;
      let w = Math.max(min, a.w + (left ? -dx : dx));
      let hh = Math.max(min, a.h + (top ? -dy : dy));
      if (refDrag.keep) {
        const ratio = a.w / a.h;
        if (w / hh > ratio) hh = w / ratio;
        else w = hh * ratio;
      }
      next = { ...a, w, h: hh, x: left ? a.x + a.w - w : a.x, y: top ? a.y + a.h - hh : a.y };
    }
    o.setReference?.(next, done);
    schedule();
  };

  /**
   * The ITCZ the climate worked out, ready to grab: shown with handles while dragging, until a
   * line of its own exists for the season shown.
   */
  function autoItczCtrl(): number[] | null {
    const cl = o.climate();
    if (!cl) return null;
    const se = o.look().season === 1 ? cl.summer : cl.winter;
    const s = o.world().settings;
    const kpd = kmPerDegree(s);
    const n = Math.max(4, Math.min(16, Math.round(s.widthKm / 600)));
    const ctrl: number[] = [];
    for (let q = 0; q <= n; q++) {
      const x = Math.min(s.widthKm - 1, Math.max(1, (q / n) * s.widthKm));
      const i = Math.max(0, Math.min(cl.w - 1, Math.floor(x / cl.step)));
      ctrl.push(x, Math.max(0, Math.min(s.heightKm, (s.northLatitude - se.itcz[i]) * kpd)));
    }
    return ctrl;
  }
  function drawItczGhost(g: CanvasRenderingContext2D, r: DOMRect) {
    const t = o.tool();
    if (t.erase || !adjustMode(t) || sketches('itcz').length) return;
    const c = autoItczCtrl();
    if (!c) return;
    const p = sketchCourse(c, 0);
    g.save();
    g.lineCap = 'round';
    for (const [w, col, dash] of [[6, 'rgba(255,255,255,0.85)', []], [3, '#f2b705', [10, 6]]] as [number, string, number[]][]) {
      g.setLineDash(dash);
      g.lineWidth = w;
      g.strokeStyle = col;
      g.beginPath();
      for (let q = 0; q < p.length; q += 2) {
        const [sx, sy] = toScreen(p[q], p[q + 1], r);
        (q ? g.lineTo : g.moveTo).call(g, sx, sy);
      }
      g.stroke();
    }
    g.setLineDash([]);
    for (let q = 0; q < c.length; q += 2) {
      const [sx, sy] = toScreen(c[q], c[q + 1], r);
      g.fillStyle = '#f2b705';
      g.strokeStyle = '#11161c';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(sx, sy, 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();
  }

  // ---- Names and labels ----
  let namePicked: { x: number; y: number } | null = null;
  function drawNamePins(g: CanvasRenderingContext2D, r: DOMRect) {
    g.save();
    for (const st of o.world().surface.strokes) {
      if (st.brush !== 'name' || st.erase) continue;
      const [sx, sy] = toScreen(st.pts[0], st.pts[1], r);
      g.fillStyle = '#f2c36b';
      g.strokeStyle = '#2a241b';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(sx, sy, 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (namePicked) {
      const [sx, sy] = toScreen(namePicked.x, namePicked.y, r);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(sx, sy, 9, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#2a241b';
      g.lineWidth = 1.2;
      g.stroke();
    }
    g.restore();
  }
  /**
   * Fantasy-map labels: spaced capitals along the way each place runs, larger for more important
   * places (continents and oceans grandest). Unnamed places show what they are, in plainer
   * lettering. Labels that would crowd a more important one are left out.
   */
  function drawLabels(g: CanvasRenderingContext2D, r: DOMRect, cl: Climate, x0: number, span: number, copies: number[], which: 'all' | 'main') {
    const geo = cl.geo!;
    const names = geoNames(o.world().surface, cl);
    const paper = o.look().style === 'paper';
    const minCells = 3 * cl.step * cl.step;
    type L = { f: GeoFeature; text: string; named: boolean; water: boolean; max: number; caps: boolean; weight: number; italic: boolean; spacing: number; wide?: number };
    const list: L[] = [];
    const add = (f: GeoFeature, name: string | undefined, water: boolean, max: number, caps: boolean, weight: number, italic: boolean, spacing: number, wide = 0.32) => {
      if (f.area < minCells && !(name || f.kind === 'Mountains')) return;
      list.push({ f, text: name ?? f.kind, named: !!name, water, max, caps, weight, italic, spacing, wide });
    };
    for (const f of geo.landmasses) if (f.level === 'continent') add(f, names.land.get(f.id), false, 46, true, 700, false, 0.45);
    for (const f of geo.waters) if (f.level === 'ocean') add(f, names.water.get(f.id), true, 40, true, 600, true, 0.5);
    for (const f of geo.waters) if (f.level === 'sea') add(f, names.water.get(f.id), true, 24, true, 500, true, 0.3);
    // Mountain ranges come before other regions: they keep their own names.
    // (Their names run along the range and may be wider than it is, as on a drawn map.)
    for (const f of geo.regions) if (f.kind === 'Mountains') add(f, names.region.get(f.id), false, 20, true, 600, false, 0.3, 1.6);
    const fresh = freshWaters(o.world().surface);
    for (const f of fresh.lakes) {
      const nm = names.lake.get(f.id);
      // Named lakes always; unnamed ones only if big.
      if (nm || f.area >= minCells) list.push({ f, text: nm ?? f.kind, named: !!nm, water: true, max: 18, caps: false, weight: 600, italic: true, spacing: 0.08 });
    }
    for (const f of geo.archipelagos) add(f, names.archipelago.get(f.id), false, 17, true, 600, false, 0.25);
    for (const f of geo.landmasses) if (f.level === 'island') add(f, names.land.get(f.id), false, 15, false, 600, false, 0.08);
    for (const f of geo.waters) if (f.level === 'gulf' || f.level === 'bay') add(f, names.water.get(f.id), true, f.level === 'gulf' ? 18 : 14, false, 500, true, 0.1);
    if (which === 'all') for (const f of geo.regions) if (f.kind !== 'Mountains') add(f, names.region.get(f.id), false, 15, true, 500, false, 0.18);
    // Named places before unnamed ones (the order above holds within each).
    list.sort((a, b) => Number(b.named) - Number(a.named));
    // Placed labels as rows of circles along their lines (so slanted ones don't block a whole box).
    const taken: [number, number, number][] = [];
    const yTop = toScreen(0, 0, r)[1];
    g.save();
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const l of list) {
      const text = l.caps ? l.text.toUpperCase() : l.text;
      const chars = [...text];
      // Size: fill most of the place's length, but not more than about a third of its width.
      const em = Math.min((l.f.length * 0.8) / Math.max(3, chars.length * (0.62 + l.spacing)), l.f.width * (l.wide ?? 0.32));
      let px = Math.min(l.max, em * view.scale) * (l.named ? 1 : 0.82);
      // A named place keeps readable lettering whenever it is big enough to see, even if its name runs past its shores.
      if (l.named && px < 10 && Math.max(l.f.length, l.f.width) * view.scale >= 6) px = 10;
      if (px < 8) continue;
      px = Math.round(px);
      g.font = `${l.italic ? 'italic ' : ''}${l.weight} ${px}px ${l.water ? '"Alegreya Sans", serif' : '"Alegreya SC", Georgia, serif'}`;
      const widths = chars.map((c) => g.measureText(c).width);
      const gap = l.spacing * px;
      const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
      let placed = false;
      for (const c of copies) for (const [fx, fy] of [[l.f.x, l.f.y], ...(l.f.alt ?? [])]) {
        if (placed) break;
        const cx = x0 + c * span + fx * view.scale;
        const cy = yTop + fy * view.scale;
        const ca = Math.abs(Math.cos(l.f.angle));
        const sa = Math.abs(Math.sin(l.f.angle));
        const hw = (total / 2) * ca + (px / 2) * sa;
        const hh = (total / 2) * sa + (px / 2) * ca;
        if (cx + hw < 0 || cx - hw > r.width || cy + hh < 0 || cy - hh > r.height) continue;
        const rad = px * 0.6;
        const along: [number, number, number][] = [];
        const nC = Math.max(1, Math.ceil(total / (px * 0.9)));
        for (let q = 0; q <= nC; q++) {
          const t = -total / 2 + (total * q) / nC;
          along.push([cx + Math.cos(l.f.angle) * t, cy + Math.sin(l.f.angle) * t, rad]);
        }
        if (along.some(([a, b2, ra]) => taken.some(([c2, d, rb]) => Math.hypot(a - c2, b2 - d) < ra + rb))) continue;
        taken.push(...along);
        placed = true;
        g.save();
        g.translate(cx, cy);
        g.rotate(l.f.angle);
        g.globalAlpha = l.named ? 1 : 0.8;
        g.fillStyle = paper ? (l.water ? '#2c4f66' : '#3f3122') : l.water ? '#dcefff' : '#f8f1e2';
        g.strokeStyle = paper ? 'rgba(240,230,205,0.85)' : l.water ? 'rgba(8,28,52,0.75)' : 'rgba(28,22,14,0.75)';
        g.lineWidth = Math.max(2, px * 0.16);
        let x = -total / 2;
        chars.forEach((ch, i) => {
          g.strokeText(ch, x, 0);
          g.fillText(ch, x, 0);
          x += widths[i] + gap;
        });
        g.restore();
      }
    }
    // Named rivers: written along the river, in its middle stretch.
    for (const rv of fresh.rivers) {
      const nm = names.river.get(rv.id);
      if (!nm) continue;
      const px = Math.round(Math.max(10, Math.min(16, 9 + rv.width * 4)));
      g.font = `italic 600 ${px}px "Alegreya Sans", serif`;
      const text = [...nm];
      const widths = text.map((c) => g.measureText(c).width);
      const gap = px * 0.12;
      const total = widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1);
      for (const c of copies) {
        // The course on screen, read left to right.
        let pts: number[] = [];
        for (let q = 0; q < rv.pts.length; q += 2) pts.push(x0 + c * span + rv.pts[q] * view.scale, yTop + rv.pts[q + 1] * view.scale);
        if (pts[pts.length - 2] < pts[0]) {
          const rev: number[] = [];
          for (let q = pts.length - 2; q >= 0; q -= 2) rev.push(pts[q], pts[q + 1]);
          pts = rev;
        }
        const cum = [0];
        for (let q = 2; q < pts.length; q += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[q] - pts[q - 2], pts[q + 1] - pts[q - 1]));
        const L = cum[cum.length - 1];
        if (L < total * 1.3) continue;
        const at = (d: number): [number, number, number] => {
          let q = 1;
          while (q < cum.length - 1 && cum[q] < d) q++;
          const t = (d - cum[q - 1]) / Math.max(1e-6, cum[q] - cum[q - 1]);
          const ax = pts[(q - 1) * 2];
          const ay = pts[(q - 1) * 2 + 1];
          const bx = pts[q * 2];
          const by = pts[q * 2 + 1];
          return [ax + (bx - ax) * t, ay + (by - ay) * t, Math.atan2(by - ay, bx - ax)];
        };
        let d = L / 2 - total / 2;
        const mid = at(L / 2);
        if (mid[0] < 0 || mid[0] > r.width || mid[1] < 0 || mid[1] > r.height) continue;
        g.save();
        g.textBaseline = 'alphabetic';
        g.fillStyle = paper ? '#2c4f66' : '#dcefff';
        g.strokeStyle = paper ? 'rgba(240,230,205,0.85)' : 'rgba(8,28,52,0.8)';
        g.lineWidth = Math.max(2, px * 0.18);
        text.forEach((ch, i) => {
          const [cx, cy, a] = at(d + widths[i] / 2);
          g.save();
          g.translate(cx, cy);
          g.rotate(Math.max(-1.2, Math.min(1.2, a)));
          g.strokeText(ch, -widths[i] / 2, -px * 0.35);
          g.fillText(ch, -widths[i] / 2, -px * 0.35);
          g.restore();
          d += widths[i] + gap;
        });
        g.restore();
      }
    }
    g.restore();
  }

  function drawSketches(g: CanvasRenderingContext2D, r: DOMRect, x0: number, span: number, copies: number[], brush: SketchBrush) {
    const t = o.tool();
    const adjusting = t.tool === brush && (adjustMode(t) || t.erase);
    const yTop = toScreen(0, 0, r)[1];
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const airCl = o.look().view === 'air' ? o.climate() : null;
    const airSe = airCl ? (o.look().season === 1 ? airCl.summer : airCl.winter) : null;
    for (const st of sketches(brush)) {
      const wind = brush === 'wind';
      const itcz = brush === 'itcz' || brush === 'divide' || brush === 'join';
      const colour = brush === 'divide' || brush === 'join' ? GEO_LINE[brush] : itcz ? '#f2b705' : wind ? '#1b2027' : SKETCH_COLOUR[st.current ?? 'warm'];
      const minor = itcz ? false : wind ? st.strength < 0.45 : st.currentSize === 'secondary';
      const p = st.pts;
      for (const c of copies) {
        const ox = x0 + c * span;
        const sx = (q: number) => ox + p[q] * view.scale;
        const sy = (q: number) => yTop + p[q + 1] * view.scale;
        // In the Air & moisture view a wind is coloured by the temperature of the air it carries.
        const airAt = wind && airSe ? (q: number): string => {
          const W = o.world().settings.widthKm;
          const t = sampleField(airCl!, airSe!.temp, ((p[q] % W) + W) % W, p[q + 1]) * 1.8 + 32;
          const c = tempColourF(t);
          return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        } : null;
        for (const [w, col] of (minor ? [[3.6, 'rgba(255,255,255,0.85)'], [1.8, colour]] : [[6, 'rgba(255,255,255,0.9)'], [3.2, colour]]) as [number, string][]) {
          g.lineWidth = st.id === sel && adjusting ? w + 2 : w;
          if (airAt && col === colour) {
            for (let q = 2; q < p.length; q += 2) {
              g.strokeStyle = airAt(q);
              g.beginPath();
              g.moveTo(sx(q - 2), sy(q - 2));
              g.lineTo(sx(q), sy(q));
              g.stroke();
            }
            continue;
          }
          g.strokeStyle = col;
          g.beginPath();
          for (let q = 0; q < p.length; q += 2) (q ? g.lineTo : g.moveTo).call(g, sx(q), sy(q));
          g.stroke();
        }
        // Arrows every so far along the course (the ITCZ has no direction).
        let along = 0;
        let next = 250;
        for (let q = 2; q < (itcz ? 0 : p.length); q += 2) {
          const dx = p[q] - p[q - 2];
          const dy = p[q + 1] - p[q - 1];
          along += Math.hypot(dx, dy) * view.scale;
          if (along < next && q < p.length - 2) continue;
          next = along + (minor ? 60 : 90);
          const a = Math.atan2(dy, dx);
          const hx = sx(q);
          const hy = sy(q);
          g.fillStyle = colour;
          g.strokeStyle = 'rgba(255,255,255,0.9)';
          g.lineWidth = 1.5;
          g.beginPath();
          const hs = minor ? 0.65 : 1;
          g.moveTo(hx + Math.cos(a) * 8 * hs, hy + Math.sin(a) * 8 * hs);
          g.lineTo(hx - Math.cos(a - 0.5) * 9 * hs, hy - Math.sin(a - 0.5) * 9 * hs);
          g.lineTo(hx - Math.cos(a + 0.5) * 9 * hs, hy - Math.sin(a + 0.5) * 9 * hs);
          g.closePath();
          g.fill();
          g.stroke();
        }
        if (adjusting) {
          const k = st.ctrl!;
          for (let q = 0; q < k.length; q += 2) {
            g.fillStyle = st.id === sel ? '#ffffff' : colour;
            g.strokeStyle = '#11161c';
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(ox + k[q] * view.scale, yTop + k[q + 1] * view.scale, st.id === sel ? 6 : 4.5, 0, Math.PI * 2);
            g.fill();
            g.stroke();
          }
        }
      }
    }
    g.restore();
  }

  const penLayer = document.createElement('canvas');
  /** Crystals are always marked; Rain Shadow Pen lines and gaps show while those tools are in hand. */
  function drawClimateTools(g: CanvasRenderingContext2D, r: DOMRect, x0: number, span: number, copies: number[]) {
    const strokes = o.world().surface.strokes;
    const t = o.tool().tool;
    const at = (x: number, y: number, c: number): [number, number] => [x0 + c * span + x * view.scale, toScreen(0, y, r)[1]];
    g.save();
    if (t === 'shadowpen' || t === 'gap') {
      // Drawn in order on a layer of its own, each stroke clearing what was under it first, so
      // the map shows what is left: the latest high ground or gap in each spot, erased spots empty.
      penLayer.width = Math.max(1, Math.round(r.width));
      penLayer.height = Math.max(1, Math.round(r.height));
      const pg = penLayer.getContext('2d')!;
      pg.lineCap = 'round';
      pg.lineJoin = 'round';
      for (const st of strokes) {
        if (st.brush !== 'shadowpen' && st.brush !== 'gap') continue;
        const gap = st.brush === 'gap' || st.penMode === 'gap';
        pg.lineWidth = Math.max(1.5, st.size * view.scale);
        for (const pass of st.erase ? ['clear'] : ['clear', 'paint']) {
          pg.globalCompositeOperation = pass === 'clear' ? 'destination-out' : 'source-over';
          pg.strokeStyle = pass === 'clear' ? '#000' : gap ? 'rgb(90,170,255)' : penColour(st.penHeight ?? 2.5);
          for (const c of copies) {
            pg.beginPath();
            for (let k = 0; k < st.pts.length; k += 2) {
              const [sx, sy] = at(st.pts[k], st.pts[k + 1], c);
              if (k) pg.lineTo(sx, sy);
              else pg.moveTo(sx, sy);
            }
            if (st.pts.length === 2) pg.lineTo(at(st.pts[0], st.pts[1], c)[0] + 0.1, at(st.pts[0], st.pts[1], c)[1]);
            pg.stroke();
          }
        }
      }
      g.globalAlpha = 0.6;
      g.drawImage(penLayer, 0, 0, r.width, r.height);
      g.globalAlpha = 1;
    }
    const colours = { heat: '#ffb12e', cold: '#7fd4ff', rain: '#4f7dff' };
    for (const st of climateCrystals(o.world().surface)) {
      for (const c of copies) {
        const [sx, sy] = at(st.pts[0], st.pts[1], c);
        if (sx < -20 || sx > r.width + 20 || sy < -20 || sy > r.height + 20) continue;
        if (t === 'crystal') {
          g.strokeStyle = 'rgba(255,255,255,0.35)';
          g.setLineDash([4, 4]);
          g.beginPath();
          g.arc(sx, sy, (st.size / 2) * view.scale, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
        g.fillStyle = colours[st.crystal ?? 'heat'];
        g.strokeStyle = '#1a1a22';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(sx, sy - 9);
        g.lineTo(sx + 5.5, sy);
        g.lineTo(sx, sy + 9);
        g.lineTo(sx - 5.5, sy);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  function drawBorder(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, wrap: boolean) {
    g.strokeStyle = css('--border-map');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y0);
    g.moveTo(x0, y1);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash(wrap ? [8, 6] : []);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0, y1);
    g.moveTo(x1, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
  }

  /** Point mode: the points clicked so far, joined by dashes, and the next leg to the cursor. */
  function drawRoute(g: CanvasRenderingContext2D, r: DOMRect) {
    if (!routing) return;
    const c = routing.ctrl;
    const pts: number[] = [];
    for (let k = 0; k < c.length; k += 2) pts.push(...toScreen(c[k], c[k + 1], r));
    g.save();
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.strokeStyle = routeColour();
    g.beginPath();
    for (let k = 0; k < pts.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, pts[k], pts[k + 1]);
    if (hover) {
      const [hx, hy] = toScreen(hover.x, hover.y, r);
      g.lineTo(hx, hy);
    }
    g.stroke();
    g.setLineDash([]);
    for (let k = 0; k < pts.length; k += 2) {
      g.fillStyle = k === 0 ? '#ffffff' : g.strokeStyle;
      g.strokeStyle = '#0b2236';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(pts[k], pts[k + 1], k === 0 ? 6 : 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = routeColour();
    }
    g.restore();
  }

  function drawCursor(g: CanvasRenderingContext2D, r: DOMRect) {
    const t = o.tool();
    if (!hover || t.tool === 'pan' || panning) return;
    const [sx, sy] = toScreen(hover.x, hover.y, r);
    const rad = Math.max(2, (t.settings.size / 2) * view.scale);
    g.save();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.arc(sx, sy, rad + 1, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = t.erase ? '#ff9a8a' : '#ffffff';
    g.setLineDash(t.erase ? [4, 3] : []);
    g.beginPath();
    g.arc(sx, sy, rad, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  /** The path being measured: its legs, a dot at each point with the distance so far, and (while placing) a line to the cursor. */
  function drawMeasure(g: CanvasRenderingContext2D, r: DOMRect) {
    if (!measure || !measure.pts.length) return;
    const pts = measure.placing && hover ? [...measure.pts, [hover.x, hover.y] as [number, number]] : measure.pts;
    const scr = pts.map(([x, y]) => toScreen(x, y, r));
    g.save();
    g.lineJoin = 'round';
    for (const [w, c] of [[5, 'rgba(0,0,0,0.75)'], [2.5, '#ffd34d']] as const) {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.beginPath();
      scr.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.font = `bold 11px ${css('--mono')}`;
    g.textBaseline = 'bottom';
    let km = 0;
    scr.forEach(([x, y], i) => {
      if (i) km += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const ghost = measure!.placing && i === scr.length - 1 && hover;
      g.fillStyle = ghost ? 'rgba(255,211,77,0.6)' : '#ffd34d';
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, ghost ? 3 : 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (!i) return;
      const label = `${Math.round(kmToMiles(km)).toLocaleString('en-US')} mi`;
      g.lineWidth = 3;
      g.strokeText(label, x + 7, y - 4);
      g.fillStyle = '#fff';
      g.fillText(label, x + 7, y - 4);
    });
    g.restore();
  }

  function drawScale(g: CanvasRenderingContext2D, r: DOMRect) {
    const miles = kmToMiles(140 / view.scale);
    const p = 10 ** Math.floor(Math.log10(miles));
    const nice = [1, 2, 5, 10].map((m) => m * p).filter((m) => m <= miles).pop() ?? p;
    const len = milesToKm(nice) * view.scale;
    const x = 16;
    // Above the time bar when it is shown (it sits at the bottom left).
    const bar = canvas.parentElement?.querySelector<HTMLElement>('.sim-bar:not([hidden])');
    const y = r.height - 22 - (bar ? bar.offsetHeight + 12 : 0);
    g.fillStyle = css('--panel');
    g.globalAlpha = 0.85;
    g.fillRect(x - 8, y - 22, len + 16, 34);
    g.globalAlpha = 1;
    g.strokeStyle = css('--ink');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y - 4);
    g.lineTo(x, y);
    g.lineTo(x + len, y);
    g.lineTo(x + len, y - 4);
    g.stroke();
    g.fillStyle = css('--ink');
    g.font = `11px ${css('--mono')}`;
    g.textBaseline = 'alphabetic';
    g.fillText(`${nice.toLocaleString('en-US')} mi (${Math.round(milesToKm(nice)).toLocaleString('en-US')} km)`, x, y - 8);
  }

  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  const fit = () => {
    const r = rect();
    const s = o.world().settings;
    view.cx = s.widthKm / 2;
    view.cy = s.heightKm / 2;
    view.scale = Math.min(r.width / s.widthKm, r.height / s.heightKm) * 0.92 || 1;
    schedule();
  };

  const zoomAt = (factor: number, sx: number, sy: number) => {
    const r = rect();
    const [wx, wy] = toWorld(sx, sy, r);
    const s = o.world().settings;
    const min = Math.min(r.width / s.widthKm, r.height / s.heightKm) * 0.25;
    view.scale = Math.min(Math.max(view.scale * factor, min), 60);
    view.cx = wx - (sx - r.width / 2) / view.scale;
    view.cy = wy - (sy - r.height / 2) / view.scale;
    schedule();
  };

  // ---- Input: paint with the brush; move the map with the Move tool, Space, the middle or right button, or two fingers. ----
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let panning = false;
  let spaceDown = false;

  // Point mode for rivers and lava: the points clicked so far.
  let routing: { brush: 'river' | 'lava' | SketchBrush; ctrl: number[] } | null = null;
  const pointsMode = (t: ToolState) => ((t.tool === 'river' || t.tool === 'lava') && t.settings.route === 'points' && !t.erase) || (isSketch(t.tool) && !t.erase && !adjustMode(t));
  const opts = () => {
    const s = o.world().settings;
    return { seed: s.seed, wrapKm: s.edges === 'wrap' ? s.widthKm : 0 };
  };

  /** Bounds of a river and every river downstream of it (they all widen when it joins). */
  const downstreamBounds = (st: Stroke): [number, number, number, number] => {
    let b = strokeBounds(st);
    const seen = new Set<number>([st.id]);
    let next = st.joins?.id;
    while (next !== undefined && !seen.has(next)) {
      seen.add(next);
      const r = o.world().surface.strokes.find((s) => s.id === next);
      if (!r) break;
      const rb = strokeBounds(r);
      b = [Math.min(b[0], rb[0]), Math.min(b[1], rb[1]), Math.max(b[2], rb[2]), Math.max(b[3], rb[3])];
      next = r.joins?.id;
    }
    return b;
  };

  /** Settle a river or lava flow: find its course (point mode), what it joins and where it falls. */
  const settleCourse = (live: Stroke) => {
    const course = finishCourse(o.world().surface, live, opts());
    const done: Stroke = { ...live, pts: course.pts, joins: course.joins, falls: course.falls.length ? course.falls : undefined };
    o.update(done);
    cache.updateStroke(o.world().surface, done, downstreamBounds(done));
    schedule();
  };

  const finishRoute = () => {
    if (!routing) return;
    const { brush, ctrl } = routing;
    routing = null;
    if (ctrl.length < 4) {
      o.notice('Click at least two points: where it starts, and where it goes.');
      schedule();
      return;
    }
    const t = o.tool();
    if (brush === 'current' || brush === 'wind' || brush === 'itcz' || brush === 'divide' || brush === 'join') {
      // An ocean current or a wind: a smooth course through the points.
      const wrapKm = o.world().settings.edges === 'wrap' ? o.world().settings.widthKm : 0;
      const live = o.begin({ ...t.settings, brush, erase: undefined, pts: roundPath(sketchCourse(ctrl, wrapKm)), route: 'points', ctrl: roundPath(ctrl) });
      sel = live.id;
      o.sketchSelected?.();
      o.notice(brush === 'divide' ? 'Divide line drawn: what it crosses is cut in two once the geography updates.' : brush === 'join' ? 'Join line drawn: what it touches becomes one once the geography updates.' : brush === 'itcz' ? 'ITCZ drawn: where it runs, it replaces the automatic path for this season. Use Adjust to move or add points.' : brush === 'wind' ? 'Wind drawn. Use Adjust to move or add points, change its strength, reverse it or delete it.' : 'Current drawn. Use Adjust to move or add points, change its type, reverse it or delete it.');
      schedule();
      return;
    }
    o.notice(brush === 'river' ? 'Finding the river’s course…' : 'Finding the lava’s course…');
    schedule();
    // Let the notice show before the work starts.
    setTimeout(() => {
      const live = o.begin({ ...t.settings, brush, erase: undefined, pts: roundPath(ctrl.slice(0, 4)), route: 'points', ctrl: roundPath(ctrl) });
      settleCourse(live);
    }, 30);
  };

  const routeColour = () => {
    if (!routing) return '#bfe6ff';
    if (routing.brush === 'lava') return '#ff7a26';
    if (routing.brush === 'current') return SKETCH_COLOUR[o.tool().settings.current ?? 'warm'];
    if (routing.brush === 'wind') return '#1b2027';
    if (routing.brush === 'itcz') return '#f2b705';
    if (routing.brush === 'divide' || routing.brush === 'join') return GEO_LINE[routing.brush];
    return '#bfe6ff';
  };

  // ---- High-pressure zones: select, drag, delete ----
  let highSel: number | null = null;
  let highDrag: { id: number; pointer: number } | null = null;
  const highs = () => o.world().surface.strokes.filter((st) => st.brush === 'high' && st.pts.length >= 2 && inSeason(st, o.look().season));
  const highPointer = (e: PointerEvent, x: number, y: number, erase: boolean): boolean => {
    const W = o.world().settings.widthKm;
    const wrap = wrapKm();
    let hit: Stroke | null = null;
    let bestD = 22;
    for (const st of highs()) {
      let dx = st.pts[0] - x;
      if (wrap) dx -= Math.round(dx / W) * W;
      const d = Math.hypot(dx, st.pts[1] - y) * view.scale;
      if (d < bestD) {
        bestD = d;
        hit = st;
      }
    }
    if (!hit) {
      if (highSel !== null) {
        highSel = null;
        o.sketchSelected?.();
      }
      schedule();
      return erase;
    }
    if (erase) {
      o.remove(hit.id);
      if (highSel === hit.id) highSel = null;
      o.sketchSelected?.();
      o.notice('High deleted (Undo brings it back).');
      schedule();
      return true;
    }
    highSel = hit.id;
    o.snapshot();
    highDrag = { id: hit.id, pointer: e.pointerId };
    o.sketchSelected?.();
    schedule();
    return true;
  };
  const dragHigh = (x: number, y: number) => {
    const st = highs().find((k) => k.id === highDrag!.id);
    if (!st) return;
    o.update({ ...st, pts: [Math.round(x), Math.round(Math.max(0, Math.min(o.world().settings.heightKm, y)))] });
    schedule();
  };
  /** A copy of a one-season current, wind or high, for the other season. */
  const copySeason = (st: Stroke) => {
    const own = st.season === 'winter' ? 'winter' : st.season === 'summer' ? 'summer' : null;
    if (!own) {
      o.notice('It already holds in both seasons.');
      return;
    }
    const { id: _id, ...rest } = st;
    void _id;
    o.begin({ ...rest, season: own === 'summer' ? 'winter' : 'summer' });
    o.notice(`Copied to northern ${own === 'summer' ? 'winter' : 'summer'}. Switch the season in the View panel to see and change it.`);
    schedule();
  };
  const highOps: HighOps = {
    copyToOtherSeason() {
      const st = highOps.selected();
      if (st) copySeason(st);
    },
    selected: () => highs().find((k) => k.id === highSel) ?? null,
    set(patch, undoStep = true) {
      const st = highOps.selected();
      if (!st) return;
      if (undoStep) o.snapshot();
      o.update({ ...st, ...patch });
      schedule();
    },
    remove() {
      if (highSel === null) return;
      o.remove(highSel);
      highSel = null;
      o.sketchSelected?.();
      schedule();
    },
  };

  // ---- Ocean currents: adjust points, add points, select, delete ----
  let sel: number | null = null;
  let dragging: { id: number; idx: number; pointer: number } | null = null;
  const wrapKm = () => (o.world().settings.edges === 'wrap' ? o.world().settings.widthKm : 0);
  /** The drawn currents or winds (by default, those of the tool in hand). */
  const sketches = (b: SketchBrush = isSketch(o.tool().tool) ? (o.tool().tool as SketchBrush) : 'current') =>
    o.world().surface.strokes.filter((st) => st.brush === b && st.ctrl && st.ctrl.length >= 4 && inSeason(st, o.look().season));
  const withCtrl = (st: Stroke, ctrl: number[]): Stroke => ({ ...st, ctrl: roundPath(ctrl), pts: roundPath(sketchCourse(ctrl, wrapKm())) });
  /** Distance on screen (px) from a point to a segment. */
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(ax + vx * t - px, ay + vy * t - py) * view.scale;
  };
  const sketchPointer = (e: PointerEvent, x: number, y: number, erase: boolean): boolean => {
    // The ITCZ with no line of its own yet: grabbing the worked-out path turns it into one.
    if (!erase && o.tool().tool === 'itcz' && !sketches().length) {
      const c = autoItczCtrl();
      if (!c) {
        o.notice('Wait a moment for the climate to be worked out, then drag the ITCZ.');
        return true;
      }
      let idx = -1;
      let bestD = 14;
      for (let i = 0; i < c.length; i += 2) {
        const d = Math.hypot(c[i] - x, c[i + 1] - y) * view.scale;
        if (d < bestD) {
          bestD = d;
          idx = i / 2;
        }
      }
      if (idx < 0) {
        // On the line between two handles: a new point there.
        const p = sketchCourse(c, 0);
        let near = false;
        for (let i = 0; i < p.length - 2 && !near; i += 2) near = segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) < 10;
        if (!near) return false;
        let seg = 0;
        while (seg * 2 + 2 < c.length - 2 && c[seg * 2 + 2] < x) seg++;
        c.splice((seg + 1) * 2, 0, x, y);
        idx = seg + 1;
      }
      const live = o.begin({ ...o.tool().settings, brush: 'itcz', erase: undefined, pts: roundPath(sketchCourse(c, 0)), route: 'points', ctrl: roundPath(c), season: 'shown' });
      sel = live.id;
      dragging = { id: live.id, idx, pointer: e.pointerId };
      o.sketchSelected?.();
      o.notice('Drag it where the belt should be. Tap the line to add a bend.');
      schedule();
      return true;
    }
    // A handle (one of the points) first, then the line itself.
    let best: { id: number; idx: number; d: number } | null = null;
    for (const st of sketches()) {
      const c = st.ctrl!;
      for (let i = 0; i < c.length; i += 2) {
        const d = Math.hypot(c[i] - x, c[i + 1] - y) * view.scale;
        if (d < 14 && (!best || d < best.d)) best = { id: st.id, idx: i / 2, d };
      }
    }
    let line: { id: number; seg: number; d: number } | null = null;
    if (!best) {
      for (const st of sketches()) {
        const c = st.ctrl!;
        const p = st.pts;
        for (let i = 0; i < p.length - 2; i += 2) {
          const d = segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]);
          if (d < 10 && (!line || d < line.d)) {
            // Which pair of points this part of the curve lies between.
            let seg = 0;
            let segBest = Infinity;
            for (let j = 0; j < c.length - 2; j += 2) {
              const dj = segDist(p[i], p[i + 1], c[j], c[j + 1], c[j + 2], c[j + 3]);
              if (dj < segBest) {
                segBest = dj;
                seg = j / 2;
              }
            }
            line = { id: st.id, seg, d };
          }
        }
      }
    }
    const hit = best?.id ?? line?.id ?? null;
    if (erase) {
      if (hit !== null) {
        o.remove(hit);
        if (sel === hit) sel = null;
        o.sketchSelected?.();
        o.notice(`${o.tool().tool === 'wind' ? 'Wind' : o.tool().tool === 'itcz' ? 'ITCZ line' : o.tool().tool === 'divide' ? 'Divide line' : o.tool().tool === 'join' ? 'Join line' : 'Current'} deleted (Undo brings it back).`);
      }
      schedule();
      return true;
    }
    if (best) {
      sel = best.id;
      o.snapshot();
      dragging = { id: best.id, idx: best.idx, pointer: e.pointerId };
    } else if (line) {
      // A tap on the line adds a point there, ready to drag.
      const st = sketches().find((k) => k.id === line!.id)!;
      const c = st.ctrl!.slice();
      c.splice((line.seg + 1) * 2, 0, x, y);
      o.snapshot();
      o.update(withCtrl(st, c));
      sel = st.id;
      dragging = { id: st.id, idx: line.seg + 1, pointer: e.pointerId };
    } else {
      // Empty sea: let the map be dragged, and clear the selection.
      if (sel !== null) {
        sel = null;
        o.sketchSelected?.();
      }
      schedule();
      return false;
    }
    o.sketchSelected?.();
    schedule();
    return true;
  };
  const dragSketch = (x: number, y: number) => {
    if (!dragging) return;
    const st = sketches().find((k) => k.id === dragging!.id);
    if (!st) return;
    const c = st.ctrl!.slice();
    c[dragging.idx * 2] = x;
    c[dragging.idx * 2 + 1] = y;
    o.update(withCtrl(st, c));
    schedule();
  };
  const sketchOps: SketchOps = {
    selected: () => sketches().find((k) => k.id === sel) ?? null,
    setKind(kind) {
      const st = sketchOps.selected();
      if (!st) return;
      o.snapshot();
      o.update({ ...st, current: kind });
      schedule();
    },
    set(patch, undoStep = true) {
      const st = sketchOps.selected();
      if (!st) return;
      if (undoStep) o.snapshot();
      o.update({ ...st, ...patch });
      schedule();
    },
    copyToOtherSeason() {
      const st = sketchOps.selected();
      if (st) copySeason(st);
    },
    setSize(size) {
      const st = sketchOps.selected();
      if (!st) return;
      o.snapshot();
      o.update({ ...st, currentSize: size });
      schedule();
    },
    reverse() {
      const st = sketchOps.selected();
      if (!st) return;
      const c: number[] = [];
      for (let i = st.ctrl!.length - 2; i >= 0; i -= 2) c.push(st.ctrl![i], st.ctrl![i + 1]);
      o.snapshot();
      o.update(withCtrl(st, c));
      schedule();
    },
    remove() {
      if (sel === null) return;
      o.remove(sel);
      sel = null;
      o.sketchSelected?.();
      schedule();
    },
    traceItcz() {
      const ctrl = autoItczCtrl();
      if (!ctrl) return false;
      const live = o.begin({ ...o.tool().settings, brush: 'itcz', erase: undefined, pts: roundPath(sketchCourse(ctrl, 0)), route: 'points', ctrl: roundPath(ctrl), season: 'shown' });
      sel = live.id;
      o.sketchSelected?.();
      o.notice('The ITCZ is now a line you can move: drag its dots, or tap the line to add a bend.');
      schedule();
      return true;
    },
  };

  const startStroke = (e: PointerEvent, x: number, y: number) => {
    const t = o.tool();
    if (o.referenceEditing?.()) return refPointer(e, x, y);
    if (t.tool === 'pan') return false;
    if (t.tool === 'name') {
      namePicked = { x, y };
      o.sketchSelected?.();
      schedule();
      return true;
    }
    if (isSketch(t.tool) && (t.erase || adjustMode(t))) return sketchPointer(e, x, y, t.erase);
    if (t.tool === 'high' && (t.erase || t.sketchMode === 'adjust')) return highPointer(e, x, y, t.erase);
    if (pointsMode(t)) {
      const brush = t.tool as 'river' | 'lava' | SketchBrush;
      if (!routing || routing.brush !== brush) routing = { brush, ctrl: [] };
      // Tapping the last point again finishes (no Enter key needed on a phone).
      const c0 = routing.ctrl;
      if (c0.length >= 4 && Math.hypot(c0[c0.length - 2] - x, c0[c0.length - 1] - y) * view.scale < 16) {
        finishRoute();
        return true;
      }
      // A click close to a river (on screen) lands on it, so tributaries are easy to join.
      let snapped = false;
      if (brush === 'river' && routing.ctrl.length >= 2) {
        let best = 12 / view.scale;
        for (const s of o.world().surface.strokes) {
          if (s.brush !== 'river' || s.erase) continue;
          for (let k = 0; k < s.pts.length; k += 2) {
            const d = Math.hypot(s.pts[k] - x, s.pts[k + 1] - y);
            if (d < best) {
              best = d;
              x = s.pts[k];
              y = s.pts[k + 1];
              snapped = true;
            }
          }
        }
      }
      routing.ctrl.push(x, y);
      // A river ends as soon as a point lands on water (sea, lake or another river).
      if (brush === 'river' && routing.ctrl.length >= 4 && (snapped || onWater(o.world().surface, x, y, opts()))) finishRoute();
      else o.notice(routing.ctrl.length === 2 ? `Now click points along the way. Tap the last point again or press Enter to finish${brush === 'river' ? ' (a river also finishes on water)' : ''}; Backspace takes back a point, Esc cancels.` : `${routing.ctrl.length / 2} points.`);
      schedule();
      return true;
    }
    const st: Omit<Stroke, 'id'> = { ...t.settings, brush: t.tool, erase: t.erase || undefined, pts: [x, y] };
    st.pts = roundPath(st.pts);
    const live = o.begin(st);
    drawing = { stroke: live, pointer: e.pointerId };
    cache.updateStroke(o.world().surface, live, strokeBounds(live));
    schedule();
    if (brushInfo(live.brush).kind === 'point') drawing = null;
    return true;
  };

  /** The part of a growing stroke that can have changed: its last stretch (ends fade), or all of a tapering spur. */
  const changedPart = (st: Stroke): [number, number, number, number] => {
    if (st.taper !== undefined && st.taper !== 1) return strokeBounds(st);
    const p = st.pts;
    let len = 0;
    let k = p.length - 2;
    while (k > 0 && len < st.size * 2) {
      len += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
      k -= 2;
    }
    return strokeBounds({ ...st, pts: p.slice(k) });
  };

  const extendStroke = (x: number, y: number) => {
    if (!drawing) return;
    const st = drawing.stroke;
    const p = st.pts;
    const lx = p[p.length - 2];
    const ly = p[p.length - 1];
    const step = Math.max(st.size * 0.12, 3 / view.scale);
    if (Math.hypot(x - lx, y - ly) < step) return;
    // Paint as you go: the stroke grows in the world, and only the changed part is redrawn.
    const grown: Stroke = { ...st, pts: [...p, ...roundPath([x, y])] };
    drawing.stroke = grown;
    o.update(grown);
    cache.updateStroke(o.world().surface, grown, changedPart(grown));
    schedule();
  };

  const finishStroke = () => {
    const st = drawing?.stroke;
    drawing = null;
    // A drawn river still joins the river it ends on and falls over cliffs.
    if (st && (st.brush === 'river' || st.brush === 'lava') && !st.erase) settleCourse(st);
    schedule();
  };

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = rect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    // Working on the map takes the keyboard away from the panel's fields, so Enter and Esc reach it.
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused !== document.body && focused.closest('input, select, button')) focused.blur();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // Two fingers: take back the stroke just started and pinch instead.
      if (drawing) {
        drawing = null;
        o.cancel();
      }
      panning = true;
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      schedule();
      return;
    }
    const r = rect();
    const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top, r);
    // Measuring: a left click places a point (starting a new path once the last was stopped); a right click stops.
    if (measure && !spaceDown && (e.button === 0 || e.button === 2)) {
      if (e.button === 2) measure.placing = false;
      else if (!measure.placing) measure = { pts: [[x, y]], placing: true };
      else measure.pts.push([x, y]);
      updateMeasure();
      schedule();
      return;
    }
    if (hand && e.button === 0) {
      o.overlay?.()?.pick?.(wrapX(x), y, 1 / view.scale);
      panning = true;
      canvas.classList.add('panning');
      schedule();
      return;
    }
    const ov = o.overlay?.();
    if (ov && e.button === 0 && !spaceDown) {
      if (ov.down?.(wrapX(x), y, 1 / view.scale)) {
        overlayDrag = e.pointerId;
        schedule();
        return;
      }
      if (ov.noPaint) {
        panning = true;
        canvas.classList.add('panning');
        schedule();
        return;
      }
    }
    if (e.button === 1 || e.button === 2 || spaceDown || o.tool().tool === 'pan' || !startStroke(e, x, y)) {
      panning = true;
      canvas.classList.add('panning');
    }
    schedule();
  });

  /** A place on the map itself (wrapped copies fold back onto it). */
  const wrapX = (x: number) => {
    const s = o.world().settings;
    return s.edges === 'wrap' ? ((x % s.widthKm) + s.widthKm) % s.widthKm : x;
  };
  let overlayDrag = -1;
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (overlayDrag === e.pointerId) {
      const r = rect();
      const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top, r);
      overlayDrag = -1;
      o.overlay?.()?.up?.(wrapX(x), y);
      schedule();
    }
    pinch = 0;
    if (drawing && drawing.pointer === e.pointerId) finishStroke();
    if (dragging?.pointer === e.pointerId) dragging = null;
    if (highDrag?.pointer === e.pointerId) highDrag = null;
    if (refDrag?.pointer === e.pointerId) {
      const r = rect();
      const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top, r);
      dragReference(x, y, true);
      refDrag = null;
    }
    if (pointers.size === 0) {
      panning = false;
      canvas.classList.remove('panning');
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', (e) => {
    if (drawing?.pointer === e.pointerId) drawing = null;
    release(e);
    schedule();
  });

  let readoutPending = false;
  canvas.addEventListener('pointermove', (e) => {
    const r = rect();
    const prev = pointers.get(e.pointerId);
    if (prev) {
      if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        // Move with the midpoint, and zoom with the spread.
        view.cx -= (e.clientX - prev.x) / 2 / view.scale;
        view.cy -= (e.clientY - prev.y) / 2 / view.scale;
        if (pinch) zoomAt(d / pinch, mx, my);
        pinch = d;
        schedule();
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (panning) {
        view.cx -= (e.clientX - prev.x) / view.scale;
        view.cy -= (e.clientY - prev.y) / view.scale;
        schedule();
      }
    }
    const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top, r);
    hover = { x, y };
    if (dragging?.pointer === e.pointerId) dragSketch(x, y);
    if (highDrag?.pointer === e.pointerId) dragHigh(x, y);
    if (refDrag?.pointer === e.pointerId) dragReference(x, y, false);
    if (drawing?.pointer === e.pointerId) extendStroke(x, y);
    if (overlayDrag === e.pointerId) o.overlay?.()?.drag?.(wrapX(x), y);
    schedule();
    if (!readoutPending) {
      readoutPending = true;
      requestAnimationFrame(() => {
        readoutPending = false;
        if (hover) o.hover?.(describe(hover.x, hover.y));
      });
    }
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    o.hover?.(null);
    schedule();
  });

  const describe = (x: number, y: number): InfoItem[] => {
    const w = o.world();
    const s = w.settings;
    if (y < 0 || y > s.heightKm || (s.edges === 'void' && (x < 0 || x > s.widthKm))) return [{ label: 'Place', value: 'Off the map' }];
    const xw = ((x % s.widthKm) + s.widthKm) % s.widthKm;
    const p = surfaceAt(w.surface, xw, y, { seed: s.seed, wrapKm: s.edges === 'wrap' ? s.widthKm : 0 });
    const items: InfoItem[] = [];
    const add = (label: string, value: string) => {
      const had = items.find((i) => i.label === label);
      if (had) had.value += `; ${value}`;
      else items.push({ label, value });
    };
    items.push({ label: 'Latitude', value: formatLatitude(latitudeAt(s, y)) }, { label: 'From the west edge', value: formatDistance(xw) });
    // What lives and happens here (the peoples of the simulation) first.
    for (const i of o.overlay?.()?.describe?.(xw, y) ?? []) add(i.label, i.value);
    // Where it is: the landmass, region or water, with their names.
    const cl = o.climate();
    const geo = cl?.geo;
    if (cl && geo) {
      const k = geoCell(cl, xw, y);
      if (k >= 0) {
        const names = geoNames(w.surface, cl);
        const named = (kind: string, name?: string) => (name ? `${name} (${kind.toLowerCase()})` : kind);
        const where: string[] = [];
        if (p.ground === 'land') {
          if (geo.region[k] >= 0) where.push(named(geo.regions[geo.region[k]]?.kind ?? 'Region', names.region.get(geo.region[k])));
          if (geo.land[k] >= 0) {
            const a = geo.archipelagoOf.get(geo.land[k]);
            if (a !== undefined) where.push(named('Islands', names.archipelago.get(a)));
            where.push(named(geo.landmasses.find((f) => f.id === geo.land[k])?.kind ?? 'Land', names.land.get(geo.land[k])));
          }
        } else if (geo.water[k] >= 0) where.push(named(geo.waters.find((f) => f.id === geo.water[k])?.kind ?? 'Sea', names.water.get(geo.water[k])));
        if (where.length) add('Place', where.join(', '));
      }
    }
    add('Ground', p.ground === 'land' ? 'Land' : p.ground === 'shallow' ? 'Shallow sea' : 'Deep sea');
    if (p.ground === 'land') {
      if (p.zone) add('Terrain', ZONES[p.zone - 1].name);
      if (p.plateau) add('Terrain', 'Plateau');
      if (p.volcanic) add('Terrain', 'Volcanic');
      if (p.ramp) add('Terrain', 'Ramp');
      if (p.blocksTravel) add('Hazard', p.cliff ? 'Cliff (blocks travel)' : 'Canyon or ravine (blocks travel)');
      const cover = Object.entries(p.cover).sort((a, b) => b[1] - a[1])[0];
      if (cover) add('Ground cover', brushInfo(cover[0] as BrushId).name);
      if (p.water === 'river') {
        const ft = p.riverWidth * 3280.84;
        const rv = riverAt(w.surface, xw, y, 5);
        const nm = rv ? geoNames(w.surface, cl).river.get(rv.id) : undefined;
        add('Water', `${nm ? `${nm} (river)` : 'River'}, ${ft < 5280 ? `${Math.round(ft / 10) * 10} ft (${Math.round(p.riverWidth * 1000)} m)` : formatDistance(p.riverWidth)} wide`);
      }
      if (p.water === 'lake') {
        const id = lakeAt(w.surface, xw, y, 1 / view.scale + 3);
        const nm = id >= 0 ? geoNames(w.surface, cl).lake.get(id) : undefined;
        add('Water', nm ? `${nm} (lake)` : 'Lake');
      }
      if (p.waterfall) add('Water', 'Waterfall');
      if (p.wet > 0.4 && !p.water) add('Water', 'Well watered');
    }
    if (p.whirlpool) add('Hazard', p.whirlpool.dangerous ? 'Whirlpool (dangerous)' : 'Whirlpool');
    if (cl) {
      const c = climateAt(cl, xw, y);
      const f = (t: number) => `${Math.round(cToF(t))}°F`;
      if (p.ground === 'land') {
        if (c.zone >= 0) add('Climate zone', ZONE_INFO[c.zone].name);
        const auto = Object.keys(p.cover).length ? null : autoCoverName(cl, nearestPoint(cl, xw, y));
        if (auto) add('Ground cover', auto);
        add('Summer', `${f(c.summerT)}, ${RAIN_NAMES[rainClass(c.summerRain)]}`);
        add('Winter', `${f(c.winterT)}, ${RAIN_NAMES[rainClass(c.winterRain)]}`);
      } else {
        add('Sea', `${f(c.winterT)} to ${f(c.summerT)}`);
        const k = nearestPoint(cl, xw, y);
        if (cl.summer.ice[k] || cl.winter.ice[k]) add('Sea ice', cl.summer.ice[k] ? 'All year' : 'In winter');
        if (p.ground === 'shallow' && (p.reefPaint === 1 || (cl.reef[k] && p.reefPaint !== 2))) add('Hazard', 'Reef (hazard to ships)');
        if (Math.max(cl.summer.upwell[k], cl.winter.upwell[k]) > 0.3) add('Fishing', 'Upwelling: rich fishing');
      }
    }
    return items;
  };

  const keydown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // Enter and Esc finish or cancel a course being placed, even from one of the panel's fields.
    const courseKey = routing && (e.key === 'Enter' || e.key === 'Escape') && !target.closest('textarea, dialog');
    if (!courseKey && target.closest('input, textarea, select, dialog')) return;
    if (e.code === 'Space') {
      spaceDown = true;
      e.preventDefault();
    }
    if (measure && e.key === 'Escape' && !routing) {
      measure = { pts: [], placing: true };
      updateMeasure();
      schedule();
    }
    if (routing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishRoute();
      } else if (e.key === 'Escape') {
        routing = null;
        o.notice('Cancelled.');
        schedule();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        routing.ctrl.splice(-2, 2);
        if (!routing.ctrl.length) routing = null;
        schedule();
      }
    }
  };
  const keyup = (e: KeyboardEvent) => {
    if (e.code === 'Space') spaceDown = false;
  };
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);

  const resize = new ResizeObserver(() => draw());
  resize.observe(canvas);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', schedule);

  const el = h(
    'div',
    { class: 'stage' },
    canvas,
    h('div', { class: 'stage-controls' }, busy, cancelBtn, finishBtn, handBtn, measureBtn, h('button', { type: 'button', class: 'ghost', onclick: fit }, 'Fit')),
    measureBox,
  );
  requestAnimationFrame(fit);

  return {
    el,
    redraw: schedule,
    fit,
    surfaceChanged(bounds) {
      cache.setSurface(o.world().surface, bounds);
      schedule();
    },
    sketch: sketchOps,
    high: highOps,
    namePick: () => namePicked,
    pxKm: () => 1 / view.scale,
    climateChanged() {
      cache.setClimate(o.climate());
      schedule();
    },
    worldReset() {
      cache.reset(info(), o.world().surface);
      schedule();
    },
    dispose() {
      cache.dispose();
      resize.disconnect();
      scheme.removeEventListener('change', schedule);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      cancelAnimationFrame(frame);
    },
  };
}
