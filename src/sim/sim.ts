import { raceMissing, type Library, type Race, type Species } from '../core/library';
import { PLANT_K, type Env } from './env';
import { DAYS_PER_MONTH, DAYS_PER_YEAR, northernSummer, type Clan, type Point, type SimEvent, type SimState, type Sortie, type Tribe } from './state';

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
  might: number;
  /** Where it can go: high mountains, over water. */
  mountains: boolean;
  flies: boolean;
  swims: boolean;
  lifestyle: string;
  attitude: string;
}

const SIZE_NEED: Record<string, number> = { Tiny: 0.3, Small: 0.6, Medium: 1, Large: 1.6, Giant: 3 };
const MARTIAL_SHARE: Record<string, number> = { 'Men fight': 0.5, 'Women fight': 0.5, 'Everyone fights': 1, 'A warrior caste': 0.25, 'None (others fight for them)': 0.05 };

/** The races that can take part: complete, and not set aside. */
export function eligibleRaces(lib: Library): { species: Species; race: Race }[] {
  return lib.species.filter((s) => !s.setAside).flatMap((s) => s.races.filter((r) => !raceMissing(r).length).map((race) => ({ species: s, race })));
}

export function raceInfo(lib: Library, raceId: string, cultureId = ''): RaceInfo | null {
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
    const culture = lib.cultures.find((c) => c.id === cultureId);
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
      might: fight * (0.8 + 0.2 * ((st.willpower ?? 6) / 6)),
      mountains: traits.has('mountain-born') || p.movement.includes('Mountain-adapted') || (st.climbing ?? 0) >= 20 || (st.flying ?? 0) > 0,
      flies: (st.flying ?? 0) > 0,
      swims: (st.swimming ?? 0) >= 40,
      lifestyle: race.lifestyle || species.lifestyle || 'Semi-nomadic',
      attitude: p.attitude || 'Wary',
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
  const sounds = lib.cultures.find((c) => c.id === cultureId)?.sounds ?? '';
  const parts = sounds.split(/[\s,;]+/).filter(Boolean);
  const pre = parts.filter((p) => p.endsWith('-')).map((p) => p.slice(0, -1));
  const suf = parts.filter((p) => p.startsWith('-')).map((p) => p.slice(1));
  const pick = <T>(a: T[]) => a[Math.floor(rand(sim) * a.length)];
  let name: string;
  if (pre.length && suf.length) name = pick(pre) + pick(suf);
  else {
    const n = 2 + (rand(sim) < 0.4 ? 1 : 0);
    name = Array.from({ length: n }, () => pick(SYLLABLES)).join('');
  }
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
  return { day: 0, seed: seed | 0 || 1, started: false, tribes: [], clans: [], sorties: [], nextId: 1, w: env.w, h: env.h, owner: new Int32Array(env.n).fill(-1), rival: new Int32Array(env.n).fill(-1), rivalUse: new Float32Array(env.n), beasts, events: [], setup: [] };
}

/** The culture a race's people start with: the first that names the race (or its species) as its heritage. */
export function startCulture(lib: Library, species: Species, race: Race): string {
  return lib.cultures.find((c) => c.races.includes(race.id))?.id ?? lib.cultures.find((c) => c.species.includes(species.id))?.id ?? '';
}

function newClan(sim: SimState, lib: Library, species: string, race: string, culture: string, parent = -1): Clan {
  const id = sim.nextId++;
  const clan: Clan = { id, name: makeName(sim, lib, culture), colour: PALETTE[sim.clans.length % PALETTE.length], species, race, culture, founded: sim.day, parent };
  sim.clans.push(clan);
  return clan;
}

export function addTribe(sim: SimState, env: Env, lib: Library, raceId: string, x: number, y: number, clanId = -1, pop = 150): Tribe | null {
  const ri = raceInfo(lib, raceId);
  if (!ri) return null;
  let clan = sim.clans.find((c) => c.id === clanId);
  if (!clan) clan = newClan(sim, lib, ri.species.id, raceId, startCulture(lib, ri.species, ri.race));
  const t: Tribe = { id: sim.nextId++, name: makeName(sim, lib, clan.culture), clan: clan.id, species: ri.species.id, race: raceId, culture: clan.culture, x, y, target: null, summer: { x, y }, winter: { x, y }, pop, fed: 1, warband: 0, away: 0, founded: sim.day };
  t.warband = Math.round(pop * raceInfo(lib, raceId, clan.culture)!.warShare);
  sim.tribes.push(t);
  chooseGrounds(sim, env, lib, t);
  return t;
}

/** How good a point is for a race to live: food over the year, water, and its preferred climates. */
function liveScore(env: Env, ri: RaceInfo, k: number, cl?: { zone: Int8Array }): number {
  if (!env.land[k] || !passable(env, ri, k)) return -1;
  const food = (env.plant[0][k] + env.plant[1][k]) / 2 / PLANT_K;
  let game = 0;
  for (const b of env.beastInfo) if (!b.water) game += env.beastK[b.id][k] * b.meat;
  const water = env.fresh[k] ? 0.4 : env.coast[k] ? 0.25 : 0;
  const prefs = ri.race.climates.length ? ri.race.climates : ri.species.profile.climates;
  const pref = prefs.length && cl ? (prefs.includes(cl.zone[k]) ? 1 : 0.3) : 1;
  return (food + Math.min(1, game / 8) * 0.6 + water) * pref;
}

/**
 * Starting tribes, placed where each race's environment suits it best: each race's tribes in
 * one or two homelands, a clan for every few tribes.
 */
export function placeStart(sim: SimState, env: Env, lib: Library, setup: { race: string; tribes: number }[], zone?: Int8Array): void {
  sim.tribes = [];
  sim.clans = [];
  sim.sorties = [];
  sim.owner.fill(-1);
  sim.rival.fill(-1);
  sim.rivalUse.fill(0);
  sim.setup = setup.map((s) => ({ ...s }));
  const taken: Point[] = [];
  for (const { race, tribes } of setup) {
    const ri = raceInfo(lib, race);
    if (!ri || tribes <= 0) continue;
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
    // Its tribes around it, a clan for every three or four.
    let clan = -1;
    for (let i = 0; i < tribes; i++) {
      if (i % 4 === 0) clan = -1;
      let best: { x: number; y: number; s: number } | null = null;
      for (let tries = 0; tries < 40; tries++) {
        const a = rand(sim) * Math.PI * 2;
        const d = (i === 0 ? 0 : 40) + rand(sim) * (60 + 25 * i);
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
  }
}

export function removeTribe(sim: SimState, id: number): void {
  sim.tribes = sim.tribes.filter((t) => t.id !== id);
  sim.sorties = sim.sorties.filter((s) => s.tribe !== id && s.target !== id);
  const used = new Set(sim.tribes.map((t) => t.clan));
  sim.clans = sim.clans.filter((c) => used.has(c.id) || sim.started);
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
  const k = cellOf(env, t.x, t.y);
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
  const owner = sim.owner[k];
  const land = owner === t.clan ? 0.15 : owner < 0 ? 0.08 : -0.3;
  const water = env.fresh[k] ? 0.3 : env.coast[k] ? 0.15 : 0;
  const warmth = summerLocal ? 0 : 0.4 * Math.max(0, Math.min(1, (env.temp[s][k] + 15) / 25));
  return food + water + warmth + land - crowd * 0.4;
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

const log = (sim: SimState, text: string, x?: number, y?: number) => {
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
    if (!infos.has(key)) infos.set(key, raceInfo(lib, t.race, t.culture));
    return infos.get(key)!;
  };
  for (let d = 0; d < days; d++) {
    sim.started = true;
    daily(sim, env, info);
    sim.day++;
    if (sim.day % DAYS_PER_MONTH === 0) monthly(sim, env, lib, info);
    if (sim.day % DAYS_PER_YEAR === 0) yearly(sim, env, lib, info);
  }
}

type Info = (t: { race: string; culture: string }) => RaceInfo | null;

function daily(sim: SimState, env: Env, info: Info): void {
  for (const t of sim.tribes) {
    const ri = info(t);
    if (!ri) continue;
    if (!t.target) continue;
    const d = dist(env, t.x, t.y, t.target.x, t.target.y);
    const k = cellOf(env, t.x, t.y);
    const slow = k >= 0 ? [1, 0.8, 0.6, 0.4, 0.3][env.mzone[k]] : 1;
    const stepKm = ri.speed * slow * (t.fed < 0.6 ? 0.7 : 1);
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
    // Land walked through is claimed if no one holds it.
    const c = cellOf(env, t.x, t.y);
    if (c >= 0 && env.land[c] && sim.owner[c] < 0) sim.owner[c] = t.clan;
  }
  // Warbands on the move.
  for (const s of [...sim.sorties]) {
    const home = sim.tribes.find((t) => t.id === s.tribe);
    const enemy = sim.tribes.find((t) => t.id === s.target);
    const goal = s.leg === 'out' ? enemy : home;
    if (!goal) {
      if (s.leg === 'out' && home) s.leg = 'home';
      else sim.sorties = sim.sorties.filter((q) => q !== s);
      continue;
    }
    const ri = info(home ?? goal);
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
    if (s.leg === 'out' && enemy) battle(sim, env, s, enemy, info);
    else if (home) {
      // Back with the tribe.
      home.away = Math.max(0, home.away - s.strength);
      home.warband = Math.min(home.warband, home.pop);
      sim.sorties = sim.sorties.filter((q) => q !== s);
    }
  }
}

function battle(sim: SimState, env: Env, s: Sortie, enemy: Tribe, info: Info): void {
  const home = sim.tribes.find((t) => t.id === s.tribe);
  const ra = home ? info(home) : null;
  const rd = info(enemy);
  const defenders = Math.max(0, enemy.warband - enemy.away);
  const attack = s.strength * (ra?.might ?? 1) * (0.6 + 0.8 * rand(sim));
  const defend = Math.max(1, defenders) * (rd?.might ?? 1) * 1.1 * (0.6 + 0.8 * rand(sim));
  const win = attack > defend;
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
    for (const c of cellsNear(env, enemy.x, enemy.y, (rd?.range ?? 20) * 1.2)) if (env.land[c] && sim.owner[c] === enemy.clan) {
      sim.owner[c] = s.clan;
      sim.rival[c] = -1;
      sim.rivalUse[c] = 0;
    }
    const a = Math.atan2(enemy.y - s.y, enemy.x - s.x);
    const flee = { x: enemy.x + Math.cos(a) * 120, y: enemy.y + Math.sin(a) * 120 };
    enemy.winter = flee;
    enemy.summer = flee;
    enemy.target = flee;
    log(sim, `The warband of ${home?.name ?? 'a tribe'} (clan ${ac?.name ?? '?'}) drove off ${enemy.name} (clan ${dc?.name ?? '?'}): ${loseA} and ${loseD} fell.`, enemy.x, enemy.y);
  } else log(sim, `${enemy.name} (clan ${dc?.name ?? '?'}) beat off the warband of ${home?.name ?? 'a tribe'} (clan ${ac?.name ?? '?'}): ${loseA} and ${loseD} fell.`, enemy.x, enemy.y);
  s.leg = 'home';
}

function monthly(sim: SimState, env: Env, lib: Library, info: Info): void {
  // Plant food this month, shared by everyone foraging there.
  const left = new Float32Array(env.n);
  const sIdx = northernSummer(sim.day) ? 0 : 1;
  for (let k = 0; k < env.n; k++) if (env.land[k]) left[k] = env.plant[sIdx][k] * env.cellArea;
  // Beasts grow back toward what the land carries.
  for (const b of env.beastInfo) {
    const D = sim.beasts[b.id];
    const K = env.beastK[b.id];
    for (let k = 0; k < env.n; k++) {
      const cap = K[k] * 0.95;
      if (cap <= 0) continue;
      D[k] = Math.min(cap, D[k] + b.regrow * D[k] * (1 - D[k] / cap) + 0.002 * cap);
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
    const area = Math.PI * ri.range * ri.range;
    const share = cells.length ? Math.min(1, area / (cells.length * env.cellArea)) : 0;
    let got = 0;
    for (const c of cells) {
      if (got >= need * 0.65) break;
      const take = Math.min(left[c] * share, need * 0.65 - got);
      left[c] -= take;
      got += take;
    }
    for (const b of env.beastInfo) {
      if (b.water || got >= need * 1.05) continue;
      const D = sim.beasts[b.id];
      for (const c of cells) {
        if (got >= need * 1.05) break;
        const stock = D[c] * b.meat * env.cellArea * share;
        if (stock <= 0) continue;
        const take = Math.min(stock * 0.06 * b.catchRate, need * 1.05 - got);
        got += take;
        D[c] = Math.max(0, D[c] - take / (b.meat * env.cellArea * Math.max(share, 1e-6)));
      }
    }
    t.fed = need > 0 ? got / need : 1;
    // People: births and deaths, with hunger.
    const f = Math.min(1.2, t.fed);
    const births = (ri.births / 12) * Math.min(1, f) * (f >= 1 ? 1.3 : 1);
    const deaths = ri.deaths / 12 + (f < 1 ? ((1 - f) * 0.5) / 12 : 0);
    const change = t.pop * (births - deaths);
    t.pop = Math.max(0, t.pop + change + (rand(sim) - 0.5) * 0.5);
    t.warband = Math.max(t.away, Math.round(t.pop * ri.warShare));
    // Claims: the land it uses (forages, hunts, ranges over) is its clan's; another clan's land is
    // taken by using it long enough.
    for (const c of cellsNear(env, t.x, t.y, ri.range * 1.6)) {
      if (!env.land[c]) continue;
      const o = sim.owner[c];
      if (o < 0) sim.owner[c] = t.clan;
      else if (o === t.clan) sim.rivalUse[c] = Math.max(0, sim.rivalUse[c] - 1);
      else {
        if (sim.rival[c] === t.clan) sim.rivalUse[c] += 1;
        else {
          sim.rival[c] = t.clan;
          sim.rivalUse[c] = 1;
        }
        const ownerHere = sim.tribes.some((q) => q.clan === o && dist(env, q.x, q.y, xOf(env, c), yOf(env, c)) < ri.range * 2.5);
        if (sim.rivalUse[c] >= 12 && !ownerHere) {
          sim.owner[c] = t.clan;
          sim.rival[c] = -1;
          sim.rivalUse[c] = 0;
        }
      }
    }
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
        const p = 0.035 * hostility(sim, lib, t, e, ri) * stress * Math.min(2, odds);
        if (!best || p > best.p) best = { e, p };
      }
      if (best && rand(sim) < best.p) {
        const strength = Math.round(home * 0.8);
        t.away += strength;
        sim.sorties.push({ id: sim.nextId++, tribe: t.id, clan: t.clan, target: best.e.id, strength, x: t.x, y: t.y, leg: 'out' });
      }
    }
  }
  // The starved and the slain: tiny remnants join kin nearby, or are lost.
  for (const t of [...sim.tribes]) {
    if (t.pop >= 15) continue;
    const kin = sim.tribes.filter((q) => q !== t && q.clan === t.clan).sort((a, b) => dist(env, a.x, a.y, t.x, t.y) - dist(env, b.x, b.y, t.x, t.y))[0];
    if (kin && dist(env, kin.x, kin.y, t.x, t.y) < 400) {
      kin.pop += t.pop;
      log(sim, `${t.name} was too few to go on and joined ${kin.name}.`, t.x, t.y);
    } else log(sim, `${t.name} died out.`, t.x, t.y);
    sim.tribes = sim.tribes.filter((q) => q !== t);
    sim.sorties = sim.sorties.filter((s) => s.tribe !== t.id);
  }
}

/** How readily one tribe fights another: its race's attitude, kinship and shared culture. */
function hostility(sim: SimState, lib: Library, t: Tribe, e: Tribe, ri: RaceInfo): number {
  const other = lib.species.find((s) => s.id === e.species);
  const over = ri.species.profile.attitudes.find((a) => a.species === other?.name)?.attitude;
  const att = over || ri.attitude;
  let h = att === 'Welcoming' ? 0.25 : att === 'Indifferent' ? 0.6 : 1;
  if (t.species === e.species) h *= 0.7;
  if (t.culture && t.culture === e.culture) h *= 0.6;
  const tc = sim.clans.find((c) => c.id === t.clan);
  const ec = sim.clans.find((c) => c.id === e.clan);
  if (tc && ec && (tc.parent === ec.id || ec.parent === tc.id)) h *= 0.3;
  return h;
}

function yearly(sim: SimState, env: Env, lib: Library, info: Info): void {
  for (const t of [...sim.tribes]) {
    const ri = info(t);
    if (!ri) continue;
    // Grounds looked at again each year.
    chooseGrounds(sim, env, lib, t);
    // Too many for one tribe: a part breaks away to find land of its own.
    if (t.pop > 400 && t.fed >= 0.85) {
      const share = 0.35 + 0.1 * rand(sim);
      const n = Math.round(t.pop * share);
      t.pop -= n;
      const clan = sim.clans.find((c) => c.id === t.clan)!;
      const kinTribes = sim.tribes.filter((q) => q.clan === clan.id);
      // Far from kin, or a big clan: the new tribe may start a clan of its own.
      const first = kinTribes[0];
      const far = first ? dist(env, first.x, first.y, t.x, t.y) > 700 : false;
      let clanId = clan.id;
      if ((kinTribes.length >= 6 || far) && rand(sim) < 0.5) {
        const nc = newClan(sim, lib, clan.species, clan.race, clan.culture, clan.id);
        clanId = nc.id;
        log(sim, `A new clan, ${nc.name}, broke away from clan ${clan.name}.`, t.x, t.y);
      }
      const nt: Tribe = { ...t, id: sim.nextId++, name: makeName(sim, lib, t.culture), clan: clanId, pop: n, warband: 0, away: 0, founded: sim.day, target: null, summer: { ...t.summer }, winter: { ...t.winter } };
      nt.warband = Math.round(n * ri.warShare);
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
  // Clans with no tribes are gone (their land stays claimed until others use it).
  const live = new Set(sim.tribes.map((t) => t.clan));
  for (const c of sim.clans.filter((q) => !live.has(q.id))) log(sim, `Clan ${c.name} is no more.`);
  sim.clans = sim.clans.filter((c) => live.has(c.id));
  // A last small tribe of a clan may join a friendly clan of its people nearby.
  for (const c of [...sim.clans]) {
    const mine = sim.tribes.filter((t) => t.clan === c.id);
    if (mine.length !== 1 || mine[0].pop > 80) continue;
    const t = mine[0];
    const other = sim.tribes.find((q) => q.clan !== c.id && q.race === t.race && q.culture === t.culture && dist(env, q.x, q.y, t.x, t.y) < 250);
    if (other && rand(sim) < 0.3) {
      t.clan = other.clan;
      for (let k = 0; k < env.n; k++) if (sim.owner[k] === c.id) sim.owner[k] = other.clan;
      sim.clans = sim.clans.filter((q) => q.id !== c.id);
      log(sim, `Clan ${c.name} joined clan ${sim.clans.find((q) => q.id === other.clan)?.name ?? '?'}.`, t.x, t.y);
    }
  }
}

/** Area (km²) each clan claims. */
export function clanLand(sim: SimState, env: Env): Map<number, number> {
  const out = new Map<number, number>();
  for (let k = 0; k < env.n; k++) if (sim.owner[k] >= 0) out.set(sim.owner[k], (out.get(sim.owner[k]) ?? 0) + env.cellArea);
  return out;
}

