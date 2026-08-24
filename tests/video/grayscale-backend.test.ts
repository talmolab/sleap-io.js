/**
 * Unit tests for `GrayscaleVideoBackend` (`src/video/grayscale-backend.ts`),
 * the on-read grayscale-forcing wrapper — port of the grayscale-forcing /
 * autodetect behavior baked into Python's `VideoBackend.get_frame` /
 * `detect_grayscale`.
 *
 * Covers: forced true/false, null-autodetect (+ caching after first read),
 * delegation of every optional `VideoBackend` field, the "never nest" wrap
 * law, composition with a real `CropVideoBackend` (including full-frame
 * autodetection), and all three `toReadableFrame` normalization branches
 * (ImageData, raw bytes, encoded PNG bytes).
 */
import { describe, it, expect } from "../bun-test";
import { GrayscaleVideoBackend } from "../../src/video/grayscale-backend.js";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import type { RawFrame } from "../../src/transform/frame.js";

/**
 * A fake backend returning a deterministic ImageData-shaped frame. `color`
 * controls whether R/B differ (a genuinely color source) or match (a
 * genuinely grayscale source). Tracks `close()`/`getFrame()` calls.
 */
class FakeBackend implements VideoBackend {
  filename: string;
  shape: [number, number, number, number];
  dataset: string | null = "video0/video";
  fps = 30;
  frameNumbers: number[] | undefined = [0, 1, 2];
  embeddedFormat = "png";
  embeddedChannelOrder = "RGB";
  closed = 0;
  getFrameCalls = 0;
  private color: boolean;

  constructor(
    width: number,
    height: number,
    opts: { color: boolean; filename?: string },
  ) {
    this.filename = opts.filename ?? "fake.mp4";
    this.shape = [3, height, width, 1];
    this.color = opts.color;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    this.getFrameCalls += 1;
    if (frameIndex < 0 || frameIndex >= 3) return null;
    const [, h, w] = this.shape;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = (y * w + x) % 200;
        const i = (y * w + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = this.color ? (v + 50) % 256 : v;
        data[i + 3] = 255;
      }
    }
    return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
  }

  async getFrameBuffer(frameNumber: number): Promise<Uint8Array | null> {
    return new Uint8Array([frameNumber]);
  }

  async getFrameTimes(): Promise<number[] | null> {
    return [0, 1, 2];
  }

  async ensureLoaded(): Promise<void> {}

  async probeFirstFrame(): Promise<boolean> {
    return true;
  }

  close(): void {
    this.closed += 1;
  }
}

describe("GrayscaleVideoBackend — forced true", () => {
  it("collapses a color frame to 1 channel", async () => {
    const inner = new FakeBackend(4, 4, { color: true });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    const frame = (await be.getFrame(0)) as RawFrame;
    expect(frame.channels).toBe(1);
  });

  it("reports shape [..., 1] immediately, without reading a frame", () => {
    const inner = new FakeBackend(4, 4, { color: true });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    expect(be.shape).toEqual([3, 4, 4, 1]);
    expect(inner.getFrameCalls).toBe(0);
  });

  it("collapses a genuinely-grayscale source too (idempotent forcing)", async () => {
    const inner = new FakeBackend(4, 4, { color: false });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    const frame = (await be.getFrame(0)) as RawFrame;
    expect(frame.channels).toBe(1);
  });
});

describe("GrayscaleVideoBackend — forced false", () => {
  it("never collapses, even a genuinely-grayscale source", async () => {
    const inner = new FakeBackend(4, 4, { color: false });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: false });
    const frame = (await be.getFrame(0)) as ImageData;
    expect(frame.data.length).toBe(4 * 4 * 4);
  });

  it("forces channels to 3 in the reported shape, even overriding an inner that declares 1", () => {
    // FakeBackend always declares shape channels=1 (see its constructor) —
    // `grayscale: false` must positively override this so `Video.grayscale`'s
    // shape-driven getter reads back false, not true (Python `img_shape`
    // parity: `if self.grayscale is False: channels = 3`).
    const inner = new FakeBackend(4, 4, { color: false });
    expect(inner.shape[3]).toBe(1);
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: false });
    expect(be.shape).toEqual([3, 4, 4, 3]);
  });

  it("returns byte-identical pixels to calling the inner directly (no transform applied)", async () => {
    const innerA = new FakeBackend(4, 4, { color: true });
    const innerB = new FakeBackend(4, 4, { color: true });
    const be = GrayscaleVideoBackend.wrap({ inner: innerA, grayscale: false });
    const direct = (await innerB.getFrame(0)) as ImageData;
    const wrapped = (await be.getFrame(0)) as ImageData;
    expect(Array.from(wrapped.data)).toEqual(Array.from(direct.data));
  });
});

describe("GrayscaleVideoBackend — null (autodetect)", () => {
  it("resolves true for a genuinely-grayscale source and caches it", async () => {
    const inner = new FakeBackend(4, 4, { color: false });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: null });
    expect(be.grayscale).toBeNull();
    const frame = (await be.getFrame(0)) as RawFrame;
    expect(frame.channels).toBe(1);
    expect(be.grayscale).toBe(true);
  });

  it("resolves false for a genuinely-color source and caches it", async () => {
    const inner = new FakeBackend(4, 4, { color: true });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: null });
    const frame = (await be.getFrame(0)) as ImageData;
    expect(frame.data.length).toBe(4 * 4 * 4);
    expect(be.grayscale).toBe(false);
  });

  it("does not re-run autodetection on a second getFrame call", async () => {
    const inner = new FakeBackend(4, 4, { color: false });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: null });
    await be.getFrame(0);
    expect(be.grayscale).toBe(true);
    // Swap in a color inner to prove the second call trusts the cached
    // `true` instead of re-detecting (which would resolve false here).
    (be as unknown as { inner: VideoBackend }).inner = new FakeBackend(4, 4, {
      color: true,
    });
    const frame2 = (await be.getFrame(1)) as RawFrame;
    expect(frame2.channels).toBe(1);
  });

  it("shape is unresolved (inner's native channel count) before the first getFrame", () => {
    const inner = new FakeBackend(4, 4, { color: false });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: null });
    // Documented async-vs-sync limitation: `shape` is a sync getter and
    // cannot trigger a decode, so it reflects the inner's native shape until
    // the first `getFrame()` resolves autodetection.
    expect(be.shape).toEqual(inner.shape);
  });
});

describe("GrayscaleVideoBackend — delegation", () => {
  it("delegates every optional VideoBackend field to the inner", async () => {
    const inner = new FakeBackend(4, 4, { color: true });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: false });
    expect(be.dataset).toBe("video0/video");
    expect(be.fps).toBe(30);
    expect(be.frameNumbers).toEqual([0, 1, 2]);
    expect(be.embeddedFormat).toBe("png");
    expect(be.embeddedChannelOrder).toBe("RGB");
    expect(await be.getFrameBuffer(1)).toEqual(new Uint8Array([1]));
    expect(await be.getFrameTimes()).toEqual([0, 1, 2]);
    expect(await be.probeFirstFrame()).toBe(true);
    expect(be.filename).toBe("fake.mp4");
  });

  it("close() always cascades to the inner", () => {
    const inner = new FakeBackend(4, 4, { color: true });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    be.close();
    expect(inner.closed).toBe(1);
  });

  it("getFrameBuffer resolves null when the inner has none", async () => {
    const inner: VideoBackend = {
      filename: "x.mp4",
      shape: [1, 2, 2, 3],
      async getFrame() {
        return null;
      },
      close() {},
    };
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: false });
    expect(await be.getFrameBuffer(0)).toBeNull();
  });

  it("probeFirstFrame defaults to true when the inner omits it", async () => {
    const inner: VideoBackend = {
      filename: "x.mp4",
      shape: [1, 2, 2, 3],
      async getFrame() {
        return null;
      },
      close() {},
    };
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: false });
    expect(await be.probeFirstFrame()).toBe(true);
  });

  it("getFrameTimes resolves null when the inner omits it", async () => {
    const inner: VideoBackend = {
      filename: "x.mp4",
      shape: [1, 2, 2, 3],
      async getFrame() {
        return null;
      },
      close() {},
    };
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: false });
    expect(await be.getFrameTimes()).toBeNull();
  });
});

describe("GrayscaleVideoBackend.wrap — never nests (WRAP LAW)", () => {
  it("unwraps and replaces an existing grayscale layer instead of nesting", () => {
    const inner = new FakeBackend(4, 4, { color: true });
    const g1 = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    const g2 = GrayscaleVideoBackend.wrap({ inner: g1, grayscale: false });
    expect(g2.inner).toBe(inner);
    expect(g2.inner instanceof GrayscaleVideoBackend).toBe(false);
    expect(g2.grayscale).toBe(false);
  });

  it("dropping a previously-resolved autodetect result on re-wrap", async () => {
    const inner = new FakeBackend(4, 4, { color: false });
    const g1 = GrayscaleVideoBackend.wrap({ inner, grayscale: null });
    await g1.getFrame(0);
    expect(g1.grayscale).toBe(true);
    // Re-wrapping with grayscale: null again must re-arm autodetection, not
    // inherit g1's already-resolved `true`.
    const g2 = GrayscaleVideoBackend.wrap({ inner: g1, grayscale: null });
    expect(g2.grayscale).toBeNull();
  });
});

describe("GrayscaleVideoBackend — null frame passthrough", () => {
  it("propagates a null frame (no such index) untouched", async () => {
    const inner = new FakeBackend(4, 4, { color: true });
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    expect(await be.getFrame(99)).toBeNull();
  });
});

describe("GrayscaleVideoBackend — raw (non-ImageData) pixel bytes", () => {
  it("collapses a raw Uint8Array frame using the inner's shape to interpret it", async () => {
    const w = 3;
    const h = 2;
    const raw = new Uint8Array(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = i;
    const inner: VideoBackend = {
      filename: "raw.bin",
      shape: [1, h, w, 3],
      async getFrame() {
        return raw;
      },
      close() {},
    };
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    const frame = (await be.getFrame(0)) as RawFrame;
    expect(frame.channels).toBe(1);
    expect(frame.width).toBe(w);
    expect(frame.height).toBe(h);
    // Channel 0 of each pixel: strides of 3 starting at 0, 3, 6, 9, 12, 15.
    expect(Array.from(frame.data)).toEqual([0, 3, 6, 9, 12, 15]);
  });

  it("throws a clear error for raw bytes with no shape to interpret them", async () => {
    const inner: VideoBackend = {
      filename: "raw.bin",
      async getFrame() {
        return new Uint8Array([1, 2, 3, 4]);
      },
      close() {},
    };
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: null });
    await expect(be.getFrame(0)).rejects.toThrow(/shape/);
  });
});

describe("GrayscaleVideoBackend — encoded (PNG) bytes", () => {
  it("decodes PNG bytes and collapses them to 1 channel", async () => {
    const sc = await import("skia-canvas");
    const canvas = new sc.Canvas(3, 3);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgb(10, 20, 30)";
    ctx.fillRect(0, 0, 3, 3);
    const png = new Uint8Array(await canvas.toBuffer("png"));

    const inner: VideoBackend = {
      filename: "e.png",
      shape: [1, 3, 3, 3],
      async getFrame() {
        return png;
      },
      close() {},
    };
    const be = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    const frame = (await be.getFrame(0)) as RawFrame;
    expect(frame.channels).toBe(1);
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(3);
    expect(frame.data[0]).toBe(10); // R channel of rgb(10,20,30).
  });
});

describe("GrayscaleVideoBackend composed with a real CropVideoBackend", () => {
  it("Grayscale(Crop(inner)): crops correctly AND collapses channels", async () => {
    const inner = new FakeBackend(10, 10, { color: true });
    const cropped = CropVideoBackend.wrap({
      inner,
      crop: [2, 2, 6, 6],
      fill: 0,
    });
    const be = GrayscaleVideoBackend.wrap({ inner: cropped, grayscale: true });
    const frame = (await be.getFrame(0)) as RawFrame;
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(4);
    expect(frame.channels).toBe(1);
    expect(be.shape).toEqual([3, 4, 4, 1]);
  });

  it("autodetection resolves from the FULL uncropped frame, not the crop", async () => {
    // A source that is genuinely color everywhere EXCEPT the exact crop
    // region, which — looked at in isolation — appears grayscale (R === B).
    // Autodetect must see the full frame (bypassing the crop) and correctly
    // resolve to color (false), matching Python's `CropVideoBackend
    // .detect_grayscale`, which explicitly ignores the cropped image.
    const w = 6;
    const h = 6;
    let fullFrameReads = 0;
    const inner: VideoBackend = {
      filename: "mixed.mp4",
      shape: [1, h, w, 1],
      async getFrame(frameIndex: number) {
        if (frameIndex !== 0) return null;
        fullFrameReads += 1;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const inCropRegion = x >= 1 && x < 3 && y >= 1 && y < 3;
            data[i] = 50;
            data[i + 1] = 50;
            // Grayscale (R===B) ONLY inside the crop region; color everywhere else.
            data[i + 2] = inCropRegion ? 50 : 200;
            data[i + 3] = 255;
          }
        }
        return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
      },
      close() {},
    };
    const cropped = CropVideoBackend.wrap({
      inner,
      crop: [1, 1, 3, 3],
      fill: 0,
    });
    const be = GrayscaleVideoBackend.wrap({
      inner: cropped,
      grayscale: null,
    });
    const frame = (await be.getFrame(0)) as ImageData;
    // Resolved false (color) from the full frame, so the crop's own 4-channel
    // ImageData passes through untouched.
    expect(be.grayscale).toBe(false);
    expect(frame.data.length).toBe(2 * 2 * 4); // 2x2 crop, 4 channels, untouched.
    // Exactly 2 full-frame reads: one for detection, one for the crop's own
    // decode (no extra decode beyond what correctness requires).
    expect(fullFrameReads).toBe(2);
  });
});
