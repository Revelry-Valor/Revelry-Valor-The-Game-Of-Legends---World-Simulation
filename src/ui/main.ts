import './styles.css';
import { chronicleMarkdown, describeValues, fmt, polityEra, settlementTier, worldSnapshot } from '../engine/chronicle';
import { MAP_SIZES, defaultConfig } from '../engine/config';
import { BIOMES } from '../engine/data/biomes';
import { GOOD_NAMES, RES_COUNT, RES_NAMES, Res, SECTOR_NAMES } from '../engine/data/economy';
import { DEFAULT_RACES } from '../engine/data/races';
import { ERA_NAMES, TECHS, TECH_BY_ID } from '../engine/data/techs';
import type { EventKind, HistoryEvent, RaceDef, WorldConfig } from '../engine/types';
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

type Tab = 'inspect' | 'market' | 'realms' | 'peoples' | 'chronicle' | 'charts' | 'setup';

const MONTHS = ['Deepwinter', 'Thawing', 'Seedtime', 'Rainmoon', 'Bloomtide', 'Highsun', 'Midsummer', 'Harvest', 'Leaffall', 'Mistmoon', 'Frostfall', 'Longnight'];
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
let renderer = new MapRenderer(world);
let tab: Tab = (store.get('tab') as Tab) || 'inspect';
let playing = false;
let speed = 10;
/** Real time: the world advances month by month and armies and caravans glide between positions. */
let realTime = false;
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

const view: ViewState = {
  layer: 'political',
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
  view.zoom = Math.max(1, Math.min(r.width / world.map.width, r.height / world.map.height));
  view.ox = (world.map.width - r.width / view.zoom) / 2;
  view.oy = (world.map.height - r.height / view.zoom) / 2;
}

function ink() {
  const cs = getComputedStyle(document.documentElement);
  return { text: cs.getPropertyValue('--map-label').trim(), halo: cs.getPropertyValue('--map-halo').trim(), accent: cs.getPropertyValue('--accent').trim() };
}

function drawMap(): void {
  renderer.draw(canvas, view, ink());
}

function centerOn(x: number, y: number): void {
  autoFit = false;
  const r = canvas.getBoundingClientRect();
  view.zoom = Math.max(view.zoom, 6);
  view.ox = x + 0.5 - r.width / view.zoom / 2;
  view.oy = y + 0.5 - r.height / view.zoom / 2;
}

let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
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
    const d = Math.hypot(s.x + 0.5 - wx, s.y + 0.5 - wy);
    if (d < bd) {
      bd = d;
      best = s.id;
    }
  }
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  view.selectedTile = tx >= 0 && ty >= 0 && tx < world.map.width && ty < world.map.height ? ty * world.map.width + tx : -1;
  view.selectedSettlement = best;
  if (best >= 0) marketFor = best;
  view.selectedPolity = best >= 0 ? world.settlements[best].polityId : -1;
  selectedCulture = -1;
  if (best < 0 && view.selectedTile >= 0) {
    const o = world.map.owner[view.selectedTile];
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
  $('year').textContent = realTime || world.month > 0 ? `Year ${world.year}, ${MONTHS[world.month]}` : `Year ${world.year}`;
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

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
  btn.addEventListener('click', () => {
    view.layer = btn.dataset.layer as MapLayer;
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) b.setAttribute('aria-pressed', String(b === btn));
    $('resource-pick').hidden = view.layer !== 'resource';
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
      <span><i class="sw known"></i>Known</span><span><i class="sw researching"></i>Researching</span><span><i class="sw available"></i>Can research</span>
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
  if (view.selectedSettlement >= 0) return renderSettlement(view.selectedSettlement);
  if (view.selectedPolity >= 0) return renderPolity(view.selectedPolity) + (view.selectedTile >= 0 ? renderTile(view.selectedTile) : '');
  if (view.selectedTile >= 0) return renderTile(view.selectedTile);
  return `<div class="empty"><h2>Nothing selected</h2><p>Click a settlement or any stretch of land on the map to inspect it. Settlements marked with a diamond are capitals.</p><p>Press <b>Play</b> or add years to watch peoples spread, trade, invent and wage war.</p></div>`;
}

function renderSettlement(id: number): string {
  const s = world.settlements[id];
  const p = world.polities[s.polityId];
  const races = Object.entries(s.races).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]);
  const top = (arr: Float64Array) => [...arr].map((q, g) => [g, q] as const).filter(([, q]) => q > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const labor = [...s.labor].map((l, k) => [k, l] as const).filter(([, l]) => l > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalLabor = labor.reduce((a, [, l]) => a + l, 0) || 1;
  const events = world.history.filter((e) => e.settlements?.includes(id));
  const allLinks = [...s.links.map((li) => world.links[li]), ...world.hubLinks.filter((l) => l.a === id || l.b === id)];
  const partners = allLinks.map((l) => ({ o: l.a === id ? l.b : l.a, v: l.volume, sea: l.sea, kind: l.kind, hub: !!l.hub })).filter((x) => world.settlements[x.o].alive && x.kind === 'internal').sort((a, b) => b.v - a.v);
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
      <p class="small"><span class="k">Held by</span> ${s.holder >= 0 && world.nobles[s.holder] ? `${esc(world.nobles[s.holder].name)}${world.nobles[s.holder].seatId === s.id ? ' (its seat)' : ''}` : 'the crown'} · <span class="k">Since</span> year ${s.heldSince}</p>
      ${!s.connected ? `<p class="small"><span class="chip crit">cut off</span> No road to the capital for ${s.cutOff} year${s.cutOff === 1 ? '' : 's'}${s.loyalty < 0.35 ? '; its people are thinking of changing sides' : '; it holds out'}.</p>` : ''}
      ${s.surrounded > 0.4 ? `<p class="small"><span class="chip warn">surrounded</span> ${pct(s.surrounded)} of the land around it is held by hostile powers.</p>` : ''}
      ${Object.keys(s.claims).length ? `<p class="small"><span class="k">Claimed by</span> ${Object.entries(s.claims).map(([q, y]) => `${pLink(+q)} <span class="muted">(lost it in ${y})</span>`).join(', ')}</p>` : ''}
    </section>` : ''}
    ${races.length ? `<section><h3>Peoples</h3>${races.map(([r, n]) => meter(esc(world.raceById.get(r)?.plural ?? r), n / Math.max(1, s.pop))).join('')}</section>` : ''}
    ${s.alive ? `<section><h3>Economy</h3>
      <p><span class="k">Work</span> ${labor.map(([k, l]) => `${SECTOR_NAMES[k]} ${pct(l / totalLabor)}`).join(' · ') || '—'}</p>
      <p><span class="k">Exports</span> ${top(s.exported).map(([g]) => GOOD_NAMES[g]).join(', ') || '—'}</p>
      <p><span class="k">Imports</span> ${top(s.imported).map(([g]) => GOOD_NAMES[g]).join(', ') || '—'}</p>
      <p><span class="k">Tools</span> ${['stone', 'copper', 'bronze', 'iron', 'steel'][Math.round(s.toolQuality)]} · <span class="k">Arms</span> ${['stone', 'copper', 'bronze', 'iron', 'steel'][Math.round(s.weaponQuality)]}</p>
    </section>
    <section><h3>Trade</h3>
      <p class="small"><span class="k">Internal</span> ${compact(s.tradeByKind.internal)} · <span class="k">Caravans</span> ${compact(s.tradeByKind.caravan)} · <span class="k">Convoys</span> ${compact(s.tradeByKind.convoy)} · <span class="k">Passing</span> ${compact(s.transit)} <span class="muted">silver/yr</span></p>
      <p class="small"><span class="k">Road</span> ${road ? ROAD_NAMES[road] : 'No road yet'} · <button type="button" class="mini" data-market="${id}">Open market</button></p>
      ${partners.length ? `<h4 class="mini-h">Trading neighbours in the realm</h4><ul class="plain">${partners.slice(0, 6).map((x) => `<li>${sLink(x.o)} <span class="chip">${x.hub ? 'road to hub' : 'internal'}</span> <span class="muted small">${x.sea ? 'by sea' : 'overland'} · ${compact(x.v)}/yr</span></li>`).join('')}</ul>` : '<p class="muted small">No trading neighbours in its own realm.</p>'}
      ${houses.length ? `<p class="small">Home of ${houses.map((h) => `<b>${esc(h.name)}</b> <span class="muted">(${compact(h.wealth)} silver, ${h.trips} ventures)</span>`).join(', ')}.</p>` : ''}
      ${caravans.length ? `<h4 class="mini-h">On the road</h4><ul class="plain small">${caravans.map((c) => `<li><span class="swatch-dot" style="background:${CARAVAN_COLOR[c.kind]}"></span>${CARAVAN_KIND[c.kind]} (${c.size} beasts) ${c.returning ? 'coming home from' : 'bound for'} ${sLink(c.returning ? c.fromId : c.toId)}${c.cargo.length ? ` with ${c.cargo.map((x) => `${Math.round(x.qty)} ${GOOD_NAMES[x.good].toLowerCase()}`).join(', ')}` : ', empty'}</li>`).join('')}</ul>` : ''}
    </section>` : ''}
    ${s.greatWorks.length ? `<section><h3>Great works</h3><p>${s.greatWorks.map(esc).join(' · ')}</p></section>` : ''}
    <section><h3>Local history</h3>${eventList(events, 15)}</section>`;
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
      <div><dt>Researching</dt><dd>${researching ? esc(researching) : '—'}</dd></div>
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
        <div><dt>Worked by</dt><dd>${o >= 0 ? sLink(o) : 'no one'}</dd></div>
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
      <thead><tr><th>Culture</th><th class="num">People</th><th class="num">Towns</th></tr></thead>
      <tbody>${cultures.map(({ c, pop, n }) => `<tr><td><span class="dot" style="background:${c.color}"></span>${cLink(c.id)}<div class="muted small">${esc(world.raceById.get(c.raceId)?.plural ?? '')}${c.parentId >= 0 ? ` · from ${esc(world.cultures[c.parentId].name)}` : ''}</div></td><td class="num">${compact(pop)}</td><td class="num">${n}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
}

const KINDS: EventKind[] = ['war', 'conquest', 'peace', 'rebellion', 'union', 'nobility', 'diplomacy', 'defection', 'polity', 'government', 'ruler', 'technology', 'culture', 'founding', 'abandonment', 'migration', 'plague', 'famine', 'disaster', 'monster', 'wonder', 'milestone', 'battle', 'army', 'agreement', 'caravan', 'house', 'road'];

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
      ${num('s-land', 'Land', cfg.landFraction, 0.2, 0.75, 0.01, 'Share of the map above sea level.')}
      ${num('s-temp', 'Temperature', cfg.temperature, -0.3, 0.3, 0.02, 'Negative for an ice age, positive for a hothouse.')}
      ${num('s-moist', 'Rainfall', cfg.moisture, -0.3, 0.3, 0.02, 'Drier worlds have more desert and steppe.')}
      ${num('s-abund', 'Mineral wealth', cfg.resourceAbundance, 0.3, 2.5, 0.1, 'How rich the ore, gold and gem deposits are.')}
      ${num('s-magic', 'Magic', cfg.magic, 0, 2, 1, '0 none · 1 low · 2 high. Ley lines, arcane techs and monsters.')}
      ${num('s-cal', 'Calamity', cfg.calamity, 0, 3, 0.1, 'Frequency of plagues, disasters and beasts.')}
      ${num('s-space', 'Settlement spacing', cfg.settlementSpacing, 3, 8, 1, 'Minimum tiles between towns. Wider spacing means fewer, larger settlements.')}
      <div class="row">
        <label class="field" for="s-home"><span>Homelands per race</span><input id="s-home" type="number" min="1" max="4" value="${cfg.homelandsPerRace}"></label>
        <label class="field" for="s-tribes"><span>Tribes per homeland</span><input id="s-tribes" type="number" min="1" max="8" value="${cfg.tribesPerHomeland}"></label>
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
  for (const id of ['s-land', 's-temp', 's-moist', 's-abund', 's-magic', 's-cal', 's-space']) {
    const inp = $<HTMLInputElement>(id);
    inp.addEventListener('input', () => ($(id + '-o').textContent = inp.value));
  }
  $('s-reroll').addEventListener('click', () => ($<HTMLInputElement>('s-seed').value = String(Math.floor(Math.random() * 1e6))));
  $('s-reset-races').addEventListener('click', () => ($<HTMLTextAreaElement>('s-races').value = JSON.stringify(DEFAULT_RACES, null, 2)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('s-error');
    let races: RaceDef[];
    try {
      races = JSON.parse($<HTMLTextAreaElement>('s-races').value);
      if (!Array.isArray(races) || races.length === 0) throw new Error('The races list must be a non-empty JSON array.');
      for (const r of races) if (!r.id || !r.phonemes || !r.biomes || !r.relief) throw new Error(`Race "${r.name ?? r.id ?? '?'}" needs at least id, biomes, relief and phonemes.`);
    } catch (x) {
      err.textContent = `Races could not be read: ${(x as Error).message}`;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    const [w, h] = MAP_SIZES[$<HTMLSelectElement>('s-size').value] ?? MAP_SIZES.medium;
    const v = (id: string) => Number($<HTMLInputElement>(id).value);
    cfg = defaultConfig({
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
      homelandsPerRace: Math.max(1, Math.min(4, Math.floor(v('s-home')))),
      tribesPerHomeland: Math.max(1, Math.min(8, Math.floor(v('s-tribes')))),
      races: races.map((r) => ({ ...DEFAULT_RACES[0], ...r })),
    });
    store.set('config', JSON.stringify(cfg));
    newWorld();
  });
}

function newWorld(): void {
  closeOverlay();
  selectedTech = null;
  playing = false;
  pendingYears = 0;
  world = new World(cfg);
  renderer = new MapRenderer(world);
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
fitView();
resizeCanvas();
refreshTopbar();
setTab(tab);
requestAnimationFrame(frame);
