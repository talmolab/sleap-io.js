/**
 * LOAD PROGRESS — `onProgress` callback coverage for all three reader paths.
 *
 * PR #176 added an `onProgress?: (current, total, message?) => void` load
 * callback. Originally only the streaming reader emitted; the eager (`readSlp`)
 * and lazy (`readSlpLazy`) main-thread readers now emit too. Each path derives
 * `total` from an ordered stage-label list (the single source of truth), so the
 * number of distinct stage indices reported must equal `total`.
 *
 * These tests assert, for each path, the shared progress CONTRACT:
 *   - onProgress is called at least once,
 *   - `current` is monotonically non-decreasing from 0 to `total`,
 *   - the final call is exactly `(total, total)`,
 *   - the count of DISTINCT stage indices reported equals `total` (this pins the
 *     stage list ↔ count: a drift would change the distinct count),
 *   - every `message` is a non-empty string,
 *   - `total` is identical across every call within a single load.
 * Plus: progress is a pure side effect (Labels load identically with/without a
 * spy), and the openVideos path emits an "Opening videos (i/n)" sub-message.
 *
 * The streaming reader is Worker/browser-gated and unreachable from the all-Node
 * bun suite (the in-Worker `importScripts` global is absent, so
 * `readSlpStreaming` throws "importScripts is not defined") — see
 * tests/streaming-field-names.test.ts and tests/codecs/slp-crop-streaming.test.ts.
 * The streaming case therefore ATTEMPTS the real path and asserts the contract
 * only if the Worker runs (browser/CI); otherwise it is skipped.
 */
import { describe, it, expect } from "../bun-test";
import { loadSlp } from "../../src/io/main.js";
import { readSlpStreaming } from "../../src/codecs/slp/read-streaming.js";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const PLAIN = path.join(fixtureRoot, "slp", "minimal_instance.slp");
const EMBEDDED = path.join(fixtureRoot, "slp", "minimal_instance.pkg.slp");

/** A single recorded onProgress call. */
type Call = { current: number; total: number; message?: string };

/** A spy that records every onProgress call. */
function makeProgressSpy(): {
  onProgress: (current: number, total: number, message?: string) => void;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    onProgress: (current, total, message) =>
      calls.push({ current, total, message }),
  };
}

/**
 * Assert the shared progress contract over a recorded call list. `total` is the
 * derived stage count the reader reported; the assertions pin both the shape of
 * the progression and the stage-list ↔ count invariant.
 */
function assertProgressContract(calls: Call[]): void {
  expect(calls.length).toBeGreaterThan(0);

  // `total` identical across every call within the load.
  const total = calls[0].total;
  expect(total).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c.total).toBe(total);
  }

  // Starts at 0, ends at total, monotonically non-decreasing.
  expect(calls[0].current).toBe(0);
  const last = calls[calls.length - 1];
  expect(last.current).toBe(total);
  expect(last.total).toBe(total);
  for (let i = 1; i < calls.length; i++) {
    expect(calls[i].current).toBeGreaterThanOrEqual(calls[i - 1].current);
  }

  // Every message is a non-empty string.
  for (const c of calls) {
    expect(typeof c.message).toBe("string");
    expect((c.message ?? "").length).toBeGreaterThan(0);
  }

  // Distinct stage indices == total. The stages run at indices 0..total-1 plus a
  // final (total, total) "Finalizing" call, so the distinct set is exactly
  // {0, 1, ..., total}, of size total + 1. This pins the stage list ↔ count: if
  // a stage were added/removed without updating the derived total, this breaks.
  const distinct = new Set(calls.map((c) => c.current));
  expect(distinct.size).toBe(total + 1);
  for (let i = 0; i <= total; i++) {
    expect(distinct.has(i)).toBe(true);
  }
}

/** Lightweight structural fingerprint to assert progress is side-effect-free. */
function fingerprint(labels: {
  labeledFrames: { instances: unknown[] }[];
  videos: unknown[];
  skeletons: unknown[];
  tracks: unknown[];
}): {
  frames: number;
  instances: number;
  videos: number;
  skeletons: number;
  tracks: number;
} {
  return {
    frames: labels.labeledFrames.length,
    instances: labels.labeledFrames.reduce((n, f) => n + f.instances.length, 0),
    videos: labels.videos.length,
    skeletons: labels.skeletons.length,
    tracks: labels.tracks.length,
  };
}

describe("SLP load progress — onProgress callback", () => {
  describe("eager reader (readSlp via loadSlp)", () => {
    it("emits a well-formed, monotonic progress sequence", async () => {
      const spy = makeProgressSpy();
      await loadSlp(PLAIN, { openVideos: false, onProgress: spy.onProgress });
      assertProgressContract(spy.calls);
    });

    it("is a pure side effect: Labels match with and without a spy", async () => {
      const spy = makeProgressSpy();
      const withSpy = await loadSlp(PLAIN, {
        openVideos: false,
        onProgress: spy.onProgress,
      });
      const without = await loadSlp(PLAIN, { openVideos: false });
      expect(fingerprint(withSpy)).toEqual(fingerprint(without));
      expect(spy.calls.length).toBeGreaterThan(0);
    });
  });

  describe("lazy reader (readSlpLazy via loadSlp)", () => {
    it("emits a well-formed, monotonic progress sequence", async () => {
      const spy = makeProgressSpy();
      await loadSlp(PLAIN, {
        lazy: true,
        openVideos: false,
        onProgress: spy.onProgress,
      });
      assertProgressContract(spy.calls);
    });

    it("is a pure side effect: Labels match with and without a spy", async () => {
      const spy = makeProgressSpy();
      const withSpy = await loadSlp(PLAIN, {
        lazy: true,
        openVideos: false,
        onProgress: spy.onProgress,
      });
      const without = await loadSlp(PLAIN, { lazy: true, openVideos: false });
      // Materialize lazy frames before fingerprinting (length forces it).
      expect(fingerprint(withSpy)).toEqual(fingerprint(without));
      expect(spy.calls.length).toBeGreaterThan(0);
    });
  });

  describe("streaming reader (readSlpStreaming)", () => {
    it("emits the same contract when the Worker is available (else skipped)", async () => {
      const spy = makeProgressSpy();
      const buf = readFileSync(PLAIN);
      try {
        await readSlpStreaming(new Uint8Array(buf).buffer as ArrayBuffer, {
          openVideos: false,
          filenameHint: "minimal_instance.slp",
          onProgress: spy.onProgress,
        });
      } catch {
        // Worker path unreachable in this Node runtime (importScripts absent) —
        // documented in tests/streaming-field-names.test.ts. Skip the contract
        // assertion; the eager/lazy cases cover the shared invariants in Node.
        expect(spy.calls.length).toBe(0);
        return;
      }
      assertProgressContract(spy.calls);
    }, 120_000);
  });

  describe("openVideos sub-progress (embedded fixture)", () => {
    it("eager reader emits an 'Opening videos (i/n)' message", async () => {
      const spy = makeProgressSpy();
      await loadSlp(EMBEDDED, {
        openVideos: true,
        onProgress: spy.onProgress,
      });
      assertProgressContract(spy.calls);
      const hasOpening = spy.calls.some((c) =>
        /Opening videos \(\d+\/\d+\)/.test(c.message ?? ""),
      );
      expect(hasOpening).toBe(true);
    });

    it("lazy reader emits an 'Opening videos (i/n)' message", async () => {
      const spy = makeProgressSpy();
      await loadSlp(EMBEDDED, {
        lazy: true,
        openVideos: true,
        onProgress: spy.onProgress,
      });
      assertProgressContract(spy.calls);
      const hasOpening = spy.calls.some((c) =>
        /Opening videos \(\d+\/\d+\)/.test(c.message ?? ""),
      );
      expect(hasOpening).toBe(true);
    });
  });
});
