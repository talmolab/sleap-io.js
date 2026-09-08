import { describe, it, expect } from "../bun-test";
import {
  type Mp4Sample,
  findKeyframeBefore,
  planDecodeRange,
  computeCacheWindow,
  selectFeedSamples,
  planReadRegions,
  readSamplesByDecodeOrder,
  nextUncached,
  shouldDecodeAhead,
} from "../../src/video/mp4-decode-core";

/**
 * Build a run of presentation-ordered samples. `keyframes` lists the presentation
 * indices that are sync samples. By default decodeIndex === presentationIndex
 * (no B-frame reordering) and each sample is `size` bytes laid out contiguously.
 */
function makeSamples(
  count: number,
  keyframes: number[],
  opts?: { size?: number; decodeIndexOf?: (i: number) => number },
): Mp4Sample[] {
  const size = opts?.size ?? 10;
  const kf = new Set(keyframes);
  const samples: Mp4Sample[] = [];
  for (let i = 0; i < count; i += 1) {
    samples.push({
      offset: i * size,
      size,
      timestamp: i * 1000,
      duration: 1000,
      isKeyframe: kf.has(i),
      cts: i,
      decodeIndex: opts?.decodeIndexOf ? opts.decodeIndexOf(i) : i,
    });
  }
  return samples;
}

describe("findKeyframeBefore", () => {
  it("returns the keyframe at or before the index", () => {
    const kf = [0, 30, 60, 90];
    expect(findKeyframeBefore(kf, 0)).toBe(0);
    expect(findKeyframeBefore(kf, 29)).toBe(0);
    expect(findKeyframeBefore(kf, 30)).toBe(30);
    expect(findKeyframeBefore(kf, 75)).toBe(60);
    expect(findKeyframeBefore(kf, 1000)).toBe(90);
  });

  it("returns 0 when there are no keyframes", () => {
    expect(findKeyframeBefore([], 42)).toBe(0);
  });
});

describe("planDecodeRange", () => {
  const kf = [0, 30, 60];
  it("normal mode decodes keyframe→target+lookahead", () => {
    // target 45 → keyframe 30; end = min(45+20, 99) = 65
    expect(planDecodeRange(100, kf, 45, { lookahead: 20 })).toEqual({
      start: 30,
      end: 65,
    });
  });

  it("clamps end to the last sample", () => {
    // target 80, lookahead 60 → 140, clamped to 99
    expect(planDecodeRange(100, kf, 80, { lookahead: 60 })).toEqual({
      start: 60,
      end: 99,
    });
  });

  it("scrub mode decodes only keyframe→target (no lookahead)", () => {
    expect(
      planDecodeRange(100, kf, 80, { scrub: true, lookahead: 60 }),
    ).toEqual({ start: 60, end: 80 });
  });
});

describe("computeCacheWindow", () => {
  it("keeps target ± half the cache size, clamped to [start,end]", () => {
    // cacheSize 120 → half 60. target 200, start 180, end 300.
    expect(computeCacheWindow(180, 300, 200, 120)).toEqual({
      cacheStart: 180, // max(180, 200-60=140)
      cacheEnd: 260, // min(300, 200+60)
    });
  });

  it("does not extend past the decoded range", () => {
    expect(computeCacheWindow(0, 5, 2, 120)).toEqual({
      cacheStart: 0,
      cacheEnd: 5,
    });
  });
});

describe("selectFeedSamples", () => {
  it("returns the range in decode order when decode===presentation", () => {
    const samples = makeSamples(10, [0]);
    const feed = selectFeedSamples(samples, 2, 5);
    expect(feed.map((f) => f.presentationIndex)).toEqual([2, 3, 4, 5]);
    expect(feed.map((f) => f.sample.decodeIndex)).toEqual([2, 3, 4, 5]);
  });

  it("widens to cover B-frame reordering (decode span, sorted by decodeIndex)", () => {
    // Presentation [0..5]; decode order swaps a couple so presentation 3's
    // decodeIndex is 5 and presentation 5's decodeIndex is 3 (a B-frame island).
    const decodeIndexOf = (i: number) => (i === 3 ? 5 : i === 5 ? 3 : i);
    const samples = makeSamples(6, [0], { decodeIndexOf });
    // Ask for presentation [3,4]; decodeIndex span is [4,5] (from p3=5,p4=4) →
    // must also feed whatever decodes in [4,5]: p4(di4) and p3(di5).
    const feed = selectFeedSamples(samples, 3, 4);
    expect(feed.map((f) => f.sample.decodeIndex)).toEqual([4, 5]);
    // sorted by decodeIndex → presentation order [4,3]
    expect(feed.map((f) => f.presentationIndex)).toEqual([4, 3]);
  });
});

describe("planReadRegions", () => {
  it("merges contiguous samples into one region", () => {
    const samples = makeSamples(4, [0], { size: 10 }); // offsets 0,10,20,30
    const feed = selectFeedSamples(samples, 0, 3);
    const regions = planReadRegions(feed);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({
      offset: 0,
      length: 40,
      members: [
        { decodeIndex: 0, size: 10 },
        { decodeIndex: 1, size: 10 },
        { decodeIndex: 2, size: 10 },
        { decodeIndex: 3, size: 10 },
      ],
    });
  });

  it("splits at a non-contiguous byte gap", () => {
    const samples = makeSamples(4, [0], { size: 10 });
    samples[2].offset = 1000; // gap before sample 2
    samples[3].offset = 1010; // contiguous with sample 2
    const feed = selectFeedSamples(samples, 0, 3);
    const regions = planReadRegions(feed);
    expect(regions).toHaveLength(2);
    expect(regions[0].offset).toBe(0);
    expect(regions[0].length).toBe(20);
    expect(regions[1].offset).toBe(1000);
    expect(regions[1].length).toBe(20);
  });
});

describe("readSamplesByDecodeOrder", () => {
  it("reads each sample's bytes keyed by decodeIndex, coalescing reads", async () => {
    const samples = makeSamples(4, [0], { size: 4 }); // 16 bytes, contiguous
    // Fake file: byte value === global offset (mod 256).
    const reads: Array<{ offset: number; length: number }> = [];
    const readRange = async (offset: number, length: number) => {
      reads.push({ offset, length });
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) out[i] = (offset + i) & 0xff;
      return out;
    };
    const feed = selectFeedSamples(samples, 0, 3);
    const map = await readSamplesByDecodeOrder(feed, readRange);
    // One coalesced read for all 16 contiguous bytes.
    expect(reads).toEqual([{ offset: 0, length: 16 }]);
    // Sample decodeIndex 2 occupies bytes [8..11].
    expect(Array.from(map.get(2)!)).toEqual([8, 9, 10, 11]);
    expect(map.size).toBe(4);
  });

  it("issues one read per non-contiguous region", async () => {
    const samples = makeSamples(3, [0], { size: 4 });
    samples[2].offset = 500;
    const reads: Array<{ offset: number; length: number }> = [];
    const readRange = async (offset: number, length: number) => {
      reads.push({ offset, length });
      return new Uint8Array(length);
    };
    const feed = selectFeedSamples(samples, 0, 2);
    await readSamplesByDecodeOrder(feed, readRange);
    expect(reads).toHaveLength(2);
  });
});

describe("nextUncached", () => {
  it("skips covered frames from the start", () => {
    const covered = new Set([5, 6, 7]);
    expect(nextUncached(5, 100, (i) => covered.has(i))).toBe(8);
    expect(nextUncached(10, 100, (i) => covered.has(i))).toBe(10);
  });

  it("stops at length", () => {
    expect(nextUncached(98, 100, () => true)).toBe(100);
  });
});

describe("shouldDecodeAhead", () => {
  it("runs when the probe frame ahead is not covered", () => {
    expect(shouldDecodeAhead(100, 1000, 30, () => false)).toBe(true);
  });
  it("skips when the runway is already covered", () => {
    expect(shouldDecodeAhead(100, 1000, 30, () => true)).toBe(false);
  });
  it("skips near the end", () => {
    expect(shouldDecodeAhead(980, 1000, 30, () => false)).toBe(false);
  });
  it("skips when empty", () => {
    expect(shouldDecodeAhead(0, 0, 30, () => false)).toBe(false);
  });
});
