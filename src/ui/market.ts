import { settlementTier } from '../engine/chronicle';
import { GOOD_BASE_PRICE, GOOD_COUNT, GOOD_NAMES } from '../engine/data/economy';
import { usesCoin } from '../engine/systems/trade';
import type { Settlement } from '../engine/types';
import type { World } from '../engine/world';
import { compact } from './chart';
import type { UiHelpers } from './nation';

const money = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Average trade value of each good across all living markets. */
export function worldPrices(world: World): Float64Array {
  const sum = new Float64Array(GOOD_COUNT);
  let n = 0;
  for (const s of world.aliveSettlements()) {
    n++;
    for (let g = 0; g < GOOD_COUNT; g++) sum[g] += s.price[g];
  }
  for (let g = 0; g < GOOD_COUNT; g++) sum[g] = n ? sum[g] / n : GOOD_BASE_PRICE[g];
  return sum;
}

function status(s: Settlement, g: number): { label: string; tone: string } {
  const ratio = s.stock[g] / Math.max(0.5, s.target[g]);
  if (s.target[g] < 0.5 && s.stock[g] < 0.5) return { label: '—', tone: '' };
  if (ratio < 0.4) return { label: 'badly needed', tone: 'crit' };
  if (ratio < 0.9) return { label: 'wanted', tone: 'warn' };
  if (ratio > 2) return { label: 'plentiful', tone: 'ok' };
  return { label: 'enough', tone: '' };
}

/**
 * The market of one town: what it holds, what it needs, and what each good is worth there.
 * Needed goods are dear (the town pays more for them and charges more to part with them);
 * plentiful goods are cheap. Merchants profit by carrying goods from cheap markets to dear ones.
 */
export function renderMarket(world: World, id: number, h: UiHelpers): string {
  const avg = worldPrices(world);
  if (id < 0 || !world.settlements[id]?.alive) return renderWorldMarket(world, avg, h);
  const s = world.settlements[id];
  const p = world.polities[s.polityId];
  const coin = usesCoin(p);
  const rows = Array.from({ length: GOOD_COUNT }, (_, g) => g).filter((g) => s.stock[g] > 0.3 || s.target[g] > 0.3 || s.produced[g] > 0.3);
  return `
    <header class="head">
      <p class="eyebrow">Market · ${settlementTier(s.pop)}</p>
      <h2>${h.esc(s.name)}</h2>
      <p class="sub">${coin ? 'Trades for coin: prices below are in silver.' : 'A barter market: goods are traded for goods, weighed by the values below (in silver-equivalents).'} Values rise for what the town needs and fall for what it has plenty of.</p>
      <p class="actions"><button type="button" data-market="-1">World market overview</button></p>
    </header>
    <div class="table-wrap"><table class="market">
      <thead><tr><th>Good</th><th class="num" title="Held in the town's stores">Store</th><th class="num" title="What the town wants on hand for a year">Need</th><th class="num" title="Trade value here, in silver">Value</th><th class="num" title="Compared with the average market">vs avg</th><th class="num" title="Change since last year">Trend</th></tr></thead>
      <tbody>${rows.map((g) => {
        const rel = s.price[g] / avg[g] - 1;
        const trend = s.price[g] / Math.max(0.01, s.lastPrice[g]) - 1;
        const st = status(s, g);
        return `<tr><td><span class="need ${st.tone}" title="${st.label}"></span>${GOOD_NAMES[g]}</td><td class="num">${compact(s.stock[g])}</td><td class="num">${compact(s.target[g])}</td>
          <td class="num"><b>${money(s.price[g])}</b></td>
          <td class="num ${rel > 0.15 ? 'up' : rel < -0.15 ? 'down' : ''}">${rel >= 0 ? '+' : ''}${Math.round(rel * 100)}%</td>
          <td class="num ${trend > 0.05 ? 'up' : trend < -0.05 ? 'down' : ''}">${trend > 0.05 ? '▲' : trend < -0.05 ? '▼' : '·'}${Math.abs(Math.round(trend * 100))}%</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="legend-line small"><span class="need crit"></span>badly needed <span class="need warn"></span>wanted <span class="need"></span>enough <span class="need ok"></span>plentiful. Red values are dearer than average, green cheaper.</p>
    <section>
      <h3>Trade here last year</h3>
      <p class="small"><span class="k">Internal</span> ${compact(s.tradeByKind.internal)} · <span class="k">Caravans</span> ${compact(s.tradeByKind.caravan)} · <span class="k">Convoys</span> ${compact(s.tradeByKind.convoy)} · <span class="k">Passing</span> ${compact(s.transit)}</p>
      <p class="small"><span class="k">Treasure</span> ${compact(s.wealth)} ${coin ? 'silver' : 'in goods and valuables'}</p>
    </section>`;
}

function renderWorldMarket(world: World, avg: Float64Array, h: UiHelpers): string {
  const alive = [...world.aliveSettlements()].filter((s) => s.pop > 300);
  const coinShare = (() => {
    const st = world.stats[world.stats.length - 1];
    const t = st.coinTrade + st.barterTrade;
    return t > 0 ? st.coinTrade / t : 0;
  })();
  return `
    <header class="head">
      <p class="eyebrow">World market</p>
      <h2>Where goods are cheap and dear</h2>
      <p class="sub">${Math.round(coinShare * 100)}% of last year's trade was paid in coin; the rest was barter. Select a town on the map, then this tab, to see its market.</p>
    </header>
    <div class="table-wrap"><table class="market">
      <thead><tr><th>Good</th><th class="num">Avg value</th><th>Cheapest</th><th>Dearest</th></tr></thead>
      <tbody>${Array.from({ length: GOOD_COUNT }, (_, g) => {
        let lo: Settlement | null = null;
        let hi: Settlement | null = null;
        for (const s of alive) {
          if (s.stock[g] > 1 && (!lo || s.price[g] < lo.price[g])) lo = s;
          if (s.target[g] > 1 && (!hi || s.price[g] > hi.price[g])) hi = s;
        }
        return `<tr><td>${GOOD_NAMES[g]}</td><td class="num">${money(avg[g])}</td>
          <td>${lo ? `${h.sLink(lo.id)} <span class="muted small">${money(lo.price[g])}</span>` : '—'}</td>
          <td>${hi ? `${h.sLink(hi.id)} <span class="muted small">${money(hi.price[g])}</span>` : '—'}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
}
