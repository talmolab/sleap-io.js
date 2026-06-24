/**
 * Prefetch for ImageVideoBackend — split into a pure window policy and the
 * capped/dedup'd read mechanism.
 */
import { describe, it, expect } from "../bun-test";
import {
  ImageVideoBackend,
  computePrefetchWindow,
} from "../../src/video/image-video.js";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const realJpg = new Uint8Array(
  fs.readFileSync(
    fileURLToPath(new URL("../data/videos/imgs/img.00.jpg", import.meta.url)),
  ),
);
const names = (n: number) => Array.from({ length: n }, (_, i) => `img${i}.jpg`);

describe("computePrefetchWindow (policy)", () => {
  it("biases ahead in the forward direction of travel", () => {
    // current 5, came from 4 -> moving forward
    expect(computePrefetchWindow(5, 4, 100, 3, 1)).toEqual([6, 7, 8, 4]);
  });

  it("biases ahead in the backward direction of travel", () => {
    expect(computePrefetchWindow(5, 6, 100, 3, 1)).toEqual([4, 3, 2, 6]);
  });

  it("defaults to forward when there is no prior index", () => {
    expect(computePrefetchWindow(0, null, 100, 2, 0)).toEqual([1, 2]);
  });

  it("clamps to [0, length) and excludes the current index", () => {
    expect(computePrefetchWindow(98, 97, 100, 3, 0)).toEqual([99]);
    expect(computePrefetchWindow(0, null, 100, 0, 2)).toEqual([]); // behind of 0 is <0
  });

  it("dedupes and never includes the current index", () => {
    const w = computePrefetchWindow(10, 9, 100, 5, 5);
    expect(w).not.toContain(10);
    expect(new Set(w).size).toBe(w.length);
  });
});

describe("ImageVideoBackend.prefetch (mechanism)", () => {
  // A reader that tracks concurrency (max simultaneous in-flight reads).
  function trackingReader() {
    let active = 0;
    let maxActive = 0;
    const reads: string[] = [];
    const reader = async (p: string): Promise<Uint8Array> => {
      reads.push(p);
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
      return realJpg;
    };
    return {
      reader,
      reads,
      get maxActive() {
        return maxActive;
      },
    };
  }

  async function make(
    t: { reader: (p: string) => Promise<Uint8Array> },
    opts = {},
  ) {
    return ImageVideoBackend.create({
      filename: names(50),
      shape: [50, 8, 8, 3],
      reader: t.reader,
      bytesCacheBytes: 50_000_000,
      prefetchConcurrency: 6,
      // Disable auto-prefetch by default so the mechanism tests are deterministic;
      // the auto-prefetch test below re-enables it explicitly.
      prefetchAhead: 0,
      prefetchBehind: 0,
      ...opts,
    });
  }

  it("reads the requested frames into the bytes tier", async () => {
    const t = trackingReader();
    const be = await make(t);
    await be.prefetch([2, 4, 6]);
    expect(
      t.reads.filter((p) => ["img2.jpg", "img4.jpg", "img6.jpg"].includes(p))
        .length,
    ).toBe(3);
    // Now getFrame(4) must NOT trigger another read (bytes already cached).
    const before = t.reads.length;
    await be.getFrame(4);
    expect(t.reads.filter((p) => p === "img4.jpg").length).toBe(1);
    expect(t.reads.length).toBe(before);
  });

  it("respects the concurrency cap", async () => {
    const t = trackingReader();
    const be = await make(t); // cap 6
    await be.prefetch(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(t.maxActive).toBe(6);
    expect(t.reads.length).toBe(20);
  });

  it("skips frames already in the bytes cache", async () => {
    const t = trackingReader();
    const be = await make(t);
    await be.getFrame(3); // caches bytes[3]
    const before = t.reads.length;
    await be.prefetch([3, 4]);
    expect(t.reads.filter((p) => p === "img3.jpg").length).toBe(1); // not re-read
    expect(t.reads.filter((p) => p === "img4.jpg").length).toBe(1);
    expect(t.reads.length).toBe(before + 1);
  });

  it("dedupes a concurrent getFrame and prefetch of the same frame", async () => {
    const t = trackingReader();
    const be = await make(t);
    await Promise.all([be.getFrame(7), be.prefetch([7])]);
    expect(t.reads.filter((p) => p === "img7.jpg").length).toBe(1);
  });

  it("auto-prefetches ahead when stepping forward", async () => {
    const t = trackingReader();
    const be = await make(t, { prefetchAhead: 4, prefetchBehind: 1 });
    await be.getFrame(9); // establish position
    await be.getFrame(10); // forward step -> should read-ahead 11,12,...
    await be.lastPrefetch; // await the in-flight auto-prefetch
    expect(t.reads).toContain("img11.jpg");
    expect(t.reads).toContain("img12.jpg");
  });
});
