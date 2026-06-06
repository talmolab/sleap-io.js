/**
 * Port of GROUP A from the Python merge integration suite.
 *
 * GROUND TRUTH: C:/Users/Talmo/code/sleap-io @ 054cce39f
 *   tests/model/test_merging_integration.py :: class TestLabeledFrameMerge (lines 16-201)
 *   plus sleap_io/model/labeled_frame.py :: _resolve_merged_is_negative (lines 204-226)
 *
 * Notes on the port:
 * - Python `frame1.merge(frame2, frame="keep_original")` becomes the JS
 *   `frame1.merge(frame2, { frame: "keep_original" })` (single options object).
 * - Python returns a 2-tuple `(merged, conflicts)`; JS returns the same
 *   `[merged, conflicts]` array. Conflict tuples are `[selfInst, otherInst, str]`.
 * - Python `is` identity assertions become `toBe(...)`; `in` membership becomes
 *   `.includes(...)`.
 */
import { describe, it, expect } from "../bun-test";
import {
  Instance,
  PredictedInstance,
  Track,
} from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import {
  LabeledFrame,
  _resolveMergedIsNegative,
} from "../../src/model/labeled-frame.js";
import {
  InstanceMatcher,
  InstanceMatchMethod,
} from "../../src/model/matching.js";
import {
  UserSegmentationMask,
  PredictedSegmentationMask,
  encodeRle,
} from "../../src/model/mask.js";

describe("LabeledFrame.merge", () => {
  // A1 — test_merge_keep_original (test_merging_integration.py:19-39)
  it("keep_original keeps original instances unchanged", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    const inst1 = Instance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
    const frame1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst1] });

    const inst2 = Instance.fromArray(
      [
        [30, 30],
        [40, 40],
      ],
      skeleton,
    );
    const frame2 = new LabeledFrame({ video, frameIdx: 0, instances: [inst2] });

    const [merged, conflicts] = frame1.merge(frame2, { frame: "keep_original" });

    expect(merged.length).toBe(1);
    expect(merged[0]).toBe(inst1);
    expect(conflicts.length).toBe(0);
  });

  // A2 — test_merge_keep_new (test_merging_integration.py:41-60)
  it("keep_new returns the incoming instances", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    const inst1 = Instance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
    const frame1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst1] });

    const inst2 = Instance.fromArray(
      [
        [30, 30],
        [40, 40],
      ],
      skeleton,
    );
    const frame2 = new LabeledFrame({ video, frameIdx: 0, instances: [inst2] });

    const [merged, conflicts] = frame1.merge(frame2, { frame: "keep_new" });

    expect(merged.length).toBe(1);
    expect(merged[0]).toBe(inst2);
    expect(conflicts.length).toBe(0);
  });

  // A3 — test_merge_update_tracks (test_merging_integration.py:62-86)
  it("update_tracks copies track + tracking_score onto the kept original in place", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    const inst1 = Instance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
    const frame1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst1] });

    // PredictedInstance at SAME coords -> spatial match.
    const inst2 = PredictedInstance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
    inst2.track = new Track("track1");
    const frame2 = new LabeledFrame({ video, frameIdx: 0, instances: [inst2] });

    const [merged, conflicts] = frame1.merge(frame2, { frame: "update_tracks" });

    expect(merged.length).toBe(1);
    expect(merged.includes(inst1)).toBe(true);
    expect(merged.includes(inst2)).toBe(false);
    // Python: inst1.track == inst2.track. The same Track object is assigned, so
    // identity holds (stronger than value equality, and valid here).
    expect(inst1.track).toBe(inst2.track);
    // Python: inst1.tracking_score == inst2.tracking_score.
    expect(inst1.trackingScore).toBe(inst2.trackingScore);
    expect(conflicts.length).toBe(0);
  });

  // A4 — test_merge_keep_both (test_merging_integration.py:88-108)
  it("keep_both unions both instance lists", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    const inst1 = Instance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
    const frame1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst1] });

    const inst2 = Instance.fromArray(
      [
        [30, 30],
        [40, 40],
      ],
      skeleton,
    );
    const frame2 = new LabeledFrame({ video, frameIdx: 0, instances: [inst2] });

    const [merged, conflicts] = frame1.merge(frame2, { frame: "keep_both" });

    expect(merged.length).toBe(2);
    expect(merged.includes(inst1)).toBe(true);
    expect(merged.includes(inst2)).toBe(true);
    expect(conflicts.length).toBe(0);
  });

  // A5 — test_merge_auto_user_vs_predicted (test_merging_integration.py:110-139)
  it("auto keeps user instance over a spatially-matched prediction (kept_user)", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    const userInst = Instance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
    const frame1 = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [userInst],
    });

    // Prediction at NEAR coords (~1px offset) with point scores + score.
    const predInst = PredictedInstance.fromArray(
      [
        [11, 11, 0.9],
        [21, 21, 0.9],
      ],
      skeleton,
      0.9,
    );
    const frame2 = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [predInst],
    });

    const [merged, conflicts] = frame1.merge(frame2, { frame: "auto" });

    expect(merged.length).toBe(1);
    expect(merged[0]).toBe(userInst);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0][2]).toBe("kept_user");
  });

  // A6 — test_merge_auto_replace_prediction (test_merging_integration.py:141-171)
  it("auto keeps user over prediction regardless of which side holds it (kept_user)", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    // frame1 holds the PREDICTION.
    const predInst = PredictedInstance.fromArray(
      [
        [10, 10, 0.8],
        [20, 20, 0.8],
      ],
      skeleton,
      0.8,
    );
    const frame1 = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [predInst],
    });

    // frame2 holds the USER instance at NEAR coords.
    const userInst = Instance.fromArray(
      [
        [11, 11],
        [21, 21],
      ],
      skeleton,
    );
    const frame2 = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [userInst],
    });

    // NOTE: frame2 (user) is the receiver; frame1 (pred) is incoming.
    const [merged, conflicts] = frame2.merge(frame1, { frame: "auto" });

    expect(merged.length).toBe(1);
    expect(merged[0]).toBe(userInst);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0][2]).toBe("kept_user");
  });

  // A7 — test_merge_with_custom_matcher (test_merging_integration.py:173-201)
  it("auto + IDENTITY matcher matches by track, not by distance", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const track1 = new Track("track1");
    const track2 = new Track("track2");

    const inst1 = new Instance({
      points: [
        { xy: [10, 10], visible: true, complete: false },
        { xy: [20, 20], visible: true, complete: false },
      ],
      skeleton,
      track: track1,
    });
    const frame1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst1] });

    // inst2 shares track1 but is FAR away; inst3 has track2.
    const inst2 = new Instance({
      points: [
        { xy: [50, 50], visible: true, complete: false },
        { xy: [60, 60], visible: true, complete: false },
      ],
      skeleton,
      track: track1,
    });
    const inst3 = new Instance({
      points: [
        { xy: [70, 70], visible: true, complete: false },
        { xy: [80, 80], visible: true, complete: false },
      ],
      skeleton,
      track: track2,
    });
    const frame2 = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst2, inst3],
    });

    const matcher = new InstanceMatcher(InstanceMatchMethod.IDENTITY);
    const [merged] = frame1.merge(frame2, { instance: matcher, frame: "auto" });

    // inst1(track1) matches inst2(track1) by IDENTITY despite being far apart, so
    // only one is kept; inst3(track2) is unmatched and added -> 2 instances.
    expect(merged.length).toBe(2);
  });
});

describe("_resolveMergedIsNegative", () => {
  const skeleton = new Skeleton({ nodes: ["head", "tail"] });

  function userInst(): Instance {
    return Instance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
  }

  function predInst(): PredictedInstance {
    return PredictedInstance.fromArray(
      [
        [10, 10],
        [20, 20],
      ],
      skeleton,
    );
  }

  // labeled_frame.py:224-226
  // either_negative = self_negative or other_negative
  // has_user_pose = any(type(inst) is Instance for inst in merged)
  // return (either_negative and not has_user_pose, either_negative and has_user_pose)

  it("neither side negative -> not negative, no conflict (no user pose)", () => {
    expect(_resolveMergedIsNegative(false, false, [])).toEqual([false, false]);
  });

  it("neither side negative -> not negative, no conflict (with user pose)", () => {
    expect(_resolveMergedIsNegative(false, false, [userInst()])).toEqual([
      false,
      false,
    ]);
  });

  it("self negative + no user pose -> stays negative, no conflict", () => {
    expect(_resolveMergedIsNegative(true, false, [])).toEqual([true, false]);
  });

  it("other negative + no user pose -> stays negative, no conflict", () => {
    expect(_resolveMergedIsNegative(false, true, [])).toEqual([true, false]);
  });

  it("negative + a predicted instance does NOT cancel the flag", () => {
    // Predictions do not count as user poses (exact type check), so the negative
    // flag is preserved and no conflict is recorded.
    expect(_resolveMergedIsNegative(true, false, [predInst()])).toEqual([
      true,
      false,
    ]);
  });

  it("negative + a user pose clears the flag and records a conflict", () => {
    // A frame with a labeled animal is not a background frame: negative is
    // dropped (resolved=false) and conflict=true.
    expect(_resolveMergedIsNegative(true, false, [userInst()])).toEqual([
      false,
      true,
    ]);
  });

  it("other negative + a user pose clears the flag and records a conflict", () => {
    expect(_resolveMergedIsNegative(false, true, [userInst()])).toEqual([
      false,
      true,
    ]);
  });

  it("negative + mixed user & predicted poses clears the flag (user pose present)", () => {
    expect(
      _resolveMergedIsNegative(true, true, [predInst(), userInst()]),
    ).toEqual([false, true]);
  });
});

// Port of GROUND TRUTH talmolab/sleap-io PR #478 (mask unused_predictions +
// link-first mask merge): in-memory model/merge logic only, no format change.
describe("LabeledFrame.unusedPredictedMasks", () => {
  const video = new Video({ filename: "test.mp4", openBackend: false });

  // 5x5 raster with a 3x3 block at rows/cols 1..3 -> bbox centroid ~ (2.5, 2.5)
  // before any offset; offset shifts the centroid directly.
  function rle3x3(): Uint32Array {
    const flat = new Uint8Array(25);
    for (let r = 1; r < 4; r++) for (let c = 1; c < 4; c++) flat[r * 5 + c] = 1;
    return encodeRle(flat, 5, 5);
  }

  function makePred(offset: [number, number] = [0, 0]): PredictedSegmentationMask {
    return new PredictedSegmentationMask({
      rleCounts: rle3x3(),
      height: 5,
      width: 5,
      score: 0.9,
      offset,
    });
  }

  function makeUser(offset: [number, number] = [0, 0]): UserSegmentationMask {
    return new UserSegmentationMask({
      rleCounts: rle3x3(),
      height: 5,
      width: 5,
      offset,
    });
  }

  it("none_when_no_predictions: a frame with only a user mask -> []", () => {
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [makeUser()] });
    expect(lf.unusedPredictedMasks).toEqual([]);
  });

  it("unadopted_reported: a lone predicted mask -> [pred]", () => {
    const pred = makePred();
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [pred] });
    expect(lf.unusedPredictedMasks).toEqual([pred]);
  });

  it("excludes_linked: pred + pred.toUser() (linked) -> []", () => {
    const pred = makePred();
    const user = pred.toUser(); // user.fromPredicted === pred
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [pred, user] });
    expect(lf.unusedPredictedMasks).toEqual([]);
  });

  it("link_overrides_distance: linked user moved far away still adopts the pred -> []", () => {
    const pred = makePred();
    const user = pred.toUser();
    // Move the user mask far from the prediction; the link still adopts it.
    user.offset = [500, 500];
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [pred, user] });
    expect(lf.unusedPredictedMasks).toEqual([]);
  });

  it("spatial_fallback: an unlinked user mask overlapping within 5 px adopts the pred -> []", () => {
    const pred = makePred();
    // Independent (unlinked) user mask at ~2 px offset -> within the 5 px default.
    const user = makeUser([2, 0]);
    expect(user.fromPredicted).toBeNull();
    const lf = new LabeledFrame({ video, frameIdx: 0, masks: [pred, user] });
    expect(lf.unusedPredictedMasks).toEqual([]);
  });

  it("mixed: adopted + user-only + far orphan -> [orphan]", () => {
    const adopted = makePred();
    const user = adopted.toUser(); // adopts `adopted` via the link
    const orphan = makePred([500, 500]); // far from any user mask
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [adopted, user, orphan],
    });
    expect(lf.unusedPredictedMasks).toEqual([orphan]);
  });
});

describe("LabeledFrame.mergeAnnotations link-first mask merge (auto)", () => {
  const video = new Video({ filename: "test.mp4", openBackend: false });

  function rle3x3(): Uint32Array {
    const flat = new Uint8Array(25);
    for (let r = 1; r < 4; r++) for (let c = 1; c < 4; c++) flat[r * 5 + c] = 1;
    return encodeRle(flat, 5, 5);
  }

  function makePred(offset: [number, number] = [0, 0]): PredictedSegmentationMask {
    return new PredictedSegmentationMask({
      rleCounts: rle3x3(),
      height: 5,
      width: 5,
      score: 0.9,
      offset,
    });
  }

  it("link_overrides_distance: self pred + other far-moved user adopted from it -> 1 user mask", () => {
    const pred = makePred();
    const user = pred.toUser();
    user.offset = [500, 500]; // far from the prediction spatially
    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [pred] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [user] });

    lf1.mergeAnnotations(lf2, "auto");

    // The link matches pred<->user despite the distance: the prediction is
    // replaced by the user mask, leaving exactly one (user) mask.
    expect(lf1.masks.length).toBe(1);
    expect(lf1.masks[0].isPredicted).toBe(false);
  });

  it("link_self_side: self holds the user correction linked to other's pred -> 1 user mask", () => {
    const pred = makePred();
    const user = pred.toUser();
    user.offset = [500, 500];
    // Self holds the user mask, other holds the prediction (opposite sides).
    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [user] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [pred] });

    lf1.mergeAnnotations(lf2, "auto");

    expect(lf1.masks.length).toBe(1);
    expect(lf1.masks[0].isPredicted).toBe(false);
    expect(lf1.masks[0]).toBe(user);
  });

  it("link_beats_spatial_decoy: user replaces its true source, decoy pred on top of user stays predicted", () => {
    const trueSource = makePred([500, 500]); // far away true source
    const user = trueSource.toUser(); // linked to trueSource, sits at [500,500]
    const decoy = makePred([500, 500]); // unrelated pred spatially on top of user
    const lf1 = new LabeledFrame({
      video,
      frameIdx: 0,
      masks: [trueSource, decoy],
    });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [user] });

    lf1.mergeAnnotations(lf2, "auto");

    // The link pairs user<->trueSource (greedy 1:1 with Infinity score), so the
    // decoy is NOT matched to the user and survives as a prediction. trueSource
    // is replaced by the user mask.
    expect(lf1.masks.length).toBe(2);
    const users = lf1.masks.filter((m) => !m.isPredicted);
    const preds = lf1.masks.filter((m) => m.isPredicted);
    expect(users.length).toBe(1);
    expect(preds.length).toBe(1);
    expect(preds[0]).toBe(decoy);
  });

  it("link_multiple_pairs: two independent cross-frame links both resolve -> 2 user masks", () => {
    const predA = makePred([0, 0]);
    const userA = predA.toUser();
    userA.offset = [500, 500];
    const predB = makePred([1000, 1000]);
    const userB = predB.toUser();
    userB.offset = [2000, 2000];

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [predA, predB] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [userA, userB] });

    lf1.mergeAnnotations(lf2, "auto");

    // Both predictions are replaced by their linked user corrections.
    expect(lf1.masks.length).toBe(2);
    expect(lf1.masks.every((m) => !m.isPredicted)).toBe(true);
  });

  it("link_source_absent: both users link to an external pred (in neither frame), far apart -> both kept", () => {
    // External prediction belongs to neither frame's mask list.
    const external = makePred();
    const userA = external.toUser();
    userA.offset = [0, 0];
    const userB = external.toUser();
    userB.offset = [500, 500]; // far from userA so no spatial match either

    const lf1 = new LabeledFrame({ video, frameIdx: 0, masks: [userA] });
    const lf2 = new LabeledFrame({ video, frameIdx: 0, masks: [userB] });

    lf1.mergeAnnotations(lf2, "auto");

    // Neither user links to a mask present in the OTHER frame, and they are far
    // apart, so no match -> both user masks are kept.
    expect(lf1.masks.length).toBe(2);
    expect(lf1.masks.every((m) => !m.isPredicted)).toBe(true);
  });
});
