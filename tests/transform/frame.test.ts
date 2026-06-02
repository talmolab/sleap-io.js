/**
 * Unit tests for the frame crop transform (`src/transform/frame.ts`).
 *
 * Ports Python `sleap_io/transform/frame.py` (`crop_frame`). All expected
 * arrays below are the OUTPUT of the authoritative Python implementation
 * (sleap-io 0.8.0) on the same deterministic inputs, so this is a true
 * cross-implementation parity check:
 *
 *   img = arange(16).reshape(4,4,1)   # grayscale
 *     crop (1,1,3,3)        -> [[5,6],[9,10]]
 *     crop (-1,0,2,2) f=99  -> [[99,0,1],[99,4,5]]            (left OOB)
 *     crop (0,-1,2,2) f=99  -> [[99,99],[0,1],[4,5]]          (top OOB)
 *     crop (2,0,6,2) f=7    -> [[2,3,7,7],[6,7,7,7]]          (right OOB)
 *     crop (0,2,2,6) f=7    -> [[8,9],[12,13],[7,7],[7,7]]    (bottom OOB)
 *     crop (10,0,12,2) f=5  -> [[5,5],[5,5]]                  (wholly OOB)
 *
 *   img = arange(36).reshape(3,3,4)   # RGBA
 *     crop (1,0,3,2)                       -> [4..11, 16..23]
 *     crop (2,0,4,2) f=[10,20,30,40]       -> per-channel pad
 *
 * Also asserts cropFrame THROWS on a raw ImageBitmap (its pixels are not
 * synchronously readable; rasterization is the backend's job).
 */
import { describe, it, expect } from "../bun-test";
import { cropFrame, type RawFrame } from "../../src/transform/frame.js";

/** A deterministic grayscale RawFrame: data[i] = i, shape (h, w, 1). */
function grayFrame(w: number, h: number): RawFrame {
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = i;
  return { data, width: w, height: h, channels: 1 };
}

/** A deterministic RGBA RawFrame: data[i] = i, shape (h, w, 4). */
function rgbaFrame(w: number, h: number): RawFrame {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = i;
  return { data, width: w, height: h, channels: 4 };
}

describe("cropFrame — grayscale (C=1), Python golden parity", () => {
  it("in-bounds crop matches Python", () => {
    const out = cropFrame(grayFrame(4, 4), [1, 1, 3, 3], 0);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.channels).toBe(1);
    expect(Array.from(out.data)).toEqual([5, 6, 9, 10]);
  });

  it("left-edge OOB pads on the left", () => {
    const out = cropFrame(grayFrame(4, 4), [-1, 0, 2, 2], 99);
    expect([out.height, out.width]).toEqual([2, 3]);
    expect(Array.from(out.data)).toEqual([99, 0, 1, 99, 4, 5]);
  });

  it("top-edge OOB pads on top", () => {
    const out = cropFrame(grayFrame(4, 4), [0, -1, 2, 2], 99);
    expect([out.height, out.width]).toEqual([3, 2]);
    expect(Array.from(out.data)).toEqual([99, 99, 0, 1, 4, 5]);
  });

  it("right-edge OOB pads on the right", () => {
    const out = cropFrame(grayFrame(4, 4), [2, 0, 6, 2], 7);
    expect([out.height, out.width]).toEqual([2, 4]);
    expect(Array.from(out.data)).toEqual([2, 3, 7, 7, 6, 7, 7, 7]);
  });

  it("bottom-edge OOB pads on the bottom", () => {
    const out = cropFrame(grayFrame(4, 4), [0, 2, 2, 6], 7);
    expect([out.height, out.width]).toEqual([4, 2]);
    expect(Array.from(out.data)).toEqual([8, 9, 12, 13, 7, 7, 7, 7]);
  });

  it("wholly-OOB crop yields an all-fill buffer of the requested size", () => {
    const out = cropFrame(grayFrame(4, 4), [10, 0, 12, 2], 5);
    expect([out.height, out.width]).toEqual([2, 2]);
    expect(Array.from(out.data)).toEqual([5, 5, 5, 5]);
  });

  it("does not mutate the input frame buffer", () => {
    const frame = grayFrame(4, 4);
    const snapshot = Array.from(frame.data);
    cropFrame(frame, [-1, 0, 2, 2], 99);
    expect(Array.from(frame.data)).toEqual(snapshot);
  });
});

describe("cropFrame — RGBA (C=4), Python golden parity", () => {
  it("in-bounds RGBA crop preserves all 4 channels", () => {
    const out = cropFrame(rgbaFrame(3, 3), [1, 0, 3, 2], 0);
    expect([out.height, out.width, out.channels]).toEqual([2, 2, 4]);
    expect(Array.from(out.data)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });

  it("per-channel tuple fill on OOB pads each channel independently", () => {
    const out = cropFrame(rgbaFrame(3, 3), [2, 0, 4, 2], [10, 20, 30, 40]);
    expect([out.height, out.width, out.channels]).toEqual([2, 2, 4]);
    expect(Array.from(out.data)).toEqual([
      8, 9, 10, 11, 10, 20, 30, 40, 20, 21, 22, 23, 10, 20, 30, 40,
    ]);
  });
});

describe("cropFrame — ImageData (browser RGBA) path", () => {
  it("returns an ImageData-shaped RGBA result from an ImageData input", () => {
    // Build an ImageData-shaped object (4-channel, Uint8ClampedArray backed).
    const w = 3;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = i;
    const imageData = { data, width: w, height: h, colorSpace: "srgb" } as ImageData;

    const out = cropFrame(imageData, [1, 0, 3, 2], 0);
    // ImageData result has no `channels` field and is RGBA (4 lanes/pixel).
    expect((out as unknown as RawFrame).channels).toBeUndefined();
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(out.data)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });
});

describe("cropFrame — rejects a raw ImageBitmap", () => {
  it("throws a clear error (pixels not synchronously readable)", () => {
    // Duck-typed ImageBitmap: width/height + close(), but NO readable `data`.
    const fakeBitmap = {
      width: 10,
      height: 10,
      close() {
        /* no-op */
      },
    };
    expect(() =>
      cropFrame(fakeBitmap as unknown as ImageData, [0, 0, 5, 5], 0),
    ).toThrow(/ImageBitmap/);
  });
});
