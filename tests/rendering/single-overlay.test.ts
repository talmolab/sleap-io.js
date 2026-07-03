// Tests for sleap-io PR #505 parity: applyOverlay (and thus renderImage's
// `overlay=`) accepts a SINGLE SegmentationMask / ROI / BoundingBox, not just a
// list. Previously a bare object fell through and was silently dropped.

import { describe, it, expect } from "../bun-test";
import { applyOverlay } from "../../src/rendering/overlays";
import { UserSegmentationMask } from "../../src/model/mask";
import { UserROI } from "../../src/model/roi";
import { UserBoundingBox } from "../../src/model/bbox";
import { UserLabelImage } from "../../src/model/label-image";

async function makeImage(
  w: number,
  h: number,
  fill: [number, number, number] = [0, 0, 0],
): Promise<ImageData> {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${fill[0]}, ${fill[1]}, ${fill[2]})`;
  ctx.fillRect(0, 0, w, h);
  return ctx.getImageData(0, 0, w, h) as unknown as ImageData;
}

function pixel(img: ImageData, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function anyForeground(img: ImageData): boolean {
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] || img.data[i + 1] || img.data[i + 2]) return true;
  }
  return false;
}

describe("applyOverlay accepts a single overlay object (#505)", () => {
  it("draws a single SegmentationMask (wrapped into a 1-element list)", async () => {
    const img = await makeImage(32, 32, [0, 0, 0]);
    const a = new Uint8Array(32 * 32);
    for (let r = 8; r < 16; r++) for (let c = 8; c < 16; c++) a[r * 32 + c] = 1;
    const mask = UserSegmentationMask.fromArray(a, 32, 32);
    applyOverlay(img, mask, { alpha: 1.0, colors: [[255, 0, 0]] });
    expect(pixel(img, 12, 12)).toEqual([255, 0, 0]);
    expect(pixel(img, 0, 0)).toEqual([0, 0, 0]);
  });

  it("draws a single ROI", async () => {
    const img = await makeImage(40, 40, [0, 0, 0]);
    const roi = UserROI.fromPolygon([
      [5, 5],
      [35, 5],
      [35, 35],
      [5, 35],
    ]);
    applyOverlay(img, roi, { alpha: 0.8 });
    expect(anyForeground(img)).toBe(true);
  });

  it("draws a single BoundingBox", async () => {
    const img = await makeImage(40, 40, [0, 0, 0]);
    const bb = UserBoundingBox.fromXyxy(5, 5, 35, 35);
    applyOverlay(img, bb, { alpha: 0.8 });
    expect(anyForeground(img)).toBe(true);
  });

  it("still draws a single LabelImage", async () => {
    const img = await makeImage(16, 16, [0, 0, 0]);
    const data = new Int32Array(16 * 16);
    for (let r = 2; r < 8; r++)
      for (let c = 2; c < 8; c++) data[r * 16 + c] = 1;
    const li = UserLabelImage.fromArray(data, 16, 16);
    applyOverlay(img, li, { alpha: 1.0 });
    expect(pixel(img, 4, 4)).not.toEqual([0, 0, 0]);
  });

  it("is a no-op for an unrecognized single object", async () => {
    const img = await makeImage(8, 8, [10, 20, 30]);
    const notAnOverlay = { foo: 1 } as unknown as Parameters<
      typeof applyOverlay
    >[1];
    applyOverlay(img, notAnOverlay, {});
    expect(pixel(img, 0, 0)).toEqual([10, 20, 30]);
  });
});
