import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { isRangeSource, type RangeSource } from "../../src/video/backend.js";

const WEBM_PATH = resolve(
  __dirname,
  "../data/videos/centered_pair_low_quality.webm",
);

/**
 * A {@link RangeSource} backed by an in-memory buffer, recording each read so a
 * test can assert the reader pulled ranges (never the whole file in one shot) —
 * the same lazy access pattern a native `read_range` gives on desktop.
 */
function bufferRangeSource(buf: Uint8Array): {
  source: RangeSource;
  calls: Array<{ offset: number; length: number }>;
} {
  const calls: Array<{ offset: number; length: number }> = [];
  return {
    calls,
    source: {
      size: buf.byteLength,
      readRange: async (offset: number, length: number) => {
        calls.push({ offset, length });
        return buf.subarray(offset, offset + length);
      },
    },
  };
}

describe("isRangeSource", () => {
  it("accepts a { size, readRange } object", () => {
    expect(
      isRangeSource({ size: 10, readRange: async () => new Uint8Array() }),
    ).toBe(true);
  });

  it("rejects a Blob (has size but no readRange)", () => {
    expect(isRangeSource(new Blob([new Uint8Array([1, 2, 3])]))).toBe(false);
  });

  it("rejects strings, null, and partial shapes", () => {
    expect(isRangeSource("path/to/video.mp4")).toBe(false);
    expect(isRangeSource(null)).toBe(false);
    expect(isRangeSource({ size: 10 })).toBe(false);
    expect(isRangeSource({ readRange: async () => new Uint8Array() })).toBe(
      false,
    );
  });
});

describe("MediaBunnyVideoBackend.fromRangeSource (real WebM via range reads)", () => {
  beforeEach(() => {
    (globalThis as any).createImageBitmap = async () => ({
      width: 388,
      height: 384,
      close: vi.fn(),
    });
  });

  afterEach(() => {
    delete (globalThis as any).createImageBitmap;
  });

  it("parses the same metadata as fromBlob, reading only ranges", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );

    const data = new Uint8Array(readFileSync(WEBM_PATH));
    const { source, calls } = bufferRangeSource(data);
    const backend = await MediaBunnyVideoBackend.fromRangeSource(
      source,
      "test.webm",
    );

    // Same metadata the fromBlob integration test asserts — proof the
    // StreamSource fed bytes correctly (incl. the end-EXCLUSIVE read convention:
    // a wrong length here would corrupt the demux and change the frame count).
    expect(backend.shape).toEqual([30, 384, 388, 3]);
    expect(backend.fps!).toBeCloseTo(15, 0);
    expect(backend.numFrames).toBe(30);
    expect(backend.filename).toBe("test.webm");

    // All bytes came through readRange (never a whole-file materialization by
    // the backend itself), and no read ran past EOF. (A small fixture may be
    // read in one range; big-file laziness — only the needed ranges — is
    // inherently E2E-verified, not provable with a tiny file.)
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.offset + c.length <= data.byteLength)).toBe(
      true,
    );

    backend.close();
  });

  it("returns the frame-time index from a range source", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const data = new Uint8Array(readFileSync(WEBM_PATH));
    const { source } = bufferRangeSource(data);
    const backend = await MediaBunnyVideoBackend.fromRangeSource(
      source,
      "test.webm",
    );

    const times = await backend.getFrameTimes();
    expect(times!.length).toBe(30);
    for (let i = 1; i < times!.length; i++) {
      expect(times![i]).toBeGreaterThan(times![i - 1]);
    }

    backend.close();
  });
});
