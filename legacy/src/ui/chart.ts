export interface Series {
  name: string;
  color: string;
  points: [number, number][];
}

const NS = 'http://www.w3.org/2000/svg';

/** A round tick step giving about four intervals up to `v`. */
function niceStep(v: number): number {
  if (v <= 0) return 1;
  const raw = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${Math.round(n)}`;

/**
 * Multi-series line chart on one shared y-scale, with a legend, a direct label on each
 * line's endpoint (up to 4 series), a faint grid, and a crosshair tooltip on hover.
 */
export function lineChart(host: HTMLElement, title: string, series: Series[], unit = ''): void {
  host.innerHTML = '';
  const fig = document.createElement('figure');
  fig.className = 'chart';
  const cap = document.createElement('figcaption');
  cap.textContent = title;
  fig.append(cap);
  const visible = series.filter((s) => s.points.length > 1);
  if (!visible.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Run the simulation to collect history.';
    fig.append(p);
    host.append(fig);
    return;
  }
  const W = 360;
  const H = 180;
  const m = { l: 40, r: visible.length <= 4 ? 64 : 12, t: 10, b: 22 };
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMax = 0;
  for (const s of visible) for (const [x, y] of s.points) {
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  }
  if (xMax === xMin) xMax = xMin + 1;
  const step = niceStep(yMax);
  const ticks = Math.max(1, Math.ceil(yMax / step));
  yMax = step * ticks;
  const X = (x: number) => m.l + ((x - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const Y = (y: number) => H - m.b - (y / yMax) * (H - m.t - m.b);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  for (let k = 0; k <= ticks; k++) {
    const v = step * k;
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: k === 0 ? 'axis' : 'grid' });
    el('text', { x: m.l - 6, y: Y(v), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, compact(v));
  }
  for (let k = 0; k <= 4; k++) {
    const v = xMin + ((xMax - xMin) / 4) * k;
    el('text', { x: X(v), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, `${Math.round(v)}`);
  }
  for (const s of visible) {
    const d = s.points.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('');
    el('path', { d, fill: 'none', style: `stroke:${s.color}`, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    const [lx, ly] = s.points[s.points.length - 1];
    el('circle', { cx: X(lx), cy: Y(ly), r: 3, style: `fill:${s.color};stroke:var(--surface)`, 'stroke-width': 1.5 });
  }
  // Direct labels, nudged apart so they never collide.
  if (visible.length <= 4) {
    const labels = visible.map((s) => ({ s, y: Y(s.points[s.points.length - 1][1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 11);
    for (const { s, y } of labels) el('text', { x: W - m.r + 6, y, class: 'dlabel', 'dominant-baseline': 'middle' }, s.name);
  }
  const cross = el('line', { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' });
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.append(svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  wrap.append(tip);
  fig.append(wrap);

  const legend = document.createElement('ul');
  legend.className = 'legend';
  for (const s of visible) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = s.color;
    li.append(sw, document.createTextNode(s.name));
    legend.append(li);
  }
  fig.append(legend);
  host.append(fig);

  const move = (ev: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    const xv = xMin + ((sx - m.l) / (W - m.l - m.r)) * (xMax - xMin);
    const pts = visible[0].points;
    let best = pts[0][0];
    for (const [x] of pts) if (Math.abs(x - xv) < Math.abs(best - xv)) best = x;
    cross.setAttribute('x1', String(X(best)));
    cross.setAttribute('x2', String(X(best)));
    cross.setAttribute('visibility', 'visible');
    const rows = visible
      .map((s) => ({ s, v: s.points.find(([x]) => x === best)?.[1] }))
      .filter((r) => r.v !== undefined)
      .sort((a, b) => b.v! - a.v!);
    tip.innerHTML = `<strong>Year ${best}</strong>` + rows.map(({ s, v }) => `<div><span class="swatch" style="background:${s.color}"></span>${s.name}<b>${compact(v!)}${unit}</b></div>`).join('');
    tip.hidden = false;
    const px = ((X(best) / W) * r.width);
    tip.style.left = `${Math.min(r.width - 170, Math.max(0, px + 10))}px`;
  };
  hit.addEventListener('pointermove', move as EventListener);
  hit.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  });
}
