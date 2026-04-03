/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Instance3D, PredictedInstance3D } from "../../src/model/instance3d.js";
import { Skeleton } from "../../src/model/skeleton.js";

const skeleton = new Skeleton({ nodes: ["nose", "ear", "tail"], edges: [["nose", "ear"], ["ear", "tail"]] });

describe("Instance3D", () => {
  it("creates with 3D points", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.points).toEqual(pts);
    expect(inst.skeleton).toBe(skeleton);
    expect(inst.score).toBeUndefined();
    expect(inst.metadata).toEqual({});
  });

  it("nVisible counts non-NaN points", () => {
    const pts = [[1, 2, 3], [NaN, NaN, NaN], [7, 8, 9]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.nVisible).toBe(2);
  });

  it("isEmpty is true when all NaN", () => {
    const pts = [[NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.isEmpty).toBe(true);
  });

  it("isEmpty is false when any point is valid", () => {
    const pts = [[NaN, NaN, NaN], [1, 2, 3], [NaN, NaN, NaN]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.isEmpty).toBe(false);
  });

  it("nVisible is 0 when points is null", () => {
    const inst = new Instance3D({ points: null, skeleton });
    expect(inst.nVisible).toBe(0);
    expect(inst.isEmpty).toBe(true);
  });

  it("creates with optional score", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const inst = new Instance3D({ points: pts, skeleton, score: 0.95 });
    expect(inst.score).toBe(0.95);
  });
});

describe("PredictedInstance3D", () => {
  it("extends Instance3D with pointScores", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const scores = [0.9, 0.8, 0.7];
    const inst = new PredictedInstance3D({ points: pts, skeleton, score: 0.85, pointScores: scores });
    expect(inst.points).toEqual(pts);
    expect(inst.score).toBe(0.85);
    expect(inst.pointScores).toEqual(scores);
    expect(inst).toBeInstanceOf(Instance3D);
  });

  it("pointScores defaults to undefined", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const inst = new PredictedInstance3D({ points: pts, skeleton });
    expect(inst.pointScores).toBeUndefined();
  });
});
