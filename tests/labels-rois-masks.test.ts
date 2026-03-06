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
  AnnotationType,
} from "../src/index.js";

describe("Labels ROI and Mask integration", () => {
  it("stores rois and masks", () => {
    const video = new Video({ filename: "test.mp4" });
    const roi = ROI.fromBbox(10, 20, 100, 200, { video });
    const mask = SegmentationMask.fromArray(new Uint8Array(16), 4, 4, { video });
    const labels = new Labels({ videos: [video], rois: [roi], masks: [mask] });
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
    const temporalRoi = ROI.fromBbox(0, 0, 20, 20, { video, frameIdx: 5 });
    const labels = new Labels({ rois: [staticRoi, temporalRoi] });

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
    const labels = new Labels({ videos: [v1, v2], rois: [roi1, roi2] });

    expect(labels.getRois({ video: v1 })).toEqual([roi1]);
    expect(labels.getRois({ video: v2 })).toEqual([roi2]);
  });

  it("getRois filters by frameIdx", () => {
    const roi1 = ROI.fromBbox(0, 0, 10, 10, { frameIdx: 0 });
    const roi2 = ROI.fromBbox(0, 0, 10, 10, { frameIdx: 5 });
    const roi3 = ROI.fromBbox(0, 0, 10, 10);
    const labels = new Labels({ rois: [roi1, roi2, roi3] });

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

  it("getRois filters by annotationType", () => {
    const roi1 = ROI.fromBbox(0, 0, 10, 10);
    const roi2 = ROI.fromPolygon([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const labels = new Labels({ rois: [roi1, roi2] });

    expect(labels.getRois({ annotationType: AnnotationType.BOUNDING_BOX })).toEqual([roi1]);
    expect(labels.getRois({ annotationType: AnnotationType.SEGMENTATION })).toEqual([roi2]);
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
    const roi1 = ROI.fromBbox(0, 0, 10, 10, { video: v1, category: "animal", frameIdx: 0 });
    const roi2 = ROI.fromBbox(0, 0, 10, 10, { video: v1, category: "arena", frameIdx: 0 });
    const roi3 = ROI.fromBbox(0, 0, 10, 10, { video: v1, category: "animal", frameIdx: 5 });
    const labels = new Labels({ rois: [roi1, roi2, roi3] });

    const result = labels.getRois({ video: v1, category: "animal", frameIdx: 0 });
    expect(result).toEqual([roi1]);
  });

  it("getMasks filters by frameIdx", () => {
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { frameIdx: 0 });
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { frameIdx: 3 });
    const labels = new Labels({ masks: [m1, m2] });

    expect(labels.getMasks({ frameIdx: 0 })).toEqual([m1]);
    expect(labels.getMasks({ frameIdx: 3 })).toEqual([m2]);
  });

  it("getMasks filters by category", () => {
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { category: "bg" });
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { category: "fg" });
    const labels = new Labels({ masks: [m1, m2] });

    expect(labels.getMasks({ category: "bg" })).toEqual([m1]);
  });

  it("getMasks filters by video", () => {
    const v1 = new Video({ filename: "a.mp4" });
    const v2 = new Video({ filename: "b.mp4" });
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { video: v1 });
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { video: v2 });
    const labels = new Labels({ masks: [m1, m2] });

    expect(labels.getMasks({ video: v1 })).toEqual([m1]);
    expect(labels.getMasks({ video: v2 })).toEqual([m2]);
  });

  it("getMasks filters by track", () => {
    const track = new Track({ name: "t1" });
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, { track });
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2);
    const labels = new Labels({ masks: [m1, m2] });

    expect(labels.getMasks({ track })).toEqual([m1]);
  });

  it("getMasks filters by annotationType", () => {
    const m1 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, {
      annotationType: AnnotationType.SEGMENTATION,
    });
    const m2 = SegmentationMask.fromArray(new Uint8Array(4), 2, 2, {
      annotationType: AnnotationType.ARENA,
    });
    const labels = new Labels({ masks: [m1, m2] });

    expect(labels.getMasks({ annotationType: AnnotationType.SEGMENTATION })).toEqual([m1]);
    expect(labels.getMasks({ annotationType: AnnotationType.ARENA })).toEqual([m2]);
  });
});
