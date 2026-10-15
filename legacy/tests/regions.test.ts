import { describe, expect, it } from 'vitest';
import { paintRegions, pixelLabels, warpLabels } from '../src/ui/regions';

/** ImageData stand-in for Node. */
const image = (W: number, H: number) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' }) as unknown as ImageData;

describe('borders from pixel regions', () => {
  const w = 30;
  const h = 20;
  // A diagonal border: the worst case for a staircase.
  const labels = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = x > y ? 1 : 2;

  it('turns the tile staircase into a smooth line, one region per pixel', () => {
    const W = 300;
    const H = 200;
    const px = pixelLabels(labels, w, h, 1, 0, 0, w / W, W, H);
    // Where region 1 begins in each row: it should move steadily, never jump back and forth in tile-sized steps.
    let prev = -1;
    let biggest = 0;
    for (let y = 20; y < 180; y++) {
      let x = 0;
      while (x < W && px[y * W + x] !== 1) x++;
      if (prev >= 0) biggest = Math.max(biggest, Math.abs(x - prev));
      prev = x;
    }
    // A staircase would jump a whole tile (10 pixels) at a time.
    expect(biggest).toBeLessThan(5);
  });

  it('lets borders wander off the grid but keeps every region where it was', () => {
    const fine = warpLabels(labels, w, h, 3);
    expect(fine[(10 * 3) * w * 3 + 25 * 3]).toBe(1);
    expect(fine[(15 * 3) * w * 3 + 2 * 3]).toBe(2);
  });

  it('draws solid borders between holders and a dotted line round occupied land', () => {
    const W = 60;
    const H = 40;
    const held = new Int32Array(W * H);
    const control = new Int32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        held[y * W + x] = x < 30 ? 1 : 2;
        // Nation 1 has taken a patch of nation 2's land.
        control[y * W + x] = x >= 30 && x < 45 && y > 10 && y < 30 ? 1 : held[y * W + x];
      }
    }
    const img = image(W, H);
    paintRegions(img, held, control, { fill: () => [100, 100, 100, 120], border: [0, 0, 0, 255], width: 2 });
    const px = (x: number, y: number) => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
    // The border between the two holders is solid black all the way down.
    for (let y = 0; y < H; y++) expect(px(29, y)).toEqual([0, 0, 0, 255]);
    // The edge of the occupied patch (inside nation 2) is dotted: some pixels white, some not.
    const edge = Array.from({ length: 15 }, (_, k) => px(32 + k, 10)[0]);
    expect(edge.some((v) => v === 250)).toBe(true);
    expect(edge.some((v) => v !== 250)).toBe(true);
  });
});
