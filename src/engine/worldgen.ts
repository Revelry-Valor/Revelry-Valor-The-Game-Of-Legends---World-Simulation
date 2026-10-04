import { BIOMES, Biome, Relief } from './data/biomes';
import { RES_COUNT, Res } from './data/economy';
import { MinHeap } from './heap';
import { Noise2D } from './noise';
import type { Rng } from './rng';
import type { MapData, WorldConfig } from './types';

export const DX = [1, -1, 0, 0, 1, 1, -1, -1];
export const DY = [0, 0, 1, -1, 1, -1, 1, -1];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function quantile(values: ArrayLike<number>, q: number): number {
  const arr = Float32Array.from(values).sort();
  if (arr.length === 0) return 0;
  return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * arr.length)))];
}

export function isWaterBiome(b: number): boolean {
  return b === Biome.DeepOcean || b === Biome.Ocean || b === Biome.Lake;
}

/**
 * Generate terrain, climate, rivers, biomes and natural resources.
 * Pipeline: continents + ridged mountains (or land shaped by hand) → sea level by quantile
 * → temperature by latitude, axial tilt and altitude → wind-driven ocean currents that turn along
 * the coasts, carrying warm water poleward and cold water towards the equator → prevailing-wind
 * rainfall with rain shadows → priority-flood drainage and river discharge → lakes and salt flats
 * → Whittaker-style biomes → geology-driven resource deposits.
 */
export function generateMap(cfg: WorldConfig, rng: Rng): MapData {
  const w = cfg.width;
  const h = cfg.height;
  const size = w * h;
  const nElev = new Noise2D(rng.fork('elev'));
  const nRidge = new Noise2D(rng.fork('ridge'));
  const nTemp = new Noise2D(rng.fork('temp'));
  const nMoist = new Noise2D(rng.fork('moist'));
  const nRes = Array.from({ length: RES_COUNT }, (_, i) => new Noise2D(rng.fork('res' + i)));

  // --- Elevation ---------------------------------------------------------
  const elevation = (cfg.heightmap && decodeHeights(cfg.heightmap, w, h)) || generateElevation(cfg, rng, nElev, nRidge);
  const heights = Float32Array.from(elevation);
  const wasLand = new Uint8Array(size);
  for (let i = 0; i < size; i++) wasLand[i] = elevation[i] >= 0 ? 1 : 0;

  // --- Latitude & temperature -------------------------------------------
  const latitude = latitudes(cfg, h);
  const tilt = cfg.axialTilt ?? 23.5;
  /** Distance from the equator as a share of the way to the pole (0..1). */
  const latFrac = (y: number) => Math.min(1, Math.abs(latitude[y]) / 90);
  const seaTemp = (y: number) => baseTemp(latFrac(y), tilt, cfg.temperature);
  const temperature = new Float32Array(size);
  for (let y = 0; y < h; y++) {
    const base = seaTemp(y);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      temperature[i] = clamp(base - Math.max(0, elevation[i]) * 0.55 + nTemp.fbm(x * 0.04, y * 0.04, 3) * 0.1, 0, 1);
    }
  }

  // --- Ocean currents ----------------------------------------------------
  const currents = cfg.oceanCurrents === false
    ? { u: new Float32Array(size), v: new Float32Array(size), anomaly: new Float32Array(size) }
    : traceCurrents(w, h, elevation, latitude, seaTemp);
  const seaAnomaly = currents.anomaly;
  // How warm or cold the sea upwind of each land tile is, fading over a few tiles inland.
  const coastAnomaly = new Float32Array(size);
  if (cfg.oceanCurrents !== false) {
    for (let y = 0; y < h; y++) {
      const dir = windDir(latitude[y]);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (elevation[i] < 0) {
          temperature[i] = clamp(temperature[i] + seaAnomaly[i] * 0.6, 0, 1);
          continue;
        }
        for (let d = 1; d <= 6; d++) {
          const ux = x - dir * d;
          if (ux < 0 || ux >= w) break;
          const j = y * w + ux;
          if (elevation[j] < 0) {
            coastAnomaly[i] = seaAnomaly[j] * (1 - d / 7);
            break;
          }
        }
        temperature[i] = clamp(temperature[i] + coastAnomaly[i] * 0.5, 0, 1);
      }
    }
  }

  // --- Rainfall: prevailing winds carry ocean moisture inland, mountains wring it out ---
  const rain = new Float32Array(size);
  for (let y = 0; y < h; y++) {
    const dir = windDir(latitude[y]); // trade winds & polar easterlies vs westerlies
    let carrier = 0.5;
    for (let pass = 0; pass < 2; pass++) {
      for (let step = 0; step < w; step++) {
        const x = dir > 0 ? step : w - 1 - step;
        const i = y * w + x;
        if (elevation[i] < 0) {
          carrier += (1 - carrier) * 0.2 * (0.35 + 0.65 * temperature[i]);
          if (pass === 1) rain[i] = carrier * 0.5;
        } else {
          const px = x - dir;
          const prev = px >= 0 && px < w ? Math.max(0, elevation[y * w + px]) : 0;
          const uplift = Math.max(0, elevation[i] - prev) * 5;
          const r = Math.min(carrier * 0.6, carrier * (0.045 + uplift));
          if (pass === 1) rain[i] = r + carrier * 0.12;
          carrier = Math.min(1, carrier - r * 0.7 + 0.008);
        }
      }
    }
  }
  blur(rain, w, h, 2);
  const landRain: number[] = [];
  for (let i = 0; i < size; i++) if (elevation[i] >= 0) landRain.push(rain[i]);
  const rainNorm = quantile(landRain, 0.85) || 1;
  const moisture = new Float32Array(size);
  for (let y = 0; y < h; y++) {
    const deg = Math.abs(latitude[y]);
    // Dry belts under the subtropical highs, wet ones at the equator and along the polar front.
    const hadley = 0.22 * Math.exp(-(((deg - 28) / 8) ** 2));
    const itcz = 0.18 * Math.exp(-((deg / 11) ** 2));
    const polarFront = 0.05 * Math.exp(-(((deg - 60) / 8) ** 2));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Warm water offshore brings rain; cold upwelling water leaves the coast dry.
      moisture[i] = clamp(Math.sqrt(rain[i] / rainNorm) * 0.72 + nMoist.fbm(x * 0.05, y * 0.05, 4) * 0.25 + 0.08 - hadley + itcz + polarFront + coastAnomaly[i] * 0.6 + cfg.moisture, 0, 1);
    }
  }

  // --- Drainage: priority flood fills depressions and gives every land tile a downstream ---
  const filled = Float32Array.from(elevation);
  const downstream = new Int32Array(size).fill(-1);
  const visited = new Uint8Array(size);
  const heap = new MinHeap(size);
  for (let i = 0; i < size; i++) {
    if (elevation[i] < 0) {
      visited[i] = 1;
      const x = i % w;
      const y = (i / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && elevation[ny * w + nx] >= 0) {
          heap.push(i, elevation[i]);
          break;
        }
      }
    }
  }
  while (heap.size > 0) {
    const i = heap.pop();
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (visited[j]) continue;
      visited[j] = 1;
      filled[j] = Math.max(elevation[j], filled[i] + 1e-5);
      downstream[j] = i;
      heap.push(j, filled[j]);
    }
  }
  // Land tiles enclosed by the map edge without reaching water keep downstream -1 (rare).
  const order: number[] = [];
  for (let i = 0; i < size; i++) if (elevation[i] >= 0) order.push(i);
  order.sort((a, b) => filled[b] - filled[a]);
  const flow = new Float32Array(size);
  for (const i of order) flow[i] += 0.05 + moisture[i];
  for (const i of order) {
    const d = downstream[i];
    if (d >= 0 && elevation[d] >= 0) flow[d] += flow[i];
  }
  const landFlows = order.map((i) => flow[i]);
  const riverThreshold = Math.max(8, quantile(landFlows, 0.92));
  const river = new Float32Array(size);
  for (const i of order) if (flow[i] >= riverThreshold) river[i] = flow[i];

  // Lakes in wet depressions, salt flats in dry ones.
  const saltFlat = new Uint8Array(size);
  for (const i of order) {
    const depth = filled[i] - elevation[i];
    if (depth > 0.012) {
      if (moisture[i] > 0.38) {
        elevation[i] = -0.02;
        river[i] = 0;
      } else if (moisture[i] < 0.25) saltFlat[i] = 1;
    }
  }

  // --- Relief & biomes ---------------------------------------------------
  const landElev: number[] = [];
  for (let i = 0; i < size; i++) if (elevation[i] >= 0) landElev.push(elevation[i]);
  const hillsT = quantile(landElev, 0.7);
  const mountT = quantile(landElev, 0.91);
  const relief = new Uint8Array(size);
  const biome = new Uint8Array(size);
  const lakeMask = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (elevation[i] < 0 && elevation[i] > -0.03 && wasLand[i]) lakeMask[i] = 1;
  }
  for (let i = 0; i < size; i++) {
    const e = elevation[i];
    const t = temperature[i];
    const m = moisture[i];
    if (e < 0) {
      relief[i] = Relief.Water;
      biome[i] = lakeMask[i] ? Biome.Lake : e < -0.25 ? Biome.DeepOcean : Biome.Ocean;
      continue;
    }
    relief[i] = e >= mountT ? Relief.Mountains : e >= hillsT ? Relief.Hills : Relief.Flat;
    biome[i] = classifyBiome(t, m, e, relief[i]);
  }
  // Shallow coastal sea should hug the shore; deep ocean elsewhere.
  for (let i = 0; i < size; i++) {
    if (biome[i] !== Biome.Ocean && biome[i] !== Biome.DeepOcean) continue;
    let nearLand = false;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -2; dy <= 2 && !nearLand; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && elevation[ny * w + nx] >= 0) {
          nearLand = true;
          break;
        }
      }
    }
    biome[i] = nearLand ? Biome.Ocean : Biome.DeepOcean;
  }

  // --- Landmasses & coasts ----------------------------------------------
  const landmass = new Int32Array(size).fill(-1);
  const coastal = new Uint8Array(size);
  let lm = 0;
  const stack: number[] = [];
  for (let s = 0; s < size; s++) {
    if (elevation[s] < 0 || landmass[s] >= 0) continue;
    landmass[s] = lm;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (elevation[j] < 0) coastal[i] = 1;
        else if (landmass[j] < 0) {
          landmass[j] = lm;
          stack.push(j);
        }
      }
    }
    lm++;
  }

  // --- Resources ---------------------------------------------------------
  const resources = Array.from({ length: RES_COUNT }, () => new Float32Array(size));
  const ab = cfg.resourceAbundance;
  const deposit = (r: Res, x: number, y: number, freq: number, thr: number) => {
    const n = nRes[r].noise(x * freq + r * 13.7, y * freq - r * 7.3);
    return n > thr ? (n - thr) / (1 - thr) : 0;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = biome[i];
      const def = BIOMES[b];
      const rel = relief[i];
      const n = (r: Res) => 0.5 + 0.5 * nRes[r].noise(x * 0.09, y * 0.09);
      if (def.water) {
        const cold = temperature[i] < 0.4 ? 0.2 : 0;
        resources[Res.Fish][i] = b === Biome.Lake ? 0.75 : b === Biome.Ocean ? (0.45 + 0.35 * n(Res.Fish) + cold) : 0.12;
        if (b === Biome.Ocean && temperature[i] > 0.55 && moisture[i] < 0.4) resources[Res.Salt][i] = 0.3 * ab;
        continue;
      }
      const riverStrength = river[i] > 0 ? Math.min(1, river[i] / (riverThreshold * 3)) : 0;
      const reliefFert = rel === Relief.Mountains ? 0.1 : rel === Relief.Hills ? 0.65 : 1;
      resources[Res.Fertility][i] = clamp(def.fertility * (0.45 + 0.75 * moisture[i]) * reliefFert + 0.55 * riverStrength * (temperature[i] > 0.2 ? 1 : 0.3), 0, 1.5);
      resources[Res.Timber][i] = def.timber * (0.7 + 0.3 * n(Res.Timber));
      resources[Res.Game][i] = def.game * (0.65 + 0.35 * n(Res.Game));
      if (riverStrength > 0) resources[Res.Fish][i] = 0.1 + 0.3 * riverStrength;
      resources[Res.Stone][i] = rel === Relief.Mountains ? 1 : rel === Relief.Hills ? 0.6 : 0.06 + 0.1 * n(Res.Stone);
      const geo = rel === Relief.Mountains ? 1 : rel === Relief.Hills ? 0.75 : 0.12;
      resources[Res.Copper][i] = deposit(Res.Copper, x, y, 0.13, 0.42) * geo * ab;
      resources[Res.Tin][i] = deposit(Res.Tin, x, y, 0.11, 0.6) * geo * ab;
      const ironGeo = rel === Relief.Flat ? (b === Biome.Wetland ? 0.6 : 0.3) : 0.9;
      resources[Res.Iron][i] = deposit(Res.Iron, x, y, 0.12, 0.4) * ironGeo * ab;
      const coalGeo = rel === Relief.Hills ? 1 : rel === Relief.Flat ? 0.45 : 0.35;
      resources[Res.Coal][i] = deposit(Res.Coal, x, y, 0.1, 0.5) * coalGeo * ab;
      const goldGeo = rel === Relief.Mountains ? 1 : rel === Relief.Hills ? 0.55 : riverStrength * 0.5;
      resources[Res.Gold][i] = deposit(Res.Gold, x, y, 0.15, 0.58) * goldGeo * ab;
      const gemGeo = rel === Relief.Mountains ? 1 : rel === Relief.Hills ? 0.35 : 0.03;
      resources[Res.Gems][i] = deposit(Res.Gems, x, y, 0.15, 0.62) * gemGeo * ab;
      let salt = saltFlat[i] ? 1 : 0;
      if (b === Biome.Desert) salt = Math.max(salt, deposit(Res.Salt, x, y, 0.1, 0.3) * 0.8);
      else if (coastal[i] && temperature[i] > 0.5) salt = Math.max(salt, 0.25);
      else salt = Math.max(salt, deposit(Res.Salt, x, y, 0.08, 0.7) * 0.5 * geo);
      resources[Res.Salt][i] = salt * ab;
      const horseLand = b === Biome.Steppe ? 1 : b === Biome.Grassland ? 0.7 : b === Biome.Savanna ? 0.45 : 0;
      resources[Res.Horses][i] = horseLand * clamp(nRes[Res.Horses].noise(x * 0.04, y * 0.04) + 0.3, 0, 1);
      if (cfg.magic > 0) {
        const ley = nRes[Res.Arcana].ridged(x * 0.035, y * 0.035, 3);
        resources[Res.Arcana][i] = ley > 0.8 ? ((ley - 0.8) / 0.2) * cfg.magic * (rel === Relief.Mountains ? 1.3 : 1) : 0;
      }
    }
  }

  const moveCost = new Float32Array(size);
  for (let i = 0; i < size; i++) moveCost[i] = BIOMES[biome[i]].moveCost + (relief[i] === Relief.Hills ? 0.8 : 0);

  return {
    width: w,
    height: h,
    size,
    elevation,
    temperature,
    moisture,
    heights,
    latitude,
    currentU: currents.u,
    currentV: currents.v,
    seaAnomaly,
    biome,
    relief,
    river,
    landmass,
    coastal,
    resources,
    moveCost,
    owner: new Int32Array(size).fill(-1),
    landUse: new Uint8Array(size),
    pressure: new Float32Array(size),
    region: new Int32Array(size).fill(-1),
    claim: new Int32Array(size).fill(-1),
    occupier: new Int32Array(size).fill(-1),
    settlementAt: new Int32Array(size).fill(-1),
    road: new Float32Array(size),
    traffic: new Float32Array(size),
    riverThreshold,
  };
}

function classifyBiome(t: number, m: number, e: number, relief: number): Biome {
  if (t < 0.1) return Biome.Ice;
  if (relief === Relief.Mountains) return Biome.Mountain;
  if (t < 0.26) return Biome.Tundra;
  if (t < 0.44) return m < 0.3 ? Biome.Steppe : Biome.Taiga;
  if (t < 0.7) {
    if (m < 0.17) return Biome.Desert;
    if (m < 0.3) return Biome.Steppe;
    if (m < 0.48) return Biome.Grassland;
    if (m > 0.82 && e < 0.12) return Biome.Wetland;
    return Biome.TemperateForest;
  }
  if (m < 0.22) return Biome.Desert;
  if (m < 0.45) return Biome.Savanna;
  if (m > 0.78 && e < 0.12) return Biome.Wetland;
  return Biome.TropicalForest;
}

function blur(a: Float32Array, w: number, h: number, passes: number): void {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            s += a[ny * w + nx];
            n++;
          }
        }
        tmp[y * w + x] = s / n;
      }
    }
    a.set(tmp);
  }
}

/** Continents of noise with ridged mountain chains, sunk at the map's edges; sea level set so the configured share is land. */
function generateElevation(cfg: WorldConfig, rng: Rng, nElev: Noise2D, nRidge: Noise2D): Float32Array {
  const w = cfg.width;
  const h = cfg.height;
  const size = w * h;
  const aspect = w / h;
  const continents = Array.from({ length: rng.int(3, 6) }, () => ({
    x: rng.range(0.15, 0.85),
    y: rng.range(0.22, 0.78),
    r: rng.range(0.16, 0.34),
  }));
  const raw = new Float32Array(size);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      let c = -1;
      for (const ce of continents) {
        const dx = (nx - ce.x) * aspect;
        const dy = ny - ce.y;
        c = Math.max(c, 1 - Math.sqrt(dx * dx + dy * dy) / ce.r);
      }
      c = clamp(c, -1, 1);
      let e = 0.55 * c + 0.55 * nElev.fbm(nx * 3 * aspect, ny * 3, 6);
      const ridge = nRidge.ridged(nx * 4 * aspect + 50, ny * 4 + 50, 4);
      e += 0.55 * Math.max(0, ridge - 0.55) * clamp(c + 0.6, 0, 1);
      const bx = Math.min(x, w - 1 - x) / (w * 0.07);
      const by = Math.min(y, h - 1 - y) / (h * 0.07);
      e -= (1 - Math.min(1, bx, by)) * 0.9;
      raw[y * w + x] = e;
    }
  }
  const seaLevel = quantile(raw, 1 - cfg.landFraction);
  let maxE = -Infinity;
  let minE = Infinity;
  for (let i = 0; i < size; i++) {
    maxE = Math.max(maxE, raw[i]);
    minE = Math.min(minE, raw[i]);
  }
  const elevation = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    elevation[i] = raw[i] >= seaLevel ? (raw[i] - seaLevel) / (maxE - seaLevel + 1e-6) : (raw[i] - seaLevel) / (seaLevel - minE + 1e-6);
    if (raw[i] >= seaLevel && elevation[i] === 0) elevation[i] = 1e-4;
  }
  return elevation;
}

/** Latitude of each row in degrees, running evenly from the top edge to the bottom. */
export function latitudes(cfg: WorldConfig, h: number): Float32Array {
  const north = clamp(cfg.latNorth ?? 90, -90, 90);
  const south = clamp(cfg.latSouth ?? -90, -90, 90);
  const lat = new Float32Array(h);
  for (let y = 0; y < h; y++) lat[y] = north + (south - north) * ((y + 0.5) / h);
  return lat;
}

/**
 * Mean sea-level temperature (0 frozen .. 1 sweltering) at a distance from the equator given as a share
 * of the way to the pole. A steeper axial tilt spreads the sun's warmth: milder poles, a slightly cooler equator.
 */
export function baseTemp(latFrac: number, tilt: number, offset: number): number {
  return clamp(1.04 - latFrac + ((tilt - 23.5) / 90) * 0.35 * (latFrac - 0.4) + offset, 0, 1);
}

/** Direction of the prevailing wind at a latitude: -1 westward (trade winds, polar easterlies), +1 eastward (westerlies). */
export function windDir(latDeg: number): number {
  const a = Math.abs(latDeg);
  return a < 30 || a > 60 ? -1 : 1;
}

/**
 * Wind-driven surface currents, traced as drifting parcels of water. Each parcel runs with the
 * prevailing wind until a coast stops it, then turns along the shore: poleward in the tropics
 * (the warm western boundary currents), towards the equator under the westerlies (the cold
 * eastern boundary currents), poleward again near the subpolar lows, and towards the equator
 * under the polar easterlies. A parcel keeps the temperature of the latitude it came from,
 * losing it slowly, so currents running poleward are warmer than the sea around them and
 * those running towards the equator colder.
 */
function traceCurrents(w: number, h: number, elevation: Float32Array, latitude: Float32Array, seaTemp: (y: number) => number) {
  const size = w * h;
  const su = new Float32Array(size);
  const sv = new Float32Array(size);
  const sa = new Float32Array(size);
  const count = new Float32Array(size);
  // The ocean wraps east to west as on a globe; the top and bottom edges are shores.
  const wrap = (x: number) => (x < 0 ? x + w : x >= w ? x - w : x);
  const sea = (x: number, y: number) => y >= 0 && y < h && elevation[y * w + wrap(x)] < 0;
  const degPerRow = Math.abs(latitude[h - 1] - latitude[0]) / Math.max(1, h - 1) || 1;
  // Water forgets where it came from over about 25 degrees of travel.
  const relax = 1 - Math.exp(-degPerRow / 25);
  // Having run along a coast, a current carries on the same way for about 10 degrees before the wind turns it.
  const momentum = Math.ceil(10 / degPerRow);
  // Which way down the map is poleward at each row.
  const southward = latitude[h - 1] < latitude[0] ? 1 : -1;
  const poleward = (y: number) => (latitude[y] >= 0 ? -southward : southward);
  const alongCoast = (y: number) => {
    const a = Math.abs(latitude[y]);
    const toPole = a < 30 || (a >= 48 && a < 60);
    return toPole ? poleward(y) : -poleward(y);
  };
  const local = new Float32Array(h);
  for (let y = 0; y < h; y++) local[y] = seaTemp(y);
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return seed / 4294967296;
  };
  for (let sy = 1; sy < h; sy += 3) {
    for (let sx = 1; sx < w; sx += 3) {
      if (!sea(sx, sy)) continue;
      let x = sx;
      let y = sy;
      let t = local[y];
      let vdir = 0;
      let carry = 0;
      for (let step = 0; step < 400; step++) {
        const i = y * w + x;
        t += (local[y] - t) * relax;
        sa[i] += t - local[y];
        count[i]++;
        const dir = windDir(latitude[y]);
        if (vdir !== 0 && carry > 0 && sea(x + dir, y) && sea(x, y + vdir)) {
          carry--;
          y += vdir;
          sv[i] += vdir;
          continue;
        }
        if (sea(x + dir, y)) {
          x = wrap(x + dir);
          su[i] += dir;
          vdir = 0;
          if ((step & 3) === 3) {
            const r = rnd();
            const dy = r < 0.25 ? -1 : r > 0.75 ? 1 : 0;
            if (dy && sea(x, y + dy)) {
              y += dy;
              sv[i] += dy;
            }
          }
          continue;
        }
        if (vdir === 0) vdir = alongCoast(y);
        carry = momentum;
        if (!sea(x, y + vdir)) vdir = -vdir;
        if (!sea(x, y + vdir)) break;
        y += vdir;
        sv[i] += vdir;
      }
    }
  }
  for (let i = 0; i < size; i++) {
    if (count[i] > 0) {
      su[i] /= count[i];
      sv[i] /= count[i];
      sa[i] = clamp(sa[i] / count[i], -0.25, 0.25);
    }
  }
  const seaMask = new Uint8Array(size);
  for (let i = 0; i < size; i++) seaMask[i] = elevation[i] < 0 ? 1 : 0;
  for (const a of [su, sv, sa]) maskedBlur(a, seaMask, w, h, 2);
  return { u: su, v: sv, anomaly: sa };
}

/** Box blur over the tiles the mask marks, leaving the rest at zero. */
function maskedBlur(a: Float32Array, mask: Uint8Array, w: number, h: number, passes: number): void {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) {
          tmp[i] = 0;
          continue;
        }
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w || !mask[ny * w + nx]) continue;
            s += a[ny * w + nx];
            n++;
          }
        }
        tmp[i] = s / n;
      }
    }
    a.set(tmp);
  }
}

const HEIGHT_SCALE = 30000;

/** Pack a height field (sea below 0, land 0..1) into a compact text code that can be saved with a world's settings. */
export function encodeHeights(elevation: Float32Array, w: number, h: number): string {
  const q = new Int16Array(w * h);
  for (let i = 0; i < q.length; i++) q[i] = Math.round(clamp(elevation[i], -1, 1) * HEIGHT_SCALE);
  const bytes = new Uint8Array(q.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `${w}x${h}:${btoa(bin)}`;
}

/** Unpack a height code, resampling it smoothly when the map is a different size. Returns null for a code that won't read. */
export function decodeHeights(code: string, w: number, h: number): Float32Array | null {
  const m = /^(\d+)x(\d+):(.*)$/s.exec(code);
  if (!m) return null;
  const sw = +m[1];
  const sh = +m[2];
  let bin: string;
  try {
    bin = atob(m[3]);
  } catch {
    return null;
  }
  if (bin.length !== sw * sh * 2) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer);
  const src = new Float32Array(sw * sh);
  for (let i = 0; i < src.length; i++) src[i] = q[i] / HEIGHT_SCALE;
  if (sw === w && sh === h) return src;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = clamp(((y + 0.5) * sh) / h - 0.5, 0, sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp(((x + 0.5) * sw) / w - 0.5, 0, sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bot = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}
