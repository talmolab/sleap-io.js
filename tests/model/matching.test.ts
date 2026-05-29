/* @vitest-environment node */
/**
 * Ported from sleap-io Python `tests/model/test_matching.py` (pinned @ 054cce39f).
 *
 * GROUPs covered in this file (per scratch/merge-parity/findings/13-tests-matching.md):
 *  - GROUP 10: preconfigured matcher singletons + exact constants
 *  - GROUP 11: invalid-method throws for each matcher
 *  - GROUP 16: VideoMatcher pose-matching integration (find_match w/ labels)
 *  - GROUP 19: VideoMatcher attrs / defaults / string->enum conversion
 *  - GROUP 20: _matchByImages
 *  - GROUP 21 + 24: findMatch leaf-path depth + no-viable / shapes_compatible filter
 *  - GROUP 22: _matchByPoses no-match
 *  - GROUP 25: findMatch with labels (pose/image success, non-auto fallback/no-match)
 *
 * Assertions reflect the PYTHON expected behavior, not the current JS behavior.
 */
import { describe, expect, it } from "vitest";
import {
  AUTO_VIDEO_MATCHER,
  BASENAME_VIDEO_MATCHER,
  DUPLICATE_MATCHER,
  IDENTITY_INSTANCE_MATCHER,
  IDENTITY_TRACK_MATCHER,
  InstanceMatcher,
  InstanceMatchMethod,
  IOU_MATCHER,
  NAME_TRACK_MATCHER,
  OVERLAP_SKELETON_MATCHER,
  PATH_VIDEO_MATCHER,
  SkeletonMatcher,
  SkeletonMatchMethod,
  STRUCTURE_SKELETON_MATCHER,
  SUBSET_SKELETON_MATCHER,
  TrackMatcher,
  TrackMatchMethod,
  VideoMatcher,
  VideoMatchMethod,
} from "../../src/model/matching.js";
import { Instance } from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Labels } from "../../src/model/labels.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a no-backend Video (Python `Video(filename=..., open_backend=False)`). */
function makeVideo(
  filename: string | string[],
  shape?: [number, number, number, number],
): Video {
  const v = new Video({ filename, openBackend: false });
  if (shape !== undefined) {
    v.backendMetadata.shape = shape;
  }
  return v;
}

/**
 * Build a uniform RGBA `ImageData`-like frame of the given fill value.
 * `_toGrayscaleFloat` reads `{width, height, data}` and applies the RGB branch.
 */
function makeFrame(
  fill: number,
  width = 10,
  height = 10,
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill;
    data[i * 4 + 1] = fill;
    data[i * 4 + 2] = fill;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/**
 * Attach a mock backend to a Video that exposes `embedded_frame_inds` and a
 * `getFrame` returning the supplied frame. Mirrors the Python tests that
 * `attrs.evolve(video, backend=mock_backend)` + patch `Video.__getitem__`.
 */
function attachImageBackend(
  video: Video,
  embeddedFrameInds: number[],
  frame: VideoFrame | null,
): void {
  const backend = {
    filename: video.filename,
    embedded_frame_inds: embeddedFrameInds,
    async getFrame(): Promise<VideoFrame | null> {
      return frame;
    },
    close(): void {},
  } as unknown as VideoBackend;
  video.backend = backend;
}

// =============================================================================
// GROUP 10 — PRE-CONFIGURED MATCHERS (test_matching.py:402-442)
// =============================================================================

describe("Preconfigured matchers (GROUP 10)", () => {
  it("exposes all singletons with exact default config values", () => {
    // Skeleton matchers
    expect(STRUCTURE_SKELETON_MATCHER.method).toBe(
      SkeletonMatchMethod.STRUCTURE,
    );
    expect(SUBSET_SKELETON_MATCHER.method).toBe(SkeletonMatchMethod.SUBSET);
    expect(OVERLAP_SKELETON_MATCHER.method).toBe(SkeletonMatchMethod.OVERLAP);
    expect(OVERLAP_SKELETON_MATCHER.minOverlap).toBe(0.7);

    // Instance matchers
    expect(DUPLICATE_MATCHER.method).toBe(InstanceMatchMethod.SPATIAL);
    expect(DUPLICATE_MATCHER.threshold).toBe(5.0);
    expect(IOU_MATCHER.method).toBe(InstanceMatchMethod.IOU);
    expect(IOU_MATCHER.threshold).toBe(0.5);
    expect(IDENTITY_INSTANCE_MATCHER.method).toBe(InstanceMatchMethod.IDENTITY);

    // Track matchers
    expect(NAME_TRACK_MATCHER.method).toBe(TrackMatchMethod.NAME);
    expect(IDENTITY_TRACK_MATCHER.method).toBe(TrackMatchMethod.IDENTITY);

    // Video matchers
    expect(AUTO_VIDEO_MATCHER.method).toBe(VideoMatchMethod.AUTO);
    expect(PATH_VIDEO_MATCHER.method).toBe(VideoMatchMethod.PATH);
    expect(PATH_VIDEO_MATCHER.strict).toBe(true);
    expect(BASENAME_VIDEO_MATCHER.method).toBe(VideoMatchMethod.BASENAME);
  });
});

// =============================================================================
// GROUP 11 — INVALID METHOD THROWS (test_matching.py:585-622, 699-716)
//
// Python injects a bogus method via object.__setattr__ to bypass the converter
// and asserts match() raises ValueError("Unknown <X> match method"). The JS
// substitute: set `.method` to a bogus string directly (the converter only runs
// in the constructor), then expect match() to throw with that message.
// =============================================================================

describe("Matcher invalid method throws (GROUP 11)", () => {
  it("SkeletonMatcher.match throws 'Unknown skeleton match method'", () => {
    const skel1 = new Skeleton(["head", "thorax"]);
    const skel2 = new Skeleton(["head", "thorax"]);
    const matcher = new SkeletonMatcher(SkeletonMatchMethod.EXACT);
    // Bypass the constructor converter.
    (matcher as unknown as { method: string }).method = "INVALID_METHOD";
    expect(() => matcher.match(skel1, skel2)).toThrow(
      /Unknown skeleton match method/,
    );
  });

  it("InstanceMatcher.match throws 'Unknown instance match method'", () => {
    const skel = new Skeleton(["head", "thorax"]);
    const inst1 = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      skel,
    );
    const inst2 = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      skel,
    );
    const matcher = new InstanceMatcher(InstanceMatchMethod.SPATIAL);
    (matcher as unknown as { method: string }).method = "INVALID_METHOD";
    expect(() => matcher.match(inst1, inst2)).toThrow(
      /Unknown instance match method/,
    );
  });

  it("VideoMatcher.match throws 'Unknown video match method'", async () => {
    // Python uses default open_backend here (Video("test1.mp4")), but the path
    // is never reached: dispatch hits the default branch before any backend use.
    const video1 = makeVideo("test1.mp4");
    const video2 = makeVideo("test2.mp4");
    const matcher = new VideoMatcher(VideoMatchMethod.PATH);
    (matcher as unknown as { method: string }).method = "INVALID_METHOD";
    await expect(matcher.match(video1, video2)).rejects.toThrow(
      /Unknown video match method/,
    );
  });
});

// =============================================================================
// GROUP 19 — VideoMatcher new attributes (test_matching.py:2230-2257)
// =============================================================================

describe("VideoMatcher attributes (GROUP 19)", () => {
  it("default values", () => {
    const matcher = new VideoMatcher();
    expect(matcher.contentFrames).toBe(3);
    expect(matcher.comparePredictions).toBe("auto");
    expect(matcher.compareImages).toBe(false);
    expect(matcher.imageSimilarityThreshold).toBe(0.05);
  });

  it("custom values", () => {
    const matcher = new VideoMatcher(VideoMatchMethod.AUTO, {
      contentFrames: 5,
      comparePredictions: true,
      compareImages: true,
      imageSimilarityThreshold: 0.1,
    });
    expect(matcher.contentFrames).toBe(5);
    expect(matcher.comparePredictions).toBe(true);
    expect(matcher.compareImages).toBe(true);
    expect(matcher.imageSimilarityThreshold).toBe(0.1);
  });

  it("string method is converted to enum", () => {
    const matcher = new VideoMatcher("auto");
    expect(matcher.method).toBe(VideoMatchMethod.AUTO);
  });
});

// =============================================================================
// GROUP 16 — VideoMatcher pose-matching integration (test_matching.py:1712-1909)
// Uses find_match with labels_incoming / labels_base.
// =============================================================================

describe("VideoMatcher pose matching integration (GROUP 16)", () => {
  it("match_by_poses_identical: identical poses match", async () => {
    const skeleton = new Skeleton(["a", "b"]);
    const pts = [
      [10.0, 20.0],
      [30.0, 40.0],
    ];

    const video1 = makeVideo("/path1/video.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("/path2/video.mp4", [100, 480, 640, 3]);

    const labels1 = new Labels({
      videos: [video1],
      skeletons: [skeleton],
      labeledFrames: [0, 10, 20].map(
        (idx) =>
          new LabeledFrame({
            video: video1,
            frameIdx: idx,
            instances: [Instance.fromArray(pts, skeleton)],
          }),
      ),
    });
    const labels2 = new Labels({
      videos: [video2],
      skeletons: [skeleton],
      labeledFrames: [0, 10, 20].map(
        (idx) =>
          new LabeledFrame({
            video: video2,
            frameIdx: idx,
            instances: [Instance.fromArray(pts, skeleton)],
          }),
      ),
    });

    const matcher = new VideoMatcher("auto", { contentFrames: 3 });
    const match = await matcher.findMatch(video2, [video1], {
      labelsIncoming: labels2,
      labelsBase: labels1,
    });
    expect(match).toBe(video1);
  });

  it("match_by_poses_different: different poses -> None", async () => {
    const skeleton = new Skeleton(["a", "b"]);
    // Different basenames to avoid path matching.
    const video1 = makeVideo("/path1/video_A.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("/path2/video_B.mp4", [100, 480, 640, 3]);

    const labels1 = new Labels({
      videos: [video1],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video: video1,
          frameIdx: 0,
          instances: [
            Instance.fromArray(
              [
                [1.0, 2.0],
                [3.0, 4.0],
              ],
              skeleton,
            ),
          ],
        }),
      ],
    });
    const labels2 = new Labels({
      videos: [video2],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video: video2,
          frameIdx: 0,
          instances: [
            Instance.fromArray(
              [
                [100.0, 200.0],
                [300.0, 400.0],
              ],
              skeleton,
            ),
          ],
        }),
      ],
    });

    const matcher = new VideoMatcher("auto");
    const match = await matcher.findMatch(video2, [video1], {
      labelsIncoming: labels2,
      labelsBase: labels1,
    });
    expect(match).toBeNull();
  });

  it("match_by_poses_no_common_frames: no common frame indices -> None", async () => {
    const skeleton = new Skeleton(["a", "b"]);
    const pts = [
      [10.0, 20.0],
      [30.0, 40.0],
    ];
    const video1 = makeVideo("/path1/video_A.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("/path2/video_B.mp4", [100, 480, 640, 3]);

    const labels1 = new Labels({
      videos: [video1],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video: video1,
          frameIdx: 0,
          instances: [Instance.fromArray(pts, skeleton)],
        }),
      ],
    });
    const labels2 = new Labels({
      videos: [video2],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video: video2,
          frameIdx: 50, // Different frame.
          instances: [Instance.fromArray(pts, skeleton)],
        }),
      ],
    });

    const matcher = new VideoMatcher("auto");
    const match = await matcher.findMatch(video2, [video1], {
      labelsIncoming: labels2,
      labelsBase: labels1,
    });
    expect(match).toBeNull();
  });

  it("match_by_poses_no_annotations: empty labeled frames -> None", async () => {
    const skeleton = new Skeleton(["a"]);
    const video1 = makeVideo("/path1/video_A.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("/path2/video_B.mp4", [100, 480, 640, 3]);

    const labels1 = new Labels({
      videos: [video1],
      skeletons: [skeleton],
      labeledFrames: [],
    });
    const labels2 = new Labels({
      videos: [video2],
      skeletons: [skeleton],
      labeledFrames: [],
    });

    const matcher = new VideoMatcher("auto");
    const match = await matcher.findMatch(video2, [video1], {
      labelsIncoming: labels2,
      labelsBase: labels1,
    });
    expect(match).toBeNull();
  });
});

// =============================================================================
// GROUP 20 — VideoMatcher._matchByImages (test_matching.py:2260-2378)
// Private method; accessed via (matcher as any)._matchByImages.
// =============================================================================

describe("VideoMatcher._matchByImages (GROUP 20)", () => {
  it("identical embedded frames -> match", async () => {
    const video1 = makeVideo("/v1.mp4");
    const video2 = makeVideo("/v2.mp4");
    const frame = makeFrame(128);
    attachImageBackend(video1, [0], frame);
    attachImageBackend(video2, [0], frame);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO, {
      compareImages: true,
      contentFrames: 1,
    });
    const result = await (
      matcher as unknown as {
        _matchByImages(v: Video, c: Video[]): Promise<Video | null>;
      }
    )._matchByImages(video1, [video2]);
    expect(result).toBe(video2);
  });

  it("very different frames -> None", async () => {
    const video1 = makeVideo("/v1.mp4");
    const video2 = makeVideo("/v2.mp4");
    attachImageBackend(video1, [0], makeFrame(0));
    attachImageBackend(video2, [0], makeFrame(255));

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO, {
      compareImages: true,
      contentFrames: 1,
    });
    const result = await (
      matcher as unknown as {
        _matchByImages(v: Video, c: Video[]): Promise<Video | null>;
      }
    )._matchByImages(video1, [video2]);
    expect(result).toBeNull();
  });

  it("no common embedded indices -> None", async () => {
    const video1 = makeVideo("/v1.mp4");
    const video2 = makeVideo("/v2.mp4");
    attachImageBackend(video1, [0, 1, 2], makeFrame(128));
    attachImageBackend(video2, [10, 11, 12], makeFrame(128));

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO, {
      compareImages: true,
      contentFrames: 1,
    });
    const result = await (
      matcher as unknown as {
        _matchByImages(v: Video, c: Video[]): Promise<Video | null>;
      }
    )._matchByImages(video1, [video2]);
    expect(result).toBeNull();
  });

  it("multiple candidates: returns the FIRST similar candidate", async () => {
    const videoIncoming = makeVideo("/incoming.mp4");
    const video1 = makeVideo("/v1.mp4"); // different content
    const video2 = makeVideo("/v2.mp4"); // similar content
    attachImageBackend(videoIncoming, [0], makeFrame(100));
    attachImageBackend(video1, [0], makeFrame(0));
    attachImageBackend(video2, [0], makeFrame(100));

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO, {
      compareImages: true,
      contentFrames: 1,
    });
    const result = await (
      matcher as unknown as {
        _matchByImages(v: Video, c: Video[]): Promise<Video | null>;
      }
    )._matchByImages(videoIncoming, [video1, video2]);
    expect(result).toBe(video2);
  });
});

// =============================================================================
// GROUP 21 — findMatch leaf path (test_matching.py:2381-2435)
// =============================================================================

describe("VideoMatcher.findMatch leaf path (GROUP 21)", () => {
  it("incoming shorter path: sole candidate matches at depth 1", async () => {
    const incoming = makeVideo("/short/video.mp4");
    const candidate = makeVideo("/very/long/path/to/video.mp4");
    const matcher = new VideoMatcher("auto");
    const result = await matcher.findMatch(incoming, [candidate]);
    expect(result).toBe(candidate);
  });

  it("candidate shorter path: matches at depth 1", async () => {
    const incoming = makeVideo("/very/long/path/to/video.mp4");
    const candidate = makeVideo("/short/video.mp4");
    const matcher = new VideoMatcher("auto");
    const result = await matcher.findMatch(incoming, [candidate]);
    expect(result).toBe(candidate);
  });

  it("leaf uniqueness disambiguation at increasing depth", async () => {
    const incoming = makeVideo("/data/exp1/fly.mp4");
    const candidate1 = makeVideo("/other/exp1/fly.mp4");
    const candidate2 = makeVideo("/other/exp2/fly.mp4");
    const matcher = new VideoMatcher("auto");
    const result = await matcher.findMatch(incoming, [candidate1, candidate2]);
    // depth 1 (fly.mp4): both; depth 2 (exp1/fly.mp4): only candidate1.
    expect(result).toBe(candidate1);
  });

  it("no match at any depth (basenames differ) -> None", async () => {
    const incoming = makeVideo("/data/unique_name.mp4");
    const candidate = makeVideo("/other/different_name.mp4");
    const matcher = new VideoMatcher("auto");
    const result = await matcher.findMatch(incoming, [candidate]);
    expect(result).toBeNull();
  });
});

// =============================================================================
// GROUP 24 — findMatch leaf path edge cases (test_matching.py:2586-2632)
// =============================================================================

describe("VideoMatcher.findMatch leaf path edge cases (GROUP 24)", () => {
  it("incoming path shorter than disambiguating depth -> None", async () => {
    const incoming = makeVideo("/fly.mp4");
    const candidate1 = makeVideo("/a/b/c/exp1/fly.mp4");
    const candidate2 = makeVideo("/a/b/c/exp2/fly.mp4");
    const matcher = new VideoMatcher("auto");
    const result = await matcher.findMatch(incoming, [candidate1, candidate2]);
    // depth 1 ambiguous; depth 2+ incoming too short to disambiguate -> None.
    expect(result).toBeNull();
  });

  it("candidate path shorter than depth: matches at shallow depth", async () => {
    const incoming = makeVideo("/a/b/c/d/e/fly.mp4");
    const candidate = makeVideo("/fly.mp4");
    const matcher = new VideoMatcher("auto");
    const result = await matcher.findMatch(incoming, [candidate]);
    expect(result).toBe(candidate);
  });

  it("no viable candidates (shape rejection filters out the candidate) -> None", async () => {
    // Python (test_find_match_no_viable_candidates) monkeypatches the module-level
    // `shapes_compatible` to return False so the candidate is filtered out of
    // `viable` and find_match returns None. In ESM, vi.spyOn cannot intercept the
    // internal call to shapesCompatible (verified: the spy is ineffective), so we
    // exercise the SAME Stage-0 rejection branch with the REAL helper: give the
    // candidate the SAME basename as incoming (so leaf-path matching WOULD match)
    // but an incompatible shape (different frame count) so shapesCompatible()
    // returns false and the candidate is excluded -> None.
    const incoming = makeVideo("/data/v.mp4", [100, 480, 640, 3]);
    const candidate = makeVideo("/other/v.mp4", [50, 480, 640, 3]);
    const matcher = new VideoMatcher("auto");
    const result = await matcher.findMatch(incoming, [candidate]);
    expect(result).toBeNull();
  });
});

// =============================================================================
// GROUP 22 — VideoMatcher._matchByPoses no match (test_matching.py:2438-2495)
// Private method; accessed via (matcher as any)._matchByPoses.
// =============================================================================

describe("VideoMatcher._matchByPoses no match (GROUP 22)", () => {
  it("no common frames -> None", async () => {
    const skeleton = new Skeleton(["A", "B"]);
    const video1 = makeVideo("/v1.mp4");
    const inst1 = Instance.fromArray(
      [
        [1.0, 2.0],
        [3.0, 4.0],
      ],
      skeleton,
    );
    const lf1 = new LabeledFrame({
      video: video1,
      frameIdx: 0,
      instances: [inst1],
    });
    const labels1 = new Labels({
      videos: [video1],
      skeletons: [skeleton],
      labeledFrames: [lf1],
    });

    const video2 = makeVideo("/v2.mp4");
    const inst2 = Instance.fromArray(
      [
        [1.0, 2.0],
        [3.0, 4.0],
      ],
      skeleton,
    );
    const lf2 = new LabeledFrame({
      video: video2,
      frameIdx: 100,
      instances: [inst2],
    });
    const labels2 = new Labels({
      videos: [video2],
      skeletons: [skeleton],
      labeledFrames: [lf2],
    });

    const matcher = new VideoMatcher("auto", { contentFrames: 1 });
    const result = await (
      matcher as unknown as {
        _matchByPoses(
          v: Video,
          c: Video[],
          li: Labels,
          lb: Labels,
        ): Promise<Video | null>;
      }
    )._matchByPoses(video1, [video2], labels1, labels2);
    expect(result).toBeNull();
  });

  it("poses differ -> None", async () => {
    const skeleton = new Skeleton(["A", "B"]);
    const video1 = makeVideo("/v1.mp4");
    const inst1 = Instance.fromArray(
      [
        [1.0, 2.0],
        [3.0, 4.0],
      ],
      skeleton,
    );
    const lf1 = new LabeledFrame({
      video: video1,
      frameIdx: 0,
      instances: [inst1],
    });
    const labels1 = new Labels({
      videos: [video1],
      skeletons: [skeleton],
      labeledFrames: [lf1],
    });

    const video2 = makeVideo("/v2.mp4");
    const inst2 = Instance.fromArray(
      [
        [100.0, 200.0],
        [300.0, 400.0],
      ],
      skeleton,
    );
    const lf2 = new LabeledFrame({
      video: video2,
      frameIdx: 0,
      instances: [inst2],
    });
    const labels2 = new Labels({
      videos: [video2],
      skeletons: [skeleton],
      labeledFrames: [lf2],
    });

    const matcher = new VideoMatcher("auto", { contentFrames: 1 });
    const result = await (
      matcher as unknown as {
        _matchByPoses(
          v: Video,
          c: Video[],
          li: Labels,
          lb: Labels,
        ): Promise<Video | null>;
      }
    )._matchByPoses(video1, [video2], labels1, labels2);
    expect(result).toBeNull();
  });
});

// =============================================================================
// GROUP 25 — findMatch with labels (test_matching.py:2635-2766)
// =============================================================================

describe("VideoMatcher.findMatch with labels (GROUP 25)", () => {
  it("pose matching disambiguates ambiguous leaf paths -> candidate1", async () => {
    const skeleton = new Skeleton(["A", "B"]);
    const videoIncoming = makeVideo("/data/video.mp4");
    const candidate1 = makeVideo("/exp1/video.mp4");
    const candidate2 = makeVideo("/exp2/video.mp4");

    const poseMatch = [
      [10.0, 20.0],
      [30.0, 40.0],
    ];
    const poseDiff = [
      [100.0, 200.0],
      [300.0, 400.0],
    ];

    const lfIncoming = new LabeledFrame({
      video: videoIncoming,
      frameIdx: 0,
      instances: [Instance.fromArray(poseMatch, skeleton)],
    });
    const lfCandidate1 = new LabeledFrame({
      video: candidate1,
      frameIdx: 0,
      instances: [Instance.fromArray(poseMatch, skeleton)],
    });
    const lfCandidate2 = new LabeledFrame({
      video: candidate2,
      frameIdx: 0,
      instances: [Instance.fromArray(poseDiff, skeleton)],
    });

    const labelsIncoming = new Labels({
      videos: [videoIncoming],
      skeletons: [skeleton],
      labeledFrames: [lfIncoming],
    });
    const labelsBase = new Labels({
      videos: [candidate1, candidate2],
      skeletons: [skeleton],
      labeledFrames: [lfCandidate1, lfCandidate2],
    });

    const matcher = new VideoMatcher("auto", { contentFrames: 1 });
    const result = await matcher.findMatch(
      videoIncoming,
      [candidate1, candidate2],
      { labelsIncoming, labelsBase },
    );
    expect(result).toBe(candidate1);
  });

  it("image matching disambiguates ambiguous leaf paths -> candidate1", async () => {
    const videoIncoming = makeVideo("/data/video.mp4");
    const candidate1 = makeVideo("/exp1/video.mp4");
    const candidate2 = makeVideo("/exp2/video.mp4");

    // Mock backends with embedded frame inds and matching shapes.
    attachImageBackend(videoIncoming, [0], makeFrame(128));
    (videoIncoming.backend as unknown as { shape: number[] }).shape = [
      100, 10, 10, 1,
    ];
    attachImageBackend(candidate1, [0], makeFrame(128)); // matches incoming
    (candidate1.backend as unknown as { shape: number[] }).shape = [
      100, 10, 10, 1,
    ];
    attachImageBackend(candidate2, [0], makeFrame(0)); // differs
    (candidate2.backend as unknown as { shape: number[] }).shape = [
      100, 10, 10, 1,
    ];

    const matcher = new VideoMatcher("auto", {
      compareImages: true,
      contentFrames: 1,
    });
    const result = await matcher.findMatch(videoIncoming, [
      candidate1,
      candidate2,
    ]);
    expect(result).toBe(candidate1);
  });

  it("non-AUTO method uses pairwise match() -> candidate", async () => {
    const videoIncoming = makeVideo("/video.mp4");
    const candidate = makeVideo("/video.mp4");
    const matcher = new VideoMatcher("path");
    const result = await matcher.findMatch(videoIncoming, [candidate]);
    expect(result).toBe(candidate);
  });

  it("non-AUTO strict PATH, no match -> None", async () => {
    const videoIncoming = makeVideo("/v1.mp4");
    const candidate = makeVideo("/v2.mp4");
    const matcher = new VideoMatcher("path", { strict: true });
    const result = await matcher.findMatch(videoIncoming, [candidate]);
    expect(result).toBeNull();
  });
});
