/**
 * Tests for NWB (ndx-pose) annotations import (PoseTraining — user labels).
 *
 * Two layers:
 *  (A) Pure-unit tests for the id→track-name, point-row, and numeric-attr
 *      helpers factored out of the reader.
 *  (B) A known-answer test against the generated fixture
 *      `tests/data/nwb/minimal.annotations.nwb` (3-node skeleton a/b/c; a source
 *      video of 8 frames; a training frame at video frame 0 with two instances
 *      track_0/track_1 (track_1's node c is invisible/NaN), and a sparse training
 *      frame at video frame 5 with one instance track_0).
 *
 * Unlike predictions, annotations store the frame index EXPLICITLY
 * (`TrainingFrame.source_video_frame_index`) and the track id EXPLICITLY
 * (`SkeletonInstance.id`), so there is no timestamp/rounding recovery — but the
 * frame recovery is asserted here to lock that the group name (`frame_0`) is NOT
 * used as the index (the fixture's second frame is at video index 5).
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readNwb, isNwbFile } from "../../src/io/main.js";
import {
  trackNameForId,
  annotationPointRows,
  type readNwbAnnotations,
} from "../../src/io/nwb-annotations.js";
import { readNumberAttr } from "../../src/io/h5-read-utils.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";

const nwbDir = path.join(
  fileURLToPath(new URL("../data", import.meta.url)),
  "nwb",
);
const minimalAnnNwb = path.join(nwbDir, "minimal.annotations.nwb");

type AnyLabels = Awaited<ReturnType<typeof readNwbAnnotations>>;
function frameAt(labels: AnyLabels, frameIdx: number) {
  return labels.labeledFrames.find((lf) => lf.frameIdx === frameIdx);
}
function instForTrack(
  lf: { instances: Array<{ track: { name: string } | null }> },
  name: string,
) {
  return lf.instances.find((i) => i.track != null && i.track.name === name);
}

describe("NWB annotations import — pure helpers", () => {
  describe("trackNameForId", () => {
    it("names a track by its numeric id", () => {
      expect(trackNameForId(0)).toBe("track_0");
      expect(trackNameForId(1)).toBe("track_1");
      expect(trackNameForId(12)).toBe("track_12");
    });
  });

  describe("annotationPointRows", () => {
    it("pairs flat locations with explicit visibility as [x,y,visible]", () => {
      expect(
        annotationPointRows([10, 20, 30, 40, 50, 60], [1, 1, 1], 3),
      ).toEqual([
        [10, 20, 1],
        [30, 40, 1],
        [50, 60, 1],
      ]);
    });

    it("carries an invisible (NaN) node through with visible=0", () => {
      const rows = annotationPointRows(
        [11, 21, 31, 41, NaN, NaN],
        [1, 1, 0],
        3,
      );
      expect(rows[0]).toEqual([11, 21, 1]);
      expect(rows[1]).toEqual([31, 41, 1]);
      expect(Number.isNaN(rows[2][0])).toBe(true);
      expect(Number.isNaN(rows[2][1])).toBe(true);
      expect(rows[2][2]).toBe(0);
    });

    it("emits 2-col rows (visibility inferred) when no visibility array", () => {
      expect(annotationPointRows([10, 20], null, 1)).toEqual([[10, 20]]);
    });

    it("pads missing locations with NaN", () => {
      const rows = annotationPointRows([], null, 2);
      expect(rows.length).toBe(2);
      expect(Number.isNaN(rows[0][0])).toBe(true);
      expect(Number.isNaN(rows[1][1])).toBe(true);
    });
  });

  describe("readNumberAttr", () => {
    it("reads a plain numeric attr", () => {
      expect(
        readNumberAttr(
          { source_video_frame_index: 5 },
          "source_video_frame_index",
        ),
      ).toBe(5);
    });
    it("unwraps a { value } attr and coerces bigint", () => {
      expect(readNumberAttr({ x: { value: 7 } }, "x")).toBe(7);
      expect(readNumberAttr({ x: 5n }, "x")).toBe(5);
    });
    it("takes the first element of an array-wrapped scalar", () => {
      expect(readNumberAttr({ x: [3] }, "x")).toBe(3);
    });
    it("returns undefined when absent or non-numeric", () => {
      expect(readNumberAttr({}, "missing")).toBeUndefined();
      expect(readNumberAttr({ x: "nope" }, "x")).toBeUndefined();
    });
  });
});

describe("NWB annotations import — known-answer fixture", () => {
  it("is detected as an NWB file", async () => {
    expect(await isNwbFile(minimalAnnNwb)).toBe(true);
  });

  it("reconstructs videos, skeleton, tracks, frames and points", async () => {
    const labels = await readNwb(minimalAnnNwb);

    // video: single source video; shape[0] from num_samples (8), so the timeline
    // extends past the last labeled frame (5).
    expect(labels.videos.length).toBe(1);
    expect(String(labels.videos[0].filename)).toContain(
      "minimal_annot_src.mp4",
    );
    expect(labels.videos[0].shape?.[0]).toBe(8);

    // skeleton
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].nodeNames).toEqual(["a", "b", "c"]);
    expect(labels.skeletons[0].edges.length).toBe(2);

    // tracks recovered from SkeletonInstance.id (names not stored → track_{id})
    expect(labels.tracks.map((t) => t.name).sort()).toEqual([
      "track_0",
      "track_1",
    ]);

    // frames: explicit source_video_frame_index (0 and 5) — NOT the group names.
    expect(
      labels.labeledFrames.map((lf) => lf.frameIdx).sort((a, b) => a - b),
    ).toEqual([0, 5]);

    const f0 = frameAt(labels, 0)!;
    expect(f0.instances.length).toBe(2);
    // user annotations, not predictions
    expect(f0.instances.every((i) => i instanceof Instance)).toBe(true);
    expect(f0.instances.some((i) => i instanceof PredictedInstance)).toBe(
      false,
    );

    const t0 = instForTrack(f0, "track_0")!;
    expect(t0.points[0].xy).toEqual([10, 20]);
    expect(t0.points[2].xy).toEqual([50, 60]);
    expect(t0.points[0].visible).toBe(true);

    const t1 = instForTrack(f0, "track_1")!;
    expect(t1.points[0].xy).toEqual([11, 21]);
    expect(t1.points[2].visible).toBe(false); // node c invisible (NaN)
    expect(Number.isNaN(t1.points[2].xy[0])).toBe(true);

    const f5 = frameAt(labels, 5)!;
    expect(f5.instances.length).toBe(1);
    expect(instForTrack(f5, "track_0")!.points[1].xy).toEqual([35, 45]);
  });
});
