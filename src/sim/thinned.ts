import type { Env } from './env';
import type { SimState } from './state';

/**
 * Where each beast is below what its land carries (hunted, or not yet grown back), so regrowth
 * only visits those places rather than every point of the map each month. Worked out from the
 * densities the first time it is needed (after loading, too), then kept up as hunting thins them.
 */
const sets = new WeakMap<SimState, Map<string, Set<number>>>();

export function thinned(sim: SimState, env: Env, id: string): Set<number> {
  let m = sets.get(sim);
  if (!m) sets.set(sim, (m = new Map()));
  let s = m.get(id);
  if (!s) {
    s = new Set();
    const D = sim.beasts[id];
    const K = env.beastK[id];
    if (D && K) for (let k = 0; k < env.n; k++) if (K[k] > 0 && D[k] < K[k] * 0.95) s.add(k);
    m.set(id, s);
  }
  return s;
}

/** A beast was hunted at a point: it will need to grow back there. */
export function markThinned(sim: SimState, id: string, k: number): void {
  sets.get(sim)?.get(id)?.add(k);
}
