/**
 * Cross-writer hardening tests for NWB predictions import.
 *
 * Real ndx-pose files in the wild are not all written by modern sleap-io. Two
 * hand-crafted fixtures lock the reader's tolerance for other writers/eras:
 *
 *  - `legacy.pose.nwb` — ndx-pose **0.1.x** layout: the skeleton `nodes`/`edges`
 *    live DIRECTLY on the `PoseEstimation` group (there is no `Skeletons`
 *    container / linked `Skeleton`). Exercises `resolveSkeleton`'s legacy
 *    fallback.
 *  - `untracked.dandi.pose.nwb` — a DLC/DANDI-style file whose `PoseEstimation`
 *    container is named by the individual (`ind1`), NOT `track={name}`. Exercises
 *    the non-SLEAP naming path: `parseTrackName` returns null → the instances are
 *    read as UNTRACKED rather than crashing or inventing a track.
 *
 * Both are minimal HDF5 files written by hand (h5py) to hit exactly those paths;
 * they are not full pynwb exports.
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readNwb, isNwbFile } from "../../src/io/main.js";
import { PredictedInstance } from "../../src/model/instance.js";

const nwbDir = path.join(
  fileURLToPath(new URL("../data", import.meta.url)),
  "nwb",
);
const legacyNwb = path.join(nwbDir, "legacy.pose.nwb");
const dandiNwb = path.join(nwbDir, "untracked.dandi.pose.nwb");

describe("NWB import hardening — legacy ndx-pose 0.1.x (nodes/edges on the group)", () => {
  it("is detected as an NWB file", async () => {
    expect(await isNwbFile(legacyNwb)).toBe(true);
  });

  it("reads the skeleton from the legacy nodes/edges fallback and recovers the track", async () => {
    const labels = await readNwb(legacyNwb);

    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B"]);
    expect(labels.skeletons[0].edges.length).toBe(1);

    // track=1 → a single recovered track named "1".
    expect(labels.tracks.map((t) => t.name)).toEqual(["1"]);

    // starting_time=0 over 2 samples → frames 0 and 1.
    expect(
      labels.labeledFrames.map((lf) => lf.frameIdx).sort((a, b) => a - b),
    ).toEqual([0, 1]);

    const f0 = labels.labeledFrames.find((lf) => lf.frameIdx === 0)!;
    expect(f0.instances.length).toBe(1);
    const inst = f0.instances[0];
    expect(inst).toBeInstanceOf(PredictedInstance);
    expect(inst.track?.name).toBe("1");
    expect(inst.points[0].xy).toEqual([10, 20]);
    expect((inst.points[0] as { score: number }).score).toBeCloseTo(0.9, 5);
  });
});

describe("NWB import hardening — DLC/DANDI naming (non-track= container → untracked)", () => {
  it("is detected as an NWB file", async () => {
    expect(await isNwbFile(dandiNwb)).toBe(true);
  });

  it("reads points as untracked when the container is not named track=", async () => {
    const labels = await readNwb(dandiNwb);

    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B"]);
    // No track= container → no recovered tracks (untracked), not a crash.
    expect(labels.tracks.length).toBe(0);

    // timestamps [0,1,2] → frames 0,1,2.
    expect(
      labels.labeledFrames.map((lf) => lf.frameIdx).sort((a, b) => a - b),
    ).toEqual([0, 1, 2]);

    const f0 = labels.labeledFrames.find((lf) => lf.frameIdx === 0)!;
    expect(f0.instances.length).toBe(1);
    const inst = f0.instances[0];
    expect(inst).toBeInstanceOf(PredictedInstance);
    expect(inst.track).toBeNull();
    expect(inst.points[0].xy).toEqual([1, 2]);
  });
});
