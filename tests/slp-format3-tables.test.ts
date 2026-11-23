/**
 * Reading the tables of SLP format 3.0 other than the pose tables: ROIs,
 * masks (with score maps), label images (with objects and score maps), the
 * identity and category links, and the recording session tables.
 *
 * Fixtures (`tests/data/slp/gen_format3_tables_fixture.py`) were written with
 * Python sleap-io 0.10.0 from the `release/0.10` branch at commit fe4f91c7b:
 *   - format3_tables.slp: format 3.0 with every one of those tables, label
 *     images of one size (pixel data as a `(T, H, W)` array), and a session
 *     of three cameras with user and predicted 3D points
 *   - format3_tables.v2.slp: the same labels in the 2.x layout
 *   - format3_label_images_blob.slp / .v2.slp: label images of two sizes
 *     (pixel data as a flat buffer of compressed frames), in both layouts
 *   - format3_tables_unknown.slp: format3_tables.slp with a column this
 *     version does not know in each of those tables
 *   - format3_tables_defaults.slp: format3_tables.slp without the optional
 *     columns of the ROI, mask and label image tables
 *
 * js_written_annotations.slp and js_written_label_images_blob.slp are
 * format3_tables.v2.slp and format3_label_images_blob.v2.slp saved by
 * sleap-io.js before its 2.x writers stored these tables as Python does (flat
 * float matrices with `field_names`, strings as JSON bytes with a `json`
 * attribute); readers must still read them.
 *
 * Each reader must give the same labels for a 3.0 file as for its 2.x twin.
 * The streaming reader reads the links of instances and the sessions (and no
 * ROIs, masks or label images, in any layout); the lite reader reads sessions.
 *
 * Python read-backs run each interpreter listed (comma-separated) in
 * `SLEAP_IO_TEST_PYTHONS`, or `uv run --with sleap-io python` when unset;
 * `SLEAP_IO_SKIP_PYTHON_TESTS=1` skips them.
 */
import { describe, it, expect, setDefaultTimeout } from "./bun-test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ready, File as H5File } from "h5wasm/node";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import {
  readFromStreamingFile,
  readSessionsStreaming,
  StreamingIncompleteError,
} from "../src/codecs/slp/read-streaming.js";
import {
  readStreamingOrNull,
  type StreamingReader,
} from "../src/io/load-route.js";
import { openH5FileBrowser } from "../src/codecs/slp/h5.js";
import {
  type SlpFormatError,
  SlpTableError,
} from "../src/codecs/slp/format-check.js";
import {
  SlpFormat3ChoiceError,
  SlpViewOnlyError,
  type Format3Summary,
} from "../src/codecs/slp/format3.js";
import {
  labelImageProblems,
  linkProblems,
  maskProblems,
  roiProblems,
  scoreMapProblems,
  sessionProblems,
  tableFromColumns,
} from "../src/codecs/slp/columnar-tables.js";
import {
  openSlpWriter,
  saveSlpMergedFromStores,
  saveSlpStructureToBytes,
  saveSlpToBytes,
} from "../src/codecs/slp/write.js";
import { loadSlp } from "../src/index.js";
import { sessionMetadataFromJson } from "../src/codecs/slp/parsers.js";
import { loadSlpMetadata } from "../src/lite.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { ROI } from "../src/model/roi.js";
import { SegmentationMask } from "../src/model/mask.js";
import { UserLabelImage } from "../src/model/label-image.js";
import { Video } from "../src/model/video.js";
import { deflate } from "pako";
import { PredictedInstance } from "../src/model/instance.js";
import { PredictedInstance3D } from "../src/model/instance3d.js";
import { cloneRecordingSession } from "../src/model/camera.js";
import { setSourceAccess, sourceMarkOf } from "../src/model/source-mark.js";
import { slpBytes, slpPath, streamingFile } from "./slp-format3-files";

setDefaultTimeout(120_000);

const V3 = "format3_tables.slp";
const V2 = "format3_tables.v2.slp";
const BLOB = "format3_label_images_blob.slp";
const BLOB_V2 = "format3_label_images_blob.v2.slp";
const UNKNOWN = "format3_tables_unknown.slp";
const DEFAULTS = "format3_tables_defaults.slp";

const EDIT = { openVideos: false, format3: "edit" } as const;
const VIEW = { openVideos: false, format3: "view" } as const;

/** Load a fixture (or a file) through the streaming reader stand-in. */
async function readStreaming(
  name: string,
  options: { lazy?: boolean; format3?: "view" | "edit" | "keep" } = {},
): Promise<Labels> {
  let compound: Record<string, unknown> = {};
  // The stand-in has no fast path for 2.x compound pose tables; hand them over.
  if (name.endsWith(".v2.slp")) {
    const store = (await readSlpLazy(slpPath(name), { openVideos: false }))
      ._lazyDataStore;
    if (!store) throw new Error("no lazy store");
    compound = {
      frames: store.framesData,
      instances: store.instancesData,
      points: store.pointsData,
      pred_points: store.predPointsData,
    };
  }
  const { file, close } = await streamingFile(name, compound);
  try {
    const labels = await readFromStreamingFile(
      file,
      `https://example.com/${path.basename(name)}`,
      undefined,
      false,
      undefined,
      false,
      options.lazy ?? false,
      false,
      false,
      false,
      options.format3 ?? "edit",
    );
    if (options.lazy) labels.materialize();
    return labels;
  } finally {
    close();
  }
}

const num = (v: number | null | undefined): number | string | null =>
  v === null || v === undefined ? null : Number.isNaN(v) ? "nan" : v;

/** Everything the two layouts must agree on, as plain values. */
function describe3(labels: Labels) {
  const frames = labels.labeledFrames;
  const instances = frames.flatMap((f) => f.instances);
  const inst = (i: object | null | undefined) =>
    i ? instances.indexOf(i as (typeof instances)[number]) : null;
  const tracks = (t: { name: string } | null | undefined) => t?.name ?? null;
  const det = (d: any) => ({
    identity: d.identity?.name ?? null,
    identityScore: num(d.identityScore),
    category: d.category ?? null,
    categoryScore: num(d.categoryScore),
  });
  const allMasks = frames.flatMap((f) => f.masks);
  const roi = (r: any) => ({
    kind: r.constructor.name,
    geometry: JSON.stringify(r.geometry),
    name: r.name,
    source: r.source,
    video: r.video ? labels.videos.indexOf(r.video) : null,
    track: tracks(r.track),
    trackingScore: num(r.trackingScore),
    instance: inst(r.instance),
    score: num(r.score),
    ...det(r),
  });
  const sum = (a: ArrayLike<number> | null | undefined) =>
    a ? Array.from(a).reduce((x, y) => x + y, 0) : null;
  return {
    videos: labels.videos.map((v) => v.filename),
    identities: labels.identities.map((i) => [i.name, i.metadata]),
    instances: instances.map(det),
    frames: frames.map((f) => ({
      video: labels.videos.indexOf(f.video),
      frameIdx: f.frameIdx,
      instances: f.instances.map((i) => [
        i instanceof PredictedInstance,
        tracks(i.track),
      ]),
      rois: f.rois.map(roi),
      masks: f.masks.map((m: any) => ({
        kind: m.constructor.name,
        size: [m.height, m.width],
        rle: Array.from(m.rleCounts as Uint32Array),
        name: m.name,
        source: m.source,
        track: tracks(m.track),
        trackingScore: num(m.trackingScore),
        instance: inst(m.instance),
        fromPredicted: m.fromPredicted
          ? allMasks.indexOf(m.fromPredicted)
          : null,
        scale: m.scale,
        offset: m.offset,
        score: num(m.score),
        scoreMap: m.scoreMap ? Array.from(m.scoreMap as Float32Array) : null,
        scoreMapSpatial: m.scoreMap
          ? [m.scoreMapScale, m.scoreMapOffset]
          : null,
        ...det(m),
      })),
      labelImages: f.labelImages.map((li: any) => ({
        kind: li.constructor.name,
        size: [li.height, li.width],
        pixels: Array.from(li.data as Int32Array),
        source: li.source,
        scale: li.scale,
        offset: li.offset,
        score: num(li.score),
        scoreMap: sum(li.scoreMap),
        scoreMapSpatial: li.scoreMap
          ? [li.scoreMapScale, li.scoreMapOffset]
          : null,
        objects: [...li.objects.entries()].map(([id, o]: [number, any]) => ({
          id,
          name: o.name,
          category: o.category,
          track: tracks(o.track),
          instance: inst(o.instance),
          score: num(o.score),
          trackingScore: num(o.trackingScore),
        })),
      })),
      centroids: f.centroids.map((c: any) => [c.x, c.y, det(c)]),
      bboxes: f.bboxes.map((b: any) => [b.x1, b.y2, inst(b.instance), det(b)]),
    })),
    staticRois: labels.staticRois.map(roi),
    sessions: labels.sessions.map((s) => ({
      cameras: s.cameraGroup.cameras.map((c) => [
        c.name,
        labels.videos.indexOf(s.videoByCamera.get(c) as never),
      ]),
      metadata: s.metadata,
      frameGroups: [...s.frameGroups.values()].map((fg) => ({
        frameIdx: fg.frameIdx,
        metadata: fg.metadata,
        frames: [...fg.labeledFrameByCamera.entries()].map(([c, lf]) => [
          c.name,
          frames.indexOf(lf),
        ]),
        groups: fg.instanceGroups.map((ig) => ({
          members: [...ig.instanceByCamera.entries()].map(([c, i]) => [
            c.name,
            inst(i),
          ]),
          score: num(ig.score),
          identity: ig.identity?.name ?? null,
          metadata: ig.metadata,
          kind: ig.instance3d?.constructor.name ?? null,
          points: ig.instance3d?.points?.map((p) => p.map(num)) ?? null,
          score3d: num(ig.instance3d?.score),
          pointScores:
            ig.instance3d instanceof PredictedInstance3D
              ? (ig.instance3d.pointScores ?? []).map(num)
              : null,
        })),
      })),
    })),
  };
}

/** The readers, as calls that load a fixture for editing. */
const READERS: Array<[string, (name: string) => Promise<Labels>]> = [
  ["readSlp (in memory)", (n) => readSlp(slpPath(n), EDIT)],
  [
    "readSlp (in memory, from bytes)",
    (n) => readSlp(slpBytes(n), { ...EDIT, h5: { filenameHint: n } }),
  ],
  [
    "readSlpLazy",
    async (n) => {
      const labels = await readSlpLazy(slpPath(n), EDIT);
      labels.materialize();
      return labels;
    },
  ],
  ["loadSlp", (n) => loadSlp(slpPath(n), EDIT)],
  ["readFromStreamingFile (streaming)", (n) => readStreaming(n)],
  [
    "readFromStreamingFile (streaming, lazy)",
    (n) => readStreaming(n, { lazy: true }),
  ],
];

describe("format 3.0 tables read as their 2.x twins", () => {
  for (const [label, load] of READERS) {
    for (const [v3, v2] of [
      [V3, V2],
      [BLOB, BLOB_V2],
    ]) {
      it(`${label}: ${v3}`, async () => {
        const a = describe3(await load(v3));
        const b = describe3(await load(v2));
        expect(a).toEqual(b);
        // Every pair holds something to compare.
        expect(a.frames.length).toBe(6);
      });
    }
    it(`${label}: the session holds its three cameras and 3D points`, async () => {
      const s = describe3(await load(V3)).sessions;
      expect(s).toHaveLength(1);
      expect(s[0].cameras).toEqual([
        ["cam0", 0],
        ["cam1", 1],
        ["cam2", 2],
      ]);
      // Python stores session metadata at the top level of its JSON entry.
      expect(s[0].metadata).toEqual({ rig: "three" });
      const [fg0, fg1] = s[0].frameGroups;
      expect(fg0.frameIdx).toBe(0);
      expect(fg0.metadata).toEqual({ note: "fg0" });
      expect(fg0.frames).toEqual([
        ["cam0", 0],
        ["cam1", 1],
        ["cam2", 2],
      ]);
      expect(fg0.groups.map((g) => g.members)).toEqual([
        [
          ["cam0", 0],
          ["cam1", 2],
          ["cam2", 4],
        ],
        [
          ["cam0", 1],
          ["cam1", 3],
        ],
      ]);
      expect(fg0.groups[0]).toMatchObject({
        score: 0.9375,
        identity: "animal_A",
        metadata: { tag: "first" },
        kind: "Instance3D",
        points: [
          [1, 2, 3],
          [4, 5, 6],
          ["nan", "nan", "nan"],
        ],
        score3d: 0.8125,
      });
      expect(fg1.groups[0]).toMatchObject({
        identity: "animal_B",
        kind: "PredictedInstance3D",
        score3d: 0.6875,
        pointScores: [0.5, 0.25, "nan"],
      });
    });
  }

  it("the in-memory reader reads the values the generator wrote", async () => {
    const s = describe3(await readSlp(slpPath(V3), EDIT));
    const [f00] = s.frames;
    expect(s.instances[0]).toEqual({
      identity: "animal_A",
      identityScore: 0.875,
      category: "female",
      categoryScore: 0.75,
    });
    expect(f00.rois).toEqual([
      expect.objectContaining({
        kind: "UserROI",
        name: "nest",
        source: "manual",
        video: 0,
        track: "a",
        trackingScore: 0.25,
        instance: 0,
        identity: "animal_A",
        identityScore: 0.5,
      }),
    ]);
    expect(s.frames[1].rois[0]).toMatchObject({
      kind: "PredictedROI",
      score: 0.625,
      source: "model",
      category: "male",
    });
    expect(s.staticRois.map((r) => [r.name, r.video])).toEqual([
      ["arena", 0],
      ["no video", null],
    ]);
    const [pred, user] = f00.masks;
    expect(pred).toMatchObject({
      kind: "PredictedSegmentationMask",
      size: [6, 8],
      name: "pm",
      source: "model",
      track: "b",
      instance: 1,
      scale: [2, 2],
      offset: [1, 0.5],
      score: 0.75,
    });
    expect(pred.scoreMap).toHaveLength(48);
    expect(user).toMatchObject({
      kind: "UserSegmentationMask",
      fromPredicted: 0,
      instance: 0,
      trackingScore: 0.5,
      identity: "animal_A",
      category: "female",
    });
    const [li] = f00.labelImages;
    expect(li).toMatchObject({
      kind: "UserLabelImage",
      size: [6, 8],
      source: "manual",
      scale: [0.5, 0.5],
      offset: [2, 3],
    });
    expect(li.objects).toEqual([
      {
        id: 1,
        name: "one",
        category: "female",
        track: "a",
        instance: 0,
        score: 0.875,
        trackingScore: 0.375,
      },
      {
        id: 2,
        name: "two",
        category: "",
        track: "b",
        instance: 1,
        score: null,
        trackingScore: null,
      },
    ]);
    expect(li.pixels.filter((p) => p === 1)).toHaveLength(6);
    expect(li.pixels.filter((p) => p === 2)).toHaveLength(6);
    expect(s.frames[1].labelImages[0]).toMatchObject({
      kind: "PredictedLabelImage",
      score: 0.5,
    });
    expect(f00.centroids[0][2]).toMatchObject({
      identity: "animal_B",
      category: "male",
    });
    expect(f00.bboxes[0]).toEqual([
      1,
      9,
      0,
      {
        identity: "animal_A",
        identityScore: 0.125,
        category: "female",
        categoryScore: 0.375,
      },
    ]);
  });

  it("label images of two sizes read from the flat buffer", async () => {
    const s = describe3(await readSlp(slpPath(BLOB), EDIT));
    const [a, b] = s.frames.flatMap((f) => f.labelImages);
    expect(a.size).toEqual([4, 6]);
    expect(a.pixels.filter((p) => p === 1)).toHaveLength(6);
    expect(b.size).toEqual([5, 7]);
    expect(b.pixels.filter((p) => p === 2)).toHaveLength(8);
    expect(b.objects[0]).toMatchObject({ id: 2, instance: 3, score: 0.5 });
  });

  it("missing optional columns take Python's defaults", async () => {
    for (const read of [
      () => readSlp(slpPath(DEFAULTS), EDIT),
      async () => {
        const labels = await readSlpLazy(slpPath(DEFAULTS), EDIT);
        labels.materialize();
        return labels;
      },
    ]) {
      const s = describe3(await read());
      const rois = [...s.frames.flatMap((f) => f.rois), ...s.staticRois];
      expect(rois.map((r) => [r.kind, r.name, r.source, r.instance])).toEqual(
        rois.map(() => ["UserROI", "", "", null]),
      );
      expect(rois.map((r) => r.trackingScore)).toEqual(rois.map(() => null));
      const masks = s.frames.flatMap((f) => f.masks);
      for (const m of masks) {
        expect(m).toMatchObject({
          kind: "UserSegmentationMask",
          name: "",
          source: "",
          instance: null,
          fromPredicted: null,
          scale: [1, 1],
          offset: [0, 0],
          trackingScore: null,
        });
      }
      const images = s.frames.flatMap((f) => f.labelImages);
      for (const li of images) {
        expect(li).toMatchObject({
          kind: "UserLabelImage",
          source: "",
          scale: [1, 1],
          offset: [0, 0],
        });
        for (const o of li.objects) {
          expect([o.name, o.category, o.score, o.trackingScore]).toEqual([
            "",
            "",
            null,
            null,
          ]);
        }
      }
      // The required columns still hold what the generator wrote.
      expect(masks.map((m) => m.rle)).toEqual(
        describe3(await readSlp(slpPath(V3), EDIT)).frames.flatMap((f) =>
          f.masks.map((m) => m.rle),
        ),
      );
    }
  });

  it("the lite reader reads the 3.0 session tables", async () => {
    const meta = await loadSlpMetadata(slpBytes(V3));
    const v2 = await loadSlpMetadata(slpBytes(V2));
    expect(meta.counts).toEqual(v2.counts);
    expect(meta.counts).toEqual({
      labeledFrames: 6,
      instances: 8,
      points: 9,
      predictedPoints: 15,
    });
    expect(meta.sessions).toHaveLength(1);
    // The lite reader cannot read Python's 2.x compound session tables, so
    // only the 3.0 file gives its frame groups.
    const groups = (
      meta.sessions[0] as unknown as {
        frameGroups: Array<{
          frameIdx: number;
          instanceGroups: Array<{ score?: number; instance3d?: object }>;
        }>;
      }
    ).frameGroups;
    expect(groups.map((g) => g.frameIdx)).toEqual([0, 1]);
    expect(groups[0].instanceGroups[0].score).toBe(0.9375);
    expect(groups[1].instanceGroups[0].instance3d).toMatchObject({
      score: 0.6875,
      pointScores: [0.5, 0.25, Number.NaN],
    });
  });

  it("the streaming session reader can be called without the file's counts", async () => {
    const { file, close } = await streamingFile(V3);
    try {
      const labels = await readSlp(slpPath(V3), EDIT);
      const sessions = await readSessionsStreaming(
        file,
        labels.videos,
        labels.skeletons,
        labels.identities,
      );
      expect(sessions[0].frameGroups.size).toBe(2);
    } finally {
      close();
    }
  });
});

describe("what the streaming reader does not read", () => {
  const CATEGORY_META = [
    "categories/meta_key",
    "categories/meta_owner",
    "categories/meta_val",
  ];

  it("is in its summary, and an edit drops only what that lists", async () => {
    const eager = (await readSlp(slpPath(V3), EDIT)).sourceFormat?.summary;
    expect(eager?.unreadTables).toEqual(CATEGORY_META);
    const streamed = await readStreaming(V3);
    const summary = streamed.sourceFormat?.summary;
    // Its ROIs, masks and label images, and the links of detections other
    // than instances, are not read by the streaming reader.
    expect(summary?.unreadTables).toEqual(
      [
        ...CATEGORY_META,
        "categories/links",
        "identity/links",
        "label_images",
        "masks",
        "rois",
      ].sort(),
    );
    expect(summary?.lossless).toBe(false);
    expect(streamed.labeledFrames.flatMap((f) => f.rois)).toEqual([]);
    // The rest of the summary is the eager reader's.
    expect({ ...summary, unreadTables: [] }).toEqual({
      ...eager,
      unreadTables: [],
    });
  });

  it("the choice error names them", async () => {
    const { file, close } = await streamingFile(V3);
    try {
      let error: unknown;
      try {
        await readFromStreamingFile(
          file,
          `https://example.com/${V3}`,
          undefined,
          false,
          undefined,
          false,
          false,
          false,
          false,
          false,
          "ask",
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SlpFormat3ChoiceError);
      expect((error as Error).message).toContain("label_images, masks, rois");
    } finally {
      close();
    }
  });

  it("links of instances only are not listed", async () => {
    // format3_label_images_blob.slp links instances only (no other detection).
    const summary = (await readStreaming(BLOB)).sourceFormat?.summary;
    expect(summary?.unreadTables).toEqual([...CATEGORY_META, "label_images"]);
    expect(
      (await readStreaming("format3_pose.slp")).sourceFormat?.summary
        .unreadTables,
    ).toEqual([]);
  });
});

/** The streaming summary's unread tables that the eager summary lacks. */
async function streamingOnly(name: string): Promise<string[]> {
  const eager = (await readSlp(slpPath(name), EDIT)).sourceFormat?.summary;
  const streamed = (await readStreaming(name)).sourceFormat?.summary;
  return (streamed?.unreadTables ?? []).filter(
    (t) => !eager?.unreadTables.includes(t),
  );
}

describe("what the streaming reader would not read, before a full read", () => {
  for (const name of [V3, BLOB, UNKNOWN, DEFAULTS, "format3_pose.slp"]) {
    it(`the lite reader lists it for ${name}, as the streaming summary does`, async () => {
      const lite = await loadSlpMetadata(slpBytes(name));
      expect(lite.streamingUnreadTables).toEqual(await streamingOnly(name));
      // The lite `format3` summary is the eager readers' one.
      expect(lite.format3).toEqual(
        (await readSlp(slpPath(name), EDIT)).sourceFormat?.summary,
      );
    });
  }

  it("the lite reader lists it for 2.x files too", async () => {
    // Python's 2.x link tables are compound datasets jsfive cannot read, so
    // their owner types are unknown and the tables are listed to be safe.
    expect((await loadSlpMetadata(slpBytes(V2))).streamingUnreadTables).toEqual(
      [
        "categories/links",
        "identity/links",
        "label_image_data",
        "label_image_obj_categories",
        "label_image_obj_names",
        "label_image_objects",
        "label_image_score_map_index",
        "label_image_score_maps",
        "label_image_sources",
        "label_images",
        "mask_categories",
        "mask_names",
        "mask_rle",
        "mask_score_map_index",
        "mask_score_maps",
        "mask_sources",
        "masks",
        "roi_categories",
        "roi_names",
        "roi_sources",
        "roi_wkb",
        "rois",
      ],
    );
    // A JS save stores the links as a flat table whose owner types it reads.
    const labels = await readSlp(slpPath("format3_pose.v2.slp"), {
      openVideos: false,
    });
    labels.labeledFrames[0].instances[0].identity = undefined;
    expect(
      (await loadSlpMetadata(await saveSlpToBytes(labels)))
        .streamingUnreadTables,
    ).toEqual([]);
  });
});

describe("loadSlp in a browser does not lose what the streaming reader skips", () => {
  /** The streaming reader over a fixture's stand-in, as `loadSlp` calls it. */
  const standIn =
    (name: string): StreamingReader =>
    async (_source, options) => {
      // The stand-in has no fast path for 2.x compound pose tables.
      let compound: Record<string, unknown> = {};
      if (name.endsWith(".v2.slp")) {
        const store = (await readSlpLazy(slpPath(name), { openVideos: false }))
          ._lazyDataStore!;
        compound = {
          frames: store.framesData,
          instances: store.instancesData,
          points: store.pointsData,
          pred_points: store.predPointsData,
        };
      }
      const { file, close } = await streamingFile(name, compound);
      try {
        return await readFromStreamingFile(
          file,
          `https://example.com/${name}`,
          undefined,
          false,
          undefined,
          false,
          false,
          false,
          false,
          false,
          options.format3,
          options.failIfIncomplete ?? false,
        );
      } finally {
        close();
      }
    };

  /** What `loadSlp` does in a browser: streaming first, else the main thread. */
  async function browserLoad(name: string, streamMode = "auto") {
    const labels = await readStreamingOrNull(
      slpPath(name),
      { format3: "edit" },
      streamMode,
      standIn(name),
    );
    return {
      streamed: labels !== null,
      labels: labels ?? (await readSlp(slpPath(name), EDIT)),
    };
  }

  it("reads a file with ROIs, masks and label images on the main thread", async () => {
    const { streamed, labels } = await browserLoad(V3);
    expect(streamed).toBe(false);
    const s = describe3(labels);
    expect(s).toEqual(describe3(await readSlp(slpPath(V3), EDIT)));
    expect(s.frames.flatMap((f) => f.masks)).toHaveLength(3);
    expect(labels.sourceFormat?.summary.unreadTables).toEqual([
      "categories/meta_key",
      "categories/meta_owner",
      "categories/meta_val",
    ]);
  });

  it("streams a file the streaming reader reads in full", async () => {
    const { streamed, labels } = await browserLoad("format3_pose.slp");
    expect(streamed).toBe(true);
    expect(labels.labeledFrames).toHaveLength(4);
  });

  it("both entry points export StreamingIncompleteError", async () => {
    const node = await import("../src/index.js");
    const browser = await import("../src/index.browser.js");
    expect(node.StreamingIncompleteError).toBe(StreamingIncompleteError);
    expect(browser.StreamingIncompleteError).toBe(StreamingIncompleteError);
  });

  it("the streaming reader refuses such a file when asked, naming what it skips", async () => {
    let error: unknown;
    try {
      await standIn(V3)(slpPath(V3), {
        format3: "edit",
        failIfIncomplete: true,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(StreamingIncompleteError);
    expect((error as StreamingIncompleteError).unread).toEqual(
      await streamingOnly(V3),
    );
  });

  it('stream mode "range" keeps streaming, and the summary lists the loss', async () => {
    const { streamed, labels } = await browserLoad(V3, "range");
    expect(streamed).toBe(true);
    expect(labels.sourceFormat?.summary.unreadTables).toContain("masks");
    expect(labels.labeledFrames.flatMap((f) => f.masks)).toEqual([]);
  });

  it("streams a 2.x file as before, without what the streaming reader skips", async () => {
    // An existing gap: the streaming reader reads no masks in any layout.
    const { streamed, labels } = await browserLoad(V2);
    expect(streamed).toBe(true);
    expect(labels.labeledFrames.flatMap((f) => f.masks)).toEqual([]);
    expect(labels.labeledFrames.flatMap((f) => f.instances)).toHaveLength(8);
  });
});

describe("a File read on a page's main thread", () => {
  const fileOf = (name: string) =>
    new File([slpBytes(name)], name, { type: "application/octet-stream" });

  it("is read whole into memory, never through WORKERFS", async () => {
    // A stand-in h5wasm module whose WORKERFS aborts outside a worker, as
    // h5wasm's browser build does.
    const written: string[] = [];
    const opened: string[] = [];
    const module = {
      FS: {
        filesystems: { WORKERFS: {} },
        mkdir: () => {},
        rmdir: () => {},
        unmount: () => {},
        mount: () => {
          throw new Error("Aborted: WORKERFS outside a worker");
        },
        writeFile: (path: string) => written.push(path),
      },
      File: class {
        constructor(path: string) {
          opened.push(path);
        }
        close() {}
      },
    };
    const { close } = await openH5FileBrowser(
      module as never,
      fileOf("format3_pose.slp"),
    );
    close();
    expect(written).toEqual(["/tmp-slp.slp"]);
    expect(opened).toEqual(["/tmp-slp.slp"]);
  });
});

describe("the store-merging writers and stores from 3.0 files", () => {
  const lazyEdit = async (name: string) => {
    const labels = await readSlpLazy(slpPath(name), EDIT);
    return { labels, store: labels._lazyDataStore! };
  };

  it("refuse a store whose identities, links or sessions they would drop", async () => {
    const { store } = await lazyEdit(V3);
    for (const write of [
      () => saveSlpMergedFromStores([store]),
      async () => {
        const writer = await openSlpWriter({
          skeletons: store.skeletons,
          videos: store.videos,
          tracks: store.tracks,
        });
        try {
          writer.appendStore(store);
        } finally {
          writer.close();
        }
      },
    ]) {
      let error: unknown;
      try {
        await write();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("its identities");
      expect(message).toContain(
        "the identities, categories or embeddings of its instances",
      );
      expect(message).toContain(
        "category scores or embeddings of its centroids, boxes, masks or ROIs",
      );
      expect(message).toContain("its recording sessions");
      expect(message).toContain("saveSlpToBytes");
    }
  });

  it("write such a store when the header carries what it holds", async () => {
    // Identities and sessions in the header are written; links are not, so
    // a store with links is still refused.
    const { labels, store } = await lazyEdit(V3);
    let error: unknown;
    try {
      await saveSlpMergedFromStores([store], {
        identities: labels.identities,
        sessions: labels.sessions,
      });
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).not.toContain("its identities");
    expect((error as Error).message).not.toContain("its recording sessions");
    expect((error as Error).message).toContain("of its instances");
  });

  it("in format 3.0, write the links and embeddings instead of refusing them", async () => {
    // A store kept in format 3.0 (the default) is merged in format 3.0, which
    // writes the links of its instances and annotations; identities and
    // sessions come from the header.
    const labels = await readSlpLazy(slpPath(V3), {
      openVideos: false,
      format3: "keep",
    });
    const store = labels._lazyDataStore!;
    const bytes = await saveSlpMergedFromStores([store], {
      identities: labels.identities,
      sessions: labels.sessions,
    });
    const back = await readSlp(tempFile(bytes), { openVideos: false });
    const linked = (l: Labels) =>
      describe3(l).frames.map((f) => [
        f.instances.map((i) => i.slice(0, 2)),
        f.centroids.map((c) => c[2]),
        f.bboxes.map((b) => b[3]),
      ]);
    expect(describe3(back).instances).toEqual(
      describe3(await readSlp(slpPath(V3), EDIT)).instances,
    );
    expect(linked(back)).toEqual(linked(await readSlp(slpPath(V3), EDIT)));
    // Without the identities in the header, they are still refused.
    let error: unknown;
    try {
      await saveSlpMergedFromStores([store]);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain("its identities");
    expect((error as Error).message).not.toContain("of its instances");
  });

  it("write stores of 3.0 files without such content, and of 2.x files, as before", async () => {
    const pose = (await lazyEdit("format3_pose.slp")).store;
    const bytes = await saveSlpMergedFromStores([pose]);
    expect(
      (await readSlp(bytes, { openVideos: false })).labeledFrames,
    ).toHaveLength(4);
    // A 2.x store with the same content is written (the existing gap: the
    // links and sessions are not).
    const twin = (await readSlpLazy(slpPath(V2), { openVideos: false }))
      ._lazyDataStore!;
    const back = await readSlp(await saveSlpMergedFromStores([twin]), {
      openVideos: false,
    });
    expect(back.labeledFrames.flatMap((f) => f.instances)).toHaveLength(8);
    expect(back.sessions).toHaveLength(0);
  });
});

describe("what the store-merging writers keep", () => {
  /**
   * A lazy edit load of format3_tables.slp keeping only the categories of
   * its centroids, boxes, masks and ROIs (no identity, score or embedding,
   * no instance link, no session), so only what the writers keep is left.
   */
  async function columnCategoriesOnly() {
    const labels = await readSlpLazy(slpPath(V3), EDIT);
    const store = labels._lazyDataStore!;
    store.identities = [];
    store._instanceIdentityLinks = undefined;
    store._instanceCategoryLinks = undefined;
    store._instanceEmbeddings = undefined;
    store._instanceCategoryEmbeddings = undefined;
    store.sourceSessionCount = 0;
    for (const [byFrame, undistributed] of [
      [store._centroidByFrame, store._undistributedCentroids],
      [store._bboxByFrame, store._undistributedBboxes],
      [store._maskByFrame, store._undistributedMasks],
      [store._roiByFrame, store._undistributedRois],
      // biome-ignore lint/suspicious/noExplicitAny: every detection kind
    ] as Array<[Map<string, any[]>, any[]]>) {
      for (const d of [...undistributed, ...[...byFrame.values()].flat()]) {
        d.identity = null;
        d.identityScore = null;
        d.categoryScore = null;
      }
    }
    return { labels, store };
  }

  it("a category of a centroid, box, mask or ROI is kept, so not refused", async () => {
    const { store } = await columnCategoriesOnly();
    const back = await readSlp(await saveSlpMergedFromStores([store]), {
      openVideos: false,
    });
    const categories = back.labeledFrames.flatMap((f) =>
      [...f.masks, ...f.bboxes, ...f.centroids].map((d) => d.category),
    );
    expect(categories).toContain("body");
    expect(categories).toContain("female");
  });

  it("a category score is not kept, so refused", async () => {
    const { store } = await columnCategoriesOnly();
    store._bboxByFrame.values().next().value![0].categoryScore = 0.5;
    await expect(saveSlpMergedFromStores([store])).rejects.toThrow(
      "category scores or embeddings of its centroids, boxes, masks or ROIs",
    );
  });
});

describe("SlpStreamWriter.appendFrames and frames from 3.0 files", () => {
  const append = async (labels: Labels) => {
    const writer = await openSlpWriter({
      skeletons: labels.skeletons,
      videos: labels.videos,
      tracks: labels.tracks,
    });
    try {
      writer.appendFrames(labels.labeledFrames);
    } finally {
      writer.close();
    }
  };

  it("refuses frames whose links it would drop, before writing", async () => {
    const labels = await readSlp(slpPath(V3), EDIT);
    await expect(append(labels)).rejects.toThrow(
      "the identities, categories or embeddings of their instances, and the " +
        "identities, category scores or embeddings of their centroids",
    );
  });

  it("writes frames without such content", async () => {
    await append(await readSlp(slpPath("format3_pose.slp"), EDIT));
  });

  it("writes frames of 2.x files as before", async () => {
    await append(await readSlp(slpPath(V2), { openVideos: false }));
  });
});

describe("the streaming reader's userInstancesOnly and a 3.0 file", () => {
  const read = async (name: string, format3: "view" | "edit") => {
    const { file, close } = await streamingFile(name);
    try {
      return await readFromStreamingFile(
        file,
        `https://example.com/${name}`,
        undefined,
        false,
        undefined,
        false,
        false,
        false,
        true, // userInstancesOnly
        false,
        format3,
      );
    } finally {
      close();
    }
  };

  it("cannot be opened for editing, since a save would lose what it skips", async () => {
    await expect(read(V3, "edit")).rejects.toThrow(
      "userInstancesOnly drops its predicted instances and sessions",
    );
  });

  it("can be opened for viewing", async () => {
    const labels = await read(V3, "view");
    expect(labels.labeledFrames.flatMap((f) => f.instances)).toHaveLength(3);
  });
});

describe("box and centroid flags", () => {
  it("read any nonzero is_predicted as predicted, as Python does", async () => {
    // Boxes and centroids are groups of columns in every layout; their
    // is_predicted is stored as uint8, which h5wasm can write.
    const file = await editedCopy(V3, (h5) => {
      for (const p of ["bboxes/is_predicted", "centroids/is_predicted"]) {
        // biome-ignore lint/suspicious/noExplicitAny: h5wasm Dataset
        (h5.get(p) as any).write_slice([[0, 1]], new Uint8Array([2]));
      }
    });
    const labels = await readSlp(file, EDIT);
    const frame = labels.labeledFrames[0];
    expect(frame.bboxes[0].constructor.name).toBe("PredictedBoundingBox");
    expect(frame.centroids[0].constructor.name).toBe("PredictedCentroid");
  });
});

describe("sub-tables this version does not know", () => {
  it("are listed as unread by every reader", async () => {
    const file = await editedCopy(V3, (h5) => {
      // biome-ignore lint/suspicious/noExplicitAny: h5wasm Group
      (h5.get("masks") as any).create_group("future");
    });
    const summaries = [
      (await readSlp(file, EDIT)).sourceFormat?.summary,
      (await readSlpLazy(file, EDIT)).sourceFormat?.summary,
      (await readStreaming(file)).sourceFormat?.summary,
      (await loadSlpMetadata(new Uint8Array(readFileSync(file)))).format3,
    ];
    for (const summary of summaries) {
      expect(summary?.unreadTables).toContain("masks/future");
      expect(summary?.lossless).toBe(false);
    }
  });
});

describe("unknown columns of the format 3.0 tables", () => {
  const EXPECTED = [
    "categories/links/extra",
    "identity/links/extra",
    "label_images/extra",
    "label_images/objects/extra",
    "label_images/score_maps/extra",
    "masks/extra",
    "masks/score_maps/extra",
    "rois/extra",
    "session_data/frame_groups/extra",
    "session_data/instance_group_members/extra",
    "session_data/instance_groups/extra",
  ];

  const summaries: Array<[string, () => Promise<Format3Summary | undefined>]> =
    [
      [
        "readSlp (the choice error)",
        async () => {
          try {
            await readSlp(slpPath(UNKNOWN), {
              openVideos: false,
              format3: "ask",
            });
          } catch (e) {
            if (e instanceof SlpFormat3ChoiceError) return e.summary;
            throw e;
          }
        },
      ],
      [
        "readSlpLazy",
        async () =>
          (await readSlpLazy(slpPath(UNKNOWN), EDIT)).sourceFormat?.summary,
      ],
      [
        "readFromStreamingFile",
        async () => (await readStreaming(UNKNOWN)).sourceFormat?.summary,
      ],
      [
        "loadSlpMetadata (lite)",
        async () => (await loadSlpMetadata(slpBytes(UNKNOWN))).format3,
      ],
    ];
  for (const [label, summary] of summaries) {
    it(`are listed in the summary by ${label}`, async () => {
      const s = await summary();
      expect(s?.unknownColumns).toEqual(EXPECTED);
      expect(s?.lossless).toBe(false);
    });
  }

  it("do not change what the readers read", async () => {
    expect(describe3(await readSlp(slpPath(UNKNOWN), EDIT))).toEqual(
      describe3(await readSlp(slpPath(V3), EDIT)),
    );
  });

  it("the choice error names them as what an edit drops", async () => {
    let error: unknown;
    try {
      await readSlp(slpPath(UNKNOWN), { openVideos: false, format3: "ask" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SlpFormat3ChoiceError);
    expect((error as Error).message).toContain("rois/extra");
  });

  it("files without them list none", async () => {
    for (const name of [V3, BLOB, DEFAULTS]) {
      const summary = (await readSlp(slpPath(name), EDIT)).sourceFormat
        ?.summary;
      expect([name, summary?.unknownColumns]).toEqual([name, []]);
      // What they hold that an edit drops: the metadata of a category, which
      // this version does not read (categories are plain strings).
      expect([name, summary?.unreadTables]).toEqual([
        name,
        ["categories/meta_key", "categories/meta_owner", "categories/meta_val"],
      ]);
      expect(summary?.lossless).toBe(false);
    }
  });

  it("are dropped by an edit save", async () => {
    await ready;
    for (const lazy of [false, true]) {
      const labels = lazy
        ? await readSlpLazy(slpPath(UNKNOWN), EDIT)
        : await readSlp(slpPath(UNKNOWN), EDIT);
      const bytes = await saveSlpToBytes(labels);
      const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-tables-"));
      const file = path.join(dir, "saved.slp");
      writeFileSync(file, bytes);
      const h5 = new H5File(file, "r");
      const names: string[] = [];
      const visit = (p: string) => {
        const node = (p ? h5.get(p) : h5) as any;
        if (node?.type !== "Group") return;
        for (const k of node.keys() as string[]) {
          const child = p ? `${p}/${k}` : k;
          names.push(child);
          visit(child);
        }
      };
      visit("");
      h5.close();
      expect(
        names.filter((n) => n.endsWith("/extra") || n === "extra"),
      ).toEqual([]);
      // The 2.x layout: no table is a group of columns any more.
      expect(names).toContain("roi_wkb");
      expect(names).toContain("mask_rle");
      expect(names).toContain("label_image_data");
    }
  });
});

/** The edit saves to check, as calls that save a fixture loaded for editing. */
const SAVES: Array<[string, (name: string) => Promise<Uint8Array>]> = [
  [
    "an eager save",
    async (n) => saveSlpToBytes(await readSlp(slpPath(n), EDIT)),
  ],
  [
    "a lazy save",
    async (n) => saveSlpToBytes(await readSlpLazy(slpPath(n), EDIT)),
  ],
];

/** Write `bytes` to a new temp file and return its path. */
function tempFile(bytes: Uint8Array, name = "saved.slp"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-tables-"));
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return file;
}

describe("2.x files written by earlier sleap-io.js versions", () => {
  for (const [old, v2] of [
    ["js_written_annotations.slp", V2],
    ["js_written_label_images_blob.slp", BLOB_V2],
  ]) {
    it(`${old} reads as the Python-written file it was saved from`, async () => {
      const read = async (n: string) => {
        const d = describe3(await readSlp(slpPath(n), { openVideos: false }));
        // Earlier versions read no session metadata from Python files, so
        // these files have none to keep.
        for (const session of d.sessions) session.metadata = {};
        return d;
      };
      expect(await read(old)).toEqual(await read(v2));
    });
  }
});

describe("edit saves of the format 3.0 tables", () => {
  for (const [what, save] of SAVES) {
    for (const [v3, v2] of [
      [V3, V2],
      [UNKNOWN, V2],
      [BLOB, BLOB_V2],
    ]) {
      it(`${what} of ${v3} reads back as the same save of the 2.x twin`, async () => {
        const back = await readSlp(tempFile(await save(v3)), {
          openVideos: false,
        });
        expect(back.sourceFormat).toBeNull();
        expect(describe3(back)).toEqual(
          describe3(
            await readSlp(tempFile(await save(v2)), { openVideos: false }),
          ),
        );
      });
    }
  }

  for (const [what, save] of SAVES) {
    it(`${what} reads back as the 2.x twin itself`, async () => {
      for (const [v3, v2] of [
        [V3, V2],
        [BLOB, BLOB_V2],
      ]) {
        const back = await readSlp(tempFile(await save(v3)), {
          openVideos: false,
        });
        expect(describe3(back)).toEqual(
          describe3(await readSlp(slpPath(v2), { openVideos: false })),
        );
      }
    });
  }

  it("a lazy save of a 2.x file keeps its identity and category links", async () => {
    const bytes = await saveSlpToBytes(
      await readSlpLazy(slpPath("py_written_27_category.slp"), {
        openVideos: false,
      }),
    );
    // The format the links need (2.7), as an eager save writes.
    expect((await loadSlpMetadata(bytes)).formatId).toBe(2.7);
    const back = await readSlp(tempFile(bytes), { openVideos: false });
    const eager = await readSlp(slpPath("py_written_27_category.slp"), {
      openVideos: false,
    });
    const links = (labels: Labels) =>
      labels.labeledFrames.flatMap((f) =>
        f.instances.map((i) => [
          i.identity?.name ?? null,
          i.identityScore ?? null,
          i.category ?? null,
          i.categoryScore ?? null,
        ]),
      );
    expect(links(back)).toEqual(links(eager));
    expect(links(eager).some(([, , c]) => c !== null)).toBe(true);
  });
});

describe("view-only content of the format 3.0 tables", () => {
  /** Labels holding only `take(view)` of a view-only load, as new labels. */
  const cases: Array<[string, (view: Labels) => Labels]> = [
    [
      "a frame ROI",
      (view) => {
        const roi = view.labeledFrames[0].rois[0];
        return new Labels({
          videos: view.videos,
          labeledFrames: [
            new LabeledFrame({
              video: view.videos[0],
              frameIdx: 0,
              rois: [roi],
            }),
          ],
        });
      },
    ],
    [
      "a static ROI",
      (view) => new Labels({ videos: view.videos, rois: view.staticRois }),
    ],
    [
      "a mask",
      (view) =>
        new Labels({
          videos: view.videos,
          labeledFrames: [
            new LabeledFrame({
              video: view.videos[0],
              frameIdx: 0,
              masks: [view.labeledFrames[4].masks[0]],
            }),
          ],
        }),
    ],
    [
      "a label image",
      (view) =>
        new Labels({
          videos: view.videos,
          labeledFrames: [
            new LabeledFrame({
              video: view.videos[0],
              frameIdx: 0,
              labelImages: [view.labeledFrames[0].labelImages[0]],
            }),
          ],
        }),
    ],
    [
      "a recording session (copied)",
      (view) =>
        new Labels({
          videos: view.videos,
          skeletons: view.skeletons,
          sessions: view.sessions.map((s) => cloneRecordingSession(s)),
        }),
    ],
  ];

  for (const [what, take] of cases) {
    it(`${what} is refused by every SLP writer`, async () => {
      const view = await readSlp(slpPath(V3), VIEW);
      const labels = take(view);
      expect(labels.sourceFormat).toBeNull();
      const writers: Array<() => Promise<unknown>> = [
        () => saveSlpToBytes(labels),
        () => saveSlpStructureToBytes(labels),
      ];
      // The streaming writer's header holds sessions, not frames.
      if (labels.sessions.length > 0) {
        writers.push(() =>
          openSlpWriter({
            skeletons: labels.skeletons,
            videos: labels.videos,
            sessions: labels.sessions,
          }),
        );
      }
      for (const write of writers) {
        await expect(write()).rejects.toBeInstanceOf(SlpViewOnlyError);
      }
    });
  }

  it("records read from these tables carry the choice", async () => {
    for (const read of [
      () => readSlp(slpPath(V3), VIEW),
      async () => {
        const labels = await readSlpLazy(slpPath(V3), VIEW);
        labels.materialize();
        return labels;
      },
      () => readStreaming(V3, { format3: "view" }),
    ]) {
      const labels = await read();
      const records: object[] = [
        ...labels.labeledFrames.flatMap((f) => [
          ...f.rois,
          ...f.masks,
          ...f.labelImages,
        ]),
        ...labels.staticRois,
        ...labels.sessions.flatMap((s) =>
          [...s.frameGroups.values()].flatMap((fg) => [
            fg,
            ...fg.instanceGroups,
          ]),
        ),
      ];
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(sourceMarkOf(record)?.access).toBe("view");
      }
    }
  });

  it("copies of the labels keep the choice of static ROIs and sessions", async () => {
    const copy = (await readSlp(slpPath(V3), VIEW)).copy();
    const records: object[] = [
      ...copy.staticRois,
      ...copy.sessions.flatMap((s) =>
        [...s.frameGroups.values()].flatMap((fg) => [fg, ...fg.instanceGroups]),
      ),
    ];
    expect(records.length).toBe(2 + 2 + 3);
    for (const record of records) {
      expect(sourceMarkOf(record)?.access).toBe("view");
    }
  });

  it("setSourceAccess switches the session records too", async () => {
    const labels = await readSlp(slpPath(V3), VIEW);
    await expect(saveSlpToBytes(labels)).rejects.toBeInstanceOf(
      SlpViewOnlyError,
    );
    const sessions = labels.sessions;
    setSourceAccess(labels, "edit");
    const fg = [...sessions[0].frameGroups.values()][0];
    expect(sourceMarkOf(fg)?.access).toBe("edit");
    expect(sourceMarkOf(fg.instanceGroups[0])?.access).toBe("edit");
    expect(sourceMarkOf(labels.staticRois[0])?.access).toBe("edit");
    const bytes = await saveSlpToBytes(labels);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("a lazy view-only load is refused by the merged-store writer", async () => {
    const labels = await readSlpLazy(slpPath(V3), VIEW);
    await expect(
      saveSlpMergedFromStores([labels._lazyDataStore!]),
    ).rejects.toBeInstanceOf(SlpViewOnlyError);
  });
});

/** A copy of a fixture whose datasets `edit` changes, in a temp dir. */
async function editedCopy(
  name: string,
  edit: (h5: H5File) => void,
): Promise<string> {
  await ready;
  const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-tables-"));
  const file = path.join(dir, name);
  copyFileSync(slpPath(name), file);
  const h5 = new H5File(file, "a");
  try {
    edit(h5);
  } finally {
    h5.close();
  }
  return file;
}

/** Overwrite a 1-D int64 column with `values` (of its length). */
function setColumn(h5: H5File, p: string, values: number[]): void {
  const ds = h5.get(p) as any;
  expect(ds.shape).toEqual([values.length]);
  ds.write_slice([[0, values.length]], new BigInt64Array(values.map(BigInt)));
}

describe("session metadata", () => {
  it("is read from the top level (Python) and from a `metadata` key (earlier sleap-io.js)", () => {
    const structure = {
      calibration: {},
      camcorder_to_video_idx_map: {},
      fg_start: 0,
      fg_end: 1,
    };
    expect(
      sessionMetadataFromJson({ ...structure, rig: "three", n: 2 }),
    ).toEqual({ rig: "three", n: 2 });
    expect(
      sessionMetadataFromJson({ ...structure, metadata: { rig: "three" } }),
    ).toEqual({ rig: "three" });
    expect(sessionMetadataFromJson({ ...structure, metadata: {} })).toEqual({});
  });

  it("the lite reader reads it too", async () => {
    const meta = await loadSlpMetadata(slpBytes(V3));
    expect(meta.sessions[0].metadata).toEqual({ rig: "three" });
  });
});

describe("predicted masks and label images without a score", () => {
  it("read a score of 0, as Python sleap-io reads them", async () => {
    const file = await editedCopy(V3, (h5) => {
      for (const p of ["masks/score", "label_images/score"]) {
        // biome-ignore lint/suspicious/noExplicitAny: h5wasm Dataset
        const ds = h5.get(p) as any;
        const n = ds.shape[0];
        ds.write_slice([[0, n]], new Float64Array(n).fill(Number.NaN));
      }
    });
    for (const read of [
      () => readSlp(file, EDIT),
      async () => {
        const labels = await readSlpLazy(file, EDIT);
        labels.materialize();
        return labels;
      },
    ]) {
      const s = describe3(await read());
      const scores = s.frames.flatMap((f) => [
        ...f.masks.filter((m) => m.kind.startsWith("Predicted")),
        ...f.labelImages.filter((li) => li.kind.startsWith("Predicted")),
      ]);
      expect(scores.map((x) => x.score)).toEqual([0, 0]);
    }
  });
});

describe("range checks of the format 3.0 tables", () => {
  const cases: Array<[string, string, number[], string]> = [
    ["an ROI video", "rois/video", [0, 9, 0, -1], "/rois video"],
    ["an ROI geometry range", "rois/wkb_end", [1, 2, 3, 999], "/rois wkb"],
    ["a mask instance", "masks/instance", [1, 0, 99], "/masks instance"],
    [
      "a mask from_predicted",
      "masks/from_predicted",
      [-1, 7, -1],
      "/masks from_predicted",
    ],
    [
      "a mask score map owner",
      "masks/score_maps/mask_idx",
      [5],
      "/masks/score_maps mask_idx",
    ],
    [
      "a label image object range",
      "label_images/n_objects",
      [2, 9],
      "/label_images object ranges",
    ],
    [
      "a label image object track",
      "label_images/objects/track",
      [0, 1, 5],
      "/label_images/objects track",
    ],
    [
      "a label image score map owner",
      "label_images/score_maps/li_idx",
      [2],
      "/label_images/score_maps li_idx",
    ],
    [
      "an identity link",
      "identity/links/identity_idx",
      [0, 1, 0, 2, 0, 0],
      "/identity/links identity_idx",
    ],
    [
      "a category link",
      "categories/links/category_idx",
      [0, 1, 1, 0, 4, 1, 0, 1],
      "/categories/links category_idx",
    ],
    [
      "a frame group range",
      "session_data/frame_groups/ig_end",
      [2, 9],
      "/session_data/frame_groups ranges",
    ],
    [
      "an instance group identity",
      "session_data/instance_groups/identity_idx",
      [0, -1, 5],
      "/session_data/instance_groups identity_idx",
    ],
    [
      "a member frame",
      "session_data/instance_group_members/lf",
      [0, 1, 2, 0, 1, 3, 4, 60],
      "/session_data/instance_group_members lf",
    ],
  ];
  for (const [what, column, values, message] of cases) {
    it(`refuse ${what}, naming the table`, async () => {
      const file = await editedCopy(V3, (h5) => setColumn(h5, column, values));
      const readers: Array<() => Promise<unknown>> = [
        () => readSlp(file, EDIT),
        () => readSlpLazy(file, EDIT),
      ];
      // The streaming reader reads the links and the session tables.
      if (column.startsWith("identity") || column.startsWith("categories")) {
        readers.push(() => readStreaming(file));
      }
      if (column.startsWith("session_data")) {
        // The streaming and lite readers read the session tables too.
        readers.push(() => readStreaming(file));
        readers.push(() => loadSlpMetadata(new Uint8Array(readFileSync(file))));
      }
      for (const read of readers) {
        let error: unknown;
        try {
          await read();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(SlpTableError);
        expect((error as SlpFormatError).formatId).toBe(3);
        expect((error as Error).message).toContain(message);
      }
    });
  }

  it("refuse an unknown column of another length, as Python does", async () => {
    const file = await editedCopy(V3, (h5) => {
      // biome-ignore lint/suspicious/noExplicitAny: h5wasm Group
      (h5.get("rois") as any).create_dataset({
        name: "extra",
        data: new Float64Array(2),
        shape: [2],
        dtype: "<d",
      });
    });
    for (const read of [
      () => readSlp(file, EDIT),
      () => readSlpLazy(file, EDIT),
    ]) {
      await expect(read()).rejects.toThrow(
        "/rois columns of different lengths",
      );
    }
  });

  it("refuse a 3.0 table whose columns differ in length", async () => {
    const file = await editedCopy(V3, (h5) => {
      (h5.get("identity/links/owner_type") as any).resize([5]);
    });
    for (const read of [
      () => readSlp(file, EDIT),
      () => readSlpLazy(file, EDIT),
      () => readStreaming(file),
    ]) {
      await expect(read()).rejects.toThrow(
        "/identity/links columns of different lengths",
      );
    }
  });

  it("the check functions report each problem", () => {
    const t = (table: Parameters<typeof tableFromColumns>[0], cols: object) =>
      tableFromColumns(table, cols as never, "x.slp");
    const counts = { nVideos: 1, nTracks: 1, nInstances: 2 };
    const rois = t("rois", {
      video: [0, 1],
      frame_idx: [0, 0],
      track: [-1, 3],
      instance: [2, -1],
      wkb_start: [0, 5],
      wkb_end: [5, 11],
    });
    expect(roiProblems(rois, 10, counts)).toEqual([
      "/rois video is not one of the 1 videos",
      "/rois track is not one of the 1 tracks",
      "/rois instance is not one of the 2 instances",
      "/rois wkb ranges fall outside the buffer (10)",
    ]);
    const masks = t("masks", {
      height: [1],
      width: [1],
      video: [-1],
      frame_idx: [0],
      track: [-1],
      from_predicted: [1],
      rle_start: [2],
      rle_end: [1],
    });
    expect(maskProblems(masks, 4, counts)).toEqual([
      "/masks from_predicted is not a mask row",
      "/masks rle ranges fall outside the buffer (4)",
    ]);
    const sm = t("masks/score_maps", {
      mask_idx: [-1],
      data_start: [0],
      data_end: [3],
      height: [1],
      width: [1],
    });
    expect(scoreMapProblems("masks/score_maps", sm, 1, 2)).toEqual([
      "/masks/score_maps mask_idx is not one of the 1 /masks",
      "/masks/score_maps ranges fall outside the buffer (2)",
    ]);
    const li = t("label_images", {
      video: [0],
      frame_idx: [0],
      height: [1],
      width: [1],
      n_objects: [1],
      objects_start: [0],
      data_start: [0],
      data_end: [0],
    });
    const objects = t("label_images/objects", {
      label_id: [1],
      track: [0],
      instance: [5],
    });
    expect(labelImageProblems(li, objects, null, counts)).toEqual([
      "/label_images has no pixel data",
      "/label_images/objects instance is not one of the 2 instances",
    ]);
    expect(labelImageProblems(li, objects, [0, 1, 1], counts)[0]).toBe(
      "/label_images has 1 rows but 0 frames of data",
    );
    const links = t("identity/links", {
      owner_type: [0],
      owner_id: [0],
      identity_idx: [-1],
      identity_score: [Number.NaN],
    });
    expect(linkProblems("identity/links", links, 2)).toEqual([
      "/identity/links identity_idx is not one of the 2 catalog entries",
    ]);
    expect(linkProblems("identity/links", links, null)).toEqual([]);
    expect(
      sessionProblems({
        frameGroups: t("session_data/frame_groups", {
          frame_idx: [0],
          ig_start: [0],
          ig_end: [1],
        }),
        instanceGroups: t("session_data/instance_groups", {
          identity_idx: [-1],
          score: [1],
          instance_3d_score: [1],
          pts3d_start: [0],
          pts3d_end: [4],
          pts3d_predicted: [1],
          member_start: [0],
          member_end: [1],
        }),
        members: t("session_data/instance_group_members", {
          camera: [-1],
          lf: [0],
          inst: [0],
        }),
        nPoints3d: 9,
        nPredPoints3d: 3,
        nIdentities: 0,
        nFrames: 1,
      }),
    ).toEqual([
      "/session_data/instance_groups 3D ranges fall outside pred_points_3d (3 rows)",
      "/session_data/instance_group_members has negative indices",
    ]);
  });

  it("tableFromColumns refuses a missing required column, naming it", () => {
    expect(() =>
      tableFromColumns("identity/links", { owner_type: [0] }, "x.slp"),
    ).toThrow("/identity/links table without the required column(s)");
  });
});

/** Python interpreters to read JS saves back with, and how to run them. */
function pythons(): Array<{ label: string; cmd: string; args: string[] }> {
  const listed = process.env.SLEAP_IO_TEST_PYTHONS;
  if (listed) {
    return listed
      .split(",")
      .filter(Boolean)
      .map((exe) => ({ label: exe, cmd: exe, args: [] }));
  }
  return [
    {
      label: "uv run --with sleap-io",
      cmd: "uv",
      args: ["run", "--with", "sleap-io", "python"],
    },
  ];
}

const SKIP_PYTHON = process.env.SLEAP_IO_SKIP_PYTHON_TESTS === "1";

/** Describe a file's ROIs, masks, label images, links and sessions in Python. */
const DESCRIBE_PY = `
import json, math, sys
import h5py
import numpy as np
import sleap_io as sio
path = sys.argv[1]
labels = sio.load_slp(path)
with h5py.File(path, "r") as f:
    format_id = float(f["metadata"].attrs["format_id"])
def num(v):
    if v is None:
        return None
    v = float(v)
    return "nan" if math.isnan(v) else v
def name(o):
    if o is None:
        return None
    return getattr(o, "name", o)
insts = [i for lf in labels.labeled_frames for i in lf.instances]
def idx(i):
    return None if i is None else next(k for k, x in enumerate(insts) if x is i)
def det(d):
    return [name(getattr(d, "identity", None)), num(getattr(d, "identity_score", None)),
            name(getattr(d, "category", None)) or None, num(getattr(d, "category_score", None))]
masks = [m for lf in labels.labeled_frames for m in lf.masks]
def roi(r):
    return [type(r).__name__, r.geometry.wkt, r.name, r.source,
            None if r.video is None else labels.videos.index(r.video),
            name(r.track), num(r.tracking_score), idx(r.instance),
            num(getattr(r, "score", None)), det(r)]
frames = []
for lf in labels.labeled_frames:
    frames.append({
        "video": labels.videos.index(lf.video), "frame_idx": int(lf.frame_idx),
        "instances": [[type(i).__name__, name(i.track), det(i)] for i in lf.instances],
        "rois": [roi(r) for r in lf.rois],
        "masks": [[type(m).__name__, int(m.height), int(m.width),
                   np.asarray(m.rle_counts).tolist(), m.name, m.source,
                   name(m.track), num(m.tracking_score), idx(m.instance),
                   None if getattr(m, "from_predicted", None) is None
                   else next(k for k, x in enumerate(masks) if x is m.from_predicted),
                   list(map(float, m.scale)), list(map(float, m.offset)),
                   num(getattr(m, "score", None)),
                   None if getattr(m, "score_map", None) is None
                   else np.asarray(m.score_map).ravel().tolist(),
                   None if getattr(m, "score_map", None) is None
                   else [list(map(float, m.score_map_scale)), list(map(float, m.score_map_offset))],
                   det(m)]
                  for m in lf.masks],
        "label_images": [[type(li).__name__, np.asarray(li.data).tolist(), li.source,
                          list(map(float, li.scale)), list(map(float, li.offset)),
                          num(getattr(li, "score", None)),
                          None if getattr(li, "score_map", None) is None
                          else np.asarray(li.score_map).ravel().tolist(),
                          None if getattr(li, "score_map", None) is None
                          else [list(map(float, li.score_map_scale)), list(map(float, li.score_map_offset))],
                          sorted([int(k), o.name, name(o.category) or "", name(o.track),
                                  idx(o.instance), num(o.score), num(o.tracking_score)]
                                 for k, o in li.objects.items())]
                         for li in lf.label_images],
        "centroids": [[float(c.x), float(c.y), det(c)] for c in lf.centroids],
        "bboxes": [[float(b.x1), float(b.y2), idx(b.instance), det(b)] for b in lf.bboxes],
    })
lf_index = {id(lf): k for k, lf in enumerate(labels.labeled_frames)}
sessions = []
for s in labels.sessions:
    groups = []
    for fi, fg in sorted(s.frame_groups.items()):
        groups.append({
            "frame_idx": int(fi), "metadata": fg.metadata,
            "frames": sorted([c.name, lf_index[id(fg.get_frame(c))]] for c in fg.cameras),
            "groups": [{
                "members": sorted([c.name, idx(i)] for c, i in ig.instance_by_camera.items()),
                "score": num(ig.score), "identity": name(ig.identity), "metadata": ig.metadata,
                "kind": None if ig.instance_3d is None else type(ig.instance_3d).__name__,
                "points": None if ig.instance_3d is None
                    else [[num(v) for v in p] for p in np.asarray(ig.instance_3d.points).tolist()],
                "score3d": None if ig.instance_3d is None else num(ig.instance_3d.score),
            } for ig in fg.instance_groups],
        })
    sessions.append({
        "cameras": [[c.name, labels.videos.index(s.get_video(c))] for c in s.camera_group.cameras],
        "metadata": dict(s.metadata),
        "frame_groups": groups,
    })
print(json.dumps({
    "version": sio.__version__,
    "format_id": format_id,
    "identities": [[i.name, dict(i.metadata)] for i in labels.identities],
    "frames": frames,
    "static_rois": [roi(r) for r in labels.static_rois],
    "sessions": sessions,
}))
`;

/** Run DESCRIBE_PY on `file` with `python`. */
function describeInPython(
  python: { cmd: string; args: string[] },
  file: string,
): Record<string, unknown> {
  const out = execFileSync(
    python.cmd,
    [...python.args, "-c", DESCRIBE_PY, file],
    {
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).toString();
  return JSON.parse(out.trim().split("\n").pop()!);
}

describe("an edit save of the format 3.0 tables reads back in Python", () => {
  for (const python of pythons()) {
    for (const [what, save] of SAVES) {
      for (const [v3, v2] of [
        [V3, V2],
        [UNKNOWN, V2],
        [BLOB, BLOB_V2],
      ]) {
        it.skipIf(SKIP_PYTHON)(
          `${what} of ${v3}, with ${python.label}`,
          async () => {
            // Throws (fails the test) if this Python cannot run.
            const saved = describeInPython(python, tempFile(await save(v3)));
            console.log(
              `${what} of ${v3} read back with sleap-io ${saved.version} (${python.label})`,
            );
            expect(saved.format_id).toBeLessThan(3);
            // As Python reads the same save of the 2.x twin, and the 2.x twin
            // it wrote itself.
            expect(saved).toEqual(
              describeInPython(python, tempFile(await save(v2))),
            );
            const { format_id: _a, ...rest } = saved;
            const { format_id: _b, ...fixture } = describeInPython(
              python,
              slpPath(v2),
            );
            expect(rest).toEqual(fixture);
          },
        );
      }
    }
    it.skipIf(SKIP_PYTHON)(
      `a save of a 2.x file with these tables, with ${python.label}`,
      async () => {
        for (const v2 of [V2, BLOB_V2]) {
          const labels = await readSlp(slpPath(v2), { openVideos: false });
          expect(labels.sourceFormat).toBeNull();
          const { format_id: _a, ...saved } = describeInPython(
            python,
            tempFile(await saveSlpToBytes(labels)),
          );
          const { format_id: _b, ...fixture } = describeInPython(
            python,
            slpPath(v2),
          );
          expect(saved).toEqual(fixture);
        }
      },
    );
  }
});

/** format3_tables.slp with a score map scale and offset that are not 1 and 0. */
const spatialScoreMaps = () =>
  editedCopy(V3, (h5) => {
    const set = (p: string, v: number) =>
      // biome-ignore lint/suspicious/noExplicitAny: h5wasm Dataset
      (h5.get(p) as any).write_slice([[0, 1]], new Float64Array([v]));
    set("masks/score_maps/scale_x", 2);
    set("masks/score_maps/offset_y", 3);
    set("label_images/score_maps/scale_y", 0.5);
    set("label_images/score_maps/offset_x", -4);
  });

/** The score map scale and offset of the predicted masks and label images. */
function scoreMapSpatial(labels: Labels) {
  const s = describe3(labels);
  return s.frames.flatMap((f) =>
    [...f.masks, ...f.labelImages]
      .filter((x) => x.scoreMapSpatial !== null)
      .map((x) => x.scoreMapSpatial),
  );
}

describe("score map scale and offset", () => {
  const EXPECTED = [
    [
      [2, 1],
      [0, 3],
    ],
    [
      [1, 0.5],
      [-4, 0],
    ],
  ];

  it("are read from every layout and survive a save", async () => {
    const file = await spatialScoreMaps();
    const labels = await readSlp(file, EDIT);
    expect(scoreMapSpatial(labels)).toEqual(EXPECTED);
    const lazy = await readSlpLazy(file, EDIT);
    lazy.materialize();
    expect(scoreMapSpatial(lazy)).toEqual(EXPECTED);
    // A 2.x save stores them in the score map index, as Python does.
    const back = await readSlp(tempFile(await saveSlpToBytes(labels)), {
      openVideos: false,
    });
    expect(scoreMapSpatial(back)).toEqual(EXPECTED);
  });

  for (const python of pythons()) {
    it.skipIf(SKIP_PYTHON)(
      `read back in Python from a 2.x save, with ${python.label}`,
      async () => {
        const labels = await readSlp(await spatialScoreMaps(), EDIT);
        const saved = describeInPython(
          python,
          tempFile(await saveSlpToBytes(labels)),
        );
        const frames = saved.frames as Array<{
          masks: unknown[][];
          label_images: unknown[][];
        }>;
        const spatial = frames.flatMap((f) => [
          ...f.masks.map((m) => m[14]).filter((x) => x !== null),
          ...f.label_images.map((li) => li[7]).filter((x) => x !== null),
        ]);
        expect(spatial).toEqual(EXPECTED);
      },
    );
  }
});

describe("2.x saves of these tables, regressions", () => {
  /**
   * Labels with a label image whose compressed pixels take more than 2^24
   * bytes, followed by a small one, so the second one's byte range starts
   * past 16 MB at an odd offset, which a float32 column cannot hold.
   */
  function largeLabelImages(): { labels: Labels; firstSum: number } {
    const height = 2400;
    let width = 2400;
    let pixels: Int32Array;
    // Pseudo-random 24-bit labels barely compress; widen until the
    // compressed length (the second image's offset) is odd.
    for (;;) {
      pixels = new Int32Array(height * width);
      let state = 12345;
      for (let i = 0; i < pixels.length; i += 1) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        pixels[i] = state >>> 8;
      }
      const length = deflate(
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      ).length;
      if (length > 2 ** 24 && length % 2 === 1) break;
      width += 1;
    }
    const video = new Video({ filename: "big.mp4" });
    const small = new Int32Array(4 * 6);
    small.fill(1, 6, 10);
    const labels = new Labels({
      videos: [video],
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          labelImages: [
            new UserLabelImage({ data: pixels, height, width }),
            new UserLabelImage({
              data: small,
              height: 4,
              width: 6,
              objects: new Map([
                [
                  1,
                  {
                    track: null,
                    category: "",
                    name: "after",
                    instance: null,
                  },
                ],
              ]),
              source: "small",
            }),
          ],
        }),
      ],
    });
    let firstSum = 0;
    for (const p of pixels) firstSum += p;
    return { labels, firstSum };
  }

  /** Labels with strings outside ASCII in every string column. */
  function unicodeLabels(): Labels {
    const video = new Video({ filename: "v.mp4" });
    const raster = new Uint8Array(10 * 10);
    raster[11] = 1;
    const pixels = new Int32Array(4 * 6);
    pixels[7] = 2;
    return new Labels({
      videos: [video],
      rois: [
        ROI.fromBbox(1, 2, 5, 6, {
          name: "größe 日本",
          category: "κατηγορία",
          source: "sörce",
          video,
        }),
      ],
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          masks: [
            SegmentationMask.fromArray(raster, 10, 10, {
              name: "ñame-✓",
              category: "κατηγορία",
              source: "sörce",
            }),
          ],
          labelImages: [
            new UserLabelImage({
              data: pixels,
              height: 4,
              width: 6,
              source: "sörce",
              objects: new Map([
                [
                  2,
                  {
                    track: null,
                    category: "κατηγορία",
                    name: "ñame-✓",
                    instance: null,
                  },
                ],
              ]),
            }),
          ],
        }),
      ],
    });
  }

  const SUMS_PY = `
import json, sys
import numpy as np
import sleap_io as sio
labels = sio.load_slp(sys.argv[1])
print(json.dumps({
    "version": sio.__version__,
    "label_images": [[int(np.asarray(li.data, dtype=np.int64).sum()),
                      list(np.asarray(li.data).shape), li.source,
                      sorted([int(k), o.name] for k, o in li.objects.items())]
                     for li in labels.label_images],
}))
`;

  it("a byte range past 16 MB reads back in JS", async () => {
    const { labels, firstSum } = largeLabelImages();
    const back = await readSlp(tempFile(await saveSlpToBytes(labels)), {
      openVideos: false,
    });
    const [big, small] = back.labeledFrames[0].labelImages;
    expect([big.height, big.width]).toEqual([
      labels.labeledFrames[0].labelImages[0].height,
      labels.labeledFrames[0].labelImages[0].width,
    ]);
    let sum = 0;
    for (const p of big.data) sum += p;
    expect(sum).toBe(firstSum);
    expect(Array.from(small.data)).toEqual(
      Array.from(labels.labeledFrames[0].labelImages[1].data),
    );
    expect(small.objects.get(1)?.name).toBe("after");
  });

  it("strings outside ASCII read back in JS", async () => {
    const back = await readSlp(
      tempFile(await saveSlpToBytes(unicodeLabels())),
      {
        openVideos: false,
      },
    );
    const roi = back.staticRois[0];
    expect([roi.name, roi.category, roi.source]).toEqual([
      "größe 日本",
      "κατηγορία",
      "sörce",
    ]);
    const mask = back.labeledFrames[0].masks[0];
    expect([mask.name, mask.category, mask.source]).toEqual([
      "ñame-✓",
      "κατηγορία",
      "sörce",
    ]);
    const li = back.labeledFrames[0].labelImages[0];
    expect(li.source).toBe("sörce");
    expect(li.objects.get(2)).toMatchObject({
      name: "ñame-✓",
      category: "κατηγορία",
    });
  });

  for (const python of pythons()) {
    it.skipIf(SKIP_PYTHON)(
      `a byte range past 16 MB reads back in Python, with ${python.label}`,
      async () => {
        const { labels, firstSum } = largeLabelImages();
        const out = execFileSync(
          python.cmd,
          [
            ...python.args,
            "-c",
            SUMS_PY,
            tempFile(await saveSlpToBytes(labels)),
          ],
          {
            timeout: 120_000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ).toString();
        const result = JSON.parse(out.trim().split("\n").pop()!);
        console.log(
          `a byte range past 16 MB read back with sleap-io ${result.version} (${python.label})`,
        );
        const big = labels.labeledFrames[0].labelImages[0];
        expect(result.label_images).toEqual([
          [firstSum, [big.height, big.width], "", []],
          [4, [4, 6], "small", [[1, "after"]]],
        ]);
      },
    );

    it.skipIf(SKIP_PYTHON)(
      `strings outside ASCII read back in Python, with ${python.label}`,
      async () => {
        const saved = describeInPython(
          python,
          tempFile(await saveSlpToBytes(unicodeLabels())),
        );
        const frame = (saved.frames as Array<Record<string, unknown[][]>>)[0];
        const roi = (saved.static_rois as unknown[][])[0];
        expect([roi[2], roi[3]]).toEqual(["größe 日本", "sörce"]);
        expect((roi[9] as unknown[])[2]).toBe("κατηγορία");
        const mask = frame.masks[0];
        expect([mask[4], mask[5]]).toEqual(["ñame-✓", "sörce"]);
        expect((mask[15] as unknown[])[2]).toBe("κατηγορία");
        const li = frame.label_images[0];
        expect(li[2]).toBe("sörce");
        expect((li[8] as unknown[][])[0].slice(0, 3)).toEqual([
          2,
          "ñame-✓",
          "κατηγορία",
        ]);
      },
    );
  }
});

// ---- Format 3.0 saves --------------------------------------------------------

/**
 * Loaded to be kept in format 3.0. These fixtures hold category metadata,
 * which this version does not read, so they ask without the option.
 */
const KEEP = { openVideos: false, format3: "keep" } as const;

/** Format 3.0 saves of a fixture loaded without a choice (kept in 3.0). */
const V3_SAVES: Array<[string, (name: string) => Promise<Uint8Array>]> = [
  [
    "an eager save",
    async (n) => saveSlpToBytes(await readSlp(slpPath(n), KEEP)),
  ],
  [
    "a lazy save",
    async (n) => saveSlpToBytes(await readSlpLazy(slpPath(n), KEEP)),
  ],
  [
    'a slpVersion: "v3" save of edit-loaded labels',
    async (n) =>
      saveSlpToBytes(await readSlp(slpPath(n), EDIT), { slpVersion: "v3" }),
  ],
];

/** Every reader, on a saved file. */
const FILE_READERS: Array<[string, (file: string) => Promise<Labels>]> = [
  ["readSlp", (f) => readSlp(f, KEEP)],
  [
    "readSlpLazy",
    async (f) => {
      const labels = await readSlpLazy(f, KEEP);
      labels.materialize();
      return labels;
    },
  ],
  ["readFromStreamingFile", (f) => readStreaming(f, { format3: "keep" })],
  [
    "readFromStreamingFile (lazy)",
    (f) => readStreaming(f, { lazy: true, format3: "keep" }),
  ],
];

/** The datasets under `/rois`, `/masks`, ... named `extra`, and their values. */
async function extraColumns(file: string): Promise<Record<string, number[]>> {
  await ready;
  const h5 = new H5File(file, "r");
  const out: Record<string, number[]> = {};
  try {
    const walk = (p: string) => {
      const node = h5.get(p) as any;
      if (!node) return;
      if (node.type === "Group") {
        for (const k of node.keys() as string[]) walk(p ? `${p}/${k}` : k);
      } else if (p.endsWith("/extra")) {
        out[p] = Array.from(node.value as ArrayLike<unknown>, Number);
      }
    };
    for (const k of h5.keys() as string[]) walk(k);
  } finally {
    h5.close();
  }
  return out;
}

/** A links table's `extra` column by `owner_type:owner_id:catalog index`. */
async function linkExtras(
  file: string,
  column: string,
): Promise<Record<string, number>> {
  await ready;
  const h5 = new H5File(file, "r");
  try {
    const table = column.slice(0, -"/extra".length);
    const index = table.startsWith("identity")
      ? "identity_idx"
      : "category_idx";
    const col = (n: string) =>
      Array.from((h5.get(`${table}/${n}`) as any).value, Number);
    const [type, owner, idx, extra] = [
      col("owner_type"),
      col("owner_id"),
      col(index),
      col("extra"),
    ];
    return Object.fromEntries(
      type.map((t, i) => [`${t}:${owner[i]}:${idx[i]}`, extra[i]]),
    );
  } finally {
    h5.close();
  }
}

/** The `format_id` of a file and whether `/points` is a group. */
async function layoutOf(file: string): Promise<[number, boolean]> {
  await ready;
  const h5 = new H5File(file, "r");
  try {
    const attrs = (h5.get("metadata") as any).attrs;
    return [
      Number(attrs.format_id.value),
      (h5.get("points") as any).type === "Group",
    ];
  } finally {
    h5.close();
  }
}

describe("format 3.0 saves of the tables", () => {
  for (const [what, save] of V3_SAVES) {
    for (const name of [V3, BLOB, UNKNOWN, DEFAULTS]) {
      it(`${what} of ${name} writes format 3.0 that every reader reads back`, async () => {
        const file = tempFile(await save(name));
        expect(await layoutOf(file)).toEqual([3, true]);
        // As each reader reads the fixture itself (the streaming reader reads
        // no ROIs, masks or label images).
        for (const [label, read] of FILE_READERS) {
          expect([label, describe3(await read(file))]).toEqual([
            label,
            describe3(await read(slpPath(name))),
          ]);
        }
        // Saving the read-back labels again keeps format 3.0.
        const again = tempFile(await saveSlpToBytes(await readSlp(file, KEEP)));
        expect(await layoutOf(again)).toEqual([3, true]);
      });
    }
  }

  it("writes no compound dataset", async () => {
    const file = tempFile(
      await saveSlpToBytes(await readSlp(slpPath(V3), KEEP)),
    );
    await ready;
    const h5 = new H5File(file, "r");
    const compound: string[] = [];
    try {
      const walk = (p: string) => {
        const node = h5.get(p) as any;
        if (node?.type === "Group") {
          for (const k of node.keys() as string[]) walk(p ? `${p}/${k}` : k);
        } else if (node?.metadata?.compound_type) {
          compound.push(p);
        }
      };
      for (const k of h5.keys() as string[]) walk(k);
    } finally {
      h5.close();
    }
    expect(compound).toEqual([]);
  });

  for (const [what, load] of [
    ["eager", (n: string) => readSlp(slpPath(n), KEEP)],
    ["lazy", (n: string) => readSlpLazy(slpPath(n), KEEP)],
  ] as const) {
    it(`keeps the unknown columns of every table (${what})`, async () => {
      const warns: string[] = [];
      const original = console.warn;
      console.warn = (m: unknown) => warns.push(String(m));
      try {
        const file = tempFile(await saveSlpToBytes(await load(UNKNOWN)));
        expect(warns).toEqual([]);
        const kept = await extraColumns(file);
        const original = await extraColumns(slpPath(UNKNOWN));
        expect(Object.keys(kept).sort()).toEqual(Object.keys(original).sort());
        expect(Object.keys(kept).length).toBe(11);
        for (const [column, values] of Object.entries(original)) {
          if (column.endsWith("links/extra")) {
            // Link rows follow their (owner type, owner id, catalog index),
            // which the writer may order differently.
            expect(await linkExtras(file, column)).toEqual(
              await linkExtras(slpPath(UNKNOWN), column),
            );
          } else {
            expect([column, kept[column]]).toEqual([column, values]);
          }
        }
      } finally {
        console.warn = original;
      }
    });
  }

  it("drops unknown columns with a warning once their records change", async () => {
    const labels = await readSlp(slpPath(UNKNOWN), KEEP);
    const frame = labels.labeledFrames.find((f) => f.rois.length > 0)!;
    frame.rois.reverse();
    if (frame.rois.length < 2) frame.rois.pop();
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (m: unknown) => warns.push(String(m));
    try {
      const file = tempFile(await saveSlpToBytes(labels));
      expect(Object.keys(await extraColumns(file))).not.toContain("rois/extra");
      expect(warns.some((w) => w.includes("/rois were not saved"))).toBe(true);
    } finally {
      console.warn = original;
    }
  });

  it('slpVersion: "v2" writes the 2.x layout and drops the unknown columns with a warning', async () => {
    const labels = await readSlp(slpPath(UNKNOWN), KEEP);
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (m: unknown) => warns.push(String(m));
    try {
      const file = tempFile(await saveSlpToBytes(labels, { slpVersion: "v2" }));
      const [formatId, columnar] = await layoutOf(file);
      expect(formatId).toBeLessThan(3);
      expect(columnar).toBe(false);
      expect(await extraColumns(file)).toEqual({});
      expect(warns.filter((w) => w.includes("cannot store them")).length).toBe(
        11,
      );
    } finally {
      console.warn = original;
    }
  });
});

describe("a format 3.0 save of the tables reads back in Python", () => {
  for (const python of pythons()) {
    for (const [what, save] of V3_SAVES) {
      for (const name of [V3, UNKNOWN, BLOB]) {
        it.skipIf(SKIP_PYTHON)(
          `${what} of ${name}, with ${python.label}`,
          async () => {
            const file = tempFile(await save(name));
            const version = pythonVersion(python);
            if (!version.startsWith("0.10")) {
              // Older sleap-io refuses format 3.0, saying so.
              const error = pythonError(python, file);
              console.log(
                `${what} of ${name} refused by sleap-io ${version} (${python.label})`,
              );
              expect(error).toMatch(/format|3\.0/i);
              return;
            }
            const saved = describeInPython(python, file);
            console.log(
              `${what} of ${name} read back with sleap-io ${saved.version} (${python.label})`,
            );
            expect(saved.format_id).toBe(3);
            const { format_id: _a, ...rest } = saved;
            const { format_id: _b, ...fixture } = describeInPython(
              python,
              slpPath(name),
            );
            expect(rest).toEqual(fixture);
          },
        );
      }
    }
  }
});

/** The sleap-io version a Python runs. */
function pythonVersion(python: { cmd: string; args: string[] }): string {
  return execFileSync(
    python.cmd,
    [...python.args, "-c", "import sleap_io; print(sleap_io.__version__)"],
    {
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
    .toString()
    .trim()
    .split("\n")
    .pop()!;
}

/** The error a Python's `load_slp` raises for `file`, or "" when it loads. */
function pythonError(
  python: { cmd: string; args: string[] },
  file: string,
): string {
  const script =
    "import sys, sleap_io as sio\n" +
    "try:\n    sio.load_slp(sys.argv[1])\n    print('')\n" +
    "except Exception as e:\n    print(repr(e))";
  return execFileSync(python.cmd, [...python.args, "-c", script, file], {
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
}
