/* @vitest-environment node */
/**
 * Port of test_matching.py pose / image / helper-function coverage tests
 * (issue #90). Ground truth: C:/Users/Talmo/code/sleap-io tests/model/test_matching.py
 * pinned @ 054cce39f. Assertions reflect the PYTHON behavior.
 *
 * Covered groups (finding-13):
 * - GROUP 15 — TestPoseMatching (_poses_identical, _frame_has_matching_pose,
 *   _sample_frame_indices).
 * - GROUP 17 — TestComparePredictionsAuto (_resolve_compare_predictions).
 * - GROUP 18 — TestImageMatching (_to_grayscale_float, _frames_similar_by_image,
 *   _get_embedded_frame_indices, _get_common_embedded_indices).
 * - GROUP 23 — TestHelperFunctionsCoverage (_get_frame_instances,
 *   _video_has_user_instances, backend-without-attrs).
 */
import { describe, it, expect } from "vitest";
import {
  _posesIdentical,
  _frameHasMatchingPose,
  _sampleFrameIndices,
  _resolveComparePredictions,
  _toGrayscaleFloat,
  _framesSimilarByImage,
  _getEmbeddedFrameIndices,
  _getCommonEmbeddedIndices,
  _getFrameInstances,
  _videoHasUserInstances,
} from "../../src/model/matching.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { Skeleton, Node } from "../../src/model/skeleton.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Labels } from "../../src/model/labels.js";
import { Video } from "../../src/model/video.js";
import type { VideoFrame } from "../../src/video/backend.js";

const NaNv = Number.NaN;

/**
 * Build an ImageData-like frame from a row-major list of pixels. Each pixel is a
 * list of channel values; `data` is the interleaved flat array (so channels =
 * data.length / (width*height)), matching how _toGrayscaleFloat infers channels.
 */
function makeFrame(
  width: number,
  height: number,
  pixels: number[][],
): VideoFrame {
  const channels = pixels[0].length;
  const data = new Uint8ClampedArray(width * height * channels);
  for (let p = 0; p < pixels.length; p += 1) {
    for (let c = 0; c < channels; c += 1) {
      data[p * channels + c] = pixels[p][c];
    }
  }
  return { width, height, data } as unknown as VideoFrame;
}

/** Build a solid single-channel frame filled with `value`. */
function solidGray(width: number, height: number, value: number): VideoFrame {
  const data = new Uint8ClampedArray(width * height);
  data.fill(value);
  return { width, height, data } as unknown as VideoFrame;
}

/** Make a backend-less video, then stub getFrame to return `frame` for all idx. */
function videoWithFrame(filename: string, frame: VideoFrame | null): Video {
  const video = new Video({ filename, openBackend: false });
  video.getFrame = async () => frame;
  return video;
}

// =============================================================================
// GROUP 15 — POSE MATCHING HELPERS (TestPoseMatching, test_matching.py:1628-1709)
// =============================================================================

describe("poses (TestPoseMatching)", () => {
  // PY test_poses_identical_exact_match (1631-1636)
  it("exact match", () => {
    const pts = [
      [1.0, 2.0],
      [3.0, 4.0],
      [5.0, 6.0],
    ];
    const copy = pts.map((row) => [...row]);
    expect(_posesIdentical(pts, copy)).toBe(true);
  });

  // PY test_poses_identical_different_values (1638-1644)
  it("different values do not match", () => {
    const pts1 = [
      [1.0, 2.0],
      [3.0, 4.0],
    ];
    const pts2 = [
      [1.0, 2.0],
      [3.0, 5.0],
    ];
    expect(_posesIdentical(pts1, pts2)).toBe(false);
  });

  // PY test_poses_identical_nan_handling (1646-1656)
  it("NaN handling: matching mask matches; different masks do not", () => {
    const pts1 = [
      [1.0, 2.0],
      [NaNv, NaNv],
    ];
    const pts2 = [
      [1.0, 2.0],
      [NaNv, NaNv],
    ];
    expect(_posesIdentical(pts1, pts2)).toBe(true);

    // Different NaN patterns should not match.
    const pts3 = [
      [1.0, NaNv],
      [3.0, 4.0],
    ];
    expect(_posesIdentical(pts1, pts3)).toBe(false);
  });

  // PY test_poses_identical_shape_mismatch (1658-1664)
  it("shape mismatch does not match", () => {
    const pts1 = [[1.0, 2.0]];
    const pts2 = [
      [1.0, 2.0],
      [3.0, 4.0],
    ];
    expect(_posesIdentical(pts1, pts2)).toBe(false);
  });

  // PY test_poses_identical_all_nan (1666-1672)
  it("all-NaN poses do not match (need >=1 valid point)", () => {
    const pts1 = [
      [NaNv, NaNv],
      [NaNv, NaNv],
    ];
    const pts2 = [
      [NaNv, NaNv],
      [NaNv, NaNv],
    ];
    expect(_posesIdentical(pts1, pts2)).toBe(false);
  });

  // PY test_frame_has_matching_pose (1674-1693)
  it("_frameHasMatchingPose: any identical pose pair suffices", () => {
    const skeleton = new Skeleton({ nodes: [new Node("a"), new Node("b")] });
    const inst1 = Instance.fromArray(
      [
        [1.0, 2.0],
        [3.0, 4.0],
      ],
      skeleton,
    );
    const inst2 = Instance.fromArray(
      [
        [1.0, 2.0],
        [3.0, 4.0],
      ],
      skeleton,
    );
    const inst3 = Instance.fromArray(
      [
        [5.0, 6.0],
        [7.0, 8.0],
      ],
      skeleton,
    );

    // Same poses should match.
    expect(_frameHasMatchingPose([inst1], [inst2])).toBe(true);
    // Different poses should not match.
    expect(_frameHasMatchingPose([inst1], [inst3])).toBe(false);
    // ANY match is enough.
    expect(_frameHasMatchingPose([inst1, inst3], [inst2])).toBe(true);
  });

  // PY test_sample_frame_indices (1695-1709)
  it("_sampleFrameIndices: returns sorted list; even truncated sampling", () => {
    // Less than max_samples - return all (sorted ascending).
    expect(_sampleFrameIndices(new Set([0, 5, 10]), 10)).toEqual([0, 5, 10]);

    // More than max_samples - sample evenly: 100 items, 5 samples.
    const result = _sampleFrameIndices(new Set([...Array(100).keys()]), 5);
    expect(result.length).toBe(5);
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(80); // step 20 => last = 80, not 99
  });
});

// =============================================================================
// GROUP 17 — COMPARE PREDICTIONS AUTO (TestComparePredictionsAuto, 1912-2021)
// =============================================================================

describe("comparePredictions (TestComparePredictionsAuto)", () => {
  // PY test_auto_excludes_predictions_when_user_exists (1915-1942)
  it("auto + has user instance => false", () => {
    const skeleton = new Skeleton({ nodes: [new Node("a")] });
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    const labels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [
            Instance.fromArray([[1.0, 2.0]], skeleton),
            PredictedInstance.fromArray([[3.0, 4.0]], skeleton, 0.9),
          ],
        }),
      ],
    });

    expect(_resolveComparePredictions("auto", labels, video)).toBe(false);
  });

  // PY test_auto_includes_predictions_when_only_predictions (1944-1970)
  it("auto + only predictions => true", () => {
    const skeleton = new Skeleton({ nodes: [new Node("a")] });
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    const labels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [PredictedInstance.fromArray([[1.0, 2.0]], skeleton, 0.9)],
        }),
      ],
    });

    expect(_resolveComparePredictions("auto", labels, video)).toBe(true);
  });

  // PY test_explicit_true_always_includes (1972-1993)
  it("explicit true always includes", () => {
    const skeleton = new Skeleton({ nodes: [new Node("a")] });
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    const labels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [Instance.fromArray([[1.0, 2.0]], skeleton)],
        }),
      ],
    });

    expect(_resolveComparePredictions(true, labels, video)).toBe(true);
  });

  // PY test_explicit_false_always_excludes (1995-2021)
  it("explicit false always excludes", () => {
    const skeleton = new Skeleton({ nodes: [new Node("a")] });
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    const labels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [PredictedInstance.fromArray([[1.0, 2.0]], skeleton, 0.9)],
        }),
      ],
    });

    expect(_resolveComparePredictions(false, labels, video)).toBe(false);
  });
});

// =============================================================================
// GROUP 18 — IMAGE MATCHING HELPERS (TestImageMatching, 2024-2227)
// =============================================================================

describe("embedded frame indices (TestImageMatching)", () => {
  // PY test_get_embedded_frame_indices_no_backend (2027-2033)
  it("no backend => null", () => {
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    expect(_getEmbeddedFrameIndices(video)).toBeNull();
  });

  // PY test_get_common_embedded_indices_no_indices (2035-2042)
  it("both without indices => empty set", () => {
    const video1 = new Video({ filename: "/video1.mp4", openBackend: false });
    const video2 = new Video({ filename: "/video2.mp4", openBackend: false });
    expect(_getCommonEmbeddedIndices(video1, video2)).toEqual(new Set());
  });

  // PY test_get_embedded_frame_indices_with_embedded_frame_inds (2165-2183)
  it("prefers backend.embedded_frame_inds attribute", () => {
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    video.backend = { embedded_frame_inds: [0, 5, 10, 15] } as any;
    expect(_getEmbeddedFrameIndices(video)).toEqual([0, 5, 10, 15]);
  });

  // PY test_get_embedded_frame_indices_with_frame_map (2185-2203)
  it("falls back to frame_map keys when embedded_frame_inds is null", () => {
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    video.backend = {
      embedded_frame_inds: null,
      frame_map: { 0: "frame0", 5: "frame5", 10: "frame10" },
    } as any;
    const result = _getEmbeddedFrameIndices(video);
    expect(new Set(result)).toEqual(new Set([0, 5, 10]));
  });

  // PY test_get_common_embedded_indices_with_overlap (2205-2227)
  it("intersection of two index sets", () => {
    const video1 = new Video({ filename: "/video1.mp4", openBackend: false });
    video1.backend = { embedded_frame_inds: [0, 5, 10, 15] } as any;
    const video2 = new Video({ filename: "/video2.mp4", openBackend: false });
    video2.backend = { embedded_frame_inds: [5, 10, 20, 25] } as any;
    expect(_getCommonEmbeddedIndices(video1, video2)).toEqual(new Set([5, 10]));
  });
});

describe("grayscale (TestImageMatching._to_grayscale_float)", () => {
  // PY test_to_grayscale_float_2d (2044-2053)
  // numpy frame = [[0,128,255],[64,192,32]] (2 rows, 3 cols), single-channel.
  // JS interleaved equivalent: width=3, height=2, channels=1.
  it("2D passthrough -> /255 float32; [0,0]=0.0, [0,2]=1.0", () => {
    const frame = makeFrame(3, 2, [[0], [128], [255], [64], [192], [32]]);
    const result = _toGrayscaleFloat(frame);
    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    expect(result.data).toBeInstanceOf(Float32Array);
    // result[0,0] = pixel index 0; result[0,2] = pixel index 2.
    expect(result.data[0]).toBeCloseTo(0.0, 6);
    expect(result.data[2]).toBeCloseTo(1.0, 6);
  });

  // PY test_to_grayscale_float_3d_single_channel (2055-2061)
  // numpy frame shape (2,2,1) -> result shape (2,2).
  it("3D single channel -> squeezes channel dim", () => {
    const frame = makeFrame(2, 2, [[0], [128], [255], [64]]);
    const result = _toGrayscaleFloat(frame);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
  });

  // PY test_to_grayscale_float_3d_rgb (2063-2071)
  // Pure red (255,0,0)/255 -> 0.299 (atol 0.01).
  it("RGB -> 0.299R + 0.587G + 0.114B; pure red => 0.299", () => {
    const frame = makeFrame(1, 1, [[255, 0, 0]]);
    const result = _toGrayscaleFloat(frame);
    expect(result.data[0]).toBeCloseTo(0.299, 2);
  });

  // PY test_to_grayscale_float_invalid_shape (2073-2081)
  // numpy 4D -> ValueError "Unexpected frame shape". In JS the structured frame
  // type cannot represent 4D; the closest divergent shape (channels not in
  // {1,2,>=3}) is the throw branch. An unstructured frame also throws.
  it("invalid shape throws 'Unexpected frame shape'", () => {
    const bogus = new Uint8Array([1]) as unknown as VideoFrame;
    expect(() => _toGrayscaleFloat(bogus)).toThrow("Unexpected frame shape");
  });

  // PY test_to_grayscale_float_2_channels (2083-2093)
  // numpy frame shape (1,2,2) = 1 row, 2 cols, 2 channels: [[0,128],[255,64]]
  // -> first channel only: result[0,0]=0/255=0, result[0,1]=255/255=1.0.
  it("2 channels (not 1/3) -> use FIRST channel only", () => {
    const frame = makeFrame(2, 1, [
      [0, 128],
      [255, 64],
    ]);
    const result = _toGrayscaleFloat(frame);
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(result.data[0]).toBeCloseTo(0.0, 6);
    expect(result.data[1]).toBeCloseTo(1.0, 6);
  });
});

describe("framesSimilarByImage (TestImageMatching._frames_similar_by_image)", () => {
  // PY test_frames_similar_by_image_identical (2095-2109)
  it("identical frames => similar (threshold 0.05)", async () => {
    const frame = solidGray(10, 10, 128);
    const video1 = videoWithFrame("/v1.mp4", frame);
    const video2 = videoWithFrame("/v2.mp4", frame);
    expect(await _framesSimilarByImage(video1, video2, 0, 0.05)).toBe(true);
  });

  // PY test_frames_similar_by_image_different (2111-2131)
  it("full-black vs full-white => not similar", async () => {
    const video1 = videoWithFrame("/v1.mp4", solidGray(10, 10, 0));
    const video2 = videoWithFrame("/v2.mp4", solidGray(10, 10, 255));
    expect(await _framesSimilarByImage(video1, video2, 0, 0.05)).toBe(false);
  });

  // PY test_frames_similar_by_image_different_shapes (2133-2152)
  it("different shapes => false", async () => {
    const video1 = videoWithFrame("/v1.mp4", solidGray(10, 10, 128));
    const video2 = videoWithFrame("/v2.mp4", solidGray(20, 20, 128));
    expect(await _framesSimilarByImage(video1, video2, 0, 0.05)).toBe(false);
  });

  // PY test_frames_similar_by_image_exception (2154-2163)
  // Videos with no backend raise on frame access -> caught -> false. In JS a
  // backend-less getFrame returns null, which the helper treats as false.
  it("frame access failure => false", async () => {
    const video1 = new Video({ filename: "/nonexistent.mp4", openBackend: false });
    const video2 = new Video({ filename: "/nonexistent.mp4", openBackend: false });
    expect(await _framesSimilarByImage(video1, video2, 0, 0.05)).toBe(false);
  });
});

// =============================================================================
// GROUP 23 — HELPER FUNCTIONS COVERAGE (TestHelperFunctionsCoverage, 2498-2583)
// =============================================================================

describe("helpers coverage (TestHelperFunctionsCoverage)", () => {
  // PY test_get_frame_instances_multiple_videos (2501-2534)
  it("_getFrameInstances skips frames from other videos", () => {
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const video1 = new Video({ filename: "/v1.mp4", openBackend: false });
    const video2 = new Video({ filename: "/v2.mp4", openBackend: false });

    const inst1 = Instance.fromArray(
      [
        [1.0, 2.0],
        [3.0, 4.0],
      ],
      skeleton,
    );
    const inst2 = Instance.fromArray(
      [
        [5.0, 6.0],
        [7.0, 8.0],
      ],
      skeleton,
    );

    const lf1 = new LabeledFrame({ video: video1, frameIdx: 0, instances: [inst1] });
    const lf2 = new LabeledFrame({ video: video2, frameIdx: 0, instances: [inst2] });

    const labels = new Labels({
      videos: [video1, video2],
      skeletons: [skeleton],
      labeledFrames: [lf1, lf2],
    });

    const result = _getFrameInstances(labels, video1, true);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });

  // PY test_video_has_user_instances_multiple_videos (2536-2564)
  it("_videoHasUserInstances skips other videos' frames", () => {
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const video1 = new Video({ filename: "/v1.mp4", openBackend: false });
    const video2 = new Video({ filename: "/v2.mp4", openBackend: false });

    const inst = Instance.fromArray(
      [
        [1.0, 2.0],
        [3.0, 4.0],
      ],
      skeleton,
    );
    const lf = new LabeledFrame({ video: video2, frameIdx: 0, instances: [inst] });

    const labels = new Labels({
      videos: [video1, video2],
      skeletons: [skeleton],
      labeledFrames: [lf],
    });

    expect(_videoHasUserInstances(labels, video1)).toBe(false);
    expect(_videoHasUserInstances(labels, video2)).toBe(true);
  });

  // PY test_get_embedded_frame_indices_backend_no_attrs (2566-2583)
  // Backend present but lacking both embedded_frame_inds and frame_map => null.
  it("_getEmbeddedFrameIndices backend without attrs => null", () => {
    const video = new Video({ filename: "/video.mp4", openBackend: false });
    video.backend = {} as any; // no embedded_frame_inds, no frame_map
    expect(_getEmbeddedFrameIndices(video)).toBeNull();
  });
});
