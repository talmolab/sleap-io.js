/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  Labels,
  Video,
  Skeleton,
  Instance,
  Track,
  ROI,
  SegmentationMask,
  UserBoundingBox,
  PredictedBoundingBox,
  LabeledFrame,
} from "../src/index.js";

describe("Labels ROI and Mask integration", () => {
  it("stores rois and masks on frames", () => {
    const video = new Video({ filename: "test.mp4" });
    const roi = ROI.fromBbox(10, 20, 100, 200, { video });
    const mask = SegmentationMask.fromArray(new Uint8Array(16), 4, 4);
    const lf = new LabeledFrame({ video, frameIdx: 0, rois: [roi], masks: [mask] });
    const labels = new Labels({ labeledFrames: [lf], videos: [video] });
    expect(labels.rois).toHaveLength(1);
    expect(labels.masks).toHaveLength(1);
    expect(labels.rois[0]).toBe(roi);
    expect(labels.masks[0]).toBe(mask);
  });

  it("defaults rois and masks to empty arrays", () => {
    const labels = new Labels();
    expect(labels.rois).toEqual([]);
    expect(labels.masks).toEqual([]);
  });

  it("filters staticRois and temporalRois", () => {
    const video = new Video({ filename: "test.mp4" });
    const staticRoi = ROI.fromBbox(0, 0, 10, 10, { video });
    const temporalRoi = ROI.fromBbox(0, 0, 20, 20, { video });
    const lf = new LabeledFrame({ video, frameIdx: 5, rois: [temporalRoi] });
    const labels = new Labels({ labeledFrames: [lf], rois: [staticRoi] });

    expect(labels.staticRois).toHaveLength(1);
    expect(labels.staticRois[0]).toBe(staticRoi);
    expect(labels.temporalRois).toHaveLength(1);
    expect(labels.temporalRois[0]).toBe(temporalRoi);
  });

  it("getRois filters by video", () => {
    const v1 = new Video({ filename: "a.mp4" });
    const v2 = new Video({ filename: "b.mp4" });
    const roi1 = ROI.fromBbox(0, 0, 10, 10, { video: v1 });
    const roi2 = ROI.fromBbox(0, 0, 10, 10, { video: v2 });
    const lf1 = new LabeledFrame({ video: v1, frameIdx: 0, rois: [roi1] });
    const lf2 = new LabeledFrame({ video: v2, frameIdx: 0, rois: [roi2] });
    const labels = new Labels({ labeledFrames: [lf1, lf2], videos: [v1, v2] });

    expect(labels.getRois({ video: v1 })).toEqual([roi1]);
    expect(labels.getRois({ video: v2 })).toEqual([roi2]);
  });

  it("getRois filters by frameIdx", () => {
    const v = new Video({ filename: "test.mp4" });
    const roi1 = ROI.fromBbox(0, 0, 10, 10);
    const roi2 = ROI.fromBbox(0, 0, 10, 10);
    const roi3 = ROI.fromBbox(0, 0, 10, 10);
    const lf0 = new LabeledFrame({ video: v, frameIdx: 0, rois: [roi1] });
    const lf5 = new LabeledFrame({ video: v, frameIdx: 5, rois: [roi2] });
    const labels = new Labels({ labeledFrames: [lf0, lf5], rois: [roi3] });

    expect(labels.getRois({ frameIdx: 0 })).toEqual([roi1]);
    expect(labels.getRois({ frameIdx: 5 })).toEqual([roi2]);
  });

  it("getRois filters by category", () => {
    const roi1 = ROI.fromBbox(0, 0, 10, 10, { category: "animal" });
    const roi2 = ROI.fromBbox(0, 0, 10, 10, { category: "arena" });
    const labels = new Labels({ rois: [roi1, roi2] });

    expect(labels.getRois({ category: "animal" })).toEqual([roi1]);
    expect(labels.getRois({ category: "arena" })).toEqual([roi2]);
  });

  it("getRois filters by track and instance", () => {
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track({ name: "track1" });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton, track });
    const roi1 = ROI.fromBbox(0, 0, 10, 10, { track, instance: inst });
    const roi2 = ROI.fromBbox(0, 0, 10, 10);
    const labels = new Labels({ rois: [roi1, roi2] });

    expect(labels.getRois({ track })).toEqual([roi1]);
    expect(labels.getRois({ instance: inst })).toEqual([roi1]);
  });

  it("getRois with combined filters uses AND logic", () => {
    const v1 = new Video({ filename: "a.mp4" });
    const roi1 = ROI.fromBbox(0, 0, 10, 10, { video: v1, category: "animal" });
    const roi2 = ROI.fromBbox(0, 0, 10, 10, { video: v1, category: "arena" });
    const roi3 = ROI.fromBbox(0, 0, 10, 10, { video: v1, category: "animal" });
    const lf0 = new LabeledFrame({ video: v1, frameIdx: 0, rois: [roi1, roi2] });
    const lf5 = new LabeledFrame({ video: v1, frameIdx: 5, rois: [roi3] });
    const labels = new Labels({ labeledFrames: [lf0, lf5] });

    const result = labels.getRois({ video: v1, category: "animal", frameIdx: 0 });
    expect(result).toEqual([roi1]);
  });

  it("getMasks filters by frameIdx", () => {
    const v = new Video({ filename: "test.mp4" });
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2);
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2);
    const lf0 = new LabeledFrame({ video: v, frameIdx: 0, masks: [m1] });
    const lf3 = new LabeledFrame({ video: v, frameIdx: 3, masks: [m2] });
    const labels = new Labels({ labeledFrames: [lf0, lf3] });

    expect(labels.getMasks({ frameIdx: 0 })).toEqual([m1]);
    expect(labels.getMasks({ frameIdx: 3 })).toEqual([m2]);
  });

  it("getMasks filters by category", () => {
    const v = new Video({ filename: "test.mp4" });
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { category: "bg" });
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { category: "fg" });
    const lf = new LabeledFrame({ video: v, frameIdx: 0, masks: [m1, m2] });
    const labels = new Labels({ labeledFrames: [lf] });

    expect(labels.getMasks({ category: "bg" })).toEqual([m1]);
  });

  it("getMasks filters by video", () => {
    const v1 = new Video({ filename: "a.mp4" });
    const v2 = new Video({ filename: "b.mp4" });
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2);
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2);
    const lf1 = new LabeledFrame({ video: v1, frameIdx: 0, masks: [m1] });
    const lf2 = new LabeledFrame({ video: v2, frameIdx: 0, masks: [m2] });
    const labels = new Labels({ labeledFrames: [lf1, lf2] });

    expect(labels.getMasks({ video: v1 })).toEqual([m1]);
    expect(labels.getMasks({ video: v2 })).toEqual([m2]);
  });

  it("getMasks filters by track", () => {
    const track = new Track({ name: "t1" });
    const v = new Video({ filename: "test.mp4" });
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { track });
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2);
    const lf = new LabeledFrame({ video: v, frameIdx: 0, masks: [m1, m2] });
    const labels = new Labels({ labeledFrames: [lf] });

    expect(labels.getMasks({ track })).toEqual([m1]);
  });
});

describe("getBboxes", () => {
  it("returns all bboxes without filters", () => {
    const bb1 = new UserBoundingBox({ x1: 0, y1: 10, x2: 100, y2: 90 });
    const bb2 = new PredictedBoundingBox({ x1: 0, y1: 5, x2: 40, y2: 35, score: 0.9 });
    const v = new Video({ filename: "test.mp4" });
    const lf = new LabeledFrame({ video: v, frameIdx: 0, bboxes: [bb1, bb2] });
    const labels = new Labels({ labeledFrames: [lf] });
    expect(labels.getBboxes()).toHaveLength(2);
  });

  it("filters by video", () => {
    const v1 = new Video({ filename: "a.mp4" });
    const v2 = new Video({ filename: "b.mp4" });
    const bb1 = new UserBoundingBox({ x1: 0, y1: 10, x2: 100, y2: 90 });
    const bb2 = new UserBoundingBox({ x1: 0, y1: 5, x2: 40, y2: 35 });
    const lf1 = new LabeledFrame({ video: v1, frameIdx: 0, bboxes: [bb1] });
    const lf2 = new LabeledFrame({ video: v2, frameIdx: 0, bboxes: [bb2] });
    const labels = new Labels({ labeledFrames: [lf1, lf2] });
    expect(labels.getBboxes({ video: v1 })).toEqual([bb1]);
    expect(labels.getBboxes({ video: v2 })).toEqual([bb2]);
  });

  it("filters by predicted", () => {
    const bb1 = new UserBoundingBox({ x1: 0, y1: 10, x2: 100, y2: 90 });
    const bb2 = new PredictedBoundingBox({ x1: 0, y1: 5, x2: 40, y2: 35, score: 0.9 });
    const v = new Video({ filename: "test.mp4" });
    const lf = new LabeledFrame({ video: v, frameIdx: 0, bboxes: [bb1, bb2] });
    const labels = new Labels({ labeledFrames: [lf] });
    expect(labels.getBboxes({ predicted: false })).toEqual([bb1]);
    expect(labels.getBboxes({ predicted: true })).toEqual([bb2]);
  });

  it("bboxes on frames are accessible via getBboxes", () => {
    const v = new Video({ filename: "test.mp4" });
    const bb1 = new UserBoundingBox({ x1: 0, y1: 10, x2: 100, y2: 90 });
    const bb2 = new UserBoundingBox({ x1: 0, y1: 5, x2: 40, y2: 35 });
    const lf0 = new LabeledFrame({ video: v, frameIdx: 0, bboxes: [bb1] });
    const lf5 = new LabeledFrame({ video: v, frameIdx: 5, bboxes: [bb2] });
    const labels = new Labels({ labeledFrames: [lf0, lf5] });
    expect(labels.getBboxes({ frameIdx: 0 })).toEqual([bb1]);
    expect(labels.getBboxes({ frameIdx: 5 })).toEqual([bb2]);
  });

  it("defaults bboxes to empty array", () => {
    const labels = new Labels();
    expect(labels.bboxes).toEqual([]);
  });
});
