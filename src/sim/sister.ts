import type { LiveCulture } from './state';

/**
 * A culture's family (REDESIGN.md, regional cultures step 3; the sister cultures themselves now
 * come from drift: drift.ts, "Cultures as peoples" step 4).
 */

/** A culture's family: its root, and the cultures that share it (sisters, daughters, the root). */
export function familyOf(cultures: LiveCulture[], cu: LiveCulture): { root: LiveCulture; kin: LiveCulture[] } {
  const byId = new Map(cultures.map((q) => [q.id, q]));
  const rootOf = (q: LiveCulture) => {
    let r = q;
    for (let i = 0; i < 20 && r.parent && byId.has(r.parent); i++) r = byId.get(r.parent)!;
    return r;
  };
  const root = rootOf(cu);
  return { root, kin: cultures.filter((q) => q !== cu && rootOf(q) === root) };
}
