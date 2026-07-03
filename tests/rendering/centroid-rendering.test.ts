// Tests for centroid rendering parity with sleap-io: draw_centroids (#506),
// renderImage auto-drawing frame centroids scoped to the rendered video (#468),
// and single (not double) scaling of the centroid marker (#494).

import { describe, it, expect } from "../bun-test";
import { drawCentroids } from "../../src/rendering/overlays";
import { renderImage } from "../../src/rendering/render";
import { UserCentroid } from "../../src/model/centroid";
import { Track } from "../../src/model/instance";
import { Video } from "../../src/model/video";
import { LabeledFrame } from "../../src/model/labeled-frame";
import { Labels } from "../../src/model/labels";
import { getPalette } from "../../src/rendering/colors";

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

function arrEq(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

const STANDARD = getPalette("standard", 2);

describe("drawCentroids (#506)", () => {
  it("draws a filled circle at the centroid in a single color", async () => {
    const img = await makeImage(40, 40, [0, 0, 0]);
    drawCentroids(img, [new UserCentroid({ x: 20, y: 20 })], {
      color: [255, 0, 0],
      markerSize: 5,
      alpha: 1,
    });
    expect(pixel(img, 20, 20)).toEqual([255, 0, 0]);
    expect(pixel(img, 0, 0)).toEqual([0, 0, 0]);
  });

  it("uses per-centroid colors (cycled)", async () => {
    const img = await makeImage(40, 40, [0, 0, 0]);
    drawCentroids(
      img,
      [new UserCentroid({ x: 10, y: 10 }), new UserCentroid({ x: 30, y: 30 })],
      {
        colors: [
          [255, 0, 0],
          [0, 0, 255],
        ],
        markerSize: 4,
      },
    );
    expect(pixel(img, 10, 10)).toEqual([255, 0, 0]);
    expect(pixel(img, 30, 30)).toEqual([0, 0, 255]);
  });

  it("honors offset", async () => {
    const img = await makeImage(40, 40, [0, 0, 0]);
    drawCentroids(img, [new UserCentroid({ x: 25, y: 25 })], {
      color: [0, 255, 0],
      markerSize: 4,
      offset: [5, 5],
    });
    expect(pixel(img, 20, 20)).toEqual([0, 255, 0]); // drawn at (25-5, 25-5)
  });

  it("is a no-op for an empty list", async () => {
    const img = await makeImage(8, 8, [9, 9, 9]);
    drawCentroids(img, []);
    expect(pixel(img, 0, 0)).toEqual([9, 9, 9]);
  });
});

describe("renderImage draws frame centroids (#468/#494)", () => {
  const video = new Video({ filename: "v.mp4" });

  it("auto-draws a frame's centroids over the background", async () => {
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      centroids: [new UserCentroid({ x: 32, y: 32 })],
    });
    const img = await renderImage(lf, {
      width: 64,
      height: 64,
      background: [128, 128, 128],
      markerSize: 5,
    });
    expect(arrEq(pixel(img, 32, 32), [128, 128, 128])).toBe(false); // colored
    expect(arrEq(pixel(img, 2, 2), [128, 128, 128])).toBe(true); // bg elsewhere
  });

  it("renders a centroid-only frame without throwing", async () => {
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      centroids: [new UserCentroid({ x: 10, y: 10 })],
    });
    await expect(
      renderImage(lf, { width: 32, height: 32, background: "black" }),
    ).resolves.toBeDefined();
  });

  it("colors centroids by track via the pose palette", async () => {
    const trackA = new Track("A");
    const trackB = new Track("B");
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      centroids: [
        new UserCentroid({ x: 16, y: 16, track: trackA }),
        new UserCentroid({ x: 48, y: 48, track: trackB }),
      ],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      tracks: [trackA, trackB],
    });
    const img = await renderImage(labels, {
      width: 64,
      height: 64,
      colorBy: "track",
      background: "black",
      markerSize: 5,
      alpha: 1,
    });
    // Track A -> index 0, track B -> index 1, using the pose ("standard") palette.
    expect(pixel(img, 16, 16)).toEqual(STANDARD[0]);
    expect(pixel(img, 48, 48)).toEqual(STANDARD[1]);
  });

  it("scales the centroid marker once (no double-scaling, #494)", async () => {
    // At scale=2 a markerSize=5 centroid at source (16,16) renders at canvas
    // (32,32) with radius ~10 (markerSize*scale) — the pose-node convention.
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      centroids: [new UserCentroid({ x: 16, y: 16 })],
    });
    const img = await renderImage(lf, {
      width: 32,
      height: 32,
      scale: 2,
      background: "black",
      markerSize: 5,
      alpha: 1,
      colorBy: "instance",
    });
    expect(img.width).toBe(64);
    expect(arrEq(pixel(img, 32, 32), [0, 0, 0])).toBe(false); // scaled center
    expect(arrEq(pixel(img, 38, 32), [0, 0, 0])).toBe(false); // 6px in (< r≈10)
    expect(arrEq(pixel(img, 48, 32), [0, 0, 0])).toBe(true); // 16px out (> r≈10)
  });
});
