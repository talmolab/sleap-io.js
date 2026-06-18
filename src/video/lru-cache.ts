// src/video/lru-cache.ts
//
// A least-recently-used cache bounded by a BYTE budget (not entry count),
// because the entries it holds vary in size — raw jpg bytes (~100 KB) in one
// tier, decoded frames (~5 MB) in another. Recency order is the `Map` insertion
// order: `get`/`set` move a key to the end (most-recently-used); eviction drops
// from the front (least-recently-used) until back under budget.

export class LruCache<K, V> {
  private map = new Map<K, { value: V; size: number }>();
  private bytes = 0;

  /**
   * @param maxBytes Soft byte budget. Eviction runs after each `set` until the
   *   total is within budget — except the entry just set is never evicted, so a
   *   single oversized entry is kept (you still need it to render).
   * @param sizeOf Byte size of a value. Must be deterministic for a given value.
   */
  constructor(
    private readonly maxBytes: number,
    private readonly sizeOf: (value: V) => number
  ) {}

  get size(): number {
    return this.map.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Move to most-recently-used (re-insert at the end of the Map).
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.size;
      this.map.delete(key);
    }
    const size = this.sizeOf(value);
    this.map.set(key, { value, size });
    this.bytes += size;
    this.evict();
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.bytes -= entry.size;
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  private evict(): void {
    // Drop least-recently-used (front of the Map) until within budget, but never
    // the most-recently-set entry — a single entry larger than the whole budget
    // is kept rather than looping forever.
    while (this.bytes > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as K;
      const entry = this.map.get(oldest);
      if (!entry) break;
      this.bytes -= entry.size;
      this.map.delete(oldest);
    }
  }
}
