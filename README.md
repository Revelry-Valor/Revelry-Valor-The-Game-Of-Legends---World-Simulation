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
| 1 | Land & painting | Next |
| 2–13 | Water, climate, geography, data creators, peoples, settlements, culture & tech, politics, war, mana, other layers, globe | Planned |

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

## Developing

```
npm install
npm run dev        # local server
npx vitest run     # tests
npx tsc --noEmit   # typecheck
npx vite build     # production build in dist/
```
