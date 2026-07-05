/**
 * Public frame-release API for lazy `Labels` (#207): `releaseFrame` /
 * `releaseFrameWindow` / `frameCacheLimit` let a windowed read→transform→write
 * sweep over a huge lazy file stay memory-bounded WITHOUT reaching into the
 * private `_lazyFrameList.cache` (the fragile workaround this replaces).
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSlp, readSlpLazy } from "../../src/codecs/slp/read.js";
import type { Labels } from "../../src/model/labels.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const FIX = path.join(fixtureRoot, "slp", "centered_pair_predictions.slp");

const matCount = (labels: Labels): number =>
  labels._lazyFrameList?.materializedCount ?? 0;

describe("lazy frame release", () => {
  it("releaseFrame / releaseFrameWindow drop cached frames", async () => {
    const labels = await readSlpLazy(FIX, { openVideos: false });
    expect(labels.isLazy).toBe(true);
    expect(matCount(labels)).toBe(0);

    labels.frameAt(0);
    labels.frameAt(1);
    labels.frameAt(2);
    expect(matCount(labels)).toBe(3);

    labels.releaseFrame(1);
    expect(matCount(labels)).toBe(2);

    labels.releaseFrameWindow(0, 3);
    expect(matCount(labels)).toBe(0);
  });

  it("frameCacheLimit bounds the cache across a sequential sweep", async () => {
    const labels = await readSlpLazy(FIX, { openVideos: false });
    labels.frameCacheLimit = 4;
    expect(labels.frameCacheLimit).toBe(4);

    for (let i = 0; i < 20; i++) labels.frameAt(i);

    // Never exceeds the cap, and the most-recent frames are retained.
    expect(matCount(labels)).toBeLessThanOrEqual(4);
    expect(matCount(labels)).toBeGreaterThan(0);
    expect(labels.frameAt(19)).toBeDefined();
  });

  it("is a no-op on an eager Labels", async () => {
    const eager = await readSlp(FIX, { openVideos: false });
    expect(eager.isLazy).toBe(false);
    expect(() => eager.releaseFrame(0)).not.toThrow();
    expect(() => eager.releaseFrameWindow(0, 5)).not.toThrow();
    expect(eager.frameCacheLimit).toBe(0);
    eager.frameCacheLimit = 5;
    expect(eager.frameCacheLimit).toBe(0);
  });
});
