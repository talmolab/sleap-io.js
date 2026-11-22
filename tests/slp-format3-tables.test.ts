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
} from "../src/codecs/slp/read-streaming.js";
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
  options: { lazy?: boolean; format3?: "view" | "edit" } = {},
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
        await readFromStreamingFile(file, `https://example.com/${V3}`);
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
            await readSlp(slpPath(UNKNOWN), { openVideos: false });
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
      await readSlp(slpPath(UNKNOWN), { openVideos: false });
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
      env: {
        ...process.env,
        NUMPY_MADVISE_HUGEPAGE: "0",
        OMP_NUM_THREADS: "8",
      },
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
