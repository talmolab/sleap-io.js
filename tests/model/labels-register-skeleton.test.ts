import { describe, it, expect } from "../bun-test";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";

/**
 * Port of Python sleap-io PR #447 (`Labels._register_skeleton`) regression
 * tests: structurally-equal, same-order skeletons collapse to one canonical
 * object automatically inside `Labels` construction / `update` / `append` /
 * `extend`, while genuinely different (or reordered) skeletons stay distinct.
 */

function abcSkeleton(): Skeleton {
  return new Skeleton({
    nodes: ["A", "B", "C"],
    edges: [
      ["A", "B"],
      ["B", "C"],
    ],
  });
}

describe("Labels._registerSkeleton (Python #447)", () => {
  it("update() dedupes structurally-equal, same-order skeletons", () => {
    const skel1 = abcSkeleton();
    const skel2 = abcSkeleton();
    expect(skel1).not.toBe(skel2);

    const video = new Video({ filename: "fake.mp4" });
    const inst1 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel1,
    );
    const inst2 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel2,
    );
    const lf1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst1] });
    const lf2 = new LabeledFrame({ video, frameIdx: 1, instances: [inst2] });

    const labels = new Labels({ labeledFrames: [lf1, lf2] });

    expect(labels.skeletons).toHaveLength(1);
    const canonical = labels.skeletons[0];
    expect(inst1.skeleton).toBe(canonical);
    expect(inst2.skeleton).toBe(canonical);
  });

  it("append() dedupes structurally-equal, same-order skeletons", () => {
    const skel1 = abcSkeleton();
    const skel2 = abcSkeleton();

    const video = new Video({ filename: "fake.mp4" });
    const inst1 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel1,
    );
    const inst2 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel2,
    );

    const labels = new Labels();
    labels.append(new LabeledFrame({ video, frameIdx: 0, instances: [inst1] }));
    labels.append(new LabeledFrame({ video, frameIdx: 1, instances: [inst2] }));

    expect(labels.skeletons).toHaveLength(1);
    const canonical = labels.skeletons[0];
    expect(inst1.skeleton).toBe(canonical);
    expect(inst2.skeleton).toBe(canonical);
  });

  it("extend() dedupes structurally-equal, same-order skeletons", () => {
    const skel1 = abcSkeleton();
    const skel2 = abcSkeleton();

    const video = new Video({ filename: "fake.mp4" });
    const inst1 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel1,
    );
    const inst2 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel2,
    );

    const labels = new Labels();
    labels.extend([
      new LabeledFrame({ video, frameIdx: 0, instances: [inst1] }),
      new LabeledFrame({ video, frameIdx: 1, instances: [inst2] }),
    ]);

    expect(labels.skeletons).toHaveLength(1);
    const canonical = labels.skeletons[0];
    expect(inst1.skeleton).toBe(canonical);
    expect(inst2.skeleton).toBe(canonical);
  });

  it("reassigning to a same-order canonical moves no point data", () => {
    const skel1 = abcSkeleton();
    const skel2 = abcSkeleton();

    const video = new Video({ filename: "fake.mp4" });
    const inst1 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel1,
    );
    const inst2 = Instance.fromArray(
      [
        [3, 3],
        [4, 4],
        [5, 5],
      ],
      skel2,
    );

    const before: Record<string, [number, number]> = {
      A: [...inst2.getPoint("A").xy],
      B: [...inst2.getPoint("B").xy],
      C: [...inst2.getPoint("C").xy],
    };
    const orig = inst2.numpy();

    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 0, instances: [inst1] }),
        new LabeledFrame({ video, frameIdx: 1, instances: [inst2] }),
      ],
    });

    expect(labels.skeletons).toHaveLength(1);
    const canonical = labels.skeletons[0];
    expect(inst2.skeleton).toBe(canonical);
    for (const node of ["A", "B", "C"]) {
      expect(inst2.getPoint(node).xy).toEqual(before[node]);
    }
    expect(inst2.numpy()).toEqual(orig);
    expect(inst2.points.map((p) => p.name)).toEqual(canonical.nodeNames);
  });

  it("dedup preserves xy, per-node scores and instance score for predictions", () => {
    const skel1 = abcSkeleton();
    const skel2 = abcSkeleton();

    const video = new Video({ filename: "fake.mp4" });
    const inst1 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skel1,
    );
    // Per-node scores live in the 3rd column of the points data in JS.
    const pred = PredictedInstance.fromNumpy({
      pointsData: [
        [3, 3, 0.1],
        [4, 4, 0.2],
        [5, 5, 0.3],
      ],
      skeleton: skel2,
      score: 0.9,
    });

    const beforeXy: Record<string, [number, number]> = {
      A: [...pred.getPoint("A").xy],
      B: [...pred.getPoint("B").xy],
      C: [...pred.getPoint("C").xy],
    };
    const beforeScore: Record<string, number> = {
      A: pred.getPoint("A").score!,
      B: pred.getPoint("B").score!,
      C: pred.getPoint("C").score!,
    };

    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 0, instances: [inst1] }),
        new LabeledFrame({ video, frameIdx: 1, instances: [pred] }),
      ],
    });

    expect(labels.skeletons).toHaveLength(1);
    expect(pred.skeleton).toBe(labels.skeletons[0]);
    for (const node of ["A", "B", "C"]) {
      expect(pred.getPoint(node).xy).toEqual(beforeXy[node]);
      expect(pred.getPoint(node).score).toBe(beforeScore[node]);
    }
    expect(pred.score).toBe(0.9);
  });

  it("reordered-equal skeletons are kept distinct and safe", () => {
    const skelAbc = new Skeleton({
      nodes: ["A", "B", "C"],
      edges: [
        ["A", "B"],
        ["B", "C"],
      ],
    });
    const skelCba = new Skeleton({
      nodes: ["C", "B", "A"],
      edges: [
        ["A", "B"],
        ["B", "C"],
      ],
    });

    // Same node SET (default match) but different ORDER (strict match fails).
    expect(skelAbc.matches(skelCba)).toBe(true);
    expect(skelAbc.matches(skelCba, { requireSameOrder: true })).toBe(false);

    const video = new Video({ filename: "fake.mp4" });
    const instAbc = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      skelAbc,
    );
    const instCba = Instance.fromArray(
      [
        [9, 9],
        [1, 1],
        [7, 7],
      ],
      skelCba,
    );

    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 0, instances: [instAbc] }),
        new LabeledFrame({ video, frameIdx: 1, instances: [instCba] }),
      ],
    });

    // Reordered-equal skeletons are intentionally NOT merged.
    expect(labels.skeletons).toHaveLength(2);
    // No silent corruption: node "A" still maps to its original positional value.
    expect(instAbc.getPoint("A").xy).toEqual([0, 0]);
    expect(instAbc.getPoint("A").xy).not.toEqual([2, 2]);
  });

  it("re-running update with one skeleton instance does not duplicate it", () => {
    const skel = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });
    const video = new Video({ filename: "fake.mp4" });
    const inst = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
      ],
      skel,
    );

    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 0, instances: [inst] }),
      ],
    });
    expect(labels.skeletons).toHaveLength(1);

    labels.update();
    expect(labels.skeletons).toHaveLength(1);
    expect(inst.skeleton).toBe(labels.skeletons[0]);
  });

  it("distinct-but-compatible skeletons added explicitly are not auto-merged", () => {
    const skel1 = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });
    const skel2 = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });

    const video = new Video({ filename: "fake.mp4" });
    const labels = new Labels({ skeletons: [skel1, skel2], videos: [video] });

    const inst1 = Instance.fromArray(
      [
        [0, 0],
        [1, 1],
      ],
      skel1,
    );
    const inst2 = Instance.fromArray(
      [
        [2, 2],
        [3, 3],
      ],
      skel2,
    );
    labels.append(new LabeledFrame({ video, frameIdx: 0, instances: [inst1] }));
    labels.append(new LabeledFrame({ video, frameIdx: 1, instances: [inst2] }));

    // Both skeletons were explicitly registered, so neither instance is rebound
    // and both skeletons are preserved (compatible skeletons stay distinct).
    expect(labels.skeletons).toHaveLength(2);
    expect(inst1.skeleton).toBe(skel1);
    expect(inst2.skeleton).toBe(skel2);
  });
});
