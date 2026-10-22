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
- **Where the equator is (decided):** by default the middle of a flat map is the equator (0°). You can move the equator up or down the map, at creation and later in World settings, to put a continent where you want its climate to be. Globes can't do this; their latitudes only change when the planet is made bigger or smaller.

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
| Mountains | Spray brush (below) | Lit on one side, shadowed on the other |
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

**How brushes paint (decided after trying Phase 1):** like Wonderdraft or Photoshop. A stroke is a row of stamps laid as you drag; what you see while painting is what stays.
- Land, sea and ground cover are opaque paint.
- **Mountains are a spray brush.** Paint builds up and the crest forms where it is thickest. Painting beside a mountain widens it, over it raises it, and a small, weak brush along its edges adds shoulders and spurs. Ridges and gullies are cut straight down the slopes of whatever shape is built (a **Ridges & gullies** setting). Hills work the same way, lower.
- **Erosion brush:** a spray that cuts gullies, lowers peaks and roughens coasts. Outlines are rough by default (Roughness setting).
- **Look:** shaded relief like an atlas; mountains tinted from olive foothills through tan and rock to snow.
- **Cliffs:** drawn along the top edge; only the face is drawn, on the low side (rock lip, layered face, scree, cast shadow). The high side is implied.
- **Plateaus:** flat top ringed by layered rock faces, scree and a cast shadow; an **Erosion** setting notches the rim. Plateaus, cliffs and canyons all have the Erosion setting.
- **Ramp brush:** draw from the ground floor up onto a plateau or cliff top, or down into a canyon. It joins the two (a graded slope with a worn track) and is recorded as an **access point**: the peoples of the world use ramps to reach these places, and travel through cliffs, rims and canyon walls is open only there.
- **Canyons:** terraced, layered walls, flat floor, side canyons cutting an irregular rim. **Ravines:** narrow, deep, jagged cracks.
- **Craters:** size means meteor size. Small: simple bowls. Large: flat floor, slumped terraces, central peak, rocky layered walls, rays. A new crater blasts away what was there, older craters included.

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
**Decided (Phase 3 discussion):** painted mountains, plateaus, cliffs, hills and volcanoes cast rain shadows and cool the land by themselves, using hidden climate heights (see 7.7). The Pen is kept for adjusting that: drawing lines where extra high ground should block moisture, overriding a feature's height, and cutting gaps (passes). **Built as one tool** with three modes, High ground, Gap (pass) and Erase; whatever is drawn last wins in a spot, so a gap cuts high ground, high ground fills a gap, and Erase clears both.

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
- **Built (Phase 2):** a click near a river (on screen) snaps onto it, so joining is easy. River brush sliders: **Width** (at the source) and **Wandering** (how far it may bend from its course, in miles; 0 = none). A river's width comes from the water it carries: its source width, plus what it gathers along its length, plus every river that joins it. Rivers are drawn a little wider than life on the map, as map makers do, so they read at any zoom. Waterfalls form where a course runs off a plateau top, over a cliff face or into a gorge (only going down; one per drop).

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
| Reef coldest water | 64 °F | Coldest-season sea temperature reefs need |
| Reef warmest water | 86 °F | Warmest-season sea temperature reefs can stand (hotter bleaches them) |
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
**Seasons (decided):** ocean currents, winds and high-pressure zones each belong to northern summer, northern winter or both, and each season's climate is worked out from its own set. New ones go into the season shown on the map (or both); the map shows only those of the season being viewed; a picked one can change season or be copied to the other season to adjust there.

**Now drawn by hand (decided).** Winds are drawn with the Wind brush (Climate tab), like ocean currents: a course through tapped points, adjustable afterwards (move or add points, strength, reverse, delete). Every place takes its wind from the drawn winds, the nearest counting most, weakening (but keeping the nearest winds' way) far from them; with none drawn only a light drift of the wind belts remains. A wind carries on only where its lines touch: a line drawn touching another is that wind going on, while a gap leaves two separate winds. Where winds blow head on into each other a front forms (clouds and rain). How far rain reaches is counted from where the air leaves the sea: over the sea its moisture is refilled from the water under it (lots over warm water, little over cold currents or upwelling), and from the coast inland it is spent as rain and fades with distance (the moisture-reach slider), topped up again over lakes and seas. While the Wind brush is in hand, the area each wind holds sway over is shaded grey (the picked one darker); the Air & moisture map shows the moisture the air carries, with each wind coloured by the temperature of the air it carries. Mountains turn the wind a little along a range; air climbing toward a range drops its rain over a windward strip about 200–250 km wide, and the far side is dry. Moisture comes off warm seas (little off cold currents or upwelling) and fades with distance inland (the moisture-reach slider). High-pressure zones are placed with the High pressure brush (strength, reach, season; lows are not placed): they raise the pressure, so the air under them is clear and dry, and the winds are drawn round them by hand. Nothing about winds or pressure is placed automatically, and the older automatic centres described below are no longer used.

**Adapted for this sim (decided, from the pressure-zone packet).** The rule behind all of it: heating makes air rise (low pressure: cloudy, wet, air flows in) or sink (high pressure: clear, dry, air flows out); wind blows from high to low, bent by rotation (right in the north, left in the south; no bend at the equator, most at the poles). Highs spiral outward (clockwise in the north), lows spiral inward (counterclockwise in the north); mirrored in the south.

*Fixed centres, seasonal strength and size.* Pressure centres are placed once from the land and sea, then each season changes how strong and how big they are. Latitudes are for Earth's day; on other day lengths every mark keeps its place within its cell (as for currents). With more cells, the cell edges alternate high, low, high… from the equator outward (Earth: high at 30°, low at 60°).

| Centre | Where it goes | Seasons |
|---|---|---|
| ITCZ (low) | The decided ITCZ path (see below) | Its own summer and winter paths |
| Subtropical highs | One per ocean basin per hemisphere where at least ~3,000 km of open water lies along the first cell edge (30°). Centre at 30°, in the eastern third of the basin, 1,000–2,000 km off the eastern coast, over the cold current from the current rules. With no land on the east side, the middle of the widest open stretch. An oval about 2–3 times wider than tall | Fixed centre. Summer: stronger and stretched poleward to cover about 25–40°. Winter: shrunk to about 20–32°. This gives dry-summer, wet-winter west coasts (Mediterranean) and the seasonal desert edge. A warmer world moves them poleward about 1° per 4 °C above 15 °C |
| Winter continental highs | One per large landmass at 40–60° that is at least ~2,500–3,000 km across. Landmasses joined by land, by shelf (Shallow sea) or by a strait narrower than a slider (default 300 km) count as one. Centre: the point farthest from the sea, pulled toward high ground (high mountain zones, plateaus) | Winter only, and only where the land is at least 5–10 °C colder than the sea at the same latitude (slider). Bigger and higher land, stronger high. Summer: off |
| Summer thermal lows | Hot interiors of large land in the 15–40° band, pulled toward plateaus | Summer only, always on (strength slider). Draw sea air inland: moist air makes a monsoon; over desert with only dry air around they stay dry |
| Subpolar lows | One per ocean basin at about 50–65°, over the western-middle of the ocean near the warm current | Stronger and further equatorward in winter. Where open ocean runs all the way around at that latitude (no land in the way), they merge into a continuous ring of storms |
| Polar highs | One per pole, pulled toward the middle of any land or ice covering it | Strong over land and ice, weak over open polar sea. On flat maps the pole is placed even when it lies off the map, so its winds still reach the map |

*Pressure field and winds (on the climate points, no tiles).*
1. Add a smooth bump for each centre (up for highs, down for lows, sized and weighted for the season) to make a pressure field.
2. Wind flows from high to low, turned by rotation: strongly away from the equator, nearly straight across it. How strongly depends on day length and planet size. Globes use their own size. Flat maps have an optional planet size setting in World settings: when it is off, the climate assumes an Earth-sized planet (slightly less exact, but fine).
3. Where wind crosses the equator, its east–west bend flips. This gives monsoon directions by itself: a SE trade crossing north becomes a SW wind.
4. Mountains: a range at a shallow angle to the wind steers it along the range; a range across the wind lets the wind through but takes its moisture (rain shadows).
5. Prevailing winds come out of this as trades (0–30°, from the NE in the north, the SE in the south), westerlies (30–60°, from the SW and NW; stormy, strongest in winter) and polar easterlies (60–90°).

*Monsoons.* Strongest with a large landmass at 10–30°, warm sea on its equator side, high plateaus, and large tilt. Weak or absent on small continents, land far from the tropics, coasts facing cold currents, and low-tilt worlds. Summer: thermal low plus the ITCZ over land, wind from sea to land, wet season. Winter: land cools, a high may form, wind from land to sea, dry season.

*Fronts.* Rainy boundaries handed to the rain pass:
- Polar front: where the westerlies meet polar air, about 50–65°; reaches about 30–40° in winter, pulls poleward in summer. Stronger where cold land sits next to warm sea in winter. In winter it brings most of the rain to mid-latitude west coasts.
- Between neighbouring highs: where their winds meet, placed closer to the western high, slanting equatorward at its west end and poleward at its east end.

*Order per season:* wind belts → currents → temperature → ITCZ path → pressure centres → pressure field and winds → equator flip → fronts → upwelling, then rain.

*Map view "Pressure & winds":* H and L marks for each centre (sized by strength), soft shading for high and low pressure, wind arrows, the ITCZ path, and fronts shown as a soft grey zone between the air masses (no weather-map symbols); summer or winter.

*Sliders:* subtropical high strength, continental high threshold (°C colder than sea, default 7), thermal low strength, polar front shift by season, landmass joining gap (default 300 km). Rotation strength follows day length automatically.

**General notes (from the Worldbuilding Pasta method):**
Pressure zones are placed fresh each season, not from a fixed latitude table. Air flows from high to low pressure; Coriolis deflects it right in the north and left in the south.

| Zone | Latitude | Summer vs winter | Air | Weather |
|---|---|---|---|---|
| ITCZ (low) | 0–10° over ocean; up to 20–25° over land in summer | Follows each season's warmest latitude | Rising | Very wet |
| Subtropical highs | ~25° in winter, ~35° in summer; over the eastern side of oceans, on the cold leg of each gyre | Poleward in summer | Sinking | Dry |
| Subpolar lows / polar front | ~50–65° | Stronger and further equatorward in winter | Rising | Stormy, wet |
| Polar highs | 75–90° | Little shift | Sinking | Cold, dry |
| Winter continental highs | Interiors of large landmasses ~5–10 °C colder than ocean at the same latitude | Winter only | Sinking | Cold, dry; air pushed offshore |
| Summer thermal lows (optional) | Hot continental interiors | Summer only | Rising | Draw monsoon air inland |

- **ITCZ per season (decided, replaces "warmest latitude per column"):** one path per season running the full width of the world. Summer sits in the northern hemisphere, winter mirrors it into the southern one with the same rules.
  - **Tilt sets the limit.** The path never goes further from the equator than the axial tilt (23.5° on Earth), except a few degrees past it over hot interiors and big plateaus. Zero tilt keeps it on the equator.
  - **Over open ocean** it sinks toward its lowest point: 5° from the equator on Earth (5°N in summer, 5°S in winter), scaled with tilt (about a fifth of the tilt).
  - **Over land** it climbs toward the tilt line.
  - **Width decides how far it gets.** It starts ramping up while still at sea as it nears a coast (ramp distance slider, default 500 km), peaks at the middle of the landmass, and drops back to meet the sea on the far side. A wide ocean lets it sink all the way to 5° in its middle; narrow seas and small islands move it only in proportion to their size. Sliders: land width for full reach (default 2,500 km) and ocean width for full reach (default 4,000 km).
  - **Only land in the band counts:** land between the equator and the tilt line in that season's hemisphere. A big landmass in the 10–30° band with ocean on its equator side gives the biggest swing and the strongest monsoon.
  - **Cold currents and upwelling** near the equator hold it away from the equator: over the eastern side of oceans it stays about 5–10° into the summer hemisphere and resists crossing.
  - **Hemisphere imbalance:** if one hemisphere has much more land, both paths shift a few degrees toward it (about 5°N on Earth).
  - **Plateaus** add pull. The path is smoothed so it never zigzags; it joins up across the edges on wrapping maps.
  - **Off a flat map's edges** counts as open ocean. Orbital eccentricity is left out.
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
**Decided rules (these override the general notes below where they differ).** Colours on the map: black = neutral, red = warm, blue = cold. Latitudes below are for Earth's day length; they move with the cell edges for other day lengths.

*Where currents can flow.* Only over Deep sea paint (deeper than about 200 m). Shallow sea paint is the continental shelf: currents run along its edge, never across it. Passages between landmasses let part of a current through only if a deep-water gap is wide enough (slider); otherwise the gap is a wall.

*Equatorial currents (black, neutral).* One each side of the equator, about 5–20°, driven west by the trades; wide, slow, steady. They warm the whole way across, so the west side of every ocean has the warmest water and higher sea level.

*Equatorial countercurrent (black, neutral).* Runs east under the ITCZ, between the two equatorial currents: narrow and fairly fast, carrying piled-up warm water back east. Strongest when the ITCZ is far from the equator; weak or gone when the ITCZ is within about 3°. Where it reaches the far coast it turns along the shelf edge, splits north and south, pushes back the cold current and its upwelling at that latitude (a warm, rainy pocket on an otherwise cool, dry coast: warm anomaly, seeds "wet", cancels upwelling while strong), then mostly turns back west into the equatorial currents, closing the loop. Where it weakens seasonally, the cold current takes back over, so that coast swings between a warm wet season and a cool dry one.

*Hitting a shelf: splits.* A current meeting the shelf edge head-on splits both ways along it. Each branch is weighted by the coast's angle (a coast slanting toward one pole sends more water that way) and by which side the ITCZ is on that season.

*Warm boundary currents (red).* When a westward equatorial current hits a shelf it splits and turns red, carrying warm water poleward along the coast to about 30°.

*Crossing the sea (westerlies, 30–60° cell).* The warm water then crosses the ocean eastward at about 40–50°, keeping a slight poleward slant, so it arrives near 50° on the far side. If a continent blocks it from getting that far poleward, it simply follows the coast east to the other side of the sea.

*Far side at 40–50°: splits again.* Cold (blue) equatorward along that coast, back to the equatorial current, closing the subtropical gyre; warm (red) poleward to about 70–80°.

*Polar easterlies.* At 70–80° the easterlies push the water back west across the sea. Where it hits a shelf it splits again: cold (blue) equatorward, closing the subpolar gyre.

*Polar current.* Above that, a neutral (black) current circles the pole east to west.

*Mid-ocean currents and nearby land.* A major current crossing open ocean on its own (no landmass in its path), with a substantial landmass directly poleward or equatorward of it within 50° of latitude, splits off a branch that runs to that land's shelf and then back the opposite way to the current it came from, completing a gyre. The branch takes the opposite temperature from its parent: warm currents send off cold branches, cold currents send off warm ones, so every gyre has a warm side and a cold side. Neutral currents (the equatorial and polar ones) are the exception: branches meeting them become neutral. The reverse also holds: a current running along a continent within 50° of a major ocean current turns out to meet it and joins it.

*Day length moves the marks.* The latitudes above are for Earth's day (cell edges at 30° and 60°). On other worlds each mark keeps its place within its cell: warm boundary currents run up to the first cell edge; the crossing happens a third to two-thirds of the way through the next cell; the poleward branch reaches a third to two-thirds of the way from the last cell edge to the pole. Faster spin adds cells, so more, narrower gyres stack up toward the poles; slower spin removes them.

| Day length | Cell edges | What the currents do |
|---|---|---|
| ½ day | 25°, 40°, 55°, 70° | Warm currents up to 25°; crossings near 30–35°; an extra gyre between 40° and 55° that alternates warm and cold sides; poleward branch to about 75–80° |
| 1 day (Earth) | 30°, 60° | As above: up to 30°, crossing at 40–50°, poleward branch to 70–80° |
| 2 days | 40°, 70° | Bigger subtropical gyres: up to 40°, crossing at 50–60°, poleward branch to about 80–85° |
| 4 days | 55° | One huge gyre per ocean: up to 55°, crossing near 65–75°, no polar easterlies, so water circles near the pole instead of returning west |
| 16 days | ~70° | Almost one ocean-wide loop per hemisphere; up to about 70°, crossing near 75–80° |

*Seas closed off from the equator.* Where a sea is cut off from the equator (by continents or their shelves, which count the same), the polar currents send cold water down its western side, following the rules above; on meeting a shelf it turns east and warms, then heads poleward again to rejoin the polar flow: a gyre of its own.

*Shelf water.* Shelf temperature blends the nearby current with local sun heating, weighted by distance from the shelf edge. A narrow shelf brings the current's warmth (and rain) right to the coast; a wide shelf softens it and is warmed more by the sun (prime reef country where the equatorial current arrives).

*Reefs.* Best on warm, wide, shallow shelves where the equatorial current arrives; also near the countercurrent's landfall if the water stays above the reef temperature in winter.

**General notes (from the Worldbuilding Pasta method):**
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
**Adapted for this sim (decided).**
- Each coastal sea point gets one state per season from the decided wind along the coast: surface water is pushed to the right of the wind in the north (left in the south). Pushed out to sea: upwelling; piled against the coast: downwelling.
- Stronger with steady winds (trade coasts most), a cold current along the coast, and a narrow shelf. Cancelled where the countercurrent lands while it is strong. Monsoon winds can switch a coast between upwelling and not, season by season.
- **Equatorial upwelling:** the trades also raise a strip of cold water along the equator on the eastern side of oceans; this is what holds the ITCZ away from the equator there.
- **Fog** over upwelling coasts is shown as a soft white haze along the coast in the map looks.
- Effects as in the table below: rich fishing, fog, cooler and drier coast, reefs blocked (especially in winter).

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
**Adapted for this sim (decided).** Worked out for summer and winter on the climate points.
1. **Base by latitude and season:** the warmest band follows the sun toward the summer pole as far as the tilt allows; the world's average temperature shifts everything (a warmer world also pushes the subtropical highs poleward about 1° per 4 °C).
2. **Land vs sea:** land swings further toward each season's extreme than sea.
3. **Distance from the sea, measured upwind** along the decided winds: the longer the trace back to the sea, the bigger the summer–winter swing. High ranges cut sea air off near the coast.
4. **Currents:** the red and blue currents warm or cool nearby coasts, scaled by how onshore the wind is and by shelf width (narrow shelf strong, wide shelf soft).
5. **Height:** cools about 6.5 °C per km (slider), using hidden climate heights for painted features:

| Painted feature | Climate height |
|---|---|
| Hills | 0.3–0.5 km |
| Foothills | 0.5 km |
| Highlands | 1.5 km |
| High mountains | 3 km |
| Peaks | 4.5 km |
| Plateau | 1–2 km, by its Strength |
| Volcano | By its zone, like mountains |
| Rain Shadow Pen line | Overrides any of these |

6. **Climate crystals:** heat and cold crystals add their local change.
7. **Ice:** land where summer stays below freezing is ice cap; peaks keep snow where their summer is below freezing; sea ice follows the decided sea ice rules.
8. **Winter snow cover:** where winter is below freezing and wet, the ground is snow-covered in winter: white on the winter map, and slower winter travel later.

**Units:** temperatures are shown in °F only.

Per season: base temperature by latitude, then corrections for currents, land vs ocean, continentality, altitude (height class) and climate crystals.

- **Land vs ocean:** each point has a heat capacity (land low, ocean high); land moves further toward each season's extreme. Without this, interiors match coasts, continental climates never form, the ITCZ can't swing over land, monsoons are weak, and winter highs never form.
- **Continentality:** for each land point, trace back along the prevailing wind to the nearest ocean; a longer trace means a bigger summer–winter swing.
  - Westerly belt (~35–60°): ocean air reaches 500–1,500 km inland from west coasts on flat land; a range over ~1 km stops it near the coast.
  - East coasts in the westerly belt are already continental (offshore wind).
  - Trade belt (~0–30°) reverses: east coasts get ocean air, west coasts are dry.
- **Altitude:** about 6.5 °C per km of height class (slider). Roughly, 1 km acts like moving 8° poleward.
- **Sky layers:** colder and windier with each layer up.

**Sea ice (decided)**
- The bulk of the sea ice lies between 70° and 80°.
- It reaches further equatorward as a thin strip along cold-current coasts, at most down to the 45° latitude line (how far it gets depends on how cold that coast's current and winters are).
- Warm currents eat it away and cold currents build it up. It never vanishes because of a warm current; there is just less on the warm side and more on the cold side.
- A warm current crossing the sea corrals the ice: in summer it stops the ice from crossing that current.
- Winter: more ice, its edge toward 70° and beyond, and the cold-coast strips reach further. Summer: the edge pulls back toward 80°, more so where warm currents run, and the strips shrink.

**Ice**
- No ice-free land below 0 °C in summer; no land ice above 0 °C in summer.
- Sea ice where the sea stays below −2 °C (permanent if in summer, seasonal if only in winter).
- Lowland ice past ~40° from the poles risks a runaway snowball planet.

### 7.8 Precipitation
**Adapted for this sim (decided).** Worked out for summer and winter.
1. Moisture starts at the sea, strongest off warm water and warm-current coasts with onshore wind, and is carried along the decided winds, fading over the moisture carry distance (slider).
2. Wet: the ITCZ band (very wet), the grey front zones and the polar front belt, and monsoon rain drawn inland by summer thermal lows where the arriving air is moist.
3. Dry: under the subtropical highs (at their seasonal size), winter continental highs, and cold upwelling coasts (fog, little rain).
4. Rain shadows from painted features and Pen lines: rain falls on the windward slope (peaking at about 1–1.5 km of height; air above about 4 km is dry); behind, dry until new moisture arrives.
5. Lakes, rivers, waterfalls (oases) and rain crystals wet the ground near them. The world's Rainfall setting shifts the carry distance and thresholds.
6. **Shown as a rainfall heat map** (a continuous scale from dry to very wet), while the climate and simulation keep the three main types per season: dry, wet, very wet.

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
**Adapted for this sim (decided).**
- **14 zones:** tropical rainforest, tropical monsoon, tropical savanna; hot desert, cold desert, hot steppe, cold steppe; Mediterranean, humid subtropical, oceanic; humid continental, subarctic; tundra, ice cap. (Full Köppen detail isn't needed.)
- **Rules in °F:** ice cap: summer below 32 °F; tundra: summer 32–50 °F; tropical: winter at or above 64 °F; temperate: winter at or above 32 °F and summer at or above 50 °F (hot summer at 72 °F); continental: winter below 32 °F, summer at or above 50 °F (humid continental if summer reaches about 66 °F, otherwise subarctic). Rain rules follow the order below; deserts get a steppe border about 60–190 miles wide in the tropics and twice that at higher latitudes, thinner on steep slopes.
- **Mountains** have no zone of their own: their hidden climate heights cool them, so they step through the zones on the way up.
- Zone boundaries are blended over a short distance. The Climate zones view has a legend, and the readout names the zone with both seasons' temperature and rain.
- **Oases:** a waterfall oasis or a lake in a desert stays desert, but the ground near it is more fertile and more livable (for farming and settling).
- **Painted cover vs. zone:** the zone (and its temperature and rain) always comes from the climate; painted ground cover decides what grows and how it looks there. A zone only changes if the climate changes.
- **New ground cover types,** both automatic and as brushes: savanna (grass with scattered trees), dry scrub (Mediterranean), conifer forest / taiga, steppe grass, rocky desert. Trees and shrubs are part of each cover's texture, never drawn as symbols.
- **Checked against the 14-climate list (built):** hot vs cold desert and steppe split by the coldest season (at or above 0 °C is hot); rainforest needs very wet in both seasons, monsoon very wet in the rainy season only, savanna wet in the rainy season and dry in the other; steppe borders are about 200 km round a hot desert and 400 km round a cold one (half on steep slopes, 1.3× on gentle highlands), and desert that catches some rain in its wetter season fades to steppe.
- **ITCZ drawn by hand (built):** the ITCZ brush (Climate tab) draws the belt for a season (or both). Where the line runs it replaces the automatic path; past its ends the belt eases back to the automatic one over about 1,500 km. With the ITCZ brush in Drag mode (its default) the belt for the season shown appears as a yellow line with dots: drag any dot (or tap the line to add a bend) to move it where it should be; the first drag turns the worked-out path into a line of its own. "Reset to automatic" gives it back to the climate. Draw new line draws a partial line instead.
- **World tab (built):** a tab of the tools panel with everything that changes the whole world's climate, applied as you go: tilt, day length, average temperature, rainfall, the life balance, rain travel distance, rain shadow height, cooling with height, current strengths, the coral reef comfort zone and the automatic ITCZ's tuning. World settings keeps the name, the map's place, the spin and the planet's size.
- **Life balance (built):** −100 to 100, 0 changes nothing. Above 0, highs, rain shadows and cold coasts dry the land less, moisture travels further, and the driest places gain the most rain, so deserts shrink and living climates spread; below 0 the reverse.
- **Reference image (built):** a picture (an atlas page, a sketch, Earth) laid over the map to paint from: imported in the View panel, moved and stretched by dragging or by fields, faded by opacity, saved with the world (scaled to at most 2,048 px). The simulation never reads it.
- **Automatic ground cover (built):** each climate point gets a main cover and a second cover that shows in patches by its share, from its zone, both seasons' rain and warmth, and its height. Rainforest: jungle (cloud forest on high slopes). Monsoon: jungle with dry-season woods. Savanna: savanna, woodland toward the wet side, open grass toward the dry side. Hot desert: dunes on low ground, rocky desert higher up. Cold desert: rocky desert with thin steppe. Steppes: steppe grass, with savanna or scrub (hot) or taller grass (cold). Mediterranean: scrub with woods on wetter or higher ground. Humid subtropical: forest, grass where a season runs dry. Oceanic: forest with moors on hills. Humid continental: forest, prairie where summers are drier, conifers where summers are cool. Subarctic: taiga, opening to tundra near the tree line. Tundra: tundra with lasting ice where summers barely thaw. Ice cap: ice. Painted cover still overrides it, and the readout names the automatic cover where nothing is painted.

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
**Adapted for this sim (decided).**
- A reef forms on Shallow sea where the water stays within the reefs' temperature range all year, and there is no winter upwelling (except the warmest near-equatorial water).
- **Temperature range sliders:** coldest water reefs thrive in (default 64 °F, the coldest season must stay at or above it) and warmest water they thrive in (default 86 °F; hotter water bleaches them, so the warmest season must stay at or below it).
- Best on wide warm shelves where the equatorial current arrives, and near the countercurrent's landfall; warm currents push them poleward along east coasts, upwelling keeps them off west coasts.
- **Big river mouths** dump mud that kills reefs near them, scaled by river width.
- **Look:** still one type in the data, drawn as a turquoise textured band along the outer edge of wide shelves (barrier look), hugging the coast on narrow shelves, and ringing small islands.
- **Reef brush:** add or remove reefs by hand (overrides the climate there).
- **For the simulation:** reefs are a hazard to ships (like whirlpools), give rich fishing, and yield coral, pearls and shells.

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
- **Built (Phase 5, step 1): the Library.** One shared library on the device (start screen → Library); each new world starts with a copy, and a world's copy can be changed on its own (world screen → Library), loaded from or saved to the shared one, and exported or imported as a file. Tabs: **Peoples** (species with their races: the author's roster of 44 species and 65 races loaded from SPECIES.md with the sheet's stats; missing values left blank and each race flagged with what it still needs), **Beasts** (about 30 real-world animals to start from), **Traits** (the examples above and more, each with effects the simulation will read) and **Resources** (about 50, with where they are found). Species hold the shared biology (body, life, environment, mind and society, relations, war); races hold the stats, size, fighting age, lifespan, affinities and specialties, and may add or lack traits and override lifestyle and climates. Steps 2 and 3: the tech editor and culture creator, then the government and faith/god creators.

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

### 8.4h Market and economy
**Units**
- Everything is counted in **units**. One unit of an item satisfies a set number of people (for example one unit of grain feeds so many people for a month); a workshop needs a set number of units of inputs to make one unit of output.

**Resources and goods**
- **Resource maker** (with the tech editor): where a resource is found (feature, climate, layer, beast, rift), how it is gathered, its rarity, its uses.
- Raw resources (grain, game, fish, timber, stone, ores, salt, wool...), new sources (giant tree fruits and bark crops, fungus, volcanic stone and ash soil, small crystals, beast parts such as leather, feathers, horns), and rift resources (varied, not necessarily better, sometimes super-rare metals).
- Goods are made from resources by recipes that come from technology (tools, weapons, cloth, pottery, ships, clockwork, steam parts...).

**Production**
- Settlements work resources within reach; farming is simulated inside the settlement.
- Workers are split between jobs by need, opportunity and culture; technology, culture and race traits improve output.
- Settlements specialize naturally (mining towns, ports, market towns, rift camps, tree farms).

**Trade**
- Each settlement has a local market: supply, demand, prices that rise with shortage and fall with surplus.
- Caravans, trading families, guilds and state convoys carry goods along the travel network; price differences make trade pay.
- Better roads and bridges, safe routes and treaties raise trade; monster tides, wars, embargoes and dangerous whirlpools cut it. Routes shift (for example toward a new permanent rift).

**Money**
- **One currency**, to keep it simple, but what it's worth varies widely from place to place.
- **Barter first:** cultures trade in what they have (fabrics and horns in one place, jewels in another). They only push toward coin when forced to: for example a people who can't trade their jewels directly sells them to another nation for coin, to buy what they need elsewhere.
- Banking, loans and debts come later, with technology and culture.
- Taxes and tribute collected by whoever the government's parts say (state, lords, temples, clans). Wealth gathers in settlements, noble houses, guilds, temples and trading families, and feeds their political power.

**Guilds:** merchant, craft, mage, adventurer and rift guilds; non-state powers that control trades, hold rift encampments, send parties, lend money, back factions, span nations and can outlast them.

**Rift economy:** rifts pull settlements, routes and guild encampments toward them; their resources are collected by armies, guilds and parties and sold in settlements; a rift breaking or closing can end a local boom.

**Food and famine:** as in the current game: seasonal harvests, stores that spoil, famine in bad years.

**Slavery and forced labour** exist in this world (affecting the economy, politics and culture).

**Market views:** a **local view** when a nation or settlement is selected, and a **global view**.

**Scope:** agreed as a starting point; it will be tuned while playing with it.

### 8.4i War
**Forces** (set by the government's army part and the culture's martial custom): clan warbands, levies, lords' retainers, standing armies, specialized troops (racial and trained units, for example Ory tunnel-fighters, avian sky scouts, Capra mountain troops, Shwana sea fighters), mercenaries, militia, religious and mage orders, and late in the tech tree mechanized infantry and vehicles.
- Units are built from the race stat block (strength, toughness, morale from Willpower, march speed) plus equipment from technology and goods (weapons, armour, mounts, siege engines).
- Raising an army costs people (soldiers lost are people lost at home), food, gear in units, and pay (coin or goods).
- **Army size has no artificial cap:** a nation fields whatever forces it has the means to raise and keep. If it has the means to field a Roman-style army, it can.
- **Heroes:** notable individuals who lead, duel, inspire and raid, with power levels (mage and priest heroes draw on mana); gods' champions are heroes.

**On the map:** named armies move along the travel network at their race's march speed, slowed by terrain, season and supply; they eat from stores and the land, short supply brings attrition and desertion. Flying units cross blockers and reach the sky layers; tunnellers move under the surface; Underdark armies use their tunnels; fleets use sea lanes; airships later.

**Battles are phased** (for example skirmish, clash, pursuit), each phase favouring different units (archers, cavalry, heroes), decided by numbers, unit quality, heroes, terrain, morale, leadership and surprise. Defenders have a strong edge at rivers and crests; fortresses on rivers and passes matter.
- **What you see:** while two armies clash, the map shows that they are fighting. When the fighting between them stops, a full battle report is available.
- Sieges (walls and forts by technology; starving out or storming; siege engines, later gunpowder), naval battles, later sky battles, and underground warfare (tunnelling under walls, cavern battles).

**Occupation and peace:** occupied land striped as now; the occupier loots and taxes, the owner tries to liberate; peace terms from the diplomacy list; justified treaty breaks as decided; war weariness pushes toward peace.

**Monsters:** rift breaks, monster tides and hordes are wars against monsters; coalitions can form against a horde. Monsters are made in the **beast creator** (as hostile beasts), with alphas as monster heroes. Guild parties and adventurers are small hero-led forces for rifts and monster hunting.

**God mode:** spawn armies, start or end battles, trigger monster tides.

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
- **Built (Phase 4):** worked out with the climate, on its points. *Landmasses:* connected land; at least the "Smallest continent" size (default 1 million sq mi) is a continent, smaller is an island; three or more islands within a short sail are an archipelago. *Waters:* a watershed on distance from land, split where a passage is narrow for the smaller water (under half its open width); water meeting at the map's edge carries on past it. At least 3 million sq mi (or open water reaching the map's edge) is an ocean, the rest seas; water mostly ringed by land (rays reaching land in about 60% of directions) is a gulf (over about 46,000 sq mi) or a bay. *Natural regions:* land of one kind (Mountains, Highlands, Icefield, Tundra, Taiga, Forest, Jungle, Savanna, Plains, Steppe, Scrubland, Desert, from height, zone and ground cover), parted by big rivers and Divide lines, small specks joined to their neighbours, large stretches cut into about region-sized pieces with wandering borders (Region size, default 250 miles). *Mountains first:* height decides before climate (snowcapped peaks are Mountains, Icefield is only ice on low ground); mountains and highlands are never smoothed away or folded into lowland regions, and a range stays one region however long, so it carries one name. *Lakes and rivers:* named from what is painted (touching lake strokes are one lake; each river stroke is one river), lake pins snap into the lake and river pins onto the river; named rivers are lettered along their course, unnamed rivers are left unlabelled. *Tools (Geography tab):* Divide (cut), Join (make one), Name (pins that name what lies under them, so names stay with the land; continents, islands, archipelagos, oceans, seas, gulfs, bays, ranges, regions, lakes and rivers). Named places are labelled before unnamed ones and keep readable lettering whenever they can be seen. *Map:* labels sized by importance (continents and oceans grandest), unnamed places shown by kind in plainer lettering, a Labels choice and a Geography map in the View panel; the readout and climate report name places.
- **Political regions (provinces):** drawn by nations as they grow, often but not always following natural regions. They change with conquest, and every change is recorded in the history.

---

## 8A. Map look

- Styles as before: satellite (realistic) and paper (drawn).
- Labels look like fantasy map labels. The more important the name, the larger and more artistic the lettering: regions and nations get the grandest designs.

## 10. Build order (decided)

**A rewrite over the current sim:** the new version replaces the current code (the old version stays in the git history).

**Order, by dependency** (each layer only builds on what's already solid; each phase ends with something to open and try, approved before the next):

| Phase | What gets built | Why here |
|---|---|---|
| 0. Foundations | World model with no tiles (real distances; flat and globe both planned into the coordinates from the start), world settings, layers, save/load, start screen (Create world / Continue sim), canvas expanding | Everything else sits on it; the globe must be possible from day one even though it's built last |
| 1. Land & painting | Land & Sea, painted feature brushes (mountains with zones, hills, plateaus, cliffs, canyons, forests...), satellite and paper looks | Where the old version failed; everything visible depends on it |
| 2. Water | River point mode, joining rivers, lakes, waterfalls on the surface | Needs painted features to route through |
| 3. Climate | Rain Shadow Pen, summer/winter climate, climate crystals, automatic ground cover | Needs land, features and water |
| 4. Geography | Continents, seas, natural regions, tools, labels (naming styles arrive with cultures) | Needs land and climate |
| 5. Data creators | Resource maker, species/race and beast creator (roster loaded), traits, then tech editor, culture, government and faith/god creators | The simulation reads all of these |
| 6. First peoples | Time controls, clans and tribes claiming land by walking, migration, hunting, beast densities | First living layer |
| 7. Settlements, economy, travel | Settling, units-based economy, markets, trade, roads and bridges | Needs peoples |
| 8. Culture & technology | Traditions, learned behaviours, tech tree, spread and loss | Needs settlements to hold and spread them |
| 9. Governments, politics, religion | Governments, factions, diplomacy, royal families, spies, faiths, gods | Needs nations |
| 10. War | Armies, phased battles, sieges, occupation, reports | Needs governments and economy |
| 11. Mana & rifts | Ley lines, world tree roots, rifts, monster tides and hordes | Needs war and politics to respond |
| 12. Other layers | Underdark, canopy and giant tree cities, sky islands, vines, waterfalls between layers | Extends a working surface world |
| 13. Globe | 3D globe, flat and globe views side by side | Coordinates already support it |

**Ocean currents are placed by hand** (the Ocean current brush in the Climate tab): major currents for the ocean-wide gyres, equatorial and polar currents, and thinner secondary currents running in and out of bays and shallow seas to set the water temperature there. Each is warm, cold or neutral; warm and cold ones warm or cool the water and coasts near them (secondary ones reach less far), and the climate follows. Nothing is placed automatically. The brush's panel shows the rules below as a guide to which way currents run at each latitude.

**Ocean current rules (agreed with the designer; the guide shown with the brush).** Mirrored for the southern hemisphere. Latitudes are Earth's (24-hour day); they move with the wind-cell edges on other worlds.

- *Around the ITCZ (all neutral, black; at sea only)*
  1. The countercurrent runs west to east exactly on the ITCZ line, following its curve in both seasons. (Where the ITCZ swings far over a continent, the currents' line stays within about 8° of the equator, so they don't cross to the far side.)
  2. Two equatorial currents run east to west, exactly 5° north and 5° south of the countercurrent.
  3. At an ocean's west end each equatorial current turns poleward as a warm current, and part turns back into the countercurrent; at the east end the countercurrent splits into the two westward currents.
- *Hitting land*
  4. A current that hits land splits: warm toward the pole, cold toward the equator, wherever each has room. A current follows a coast only while the coast runs roughly along its path (within about 26° of straight toward the pole or equator); where the land bends away more than that, it carries straight on, and currents never cross. A current just meeting land from the open sea may first follow the coast round a shoulder (by the land's east side) for up to about 6° before this applies.
- *Warm currents going poleward*
  5. At about 40° they start heading east if there's open sea, arcing slowly up to about 50° if the sea is wide enough.
  6. A warm current also branches off the westward equatorial current to reach a landmass sitting poleward of it, even one whose peak is close to it, curving out of the westward current, going round by the land's east side and running along that east coast to about 40°.
- *Cold currents going toward the equator*
  7. A cold current coming down toward a warm current that turns east at about 40° goes on past 50° to meet it there, and merges into it.
  8. With no warm current to meet, they turn east at about 50°.
  9. Cold currents heading for the equator carry on past the end of the coast, across open sea, until they join the westward equatorial current.
- *Polar currents*
  10. The polar current runs east to west (neutral) at about 70°.
  11. A warm current reaching the polar current takes the polar current's place and flows west there, still warm; the polar current moves about 5° further poleward alongside it, so the two never cross.
  12. When that warm current hits land it turns cold and runs toward the equator without splitting, meeting the warm current coming up the coast at about 40–50°, and they turn east.
  13. As the polar current passes a landmass whose poleward end lies between about 45° and 70°, a cold current curves out of the polar current and runs up to and along that land's east coast toward the equator, meeting the warm current at about 40–50°.
- *Open sea*
  14. In open sea nothing forces a sharp turn: currents turn in wide arcs (a warm current leaving a coast to join the polar current arcs round into it). Along a coast the land can turn them sharply.
  15. How steeply a current crossing open sea moves toward the pole or equator is a setting (Climate fine-tuning, "Current slope in open sea", Earth about 155 miles per degree).
- *Learned from hand-drawn teaching maps (maps 1–3)*
  16. A landmass lying between the 40–50° crossing and the equator (one the crossing passes poleward of) still gets cold water: a cold current branches off the crossing, heads for the land's west coast (or the west edge of its shallow shelf) and runs along it to the westward equatorial current. Nearby lands share one such current, and a land that only just pokes past the equatorial current, which already runs along it, gets none.
  17. A small neutral current runs west round the end of a landmass, from the warm current on its east side to the cold current on its west side: a mini gyre carrying water from the warm current to the cooler one. It only forms where both currents are there.
  18. A current following a coast that still runs on eastward stays warm while it's poleward of about 40°; where the coast takes it toward the equator past that it turns cold, then keeps following the coast the way it has settled into.
  19. A crossing that meets a coast running on roughly east (a land's equator-side coast) follows it instead of splitting; a warm branch still goes poleward up the land's west coast.
  20. Bays: the crossing dips into a bay along its east side (warm), runs along the far shore, and comes out along the west side as cold water (from rules 4 and 11–12).
  21. An equatorial current meeting a tropical landmass (a small one, or one whose coast falls away westward) runs round its poleward side along the coast instead of stopping. Where that land reaches on past the current's line and open sea lies poleward, a warm current still leaves there toward the pole. An equatorial current reaching an ocean's west end always turns poleward there (rule 3), even one that began as a cold current.
  - Arcs from 40° to 50° stay as rule 5: they only reach 50° where the sea is wide enough.
- Off the map's edges counts as open ocean, so currents can run off a "lead nowhere" edge.

**ITCZ over land (clarified after testing):** land width decides how far the belt tries to go, but in each place it stops about 1.5° beyond the land's furthest reach toward the pole, and the hemisphere-imbalance shift never pushes it past the tilt line (only high plateaus overshoot).

**Phase 3 (done).** Ocean currents, winds, high-pressure zones and (optionally) the ITCZ are placed by hand for each season; the climate, zones and automatic ground cover follow from them. Left to revisit: the Rain Shadow Pen sets a height along its line but doesn't yet make an escarpment one-sided; lakes and rivers now shape what grows by them (built): river banks and floodplains green by climate (strong in dry lands, hardly at all where it is already wet, fingers of taiga into the tundra), wider on flat ground and for bigger rivers; marsh on warm, low floodplains and in big rivers' deltas (green farmland in a desert delta); reeds round lakes, and a salt ring with milky water round a lake no river drains in dry country. Big lakes feed moisture to the air crossing them (more rain and snow downwind, none when frozen) and soften the seasons within about 150 km. Zones are unchanged by rivers; the extra fertility goes to the simulation later.

## 11. Still to design (details, when their phase comes)

- Steam and mana tech in depth: the top of the tech tree, and fuel for both.
- Missing species stats (new avian and insect races, Taluty size, fighting ages, lifespans, affinities); Nova, Zatatari and Oni later.
- The author's faiths and gods, entered with the faith creator.
- Exact severity degrees for each culture tradition.
