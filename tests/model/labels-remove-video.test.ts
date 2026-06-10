import { describe, it, expect } from "../bun-test";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { SuggestionFrame } from "../../src/model/suggestions.js";
import { UserROI } from "../../src/model/roi.js";
import { Skeleton, Node } from "../../src/model/skeleton.js";

describe("Labels.removeVideo / removeVideos", () => {
  const mkRoi = (video: Video | null) =>
    new UserROI({
      geometry: { type: "Point", coordinates: [0, 0] },
      video,
      frameIdx: 0,
    });

  it("removes the video from labels.videos", () => {
    const a = new Video({ filename: "a.mp4" });
    const b = new Video({ filename: "b.mp4" });
    const labels = new Labels({ videos: [a, b] });
    labels.removeVideo(a);
    expect(labels.videos).toEqual([b]);
  });

  it("drops labeled frames for the removed video and keeps the rest", () => {
    const a = new Video({ filename: "a.mp4" });
    const b = new Video({ filename: "b.mp4" });
    const fa = new LabeledFrame({ video: a, frameIdx: 0 });
    const fb = new LabeledFrame({ video: b, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [fa, fb], videos: [a, b] });
    labels.removeVideo(a);
    expect(labels.labeledFrames).toEqual([fb]);
    expect(labels.videos).toEqual([b]);
  });

  it("drops suggestions for the removed video and keeps the rest", () => {
    const a = new Video({ filename: "a.mp4" });
    const b = new Video({ filename: "b.mp4" });
    const sa = new SuggestionFrame({ video: a, frameIdx: 0 });
    const sb = new SuggestionFrame({ video: b, frameIdx: 1 });
    const labels = new Labels({ videos: [a, b], suggestions: [sa, sb] });
    labels.removeVideo(a);
    expect(labels.suggestions).toEqual([sb]);
  });

  it("drops static ROIs for the removed video, keeping null-video and other-video ROIs", () => {
    const a = new Video({ filename: "a.mp4" });
    const b = new Video({ filename: "b.mp4" });
    const roiA = mkRoi(a);
    const roiB = mkRoi(b);
    const roiNull = mkRoi(null);
    const labels = new Labels({ videos: [a, b], rois: [roiA, roiB, roiNull] });
    labels.removeVideo(a);
    expect(labels._staticRois).toEqual([roiB, roiNull]);
  });

  it("rebuilds the frame index after removal", () => {
    const a = new Video({ filename: "a.mp4" });
    const b = new Video({ filename: "b.mp4" });
    const fa = new LabeledFrame({ video: a, frameIdx: 3 });
    const fb = new LabeledFrame({ video: b, frameIdx: 3 });
    const labels = new Labels({ labeledFrames: [fa, fb], videos: [a, b] });
    // Prime the index so removal must invalidate it.
    expect(labels.getFrame(a, 3)).toBe(fa);
    labels.removeVideo(a);
    expect(labels.getFrame(a, 3)).toBeNull();
    expect(labels.getFrame(b, 3)).toBe(fb);
  });

  it("is a no-op for a video not present in the labels", () => {
    const a = new Video({ filename: "a.mp4" });
    const other = new Video({ filename: "other.mp4" });
    const fa = new LabeledFrame({ video: a, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [fa], videos: [a] });
    labels.removeVideo(other);
    expect(labels.videos).toEqual([a]);
    expect(labels.labeledFrames).toEqual([fa]);
  });

  it("removeVideos removes several videos at once", () => {
    const a = new Video({ filename: "a.mp4" });
    const b = new Video({ filename: "b.mp4" });
    const c = new Video({ filename: "c.mp4" });
    const fa = new LabeledFrame({ video: a, frameIdx: 0 });
    const fb = new LabeledFrame({ video: b, frameIdx: 0 });
    const fc = new LabeledFrame({ video: c, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [fa, fb, fc], videos: [a, b, c] });
    labels.removeVideos([a, c]);
    expect(labels.videos).toEqual([b]);
    expect(labels.labeledFrames).toEqual([fb]);
  });

  it("removeVideos is a no-op for an empty list", () => {
    const a = new Video({ filename: "a.mp4" });
    const fa = new LabeledFrame({ video: a, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [fa], videos: [a] });
    labels.removeVideos([]);
    expect(labels.videos).toEqual([a]);
    expect(labels.labeledFrames).toEqual([fa]);
  });

  it("leaves skeletons untouched (no track/skeleton GC)", () => {
    const a = new Video({ filename: "a.mp4" });
    const skeleton = new Skeleton({ nodes: [new Node("x")], name: "S" });
    const labels = new Labels({ videos: [a], skeletons: [skeleton] });
    labels.removeVideo(a);
    expect(labels.skeletons).toEqual([skeleton]);
  });
});
