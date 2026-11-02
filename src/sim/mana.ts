import { leyLines, manaField, type ManaLine, type ManaNode } from '../core/mana';
import type { Library } from '../core/library';
import type { Env } from './env';
import type { Settlement, SimState } from './state';
import { knows } from './tech';

/**
 * Mana in the simulation (REDESIGN.md 6A and 8.11; Phase 11 step 1). The land's own mana (natural
 * nodes, the world tree's roots and anchor) is worked out with the environment; each year the
 * peoples' nodes are added: dawn cities, temples (holy sites held) and mage towers. Roots branch
 * out to reach towers and temples near them. Where mana is strong, towns that know how to chart
 * ley lines raise mage towers, which become nodes themselves; dense mana and towers open the way
 * to magocracy; mana crystals are richest where mana is dense; mana-sensitive peoples are drawn to it.
 */

/** Roots reach out to a tower or temple this near one (km). */
const ROOT_REACH = 400;

/** The peoples' nodes now: dawn cities, temples and mage towers. */
export function peopleNodes(sim: SimState): ManaNode[] {
  const out: ManaNode[] = [];
  for (const st of sim.settlements) {
    if (st.ruined) continue;
    if (st.kind === 'dawn') out.push({ x: st.x, y: st.y, kind: 'dawn' });
    if (st.tower !== undefined) out.push({ x: st.x, y: st.y, kind: 'tower' });
  }
  for (const f of sim.faiths ?? []) for (const h of f.holySites) if (h.held) out.push({ x: h.x, y: h.y, kind: 'temple' });
  return out;
}

/** Every mana line now: ley lines between all nodes, the roots, and roots branching out to towers and temples near them. */
export function manaLinesNow(sim: SimState, env: Env): { lines: ManaLine[]; nodes: ManaNode[] } {
  const nodes = [...env.manaLand.nodes, ...peopleNodes(sim)];
  const lines = [...leyLines(nodes, env.wrapKm), ...env.manaLand.roots];
  for (const nd of nodes) {
    if (nd.kind !== 'tower' && nd.kind !== 'temple') continue;
    // The nearest point on any root.
    let bd = Infinity;
    let bx = 0;
    let by = 0;
    for (const r of env.manaLand.roots) for (let i = 0; i < r.pts.length; i += 2) {
      let dx = Math.abs(r.pts[i] - nd.x);
      if (env.wrapKm) dx = Math.min(dx % env.wrapKm, env.wrapKm - (dx % env.wrapKm));
      const d = Math.hypot(dx, r.pts[i + 1] - nd.y);
      if (d < bd) [bd, bx, by] = [d, r.pts[i], r.pts[i + 1]];
    }
    if (bd > 30 && bd < ROOT_REACH) {
      let tx = nd.x;
      if (env.wrapKm && Math.abs(tx - bx) > env.wrapKm / 2) tx += Math.sign(bx - tx) * env.wrapKm;
      lines.push({ kind: 'sprout', pts: [bx, by, (bx + tx) / 2 + (by - nd.y) * 0.15, (by + nd.y) / 2 + (tx - bx) * 0.15, tx, nd.y] });
    }
  }
  return { lines, nodes };
}

/** A key for the nodes, so the mana is worked out again only when they change. */
const nodeKey = (sim: SimState) => peopleNodes(sim).map((n) => `${n.kind}${Math.round(n.x)},${Math.round(n.y)}`).sort().join(';');

/** The mana at each point now (worked out again when the peoples' nodes change). */
export function manaNow(sim: SimState, env: Env): Float32Array {
  const key = nodeKey(sim);
  const cache = cached.get(sim);
  if (cache && cache.key === key && cache.env === env) return cache.field;
  const { lines, nodes } = manaLinesNow(sim, env);
  const field = manaField({ x0: env.x0, y0: env.y0, step: env.step, w: env.w, h: env.h, wrapKm: env.wrapKm }, lines, nodes, env.manaLand.anchor);
  cached.set(sim, { key, env, field });
  return field;
}
const cached = new WeakMap<SimState, { key: string; env: Env; field: Float32Array }>();

/** Mana where a settlement stands. */
export function manaAtPlace(sim: SimState, env: Env, x: number, y: number): number {
  let i = Math.round((x - env.x0) / env.step);
  const j = Math.round((y - env.y0) / env.step);
  if (j < 0 || j >= env.h) return 0;
  if (i < 0 || i >= env.w) {
    if (!env.wrapKm) return 0;
    i = ((i % env.w) + env.w) % env.w;
  }
  return manaNow(sim, env)[j * env.w + i];
}

/** Mana at least this dense lets a town that charts ley lines raise a mage tower. */
export const TOWER_MANA = 0.45;

/** Each year: towns on strong mana that know ley line mapping may raise a mage tower. */
export function manaYear(c: { sim: SimState; env: Env; lib: Library; rand: () => number; log: (text: string, x?: number, y?: number) => void }): void {
  const { sim, env, lib } = c;
  const built: Settlement[] = [];
  for (const st of sim.settlements) {
    if (st.ruined || st.tower !== undefined || st.pop < 400) continue;
    if (!knows(lib, st, 'ley-mapping')) continue;
    const m = manaAtPlace(sim, env, st.x, st.y);
    if (m < TOWER_MANA || c.rand() >= 0.12 * m) continue;
    built.push(st);
  }
  for (const st of built) {
    st.tower = sim.day;
    c.log(`${st.name} raised a mage tower on the ley lines: a new node, drawing mana and the world tree's roots toward it.`, st.x, st.y);
  }
}
