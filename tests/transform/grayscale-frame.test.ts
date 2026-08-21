/**
 * Unit tests for the grayscale transform primitives (`src/transform/frame.ts`):
 * `detectGrayscale` and `grayscaleFrame`.
 *
 * Ports Python `sleap_io.io.video_reading.VideoBackend.detect_grayscale`
 * (`test_img[..., 0] == test_img[..., -1]`) and the `img[..., [0]]` slice
 * applied by `get_frame`/`get_frames` when `grayscale` is `True`.
 */
import { describe, it, expect } from "../bun-test";
import {
  detectGrayscale,
  grayscaleFrame,
  type RawFrame,
} from "../../src/transform/frame.js";

/** A RawFrame with `channels` lanes per pixel, each lane set to `value(x, y, c)`. */
function makeRawFrame(
  w: number,
  h: number,
  channels: number,
  value: (x: number, y: number, c: number) => number,
): RawFrame {
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < channels; c++) {
        data[(y * w + x) * channels + c] = value(x, y, c);
      }
    }
  }
  return { data, width: w, height: h, channels };
}

/** An ImageData-shaped RGBA frame (always 4 channels, alpha forced opaque). */
function makeImageData(
  w: number,
  h: number,
  rgb: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

describe("detectGrayscale", () => {
  it("is true for a RawFrame where every pixel's channel 0 equals the last channel", () => {
    const frame = makeRawFrame(3, 3, 3, (x, y, c) => (c === 1 ? 99 : x + y));
    expect(detectGrayscale(frame)).toBe(true);
  });

  it("is false for a RawFrame where channel 0 differs from the last channel anywhere", () => {
    const frame = makeRawFrame(3, 3, 3, (x, y, c) =>
      x === 2 && y === 2 ? c * 10 : 5,
    );
    expect(detectGrayscale(frame)).toBe(false);
  });

  it("is trivially true for a 1-channel RawFrame", () => {
    const frame = makeRawFrame(2, 2, 1, (x, y) => x + y);
    expect(detectGrayscale(frame)).toBe(true);
  });

  it("compares channel 0 vs the LAST channel, not channel 1, for >3 channels", () => {
    // channel 0 == channel 3 (last) everywhere, but channel 1 differs — must
    // still report grayscale=true (Python compares only first vs last).
    const frame = makeRawFrame(2, 2, 4, (x, y, c) => (c === 1 ? 255 : 7));
    expect(detectGrayscale(frame)).toBe(true);
  });

  it("ImageData: true for R === B everywhere (alpha and G are ignored)", () => {
    const img = makeImageData(4, 4, () => [42, 200, 42]);
    expect(detectGrayscale(img)).toBe(true);
  });

  it("ImageData: false when R !== B anywhere, even with matching alpha", () => {
    const img = makeImageData(4, 4, (x, y) =>
      x === 3 && y === 3 ? [10, 10, 20] : [5, 5, 5],
    );
    expect(detectGrayscale(img)).toBe(false);
  });

  it("throws on a raw ImageBitmap (pixels not synchronously readable)", () => {
    const fakeBitmap = { width: 4, height: 4, close: () => {} };
    expect(() => detectGrayscale(fakeBitmap as unknown as ImageData)).toThrow(
      /ImageBitmap/,
    );
  });
});

describe("grayscaleFrame", () => {
  it("collapses a 3-channel RawFrame to channel 0, channels: 1", () => {
    const frame = makeRawFrame(3, 2, 3, (x, y, c) =>
      c === 0 ? y * 3 + x : 255,
    );
    const out = grayscaleFrame(frame);
    expect(out.channels).toBe(1);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect(Array.from(out.data)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("collapses ImageData (RGBA) to a 1-channel RawFrame taking the R lane", () => {
    const img = makeImageData(2, 2, (x, y) => [10 * (y * 2 + x) + 1, 0, 0]);
    const out = grayscaleFrame(img);
    expect(out.channels).toBe(1);
    expect(Array.from(out.data)).toEqual([1, 11, 21, 31]);
  });

  it("is idempotent: collapsing an already-1-channel frame is a byte-identical copy", () => {
    const frame = makeRawFrame(2, 2, 1, (x, y) => y * 2 + x);
    const once = grayscaleFrame(frame);
    const twice = grayscaleFrame(once);
    expect(Array.from(twice.data)).toEqual(Array.from(once.data));
    expect(twice.channels).toBe(1);
    // Defensive copy: mutating the second output must not alias the first.
    twice.data[0] = 250;
    expect(once.data[0]).not.toBe(250);
  });

  it("preserves the source typed-array kind (Uint8ClampedArray in, Uint8ClampedArray out)", () => {
    const img = makeImageData(2, 2, () => [1, 2, 3]);
    const out = grayscaleFrame(img);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it("throws on a raw ImageBitmap (pixels not synchronously readable)", () => {
    const fakeBitmap = { width: 4, height: 4, close: () => {} };
    expect(() => grayscaleFrame(fakeBitmap as unknown as ImageData)).toThrow(
      /ImageBitmap/,
    );
  });
});
