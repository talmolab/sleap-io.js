/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  Centroid,
  UserCentroid,
  PredictedCentroid,
  getCentroidSkeleton,
  CENTROID_SKELETON,
} from "../src/model/centroid.js";
import { Instance, PredictedInstance, Track } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Labels } from "../src/model/labels.js";
import { Video } from "../src/model/video.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";

describe("Centroid", () => {
  it("is abstract — cannot be instantiated directly", () => {
    expect(() => new (Centroid as any)({ x: 10, y: 20 })).toThrow(TypeError);
  });

  it("constructs UserCentroid with defaults", () => {
    const c = new UserCentroid({ x: 10.5, y: 20.3 });
    expect(c.x).toBe(10.5);
    expect(c.y).toBe(20.3);
    expect(c.z).toBeNull();
    expect(c.track).toBeNull();
    expect(c.trackingScore).toBeNull();
    expect(c.instance).toBeNull();
    expect(c.category).toBe("");
    expect(c.name).toBe("");
    expect(c.source).toBe("");
    expect(c.isPredicted).toBe(false);
  });

  it("constructs UserCentroid with all options", () => {
    const track = new Track("track1");
    const c = new UserCentroid({
      x: 100, y: 200, z: 1.5,
      track,
      trackingScore: 0.8,
      category: "cell",
      name: "ID42",
      source: "center_of_mass",
    });
    expect(c.z).toBe(1.5);
    expect(c.track).toBe(track);
    expect(c.trackingScore).toBe(0.8);
    expect(c.category).toBe("cell");
    expect(c.name).toBe("ID42");
    expect(c.source).toBe("center_of_mass");
  });

  it("constructs PredictedCentroid with score", () => {
    const c = new PredictedCentroid({ x: 50, y: 60, score: 0.95 });
    expect(c.x).toBe(50);
    expect(c.y).toBe(60);
    expect(c.score).toBe(0.95);
    expect(c.isPredicted).toBe(true);
  });

  it("xy, yx, xyz properties", () => {
    const c = new UserCentroid({ x: 10, y: 20, z: 3 });
    expect(c.xy).toEqual([10, 20]);
    expect(c.yx).toEqual([20, 10]);
    expect(c.xyz).toEqual([10, 20, 3]);

    const c2 = new UserCentroid({ x: 5, y: 6 });
    expect(c2.xyz).toEqual([5, 6, null]);
  });

  it("getCentroidSkeleton returns singleton", () => {
    const s1 = getCentroidSkeleton();
    const s2 = getCentroidSkeleton();
    expect(s1).toBe(s2);
    expect(s1.nodes.length).toBe(1);
    expect(s1.nodeNames[0]).toBe("centroid");
  });

  it("CENTROID_SKELETON is the singleton", () => {
    expect(CENTROID_SKELETON).toBe(getCentroidSkeleton());
  });

  it("toInstance creates single-node Instance from UserCentroid", () => {
    const c = new UserCentroid({ x: 100, y: 200 });
    const inst = c.toInstance();
    expect(inst).toBeInstanceOf(Instance);
    expect(inst.skeleton.nodes.length).toBe(1);
    expect(inst.points[0].xy).toEqual([100, 200]);
    expect(inst.points[0].visible).toBe(true);
  });

  it("toInstance creates PredictedInstance from PredictedCentroid", () => {
    const track = new Track("t");
    const c = new PredictedCentroid({ x: 50, y: 60, score: 0.9, track, trackingScore: 0.5 });
    const inst = c.toInstance();
    expect(inst).toBeInstanceOf(PredictedInstance);
    expect((inst as PredictedInstance).score).toBe(0.9);
    expect(inst.track).toBe(track);
    expect(inst.points[0].xy).toEqual([50, 60]);
  });

  it("toInstance rejects skeleton with more than 1 node", () => {
    const c = new UserCentroid({ x: 10, y: 20 });
    const skel = new Skeleton(["a", "b"]);
    expect(() => c.toInstance(skel)).toThrow(/exactly 1 node/);
  });

  it("fromInstance centerOfMass method", () => {
    const skel = new Skeleton(["a", "b", "c"]);
    const inst = new Instance({
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [30, 40], visible: true, complete: true },
        { xy: [Number.NaN, Number.NaN], visible: false, complete: false },
      ],
      skeleton: skel,
    });
    const c = Centroid.fromInstance(inst);
    expect(c).toBeInstanceOf(UserCentroid);
    expect(c.x).toBe(20);
    expect(c.y).toBe(30);
    expect(c.source).toBe("centerOfMass");
    expect(c.instance).toBe(inst);
  });

  it("fromInstance bboxCenter method", () => {
    const skel = new Skeleton(["a", "b"]);
    const inst = new Instance({
      points: [
        { xy: [0, 0], visible: true, complete: true },
        { xy: [100, 200], visible: true, complete: true },
      ],
      skeleton: skel,
    });
    const c = Centroid.fromInstance(inst, { method: "bboxCenter" });
    expect(c.x).toBe(50);
    expect(c.y).toBe(100);
    expect(c.source).toBe("bboxCenter");
  });

  it("fromInstance anchor method", () => {
    const skel = new Skeleton(["head", "tail"]);
    const inst = new Instance({
      points: [
        { xy: [10, 20], visible: true, complete: true, name: "head" },
        { xy: [30, 40], visible: true, complete: true, name: "tail" },
      ],
      skeleton: skel,
    });
    const c = Centroid.fromInstance(inst, { method: "anchor", node: "head" });
    expect(c.x).toBe(10);
    expect(c.y).toBe(20);
    expect(c.source).toBe("anchor:head");
  });

  it("fromInstance anchor with index", () => {
    const skel = new Skeleton(["a", "b"]);
    const inst = new Instance({
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [30, 40], visible: true, complete: true },
      ],
      skeleton: skel,
    });
    const c = Centroid.fromInstance(inst, { method: "anchor", node: 1 });
    expect(c.x).toBe(30);
    expect(c.y).toBe(40);
  });

  it("fromInstance preserves predicted status", () => {
    const skel = new Skeleton(["a"]);
    const inst = new PredictedInstance({
      points: [{ xy: [10, 20], visible: true, complete: true, score: 0.9 }],
      skeleton: skel,
      score: 0.85,
    });
    const c = Centroid.fromInstance(inst);
    expect(c).toBeInstanceOf(PredictedCentroid);
    expect((c as PredictedCentroid).score).toBe(0.85);
  });

  it("fromInstance throws with no visible points", () => {
    const skel = new Skeleton(["a"]);
    const inst = new Instance({
      points: [{ xy: [Number.NaN, Number.NaN], visible: false, complete: false }],
      skeleton: skel,
    });
    expect(() => Centroid.fromInstance(inst)).toThrow(/No visible points/);
  });

  it("fromInstance throws with unknown method", () => {
    const skel = new Skeleton(["a"]);
    const inst = new Instance({
      points: [{ xy: [10, 20], visible: true, complete: true }],
      skeleton: skel,
    });
    expect(() => Centroid.fromInstance(inst, { method: "invalid" })).toThrow(/Unknown method/);
  });
});

describe("Instance.centroidXy", () => {
  it("returns mean of visible points", () => {
    const skel = new Skeleton(["a", "b"]);
    const inst = new Instance({
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [30, 40], visible: true, complete: true },
      ],
      skeleton: skel,
    });
    expect(inst.centroidXy).toEqual([20, 30]);
  });

  it("returns null when no points visible", () => {
    const skel = new Skeleton(["a"]);
    const inst = new Instance({
      points: [{ xy: [Number.NaN, Number.NaN], visible: false, complete: false }],
      skeleton: skel,
    });
    expect(inst.centroidXy).toBeNull();
  });
});

describe("Instance.toCentroid", () => {
  it("delegates to Centroid.fromInstance", () => {
    const skel = new Skeleton(["a", "b"]);
    const inst = new Instance({
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [30, 40], visible: true, complete: true },
      ],
      skeleton: skel,
    });
    const c = inst.toCentroid();
    expect(c).toBeInstanceOf(UserCentroid);
    expect(c.x).toBe(20);
    expect(c.y).toBe(30);
  });
});

describe("Labels.getCentroids", () => {
  it("filters centroids by video and frameIdx", () => {
    const v1 = new Video({ filename: "v1.mp4" });
    const v2 = new Video({ filename: "v2.mp4" });
    const t1 = new Track("t1");

    const lf0v1 = new LabeledFrame({ video: v1, frameIdx: 0 });
    lf0v1.centroids.push(new UserCentroid({ x: 1, y: 2 }));
    const lf1v1 = new LabeledFrame({ video: v1, frameIdx: 1 });
    lf1v1.centroids.push(new UserCentroid({ x: 3, y: 4 }));
    const lf0v2 = new LabeledFrame({ video: v2, frameIdx: 0 });
    lf0v2.centroids.push(new PredictedCentroid({ x: 5, y: 6, score: 0.9, track: t1 }));

    const labels = new Labels({
      labeledFrames: [lf0v1, lf1v1, lf0v2],
      videos: [v1, v2],
      tracks: [t1],
    });

    expect(labels.getCentroids()).toHaveLength(3);
    expect(labels.getCentroids({ video: v1 })).toHaveLength(2);
    expect(labels.getCentroids({ frameIdx: 0 })).toHaveLength(2);
    expect(labels.getCentroids({ video: v1, frameIdx: 0 })).toHaveLength(1);
    expect(labels.getCentroids({ predicted: true })).toHaveLength(1);
    expect(labels.getCentroids({ predicted: false })).toHaveLength(2);
    expect(labels.getCentroids({ track: t1 })).toHaveLength(1);
  });
});
