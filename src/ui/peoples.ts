import type { Climate } from '../core/climate';
import { raceMissing, type Library } from '../core/library';
import type { Surface } from '../core/paint';
import type { World } from '../core/world';
import { attachLandAt, buildEnv, landCell, type Env } from '../sim/env';
import { attraction, hardBirths, hardDeaths, provinceAttraction, provinceLiving, type Attraction } from '../sim/attraction';
import { RAIN_NAMES, rainClass } from '../core/climate';
import { packSim, unpackSim, type PackedSim } from '../sim/pack';
import { isFood, NEEDS, resInfoOf } from '../sim/economy';
import { baseWorth } from '../sim/trade';
import { bestWay, buildCost, knows, WAYS } from '../sim/ways';
import { addDawnCity, addTribe, populateProvince, attractionFor, wantsOf, clanLand, eligibleRaces, log, moveSettlement, moveTribe, newSim, placeStart, raceInfo, removeSettlement, removeTribe, settlementTier, stepDays, techOutlook } from '../sim/sim';
import { clanKnows, hasArchive, keepers } from '../sim/tech';
import { ALL_FOOD_TECH, foodTechFrom, provinceFood, provinceLand } from '../sim/food';
import { farmLayer, villagesOf } from '../sim/rural';
import { drawsFood, farmShareOf, surplusGoesTo } from '../sim/catchment';
import { FARM_SHARE, INNER_RING_KM, MARKET, ringOf, tierName, tierOf, TOWN_FIELDS_KM } from '../sim/tiers';
import { cultureOf, localText, MAX_TRADITIONS } from '../sim/culture';
import { acceptance, acceptanceWord, cultureColour } from '../sim/cultureChange';
import { familyOf } from '../sim/sister';
import { coreDistanceOf, stageOf } from '../sim/drift';
import { identitySummary, STANCE_WORDS } from '../sim/identity';
import { snapshotAt } from '../sim/history';
import { openTimeline } from './timeline';
import { langName, languageOf, speakers, speechOf } from '../sim/languages';
import { bundleOf, familyName, levelOf, similarity, TRAITS, treeNearness } from '../sim/traits';
import type { Army, Battle, Clan, LiveCulture, LiveFaith, LiveLanguage, War } from '../sim/state';
import type { Pop } from '../sim/pops';
import { kindName, total, UNIT_KINDS } from '../sim/battle';
import { govOf, preferredGov, realmName, rulerTitle } from '../sim/nations';
import { opinionWord, PACT_NAMES } from '../sim/politics';
import { faithColour, faithOf, ORGANIZATION_WORDS, realmFaith } from '../sim/faith';
import { activeWars, overlordOf, REASON_WORDS, sideOf, vassalsOf, WALL_NAMES, wallLevel, warOutlook, type WarContext } from '../sim/wars';
import { cultureFx } from '../sim/culture';
import { techTiers } from '../core/library';
import { dateText, DAYS_PER_MONTH, monthOf, northernSummer, yearOf, type Settlement, type SetupRow, type SimState, type StartKind, type Tribe } from '../sim/state';
import { choice, h, numberField, toast } from './dom';
import type { MapOverlay } from './mapview';
import { holder, isOcc, occ, OUTSIDE, SEA, UNCLAIMED } from './borders';
import { assembleRings } from '../core/trace';
import type { ProvinceMap } from '../core/provinces';
import { attachProvinces, bindProvinces, PK, provAt, provincesNear } from '../sim/land';
import { manaAtPlace, manaLinesNow, manaNow } from '../sim/mana';
import { CORRUPTION_RIFT, HOLD_NAMES, type Rift } from '../sim/rifts';
import { buildLayerLand, LAYER_NAMES } from '../sim/layers';
import { densityAt, totalsOver } from '../sim/density';
import type { LayerProvs } from '../sim/layerprovs';
import { tideAt, type Horde } from '../sim/monsters';
import { manaWord } from '../core/mana';
import type { ManaState } from './mana';
import type { InfoItem, ResourceView } from './info';

/** Trade routes running along one way that make it a great trade artery (drawn gold edged in blue). */
const ARTERY = 3;

/**
 * The Peoples tab (Phase 6): choosing which races take part and placing their first tribes
 * (automatically, then moved, added or removed by hand), the time bar to run the world on, and
 * the map's layers for them: each clan's land, the tribes and their warbands, and where the
 * beasts are.
 */
export interface PeoplesDeps {
  world(): World;
  library(): Library;
  climate(): Climate | null;
  surface(): Surface;
  redraw(): void;
  changed(): void;
  /** Turn the map to a season (1 northern summer, −1 northern winter). */
  setSeason(season: 1 | -1): void;
  openLibrary(): void;
  /** Whether the climate is being worked out again (the land the peoples see may be out of date). */
  climateBusy(): boolean;
  /** The selected settlement or realm changed (or what it holds did). */
  selectionChanged?(): void;
  /** Open the Peoples tab (to show what the hand tool picked). */
  openPeoples?(): void;
  /** The wilderness density to show: 'off', 'total', or a race id. */
  density?(): string;
  /** Show the map's cultures (the population heat map's Cultures choice). */
  showCultures?(): void;
  /** The race whose attraction the map shows ('off' or a race id). */
  attraction?(): string;
  /** The other layers' provinces, as far as they have been made (the peoples hold them too). */
  layerProvinces?(): LayerProvs;
  /** The provinces (the peoples hold land by province), and opening the Provinces tab to make them. */
  provinces(): ProvinceMap | null;
  openProvinces?(): void;
}

export interface Peoples {
  panel: HTMLElement;
  /** Open the history of peoples (the timeline panel). */
  openHistory(): void;
  bar: HTMLElement;
  overlay: MapOverlay;
  /** Whether the Peoples tab is open (the map's presses go to the peoples then). */
  setActive(on: boolean): void;
  /** The provinces were made, updated or removed. */
  provincesChanged(): void;
  /** The mana as the living peoples have it (their nodes added), or null when there are none. */
  manaState(): ManaState | null;
  /** What the peoples have in a province (by its index): holder, settlements, people, culture, faith, resources, roads. */
  provinceInfo(index: number): InfoItem[];
  climateChanged(): void;
  /** The simulation packed for saving (null if there is none). */
  pack(): PackedSim | null;
  /** The live simulation, for the other layers' views (their towns, tunnels and drifting islands); null when none. */
  live(): SimState | null;
  /** The races living in the wild (for the density map's choice). */
  densityRaces(): { id: string; name: string }[];
  /** Every race the simulation can use (for the Attraction view's choice). */
  attractionRaces(): { id: string; name: string }[];
  /** The selected settlement's or realm's resources (for the resource panel), or null. */
  resources(): ResourceView | null;
  dispose(): void;
}

const SPEEDS = [
  { value: '1', label: 'Day', days: 1 },
  { value: '7', label: 'Week', days: 7 },
  { value: '30', label: 'Month', days: 30 },
  { value: '360', label: 'Year', days: 360 },
];
const SQ_MI = 0.386102;
const SQ_KM_PER_SQ_MI = 2.589988;
const perSqMi = (v: number) => (v >= 10 ? Math.round(v).toLocaleString() : v >= 1 ? v.toFixed(1) : v.toFixed(2));
/** People per square mile at which the density map is fullest (it grades on a log scale below). */
const DENSITY_TOP = 20;
/** And below which it shows nothing. */
const DENSITY_FLOOR = 0.005;
/** A place's attraction for a race, part by part (attraction.ts). */
function attractionText(a: Attraction): string {
  const n = (v: number) => v.toFixed(2);
  if (a.off) return `off limits: ${a.off}`;
  const pulls = [`food ${n(a.food)}`, a.prefer ? `preferences ${a.prefer > 0 ? '+' : ''}${n(a.prefer)}` : '', a.resources ? `resources +${n(a.resources)}` : '', a.trade ? `trade +${n(a.trade)}` : '', a.mana ? `mana ${a.mana > 0 ? '+' : ''}${n(a.mana)}` : ''].filter(Boolean).join(' + ');
  return `${n(a.score)} = water ${n(a.water)} (${a.waterWhy}) × climate ${n(a.climate)}${a.harsh.length ? ` (${a.harsh.join(', ')})` : ''} × (${pulls})`;
}
/** The heat map's colour for so many people per square mile (null: too few to show): pale yellow through orange and red to deep purple, on a log scale. */
function densityColour(per: number): string | null {
  if (per < DENSITY_FLOOR) return null;
  const ramp = [[255, 238, 150], [250, 160, 60], [220, 60, 50], [110, 20, 90]];
  const t = Math.max(0, Math.min(0.999, Math.log(per / DENSITY_FLOOR) / Math.log(DENSITY_TOP / DENSITY_FLOOR)));
  const sc = t * (ramp.length - 1);
  const i = Math.floor(sc);
  const f = sc - i;
  const c = ramp[i].map((x, q) => Math.round(x + (ramp[i + 1][q] - x) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${((110 + 130 * t) / 255).toFixed(3)})`;
}
/** The food map's colour for so many people a square mile the land could feed: brown (poor) through yellow to deep green (rich), to about 155 a square mile (60 a km²). */
function foodColour(perSqMi: number): string | null {
  if (perSqMi < 0.5) return null;
  const ramp = [[150, 100, 60], [225, 200, 90], [140, 190, 80], [30, 110, 50]];
  const t = Math.max(0, Math.min(0.999, perSqMi / 155));
  const sc = t * (ramp.length - 1);
  const i = Math.floor(sc);
  const f = sc - i;
  const c = ramp[i].map((x, q) => Math.round(x + (ramp[i + 1][q] - x) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},0.72)`;
}
/**
 * The population of each province, per square mile: the families living in the wild there, and
 * the people of its villages, towns and tribes (everyone, or one race).
 */
function provincePopulation(s: SimState, e: Env, which: string): Float32Array {
  const P = e.prov;
  const people = new Float32Array(P.count);
  const maps = which === 'total' ? Object.values(s.density ?? {}) : s.density?.[which] ? [s.density[which]] : [];
  for (let p = 0; p < P.count; p++) for (let q = P.start[p]; q < P.start[p + 1]; q++) for (const D of maps) people[p] += D[P.cells[q]] ?? 0;
  const mine = (race: string) => which === 'total' || race === which;
  for (const st of s.settlements) {
    if (st.ruined || st.layer || !mine(st.race)) continue;
    const p = provAt(e, st.x, st.y);
    if (p >= 0) people[p] += st.pop;
  }
  for (const t of s.tribes) {
    if (!mine(t.race)) continue;
    const p = provAt(e, t.x, t.y);
    if (p >= 0) people[p] += t.pop;
  }
  for (let p = 0; p < P.count; p++) people[p] = P.area[p] > 0 ? (people[p] / P.area[p]) * SQ_KM_PER_SQ_MI : 0;
  return people;
}
/** Who lives in each province, by culture: its wild folk and the pops of its settlements and tribes (people). */
function provinceCultures(s: SimState, e: Env): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const add = (p: number, culture: string, n: number) => {
    if (p < 0 || n <= 0 || !culture) return;
    let m = out.get(p);
    if (!m) out.set(p, (m = new Map()));
    m.set(culture, (m.get(culture) ?? 0) + n);
  };
  const P = e.prov;
  for (let p = 0; p < P.count; p++) for (const q of s.country?.[String(P.ids[p])] ?? []) add(p, q.culture, q.n);
  const holder = (x: number, y: number, culture: string, pop: number, pops?: Pop[]) => {
    const p = provAt(e, x, y);
    if (pops?.length) for (const q of pops) add(p, q.culture, q.n);
    else add(p, culture, pop);
  };
  for (const st of s.settlements) if (!st.ruined && !st.layer) holder(st.x, st.y, st.culture, st.pop, st.pops);
  for (const t of s.tribes) holder(t.x, t.y, t.culture, t.pop, t.pops);
  return out;
}
/** A province's colour on the map of cultures: its cultures' colours blended by their shares (null: nobody). */
function cultureFill(s: SimState, by: Map<string, number> | undefined): string | null {
  if (!by) return null;
  let all = 0;
  const rgb = [0, 0, 0];
  for (const [id, n] of by) {
    const cu = cultureOf(s, id);
    if (!cu) continue;
    const hex = cultureColour(s, cu).replace('#', '');
    for (let i = 0; i < 3; i++) rgb[i] += parseInt(hex.slice(i * 2, i * 2 + 2), 16) * n;
    all += n;
  }
  if (all <= 0) return null;
  return `rgba(${rgb.map((v) => Math.round(v / all)).join(',')},0.6)`;
}
/** The wilderness density as a picture over the climate grid (for a world without provinces yet). */
function drawDensity(s: SimState, e: Env, which: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = e.w;
  cv.height = e.h;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(e.w, e.h);
  const maps = which === 'total' ? Object.values(s.density ?? {}) : s.density?.[which] ? [s.density[which]] : [];
  const ramp = [[255, 238, 150], [250, 160, 60], [220, 60, 50], [110, 20, 90]];
  for (let k = 0; k < e.n; k++) {
    let v = 0;
    for (const D of maps) v += D[k];
    const per = (v / e.cellArea) * SQ_KM_PER_SQ_MI;
    if (per < DENSITY_FLOOR) continue;
    // Log scale from DENSITY_FLOOR to DENSITY_TOP people per sq mi.
    const t = Math.max(0, Math.min(0.999, Math.log(per / DENSITY_FLOOR) / Math.log(DENSITY_TOP / DENSITY_FLOOR)));
    const sc = t * (ramp.length - 1);
    const i = Math.floor(sc);
    const f = sc - i;
    const c = ramp[i].map((x, q) => x + (ramp[i + 1][q] - x) * f);
    img.data.set([c[0], c[1], c[2], Math.round(110 + 130 * t)], k * 4);
  }
  g.putImageData(img, 0, 0);
  return cv;
}

export function createPeoples(d: PeoplesDeps): Peoples {
  /** The day the history of peoples is scrubbed to (the map's cultures as they were), or null. */
  let historyDay: number | null = null;
  let env: Env | null = null;
  let sim: SimState | null = null;
  let pending: PackedSim | null = d.world().sim ?? null;
  let gridProblem = false;
  let active = false;
  let selected: number | null = null;
  /** The realm (clan id) whose card is open, and the battle whose report is open. */
  let selectedRealm: number | null = null;
  let selectedBattle: number | null = null;
  let mode: 'select' | 'add' = 'select';
  let addRace = '';
  let addWhat: 'tribe' | 'dawn' | 'people' = 'tribe';
  /** The population brush: people per province, whose people they are, the provinces painted this stroke, and a count of changes (for the heat map). */
  let addPeople = 500;
  let addPeopleClan: 'nearest' | 'selected' = 'nearest';
  let painting: Set<number> | null = null;
  let paintRev = 0;
  let addClan: 'new' | 'selected' = 'new';
  let showLand = true;
  let showBeast = '';
  let showRes = '';
  let showTrade = true;
  let showWays = true;
  let landsBy: 'clan' | 'culture' | 'faith' = 'clan';
  let resDirty = true;
  let densityImg: HTMLCanvasElement | null = null;
  let densityFills: (string | null)[] = [];
  let attractFills: (string | null)[] = [];
  let attractPaths: Path2D[] = [];
  let attractPathsFor: unknown = null;
  let attractKey = '';
  let attractEnv: Env | null = null;
  let densityPaths: Path2D[] = [];
  let densityPathsFor: unknown = null;
  let densityKey = "";
  /** The population brush on a province (once a stroke): set its people of the chosen race. */
  const paintAt = (x: number, y: number) => {
    if (!painting || !ready()) return;
    const s = sim!;
    const e = env!;
    const p = provAt(e, x, y);
    if (p < 0 || painting.has(p)) return;
    painting.add(p);
    if (e.prov.kind[p] !== 0) return;
    // Whose people: the nearest clan of the race (by its towns and tribes), or the selected one's.
    let clan = -1;
    if (addPeopleClan === 'selected') clan = s.tribes.find((t) => t.id === selected)?.clan ?? s.settlements.find((q) => q.id === selected)?.clan ?? -1;
    else {
      let best = Infinity;
      for (const q of [...s.settlements.filter((st) => !st.ruined), ...s.tribes]) {
        if (q.race !== addRace) continue;
        const dd = Math.hypot(q.x - x, q.y - y);
        if (dd < best) [best, clan] = [dd, q.clan];
      }
    }
    if (addPeople > 0 && clan < 0) {
      painting.clear();
      toast(addPeopleClan === 'selected' ? 'Select a tribe or town first: its clan’s people are the ones added.' : `Place a tribe or dawn city of the ${raceName(addRace)} first: the people added are its clan’s.`);
      painting = null;
      return;
    }
    if (populateProvince(s, e, lib(), addRace, p, addPeople, clan)) {
      paintRev++;
      landDirty = true;
      d.redraw();
    } else if (addPeople > 0 && !warned) {
      warned = true;
      toast(`The ${raceName(addRace)} can’t live in that province (its climate or ground is against them, per the Library).`);
    }
  };
  let warned = false;
  let resImg: HTMLCanvasElement | null = null;
  let follow = true;
  let playing = false;
  let speed = 30;
  let busy = false;
  let pxKm = 1;
  const draft = new Map<string, SetupRow>();
  /** Anyone left: tribes, or people in settlements. */
  const alive = () => !!sim && (sim.tribes.length > 0 || sim.settlements.some((q) => !q.ruined));

  const lib = () => d.library();
  const cl = () => d.climate();

  // ---------------------------------------------------------------------------------------------
  // The environment and the state

  /**
   * The other layers' land, read again when their painting changed (painting the Underdark, the
   * sky or the trees leaves the surface's climate, and so the rest of the environment, alone).
   */
  let layersFor: unknown = null;
  const freshLayers = () => {
    const c = cl();
    const strokes = d.surface().strokes;
    if (env) env.layerProv = d.layerProvinces?.();
    if (!env || !c || layersFor === strokes) return;
    env.layers = buildLayerLand(d.surface(), c);
    layersFor = strokes;
  };
  const climateChanged = () => {
    const c = cl();
    if (!c) return;
    env = buildEnv(c, lib(), d.surface(), d.provinces());
    // The painted land itself, so towns can stand right on the coast (as painted now).
    const ws = d.world().settings;
    attachLandAt(env, () => d.surface(), ws.seed, ws.edges === 'wrap' ? ws.widthKm : 0);
    layersFor = d.surface().strokes;
    if (!sim && pending) {
      sim = unpackSim(pending, env);
      if (!sim) {
        gridProblem = true;
        toast('The saved peoples were made on a map of another size; they could not be brought back. Start them again in the Peoples tab.');
      }
      pending = null;
    }
    if (sim && (sim.w !== env.w || sim.h !== env.h)) gridProblem = true;
    if (sim && !gridProblem) {
      bindProvinces(sim, env);
      // Beasts added to the library since: they start at home in their land.
      for (const b of env.beastInfo) if (!sim.beasts[b.id]) sim.beasts[b.id] = Float32Array.from(env.beastK[b.id], (v) => v * 0.9);
    }
    if (!sim) sim = newSim(env, d.world().settings.seed);
    landDirty = beastDirty = true;
    render();
    d.redraw();
  };
  const ready = () => !!(env && sim && !gridProblem && env.prov.real);
  /** New or updated provinces: the land is held by them from now on (each province's holder kept by its id). */
  const provincesChanged = () => {
    if (!env) return;
    attachProvinces(env, d.provinces());
    if (sim && !gridProblem) bindProvinces(sim, env);
    landDirty = true;
    render();
    d.redraw();
  };
  const cellOf = (x: number, y: number) => {
    if (!env) return -1;
    let i = Math.round((x - env.x0) / env.step);
    const j = Math.round((y - env.y0) / env.step);
    if (j < 0 || j >= env.h) return -1;
    if (i < 0 || i >= env.w) {
      if (!env.wrapKm) return -1;
      i = ((i % env.w) + env.w) % env.w;
    }
    return j * env.w + i;
  };
  const clanOf = (id: number) => sim?.clans.find((c) => c.id === id);
  const raceName = (id: string) => {
    for (const s of lib().species) {
      const r = s.races.find((q) => q.id === id);
      if (r) return r.name === s.name ? r.name : `${r.name} (${s.name})`;
    }
    return id;
  };

  // ---------------------------------------------------------------------------------------------
  // Running

  let frame = 0;
  let last = 0;
  let acc = 0;
  let lastSeason = 0;
  let panelTimer = 0;
  const afterStep = () => {
    if (!sim) return;
    landDirty = beastDirty = true;
    if (selected !== null && !sim.tribes.some((t) => t.id === selected) && !sim.settlements.some((q) => q.id === selected)) selected = null;
    const season = northernSummer(sim.day) ? 1 : -1;
    if (follow && season !== lastSeason && !(playing && speed >= 360)) d.setSeason(season);
    lastSeason = season;
    d.changed();
    d.redraw();
    updateBar();
    if (!panelTimer) panelTimer = window.setTimeout(() => {
      panelTimer = 0;
      render();
    }, 300);
  };
  const tick = (now: number) => {
    if (!playing || !sim || !env) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt * speed;
    const n = Math.floor(acc);
    if (n > 0) {
      acc -= n;
      sim.gods = d.world().settings.gods ?? { active: true, activity: 50 };
      freshLayers();
      stepDays(sim, env, lib(), n);
      afterStep();
      if (!alive()) {
        playing = false;
        toast('No peoples are left.');
        updateBar();
        return;
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const play = (on: boolean) => {
    if (!ready() || !alive()) {
      playing = false;
      updateBar();
      return;
    }
    playing = on;
    cancelAnimationFrame(frame);
    if (on) {
      last = performance.now();
      acc = 0;
      frame = requestAnimationFrame(tick);
    }
    updateBar();
    render();
  };
  /** Run on a stretch of time, a month at a time so the screen keeps up. */
  const skip = (days: number) => {
    if (!ready() || busy || !alive()) return;
    play(false);
    busy = true;
    let left = days;
    const slice = () => {
      const t0 = performance.now();
      while (left > 0 && performance.now() - t0 < 30) {
        const n = Math.min(DAYS_PER_MONTH, left);
        sim!.gods = d.world().settings.gods ?? { active: true, activity: 50 };
        freshLayers();
        stepDays(sim!, env!, lib(), n);
        left -= n;
      }
      afterStep();
      if (left > 0 && alive()) window.setTimeout(slice, 0);
      else {
        busy = false;
        updateBar();
        render();
      }
    };
    slice();
  };

  // ---------------------------------------------------------------------------------------------
  // The time bar

  const playBtn = h('button', { type: 'button', class: 'primary', onclick: () => play(!playing) }, 'Play');
  const dateEl = h('span', { class: 'sim-date' });
  const skipBtns = [
    { label: '+1 month', days: 30 },
    { label: '+1 year', days: 360 },
    { label: '+10 years', days: 3600 },
  ].map((s) => h('button', { type: 'button', class: 'ghost small', onclick: () => skip(s.days) }, s.label));
  const speedSeg = choice('Speed (a second)', SPEEDS.map(({ value, label }) => ({ value, label })), String(speed), (v) => {
    speed = Number(v);
  });
  // Rifts held off (no new rifts, none breaking, no monsters coming out), until let go again.
  const riftBtn = h('button', {
    type: 'button',
    class: 'ghost small',
    title: 'Hold off the rifts: while held, no new rift opens, none breaks, and monster tides neither spread nor send out hordes and hordes already out halt where they are. Rifts already open stay, and are still worked.',
    onclick: () => {
      if (!sim) return;
      sim.riftsHeld = !sim.riftsHeld;
      if (sim.riftsHeld) log(sim, 'The rifts are held off: none will open or break until they are let go.');
      else log(sim, 'The rifts are let go: they may open and break again.');
      d.changed();
      updateBar();
      render();
    },
  });
  const bar = h('div', { class: 'sim-bar', hidden: true }, playBtn, speedSeg, ...skipBtns, riftBtn, dateEl);
  const updateBar = () => {
    const has = ready() && alive();
    bar.hidden = !has && !active;
    playBtn.textContent = playing ? 'Pause' : 'Play';
    playBtn.disabled = !has || busy;
    skipBtns.forEach((b) => (b.disabled = !has || busy));
    riftBtn.textContent = sim?.riftsHeld ? 'Rifts: held off' : 'Rifts: on';
    riftBtn.setAttribute('aria-pressed', sim?.riftsHeld ? 'true' : 'false');
    riftBtn.disabled = !has || busy;
    dateEl.textContent = !sim ? '' : busy ? `${dateText(sim.day)} · running…` : dateText(sim.day);
  };

  // ---------------------------------------------------------------------------------------------
  // The map

  let landDirty = true;
  let beastDirty = true;
  let landImg: HTMLCanvasElement | null = null;
  /** Border lines (km): polylines along the natural edges of the realms' lands; and when the land was last drawn. */
  let borderChains: { pts: number[]; left: number; right: number; soft?: boolean }[] = [];
  let borderRings = new Map<number, number[][]>();
  /** Contested provinces, for hatching. */
  let disputed: { rings: number[][]; rgb: number[] }[] = [];
  let landBuilt = 0;
  let landColours = new Map<number, number[]>();
  let beastImg: HTMLCanvasElement | null = null;
  const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const fieldImage = (paint: (data: Uint8ClampedArray) => void): HTMLCanvasElement => {
    const cv = h('canvas', { width: env!.w, height: env!.h }) as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(env!.w, env!.h);
    paint(img.data);
    g.putImageData(img, 0, 0);
    return cv;
  };
  const drawLand = () => {
    const s = sim!;
    const e = env!;
    // Each clan's colour, or its culture's.
    const colours = new Map(s.clans.map((c) => {
      const cu = landsBy === 'culture' ? cultureOf(s, c.culture) : undefined;
      const fa = landsBy === 'faith' ? realmFaith(s, c) : undefined;
      return [c.id, hex(cu ? cultureColour(s, cu) : fa ? faithColour(s, fa) : c.colour)];
    }));
    // Provinces round towns held by an enemy (its owner's within about 30 miles): taken in the war.
    const P = e.prov;
    const pm = d.provinces();
    const taken = new Map<number, number>();
    for (const st of s.settlements) {
      if (!st.occupied || st.ruined) continue;
      for (const p of provincesNear(e, st.x, st.y, 50)) if (s.provOwner?.[p] === st.clan) taken.set(p, st.occupied.by);
    }
    // Each province's label for the borders (borders.ts): its holder (or its holder's land taken), unheld land, or water.
    const label = new Int32Array(P.count);
    for (let p = 0; p < P.count; p++) {
      const o = s.provOwner?.[p] ?? -1;
      label[p] = P.kind[p] === PK.sea || P.kind[p] === PK.lake || P.kind[p] === PK.river ? SEA : o < 0 ? UNCLAIMED : taken.has(p) ? occ(o) : o;
    }
    const held = (l: number) => l >= 0 || l <= -1000;
    // Borders run along the province outlines: every stretch between two different labels.
    const chains: { pts: number[]; left: number; right: number; soft?: boolean }[] = [];
    // Contested land (holding.ts): where two realms' people mix, the border between them is soft.
    const rivalOf = (p: number) => (p >= 0 && (s.provRivalUse?.[p] ?? 0) > 0 ? s.provRival?.[p] ?? -1 : -1);
    if (pm) for (const b of pm.borders) {
      const l = b.a < 0 ? OUTSIDE : label[b.a];
      const r = b.b < 0 ? OUTSIDE : label[b.b];
      if (l === r || (!held(l) && !held(r))) continue;
      const soft = (rivalOf(b.a) >= 0 && rivalOf(b.a) === r) || (rivalOf(b.b) >= 0 && rivalOf(b.b) === l);
      chains.push({ pts: b.pts, left: l, right: r, soft });
    }
    borderChains = chains;
    borderRings = assembleRings(chains, pm?.wrapKm ?? 0, !!pm?.wrapKm, held);
    // Contested provinces (another realm's people nearly as many there): lightly hatched in its colour.
    disputed = [];
    if (pm && s.provRival && s.provRivalUse) for (let p = 0; p < P.count; p++) {
      if (s.provRival[p] < 0 || s.provRivalUse[p] <= 0 || (s.provOwner?.[p] ?? -1) < 0) continue;
      disputed.push({ rings: pm.rings[p], rgb: hex(clanOf(s.provRival[p])?.colour ?? '#888888') });
    }
    landColours = colours;
    return h('canvas', { width: 1, height: 1 }) as HTMLCanvasElement;
  };

  const drawBeast = (id: string) => {
    const D = sim!.beasts[id];
    const e = env!;
    let max = 0;
    for (let k = 0; k < e.n; k++) max = Math.max(max, e.beastK[id]?.[k] ?? 0);
    return fieldImage((data) => {
      if (!D || !max) return;
      for (let k = 0; k < e.n; k++) {
        const v = D[k] / max;
        if (v <= 0.01) continue;
        // Pale yellow (few) to deep red (many).
        data.set([200 + 55 * (1 - v), 200 * (1 - v) + 30, 40, 40 + 110 * v], k * 4);
      }
    });
  };
  const drawRes = (id: string) => {
    const A = env!.res[id];
    return fieldImage((data) => {
      if (!A) return;
      for (let k = 0; k < env!.n; k++) {
        const v = Math.min(1, A[k]);
        if (v <= 0.01) continue;
        // Pale green (a little) to deep blue-green (plenty).
        data.set([150 - 130 * v, 210 - 60 * v, 120 + 40 * v, 60 + 150 * v], k * 4);
      }
    });
  };
  const overlay: MapOverlay = {
    get noPaint() {
      return active;
    },
    draw(g, at, scale, copies) {
      // Where a race would live (attraction.ts): each province coloured by how much it draws them;
      // off limits dark. Shown as soon as the land is known, before the peoples begin.
      const aShow = d.attraction?.() ?? 'off';
      const apm = d.provinces();
      if (aShow !== 'off' && env && apm && env.prov.real && env.prov.count === apm.rings.length) {
        const e0 = env;
        if (attractKey !== `${aShow}|${apm.rings.length}` || attractEnv !== e0) {
          const af = attractionFor(e0, lib(), aShow);
          attractFills = Array.from({ length: e0.prov.count }, (_, p) => {
            if (!af || e0.prov.kind[p] !== PK.land) return null;
            const pa = provinceAttraction(e0, af.wants, e0.prov.cells.subarray(e0.prov.start[p], e0.prov.start[p + 1]), af.score);
            if (!pa) return null;
            if (pa.off >= 0.5) return 'rgba(30,28,34,0.62)';
            // Red (poor) through yellow to green (much wanted).
            const t = Math.max(0, Math.min(1, pa.score / 1.4));
            const c = t < 0.5 ? [200, 60 + 340 * t, 50] : [200 - 300 * (t - 0.5), 230 - 40 * (t - 0.5), 50 + 40 * (t - 0.5)];
            return `rgba(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')},0.55)`;
          });
          attractKey = `${aShow}|${apm.rings.length}`;
          attractEnv = e0;
        }
        if (attractPathsFor !== apm) {
          attractPaths = apm.rings.map((rings) => {
            const path = new Path2D();
            for (const r of rings) {
              path.moveTo(r[0], r[1]);
              for (let i = 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
              path.closePath();
            }
            return path;
          });
          attractPathsFor = apm;
        }
        for (const c of copies) {
          const [ox, oy] = at(0, 0, c);
          g.save();
          g.translate(ox, oy);
          g.scale(scale, scale);
          attractFills.forEach((fill, p) => {
            if (!fill || !attractPaths[p]) return;
            g.fillStyle = fill;
            g.fill(attractPaths[p]);
          });
          g.restore();
        }
      }
      if (!ready()) return;
      const s = sim!;
      const e = env!;
      pxKm = 1 / scale;
      const blit = (img: HTMLCanvasElement, smooth = true) => {
        g.save();
        g.imageSmoothingEnabled = smooth;
        for (const c of copies) {
          const [sx, sy] = at(e.x0 - e.step / 2, e.y0 - e.step / 2, c);
          g.drawImage(img, sx, sy, e.w * e.step * scale, e.h * e.step * scale);
        }
        g.restore();
      };
      // The population heat map: each province coloured by the people living in it (everyone, or one race).
      const dShow = d.density?.() ?? 'off';
      const dpm = d.provinces();
      if (dShow !== 'off' && dpm && e.prov.real && e.prov.count === dpm.rings.length) {
        const key = `${dShow}|${s.day}|${s.settlements.length}|${historyDay}|${paintRev}`;
        if (key !== densityKey || !densityFills.length) {
          if (dShow === 'food') {
            // What each province's land can feed, fully farmed (people per square mile).
            const land = provinceLand(e);
            densityFills = Array.from({ length: e.prov.count }, (_, p) => (e.prov.kind[p] === PK.land && e.prov.area[p] > 0 ? foodColour((provinceFood(land[p], ALL_FOOD_TECH).total / e.prov.area[p]) * SQ_KM_PER_SQ_MI) : null));
          } else if (dShow === 'culture' && historyDay !== null) {
            // As it was on the day scrubbed in the history of peoples.
            const snap = snapshotAt(s, historyDay);
            const byId = new Map<number, string>();
            for (const [pid, cu] of Object.entries(snap?.provs ?? {})) byId.set(Number(pid), cu);
            densityFills = Array.from({ length: e.prov.count }, (_, p) => {
              const cu = byId.get(e.prov.ids[p]);
              return e.prov.kind[p] === PK.land && cu ? cultureFill(s, new Map([[cu, 1]])) : null;
            });
          } else if (dShow === 'culture') {
            const by = provinceCultures(s, e);
            densityFills = Array.from({ length: e.prov.count }, (_, p) => (e.prov.kind[p] === PK.land ? cultureFill(s, by.get(p)) : null));
          } else {
            const per = provincePopulation(s, e, dShow);
            densityFills = Array.from(per, (v, p) => (e.prov.kind[p] === PK.land ? densityColour(v) : null));
          }
          densityKey = key;
        }
        if (densityPathsFor !== dpm) {
          densityPaths = dpm.rings.map((rings) => {
            const path = new Path2D();
            for (const r of rings) {
              path.moveTo(r[0], r[1]);
              for (let i = 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
              path.closePath();
            }
            return path;
          });
          densityPathsFor = dpm;
        }
        for (const c of copies) {
          const [ox, oy] = at(0, 0, c);
          g.save();
          g.translate(ox, oy);
          g.scale(scale, scale);
          densityFills.forEach((fill, p) => {
            if (!fill || !densityPaths[p]) return;
            g.fillStyle = fill;
            g.fill(densityPaths[p]);
          });
          g.restore();
        }
      } else if (dShow !== 'off' && s.density) {
        const key = `${dShow}|${s.day}|${paintRev}`;
        if (key !== densityKey || !densityImg) {
          densityImg = drawDensity(s, e, dShow);
          densityKey = key;
        }
        blit(densityImg);
      }
      if (showRes) {
        if (resDirty || !resImg) resImg = drawRes(showRes);
        resDirty = false;
        blit(resImg);
      }
      if (showBeast) {
        if (beastDirty || !beastImg) beastImg = drawBeast(showBeast);
        beastDirty = false;
        blit(beastImg);
      }
      if (showLand && s.clans.length) {
        // Rebuilt when the claims change (at most once a second while the years run).
        const now = performance.now();
        if (!landImg || (landDirty && (!playing || now - landBuilt > 1000))) {
          landImg = drawLand();
          landBuilt = now;
          landDirty = false;
        }
        blit(landImg, false);
        // Crusader Kings borders: no fill; a strip of each realm's colour just inside its border
        // (clipped to its own land, so it never crosses the line), then a solid black line on every
        // border, dashed where land has been taken in a war (whose strip is red).
        const selRealm = selectedRealm ?? s.settlements.find((q) => q.id === selected)?.clan ?? s.tribes.find((t) => t.id === selected)?.clan ?? -1;
        const strip = Math.max(2.5, Math.min(5, e.step * scale * 0.5));
        const trace = (l: number[], c: number) => {
          for (let i = 0; i < l.length; i += 2) {
            const [x, y] = at(l[i], l[i + 1], c);
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
        };
        g.save();
        g.lineJoin = 'round';
        g.lineCap = 'round';
        for (const c of copies) {
          for (const [who, rings] of borderRings) {
            const o = holder(who);
            const chosen = o === selRealm;
            const rgb = isOcc(who) ? [205, 30, 30] : landColours.get(o) ?? [128, 128, 128];
            g.save();
            g.beginPath();
            for (const r of rings) {
              trace(r, c);
              g.closePath();
            }
            g.clip('evenodd');
            // A soft wash over the chosen realm, so it stands out.
            if (chosen) {
              g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.18)`;
              g.fill('evenodd');
            }
            g.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${chosen ? 1 : 0.85})`;
            g.lineWidth = (chosen ? strip * 2.2 : strip) * 2;
            g.stroke();
            g.restore();
          }
          // Contested provinces: lightly hatched in the colour of the other realm.
          for (const dp of disputed) {
            g.save();
            g.beginPath();
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            for (const r of dp.rings) {
              trace(r, c);
              g.closePath();
              for (let i = 0; i < r.length; i += 2) {
                const [sx, sy] = at(r[i], r[i + 1], c);
                x0 = Math.min(x0, sx);
                x1 = Math.max(x1, sx);
                y0 = Math.min(y0, sy);
                y1 = Math.max(y1, sy);
              }
            }
            g.clip('evenodd');
            g.beginPath();
            for (let t = x0 - (y1 - y0); t < x1; t += 7) {
              g.moveTo(t, y1);
              g.lineTo(t + (y1 - y0), y0);
            }
            g.strokeStyle = `rgba(${dp.rgb[0]},${dp.rgb[1]},${dp.rgb[2]},0.35)`;
            g.lineWidth = 1.2;
            g.stroke();
            g.restore();
          }
          // The black lines (not along the map's own edge): firm, dashed round land taken in a war,
          // and faded where the border is contested.
          for (const style of ['firm', 'taken', 'soft'] as const) {
            g.beginPath();
            for (const ch of borderChains) {
              if (ch.left === OUTSIDE || ch.right === OUTSIDE) continue;
              const taken = holder(ch.left) >= 0 && holder(ch.left) === holder(ch.right);
              if ((taken ? 'taken' : ch.soft ? 'soft' : 'firm') !== style) continue;
              trace(ch.pts, c);
            }
            g.setLineDash(style === 'taken' ? [6, 4] : style === 'soft' ? [3, 4] : []);
            g.strokeStyle = style === 'soft' ? 'rgba(10,8,6,0.35)' : 'rgba(10,8,6,0.95)';
            g.lineWidth = style === 'soft' ? 1.2 : 1.6;
            g.stroke();
          }
        }
        g.restore();
      }
      g.save();
      // Where the selected tribe is heading, and its two grounds.
      const sel = s.tribes.find((t) => t.id === selected);
      for (const c of copies) {
        if (sel) {
          const [ax, ay] = at(sel.x, sel.y, c);
          g.setLineDash([4, 4]);
          g.strokeStyle = 'rgba(255,255,255,0.85)';
          g.lineWidth = 1.5;
          for (const [p, label] of [[sel.summer, 'S'], [sel.winter, 'W']] as const) {
            const [px, py] = at(p.x, p.y, c);
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(px, py);
            g.stroke();
            g.fillStyle = 'rgba(0,0,0,0.6)';
            g.font = 'bold 11px system-ui, sans-serif';
            g.fillText(label, px + 4, py - 4);
          }
          g.setLineDash([]);
        }
        // Ways: trails, cart tracks, paved roads and railways, joining neighbouring points that have them.
        if (showWays) {
          const W = e.w;
          const segs: [number, number, number][] = [];
          for (let k = 0; k < e.n; k++) {
            const t = s.way[k];
            if (!t) continue;
            const i = k % W;
            const j = (k / W) | 0;
            for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
              let ii = i + di;
              const jj = j + dj;
              if (jj < 0 || jj >= e.h) continue;
              if (ii >= W) {
                if (!e.wrapKm) continue;
                ii -= W;
              }
              const m = jj * W + ii;
              // Diagonals only where the straight neighbours don't already join them.
              if (di && dj && (s.way[j * W + ((i + di) % W)] || s.way[jj * W + i])) continue;
              if (s.way[m]) segs.push([k, m, Math.min(t, s.way[m])]);
            }
          }
          const P = (k: number): [number, number] => at(e.x0 + (k % W) * e.step, e.y0 + ((k / W) | 0) * e.step, c);
          for (const tier of [1, 2, 3, 4]) {
            const mine = segs.filter((q) => q[2] === tier);
            if (!mine.length) continue;
            const line = (width: number, colour: string, dash: number[] = [], round = false) => {
              g.strokeStyle = colour;
              g.lineWidth = width;
              g.setLineDash(dash);
              g.lineCap = round ? 'round' : 'butt';
              g.beginPath();
              for (const [a, b] of mine) {
                const [ax, ay] = P(a);
                let [bx, by] = P(b);
                // Across the wrap: draw toward the near copy.
                if (Math.abs(bx - ax) > e.step * scale * 2) bx = ax + Math.sign(bx - ax) * -e.step * scale;
                g.moveTo(ax, ay);
                g.lineTo(bx, by);
              }
              g.stroke();
            };
            // Each kind its own look: dirt ways in dots (a trail fine and sparse, a cart track
            // bigger and closer), paved roads in dashes, railways with their sleepers. Gold is
            // kept for trade routes.
            if (tier === 1) line(2.2, 'rgba(150,112,74,0.95)', [0.01, 6], true);
            else if (tier === 2) line(3.6, '#6e4320', [0.01, 4.5], true);
            else if (tier === 3) {
              line(5, 'rgba(40,36,30,0.85)', [9, 5]);
              line(3, '#e2ddd2', [9, 5]);
            } else {
              line(4, '#1c1c1c');
              line(4, '#f2f2f2', [1.5, 5]);
            }
          }
          g.setLineDash([]);
          g.lineCap = 'butt';
          // Bridges: a stone-coloured span with dark parapets.
          if (s.bridge) for (let k = 0; k < e.n; k++) {
            if (!s.bridge[k]) continue;
            const [bx, by] = P(k);
            g.fillStyle = '#cfc6b4';
            g.strokeStyle = 'rgba(20,20,20,0.9)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.rect(bx - 5, by - 3, 10, 6);
            g.fill();
            g.stroke();
          }
        }
        // Spies on their way: a small dark figure, with a faint line to where they are going.
        for (const sp of s.spies ?? []) {
          const [sx, sy] = at(sp.x, sp.y, c);
          const to = s.settlements.find((q) => q.id === (sp.leg === 'out' ? sp.target : clanOf(sp.from)?.realm?.capital));
          if (to) {
            const [tx, ty] = at(to.x, to.y, c);
            g.strokeStyle = 'rgba(30,30,30,0.45)';
            g.lineWidth = 1;
            g.setLineDash([2, 3]);
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(tx, ty);
            g.stroke();
            g.setLineDash([]);
          }
          g.fillStyle = '#141414';
          g.strokeStyle = '#e8e2d0';
          g.lineWidth = 1;
          g.beginPath();
          g.arc(sx, sy, 3.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        // Towns held by an enemy: a striped ring in the occupier's colour.
        for (const st of s.settlements) {
          if (!st.occupied || st.ruined) continue;
          const [sx, sy] = at(st.x, st.y, c);
          g.lineWidth = 3;
          g.setLineDash([3, 3]);
          g.strokeStyle = clanOf(st.occupied.by)?.colour ?? '#000';
          g.beginPath();
          g.arc(sx, sy, 12, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
        // Towns under siege: a ring of the besiegers' colour, tight round the walls.
        for (const st of s.settlements) {
          if (!st.besieged || st.ruined) continue;
          const by = (s.armies ?? []).find((q) => q.id === st.besieged!.by);
          const [sx, sy] = at(st.x, st.y, c);
          g.strokeStyle = by ? clanOf(by.clan)?.colour ?? '#a00' : '#a00';
          g.lineWidth = 2;
          for (let i = 0; i < 10; i++) {
            const an = (i / 10) * Math.PI * 2;
            g.beginPath();
            g.arc(sx + Math.cos(an) * 15, sy + Math.sin(an) * 15, 2.2, 0, Math.PI * 2);
            g.stroke();
          }
        }
        // Battles of the last two years: crossed swords.
        for (const b of s.battles ?? []) {
          if (s.day - b.day > 720) continue;
          const [bx, by] = at(b.x, b.y, c);
          g.strokeStyle = 'rgba(20,20,20,0.9)';
          g.lineWidth = 3.5;
          for (const sgn of [1, -1]) {
            g.beginPath();
            g.moveTo(bx - 6 * sgn, by - 6);
            g.lineTo(bx + 6 * sgn, by + 6);
            g.stroke();
          }
          const fighting = (b.until ?? b.day) > s.day;
          if (fighting) {
            g.fillStyle = 'rgba(255,60,30,0.35)';
            g.beginPath();
            g.arc(bx, by, 13, 0, Math.PI * 2);
            g.fill();
          }
          g.strokeStyle = fighting || s.day - b.day < 60 ? '#ff5a3c' : '#d9d2c3';
          g.lineWidth = 1.6;
          for (const sgn of [1, -1]) {
            g.beginPath();
            g.moveTo(bx - 6 * sgn, by - 6);
            g.lineTo(bx + 6 * sgn, by + 6);
            g.stroke();
          }
        }
        // Armies: a banner in the realm's colour, with its strength, and a line to where it is going.
        for (const a of s.armies ?? []) {
          const [ax, ay] = at(a.x, a.y, c);
          const tgt = s.settlements.find((q) => q.id === a.target) ?? (s.armies ?? []).find((q) => q.id === a.target);
          if (tgt) {
            const [tx, ty] = at(tgt.x, tgt.y, c);
            g.strokeStyle = 'rgba(160,20,20,0.6)';
            g.lineWidth = 1.5;
            g.setLineDash([5, 4]);
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(tx, ty);
            g.stroke();
            g.setLineDash([]);
          }
          g.strokeStyle = '#111';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(ax, ay + 6);
          g.lineTo(ax, ay - 16);
          g.stroke();
          g.fillStyle = clanOf(a.clan)?.colour ?? '#888';
          g.beginPath();
          g.moveTo(ax, ay - 16);
          g.lineTo(ax + 14, ay - 12);
          g.lineTo(ax, ay - 7);
          g.closePath();
          g.fill();
          g.lineWidth = 1;
          g.stroke();
          const label = a.men >= 1000 ? `${(a.men / 1000).toFixed(1)}k` : String(Math.round(a.men));
          g.font = 'bold 11px system-ui, sans-serif';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(0,0,0,0.8)';
          g.fillStyle = a.goal === 'home' ? '#cfcfcf' : '#fff';
          g.strokeText(label, ax + 4, ay + 4);
          g.fillText(label, ax + 4, ay + 4);
        }
        // Holy sites: a gold star (dimmed where the faith has lost it).
        for (const f of s.faiths ?? []) for (const hs of f.holySites) {
          const [hx, hy] = at(hs.x, hs.y, c);
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const r = i % 2 ? 2.6 : 6;
            g.lineTo(hx + 12 + Math.cos(a) * r, hy - 10 + Math.sin(a) * r);
          }
          g.closePath();
          g.fillStyle = hs.held ? faithColour(s, f) : 'rgba(150,150,150,0.6)';
          g.fill();
          g.lineWidth = 1.2;
          g.strokeStyle = hs.held ? '#f2c230' : 'rgba(60,60,60,0.8)';
          g.stroke();
        }
        // Monster tides: the provinces they cover, shaded a dark, angry red.
        const pmap = d.provinces();
        if (pmap && e.prov.real) for (const t of s.tides ?? []) {
          g.save();
          g.beginPath();
          for (const id of t.provinces) {
            const pi = e.prov.ids.indexOf(id);
            for (const r of pmap.rings[pi] ?? []) {
              for (let i = 0; i < r.length; i += 2) {
                const [px, py] = at(r[i], r[i + 1], c);
                if (i) g.lineTo(px, py);
                else g.moveTo(px, py);
              }
              g.closePath();
            }
          }
          g.fillStyle = 'rgba(120,10,30,0.42)';
          g.fill('evenodd');
          g.strokeStyle = 'rgba(70,0,15,0.9)';
          g.lineWidth = 1.5;
          g.stroke();
          g.restore();
        }
        // Hordes: a black shield with a red alpha's mark, and its name.
        for (const hd of s.hordes ?? []) {
          const [hx, hy] = at(hd.x, hd.y, c);
          g.beginPath();
          g.arc(hx, hy, 8, 0, Math.PI * 2);
          g.fillStyle = '#1a0a0a';
          g.fill();
          g.strokeStyle = '#ff3a3a';
          g.lineWidth = 2;
          g.stroke();
          g.beginPath();
          g.moveTo(hx - 4, hy - 4);
          g.lineTo(hx + 4, hy + 4);
          g.moveTo(hx + 4, hy - 4);
          g.lineTo(hx - 4, hy + 4);
          g.stroke();
          g.font = 'bold 11px system-ui, sans-serif';
          g.fillStyle = '#ffd0d0';
          g.strokeStyle = 'rgba(0,0,0,0.8)';
          g.lineWidth = 3;
          g.strokeText(hd.alpha, hx + 11, hy + 4);
          g.fillText(hd.alpha, hx + 11, hy + 4);
        }
        // Rifts: a swirling violet eye, bigger the stronger; ringed by how it is held (dashed while short-lived).
        for (const r of s.rifts ?? []) {
          const [rx, ry] = at(r.x, r.y, c);
          const rad = 6 + 6 * r.strength;
          const grad = g.createRadialGradient(rx, ry, 1, rx, ry, rad);
          grad.addColorStop(0, '#fff2ff');
          grad.addColorStop(0.35, r.strength >= 1 ? '#ff3a6a' : '#c56cff');
          grad.addColorStop(1, 'rgba(60,10,90,0.85)');
          g.beginPath();
          g.arc(rx, ry, rad, 0, Math.PI * 2);
          g.fillStyle = grad;
          g.fill();
          g.setLineDash(r.permanent ? [] : [3, 3]);
          g.lineWidth = 2;
          g.strokeStyle = r.hold === 'encampment' ? '#f2c230' : r.hold === 'soldiers' ? '#d23a2a' : r.hold === 'parties' ? '#4fb3e8' : 'rgba(20,10,30,0.9)';
          g.stroke();
          g.setLineDash([]);
          if (r.water) {
            g.beginPath();
            g.arc(rx + rad * 0.8, ry + rad * 0.8, 3, 0, Math.PI * 2);
            g.fillStyle = '#5fc4ef';
            g.fill();
          }
        }
        // Trade routes in gold, while they are in use (a trip within the year), along the way their
        // traders take; where several routes run together (a great trade artery, a silk road),
        // gold edged in blue. Caravans on them.
        if (showTrade) {
          const load = new Map<number, number>();
          const segKey = (a: number, b: number) => (a < b ? a * e.n + b : b * e.n + a);
          const active = s.routes.filter((r) => s.day - r.last < 360);
          for (const r of active) if (r.path) for (let i = 1; i < r.path.length; i++) {
            const k = segKey(r.path[i - 1], r.path[i]);
            load.set(k, (load.get(k) ?? 0) + 1);
          }
          const XY = (k: number) => at(e.x0 + (k % e.w) * e.step, e.y0 + Math.floor(k / e.w) * e.step, c);
          const seg = (a: number, b: number) => {
            const [ax, ay] = XY(a);
            let [bx, by] = XY(b);
            if (Math.abs(bx - ax) > e.step * scale * 2) bx = ax + Math.sign(ax - bx) * e.step * scale;
            g.moveTo(ax, ay);
            g.lineTo(bx, by);
          };
          g.setLineDash([]);
          g.lineCap = 'round';
          g.lineJoin = 'round';
          // The arteries' blue edges first, then all the gold over them.
          g.beginPath();
          for (const [k, n] of load) if (n >= ARTERY) seg(Math.floor(k / e.n), k % e.n);
          g.strokeStyle = 'rgba(47,111,179,0.95)';
          g.lineWidth = 7;
          g.stroke();
          for (const major of [false, true]) {
            g.beginPath();
            for (const [k, n] of load) if ((n >= ARTERY) === major) seg(Math.floor(k / e.n), k % e.n);
            g.strokeStyle = major ? '#f0c040' : 'rgba(232,184,48,0.9)';
            g.lineWidth = major ? 3.5 : 2;
            g.stroke();
          }
          // Routes whose way is not known yet (by sea, or older ones): straight, thin, dashed gold.
          g.setLineDash([5, 4]);
          g.lineWidth = 1.5;
          g.strokeStyle = 'rgba(232,184,48,0.75)';
          g.beginPath();
          for (const r of active) {
            if (r.path && r.path.length > 1) continue;
            const a = s.settlements.find((q) => q.id === r.a);
            const b = s.settlements.find((q) => q.id === r.b);
            if (!a || !b) continue;
            const [ax, ay] = at(a.x, a.y, c);
            const [bx, by] = at(b.x, b.y, c);
            g.moveTo(ax, ay);
            g.lineTo(bx, by);
          }
          g.stroke();
          g.lineCap = 'butt';
          g.setLineDash([]);
          for (const cv of s.caravans) {
            const [sx, sy] = at(cv.x, cv.y, c);
            if (cv.air) {
              // An airship: a gasbag with a gondola beneath.
              g.beginPath();
              g.ellipse(sx, sy - 2, 7, 3.5, 0, 0, Math.PI * 2);
              g.fillStyle = '#e8dcc4';
              g.fill();
              g.strokeStyle = '#2a1a08';
              g.lineWidth = 1.2;
              g.stroke();
              g.fillStyle = '#6b4826';
              g.fillRect(sx - 2.5, sy + 1.5, 5, 2.5);
              continue;
            }
            g.fillStyle = cv.train ? '#222' : cv.ship ? '#f4f1e8' : '#c8913c';
            g.strokeStyle = '#2a1a08';
            g.lineWidth = 1.5;
            g.fillRect(sx - 3.5, sy - 3.5, 7, 7);
            g.strokeRect(sx - 3.5, sy - 3.5, 7, 7);
          }
        }
        // Village sites (rural.ts): small dots once zoomed in enough to tell them apart, named closer in.
        if (scale >= 1.2 && s.sites) {
          const holderColour = (pid: string) => {
            const p = e.prov.ids.indexOf(Number(pid));
            const o = p >= 0 ? s.provOwner?.[p] ?? -1 : -1;
            return (o >= 0 ? clanOf(o)?.colour : null) ?? '#9a7b4f';
          };
          g.save();
          g.font = '11px system-ui, sans-serif';
          for (const [pid, sites] of Object.entries(s.sites)) {
            const col = holderColour(pid);
            for (const v of sites) {
              const [sx, sy] = at(v.x, v.y, c);
              if (sx < -20 || sy < -20 || sx > g.canvas.width + 20 || sy > g.canvas.height + 20) continue;
              // A hamlet small, a village bigger, one outgrowing village size bigger still.
              const r = Math.max(3, Math.min(5, 2.5 + v.pop / 150));
              g.beginPath();
              g.arc(sx, sy, r, 0, Math.PI * 2);
              g.fillStyle = col;
              g.fill();
              g.lineWidth = 1.2;
              g.strokeStyle = 'rgba(255,248,230,0.9)';
              g.stroke();
              if (scale >= 4) {
                g.lineWidth = 3;
                g.strokeStyle = 'rgba(255,248,230,0.85)';
                g.strokeText(v.name, sx + r + 2, sy + 3);
                g.fillStyle = 'rgba(30,20,8,0.95)';
                g.fillText(v.name, sx + r + 2, sy + 3);
              }
            }
          }
          g.restore();
        }
        // Joined villages: a faint line to the town they are part of.
        g.save();
        g.setLineDash([3, 3]);
        g.strokeStyle = 'rgba(255,240,200,0.55)';
        g.lineWidth = 1;
        for (const st of s.settlements) {
          if (st.ruined || st.partOf === undefined) continue;
          const t = s.settlements.find((q) => q.id === st.partOf);
          if (!t) continue;
          g.beginPath();
          g.moveTo(...at(st.x, st.y, c));
          g.lineTo(...at(t.x, t.y, c));
          g.stroke();
        }
        g.restore();
        // Settlements: a house (a dawn city bigger, ringed in gold: holy); ruins grey and broken.
        for (const st of s.settlements) {
          const [sx, sy] = at(st.x, st.y, c);
          const r = st.kind === 'dawn' ? 9 : 5 + Math.min(3, Math.sqrt(st.pop) / 10);
          g.beginPath();
          g.moveTo(sx - r, sy + r * 0.8);
          g.lineTo(sx - r, sy - r * 0.2);
          g.lineTo(sx, sy - r);
          g.lineTo(sx + r, sy - r * 0.2);
          g.lineTo(sx + r, sy + r * 0.8);
          g.closePath();
          if (st.ruined) {
            g.setLineDash([3, 2]);
            g.fillStyle = 'rgba(120,120,120,0.55)';
          } else g.fillStyle = clanOf(st.clan)?.colour ?? '#888';
          g.fill();
          g.lineWidth = st.id === selected ? 3 : st.holyTo.length ? 2.5 : 1.5;
          g.strokeStyle = st.id === selected ? '#ffffff' : st.holyTo.length ? '#f2c230' : 'rgba(0,0,0,0.8)';
          g.stroke();
          g.setLineDash([]);
          // A town on another layer: a badge for where it is (▼ the Underdark, ♣ the canopy, ▲ a sky layer).
          if (st.layer) {
            const bx = sx - r - 2;
            const by = sy - r - 2;
            g.beginPath();
            g.arc(bx, by, 5.5, 0, Math.PI * 2);
            g.fillStyle = st.layer === 'underdark' ? '#3b2f28' : st.layer === 'canopy' ? '#2f6b2a' : '#3a6fa8';
            g.fill();
            g.strokeStyle = '#ffffff';
            g.lineWidth = 1;
            g.stroke();
            g.fillStyle = '#ffffff';
            g.font = 'bold 8px sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(st.layer === 'underdark' ? '▼' : st.layer === 'canopy' ? '♣' : st.layer.slice(3), bx, by + 0.5);
            g.textAlign = 'start';
            g.textBaseline = 'alphabetic';
          }
          // A realm's capital: a crown above the house.
          const cap = !st.ruined && clanOf(st.clan)?.realm?.capital === st.id;
          if (cap) {
            const cy = sy - r - 3;
            g.beginPath();
            g.moveTo(sx - 5, cy);
            g.lineTo(sx - 5, cy - 6);
            g.lineTo(sx - 2.5, cy - 3);
            g.lineTo(sx, cy - 7);
            g.lineTo(sx + 2.5, cy - 3);
            g.lineTo(sx + 5, cy - 6);
            g.lineTo(sx + 5, cy);
            g.closePath();
            g.fillStyle = '#f2c230';
            g.fill();
            g.lineWidth = 1;
            g.strokeStyle = 'rgba(0,0,0,0.8)';
            g.stroke();
          }
          if (!st.ruined && st.fed < 0.8) {
            g.strokeStyle = '#ff4030';
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(sx, sy, r + 4, 0, Math.PI * 2);
            g.stroke();
          }
          if (st.kind === 'dawn' || scale > 0.12 || st.id === selected) {
            const label = st.ruined ? `${st.name} (ruins)` : st.name;
            g.font = st.kind === 'dawn' ? 'bold 12px system-ui, sans-serif' : '600 11px system-ui, sans-serif';
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(0,0,0,0.75)';
            g.fillStyle = st.holyTo.length ? '#ffe28a' : '#fff';
            g.strokeText(label, sx + r + 4, sy + 4);
            g.fillText(label, sx + r + 4, sy + 4);
          }
        }
        // Warbands away: a diamond, with a line to where they are going.
        for (const so of s.sorties) {
          const [sx, sy] = at(so.x, so.y, c);
          const goal = so.leg === 'out' && so.targetKind === 'settlement' ? s.settlements.find((q) => q.id === so.target) : s.tribes.find((t) => t.id === (so.leg === 'out' ? so.target : so.tribe));
          if (goal) {
            const [gx, gy] = at(goal.x, goal.y, c);
            g.strokeStyle = so.leg === 'out' ? 'rgba(220,40,30,0.9)' : 'rgba(255,255,255,0.6)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(gx, gy);
            g.stroke();
          }
          const r = 4 + Math.min(4, so.strength / 40);
          g.fillStyle = clanOf(so.clan)?.colour ?? '#888';
          g.strokeStyle = '#000';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(sx, sy - r);
          g.lineTo(sx + r, sy);
          g.lineTo(sx, sy + r);
          g.lineTo(sx - r, sy);
          g.closePath();
          g.fill();
          g.stroke();
        }
        // Tribes: a dot in the clan's colour, bigger with more people.
        for (const t of s.tribes) {
          const [sx, sy] = at(t.x, t.y, c);
          const r = 4 + Math.min(6, Math.sqrt(t.pop) / 5);
          g.fillStyle = clanOf(t.clan)?.colour ?? '#888';
          g.strokeStyle = t.id === selected ? '#ffffff' : 'rgba(0,0,0,0.8)';
          g.lineWidth = t.id === selected ? 3 : 1.5;
          g.beginPath();
          g.arc(sx, sy, r, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          if (t.fed < 0.8) {
            // Hungry: a red ring.
            g.strokeStyle = '#ff4030';
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(sx, sy, r + 3, 0, Math.PI * 2);
            g.stroke();
          }
          if (scale > 0.12 || t.id === selected) {
            g.font = '600 11px system-ui, sans-serif';
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(0,0,0,0.7)';
            g.fillStyle = '#fff';
            g.strokeText(t.name, sx + r + 3, sy + 4);
            g.fillText(t.name, sx + r + 3, sy + 4);
          }
        }
      }
      g.restore();
    },
    down(x, y, pk) {
      if (!active || !ready()) return false;
      const s = sim!;
      const hit = tribeAt(x, y, pk);
      const hitCity = hit ? null : settlementAt(x, y, pk);
      // A battle on the map: open its report.
      if (!hit && !hitCity && s.started) {
        const b = [...(s.battles ?? [])].reverse().find((q) => s.day - q.day <= 720 && Math.hypot(q.x - x, q.y - y) < pk * 9);
        if (b) {
          selectedBattle = b.id;
          render();
          document.querySelector('.battle-report')?.scrollIntoView({ block: 'nearest' });
          return true;
        }
        // A realm's land: select the realm (the map still pans).
        const k = cellOf(x, y);
        if (mode === 'select' && k >= 0 && s.owner[k] >= 0 && clanOf(s.owner[k])) {
          selectedRealm = s.owner[k];
          selected = null;
          render();
          d.redraw();
          return false;
        }
      }
      if (mode === 'add' && addWhat === 'people') {
        if (!addRace) {
          toast('Choose which race to add first.');
          return true;
        }
        painting = new Set();
        warned = false;
        paintAt(x, y);
        return true;
      }
      if (mode === 'add' && !hit && !hitCity) {
        if (!addRace) {
          toast('Choose which race to add first.');
          return true;
        }
        const k = cellOf(x, y);
        if (k < 0 || !env!.land[k]) {
          toast(addWhat === 'dawn' ? 'A dawn city stands on land.' : 'Tribes are placed on land.');
          return true;
        }
        if (addWhat === 'dawn') {
          const st = addDawnCity(s, env!, lib(), addRace, x, y, draft.get(addRace)?.cityPop ?? 800);
          if (st) {
            selected = st.id;
            landDirty = true;
            d.changed();
            render();
          }
          return true;
        }
        const into = addClan === 'selected' ? s.tribes.find((t) => t.id === selected)?.clan ?? -1 : -1;
        const t = addTribe(s, env!, lib(), addRace, x, y, into, 150);
        if (t) {
          selected = t.id;
          landDirty = true;
          d.changed();
          render();
        }
        return true;
      }
      selected = hit?.id ?? hitCity?.id ?? null;
      render();
      d.redraw();
      if (hit && !s.started) {
        dragging = hit;
        return true;
      }
      if (hitCity && !s.started) {
        draggingCity = hitCity;
        return true;
      }
      return !!(hit || hitCity);
    },
    drag(x, y) {
      if (painting) {
        paintAt(x, y);
        return;
      }
      const m = dragging ?? draggingCity;
      if (!m) return;
      m.x = x;
      m.y = y;
    },
    up(x, y) {
      if (painting) {
        const n = painting.size;
        painting = null;
        if (n) {
          d.changed();
          render();
        }
        return;
      }
      if (draggingCity && ready()) {
        const st = draggingCity;
        draggingCity = null;
        const k = cellOf(x, y);
        // On the painted land, right up to the coast (the climate's points are too coarse for that).
        if (env!.landAt ? env!.landAt(x, y) : k >= 0 && env!.land[k]) moveSettlement(sim!, env!, lib(), st.id, x, y);
        else {
          toast('A dawn city stands on land.');
          moveSettlement(sim!, env!, lib(), st.id, cityFrom.x, cityFrom.y);
        }
        landDirty = true;
        d.changed();
        render();
        return;
      }
      if (!dragging || !ready()) return;
      const k = cellOf(x, y);
      if (k >= 0 && env!.land[k]) moveTribe(sim!, env!, lib(), dragging.id, x, y);
      else {
        toast('Tribes stay on land.');
        moveTribe(sim!, env!, lib(), dragging.id, dragging.summer.x, dragging.summer.y);
      }
      dragging = null;
      d.changed();
      render();
    },
    pick(x, y, pk) {
      if (!ready()) return false;
      const s = sim!;
      const t = tribeAt(x, y, pk);
      const st = t ? null : settlementAt(x, y, pk);
      const b = t || st ? undefined : [...(s.battles ?? [])].reverse().find((q) => s.day - q.day <= 720 && Math.hypot(q.x - x, q.y - y) < pk * 9);
      const k = cellOf(x, y);
      const realm = t || st || b || k < 0 || s.owner[k] < 0 ? null : clanOf(s.owner[k]);
      if (!t && !st && !b && !realm) return false;
      selected = t?.id ?? st?.id ?? null;
      selectedRealm = realm ? realm.id : null;
      if (b) selectedBattle = b.id;
      if (!active) d.openPeoples?.();
      render();
      d.redraw();
      // Bring its card into view in the panel.
      const name = t?.name ?? st?.name;
      if (name) requestAnimationFrame(() => [...panel.querySelectorAll('h3')].filter((x) => x.textContent === name).pop()?.scrollIntoView({ block: 'start' }));
      if (b) requestAnimationFrame(() => document.querySelector('.battle-report')?.scrollIntoView({ block: 'nearest' }));
      return true;
    },
    describe(x, y) {
      // The Attraction view's breakdown for the race shown, here.
      const pre: InfoItem[] = [];
      const aShow = d.attraction?.() ?? 'off';
      if (aShow !== 'off' && env) {
        const k = cellOf(x, y);
        const af = attractionFor(env, lib(), aShow);
        if (af && k >= 0 && env.land[k]) pre.push({ label: `Draws the ${raceName(aShow)}`, value: attractionText(attraction(env, af.wants, k)) });
      }
      if (!ready()) return pre.length ? pre : null;
      const s = sim!;
      const out: InfoItem[] = [...pre];
      const push = (label: string, value: string) => out.push({ label, value });
      // Families in the wild here.
      {
        const k = cellOf(x, y);
        if (k >= 0 && s.density) {
          const dz = densityAt(s, k);
          if (dz.total >= 0.5) {
            const per = (v: number) => (v / env!.cellArea) * SQ_KM_PER_SQ_MI;
            push('Wild folk', `about ${perSqMi(per(dz.total))} per sq mi (${Math.round(dz.total).toLocaleString()} here)${dz.byRace.length > 1 || dz.byRace[0]?.[0] ? ': ' + dz.byRace.map(([id, v]) => `${raceName(id)} ${Math.round((v / dz.total) * 100)}%`).join(', ') : ''}`);
          }
        }
      }
      // Its province: its people, their cultures, and what its land can feed.
      if (env?.prov.real) {
        const pi = provAt(env, x, y);
        if (pi >= 0) {
          const seen = new Set<string>();
          for (const it of api.provinceInfo(pi)) {
            if (!['People', 'Peoples', 'Farmland', 'Village sites', 'Can feed', 'Surplus'].includes(it.label) || seen.has(it.label)) continue;
            seen.add(it.label);
            out.push({ label: it.label === 'People' ? 'Province people' : it.label, value: it.value });
          }
        }
      }
      // A village site under the cursor (rural.ts).
      if (env?.prov.real && s.sites) {
        const pi = provAt(env, x, y);
        const v = pi >= 0 ? (s.sites[String(env.prov.ids[pi])] ?? []).find((q) => Math.hypot(q.x - x, q.y - y) < Math.max(1, 6 * pxKm)) : undefined;
        if (v) push('Village', `${v.name}: about ${Math.round(v.pop)} people${cultureOf(s, v.culture) ? `, ${cultureOf(s, v.culture)!.name}` : ''}, since year ${yearOf(v.founded)}${(s.traffic?.[cellOf(v.x, v.y)] ?? 0) >= 20 ? '; on a busy way' : ''}${(() => {
          const t = s.settlements.find((q) => !q.ruined && !q.layer && tierOf(q) >= MARKET && ringOf(q, v.x, v.y) === 1);
          return t ? `; in ${t.name}’s inner ring (gardens and dairy, worked hardest)` : '';
        })()}${v.pop >= 500 ? ' (outgrowing a village)' : v.pop < 100 ? ' (a hamlet)' : ''}`);
      }
      const t = tribeAt(x, y, pxKm);
      if (t) push('Tribe', `${t.name} (${clanOf(t.clan) ? realmName(lib(), clanOf(t.clan)!) : '?'}): ${Math.round(t.pop)} people, ${Math.round(Math.min(1, t.fed) * 100)}% fed`);
      const st = t ? null : settlementAt(x, y, pxKm);
      if (st) push('Settlement', settlementLine(st));
      if (st && !st.ruined) {
        const cu = cultureOf(s, st.culture);
        const here = localText(s, lib(), st);
        if (cu) push('Culture', `${cu.name}${here ? ` (here: ${here})` : ''}`);
      }
      // Living past what their race can bear: hard country (fewer births, more deaths).
      for (const g of [t, st]) {
        if (!g || (g as Settlement).layer) continue;
        const ri = raceInfo(lib(), g.race, g.culture, s.cultures ?? []);
        if (!ri || !env) continue;
        const a = attraction(env, wantsOf(env, ri), landCell(env, g.x, g.y));
        if (a.climate < 0.97) push('Hard country', `${g.name}: ${a.harsh.join(', ')} for its people (births ×${hardBirths(a.climate).toFixed(2)}, deaths +${(hardDeaths(a.climate) * 100).toFixed(1)}% a year); it adapts over the generations`);
      }
      if (showTrade) for (const cv of s.caravans) {
        let dx = Math.abs(cv.x - x);
        if (env!.wrapKm) dx = Math.min(dx, env!.wrapKm - dx);
        if (Math.hypot(dx, cv.y - y) > 8 * pxKm) continue;
        const from = s.settlements.find((q) => q.id === cv.from)?.name ?? '?';
        const to = s.settlements.find((q) => q.id === cv.to)?.name ?? '?';
        const goods = Object.entries(cv.cargo).map(([id, u]) => `${Math.round(u)} ${resInfoOf(env!, id)?.name.toLowerCase() ?? id}`).join(', ');
        push('Caravan', `${cv.train ? 'Train' : cv.air ? 'Airship' : cv.ship ? 'Ship' : 'Caravan'} of ${from} (${cv.people} people${cv.animals ? `, ${cv.animals} pack animals` : ''}) ${cv.leg === 'out' ? `going to ${to}` : `coming home from ${to}`}${goods ? `, carrying ${goods}` : ''}`);
        break;
      }
      const k = cellOf(x, y);
      for (const a of s.armies ?? []) {
        if (Math.hypot(a.x - x, a.y - y) < pxKm * 12) push('Army', armyLine(a));
      }
      for (const b of s.battles ?? []) {
        if (s.day - b.day <= 720 && Math.hypot(b.x - x, b.y - y) < pxKm * 8) {
          const w = clanOf(b.winner);
          push('Battle', `${b.name}, year ${yearOf(b.day)}: ${w ? realmName(lib(), w) : '?'} won (${b.a.lost} and ${b.b.lost} fell)`);
        }
      }
      for (const r of s.rifts ?? []) if (Math.hypot(r.x - x, r.y - y) < pxKm * 12) push('Rift', riftLine(r));
      if (env) {
        const tide = tideAt(s, env, cellOf(x, y));
        if (tide) push('Monsters', `${tide.name}: about ${Math.round(tide.strength)} monsters across ${tide.provinces.length} province${tide.provinces.length === 1 ? '' : 's'}`);
      }
      for (const hd of s.hordes ?? []) if (Math.hypot(hd.x - x, hd.y - y) < pxKm * 12) push('Monsters', hordeLine(hd));
      if (s.corruption && env) {
        const k = cellOf(x, y);
        if (k >= 0 && s.corruption[k] >= 0.05) push('Corruption', `${Math.round(s.corruption[k] * 100)}%${s.corruption[k] >= CORRUPTION_RIFT ? ' (rifts may open)' : ''}`);
      }
      for (const f of s.faiths ?? []) for (const hs of f.holySites) {
        if (Math.hypot(hs.x + 12 * pxKm - x, hs.y - 10 * pxKm - y) < pxKm * 8) push('Holy site', `${hs.name}: holy site of the ${f.name}${hs.held ? '' : ' (lost to it)'}`);
      }
      for (const sp of s.spies ?? []) {
        const [sx, sy] = [sp.x, sp.y];
        if (Math.hypot(sx - x, sy - y) < pxKm * 6) {
          const from = clanOf(sp.from);
          const tgt = s.settlements.find((q) => q.id === sp.target);
          push('Spy', `${sp.name}, a spy of ${from ? realmName(lib(), from) : '?'}${sp.leg === 'out' ? `, on the way to ${tgt?.name ?? '?'}` : ', coming home'} (${({ steal: 'to steal its knowledge', unrest: 'to stir up unrest', sabotage: 'to burn its stores', watch: 'to watch and listen' } as const)[sp.mission]})`);
        }
      }
      if (k >= 0 && env!.land[k]) {
        const o = s.owner[k];
        if (o >= 0) push('Realm', `Land of ${clanOf(o) ? realmName(lib(), clanOf(o)!) : 'a clan now gone'}${s.rival[k] >= 0 && s.rivalUse[k] > 0 && clanOf(s.rival[k]) ? `, contested by ${realmName(lib(), clanOf(s.rival[k])!)}` : ''}`);
        if (s.way[k]) {
          const keeper = s.settlements.find((q) => q.id === s.wayKeeper[k]);
          push('Way', `${WAYS[s.way[k]].name}${keeper ? ` (kept by ${keeper.name})` : s.way[k] === 1 ? ' (worn by use)' : ''}`);
        }
        if (s.bridge?.[k]) push('Crossing', 'A stone bridge');
        else if (env!.fresh[k] && s.way[k]) push('Crossing', 'A ford (no bridge yet: crossing is slow)');
        if (showRes) {
          const r = env!.resInfo.find((q) => q.id === showRes);
          if (r) push('Resource', env!.res[r.id][k] > 0.01 ? `${r.name} here (${Math.round(Math.min(1, env!.res[r.id][k]) * 100)}%)` : `No ${r.name.toLowerCase()} here`);
        }
        if (showBeast) {
          const b = env!.beastInfo.find((q) => q.id === showBeast);
          if (b) push('Beast', `${b.name}: ${Math.round((s.beasts[b.id][k] / Math.max(1e-6, env!.beastK[b.id][k] || 1)) * 100)}% of what the land carries`);
        }
      }
      return out.length ? out : null;
    },
  };
  let dragging: Tribe | null = null;
  let draggingCity: Settlement | null = null;
  let cityFrom = { x: 0, y: 0 };
  const settlementAt = (x: number, y: number, pk: number): Settlement | null => {
    if (!sim || !env) return null;
    let best: Settlement | null = null;
    let bd = 14 * pk;
    for (const st of sim.settlements) {
      let dx = Math.abs(st.x - x);
      if (env.wrapKm) dx = Math.min(dx, env.wrapKm - dx);
      const dd = Math.hypot(dx, st.y - y);
      if (dd < bd) {
        bd = dd;
        best = st;
      }
    }
    if (best) cityFrom = { x: best.x, y: best.y };
    return best;
  };
  const VERB: Record<string, string> = { Logged: 'Logging', Mined: 'Mining', Quarried: 'Quarrying', Gathered: 'Gathering', Farmed: 'Growing', Fished: 'Fishing', Herded: 'Herding', Hunted: 'Hunting', Crafted: 'Making' };
  /** A settlement's work, stores and harvest (units: one feeds one person for a month). */
  const economyCard = (st: Settlement, needPer: number): HTMLElement => {
    const e = st.economy!;
    const name = (id: string) => resInfoOf(env!, id)?.name ?? id;
    const jobName = (key: string) =>
      key.startsWith('farm:') ? `Farming ${name(key.slice(5)).toLowerCase()}` : key.startsWith('herd:') ? 'Herding' : key.startsWith('fish:') ? 'Fishing' : key === 'gather' ? 'Gathering wild food' : key === 'hunt' ? 'Hunting' : `${VERB[resInfoOf(env!, key)?.source ?? ''] ?? 'Working'} ${name(key).toLowerCase()}`;
    const jobs = Object.entries(e.jobs).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const need = st.pop * needPer;
    const food = Object.entries(e.stores).filter(([id]) => isFood(env!, id)).sort((a, b) => b[1] - a[1]);
    const foodUnits = food.reduce((n, [, v]) => n + v, 0);
    const other = Object.entries(e.stores).filter(([id]) => !isFood(env!, id)).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const yearWord = (y: number) => (y < 0.6 ? 'a failed harvest' : y < 0.9 ? 'a poor year' : y > 1.15 ? 'a good year' : 'an ordinary year');
    const u = (v: number) => Math.round(v).toLocaleString();
    return h('div', { class: 'tribe-card small econ' },
      h('div', { class: 'econ-head' }, 'Work'),
      jobs.length ? h('ul', { class: 'econ-list' }, ...jobs.map(([k, n]) => h('li', {}, h('span', {}, jobName(k)), h('span', { class: 'num' }, `${n}`)))) : h('div', { class: 'muted' }, 'Idle.'),
      (e.farmers ?? 0) > 0 && !jobs.some(([k]) => k.startsWith('farm:')) ? h('div', { class: 'muted' }, `${e.farmers} farmers work the fields in the growing season.`) : null,
      h('div', { class: 'econ-head' }, 'Food'),
      h('div', {}, `${u(foodUnits)} units in store: ${foodUnits >= need ? `about ${Math.floor(foodUnits / Math.max(1, need))} months` : 'less than a month'} of food.`),
      food.length ? h('ul', { class: 'econ-list' }, ...food.slice(0, 6).map(([id, v]) => h('li', {}, h('span', {}, name(id)), h('span', { class: 'num' }, u(v))))) : null,
      e.crop > 0 ? h('div', {}, `Growing: ${name(e.cropId).toLowerCase()}, about ${u(e.crop)} units so far.`) : null,
      e.harvest ? h('div', {}, `Last harvest: ${u(e.harvest.units)} units of ${name(e.cropId || '').toLowerCase() || 'crops'}, ${yearWord(e.harvest.year)} (Y${yearOf(e.harvest.day)}).`) : null,
      h('div', { class: 'econ-head' }, 'Other stores'),
      other.length ? h('ul', { class: 'econ-list' }, ...other.map(([id, v]) => h('li', {}, h('span', {}, name(id)), h('span', { class: 'num' }, u(v))))) : h('div', { class: 'muted' }, 'Nothing else kept.'),
      h('div', {}, `Needs beyond food (${NEEDS.map((n) => n.name.toLowerCase()).join(', ')}): ${Math.round(e.comfort * 100)}% met.`),
      ...marketPart(st),
      h('div', { class: 'muted' }, 'Units: one unit of a food feeds one person for a month.'),
    );
  };
  /** What a settlement knows of building ways, what it could build and what that costs, and what it keeps. */
  const waysCard = (st: Settlement): HTMLElement => {
    const L = lib();
    const s = sim!;
    const e = env!;
    const mi = e.step * 0.621;
    const best = bestWay(L, st);
    const techName = (id: string) => L.techs.find((t) => t.id === id)?.name ?? id;
    const kindName = (k: string) => (k === 'wood' ? 'wood' : k === 'stone' ? 'stone' : resInfoOf(e, k)?.name.toLowerCase() ?? k);
    const costText = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${(v * 1.609).toFixed(1)} ${kindName(k)}`).join(', ');
    let kept = 0;
    const upkeep: Record<string, number> = {};
    for (let k = 0; k < e.n; k++) {
      if (s.wayKeeper[k] !== st.id || s.way[k] < 2) continue;
      kept++;
      for (const [kind, v] of Object.entries(buildCost(s.way[k], best.tech))) upkeep[kind] = (upkeep[kind] ?? 0) + v * e.step * WAYS[s.way[k]].upkeep;
    }
    return h('div', { class: 'tribe-card small econ' },
      h('div', { class: 'econ-head' }, 'Ways'),
      h('div', {}, best.tier >= 2 ? `Can build: ${WAYS[best.tier].name.toLowerCase()} (${techName(best.tech)}), along its busy trade routes, a few stretches a year.` : 'Can build: trails only (worn by use). Better ways need know-how:'),
      h('ul', { class: 'econ-list' }, ...WAYS.slice(2).map((w) => {
        const tech = w.techs.find((t) => knows(L, st, t)) ?? w.techs[0];
        const ok = w.techs.some((t) => knows(L, st, t));
        return h('li', {}, h('span', {}, `${ok ? '✓' : '·'} ${w.name}`), h('span', { class: 'muted' }, `${techName(tech)}; per mile ${costText(buildCost(w.tier, tech))}; upkeep ${Math.round(w.upkeep * 100)}% a year`));
      })),
      h('div', {}, kept ? `Keeps about ${Math.round(kept * mi)} miles of built ways; upkeep a year: ${Object.entries(upkeep).map(([k, v]) => `${Math.round(v)} ${kindName(k)}`).join(', ')}. Unpaid, they fall back a tier.` : 'Keeps no built ways.'),
    );
  };
  /** Which culture a race will live by: its Library culture, or a folk culture grown from its homeland. */
  const startCultureText = (raceId: string): string => {
    const L = lib();
    const sp = L.species.find((q) => q.races.some((r) => r.id === raceId));
    const made = L.cultures.find((c) => c.races.includes(raceId)) ?? (sp ? L.cultures.find((c) => c.species.includes(sp.id)) : undefined);
    return made ? `Culture: ${made.name} (from the Library).` : 'Culture: a folk culture will grow from its homeland and way of life (make one in the Library to choose it yourself).';
  };
  /** A realm: its government (parts), ruler, capital, centralization and how firmly it holds each town. */
  const realmCard = (cn: Clan): HTMLElement => {
    const L = lib();
    const s = sim!;
    const r = cn.realm;
    const g = r ? govOf(L, r.gov) : undefined;
    const towns = s.settlements.filter((q) => !q.ruined && q.clan === cn.id).sort((a, b) => (b.control ?? 0) - (a.control ?? 0) || b.pop - a.pop);
    const tribes = s.tribes.filter((t) => t.clan === cn.id);
    const capital = towns.find((q) => q.id === r?.capital);
    const pref = preferredGov(s, L, cn.culture);
    const pg = pref.gov ? govOf(L, pref.gov) : undefined;
    const age = r ? Math.floor((s.day - r.ruler.born) / 360) : 0;
    const part = (label: string, v: string | string[] | undefined) => (v && (!Array.isArray(v) || v.length) ? h('li', {}, h('span', { class: 'muted' }, label), h('span', {}, Array.isArray(v) ? v.join(', ') : v)) : null);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return h('div', { class: 'tribe-card small realm-card' },
      h('div', {}, h('span', { class: 'swatch', style: `background:${cn.colour}` }), h('b', {}, realmName(L, cn)), ` · ${raceName(cn.race)}`),
      cultureLine(cn.culture),
      (() => {
        const f = realmFaith(s, cn);
        return f ? h('div', {}, h('span', { class: 'swatch', style: `background:${faithColour(s, f)}` }), `Faith: the ${f.name}`, h('span', { class: 'muted' }, ` (${({ Tolerant: 'tolerates other faiths', Accepting: 'accepts other faiths', Wary: 'wary of other faiths', Intolerant: 'presses its faith on others', Hostile: 'persecutes other faiths' } as Record<string, string>)[f.tolerance] ?? ''})`)) : null;
      })(),
      ...(s.champions ?? []).filter((ch) => ch.clan === cn.id).map((ch) => h('div', {}, `Champion of ${L.gods.find((g) => g.id === ch.god)?.name ?? 'a god'}: ${ch.name} (its warriors fight the harder)`)),
      r ? h('div', {}, `${rulerTitle(L, cn)} ${r.ruler.name} of the house of ${r.ruler.house}, ${age} years old, ruling since year ${yearOf(r.ruler.since)}${r.reigns > 1 ? ` (reign ${r.reigns} of this realm)` : ''}.`) : null,
      h('div', {}, capital ? `Capital: ${capital.name}. ` : 'No capital: its tribes move with the seasons. ', `${towns.length} town${towns.length === 1 ? '' : 's'}, ${tribes.length} tribe${tribes.length === 1 ? '' : 's'}.`),
      g ? h('div', { class: 'econ-head' }, `Government: ${g.name}${r ? ` (since year ${yearOf(r.since)})` : ''}`) : null,
      g ? h('ul', { class: 'econ-list' }, part('Head', g.head), part('Ruling class', g.ruling), part('Land held by', g.land), part('Succession', g.succession), part('Legitimacy', g.legitimacy), part('Army', g.army), part('Law', g.law)) : null,
      h('div', { class: 'muted' }, pg ? `Its culture prefers: ${pg.name}${pref.hold ? ` (${pref.hold.toLowerCase()})` : ' (free to change)'}.` : 'Its culture has no preferred government: its conditions lead it (size, way of life, trade, the ways of rule it has learned).'),
      r && cultureOf(sim!, cn.culture) ? h('div', {}, `Its culture: the ${cultureOf(sim!, cn.culture)!.name}${r.accepted?.length ? `; also counts as its own the ${r.accepted.map((id) => cultureOf(sim!, id)?.name ?? '?').join(', the ')}` : ''}`, h('span', { class: 'muted' }, ' — accepted peoples share its privileges, so their elites have reason to take up its ways.')) : null,
      r ? h('div', {}, `Centralization: ${pct(r.centralization)}`, h('span', { class: 'muted' }, ' — how far its orders are felt; raised by writing, records, taxes, riders and roads.')) : null,
      towns.length > 1 ? h('div', { class: 'econ-head' }, 'How firmly it holds its towns') : null,
      towns.length > 1 ? h('ul', { class: 'econ-list' }, ...towns.slice(0, 12).map((q) => h('li', { class: 'clickable', onclick: () => { selected = q.id; selectedRealm = null; render(); d.redraw(); } }, h('span', {}, q.name, q.id === r?.capital ? h('span', { class: 'muted' }, ' (capital)') : null, q.culture !== cn.culture && cultureOf(s, q.culture) ? h('span', { class: 'muted' }, ` · ${cultureOf(s, q.culture)!.name}`) : null), h('span', { class: 'num' }, pct(q.control ?? 0))))) : null,
      towns.length > 12 ? h('div', { class: 'muted' }, `…and ${towns.length - 12} more.`) : null,
      ...politicsPart(cn, towns),
      ...warPart(cn),
    );
  };
  /** A realm's wars, and the realms it may go to war with (the reason, and the chance each year). */
  const warPart = (cn: Clan): (HTMLElement | null)[] => {
    const s = sim!;
    const L = lib();
    if (!s.started) return [];
    const wars = activeWars(s).filter((w) => sideOf(w, cn.id));
    const c = warContextUI();
    const outlook = s.clans
      .filter((o) => o !== cn)
      .map((o) => ({ o, w: warOutlook(c, cn, o) }))
      .filter((x) => x.w && x.w.chance > 0.001)
      .sort((a, b) => b.w!.chance - a.w!.chance)
      .slice(0, 4);
    const heroes = cn.realm?.heroes ?? [];
    const lord = overlordOf(s, cn.id);
    const vassals = vassalsOf(s, cn.id).map((v) => clanOf(v)).filter((q): q is Clan => !!q);
    const princes = cn.realm?.highPrinces ?? [];
    return [
      lord !== undefined && clanOf(lord) ? h('div', {}, `A vassal of ${realmName(L, clanOf(lord)!)}: it pays a tenth of its capital's stores each year and follows it to war.`) : null,
      vassals.length ? h('div', {}, `Vassals: ${vassals.map((v) => realmName(L, v)).join(', ')}.`) : null,
      princes.length ? h('div', { class: 'econ-head' }, 'High princes') : null,
      princes.length ? h('ul', { class: 'econ-list' }, ...princes.map((p) => h('li', {}, h('span', {}, `${p.name} of the house of ${p.house}`), h('span', { class: 'muted' }, `once ${p.was}, since Y${yearOf(p.since)}`)))) : null,
      heroes.length ? h('div', { class: 'econ-head' }, 'Heroes and generals at home') : null,
      heroes.length ? h('ul', { class: 'econ-list' }, ...heroes.map((hr) => h('li', {}, h('span', {}, hr.name, h('span', { class: 'muted' }, ` · ${hr.kind}`)), h('span', { class: 'muted' }, `${'★'.repeat(Math.max(1, Math.min(5, hr.power)))} · ${hr.deeds} deed${hr.deeds === 1 ? '' : 's'}`)))) : null,
      wars.length ? h('div', { class: 'econ-head' }, 'At war') : null,
      ...wars.map((w) => h('div', {}, `${w.name}: ${sideOf(w, cn.id) === 'attackers' ? 'attacking' : 'defending'}, war score ${Math.round(w.score)}`)),
      outlook.length && !wars.length ? h('div', { class: 'econ-head' }, 'Might go to war with') : null,
      ...(!wars.length ? outlook.map(({ o, w }) => h('div', { class: 'muted' }, `${realmName(L, o)}: ${REASON_WORDS[w!.reason]}, ${Math.round(w!.chance * 1000) / 10}% a year (odds ${w!.odds.toFixed(1)} to 1)`)) : []),
    ];
  };
  /** A realm's family, claimants, factions and relations with other realms. */
  const politicsPart = (cn: Clan, towns: Settlement[]): (HTMLElement | null)[] => {
    const L = lib();
    const s = sim!;
    const r = cn.realm;
    if (!r || !s.started) return [];
    const yrs = (born: number) => Math.floor((s.day - born) / 360);
    const fam = r.family ?? [];
    const claims = r.claimants ?? [];
    const restless = towns.filter((q) => (q.unrest ?? 0) > 0).sort((a, b) => (b.unrest ?? 0) - (a.unrest ?? 0));
    const rels = Object.entries(s.realmRelations ?? {})
      .map(([k, rel]) => {
        const [a, b] = k.split('|').map(Number);
        const other = a === cn.id ? b : b === cn.id ? a : -1;
        const oc = clanOf(other);
        return oc ? { oc, rel } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.rel.pacts.length - a.rel.pacts.length || b.rel.opinion - a.rel.opinion);
    const why = { heir: 'a passed-over heir', 'true line': 'the true line, put aside', marriage: 'by marriage', exile: 'driven out, in exile' } as const;
    return [
      fam.length ? h('div', { class: 'econ-head' }, 'The royal family') : null,
      fam.length ? h('ul', { class: 'econ-list' }, ...fam.map((k) => h('li', {}, h('span', {}, `${k.name} of ${k.house}`), h('span', { class: 'muted' }, `${k.female ? 'daughter' : 'son'}, ${yrs(k.born)}`)))) : null,
      claims.length ? h('div', { class: 'econ-head' }, 'Claimants to the throne') : null,
      claims.length ? h('ul', { class: 'econ-list' }, ...claims.map((q) => h('li', {}, h('span', {}, `${q.name} of ${q.house}`, h('span', { class: 'muted' }, ` · ${why[q.why]}${q.hostedBy !== undefined && clanOf(q.hostedBy) ? ` with ${realmName(L, clanOf(q.hostedBy)!)}` : ''}`)), h('span', { class: 'num' }, `${Math.round(q.backing * 100)}% backing`)))) : null,
      restless.length ? h('div', { class: 'econ-head' }, 'Discontented towns (a faction may rise)') : null,
      restless.length ? h('ul', { class: 'econ-list' }, ...restless.slice(0, 8).map((q) => h('li', {}, h('span', {}, q.name), h('span', { class: 'muted' }, `loyalty ${Math.round((q.loyalty ?? 0) * 100)}%, ${q.unrest} yr${q.unrest === 1 ? '' : 's'}`)))) : null,
      r.betrayals ? h('div', { class: 'muted' }, `It has broken ${r.betrayals} treat${r.betrayals === 1 ? 'y' : 'ies'} without cause; everyone remembers.`) : null,
      rels.length ? h('div', { class: 'econ-head' }, 'Relations with other realms') : null,
      rels.length
        ? h('ul', { class: 'econ-list' }, ...rels.slice(0, 10).map(({ oc, rel }) => h('li', {},
            h('span', {}, h('span', { class: 'swatch', style: `background:${oc.colour}` }), realmName(L, oc), rel.pacts.length ? h('div', { class: 'muted' }, rel.pacts.map((p) => `${PACT_NAMES[p.kind]}${p.roads ? ' (shared roads and bridges)' : ''}`).join(' · ')) : null, (rel.hostileUntil ?? -1) > s.day ? h('div', { class: 'muted' }, 'Takes up a quarrel against it') : null),
            h('span', { class: 'muted' }, `${opinionWord(rel.opinion)} (${rel.opinion >= 0 ? '+' : ''}${rel.opinion.toFixed(2)})`))))
        : null,
    ];
  };
  const armyLine = (a: Army): string => {
    const s = sim!;
    const cn = clanOf(a.clan);
    const tgt = s.settlements.find((q) => q.id === a.target);
    const foe = (s.armies ?? []).find((q) => q.id === a.target);
    const doing = a.goal === 'home' ? 'going home' : a.siege ? `besieging ${tgt?.name ?? '?'} (${a.siege.days} days${a.siege.breach ? `, walls ${Math.round(a.siege.breach * 100)}% breached` : ''})` : foe ? `marching to meet the ${foe.name}` : tgt ? `marching on ${tgt.name}` : 'holding';
    const mix = a.units ? ` (${UNIT_KINDS.filter((k) => (a.units![k] ?? 0) >= 1).map((k) => `${Math.round(a.units![k] ?? 0).toLocaleString()} ${kindName(k, a.specialists)}`).join(', ')})` : '';
    const heroes = (a.heroes ?? []).slice(1).map((h) => h.name);
    const fighting = (a.engagedUntil ?? -1) > s.day ? '; fighting a battle' : '';
    return `The ${a.name} (${cn ? realmName(lib(), cn) : '?'}): ${Math.round(a.men).toLocaleString()}${mix} under ${a.general}${heroes.length ? ` with ${heroes.join(', ')}` : ''}${fighting}, morale ${Math.round(a.morale * 100)}%, food for ${Math.max(0, Math.round((a.supply / Math.max(1, a.men)) * 30))} days; ${doing}`;
  };
  /** How war looks from a realm: its enemies, and the realms it may go to war with (and why). */
  const warContextUI = (): WarContext => {
    const s = sim!;
    const L = lib();
    return {
      sim: s,
      env: env!,
      lib: L,
      rand: () => 0.5,
      dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
      cellAt: (x, y) => cellOf(x, y),
      log: () => {},
      name: () => '',
      lifespan: () => 70,
      might: (race, culture) => (raceInfo(L, race, culture, s.cultures)?.might ?? 1) * cultureFx(s, culture).fight,
      speed: (race, culture) => (raceInfo(L, race, culture, s.cultures)?.speed ?? 15) * 0.9,
    };
  };
  /** A battle's report: the sides by kind of fighter, their heroes, each phase, and how it ended (once the fighting is over). */
  const battleReport = (b: Battle): HTMLElement => {
    const s = sim!;
    const r = b.report;
    const war = (s.wars ?? []).find((w) => w.id === b.war);
    const going = (b.until ?? b.day) > s.day;
    const head = h('div', {}, h('strong', {}, b.name), h('span', { class: 'muted' }, ` · ${war?.name ?? ''} · ${dateText(b.day)}${r ? ` · ${r.ground}` : ''}`));
    const close = h('button', { type: 'button', class: 'ghost small', onclick: () => { selectedBattle = null; render(); } }, 'Close');
    if (!r) return h('div', { class: 'tribe-card small battle-report' }, head, h('div', {}, `${b.a.army} (${b.a.men}) against ${b.b.army} (${b.b.men}): ${clanOf(b.winner)?.name ?? '?'} won; ${b.a.lost} and ${b.b.lost} fell.`), close);
    const n = (v: number | undefined) => Math.round(v ?? 0).toLocaleString();
    const kinds = UNIT_KINDS.filter((k) => (r.sides[0].units[k] ?? 0) >= 1 || (r.sides[1].units[k] ?? 0) >= 1);
    const lostBy = (i: 0 | 1, k: (typeof UNIT_KINDS)[number]) => r.phases.reduce((m, p) => m + (p.lost[i][k] ?? 0), 0);
    return h('div', { class: 'tribe-card small battle-report' },
      head,
      h('table', { class: 'clan-table small' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...r.sides.map((sd) => h('th', {}, h('span', { class: 'swatch', style: `background:${clanOf(sd.clan)?.colour ?? '#888'}` }), sd.label)))),
        h('tbody', {},
          ...kinds.map((k) => h('tr', {}, h('td', {}, kindName(k, r.sides[0].units.specialists ? r.sides[0].specialists : r.sides[1].specialists)), ...([0, 1] as const).map((i) => h('td', { class: 'num' }, going ? n(r.sides[i].units[k]) : `${n(r.sides[i].units[k])} (−${n(lostBy(i, k))})`)))),
          h('tr', {}, h('td', {}, h('b', {}, 'All')), ...([0, 1] as const).map((i) => h('td', { class: 'num' }, h('b', {}, going ? n(total(r.sides[i].units)) : `${n(total(r.sides[i].units))} (−${n(r.phases.reduce((m, p) => m + total(p.lost[i]), 0))})`)))),
          h('tr', {}, h('td', {}, 'Heroes'), ...r.sides.map((sd) => h('td', {}, sd.heroes.join(', ') || '—'))),
        ),
      ),
      going
        ? h('p', { class: 'muted' }, 'The armies are still fighting. The full report comes when the fighting stops.')
        : h('div', {},
            ...r.phases.map((p) => h('div', {}, h('span', { class: 'econ-head' }, `${p.name}: `), p.text)),
            ...r.notes.map((t) => h('div', { class: 'muted' }, t)),
            h('div', {}, h('b', {}, r.outcome)),
          ),
      close,
    );
  };
  /** A war: its sides, reason, score and weariness, armies and latest battles. */
  const warCard = (w: War): HTMLElement => {
    const L = lib();
    const s = sim!;
    const side = (ids: number[]) => ids.map((id) => clanOf(id)).filter((q): q is Clan => !!q);
    const names = (ids: number[]) => side(ids).map((q) => h('span', {}, h('span', { class: 'swatch', style: `background:${q.colour}` }), realmName(L, q), ` (weariness ${Math.round((w.weariness[q.id] ?? 0) * 100)}%)`));
    const armies = (s.armies ?? []).filter((a) => a.war === w.id);
    const battles = (s.battles ?? []).filter((b) => b.war === w.id).slice(-5).reverse();
    const lead = w.score >= 15 ? 'the attackers lead' : w.score <= -15 ? 'the defenders lead' : 'neither side leads';
    const goal = s.settlements.find((q) => q.id === w.goalTown);
    return h('details', { class: 'culture-card small', open: w.ended === undefined },
      h('summary', {}, h('strong', {}, w.name), h('span', { class: 'muted' }, ` · Y${yearOf(w.started)}${w.ended !== undefined ? `–${yearOf(w.ended)}` : ', going on'}`)),
      h('div', { class: 'tribe-card econ' },
        h('div', {}, `Why: ${REASON_WORDS[w.reason]}${goal ? ` (${goal.name})` : ''}${w.goalHouse ? ` (the house of ${w.goalHouse})` : ''}.`),
        h('div', {}, h('b', {}, 'Attackers: '), ...names(w.attackers)),
        h('div', {}, h('b', {}, 'Defenders: '), ...names(w.defenders)),
        w.ended === undefined ? h('div', {}, `War score ${w.score >= 0 ? '+' : ''}${Math.round(w.score)}: ${lead}. ${w.battles} battle${w.battles === 1 ? '' : 's'}; fallen: ${w.losses.attackers.toLocaleString()} attackers, ${w.losses.defenders.toLocaleString()} defenders.`) : h('div', {}, w.outcome ?? ''),
        armies.length ? h('div', { class: 'econ-head' }, 'Armies in the field') : null,
        armies.length ? h('ul', { class: 'econ-list' }, ...armies.map((a) => h('li', {}, h('span', {}, armyLine(a))))) : null,
        battles.length ? h('div', { class: 'econ-head' }, 'Latest battles') : null,
        battles.length ? h('ul', { class: 'econ-list' }, ...battles.map((b) => h('li', { class: 'clickable', title: 'Show the battle report', onclick: () => { selectedBattle = b.id; render(); document.querySelector('.battle-report')?.scrollIntoView({ block: 'nearest' }); } }, h('span', {}, `${b.name} (Y${yearOf(b.day)})`), h('span', { class: 'muted' }, (b.until ?? b.day) > s.day ? 'fighting…' : `${clanOf(b.winner)?.name ?? '?'} won · ${b.a.lost}/${b.b.lost} fell`)))) : null,
      ),
    );
  };
  const faithLine = (id: string | undefined, shift?: { to: string; progress: number }): HTMLElement | null => {
    const f = faithOf(sim!, id);
    if (!f) return null;
    return h('div', {}, h('span', { class: 'swatch', style: `background:${faithColour(sim!, f)}` }), `Faith: the ${f.name}`, shift && faithOf(sim!, shift.to) ? h('span', { class: 'muted' }, ` · being drawn to the ${faithOf(sim!, shift.to)!.name} (${Math.round(shift.progress * 100)}%)`) : null);
  };
  /** A faith: what it believes, how organized and fervent it is, its holy sites and gods, and who follows it. */
  const faithCard = (f: LiveFaith): HTMLElement => {
    const L = lib();
    const s = sim!;
    const towns = s.settlements.filter((q) => !q.ruined && q.faith === f.id);
    const tribes = s.tribes.filter((t) => t.faith === f.id);
    const people = towns.reduce((n, q) => n + q.pop, 0) + tribes.reduce((n, t) => n + t.pop, 0);
    const realms = s.clans.filter((q) => realmFaith(s, q) === f);
    const seat = s.settlements.find((q) => q.id === f.seat);
    const gods = f.gods.map((id) => L.gods.find((g) => g.id === id)?.name ?? id);
    return h('details', { class: 'culture-card small' },
      h('summary', {}, h('span', { class: 'swatch', style: `background:${faithColour(s, f)}` }), h('strong', {}, f.name), ` · ${Math.round(people).toLocaleString()} people`, h('span', { class: 'muted' }, ` · ${towns.length} settlements, ${tribes.length} tribes`)),
      h('div', { class: 'tribe-card econ' },
        h('div', {}, f.source ? `From the Library${f.hold ? ` (${f.hold.toLowerCase()} for its followers)` : ''}.` : f.blend ? `A blend of the ${f.blend.map((id) => faithOf(s, id)?.name ?? 'old faiths').join(' and the ')}, born year ${yearOf(f.founded)}.` : f.parent ? `Broke from the ${faithOf(s, f.parent)?.name ?? 'old faith'} in year ${yearOf(f.founded)}.` : 'The folk belief of its people’s homeland.'),
        h('div', {}, `Belief: ${f.nature.join(', ') || '—'} · Leads: ${f.leader || '—'} · Other faiths: ${f.tolerance.toLowerCase()}`),
        h('div', {}, `Organization: ${ORGANIZATION_WORDS[f.organization]}${seat ? `, seated at ${seat.name}` : ''}`),
        h('div', {}, `Fervour: ${Math.round(f.fervour * 100)}%`, h('span', { class: 'muted' }, ' — rises with holy sites held and the gods’ deeds; falls with losses, and in an old great hierarchy.')),
        h('div', { class: 'econ-head' }, 'Tenets'),
        f.tenets.length
          ? h('ul', { class: 'econ-list' }, ...f.tenets.map((t) => {
              const tn = L.tenets.find((q) => q.id === t.id);
              return h('li', { title: tn?.effects ?? '' }, h('span', {}, tn?.name ?? t.id), h('span', { class: 'muted' }, tn?.levels[t.level]?.name ?? ''));
            }))
          : h('div', { class: 'muted' }, 'None.'),
        h('div', { class: 'econ-head' }, 'Holy sites'),
        f.holySites.length ? h('ul', { class: 'econ-list' }, ...f.holySites.map((hs) => h('li', {}, h('span', {}, hs.name), h('span', { class: 'muted' }, `${hs.kind}${hs.held ? '' : ' · lost'}`)))) : h('div', { class: 'muted' }, 'None.'),
        h('div', {}, gods.length ? `Gods: ${gods.join(', ')}` : 'No gods named (make gods in the Library and give them to a faith, or favour a people with them).'),
        realms.length ? h('div', {}, `The faith of: ${realms.map((q) => realmName(L, q)).join(', ')}`) : null,
      ),
    );
  };
  /** The gods: who they watch over, their champions, and what they have done lately. */
  const godsPart = (): (HTMLElement | null)[] => {
    const L = lib();
    const s = sim!;
    const worshipped = L.gods.filter((g) => (s.faiths ?? []).some((f) => f.gods.includes(g.id)));
    if (!worshipped.length) return [];
    const off = s.gods && !s.gods.active;
    return [
      h('h3', {}, 'The gods'),
      off ? h('p', { class: 'muted small' }, 'Religion is belief only in this world (World settings): the gods do not act.') : null,
      ...worshipped.map((g) => {
        const champs = (s.champions ?? []).filter((ch) => ch.god === g.id);
        const last = s.godActs?.[g.id];
        const deeds = s.events.filter((e) => e.text.startsWith(g.name)).slice(-3).reverse();
        return h('div', { class: 'tribe-card small' },
          h('div', {}, h('strong', {}, g.name), g.titles ? h('span', { class: 'muted' }, `, ${g.titles}`) : null, g.domains.length ? h('span', { class: 'muted' }, ` · ${g.domains.join(', ')}`) : null),
          h('div', {}, `Worshipped by: ${(s.faiths ?? []).filter((f) => f.gods.includes(g.id)).map((f) => f.name).join(', ')}`),
          h('div', { class: 'muted' }, last !== undefined ? `Last acted in year ${yearOf(last)}.` : 'Has not acted yet.'),
          champs.length ? h('div', {}, `Champions: ${champs.map((ch) => `${ch.name} (${clanOf(ch.clan) ? realmName(L, clanOf(ch.clan)!) : '?'})`).join(', ')}`) : null,
          deeds.length ? h('ul', { class: 'econ-list' }, ...deeds.map((e) => h('li', {}, h('span', { class: 'muted' }, `Y${yearOf(e.day)}: ${e.text}`)))) : null,
        );
      }),
    ];
  };
  /** Who a place's people are: its pops, biggest first. */
  const popsTable = (pops: Pop[]): HTMLElement => {
    const s = sim!;
    const CLS: Record<string, string> = { elite: 'Elite', middle: 'Middle', commoner: 'Commoner' };
    const all = pops.reduce((n, q) => n + q.n, 0) || 1;
    return h('details', { class: 'pops' },
      h('summary', {}, `Its people: ${pops.filter((q) => q.n >= 1).length} group${pops.filter((q) => q.n >= 1).length === 1 ? '' : 's'}`),
      h('table', { class: 'pops-table' },
        h('tr', {}, ...['People', 'Race', 'Culture', 'Speaks', 'Goods and homes', 'Faith', 'Class', 'Stance'].map((t) => h('th', {}, t))),
        ...[...pops].filter((q) => q.n >= 1).sort((a, b) => b.n - a.n).map((q) => h('tr', {},
          h('td', {}, `${Math.round(q.n).toLocaleString()} (${Math.round((q.n / all) * 100)}%)`),
          h('td', {}, raceName(q.race)),
          h('td', {}, cultureOf(s, q.culture)?.name ?? '—'),
          h('td', {}, q.language ? langName(s, q.language) : '—'),
          h('td', {}, cultureOf(s, q.material || q.culture)?.name ?? '—'),
          h('td', {}, faithOf(s, q.faith)?.name ?? '—'),
          h('td', {}, CLS[q.cls]),
          h('td', {}, q.stance ? STANCE_WORDS[q.stance] : ''),
        )),
      ),
    );
  };
  const cultureLine = (id: string, st?: Settlement): HTMLElement | null => {
    const cu = cultureOf(sim!, id);
    // A town's own version of its culture: what it adds or drops by its life there.
    const here = st ? localText(sim!, lib(), st) : '';
    return cu ? h('div', {}, `Culture: ${cu.name}${cu.source ? '' : ' (folk)'}`, here ? h('span', { class: 'muted', title: 'This town’s own version of its culture: traditions it has taken up or let go by its life there (still the same culture).' }, ` (here: ${here})`) : null) : null;
  };
  /** How a culture sees the others it knows (acceptance). */
  const acceptancePart = (cu: LiveCulture): HTMLElement[] => {
    const s = sim!;
    const known = (s.cultures ?? []).filter((o) => o !== cu && s.relations?.[cu.id < o.id ? `${cu.id}|${o.id}` : `${o.id}|${cu.id}`] && (s.settlements.some((q) => !q.ruined && q.culture === o.id) || s.tribes.some((t) => t.culture === o.id)));
    if (!known.length) return [];
    return [
      h('div', { class: 'econ-head' }, 'How it sees others'),
      h('ul', { class: 'econ-list' }, ...known.map((o) => {
        const v = acceptance(s, cu.id, o.id);
        return h('li', {}, h('span', {}, `The ${o.name}`), h('span', { class: 'muted' }, `${acceptanceWord(v)} (${v >= 0 ? '+' : ''}${v.toFixed(2)})`));
      })),
    ];
  };
  /** A culture: pillars, traditions (with their degree, and whether they are rising or fading), behaviours, and its people. */
  /** What a culture's people have grown used to in hard country (adapt.ts). */
  const adaptPart = (cu: LiveCulture): HTMLElement[] => {
    const a = cu.adapt;
    const names = { heat: 'heat', cold: 'cold', wet: 'endless rain', dry: 'dry country', altitude: 'heights' } as const;
    const gained = a ? (Object.keys(names) as (keyof typeof names)[]).filter((k) => a[k] >= 0.05) : [];
    if (!gained.length) return [];
    return [
      h('div', { class: 'econ-head' }, 'Grown used to'),
      h('div', {}, gained.map((k) => `${names[k]} +${a![k].toFixed(1)}`).join(' · ')),
      h('div', { class: 'muted' }, 'Tolerance its people have gained over the generations by living where their race once found it too hard (up to two levels; adaptable races such as humans adapt three times as fast). Their kin elsewhere bear no more than before.'),
    ];
  };
  /** A culture's traits (traits.ts): its family and level, core and regional traits, how fast each changes, and the cultures most like it. */
  const traitsPart = (cu: LiveCulture): (HTMLElement | null)[] => {
    const L = lib();
    const s = sim!;
    const all = s.cultures ?? [];
    const b = bundleOf(L, cu);
    const tn = (id: string) => L.traditions.find((t) => t.id === id)?.name ?? id;
    const row = (label: string, value: string) => h('div', {}, h('span', { class: 'muted' }, `${label}: `), value || '—');
    const living = all.filter((q) => q !== cu && (s.settlements.some((st) => !st.ruined && st.culture === q.id) || s.tribes.some((t) => t.culture === q.id)));
    const near = living.map((q) => ({ q, v: similarity(L, all, cu, q) })).sort((x, y) => y.v - x.v).slice(0, 3);
    const tie = (q: LiveCulture) => (q.id === cu.parent ? 'its parent' : q.parent === cu.id ? 'grown from it' : q.parent && q.parent === cu.parent ? 'a sister' : treeNearness(all, cu, q) > 0 ? 'same family' : '');
    return [
      h('div', {}, `${levelOf(cu) === 'subculture' ? 'A subculture' : 'A culture'} of ${familyName(all, cu)}.`),
      h('div', { class: 'econ-head' }, 'Core traits (who they are)'),
      row('Language', (() => {
        const l = languageOf(s, b.language);
        const up = l?.parent ? languageOf(s, l.parent) : undefined;
        return `${langName(s, b.language)}${up ? ` (grown from ${up.name})` : ''}`;
      })()),
      row('Religion', faithOf(s, b.religion)?.name ?? ''),
      row('Values', `${b.values || '—'}; ${b.fighting ? b.fighting.toLowerCase() : 'who fights unsettled'}`),
      row('Law', b.law),
      row('Kinship', b.kinship),
      row('Customs', b.customs.map(tn).join(', ')),
      h('div', { class: 'econ-head' }, 'Way of life (varies by region)'),
      row('Ways', [...b.ways.map(tn), ...cu.lifestyles.filter((l) => !b.ways.some((w) => tn(w).startsWith(l)))].join(', ')),
      row('Builds with', b.material.building),
      row('Wears', b.material.dress),
      row('Eats', b.material.food),
      h('div', { class: 'muted small' }, `How fast each changes: ${TRAITS.map((t) => `${t.name.toLowerCase()} ${t.speed}`).join('; ')}.`),
      near.length ? h('div', {}, h('span', { class: 'muted' }, 'Most alike: '), near.map(({ q, v }) => `${q.name} ${Math.round(v * 100)}%${tie(q) ? ` (${tie(q)})` : ''}`).join(', ')) : null,
    ];
  };
  /** Every tongue, as family trees: languages, their dialects and daughters, with their speakers; ended ones dimmed. */
  const languagesCard = (): HTMLElement => {
    const s = sim!;
    const langs = s.languages ?? [];
    const spk = speakers(s);
    const kids = (id: string) => langs.filter((l) => l.parent === id);
    const line = (l: LiveLanguage, depth: number): HTMLElement[] => {
      const n = Math.round(spk.get(l.id) ?? 0);
      const what = l.kind === 'dialect' ? 'dialect' : l.parents && l.parents.length > 1 ? `creole of ${l.parents.map((id) => langName(s, id)).join(' and ')}` : depth ? 'language' : 'language family';
      const row = h('div', { class: l.ended !== undefined ? 'muted' : '', style: `padding-left:${depth * 14}px` },
        `${depth ? '└ ' : ''}${l.name}`,
        h('span', { class: 'muted' }, ` · ${what}${l.ended !== undefined ? `, no longer spoken (since year ${yearOf(l.ended)})` : ` · ${n.toLocaleString()} speakers`}${depth ? ` · since year ${yearOf(l.founded)}` : ''}`),
      );
      return [row, ...kids(l.id).flatMap((k) => line(k, depth + 1))];
    };
    const roots = langs.filter((l) => !l.parent || !langs.some((q) => q.id === l.parent));
    return h('details', { class: 'culture-card small' },
      h('summary', {}, `${langs.filter((l) => l.ended === undefined).length} tongues spoken · ${roots.length} famil${roots.length === 1 ? 'y' : 'ies'}`),
      h('div', { class: 'tribe-card econ' }, ...roots.flatMap((r) => line(r, 0)),
        h('div', { class: 'muted small' }, 'A region far from its heartland comes to speak a dialect; a people grown apart makes it a language of its own; peoples blending make a creole. Children take up the tongue most spoken round them.')),
    );
  };
  const cultureCard = (cu: LiveCulture): HTMLElement => {
    const L = lib();
    const s = sim!;
    const people = s.settlements.filter((q) => !q.ruined && q.culture === cu.id).reduce((n, q) => n + q.pop, 0) + s.tribes.filter((t) => t.culture === cu.id).reduce((n, t) => n + t.pop, 0);
    const places = s.settlements.filter((q) => !q.ruined && q.culture === cu.id).length;
    const roaming = s.tribes.filter((t) => t.culture === cu.id).length;
    const trad = (id: string) => L.traditions.find((t) => t.id === id);
    const held = cu.traditions.filter((t) => t.level >= 0);
    const forming = cu.traditions.filter((t) => t.level < 0 && t.progress > 0.2);
    const trend = (p: number) => (p > 0.25 ? ' · deepening' : p < -0.25 ? ' · fading' : '');
    const sample = cu.sounds.split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
    return h('details', { class: 'culture-card small' },
      h('summary', {}, h('span', { class: 'swatch', style: `background:${cultureColour(s, cu)}` }), h('strong', {}, cu.name), ` · ${Math.round(people).toLocaleString()} people`, h('span', { class: 'muted' }, ` · ${places} settlements, ${roaming} tribes`)),
      h('div', { class: 'tribe-card econ' },
        h('div', {}, cu.source ? 'From the Library.' : cu.blend ? `A blend of the ${cu.blend.map((id) => cultureOf(s, id)?.name ?? '?').join(' and the ')}, born year ${yearOf(cu.founded)}.` : cu.parent ? `Grew apart from the ${cultureOf(s, cu.parent)?.name ?? '?'} in year ${yearOf(cu.founded)}.` : 'A folk culture, grown from its homeland and way of life.'),
        (() => {
          if (cu.sister?.length) return h('div', {}, `A sister culture of the ${cultureOf(s, cu.parent)?.name ?? '?'}: its region lived its own way (${cu.sister.map((k) => `${k[0] === '+' ? '+' : '−'} ${trad(k.slice(1))?.name ?? k.slice(1)}`).join(', ')}).`);
          return null;
        })(),
        (() => {
          const fam = familyOf(s.cultures ?? [], cu);
          if (!fam.kin.length) return null;
          return h('div', {}, `Family of the ${fam.root.name}: ${fam.kin.map((q) => q.name).join(', ')}`);
        })(),
        h('div', {}, `Heritage: ${cu.races.map(raceName).join(', ')}`),
        ...traitsPart(cu),
        sample ? h('div', { class: 'muted' }, `Its sounds: ${sample}`) : null,
        h('div', { class: 'econ-head' }, `Traditions (${held.length} of about ${MAX_TRADITIONS})`),
        held.length
          ? h('ul', { class: 'econ-list' }, ...held.map((t) => {
              const tr = trad(t.id);
              return h('li', { title: tr?.description ?? '' }, h('span', {}, tr?.name ?? t.id, t.hold ? h('span', { class: 'muted' }, ` (${t.hold.toLowerCase()})`) : null), h('span', { class: 'muted' }, `${tr?.levels[t.level]?.name ?? ''}${trend(t.progress)}`));
            }))
          : h('div', { class: 'muted' }, 'None yet.'),
        forming.length ? h('div', { class: 'muted' }, `Taking root: ${forming.map((t) => trad(t.id)?.name ?? t.id).join(', ')}.`) : null,
        cu.specialties.length ? h('div', {}, `Specialties: ${cu.specialties.map((q) => q.name).join(', ')}`) : null,
        ...acceptancePart(cu),
        ...adaptPart(cu),
        h('div', { class: 'econ-head' }, 'Learned behaviours'),
        h('div', {}, cu.behaviours.map((b) => L.behaviours.find((q) => q.id === b)?.name ?? b).join(', ') || 'None yet.'),
        h('div', { class: 'muted' }, 'Traditions are earned by living a certain way for generations (about twenty years a degree) and fade when that life ends; behaviours spread by practice and from neighbours.'),
      ),
    );
  };
  /** A race's starting knowledge beyond survival: a fold of checkboxes by field. */
  const startKnowledge = (row: SetupRow): HTMLElement => {
    const L = lib();
    const chosen = new Set(row.techs ?? []);
    const fields = [...new Set(L.techs.filter((t) => !t.start).map((t) => t.field))];
    const summary = h('summary', {}, chosen.size ? `Knows beyond survival: ${chosen.size}` : 'Knows: survival only');
    return h('details', { class: 'start-know' }, summary,
      h('p', { class: 'muted' }, 'What its first tribes (and dawn city) know beyond gathering, hunting and simple fishing. Anything left out must be discovered or learned.'),
      ...fields.map((f) => h('div', { class: 'know-field' }, h('div', { class: 'econ-head' }, f),
        ...L.techs.filter((t) => !t.start && t.field === f).map((t) => h('label', { class: 'field-row' }, h('input', { type: 'checkbox', checked: chosen.has(t.id), onchange: (e: Event) => {
          if ((e.target as HTMLInputElement).checked) chosen.add(t.id);
          else chosen.delete(t.id);
          row.techs = [...chosen];
          summary.textContent = chosen.size ? `Knows beyond survival: ${chosen.size}` : 'Knows: survival only';
        } }), t.name)))),
    );
  };
  /** What a settlement (or a clan's tribes) knows, what it is likely to come to next, and (for trying things out) a way to give it a technology. */
  const knowledgeCard = (who: { st?: Settlement; clan?: number }): HTMLElement => {
    const L = lib();
    const s = sim!;
    const st = who.st;
    const clan = s.clans.find((c) => c.id === (st ? st.clan : who.clan));
    const learned = (st ? st.techs : clan?.techs) ?? [];
    const techOf = (id: string) => L.techs.find((t) => t.id === id);
    const byField = new Map<string, string[]>();
    for (const id of learned) {
      const t = techOf(id);
      if (!t) continue;
      byField.set(t.field, [...(byField.get(t.field) ?? []), t.name]);
    }
    const next = techOutlook(s, env!, L, st ? { settlement: st.id } : { clan: clan?.id ?? -1 });
    const tiers = techTiers(L.techs);
    const deepest = Math.max(0, ...learned.map((id) => tiers.get(id) ?? 1));
    const archive = st ? hasArchive(L, st, s.day) : false;
    const teach = h('select', { 'aria-label': 'Technology to give' }, h('option', { value: '' }, 'Choose…'), ...L.techs.filter((t) => !t.start && !learned.includes(t.id)).sort((a, b) => a.field.localeCompare(b.field) || a.name.localeCompare(b.name)).map((t) => h('option', { value: t.id }, `${t.field}: ${t.name}`))) as HTMLSelectElement;
    const setTechs = (v: string[]) => {
      if (st) st.techs = v;
      else if (clan) clan.techs = v;
      d.changed();
      render();
    };
    const pct = (p: number) => (p >= 0.095 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : 'under 1%');
    return h('div', { class: 'tribe-card small econ' },
      h('div', { class: 'econ-head' }, st ? 'Knowledge' : 'Knowledge (its clan’s)'),
      learned.length
        ? h('ul', { class: 'econ-list' }, ...[...byField].map(([f, names]) => h('li', { class: 'know-row' }, h('span', { class: 'muted' }, f), h('span', {}, names.join(', ')))))
        : h('div', {}, 'Survival only: gathering, hunting and simple fishing.'),
      st && deepest > 0
        ? h('div', { class: 'muted' }, archive ? 'Its archive keeps what it knows from being forgotten.' : st.archiveBurnedUntil && st.archiveBurnedUntil > s.day ? 'Its archive was burned; what too few remember may be lost.' : `Its deepest knowledge needs about ${keepers(deepest)} people to keep alive without an archive, or neighbours who know it.`)
        : null,
      next.length ? h('div', {}, 'Likely next (chance a year):') : null,
      next.length ? h('ul', { class: 'econ-list' }, ...next.map((n) => h('li', {}, h('span', {}, `${n.tech.name}`, h('span', { class: 'muted' }, n.how === 'learn' ? ' (from those who know it)' : ' (finding it)')), h('span', { class: 'num' }, pct(n.chance))))) : null,
      h('div', { class: 'muted' }, 'To try things out, you can give a technology by hand.'),
      h('div', { class: 'teach-row' }, teach,
        h('button', { type: 'button', class: 'ghost small', onclick: () => { if (teach.value) setTechs([...learned, teach.value]); } }, 'Give'),
        learned.length ? h('button', { type: 'button', class: 'ghost small', onclick: () => setTechs(learned.slice(0, -1)) }, 'Take back the last') : null),
    );
  };
  /** The settlement's market: what is dear and cheap here, and its trade this past year. */
  const marketPart = (st: Settlement): HTMLElement[] => {
    const e = st.economy!;
    const p = e.prices ?? {};
    const name = (id: string) => resInfoOf(env!, id)?.name ?? id;
    const rel = (id: string) => p[id] / baseWorth(env!, id);
    const dear = Object.keys(p).filter((id) => rel(id) >= 1.6).sort((a, b) => rel(b) - rel(a)).slice(0, 5);
    const cheap = Object.keys(e.stores).filter((id) => p[id] && rel(id) <= 0.7).sort((a, b) => rel(a) - rel(b)).slice(0, 5);
    const fmt = (v: number) => (v >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1));
    const row = (id: string) => h('li', {}, h('span', {}, name(id)), h('span', { class: 'num' }, `${fmt(p[id])} (×${rel(id).toFixed(1)})`));
    const partners = sim!.routes
      .filter((r) => r.a === st.id || r.b === st.id)
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 4)
      .map((r) => `${sim!.settlements.find((q) => q.id === (r.a === st.id ? r.b : r.a))?.name ?? '?'} (${r.trips} trips)`);
    const t = e.traded;
    return [
      h('div', { class: 'econ-head' }, 'Market'),
      Object.keys(p).length
        ? h('div', { class: 'muted' }, 'Prices in the one currency (a unit of food at ease is about 1); ×: against its usual worth.')
        : h('div', { class: 'muted' }, 'Prices are set at the turn of the month.'),
      dear.length ? h('div', {}, 'Dear here (wanted):') : null,
      dear.length ? h('ul', { class: 'econ-list' }, ...dear.map(row)) : null,
      cheap.length ? h('div', {}, 'Cheap here (to spare):') : null,
      cheap.length ? h('ul', { class: 'econ-list' }, ...cheap.map(row)) : null,
      h('div', {}, t && t.caravans + t.in + t.out > 0 ? `Trade this year: ${t.caravans} caravan${t.caravans === 1 ? '' : 's'} sent; worth ${fmt(t.out)} out, ${fmt(t.in)} in (by barter).` : 'No trade this year.'),
      partners.length ? h('div', { class: 'muted' }, `Trades with: ${partners.join(', ')}.`) : null,
    ].filter(Boolean) as HTMLElement[];
  };
  const hordeLine = (hd: Horde) => {
    const target = sim?.settlements.find((q) => q.id === hd.target);
    return `${hd.name.charAt(0).toUpperCase() + hd.name.slice(1)}: about ${Math.round(hd.strength)} monsters${target ? `, marching on ${target.name}` : ''}${hd.razed.length ? `; has razed ${hd.razed.join(', ')}` : ''}`;
  };
  const riftLine = (r: Rift) => {
    const holder = r.holder >= 0 ? clanOf(r.holder) : undefined;
    const got = Object.entries(r.lastYield).filter(([, v]) => v >= 0.5).map(([id, v]) => `${Math.round(v)} ${resInfoOf(env!, id)?.name.toLowerCase() ?? id}`);
    return `${r.name} (${r.permanent ? 'permanent' : `short-lived, closing in year ${yearOf(r.closes ?? 0)}`}${r.water ? ', a spring' : ''}): strength ${Math.round(r.strength * 100)}%${r.strength >= 1 ? ' (at breaking point)' : ''}; ${holder ? `${realmName(lib(), holder)}, ${HOLD_NAMES[r.hold].toLowerCase()}` : 'nobody holds it'}${got.length ? `; last year ${got.join(', ')}` : ''}`;
  };
  const settlementLine = (st: Settlement) => {
    const what = settlementTier(st).toLowerCase();
    if (st.ruined) return `Ruins of ${st.name} (${what})${st.holyTo.length ? `, holy to the ${st.holyTo.map(raceName).join(', ')}` : ''}`;
    const cn = clanOf(st.clan);
    const occ = st.occupied ? clanOf(st.occupied.by) : undefined;
    return `${st.name} (${what}${cn?.realm?.capital === st.id ? ', capital' : ''}, ${cn ? realmName(lib(), cn) : '?'}${occ ? `; held by ${realmName(lib(), occ)}` : ''}): ${Math.round(st.pop)} people, ${Math.round(Math.min(1, st.fed) * 100)}% fed${st.partOf !== undefined ? `; part of ${sim?.settlements.find((q) => q.id === st.partOf)?.name ?? '?'}` : ''}${st.holyTo.length ? `; holy to the ${st.holyTo.map(raceName).join(', ')}` : ''}`;
  };
  const tribeAt = (x: number, y: number, pk: number): Tribe | null => {
    if (!sim || !env) return null;
    let best: Tribe | null = null;
    let bd = 12 * pk;
    for (const t of sim.tribes) {
      let dx = Math.abs(t.x - x);
      if (env.wrapKm) dx = Math.min(dx, env.wrapKm - dx);
      const dd = Math.hypot(dx, t.y - y);
      if (dd < bd) {
        bd = dd;
        best = t;
      }
    }
    return best;
  };

  // ---------------------------------------------------------------------------------------------
  // The panel

  const panel = h('section', { class: 'view-panel peoples' });
  const render = () => {
    // The resource panel follows the selection (and what it holds).
    queueMicrotask(() => d.selectionChanged?.());
    updateBar();
    const c = cl();
    if (!c || !env || !sim) {
      panel.replaceChildren(h('h2', {}, 'Peoples'), h('p', { class: 'muted small' }, 'Working out the climate first: the peoples live by it.'));
      return;
    }
    if (!env.prov.real) {
      panel.replaceChildren(
        h('h2', {}, 'Peoples'),
        h('p', { class: 'notice small' }, 'The peoples hold land by province: make the provinces first (Provinces tab). Saved peoples from before provinces carry on once there are provinces, each province going to whoever held most of it.'),
        ...(d.openProvinces ? [h('button', { type: 'button', class: 'primary', onclick: () => d.openProvinces?.() }, 'Open the Provinces tab')] : []),
      );
      return;
    }
    if (gridProblem) {
      panel.replaceChildren(
        h('h2', {}, 'Peoples'),
        h('p', { class: 'notice small' }, 'The map has changed size since these peoples were placed (the climate is worked out on a new grid). Start them again to go on.'),
        h('button', { type: 'button', class: 'primary', onclick: () => { gridProblem = false; sim = newSim(env!, d.world().settings.seed); selected = null; d.changed(); render(); d.redraw(); } }, 'Start again'),
      );
      return;
    }
    const s = sim;
    const L = lib();
    const ok = eligibleRaces(L);
    const incomplete = L.species.filter((sp) => !sp.setAside).flatMap((sp) => sp.races.filter((r) => raceMissing(r).length));
    const parts: (HTMLElement | null)[] = [h('h2', {}, 'Peoples')];

    // Showing on the map
    const beasts = env.beastInfo;
    const beastSelect = h('select', { 'aria-label': 'Beast to show', onchange: (e: Event) => { showBeast = (e.target as HTMLSelectElement).value; beastDirty = true; d.redraw(); } },
      h('option', { value: '' }, 'No beasts'),
      ...beasts.map((b) => h('option', { value: b.id, selected: b.id === showBeast }, b.name)),
    );
    const display = h('div', { class: 'group' },
      choice<'on' | 'off'>('Clan lands', [{ value: 'on', label: 'Clan lands shown' }, { value: 'off', label: 'Hidden' }], showLand ? 'on' : 'off', (v) => { showLand = v === 'on'; d.redraw(); }),
      choice<'clan' | 'culture' | 'faith'>('Colour lands by', [{ value: 'clan', label: 'Realm' }, { value: 'culture', label: 'Culture' }, { value: 'faith', label: 'Faith' }], landsBy, (v) => { landsBy = v; landDirty = true; d.redraw(); render(); }),
      choice<'on' | 'off'>('Ways', [{ value: 'on', label: 'Trails, roads and railways shown' }, { value: 'off', label: 'Hidden' }], showWays ? 'on' : 'off', (v) => { showWays = v === 'on'; d.redraw(); }),
      h('div', { class: 'way-key small' }, ...WAYS.slice(1).map((w) => h('span', {}, h('span', { class: `way-swatch way-${w.id}` }), `${w.name} (×${w.speed} speed)`)), h('span', {}, h('span', { class: 'way-swatch way-trade' }), 'Trade route in use'), h('span', {}, h('span', { class: 'way-swatch way-artery' }), `Great trade artery (${ARTERY} or more routes on one way)`)),
      choice<'on' | 'off'>('Trade', [{ value: 'on', label: 'Trade routes and caravans shown' }, { value: 'off', label: 'Hidden' }], showTrade ? 'on' : 'off', (v) => { showTrade = v === 'on'; d.redraw(); }),
      h('div', { class: 'field' }, h('label', {}, 'Where beasts live'), beastSelect, h('small', {}, 'Yellow is few, red is many: as many as the land can carry, thinned where they are hunted.')),
      h('div', { class: 'field' }, h('label', {}, 'Where resources are'),
        h('select', { 'aria-label': 'Resource to show', onchange: (e: Event) => { showRes = (e.target as HTMLSelectElement).value; resDirty = true; d.redraw(); } },
          h('option', { value: '' }, 'No resources'),
          ...[...env.resInfo].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)).map((r) => h('option', { value: r.id, selected: r.id === showRes }, `${r.category}: ${r.name}`)),
        ),
        h('small', {}, 'Green where it is found; deeper where the land is better for it (or the deposit richer). From the Library’s resources: their climates, ground cover and terrain.'),
      ),
      h('label', { class: 'field-row small' }, h('input', { type: 'checkbox', checked: follow, onchange: (e: Event) => { follow = (e.target as HTMLInputElement).checked; } }), 'Map follows the season'),
    );

    if (!s.started) {
      // Setting up: which races, how many tribes, placed automatically, then by hand.
      if (!ok.length) {
        parts.push(
          h('p', { class: 'notice small' }, 'No race is complete yet, so none can take part. A race needs its size, all its stats, its fighting age and its lifespan.'),
          h('p', { class: 'small' }, `${incomplete.length} races are missing something. Fill them in in the Library (the Peoples tab there has a quick table for size, fighting age and lifespan).`),
          h('button', { type: 'button', class: 'primary', onclick: d.openLibrary }, 'Open the Library'),
        );
        panel.replaceChildren(...parts.filter(Boolean) as HTMLElement[]);
        return;
      }
      if (!draft.size) for (const r of s.setup.length ? s.setup : ok.map((o) => ({ race: o.race.id, tribes: 6, start: 'tribes' as StartKind, cityPop: 800 }))) draft.set(r.race, { start: 'tribes', cityPop: 800, ...r });
      if (!addRace || !ok.some((o) => o.race.id === addRace)) addRace = ok[0].race.id;
      const rows = ok.map(({ race }) => {
        const row = draft.get(race.id) ?? { race: race.id, tribes: 0, start: 'tribes' as StartKind, cityPop: 800 };
        draft.set(race.id, row);
        const on = row.tribes > 0 || row.start !== 'tribes';
        const num = (value: number, max: number, label: string, set: (v: number) => void, off = false) =>
          h('input', { type: 'number', min: 0, max, step: 1, value: String(value), disabled: off, 'aria-label': label, onchange: (e: Event) => set(Math.max(0, Math.min(max, Math.round(Number((e.target as HTMLInputElement).value) || 0)))) });
        const start = row.start ?? 'tribes';
        return h('div', { class: 'race-row' },
          h('label', { class: 'field-row small race-name' }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; row.tribes = v ? 6 : 0; if (!v) row.start = 'tribes'; render(); } }), raceName(race.id)),
          on
            ? h('div', { class: 'race-opts small' },
                h('label', {}, 'Begins as ', h('select', { 'aria-label': `How the ${race.name} begin`, onchange: (e: Event) => { row.start = (e.target as HTMLSelectElement).value as StartKind; if (row.start !== 'dawn' && !row.tribes) row.tribes = 6; render(); } },
                  ...([['tribes', 'Tribes'], ['dawn', 'Dawn city'], ['both', 'Dawn city and tribes']] as const).map(([v, l]) => h('option', { value: v, selected: start === v }, l)))),
                start !== 'dawn' ? h('label', {}, num(row.tribes, 40, `Tribes of ${race.name}`, (v) => (row.tribes = v)), ' tribes') : null,
                start !== 'tribes' ? h('label', {}, num(row.cityPop ?? 800, 20000, `People in the dawn city of the ${race.name}`, (v) => (row.cityPop = Math.max(30, v))), ' in the city') : null,
                startKnowledge(row),
                h('div', { class: 'muted' }, startCultureText(race.id)),
              )
            : null,
        );
      });
      parts.push(
        h('p', { class: 'muted small' }, 'Choose who takes part and how each begins: as scattered tribes, at its dawn city (where the race woke, holy to all of it wherever they go), or both. They are placed where the land suits them best; then drag tribes and dawn cities to move them, or add and remove tribes. Press Play (above the map) to begin.'),
        h('div', { class: 'race-pick' }, ...rows),
        incomplete.length ? h('p', { class: 'muted small' }, `${incomplete.length} more races can take part once they are complete in the Library.`, ' ', h('button', { type: 'button', class: 'ghost small', onclick: d.openLibrary }, 'Library')) : null,
        h('button', { type: 'button', class: 'primary', onclick: () => {
          if (d.climateBusy()) {
            toast('The climate is still being worked out after your last change. Place them in a moment, once it is done.');
            return;
          }
          const setup = [...draft.values()].filter((r) => r.tribes > 0 || r.start !== 'tribes');
          if (!setup.length) {
            toast('Tick at least one race.');
            return;
          }
          placeStart(s, env!, L, setup, c.zone);
          selected = null;
          landDirty = true;
          d.changed();
          render();
          d.redraw();
          const cities = s.settlements.length;
          toast(s.tribes.length || cities ? `Placed ${cities ? `${cities} dawn ${cities === 1 ? 'city' : 'cities'} and ` : ''}${s.tribes.length} tribes in ${s.clans.length} clans.` : 'No land here suits them: paint some land first, or check the races’ climates in the Library.');
        } }, s.tribes.length || s.settlements.length ? 'Place again automatically' : 'Place automatically'),
        h('h3', {}, 'On the map'),
        choice<'select' | 'add'>('Map tool', [{ value: 'select', label: 'Select & move' }, { value: 'add', label: 'Add' }], mode, (v) => { mode = v; render(); }),
        mode === 'add'
          ? h('div', { class: 'group' },
              choice<'tribe' | 'dawn' | 'people'>('What', [{ value: 'tribe', label: 'A tribe' }, { value: 'dawn', label: 'The dawn city' }, { value: 'people', label: 'People in provinces' }], addWhat, (v) => { addWhat = v; render(); }),
              h('div', { class: 'field' }, h('label', {}, 'Race'), h('select', { onchange: (e: Event) => { addRace = (e.target as HTMLSelectElement).value; } }, ...ok.map((o) => h('option', { value: o.race.id, selected: o.race.id === addRace }, raceName(o.race.id))))),
              addWhat === 'tribe'
                ? choice<'new' | 'selected'>('Clan', [{ value: 'new', label: 'A new clan' }, { value: 'selected', label: 'The selected tribe’s clan', disabled: selected === null }], addClan, (v) => { addClan = v; })
                : null,
              addWhat === 'people'
                ? h('div', {},
                    h('div', { class: 'field' }, h('label', {}, 'People per province'), h('select', { onchange: (e: Event) => { addPeople = Number((e.target as HTMLSelectElement).value); render(); } }, ...[0, 100, 250, 500, 1000, 2500, 5000, 10000, 25000].map((v) => h('option', { value: String(v), selected: v === addPeople }, v ? v.toLocaleString() : 'None (clear)')))),
                    numberField({ label: 'Or exactly', value: addPeople, min: 0, max: 100000, step: 50, change: (v) => { addPeople = Math.max(0, Math.min(100000, Math.round(v))); } }),
                    choice<'nearest' | 'selected'>('Whose people', [{ value: 'nearest', label: 'The nearest clan of the race' }, { value: 'selected', label: 'The selected one’s clan', disabled: selected === null }], addPeopleClan, (v) => { addPeopleClan = v; }),
                  )
                : null,
              h('p', { class: 'muted small' }, addWhat === 'dawn' ? 'Click the map to set the race’s dawn city there (each race has one: if it has one already, it moves).' : addWhat === 'people' ? 'Click a province, or drag across several, to give each that many of the race living in its countryside (it replaces the race’s people already there; None clears them). They are the clan’s people, of its culture and faith, and the clan takes any province no one holds. A farming clan’s people fill the land up to what its farms feed; others live off the wild, which feeds far fewer, so the rest die back. Show the population heat map (View) to see them.' : 'Click the map to place a tribe there.'),
            )
          : h('p', { class: 'muted small' }, 'Click a tribe or dawn city to see it; drag it to move it (a tribe’s summer and winter grounds move with it).'),
      );
    } else {
      // Running: how things stand.
      const living = s.settlements.filter((q) => !q.ruined);
      const people = s.tribes.reduce((n, t) => n + t.pop, 0) + living.reduce((n, q) => n + q.pop, 0);
      const land = clanLand(s, env);
      parts.push(
        h('p', { class: 'summary' }, `${dateText(s.day)}\n${s.tribes.length} tribes and ${living.length} settlements in ${s.clans.length} clans, ${Math.round(people).toLocaleString()} people`),
      );
      const clanRows = [...s.clans]
        .map((cn) => ({ cn, tribes: [...s.tribes.filter((t) => t.clan === cn.id), ...s.settlements.filter((q) => !q.ruined && q.clan === cn.id)] }))
        .sort((a, b) => b.tribes.reduce((n, t) => n + t.pop, 0) - a.tribes.reduce((n, t) => n + t.pop, 0))
        .map(({ cn, tribes }) =>
          h('tr', { class: `clickable${selectedRealm === cn.id ? ' picked' : ''}`, onclick: () => { selectedRealm = selectedRealm === cn.id ? null : cn.id; selected = null; render(); d.redraw(); } },
            h('td', {}, h('span', { class: 'swatch', style: `background:${cn.colour}` }), realmName(L, cn), h('div', { class: 'muted' }, `${raceName(cn.race)}${cn.realm ? ` · ${rulerTitle(L, cn)} ${cn.realm.ruler.name}` : ''}`)),
            h('td', { class: 'num' }, `${tribes.filter((q) => !('summer' in q)).length} / ${tribes.filter((q) => 'summer' in q).length}`),
            h('td', { class: 'num' }, Math.round(tribes.reduce((n, t) => n + t.pop, 0)).toLocaleString()),
            h('td', { class: 'num' }, Math.round((land.get(cn.id) ?? 0) * SQ_MI).toLocaleString()),
          ),
        );
      parts.push(
        h('h3', {}, 'Realms'),
        h('p', { class: 'muted small' }, 'Every clan is a realm, from a band of tribes under its chief to a kingdom or empire. Click one to see how it is ruled.'),
        h('div', { class: 'table-scroll' }, h('table', { class: 'clan-table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Realm'), h('th', {}, 'Towns / tribes'), h('th', {}, 'People'), h('th', {}, 'Land, sq mi'))), h('tbody', {}, ...clanRows))),
      );
      const rc = s.clans.find((q) => q.id === selectedRealm);
      if (rc) parts.push(realmCard(rc));
      if (s.settlements.length) {
        const order = [...s.settlements].sort((a, b) => (a.kind === 'dawn' ? 0 : 1) - (b.kind === 'dawn' ? 0 : 1) || b.pop - a.pop);
        parts.push(
          h('h3', {}, 'Settlements'),
          h('div', { class: 'table-scroll' }, h('table', { class: 'clan-table small' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'People'))),
            h('tbody', {}, ...order.map((q) => h('tr', { class: 'clickable', onclick: () => { selected = q.id; render(); d.redraw(); } },
              h('td', {}, h('span', { class: 'swatch', style: `background:${q.ruined ? '#888' : clanOf(q.clan)?.colour ?? '#888'}` }), q.name, q.kind === 'dawn' ? h('span', { class: 'holy-tag' }, ' dawn city') : null, h('div', { class: 'muted' }, raceName(q.race))),
              h('td', { class: 'num' }, q.ruined ? 'ruins' : Math.round(q.pop).toLocaleString()),
            ))),
          )),
        );
      }
    }

    // Wars, going on and lately ended.
    const wars = [...activeWars(s), ...(s.wars ?? []).filter((w) => w.ended !== undefined).slice(-6).reverse()];
    const openBattle = (s.battles ?? []).find((b) => b.id === selectedBattle);
    if (openBattle) parts.push(h('h3', {}, 'Battle report'), battleReport(openBattle));
    if (s.started && (s.rifts ?? []).length) parts.push(
      h('h3', {}, 'Rifts'),
      h('p', { class: 'muted small' }, 'Rifts open where mana runs dense and nothing draws on it, where corruption runs high, and now and then anywhere; short-lived ones close in a few years. The realm holding the land works them (an encampment, soldiers, or parties) for goods rare or not found in the mortal plane; a rift left alone grows toward breaking. On the map: violet eyes, ringed gold (encampment), red (soldiers), blue (parties) or dark (left alone); dashed while short-lived; a blue drop where fresh water wells up.'),
      h('ul', { class: 'econ-list small' }, ...(s.rifts ?? []).map((r) => h('li', {}, h('span', {}, riftLine(r))))),
    );
    if (s.started && ((s.tides ?? []).length || (s.hordes ?? []).length)) parts.push(
      h('h3', {}, 'Monster tides and hordes'),
      h('p', { class: 'muted small' }, 'A rift at breaking point with nothing (or too little) holding it breaks: monsters pour out and spread slowly, province by province, besieging and overrunning the towns they reach, while the realms there fight back. After a year and a half alphas come through and lead hordes against the towns round about. On the map: tide provinces shaded dark red; hordes as black shields with their alpha named.'),
      h('ul', { class: 'econ-list small' },
        ...(s.tides ?? []).map((t) => h('li', {}, h('span', {}, `${t.name}: about ${Math.round(t.strength)} monsters across ${t.provinces.length} province${t.provinces.length === 1 ? '' : 's'}, since year ${yearOf(t.started)}`))),
        ...(s.hordes ?? []).map((hd) => h('li', {}, h('span', {}, hordeLine(hd)))),
      ),
    );
    if (s.started && wars.length) parts.push(h('h3', {}, 'Wars'), h('p', { class: 'muted small' }, 'Settled realms go to war for a reason (a claim, a throne, their faith, vengeance, their own people, or plain conquest). Banners on the map are armies; crossed swords are battles.'), ...wars.map((w) => warCard(w)));

    // Treaties, the world over.
    const treaties = Object.entries(s.realmRelations ?? {}).flatMap(([k, rel]) => {
      const [a, b] = k.split('|').map(Number);
      const A = clanOf(a);
      const B = clanOf(b);
      return A && B && rel.pacts.length ? [{ A, B, rel }] : [];
    });
    if (s.started && (treaties.length || s.spies?.length)) {
      const L = lib();
      parts.push(
        h('h3', {}, 'Treaties'),
        h('p', { class: 'muted small' }, 'Realms whose people have learned to send envoys make pacts. Breaking a promise of peace without cause is remembered by everyone; defending an ally is a justified break.'),
        treaties.length
          ? h('ul', { class: 'treaty-list small' }, ...treaties.map(({ A, B, rel }) => h('li', {},
              h('div', {}, h('span', { class: 'swatch', style: `background:${A.colour}` }), realmName(L, A), ' & ', h('span', { class: 'swatch', style: `background:${B.colour}` }), realmName(L, B)),
              h('div', { class: 'muted' }, rel.pacts.map((p) => `${PACT_NAMES[p.kind]}${p.roads ? ' (shared roads and bridges)' : ''} since Y${yearOf(p.since)}`).join(' · ')))))
          : h('p', { class: 'muted small' }, 'No treaties yet.'),
        s.spies?.length ? h('p', { class: 'small' }, `${s.spies.length} spy${s.spies.length === 1 ? '' : 'ies'} abroad (dark dots on the map).`) : null,
      );
    }

    // Trade, the world over.
    if (s.started && (s.routes.length || s.caravans.length)) {
      const top = [...s.routes].sort((a, b) => b.trips - a.trips).slice(0, 6);
      const nm = (id: number) => s.settlements.find((q) => q.id === id)?.name ?? '?';
      // Goods whose price differs most between markets: what trade moves.
      const live = s.settlements.filter((q) => !q.ruined && q.economy?.prices);
      const goods = env.resInfo
        .map((r) => {
          const ps = live.map((q) => ({ q, v: q.economy!.prices![r.id] })).filter((o) => o.v > 0);
          if (ps.length < 2) return null;
          ps.sort((a, b) => a.v - b.v);
          const avg = ps.reduce((n, o) => n + o.v, 0) / ps.length;
          return { r, avg, lo: ps[0], hi: ps[ps.length - 1], spread: ps[ps.length - 1].v / ps[0].v };
        })
        .filter((g): g is NonNullable<typeof g> => !!g && g.spread > 1.5 && live.some((q) => (q.economy!.stores[g.r.id] ?? 0) > 1))
        .sort((a, b) => b.spread - a.spread)
        .slice(0, 8);
      const fmt = (v: number) => (v >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1));
      parts.push(
        h('h3', {}, 'Trade'),
        h('p', { class: 'small' }, `${s.caravans.length} caravan${s.caravans.length === 1 ? '' : 's'} on the road; ${s.routes.length} trade route${s.routes.length === 1 ? '' : 's'}. Caravans go up to about 25 days' walk; both sides must gain (barter).`),
        top.length ? h('div', { class: 'small econ-head' }, 'Busiest routes') : null,
        top.length ? h('ul', { class: 'econ-list small' }, ...top.map((r) => h('li', {}, h('span', {}, `${nm(r.a)} ↔ ${nm(r.b)}`), h('span', { class: 'num' }, `${r.trips} trips`)))) : null,
        goods.length ? h('div', { class: 'small econ-head' }, 'Prices across the markets') : null,
        goods.length
          ? h('table', { class: 'clan-table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Good'), h('th', {}, 'Cheapest'), h('th', {}, 'Dearest'))),
              h('tbody', {}, ...goods.map((g) => h('tr', {}, h('td', {}, g.r.name, h('div', { class: 'muted' }, `avg ${fmt(g.avg)}`)), h('td', { class: 'num' }, fmt(g.lo.v), h('div', { class: 'muted' }, g.lo.q.name)), h('td', { class: 'num' }, fmt(g.hi.v), h('div', { class: 'muted' }, g.hi.q.name))))))
          : null,
      );
    }

    // Cultures: each with its pillars, traditions, behaviours and people.
    const living = (s.cultures ?? []).filter((cu) => s.settlements.some((q) => !q.ruined && q.culture === cu.id) || s.tribes.some((t) => t.culture === cu.id));
    if (living.length)
      parts.push(
        h('h3', {}, 'Cultures'),
        ...living.map((cu) => cultureCard(cu)),
      );
    if (sim?.languages?.length) parts.push(h('h3', {}, 'Languages'), languagesCard());

    // Faiths and the gods.
    const believed = (s.faiths ?? []).filter((f) => s.settlements.some((q) => !q.ruined && q.faith === f.id) || s.tribes.some((t) => t.faith === f.id));
    if (believed.length) parts.push(h('h3', {}, 'Faiths'), h('p', { class: 'muted small' }, 'Every people has a faith from the start: a Library faith of its culture or species, else the folk belief of its homeland. Towns are drawn to their neighbours’ and their ruler’s faith; holy places and fervour hold them.'), ...believed.map((f) => faithCard(f)));
    if (s.started) parts.push(...godsPart());

    // Technology, the world over: what is known anywhere, how widely, and who came to it first.
    if (s.started) {
      const holders = [...s.settlements.filter((q) => !q.ruined).map((q) => q.techs ?? []), ...s.clans.filter((c) => s.tribes.some((t) => t.clan === c.id)).map((c) => c.techs ?? [])];
      const count = new Map<string, number>();
      for (const list of holders) for (const id of list) count.set(id, (count.get(id) ?? 0) + 1);
      const known = L.techs.filter((t) => count.has(t.id));
      const fields = [...new Set(known.map((t) => t.field))];
      parts.push(
        h('h3', {}, 'Technology'),
        h('p', { class: 'small' }, known.length ? `${known.length} of ${L.techs.filter((t) => !t.start).length} technologies are known somewhere, among ${holders.length} settlements and roaming clans.` : 'Nothing beyond survival is known yet: peoples will discover it by living (gathering leads to farming, hunting to herding…).'),
        ...fields.map((f) => h('div', { class: 'small' },
          h('div', { class: 'econ-head' }, f),
          h('ul', { class: 'econ-list' }, ...known.filter((t) => t.field === f).map((t) => {
            const first = s.firsts?.[t.id];
            return h('li', { title: first ? `First: ${first.by}, year ${yearOf(first.day)}` : '' }, h('span', {}, t.name, first ? h('span', { class: 'muted' }, ` · first: ${first.by}, Y${yearOf(first.day)}`) : null), h('span', { class: 'num' }, `${count.get(t.id)} of ${holders.length}`));
          })),
        )),
      );
    }

    // The selected tribe
    const t = s.tribes.find((q) => q.id === selected);
    if (t) {
      const ri = raceInfo(L, t.race, t.culture);
      const clan = clanOf(t.clan);
      parts.push(
        h('h3', {}, t.name),
        h('div', { class: 'tribe-card small' },
          h('div', {}, h('span', { class: 'swatch', style: `background:${clan?.colour ?? '#888'}` }), `Clan ${clan?.name ?? '?'} · ${raceName(t.race)}`),
          cultureLine(t.culture),
          faithLine(t.faith),
          h('div', {}, `${Math.round(t.pop)} people · warband ${Math.round(t.warband)}${t.away ? ` (${Math.round(t.away)} away fighting)` : ''}`),
          s.started ? h('div', {}, `Food last month: ${Math.round(Math.min(9.99, t.fed) * 100)}% of need${t.fed < 0.8 ? ' (hungry)' : ''}`) : null,
          ri ? h('div', { class: 'muted' }, `Walks about ${Math.round(ri.speed * 0.621)} miles a day; forages and hunts about ${Math.round(ri.range * 0.621)} miles around. ${ri.lifestyle}.`) : null,
          h('div', { class: 'muted' }, 'Dashed lines: its summer (S) and winter (W) grounds.'),
        ),
        knowledgeCard({ clan: t.clan }),
        !s.started
          ? h('div', { class: 'group' },
              numberField({ label: 'People', value: Math.round(t.pop), min: 15, max: 2000, step: 5, change: (v) => { t.pop = Math.max(15, Math.min(2000, Math.round(v))); if (ri) t.warband = Math.round(t.pop * ri.warShare); d.changed(); } }),
              h('button', { type: 'button', class: 'ghost small danger', onclick: () => { removeTribe(s, t.id); selected = null; landDirty = true; d.changed(); render(); d.redraw(); } }, 'Remove this tribe'),
            )
          : null,
      );
    }
    const st = s.settlements.find((q) => q.id === selected);
    if (st) {
      const ri = raceInfo(L, st.race, st.culture);
      const clan = clanOf(st.clan);
      parts.push(
        h('h3', {}, st.name),
        h('div', { class: 'tribe-card small' },
          h('div', {}, st.kind === 'dawn' ? `Dawn city of the ${raceName(st.holyTo[0] ?? st.race)} (${tierName(st).toLowerCase()})` : `${tierName(st)}${st.villageSince !== undefined ? `, a village since year ${yearOf(st.villageSince)}` : ''}`),
          st.partOf !== undefined ? h('div', {}, `Part of ${s.settlements.find((q) => q.id === st.partOf)?.name ?? '?'}: its people work and eat with the town's, and its goods go to the town's stores.`) : null,
          st.layer ? h('div', {}, `In ${LAYER_NAMES[st.layer]}${st.layer.startsWith('sky') ? ' (on an island; it moves if the island drifts)' : st.layer === 'underdark' ? ' (fed by its fungus farms and the land above)' : ' (up a giant tree)'}.`) : null,
          st.holyTo.length ? h('div', { class: 'holy-tag' }, `Holy to all the ${st.holyTo.map(raceName).join(', ')}, wherever they are${st.ruined ? ', even in ruin' : ''}.`) : null,
          st.tower !== undefined && !st.ruined ? h('div', {}, `A mage tower (raised in year ${yearOf(st.tower)}): a node on the ley lines; mana here is ${env ? manaWord(manaAtPlace(sim!, env, st.x, st.y)) : '?'}.`) : null,
          st.ruined
            ? h('div', {}, 'In ruins. Those who come to it may build it again (its own people most of all).')
            : h('div', {}, h('span', { class: 'swatch', style: `background:${clan?.colour ?? '#888'}` }), h('span', { class: 'link', onclick: () => { if (clan) { selectedRealm = clan.id; selected = null; render(); d.redraw(); } } }, clan ? realmName(L, clan) : '?'), ` · ${raceName(st.race)}`),
          !st.ruined && clan?.realm && s.started
            ? h('div', {}, clan.realm.capital === st.id ? `The capital, seat of ${rulerTitle(L, clan)} ${clan.realm.ruler.name}.` : `Its realm's hold here: ${Math.round((st.control ?? 0) * 100)}%`, clan.realm.capital === st.id ? null : h('span', { class: 'muted' }, ' (from the days an order takes to come from the capital, and the realm’s centralization)'))
            : null,
          !st.ruined && st.occupied
            ? h('div', { class: 'warn' }, `Held by ${clanOf(st.occupied.by) ? realmName(L, clanOf(st.occupied.by)!) : '?'} since year ${yearOf(st.occupied.since)} (a garrison of ${Math.round(st.occupied.garrison)}).`)
            : null,
          !st.ruined ? h('div', { class: 'muted' }, `Walls: ${WALL_NAMES[wallLevel(L, st, clan?.realm?.capital === st.id)]}.`) : null,
          !st.ruined && st.besieged
            ? (() => {
                const by = (s.armies ?? []).find((q) => q.id === st.besieged!.by);
                return h('div', { class: 'warn' }, `Under siege by the ${by?.name ?? 'enemy'} for ${s.day - st.besieged!.since} days${by?.siege?.breach ? `; walls ${Math.round(by.siege.breach * 100)}% breached` : ''}. Only the fields within the walls are worked, and no caravans go out.`);
              })()
            : null,
          !st.ruined && st.prince ? h('div', {}, `Ruled for its realm by the high prince of the house of ${st.prince} (its old ruling line).`) : null,
          !st.ruined && st.claimedBy?.some((q) => clanOf(q)) ? h('div', { class: 'muted' }, `Claimed by ${st.claimedBy.map((q) => clanOf(q)).filter((q): q is Clan => !!q).map((q) => realmName(L, q)).join(', ')} (who once held it).`) : null,
          !st.ruined && s.started && st.loyalty !== undefined && clan?.realm?.capital !== st.id
            ? h('div', {}, `Loyalty: ${Math.round(st.loyalty * 100)}%${st.unrest ? `, discontented for ${st.unrest} year${st.unrest === 1 ? '' : 's'}` : ''}`)
            : null,
          st.ruined ? null : cultureLine(st.culture, st),
          st.ruined ? null : faithLine(st.faith, st.faithShift),
          !st.ruined && env && st.partOf === undefined
            ? (() => {
                const e = env!;
                const d = coreDistanceOf(s, e, st, (x, y) => provAt(e, x, y));
                const cu = cultureOf(s, st.culture);
                if (d === null || !cu) return null;
                return h('div', { class: 'muted' }, `Its region, ${Math.round(d * 100) / 100} from the ${cu.name} heartland: ${stageOf(d)}.${st.cohesion ? ` Cohesion ${Math.round(st.cohesion * 100)}%${st.cohesion >= 0.4 ? ' (a frontier people, hard to win over)' : ''}.` : ''}`);
              })()
            : null,
          !st.ruined && st.pull && cultureOf(s, st.pull.to) ? h('div', { class: 'muted' }, `Drawn toward the ways of the ${cultureOf(s, st.pull.to)!.name}: ${st.pull.share >= 0.5 ? 'strongly' : st.pull.share >= 0.2 ? 'somewhat' : 'a little'} (${Math.round(st.pull.share * 100)}% of the pull on it).`) : null,
          st.ruined ? null : h('div', {}, `${Math.round(st.pop)} people · ${Math.round(st.warband)} to guard it`),
          !st.ruined && st.pops?.length ? h('div', {}, h('span', { class: 'muted' }, 'Speaks: '), speechOf(s, st)) : null,
          !st.ruined && st.imports
            ? (() => {
                const im = st.imports!;
                const eats = Math.max(1, st.pop * (ri?.need ?? 1));
                const n = (v: number) => Math.round(v).toLocaleString();
                const way = (m: string) => (m === 'land' ? 'over land' : m === 'river' ? 'by river' : m === 'sea' ? 'by sea' : m === 'herd' ? 'herds driven in from the grazing land' : 'as rent');
                const market = im.from.filter((f) => f[2] !== 'rent');
                const how = [...new Set(market.map((f) => f[2]))].map(way).join(', ');
                const rentFrom = new Set(im.from.filter((f) => f[2] === 'rent').map((f) => f[0])).size;
                const parts: string[] = [];
                if (im.rent) parts.push(`${n(im.rent)} owed as rent and tax from ${rentFrom} province${rentFrom === 1 ? '' : 's'}`);
                if (im.market) parts.push(`${n(im.market)} offered at market ${how}${im.boughtLast !== undefined ? `; last year it bought ${n(im.boughtLast / 12)} a year there, paid for in its goods` : ''}`);
                if (!parts.length) parts.push(`from ${im.from.length} province${im.from.length === 1 ? '' : 's'}, ${[...new Set(im.from.map((f) => f[2]))].map(way).join(', ')}`);
                return h('div', {}, h('span', { class: 'muted' }, 'Food brought in: '), `about ${n(im.rations)} people’s food a year (${Math.round((im.rations / eats) * 100)}% of what it eats): ${parts.join('; ')}`);
              })()
            : null,
          !st.ruined && identitySummary(st, (id) => cultureOf(s, id)?.name ?? '?') ? h('div', {}, identitySummary(st, (id) => cultureOf(s, id)?.name ?? '?')) : null,
          !st.ruined && st.pops?.length ? popsTable(st.pops) : null,
          s.started && !st.ruined ? h('div', {}, `Food last month: ${Math.round(Math.min(9.99, st.fed) * 100)}% of need${st.fed < 0.8 ? ' (hungry)' : ''}`) : null,
          ri && !st.ruined && drawsFood(st) && tierOf(st) >= MARKET ? h('div', { class: 'muted' }, `Its own fields: out to about ${Math.round(TOWN_FIELDS_KM * 0.621)} miles past its edge (the first ${Math.round(INNER_RING_KM * 0.621)} its gardens and dairy, yielding half as much again), worked by up to ${Math.round(farmShareOf(st, st.pop * ri.need) * 100)}% of its workers (${Math.round(FARM_SHARE[tierOf(st)] * 100)}% for a ${tierName(st).toLowerCase()} the countryside feeds); the rest of its food comes from the countryside.`) : null,
          ri && !st.ruined ? h('div', { class: 'muted' }, `Works the land about ${Math.round(ri.range * (st.kind === 'dawn' ? 2.2 : 1.5) * 0.621)} miles around. When it fills up it sends people out: new tribes, or villages nearby.`) : null,
        ),
        !st.ruined && st.economy && ri ? economyCard(st, ri.need) : null,
        !st.ruined ? knowledgeCard({ st }) : null,
        !st.ruined && st.economy ? waysCard(st) : null,
        !s.started
          ? h('div', { class: 'group' },
              numberField({ label: 'People', value: Math.round(st.pop), min: 30, max: 20000, step: 10, change: (v) => { st.pop = Math.max(30, Math.min(20000, Math.round(v))); if (ri) st.warband = Math.round(st.pop * ri.warShare * 0.6); const row = draft.get(st.race); if (row) row.cityPop = st.pop; d.changed(); } }),
              h('button', { type: 'button', class: 'ghost small danger', onclick: () => { removeSettlement(s, st.id, env ?? undefined); selected = null; landDirty = true; d.changed(); render(); d.redraw(); } }, 'Remove this dawn city'),
            )
          : null,
      );
    }
    parts.push(h('h3', {}, 'Show on the map'), display);

    if (s.started) {
      const ev = s.events.slice(-60).reverse();
      parts.push(
        h('h3', {}, 'What has happened'),
        ev.length
          ? h('ul', { class: 'event-log small' }, ...ev.map((e) => h('li', {}, h('span', { class: 'muted' }, `Y${yearOf(e.day)} M${monthOf(e.day) + 1}: `), e.text)))
          : h('p', { class: 'muted small' }, 'Nothing of note yet.'),
      );
      const reset = h('div', { class: 'danger-zone' });
      const idle = () => reset.replaceChildren(h('button', { type: 'button', class: 'ghost danger small', onclick: ask }, 'Start over…'));
      const ask = () =>
        reset.replaceChildren(
          h('span', { class: 'small' }, 'Clear the peoples and their history, back to choosing who takes part?'),
          h('button', { type: 'button', class: 'danger-solid', onclick: () => {
            play(false);
            const setup = s.setup;
            sim = newSim(env!, d.world().settings.seed);
            sim.setup = setup;
            draft.clear();
            selected = null;
            landDirty = beastDirty = true;
            d.changed();
            render();
            d.redraw();
          } }, 'Start over'),
          h('button', { type: 'button', class: 'ghost', onclick: idle }, 'Keep'),
        );
      idle();
      parts.push(reset);
    }
    panel.replaceChildren(...(parts.filter(Boolean) as HTMLElement[]));
  };
  /** What the resource panel shows: the selected settlement (or its realm, for a tribe), or the selected realm. */
  let landCache: { key: string; land: Record<string, number> } | null = null;
  function resourceView(): ResourceView | null {
    const s = sim;
    const e = env;
    if (!s || !e) return null;
    const info = (id: string) => {
      const r = resInfoOf(e, id);
      return r ? { name: r.name, category: r.category } : undefined;
    };
    const landOf = (key: string, cells: () => number[]): Record<string, number> => {
      if (landCache?.key === key) return landCache.land;
      const land: Record<string, number> = {};
      for (const k of cells()) for (const r of e.resInfo) {
        const v = e.res[r.id]?.[k] ?? 0;
        if (v > (land[r.id] ?? 0)) land[r.id] = v;
      }
      landCache = { key, land };
      return land;
    };
    const st = s.settlements.find((q) => q.id === selected && !q.ruined);
    if (st) {
      const ri = raceInfo(lib(), st.race, st.culture, s.cultures);
      const r = (ri?.range ?? 22) * (st.kind === 'dawn' ? 2.2 : 1.5);
      const cells = () => {
        const out: number[] = [];
        const n = Math.ceil(r / e.step);
        const ci = Math.round((st.x - e.x0) / e.step);
        const cj = Math.round((st.y - e.y0) / e.step);
        for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
          const j = cj + dj;
          const i = ((ci + di) % e.w + e.w) % e.w;
          if (j < 0 || j >= e.h || di * di + dj * dj > n * n) continue;
          if (e.land[j * e.w + i]) out.push(j * e.w + i);
        }
        return out;
      };
      return { kind: 'Settlement', name: st.name, stores: { ...(st.economy?.stores ?? {}) }, land: landOf(`s${st.id}`, cells), info };
    }
    const tribe = s.tribes.find((q) => q.id === selected);
    const clan = clanOf(selectedRealm ?? tribe?.clan ?? -1);
    if (!clan) return null;
    const stores: Record<string, number> = {};
    for (const q of s.settlements) if (!q.ruined && q.clan === clan.id) for (const [id, v] of Object.entries(q.economy?.stores ?? {})) stores[id] = (stores[id] ?? 0) + v;
    const cells = () => {
      const out: number[] = [];
      for (let k = 0; k < e.n; k++) if (s.owner[k] === clan.id) out.push(k);
      return out;
    };
    return { kind: 'Realm', name: realmName(lib(), clan), stores, land: landOf(`r${clan.id}:${Math.floor(s.day / 360)}`, cells), info };
  }
  render();

  const api: Peoples = {
    panel,
    bar,
    overlay,
    openHistory() {
      if (!sim?.history?.snaps.length) {
        toast(sim?.started ? 'No history yet: it is kept every five years as the peoples run.' : 'Start the peoples (Peoples tab) to begin their history.');
        return;
      }
      openTimeline({ sim: () => sim, lib, cultureColour: (cu) => cultureColour(sim!, cu), scrub: (day) => { historyDay = day; if (day !== null) d.showCultures?.(); d.redraw(); } });
    },
    setActive(on) {
      active = on;
      if (on) render();
      updateBar();
      d.redraw();
    },
    climateChanged,
    provinceInfo(index) {
      const out: InfoItem[] = [];
      if (!env || !env.prov.real || index < 0 || index >= env.prov.count) return out;
      const P = env.prov;
      // What the land holds: the richest resources found across its points.
      const res: [string, number][] = [];
      for (const r of env.resInfo) {
        const A = env.res[r.id];
        if (!A) continue;
        let sum = 0;
        for (let q = P.start[index]; q < P.start[index + 1]; q++) sum += A[P.cells[q]];
        const n = P.start[index + 1] - P.start[index];
        if (n && sum / n > 0.1) res.push([r.name, sum / n]);
      }
      // The wilderness: its families by race, and the game and wild food left in it.
      if (sim) {
        const tot = totalsOver(sim, env, P.cells.subarray(P.start[index], P.start[index + 1]), northernSummer(sim.day) ? 0 : 1);
        const folk = Object.entries(tot.people).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
        if (folk.length) out.push({ label: 'Wild folk', value: folk.map(([id, v]) => `${Math.round(v).toLocaleString()} ${raceName(id)}`).join(', ') });
        out.push({ label: 'Wild food', value: `game for about ${Math.round(tot.game / 30).toLocaleString()} people a month at a light hunt; wild plants for ${Math.round(tot.plants).toLocaleString()} this month` });
      }
      if (res.length) out.push({ label: 'Resources', value: res.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, v]) => `${n} (${Math.round(Math.min(1, v) * 100)}%)`).join(', ') });
      // How dense its mana is (the average over its points).
      {
        const field = sim ? manaNow(sim, env) : env.manaBase;
        let m = 0;
        const cnt = P.start[index + 1] - P.start[index];
        for (let q = P.start[index]; q < P.start[index + 1]; q++) m += field[P.cells[q]];
        if (cnt) out.push({ label: 'Mana', value: `${manaWord(m / cnt)} (${Math.round((m / cnt) * 100)}%)` });
      }
      if (sim) {
        for (const r of sim.rifts ?? []) if (env.prov.of[cellOf(r.x, r.y)] === index) out.push({ label: 'Rift', value: riftLine(r) });
        const tide = (sim.tides ?? []).find((t) => t.provinces.includes(P.ids[index]));
        if (tide) out.push({ label: 'Monsters', value: `Overrun by the ${tide.name}` });
        if (sim.corruption) {
          let cmax = 0;
          for (let q = P.start[index]; q < P.start[index + 1]; q++) cmax = Math.max(cmax, sim.corruption[P.cells[q]]);
          if (cmax >= 0.05) out.push({ label: 'Corruption', value: `${Math.round(cmax * 100)}%` });
        }
      }
      // Living here: its climate, height and water (attraction.ts), and how much it draws the race shown.
      if (P.kind[index] === PK.land) {
        const cells = P.cells.subarray(P.start[index], P.start[index + 1]);
        const lv = provinceLiving(env, cells);
        if (lv) {
          const F = (c: number) => `${Math.round((c * 9) / 5 + 32)}°F`;
          const rainName = (r: number) => RAIN_NAMES[rainClass(r)];
          out.push({ label: 'Seasons', value: `hottest ${F(lv.hot)}, coldest ${F(lv.cold)}; ${rainName(lv.wetSeason)} in the wetter season, ${rainName(lv.drySeason)} in the drier` });
          out.push({ label: 'Height', value: `about ${Math.round((lv.heightKm * 3280.84) / 100) * 100} ft` });
          out.push({ label: 'Fresh water', value: lv.fresh ? `a river or lake in it; ${Math.round(lv.nearWater * 100)}% of it within a short walk of fresh water` : Number.isFinite(lv.freshKm) ? `none in it; the nearest about ${Math.max(1, Math.round(lv.freshKm / 1.609))} mi off${lv.nearWater > 0 ? ` (${Math.round(lv.nearWater * 100)}% of it within a short walk)` : ''}` : 'none anywhere near' });
          out.push({ label: 'Rain to live on', value: lv.rainFed >= 0.99 ? 'wet enough all over to live off the rain' : lv.rainFed > 0 ? `wet enough to live off the rain in ${Math.round(lv.rainFed * 100)}% of it` : 'not wet enough to live off the rain' });
          if (lv.coast) out.push({ label: 'Coast', value: 'on the sea (salt water: fishing, not drinking)' });
        }
        const aShow = d.attraction?.() ?? 'off';
        const af = aShow !== 'off' ? attractionFor(env, lib(), aShow) : null;
        const pa = af ? provinceAttraction(env, af.wants, cells, af.score) : null;
        if (pa) out.push({ label: `Draws the ${raceName(aShow)}`, value: pa.off >= 0.5 ? `off limits for most of it (${pa.why})` : `${pa.score.toFixed(2)}${pa.off > 0 ? `; ${Math.round(pa.off * 100)}% of it off limits (${pa.why})` : ''}` });
      }
      let road = 0;
      for (let q = P.start[index]; q < P.start[index + 1]; q++) road = Math.max(road, sim?.way[P.cells[q]] ?? 0);
      if (road) out.push({ label: 'Best way', value: WAYS[road].name });
      if (!sim) return out;
      const s = sim;
      const owner = s.provOwner?.[index] ?? -1;
      const oc = owner >= 0 ? clanOf(owner) : undefined;
      out.push({ label: 'Held by', value: oc ? realmName(lib(), oc) : P.kind[index] === PK.land ? 'Nobody yet' : 'Nobody can hold it' });
      if (env && P.kind[index] === PK.land && env.prov.count === P.count) {
        const per = provincePopulation(s, env, 'total')[index];
        const sqmi = env.prov.area[index] / SQ_KM_PER_SQ_MI;
        if (per > 0) out.push({ label: 'People', value: `about ${Math.round(per * sqmi).toLocaleString()} (${perSqMi(per)} per sq mi): in the wild, villages, towns and tribes` });
        // What its land can feed (food.ts): fully farmed, and with what its holders know.
        {
          const land = provinceLand(env)[index];
          const full = provinceFood(land, ALL_FOOD_TECH);
          if (full.total > 0) {
            const sqmiP = env.prov.area[index] / SQ_KM_PER_SQ_MI;
            const holder = (s.provOwner?.[index] ?? -1) >= 0 ? clanOf(s.provOwner![index]) : undefined;
            const known = holder ? provinceFood(land, foodTechFrom((id) => clanKnows(lib(), holder, id))) : null;
            const n = (v: number) => Math.round(v).toLocaleString();
            out.push({ label: 'Farmland', value: `${n(land.arableHa / 100)} km² of ${n(env.prov.area[index])} (${Math.round((land.arableHa / 100 / Math.max(1, env.prov.area[index])) * 100)}%), fertility ${Math.round(land.fertility * 100)}%` });
            // Its surplus (what its land grows beyond what its workers eat) and the towns it goes to (catchment.ts).
          const L = farmLayer(s);
          if (L && L.labour[index] > 0) {
            const to = surplusGoesTo(s, env.prov.ids[index]);
            out.push({ label: 'Surplus', value: `${n(L.labour[index])} can work its land; it grows about ${n(L.surplus[index])} people’s food a year beyond what they eat${to.length ? `: to ${to.slice(0, 3).map((q) => `${q.st.name} ${n(q.rations)}${q.mode === 'land' ? '' : q.mode === 'rent' ? ' (as rent)' : q.mode === 'herd' ? ' (herds)' : ` (by ${q.mode})`}`).join(', ')}` : ' (no town reaches it)'}` });
          }
          const vs = villagesOf(s, env, index);
          if (vs.sites.length) out.push({ label: 'Village sites', value: `${vs.sites.length} (about ${n(vs.villagers)} people; the biggest ${[...vs.sites].sort((a, b) => b.pop - a.pop).slice(0, 3).map((q) => q.name).join(', ')})` });
          out.push({ label: 'Can feed', value: `about ${n(full.total)} people fully farmed (${n(full.total / sqmiP)} per sq mi: farms ${n(full.farms)}, herds ${n(full.herds)}, fish ${n(full.fish)})${known ? `; ${n(known.total)} with what its holders know` : ''}` });
          }
        }
        const by = provinceCultures(s, env).get(index);
        if (by?.size) {
          const all = [...by.values()].reduce((a, b) => a + b, 0);
          const list = [...by].sort((a, b) => b[1] - a[1]);
          const shown = list.slice(0, 4).map(([id, n]) => `${Math.round((n / all) * 100)}% ${cultureOf(s, id)?.name ?? '?'}`);
          out.push({ label: 'Peoples', value: shown.join(', ') + (list.length > 4 ? ', and others' : '') });
        }
      }
      if ((s.provRival?.[index] ?? -1) >= 0 && (s.provRivalUse?.[index] ?? 0) > 0) {
        const rc = clanOf(s.provRival![index]);
        const pct = Math.round(s.provRivalUse![index]);
        out.push({ label: 'Contested', value: `${rc ? realmName(lib(), rc) : 'Another realm'}'s people are ${pct >= 100 ? 'now as many as its holder’s' : `${pct}% as many as its holder’s`} here; the land goes to whichever comes to outnumber the other` });
      }
      const inHere = (x: number, y: number) => env!.prov.of[cellOf(x, y)] === index;
      const towns = s.settlements.filter((q) => !q.ruined && inHere(q.x, q.y));
      const tribes = s.tribes.filter((t) => inHere(t.x, t.y));
      const seat = towns.find((q) => q.seat) ?? towns[0];
      if (seat) out.push({ label: 'Seat', value: `${seat.name} (${settlementTier(seat).toLowerCase()})` });
      const villages = towns.filter((q) => q !== seat);
      if (villages.length) out.push({ label: 'Villages', value: villages.map((q) => q.name).join(', ') });
      if (tribes.length) out.push({ label: 'Tribes here', value: tribes.map((t) => t.name).join(', ') });
      const people = towns.reduce((n, q) => n + q.pop, 0) + tribes.reduce((n, t) => n + t.pop, 0);
      if (people) out.push({ label: 'People', value: Math.round(people).toLocaleString() });
      const who = seat ?? tribes[0];
      if (who) {
        const cu = cultureOf(s, who.culture);
        if (cu) out.push({ label: 'Culture', value: cu.name });
      }
      if (seat?.faith) {
        const f = faithOf(s, seat.faith);
        if (f) out.push({ label: 'Faith', value: f.name });
      }
      return out;
    },
    manaState() {
      if (!ready() || !sim || !env || !(sim.tribes.length || sim.settlements.length)) return null;
      const { lines, nodes } = manaLinesNow(sim, env);
      return { lines, nodes, anchor: env.manaLand.anchor, grid: { x0: env.x0, y0: env.y0, step: env.step, w: env.w, h: env.h, wrapKm: env.wrapKm }, field: manaNow(sim, env) };
    },
    provincesChanged,
    attractionRaces: () => eligibleRaces(lib()).map(({ race }) => ({ id: race.id, name: raceName(race.id) })),
    densityRaces: () => [...new Set([...Object.keys(sim?.density ?? {}).filter((id) => sim!.density![id].some((v) => v > 0)), ...(sim?.settlements ?? []).filter((q) => !q.ruined).map((q) => q.race), ...(sim?.tribes ?? []).map((t) => t.race)])].map((id) => ({ id, name: raceName(id) })),
    live: () => (sim && env && !gridProblem ? sim : null),
    pack: () => (sim && env && !gridProblem && (sim.tribes.length || sim.settlements.length || sim.started) ? packSim(sim, env) : pending),
    resources: resourceView,
    dispose() {
      playing = false;
      cancelAnimationFrame(frame);
      clearTimeout(panelTimer);
    },
  };
  return api;
}
