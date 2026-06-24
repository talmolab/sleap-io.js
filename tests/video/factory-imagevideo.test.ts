/**
 * `createVideoBackend()` must route a LIST-valued source (image-sequence /
 * ImageVideo) to `ImageVideoBackend`, instead of treating it as a single
 * filename string (which crashed with `filename.split is not a function`).
 */
import { describe, it, expect } from "../bun-test";
import { createVideoBackend } from "../../src/video/factory.js";
import { ImageVideoBackend } from "../../src/video/image-video.js";
import { setImageBytesReader } from "../../src/video/image-source.js";

async function makePng(
  w: number,
  h: number,
  rgb: [number, number, number],
): Promise<Uint8Array> {
  const sc = await import("skia-canvas");
  const canvas = new sc.Canvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(await canvas.toBuffer("png"));
}

describe("createVideoBackend (image-sequence)", () => {
  it("routes a list source to ImageVideoBackend", async () => {
    const red = await makePng(2, 2, [255, 0, 0]);
    setImageBytesReader(async () => red);
    try {
      const be = await createVideoBackend([
        "a.png",
        "b.png",
        "c.png",
      ] as unknown as string);
      expect(be).toBeInstanceOf(ImageVideoBackend);
      expect(be.shape).toEqual([3, 2, 2, 3]);
    } finally {
      setImageBytesReader(null);
    }
  });
});
