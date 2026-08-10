/**
 * Tests for NWB (ndx-pose) predictions import.
 *
 * Two layers:
 *  (A) Pure-unit tests for the track-name parse and integer-frame recovery
 *      helpers factored out of the reader.
 *  (B) A known-answer differential test against the generated fixture
 *      `tests/data/nwb/minimal.pose.nwb`, whose expected reconstruction is
 *      documented inline (2 tracks "1"/"2", frames 0/1/2, node "B" absent for
 *      track "2", video "/data/minimal.mp4").
 *
 * Mirrors `analysis-h5.test.ts` in spirit: exercise the public `loadNwb` /
 * `readNwb` / `isNwbFile` surface plus the pure helpers.
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { loadNwb, readNwb, isNwbFile } from "../../src/io/main.js";
import {
  parseTrackName,
  seriesSampleTimes,
  resolveTrackFrameIndices,
} from "../../src/io/nwb-predictions.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const nwbDir = path.join(fixtureRoot, "nwb");
const minimalNwb = path.join(nwbDir, "minimal.pose.nwb");

// Helper: find the labeled frame with a given frameIdx.
type AnyLabels = Awaited<ReturnType<typeof loadNwb>>;
function frameAt(labels: AnyLabels, frameIdx: number) {
  return labels.labeledFrames.find((lf) => lf.frameIdx === frameIdx);
}
function instanceForTrack(
  lf: { instances: Array<{ track: { name: string } | null }> },
  name: string,
) {
  return lf.instances.find((i) => i.track != null && i.track.name === name);
}

describe("NWB predictions import — pure helpers", () => {
  describe("parseTrackName", () => {
    it("parses a named track container", () => {
      expect(parseTrackName("track=1")).toBe("1");
      expect(parseTrackName("track=female")).toBe("female");
      expect(parseTrackName("track=track_0")).toBe("track_0");
    });
    it("treats track=untracked as no track", () => {
      expect(parseTrackName("track=untracked")).toBeNull();
    });
    it("treats a non-track= container as no track", () => {
      expect(parseTrackName("PoseEstimation")).toBeNull();
      expect(parseTrackName("Animal")).toBeNull();
    });
  });

  describe("seriesSampleTimes", () => {
    it("uses timestamps as-is (raw times, not yet frame indices)", () => {
      expect(seriesSampleTimes([0, 2.67, 5.33], undefined, 3)).toEqual([
        0, 2.67, 5.33,
      ]);
    });
    it("falls back to starting_time + i when no timestamps", () => {
      expect(seriesSampleTimes(null, 0, 3)).toEqual([0, 1, 2]);
      expect(seriesSampleTimes(undefined, 5, 2)).toEqual([5, 6]);
    });
    it("defaults starting_time to 0 when absent", () => {
      expect(seriesSampleTimes(null, undefined, 3)).toEqual([0, 1, 2]);
    });
    it("returns [] for an empty series", () => {
      expect(seriesSampleTimes([], undefined, 0)).toEqual([]);
      expect(seriesSampleTimes(null, 0, 0)).toEqual([]);
    });
  });

  describe("resolveTrackFrameIndices", () => {
    it("preserves real integer frame numbers, gaps and all", () => {
      // times ARE frame indices → keep them (better than positional 0,1,2).
      expect(resolveTrackFrameIndices([0, 1, 2])).toEqual([0, 1, 2]);
      expect(resolveTrackFrameIndices([1, 60])).toEqual([1, 60]);
      expect(resolveTrackFrameIndices([0, 40, 80])).toEqual([0, 40, 80]);
    });
    it("rounds near-integer times to their frame", () => {
      expect(resolveTrackFrameIndices([0.9, 4.1])).toEqual([1, 4]);
    });
    it("falls back to positional indices when rounding collides", () => {
      // sub-frame seconds (0.0, 0.3 both round to 0) → don't stack; go positional.
      expect(resolveTrackFrameIndices([0, 0.3])).toEqual([0, 1]);
      expect(resolveTrackFrameIndices([0, 0.3, 0.6, 0.9])).toEqual([
        0, 1, 2, 3,
      ]);
    });
    it("keeps distinct-after-rounding seconds without collapsing", () => {
      // 0, 2.67, 5.33 round to 0,3,5 (distinct) → kept, not positional.
      expect(resolveTrackFrameIndices([0, 2.67, 5.33])).toEqual([0, 3, 5]);
    });
    it("handles empty + single", () => {
      expect(resolveTrackFrameIndices([])).toEqual([]);
      expect(resolveTrackFrameIndices([7])).toEqual([7]);
    });
  });
});

describe("NWB format detection (isNwbFile)", () => {
  it("returns true for a real NWB pose file", async () => {
    expect(await isNwbFile(minimalNwb)).toBe(true);
  });
  it("returns false for a missing file", async () => {
    const missing = path.join(os.tmpdir(), "definitely-not-there-xyz.nwb");
    expect(await isNwbFile(missing)).toBe(false);
  });
  it("returns false for a non-HDF5 garbage file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nwb-"));
    const txt = path.join(tmp, "garbage.txt");
    fs.writeFileSync(txt, "not an hdf5 file");
    expect(await isNwbFile(txt)).toBe(false);
  });
});

describe("NWB predictions import — known-answer fixture", () => {
  it("recovers skeleton nodes and the single A-B edge", async () => {
    const labels = await loadNwb(minimalNwb);
    expect(labels.skeletons.length).toBe(1);
    const sk = labels.skeletons[0];
    expect(sk.nodeNames).toEqual(["A", "B"]);
    expect(sk.edges.length).toBe(1);
    expect([sk.edges[0].source.name, sk.edges[0].destination.name]).toEqual([
      "A",
      "B",
    ]);
  });

  it("recovers both tracks named '1' and '2'", async () => {
    const labels = await loadNwb(minimalNwb);
    const names = labels.tracks.map((t) => t.name).sort();
    expect(names).toEqual(["1", "2"]);
  });

  it("recovers the video filename", async () => {
    const labels = await loadNwb(minimalNwb);
    expect(labels.videos.length).toBe(1);
    expect(labels.videos[0].filename).toBe("/data/minimal.mp4");
  });

  it("recovers integer frame indices 0, 1, 2", async () => {
    const labels = await loadNwb(minimalNwb);
    const idxs = labels.labeledFrames
      .map((lf) => lf.frameIdx)
      .sort((a, b) => a - b);
    expect(idxs).toEqual([0, 1, 2]);
  });

  it("has 2 instances at frames 0 and 1, and 1 instance at frame 2", async () => {
    const labels = await loadNwb(minimalNwb);
    expect(frameAt(labels, 0)!.instances.length).toBe(2);
    expect(frameAt(labels, 1)!.instances.length).toBe(2);
    expect(frameAt(labels, 2)!.instances.length).toBe(1);
  });

  it("track '1' has both nodes visible; track '2' has node B = NaN", async () => {
    const labels = await loadNwb(minimalNwb);
    const f0 = frameAt(labels, 0)!;

    const t1 = instanceForTrack(f0, "1")!;
    const t1xy = (t1 as unknown as { numpy(): number[][] }).numpy();
    expect(t1xy[0][0]).toBeCloseTo(10);
    expect(t1xy[0][1]).toBeCloseTo(20);
    expect(t1xy[1][0]).toBeCloseTo(30);
    expect(t1xy[1][1]).toBeCloseTo(40);

    const t2 = instanceForTrack(f0, "2")!;
    const t2xy = (t2 as unknown as { numpy(): number[][] }).numpy();
    expect(t2xy[0][0]).toBeCloseTo(50);
    expect(t2xy[0][1]).toBeCloseTo(60);
    expect(Number.isNaN(t2xy[1][0])).toBe(true);
    expect(Number.isNaN(t2xy[1][1])).toBe(true);
  });

  it("recovers coordinates at frame 1 for track '1'", async () => {
    const labels = await loadNwb(minimalNwb);
    const f1 = frameAt(labels, 1)!;
    const t1 = instanceForTrack(f1, "1")!;
    const xy = (t1 as unknown as { numpy(): number[][] }).numpy();
    expect(xy[0][0]).toBeCloseTo(11);
    expect(xy[0][1]).toBeCloseTo(21);
  });

  it("produces PredictedInstances", async () => {
    const labels = await loadNwb(minimalNwb);
    const f0 = frameAt(labels, 0)!;
    expect(f0.predictedInstances.length).toBe(2);
  });

  it("readNwb throws for a file with no recognized pose data", async () => {
    // A valid Analysis-H5 file is HDF5 but has no PoseEstimation groups.
    const slp = path.join(fixtureRoot, "slp", "typical.slp");
    if (fs.existsSync(slp)) {
      await expect(readNwb(slp)).rejects.toThrow(/pose data/i);
    }
  });
});
