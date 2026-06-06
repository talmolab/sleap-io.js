/**
 * Ported from Python tests/model/test_matching.py (pinned @ 054cce39f).
 *
 * Covers finding-13 GROUPs:
 *   4  — VideoMatcher pairwise PATH / BASENAME / AUTO (test_path_match,
 *        test_basename_match, test_auto_match), lines 203-233.
 *   9  — VideoMatcherBasename impl/consistency, lines 365-399.
 *   12 — VideoMatcherCoverageGaps: _isSameFileDirect ImageVideo vs single file,
 *        _getEffectiveShape, AUTO provenance-conflict rejection, AUTO strict-path,
 *        SHAPE method, find_match full-path / imagevideo-leaf / depth / shallow,
 *        normalized paths, HDF5 datasets, HDF5 provenance chain, lines 1071-1514.
 *   13 — LeafPathMatchingFix: _getRootVideo for embedded, find_match root path,
 *        lines 1520-1560.
 *   14 — ProvenanceConflictFallthrough: original_videos_conflict + _file_exists,
 *        lines 1566-1625.
 * Plus direct Video.matchesContent / matchesShape / hasOverlappingImages.
 *
 * All assertions reproduce the PYTHON expectation, not whatever the current JS
 * happens to do. Python `is` -> `toBe` (reference identity); value -> predicates.
 */
import { afterEach, describe, expect, it } from "../bun-test";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { Video } from "../../src/model/video.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import {
  VideoMatcher,
  VideoMatchMethod,
  _isSameFileDirect,
  isSameFile,
  _getEffectiveShape,
  _getRootVideo,
  _fileExists,
  originalVideosConflict,
  shapesCompatible,
  sanitizeFilename,
  setFsResolver,
} from "../../src/model/matching.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type Shape = [number, number, number, number];

/** Video(filename=..., open_backend=False) with an optional injected shape. */
function makeVideo(
  filename: string | string[],
  shape?: Shape,
  sourceVideo?: Video,
): Video {
  const video = new Video({
    filename,
    openBackend: false,
    sourceVideo: sourceVideo ?? null,
  });
  if (shape !== undefined) {
    // Python sets video.backend_metadata["shape"] = shape AFTER construction.
    video.backendMetadata.shape = shape;
  }
  return video;
}

/**
 * Stand-in for Python `HDF5Video(filename=..., dataset=...)`. The JS
 * `_isSameFileDirect` HDF5 disambiguation keys off `video.backend != null` AND a
 * non-null `backend.dataset`, so the minimal stub carries just those.
 */
function makeHdf5Backend(filename: string, dataset: string): VideoBackend {
  return {
    filename,
    dataset,
    async getFrame(): Promise<VideoFrame | null> {
      return null;
    },
    close(): void {
      /* no-op */
    },
  };
}

/** Video backed by an HDF5-like backend (carries a dataset). */
function makeHdf5Video(
  filename: string,
  dataset: string,
  sourceVideo?: Video,
): Video {
  return new Video({
    filename,
    backend: makeHdf5Backend(filename, dataset),
    sourceVideo: sourceVideo ?? null,
    openBackend: false,
  });
}

// Clear any explicit FS resolver override after each test so the default Node
// `fs` resolver is restored (these tests rely on real-FS existence semantics).
afterEach(() => {
  setFsResolver(null);
});

// =============================================================================
// GROUP 4 — VideoMatcher pairwise (test_matching.py:203-233)
// =============================================================================

describe("VideoMatcher pairwise (GROUP 4)", () => {
  // PY test_path_match (203-211)
  it("path strict: same path -> true, different path -> false", async () => {
    const video1 = makeVideo("/path/to/video.mp4");
    const video2 = makeVideo("/path/to/video.mp4");
    const video3 = makeVideo("/other/path/video.mp4");

    const matcher = new VideoMatcher(VideoMatchMethod.PATH, { strict: true });
    expect(await matcher.match(video1, video2)).toBe(true); // Same path
    expect(await matcher.match(video1, video3)).toBe(false); // Different path
  });

  // PY test_basename_match (213-221)
  it("basename: same basename -> true, different basename -> false", async () => {
    const video1 = makeVideo("/path/to/video.mp4");
    const video2 = makeVideo("/other/path/video.mp4");
    const video3 = makeVideo("/path/to/other.mp4");

    const matcher = new VideoMatcher(VideoMatchMethod.BASENAME);
    expect(await matcher.match(video1, video2)).toBe(true); // Same basename
    expect(await matcher.match(video1, video3)).toBe(false); // Different basename
  });

  // PY test_auto_match (223-233)
  it("auto: same object / same path / same basename all match", async () => {
    const video1 = makeVideo("/path/to/video.mp4");
    const video2 = video1; // Same object
    const video3 = makeVideo("/path/to/video.mp4"); // Same path, diff object
    const video4 = makeVideo("/other/path/video.mp4"); // Same basename, diff path

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.match(video1, video2)).toBe(true); // Same object
    expect(await matcher.match(video1, video3)).toBe(true); // Same path
    expect(await matcher.match(video1, video4)).toBe(true); // Same basename
  });
});

// =============================================================================
// GROUP 9 — VideoMatcher BASENAME impl / consistency (test_matching.py:365-399)
// =============================================================================

describe("VideoMatcher BASENAME (GROUP 9)", () => {
  // PY test_basename_implementation (365-382)
  it("basename implementation + identity always matches", async () => {
    const video1 = makeVideo("/some/path/test_video.mp4");
    const video2 = makeVideo("/different/path/test_video.mp4");
    const video3 = makeVideo("/path/other_video.mp4");

    const matcher = new VideoMatcher(VideoMatchMethod.BASENAME);
    expect(await matcher.match(video1, video2)).toBe(true); // Same basenames
    expect(await matcher.match(video1, video3)).toBe(false); // Different basenames
    expect(await matcher.match(video1, video1)).toBe(true); // Identity always matches
  });

  // PY test_basename_vs_basename_consistency (384-399)
  it("basename matchers are deterministic / stateless", async () => {
    const video1 = makeVideo("/path1/video.mp4");
    const video2 = makeVideo("/path2/video.mp4");
    const video3 = makeVideo("/path/other.mp4");

    const matcher1 = new VideoMatcher(VideoMatchMethod.BASENAME);
    const matcher2 = new VideoMatcher(VideoMatchMethod.BASENAME);

    expect(await matcher1.match(video1, video2)).toBe(
      await matcher2.match(video1, video2),
    );
    expect(await matcher1.match(video1, video3)).toBe(
      await matcher2.match(video1, video3),
    );
    expect(await matcher1.match(video1, video1)).toBe(true);
    expect(await matcher2.match(video1, video1)).toBe(true);
  });
});

// =============================================================================
// GROUP 12 — VideoMatcher coverage gaps (test_matching.py:1071-1514)
// =============================================================================

describe("VideoMatcher coverage gaps (GROUP 12)", () => {
  // PY test_is_same_file_direct_imagevideo_vs_single_file (1071-1088)
  it("_isSameFileDirect: ImageVideo (list) vs single file -> false (both dirs)", async () => {
    const imagevideo = makeVideo(["/data/img_001.jpg", "/data/img_002.jpg"]);
    const singleVideo = makeVideo("/data/video.mp4");

    expect(await _isSameFileDirect(imagevideo, singleVideo)).toBe(false);
    expect(await _isSameFileDirect(singleVideo, imagevideo)).toBe(false);
  });

  // PY test_get_effective_shape_with_original_video (1090-1113)
  it("_getEffectiveShape follows sourceVideo chain", () => {
    const original = makeVideo("/data/original.mp4", [100, 480, 640, 3]);
    const embedded = makeVideo("embedded.pkg.slp", undefined, original);

    // Single-level chain: nearest source IS the root.
    expect(embedded.originalVideo).toBe(original);

    const shape = _getEffectiveShape(embedded);
    expect(shape).toEqual([100, 480, 640, 3]);
  });

  // PY test_video_matcher_auto_provenance_conflict_rejection (1115-1140)
  it("AUTO pairwise rejects on provenance conflict despite same shape", async () => {
    const original1 = makeVideo("/data/video1.mp4", [100, 480, 640, 3]);
    const original2 = makeVideo("/data/video2.mp4", [100, 480, 640, 3]); // same shape

    const embedded1 = makeVideo(
      "embedded.pkg.slp",
      [100, 480, 640, 3],
      original1,
    );
    const embedded2 = makeVideo(
      "embedded2.pkg.slp",
      [100, 480, 640, 3],
      original2,
    );

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    // Different provenance chains -> NOT a match even with identical shape.
    expect(await matcher.match(embedded1, embedded2)).toBe(false);
  });

  // PY test_video_matcher_auto_strict_path_match (1142-1156)
  it("AUTO pairwise matches via strict path match", async () => {
    const video1 = makeVideo("/data/videos/test.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("/data/videos/test.mp4", [100, 480, 640, 3]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.match(video1, video2)).toBe(true);
  });

  // PY test_video_matcher_shape_method (1158-1174)
  it("SHAPE method: same shape -> true, different shape -> false", async () => {
    const video1 = makeVideo("video1.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("video2.mp4", [100, 480, 640, 3]);
    const video3 = makeVideo("video3.mp4", [200, 720, 1280, 3]);

    const matcher = new VideoMatcher(VideoMatchMethod.SHAPE);
    expect(await matcher.match(video1, video2)).toBe(true); // Same shape
    expect(await matcher.match(video1, video3)).toBe(false); // Different shape
  });

  // PY test_video_matcher_find_match_full_path_match (1176-1198)
  it("find_match prefers exact full-path candidate (by identity)", async () => {
    const candidate = makeVideo(
      "/data/recordings/video.mp4",
      [100, 480, 640, 3],
    );
    const otherCandidate = makeVideo(
      "/data/other/video.mp4",
      [100, 480, 640, 3],
    );
    const incoming = makeVideo(
      "/data/recordings/video.mp4",
      [100, 480, 640, 3],
    );

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(incoming, [
      otherCandidate,
      candidate,
    ]);

    expect(result).toBe(candidate); // identity, full-path wins over basename
  });

  // PY test_video_matcher_find_match_imagevideo_leaf_path (1200-1225)
  it("find_match ImageVideo uses first image path for leaf comparison", async () => {
    const candidate1 = makeVideo(
      ["/data/exp1/img_001.jpg", "/data/exp1/img_002.jpg"],
      [2, 480, 640, 3],
    );
    const candidate2 = makeVideo(
      ["/data/exp2/img_001.jpg", "/data/exp2/img_002.jpg"],
      [2, 480, 640, 3],
    );
    const incoming = makeVideo(
      ["/other/exp1/img_001.jpg", "/other/exp1/img_002.jpg"],
      [2, 480, 640, 3],
    );

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(incoming, [candidate1, candidate2]);

    // exp1 disambiguates via leaf path uniqueness (fn[0] for ImageVideo).
    expect(result).toBe(candidate1);
  });

  // PY test_video_matcher_find_match_depth_comparison_edge_cases (1227-1251)
  it("find_match depth: shallow candidate skipped, deep suffix wins", async () => {
    const shallowCandidate = makeVideo("shallow.mp4", [100, 480, 640, 3]);
    const deepCandidate = makeVideo(
      "/very/deep/path/to/video.mp4",
      [100, 480, 640, 3],
    );
    const incoming = makeVideo("/path/to/video.mp4", [100, 480, 640, 3]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(incoming, [
      shallowCandidate,
      deepCandidate,
    ]);

    // Matches deep_candidate via "to/video.mp4" suffix.
    expect(result).toBe(deepCandidate);
  });

  // PY test_video_matcher_find_match_incoming_shallow_path (1253-1272)
  it("find_match incoming shallow path matches via basename at depth 1", async () => {
    const candidate = makeVideo(
      "/very/deep/nested/path/to/video.mp4",
      [100, 480, 640, 3],
    );
    const incoming = makeVideo("video.mp4", [100, 480, 640, 3]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(incoming, [candidate]);

    expect(result).toBe(candidate);
  });

  // PY test_video_matcher_find_match_line_639_incoming_shorter (1302-1328)
  it("find_match incoming too shallow to disambiguate -> null", async () => {
    const candidate1 = makeVideo("/data/exp1/video.mp4", [100, 480, 640, 3]);
    const candidate2 = makeVideo("/data/exp2/video.mp4", [100, 480, 640, 3]);
    const incoming = makeVideo("video.mp4", [100, 480, 640, 3]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(incoming, [candidate1, candidate2]);

    // depth 1 ambiguous; depth 2 incoming has only 1 part -> continue -> None.
    expect(result).toBeNull();
  });

  // PY test_video_matcher_find_match_line_646_candidate_shorter (1330-1363)
  it("find_match candidate too short for depth is skipped; unique deep wins", async () => {
    const shallowCandidate = makeVideo("video.mp4", [100, 480, 640, 3]);
    const deepCandidate = makeVideo("/data/exp1/video.mp4", [100, 480, 640, 3]);
    const deepCandidate2 = makeVideo(
      "/data/exp2/video.mp4",
      [100, 480, 640, 3],
    );
    const incoming = makeVideo("/other/exp1/video.mp4", [100, 480, 640, 3]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(incoming, [
      shallowCandidate,
      deepCandidate,
      deepCandidate2,
    ]);

    // depth 1 ambiguous; depth 2 shallow skipped; only exp1/video.mp4 matches.
    expect(result).toBe(deepCandidate);
  });

  // PY test_video_matcher_find_match_with_normalized_paths (1365-1394)
  it("find_match with normalized (backslash) paths", async () => {
    const path1 = "/data\\subdir/video.mp4"; // mixed slashes (backslash literal)
    const path2 = "/data/subdir/video.mp4"; // forward slashes only

    // sanitize_filename normalizes backslashes to forward slashes.
    expect(sanitizeFilename(path1)).toBe(sanitizeFilename(path2));

    const candidate = makeVideo(path2, [100, 480, 640, 3]);
    const incoming = makeVideo(path1, [100, 480, 640, 3]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(incoming, [candidate]);

    // Loose assertion (Python): candidate OR null.
    expect(result === candidate || result === null).toBe(true);
  });

  // PY test_is_same_file_hdf5_different_datasets (1396-1439)
  it("_isSameFileDirect: HDF5 same file + different dataset -> not same", async () => {
    const video1 = makeHdf5Video("source.pkg.slp", "video0/video");
    const video2 = makeHdf5Video("source.pkg.slp", "video1/video");
    const video3 = makeHdf5Video("source.pkg.slp", "video0/video");

    // Same filename, different datasets -> different videos.
    expect(await _isSameFileDirect(video1, video2)).toBe(false);
    // Same filename, same dataset -> same video.
    expect(await _isSameFileDirect(video1, video3)).toBe(true);
  });

  // PY test_is_same_file_hdf5_with_provenance_chain (1441-1514)
  it("isSameFile traverses provenance chain to root for HDF5 datasets", async () => {
    const source1 = makeHdf5Video("original.pkg.slp", "video5/video");
    const source2 = makeHdf5Video("original.pkg.slp", "video10/video");

    const embedded1 = makeHdf5Video("train.pkg.slp", "video0/video", source1);
    const embedded2 = makeHdf5Video("val.pkg.slp", "video0/video", source2);
    const embedded3 = makeHdf5Video("test.pkg.slp", "video0/video", source1);

    // Different source datasets -> different videos.
    expect(await isSameFile(embedded1, embedded2)).toBe(false);
    // Same source dataset -> same videos.
    expect(await isSameFile(embedded1, embedded3)).toBe(true);
  });
});

// =============================================================================
// GROUP 13 — Leaf-path matching fix (test_matching.py:1520-1560)
// =============================================================================

describe("Leaf-path matching fix (GROUP 13)", () => {
  // PY test_get_path_parts_uses_root_for_embedded (1520-1533)
  it("_getRootVideo follows source_video chain to root", () => {
    const rootVideo = makeVideo("/original/path/video.mp4");
    const embeddedVideo = makeVideo(
      "/embedded/file.pkg.slp",
      undefined,
      rootVideo,
    );

    expect(_getRootVideo(embeddedVideo).filename).toBe(
      "/original/path/video.mp4",
    );
  });

  // PY test_find_match_uses_root_path_for_embedded (1535-1560)
  it("find_match uses root path for embedded videos (cross-drive leaf)", async () => {
    const root1 = makeVideo("/data/exp/CHR/video.mp4", [100, 480, 640, 3]);
    const embedded1 = makeVideo(
      "/linux/path/train.pkg.slp",
      [100, 480, 640, 3],
      root1,
    );

    const root2 = makeVideo("X:/data/exp/CHR/video.mp4", [100, 480, 640, 3]);
    const embedded2 = makeVideo(
      "Y:/windows/path/val.pkg.slp",
      [100, 480, 640, 3],
      root2,
    );

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    const result = await matcher.findMatch(embedded2, [embedded1]);

    // Root paths share leaf "CHR/video.mp4" despite differing drive prefixes.
    expect(result).toBe(embedded1);
  });
});

// =============================================================================
// GROUP 14 — Provenance conflict fall-through (test_matching.py:1566-1625)
// FS-dependent: uses real tmp files for the existence checks.
// =============================================================================

describe("Provenance conflict fall-through (GROUP 14)", () => {
  // PY test_no_conflict_when_files_dont_exist (1566-1582)
  it("no conflict when neither provenance file exists", async () => {
    const video1Root = makeVideo("/nonexistent/path1/video.mp4");
    const video1 = makeVideo("/pkg1.slp", undefined, video1Root);

    const video2Root = makeVideo("/nonexistent/path2/video.mp4");
    const video2 = makeVideo("/pkg2.slp", undefined, video2Root);

    // Both have provenance but neither file exists -> allow fall-through.
    expect(await originalVideosConflict(video1, video2)).toBe(false);
  });

  // PY test_file_exists_helper (1584-1602) — uses tmp_path
  it("_fileExists: str or list (all-must-exist) against real FS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sleapio-merge-"));
    try {
      // Nonexistent file.
      expect(await _fileExists("/definitely/not/a/real/path.mp4")).toBe(false);

      // Existing file.
      const testFile = join(dir, "test.txt");
      await fsp.writeFile(testFile, "test");
      expect(await _fileExists(testFile)).toBe(true);

      // List of files (ALL exist).
      const testFile2 = join(dir, "test2.txt");
      await fsp.writeFile(testFile2, "test2");
      expect(await _fileExists([testFile, testFile2])).toBe(true);

      // List with one nonexistent file -> false.
      expect(await _fileExists([testFile, "/nonexistent.txt"])).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // PY test_conflict_when_one_file_exists (1604-1625) — uses tmp_path
  it("conflict when one root file exists and paths differ", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sleapio-merge-"));
    try {
      const realFile = join(dir, "real_video.mp4");
      await fsp.writeFile(realFile, "fake video content");

      const video1Root = makeVideo(realFile);
      const video1 = makeVideo(realFile, undefined, video1Root);

      const video2Root = makeVideo("/nonexistent/different/video.mp4");
      const video2 = makeVideo("/other.slp", undefined, video2Root);

      // One root file exists and paths differ -> conflict.
      expect(await originalVideosConflict(video1, video2)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Direct Video.matchesContent / matchesShape / hasOverlappingImages
// (covers video.py matches_content / matches_shape / has_overlapping_images,
//  exercised in test_matching.py CONTENT / SHAPE / image-dedup paths)
// =============================================================================

describe("Video.matchesContent (CONTENT semantics)", () => {
  // PY test_video_matcher_content_method (448-461): CONTENT compares shape.
  it("same full shape (both no backend) -> true", () => {
    const video1 = makeVideo("a.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("b.mp4", [100, 480, 640, 3]);
    expect(video1.matchesContent(video2)).toBe(true);
  });

  it("different frame count -> false", () => {
    const video1 = makeVideo("a.mp4", [100, 480, 640, 3]);
    const video3 = makeVideo("c.mp4", [50, 480, 640, 3]);
    expect(video1.matchesContent(video3)).toBe(false);
  });

  it("different channels (full-tuple compare) -> false", () => {
    const video1 = makeVideo("a.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("b.mp4", [100, 480, 640, 1]);
    expect(video1.matchesContent(video2)).toBe(false);
  });
});

describe("Video.matchesShape (SHAPE semantics)", () => {
  // matches_shape compares height, width, channels (EXCLUDES frames).
  it("same H/W/channels (diff frame count) -> true", () => {
    const video1 = makeVideo("a.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("b.mp4", [200, 480, 640, 3]);
    expect(video1.matchesShape(video2)).toBe(true);
  });

  it("different height -> false", () => {
    const video1 = makeVideo("a.mp4", [100, 480, 640, 3]);
    const video3 = makeVideo("c.mp4", [100, 720, 640, 3]);
    expect(video1.matchesShape(video3)).toBe(false);
  });

  it("different channels -> false", () => {
    const video1 = makeVideo("a.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("b.mp4", [100, 480, 640, 1]);
    expect(video1.matchesShape(video2)).toBe(false);
  });

  it("missing shape -> false", () => {
    const video1 = makeVideo("a.mp4", [100, 480, 640, 3]);
    const video2 = makeVideo("b.mp4"); // no shape injected
    expect(video1.matchesShape(video2)).toBe(false);
  });
});

describe("Video.hasOverlappingImages (image_dedup semantics)", () => {
  it("two image sequences sharing a basename -> true", () => {
    const video1 = makeVideo(["/a/img_000.jpg", "/a/img_001.jpg"]);
    const video2 = makeVideo(["/b/img_001.jpg", "/b/img_005.jpg"]);
    expect(video1.hasOverlappingImages(video2)).toBe(true);
  });

  it("image sequences with no shared basename -> false", () => {
    const video1 = makeVideo(["/a/img_000.jpg", "/a/img_001.jpg"]);
    const video2 = makeVideo(["/b/img_002.jpg", "/b/img_003.jpg"]);
    expect(video1.hasOverlappingImages(video2)).toBe(false);
  });

  it("single-file video (not a list) -> false", () => {
    const video1 = makeVideo(["/a/img_000.jpg"]);
    const single = makeVideo("/a/video.mp4");
    expect(video1.hasOverlappingImages(single)).toBe(false);
    expect(single.hasOverlappingImages(video1)).toBe(false);
  });
});

// =============================================================================
// Embedded subset shape matching (#476)
// =============================================================================
//
// Port of Python `TestEmbeddedSubsetShapeMatching` (tests/model/test_matching.py,
// added by PR #476 "resolve effective shape through source chain so embedded
// subsets match", upstream issue #473).
//
// THE WORKFLOW: embed a SUBSET of user-labeled frames (e.g. 27 of 80) into a
// `.pkg.slp`, run prediction against the RESTORED original source (80 frames),
// then match GT vs predictions. Before the fix, `_getEffectiveShape` jumped to
// the chain ROOT (`originalVideo`); when the root shape was unknown it fell back
// to the video's OWN subset frame count, so the 27-frame subset and 80-frame
// restored original reported different frame counts and were REJECTED on the
// permissive `shapesCompatible` pre-filter BEFORE the definitive `isSameFile`
// identity check ever ran. The fix walks `sourceVideo` nearest-first so the
// subset borrows its source's full (80,...) shape.
//
// Tests 1-8 and 10 are pure in-memory and port directly via `makeVideo`; 11-12
// are end-to-end via in-memory `Labels.match`/`Labels.merge`. Python tests 9
// (`test_distinct_crops_not_collapsed`) and 13
// (`test_embed_subset_restore_original_match_pipeline`) require a real video
// fixture + full `.pkg.slp` embed/restore round-trip I/O and are NOT ported here
// (fixture-dependent); the in-memory cases fully cover the fix's logic.

describe("Embedded subset shape matching (#476)", () => {
  // Mirrors Python `_subset_chain()`: root has an UNKNOWN shape, the restored
  // original knows (80,...), and the embedded subset knows (27,...).
  function subsetChain(): { root: Video; restored: Video; embedded: Video } {
    const root = makeVideo("labeling/original.pkg.slp"); // unknown shape
    const restored = makeVideo(
      "restored_source.pkg.slp",
      [80, 1024, 1024, 1],
      root,
    );
    const embedded = makeVideo(
      "embedded_subset.pkg.slp",
      [27, 1024, 1024, 1],
      restored,
    );
    return { root, restored, embedded };
  }

  // PY test_effective_shape_uses_nearest_known_source (THE core fix test)
  it("effective shape uses the nearest known source, not own subset count", () => {
    const { restored, embedded } = subsetChain();
    // Subset resolves to the nearest source's 80-frame shape, NOT its own 27.
    expect(_getEffectiveShape(embedded)).toEqual([80, 1024, 1024, 1]);
    expect(_getEffectiveShape(restored)).toEqual([80, 1024, 1024, 1]);
  });

  // PY test_shapes_compatible_subset_vs_source
  it("subset and source are shape-compatible and same file", async () => {
    const { restored, embedded } = subsetChain();
    expect(shapesCompatible(embedded, restored)).toBe(true);
    expect(await isSameFile(embedded, restored)).toBe(true);
  });

  // PY test_find_match_restored_finds_embedded_subset
  it("AUTO find_match: restored original finds embedded subset", async () => {
    const { restored, embedded } = subsetChain();
    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.findMatch(restored, [embedded])).toBe(embedded);
  });

  // PY test_find_match_embedded_subset_finds_restored
  it("AUTO find_match: embedded subset finds restored original", async () => {
    const { restored, embedded } = subsetChain();
    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.findMatch(embedded, [restored])).toBe(restored);
  });

  // PY test_pairwise_match_subset_restored_both_directions
  it("AUTO pairwise match: subset <-> restored both directions", async () => {
    const { restored, embedded } = subsetChain();
    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.match(embedded, restored)).toBe(true);
    expect(await matcher.match(restored, embedded)).toBe(true);
  });

  // PY test_different_files_incompatible_shape_still_rejected (GUARD)
  it("unrelated files with incompatible shapes are still rejected", async () => {
    const a = makeVideo("/data/a.mp4", [100, 480, 640, 3]);
    const b = makeVideo("/data/b.mp4", [50, 480, 640, 3]); // no source chain
    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.findMatch(a, [b])).toBeNull();
    expect(await matcher.match(a, b)).toBe(false);
  });

  // PY test_same_file_siblings_no_source_chain_still_rejected_on_shape (GUARD)
  // Genuine same-file siblings with NO source relationship keep their OWN shapes
  // and stay shape-rejected — only a video WITH a sourceVideo borrows its
  // source's shape. The dataset fields are incidental; the shapes drive the
  // rejection (shapesCompatible / find_match / match do not consult dataset).
  it("same-file siblings without a source chain stay shape-rejected", async () => {
    const v0 = makeVideo("project.pkg.slp", [4, 384, 384, 1]);
    v0.backendMetadata.dataset = "video0/video";
    const v1 = makeVideo("project.pkg.slp", [1, 320, 560, 3]);
    v1.backendMetadata.dataset = "video1/video";

    expect(shapesCompatible(v0, v1)).toBe(false);
    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.findMatch(v1, [v0])).toBeNull();
    expect(await matcher.match(v0, v1)).toBe(false);
  });

  // PY test_provenance_conflict_still_rejected (GUARD)
  // Same shape, but distinct provenance roots -> not a match. In JS,
  // originalVideosConflict is FS-gated (the /data/*.mp4 roots do not exist), so
  // rejection lands on leaf-path uniqueness: the roots have DIFFERENT basenames
  // (v1.mp4 vs v2.mp4) so neither the embedded nor root basenames collide ->
  // null / false either way.
  it("distinct provenance roots with same shape are rejected", async () => {
    const root1 = makeVideo("/data/v1.mp4");
    const e1 = makeVideo("e1.pkg.slp", [100, 480, 640, 3], root1);
    const root2 = makeVideo("/data/v2.mp4");
    const e2 = makeVideo("e2.pkg.slp", [100, 480, 640, 3], root2);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.findMatch(e1, [e2])).toBeNull();
    expect(await matcher.match(e1, e2)).toBe(false);
  });

  // PY test_find_match_imagevideo_same_file_subset
  it("ImageVideo same-file subset matches its source (list filenames)", async () => {
    const images = ["f0.png", "f1.png", "f2.png", "f3.png"];
    const root = makeVideo([...images]); // distinct array copies
    const restored = makeVideo([...images], [4, 128, 128, 1], root);
    const embedded = makeVideo([...images], [2, 128, 128, 1], restored);

    expect(shapesCompatible(embedded, restored)).toBe(true);
    expect(await isSameFile(embedded, restored)).toBe(true);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.findMatch(restored, [embedded])).toBe(embedded);
    expect(await matcher.match(embedded, restored)).toBe(true);
  });

  // PY test_labels_match_embedded_subset_to_restored_original (end-to-end)
  it("Labels.match: embedded-subset GT matches restored-original predictions", async () => {
    const skeleton = new Skeleton(["a", "b"]);
    const { restored, embedded } = subsetChain();

    const gt = new Labels({
      videos: [embedded],
      skeletons: [skeleton],
      labeledFrames: [0, 5, 10].map(
        (frameIdx) =>
          new LabeledFrame({
            video: embedded,
            frameIdx,
            instances: [
              Instance.fromNumpy({
                pointsData: [
                  [1, 1],
                  [2, 2],
                ],
                skeleton,
              }),
            ],
          }),
      ),
    });

    const pr = new Labels({
      videos: [restored],
      skeletons: [skeleton],
      labeledFrames: [0, 5, 10].map(
        (frameIdx) =>
          new LabeledFrame({
            video: restored,
            frameIdx,
            instances: [
              PredictedInstance.fromNumpy({
                pointsData: [
                  [1, 1],
                  [2, 2],
                ],
                score: 1,
                skeleton,
              }),
            ],
          }),
      ),
    });

    const result = await gt.match(pr);
    // Map is keyed by OTHER (pr) -> SELF (gt): restored -> embedded.
    expect(result.videoMap.get(restored)).toBe(embedded);
    expect(result.allVideosMatched).toBe(true);
  });

  // PY test_labels_merge_restored_preds_into_subset_gt_dedups_video (end-to-end)
  it("Labels.merge: restored predictions merge into subset GT without dup video", async () => {
    const skeleton = new Skeleton(["a", "b"]);
    const { restored, embedded } = subsetChain();

    const gt = new Labels({
      videos: [embedded],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video: embedded,
          frameIdx: 0,
          instances: [
            Instance.fromNumpy({
              pointsData: [
                [1, 1],
                [2, 2],
              ],
              skeleton,
            }),
          ],
        }),
      ],
    });

    const pr = new Labels({
      videos: [restored],
      skeletons: [skeleton],
      labeledFrames: [
        new LabeledFrame({
          video: restored,
          frameIdx: 1,
          instances: [
            PredictedInstance.fromNumpy({
              pointsData: [
                [3, 3],
                [4, 4],
              ],
              score: 1,
              skeleton,
            }),
          ],
        }),
      ],
    });

    await gt.merge(pr);
    // Same file is not duplicated on merge.
    expect(gt.videos.length).toBe(1);
    expect(gt.labeledFrames.length).toBe(2);
  });
});
