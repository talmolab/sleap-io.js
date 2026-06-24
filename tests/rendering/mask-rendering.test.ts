// Tests for auto-drawing segmentation masks and coloring overlay elements by
// track identity. Ports Python sleap-io PR #462 (auto-draw masks) and PR #470
// (color masks/ROIs/bboxes by track), covering JS issue #162 (mask color
// flicker when a mask's list index changes across frames).
//
// The grayscale (H, W, 1) handling from #462 is N/A in JS: skia-canvas is RGBA,
// so there is no numpy-broadcast crash to fix.

import { describe, it, expect } from "../bun-test";
import { renderImage } from "../../src/rendering/render";
import { renderVideo, checkFfmpeg } from "../../src/rendering/video";
import { UserSegmentationMask } from "../../src/model/mask";
import { UserLabelImage } from "../../src/model/label-image";
import { UserBoundingBox } from "../../src/model/bbox";
import { UserROI } from "../../src/model/roi";
import { Instance, Track } from "../../src/model/instance";
import { Skeleton } from "../../src/model/skeleton";
import { LabeledFrame } from "../../src/model/labeled-frame";
import { Labels } from "../../src/model/labels";
import { Video } from "../../src/model/video";
import { getPalette } from "../../src/rendering/colors";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const STANDARD = getPalette("standard", 2);
const DISTINCT = getPalette("distinct", 2);

/** Box as (y0, y1, x0, x1) in image pixels. */
type Box = [number, number, number, number];
const BOX_A: Box = [5, 20, 5, 20];
const BOX_B: Box = [40, 60, 40, 60];

/** A `UserSegmentationMask` covering `box` (y0, y1, x0, x1). */
function boxMask(
  box: Box,
  track: Track | null = null,
  h = 64,
  w = 64,
): UserSegmentationMask {
  const binary = new Uint8Array(h * w);
  const [y0, y1, x0, x1] = box;
  for (let r = y0; r < y1; r++) {
    for (let c = x0; c < x1; c++) {
      binary[r * w + c] = 1;
    }
  }
  return UserSegmentationMask.fromArray(binary, h, w, { track });
}

/** RGB triple at the center of `box`. */
function boxCenterColor(img: ImageData, box: Box): [number, number, number] {
  const [y0, y1, x0, x1] = box;
  const y = (y0 + y1) >> 1;
  const x = (x0 + x1) >> 1;
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
}

/** RGB triple at pixel (x, y). */
function pixel(img: ImageData, x: number, y: number): [number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
}

function arrEq(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function makeTrackedMaskLabels(
  frame0Masks: UserSegmentationMask[],
  frame1Masks: UserSegmentationMask[],
  tracks: Track[],
): Labels {
  const video = new Video({ filename: "v.mp4" });
  const lf0 = new LabeledFrame({ video, frameIdx: 0, masks: frame0Masks });
  const lf1 = new LabeledFrame({ video, frameIdx: 1, masks: frame1Masks });
  return new Labels({
    labeledFrames: [lf0, lf1],
    videos: [video],
    tracks,
  });
}

// ===========================================================================
// PR #462: auto-draw segmentation masks (no explicit overlay)
// ===========================================================================

describe("auto-draw segmentation masks", () => {
  it("renderImage auto-draws the frame's masks when no overlay is passed", async () => {
    const video = new Video({ filename: "dummy.mp4" });
    const mask = boxMask(BOX_B);
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [mask] });

    const img = await renderImage(lf, {
      width: 64,
      height: 64,
      background: [128, 128, 128],
    });

    expect(img.width).toBe(64);
    // Masked region is colored (differs from the plain background).
    expect(arrEq(pixel(img, 50, 50), [128, 128, 128])).toBe(false);
    // Background outside the mask is unchanged.
    expect(arrEq(pixel(img, 0, 0), [128, 128, 128])).toBe(true);
  });

  it("renderImage auto-draws masks for a Labels source (first frame)", async () => {
    const video = new Video({ filename: "dummy.mp4" });
    const mask = boxMask(BOX_B);
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [mask] });
    const labels = new Labels({ labeledFrames: [lf], videos: [video] });

    const img = await renderImage(labels, {
      width: 64,
      height: 64,
      background: [128, 128, 128],
    });

    expect(arrEq(boxCenterColor(img, BOX_B), [128, 128, 128])).toBe(false);
  });

  it("renderImage without masks/overlay leaves the background untouched", async () => {
    const skeleton = new Skeleton({ nodes: ["a", "b"], edges: [["a", "b"]] });
    const video = new Video({ filename: "dummy.mp4" });
    const inst = new Instance({ points: { a: [5, 5], b: [10, 10] }, skeleton });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const img = await renderImage(lf, {
      width: 64,
      height: 64,
      background: [128, 128, 128],
    });

    // No mask -> a region away from the pose stays the plain background.
    expect(arrEq(pixel(img, 50, 50), [128, 128, 128])).toBe(true);
  });

  it("explicit overlay takes precedence over the frame's masks", async () => {
    const video = new Video({ filename: "dummy.mp4" });
    // Frame mask is bottom-right; explicit label-image overlay is top-left.
    const mask = boxMask(BOX_B);
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [mask] });

    const data = new Int32Array(64 * 64);
    for (let r = 5; r < 25; r++)
      for (let c = 5; c < 25; c++) data[r * 64 + c] = 1;
    const li = UserLabelImage.fromArray(data, 64, 64);

    const img = await renderImage(lf, {
      width: 64,
      height: 64,
      background: [128, 128, 128],
      overlay: li,
      overlayAlpha: 0.6,
    });

    // Explicit overlay region (top-left) is colored.
    expect(arrEq(pixel(img, 15, 15), [128, 128, 128])).toBe(false);
    // Mask region (bottom-right) is NOT drawn since an explicit overlay won.
    expect(arrEq(boxCenterColor(img, BOX_B), [128, 128, 128])).toBe(true);
  });

  it("renderVideo auto-draws labels.masks when no overlay is passed", async () => {
    if (!(await checkFfmpeg())) return; // ffmpeg-gated smoke test
    const video = new Video({ filename: "dummy.mp4" });
    const lf0 = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [boxMask(BOX_B)],
    });
    const lf1 = new LabeledFrame({
      video,
      frameIdx: 1,
      masks: [boxMask(BOX_B)],
    });
    const labels = new Labels({ labeledFrames: [lf0, lf1], videos: [video] });

    const tmp = `/tmp/auto-mask-${Date.now()}.mp4`;
    await expect(
      renderVideo(labels, tmp, {
        width: 64,
        height: 64,
        background: [128, 128, 128],
        overlayAlpha: 0.6,
        fps: 30,
      }),
    ).resolves.toBeUndefined();

    const fs = await import("node:fs");
    expect(fs.existsSync(tmp)).toBe(true);
    fs.unlinkSync(tmp);
  });
});

// ===========================================================================
// PR #470: color masks (and ROI/bbox) by track identity
// ===========================================================================

describe("color overlays by track identity", () => {
  it("renderImage colors masks by track index, not list position", async () => {
    // track_b first, track_a second — order is the reverse of track index.
    const trackA = new Track("A");
    const trackB = new Track("B");
    const video = new Video({ filename: "v.mp4" });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [boxMask(BOX_B, trackB), boxMask(BOX_A, trackA)],
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
      overlayAlpha: 1.0,
    });

    // Track A -> index 0, track B -> index 1, using the pose palette
    // ("standard"), NOT overlay_palette.
    expect(boxCenterColor(img, BOX_A)).toEqual(STANDARD[0]);
    expect(boxCenterColor(img, BOX_B)).toEqual(STANDARD[1]);
  });

  it("a tracked mask keeps its color when its list position shuffles", async () => {
    // Core flicker regression (JS #162): two tracked masks swap order within
    // lf.masks between frames while their .track stays fixed. Under
    // color_by="track" each track's region must render the same color across
    // frames (positional coloring would flicker).
    const trackA = new Track("A");
    const trackB = new Track("B");

    // Render each frame as its own single-frame Labels (sharing the track list)
    // — this is exactly the per-frame source renderVideo's mask callable routes
    // to renderImage. Frame 1 swaps the list order of the two masks.
    const video = new Video({ filename: "v.mp4" });
    const lf0 = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [boxMask(BOX_A, trackA), boxMask(BOX_B, trackB)],
    });
    const lf1 = new LabeledFrame({
      video,
      frameIdx: 1,
      masks: [boxMask(BOX_B, trackB), boxMask(BOX_A, trackA)],
    });
    const tracks = [trackA, trackB];

    const opts = {
      width: 64,
      height: 64,
      colorBy: "track" as const,
      background: "black" as const,
      overlayAlpha: 1.0,
    };
    const frame0 = await renderImage(
      new Labels({ labeledFrames: [lf0], videos: [video], tracks }),
      opts,
    );
    const frame1 = await renderImage(
      new Labels({ labeledFrames: [lf1], videos: [video], tracks }),
      opts,
    );

    const a0 = boxCenterColor(frame0, BOX_A);
    const a1 = boxCenterColor(frame1, BOX_A);
    const b0 = boxCenterColor(frame0, BOX_B);
    const b1 = boxCenterColor(frame1, BOX_B);
    expect(a0).toEqual(a1); // track A did not flicker
    expect(b0).toEqual(b1); // track B did not flicker
    expect(arrEq(a0, b0)).toBe(false); // distinct tracks -> distinct colors
    // And the colors are track-keyed (A=0, B=1) from the pose palette.
    expect(a0).toEqual(STANDARD[0]);
    expect(b0).toEqual(STANDARD[1]);
  });

  it("untracked masks fall back to palette[0] under color_by=track", async () => {
    const trackA = new Track("A");
    const trackB = new Track("B");
    const video = new Video({ filename: "v.mp4" });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [boxMask(BOX_A, null), boxMask(BOX_B, trackB)],
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
      overlayAlpha: 1.0,
    });

    expect(boxCenterColor(img, BOX_A)).toEqual(STANDARD[0]); // untracked -> palette[0]
    expect(boxCenterColor(img, BOX_B)).toEqual(STANDARD[1]); // track B -> its index
  });

  it("color_by != track keeps positional overlay_palette coloring", async () => {
    // Regression guard: the non-track path stays byte-identical to old behavior
    // — masks colored by list position from overlay_palette ("distinct").
    const trackA = new Track("A");
    const trackB = new Track("B");
    const video = new Video({ filename: "v.mp4" });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [boxMask(BOX_A, trackA), boxMask(BOX_B, trackB)],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      tracks: [trackA, trackB],
    });

    const img = await renderImage(labels, {
      width: 64,
      height: 64,
      colorBy: "instance",
      background: "black",
      overlayAlpha: 1.0,
    });

    expect(boxCenterColor(img, BOX_A)).toEqual(DISTINCT[0]); // first in list
    expect(boxCenterColor(img, BOX_B)).toEqual(DISTINCT[1]); // second in list
  });

  it("a LabeledFrame source falls back to positional coloring under track", async () => {
    // A bare LabeledFrame builds no track index map, so the track branch is
    // skipped (gated on a Labels source) and masks render positionally.
    const trackA = new Track("A");
    const video = new Video({ filename: "v.mp4" });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [boxMask(BOX_A, trackA)],
    });

    const img = await renderImage(lf, {
      width: 64,
      height: 64,
      colorBy: "track",
      background: "black",
      overlayAlpha: 1.0,
    });

    expect(img.width).toBe(64);
    // Positional: first (only) mask gets overlay_palette ("distinct") index 0.
    expect(boxCenterColor(img, BOX_A)).toEqual(getPalette("distinct", 1)[0]);
  });

  it("track-less labels under color_by=track stay positional", async () => {
    const video = new Video({ filename: "v.mp4" });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [boxMask(BOX_A), boxMask(BOX_B)], // untracked
    });
    const labels = new Labels({ labeledFrames: [lf], videos: [video] }); // no tracks
    expect(labels.tracks.length).toBe(0);

    const img = await renderImage(labels, {
      width: 64,
      height: 64,
      colorBy: "track",
      background: "black",
      overlayAlpha: 1.0,
    });

    expect(boxCenterColor(img, BOX_A)).toEqual(DISTINCT[0]);
    expect(boxCenterColor(img, BOX_B)).toEqual(DISTINCT[1]);
  });

  it("explicit ROI overlays are track-colored, not positional", async () => {
    const trackA = new Track("A");
    const trackB = new Track("B");
    const video = new Video({ filename: "v.mp4" });

    const roi = (b: Box, t: Track): UserROI => {
      const [y0, y1, x0, x1] = b;
      const r = UserROI.fromPolygon([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
      r.track = t;
      return r;
    };

    // track_b first, track_a second — reverse of track index. The ROIs live on
    // the frame and are also passed as the explicit overlay.
    const overlayRois = [roi(BOX_B, trackB), roi(BOX_A, trackA)];
    const lf = new LabeledFrame({ video, frameIdx: 0, rois: overlayRois });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      tracks: [trackA, trackB],
    });

    const img = await renderImage(labels, {
      width: 64,
      height: 64,
      overlay: overlayRois,
      colorBy: "track",
      background: "black",
      overlayAlpha: 1.0,
    });

    // ROI fill at box centers is track-keyed (A=0, B=1).
    expect(boxCenterColor(img, BOX_A)).toEqual(STANDARD[0]);
    expect(boxCenterColor(img, BOX_B)).toEqual(STANDARD[1]);
  });

  it("explicit BoundingBox overlays are track-colored, not positional", async () => {
    const trackA = new Track("A");
    const trackB = new Track("B");
    const video = new Video({ filename: "v.mp4" });

    const bb = (b: Box, t: Track): UserBoundingBox => {
      const [y0, y1, x0, x1] = b;
      const box = UserBoundingBox.fromXyxy(x0, y0, x1, y1);
      box.track = t;
      return box;
    };

    const overlayBboxes = [bb(BOX_B, trackB), bb(BOX_A, trackA)];
    const lf = new LabeledFrame({ video, frameIdx: 0, bboxes: overlayBboxes });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      tracks: [trackA, trackB],
    });

    const img = await renderImage(labels, {
      width: 64,
      height: 64,
      overlay: overlayBboxes,
      colorBy: "track",
      background: "black",
      overlayAlpha: 1.0,
    });

    // Sample on a box edge (bbox is an outline, not filled) — the stroke color
    // is track-keyed.
    const onTopEdge = (box: Box): [number, number, number] => {
      const [y0, , x0, x1] = box;
      return pixel(img, (x0 + x1) >> 1, y0);
    };
    expect(onTopEdge(BOX_A)).toEqual(STANDARD[0]);
    expect(onTopEdge(BOX_B)).toEqual(STANDARD[1]);
  });

  it("label-image overlays are not track-recolored under color_by=track", async () => {
    // Label images color by integer object ID, never by track. The overlay
    // color guard skips them (a single LabelImage is not an array), so a tracked
    // project with a label-image overlay still renders by ID without crashing.
    const trackA = new Track("A");
    const skeleton = new Skeleton({ nodes: ["a", "b"], edges: [["a", "b"]] });
    const video = new Video({ filename: "v.mp4" });
    const data = new Int32Array(64 * 64);
    for (let r = 5; r < 25; r++)
      for (let c = 5; c < 25; c++) data[r * 64 + c] = 1;
    const inst = new Instance({
      points: { a: [50, 50], b: [55, 55] },
      skeleton,
      track: trackA,
    });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      labelImages: [UserLabelImage.fromArray(data, 64, 64)],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackA],
    });

    const img = await renderImage(labels, {
      width: 64,
      height: 64,
      overlay: lf.labelImages[0],
      colorBy: "track",
      background: "black",
      overlayAlpha: 1.0,
    });

    // Label-image region (top-left) is drawn (by ID), not left as background.
    expect(arrEq(boxCenterColor(img, [5, 25, 5, 25]), [0, 0, 0])).toBe(false);
  });

  it("renderVideo per-frame masks keep stable track colors across frames", async () => {
    if (!(await checkFfmpeg())) return; // ffmpeg-gated smoke test
    // End-to-end: renderVideo auto-resolves masks per frame (callable keyed by
    // frame index) and routes them to renderImage, which track-colors them.
    const trackA = new Track("A");
    const trackB = new Track("B");
    const labels = makeTrackedMaskLabels(
      [boxMask(BOX_A, trackA), boxMask(BOX_B, trackB)],
      [boxMask(BOX_B, trackB), boxMask(BOX_A, trackA)],
      [trackA, trackB],
    );

    const tmp = `/tmp/track-mask-${Date.now()}.mp4`;
    await expect(
      renderVideo(labels, tmp, {
        width: 64,
        height: 64,
        colorBy: "track",
        background: "black",
        overlayAlpha: 1.0,
        fps: 30,
      }),
    ).resolves.toBeUndefined();

    const fs = await import("node:fs");
    expect(fs.existsSync(tmp)).toBe(true);
    fs.unlinkSync(tmp);
  });
});
