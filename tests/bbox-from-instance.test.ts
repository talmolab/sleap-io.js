import { describe, it, expect } from "./bun-test";
import {
  BoundingBox,
  UserBoundingBox,
  PredictedBoundingBox,
} from "../src/model/bbox.js";
import { PredictedCentroid, UserCentroid } from "../src/model/centroid.js";
import { Instance, PredictedInstance, Track } from "../src/model/instance.js";
import { Identity } from "../src/model/identity.js";
import { Skeleton } from "../src/model/skeleton.js";

const NAN = Number.NaN;

/** head (10, 20), thorax (30, 60), tail hidden (NaN). */
function makeInstance(skel = new Skeleton(["head", "thorax", "tail"])) {
  return new Instance({
    points: [
      { xy: [10, 20], visible: true, complete: true },
      { xy: [30, 60], visible: true, complete: true },
      { xy: [NAN, NAN], visible: false, complete: false },
    ],
    skeleton: skel,
  });
}

describe("Instance.toBbox / BoundingBox.fromInstance — tight", () => {
  it("fits the visible points and links back to the instance", () => {
    const inst = makeInstance();
    const bb = inst.toBbox();
    expect(bb).toBeInstanceOf(UserBoundingBox);
    expect(bb.xyxy).toEqual([10, 20, 30, 60]);
    expect(bb.angle).toBe(0);
    expect(bb.instance).toBe(inst);
    expect(bb.isEmpty).toBe(false);
  });

  it("ignores points that are hidden even if they have coordinates", () => {
    const inst = new Instance({
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [500, 500], visible: false, complete: false },
      ],
      skeleton: new Skeleton(["a", "b"]),
    });
    expect(inst.toBbox().xyxy).toEqual([10, 20, 10, 20]);
  });

  it("applies scalar and per-axis padding", () => {
    const inst = makeInstance();
    expect(inst.toBbox({ padding: 5 }).xyxy).toEqual([5, 15, 35, 65]);
    expect(inst.toBbox({ padding: [2, 4] }).xyxy).toEqual([8, 16, 32, 64]);
    // Negative padding shrinks, unclamped (Python parity).
    expect(inst.toBbox({ padding: -1 }).xyxy).toEqual([11, 21, 29, 59]);
  });

  it("is the same as BoundingBox.fromInstance", () => {
    const inst = makeInstance();
    expect(BoundingBox.fromInstance(inst, { padding: 3 }).xyxy).toEqual(
      inst.toBbox({ padding: 3 }).xyxy,
    );
  });

  it("returns a NaN box with no visible points, or throws with errorOnEmpty", () => {
    const inst = new Instance({
      points: [{ xy: [NAN, NAN], visible: false, complete: false }],
      skeleton: new Skeleton(["a"]),
    });
    const bb = inst.toBbox();
    expect(bb.isEmpty).toBe(true);
    expect(Number.isNaN(bb.x1)).toBe(true);
    expect(() => inst.toBbox({ errorOnEmpty: true })).toThrow(
      /No visible points/,
    );
  });

  it("predicted instances give predicted boxes with the instance score", () => {
    const pred = PredictedInstance.fromArray(
      [
        [0, 0],
        [40, 10],
      ],
      new Skeleton(["a", "b"]),
      0.83,
    );
    const bb = pred.toBbox();
    expect(bb).toBeInstanceOf(PredictedBoundingBox);
    expect((bb as PredictedBoundingBox).score).toBe(0.83);
    expect(bb.xyxy).toEqual([0, 0, 40, 10]);
  });

  it("inherits track, tracking score, identity and category", () => {
    const inst = makeInstance();
    const track = new Track("mouse_1");
    const identity = new Identity({ name: "M1" });
    inst.track = track;
    inst.trackingScore = 0.7;
    inst.identity = identity;
    inst.identityScore = 0.9;
    inst.category = "mouse";
    inst.categoryScore = 0.6;
    const bb = inst.toBbox();
    expect(bb.track).toBe(track);
    expect(bb.trackingScore).toBe(0.7);
    expect(bb.identity).toBe(identity);
    expect(bb.identityScore).toBe(0.9);
    expect(bb.category).toBe("mouse");
    expect(bb.categoryScore).toBe(0.6);
  });
});

describe("Instance.toBbox — centered", () => {
  it("centers a square box on the center of mass", () => {
    // Center of mass of (10, 20) and (30, 60) is (20, 40).
    const bb = makeInstance().toBbox({ mode: "centered", size: 10 });
    expect(bb.xyxy).toEqual([15, 35, 25, 45]);
  });

  it("supports [w, h] sizes, padding and bbox_center", () => {
    const bb = makeInstance().toBbox({
      mode: "centered",
      size: [10, 20],
      padding: 1,
      centerMethod: "bbox_center",
    });
    expect(bb.xyxy).toEqual([14, 29, 26, 51]);
  });

  it("centers on an anchor node by name or index", () => {
    const inst = makeInstance();
    const byName = inst.toBbox({
      mode: "centered",
      size: 4,
      centerMethod: "anchor",
      node: "head",
    });
    expect(byName.xyxy).toEqual([8, 18, 12, 22]);
    const byIndex = inst.toBbox({
      mode: "centered",
      size: 4,
      centerMethod: "anchor",
      node: 1,
    });
    expect(byIndex.xyxy).toEqual([28, 58, 32, 62]);
  });

  it("treats an occluded anchor as empty, like Python", () => {
    const inst = makeInstance();
    const opts = {
      mode: "centered" as const,
      size: 4,
      centerMethod: "anchor",
      node: "tail",
    };
    expect(inst.toBbox(opts).isEmpty).toBe(true);
    expect(() => inst.toBbox({ ...opts, errorOnEmpty: true })).toThrow();
  });

  it("requires size, and rejects unknown modes", () => {
    const inst = makeInstance();
    expect(() => inst.toBbox({ mode: "centered" })).toThrow(/size/);
    expect(() => inst.toBbox({ mode: "loose" as any })).toThrow(/Unknown mode/);
  });
});

describe("BoundingBox.isEmpty", () => {
  it("is true only when a corner is NaN", () => {
    expect(new UserBoundingBox({ x1: 0, y1: 0, x2: 1, y2: 1 }).isEmpty).toBe(
      false,
    );
    expect(new UserBoundingBox({ x1: 0, y1: NAN, x2: 1, y2: 1 }).isEmpty).toBe(
      true,
    );
  });
});

describe("BoundingBox.pad", () => {
  it("returns a new box of the same class with padded corners", () => {
    const bb = new UserBoundingBox({ x1: 10, y1: 20, x2: 30, y2: 40 });
    const padded = bb.pad(5);
    expect(padded).toBeInstanceOf(UserBoundingBox);
    expect(padded).not.toBe(bb);
    expect(padded.xyxy).toEqual([5, 15, 35, 45]);
    expect(bb.xyxy).toEqual([10, 20, 30, 40]);
    expect(bb.pad([1, 2]).xyxy).toEqual([9, 18, 31, 42]);
  });

  it("keeps score, angle and metadata", () => {
    const inst = makeInstance();
    const track = new Track("t");
    const bb = new PredictedBoundingBox({
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 20,
      angle: 0.5,
      score: 0.4,
      track,
      trackingScore: 0.2,
      instance: inst,
      category: "fly",
      name: "n",
      source: "s",
    });
    bb.identityScore = 0.3;
    bb._instanceIdx = 7;
    const padded = bb.pad(2) as PredictedBoundingBox;
    expect(padded).toBeInstanceOf(PredictedBoundingBox);
    expect(padded.score).toBe(0.4);
    // Pre-rotation extent grows about the same center; angle unchanged.
    expect(padded.angle).toBe(0.5);
    expect(padded.width).toBe(14);
    expect(padded.height).toBe(24);
    expect(padded.centroidXy).toEqual(bb.centroidXy);
    expect(padded.track).toBe(track);
    expect(padded.trackingScore).toBe(0.2);
    expect(padded.instance).toBe(inst);
    expect(padded.category).toBe("fly");
    expect(padded.name).toBe("n");
    expect(padded.source).toBe("s");
    expect(padded.identityScore).toBe(0.3);
    expect(padded._instanceIdx).toBe(7);
  });
});

describe("BoundingBox.toCentroid", () => {
  it("puts a user centroid at the box center with inherited metadata", () => {
    const track = new Track("t");
    const bb = new UserBoundingBox({
      x1: 10,
      y1: 20,
      x2: 30,
      y2: 60,
      track,
      category: "mouse",
    });
    const c = bb.toCentroid();
    expect(c).toBeInstanceOf(UserCentroid);
    expect(c.xy).toEqual([20, 40]);
    expect(c.track).toBe(track);
    expect(c.category).toBe("mouse");
  });

  it("predicted boxes give predicted centroids with the score", () => {
    const bb = new PredictedBoundingBox({
      x1: 0,
      y1: 0,
      x2: 4,
      y2: 4,
      score: 0.9,
    });
    const c = bb.toCentroid() as PredictedCentroid;
    expect(c).toBeInstanceOf(PredictedCentroid);
    expect(c.score).toBe(0.9);
    expect(c.xy).toEqual([2, 2]);
  });

  it("returns NaN for an empty box, or throws with errorOnEmpty", () => {
    const bb = new UserBoundingBox({ x1: NAN, y1: 0, x2: 1, y2: 1 });
    const c = bb.toCentroid();
    expect(Number.isNaN(c.x)).toBe(true);
    expect(Number.isNaN(c.y)).toBe(true);
    expect(() => bb.toCentroid({ errorOnEmpty: true })).toThrow(/degenerate/);
  });
});
