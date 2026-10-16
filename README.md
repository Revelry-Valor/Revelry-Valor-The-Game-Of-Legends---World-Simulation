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
| 2 | Water: rivers, lakes, waterfalls | Next |
| 3–13 | Climate, geography, data creators, peoples, settlements, culture & tech, politics, war, mana, other layers, globe | Planned |

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
- **Live painting:** every brush paints onto the map as you drag, at its current settings.
- **Relief:** Mountains paint a crest down the middle of the brush, sloping to both sides, and
  build up: paint over a range to raise and widen it, or along its edges with a smaller, weaker
  brush to add shoulders. Modes: Range, Spur (snaps onto a range and tapers), Massif; a Side
  ridges setting. Also Hills (build up too), Plateau, Cliffs (choose the high side), Canyon /
  gorge and Ravine (both block travel), Crater, and Erosion (cuts gullies, lowers peaks, makes
  coasts ragged).
- **Look:** shaded relief like an atlas: mountains tinted from olive foothills through tan and
  rock to snow on the peaks.
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

## Developing

```
npm install
npm run dev        # local server
npx vitest run     # tests
npx tsc --noEmit   # typecheck
npx vite build     # production build in dist/
```
