/* @vitest-environment node */
/**
 * Port of the InstanceMatcher / Instance pose-matching tests from the Python
 * suite `tests/model/test_matching.py` (pinned @ 054cce39f).
 *
 * Covers:
 *  - GROUP 2 (TestInstanceMatcher): spatial / identity / iou match() + find_matches.
 *  - GROUP 11 (TestEdgeCases) instance edge cases: spatial-no-overlap, IoU
 *    with-overlap score, IoU NaN edge cases, IoU no-bbox / no-intersection,
 *    find_matches all-NaN spatial, find_matches identity score 1.0, IoU
 *    find_matches no-intersection / null-bbox, IoU score edge cases, and the
 *    iou_score_calculation_coverage test (subclass forces match()=true, the
 *    separate score routine still yields 0.0 for degenerate geometry).
 *  - Direct Instance method checks: samePoseAs / sameIdentityAs / overlapsWith /
 *    boundingBox.
 *
 * Every assertion encodes the PYTHON expectation. `InstanceMatcher.match()` and
 * `findMatches()` are synchronous in both implementations, so no `await`.
 */
import { describe, it, expect } from "vitest";
import {
  InstanceMatcher,
  InstanceMatchMethod,
} from "../../src/model/matching.js";
import { Instance, Track } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";

const NaN_ = Number.NaN;

// =============================================================================
// GROUP 2 — TestInstanceMatcher (test_matching.py:93-173)
// =============================================================================

describe("InstanceMatcher", () => {
  // test_spatial_match (96-113)
  it("spatial match: near within threshold, far outside", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const inst1 = Instance.fromArray([[10, 10], [20, 20]], skeleton);
    const inst2 = Instance.fromArray([[11, 11], [21, 21]], skeleton); // close
    const inst3 = Instance.fromArray([[50, 50], [60, 60]], skeleton); // far

    const matcher = new InstanceMatcher(InstanceMatchMethod.SPATIAL, {
      threshold: 5.0,
    });
    expect(matcher.match(inst1, inst2)).toBe(true); // within threshold
    expect(matcher.match(inst1, inst3)).toBe(false); // outside threshold
  });

  // test_identity_match (115-133)
  it("identity match: same Track object true, different Track false (positions ignored)", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const track1 = new Track("track1");
    const track2 = new Track("track2");

    const inst1 = new Instance({
      points: [[10, 10], [20, 20]],
      skeleton,
      track: track1,
    });
    const inst2 = new Instance({
      points: [[50, 50], [60, 60]],
      skeleton,
      track: track1,
    });
    const inst3 = new Instance({
      points: [[10, 10], [20, 20]],
      skeleton,
      track: track2,
    });

    const matcher = new InstanceMatcher(InstanceMatchMethod.IDENTITY);
    expect(matcher.match(inst1, inst2)).toBe(true); // same track (far apart)
    expect(matcher.match(inst1, inst3)).toBe(false); // different tracks
  });

  // test_iou_match (135-152)
  it("iou match: overlapping boxes true, disjoint false at threshold 0.1", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2", "p3", "p4"] });
    const inst1 = Instance.fromArray(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      skeleton,
    ); // box (0,0)-(10,10)
    const inst2 = Instance.fromArray(
      [[5, 5], [15, 5], [15, 15], [5, 15]],
      skeleton,
    ); // box (5,5)-(15,15)
    const inst3 = Instance.fromArray(
      [[20, 20], [30, 20], [30, 30], [20, 30]],
      skeleton,
    ); // box (20,20)-(30,30)

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.1,
    });
    expect(matcher.match(inst1, inst2)).toBe(true); // overlapping
    expect(matcher.match(inst1, inst3)).toBe(false); // not overlapping
  });

  // test_find_matches (154-173)
  it("find_matches returns [i, j, score] triples for within-threshold pairs only", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const instances1 = [
      Instance.fromArray([[10, 10], [20, 20]], skeleton),
      Instance.fromArray([[30, 30], [40, 40]], skeleton),
    ];
    const instances2 = [
      Instance.fromArray([[11, 11], [21, 21]], skeleton),
      Instance.fromArray([[50, 50], [60, 60]], skeleton),
    ];

    const matcher = new InstanceMatcher(InstanceMatchMethod.SPATIAL, {
      threshold: 5.0,
    });
    const matches = matcher.findMatches(instances1, instances2);

    expect(matches.length).toBe(1); // only first pair matches
    expect(matches[0][0]).toBe(0); // idx in list1
    expect(matches[0][1]).toBe(0); // idx in list2
    expect(matches[0][2]).toBeGreaterThan(0); // score positive
  });
});

// =============================================================================
// GROUP 11 — Instance edge cases (test_matching.py:496-1065)
// =============================================================================

describe("InstanceMatcher edge cases", () => {
  // test_instance_matcher_iou_with_overlap (496-539)
  it("iou with overlap: score 25/175 (0.14..0.15), no-overlap len 0, identical 1.0", () => {
    const skeleton = new Skeleton({ nodes: ["tl", "tr", "br", "bl"] });
    const inst1 = Instance.fromArray(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      skeleton,
    ); // box (0,0)-(10,10)
    const inst2 = Instance.fromArray(
      [[5, 5], [15, 5], [15, 15], [5, 15]],
      skeleton,
    ); // box (5,5)-(15,15)
    const inst3 = Instance.fromArray(
      [[20, 20], [30, 20], [30, 30], [20, 30]],
      skeleton,
    ); // box (20,20)-(30,30), no overlap
    const inst4 = Instance.fromArray(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      skeleton,
    ); // identical to inst1

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.0,
    });

    let matches = matcher.findMatches([inst1], [inst2]);
    expect(matches.length).toBe(1);
    expect(matches[0][0]).toBe(0);
    expect(matches[0][1]).toBe(0);
    // IoU = 25/175 ≈ 0.142857.
    expect(matches[0][2]).toBeGreaterThan(0.14);
    expect(matches[0][2]).toBeLessThan(0.15);

    // No overlap → no match (even at threshold 0.0).
    matches = matcher.findMatches([inst1], [inst3]);
    expect(matches.length).toBe(0);

    // Identical boxes → perfect overlap score 1.0.
    matches = matcher.findMatches([inst1], [inst4]);
    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe(1.0);
  });

  // test_instance_matcher_iou_edge_cases (541-570)
  it("iou NaN edge cases: degenerate bbox handled; no valid bbox → no match", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2"] });
    const inst1 = Instance.fromArray([[10, 10], [NaN_, NaN_]], skeleton); // one valid point
    const inst2 = Instance.fromArray([[11, 11], [21, 21]], skeleton);
    const inst3 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton); // all NaN, no bbox

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.0,
    });

    // inst1 has only one valid point → degenerate bbox; either no match or score 0.
    let matches = matcher.findMatches([inst1], [inst2]);
    expect(matches.length === 0 || matches[0][2] === 0.0).toBe(true);

    // inst3 has no valid bounding box → no match.
    matches = matcher.findMatches([inst3], [inst2]);
    expect(matches.length).toBe(0);

    // Neither has a valid bounding box → no match.
    matches = matcher.findMatches([inst3], [inst3]);
    expect(matches.length).toBe(0);
  });

  // test_instance_matcher_spatial_no_overlap (624-645)
  it("spatial disjoint valid nodes → no match (no common valid node)", () => {
    const skel = new Skeleton({ nodes: ["head", "thorax", "abdomen"] });
    // Valid head, thorax; abdomen NaN.
    const inst1 = Instance.fromArray([[1, 2], [3, 4], [NaN_, NaN_]], skel);
    // NaN head, thorax; valid abdomen only.
    const inst2 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_], [5, 6]], skel);

    const matcher = new InstanceMatcher(InstanceMatchMethod.SPATIAL, {
      threshold: 10.0,
    });

    expect(matcher.match(inst1, inst2)).toBe(false); // no overlapping valid points
    const matches = matcher.findMatches([inst1], [inst2]);
    expect(matches.length).toBe(0);
  });

  // test_instance_matcher_iou_no_bounding_box (647-664)
  it("iou with one all-NaN (no bbox) → no match", () => {
    const skel = new Skeleton({ nodes: ["head", "thorax"] });
    const inst1 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skel); // no bbox
    const inst2 = Instance.fromArray([[1, 2], [3, 4]], skel);

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.5,
    });

    expect(matcher.match(inst1, inst2)).toBe(false); // inst1 no bbox
    const matches = matcher.findMatches([inst1], [inst2]);
    expect(matches.length).toBe(0);
  });

  // test_instance_matcher_iou_no_intersection (666-681)
  it("iou no intersection → no match at threshold 0.1", () => {
    const skel = new Skeleton({ nodes: ["head", "thorax"] });
    const inst1 = Instance.fromArray([[0, 0], [1, 1]], skel); // box (0,0)-(1,1)
    const inst2 = Instance.fromArray([[10, 10], [11, 11]], skel); // box (10,10)-(11,11)

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.1,
    });

    expect(matcher.match(inst1, inst2)).toBe(false); // no intersection
    const matches = matcher.findMatches([inst1], [inst2]);
    expect(matches.length).toBe(0);
  });

  // test_find_matches_spatial_matching_edge_cases (755-774)
  it("find_matches identity: score 1.0 even with no spatial overlap (disjoint valid points)", () => {
    const skel = new Skeleton({ nodes: ["head", "thorax"] });
    const inst1 = Instance.fromArray([[1, 2], [NaN_, NaN_]], skel);
    const inst2 = Instance.fromArray([[NaN_, NaN_], [3, 4]], skel);

    // Shared track for identity matching.
    const sharedTrack = new Track("track1");
    inst1.track = sharedTrack;
    inst2.track = sharedTrack;

    const matcher = new InstanceMatcher(InstanceMatchMethod.IDENTITY);
    const matches = matcher.findMatches([inst1], [inst2]);

    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe(1.0); // binary identity score
  });

  // test_find_matches_iou_matching_edge_cases (776-810)
  it("find_matches identity (iou setup): valid bboxes no intersection but identity → score 1.0", () => {
    const skel = new Skeleton({ nodes: ["head", "thorax"] });
    const inst3 = Instance.fromArray([[0, 0], [1, 1]], skel);
    const inst4 = Instance.fromArray([[10, 10], [11, 11]], skel);

    const sharedTrack2 = new Track("track2");
    inst3.track = sharedTrack2;
    inst4.track = sharedTrack2;

    const matcherIdentity = new InstanceMatcher(InstanceMatchMethod.IDENTITY);
    const matches = matcherIdentity.findMatches([inst3], [inst4]);

    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe(1.0); // binary identity score
  });

  // test_instance_matcher_find_matches_all_nan_spatial (812-834)
  it("find_matches SPATIAL both all-NaN (no track) → len 1, score 0.0", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const inst1 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton);
    const inst2 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton);

    const matcher = new InstanceMatcher(InstanceMatchMethod.SPATIAL, {
      threshold: 10.0,
    });
    const matches = matcher.findMatches([inst1], [inst2]);

    expect(matches.length).toBe(1); // both-all-NaN DOES match
    expect(matches[0][2]).toBe(0.0); // score 0 for all NaN
  });

  // test_instance_matcher_find_matches_iou_no_intersection (836-858)
  it("find_matches IOU ignores track: shared track + IoU 0 → len 0", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const inst1 = Instance.fromArray([[0, 0], [10, 10]], skeleton); // box (0,0)-(10,10)
    const inst2 = Instance.fromArray([[20, 20], [30, 30]], skeleton); // box (20,20)-(30,30)

    const sharedTrack = new Track("track1");
    inst1.track = sharedTrack;
    inst2.track = sharedTrack;

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.01,
    });
    const matches = matcher.findMatches([inst1], [inst2]);

    expect(matches.length).toBe(0); // IoU 0 → no match despite shared track
  });

  // test_instance_matcher_find_matches_iou_null_bbox (860-884)
  it("find_matches IOU null bbox (one all-NaN) + shared track → len 0", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const inst1 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton); // no bbox
    const inst2 = Instance.fromArray([[10, 10], [20, 20]], skeleton);

    const sharedTrack = new Track("track1");
    inst1.track = sharedTrack;
    inst2.track = sharedTrack;

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.1,
    });
    const matches = matcher.findMatches([inst1], [inst2]);

    expect(matches.length).toBe(0); // null bbox → no match
  });

  // test_instance_matcher_iou_score_edge_cases (962-1009)
  it("iou never matches without valid intersecting bboxes (threshold 0.0)", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2"] });

    // Case 1: both all-NaN, shared track.
    const inst1NoBbox = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton);
    const inst2NoBbox = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton);
    const track = new Track("track1");
    inst1NoBbox.track = track;
    inst2NoBbox.track = track;

    const matcher = new InstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.0,
    });
    expect(matcher.findMatches([inst1NoBbox], [inst2NoBbox]).length).toBe(0);

    // Case 2: one has bbox, other doesn't.
    const instWithBbox = Instance.fromArray([[10, 10], [20, 20]], skeleton);
    instWithBbox.track = track;
    expect(matcher.findMatches([inst1NoBbox], [instWithBbox]).length).toBe(0);

    // Case 3: bboxes don't intersect.
    const inst3 = Instance.fromArray([[0, 0], [5, 5]], skeleton);
    const inst4 = Instance.fromArray([[10, 10], [15, 15]], skeleton);
    const track2 = new Track("track2");
    inst3.track = track2;
    inst4.track = track2;
    expect(matcher.findMatches([inst3], [inst4]).length).toBe(0);
  });

  // test_instance_matcher_iou_score_calculation_coverage (1011-1065)
  it("gate vs score separation: forced match()=true still yields score 0.0 for degenerate geometry", () => {
    const skeleton = new Skeleton({ nodes: ["tl", "tr", "br", "bl"] });

    // Subclass overriding match() to ALWAYS return true, forcing the separate
    // IoU-score branch to run (mirrors Python's TestableInstanceMatcher).
    class TestableInstanceMatcher extends InstanceMatcher {
      match(): boolean {
        return true;
      }
    }

    const matcher = new TestableInstanceMatcher(InstanceMatchMethod.IOU, {
      threshold: 0.0,
    });

    // Case 1: bounding boxes don't intersect → score 0.0.
    const inst1 = Instance.fromArray(
      [[0, 0], [2, 0], [2, 2], [0, 2]],
      skeleton,
    );
    const inst2 = Instance.fromArray(
      [[10, 10], [12, 10], [12, 12], [10, 12]],
      skeleton,
    );
    let matches = matcher.findMatches([inst1], [inst2]);
    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe(0.0); // no intersection → 0.0

    // Case 2: one instance has no valid bounding box → score 0.0.
    const inst3 = Instance.fromArray(
      [[NaN_, NaN_], [NaN_, NaN_], [NaN_, NaN_], [NaN_, NaN_]],
      skeleton,
    );
    const inst4 = Instance.fromArray(
      [[5, 5], [7, 5], [7, 7], [5, 7]],
      skeleton,
    );
    matches = matcher.findMatches([inst3], [inst4]);
    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe(0.0); // no bbox → 0.0

    // Case 3: both instances have no valid bounding box → score 0.0.
    const inst5 = Instance.fromArray(
      [[NaN_, NaN_], [NaN_, NaN_], [NaN_, NaN_], [NaN_, NaN_]],
      skeleton,
    );
    matches = matcher.findMatches([inst3], [inst5]);
    expect(matches.length).toBe(1);
    expect(matches[0][2]).toBe(0.0); // no bbox either side → 0.0
  });
});

// =============================================================================
// Direct Instance method checks: samePoseAs / sameIdentityAs / overlapsWith /
// boundingBox. These exercise the same primitives the matcher delegates to,
// pinning the documented per-method semantics (ARCH §4.2).
// =============================================================================

describe("Instance.samePoseAs", () => {
  it("near poses within tolerance → true; far → false", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const inst1 = Instance.fromArray([[10, 10], [20, 20]], skeleton);
    const inst2 = Instance.fromArray([[11, 11], [21, 21]], skeleton);
    const inst3 = Instance.fromArray([[50, 50], [60, 60]], skeleton);

    expect(inst1.samePoseAs(inst2, 5.0)).toBe(true);
    expect(inst1.samePoseAs(inst3, 5.0)).toBe(false);
  });

  it("disjoint valid nodes → false (no common visible node within tolerance)", () => {
    const skel = new Skeleton({ nodes: ["head", "thorax", "abdomen"] });
    const inst1 = Instance.fromArray([[1, 2], [3, 4], [NaN_, NaN_]], skel);
    const inst2 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_], [5, 6]], skel);
    // NaN masks differ (head/thorax valid vs abdomen valid) → false.
    expect(inst1.samePoseAs(inst2, 10.0)).toBe(false);
  });

  it("skeleton mismatch short-circuits to false before point compare", () => {
    const skelA = new Skeleton({ nodes: ["head", "tail"] });
    const skelB = new Skeleton({ nodes: ["head", "wing"] });
    const inst1 = Instance.fromArray([[1, 2], [3, 4]], skelA);
    const inst2 = Instance.fromArray([[1, 2], [3, 4]], skelB);
    expect(inst1.samePoseAs(inst2, 5.0)).toBe(false);
  });
});

describe("Instance.sameIdentityAs", () => {
  it("same Track object → true; different Track → false; null track → false", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const track1 = new Track("track1");
    const track2 = new Track("track2");

    const inst1 = new Instance({ points: [[10, 10], [20, 20]], skeleton, track: track1 });
    const inst2 = new Instance({ points: [[50, 50], [60, 60]], skeleton, track: track1 });
    const inst3 = new Instance({ points: [[10, 10], [20, 20]], skeleton, track: track2 });
    const instNoTrack = Instance.fromArray([[10, 10], [20, 20]], skeleton);

    expect(inst1.sameIdentityAs(inst2)).toBe(true); // same object
    expect(inst1.sameIdentityAs(inst3)).toBe(false); // different object
    expect(inst1.sameIdentityAs(instNoTrack)).toBe(false); // null track other
    expect(instNoTrack.sameIdentityAs(inst1)).toBe(false); // null track self
  });

  it("same name but distinct Track objects → false (identity, not name)", () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const trackA = new Track("same");
    const trackB = new Track("same");
    const inst1 = new Instance({ points: [[1, 2], [3, 4]], skeleton, track: trackA });
    const inst2 = new Instance({ points: [[1, 2], [3, 4]], skeleton, track: trackB });
    expect(inst1.sameIdentityAs(inst2)).toBe(false);
  });
});

describe("Instance.overlapsWith", () => {
  it("overlapping boxes pass at low threshold; disjoint fail", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2", "p3", "p4"] });
    const inst1 = Instance.fromArray([[0, 0], [10, 0], [10, 10], [0, 10]], skeleton);
    const inst2 = Instance.fromArray([[5, 5], [15, 5], [15, 15], [5, 15]], skeleton);
    const inst3 = Instance.fromArray([[20, 20], [30, 20], [30, 30], [20, 30]], skeleton);

    // IoU ≈ 0.1428: passes threshold 0.1, fails default 0.5.
    expect(inst1.overlapsWith(inst2, 0.1)).toBe(true);
    expect(inst1.overlapsWith(inst2)).toBe(false); // default threshold 0.5
    expect(inst1.overlapsWith(inst3, 0.1)).toBe(false); // no overlap
  });

  it("touching boxes (shared edge) count as NO overlap", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2"] });
    const inst1 = Instance.fromArray([[0, 0], [10, 10]], skeleton); // box (0,0)-(10,10)
    const inst2 = Instance.fromArray([[10, 0], [20, 10]], skeleton); // box (10,0)-(20,10)
    // Boxes share the x=10 edge → strict-< IoU is 0 → no overlap at any positive threshold.
    expect(inst1.overlapsWith(inst2, 0.0)).toBe(false);
  });

  it("no bounding box (all-NaN) → no overlap", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2"] });
    const inst1 = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton);
    const inst2 = Instance.fromArray([[0, 0], [10, 10]], skeleton);
    expect(inst1.overlapsWith(inst2, 0.0)).toBe(false);
  });
});

describe("Instance.boundingBox", () => {
  it("computed over visible points as [[minX,minY],[maxX,maxY]]", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2", "p3", "p4"] });
    const inst = Instance.fromArray(
      [[2, 3], [10, 1], [7, 12], [4, 6]],
      skeleton,
    );
    expect(inst.boundingBox()).toEqual([
      [2, 1],
      [10, 12],
    ]);
  });

  it("ignores NaN (invisible) points when computing extents", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2", "p3"] });
    const inst = Instance.fromArray([[5, 5], [NaN_, NaN_], [15, 20]], skeleton);
    expect(inst.boundingBox()).toEqual([
      [5, 5],
      [15, 20],
    ]);
  });

  it("returns null when no points are visible (all NaN)", () => {
    const skeleton = new Skeleton({ nodes: ["p1", "p2"] });
    const inst = Instance.fromArray([[NaN_, NaN_], [NaN_, NaN_]], skeleton);
    expect(inst.boundingBox()).toBeNull();
  });
});
