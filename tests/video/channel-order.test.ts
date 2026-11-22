/**
 * Channel order of embedded frames.
 *
 * Embedded PNG/JPEG frames may be stored with "BGR" channel order (images
 * encoded by OpenCV; the `channel_order` attribute on `video{N}/video`). Every
 * decode path must return RGB pixels:
 *
 * - the plain embedded backend, whose `getFrame` returns the stored bytes
 *   outside a browser, decoded with its `embeddedChannelOrder`;
 * - the crop and grayscale wrappers, which decode those bytes themselves;
 * - the streaming embedded backend (channel order read from the dataset
 *   attributes on first use);
 * - the new-embed payload, which re-encodes frames as RGB;
 * - the browser branch of the embedded backend, which decodes in `getFrame`
 *   (simulated here with skia-canvas standing in for the browser APIs).
 *
 * Fixtures: `tests/data/slp/channel_order_{bgr,rgb}_{png,jpg}.pkg.slp`, written
 * by Python sleap-io (`gen_channel_order_fixture.py`). Each holds one 32x32
 * frame with four solid 16x16 quadrants. The decode uses skia-canvas on Node;
 * if it is missing these tests fail rather than skip.
 */
import { describe, it, expect, vi, afterEach } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSlp } from "../../src/codecs/slp/read.js";
import { openH5File } from "../../src/codecs/slp/h5.js";
import { toEncodeFramePayload } from "../../src/codecs/slp/stream-embed.js";
import type { StreamingH5File } from "../../src/codecs/slp/h5-streaming.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import { GrayscaleVideoBackend } from "../../src/video/grayscale-backend.js";
import { Hdf5VideoBackend } from "../../src/video/hdf5-video.js";
import { StreamingHdf5VideoBackend } from "../../src/video/streaming-hdf5-video.js";
import {
  decodeEncoded,
  swapRedBlue,
  toReadableFrame,
} from "../../src/video/image-decode.js";

const SLP_DIR = fileURLToPath(new URL("../data/slp", import.meta.url));

type RGB = [number, number, number];

/** Quadrant centers (x, y) and their true RGB colors (see the generator). */
const QUADRANTS: { name: string; x: number; y: number; rgb: RGB }[] = [
  { name: "red", x: 8, y: 8, rgb: [220, 30, 40] },
  { name: "green", x: 24, y: 8, rgb: [30, 200, 60] },
  { name: "blue", x: 8, y: 24, rgb: [40, 50, 210] },
  { name: "orange", x: 24, y: 24, rgb: [240, 160, 20] },
];

const CASES = [
  { file: "channel_order_bgr_png.pkg.slp", order: "BGR", tol: 0 },
  { file: "channel_order_rgb_png.pkg.slp", order: "RGB", tol: 0 },
  { file: "channel_order_bgr_jpg.pkg.slp", order: "BGR", tol: 12 },
  { file: "channel_order_rgb_jpg.pkg.slp", order: "RGB", tol: 12 },
];

interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
  channels?: number;
}

/** Channel values of pixel (x, y), in stored order. */
function pixel(img: Pixels, x: number, y: number): number[] {
  const ch = img.channels ?? img.data.length / (img.width * img.height);
  const base = (y * img.width + x) * ch;
  return Array.from({ length: ch }, (_, c) => img.data[base + c]);
}

function expectColor(got: number[], want: number[], tol: number, what: string) {
  for (let c = 0; c < want.length; c++) {
    const diff = Math.abs(got[c] - want[c]);
    if (diff > tol) {
      throw new Error(
        `${what}: got [${got.slice(0, want.length)}], want [${want}] (±${tol})`,
      );
    }
  }
}

/** Assert every quadrant center of a full 32x32 frame is its RGB color. */
function expectQuadrants(img: Pixels, tol: number, what: string) {
  expect(img.width).toBe(32);
  expect(img.height).toBe(32);
  for (const q of QUADRANTS) {
    expectColor(pixel(img, q.x, q.y), q.rgb, tol, `${what} ${q.name}`);
  }
}

/** Open a fixture with the eager reader; returns its embedded backend. */
async function openEmbedded(file: string): Promise<VideoBackend> {
  const labels = await readSlp(path.join(SLP_DIR, file), { openVideos: true });
  const backend = labels.videos[0].backend;
  if (!backend) throw new Error(`${file}: no embedded backend`);
  return backend instanceof GrayscaleVideoBackend ? backend.inner : backend;
}

describe("channel order: decoder availability", () => {
  // Also warms up skia-canvas: its first decode in a fresh test worker can take
  // seconds on a busy machine, so it gets a longer timeout here, once.
  it("skia-canvas is installed, so the Node decode below really runs", async () => {
    const sc = await import("skia-canvas");
    expect(typeof sc.loadImage).toBe("function");
    const canvas = new sc.Canvas(2, 1);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgb(200, 100, 50)";
    ctx.fillRect(0, 0, 2, 1);
    const png = new Uint8Array(await canvas.toBuffer("png"));
    const img = await decodeEncoded(png, "BGR");
    expect(pixel(img, 0, 0)).toEqual([50, 100, 200, 255]);
  }, 60_000);
});

describe("channel order: shared decoder", () => {
  it("swapRedBlue swaps channels 0 and 2 per pixel and ignores < 3 channels", () => {
    const rgba = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    swapRedBlue(rgba, 4);
    expect(Array.from(rgba)).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
    const rgb = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    swapRedBlue(rgb, 3);
    expect(Array.from(rgb)).toEqual([3, 2, 1, 6, 5, 4]);
    const gray = Uint8Array.from([1, 2, 3]);
    swapRedBlue(gray, 1);
    expect(Array.from(gray)).toEqual([1, 2, 3]);
  });

  it("toReadableFrame swaps raw BGR pixel bytes into a copy", async () => {
    const stored = Uint8Array.from([10, 20, 30, 40, 50, 60]); // 2x1 BGR
    const out = (await toReadableFrame(
      stored as unknown as VideoFrame,
      [1, 1, 2, 3],
      "BGR",
    )) as Pixels;
    expect(Array.from(out.data)).toEqual([30, 20, 10, 60, 50, 40]);
    expect(Array.from(stored)).toEqual([10, 20, 30, 40, 50, 60]);
    // RGB (or no order) leaves the bytes as they are.
    const same = (await toReadableFrame(
      stored as unknown as VideoFrame,
      [1, 1, 2, 3],
      "RGB",
    )) as Pixels;
    expect(Array.from(same.data)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("toReadableFrame leaves decoded ImageData alone whatever the order", async () => {
    const img = {
      data: new Uint8ClampedArray([1, 2, 3, 255]),
      width: 1,
      height: 1,
    };
    const out = (await toReadableFrame(
      img as unknown as VideoFrame,
      undefined,
      "BGR",
    )) as Pixels;
    expect(Array.from(out.data)).toEqual([1, 2, 3, 255]);
  });
});

describe.each(CASES)("channel order: $file (Node)", ({ file, order, tol }) => {
  it(`reads channel_order ${order} from the package`, async () => {
    const backend = await openEmbedded(file);
    expect(backend).toBeInstanceOf(Hdf5VideoBackend);
    expect(backend.embeddedChannelOrder).toBe(order);
  });

  it("plain video: stored bytes decode to RGB with the backend's order", async () => {
    const backend = await openEmbedded(file);
    const frame = await backend.getFrame(0);
    // Outside a browser the embedded backend hands out the stored bytes.
    expect(frame).toBeInstanceOf(Uint8Array);
    const img = await toReadableFrame(
      frame as VideoFrame,
      backend.shape,
      backend.embeddedChannelOrder,
    );
    expectQuadrants(img, tol, "plain");
    // The fixture really discriminates: ignoring the order swaps BGR colors.
    const ignored = await decodeEncoded(frame as unknown as Uint8Array);
    const red = pixel(ignored, 8, 8);
    if (order === "BGR") expectColor(red, [40, 30, 220], tol, "ignored order");
    else expectColor(red, [220, 30, 40], tol, "ignored order");
  });

  it("crop wrapper returns RGB", async () => {
    const inner = await openEmbedded(file);
    // Left half: red on top, blue below.
    const crop = CropVideoBackend.wrap({ inner, crop: [0, 0, 16, 32] });
    const img = (await crop.getFrame(0)) as unknown as Pixels;
    expect(img.width).toBe(16);
    expect(img.height).toBe(32);
    expectColor(pixel(img, 8, 8), [220, 30, 40], tol, "crop red");
    expectColor(pixel(img, 8, 24), [40, 50, 210], tol, "crop blue");
    crop.close();
  });

  it("grayscale wrapper keeps the red channel of the RGB frame", async () => {
    const inner = await openEmbedded(file);
    const gray = GrayscaleVideoBackend.wrap({ inner, grayscale: true });
    const img = (await gray.getFrame(0)) as unknown as Pixels;
    expect(img.channels).toBe(1);
    for (const q of QUADRANTS) {
      expectColor(pixel(img, q.x, q.y), [q.rgb[0]], tol, `gray ${q.name}`);
    }
    gray.close();
  });

  it("grayscale over crop keeps the red channel of the RGB frame", async () => {
    const inner = await openEmbedded(file);
    const crop = CropVideoBackend.wrap({ inner, crop: [0, 0, 16, 32] });
    const gray = GrayscaleVideoBackend.wrap({ inner: crop, grayscale: true });
    const img = (await gray.getFrame(0)) as unknown as Pixels;
    expect(img.channels).toBe(1);
    expectColor(pixel(img, 8, 8), [220], tol, "gray crop red");
    expectColor(pixel(img, 8, 24), [40], tol, "gray crop blue");
    gray.close();
  });

  it("grayscale autodetect sees a color frame", async () => {
    const inner = await openEmbedded(file);
    const gray = GrayscaleVideoBackend.wrap({ inner, grayscale: null });
    await gray.getFrame(0);
    expect(gray.grayscale).toBe(false);
    gray.close();
  });

  it("new-embed payload is RGB", async () => {
    const backend = await openEmbedded(file);
    const frame = (await backend.getFrame(0)) as VideoFrame;
    const payload = await toEncodeFramePayload(
      frame,
      backend.shape,
      backend.embeddedChannelOrder,
    );
    if (payload.kind === "png") {
      // Only an RGB PNG is passed through verbatim.
      expect(order).toBe("RGB");
      expectQuadrants(await decodeEncoded(payload.bytes), tol, "payload");
      return;
    }
    expect(payload.kind).toBe("pixels");
    if (payload.kind !== "pixels") return;
    expectQuadrants(payload, tol, "payload");
  });

  it("streaming backend reads the order from the dataset attributes", async () => {
    const { file: h5, close } = await openH5File(path.join(SLP_DIR, file));
    try {
      const backend = new StreamingHdf5VideoBackend({
        filename: file,
        h5file: h5FileAsStreaming(h5),
        datasetPath: "video0/video",
        deferred: true,
      });
      const frame = await backend.getFrame(0);
      expect(backend.embeddedChannelOrder).toBe(order);
      expect(frame).toBeInstanceOf(Uint8Array);
      const img = await toReadableFrame(
        frame as VideoFrame,
        backend.shape,
        backend.embeddedChannelOrder,
      );
      expectQuadrants(img, tol, "streaming");
      const crop = CropVideoBackend.wrap({
        inner: backend,
        crop: [0, 0, 16, 32],
        ownsInner: false,
      });
      const cropped = (await crop.getFrame(0)) as unknown as Pixels;
      expectColor(pixel(cropped, 8, 8), [220, 30, 40], tol, "stream crop red");
      backend.close();
    } finally {
      close();
    }
  });
});

/**
 * The subset of {@link StreamingH5File} the streaming backend uses, served
 * synchronously from an h5wasm file (the real one runs in a Web Worker).
 */
function h5FileAsStreaming(h5: any): StreamingH5File {
  const fake = {
    async getKeys(p: string) {
      return h5.get(p)?.keys() ?? [];
    },
    async getAttrs(p: string) {
      return h5.get(p)?.attrs ?? {};
    },
    async getDatasetMeta(p: string) {
      const ds = h5.get(p);
      return { shape: ds.shape ?? [], dtype: ds.dtype };
    },
    async getDatasetValue(p: string, slice?: [number, number][]) {
      const ds = h5.get(p);
      return { value: slice ? ds.slice(slice) : ds.value, shape: ds.shape };
    },
  };
  return fake as unknown as StreamingH5File;
}

describe("channel order: browser branch of the embedded backend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stand in for the browser APIs the embedded backend uses (`window`,
   * `createImageBitmap`, `OffscreenCanvas`, `ImageData`) with skia-canvas.
   */
  async function stubBrowser() {
    const sc = await import("skia-canvas");
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("OffscreenCanvas", sc.Canvas);
    vi.stubGlobal("ImageData", sc.ImageData);
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
      const img = await sc.loadImage(Buffer.from(await blob.arrayBuffer()));
      // A bitmap exposes close(); skia's Image does not.
      return Object.assign(img, { close() {} });
    });
  }

  it.each(
    CASES,
  )("$file: getFrame is RGB and the wrappers do not swap it again", async ({
    file,
    order,
    tol,
  }) => {
    await stubBrowser();
    const backend = await openEmbedded(file);
    const frame = await backend.getFrame(0);
    expect(frame).not.toBeInstanceOf(Uint8Array);
    // RGB stays a bitmap; BGR comes back as swapped ImageData.
    expect("data" in (frame as object)).toBe(order === "BGR");
    const img = await toReadableFrame(
      frame as VideoFrame,
      backend.shape,
      backend.embeddedChannelOrder,
    );
    expectQuadrants(img, tol, "browser plain");

    const crop = CropVideoBackend.wrap({
      inner: backend,
      crop: [0, 0, 16, 32],
      ownsInner: false,
    });
    const cropped = (await crop.getFrame(0)) as unknown as Pixels;
    expectColor(pixel(cropped, 8, 8), [220, 30, 40], tol, "browser crop red");
    expectColor(pixel(cropped, 8, 24), [40, 50, 210], tol, "browser crop blue");

    const gray = GrayscaleVideoBackend.wrap({
      inner: backend,
      grayscale: true,
    });
    const g = (await gray.getFrame(0)) as unknown as Pixels;
    expectColor(pixel(g, 8, 8), [220], tol, "browser gray red");
    expectColor(pixel(g, 8, 24), [40], tol, "browser gray blue");
  });
});
