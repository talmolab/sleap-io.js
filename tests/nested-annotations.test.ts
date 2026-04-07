import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance, Track } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { UserCentroid, PredictedCentroid } from "../src/model/centroid.js";
import { UserBoundingBox, PredictedBoundingBox } from "../src/model/bbox.js";
import { UserROI } from "../src/model/roi.js";
import { UserLabelImage } from "../src/model/label-image.js";
import type { LabelImageObjectInfo } from "../src/model/label-image.js";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";

async function roundTrip(labels: Labels): Promise<Labels> {
  const bytes = await saveSlpToBytes(labels);
  return readSlp(new Uint8Array(bytes).buffer, { openVideos: false });
}

async function roundTripLazy(labels: Labels): Promise<Labels> {
  const bytes = await saveSlpToBytes(labels);
  return readSlpLazy(new Uint8Array(bytes).buffer, { openVideos: false });
}

describe("LabeledFrame annotation fields", () => {
  it("has centroids, bboxes, masks, labelImages, rois fields", () => {
    const video = new Video({ filename: "test.mp4" });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0 });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0 });

    const lf = new LabeledFrame({ video, frameIdx: 0, centroids: [c], bboxes: [b] });
    expect(lf.centroids).toHaveLength(1);
    expect(lf.centroids[0]).toBe(c);
    expect(lf.bboxes).toHaveLength(1);
    expect(lf.bboxes[0]).toBe(b);
    expect(lf.masks).toHaveLength(0);
    expect(lf.labelImages).toHaveLength(0);
    expect(lf.rois).toHaveLength(0);
  });

  it("removePredictions removes predicted annotations", () => {
    const video = new Video({ filename: "test.mp4" });
    const cUser = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0 });
    const cPred = new PredictedCentroid({ x: 3, y: 4, video, frameIdx: 0, score: 0.9 });
    const bUser = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0 });
    const bPred = new PredictedBoundingBox({ x1: 5, y1: 5, x2: 15, y2: 15, video, frameIdx: 0, score: 0.8 });

    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      centroids: [cUser, cPred],
      bboxes: [bUser, bPred],
    });
    lf.removePredictions();

    expect(lf.centroids).toHaveLength(1);
    expect(lf.centroids[0]).toBe(cUser);
    expect(lf.bboxes).toHaveLength(1);
    expect(lf.bboxes[0]).toBe(bUser);
  });

  it("_mergeAnnotations merges and deduplicates", () => {
    const video = new Video({ filename: "test.mp4" });
    const shared = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0 });
    const unique = new UserCentroid({ x: 3, y: 4, video, frameIdx: 0 });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [shared] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [shared, unique] });

    lf1._mergeAnnotations(lf2);

    expect(lf1.centroids).toHaveLength(2);
    expect(lf1.centroids.filter((c) => c === shared)).toHaveLength(1);
    expect(lf1.centroids).toContain(unique);
  });
});

describe("Labels annotation distribution", () => {
  it("distributes flat annotation lists into LabeledFrames", () => {
    const video = new Video({ filename: "test.mp4" });
    const c1 = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0 });
    const c2 = new UserCentroid({ x: 3, y: 4, video, frameIdx: 1 });
    const b1 = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0 });

    const labels = new Labels({ centroids: [c1, c2], bboxes: [b1], videos: [video] });

    // Two frames created (one for each unique frameIdx)
    expect(labels.labeledFrames).toHaveLength(2);

    const lf0 = labels.labeledFrames.find((lf) => lf.frameIdx === 0)!;
    const lf1 = labels.labeledFrames.find((lf) => lf.frameIdx === 1)!;
    expect(lf0.centroids).toHaveLength(1);
    expect(lf0.centroids[0]).toBe(c1);
    expect(lf1.centroids).toHaveLength(1);
    expect(lf1.centroids[0]).toBe(c2);
    expect(lf0.bboxes).toHaveLength(1);
    expect(lf0.bboxes[0]).toBe(b1);

    // Property returns flat view
    expect(labels.centroids).toHaveLength(2);
    expect(labels.bboxes).toHaveLength(1);
  });

  it("distributes to existing LabeledFrames", () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0 });

    const labels = new Labels({ labeledFrames: [lf], centroids: [c] });

    expect(labels.labeledFrames).toHaveLength(1);
    expect(labels.labeledFrames[0].centroids).toHaveLength(1);
    expect(labels.labeledFrames[0].centroids[0]).toBe(c);
    expect(labels.labeledFrames[0].instances).toHaveLength(1);
  });

  it("distributes across multiple videos", () => {
    const v1 = new Video({ filename: "v1.mp4" });
    const v2 = new Video({ filename: "v2.mp4" });
    const c1 = new UserCentroid({ x: 1, y: 2, video: v1, frameIdx: 0 });
    const c2 = new UserCentroid({ x: 3, y: 4, video: v2, frameIdx: 0 });

    const labels = new Labels({ centroids: [c1, c2], videos: [v1, v2] });

    expect(labels.labeledFrames).toHaveLength(2);
    const lfV1 = labels.labeledFrames.find((lf) => lf.video === v1)!;
    const lfV2 = labels.labeledFrames.find((lf) => lf.video === v2)!;
    expect(lfV1.centroids[0]).toBe(c1);
    expect(lfV2.centroids[0]).toBe(c2);
  });

  it("keeps undistributable annotations in _init fields", () => {
    const video = new Video({ filename: "test.mp4" });
    // Static ROI has no frameIdx
    const roi = UserROI.fromBbox(0, 0, 10, 10, { video, frameIdx: null });

    const labels = new Labels({ rois: [roi], videos: [video] });

    // Not distributed — stays in _init
    expect(labels._initRois).toHaveLength(1);
    // But accessible via property
    expect(labels.rois).toHaveLength(1);
    expect(labels.rois[0]).toBe(roi);
  });
});

describe("Labels add_* methods", () => {
  it("addCentroid finds-or-creates frame", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });

    const labels = new Labels({ videos: [video] });
    labels.addCentroid(c);

    expect(labels.labeledFrames).toHaveLength(1);
    expect(labels.labeledFrames[0].centroids[0]).toBe(c);
    expect(labels.tracks).toContain(track);

    // Adding to same frame reuses it
    const c2 = new UserCentroid({ x: 3, y: 4, video, frameIdx: 0 });
    labels.addCentroid(c2);
    expect(labels.labeledFrames).toHaveLength(1);
    expect(labels.labeledFrames[0].centroids).toHaveLength(2);
  });

  it("addCentroid requires video and frameIdx", () => {
    const labels = new Labels();
    const c = new UserCentroid({ x: 1, y: 2 });
    expect(() => labels.addCentroid(c)).toThrow("video and frameIdx");
  });

  it("addBbox auto-populates videos and tracks", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0, track });

    const labels = new Labels();
    labels.addBbox(b);

    expect(labels.videos).toContain(video);
    expect(labels.tracks).toContain(track);
    expect(labels.labeledFrames[0].bboxes[0]).toBe(b);
  });

  it("addLabelImage collects tracks from objects", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const li = new UserLabelImage({
      data: new Int32Array([0, 1, 2, 0]),
      height: 2,
      width: 2,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track, category: "cell", name: "", instance: null }],
      ]),
      video,
      frameIdx: 0,
    });

    const labels = new Labels();
    labels.addLabelImage(li);

    expect(labels.tracks).toContain(track);
    expect(labels.labeledFrames).toHaveLength(1);
  });
});

describe("Labels property getters", () => {
  it("centroids returns flat view across frames", () => {
    const video = new Video({ filename: "test.mp4" });
    const c1 = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0 });
    const c2 = new UserCentroid({ x: 3, y: 4, video, frameIdx: 1 });
    const c3 = new UserCentroid({ x: 5, y: 6, video, frameIdx: 0 });

    const labels = new Labels({ centroids: [c1, c2, c3], videos: [video] });

    const flat = labels.centroids;
    expect(flat).toHaveLength(3);
    expect(flat).toContain(c1);
    expect(flat).toContain(c2);
    expect(flat).toContain(c3);
  });
});

describe("Labels track collection from annotations", () => {
  it("update collects tracks from nested annotations", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });

    const labels = new Labels({ centroids: [c], videos: [video] });

    expect(labels.tracks).toContain(track);
  });

  it("append collects annotation tracks", () => {
    const video = new Video({ filename: "test.mp4" });
    const tBbox = new Track("t_bbox");
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0, track: tBbox });
    const lf = new LabeledFrame({ video, frameIdx: 0, bboxes: [b] });

    const labels = new Labels({ videos: [video] });
    labels.append(lf);

    expect(labels.tracks).toContain(tBbox);
  });
});

describe("Labels _findOrCreateFrame", () => {
  it("reuses existing frames", () => {
    const video = new Video({ filename: "test.mp4" });
    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0 })],
      videos: [video],
    });

    const lf = (labels as any)._findOrCreateFrame(video, 0);
    expect(lf).toBe(labels.labeledFrames[0]);
    expect(labels.labeledFrames).toHaveLength(1);

    const lf2 = (labels as any)._findOrCreateFrame(video, 1);
    expect(labels.labeledFrames).toHaveLength(2);
    expect(lf2.frameIdx).toBe(1);
  });
});

describe("SLP round-trip with annotations", () => {
  it("round-trips annotations on frames", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0 });

    const labels = new Labels({ labeledFrames: [lf], centroids: [c], bboxes: [b] });

    const loaded = await roundTrip(labels);

    expect(loaded.centroids).toHaveLength(1);
    expect(loaded.centroids[0].x).toBe(1);
    expect(loaded.bboxes).toHaveLength(1);

    // Annotations are on the correct frame
    const lf0 = loaded.labeledFrames[0];
    expect(lf0.centroids).toHaveLength(1);
    expect(lf0.bboxes).toHaveLength(1);
    expect(lf0.instances).toHaveLength(1);
  });

  it("round-trips centroid-only data (e.g., TrackMate)", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const centroids = Array.from({ length: 5 }, (_, i) =>
      new PredictedCentroid({
        x: i,
        y: i * 2,
        video,
        frameIdx: i,
        track,
        score: 0.9,
      }),
    );

    const labels = new Labels({
      centroids,
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });
    expect(labels.labeledFrames).toHaveLength(5);

    const loaded = await roundTrip(labels);
    expect(loaded.centroids).toHaveLength(5);
    expect(loaded.labeledFrames).toHaveLength(5);

    for (const c of loaded.centroids) {
      expect(c.x).toBeDefined();
    }
  });
});

describe("Lazy read with annotations", () => {
  it("lazy read attaches annotations to materialized frames", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0 });

    const labels = new Labels({ labeledFrames: [lf], centroids: [c], bboxes: [b] });

    const lazy = await roundTripLazy(labels);

    // Access frame 0 — should have annotations attached
    const lf0 = lazy._lazyFrameList!.at(0)!;
    expect(lf0.centroids).toHaveLength(1);
    expect(lf0.bboxes).toHaveLength(1);
    expect(lf0.instances).toHaveLength(1);
  });

  it("lazy read creates supplementary frames for annotation-only data", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const centroids = Array.from({ length: 3 }, (_, i) =>
      new PredictedCentroid({
        x: i,
        y: i,
        video,
        frameIdx: i,
        track,
        score: 0.9,
      }),
    );

    const labels = new Labels({
      centroids,
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });

    const lazy = await roundTripLazy(labels);

    expect(lazy.centroids).toHaveLength(3);
    expect(lazy.length).toBeGreaterThanOrEqual(3);

    // All frames accessible by index (including supplementary)
    for (let i = 0; i < lazy.length; i++) {
      const frame = lazy._lazyFrameList!.at(i);
      expect(frame).toBeDefined();
      expect(frame!.video).toBeDefined();
    }
  });

  it("lazy centroids property works without materializing", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });

    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst] })],
      centroids: [c],
    });

    const lazy = await roundTripLazy(labels);

    // Centroids accessible without materializing all frames
    expect(lazy.isLazy).toBe(true);
    expect(lazy.centroids).toHaveLength(1);
    expect(lazy.isLazy).toBe(true); // Still lazy after accessing property
  });

  it("materialize resolves deferred instance references on frames", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, video, frameIdx: 0, track });

    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst] })],
      centroids: [c],
      bboxes: [b],
    });

    const lazy = await roundTripLazy(labels);
    lazy.materialize();

    expect(lazy.isLazy).toBe(false);
    expect(lazy.centroids).toHaveLength(1);
    expect(lazy.bboxes).toHaveLength(1);

    // Annotations are on frames
    const lf0 = lazy.labeledFrames[0];
    expect(lf0.centroids).toHaveLength(1);
    expect(lf0.bboxes).toHaveLength(1);
  });

  it("lazy copy preserves annotations", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });

    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst] })],
      centroids: [c],
    });

    const lazy = await roundTripLazy(labels);
    const copied = lazy.copy();

    expect(copied.centroids).toHaveLength(1);
    expect(copied.centroids[0].x).toBe(1);
  });

  it("supplementary frames accessible via negative indexing", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    // Centroid-only data creates supplementary frames (no /frames entries)
    const centroids = Array.from({ length: 3 }, (_, i) =>
      new PredictedCentroid({ x: i, y: i, video, frameIdx: i, track, score: 0.9 }),
    );

    const labels = new Labels({ centroids, videos: [video], skeletons: [skeleton], tracks: [track] });
    const lazy = await roundTripLazy(labels);

    // at(-1) should return the last supplementary frame
    const lastFrame = lazy._lazyFrameList!.at(-1)!;
    expect(lastFrame).toBeDefined();
    expect(lastFrame.video).toBeDefined();
    expect(lastFrame.centroids.length).toBeGreaterThan(0);

    // at(-length) should return the first frame
    const firstFrame = lazy._lazyFrameList!.at(-lazy.length)!;
    expect(firstFrame).toBeDefined();

    // at(-(length+1)) should be undefined
    expect(lazy._lazyFrameList!.at(-(lazy.length + 1))).toBeUndefined();
  });

  it("lazy write round-trips correctly", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const c = new UserCentroid({ x: 1, y: 2, video, frameIdx: 0, track });

    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst] })],
      centroids: [c],
    });

    // Write -> lazy read -> write -> eager read
    const lazy = await roundTripLazy(labels);
    const bytes2 = await saveSlpToBytes(lazy);
    const loaded = await readSlp(new Uint8Array(bytes2).buffer, { openVideos: false });

    expect(loaded.centroids).toHaveLength(1);
    expect(loaded.centroids[0].x).toBe(1);
    expect(loaded.labeledFrames[0].centroids).toHaveLength(1);
  });
});
