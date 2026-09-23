# Revelry & Valor: The Game of Legends — World Simulation

A world simulator for writers, dungeon masters and anyone who wants to watch an imagined world come to life. Generate a planet, seed it with peoples, and watch centuries of history unfold: tribes settle the land, farm and trade, migrate, invent bronze and writing, splinter into new cultures, forge kingdoms and empires, and go to war. Nothing is scripted. Every event comes from the world's geography and resources and from the choices of its peoples.

Every run is deterministic. The same seed and settings always produce the same history, so a world you like can be shared or regenerated.

## Quick start

```bash
npm install
npm run dev        # open the interactive map in your browser
npm run sim -- --seed 42 --years 600 --out chronicle.md   # headless run, writes a full chronicle
npm test
```

CLI options: `--seed`, `--years`, `--size small|medium|large|huge`, `--magic 0|1|2`, `--name`, `--importance 1|2|3` (how much of the chronicle to print), `--out file.md`.

## Using the map

- **Play / +1 / +10 / +100 / +500** advance time. The speed slider controls years per second while playing.
- **Map layers:** Terrain, Realms (political borders), Cultures, Races, and Resources (pick iron, tin, gold, ley lines and others). Trade routes are drawn brown overland and teal dashed by sea. Roads appear where traffic has worn them in. A diamond ◆ marks a capital.
- **Inspect:** click any settlement, realm or piece of land. Settlements show population by race, food and stability, what people work at, exports and imports, trade partners, great works and local history. Realms show their ruler and dynasty, neighbours and relations, known technology, wars and population over time.
- **Chronicle:** the full history, filterable by importance, kind and name. Click an entry to jump to it on the map. Export it as Markdown for your notes, or download the world as JSON.
- **Setup:** seed, map size, land share, temperature, rainfall, mineral wealth, magic level, calamity frequency, and a JSON editor for the **races**. Change their biome preferences, growth, lifespan, strengths, research talents, values, and the sound palette their names are built from, or add entirely new peoples.

## What is simulated

| System | How it works |
|---|---|
| **Terrain & climate** | Continents with ridged mountain ranges. Temperature follows latitude and altitude. Prevailing winds carry rain inland, leaving rain shadows and subtropical deserts. Rivers form from drainage (priority-flood), with lakes in wet basins and salt flats in dry ones. |
| **Resources** | Soil fertility, timber, game, fish, stone, copper, tin, iron, coal, gold, gems, salt, wild horses and ley lines. Ore deposits follow geology: mountains and hills carry most ores, rivers carry placer gold, and tin is deliberately scarce. |
| **Settlements & economy** | Each settlement works the land around it, and its territory grows with its population. Workers secure food first, then go wherever the local market pays best, with diminishing returns as resources are worked harder. Crafts turn stone, copper, bronze, iron or steel into tools and weapons; gold and gems become luxuries. Homes need timber, and stone once masonry is known. Food spoils unless stored or salted. |
| **Population** | Growth and death rates differ by race. Famine, crowding, plague, disasters and war take their toll. Each race has a habitat bonus: dwarves can farm the mountains, elves the forests, lizardfolk the marshes. |
| **Trade** | Settlements find partners by pathfinding over the real terrain: roads, rivers, and coastal or open-sea routes once sailing and navigation are known. Merchants move goods from where they are cheap to where they are dear, if the price gap beats the journey. War blocks trade; distrust of foreigners dampens it. Trade builds wealth, spreads technology and warms relations. Rulers collect tribute in grain, which feeds large capitals. |
| **Migration & colonisation** | People leave famine, overcrowding, plague and unrest for better places along trade routes, and prefer their own culture and kin. Crowded or expansionist settlements send colonists to the best reachable site for their race, overseas too once they can sail. Colonies beyond a realm's reach become independent. |
| **Technology** | About 50 techs across eight eras, from Stone Age to Industrial. Some need resources: bronze needs copper *and* tin, gained through your own land or through trade. Some need water. The arcane branch exists only with magic on. Research depends on population, curiosity, government and rulers, and techs known by neighbours and trade partners are learned much faster. |
| **Cultures** | Each culture has a language (its own sound palette for names) and eight values: militarism, mercantilism, piety, curiosity, xenophobia, tradition, seafaring and expansionism. Values adapt to how the people live. Distant, isolated or overseas communities drift apart until a new daughter culture arises. Minorities assimilate into the ruling culture over time. |
| **Nations** | Tribes → chiefdoms → city-states, kingdoms, republics, theocracies and empires, depending on writing, size, diversity and values. Rulers have traits, age by their race's lifespan, and die, get assassinated or fall in battle, sometimes leaving a succession crisis. Stability depends on food, distance from the capital, culture, war weariness and overextension. Unstable provinces rebel and found new realms. Small kin realms may join larger ones peacefully. |
| **Diplomacy & war** | Relations reflect shared culture and race, trade, border friction, rival great powers and rulers' temperaments. Wars have causes, names, battles shaped by terrain, fortifications, weapons, horses and supply lines, conquests, plunder, capitals falling, and treaties followed by truces. |
| **Events** | Regional droughts and bumper years, epidemics that ride the trade routes, earthquakes, floods, and (with magic) dragons, hydras and giants, sometimes slain by named heroes. Rich cities raise great works. The first people to master each tech and the first city to reach each size are recorded. |

## Project layout

```
src/engine/            deterministic simulation; no DOM, runs in Node or the browser
  world.ts             World state and the yearly tick
  worldgen.ts          terrain, climate, rivers, biomes, resources
  data/                biomes, goods & production sectors, tech tree, races (all plain data)
  systems/             territory, economy, trade, migration, culture, politics, technology, events, setup
  chronicle.ts         Markdown chronicle, summaries, JSON snapshot
src/ui/                browser app: map renderer, charts, panels
src/cli.ts             headless runner
src/bench.ts           prints a 1000-year trajectory and timing (npx tsx src/bench.ts <seed> <years>)
tests/                 vitest suite (determinism, invariants, options, exports)
```

A medium map (180×110) runs about 1,000 years in 15 seconds headless, with 600+ settlements.

## Extending

Everything that defines a setting is data. Add a race in `src/engine/data/races.ts` (or in the Setup panel), add techs in `data/techs.ts` (prerequisites, resource requirements, effects), or new goods and production sectors in `data/economy.ts`. Systems are separate modules under `systems/`, each called once per year from `World.tick()`.
