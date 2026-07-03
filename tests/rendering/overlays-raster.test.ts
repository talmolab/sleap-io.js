// Tests for the browser-safe raster overlays (`overlays-raster.ts`). These
// import the module DIRECTLY (not via the Node-only `overlays.ts`) and operate
// on a minimal ImageData-shaped object, proving the mask/label-image compositor
// needs no skia-canvas, no `node:module`, and no DOM — exactly the path the
// browser entry exports and the demo uses.

import { describe, it, expect } from "../bun-test";
import {
  drawMasks,
  drawLabelImage,
  clampAlpha,
  pickColor,
} from "../../src/rendering/overlays-raster.js";
import { UserSegmentationMask } from "../../src/model/mask.js";
import { UserLabelImage } from "../../src/model/label-image.js";

/** A minimal stand-in for the DOM `ImageData` (drawMasks only reads w/h/data). */
function makeImage(
  width: number,
  height: number,
  bg: [number, number, number] = [0, 0, 0],
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function px(
  img: { width: number; data: Uint8ClampedArray },
  x: number,
  y: number,
): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function boxMask(
  y0: number,
  y1: number,
  x0: number,
  x1: number,
  h = 32,
  w = 32,
): UserSegmentationMask {
  const a = new Uint8Array(h * w);
  for (let r = y0; r < y1; r++) for (let c = x0; c < x1; c++) a[r * w + c] = 1;
  return UserSegmentationMask.fromArray(a, h, w);
}

describe("browser-safe raster overlays", () => {
  it("clampAlpha clamps to [0,1] and rejects non-finite", () => {
    expect(clampAlpha(0.5)).toBe(0.5);
    expect(clampAlpha(-1)).toBe(0);
    expect(clampAlpha(5)).toBe(1);
    expect(clampAlpha(Number.NaN)).toBe(0);
  });

  it("pickColor cycles and falls back", () => {
    const colors: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    expect(pickColor(colors, 0, [9, 9, 9])).toEqual([1, 0, 0]);
    expect(pickColor(colors, 2, [9, 9, 9])).toEqual([1, 0, 0]); // wraps
    expect(pickColor(null, 0, [9, 9, 9])).toEqual([9, 9, 9]);
    expect(pickColor([], 0, [9, 9, 9])).toEqual([9, 9, 9]);
  });

  it("drawMasks blends color at masked pixels, leaves others", () => {
    const img = makeImage(32, 32, [0, 0, 0]);
    const mask = boxMask(8, 16, 8, 16); // 8x8 block
    drawMasks(img as unknown as ImageData, [mask], {
      color: [200, 100, 50],
      alpha: 0.5,
    });
    // Inside the mask: blended halfway from black toward [200,100,50].
    expect(px(img, 12, 12)).toEqual([100, 50, 25]);
    // Outside the mask: untouched.
    expect(px(img, 0, 0)).toEqual([0, 0, 0]);
    expect(px(img, 31, 31)).toEqual([0, 0, 0]);
  });

  it("drawMasks colors each mask by its index in `colors`", () => {
    const img = makeImage(32, 32, [0, 0, 0]);
    const a = boxMask(2, 8, 2, 8);
    const b = boxMask(20, 28, 20, 28);
    drawMasks(img as unknown as ImageData, [a, b], {
      colors: [
        [255, 0, 0],
        [0, 0, 255],
      ],
      alpha: 1.0,
    });
    expect(px(img, 4, 4)).toEqual([255, 0, 0]);
    expect(px(img, 24, 24)).toEqual([0, 0, 255]);
  });

  it("drawMasks honors a mask's scale (placed at image extent)", () => {
    // 4x4 mask, fully filled, scale 0.5 -> image extent 8x8 at the origin.
    const a = new Uint8Array(16).fill(1);
    const mask = UserSegmentationMask.fromArray(a, 4, 4, { scale: [0.5, 0.5] });
    const img = makeImage(16, 16, [0, 0, 0]);
    drawMasks(img as unknown as ImageData, [mask], {
      color: [255, 255, 255],
      alpha: 1.0,
    });
    // Pixel (6,6) is within the 8x8 placed extent; (12,12) is outside it.
    expect(px(img, 6, 6)).toEqual([255, 255, 255]);
    expect(px(img, 12, 12)).toEqual([0, 0, 0]);
  });

  it("drawLabelImage colors foreground labels and skips background", () => {
    const data = new Int32Array(16 * 16);
    for (let r = 2; r < 8; r++)
      for (let c = 2; c < 8; c++) data[r * 16 + c] = 1;
    const li = UserLabelImage.fromArray(data, 16, 16);
    const img = makeImage(16, 16, [0, 0, 0]);
    drawLabelImage(img as unknown as ImageData, li, { alpha: 1.0 });
    // Labeled region recolored; background untouched.
    expect(px(img, 4, 4)).not.toEqual([0, 0, 0]);
    expect(px(img, 14, 14)).toEqual([0, 0, 0]);
  });
});
