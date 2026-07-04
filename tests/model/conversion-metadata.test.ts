// Tests for sleap-io PR #504 parity: tracking_score and _instance_idx are
// preserved through annotation conversions (bbox<->roi<->mask, mask.resampled).

import { describe, it, expect } from "../bun-test";
import { UserBoundingBox, PredictedBoundingBox } from "../../src/model/bbox.js";
import { UserROI, PredictedROI } from "../../src/model/roi.js";
import {
  SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
  encodeRle,
} from "../../src/model/mask.js";

function blockRaster(h: number, w: number): Uint8Array {
  const a = new Uint8Array(h * w);
  for (let r = 2; r < h - 2; r++)
    for (let c = 2; c < w - 2; c++) a[r * w + c] = 1;
  return a;
}

describe("conversions preserve tracking_score and _instance_idx (#504)", () => {
  it("BoundingBox.toRoi() carries trackingScore and _instanceIdx", () => {
    const bb = new UserBoundingBox({
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      trackingScore: 0.42,
    });
    bb._instanceIdx = 7;
    const roi = bb.toRoi();
    expect(roi.trackingScore).toBeCloseTo(0.42);
    expect(roi._instanceIdx).toBe(7);
  });

  it("SegmentationMask.toBbox() carries trackingScore, _instanceIdx, and score", () => {
    const mask = new PredictedSegmentationMask({
      rleCounts: encodeRle(blockRaster(16, 16), 16, 16),
      height: 16,
      width: 16,
      score: 0.9,
      trackingScore: 0.31,
    });
    mask._instanceIdx = 4;
    const bb = mask.toBbox();
    expect(bb.trackingScore).toBeCloseTo(0.31);
    expect(bb._instanceIdx).toBe(4);
    expect(bb).toBeInstanceOf(PredictedBoundingBox);
    expect((bb as PredictedBoundingBox).score).toBeCloseTo(0.9);
  });

  it("SegmentationMask.toPolygon() carries trackingScore and _instanceIdx", () => {
    const mask = SegmentationMask.fromArray(blockRaster(16, 16), 16, 16, {
      trackingScore: 0.55,
    });
    mask._instanceIdx = 2;
    const roi = mask.toPolygon();
    expect(roi.trackingScore).toBeCloseTo(0.55);
    expect(roi._instanceIdx).toBe(2);
  });

  it("SegmentationMask.resampled() carries trackingScore and _instanceIdx", () => {
    const mask = SegmentationMask.fromArray(blockRaster(16, 16), 16, 16, {
      trackingScore: 0.66,
    });
    mask._instanceIdx = 9;
    const out = mask.resampled(32, 32);
    expect(out.trackingScore).toBeCloseTo(0.66);
    expect(out._instanceIdx).toBe(9);
    // Predicted variant keeps its score too.
    const pred = new PredictedSegmentationMask({
      rleCounts: encodeRle(blockRaster(16, 16), 16, 16),
      height: 16,
      width: 16,
      score: 0.8,
      trackingScore: 0.12,
    });
    pred._instanceIdx = 5;
    const outP = pred.resampled(8, 8) as PredictedSegmentationMask;
    expect(outP.trackingScore).toBeCloseTo(0.12);
    expect(outP._instanceIdx).toBe(5);
    expect(outP.score).toBeCloseTo(0.8);
  });

  it("ROI.toMask() carries trackingScore and _instanceIdx", () => {
    const roi = UserROI.fromPolygon(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      { trackingScore: 0.77 },
    );
    roi._instanceIdx = 3;
    const mask = roi.toMask(16, 16);
    expect(mask.trackingScore).toBeCloseTo(0.77);
    expect(mask._instanceIdx).toBe(3);
  });

  it("predicted ROI.toMask() preserves score alongside trackingScore", () => {
    const roi = new PredictedROI({
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 8],
            [0, 0],
          ],
        ],
      },
      score: 0.65,
      trackingScore: 0.22,
    });
    roi._instanceIdx = 1;
    const mask = roi.toMask(16, 16);
    expect(mask).toBeInstanceOf(PredictedSegmentationMask);
    expect((mask as PredictedSegmentationMask).score).toBeCloseTo(0.65);
    expect(mask.trackingScore).toBeCloseTo(0.22);
    expect(mask._instanceIdx).toBe(1);
  });

  it("user mask conversions stay user-typed", () => {
    const mask = SegmentationMask.fromArray(blockRaster(12, 12), 12, 12);
    expect(mask).toBeInstanceOf(UserSegmentationMask);
    expect(mask.toBbox()).toBeInstanceOf(UserBoundingBox);
    expect(mask.toPolygon()).toBeInstanceOf(UserROI);
    expect(mask.resampled(6, 6)).toBeInstanceOf(UserSegmentationMask);
  });
});
