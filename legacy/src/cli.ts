import { writeFileSync } from 'node:fs';
import { defaultConfig, MAP_SIZES } from './engine/config';
import { chronicleMarkdown, worldSummary } from './engine/chronicle';
import { World } from './engine/world';

/**
 * Headless runner: npm run sim -- --seed 42 --years 500 --size medium --magic 1 --out chronicle.md
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const size = MAP_SIZES[arg('size', 'medium')] ?? MAP_SIZES.medium;
const cfg = defaultConfig({
  seed: Number(arg('seed', '1337')),
  width: size[0],
  height: size[1],
  magic: Number(arg('magic', '1')),
  name: arg('name', 'Aerth'),
});
const years = Number(arg('years', '400'));
const minImportance = Number(arg('importance', '3'));
const out = arg('out', '');

const t0 = performance.now();
const world = new World(cfg);
const t1 = performance.now();
for (let y = 0; y < years; y++) {
  world.tick();
  if ((y + 1) % 100 === 0) {
    const st = world.stats[world.stats.length - 1];
    console.error(`year ${world.year}: pop ${Math.round(st.population).toLocaleString('en-US')}, ${st.settlements} settlements, ${st.polities} polities, ${st.cultures} cultures, ${st.wars} wars`);
  }
}
const t2 = performance.now();
console.error(`worldgen ${(t1 - t0).toFixed(0)} ms, ${years} years in ${(t2 - t1).toFixed(0)} ms (${((t2 - t1) / years).toFixed(1)} ms/yr)`);

if (out) {
  writeFileSync(out, chronicleMarkdown(world, 1));
  console.error(`Chronicle written to ${out}`);
}
console.log(worldSummary(world));
console.log('\n## Major events\n');
for (const e of world.history) if (e.importance >= minImportance) console.log(`- **${e.year}** ${e.text}`);
