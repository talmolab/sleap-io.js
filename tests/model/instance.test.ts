/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  Point,
  PredictedPoint,
  pointsFromArray,
  predictedPointsFromArray,
  Instance,
  PredictedInstance,
} from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";

describe("Point", () => {
  it("can be created without score", () => {
    const point: Point = { xy: [10, 20], visible: true, complete: false };
    expect(point.score).toBeUndefined();
  });

  it("can be created with optional score", () => {
    const point: Point = { xy: [10, 20], visible: true, complete: false, score: 0.95 };
    expect(point.score).toBe(0.95);
  });

  it("PredictedPoint requires score", () => {
    const point: PredictedPoint = { xy: [10, 20], visible: true, complete: false, score: 0.8 };
    expect(point.score).toBe(0.8);
  });
});

describe("PredictedInstance.numpy with scores", () => {
  it("includes point scores when scores option is true", () => {
    const skeleton = new Skeleton({ nodes: ["a", "b"] });
    const inst = PredictedInstance.fromArray(
      [[1, 2, 0.9], [3, 4, 0.8]],
      skeleton,
      0.95
    );
    const result = inst.numpy({ scores: true, invisibleAsNaN: false });
    expect(result[0][2]).toBe(0.9);
    expect(result[1][2]).toBe(0.8);
  });
});
