import { describeValues, fmt, polityEra, settlementTier } from '../engine/chronicle';
import { GOOD_BASE_PRICE, GOOD_COUNT, GOOD_NAMES } from '../engine/data/economy';
import { ERA_NAMES, TECHS, TECH_BY_ID, techCost } from '../engine/data/techs';
import { TRAIT_BY_ID } from '../engine/data/traits';
import type { HistoryEvent, Polity } from '../engine/types';
import type { World } from '../engine/world';
import { levy } from '../engine/systems/military';
import { POLICY_LABEL, accessPolicy } from '../engine/systems/access';
import { ROAD_NAMES } from '../engine/systems/roads';
import { usesCoin } from '../engine/systems/trade';
import { greatHouses } from '../engine/systems/nobility';
import { claimStrength } from '../engine/systems/warAims';
import { compact, lineChart } from './chart';

export interface UiHelpers {
  esc: (s: string) => string;
  sLink: (id: number) => string;
  pLink: (id: number) => string;
  cLink: (id: number) => string;
  meter: (label: string, v: number, tone?: 'plain' | 'good' | 'bad') => string;
  eventList: (events: HistoryEvent[], limit: number) => string;
}

function goodStatus(p: Polity, g: number): { label: string; tone: string } {
  const made = p.produced[g];
  const need = p.needed[g];
  if (need < 1 && made < 1) return { label: 'not used', tone: '' };
  if (p.deficit[g]) return { label: 'short', tone: 'crit' };
  if (made > need * 1.2) return { label: 'surplus', tone: 'ok' };
  return { label: 'self-sufficient', tone: '' };
}

/** A full dossier on one nation: people, economy and trade, military, knowledge, lands and history. */
export function renderNation(world: World, id: number, h: UiHelpers): string {
  const p = world.polities[id];
  const { esc, sLink, pLink, cLink, meter } = h;
  const towns = p.settlementIds.map((s) => world.settlements[s]).sort((a, b) => b.pop - a.pop);
  const cultures = new Map<number, number>();
  const races = new Map<string, number>();
  let internal = 0;
  let convoy = 0;
  let caravan = 0;
  let wealth = 0;
  for (const s of towns) {
    cultures.set(s.cultureId, (cultures.get(s.cultureId) ?? 0) + s.pop);
    for (const r in s.races) races.set(r, (races.get(r) ?? 0) + s.races[r]);
    internal += s.tradeByKind.internal;
    convoy += s.tradeByKind.convoy;
    caravan += s.tradeByKind.caravan;
    wealth += s.wealth;
  }
  const armies = world.armies.filter((a) => a.alive && a.polityId === id);
  const ownCaravans = world.caravans.filter((c) => world.settlements[c.homeId].polityId === id);
  const agreements = world.agreements.filter((d) => d.end === null && (d.a === id || d.b === id));
  const pastDeals = world.agreements.filter((d) => (d.a === id || d.b === id) && d.end !== null).slice(-6);
  const neighbours = [...new Set([...p.relations.keys()])].filter((q) => world.polities[q].alive).sort((a, b) => world.polities[b].pop - world.polities[a].pop).slice(0, 10);
  const houses = world.houses.filter((hh) => hh.closed === null && world.settlements[hh.homeId].polityId === id);
  const roadCount = [0, 0, 0, 0, 0];
  for (const s of towns) for (const t of s.territory) roadCount[world.map.road[t] | 0]++;
  const byKind: Record<string, number> = {};
  for (const c of ownCaravans) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  const wars = [...p.wars].map((w) => world.wars[w]);
  const researching = p.researching ? TECH_BY_ID.get(p.researching) : null;
  const known = TECHS.filter((t) => p.techs.has(t.id)).length;
  const events = world.history.filter((e) => e.polities?.includes(id) && e.importance >= 2);
  const goods = Array.from({ length: GOOD_COUNT }, (_, g) => g).filter((g) => p.produced[g] > 0.5 || p.needed[g] > 0.5);
  const shortages = goods.filter((g) => p.deficit[g]);
  const r = p.ruler;
  const dynasty = p.dynasty >= 0 ? world.nobles[p.dynasty] : null;
  const nobles = p.alive ? greatHouses(world, p).sort((a, b) => b.prestige - a.prestige) : [];
  const loyalty = towns.reduce((n, s) => n + s.loyalty * s.pop, 0) / Math.max(1, p.pop);
  const cutOff = towns.filter((s) => !s.connected);
  const pacts = [...p.pacts].map((pid) => world.pacts[pid]);
  const conf = p.confederation >= 0 ? world.confederations[p.confederation] : null;
  const vassals = world.polities.filter((v) => v.alive && v.overlord === id);
  const tributaries = world.polities.filter((v) => v.alive && v.tributeTo === id);
  const claims = [...world.aliveSettlements()].filter((s) => s.polityId !== id && claimStrength(world, id, s) > 0).sort((a, b) => b.pop - a.pop);
  const houseOf = (hid: number) => (hid >= 0 ? world.nobles[hid] : null);

  return `
  <header class="dossier-head">
    <div>
      <p class="eyebrow">${p.alive ? `${esc(p.government)} · ${polityEra(p)}` : `Fallen realm · ${p.founded}–${p.dissolved}`}</p>
      <h2><span class="dot big" style="background:${p.color}"></span>${esc(p.name)}</h2>
      <p class="sub">${esc(r.title)} ${esc(r.name)} rules from ${sLink(p.capitalId)}. Largest city and trade hub: ${sLink(p.hubId)}. Founded in year ${p.founded}${p.parentPolity >= 0 ? `, breaking away from ${pLink(p.parentPolity)}` : ''}.</p>
    </div>
    <dl class="facts wide">
      <div><dt>Population</dt><dd>${fmt(p.pop)}</dd></div>
      <div><dt>Settlements</dt><dd>${towns.length}</dd></div>
      <div><dt>Stability</dt><dd>${Math.round(p.stability * 100)}%</dd></div>
      <div><dt>Loyalty</dt><dd>${Math.round(loyalty * 100)}%</dd></div>
      <div><dt>Treasury</dt><dd>${compact(p.treasury)}</dd></div>
      <div><dt>Army strength</dt><dd>${compact(p.military)}</dd></div>
      <div><dt>Techs known</dt><dd>${known} / ${TECHS.length}</dd></div>
    </dl>
  </header>

  <div class="dossier-grid">
    <section class="card span2">
      <h3>Economy — what the nation makes and what it lacks</h3>
      <p class="muted small">Nations meet their own needs first. Goods marked <b>short</b> are what they must get through trade agreements or free traders.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Good</th><th class="num">Made / yr</th><th class="num">Needed</th><th class="num">Imported</th><th>Status</th></tr></thead>
        <tbody>${goods.map((g) => {
          const st = goodStatus(p, g);
          return `<tr><td>${GOOD_NAMES[g]}</td><td class="num">${compact(p.produced[g])}</td><td class="num">${compact(p.needed[g])}</td><td class="num">${p.imported[g] > 0.5 ? compact(p.imported[g]) : '—'}</td><td><span class="chip ${st.tone}">${st.label}</span></td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${shortages.length ? `<p class="small">Short of: <b>${shortages.map((g) => GOOD_NAMES[g]).join(', ')}</b>.</p>` : '<p class="small">Self-sufficient in everything it uses.</p>'}
    </section>

    <section class="card">
      <h3>Trade</h3>
      <dl class="facts">
        <div><dt>Internal</dt><dd>${compact(internal / 2)} / yr</dd></div>
        <div><dt>Caravans</dt><dd>${compact(caravan)} / yr</dd></div>
        <div><dt>Convoys</dt><dd>${compact(convoy)} / yr</dd></div>
        <div><dt>Money</dt><dd>${usesCoin(p) ? 'Coin' : 'Barter'}</dd></div>
        <div><dt>Tariff</dt><dd>${Math.round(p.tariff * 100)}%</dd></div>
        <div><dt>Tolls collected</dt><dd>${compact(p.tariffIncome)}</dd></div>
      </dl>
      <p class="small">${ownCaravans.length ? `On the road: ${Object.entries(byKind).map(([k, n]) => `${n} ${{ merchant: 'merchant caravan', family: 'family caravan', nomad: 'nomad caravan', convoy: 'state convoy' }[k]}${n > 1 ? 's' : ''}`).join(', ')}.` : 'No caravans on the road.'}</p>
      ${houses.length ? `<p class="small">Trading families: ${houses.slice(0, 6).map((hh) => `<b>${esc(hh.name)}</b> of ${sLink(hh.homeId)}`).join(', ')}${houses.length > 6 ? ` and ${houses.length - 6} more` : ''}.</p>` : ''}
      <h4>Agreements</h4>
      ${agreements.length ? `<ul class="plain">${agreements.map((d) => {
        const other = d.a === id ? d.b : d.a;
        const what = d.type === 'market' ? 'open market, no tolls' : d.type === 'transit' ? (d.a === id ? 'we let their traders pass' : 'their lands are open to our traders') : d.coin ? `${d.a === id ? 'we send' : 'we receive'} ${Math.round(d.giveQty!)} ${GOOD_NAMES[d.giveGood!].toLowerCase()} a year for ${Math.round(d.coin)} silver` : `${d.a === id ? 'we send' : 'we receive'} ${Math.round(d.giveQty!)} ${GOOD_NAMES[d.giveGood!].toLowerCase()} for ${Math.round(d.getQty!)} ${GOOD_NAMES[d.getGood!].toLowerCase()} a year`;
        return `<li>${pLink(other)} <span class="chip ${d.type === 'convoy' ? 'ok' : ''}">${d.type}</span><br><span class="muted small">${esc(d.name)}, since ${d.start}: ${what}</span></li>`;
      }).join('')}</ul>` : '<p class="muted small">None.</p>'}
      ${pastDeals.length ? `<details><summary>${pastDeals.length} past agreement${pastDeals.length > 1 ? 's' : ''}</summary><ul class="plain small">${pastDeals.map((d) => `<li>${esc(d.name)} (${d.start}–${d.end}) — ${esc(d.endReason ?? '')}</li>`).join('')}</ul></details>` : ''}
      <h4>Borders to traders</h4>
      ${neighbours.length ? `<div class="table-wrap"><table class="policy-grid"><thead><tr><th>Nation</th><th>Their traders here</th><th>Ours there</th></tr></thead><tbody>${neighbours.map((q) => {
        const Q = world.polities[q];
        const mine = accessPolicy(world, p, Q);
        const theirs = accessPolicy(world, Q, p);
        const tone = (x: string) => (x === 'closed' ? 'crit' : x === 'transit' ? 'warn' : x === 'open' ? 'ok' : '');
        return `<tr><td>${pLink(q)}${p.embargoes.has(q) ? ' <span class="chip crit">embargo</span>' : ''}</td><td><span class="chip ${tone(mine)}">${POLICY_LABEL[mine]}</span></td><td><span class="chip ${tone(theirs)}">${POLICY_LABEL[theirs]}</span></td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted small">No known neighbours.</p>'}
      <h4>Roads</h4>
      <p class="small">${[4, 3, 2, 1].filter((l) => roadCount[l]).map((l) => `${ROAD_NAMES[l]}: ${roadCount[l]} tiles`).join(' · ') || 'No roads yet.'}</p>
    </section>

    <section class="card">
      <h3>Military</h3>
      <dl class="facts">
        <div><dt>Levy</dt><dd>${fmt(levy(world, p))} soldiers</dd></div>
        <div><dt>In the field</dt><dd>${fmt(armies.reduce((s, a) => s + a.size, 0))}</dd></div>
      </dl>
      ${meter('War weariness', Math.min(1, p.warExhaustion))}
      ${wars.length ? `<ul class="plain">${wars.map((w) => `<li><span class="chip crit">war</span>${w.parent !== undefined ? ' <span class="chip warn">ally</span>' : ''} ${esc(w.name)} vs ${pLink(w.attacker === id ? w.defender : w.attacker)} <span class="muted small">since ${w.start}, ${w.battles} battles${w.cause ? ` — over ${esc(w.cause)}` : ''}${w.goal !== undefined ? `; the prize: ${esc(world.settlements[w.goal].name)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">At peace.</p>'}
      ${armies.length ? `<h4>Armies</h4><ul class="plain">${armies.map((a) => {
        const target = a.targetSettlement >= 0 ? world.settlements[a.targetSettlement] : null;
        return `<li><b>${esc(a.name)}</b> <span class="muted small">${fmt(a.size)} soldiers, ${a.victories} victories — ${a.siege > 0 && target ? `besieging ${esc(target.name)}` : target ? `marching on ${esc(target.name)}` : 'hunting the enemy'}</span></li>`;
      }).join('')}</ul>` : ''}
    </section>

    <section class="card">
      <h3>Knowledge</h3>
      <p>Era: <b>${polityEra(p)}</b></p>
      ${researching ? `<p class="small">Researching <b>${esc(researching.name)}</b></p>${meter('Progress', Math.min(1, p.researchProgress / techCost(researching)))}` : '<p class="muted small">Nothing left to research that it can reach.</p>'}
      <p><button type="button" data-tech-for="${id}">Open the tech tree for this nation</button></p>
      <p class="small">${ERA_NAMES.map((name, e) => {
        const n = TECHS.filter((t) => t.era === e && p.techs.has(t.id)).length;
        return n ? `<span class="chip">${name.replace(' Age', '')} ${n}</span>` : '';
      }).join(' ')}</p>
    </section>

    <section class="card">
      <h3>Peoples of the realm</h3>
      ${[...races].sort((a, b) => b[1] - a[1]).map(([rid, n]) => meter(esc(world.raceById.get(rid)?.plural ?? rid), n / Math.max(1, p.pop))).join('')}
      <h4>Cultures</h4>
      <ul class="plain">${[...cultures].sort((a, b) => b[1] - a[1]).map(([cid, n]) => {
        const c = world.cultures[cid];
        return `<li>${cLink(cid)} <span class="muted small">${compact(n)} · ${esc(describeValues(world, cid))}</span>${c.traits.length ? `<br>${c.traits.map((t) => `<span class="chip trait" title="${esc(TRAIT_BY_ID.get(t)?.description ?? '')}">${esc(TRAIT_BY_ID.get(t)?.name ?? t)}</span>`).join(' ')}` : ''}</li>`;
      }).join('')}</ul>
    </section>

    <section class="card span2">
      <h3>Court &amp; nobility</h3>
      <p><b>${esc(r.title)} ${esc(r.name)}</b>${dynasty ? ` of <b>${esc(dynasty.name)}</b>` : ''} <span class="muted small">age ${world.year - r.born}, since ${r.since}</span><br>${r.traits.map((t) => `<span class="chip">${t}</span>`).join(' ')}</p>
      ${dynasty ? `<p class="muted small">${esc(dynasty.name)} has ruled since ${dynasty.founded}.</p>` : '<p class="muted small">No ruling dynasty: power passes by custom among the elders.</p>'}
      <h4>Great houses</h4>
      ${nobles.length ? `<div class="table-wrap"><table><thead><tr><th>House</th><th>Seat</th><th class="num">Fiefs</th><th class="num">Prestige</th><th>Loyalty</th></tr></thead><tbody>${nobles.map((hh) => {
        const tone = hh.loyalty < 0.3 ? 'crit' : hh.loyalty < 0.5 ? 'warn' : 'ok';
        const plotting = hh.loyalty <= 0.3 && hh.ambition >= 0.45;
        return `<tr><td><b>${esc(hh.name)}</b><br><span class="muted small">Lord ${esc(hh.head)}${hh.ambition > 0.7 ? ', ambitious' : ''}</span></td><td>${sLink(hh.seatId)}</td><td class="num">${hh.fiefs + 1}</td><td class="num">${hh.prestige.toFixed(1)}</td><td><span class="chip ${tone}">${Math.round(hh.loyalty * 100)}%</span>${plotting ? ' <span class="chip crit">plotting</span>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="muted small">No great houses yet; the crown holds every town directly.</p>'}
      ${p.pastRulers.length ? `<h4>Earlier rulers</h4><ol class="plain small rulers">${p.pastRulers.slice().reverse().slice(0, 12).map((x) => `<li>${esc(x.title)} ${esc(x.name)}${x.houseId !== undefined && world.nobles[x.houseId] ? ` of ${esc(world.nobles[x.houseId].name)}` : ''} (${x.since}–${x.until}) — ${esc(x.fate ?? '')}</li>`).join('')}</ol>` : ''}
    </section>

    <section class="card">
      <h3>Diplomacy</h3>
      ${p.overlord >= 0 ? `<p><span class="chip warn">vassal</span> of ${pLink(p.overlord)} <span class="muted small">— loyalty to its overlord ${Math.round(p.vassalLoyalty * 100)}%</span></p>` : ''}
      ${conf ? `<p><span class="chip ok">confederation</span> <b>${esc(conf.name)}</b> <span class="muted small">since ${conf.founded}, led by</span> ${pLink(conf.leader)}<br><span class="small">Members: ${conf.members.map((m) => pLink(m)).join(', ')}</span></p>` : ''}
      ${pacts.length ? `<ul class="plain">${pacts.map((x) => `<li><span class="chip ${x.type === 'alliance' ? 'ok' : ''}">${x.type}</span> ${pLink(x.a === id ? x.b : x.a)}<br><span class="muted small">${esc(x.name)}, since ${x.start}</span></li>`).join('')}</ul>` : ''}
      ${vassals.length ? `<p class="small">Vassals: ${vassals.map((v) => `${pLink(v.id)} <span class="muted">(${Math.round(v.vassalLoyalty * 100)}% loyal)</span>`).join(', ')}</p>` : ''}
      ${p.tributeTo >= 0 ? `<p class="small">Pays ${compact(p.tributeAmount)} a year in war tribute to ${pLink(p.tributeTo)} until ${p.tributeUntil}.</p>` : ''}
      ${tributaries.length ? `<p class="small">Receives tribute from ${tributaries.map((v) => pLink(v.id)).join(', ')}.</p>` : ''}
      ${!p.pacts.size && !conf && p.overlord < 0 && !vassals.length ? '<p class="muted small">No marriages, alliances or overlords: it stands alone.</p>' : ''}
      ${claims.length ? `<h4>Claims</h4><p class="small">Towns it once held and still calls its own: ${claims.slice(0, 8).map((s) => `${sLink(s.id)} <span class="muted">(${esc(world.polities[s.polityId].name)})</span>`).join(', ')}${claims.length > 8 ? ` and ${claims.length - 8} more` : ''}.</p>` : ''}
      ${cutOff.length ? `<h4>Cut off</h4><p class="small">${cutOff.map((s) => `${sLink(s.id)} <span class="muted">(${s.cutOff} yrs, ${Math.round(s.loyalty * 100)}% loyal)</span>`).join(', ')} cannot be reached from the capital.</p>` : ''}
    </section>

    <section class="card span2">
      <h3>Settlements</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Settlement</th><th>Size</th><th class="num">People</th><th class="num">Wealth</th><th class="num">Stability</th><th class="num">Loyalty</th><th>Held by</th><th>Culture</th></tr></thead>
        <tbody>${towns.slice(0, 40).map((s) => `<tr><td>${sLink(s.id)}${s.id === p.capitalId ? ' <span class="chip">capital</span>' : ''}${s.id === p.hubId && s.id !== p.capitalId ? ' <span class="chip">hub</span>' : ''}</td><td class="small">${settlementTier(s.pop)}</td><td class="num">${compact(s.pop)}</td><td class="num">${compact(s.wealth)}</td><td class="num">${Math.round(s.stability * 100)}%</td><td class="num">${Math.round(s.loyalty * 100)}%${s.connected ? '' : ' <span class="chip crit">cut off</span>'}</td><td class="small">${houseOf(s.holder) ? esc(houseOf(s.holder)!.name) : 'the crown'}</td><td class="small">${esc(world.cultures[s.cultureId].name)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${towns.length > 40 ? `<p class="muted small">…and ${towns.length - 40} more.</p>` : ''}
      <p class="muted small">Total wealth ${compact(wealth)}.</p>
    </section>

    <section class="card"><div id="nation-chart"></div></section>

    <section class="card span2">
      <h3>History</h3>
      ${h.eventList(events, 25)}
    </section>
  </div>`;
}

export function mountNationCharts(world: World, id: number): void {
  const host = document.getElementById('nation-chart');
  const p = world.polities[id];
  if (host) lineChart(host, 'Population over time', [{ name: p.name, color: 'var(--accent)', points: p.popHistory }]);
}

/** Value of the goods a nation cannot supply itself, for sorting and summaries. */
export function shortageValue(p: Polity): number {
  let v = 0;
  for (let g = 0; g < GOOD_COUNT; g++) if (p.deficit[g]) v += (p.needed[g] - p.produced[g]) * GOOD_BASE_PRICE[g];
  return v;
}
