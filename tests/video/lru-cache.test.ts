/**
 * LruCache — a byte-budgeted least-recently-used cache. Backs the two-tier frame
 * cache in ImageVideoBackend (a large raw-bytes tier + a small decoded tier),
 * where entries vary in size so the budget is in bytes, not entry count.
 */
import { describe, it, expect } from "../bun-test";
import { LruCache } from "../../src/video/lru-cache.js";

// Value IS its own byte size, so budgets are easy to reason about in tests.
const sizeIsValue = (v: number) => v;

describe("LruCache", () => {
  it("stores and retrieves a value", () => {
    const c = new LruCache<string, number>(100, sizeIsValue);
    c.set("a", 10);
    expect(c.has("a")).toBe(true);
    expect(c.get("a")).toBe(10);
    expect(c.totalBytes).toBe(10);
    expect(c.size).toBe(1);
  });

  it("evicts the least-recently-used entry when over the byte budget", () => {
    const c = new LruCache<string, number>(100, sizeIsValue);
    c.set("a", 40);
    c.set("b", 40);
    c.set("c", 40); // 120 > 100 -> evict oldest (a)
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
    expect(c.totalBytes).toBe(80);
  });

  it("get() marks an entry most-recently-used, protecting it from eviction", () => {
    const c = new LruCache<string, number>(100, sizeIsValue);
    c.set("a", 40);
    c.set("b", 40);
    c.get("a"); // a is now MRU; b is LRU
    c.set("c", 40); // evict LRU -> b
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
  });

  it("updating an existing key replaces its size and recency", () => {
    const c = new LruCache<string, number>(100, sizeIsValue);
    c.set("a", 10);
    c.set("a", 50);
    expect(c.size).toBe(1);
    expect(c.totalBytes).toBe(50);
    expect(c.get("a")).toBe(50);
  });

  it("never evicts the entry just set, even if it alone exceeds the budget", () => {
    const c = new LruCache<string, number>(10, sizeIsValue);
    c.set("big", 100);
    expect(c.has("big")).toBe(true);
    expect(c.size).toBe(1);
  });

  it("delete() removes an entry and frees its bytes", () => {
    const c = new LruCache<string, number>(100, sizeIsValue);
    c.set("a", 30);
    expect(c.delete("a")).toBe(true);
    expect(c.has("a")).toBe(false);
    expect(c.totalBytes).toBe(0);
    expect(c.delete("a")).toBe(false);
  });

  it("clear() empties the cache", () => {
    const c = new LruCache<string, number>(100, sizeIsValue);
    c.set("a", 30);
    c.set("b", 30);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.totalBytes).toBe(0);
  });
});
