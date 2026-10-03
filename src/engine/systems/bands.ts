import { BIOMES, Biome } from '../data/biomes';
import { FOOD_SEASON, SPRING_MUSTER, TRAVEL_SEASON } from '../calendar';
import { Good, Res } from '../data/economy';
import { PRACTICE, TECHS, techCost } from '../data/techs';
import type { Band, Lifestyle, Settlement, Tribe } from '../types';
import { randomColor } from '../names';
import type { World } from '../world';
import { killPop } from './politics';
import { siteScore } from './sites';

/** Terrain cost a band covers in a month on the move, with its people, gear and herds. */
const BAND_PACE = 5;
/** How far around its camp a band hunts, gathers and grazes. */
const RANGE = 2;
/** How far it looks for its next seasonal ground. */
const SEARCH = 10;
/** Yield of wild land worked by a band, against the raw resources on it. */
const WILD_SCALE = 1.4;
const SPLIT_POP = 140;
const MAX_BANDS = 500;
/** Month the band moves to its winter grounds. */
const AUTUMN_MOVE = 8;
const HERD_LAND = new Set(['grassland', 'steppe', 'savanna', 'tundra']);
const SETTLE: Record<Lifestyle, number> = { settled: 1, seminomadic: 0.35, nomadic: 0.04 };
/** Reach of a tribe's home range around its centre. */
const HOME_R = 5;
/** Most new tiles of land a tribe claims in a year. */
const CLAIM_RATE = 6;
/** Years a clan's claim lasts once none of its tribes use the land. */
const CLAIM_KEEP = 12;
/** Food a tribe wants its home range to be able to give, against what it needs. */
const RANGE_WANT = 1.6;
/** Years a tribe roams, getting to know the land, before it settles on a home range. */
const SCOUT_YEARS = 3;
/** Years a tribe holds its home range before it will fight to take more. */
const HOLD_YEARS = 4;
/** Land good enough that a searching tribe stops and makes it home. */
const HOME_GOOD = 1.4;
/**
 * Share of what wild land holds that can be taken year after year without hunting it out: why
 * hunters and gatherers need so much more land than farmers.
 */
const SUSTAIN = 0.12;

const raceOf = (world: World, b: Band) => {
  let best = '';
  let n = -1;
  for (const r in b.races) if (b.races[r] > n) {
    n = b.races[r];
    best = r;
  }
  return world.raceById.get(best) ?? world.races[0];
};

const needOf = (world: World, b: Band) => {
  let n = 0;
  for (const r in b.races) n += b.races[r] * (world.raceById.get(r)?.foodNeed ?? 1);
  return n * (1 + world.cultures[b.cultureId].traitEffects.foodNeed);
};

const isWater = (world: World, t: number) => BIOMES[world.map.biome[t]].water;

/** What a tile of wild land gives a band in a year: game and wild plants, grazing for herds, fish from the water. Land a settlement works is not wild. */
function wildYield(world: World, b: Band, t: number, potential = false): number {
  const map = world.map;
  if (map.owner[t] >= 0 || map.biome[t] === Biome.DeepOcean || map.biome[t] === Biome.Ice) return 0;
  const R = map.resources;
  let y: number;
  if (isWater(world, t)) y = R[Res.Fish][t] * 40;
  else if (b.way === 'herders') y = R[Res.Game][t] * 15 + R[Res.Horses][t] * 40 + R[Res.Fertility][t] * 28;
  else {
    const habitat = raceOf(world, b).habitat?.[BIOMES[map.biome[t]].key] ?? 0;
    y = R[Res.Game][t] * 30 + R[Res.Fertility][t] * 12 + habitat * 35 + R[Res.Fish][t] * 15;
  }
  return y * WILD_SCALE * (potential ? 1 : 1 - map.pressure[t]);
}

/** Can a clan claim this tile as hunting ground: wild land (or fishing water) not worked by settled folk. */
function claimable(world: World, b: Band, t: number, home: number): boolean {
  const map = world.map;
  if (map.owner[t] >= 0 || map.biome[t] === Biome.DeepOcean || map.biome[t] === Biome.Ice) return false;
  return isWater(world, t) || map.landmass[t] === map.landmass[home];
}

/** What the land a clan holds around a tribe's home could give it in a year (with the game left to recover). */
function homeYield(world: World, b: Band, home: number): number {
  let sum = 0;
  around(world, home, HOME_R, (t) => {
    if (world.map.claim[t] === b.tribeId && claimable(world, b, t, home)) sum += wildYield(world, b, t, true) * SUSTAIN;
  });
  return sum;
}

function around(world: World, tile: number, r: number, fn: (t: number, d: number) => void): void {
  const map = world.map;
  const w = map.width;
  const x0 = tile % w;
  const y0 = (tile - x0) / w;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= map.height) continue;
      fn(y * w + x, Math.max(Math.abs(dx), Math.abs(dy)));
    }
  }
}

/** A year's worth of food the wild land around a tile can give a band. */
function rangeYield(world: World, b: Band, tile: number, r = RANGE): number {
  let sum = 0;
  around(world, tile, r, (t) => {
    if (isWater(world, t) || world.map.landmass[t] === world.map.landmass[tile]) sum += wildYield(world, b, t);
  });
  return sum;
}

/** The nation (if any) whose lands a tile lies in. */
function realmOf(world: World, t: number): number {
  const o = world.map.region[t];
  return o >= 0 ? world.settlements[o].polityId : -1;
}

/**
 * How welcome a camp ground is to a tribe by who claims it: its own clan's land is home, another
 * clan's is trespass (and risks a fight), open land is for those still searching.
 */
function groundClaim(world: World, b: Band, t: number, homed: boolean): number {
  const c = world.map.claim[t];
  if (c === b.tribeId) return homed ? 1.25 : 1.1;
  if (c >= 0) return b.lastHungry >= 3 ? 0.45 : 0.15;
  return homed ? 0.6 : 1;
}

/**
 * Choose where to go next: in spring the best summer grounds within reach, in autumn sheltered
 * winter grounds (woods, river valleys, lower ground), when hungry anywhere with food. Bands keep
 * clear of one another and of settled lands, and a splinter band strikes out further.
 */
function chooseGround(world: World, b: Band, winter: boolean, far = false): void {
  const rng = world.rng;
  const map = world.map;
  const w = map.width;
  const tribe = world.tribes[b.tribeId];
  // A tribe with a home range keeps its seasonal round inside it; one still searching ranges widely.
  const homed = b.home >= 0 && !far;
  const centre = homed ? b.home : b.tile;
  const reach = homed ? HOME_R : far ? SEARCH + 8 : SEARCH;
  let best = b.tile;
  let bs = rangeYield(world, b, b.tile, 1) * (far ? 0 : 0.8) * groundClaim(world, b, b.tile, homed);
  for (let a = 0; a < 40; a++) {
    const x = (centre % w) + rng.int(-reach, reach);
    const y = Math.floor(centre / w) + rng.int(-reach, reach);
    if (x < 0 || y < 0 || x >= w || y >= map.height) continue;
    const t = y * w + x;
    if (isWater(world, t) || map.landmass[t] !== map.landmass[b.tile] || map.biome[t] === Biome.Ice || map.owner[t] >= 0) continue;
    const d = Math.hypot(x - (b.tile % w), y - Math.floor(b.tile / w));
    if (far && d < 8) continue;
    let score = rangeYield(world, b, t, 1);
    if (winter) {
      const key = BIOMES[map.biome[t]].key;
      if (key.includes('Forest') || key === 'taiga' || map.river[t] > 0) score *= 1.4;
      score *= 1.2 - map.elevation[t] * 0.4;
    }
    const realm = realmOf(world, t);
    if (realm >= 0 && realm !== tribe.polityId) score *= 0.35;
    score *= groundClaim(world, b, t, homed);
    let crowd = 0;
    for (const o of world.bands) if (o.alive && o !== b && Math.abs((o.ground % w) - x) <= 3 && Math.abs(Math.floor(o.ground / w) - y) <= 3) crowd++;
    score /= 1 + crowd * 1.5;
    score /= 1 + d * 0.04;
    if (score > bs) {
      bs = score;
      best = t;
    }
  }
  if (best === b.tile) return;
  const pf = world.pathfinder;
  pf.run(b.tile, 90, 0, (tile) => tile === best);
  const path = pf.pathTo(best);
  if (path.length < 2) return;
  b.ground = best;
  b.path = path;
  b.step = 0;
  b.prevStep = 0;
}

/**
 * Every month: bands travel to their seasonal grounds, hunt, gather, fish and graze their herds
 * on the wild land around them (wearing it out as they go), eat, and are born and die.
 */
export function bandsMonth(world: World): void {
  const m = world.month;
  const winterish = world.season === 'winter';
  for (const b of world.bands) {
    if (!b.alive) continue;
    b.prevStep = b.step;
    // The seasonal round.
    if (m === SPRING_MUSTER) chooseGround(world, b, false);
    else if (m === AUTUMN_MOVE) chooseGround(world, b, true);
    const moving = b.step < b.path.length - 1;
    if (moving) {
      let budget = BAND_PACE * TRAVEL_SEASON[world.season];
      while (budget > 0 && b.step < b.path.length - 1) {
        b.step++;
        const c = world.map.moveCost[b.path[b.step]];
        budget -= Number.isFinite(c) ? c : 1;
      }
      b.tile = b.path[b.step];
    }
    // Food from the land.
    const race = raceOf(world, b);
    const yearly = rangeYield(world, b, b.tile);
    const season = (b.way === 'herders' ? FOOD_SEASON.herding : FOOD_SEASON.foraging)[m];
    const pm = yearly * season * (moving ? 0.5 : 1);
    const skill = b.way === 'herders' ? 2.8 * (race.production.herding ?? 1) : 2.1 * (race.production.foraging ?? 1);
    const work = (b.pop * 0.55 * skill) / 12;
    const got = pm > 0 ? pm * (1 - Math.exp(-work / pm)) : 0;
    b.food += got;
    if (!moving) around(world, b.tile, 1, (t) => {
      if (world.map.owner[t] < 0) world.map.pressure[t] = Math.min(0.9, world.map.pressure[t] + Math.min(0.08, b.pop / 3000));
    });
    // Eat.
    const need = needOf(world, b) / 12;
    const eat = Math.min(b.food, need);
    b.food = (b.food - eat) * 0.96;
    b.food = Math.min(b.food, need * 5);
    const fed = need > 0 ? eat / need : 1;
    if (fed < 0.9) b.hungry++;
    // Births and deaths: the land around them is what limits a band.
    const room = Math.max(-0.5, Math.min(1, 1 - (needOf(world, b) * 1.1) / Math.max(1, yearly)));
    const famine = fed < 0.98 ? (1 - fed) * 0.3 * (1 - (race.hardiness ?? 0)) : 0;
    const cold = winterish && b.way === 'foragers' && yearly < needOf(world, b) ? 0.01 : 0;
    let pop = 0;
    for (const r in b.races) {
      const g = world.raceById.get(r)?.growth ?? 0.02;
      const rate = room >= 0 ? g * fed * room : room * 0.1;
      b.races[r] = Math.max(0, b.races[r] * (1 + (rate - famine - cold) / 12));
      pop += b.races[r];
    }
    b.pop = pop;
    // Hungry bands do not wait for the season to move on.
    if (!moving && b.hungry >= 2 && fed < 0.7 && m !== SPRING_MUSTER && m !== AUTUMN_MOVE) chooseGround(world, b, winterish);
  }
}

function newTribe(world: World, cultureId: number, parentId: number, near: number): Tribe {
  const culture = world.cultures[cultureId];
  const baseName = world.names.polity(world.rng, culture.language);
  const parent = parentId >= 0 ? world.tribes[parentId] : null;
  const t: Tribe = {
    id: world.tribes.length, name: baseName, baseName, cultureId, color: randomColor(world.rng), founded: world.year, dissolved: null,
    polityId: -1, techs: new Set(parent?.techs ?? []), progress: new Map(), parentId, feuds: {}, wins: 0, losses: 0,
  };
  world.tribes.push(t);
  return t;
}

export function createBand(world: World, tribe: Tribe, tile: number, races: Record<string, number>): Band {
  const pop = Object.values(races).reduce((a, n) => a + n, 0);
  const b: Band = {
    id: world.nextBandId++, name: `the ${world.names.person(world.rng, world.cultures[tribe.cultureId].language)} tribe`, tribeId: tribe.id,
    cultureId: tribe.cultureId, races: { ...races }, pop, way: 'foragers', tile, ground: tile, path: [], step: 0, prevStep: 0,
    food: pop * 0.25, hungry: 0, lastHungry: 0, founded: world.year, lastSplit: world.year, alive: true, home: -1, searching: 0, homeSince: 0,
  };
  world.bands.push(b);
  return b;
}

/** Begin a people as tribes of wandering bands around their homeland. */
export function seedTribes(world: World, cultureId: number, around: number[], race: string): void {
  for (const tile of around) {
    const tribe = newTribe(world, cultureId, -1, tile);
    for (let i = 0; i < 2; i++) createBand(world, tribe, tile, { [race]: world.rng.int(45, 80) });
  }
}

/** Tribes learn as nations do: through practice, and from the settled peoples around them. */
function tribeLearning(world: World, tribe: Tribe, bands: Band[]): void {
  const culture = world.cultures[tribe.cultureId];
  const race = world.raceById.get(culture.raceId) ?? world.races[0];
  const done = new Map<string, number>();
  const add = (k: string, v: number) => done.set(k, (done.get(k) ?? 0) + v);
  let water = false;
  for (const b of bands) {
    add(b.way === 'herders' ? 'herding' : 'foraging', b.pop * 0.55);
    add('toolmaking', b.pop * 0.03);
    add('forestry', b.pop * 0.05);
    add('faith', b.pop * culture.values.piety * 0.1);
    let wet = false;
    around(world, b.tile, 1, (t) => {
      if (isWater(world, t) || world.map.river[t] > 0) wet = true;
    });
    if (wet) {
      water = true;
      add('fishing', b.pop * 0.15);
      add('sea', b.pop * 0.1);
    }
  }
  for (const tech of TECHS) {
    if (tech.era > 1 || tribe.techs.has(tech.id) || (tech.arcane && world.cfg.magic <= 0)) continue;
    if (tech.prereqs.some((p) => !tribe.techs.has(p)) || (tech.requiresWater && !water)) continue;
    let amount = 0;
    for (const k of PRACTICE[tech.id] ?? []) amount += done.get(k) ?? 0;
    if (amount <= 0) continue;
    // Settled neighbours who know it teach it far faster.
    let known = 0;
    for (const b of bands) {
      const realm = realmOf(world, b.tile);
      if (realm >= 0 && world.polities[realm].techs.has(tech.id)) known = 1;
    }
    const rate = 0.03 * Math.pow(amount, 0.6) * (0.55 + culture.values.curiosity * 0.9) * (race.research[tech.category] ?? 1) * (1 + 2 * known);
    const progress = (tribe.progress.get(tech.id) ?? 0) + rate;
    if (progress < techCost(tech) * (1 - 0.65 * known)) {
      tribe.progress.set(tech.id, progress);
      continue;
    }
    tribe.progress.delete(tech.id);
    tribe.techs.add(tech.id);
    if (!world.firstTech.has(tech.id)) {
      world.firstTech.set(tech.id, -1);
      world.log('technology', 2, `The wandering ${tribe.name} clan were the first to master ${tech.name}: ${tech.description}`, { cultures: [tribe.cultureId] });
    }
  }
}

/** Is there room here for a new settlement: far enough from all others, and not in a foreign nation's lands? */
function siteFree(world: World, t: number, polityId: number): boolean {
  const map = world.map;
  if (isWater(world, t) || map.settlementAt[t] >= 0 || map.biome[t] === Biome.Ice) return false;
  const realm = realmOf(world, t);
  if (realm >= 0 && realm !== polityId) return false;
  const sp = world.cfg.settlementSpacing;
  const x = t % map.width;
  const y = Math.floor(t / map.width);
  let ok = true;
  around(world, t, Math.ceil(sp), (o) => {
    if (map.settlementAt[o] >= 0 && Math.hypot((o % map.width) - x, Math.floor(o / map.width) - y) < sp) ok = false;
  });
  if (ok) for (const p of world.settlers) if (Math.hypot((p.targetTile % map.width) - x, Math.floor(p.targetTile / map.width) - y) < sp) ok = false;
  return ok;
}

/** A band gives up the wandering life and founds a settlement; a tribe's first makes it a nation. */
function settle(world: World, b: Band, tribe: Tribe): boolean {
  const race = raceOf(world, b);
  const culture = world.cultures[b.cultureId];
  let best = -1;
  let bs = -Infinity;
  const holder = tribe.polityId >= 0 && world.polities[tribe.polityId].alive ? tribe.polityId : -1;
  around(world, b.tile, 3, (t) => {
    if (!siteFree(world, t, holder)) return;
    const s = siteScore(world.map, race, t, culture.traitEffects.habitat);
    if (s > bs) {
      bs = s;
      best = t;
    }
  });
  if (best < 0 || bs < 0.5) return false;
  const s = world.createSettlement(best, holder, b.cultureId, b.races, -1);
  s.stock[Good.Food] += b.food;
  s.buildings = 'tents';
  b.alive = false;
  if (holder >= 0) {
    world.polities[holder].settlementIds.push(s.id);
    world.log('founding', 1, `${cap(b.name)} of the ${tribe.name} clan settled down and founded ${s.name}.`, { settlements: [s.id], polities: [holder] });
    return true;
  }
  const p = world.createPolity(b.cultureId, s, -1, tribe.techs);
  for (const [k, v] of tribe.progress) p.progress.set(k, v);
  p.baseName = tribe.baseName;
  p.color = tribe.color;
  p.name = world.polityName(p);
  tribe.polityId = p.id;
  world.log('tribe', 2, `The ${tribe.name} clan gave up the wandering life: ${b.name} settled at ${s.name}, and the ${p.name} was born.`, { settlements: [s.id], polities: [p.id], cultures: [b.cultureId] });
  return true;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Settled folk within a day or so of a band. */
function nearbySettlement(world: World, b: Band): Settlement | null {
  let found: Settlement | null = null;
  around(world, b.tile, 3, (t) => {
    const o = world.map.settlementAt[t];
    if (o >= 0 && !found && world.settlements[o].alive) found = world.settlements[o];
  });
  return found;
}

/**
 * Once a year: bands take up herding where the land suits it, tribes learn, bands meet settled
 * folk (trading meat, hides and horses for grain and tools, raiding them when hungry, or settling
 * among them), outgrown bands split and splinter groups found new tribes, and bands settle down
 * when their way of life and their land make it pay.
 */
export function bandsYear(world: World): void {
  const rng = world.rng;
  for (let i = 0; i < world.map.size; i++) if (world.map.pressure[i] > 0) world.map.pressure[i] *= 0.55;
  const byTribe = new Map<number, Band[]>();
  for (const b of world.bands) {
    if (!b.alive) continue;
    b.lastHungry = b.hungry;
    b.hungry = 0;
    const list = byTribe.get(b.tribeId) ?? [];
    list.push(b);
    byTribe.set(b.tribeId, list);
  }
  for (const [tid, bands] of byTribe) tribeLearning(world, world.tribes[tid], bands);
  clanLands(world);
  let alive = [...byTribe.values()].reduce((n, l) => n + l.length, 0);

  for (const b of [...world.bands]) {
    if (!b.alive) continue;
    const tribe = world.tribes[b.tribeId];
    const race = raceOf(world, b);
    const culture = world.cultures[b.cultureId];
    // Herding where there is grass for it, once animals are tamed.
    const key = BIOMES[world.map.biome[b.tile]].key;
    b.way = tribe.techs.has('animal_husbandry') && HERD_LAND.has(key) ? 'herders' : 'foragers';

    // Meeting settled folk.
    const s = nearbySettlement(world, b);
    if (s) {
      const owner = world.polities[s.polityId];
      if (b.lastHungry >= 3 && s.stock[Good.Food] > s.pop * 0.3 && rng.chance(0.15 + culture.values.militarism * 0.3)) {
        const q = Math.min(s.stock[Good.Food] * 0.25, needOf(world, b) * 0.5);
        s.stock[Good.Food] -= q;
        b.food += q;
        killPop(s, Math.min(s.pop * 0.01, b.pop * 0.05));
        s.stability -= 0.04;
        if (s.pop > 400) world.log('tribe', s.pop > 3000 ? 2 : 1, `Hungry raiders of the ${tribe.name} clan fell on ${s.name} and carried off its stores.`, { settlements: [s.id], polities: [s.polityId], cultures: [b.cultureId] });
      } else if (rng.chance(0.4)) {
        // Meat, hides and horses for grain and tools.
        s.wealth += b.pop * 0.05;
        if (b.way === 'herders') s.stock[Good.Horses] += b.pop * 0.01;
        b.food += needOf(world, b) * 0.05;
        const k = `trade:${tribe.id}:${s.polityId}`;
        if (!world.flags.has(k)) {
          world.flags.add(k);
          world.log('tribe', 1, `The ${tribe.name} clan began to trade ${b.way === 'herders' ? 'horses, hides and wool' : 'meat and hides'} at ${s.name} for grain and tools.`, { settlements: [s.id], polities: [s.polityId], cultures: [b.cultureId] });
        }
      }
      // A small band in a great nation's lands may simply settle among them.
      const inRealm = realmOf(world, b.tile) === s.polityId;
      if (inRealm && b.pop < 100 && owner.pop > b.pop * 20 && tribe.polityId !== s.polityId && rng.chance(0.08 * SETTLE[race.lifestyle ?? 'settled'] + 0.02)) {
        for (const r in b.races) s.races[r] = (s.races[r] ?? 0) + b.races[r];
        s.pop += b.pop;
        b.alive = false;
        alive--;
        if (b.pop > 50) world.log('tribe', 1, `${cap(b.name)} of the ${tribe.name} clan gave up wandering and settled among the people of ${s.name}.`, { settlements: [s.id], polities: [s.polityId], cultures: [b.cultureId] });
        continue;
      }
    }

    // Settling down.
    if (b.pop >= 60) {
      // Boxed in: little of the land around still free to roam.
      let land = 0;
      let wild = 0;
      around(world, b.tile, 4, (t) => {
        if (isWater(world, t)) return;
        land++;
        if (world.map.owner[t] < 0 && realmOf(world, t) < 0) wild++;
      });
      let wet = false;
      around(world, b.tile, 1, (t) => {
        if ((isWater(world, t) && world.map.resources[Res.Fish][t] > 0.3) || world.map.river[t] > 0) wet = true;
      });
      // Farming makes staying put pay; so, more rarely, does a rich fishing ground.
      const pull = (tribe.techs.has('agriculture') ? 0.25 : 0) + (wet ? 0.012 : 0) + (land > 20 && wild < land * 0.3 ? 0.3 : 0);
      const p = SETTLE[race.lifestyle ?? 'settled'] * pull * (b.way === 'herders' ? 0.3 : 1);
      if (rng.chance(p) && settle(world, b, tribe)) {
        alive--;
        continue;
      }
    }

    // Splitting: a band outgrows its range, or quarrels split it.
    const yearly = rangeYield(world, b, b.tile);
    const big = b.pop > SPLIT_POP * (b.way === 'herders' ? 1.3 : 1) || (b.pop > 80 && yearly < needOf(world, b) * 1.1);
    if (big && world.year - b.lastSplit > 6 && alive < MAX_BANDS) {
      const share = rng.range(0.35, 0.45);
      const races: Record<string, number> = {};
      for (const r in b.races) {
        races[r] = b.races[r] * share;
        b.races[r] -= races[r];
      }
      b.pop *= 1 - share;
      b.lastSplit = world.year;
      const siblings = byTribe.get(b.tribeId)?.filter((x) => x.alive).length ?? 1;
      // Most splits stay in the clan and go looking for new land to claim at its edge; in a large clan, some go their own way.
      const breakAway = siblings >= 6 && rng.chance(0.2);
      const home = breakAway ? newTribe(world, b.cultureId, tribe.id, b.tile) : tribe;
      const nb = createBand(world, home, b.tile, races);
      nb.food = b.food * share;
      b.food *= 1 - share;
      nb.way = b.way;
      chooseGround(world, nb, world.season === 'winter', true);
      alive++;
      if (breakAway) world.log('tribe', 2, `Some of the ${tribe.name} clan broke away under a chief of their own and went their own way as the ${home.name} clan.`, { cultures: [b.cultureId] });
    }

    // Dwindling bands join their kin or are lost.
    if (b.pop < 8) {
      b.alive = false;
      alive--;
      const kin = (byTribe.get(b.tribeId) ?? []).find((x) => x.alive && x !== b);
      if (kin) {
        for (const r in b.races) kin.races[r] = (kin.races[r] ?? 0) + b.races[r];
        kin.pop += b.pop;
      }
    }
  }
  world.bands = world.bands.filter((b) => b.alive);
  // Tribes with no bands left live on only in the nations they founded.
  const live = new Set(world.bands.map((b) => b.tribeId));
  for (const t of world.tribes) if (t.dissolved === null && !live.has(t.id)) t.dissolved = world.year;
}

/** Tribes of a clan within reach of a spot, and the fighters they can muster there. */
function fightersNear(world: World, clan: number, tile: number, r: number): { bands: Band[]; strength: number } {
  const w = world.map.width;
  const x = tile % w;
  const y = (tile - x) / w;
  const bands: Band[] = [];
  let strength = 0;
  for (const o of world.bands) {
    if (!o.alive || o.tribeId !== clan) continue;
    const at = o.home >= 0 ? o.home : o.tile;
    if (Math.max(Math.abs((at % w) - x), Math.abs(Math.floor(at / w) - y)) > r) continue;
    bands.push(o);
    const culture = world.cultures[o.cultureId];
    // About one in four is a fighting man or woman; warlike peoples fight harder.
    strength += o.pop * 0.25 * (0.8 + culture.values.militarism * 0.5);
  }
  return { bands, strength };
}

function losses(world: World, bands: Band[], share: number): number {
  let dead = 0;
  for (const o of bands) {
    const k = Math.min(0.5, share * world.rng.range(0.6, 1.4));
    for (const r in o.races) o.races[r] *= 1 - k;
    dead += o.pop * k;
    o.pop *= 1 - k;
  }
  return dead;
}

const placeOf = (world: World, t: number) => {
  if (isWater(world, t)) return world.map.biome[t] === Biome.Lake ? 'the lakeshore' : 'the coast';
  const key = BIOMES[world.map.biome[t]].name.toLowerCase();
  return world.map.river[t] > 0 ? `the ${key} by the river` : `the ${key}`;
};

/**
 * Clans and their hunting grounds, once a year. A tribe still searching settles on a home range
 * once it finds land rich enough in game and wild food (or after years of looking). Around its
 * home it claims land for its clan, a few tiles a year, until the clan's land there can feed it
 * with room to spare. When it can't grow any more because a neighbouring clan holds the land, it
 * may take it by force: the tribes of both clans close by gather, and the stronger side (with
 * luck, and an edge to those defending their own ground) wins. Winners take the hunting grounds;
 * the losers' tribes nearby are driven out to find land elsewhere. Land no tribe of the clan has
 * used for years falls out of its hands.
 */
function clanLands(world: World): void {
  const map = world.map;
  const rng = world.rng;
  const year = world.year;
  for (const b of world.bands) {
    if (!b.alive) continue;
    const tribe = world.tribes[b.tribeId];
    const need = needOf(world, b);
    if (b.home < 0) {
      b.searching++;
      const g = b.step < b.path.length - 1 ? b.tile : b.ground;
      // How rich is the open land (and the clan's own) around where it is camped?
      let open = 0;
      around(world, g, HOME_R, (t) => {
        const c = map.claim[t];
        if ((c < 0 || c === b.tribeId) && claimable(world, b, t, g)) open += wildYield(world, b, t, true) * SUSTAIN;
      });
      if (b.searching >= SCOUT_YEARS && (open >= need * RANGE_WANT * HOME_GOOD || (b.searching >= SCOUT_YEARS + 4 && open >= need * 0.9))) {
        b.home = g;
        b.searching = 0;
        b.homeSince = year;
        const first = !world.bands.some((o) => o !== b && o.alive && o.tribeId === b.tribeId && o.home >= 0);
        if (first) world.log('tribe', 1, `The ${tribe.name} clan made ${placeOf(world, g)} their hunting grounds.`, { cultures: [b.cultureId] });
      } else continue;
    }
    // Using the land keeps the claim alive.
    around(world, b.home, HOME_R, (t) => {
      if (map.claim[t] === b.tribeId) map.claimSeen[t] = year;
    });
    const want = need * RANGE_WANT;
    let have = homeYield(world, b, b.home);
    if (have >= want) continue;
    // Claim the best open land around home, nearest first.
    const options: [number, number][] = [];
    const hx = b.home % map.width;
    const hy = (b.home - hx) / map.width;
    around(world, b.home, HOME_R, (t) => {
      if (map.claim[t] >= 0 || !claimable(world, b, t, b.home)) return;
      const d = Math.hypot((t % map.width) - hx, Math.floor(t / map.width) - hy);
      if (d > HOME_R + 0.5) return;
      options.push([t, wildYield(world, b, t, true) / (1 + d * 0.3)]);
    });
    options.sort((a, c) => c[1] - a[1]);
    for (let k = 0; k < options.length && k < CLAIM_RATE && have < want; k++) {
      const t = options[k][0];
      map.claim[t] = b.tribeId;
      map.claimSeen[t] = year;
      have += wildYield(world, b, t, true) * SUSTAIN;
    }
    if (have >= want * 0.85 || year - b.homeSince < HOLD_YEARS) continue;
    // Not enough land and none left open: the neighbours' grounds.
    const rivals = new Map<number, number>();
    around(world, b.home, HOME_R, (t) => {
      const c = map.claim[t];
      if (c >= 0 && c !== b.tribeId) rivals.set(c, (rivals.get(c) ?? 0) + wildYield(world, b, t, true));
    });
    if (!rivals.size) continue;
    const enemy = [...rivals.entries()].sort((a, c) => c[1] - a[1])[0][0];
    const foe = world.tribes[enemy];
    const culture = world.cultures[b.cultureId];
    const feud = tribe.feuds[enemy] !== undefined && year - tribe.feuds[enemy] < 30;
    const short = 1 - have / want;
    const p = (0.12 + culture.values.militarism * 0.35 + (b.lastHungry >= 2 ? 0.2 : 0) + (feud ? 0.2 : 0)) * Math.min(1, short * 1.5);
    if (!rng.chance(p)) continue;
    clanFight(world, b, tribe, foe);
  }
  // Claims lapse on land the clan no longer uses, and on land the settled have put to work.
  for (let t = 0; t < map.size; t++) {
    const c = map.claim[t];
    if (c < 0) continue;
    if (map.owner[t] >= 0 || year - map.claimSeen[t] > CLAIM_KEEP) map.claim[t] = -1;
  }
}

/** A fight between two clans over the hunting grounds around a tribe's home. */
function clanFight(world: World, b: Band, tribe: Tribe, foe: Tribe): void {
  const map = world.map;
  const rng = world.rng;
  const at = b.home;
  const us = fightersNear(world, tribe.id, at, HOME_R * 2);
  const them = fightersNear(world, foe.id, at, HOME_R * 2);
  tribe.feuds[foe.id] = world.year;
  foe.feuds[tribe.id] = world.year;
  const take = (winner: Tribe, loser: Tribe, r: number) => {
    let n = 0;
    around(world, at, r, (t) => {
      if (map.claim[t] !== loser.id) return;
      map.claim[t] = winner.id;
      map.claimSeen[t] = world.year;
      n++;
    });
    return n;
  };
  const drive = (bands: Band[]) => {
    for (const o of bands) {
      o.home = -1;
      o.searching = 0;
      chooseGround(world, o, world.season === 'winter', true);
    }
  };
  const where = placeOf(world, at);
  if (them.strength <= 0) {
    // Nobody there to hold it.
    const n = take(tribe, foe, HOME_R);
    if (n >= 6) world.log('tribe', 1, `The ${tribe.name} clan moved into the unguarded hunting grounds of the ${foe.name} clan in ${where}.`, { cultures: [tribe.cultureId, foe.cultureId] });
    return;
  }
  const attack = us.strength * rng.range(0.7, 1.3);
  const defend = them.strength * rng.range(0.7, 1.3) * 1.15;
  const size = us.strength + them.strength;
  const big = size > 120 ? 2 : 1;
  if (attack > defend) {
    const deadThem = losses(world, them.bands, 0.08 + 0.1 * Math.min(1, attack / defend - 1));
    const deadUs = losses(world, us.bands, 0.04);
    take(tribe, foe, HOME_R);
    // Their tribes whose homes lay in the lost land are driven out to look for new hunting grounds.
    const w = map.width;
    const ax = at % w;
    const ay = (at - ax) / w;
    drive(them.bands.filter((o) => o.home >= 0 && Math.max(Math.abs((o.home % w) - ax), Math.abs(Math.floor(o.home / w) - ay)) <= HOME_R + 2));
    tribe.wins++;
    foe.losses++;
    world.log('tribe', big, `The ${tribe.name} clan fought the ${foe.name} clan for the hunting grounds in ${where} and drove them out (${Math.round(deadThem)} of the ${foe.name} and ${Math.round(deadUs)} of the ${tribe.name} fell).`, { cultures: [tribe.cultureId, foe.cultureId] });
  } else {
    const deadUs = losses(world, us.bands, 0.08 + 0.1 * Math.min(1, defend / Math.max(1, attack) - 1));
    const deadThem = losses(world, them.bands, 0.04);
    // The defenders push back into the attackers' nearest land, and the attacking tribe must look elsewhere.
    take(foe, tribe, 2);
    drive([b]);
    foe.wins++;
    tribe.losses++;
    world.log('tribe', big, `The ${foe.name} clan held their hunting grounds in ${where} against the ${tribe.name} clan and threw them back (${Math.round(deadUs)} of the ${tribe.name} and ${Math.round(deadThem)} of the ${foe.name} fell).`, { cultures: [tribe.cultureId, foe.cultureId] });
  }
}
