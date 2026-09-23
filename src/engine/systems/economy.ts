import {
  CRAFT_SECTORS, EXTRACTION_SECTORS, GOOD_BASE_PRICE, GOOD_COUNT, GOOD_DECAY, Good, SECTOR_COUNT,
  type Recipe,
} from '../data/economy';
import type { Settlement } from '../types';
import type { World } from '../world';

export const WORK_FRACTION = 0.55;
const EXT = EXTRACTION_SECTORS.length;
const FOOD_SECTORS = EXTRACTION_SECTORS.map((s, i) => (s.output === Good.Food ? i : -1)).filter((i) => i >= 0);

// Scratch buffers reused by every settlement.
const cap = new Float64Array(SECTOR_COUNT);
const yld = new Float64Array(SECTOR_COUNT);
const val = new Float64Array(SECTOR_COUNT);
const L = new Float64Array(SECTOR_COUNT);
const recipes: (Recipe | null)[] = new Array(CRAFT_SECTORS.length).fill(null);

const out = (k: number) => (cap[k] > 0 ? cap[k] * (1 - Math.exp((-L[k] * yld[k]) / cap[k])) : 0);
const marginal = (k: number) => (cap[k] > 0 ? yld[k] * Math.exp((-L[k] * yld[k]) / cap[k]) : 0);

export function foodNeed(world: World, s: Settlement): number {
  let n = 0;
  for (const r in s.races) n += s.races[r] * (world.raceById.get(r)?.foodNeed ?? 1);
  return n;
}

/**
 * Each settlement splits its workforce between sectors: first enough food to eat,
 * then whatever the local market pays best (marginal product x local price),
 * with diminishing returns as the territory's resources are worked harder.
 */
export function runProduction(world: World): void {
  for (const s of world.aliveSettlements()) produce(world, s);
}

function produce(world: World, s: Settlement): void {
  const pol = world.polities[s.polityId];
  const fx = pol.effects;
  const race = world.majorityRace(s);
  // In lean years the old and the young join the fields.
  const workers = s.pop * (WORK_FRACTION + 0.2 * Math.max(0, 1 - s.foodRatio));
  const toolCover = Math.min(1, s.stock[Good.Tools] / (workers * 0.08 + 1));
  const toolMult = 1 + 0.12 * toolCover * (1 + s.toolQuality * 0.6);
  s.produced.fill(0);
  s.consumed.fill(0);
  s.imported.fill(0);
  s.exported.fill(0);

  for (let k = 0; k < EXT; k++) {
    const sec = EXTRACTION_SECTORS[k];
    cap[k] = 0;
    yld[k] = 0;
    val[k] = s.price[sec.output];
    L[k] = 0;
    if (sec.requiresTech && !pol.techs.has(sec.requiresTech)) continue;
    if (sec.requiresMetallurgy !== undefined && fx.metallurgy < sec.requiresMetallurgy) continue;
    let c = 0;
    for (const [r, scale] of sec.capacity) c += s.resSum[r] * scale;
    const e = sec.effect ? fx[sec.effect] : 0;
    c *= 1 + e;
    if (sec.key === 'foraging') c += s.habitat * 35;
    else if (sec.key === 'farming') c += s.habitat * 200;
    if (sec.output === Good.Food) c *= sec.key === 'fishing' ? 0.5 + 0.5 * s.climate : s.climate;
    if (sec.key === 'arcanaGathering' && world.cfg.magic <= 0) c = 0;
    cap[k] = c;
    yld[k] = sec.yieldPerWorker * toolMult * (race.production[sec.key] ?? 1) * (1 + e * 0.5);
  }
  for (let c = 0; c < CRAFT_SECTORS.length; c++) {
    const k = EXT + c;
    const sec = CRAFT_SECTORS[c];
    cap[k] = 0;
    yld[k] = 0;
    val[k] = 0;
    L[k] = 0;
    recipes[c] = null;
    for (const r of sec.recipes) {
      if (sec.output !== Good.Luxuries && r.quality > fx.metallurgy) continue;
      let limit = Infinity;
      let inputCost = 0;
      for (const [g, q] of r.inputs) {
        limit = Math.min(limit, s.stock[g] / q);
        inputCost += s.price[g] * q;
      }
      if (limit < 0.5) continue;
      recipes[c] = r;
      cap[k] = limit;
      yld[k] = sec.yieldPerWorker * (1 + fx.craft) * (race.production[sec.key] ?? 1) * toolMult;
      val[k] = s.price[sec.output] * (1 + r.quality * 0.15) - inputCost;
      break;
    }
  }

  // 1) Subsistence: secure food first.
  const need = foodNeed(world, s);
  const chunk = Math.max(0.5, workers / 48);
  const foodTarget = need * 1.1 - s.stock[Good.Food] * 0.3;
  let assigned = 0;
  let food = 0;
  while (food < foodTarget && assigned + chunk <= workers) {
    let best = -1;
    let bm = 0.05;
    for (const k of FOOD_SECTORS) {
      const m = marginal(k);
      if (m > bm) {
        bm = m;
        best = k;
      }
    }
    if (best < 0) break;
    const before = out(best);
    L[best] += chunk;
    food += out(best) - before;
    assigned += chunk;
  }
  // 2) Market: remaining labour goes where it earns the most.
  while (assigned + chunk <= workers) {
    let best = -1;
    let bv = 0.02;
    for (let k = 0; k < SECTOR_COUNT; k++) {
      const v = marginal(k) * val[k];
      if (v > bv) {
        bv = v;
        best = k;
      }
    }
    if (best < 0) break;
    L[best] += chunk;
    assigned += chunk;
  }
  const idle = workers - assigned;

  // 3) Produce.
  let value = 0;
  for (let k = 0; k < EXT; k++) {
    const o = out(k);
    if (o <= 0) continue;
    const g = EXTRACTION_SECTORS[k].output;
    s.stock[g] += o;
    s.produced[g] += o;
    value += o * s.price[g];
  }
  for (let c = 0; c < CRAFT_SECTORS.length; c++) {
    const k = EXT + c;
    const r = recipes[c];
    if (!r || L[k] <= 0) continue;
    let o = out(k);
    for (const [g, q] of r.inputs) o = Math.min(o, s.stock[g] / q);
    if (o <= 0) continue;
    for (const [g, q] of r.inputs) {
      s.stock[g] -= o * q;
      s.consumed[g] += o * q;
    }
    const g = CRAFT_SECTORS[c].output;
    if (g === Good.Tools) s.toolQuality = (s.toolQuality * s.stock[g] + r.quality * o) / (s.stock[g] + o);
    if (g === Good.Weapons) s.weaponQuality = (s.weaponQuality * s.stock[g] + r.quality * o) / (s.stock[g] + o);
    s.stock[g] += o;
    s.produced[g] += o;
    value += o * s.price[g];
  }
  s.labor.set(L);
  s.wealth += value * 0.04 + idle * 0.08;
}

/**
 * Eating, spoilage, fuel, building homes, births and deaths, and the prices
 * that result from what is left in the stores.
 */
export function runConsumption(world: World): void {
  for (const s of world.aliveSettlements()) consume(world, s);
}

function consume(world: World, s: Settlement): void {
  const pol = world.polities[s.polityId];
  const fx = pol.effects;
  const culture = world.cultures[s.cultureId];

  // Food
  const need = foodNeed(world, s);
  const eat = Math.min(s.stock[Good.Food], need);
  s.stock[Good.Food] -= eat;
  s.consumed[Good.Food] += eat;
  s.foodRatio = need > 0 ? eat / need : 1;

  const take = (g: Good, amount: number): number => {
    const t = Math.min(s.stock[g], amount);
    s.stock[g] -= t;
    s.consumed[g] += t;
    return amount > 0 ? t / amount : 1;
  };
  take(Good.Timber, s.pop * 0.05);
  const saltCover = take(Good.Salt, s.pop * 0.01);
  const wealthPerCap = s.wealth / Math.max(1, s.pop);
  const luxCover = take(Good.Luxuries, s.pop * 0.003 * (1 + wealthPerCap));
  s.stability += (luxCover - 0.5) * 0.01;

  // Construction: timber always, dressed stone once masonry is known.
  const housingMax = fx.housingMax;
  const desired = Math.max(0, Math.min(housingMax, s.pop * 1.3 + 40) - s.housing);
  const usesStone = housingMax > 3000;
  if (desired > 0) {
    // Builders leave some timber and stone for the workshops.
    let units = Math.min(desired, (s.stock[Good.Timber] * 0.7) / 0.25);
    if (usesStone && s.housing > 2000) units = Math.min(units, (s.stock[Good.Stone] * 0.7) / 0.15 + desired * 0.05);
    if (s.housing < 500) units = Math.max(units, desired * 0.3); // huts and tents need little
    units = Math.max(0, units);
    const timberUsed = Math.min(s.stock[Good.Timber], units * 0.25);
    s.stock[Good.Timber] -= timberUsed;
    s.consumed[Good.Timber] += timberUsed;
    if (usesStone) {
      const stoneUsed = Math.min(s.stock[Good.Stone], units * 0.15);
      s.stock[Good.Stone] -= stoneUsed;
      s.consumed[Good.Stone] += stoneUsed;
    }
    s.housing += units;
  }
  s.housing = Math.min(s.housing * 0.99, Math.max(housingMax, s.pop));

  // Spoilage and wear.
  const storage = Math.min(0.8, fx.storage + 0.35 * saltCover);
  for (let g = 0; g < GOOD_COUNT; g++) {
    const d = g === Good.Food ? GOOD_DECAY[g] * (1 - storage) : GOOD_DECAY[g];
    s.stock[g] *= 1 - d;
  }

  // Population change per race.
  const room = 1 - s.pop / Math.max(1, s.housing);
  const crowd = room > 0 ? Math.min(1, room * 3) : Math.max(-0.6, room * 2);
  const famine = s.foodRatio < 0.98 ? (1 - s.foodRatio) * 0.3 : 0;
  const plague = s.plague * 0.22 * (1 - Math.min(0.8, fx.sanitation));
  const feed = Math.min(1, s.foodRatio);
  let pop = 0;
  for (const r in s.races) {
    const rd = world.raceById.get(r);
    const g = rd ? rd.growth : 0.02;
    const rate = crowd >= 0 ? g * feed * crowd : crowd * 0.1;
    const hardy = 1 - (rd?.hardiness ?? 0);
    const n = Math.max(0, s.races[r] * (1 + rate - (famine + plague) * hardy));
    if (n < 0.5) delete s.races[r];
    else {
      s.races[r] = n;
      pop += n;
    }
  }
  s.pop = pop;
  s.peakPop = Math.max(s.peakPop, pop);

  // Wealth & taxes.
  const tax = s.wealth * 0.06;
  pol.treasury += tax;
  s.wealth = (s.wealth - tax) * 0.97;

  updatePrices(world, s, culture.values.militarism);
}

export function updatePrices(world: World, s: Settlement, militarism: number): void {
  const fx = world.polities[s.polityId].effects;
  const pop = s.pop;
  const workers = pop * WORK_FRACTION;
  const t = s.target;
  const met = fx.metallurgy;
  const wealthPerCap = s.wealth / Math.max(1, pop);
  const desired = Math.max(0, Math.min(fx.housingMax, pop * 1.3 + 40) - s.housing);
  // Tribute feeds the court; it is not for resale.
  t[Good.Food] = foodNeed(world, s) * 1.2 + (world.polities[s.polityId].capitalId === s.id ? s.tributeIn : 0);
  t[Good.Tools] = workers * 0.08;
  t[Good.Weapons] = pop * 0.02 * (0.5 + militarism);
  const craftDemand = (t[Good.Tools] + t[Good.Weapons]) * 0.35;
  t[Good.Timber] = pop * 0.05 + desired * 0.25 + craftDemand * 0.4;
  t[Good.Stone] = (fx.housingMax > 3000 ? desired * 0.15 : 0) + (met === 0 ? craftDemand * 0.6 : 0) + pop * 0.005;
  t[Good.Copper] = met >= 1 && met < 3 ? craftDemand * 0.9 : met >= 1 ? pop * 0.002 : 0;
  t[Good.Tin] = met >= 2 && met < 3 ? craftDemand * 0.25 : 0;
  t[Good.Iron] = met >= 3 ? craftDemand * 1.1 : 0;
  t[Good.Coal] = met >= 4 ? craftDemand * 0.9 : 0;
  t[Good.Gold] = pop * 0.002 * (1 + wealthPerCap);
  t[Good.Gems] = pop * 0.001 * (1 + wealthPerCap);
  t[Good.Salt] = pop * 0.012;
  t[Good.Horses] = pop * (world.polities[s.polityId].techs.has('horseback_riding') ? 0.004 : 0.001);
  t[Good.Reagents] = world.cfg.magic > 0 ? pop * 0.002 * (1 + fx.magic) : 0;
  t[Good.Luxuries] = pop * 0.004 * (1 + wealthPerCap);
  for (let g = 0; g < GOOD_COUNT; g++) {
    const e = Math.max(0.5, t[g] * 0.05);
    const ratio = (t[g] + e) / (s.stock[g] + e);
    s.price[g] = GOOD_BASE_PRICE[g] * Math.pow(Math.min(5, Math.max(0.2, ratio)), 0.8);
  }
}
