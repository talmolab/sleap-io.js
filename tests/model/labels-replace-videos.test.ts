/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { SuggestionFrame } from "../../src/model/suggestions.js";
import { UserROI } from "../../src/model/roi.js";
import { UserSegmentationMask } from "../../src/model/mask.js";
import { UserBoundingBox } from "../../src/model/bbox.js";
import { UserCentroid } from "../../src/model/centroid.js";
import { UserLabelImage } from "../../src/model/label-image.js";

describe("Labels.replaceVideos", () => {
  it("replaces video references on labeled frames", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const frame = new LabeledFrame({ video: oldVideo, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [frame], videos: [oldVideo] });

    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    expect(frame.video).toBe(newVideo);
    expect(labels.videos).toEqual([newVideo]);
  });

  it("replaces video references on suggestions", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const suggestion = new SuggestionFrame({ video: oldVideo, frameIdx: 0 });
    const labels = new Labels({ videos: [oldVideo], suggestions: [suggestion] });

    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    expect(suggestion.video).toBe(newVideo);
  });

  it("replaces video references on rois", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const roi = new UserROI({
      geometry: { type: "Point", coordinates: [0, 0] },
      video: oldVideo,
      frameIdx: 0,
    });
    const labels = new Labels({ videos: [oldVideo], rois: [roi] });

    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    expect(roi.video).toBe(newVideo);
  });

  it("replaces video references on masks", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const mask = new UserSegmentationMask({
      rleCounts: new Uint32Array([16]),
      height: 4,
      width: 4,
    });
    const lf = new LabeledFrame({ video: oldVideo, frameIdx: 0, masks: [mask] });
    const labels = new Labels({ labeledFrames: [lf], videos: [oldVideo] });

    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    // masks no longer have .video
  });

  it("replaces video references on bboxes", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const bbox = new UserBoundingBox({
      x1: 0, y1: 0, x2: 10, y2: 10,
    });
    const lf = new LabeledFrame({ video: oldVideo, frameIdx: 0, bboxes: [bbox] });
    const labels = new Labels({ labeledFrames: [lf], videos: [oldVideo] });

    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    // bboxes no longer have .video
  });

  it("replaces video references on centroids", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const centroid = new UserCentroid({ x: 1, y: 2 });
    const lf = new LabeledFrame({ video: oldVideo, frameIdx: 0, centroids: [centroid] });
    const labels = new Labels({ labeledFrames: [lf], videos: [oldVideo] });

    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    // centroids no longer have .video
  });

  it("replaces video references on label images", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const li = new UserLabelImage({
      data: new Int32Array([0, 0, 0, 0]),
      height: 2,
      width: 2,
    });
    const lf = new LabeledFrame({ video: oldVideo, frameIdx: 0, labelImages: [li] });
    const labels = new Labels({ labeledFrames: [lf], videos: [oldVideo] });

    labels.replaceVideos({ oldVideos: [oldVideo], newVideos: [newVideo] });

    // labelImages no longer have .video
  });

  it("accepts a videoMap directly", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const frame = new LabeledFrame({ video: oldVideo, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [frame], videos: [oldVideo] });

    const videoMap = new Map([[oldVideo, newVideo]]);
    labels.replaceVideos({ videoMap });

    expect(frame.video).toBe(newVideo);
    expect(labels.videos).toEqual([newVideo]);
  });

  it("infers oldVideos from labels.videos when only newVideos is provided", () => {
    const oldVideo = new Video({ filename: "old.mp4" });
    const newVideo = new Video({ filename: "new.mp4" });
    const frame = new LabeledFrame({ video: oldVideo, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [frame], videos: [oldVideo] });

    labels.replaceVideos({ newVideos: [newVideo] });

    expect(frame.video).toBe(newVideo);
    expect(labels.videos).toEqual([newVideo]);
  });

  it("does not touch unmapped videos", () => {
    const videoA = new Video({ filename: "a.mp4" });
    const videoB = new Video({ filename: "b.mp4" });
    const newA = new Video({ filename: "new_a.mp4" });
    const frameA = new LabeledFrame({ video: videoA, frameIdx: 0 });
    const frameB = new LabeledFrame({ video: videoB, frameIdx: 0 });
    const labels = new Labels({ labeledFrames: [frameA, frameB], videos: [videoA, videoB] });

    labels.replaceVideos({ oldVideos: [videoA], newVideos: [newA] });

    expect(frameA.video).toBe(newA);
    expect(frameB.video).toBe(videoB);
    expect(labels.videos).toEqual([newA, videoB]);
  });
});
