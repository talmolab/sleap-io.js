// In-place label save (edit re-save) tests — mirror the validated reference
// scripts (compound_inplace_test.mjs / real_fixture_test.mjs). Verify that
// writeLabelTablesInPlace patches ONLY the small label tables (value-only via
// write_slice, structural via resize+write_slice) and NEVER the embedded
// `video{i}/video` group or the file's overall size (for value-only edits), on
// BOTH flat (app-written) and compound (Python-written / #218) table layouts.
import { describe, it, expect } from "./bun-test";
import {
  saveSlpToBytes,
  buildLabelTableUpdate,
  buildMetadataJson,
  buildTracksJson,
  buildSuggestionsJson,
  buildVideoSignatures,
  buildExpectedSidecars,
  checkInPlaceWritable,
  onDiskTableFromMeta,
  writeLabelTablesInPlace,
  type LabelTableUpdate,
  type OnDiskTables,
  type OnDiskSidecars,
} from "../src/io/main.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance, Track } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  mkdtempSync,
  statSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { ready, File as H5File } from "h5wasm/node";

// A fresh OS temp dir per run — these tests write real .pkg.slp files to disk
// (h5wasm reopens them from the real filesystem, not MEMFS). Must NOT be a
// hardcoded path: CI runners don't have the author's scratchpad dir.
const SCRATCH = mkdtempSync(path.join(tmpdir(), "sleap-inplace-"));
const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

/** Build a small user-only Labels: 1 skeleton (A,B), 1 video, `nInst` instances
 *  in a single frame, each with 2 points offset by `base`. */
function makeLabels(nInst: number, base = 0): Labels {
  const skeleton = new Skeleton({ name: "s", nodes: ["A", "B"] });
  const video = new Video({ filename: "vid.mp4" });
  const instances: Instance[] = [];
  for (let i = 0; i < nInst; i++) {
    instances.push(
      new Instance({
        skeleton,
        points: [
          {
            xy: [base + i * 10 + 1, base + i * 10 + 2],
            visible: true,
            complete: true,
          },
          {
            xy: [base + i * 10 + 3, base + i * 10 + 4],
            visible: true,
            complete: true,
          },
        ],
      }),
    );
  }
  const frame = new LabeledFrame({ video, frameIdx: 0, instances });
  return new Labels({
    skeletons: [skeleton],
    videos: [video],
    labeledFrames: [frame],
  });
}

/** Deterministic "embedded video" blob we must never touch. */
function makeVideoBlob(n = 4096): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 0xff;
  return b;
}

/** Inject a chunked `video0/video` <B dataset (an "embedded video") into an
 *  existing on-disk SLP so we can assert it survives an in-place edit. */
function injectEmbeddedVideo(fp: string, blob: Uint8Array): void {
  const f = new H5File(fp, "a");
  f.create_group("video0");
  f.create_dataset({
    name: "video0/video",
    data: blob,
    shape: [blob.length],
    maxshape: [null],
    chunks: [1024],
    dtype: "<B",
  });
  f.flush();
  f.close();
}

function readVideoBlob(fp: string): Uint8Array {
  const f = new H5File(fp, "r");
  try {
    const v = f.get("video0/video").value as ArrayLike<number>;
    return v instanceof Uint8Array ? v : Uint8Array.from(v as number[]);
  } finally {
    f.close();
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Read a FLAT 2-D dataset's row-major `.value` into `number[][]`. */
function readFlatMatrix(f: any, name: string, cols: number): number[][] {
  const flat = Array.from(f.get(name).value as ArrayLike<number>, Number);
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += cols) out.push(flat.slice(i, i + cols));
  return out;
}

describe("writeLabelTablesInPlace — flat (app-written) tables", () => {
  it("value-only edit: coords change, other rows + video bytes + file size unchanged", async () => {
    await ready;
    const fp = path.join(SCRATCH, `inplace_flat_value_${Date.now()}.pkg.slp`);
    if (existsSync(fp)) rmSync(fp);
    const blob = makeVideoBlob();

    // App-written .pkg.slp (flat chunked pose tables), plus an embedded video.
    const v1 = makeLabels(3, 0);
    writeFileSync(fp, await saveSlpToBytes(v1));
    injectEmbeddedVideo(fp, blob);
    const sizeBefore = statSync(fp).size;

    // Edit: change instance 0's first point x/y (same row counts → value-only).
    const v2 = makeLabels(3, 0);
    (v2.labeledFrames[0].instances[0] as Instance).points[0].xy = [
      999.5, 888.25,
    ];
    const update = buildLabelTableUpdate(v2);

    const f = new H5File(fp, "a");
    writeLabelTablesInPlace(f, update);
    f.flush();
    f.close();

    const sizeAfter = statSync(fp).size;
    expect(sizeAfter - sizeBefore).toBe(0); // ZERO growth for a value-only edit

    const f2 = new H5File(fp, "r");
    try {
      const pts = readFlatMatrix(f2, "points", 4);
      // point 0 overwritten
      expect(pts[0][0]).toBeCloseTo(999.5, 6);
      expect(pts[0][1]).toBeCloseTo(888.25, 6);
      // point 1 (instance 0, node B) unchanged: base 0, i=0 → [3,4]
      expect(pts[1][0]).toBeCloseTo(3, 6);
      expect(pts[1][1]).toBeCloseTo(4, 6);
      // point of instance 2 unchanged: i=2 → node A [21,22]
      expect(pts[4][0]).toBeCloseTo(21, 6);
    } finally {
      f2.close();
    }

    // Embedded video bytes untouched.
    expect(bytesEqual(readVideoBlob(fp), blob)).toBe(true);
    rmSync(fp);
  });

  it("structural edit: add an instance (resize+write_slice), images intact", async () => {
    await ready;
    const fp = path.join(SCRATCH, `inplace_flat_struct_${Date.now()}.pkg.slp`);
    if (existsSync(fp)) rmSync(fp);
    const blob = makeVideoBlob();

    writeFileSync(fp, await saveSlpToBytes(makeLabels(2, 0)));
    injectEmbeddedVideo(fp, blob);

    // Read on-disk shape before the structural edit.
    let instRowsBefore = 0;
    let ptRowsBefore = 0;
    {
      const f = new H5File(fp, "r");
      instRowsBefore = f.get("instances").shape[0];
      ptRowsBefore = f.get("points").shape[0];
      f.close();
    }
    expect(instRowsBefore).toBe(2);
    expect(ptRowsBefore).toBe(4);

    // Edit: 3 instances now (add one) → more instance/point rows.
    const update = buildLabelTableUpdate(makeLabels(3, 0));
    const f = new H5File(fp, "a");
    writeLabelTablesInPlace(f, update);
    f.flush();
    f.close();

    const f2 = new H5File(fp, "r");
    try {
      expect(f2.get("instances").shape[0]).toBe(3); // resized up
      expect(f2.get("points").shape[0]).toBe(6);
      const pts = readFlatMatrix(f2, "points", 4);
      // new instance 2, node A → [21,22]
      expect(pts[4][0]).toBeCloseTo(21, 6);
      expect(pts[4][1]).toBeCloseTo(22, 6);
      // frames' instance range end must now be 3
      const frames = readFlatMatrix(f2, "frames", 5);
      expect(frames[0][4]).toBe(3);
    } finally {
      f2.close();
    }
    expect(bytesEqual(readVideoBlob(fp), blob)).toBe(true);
    rmSync(fp);
  });

  it("shrinking edit: remove an instance (resize down), images intact", async () => {
    await ready;
    const fp = path.join(SCRATCH, `inplace_flat_shrink_${Date.now()}.pkg.slp`);
    if (existsSync(fp)) rmSync(fp);
    const blob = makeVideoBlob();
    writeFileSync(fp, await saveSlpToBytes(makeLabels(3, 0)));
    injectEmbeddedVideo(fp, blob);

    const update = buildLabelTableUpdate(makeLabels(1, 0));
    const f = new H5File(fp, "a");
    writeLabelTablesInPlace(f, update);
    f.flush();
    f.close();

    const f2 = new H5File(fp, "r");
    try {
      expect(f2.get("instances").shape[0]).toBe(1);
      expect(f2.get("points").shape[0]).toBe(2);
    } finally {
      f2.close();
    }
    expect(bytesEqual(readVideoBlob(fp), blob)).toBe(true);
    rmSync(fp);
  });

  it("replaces the /metadata json attr only when metadataJson is set", async () => {
    await ready;
    const fp = path.join(SCRATCH, `inplace_meta_${Date.now()}.pkg.slp`);
    if (existsSync(fp)) rmSync(fp);
    writeFileSync(fp, await saveSlpToBytes(makeLabels(1, 0)));

    // Build a labels with a DIFFERENT skeleton name → different metadata json.
    const edited = makeLabels(1, 0);
    edited.skeletons[0].name = "renamed";
    const newJson = buildMetadataJson(edited);
    const update = buildLabelTableUpdate(edited, { metadataJson: newJson });

    const f = new H5File(fp, "a");
    writeLabelTablesInPlace(f, update);
    f.flush();
    f.close();

    const f2 = new H5File(fp, "r");
    try {
      const json = (f2.get("metadata") as any).attrs["json"].value as string;
      expect(json).toBe(newJson);
      expect(json).toContain("renamed");
    } finally {
      f2.close();
    }
    rmSync(fp);
  });
});

describe("writeLabelTablesInPlace — compound (Python-format / #218) tables", () => {
  // Build a compound-format SLP by hand (app-style: visible/complete = uint8, NOT
  // enum) with an embedded video, then value-only patch it. Mirrors the members
  // that #218's compound writer / Python emit.
  const framesDtype: [string, string][] = [
    ["frame_id", "<q"],
    ["video", "<i"],
    ["frame_idx", "<q"],
    ["instance_id_start", "<q"],
    ["instance_id_end", "<q"],
  ];
  const instancesDtype: [string, string][] = [
    ["instance_id", "<q"],
    ["instance_type", "<B"],
    ["frame_id", "<q"],
    ["skeleton", "<I"],
    ["track", "<i"],
    ["from_predicted", "<q"],
    ["score", "<f"],
    ["point_id_start", "<Q"],
    ["point_id_end", "<Q"],
    ["tracking_score", "<f"],
  ];
  const pointsDtype: [string, string][] = [
    ["x", "<d"],
    ["y", "<d"],
    ["visible", "<B"],
    ["complete", "<B"],
  ];
  const predPointsDtype: [string, string][] = [
    ["x", "<d"],
    ["y", "<d"],
    ["visible", "<B"],
    ["complete", "<B"],
    ["score", "<f"],
  ];

  function makeCompoundFile(fp: string, blob: Uint8Array): void {
    const f = new H5File(fp, "w");
    // frames: 1 frame, 2 instances, 4 points.
    f.create_dataset({
      name: "frames",
      data: new Map<string, ArrayBufferView>([
        ["frame_id", BigInt64Array.from([0n])],
        ["video", Int32Array.from([0])],
        ["frame_idx", BigInt64Array.from([0n])],
        ["instance_id_start", BigInt64Array.from([0n])],
        ["instance_id_end", BigInt64Array.from([2n])],
      ]),
      shape: [1],
      dtype: framesDtype,
      maxshape: [null],
      chunks: [8192],
    });
    f.create_dataset({
      name: "instances",
      data: new Map<string, ArrayBufferView>([
        ["instance_id", BigInt64Array.from([0n, 1n])],
        ["instance_type", Uint8Array.from([0, 0])],
        ["frame_id", BigInt64Array.from([0n, 0n])],
        ["skeleton", Uint32Array.from([0, 0])],
        ["track", Int32Array.from([-1, -1])],
        ["from_predicted", BigInt64Array.from([-1n, -1n])],
        ["score", Float32Array.from([0, 0])],
        ["point_id_start", BigUint64Array.from([0n, 2n])],
        ["point_id_end", BigUint64Array.from([2n, 4n])],
        ["tracking_score", Float32Array.from([0, 0])],
      ]),
      shape: [2],
      dtype: instancesDtype,
      maxshape: [null],
      chunks: [8192],
    });
    f.create_dataset({
      name: "points",
      data: new Map<string, ArrayBufferView>([
        ["x", Float64Array.from([1, 3, 11, 13])],
        ["y", Float64Array.from([2, 4, 12, 14])],
        ["visible", Uint8Array.from([1, 1, 1, 1])],
        ["complete", Uint8Array.from([1, 1, 1, 1])],
      ]),
      shape: [4],
      dtype: pointsDtype,
      maxshape: [null],
      chunks: [8192],
    });
    f.create_dataset({
      name: "pred_points",
      data: new Map<string, ArrayBufferView>([
        ["x", Float64Array.from([])],
        ["y", Float64Array.from([])],
        ["visible", Uint8Array.from([])],
        ["complete", Uint8Array.from([])],
        ["score", Float32Array.from([])],
      ]),
      shape: [0],
      dtype: predPointsDtype,
      maxshape: [null],
      chunks: [8192],
    });
    f.create_group("video0");
    f.create_dataset({
      name: "video0/video",
      data: blob,
      shape: [blob.length],
      maxshape: [null],
      chunks: [1024],
      dtype: "<B",
    });
    f.flush();
    f.close();
  }

  it("value-only edit on compound points: coords change, video bytes + size unchanged", async () => {
    await ready;
    const fp = path.join(SCRATCH, `inplace_compound_${Date.now()}.pkg.slp`);
    if (existsSync(fp)) rmSync(fp);
    const blob = makeVideoBlob();
    makeCompoundFile(fp, blob);
    const sizeBefore = statSync(fp).size;

    // Hand-built value-only update (same row counts as the compound file).
    const update: LabelTableUpdate = {
      frames: {
        fields: [
          "frame_id",
          "video",
          "frame_idx",
          "instance_id_start",
          "instance_id_end",
        ],
        rows: [[0, 0, 0, 0, 2]],
      },
      instances: {
        fields: [
          "instance_id",
          "instance_type",
          "frame_id",
          "skeleton",
          "track",
          "from_predicted",
          "score",
          "point_id_start",
          "point_id_end",
          "tracking_score",
        ],
        rows: [
          [0, 0, 0, 0, -1, -1, 0, 0, 2, 0],
          [1, 0, 0, 0, -1, -1, 0, 2, 4, 0],
        ],
      },
      points: {
        fields: ["x", "y", "visible", "complete"],
        rows: [
          [777.5, 666.25, 0, 1], // <- changed x/y AND visible flag (uint8)
          [3, 4, 1, 1],
          [11, 12, 1, 1],
          [13, 14, 1, 1],
        ],
      },
      predPoints: {
        fields: ["x", "y", "visible", "complete", "score"],
        rows: [],
      },
    };

    const f = new H5File(fp, "a");
    writeLabelTablesInPlace(f, update);
    f.flush();
    f.close();

    expect(statSync(fp).size - sizeBefore).toBe(0);

    const f2 = new H5File(fp, "r");
    try {
      const pts = f2.get("points").value as number[][];
      expect(pts[0][0]).toBeCloseTo(777.5, 6);
      expect(pts[0][1]).toBeCloseTo(666.25, 6);
      expect(pts[0][2]).toBe(0); // visible uint8 overwritten to 0
      expect(pts[1][0]).toBeCloseTo(3, 6); // untouched
      // instances int64 members preserved through the round-trip
      const ins = f2.get("instances").value as any[][];
      expect(Number(ins[1][7])).toBe(2); // point_id_start
      expect(Number(ins[1][8])).toBe(4); // point_id_end
    } finally {
      f2.close();
    }
    expect(bytesEqual(readVideoBlob(fp), blob)).toBe(true);
    rmSync(fp);
  });
});

describe("checkInPlaceWritable + onDiskTableFromMeta", () => {
  /** Chunked flat OnDiskTables sized to `update` (⇒ value-only, so the enum /
   *  resizability checks pass and the sidecar checks drive the verdict). */
  function chunkedOnDiskFor(update: LabelTableUpdate): OnDiskTables {
    const t = (rows: number, cols: number): any => ({
      rows,
      cols,
      layout: "flat" as const,
      chunked: true,
    });
    return {
      frames: t(update.frames.rows.length, 5),
      instances: t(update.instances.rows.length, 10),
      points: t(update.points.rows.length, 4),
      predPoints: t(update.predPoints.rows.length, 5),
      negativeFrames: update.negativeFrames
        ? t(update.negativeFrames.rows.length, 2)
        : undefined,
    };
  }
  /** Sidecars where on-disk == expected (nothing changed → confinement holds). */
  function matchingSidecars(labels: Labels): {
    onDisk: OnDiskSidecars;
    expected: OnDiskSidecars;
  } {
    return {
      onDisk: buildExpectedSidecars(labels),
      expected: buildExpectedSidecars(labels),
    };
  }

  it("refuses a Python-written file (enum points) with an /enum/ reason", async () => {
    await ready;
    const src = path.join(fixtureRoot, "slp", "minimal_instance.slp");
    // Build OnDiskTables from the Python fixture's real dataset metadata.
    const f = new H5File(src, "r");
    const onDisk: OnDiskTables = {};
    try {
      for (const [key, name] of [
        ["frames", "frames"],
        ["instances", "instances"],
        ["points", "points"],
        ["predPoints", "pred_points"],
      ] as const) {
        const ds = f.keys().includes(name) ? f.get(name) : null;
        if (ds) {
          (onDisk as any)[key] = onDiskTableFromMeta({
            shape: (ds as any).shape,
            metadata: (ds as any).metadata,
          });
        }
      }
    } finally {
      f.close();
    }

    // points must have been detected as compound with an enum member.
    expect(onDisk.points?.layout).toBe("compound");
    expect(onDisk.points?.members?.some((m) => m.typeClass === 8)).toBe(true);

    const labels = makeLabels(1, 0);
    const update = buildLabelTableUpdate(labels);
    // Matching sidecars so ONLY the enum check can drive the refusal.
    const res = checkInPlaceWritable(update, onDisk, matchingSidecars(labels));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/enum/i);
  });

  it("allows a pure pose edit on flat chunked (app) tables — sidecars unchanged", () => {
    const labels = makeLabels(3, 0);
    const update = buildLabelTableUpdate(labels); // 3 inst, 6 pts, 1 frame
    const res = checkInPlaceWritable(
      update,
      chunkedOnDiskFor(update),
      matchingSidecars(labels),
    );
    expect(res.ok).toBe(true);
  });

  it("refuses a structural edit when the on-disk table is contiguous", () => {
    const labels = makeLabels(3, 0);
    const onDisk: OnDiskTables = {
      frames: { rows: 1, cols: 5, layout: "flat", chunked: false },
      instances: { rows: 2, cols: 10, layout: "flat", chunked: false },
      points: { rows: 4, cols: 4, layout: "flat", chunked: false },
      predPoints: { rows: 0, cols: 5, layout: "flat", chunked: false },
    };
    const update = buildLabelTableUpdate(labels); // 3 inst → structural
    const res = checkInPlaceWritable(update, onDisk, matchingSidecars(labels));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/contiguous|resizable/i);
  });

  it("allows a value-only edit even on a contiguous table", () => {
    const labels = makeLabels(3, 0);
    const onDisk: OnDiskTables = {
      frames: { rows: 1, cols: 5, layout: "flat", chunked: false },
      instances: { rows: 3, cols: 10, layout: "flat", chunked: false },
      points: { rows: 6, cols: 4, layout: "flat", chunked: false },
      predPoints: { rows: 0, cols: 5, layout: "flat", chunked: false },
    };
    const update = buildLabelTableUpdate(labels); // same counts → value-only
    expect(
      checkInPlaceWritable(update, onDisk, matchingSidecars(labels)).ok,
    ).toBe(true);
  });

  // ---- FIX 1: track/suggestion/metadata desync must be refused ----

  it("refuses when a track was ADDED (tracks_json would desync)", () => {
    const labels = makeLabels(2, 0);
    const update = buildLabelTableUpdate(labels);
    const meta = buildMetadataJson(labels);
    const vids = buildVideoSignatures(labels.videos);
    const onDisk: OnDiskSidecars = {
      tracksJson: buildTracksJson([{ name: "t1" }]),
      suggestionsJson: [],
      metadataJson: meta,
      videos: vids,
    };
    const expected: OnDiskSidecars = {
      tracksJson: buildTracksJson([{ name: "t1" }, { name: "t2" }]),
      suggestionsJson: [],
      metadataJson: meta,
      videos: vids,
    };
    const res = checkInPlaceWritable(update, chunkedOnDiskFor(update), {
      onDisk,
      expected,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/track/i);
  });

  it("refuses when tracks were REORDERED", () => {
    const labels = makeLabels(2, 0);
    const update = buildLabelTableUpdate(labels);
    const meta = buildMetadataJson(labels);
    const vids = buildVideoSignatures(labels.videos);
    const res = checkInPlaceWritable(update, chunkedOnDiskFor(update), {
      onDisk: {
        tracksJson: buildTracksJson([{ name: "t1" }, { name: "t2" }]),
        suggestionsJson: [],
        metadataJson: meta,
        videos: vids,
      },
      expected: {
        tracksJson: buildTracksJson([{ name: "t2" }, { name: "t1" }]),
        suggestionsJson: [],
        metadataJson: meta,
        videos: vids,
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/track/i);
  });

  it("refuses when the suggestions changed", () => {
    const labels = makeLabels(1, 0);
    const update = buildLabelTableUpdate(labels);
    const meta = buildMetadataJson(labels);
    const vids = buildVideoSignatures(labels.videos);
    const res = checkInPlaceWritable(update, chunkedOnDiskFor(update), {
      onDisk: {
        tracksJson: [],
        suggestionsJson: [],
        metadataJson: meta,
        videos: vids,
      },
      expected: {
        tracksJson: [],
        suggestionsJson: ['{"video":"0","frame_idx":5,"group":"default"}'],
        metadataJson: meta,
        videos: vids,
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/suggestion/i);
  });

  it("refuses when /metadata changed but update.metadataJson is not set", () => {
    const labels = makeLabels(1, 0);
    const renamed = makeLabels(1, 0);
    renamed.skeletons[0].name = "renamed";
    const update = buildLabelTableUpdate(renamed); // no metadataJson carried
    const res = checkInPlaceWritable(update, chunkedOnDiskFor(update), {
      onDisk: {
        tracksJson: [],
        suggestionsJson: [],
        metadataJson: buildMetadataJson(labels),
        videos: buildVideoSignatures(labels.videos),
      },
      expected: buildExpectedSidecars(renamed),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/metadata/i);
  });

  it("allows a /metadata change when update.metadataJson carries it", () => {
    const labels = makeLabels(1, 0);
    const renamed = makeLabels(1, 0);
    renamed.skeletons[0].name = "renamed";
    const update = buildLabelTableUpdate(renamed, {
      metadataJson: buildMetadataJson(renamed),
    });
    const res = checkInPlaceWritable(update, chunkedOnDiskFor(update), {
      onDisk: {
        tracksJson: [],
        suggestionsJson: [],
        metadataJson: buildMetadataJson(labels),
        videos: buildVideoSignatures(labels.videos),
      },
      expected: buildExpectedSidecars(renamed),
    });
    expect(res.ok).toBe(true);
  });

  // ---- video-set confinement ----

  it("refuses when a video was ADDED (videos_json would desync)", () => {
    const labels = makeLabels(1, 0);
    const update = buildLabelTableUpdate(labels);
    const base = buildExpectedSidecars(labels);
    const res = checkInPlaceWritable(update, chunkedOnDiskFor(update), {
      onDisk: base, // 1 video
      expected: {
        ...base,
        videos: buildVideoSignatures([
          new Video({ filename: "vid.mp4" }),
          new Video({ filename: "vid2.mp4" }),
        ]),
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/video/i);
  });

  it("refuses when a video was REPOINTED (filename changed)", () => {
    const labels = makeLabels(1, 0);
    const update = buildLabelTableUpdate(labels);
    const base = buildExpectedSidecars(labels);
    const res = checkInPlaceWritable(update, chunkedOnDiskFor(update), {
      onDisk: {
        ...base,
        videos: buildVideoSignatures([new Video({ filename: "a.mp4" })]),
      },
      expected: {
        ...base,
        videos: buildVideoSignatures([new Video({ filename: "b.mp4" })]),
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/video/i);
  });

  it("allows a pure pose edit when the video set is identical", () => {
    const labels = makeLabels(2, 0);
    const update = buildLabelTableUpdate(labels);
    const res = checkInPlaceWritable(
      update,
      chunkedOnDiskFor(update),
      matchingSidecars(labels),
    );
    expect(res.ok).toBe(true);
  });
});

describe("writeLabelTablesInPlace — resize backstop (FIX 2)", () => {
  it("throws (does not corrupt) when a structural edit hits a contiguous table", async () => {
    await ready;
    const fp = path.join(SCRATCH, `inplace_contig_${Date.now()}.pkg.slp`);
    if (existsSync(fp)) rmSync(fp);

    // Build a file whose pose tables are CONTIGUOUS (non-resizable) — as if
    // written by an old app build before the chunked-table change.
    {
      const f = new H5File(fp, "w");
      const mk = (name: string, rows: number, cols: number, dtype: string) => {
        const d = new Float64Array(rows * cols);
        f.create_dataset({ name, data: d, shape: [rows, cols], dtype });
      };
      mk("frames", 1, 5, "<i8");
      mk("instances", 2, 10, "<f8");
      mk("points", 4, 4, "<f8");
      mk("pred_points", 0, 5, "<f8");
      f.create_group("video0");
      const blob = makeVideoBlob(512);
      f.create_dataset({
        name: "video0/video",
        data: blob,
        shape: [blob.length],
        dtype: "<B",
      });
      f.flush();
      f.close();
    }

    // Structural edit (2 → 3 instances) — resize of the contiguous `instances`
    // table silently no-ops, so the shape-readback assertion must THROW.
    const update = buildLabelTableUpdate(makeLabels(3, 0));
    const f = new H5File(fp, "a");
    let threw: string | null = null;
    try {
      writeLabelTablesInPlace(f, update);
    } catch (e) {
      threw = String(e);
    } finally {
      f.flush();
      f.close();
    }
    expect(threw).not.toBeNull();
    expect(threw ?? "").toMatch(/resize|resizable/i);
    rmSync(fp);
  });
});
