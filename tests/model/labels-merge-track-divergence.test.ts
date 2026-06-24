//
// Port of Python `tests/model/test_merging_integration.py`
// ::TestTrackNameDivergenceWarning (sleap-io PR talmolab/sleap-io#448),
// covering the name-collision spatial-divergence warning emitted by
// `Labels.merge()`.
//
// Python emits a `UserWarning` via `warnings.warn`; the JS port emits a
// `console.warn` (the codebase's diagnostic-warning convention). Tests capture
// `console.warn` and assert on the message text, mirroring the Python
// `pytest.warns(...)` / `warnings.catch_warnings(record=True)` patterns.

import { describe, it, expect } from "../bun-test";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance, Track } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import {
  InstanceMatcher,
  InstanceMatchMethod,
  TrackMatcher,
  TrackMatchMethod,
} from "../../src/model/matching.js";

/** Run `fn` with `console.warn` captured; returns the captured message strings. */
async function captureWarnings(
  fn: () => Promise<void> | void,
): Promise<string[]> {
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return warnings;
}

/**
 * Build a single-frame, single-instance Labels for divergence tests.
 *
 * Mirrors the Python `_make_run` fixture: one `LabeledFrame` holding one tracked
 * `Instance`. NOTE: Python `Labels.append` auto-collects each instance's track
 * into `labels.tracks`; the JS `append` does NOT collect *instance* tracks (only
 * annotation tracks), so the instance's track is registered explicitly to
 * reproduce the same post-append state.
 */
function makeRun(
  trackName: string,
  points: number[][],
  opts: { frameIdx?: number; skeleton?: Skeleton; video?: Video } = {},
): Labels {
  const skeleton = opts.skeleton ?? new Skeleton({ nodes: ["head", "tail"] });
  const video =
    opts.video ?? new Video({ filename: "test.mp4", openBackend: false });
  const track = new Track(trackName);
  const labels = new Labels({ tracks: [track] });
  const frame = new LabeledFrame({ video, frameIdx: opts.frameIdx ?? 0 });
  const inst = Instance.fromNumpy({
    pointsData: points.map((p) => [...p]),
    skeleton,
    track,
  });
  frame.instances = [inst];
  labels.append(frame);
  return labels;
}

describe("Labels.merge — track-name divergence warning (PR 448)", () => {
  it("warns on spatial divergence", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton },
    );
    const run2 = makeRun(
      "track_0",
      [
        [500, 500],
        [510, 510],
      ],
      { skeleton },
    );

    let result!: Awaited<ReturnType<Labels["merge"]>>;
    const warnings = await captureWarnings(async () => {
      result = await run1.merge(run2, { track: "name" });
    });

    expect(warnings.some((w) => /track_0.*diverge spatially/.test(w))).toBe(
      true,
    );
    expect(result.successful).toBe(true);
    // Diagnostic only: tracks still collapse by name.
    expect(run1.tracks.length).toBe(1);
  });

  it("does not warn when same-named tracks overlap spatially", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton },
    );
    const run2 = makeRun(
      "track_0",
      [
        [11, 11],
        [21, 21],
      ],
      { skeleton },
    );

    let result!: Awaited<ReturnType<Labels["merge"]>>;
    const warnings = await captureWarnings(async () => {
      result = await run1.merge(run2, { track: "name" });
    });

    expect(result.successful).toBe(true);
    expect(warnings.some((w) => /diverge spatially/.test(w))).toBe(false);
    expect(run1.tracks.length).toBe(1);
  });

  it("is skipped when track matching is by identity (string)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton },
    );
    const run2 = makeRun(
      "track_0",
      [
        [500, 500],
        [510, 510],
      ],
      { skeleton },
    );

    const warnings = await captureWarnings(async () => {
      await run1.merge(run2, { track: "identity" });
    });

    expect(warnings.some((w) => /diverge spatially/.test(w))).toBe(false);
  });

  it("is skipped for a custom non-NAME TrackMatcher", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton },
    );
    const run2 = makeRun(
      "track_0",
      [
        [500, 500],
        [510, 510],
      ],
      { skeleton },
    );

    const matcher = new TrackMatcher(TrackMatchMethod.IDENTITY);
    const warnings = await captureWarnings(async () => {
      await run1.merge(run2, { track: matcher });
    });

    expect(warnings.some((w) => /diverge spatially/.test(w))).toBe(false);
  });

  it("is skipped when the instance matcher is identity-based", async () => {
    // Identity instance matching compares track-object identity, which is always
    // false across a name collision, so it cannot assess spatial divergence and
    // must not warn unconditionally (even on divergent points).
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton },
    );
    const run2 = makeRun(
      "track_0",
      [
        [500, 500],
        [510, 510],
      ],
      { skeleton },
    );

    const matcher = new InstanceMatcher(InstanceMatchMethod.IDENTITY);
    const warnings = await captureWarnings(async () => {
      await run1.merge(run2, { track: "name", instance: matcher });
    });

    expect(warnings.some((w) => /diverge spatially/.test(w))).toBe(false);
  });

  it("does not warn without shared frames", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { frameIdx: 0, skeleton },
    );
    const run2 = makeRun(
      "track_0",
      [
        [500, 500],
        [510, 510],
      ],
      { frameIdx: 5, skeleton },
    );

    const warnings = await captureWarnings(async () => {
      await run1.merge(run2, { track: "name" });
    });

    expect(warnings.some((w) => /diverge spatially/.test(w))).toBe(false);
  });

  it("does not warn when the colliding track has no instance on a shared frame", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    // run1 has track_0 on frame 0.
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton, video },
    );

    // run2 has both track_0 and track_1 in its track list (so track_0 collides),
    // but on the shared frame 0 only a track_1 instance appears. (JS `append`
    // does not collect instance tracks, so `tracks` is registered explicitly.)
    const track0 = new Track("track_0");
    const track1 = new Track("track_1");
    const run2 = new Labels({ tracks: [track1, track0] });
    // Frame 0 (shared): only a track_1 instance.
    const f0 = new LabeledFrame({ video, frameIdx: 0 });
    f0.instances = [
      Instance.fromNumpy({
        pointsData: [
          [500.0, 500.0],
          [510.0, 510.0],
        ],
        skeleton,
        track: track1,
      }),
    ];
    // Frame 5 (not shared): a track_0 instance, so track_0 is in run2.tracks.
    const f5 = new LabeledFrame({ video, frameIdx: 5 });
    f5.instances = [
      Instance.fromNumpy({
        pointsData: [
          [500.0, 500.0],
          [510.0, 510.0],
        ],
        skeleton,
        track: track0,
      }),
    ];
    run2.append(f0);
    run2.append(f5);

    const warnings = await captureWarnings(async () => {
      await run1.merge(run2, { track: "name" });
    });

    expect(warnings.some((w) => /diverge spatially/.test(w))).toBe(false);
  });

  it("does not warn for an appended new track", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton },
    );
    const run2 = makeRun(
      "track_2",
      [
        [500, 500],
        [510, 510],
      ],
      { skeleton },
    );

    const warnings = await captureWarnings(async () => {
      await run1.merge(run2, { track: "name" });
    });

    expect(warnings.some((w) => /diverge spatially/.test(w))).toBe(false);
    // The new track is appended.
    expect(run1.tracks.length).toBe(2);
  });

  it("warns once per pair across multiple frames", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    // One Track object per run, reused across all frames, so the same
    // (selfTrack, otherTrack) pair spans every shared frame. (JS `append` does
    // not collect instance tracks, so `tracks` is registered explicitly.)
    const selfTrack = new Track("track_0");
    const otherTrack = new Track("track_0");
    const run1 = new Labels({ tracks: [selfTrack] });
    const run2 = new Labels({ tracks: [otherTrack] });
    for (let idx = 0; idx < 3; idx += 1) {
      const f1 = new LabeledFrame({ video, frameIdx: idx });
      f1.instances = [
        Instance.fromNumpy({
          pointsData: [
            [10.0, 10.0],
            [20.0, 20.0],
          ],
          skeleton,
          track: selfTrack,
        }),
      ];
      run1.append(f1);

      const f2 = new LabeledFrame({ video, frameIdx: idx });
      f2.instances = [
        Instance.fromNumpy({
          pointsData: [
            [500.0, 500.0],
            [510.0, 510.0],
          ],
          skeleton,
          track: otherTrack,
        }),
      ];
      run2.append(f2);
    }

    const warnings = await captureWarnings(async () => {
      await run1.merge(run2, { track: "name" });
    });

    const divergence = warnings.filter((w) => /diverge spatially/.test(w));
    expect(divergence.length).toBe(1);
    expect(/3 overlapping/.test(divergence[0])).toBe(true);
  });

  it("warns per other-track on a many-to-one collision", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({ filename: "test.mp4", openBackend: false });

    const run1 = makeRun(
      "track_0",
      [
        [10, 10],
        [20, 20],
      ],
      { skeleton, video },
    );

    // run2: two distinct Track objects both named track_0 on distinct frames.
    // (JS `append` does not collect instance tracks, so register explicitly.)
    const trackA = new Track("track_0");
    const trackB = new Track("track_0");
    const run2 = new Labels({ tracks: [trackA, trackB] });
    const fa = new LabeledFrame({ video, frameIdx: 0 });
    fa.instances = [
      Instance.fromNumpy({
        pointsData: [
          [500.0, 500.0],
          [510.0, 510.0],
        ],
        skeleton,
        track: trackA,
      }),
    ];
    // Distinct frame_idx so both frames coexist in run2.
    const fb = new LabeledFrame({ video, frameIdx: 1 });
    fb.instances = [
      Instance.fromNumpy({
        pointsData: [
          [600.0, 600.0],
          [610.0, 610.0],
        ],
        skeleton,
        track: trackB,
      }),
    ];
    const run1Extra = new LabeledFrame({ video, frameIdx: 1 });
    run1Extra.instances = [
      Instance.fromNumpy({
        pointsData: [
          [10.0, 10.0],
          [20.0, 20.0],
        ],
        skeleton,
        track: run1.tracks[0],
      }),
    ];
    run1.append(run1Extra);
    run2.append(fa);
    run2.append(fb);

    let result!: Awaited<ReturnType<Labels["merge"]>>;
    const warnings = await captureWarnings(async () => {
      result = await run1.merge(run2, { track: "name" });
    });

    expect(result.successful).toBe(true);
    const divergence = warnings.filter((w) => /diverge spatially/.test(w));
    // Both incoming track_0 objects collide onto self's single track_0 and both
    // diverge, so one warning per colliding other_track (two total).
    expect(divergence.length).toBe(2);
  });
});
