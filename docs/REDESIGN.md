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
- **Auto mode:** click a start point and an end point, and the course is generated. You can end it at the point you click, or click water so it flows into the sea, a lake or another river.
- **Joining:** each river that flows into another makes the river below it bigger from that point on.
- Rivers look realistic, winding naturally.
- **Proposed (how auto mode finds a path without heights):** the path treats painted features as terrain: it winds through low ground and valleys between ranges, goes around mountains, hills and plateaus, and follows canyons where they lead the right way.

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

## 8. Simulation (later stages, to be designed)

- **Territory:** claimed by moving through land. In the tribal era, a tribe claims hunting ground as it walks it. Growing or splitting tribes need more land and claim more.
- Territory and settlements get much more work.
- Farmland is not drawn on the map; it is simulated inside settlements.
- Land regions to be worked on later.
- Tree settlements, Underdark tunnels, sky travel, airships and flying races (see sections 5 and 6).
- What the simulation reads from the land: which feature is where (mountains, hills, forest, canyon and so on), climate from the climate points, Rain Shadow Pen height classes for cooling and travel difficulty, and travel blockers.

---

## 9. Still to design

- Rivers: confirm the proposed auto-path method (6.8).
- Temporary rifts: how often they appear and disappear, and what happens to their lakes and rivers.
- Map look: styles and labels.
- The simulation side (section 8).
- The order in which everything will be built once the design is complete.
