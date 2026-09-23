import { BIOMES, Relief } from '../data/biomes';
import { Good } from '../data/economy';
import { Noise2D } from '../noise';
import type { Settlement } from '../types';
import type { World } from '../world';
import { killPop } from './politics';

const climateNoise = new WeakMap<World, Noise2D>();

export function runEvents(world: World): void {
  climate(world);
  plague(world);
  disasters(world);
  if (world.cfg.magic > 0) monsters(world);
  greatWorks(world);
  milestones(world);
}

/** Regional weather swings drift across the map over the years: droughts, cold summers, bumper harvests. */
function climate(world: World): void {
  let noise = climateNoise.get(world);
  if (!noise) {
    noise = new Noise2D(world.rng.fork('climate'));
    climateNoise.set(world, noise);
  }
  const y = world.year;
  const global = world.rng.normal() * 0.03;
  const affected = new Map<number, Settlement[]>();
  for (const s of world.aliveSettlements()) {
    const n = noise.fbm(s.x * 0.025 + y * 0.09, s.y * 0.025 - y * 0.06, 3);
    let c = 1 + n * 0.3 + global;
    if (n < -0.45) c -= 0.15; // severe drought
    s.climate = Math.max(0.45, Math.min(1.2, c));
    if (s.climate < 0.75 && s.pop > 1500) {
      const list = affected.get(s.polityId) ?? [];
      list.push(s);
      affected.set(s.polityId, list);
    }
  }
  for (const [pid, list] of affected) {
    const key = `famine:${pid}`;
    if (world.flags.has(key + ':' + Math.floor(world.year / 15))) continue;
    world.flags.add(key + ':' + Math.floor(world.year / 15));
    const p = world.polities[pid];
    const worst = list.reduce((a, b) => (b.pop > a.pop ? b : a));
    world.log('famine', list.length > 2 ? 3 : 2, `${world.rng.pick(['Drought', 'Blight', 'Years of failed rains', 'A cruel frost'])} struck the ${p.name}; the harvest failed around ${worst.name}${list.length > 1 ? ` and ${list.length - 1} other settlement${list.length > 2 ? 's' : ''}` : ''}.`, { polities: [pid], settlements: list.map((s) => s.id) });
  }
}

const PLAGUE_ADJ = ['Grey', 'Red', 'Black', 'Weeping', 'Burning', 'Pale', 'Shaking', 'Sweating', 'Blue', 'Rotting', 'Silent'];
const PLAGUE_NOUN = ['Death', 'Pox', 'Fever', 'Plague', 'Cough', 'Flux', 'Blight', 'Rot'];

/** Epidemics break out in crowded cities and ride the trade routes to their neighbours. */
function plague(world: World): void {
  const rng = world.rng;
  const alive = [...world.aliveSettlements()];
  const spread: [Settlement, number][] = [];
  for (const s of alive) {
    s.immunity = Math.max(0, s.immunity - 0.025);
    if (s.plague <= 0) continue;
    for (const li of s.links) {
      const l = world.links[li];
      const o = world.settlements[l.a === s.id ? l.b : l.a];
      if (!o.alive || o.plague > 0 || o.immunity > 0.3) continue;
      const p = s.plague * 0.5 * Math.min(1, l.volume / 60 + 0.1) * (1 - o.immunity);
      if (rng.chance(p)) spread.push([o, s.plague * 0.85]);
    }
    s.plague *= 0.45;
    if (s.plague < 0.03) s.plague = 0;
  }
  for (const [o, sev] of spread) {
    o.plague = Math.max(o.plague, sev);
    o.immunity = 1;
  }
  for (const s of alive) {
    if (s.pop < 800 || s.plague > 0 || s.immunity > 0.2) continue;
    const san = world.polities[s.polityId].effects.sanitation;
    const chance = 0.0012 * world.cfg.calamity * Math.sqrt(s.pop / 3000) * (1 - Math.min(0.85, san * 0.7));
    if (!rng.chance(chance)) continue;
    s.plague = rng.range(0.45, 1);
    s.immunity = 1;
    const name = `the ${rng.pick(PLAGUE_ADJ)} ${rng.pick(PLAGUE_NOUN)}`;
    world.log('plague', s.pop > 10000 || s.plague > 0.8 ? 3 : 2, `An epidemic, ${name}, broke out in ${s.name} and spread along the roads and sea lanes.`, { settlements: [s.id], polities: [s.polityId] });
  }
}

function disasters(world: World): void {
  const rng = world.rng;
  const cal = world.cfg.calamity;
  for (const s of world.aliveSettlements()) {
    const relief = world.map.relief[s.tile];
    if (relief !== Relief.Flat && rng.chance(0.0006 * cal)) {
      const dead = s.pop * rng.range(0.04, 0.14);
      killPop(s, dead);
      s.housing *= 0.7;
      if (s.pop > 600) world.log('disaster', s.pop > 5000 ? 3 : 2, `An earthquake shook ${s.name}, toppling homes and killing some ${Math.round(dead).toLocaleString('en-US')}.`, { settlements: [s.id], polities: [s.polityId], tile: s.tile });
    }
    if (s.river && rng.chance(0.0012 * cal)) {
      const dead = s.pop * rng.range(0.01, 0.05);
      killPop(s, dead);
      s.stock[Good.Food] *= 0.4;
      if (s.pop > 1500) world.log('disaster', 2, `The river burst its banks at ${s.name}, drowning fields and granaries.`, { settlements: [s.id], polities: [s.polityId], tile: s.tile });
    }
  }
}

const MONSTERS: Record<string, string[]> = {
  mountain: ['a red dragon', 'a clan of hill giants', 'a wyvern brood', 'a stone golem'],
  taiga: ['a pack of dire wolves', 'a werewolf', 'frost trolls'],
  tundra: ['frost giants', 'a white dragon', 'a winter wight'],
  temperateForest: ['a werewolf pack', 'an ancient treant gone mad', 'a green dragon', 'a band of ogres'],
  tropicalForest: ['a giant serpent', 'a black dragon', 'a swarm of stirges'],
  wetland: ['a hydra', 'a hag coven', 'bog wights'],
  desert: ['a sand wurm', 'a blue dragon', 'a mummy lord'],
  grassland: ['a manticore', 'a horde of gnolls', 'a chimera'],
  steppe: ['a roc', 'a horde of gnolls', 'a manticore'],
  savanna: ['a pride of man-eating lions', 'a chimera', 'a roc'],
  coast: ['a sea serpent', 'a kraken', 'raiding sahuagin'],
};

/** In magical worlds, beasts and horrors strike settlements at the edge of the wilds, and heroes rise to meet them. */
function monsters(world: World): void {
  const rng = world.rng;
  for (const s of world.aliveSettlements()) {
    if (s.pop > 6000) continue;
    const chance = 0.0009 * world.cfg.magic * world.cfg.calamity * (s.pop < 1500 ? 1.5 : 1);
    if (!rng.chance(chance)) continue;
    const key = s.coastal && rng.chance(0.4) ? 'coast' : BIOMES[world.map.biome[s.tile]].key;
    const beast = rng.pick(MONSTERS[key] ?? MONSTERS.grassland);
    const culture = world.cultures[s.cultureId];
    if (rng.chance(0.4)) {
      const hero = world.names.person(rng, culture.language);
      s.stability = Math.min(1, s.stability + 0.1);
      world.log('monster', 2, `${beast.charAt(0).toUpperCase() + beast.slice(1)} menaced ${s.name} until the hero ${hero} slew it; songs of ${hero} are sung there still.`, { settlements: [s.id], polities: [s.polityId], cultures: [culture.id] });
    } else {
      const dead = s.pop * rng.range(0.04, 0.18);
      killPop(s, dead);
      s.wealth *= 0.5;
      s.stability -= 0.1;
      world.log('monster', s.pop > 1000 ? 2 : 1, `${beast.charAt(0).toUpperCase() + beast.slice(1)} ravaged ${s.name}, slaying ${Math.round(dead).toLocaleString('en-US')} and carrying off its treasures.`, { settlements: [s.id], polities: [s.polityId] });
    }
  }
}

interface WorkDef {
  name: string;
  tech?: string;
  coastal?: boolean;
  magic?: boolean;
}
const WORKS: WorkDef[] = [
  { name: 'Great Library', tech: 'writing' },
  { name: 'Grand Temple', tech: 'ancestor_worship' },
  { name: 'Colossal Walls', tech: 'masonry' },
  { name: 'Great Lighthouse', tech: 'sailing', coastal: true },
  { name: 'Grand Arena', tech: 'construction' },
  { name: 'Hanging Gardens', tech: 'irrigation' },
  { name: 'Grand Bazaar', tech: 'currency' },
  { name: 'Great Observatory', tech: 'astronomy' },
  { name: 'Aqueduct of the Ages', tech: 'engineering' },
  { name: 'Tower of the Archmagi', tech: 'arcane_lore', magic: true },
  { name: 'Cathedral of the Heavens', tech: 'architecture' },
  { name: 'University', tech: 'printing_press' },
];

/** Rich cities raise monuments that become legends of their own. */
function greatWorks(world: World): void {
  const rng = world.rng;
  for (const s of world.aliveSettlements()) {
    if (s.pop < 6000 || s.wealth < s.pop * 1.2 || s.greatWorks.length >= 3 || !rng.chance(0.03)) continue;
    const p = world.polities[s.polityId];
    const options = WORKS.filter(
      (w) => (!w.tech || p.techs.has(w.tech)) && (!w.coastal || s.coastal) && (!w.magic || world.cfg.magic > 0) && !s.greatWorks.includes(w.name),
    );
    if (!options.length) continue;
    const work = rng.pick(options);
    s.greatWorks.push(work.name);
    s.wealth *= 0.5;
    world.log('wonder', 2, `The ${work.name} of ${s.name} was completed under ${p.ruler.title} ${p.ruler.name} of the ${p.name}.`, { settlements: [s.id], polities: [p.id] });
  }
}

const SIZE_MILESTONES = [5000, 20000, 50000, 100000, 250000, 500000, 1000000];

function milestones(world: World): void {
  for (const s of world.aliveSettlements()) {
    for (const m of SIZE_MILESTONES) {
      if (s.pop < m || world.flags.has(`city:${m}`)) continue;
      world.flags.add(`city:${m}`);
      world.log('milestone', 3, `${s.name} of the ${world.polities[s.polityId].name} became the first city in the world to hold ${m.toLocaleString('en-US')} souls.`, { settlements: [s.id], polities: [s.polityId] });
    }
  }
}
