import type { Library } from '../core/library';
import { COVER_BRUSHES } from '../core/paint';
import type { Env } from './env';
import type { LiveCulture, Settlement, SimState } from './state';

/**
 * A culture as a bundle of traits (REDESIGN.md, "Cultures as peoples", step 2).
 *
 * Six kinds of trait, each changing at its own speed (step 3 moves pops by them):
 * - material culture (building, dress, food): fast, within a generation;
 * - customs and the ways of life: decades;
 * - law and kinship: decades;
 * - values (its ethos, and who fights): slower;
 * - religion (its people's main faith): slow, decades to centuries, needing neighbours who hold it;
 * - language: slowest, mostly at births (about three generations for a people under another).
 *
 * Core traits (identity: language, religion, law and kinship, values, its customs) cost a region
 * dear to differ in; regional traits (way of life: the ways of the land and of work, material
 * culture) are expected to vary from place to place.
 *
 * Cultures sit in a tree: a family (the root of its parent links) → a culture → its subcultures
 * (regions grown apart, step 3 of the regional cultures). Similarity between two cultures is read
 * from how near they are in the tree and how many traits they share.
 */

export type TraitKind = 'material' | 'customs' | 'ways' | 'law' | 'values' | 'religion' | 'language';

export interface TraitInfo {
  kind: TraitKind;
  name: string;
  /** Core (identity) or regional (way of life). */
  core: boolean;
  /** About how many years a people takes to change it under steady pressure. */
  years: number;
  speed: string;
  how: string;
}

export const TRAITS: TraitInfo[] = [
  { kind: 'material', name: 'Material culture', core: false, years: 20, speed: 'fast (within a generation)', how: 'copied from whoever looks successful' },
  { kind: 'ways', name: 'Ways of life', core: false, years: 40, speed: 'decades', how: 'shaped by the land and the work' },
  { kind: 'customs', name: 'Customs', core: true, years: 40, speed: 'decades', how: 'copied from neighbours and the powerful' },
  { kind: 'law', name: 'Law and kinship', core: true, years: 50, speed: 'decades', how: 'set by rulers and custom' },
  { kind: 'values', name: 'Values', core: true, years: 80, speed: 'generations', how: 'passed parent to child' },
  { kind: 'religion', name: 'Religion', core: true, years: 120, speed: 'slow (decades to centuries)', how: 'needs believers nearby to take hold' },
  { kind: 'language', name: 'Language', core: true, years: 90, speed: 'slowest (about three generations)', how: 'mostly at births: children take up the main tongue' },
];
export const traitInfo = (kind: TraitKind) => TRAITS.find((t) => t.kind === kind)!;

/** Tradition categories that are ways of life (regional); the rest are customs (core). */
const WAY_CATEGORIES = new Set(['Land and living', 'Work and trade']);
export const isWay = (lib: Library, id: string) => WAY_CATEGORIES.has(lib.traditions.find((t) => t.id === id)?.category ?? '');

export interface Material {
  building: string;
  dress: string;
  food: string;
}

/** A culture's traits, gathered from what it holds. */
export interface Bundle {
  language: string;
  religion: string;
  customs: string[];
  ways: string[];
  material: Material;
  law: string;
  kinship: string;
  values: string;
  fighting: string;
}

export function bundleOf(lib: Library, cu: LiveCulture): Bundle {
  const held = cu.traditions.filter((t) => t.level >= 0).map((t) => t.id);
  return {
    language: cu.language || cu.name,
    religion: cu.faith ?? '',
    customs: held.filter((id) => !isWay(lib, id)),
    ways: held.filter((id) => isWay(lib, id)),
    material: cu.material ?? { building: '', dress: '', food: '' },
    law: cu.law ?? lawOf(cu),
    kinship: cu.kinship ?? kinshipOf(cu),
    values: cu.ethos,
    fighting: cu.martial,
  };
}

/** Its law, from what it has learned (written law, a council of clan heads, the elders' spoken law). */
export function lawOf(cu: LiveCulture, government?: string): string {
  if (government && government !== 'Custom') return government;
  if (cu.behaviours.includes('written-law')) return 'Written law';
  if (cu.behaviours.includes('tribal-council')) return 'Tribal council';
  return 'Custom of the elders';
}

/** How it reckons kin: by clan where clan loyalty runs deep, else by the wider family, or the household in great towns. */
export function kinshipOf(cu: LiveCulture, cityShare = 0): string {
  const clan = cu.traditions.find((t) => t.id === 'clan-loyalty' && t.level >= 0);
  if (clan) return clan.level >= 1 ? 'Clan above all' : 'Clans';
  return cityShare > 0.5 ? 'Households' : 'Extended families';
}

// ---- Material culture, from where and how a people lives.

type Vote = Map<string, number>;
const vote = (m: Vote, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m: Vote) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

function buildingAt(env: Env, k: number, moving: boolean, stone: boolean, layer?: string): string {
  if (layer === 'underdark') return 'Carved stone halls';
  if (layer === 'canopy') return 'Houses in the trees';
  if (layer?.startsWith('sky')) return 'Light timber and cloth';
  if (moving) return 'Tents of hide and felt';
  const cover = k >= 0 && env.cover[k] >= 0 ? COVER_BRUSHES[env.cover[k]] : '';
  const hot = k >= 0 ? Math.max(env.temp[0][k], env.temp[1][k]) > 26 : false;
  if (k >= 0 && env.mzone[k] >= 1) return stone ? 'Cut stone' : 'Fieldstone';
  if (['dunes', 'rockdesert', 'badlands', 'saltflats', 'scrub', 'savanna'].includes(cover)) return stone ? 'Cut stone' : 'Mud brick';
  if (['forest', 'taiga'].includes(cover)) return 'Timber halls';
  if (cover === 'jungle' || cover === 'marsh' || (hot && k >= 0 && (env.coast[k] === 1 || env.fresh[k] === 1))) return 'Reed and thatch';
  if (['tundra', 'glacier'].includes(cover)) return 'Turf and stone';
  return stone ? 'Cut stone' : 'Wattle and daub';
}
function dressAt(env: Env, k: number): string {
  if (k < 0) return 'Wool and linen';
  const cold = Math.min(env.temp[0][k], env.temp[1][k]);
  const hot = Math.max(env.temp[0][k], env.temp[1][k]);
  if (cold < -5) return 'Furs and hides';
  if (cold < 4) return 'Wool and fur';
  if (hot > 27) return 'Light cotton and linen';
  return 'Wool and linen';
}
function foodOf(env: Env, st: Settlement): string {
  const jobs = st.economy?.jobs ?? {};
  const by: Vote = new Map();
  for (const [key, n] of Object.entries(jobs)) {
    if (key.startsWith('farm:')) vote(by, `Bread and porridge (${resName(env, key.slice(5))})`, n);
    else if (key.startsWith('fish:')) vote(by, 'Fish', n);
    else if (key.startsWith('herd:')) vote(by, `Meat and milk (${resName(env, key.slice(5))})`, n);
    else if (key === 'hunt' || key === 'gather') vote(by, 'Game and wild plants', n);
  }
  return top(by) || 'Game and wild plants';
}
const resName = (env: Env, id: string) => (env.resInfo.find((r) => r.id === id)?.name ?? id).toLowerCase();

export interface TraitsContext {
  sim: SimState;
  env: Env;
  lib: Library;
  /** The climate point a place stands on (its nearest land point), or −1. */
  cellOf(x: number, y: number): number;
  /** Whether a settlement knows a technology. */
  knows(st: Settlement, id: string): boolean;
  /** A clan's government's law ('' none). */
  lawOfClan(clan: number): string;
  /** Whether a settlement is a town or city (for kinship). */
  isTown(st: Settlement): boolean;
}

/**
 * Once a year: each culture's traits as its people live now: its material culture (what most of
 * its people build with, wear and eat), its religion (its people's main faith), law and kinship.
 */
export function traitsYear(c: TraitsContext): void {
  const { sim, env } = c;
  for (const cu of sim.cultures ?? []) {
    const building: Vote = new Map();
    const dress: Vote = new Map();
    const food: Vote = new Map();
    const faith: Vote = new Map();
    const law: Vote = new Map();
    let people = 0;
    let townPeople = 0;
    for (const st of sim.settlements) {
      if (st.ruined || st.culture !== cu.id) continue;
      const k = c.cellOf(st.x, st.y);
      vote(building, buildingAt(env, k, false, c.knows(st, 'masonry'), st.layer), st.pop);
      vote(dress, dressAt(env, k), st.pop);
      vote(food, foodOf(env, st), st.pop);
      const gl = c.lawOfClan(st.clan);
      if (gl) vote(law, gl, st.pop);
      people += st.pop;
      if (c.isTown(st)) townPeople += st.pop;
    }
    for (const t of sim.tribes) {
      if (t.culture !== cu.id) continue;
      const k = c.cellOf(t.x, t.y);
      vote(building, buildingAt(env, k, true, false), t.pop);
      vote(dress, dressAt(env, k), t.pop);
      vote(food, 'Game and wild plants', t.pop);
      people += t.pop;
    }
    // Its religion: the main faith among all its people (towns, tribes and the wild).
    const pops = [...sim.settlements.filter((s) => !s.ruined).flatMap((s) => s.pops ?? []), ...sim.tribes.flatMap((t) => t.pops ?? []), ...Object.values(sim.country ?? {}).flat()];
    for (const q of pops) if (q.culture === cu.id && q.faith) vote(faith, q.faith, q.n);
    if (!people) continue;
    cu.material = { building: top(building), dress: top(dress), food: top(food) };
    const f = top(faith);
    if (f) cu.faith = f;
    cu.law = lawOf(cu, top(law));
    cu.kinship = kinshipOf(cu, townPeople / people);
  }
}

// ---- The tree, and how alike two cultures are.

/** A culture's family: its root, and every culture that shares it. */
export function rootOf(cultures: LiveCulture[], cu: LiveCulture): LiveCulture {
  const byId = new Map(cultures.map((q) => [q.id, q]));
  let r = cu;
  for (let i = 0; i < 20 && r.parent && byId.has(r.parent); i++) r = byId.get(r.parent)!;
  return r;
}
/** Its level in the tree: a subculture (a region grown apart from its parent) or a culture. */
export const levelOf = (cu: LiveCulture): 'subculture' | 'culture' => (cu.sister?.length ? 'subculture' : 'culture');
/** The family's name ("the Toral family"), from its root. */
export const familyName = (cultures: LiveCulture[], cu: LiveCulture) => `the ${rootOf(cultures, cu).name} family`;

/** How near two cultures are in the tree: the same 1, parent and child 0.75, sisters 0.6, one family 0.4, else 0. */
export function treeNearness(cultures: LiveCulture[], a: LiveCulture, b: LiveCulture): number {
  if (a.id === b.id) return 1;
  if (a.parent === b.id || b.parent === a.id || a.blend?.includes(b.id) || b.blend?.includes(a.id)) return 0.75;
  if (a.parent && a.parent === b.parent) return 0.6;
  return rootOf(cultures, a) === rootOf(cultures, b) ? 0.4 : 0;
}

const jaccard = (a: string[], b: string[]) => {
  if (!a.length && !b.length) return 1;
  const B = new Set(b);
  const both = a.filter((x) => B.has(x)).length;
  return both / (a.length + b.length - both);
};

/** How many of their traits two cultures share (0–1), the core ones weighing most. */
export function traitOverlap(lib: Library, a: LiveCulture, b: LiveCulture): number {
  const A = bundleOf(lib, a);
  const B = bundleOf(lib, b);
  const eq = (x: string, y: string) => (x && x === y ? 1 : 0);
  const mat = (eq(A.material.building, B.material.building) + eq(A.material.dress, B.material.dress) + eq(A.material.food, B.material.food)) / 3;
  return 0.25 * eq(A.language, B.language) + 0.15 * eq(A.religion, B.religion) + 0.1 * eq(A.values, B.values) + 0.1 * eq(A.law, B.law) + 0.05 * eq(A.kinship, B.kinship) + 0.15 * jaccard(A.customs, B.customs) + 0.05 * jaccard(A.ways, B.ways) + 0.15 * mat;
}

/** How alike two cultures are (0–1): a third from the tree, two thirds from their traits. */
export function similarity(lib: Library, cultures: LiveCulture[], a: LiveCulture, b: LiveCulture): number {
  if (a.id === b.id) return 1;
  return 0.35 * treeNearness(cultures, a, b) + 0.65 * traitOverlap(lib, a, b);
}
