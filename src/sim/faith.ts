import { FAITH_ORGANIZATION, type Faith, type God, type Library } from '../core/library';
import { cultureFx, cultureOf } from './culture';
import { isFood } from './economy';
import type { Env } from './env';
import { realmName, type NationContext } from './nations';
import type { Clan, HolySite, LiveFaith, Settlement, SimState, Tribe } from './state';
import { DAYS_PER_YEAR } from './state';
import { knows } from './tech';

/**
 * Faiths and the gods (REDESIGN.md 8.4g, Phase 9 step 3).
 *
 * - Every people has a faith from the beginning: a Library faith followed by its culture or
 *   species, or else the folk belief of its homeland (spirits or ancestors, with tenets from the
 *   land: sacred waters by rivers, sacred fire by volcanoes, the sanctity of nature in forests)
 *   whose holy site is its dawn city or a sacred place nearby.
 * - Organization grows from local shamans to shrines, temples and a head of faith as its
 *   followers settle, write and rule (a Library faith grows only as far as it is made to).
 * - Fervour rises with holy sites held and the gods' deeds; falls when they are lost, and with age
 *   in a great hierarchy (corruption).
 * - Spread: a town is drawn to the faith of its neighbours, its trade partners and its ruler
 *   (pushing as hard as the ruler's faith is intolerant, as far as the realm's hold reaches),
 *   resisted by its own faith's fervour, temples and holy places. Tolerant faiths meeting may blend
 *   (syncretism). Far followers of an organized faith may break off in heresy or reformation.
 *   Persecuted towns are less loyal; same-faith realms think better of each other; holy war and
 *   pacifism tenets sharpen or soften their warbands.
 * - The gods are real (unless the world's setting makes religion belief only): each acts as often
 *   as the world's setting and its own activity allow, by its powers (blessings, miracles, omens,
 *   prophecies that come true, champions, appearing in person, proxy wars against a rival god's
 *   followers), favouring its chosen peoples. A god whose rival has just acted is quicker to answer.
 */

export interface FaithContext extends NationContext {}

const COLOURS = ['#e0b84a', '#7d5ba6', '#3f8f8f', '#c4553d', '#5d7fbf', '#8aa04b', '#b06a9a', '#d08b3a', '#4f6d5a', '#9a7b4f', '#6a8fd0', '#c0a0d8'];
export function faithColour(sim: SimState, f: LiveFaith): string {
  if (!f.colour) f.colour = COLOURS[(sim.faiths ?? []).indexOf(f) % COLOURS.length];
  return f.colour;
}
export const faithOf = (sim: SimState, id: string | undefined): LiveFaith | undefined => (id ? sim.faiths?.find((f) => f.id === id) : undefined);
export const ORGANIZATION_WORDS = ['loose (local shamans)', 'gathering (shrines and wise ones)', 'organized (temples and a priesthood)', 'a hierarchy under a head of faith'];
/** How hard a ruler of this faith pushes it on those of other faiths. */
const PUSH: Record<string, number> = { Tolerant: 0.1, Accepting: 0.2, Wary: 0.4, Intolerant: 0.8, Hostile: 1.2 };
/** How much worse a faith's tolerance makes realms of other faiths think of it. */
const ILL_WILL: Record<string, number> = { Tolerant: 0, Accepting: 0.02, Wary: 0.06, Intolerant: 0.15, Hostile: 0.3 };
/** Loyalty lost by a town of another faith under a ruler of this tolerance (persecution). */
const PERSECUTION: Record<string, number> = { Tolerant: 0, Accepting: 0, Wary: 0.05, Intolerant: 0.15, Hostile: 0.25 };
const tolerant = (f: LiveFaith) => f.tolerance === 'Tolerant' || f.tolerance === 'Accepting';
const tenetLevel = (f: LiveFaith | undefined, id: string) => f?.tenets.find((t) => t.id === id)?.level ?? -1;

type Group = Settlement | Tribe;
const live = (sim: SimState) => sim.settlements.filter((s) => !s.ruined);

// ---------------------------------------------------------------------------------------------
// Who follows what

/** A realm's faith: its capital's, or most of its people's. */
export function realmFaith(sim: SimState, clan: Clan | undefined): LiveFaith | undefined {
  if (!clan) return undefined;
  const cap = sim.settlements.find((s) => s.id === clan.realm?.capital && !s.ruined);
  if (cap?.faith) return faithOf(sim, cap.faith);
  const count = new Map<string, number>();
  for (const g of [...live(sim).filter((s) => s.clan === clan.id), ...sim.tribes.filter((t) => t.clan === clan.id)]) if (g.faith) count.set(g.faith, (count.get(g.faith) ?? 0) + g.pop);
  const top = [...count].sort((a, b) => b[1] - a[1])[0];
  return top ? faithOf(sim, top[0]) : undefined;
}

/** The Library faith a group's people follow, if any: one naming its culture (or the culture it grew from), else its species. */
function libraryFaith(sim: SimState, lib: Library, g: Group): Faith | undefined {
  let cu = cultureOf(sim, g.culture);
  for (let guard = 0; cu && guard < 8; guard++) {
    const ids = [cu.id, cu.source].filter(Boolean);
    const f = lib.faiths.find((q) => q.cultures.some((c) => ids.includes(c)));
    if (f) return f;
    cu = cultureOf(sim, cu.parent || cu.blend?.[0] || '');
  }
  return lib.faiths.find((q) => q.species.includes(g.species) && !q.cultures.length);
}

function cellXY(env: Env, k: number): [number, number] {
  return [env.x0 + (k % env.w) * env.step, env.y0 + ((k / env.w) | 0) * env.step];
}
/** The nearest point of a kind of place within reach (km), or null. */
function nearestPlace(c: FaithContext, x: number, y: number, kind: string, reach: number): [number, number] | null {
  const { env } = c;
  const test: Record<string, (k: number) => boolean> = {
    Volcano: (k) => !!env.volcanic[k],
    'Lake or spring': (k) => !!env.fresh[k],
    Mountain: (k) => env.mzone[k] >= 3,
    Grove: (k) => env.cover[k] === 0 || env.cover[k] === 1 || env.cover[k] === 12,
    'Giant tree': (k) => env.cover[k] === 0 || env.cover[k] === 1,
  };
  const t = test[kind];
  if (!t) return null;
  let best: [number, number] | null = null;
  let bd = reach;
  for (let k = 0; k < env.n; k++) {
    if (!env.land[k] || !t(k)) continue;
    const [px, py] = cellXY(env, k);
    const d = c.dist(x, y, px, py);
    if (d < bd) {
      bd = d;
      best = [px, py];
    }
  }
  return best;
}

/** A holy site placed on the map: at its kind of place near the faith's home, or the home itself (a temple city). */
function placeSite(c: FaithContext, name: string, kind: string, home: Group): HolySite {
  const at = nearestPlace(c, home.x, home.y, kind, 400);
  const town = !at ? [...live(c.sim)].sort((a, b) => c.dist(home.x, home.y, a.x, a.y) - c.dist(home.x, home.y, b.x, b.y))[0] : undefined;
  const [x, y] = at ?? (town && c.dist(home.x, home.y, town.x, town.y) < 200 ? [town.x, town.y] : [home.x, home.y]);
  return { name, kind: at ? kind : kind || 'Temple city', x, y, held: true };
}

/** A Library faith brought to life (once), from where its first followers live. */
function liveFromLibrary(c: FaithContext, f: Faith, home: Group): LiveFaith {
  const org = FAITH_ORGANIZATION.indexOf(f.organization as (typeof FAITH_ORGANIZATION)[number]);
  const lf: LiveFaith = {
    id: f.id,
    name: f.name,
    source: f.id,
    nature: [...f.nature],
    tenets: f.tenets.map((t) => ({ ...t })),
    tolerance: f.otherFaiths || 'Wary',
    leader: f.leader,
    organization: 0,
    maxOrganization: org >= 0 ? org : 3,
    gods: [...f.gods],
    hold: f.hold,
    founded: c.sim.day,
    parent: '',
    fervour: 0.5,
    holySites: [],
    seat: -1,
  };
  lf.holySites = f.holySites.map((h) => placeSite(c, h.name || `${f.name} holy place`, h.kind, home));
  return lf;
}

/** The folk belief of a people's homeland: spirits or ancestors, with tenets from the land and its ways. */
function folkFaith(c: FaithContext, g: Group): LiveFaith {
  const { sim, env, lib } = c;
  const cu = cultureOf(sim, g.culture);
  const k = c.cellAt(g.x, g.y);
  const ancestors = !!cu?.traditions.some((t) => t.id === 'ancestor-reverence' && t.level >= 0);
  const near = (kind: string) => !!nearestPlace(c, g.x, g.y, kind, 150);
  const tenets: { id: string; level: number }[] = [];
  const add = (id: string) => {
    if (tenets.length < 3 && lib.tenets.some((t) => t.id === id) && !tenets.some((t) => t.id === id)) tenets.push({ id, level: 0 });
  };
  if (ancestors) add('ancestor-rule');
  if (near('Volcano')) add('sacred-fire');
  if (k >= 0 && (env.fresh[k] || near('Lake or spring'))) add('sacred-waters');
  if (near('Grove')) add('sanctity-of-nature');
  if (cu?.ethos === 'Warlike') add('holy-war');
  if (cu?.traditions.some((t) => t.id === 'hospitality' && t.level >= 0)) add('sacred-hospitality');
  if (tenets.length < 2) add('fertility');
  const fx = cultureFx(sim, g.culture);
  const name = `${cu?.name ?? 'Old'} ${ancestors ? 'ancestor faith' : 'spirit faith'}`;
  // Its holy site: its people's dawn city if they have one, else the sacred place its first tenet looks to.
  const dawn = live(sim).find((s) => s.kind === 'dawn' && s.holyTo.includes(g.race));
  const kind = tenets[0]?.id === 'sacred-fire' ? 'Volcano' : tenets.some((t) => t.id === 'sacred-waters') ? 'Lake or spring' : tenets.some((t) => t.id === 'sanctity-of-nature') ? 'Grove' : 'Mountain';
  const site: HolySite = dawn ? { name: dawn.name, kind: 'Temple city', x: dawn.x, y: dawn.y, held: true } : placeSite(c, `${cu?.name ?? 'The'} sacred place`, kind, g);
  return {
    id: `folk-faith-${g.culture || g.race}-${sim.nextId++}`,
    name,
    source: '',
    nature: [ancestors ? 'Ancestor worship' : 'Animism'],
    tenets,
    tolerance: fx.otherRace > 1.15 ? 'Intolerant' : fx.otherRace < 0.9 ? 'Tolerant' : 'Wary',
    leader: 'No leader (local shamans)',
    organization: 0,
    maxOrganization: 3,
    gods: lib.gods.filter((gd) => gd.favouredSpecies.includes(g.species) || (cu && gd.favouredCultures.some((x) => x === cu.id || x === cu.source))).map((gd) => gd.id),
    hold: '',
    founded: sim.day,
    parent: '',
    fervour: 0.5,
    holySites: [site],
    seat: -1,
  };
}

/** Give every group without a faith one: its clan's, else its people's Library faith, else its culture's folk belief. */
function ensureFaiths(c: FaithContext): void {
  const { sim, lib } = c;
  sim.faiths ??= [];
  for (const g of [...live(sim), ...sim.tribes]) {
    if (g.faith && faithOf(sim, g.faith)) continue;
    const clan = sim.clans.find((q) => q.id === g.clan);
    const lf = libraryFaith(sim, lib, g);
    if (lf) {
      let f = faithOf(sim, lf.id);
      if (!f) {
        f = liveFromLibrary(c, lf, g);
        sim.faiths.push(f);
      }
      g.faith = f.id;
      continue;
    }
    const kin = realmFaith(sim, clan);
    if (kin) {
      g.faith = kin.id;
      continue;
    }
    // One folk belief per culture.
    const cuName = `${cultureOf(sim, g.culture)?.name ?? 'Old'}`;
    const existing = sim.faiths.find((f) => !f.source && !f.parent && !f.blend && (f.name === `${cuName} ancestor faith` || f.name === `${cuName} spirit faith`));
    if (existing) {
      g.faith = existing.id;
      continue;
    }
    const f = folkFaith(c, g);
    sim.faiths.push(f);
    g.faith = f.id;
  }
}

// ---------------------------------------------------------------------------------------------
// The year

const followers = (sim: SimState, f: LiveFaith) => [...live(sim).filter((s) => s.faith === f.id), ...sim.tribes.filter((t) => t.faith === f.id)];

function organizationOf(c: FaithContext, f: LiveFaith, towns: Settlement[]): number {
  const { sim, lib } = c;
  let v = 0;
  if (towns.length) v = 1;
  const townPop = towns.reduce((n, s) => n + s.pop, 0);
  if (v === 1 && townPop >= 1500 && towns.some((s) => knows(lib, s, 'writing'))) v = 2;
  // A head of faith: an organized faith that is a settled realm's.
  if (v === 2 && sim.clans.some((cl) => realmFaith(sim, cl) === f && cl.realm && cl.realm.gov !== 'clan' && cultureOf(sim, cl.culture)?.behaviours.includes('record-keeping'))) v = 3;
  return Math.min(v, f.maxOrganization);
}

function fervourYear(c: FaithContext, f: LiveFaith, towns: Settlement[], members: Group[]): void {
  const { sim } = c;
  // Holy sites: held while followers live within about 40 miles.
  for (const h of f.holySites) {
    const held = members.some((m) => c.dist(m.x, m.y, h.x, h.y) < 65);
    if (held !== h.held) {
      f.fervour = Math.max(0, Math.min(1, f.fervour + (held ? 0.1 : -0.12)));
      c.log(held ? `The ${f.name} hold their holy site ${h.name} again.` : `The ${f.name} have lost their holy site ${h.name}.`, h.x, h.y);
    }
    h.held = held;
  }
  const share = f.holySites.length ? f.holySites.filter((h) => h.held).length / f.holySites.length : 0.5;
  const old = (sim.day - f.founded) / DAYS_PER_YEAR;
  const corrupt = f.organization >= 3 && old > 150 ? 0.12 : 0;
  const target = 0.3 + 0.06 * f.organization + 0.25 * share - corrupt;
  f.fervour += (target - f.fervour) * 0.1;
  f.fervour = Math.max(0.05, Math.min(1, f.fervour));
  // The seat of its head: its greatest town (or a holy temple city).
  if (f.organization >= 3) {
    const seat = towns.find((s) => s.id === f.seat) ?? towns.find((s) => f.holySites.some((h) => h.kind === 'Temple city' && c.dist(h.x, h.y, s.x, s.y) < 10)) ?? [...towns].sort((a, b) => b.pop - a.pop)[0];
    if (seat && seat.id !== f.seat) {
      if (f.seat < 0) c.log(`The ${f.name} now have a head of faith, seated at ${seat.name}.`, seat.x, seat.y);
      f.seat = seat.id;
    }
  } else f.seat = -1;
}

/** A new faith grown from others: a heresy or reformation of one, or a blend of two. */
function offshoot(c: FaithContext, from: LiveFaith[], name: string): LiveFaith {
  const { sim, lib, rand } = c;
  const big = from[0];
  const tenets = from.length > 1 ? [...new Map([...from[0].tenets, ...from[1].tenets].map((t) => [t.id, { ...t }])).values()].slice(0, 3) : big.tenets.map((t) => ({ ...t }));
  if (from.length === 1 && lib.tenets.length) {
    // A heresy changes one belief.
    const others = lib.tenets.filter((t) => !tenets.some((q) => q.id === t.id));
    if (others.length) {
      if (tenets.length >= 3) tenets.splice(Math.floor(rand() * tenets.length), 1);
      tenets.push({ id: others[Math.floor(rand() * others.length)].id, level: 0 });
    }
  }
  const nf: LiveFaith = {
    id: `faith-${sim.nextId++}`,
    name,
    source: '',
    nature: [...new Set(from.flatMap((f) => f.nature))],
    tenets,
    tolerance: from.length > 1 ? 'Accepting' : big.tolerance,
    leader: big.leader,
    organization: Math.min(big.organization, 2),
    maxOrganization: 3,
    gods: [...new Set(from.flatMap((f) => f.gods))],
    hold: '',
    founded: sim.day,
    parent: from.length === 1 ? big.id : '',
    ...(from.length > 1 ? { blend: from.map((f) => f.id) } : {}),
    fervour: from.length > 1 ? 0.5 : 0.7,
    holySites: big.holySites.map((h) => ({ ...h })),
    seat: -1,
  };
  (sim.faiths ??= []).push(nf);
  return nf;
}

/** Conversion: each town is drawn toward the faith with the strongest pull on it. */
function spreadYear(c: FaithContext): void {
  const { sim } = c;
  const towns = live(sim);
  const clans = new Map(sim.clans.map((q) => [q.id, q]));
  const strength = (f: LiveFaith | undefined) => (f ? f.fervour * (1 + 0.5 * f.organization) : 0.3);
  for (const st of towns) {
    const own = faithOf(sim, st.faith);
    if (!own || own.hold === 'Locked') continue;
    const pull = new Map<string, number>();
    const addPull = (id: string | undefined, v: number) => {
      if (id && v > 0) pull.set(id, (pull.get(id) ?? 0) + v);
    };
    for (const o of towns) {
      if (o === st) continue;
      const d = c.dist(st.x, st.y, o.x, o.y);
      if (d > 200) continue;
      addPull(o.faith, (o.pop * strength(faithOf(sim, o.faith))) / (1 + d / 50));
    }
    for (const r of sim.routes) {
      const other = r.a === st.id ? r.b : r.b === st.id ? r.a : -1;
      const o = other >= 0 ? towns.find((q) => q.id === other) : undefined;
      if (o) addPull(o.faith, o.pop * 0.3 * strength(faithOf(sim, o.faith)));
    }
    // Its ruler's faith, pushed as hard as that faith is intolerant, as far as the realm's hold reaches.
    const rf = realmFaith(sim, clans.get(st.clan));
    if (rf && rf !== own) addPull(rf.id, st.pop * 2 * (PUSH[rf.tolerance] ?? 0.4) * (st.control ?? 0.5));
    let mine = (pull.get(own.id) ?? 0) + st.pop * strength(own);
    if (own.holySites.some((h) => c.dist(h.x, h.y, st.x, st.y) < 65)) mine *= 1.5;
    if (own.hold === 'Encouraged') mine *= 2;
    pull.delete(own.id);
    const top = [...pull].sort((a, b) => b[1] - a[1])[0];
    if (!top) {
      if (st.faithShift) st.faithShift.progress -= 0.05;
      if (st.faithShift && st.faithShift.progress <= 0) delete st.faithShift;
      continue;
    }
    const share = top[1] / (top[1] + mine);
    if (share < 0.4) {
      if (st.faithShift) st.faithShift.progress = Math.max(0, st.faithShift.progress - 0.03);
      continue;
    }
    if (!st.faithShift || st.faithShift.to !== top[0]) st.faithShift = { to: top[0], progress: 0 };
    st.faithShift.progress += 0.12 * (share - 0.35);
    if (st.faithShift.progress < 1) continue;
    let to = faithOf(sim, top[0])!;
    delete st.faithShift;
    // Two tolerant faiths meeting may blend into one.
    if (tolerant(own) && tolerant(to) && c.rand() < 0.25) {
      const both = [own.id, to.id].sort().join('|');
      const blend = sim.faiths!.find((f) => f.blend && [...f.blend].sort().join('|') === both) ?? offshoot(c, [to, own], `${to.name.split(' ')[0]}-${own.name.split(' ')[0]} faith`);
      if (blend.founded === sim.day) c.log(`In ${st.name} the ${own.name} and the ${to.name} have blended into one faith: the ${blend.name}.`, st.x, st.y);
      to = blend;
    } else if (st.pop >= 300 || st.id === clans.get(st.clan)?.realm?.capital) c.log(`${st.name} has turned from the ${own.name} to the ${to.name}.`, st.x, st.y);
    const wasCapital = clans.get(st.clan)?.realm?.capital === st.id;
    st.faith = to.id;
    if (wasCapital) {
      const cl = clans.get(st.clan)!;
      c.log(`${realmName(c.lib, cl)} has taken up the ${to.name}.`, st.x, st.y);
    }
  }
  // Roaming tribes follow their realm's faith in time.
  for (const t of sim.tribes) {
    const rf = realmFaith(sim, clans.get(t.clan));
    if (rf && t.faith !== rf.id && faithOf(sim, t.faith)?.hold !== 'Locked' && c.rand() < 0.08) t.faith = rf.id;
  }
}

/** Far followers of an organized faith, its fervour waning, may break off: a heresy, or (where the faith has grown cold) a reformation. */
function splitsYear(c: FaithContext): void {
  const { sim } = c;
  for (const f of [...(sim.faiths ?? [])]) {
    if (f.organization < 2 || f.hold === 'Locked' || sim.day - f.founded < 50 * DAYS_PER_YEAR) continue;
    const towns = live(sim).filter((s) => s.faith === f.id);
    if (towns.length < 4) continue;
    const seat = towns.find((s) => s.id === f.seat) ?? [...towns].sort((a, b) => b.pop - a.pop)[0];
    const far = towns.filter((s) => c.dist(s.x, s.y, seat.x, seat.y) > 500);
    const pop = far.reduce((n, s) => n + s.pop, 0);
    if (pop < 1000 || c.rand() >= 0.02 * (1 + 2 * Math.max(0, 0.5 - f.fervour))) continue;
    const lead = [...far].sort((a, b) => b.pop - a.pop)[0];
    const reform = f.fervour < 0.35;
    const nf = offshoot(c, [f], reform ? `Reformed ${f.name}` : `${f.name} of ${lead.name}`);
    // Its own holy place: the town where it began.
    nf.holySites = [{ name: lead.name, kind: 'Temple city', x: lead.x, y: lead.y, held: true }];
    const group = far.filter((s) => c.dist(s.x, s.y, lead.x, lead.y) < 250);
    for (const s of group) s.faith = nf.id;
    for (const t of sim.tribes) if (t.faith === f.id && c.dist(t.x, t.y, lead.x, lead.y) < 250) t.faith = nf.id;
    c.log(reform ? `A reformation in ${lead.name}: far from its cold seat, the ${f.name} has been renewed as the ${nf.name}.` : `A heresy in ${lead.name}: the ${nf.name} has broken from the ${f.name}.`, lead.x, lead.y);
  }
}

// ---------------------------------------------------------------------------------------------
// The gods

const FLAVOUR: Record<string, string> = {
  Harvest: 'a great harvest',
  Sea: 'nets full to breaking',
  'Life and healing': 'healing and many births',
  War: 'strength in its warriors',
  Trade: 'rich trade',
  'Hearth and home': 'warm hearths and full stores',
  'Nature and beasts': 'game in plenty',
  Sun: 'a long bright summer',
};

function godsYear(c: FaithContext): void {
  const { sim, lib, rand } = c;
  if (sim.gods && !sim.gods.active) return;
  const world = (sim.gods?.activity ?? 50) / 100;
  sim.godActs ??= {};
  sim.champions = (sim.champions ?? []).filter((ch) => ch.until > sim.day && sim.clans.some((q) => q.id === ch.clan));
  // Prophecies come true (or are forgotten).
  for (const p of [...(sim.prophecies ?? [])]) {
    const clan = sim.clans.find((q) => q.id === p.clan);
    const god = lib.gods.find((g) => g.id === p.god);
    if (!clan || clan.realm?.ruler.house !== p.house) {
      c.log(`The prophecy of ${god?.name ?? 'a god'} has come true: the house of ${p.house} has fallen${clan ? ` in ${realmName(lib, clan)}` : ''}.`);
      const f = (sim.faiths ?? []).find((q) => q.gods.includes(p.god));
      if (f) f.fervour = Math.min(1, f.fervour + 0.1);
      sim.prophecies = sim.prophecies!.filter((q) => q !== p);
    } else if (p.until < sim.day) sim.prophecies = sim.prophecies!.filter((q) => q !== p);
  }
  for (const god of lib.gods) {
    const faiths = (sim.faiths ?? []).filter((f) => f.gods.includes(god.id));
    if (!faiths.length) continue;
    // Games between gods: one whose rival has just acted is quicker to answer.
    const provoked = god.rivals.some((r) => sim.day - (sim.godActs![r] ?? -1e9) < DAYS_PER_YEAR);
    const p = 0.25 * world * ((god.activity ?? 3) / 3) * (provoked ? 1.5 : 1);
    if (rand() >= p) continue;
    if (act(c, god, faiths)) sim.godActs[god.id] = sim.day;
  }
}

/** The places a god favours most: its faiths' towns, its favoured peoples first. */
function favourite(c: FaithContext, god: God, faiths: LiveFaith[], pick?: (s: Settlement) => boolean): Settlement | undefined {
  const { sim, rand } = c;
  const ids = new Set(faiths.map((f) => f.id));
  const towns = live(sim).filter((s) => ids.has(s.faith ?? '') && (!pick || pick(s)));
  if (!towns.length) return undefined;
  const fav = towns.filter((s) => god.favouredSpecies.includes(s.species) || god.favouredCultures.some((x) => x === s.culture || x === cultureOf(sim, s.culture)?.source));
  const pool = fav.length ? fav : towns;
  return pool[Math.floor(rand() * pool.length)];
}

function act(c: FaithContext, god: God, faiths: LiveFaith[]): boolean {
  const { sim, lib, rand, env } = c;
  const powers = god.powers.length ? god.powers : ['Blessings', 'Omens and visions'];
  const power = powers[Math.floor(rand() * powers.length)];
  const faithIn = (st: Settlement) => faiths.find((f) => f.id === st.faith) ?? faiths[0];
  const realmOf = (st: Settlement) => sim.clans.find((q) => q.id === st.clan);
  const food = (st: Settlement, months: number) => {
    const S = st.economy?.stores;
    if (!S) return;
    const id = Object.keys(S).filter((k) => isFood(env, k)).sort((a, b) => S[b] - S[a])[0] ?? st.economy!.cropId;
    if (id) S[id] = (S[id] ?? 0) + st.pop * months;
  };
  switch (power) {
    case 'Blessings': {
      const st = favourite(c, god, faiths);
      if (!st) return false;
      const domain = god.domains.find((d) => FLAVOUR[d]) ?? '';
      if (domain === 'War') st.warband *= 1.2;
      else if (domain === 'Life and healing') st.pop *= 1.05;
      else food(st, 3);
      c.log(`${god.name} blessed ${st.name} with ${FLAVOUR[domain] ?? 'good fortune'}.`, st.x, st.y);
      return true;
    }
    case 'Miracles': {
      const st = favourite(c, god, faiths, (s) => s.fed < 0.85) ?? favourite(c, god, faiths);
      if (!st) return false;
      const f = faithIn(st);
      food(st, 6);
      st.fed = Math.max(st.fed, 1);
      f.fervour = Math.min(1, f.fervour + 0.08);
      // Word spreads: neighbours of other faiths are drawn to it.
      for (const o of live(sim)) if (o.faith !== f.id && c.dist(o.x, o.y, st.x, st.y) < 150) o.faithShift = { to: f.id, progress: (o.faithShift?.to === f.id ? o.faithShift.progress : 0) + 0.15 };
      c.log(`A miracle of ${god.name} in ${st.name}: food where there was none. The ${f.name} burn brighter.`, st.x, st.y);
      return true;
    }
    case 'Omens and visions': {
      const st = favourite(c, god, faiths);
      if (!st) return false;
      faithIn(st).fervour = Math.min(1, faithIn(st).fervour + 0.04);
      c.log(`Omens of ${god.name} were seen over ${st.name}.`, st.x, st.y);
      return true;
    }
    case 'Prophecies that come true': {
      // It foretells the fall of a ruling house: one of a rival god's faith if it can, else any in reach of its followers.
      const st = favourite(c, god, faiths);
      if (!st) return false;
      const rivalFaiths = new Set((sim.faiths ?? []).filter((f) => f.gods.some((g) => god.rivals.includes(g))).map((f) => f.id));
      // Only a ruling line that is handed down can be foretold to fall.
      const lined = (q: Clan) => {
        const g = lib.governments.find((x) => x.id === q.realm?.gov);
        return !!g && (g.succession.startsWith('Hereditary') || g.legitimacy === 'True line / sacred blood');
      };
      const near = sim.clans.filter((q) => q.realm && q.id !== st.clan && lined(q) && live(sim).some((s) => s.clan === q.id && c.dist(s.x, s.y, st.x, st.y) < 400));
      const target = near.find((q) => rivalFaiths.has(realmFaith(sim, q)?.id ?? '')) ?? near[Math.floor(rand() * near.length)];
      if (!target || sim.prophecies?.some((p) => p.clan === target.id)) return false;
      (sim.prophecies ??= []).push({ god: god.id, clan: target.id, house: target.realm!.ruler.house, until: sim.day + 40 * DAYS_PER_YEAR });
      // Fate is helped along: a claimant arises.
      (target.realm!.claimants ??= []).push({ name: c.name(target.culture), house: c.name(target.culture), female: rand() < 0.5, born: sim.day - 25 * DAYS_PER_YEAR, why: 'heir', backing: 0.3, since: sim.day });
      c.log(`${god.name} spoke through the priests of ${st.name}: the house of ${target.realm!.ruler.house} of ${realmName(lib, target)} will fall.`, st.x, st.y);
      return true;
    }
    case 'Choosing champions':
    case 'Raising heroes': {
      const st = favourite(c, god, faiths, (s) => !!realmOf(s)?.realm);
      const clan = st && realmOf(st);
      if (!st || !clan || sim.champions?.some((ch) => ch.clan === clan.id && ch.god === god.id)) return false;
      const name = c.name(st.culture);
      (sim.champions ??= []).push({ name, god: god.id, clan: clan.id, since: sim.day, until: sim.day + 30 * DAYS_PER_YEAR });
      faithIn(st).fervour = Math.min(1, faithIn(st).fervour + 0.05);
      c.log(`${god.name} raised ${name} of ${st.name} as ${power === 'Choosing champions' ? 'its champion' : 'a hero'}: the warriors of ${realmName(lib, clan)} fight the harder for it.`, st.x, st.y);
      return true;
    }
    case 'Appearing in person': {
      if (rand() >= 0.25) return false;
      const st = favourite(c, god, faiths);
      if (!st) return false;
      const f = faithIn(st);
      f.fervour = Math.min(1, f.fervour + 0.2);
      for (const o of live(sim)) if (o.faith !== f.id && c.dist(o.x, o.y, st.x, st.y) < 250) o.faithShift = { to: f.id, progress: (o.faithShift?.to === f.id ? o.faithShift.progress : 0) + 0.3 };
      c.log(`${god.name} walked among the people of ${st.name}. Word of it spreads far.`, st.x, st.y);
      return true;
    }
    case 'Proxy wars through followers': {
      const rivals = (sim.faiths ?? []).filter((f) => f.gods.some((g) => god.rivals.includes(g)));
      if (!rivals.length) return false;
      const mine = sim.clans.filter((q) => faiths.includes(realmFaith(sim, q)!));
      const theirs = sim.clans.filter((q) => rivals.includes(realmFaith(sim, q)!));
      for (const A of mine) for (const B of theirs) {
        const k = A.id < B.id ? `${A.id}|${B.id}` : `${B.id}|${A.id}`;
        const rel = sim.realmRelations?.[k];
        if (!rel) continue;
        rel.memory = Math.max(-1, rel.memory - 0.3);
        rel.hostileUntil = Math.max(rel.hostileUntil ?? 0, sim.day + 2 * DAYS_PER_YEAR);
        const rg = lib.gods.find((g) => god.rivals.includes(g.id) && realmFaith(sim, B)?.gods.includes(g.id));
        c.log(`${god.name} stirs ${realmName(lib, A)} against ${realmName(lib, B)}${rg ? `, who worship its rival ${rg.name}` : ''}.`);
        return true;
      }
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Effects used elsewhere

/** Loyalty a town loses for being of another faith than its realm's (more under an intolerant ruler). */
export function faithLoyalty(sim: SimState, clan: Clan, st: Settlement): number {
  const rf = realmFaith(sim, clan);
  if (!rf || !st.faith || st.faith === rf.id) return 0;
  return 0.05 + (PERSECUTION[rf.tolerance] ?? 0.05);
}
/** How faith colours two realms' opinion of each other. */
export function faithOpinion(sim: SimState, a: Clan, b: Clan): number {
  const fa = realmFaith(sim, a);
  const fb = realmFaith(sim, b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 0.15;
  const kin = fa.parent === fb.id || fb.parent === fa.id || !!fa.blend?.includes(fb.id) || !!fb.blend?.includes(fa.id);
  let v = (kin ? 0.05 : 0) - (ILL_WILL[fa.tolerance] ?? 0.06) - (ILL_WILL[fb.tolerance] ?? 0.06);
  if (tenetLevel(fa, 'sacred-hospitality') >= 0 || tenetLevel(fb, 'sacred-hospitality') >= 0) v += 0.05;
  if (tenetLevel(fa, 'purity') >= 0 || tenetLevel(fb, 'purity') >= 0) v -= 0.1;
  return v;
}
/** How a group's faith sharpens or softens its readiness to fight those of another faith (holy war, pacifism). */
export function faithHostility(sim: SimState, a: string | undefined, b: string | undefined): number {
  const fa = faithOf(sim, a);
  let h = 1;
  const pac = tenetLevel(fa, 'pacifism');
  if (pac >= 0) h *= 0.7 - 0.25 * pac;
  if (a && b && a !== b) {
    const hw = tenetLevel(fa, 'holy-war');
    if (hw >= 0) h *= 1.3 + 0.4 * hw;
  }
  return h;
}
/** A realm's warriors fight harder with a god's champion among them. */
export const championMight = (sim: SimState, clan: number) => (sim.champions?.some((ch) => ch.clan === clan && ch.until > sim.day) ? 1.25 : 1);

/** The year for faiths and gods. */
export function faithYear(c: FaithContext): void {
  const { sim } = c;
  ensureFaiths(c);
  const towns = live(sim);
  for (const f of sim.faiths ?? []) {
    const mine = towns.filter((s) => s.faith === f.id);
    const members = followers(sim, f);
    const org = organizationOf(c, f, mine);
    if (org > f.organization) {
      f.organization = org;
      // A folk belief gains priests as it organizes.
      if (!f.source && f.leader === 'No leader (local shamans)' && org >= 2) f.leader = 'Council of priests';
      if (!f.source && f.leader === 'Council of priests' && org >= 3) f.leader = 'High priest';
      const at = [...mine].sort((a, b) => b.pop - a.pop)[0];
      if (org >= 2) c.log(`The ${f.name} ${org === 2 ? 'now have temples and a priesthood' : 'have grown into a hierarchy'}.`, at?.x, at?.y);
    } else if (org < f.organization) f.organization = org;
    fervourYear(c, f, mine, members);
  }
  spreadYear(c);
  splitsYear(c);
  godsYear(c);
  // Faiths with no one left are remembered no more.
  const used = new Set([...towns.map((s) => s.faith), ...sim.tribes.map((t) => t.faith)]);
  sim.faiths = (sim.faiths ?? []).filter((f) => used.has(f.id) || (sim.faiths ?? []).some((o) => o.parent === f.id && used.has(o.id)));
}
