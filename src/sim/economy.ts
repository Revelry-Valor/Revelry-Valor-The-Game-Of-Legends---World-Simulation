import { PLANT_K, type Env, type ResInfo } from './env';
import type { Economy, Settlement, SimState } from './state';
import { canWork, techEffects } from './tech';
import { markThinned } from './thinned';
import type { CultureFx } from './culture';

/**
 * A settlement's economy (REDESIGN.md 8.4h, Phase 7 step 1), counted in units: one unit of a food
 * feeds one (Medium) person for a month; one unit of anything else meets one person's need of it
 * for a month.
 *
 * Each month its workers are split between jobs: enough on food first (farming, fishing, herding,
 * gathering, hunting, whichever pays best here), then on what people need (fuel and shelter,
 * clothing, building stone, salt), then on whatever else the land round it offers. Crops grow
 * through the local summer and are brought in at its end, in good years and bad; stores spoil
 * (fresh fish fast, grain slowly; salt helps); famine comes when the stores run out.
 */

/** Stored food that isn't one crop: wild plants gathered, and what a new settlement brings. */
export const WILD = 'wild-food';
export const PROVISIONS = 'provisions';
const EXTRA_FOODS: ResInfo[] = [
  { id: WILD, name: 'Wild plants', category: 'Food', source: 'Gathered', rarity: 'Common', food: true, spoil: 0.12, deposit: false },
  { id: PROVISIONS, name: 'Provisions', category: 'Food', source: 'Crafted', rarity: 'Common', food: true, spoil: 0.02, deposit: false },
];

/** What every person needs beyond food, in units per person per month. */
export const NEEDS: { name: string; per: number; match: (r: ResInfo) => boolean }[] = [
  { name: 'Fuel and shelter', per: 0.05, match: (r) => r.category === 'Wood' },
  { name: 'Clothing', per: 0.02, match: (r) => ['leather', 'wool', 'furs', 'cotton', 'flax', 'silk'].includes(r.id) },
  { name: 'Building', per: 0.01, match: (r) => r.category === 'Stone' },
  { name: 'Salt', per: 0.005, match: (r) => r.id === 'salt' },
];

/**
 * What one worker makes in a month where the land is as good as it gets (1), by how it is got. A
 * farmer's 6 growing months bring in about 48 units: food for four people for a year.
 */
const RATE: Record<string, number> = { Farmed: 8, Fished: 2.2, Herded: 3, Logged: 1.2, Quarried: 0.8, Mined: 0.35, Gathered: 0.6, Hunted: 0.3, Crafted: 0, Rift: 0 };
/** How well crops grow in a half-year with this wild plant growth (1 = as good as it gets): dry steppe still grows grain, poorly; frozen or bare desert, nothing. */
const halfGrowth = (g: number) => (g < 0.06 ? 0 : Math.min(1.3, 0.35 + 0.65 * g));

const infoMaps = new WeakMap<Env, Map<string, ResInfo>>();
export function resInfoOf(env: Env, id: string): ResInfo | undefined {
  let m = infoMaps.get(env);
  if (!m) infoMaps.set(env, (m = new Map([...EXTRA_FOODS, ...env.resInfo].map((r) => [r.id, r]))));
  return m.get(id);
}
/** Most of one good (not food) a settlement keeps: enough to stockpile for building. */
export const storeCap = (pop: number) => Math.max(50, pop * 2);
export const isFood = (env: Env, id: string) => resInfoOf(env, id)?.food ?? false;

/** A new settlement's economy, with food enough for some months. */
export function newEconomy(pop: number, need: number, months: number): Economy {
  return { stores: { [PROVISIONS]: Math.round(pop * need * months) }, jobs: {}, made: {}, crop: 0, cropId: '', harvest: null, comfort: 1 };
}

/** What the land within a settlement's reach offers (worked out once; settlements don't move). */
interface Reach {
  env: Env;
  r: number;
  cells: number[];
  share: number;
  /** How good the land in reach is for each resource (0–1.5): the average, or for deposits the best one in reach. */
  avail: Record<string, number>;
  /** Plant growth in reach, by season (1 = as good as it gets). */
  growth: [number, number];
  /** Warm enough to grow crops, by season (for irrigation), and water by rivers or lakes in reach. */
  warm: [boolean, boolean];
  river: boolean;
}
const reaches = new WeakMap<Settlement, Reach>();
export function reachOf(env: Env, st: Settlement, r: number, cellsNear: (x: number, y: number, r: number) => number[]): Reach {
  const old = reaches.get(st);
  if (old && old.env === env && old.r === r) return old;
  const cells = cellsNear(st.x, st.y, r).filter((c) => env.land[c]);
  const area = Math.PI * r * r;
  const share = cells.length ? Math.min(1, area / (cells.length * env.cellArea)) : 0;
  const avail: Record<string, number> = {};
  for (const ri of env.resInfo) {
    const A = env.res[ri.id];
    let sum = 0;
    let max = 0;
    for (const c of cells) {
      sum += A[c];
      if (A[c] > max) max = A[c];
    }
    const v = ri.deposit ? max : cells.length ? sum / cells.length : 0;
    if (v > 0.01) avail[ri.id] = v;
  }
  const growth: [number, number] = [0, 0];
  for (const s of [0, 1] as const) {
    let g = 0;
    for (const c of cells) g += env.plant[s][c] / PLANT_K;
    growth[s] = cells.length ? g / cells.length : 0;
  }
  const warm: [boolean, boolean] = [0, 1].map((s) => cells.length > 0 && cells.reduce((n, c) => n + env.temp[s][c], 0) / cells.length > 8) as [boolean, boolean];
  const river = cells.some((c) => env.fresh[c]);
  const out = { env, r, cells, share, avail, growth, warm, river };
  reaches.set(st, out);
  return out;
}

/** How good a year it is for crops in a region (shared by neighbours): 0.55 (a failed harvest, 1 year in 25), 0.8 (a poor one, 1 in 10), mostly 0.95–1.1, sometimes up to 1.3. */
export function cropYear(env: Env, x: number, y: number, year: number): number {
  const pi = Math.floor((x - env.x0) / (env.step * 10));
  const pj = Math.floor((y - env.y0) / (env.step * 10));
  let h = Math.imul(pi | 0, 374761393) ^ Math.imul(pj | 0, 668265263) ^ Math.imul(year | 0, 1274126177);
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
  }
  const u = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  // Mostly ordinary years; now and then a bad one, rarely a failure.
  return u < 0.04 ? 0.55 : u < 0.14 ? 0.8 : u < 0.85 ? 0.95 + 0.15 * (u - 0.14) / 0.71 : 1.15 + 0.15 * (u - 0.85) / 0.15;
}

export interface MonthContext {
  sim: SimState;
  env: Env;
  st: Settlement;
  /** Food each person eats (units a month), and the share of people who work. */
  need: number;
  workShare: number;
  /** How far round it its people work (km), and the grid helper to find the points there. */
  r: number;
  cellsNear: (x: number, y: number, r: number) => number[];
  /** The month's wild plant food left on the land (shared with tribes), units per point. */
  left: Float32Array;
  /** Is it the local summer, and was it last month? (The harvest comes as summer ends.) */
  summer: boolean;
  wasSummer: boolean;
  /** Months left in this half of the year (1–6): crops growing now are harvested as it ends. */
  monthsLeft: number;
  /** In the southern hemisphere (the seasons' fields swap). */
  south: boolean;
  year: number;
  /** What the settlement knows (technology ids); basic survival needs nothing. */
  has: (techId: string) => boolean;
  /** What its culture is good at (culture.ts). */
  cfx?: CultureFx;
}

/** One month of a settlement's work, eating and stores. Returns how well it was fed (1 = enough). */
export function economyMonth(c: MonthContext): number {
  const { sim, env, st } = c;
  const e = (st.economy ??= newEconomy(st.pop, c.need, 3));
  const R = reachOf(env, st, c.r, c.cellsNear);
  const pop = st.pop;
  const need = pop * c.need;
  // Those away with a caravan don't work at home.
  const W = Math.max(1, Math.round(pop * c.workShare) - (e.away ?? 0));
  const S = e.stores;
  const foodStock = Object.entries(S).reduce((n, [id, v]) => n + (isFood(env, id) ? v : 0), 0);
  // ---- Food jobs: aim to eat, and to build up stores toward four months.
  // Crop growth in the local summer and winter halves: one harvest a year where winters are cold or
  // dry, two in the tropics.
  const fx = techEffects(c.has);
  // Irrigation: dry but warm land by rivers grows crops as if watered.
  const irrigated = (s: 0 | 1) => (fx.irrigation && R.river && R.warm[s] ? Math.max(R.growth[s], 0.7) : R.growth[s]);
  const gSummer = halfGrowth(irrigated(c.south ? 1 : 0));
  const gWinter = halfGrowth(irrigated(c.south ? 0 : 1));
  const gNow = c.summer ? gSummer : gWinter;
  const gNext = c.summer ? gWinter : gSummer;
  const yearGrowth = (gSummer + gWinter) / 2;
  const best = (pred: (r: ResInfo) => boolean) => {
    let id = '';
    let v = 0;
    for (const r of env.resInfo) if (pred(r) && (R.avail[r.id] ?? 0) > v) {
      v = R.avail[r.id];
      id = r.id;
    }
    return { id, v };
  };
  // Farming needs agriculture and herding husbandry; simple fishing is free, but poor without nets and boats.
  const workable = (r: ResInfo) => canWork(c.has, r.source, r.id);
  const crop = best((r) => r.food && r.source === 'Farmed' && workable(r));
  const fish = best((r) => r.food && r.source === 'Fished');
  const herd = best((r) => r.food && r.source === 'Herded' && workable(r));
  const cf = c.cfx;
  const FARM = RATE.Farmed * fx.farm * (cf?.farm ?? 1);
  const FISH = RATE.Fished * fx.fish * (cf?.fish ?? 1);
  const HERD = RATE.Herded * fx.herd * (cf?.herd ?? 1);
  const HUNT = cf?.hunt ?? 1;
  // Wild food: the month's plants in reach (shared), and game.
  let pool = 0;
  for (const k of R.cells) pool += c.left[k] * R.share;
  let gameStock = 0;
  for (const b of env.beastInfo) {
    if (b.water) continue;
    const D = sim.beasts[b.id];
    for (const k of R.cells) gameStock += D[k] * b.meat * env.cellArea * R.share * 0.06 * b.catchRate;
  }
  // Each job: what a worker brings in on average, and how many workers before it gets crowded.
  type Job = { key: string; y: number; cap: number };
  const jobs: Job[] = [];
  const landKm2 = R.cells.length * env.cellArea * R.share;
  if (crop.id && yearGrowth > 0) jobs.push({ key: `farm:${crop.id}`, y: FARM * crop.v * yearGrowth, cap: Math.max(10, landKm2 * crop.v * 2) });
  if (fish.id) jobs.push({ key: `fish:${fish.id}`, y: FISH * fish.v, cap: Math.max(10, 40 + landKm2 * 0.05) });
  // Herds graze what the pasture offers (steppe is herding land, however dry).
  const pasture = 0.5 + 0.5 * Math.min(1, Math.max(R.growth[0], R.growth[1]) * 2);
  if (herd.id) jobs.push({ key: `herd:${herd.id}`, y: HERD * herd.v * pasture, cap: Math.max(10, landKm2 * herd.v * 0.5) });
  jobs.push({ key: 'gather', y: 1.2, cap: Math.max(1, pool / 1.2) });
  jobs.push({ key: 'hunt', y: 1.5 * HUNT, cap: Math.max(1, gameStock / 1.5) });
  const count: Record<string, number> = {};
  // Farmers are set at sowing, for the year ahead (with something over for spoiling and bad years),
  // and stay in the fields all through the growing season.
  const farm = jobs.find((j) => j.key.startsWith('farm:'));
  const others = jobs.filter((j) => j !== farm);
  const bestOther = Math.max(0, ...others.map((j) => j.y));
  if (farm && (e.farmers === undefined || (c.summer && !c.wasSummer))) {
    const perYear = FARM * 6 * crop.v * (gSummer + gWinter);
    // A year's eating, plus what spoils while it is kept (half a year on average), plus a fifth over for bad years.
    const spoil = resInfoOf(env, crop.id)?.spoil ?? 0.02;
    const yearNeed = need * 12 * (1 + spoil * 6) * 1.2;
    // Worth farming if a farmer's year beats the other food work. Enough farmers that they and
    // everyone else on food (herding, fishing, hunting all year) bring in the year's need.
    const otherYear = 12 * 0.7 * bestOther;
    if (perYear / 12 < bestOther * 0.8) e.farmers = 0;
    else if (perYear <= otherYear) e.farmers = Math.round(W * 0.3);
    else e.farmers = Math.round(Math.max(0, Math.min(W * 0.85, (yearNeed - W * 0.9 * otherYear) / (perYear - otherYear))));
  }
  if (!farm) e.farmers = 0;
  const farmers = farm && gNow > 0 ? Math.min(e.farmers ?? 0, Math.round(W * 0.85)) : 0;
  if (farmers > 0) count[farm!.key] = farmers;
  // The rest of the food work: whatever the stores can't cover until the next harvest (or, not
  // farming, to eat and build stores toward four months).
  // Farming: look ahead to the harvest after next. The stores and the coming harvest must last until
  // then; any shortfall is spread over the months (hunting, fishing, gathering all year), and the
  // stores must not run out before the coming harvest.
  let target: number;
  if (e.farmers) {
    // The next harvest: at the end of this half if crops grow now, else of the next.
    const H = gNow > 0 ? c.monthsLeft : c.monthsLeft + 6;
    const gH = gNow > 0 ? gNow : gNext;
    const months = gNow > 0 ? c.monthsLeft : 6;
    const crowded = (e.farmers ?? 0) / (1 + (e.farmers ?? 0) / (farm?.cap ?? 1));
    const coming = (gNow > 0 ? e.crop : 0) + FARM * crop.v * gH * crowded * months * 0.95;
    // After it, until the one after (6 months with two harvests a year, else 12).
    const after = gSummer > 0 && gWinter > 0 ? 6 : 12;
    const short = need * (H + after) * 1.15 - foodStock - coming;
    target = Math.max(need * 1.05 - foodStock / H, short / (H + after));
  } else target = need * 1.05 + Math.max(0, need * 4 - foodStock) / 6;
  const chunk = Math.max(1, Math.round(W / 50));
  let planned = 0;
  let foodWorkers = farmers;
  while (planned < target && foodWorkers + chunk <= W * 0.95) {
    let bj: Job | null = null;
    let bm = 0;
    for (const j of others) {
      const m = j.y / Math.pow(1 + (count[j.key] ?? 0) / j.cap, 2);
      if (m > bm) {
        bm = m;
        bj = j;
      }
    }
    if (!bj || bm < 0.05) break;
    count[bj.key] = (count[bj.key] ?? 0) + chunk;
    planned += bm * chunk;
    foodWorkers += chunk;
  }
  // ---- Needs, then the rest of what the land offers.
  let free = W - foodWorkers;
  // Hides, horn, feathers and furs come from the herds and the hunt, not from workers of their own.
  // Hides, horn and furs come from herds and hunts; what needs know-how waits for it; better tools work faster.
  const rateOf = (r: ResInfo) => (r.source === 'Herded' || r.source === 'Hunted' || !workable(r) ? 0 : (RATE[r.source] ?? 0.5) * fx.craft * (cf?.craft ?? 1));
  for (const nd of NEEDS) {
    const want = nd.per * pop;
    const have = env.resInfo.filter((r) => !r.food && nd.match(r)).reduce((n, r) => n + (S[r.id] ?? 0), 0);
    if (have >= want * 6) continue;
    const pick = best((r) => !r.food && nd.match(r) && rateOf(r) > 0);
    if (!pick.id || free <= 0) continue;
    const n = Math.min(free, Math.ceil((want * 1.5) / (rateOf(resInfoOf(env, pick.id)!) * pick.v)));
    count[pick.id] = (count[pick.id] ?? 0) + n;
    free -= n;
  }
  if (free > 0) {
    // The rest: the best things the land offers, valuables a little ahead (for trade, later).
    const value = (r: ResInfo) => (r.category === 'Metal' || r.category === 'Gem' || r.category === 'Luxury' ? 2 : 1);
    const offers = env.resInfo
      // Where nothing more can be kept, no one works at it; otherwise what fetches most here (the market's price) draws the most hands.
      .filter((r) => !r.food && rateOf(r) > 0 && (R.avail[r.id] ?? 0) > 0.05 && (S[r.id] ?? 0) < storeCap(pop) * 0.9)
      .map((r) => ({ r, w: R.avail[r.id] * rateOf(r) * (e.prices?.[r.id] ?? value(r)) }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 5);
    const total = offers.reduce((n, o) => n + o.w, 0);
    for (const o of offers) {
      const n = Math.floor((free * o.w) / total);
      if (n > 0) count[o.r.id] = (count[o.r.id] ?? 0) + n;
    }
  }
  e.jobs = count;

  // ---- The month's work.
  const made: Record<string, number> = {};
  const add = (id: string, v: number) => {
    if (v <= 0) return;
    S[id] = (S[id] ?? 0) + v;
    made[id] = (made[id] ?? 0) + v;
  };
  const crowd = (key: string, n: number) => {
    const j = jobs.find((q) => q.key === key);
    return j ? n / (1 + n / j.cap) : n;
  };
  // The harvest, as the growing half has just ended (before this month's work): a good year or a bad one.
  if (c.wasSummer !== c.summer && e.crop > 0) {
    const year = cropYear(env, st.x, st.y, c.year);
    const units = e.crop * year;
    add(e.cropId, units);
    e.harvest = { units, year, day: sim.day };
    e.crop = 0;
  }
  for (const [key, n] of Object.entries(count)) {
    if (n <= 0) continue;
    if (key.startsWith('farm:')) {
      // Crops grow in the summer half and come in at its end.
      const id = key.slice(5);
      if (gNow > 0) {
        if (e.cropId !== id) {
          e.crop = 0;
          e.cropId = id;
        }
        e.crop += crowd(key, n) * FARM * crop.v * gNow;
      }
    } else if (key.startsWith('fish:')) add(key.slice(5), crowd(key, n) * FISH * fish.v * (c.summer ? 1.1 : 0.8));
    else if (key.startsWith('herd:')) {
      const v = crowd(key, n) * HERD * herd.v * pasture;
      add(key.slice(5), v);
      // Hides and wool from the herds.
      add('leather', v * 0.06 * fx.hides);
      if (R.avail.wool) add('wool', v * 0.05);
    } else if (key === 'gather') {
      const want = crowd(key, n) * 1.2;
      let got = 0;
      for (const k of R.cells) {
        if (got >= want) break;
        const take = Math.min(c.left[k] * R.share, want - got);
        c.left[k] -= take;
        got += take;
      }
      add(WILD, got);
    } else if (key === 'hunt') {
      const want = crowd(key, n) * 1.5 * HUNT;
      let got = 0;
      for (const b of env.beastInfo) {
        if (b.water || got >= want) continue;
        const D = sim.beasts[b.id];
        for (const k of R.cells) {
          if (got >= want) break;
          const stock = D[k] * b.meat * env.cellArea * R.share;
          if (stock <= 0) continue;
          const take = Math.min(stock * 0.06 * b.catchRate, want - got);
          got += take;
          D[k] = Math.max(0, D[k] - take / (b.meat * env.cellArea * Math.max(R.share, 1e-6)));
          markThinned(sim, b.id, k);
        }
      }
      add('game', got);
      add('leather', got * 0.04 * fx.hides);
      if (R.avail.furs) add('furs', got * 0.03);
    } else {
      const r = resInfoOf(env, key);
      if (r) add(key, n * rateOf(r) * (R.avail[key] ?? 0) * (r.source === 'Farmed' ? (c.summer ? 1.4 : 0.6) : 1));
    }
  }


  // ---- Stores spoil (salt keeps meat and fish), people eat, needs are met.
  const salted = (S.salt ?? 0) >= pop * 0.005;
  for (const id of Object.keys(S)) {
    const r = resInfoOf(env, id);
    const sp = r?.spoil ?? 0.01;
    const keep = (cf?.spoil ?? 1) * (salted && r && (r.source === 'Fished' || r.source === 'Hunted' || r.source === 'Herded') ? sp * 0.5 : sp) * fx.spoil;
    S[id] *= 1 - keep;
  }
  const foods = Object.keys(S).filter((id) => isFood(env, id)).sort((a, b) => (resInfoOf(env, b)?.spoil ?? 0) - (resInfoOf(env, a)?.spoil ?? 0));
  let eaten = 0;
  for (const id of foods) {
    if (eaten >= need) break;
    const take = Math.min(S[id], need - eaten);
    S[id] -= take;
    eaten += take;
  }
  let met = 0;
  for (const nd of NEEDS) {
    const want = nd.per * pop;
    let got = 0;
    for (const r of env.resInfo) {
      if (r.food || !nd.match(r) || !S[r.id]) continue;
      const take = Math.min(S[r.id], want - got);
      S[r.id] -= take;
      got += take;
      if (got >= want) break;
    }
    // Where the land has none at all, people make do.
    const any = env.resInfo.some((r) => !r.food && nd.match(r) && (R.avail[r.id] ?? 0) > 0.01);
    met += want > 0 ? (any ? got / want : 0.7) : 1;
  }
  e.comfort = met / NEEDS.length;
  // Stores are kept within what a settlement can hold: food for a year and a half, other things for two years' need.
  const foodCap = need * 18;
  let food = foods.reduce((n, id) => n + S[id], 0);
  if (food > foodCap) for (const id of foods) {
    const cut = Math.min(S[id], food - foodCap);
    S[id] -= cut;
    food -= cut;
  }
  for (const id of Object.keys(S)) {
    if (isFood(env, id)) continue;
    const cap = storeCap(pop);
    if (S[id] > cap) S[id] = cap;
  }
  for (const id of Object.keys(S)) if (S[id] < 0.05) delete S[id];
  e.made = made;
  return need > 0 ? eaten / need : 1;
}
