import type { Env } from './env';
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
  way?: number[];
  wayKeeper?: number[];
  clans: SimState['clans'];
  sorties: SimState['sorties'];
  events: SimState['events'];
  setup: SimState['setup'];
  /** Runs: value, count, value, count… */
  owner: number[];
  rival: number[];
  rivalUse: number[];
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
    routes: sim.routes,
    traffic: runs(Float32Array.from(sim.traffic, (v) => Math.round(v * 10) / 10)),
    way: runs(sim.way),
    wayKeeper: runs(sim.wayKeeper),
    clans: sim.clans,
    sorties: sim.sorties,
    events: sim.events,
    setup: sim.setup,
    owner: runs(sim.owner),
    rival: runs(sim.rival),
    rivalUse: runs(Float32Array.from(sim.rivalUse, Math.round)),
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
  const beasts: Record<string, Float32Array> = {};
  for (const b of env.beastInfo) {
    const K = env.beastK[b.id];
    const q = new Uint8Array(n);
    const ok = unruns(p.beasts?.[b.id], n, q);
    beasts[b.id] = ok ? Float32Array.from(q, (v, k) => (v / 255) * K[k]) : Float32Array.from(K, (v) => v * 0.9);
  }
  return {
    day: p.day | 0,
    seed: p.seed | 0 || 1,
    started: !!p.started,
    tribes: p.tribes,
    settlements: Array.isArray(p.settlements) ? p.settlements : [],
    grudges: Array.isArray(p.grudges) ? p.grudges : [],
    caravans: Array.isArray(p.caravans) ? p.caravans : [],
    firsts: p.firsts && typeof p.firsts === 'object' ? p.firsts : {},
    routes: Array.isArray(p.routes) ? p.routes : [],
    traffic,
    way,
    wayKeeper,
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
  };
}
