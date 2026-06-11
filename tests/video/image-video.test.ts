/**
 * Unit tests for `ImageVideoBackend` (`src/video/image-video.ts`) — the decoder
 * for image-sequence videos (Python `ImageVideo`: `filename` is a list of image
 * paths, one image per frame). Bytes are obtained through an injected reader, so
 * these tests run fully in Node with no filesystem.
 *
 * Parity with Python `ImageVideo` / `VideoBackend`:
 *  - num_frames = filename.length (no decode),
 *  - shape inferred by decoding filename[0] once,
 *  - channels from a grayscale check on that first frame (1 if gray, else 3).
 */
import { describe, it, expect } from "../bun-test";
import { ImageVideoBackend } from "../../src/video/image-video.js";

/** Encode a solid-color WxH image to PNG bytes via skia-canvas. */
async function makePng(
  w: number,
  h: number,
  rgb: [number, number, number]
): Promise<Uint8Array> {
  const sc = await import("skia-canvas");
  const canvas = new sc.Canvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(await canvas.toBuffer("png"));
}

/** A stub reader backed by an in-memory path -> bytes map; counts reads. */
function stubReader(map: Record<string, Uint8Array>) {
  const reads: string[] = [];
  const fn = async (path: string): Promise<Uint8Array> => {
    reads.push(path);
    const bytes = map[path];
    if (!bytes) throw new Error(`no bytes for ${path}`);
    return bytes;
  };
  return { fn, reads };
}

describe("ImageVideoBackend", () => {
  it("infers shape [frames, H, W, C] by decoding filename[0]", async () => {
    const red = await makePng(4, 3, [200, 10, 10]);
    const { fn } = stubReader({ "a.png": red, "b.png": red, "c.png": red });
    const be = await ImageVideoBackend.create({
      filename: ["a.png", "b.png", "c.png"],
      reader: fn,
    });
    // frames = list length; H=3, W=4 from the decoded image; C=3 (color).
    expect(be.shape).toEqual([3, 3, 4, 3]);
    expect(be.filename).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("reports C=1 for a grayscale first frame (Python detect_grayscale parity)", async () => {
    const gray = await makePng(2, 2, [128, 128, 128]);
    const { fn } = stubReader({ "g.png": gray });
    const be = await ImageVideoBackend.create({ filename: ["g.png"], reader: fn });
    expect(be.shape).toEqual([1, 2, 2, 1]);
  });

  it("getFrame(i) decodes the i-th image", async () => {
    const red = await makePng(2, 2, [255, 0, 0]);
    const blue = await makePng(2, 2, [0, 0, 255]);
    const { fn } = stubReader({ "0.png": red, "1.png": blue });
    const be = await ImageVideoBackend.create({
      filename: ["0.png", "1.png"],
      reader: fn,
    });
    const f0 = (await be.getFrame(0)) as ImageData;
    const f1 = (await be.getFrame(1)) as ImageData;
    expect([f0.data[0], f0.data[1], f0.data[2]]).toEqual([255, 0, 0]);
    expect([f1.data[0], f1.data[1], f1.data[2]]).toEqual([0, 0, 255]);
  });

  it("returns null for an out-of-range frame index", async () => {
    const red = await makePng(2, 2, [255, 0, 0]);
    const { fn } = stubReader({ "0.png": red });
    const be = await ImageVideoBackend.create({ filename: ["0.png"], reader: fn });
    expect(await be.getFrame(1)).toBeNull();
    expect(await be.getFrame(-1)).toBeNull();
  });

  it("caches decoded frames (reader hit once per index)", async () => {
    const red = await makePng(2, 2, [255, 0, 0]);
    const { fn, reads } = stubReader({ "0.png": red });
    const be = await ImageVideoBackend.create({ filename: ["0.png"], reader: fn });
    await be.getFrame(0);
    await be.getFrame(0);
    // One read for the shape probe + at most one for the frame; never re-read.
    const hitsFor0 = reads.filter((p) => p === "0.png").length;
    expect(hitsFor0).toBeLessThanOrEqual(1);
  });
});
