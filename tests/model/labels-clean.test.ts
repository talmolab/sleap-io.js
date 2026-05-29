/**
 * Port of Labels.clean() / removePredictions(clean) Python tests.
 *
 * GROUND TRUTH: C:/Users/Talmo/code/sleap-io @ 054cce39f
 *   tests/model/test_labels.py ::
 *     test_clean_invalidates_indices                 (6989-7006)
 *     test_clean_preserves_frames_with_any_annotations (7008-7043)
 *     test_clean_removes_truly_empty_frames_only      (7045-7081)
 *     test_clean_removes_orphaned_annotation_tracks    (7228-7258)
 *     test_clean_preserves_trackless_annotations       (7260-7270)
 *     test_clean_removes_label_image_orphaned_tracks    (7429-7463)
 *     test_clean_orphaned_annotations_without_frame_removal (7465-7505)
 *     test_remove_predictions_clears_predicted_annotations  (7312-7342)
 *     test_labels_clean_unchanged                       (~588-...)
 *
 * Notes on the port:
 * - Python `labels.clean(frames=..., tracks=..., ...)` -> JS
 *   `labels.clean({ frames, tracks, ... })`.
 * - Python `is None` (the cached index) -> JS the index getters return null; we
 *   assert behavior (get(video, frameIdx) returns null) per JS API.
 * - Python `type(x) is Instance` -> JS `x.constructor === Instance`.
 * - Annotation centroids carry their own `track`; we assert preservation /
 *   pruning by reference identity.
 */
import { describe, it, expect } from "../bun-test";
import { Instance, PredictedInstance, Track } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Labels } from "../../src/model/labels.js";
import { UserCentroid, PredictedCentroid } from "../../src/model/centroid.js";
import { UserBoundingBox, PredictedBoundingBox } from "../../src/model/bbox.js";
import { UserSegmentationMask } from "../../src/model/mask.js";
import { UserROI } from "../../src/model/roi.js";
import { UserLabelImage } from "../../src/model/label-image.js";

describe("Labels.clean", () => {
  // test_clean_invalidates_indices (test_labels.py:6989-7006)
  it("removes empty frames and invalidates cached frame index", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = Instance.fromArray([[10.0, 20.0]], skeleton);
    const lf0 = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1 }); // Empty, will be removed
    const labels = new Labels({
      labeledFrames: [lf0, lf1],
      videos: [video],
      skeletons: [skeleton],
    });

    // Build index.
    expect(labels.getFrame(video, 1)).toBe(lf1);

    // Clean removes empty frame and invalidates the index.
    labels.clean();
    expect(labels.getFrame(video, 1)).toBe(null);
    expect(labels.getFrame(video, 0)).toBe(lf0);
  });

  // test_clean_preserves_frames_with_any_annotations (test_labels.py:7008-7043)
  it("preserves frames with any annotation type (no instances)", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const c = new UserCentroid({ x: 1.0, y: 2.0 });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });
    const maskData: boolean[][] = Array.from({ length: 10 }, () =>
      new Array(10).fill(false),
    );
    for (let r = 2; r < 8; r++) for (let cc = 2; cc < 8; cc++) maskData[r][cc] = true;
    const m = UserSegmentationMask.fromArray(maskData, 10, 10);
    const roi = UserROI.fromBbox(0, 0, 10, 10, { video });
    const li = new UserLabelImage({
      data: Int32Array.from([0, 1]),
      height: 1,
      width: 2,
      objects: new Map([[1, { track: null, category: "cell", name: "", instance: null }]]),
    });

    const lf0 = new LabeledFrame({ video, frameIdx: 0, centroids: [c] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, bboxes: [b] });
    const lf2 = new LabeledFrame({ video, frameIdx: 2, masks: [m] });
    const lf3 = new LabeledFrame({ video, frameIdx: 3, rois: [roi] });
    const lf4 = new LabeledFrame({ video, frameIdx: 4, labelImages: [li] });
    const labels = new Labels({
      labeledFrames: [lf0, lf1, lf2, lf3, lf4],
      videos: [video],
    });

    expect(labels.labeledFrames.length).toBe(5);

    labels.clean();
    expect(labels.labeledFrames.length).toBe(5);

    for (const lf of labels.labeledFrames) {
      const hasAny =
        lf.centroids.length > 0 ||
        lf.bboxes.length > 0 ||
        lf.masks.length > 0 ||
        lf.labelImages.length > 0 ||
        lf.rois.length > 0;
      expect(hasAny).toBe(true);
    }
  });

  // test_clean_removes_truly_empty_frames_only (test_labels.py:7045-7081)
  it("removes truly empty frames but keeps annotation-only and instance frames", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = Instance.fromArray([[10.0, 20.0]], skeleton);

    const lf0 = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const c = new UserCentroid({ x: 1.0, y: 2.0 });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, centroids: [c] });
    const lf2 = new LabeledFrame({ video, frameIdx: 2 }); // truly empty

    const labels = new Labels({
      labeledFrames: [lf0, lf1, lf2],
      videos: [video],
      skeletons: [skeleton],
    });
    expect(labels.labeledFrames.length).toBe(3);

    labels.clean();

    expect(labels.labeledFrames.length).toBe(2);
    const frameIdxs = new Set(labels.labeledFrames.map((lf) => lf.frameIdx));
    expect(frameIdxs).toEqual(new Set([0, 1]));
  });

  // test_clean_removes_orphaned_annotation_tracks (test_labels.py:7228-7258)
  it("removes annotations whose tracks are no longer in self.tracks", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const trackKeep = new Track("keep");
    const trackRemove = new Track("remove");
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({
      points: [{ xy: [1.0, 2.0], visible: true, complete: false }],
      skeleton,
      track: trackKeep,
    });

    const cKeep = new UserCentroid({ x: 1.0, y: 2.0, track: trackKeep });
    const cRemove = new UserCentroid({ x: 3.0, y: 4.0, track: trackRemove });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      centroids: [cKeep, cRemove],
    });

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackKeep, trackRemove],
    });

    // Remove trackRemove externally, then clean.
    labels.tracks = labels.tracks.filter((t) => t !== trackRemove);
    labels.clean();

    expect(lf.centroids.length).toBe(1);
    expect(lf.centroids[0].track).toBe(trackKeep);
  });

  // test_clean_preserves_trackless_annotations (test_labels.py:7260-7270)
  it("preserves annotations without tracks during track cleanup", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const cNoTrack = new UserCentroid({ x: 1.0, y: 2.0 });
    const lf = new LabeledFrame({ video, frameIdx: 0, centroids: [cNoTrack] });
    const labels = new Labels({ labeledFrames: [lf], videos: [video] });

    labels.clean();
    expect(lf.centroids.length).toBe(1);
    expect(lf.centroids[0]).toBe(cNoTrack);
  });

  // test_clean_removes_label_image_orphaned_tracks (test_labels.py:7429-7463)
  it("removes label_image object entries with orphaned tracks", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const trackKeep = new Track("keep");
    const trackRemove = new Track("remove");
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({
      points: [{ xy: [1.0, 2.0], visible: true, complete: false }],
      skeleton,
      track: trackKeep,
    });

    const li = new UserLabelImage({
      data: Int32Array.from([0, 1, 2]),
      height: 1,
      width: 3,
      objects: new Map([
        [1, { track: trackKeep, category: "cell", name: "", instance: null }],
        [2, { track: trackRemove, category: "cell", name: "", instance: null }],
      ]),
    });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      labelImages: [li],
    });

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackKeep, trackRemove],
    });

    labels.tracks = labels.tracks.filter((t) => t !== trackRemove);
    labels.clean();

    expect(lf.labelImages[0].objects.size).toBe(1);
    expect(lf.labelImages[0].objects.has(1)).toBe(true);
    expect(lf.labelImages[0].objects.get(1)!.track).toBe(trackKeep);
  });

  // test_clean_orphaned_annotations_without_frame_removal (test_labels.py:7465-7505)
  it("clean(frames=false, tracks=true) removes orphaned annotations", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const trackKeep = new Track("keep");
    const trackRemove = new Track("remove");
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({
      points: [{ xy: [1.0, 2.0], visible: true, complete: false }],
      skeleton,
      track: trackKeep,
    });

    const cKeep = new UserCentroid({ x: 1.0, y: 2.0, track: trackKeep });
    const cRemove = new UserCentroid({ x: 3.0, y: 4.0, track: trackRemove });
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      centroids: [cKeep, cRemove],
    });

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackKeep, trackRemove],
    });

    labels.tracks = labels.tracks.filter((t) => t !== trackRemove);
    labels.clean({ frames: false, tracks: true });

    expect(lf.centroids.length).toBe(1);
    expect(lf.centroids[0].track).toBe(trackKeep);
  });

  // test_labels_clean_unchanged (test_labels.py:586-...) -- the all-flags-on
  // case where every container is already minimal: counts are unchanged. Here
  // we reconstruct programmatically rather than load slp_real_data.
  it("clean with all flags on leaves a minimal dataset unchanged", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const lf0 = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [
        Instance.fromArray(
          [
            [1, 2],
            [3, 4],
          ],
          skeleton,
        ),
        Instance.fromArray(
          [
            [5, 6],
            [7, 8],
          ],
          skeleton,
        ),
      ],
    });
    const lf1 = new LabeledFrame({
      video,
      frameIdx: 990,
      instances: [
        Instance.fromArray(
          [
            [1, 2],
            [3, 4],
          ],
          skeleton,
        ),
        Instance.fromArray(
          [
            [5, 6],
            [7, 8],
          ],
          skeleton,
        ),
      ],
    });
    const labels = new Labels({
      labeledFrames: [lf0, lf1],
      videos: [video],
      skeletons: [skeleton],
    });

    expect(labels.labeledFrames.length).toBe(2);
    labels.clean({
      frames: true,
      emptyInstances: true,
      skeletons: true,
      tracks: true,
      videos: true,
    });
    expect(labels.labeledFrames.length).toBe(2);
    expect(labels.labeledFrames[0].frameIdx).toBe(0);
    expect(labels.labeledFrames[0].instances.length).toBe(2);
    expect(labels.labeledFrames[1].frameIdx).toBe(990);
    expect(labels.labeledFrames[1].instances.length).toBe(2);
    expect(labels.skeletons.length).toBe(1);
    expect(labels.videos.length).toBe(1);
    expect(labels.tracks.length).toBe(0);
  });

  // Negative / background frames are preserved (ARCH §7.3; doc G4). Not a direct
  // Python test in this file, but the JS clean() explicitly guards isNegative.
  it("preserves a negative (background) frame with no instances/annotations", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const negFrame = new LabeledFrame({ video, frameIdx: 0, isNegative: true });
    const emptyFrame = new LabeledFrame({ video, frameIdx: 1 });
    const labels = new Labels({
      labeledFrames: [negFrame, emptyFrame],
      videos: [video],
    });

    labels.clean();
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.labeledFrames[0]).toBe(negFrame);
  });

  // videos pruning: clean(videos=true) drops videos with no labeled frames.
  it("clean(videos=true) prunes videos with no labeled frames", () => {
    const v1 = new Video({ filename: "v1.mp4", openBackend: false });
    const v2 = new Video({ filename: "v2.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = Instance.fromArray([[1, 2]], skeleton);
    const lf = new LabeledFrame({ video: v1, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [v1, v2],
      skeletons: [skeleton],
    });

    labels.clean({ videos: true });
    expect(labels.videos.length).toBe(1);
    expect(labels.videos[0]).toBe(v1);
  });

  // skeletons pruning: an unused skeleton is removed when skeletons=true (default).
  it("prunes unused skeletons (default)", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const usedSkel = new Skeleton({ nodes: ["A"] });
    const unusedSkel = new Skeleton({ nodes: ["B"] });
    const inst = Instance.fromArray([[1, 2]], usedSkel);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [usedSkel, unusedSkel],
    });

    labels.clean();
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0]).toBe(usedSkel);
  });
});

describe("Labels.removePredictions", () => {
  // test_remove_predictions_clears_predicted_annotations (test_labels.py:7312-7342)
  it("removePredictions(clean=false) removes predicted pose + predicted annotations", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = Instance.fromArray([[1.0, 2.0]], skeleton);
    const predInst = PredictedInstance.fromArray([[3.0, 4.0]], skeleton, 0.9);

    const userC = new UserCentroid({ x: 1.0, y: 2.0 });
    const predC = new PredictedCentroid({ x: 3.0, y: 4.0, score: 0.8 });
    const userB = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });
    const predB = new PredictedBoundingBox({
      x1: 5,
      y1: 5,
      x2: 15,
      y2: 15,
      score: 0.7,
    });

    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst, predInst],
      centroids: [userC, predC],
      bboxes: [userB, predB],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
    });

    labels.removePredictions(false);

    expect(lf.instances.length).toBe(1);
    expect(lf.instances[0].constructor).toBe(Instance);
    expect(lf.centroids.length).toBe(1);
    expect(lf.centroids[0].constructor).toBe(UserCentroid);
    expect(lf.bboxes.length).toBe(1);
    expect(lf.bboxes[0].constructor).toBe(UserBoundingBox);
  });

  // removePredictions(clean=true) cascade: dropping the only (predicted) content
  // from a frame leaves it empty, and the clean cascade then removes that frame.
  it("removePredictions(clean=true) cascades clean to drop now-empty frames", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const userInst = Instance.fromArray([[1.0, 2.0]], skeleton);
    const predOnly = PredictedInstance.fromArray([[3.0, 4.0]], skeleton, 0.9);

    const lf0 = new LabeledFrame({ video, frameIdx: 0, instances: [userInst] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, instances: [predOnly] });
    const labels = new Labels({
      labeledFrames: [lf0, lf1],
      videos: [video],
      skeletons: [skeleton],
    });

    labels.removePredictions(true);

    // Frame 1 became empty after dropping its predicted instance -> removed.
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.labeledFrames[0]).toBe(lf0);
  });
});
