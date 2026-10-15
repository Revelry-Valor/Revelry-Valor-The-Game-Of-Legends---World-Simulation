# Revelry & Valor: Redesign

This document records the design decisions for rebuilding the game from the ground up. Nothing here is built yet. The rule for this rebuild: the whole design is agreed first, step by step, and only then is any of it coded.

Items marked **Proposed** are suggestions waiting for a decision. Items marked **Open** are questions still to answer.

---

## 1. Principles

- **A nation simulation first.** The world exists to simulate peoples and nations. The terrain serves that; it is not a terrain simulation.
- **No tiles.** Nothing in the simulation lives on a grid of squares. Positions are real distances (miles/km). Areas such as territory are shapes with real boundaries.
- **No elevation.** Land is not stored as heights. Height is shown only by drawing: the size of features, light and shadow, texture and similar art techniques, like a painted map.
- **Painted, not simulated.** Terrain is created like an art program (Photoshop-style) and drawn to look realistic. No erosion simulation.
- **Layers that don't fight.** Each kind of feature is its own layer. Editing one never changes another.

---

## 2. Start screen

- **Create world:** opens the world builder (this document mostly covers the builder).
- **Continue sim:** loads a saved world.
  - Inside a running world, almost everything can be changed except the land itself (terrain, rivers and other land features). This is for steering the world while watching it run.
  - **Edit world** goes back into the builder to change the land.

---

## 3. Map types

### Flat map world
- A region of a world: one continent or part of one.
- **Size:** three presets, or a custom width and height.
  - Proposed presets: Region about 500 × 300 miles; Continent about 2,000 × 1,200 miles; Large continent about 4,000 × 2,400 miles.
- **Expanding:** in the canvas options, choose which directions to expand and how far. Expanding north or south extends the map's latitudes to match. Nothing already on the map moves or changes.
- **Edges (a setting per world):** the ocean wraps east to west, or anything off the map simply has no effect. North and south edges never wrap.
- A flat map world stays flat. It cannot be turned into a globe.

### Globe world
- A whole planet with continents. It must be started as a globe.
- Two views, both editable: a **3D globe** and a **flat view** of it. You can switch between them, or show both side by side. A stroke made on one view appears on the other when the stroke is finished.
- **Growing:** the planet grows around what is already there. Nothing stretches: continents keep their real size, new ocean appears between them, and since each continent now spans fewer degrees, climate is recalculated.
- The size presets apply to flat maps only.
- 3D uses three.js.

### While the simulation runs
- You switch between the globe and the flat view.

---

## 4. World settings (part of Create world)

- Size (see map types)
- Axial tilt: how harsh the seasons are and how far the climate belts shift between seasons
- Day length (rotation rate): changes where the wind belts sit (see 7.3)
- Rotation direction (eastward assumed; flip the map for westward)
- Average world temperature (default 15 °C): drives rainfall automatically; also widens the tropical belt about 1° per 4 °C warmer
- **Rainfall override:** rainfall can be unlocked from the automatic setting and set directly. It works by shifting how far moisture reaches inland and the wet/dry thresholds.
- Seed: one number that fixes all randomness, so the same drawing gives the same world
- Climate sliders (see 7.2)

---

## 5. World layers

The world can have up to five layers. The extra layers are optional and shown when you choose.

| Layer | What it is |
|---|---|
| Sky layer 3 (highest) | Sky islands |
| Sky layer 2 | Sky islands |
| Sky layer 1 (lowest) | Sky islands |
| **Surface** (main layer) | Continents, seas, all painted land features |
| **Underdark** | Caverns, tunnels and underground seas beneath the land |

- Viewing a sky layer draws it over the land below. Each higher sky layer is drawn over the ones below it.
- **Canopy view** (between the surface and sky layer 1): shows only the crowns of giant trees, with their limbs and settlements, drawn over the land the same way the sky layers are.

### Underdark
- Drawn only where the land is above it; everything outside the land is sea.
- You draw caverns, tunnels and underground seas into the rock.
- Cave entrances are symbols linked to a spot on the surface. Shafts can also reach down.
- Races can dig permanent tunnels that act as underground roads, for example dwarf kingdoms connecting to each other, and Rabbit-race warrens. More races will dig later.
- Has its own ground cover brushes (for example fungus forests, glowing caves, crystal caverns).

### Sky layers and sky islands
- Sky islands are land on the sky layers.
- Islands don't block sunlight, rain or wind for the land below.
- Each sky layer has its own climate: colder and windier the higher it is.
- Islands are mostly fixed. They can optionally drift, either following the wind or along a path you set. This works differently on flat maps and globes.
- A drifting island's waterfalls have no effect on the land below.

### Giant vines
- A brush for huge vines that act as land bridges, for races to travel up, down and across.
- Drawn point to point, on one layer (between islands) or from one layer to another.
- Also decorative.
- Cannot be cut, for now.

### Travel between layers
- Airships and flying races travel between layers. Designed later, with the simulation.

---

## 6. The builder

### 6.1 Land & Sea (the base)
- **Continents:** flat land, the base everything else is drawn on.
- **Shallow sea:** continental shelves and banks. Reefs can only form here.
- **Deep sea.**

### 6.2 Painted feature brushes

**Look:** realistic painted terrain in every view, with no icons. Forests have their own canopy pattern (a texture of treetops, not tree symbols).

**How they work:**
- You paint, and the program draws realistic-looking terrain where you painted.
- Each feature type is its own layer. Layers stack in order: land, plateaus, hills, mountains, cliffs, canyons, ground cover, water.
- The simulation reads only *which feature is where* (for example, "this spot is mountains": slow travel, poor farming, ore). It never reads a height.

**Brush settings:** size, strength (density or boldness; for mountains, bigger peaks), softness, roughness of the outline, detail scale (the size of individual peaks or bumps), variation (so repeated strokes don't look copied).

**Brushes:**

| Brush | How you use it | Notes |
|---|---|---|
| Mountains | Three modes (below) | Lit on one side, shadowed on the other |
| Hills | Paint an area | Soft rolling bumps |
| Plateau | Paint the shape of the top | Flat raised top, steep shaded rim |
| Cliffs | Draw a line | Sheer face, inland or on a coast |
| Canyon / gorge | Draw a line | Blocks travel (see 6.6) |
| Ravines | Draw a line | Narrow cracks in the earth; block travel |
| Badlands | Paint an area | |
| Craters | Place or paint | |
| Volcanoes | Their own tool (see 6.5) | |
| Dunes | Paint an area | |
| Glaciers | Paint an area | |
| Salt flats | Paint an area | |
| Marsh | Paint an area | |
| Beach / shoreline | Paint along coasts | Sandy or rocky strip |
| Forest and other ground cover | Paint an area | Canopy texture |
| Giant trees | Their own tool (see 6.4) | |
| Whirlpools | Place at sea | Each has a "dangerous to ships" setting |
| Eraser | Per layer | Removes only the selected layer |
| Blend / smudge | Per layer | Softens edges, pushes paint around |

**Mountains: three modes**
1. **Range:** drag a line. Peaks and ridges follow it, tallest along the middle of the crest.
2. **Spur:** start a stroke on an existing range and drag outward. It snaps on and joins smoothly, starting as big as the range where it meets it and getting smaller and lower-looking toward its end. Spurs can branch off spurs.
3. **Massif:** paint an area for a broad, knotted mountain block.

Side ridges: both an automatic **Side ridges** slider (small natural ridges and valleys down both sides of a range) and spurs you draw by hand.

### 6.2a Mountain zones
Every mountain area has altitude zones, like the bands on a real mountain. They exist only in the simulation and in a view you can turn on; nothing is drawn by height.

| Zone | Travel | Who can settle |
|---|---|---|
| Foothills | Slightly slow | Anyone |
| Highlands | Slow | Most races: villages, mining camps, forts |
| High mountains | Impassable except by roads, passes or able races | Only mountain-adapted races (such as the goat-like race) |
| Peaks | Impassable | Nobody, except special cases |

- **Automatic:** when you paint mountains, zones fill in by themselves: foothills along the outer edge, then highlands, then high mountains toward the middle, and peaks along the crest where the paint is boldest. Bigger, denser ranges get more high ground.
- **Zone brush:** repaint zones by hand (for example a high plateau, or an easier crossing).
- Zones also feed the climate (higher is colder, peaks hold snow) and animals (mountain species live higher up).
- The Rain Shadow Pen stays separate, for rain only.

**Ground cover** (forest, jungle, swamp, dunes, grassland, tundra, ice): either worked out from the climate automatically, or painted by hand. Painted cover overrides the climate in that spot.

### 6.3 Rain Shadow Pen
A separate tool. You draw lines along crests and edges by hand (never suggested automatically). They tell the climate where high ground is. Nothing is drawn on the map from them.

| Type | Hidden height class (climate only) | Shape |
|---|---|---|
| Low hills | ~0.5 km | Gentle both sides, weak shadow |
| High hills | ~1 km | Light shadow |
| Mountains | ~2.5 km | Full shadow for most air |
| High mountains | ~4 km+ | Full shadow even for moist tropical air |
| Escarpment / plateau edge | ~1.5 km | One-sided: steep face, high flat top behind |
| Coastal cliff | ~0.3–1 km | One-sided: steep face to the sea |
| Plateau (closed outline) | ~1–2 km | Edges act as escarpments; top raised, cooler, drier further in |

**Settings per line:** height class (presets or slider, can vary along the line), slope width on each side, and which side is steep for one-sided types (shown with tick marks like escarpment symbols).

**How the climate uses it:**
1. Moist air hitting the windward slope drops most of its rain in a strip about as wide as the slope. That slope is wet and forested.
2. Only a share carries over. The share depends on the height class and the air: tropical air needs over 3 km to be fully blocked, polar air about 1 km.
3. Behind the line, the rain shadow runs downwind until new moisture arrives.
4. Plateaus and cliffs: rain falls at the steep face; what's left continues across the top, so a plateau gets drier further in.
5. **Gap tool:** cuts a pass in a line so moisture slips through.
6. The same height class cools the land (about 6.5 °C per km) and, later, can make travel harder.

**Seeing it:** a toggle shows the lines, with a rainfall preview that updates as you draw.

### 6.4 Giant trees
- A physical feature, like a mountain. Huge: the crown can reach mountaintops and sometimes the lower sky islands.
- **Species**, for example oak-like, fern-like and mushroom-like. A few types, and for each you choose what it can do:
  - produce (huge) fruit;
  - bark farming (plants that grow on the bark);
  - shelter for certain races;
  - settlements **inside** the tree, **on** it, or **under** it. For example, the mushroom-like tree's crown is wide enough for a smaller settlement on the ground beneath its canopy.
- **Tree settlements:** the biggest settlement in the trunk or centre, with up to towns along the limbs (mainly bird races).
- The tree can't be mined. People can farm its bark, harvest what it produces, and hunt there (especially avian races).

### 6.5 Volcanoes
- Placed anywhere (on mountains or elsewhere). Lava flows are drawn from them the way rivers are.
- Active volcanoes and lava flows produce resources: obsidian, sulfur, pumice and basalt stone, rich ash soil (good farming), geothermal heat and hot springs, gems, rare metals.
- **Eruptions:** a god-mode function. You trigger one, or set them to happen every so often.

### 6.6 Travel blockers
- Canyons and ravines block travel. People cross only where there's an opening, or where the simulation builds a bridge because trade or travel needs one.
- Whirlpools can be set as dangerous to ships, or harmless.

### 6.7 Climate crystals
- Natural formations that change the climate around them. You place them and set strength and reach; nearby crystals add together.
- **Kinds:** heat (sun crystals), cold, rain.
- Example: enough sun crystals in the lakes of a cold continent warm it into a humid jungle.
- Smaller crystals grow around the large ones over time. Small ones can be harvested; large ones cannot.

### 6.8 Water: rivers, lakes, rifts and waterfalls
**Rivers**
- **Drawn by hand:** draw the course yourself.
- **Point mode:**
  1. Click where the river starts (its source).
  2. Click points along the general path you want it to take. The order of the points is the direction it flows: the river runs from the first point down to the last.
  3. It ends when you press Enter after the last point, or as soon as you place a point on water (sea, lake or another river).
  4. The river is then generated through your points, following their direction.
- **How the course is generated (decided):** with no heights, the river uses the painted features as terrain. Between your points it winds through low ground and the valleys between ranges, goes around mountains, hills and plateaus, and follows ravines and canyons where they lead the right way.
- **Joining:** each river that flows into another makes the river below it bigger from that point on.
- Rivers look realistic, winding naturally.

**Lakes**
- Placed by you, or created automatically by rifts and waterfalls. Rainfall never creates lakes on its own.

**Rifts**
- Sources of fresh water, for example on sky islands. All rifts are the same size, but you can set a larger lake to form around one.
- Permanent rifts, and temporary ones that come and go.
- Rivers flow out of a rift's lake, drawn by hand or by selecting points.

**Waterfalls**
- A river that reaches a sky island edge or a cliff becomes a waterfall automatically. You can also place waterfalls.
- A wider river makes a wider waterfall.
- A lake forms where a waterfall lands.
- The ground under and around a waterfall becomes more fertile and wetter. For example, waterfalls over a desert make an oasis.
- Water is tracked from island to island and from island down to the land.

---

## 6A. Mana, ley lines, world tree roots and rifts

Mana flows through the world along two kinds of lines. Both are metaphysical: they are not physical features on the land. Where lines meet, cross or run alongside each other, more mana is released, shown as a **mana heat map**.

### Ley lines (the traditional kind)
- **Nodes:** special structures such as pyramids, temples, towers (mage towers and schools of magic), dawn cities, and places of mass worship.
- **Natural nodes:** volcanoes, whirlpools and similar features, the poles, and high-pressure zones.
- Nodes connect to each other with ley lines, forming a loose web across the world.
- **Growth:** early in the simulation there are few nodes. As towers, temples and places of worship are built, more connections appear, making more lines and more intersections.
- Paths and intersections carry denser mana: the more lines meet, the stronger the spot on the heat map.

### World tree roots (this world's own kind)
- **Anchor:** you choose one place on the world as the main connection where the world tree's roots enter the world.
- **Main roots:** spread out from the anchor across the surface, following mountain chains, deep seas and coastlines, and running generally away from the anchor.
- **Sprouts:** smaller roots branch off toward nearby areas of note. For example, a mountain range next to one with a main root gets a sprout reaching out to it.
- **Major features:** where roots hit a major feature such as a volcano, they sprout out in several directions.
- **Building:** when things are built, roots branch out to connect to them, or deepen existing connections.
- **Shared targets:** roots from different places can reach the same feature. For example, if mountains A and B both have roots, and mountain C lies between them, roots from both can reach C.
- Wherever roots connect, cross, or travel alongside each other, more mana is released, on the same heat map as ley lines.

### Rifts
- **Permanent rifts** form where mana and intersections are strong enough and nothing is actively using the mana there (such as a city or a mountain range).
- **Short-lived rifts** form the same way, and also when corruption gets too high. They also spawn randomly anywhere else. They don't last long enough to create permanent rivers or lakes.
- **Resources:** rifts yield resources that are rare or impossible to find in the mortal plane. Different rifts give different resources, in different amounts. This makes them great sources of wealth, so settlements and trade routes shift toward them.
- **Water:** some rifts release fresh water (see 6.8).
- **Collecting:** nations and guilds gather rift resources with armies or adventuring parties, and sell them in settlements.

### Holding a rift
When a rift appears, the nation that controls the land can:
- build an **encampment** around it;
- let a **guild** build a guild encampment;
- station a **military encampment**;
- send a **party** every so often to keep its strength down;
- or ignore it.

How long the rift will last and how strong it is decide how often it must be looted or fought to stop the monsters on the other side spilling through.

### When rifts go wrong
1. **Rift break:** the rift becomes too strong.
2. **Monster tide:** if a rift breaks with no defences, or the defences fall, monsters slowly spread out into the land, besieging what they reach.
3. **Monster hordes:** then alphas and strong monster types come through, forming hordes that charge out and destroy settlements, if the tide's sieges hadn't already.

---

## 7. Climate system

Climate is built as a fixed chain of rule-based passes, run once for summer and once for winter, then the two seasons are compared to assign climate zones. The method follows Worldbuilding Pasta's climate series (Part VIa, Part VIb).

### 7.1 Scope decisions
- Two fixed seasons (summer, winter) that the sim switches between. No continuous seasonal simulation.
- The ITCZ is not simulated over time; one position is computed per season from that season's warmest latitudes.
- No third "2 months after peak summer" snapshot.
- Kept: upwelling, downwelling, coastal fog, fisheries.
- Reefs present or absent only; no reef types.
- "Very wet" vs "wet" everywhere, not just the tropics.
- Kept: land vs ocean heating differences, rain shadows.
- Key distances and thresholds are sliders.

### 7.2 Inputs and sliders
**Where climate is computed (no tiles):** an invisible set of climate points about 25–50 km apart, smoothly blended. On a globe they are spread evenly over the sphere. Nothing in the simulation lives on these points; towns, tribes and borders stay at real positions, and the points only answer "what's the climate here?". Every layer is stored per season and per point.

**Fixed inputs**
- Land/sea mask.
- Height information from the Rain Shadow Pen (height class and relief), instead of elevation.
- Latitude of each point.
- Rotation direction (eastward assumed).
- Rotation rate (day length): sets how many circulation cells there are and where their edges sit.
- Axial tilt: sets how far the ITCZ and pressure zones shift between seasons.
- Climate crystals (heat, cold, rain), waterfalls and oases as local modifiers.

**Sliders**

| Slider | Default | Controls |
|---|---|---|
| Moisture carry distance | 2,000 km | How far rain-bearing air travels inland before drying out |
| Moisture blocking relief | 1 km | Height that stops moisture and creates a rain shadow |
| Warm current strength | +15 °C max | Peak warming of coasts by poleward currents |
| Cold current strength | −10 °C max | Peak cooling of coasts by equatorward currents |
| Reef minimum water temperature | 18 °C | Coldest-month sea temperature reefs need |
| Global average temperature | 15 °C | Overall warmth; widens the Hadley cell about 1° per 4 °C warmer |
| Altitude cooling rate | 6.5 °C per km | Temperature drop with height class |
| Minimum current travel | 30° latitude | Currents shorter than this get no temperature effect |

### 7.3 Pipeline (per season)
1. Inputs: land/sea mask, Rain Shadow Pen lines, latitude, rotation, global temperature.
2. Idealized wind belts (trades, westerlies, polar easterlies).
3. Ocean currents traced from continents, latitude and wind belts.
4. Base temperature by latitude and season.
5. Temperature corrections: currents, land vs ocean, continentality, altitude, climate crystals.
6. Thermal equator, then ITCZ position.
7. Pressure zones: subtropical highs, subpolar lows, polar highs, winter continental highs.
8. Final seasonal winds and fronts.
9. Upwelling, downwelling, fog and fisheries.
10. Moisture trace and precipitation (dry / wet / very wet), including rain shadows.
11. Climate zones from both seasons.
12. Coral reefs.

Optionally loop back to step 4 once if ice or forest cover changed a lot.

### 7.4 Pressure zones and winds
Pressure zones are placed fresh each season, not from a fixed latitude table. Air flows from high to low pressure; Coriolis deflects it right in the north and left in the south.

| Zone | Latitude | Summer vs winter | Air | Weather |
|---|---|---|---|---|
| ITCZ (low) | 0–10° over ocean; up to 20–25° over land in summer | Follows each season's warmest latitude | Rising | Very wet |
| Subtropical highs | ~25° in winter, ~35° in summer; over the eastern side of oceans, on the cold leg of each gyre | Poleward in summer | Sinking | Dry |
| Subpolar lows / polar front | ~50–65° | Stronger and further equatorward in winter | Rising | Stormy, wet |
| Polar highs | 75–90° | Little shift | Sinking | Cold, dry |
| Winter continental highs | Interiors of large landmasses ~5–10 °C colder than ocean at the same latitude | Winter only | Sinking | Cold, dry; air pushed offshore |
| Summer thermal lows (optional) | Hot continental interiors | Summer only | Rising | Draw monsoon air inland |

- **ITCZ per season:** take the warmest latitude in each column of longitude, then smooth the line so it doesn't zigzag through mountains.
- **Rotation around pressure centres:** highs spiral outward, clockwise in the north, counterclockwise in the south; lows spiral inward, the opposite way.

**Prevailing winds** (named by the direction they blow from)

| Belt | Latitude | Northern Hemisphere | Southern Hemisphere |
|---|---|---|---|
| Trades | 0–30° | From the NE | From the SE |
| Westerlies | 30–60° | From the SW | From the NW |
| Polar easterlies | 60–90° | From the NE | From the SE |

- **Monsoon flip:** trades blow toward the ITCZ, not the equator. When the ITCZ moves into the summer hemisphere, the other hemisphere's trade wind crosses the equator and curves east: a SE trade becomes a SW onshore wind. Those coasts are wet in summer and dry in winter.
- **Fronts:** where winds from two neighbouring highs meet, place a front closer to the western high. Fronts are rainy zones used by the precipitation step.
- **Mountains:** a range at a shallow angle to the wind steers it along the range; a range across the wind doesn't block the wind itself, only its moisture.

**Rotation rate changes the cell edges**

| Day length | Cell boundaries |
|---|---|
| ½ day | 25°, 40°, 55°, 70° (five cells per hemisphere) |
| 1 day (Earth) | 30°, 60° |
| 2 days | 40°, 70° |
| 4 days | 55° (no polar cell) |
| 16 days | ~70° |

### 7.5 Ocean currents
A current's temperature is relative to where it is now:
- **Warm:** moving poleward, carrying water warmer than the local latitude.
- **Cold:** moving equatorward, carrying water colder than the local latitude.
- **Neutral:** moving east or west at roughly constant latitude. Keeps its anomaly for about 10° of latitude after turning, then matches local temperature.

**Segments of a basin** (Northern Hemisphere; mirror for the Southern)

| Segment | Latitude | Direction | Temperature | Coast affected |
|---|---|---|---|---|
| Equatorial current | ~5–20° | Westward | Neutral, warming as it goes | Western side of the ocean |
| Equatorial countercurrent | ~3–10° (ITCZ side) | Eastward | Warm | Eastern side of the ocean |
| Western boundary current | ~10–40° | Poleward; narrow and fast | Warm | East coasts of continents |
| Mid-latitude drift | ~40–50° | Eastward across the ocean | Mildly warm | Arrives at the far west coast |
| Poleward branch | ~50–70° | Poleward along the coast | Warm; strongest (up to +15 °C, peaking near 60°) | High-latitude west coasts |
| Eastern boundary current | ~45° down to ~15° | Equatorward; broad and slow | Cold, with upwelling | West coasts of continents |
| Polar return current | ~60–80°, then down the coast | Westward, then equatorward | Cold (up to −10 °C, peaking near 60°) | High-latitude east coasts |
| Circumpolar current | Any band with no land in the way | Eastward all the way round | Cold | Isolates the pole, making it colder |

**Gyres:** subtropical (~10–45°) clockwise in the north, counterclockwise in the south; subpolar (~45–70°) the opposite.

**Tracing**
1. One eastward countercurrent per ocean along the equator; it splits into two westward equatorial currents where it hits a coast.
2. Where an equatorial current reaches a continent's east coast, it turns poleward as a warm western boundary current, a few hundred km offshore.
3. In the westerly belt it turns east, leaves the coast at 40–50° and crosses the ocean.
4. At the far coast it splits: one branch runs equatorward (cold) back to the equatorial current; the other runs poleward (warm).
5. If no land or sea ice blocks it, the poleward branch reaches ~80°, turns west and comes back equatorward (cold).
6. Sea ice forms where the sea stays below −2 °C in summer and blocks currents like land.
7. Bays and small seas take the effect of whatever current passes their mouth.
8. Conserve mass: every current entering a basin needs one leaving it.

**Short currents:** currents travelling under ~30° of latitude (slider) have no temperature effect; they arrive about as warm as their surroundings.

**Temperature correction:** anomaly = sea temperature at the latitude the water came from minus sea temperature at its current latitude; decay with distance travelled since the current last turned; apply to coastal land, scaled by how onshore the wind is.

**Map edges:** on a flat map, follow the world's edge setting (wrap east–west, or off-map has no effect).

### 7.6 Upwelling, downwelling, fog and fisheries
Each coastal ocean point gets one state per season, from the wind direction along the coast.

| | Upwelling | Downwelling |
|---|---|---|
| Cause | Wind parallel to the coast with the coast on the wind's left (north) or right (south); surface water pushed offshore | Wind parallel the other way round; surface water piles against the coast |
| Water | Cold, nutrient-rich deep water rises | Warm surface water sinks; nutrient-poor |
| Fisheries | Rich, especially in summer | Poor |
| Fog | Frequent where warm air passes over the cold water | None |
| Coast climate | Cooler and drier | Unchanged |
| Reefs | Suppressed, especially in winter | No harm |

Typical upwelling coasts: west coasts at ~15–35°, under the cold eastern boundary currents.

### 7.7 Temperature
Per season: base temperature by latitude, then corrections for currents, land vs ocean, continentality, altitude (height class) and climate crystals.

- **Land vs ocean:** each point has a heat capacity (land low, ocean high); land moves further toward each season's extreme. Without this, interiors match coasts, continental climates never form, the ITCZ can't swing over land, monsoons are weak, and winter highs never form.
- **Continentality:** for each land point, trace back along the prevailing wind to the nearest ocean; a longer trace means a bigger summer–winter swing.
  - Westerly belt (~35–60°): ocean air reaches 500–1,500 km inland from west coasts on flat land; a range over ~1 km stops it near the coast.
  - East coasts in the westerly belt are already continental (offshore wind).
  - Trade belt (~0–30°) reverses: east coasts get ocean air, west coasts are dry.
- **Altitude:** about 6.5 °C per km of height class (slider). Roughly, 1 km acts like moving 8° poleward.
- **Sky layers:** colder and windier with each layer up.

**Ice**
- No ice-free land below 0 °C in summer; no land ice above 0 °C in summer.
- Sea ice where the sea stays below −2 °C (permanent if in summer, seasonal if only in winter).
- Lowland ice past ~40° from the poles risks a runaway snowball planet.

### 7.8 Precipitation
Each land point gets one state per season: dry, wet or very wet. Moisture is stored as a number while tracing, then thresholded (keeping the option of real rainfall figures later).

1. **Warm coasts:** seed "wet" on coasts with warm currents (including equatorial currents) and onshore wind. Carry it downwind until it hits a front or the ITCZ, crosses relief above the blocking slider, or exceeds the carry distance. Ignore enclosed seas.
2. **ITCZ zone** (about ±15° around it; wider on the western side of large oceans, cut back near subtropical highs): wet → very wet. Cold-current coasts with onshore wind also seed "wet" here.
3. **Frontal zones** (wider when the two highs are far apart): wet → very wet; add "wet" from onshore cold-current coasts within the carry distance.
4. **Mountains (windward):** where wind meets relief above the blocking slider, upgrade a strip a couple of hundred km wide on the windward side. Add new "wet" if the air has come no more than ~3,000 km from the sea and hasn't crossed a major range.
5. **Polar front zone** (pole to ~40° in summer, ~30° in winter): no very wet; adds "wet" from all coasts, even with offshore wind: ~2,000 km downwind, ~1,000 km upwind.
6. Everything left is dry.

Rain crystals and waterfalls raise wetness locally. The rainfall override shifts the carry distance and thresholds.

**Rain shadows:** crossing relief above the blocking slider drops most moisture on the windward slope and carries only a little over. Rain peaks at about 1–1.5 km of relief; above ~4 km the air is dry. Moist tropical air may need more than 3 km for a full shadow; dry high-latitude air only about 1 km.

**Sanity check:** heavy rain along the ITCZ deep into continents, on mid-latitude east coasts in summer, and on high-latitude west coasts in winter.

### 7.9 Climate zones
From each point's warmest and coldest season temperatures and its summer and winter precipitation states.

| Group | Rule (season mean) |
|---|---|
| Tropical (A) | Coldest season ≥ 18 °C |
| Temperate (C) | Coldest ≥ 0 °C and warmest ≥ 10 °C; hot summer if warmest ≥ 22 °C |
| Continental (D) | Coldest < 0 °C and warmest ≥ 10 °C; humid continental if warmest ≥ ~18–20 °C, else subarctic |
| Tundra (E) | Warmest 0–10 °C |
| Ice cap (E) | Warmest < 0 °C |

**Precipitation rules, in order**
1. Tundra and ice cap: keep.
2. Arid (B): dry both seasons → desert, wrapped in a steppe border (~100–300 km in the tropics, about twice that at higher latitudes; thinner on steep slopes). Hot desert in A and C bands, cold desert in D.
3. Continental: the rest stay humid continental or subarctic.
4. Temperate: dry summer + wet winter → Mediterranean; wet summer → humid subtropical (hot summer) or oceanic (cool summer).
5. Tropical: very wet both → rainforest; wet both → monsoon; wet + dry → savanna; very wet + wet → rainforest near the equator, monsoon toward the edges; very wet + dry → monsoon near coasts or mountains, savanna inland.
6. Touch-ups: keep a continuous rainforest → monsoon → savanna → arid sequence; make sure big deserts near 20° reach the west coast.

**Earthlike sanity check**

| Zone | West coast | Interior | East coast | Notes |
|---|---|---|---|---|
| Tropical | 0–~15° | 0–~20° | 0–~25–30° | Shrinks fast with altitude |
| Arid | ~15–30°, reaching the coast | 15–35°; also 35–50° in rain shadows or far inland | Usually absent | Biggest deserts touch west coasts |
| Mediterranean | ~30–45° | — | — | West sides only |
| Humid subtropical | — | ~25–35° | ~25–40° | East-coast twin of Mediterranean |
| Oceanic | ~40–60°; to ~70° with a strong warm drift | Fades 500–1,500 km inland | Rare | Needs onshore westerlies |
| Continental | Only behind mountains | ~40–70° | ~35–60° | Needs a landmass a few thousand km wide |
| Tundra | ~65–75° | ~65–75° | ~55–70° (cold current) | Also high mountains |
| Ice cap | Above ~75° or high plateaus | | | |

West coast pattern: tropical → arid → Mediterranean → oceanic → subarctic. East coast: tropical → humid subtropical → continental → subarctic.

### 7.10 Coral reefs
A sea point has a reef when all three hold (no reef types):
- Coldest-season sea temperature ≥ the reef slider (18 °C).
- No upwelling in winter (except the warmest near-equatorial water).
- Shallow sea (painted Shallow Sea, standing in for water under ~50 m).

Warm western boundary currents push reefs poleward along east coasts; cold upwelling keeps them off west coasts. Penalising points near large river mouths for sediment is an optional extra rule.

### 7.11 Left out and caveats
- Left out: El Niño-type reversals, lee cyclogenesis, reef types, the third snapshot, continuous seasons.
- The rules hold for Earthlike worlds; very high tilt, unusual day lengths, tidal locking or mostly-land planets break them (Part VIc).
- Most numbers are Earth-fitted rules of thumb, which is why the key ones are sliders.
- To tune: run Earth's terrain through it and compare with real climate maps or the koppenpasta tool.

---

## 8. Simulation

### 8.1 Foundations
- **No tiles.** Everything has a real position; areas are shapes.
- **Time:** an active day-by-day mode, plus faster steps (week, month, year) and time skips (a month, a year, many years). The climate switches between its summer and winter versions.
- **Groups, not individuals:** the simulation tracks groups (clans, tribes, settlements, armies, parties, caravans, guilds).
- **Notable individuals** travel with those groups: rulers, heroes, guild masters, spies and others. For example, a spy has to make their way to another nation, travelling from city to city to get where they're needed.
- **Existing systems all come back** (technology and eras, culture, religion, the market, wars and diplomacy), with changes made to each as we go.

### 8.2 Species, races and the creator
- **Species** set the biological base: the environments they live best in, and fixed traits.
- **Races** are the individual peoples within a species, each a variation on the species, with its own preferences and traits.
- **Race / species creator:** an expansive designer, so other users can make their own. It covers:
  - body: size, limbs, strength, speed;
  - diet;
  - offspring (how many) and lifespan;
  - environment preferences;
  - for sentient species, these numbers give the base stats for armies, heroes and the like.
- All the races of this world, and all the traits, will be designed together (a later step).
- **Examples so far:**
  - dwarves and the Rabbit race dig tunnels;
  - avian races fly, live in giant trees and hunt from them;
  - a goat-like race can cross high mountains and build settlements on mountainsides.

### 8.2a Creator structure (agreed)
- **Two kinds of species:** **sentient** and **beasts**.
- **Species** set the biological base and fixed traits; **races** are peoples within a species, varying it within limits; **cultures** belong to groups of people, not biology (one race can have several cultures; a culture can span races).
- **Sections:**
  1. **Body:** size and build; limbs (arms, legs, wings, tail; hands, claws, talons, tentacles); strength, speed, endurance, agility; senses (night vision, keen smell, tremor sense...); natural weapons and armour; movement (walk, climb, dig, swim, fly with range, mountain-adapted).
  2. **Life:** lifespan and age of adulthood; offspring per birth and how often; diet (plant, meat, both, special such as mana, minerals or sunlight) and food needs; active by day, night or dusk.
  3. **Environment:** preferred climates, ground covers and mountain zones, and tolerance of others; preferred layer (surface, underdark, trees, sky); heat, cold, wet, dry and altitude tolerance; special needs or benefits (mana density, near water).
  4. **Mind and society** (sentient only): intelligence and learning speed; social structure tendency (pack, clan, hive, solitary); lifestyle (settled, semi-nomadic, nomadic); temperament; magic affinity; building styles (ground, tunnel, tree, cliff, sky).
  5. **Relations:** general aversion/affinity trait (wary, welcoming, indifferent) plus optional per-species overrides; interbreeding and its results.
  6. **War and heroes** (sentient only): base stats for soldiers and heroes from the numbers above; racial troop types (feeding "specialized troops").
- **Beasts** use sections 1–3 and 5, plus uses (food, labour, riding, hunting help), resources, hunting difficulty, domestication difficulty and the density heat map (8.3).
- **Traits:** tags with effects (for example Tunneler, Avian, Mountain-born, Night-eyed, Long-lived, Fertile, Hardy, Mana-sensitive, Herd-keeper, Seafarer). Species have fixed traits; races add or swap a few. A trait editor lets users make new ones.
- **The species list starts fresh** (nothing carried over from the current game). The first list is coming from the world's author.

### 8.3 Animals and beasts
- Animal species are made in the same creator. They have no armies.
- **Population:** not counted, but shown as a **density heat map** from none to abundant. Animals only live in environments that suit them.
- **Uses**, set per species: food, labour, riding, and helping to hunt.
- **Resources:** leather, feathers, horns and many more.
- **Hunting:** more hunting means fewer animals. How easy a species is to hunt matters: one massive beast is far harder to bring down than a few deer.
- **Domestication difficulty:** a barrier to ranching a species for its resources.
- Animals affect how races adapt and change with their environment, and they decide where hunting grounds are good.

### 8.4 Clans and tribes (to be reworked)
- **Clans** are a government type. A clan holds one or more tribes, and gains more as new tribes form within it.
- Clans can **split** or **merge**.
- They still claim land by walking it, migrate between summer and winter grounds, and do everything they did before, with a different tone.
- **Settling does not end the tribal era:** a few tribes settling down doesn't take the clan out of it. Leaving the tribal era needs more cultural development; once the clan has the technology for settling, all or most of its tribes settle.
- **Never settling is valid too:** some clans never need to settle and stay on the move with herding grounds, like the Mongol clans. Both paths are valid for the races of this world.
- Clans should last a long time, fighting for better territory and doing what people do. Much of this comes from the culture and technology trees, which will get a lot of work.
- **Government types** in general (how they work, change and progress) need their own design step.

### 8.4a Preferred governments
- Each people has an **agreed-upon government** it prefers, set as part of its culture. This keeps the world's development consistent with the story.
- **Example, the Rabbit race:** inspired by Japan's shogunate period. An emperor of the true line heads a feudal system, and breakaway courts claim to be the true line instead. Through all of it, they keep leaning to the feudal system.
- **Distance from the core:** the further a group is from the heart of its culture, the more it mixes with neighbouring cultures and starts becoming like them, including in how it is governed.
- **Royal lines and claimants:** lines of succession are tracked, so rival claims to the true line can exist, be pressed, and lead to splits or wars.

### 8.4b Government creator and built-in types
- **Lock or pull**, set per culture:
  - **Locked:** the people always keeps its preferred government; only the details change (which line rules, which lords hold power).
  - **Strong pull:** it can change under pressure but tends to return. At the edges of the culture, it starts melding with neighbouring cultures.
- **Government creator:** governments are built from parts (for example who is head, who holds real power, who holds the land, how succession works), so unique combinations can be built for the peoples of this world.
- **Built-in types:** a preloaded set the AI uses under certain conditions. Created governments are for the cultures you choose to give them to.

**Government parts** (a government is one pick from each):

| Part | Options |
|---|---|
| Head of state | Chief · Council of elders · King/Queen · Emperor · Khan · High priest · Archmage · Elected leader · Assembly · None (a council rules) |
| Ruling class (who is set up in the government as its rulers, not merely who has influence) | Same as the head · Military ruler (shogun-like) · High princes · Nobility (great lords and lesser nobles) · Chancellor or vizier · Clergy · Mage council · Merchant houses |
| Who holds the land | Clans and tribes · Great lords with vassals (feudal) · Appointed governors · Free cities · Temples · The state directly |
| Succession | Elders choose · Hereditary (eldest, any child, or strongest claimant) · Challenge or combat · Chosen by the gods or temple · Merit (such as the strongest mage) · Election by lords · Election by the people |
| Legitimacy | True line / sacred blood · Divine right · Strength · Wealth · Magic power · Consent of the people |
| Army | Clan warbands · Levies · Lords' retainers (samurai-like) · Standing army · Specialized troops · Mercenaries · Militia · Religious or magic orders |
| Law | Custom · Lords' justice · Written law · Religious law · Magical oaths |

**High princes:** a nobility rank, the highest under the king. They arise where a ruling family's hold on its lands stays strong even after its own king's defeat. As a decentralized way of ruling, high princes rule their own lands (and may have been kings themselves) but swear allegiance to one king.

**Centralization** is not a fixed setting. It is the government's real ability to enforce its laws and keep control, and it changes during the simulation. Better roads, some technologies, and some cultural traits speed the flow of information and orders, letting a realm hold its land more tightly (see 8.4c).

**Example, the Rabbit race:** Emperor (head) · military ruler and nobility (ruling class) · great lords with vassals (land) · hereditary (succession) · true line (legitimacy) · levies, lords' retainers and specialized troops (army).

**Built-in types the AI uses:** Clan · Horde · Chiefdom · Petty kingdom · City-state · Theocracy · Magocracy · Feudal kingdom · Empire · Republic · Merchant republic · Elective monarchy · Gerontocracy. Chosen by conditions (for example a strong clergy faction toward theocracy, dense mana and towers toward magocracy, many conquered cultures toward empire). For cultures without a locked government, factions and these conditions drive change.

### 8.4c Cultural pull, enforcement and distance
- Cultures pull and push on each other.
- Nations can **enforce** their culture and **enforce cultural changes**.
- **Reach of enforcement:** the further a place is from a power centre (the capital, or nobility able to enforce things), the more its people change through natural influences (neighbours, trade, migration) instead of what is enforced.
- **Example:** a huge, highly centralized empire with poor connections: its far regions grow different from the core. If the nobility there start seeing themselves as set apart from the core, they may want to break away.

### 8.4d Factions, infighting and breakaways
- Nations contain **factions** that can fight among themselves while still part of the same nation, building toward a possible civil war.
- When the differences become too great, a faction **breaks away**: starting a civil war, or leaving some other way.
- Rival claims to a true line (8.4a) are one source of such factions.

### 8.4e Culture (decided so far)
- **Two separate trees:** a **technology tree** (what a people can make) and a **culture tree** (how a people lives). They influence each other: progress in one can push a nation to make or change things in the other.
- **Culture is made of traits and learned behaviours.** Some traits have **degrees of severity** (for example mild, strong, extreme).
- **Scale:** a culture can be a single city or nation-wide.
- **Survival first:** a culture is built on the best way its people find to survive, given their environment and many other circumstances.
- **Inspiration:** Crusader Kings III's culture system.
- **No paths:** there are lifestyles and preferences, not set paths. Preferences change a great deal about how people live, which is why they come from the environment.
- **No eras as gates:** eras only label time. There is no "reach the next era" to unlock culture improvements.
- **No pace setting** for now.

**Structure (agreed)**
1. **Pillars** (rarely change): **heritage** (origins: species and ancestral group; shared heritage eases acceptance) · **language** (naming style; shared language eases acceptance) · **ethos** (core outlook: warlike, communal, mystic, commercial, spiritual, stoic, egalitarian...) · **martial custom** (who fights: men, women, everyone, a warrior caste, none) · **lifestyle preferences** (settled, nomadic, seafaring, tree-dwelling, underground, sky-dwelling; from the environment, can blend).
2. **Traditions** (traits), about **6 per culture**, each with a **severity**. Earned from how a people survives where it lives; living that life long enough earns the trait, leaving it fades it, and severity rises or falls over generations. Many need conditions (for example Horse Lords: horses and open grassland). Examples of severity:
   - **Xenophobia / dealing with outside races:** the core of a people can be fiercely against other races anywhere near, while its border regions are only partly against them.
   - **Seafaring:** *full* (most of their livelihood revolves around the sea) or *partial* (large fishing fleets and a navy, but also focused on the interior).
   - Exact degrees for each trait are worked out as cultures are developed.
3. **Specialties** (flavour on top, outside the ~6 limit, so they never take a place a culture needs for its development). Shared memories and their customs, for example a **rift tide fear**: everyone remembers it, and as a culture they do things because of it. Some affect the culture directly; most are flavour.
4. **Learned behaviours** (the culture tree, like CK3 innovations): oral law, written law, granary customs, land ownership, feudal oaths, guild charters, coinage customs, ship-building, tunnel-building and so on. They spread by practice, need and contact (contact much faster); some need a technology, some push technology forward; they unlock behaviours (settling, government parts).
5. **Acceptance** between cultures (grows with contact, trade, shared rule, shared heritage or language; shrinks with war and oppression); feeds opinion and aversion (8.5).
6. **Change over time:** **divergence** (a part splits off when different enough, including single-city cultures) · **hybrid** (two cultures living together with high acceptance blend into a new one).

**Who changes a culture: both rulers and nature**
- **Rulers** can push for traditions and changes (only as far as their reach).
- **It also happens naturally.**
- **Main culture bonus:** inside a nation with a major main culture, other cultures get a push to conform to it.
- **Big settlement pull:** small settlements next to a large one adopt the large one's culture, unless the smaller ones together are stronger, in which case it goes the other way.

**Story cultures:** traditions and traits can be **locked** or **heavily encouraged** for chosen cultures, like governments.

### 8.4f Technology (decided so far)
- **Separate from culture, but linked:** technology is what a people *can* make; culture decides whether they *do*. Each can push the other.
- **Branches, not eras:** technologies are grouped by field, each a line of levels (for example stone, copper, bronze, iron, steel). Proposed fields: food and land (including canopy/bark and fungus farming, domestication per species); materials and crafts (including clockwork); building (including tunnel, cliff and tree building, sky docks, roads and bridges by grade); travel (riding per mount species, sailing, flight gear, airships); knowledge; commerce; war; rift and mana lore (not a magic system).
- **The top end:** later stages reach steam technology and steampunk-style things, with a separate **mana tech** line alongside. The end of the tree: airships, trains, and mechanized infantry and vehicles. (To be discussed in depth.)
- **Gunpowder** exists.
- **Who holds knowledge:** it depends on the culture, but usually a **settlement** holds a technology, and it spreads to the settlements that need or can use it.
  - **Losing it:** if a nation's only settlement able to build trains is lost, the nation loses that ability, unless it can rediscover it, retake the settlement, or has kept the knowledge in a **nation's tech library**, which lets it move production elsewhere.
  - **Keeping a tech library** needs writing and a library, archive or academy building. It can be destroyed (a burned archive loses what only it held).
- **Technology can be lost** (collapse, isolation, plague, losing the settlements that hold it).
- **Steam and mana tech:** a nation can pursue both lines, but usually has little reason to push both when one suffices.
- **Fuel** for steam and mana tech: to be designed when we get there.
- **Discovery:** practice, need, and contact (much faster), helped by Intelligence, curious cultures and fitting species; some technologies need resources or places (bronze needs copper and tin; sailing needs water).
- **Rift materials:** not necessarily better than ordinary materials (for example ordinary iron and rift iron), but rifts give access to better and different resources, possibly super-rare metals.
- **Tech editor**, together with a **resource maker**, so new technologies and resources can be added.

### 8.4g Religion
**Faith structure** (CK3-inspired, like culture)
- **Identity:** name, symbols, followers (cultures and races).
- **Nature of belief:** animism, ancestor worship, polytheism, monotheism, nature or world-tree worship, mana or rift reverence, philosophy, or a mix.
- **Tenets:** about 3 core beliefs, with severity (for example sanctity of nature, holy war, pacifism, ancestor rule, rift abhorrence or reverence, asceticism).
- **Doctrines:** who leads, who can be clergy, views on other faiths (tolerant to hostile), marriage rules, views on other species, attitude to mana.
- **Holy sites:** places on the map (temple cities, giant trees, volcanoes, rifts, world tree root crossings); holding them strengthens the faith, losing them hurts.

**In the simulation**
- **Organization:** from loose (local shamans) to organized (temples, priesthood, a head of faith), growing with culture and technology.
- **Fervour:** rises with holy wars won and holy sites held; falls with corruption, defeat, rival faiths.
- **Spread and conversion:** temples, missionaries, trade, migration, conquest, royal marriages; gradual, faster under a pushing ruler, slower where the old faith is strong; rulers enforce, tolerate or persecute.
- **Splits:** heresies, reformations, syncretism (blended faiths).
- **Links:** temples and places of mass worship are ley line nodes (8.4 mana); faiths can revere, fear or fight rifts (rift-warden orders, cults); theocracies and divine-right legitimacy; clergy as ruling class or faction; religion in opinion, holy war as a reason for war, religious pacts; religious orders as non-state powers.

**The gods are real**
- Gods exist. Some act in the world often, others rarely. They do the good things: **miracles, heroes and blessings**.
- **The heart of this world: the gods are playing games with the people of the world.**
- Religion is also belief: faith works as belief whether or not a god acts.
- **The active-gods part can be turned off** for users who want religion as belief only.
- **Gods as actors:** each god is an actor in the simulation with its own personality, goals, favoured peoples and rivalries with other gods (for example a war god nudging its followers toward conflict, competing with a harvest god).
- **What gods can do:** miracles, blessings, heroes; omens and visions; prophecies that come true; choosing champions (raising a notable individual as their hero); appearing in person; proxy wars through their followers.
- **How often:** a world setting for how active the gods are (distant to meddling), plus an activity level per god.
- **God creator:** gods are built in the program (part of the faith creator), with all the options needed so other users can build their own religions and gods. The author's own faiths are entered the same way.

**Faiths are set from the beginning** (not formed during the simulation). The author has many faiths, some in progress, and will build them with the creator.

**Faith creator**, like the culture and government creators. Story faiths can be locked or heavily encouraged.

**Priests and mana:** some hero types, such as priests, draw on faith, but in the simulation it is kept as **mana** (no separate faith power).

**God mode:** found a faith, spark a reformation or heresy, convert a settlement, desecrate a holy site.

### 8.5 Politics

**Opinion.** Every pair of peoples and powers has an opinion of each other, built from visible parts:
- **Biology (species aversion):** natural dislike or comfort between species, from the race creator.
- **Culture:** similar customs draw together, very different ones push apart; fades with long contact and trade.
- **Religion:** same, related or rival faith.
- **History:** remembered wars, betrayals, gifts, marriages and help in hard times. Memories fade slowly; grudges slower.
- **Interests:** competing for the same land, rift or trade route lowers opinion; a shared enemy raises it.
- **Leaders:** notable individuals' traits, friendships and rivalries.

**Aversion and mixing**
- Mixed settlements form naturally: through migration, through a settlement being fought over and changing hands, and through trade routes bringing other races travelling through.
- Ruling over several races does **not** automatically cause tension. Tension depends on the actual factors at play (the opinion parts above, how each group is treated, the laws, the history).
- Aversions can soften (long peace, trade, shared enemies, tolerant cultural traits) or harden (wars, atrocities).

**Diplomacy**

| Group | Option | What it does |
|---|---|---|
| War and peace | Truce | Ends fighting for a set time after a war |
| | Peace treaty | Ends a war, with terms (land, payment, release of prisoners, claims given up) |
| | Non-aggression pact | Promise not to attack, for a set time |
| | Defensive pact | Join the war if the other is attacked |
| | Full alliance | Fight together in all wars |
| | Coalition | Many powers band together against one threat (a rising empire, a monster horde) |
| | Military access | Armies may pass through |
| | Lend troops / hire out mercenaries | Send forces to fight for another |
| | Guarantee of independence | Promise to defend a smaller power |
| | Demilitarized border | Neither side keeps forts or armies on a border |
| Hierarchy | Vassalage | Keeps its rule but answers to the stronger |
| | Tributary | Only pays, otherwise free |
| | Protectorate | Defended in exchange for loyalty |
| | Personal union | Two realms share one ruler, through marriage or inheritance |
| | Release a vassal / grant independence | |
| Trade and wealth | Trade agreement | Opens markets and routes, lowers tolls |
| | Trade monopoly | Exclusive right to trade a good |
| | Embargo | Cuts trade with a power |
| | Loans and debts | Lend wealth; unpaid debts sour relations |
| | Gifts and tribute | Buy goodwill |
| | Rift pact | Share an encampment or rift resources on a border |
| | Shared roads and bridges | Build and maintain together |
| Family and people | Royal marriage | Binds families; creates claims to thrones; can lead to personal unions |
| | Hostage / ward exchange | A noble child raised at the other court as a guarantee |
| | Migration treaty | Allows settlers to move between realms |
| | Refuge | Shelter exiles, pretenders or fleeing peoples |
| Faith and knowledge | Religious pact | Shared holy sites, missionaries allowed or banned |
| | Knowledge exchange | Share technology or magic |
| | Mage tower pact | Share a ley line node or tower |
| Information | Embassy | Better information, slowly better opinion |
| | Border agreement | Fix a border, often along a river or crest |
| | Arbitration | A third power or temple settles a dispute |

**Breaking treaties**
- Breaking a treaty without cause costs reputation with everyone, not just the victim.
- **Justified breaks carry no penalty.** For example: you have a peace treaty with nation A and a defensive pact with nation B. If A attacks B, you may break the peace with A to defend B, with no repercussions.
- Other justified breaks: the other side broke its terms first, attacked an ally or vassal, or made the treaty under deceit. Each treaty records its terms, so the simulation can tell a justified break from a betrayal.
- Unjustified breaks are remembered as betrayals (see History above).

**Royal marriages and family**
- Royal and noble families are tracked: marriages, children and lines of succession.
- Marriages bind families, create claims to thrones, and can produce personal unions.
- Connects to true-line claimants (8.4a) and to high princes (8.4b).

**Reasons for war:** claims to land or a throne (including true-line claims), holy war, revenge, liberating kin, seizing a rift or trade route, clan raids for hunting grounds, defending an ally. Wars without a good reason anger neighbours and their own people.

**Inside a nation:** factions (8.4d); each noble house, high prince and governor has its own loyalty (distance from the centre, opinion of the ruler, treatment, ambition); factions can plot (install a claimant, gain a seat in the ruling class, break away).

**Spies and intrigue:** spies are notable individuals who travel city to city to reach their target. Missions: gather information, steal technology, sabotage, assassinate, stir unrest, back a rival claimant. They can be caught, damaging relations.

**Non-state powers:** guilds, temples, mage orders, and clans living inside a nation have their own opinions and agendas; they bargain with states, refuse service, or back factions.

**God mode:** directly set opinions, force treaties and marriages, and start or end wars.

### 8.6 Territory
- Claimed by moving through land (see 8.4). Territory and settlements will get much more work.
- **Rivers** can be claimed and lie inside territories and nations like any land. Fighting commonly ends at rivers because fortresses, or an army holding the far bank, stop the advance there.
- Land regions to be designed later.

### 8.7 Settlements
- Farmland is not drawn on the map; it is simulated inside settlements.
- Settlements work the features within their reach (ore from mountains, timber from forests, fish from upwelling coasts, rift resources) and trade through markets, routes, caravans and guilds.

### 8.8 Tree settlements
- **At the base:** a settlement can form around the foot of the tree, on the surface.
- **Inside:** some species are naturally hollow, and settlements can be built inside them.
- **The crown:** a few great limbs stretch out like a spider-shaped island. The limbs act as land: settlements can be built along them. The core, where the limbs join, is where a city forms.
- **No mining.** The bark isn't harvested: it is used to grow special plants that only grow in the environments these trees create.
- **Hunting** from the trees is only for avian races, since they have to fly down to hunt.
- Layers and views need another look to fit the tree crowns (see section 9).

### 8.9 Underdark
- You shape the tunnels and caverns as you see fit.
- Races that live there, or want to dig down, then dig their own tunnels and can travel them. These tunnels are permanent.
- A territory-claim system like the surface one, driven by digging.
- Races dig in their own ways. For example, a spider race slowly mines at random, bringing resources up.

### 8.10 Travel
- **Mountain zones** decide travel and settling (see 6.2a). Low ground is slow; high mountains can't be crossed except by roads, passes or specially able races (such as the goat-like race), who can also settle there. Other races must use roads to cross mountain lands.
- **Canyons and ravines** block travel except at openings and bridges (see 6.6).
- **Roads and bridges** come in grades; higher grades are better.
  - The lowest-grade roads form on their own from people passing along a route.
  - Nations build better roads and bridges when they need them.
  - Better roads and bridges last longer, are preferred by travellers, and bring more travel and trade.
- **Travel tunnels:** some races prefer to travel by shallow tunnels just under the surface, which they use like roads. These are separate from the Underdark.
- One travel network across all layers: roads and paths, rivers, sea lanes, travel tunnels, Underdark tunnels, vines, and flight routes. Flying races reach the sky layers; airships come later with technology.

### 8.11 Mana in the simulation
- The initial mana channels and certain structures influence each other.
- Cities with a large mana drain attract world tree roots (when that system is used) and form ley line connections.

### 8.12 Names
- Each culture has its own naming style (its own sounds and word parts).
- Places are named by cultures as they claim or conquer them, and can be renamed. Every name a place has had is recorded in its history.
- You can rename anything.
- Labels are sized and styled by importance (see 8A).
- How land and water are divided: see 8.13.

### 8.13 Continents, seas and regions
**Continents and islands** (automatic, with your override)
- A landmass above a size threshold is a continent; smaller ones are islands. Clusters of islands form archipelagos.
- You can override: draw a split line to make one landmass two continents (like Europe and Asia), or merge them.

**Seas**
- **Oceans:** the big open waters between continents.
- **Seas:** split off automatically at narrow points (straits, gaps between landmasses), or where water is mostly surrounded by land (inland and enclosed seas).
- **Bays and gulfs:** deep inlets of a coast.
- A **Sea tool** draws boundaries and splits or merges waters.
- Named by the cultures along their shores or sailing on them.

**Both kinds of region**
- **Natural regions (geography):** the land is split automatically along natural lines: mountain crests, major rivers, coastlines, and changes of climate or ground cover. Each gets a kind (Highlands, Steppe, Forest, Marshes, Desert and so on) and is named when a culture first settles or claims it. A **Region tool** redraws their borders.
- **Political regions (provinces):** drawn by nations as they grow, often but not always following natural regions. They change with conquest, and every change is recorded in the history.

---

## 8A. Map look

- Styles as before: satellite (realistic) and paper (drawn).
- Labels look like fantasy map labels. The more important the name, the larger and more artistic the lettering: regions and nations get the grandest designs.

## 10. Build order (proposed)

Each phase ends with something to open and try; the next phase starts only once it's approved.

| Phase | What gets built | What you can try |
|---|---|---|
| 0. Foundations | Tile-free world model (real distances, layers), world settings, save/load, start screen (Create world / Continue sim), canvas expanding | Create a world (presets or custom size), save, load |
| 1. Land & painting | Land & Sea brushes; painted feature brushes (mountains in three modes with zones, hills, plateaus, cliffs, canyons, forests and the rest); satellite and paper looks | Paint a continent and its features |
| 2. Water | River point mode, joining rivers, lakes, waterfalls on the surface | Draw rivers through your features |
| 3. Climate | Rain Shadow Pen, the summer/winter climate system, climate crystals, automatic ground cover | Climate zones, rain and currents from what you drew |
| 4. Geography | Continents, seas, natural regions, Region and Sea tools, culture naming, fantasy labels | A named, labelled map |
| 5. Species | Species/race creator, traits, beasts and density maps, the roster loaded | Browse and edit races; see where animals live |
| 6. First peoples | Time controls (day to year), clans and tribes claiming land by walking, seasonal migration, hunting | Clans spreading across the world |
| 7. Settlements & travel | Settling, settlements, travel network, roads and bridges, trade | Towns, roads and trade routes growing |
| 8. Governments & politics | Government creator and built-in types, factions, cultural pull, diplomacy, royal families, spies | Nations forming, allying, splitting |
| 9. Mana & rifts | Ley lines, world tree roots, mana heat map, rifts, monster tides and hordes | Rifts opening, held or breaking |
| 10. Other layers | Underdark, canopy and giant tree cities, sky islands, vines, waterfalls between layers | Multi-layer worlds |
| 11. Globe | 3D globe with flat and globe views side by side | A whole planet |

Technology, religion, culture, the market and war return within the phases they belong to, reworked as they go.

**To confirm:** this order; and whether the new version is built alongside the current game (proposed: in a new folder, so the old one keeps working until replaced) or replaces it directly.

## 9. Still to design

- **Mountain height for travel:** the painted Mountains brush has no height, so what decides whether a range is "low" (slow) or "high" (impassable)? Options: the Rain Shadow Pen height class, a low/high setting on the brush, or both.
- **Species and races:** fill in the list (author's list coming).
- The order in which everything will be built once the design is complete.
