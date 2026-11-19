import type { ChangeContext } from './cultureChange';
import type { LiveCulture, Settlement } from './state';

/**
 * Sister cultures (REDESIGN.md, regional cultures step 3).
 *
 * A culture's towns each live by their own version of it (culture.ts, local ways). Where a region
 * of its towns, near one another, has long lived far from the culture's own ways (two or more
 * changes of their own, at least two of them shared across the region) for about eighty years,
 * and the region is not most of the culture (then the culture follows it instead), the region
 * becomes a people of its own: a sister culture of the same family, its parent's ways with the
 * region's changes made its own. Kin cultures start close (acceptance), so a sister is no stranger.
 */

/** Years a region must live its own way; how near its towns are; how few towns make a region. */
export const SISTER_YEARS = 80;
export const REGION_KM = 250;
export const MIN_TOWNS = 2;

/** A town's own (not inherited) local changes, as keys ("+seafaring", "-tillers"). */
const ownChanges = (st: Settlement) => (st.local ?? []).filter((q) => q.level >= 0 && !q.from).map((q) => `${q.change === 'add' ? '+' : '-'}${q.id}`);

/** Once a year: count each town's years apart, and split off regions apart long enough. */
export function sistersYear(c: ChangeContext, make: (from: LiveCulture[], hint: string) => LiveCulture): void {
  const { sim, lib } = c;
  const live = sim.settlements.filter((s) => !s.ruined && !s.layer);
  const popOf = (s: Settlement) => s.pop + live.filter((q) => q.partOf === s.id).reduce((n, q) => n + q.pop, 0);
  const tradName = (id: string) => lib.traditions.find((t) => t.id === id)?.name ?? id;
  const keyText = (k: string) => `${k[0] === '+' ? '+' : '−'} ${tradName(k.slice(1))}`;

  for (const cu of [...(sim.cultures ?? [])]) {
    const towns = live.filter((s) => s.partOf === undefined && s.culture === cu.id);
    for (const st of towns) st.apart = ownChanges(st).length >= 2 ? (st.apart ?? 0) + 1 : Math.max(0, (st.apart ?? 0) - 2);
    if (towns.length < MIN_TOWNS + 1) continue;
    const ready = towns.filter((s) => (s.apart ?? 0) >= SISTER_YEARS);
    if (ready.length < MIN_TOWNS) continue;
    const total = towns.reduce((n, s) => n + popOf(s), 0);
    // Regions: towns near one another sharing at least two of their changes.
    const keys = new Map(ready.map((s) => [s, new Set(ownChanges(s))]));
    const linked = (a: Settlement, b: Settlement) => c.dist(a.x, a.y, b.x, b.y) < REGION_KM && [...keys.get(a)!].filter((k) => keys.get(b)!.has(k)).length >= 2;
    const seen = new Set<Settlement>();
    for (const seed of ready) {
      if (seen.has(seed)) continue;
      const region = [seed];
      seen.add(seed);
      for (let i = 0; i < region.length; i++) for (const o of ready) if (!seen.has(o) && linked(region[i], o)) {
        seen.add(o);
        region.push(o);
      }
      if (region.length < MIN_TOWNS) continue;
      const shared = [...keys.get(seed)!].filter((k) => region.every((s) => keys.get(s)!.has(k))).sort();
      if (shared.length < 2) continue;
      const pop = region.reduce((n, s) => n + popOf(s), 0);
      if (pop > total / 2) continue;

      const nc = make([cu], 'sister');
      nc.sister = shared;
      for (const k of shared) {
        const id = k.slice(1);
        if (k[0] === '-') {
          nc.traditions = nc.traditions.filter((t) => t.id !== id);
          continue;
        }
        const level = Math.min(...region.map((s) => s.local!.find((q) => q.id === id && q.change === 'add')!.level));
        const entry = nc.traditions.find((t) => t.id === id);
        if (entry) Object.assign(entry, { level: Math.max(entry.level, level), progress: 0 });
        else nc.traditions.push({ id, level, hold: '', progress: 0 });
      }
      for (const st of region) {
        st.culture = nc.id;
        st.lastCulture = nc.id;
        st.apart = 0;
        delete st.cultureShift;
        st.local = (st.local ?? []).filter((q) => q.from || !shared.includes(`${q.change === 'add' ? '+' : '-'}${q.id}`));
        for (const v of live) if (v.partOf === st.id) {
          v.culture = nc.id;
          v.lastCulture = nc.id;
        }
      }
      const big = [...region].sort((a, b) => popOf(b) - popOf(a));
      const names = big.slice(0, 3).map((s) => s.name).join(', ') + (big.length > 3 ? ` and ${big.length - 3} more` : '');
      c.log(`The ${cu.name} of ${names}, long living their own way (${shared.map(keyText).join(', ')}), have become a people of their own: the ${nc.name}, a sister culture of the ${cu.name}.`, big[0].x, big[0].y);
    }
  }
}

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
