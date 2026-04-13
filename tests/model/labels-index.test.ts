/* @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Instance, PredictedInstance, Track } from "../../src/model/instance.js";
import { UserCentroid } from "../../src/model/centroid.js";
import { UserBoundingBox } from "../../src/model/bbox.js";
import { UserSegmentationMask } from "../../src/model/mask.js";
import { UserROI } from "../../src/model/roi.js";
import { UserLabelImage } from "../../src/model/label-image.js";
import type { LabelImageObjectInfo } from "../../src/model/label-image.js";
import { loadSlp } from "../../src/io/main.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

describe("Labels frame index", () => {
  it("builds on demand and provides O(1) lookups", () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const lf0 = new LabeledFrame({ video, frameIdx: 0 });
    const lf5 = new LabeledFrame({ video, frameIdx: 5 });
    const labels = new Labels({
      labeledFrames: [lf0, lf5],
      videos: [video],
      skeletons: [skeleton],
    });

    expect(labels.getFrame(video, 0)).toBe(lf0);
    expect(labels.getFrame(video, 5)).toBe(lf5);
    expect(labels.getFrame(video, 99)).toBeNull();
  });

  it("correctly separates frames from different videos", () => {
    const v1 = new Video({ filename: "v1.mp4" });
    const v2 = new Video({ filename: "v2.mp4" });
    const lfV1 = new LabeledFrame({ video: v1, frameIdx: 0 });
    const lfV2 = new LabeledFrame({ video: v2, frameIdx: 0 });
    const labels = new Labels({
      labeledFrames: [lfV1, lfV2],
      videos: [v1, v2],
    });

    expect(labels.getFrame(v1, 0)).toBe(lfV1);
    expect(labels.getFrame(v2, 0)).toBe(lfV2);
    expect(labels.getFrame(v1, 0)).not.toBe(labels.getFrame(v2, 0));
  });

  it("auto-rebuilds when labeledFrames length changes", () => {
    const video = new Video({ filename: "test.mp4" });
    const lf0 = new LabeledFrame({ video, frameIdx: 0 });
    const labels = new Labels({
      labeledFrames: [lf0],
      videos: [video],
    });

    expect(labels.getFrame(video, 0)).toBe(lf0);
    expect(labels.getFrame(video, 1)).toBeNull();

    // Directly mutate labeledFrames — index should auto-rebuild
    const lf1 = new LabeledFrame({ video, frameIdx: 1 });
    labels.labeledFrames.push(lf1);
    expect(labels.getFrame(video, 1)).toBe(lf1);
  });

  it("warns on duplicate (video, frameIdx)", () => {
    const video = new Video({ filename: "test.mp4" });
    const lf0a = new LabeledFrame({ video, frameIdx: 0 });
    const lf0b = new LabeledFrame({ video, frameIdx: 0 });
    const labels = new Labels({
      labeledFrames: [lf0a, lf0b],
      videos: [video],
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    labels.getFrame(video, 0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("Duplicate");
    warnSpy.mockRestore();

    // Last-wins semantics
    expect(labels.getFrame(video, 0)).toBe(lf0b);
  });
});

describe("Labels track index", () => {
  it("provides O(1) lookup by (video, track)", () => {
    const video = new Video({ filename: "test.mp4" });
    const t1 = new Track("t1");
    const t2 = new Track("t2");
    const c1 = new UserCentroid({ x: 1, y: 2, track: t1 });
    const c2 = new UserCentroid({ x: 3, y: 4, track: t1 });
    const c3 = new UserCentroid({ x: 5, y: 6, track: t2 });

    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 0, centroids: [c1] }),
        new LabeledFrame({ video, frameIdx: 5, centroids: [c2] }),
        new LabeledFrame({ video, frameIdx: 2, centroids: [c3] }),
      ],
      videos: [video],
      tracks: [t1, t2],
    });

    // Track 1 has 2 annotations, sorted by frameIdx
    const t1Anns = labels.getTrackAnnotations(video, t1);
    expect(t1Anns).toHaveLength(2);
    expect(t1Anns[0]).toBe(c1); // frameIdx=0
    expect(t1Anns[1]).toBe(c2); // frameIdx=5

    // Track 2 has 1 annotation
    const t2Anns = labels.getTrackAnnotations(video, t2);
    expect(t2Anns).toHaveLength(1);
    expect(t2Anns[0]).toBe(c3);

    // Unknown track returns empty
    const t3 = new Track("t3");
    expect(labels.getTrackAnnotations(video, t3)).toEqual([]);
  });

  it("includes instances", () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("t1");
    const inst = Instance.fromArray([[10, 20]], skeleton);
    inst.track = track;
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      tracks: [track],
    });

    const anns = labels.getTrackAnnotations(video, track);
    expect(anns).toHaveLength(1);
    expect(anns[0]).toBe(inst);
  });

  it("includes label images via objects' tracks", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const li = new UserLabelImage({
      data: new Int32Array([0, 1]),
      height: 1,
      width: 2,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track, category: "cell", name: "", instance: null }],
      ]),
    });
    const labels = new Labels({ labeledFrames: [new LabeledFrame({ video, frameIdx: 0, labelImages: [li] })], videos: [video], tracks: [track] });

    const anns = labels.getTrackAnnotations(video, track);
    expect(anns).toHaveLength(1);
    expect(anns[0]).toBe(li);
  });
});

describe("Labels.reindex()", () => {
  it("forces index rebuild on next access", () => {
    const video = new Video({ filename: "test.mp4" });
    const lf = new LabeledFrame({ video, frameIdx: 0 });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
    });

    // Build index
    labels.getFrame(video, 0);
    expect((labels as any)._frameIndex).not.toBeNull();

    // Reindex clears it
    labels.reindex();
    expect((labels as any)._frameIndex).toBeNull();
    expect((labels as any)._trackIndex).toBeNull();

    // Rebuilds on next access
    expect(labels.getFrame(video, 0)).toBe(lf);
  });
});

describe("Labels.find() fast path", () => {
  it("uses frame index for O(1) eager lookups", () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const frames = Array.from(
      { length: 10 },
      (_, i) => new LabeledFrame({ video, frameIdx: i }),
    );
    const labels = new Labels({
      labeledFrames: frames,
      videos: [video],
      skeletons: [skeleton],
    });

    // Single frame lookup
    const result = labels.find({ video, frameIdx: 5 });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(frames[5]);

    // Missing frame
    expect(labels.find({ video, frameIdx: 99 })).toHaveLength(0);
  });
});

describe("get*() fast paths", () => {
  it("getCentroids uses O(1) frame lookup when video+frameIdx given", () => {
    const video = new Video({ filename: "test.mp4" });
    const c0 = new UserCentroid({ x: 1, y: 2});
    const c1 = new UserCentroid({ x: 3, y: 4});
    const labels = new Labels({ labeledFrames: [new LabeledFrame({ video: video, frameIdx: 0, centroids: [c0] }), new LabeledFrame({ video: video, frameIdx: 1, centroids: [c1] })], videos: [video] });

    // Fast path: both video and frameIdx
    let result = labels.getCentroids({ video, frameIdx: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(c0);

    // Video only
    result = labels.getCentroids({ video });
    expect(result).toHaveLength(2);

    // Frame only
    result = labels.getCentroids({ frameIdx: 0 });
    expect(result).toHaveLength(1);

    // No match
    result = labels.getCentroids({ video, frameIdx: 99 });
    expect(result).toHaveLength(0);
  });

  it("getBboxes uses O(1) frame lookup and filters by track/instance", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = Instance.fromArray([[10, 20]], skeleton);
    const b1 = new UserBoundingBox({
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      video,
      frameIdx: 0,
      track,
      instance: inst,
    });
    const b2 = new UserBoundingBox({
      x1: 5,
      y1: 5,
      x2: 15,
      y2: 15,
      video,
      frameIdx: 0,
    });
    const labels = new Labels({ labeledFrames: [new LabeledFrame({ video: video, frameIdx: 0, bboxes: [b1, b2] })], videos: [video] });

    // Fast path with video+frameIdx
    let result = labels.getBboxes({ video, frameIdx: 0 });
    expect(result).toHaveLength(2);

    // Filter by track
    result = labels.getBboxes({ video, frameIdx: 0, track });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(b1);

    // Filter by instance
    result = labels.getBboxes({ video, frameIdx: 0, instance: inst });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(b1);

    // No match
    result = labels.getBboxes({ video, frameIdx: 99 });
    expect(result).toHaveLength(0);
  });

  it("getMasks uses O(1) frame lookup when video+frameIdx provided", () => {
    const video = new Video({ filename: "test.mp4" });
    const mask = new UserSegmentationMask({
      rleCounts: new Uint32Array([16]),
      height: 4,
      width: 4, });
    const labels = new Labels({ labeledFrames: [new LabeledFrame({ video: video, frameIdx: 0, masks: [mask] })], videos: [video] });

    let result = labels.getMasks({ video, frameIdx: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(mask);

    result = labels.getMasks({ video, frameIdx: 99 });
    expect(result).toHaveLength(0);
  });

  it("getLabelImages uses O(1) frame lookup when video+frameIdx given", () => {
    const video = new Video({ filename: "test.mp4" });
    const li = new UserLabelImage({
      data: new Int32Array([0, 1]),
      height: 1,
      width: 2,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track: null, category: "cell", name: "", instance: null }],
      ]),
    });
    const lf = new LabeledFrame({ video, frameIdx: 0, labelImages: [li] });
    const labels = new Labels({ labeledFrames: [lf], videos: [video] });

    let result = labels.getLabelImages({ video, frameIdx: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(li);

    result = labels.getLabelImages({ video, frameIdx: 99 });
    expect(result).toHaveLength(0);
  });

  it("getRois uses O(1) frame lookup when video+frameIdx provided", () => {
    const video = new Video({ filename: "test.mp4" });
    const roi1 = new UserROI({
      geometry: { type: "Point", coordinates: [0, 0] },
      video,
    });
    const roi2 = new UserROI({
      geometry: { type: "Point", coordinates: [5, 5] },
      video,
    });
    const lf0 = new LabeledFrame({ video, frameIdx: 0, rois: [roi1] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, rois: [roi2] });
    const labels = new Labels({ labeledFrames: [lf0, lf1], videos: [video] });

    // Fast path with video+frameIdx
    let result = labels.getRois({ video, frameIdx: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(roi1);

    // Video only
    result = labels.getRois({ video });
    expect(result).toHaveLength(2);

    // No match
    result = labels.getRois({ video, frameIdx: 99 });
    expect(result).toHaveLength(0);
  });
});

describe("Index invalidation", () => {
  it("append() invalidates cached indices", () => {
    const video = new Video({ filename: "test.mp4" });
    const lf0 = new LabeledFrame({ video, frameIdx: 0 });
    const labels = new Labels({
      labeledFrames: [lf0],
      videos: [video],
    });

    // Build index
    expect(labels.getFrame(video, 0)).toBe(lf0);
    expect((labels as any)._frameIndex).not.toBeNull();

    // Append new frame — index should be invalidated
    const lf1 = new LabeledFrame({ video, frameIdx: 1 });
    labels.append(lf1);
    expect((labels as any)._frameIndex).toBeNull();

    // Rebuilt on next access
    expect(labels.getFrame(video, 1)).toBe(lf1);
  });

  it("replaceVideos() invalidates indices", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const lf = new LabeledFrame({ video: oldVideo, frameIdx: 0 });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [oldVideo],
    });

    // Build index with old video
    expect(labels.getFrame(oldVideo, 0)).toBe(lf);

    // Replace video — index should be invalidated
    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    // Old video no longer in index
    expect(labels.getFrame(oldVideo, 0)).toBeNull();

    // New video found via rebuilt index
    expect(labels.getFrame(newVideo, 0)).toBe(lf);
  });

  it("append() with annotations invalidates indices", () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");
    const c0 = new UserCentroid({ x: 1, y: 2, track });
    const lf0 = new LabeledFrame({ video, frameIdx: 0, centroids: [c0] });
    const labels = new Labels({ labeledFrames: [lf0], videos: [video], tracks: [track] });

    // Build track index
    let anns = labels.getTrackAnnotations(video, track);
    expect(anns).toHaveLength(1);

    // Append a new frame with another centroid on the same track
    const c1 = new UserCentroid({ x: 3, y: 4, track });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, centroids: [c1] });
    labels.append(lf1);

    // Track index should be invalidated and rebuilt
    anns = labels.getTrackAnnotations(video, track);
    expect(anns).toHaveLength(2);
  });
});

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));

describe("Lazy guards", () => {
  it("getFrame throws on lazy Labels", async () => {
    const lazy = await loadSlp(path.join(fixtureRoot, "slp", "centered_pair_predictions.slp"), {
      openVideos: false,
      lazy: true,
    });
    const video = lazy.videos[0];
    expect(() => lazy.getFrame(video, 0)).toThrow("getFrame");
  });

  it("getTrackAnnotations throws on lazy Labels", async () => {
    const lazy = await loadSlp(path.join(fixtureRoot, "slp", "centered_pair_predictions.slp"), {
      openVideos: false,
      lazy: true,
    });
    const video = lazy.videos[0];
    const track = lazy.tracks[0];
    expect(() => lazy.getTrackAnnotations(video, track)).toThrow("getTrackAnnotations");
  });
});

describe("Labels.removePredictions()", () => {
  it("removes predictions and invalidates indices", () => {
    const skel = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("t1");

    const pred = PredictedInstance.fromArray([[1, 2], [3, 4]], skel, 0.9);
    pred.track = track;
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [pred] });
    const c = new UserCentroid({ x: 5, y: 6, track });
    lf.centroids.push(c);

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skel],
      tracks: [track],
    });

    // Force index build — track index should include centroid + predicted instance
    const result = labels.getTrackAnnotations(video, track);
    expect(result).toHaveLength(2);

    // Remove predictions
    labels.removePredictions();

    // Track index should be invalidated — only centroid remains
    const after = labels.getTrackAnnotations(video, track);
    expect(after).toHaveLength(1);
    expect(lf.centroids[0]).toBe(c);
    expect(lf.instances).toHaveLength(0);
  });
});
