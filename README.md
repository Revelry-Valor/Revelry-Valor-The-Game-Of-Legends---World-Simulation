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

- **Play / +1 / +10 / +100 / +500** advance time in whole years. The speed slider controls years per second while playing.
- **Real time** switches Play to month-by-month: armies march across the land, meet in battle and besiege towns, and caravans and convoys travel their routes, all moving smoothly between months. Battles flare as ✕ marks and captured towns ring red. The slider then sets months per second, and the year buttons still jump ahead whenever you like.
- **Map layers:** Terrain, Realms (political borders), Cultures, Races, and Resources (pick iron, tin, gold, ley lines and others). **Roads** are drawn by level: dotted trails, brown cart tracks, grey paved roads and dark highways. **Trade routes** (dashed) show only where free traders (gold) and state convoys (green) actually travel. Caravans are coloured by kind: gold merchants, purple trading families, orange nomad caravan tribes, and green squares for convoys. A diamond ◆ marks a capital, a triangle ▲ is an army on the march (its dashed line shows where it is heading), and gold dots ● are merchant caravans.
- **Market:** the market of the selected town. For each good it shows what the town holds and needs, what the good is worth there compared with the average market, and how the value has moved since last year. With no town selected, it shows the world market: where each good is cheapest and dearest, and how much trade is paid in coin versus barter.
- **Nation view:** a full dossier on any nation. It shows what the nation makes, what it needs and what it is short of, its internal, caravan and convoy trade, whether it uses coin or barter, its agreements, how it treats other nations' traders (and how they treat its own), embargoes, trading families, roads by level, tariff, armies and wars, research progress, peoples and cultures (with their survival traits), rulers, settlements, population history and chronicle.
- **Tech tree:** every technology by era, with prerequisite paths drawn between them. Pick a nation to see what it knows, what it is researching, what it can research next, and what it is blocked from by a missing resource. Select a tech to light up the path leading to it and everything it unlocks, and to see which realms know it and who discovered it first.
- **Inspect:** click any settlement, realm or piece of land. Settlements show population by race, food and stability, what people work at, exports and imports, trade partners, great works and local history. Realms show their ruler and dynasty, neighbours and relations, known technology, wars and population over time.
- **Chronicle:** the full history, filterable by importance, kind and name. Click an entry to jump to it on the map. Export it as Markdown for your notes, or download the world as JSON.
- **Setup:** seed, map size, land share, temperature, rainfall, mineral wealth, magic level, calamity frequency, settlement spacing, and a JSON editor for the **races**. Change their biome preferences, growth, lifespan, strengths, research talents, values, and the sound palette their names are built from, or add entirely new peoples.

## What is simulated

| System | How it works |
|---|---|
| **Terrain & climate** | Continents with ridged mountain ranges. Temperature follows latitude and altitude. Prevailing winds carry rain inland, leaving rain shadows and subtropical deserts. Rivers form from drainage (priority-flood), with lakes in wet basins and salt flats in dry ones. |
| **Resources** | Soil fertility, timber, game, fish, stone, copper, tin, iron, coal, gold, gems, salt, wild horses and ley lines. Ore deposits follow geology: mountains and hills carry most ores, rivers carry placer gold, and tin is deliberately scarce. |
| **Settlements & economy** | Each settlement works the land around it, and its territory grows with its population. Workers secure food first, then go wherever the local market pays best, with diminishing returns as resources are worked harder. Crafts turn stone, copper, bronze, iron or steel into tools and weapons; gold and gems become luxuries. Homes need timber, and stone once masonry is known. Food spoils unless stored or salted. |
| **Population** | Growth and death rates differ by race. Famine, crowding, plague, disasters and war take their toll. Each race has a habitat bonus: dwarves can farm the mountains, elves the forests, lizardfolk the marshes. |
| **Markets and money** | Every town values each good by how much it needs it. Scarce, needed goods are worth more there (the town pays more for them and charges more to part with them); plentiful goods are cheap. Before a nation learns Currency its people **barter**: goods are paid for with goods of equal value, which is clumsier and moves less trade. After Currency, trade is paid in **coin** and spare gold is minted into it. The Charts tab shows the world's shift from barter to coin. |
| **Internal trade and roads** | A nation's own towns and villages trade among themselves along neighbour roads and along a road from every town to the nation's hub (its largest settlement). This everyday trade, plus every caravan passing by, is traffic, and traffic builds **roads**. Feet wear trails for free. Above that, each nation spends from its treasury to upgrade its busiest stretches, as far as its knowledge allows: cart tracks with the Wheel, paved roads with Construction, highways with Engineering. Better roads make travel faster, so busy roads draw even more traffic, and neglected roads crumble. |
| **Free traders** | Caravans travel the map month by month to sell where their goods are dear. **Merchant caravans** set out from a town's markets. **Trading families** (named merchant houses such as "House Vel") grow richer and field bigger caravans with every venture, and can go bankrupt. **Nomad caravan tribes** from tribal and horse-riding peoples wander from market to market before returning home. How much a caravan carries depends on its size (pack animals, set by its town, house or tribe) and what it can get: horses to carry more, wagons once the Wheel is known. Caravans pay tolls at foreign markets and smaller tolls to each nation they pass through. They also trade a little in every town along the way, which enriches those towns and draws settlers. Enemies at war seize them, and bandits take them in the wilds. |
| **Trade agreements** | **Access:** each year every nation decides how it treats each neighbour's traders: *tolled* (welcome, but taxed), *passage only* (they may cross but not trade), or *closed*. Nations also **embargo** trade bound for their enemies. **Open Market Accords** between friendly, trade-minded nations remove the tolls. A nation shut out of a neighbour's lands may **ask for transit rights** for its caravans, which may be granted or refused. **Convoy compacts:** when free traders cannot bring in enough of something a nation needs (say iron), its rulers strike a state deal with a nation that has it to spare, such as "the Iron-for-Grain Compact": so much iron a year for so much grain, or for coin once both use currency. The goods travel by state convoy between the two hubs each year. The deals end when the need passes, relations sour, or war breaks out. |
| **Migration & colonisation** | People leave famine, overcrowding, plague and unrest for better places along trade routes, and prefer their own culture and kin. New settlements must keep a minimum distance from all others (the *settlement spacing*, 4 tiles by default). Crowded or expansionist settlements send colonists to the best reachable site for their race, overseas too once they can sail. Colonies beyond a realm's reach become independent. |
| **Technology** | About 50 techs across eight eras, from Stone Age to Industrial. Some need resources: bronze needs copper *and* tin, gained through your own land or through trade. Some need water. The arcane branch exists only with magic on. Research depends on population, curiosity, government and rulers, and techs known by neighbours and trade partners are learned much faster. |
| **Cultures** | Each culture has a language (its own sound palette for names) and eight values: militarism, mercantilism, piety, curiosity, xenophobia, tradition, seafaring and expansionism. Values adapt to how the people live. Cultures also develop **survival traits** from the environment they find themselves in: Seafarers, River-Tamers, Mountain Folk, Woodwise, Horse Lords, Sand-Walkers, Frostborn, Marsh-Dwellers, Great Hunters, Tillers of the Soil, Deep Delvers, Merchant Folk, Hardship-Hardened, Plague-Hardened and Warrior Tradition. Pressure from their land and way of life builds up over generations until the trait is earned (up to four at a time), and it fades if they leave that life behind. Traits make a people better at living off what they have: better yields, food from land others find barren, resistance to famine or disease, and stronger trade or arms. Adapted peoples also seek out more of the land they are adapted to when founding new settlements. Distant, isolated or overseas communities drift apart until a new daughter culture arises. Minorities assimilate into the ruling culture over time. |
| **Nations** | Tribes → chiefdoms → city-states, kingdoms, republics, theocracies and empires, depending on writing, size, diversity and values. Rulers have traits, age by their race's lifespan, and die, get assassinated or fall in battle, sometimes leaving a succession crisis. Stability depends on food, distance from the capital, culture, war weariness and overextension. Unstable provinces rebel and found new realms. Small kin realms may join larger ones peacefully. |
| **Diplomacy & war** | Relations reflect shared culture and race, trade agreements, border friction, rival great powers and rulers' temperaments. When war breaks out, each side **raises named armies**, which move month by month (watch them in Real time) ("the Second Legion of X", "the First Warband of Y") at the settlement nearest the enemy. Armies march over the terrain, intercept enemy armies that come close (especially inside their own lands), fight named field battles ("the Battle of Kufiant Ford"), and besiege and storm towns. Terrain, walls, weapons, horses and warlike traits all count. Armies suffer attrition, worst in deserts, mountains, marshes and tundra, and every soldier lost is a person lost at home. Wars end in treaties followed by truces, and the armies go home. |
| **Events** | Regional droughts and bumper years, epidemics that ride the trade routes, earthquakes, floods, and (with magic) dragons, hydras and giants, sometimes slain by named heroes. Rich cities raise great works. The first people to master each tech and the first city to reach each size are recorded. |

## Project layout

```
src/engine/            deterministic simulation; no DOM, runs in Node or the browser
  world.ts             World state and the yearly tick
  worldgen.ts          terrain, climate, rivers, biomes, resources
  data/                biomes, goods & production sectors, tech tree, races, culture traits (all plain data)
  systems/             territory, economy, trade, roads, caravans, access, agreements, migration, culture, politics, military, technology, events, setup
  chronicle.ts         Markdown chronicle, summaries, JSON snapshot
src/ui/                browser app: map renderer, charts, panels, market, nation view, tech tree
src/cli.ts             headless runner
src/bench.ts           prints a 1000-year trajectory and timing (npx tsx src/bench.ts <seed> <years>)
tests/                 vitest suite (determinism, invariants, options, exports)
```

A medium map (180×110) runs about 1,000 years in under a minute headless, with around 400 settlements, dozens of armies and hundreds of caravans over its history.

## Extending

Everything that defines a setting is data. Add a race in `src/engine/data/races.ts` (or in the Setup panel), add techs in `data/techs.ts` (prerequisites, resource requirements, effects), or new goods and production sectors in `data/economy.ts`. Systems are separate modules under `systems/`, each called once per year from `World.tick()`.
