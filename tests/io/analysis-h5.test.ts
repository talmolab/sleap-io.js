/**
 * Tests for SLEAP Analysis HDF5 I/O.
 *
 * Two complementary layers:
 *  (A) Mirror of the Python suite `tests/io/test_analysis_h5.py`
 *      (TestFormatDetection, TestWriteLabels, TestReadLabels, TestRoundTrip,
 *      TestMainAPI, TestEdgeCases) adapted to the JS API.
 *  (B) Differential validation: load each Python-generated fixture under
 *      `tests/data/analysis-h5` and compare against its `<name>.expected.json`
 *      sidecar (schema documented in the differential section below).
 *
 * SKIPPED Python cases (require a real decodable video with a frame-gap, which
 * we do not have as a JS fixture):
 *  - test_write_spans_full_video           (needs Video length > last labeled)
 *  - test_write_spans_full_video_all_frames_false
 * Both depend on `len(video)` being known from a real backend; the JS Video
 * built here has no backend, so its frame count is unknown and the codec sizes
 * the frame axis to the last labeled frame. These are exercised in Python.
 */
import { describe, it, expect } from "../bun-test";
import {
  loadAnalysisH5,
  saveAnalysisH5,
  isAnalysisH5File,
} from "../../src/io/main.js";
import {
  readLabels as readAnalysisH5,
  writeLabels as writeAnalysisH5,
} from "../../src/io/analysis-h5.js";
import { openH5File } from "../../src/codecs/slp/h5.js";
import { Labels } from "../../src/model/labels.js";
import {
  Instance,
  PredictedInstance,
  Track,
} from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// =============================================================================
// Helpers
// =============================================================================

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const analysisDir = path.join(fixtureRoot, "analysis-h5");
const slpDir = path.join(fixtureRoot, "slp");

/** Create a unique temp directory for a test; caller removes it in `finally`. */
function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "analysis-h5-"));
}

/**
 * Parse a value that may be the JSON string "NaN" into a real number.
 * Expected-JSON encodes missing coordinates/scores as the string "NaN".
 */
function parseMaybeNaN(v: unknown): number {
  if (v === "NaN" || v === null || v === undefined) return NaN;
  return typeof v === "number" ? v : Number(v);
}

/** True if a and b are equal within atol, treating NaN-vs-NaN as equal. */
function allclose(a: number, b: number, atol = 1e-6): boolean {
  const an = Number.isNaN(a);
  const bn = Number.isNaN(b);
  if (an || bn) return an && bn; // NaN == NaN, but NaN != number
  return Math.abs(a - b) <= atol;
}

/** Assert two flat numeric arrays are allclose (NaN==NaN). */
function expectArraysClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  atol = 1e-6,
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (!allclose(actual[i], expected[i], atol)) {
      throw new Error(
        `arrays differ at index ${i}: actual=${actual[i]} expected=${expected[i]}`,
      );
    }
  }
}

/** Decode an h5wasm shape (number|bigint dims) to a plain number[]. */
function shapeOf(ds: { shape?: ArrayLike<number | bigint> } | null): number[] {
  if (!ds || !ds.shape) return [];
  return Array.from(ds.shape, (s) => Number(s));
}

/** Read a dataset's `dims` attribute (stored as a JSON-array string). */
function dimsOf(ds: { attrs?: Record<string, unknown> } | null): string[] {
  if (!ds || !ds.attrs || !("dims" in ds.attrs)) return [];
  let raw: unknown = ds.attrs["dims"];
  if (raw != null && typeof raw === "object" && "value" in (raw as object)) {
    raw = (raw as { value: unknown }).value;
  }
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  let s: string;
  if (typeof raw === "string") s = raw;
  else if (raw instanceof Uint8Array) s = new TextDecoder().decode(raw);
  else s = String(raw);
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
  } catch {
    /* not JSON */
  }
  return [];
}

/** Read a root file-level string attribute, decoding bytes if needed. */
function rootAttrString(
  file: { attrs?: Record<string, unknown> },
  name: string,
): string | undefined {
  const attrs = file.attrs;
  if (!attrs || !(name in attrs)) return undefined;
  let raw: unknown = attrs[name];
  if (raw != null && typeof raw === "object" && "value" in (raw as object)) {
    raw = (raw as { value: unknown }).value;
  }
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : "";
  return String(raw);
}

/** Decode a scalar string dataset value. */
function scalarString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
  if (Array.isArray(v)) return v.length ? scalarString(v[0]) : "";
  return String(v);
}

/** Decode a string-array dataset value. */
function stringArray(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (v instanceof Uint8Array) return [new TextDecoder().decode(v)];
  if (Array.isArray(v)) return v.map((x) => scalarString(x));
  if (typeof (v as { length?: number }).length === "number") {
    return Array.from(v as ArrayLike<unknown>).map((x) => scalarString(x));
  }
  return [scalarString(v)];
}

// Skeleton builders mirroring the Python fixtures.
function simpleSkeleton(): Skeleton {
  return new Skeleton({
    nodes: ["head", "tail"],
    edges: [["head", "tail"]],
    name: "simple",
  });
}

function complexSkeleton(): Skeleton {
  const skel = new Skeleton({
    nodes: ["nose", "left_ear", "right_ear", "tail"],
    edges: [
      ["nose", "left_ear"],
      ["nose", "right_ear"],
      ["nose", "tail"],
    ],
    name: "mouse",
  });
  skel.addSymmetry("left_ear", "right_ear");
  return skel;
}

// Labels builders mirroring the Python fixtures.
function simpleLabels(): Labels {
  const skel = simpleSkeleton();
  const video = new Video({ filename: "video.mp4" });
  const track = new Track("animal1");
  const frames: LabeledFrame[] = [];
  for (let i = 0; i < 3; i++) {
    // Per-point scores are carried as the 3rd column of pointsData
    // ([x, y, score]); the model has no separate point-scores option.
    const inst = PredictedInstance.fromNumpy({
      pointsData: [
        [100.0 + i, 200.0 + i, 0.9],
        [150.0 + i, 250.0 + i, 0.85],
      ],
      skeleton: skel,
      score: 0.95,
      track,
      trackingScore: 0.88,
    });
    frames.push(new LabeledFrame({ video, frameIdx: i, instances: [inst] }));
  }
  return new Labels({
    labeledFrames: frames,
    videos: [video],
    skeletons: [skel],
    tracks: [track],
  });
}

function multiAnimalLabels(): Labels {
  const skel = simpleSkeleton();
  const video = new Video({ filename: "video.mp4" });
  const track1 = new Track("animal1");
  const track2 = new Track("animal2");
  const frames: LabeledFrame[] = [];
  for (let i = 0; i < 3; i++) {
    const inst1 = PredictedInstance.fromNumpy({
      pointsData: [
        [100.0 + i, 200.0 + i, 0.9],
        [150.0 + i, 250.0 + i, 0.85],
      ],
      skeleton: skel,
      score: 0.95,
      track: track1,
    });
    const inst2 = PredictedInstance.fromNumpy({
      pointsData: [
        [300.0 + i, 400.0 + i, 0.88],
        [350.0 + i, 450.0 + i, 0.82],
      ],
      skeleton: skel,
      score: 0.92,
      track: track2,
    });
    frames.push(
      new LabeledFrame({ video, frameIdx: i, instances: [inst1, inst2] }),
    );
  }
  return new Labels({
    labeledFrames: frames,
    videos: [video],
    skeletons: [skel],
    tracks: [track1, track2],
  });
}

function sparseLabels(): Labels {
  const skel = simpleSkeleton();
  const video = new Video({ filename: "video.mp4" });
  const track1 = new Track("animal1");
  const track2 = new Track("animal2");
  const track3 = new Track("spurious"); // low-occupancy track
  const frames: LabeledFrame[] = [];

  // Frame 0: all three tracks.
  frames.push(
    new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [
        PredictedInstance.fromNumpy({
          pointsData: [
            [100.0, 200.0, 0.9],
            [150.0, 250.0, 0.85],
          ],
          skeleton: skel,
          score: 0.95,
          track: track1,
        }),
        PredictedInstance.fromNumpy({
          pointsData: [
            [300.0, 400.0, 0.88],
            [350.0, 450.0, 0.82],
          ],
          skeleton: skel,
          score: 0.92,
          track: track2,
        }),
        PredictedInstance.fromNumpy({
          pointsData: [
            [500.0, 600.0, 0.5],
            [550.0, 650.0, 0.5],
          ],
          skeleton: skel,
          score: 0.5,
          track: track3,
        }),
      ],
    }),
  );

  // Frames 1-9: only track1 and track2.
  for (let i = 1; i < 10; i++) {
    frames.push(
      new LabeledFrame({
        video,
        frameIdx: i,
        instances: [
          PredictedInstance.fromNumpy({
            pointsData: [
              [100.0 + i, 200.0 + i, 0.9],
              [150.0 + i, 250.0 + i, 0.85],
            ],
            skeleton: skel,
            score: 0.95,
            track: track1,
          }),
          PredictedInstance.fromNumpy({
            pointsData: [
              [300.0 + i, 400.0 + i, 0.88],
              [350.0 + i, 450.0 + i, 0.82],
            ],
            skeleton: skel,
            score: 0.92,
            track: track2,
          }),
        ],
      }),
    );
  }

  return new Labels({
    labeledFrames: frames,
    videos: [video],
    skeletons: [skel],
    tracks: [track1, track2, track3],
  });
}

// =============================================================================
// 1. Format detection (mirror TestFormatDetection)
// =============================================================================

describe("Analysis HDF5 format detection", () => {
  it("detects a valid Analysis HDF5 fixture", async () => {
    const h5 = path.join(analysisDir, "simple_matlab.analysis.h5");
    expect(await isAnalysisH5File(h5)).toBe(true);
  });

  it("returns false for a non-analysis HDF5 (.slp lacks track_occupancy)", async () => {
    const slp = path.join(slpDir, "typical.slp");
    expect(await isAnalysisH5File(slp)).toBe(false);
  });

  it("returns false for a garbage (non-HDF5) file", async () => {
    // Mirror of Python's test_is_analysis_h5_file_invalid, which writes a .txt
    // file. We write garbage bytes to a temp path; the node h5 provider opens
    // by path, so this exercises the real "not an HDF5 file" failure branch.
    const tmp = mkTmp();
    try {
      const txt = path.join(tmp, "garbage.txt");
      fs.writeFileSync(txt, "not an hdf5 file");
      expect(await isAnalysisH5File(txt)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns false for a non-existent file", async () => {
    // Mirror of Python's test_is_analysis_h5_file_nonexistent.
    const missing = path.join(os.tmpdir(), "definitely-does-not-exist-xyz.h5");
    expect(await isAnalysisH5File(missing)).toBe(false);
  });
});

// =============================================================================
// 2. Write (JS write -> open with openH5File -> assert shapes/dims/attrs)
//    Mirror of TestWriteLabels.
// =============================================================================

describe("Analysis HDF5 write", () => {
  it("writes matlab tracks shape (n_tracks,2,n_nodes,n_frames) & dims", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "matlab.analysis.h5");
      await writeAnalysisH5(multiAnimalLabels(), out, { preset: "matlab" });
      const { file, close } = await openH5File(out);
      try {
        const tracks = file.get("tracks") as never;
        // 3 frames, 2 tracks, 2 nodes -> matlab (track, xy, node, frame)
        expect(shapeOf(tracks)).toEqual([2, 2, 2, 3]);
        expect(dimsOf(tracks)).toEqual(["track", "xy", "node", "frame"]);
        expect(rootAttrString(file as never, "preset")).toBe("matlab");
        expect(rootAttrString(file as never, "format")).toBe("analysis");
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes standard tracks shape (n_frames,n_tracks,n_nodes,2) & dims", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "standard.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out, { preset: "standard" });
      const { file, close } = await openH5File(out);
      try {
        const tracks = file.get("tracks") as never;
        expect(shapeOf(tracks)).toEqual([3, 1, 2, 2]);
        expect(dimsOf(tracks)).toEqual(["frame", "track", "node", "xy"]);
        expect(rootAttrString(file as never, "preset")).toBe("standard");
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes custom explicit dims (node, frame, track, xy)", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "custom.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out, {
        frameDim: 1,
        trackDim: 2,
        nodeDim: 0,
        xyDim: 3,
      });
      const { file, close } = await openH5File(out);
      try {
        const tracks = file.get("tracks") as never;
        // (node, frame, track, xy) -> (2, 3, 1, 2)
        expect(shapeOf(tracks)).toEqual([2, 3, 1, 2]);
        expect(dimsOf(tracks)).toEqual(["node", "frame", "track", "xy"]);
        expect(rootAttrString(file as never, "preset")).toBe("custom");
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("track_occupancy dims are ALWAYS [frame, track] (matlab quirk + standard)", async () => {
    const tmp = mkTmp();
    try {
      // matlab
      const outM = path.join(tmp, "occ_matlab.analysis.h5");
      await writeAnalysisH5(multiAnimalLabels(), outM, { preset: "matlab" });
      {
        const { file, close } = await openH5File(outM);
        try {
          const occ = file.get("track_occupancy") as never;
          expect(dimsOf(occ)).toEqual(["frame", "track"]);
          // SLEAP quirk: stored as (frames, tracks) even in matlab.
          expect(shapeOf(occ)).toEqual([3, 2]);
        } finally {
          close();
        }
      }
      // standard
      const outS = path.join(tmp, "occ_standard.analysis.h5");
      await writeAnalysisH5(simpleLabels(), outS, { preset: "standard" });
      {
        const { file, close } = await openH5File(outS);
        try {
          const occ = file.get("track_occupancy") as never;
          expect(dimsOf(occ)).toEqual(["frame", "track"]);
        } finally {
          close();
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("score-array dims per preset (matlab)", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "dims_matlab.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out, { preset: "matlab" });
      const { file, close } = await openH5File(out);
      try {
        expect(dimsOf(file.get("tracks") as never)).toEqual([
          "track",
          "xy",
          "node",
          "frame",
        ]);
        expect(dimsOf(file.get("track_occupancy") as never)).toEqual([
          "frame",
          "track",
        ]);
        expect(dimsOf(file.get("point_scores") as never)).toEqual([
          "track",
          "node",
          "frame",
        ]);
        expect(dimsOf(file.get("instance_scores") as never)).toEqual([
          "track",
          "frame",
        ]);
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("matlab shapes exactly match SLEAP reference", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "sleap_compat.analysis.h5");
      await writeAnalysisH5(multiAnimalLabels(), out, { preset: "matlab" });
      const nFrames = 3,
        nTracks = 2,
        nNodes = 2;
      const { file, close } = await openH5File(out);
      try {
        expect(shapeOf(file.get("tracks") as never)).toEqual([
          nTracks,
          2,
          nNodes,
          nFrames,
        ]);
        expect(shapeOf(file.get("track_occupancy") as never)).toEqual([
          nFrames,
          nTracks,
        ]); // SLEAP quirk
        expect(shapeOf(file.get("point_scores") as never)).toEqual([
          nTracks,
          nNodes,
          nFrames,
        ]);
        expect(shapeOf(file.get("instance_scores") as never)).toEqual([
          nTracks,
          nFrames,
        ]);
        expect(shapeOf(file.get("tracking_scores") as never)).toEqual([
          nTracks,
          nFrames,
        ]);
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("score-array dims per preset (standard)", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "dims_standard.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out, { preset: "standard" });
      const { file, close } = await openH5File(out);
      try {
        expect(dimsOf(file.get("tracks") as never)).toEqual([
          "frame",
          "track",
          "node",
          "xy",
        ]);
        expect(dimsOf(file.get("track_occupancy") as never)).toEqual([
          "frame",
          "track",
        ]);
        expect(dimsOf(file.get("point_scores") as never)).toEqual([
          "frame",
          "track",
          "node",
        ]);
        expect(dimsOf(file.get("instance_scores") as never)).toEqual([
          "frame",
          "track",
        ]);
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("min_occupancy filtering reduces track_names", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "filtered.analysis.h5");
      await writeAnalysisH5(sparseLabels(), out, { minOccupancy: 0.5 });
      const { file, close } = await openH5File(out);
      try {
        const names = stringArray((file.get("track_names") as never).value);
        expect(names.length).toBe(2);
        expect(names).not.toContain("spurious");
        expect(names).toContain("animal1");
        expect(names).toContain("animal2");
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes labels_path metadata", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "with_path.analysis.h5");
      const source = "/path/to/source.slp";
      await writeAnalysisH5(simpleLabels(), out, { labelsPath: source });
      const { file, close } = await openH5File(out);
      try {
        expect(scalarString((file.get("labels_path") as never).value)).toBe(
          source,
        );
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes skeleton symmetries metadata", async () => {
    const tmp = mkTmp();
    try {
      const skel = complexSkeleton();
      const video = new Video({ filename: "video.mp4" });
      const track = new Track("animal1");
      const inst = PredictedInstance.fromNumpy({
        pointsData: [
          [10, 20, 0.9],
          [30, 40, 0.85],
          [50, 60, 0.88],
          [70, 80, 0.92],
        ],
        skeleton: skel,
        score: 0.95,
        track,
      });
      const labels = new Labels({
        labeledFrames: [
          new LabeledFrame({ video, frameIdx: 0, instances: [inst] }),
        ],
        videos: [video],
        skeletons: [skel],
        tracks: [track],
      });
      const out = path.join(tmp, "symmetries.analysis.h5");
      await writeAnalysisH5(labels, out);
      const { file, close } = await openH5File(out);
      try {
        const symRaw = rootAttrString(file as never, "skeleton_symmetries");
        expect(symRaw).toBeDefined();
        const syms = JSON.parse(symRaw as string) as string[][];
        expect(syms.length).toBe(1);
        expect(new Set(syms[0])).toEqual(new Set(["left_ear", "right_ear"]));
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes extended metadata when saveMetadata=true", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "metadata.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out, { saveMetadata: true });
      const { file, close } = await openH5File(out);
      try {
        expect(rootAttrString(file as never, "format")).toBe("analysis");
        expect(rootAttrString(file as never, "skeleton_name")).toBe("simple");
        expect(
          rootAttrString(file as never, "skeleton_symmetries"),
        ).toBeDefined();
        expect(
          rootAttrString(file as never, "video_backend_metadata"),
        ).toBeDefined();
        expect(rootAttrString(file as never, "sleap_io_version")).toBeDefined();
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("omits extended metadata when saveMetadata=false (format/preset still present)", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "no_metadata.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out, { saveMetadata: false });
      const { file, close } = await openH5File(out);
      try {
        expect(rootAttrString(file as never, "format")).toBe("analysis");
        expect(rootAttrString(file as never, "preset")).toBe("matlab");
        expect(rootAttrString(file as never, "skeleton_name")).toBeUndefined();
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when preset and explicit dims are both given", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "err.analysis.h5");
      await expect(
        writeAnalysisH5(simpleLabels(), out, {
          preset: "matlab",
          frameDim: 0,
          trackDim: 1,
          nodeDim: 2,
          xyDim: 3,
        }),
      ).rejects.toThrow(/Cannot specify both/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when explicit dims are incomplete", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "err.analysis.h5");
      await expect(
        writeAnalysisH5(simpleLabels(), out, {
          frameDim: 0,
          trackDim: 1,
        }),
      ).rejects.toThrow(/all four must be specified/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when explicit dims are not a permutation of [0,1,2,3]", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "err.analysis.h5");
      await expect(
        writeAnalysisH5(simpleLabels(), out, {
          frameDim: 0,
          trackDim: 0, // duplicate
          nodeDim: 2,
          xyDim: 3,
        }),
      ).rejects.toThrow(/permutation of/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws on an invalid preset", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "err.analysis.h5");
      await expect(
        writeAnalysisH5(simpleLabels(), out, { preset: "invalid" }),
      ).rejects.toThrow(/Unknown preset/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws on empty labels (no labeled frames)", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "empty.analysis.h5");
      const skel = simpleSkeleton();
      const video = new Video({ filename: "video.mp4" });
      const labels = new Labels({
        labeledFrames: [],
        videos: [video],
        skeletons: [skel],
        tracks: [],
      });
      await expect(writeAnalysisH5(labels, out)).rejects.toThrow(
        /No labeled frames/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 3. Read + round-trip (JS write to tmp -> loadAnalysisH5 -> assert)
//    Mirror of TestReadLabels + TestRoundTrip.
// =============================================================================

describe("Analysis HDF5 read + round-trip", () => {
  it("reads basic frame/track counts and track name", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "basic.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.labeledFrames.length).toBe(3);
      expect(loaded.tracks.length).toBe(1);
      expect(loaded.tracks[0].name).toBe("animal1");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads multiple animals", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "multi.analysis.h5");
      await writeAnalysisH5(multiAnimalLabels(), out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.labeledFrames.length).toBe(3);
      expect(loaded.tracks.length).toBe(2);
      const names = loaded.tracks.map((t) => t.name);
      expect(names).toContain("animal1");
      expect(names).toContain("animal2");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reconstructs the skeleton (nodes, edges, name)", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "skel.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.skeletons.length).toBe(1);
      const skel = loaded.skeletons[0];
      expect(skel.nodeNames).toEqual(["head", "tail"]);
      expect(skel.edges.length).toBe(1);
      expect(skel.name).toBe("simple");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reconstructs skeleton symmetries", async () => {
    const tmp = mkTmp();
    try {
      const skel = complexSkeleton();
      const video = new Video({ filename: "video.mp4" });
      const track = new Track("animal1");
      const inst = PredictedInstance.fromNumpy({
        pointsData: [
          [10, 20, 0.9],
          [30, 40, 0.85],
          [50, 60, 0.88],
          [70, 80, 0.92],
        ],
        skeleton: skel,
        score: 0.95,
        track,
      });
      const labels = new Labels({
        labeledFrames: [
          new LabeledFrame({ video, frameIdx: 0, instances: [inst] }),
        ],
        videos: [video],
        skeletons: [skel],
        tracks: [track],
      });
      const out = path.join(tmp, "symmetries.analysis.h5");
      await writeAnalysisH5(labels, out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.skeletons[0].symmetries.length).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("honors a custom video path override", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "custom_video.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out);
      const custom = path.join(tmp, "custom_video.mp4");
      const loaded = await loadAnalysisH5(out, { video: custom });
      expect(loaded.videos[0].filename).toBe(custom);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("honors a custom Video object override", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "custom_videoobj.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out);
      const custom = new Video({
        filename: path.join(tmp, "custom_video.mp4"),
      });
      const loaded = await loadAnalysisH5(out, { video: custom });
      expect(loaded.videos[0].filename).toBe(custom.filename);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads point scores and instance score", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "scores.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out);
      const loaded = await readAnalysisH5(out);
      const inst = loaded.labeledFrames[0].instances[0];
      expect(inst).toBeInstanceOf(PredictedInstance);
      const pred = inst as PredictedInstance;
      expect(pred.score).toBeDefined();
      expect(pred.score).toBeCloseTo(0.95, 6);
      // Point scores present and finite.
      const withScores = pred.numpy({ scores: true });
      expect(withScores[0][2]).toBeCloseTo(0.9, 6);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads tracking score", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "tracking.analysis.h5");
      await writeAnalysisH5(simpleLabels(), out);
      const loaded = await readAnalysisH5(out);
      const inst = loaded.labeledFrames[0].instances[0] as PredictedInstance;
      expect(inst.trackingScore).toBeCloseTo(0.88, 6);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("round-trips point coords (matlab preset)", async () => {
    const tmp = mkTmp();
    try {
      const labels = simpleLabels();
      const out = path.join(tmp, "rt_matlab.analysis.h5");
      await writeAnalysisH5(labels, out, { preset: "matlab" });
      const loaded = await readAnalysisH5(out);
      const orig = labels.labeledFrames[0].instances[0].numpy().flat();
      const got = loaded.labeledFrames[0].instances[0].numpy().flat();
      expectArraysClose(got, orig);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("round-trips point coords (standard preset) and frame count", async () => {
    const tmp = mkTmp();
    try {
      const labels = simpleLabels();
      const out = path.join(tmp, "rt_standard.analysis.h5");
      await writeAnalysisH5(labels, out, { preset: "standard" });
      const loaded = await readAnalysisH5(out);
      const orig = labels.labeledFrames[0].instances[0].numpy().flat();
      const got = loaded.labeledFrames[0].instances[0].numpy().flat();
      expectArraysClose(got, orig);
      expect(loaded.labeledFrames.length).toBe(labels.labeledFrames.length);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("round-trips point coords with custom dims", async () => {
    const tmp = mkTmp();
    try {
      const labels = simpleLabels();
      const out = path.join(tmp, "rt_custom.analysis.h5");
      await writeAnalysisH5(labels, out, {
        frameDim: 2,
        trackDim: 0,
        nodeDim: 3,
        xyDim: 1,
      });
      const loaded = await readAnalysisH5(out);
      const orig = labels.labeledFrames[0].instances[0].numpy().flat();
      const got = loaded.labeledFrames[0].instances[0].numpy().flat();
      expectArraysClose(got, orig);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("round-trips multiple animals", async () => {
    const tmp = mkTmp();
    try {
      const labels = multiAnimalLabels();
      const out = path.join(tmp, "rt_multi.analysis.h5");
      await writeAnalysisH5(labels, out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.labeledFrames.length).toBe(labels.labeledFrames.length);
      expect(loaded.tracks.length).toBe(labels.tracks.length);
      for (let i = 0; i < labels.labeledFrames[0].instances.length; i++) {
        const orig = labels.labeledFrames[0].instances[i].numpy().flat();
        const got = loaded.labeledFrames[0].instances[i].numpy().flat();
        expectArraysClose(got, orig);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("round-trips provenance", async () => {
    const tmp = mkTmp();
    try {
      const labels = simpleLabels();
      labels.provenance["source"] = "test";
      labels.provenance["version"] = "1.0";
      const out = path.join(tmp, "provenance.analysis.h5");
      await writeAnalysisH5(labels, out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.provenance["source"]).toBe("test");
      expect(loaded.provenance["version"]).toBe("1.0");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 4. Main API integration (mirror TestMainAPI)
// =============================================================================

describe("Analysis HDF5 main API", () => {
  it("saveAnalysisH5 + loadAnalysisH5 round-trips frame count", async () => {
    const tmp = mkTmp();
    try {
      const labels = simpleLabels();
      const out = path.join(tmp, "api.analysis.h5");
      await saveAnalysisH5(labels, out);
      const loaded = await loadAnalysisH5(out);
      expect(loaded.labeledFrames.length).toBe(labels.labeledFrames.length);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("saveAnalysisH5 honors the preset option", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "api_preset.analysis.h5");
      await saveAnalysisH5(simpleLabels(), out, { preset: "standard" });
      const loaded = await loadAnalysisH5(out);
      expect(loaded.labeledFrames.length).toBe(3);
      const { file, close } = await openH5File(out);
      try {
        expect(rootAttrString(file as never, "preset")).toBe("standard");
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("isAnalysisH5File detects a saved file", async () => {
    const tmp = mkTmp();
    try {
      const out = path.join(tmp, "detect.h5");
      await saveAnalysisH5(simpleLabels(), out);
      expect(await isAnalysisH5File(out)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 5. Edge cases (mirror TestEdgeCases)
// =============================================================================

describe("Analysis HDF5 edge cases", () => {
  it("single untracked instance exports exactly one track slot", async () => {
    const tmp = mkTmp();
    try {
      const skel = simpleSkeleton();
      const video = new Video({ filename: "video.mp4" });
      const frames: LabeledFrame[] = [];
      for (let i = 0; i < 3; i++) {
        const inst = PredictedInstance.fromNumpy({
          pointsData: [
            [100.0 + i, 200.0 + i, 0.9],
            [150.0 + i, 250.0 + i, 0.85],
          ],
          skeleton: skel,
          score: 0.95,
        });
        frames.push(
          new LabeledFrame({ video, frameIdx: i, instances: [inst] }),
        );
      }
      const labels = new Labels({
        labeledFrames: frames,
        videos: [video],
        skeletons: [skel],
        tracks: [],
      });
      const out = path.join(tmp, "untracked_single.analysis.h5");
      await writeAnalysisH5(labels, out, { preset: "standard" });
      const { file, close } = await openH5File(out);
      try {
        expect(shapeOf(file.get("tracks") as never)).toEqual([3, 1, 2, 2]);
        expect(stringArray((file.get("track_names") as never).value)).toEqual([
          "track_0",
        ]);
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("untracked multi-animal keeps both instances on round-trip", async () => {
    const tmp = mkTmp();
    try {
      const skel = simpleSkeleton();
      const video = new Video({ filename: "video.mp4" });
      const frames: LabeledFrame[] = [];
      for (let i = 0; i < 5; i++) {
        const inst1 = PredictedInstance.fromNumpy({
          pointsData: [
            [10.0 + i, 20.0 + i, 0.9],
            [30.0 + i, 40.0 + i, 0.85],
          ],
          skeleton: skel,
          score: 0.95,
        });
        const inst2 = PredictedInstance.fromNumpy({
          pointsData: [
            [100.0 + i, 200.0 + i, 0.8],
            [300.0 + i, 400.0 + i, 0.75],
          ],
          skeleton: skel,
          score: 0.9,
        });
        frames.push(
          new LabeledFrame({ video, frameIdx: i, instances: [inst1, inst2] }),
        );
      }
      const labels = new Labels({
        labeledFrames: frames,
        videos: [video],
        skeletons: [skel],
        tracks: [],
      });

      for (const [preset, expectedShape] of [
        ["matlab", [2, 2, 2, 5]],
        ["standard", [5, 2, 2, 2]],
      ] as Array<[string, number[]]>) {
        const out = path.join(tmp, `untracked_multi_${preset}.analysis.h5`);
        await writeAnalysisH5(labels, out, { preset });
        const { file, close } = await openH5File(out);
        try {
          expect(shapeOf(file.get("tracks") as never)).toEqual(expectedShape);
          expect(stringArray((file.get("track_names") as never).value)).toEqual(
            ["track_0", "track_1"],
          );
        } finally {
          close();
        }
        const loaded = await readAnalysisH5(out);
        expect(loaded.labeledFrames.length).toBe(5);
        for (let i = 0; i < 5; i++) {
          expect(loaded.labeledFrames[i].instances.length).toBe(2);
          expectArraysClose(
            loaded.labeledFrames[i].instances[0].numpy().flat(),
            frames[i].instances[0].numpy().flat(),
          );
          expectArraysClose(
            loaded.labeledFrames[i].instances[1].numpy().flat(),
            frames[i].instances[1].numpy().flat(),
          );
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles a single frame at index 5", async () => {
    const tmp = mkTmp();
    try {
      const skel = simpleSkeleton();
      const video = new Video({ filename: "video.mp4" });
      const track = new Track("animal1");
      const inst = PredictedInstance.fromNumpy({
        pointsData: [
          [100.0, 200.0, 0.9],
          [150.0, 250.0, 0.85],
        ],
        skeleton: skel,
        score: 0.95,
        track,
      });
      const labels = new Labels({
        labeledFrames: [
          new LabeledFrame({ video, frameIdx: 5, instances: [inst] }),
        ],
        videos: [video],
        skeletons: [skel],
        tracks: [track],
      });
      const out = path.join(tmp, "single.analysis.h5");
      await writeAnalysisH5(labels, out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.labeledFrames.length).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles a skeleton with no edges", async () => {
    const tmp = mkTmp();
    try {
      const skel = new Skeleton({
        nodes: ["point1", "point2"],
        edges: [],
        name: "noedges",
      });
      const video = new Video({ filename: "video.mp4" });
      const track = new Track("animal1");
      const inst = PredictedInstance.fromNumpy({
        pointsData: [
          [100.0, 200.0, 0.9],
          [150.0, 250.0, 0.85],
        ],
        skeleton: skel,
        score: 0.95,
        track,
      });
      const labels = new Labels({
        labeledFrames: [
          new LabeledFrame({ video, frameIdx: 0, instances: [inst] }),
        ],
        videos: [video],
        skeletons: [skel],
        tracks: [track],
      });
      const out = path.join(tmp, "noedges.analysis.h5");
      await writeAnalysisH5(labels, out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.skeletons[0].edges.length).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves a user (non-predicted) instance's points", async () => {
    const tmp = mkTmp();
    try {
      const skel = simpleSkeleton();
      const video = new Video({ filename: "video.mp4" });
      const track = new Track("animal1");
      const userInst = Instance.fromArray(
        [
          [100.0, 200.0],
          [150.0, 250.0],
        ],
        skel,
      );
      userInst.track = track;
      const labels = new Labels({
        labeledFrames: [
          new LabeledFrame({ video, frameIdx: 0, instances: [userInst] }),
        ],
        videos: [video],
        skeletons: [skel],
        tracks: [track],
      });
      const out = path.join(tmp, "user.analysis.h5");
      await writeAnalysisH5(labels, out);
      const loaded = await readAnalysisH5(out);
      expect(loaded.labeledFrames.length).toBe(1);
      const got = loaded.labeledFrames[0].instances[0].numpy();
      // Compare x, y only (reader builds PredictedInstances with scores).
      expectArraysClose(
        [got[0][0], got[0][1], got[1][0], got[1][1]],
        [100.0, 200.0, 150.0, 250.0],
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads legacy files (no dims, transpose=true) from fixtures", async () => {
    const h5 = path.join(analysisDir, "legacy_nodims.analysis.h5");
    const loaded = await readAnalysisH5(h5);
    expect(loaded.labeledFrames.length).toBeGreaterThanOrEqual(1);
  });

  it("loads legacy files (transpose=false) from fixtures", async () => {
    const h5 = path.join(analysisDir, "legacy_transpose_false.analysis.h5");
    const loaded = await readAnalysisH5(h5);
    expect(loaded.labeledFrames.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// 6. Differential validation against Python-generated fixtures (KEY PARITY)
//
//    Expected-JSON schema (per fixture <name>.expected.json):
//      nFrames        : number
//      frameIndices   : number[]
//      trackNames     : string[]            (order matters)
//      nodeNames      : string[]
//      edgeInds       : [number, number][]
//      edgeNames      : [string, string][]
//      symmetries     : [string, string][]  (compared as sorted pairs)
//      skeletonName   : string
//      videoFilename  : string
//      provenance     : object (excluding 'filename', which the reader injects)
//      frames[]       : { frameIdx, instances[] }
//        instances[]  : { points: [[x,y,score]] ("NaN" strings -> NaN),
//                         score, trackingScore, isPredicted }
// =============================================================================

interface ExpectedInstance {
  points: unknown[][];
  score: number | string | null;
  trackingScore: number | string | null;
  isPredicted: boolean;
}
interface ExpectedFrame {
  frameIdx: number;
  instances: ExpectedInstance[];
}
interface Expected {
  nFrames: number;
  frameIndices: number[];
  trackNames: string[];
  nodeNames: string[];
  edgeInds: number[][];
  edgeNames: string[][];
  symmetries: string[][];
  skeletonName: string;
  videoFilename: string;
  provenance: Record<string, unknown>;
  frames: ExpectedFrame[];
}
interface ManifestEntry {
  name: string;
  h5: string;
  expected: string;
  preset: string;
  legacy: boolean;
}

/** Sort a list of [a,b] pairs canonically for order-independent comparison. */
function sortedPairs(pairs: string[][]): string[][] {
  return pairs
    .map((p) => [...p].sort())
    .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(analysisDir, "manifest.json"), "utf-8"),
) as ManifestEntry[];

describe("Analysis HDF5 differential parity with Python fixtures", () => {
  for (const entry of manifest) {
    it(`matches expected for fixture: ${entry.name}`, async () => {
      const h5 = path.join(analysisDir, entry.h5);
      const expected = JSON.parse(
        fs.readFileSync(path.join(analysisDir, entry.expected), "utf-8"),
      ) as Expected;

      const labels = await loadAnalysisH5(h5);

      // --- Frame count + indices. ---
      expect(labels.labeledFrames.length).toBe(expected.nFrames);
      const frameIdxs = labels.labeledFrames.map((lf) => lf.frameIdx);
      expect(frameIdxs).toEqual(expected.frameIndices);

      // --- Track names (order matters). ---
      expect(labels.tracks.map((t) => t.name)).toEqual(expected.trackNames);

      // --- Skeleton structure. ---
      const skel = labels.skeletons[0];
      expect(skel.nodeNames).toEqual(expected.nodeNames);
      expect(skel.edgeIndices.map((p) => [...p])).toEqual(expected.edgeInds);
      const gotEdgeNames = skel.edges.map((e) => [
        e.source.name,
        e.destination.name,
      ]);
      expect(gotEdgeNames).toEqual(expected.edgeNames);
      expect(sortedPairs(skel.symmetryNames)).toEqual(
        sortedPairs(expected.symmetries),
      );
      // Normalize "no name" across both sides: the Python sidecar encodes a
      // missing skeleton name as null, while the JS reader produces an empty
      // string / undefined. Treat all three as equivalent.
      const gotName = skel.name ? skel.name : null;
      const expName = expected.skeletonName ? expected.skeletonName : null;
      expect(gotName).toBe(expName);

      // --- Video filename. ---
      expect(labels.videos[0].filename).toBe(expected.videoFilename);

      // --- Provenance (excluding the reader-injected 'filename'). ---
      const prov = { ...labels.provenance };
      delete (prov as Record<string, unknown>)["filename"];
      expect(prov).toEqual(expected.provenance);

      // --- Per-frame, per-instance comparison. ---
      expect(labels.labeledFrames.length).toBe(expected.frames.length);
      for (let f = 0; f < expected.frames.length; f++) {
        const ef = expected.frames[f];
        const lf = labels.labeledFrames[f];
        expect(lf.frameIdx).toBe(ef.frameIdx);
        expect(lf.instances.length).toBe(ef.instances.length);

        for (let i = 0; i < ef.instances.length; i++) {
          const ei = ef.instances[i];
          const inst = lf.instances[i];

          // isPredicted flag.
          expect(inst instanceof PredictedInstance).toBe(ei.isPredicted);

          // Points: [[x,y,score], ...] with "NaN" strings mapping to NaN.
          const got = inst.numpy({ scores: true });
          expect(got.length).toBe(ei.points.length);
          for (let n = 0; n < ei.points.length; n++) {
            const ep = ei.points[n];
            for (let c = 0; c < ep.length; c++) {
              expect(allclose(got[n][c], parseMaybeNaN(ep[c]))).toBe(true);
            }
          }

          // Instance score.
          if (ei.isPredicted) {
            const pred = inst as PredictedInstance;
            expect(allclose(pred.score ?? NaN, parseMaybeNaN(ei.score))).toBe(
              true,
            );
            // Tracking score. The JS Instance model defaults trackingScore to
            // 0 (not null/NaN); the reader leaves the default in place when the
            // stored value is NaN. So a Python-side `null` (no tracking score)
            // maps to 0 on the JS side. Normalize both to 0 for comparison.
            const expTs =
              ei.trackingScore == null || ei.trackingScore === "NaN"
                ? 0
                : Number(ei.trackingScore);
            const gotTs = pred.trackingScore ?? 0;
            expect(allclose(gotTs, expTs)).toBe(true);
          }
        }
      }
    });
  }
});
