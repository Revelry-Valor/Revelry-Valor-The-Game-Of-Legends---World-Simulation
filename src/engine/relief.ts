import type { Noise2D } from './noise';

const TAU = Math.PI * 2;

/** Two fixed pseudo-random numbers in [0, 1) for a lattice point. */
function hash2(ix: number, iy: number): [number, number] {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  const a = (h >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 15;
  return [a, (h >>> 0) / 4294967296];
}

/**
 * One layer of gullies: stripes laid out on a jittered lattice, each turned to run along the
 * direction (dx, dy) and blended smoothly between lattice points. Returns the value and its slope.
 */
function gullyLayer(px: number, py: number, dx: number, dy: number): [number, number, number] {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  let va = 0;
  let vb = 0;
  let vc = 0;
  let wt = 0;
  for (let j = -2; j <= 1; j++) {
    for (let i = -2; i <= 1; i++) {
      const [hx, hy] = hash2(ix - i, iy - j);
      const ppx = fx + i - hx * 0.5;
      const ppy = fy + j - hy * 0.5;
      const w = Math.exp(-(ppx * ppx + ppy * ppy) * 2);
      wt += w;
      const mag = (ppx * dx + ppy * dy) * TAU;
      const s = Math.sin(mag);
      va += Math.cos(mag) * w;
      vb -= s * dx * w;
      vc -= s * dy * w;
    }
  }
  return [va / wt, vb / wt, vc / wt];
}

/**
 * Gullies carved down every slope, the way rain cuts a mountainside, without simulating the rain.
 * (gx, gy) is the slope of the land underneath (in height per unit of x and y). Each layer of
 * stripes runs downhill along the slope it finds, which bends as the coarser gullies cut into
 * it, so finer channels branch off the larger ones like the veins of a leaf. Steeper ground gets
 * deeper, closer gullies; flat ground none. Returns the height offset (roughly -1..1) and its
 * slope in x and y.
 */
export function gullies(x: number, y: number, gx: number, gy: number, octaves: number, steepness = 1): [number, number, number] {
  let h = 0;
  let hx = 0;
  let hy = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    // Across the slope: the stripes then run straight downhill.
    let dx = (gy + hy * 0.5) * steepness;
    let dy = -(gx + hx * 0.5) * steepness;
    const m = Math.hypot(dx, dy);
    if (m > 3) {
      dx *= 3 / m;
      dy *= 3 / m;
    }
    const [v, vx, vy] = gullyLayer(x * freq, y * freq, dx, dy);
    h += v * amp;
    hx += vx * amp * freq;
    hy += vy * amp * freq;
    amp *= 0.42;
    freq *= 2;
  }
  return [h, hx, hy];
}

/** Rolling hills: smooth fractal noise with the same slope damping, roughly -1..1. */
export function erodedHills(n: Noise2D, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  let gx = 0;
  let gy = 0;
  const e = 0.02;
  for (let o = 0; o < octaves; o++) {
    const u = x * freq + o * 7.3;
    const v = y * freq - o * 3.1;
    const c = n.noise(u, v);
    gx += ((n.noise(u + e, v) - c) / e) * freq * amp;
    gy += ((n.noise(u, v + e) - c) / e) * freq * amp;
    sum += (amp * c) / (1 + 0.3 * (gx * gx + gy * gy));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
