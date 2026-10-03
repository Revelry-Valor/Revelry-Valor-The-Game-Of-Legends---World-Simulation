import { describe, expect, it } from 'vitest';
import { traceRegions } from '../src/ui/borders';
import type { Point } from '../src/engine/geometry';

const area = (loop: Point[]) => {
  let s = 0;
  for (let k = 0; k < loop.length - 1; k++) s += loop[k][0] * loop[k + 1][1] - loop[k + 1][0] * loop[k][1];
  return s / 2;
};

describe('smooth regions', () => {
  // Three realms meeting, one with an enclave of another inside it, and unclaimed land around.
  const w = 30;
  const h = 20;
  const labels = new Int32Array(w * h).fill(-1);
  for (let y = 2; y < 18; y++) for (let x = 2; x < 28; x++) labels[y * w + x] = x < 12 ? 0 : x < 20 ? 1 : 2;
  for (let y = 8; y < 11; y++) for (let x = 4; x < 7; x++) labels[y * w + x] = 2;
  for (let y = 12; y < 18; y++) for (let x = 12; x < 16; x++) labels[y * w + x] = 0;
  const count = (l: number) => labels.reduce((n, v) => n + (v === l ? 1 : 0), 0);
  const shapes = traceRegions(labels, w, h);

  it('outlines every region with closed loops enclosing about its area (holes subtracting)', () => {
    for (const l of [0, 1, 2]) {
      const loops = shapes.loops.get(l)!;
      expect(loops.length).toBeGreaterThan(0);
      for (const loop of loops) expect(loop[0][0]).toBeCloseTo(loop[loop.length - 1][0], 6);
      const total = loops.reduce((s, lp) => s + area(lp), 0);
      // Signed areas: outer edges one way, holes the other; rounding the corners shaves a little off.
      expect(Math.abs(Math.abs(total) - count(l))).toBeLessThan(count(l) * 0.12);
    }
  });

  it('draws each border once, shared by the two regions on either side', () => {
    const between = shapes.segments.filter((s) => (s.a === 0 && s.b === 1) || (s.a === 1 && s.b === 0));
    expect(between.length).toBeGreaterThan(0);
    // Region 2's enclave inside region 0 is a closed loop.
    const enclave = shapes.segments.filter((s) => (s.a === 0 && s.b === 2) || (s.a === 2 && s.b === 0));
    expect(enclave.some((s) => s.pts[0][0] === s.pts[s.pts.length - 1][0] && s.pts[0][1] === s.pts[s.pts.length - 1][1])).toBe(true);
  });

  it('rounds the staircase of tile edges into a curve', () => {
    const stair = new Int32Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x > y) stair[y * w + x] = 1;
    const seg = traceRegions(stair, w, h).segments.find((s) => s.a !== s.b)!;
    // No right-angle corners survive: consecutive turns stay gentle.
    let sharp = 0;
    for (let k = 1; k < seg.pts.length - 1; k++) {
      const [a, b, c] = [seg.pts[k - 1], seg.pts[k], seg.pts[k + 1]];
      const d1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const d2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let turn = Math.abs(d2 - d1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > Math.PI / 3) sharp++;
    }
    expect(sharp).toBe(0);
  });
});

describe('wandering borders', () => {
  it('keeps every region in place while letting its edge wander, so towns stay inside their own realm', async () => {
    const { warpLabels } = await import('../src/ui/borders');
    const w = 40;
    const h = 30;
    const labels = new Int32Array(w * h);
    for (let i = 0; i < labels.length; i++) labels[i] = (i % w) < 20 ? 1 : 2;
    const fine = warpLabels(labels, w, h, 3);
    // Deep inside each half nothing changes; near the line the edge wanders off the straight tile edge.
    expect(fine[15 * 3 * 120 + 5 * 3]).toBe(1);
    expect(fine[15 * 3 * 120 + 35 * 3]).toBe(2);
    const columns = new Set<number>();
    for (let y = 0; y < h * 3; y++) {
      let x = 0;
      while (x < w * 3 && fine[y * w * 3 + x] === 1) x++;
      columns.add(x);
    }
    expect(columns.size).toBeGreaterThan(2);
  });
});
