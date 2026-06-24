/**
 * Port of Labels.extract() / split() Python tests.
 *
 * GROUND TRUTH: C:/Users/Talmo/code/sleap-io @ 054cce39f
 *   tests/model/test_labels.py ::
 *     test_extract_with_suggestions     (1315-1364)
 *     test_extract_preserves_annotations (7272-7290)
 *     test_split                         (1193-1310, count branches only)
 *     test_split_preserves_annotations    (7292-7310)
 *
 * Notes on the port (DECISIONS D5 — split RNG):
 * - JS `split(n, seed)` uses a deterministic mulberry32 RNG, NOT NumPy PCG64.
 *   We therefore assert COUNTS and the structural edge cases that are
 *   RNG-independent (n0===1 -> frame 0 in both; n0===0 -> both === this; n<1
 *   fraction floor with max(.,1)). We do NOT assert the specific Python frame
 *   indices for fractional/integer splits with >1 frame.
 * - Python `split` returns a `LabelsSet` (unpackable as a tuple); JS returns a
 *   `LabelsSet` keyed "split1"/"split2"; access via `.get("split1")`.
 * - Python `extract` deep-copies with structural sharing; we assert the copied
 *   videos are NOT identity-equal to the source but DO match by content/path,
 *   and that the suggestion video is the SAME object as the extracted LF video.
 */
import { describe, it, expect } from "../bun-test";
import { Instance, Track } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Labels } from "../../src/model/labels.js";
import { SuggestionFrame } from "../../src/model/suggestions.js";
import { UserCentroid } from "../../src/model/centroid.js";
import { UserBoundingBox } from "../../src/model/bbox.js";

function zeros2x2(skel: Skeleton): Instance {
  return Instance.fromArray(
    [
      [0, 0],
      [0, 0],
    ],
    skel,
  );
}

describe("Labels.extract", () => {
  // test_extract_with_suggestions (test_labels.py:1315-1364)
  it("copies suggestion frames for extracted videos and shares the LF video", () => {
    const video1 = new Video({ filename: "v1.mp4", openBackend: false });
    const video2 = new Video({ filename: "v2.mp4", openBackend: false });
    const skel = new Skeleton({ nodes: ["a", "b"] });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video: video1,
          frameIdx: 0,
          instances: [zeros2x2(skel)],
        }),
        new LabeledFrame({
          video: video1,
          frameIdx: 1,
          instances: [zeros2x2(skel)],
        }),
        new LabeledFrame({
          video: video2,
          frameIdx: 0,
          instances: [zeros2x2(skel)],
        }),
      ],
      suggestions: [
        new SuggestionFrame({ video: video1, frameIdx: 2 }),
        new SuggestionFrame({ video: video2, frameIdx: 1 }),
      ],
    });
    expect(labels.videos.length).toBe(2);
    expect(labels.suggestions.length).toBe(2);

    // Extract LFs from video 1.
    let extracted = labels.extract([0, 1]);
    expect(extracted.labeledFrames.length).toBe(2);
    expect(extracted.videos.length).toBe(1);
    expect(extracted.videos[0].matchesContent(video1)).toBe(true);
    expect(extracted.videos[0].matchesPath(video1)).toBe(true);
    expect(extracted.suggestions.length).toBe(1);
    expect(extracted.suggestions[0].video.matchesContent(video1)).toBe(true);
    expect(extracted.suggestions[0].video.matchesPath(video1)).toBe(true);
    expect(extracted.suggestions[0].frameIdx).toBe(2);
    // The suggestion video is the SAME object as the extracted LF video.
    expect(extracted.suggestions[0].video).toBe(extracted.videos[0]);

    // Extract LFs from video 2.
    extracted = labels.extract([2]);
    expect(extracted.labeledFrames.length).toBe(1);
    expect(extracted.videos.length).toBe(1);
    expect(extracted.videos[0].matchesContent(video2)).toBe(true);
    expect(extracted.videos[0].matchesPath(video2)).toBe(true);
    expect(extracted.suggestions.length).toBe(1);
    expect(extracted.suggestions[0].video.matchesContent(video2)).toBe(true);
    expect(extracted.suggestions[0].video.matchesPath(video2)).toBe(true);
    expect(extracted.suggestions[0].frameIdx).toBe(1);
    expect(extracted.suggestions[0].video).toBe(extracted.videos[0]);

    // Extract LFs from both.
    extracted = labels.extract([0, 2]);
    expect(extracted.labeledFrames.length).toBe(2);
    expect(extracted.videos.length).toBe(2);
    expect(extracted.suggestions.length).toBe(2);
    expect(extracted.suggestions[0].video.matchesContent(video1)).toBe(true);
    expect(extracted.suggestions[1].video.matchesContent(video2)).toBe(true);
  });

  // test_extract_preserves_annotations (test_labels.py:7272-7290)
  it("includes annotations nested in extracted frames", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = Instance.fromArray([[1.0, 2.0]], skeleton);
    const c = new UserCentroid({ x: 5.0, y: 10.0 });
    const b = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });

    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      centroids: [c],
      bboxes: [b],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
    });

    const extracted = labels.extract([0]);
    expect(extracted.labeledFrames.length).toBe(1);
    const exLf = extracted.labeledFrames[0];
    expect(exLf.centroids.length).toBe(1);
    expect(exLf.bboxes.length).toBe(1);
  });

  // Deep-copy structural sharing: a Track shared across two frames is copied
  // exactly ONCE; the copy is a different object from the source but shared
  // within the extracted subgraph. (ARCH §7.5; deepcopy memo semantics.)
  it("deep-copies with structural sharing (shared track copied once, not source)", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const track = new Track("animal");
    const inst0 = new Instance({
      points: [{ xy: [1, 2], visible: true, complete: false }],
      skeleton,
      track,
    });
    const inst1 = new Instance({
      points: [{ xy: [3, 4], visible: true, complete: false }],
      skeleton,
      track,
    });
    const lf0 = new LabeledFrame({ video, frameIdx: 0, instances: [inst0] });
    const lf1 = new LabeledFrame({ video, frameIdx: 1, instances: [inst1] });
    const labels = new Labels({
      labeledFrames: [lf0, lf1],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });

    const extracted = labels.extract([0, 1], true);
    const t0 = extracted.labeledFrames[0].instances[0].track!;
    const t1 = extracted.labeledFrames[1].instances[0].track!;
    // Copied (not the source object).
    expect(t0).not.toBe(track);
    // Shared within the extracted subgraph (copied exactly once).
    expect(t0).toBe(t1);
    // Same shared video too.
    expect(extracted.labeledFrames[0].video).toBe(
      extracted.labeledFrames[1].video,
    );
    expect(extracted.labeledFrames[0].video).not.toBe(video);
    // Source unchanged.
    expect(inst0.track).toBe(track);
  });

  // Name-based track/skeleton reorder: extract keeps tracks/skeletons in the
  // SAME relative order as the source (by NAME), regardless of the order the
  // deep-copy discovered them. (ARCH §7.5 — the one place NAME drives ordering.)
  it("reorders tracks by source NAME order", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const trackA = new Track("aaa");
    const trackB = new Track("bbb");
    const trackC = new Track("ccc");
    // Source track order: aaa, bbb, ccc.
    // Frames reference them in REVERSE discovery order (ccc first).
    const lf0 = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [
        new Instance({
          points: [{ xy: [1, 2], visible: true, complete: false }],
          skeleton,
          track: trackC,
        }),
      ],
    });
    const lf1 = new LabeledFrame({
      video,
      frameIdx: 1,
      instances: [
        new Instance({
          points: [{ xy: [3, 4], visible: true, complete: false }],
          skeleton,
          track: trackB,
        }),
      ],
    });
    const lf2 = new LabeledFrame({
      video,
      frameIdx: 2,
      instances: [
        new Instance({
          points: [{ xy: [5, 6], visible: true, complete: false }],
          skeleton,
          track: trackA,
        }),
      ],
    });
    const labels = new Labels({
      labeledFrames: [lf0, lf1, lf2],
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackA, trackB, trackC],
    });

    const extracted = labels.extract([0, 1, 2], true);
    // Tracks reordered to source NAME order: aaa, bbb, ccc.
    expect(extracted.tracks.map((t) => t.name)).toEqual(["aaa", "bbb", "ccc"]);
  });

  // Suggestion dedup: a suggestion whose video matches an extracted video is
  // re-pointed to that video object (no duplicate Video added).
  it("dedups suggestion videos against the extracted videos", () => {
    const video = new Video({ filename: "v.mp4", openBackend: false });
    const skel = new Skeleton({ nodes: ["a"] });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [Instance.fromArray([[0, 0]], skel)],
        }),
      ],
      suggestions: [new SuggestionFrame({ video, frameIdx: 5 })],
    });

    const extracted = labels.extract([0]);
    expect(extracted.videos.length).toBe(1);
    expect(extracted.suggestions.length).toBe(1);
    expect(extracted.suggestions[0].video).toBe(extracted.videos[0]);
  });

  // provenance.source_labels is set from this.provenance.filename (or null).
  it("records provenance.source_labels from the source filename (null if absent)", () => {
    const video = new Video({ filename: "v.mp4", openBackend: false });
    const skel = new Skeleton({ nodes: ["a"] });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [Instance.fromArray([[0, 0]], skel)],
        }),
      ],
    });

    // No filename in provenance -> null.
    let extracted = labels.extract([0]);
    expect(extracted.provenance.source_labels).toBe(null);

    // With a source filename -> that path.
    labels.provenance.filename = "/path/to/labels.slp";
    extracted = labels.extract([0]);
    expect(extracted.provenance.source_labels).toBe("/path/to/labels.slp");
  });
});

describe("Labels.split", () => {
  // test_split (test_labels.py:1193-1234) — count + edge-case branches only.
  it("n0===0 -> both splits are this (same object)", () => {
    const labels = new Labels();
    const splits = labels.split(0.5);
    const s1 = splits.get("split1")!;
    const s2 = splits.get("split2")!;
    expect(s1.labeledFrames.length).toBe(0);
    expect(s2.labeledFrames.length).toBe(0);
    // n0===0 short-circuit: both are `this`.
    expect(s1).toBe(labels);
    expect(s2).toBe(labels);
  });

  it("n0===1 -> frame 0 in BOTH splits (for 0.5, 0.999, and integer n=1)", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0 })],
    });

    for (const n of [0.5, 0.999, 1]) {
      const splits = labels.split(n);
      const s1 = splits.get("split1")!;
      const s2 = splits.get("split2")!;
      expect(s1.labeledFrames.length).toBe(1);
      expect(s2.labeledFrames.length).toBe(1);
      // The frame (idx 0) appears in both splits.
      expect(s1.labeledFrames[0].frameIdx).toBe(0);
      expect(s2.labeledFrames[0].frameIdx).toBe(0);
    }
  });

  // Real-data count branches: fraction, rounding (max(trunc,1)), integer.
  // Build 10 frames programmatically (mirrors slp_real_data len==10).
  function tenFrames(): Labels {
    const video = new Video({ filename: "vid.mp4", openBackend: false });
    const skel = new Skeleton({ nodes: ["a", "b"] });
    const lfs: LabeledFrame[] = [];
    for (let i = 0; i < 10; i++) {
      lfs.push(
        new LabeledFrame({
          video,
          frameIdx: i,
          instances: [
            Instance.fromArray(
              [
                [i, 0],
                [i, 1],
              ],
              skel,
            ),
          ],
        }),
      );
    }
    return new Labels({
      labeledFrames: lfs,
      videos: [video],
      skeletons: [skel],
    });
  }

  it("fraction split n=0.6 -> 6 / 4", () => {
    const splits = tenFrames().split(0.6);
    expect(splits.get("split1")!.labeledFrames.length).toBe(6);
    expect(splits.get("split2")!.labeledFrames.length).toBe(4);
  });

  it("rounding floor with max(trunc,1): n=0.001 -> 1 / 9", () => {
    const splits = tenFrames().split(0.001);
    expect(splits.get("split1")!.labeledFrames.length).toBe(1);
    expect(splits.get("split2")!.labeledFrames.length).toBe(9);
  });

  it("fraction n=0.999 -> 9 / 1", () => {
    const splits = tenFrames().split(0.999);
    expect(splits.get("split1")!.labeledFrames.length).toBe(9);
    expect(splits.get("split2")!.labeledFrames.length).toBe(1);
  });

  it("integer split n=8 -> 8 / 2", () => {
    const splits = tenFrames().split(8);
    expect(splits.get("split1")!.labeledFrames.length).toBe(8);
    expect(splits.get("split2")!.labeledFrames.length).toBe(2);
  });

  // Seed reproducibility WITHIN js (DECISIONS D5): same seed -> same frame set.
  it("is reproducible within JS for a fixed seed", () => {
    const a = tenFrames().split(0.6, 1234);
    const b = tenFrames().split(0.6, 1234);
    const aIdx = a
      .get("split1")!
      .labeledFrames.map((lf) => lf.frameIdx)
      .sort((x, y) => x - y);
    const bIdx = b
      .get("split1")!
      .labeledFrames.map((lf) => lf.frameIdx)
      .sort((x, y) => x - y);
    expect(aIdx).toEqual(bIdx);
    // The two splits are disjoint and partition the 10 frames.
    const s2Idx = a.get("split2")!.labeledFrames.map((lf) => lf.frameIdx);
    expect(aIdx.length + s2Idx.length).toBe(10);
    expect(new Set([...aIdx, ...s2Idx]).size).toBe(10);
  });

  // test_split_preserves_annotations (test_labels.py:7292-7310)
  it("includes annotations in both splits", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const lfs: LabeledFrame[] = [];
    for (let i = 0; i < 4; i++) {
      const inst = Instance.fromArray([[i, 0.0]], skeleton);
      const c = new UserCentroid({ x: i, y: 0.0 });
      lfs.push(
        new LabeledFrame({
          video,
          frameIdx: i,
          instances: [inst],
          centroids: [c],
        }),
      );
    }
    const labels = new Labels({
      labeledFrames: lfs,
      videos: [video],
      skeletons: [skeleton],
    });

    const splits = labels.split(0.5);
    for (const splitLabels of splits.values()) {
      for (const lf of splitLabels.labeledFrames) {
        expect(lf.centroids.length).toBe(1);
      }
    }
  });
});
