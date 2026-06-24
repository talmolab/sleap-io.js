/**
 * Port of Python merge-fidelity regression tests:
 *   - PR #489: reorder points by node NAME when matched skeletons differ in order
 *     (tests/model/test_merging_integration.py :: TestMergeNodeOrderReorder)
 *   - PR #491: preserve from_predicted provenance across merge
 *     (tests/model/test_labeled_frame.py :: *_from_predicted_relinked,
 *      tests/io/test_slp.py :: *_from_predicted_survives_merge)
 *
 * The TS port has no SLP codec, so the Python save/load round-trip assertions
 * (which prove the saved link index is not -1) are reproduced here as the
 * equivalent invariant: the merged user annotation's `fromPredicted` points by
 * OBJECT IDENTITY at the prediction copy that now lives in the merged frame
 * (not the original object outside it). That identity is exactly what the SLP
 * codec resolves to a stored index, so it is the meaningful equivalent.
 */
import { describe, it, expect } from "../bun-test";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import {
  type UserSegmentationMask,
  PredictedSegmentationMask,
  encodeRle,
} from "../../src/model/mask.js";

// --- Fix A (#489): reorder points by node name -------------------------------

describe("Labels.merge point reorder when skeletons differ in order", () => {
  // The default skeleton matcher uses STRUCTURE matching with
  // require_same_order=false, so a skeleton [A, B, C] matches a
  // structurally-equal [C, B, A]. The merge must map points by node name, not
  // positionally, so each node's coordinates/score follow its name.

  function makeVideo(): Video {
    return new Video({ filename: "test.mp4", openBackend: false });
  }

  it("new-frame merge maps points by node name", async () => {
    const baseSkel = new Skeleton({ nodes: ["A", "B", "C"] });
    const otherSkel = new Skeleton({ nodes: ["C", "B", "A"] });
    const video = makeVideo();

    const base = new Labels({ skeletons: [baseSkel] });
    base.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [
          Instance.fromNumpy({
            pointsData: [
              [1, 1],
              [2, 2],
              [3, 3],
            ],
            skeleton: baseSkel,
          }),
        ],
      }),
    );

    // Built from rows in [C, B, A] order -> C=(10,10), B=(11,11), A=(12,12).
    const other = new Labels({ skeletons: [otherSkel] });
    other.append(
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [
          Instance.fromNumpy({
            pointsData: [
              [10, 10],
              [11, 11],
              [12, 12],
            ],
            skeleton: otherSkel,
          }),
        ],
      }),
    );

    await base.merge(other);

    const merged = base.labeledFrames[1].instances[0];
    // Merged instance adopts the base skeleton's node order.
    expect(merged.skeleton.nodeNames).toEqual(["A", "B", "C"]);
    const idx = (name: string) => merged.skeleton.index(name);
    const pts = merged.numpy();
    // Each node's coordinates must follow its name, not its original position.
    expect(pts[idx("A")]).toEqual([12, 12]);
    expect(pts[idx("B")]).toEqual([11, 11]);
    expect(pts[idx("C")]).toEqual([10, 10]);
  });

  it("overlapping-frame merge maps points by node name", async () => {
    const baseSkel = new Skeleton({ nodes: ["A", "B", "C"] });
    const otherSkel = new Skeleton({ nodes: ["C", "B", "A"] });
    const video = makeVideo();

    const base = new Labels({ skeletons: [baseSkel] });
    base.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [
          Instance.fromNumpy({
            pointsData: [
              [1, 1],
              [2, 2],
              [3, 3],
            ],
            skeleton: baseSkel,
          }),
        ],
      }),
    );

    // Same frame_idx so the instance is merged into the existing frame. Built in
    // [C, B, A] order -> C=(10,10), B=(11,11), A=(12,12). Placed far from the
    // base instance so the matcher keeps it as a distinct instance.
    const other = new Labels({ skeletons: [otherSkel] });
    other.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [
          Instance.fromNumpy({
            pointsData: [
              [10, 10],
              [11, 11],
              [12, 12],
            ],
            skeleton: otherSkel,
          }),
        ],
      }),
    );

    await base.merge(other, { frame: "keep_both" });

    const frame = base.labeledFrames[0];
    expect(frame.instances.length).toBe(2);
    // Locate the merged-in instance (the one carrying the other's coordinates).
    const merged = frame.instances.filter((i) => {
      const pts = i.numpy();
      const a = pts[i.skeleton.index("A")];
      return a[0] === 12 && a[1] === 12;
    });
    expect(merged.length).toBe(1);
    const m = merged[0];
    expect(m.skeleton.nodeNames).toEqual(["A", "B", "C"]);
    const idx = (name: string) => m.skeleton.index(name);
    const pts = m.numpy();
    expect(pts[idx("A")]).toEqual([12, 12]);
    expect(pts[idx("B")]).toEqual([11, 11]);
    expect(pts[idx("C")]).toEqual([10, 10]);
  });

  it("predicted reorder preserves per-node scores by name", async () => {
    const baseSkel = new Skeleton({ nodes: ["A", "B", "C"] });
    const otherSkel = new Skeleton({ nodes: ["C", "B", "A"] });
    const video = makeVideo();

    const base = new Labels({ skeletons: [baseSkel] });
    base.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [
          PredictedInstance.fromNumpy({
            pointsData: [
              [1, 1],
              [2, 2],
              [3, 3],
            ],
            skeleton: baseSkel,
            score: 0.5,
          }),
        ],
      }),
    );

    // Built in [C, B, A] order with matching per-node scores (3rd column).
    const other = new Labels({ skeletons: [otherSkel] });
    other.append(
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [
          PredictedInstance.fromNumpy({
            pointsData: [
              [10, 10, 0.1],
              [11, 11, 0.2],
              [12, 12, 0.3],
            ],
            skeleton: otherSkel,
            score: 0.9,
          }),
        ],
      }),
    );

    await base.merge(other);

    const merged = base.labeledFrames[1].instances[0] as PredictedInstance;
    expect(merged).toBeInstanceOf(PredictedInstance);
    expect(merged.skeleton.nodeNames).toEqual(["A", "B", "C"]);
    const idx = (name: string) => merged.skeleton.index(name);
    const pts = merged.numpy();
    expect(pts[idx("A")]).toEqual([12, 12]);
    expect(pts[idx("C")]).toEqual([10, 10]);
    // Scores follow node name: A->0.3, B->0.2, C->0.1.
    expect(merged.points[idx("A")].score).toBe(0.3);
    expect(merged.points[idx("B")].score).toBe(0.2);
    expect(merged.points[idx("C")].score).toBe(0.1);
    // Instance-level metadata is preserved exactly.
    expect(merged.score).toBe(0.9);
  });

  it("identical node order leaves points untouched (control)", async () => {
    const skel1 = new Skeleton({ nodes: ["A", "B", "C"] });
    const skel2 = new Skeleton({ nodes: ["A", "B", "C"] });
    const video = makeVideo();

    const base = new Labels({ skeletons: [skel1] });
    base.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [
          Instance.fromNumpy({
            pointsData: [
              [1, 1],
              [2, 2],
              [3, 3],
            ],
            skeleton: skel1,
          }),
        ],
      }),
    );

    const other = new Labels({ skeletons: [skel2] });
    other.append(
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [
          Instance.fromNumpy({
            pointsData: [
              [7, 7],
              [8, 8],
              [9, 9],
            ],
            skeleton: skel2,
          }),
        ],
      }),
    );

    await base.merge(other);

    const merged = base.labeledFrames[1].instances[0];
    expect(merged.skeleton.nodeNames).toEqual(["A", "B", "C"]);
    expect(merged.numpy()).toEqual([
      [7, 7],
      [8, 8],
      [9, 9],
    ]);
  });
});

// --- Fix B (#491): preserve from_predicted provenance across merge -----------

describe("merge preserves from_predicted provenance (masks)", () => {
  const video = new Video({ filename: "test.mp4", openBackend: false });

  // 5x5 raster with a 3x3 block at rows/cols 1..3.
  function rle3x3(): Uint32Array {
    const flat = new Uint8Array(25);
    for (let r = 1; r < 4; r++) for (let c = 1; c < 4; c++) flat[r * 5 + c] = 1;
    return encodeRle(flat, 5, 5);
  }

  function makePred(
    offset: [number, number] = [0, 0],
  ): PredictedSegmentationMask {
    return new PredictedSegmentationMask({
      rleCounts: rle3x3(),
      height: 5,
      width: 5,
      score: 0.9,
      offset,
    });
  }

  it("auto: relinks a copied user mask to the copied source prediction", () => {
    const pred = makePred([5, 5]);
    const user = pred.toUser(); // user.fromPredicted === pred
    // Move far enough that the link, not spatial proximity, carries the match.
    user.offset = [500, 500];

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [pred, user] });

    lf1.mergeAnnotations(lf2, "auto");

    const mergedPreds = lf1.masks.filter(
      (m) => m.isPredicted,
    ) as PredictedSegmentationMask[];
    const mergedUsers = lf1.masks.filter(
      (m) => !m.isPredicted,
    ) as UserSegmentationMask[];
    expect(mergedPreds.length).toBe(1);
    expect(mergedUsers.length).toBe(1);
    // The link points at the in-frame copy, not the original object.
    expect(mergedUsers[0].fromPredicted).toBe(mergedPreds[0]);
    expect(mergedUsers[0].fromPredicted).not.toBe(pred);
  });

  it("keep_both: relinks a copied user mask to the copied source prediction", () => {
    const pred = makePred();
    const user = pred.toUser();

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [pred, user] });

    lf1.mergeAnnotations(lf2, "keep_both");

    const mergedPreds = lf1.masks.filter(
      (m) => m.isPredicted,
    ) as PredictedSegmentationMask[];
    const mergedUsers = lf1.masks.filter(
      (m) => !m.isPredicted,
    ) as UserSegmentationMask[];
    expect(mergedUsers[0].fromPredicted).toBe(mergedPreds[0]);
    expect(mergedUsers[0].fromPredicted).not.toBe(pred);
  });

  it("keep_new: relinks a copied user mask to the copied source prediction", () => {
    const pred = makePred();
    const user = pred.toUser();

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [pred, user] });

    lf1.mergeAnnotations(lf2, "keep_new");

    const mergedPreds = lf1.masks.filter(
      (m) => m.isPredicted,
    ) as PredictedSegmentationMask[];
    const mergedUsers = lf1.masks.filter(
      (m) => !m.isPredicted,
    ) as UserSegmentationMask[];
    expect(mergedUsers[0].fromPredicted).toBe(mergedPreds[0]);
    expect(mergedUsers[0].fromPredicted).not.toBe(pred);
  });

  it("replace_predictions: keeps self user and adds other's prediction (no relink needed)", () => {
    // replace_predictions drops user annotations from other, so the user mask in
    // `lf2` is not copied; only the prediction is. This exercises the relink pass
    // on a list where the only fromPredicted source is absent -> link unchanged.
    const pred = makePred();

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [pred] });

    lf1.mergeAnnotations(lf2, "replace_predictions");

    const mergedPreds = lf1.masks.filter((m) => m.isPredicted);
    expect(mergedPreds.length).toBe(1);
    // Predicted mask was copied, not aliased to the original.
    expect(mergedPreds[0]).not.toBe(pred);
  });
});

describe("Labels.merge preserves from_predicted provenance (instances)", () => {
  function makeVideo(): Video {
    return new Video({ filename: "test.mp4", openBackend: false });
  }

  function makeLinkedFrame(
    video: Video,
    skeleton: Skeleton,
    frameIdx: number,
  ): { frame: LabeledFrame; pred: PredictedInstance; user: Instance } {
    const pts = [
      [1.0, 2.0],
      [3.0, 4.0],
    ];
    const pred = PredictedInstance.fromNumpy({
      pointsData: pts,
      skeleton,
      score: 0.9,
    });
    const user = Instance.fromNumpy({ pointsData: pts, skeleton });
    user.fromPredicted = pred;
    const frame = new LabeledFrame({
      video,
      frameIdx,
      instances: [pred, user],
    });
    return { frame, pred, user };
  }

  it("overlapping-frame merge relinks remapped user instance to remapped prediction", async () => {
    // Destination has a frame at the SAME frame_idx, so the merge takes the
    // existing-frame remap path (_map_instance + _relink_from_predicted).
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const video = makeVideo();

    const dst = new Labels({
      videos: [video],
      skeletons: [skeleton],
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [] })],
    });
    const srcSkeleton = new Skeleton({ nodes: ["A", "B"] });
    const { frame } = makeLinkedFrame(video, srcSkeleton, 0);
    const src = new Labels({
      videos: [video],
      skeletons: [srcSkeleton],
      labeledFrames: [frame],
    });

    await dst.merge(src, { frame: "auto" });

    const insts = dst.labeledFrames[0].instances;
    const reloadedPred = insts.find(
      (i) => i.constructor === PredictedInstance,
    ) as PredictedInstance;
    const reloadedUser = insts.find(
      (i) => i.constructor === Instance,
    ) as Instance;
    expect(reloadedPred).toBeDefined();
    expect(reloadedUser).toBeDefined();
    // The user instance links to the remapped prediction now in the frame.
    expect(reloadedUser.fromPredicted).toBe(reloadedPred);
  });

  it("new-frame merge relinks remapped user instance to remapped prediction", async () => {
    // Destination has a frame at a DIFFERENT frame_idx, so merging the source
    // frame (at frameIdx=0) creates a brand-new LabeledFrame (new-frame path).
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const video = makeVideo();

    const dst = new Labels({
      videos: [video],
      skeletons: [skeleton],
      labeledFrames: [new LabeledFrame({ video, frameIdx: 99, instances: [] })],
    });
    const srcSkeleton = new Skeleton({ nodes: ["A", "B"] });
    const { frame } = makeLinkedFrame(video, srcSkeleton, 0);
    const src = new Labels({
      videos: [video],
      skeletons: [srcSkeleton],
      labeledFrames: [frame],
    });

    await dst.merge(src, { frame: "auto" });

    const newFrame = dst.labeledFrames.find((lf) => lf.frameIdx === 0)!;
    const insts = newFrame.instances;
    const reloadedPred = insts.find(
      (i) => i.constructor === PredictedInstance,
    ) as PredictedInstance;
    const reloadedUser = insts.find(
      (i) => i.constructor === Instance,
    ) as Instance;
    expect(reloadedPred).toBeDefined();
    expect(reloadedUser).toBeDefined();
    expect(reloadedUser.fromPredicted).toBe(reloadedPred);
    // The relinked prediction is the in-frame copy, not the original source.
    expect(reloadedUser.fromPredicted).not.toBe(frame.instances[0]);
  });
});
