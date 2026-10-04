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
 * Stripes laid out on a jittered lattice, each turned to vary along the direction (dx, dy) (so the
 * stripes themselves run across it), blended smoothly between lattice points so they bend and break
 * naturally. Returns a value in -1..1: +1 on a stripe's crest, -1 in the trough between.
 */
export function stripes(px: number, py: number, dx: number, dy: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  let va = 0;
  let wt = 0;
  for (let j = -2; j <= 1; j++) {
    for (let i = -2; i <= 1; i++) {
      const [hx, hy] = hash2(ix - i, iy - j);
      const ppx = fx + i - hx * 0.5;
      const ppy = fy + j - hy * 0.5;
      const w = Math.exp(-(ppx * ppx + ppy * ppy) * 2);
      wt += w;
      va += Math.cos((ppx * dx + ppy * dy) * TAU) * w;
    }
  }
  return va / wt;
}
