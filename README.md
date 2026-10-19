# Revelry & Valor — The Game of Legends

A fantasy world builder and simulation: paint a world, then watch its peoples, cultures and
nations live in it.

The game is being rebuilt from the ground up. The full design is in
[`docs/REDESIGN.md`](docs/REDESIGN.md) and the species roster in [`docs/SPECIES.md`](docs/SPECIES.md).
The old program is kept, unused, in `legacy/` for reference.

## Principles

- **No tiles.** Everything lives at real distances, stored in kilometres and shown in miles (with km).
- **No elevation numbers.** Height is shown only through painting.
- **Separate layers:** underdark, surface, canopy and three sky layers. Only the surface is always on.

## Build progress

Built phase by phase (REDESIGN.md, section 10); each phase ends with something to try.

| Phase | Content | State |
|---|---|---|
| 0 | Foundations: world settings, layers, save/load, start screen, canvas expanding | Done |
| 1 | Land & painting: Land & Sea, feature brushes, mountain zones, satellite and paper looks | Done (for review) |
| 2 | Water: rivers (point and draw), joining, lakes, waterfalls; volcanoes and lava | Done (for review) |
| 3 | Climate: ITCZ, currents, pressure and winds, temperature, rain, zones, sea ice, upwelling, reefs | Done (for review) |
| 4 | Geography | Next |
| 5–13 | data creators, peoples, settlements, culture & tech, politics, war, mana, other layers, globe | Planned |

### What Phase 0 does

- **Start screen:** Create world, or Continue a saved world (open, delete, import a world file).
- **Create world:** name; flat map at three sizes (Region 500 × 300 mi, Continent 2,000 × 1,200 mi,
  Large continent 4,000 × 2,400 mi) or a custom size; centre latitude; whether the ocean wraps
  east–west; the planet (tilt, day length, spin, average temperature, rainfall) and climate tuning;
  seed.
- **The world:** an empty ocean with latitude lines, the equator, tropics and polar circles (from
  the tilt), a scale bar, and a cursor readout. Drag to pan, wheel or pinch to zoom, Fit to reset.
- **Canvas options:** grow the map to the north, south, east or west. Growing north or south
  extends its latitudes; nothing already on the map moves.
- **World settings:** edit the planet and climate from inside the world.
- Worlds save in the browser (and autosave every 30 seconds).

### What Phase 1 does

- **Painting is stored as strokes, never cells.** Each stroke is a path in kilometres with its
  brush settings. The picture and the simulation's "what is here?" are both worked out from the
  strokes, so the land is the same at every zoom.
- **Land & Sea:** Land, Shallow sea and Deep sea brushes. A soft land edge leaves a strip of shallows.
- **Live painting, like a paint program:** a stroke is a row of stamps laid as you drag, so
  what you see while painting is exactly what stays. Land, sea and ground cover are opaque paint.
- **Mountains are a spray brush:** paint builds up, and the crest forms where it is thickest.
  Paint beside a mountain to widen it, over it to raise it, or along its edges with a small,
  weak brush for shoulders and spurs. Ridges and gullies are cut down the actual slopes, so any
  shape you build looks like real eroded mountains (Ridges & gullies setting). Hills build up
  the same way, lower.
- **Plateau:** a flat top ringed by layered rock faces, with scree at the foot and a shadow cast
  away from the light. Its Erosion setting notches the rim with gullies and adds more layers.
- **Cliffs:** draw along the top edge; only the face shows, on the low side (a rock lip,
  layered face with runnels, scree below, and a shadow when it faces away from the light).
  The high side is just the land you drew it on. Erosion setting.
- **Ramp:** draw from the ground floor up onto a plateau or cliff top, or down into a canyon:
  a graded slope with a worn track. Each ramp is an access point the world's peoples will use
  to reach those places.
- **Canyon / gorge:** terraced, layered walls, a flat floor, and side canyons cutting into an
  irregular rim (Erosion setting). **Ravine:** a narrow, deep, jagged crack.
- **Crater:** sized like a real impact: small ones are bowls; big ones have a flat floor,
  slumped terraces, a central peak, rocky layered walls and rays of ejecta. A new crater blasts
  away what was there, older craters included.
- **Erosion brush:** a spray that cuts gullies into mountains, lowers peaks and roughens coasts.
- Canyons, ravines and cliff faces block travel; ramps open them.
- **Ground cover:** Forest, Jungle, Grassland, Tundra, Marsh / swamp, Dunes, Badlands, Salt flats,
  Glacier / ice, Beach / shore.
- **Sea:** Whirlpools, dangerous to ships or harmless.
- **Mountain zones:** foothills, highlands, high mountains and peaks fill in automatically from
  how bold the mountains are; the Zone brush repaints them by hand. A view shows them with what
  each zone means for travel and settling.
- **Brush settings:** size, strength, softness, roughness, detail, variation. Erase removes only
  the selected brush's layer. Undo and redo.
- **Looks:** Satellite (realistic) and Paper (drawn). Height is shown only by light and shade.
- **Moving around:** drag with the Move tool, hold Space, or drag with the right mouse button;
  scroll or pinch to zoom.
- **Keys:** Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo, Ctrl+S save, E erase, [ and ] brush size.

### What Phase 2 does

- **Rivers, Points:** click the source, then points along the way; press Enter, or click on water
  (sea, lake or another river) to finish. The course is found through the painted land: it
  winds through low ground and valleys, goes around mountains, hills and plateaus, follows
  canyons, and meanders where the land is flat. **Draw:** drag the course yourself.
- Rivers grow downstream, and one that ends in another makes it bigger from there on (a click
  near a river snaps onto it). **Width** sets how wide it starts; **Wandering** sets how far (in
  miles) it may bend away from its course, 0 meaning a straight course.
- **Waterfalls** form by themselves where a river runs off a plateau, over a cliff or into a
  gorge: white water down the face, a pool at the foot, and green, fertile ground around (an
  oasis in a desert). They can also be placed by hand.
- **Lakes:** a brush for fresh water. Green banks along every river.
- **Volcanoes** (active or dormant): cones scored by gullies, with a glowing crater when active.
  **Lava flows** are drawn like rivers; active ones glow through cracks in a dark crust.
- The map readout shows rivers (and their width), lakes, waterfalls, well-watered and volcanic
  ground.

### What Phase 3 does

- **The climate works itself out** from what is painted, a moment after painting pauses (or at
  once with **Update climate**). It runs in the background for northern summer and northern
  winter, on an even grid of invisible climate points (at most about 300 across).
- **The chain:** the tropical rain belt (ITCZ) swings toward the tropic over wide land and
  stays near the equator over open sea; ocean currents circle around the wind cells (warm red,
  cold blue, neutral black); sea temperatures; land temperatures (inland seasons harsher, cooler
  with height); pressure centres (subtropical highs, winter continental highs, summer heat
  lows, subpolar lows, polar highs); winds turned by the planet's spin; fronts; upwelling and
  fog; rain carried inland by the wind, with rain shadows behind high ground; sea ice; snow.
- **14 climate zones** (rainforest to ice cap). They set the look of unpainted land: forest,
  grassland, savanna, steppe, desert, taiga or tundra. Painted ground cover still decides the
  look where it's painted.
- **Sidebar tabs:** Land & water, Terrain, Ground cover, Climate and View, so only the tools
  for the work at hand show.
- **Wind and current paths** are fixed to the map (they don't move as you pan) and get finer as
  you zoom in. Winds spiral out of the highs and meet along fronts and at the ITCZ. Major
  currents run through deep water, steered by the continents and the edge of the shallow shelf,
  joining into gyres; thinner paths through bays and shallows show their water's warmth and flow.
- **Map views:** Land, Climate zones, Temperature (°F), Rainfall (dry / wet / very wet heat
  map), Pressure & winds (H and L, wind arrows, fronts as a grey zone), Currents & sea (current
  arrows, upwelling, sea ice, reefs), each for **Northern summer** or **Northern winter**. The
  dashed white line is the ITCZ.
- **Reefs** grow on warm shallow sea (barrier band along the shelf edge, fringing reefs by the
  coast), not near big river mouths or cold upwelling. The **Reef** brush adds or removes them.
- **New brushes:** Savanna, Dry scrub, Conifer forest / taiga, Steppe grass, Rocky desert;
  **Climate crystal** (heat, cold or rain, with a reach); **Rain Shadow Pen** (set the height
  the climate sees along a line, with presets); **Gap (pass)** to let moist air through.
- **Settings:** the equator runs through the middle of a new flat map; **Centre latitude**
  moves the map (also in World settings). Temperatures show in °F. Optional planet size for
  flat maps. **Climate fine-tuning** has sliders for rain, cooling with height, currents, reef
  temperatures (64–86 °F), the ITCZ's land and sea widths and coastal ramp, pressure strengths,
  the polar front and the land joining gap.
- The map readout adds the climate zone, summer and winter temperatures and rain, and at sea
  the water temperature, sea ice, reefs and upwelling.

## Developing

```
npm install
npm run dev        # local server
npx vitest run     # tests
npx tsc --noEmit   # typecheck
npx vite build     # production build in dist/
```
