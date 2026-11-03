import type { Env } from './env';
import { bindProvinces } from './land';
import type { SimState } from './state';

/**
 * The simulation as it is saved with the world. The fields over the land are packed small:
 * claims as runs of the same clan, and each beast as how full its land is (0–255 of what the
 * land carries), also in runs, since most land is either untouched or the same.
 */
export interface PackedSim {
  v: 1;
  day: number;
  seed: number;
  started: boolean;
  nextId: number;
  w: number;
  h: number;
  tribes: SimState['tribes'];
  settlements?: SimState['settlements'];
  grudges?: SimState['grudges'];
  caravans?: SimState['caravans'];
  routes?: SimState['routes'];
  traffic?: number[];
  firsts?: SimState['firsts'];
  cultures?: SimState['cultures'];
  relations?: SimState['relations'];
  way?: number[];
  wayKeeper?: number[];
  bridge?: number[];
  realmRelations?: SimState['realmRelations'];
  spies?: SimState['spies'];
  faiths?: SimState['faiths'];
  champions?: SimState['champions'];
  prophecies?: SimState['prophecies'];
  godActs?: SimState['godActs'];
  wars?: SimState['wars'];
  armies?: SimState['armies'];
  battles?: SimState['battles'];
  rifts?: SimState['rifts'];
  tides?: SimState['tides'];
  hordes?: SimState['hordes'];
  /** Runs of corruption in hundredths. */
  corruption?: number[];
  clans: SimState['clans'];
  sorties: SimState['sorties'];
  events: SimState['events'];
  setup: SimState['setup'];
  /** Runs: value, count, value, count… */
  owner: number[];
  rival: number[];
  rivalUse: number[];
  /** Land by province: runs of the ids' steps (each id less the one before), then runs of holder, rival and rival use. */
  provIds?: number[];
  provOwner?: number[];
  provRival?: number[];
  provRivalUse?: number[];
  beasts: Record<string, number[]>;
}

function runs(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  let v = values.length ? values[0] : 0;
  let c = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === v) c++;
    else {
      out.push(v, c);
      v = values[i];
      c = 1;
    }
  }
  if (c) out.push(v, c);
  return out;
}
function unruns(r: unknown, n: number, into: { [i: number]: number; length: number }): boolean {
  if (!Array.isArray(r)) return false;
  let i = 0;
  for (let q = 0; q + 1 < r.length; q += 2) {
    const v = Number(r[q]);
    const c = Number(r[q + 1]);
    if (!Number.isFinite(v) || !(c >= 0) || i + c > n) return false;
    for (let e = i + c; i < e; i++) into[i] = v;
  }
  return i === n;
}

export function packSim(sim: SimState, env: Env | null): PackedSim {
  const beasts: Record<string, number[]> = {};
  for (const [id, D] of Object.entries(sim.beasts)) {
    const K = env?.beastK[id];
    const q = new Uint8Array(D.length);
    for (let k = 0; k < D.length; k++) {
      const cap = K ? K[k] : 1;
      q[k] = cap > 0 ? Math.max(0, Math.min(255, Math.round((D[k] / cap) * 255))) : 0;
    }
    beasts[id] = runs(q);
  }
  return {
    v: 1,
    day: sim.day,
    seed: sim.seed,
    started: sim.started,
    nextId: sim.nextId,
    w: sim.w,
    h: sim.h,
    tribes: sim.tribes,
    settlements: sim.settlements,
    grudges: sim.grudges,
    caravans: sim.caravans,
    firsts: sim.firsts ?? {},
    cultures: sim.cultures ?? [],
    relations: sim.relations ?? {},
    routes: sim.routes,
    traffic: runs(Float32Array.from(sim.traffic, (v) => Math.round(v * 10) / 10)),
    way: runs(sim.way),
    wayKeeper: runs(sim.wayKeeper),
    bridge: runs(sim.bridge ?? new Uint8Array(sim.way.length)),
    realmRelations: sim.realmRelations ?? {},
    spies: sim.spies ?? [],
    faiths: sim.faiths ?? [],
    champions: sim.champions ?? [],
    prophecies: sim.prophecies ?? [],
    godActs: sim.godActs ?? {},
    wars: sim.wars ?? [],
    armies: sim.armies ?? [],
    battles: sim.battles ?? [],
    rifts: sim.rifts ?? [],
    tides: sim.tides ?? [],
    hordes: sim.hordes ?? [],
    ...(sim.corruption ? { corruption: runs(Float32Array.from(sim.corruption, (v) => Math.round(v * 100))) } : {}),
    clans: sim.clans,
    sorties: sim.sorties,
    events: sim.events,
    setup: sim.setup,
    owner: runs(sim.owner),
    rival: runs(sim.rival),
    rivalUse: runs(Float32Array.from(sim.rivalUse, Math.round)),
    // By province only for the generator's provinces (otherwise they are the points above).
    ...(env?.prov.real && sim.provIds && sim.provOwner && sim.provRival && sim.provRivalUse
      ? { provIds: runs(Int32Array.from(sim.provIds, (v, i) => v - (i ? sim.provIds![i - 1] : 0))), provOwner: runs(sim.provOwner), provRival: runs(sim.provRival), provRivalUse: runs(Float32Array.from(sim.provRivalUse, Math.round)) }
      : {}),
    beasts,
  };
}

/** The saved simulation back, on this climate's grid (null if it was made on another grid or is damaged). */
export function unpackSim(p: PackedSim, env: Env): SimState | null {
  if (!p || p.v !== 1 || p.w !== env.w || p.h !== env.h || !Array.isArray(p.tribes) || !Array.isArray(p.clans)) return null;
  const n = env.n;
  const owner = new Int32Array(n);
  const rival = new Int32Array(n);
  const rivalUse = new Float32Array(n);
  if (!unruns(p.owner, n, owner) || !unruns(p.rival, n, rival) || !unruns(p.rivalUse, n, rivalUse)) return null;
  const traffic = new Float32Array(n);
  if (p.traffic) unruns(p.traffic, n, traffic);
  const way = new Uint8Array(n);
  const wayKeeper = new Int32Array(n).fill(-1);
  if (p.way) unruns(p.way, n, way);
  if (p.wayKeeper) unruns(p.wayKeeper, n, wayKeeper);
  const bridge = new Uint8Array(n);
  if (p.bridge) unruns(p.bridge, n, bridge);
  const beasts: Record<string, Float32Array> = {};
  for (const b of env.beastInfo) {
    const K = env.beastK[b.id];
    const q = new Uint8Array(n);
    const ok = unruns(p.beasts?.[b.id], n, q);
    beasts[b.id] = ok ? Float32Array.from(q, (v, k) => (v / 255) * K[k]) : Float32Array.from(K, (v) => v * 0.9);
  }
  // Land by province, when it was saved by province.
  let prov: Pick<SimState, 'provIds' | 'provOwner' | 'provRival' | 'provRivalUse'> = {};
  if (Array.isArray(p.provIds) && p.provIds.length % 2 === 0) {
    let P = 0;
    for (let i = 1; i < p.provIds.length; i += 2) P += p.provIds[i];
    const steps = new Int32Array(P);
    const po = new Int32Array(P);
    const pr = new Int32Array(P);
    const pu = new Float32Array(P);
    if (P > 0 && unruns(p.provIds, P, steps) && unruns(p.provOwner, P, po) && unruns(p.provRival, P, pr) && unruns(p.provRivalUse, P, pu)) {
      const ids = new Int32Array(P);
      for (let i = 0; i < P; i++) ids[i] = steps[i] + (i ? ids[i - 1] : 0);
      prov = { provIds: ids, provOwner: po, provRival: pr, provRivalUse: pu };
    }
  }
  const sim: SimState = {
    day: p.day | 0,
    seed: p.seed | 0 || 1,
    started: !!p.started,
    tribes: p.tribes,
    settlements: Array.isArray(p.settlements) ? p.settlements : [],
    grudges: Array.isArray(p.grudges) ? p.grudges : [],
    caravans: Array.isArray(p.caravans) ? p.caravans : [],
    firsts: p.firsts && typeof p.firsts === 'object' ? p.firsts : {},
    cultures: Array.isArray(p.cultures) ? p.cultures : [],
    relations: p.relations && typeof p.relations === 'object' ? p.relations : {},
    routes: Array.isArray(p.routes) ? p.routes : [],
    traffic,
    way,
    wayKeeper,
    bridge,
    realmRelations: p.realmRelations && typeof p.realmRelations === 'object' ? p.realmRelations : {},
    spies: Array.isArray(p.spies) ? p.spies : [],
    faiths: Array.isArray(p.faiths) ? p.faiths : [],
    champions: Array.isArray(p.champions) ? p.champions : [],
    prophecies: Array.isArray(p.prophecies) ? p.prophecies : [],
    godActs: p.godActs && typeof p.godActs === 'object' ? p.godActs : {},
    wars: Array.isArray(p.wars) ? p.wars : [],
    armies: Array.isArray(p.armies) ? p.armies : [],
    battles: Array.isArray(p.battles) ? p.battles : [],
    rifts: Array.isArray(p.rifts) ? p.rifts : [],
    tides: Array.isArray(p.tides) ? p.tides : [],
    hordes: Array.isArray(p.hordes) ? p.hordes : [],
    ...(() => {
      const c = new Float32Array(n);
      return p.corruption && unruns(p.corruption, n, c) ? { corruption: Float32Array.from(c, (v) => v / 100) } : {};
    })(),
    clans: p.clans,
    sorties: Array.isArray(p.sorties) ? p.sorties : [],
    nextId: p.nextId | 0,
    w: p.w,
    h: p.h,
    owner,
    rival,
    rivalUse,
    beasts,
    events: Array.isArray(p.events) ? p.events : [],
    setup: Array.isArray(p.setup) ? p.setup : [],
    ...prov,
  };
  // Fitted to the provinces the map has now (a save from before provinces: each to whoever held most of it).
  bindProvinces(sim, env);
  return sim;
}
