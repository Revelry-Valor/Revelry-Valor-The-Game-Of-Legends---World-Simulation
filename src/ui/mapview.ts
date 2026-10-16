import { brushInfo, roundPath, snapSpur, strokeBounds, ZONES, type BrushId, type Stroke } from '../core/paint';
import { latitudeAt, southLatitude } from '../core/settings';
import { surfaceAt } from '../core/terrain';
import { formatDistance, formatLatitude, KM_PER_DEGREE, kmToMiles, milesToKm } from '../core/units';
import type { World } from '../core/world';
import { MapCache, type MapLook } from '../render/mapcache';
import { h } from './dom';

/** Brush settings without a path: what the tool panel edits. */
export type BrushSettings = Omit<Stroke, 'id' | 'pts'>;

export interface ToolState {
  /** The selected brush, or 'pan' to move the map. */
  tool: BrushId | 'pan';
  erase: boolean;
  settings: BrushSettings;
}

export interface MapViewOptions {
  world(): World;
  tool(): ToolState;
  look(): MapLook & { grid: boolean };
  /** A finished stroke (without an id). */
  commit(stroke: Omit<Stroke, 'id'>): void;
  /** A short message for the person (for example, why a spur did not start). */
  notice(text: string): void;
}

const PREVIEW: Partial<Record<BrushId, string>> = {
  land: '#6f8f45',
  shallow: '#3aa3b5',
  deep: '#163f66',
  mountains: '#8a7c68',
  hills: '#7d8f4c',
  plateau: '#a08a64',
  cliffs: '#4a4038',
  canyon: '#9b5634',
  ravine: '#2b2019',
  forest: '#2c4a22',
  jungle: '#1c4a1a',
  grassland: '#8c9b4e',
  tundra: '#8a8a72',
  marsh: '#4d5b37',
  dunes: '#dcb878',
  badlands: '#b06842',
  saltflats: '#ece6d6',
  glacier: '#e6eff5',
  beach: '#dcc99d',
  zone: '#d68b37',
};

export interface MapView {
  el: HTMLElement;
  redraw(): void;
  fit(): void;
  /** The strokes changed inside these bounds (km); null for everywhere. */
  surfaceChanged(bounds: [number, number, number, number] | null): void;
  /** The map's size or position changed (canvas options). */
  worldReset(): void;
  dispose(): void;
}

export function createMapView(o: MapViewOptions): MapView {
  const canvas = h('canvas', { class: 'map', 'aria-label': 'World map. Drag to paint with the selected brush.' });
  const readout = h('div', { class: 'readout small', 'aria-live': 'off' }, 'Move over the map to see what is there.');
  const busy = h('div', { class: 'busy small', hidden: true }, 'Drawing…');
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

  // The stroke being drawn, and where the brush is.
  let drawing: { stroke: Omit<Stroke, 'id'>; pointer: number } | null = null;
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
    if (look.grid) drawLatitudes(g, r, x0, x1, y0);
    drawBorder(g, x0, y0, x1, y1, s.edges === 'wrap');
    if (drawing) drawStroke(g, r, drawing.stroke);
    drawCursor(g, r);
    drawScale(g, r);
    busy.hidden = !cache.busy;
  }

  function drawLatitudes(g: CanvasRenderingContext2D, r: DOMRect, x0: number, x1: number, y0: number) {
    const s = o.world().settings;
    const pxPerDeg = KM_PER_DEGREE * view.scale;
    const step = pxPerDeg > 40 ? 1 : pxPerDeg > 8 ? 5 : 10;
    const north = s.northLatitude;
    const south = southLatitude(s);
    const yAt = (lat: number) => toScreen(0, (north - lat) * KM_PER_DEGREE, r)[1];
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
      g.fillText(formatLatitude(lat), Math.max(x0, 0) + 6, y - 7 < y0 + 8 ? y + 9 : y - 7);
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

  function drawStroke(g: CanvasRenderingContext2D, r: DOMRect, st: Omit<Stroke, 'id'>) {
    const p = st.pts;
    g.save();
    g.globalAlpha = st.erase ? 0.35 : 0.5;
    g.strokeStyle = st.erase ? '#ffffff' : PREVIEW[st.brush] ?? '#ffffff';
    g.fillStyle = g.strokeStyle;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const n = p.length / 2;
    if (st.taper !== undefined && st.taper !== 1 && n > 1) {
      // Tapering spur: draw each segment narrower than the last.
      for (let k = 0; k < n - 1; k++) {
        const [ax, ay] = toScreen(p[2 * k], p[2 * k + 1], r);
        const [bx, by] = toScreen(p[2 * k + 2], p[2 * k + 3], r);
        g.lineWidth = Math.max(1, st.size * view.scale * (1 + (st.taper - 1) * (k / (n - 1))));
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    } else {
      g.lineWidth = Math.max(1, st.size * view.scale);
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const [sx, sy] = toScreen(p[2 * k], p[2 * k + 1], r);
        if (k === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      if (n === 1) g.lineTo(toScreen(p[0], p[1], r)[0] + 0.01, toScreen(p[0], p[1], r)[1]);
      g.stroke();
    }
    if (st.brush === 'cliffs' && n > 1) {
      // Ticks on the high side, like an escarpment symbol.
      g.globalAlpha = 0.9;
      g.strokeStyle = '#2a1f17';
      g.lineWidth = 1.5;
      const side = st.side ?? 1;
      for (let k = 0; k < n - 1; k++) {
        const [ax, ay] = toScreen(p[2 * k], p[2 * k + 1], r);
        const [bx, by] = toScreen(p[2 * k + 2], p[2 * k + 3], r);
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / len) * side;
        const ny = ((bx - ax) / len) * side;
        g.beginPath();
        g.moveTo((ax + bx) / 2, (ay + by) / 2);
        g.lineTo((ax + bx) / 2 + nx * 8, (ay + by) / 2 + ny * 8);
        g.stroke();
      }
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

  function drawScale(g: CanvasRenderingContext2D, r: DOMRect) {
    const miles = kmToMiles(140 / view.scale);
    const p = 10 ** Math.floor(Math.log10(miles));
    const nice = [1, 2, 5, 10].map((m) => m * p).filter((m) => m <= miles).pop() ?? p;
    const len = milesToKm(nice) * view.scale;
    const x = 16;
    const y = r.height - 22;
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

  const startStroke = (e: PointerEvent, x: number, y: number) => {
    const t = o.tool();
    if (t.tool === 'pan') return false;
    const st: Omit<Stroke, 'id'> = { ...t.settings, brush: t.tool, erase: t.erase || undefined, pts: [x, y] };
    if (st.brush === 'mountains' && st.mode === 'spur' && !st.erase) {
      const snap = snapSpur(o.world().surface, x, y);
      if (snap) {
        st.pts = [snap.x, snap.y];
        st.size = snap.size;
        st.taper = 0.25;
      } else {
        o.notice('Start a spur on an existing range; this one is drawn as a new range.');
        st.mode = 'range';
      }
    }
    drawing = { stroke: st, pointer: e.pointerId };
    return true;
  };

  const extendStroke = (x: number, y: number) => {
    if (!drawing) return;
    const st = drawing.stroke;
    if (brushInfo(st.brush).kind === 'point') return;
    const p = st.pts;
    const lx = p[p.length - 2];
    const ly = p[p.length - 1];
    const step = Math.max(st.size * 0.15, 3 / view.scale);
    if (Math.hypot(x - lx, y - ly) >= step) {
      p.push(x, y);
      schedule();
    }
  };

  const finishStroke = () => {
    if (!drawing) return;
    const st = drawing.stroke;
    drawing = null;
    st.pts = roundPath(st.pts);
    o.commit(st);
    cache.setSurface(o.world().surface, strokeBounds(st as Stroke));
    schedule();
  };

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = rect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // Two fingers: cancel any stroke and pinch instead.
      drawing = null;
      panning = true;
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      schedule();
      return;
    }
    const r = rect();
    const [x, y] = toWorld(e.clientX - r.left, e.clientY - r.top, r);
    if (e.button === 1 || e.button === 2 || spaceDown || o.tool().tool === 'pan' || !startStroke(e, x, y)) {
      panning = true;
      canvas.classList.add('panning');
    }
    schedule();
  });

  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (drawing && drawing.pointer === e.pointerId) finishStroke();
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
    if (drawing?.pointer === e.pointerId) extendStroke(x, y);
    schedule();
    if (!readoutPending) {
      readoutPending = true;
      requestAnimationFrame(() => {
        readoutPending = false;
        if (hover) readout.textContent = describe(hover.x, hover.y);
      });
    }
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    readout.textContent = 'Move over the map to see what is there.';
    schedule();
  });

  const describe = (x: number, y: number): string => {
    const w = o.world();
    const s = w.settings;
    if (y < 0 || y > s.heightKm || (s.edges === 'void' && (x < 0 || x > s.widthKm))) return 'Off the map';
    const xw = ((x % s.widthKm) + s.widthKm) % s.widthKm;
    const p = surfaceAt(w.surface, xw, y, { seed: s.seed, wrapKm: s.edges === 'wrap' ? s.widthKm : 0 });
    const parts: string[] = [p.ground === 'land' ? 'Land' : p.ground === 'shallow' ? 'Shallow sea' : 'Deep sea'];
    if (p.ground === 'land') {
      if (p.zone) parts.push(ZONES[p.zone - 1].name);
      if (p.plateau) parts.push('Plateau');
      if (p.blocksTravel) parts.push('Canyon or ravine (blocks travel)');
      const cover = Object.entries(p.cover).sort((a, b) => b[1] - a[1])[0];
      if (cover) parts.push(brushInfo(cover[0] as BrushId).name);
    }
    if (p.whirlpool) parts.push(p.whirlpool.dangerous ? 'Whirlpool (dangerous)' : 'Whirlpool');
    return `${formatLatitude(latitudeAt(s, y))} · ${formatDistance(xw)} from the west edge · ${parts.join(' · ')}`;
  };

  const keydown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, dialog')) return;
    if (e.code === 'Space') {
      spaceDown = true;
      e.preventDefault();
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
    h('div', { class: 'stage-controls' }, busy, h('button', { type: 'button', class: 'ghost', onclick: fit }, 'Fit')),
    readout,
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
