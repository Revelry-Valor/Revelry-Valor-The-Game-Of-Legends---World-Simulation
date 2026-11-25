import { COVER_BRUSHES } from '../core/paint';
import { raceMissing, type Library, type Race, type Species } from '../core/library';
import { hordesDay, monstersMonth } from './monsters';
import { holdLayersYear } from './layerprovs';
import { canLiveTogether, densityMonth, seedDensity, type DensityRace } from './density';
import { digYear, driftYear, layerFood, layerRoom, layerSpot, layerWays, LAYER_NAMES, type LayerContext, type LayerLand, type LayerWays } from './layers';
import { riftPull, riftsYear, riftSpringNear } from './rifts';
import { manaYear } from './mana';
import { holdYear, type Presence } from './holding';
import { straightCells } from './roads';
import { bindProvinces, claimNear, heldArea, holderOf, provAt, provinceSpan, provincesNear, setHolder, tidyProvinces, transferAll, useProvinces } from './land';
import { landCell, PLANT_K, type Env } from './env';
import { attraction, hardBirths, hardDeaths, type Wants } from './attraction';
import { adaptYear } from './adapt';
import { economyMonth, newEconomy, PROVISIONS } from './economy';
import { caravansDay, tradeMonth, type TradeContext } from './trade';
import { WAYS, waysYear } from './ways';
import { markThinned, thinned } from './thinned';
import { cultureFx, cultureOf, cultureYear, ensureCulture, leanAt, leansOf, localYear, note, pushes, townFx, traditionsHere, type Leans } from './culture';
import { acceptance, cultureChangeYear, noteBetween, offshoot } from './cultureChange';
import { coreDistanceOf, driftTick } from './drift';
import { identityYear } from './identity';
import { historyTick } from './history';
import { ensureLanguages, languagesTick, soundsFor } from './languages';
import { ensureRealm, LAND_ENFORCE, nationsYear, tribalRule } from './nations';
import { diplomacyFactor, noteAttack, politicsYear, spiesDay } from './politics';
import { championMight, faithHostility, faithLoyalty, faithYear } from './faith';
import { armiesDay, warsMonth, warsYear, type WarContext } from './wars';
import { armsMight, canSettle, clanKnows, hasArchive, knows, outlook, techYear, wallsMight, type TechContext } from './tech';
import { traitsYear } from './traits';
import { addFarmFood, farmLayer, farmYear, isFarmed, sitesYear, type RuralContext, type VillageSite } from './rural';
import { CITY, MARKET, tierOf, tiersYear } from './tiers';
import { catchmentYear, TO_TOWN } from './catchment';
import { CULTURE_TICK, cultureTick } from './culturetick';
import { classShares, classYear, fromCountry, joinPops, mainOf, movePeople, popsOf, startPops, takePops, toCountry, tongueOf, countryYear } from './pops';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, northernSummer, type Clan, type Point, type LiveCulture, type Settlement, type SetupRow, type SimEvent, type SimState, type Sortie, type Tribe } from './state';

/**
 * The first peoples (REDESIGN.md 8.3–8.4, Phase 6): tribes moving between summer and winter
 * grounds, living off plants and game, growing or starving, splitting into new tribes and clans;
 * claiming land by walking and hunting it (never fading, but another clan can take it by using
 * it); warbands leaving their tribes to fight over land and food, and coming home.
 *
 * Time goes by days: movement daily; food, people, claims and fights monthly; grounds, splits and
 * clans yearly.
 */

// ---------------------------------------------------------------------------------------------
// Races: only complete ones take part.

export interface RaceInfo {
  species: Species;
  race: Race;
  /** Food each person needs (person-months per month; Medium = 1). */
  need: number;
  /** Walking speed of a whole tribe (km a day), and its foraging and hunting range (km). */
  speed: number;
  range: number;
  /** Yearly births and deaths per person in good times. */
  births: number;
  deaths: number;
  /** Share of the people in the warband, and how strong each fighter is (Human = 1). */
  warShare: number;
  /** Share of the people who work (the able adults). */
  workShare: number;
  might: number;
  /** Where it can go: high mountains, over water. */
  mountains: boolean;
  flies: boolean;
  swims: boolean;
  lifestyle: string;
  attitude: string;
  /** Feels mana: drawn to dense mana, unsettled where it is thin (the Mana-sensitive trait). */
  manaSensitive: boolean;
  /** What it brings to the other layers: digging, and the layers it prefers (Phase 12). */
  lw: LayerWays;
  /** Adapts quickly to new lands (its own setting, or the Adaptable trait). */
  adaptable: boolean;
  /** Where its culture's ways draw its people (culture.ts: seafaring to coasts…). */
  leans: Leans;
  /** Tolerance its culture's people have gained in hard country (levels, to the nearest quarter). */
  adapt: { heat: number; cold: number; wet: number; dry: number; altitude: number };
  /** The summed effect of its traits on a target (e.g. 'Cold tolerance'). */
  traitEffect(target: string): number;
}

const SIZE_NEED: Record<string, number> = { Tiny: 0.3, Small: 0.6, Medium: 1, Large: 1.6, Giant: 3 };
const MARTIAL_SHARE: Record<string, number> = { 'Men fight': 0.5, 'Women fight': 0.5, 'Everyone fights': 1, 'A warrior caste': 0.25, 'None (others fight for them)': 0.05 };

/** The races that can take part: complete, and not set aside. */
export function eligibleRaces(lib: Library): { species: Species; race: Race }[] {
  return lib.species.filter((s) => !s.setAside).flatMap((s) => s.races.filter((r) => !raceMissing(r).length).map((race) => ({ species: s, race })));
}

export function raceInfo(lib: Library, raceId: string, cultureId = '', cultures: LiveCulture[] = []): RaceInfo | null {
  for (const species of lib.species) {
    const race = species.races.find((r) => r.id === raceId);
    if (!race) continue;
    const st = race.stats;
    const L = race.lifespan ?? 70;
    const A = race.fightingAge ?? 16;
    const p = species.profile;
    const traits = new Set([...species.traits.filter((t) => !race.removeTraits.includes(t)), ...race.addTraits]);
    const O = p.offspring ?? (race.size === 'Tiny' ? 3 : race.size === 'Small' ? 2 : 1);
    const Y = p.birthEveryYears ?? Math.max(1, Math.min(40, L / 25));
    const culture = cultures.find((c) => c.id === cultureId) ?? lib.cultures.find((c) => c.id === cultureId);
    const martial = culture?.martial ? MARTIAL_SHARE[culture.martial] ?? 0.5 : 0.5;
    const adultShare = Math.max(0.2, Math.min(0.65, (0.6 * L - A) / (0.8 * L)));
    const speed = Math.max(st.speed ?? 30, st.flying ?? 0);
    const fight = ((st.health ?? 16) + (st.armor ?? 0) + (st.strength ?? 10) + (st.agility ?? 10) + (st.constitution ?? 14)) / 50;
    return {
      species,
      race,
      need: SIZE_NEED[race.size ?? 'Medium'] ?? 1,
      speed: 15 * (speed / 30),
      range: 22 * Math.sqrt(Math.max(10, speed) / 30),
      births: (0.128 * O) / Y * (traits.has('fertile') ? 1.4 : 1),
      deaths: 1 / (0.4 * L),
      warShare: adultShare * martial,
      workShare: Math.max(0.3, Math.min(0.7, adultShare * 1.2)),
      might: fight * (0.8 + 0.2 * ((st.willpower ?? 6) / 6)),
      mountains: traits.has('mountain-born') || p.movement.includes('Mountain-adapted') || (st.climbing ?? 0) >= 20 || (st.flying ?? 0) > 0,
      flies: (st.flying ?? 0) > 0,
      swims: (st.swimming ?? 0) >= 40,
      lifestyle: race.lifestyle || species.lifestyle || 'Semi-nomadic',
      attitude: p.attitude || 'Wary',
      manaSensitive: traits.has('mana-sensitive'),
      lw: layerWays(lib, species, race),
      adaptable: race.living?.adaptable ? race.living.adaptable === 'Yes' : traits.has('adaptable'),
      leans: leansOf((cultures.find((c) => c.id === cultureId) ?? lib.cultures.find((c) => c.id === cultureId))?.traditions.filter((t) => t.level >= 0) ?? []),
      adapt: (() => {
        const a = (cultures.find((c) => c.id === cultureId) as LiveCulture | undefined)?.adapt;
        const q = (v: number | undefined) => Math.round((v ?? 0) * 4) / 4;
        return { heat: q(a?.heat), cold: q(a?.cold), wet: q(a?.wet), dry: q(a?.dry), altitude: q(a?.altitude) };
      })(),
      traitEffect: (target) => {
        let n = 0;
        for (const id of traits) for (const e of lib.traits.find((t) => t.id === id)?.effects ?? []) if (e.target === target) n += e.amount;
        return n;
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Randomness (seeded, kept in the state so runs repeat).

function rand(sim: SimState): number {
  let t = (sim.seed = (sim.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const PALETTE = ['#c0392b', '#2471a3', '#229954', '#d68910', '#7d3c98', '#17a589', '#cb4335', '#2e4053', '#b9770e', '#1f618d', '#a93226', '#117a65', '#6c3483', '#ca6f1e', '#239b56', '#5b2c6f', '#b03a2e', '#1a5276', '#d4ac0d', '#148f77'];
const SYLLABLES = ['ka', 'ra', 'mo', 'te', 'lu', 'an', 'or', 'vel', 'si', 'do', 'ma', 'ri', 'tha', 'gor', 'en', 'is', 'ul', 'bra', 'ne', 'kor', 'al', 'dur', 'ish', 'ven'];

/** A name in a culture's sounds (word parts with a dash join: "ka-", "-dor"), or plain syllables. */
function makeName(sim: SimState, lib: Library, cultureId: string): string {
  const live = sim.cultures?.find((c) => c.id === cultureId);
  // Names in its tongue's sounds (languages.ts), else its own.
  const sounds = (live ? soundsFor(sim, live) : lib.cultures.find((c) => c.id === cultureId)?.sounds) ?? '';
  const parts = sounds.split(/[\s,;]+/).filter(Boolean);
  const pre = parts.filter((p) => p.endsWith('-')).map((p) => p.slice(0, -1));
  const suf = parts.filter((p) => p.startsWith('-')).map((p) => p.slice(1));
  const pick = <T>(a: T[]) => a[Math.floor(rand(sim) * a.length)];
  const one = () => {
    if (pre.length && suf.length) return pick(pre) + pick(suf);
    const n = 2 + (rand(sim) < 0.4 ? 1 : 0);
    return Array.from({ length: n }, () => pick(SYLLABLES)).join('');
  };
  // Not one already taken by a town or realm (a few tries; then a longer name).
  const taken = new Set([...sim.settlements.map((s) => s.name), ...sim.clans.map((c) => c.name), ...Object.values(sim.sites ?? {}).flatMap((ss) => ss.map((q) => q.name))].map((n) => n.toLowerCase()));
  let name = one();
  for (let i = 0; i < 8 && taken.has(name.toLowerCase()); i++) name = i < 5 ? one() : one() + (suf.length ? pick(suf) : pick(SYLLABLES));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---------------------------------------------------------------------------------------------
// The grid

const cellOf = (env: Env, x: number, y: number): number => {
  let i = Math.round((x - env.x0) / env.step);
  const j = Math.round((y - env.y0) / env.step);
  if (j < 0 || j >= env.h) return -1;
  if (i < 0 || i >= env.w) {
    if (!env.wrapKm) return -1;
    i = ((i % env.w) + env.w) % env.w;
  }
  return j * env.w + i;
};
const xOf = (env: Env, k: number) => env.x0 + (k % env.w) * env.step;
const yOf = (env: Env, k: number) => env.y0 + ((k / env.w) | 0) * env.step;
/** Distance between two places (km), the short way round on a wrapping map. */
function dist(env: Env, ax: number, ay: number, bx: number, by: number): number {
  let dx = Math.abs(ax - bx);
  if (env.wrapKm) dx = Math.min(dx, env.wrapKm - dx);
  return Math.hypot(dx, ay - by);
}
/** Share of a settlement's people that go out into the wild each month (when it is fed). */
const WILD_TRICKLE = 0.0005;
/** The same, from a town past its first size (its growth goes partly into the land round it). */
const WILD_TRICKLE_FULL = 0.001;
const easeCache = new WeakMap<Env, Map<string, Float32Array>>();
/**
 * How easily a race's families spread into a point (density.ts): by its preferred climates,
 * ground covers and heights (the species' and the race's own), far quicker along coasts and
 * rivers. Peoples with no preferences set spread evenly.
 */
function wildEase(env: Env, ri: RaceInfo, k: number, w: Wants = wantsOf(env, ri)): number {
  if (!env.land[k]) return 0.1;
  const zone = env.zone?.[k] ?? -1;
  const cm = w.climates.length && zone >= 0 ? (w.climates.includes(zone) ? 1 : 0.35) : 1;
  const cover = env.cover[k] >= 0 ? COVER_BRUSHES[env.cover[k]] : '';
  const vm = w.covers.length && cover ? (w.covers.includes(cover) ? 1 : 0.5) : 1;
  const zm = w.heights.length ? (w.heights.includes(env.mzone[k]) ? 1 : 0.4) : env.mzone[k] >= 3 ? 0.4 : 1;
  const water = env.coast[k] || env.fresh[k] ? 1.5 : 1;
  return Math.max(0.1, Math.min(1.5, cm * vm * zm * water));
}
/** How a race lives in the wild (density.ts), with how well it can live at each point (worked out once). */
const liveCache = new WeakMap<Env, Map<string, Float32Array>>();
function densityRace(sim: SimState, env: Env, lib: Library, info: Info, race: string): DensityRace | null {
  const ri = info({ race, culture: '' });
  if (!ri) return null;
  let m = liveCache.get(env);
  if (!m) liveCache.set(env, (m = new Map()));
  const wk = wantsKey(env, ri);
  let L = m.get(wk);
  if (!L) {
    L = new Float32Array(env.n);
    for (let k = 0; k < env.n; k++) L[k] = liveScore(env, ri, k);
    m.set(wk, L);
  }
  const live = L;
  let E = easeCache.get(env)?.get(wk);
  if (!E) {
    E = new Float32Array(env.n);
    const w = wantsOf(env, ri);
    for (let k = 0; k < env.n; k++) E[k] = wildEase(env, ri, k, w);
    if (!easeCache.has(env)) easeCache.set(env, new Map());
    easeCache.get(env)!.set(wk, E);
  }
  const ease = E;
  return { need: ri.need, births: ri.births, deaths: ri.deaths, attitude: ri.attitude, species: ri.species.id, live: (k) => live[k], ease: (k) => ease[k], hard: (k) => climateAt(env, ri, k) };
}
const NO_LAYERS: LayerLand = { under: [], underStep: 20, ways: [], islands: [], trees: [], cities: [], vines: [] };
/** What the layer rules (layers.ts) need. */
function layerContext(sim: SimState, env: Env, lib: Library): LayerContext {
  return { sim, layers: env.layers ?? NO_LAYERS, provs: env.layerProv, dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by), rand: () => rand(sim), has: (st, id) => knows(lib, st, id), log: (text, x, y) => log(sim, text, x, y) };
}

/** Cells within `r` km of a place (always at least the one under it). */
function cellsNear(env: Env, x: number, y: number, r: number): number[] {
  const out: number[] = [];
  const reach = r + env.step * 0.5;
  const span = Math.ceil(reach / env.step);
  const ci = Math.round((x - env.x0) / env.step);
  const cj = Math.round((y - env.y0) / env.step);
  for (let dj = -span; dj <= span; dj++) {
    const j = cj + dj;
    if (j < 0 || j >= env.h) continue;
    for (let di = -span; di <= span; di++) {
      let i = ci + di;
      if (i < 0 || i >= env.w) {
        if (!env.wrapKm) continue;
        i = ((i % env.w) + env.w) % env.w;
      }
      const k = j * env.w + i;
      if (dist(env, x, y, xOf(env, k), yOf(env, k)) <= reach) out.push(k);
    }
  }
  if (!out.length) {
    const k = cellOf(env, x, y);
    if (k >= 0) out.push(k);
  }
  return out;
}
/** Whether a race can be at a point. */
function passable(env: Env, ri: RaceInfo, k: number): boolean {
  if (k < 0) return false;
  if (!env.land[k]) return ri.flies || ri.swims;
  return env.mzone[k] < 3 || ri.mountains;
}

// ---------------------------------------------------------------------------------------------
// Making and placing

export function newSim(env: Env, seed: number): SimState {
  const beasts: Record<string, Float32Array> = {};
  for (const b of env.beastInfo) beasts[b.id] = Float32Array.from(env.beastK[b.id], (v) => v * 0.9);
  const sim: SimState = { day: 0, seed: seed | 0 || 1, started: false, tribes: [], settlements: [], grudges: [], caravans: [], routes: [], traffic: new Float32Array(env.n), way: new Uint8Array(env.n), wayKeeper: new Int32Array(env.n).fill(-1), bridge: new Uint8Array(env.n), realmRelations: {}, spies: [], clans: [], sorties: [], nextId: 1, w: env.w, h: env.h, owner: new Int32Array(env.n).fill(-1), rival: new Int32Array(env.n).fill(-1), rivalUse: new Float32Array(env.n), beasts, events: [], setup: [] };
  bindProvinces(sim, env);
  return sim;
}

/** The culture a race's people start with: the first that names the race (or its species) as its heritage. */
export function startCulture(lib: Library, species: Species, race: Race): string {
  return lib.cultures.find((c) => c.races.includes(race.id))?.id ?? lib.cultures.find((c) => c.species.includes(species.id))?.id ?? '';
}

function newClan(sim: SimState, lib: Library, species: string, race: string, culture: string, parent = -1): Clan {
  const id = sim.nextId++;
  const clan: Clan = { id, name: makeName(sim, lib, culture), colour: PALETTE[sim.clans.length % PALETTE.length], species, race, culture, founded: sim.day, parent, techs: [...(sim.clans.find((c) => c.id === parent)?.techs ?? [])] };
  ensureRealm(rulerContext(sim, lib), clan);
  sim.clans.push(clan);
  return clan;
}

/** What naming rulers and judging their years needs. */
function rulerContext(sim: SimState, lib: Library) {
  return {
    sim,
    rand: () => rand(sim),
    name: (cultureId: string) => makeName(sim, lib, cultureId),
    lifespan: (raceId: string) => lib.species.flatMap((s) => s.races).find((r) => r.id === raceId)?.lifespan ?? 70,
  };
}

export function addTribe(sim: SimState, env: Env, lib: Library, raceId: string, x: number, y: number, clanId = -1, pop = 150): Tribe | null {
  const ri = raceInfo(lib, raceId);
  if (!ri) return null;
  let clan = sim.clans.find((c) => c.id === clanId);
  if (!clan) clan = newClan(sim, lib, ri.species.id, raceId, ensureCulture(sim, lib, env, ri.species, ri.race, x, y, () => rand(sim)));
  const t: Tribe = { id: sim.nextId++, name: makeName(sim, lib, clan.culture), clan: clan.id, species: ri.species.id, race: raceId, culture: clan.culture, x, y, target: null, summer: { x, y }, winter: { x, y }, pop, fed: 1, warband: 0, away: 0, founded: sim.day };
  t.warband = Math.round(pop * raceInfo(lib, raceId, clan.culture)!.warShare);
  sim.tribes.push(t);
  chooseGrounds(sim, env, lib, t);
  // Off to the grounds for the season it is now.
  const g = localSummer(env, t, sim.day) ? t.summer : t.winter;
  if (g.x !== t.x || g.y !== t.y) t.target = { ...g };
  return t;
}

/**
 * What a race asks of a place and what draws it (attraction.ts): its own tolerances, preferences,
 * water need and priorities (the Library's race options), else its species', with its traits'
 * effects on the tolerances (Cold-adapted, Heat-adapted…); unset tolerances are the middle, 3.
 */
export function wantsOf(env: Env, ri: RaceInfo): Wants {
  const p = ri.species.profile;
  const own = ri.race.living;
  // The race's (or species') tolerance, its traits', and what its culture's people have gained in hard country.
  const tol = (key: 'heat' | 'cold' | 'wet' | 'dry' | 'altitude', label: string) => Math.max(1, Math.min(7, Math.min(5, (own?.[key] ?? p[key] ?? 3) + ri.traitEffect(label)) + (ri.adapt?.[key] ?? 0)));
  return {
    tolerances: { heat: tol('heat', 'Heat tolerance'), cold: tol('cold', 'Cold tolerance'), wet: tol('wet', 'Wet tolerance'), dry: tol('dry', 'Dry tolerance'), altitude: tol('altitude', 'Altitude tolerance') },
    climates: ri.race.climates.length ? ri.race.climates : p.climates,
    covers: own?.covers.length ? own.covers : p.covers,
    heights: own?.heights.length ? own.heights : p.mountainZones,
    manaSensitive: ri.manaSensitive,
    passable: (k) => passable(env, ri, k),
    water: own?.water || 'Normal',
    priorities: own?.priorities ?? { food: 1, water: 1, resources: 1, trade: 1 },
    lean: Object.keys(ri.leans ?? {}).length ? (k) => leanAt(env, ri.leans, k) : undefined,
  };
}
const attractCache = new WeakMap<Env, Map<string, { score: Float32Array; climate: Float32Array }>>();
/** A race's settings as a key (so its worked-out maps are kept until its Library options change). */
const wantsKeys = new WeakMap<RaceInfo, string>();
const wantsMemo = new WeakMap<RaceInfo, { env: Env; w: Wants }>();
function wantsKey(env: Env, ri: RaceInfo): string {
  let k = wantsKeys.get(ri);
  if (!k) {
    const { passable: _p, ...rest } = wantsOf(env, ri);
    k = `${ri.race.id}|${ri.flies}|${ri.mountains}|${ri.swims}|${JSON.stringify(rest)}|${JSON.stringify(ri.leans ?? {})}`;
    wantsKeys.set(ri, k);
  }
  return k;
}
/** A race's attraction (for the Attraction view and readouts): what it asks, and its score at each point (cached; −1 off limits). */
export function attractionFor(env: Env, lib: Library, raceId: string): { wants: Wants; score: (k: number) => number } | null {
  const ri = raceInfo(lib, raceId);
  if (!ri) return null;
  return { wants: wantsOf(env, ri), score: (k) => liveScore(env, ri, k) };
}
/**
 * How much a race wants to live at a point (attraction.ts): its water and climate requirements,
 * then food, preferences, resources, trade and mana. −1 where it won't live at all.
 */
function liveScore(env: Env, ri: RaceInfo, k: number, _cl?: { zone: Int8Array }): number {
  if (k < 0) return -1;
  const A = placeCache(env, ri);
  if (Number.isNaN(A.score[k])) fillPlace(env, ri, A, k);
  return A.score[k];
}
/**
 * How hard the climate is on a race at a point (attraction.ts): 1 within all its tolerances,
 * less the further past them (below 0.15 it wouldn't choose to live there at all).
 */
function climateAt(env: Env, ri: RaceInfo, k: number): number {
  if (k < 0) return 1;
  const A = placeCache(env, ri);
  if (Number.isNaN(A.climate[k])) fillPlace(env, ri, A, k);
  return A.climate[k];
}
function placeCache(env: Env, ri: RaceInfo): { score: Float32Array; climate: Float32Array } {
  let m = attractCache.get(env);
  if (!m) attractCache.set(env, (m = new Map()));
  const wk = wantsKey(env, ri);
  let A = m.get(wk);
  if (!A) {
    // As peoples adapt their settings change: old maps are let go now and then.
    if (m.size > 48) m.clear();
    A = { score: new Float32Array(env.n).fill(NaN), climate: new Float32Array(env.n).fill(NaN) };
    m.set(wk, A);
  }
  return A;
}
function fillPlace(env: Env, ri: RaceInfo, A: { score: Float32Array; climate: Float32Array }, k: number): void {
  let wm = wantsMemo.get(ri);
  if (!wm || wm.env !== env) wantsMemo.set(ri, (wm = { env, w: wantsOf(env, ri) }));
  const a = attraction(env, wm.w, k);
  A.score[k] = a.score;
  A.climate[k] = a.off && !a.water && a.climate === 0 ? 1 : a.climate;
}

/**
 * Starting tribes, placed where each race's environment suits it best: each race's tribes in
 * one or two homelands, a clan for every few tribes.
 */
export function placeStart(sim: SimState, env: Env, lib: Library, setup: SetupRow[], zone?: Int8Array): void {
  sim.tribes = [];
  sim.settlements = [];
  sim.grudges = [];
  sim.caravans = [];
  sim.routes = [];
  sim.traffic.fill(0);
  sim.way.fill(0);
  sim.wayKeeper.fill(-1);
  sim.bridge = new Uint8Array(env.n);
  sim.realmRelations = {};
  sim.spies = [];
  sim.clans = [];
  sim.sorties = [];
  sim.owner.fill(-1);
  sim.rival.fill(-1);
  sim.rivalUse.fill(0);
  sim.provOwner?.fill(-1);
  sim.provRival?.fill(-1);
  sim.provRivalUse?.fill(0);
  sim.setup = setup.map((s) => ({ ...s }));
  const taken: Point[] = [];
  for (const row of setup) {
    const { race } = row;
    const start = row.start ?? 'tribes';
    const tribes = start === 'dawn' ? 0 : row.tribes;
    const ri = raceInfo(lib, race);
    if (!ri || (tribes <= 0 && start === 'tribes')) continue;
    const scores: { k: number; s: number }[] = [];
    for (let k = 0; k < env.n; k++) {
      const s = liveScore(env, ri, k, zone ? { zone } : undefined);
      if (s > 0) scores.push({ k, s });
    }
    if (!scores.length) continue;
    scores.sort((a, b) => b.s - a.s);
    // A homeland among the best places, away from other peoples' homelands.
    const top = scores.slice(0, Math.max(10, Math.floor(scores.length * 0.05)));
    let home = top[Math.floor(rand(sim) * top.length)];
    for (let tries = 0; tries < 30 && taken.some((p) => dist(env, p.x, p.y, xOf(env, home.k), yOf(env, home.k)) < 600); tries++) home = top[Math.floor(rand(sim) * top.length)];
    const hx = xOf(env, home.k);
    const hy = yOf(env, home.k);
    taken.push({ x: hx, y: hy });
    // The dawn city: where the race woke, on the best ground of its homeland.
    const clansBefore = sim.clans.length;
    if (start !== 'tribes') addDawnCity(sim, env, lib, race, hx, hy, row.cityPop ?? 800, row.techs ?? []);
    const ring = start === 'both' ? ri.range * 3 : 0;
    // Its tribes around it, a clan for every three or four.
    let clan = -1;
    for (let i = 0; i < tribes; i++) {
      if (i % 4 === 0) clan = -1;
      let best: { x: number; y: number; s: number } | null = null;
      for (let tries = 0; tries < 40; tries++) {
        const a = rand(sim) * Math.PI * 2;
        const d = ring + (i === 0 && !ring ? 0 : 40) + rand(sim) * (60 + 25 * i);
        const x = hx + Math.cos(a) * d;
        const y = hy + Math.sin(a) * d;
        const k = cellOf(env, x, y);
        if (k < 0) continue;
        const s = liveScore(env, ri, k, zone ? { zone } : undefined) - sim.tribes.filter((t) => dist(env, t.x, t.y, x, y) < ri.range * 2.5).length * 0.5;
        if (!best || s > best.s) best = { x, y, s };
      }
      if (!best || best.s <= 0) continue;
      const t = addTribe(sim, env, lib, race, best.x, best.y, clan, 120 + Math.floor(rand(sim) * 120));
      if (t) clan = t.clan;
    }
    // What its first peoples know beyond survival.
    for (const c of sim.clans.slice(clansBefore)) c.techs = [...(row.techs ?? [])];
  }
}

export function removeTribe(sim: SimState, id: number): void {
  sim.tribes = sim.tribes.filter((t) => t.id !== id);
  sim.sorties = sim.sorties.filter((s) => s.tribe !== id && s.target !== id);
  dropUnusedClans(sim);
}
function dropUnusedClans(sim: SimState): void {
  if (sim.started) return;
  const used = new Set([...sim.tribes.map((t) => t.clan), ...sim.settlements.map((s) => s.clan)]);
  sim.clans = sim.clans.filter((c) => used.has(c.id));
}

/** A race's dawn city: where it woke, holy to all of that race. One per race (placing another moves it). */
/**
 * Where a settlement stands: the nearest point of the grid that is land. The grid's points are
 * where the painted land was sampled, so a settlement there is always on the painted land (a spot
 * between them, by a coast, can be painted sea).
 */
export function landPoint(env: Env, x: number, y: number): { x: number; y: number } {
  // With the painted land to go by: the place itself if it is land (right up to the coast), or
  // the nearest land to it, looked for in widening rings.
  if (env.landAt) {
    if (env.landAt(x, y)) return { x, y };
    for (let r = 1; r <= 12; r++) {
      const d = (r * env.step) / 4;
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * d;
        const py = y + Math.sin((a / 16) * Math.PI * 2) * d;
        if (env.landAt(px, py)) return { x: px, y: py };
      }
    }
  }
  const k = cellOf(env, x, y);
  if (k >= 0 && env.land[k]) return { x: xOf(env, k), y: yOf(env, k) };
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const c of cellsNear(env, x, y, env.step * 3)) {
    if (!env.land[c]) continue;
    const d = dist(env, x, y, xOf(env, c), yOf(env, c));
    if (d < bd) [best, bd] = [{ x: xOf(env, c), y: yOf(env, c) }, d];
  }
  return best ?? { x, y };
}

export function addDawnCity(sim: SimState, env: Env, lib: Library, raceId: string, x: number, y: number, pop = 800, techs: string[] = []): Settlement | null {
  const ri = raceInfo(lib, raceId);
  if (!ri) return null;
  ({ x, y } = landPoint(env, x, y));
  const old = sim.settlements.find((s) => s.kind === 'dawn' && s.holyTo.includes(raceId));
  if (old) {
    moveSettlement(sim, env, lib, old.id, x, y);
    old.pop = pop;
    return old;
  }
  const clan = newClan(sim, lib, ri.species.id, raceId, ensureCulture(sim, lib, env, ri.species, ri.race, x, y, () => rand(sim)));
  const st: Settlement = { id: sim.nextId++, name: makeName(sim, lib, clan.culture), kind: 'dawn', clan: clan.id, species: ri.species.id, race: raceId, culture: clan.culture, x, y, pop, fed: 1, warband: 0, holyTo: [raceId], ruined: false, founded: sim.day, ruinedOn: -1 };
  st.warband = Math.round(pop * ri.warShare * 0.6);
  st.economy = newEconomy(pop, ri.need, foundingMonths(env, x, y, sim.day));
  st.techs = [...techs];
  clan.techs = [...techs];
  sim.settlements.push(st);
  claimAround(sim, env, st.x, st.y, settleRange(ri, st), st.clan);
  return st;
}
export function moveSettlement(sim: SimState, env: Env, lib: Library, id: number, x: number, y: number): void {
  const st = sim.settlements.find((s) => s.id === id);
  if (!st) return;
  const ri = raceInfo(lib, st.race, st.culture);
  // Its old land is let go (while setting up), and the land round the new place taken.
  if (!sim.started) transferAll(sim, env, st.clan, -1);
  ({ x, y } = landPoint(env, x, y));
  st.x = x;
  st.y = y;
  if (ri) claimAround(sim, env, x, y, settleRange(ri, st), st.clan);
}
export function removeSettlement(sim: SimState, id: number, env?: Env): void {
  const st = sim.settlements.find((s) => s.id === id);
  sim.settlements = sim.settlements.filter((s) => s.id !== id);
  if (st && !sim.started && !sim.tribes.some((t) => t.clan === st.clan)) {
    if (env) transferAll(sim, env, st.clan, -1);
    else for (let k = 0; k < sim.owner.length; k++) if (sim.owner[k] === st.clan) sim.owner[k] = -1;
  }
  sim.sorties = sim.sorties.filter((s) => !(s.targetKind === 'settlement' && s.target === id));
  dropUnusedClans(sim);
}
/** How far round a settlement its people work the land (km). */
function settleRange(ri: RaceInfo, st: Settlement): number {
  return ri.range * (st.kind === 'dawn' ? 2.2 : 1.5);
}
/** A new settlement takes the unheld provinces round it (its own, and those within reach not over a river or mountains). */
function claimAround(sim: SimState, env: Env, x: number, y: number, r: number, clan: number): void {
  claimNear(sim, env, x, y, Math.max(r, provinceSpan(env, x, y) * 1.15), clan, (fx, fy, k) => beyondBarrier(env, fx, fy, k));
}

/** Move a tribe (while setting up): it moves its grounds with it. */
export function moveTribe(sim: SimState, env: Env, lib: Library, id: number, x: number, y: number): void {
  const t = sim.tribes.find((q) => q.id === id);
  if (!t) return;
  t.x = x;
  t.y = y;
  t.summer = { x, y };
  t.winter = { x, y };
  t.target = null;
  chooseGrounds(sim, env, lib, t);
}

// ---------------------------------------------------------------------------------------------
// Grounds: summer and winter, chosen for food, water, warmth in winter, and space.

/** Is it summer where the tribe is? */
function localSummer(env: Env, t: Tribe, day: number): boolean {
  return localSummerAt(env, t.x, t.y, day);
}
/** Food a new settlement brings, in months: enough to reach its first full harvest (a season half gone brings in little). */
function foundingMonths(env: Env, x: number, y: number, day: number): number {
  const m = monthsToHarvest(env, x, y, day);
  return (localSummerAt(env, x, y, day) && m < 5 ? m + 12 : m) + 1;
}
/** Months left in the local half of the year (summer or winter), 1–6. */
function monthsLeft(env: Env, x: number, y: number, day: number): number {
  const now = localSummerAt(env, x, y, day);
  for (let m = 1; m <= 6; m++) if (localSummerAt(env, x, y, day + m * DAYS_PER_MONTH) !== now) return m;
  return 6;
}
/** Months until summer's end here (the harvest), 1–12. */
function monthsToHarvest(env: Env, x: number, y: number, day: number): number {
  for (let m = 1; m <= 12; m++) if (localSummerAt(env, x, y, day + (m - 1) * DAYS_PER_MONTH) && !localSummerAt(env, x, y, day + m * DAYS_PER_MONTH)) return m;
  return 12;
}
function localSummerAt(env: Env, x: number, y: number, day: number): boolean {
  const k = cellOf(env, x, y);
  const south = k >= 0 && env.lat[k] < 0;
  return northernSummer(day) !== south;
}

function groundScore(sim: SimState, env: Env, ri: RaceInfo, t: Tribe, x: number, y: number, summerLocal: boolean): number {
  const k = cellOf(env, x, y);
  if (k < 0 || !env.land[k] || !passable(env, ri, k)) return -Infinity;
  const south = env.lat[k] < 0;
  // The field index for the local season here.
  const s = summerLocal !== south ? 0 : 1;
  let food = 0;
  const cells = cellsNear(env, x, y, ri.range);
  for (const c of cells) {
    if (!env.land[c]) continue;
    food += env.plant[s][c] / PLANT_K;
    for (const b of env.beastInfo) if (!b.water) food += sim.beasts[b.id][c] * b.meat * 0.05;
  }
  food /= cells.length;
  let crowd = 0;
  for (const o of sim.tribes) if (o.id !== t.id && dist(env, o.x, o.y, x, y) < ri.range * 2.5) crowd += o.pop / 200;
  for (const o of sim.settlements) if (!o.ruined && dist(env, o.x, o.y, x, y) < ri.range * 3) crowd += o.pop / 300;
  const owner = sim.owner[k];
  const land = owner === t.clan ? 0.15 : owner < 0 ? 0.08 : -0.3;
  // Where they would live at all (water, a climate they can bear): and how much it draws them.
  const live = liveScore(env, ri, k);
  if (live < 0) return -Infinity;
  const warmth = summerLocal ? 0 : 0.4 * Math.max(0, Math.min(1, (env.temp[s][k] + 15) / 25));
  return food + 0.5 * live + warmth + land - crowd * 0.4;
}
/** Can the tribe walk straight there? */
function reachable(env: Env, ri: RaceInfo, ax: number, ay: number, bx: number, by: number): boolean {
  const d = dist(env, ax, ay, bx, by);
  const n = Math.max(1, Math.ceil(d / (env.step * 0.5)));
  for (let i = 1; i <= n; i++) if (!passable(env, ri, cellOf(env, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n))) return false;
  return true;
}
function chooseGrounds(sim: SimState, env: Env, lib: Library, t: Tribe): void {
  const ri = raceInfo(lib, t.race, t.culture);
  if (!ri) return;
  const round = ri.lifestyle === 'Nomadic' ? 350 : ri.lifestyle === 'Settled' ? 50 : 160;
  const reach = round * (ri.speed / 15);
  for (const summer of [false, true]) {
    const cur = summer ? t.summer : t.winter;
    let best = { x: cur.x, y: cur.y, s: groundScore(sim, env, ri, t, cur.x, cur.y, summer) + 0.1 };
    // Summer grounds are looked for some way off the winter grounds; winter grounds near where they are.
    const base = t.winter;
    for (let i = 0; i < 36; i++) {
      const a = rand(sim) * Math.PI * 2;
      const d = (summer ? reach * 0.3 : 0) + rand(sim) * reach * (summer ? 0.7 : 0.5);
      const x = base.x + Math.cos(a) * d;
      const y = base.y + Math.sin(a) * d;
      const s = groundScore(sim, env, ri, t, x, y, summer);
      if (s > best.s && reachable(env, ri, base.x, base.y, x, y)) best = { x, y, s };
    }
    if (summer) t.summer = { x: best.x, y: best.y };
    else t.winter = { x: best.x, y: best.y };
  }
}

// ---------------------------------------------------------------------------------------------
// Stepping

export const log = (sim: SimState, text: string, x?: number, y?: number) => {
  const e: SimEvent = { day: sim.day, text, x, y };
  sim.events.push(e);
  if (sim.events.length > 400) sim.events.splice(0, sim.events.length - 400);
};

/** Run the simulation on by a number of days. */
export function stepDays(sim: SimState, env: Env, lib: Library, days: number): void {
  if (sim.w !== env.w || sim.h !== env.h) return;
  const infos = new Map<string, RaceInfo | null>();
  const info = (t: { race: string; culture: string }) => {
    const key = `${t.race}|${t.culture}`;
    if (!infos.has(key)) infos.set(key, raceInfo(lib, t.race, t.culture, sim.cultures));
    return infos.get(key)!;
  };
  for (let d = 0; d < days; d++) {
    sim.started = true;
    daily(sim, env, info, lib);
    caravansDay(tradeContext(sim, env, lib, info));
    spiesDay({ sim, lib, rand: () => rand(sim), dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by), log: (text, x, y) => log(sim, text, x, y) });
    if (sim.armies?.length) armiesDay(warContext(sim, env, lib, info));
    // Monster hordes on the march (monsters.ts).
    // Held off (riftsHeld): hordes halt where they are, neither moving nor attacking.
    if (sim.hordes?.length && !sim.riftsHeld) hordesDay(warContext(sim, env, lib, info));
    sim.day++;
    if (sim.day % DAYS_PER_MONTH === 0) monthly(sim, env, lib, info);
    if (sim.day % DAYS_PER_YEAR === 0) yearly(sim, env, lib, info);
  }
}

type Info = (t: { race: string; culture: string }) => RaceInfo | null;

function techContext(sim: SimState, env: Env, lib: Library): TechContext {
  return {
    sim,
    env,
    lib,
    intelligence: (race) => lib.species.flatMap((s) => s.races).find((r) => r.id === race)?.stats.intelligence ?? 10,
    cellsNear: (x, y, r) => cellsNear(env, x, y, r),
    dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by),
    rand: () => rand(sim),
    log: (text, x, y) => log(sim, text, x, y),
    culture: (id) => cultureFx(sim, id),
    acceptance: (a, b) => acceptance(sim, a, b),
    pushes: (cultureId, techId, settlementId) => pushes(sim, lib, cultureId, techId, settlementId),
  };
}
/** What a settlement or clan may come to next, with yearly chances (for the Peoples tab). */
export function techOutlook(sim: SimState, env: Env, lib: Library, who: { settlement?: number; clan?: number }) {
  return outlook(techContext(sim, env, lib), who);
}

function tradeContext(sim: SimState, env: Env, lib: Library, info: Info): TradeContext {
  return {
    sim,
    env,
    lib,
    info,
    dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by),
    passableAt: (ri, x, y) => passable(env, ri, cellOf(env, x, y)),
    cellAt: (x, y) => cellOf(env, x, y),
    rand: () => rand(sim),
    log: (text, x, y) => log(sim, text, x, y),
  };
}

function daily(sim: SimState, env: Env, info: Info, lib: Library): void {
  for (const t of sim.tribes) {
    const ri = info(t);
    if (!ri) continue;
    if (!t.target) continue;
    const d = dist(env, t.x, t.y, t.target.x, t.target.y);
    const k = cellOf(env, t.x, t.y);
    const slow = k >= 0 ? [1, 0.8, 0.6, 0.4, 0.3][env.mzone[k]] : 1;
    const stepKm = ri.speed * slow * (t.fed < 0.6 ? 0.7 : 1) * (k >= 0 ? WAYS[sim.way[k]].speed : 1);
    if (d <= stepKm) {
      t.x = t.target.x;
      t.y = t.target.y;
      t.target = null;
    } else {
      let dx = t.target.x - t.x;
      if (env.wrapKm && Math.abs(dx) > env.wrapKm / 2) dx -= Math.sign(dx) * env.wrapKm;
      const dy = t.target.y - t.y;
      const a0 = Math.atan2(dy, dx);
      let moved = false;
      // Straight on, or around whatever is in the way.
      for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const nx = t.x + Math.cos(a0 + turn) * stepKm;
        const ny = t.y + Math.sin(a0 + turn) * stepKm;
        if (passable(env, ri, cellOf(env, nx, ny))) {
          t.x = env.wrapKm ? ((nx % env.wrapKm) + env.wrapKm) % env.wrapKm : nx;
          t.y = ny;
          moved = true;
          break;
        }
      }
      if (!moved) t.target = null;
    }
    // Land walked through is claimed if no one holds it (a band round the tribe as it goes, not a
    // thin line: the land its people range over); and the way gets worn.
    const c = cellOf(env, t.x, t.y);
    if (c >= 0 && t.target) sim.traffic[c] += t.pop / 200;
    // The province it is in and those round it (not over a river or mountains).
    if (c >= 0) claimNear(sim, env, t.x, t.y, Math.max(ri.range * 0.8, provinceSpan(env, t.x, t.y) * 1.15), t.clan, (fx, fy, k) => beyondBarrier(env, fx, fy, k));
  }
  // Warbands on the move.
  for (const s of [...sim.sorties]) {
    const home = sim.tribes.find((t) => t.id === s.tribe);
    const city = s.targetKind === 'settlement' ? sim.settlements.find((q) => q.id === s.target && !q.ruined) : undefined;
    const enemy = s.targetKind === 'settlement' ? undefined : sim.tribes.find((t) => t.id === s.target);
    const goal = s.leg === 'out' ? enemy ?? city : home;
    if (!goal) {
      if (s.leg === 'out' && home) s.leg = 'home';
      else sim.sorties = sim.sorties.filter((q) => q !== s);
      continue;
    }
    const ri = home ? info(home) : null;
    const speed = (ri?.speed ?? 15) * 1.6;
    const d = dist(env, s.x, s.y, goal.x, goal.y);
    if (d > speed) {
      let dx = goal.x - s.x;
      if (env.wrapKm && Math.abs(dx) > env.wrapKm / 2) dx -= Math.sign(dx) * env.wrapKm;
      s.x += (dx / d) * speed;
      s.y += ((goal.y - s.y) / d) * speed;
      if (env.wrapKm) s.x = ((s.x % env.wrapKm) + env.wrapKm) % env.wrapKm;
      continue;
    }
    if (s.leg === 'out' && enemy) battle(sim, env, s, enemy, info, lib);
    else if (s.leg === 'out' && city) raid(sim, env, s, city, info, lib);
    else if (home) {
      // Back with the tribe.
      home.away = Math.max(0, home.away - s.strength);
      home.warband = Math.min(home.warband, home.pop);
      sim.sorties = sim.sorties.filter((q) => q !== s);
    }
  }
}

function battle(sim: SimState, env: Env, s: Sortie, enemy: Tribe, info: Info, lib: Library): void {
  const home = sim.tribes.find((t) => t.id === s.tribe);
  const ra = home ? info(home) : null;
  const rd = info(enemy);
  const defenders = Math.max(0, enemy.warband - enemy.away);
  // Their weapons: what their clans know.
  const armsOf = (clanId: number) => armsMight((id) => clanKnows(lib, sim.clans.find((c) => c.id === clanId), id));
  const fightOf = (culture?: string) => (culture ? cultureFx(sim, culture).fight : 1);
  const attack = s.strength * (ra?.might ?? 1) * armsOf(s.clan) * fightOf(home?.culture) * (0.6 + 0.8 * rand(sim));
  const defend = Math.max(1, defenders) * (rd?.might ?? 1) * armsOf(enemy.clan) * fightOf(enemy.culture) * 1.1 * (0.6 + 0.8 * rand(sim));
  const win = attack > defend;
  if (home) noteBetween(sim, home.culture, enemy.culture, 'fights');
  const loseA = Math.round(s.strength * (win ? 0.05 + 0.1 * rand(sim) : 0.25 + 0.2 * rand(sim)));
  const loseD = Math.round(defenders * (win ? 0.25 + 0.2 * rand(sim) : 0.05 + 0.1 * rand(sim)));
  s.strength = Math.max(0, s.strength - loseA);
  if (home) {
    home.pop = Math.max(0, home.pop - loseA);
    home.warband = Math.max(0, home.warband - loseA);
    home.away = Math.max(0, home.away - loseA);
  }
  enemy.pop = Math.max(0, enemy.pop - loseD);
  enemy.warband = Math.max(0, enemy.warband - loseD);
  const ac = sim.clans.find((c) => c.id === s.clan);
  const dc = sim.clans.find((c) => c.id === enemy.clan);
  if (win) {
    // The beaten tribe flees, and the land it was using goes to the winners.
    for (const p of provincesNear(env, enemy.x, enemy.y, (rd?.range ?? 20) * 1.2)) if (holderOf(sim, p) === enemy.clan) setHolder(sim, env, p, s.clan);
    const a = Math.atan2(enemy.y - s.y, enemy.x - s.x);
    const flee = { x: enemy.x + Math.cos(a) * 120, y: enemy.y + Math.sin(a) * 120 };
    enemy.winter = flee;
    enemy.summer = flee;
    enemy.target = flee;
    log(sim, `The warband of ${home?.name ?? 'a tribe'} (clan ${ac?.name ?? '?'}) drove off ${enemy.name} (clan ${dc?.name ?? '?'}): ${loseA} and ${loseD} fell.`, enemy.x, enemy.y);
  } else log(sim, `${enemy.name} (clan ${dc?.name ?? '?'}) beat off the warband of ${home?.name ?? 'a tribe'} (clan ${ac?.name ?? '?'}): ${loseA} and ${loseD} fell.`, enemy.x, enemy.y);
  s.leg = 'home';
}

/** A warband falls on a settlement: if it wins it carries off food and the land round it. */
function raid(sim: SimState, env: Env, s: Sortie, st: Settlement, info: Info, lib: Library): void {
  const home = sim.tribes.find((t) => t.id === s.tribe);
  const ra = home ? info(home) : null;
  const rd = info(st);
  const defenders = Math.max(1, st.warband);
  const has = (id: string) => knows(lib, st, id);
  const attack = s.strength * (ra?.might ?? 1) * armsMight((id) => clanKnows(lib, sim.clans.find((c) => c.id === s.clan), id)) * (home ? cultureFx(sim, home.culture).fight : 1) * (0.6 + 0.8 * rand(sim));
  // Defending their own homes, behind whatever they have built (walls, with fortification).
  const defend = defenders * (rd?.might ?? 1) * armsMight(has) * wallsMight(has) * townFx(sim, st).fight * 1.35 * (0.6 + 0.8 * rand(sim));
  if (home) noteBetween(sim, home.culture, st.culture, 'fights');
  st.hardship = { famine: st.hardship?.famine ?? 0, war: (st.hardship?.war ?? 0) + 1 };
  const win = attack > defend;
  const loseA = Math.round(s.strength * (win ? 0.05 + 0.1 * rand(sim) : 0.25 + 0.2 * rand(sim)));
  const loseD = Math.round(defenders * (win ? 0.2 + 0.2 * rand(sim) : 0.05 + 0.1 * rand(sim)));
  s.strength = Math.max(0, s.strength - loseA);
  if (home) {
    home.pop = Math.max(0, home.pop - loseA);
    home.warband = Math.max(0, home.warband - loseA);
    home.away = Math.max(0, home.away - loseA);
  }
  st.warband = Math.max(0, st.warband - loseD);
  st.pop = Math.max(0, st.pop - loseD - (win ? Math.round(st.pop * 0.04) : 0));
  const ac = sim.clans.find((c) => c.id === s.clan);
  const what = st.kind === 'dawn' ? `the dawn city ${st.name}` : st.name;
  if (win) {
    if (home) home.fed = Math.max(home.fed, 1.1);
    // The land round it (not the province it stands in).
    if (rd) {
      const home = provAt(env, st.x, st.y);
      for (const p of provincesNear(env, st.x, st.y, Math.max(settleRange(rd, st) * 0.6, provinceSpan(env, st.x, st.y) * 1.15))) if (p !== home && holderOf(sim, p) === st.clan) setHolder(sim, env, p, s.clan);
    }
    log(sim, `The warband of ${home?.name ?? 'a tribe'} (clan ${ac?.name ?? '?'}) raided ${what}: ${loseA} and ${loseD} fell.`, st.x, st.y);
    // An archive can burn.
    if (hasArchive(lib, st, sim.day) && rand(sim) < 0.25) {
      st.archiveBurnedUntil = sim.day + DAYS_PER_YEAR * 5;
      log(sim, `The archive of ${st.name} was burned in the raid.`, st.x, st.y);
    }
  } else log(sim, `${what.charAt(0).toUpperCase() + what.slice(1)} beat off the warband of ${home?.name ?? 'a tribe'} (clan ${ac?.name ?? '?'}): ${loseA} and ${loseD} fell.`, st.x, st.y);
  // Raiding a holy place: every one of the race it is holy to holds it against the raiders' race.
  if (home) for (const r of st.holyTo) if (r !== home.race) {
    const g = sim.grudges.find((q) => q.race === r && q.against === home.race);
    if (g) g.until = sim.day + DAYS_PER_YEAR * 20;
    else {
      sim.grudges.push({ race: r, against: home.race, until: sim.day + DAYS_PER_YEAR * 20 });
      log(sim, `The ${info({ race: r, culture: '' })?.race.name ?? r} will not forget the raid on ${what}, holy to them.`, st.x, st.y);
    }
  }
  s.leg = 'home';
}

/** Food from the land round a place: plants first, then game. Takes from the month's plant pool and the beasts. */
function forage(sim: SimState, env: Env, left: Float32Array, cells: number[], range: number, need: number, plantPart: number, gardens: number, hunt = 1): number {
  const area = Math.PI * range * range;
  const share = cells.length ? Math.min(1, area / (cells.length * env.cellArea)) : 0;
  let got = 0;
  for (const c of cells) {
    if (got >= need * plantPart) break;
    const take = Math.min(left[c] * share, (need * plantPart - got) / gardens);
    left[c] -= take;
    got += take * gardens;
  }
  for (const b of env.beastInfo) {
    if (b.water || got >= need * 1.05) continue;
    const D = sim.beasts[b.id];
    for (const c of cells) {
      if (got >= need * 1.05) break;
      const stock = D[c] * b.meat * env.cellArea * share;
      if (stock <= 0) continue;
      const take = Math.min(stock * 0.06 * b.catchRate * hunt, need * 1.05 - got);
      got += take;
      D[c] = Math.max(0, D[c] - take / (b.meat * env.cellArea * Math.max(share, 1e-6)));
      markThinned(sim, b.id, c);
    }
  }
  return got;
}
/** A clan uses land: unclaimed land becomes its own; another clan's is taken after a year of use while its owners are away. */
/**
 * Natural borders: is this point on the far side of a river or a high mountain range from (x, y)?
 * Peoples ranging round them claim up to such a barrier; the land beyond is claimed by going there
 * (or taken by use or war), so borders come to follow rivers and ridges.
 */
function beyondBarrier(env: Env, x: number, y: number, k: number): boolean {
  const tx = xOf(env, k);
  const ty = yOf(env, k);
  let dx = tx - x;
  if (env.wrapKm && Math.abs(dx) > env.wrapKm / 2) dx -= Math.sign(dx) * env.wrapKm;
  const dy = ty - y;
  const n = Math.ceil(Math.hypot(dx, dy) / (env.step * 0.5));
  const start = cellOf(env, x, y);
  for (let i = 1; i < n; i++) {
    const c = cellOf(env, x + (dx * i) / n, y + (dy * i) / n);
    if (c < 0 || c === start || c === k) continue;
    if (env.fresh[c] || env.mzone[c] >= 3) return true;
  }
  return false;
}

/**
 * The land once a year: each province to the people living on and using it (holding.ts), then
 * tidied (land.ts): holes filled whole, lone specks given to the land round them.
 */
function tidyLand(sim: SimState, env: Env, info: Info): void {
  const seats = new Set<number>();
  const sources: Presence[] = [];
  for (const st of sim.settlements) {
    if (st.ruined || st.layer) continue;
    seats.add(provAt(env, st.x, st.y));
    const ri = info(st);
    if (ri) sources.push({ clan: st.clan, race: st.race, x: st.x, y: st.y, pop: st.pop, r: settleRange(ri, st), seat: true });
  }
  for (const t of sim.tribes) {
    const ri = info(t);
    if (ri) sources.push({ clan: t.clan, race: t.race, x: t.x, y: t.y, pop: t.pop, r: ri.range * 1.6 });
  }
  holdYear(sim, env, sources, (fx, fy, k) => beyondBarrier(env, fx, fy, k));
  tidyProvinces(sim, env, seats);
}

function useLand(sim: SimState, env: Env, cells: number[], clan: number, from?: { x: number; y: number }): void {
  useProvinces(sim, env, cells, clan, from, (fx, fy, c) => beyondBarrier(env, fx, fy, c));
}

function monthly(sim: SimState, env: Env, lib: Library, info: Info): void {
  // Plant food this month, shared by everyone foraging there.
  const left = new Float32Array(env.n);
  const sIdx = northernSummer(sim.day) ? 0 : 1;
  for (let k = 0; k < env.n; k++) if (env.land[k]) left[k] = env.plant[sIdx][k] * env.cellArea;
  // Beasts grow back toward what the land carries.
  // A season's growth every three months (the same in the end, for a third of the work).
  if (Math.floor(sim.day / DAYS_PER_MONTH) % 3 === 0) for (const b of env.beastInfo) {
    const D = sim.beasts[b.id];
    const K = env.beastK[b.id];
    // Only where it is below what the land carries (thinned.ts).
    const low = thinned(sim, env, b.id);
    for (const k of low) {
      const cap = K[k] * 0.95;
      D[k] = Math.min(cap, D[k] + 3 * (b.regrow * D[k] * (1 - D[k] / cap) + 0.002 * cap));
      if (D[k] >= cap) low.delete(k);
    }
  }
  for (const t of [...sim.tribes]) {
    const ri = info(t);
    if (!ri) continue;
    // Seasons: off to the summer or winter grounds.
    const summer = localSummer(env, t, sim.day);
    const wasSummer = localSummer(env, t, sim.day - DAYS_PER_MONTH);
    if (summer !== wasSummer) t.target = summer ? { ...t.summer } : { ...t.winter };
    else if (ri.lifestyle === 'Nomadic' && !t.target && rand(sim) < 0.35) {
      // Nomads keep moving within their round.
      const g = summer ? t.summer : t.winter;
      t.target = { x: g.x + (rand(sim) - 0.5) * ri.range * 3, y: g.y + (rand(sim) - 0.5) * ri.range * 3 };
    }
    // Food: plants first, then game.
    const need = t.pop * ri.need;
    const cells = cellsNear(env, t.x, t.y, ri.range).filter((c) => env.land[c]);
    const cfx = cultureFx(sim, t.culture);
    const got = forage(sim, env, left, cells, ri.range, need, 0.65, 1, cfx.hunt);
    t.fed = need > 0 ? got / need : 1;
    // People: births and deaths, with hunger.
    const f = Math.min(1.2, t.fed);
    // Past what they can bear (attraction.ts), fewer are born and more die.
    const hc = climateAt(env, ri, cellOf(env, t.x, t.y));
    const births = (ri.births / 12) * Math.min(1, f) * (f >= 1 ? 1.3 : 1) * cfx.births * hardBirths(hc);
    const deaths = ri.deaths / 12 + (f < 1 ? ((1 - f) * 0.5 * cfx.famine) / 12 : 0) + hardDeaths(hc) / 12;
    const change = t.pop * (births - deaths);
    t.pop = Math.max(0, t.pop + change + (rand(sim) - 0.5) * 0.5);
    t.warband = Math.max(t.away, Math.round(t.pop * ri.warShare));
    // Claims: the land it uses (forages, hunts, ranges over) is its clan's; another clan's land is
    // taken by using it long enough.
    useLand(sim, env, cellsNear(env, t.x, t.y, ri.range * 1.6), t.clan, t);
    // Fights over land and food: a warband goes out, and comes back.
    const home = t.warband - t.away;
    if (home >= 8 && !sim.sorties.some((s) => s.tribe === t.id)) {
      let best: { e: Tribe; p: number } | null = null;
      for (const e of sim.tribes) {
        if (e.clan === t.clan || dist(env, e.x, e.y, t.x, t.y) > ri.range * 3) continue;
        const contested = cellsNear(env, e.x, e.y, ri.range).some((c) => sim.owner[c] === e.clan && sim.rival[c] === t.clan) || cells.some((c) => sim.owner[c] === e.clan);
        const stress = Math.max(0.1, Math.min(1, 1.2 - t.fed)) + (contested ? 0.5 : 0);
        // A warband goes out when it thinks it can win: the odds count.
        const re = info(e);
        const odds = (home * 0.8 * ri.might) / Math.max(1, (e.warband - e.away) * (re?.might ?? 1));
        if (odds < 0.7) continue;
        const p = 0.035 * hostility(sim, lib, t, e, ri) * stress * Math.min(2, odds) * cfx.war;
        if (!best || p > best.p) best = { e, p };
      }
      // Settlements nearby: raided for their food, but never a holy place of the tribe's own race.
      let raidOn: { st: Settlement; p: number } | null = null;
      for (const st of sim.settlements) {
        if (st.ruined || st.clan === t.clan || st.holyTo.includes(t.race) || dist(env, st.x, st.y, t.x, t.y) > ri.range * 3) continue;
        const rd = info(st);
        const odds = (home * 0.8 * ri.might) / Math.max(1, st.warband * (rd?.might ?? 1) * 1.35);
        if (odds < 0.8) continue;
        const stress = Math.max(0.1, Math.min(1, 1.2 - t.fed)) + (cells.some((c) => sim.owner[c] === st.clan) ? 0.4 : 0);
        const p = 0.025 * hostility(sim, lib, t, st, ri) * stress * Math.min(2, odds) * cfx.raid;
        if (!raidOn || p > raidOn.p) raidOn = { st, p };
      }
      if (raidOn && (!best || raidOn.p > best.p) && rand(sim) < raidOn.p) {
        const strength = Math.round(home * 0.8 * championMight(sim, t.clan));
        t.away += strength;
        sim.sorties.push({ id: sim.nextId++, tribe: t.id, clan: t.clan, target: raidOn.st.id, targetKind: 'settlement', strength, x: t.x, y: t.y, leg: 'out' });
        noteAttack(sim, lib, (text, x, y) => log(sim, text, x, y), t.clan, raidOn.st.clan);
        note(sim, t.culture, 'raids');
      } else if (best && rand(sim) < best.p) {
        const strength = Math.round(home * 0.8 * championMight(sim, t.clan));
        t.away += strength;
        sim.sorties.push({ id: sim.nextId++, tribe: t.id, clan: t.clan, target: best.e.id, targetKind: 'tribe', strength, x: t.x, y: t.y, leg: 'out' });
        noteAttack(sim, lib, (text, x, y) => log(sim, text, x, y), t.clan, best.e.clan);
        note(sim, t.culture, 'fights');
      }
    }
  }
  // Settlements: fed from the land round them, worked harder than a tribe can (gardens and stores).
  // Towns: and with the food they draw from the provinces they reach (catchment.ts), a month's share into their stores.
  for (const st of sim.settlements) if (st.imports && !st.ruined && st.economy) st.economy.stores[PROVISIONS] = (st.economy.stores[PROVISIONS] ?? 0) + st.imports.rations;
  const lc = layerContext(sim, env, lib);
  // Towns and their joined villages (REDESIGN.md 8.0): the towns first, each working and eating as
  // one with its villages; then the villages, fed as their town is.
  const byId = new Map(sim.settlements.map((q) => [q.id, q]));
  const members = new Map<number, Settlement[]>();
  for (const q of sim.settlements) {
    if (q.ruined || q.partOf === undefined) continue;
    const t = byId.get(q.partOf);
    if (t && !t.ruined) members.set(t.id, [...(members.get(t.id) ?? []), q]);
  }
  const order = [...sim.settlements].sort((a, b) => (a.partOf === undefined ? 0 : 1) - (b.partOf === undefined ? 0 : 1));
  for (const st of order) {
    if (st.ruined) continue;
    const ri = info(st);
    if (!ri) continue;
    const R = settleRange(ri, st);
    const cells = cellsNear(env, st.x, st.y, R).filter((c) => env.land[c]);
    const town = st.partOf !== undefined ? byId.get(st.partOf) : undefined;
    if (town && !town.ruined) st.fed = town.fed;
    else {
      // Its economy: jobs, harvests, stores, eating (economy.ts).
      // Under siege only the fields within the walls are worked, and the besiegers trample the crop.
      if (st.besieged && st.economy) st.economy.crop *= 0.7;
      // A town with joined villages: all their people, and all the land round them all.
      const mine = st.besieged ? [] : members.get(st.id) ?? [];
      const near = mine.length
        ? () => [...new Set([st, ...mine].flatMap((q) => cellsNear(env, q.x, q.y, R)))]
        : (x: number, y: number, r: number) => cellsNear(env, x, y, r);
      st.fed = economyMonth({ sim, env, st, need: ri.need, workShare: ri.workShare * (st.besieged ? 0.25 : 1), r: st.besieged ? Math.min(R, 3) : R, cellsNear: near, left, summer: localSummerAt(env, st.x, st.y, sim.day), wasSummer: localSummerAt(env, st.x, st.y, sim.day - DAYS_PER_MONTH), has: (id) => knows(lib, st, id), cfx: townFx(sim, st), monthsLeft: monthsLeft(env, st.x, st.y, sim.day), south: env.lat[Math.max(0, landCell(env, st.x, st.y))] < 0, year: Math.floor(sim.day / DAYS_PER_YEAR), ...(mine.length ? { pop: st.pop + mine.reduce((n, q) => n + q.pop, 0), reachKey: mine.map((q) => q.id).join(',') } : {}) });
    }
    // On another layer: less from the land below, and what the layer itself grows (layers.ts).
    if (st.layer && !town) {
      const lf = layerFood(lc, st);
      st.fed = Math.max(st.fed * lf.mul, lf.floor);
    }
    if (st.fed < 0.8) st.hardship = { famine: (st.hardship?.famine ?? 0) + (1 - st.fed) / 6, war: st.hardship?.war ?? 0 };
    if (st.fed < 0.6) note(sim, st.culture, 'famines');
    if (st.fed < 0.6 && !sim.events.some((e) => e.text.startsWith(`Famine in ${st.name}`) && sim.day - e.day < DAYS_PER_YEAR)) log(sim, `Famine in ${st.name}: its stores are gone${st.economy?.harvest && st.economy.harvest.year < 0.8 ? ' after a bad harvest' : ''}.`, st.x, st.y);
    const f = Math.min(1.2, st.fed);
    const comfort = st.economy?.comfort ?? 1;
    const scfx = townFx(sim, st);
    // Past what they can bear (attraction.ts), fewer are born and more die (walls and stores soften it a little).
    const hc = st.layer ? 1 : climateAt(env, ri, landCell(env, st.x, st.y));
    const births = (ri.births / 12) * 1.1 * Math.min(1, f) * (f >= 1 ? 1.3 : 1) * (0.85 + 0.15 * comfort) * scfx.births * hardBirths(hc);
    const deaths = ri.deaths / 12 + (f < 1 ? ((1 - f) * 0.5 * scfx.famine) / 12 : 0) + (hardDeaths(hc) * 0.75) / 12;
    st.pop = Math.max(0, st.pop + st.pop * (births - deaths));
    st.warband = Math.round(st.pop * ri.warShare * 0.6);
    useLand(sim, env, cells, st.clan, st);
    if (st.pop < 25) {
      st.ruined = true;
      // What only its people knew is gone with them.
      st.techs = [];
      st.ruinedOn = sim.day;
      const kin = sim.tribes.find((q) => q.clan === st.clan && dist(env, q.x, q.y, st.x, st.y) < 400);
      if (kin) movePeople(sim, st, kin, st.pop);
      st.pop = 0;
      st.pops = [];
      st.warband = 0;
      log(sim, `${st.kind === 'dawn' ? 'The dawn city ' : ''}${st.name} has fallen to ruin${st.holyTo.length ? '; it is holy still' : ''}.`, st.x, st.y);
    }
  }
  // The wilderness (density.ts): settlements send a trickle of families out into the land round
  // them; then the families in the wild eat what the land still has, grow or die back, and move on.
  for (const st of sim.settlements) {
    if (st.ruined || st.fed < 0.9 || st.pop < 60) continue;
    const ri = info(st);
    if (!ri) continue;
    // A town past its first size sends more: families going out to live off the land round it
    // (they stay its people's kin in the wild; they are not bands, which are warbands and come home).
    const past = st.pop > (st.kind === 'dawn' ? 900 : st.seat ? 450 : 300);
    const out = st.pop * (past ? WILD_TRICKLE_FULL : WILD_TRICKLE);
    toCountry(sim, env, provAt(env, st.x, st.y), takePops(sim, st, out));
    seedDensity(sim, env, st.race, cellsNear(env, st.x, st.y, settleRange(ri, st) * (past ? 3 : 2.5)), out);
  }
  // Round a town (its pooled stores and market) life in the wild is easier: the families grow faster.
  const boost = new Float32Array(env.n);
  for (const st of sim.settlements) {
    if (st.ruined || st.layer || st.partOf !== undefined || settlementTier(st) === 'Village') continue;
    for (const k of cellsNear(env, st.x, st.y, (knows(lib, st, 'riding') ? DAY_RIDE : DAY_WALK) * 2)) boost[k] = 1;
  }
  // Farmed provinces: their land's food for the rural people living there (rural.ts).
  if (!farmLayer(sim)) farmYear(ruralContext(sim, env, lib, info));
  addFarmFood(sim, left);
  densityMonth({ sim, env, left, race: (id) => densityRace(sim, env, lib, info, id), boost });
  sim.grudges = sim.grudges.filter((g) => g.until > sim.day);
  // Markets and caravans (trade.ts).
  tradeMonth(tradeContext(sim, env, lib, info));

  // The starved and the slain: tiny remnants join kin nearby, or are lost.
  for (const t of [...sim.tribes]) {
    if (t.pop >= 15) continue;
    const kin = sim.tribes.filter((q) => q !== t && q.clan === t.clan).sort((a, b) => dist(env, a.x, a.y, t.x, t.y) - dist(env, b.x, b.y, t.x, t.y))[0];
    if (kin && dist(env, kin.x, kin.y, t.x, t.y) < 400) {
      movePeople(sim, t, kin, t.pop);
      log(sim, `${t.name} was too few to go on and joined ${kin.name}.`, t.x, t.y);
    } else log(sim, `${t.name} died out.`, t.x, t.y);
    sim.tribes = sim.tribes.filter((q) => q !== t);
    sim.sorties = sim.sorties.filter((s) => s.tribe !== t.id);
  }
  // Wars: weariness, peace, armies raised (wars.ts).
  if (sim.wars?.some((w) => w.ended === undefined)) warsMonth(warContext(sim, env, lib, info));
  // Rifts at breaking point, monster tides and their hordes (monsters.ts).
  // Held off (riftsHeld): none breaks, and the tides neither spread nor send out hordes.
  if (!sim.riftsHeld && (sim.rifts?.length || sim.tides?.length)) monstersMonth({ ...warContext(sim, env, lib, info), name: () => makeName(sim, lib, '') });
}

/** What wars and armies need: the realms' context, and each people's strength and marching pace. */
function warContext(sim: SimState, env: Env, lib: Library, info: Info): WarContext {
  return {
    ...rulerContext(sim, lib),
    env,
    lib,
    dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by),
    cellAt: (x, y) => cellOf(env, x, y),
    log: (text, x, y) => log(sim, text, x, y),
    might: (race, culture) => (info({ race, culture })?.might ?? 1) * cultureFx(sim, culture).fight,
    // An army marches a little slower than a tribe on the move.
    speed: (race, culture) => (info({ race, culture })?.speed ?? 15) * 0.9,
    racial: (race) => {
      const ri = info({ race, culture: '' });
      return { flies: !!ri?.flies, mountains: !!ri?.mountains, specialty: ri?.race.specialty ?? '', digs: !!ri?.lw.digs };
    },
  };
}

/** How readily one tribe fights another: its race's attitude, kinship and shared culture. */
function hostility(sim: SimState, lib: Library, t: Tribe, e: { species: string; race: string; culture: string; clan: number; faith?: string }, ri: RaceInfo): number {
  const other = lib.species.find((s) => s.id === e.species);
  const over = ri.species.profile.attitudes.find((a) => a.species === other?.name)?.attitude;
  const att = over || ri.attitude;
  let h = att === 'Welcoming' ? 0.25 : att === 'Indifferent' ? 0.6 : 1;
  if (t.species === e.species) h *= 0.7;
  if (t.culture && t.culture === e.culture) h *= 0.6;
  const tc = sim.clans.find((c) => c.id === t.clan);
  const ec = sim.clans.find((c) => c.id === e.clan);
  if (tc && ec && (tc.parent === ec.id || ec.parent === tc.id)) h *= 0.3;
  // A grudge over a holy place.
  if (sim.grudges.some((g) => g.race === t.race && g.against === e.race)) h *= 2.5;
  // Its culture: xenophobes are quicker to fight other races, the hospitable slower.
  if (t.race !== e.race) h *= cultureFx(sim, t.culture).otherRace;
  // Acceptance between their cultures eases (or sharpens) it.
  if (t.culture !== e.culture) h *= 1 - 0.5 * acceptance(sim, t.culture, e.culture);
  // Their realms: treaties keep the peace; ill will and an ally's quarrel sharpen it.
  if (t.clan !== e.clan) h *= diplomacyFactor(sim, t.clan, e.clan);
  // Their faiths: holy war sharpens it against unbelievers; pacifism softens it.
  h *= faithHostility(sim, t.faith, e.faith);
  return h;
}

function yearly(sim: SimState, env: Env, lib: Library, info: Info): void {
  for (const t of [...sim.tribes]) {
    const ri = info(t);
    if (!ri) continue;
    // Settling down, by way of life and the land.
    if (trySettle(sim, env, lib, t, ri)) continue;
    // Grounds looked at again each year.
    chooseGrounds(sim, env, lib, t);
    // Too many for one tribe: a part breaks away to find land of its own.
    if (t.pop > 400 && t.fed >= 0.85) {
      const share = 0.35 + 0.1 * rand(sim);
      const n = Math.round(t.pop * share);
      const going = takePops(sim, t, n);
      const clan = sim.clans.find((c) => c.id === t.clan)!;
      const kinTribes = sim.tribes.filter((q) => q.clan === clan.id);
      // Far from kin, or a big clan: the new tribe may start a clan of its own.
      const first = kinTribes[0];
      const far = first ? dist(env, first.x, first.y, t.x, t.y) > 700 : false;
      let clanId = clan.id;
      // (Only a clan still ruled as clans and tribes: a settled realm keeps its tribes.)
      if ((kinTribes.length >= 6 || far) && tribalRule(lib, clan) && rand(sim) < 0.5) {
        const nc = newClan(sim, lib, clan.species, clan.race, clan.culture, clan.id);
        clanId = nc.id;
        log(sim, `A new clan, ${nc.name}, broke away from clan ${clan.name}.`, t.x, t.y);
      }
      const nt: Tribe = { ...t, id: sim.nextId++, name: makeName(sim, lib, t.culture), clan: clanId, pop: n, warband: 0, away: 0, founded: sim.day, target: null, summer: { ...t.summer }, winter: { ...t.winter } };
      nt.warband = Math.round(n * ri.warShare);
      startPops(sim, nt, going);
      // Off to new land a little way away.
      const a = rand(sim) * Math.PI * 2;
      const d = ri.range * (3 + rand(sim) * 4);
      nt.winter = { x: t.winter.x + Math.cos(a) * d, y: t.winter.y + Math.sin(a) * d };
      nt.summer = { x: t.summer.x + Math.cos(a) * d, y: t.summer.y + Math.sin(a) * d };
      if (!passable(env, ri, cellOf(env, nt.winter.x, nt.winter.y))) nt.winter = { ...t.winter };
      sim.tribes.push(nt);
      chooseGrounds(sim, env, lib, nt);
      nt.target = localSummer(env, nt, sim.day) ? { ...nt.summer } : { ...nt.winter };
      log(sim, `${nt.name} split from ${t.name} and went to find land of its own.`, t.x, t.y);
    }
  }
  settlementsYearly(sim, env, lib, info);
  // Villages from the wild, and villages joining towns (REDESIGN.md 8.0).
  villagesFromWild(sim, env, lib, info);
  joinVillages(sim, env, lib);
  // Who the people are (pops.ts): classes in the towns, wild folk drawn to the towns, the wild folk's make-up.
  popsYear(sim, env, lib, info);
  ensureLanguages(sim);
  // Each realm's people: national identity, grievance, stance (identity.ts).
  identityYear({
    sim,
    enforce: (id) => {
      const clan = sim.clans.find((q) => q.id === id);
      const gov = clan?.realm ? lib.governments.find((g) => g.id === clan.realm!.gov) : undefined;
      return clan?.realm ? LAND_ENFORCE[gov?.land ?? ''] ?? 0.4 : 0;
    },
    acceptance: (a, b) => acceptance(sim, a, b),
    faithAgainst: (clan, st) => faithLoyalty(sim, clan, st),
    coreDistance: (st) => coreDistanceOf(sim, env, st, (x, y) => provAt(env, x, y)) ?? 0,
    atWar: (id) => !!sim.wars?.some((w) => w.ended === undefined && (w.attackers.includes(id) || w.defenders.includes(id))),
    dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by),
  });
  // Every five years, the culture tick: pressure from the settlements, pops changing a slice at a time (culturetick.ts).
  if (Math.round(sim.day / DAYS_PER_YEAR) % CULTURE_TICK === 0) {
    const tierOf = (st: Settlement) => settlementTier(st);
    const capitalOf = (st: Settlement) => sim.clans.some((q) => q.id === st.clan && q.realm?.capital === st.id);
    const press = cultureTick({
      sim, env, lib,
      provAt: (x, y) => provAt(env, x, y),
      tier: (st) => settlementTier(st),
      enforce: (id) => {
        const clan = sim.clans.find((q) => q.id === id);
        const gov = clan?.realm ? lib.governments.find((g) => g.id === clan.realm!.gov) : undefined;
        return clan?.realm ? LAND_ENFORCE[gov?.land ?? ''] ?? 0.4 : 0;
      },
      capital: (st) => sim.clans.some((q) => q.id === st.clan && q.realm?.capital === st.id),
      log: (text, x, y) => log(sim, text, x, y),
    });
    // Drift, splits, blends and cohesion (drift.ts).
    const change = { sim, lib, rand: () => rand(sim), dist: (ax: number, ay: number, bx: number, by: number) => dist(env, ax, ay, bx, by), log: (text: string, x?: number, y?: number) => log(sim, text, x, y) };
    driftTick({
      sim, env, lib, press,
      provAt: (x, y) => provAt(env, x, y),
      tier: tierOf,
      capital: capitalOf,
      make: (from, hint) => offshoot(change, from, hint),
      acceptance: (a, b) => acceptance(sim, a, b),
      log: (text, x, y) => log(sim, text, x, y),
    });
    // Dialects, new languages and creoles (languages.ts).
    languagesTick({ sim, env, provAt: (x, y) => provAt(env, x, y), rand: () => rand(sim), log: (text, x, y) => log(sim, text, x, y) });
    // A snapshot for the history of peoples (history.ts).
    historyTick(sim, env, (x, y) => provAt(env, x, y));
  }
  // The other layers: drifting islands carry their towns; tunnelers join their towns underground.
  if (env.layers) {
    const lc = layerContext(sim, env, lib);
    driftYear(lc, env.w * env.step, env.h * env.step, env.wrapKm);
    // Each town on another layer holds the provinces of its layer round it (layerprovs.ts).
    if (env.layerProv) holdLayersYear(sim, env.layerProv, (st) => { const ri = info(st); return ri ? settleRange(ri, st) * 1.5 : 30; }, (ax, ay, bx, by) => dist(env, ax, ay, bx, by));
    digYear(lc, (st) => !!info(st)?.lw.digs);
  }
  // Discoveries, learning and forgetting (tech.ts).
  techYear(techContext(sim, env, lib));
  // Mana: towns on strong mana that chart ley lines raise mage towers, new nodes (mana.ts).
  manaYear({ sim, env, lib, rand: () => rand(sim), log: (text, x, y) => log(sim, text, x, y) });
  // Rifts: corruption, rifts opening and closing, who holds them and how, what they give (rifts.ts).
  riftsYear({ sim, env, lib, rand: () => rand(sim), dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by), log: (text, x, y) => log(sim, text, x, y), name: () => makeName(sim, lib, sim.clans[Math.floor(rand(sim) * Math.max(1, sim.clans.length))]?.culture ?? '') });
  // Cultures: peoples without one (older saves) grow their folk culture; then traditions and behaviours change (culture.ts).
  for (const g of [...sim.tribes, ...sim.settlements.filter((q) => !q.ruined)]) {
    if (g.culture && cultureOf(sim, g.culture)) continue;
    const species = lib.species.find((q) => q.id === g.species);
    const race = species?.races.find((r) => r.id === g.race);
    if (!species || !race) continue;
    g.culture = ensureCulture(sim, lib, env, species, race, g.x, g.y, () => rand(sim));
    const clan = sim.clans.find((q) => q.id === g.clan);
    if (clan && !clan.culture) clan.culture = g.culture;
  }
  // Peoples living past what their race can bear adapt over the generations (adapt.ts).
  adaptYear({
    sim,
    env,
    people: (cu) => {
      const out: { k: number; pop: number; wants: Wants; adaptable: boolean }[] = [];
      for (const g of [...sim.settlements.filter((q) => !q.ruined && !q.layer), ...sim.tribes]) {
        if (g.culture !== cu.id) continue;
        const ri = info(g);
        if (ri) out.push({ k: landCell(env, g.x, g.y), pop: g.pop, wants: wantsOf(env, ri), adaptable: ri.adaptable });
      }
      return out;
    },
    log: (text, x, y) => log(sim, text, x, y),
  });
  cultureYear({ sim, env, lib, rand: () => rand(sim), dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by), log: (text, x, y) => log(sim, text, x, y) });
  // Each town's own version of its culture: what it adds or drops by its life there (culture.ts).
  localYear({ sim, env, lib, rand: () => rand(sim), dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by), log: (text, x, y) => log(sim, text, x, y) });
  // Each culture's traits as its people live now (traits.ts).
  traitsYear({
    sim, env, lib,
    cellOf: (x, y) => landCell(env, x, y),
    knows: (st, id) => knows(lib, st, id),
    lawOfClan: (id) => {
      const gov = sim.clans.find((q) => q.id === id)?.realm?.gov;
      return (gov && lib.governments.find((g) => g.id === gov)?.law) || '';
    },
    isTown: (st) => settlementTier(st) !== 'Village',
  });
  // How cultures change one another: acceptance, the pull of big settlements, divergence, blending (cultureChange.ts).
  cultureChangeYear({ sim, lib, rand: () => rand(sim), dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by), log: (text, x, y) => log(sim, text, x, y) });
  // Clean claims: holes filled, stray specks absorbed.
  tidyLand(sim, env, info);
  // Realms: capitals, governments, rulers, reach, culture pressed on their places (nations.ts).
  const nc = { ...rulerContext(sim, lib), env, lib, dist: (ax: number, ay: number, bx: number, by: number) => dist(env, ax, ay, bx, by), cellAt: (x: number, y: number) => cellOf(env, x, y), log: (text: string, x?: number, y?: number) => log(sim, text, x, y) };
  const { royalRoads } = nationsYear(nc);
  // Faiths: who follows what, organization, fervour, conversion, splits; and the gods (faith.ts).
  faithYear(nc);
  // Royal families, factions, diplomacy and spies (politics.ts).
  const { pactRoads } = politicsYear({ ...nc, newClan: (from) => newClan(sim, lib, from.species, from.race, from.culture, from.id) });
  // Going to war (wars.ts).
  warsYear(warContext(sim, env, lib, info));
  // Village paths: short, straight paths from a town to its joined villages, walked every day;
  // part of the town, made by no trader (roads.ts).
  for (const v of sim.settlements) {
    if (v.partOf === undefined || v.ruined) continue;
    const t = sim.settlements.find((q) => q.id === v.partOf && !q.ruined);
    if (!t) continue;
    for (const k of straightCells(env, t.x, t.y, v.x, v.y, (x, y) => cellOf(env, x, y))) sim.traffic[k] = Math.max(sim.traffic[k], VILLAGE_PATH);
  }
  // Trails from use; roads and railways built, kept up, or let go; bridges by settled realms (ways.ts).
  const clanById = new Map(sim.clans.map((q) => [q.id, q]));
  waysYear({ sim, env, lib, cellAt: (x, y) => cellOf(env, x, y), log: (text, x, y) => log(sim, text, x, y), royalRoads: [...royalRoads, ...pactRoads], bridges: (st) => !!clanById.get(st.clan) && !tribalRule(lib, clanById.get(st.clan)!) });
  // Ways fade unless they are used; routes long unused are forgotten.
  for (let k = 0; k < sim.traffic.length; k++) sim.traffic[k] *= 0.85;
  sim.routes = sim.routes.filter((r) => sim.day - r.last < DAYS_PER_YEAR * 10 && sim.settlements.some((q) => q.id === r.a && !q.ruined) && sim.settlements.some((q) => q.id === r.b && !q.ruined));
  // Clans with no tribes or settlements are gone (their land stays claimed until others use it).
  const live = new Set([...sim.tribes.map((t) => t.clan), ...sim.settlements.filter((s) => !s.ruined).map((s) => s.clan)]);
  for (const c of sim.clans.filter((q) => !live.has(q.id))) log(sim, `Clan ${c.name} is no more.`);
  sim.clans = sim.clans.filter((c) => live.has(c.id));
  // A last small tribe of a clan may join a friendly clan of its people nearby.
  for (const c of [...sim.clans]) {
    const mine = sim.tribes.filter((t) => t.clan === c.id);
    if (mine.length !== 1 || mine[0].pop > 80 || sim.settlements.some((s) => !s.ruined && s.clan === c.id)) continue;
    const t = mine[0];
    const other = sim.tribes.find((q) => q.clan !== c.id && q.race === t.race && q.culture === t.culture && dist(env, q.x, q.y, t.x, t.y) < 250);
    if (other && rand(sim) < 0.3) {
      t.clan = other.clan;
      transferAll(sim, env, c.id, other.clan);
      sim.clans = sim.clans.filter((q) => q.id !== c.id);
      log(sim, `Clan ${c.name} joined clan ${sim.clans.find((q) => q.id === other.clan)?.name ?? '?'}.`, t.x, t.y);
    }
  }
}

/** A year's share of the wild folk within two days' walk that a growing town draws in, and at most this share of its own people a year. */
export const DRAW_WILD = 0.01;
export const DRAW_MAX = 0.03;

/**
 * Pops over the year (REDESIGN.md, "Cultures as peoples", step 1): each settlement's classes move
 * toward what its life calls for; growing towns draw in families from the wild round them (any
 * race that can live beside theirs), who bring their culture; and each province's wild folk are
 * brought in line with the families living there.
 */
/** A village site grown into a market town on the same spot: its people out of the countryside (tiers.ts). */
function foundFromSite(sim: SimState, env: Env, lib: Library, info: Info, site: VillageSite, p: number): Settlement | null {
  const holder = sim.provOwner?.[p] ?? -1;
  const clan = sim.clans.find((q) => q.id === holder);
  if (!clan) return null;
  // Its race: the province's main rural people's, else its holder's.
  const P = env.prov;
  const byRace = new Map<string, number>();
  for (const [race, D] of Object.entries(sim.density ?? {})) for (let q = P.start[p]; q < P.start[p + 1]; q++) byRace.set(race, (byRace.get(race) ?? 0) + D[P.cells[q]]);
  const race = [...byRace].sort((a, b) => b[1] - a[1])[0]?.[0] ?? clan.race;
  const ri = info({ race, culture: site.culture || clan.culture });
  if (!ri) return null;
  const n = Math.round(site.pop);
  // Out of the countryside of the province.
  const D = sim.density?.[race];
  if (D) {
    let have = 0;
    for (let q = P.start[p]; q < P.start[p + 1]; q++) have += D[P.cells[q]];
    if (have > 0) for (let q = P.start[p]; q < P.start[p + 1]; q++) D[P.cells[q]] -= (D[P.cells[q]] * Math.min(n, have)) / have;
  }
  const folk = fromCountry(sim, env, p, race, n, null);
  const culture = site.culture || mainOf(folk.filter((q) => q.culture), 'culture') || clan.culture;
  const faith = mainOf(folk.filter((q) => q.faith), 'faith') || '';
  const st: Settlement = { id: sim.nextId++, name: site.name, kind: 'village', clan: clan.id, species: ri.species.id, race, culture, x: site.x, y: site.y, pop: n, fed: 1, warband: Math.round(n * ri.warShare * 0.6), holyTo: [], ruined: false, founded: sim.day, ruinedOn: -1, economy: newEconomy(n, ri.need, foundingMonths(env, site.x, site.y, sim.day)), techs: [...(clan.techs ?? [])], ...(faith ? { faith } : {}) };
  startPops(sim, st, folk);
  sim.settlements.push(st);
  return st;
}

/** A settlement dwindled back into a village site: its people to the countryside, its spot and name kept (tiers.ts). */
function backToSite(sim: SimState, env: Env, st: Settlement): void {
  const p = provAt(env, st.x, st.y);
  if (p < 0) return;
  const n = st.pop;
  const P = env.prov;
  toCountry(sim, env, p, takePops(sim, st, n));
  const near = [...P.cells.subarray(P.start[p], P.start[p + 1])].filter((k) => env.land[k]);
  seedDensity(sim, env, st.race, near.length ? near : cellsNear(env, st.x, st.y, env.step), n);
  const key = String(P.ids[p]);
  ((sim.sites ??= {})[key] ??= []).push({ id: sim.nextId++, name: st.name, x: st.x, y: st.y, pop: n, founded: st.villageSince ?? st.founded, culture: st.culture });
  sim.routes = sim.routes.filter((r) => r.a !== st.id && r.b !== st.id);
  sim.caravans = sim.caravans.filter((cv) => cv.from !== st.id && cv.to !== st.id);
  removeSettlement(sim, st.id, env);
}

/** Share of a fed farming settlement's people a year who go out to farm the land round it while its province has room. */
export const FARMERS_OUT = 0.015;
/** Settlements send farmers out only while their province's countryside is under this share full. */
export const PIONEER = 0.25;

/** What the rural step needs (rural.ts). */
function ruralContext(sim: SimState, env: Env, lib: Library, info: Info): RuralContext {
  return {
    sim, env, lib,
    knows: (clan, id) => clanKnows(lib, clan, id),
    eats: (st) => st.pop * (info(st)?.need ?? 1),
    provAt: (x, y) => provAt(env, x, y),
    name: (culture) => makeName(sim, lib, culture),
  };
}

function popsYear(sim: SimState, env: Env, lib: Library, info: Info): void {
  // Farmed provinces and their village sites (rural.ts).
  const rc = ruralContext(sim, env, lib, info);
  const farms = farmYear(rc);
  // Farming settlements send people out to farm the land round them while it has room (the rural fill).
  {
    const P = env.prov;
    const ruralNow = new Float32Array(P.count);
    for (const D of Object.values(sim.density ?? {})) for (let k = 0; k < D.length; k++) if (D[k] > 0 && P.of[k] >= 0) ruralNow[P.of[k]] += D[k];
    for (const st of sim.settlements) {
      if (st.ruined || st.layer || st.fed < 0.9 || st.pop < 60) continue;
      const p = provAt(env, st.x, st.y);
      if (p < 0 || farms.rural[p] <= 0) continue;
      const ri = info(st);
      const cap = farms.rural[p] / (ri?.need ?? 1);
      // Only while its countryside is still being settled (under a quarter full): then it grows by itself.
      if (ruralNow[p] >= cap * PIONEER) continue;
      const room = cap - ruralNow[p];
      if (room < 10) continue;
      const n = Math.min(st.pop * FARMERS_OUT, room * 0.2);
      if (n < 1) continue;
      const near = [...P.cells.subarray(P.start[p], P.start[p + 1])].filter((k) => env.land[k] && farms.farmed[k] && Math.hypot(env.x0 + (k % env.w) * env.step - st.x, env.y0 + Math.floor(k / env.w) * env.step - st.y) <= env.step * 3);
      if (!near.length) continue;
      toCountry(sim, env, p, takePops(sim, st, n));
      seedDensity(sim, env, st.race, near, n);
      ruralNow[p] += n;
    }
  }
  sitesYear(rc);
  // Tiers; village sites grown into market towns, small settlements back to village sites (tiers.ts).
  {
    const P = env.prov;
    const ruralNow = new Float32Array(P.count);
    for (const D of Object.values(sim.density ?? {})) for (let k = 0; k < D.length; k++) if (D[k] > 0 && P.of[k] >= 0) ruralNow[P.of[k]] += D[k];
    const cellNear = (x: number, y: number) => landCell(env, x, y);
    tiersYear({
      sim, env,
      provAt: (x, y) => provAt(env, x, y),
      waterFed: (st) => {
        const k = cellNear(st.x, st.y);
        return k >= 0 && (env.fresh[k] === 1 || env.coast[k] === 1);
      },
      dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by),
      farmed: (p) => farms.rural[p] > 0,
      surplus: (p) => farms.rural[p] - ruralNow[p],
      found: (site, p) => foundFromSite(sim, env, lib, info, site, p),
      unfound: (st) => backToSite(sim, env, st),
      pinned: (st) => !!st.besieged || (sim.armies ?? []).some((a) => a.target === st.id || a.siege?.town === st.id || (a.from[st.id] ?? 0) > 0),
      log: (text, x, y) => log(sim, text, x, y),
    });
    // Each town's catchment: the provinces' surplus split among the towns reaching them (catchment.ts).
    catchmentYear({
      sim, env, farms,
      provAt: (x, y) => provAt(env, x, y),
      cellOf: (x, y) => landCell(env, x, y),
      eats: (st) => st.pop * (info(st)?.need ?? 1),
      knows: (st, id) => knows(lib, st, id),
      dist: (ax, ay, bx, by) => dist(env, ax, ay, bx, by),
    });
    // The country people the land can't employ move to the town that draws most on their province.
    const P2 = env.prov;
    for (let p = 0; p < P2.count; p++) {
      const over = ruralNow[p] - farms.labour[p];
      if (farms.labour[p] <= 0 || over < 5) continue;
      const pid = P2.ids[p];
      const town = sim.settlements.filter((q) => !q.ruined && q.imports?.from.some((f) => f[0] === pid)).sort((a, b) => (b.imports!.from.find((f) => f[0] === pid)![1]) - (a.imports!.from.find((f) => f[0] === pid)![1]))[0];
      if (!town || town.fed < 0.9) continue;
      const n = over * TO_TOWN;
      const race = town.race;
      const D = sim.density?.[race];
      if (!D) continue;
      let have = 0;
      for (let q = P2.start[p]; q < P2.start[p + 1]; q++) have += D[P2.cells[q]];
      const take = Math.min(n, have);
      if (take < 1) continue;
      for (let q = P2.start[p]; q < P2.start[p + 1]; q++) D[P2.cells[q]] -= (D[P2.cells[q]] * take) / have;
      joinPops(sim, town, fromCountry(sim, env, p, race, take, town));
    }
  }
  for (const st of sim.settlements) {
    if (st.ruined) continue;
    const tier = settlementTier(st);
    popsOf(sim, st, classShares(st, tier));
    classYear(sim, st, tier);
  }
  for (const t of sim.tribes) popsOf(sim, t);
  // Drawn to the towns: the fed, growing ones that are more than villages.
  const races = Object.keys(sim.density ?? {});
  for (const st of sim.settlements) {
    if (st.ruined || st.layer || st.partOf !== undefined || st.fed < 0.9 || settlementTier(st) === 'Village') continue;
    const home = densityRace(sim, env, lib, info, st.race);
    if (!home) continue;
    const cells = cellsNear(env, st.x, st.y, DAY_WALK * 2).filter((k) => env.land[k]);
    const p = provAt(env, st.x, st.y);
    let room = st.pop * DRAW_MAX;
    for (const race of races) {
      if (room <= 1) break;
      const other = race === st.race ? home : densityRace(sim, env, lib, info, race);
      if (!other || (race !== st.race && !canLiveTogether(home, st.race, other, race))) continue;
      const D = sim.density![race];
      const wild = cells.reduce((n, k) => n + D[k], 0);
      const n = Math.min(room, wild * DRAW_WILD);
      if (n < 1) continue;
      for (const k of cells) D[k] -= (D[k] * n) / wild;
      joinPops(sim, st, fromCountry(sim, env, p, race, n, st.race === race ? st : null).map((q) => (q.culture ? q : { ...q, culture: st.culture, language: tongueOf(sim, st.culture) })));
      room -= n;
    }
  }
  countryYear(sim, env, (race, x, y) => {
    let kin: Settlement | null = null;
    for (const s of sim.settlements) if (!s.ruined && s.race === race && !s.layer && (!kin || dist(env, s.x, s.y, x, y) < dist(env, kin.x, kin.y, x, y))) kin = s;
    return kin;
  });
}

/**
 * A tribe settling down (Phase 7; technology adds its own needs in Phase 8): settled peoples soon,
 * on good ground; semi-nomadic ones where their land is crowded or rich; nomads rarely, and only
 * at the richest places. It settles at its winter grounds, keeping its name and clan.
 */
function trySettle(sim: SimState, env: Env, lib: Library, t: Tribe, ri: RaceInfo): boolean {
  if (t.pop < 60 || t.fed < 0.9 || t.away > 0) return false;
  // A village needs a way to feed itself: farming, herding, or fishing by water.
  const clan = sim.clans.find((c) => c.id === t.clan);
  const wk = cellOf(env, t.winter.x, t.winter.y);
  const spring = riftSpringNear(sim, (ax, ay, bx, by) => dist(env, ax, ay, bx, by), t.winter.x, t.winter.y);
  if (!canSettle((id) => clanKnows(lib, clan, id), wk >= 0 && (env.coast[wk] === 1 || env.fresh[wk] === 1 || spring))) return false;
  const k = cellOf(env, t.winter.x, t.winter.y);
  if (k < 0 || !env.land[k] || !passable(env, ri, k)) return false;
  if (sim.settlements.some((s) => !s.ruined && !s.layer && dist(env, s.x, s.y, t.winter.x, t.winter.y) < ri.range * 3)) return false;
  const score = liveScore(env, ri, k);
  // (The attraction: water and climate times the pulls, so lower than food alone.)
  const rich = score >= 1.1 ? 1 : score >= 0.8 ? 0.5 : 0;
  let crowd = 0;
  for (const o of sim.tribes) if (o !== t && dist(env, o.x, o.y, t.x, t.y) < ri.range * 3) crowd += o.pop / 300;
  const p = ri.lifestyle === 'Settled' ? (score >= 0.6 ? 0.3 : 0.05) : ri.lifestyle === 'Nomadic' ? (rich === 1 ? 0.01 : 0) : 0.02 + 0.08 * rich + 0.06 * Math.min(1, crowd);
  if (rand(sim) >= p) return false;
  const at = landPoint(env, t.winter.x, t.winter.y);
  const v: Settlement = { id: sim.nextId++, name: t.name, kind: 'village', clan: t.clan, species: t.species, race: t.race, culture: t.culture, x: at.x, y: at.y, pop: t.pop, fed: t.fed, warband: Math.round(t.pop * ri.warShare * 0.6), holyTo: [], ruined: false, founded: sim.day, ruinedOn: -1, economy: newEconomy(t.pop, ri.need, foundingMonths(env, t.winter.x, t.winter.y, sim.day)), techs: [...(clan?.techs ?? [])] };
  startPops(sim, v, popsOf(sim, t));
  sim.settlements.push(v);
  sim.tribes = sim.tribes.filter((q) => q !== t);
  sim.sorties = sim.sorties.filter((s) => s.tribe !== t.id);
  // Some of its families stay out on the land round the new village: the wilderness starts here.
  const families = Math.round(t.pop * 0.15);
  toCountry(sim, env, provAt(env, v.x, v.y), takePops(sim, v, families));
  seedDensity(sim, env, t.race, cellsNear(env, v.x, v.y, ri.range * 2.5), families);
  log(sim, `${t.name} settled down at its winter grounds (clan ${sim.clans.find((c) => c.id === t.clan)?.name ?? '?'}).`, v.x, v.y);
  return true;
}

/**
 * Settlements over the year: a growing one keeps its people (some may settle another layer); a
 * hungry or crowded one loses families to the wild round it; ruins are rebuilt by those who come to them, the race they are holy to most of all.
 */
function settlementsYearly(sim: SimState, env: Env, lib: Library, info: Info): void {
  // Every settlement on the painted land (older ones set down between the grid's points moved onto it).
  // (Sky towns float with their islands, over land or sea.)
  for (const st of sim.settlements) if (!st.layer?.startsWith('sky')) Object.assign(st, landPoint(env, st.x, st.y));
  const seatOf = chooseSeats(sim, env);
  const lc = layerContext(sim, env, lib);
  for (const st of [...sim.settlements]) {
    if (st.ruined) continue;
    const ri = info(st);
    if (!ri) continue;
    // (A village no longer stays one beside its province's seat: tiers and room decide, tiers.ts.)
    // A town on another layer is full sooner where there is little room (layers.ts).
    const room = layerRoom(lc, st);
    // Towns grow while their land feeds them (villages come from the wild now, REDESIGN.md 8.0);
    const cap = st.kind === 'dawn' ? 900 : st.seat ? 450 : 300;
    const nomads = ri.lifestyle === 'Nomadic';
    const full = st.pop > Math.min(cap, room) && st.fed >= 0.9;
    const pressed = (st.pop > 300 && st.fed < 0.85) || st.pop > room * 1.3;
    if (!full && !pressed) continue;
    // A growing town keeps its people (they don't go off as bands: a band is a warband, which
    // comes home). Now and then (about one year in four) some of them settle another layer where
    // the way is open; the hungry and the crowded lose people, more and more often.
    const settledGrowth = full && !pressed && !nomads && st.pop <= room;
    if (settledGrowth && rand(sim) >= 0.25) continue;
    const n = Math.round(settledGrowth ? Math.max(30, Math.min(200, st.pop * (0.04 + 0.04 * rand(sim)))) : Math.max(80, Math.min(250, st.pop * (0.15 + 0.1 * rand(sim)))));
    const village = rand(sim) < (ri.lifestyle === 'Settled' ? 0.7 : ri.lifestyle === 'Nomadic' ? 0.2 : 0.5);
    const R = settleRange(ri, st);
    const a0 = rand(sim) * Math.PI * 2;
    let spot: { x: number; y: number; s: number } | null = null;
    for (let i = 0; i < 24; i++) {
      const a = a0 + (i / 24) * Math.PI * 2;
      const d = R * (1.6 + rand(sim) * 1.6);
      const x = st.x + Math.cos(a) * d;
      const y = st.y + Math.sin(a) * d;
      const k = cellOf(env, x, y);
      if (k < 0 || !env.land[k] || !passable(env, ri, k)) continue;
      if (sim.settlements.some((o) => !o.layer && dist(env, o.x, o.y, x, y) < R * 1.3)) continue;
      // Better in a province of its own (a new town needs a province without one); others' land worse.
      const pk = provAt(env, x, y);
      // Rifts draw settlers: their wealth, and their springs.
      const pull = riftPull(sim, (ax, ay, bx, by) => dist(env, ax, ay, bx, by), x, y);
      if (pull < 0) continue;
      const s = liveScore(env, ri, k) - (sim.owner[k] >= 0 && sim.owner[k] !== st.clan ? 0.5 : 0) + (seatOf.has(pk) ? -0.3 : 0.3) + pull;
      if (!spot || s > spot.s) spot = { x, y, s };
    }
    const clan = sim.clans.find((c) => c.id === st.clan);
    if (!clan) continue;
    // A village on another layer, where the way is open: likelier for peoples at home there, and
    // for a town already up or down there (layers.ts).
    const otherLayers = lc.layers.under.length || lc.layers.trees.length || lc.layers.islands.length;
    if (village && otherLayers) {
      const lw = ri.lw;
      const p = st.layer ? 0.8 : lw.under || lw.trees || lw.sky ? 0.8 : 0.15;
      const alt = rand(sim) < p ? layerSpot(lc, st, ri, lw, R * 1.3) : null;
      const home = alt && ((alt.layer === 'underdark' && lw.under) || (alt.layer === 'canopy' && lw.trees) || (alt.layer.startsWith('sky') && lw.sky));
      // Others go where it suits them about as well as the land at hand (the layers score lower than the open land).
      if (alt && alt.s > 0 && (home || st.layer || !spot || alt.s >= spot.s * 0.5)) {
        const going = takePops(sim, st, n);
        const v: Settlement = { id: sim.nextId++, name: makeName(sim, lib, st.culture), kind: 'village', clan: st.clan, species: st.species, race: st.race, culture: st.culture, x: alt.x, y: alt.y, pop: n, fed: 1, warband: Math.round(n * ri.warShare * 0.6), holyTo: [], ruined: false, founded: sim.day, ruinedOn: -1, economy: newEconomy(n, ri.need, foundingMonths(env, alt.x, alt.y, sim.day)), techs: [...(st.techs ?? [])], layer: alt.layer, ...(alt.island ? { island: alt.island } : {}) };
        startPops(sim, v, going);
        sim.settlements.push(v);
        if (alt.dug) (sim.dug ??= []).push({ x: st.x, y: st.y, clan: st.clan, day: sim.day });
        if (lw.digs && alt.layer === 'underdark') (sim.tunnels ??= []).push({ a: st.id, b: v.id, ax: st.x, ay: st.y, bx: v.x, by: v.y, clan: st.clan, day: sim.day });
        const how = alt.layer === 'underdark' ? (alt.dug ? 'dug down and founded' : 'went down into the Underdark and founded') : alt.layer === 'canopy' ? 'climbed a giant tree and founded' : ri.flies ? 'flew up and founded' : knows(lib, st, 'airships') || knows(lib, st, 'mana-airships') ? 'sailed up by airship and founded' : 'climbed a giant vine and founded';
        log(sim, `People of ${st.name} ${how} ${v.name} in ${LAYER_NAMES[alt.layer]}.`, v.x, v.y);
        continue;
      }
    }
    // A growing town keeps the rest of its growth.
    if (settledGrowth) continue;
    // Hungry or crowded: families leave for the land round it, to live in the wild (density.ts);
    // where they gather thick enough, villages form of themselves (villagesFromWild).
    toCountry(sim, env, provAt(env, st.x, st.y), takePops(sim, st, n));
    seedDensity(sim, env, st.race, cellsNear(env, st.x, st.y, R * 3), n);
  }
  // Ruins rebuilt.
  for (const st of sim.settlements) {
    if (!st.ruined || sim.day - st.ruinedOn < DAYS_PER_YEAR) continue;
    for (const t of sim.tribes) {
      const ri = info(t);
      if (!ri || t.fed < 0.9 || t.pop < 60 || dist(env, t.x, t.y, st.x, st.y) > ri.range * 2.5) continue;
      const p = st.holyTo.includes(t.race) ? 0.35 : ri.lifestyle === 'Settled' ? 0.12 : 0.04;
      if (rand(sim) >= p) continue;
      Object.assign(st, { ruined: false, pop: t.pop, clan: t.clan, species: t.species, race: t.race, culture: t.culture, fed: t.fed, warband: Math.round(t.pop * ri.warShare * 0.6), economy: newEconomy(t.pop, ri.need, foundingMonths(env, st.x, st.y, sim.day)), techs: [...(sim.clans.find((q) => q.id === t.clan)?.techs ?? [])] });
      startPops(sim, st, popsOf(sim, t));
      sim.tribes = sim.tribes.filter((q) => q !== t);
      sim.sorties = sim.sorties.filter((s) => s.tribe !== t.id);
      log(sim, `${t.name} settled in the ruins of ${st.name} and built it again.`, st.x, st.y);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Villages from the wild, and villages joining towns (REDESIGN.md 8.0, step 2)

/** Families in the wild gather into a village where at least this many live close together… */
const FOUND_PEOPLE = 40;
/** …and at least this thick (people per km² over the points round the spot). */
const FOUND_DENSITY = 0.04;
/** At most this many villages of a race a year (so a crowded wild settles over some years). */
const FOUND_PER_YEAR = 4;
/** The share of the families round the spot that settle in the new village. */
const FOUND_TAKE = 0.7;
/** A day's walk and a day's ride (km): how far a town's joined villages may be. */
/** Traffic a village path keeps up each year (a trail, see ways.ts). */
const VILLAGE_PATH = 25;
export const DAY_WALK = 30;
export const DAY_RIDE = 65;
const xOfCell = (env: Env, k: number) => env.x0 + (k % env.w) * env.step;

/**
 * Where families in the wild live thick enough, they settle together: a village at the best spot
 * round them (water, coast, the land's food, their liking for it), if they know how to live
 * settled (farming, herding, or fishing by water), as the settlement they came from does. It
 * belongs to whoever holds the land; in land nobody holds it stands on its own.
 */
function villagesFromWild(sim: SimState, env: Env, lib: Library, info: Info): void {
  for (const [race, D] of Object.entries(sim.density ?? {})) {
    const ri = info({ race, culture: '' });
    if (!ri) continue;
    const cand: number[] = [];
    // (Not on farmed land: its people live in village sites there, rural.ts.)
    for (let k = 0; k < env.n; k++) if (D[k] >= 4 && !isFarmed(sim, k)) cand.push(k);
    cand.sort((a, b) => D[b] - D[a]);
    let made = 0;
    for (const k of cand) {
      if (made >= FOUND_PER_YEAR) break;
      if (D[k] < 4) continue;
      const x = xOfCell(env, k);
      const y = yOf(env, k);
      // The families within about 20 km (the same on any grid; at least the point itself).
      const hood = cellsNear(env, x, y, Math.max(0, 20 - env.step * 0.5)).filter((c) => env.land[c]);
      const sum = hood.reduce((n, c) => n + D[c], 0);
      if (sum < Math.max(FOUND_PEOPLE, FOUND_DENSITY * hood.length * env.cellArea)) continue;
      // Where they came from: the nearest settlement of their race (its ways, knowledge and faith).
      let kin: Settlement | null = null;
      for (const s of sim.settlements) if (!s.ruined && s.race === race && !s.layer && (!kin || dist(env, s.x, s.y, x, y) < dist(env, kin.x, kin.y, x, y))) kin = s;
      const knowsIt = (id: string) => (kin ? knows(lib, kin, id) : false);
      const kinLeans = kin ? leansOf(traditionsHere(sim, kin)) : null;
      // The best spot round them, not on top of another settlement.
      const spacing = ri.range * 1.6;
      let spot = -1;
      let best = -Infinity;
      for (const c of cellsNear(env, x, y, env.step * 2.5)) {
        if (!env.land[c] || !passable(env, ri, c) || liveScore(env, ri, c) < 0) continue;
        const water = env.fresh[c] === 1 || env.coast[c] === 1;
        if (!canSettle(knowsIt, water)) continue;
        const cx = xOfCell(env, c);
        const cy = yOf(env, c);
        if (sim.settlements.some((o) => !o.ruined && !o.layer && dist(env, o.x, o.y, cx, cy) < spacing)) continue;
        // Its kin town's own ways draw it too (a seafaring town's families to the coast).
        const s = liveScore(env, ri, c) + (env.fresh[c] ? 0.4 : env.coast[c] ? 0.3 : 0) + Math.min(1, D[c] / 20) * 0.3 + (kinLeans ? leanAt(env, kinLeans, c) : 0);
        if (s > best) [best, spot] = [s, c];
      }
      if (spot < 0) continue;
      let pop = 0;
      for (const c of hood) {
        const t = D[c] * FOUND_TAKE;
        D[c] -= t;
        pop += t;
      }
      pop = Math.round(pop);
      const at = landPoint(env, xOfCell(env, spot), yOf(env, spot));
      // Who they are: the wild folk of the province (their cultures and faiths), else their kin town's.
      const folk = fromCountry(sim, env, provAt(env, at.x, at.y), race, pop, kin);
      const culture = mainOf(folk.filter((q) => q.culture), 'culture') || kin?.culture || startCulture(lib, ri.species, ri.race);
      const faith = mainOf(folk.filter((q) => q.faith), 'faith') || kin?.faith || '';
      for (const q of folk) if (!q.culture) Object.assign(q, { culture, language: tongueOf(sim, culture) });
      // Whose land it is: theirs. Nobody's: on its own.
      const owner = sim.owner[spot];
      const clanId = owner >= 0 && sim.clans.some((q) => q.id === owner) ? owner : newClan(sim, lib, ri.species.id, race, culture).id;
      const v: Settlement = { id: sim.nextId++, name: makeName(sim, lib, culture), kind: 'village', clan: clanId, species: ri.species.id, race, culture, x: at.x, y: at.y, pop, fed: 1, warband: Math.round(pop * ri.warShare * 0.6), holyTo: [], ruined: false, founded: sim.day, ruinedOn: -1, economy: newEconomy(pop, ri.need, foundingMonths(env, at.x, at.y, sim.day)), techs: [...(kin?.techs ?? [])], ...(faith ? { faith } : {}) };
      startPops(sim, v, folk);
      sim.settlements.push(v);
      claimAround(sim, env, v.x, v.y, ri.range, clanId);
      made++;
      log(sim, `Families living in the wild settled together: the village of ${v.name} was founded${owner >= 0 ? '' : ', on its own'}.`, v.x, v.y);
    }
  }
}

/**
 * Villages join the nearest town of their own realm within a day's walk (a day's ride if the town
 * keeps mounts), unless another town has them already: their people work and eat with the town's
 * and their goods go to its stores. A village that grows into a town, or whose town is lost or
 * changes hands, or that is taken by another realm, stands on its own again.
 */
function joinVillages(sim: SimState, env: Env, lib: Library): void {
  const byId = new Map(sim.settlements.map((s) => [s.id, s]));
  const isTown = (s: Settlement) => !s.ruined && !s.partOf && settlementTier(s) !== 'Village';
  const reach = (t: Settlement) => (knows(lib, t, 'riding') ? DAY_RIDE : DAY_WALK);
  for (const v of sim.settlements) {
    if (v.partOf === undefined) continue;
    const t = byId.get(v.partOf);
    if (v.ruined || settlementTier(v) !== 'Village' || !t || !isTown(t) || t.clan !== v.clan || (t.layer ?? '') !== (v.layer ?? '') || dist(env, t.x, t.y, v.x, v.y) > reach(t) * 1.2) delete v.partOf;
  }
  const towns = sim.settlements.filter(isTown);
  if (!towns.length) return;
  for (const v of sim.settlements) {
    if (v.ruined || v.partOf !== undefined || v.kind === 'dawn' || settlementTier(v) !== 'Village') continue;
    let best: Settlement | null = null;
    let bd = Infinity;
    for (const t of towns) {
      if (t === v || t.clan !== v.clan || (t.layer ?? '') !== (v.layer ?? '')) continue;
      const d = dist(env, t.x, t.y, v.x, v.y);
      if (d <= reach(t) && d < bd) [best, bd] = [t, d];
    }
    if (!best) continue;
    v.partOf = best.id;
    log(sim, `The village of ${v.name} became part of ${best.name}: its people work and eat with the town's.`, v.x, v.y);
  }
}

/**
 * Each province's seat: a dawn city, else the seat it had while it stands, unless another there has
 * grown half as big again; else the biggest. (Its seat for the realm's business and prestige; its
 * size and tier are its own now, tiers.ts.)
 */
function chooseSeats(sim: SimState, env: Env): Map<number, Settlement> {
  const by = new Map<number, Settlement[]>();
  for (const st of sim.settlements) {
    if (st.ruined) {
      st.seat = false;
      continue;
    }
    const p = provAt(env, st.x, st.y);
    by.set(p, [...(by.get(p) ?? []), st]);
  }
  const out = new Map<number, Settlement>();
  for (const [p, list] of by) {
    const biggest = list.reduce((a, b) => (b.pop > a.pop ? b : a));
    const old = list.find((q) => q.seat);
    const seat = list.find((q) => q.kind === 'dawn') ?? (old && biggest.pop <= old.pop * 1.5 ? old : biggest);
    for (const q of list) q.seat = q === seat;
    out.set(p, seat);
  }
  return out;
}

/** What a settlement is: a dawn city; a city or town (its province's seat, by size); or a village. */
export function settlementTier(st: Settlement): 'Dawn city' | 'City' | 'Town' | 'Village' {
  if (st.kind === 'dawn') return 'Dawn city';
  // By its tier (tiers.ts): hamlets and villages, market and large towns, cities and great cities.
  const t = tierOf(st);
  return t >= CITY ? 'City' : t >= MARKET ? 'Town' : 'Village';
}

/** Area (km²) each clan claims. */
export function clanLand(sim: SimState, env: Env): Map<number, number> {
  return heldArea(sim, env);
}

