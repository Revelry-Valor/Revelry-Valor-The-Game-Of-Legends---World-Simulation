/** Binary min-heap of integer items keyed by float priorities. */
export class MinHeap {
  private items: Int32Array;
  private keys: Float64Array;
  size = 0;

  constructor(capacity = 1024) {
    this.items = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(item: number, key: number): void {
    if (this.size === this.items.length) {
      const ni = new Int32Array(this.size * 2);
      ni.set(this.items);
      this.items = ni;
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      this.keys = nk;
    }
    let i = this.size++;
    const items = this.items;
    const keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  peekKey(): number {
    return this.keys[0];
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    const n = --this.size;
    if (n > 0) {
      const item = items[n];
      const key = keys[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        items[i] = items[c];
        keys[i] = keys[c];
        i = c;
      }
      items[i] = item;
      keys[i] = key;
    }
    return top;
  }
}
