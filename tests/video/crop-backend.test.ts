/**
 * Unit tests for `CropVideoBackend` (`src/video/crop-backend.ts`), the on-read
 * virtual crop wrapper (SLP format 2.3, port of Python
 * `sleap_io/io/video_reading.py` `CropVideoBackend`).
 *
 * Covers the WRAP LAW flatten matrix (flatten / nest-different-fill /
 * nest-out-of-bounds / inner-not-crop), the cropped shape math, that
 * `getFrame` equals `cropFrame(inner frame, crop, fill)`, and that `close()`
 * cascades to the inner only when `ownsInner`.
 */
import { describe, it, expect } from "../bun-test";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import { cropFrame, type RawFrame } from "../../src/transform/frame.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";

/**
 * A fake backend returning a deterministic grayscale ImageData-shaped frame:
 * pixel (x,y) value = y*width + x (mod 256). Tracks close() calls.
 */
class FakeBackend implements VideoBackend {
  filename: string;
  shape: [number, number, number, number];
  dataset: string | null = "video0/video";
  fps = 30;
  closed = 0;

  constructor(width: number, height: number, filename = "fake.mp4") {
    this.filename = filename;
    this.shape = [1, height, width, 1];
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    if (frameIndex !== 0) return null;
    const [, h, w] = this.shape;
    // 4-channel ImageData-shaped buffer (so cropFrame treats it as RGBA).
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = (y * w + x) % 256;
        const i = (y * w + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
  }

  close(): void {
    this.closed += 1;
  }
}

describe("CropVideoBackend.wrap — flatten matrix (WRAP LAW)", () => {
  it("flattens crop-of-crop when fills agree AND outer is in-bounds", () => {
    const inner = new FakeBackend(100, 100);
    const c1 = CropVideoBackend.wrap({
      inner,
      crop: [10, 20, 60, 70],
      fill: 0,
    });
    // Outer in-bounds of the inner cropped frame (50x50): [5,5,25,25].
    const c2 = CropVideoBackend.wrap({
      inner: c1,
      crop: [5, 5, 25, 25],
      fill: 0,
    });

    // Composed source rect = (10+5, 20+5, 10+25, 20+25) = (15,25,35,45).
    expect(c2.crop).toEqual([15, 25, 35, 45]);
    // Inner is unwrapped to the original (invariant: inner is never a crop).
    expect(c2.inner).toBe(inner);
    expect(c2.inner instanceof CropVideoBackend).toBe(false);
  });

  it("NESTS when fills differ", () => {
    const inner = new FakeBackend(100, 100);
    const c1 = CropVideoBackend.wrap({
      inner,
      crop: [10, 20, 60, 70],
      fill: 0,
    });
    const c2 = CropVideoBackend.wrap({
      inner: c1,
      crop: [5, 5, 25, 25],
      fill: 99,
    });

    // Different fills -> nest (inner stays the crop wrapper, outer rect unchanged).
    expect(c2.inner).toBe(c1);
    expect(c2.inner instanceof CropVideoBackend).toBe(true);
    expect(c2.crop).toEqual([5, 5, 25, 25]);
  });

  it("NESTS when the outer crop exceeds the inner cropped frame", () => {
    const inner = new FakeBackend(100, 100);
    const c1 = CropVideoBackend.wrap({
      inner,
      crop: [10, 20, 60, 70],
      fill: 0,
    });
    // Inner cropped frame is 50x50; outer x2=60 > 50 -> out of bounds -> nest.
    const c2 = CropVideoBackend.wrap({
      inner: c1,
      crop: [0, 0, 60, 30],
      fill: 0,
    });

    expect(c2.inner).toBe(c1);
    expect(c2.inner instanceof CropVideoBackend).toBe(true);
    expect(c2.crop).toEqual([0, 0, 60, 30]);
  });

  it("does not flatten a non-crop inner (just wraps)", () => {
    const inner = new FakeBackend(100, 100);
    const c1 = CropVideoBackend.wrap({
      inner,
      crop: [10, 20, 60, 70],
      fill: 0,
    });
    expect(c1.inner).toBe(inner);
    expect(c1.crop).toEqual([10, 20, 60, 70]);
  });

  it("truncates float crop bounds toward zero", () => {
    const inner = new FakeBackend(100, 100);
    const c = CropVideoBackend.wrap({
      inner,
      crop: [1.9, 2.9, 5.9, 6.9],
      fill: 0,
    });
    expect(c.crop).toEqual([1, 2, 5, 6]);
  });
});

describe("CropVideoBackend — shape math + delegated metadata", () => {
  it("reports a cropped [F, h, w, c] shape", () => {
    const inner = new FakeBackend(256, 192); // shape [1,192,256,1]
    const c = CropVideoBackend.wrap({
      inner,
      crop: [10, 20, 100, 80],
      fill: 0,
    });
    // h = 80-20 = 60, w = 100-10 = 90, F and C from inner.
    expect(c.shape).toEqual([1, 60, 90, 1]);
  });

  it("delegates dataset and fps to the inner", () => {
    const inner = new FakeBackend(50, 50);
    const c = CropVideoBackend.wrap({ inner, crop: [0, 0, 10, 10], fill: 0 });
    expect(c.dataset).toBe("video0/video");
    expect(c.fps).toBe(30);
    expect(c.filename).toBe("fake.mp4");
  });
});

describe("CropVideoBackend.getFrame === cropFrame(inner frame)", () => {
  it("produces the same pixels as cropFrame applied to the inner frame", async () => {
    const inner = new FakeBackend(20, 20);
    const crop: [number, number, number, number] = [3, 4, 13, 12]; // 10x8
    const c = CropVideoBackend.wrap({ inner, crop, fill: 17 });

    const innerFrame = (await inner.getFrame(0)) as ImageData;
    const expected = cropFrame(innerFrame, crop, 17);
    const got = (await c.getFrame(0)) as ImageData;

    expect(got.width).toBe(expected.width);
    expect(got.height).toBe(expected.height);
    expect(got.width).toBe(10);
    expect(got.height).toBe(8);
    expect(Array.from(got.data)).toEqual(Array.from(expected.data));
  });

  it("pads OOB regions with the fill, matching cropFrame", async () => {
    const inner = new FakeBackend(10, 10);
    const crop: [number, number, number, number] = [8, 0, 14, 4]; // right OOB, 6x4
    const c = CropVideoBackend.wrap({ inner, crop, fill: 200 });

    const innerFrame = (await inner.getFrame(0)) as ImageData;
    const expected = cropFrame(innerFrame, crop, 200);
    const got = (await c.getFrame(0)) as ImageData;
    expect(Array.from(got.data)).toEqual(Array.from(expected.data));
    // Spot-check: the OOB column (x>=2 in crop space) is the fill on RGB.
    expect(got.data[(0 * 6 + 5) * 4]).toBe(200);
  });

  it("returns null when the inner returns null", async () => {
    const inner = new FakeBackend(10, 10);
    const c = CropVideoBackend.wrap({ inner, crop: [0, 0, 5, 5], fill: 0 });
    expect(await c.getFrame(5)).toBeNull();
  });

  it("crops raw (non-encoded) pixel bytes using the inner shape", async () => {
    // A backend returning raw Uint8Array grayscale bytes (no ImageData wrapper,
    // not PNG/JPEG): CropVideoBackend reconstructs dims from inner.shape.
    const w = 4;
    const h = 4;
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < raw.length; i++) raw[i] = i;
    const inner: VideoBackend = {
      filename: "raw.bin",
      shape: [1, h, w, 1],
      async getFrame() {
        return raw;
      },
      close() {},
    };
    const c = CropVideoBackend.wrap({ inner, crop: [1, 1, 3, 3], fill: 0 });
    const got = (await c.getFrame(0)) as RawFrame;
    // cropFrame golden for arange(16).reshape(4,4,1) crop (1,1,3,3) = [5,6,9,10].
    expect(got.width).toBe(2);
    expect(got.height).toBe(2);
    expect(Array.from(got.data)).toEqual([5, 6, 9, 10]);
  });
});

describe("CropVideoBackend.close — ownsInner cascade", () => {
  it("cascades to inner.close() when ownsInner (default)", () => {
    const inner = new FakeBackend(10, 10);
    const c = CropVideoBackend.wrap({ inner, crop: [0, 0, 5, 5], fill: 0 });
    expect(c.ownsInner).toBe(true);
    c.close();
    expect(inner.closed).toBe(1);
  });

  it("does NOT cascade when ownsInner is false (shared decode)", () => {
    const inner = new FakeBackend(10, 10);
    const c = CropVideoBackend.wrap({
      inner,
      crop: [0, 0, 5, 5],
      fill: 0,
      ownsInner: false,
    });
    expect(c.ownsInner).toBe(false);
    c.close();
    expect(inner.closed).toBe(0);
  });
});

describe("CropVideoBackend.toCropCoords / toSourceCoords", () => {
  it("round-trips through the crop origin", () => {
    const inner = new FakeBackend(100, 100);
    const c = CropVideoBackend.wrap({ inner, crop: [10, 20, 60, 70], fill: 0 });
    const pts: [number, number][] = [
      [30, 50],
      [NaN, 5],
    ];
    const cropped = c.toCropCoords(pts);
    expect(cropped[0]).toEqual([20, 30]);
    expect(cropped[1][0]).toBeNaN();
    const restored = c.toSourceCoords(cropped);
    expect(restored[0]).toEqual([30, 50]);
    expect(restored[1][0]).toBeNaN();
  });
});
