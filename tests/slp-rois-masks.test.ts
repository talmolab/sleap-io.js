/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import { ROI, PredictedROI } from "../src/model/roi.js";
import { SegmentationMask, UserSegmentationMask, PredictedSegmentationMask } from "../src/model/mask.js";
import { Video } from "../src/model/video.js";
import { Track } from "../src/model/instance.js";
import { Skeleton, Instance } from "../src/index.js";
import { UserBoundingBox, PredictedBoundingBox } from "../src/model/bbox.js";
import { UserLabelImage, PredictedLabelImage } from "../src/model/label-image.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { readSlp } from "../src/codecs/slp/read.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";

async function roundTrip(labels: Labels): Promise<Labels> {
  const bytes = await saveSlpToBytes(labels);
  return readSlp(new Uint8Array(bytes).buffer, { openVideos: false });
}

describe("SLP ROI/Mask I/O", () => {
  it("round-trips ROIs through write and read", async () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("track0");
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const bboxRoi = ROI.fromBbox(10, 20, 100, 200, {
      name: "roi1",
      category: "arena",
      source: "manual",
      video,
      frameIdx: 5,
      track,
    });

    const polyRoi = ROI.fromPolygon(
      [[0, 0], [100, 0], [100, 100], [0, 100]],
      {
        name: "roi2",
        category: "region",
        source: "auto",
        video,
        frameIdx: null,
      },
    );

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
      rois: [bboxRoi, polyRoi],
    });

    const loaded = await roundTrip(labels);

    expect(loaded.rois.length).toBe(2);

    // Check bbox ROI
    const loadedBbox = loaded.rois[0];
    expect(loadedBbox.name).toBe("roi1");
    expect(loadedBbox.category).toBe("arena");
    expect(loadedBbox.source).toBe("manual");
    expect(loadedBbox.frameIdx).toBe(5);
    expect(loadedBbox.video).not.toBeNull();
    expect(loadedBbox.track).not.toBeNull();
    expect(loadedBbox.track!.name).toBe("track0");

    // Verify geometry bounds
    const bboxBounds = loadedBbox.bounds;
    expect(bboxBounds.minX).toBeCloseTo(10);
    expect(bboxBounds.minY).toBeCloseTo(20);
    expect(bboxBounds.maxX).toBeCloseTo(110);
    expect(bboxBounds.maxY).toBeCloseTo(220);

    // Check polygon ROI
    const loadedPoly = loaded.rois[1];
    expect(loadedPoly.name).toBe("roi2");
    expect(loadedPoly.category).toBe("region");
    expect(loadedPoly.source).toBe("auto");
    expect(loadedPoly.frameIdx).toBeNull(); // static ROI
    expect(loadedPoly.video).not.toBeNull();
    expect(loadedPoly.track).toBeNull();
  });

  it("round-trips masks through write and read", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [10, 20] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const maskData = new Uint8Array(100 * 100);
    // Fill a 20x30 rectangle
    for (let r = 10; r < 30; r++) {
      for (let c = 20; c < 50; c++) {
        maskData[r * 100 + c] = 1;
      }
    }

    const mask = SegmentationMask.fromArray(maskData, 100, 100, {
      name: "mask1",
      category: "cell",
      source: "model",
      video,
      frameIdx: 3,
    });

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      masks: [mask],
    });

    const loaded = await roundTrip(labels);

    expect(loaded.masks.length).toBe(1);
    const loadedMask = loaded.masks[0];
    expect(loadedMask.height).toBe(100);
    expect(loadedMask.width).toBe(100);
    expect(loadedMask.name).toBe("mask1");
    expect(loadedMask.category).toBe("cell");
    expect(loadedMask.source).toBe("model");
    expect(loadedMask.frameIdx).toBe(3);
    expect(loadedMask.video).not.toBeNull();

    // Verify RLE round-trips correctly
    const originalData = mask.data;
    const loadedData = loadedMask.data;
    expect(loadedData.length).toBe(originalData.length);
    for (let i = 0; i < originalData.length; i++) {
      expect(loadedData[i]).toBe(originalData[i]);
    }
  });

  it("backward compat: reads file with no ROIs/masks as empty arrays", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.rois).toEqual([]);
    expect(loaded.masks).toEqual([]);
    expect(loaded.bboxes).toEqual([]);
  });

  it("sets format_id to 1.5 when ROIs present", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const roi = ROI.fromBbox(0, 0, 50, 50);
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      rois: [roi],
    });

    // Write and read back - if format_id were wrong, we'd get errors
    const loaded = await roundTrip(labels);
    expect(loaded.rois.length).toBe(1);
  });

  it("sets format_id to 1.4 when no ROIs/masks", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.rois.length).toBe(0);
    expect(loaded.masks.length).toBe(0);
  });

  it("handles empty ROIs/masks arrays", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      rois: [],
      masks: [],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.rois).toEqual([]);
    expect(loaded.masks).toEqual([]);
  });

  it("ROI with null video and track round-trips", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const roi = ROI.fromBbox(0, 0, 50, 50, {
      name: "orphan",
      video: null,
      track: null,
      frameIdx: null,
    });

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      rois: [roi],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.rois.length).toBe(1);
    const loadedRoi = loaded.rois[0];
    expect(loadedRoi.video).toBeNull();
    expect(loadedRoi.track).toBeNull();
    expect(loadedRoi.frameIdx).toBeNull();
    expect(loadedRoi.name).toBe("orphan");
  });

  it("mask round-trips metadata", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const maskData = new Uint8Array(10 * 10);
    maskData[15] = 1;
    maskData[16] = 1;
    maskData[17] = 1;

    const mask = SegmentationMask.fromArray(maskData, 10, 10, {
      name: "predicted_mask",
      category: "obj",
    });

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      masks: [mask],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.masks.length).toBe(1);
    expect(loaded.masks[0].name).toBe("predicted_mask");
    expect(loaded.masks[0].category).toBe("obj");
    expect(loaded.masks[0].area).toBe(3);
  });
});

describe("SLP BoundingBox I/O", () => {
  it("round-trips bboxes through write and read", async () => {
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("track0");
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const bb1 = new UserBoundingBox({
      x1: 0, y1: 20, x2: 100, y2: 100,
      video, frameIdx: 3, track, category: "animal", name: "bb1", source: "manual",
    });
    const bb2 = new PredictedBoundingBox({
      x1: 0, y1: 5, x2: 40, y2: 55,
      score: 0.95, video, frameIdx: 1,
    });

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
      bboxes: [bb1, bb2],
    });

    const loaded = await roundTrip(labels);

    expect(loaded.bboxes.length).toBe(2);

    const loadedBb1 = loaded.bboxes[0];
    expect(loadedBb1.x1).toBeCloseTo(0);
    expect(loadedBb1.y1).toBeCloseTo(20);
    expect(loadedBb1.x2).toBeCloseTo(100);
    expect(loadedBb1.y2).toBeCloseTo(100);
    expect(loadedBb1.xCenter).toBeCloseTo(50);
    expect(loadedBb1.yCenter).toBeCloseTo(60);
    expect(loadedBb1.width).toBeCloseTo(100);
    expect(loadedBb1.height).toBeCloseTo(80);
    expect(loadedBb1.isPredicted).toBe(false);
    expect(loadedBb1.category).toBe("animal");
    expect(loadedBb1.name).toBe("bb1");
    expect(loadedBb1.source).toBe("manual");
    expect(loadedBb1.frameIdx).toBe(3);
    expect(loadedBb1.video).not.toBeNull();
    expect(loadedBb1.track).not.toBeNull();
    expect(loadedBb1.track!.name).toBe("track0");

    const loadedBb2 = loaded.bboxes[1];
    expect(loadedBb2.x1).toBeCloseTo(0);
    expect(loadedBb2.y1).toBeCloseTo(5);
    expect(loadedBb2.x2).toBeCloseTo(40);
    expect(loadedBb2.y2).toBeCloseTo(55);
    expect(loadedBb2.xCenter).toBeCloseTo(20);
    expect(loadedBb2.yCenter).toBeCloseTo(30);
    expect(loadedBb2.width).toBeCloseTo(40);
    expect(loadedBb2.height).toBeCloseTo(50);
    expect(loadedBb2.isPredicted).toBe(true);
    expect((loadedBb2 as PredictedBoundingBox).score).toBeCloseTo(0.95);
    expect(loadedBb2.frameIdx).toBe(1);
  });

  it("handles empty bboxes array", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      bboxes: [],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.bboxes).toEqual([]);
  });
});

describe("SLP ROI instance association (format 1.6)", () => {
  it("round-trips ROI instance references", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst0 = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    const inst1 = new Instance({ points: { A: [50, 60], B: [70, 80] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst0, inst1] });

    const roi = ROI.fromPolygon(
      [[0, 0], [100, 0], [100, 100], [0, 100]],
      { name: "inst-roi", video, frameIdx: 0, instance: inst1 },
    );

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      rois: [roi],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.rois.length).toBe(1);
    const loadedRoi = loaded.rois[0];
    expect(loadedRoi.name).toBe("inst-roi");
    expect(loadedRoi.instance).not.toBeNull();
    // Should resolve to the second instance (index 1)
    expect(loadedRoi.instance).toBe(loaded.labeledFrames[0].instances[1]);
  });

  it("ROI without instance round-trips with null instance", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const roi = ROI.fromBbox(0, 0, 50, 50, { name: "no-inst" });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      rois: [roi],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.rois.length).toBe(1);
    expect(loaded.rois[0].instance).toBeNull();
  });
});

describe("SLP Predicted Variant Roundtrips", () => {
  it("round-trips PredictedROI with score", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const roi = new PredictedROI({
      geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      score: 0.75, name: "pred", category: "obj",
    });

    const labels = new Labels({
      labeledFrames: [frame], videos: [video], skeletons: [skeleton], rois: [roi],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.rois).toHaveLength(1);
    expect(loaded.rois[0].isPredicted).toBe(true);
    expect(loaded.rois[0]).toBeInstanceOf(PredictedROI);
    expect((loaded.rois[0] as PredictedROI).score).toBeCloseTo(0.75);
    expect(loaded.rois[0].name).toBe("pred");
  });

  it("round-trips PredictedSegmentationMask with score", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const data = new Uint8Array(25);
    data[12] = 1; // single pixel
    const rle = (await import("../src/model/mask.js")).encodeRle(data, 5, 5);
    const mask = new PredictedSegmentationMask({
      rleCounts: rle, height: 5, width: 5, score: 0.92,
      name: "pmask", category: "seg", instance: inst,
    });

    const labels = new Labels({
      labeledFrames: [frame], videos: [video], skeletons: [skeleton], masks: [mask],
    });

    const loaded = await roundTrip(labels);
    loaded.materialize();
    expect(loaded.masks).toHaveLength(1);
    expect(loaded.masks[0].isPredicted).toBe(true);
    expect(loaded.masks[0]).toBeInstanceOf(PredictedSegmentationMask);
    expect((loaded.masks[0] as PredictedSegmentationMask).score).toBeCloseTo(0.92);
    expect(loaded.masks[0].name).toBe("pmask");
  });

  it("round-trips PredictedLabelImage with score", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const data = new Int32Array(9);
    data[0] = 1;
    data[4] = 2;
    const li = new PredictedLabelImage({
      data, height: 3, width: 3, video, frameIdx: 0, score: 0.85,
    });

    const labels = new Labels({
      labeledFrames: [frame], videos: [video], skeletons: [skeleton], labelImages: [li],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.labelImages).toHaveLength(1);
    expect(loaded.labelImages[0].isPredicted).toBe(true);
    expect(loaded.labelImages[0]).toBeInstanceOf(PredictedLabelImage);
    expect((loaded.labelImages[0] as PredictedLabelImage).score).toBeCloseTo(0.85);
  });
});

describe("SLP Scale/Offset Roundtrips", () => {
  it("round-trips mask scale/offset", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const mask = SegmentationMask.fromArray(
      new Uint8Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 3, 3,
      { video, frameIdx: 0, scale: [2, 3], offset: [10, 20] },
    );

    const labels = new Labels({
      labeledFrames: [frame], videos: [video], skeletons: [skeleton], masks: [mask],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.masks).toHaveLength(1);
    expect(loaded.masks[0].scale[0]).toBeCloseTo(2);
    expect(loaded.masks[0].scale[1]).toBeCloseTo(3);
    expect(loaded.masks[0].offset[0]).toBeCloseTo(10);
    expect(loaded.masks[0].offset[1]).toBeCloseTo(20);
  });

  it("round-trips label image scale/offset", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    const data = new Int32Array(4);
    data[0] = 1;
    const li = new UserLabelImage({
      data, height: 2, width: 2, video, frameIdx: 0,
      scale: [0.5, 0.5], offset: [3, 7],
    });

    const labels = new Labels({
      labeledFrames: [frame], videos: [video], skeletons: [skeleton], labelImages: [li],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.labelImages).toHaveLength(1);
    expect(loaded.labelImages[0].scale[0]).toBeCloseTo(0.5);
    expect(loaded.labelImages[0].scale[1]).toBeCloseTo(0.5);
    expect(loaded.labelImages[0].offset[0]).toBeCloseTo(3);
    expect(loaded.labelImages[0].offset[1]).toBeCloseTo(7);
  });
});
