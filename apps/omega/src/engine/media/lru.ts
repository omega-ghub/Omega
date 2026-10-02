// A byte-budgeted LRU map. Map iteration order is insertion order, so the
// first key is always the least recently used one.

export class LruCache<K, V> {
  private map = new Map<K, { value: V; bytes: number }>();
  private used = 0;

  constructor(
    private budget: number,
    private onEvict?: (key: K, value: V) => void,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.used;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Returns the value and marks it most recently used. */
  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  /** Returns the value without touching recency. */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  set(key: K, value: V, bytes: number): void {
    const old = this.map.get(key);
    if (old) {
      this.used -= old.bytes;
      this.map.delete(key);
      if (old.value !== value) this.onEvict?.(key, old.value);
    }
    this.map.set(key, { value, bytes });
    this.used += bytes;
    this.trim();
  }

  delete(key: K): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.map.delete(key);
    this.used -= e.bytes;
    this.onEvict?.(key, e.value);
    return true;
  }

  /** Deletes every entry whose key matches. */
  deleteWhere(pred: (key: K) => boolean): number {
    let n = 0;
    for (const k of [...this.map.keys()]) if (pred(k) && this.delete(k)) n++;
    return n;
  }

  clear(): void {
    for (const k of [...this.map.keys()]) this.delete(k);
  }

  setBudget(bytes: number): void {
    this.budget = bytes;
    this.trim();
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  private trim() {
    // always keep the newest entry, even if it alone exceeds the budget
    while (this.used > this.budget && this.map.size > 1) {
      const first = this.map.keys().next().value as K;
      this.delete(first);
    }
  }
}
