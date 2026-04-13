import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import {
  LabeledFrame,
  _annotationCentroidXy,
  _findAnnotationMatches,
} from "../src/model/labeled-frame.js";
import { Instance, Track } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { UserCentroid, PredictedCentroid } from "../src/model/centroid.js";
import { UserBoundingBox, PredictedBoundingBox } from "../src/model/bbox.js";
import { UserROI, PredictedROI } from "../src/model/roi.js";
import { UserSegmentationMask, PredictedSegmentationMask } from "../src/model/mask.js";
import { UserLabelImage, PredictedLabelImage } from "../src/model/label-image.js";
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
    const c = new UserCentroid({ x: 1, y: 2});
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10});

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
    const cUser = new UserCentroid({ x: 1, y: 2});
    const cPred = new PredictedCentroid({ x: 3, y: 4, score: 0.9 });
    const bUser = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10});
    const bPred = new PredictedBoundingBox({ x1: 5, y1: 5, x2: 15, y2: 15, score: 0.8 });

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

  it("_mergeAnnotations merges, deduplicates, and copies new items", () => {
    const video = new Video({ filename: "test.mp4" });
    const shared = new UserCentroid({ x: 1, y: 2});
    const unique = new UserCentroid({ x: 3, y: 4});

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [shared] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [shared, unique] });

    lf1._mergeAnnotations(lf2);

    // shared should not be duplicated (same identity already in lf1)
    expect(lf1.centroids).toHaveLength(2);
    expect(lf1.centroids[0]).toBe(shared);
    // unique is copied, not the same object
    expect(lf1.centroids[1]).not.toBe(unique);
    expect(lf1.centroids[1].x).toBe(unique.x);
    expect(lf1.centroids[1].y).toBe(unique.y);
  });
});

describe("Labels annotation on LabeledFrames", () => {
  it("annotations are placed on LabeledFrames", () => {
    const video = new Video({ filename: "test.mp4" });
    const c1 = new UserCentroid({ x: 1, y: 2 });
    const c2 = new UserCentroid({ x: 3, y: 4 });
    const b1 = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });

    const lf0 = new LabeledFrame({ video, frameIdx: 0, centroids: [c1], bboxes: [b1] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, centroids: [c2] });

    const labels = new Labels({ labeledFrames: [lf0, lf1], videos: [video] });

    expect(labels.labeledFrames).toHaveLength(2);
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

  it("annotations on existing LabeledFrames", () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const c = new UserCentroid({ x: 1, y: 2 });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst], centroids: [c] });

    const labels = new Labels({ labeledFrames: [lf] });

    expect(labels.labeledFrames).toHaveLength(1);
    expect(labels.labeledFrames[0].centroids).toHaveLength(1);
    expect(labels.labeledFrames[0].centroids[0]).toBe(c);
    expect(labels.labeledFrames[0].instances).toHaveLength(1);
  });

  it("annotations across multiple videos via LabeledFrames", () => {
    const v1 = new Video({ filename: "v1.mp4" });
    const v2 = new Video({ filename: "v2.mp4" });
    const c1 = new UserCentroid({ x: 1, y: 2 });
    const c2 = new UserCentroid({ x: 3, y: 4 });

    const lfV1 = new LabeledFrame({ video: v1, frameIdx: 0, centroids: [c1] });
    const lfV2 = new LabeledFrame({ video: v2, frameIdx: 0, centroids: [c2] });

    const labels = new Labels({ labeledFrames: [lfV1, lfV2], videos: [v1, v2] });

    expect(labels.labeledFrames).toHaveLength(2);
    expect(lfV1.centroids[0]).toBe(c1);
    expect(lfV2.centroids[0]).toBe(c2);
  });

  it("static ROIs stored on Labels._staticRois", () => {
    const video = new Video({ filename: "test.mp4" });
    // Static ROI (not on any frame)
    const roi = UserROI.fromBbox(0, 0, 10, 10, { video });

    const labels = new Labels({ rois: [roi], videos: [video] });

    expect(labels._staticRois).toHaveLength(1);
    // Accessible via property
    expect(labels.rois).toHaveLength(1);
    expect(labels.rois[0]).toBe(roi);
  });
});

describe("LabeledFrame.append() routing", () => {
  it("append routes centroids to centroids list", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const c = new UserCentroid({ x: 1, y: 2, track });
    const lf = new LabeledFrame({ video, frameIdx: 0 });
    lf.append(c);

    expect(lf.centroids).toHaveLength(1);
    expect(lf.centroids[0]).toBe(c);

    // Adding to same frame appends
    const c2 = new UserCentroid({ x: 3, y: 4 });
    lf.append(c2);
    expect(lf.centroids).toHaveLength(2);
  });

  it("append routes bboxes to bboxes list", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, track });
    const lf = new LabeledFrame({ video, frameIdx: 0 });
    lf.append(b);

    expect(lf.bboxes).toHaveLength(1);
    expect(lf.bboxes[0]).toBe(b);
  });

  it("Labels collects tracks from annotations on frames", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const li = new UserLabelImage({
      data: new Int32Array([0, 1, 2, 0]),
      height: 2,
      width: 2,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track, category: "cell", name: "", instance: null }],
      ]),
    });

    const lf = new LabeledFrame({ video, frameIdx: 0, labelImages: [li] });
    const labels = new Labels({ labeledFrames: [lf], videos: [video] });

    expect(labels.tracks).toContain(track);
    expect(labels.labeledFrames).toHaveLength(1);
  });
});

describe("Labels property getters", () => {
  it("centroids returns flat view across frames", () => {
    const video = new Video({ filename: "test.mp4" });
    const c1 = new UserCentroid({ x: 1, y: 2 });
    const c2 = new UserCentroid({ x: 3, y: 4 });
    const c3 = new UserCentroid({ x: 5, y: 6 });

    const lf0 = new LabeledFrame({ video, frameIdx: 0, centroids: [c1, c3] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, centroids: [c2] });

    const labels = new Labels({ labeledFrames: [lf0, lf1], videos: [video] });

    const flat = labels.centroids;
    expect(flat).toHaveLength(3);
    expect(flat).toContain(c1);
    expect(flat).toContain(c2);
    expect(flat).toContain(c3);
  });
});

describe("Labels track collection from annotations", () => {
  it("collects tracks from nested annotations on frames", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const c = new UserCentroid({ x: 1, y: 2, track });
    const lf = new LabeledFrame({ video, frameIdx: 0, centroids: [c] });

    const labels = new Labels({ labeledFrames: [lf], videos: [video] });

    expect(labels.tracks).toContain(track);
  });

  it("append collects annotation tracks", () => {
    const video = new Video({ filename: "test.mp4" });
    const tBbox = new Track("t_bbox");
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, track: tBbox });
    const lf = new LabeledFrame({ video, frameIdx: 0, bboxes: [b] });

    const labels = new Labels({ videos: [video] });
    labels.append(lf);

    expect(labels.tracks).toContain(tBbox);
  });
});

describe("Labels.getFrame", () => {
  it("finds existing frames by video and frameIdx", () => {
    const video = new Video({ filename: "test.mp4" });
    const lf0 = new LabeledFrame({ video, frameIdx: 0 });
    const labels = new Labels({
      labeledFrames: [lf0],
      videos: [video],
    });

    expect(labels.getFrame(video, 0)).toBe(lf0);
    expect(labels.getFrame(video, 1)).toBeNull();
  });
});

describe("SLP round-trip with annotations", () => {
  it("round-trips annotations on frames", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const c = new UserCentroid({ x: 1, y: 2, track });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst], centroids: [c], bboxes: [b] });

    const labels = new Labels({ labeledFrames: [lf] });

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
        track,
        score: 0.9,
      }),
    );

    const frames = centroids.map((c, i) =>
      new LabeledFrame({ video, frameIdx: i, centroids: [c] })
    );
    const labels = new Labels({
      labeledFrames: frames,
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
    const c = new UserCentroid({ x: 1, y: 2, track });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst], centroids: [c], bboxes: [b] });

    const labels = new Labels({ labeledFrames: [lf] });

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
    const frames = Array.from({ length: 3 }, (_, i) => {
      const c = new PredictedCentroid({ x: i, y: i, track, score: 0.9 });
      return new LabeledFrame({ video, frameIdx: i, centroids: [c] });
    });

    const labels = new Labels({
      labeledFrames: frames,
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
    const c = new UserCentroid({ x: 1, y: 2, track });

    const lf0 = new LabeledFrame({ video, frameIdx: 0, instances: [inst], centroids: [c] });
    const labels = new Labels({
      labeledFrames: [lf0],
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
    const c = new UserCentroid({ x: 1, y: 2, track });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10, track });

    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst], centroids: [c], bboxes: [b] })],
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
    const c = new UserCentroid({ x: 1, y: 2, track });

    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst], centroids: [c] })],
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
    // Centroid-only data
    const frames = Array.from({ length: 3 }, (_, i) => {
      const c = new PredictedCentroid({ x: i, y: i, track, score: 0.9 });
      return new LabeledFrame({ video, frameIdx: i, centroids: [c] });
    });

    const labels = new Labels({ labeledFrames: frames, videos: [video], skeletons: [skeleton], tracks: [track] });
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

  it("lazy write round-trips correctly without explicit materialize", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = new Instance({ points: { A: [10, 20] }, skeleton, track });
    const c = new UserCentroid({ x: 1, y: 2, track });

    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [inst], centroids: [c] })],
    });

    // Write -> lazy read -> save lazy directly -> eager read.
    // The lazy fast path in saveSlpToBytes handles this without materialize().
    const lazy = await roundTripLazy(labels);
    expect(lazy.isLazy).toBe(true);
    const bytes2 = await saveSlpToBytes(lazy);
    const loaded = await readSlp(new Uint8Array(bytes2).buffer, { openVideos: false });

    expect(loaded.centroids).toHaveLength(1);
    expect(loaded.centroids[0].x).toBe(1);
    expect(loaded.labeledFrames[0].centroids).toHaveLength(1);
  });
});

describe("_mergeAnnotations strategies", () => {
  it("keep_original keeps self's annotations and discards other's", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfC = new UserCentroid({ x: 1, y: 2});
    const otherC = new UserCentroid({ x: 3, y: 4});

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfC] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherC] });

    lf1._mergeAnnotations(lf2, "keep_original");

    expect(lf1.centroids).toHaveLength(1);
    expect(lf1.centroids[0]).toBe(selfC);
  });

  it("keep_new replaces with copies of other's", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfC = new UserCentroid({ x: 1, y: 2});
    const otherC = new UserCentroid({ x: 3, y: 4});

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfC] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherC] });

    lf1._mergeAnnotations(lf2, "keep_new");

    expect(lf1.centroids).toHaveLength(1);
    expect(lf1.centroids[0]).not.toBe(otherC); // copied, not same object
    expect(lf1.centroids[0].x).toBe(3);
    expect(lf1.centroids[0].y).toBe(4);
  });

  it("replace_predictions keeps user from self, replaces predicted with other's", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfUser = new UserCentroid({ x: 1, y: 2});
    const selfPred = new PredictedCentroid({ x: 5, y: 6, score: 0.9 });
    const otherPred = new PredictedCentroid({ x: 7, y: 8, score: 0.8 });
    const otherUser = new UserCentroid({ x: 9, y: 10});

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfUser, selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherPred, otherUser] });

    lf1._mergeAnnotations(lf2, "replace_predictions");

    // selfUser kept, selfPred removed, otherPred added (copied), otherUser ignored
    expect(lf1.centroids).toHaveLength(2);
    expect(lf1.centroids[0]).toBe(selfUser);
    expect(lf1.centroids[1]).not.toBe(otherPred);
    expect(lf1.centroids[1].x).toBe(7);
    expect(lf1.centroids[1].isPredicted).toBe(true);
  });

  it("auto spatial matching resolves user-vs-predicted", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfUser = new UserCentroid({ x: 1, y: 2});
    const selfPred = new PredictedCentroid({ x: 5, y: 6, score: 0.9 });
    const otherPred = new PredictedCentroid({ x: 7, y: 8, score: 0.8 });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfUser, selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherPred] });

    lf1._mergeAnnotations(lf2, "auto");

    expect(lf1.centroids).toHaveLength(2);
    expect(lf1.centroids[0]).toBe(selfUser);
    expect(lf1.centroids[1].x).toBe(7);
    expect(lf1.centroids[1].isPredicted).toBe(true);
  });

  it("auto adds unmatched user from other", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfUser = new UserCentroid({ x: 1, y: 2});
    // Far away — won't match self_user (distance > 5.0)
    const otherUser = new UserCentroid({ x: 50, y: 60});

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfUser] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherUser] });

    lf1._mergeAnnotations(lf2, "auto");

    // Both should be present: self's user kept + other's user added (unmatched)
    expect(lf1.centroids).toHaveLength(2);
    expect(lf1.centroids[0]).toBe(selfUser);
    expect(lf1.centroids[1]).not.toBe(otherUser); // copied
    expect(lf1.centroids[1].x).toBe(50);
  });

  it("auto user replaces prediction when spatially matched", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfPred = new PredictedCentroid({ x: 10, y: 20, score: 0.9 });
    const otherUser = new UserCentroid({ x: 11, y: 20.5});

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherUser] });

    lf1._mergeAnnotations(lf2, "auto");

    // Prediction replaced by user
    expect(lf1.centroids).toHaveLength(1);
    expect(lf1.centroids[0].isPredicted).toBe(false);
    expect(lf1.centroids[0].x).toBe(11);
  });

  it("auto keeps unmatched self prediction", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfPred = new PredictedCentroid({ x: 10, y: 20, score: 0.9 });
    // Far away — no match
    const otherUser = new UserCentroid({ x: 80, y: 90});

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherUser] });

    lf1._mergeAnnotations(lf2, "auto");

    // Self's prediction kept (unmatched) + other's user added (unmatched)
    expect(lf1.centroids).toHaveLength(2);
    const xs = new Set(lf1.centroids.map((c) => c.x));
    expect(xs).toEqual(new Set([10, 80]));
  });

  it("auto spatial matching works for bounding boxes", () => {
    const video = new Video({ filename: "test.mp4" });
    const selfPred = new PredictedBoundingBox({
      x1: 10, y1: 10, x2: 20, y2: 20, score: 0.8,
    });
    const otherUser = new UserBoundingBox({
      x1: 11, y1: 11, x2: 21, y2: 21,
    });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, bboxes: [selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, bboxes: [otherUser] });

    lf1._mergeAnnotations(lf2, "auto");

    // Centroid distance ~1.4px, well within threshold — prediction replaced by user
    expect(lf1.bboxes).toHaveLength(1);
    expect(lf1.bboxes[0].isPredicted).toBe(false);
    expect(lf1.bboxes[0].x1).toBe(11);
  });

  it("auto spatial matching works for segmentation masks", () => {
    const video = new Video({ filename: "test.mp4" });
    // Create small masks at nearby locations (overlapping bbox centroids)
    const selfPred = new PredictedSegmentationMask({
      rleCounts: new Uint32Array([0, 100]),
      height: 10,
      width: 10,
      video,
      frameIdx: 0,
      score: 0.7,
      offset: [5, 5],
    });
    const otherUser = new UserSegmentationMask({
      rleCounts: new Uint32Array([0, 100]),
      height: 10,
      width: 10,
      video,
      frameIdx: 0,
      offset: [6, 6],
    });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [otherUser] });

    lf1._mergeAnnotations(lf2, "auto");

    // Bbox centroids are close — prediction replaced by user
    expect(lf1.masks).toHaveLength(1);
    expect(lf1.masks[0].isPredicted).toBe(false);
  });

  it("auto many-to-one uses one-to-one matching", () => {
    const video = new Video({ filename: "test.mp4" });
    // One prediction in self
    const selfPred = new PredictedCentroid({ x: 10, y: 10, score: 0.9 });
    // Two users in other, both within threshold of selfPred
    const otherUserA = new UserCentroid({ x: 11, y: 10}); // dist=1.0
    const otherUserB = new UserCentroid({ x: 10, y: 11}); // dist=1.0

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherUserA, otherUserB] });

    lf1._mergeAnnotations(lf2, "auto");

    // One replaces prediction via match, other added as unmatched — neither dropped
    expect(lf1.centroids).toHaveLength(2);
    const xs = new Set(lf1.centroids.map((c) => c.x));
    expect(xs).toEqual(new Set([11, 10]));
    expect(lf1.centroids.every((c) => !c.isPredicted)).toBe(true);
  });

  it("auto empty mask treated as unmatched", () => {
    const video = new Video({ filename: "test.mp4" });
    const emptyMask = new UserSegmentationMask({
      rleCounts: new Uint32Array([100]), // 100 zeros, no foreground
      height: 10,
      width: 10,
      video,
      frameIdx: 0,
    });
    const normalMask = new UserSegmentationMask({
      rleCounts: new Uint32Array([0, 100]),
      height: 10,
      width: 10,
      video,
      frameIdx: 0,
    });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [emptyMask] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [normalMask] });

    lf1._mergeAnnotations(lf2, "auto");

    // Both kept: empty mask has no centroid so it's unmatched
    expect(lf1.masks).toHaveLength(2);
  });

  it("update_tracks cascades track from spatially matched other", () => {
    const video = new Video({ filename: "test.mp4" });
    const trackA = new Track("a");
    const trackB = new Track("b");

    const selfC = new UserCentroid({ x: 10, y: 20, track: trackA });
    const otherC = new UserCentroid({ x: 11, y: 20.5, track: trackB });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfC] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherC] });

    lf1._mergeAnnotations(lf2, "update_tracks");

    // Self's centroid track updated to other's track
    expect(lf1.centroids).toHaveLength(1);
    expect(lf1.centroids[0].track).toBe(trackB);
  });

  it("update_tracks leaves unmatched annotations unchanged", () => {
    const video = new Video({ filename: "test.mp4" });
    const trackA = new Track("a");
    const trackB = new Track("b");

    const selfC = new UserCentroid({ x: 10, y: 20, track: trackA });
    // Far away — no match
    const otherC = new UserCentroid({ x: 80, y: 90, track: trackB });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, centroids: [selfC] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, centroids: [otherC] });

    lf1._mergeAnnotations(lf2, "update_tracks");

    expect(lf1.centroids[0].track).toBe(trackA); // unchanged
  });

  it("update_tracks skips labelImages", () => {
    const video = new Video({ filename: "test.mp4" });
    const trackA = new Track("a");
    const trackB = new Track("b");

    const liSelf = new UserLabelImage({
      data: new Int32Array([0, 1]),
      height: 1,
      width: 2,
      objects: new Map([[1, { track: trackA, category: "cell", name: "", instance: null }]]),
      video,
      frameIdx: 0,
    });
    const liOther = new UserLabelImage({
      data: new Int32Array([0, 2]),
      height: 1,
      width: 2,
      objects: new Map([[2, { track: trackB, category: "cell", name: "", instance: null }]]),
      video,
      frameIdx: 0,
    });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, labelImages: [liSelf] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, labelImages: [liOther] });

    lf1._mergeAnnotations(lf2, "update_tracks");

    // Label image track should be unchanged
    expect(lf1.labelImages[0].objects.get(1)!.track).toBe(trackA);
  });

  it("auto spatial matching works for label images", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t");

    const liSelf = new UserLabelImage({
      data: new Int32Array([0, 1]),
      height: 1,
      width: 2,
      objects: new Map([[1, { track, category: "cell", name: "", instance: null }]]),
      video,
      frameIdx: 0,
    });
    const liOther = new PredictedLabelImage({
      data: new Int32Array([0, 2]),
      height: 1,
      width: 2,
      objects: new Map([[2, { track, category: "cell", name: "", instance: null }]]),
      video,
      frameIdx: 0,
      score: 0.9,
    });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, labelImages: [liSelf] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, labelImages: [liOther] });

    lf1._mergeAnnotations(lf2, "auto");

    // User from self kept, prediction from other ignored (user beats predicted)
    expect(lf1.labelImages).toHaveLength(1);
    expect(lf1.labelImages[0].isPredicted).toBe(false);
  });

  it("auto spatial matching works for ROIs", () => {
    const video = new Video({ filename: "test.mp4" });

    const selfPred = new PredictedROI({
      geometry: {
        type: "Polygon",
        coordinates: [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]],
      },
      video,
      frameIdx: 0,
      score: 0.8,
    });
    const otherUser = new UserROI({
      geometry: {
        type: "Polygon",
        coordinates: [[[11, 11], [21, 11], [21, 21], [11, 21], [11, 11]]],
      },
      video,
      frameIdx: 0,
    });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, rois: [selfPred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, rois: [otherUser] });

    lf1._mergeAnnotations(lf2, "auto");

    // Centroids are ~1.4px apart — prediction replaced by user
    expect(lf1.rois).toHaveLength(1);
    expect(lf1.rois[0].isPredicted).toBe(false);
  });

  it("auto empty ROI treated as unmatched", () => {
    const video = new Video({ filename: "test.mp4" });
    // Empty polygon (no area)
    const emptyRoi = new UserROI({
      geometry: { type: "Point", coordinates: [0, 0] },
      video,
      frameIdx: 0,
    });
    const normalRoi = new UserROI({
      geometry: {
        type: "Polygon",
        coordinates: [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]],
      },
      video,
      frameIdx: 0,
    });

    const lf1 = new LabeledFrame({ video, frameIdx: 0, rois: [emptyRoi] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, rois: [normalRoi] });

    lf1._mergeAnnotations(lf2, "auto");

    // Both kept: empty ROI has no centroid so it's unmatched
    expect(lf1.rois).toHaveLength(2);
  });
});

describe("_annotationCentroidXy", () => {
  it("returns [x, y] for centroids", () => {
    const c = new UserCentroid({ x: 5, y: 10 });
    expect(_annotationCentroidXy(c, "centroids")).toEqual([5, 10]);
  });

  it("returns centroidXy for bboxes", () => {
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 20 });
    expect(_annotationCentroidXy(b, "bboxes")).toEqual([5, 10]);
  });

  it("returns centroidXy for ROIs with area", () => {
    const roi = new UserROI({
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
      },
    });
    expect(_annotationCentroidXy(roi, "rois")).toEqual([5, 10]);
  });

  it("returns null for empty ROIs", () => {
    const roi = new UserROI({
      geometry: { type: "Point", coordinates: [5, 5] },
    });
    expect(_annotationCentroidXy(roi, "rois")).toBeNull();
  });

  it("returns bbox centroid for masks", () => {
    // 10x10 mask, all foreground, at offset (5, 5)
    const mask = new UserSegmentationMask({
      rleCounts: new Uint32Array([0, 100]),
      height: 10,
      width: 10,
      offset: [5, 5],
    });
    const result = _annotationCentroidXy(mask, "masks");
    expect(result).not.toBeNull();
    // bbox is {x: 5, y: 5, width: 10, height: 10} → centroid (10, 10)
    expect(result![0]).toBe(10);
    expect(result![1]).toBe(10);
  });

  it("returns null for empty masks", () => {
    const mask = new UserSegmentationMask({
      rleCounts: new Uint32Array([100]), // all zeros
      height: 10,
      width: 10,
    });
    expect(_annotationCentroidXy(mask, "masks")).toBeNull();
  });

  it("returns image extent center for label images", () => {
    const li = new UserLabelImage({
      data: new Int32Array([0, 1]),
      height: 1,
      width: 2,
    });
    // scale=[1,1], offset=[0,0] → center at (1, 0.5)
    expect(_annotationCentroidXy(li, "labelImages")).toEqual([1, 0.5]);
  });
});

describe("_findAnnotationMatches", () => {
  it("finds matches within threshold", () => {
    const c1 = new UserCentroid({ x: 10, y: 10 });
    const c2 = new UserCentroid({ x: 11, y: 10 });
    const matches = _findAnnotationMatches([c1], [c2], "centroids", 5.0);
    expect(matches).toHaveLength(1);
    expect(matches[0].selfIdx).toBe(0);
    expect(matches[0].otherIdx).toBe(0);
    expect(matches[0].score).toBeCloseTo(1 / (1 + 1)); // distance = 1
  });

  it("returns empty when distance exceeds threshold", () => {
    const c1 = new UserCentroid({ x: 0, y: 0 });
    const c2 = new UserCentroid({ x: 100, y: 100 });
    const matches = _findAnnotationMatches([c1], [c2], "centroids", 5.0);
    expect(matches).toHaveLength(0);
  });

  it("returns multiple matches for multiple items", () => {
    const selfList = [
      new UserCentroid({ x: 10, y: 10 }),
      new UserCentroid({ x: 20, y: 20 }),
    ];
    const otherList = [
      new UserCentroid({ x: 11, y: 10 }),
      new UserCentroid({ x: 21, y: 20 }),
    ];
    const matches = _findAnnotationMatches(selfList, otherList, "centroids", 5.0);
    expect(matches).toHaveLength(2);
  });
});
