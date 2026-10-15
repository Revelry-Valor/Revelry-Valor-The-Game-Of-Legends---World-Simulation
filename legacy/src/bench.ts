import { defaultConfig } from './engine/config';
import { World } from './engine/world';
import { polityEra } from './engine/chronicle';
const seed = Number(process.argv[2] ?? 7);
const years = Number(process.argv[3] ?? 1000);
const w = new World(defaultConfig({ seed }));
const t = performance.now();
for (let y = 1; y <= years; y++) {
  w.tick();
  if (y % 100 === 0) {
    const st = w.stats[w.stats.length - 1];
    const pols = [...w.alivePolities()].sort((a, b) => b.pop - a.pop);
    const eras = pols.slice(0, 5).map((p) => `${p.name.slice(0, 22)}:${Math.round(p.pop / 1000)}k/${polityEra(p).replace(' Age', '')}`).join(' ');
    const races = Object.entries(st.byRace).map(([r, n]) => `${r.slice(0, 4)}:${Math.round(n / 1000)}k`).join(' ');
    const biggest = Math.max(...[...w.aliveSettlements()].map((s) => s.pop));
    console.log(`y${y} pop ${Math.round(st.population / 1000)}k set ${st.settlements} pol ${st.polities} cul ${st.cultures} wars ${st.wars} maxCity ${Math.round(biggest)} | ${races}\n    ${eras}`);
  }
}
console.log('ms/yr', ((performance.now() - t) / years).toFixed(1), 'events', w.history.length, 'major', w.history.filter((e) => e.importance >= 3).length, 'wars', w.wars.length);
