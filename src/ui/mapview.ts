import { brushInfo, roundPath, strokeBounds, ZONES, type BrushId, type Stroke } from '../core/paint';
import { latitudeAt, southLatitude } from '../core/settings';
import { surfaceAt } from '../core/terrain';
import { finishCourse, onWater } from '../core/water';
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
  /** Start a stroke: it joins the world at once and gets its id. */
  begin(stroke: Omit<Stroke, 'id'>): Stroke;
  /** The stroke being painted grew. */
  update(stroke: Stroke): void;
  /** Take back the stroke just started (a second finger turned it into a pinch). */
  cancel(): void;
  /** A short message for the person (for example, why a spur did not start). */
  notice(text: string): void;
}

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
    if (look.grid) drawLatitudes(g, r, x0, x1, y0);
    drawBorder(g, x0, y0, x1, y1, s.edges === 'wrap');
    drawRoute(g, r);
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

  /** Point mode: the points clicked so far, joined by dashes, and the next leg to the cursor. */
  function drawRoute(g: CanvasRenderingContext2D, r: DOMRect) {
    if (!routing) return;
    const c = routing.ctrl;
    const pts: number[] = [];
    for (let k = 0; k < c.length; k += 2) pts.push(...toScreen(c[k], c[k + 1], r));
    g.save();
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.strokeStyle = routing.brush === 'lava' ? '#ff7a26' : '#bfe6ff';
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
      g.strokeStyle = routing.brush === 'lava' ? '#ff7a26' : '#bfe6ff';
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

  // Point mode for rivers and lava: the points clicked so far.
  let routing: { brush: 'river' | 'lava'; ctrl: number[] } | null = null;
  const pointsMode = (t: ToolState) => (t.tool === 'river' || t.tool === 'lava') && t.settings.route === 'points' && !t.erase;
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
    o.notice(brush === 'river' ? 'Finding the river’s course…' : 'Finding the lava’s course…');
    schedule();
    // Let the notice show before the work starts.
    setTimeout(() => {
      const live = o.begin({ ...t.settings, brush, erase: undefined, pts: roundPath(ctrl.slice(0, 4)), route: 'points', ctrl: roundPath(ctrl) });
      settleCourse(live);
    }, 30);
  };

  const startStroke = (e: PointerEvent, x: number, y: number) => {
    const t = o.tool();
    if (t.tool === 'pan') return false;
    if (pointsMode(t)) {
      const brush = t.tool as 'river' | 'lava';
      if (!routing || routing.brush !== brush) routing = { brush, ctrl: [] };
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
      else o.notice(routing.ctrl.length === 2 ? 'Now click points along the way. Press Enter to finish (a river also finishes on water), Backspace to take back a point, Esc to cancel.' : `${routing.ctrl.length / 2} points.`);
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
      if (p.blocksTravel) parts.push(p.cliff ? 'Cliff (blocks travel)' : 'Canyon or ravine (blocks travel)');
      const cover = Object.entries(p.cover).sort((a, b) => b[1] - a[1])[0];
      if (cover) parts.push(brushInfo(cover[0] as BrushId).name);
      if (p.water === 'river') {
        const ft = p.riverWidth * 3280.84;
        parts.push(`River, ${ft < 5280 ? `${Math.round(ft / 10) * 10} ft (${Math.round(p.riverWidth * 1000)} m)` : formatDistance(p.riverWidth)} wide`);
      }
      if (p.water === 'lake') parts.push('Lake');
      if (p.waterfall) parts.push('Waterfall');
      if (p.wet > 0.4 && !p.water) parts.push('Well watered');
      if (p.volcanic) parts.push('Volcanic');
      if (p.ramp) parts.push('Ramp');
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
    if (routing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishRoute();
      } else if (e.key === 'Escape') {
        routing = null;
        o.notice('River cancelled.');
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
