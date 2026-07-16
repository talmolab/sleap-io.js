/**
 * Point-span self-consistency invariant for the SLP writer (luc3d#161).
 *
 * On a real cage5 project written by sleap-io.js, instance point-spans
 * (`point_id_end - point_id_start`) came out as 16 / 17 / 18 for a 17-node
 * skeleton — a ±1 boundary shift that makes the Python `read_instances` raise.
 * These tests lock the invariant across the eager and lazy re-save write paths:
 *
 *   - every instance's span == its skeleton's node count, and
 *   - Σ(user spans) == rows in `points`, Σ(pred spans) == rows in `pred_points`,
 *     with the ranges exactly tiling each dataset (no gaps, no overlaps).
 *
 * The current writers are span-consistent by construction (the eager writer pushes
 * each instance's points contiguously; the streaming/lazy repack preserves input
 * spans), so these pass today and guard against a regression.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import { Instance, PredictedInstance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";

const NODES = ["nose", "neck", "tail"]; // 3-node skeleton
const SK = new Skeleton({ nodes: NODES, edges: [["nose", "neck"]] });

/** Build labels with a mix of user + predicted instances across several frames. */
function makeMixedLabels(): Labels {
  const video = new Video({ filename: "v.mp4" });
  const frames: LabeledFrame[] = [];
  for (let f = 0; f < 5; f++) {
    const instances: (Instance | PredictedInstance)[] = [];
    // Alternate counts per frame so instance_id ranges vary; mix user/predicted.
    const nInst = (f % 3) + 1;
    for (let k = 0; k < nInst; k++) {
      const xy = NODES.map((_, n) => [f * 10 + k, n * 2]) as number[][];
      if ((f + k) % 2 === 0) {
        instances.push(Instance.fromArray(xy, SK));
      } else {
        instances.push(
          PredictedInstance.fromArray(xy, SK, {
            score: 0.5,
            pointScores: NODES.map(() => 0.9),
          }),
        );
      }
    }
    frames.push(new LabeledFrame({ video, frameIdx: f, instances }));
  }
  return new Labels({
    labeledFrames: frames,
    videos: [video],
    skeletons: [SK],
  });
}

/** Read the raw instances / points / pred_points tables from written bytes. */
async function readTables(bytes: Uint8Array): Promise<{
  instances: {
    type: number;
    pointStart: number;
    pointEnd: number;
  }[];
  nPoints: number;
  nPredPoints: number;
}> {
  const { file, close } = await openH5File(bytes.buffer as ArrayBuffer);
  try {
    const readMatrix = (name: string): { flat: number[]; ncols: number } => {
      const ds = file.get(name) as any;
      if (!ds) return { flat: [], ncols: 0 };
      const shape = ds.shape as number[];
      return {
        flat: Array.from((ds.value as ArrayLike<number>) ?? []).map(Number),
        ncols: shape?.[1] ?? 0,
      };
    };
    const inst = readMatrix("instances");
    // instances fields: instance_id, instance_type, frame_id, skeleton, track,
    // from_predicted, score, point_id_start, point_id_end, tracking_score
    const rows: { type: number; pointStart: number; pointEnd: number }[] = [];
    const n = inst.ncols ? inst.flat.length / inst.ncols : 0;
    for (let i = 0; i < n; i++) {
      const b = i * inst.ncols;
      rows.push({
        type: inst.flat[b + 1],
        pointStart: inst.flat[b + 7],
        pointEnd: inst.flat[b + 8],
      });
    }
    const pts = readMatrix("points");
    const pred = readMatrix("pred_points");
    return {
      instances: rows,
      nPoints: pts.ncols ? pts.flat.length / pts.ncols : 0,
      nPredPoints: pred.ncols ? pred.flat.length / pred.ncols : 0,
    };
  } finally {
    close();
  }
}

/** Assert the span invariant on a set of written tables. */
function assertSpanInvariant(tables: {
  instances: { type: number; pointStart: number; pointEnd: number }[];
  nPoints: number;
  nPredPoints: number;
}) {
  const nNodes = NODES.length;
  // Ranges per stream must tile [0, N) exactly (sorted, contiguous, no gaps).
  const userRanges: [number, number][] = [];
  const predRanges: [number, number][] = [];
  for (const r of tables.instances) {
    expect(r.pointEnd - r.pointStart).toBe(nNodes); // every span == node count
    (r.type === 1 ? predRanges : userRanges).push([r.pointStart, r.pointEnd]);
  }
  const checkTiling = (ranges: [number, number][], total: number) => {
    ranges.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [s, e] of ranges) {
      expect(s).toBe(cursor); // no gap, no overlap
      cursor = e;
    }
    expect(cursor).toBe(total); // ranges cover every point row exactly
  };
  checkTiling(userRanges, tables.nPoints);
  checkTiling(predRanges, tables.nPredPoints);
}

describe("SLP writer point-span invariant (luc3d#161)", () => {
  it("eager write: every span == node count and ranges tile points/pred_points", async () => {
    const bytes = new Uint8Array(await saveSlpToBytes(makeMixedLabels()));
    assertSpanInvariant(await readTables(bytes));
  });

  it("lazy re-save preserves the span invariant", async () => {
    const first = new Uint8Array(await saveSlpToBytes(makeMixedLabels()));
    const lazy = await readSlpLazy(first.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const resaved = new Uint8Array(await saveSlpToBytes(lazy));
    assertSpanInvariant(await readTables(resaved));
  });

  it("enforces node-count spans even when an instance holds a mismatched point count", async () => {
    // fromArray does NOT clamp to the skeleton node count (pointsFromArray iterates
    // the input rows), so an instance can hold too few / too many points — exactly
    // the 16/18-vs-17 situation from luc3d#161. The writer must still emit exactly
    // nNodes points so the file stays self-consistent and Python-readable.
    const video = new Video({ filename: "v.mp4" });
    const short = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      SK,
    ); // 2 points for a 3-node skeleton
    const long = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
      ],
      SK,
    ); // 4 points for a 3-node skeleton
    // The in-memory model faithfully holds the mismatched counts...
    expect(short.points.length).toBe(2);
    expect(long.points.length).toBe(4);
    const lf = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [short, long],
    });
    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [SK],
    });
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    // ...but the written file has exactly nNodes points per instance.
    const tables = await readTables(bytes);
    expect(tables.instances).toHaveLength(2);
    assertSpanInvariant(tables);
    expect(tables.nPoints).toBe(2 * NODES.length); // both clamped to 3
  });

  it("2D points round-trip losslessly through an eager read", async () => {
    const labels = makeMixedLabels();
    const bytes = new Uint8Array(await saveSlpToBytes(labels));
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    // Same total instance + point counts (no dropped/duplicated points).
    const origInsts = labels.labeledFrames.reduce(
      (a, f) => a + f.instances.length,
      0,
    );
    const loadedInsts = loaded.labeledFrames.reduce(
      (a, f) => a + f.instances.length,
      0,
    );
    expect(loadedInsts).toBe(origInsts);
    for (const f of loaded.labeledFrames) {
      for (const inst of f.instances) {
        expect(inst.points.length).toBe(NODES.length);
      }
    }
  });
});
