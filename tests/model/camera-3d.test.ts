/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } from "../../src/model/camera.js";
import { Identity } from "../../src/model/identity.js";
import { Instance3D, PredictedInstance3D } from "../../src/model/instance3d.js";
import { Instance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";

const skeleton = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });

describe("InstanceGroup with identity and instance3d", () => {
  it("identity defaults to undefined", () => {
    const group = new InstanceGroup({ instanceByCamera: new Map() });
    expect(group.identity).toBeUndefined();
  });

  it("accepts identity in constructor", () => {
    const identity = new Identity({ name: "mouse_A", color: "#ff0000" });
    const group = new InstanceGroup({ instanceByCamera: new Map(), identity });
    expect(group.identity).toBe(identity);
  });

  it("instance3d defaults to undefined", () => {
    const group = new InstanceGroup({ instanceByCamera: new Map() });
    expect(group.instance3d).toBeUndefined();
  });

  it("accepts Instance3D in constructor", () => {
    const inst3d = new Instance3D({ points: [[1, 2, 3], [4, 5, 6]], skeleton });
    const group = new InstanceGroup({ instanceByCamera: new Map(), instance3d: inst3d });
    expect(group.instance3d).toBe(inst3d);
    expect(group.points).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("points getter delegates to instance3d when present", () => {
    const inst3d = new Instance3D({ points: [[10, 20, 30]], skeleton: new Skeleton({ nodes: ["A"] }) });
    const group = new InstanceGroup({ instanceByCamera: new Map(), instance3d: inst3d });
    expect(group.points).toEqual([[10, 20, 30]]);
  });

  it("points getter returns raw points when no instance3d", () => {
    const group = new InstanceGroup({ instanceByCamera: new Map(), points: [[1, 2, 3]] });
    expect(group.points).toEqual([[1, 2, 3]]);
    expect(group.instance3d).toBeUndefined();
  });

  it("accepts PredictedInstance3D", () => {
    const inst3d = new PredictedInstance3D({
      points: [[1, 2, 3], [4, 5, 6]],
      skeleton,
      score: 0.9,
      pointScores: [0.95, 0.85],
    });
    const group = new InstanceGroup({ instanceByCamera: new Map(), instance3d: inst3d });
    expect(group.instance3d).toBeInstanceOf(PredictedInstance3D);
    expect((group.instance3d as PredictedInstance3D).pointScores).toEqual([0.95, 0.85]);
  });
});
