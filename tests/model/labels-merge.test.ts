//
// Port of Python `tests/model/test_merging_integration.py` (sleap-io @ 054cce39f),
// covering the end-to-end Labels.merge() integration scenarios:
//   GROUP B  — Labels.merge() basics + provenance (B1-B6)  [AUTO video B7-B11 ->
//              labels-merge-video-auto.test.ts]
//   GROUP C  — source_video / original_video awareness in AUTO matcher (C1-C3)
//   GROUP D  — cross-platform path handling (D1-D2)
//   GROUP E  — ImageVideo integration + frame_idx_map (E1-E2)
//   GROUP F  — shape-based REJECTION (F1-F4)
//   GROUP G  — leaf-path uniqueness (G1-G5)
//   GROUP H  — physical-file (samefile) matching (H1-H2) -- Node fs + tmp files
//   GROUP J  — original_video OR-logic / source_video chain (J1-J5)
//
// GROUP I (unresolved_videos) is OMITTED per DECISIONS D12: MergeResult does not
// expose an `unresolvedVideos` field in the JS port (the Python test guards every
// assertion behind `hasattr(result, "unresolved_videos")`, so the only hard
// requirements are "successful" and "+1 video", which are already covered by
// the AUTO no-match cases B11 / G2).
//
// All assertions reproduce the PYTHON expected values. Identity (`is`) -> toBe;
// value/membership (`==` / `in`) -> the model's value predicates / includes.

import { describe, it, expect } from "../bun-test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance, PredictedInstance, Track } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { MergeResult, VideoMatcher, VideoMatchMethod } from "../../src/model/matching.js";

// --- helpers ----------------------------------------------------------------

/** Video without a backend, optionally with a known shape and source_video. */
function makeVideo(
  filename: string | string[],
  shape?: [number, number, number, number],
  sourceVideo?: Video,
): Video {
  const v = new Video({ filename, openBackend: false, sourceVideo });
  if (shape !== undefined) {
    // Python sets `video.backend_metadata["shape"] = (...)`. The JS shape getter
    // reads `backendMetadata.shape` when there is no backend (key-presence based).
    v.backendMetadata.shape = shape;
  }
  return v;
}

function userInst(points: number[][], skeleton: Skeleton, track?: Track): Instance {
  return new Instance({
    points: Instance.fromArray(points, skeleton).points,
    skeleton,
    track: track ?? null,
  });
}

function predInst(
  points: number[][],
  skeleton: Skeleton,
  score = 0.9,
): PredictedInstance {
  return PredictedInstance.fromArray(points, skeleton, score);
}

// ============================================================================
// GROUP B — Labels.merge() basics (TestLabelsMerge, lines 204-384)
// ============================================================================

describe("Labels.merge — basics (GROUP B)", () => {
  // B1 test_simple_merge (lines 207-233)
  it("B1: simple merge of non-overlapping frame (same video object)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = makeVideo("test.mp4");

    const labels1 = new Labels();
    labels1.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton)],
      }),
    );

    const labels2 = new Labels();
    labels2.append(
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [userInst([[30, 30], [40, 40]], skeleton)],
      }),
    );

    const result = await labels1.merge(labels2);

    expect(result).toBeInstanceOf(MergeResult);
    expect(result.successful).toBeTruthy();
    expect(result.framesMerged).toBe(1);
    expect(result.instancesAdded).toBe(1);
    expect(labels1.labeledFrames.length).toBe(2);
  });

  // B2 test_merge_with_overlapping_frames (lines 235-261)
  it("B2: overlapping frame_idx + keep_both unions instances into existing frame", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = makeVideo("test.mp4");

    const labels1 = new Labels();
    labels1.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton)],
      }),
    );

    const labels2 = new Labels();
    labels2.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[11, 11], [21, 21]], skeleton)],
      }),
    );

    const result = await labels1.merge(labels2, { frame: "keep_both" });

    expect(result.successful).toBeTruthy();
    expect(result.framesMerged).toBe(1);
    expect(labels1.labeledFrames.length).toBe(1);
    expect(labels1.labeledFrames[0].instances.length).toBe(2);
  });

  // B3 test_merge_with_different_skeletons (lines 263-290)
  // NOTE: Python `Labels.append(update=True)` auto-collects each instance's
  // skeleton into `self.skeletons`; the JS `append` does NOT (skeletons are
  // passed explicitly per the JS construction idiom). To reproduce the SAME
  // post-append state Python has, skeletons are provided to the constructor.
  it("B3: different skeleton is added (2 skeletons)", async () => {
    const skeleton1 = new Skeleton({ nodes: ["head", "tail"] });
    const skeleton2 = new Skeleton({ nodes: ["head", "thorax", "tail"] });
    const video = makeVideo("test.mp4");

    const labels1 = new Labels({ skeletons: [skeleton1] });
    labels1.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton1)],
      }),
    );

    const labels2 = new Labels({ skeletons: [skeleton2] });
    labels2.append(
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [userInst([[10, 10], [15, 15], [20, 20]], skeleton2)],
      }),
    );

    const result = await labels1.merge(labels2);

    expect(result.successful).toBeTruthy();
    expect(labels1.skeletons.length).toBe(2);
    // `skeleton1 in labels1.skeletons` — distinct node sets are not equal, so both
    // retained; membership here is satisfied by object identity (both are present).
    expect(labels1.skeletons).toContain(skeleton1);
    expect(labels1.skeletons).toContain(skeleton2);
  });

  // B4 test_merge_with_tracks (lines 292-322)
  it("B4: distinct tracks both retained (2 tracks)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = makeVideo("test.mp4");
    const track1 = new Track("mouse1");
    const track2 = new Track("mouse2");

    // See B3 note: JS construction supplies skeletons/tracks explicitly to
    // mirror Python `append(update=True)` auto-collection.
    const labels1 = new Labels({ skeletons: [skeleton], tracks: [track1] });
    labels1.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton, track1)],
      }),
    );

    const labels2 = new Labels({ skeletons: [skeleton], tracks: [track2] });
    labels2.append(
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [userInst([[30, 30], [40, 40]], skeleton, track2)],
      }),
    );

    const result = await labels1.merge(labels2);

    expect(result.successful).toBeTruthy();
    expect(labels1.tracks.length).toBe(2);
    expect(labels1.tracks).toContain(track1);
    expect(labels1.tracks).toContain(track2);
  });

  // B5 test_merge_error_handling (lines 324-348)
  it("B5: validate + error_mode=continue with incompatible skeleton does not abort", async () => {
    const skeleton1 = new Skeleton({ nodes: ["head", "tail"] });
    const skeleton2 = new Skeleton({ nodes: ["wing1", "wing2"] }); // different names, same count
    const video = makeVideo("test.mp4");

    // See B3 note: skeletons supplied explicitly to mirror Python append-collect.
    const labels1 = new Labels({ skeletons: [skeleton1] });
    labels1.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton1)],
      }),
    );

    const labels2 = new Labels({ skeletons: [skeleton2] });
    labels2.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton2)],
      }),
    );

    const result = await labels1.merge(labels2, {
      validate: true,
      errorMode: "continue",
    });

    expect(result.successful).toBeTruthy();
    expect(labels1.skeletons.length).toBe(2);
  });

  // B6 test_merge_provenance (lines 350-384)
  it("B6: provenance merge_history records one nested record (snake_case, null filenames)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = makeVideo("test.mp4");

    const labels1 = new Labels();
    labels1.append(
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton)],
      }),
    );

    const labels2 = new Labels();
    labels2.append(
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [userInst([[30, 30], [40, 40]], skeleton)],
      }),
    );

    await labels1.merge(labels2);

    expect("merge_history" in labels1.provenance).toBe(true);
    const history = labels1.provenance.merge_history as Array<Record<string, unknown>>;
    expect(history.length).toBe(1);
    const rec = history[0];
    expect("timestamp" in rec).toBe(true);
    expect((rec.source_labels as Record<string, unknown>).n_frames).toBe(1);
    expect((rec.result as Record<string, unknown>).frames_merged).toBe(1);
    expect("source_filename" in rec).toBe(true);
    expect("target_filename" in rec).toBe(true);
    expect("sleap_io_version" in rec).toBe(true);
    // In-memory labels -> present-with-null (NOT missing).
    expect(rec.source_filename).toBeNull();
    expect(rec.target_filename).toBeNull();
  });
});

// ============================================================================
// GROUP C — source_video / provenance awareness (TestMergeSourceVideoAwareness,
//           lines 623-841)
// ============================================================================

describe("Labels.merge — source_video awareness (GROUP C)", () => {
  // C1 test_merge_pkg_predictions_to_external_video (lines 638-714)
  it("C1: PKG source_video matches video_b, not first-content video_a", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const videoA = makeVideo("/data/recordings/video_a.mp4", shape);
    const videoB = makeVideo("/data/recordings/video_b.mp4", shape);
    const baseLabels = new Labels({ skeletons: [skeleton] });
    baseLabels.videos = [videoA, videoB]; // video_a first

    const source = makeVideo("/data/recordings/video_b.mp4", shape);
    const predVideo = makeVideo("predictions.pkg.slp", shape, source);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 10,
        instances: [predInst([[50, 60], [70, 80]], skeleton, 0.9)],
      }),
    ];

    const result = await baseLabels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(result.framesMerged).toBe(1);
    expect(baseLabels.videos.length).toBe(2); // no new video
    const merged = baseLabels.labeledFrames[baseLabels.labeledFrames.length - 1];
    expect(merged.video).toBe(videoB);
  });

  // C2 test_merge_pkg_predictions_basename_mismatch (lines 716-779)
  it("C2: PKG basename mismatch + ambiguous content -> source_video resolves to base_video_2", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const baseVideo1 = makeVideo("/data/recordings/experiment_001.mp4", shape);
    const baseVideo2 = makeVideo("/data/recordings/experiment_002.mp4", shape);
    const baseLabels = new Labels({ skeletons: [skeleton] });
    baseLabels.videos = [baseVideo1, baseVideo2];

    // source has no explicit shape in Python (only filename) — leave shape unset.
    const source = makeVideo("/data/recordings/experiment_002.mp4");
    const predVideo = makeVideo("training_run_2024_12_15.pkg.slp", shape, source);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 5,
        instances: [predInst([[25, 35], [45, 55]], skeleton, 0.85)],
      }),
    ];

    const result = await baseLabels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(baseLabels.videos.length).toBe(2);
    const merged = baseLabels.labeledFrames[baseLabels.labeledFrames.length - 1];
    expect(merged.video).toBe(baseVideo2);
  });

  // C3 test_merge_provenance_chain (lines 781-841)
  it("C3: 3-level source_video chain resolves to video_b root", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const videoA = makeVideo("/data/video_a.mp4", shape);
    const videoB = makeVideo("/data/video_b.mp4", shape);
    const baseLabels = new Labels({ skeletons: [skeleton] });
    baseLabels.videos = [videoA, videoB];

    const intermediateSource = makeVideo("/data/video_b.mp4");
    const intermediate = makeVideo("intermediate.pkg.slp", undefined, intermediateSource);
    const final = makeVideo("final.pkg.slp", shape, intermediate);

    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [final];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: final,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await baseLabels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(baseLabels.videos.length).toBe(2);
    const merged = baseLabels.labeledFrames[baseLabels.labeledFrames.length - 1];
    expect(merged.video).toBe(videoB);
  });
});

// ============================================================================
// GROUP D — cross-platform path handling (TestMergeCrossPlatformPaths, lines
//           844-956)
// ============================================================================

describe("Labels.merge — cross-platform paths (GROUP D)", () => {
  // D1 test_merge_windows_to_linux_paths (lines 857-903)
  it("D1: Windows base + Linux pred, same basename -> basename match (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const windowsVideo = makeVideo("C:\\Users\\alice\\data\\video.mp4", shape);
    const baseLabels = new Labels({ skeletons: [skeleton] });
    baseLabels.videos = [windowsVideo];

    const linuxVideo = makeVideo("/home/bob/data/video.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [linuxVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: linuxVideo,
        frameIdx: 0,
        instances: [predInst([[10, 20], [30, 40]], skeleton, 0.9)],
      }),
    ];

    const result = await baseLabels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(baseLabels.videos.length).toBe(1); // basename match
    expect(baseLabels.labeledFrames[0].video).toBe(windowsVideo);
  });

  // D2 test_merge_ambiguous_basename_with_parent_disambiguation (lines 905-956)
  it("D2: ambiguous basename, parent dir 'exp2' disambiguates to video2", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const video1 = makeVideo("/data/exp1/fly.mp4", shape);
    const video2 = makeVideo("/data/exp2/fly.mp4", shape);
    const baseLabels = new Labels({ skeletons: [skeleton] });
    baseLabels.videos = [video1, video2];

    const predVideo = makeVideo("/predictions/exp2/fly.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 20], [30, 40]], skeleton, 0.9)],
      }),
    ];

    const result = await baseLabels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(baseLabels.videos.length).toBe(2); // no new video
    const merged = baseLabels.labeledFrames[0];
    expect(merged.video).toBe(video2);
  });
});

// ============================================================================
// GROUP E — ImageVideo integration (TestMergeImageVideoIntegration, lines
//           959-1079)
// ============================================================================

describe("Labels.merge — ImageVideo (GROUP E)", () => {
  // E1 test_merge_imagevideo_basic (lines 972-1015)
  it("E1: identical image-path lists (copies) -> same video, pred frame added", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const paths = ["/data/img_000.jpg", "/data/img_001.jpg", "/data/img_002.jpg"];
    const shape: [number, number, number, number] = [3, 480, 640, 3];

    const video1 = makeVideo([...paths], shape);
    const baseLabels = new Labels({ skeletons: [skeleton] });
    baseLabels.videos = [video1];
    baseLabels.labeledFrames = [
      new LabeledFrame({
        video: video1,
        frameIdx: 0,
        instances: [userInst([[10, 10], [20, 20]], skeleton)],
      }),
    ];

    const video2 = makeVideo([...paths], shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [video2];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: video2,
        frameIdx: 1,
        instances: [predInst([[30, 30], [40, 40]], skeleton, 0.9)],
      }),
    ];

    const result = await baseLabels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(baseLabels.videos.length).toBe(1); // identical paths -> same video
    expect(baseLabels.labeledFrames.length).toBe(2);
  });

  // E2 test_merge_imagevideo_overlapping_sequences (lines 1017-1079)
  it("E2: IMAGE_DEDUP remaps pred frame_idx 0 (img_002) onto base frame 2", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });

    const basePaths = Array.from({ length: 5 }, (_, i) => `/data/img_${String(i).padStart(3, "0")}.jpg`);
    const baseVideo = makeVideo(basePaths, [5, 480, 640, 3]);
    const baseLabels = new Labels({ skeletons: [skeleton] });
    baseLabels.videos = [baseVideo];

    const predPaths = [
      "/data/img_002.jpg",
      "/data/img_003.jpg",
      "/data/img_005.jpg",
      "/data/img_006.jpg",
      "/data/img_007.jpg",
    ];
    const predVideo = makeVideo(predPaths, [5, 480, 640, 3]);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[50, 50], [60, 60]], skeleton, 0.9)],
      }),
    ];

    const result = await baseLabels.merge(predictions, {
      video: new VideoMatcher(VideoMatchMethod.IMAGE_DEDUP),
    });

    expect(result.successful).toBeTruthy();
    const matched = baseLabels.find({ video: baseVideo, frameIdx: 2 });
    expect(matched.length).toBe(1);
    expect(matched[0].instances.length).toBe(1);
  });
});

// ============================================================================
// GROUP F — shape-based REJECTION (TestMergeShapeRejection, lines 1087-1247)
// ============================================================================

describe("Labels.merge — shape rejection (GROUP F)", () => {
  // F1 test_shape_full_rejection_different_resolution (lines 1097-1133)
  it("F1: different H/W rejects despite same basename (2 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });

    const videoA = makeVideo("/data/video_a.mp4", [100, 480, 640, 1]);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/video_a.mp4", [100, 1080, 1920, 1]);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(2);
  });

  // F2 test_shape_full_rejection_different_frame_count (lines 1135-1171)
  it("F2: different frame count rejects despite same basename (2 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });

    const videoA = makeVideo("/data/video.mp4", [100, 480, 640, 1]);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/video.mp4", [200, 480, 640, 1]);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(2);
  });

  // F3 test_shape_channels_ignored (lines 1173-1211)
  it("F3: channel mismatch ignored -> basename match (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });

    const videoA = makeVideo("/data/video.mp4", [100, 480, 640, 1]);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/video.mp4", [100, 480, 640, 3]);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
    expect(labels.labeledFrames[0].video).toBe(videoA);
  });

  // F4 test_shape_unknown_continues (lines 1213-1247)
  it("F4: unknown (absent) shape cannot reject -> basename match (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });

    // No shape key set on base video.
    const videoA = makeVideo("/data/video.mp4");
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/video.mp4", [100, 480, 640, 1]);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
  });
});

// ============================================================================
// GROUP G — leaf-path uniqueness (TestMergeLeafUniqueness, lines 1255-1467)
// ============================================================================

describe("Labels.merge — leaf-path uniqueness (GROUP G)", () => {
  // G1 test_leaf_both_unique_match (lines 1265-1299)
  it("G1: both unique leaves equal -> match (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const videoA = makeVideo("/data/exp1/recording.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/exp1/recording.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
    expect(labels.labeledFrames[0].video).toBe(videoA);
  });

  // G2 test_leaf_both_unique_no_match (lines 1301-1335)
  it("G2: both unique leaves differ -> add new (2 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const videoA = makeVideo("/data/experiment_a.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/experiment_b.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(2);
  });

  // G3 test_leaf_not_unique_fallthrough (lines 1337-1377)
  it("G3: incoming leaf matches neither (exp3/fly) -> add new (3 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const video1 = makeVideo("/data/exp1/fly.mp4", shape);
    const video2 = makeVideo("/data/exp2/fly.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [video1, video2];

    const predVideo = makeVideo("/predictions/exp3/fly.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(3);
  });

  // G4 test_leaf_parent_disambiguates (lines 1379-1427)
  it("G4: parent dir disambiguates pred exp2/fly to video_2 (2 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const video1 = makeVideo("/data/exp1/fly.mp4", shape);
    const video2 = makeVideo("/data/exp2/fly.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [video1, video2];

    const predVideo = makeVideo("/predictions/exp2/fly.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(2);
    expect(labels.labeledFrames[0].video).toBe(video2);
  });

  // G5 test_leaf_duplicate_paths_excluded (lines 1429-1467)
  it("G5: duplicate base paths -> only assert merge succeeds (count impl-defined)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const video1 = makeVideo("/data/video.mp4", shape);
    const video2 = makeVideo("/data/video.mp4", shape); // same path
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [video1, video2];

    const predVideo = makeVideo("/predictions/video.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    // Python asserts ONLY result.successful here (video count is impl-defined).
    expect(result.successful).toBeTruthy();
  });
});

// ============================================================================
// GROUP H — physical-file (samefile) matching (TestMergeSamefileMatching, lines
//           1475-1580). Gated behind Node fs with real tmp files + symlinks.
// ============================================================================

describe("Labels.merge — samefile matching (GROUP H)", () => {
  // H1 test_samefile_with_symlink (lines 1484-1528)
  it("H1: symlink -> real file resolves to samefile (1 video)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sleapio-merge-h1-"));
    const realFile = path.join(tmp, "real_video.mp4");
    const symlink = path.join(tmp, "symlinked_video.mp4");
    fs.writeFileSync(realFile, "fake video content");
    let symlinkOk = true;
    try {
      fs.symlinkSync(realFile, symlink);
    } catch {
      // Symlink creation can fail without privileges (e.g. Windows). Skip the
      // body in that case rather than asserting against a missing fixture.
      symlinkOk = false;
    }
    if (!symlinkOk) {
      // [FS] symlink unavailable in this environment.
      return;
    }

    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoA = makeVideo(realFile, [100, 480, 640, 1]);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo(symlink, [100, 480, 640, 1]);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
    expect(labels.labeledFrames[0].video).toBe(videoA);
  });

  // H2 test_samefile_with_relative_path (lines 1530-1580)
  it("H2: relative vs absolute path (CWD-relative) resolve to samefile (1 video)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sleapio-merge-h2-"));
    const subdir = path.join(tmp, "data");
    fs.mkdirSync(subdir);
    const videoFile = path.join(subdir, "video.mp4");
    fs.writeFileSync(videoFile, "fake video content");

    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoA = makeVideo(videoFile, [100, 480, 640, 1]);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const originalCwd = process.cwd();
    let result: Awaited<ReturnType<typeof labels.merge>>;
    try {
      process.chdir(tmp);
      const relativePath = path.join("data", "video.mp4");
      const predVideo = makeVideo(relativePath, [100, 480, 640, 1]);
      const predictions = new Labels({ skeletons: [skeleton] });
      predictions.videos = [predVideo];
      predictions.labeledFrames = [
        new LabeledFrame({
          video: predVideo,
          frameIdx: 0,
          instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
        }),
      ];
      result = await labels.merge(predictions);
    } finally {
      process.chdir(originalCwd);
    }

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
  });
});

// ============================================================================
// GROUP J — original_video OR-logic / source_video chain
//           (TestMergeOriginalVideoLogic, lines 1648-1885)
// ============================================================================

describe("Labels.merge — original_video OR-logic (GROUP J)", () => {
  // J1 test_original_video_incoming_only (lines 1662-1704)
  it("J1: incoming-only original_video matches base_video (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const baseVideo = makeVideo("/data/video.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [baseVideo];

    const original = makeVideo("/data/video.mp4");
    const predVideo = makeVideo("predictions.pkg.slp", shape, original);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
    expect(labels.labeledFrames[0].video).toBe(baseVideo);
  });

  // J2 test_original_video_existing_only (lines 1706-1747)
  it("J2: existing-only original_video matches incoming (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const original = makeVideo("/data/video.mp4");
    const baseVideo = makeVideo("base.pkg.slp", shape, original);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [baseVideo];

    const predVideo = makeVideo("/data/video.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
    expect(labels.labeledFrames[0].video).toBe(baseVideo);
  });

  // J3 test_original_video_both_same_target (lines 1749-1793)
  it("J3: both originals same target (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const baseOriginal = makeVideo("/data/video.mp4");
    const baseVideo = makeVideo("base.pkg.slp", shape, baseOriginal);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [baseVideo];

    const predOriginal = makeVideo("/data/video.mp4");
    const predVideo = makeVideo("predictions.pkg.slp", shape, predOriginal);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
  });

  // J4 test_original_video_both_different_targets (lines 1795-1840)
  it("J4: both originals DIFFERENT targets, same shape -> NOT match (2 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const baseOriginal = makeVideo("/data/video_a.mp4");
    const baseVideo = makeVideo("base.pkg.slp", shape, baseOriginal);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [baseVideo];

    const predOriginal = makeVideo("/data/video_b.mp4");
    const predVideo = makeVideo("predictions.pkg.slp", shape, predOriginal);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(2);
  });

  // J5 test_source_video_chain_traversal (lines 1842-1885)
  it("J5: source_video chain traversal matches base_video (1 video)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const shape: [number, number, number, number] = [100, 480, 640, 1];

    const baseVideo = makeVideo("/data/video.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [baseVideo];

    const root = makeVideo("/data/video.mp4");
    const intermediate = makeVideo("intermediate.pkg.slp", undefined, root);
    const final = makeVideo("final.pkg.slp", shape, intermediate);

    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [final];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: final,
        frameIdx: 0,
        instances: [predInst([[10, 10], [20, 20]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(1);
    expect(labels.labeledFrames[0].video).toBe(baseVideo);
  });
});

// GROUP I (TestMergeUnresolvedTracking, lines 1588-1640) OMITTED per DECISIONS
// D12: the JS MergeResult does not implement the optional `unresolvedVideos`
// field. The Python test guards every field-specific assertion behind
// `hasattr(result, "unresolved_videos")`; the hard requirements (successful, +1
// video for an unmatched pred) are already covered by GROUP G/B AUTO no-match
// cases above.
