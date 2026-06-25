/**
 * Crop pushdown protocol tests (Item 1 of JS issue #153).
 *
 * The optional `VideoBackend.readCrop` hook lets a backend read only the crop
 * region directly from storage. These tests prove it is a CORRECT no-op:
 *  - When present and non-null, its result is returned as-is and is
 *    byte-identical to the full-decode + `cropFrame` fallback (in-bounds AND
 *    out-of-bounds / padded crops).
 *  - When it returns `null`, the wrapper falls back to a single full decode +
 *    `cropFrame`, yielding the identical cropped frame.
 *  - The shipping embedded HDF5 backends (sync + streaming) return `null`
 *    unconditionally (encoded blobs / per-frame rows can't be hyperslabbed),
 *    short-circuiting before touching any dataset.
 *
 * No real decode / h5 file: in-memory `RawFrame`s and trivial backend stubs.
 */
import { describe, it, expect } from "../bun-test";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import {
  cropFrame,
  type Fill,
  type RawFrame,
} from "../../src/transform/frame.js";
import type { CropRect } from "../../src/transform/points.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import { Hdf5VideoBackend } from "../../src/video/hdf5-video.js";
import { StreamingHdf5VideoBackend } from "../../src/video/streaming-hdf5-video.js";

/** A known raw single-channel frame with deterministic pixel values. */
function makeFullFrame(width = 6, height = 5): RawFrame {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 3) % 256;
  return { data, width, height, channels: 1 };
}

/**
 * An inner backend that returns the full raw frame from `getFrame` (counting
 * calls) and, optionally, the correctly cropped frame from `readCrop`.
 */
function makeInner(
  full: RawFrame,
  readCropImpl:
    | ((frameIndex: number, crop: CropRect, fill: Fill) => RawFrame | null)
    | null,
): VideoBackend & { getFrameCalls: number } {
  return {
    filename: "/data/raw.h5",
    shape: [1, full.height, full.width, full.channels ?? 1],
    dataset: null,
    getFrameCalls: 0,
    async getFrame(): Promise<VideoFrame | null> {
      this.getFrameCalls++;
      return full as unknown as VideoFrame;
    },
    ...(readCropImpl
      ? {
          async readCrop(
            frameIndex: number,
            crop: CropRect,
            fill: Fill,
          ): Promise<RawFrame | null> {
            return readCropImpl(frameIndex, crop, fill);
          },
        }
      : {}),
    close() {},
  };
}

function expectRawEqual(a: RawFrame, b: RawFrame): void {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  expect(a.channels ?? 1).toBe(b.channels ?? 1);
  expect(Array.from(a.data)).toEqual(Array.from(b.data));
}

describe("crop pushdown protocol (Item 1)", () => {
  it("getFrame uses readCrop and the result is byte-identical to full-decode+crop (in-bounds)", async () => {
    const full = makeFullFrame(6, 5);
    const crop: CropRect = [1, 1, 4, 4];
    const fill: Fill = 0;
    const expected = cropFrame(full, crop, fill);

    const inner = makeInner(full, (_f, c, fl) => cropFrame(full, c, fl));
    const cb = CropVideoBackend.wrap({ inner, crop, fill });
    const out = (await cb.getFrame(0)) as unknown as RawFrame;

    expectRawEqual(out, expected);
    // Pushdown short-circuits the full decode.
    expect(inner.getFrameCalls).toBe(0);
  });

  it("getFrame uses readCrop for an OOB crop and pads identically (pad parity)", async () => {
    const full = makeFullFrame(6, 5);
    // Crop extends past the right/bottom edges and starts off the top-left.
    const crop: CropRect = [-2, -1, 5, 6];
    const fill: Fill = 99;
    const expected = cropFrame(full, crop, fill);

    const inner = makeInner(full, (_f, c, fl) => cropFrame(full, c, fl));
    const cb = CropVideoBackend.wrap({ inner, crop, fill });
    const out = (await cb.getFrame(0)) as unknown as RawFrame;

    expectRawEqual(out, expected);
    expect(inner.getFrameCalls).toBe(0);
  });

  it("readCrop returning null falls back to a single full-decode+crop", async () => {
    const full = makeFullFrame(6, 5);
    const crop: CropRect = [1, 1, 4, 4];
    const fill: Fill = 0;
    const expected = cropFrame(full, crop, fill);

    const inner = makeInner(full, () => null);
    const cb = CropVideoBackend.wrap({ inner, crop, fill });
    const out = (await cb.getFrame(0)) as unknown as RawFrame;

    expectRawEqual(out, expected);
    // Fell back to exactly one full decode.
    expect(inner.getFrameCalls).toBe(1);
  });

  it("no readCrop at all still produces the identical cropped frame", async () => {
    const full = makeFullFrame(6, 5);
    const crop: CropRect = [0, 0, 3, 2];
    const fill: Fill = 5;
    const expected = cropFrame(full, crop, fill);

    const inner = makeInner(full, null);
    expect("readCrop" in inner).toBe(false);
    const cb = CropVideoBackend.wrap({ inner, crop, fill });
    const out = (await cb.getFrame(0)) as unknown as RawFrame;

    expectRawEqual(out, expected);
    expect(inner.getFrameCalls).toBe(1);
  });

  it("Hdf5VideoBackend.readCrop returns null (embedded blobs can't be hyperslabbed)", async () => {
    const backend = new Hdf5VideoBackend({
      filename: "/data/embedded.pkg.slp",
      // No dataset is touched: readCrop short-circuits to null.
      file: null,
      datasetPath: "video0/video",
      frameNumbers: [0],
      format: "png",
    });
    expect(await backend.readCrop(0, [0, 0, 1, 1], 0)).toBeNull();
  });

  it("StreamingHdf5VideoBackend.readCrop returns null (embedded blobs can't be hyperslabbed)", async () => {
    const backend = new StreamingHdf5VideoBackend({
      filename: "/data/embedded.pkg.slp",
      // No worker call is made: readCrop short-circuits to null.
      h5file: null as never,
      datasetPath: "video0/video",
      frameNumbers: [0],
      format: "png",
    });
    expect(await backend.readCrop(0, [0, 0, 1, 1], 0)).toBeNull();
  });
});
