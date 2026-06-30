// Tests for sleap-io PR #509 parity: LabeledFrame.isUserLabeled counts user
// instances, negative anchors, and ANY non-predicted frame-level annotation
// (centroids, bboxes, ROIs, masks, label images). The ROI clause is the
// specific contribution of #509.

import { describe, it, expect } from "../bun-test";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { UserROI, PredictedROI } from "../../src/model/roi.js";
import { UserBoundingBox, PredictedBoundingBox } from "../../src/model/bbox.js";
import {
  SegmentationMask,
  PredictedSegmentationMask,
  encodeRle,
} from "../../src/model/mask.js";
import {
  UserLabelImage,
  PredictedLabelImage,
} from "../../src/model/label-image.js";

const video = new Video({ filename: "v.mp4" });
const skel = new Skeleton({ nodes: ["a"] });

const frame = (opts: Record<string, unknown>) =>
  new LabeledFrame({ video, frameIdx: 0, ...opts });

const block = (): Uint8Array => {
  const a = new Uint8Array(64);
  for (let i = 10; i < 20; i++) a[i] = 1;
  return a;
};
const userMask = () => SegmentationMask.fromArray(block(), 8, 8);
const predMask = () =>
  new PredictedSegmentationMask({
    rleCounts: encodeRle(block(), 8, 8),
    height: 8,
    width: 8,
    score: 0.5,
  });
const userRoi = () =>
  UserROI.fromPolygon([
    [0, 0],
    [5, 0],
    [5, 5],
    [0, 5],
  ]);
const predRoi = () =>
  new PredictedROI({
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
          [0, 0],
        ],
      ],
    },
    score: 0.5,
  });

describe("LabeledFrame.isUserLabeled (#509)", () => {
  it("is false for an empty, non-negative frame", () => {
    expect(frame({}).isUserLabeled).toBe(false);
  });

  it("is true with a user instance, false with only a prediction", () => {
    expect(
      frame({
        instances: [new Instance({ points: { a: [1, 2] }, skeleton: skel })],
      }).isUserLabeled,
    ).toBe(true);
    expect(
      frame({ instances: [PredictedInstance.fromArray([[1, 2]], skel, 0.9)] })
        .isUserLabeled,
    ).toBe(false);
  });

  it("is true for a negative (background) frame", () => {
    expect(frame({ isNegative: true }).isUserLabeled).toBe(true);
  });

  it("is true with a user ROI, false with only a predicted ROI (#509 clause)", () => {
    expect(frame({ rois: [userRoi()] }).isUserLabeled).toBe(true);
    expect(frame({ rois: [predRoi()] }).isUserLabeled).toBe(false);
  });

  it("is true with a user mask, false with only a predicted mask", () => {
    expect(frame({ masks: [userMask()] }).isUserLabeled).toBe(true);
    expect(frame({ masks: [predMask()] }).isUserLabeled).toBe(false);
  });

  it("is true with a user bbox, false with only a predicted bbox", () => {
    expect(
      frame({ bboxes: [UserBoundingBox.fromXyxy(0, 0, 5, 5)] }).isUserLabeled,
    ).toBe(true);
    expect(
      frame({
        bboxes: [
          new PredictedBoundingBox({ x1: 0, y1: 0, x2: 5, y2: 5, score: 0.5 }),
        ],
      }).isUserLabeled,
    ).toBe(false);
  });

  it("is true with a user label image, false with only a predicted one", () => {
    const d = new Int32Array(16);
    d[0] = 1;
    expect(
      frame({ labelImages: [UserLabelImage.fromArray(d, 4, 4)] }).isUserLabeled,
    ).toBe(true);
    expect(
      frame({
        labelImages: [
          new PredictedLabelImage({ data: d, height: 4, width: 4, score: 0.5 }),
        ],
      }).isUserLabeled,
    ).toBe(false);
  });

  it("is true with a user centroid", () => {
    const c = new Instance({
      points: { a: [1, 2] },
      skeleton: skel,
    }).toCentroid();
    expect(frame({ centroids: [c] }).isUserLabeled).toBe(true);
  });
});
