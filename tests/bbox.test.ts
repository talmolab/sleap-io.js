/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { BoundingBox, UserBoundingBox, PredictedBoundingBox } from "../src/model/bbox.js";
import "../src/model/mask.js"; // Ensure mask factory is registered

describe("BoundingBox", () => {
  it("constructs with defaults", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 50, width: 100, height: 80 });
    expect(bb.xCenter).toBe(50);
    expect(bb.width).toBe(100);
    expect(bb.angle).toBe(0);
    expect(bb.isPredicted).toBe(false);
    expect(bb.isStatic).toBe(true);
    expect(bb.isRotated).toBe(false);
  });

  it("fromXyxy creates correct bbox", () => {
    const bb = BoundingBox.fromXyxy(10, 20, 110, 100);
    expect(bb.xCenter).toBe(60);
    expect(bb.yCenter).toBe(60);
    expect(bb.width).toBe(100);
    expect(bb.height).toBe(80);
  });

  it("fromXywh creates correct bbox", () => {
    const bb = BoundingBox.fromXywh(10, 20, 100, 80);
    expect(bb.xCenter).toBe(60);
    expect(bb.yCenter).toBe(60);
    expect(bb.width).toBe(100);
    expect(bb.height).toBe(80);
  });

  it("xyxy returns correct corners", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 50, width: 100, height: 80 });
    expect(bb.xyxy).toEqual([0, 10, 100, 90]);
  });

  it("area is correct", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 50, width: 100, height: 80 });
    expect(bb.area).toBe(8000);
  });

  it("corners handles rotation", () => {
    const bb = new UserBoundingBox({
      xCenter: 0, yCenter: 0, width: 2, height: 2,
      angle: Math.PI / 4, // 45 degrees
    });
    expect(bb.isRotated).toBe(true);
    const corners = bb.corners;
    expect(corners).toHaveLength(4);
    // At 45 degrees, the corners should be rotated
    // The AABB should be larger than the original bbox
    const [x1, y1, x2, y2] = bb.xyxy;
    expect(x2 - x1).toBeGreaterThan(2);
    expect(y2 - y1).toBeGreaterThan(2);
  });

  it("toRoi creates polygon ROI", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 50, width: 100, height: 80 });
    const roi = bb.toRoi();
    expect(roi.geometry.type).toBe("Polygon");
  });

  it("bounds returns correct values", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 50, width: 100, height: 80 });
    const b = bb.bounds;
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(10);
    expect(b.maxX).toBe(100);
    expect(b.maxY).toBe(90);
  });

  it("centroid returns correct center", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 60, width: 100, height: 80 });
    expect(bb.centroid).toEqual({ x: 50, y: 60 });
  });

  it("xywh returns correct values", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 50, width: 100, height: 80 });
    const xywh = bb.xywh;
    expect(xywh.x).toBe(0);
    expect(xywh.y).toBe(10);
    expect(xywh.width).toBe(100);
    expect(xywh.height).toBe(80);
  });

  it("isStatic when frameIdx is set", () => {
    const bb = new UserBoundingBox({ xCenter: 50, yCenter: 50, width: 100, height: 80, frameIdx: 5 });
    expect(bb.isStatic).toBe(false);
  });
});

describe("PredictedBoundingBox", () => {
  it("has score and isPredicted", () => {
    const bb = new PredictedBoundingBox({
      xCenter: 50, yCenter: 50, width: 100, height: 80, score: 0.95,
    });
    expect(bb.score).toBe(0.95);
    expect(bb.isPredicted).toBe(true);
  });
});
