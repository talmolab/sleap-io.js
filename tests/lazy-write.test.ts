/**
 * Tests for the lazy SLP write fast path (`writeSlpToFileLazy`).
 *
 * These exercise `saveSlpToBytes(lazy)` without explicit materialization —
 * the dispatch in `saveSlpToBytes` should detect lazy mode and route to the
 * fast path that pulls raw column data + per-frame annotation maps directly
 * from `LazyDataStore`.
 */
import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance, PredictedInstance, Track } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { UserCentroid, PredictedCentroid } from "../src/model/centroid.js";
import { UserBoundingBox, PredictedBoundingBox } from "../src/model/bbox.js";
import { UserROI } from "../src/model/roi.js";
import { UserSegmentationMask } from "../src/model/mask.js";
import { UserLabelImage } from "../src/model/label-image.js";
import type { LabelImageObjectInfo } from "../src/model/label-image.js";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";

/** Save eager → read lazy → save lazy → read eager. The middle step is the
 *  lazy fast path; we verify that `lazy.materialize()` is never needed. */
async function lazyRoundTrip(labels: Labels): Promise<Labels> {
  const bytes1 = await saveSlpToBytes(labels);
  const lazy = await readSlpLazy(new Uint8Array(bytes1).buffer, {
    openVideos: false,
  });
  expect(lazy.isLazy).toBe(true);
  const bytes2 = await saveSlpToBytes(lazy);
  // Confirm the lazy save did not materialize as a side effect.
  expect(lazy.isLazy).toBe(true);
  return readSlp(new Uint8Array(bytes2).buffer, { openVideos: false });
}

describe("lazy SLP write fast path", () => {
  it("preserves user instances", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const track = new Track("t1");
    const inst1 = new Instance({ points: { A: [1, 2], B: [3, 4] }, skeleton, track });
    const inst2 = new Instance({ points: { A: [5, 6], B: [7, 8] }, skeleton, track });
    const lf0 = new LabeledFrame({ video, frameIdx: 0, instances: [inst1] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, instances: [inst2] });
    const labels = new Labels({ labeledFrames: [lf0, lf1] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames).toHaveLength(2);
    expect(loaded.labeledFrames[0].instances).toHaveLength(1);
    expect(loaded.labeledFrames[1].instances).toHaveLength(1);
    expect(loaded.labeledFrames[0].instances[0].points[0].xy).toEqual([1, 2]);
    expect(loaded.labeledFrames[1].instances[0].points[1].xy).toEqual([7, 8]);
  });

  it("preserves predicted instances mixed with user instances", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const userInst = new Instance({ points: { A: [1, 2] }, skeleton });
    const predInst = PredictedInstance.fromArray([[3, 4]], skeleton, 0.85);
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [userInst, predInst],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].instances).toHaveLength(2);
    const loadedUser = loaded.labeledFrames[0].instances.find(
      (i) => !(i instanceof PredictedInstance),
    );
    const loadedPred = loaded.labeledFrames[0].instances.find(
      (i) => i instanceof PredictedInstance,
    ) as PredictedInstance | undefined;
    expect(loadedUser).toBeDefined();
    expect(loadedPred).toBeDefined();
    expect(loadedPred!.score).toBeCloseTo(0.85);
  });

  it("preserves frame-bound centroids", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const c1 = new UserCentroid({ x: 1, y: 2, category: "cell" });
    const c2 = new PredictedCentroid({ x: 3, y: 4, score: 0.9 });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      centroids: [c1, c2],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].centroids).toHaveLength(2);
    const xs = loaded.labeledFrames[0].centroids.map((c) => c.x).sort();
    expect(xs).toEqual([1, 3]);
  });

  it("preserves frame-bound bboxes", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [0, 0] }, skeleton });
    const b1 = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, category: "obj" });
    const b2 = new PredictedBoundingBox({
      x1: 5,
      y1: 5,
      x2: 15,
      y2: 15,
      score: 0.7,
    });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      bboxes: [b1, b2],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].bboxes).toHaveLength(2);
    expect(loaded.labeledFrames[0].bboxes.find((b) => b.category === "obj")).toBeDefined();
  });

  it("preserves frame-bound masks", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [0, 0] }, skeleton });
    const mask = UserSegmentationMask.fromArray(new Uint8Array(16), 4, 4, {
      name: "m1",
      category: "cell",
    });
    const lf = new LabeledFrame({
      video,
      frameIdx: 3,
      instances: [inst],
      masks: [mask],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].masks).toHaveLength(1);
    expect(loaded.labeledFrames[0].masks[0].name).toBe("m1");
    expect(loaded.labeledFrames[0].masks[0].category).toBe("cell");
    expect(loaded.labeledFrames[0].frameIdx).toBe(3);
  });

  it("preserves frame-bound label images", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [0, 0] }, skeleton });
    const li = new UserLabelImage({
      data: new Int32Array([0, 1, 0, 1]),
      height: 2,
      width: 2,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track, category: "cell", name: "obj", instance: null }],
      ]),
    });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      labelImages: [li],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].labelImages).toHaveLength(1);
    const loadedLi = loaded.labeledFrames[0].labelImages[0];
    expect(loadedLi.height).toBe(2);
    expect(loadedLi.width).toBe(2);
    expect(loadedLi.nObjects).toBe(1);
  });

  it("preserves static ROI video association (Side fix B regression)", async () => {
    // Static ROIs with a video reference must round-trip with the video
    // intact through the lazy fast path. Before Side fix B this was lost
    // because the collector emitted (-1, -1) for all undistributed entries.
    const v1 = new Video({ filename: "v1.mp4" });
    const v2 = new Video({ filename: "v2.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [0, 0] }, skeleton });
    const frameRoi = UserROI.fromBbox(0, 0, 50, 50, { video: v1, category: "frame-roi" });
    const staticRoi = UserROI.fromBbox(0, 0, 100, 100, { video: v2, category: "arena" });
    const lf = new LabeledFrame({
      video: v1,
      frameIdx: 0,
      instances: [inst],
      rois: [frameRoi],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [v1, v2],
      rois: [staticRoi],
    });

    const loaded = await lazyRoundTrip(labels);

    // Frame-bound ROI preserved on its frame
    expect(loaded.labeledFrames[0].rois).toHaveLength(1);
    expect(loaded.labeledFrames[0].rois[0].category).toBe("frame-roi");

    // Static ROI preserved as static, with video association intact
    expect(loaded.staticRois).toHaveLength(1);
    expect(loaded.staticRois[0].category).toBe("arena");
    expect(loaded.staticRois[0].video).not.toBeNull();
    expect(loaded.staticRois[0].video!.filename).toBe("v2.mp4");
  });

  it("preserves negative frames", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [0, 0] }, skeleton });
    const lfNorm = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const lfNeg = new LabeledFrame({ video, frameIdx: 5, isNegative: true });
    const labels = new Labels({ labeledFrames: [lfNorm, lfNeg] });

    const loaded = await lazyRoundTrip(labels);
    const negFrames = loaded.labeledFrames.filter((f) => f.isNegative);
    expect(negFrames).toHaveLength(1);
    expect(negFrames[0].frameIdx).toBe(5);
  });

  it("preserves instance association on centroid via _instanceIdx (Side fix A)", async () => {
    // After lazy read, the centroid has _instanceIdx set but instance===null.
    // The lazy writer must persist _instanceIdx so the link survives a round
    // trip. After eager read, instance points to the materialized instance.
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const c = new UserCentroid({ x: 1, y: 2, instance: inst });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      centroids: [c],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].centroids).toHaveLength(1);
    expect(loaded.labeledFrames[0].instances).toHaveLength(1);
    expect(loaded.labeledFrames[0].centroids[0].instance).toBe(
      loaded.labeledFrames[0].instances[0],
    );
  });

  it("preserves instance association on bbox via _instanceIdx (Side fix A)", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const b = new UserBoundingBox({
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      instance: inst,
    });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      bboxes: [b],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].bboxes[0].instance).toBe(
      loaded.labeledFrames[0].instances[0],
    );
  });

  it("preserves instance association on roi via _instanceIdx (Side fix A)", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const roi = UserROI.fromBbox(0, 0, 50, 50, { instance: inst });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      rois: [roi],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    expect(loaded.labeledFrames[0].rois[0].instance).toBe(
      loaded.labeledFrames[0].instances[0],
    );
  });

  it("mixed annotation types round-trip in a single frame", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const c = new UserCentroid({ x: 1, y: 2 });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });
    const m = UserSegmentationMask.fromArray(new Uint8Array(16), 4, 4);
    const li = new UserLabelImage({
      data: new Int32Array([0, 1]),
      height: 1,
      width: 2,
    });
    const roi = UserROI.fromBbox(0, 0, 50, 50);

    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      centroids: [c],
      bboxes: [b],
      masks: [m],
      labelImages: [li],
      rois: [roi],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const loaded = await lazyRoundTrip(labels);
    const frame = loaded.labeledFrames[0];
    expect(frame.instances).toHaveLength(1);
    expect(frame.centroids).toHaveLength(1);
    expect(frame.bboxes).toHaveLength(1);
    expect(frame.masks).toHaveLength(1);
    expect(frame.labelImages).toHaveLength(1);
    expect(frame.rois).toHaveLength(1);
  });

  it("embed:'source' restores source video paths in the lazy fast path", async () => {
    // Construct a Labels where the (only) video has a sourceVideo set.
    // Save eager → read lazy → save lazy with embed:'source' → read eager.
    // The loaded video should match the source filename.
    const sourceVideo = new Video({ filename: "original.mp4" });
    const wrappedVideo = new Video({
      filename: "wrapper.mp4",
      sourceVideo,
    });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const lf = new LabeledFrame({
      video: wrappedVideo,
      frameIdx: 0,
      instances: [inst],
    });
    const labels = new Labels({ labeledFrames: [lf] });

    const bytes1 = await saveSlpToBytes(labels);
    const lazy = await readSlpLazy(new Uint8Array(bytes1).buffer, {
      openVideos: false,
    });
    expect(lazy.isLazy).toBe(true);
    // Manually attach a sourceVideo to the lazy-loaded video so the swap
    // has something to do (the read path doesn't re-create sourceVideo refs).
    lazy.videos[0].sourceVideo = new Video({ filename: "restored.mp4" });

    const bytes2 = await saveSlpToBytes(lazy, { embed: "source" });
    expect(lazy.isLazy).toBe(true); // still lazy after the source-mode save

    const loaded = await readSlp(new Uint8Array(bytes2).buffer, {
      openVideos: false,
    });
    expect(loaded.videos[0].filename).toBe("restored.mp4");
  });

  it("embed:'all' forces materialization in lazy mode", async () => {
    const video = new Video({ filename: "v.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({ labeledFrames: [lf] });

    const bytes1 = await saveSlpToBytes(labels);
    const lazy = await readSlpLazy(new Uint8Array(bytes1).buffer, {
      openVideos: false,
    });
    expect(lazy.isLazy).toBe(true);

    // embed:"all" tries to read pixel data — must materialize first.
    // We can't actually embed pixels (no real video), so embed mode that
    // requires pixel reads will go through the materialize path. Without
    // a backing video file, the embed step itself may throw, so we just
    // verify the materialization side-effect: after the call attempt,
    // lazy.isLazy should become false (materialization happens before
    // embed processing).
    try {
      await saveSlpToBytes(lazy, { embed: "all" });
    } catch {
      // Expected — no real video to embed pixels from.
    }
    expect(lazy.isLazy).toBe(false);
  });
});
