/* @vitest-environment node */
/**
 * Port of Python PR #436 (sleap-io issue #107): the Labels lookup APIs are
 * widened to accept a foreign video reference (`Video | string | URL`) and
 * resolve it to the canonical project `Video` via the SYNC `_resolveVideo`
 * cascade (identity -> unique strict `matchesPath` -> unique basename
 * `matchesPath`, raising on ambiguity). `matchVideo` itself already shipped and
 * is NOT re-tested here.
 *
 * These tests are fully programmatic (no FS / real data) so they run anywhere.
 * Assertions encode the PYTHON-expected behavior; src is untouched.
 *
 * Python references (sleap-io @ 054cce39f):
 *   tests/model/test_labels.py::test_get_queries_foreign_video (542-556)
 *   tests/model/test_labels.py::test_find_foreign_video        (487-497)
 *   tests/model/test_labels.py::test_match_video_basename_fallback (373-379)
 *   tests/model/test_labels.py::test_match_video_definitive_over_basename
 *   tests/model/test_labels.py::test_match_video_ambiguous_raises (393-400)
 *   tests/model/test_labels.py::test_extract_foreign_video     (532-539)
 */
import { describe, it, expect } from "vitest";
import {
  Labels,
  Video,
  Skeleton,
  Instance,
  Track,
  ROI,
  SegmentationMask,
  UserBoundingBox,
  UserCentroid,
  UserLabelImage,
  LabeledFrame,
} from "../../src/index.js";

/**
 * Build a small programmatic Labels with a single canonical Video whose
 * filename carries a directory prefix (so basename resolution from a bare
 * "clip.mp4" applies) and one labeled frame at `frameIdx` 10.
 */
function buildLabels() {
  const skeleton = new Skeleton({ nodes: ["A", "B"] });
  // Canonical video lives under a directory so a bare-basename query must use
  // the basename tier (not the strict path tier) to resolve.
  const canonical = new Video({ filename: "path/to/clip.mp4", openBackend: false });
  const inst = Instance.fromArray(
    [
      [1, 2],
      [3, 4],
    ],
    skeleton,
  );
  const lf = new LabeledFrame({
    video: canonical,
    frameIdx: 10,
    instances: [inst],
  });
  const labels = new Labels({
    labeledFrames: [lf],
    videos: [canonical],
    skeletons: [skeleton],
  });
  return { labels, canonical, lf, skeleton, inst };
}

describe("Labels lookup widening (#107 / Python PR #436)", () => {
  describe("find()", () => {
    it("ACCEPTANCE: find({video: 'clip.mp4'}) returns the SAME LabeledFrame as find({video: canonical})", () => {
      const { labels, canonical, lf } = buildLabels();

      const byString = labels.find({ video: "clip.mp4", frameIdx: 10 });
      const byCanonical = labels.find({ video: canonical, frameIdx: 10 });

      expect(byCanonical).toHaveLength(1);
      expect(byCanonical[0]).toBe(lf);
      expect(byString).toHaveLength(1);
      // Same object identity, resolved via basename.
      expect(byString[0]).toBe(byCanonical[0]);
      expect(byString[0]).toBe(lf);
    });

    it("resolves a foreign Video (same path, different identity) to itself", () => {
      const { labels, canonical, lf } = buildLabels();
      const foreign = new Video({
        filename: canonical.filename as string,
        openBackend: false,
      });
      expect(foreign).not.toBe(canonical);

      const results = labels.find({ video: foreign });
      expect(results).toHaveLength(1);
      expect(results[0]).toBe(lf);
    });

    it("returns the canonical Video's frames for an identity reference", () => {
      const { labels, canonical, lf } = buildLabels();
      const results = labels.find({ video: canonical });
      expect(results).toEqual([lf]);
    });

    it("returns empty (no throw) for a non-matching string", () => {
      const { labels } = buildLabels();
      let results: LabeledFrame[] = [];
      expect(() => {
        results = labels.find({ video: "not_in_project.mp4", frameIdx: 10 });
      }).not.toThrow();
      expect(results).toEqual([]);
    });

    it("resolves a foreign filename that shares only the basename (relocated file)", () => {
      const { labels, lf } = buildLabels();
      // Different directory, same basename -> basename tier resolves.
      const results = labels.find({ video: "/new/location/clip.mp4", frameIdx: 10 });
      expect(results).toHaveLength(1);
      expect(results[0]).toBe(lf);
    });
  });

  describe("ambiguity", () => {
    it("throws when a basename query matches two project videos (test_match_video_ambiguous_raises)", () => {
      const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
      const v2 = new Video({ filename: "/dir2/vid.mp4", openBackend: false });
      const lf1 = new LabeledFrame({ video: v1, frameIdx: 0 });
      const lf2 = new LabeledFrame({ video: v2, frameIdx: 0 });
      const labels = new Labels({
        labeledFrames: [lf1, lf2],
        videos: [v1, v2],
      });

      expect(() => labels.find({ video: "/elsewhere/vid.mp4" })).toThrow(
        /Ambiguous video match/,
      );
    });

    it("an exact path wins over a shared basename (no false ambiguity)", () => {
      const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
      const v2 = new Video({ filename: "/dir2/vid.mp4", openBackend: false });
      const lf1 = new LabeledFrame({ video: v1, frameIdx: 0 });
      const lf2 = new LabeledFrame({ video: v2, frameIdx: 0 });
      const labels = new Labels({
        labeledFrames: [lf1, lf2],
        videos: [v1, v2],
      });

      expect(labels.find({ video: "/dir1/vid.mp4" })).toEqual([lf1]);
      expect(labels.find({ video: "/dir2/vid.mp4" })).toEqual([lf2]);
    });
  });

  describe("URL references", () => {
    it("coerces new URL('file:///x/clip.mp4') to its string and resolves by basename", () => {
      const { labels, canonical, lf } = buildLabels();
      const url = new URL("file:///x/clip.mp4");

      const byUrl = labels.find({ video: url, frameIdx: 10 });
      const byCanonical = labels.find({ video: canonical, frameIdx: 10 });

      expect(byUrl).toHaveLength(1);
      expect(byUrl[0]).toBe(lf);
      expect(byUrl[0]).toBe(byCanonical[0]);
    });

    it("a non-matching URL yields empty results (no throw)", () => {
      const { labels } = buildLabels();
      const url = new URL("file:///x/other.mp4");
      expect(labels.find({ video: url })).toEqual([]);
    });
  });

  describe("numpy()", () => {
    it("widens video to a basename string (test_get_queries_foreign_video)", () => {
      const { labels, canonical } = buildLabels();
      const byString = labels.numpy({ video: "clip.mp4" });
      const byCanonical = labels.numpy({ video: canonical });
      const byForeign = labels.numpy({
        video: new Video({ filename: canonical.filename as string, openBackend: false }),
      });

      // One labeled frame at idx 10 -> 11 frames (shape[0]) since maxFrame == 10.
      expect(byCanonical.length).toBe(byString.length);
      expect(byCanonical.length).toBe(byForeign.length);
      expect(byCanonical.length).toBeGreaterThan(0);
    });

    it("accepts an integer index to select the video", () => {
      const { labels, canonical } = buildLabels();
      const byIndex = labels.numpy({ video: 0 });
      const byCanonical = labels.numpy({ video: canonical });
      expect(byIndex.length).toBe(byCanonical.length);
      expect(byIndex.length).toBeGreaterThan(0);
    });
  });

  describe("extract()", () => {
    it("widens a single string selector to the canonical Video (test_extract_foreign_video)", () => {
      const { labels, canonical } = buildLabels();
      const byString = labels.extract("clip.mp4");
      const byCanonical = labels.extract(canonical);
      expect(byString.labeledFrames).toHaveLength(1);
      expect(byCanonical.labeledFrames).toHaveLength(1);
      expect(byString.labeledFrames.length).toBe(byCanonical.labeledFrames.length);
    });

    it("widens [video, idx] tuple selectors with a foreign Video / string", () => {
      const { labels, canonical } = buildLabels();
      const foreign = new Video({
        filename: canonical.filename as string,
        openBackend: false,
      });

      const byForeignTuple = labels.extract([[foreign, 10]]);
      const byStringTuple = labels.extract([["clip.mp4", 10]]);
      const byCanonicalTuple = labels.extract([[canonical, 10]]);

      expect(byForeignTuple.labeledFrames).toHaveLength(1);
      expect(byStringTuple.labeledFrames).toHaveLength(1);
      expect(byCanonicalTuple.labeledFrames).toHaveLength(1);
    });

    it("widens a URL selector by basename", () => {
      const { labels, canonical } = buildLabels();
      const byUrl = labels.extract(new URL("file:///x/clip.mp4"));
      const byCanonical = labels.extract(canonical);
      expect(byUrl.labeledFrames).toHaveLength(byCanonical.labeledFrames.length);
      expect(byUrl.labeledFrames).toHaveLength(1);
    });
  });

  describe("get* family widening", () => {
    it("getCentroids({video: 'name'}) matches passing the canonical Video", () => {
      const skeleton = new Skeleton({ nodes: ["A", "B"] });
      const video = new Video({ filename: "/data/vid.mp4", openBackend: false });
      const inst = Instance.fromArray(
        [
          [1, 2],
          [3, 4],
        ],
        skeleton,
      );
      const centroid = new UserCentroid({ x: 5, y: 10 });
      const lf = new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [inst],
        centroids: [centroid],
      });
      const labels = new Labels({
        labeledFrames: [lf],
        videos: [video],
        skeletons: [skeleton],
      });

      const foreign = new Video({ filename: "/data/vid.mp4", openBackend: false });
      expect(labels.getCentroids({ video })).toEqual([centroid]);
      expect(labels.getCentroids({ video: foreign })).toEqual([centroid]);
      expect(labels.getCentroids({ video: "/data/vid.mp4" })).toEqual([centroid]);
      // Bare basename also resolves via the basename tier.
      expect(labels.getCentroids({ video: "vid.mp4" })).toEqual([centroid]);
    });

    it("getRois({video: 'name'}) matches passing the canonical Video", () => {
      const video = new Video({ filename: "/data/v1.mp4", openBackend: false });
      const roi = ROI.fromBbox(0, 0, 10, 10, { video });
      const lf = new LabeledFrame({ video, frameIdx: 0, rois: [roi] });
      const labels = new Labels({ labeledFrames: [lf], videos: [video] });

      const foreign = new Video({ filename: "/data/v1.mp4", openBackend: false });
      expect(labels.getRois({ video })).toEqual([roi]);
      expect(labels.getRois({ video: foreign })).toEqual([roi]);
      expect(labels.getRois({ video: "/data/v1.mp4" })).toEqual([roi]);
      expect(labels.getRois({ video: "v1.mp4" })).toEqual([roi]);
    });

    it("getMasks({video: 'name'}) matches passing the canonical Video", () => {
      const video = new Video({ filename: "/data/m.mp4", openBackend: false });
      const mask = SegmentationMask.fromArray(new Uint8Array(4), 2, 2);
      const lf = new LabeledFrame({ video, frameIdx: 0, masks: [mask] });
      const labels = new Labels({ labeledFrames: [lf], videos: [video] });

      const foreign = new Video({ filename: "/data/m.mp4", openBackend: false });
      expect(labels.getMasks({ video })).toEqual([mask]);
      expect(labels.getMasks({ video: foreign })).toEqual([mask]);
      expect(labels.getMasks({ video: "/data/m.mp4" })).toEqual([mask]);
      expect(labels.getMasks({ video: "m.mp4" })).toEqual([mask]);
    });

    it("getBboxes({video: 'name'}) matches passing the canonical Video", () => {
      const video = new Video({ filename: "/data/b.mp4", openBackend: false });
      const bbox = new UserBoundingBox({ x1: 0, y1: 10, x2: 100, y2: 90 });
      const lf = new LabeledFrame({ video, frameIdx: 0, bboxes: [bbox] });
      const labels = new Labels({ labeledFrames: [lf], videos: [video] });

      const foreign = new Video({ filename: "/data/b.mp4", openBackend: false });
      expect(labels.getBboxes({ video })).toEqual([bbox]);
      expect(labels.getBboxes({ video: foreign })).toEqual([bbox]);
      expect(labels.getBboxes({ video: "/data/b.mp4" })).toEqual([bbox]);
      expect(labels.getBboxes({ video: "b.mp4" })).toEqual([bbox]);
    });

    it("getLabelImages({video: 'name'}) matches passing the canonical Video", () => {
      const video = new Video({ filename: "/data/li.mp4", openBackend: false });
      const li = new UserLabelImage({
        data: new Uint8Array(4),
        height: 2,
        width: 2,
      });
      const lf = new LabeledFrame({ video, frameIdx: 0, labelImages: [li] });
      const labels = new Labels({ labeledFrames: [lf], videos: [video] });

      const foreign = new Video({ filename: "/data/li.mp4", openBackend: false });
      expect(labels.getLabelImages({ video })).toEqual([li]);
      expect(labels.getLabelImages({ video: foreign })).toEqual([li]);
      expect(labels.getLabelImages({ video: "/data/li.mp4" })).toEqual([li]);
      expect(labels.getLabelImages({ video: "li.mp4" })).toEqual([li]);
    });

    it("get* widening returns empty for a non-matching string (no throw)", () => {
      const video = new Video({ filename: "/data/vid.mp4", openBackend: false });
      const roi = ROI.fromBbox(0, 0, 10, 10, { video });
      const lf = new LabeledFrame({ video, frameIdx: 0, rois: [roi] });
      const labels = new Labels({ labeledFrames: [lf], videos: [video] });

      let result: ROI[] = [];
      expect(() => {
        result = labels.getRois({ video: "missing.mp4" });
      }).not.toThrow();
      expect(result).toEqual([]);
    });

    it("get* widening throws on an ambiguous basename query", () => {
      const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
      const v2 = new Video({ filename: "/dir2/vid.mp4", openBackend: false });
      const roi1 = ROI.fromBbox(0, 0, 10, 10, { video: v1 });
      const roi2 = ROI.fromBbox(0, 0, 10, 10, { video: v2 });
      const lf1 = new LabeledFrame({ video: v1, frameIdx: 0, rois: [roi1] });
      const lf2 = new LabeledFrame({ video: v2, frameIdx: 0, rois: [roi2] });
      const labels = new Labels({
        labeledFrames: [lf1, lf2],
        videos: [v1, v2],
      });

      expect(() => labels.getRois({ video: "/elsewhere/vid.mp4" })).toThrow(
        /Ambiguous video match/,
      );
    });
  });
});
