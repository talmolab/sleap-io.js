//
// Port of the AUTO video-matching subset of Python
// `tests/model/test_merging_integration.py` (sleap-io @ 054cce39f):
//   GROUP B (AUTO video matching) — B7-B11 (lines 386-613).
//
// These pin the AUTO video matcher's safety tree: shape is REJECTION-ONLY (never
// positive evidence); basename / leaf-uniqueness disambiguation beats first-
// content-match; strict full-path match has top priority; ambiguous or
// non-matching basenames add a NEW video (never guess). List ORDER of
// labels.videos matters (video_a is first in B7/B9 — the algorithm must avoid
// the first-content-match temptation).
//
// All assertions reproduce the PYTHON expected values. Identity (`is`) -> toBe;
// value equality (`==`) -> the model's value predicate (Video.matchesPath via
// matchVideo-equivalent) — here expressed through identity since the merged
// frame must reference the SAME existing video object.

import { describe, it, expect } from "../bun-test";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { PredictedInstance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";

function makeVideo(
  filename: string,
  shape?: [number, number, number, number],
): Video {
  const v = new Video({ filename, openBackend: false });
  if (shape !== undefined) {
    v.backendMetadata.shape = shape;
  }
  return v;
}

function predInst(
  points: number[][],
  skeleton: Skeleton,
  score: number,
): PredictedInstance {
  return PredictedInstance.fromArray(points, skeleton, score);
}

describe("Labels.merge — AUTO video matching (GROUP B7-B11)", () => {
  // B7 test_merge_auto_video_matching_with_identical_shapes (lines 386-451)
  // Regression for GitHub issue #255.
  it("B7: identical shapes — basename match beats first-content video_a", async () => {
    const skeleton = new Skeleton({ nodes: ["node1", "node2", "node3"] });
    const shape: [number, number, number, number] = [100, 900, 900, 1];

    const videoA = makeVideo("/data/02_07dpf_fish_1.mp4", shape);
    const videoB = makeVideo("/data/04_07dpf_fish_2.mp4", shape); // same shape

    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA, videoB]; // video_a first (order matters)

    const predictions = new Labels({ skeletons: [skeleton] });
    const predVideo = makeVideo("/predictions/04_07dpf_fish_2.mp4", shape);
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [
          predInst([[100, 200], [150, 250], [200, 300]], skeleton, 0.95),
        ],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(result.framesMerged).toBe(1);
    expect(labels.labeledFrames.length).toBe(1);
    // Must attribute to video_b (basename), NOT video_a (first identical-shape).
    expect(labels.labeledFrames[0].video).toBe(videoB);
  });

  // B8 test_merge_auto_no_basename_match_adds_new_video (lines 453-499)
  it("B8: single candidate, same shape, different basename -> add new (2 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["node1", "node2"] });
    const shape: [number, number, number, number] = [50, 512, 512, 3];

    const videoA = makeVideo("/data/experiment_a.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/output.mp4", shape); // same shape
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[100, 200], [150, 250]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.videos.length).toBe(2); // shape rejection-only -> add as new
    // Merged frame keeps its ORIGINAL pred_video object (no remap).
    expect(labels.labeledFrames[0].video).toBe(predVideo);
  });

  // B9 test_merge_auto_ambiguous_content_adds_new_video (lines 501-542)
  it("B9: multiple same-shape candidates, no basename -> ambiguous -> add new (3 videos)", async () => {
    const skeleton = new Skeleton({ nodes: ["node1", "node2"] });
    const shape: [number, number, number, number] = [50, 512, 512, 3];

    const videoA = makeVideo("/data/experiment_a.mp4", shape);
    const videoB = makeVideo("/data/experiment_b.mp4", shape); // same shape
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA, videoB];

    const predVideo = makeVideo("/predictions/output.mp4", shape);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 0,
        instances: [predInst([[100, 200], [150, 250]], skeleton, 0.9)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.videos.length).toBe(3); // refuse ambiguous content -> add new
    expect(labels.labeledFrames[0].video).toBe(predVideo);
  });

  // B10 test_merge_auto_strict_path_match (lines 544-576)
  it("B10: exact full-path match (strict) -> remap to existing video (no new)", async () => {
    const skeleton = new Skeleton({ nodes: ["node1", "node2"] });
    const shape: [number, number, number, number] = [100, 640, 480, 3];

    const video = makeVideo("/data/video.mp4", shape);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [video];

    const predVideo = makeVideo("/data/video.mp4", shape); // EXACT same path
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 5,
        instances: [predInst([[50, 60], [70, 80]], skeleton, 0.85)],
      }),
    ];

    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.labeledFrames.length).toBe(1);
    // Python asserts `== video` (value equality); the JS frame must reference the
    // existing `video` object after strict-path remap.
    expect(labels.labeledFrames[0].video).toBe(video);
  });

  // B11 test_merge_auto_no_match_adds_new_video (lines 578-613)
  it("B11: no path/content match (diff basename+shape) -> add new; frame != video_a", async () => {
    const skeleton = new Skeleton({ nodes: ["node1", "node2"] });

    const videoA = makeVideo("/data/video_a.mp4", [100, 640, 480, 3]);
    const labels = new Labels({ skeletons: [skeleton] });
    labels.videos = [videoA];

    const predVideo = makeVideo("/predictions/video_b.mp4", [200, 1920, 1080, 3]);
    const predictions = new Labels({ skeletons: [skeleton] });
    predictions.videos = [predVideo];
    predictions.labeledFrames = [
      new LabeledFrame({
        video: predVideo,
        frameIdx: 10,
        instances: [predInst([[100, 200], [300, 400]], skeleton, 0.95)],
      }),
    ];

    const originalVideoCount = labels.videos.length;
    const result = await labels.merge(predictions);

    expect(result.successful).toBeTruthy();
    expect(labels.videos.length).toBe(originalVideoCount + 1);
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.labeledFrames[0].video).not.toBe(videoA);
  });
});
