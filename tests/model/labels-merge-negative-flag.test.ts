//
// Issue #108 / Python sleap-io PR #432: preserve `isNegative` when merging
// colliding and new frames, emitting a `negative_flag_conflict` when a user pose
// vetoes the flag. The unit-level rule is covered by the
// `_resolveMergedIsNegative` truth table in labeled-frame-merge.test.ts; this
// file pins the END-TO-END `Labels.merge` behavior (both branches) + the
// ConflictResolution emission. Rule:
//   merged.isNegative = (self.isNegative || other.isNegative) && !hasUserPose
// (a PredictedInstance does NOT count as a user pose -> does not veto.)
import { describe, it, expect } from "../bun-test";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";

const SK = () => new Skeleton({ nodes: ["a", "b"] });
const user = (pts: number[][], sk: Skeleton) =>
  new Instance({ points: Instance.fromArray(pts, sk).points, skeleton: sk });
const pred = (pts: number[][], sk: Skeleton) =>
  PredictedInstance.fromArray(pts, sk, 0.9);

describe("Labels.merge preserves isNegative (issue #108 / PR #432)", () => {
  it("non-colliding: an incoming negative frame is appended with isNegative preserved", async () => {
    const sk = SK();
    const v = new Video({ filename: "v.mp4", openBackend: false });
    const base = new Labels();
    base.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [user([[1, 1], [2, 2]], sk)] }));

    const other = new Labels();
    other.append(new LabeledFrame({ video: v, frameIdx: 5, instances: [], isNegative: true }));

    const result = await base.merge(other);

    const appended = base.find({ video: v, frameIdx: 5 })[0];
    expect(appended.isNegative).toBe(true);
    expect(result.conflicts.some((c) => c.conflictType === "negative_flag_conflict")).toBe(false);
  });

  it("colliding: both sides negative, no user pose -> stays negative, no conflict", async () => {
    const sk = SK();
    const v = new Video({ filename: "v.mp4", openBackend: false });
    const base = new Labels();
    base.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [], isNegative: true }));
    const other = new Labels();
    other.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [], isNegative: true }));

    const result = await base.merge(other);

    expect(base.find({ video: v, frameIdx: 0 })[0].isNegative).toBe(true);
    expect(result.conflicts.some((c) => c.conflictType === "negative_flag_conflict")).toBe(false);
  });

  it("colliding: one side negative, no user pose -> stays negative, no conflict", async () => {
    const sk = SK();
    const v = new Video({ filename: "v.mp4", openBackend: false });
    const base = new Labels();
    base.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [], isNegative: true }));
    const other = new Labels();
    other.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [], isNegative: false }));

    const result = await base.merge(other);

    expect(base.find({ video: v, frameIdx: 0 })[0].isNegative).toBe(true);
    expect(result.conflicts.some((c) => c.conflictType === "negative_flag_conflict")).toBe(false);
  });

  it("colliding: negative base + incoming USER pose -> flag cleared + negative_flag_conflict emitted", async () => {
    const sk = SK();
    const v = new Video({ filename: "v.mp4", openBackend: false });
    const base = new Labels();
    base.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [], isNegative: true }));
    const other = new Labels();
    other.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [user([[1, 1], [2, 2]], sk)] }));

    const result = await base.merge(other);

    const frame = base.find({ video: v, frameIdx: 0 })[0];
    expect(frame.isNegative).toBe(false); // user pose vetoes the flag
    const conflict = result.conflicts.find((c) => c.conflictType === "negative_flag_conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.originalData).toBe(true); // base was negative
    expect(conflict!.resolution).toBe("dropped_for_user_pose");
  });

  it("colliding: negative base + incoming PREDICTED-only does NOT veto (stays negative, no conflict)", async () => {
    const sk = SK();
    const v = new Video({ filename: "v.mp4", openBackend: false });
    const base = new Labels();
    base.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [], isNegative: true }));
    const other = new Labels();
    other.append(new LabeledFrame({ video: v, frameIdx: 0, instances: [pred([[1, 1], [2, 2]], sk)] }));

    const result = await base.merge(other);

    expect(base.find({ video: v, frameIdx: 0 })[0].isNegative).toBe(true);
    expect(result.conflicts.some((c) => c.conflictType === "negative_flag_conflict")).toBe(false);
  });
});
