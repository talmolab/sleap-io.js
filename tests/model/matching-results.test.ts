/**
 * Port of test_matching.py result/error/progress-bar groups:
 *   GROUP 5  — TestMergeResult (lines 236-294): summary byte-exact substrings.
 *   GROUP 7  — TestMergeErrors (lines 327-343): MergeError / SkeletonMismatchError
 *              + instanceof chain.
 *   GROUP 8  — TestMergeProgressBar (lines 346-359): context-manager protocol.
 *   GROUP 11 — test_merge_result_many_errors (572-583): truncate at 5 + "... and N more";
 *              progress-bar update_with_message (718-736), without_pbar (738-753),
 *              close_with_active_pbar (1274-1288), exit_without_pbar (1290-1300).
 *   Plus MatchResult summary + computed props (merging.md doc A.3/A.4, ARCH §5.4).
 *
 * Python ref: C:/Users/Talmo/code/sleap-io/tests/model/test_matching.py
 * MergeResult/MatchResult/MergeProgressBar impl: sleap_io/model/matching.py:1192-1389.
 */
import { describe, it, expect } from "../bun-test";
import {
  MergeResult,
  MergeError,
  SkeletonMismatchError,
  ConflictResolution,
  MergeProgressBar,
  MatchResult,
} from "../../src/model/matching.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Track } from "../../src/model/instance.js";

// =============================================================================
// GROUP 5 — MergeResult.summary() (test_matching.py:236-294)
// =============================================================================

describe("MergeResult.summary (TestMergeResult)", () => {
  // test_successful_merge (test_matching.py:239-254)
  it("formats a successful merge with the ✓ prefix and count lines", () => {
    const result = new MergeResult(true, {
      framesMerged: 10,
      instancesAdded: 50,
      instancesUpdated: 5,
      instancesSkipped: 2,
    });

    const summary = result.summary();
    expect(summary).toContain("✓ Merge completed successfully");
    expect(summary).toContain("Frames merged: 10");
    expect(summary).toContain("Instances added: 50");
    expect(summary).toContain("Instances updated: 5");
    expect(summary).toContain("Instances skipped: 2");
  });

  // test_failed_merge (test_matching.py:256-272)
  it("formats a failed merge with the ✗ prefix and lists error messages", () => {
    const error1 = new MergeError("Error 1");
    const error2 = new SkeletonMismatchError("Skeleton mismatch");

    const result = new MergeResult(false, {
      framesMerged: 5,
      instancesAdded: 20,
      errors: [error1, error2],
    });

    const summary = result.summary();
    expect(summary).toContain("✗ Merge completed with errors");
    expect(summary).toContain("Errors encountered: 2");
    expect(summary).toContain("Error 1");
    expect(summary).toContain("Skeleton mismatch");
  });

  // test_merge_with_conflicts (test_matching.py:274-294)
  it("reports the resolved-conflicts count", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const frame = new LabeledFrame({ video, frameIdx: 0 });

    const conflict = new ConflictResolution(
      frame,
      "duplicate_instance",
      "original",
      "new",
      "kept_original",
    );

    const result = new MergeResult(true, {
      framesMerged: 1,
      conflicts: [conflict],
    });

    const summary = result.summary();
    expect(summary).toContain("Conflicts resolved: 1");
  });

  // test_merge_result_many_errors (test_matching.py:572-583, GROUP 11)
  it("truncates the error list at 5 and appends '... and N more'", () => {
    const errors = Array.from(
      { length: 10 },
      (_, i) => new MergeError(`Error ${i}`),
    );
    const result = new MergeResult(false, { errors });

    const summary = result.summary();
    expect(summary).toContain("Errors encountered: 10");
    expect(summary).toContain("Error 0");
    expect(summary).toContain("Error 4");
    expect(summary).toContain("... and 5 more");
    // Error 5..9 are truncated. Note "Error 5" must NOT appear anywhere.
    expect(summary).not.toContain("Error 5");
  });
});

// =============================================================================
// GROUP 7 — MergeError / SkeletonMismatchError (test_matching.py:327-343)
// =============================================================================

describe("MergeError classes (TestMergeErrors)", () => {
  // test_merge_error (test_matching.py:330-333)
  it("MergeError exposes message and details", () => {
    const error = new MergeError("Test error", { key: "value" });
    expect(error.message).toBe("Test error");
    expect(error.details).toEqual({ key: "value" });
  });

  // test_skeleton_mismatch_error (test_matching.py:336-343)
  it("SkeletonMismatchError is a MergeError subclass with message", () => {
    const error = new SkeletonMismatchError("Skeletons don't match", {
      skeleton1: "skel1",
      skeleton2: "skel2",
    });
    expect(error instanceof MergeError).toBe(true);
    expect(error.message).toBe("Skeletons don't match");
  });

  it("SkeletonMismatchError is also an Error and a SkeletonMismatchError", () => {
    const error = new SkeletonMismatchError("x");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof SkeletonMismatchError).toBe(true);
  });

  it("MergeError.details defaults to a fresh {} per instance", () => {
    const a = new MergeError("a");
    const b = new MergeError("b");
    expect(a.details).toEqual({});
    expect(b.details).toEqual({});
    // Distinct objects, not a shared module-level dict.
    expect(a.details).not.toBe(b.details);
  });
});

// =============================================================================
// GROUP 8 — MergeProgressBar (test_matching.py:346-359)
// + GROUP 11 progress-bar cases (718-753, 1274-1300)
// =============================================================================

describe("MergeProgressBar (TestMergeProgressBar)", () => {
  // test_progress_bar_context_manager (test_matching.py:349-359)
  it("acts as a context manager: desc set, pbar starts null, callback runs", () => {
    const progress = new MergeProgressBar("Test merge");
    const ctx = progress.enter();
    try {
      expect(ctx.desc).toBe("Test merge");
      expect(ctx.pbar).toBeNull();

      // Since there is no tqdm in JS, just check the callbacks run.
      ctx.callback(0, 10, "Starting");
      ctx.callback(5, 10, "Halfway");
      ctx.callback(10, 10, "Complete");
    } finally {
      progress.exit();
    }
  });

  // test_merge_progress_bar_update_with_message (test_matching.py:718-736)
  it("callback with a message updates pbar.desc to include the message", () => {
    const progress = new MergeProgressBar("Merging");

    progress.callback(50, 100, "Processing frames");
    expect(progress.pbar).not.toBeNull();
    const pbar = progress.pbar as { n: number; desc: string };
    expect(pbar.n).toBe(50);
    expect(pbar.desc).toContain("Processing frames");

    // Callback without message falls back to the base desc.
    progress.callback(75, 100);
    expect(pbar.n).toBe(75);
    expect(pbar.desc).toContain(progress.desc); // "Merging"
  });

  // test_merge_progress_bar_without_pbar (test_matching.py:738-753)
  it("does not create the pbar when total is 0; creates it when total > 0", () => {
    const progress = new MergeProgressBar("Merging");

    // total=0 must NOT create the pbar.
    progress.callback(0, 0, "No total");
    expect(progress.pbar).toBeNull();

    // total > 0 creates it.
    progress.callback(50, 100, "Processing");
    expect(progress.pbar).not.toBeNull();
  });

  // test_merge_progress_bar_close_with_active_pbar (test_matching.py:1274-1288)
  it("preserves the last n value on the pbar reference after context exit", () => {
    const progress = new MergeProgressBar("Test merge");
    progress.enter();
    progress.callback(50, 100, "Processing");
    expect(progress.pbar).not.toBeNull();
    const pbarRef = progress.pbar as { n: number };
    progress.exit();

    // The captured pbar object retains n at the last callback value (50).
    expect(pbarRef.n).toBe(50);
  });

  // test_merge_progress_bar_exit_without_pbar (test_matching.py:1290-1300)
  it("handles exit gracefully when the pbar was never created", () => {
    const progress = new MergeProgressBar("Test merge");
    progress.enter();
    expect(progress.pbar).toBeNull();
    progress.exit();
    expect(progress.pbar).toBeNull();
  });

  it("supports `using` disposal via Symbol.dispose", () => {
    // Mirrors the with-statement protocol; dispose closes the (stub) bar.
    const progress = new MergeProgressBar("Disposable");
    progress.callback(1, 10, "go");
    expect(progress.pbar).not.toBeNull();
    progress[Symbol.dispose]();
    expect(progress.pbar).toBeNull();
  });
});

// =============================================================================
// MatchResult summary + computed properties
// (merging.md doc A.3/A.4, ARCH §5.4 — no dedicated Python test body in the
//  assigned groups; behavior is the documented contract for the read-only twin.)
// Maps are keyed by `other`'s objects -> `self`'s objects or null; insertion
// order is preserved.
// =============================================================================

describe("MatchResult computed properties", () => {
  function mkVideo(name: string): Video {
    return new Video({ filename: name, openBackend: false });
  }

  it("nVideosMatched / unmatchedVideos / allVideosMatched reflect non-null values", () => {
    const otherV1 = mkVideo("a.mp4");
    const otherV2 = mkVideo("b.mp4");
    const otherV3 = mkVideo("c.mp4");
    const selfV1 = mkVideo("a.mp4");

    const videoMap = new Map<Video, Video | null>([
      [otherV1, selfV1],
      [otherV2, null],
      [otherV3, null],
    ]);
    const result = new MatchResult({ videoMap });

    expect(result.nVideosMatched).toBe(1);
    expect(result.unmatchedVideos).toEqual([otherV2, otherV3]); // insertion order
    expect(result.allVideosMatched).toBe(false);
  });

  it("nSkeletonsMatched / unmatchedSkeletons / allSkeletonsMatched", () => {
    const o1 = new Skeleton({ nodes: ["a"] });
    const o2 = new Skeleton({ nodes: ["b"] });
    const s1 = new Skeleton({ nodes: ["a"] });

    const skeletonMap = new Map<Skeleton, Skeleton | null>([
      [o1, s1],
      [o2, null],
    ]);
    const result = new MatchResult({ skeletonMap });

    expect(result.nSkeletonsMatched).toBe(1);
    expect(result.unmatchedSkeletons).toEqual([o2]);
    expect(result.allSkeletonsMatched).toBe(false);
  });

  it("nTracksMatched / unmatchedTracks / allTracksMatched", () => {
    const o1 = new Track("t1");
    const o2 = new Track("t2");
    const s1 = new Track("t1");

    const trackMap = new Map<Track, Track | null>([
      [o1, s1],
      [o2, null],
    ]);
    const result = new MatchResult({ trackMap });

    expect(result.nTracksMatched).toBe(1);
    expect(result.unmatchedTracks).toEqual([o2]);
    expect(result.allTracksMatched).toBe(false);
  });

  it("all*Matched are true when every value is non-null (and for empty maps)", () => {
    const o1 = mkVideo("a.mp4");
    const s1 = mkVideo("a.mp4");
    const fullyMatched = new MatchResult({
      videoMap: new Map([[o1, s1]]),
    });
    expect(fullyMatched.allVideosMatched).toBe(true);

    const empty = new MatchResult();
    expect(empty.allVideosMatched).toBe(true);
    expect(empty.allSkeletonsMatched).toBe(true);
    expect(empty.allTracksMatched).toBe(true);
    expect(empty.nVideosMatched).toBe(0);
  });
});

describe("MatchResult.summary (merging.md doc A.3)", () => {
  function mkVideo(name: string): Video {
    return new Video({ filename: name, openBackend: false });
  }

  it("emits Videos / Skeletons / Tracks count lines in order", () => {
    const ov = mkVideo("a.mp4");
    const sv = mkVideo("a.mp4");
    const os = new Skeleton({ nodes: ["a"] });
    const ss = new Skeleton({ nodes: ["a"] });
    const ot = new Track("t");
    const st = new Track("t");

    const result = new MatchResult({
      videoMap: new Map([[ov, sv]]),
      skeletonMap: new Map([[os, ss]]),
      trackMap: new Map([[ot, st]]),
    });

    const summary = result.summary();
    const lines = summary.split("\n");
    expect(lines[0]).toBe("Videos: 1/1 matched");
    expect(lines[1]).toBe("Skeletons: 1/1 matched");
    expect(lines[2]).toBe("Tracks: 1/1 matched");
  });

  it("'0/0 matched' is valid for an empty MatchResult", () => {
    const result = new MatchResult();
    expect(result.summary()).toBe(
      [
        "Videos: 0/0 matched",
        "Skeletons: 0/0 matched",
        "Tracks: 0/0 matched",
      ].join("\n"),
    );
  });

  it("lists unmatched videos (first 5 + '... and N more') for videos only", () => {
    const videoMap = new Map<Video, Video | null>();
    for (let i = 0; i < 7; i++) {
      videoMap.set(mkVideo(`v${i}.mp4`), null);
    }
    const result = new MatchResult({ videoMap });

    const summary = result.summary();
    expect(summary).toContain("Videos: 0/7 matched");
    expect(summary).toContain("Unmatched videos:");
    expect(summary).toContain("- v0.mp4");
    expect(summary).toContain("- v4.mp4");
    expect(summary).toContain("... and 2 more");
    // Sixth and seventh entries are truncated.
    expect(summary).not.toContain("- v5.mp4");
  });
});
