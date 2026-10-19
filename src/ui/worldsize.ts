import { centreLatitude, kmPerDegree, planetAreaKm2, planetRadiusKm, placeAtLatitude, southLatitude, type WorldSettings } from '../core/settings';
import { EARTH_RADIUS_KM, formatLatitude, kmToMiles } from '../core/units';
import { h } from './dom';

/** Real planets to compare with (mean radius, km). */
const PLANETS = [
  { name: 'Moon', r: 1737 },
  { name: 'Mercury', r: 2440 },
  { name: 'Mars', r: 3390 },
  { name: 'Venus', r: 6052 },
  { name: 'Earth', r: EARTH_RADIUS_KM },
  { name: 'Neptune', r: 24622 },
  { name: 'Saturn', r: 58232 },
  { name: 'Jupiter', r: 69911 },
];
const area = (r: number) => 4 * Math.PI * r * r;
const EARTH_AREA = area(EARTH_RADIUS_KM);
const LOG0 = Math.log10(2e5);
const LOG1 = Math.log10(area(69911) * 1.2);
const pos = (a: number) => Math.max(0, Math.min(100, ((Math.log10(Math.max(1, a)) - LOG0) / (LOG1 - LOG0)) * 100));

const times = (v: number) => (v >= 10 ? Math.round(v).toLocaleString('en-US') : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toExponential(1));
const sqmi = (km2: number) => {
  const mi2 = km2 * 0.386102;
  return mi2 >= 1e6 ? `${(mi2 / 1e6).toFixed(mi2 >= 1e8 ? 0 : 2)} million sq mi` : `${Math.round(mi2).toLocaleString('en-US')} sq mi`;
};

/**
 * A size meter: the map's area on a scale of real planets' surfaces (log scale), how many times
 * Earth's surface it is, and how big its planet is (the planet grows past Earth's size to fit a
 * bigger map, and its degrees grow with it).
 */
export function sizeMeter(): { el: HTMLElement; update(s: WorldSettings, before?: WorldSettings): void } {
  const bar = h('div', { class: 'size-bar' });
  const text = h('p', { class: 'small size-text' });
  const planet = h('p', { class: 'muted small' });
  const el = h('div', { class: 'size-meter', role: 'group', 'aria-label': 'Map size compared with planets' }, bar, text, planet);
  return {
    el,
    update(s, before) {
      const mapArea = s.widthKm * s.heightKm;
      const ticks = PLANETS.map((p) => h('span', { class: 'size-tick', style: `left:${pos(area(p.r))}%`, title: `${p.name}: ${sqmi(area(p.r))}` }, h('i', {}), h('b', {}, p.name)));
      const marks: HTMLElement[] = [];
      if (before) marks.push(h('span', { class: 'size-mark before', style: `left:${pos(before.widthKm * before.heightKm)}%`, title: 'Now' }));
      marks.push(h('span', { class: 'size-mark', style: `left:${pos(mapArea)}%`, title: 'This map' }));
      const pa = planetAreaKm2(s);
      const own = Math.abs(pa - EARTH_AREA) > 1 ? [h('span', { class: 'size-planet', style: `left:${pos(pa)}%`, title: 'Its planet' })] : [];
      bar.replaceChildren(h('div', { class: 'size-track' }), ...ticks, ...own, ...marks);
      const ratio = mapArea / EARTH_AREA;
      const nearest = PLANETS.reduce((a, b) => (Math.abs(Math.log(area(b.r) / mapArea)) < Math.abs(Math.log(area(a.r) / mapArea)) ? b : a));
      text.textContent = `This map: ${sqmi(mapArea)}, ${times(ratio)}× Earth's surface (${(ratio * 100 < 0.1 ? (ratio * 100).toFixed(3) : (ratio * 100).toFixed(1))}%). Closest planet surface: ${nearest.name}.`;
      const r = planetRadiusKm(s);
      const k = kmPerDegree(s);
      const deg = `1° of latitude = ${Math.round(kmToMiles(k))} mi (${Math.round(k)} km)`;
      planet.textContent =
        s.useRadius || s.mapType === 'globe'
          ? `Its planet: ${(r / EARTH_RADIUS_KM).toFixed(2)}× Earth's radius (set by you). ${deg}.`
          : r > EARTH_RADIUS_KM + 1
            ? `Its planet has grown to fit the map: ${(r / EARTH_RADIUS_KM).toFixed(2)}× Earth's radius, ${times((r / EARTH_RADIUS_KM) ** 2)}× its surface. ${deg}.`
            : `Its planet: Earth-sized. ${deg}. Past Earth's size the planet grows with the map.`;
    },
  };
}

/**
 * Where the map sits on its world: the whole world as a flat strip (180° tall, 360° around), with
 * the map drawn on it. Drag the map to move it; `changed` gets the new centre latitude and longitude.
 */
export function worldLocator(changed: (lat: number, lon: number) => void): { el: HTMLElement; update(s: WorldSettings): void } {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-180 -90 360 180');
  svg.setAttribute('class', 'locator');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Where the map sits on its world. Drag the map to move it.');
  const el = h('div', { class: 'locator-wrap' });
  el.append(svg);
  const label = h('p', { class: 'muted small' });
  el.append(label);
  const mk = (tag: string, attrs: Record<string, string | number>) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  let cur: WorldSettings | null = null;
  const rect = mk('rect', { class: 'locator-map', rx: 1.5 });
  const draw = () => {
    if (!cur) return;
    const s = cur;
    svg.replaceChildren();
    svg.append(mk('rect', { x: -180, y: -90, width: 360, height: 180, class: 'locator-world' }));
    for (let la = -60; la <= 60; la += 30) svg.append(mk('line', { x1: -180, x2: 180, y1: -la, y2: -la, class: la ? 'locator-grid' : 'locator-eq' }));
    for (let lo = -120; lo <= 120; lo += 60) svg.append(mk('line', { y1: -90, y2: 90, x1: lo, x2: lo, class: 'locator-grid' }));
    const t = s.axialTilt;
    if (t > 0 && t < 90) for (const la of [t, -t]) svg.append(mk('line', { x1: -180, x2: 180, y1: -la, y2: -la, class: 'locator-tropic' }));
    const k = kmPerDegree(s);
    const wDeg = Math.min(360, s.widthKm / k);
    const hDeg = Math.min(180, s.heightKm / k);
    const x = s.centreLongitude - wDeg / 2;
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(-s.northLatitude));
    rect.setAttribute('width', String(wDeg));
    rect.setAttribute('height', String(hDeg));
    svg.append(rect);
    // The part that runs past 180° shows on the other side.
    if (x < -180 || x + wDeg > 180) {
      const r2 = rect.cloneNode() as SVGElement;
      r2.setAttribute('x', String(x < -180 ? x + 360 : x - 360));
      svg.append(r2);
    }
    label.textContent = `Middle of the map: ${formatLatitude(centreLatitude(s))}, ${Math.abs(Math.round(s.centreLongitude))}°${s.centreLongitude > 0.5 ? 'E' : s.centreLongitude < -0.5 ? 'W' : ''}. From ${formatLatitude(s.northLatitude)} to ${formatLatitude(southLatitude(s))}. Drag the map to move it.`;
  };
  let drag: { x: number; y: number; lat: number; lon: number } | null = null;
  const toDeg = (e: PointerEvent): [number, number] => {
    const b = svg.getBoundingClientRect();
    return [((e.clientX - b.left) / b.width) * 360 - 180, ((e.clientY - b.top) / b.height) * 180 - 90];
  };
  svg.addEventListener('pointerdown', (e) => {
    if (!cur) return;
    svg.setPointerCapture(e.pointerId);
    const [x, y] = toDeg(e);
    // Clicking off the map jumps it there; dragging moves it.
    let lat = centreLatitude(cur);
    let lon = cur.centreLongitude;
    if (e.target !== rect) {
      lat = -y;
      lon = x;
      move(lat, lon);
    }
    drag = { x, y, lat: centreLatitude(cur), lon: cur.centreLongitude };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toDeg(e);
    move(drag.lat - (y - drag.y), drag.lon + (x - drag.x));
  });
  const end = () => (drag = null);
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  const move = (lat: number, lon: number) => {
    if (!cur) return;
    const north = placeAtLatitude(cur, lat);
    const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
    cur = { ...cur, northLatitude: north, centreLongitude: wrapped };
    draw();
    changed(centreLatitude(cur), wrapped);
  };
  return {
    el,
    update(s) {
      cur = s;
      draw();
    },
  };
}
