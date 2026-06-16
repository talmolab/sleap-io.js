/**
 * Unit tests for the shared image decoder (`src/video/image-decode.ts`).
 *
 * `decodeEncoded` turns PNG/JPEG bytes into RGBA `ImageData` in either a browser
 * (`createImageBitmap` + `OffscreenCanvas`) or Node (`skia-canvas`). It is the
 * single decode path reused by `CropVideoBackend` and the `ImageVideoBackend`.
 * Under `bun test` there is no `createImageBitmap`, so these exercise the Node
 * (skia-canvas) branch.
 */
import { describe, it, expect } from "../bun-test";
import { decodeEncoded } from "../../src/video/image-decode.js";

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

describe("decodeEncoded", () => {
  it("decodes PNG bytes to RGBA ImageData with the right dimensions", async () => {
    const png = await makePng(4, 3, [10, 20, 30]);
    const img = await decodeEncoded(png);
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect(img.data.length).toBe(4 * 3 * 4); // RGBA
  });

  it("preserves pixel color (RGB order, opaque alpha)", async () => {
    const png = await makePng(2, 2, [200, 100, 50]);
    const img = await decodeEncoded(png);
    // First pixel = RGBA.
    expect(img.data[0]).toBe(200);
    expect(img.data[1]).toBe(100);
    expect(img.data[2]).toBe(50);
    expect(img.data[3]).toBe(255);
  });
});
