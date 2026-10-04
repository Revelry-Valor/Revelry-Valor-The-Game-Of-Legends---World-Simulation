import './styles.css';
import { chronicleMarkdown, describeValues, fmt, polityEra, settlementTier, worldSnapshot } from '../engine/chronicle';
import { MONTHS, seasonOf } from '../engine/calendar';
import { BUILDINGS, LAND_USE_COLORS, LAND_USE_NAMES, TIERS } from '../engine/data/settlements';
import { comfort } from '../engine/systems/development';
import { ringRadius } from '../engine/systems/land';
import { MAP_SIZES, defaultConfig } from '../engine/config';
import { BIOMES } from '../engine/data/biomes';
import { GOOD_NAMES, JOBS, RES_COUNT, RES_NAMES, Res, SECTOR_KEYS } from '../engine/data/economy';
import { DEFAULT_RACES } from '../engine/data/races';
import { ERA_NAMES, TECHS, TECH_BY_ID } from '../engine/data/techs';
import type { Band, EventKind, HistoryEvent, RaceDef, Settlement, WorldConfig } from '../engine/types';
import { VALUE_KEYS } from '../engine/types';
import { World } from '../engine/world';
import { lineChart, compact } from './chart';
import { renderMarket } from './market';
import { mountNationCharts, renderNation } from './nation';
import { ROAD_NAMES } from '../engine/systems/roads';
import { pactsBetween, sameConfederation } from '../engine/systems/diplomacy';
import { CARAVAN_COLOR, MapRenderer, type MapLayer, type ViewState } from './render';
import { mountTechTree, techDetail } from './techtree';
import { TRAITS, TRAIT_BY_ID } from '../engine/data/traits';
import { BRUSHES, type BrushTool } from '../engine/editor';
import { WorldEditor, type EditorView } from './worldeditor';

type Tab = 'inspect' | 'market' | 'realms' | 'peoples' | 'chronicle' | 'charts' | 'setup';

const CARAVAN_KIND: Record<string, string> = { merchant: 'Merchant caravan', family: 'Trading family', nomad: 'Nomad caravan tribe', convoy: 'State convoy' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem('rv:' + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem('rv:' + k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

// ------------------------------------------------------------------ state

let cfg: WorldConfig = loadConfig();
let world = new World(cfg);
let renderer = newRenderer();
let tab: Tab = (store.get('tab') as Tab) || 'inspect';
let playing = false;
let speed = 10;
/** Real time: the world advances month by month and armies and caravans glide between positions. */
/** Real time (month by month, with everything moving) is the default; the year buttons still skip ahead. */
let realTime = true;
let monthAcc = 0;
let pendingYears = 0;
let yearAcc = 0;
let lastFrame = performance.now();
let lastPanel = 0;
let selectedCulture = -1;
/** Settlement whose market is shown (-1 for the world overview). */
let marketFor = -1;
/** Until the user pans or zooms, keep the whole map fitted to the pane. */
let autoFit = true;
const chronicleFilter = { importance: 2, kind: 'all', text: '' };
/** Full-screen views over the map: a nation dossier or the tech tree. */
let overlay: 'nation' | 'tech' | null = null;
let overlayPolity = -1;
let selectedTech: string | null = null;
let lastOverlay = 0;
/** The world editor, while the land is being shaped (the simulation waits). */
let editing: WorldEditor | null = null;
let spaceHeld = false;

const view: ViewState = {
  layer: 'political',
  style: store.get('style') === 'parchment' ? 'parchment' : 'satellite',
  resource: Res.Iron,
  showRoutes: true,
  showLabels: true,
  showRuins: true,
  showCaravans: true,
  showArmies: true,
  showRoads: true,
  frac: 1,
  zoom: 4,
  ox: 0,
  oy: 0,
  selectedSettlement: -1,
  selectedPolity: -1,
  selectedTile: -1,
};

function newRenderer(): MapRenderer {
  const r = new MapRenderer(world);
  r.onDetail = () => drawMap();
  return r;
}

function loadConfig(): WorldConfig {
  const saved = store.get('config');
  if (saved) {
    try {
      return { ...defaultConfig(), ...JSON.parse(saved) };
    } catch {
      /* ignore corrupt config */
    }
  }
  return defaultConfig({ seed: Math.floor(Math.random() * 1e6) });
}

// ------------------------------------------------------------------ map

const canvas = $<HTMLCanvasElement>('map');

function resizeCanvas(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  if (autoFit) fitView();
  drawMap();
}

function fitView(): void {
  const r = canvas.getBoundingClientRect();
  const mw = editing ? editing.width : world.map.width;
  const mh = editing ? editing.height : world.map.height;
  view.zoom = Math.max(1, Math.min(r.width / mw, r.height / mh));
  view.ox = (mw - r.width / view.zoom) / 2;
  view.oy = (mh - r.height / view.zoom) / 2;
}

function ink() {
  const cs = getComputedStyle(document.documentElement);
  return { text: cs.getPropertyValue('--map-label').trim(), halo: cs.getPropertyValue('--map-halo').trim(), accent: cs.getPropertyValue('--accent').trim() };
}

function drawMap(): void {
  if (editing) editing.draw(canvas, view);
  else renderer.draw(canvas, view, ink());
}

function centerOn(x: number, y: number): void {
  autoFit = false;
  const r = canvas.getBoundingClientRect();
  view.zoom = Math.max(view.zoom, 6);
  view.ox = x + 0.5 - r.width / view.zoom / 2;
  view.oy = y + 0.5 - r.height / view.zoom / 2;
}

let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
/** Pointer position in tile coordinates. */
function tileAt(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [view.ox + (e.clientX - r.left) / view.zoom, view.oy + (e.clientY - r.top) / view.zoom];
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  // In the editor the left button paints; the right or middle button, or Space, pans.
  if (editing && e.button === 0 && !spaceHeld) {
    editing.begin(...tileAt(e));
    drawMap();
    return;
  }
  drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false };
});
canvas.addEventListener('contextmenu', (e) => {
  if (editing) e.preventDefault();
});
canvas.addEventListener('pointerleave', () => {
  if (editing && !editing.painting) {
    editing.cursor = null;
    drawMap();
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (editing) {
    const [x, y] = tileAt(e);
    editing.cursor = { x, y };
    if (editing.painting) editing.move(x, y);
    if (!drag) {
      drawMap();
      return;
    }
  }
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) {
    drag.moved = true;
    autoFit = false;
  }
  view.ox = drag.ox - dx / view.zoom;
  view.oy = drag.oy - dy / view.zoom;
  drawMap();
});
canvas.addEventListener('pointerup', (e) => {
  if (editing) {
    if (editing.painting) {
      editing.end();
      drawMap();
      renderPanel(true);
    }
    drag = null;
    return;
  }
  if (drag && !drag.moved) pick(e);
  drag = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    autoFit = false;
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const wx = view.ox + mx / view.zoom;
    const wy = view.oy + my / view.zoom;
    view.zoom = Math.max(1, Math.min(40, view.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    view.ox = wx - mx / view.zoom;
    view.oy = wy - my / view.zoom;
    drawMap();
  },
  { passive: false },
);

function pick(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect();
  const wx = view.ox + (e.clientX - r.left) / view.zoom;
  const wy = view.oy + (e.clientY - r.top) / view.zoom;
  let best = -1;
  let bd = Math.max(1.2, 10 / view.zoom);
  for (const s of world.settlements) {
    if (!s.alive && !(view.showRuins && s.peakPop > 800)) continue;
    const d = Math.hypot(s.px - wx, s.py - wy);
    if (d < bd) {
      bd = d;
      best = s.id;
    }
  }
  // A wandering band under the pointer, if no settlement is closer.
  let band = -1;
  for (const b of world.bands) {
    if (!b.alive) continue;
    const t = b.path.length > 1 ? b.path[Math.min(b.step, b.path.length - 1)] : b.tile;
    const d = Math.hypot((t % world.map.width) + 0.5 - wx, Math.floor(t / world.map.width) + 0.5 - wy);
    if (d < bd) {
      bd = d;
      band = b.id;
      best = -1;
    }
  }
  view.selectedBand = band;
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  view.selectedTile = tx >= 0 && ty >= 0 && tx < world.map.width && ty < world.map.height ? ty * world.map.width + tx : -1;
  view.selectedSettlement = best;
  if (best >= 0) marketFor = best;
  view.selectedPolity = best >= 0 ? world.settlements[best].polityId : -1;
  selectedCulture = -1;
  if (best < 0 && view.selectedTile >= 0) {
    const o = world.map.region[view.selectedTile];
    view.selectedPolity = o >= 0 ? world.settlements[o].polityId : -1;
  }
  renderer.invalidate();
  setTab(tab === 'market' ? 'market' : 'inspect');
  drawMap();
}

// ------------------------------------------------------------------ top bar

function refreshTopbar(): void {
  const st = world.stats[world.stats.length - 1];
  $('world-name').textContent = cfg.name;
  $('year').textContent = realTime || world.month > 0 ? `Year ${world.year} · ${MONTHS[world.month]} · ${seasonOf(world.month)}` : `Year ${world.year}`;
  let era = 0;
  for (const p of world.alivePolities()) for (const t of p.techs) era = Math.max(era, TECH_BY_ID.get(t)?.era ?? 0);
  $('era').textContent = ERA_NAMES[era];
  $('stats').innerHTML = [
    ['Population', compact(st.population)],
    ['Settlements', fmt(st.settlements)],
    ['Realms', fmt(st.polities)],
    ['Cultures', fmt(st.cultures)],
    ['Wars', fmt(st.wars)],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const play = $('play');
  play.textContent = playing ? 'Pause' : 'Play';
  play.setAttribute('aria-pressed', String(playing));
  $('busy').hidden = pendingYears <= 0;
  $('busy').textContent = `Simulating… ${pendingYears} years to go`;
}

$('play').addEventListener('click', () => {
  playing = !playing;
  yearAcc = 0;
  refreshTopbar();
});
for (const [id, n] of [['step1', 1], ['step10', 10], ['step100', 100], ['step500', 500]] as const) {
  $(id).addEventListener('click', () => {
    pendingYears += n;
    refreshTopbar();
  });
}
const speedInput = $<HTMLInputElement>('speed');
function speedLabel(): void {
  $('speed-out').textContent = realTime ? `${(speed / 5).toFixed(1)} mo/s` : `${speed} yr/s`;
}
speedInput.addEventListener('input', () => {
  speed = Number(speedInput.value);
  speedLabel();
});
$('realtime').addEventListener('click', () => {
  realTime = !realTime;
  monthAcc = 0;
  yearAcc = 0;
  view.frac = 1;
  $('realtime').setAttribute('aria-pressed', String(realTime));
  speedLabel();
  refreshTopbar();
});
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const cur = root.dataset.theme;
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
  if (next) root.dataset.theme = next;
  else delete root.dataset.theme;
  $('theme').textContent = next === 'dark' ? 'Dark' : next === 'light' ? 'Light' : 'Auto';
  store.set('theme', next);
  drawMap();
});
{
  const t = store.get('theme');
  if (t) {
    document.documentElement.dataset.theme = t;
    $('theme').textContent = t === 'dark' ? 'Dark' : 'Light';
  }
}

// ------------------------------------------------------------------ map tools

const LAYER_LEGEND: Partial<Record<MapLayer, string>> = {
  temperature: '<span><i class="ramp" style="background:linear-gradient(90deg,#4628a0,#4682e6,#78d2dc,#96d76e,#f0d246,#f08232,#c82828)"></i>Frozen → sweltering (yearly mean)</span>',
  rainfall: '<span><i class="ramp" style="background:linear-gradient(90deg,#be8c50,#e1c878,#96c864,#3ca05a,#2878aa,#283ca0)"></i>Desert dry → drenched</span>',
  currents: '<span><i class="swatch-dot" style="background:#dc4632"></i>Warmer water than usual for the latitude</span><span><i class="swatch-dot" style="background:#326ede"></i>Colder</span><span>Arrows: the way the surface water flows</span>',
};

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
  btn.addEventListener('click', () => {
    view.layer = btn.dataset.layer as MapLayer;
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) b.setAttribute('aria-pressed', String(b === btn));
    $('resource-pick').hidden = view.layer !== 'resource';
    const legend = LAYER_LEGEND[view.layer];
    $('land-legend').hidden = !legend;
    $('land-legend').innerHTML = legend ?? '';
    renderer.invalidate();
    drawMap();
  });
}
const resSel = $<HTMLSelectElement>('resource');
resSel.innerHTML = RES_NAMES.map((n, i) => `<option value="${i}" ${i === view.resource ? 'selected' : ''}>${n}</option>`).join('');
resSel.addEventListener('change', () => {
  view.resource = Number(resSel.value) as Res;
  renderer.invalidate();
  drawMap();
});
for (const [id, key] of [['t-routes', 'showRoutes'], ['t-labels', 'showLabels'], ['t-ruins', 'showRuins'], ['t-caravans', 'showCaravans'], ['t-armies', 'showArmies'], ['t-roads', 'showRoads']] as const) {
  const box = $<HTMLInputElement>(id);
  box.checked = view[key];
  box.addEventListener('change', () => {
    view[key] = box.checked;
    drawMap();
  });
}
$('create-world').addEventListener('click', () => {
  if (editing) return;
  setTab('setup');
  openEditor(cfg);
});
const styleSel = $<HTMLSelectElement>('map-style');
styleSel.value = view.style;
const paperPane = () => document.querySelector('.map-pane')?.classList.toggle('parchment', view.style === 'parchment');
paperPane();
styleSel.addEventListener('change', () => {
  view.style = styleSel.value === 'parchment' ? 'parchment' : 'satellite';
  store.set('style', view.style);
  paperPane();
  drawMap();
});
$('fit').addEventListener('click', () => {
  autoFit = true;
  fitView();
  drawMap();
});

// ------------------------------------------------------------------ panels

function setTab(t: Tab): void {
  tab = t;
  store.set('tab', t);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  renderPanel(true);
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab as Tab));

const panel = $('panel');
panel.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-s],[data-p],[data-c],[data-e],[data-nation],[data-tech-for],[data-market]');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.market !== undefined) {
    marketFor = Number(a.dataset.market);
    setTab('market');
    return;
  }
  followLink(a);
});

function followLink(a: HTMLElement): void {
  if (a.dataset.nation) return openOverlay('nation', Number(a.dataset.nation));
  if (a.dataset.techFor) return openOverlay('tech', Number(a.dataset.techFor));
  closeOverlay();
  if (a.dataset.s) {
    const s = world.settlements[Number(a.dataset.s)];
    marketFor = s.id;
    if (tab === 'market') {
      view.selectedSettlement = s.id;
      centerOn(s.x, s.y);
      renderer.invalidate();
      drawMap();
      renderPanel(true);
      return;
    }
    view.selectedSettlement = s.id;
    view.selectedPolity = s.polityId;
    selectedCulture = -1;
    centerOn(s.x, s.y);
  } else if (a.dataset.p) {
    const p = world.polities[Number(a.dataset.p)];
    view.selectedSettlement = -1;
    view.selectedPolity = p.id;
    selectedCulture = -1;
    const c = world.settlements[p.capitalId];
    centerOn(c.x, c.y);
  } else if (a.dataset.c) {
    selectedCulture = Number(a.dataset.c);
    view.selectedSettlement = -1;
    view.selectedPolity = -1;
  } else if (a.dataset.e) {
    const ev = world.history[Number(a.dataset.e)];
    const sid = ev.settlements?.[0];
    if (sid !== undefined) {
      const s = world.settlements[sid];
      view.selectedSettlement = sid;
      view.selectedPolity = s.polityId;
      centerOn(s.x, s.y);
    } else if (ev.polities?.length) {
      view.selectedSettlement = -1;
      view.selectedPolity = ev.polities[0];
      const c = world.settlements[world.polities[ev.polities[0]].capitalId];
      centerOn(c.x, c.y);
    } else if (ev.cultures?.length) selectedCulture = ev.cultures[0];
    selectedCulture = ev.polities?.length || sid !== undefined ? -1 : selectedCulture;
  }
  renderer.invalidate();
  drawMap();
  setTab('inspect');
}

// ------------------------------------------------------------------ overlays

const overlayEl = $('overlay');
const overlayBody = $('overlay-body');
const overlaySel = $<HTMLSelectElement>('overlay-nation');
const ttDetail = $('tt-detail');

function helpers() {
  return { esc, sLink, pLink, cLink, meter, eventList };
}

function openOverlay(mode: 'nation' | 'tech', polityId = view.selectedPolity): void {
  overlay = mode;
  if (polityId < 0 || !world.polities[polityId]) {
    const biggest = [...world.alivePolities()].sort((a, b) => b.pop - a.pop)[0];
    polityId = mode === 'nation' ? (biggest?.id ?? -1) : -1;
  }
  overlayPolity = polityId;
  overlayEl.hidden = false;
  overlayBody.scrollTop = 0;
  renderOverlay(true);
}

function closeOverlay(): void {
  if (!overlay) return;
  overlay = null;
  overlayEl.hidden = true;
  ttDetail.hidden = true;
}

function renderOverlay(full: boolean): void {
  if (!overlay) return;
  lastOverlay = performance.now();
  const alive = [...world.alivePolities()].sort((a, b) => b.pop - a.pop);
  const current = world.polities[overlayPolity];
  const options = alive.map((p) => `<option value="${p.id}">${esc(p.name)} (${compact(p.pop)})</option>`);
  if (current && !current.alive) options.unshift(`<option value="${current.id}">${esc(current.name)} (fallen)</option>`);
  if (overlay === 'tech') options.unshift('<option value="-1">The whole world</option>');
  overlaySel.innerHTML = options.join('');
  overlaySel.value = String(overlayPolity);
  $('overlay-title').textContent = overlay === 'nation' ? 'Nation' : 'Tech tree';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-overlay]')) b.setAttribute('aria-pressed', String(b.dataset.overlay === overlay));
  const scrollTop = overlayBody.scrollTop;
  if (overlay === 'nation') {
    ttDetail.hidden = true;
    if (overlayPolity < 0) {
      overlayBody.innerHTML = '<p class="muted">No nations remain.</p>';
      return;
    }
    overlayBody.innerHTML = `<div class="dossier">${renderNation(world, overlayPolity, helpers())}</div>`;
    mountNationCharts(world, overlayPolity);
  } else {
    const scroller = overlayBody.querySelector('.tt-scroll');
    const left = scroller?.scrollLeft ?? 0;
    overlayBody.innerHTML = `<div class="tt-legend">
      <span><i class="sw known"></i>Known</span><span><i class="sw researching"></i>Being learned</span><span><i class="sw available"></i>Can research</span>
      <span><i class="sw blocked"></i>Missing a resource</span><span><i class="sw locked"></i>Locked</span>
      <span class="cats">${['agriculture', 'industry', 'military', 'maritime', 'society', 'science', 'arcane'].map((c) => `<i class="cat c-${c}"></i>${c}`).join(' ')}</span>
      <span class="muted">Select a tech to trace the path to it.</span></div><div id="tt-host"></div>`;
    mountTechTree($('tt-host'), world, overlayPolity, selectedTech, (id) => {
      selectedTech = selectedTech === id ? null : id;
      renderOverlay(true);
    }, esc);
    const sc = overlayBody.querySelector('.tt-scroll');
    if (sc) sc.scrollLeft = left;
    ttDetail.hidden = !selectedTech;
    if (selectedTech) ttDetail.innerHTML = techDetail(world, overlayPolity, selectedTech, esc, pLink);
  }
  if (!full) overlayBody.scrollTop = scrollTop;
}

overlaySel.addEventListener('change', () => {
  overlayPolity = Number(overlaySel.value);
  renderOverlay(true);
});
$('overlay-close').addEventListener('click', closeOverlay);
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-overlay]')) {
  b.addEventListener('click', () => (overlay === b.dataset.overlay ? closeOverlay() : openOverlay(b.dataset.overlay as 'nation' | 'tech', overlay ? overlayPolity : view.selectedPolity)));
}
for (const el of [overlayBody, ttDetail]) {
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-s],[data-p],[data-c],[data-e],[data-tech-for]');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.p) {
      openOverlay(overlay ?? 'nation', Number(a.dataset.p));
      return;
    }
    followLink(a);
  });
}
document.addEventListener('keydown', (e) => {
  if (editing) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    if (e.key === ' ' && !typing) {
      spaceHeld = true;
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (editing.undo()) {
        drawMap();
        renderPanel(true);
      }
    } else if (!typing && (e.key === '[' || e.key === ']')) {
      editing.radius = Math.max(1, Math.min(40, editing.radius + (e.key === ']' ? 1 : -1)));
      drawMap();
      renderPanel(true);
    }
    return;
  }
  if (e.key !== 'Escape') return;
  if (overlay) return closeOverlay();
  // Esc with nothing open clears the map selection and its nation highlight.
  view.selectedSettlement = -1;
  view.selectedPolity = -1;
  view.selectedTile = -1;
  selectedCulture = -1;
  renderer.invalidate();
  drawMap();
  renderPanel(true);
});

document.addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceHeld = false;
});

const sLink = (id: number) => {
  const s = world.settlements[id];
  return `<a href="#" data-s="${id}">${esc(s.name)}</a>`;
};
const pLink = (id: number) => `<a href="#" data-p="${id}" class="realm"><span class="dot" style="background:${world.polities[id].color}"></span>${esc(world.polities[id].name)}</a>`;
const cLink = (id: number) => `<a href="#" data-c="${id}">${esc(world.cultures[id].name)}</a>`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function meter(label: string, v: number, tone: 'plain' | 'good' | 'bad' = 'plain'): string {
  const state = tone === 'plain' ? '' : v < 0.35 ? 'crit' : v < 0.6 ? 'warn' : 'ok';
  return `<div class="meter ${state}"><span>${label}</span><div class="bar"><i style="width:${Math.max(2, Math.min(100, v * 100))}%"></i></div><b>${pct(v)}</b></div>`;
}

function eventList(events: HistoryEvent[], limit: number): string {
  if (!events.length) return '<p class="muted">No recorded events yet.</p>';
  return `<ol class="events">${events
    .slice(-limit)
    .reverse()
    .map((e) => `<li class="imp${e.importance}"><time>${e.year}</time><a href="#" data-e="${world.history.indexOf(e)}">${esc(e.text)}</a></li>`)
    .join('')}</ol>`;
}

function renderInspect(): string {
  if (selectedCulture >= 0) return renderCulture(selectedCulture);
  if ((view.selectedBand ?? -1) >= 0) {
    const b = world.bands.find((x) => x.id === view.selectedBand && x.alive);
    if (b) return renderBand(b);
  }
  if (view.selectedSettlement >= 0) return renderSettlement(view.selectedSettlement);
  if (view.selectedPolity >= 0) return renderPolity(view.selectedPolity) + (view.selectedTile >= 0 ? renderTile(view.selectedTile) : '');
  if (view.selectedTile >= 0) return renderTile(view.selectedTile);
  return `<div class="empty"><h2>Nothing selected</h2><p>Click a settlement or any stretch of land on the map to inspect it. Settlements marked with a diamond are capitals.</p><p>Press <b>Play</b> or add years to watch peoples spread, trade, invent and wage war.</p></div>`;
}

/** A wandering tribe: its clan and people, its way of life, its home range and how it is faring. */
function renderBand(b: Band): string {
  const tribe = world.tribes[b.tribeId];
  const culture = world.cultures[b.cultureId];
  const race = Object.entries(b.races).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  const kin = world.bands.filter((x) => x.alive && x.tribeId === tribe.id);
  const moving = b.step < b.path.length - 1;
  const need = b.pop * (world.raceById.get(race)?.foodNeed ?? 1);
  const months = need > 0 ? (b.food / need) * 12 : 0;
  const parent = tribe.parentId >= 0 ? world.tribes[tribe.parentId] : null;
  const know = [...tribe.techs].map((t) => TECH_BY_ID.get(t)?.name ?? t);
  let lands = 0;
  for (let i = 0; i < world.map.size; i++) if (world.map.claim[i] === tribe.id) lands++;
  const feuds = Object.entries(tribe.feuds).filter(([, y]) => world.year - y < 30).sort((x, y) => y[1] - x[1]);
  const season = world.season === 'autumn' || world.season === 'winter' ? 'winter' : 'summer';
  return `
    <header class="head">
      <p class="eyebrow">Wandering tribe · ${b.way === 'herders' ? 'herders' : 'hunters and gatherers'}</p>
      <h2><span class="dot big" style="background:${tribe.color}"></span>${esc(b.name.charAt(0).toUpperCase() + b.name.slice(1))}</h2>
      <p class="sub">Of the ${esc(tribe.name)} clan · ${cLink(b.cultureId)} people · ${esc(world.raceById.get(race)?.plural ?? race)}</p>
    </header>
    <dl class="facts">
      <div><dt>People</dt><dd>${fmt(b.pop)}</dd></div>
      <div><dt>Since</dt><dd>Year ${b.founded}</dd></div>
      <div><dt>Food carried</dt><dd>${months >= 1 ? `${months.toFixed(1)} months` : 'barely any'}</dd></div>
      <div><dt>Lean months</dt><dd>${b.lastHungry} last year</dd></div>
    </dl>
    <section><h3>Home range</h3>
      <p class="small">${b.home >= 0 ? `It has made its home in the ${esc(BIOMES[world.map.biome[b.home]].name.toLowerCase())} since year ${b.homeSince}, and keeps its seasonal round within its clan's hunting grounds there, claiming more as it grows and defending them against other clans.` : `Still searching for good hunting and foraging land to make its own (${b.searching} year${b.searching === 1 ? '' : 's'} so far). Tribes roam for a few years before they settle on a home range and start claiming it.`}</p>
      <p class="small">${moving ? `On the move to its ${season} grounds, ${b.path.length - 1 - b.step} tiles away.` : `Camped on its ${season} grounds, ${b.way === 'herders' ? 'grazing its herds' : 'hunting and gathering'} on the wild land around.`} Tribes move to summer grounds in spring and to sheltered winter grounds in autumn, and move on early when the land runs thin.</p>
    </section>
    <section><h3>The ${esc(tribe.name)} clan</h3>
      <p class="small">${kin.length} tribe${kin.length === 1 ? '' : 's'}, ${fmt(kin.reduce((n, x) => n + x.pop, 0))} people, holding ${lands ? `${fmt(lands)} tiles of hunting grounds` : 'no land yet'}${parent ? `; broke away from the ${esc(parent.name)} clan in year ${tribe.founded}` : `; one of the first clans of the ${esc(culture.name)}`}.${tribe.polityId >= 0 ? ` Some of its people have settled: ${pLink(tribe.polityId)}.` : ''}</p>
      ${tribe.wins + tribe.losses > 0 ? `<p class="small"><span class="k">Fights over land</span> ${tribe.wins} won, ${tribe.losses} lost${feuds.length ? ` · feuding with ${feuds.map(([id]) => `the ${esc(world.tribes[+id].name)}`).join(', ')}` : ''}</p>` : ''}
      <p class="small"><span class="k">Knows</span> ${know.length ? esc(know.join(', ')) : 'only the old ways'}</p>
      <p class="small muted">${esc(world.raceById.get(race)?.plural ?? '')} are ${world.raceById.get(race)?.lifestyle === 'nomadic' ? 'a nomadic people who seldom settle' : world.raceById.get(race)?.lifestyle === 'seminomadic' ? 'slow to settle' : 'quick to settle once farming or a rich site makes it pay'}.</p>
    </section>`;
}

function renderSettlement(id: number): string {
  const s = world.settlements[id];
  const p = world.polities[s.polityId];
  const races = Object.entries(s.races).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]);
  const events = world.history.filter((e) => e.settlements?.includes(id));
  const market = s.marketId === id;
  const mine = (l: { a: number; b: number }) => l.a === id || l.b === id;
  // Villages trade only with their market; markets with each other, the hub, and the villages they serve.
  const allLinks = [
    ...(market ? s.links.map((li) => world.links[li]).filter((l) => world.settlements[l.a].marketId === l.a && world.settlements[l.b].marketId === l.b) : []),
    ...world.hubLinks.filter(mine),
    ...world.marketLinks.filter(mine),
  ];
  const partners = allLinks.map((l) => ({ o: l.a === id ? l.b : l.a, v: l.volume, sea: l.sea, kind: l.kind, hub: !!l.hub, toMarket: world.marketLinks.includes(l) })).filter((x) => world.settlements[x.o].alive && x.kind === 'internal').sort((a, b) => b.v - a.v);
  const served = world.settlements.filter((o) => o.alive && o.id !== id && o.marketId === id);
  const caravans = world.caravans.filter((c) => c.homeId === id);
  const houses = world.houses.filter((h) => h.homeId === id && h.closed === null);
  const road = world.map.road[s.tile] | 0;
  return `
    <header class="head">
      <p class="eyebrow">${s.alive ? settlementTier(s.pop) : 'Ruins'}${p.capitalId === id && s.alive ? ' · Capital' : ''}</p>
      <h2>${esc(s.name)}</h2>
      <p class="sub">${s.alive ? `${pLink(p.id)} · ${cLink(s.cultureId)} culture` : `Abandoned in year ${s.abandoned}; once home to ${fmt(s.peakPop)}.`}</p>
    </header>
    <dl class="facts">
      <div><dt>Population</dt><dd>${fmt(s.pop)}</dd></div>
      <div><dt>Founded</dt><dd>Year ${s.founded}</dd></div>
      <div><dt>Housing</dt><dd>${fmt(s.housing)}</dd></div>
      <div><dt>Wealth</dt><dd>${compact(s.wealth)}</dd></div>
      <div><dt>Terrain</dt><dd>${BIOMES[world.map.biome[s.tile]].name}${s.coastal ? ', coast' : ''}${s.river ? ', river' : ''}</dd></div>
      <div><dt>Location</dt><dd>${s.x}, ${s.y}</dd></div>
    </dl>
    ${s.alive ? `<section><h3>Condition</h3>${meter('Food', Math.min(1, s.foodRatio), 'good')}${meter('Stability', s.stability, 'good')}${meter('Loyalty', s.loyalty, 'good')}${s.plague > 0 ? `<p class="chip crit">Plague · ${pct(s.plague)} severity</p>` : ''}
      ${s.occupiedBy >= 0 ? `<p class="small"><span class="chip crit">occupied</span> Held by ${pLink(s.occupiedBy)} since ${MONTHS[s.occupiedSince % 12]} of year ${Math.floor(s.occupiedSince / 12)}; the peace will decide who keeps it.</p>` : ''}
      <p class="small"><span class="k">Stores</span> ${foodStores(s)}</p>
      <p class="small"><span class="k">Held by</span> ${s.holder >= 0 && world.nobles[s.holder] ? `${esc(world.nobles[s.holder].name)}${world.nobles[s.holder].seatId === s.id ? ' (its seat)' : ''}` : 'the crown'} · <span class="k">Since</span> year ${s.heldSince}</p>
      ${!s.connected ? `<p class="small"><span class="chip crit">cut off</span> No road to the capital for ${s.cutOff} year${s.cutOff === 1 ? '' : 's'}${s.loyalty < 0.35 ? '; its people are thinking of changing sides' : '; it holds out'}.</p>` : ''}
      ${s.surrounded > 0.4 ? `<p class="small"><span class="chip warn">surrounded</span> ${pct(s.surrounded)} of the land around it is held by hostile powers.</p>` : ''}
      ${Object.keys(s.claims).length ? `<p class="small"><span class="k">Claimed by</span> ${Object.entries(s.claims).map(([q, y]) => `${pLink(+q)} <span class="muted">(lost it in ${y})</span>`).join(', ')}</p>` : ''}
    </section>` : ''}
    ${s.alive ? developmentSection(s) : ''}
    ${s.alive ? landSection(s) : ''}
    ${races.length ? `<section><h3>Peoples</h3>${races.map(([r, n]) => meter(esc(world.raceById.get(r)?.plural ?? r), n / Math.max(1, s.pop))).join('')}</section>` : ''}
    ${s.alive ? `<section><h3>Economy</h3>
      ${workSection(s)}
      ${accountsSection(s)}
      <p><span class="k">Tools</span> ${['stone', 'copper', 'bronze', 'iron', 'steel'][Math.round(s.toolQuality)]} · <span class="k">Arms</span> ${['stone', 'copper', 'bronze', 'iron', 'steel'][Math.round(s.weaponQuality)]}</p>
    </section>
    <section><h3>Trade</h3>
      <p class="small"><span class="k">Internal</span> ${compact(s.tradeByKind.internal)} · <span class="k">Caravans</span> ${compact(s.tradeByKind.caravan)} · <span class="k">Convoys</span> ${compact(s.tradeByKind.convoy)} · <span class="k">Passing</span> ${compact(s.transit)} <span class="muted">silver/yr</span></p>
      <p class="small"><span class="k">Road</span> ${road ? ROAD_NAMES[road] : 'No road yet'} · <button type="button" class="mini" data-market="${id}">Open market</button></p>
      <p class="small"><span class="k">Market</span> ${market ? `${s.tier >= 3 ? 'holds a market' : 'holds the market for the villages around it'}${served.length ? ` for ${served.length} settlement${served.length > 1 ? 's' : ''}: ${served.slice(0, 6).map((o) => sLink(o.id)).join(', ')}${served.length > 6 ? ` and ${served.length - 6} more` : ''}` : ''}` : `trades through ${sLink(s.marketId)}`}</p>
      ${partners.length ? `<h4 class="mini-h">Trading neighbours in the realm</h4><ul class="plain">${partners.slice(0, 6).map((x) => `<li>${sLink(x.o)} <span class="chip">${x.hub ? 'road to hub' : x.toMarket ? (market ? 'comes to market' : 'its market') : 'neighbour'}</span> <span class="muted small">${x.sea ? 'by sea' : 'overland'} · ${compact(x.v)}/yr</span></li>`).join('')}</ul>` : '<p class="muted small">No trading neighbours in its own realm.</p>'}
      ${houses.length ? `<p class="small">Home of ${houses.map((h) => `<b>${esc(h.name)}</b> <span class="muted">(${compact(h.wealth)} silver, ${h.trips} ventures)</span>`).join(', ')}.</p>` : ''}
      ${caravans.length ? `<h4 class="mini-h">On the road</h4><ul class="plain small">${caravans.map((c) => `<li><span class="swatch-dot" style="background:${CARAVAN_COLOR[c.kind]}"></span>${CARAVAN_KIND[c.kind]} (${c.size} beasts) ${c.returning ? 'coming home from' : 'bound for'} ${sLink(c.returning ? c.fromId : c.toId)}${c.cargo.length ? ` with ${c.cargo.map((x) => `${Math.round(x.qty)} ${GOOD_NAMES[x.good].toLowerCase()}`).join(', ')}` : ', empty'}</li>`).join('')}</ul>` : ''}
    </section>` : ''}
    ${s.greatWorks.length ? `<section><h3>Great works</h3><p>${s.greatWorks.map(esc).join(' · ')}</p></section>` : ''}
    <section><h3>Local history</h3>${eventList(events, 15)}</section>`;
}

/** Everyone of working age, by trade: food, raw materials, crafts, and those without work. */
function workSection(s: { labor: Float64Array; idle: number }): string {
  const groups = new Map<string, Map<string, number>>();
  let total = s.idle;
  for (let k = 0; k < SECTOR_KEYS.length; k++) {
    const n = s.labor[k];
    total += n;
    if (n < 0.5) continue;
    const { job, group } = JOBS[SECTOR_KEYS[k]];
    const g = groups.get(group) ?? new Map<string, number>();
    g.set(job, (g.get(job) ?? 0) + n);
    groups.set(group, g);
  }
  const rows = ['Food', 'Raw materials', 'Crafts'].filter((g) => groups.has(g)).map((g) => {
    const jobs = [...groups.get(g)!].sort((a, b) => b[1] - a[1]);
    return `<p class="small"><span class="k">${g}</span> ${jobs.map(([j, n]) => `${j} <b>${fmt(n)}</b>`).join(' · ')}</p>`;
  });
  return `<h4 class="mini-h">Work · ${fmt(total)} of working age</h4>${rows.join('')}${s.idle >= 0.5 ? `<p class="small"><span class="k">Without work</span> <b>${fmt(s.idle)}</b> (${pct(s.idle / Math.max(1, total))})</p>` : ''}`;
}

/** Last year's accounts, good by good: what the settlement made, used, bought and sold, and what merely passed through. */
function accountsSection(s: { yearMade: Float64Array; yearUsed: Float64Array; yearBought: Float64Array; yearSold: Float64Array; yearTributePaid: number; yearTributeIn: number }): string {
  const rows: string[] = [];
  const sells: string[] = [];
  const buys: string[] = [];
  const passes: string[] = [];
  for (let g = 0; g < GOOD_NAMES.length; g++) {
    const made = s.yearMade[g];
    const used = s.yearUsed[g];
    const bought = s.yearBought[g];
    const sold = s.yearSold[g];
    if (made < 0.5 && used < 0.5 && bought < 0.5 && sold < 0.5) continue;
    const passed = Math.min(bought, sold);
    if (sold - passed >= 1) sells.push(GOOD_NAMES[g]);
    if (bought - passed >= 1) buys.push(GOOD_NAMES[g]);
    if (passed >= 1) passes.push(GOOD_NAMES[g]);
    const n = (v: number) => (v >= 0.5 ? compact(v) : '—');
    rows.push(`<tr><td>${GOOD_NAMES[g]}</td><td class="num">${n(made)}</td><td class="num">${n(used)}</td><td class="num">${n(bought - passed)}</td><td class="num">${n(sold - passed)}</td><td class="num">${n(passed)}</td></tr>`);
  }
  if (!rows.length) return '';
  return `<p class="small"><span class="k">Sells</span> ${sells.join(', ') || '—'}</p>
    <p class="small"><span class="k">Buys</span> ${buys.join(', ') || '—'}</p>
    ${passes.length ? `<p class="small"><span class="k">Passes on</span> ${passes.join(', ')} <span class="muted">(bought and sold on by its merchants)</span></p>` : ''}
    ${s.yearTributePaid >= 1 ? `<p class="small"><span class="k">Tribute</span> ${compact(s.yearTributePaid)} food sent to the capital</p>` : s.yearTributeIn >= 1 ? `<p class="small"><span class="k">Tribute</span> ${compact(s.yearTributeIn)} food received from the realm</p>` : ''}
    <details><summary>Last year's accounts</summary><div class="table-wrap"><table>
      <thead><tr><th>Good</th><th class="num">Made</th><th class="num">Used</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">Passed on</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div></details>`;
}

/** How developed the settlement is: its size, what it is built of, its town, and how crowded it is. */
function developmentSection(s: Settlement): string {
  const tier = TIERS[s.tier];
  const room = comfort(world, s);
  const crowd = s.crowding;
  const note = crowd <= 0 ? 'room to spare' : crowd < 0.3 ? 'getting crowded' : crowd < 1 ? 'crowded: more sickness, fires and unrest' : 'packed to bursting: filth, plague and fire';
  return `<section><h3>Development</h3>
    <p class="small"><b>${tier.name}</b> · built of ${BUILDINGS[s.buildings].name} · can keep up to ${pct(tier.crafts)} of its workers in crafts</p>
    ${tier.urban ? `<p class="small"><span class="k">Town</span> ${fmt(s.urbanPop)} townsfolk on ${s.cityTiles} tile${s.cityTiles === 1 ? '' : 's'} of City land</p>` : ''}
    <p class="small"><span class="k">Crowding</span> ${crowd > 0 ? `<b>${(1 + crowd).toFixed(1)}×</b> what it holds in comfort` : 'none'} ${crowd >= 0.3 ? '<span class="chip crit">crowded</span>' : ''}</p>
    <p class="small muted">Holds ${fmt(room)} in comfort with its building skills and town; ${note}.</p>
  </section>`;
}

/** The settlement's land: the ring of tiles it works, and how much of it goes to each use. */
function landSection(s: { territory: number[] }): string {
  const R = ringRadius(world);
  const counts = new Map<number, number>();
  for (const t of s.territory) counts.set(world.map.landUse[t], (counts.get(world.map.landUse[t]) ?? 0) + 1);
  const uses = [...counts].sort((a, b) => b[1] - a[1]).map(([u, n]) => `<span class="chip"><i class="swatch-dot" style="background:rgb(${LAND_USE_COLORS[u].join(',')})"></i>${LAND_USE_NAMES[u]} ${n}</span>`).join(' ');
  const full = (2 * R + 1) ** 2;
  return `<section><h3>Land</h3>
    <p class="small">Works <b>${s.territory.length}</b> tiles of land around it${s.territory.length < full * 0.6 ? ', hemmed in by neighbours, the sea or the mountains' : ''}.</p>
    <p class="small">${uses}</p></section>`;
}

/** Food in the stores, how many months it lasts, and what the rest of the year will bring. */
function foodStores(s: { stock: Float64Array; foodSchedule: Float64Array; pop: number; lastHungry: number }): string {
  const monthly = Math.max(1, s.pop) / 12;
  let coming = 0;
  for (let m = world.month; m < 12; m++) coming += s.foodSchedule[m];
  const months = s.stock[0] / monthly;
  return `${compact(s.stock[0])} food (${months >= 24 ? 'two years and more' : `${months.toFixed(1)} months`})${coming > 1 ? ` · ${compact(coming)} still to come this year` : ''}${s.lastHungry ? ` · ${s.lastHungry} lean month${s.lastHungry > 1 ? 's' : ''} last year` : ''}`;
}

/** Chips naming the ties between two nations: marriage, alliance, confederation, vassalage. */
function bondChips(a: number, b: number): string {
  const out = pactsBetween(world, a, b).map((x) => `<span class="chip ok">${x.type === 'marriage' ? 'married' : 'allied'}</span>`);
  if (sameConfederation(world, a, b)) out.push('<span class="chip ok">confederates</span>');
  if (world.polities[a].overlord === b) out.push('<span class="chip warn">our overlord</span>');
  if (world.polities[b].overlord === a) out.push('<span class="chip warn">our vassal</span>');
  return out.length ? ' ' + out.join(' ') : '';
}

function renderPolity(id: number): string {
  const p = world.polities[id];
  const byEra = new Map<number, string[]>();
  for (const t of TECHS) if (p.techs.has(t.id)) byEra.set(t.era, [...(byEra.get(t.era) ?? []), t.name]);
  const wars = [...p.wars].map((w) => world.wars[w]);
  const rel = [...p.relations].filter(([q]) => world.polities[q].alive).sort((a, b) => a[1] - b[1]);
  const events = world.history.filter((e) => e.polities?.includes(id) && e.importance >= 2);
  const r = p.ruler;
  const researching = p.researching ? TECH_BY_ID.get(p.researching)?.name : null;
  const html = `
    <header class="head">
      <p class="eyebrow">${p.alive ? `${p.government} · ${polityEra(p)}` : `Fallen realm · ${p.founded}–${p.dissolved}`}</p>
      <h2><span class="dot big" style="background:${p.color}"></span>${esc(p.name)}</h2>
      <p class="sub">${cLink(p.cultureId)} culture · capital ${sLink(p.capitalId)}${p.parentPolity >= 0 ? ` · broke from ${pLink(p.parentPolity)}` : ''}</p>
      <p class="actions"><button type="button" data-nation="${id}">Open nation view</button> <button type="button" data-tech-for="${id}">Tech tree</button></p>
    </header>
    <dl class="facts">
      <div><dt>Population</dt><dd>${fmt(p.pop)}</dd></div>
      <div><dt>Settlements</dt><dd>${p.settlementIds.length}</dd></div>
      <div><dt>Army strength</dt><dd>${compact(p.military)}</dd></div>
      <div><dt>Treasury</dt><dd>${compact(p.treasury)}</dd></div>
      <div><dt>Founded</dt><dd>Year ${p.founded}</dd></div>
      <div><dt>Nearly mastered</dt><dd>${researching ? esc(researching) : '—'}</dd></div>
    </dl>
    ${p.alive ? `<section>${meter('Stability', p.stability, 'good')}${meter('War weariness', Math.min(1, p.warExhaustion))}</section>` : ''}
    <section><h3>Ruler</h3><p><b>${esc(r.title)} ${esc(r.name)}</b>${p.dynasty >= 0 ? ` of ${esc(world.nobles[p.dynasty].name)}` : ''} <span class="muted">— ${esc(world.raceById.get(r.raceId)?.name ?? r.raceId)}, age ${world.year - r.born}, reigning since ${r.since}</span></p><p>${r.traits.map((t) => `<span class="chip">${t}</span>`).join(' ')}</p>
    ${p.pastRulers.length ? `<details><summary>${p.pastRulers.length} earlier ruler${p.pastRulers.length > 1 ? 's' : ''}</summary><ul class="plain small">${p.pastRulers.slice().reverse().map((x) => `<li>${esc(x.title)} ${esc(x.name)} (${x.since}–${x.until}) — ${esc(x.fate ?? '')}</li>`).join('')}</ul></details>` : ''}</section>
    ${wars.length ? `<section><h3>At war</h3><ul class="plain">${wars.map((w) => `<li><span class="chip crit">war</span> ${esc(w.name)} vs ${pLink(w.attacker === id ? w.defender : w.attacker)} <span class="muted">since ${w.start}${w.cause ? ` — over ${esc(w.cause)}` : ''}</span></li>`).join('')}</ul></section>` : ''}
    ${rel.length ? `<section><h3>Neighbours</h3><ul class="plain">${rel.slice(0, 6).map(([q, v]) => `<li>${pLink(q)} <span class="chip ${v < -0.3 ? 'crit' : v < 0 ? 'warn' : 'ok'}">${v < -0.3 ? 'hostile' : v < 0 ? 'wary' : v < 0.35 ? 'cordial' : 'friendly'}</span>${bondChips(id, q)}</li>`).join('')}</ul></section>` : ''}
    <section><h3>Knowledge</h3>${byEra.size ? [...byEra].sort((a, b) => a[0] - b[0]).map(([e, names]) => `<p><span class="k">${ERA_NAMES[e]}</span> ${names.join(', ')}</p>`).join('') : '<p class="muted">Nothing beyond the old ways yet.</p>'}</section>
    <section id="polity-chart"></section>
    <section><h3>Chronicle</h3>${eventList(events, 15)}</section>`;
  queueMicrotask(() => {
    const host = document.getElementById('polity-chart');
    if (host) lineChart(host, 'Population', [{ name: p.name, color: 'var(--accent)', points: p.popHistory }]);
  });
  return html;
}

function renderCulture(id: number): string {
  const c = world.cultures[id];
  const setts = [...world.aliveSettlements()].filter((s) => s.cultureId === id);
  const pop = setts.reduce((a, s) => a + s.pop, 0);
  const daughters = world.cultures.filter((d) => d.parentId === id);
  const race = world.raceById.get(c.raceId);
  const sample = Array.from({ length: 5 }, (_, i) => (c.language.onsets[i % c.language.onsets.length] ?? '') + (c.language.vowels[(i * 2) % c.language.vowels.length] ?? '') + (c.language.codas[(i * 3) % c.language.codas.length] ?? ''));
  return `
    <header class="head">
      <p class="eyebrow">Culture · ${esc(race?.plural ?? c.raceId)}${c.alive ? '' : ` · faded ${c.extinct}`}</p>
      <h2><span class="dot big" style="background:${c.color}"></span>${esc(c.name)}</h2>
      <p class="sub">${esc(describeValues(world, id))}</p>
    </header>
    <dl class="facts">
      <div><dt>Population</dt><dd>${fmt(pop)}</dd></div>
      <div><dt>Settlements</dt><dd>${setts.length}</dd></div>
      <div><dt>Arose</dt><dd>Year ${c.founded}</dd></div>
      <div><dt>Parent</dt><dd>${c.parentId >= 0 ? cLink(c.parentId) : 'Ancestral'}</dd></div>
    </dl>
    <section><h3>Survival traits</h3>
      ${c.traits.length ? c.traits.map((t) => {
        const d = TRAIT_BY_ID.get(t);
        return `<p><span class="chip trait">${esc(d?.name ?? t)}</span> <span class="small">${esc(d?.description ?? '')}</span></p>`;
      }).join('') : '<p class="muted small">None yet. Traits develop over generations from the land and life a people lives.</p>'}
      ${(() => {
        const growing = TRAITS.filter((t) => !c.traits.includes(t.id) && (c.exposure[t.id] ?? 0) > 0.1).sort((a, b) => (c.exposure[b.id] ?? 0) - (c.exposure[a.id] ?? 0)).slice(0, 4);
        return growing.length ? `<p class="muted small">Adapting towards:</p>${growing.map((t) => meter(t.name, Math.min(1, c.exposure[t.id] ?? 0))).join('')}` : '';
      })()}
    </section>
    <section><h3>Values</h3>${VALUE_KEYS.map((k) => meter(k.charAt(0).toUpperCase() + k.slice(1), c.values[k])).join('')}</section>
    <section><h3>Tongue</h3><p>Sounds like: <i>${sample.map(esc).join(', ')}</i></p><p class="muted">Place-name endings: ${c.language.settlementSuffixes.map((x) => `-${esc(x)}`).join(', ')}</p></section>
    ${daughters.length ? `<section><h3>Daughter cultures</h3><p>${daughters.map((d) => cLink(d.id)).join(', ')}</p></section>` : ''}
    ${setts.length ? `<section><h3>Largest communities</h3><ul class="plain">${setts.sort((a, b) => b.pop - a.pop).slice(0, 8).map((s) => `<li>${sLink(s.id)} <span class="muted">${fmt(s.pop)} · ${esc(world.polities[s.polityId].name)}</span></li>`).join('')}</ul></section>` : ''}`;
}

function renderTile(t: number): string {
  const m = world.map;
  const R = m.resources;
  const res = Array.from({ length: RES_COUNT }, (_, r) => [r, R[r][t]] as const).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]);
  const o = m.owner[t];
  return `
    <section class="tile">
      <h3>Land at ${t % m.width}, ${Math.floor(t / m.width)}</h3>
      <dl class="facts">
        <div><dt>Terrain</dt><dd>${BIOMES[m.biome[t]].name}</dd></div>
        <div><dt>Elevation</dt><dd>${m.elevation[t] < 0 ? 'below sea' : `${Math.round(m.elevation[t] * 4000)} m`}</dd></div>
        <div><dt>Climate</dt><dd>${Math.round(-25 + m.temperature[t] * 55)} °C mean</dd></div>
        <div><dt>Rainfall</dt><dd>${Math.round(m.moisture[t] * 2000)} mm/yr</dd></div>
        <div><dt>River</dt><dd>${m.river[t] > 0 ? 'yes' : 'no'}</dd></div>
        <div><dt>Realm</dt><dd>${m.region[t] >= 0 ? pLink(world.settlements[m.region[t]].polityId) : 'wilderness'}</dd></div>
        ${m.claim[t] >= 0 ? `<div><dt>Hunting grounds of</dt><dd><span class="dot" style="background:${world.tribes[m.claim[t]].color}"></span>the ${esc(world.tribes[m.claim[t]].name)} clan</dd></div>` : ''}
        <div><dt>Worked by</dt><dd>${o >= 0 ? sLink(o) : 'no one'}</dd></div>
        ${o >= 0 ? `<div><dt>Used for</dt><dd>${LAND_USE_NAMES[m.landUse[t]]}</dd></div>` : ''}
      </dl>
      ${res.length ? res.map(([r, v]) => meter(RES_NAMES[r], Math.min(1, v))).join('') : '<p class="muted">No notable resources.</p>'}
    </section>`;
}

function renderRealms(): string {
  const alive = [...world.alivePolities()].sort((a, b) => b.pop - a.pop);
  const fallen = world.polities.filter((p) => !p.alive && p.popHistory.some(([, n]) => n > 3000)).sort((a, b) => (b.dissolved ?? 0) - (a.dissolved ?? 0));
  const wars = world.wars.filter((w) => w.end === null);
  return `
    <header class="head"><h2>Realms</h2><p class="sub">${alive.length} living realms, ${wars.length} at war. Select one to see its rulers, knowledge and history.</p></header>
    <div class="table-wrap"><table>
      <thead><tr><th>Realm</th><th class="num">People</th><th class="num">Towns</th><th>Era</th><th></th></tr></thead>
      <tbody>${alive.slice(0, 80).map((p) => `<tr><td>${pLink(p.id)}<div class="muted small">${p.government}${p.wars.size ? ' · <span class="chip crit">war</span>' : ''}</div></td><td class="num">${compact(p.pop)}</td><td class="num">${p.settlementIds.length}</td><td class="small">${polityEra(p).replace(' Age', '')}</td><td><button type="button" class="mini" data-nation="${p.id}" aria-label="Open nation view for ${esc(p.name)}">View</button></td></tr>`).join('')}</tbody>
    </table></div>
    ${wars.length ? `<section><h3>Wars being fought</h3><ul class="plain">${wars.map((w) => `<li><b>${esc(w.name)}</b> <span class="muted">since ${w.start}</span><br>${pLink(w.attacker)} vs ${pLink(w.defender)}</li>`).join('')}</ul></section>` : ''}
    ${fallen.length ? `<section><h3>Fallen realms</h3><ul class="plain">${fallen.slice(0, 20).map((p) => `<li>${pLink(p.id)} <span class="muted">${p.founded}–${p.dissolved}</span></li>`).join('')}</ul></section>` : ''}`;
}

function renderPeoples(): string {
  const st = world.stats[world.stats.length - 1];
  const cultures = world.cultures.filter((c) => c.alive).map((c) => ({ c, pop: 0, n: 0 }));
  const idx = new Map(cultures.map((x) => [x.c.id, x]));
  for (const s of world.aliveSettlements()) {
    const x = idx.get(s.cultureId);
    if (x) {
      x.pop += s.pop;
      x.n++;
    }
  }
  cultures.sort((a, b) => b.pop - a.pop);
  return `
    <header class="head"><h2>Peoples</h2><p class="sub">Races are fixed; cultures are born, drift apart and fade.</p></header>
    <section><h3>Races</h3>${world.races.map((r) => `<div class="race"><span class="dot" style="background:${r.color}"></span><b>${esc(r.plural)}</b><span class="num">${fmt(st.byRace[r.id] ?? 0)}</span><p class="muted small">${esc(r.description)}</p></div>`).join('')}</section>
    <section><h3>Living cultures</h3><div class="table-wrap"><table>
      <thead><tr><th>Culture</th><th class="num">Settled</th><th class="num">Towns</th><th class="num">Wandering</th></tr></thead>
      <tbody>${cultures.map(({ c, pop, n }) => {
        const bands = world.bands.filter((b) => b.alive && b.cultureId === c.id);
        const tribes = new Set(bands.map((b) => b.tribeId)).size;
        const wander = bands.reduce((a, b) => a + b.pop, 0);
        return `<tr><td><span class="dot" style="background:${c.color}"></span>${cLink(c.id)}<div class="muted small">${esc(world.raceById.get(c.raceId)?.plural ?? '')}${c.parentId >= 0 ? ` · from ${esc(world.cultures[c.parentId].name)}` : ''}</div></td><td class="num">${compact(pop)}</td><td class="num">${n}</td><td class="num">${bands.length ? `${compact(wander)}<div class="muted small">${tribes} clan${tribes === 1 ? '' : 's'}, ${bands.length} tribe${bands.length === 1 ? '' : 's'}</div>` : '—'}</td></tr>`;
      }).join('')}</tbody>
    </table></div></section>`;
}

const KINDS: EventKind[] = ['tribe', 'war', 'conquest', 'peace', 'rebellion', 'union', 'nobility', 'diplomacy', 'defection', 'polity', 'government', 'ruler', 'technology', 'culture', 'founding', 'abandonment', 'migration', 'plague', 'famine', 'disaster', 'monster', 'wonder', 'milestone', 'battle', 'army', 'agreement', 'caravan', 'house', 'road'];

function renderChronicleShell(): string {
  return `
    <header class="head"><h2>Chronicle</h2><p class="sub">Everything the world remembers, newest first. Select an entry to find it on the map.</p></header>
    <div class="filters">
      <label for="f-imp">Show</label>
      <select id="f-imp"><option value="3">Major events</option><option value="2">Notable and major</option><option value="1">Everything</option></select>
      <select id="f-kind" aria-label="Event type"><option value="all">All kinds</option>${KINDS.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
      <input id="f-text" type="search" placeholder="Search names…" aria-label="Search the chronicle">
    </div>
    <div class="exports">
      <button id="x-md" type="button">Download chronicle (.md)</button>
      <button id="x-json" type="button">Download world data (.json)</button>
    </div>
    <div id="chronicle-list"></div>`;
}

function renderChronicleList(): void {
  const host = document.getElementById('chronicle-list');
  if (!host) return;
  const text = chronicleFilter.text.toLowerCase();
  const list = world.history.filter((e) => e.importance >= chronicleFilter.importance && (chronicleFilter.kind === 'all' || e.kind === chronicleFilter.kind) && (!text || e.text.toLowerCase().includes(text)));
  host.innerHTML = `<p class="muted small">${fmt(list.length)} entries${list.length > 400 ? ', showing the latest 400' : ''}</p>${eventList(list, 400)}`;
}

function wireChronicle(): void {
  const imp = $<HTMLSelectElement>('f-imp');
  const kind = $<HTMLSelectElement>('f-kind');
  const text = $<HTMLInputElement>('f-text');
  imp.value = String(chronicleFilter.importance);
  kind.value = chronicleFilter.kind;
  text.value = chronicleFilter.text;
  imp.addEventListener('change', () => {
    chronicleFilter.importance = Number(imp.value);
    renderChronicleList();
  });
  kind.addEventListener('change', () => {
    chronicleFilter.kind = kind.value;
    renderChronicleList();
  });
  text.addEventListener('input', () => {
    chronicleFilter.text = text.value;
    renderChronicleList();
  });
  $('x-md').addEventListener('click', () => download(`${cfg.name}-chronicle-year-${world.year}.md`, chronicleMarkdown(world, 2), 'text/markdown'));
  $('x-json').addEventListener('click', () => download(`${cfg.name}-world-year-${world.year}.json`, JSON.stringify(worldSnapshot(world)), 'application/json'));
  renderChronicleList();
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderChartsShell(): string {
  return `<header class="head"><h2>Charts</h2><p class="sub">Sampled every year; realms every five.</p></header><div id="c-race"></div><div id="c-realm"></div><div id="c-coin"></div><div id="c-moving"></div><div id="c-count"></div><div id="c-trade"></div>`;
}

function renderCharts(): void {
  const stats = world.stats;
  const step = Math.max(1, Math.floor(stats.length / 200));
  const sampled = stats.filter((_, i) => i % step === 0 || i === stats.length - 1);
  const raceSeries = world.races.map((r: RaceDef) => ({ name: r.plural, color: r.color, points: sampled.map((s) => [s.year, s.byRace[r.id] ?? 0] as [number, number]) }));
  lineChart($('c-race'), 'Population by race', raceSeries);
  const top = [...world.alivePolities()].sort((a, b) => b.pop - a.pop).slice(0, 6);
  lineChart($('c-realm'), 'Six largest realms', top.map((p) => ({ name: p.name, color: p.color, points: p.popHistory })));
  lineChart($('c-coin'), 'Coin and barter (value traded per year)', [
    { name: 'Barter', color: '#d99152', points: sampled.map((s) => [s.year, s.barterTrade ?? 0] as [number, number]) },
    { name: 'Coin', color: '#2a78d6', points: sampled.map((s) => [s.year, s.coinTrade ?? 0] as [number, number]) },
  ]);
  lineChart($('c-moving'), 'On the move', [
    { name: 'Caravans', color: '#e8b923', points: sampled.map((s) => [s.year, s.caravans ?? 0] as [number, number]) },
    { name: 'Armies', color: '#e34948', points: sampled.map((s) => [s.year, s.armies ?? 0] as [number, number]) },
  ]);
  lineChart($('c-count'), 'Settlements', [{ name: 'Settlements', color: 'var(--accent)', points: sampled.map((s) => [s.year, s.settlements] as [number, number]) }]);
  lineChart($('c-trade'), 'Trade volume (silver per year)', [{ name: 'Trade', color: 'var(--accent-2)', points: sampled.map((s) => [s.year, s.tradeVolume] as [number, number]) }]);
}

function renderSetup(): string {
  const sizeKey = Object.entries(MAP_SIZES).find(([, [w, h]]) => w === cfg.width && h === cfg.height)?.[0] ?? 'medium';
  const num = (id: string, label: string, v: number, min: number, max: number, step: number, hint: string) =>
    `<label class="field" for="${id}"><span>${label} <output id="${id}-o">${v}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${v}"><small>${hint}</small></label>`;
  return `
    <header class="head"><h2>World setup</h2><p class="sub">The same seed and settings always produce the same history.</p></header>
    <form id="setup" class="setup">
      <label class="field" for="s-name"><span>World name</span><input id="s-name" type="text" value="${esc(cfg.name)}" maxlength="40"></label>
      <div class="row">
        <label class="field" for="s-seed"><span>Seed</span><input id="s-seed" type="number" value="${cfg.seed}"></label>
        <button type="button" id="s-reroll">New seed</button>
      </div>
      <label class="field" for="s-size"><span>Map size</span><select id="s-size">${Object.entries(MAP_SIZES).map(([k, [w, h]]) => `<option value="${k}" ${k === sizeKey ? 'selected' : ''}>${k} (${w}×${h})</option>`).join('')}</select></label>
      <label class="field" for="s-start"><span>Peoples begin as</span><select id="s-start"><option value="bands" ${cfg.start !== 'settlements' ? 'selected' : ''}>Wandering clans of hunters and gatherers</option><option value="settlements" ${cfg.start === 'settlements' ? 'selected' : ''}>Settled villages</option></select><small>Each clan's tribes roam until they find good hunting and foraging land, claim it as the clan's hunting grounds and defend it, split as they grow to claim more, fight other clans for land, and settle down when farming or the land makes it pay (each race's lifestyle decides how readily).</small></label>
      ${num('s-land', 'Land', cfg.landFraction, 0.2, 0.75, 0.01, 'Share of the map above sea level.')}
      ${num('s-temp', 'Temperature', cfg.temperature, -0.3, 0.3, 0.02, 'Negative for an ice age, positive for a hothouse.')}
      ${num('s-moist', 'Rainfall', cfg.moisture, -0.3, 0.3, 0.02, 'Drier worlds have more desert and steppe.')}
      <div class="row">
        ${num('s-latn', 'Top edge latitude', cfg.latNorth ?? 90, -90, 90, 1, 'Degrees: 90 is the north pole, 0 the equator.')}
        ${num('s-lats', 'Bottom edge latitude', cfg.latSouth ?? -90, -90, 90, 1, '-90 is the south pole.')}
      </div>
      ${num('s-tilt', 'Axial tilt', cfg.axialTilt ?? 23.5, 0, 60, 0.5, 'Degrees. Earth is 23.5. More tilt: harsher seasons, milder poles, a cooler equator.')}
      <label class="toggle" for="s-currents"><input id="s-currents" type="checkbox" ${cfg.oceanCurrents !== false ? 'checked' : ''}> Ocean currents <small>&nbsp;warm water carried poleward along eastern coasts, cold water towards the equator along western ones</small></label>
      <div class="shape-box">
        <p>${cfg.heightmap ? 'This world’s land was <strong>shaped by hand</strong>.' : 'The land is generated from the seed.'} Paint coasts, raise hills, mountains, peaks and cliffs, and cut valleys.</p>
        <div class="row">
          <button type="button" id="s-shape">Shape the land…</button>
          ${cfg.heightmap ? '<label class="toggle" for="s-keep"><input id="s-keep" type="checkbox" checked> Keep the hand-shaped land</label>' : ''}
        </div>
      </div>
      ${num('s-abund', 'Mineral wealth', cfg.resourceAbundance, 0.3, 2.5, 0.1, 'How rich the ore, gold and gem deposits are.')}
      ${num('s-magic', 'Magic', cfg.magic, 0, 2, 1, '0 none · 1 low · 2 high. Ley lines, arcane techs and monsters.')}
      ${num('s-cal', 'Calamity', cfg.calamity, 0, 3, 0.1, 'Frequency of plagues, disasters and beasts.')}
      ${num('s-space', 'Settlement spacing', cfg.settlementSpacing, 3, 8, 1, 'Minimum tiles between towns. Wider spacing means fewer, larger settlements.')}
      <div class="row">
        <label class="field" for="s-home"><span>Homelands per race</span><input id="s-home" type="number" min="1" max="4" value="${cfg.homelandsPerRace}"></label>
        <label class="field" for="s-tribes"><span>Clans per homeland</span><input id="s-tribes" type="number" min="1" max="8" value="${cfg.tribesPerHomeland}"></label>
      </div>
      <label class="field" for="s-races"><span>Races (JSON)</span><textarea id="s-races" rows="12" spellcheck="false">${esc(JSON.stringify(cfg.races, null, 2))}</textarea><small>Edit traits, biome preferences, growth, sound palettes — or add your own people. Remove an entry to leave that race out.</small></label>
      <p id="s-error" class="error" role="alert" hidden></p>
      <div class="row">
        <button type="submit" class="primary">Generate world</button>
        <button type="button" id="s-reset-races">Restore default races</button>
      </div>
    </form>`;
}

function wireSetup(): void {
  const form = $<HTMLFormElement>('setup');
  for (const id of ['s-land', 's-temp', 's-moist', 's-abund', 's-magic', 's-cal', 's-space', 's-latn', 's-lats', 's-tilt']) {
    const inp = $<HTMLInputElement>(id);
    inp.addEventListener('input', () => ($(id + '-o').textContent = inp.value));
  }
  $('s-reroll').addEventListener('click', () => ($<HTMLInputElement>('s-seed').value = String(Math.floor(Math.random() * 1e6))));
  $('s-reset-races').addEventListener('click', () => ($<HTMLTextAreaElement>('s-races').value = JSON.stringify(DEFAULT_RACES, null, 2)));
  $('s-shape').addEventListener('click', () => {
    const next = readSetup();
    if (next) openEditor(next);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = readSetup();
    if (!next) return;
    cfg = next;
    store.set('config', JSON.stringify(cfg));
    newWorld();
  });
}

/** The settings in the Setup form, or null (with the error shown) if the races can't be read. */
function readSetup(): WorldConfig | null {
  {
    const err = $('s-error');
    let races: RaceDef[];
    try {
      races = JSON.parse($<HTMLTextAreaElement>('s-races').value);
      if (!Array.isArray(races) || races.length === 0) throw new Error('The races list must be a non-empty JSON array.');
      for (const r of races) if (!r.id || !r.phonemes || !r.biomes || !r.relief) throw new Error(`Race "${r.name ?? r.id ?? '?'}" needs at least id, biomes, relief and phonemes.`);
    } catch (x) {
      err.textContent = `Races could not be read: ${(x as Error).message}`;
      err.hidden = false;
      return null;
    }
    err.hidden = true;
    const [w, h] = MAP_SIZES[$<HTMLSelectElement>('s-size').value] ?? MAP_SIZES.medium;
    const v = (id: string) => Number($<HTMLInputElement>(id).value);
    const keep = document.getElementById('s-keep') as HTMLInputElement | null;
    return defaultConfig({
      name: $<HTMLInputElement>('s-name').value.trim() || 'Aerth',
      seed: Math.floor(v('s-seed')) || 1,
      width: w,
      height: h,
      landFraction: v('s-land'),
      temperature: v('s-temp'),
      moisture: v('s-moist'),
      resourceAbundance: v('s-abund'),
      magic: v('s-magic'),
      calamity: v('s-cal'),
      settlementSpacing: v('s-space'),
      start: $<HTMLSelectElement>('s-start').value === 'settlements' ? 'settlements' : 'bands',
      homelandsPerRace: Math.max(1, Math.min(4, Math.floor(v('s-home')))),
      tribesPerHomeland: Math.max(1, Math.min(8, Math.floor(v('s-tribes')))),
      races: races.map((r) => ({ ...DEFAULT_RACES[0], ...r })),
      latNorth: v('s-latn'),
      latSouth: v('s-lats'),
      axialTilt: v('s-tilt'),
      oceanCurrents: $<HTMLInputElement>('s-currents').checked,
      heightmap: keep?.checked ? cfg.heightmap : undefined,
    });
  }
}

// ------------------------------------------------------------------ world editor

function openEditor(base: WorldConfig): void {
  playing = false;
  closeOverlay();
  editing = new WorldEditor(base);
  autoFit = true;
  fitView();
  canvas.classList.add('painting');
  showMapChrome(false);
  drawMap();
  refreshTopbar();
  renderPanel(true);
}

/** The map's layer bar and key belong to the simulation; the editor hides them. */
function showMapChrome(on: boolean): void {
  for (const el of document.querySelectorAll<HTMLElement>('.map-tools, .hint')) el.hidden = !on;
}

function closeEditor(): void {
  editing = null;
  canvas.classList.remove('painting');
  showMapChrome(true);
  autoFit = true;
  fitView();
  drawMap();
  renderPanel(true);
}

function renderEditor(ed: WorldEditor): string {
  const c = ed.cfg;
  const brush = BRUSHES.find((b) => b.id === ed.tool)!;
  const num = (id: string, label: string, v: number, min: number, max: number, step: number, hint = '') =>
    `<label class="field" for="${id}"><span>${label} <output id="${id}-o">${v}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${v}">${hint ? `<small>${hint}</small>` : ''}</label>`;
  const views: [EditorView, string][] = [['terrain', 'Terrain'], ['temperature', 'Temperature'], ['rainfall', 'Rainfall'], ['currents', 'Currents']];
  return `
    <header class="head"><h2>Shape the land</h2><p class="sub">Drag on the map to paint. Right-drag or hold Space to pan, scroll to zoom. [ and ] resize the brush, Ctrl+Z undoes.</p></header>
    <div class="setup">
      <div class="brushes" role="group" aria-label="Brush">${BRUSHES.map((b) => `<button type="button" data-brush="${b.id}" aria-pressed="${b.id === ed.tool}" title="${esc(b.hint)}">${b.name}</button>`).join('')}</div>
      <p class="sub">${esc(brush.hint)}</p>
      ${num('e-size', 'Brush size (tiles)', ed.radius, 1, 40, 1)}
      ${num('e-strength', 'Strength', ed.strength, 0.05, 1, 0.05)}
      <div class="row">
        <button type="button" id="e-undo" ${ed.canUndo() ? '' : 'disabled'}>Undo</button>
        <button type="button" id="e-blank">Blank ocean</button>
        <button type="button" id="e-random">Fresh random land</button>
      </div>
      <h3 class="mini-h">See</h3>
      <div class="seg" role="group" aria-label="Editor view">${views.map(([k, n]) => `<button type="button" data-eview="${k}" aria-pressed="${ed.layer === k}">${n}</button>`).join('')}</div>
      ${ed.layer !== 'terrain' ? `<p class="land-legend">${LAYER_LEGEND[ed.layer] ?? ''}</p>` : ''}
      <h3 class="mini-h">Place on the globe</h3>
      <div class="row">
        ${num('e-latn', 'Top edge', c.latNorth ?? 90, -90, 90, 1)}
        ${num('e-lats', 'Bottom edge', c.latSouth ?? -90, -90, 90, 1)}
      </div>
      ${num('e-tilt', 'Axial tilt', c.axialTilt ?? 23.5, 0, 60, 0.5, 'Earth: 23.5°.')}
      <label class="toggle" for="e-currents"><input id="e-currents" type="checkbox" ${c.oceanCurrents !== false ? 'checked' : ''}> Ocean currents</label>
      <div class="row">
        <button type="button" id="e-use" class="primary">Use this world</button>
        <button type="button" id="e-cancel">Cancel</button>
      </div>
      <p class="sub">Using the world starts a new history on this land, with the other Setup settings as they are.</p>
    </div>`;
}

function wireEditor(ed: WorldEditor): void {
  const redraw = () => {
    drawMap();
    renderPanel(true);
  };
  for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-brush]')) b.addEventListener('click', () => {
    ed.tool = b.dataset.brush as BrushTool;
    renderPanel(true);
  });
  for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-eview]')) b.addEventListener('click', () => {
    ed.setLayer(b.dataset.eview as EditorView);
    redraw();
  });
  const range = (id: string, set: (v: number) => void, live = true) => {
    const inp = $<HTMLInputElement>(id);
    inp.addEventListener('input', () => {
      $(id + '-o').textContent = inp.value;
      if (live) set(Number(inp.value));
    });
    if (!live) inp.addEventListener('change', () => set(Number(inp.value)));
  };
  range('e-size', (v) => (ed.radius = v));
  range('e-strength', (v) => (ed.strength = v));
  range('e-latn', (v) => { ed.setClimate({ latNorth: v }); drawMap(); }, false);
  range('e-lats', (v) => { ed.setClimate({ latSouth: v }); drawMap(); }, false);
  range('e-tilt', (v) => { ed.setClimate({ axialTilt: v }); drawMap(); }, false);
  $<HTMLInputElement>('e-currents').addEventListener('change', (e) => {
    ed.setClimate({ oceanCurrents: (e.target as HTMLInputElement).checked });
    drawMap();
  });
  $('e-undo').addEventListener('click', () => {
    if (ed.undo()) redraw();
  });
  $('e-blank').addEventListener('click', () => {
    ed.blank();
    redraw();
  });
  $('e-random').addEventListener('click', () => {
    ed.generated(Math.floor(Math.random() * 1e6));
    redraw();
  });
  $('e-cancel').addEventListener('click', closeEditor);
  $('e-use').addEventListener('click', () => {
    cfg = { ...ed.cfg, heightmap: ed.heightmap() };
    store.set('config', JSON.stringify(cfg));
    editing = null;
    canvas.classList.remove('painting');
    showMapChrome(true);
    newWorld();
  });
}

function newWorld(): void {
  closeOverlay();
  selectedTech = null;
  playing = false;
  pendingYears = 0;
  world = new World(cfg);
  renderer = newRenderer();
  view.selectedSettlement = -1;
  view.selectedPolity = -1;
  view.selectedTile = -1;
  selectedCulture = -1;
  autoFit = true;
  fitView();
  drawMap();
  refreshTopbar();
  setTab('realms');
}

function renderPanel(full: boolean): void {
  lastPanel = performance.now();
  if (editing) {
    if (full) {
      panel.innerHTML = renderEditor(editing);
      wireEditor(editing);
    }
    return;
  }
  if (tab === 'setup') {
    if (full) {
      panel.innerHTML = renderSetup();
      wireSetup();
    }
    return;
  }
  if (tab === 'chronicle') {
    if (full || !document.getElementById('chronicle-list')) {
      panel.innerHTML = renderChronicleShell();
      wireChronicle();
    } else renderChronicleList();
    return;
  }
  if (tab === 'charts') {
    if (full || !document.getElementById('c-race')) panel.innerHTML = renderChartsShell();
    renderCharts();
    return;
  }
  const scroll = panel.scrollTop;
  if (tab === 'market') {
    panel.innerHTML = renderMarket(world, marketFor, helpers());
    if (!full) panel.scrollTop = scroll;
    return;
  }
  panel.innerHTML = tab === 'inspect' ? renderInspect() : tab === 'realms' ? renderRealms() : renderPeoples();
  if (!full) panel.scrollTop = scroll;
}

// ------------------------------------------------------------------ loop

function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  let years = pendingYears;
  let months = 0;
  if (editing) {
    requestAnimationFrame(frame);
    return;
  }
  if (playing && !realTime) {
    yearAcc += dt * speed;
    const n = Math.floor(yearAcc);
    yearAcc -= n;
    years += n;
  } else if (playing && realTime && pendingYears === 0) {
    monthAcc += (dt * speed) / 5;
    months = Math.floor(monthAcc);
    monthAcc -= months;
  }
  const t0 = performance.now();
  let done = 0;
  while (done < years && performance.now() - t0 < 40) {
    world.tick();
    done++;
  }
  if (pendingYears > 0) pendingYears = Math.max(0, pendingYears - done);
  for (let m = 0; m < months && performance.now() - t0 < 40; m++) {
    world.stepMonth();
    done++;
  }
  // In real time, redraw every frame so marching armies and caravans move smoothly.
  view.frac = playing && realTime ? Math.min(1, monthAcc) : 1;
  if (playing && realTime && done === 0) drawMap();
  if (done > 0) {
    drawMap();
    refreshTopbar();
    if (now - lastPanel > 400) renderPanel(false);
    if (overlay && now - lastOverlay > 1000) renderOverlay(false);
  }
  requestAnimationFrame(frame);
}

new ResizeObserver(resizeCanvas).observe(canvas);
$('realtime').setAttribute('aria-pressed', String(realTime));
speedLabel();
fitView();
resizeCanvas();
refreshTopbar();
setTab(tab);
requestAnimationFrame(frame);
