import { BIOMES } from './data/biomes';
import { GOOD_NAMES } from './data/economy';
import { ERA_NAMES, TECH_BY_ID } from './data/techs';
import { TRAIT_BY_ID } from './data/traits';
import type { Polity, Settlement } from './types';
import { VALUE_KEYS } from './types';
import type { World } from './world';

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function settlementTier(pop: number): string {
  if (pop < 150) return 'Camp';
  if (pop < 600) return 'Hamlet';
  if (pop < 2000) return 'Village';
  if (pop < 8000) return 'Town';
  if (pop < 30000) return 'City';
  if (pop < 100000) return 'Great City';
  return 'Metropolis';
}

export function polityEra(p: Polity): string {
  let era = 0;
  for (const id of p.techs) era = Math.max(era, TECH_BY_ID.get(id)?.era ?? 0);
  return ERA_NAMES[era];
}

export function describeValues(world: World, cultureId: number): string {
  const v = world.cultures[cultureId].values;
  const hi = VALUE_KEYS.filter((k) => v[k] > 0.68);
  const lo = VALUE_KEYS.filter((k) => v[k] < 0.25);
  const words: Record<string, [string, string]> = {
    militarism: ['martial', 'peaceable'],
    mercantilism: ['mercantile', 'self-sufficient'],
    piety: ['devout', 'worldly'],
    curiosity: ['inquisitive', 'incurious'],
    xenophobia: ['insular', 'cosmopolitan'],
    tradition: ['traditional', 'progressive'],
    seafaring: ['seafaring', 'landbound'],
    expansionism: ['expansionist', 'settled'],
  };
  const parts = [...hi.map((k) => words[k][0]), ...lo.map((k) => words[k][1])];
  return parts.length ? parts.join(', ') : 'moderate in all things';
}

/** A short fact sheet on one settlement — handy as a DM's town note. */
export function settlementNote(world: World, s: Settlement): string {
  const p = world.polities[s.polityId];
  const c = world.cultures[s.cultureId];
  const races = Object.entries(s.races)
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${world.raceById.get(r)?.plural ?? r} ${Math.round((n / Math.max(1, s.pop)) * 100)}%`)
    .join(', ');
  const exports = [...s.exported].map((q, g) => [g, q] as const).filter(([, q]) => q > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => GOOD_NAMES[g]);
  const imports = [...s.imported].map((q, g) => [g, q] as const).filter(([, q]) => q > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => GOOD_NAMES[g]);
  const lines = [
    `### ${s.name}${s.alive ? '' : ' (ruins)'}`,
    `${settlementTier(s.pop)} of ${fmt(s.alive ? s.pop : s.peakPop)}${s.alive ? '' : ' at its height'} — ${BIOMES[world.map.biome[s.tile]].name}${s.coastal ? ', on the coast' : ''}${s.river ? ', on a river' : ''}.`,
    `Founded in year ${s.founded}${s.abandoned !== null ? `, abandoned in year ${s.abandoned}` : ''}. ${p.alive || !s.alive ? `Ruled by the ${p.name}` : ''}; ${c.adjective} culture${races ? ` (${races})` : ''}.`,
  ];
  if (s.alive) {
    lines.push(`Stability ${(s.stability * 100).toFixed(0)}%, food ${(Math.min(9.99, s.foodRatio) * 100).toFixed(0)}%, wealth ${fmt(s.wealth)}.`);
    if (exports.length) lines.push(`Exports: ${exports.join(', ')}.${imports.length ? ` Imports: ${imports.join(', ')}.` : ''}`);
  }
  if (s.greatWorks.length) lines.push(`Famous for: ${s.greatWorks.join(', ')}.`);
  return lines.join('\n');
}

export function worldSummary(world: World): string {
  const st = world.stats[world.stats.length - 1];
  const polities = [...world.alivePolities()].sort((a, b) => b.pop - a.pop);
  const cities = [...world.aliveSettlements()].sort((a, b) => b.pop - a.pop);
  const lines: string[] = [];
  lines.push(`# The World of ${world.cfg.name} — Year ${world.year}`);
  lines.push('');
  lines.push(`Population ${fmt(st.population)} in ${st.settlements} settlements, ${st.polities} polities, ${st.cultures} living cultures, ${st.wars} ongoing wars.`);
  lines.push('');
  lines.push('| Race | Population |');
  lines.push('|---|---|');
  for (const r of world.races) lines.push(`| ${r.plural} | ${fmt(st.byRace[r.id] ?? 0)} |`);
  lines.push('');
  lines.push('## Great powers');
  lines.push('');
  lines.push('| Polity | Government | Culture | Population | Settlements | Capital | Era | Ruler |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const p of polities.slice(0, 12)) {
    lines.push(`| ${p.name} | ${p.government} | ${world.cultures[p.cultureId].name} | ${fmt(p.pop)} | ${p.settlementIds.length} | ${world.settlements[p.capitalId].name} | ${polityEra(p)} | ${p.ruler.title} ${p.ruler.name} |`);
  }
  lines.push('');
  lines.push('## Largest cities');
  lines.push('');
  for (const s of cities.slice(0, 10)) lines.push(`- **${s.name}** (${fmt(s.pop)}) — ${world.polities[s.polityId].name}, ${world.cultures[s.cultureId].adjective}`);
  return lines.join('\n');
}

/** The full history as a Markdown document: chronicle by century, then nations, cultures, wars and places. */
export function chronicleMarkdown(world: World, minImportance = 2): string {
  const out: string[] = [worldSummary(world), '', '---', '', '## Chronicle', ''];
  let century = -1;
  for (const e of world.history) {
    if (e.importance < minImportance) continue;
    const c = Math.floor(e.year / 100);
    if (c !== century) {
      century = c;
      out.push('', `### Years ${c * 100}–${c * 100 + 99}`, '');
    }
    out.push(`- **${e.year}** ${e.importance >= 3 ? '**' + e.text + '**' : e.text}`);
  }

  out.push('', '---', '', '## Nations', '');
  const notable = world.polities.filter((p) => p.pastRulers.length > 0 || p.settlementIds.length > 1 || p.alive).sort((a, b) => a.founded - b.founded);
  for (const p of notable) {
    const peak = p.popHistory.reduce((m, [, n]) => Math.max(m, n), p.pop);
    if (peak < 500 && !p.alive) continue;
    out.push(`### ${p.name}`);
    out.push(`${p.alive ? 'Founded' : 'Existed from'} year ${p.founded}${p.dissolved !== null ? ` to ${p.dissolved}` : ''}. ${world.cultures[p.cultureId].adjective} ${p.government}; peak population ${fmt(peak)}. ${p.alive ? `Now in the ${polityEra(p)}, capital ${world.settlements[p.capitalId].name}.` : ''}`);
    if (p.parentPolity >= 0) out.push(`Broke away from the ${world.polities[p.parentPolity].name}.`);
    const rulers = [...p.pastRulers, ...(p.alive ? [p.ruler] : [])];
    if (rulers.length) {
      out.push('', 'Rulers:');
      for (const r of rulers) out.push(`- ${r.title} ${r.name} (${r.since}–${r.until ?? 'present'}; ${r.traits.join(', ')})${r.fate ? ` — ${r.fate}` : ''}`);
    }
    out.push('');
  }

  out.push('## Cultures', '');
  for (const c of world.cultures) {
    const parent = c.parentId >= 0 ? world.cultures[c.parentId] : null;
    out.push(`- **${c.name}** (${c.adjective}; ${world.raceById.get(c.raceId)?.plural ?? c.raceId}) — ${describeValues(world, c.id)}${c.traits.length ? `; ${c.traits.map((t) => TRAIT_BY_ID.get(t)?.name ?? t).join(', ')}` : ''}. Arose year ${c.founded}${parent ? ` from the ${parent.name}` : ''}${c.extinct !== null ? `; faded year ${c.extinct}` : ''}. Sample words: ${c.language.onsets.slice(0, 3).map((o, i) => o + (c.language.vowels[i % c.language.vowels.length] ?? '') + (c.language.codas[i % c.language.codas.length] ?? '')).join(', ')}.`);
  }

  out.push('', '## Wars', '');
  for (const w of world.wars) {
    out.push(`- **${w.name}** (${w.start}–${w.end ?? 'ongoing'}): ${world.polities[w.attacker].name} vs ${world.polities[w.defender].name}; ${w.battles} battles, ~${fmt(w.attackerLosses + w.defenderLosses)} dead${w.outcome ? `; ${w.outcome}` : ''}.`);
  }

  if (world.agreements.length) {
    out.push('', '## Trade agreements', '');
    for (const d of world.agreements) out.push(`- **${d.name}** (${d.type}; ${d.start}–${d.end ?? 'in force'}): ${world.polities[d.a].name} and ${world.polities[d.b].name}${d.goods.length ? `, for ${d.goods.join(', ').toLowerCase()}` : ''}${d.endReason ? `; ended because ${d.endReason}` : ''}.`);
  }

  out.push('', '## Notable places', '');
  const places = world.settlements.filter((s) => s.peakPop > 2000 || s.greatWorks.length).sort((a, b) => b.peakPop - a.peakPop).slice(0, 40);
  for (const s of places) out.push(settlementNote(world, s), '');
  return out.join('\n');
}

/** Plain JSON snapshot of the world's people and places, for external tools or campaign notes. */
export function worldSnapshot(world: World): unknown {
  return {
    name: world.cfg.name,
    seed: world.cfg.seed,
    year: world.year,
    config: world.cfg,
    settlements: world.settlements.map((s) => ({
      id: s.id, name: s.name, x: s.x, y: s.y, alive: s.alive, founded: s.founded, abandoned: s.abandoned,
      pop: Math.round(s.pop), peakPop: Math.round(s.peakPop), races: Object.fromEntries(Object.entries(s.races).map(([k, v]) => [k, Math.round(v)])),
      polity: s.polityId, culture: s.cultureId, wealth: Math.round(s.wealth), stability: +s.stability.toFixed(2), greatWorks: s.greatWorks,
      biome: BIOMES[world.map.biome[s.tile]].name, coastal: s.coastal, river: s.river,
    })),
    polities: world.polities.map((p) => ({
      id: p.id, name: p.name, government: p.government, alive: p.alive, founded: p.founded, dissolved: p.dissolved,
      capital: p.capitalId, culture: p.cultureId, pop: Math.round(p.pop), techs: [...p.techs], ruler: p.ruler, pastRulers: p.pastRulers,
      settlements: p.settlementIds, parent: p.parentPolity, popHistory: p.popHistory, hub: p.hubId, tariff: p.tariff,
      agreements: [...p.agreements.keys()], shortages: [...p.deficit].map((d, g) => (d ? GOOD_NAMES[g] : '')).filter(Boolean),
    })),
    cultures: world.cultures.map((c) => ({ id: c.id, name: c.name, adjective: c.adjective, race: c.raceId, parent: c.parentId, founded: c.founded, extinct: c.extinct, values: c.values, traits: c.traits, language: c.language })),
    wars: world.wars,
    agreements: world.agreements,
    armies: world.armies,
    caravans: world.caravans.map((c) => ({ kind: c.kind, name: c.name, home: c.homeId, from: c.fromId, to: c.toId, size: c.size, cargo: c.cargo.map((x) => ({ good: GOOD_NAMES[x.good], qty: Math.round(x.qty) })), returning: c.returning })),
    houses: world.houses,
    routes: [...world.routes.values()].map((r) => ({ a: r.a, b: r.b, kind: r.kind, volume: Math.round(r.volume) })),
    history: world.history,
    stats: world.stats,
  };
}
