import { describe, it, expect } from "../bun-test";
import {
  drawMasks,
  drawLabelImage,
  drawBboxes,
  drawRois,
  applyOverlay,
} from "../../src/rendering/overlays";
import type { RawLabelImage } from "../../src/rendering/overlays";
import { renderImage } from "../../src/rendering/render";
import { renderVideo } from "../../src/rendering/video";
import { UserSegmentationMask, SegmentationMask } from "../../src/model/mask";
import { UserLabelImage } from "../../src/model/label-image";
import {
  UserBoundingBox,
  PredictedBoundingBox,
  BoundingBox,
} from "../../src/model/bbox";
import { UserROI } from "../../src/model/roi";
import { Skeleton } from "../../src/model/skeleton";
import { Instance, Track } from "../../src/model/instance";
import { LabeledFrame } from "../../src/model/labeled-frame";
import { Labels } from "../../src/model/labels";
import { Video } from "../../src/model/video";
import { PALETTES, getPalette } from "../../src/rendering/colors";

const DISTINCT = PALETTES.distinct;
const STANDARD = PALETTES.standard;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a solid-color RGBA ImageData of the given size using skia-canvas, so
 * that the same object round-trips through `putImageData`/`getImageData` in the
 * vector-overlay path (drawBboxes/drawRois).
 */
async function makeImage(
  width: number,
  height: number,
  fill: [number, number, number] = [255, 255, 255],
): Promise<ImageData> {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${fill[0]}, ${fill[1]}, ${fill[2]})`;
  ctx.fillRect(0, 0, width, height);
  return ctx.getImageData(0, 0, width, height) as unknown as ImageData;
}

/** Read the RGB triple at pixel (x, y) of an ImageData. */
function pixel(img: ImageData, x: number, y: number): [number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
}

/** Assert an RGB triple matches an expected triple within +/- tolerance. */
function expectRGBNear(
  actual: [number, number, number],
  expected: [number, number, number],
  tol = 2,
): void {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tol);
  }
}

/** Truncating blend used by the raster overlays: trunc(dst*(1-a) + src*a). */
function blend(dst: number, src: number, alpha: number): number {
  return Math.trunc(dst * (1 - alpha) + src * alpha);
}

function blendRGB(
  dst: [number, number, number],
  src: [number, number, number],
  alpha: number,
): [number, number, number] {
  return [
    blend(dst[0], src[0], alpha),
    blend(dst[1], src[1], alpha),
    blend(dst[2], src[2], alpha),
  ];
}

/**
 * A solid square binary mask of size H x W with a foreground block from
 * (r0, c0) inclusive to (r1, c1) exclusive.
 */
function squareMask(
  height: number,
  width: number,
  r0: number,
  c0: number,
  r1: number,
  c1: number,
): Uint8Array {
  const m = new Uint8Array(height * width);
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      m[r * width + c] = 1;
    }
  }
  return m;
}

function createTestSkeleton(): Skeleton {
  return new Skeleton({
    nodes: ["head", "tail"],
    edges: [["head", "tail"]],
  });
}

// ===========================================================================
// drawMasks
// ===========================================================================

describe("drawMasks", () => {
  it("blends a single mask color with the default alpha (0.3)", async () => {
    const img = await makeImage(10, 10, [255, 255, 255]);
    // Foreground block rows 2-5, cols 2-5.
    const mask = UserSegmentationMask.fromArray(
      squareMask(10, 10, 2, 2, 6, 6),
      10,
      10,
    );

    drawMasks(img, [mask]); // default color [255,0,0], alpha 0.3

    // Inside the block: white blended toward red at alpha 0.3.
    expectRGBNear(pixel(img, 3, 3), blendRGB([255, 255, 255], [255, 0, 0], 0.3));
    // Outside the block: untouched.
    expectRGBNear(pixel(img, 0, 0), [255, 255, 255]);
    expectRGBNear(pixel(img, 9, 9), [255, 255, 255]);
  });

  it("honors an explicit color and alpha and the blend math at a known pixel", async () => {
    const img = await makeImage(8, 8, [0, 0, 0]);
    const mask = UserSegmentationMask.fromArray(
      squareMask(8, 8, 0, 0, 4, 4),
      8,
      8,
    );

    drawMasks(img, [mask], { color: [100, 200, 50], alpha: 0.5 });

    // black blended toward [100,200,50] at 0.5 = [50, 100, 25].
    expectRGBNear(pixel(img, 1, 1), [
      blend(0, 100, 0.5),
      blend(0, 200, 0.5),
      blend(0, 50, 0.5),
    ]);
  });

  it("uses per-mask colors when provided", async () => {
    const img = await makeImage(12, 12, [255, 255, 255]);
    const m0 = UserSegmentationMask.fromArray(squareMask(12, 12, 0, 0, 4, 4), 12, 12);
    const m1 = UserSegmentationMask.fromArray(squareMask(12, 12, 6, 6, 10, 10), 12, 12);

    drawMasks(img, [m0, m1], {
      colors: [
        [255, 0, 0],
        [0, 0, 255],
      ],
      alpha: 0.4,
    });

    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], [255, 0, 0], 0.4));
    expectRGBNear(pixel(img, 7, 7), blendRGB([255, 255, 255], [0, 0, 255], 0.4));
  });

  it("is a no-op for an empty mask list", async () => {
    const img = await makeImage(6, 6, [10, 20, 30]);
    const before = Array.from(img.data);
    drawMasks(img, []);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("places a mask with a spatial transform (scale) at its image extent", async () => {
    // 4x4 mask data, scale 2 -> image extent 2x2. Fill the whole 4x4 mask so
    // the entire downscaled 2x2 extent is foreground at image (0,0)-(1,1).
    const img = await makeImage(8, 8, [255, 255, 255]);
    const data = squareMask(4, 4, 0, 0, 4, 4); // fully foreground in mask space
    const mask = new UserSegmentationMask({
      rleCounts: (await import("../../src/model/mask")).encodeRle(data, 4, 4),
      height: 4,
      width: 4,
      scale: [2, 2],
    });
    expect(mask.hasSpatialTransform).toBe(true);
    expect(mask.imageExtent).toEqual({ height: 2, width: 2 });

    drawMasks(img, [mask], { color: [255, 0, 0], alpha: 0.5 });

    // After nearest-neighbor downscale to 2x2, the whole 2x2 extent is fg.
    expectRGBNear(pixel(img, 0, 0), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    // Beyond the 2x2 extent: untouched.
    expectRGBNear(pixel(img, 5, 5), [255, 255, 255]);
  });

  it("places a mask at a positive offset", async () => {
    const img = await makeImage(10, 10, [255, 255, 255]);
    const data = squareMask(3, 3, 0, 0, 3, 3); // fully fg 3x3
    const mask = new UserSegmentationMask({
      rleCounts: (await import("../../src/model/mask")).encodeRle(data, 3, 3),
      height: 3,
      width: 3,
      offset: [4, 5],
    });

    drawMasks(img, [mask], { color: [0, 255, 0], alpha: 0.5 });

    // Offset (ox=4, oy=5): fg lands at image rows 5-7, cols 4-6.
    expectRGBNear(pixel(img, 4, 5), blendRGB([255, 255, 255], [0, 255, 0], 0.5));
    expectRGBNear(pixel(img, 6, 7), blendRGB([255, 255, 255], [0, 255, 0], 0.5));
    // Origin untouched (offset moved the mask away).
    expectRGBNear(pixel(img, 0, 0), [255, 255, 255]);
  });

  it("clips an out-of-bounds offset to the image bounds without throwing", async () => {
    const img = await makeImage(6, 6, [255, 255, 255]);
    const data = squareMask(4, 4, 0, 0, 4, 4);
    const mask = new UserSegmentationMask({
      rleCounts: (await import("../../src/model/mask")).encodeRle(data, 4, 4),
      height: 4,
      width: 4,
      offset: [4, 4], // 4..8 but image is only 6 wide/tall -> clipped to 4..6
    });

    expect(() => drawMasks(img, [mask], { color: [255, 0, 0], alpha: 0.5 })).not.toThrow();

    // Inside the visible clipped window.
    expectRGBNear(pixel(img, 5, 5), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    expectRGBNear(pixel(img, 4, 4), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    // Outside the placement window untouched.
    expectRGBNear(pixel(img, 0, 0), [255, 255, 255]);
  });

  it("fully skips a mask whose offset is entirely off-image", async () => {
    const img = await makeImage(6, 6, [255, 255, 255]);
    const before = Array.from(img.data);
    const data = squareMask(3, 3, 0, 0, 3, 3);
    const mask = new UserSegmentationMask({
      rleCounts: (await import("../../src/model/mask")).encodeRle(data, 3, 3),
      height: 3,
      width: 3,
      offset: [100, 100],
    });
    drawMasks(img, [mask], { color: [255, 0, 0], alpha: 0.5 });
    expect(Array.from(img.data)).toEqual(before);
  });

  it("clips a mask with a negative offset on the top/left boundary", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    const data = squareMask(4, 4, 0, 0, 4, 4); // fully fg 4x4
    const mask = new UserSegmentationMask({
      rleCounts: (await import("../../src/model/mask")).encodeRle(data, 4, 4),
      height: 4,
      width: 4,
      offset: [-2, -2], // top-left 2x2 of the mask falls off the image
    });

    expect(() =>
      drawMasks(img, [mask], { color: [255, 0, 0], alpha: 0.5 }),
    ).not.toThrow();

    // Visible window is image (0,0)-(1,1); it shows the blended mask fg.
    expectRGBNear(pixel(img, 0, 0), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    // Beyond the placed 4x4 (which now ends at image (1,1)): untouched.
    expectRGBNear(pixel(img, 3, 3), [255, 255, 255]);
  });

  it("applies a scale and offset transform together", async () => {
    const img = await makeImage(12, 12, [255, 255, 255]);
    const data = squareMask(4, 4, 0, 0, 4, 4); // fully fg 4x4
    const mask = new UserSegmentationMask({
      rleCounts: (await import("../../src/model/mask")).encodeRle(data, 4, 4),
      height: 4,
      width: 4,
      scale: [2, 2], // downscale extent to 2x2
      offset: [3, 3], // place at image (3,3)
    });
    expect(mask.hasSpatialTransform).toBe(true);
    expect(mask.imageExtent).toEqual({ height: 2, width: 2 });

    drawMasks(img, [mask], { color: [255, 0, 0], alpha: 0.5 });

    // 2x2 extent placed at (3,3) covers image (3,3)-(4,4).
    expectRGBNear(pixel(img, 3, 3), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    expectRGBNear(pixel(img, 4, 4), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    // Before the offset and beyond the extent: untouched.
    expectRGBNear(pixel(img, 2, 2), [255, 255, 255]);
    expectRGBNear(pixel(img, 5, 5), [255, 255, 255]);
  });

  it("blends overlapping masks sequentially", async () => {
    const img = await makeImage(10, 10, [255, 255, 255]);
    const m0 = UserSegmentationMask.fromArray(squareMask(10, 10, 2, 2, 6, 6), 10, 10);
    const m1 = UserSegmentationMask.fromArray(squareMask(10, 10, 4, 4, 8, 8), 10, 10);

    drawMasks(img, [m0, m1], {
      colors: [
        [255, 0, 0],
        [0, 0, 255],
      ],
      alpha: 0.5,
    });

    // Non-overlap of m0 (rows/cols 2-3): just red blended once.
    expectRGBNear(pixel(img, 2, 2), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    // Non-overlap of m1 (rows/cols 6-7): just blue blended once.
    expectRGBNear(pixel(img, 7, 7), blendRGB([255, 255, 255], [0, 0, 255], 0.5));
    // Overlap (rows/cols 4-5): red first, then blue on top of that result.
    const afterRed = blendRGB([255, 255, 255], [255, 0, 0], 0.5);
    const afterBlue = blendRGB(afterRed, [0, 0, 255], 0.5);
    expectRGBNear(pixel(img, 4, 4), afterBlue);
    expect(pixel(img, 4, 4)[2]).toBeGreaterThan(pixel(img, 4, 4)[0]); // blue dominates
  });

  it("clips a mask larger than the image from all edges", async () => {
    const img = await makeImage(6, 6, [255, 255, 255]);
    const largeMask = UserSegmentationMask.fromArray(
      squareMask(20, 20, 0, 0, 20, 20),
      20,
      20,
    );

    expect(() =>
      drawMasks(img, [largeMask], { color: [255, 0, 0], alpha: 0.5 }),
    ).not.toThrow();

    // Only the top-left 6x6 of the 20x20 mask is visible; the whole image is fg.
    expectRGBNear(pixel(img, 0, 0), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    expectRGBNear(pixel(img, 5, 5), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
  });

  it("cycles a short per-mask colors array via modulo", async () => {
    const img = await makeImage(12, 12, [255, 255, 255]);
    const m0 = UserSegmentationMask.fromArray(squareMask(12, 12, 0, 0, 3, 3), 12, 12);
    const m1 = UserSegmentationMask.fromArray(squareMask(12, 12, 4, 4, 7, 7), 12, 12);
    const m2 = UserSegmentationMask.fromArray(squareMask(12, 12, 8, 8, 11, 11), 12, 12);

    // Two colors for three masks: index 2 must reuse colors[0] (modulo cycling),
    // not index out of bounds with `undefined`.
    expect(() =>
      drawMasks(img, [m0, m1, m2], {
        colors: [
          [255, 0, 0],
          [0, 0, 255],
        ],
        alpha: 0.5,
      }),
    ).not.toThrow();

    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
    expectRGBNear(pixel(img, 5, 5), blendRGB([255, 255, 255], [0, 0, 255], 0.5));
    // m2 wraps back to colors[0] = red.
    expectRGBNear(pixel(img, 9, 9), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
  });

  it("clamps an out-of-range alpha into [0, 1]", async () => {
    const high = await makeImage(8, 8, [255, 255, 255]);
    const opaque = await makeImage(8, 8, [255, 255, 255]);
    const mask = UserSegmentationMask.fromArray(squareMask(8, 8, 0, 0, 4, 4), 8, 8);

    // alpha = 2.0 must clamp to 1.0 (fully replace with the color), never
    // produce out-of-range/negative blends.
    drawMasks(high, [mask], { color: [10, 20, 30], alpha: 2.0 });
    drawMasks(opaque, [mask], { color: [10, 20, 30], alpha: 1.0 });
    expectRGBNear(pixel(high, 1, 1), [10, 20, 30]);
    expect(Array.from(high.data)).toEqual(Array.from(opaque.data));

    // alpha = -1.0 must clamp to 0.0 (no change).
    const negative = await makeImage(8, 8, [255, 255, 255]);
    drawMasks(negative, [mask], { color: [10, 20, 30], alpha: -1.0 });
    expectRGBNear(pixel(negative, 1, 1), [255, 255, 255]);
  });
});

// ===========================================================================
// drawLabelImage
// ===========================================================================

describe("drawLabelImage", () => {
  it("colors 2+ label ids from the distinct LUT and blends correctly", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    // Label 1 occupies rows 0-3 cols 0-3; label 2 occupies rows 4-7 cols 4-7.
    const data = new Int32Array(8 * 8);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) data[r * 8 + c] = 1;
    for (let r = 4; r < 8; r++) for (let c = 4; c < 8; c++) data[r * 8 + c] = 2;
    const li = UserLabelImage.fromArray(data, 8, 8);

    drawLabelImage(img, li, { alpha: 0.3, palette: "distinct" });

    // LUT: id1 -> distinct[1], id2 -> distinct[2].
    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], DISTINCT[1], 0.3));
    expectRGBNear(pixel(img, 5, 5), blendRGB([255, 255, 255], DISTINCT[2], 0.3));
    // Background (label 0) untouched.
    expectRGBNear(pixel(img, 7, 0), [255, 255, 255]);
  });

  it("leaves background (label 0) untouched", async () => {
    const img = await makeImage(6, 6, [12, 34, 56]);
    const data = new Int32Array(6 * 6);
    data[0] = 1; // single fg pixel
    const li = UserLabelImage.fromArray(data, 6, 6);

    drawLabelImage(img, li, { alpha: 0.5 });

    // Pixel 0 changed; all others remain the original background.
    expectRGBNear(pixel(img, 1, 0), [12, 34, 56]);
    expectRGBNear(pixel(img, 5, 5), [12, 34, 56]);
  });

  it("does not change pixels when outline=false", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    const data = new Int32Array(8 * 8);
    for (let r = 2; r < 6; r++) for (let c = 2; c < 6; c++) data[r * 8 + c] = 1;
    const li = UserLabelImage.fromArray(data, 8, 8);

    drawLabelImage(img, li, { alpha: 0.3, outline: false });

    // Interior and boundary pixels are both the plain fill (no darkened edge).
    const fill = blendRGB([255, 255, 255], DISTINCT[1], 0.3);
    expectRGBNear(pixel(img, 4, 4), fill); // interior
    expectRGBNear(pixel(img, 2, 2), fill); // boundary, but no outline applied
  });

  it("paints a darkened per-label outline when outline=true", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    const data = new Int32Array(8 * 8);
    for (let r = 2; r < 6; r++) for (let c = 2; c < 6; c++) data[r * 8 + c] = 1;
    const li = UserLabelImage.fromArray(data, 8, 8);

    drawLabelImage(img, li, { alpha: 0.3, outline: true });

    // The boundary pixel is the darkened LUT color (lut * 0.6), not the fill.
    const dark: [number, number, number] = [
      Math.trunc(DISTINCT[1][0] * 0.6),
      Math.trunc(DISTINCT[1][1] * 0.6),
      Math.trunc(DISTINCT[1][2] * 0.6),
    ];
    expectRGBNear(pixel(img, 2, 2), dark);
    // The deep interior pixel (no neighbor differs) keeps the plain fill.
    const fill = blendRGB([255, 255, 255], DISTINCT[1], 0.3);
    expectRGBNear(pixel(img, 4, 4), fill);
  });

  it("uses a uniform outlineColor when provided", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    const data = new Int32Array(8 * 8);
    for (let r = 2; r < 6; r++) for (let c = 2; c < 6; c++) data[r * 8 + c] = 1;
    const li = UserLabelImage.fromArray(data, 8, 8);

    drawLabelImage(img, li, {
      alpha: 0.3,
      outline: true,
      outlineColor: [0, 0, 0],
    });

    // Boundary pixel painted solid black (the uniform outline color).
    expectRGBNear(pixel(img, 2, 2), [0, 0, 0]);
  });

  it("makes a thicker outline when outlineWidth > 1 (dilation)", async () => {
    const buildOutlined = async (
      width: number,
    ): Promise<ImageData> => {
      const img = await makeImage(12, 12, [255, 255, 255]);
      const data = new Int32Array(12 * 12);
      for (let r = 3; r < 9; r++) for (let c = 3; c < 9; c++) data[r * 12 + c] = 1;
      const li = UserLabelImage.fromArray(data, 12, 12);
      drawLabelImage(img, li, {
        alpha: 0.3,
        outline: true,
        outlineColor: [0, 0, 0],
        outlineWidth: width,
      });
      return img;
    };

    const thin = await buildOutlined(1);
    const thick = await buildOutlined(3);

    const countBlack = (img: ImageData): number => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] === 0 && img.data[i + 1] === 0 && img.data[i + 2] === 0) {
          n++;
        }
      }
      return n;
    };

    // A wider outline dilates the edge mask, painting strictly more black pixels.
    expect(countBlack(thick)).toBeGreaterThan(countBlack(thin));
  });

  it("honors a scale spatial transform for placement", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    // 4x4 label data, scale 2 -> image extent 2x2. Fill all of it with label 1.
    const data = new Int32Array(4 * 4).fill(1);
    const li = new UserLabelImage({ data, height: 4, width: 4, scale: [2, 2] });
    expect(li.imageExtent).toEqual({ height: 2, width: 2 });

    drawLabelImage(img, li, { alpha: 0.5, palette: "distinct" });

    const fill = blendRGB([255, 255, 255], DISTINCT[1], 0.5);
    expectRGBNear(pixel(img, 0, 0), fill);
    expectRGBNear(pixel(img, 1, 1), fill);
    // Outside the 2x2 image extent: untouched.
    expectRGBNear(pixel(img, 5, 5), [255, 255, 255]);
  });

  it("honors an offset spatial transform for placement", async () => {
    const img = await makeImage(10, 10, [255, 255, 255]);
    const data = new Int32Array(3 * 3).fill(1);
    const li = new UserLabelImage({ data, height: 3, width: 3, offset: [4, 5] });

    drawLabelImage(img, li, { alpha: 0.5, palette: "distinct" });

    const fill = blendRGB([255, 255, 255], DISTINCT[1], 0.5);
    // Offset (ox=4, oy=5) -> rows 5-7, cols 4-6.
    expectRGBNear(pixel(img, 4, 5), fill);
    expectRGBNear(pixel(img, 6, 7), fill);
    expectRGBNear(pixel(img, 0, 0), [255, 255, 255]);
  });

  it("accepts a RawLabelImage with explicit scale/offset overrides", async () => {
    const img = await makeImage(10, 10, [255, 255, 255]);
    const raw: RawLabelImage = {
      data: new Int32Array(3 * 3).fill(1),
      height: 3,
      width: 3,
    };
    drawLabelImage(img, raw, {
      alpha: 0.5,
      palette: "distinct",
      offset: [2, 2],
    });
    const fill = blendRGB([255, 255, 255], DISTINCT[1], 0.5);
    expectRGBNear(pixel(img, 2, 2), fill);
    expectRGBNear(pixel(img, 0, 0), [255, 255, 255]);
  });

  it("is a no-op when there is no foreground", async () => {
    const img = await makeImage(6, 6, [9, 9, 9]);
    const before = Array.from(img.data);
    const li = UserLabelImage.fromArray(new Int32Array(36), 6, 6);
    drawLabelImage(img, li, { alpha: 0.5 });
    expect(Array.from(img.data)).toEqual(before);
  });

  it("wraps label IDs beyond the palette size using modulo", async () => {
    const n = DISTINCT.length; // 20 for "distinct"
    const img = await makeImage(10, 10, [255, 255, 255]);
    const data = new Int32Array(10 * 10);
    data[0 * 10 + 1] = 1; // label 1 -> distinct[1]
    data[5 * 10 + 0] = n + 1; // label (n+1) wraps to distinct[(n+1) % n] = distinct[1]
    const li = UserLabelImage.fromArray(data, 10, 10);

    drawLabelImage(img, li, { alpha: 0.5, palette: "distinct" });

    // Both pixels map to distinct[1], so they must blend to the same color.
    const c1 = pixel(img, 1, 0);
    const cWrap = pixel(img, 0, 5);
    expectRGBNear(c1, blendRGB([255, 255, 255], DISTINCT[1], 0.5));
    expectRGBNear(cWrap, c1);
  });

  it("honors a negative offset (clips on the top/left boundary)", async () => {
    const img = await makeImage(10, 10, [255, 255, 255]);
    const data = new Int32Array(4 * 4).fill(1);
    const li = new UserLabelImage({
      data,
      height: 4,
      width: 4,
      offset: [-2, -2],
    });

    drawLabelImage(img, li, { alpha: 0.5, palette: "distinct" });

    const fill = blendRGB([255, 255, 255], DISTINCT[1], 0.5);
    // The bottom-right 2x2 of the label lands at image (0,0)-(1,1).
    expectRGBNear(pixel(img, 0, 0), fill);
    expectRGBNear(pixel(img, 1, 1), fill);
    // Beyond the placed window (label ends at image (1,1)): untouched.
    expectRGBNear(pixel(img, 3, 3), [255, 255, 255]);
  });
});

// ===========================================================================
// drawBboxes
// ===========================================================================

describe("drawBboxes", () => {
  it("draws an axis-aligned box outline (edge pixels colored)", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const bbox = UserBoundingBox.fromXyxy(10, 10, 30, 30);

    drawBboxes(img, [bbox], { color: [255, 0, 0], lineWidth: 2 });

    // Some pixel on the top edge (y ~ 10) is colored (not white).
    let edgeColored = false;
    for (let x = 11; x < 29; x++) {
      const [r, g, b] = pixel(img, x, 10);
      if (r !== 255 || g !== 255 || b !== 255) {
        edgeColored = true;
        break;
      }
    }
    expect(edgeColored).toBe(true);

    // Box interior center stays white (no fill by default).
    expectRGBNear(pixel(img, 20, 20), [255, 255, 255]);
  });

  it("fills the interior when fillAlpha > 0", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const bbox = UserBoundingBox.fromXyxy(10, 10, 30, 30);

    drawBboxes(img, [bbox], { color: [255, 0, 0], fillAlpha: 0.5 });

    // Center pixel is now tinted toward red (fill applied).
    const [r, g, b] = pixel(img, 20, 20);
    expect(r).toBeGreaterThan(200); // red-ish
    expect(g).toBeLessThan(230); // greens/blues pulled down
    expect(b).toBeLessThan(230);
  });

  it("draws a rotated box (corners differ from axis-aligned)", async () => {
    const img = await makeImage(60, 60, [255, 255, 255]);
    const bbox = new UserBoundingBox({
      x1: 20,
      y1: 20,
      x2: 40,
      y2: 40,
      angle: Math.PI / 4, // 45 degrees
    });

    expect(() => drawBboxes(img, [bbox], { color: [0, 0, 255] })).not.toThrow();

    // A rotated square reaches a corner directly above its center (~30, 16)
    // where an axis-aligned box would have nothing. Just confirm something is
    // drawn somewhere off the axis-aligned edges.
    let anyColored = false;
    for (let y = 10; y < 50 && !anyColored; y++) {
      for (let x = 10; x < 50; x++) {
        const [r, g, b] = pixel(img, x, y);
        if (b > r && b > g) {
          anyColored = true;
          break;
        }
      }
    }
    expect(anyColored).toBe(true);
  });

  it("draws score text near the corner for a PredictedBoundingBox", async () => {
    const plain = await makeImage(60, 40, [255, 255, 255]);
    const predicted = await makeImage(60, 40, [255, 255, 255]);

    const userBox = UserBoundingBox.fromXyxy(15, 20, 45, 35);
    const predBox = new PredictedBoundingBox({
      x1: 15,
      y1: 20,
      x2: 45,
      y2: 35,
      score: 0.91,
    });

    drawBboxes(plain, [userBox], { color: [0, 128, 0] });
    drawBboxes(predicted, [predBox], { color: [0, 128, 0] });

    // The score text is drawn above the top-left corner (~y=20-5=15). Count
    // non-white pixels in the band above the box top; the predicted box must
    // have strictly more (the rendered "0.91" glyphs).
    const countAbove = (img: ImageData): number => {
      let n = 0;
      for (let y = 5; y < 19; y++) {
        for (let x = 12; x < 50; x++) {
          const [r, g, b] = pixel(img, x, y);
          if (r !== 255 || g !== 255 || b !== 255) n++;
        }
      }
      return n;
    };

    expect(countAbove(predicted)).toBeGreaterThan(countAbove(plain));
  });

  it("uses per-bbox colors when provided", async () => {
    const img = await makeImage(80, 40, [255, 255, 255]);
    const b0 = UserBoundingBox.fromXyxy(5, 5, 25, 35);
    const b1 = UserBoundingBox.fromXyxy(50, 5, 70, 35);

    drawBboxes(img, [b0, b1], {
      colors: [
        [255, 0, 0],
        [0, 0, 255],
      ],
      lineWidth: 3,
    });

    // Find a red-dominant pixel near the first box and a blue-dominant pixel
    // near the second.
    const hasColor = (
      x0: number,
      x1: number,
      pred: (r: number, g: number, b: number) => boolean,
    ): boolean => {
      for (let y = 5; y < 36; y++) {
        for (let x = x0; x < x1; x++) {
          const [r, g, b] = pixel(img, x, y);
          if (pred(r, g, b)) return true;
        }
      }
      return false;
    };

    expect(hasColor(4, 27, (r, g, b) => r > 150 && g < 100 && b < 100)).toBe(true);
    expect(hasColor(48, 72, (r, g, b) => b > 150 && r < 100 && g < 100)).toBe(true);
  });

  it("is a no-op for an empty bbox list", async () => {
    const img = await makeImage(10, 10, [3, 4, 5]);
    const before = Array.from(img.data);
    drawBboxes(img, []);
    expect(Array.from(img.data)).toEqual(before);
  });
});

// ===========================================================================
// drawRois
// ===========================================================================

describe("drawRois", () => {
  it("draws a polygon outline", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const roi = UserROI.fromPolygon([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);

    drawRois(img, [roi], { color: [255, 0, 0], lineWidth: 2 });

    // An edge pixel along the top is colored.
    let edgeColored = false;
    for (let x = 11; x < 29; x++) {
      const [r, g, b] = pixel(img, x, 10);
      if (r !== 255 || g !== 255 || b !== 255) {
        edgeColored = true;
        break;
      }
    }
    expect(edgeColored).toBe(true);
  });

  it("cuts a hole using the even-odd fill rule", async () => {
    const img = await makeImage(50, 50, [255, 255, 255]);
    // Outer ring + inner hole ring.
    const roi = new UserROI({
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [5, 5],
            [45, 5],
            [45, 45],
            [5, 45],
            [5, 5],
          ],
          [
            [18, 18],
            [32, 18],
            [32, 32],
            [18, 32],
            [18, 18],
          ],
        ],
      },
    });

    drawRois(img, [roi], { color: [255, 0, 0], fillAlpha: 0.6 });

    // Between outer and inner ring: filled (red-ish, not white).
    const [or, og, ob] = pixel(img, 10, 25);
    expect(or > og || or > ob).toBe(true);
    expect(or !== 255 || og !== 255 || ob !== 255).toBe(true);

    // Inside the hole: NOT filled -> still white.
    expectRGBNear(pixel(img, 25, 25), [255, 255, 255]);
  });

  it("draws a filled dot for a Point geometry", async () => {
    const img = await makeImage(30, 30, [255, 255, 255]);
    const roi = new UserROI({ geometry: { type: "Point", coordinates: [15, 15] } });

    drawRois(img, [roi], { color: [0, 0, 255], lineWidth: 4 });

    // Center of the point is colored blue.
    const [r, g, b] = pixel(img, 15, 15);
    expect(b).toBeGreaterThan(150);
    expect(r).toBeLessThan(100);
  });

  it("draws a line for a LineString geometry", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const roi = new UserROI({
      geometry: {
        type: "LineString",
        coordinates: [
          [5, 20],
          [35, 20],
        ],
      },
    });

    drawRois(img, [roi], { color: [255, 0, 0], lineWidth: 2 });

    // Midpoint of the horizontal line is colored.
    const [r, g, b] = pixel(img, 20, 20);
    expect(r !== 255 || g !== 255 || b !== 255).toBe(true);
  });

  it("draws each polygon of a MultiPolygon", async () => {
    const img = await makeImage(60, 40, [255, 255, 255]);
    const roi = new UserROI({
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [5, 5],
              [20, 5],
              [20, 20],
              [5, 20],
              [5, 5],
            ],
          ],
          [
            [
              [35, 15],
              [55, 15],
              [55, 35],
              [35, 35],
              [35, 15],
            ],
          ],
        ],
      },
    });

    drawRois(img, [roi], { color: [0, 128, 0], fillAlpha: 0.5 });

    // Both polygon interiors are filled (greenish, not white).
    const a = pixel(img, 12, 12);
    const b = pixel(img, 45, 25);
    expect(a[0] !== 255 || a[1] !== 255 || a[2] !== 255).toBe(true);
    expect(b[0] !== 255 || b[1] !== 255 || b[2] !== 255).toBe(true);
  });

  it("fills a polygon interior when fillAlpha > 0", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const filled = UserROI.fromPolygon([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);

    drawRois(img, [filled], { color: [255, 0, 0], fillAlpha: 0.5 });

    // Interior is now tinted (not white).
    const [r, g, b] = pixel(img, 20, 20);
    expect(r !== 255 || g !== 255 || b !== 255).toBe(true);
  });

  it("draws each point of a MultiPoint geometry", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const roi = new UserROI({
      geometry: {
        type: "MultiPoint",
        coordinates: [
          [10, 10],
          [30, 30],
        ],
      },
    });

    drawRois(img, [roi], { color: [0, 0, 255], lineWidth: 4 });

    // Both point centers are filled blue.
    for (const [x, y] of [
      [10, 10],
      [30, 30],
    ]) {
      const [r, g, b] = pixel(img, x, y);
      expect(b).toBeGreaterThan(150);
      expect(r).toBeLessThan(100);
    }
  });

  it("draws each member of a GeometryCollection (Point + LineString)", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const roi = new UserROI({
      geometry: {
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [10, 10] },
          {
            type: "LineString",
            coordinates: [
              [5, 30],
              [35, 30],
            ],
          },
        ],
      },
    });

    drawRois(img, [roi], { color: [255, 0, 0], lineWidth: 3 });

    // The point center is drawn.
    {
      const [r, g, b] = pixel(img, 10, 10);
      expect(r !== 255 || g !== 255 || b !== 255).toBe(true);
    }
    // The line midpoint is drawn.
    {
      const [r, g, b] = pixel(img, 20, 30);
      expect(r !== 255 || g !== 255 || b !== 255).toBe(true);
    }
  });

  it("is a no-op for an empty roi list", async () => {
    const img = await makeImage(10, 10, [7, 8, 9]);
    const before = Array.from(img.data);
    drawRois(img, []);
    expect(Array.from(img.data)).toEqual(before);
  });
});

// ===========================================================================
// applyOverlay dispatcher
// ===========================================================================

describe("applyOverlay", () => {
  it("dispatches a single LabelImage to the label-image raster path", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    const data = new Int32Array(8 * 8);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) data[r * 8 + c] = 1;
    const li = UserLabelImage.fromArray(data, 8, 8);

    applyOverlay(img, li, { alpha: 0.3, palette: "distinct" });

    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], DISTINCT[1], 0.3));
    expectRGBNear(pixel(img, 7, 7), [255, 255, 255]);
  });

  it("dispatches a SegmentationMask[] with per-item palette colors", async () => {
    const img = await makeImage(12, 12, [255, 255, 255]);
    const m0 = UserSegmentationMask.fromArray(squareMask(12, 12, 0, 0, 4, 4), 12, 12);
    const m1 = UserSegmentationMask.fromArray(squareMask(12, 12, 6, 6, 10, 10), 12, 12);

    applyOverlay(img, [m0, m1], { alpha: 0.4, palette: "distinct" });

    // Per-item colors from getPalette("distinct", 2): [0] and [1].
    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], DISTINCT[0], 0.4));
    expectRGBNear(pixel(img, 7, 7), blendRGB([255, 255, 255], DISTINCT[1], 0.4));
  });

  it("dispatches an ROI[] to the vector path", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const roi = UserROI.fromPolygon([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);

    applyOverlay(img, [roi], { alpha: 0.5, palette: "distinct" });

    // Polygon edge colored somewhere on the top edge.
    let edgeColored = false;
    for (let x = 11; x < 29; x++) {
      const [r, g, b] = pixel(img, x, 10);
      if (r !== 255 || g !== 255 || b !== 255) {
        edgeColored = true;
        break;
      }
    }
    expect(edgeColored).toBe(true);
  });

  it("dispatches a BoundingBox[] to the vector path", async () => {
    const img = await makeImage(40, 40, [255, 255, 255]);
    const bbox = UserBoundingBox.fromXyxy(10, 10, 30, 30);

    applyOverlay(img, [bbox], { alpha: 0.5, palette: "distinct" });

    let edgeColored = false;
    for (let x = 11; x < 29; x++) {
      const [r, g, b] = pixel(img, x, 10);
      if (r !== 255 || g !== 255 || b !== 255) {
        edgeColored = true;
        break;
      }
    }
    expect(edgeColored).toBe(true);
  });

  it("throws a TypeError for a list[LabelImage]", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    const li = UserLabelImage.fromArray(new Int32Array(64).fill(1), 8, 8);
    // Cast through unknown: the public type forbids LabelImage[], but the
    // runtime guard must still reject it (per-frame dispatch belongs to video).
    expect(() =>
      applyOverlay(img, [li] as unknown as Parameters<typeof applyOverlay>[1]),
    ).toThrow(TypeError);
  });

  it("throws a TypeError for an unknown element type", async () => {
    const img = await makeImage(8, 8, [255, 255, 255]);
    expect(() =>
      applyOverlay(
        img,
        [{ foo: "bar" }] as unknown as Parameters<typeof applyOverlay>[1],
      ),
    ).toThrow(TypeError);
  });

  it("is a no-op for an empty overlay list", async () => {
    const img = await makeImage(6, 6, [1, 2, 3]);
    const before = Array.from(img.data);
    applyOverlay(img, [] as SegmentationMask[]);
    expect(Array.from(img.data)).toEqual(before);
  });

  it("uses an explicit colors override over the positional palette (PR #470)", async () => {
    const img = await makeImage(12, 12, [255, 255, 255]);
    const m0 = UserSegmentationMask.fromArray(squareMask(12, 12, 0, 0, 4, 4), 12, 12);
    const m1 = UserSegmentationMask.fromArray(squareMask(12, 12, 6, 6, 10, 10), 12, 12);

    // Override colors: element 0 -> blue, element 1 -> red (NOT the distinct
    // palette order). This proves the override wins over getPalette positional.
    applyOverlay(img, [m0, m1], {
      alpha: 0.5,
      palette: "distinct",
      colors: [
        [0, 0, 255],
        [255, 0, 0],
      ],
    });

    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], [0, 0, 255], 0.5));
    expectRGBNear(pixel(img, 7, 7), blendRGB([255, 255, 255], [255, 0, 0], 0.5));
  });

  it("falls back to the positional palette when colors is omitted/null (PR #470)", async () => {
    const img = await makeImage(12, 12, [255, 255, 255]);
    const m0 = UserSegmentationMask.fromArray(squareMask(12, 12, 0, 0, 4, 4), 12, 12);
    const m1 = UserSegmentationMask.fromArray(squareMask(12, 12, 6, 6, 10, 10), 12, 12);

    applyOverlay(img, [m0, m1], { alpha: 0.4, palette: "distinct", colors: null });

    // Same as the default-palette dispatch above: [0] then [1].
    expectRGBNear(pixel(img, 1, 1), blendRGB([255, 255, 255], DISTINCT[0], 0.4));
    expectRGBNear(pixel(img, 7, 7), blendRGB([255, 255, 255], DISTINCT[1], 0.4));
  });
});

// ===========================================================================
// renderImage integration
// ===========================================================================

describe("renderImage with overlay", () => {
  function createVideo(): Video {
    return new Video({ filename: "overlay-test.mp4" });
  }

  it("applies a mask overlay beneath the poses", async () => {
    const skeleton = createTestSkeleton();
    // Pose node at (5, 5) so its marker pixel keeps the pose color on top.
    const instance = new Instance({
      points: { head: [5, 5], tail: [25, 25] },
      skeleton,
    });

    // Mask covering a different region (rows/cols 12-20) that the pose does not
    // touch, so we can assert the blended overlay color there.
    const mask = UserSegmentationMask.fromArray(
      squareMask(40, 40, 12, 12, 20, 20),
      40,
      40,
    );

    const img = await renderImage([instance], {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      overlay: [mask],
      overlayAlpha: 0.5,
      overlayPalette: "distinct",
      showEdges: false,
      showNodes: true,
      markerSize: 3,
    });

    // Mask-only region: white blended toward distinct[0] at 0.5.
    expectRGBNear(
      pixel(img, 15, 15),
      blendRGB([255, 255, 255], DISTINCT[0], 0.5),
      4,
    );

    // Pose marker region near (5,5): NOT white and NOT the mask color (a pose
    // node was drawn on top). Just confirm the pixel was painted by the pose.
    let poseColored = false;
    for (let y = 3; y < 8 && !poseColored; y++) {
      for (let x = 3; x < 8; x++) {
        const [r, g, b] = pixel(img, x, y);
        if (r !== 255 || g !== 255 || b !== 255) {
          poseColored = true;
          break;
        }
      }
    }
    expect(poseColored).toBe(true);
  });

  it("respects overlayAlpha", async () => {
    const skeleton = createTestSkeleton();
    const instance = new Instance({
      points: { head: [2, 2], tail: [4, 4] },
      skeleton,
    });
    const mask = UserSegmentationMask.fromArray(
      squareMask(30, 30, 15, 15, 25, 25),
      30,
      30,
    );

    const lowAlpha = await renderImage([instance], {
      width: 30,
      height: 30,
      background: [255, 255, 255],
      overlay: [mask],
      overlayAlpha: 0.2,
      overlayPalette: "distinct",
      showNodes: false,
      showEdges: false,
    });
    const highAlpha = await renderImage([instance], {
      width: 30,
      height: 30,
      background: [255, 255, 255],
      overlay: [mask],
      overlayAlpha: 0.8,
      overlayPalette: "distinct",
      showNodes: false,
      showEdges: false,
    });

    expectRGBNear(
      pixel(lowAlpha, 20, 20),
      blendRGB([255, 255, 255], DISTINCT[0], 0.2),
      4,
    );
    expectRGBNear(
      pixel(highAlpha, 20, 20),
      blendRGB([255, 255, 255], DISTINCT[0], 0.8),
      4,
    );
    // Higher alpha pulls the green channel further from white.
    expect(pixel(highAlpha, 20, 20)[1]).toBeLessThan(pixel(lowAlpha, 20, 20)[1]);
  });

  it("renders a segmentation-only LabeledFrame (no instances) without throwing", async () => {
    const video = createVideo();
    const mask = UserSegmentationMask.fromArray(
      squareMask(40, 40, 10, 10, 25, 25),
      40,
      40,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [],
      masks: [mask],
    });

    const img = await renderImage(frame, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      overlay: [mask],
      overlayAlpha: 0.5,
      overlayPalette: "distinct",
    });

    expect(img.width).toBe(40);
    expectRGBNear(
      pixel(img, 15, 15),
      blendRGB([255, 255, 255], DISTINCT[0], 0.5),
      4,
    );
  });

  it("applies a LabelImage overlay passed directly", async () => {
    const video = createVideo();
    const data = new Int32Array(30 * 30);
    for (let r = 5; r < 20; r++) for (let c = 5; c < 20; c++) data[r * 30 + c] = 1;
    const li = UserLabelImage.fromArray(data, 30, 30);
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [],
      labelImages: [li],
    });

    const img = await renderImage(frame, {
      width: 30,
      height: 30,
      background: [255, 255, 255],
      overlay: li,
      overlayAlpha: 0.4,
      overlayPalette: "distinct",
    });

    expectRGBNear(
      pixel(img, 10, 10),
      blendRGB([255, 255, 255], DISTINCT[1], 0.4),
      4,
    );
  });

  // -------------------------------------------------------------------------
  // PR #462: auto-draw lf.masks when no overlay is passed
  // -------------------------------------------------------------------------

  it("auto-draws lf.masks when no overlay option is given (PR #462)", async () => {
    const video = createVideo();
    const mask = UserSegmentationMask.fromArray(
      squareMask(40, 40, 10, 10, 25, 25),
      40,
      40,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [],
      masks: [mask],
    });

    // NOTE: no `overlay` option — masks must be auto-resolved from lf.masks.
    const img = await renderImage(frame, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      overlayAlpha: 0.5,
      overlayPalette: "distinct",
    });

    // Masked region blended toward distinct[0]; background untouched.
    expectRGBNear(
      pixel(img, 15, 15),
      blendRGB([255, 255, 255], DISTINCT[0], 0.5),
      4,
    );
    expectRGBNear(pixel(img, 0, 0), [255, 255, 255]);
  });

  it("auto-draws lf.masks for a Labels source via the first frame (PR #462)", async () => {
    const video = createVideo();
    const mask = UserSegmentationMask.fromArray(
      squareMask(40, 40, 12, 12, 20, 20),
      40,
      40,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [],
      masks: [mask],
    });
    const labels = new Labels({ labeledFrames: [frame] });

    const img = await renderImage(labels, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      overlayAlpha: 0.5,
      overlayPalette: "distinct",
    });

    expectRGBNear(
      pixel(img, 15, 15),
      blendRGB([255, 255, 255], DISTINCT[0], 0.5),
      4,
    );
  });

  it("explicit overlay still wins over lf.masks (PR #462)", async () => {
    const video = createVideo();
    // lf carries maskA (region rows/cols 2-8), but the explicit overlay draws
    // maskB (region 12-18). Only the explicit one should be drawn.
    const maskA = UserSegmentationMask.fromArray(
      squareMask(20, 20, 2, 2, 8, 8),
      20,
      20,
    );
    const maskB = UserSegmentationMask.fromArray(
      squareMask(20, 20, 12, 12, 18, 18),
      20,
      20,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [],
      masks: [maskA],
    });

    const img = await renderImage(frame, {
      width: 20,
      height: 20,
      background: [255, 255, 255],
      overlay: [maskB],
      overlayAlpha: 0.5,
    });

    // Explicit maskB region is blended; the lf.masks (maskA) region is NOT.
    expectRGBNear(
      pixel(img, 15, 15),
      blendRGB([255, 255, 255], DISTINCT[0], 0.5),
      4,
    );
    expectRGBNear(pixel(img, 4, 4), [255, 255, 255]);
  });

  it("does not auto-draw when the frame has no masks (PR #462)", async () => {
    const video = createVideo();
    const skeleton = createTestSkeleton();
    const instance = new Instance({
      points: { head: [5, 5], tail: [15, 15] },
      skeleton,
    });
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instance],
      masks: [],
    });

    const img = await renderImage(frame, {
      width: 20,
      height: 20,
      background: [255, 255, 255],
      showNodes: false,
      showEdges: false,
    });

    // No masks -> nothing to auto-draw; the whole background stays white.
    expectRGBNear(pixel(img, 10, 10), [255, 255, 255]);
    expectRGBNear(pixel(img, 0, 0), [255, 255, 255]);
  });

  // -------------------------------------------------------------------------
  // PR #470: color overlay annotations by track identity
  // -------------------------------------------------------------------------

  it("colors masks by track identity under colorBy:'track' (PR #470)", async () => {
    const video = createVideo();
    const skeleton = createTestSkeleton();
    const trackA = new Track("A");
    const trackB = new Track("B");

    // Two tracked instances so the track index order is [trackA, trackB].
    const instA = new Instance({
      points: { head: [3, 3], tail: [5, 5] },
      skeleton,
      track: trackA,
    });
    const instB = new Instance({
      points: { head: [30, 30], tail: [32, 32] },
      skeleton,
      track: trackB,
    });

    // maskA -> trackB, maskB -> trackA: deliberately reverse the LIST order vs
    // the track order to prove coloring follows .track, not list position.
    const maskA = UserSegmentationMask.fromArray(
      squareMask(40, 40, 10, 10, 16, 16),
      40,
      40,
    );
    maskA.track = trackB;
    const maskB = UserSegmentationMask.fromArray(
      squareMask(40, 40, 22, 22, 28, 28),
      40,
      40,
    );
    maskB.track = trackA;
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instA, instB],
      masks: [maskA, maskB],
    });

    const img = await renderImage(frame, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      colorBy: "track",
      overlayAlpha: 0.5,
      // Pose palette ("standard") differs from overlayPalette ("distinct"): the
      // track-colored masks must use the POSE palette so they match the poses,
      // NOT the positional overlayPalette (PR #470). Asserting against
      // "standard" here would fail under the old overlayPalette-based coloring.
      palette: "standard",
      overlayPalette: "distinct",
      showNodes: false,
      showEdges: false,
    });

    // Track index map: trackA=0, trackB=1 (instance discovery order).
    const posePalette = getPalette("standard", 2);
    const overlayPalette = getPalette("distinct", 2);
    // maskA carries trackB (index 1); maskB carries trackA (index 0).
    expectRGBNear(
      pixel(img, 12, 12),
      blendRGB([255, 255, 255], posePalette[1], 0.5),
      4,
    );
    expectRGBNear(
      pixel(img, 24, 24),
      blendRGB([255, 255, 255], posePalette[0], 0.5),
      4,
    );
    // Guard: the mask is NOT colored from the positional overlayPalette (would
    // be the old buggy behavior). standard[1] and distinct[1] are distinct sets.
    const buggy = blendRGB([255, 255, 255], overlayPalette[1], 0.5);
    const actual = pixel(img, 12, 12);
    const dist =
      Math.abs(actual[0] - buggy[0]) +
      Math.abs(actual[1] - buggy[1]) +
      Math.abs(actual[2] - buggy[2]);
    expect(dist).toBeGreaterThan(10);
  });

  it("aligns a mask track color slot with its pose track color slot (PR #470)", async () => {
    const video = createVideo();
    const skeleton = createTestSkeleton();
    const trackA = new Track("A");
    const trackB = new Track("B");

    // Pose for trackB drawn at a node we can sample; trackA at another node.
    const instA = new Instance({
      points: { head: [3, 3], tail: [4, 4] },
      skeleton,
      track: trackA,
    });
    const instB = new Instance({
      points: { head: [35, 35], tail: [36, 36] },
      skeleton,
      track: trackB,
    });
    const maskB = UserSegmentationMask.fromArray(
      squareMask(40, 40, 20, 20, 26, 26),
      40,
      40,
    );
    maskB.track = trackB;
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instA, instB],
      masks: [maskB],
    });

    const img = await renderImage(frame, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      colorBy: "track",
      overlayAlpha: 0.5,
      overlayPalette: "distinct",
      palette: "standard",
      showNodes: true,
      showEdges: false,
      markerSize: 3,
    });

    // trackB is index 1. PR #470: the mask uses the POSE palette ("standard"),
    // NOT overlayPalette ("distinct"), so its fill is the blend of STANDARD[1]
    // — the exact track color the pose node uses (sampled below). The mask fill
    // (alpha 0.5) blends STANDARD[1] over the white background.
    expectRGBNear(
      pixel(img, 22, 22),
      blendRGB([255, 255, 255], STANDARD[1], 0.5),
      4,
    );
    // Pose node for trackB near (35,35) is opaque STANDARD[1] (alpha default 1).
    let poseColored = false;
    for (let y = 33; y < 38 && !poseColored; y++) {
      for (let x = 33; x < 38; x++) {
        const [r, g, b] = pixel(img, x, y);
        if (
          Math.abs(r - STANDARD[1][0]) <= 4 &&
          Math.abs(g - STANDARD[1][1]) <= 4 &&
          Math.abs(b - STANDARD[1][2]) <= 4
        ) {
          poseColored = true;
          break;
        }
      }
    }
    expect(poseColored).toBe(true);
  });

  it("untracked mask falls back to the first track color under colorBy:'track' (PR #470)", async () => {
    const video = createVideo();
    const skeleton = createTestSkeleton();
    const trackA = new Track("A");
    const trackB = new Track("B");
    const instA = new Instance({
      points: { head: [3, 3], tail: [4, 4] },
      skeleton,
      track: trackA,
    });
    const instB = new Instance({
      points: { head: [35, 35], tail: [36, 36] },
      skeleton,
      track: trackB,
    });
    // Mask with NO track -> should fall back to palette[0].
    const mask = UserSegmentationMask.fromArray(
      squareMask(40, 40, 18, 18, 24, 24),
      40,
      40,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instA, instB],
      masks: [mask],
    });

    const img = await renderImage(frame, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      colorBy: "track",
      overlayAlpha: 0.5,
      palette: "standard",
      overlayPalette: "distinct",
      showNodes: false,
      showEdges: false,
    });

    // Untracked -> first POSE-palette color (PR #470 colors overlays from the
    // pose palette, not overlayPalette).
    const posePalette = getPalette("standard", 2);
    expectRGBNear(
      pixel(img, 20, 20),
      blendRGB([255, 255, 255], posePalette[0], 0.5),
      4,
    );
  });

  it("keeps positional overlay coloring when scheme != track (PR #470)", async () => {
    const video = createVideo();
    const skeleton = createTestSkeleton();
    const trackA = new Track("A");
    const trackB = new Track("B");
    // Tracked instances exist, but colorBy:'instance' forces non-track scheme.
    const instA = new Instance({
      points: { head: [3, 3], tail: [4, 4] },
      skeleton,
      track: trackA,
    });
    // maskA carries trackB, maskB carries trackA: if track-coloring leaked in,
    // their colors would swap. Positional coloring must keep [0] then [1].
    const maskA = UserSegmentationMask.fromArray(
      squareMask(40, 40, 10, 10, 16, 16),
      40,
      40,
    );
    maskA.track = trackB;
    const maskB = UserSegmentationMask.fromArray(
      squareMask(40, 40, 22, 22, 28, 28),
      40,
      40,
    );
    maskB.track = trackA;
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instA],
      masks: [maskA, maskB],
    });

    const img = await renderImage(frame, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      colorBy: "instance",
      overlayAlpha: 0.5,
      overlayPalette: "distinct",
      showNodes: false,
      showEdges: false,
    });

    // Positional palette: list element 0 (maskA) -> [0], element 1 (maskB) -> [1].
    expectRGBNear(
      pixel(img, 12, 12),
      blendRGB([255, 255, 255], DISTINCT[0], 0.5),
      4,
    );
    expectRGBNear(
      pixel(img, 24, 24),
      blendRGB([255, 255, 255], DISTINCT[1], 0.5),
      4,
    );
  });

  it("forced colorBy:'track' with no tracks stays positional (PR #470 guard)", async () => {
    const video = createVideo();
    const skeleton = createTestSkeleton();
    // Instances and masks, but NO tracks anywhere. Forcing colorBy:'track'
    // must NOT collapse every mask onto the first color — it falls back to
    // positional overlayPalette coloring (mirrors Python's has_tracks gate).
    const inst = new Instance({ points: { head: [3, 3], tail: [4, 4] }, skeleton });
    const maskA = UserSegmentationMask.fromArray(
      squareMask(40, 40, 10, 10, 16, 16),
      40,
      40,
    );
    const maskB = UserSegmentationMask.fromArray(
      squareMask(40, 40, 22, 22, 28, 28),
      40,
      40,
    );
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      masks: [maskA, maskB],
    });

    const img = await renderImage(frame, {
      width: 40,
      height: 40,
      background: [255, 255, 255],
      colorBy: "track",
      overlayAlpha: 0.5,
      overlayPalette: "distinct",
      showNodes: false,
      showEdges: false,
    });

    // Positional overlayPalette: maskA -> [0], maskB -> [1] (NOT both [0]).
    expectRGBNear(pixel(img, 12, 12), blendRGB([255, 255, 255], DISTINCT[0], 0.5), 4);
    expectRGBNear(pixel(img, 24, 24), blendRGB([255, 255, 255], DISTINCT[1], 0.5), 4);
  });
});

// ===========================================================================
// renderVideo per-frame overlay (smoke-level; ffmpeg-gated)
// ===========================================================================

describe("renderVideo per-frame overlay", () => {
  function frameWithMask(
    video: Video,
    frameIdx: number,
    block: [number, number, number, number],
  ): LabeledFrame {
    const mask = UserSegmentationMask.fromArray(
      squareMask(20, 20, block[0], block[1], block[2], block[3]),
      20,
      20,
    );
    return new LabeledFrame({ video, frameIdx, instances: [], masks: [mask] });
  }

  it("renders frames with a static overlay applied to every frame", async () => {
    const { checkFfmpeg } = await import("../../src/rendering/video");
    if (!(await checkFfmpeg())) return; // skip when ffmpeg unavailable

    const video = new Video({ filename: "v.mp4" });
    const f0 = frameWithMask(video, 0, [2, 2, 8, 8]);
    const f1 = frameWithMask(video, 1, [2, 2, 8, 8]);
    const staticMask = UserSegmentationMask.fromArray(
      squareMask(20, 20, 10, 10, 18, 18),
      20,
      20,
    );

    const tmp = `/tmp/overlay-static-${Date.now()}.mp4`;
    await expect(
      renderVideo([f0, f1], tmp, {
        width: 20,
        height: 20,
        background: [255, 255, 255],
        overlay: [staticMask],
        overlayAlpha: 0.5,
      }),
    ).resolves.toBeUndefined();

    const fs = await import("node:fs");
    expect(fs.existsSync(tmp)).toBe(true);
    fs.unlinkSync(tmp);
  });

  it("renders frames with a callable overlay differing per frame", async () => {
    const { checkFfmpeg } = await import("../../src/rendering/video");
    if (!(await checkFfmpeg())) return; // skip when ffmpeg unavailable

    const video = new Video({ filename: "v.mp4" });
    const maskA = UserSegmentationMask.fromArray(
      squareMask(20, 20, 1, 1, 6, 6),
      20,
      20,
    );
    const maskB = UserSegmentationMask.fromArray(
      squareMask(20, 20, 12, 12, 18, 18),
      20,
      20,
    );
    // Attach the per-frame masks to each frame so renderImage has something to
    // render (the empty-frame guard is annotation-aware). The callable overlay
    // independently selects which mask to draw per frame index.
    const f0 = new LabeledFrame({ video, frameIdx: 0, instances: [], masks: [maskA] });
    const f1 = new LabeledFrame({ video, frameIdx: 1, instances: [], masks: [maskB] });
    const overlayFn = (frameIdx: number): SegmentationMask[] =>
      frameIdx === 0 ? [maskA] : [maskB];

    const tmp = `/tmp/overlay-callable-${Date.now()}.mp4`;
    await expect(
      renderVideo([f0, f1], tmp, {
        width: 20,
        height: 20,
        background: [255, 255, 255],
        overlay: overlayFn,
        overlayAlpha: 0.5,
      }),
    ).resolves.toBeUndefined();

    const fs = await import("node:fs");
    expect(fs.existsSync(tmp)).toBe(true);
    fs.unlinkSync(tmp);
  });

  it("renders single-frame outputs that differ between two distinct overlays", async () => {
    // ffmpeg-independent: compare the underlying renderImage output the video
    // path uses per frame, so the assertion of "differs per frame" holds even
    // without ffmpeg installed.
    const video = new Video({ filename: "v.mp4" });
    const maskA = UserSegmentationMask.fromArray(
      squareMask(20, 20, 1, 1, 6, 6),
      20,
      20,
    );
    const maskB = UserSegmentationMask.fromArray(
      squareMask(20, 20, 12, 12, 18, 18),
      20,
      20,
    );
    // Carry an annotation so the empty-frame guard passes; the explicit overlay
    // option is what actually drives the blended pixels below.
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [],
      masks: [maskA, maskB],
    });

    const imgA = await renderImage(frame, {
      width: 20,
      height: 20,
      background: [255, 255, 255],
      overlay: [maskA],
      overlayAlpha: 0.5,
    });
    const imgB = await renderImage(frame, {
      width: 20,
      height: 20,
      background: [255, 255, 255],
      overlay: [maskB],
      overlayAlpha: 0.5,
    });

    expect(Array.from(imgA.data)).not.toEqual(Array.from(imgB.data));
    // maskA region tinted in A, white in B; vice versa for maskB region.
    expectRGBNear(pixel(imgA, 3, 3), blendRGB([255, 255, 255], DISTINCT[0], 0.5), 4);
    expectRGBNear(pixel(imgB, 3, 3), [255, 255, 255]);
    expectRGBNear(pixel(imgB, 15, 15), blendRGB([255, 255, 255], DISTINCT[0], 0.5), 4);
    expectRGBNear(pixel(imgA, 15, 15), [255, 255, 255]);
  });

  it("auto-detects masks for a Labels source when no overlay is passed (PR #462)", async () => {
    const { checkFfmpeg } = await import("../../src/rendering/video");
    if (!(await checkFfmpeg())) return; // skip when ffmpeg unavailable

    const video = new Video({ filename: "v.mp4" });
    const f0 = frameWithMask(video, 0, [2, 2, 8, 8]);
    const f1 = frameWithMask(video, 1, [10, 10, 18, 18]);
    const labels = new Labels({ labeledFrames: [f0, f1] });

    // No `overlay` option: renderVideo must auto-resolve masks per frame via
    // Labels.getMasks({ video, frameIdx }).
    const tmp = `/tmp/overlay-auto-masks-${Date.now()}.mp4`;
    await expect(
      renderVideo(labels, tmp, {
        width: 20,
        height: 20,
        background: [255, 255, 255],
        overlayAlpha: 0.5,
      }),
    ).resolves.toBeUndefined();

    const fs = await import("node:fs");
    expect(fs.existsSync(tmp)).toBe(true);
    fs.unlinkSync(tmp);
  });
});
