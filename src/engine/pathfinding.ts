import { Biome } from './data/biomes';
import { MinHeap } from './heap';
import type { MapData } from './types';
import { DX, DY } from './worldgen';

const SQRT2 = Math.SQRT2;

/**
 * Cost of standing on / passing through a tile for a traveller with the given
 * sea-faring capability. Returns Infinity when impassable.
 */
export function tileCost(map: MapData, i: number, seaTravel: number): number {
  const b = map.biome[i];
  if (b === Biome.Lake) return 0.8; // lakes are always crossable by canoe
  if (b === Biome.Ocean) return seaTravel >= 1 ? 0.55 : Infinity;
  if (b === Biome.DeepOcean) return seaTravel >= 3 ? 0.35 : seaTravel >= 2 ? 0.6 : Infinity;
  let c = map.moveCost[i];
  if (map.river[i] > 0) c *= 0.65; // river boats
  return c / (1 + map.road[i]);
}

/** Reusable Dijkstra over the tile grid, bounded by a maximum travel cost. */
export class Pathfinder {
  private dist: Float64Array;
  private prev: Int32Array;
  private stamp: Uint32Array;
  private done: Uint32Array;
  private gen = 1;
  private heap = new MinHeap(4096);
  visited: number[] = [];

  constructor(private map: MapData) {
    this.dist = new Float64Array(map.size);
    this.prev = new Int32Array(map.size);
    this.stamp = new Uint32Array(map.size);
    this.done = new Uint32Array(map.size);
  }

  /** Run from `start`; calls `onVisit(tile, cost)` for every settled tile, stopping early if it returns true. */
  run(start: number, maxCost: number, seaTravel: number, onVisit?: (tile: number, cost: number) => boolean | void): void {
    const map = this.map;
    const w = map.width;
    const h = map.height;
    const gen = ++this.gen;
    const { dist, prev, stamp, done, heap } = this;
    this.visited = [];
    heap.clear();
    dist[start] = 0;
    prev[start] = -1;
    stamp[start] = gen;
    heap.push(start, 0);
    while (heap.size > 0) {
      const d0 = heap.peekKey();
      const i = heap.pop();
      if (done[i] === gen || d0 > dist[i]) continue;
      done[i] = gen;
      this.visited.push(i);
      if (onVisit?.(i, d0)) return;
      const x = i % w;
      const y = (i / w) | 0;
      const ci = tileCost(map, i, seaTravel);
      const iWater = map.elevation[i] < 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const cj = tileCost(map, j, seaTravel);
        if (cj === Infinity) continue;
        let step = ((ci === Infinity ? cj : ci) + cj) * 0.5 * (d >= 4 ? SQRT2 : 1);
        if (iWater !== map.elevation[j] < 0) step += 1.5; // embark / disembark
        const nd = d0 + step;
        if (nd > maxCost) continue;
        if (stamp[j] !== gen || nd < dist[j]) {
          stamp[j] = gen;
          dist[j] = nd;
          prev[j] = i;
          heap.push(j, nd);
        }
      }
    }
  }

  /** Path from the last run's start to `target` (inclusive), or [] if unreached. */
  pathTo(target: number): number[] {
    if (this.stamp[target] !== this.gen) return [];
    const path: number[] = [];
    let c = target;
    let guard = 0;
    while (c >= 0 && guard++ < 100000) {
      path.push(c);
      c = this.prev[c];
    }
    return path.reverse();
  }

  costTo(target: number): number {
    return this.stamp[target] === this.gen ? this.dist[target] : Infinity;
  }
}
