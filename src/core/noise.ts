/**
 * Seeded noise in world kilometres. The same seed and place always give the same value, at
 * every zoom, so painted detail never shifts or flickers as the view changes.
 */

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A random number in [0, 1) for a whole-number position. */
export function random2(ix: number, iy: number, seed: number): number {
  return hash(ix, iy, seed) / 4294967296;
}

const GX = new Float64Array(16);
const GY = new Float64Array(16);
for (let k = 0; k < 16; k++) {
  GX[k] = Math.cos((k / 16) * Math.PI * 2);
  GY[k] = Math.sin((k / 16) * Math.PI * 2);
}

/** Smooth gradient noise, roughly in [-1, 1], with features about one unit apart. */
export function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const s = Math.imul(seed, 0x9e3779b1);
  const hx0 = Math.imul(x0, 0x27d4eb2d);
  const hx1 = Math.imul(x0 + 1, 0x27d4eb2d);
  const hy0 = Math.imul(y0, 0x165667b1) ^ s;
  const hy1 = Math.imul(y0 + 1, 0x165667b1) ^ s;
  const ga = mixHash(hx0 ^ hy0);
  const gb = mixHash(hx1 ^ hy0);
  const gc = mixHash(hx0 ^ hy1);
  const gd = mixHash(hx1 ^ hy1);
  const a = GX[ga] * fx + GY[ga] * fy;
  const b = GX[gb] * (fx - 1) + GY[gb] * fy;
  const c = GX[gc] * fx + GY[gc] * (fy - 1);
  const d = GX[gd] * (fx - 1) + GY[gd] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return 1.5 * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
}

function mixHash(h: number): number {
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 15;
}

/**
 * Fractal noise at a feature size of `scaleKm`, adding finer octaves down to `minKm` (about two
 * screen pixels), so detail appears as you zoom in. Roughly in [-1, 1].
 */
export function fbm(x: number, y: number, scaleKm: number, minKm: number, seed: number, maxOctaves = 9): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1 / scaleKm;
  for (let o = 0; o < maxOctaves; o++) {
    const size = 1 / f;
    // Fade the last octave in smoothly instead of popping.
    const fade = size >= minKm * 2 ? 1 : size <= minKm ? 0 : size / minKm - 1;
    if (fade <= 0 && o > 0) break;
    sum += noise2(x * f + o * 17.3, y * f - o * 9.1, seed + o * 101) * amp * (o === 0 ? 1 : fade);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Ridged fractal noise in [0, 1]: sharp crests and valleys, for mountains. */
export function ridged(x: number, y: number, scaleKm: number, minKm: number, seed: number, maxOctaves = 8, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1 / scaleKm;
  let weight = 1;
  for (let o = 0; o < maxOctaves; o++) {
    const size = 1 / f;
    const fade = size >= minKm * 2 ? 1 : size <= minKm ? 0 : size / minKm - 1;
    if (fade <= 0 && o > 0) break;
    let n = 1 - Math.abs(noise2(x * f + o * 31.7, y * f + o * 7.7, seed + 7 + o * 131));
    n *= n * weight;
    weight = Math.min(1, n * 1.6);
    sum += n * amp * (o === 0 ? 1 : fade);
    norm += amp;
    amp *= gain;
    f *= 2.07;
  }
  return sum / norm;
}

/** A seed for one stroke, from the world seed and the stroke's id. */
export function strokeSeed(worldSeed: number, id: number): number {
  return hash(id, 77, worldSeed) & 0x7fffffff;
}
