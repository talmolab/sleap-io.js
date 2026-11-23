/**
 * The layout an SLP save writes (`slpVersion`), and the format 3.0 writer.
 *
 * - `"auto"` (the default) writes the 2.x layout unless the labels need
 *   format 3.0: the switch is on, they were loaded from a 3.0 file without
 *   `format3: "edit"`, or they hold what only 3.0 can store (then it warns).
 * - `"v2"` and `"v3"` always write that layout.
 *
 * Fixtures: the format 3.0 files of `tests/data/slp/gen_format3_pose_fixture.py`
 * (written with Python sleap-io 0.10.0), and `format3_pose.v2.slp`, the same
 * labels written by that Python in the 2.x layout (`legacy_format=True`), whose
 * point flags are HDF5 booleans.
 *
 * Python read-backs run each interpreter listed (comma-separated) in
 * `SLEAP_IO_TEST_PYTHONS`, or `uv run --with sleap-io python` when unset, and
 * print the sleap-io version each one ran. `SLEAP_IO_SKIP_PYTHON_TESTS=1` skips
 * them. A sleap-io older than 0.10 must refuse the format 3.0 files.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
  vi,
} from "./bun-test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ready, File as H5File } from "h5wasm/node";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import {
  type Format3Option,
  SlpFormat3ChoiceError,
  SlpViewOnlyError,
} from "../src/codecs/slp/format3.js";
import {
  buildExpectedSidecars,
  buildLabelTableUpdate,
  checkInPlaceWritable,
  onDiskTablesFromFile,
  openSlpWriter,
  resolveSlpVersion,
  saveSlpMergedFromStores,
  saveSlpMergedToSink,
  saveSlpStructureToBytes,
  saveSlpToBytes,
  writeLabelTablesInPlace,
  writeSlp,
} from "../src/codecs/slp/write.js";
import { inPlacePayload } from "../src/codecs/slp/h5-streaming.js";
import { H5_WORKER_CODE } from "../src/codecs/slp/h5-worker.js";
import { setV3Defaults } from "../src/codecs/slp/slp-version.js";
import { loadSlp, saveSlp, saveSlpSet } from "../src/index.js";
import { loadSlpMetadata } from "../src/lite.js";
import { Instance, PredictedInstance } from "../src/model/instance.js";
import { Labels } from "../src/model/labels.js";
import { LabelsSet } from "../src/model/labels-set.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { UserBoundingBox } from "../src/model/bbox.js";
import { sourceMarkOf } from "../src/model/source-mark.js";
import { slpPath, streamingFile } from "./slp-format3-files";

setDefaultTimeout(120_000);

const POSE = "format3_pose.slp";
/**
 * Loaded to be kept in format 3.0. format3_metadata.slp holds metadata
 * members the readers ignore, so it asks without the option.
 */
const KEEP = { openVideos: false, format3: "keep" } as const;
const META = "format3_metadata.slp";
const V2 = "format3_pose.v2.slp";

/** Write `bytes` to a new temp file and return its path. */
function tempFile(bytes: Uint8Array, name = "saved.slp"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-version-"));
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return file;
}

/** A copy of a fixture in a temp dir. */
function tempCopy(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-version-"));
  const file = path.join(dir, path.basename(name));
  copyFileSync(slpPath(name), file);
  return file;
}

/** `format_id` and whether the pose tables are groups of columns. */
async function layoutOf(source: Uint8Array | string): Promise<"v2" | "v3"> {
  await ready;
  const file = typeof source === "string" ? source : tempFile(source);
  const h5 = new H5File(file, "r");
  try {
    const attr = (h5.get("metadata") as any).attrs.format_id;
    const formatId = Number(attr.value);
    const columnar = (h5.get("points") as any).type === "Group";
    // Format 3.0's format_id is a float, as Python writes it.
    if (columnar && attr.metadata?.type !== 1) {
      throw new Error(
        `format_id 3.0 stored with HDF5 type ${attr.metadata?.type}`,
      );
    }
    if (formatId >= 3 !== columnar) {
      throw new Error(`format_id ${formatId} with columnar=${columnar}`);
    }
    return columnar ? "v3" : "v2";
  } finally {
    h5.close();
  }
}

async function caught(run: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("expected an error");
}

/** Load a file through the streaming reader stand-in. */
async function readStreaming(
  name: string,
  format3?: Format3Option,
  lazy = false,
): Promise<Labels> {
  const { file, close } = await streamingFile(name);
  try {
    const labels = await readFromStreamingFile(
      file,
      `https://example.com/${path.basename(name)}`,
      undefined,
      false,
      undefined,
      false,
      lazy,
      false,
      false,
      false,
      format3,
    );
    if (lazy) labels.materialize();
    return labels;
  } finally {
    close();
  }
}

const skeleton = new Skeleton({ nodes: ["a", "b", "c"], name: "s" });

/** Labels built in memory; `extra` adds content only format 3.0 can store. */
function built(
  extra: {
    unlabeled?: boolean;
    instanceMetadata?: boolean;
    frameMetadata?: boolean;
    boxMetadata?: boolean;
  } = {},
): Labels {
  const video = new Video({ filename: "clip.mp4" });
  const user = new Instance({
    skeleton,
    points: [
      { xy: [1, 2], visible: true, complete: true },
      { xy: [3, 4], visible: false, complete: false },
      {
        xy: [5, 6],
        visible: false,
        complete: false,
        ...(extra.unlabeled ? { labeled: false } : {}),
      },
    ],
    ...(extra.instanceMetadata
      ? { metadata: { who: "me", pass: 2, quality: 0.5, ok: true } }
      : {}),
  });
  const pred = new PredictedInstance({
    skeleton,
    score: 0.75,
    points: [
      { xy: [7, 8], visible: true, complete: false, score: 0.5 },
      { xy: [9, 10], visible: true, complete: false, score: 0.25 },
      { xy: [11, 12], visible: false, complete: false, score: 0.125 },
    ],
    ...(extra.instanceMetadata ? { metadata: { pass: 3 } } : {}),
  });
  user.fromPredicted = pred;
  const frame = new LabeledFrame({
    video,
    frameIdx: 2,
    instances: [pred, user],
    ...(extra.frameMetadata ? { metadata: { note: "x", flagged: false } } : {}),
    bboxes: [
      new UserBoundingBox({
        x1: 0,
        y1: 1,
        x2: 2,
        y2: 3,
        ...(extra.boxMetadata ? { metadata: { k: 4 } } : {}),
      }),
    ],
  });
  const negative = new LabeledFrame({
    video,
    frameIdx: 7,
    instances: [],
    isNegative: true,
  });
  return new Labels({
    labeledFrames: [frame, negative],
    videos: [video],
    skeletons: [skeleton],
  });
}

const num = (v: number | null | undefined): number | string | null =>
  v === null || v === undefined ? null : Number.isNaN(v) ? "nan" : v;

/** What a pose save must keep, as plain values. */
function describePose(labels: Labels) {
  const frames = labels.labeledFrames;
  return frames.map((f) => ({
    video: labels.videos.indexOf(f.video),
    frameIdx: f.frameIdx,
    negative: f.isNegative,
    metadata: f.metadata,
    bboxes: f.bboxes.map((b) => [b.x1, b.y1, b.x2, b.y2, b.metadata]),
    instances: f.instances.map((i) => ({
      predicted: i instanceof PredictedInstance,
      track: i.track?.name ?? null,
      // A user instance's "no score" is 0 here and NaN in format 3.0.
      trackingScore:
        i instanceof PredictedInstance || i.trackingScore
          ? num(i.trackingScore)
          : "none",
      score: i instanceof PredictedInstance ? num(i.score) : null,
      fromPredicted:
        !(i instanceof PredictedInstance) && i.fromPredicted
          ? f.instances.indexOf(i.fromPredicted)
          : null,
      metadata: i.metadata,
      points: i.points.map((p) => ({
        // Format 3.0 stores an unlabelled point without a location.
        xy: p.labeled === false ? ["nan", "nan"] : p.xy.map(num),
        visible: p.visible,
        complete: p.complete,
        labeled: p.labeled ?? true,
        score: num((p as { score?: number }).score),
      })),
    })),
  }));
}

/** Every reader, on a file (eager, lazy, streaming stand-in, lazy streaming). */
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
  ["readFromStreamingFile", (f) => readStreaming(f, "keep")],
  ["readFromStreamingFile (lazy)", (f) => readStreaming(f, "keep", true)],
];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  setV3Defaults(null);
  delete process.env.SLEAP_IO_V3_DEFAULTS;
});

/** The messages of `console.warn` since the test began. */
const warnings = (): string[] => warn.mock.calls.map((c) => String(c[0]));
const layoutWarnings = (): string[] =>
  warnings().filter(
    (m) =>
      m.includes("Saving") &&
      m.includes("format 3.0") &&
      !m.includes("boolean metadata"),
  );
const boolWarnings = (): string[] =>
  warnings().filter((m) => m.includes("boolean metadata"));

describe("the slpVersion option", () => {
  it("is refused with a TypeError by every writer before anything is written", async () => {
    const bad = { slpVersion: "v4" as never };
    const labels = built();
    for (const run of [
      () => saveSlpToBytes(labels, bad),
      () => saveSlpStructureToBytes(labels, bad),
      () => buildLabelTableUpdate(labels, bad),
      () => resolveSlpVersion(labels, "v4" as never),
      () => openSlpWriter(labels, bad),
    ]) {
      expect(await caught(run)).toBeInstanceOf(TypeError);
    }
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-version-"));
    const file = path.join(dir, "out.slp");
    expect(await caught(() => writeSlp(file, labels, bad))).toBeInstanceOf(
      TypeError,
    );
    expect(await caught(() => saveSlp(labels, file, bad))).toBeInstanceOf(
      TypeError,
    );
    const set = new LabelsSet();
    set.set(path.join(dir, "a.slp"), built());
    set.set(path.join(dir, "b.slp"), built());
    expect(await caught(() => saveSlpSet(set, bad))).toBeInstanceOf(TypeError);
    for (const name of ["out.slp", "a.slp", "b.slp"]) {
      expect(existsSync(path.join(dir, name))).toBe(false);
    }
    const store = (await readSlpLazy(slpPath(POSE), { openVideos: false }))
      ._lazyDataStore!;
    expect(
      await caught(() => saveSlpMergedFromStores([store], bad)),
    ).toBeInstanceOf(TypeError);
    const writer = await openSlpWriter(labels);
    expect(await caught(() => writer.appendStore(store, bad))).toBeInstanceOf(
      TypeError,
    );
    expect(
      await caught(() => writer.appendFrames(labels.labeledFrames, bad)),
    ).toBeInstanceOf(TypeError);
    writer.dispose();
  });

  it('"v3" writes format 3.0 and ignores unlabeledAs; "v2" the 2.x layout', async () => {
    const labels = built({ unlabeled: true });
    expect(
      await layoutOf(
        await saveSlpToBytes(labels, {
          slpVersion: "v3",
          unlabeledAs: "error",
        }),
      ),
    ).toBe("v3");
    expect(
      await layoutOf(
        await saveSlpToBytes(built(), {
          slpVersion: "v3",
          unlabeledAs: "absent",
        }),
      ),
    ).toBe("v3");
    expect(
      await layoutOf(
        await saveSlpToBytes(labels, {
          slpVersion: "v2",
          unlabeledAs: "absent",
        }),
      ),
    ).toBe("v2");
    expect(layoutWarnings()).toEqual([]);
  });
});

describe('the "auto" rule', () => {
  it("writes the 2.x layout for labels that fit it, without a word", async () => {
    expect(await layoutOf(await saveSlpToBytes(built()))).toBe("v2");
    const lazy = await readSlpLazy(slpPath(V2), { openVideos: false });
    expect(await layoutOf(await saveSlpToBytes(lazy))).toBe("v2");
    expect(warnings()).toEqual([]);
  });

  for (const [what, extra, named] of [
    [
      "points marked as not labelled",
      { unlabeled: true },
      "1 point(s) marked as not labelled",
    ],
    [
      "instance metadata",
      { instanceMetadata: true },
      "instances: ok, pass, quality, who",
    ],
    ["frame metadata", { frameMetadata: true }, "frames: flagged, note"],
    ["bounding box metadata", { boxMetadata: true }, "bboxes: k"],
  ] as const) {
    it(`writes format 3.0 for ${what}, with one warning naming it`, async () => {
      const labels = built(extra);
      expect(await layoutOf(await saveSlpToBytes(labels))).toBe("v3");
      const messages = layoutWarnings();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(named);
      expect(messages[0]).toContain('slpVersion: "v2"');
      expect(messages[0]).toContain('slpVersion: "v3"');
      // Asked for explicitly, format 3.0 is written without a warning.
      warn.mockClear();
      await saveSlpToBytes(built(extra), { slpVersion: "v3" });
      expect(layoutWarnings()).toEqual([]);
    });
  }

  it("keeps a format 3.0 file in format 3.0, without a word", async () => {
    for (const [label, read] of [
      ["readSlp", (n: string) => readSlp(slpPath(n), { openVideos: false })],
      [
        "readSlpLazy",
        (n: string) => readSlpLazy(slpPath(n), { openVideos: false }),
      ],
      ["loadSlp", (n: string) => loadSlp(slpPath(n), { openVideos: false })],
      ["streaming", (n: string) => readStreaming(n)],
    ] as const) {
      const labels = await read(POSE);
      expect([label, labels.sourceFormat?.access]).toEqual([label, "keep"]);
      expect([label, await layoutOf(await saveSlpToBytes(labels))]).toEqual([
        label,
        "v3",
      ]);
    }
    expect(warnings()).toEqual([]);
  });

  it("asks, without the option, for a file holding what this version does not read", async () => {
    // A save in either layout would drop what is not read: events and a
    // table of a newer writer, category metadata, and (streaming reader)
    // ROIs, masks and label images.
    const cases: Array<[string, string, () => Promise<Labels>, string[]]> = [
      [
        "readSlp",
        "format3_events.slp",
        () => readSlp(slpPath("format3_events.slp"), { openVideos: false }),
        ["event_types", "events", "future_table"],
      ],
      [
        "readSlpLazy",
        "format3_events.slp",
        () => readSlpLazy(slpPath("format3_events.slp"), { openVideos: false }),
        ["event_types", "events", "future_table"],
      ],
      [
        "streaming",
        "format3_events.slp",
        () => readStreaming("format3_events.slp"),
        ["event_types", "events", "future_table"],
      ],
      [
        "readSlp",
        "format3_tables.slp",
        () => readSlp(slpPath("format3_tables.slp"), { openVideos: false }),
        ["categories/meta_key"],
      ],
      [
        "readSlpLazy",
        "format3_tables.slp",
        () => readSlpLazy(slpPath("format3_tables.slp"), { openVideos: false }),
        ["categories/meta_key"],
      ],
      [
        "streaming",
        "format3_tables.slp",
        () => readStreaming("format3_tables.slp"),
        ["categories/meta_key", "label_images", "masks", "rois"],
      ],
    ];
    for (const [label, name, read, unread] of cases) {
      const error = (await caught(read)) as SlpFormat3ChoiceError;
      expect([label, name, error]).toEqual([
        label,
        name,
        expect.any(SlpFormat3ChoiceError),
      ]);
      for (const table of unread) {
        expect(error.summary.unreadTables).toContain(table);
        expect(error.message).toContain(table);
      }
      expect(error.message).toContain("without the format3 option");
    }
    // Asked for explicitly, they load to be kept, and the loss is the
    // caller's choice.
    const kept = await readSlp(slpPath("format3_events.slp"), {
      openVideos: false,
      format3: "keep",
    });
    expect(kept.sourceFormat?.access).toBe("keep");
    expect(await layoutOf(await saveSlpToBytes(kept))).toBe("v3");
    const streamed = await readStreaming("format3_tables.slp", "keep");
    expect(streamed.sourceFormat?.access).toBe("keep");
  });

  it("carries unknown columns of any rank and of /bboxes, and asks for what it cannot carry", async () => {
    await ready;
    /** A copy of a fixture with members a newer writer might add. */
    const variant = (
      name: string,
      add: (h5: InstanceType<typeof H5File>) => void,
    ): string => {
      const file = tempCopy(name);
      const h5 = new H5File(file, "a");
      try {
        add(h5);
      } finally {
        h5.close();
      }
      return file;
    };
    const nPoints = 6;
    // A 2-D column of /points, and the box column of format3_metadata.slp,
    // are carried: no option needed, and a save writes them back.
    const twoD = variant(POSE, (h5) => {
      (h5.get("points") as any).create_dataset({
        name: "extra2d",
        data: Float64Array.from({ length: nPoints * 2 }, (_, i) => i / 2),
        shape: [nPoints, 2],
        dtype: "<d",
      });
    });
    const column = (file: string, path: string) => {
      const h5 = new H5File(file, "r");
      try {
        const ds = h5.get(path) as any;
        return ds ? [ds.shape, Array.from(ds.value, Number)] : null;
      } finally {
        h5.close();
      }
    };
    for (const [label, read] of [
      ["readSlp", (f: string) => readSlp(f, { openVideos: false })],
      ["readSlpLazy", (f: string) => readSlpLazy(f, { openVideos: false })],
      ["streaming", (f: string) => readStreaming(f)],
    ] as const) {
      const labels = await read(twoD);
      expect([label, labels.sourceFormat?.summary.unreadTables]).toEqual([
        label,
        [],
      ]);
      const saved = tempFile(await saveSlpToBytes(labels));
      expect([label, column(saved, "points/extra2d")]).toEqual([
        label,
        column(twoD, "points/extra2d"),
      ]);
      // format3_metadata.slp also holds metadata members the readers
      // ignore, so it asks without the option: keep it explicitly.
      const kept =
        label === "streaming"
          ? await readStreaming(slpPath(META), "keep")
          : label === "readSlp"
            ? await readSlp(slpPath(META), KEEP)
            : await readSlpLazy(slpPath(META), KEEP);
      const meta = tempFile(await saveSlpToBytes(kept));
      expect([label, column(meta, "bboxes/extra")]).toEqual([
        label,
        column(slpPath(META), "bboxes/extra"),
      ]);
    }
    // A group inside a pose table, and a string column of rank 2, cannot be
    // written back: every reader asks without the option, naming them.
    const uncarried = variant(POSE, (h5) => {
      (h5.get("instances") as any).create_group("newsub");
      (h5.get("instances/newsub") as any).create_dataset({
        name: "a",
        data: new Float64Array(5),
        shape: [5],
        dtype: "<d",
      });
      (h5.get("frames") as any).create_dataset({
        name: "labels2d",
        data: Array.from({ length: 8 }, () => "ab"),
        shape: [4, 2],
        dtype: "S2",
      });
    });
    for (const [label, read] of [
      ["readSlp", () => readSlp(uncarried, { openVideos: false })],
      ["readSlpLazy", () => readSlpLazy(uncarried, { openVideos: false })],
      ["streaming", () => readStreaming(uncarried)],
    ] as const) {
      const error = (await caught(read)) as SlpFormat3ChoiceError;
      expect([label, error]).toEqual([
        label,
        expect.any(SlpFormat3ChoiceError),
      ]);
      expect([label, error.summary.unreadTables]).toEqual([
        label,
        ["frames/labels2d", "instances/newsub"],
      ]);
    }
    expect(
      (await loadSlpMetadata(new Uint8Array(readFileSync(uncarried)))).format3
        ?.unreadTables,
    ).toEqual(["frames/labels2d", "instances/newsub"]);
    // Metadata members the readers ignore are listed too.
    for (const read of [
      () => readSlp(slpPath(META), { openVideos: false }),
      () => readSlpLazy(slpPath(META), { openVideos: false }),
      () => readStreaming(META),
    ]) {
      const error = (await caught(read)) as SlpFormat3ChoiceError;
      expect(error.summary.unreadTables).toEqual([
        "frames/metadata/no_values",
        "instances/metadata/loose",
        "instances/metadata/two_d",
      ]);
    }
  });

  it("keeps it for copies, extracts, materialized labels and records moved elsewhere", async () => {
    const labels = await readSlp(slpPath(POSE), { openVideos: false });
    const lazy = await readSlpLazy(slpPath(POSE), { openVideos: false });
    lazy.materialize();
    const moved = new Labels({
      labeledFrames: labels.labeledFrames,
      videos: labels.videos,
      skeletons: labels.skeletons,
      tracks: labels.tracks,
    });
    for (const derived of [labels.copy(), labels.extract([0]), lazy, moved]) {
      expect(await layoutOf(await saveSlpToBytes(derived))).toBe("v3");
    }
    expect(resolveSlpVersion(moved)).toBe("v3");
    expect(warnings()).toEqual([]);
  });

  it('writes the 2.x layout for files loaded with format3: "edit", as before', async () => {
    const edit = await readSlp(slpPath(META), {
      openVideos: false,
      format3: "edit",
    });
    expect(await layoutOf(await saveSlpToBytes(edit))).toBe("v2");
    // Even with the format 3.0 defaults on: the caller chose.
    setV3Defaults(true);
    expect(await layoutOf(await saveSlpToBytes(edit))).toBe("v2");
    expect(warnings()).toEqual([]);
    // Explicitly asked, format 3.0 keeps everything.
    const back = await readSlp(
      await saveSlpToBytes(edit, { slpVersion: "v3" }),
      { openVideos: false, h5: { filenameHint: "edit.slp" } },
    );
    expect(back.labeledFrames[0].instances[0].metadata).toEqual(
      edit.labeledFrames[0].instances[0].metadata,
    );
  });

  it('refuses view-only labels in every layout, and "ask" still asks', async () => {
    const view = await readSlp(slpPath(POSE), {
      openVideos: false,
      format3: "view",
    });
    for (const slpVersion of ["auto", "v2", "v3"] as const) {
      expect(
        await caught(() => saveSlpToBytes(view, { slpVersion })),
      ).toBeInstanceOf(SlpViewOnlyError);
    }
    expect(
      await caught(() =>
        readSlp(slpPath(POSE), { openVideos: false, format3: "ask" }),
      ),
    ).toBeInstanceOf(SlpFormat3ChoiceError);
  });

  it("remembers the layout last written", async () => {
    // Labels built in memory, saved in format 3.0, stay in format 3.0.
    const mine = built();
    expect(resolveSlpVersion(mine)).toBe("v2");
    await saveSlpToBytes(mine, { slpVersion: "v3" });
    expect(await layoutOf(await saveSlpToBytes(mine))).toBe("v3");
    // A format 3.0 file saved in the 2.x layout stays in it.
    const pose = await readSlp(slpPath(POSE), { openVideos: false });
    await saveSlpToBytes(pose, { slpVersion: "v2" });
    expect(await layoutOf(await saveSlpToBytes(pose))).toBe("v2");
    // ...unless it holds what only format 3.0 can store: then it warns.
    const meta = await readSlp(slpPath(META), KEEP);
    await saveSlpToBytes(meta, { slpVersion: "v2", unlabeledAs: "absent" });
    warn.mockClear();
    expect(await layoutOf(await saveSlpToBytes(meta))).toBe("v3");
    const message = layoutWarnings()[0];
    expect(message).toContain("2 point(s) marked as not labelled");
    expect(message).toContain("unknown columns kept from a newer file");
  });

  it("the format 3.0 defaults: the switch, the environment, explicit options win", async () => {
    setV3Defaults(true);
    expect(await layoutOf(await saveSlpToBytes(built()))).toBe("v3");
    expect(
      await layoutOf(await saveSlpToBytes(built(), { slpVersion: "v2" })),
    ).toBe("v2");
    setV3Defaults(false);
    process.env.SLEAP_IO_V3_DEFAULTS = "1";
    expect(await layoutOf(await saveSlpToBytes(built()))).toBe("v2");
    setV3Defaults(null);
    expect(await layoutOf(await saveSlpToBytes(built()))).toBe("v3");
    process.env.SLEAP_IO_V3_DEFAULTS = "no";
    expect(await layoutOf(await saveSlpToBytes(built()))).toBe("v2");
    expect(() => setV3Defaults("yes" as never)).toThrow(TypeError);
    expect(warnings()).toEqual([]);
  });

  it("one layout for a set: format 3.0 if any needs it, with one warning", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-version-"));
    const write = async (
      entries: Array<[string, Labels]>,
    ): Promise<Array<"v2" | "v3">> => {
      const set = new LabelsSet();
      for (const [name, labels] of entries) {
        set.set(path.join(dir, name), labels);
      }
      await saveSlpSet(set);
      return Promise.all(
        entries.map(([name]) => layoutOf(path.join(dir, name))),
      );
    };
    expect(
      await write([
        ["plain1.slp", built()],
        ["plain2.slp", built()],
      ]),
    ).toEqual(["v2", "v2"]);
    expect(warnings()).toEqual([]);
    expect(
      await write([
        ["plain3.slp", built()],
        ["meta.slp", built({ frameMetadata: true })],
      ]),
    ).toEqual(["v3", "v3"]);
    expect(layoutWarnings()).toHaveLength(1);
    warn.mockClear();
    expect(
      await write([
        ["plain4.slp", built()],
        ["pose.slp", await readSlp(slpPath(POSE), { openVideos: false })],
      ]),
    ).toEqual(["v3", "v3"]);
    expect(layoutWarnings()).toHaveLength(1);
    expect(layoutWarnings()[0]).toContain("come from format 3.0 files");
    expect(
      resolveSlpVersion([built(), built({ unlabeled: true })], "auto", {
        warn: false,
      }),
    ).toBe("v3");
  });
});

describe("format 3.0 saves of the pose tables", () => {
  /** The saves to check, each of a fixture or of labels built in memory. */
  const SAVES: Array<[string, () => Promise<[Uint8Array, Labels]>]> = [
    [
      `an eager save of ${META}`,
      async () => {
        const labels = await readSlp(slpPath(META), KEEP);
        return [await saveSlpToBytes(labels), labels];
      },
    ],
    [
      `a lazy save of ${META}`,
      async () => {
        const labels = await readSlpLazy(slpPath(META), KEEP);
        const bytes = await saveSlpToBytes(labels);
        return [bytes, await readSlp(slpPath(META), KEEP)];
      },
    ],
    [
      `an eager save of ${POSE}`,
      async () => {
        const labels = await readSlp(slpPath(POSE), { openVideos: false });
        return [await saveSlpToBytes(labels), labels];
      },
    ],
    [
      "a save of labels built in memory with every kind of metadata",
      async () => {
        const labels = built({
          unlabeled: true,
          instanceMetadata: true,
          frameMetadata: true,
          boxMetadata: true,
        });
        return [await saveSlpToBytes(labels, { slpVersion: "v3" }), labels];
      },
    ],
    [
      `a merged-store save of ${META}`,
      async () => {
        const labels = await readSlpLazy(slpPath(META), KEEP);
        const bytes = await saveSlpMergedFromStores([labels._lazyDataStore!]);
        return [bytes, await readSlp(slpPath(META), KEEP)];
      },
    ],
    [
      `a streaming-writer save of ${META} (frames appended)`,
      async () => {
        const labels = await readSlp(slpPath(META), KEEP);
        const writer = await openSlpWriter(labels);
        writer.appendFrames(labels.labeledFrames);
        return [writer.close(), labels];
      },
    ],
  ];

  for (const [what, save] of SAVES) {
    it(`${what} reads back the same with every reader`, async () => {
      const [bytes, labels] = await save();
      const file = tempFile(bytes);
      expect(await layoutOf(file)).toBe("v3");
      const expected = describePose(labels);
      for (const [label, read] of FILE_READERS) {
        const back = await read(file);
        expect(back.sourceFormat?.access).toBe("keep");
        expect([label, describePose(back)]).toEqual([label, expected]);
      }
      // The lite reader sees the same unlabelled points and metadata keys.
      const lite = (await loadSlpMetadata(new Uint8Array(readFileSync(file))))
        .format3;
      expect(lite?.formatId).toBe(3);
      expect(lite?.unlabeledPoints).toBe(
        labels.labeledFrames
          .flatMap((f) => f.instances)
          .reduce((n, i) => n + i.nUnlabeled, 0),
      );
    });
  }

  it("keeps the kind of each metadata key, booleans included", async () => {
    const labels = await readSlp(slpPath(META), KEEP);
    const back = await readSlp(await saveSlpToBytes(labels), {
      openVideos: false,
      format3: "keep",
      h5: { filenameHint: "meta.slp" },
    });
    const kinds = (l: Labels) =>
      l.labeledFrames.flatMap((f) =>
        f.instances.map((i) =>
          Object.fromEntries(
            Object.entries(i.metadata).map(([k, v]) => [k, typeof v]),
          ),
        ),
      );
    expect(kinds(back)).toEqual(kinds(labels));
    expect(back.sourceFormat?.metadataKinds).toEqual(
      labels.sourceFormat?.metadataKinds,
    );
  });

  it("warns once that Python reads boolean metadata as integers", async () => {
    // Every format 3.0 writer: eager, lazy, merged store, streaming writer.
    const saves: Array<() => Promise<Uint8Array>> = [
      async () =>
        saveSlpToBytes(built({ instanceMetadata: true, frameMetadata: true }), {
          slpVersion: "v3",
        }),
      async () => saveSlpToBytes(await readSlpLazy(slpPath(META), KEEP)),
      async () =>
        saveSlpMergedFromStores([
          (await readSlpLazy(slpPath(META), KEEP))._lazyDataStore!,
        ]),
      async () => {
        const labels = await readSlp(slpPath(META), KEEP);
        const writer = await openSlpWriter(labels);
        writer.appendFrames(labels.labeledFrames);
        return writer.close();
      },
    ];
    for (const save of saves) {
      warn.mockClear();
      await save();
      const notices = boolWarnings();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatch(/instances: [^;]*(ok|reviewed)/);
      expect(notices[0]).toContain("frames: flagged");
      expect(notices[0]).toContain(
        "Python sleap-io reads them as the integers 0 and 1",
      );
    }
    // No boolean metadata, or the 2.x layout: no notice.
    warn.mockClear();
    await saveSlpToBytes(built({ boxMetadata: true }), { slpVersion: "v3" });
    await saveSlpToBytes(built({ frameMetadata: true }), { slpVersion: "v2" });
    expect(boolWarnings()).toEqual([]);
  });

  it("refuses a metadata key of mixed kinds before anything is written", async () => {
    const labels = built({ instanceMetadata: true });
    labels.labeledFrames[0].instances[0].metadata.pass = "two";
    const error = await caught(() =>
      saveSlpToBytes(labels, { slpVersion: "v3" }),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('"pass" of /instances');
  });

  it("writes the unknown pose columns back, eager and lazy", async () => {
    await ready;
    for (const labels of [
      await readSlp(slpPath(META), KEEP),
      await readSlpLazy(slpPath(META), KEEP),
    ]) {
      const file = tempFile(await saveSlpToBytes(labels));
      const extra = (p: string) => {
        const h5 = new H5File(p, "r");
        try {
          return ["points", "pred_points", "instances", "frames"].map((t) =>
            Array.from((h5.get(`${t}/extra`) as any).value, Number),
          );
        } finally {
          h5.close();
        }
      };
      expect(extra(file)).toEqual(extra(slpPath(META)));
    }
  });
});

describe("the streaming writer", () => {
  it("takes its layout at open, and refuses to change a 3.0 store's layout", async () => {
    const lazy = await readSlpLazy(slpPath(POSE), { openVideos: false });
    const store = lazy._lazyDataStore!;
    // A writer opened from plain header fields writes the 2.x layout...
    const header = {
      skeletons: store.skeletons,
      videos: store.videos,
      tracks: store.tracks,
    };
    const plain = await openSlpWriter(header);
    expect(plain.layout).toBe("v2");
    // ...so a store kept in format 3.0 is refused, unless asked for.
    expect(await caught(() => plain.appendStore(store))).toBeInstanceOf(Error);
    plain.appendStore(store, { slpVersion: "v2" });
    expect(await layoutOf(plain.close())).toBe("v2");
    // Opened from the labels (or asked), it writes format 3.0.
    const v3 = await openSlpWriter(lazy);
    expect(v3.layout).toBe("v3");
    v3.appendStore(store);
    const bytes = v3.close();
    expect(await layoutOf(bytes)).toBe("v3");
    expect(lazy._slpLayout).toBe("v3");
    const back = await readSlp(bytes, {
      openVideos: false,
      h5: { filenameHint: "stream.slp" },
    });
    expect(describePose(back)).toEqual(
      describePose(await readSlp(slpPath(POSE), { openVideos: false })),
    );
    const asked = await openSlpWriter(header, { slpVersion: "v3" });
    expect(asked.layout).toBe("v3");
    expect(
      await caught(() =>
        asked.appendFrames(built().labeledFrames, { slpVersion: "v2" }),
      ),
    ).toBeInstanceOf(Error);
    asked.dispose();
  });

  it("refuses 3.0 frames whose identities the header lacks, before writing", async () => {
    const labels = await readSlp(slpPath("format3_tables.slp"), KEEP);
    const header = {
      skeletons: labels.skeletons,
      videos: labels.videos,
      tracks: labels.tracks,
    };
    const bare = await openSlpWriter(header, { slpVersion: "v3" });
    const error = await caught(() => bare.appendFrames(labels.labeledFrames));
    expect((error as Error).message).toContain("identities");
    // Frames without identities are written, as before.
    const plain = await readSlp(slpPath(POSE), { openVideos: false });
    const own = await openSlpWriter(
      {
        skeletons: plain.skeletons,
        videos: plain.videos,
        tracks: plain.tracks,
      },
      { slpVersion: "v3" },
    );
    own.appendFrames(plain.labeledFrames);
    own.dispose();
    bare.dispose();
    // With the identities in the header, the links are written.
    const full = await openSlpWriter(
      { ...header, identities: labels.identities },
      { slpVersion: "v3" },
    );
    full.appendFrames(labels.labeledFrames);
    const back = await readSlp(full.close(), {
      openVideos: false,
      h5: { filenameHint: "frames.slp" },
    });
    const named = (l: Labels) =>
      l.labeledFrames.flatMap((f) =>
        f.instances.map((i) => i.identity?.name ?? null),
      );
    expect(named(back)).toEqual(named(labels));
    expect(named(back).some((n) => n !== null)).toBe(true);
  });

  it("merges stores into one layout, decided once", async () => {
    const keep = (await readSlpLazy(slpPath(POSE), { openVideos: false }))
      ._lazyDataStore!;
    const plain = (await readSlpLazy(slpPath(V2), { openVideos: false }))
      ._lazyDataStore!;
    expect(await layoutOf(await saveSlpMergedFromStores([plain]))).toBe("v2");
    expect(await layoutOf(await saveSlpMergedFromStores([keep]))).toBe("v3");
    expect(
      await layoutOf(
        await saveSlpMergedFromStores([keep], { slpVersion: "v2" }),
      ),
    ).toBe("v2");
    const chunks: Uint8Array[] = [];
    await saveSlpMergedToSink(
      [plain],
      { write: (c) => chunks.push(c) },
      {
        slpVersion: "v3",
      },
    );
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    expect(await layoutOf(all)).toBe("v3");
  });
});

// ---- In-place saves ---------------------------------------------------------

/** Run the worker's `updateLabelsInPlace` on `file` for `update`. */
function updateInWorker(
  file: string,
  update: ReturnType<typeof buildLabelTableUpdate>,
): void {
  const dest = new H5File(file, "a");
  try {
    const run = new Function(
      "self",
      `${H5_WORKER_CODE}\nreturn function(d, p) { currentDestFile = d; return updateLabelsInPlace(p); };`,
    )({ postMessage() {} });
    run(dest, inPlacePayload(update).payload);
  } finally {
    dest.close();
  }
}

/** Patch `file` in place, on the main thread or in the worker. */
async function patchInPlace(
  file: string,
  labels: Labels,
  where: "main thread" | "worker",
): Promise<ReturnType<typeof checkInPlaceWritable>> {
  await ready;
  const update = buildLabelTableUpdate(labels);
  const sidecars = buildExpectedSidecars(labels);
  const h5 = new H5File(file, "r");
  let gate: ReturnType<typeof checkInPlaceWritable>;
  try {
    gate = checkInPlaceWritable(update, onDiskTablesFromFile(h5), {
      onDisk: sidecars,
      expected: sidecars,
    });
  } finally {
    h5.close();
  }
  if (!gate.ok) return gate;
  if (where === "worker") {
    updateInWorker(file, update);
  } else {
    const h5a = new H5File(file, "a");
    try {
      writeLabelTablesInPlace(h5a, update);
    } finally {
      h5a.close();
    }
  }
  return gate;
}

/** A value edit: move a point, hide another, change a metadata value. */
function editValues(labels: Labels): void {
  const inst = labels.labeledFrames[0].instances[0];
  inst.points[0].xy = [101, 102];
  inst.points[1].visible = !inst.points[1].visible;
  if ("pass" in inst.metadata) inst.metadata.pass = 7;
}

describe("in-place saves", () => {
  for (const where of ["main thread", "worker"] as const) {
    for (const name of [POSE, META, V2]) {
      it(`patch ${name} value by value (${where})`, async () => {
        const file = tempCopy(name);
        const labels = await readSlp(file, KEEP);
        editValues(labels);
        const layout = await layoutOf(file);
        expect(buildLabelTableUpdate(labels).layout ?? "v2").toBe(layout);
        const gate = await patchInPlace(file, labels, where);
        expect(gate).toEqual({ ok: true });
        // The file keeps its layout, and every reader reads the edit.
        expect(await layoutOf(file)).toBe(layout);
        for (const [label, read] of FILE_READERS) {
          const back = await read(file);
          expect([label, describePose(back)]).toEqual([
            label,
            describePose(labels),
          ]);
        }
      });
    }
  }

  for (const where of ["main thread", "worker"] as const) {
    it(`patch which records hold a metadata key (${where})`, async () => {
      const file = tempCopy(META);
      const labels = await readSlp(file, KEEP);
      const all = labels.labeledFrames.flatMap((f) => f.instances);
      // One record gains a number key others lack, another loses one.
      const without = all.find((i) => !("pass" in i.metadata))!;
      without.metadata.pass = 5;
      delete all.find((i) => "quality" in i.metadata)!.metadata.quality;
      expect(await patchInPlace(file, labels, where)).toEqual({ ok: true });
      const back = await readSlp(file, KEEP);
      expect(describePose(back)).toEqual(describePose(labels));
    });

    it(`patch a structural edit of a chunked 2.x file with HDF5 booleans (${where})`, async () => {
      // SLEAP wrote this file's tables chunked, so they can be resized.
      const file = tempCopy("centered_pair_predictions.slp");
      const labels = await readSlp(file, KEEP);
      labels.labeledFrames[0].instances.pop();
      labels.labeledFrames[3].instances[0].points[0].visible = false;
      expect(await patchInPlace(file, labels, where)).toEqual({ ok: true });
      expect(await layoutOf(file)).toBe("v2");
      const back = await readSlp(file, KEEP);
      expect(describePose(back)).toEqual(describePose(labels));
    });

    it(`patch a format 3.0 file written by sleap-io.js: uint8 flags and a boolean key (${where})`, async () => {
      const file = tempFile(
        await saveSlpToBytes(built({ instanceMetadata: true }), {
          slpVersion: "v3",
        }),
      );
      const labels = await readSlp(file, KEEP);
      const user = labels.labeledFrames[0].instances[1];
      expect(user.metadata.ok).toBe(true);
      user.metadata.ok = false;
      user.points[0].visible = false;
      expect(await patchInPlace(file, labels, where)).toEqual({ ok: true });
      const back = await readSlp(file, KEEP);
      expect(back.labeledFrames[0].instances[1].metadata.ok).toBe(false);
      expect(describePose(back)).toEqual(describePose(labels));
    });
  }

  it("keep the NaN tracking scores of a Python-written 2.x file", async () => {
    await ready;
    const scores = (f: string) => {
      const h5 = new H5File(f, "r");
      try {
        const rows = (h5.get("instances") as any).value as number[][];
        return rows.map((r) => num(Number(r[9])));
      } finally {
        h5.close();
      }
    };
    for (const where of ["main thread", "worker"] as const) {
      const file = tempCopy(V2);
      const before = scores(file);
      expect(before).toContain("nan");
      const labels = await readSlp(file, KEEP);
      expect(await patchInPlace(file, labels, where)).toEqual({ ok: true });
      expect([where, scores(file)]).toEqual([where, before]);
    }
    // Matched by instance, not by row: an instance put in the place of one
    // read with a NaN score keeps its own score.
    const file = tempCopy(V2);
    const before = scores(file);
    const labels = await readSlp(file, KEEP);
    const frame = labels.labeledFrames.find((f) =>
      f.instances.some((i) => !(i instanceof PredictedInstance)),
    )!;
    const row = labels.labeledFrames
      .flatMap((f) => f.instances)
      .findIndex(
        (i) => frame.instances.includes(i) && !(i instanceof PredictedInstance),
      );
    expect(before[row]).toBe("nan");
    const k = frame.instances.findIndex(
      (i) => !(i instanceof PredictedInstance),
    );
    const old = frame.instances[k] as Instance;
    frame.instances[k] = new Instance({
      skeleton: old.skeleton,
      points: old.points.map((p) => ({
        ...p,
        xy: [...p.xy] as [number, number],
      })),
      track: old.track,
    });
    expect(await patchInPlace(file, labels, "main thread")).toEqual({
      ok: true,
    });
    const after = scores(file);
    expect(after[row]).toBe(0);
    expect(after.filter((v, i) => i !== row)).toEqual(
      before.filter((v, i) => i !== row),
    );
  });

  it("send a table holding an enum other than a boolean to a full save", async () => {
    const labels = built();
    const update = buildLabelTableUpdate(labels, { slpVersion: "v2" });
    const sidecars = buildExpectedSidecars(labels);
    const table = (rows: number, enumMembers: Record<string, number>) => ({
      rows,
      cols: 4,
      layout: "compound" as const,
      chunked: true,
      members: [
        { name: "x", typeClass: 1, size: 8 },
        { name: "y", typeClass: 1, size: 8 },
        { name: "visible", typeClass: 8, size: 1, enumMembers },
        { name: "complete", typeClass: 8, size: 1, enumMembers },
      ],
    });
    const gate = (enumMembers: Record<string, number>) =>
      checkInPlaceWritable(
        update,
        { points: table(update.points.rows.length, enumMembers) },
        { onDisk: sidecars, expected: sidecars },
      );
    expect(gate({ FALSE: 0, TRUE: 1 })).toEqual({ ok: true });
    for (const other of [
      { NO: 0, YES: 1 },
      { FALSE: 0, TRUE: 1, MAYBE: 2 },
      { FALSE: 1, TRUE: 0 },
    ]) {
      expect(gate(other).ok).toBe(false);
    }
  });

  it("send a structural edit of a format 3.0 file to a full save", async () => {
    const file = tempCopy(POSE);
    const labels = await readSlp(file, KEEP);
    labels.labeledFrames[0].instances.pop();
    const gate = await patchInPlace(file, labels, "main thread");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("row count changed");
  });

  it("send new metadata keys of a format 3.0 file to a full save", async () => {
    const file = tempCopy(META);
    const labels = await readSlp(file, KEEP);
    labels.labeledFrames[0].instances[0].metadata.fresh = 1;
    const gate = await patchInPlace(file, labels, "main thread");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("metadata keys");
  });

  for (const where of ["main thread", "worker"] as const) {
    it(`refuse a changed string metadata value before writing anything (${where})`, async () => {
      const file = tempCopy(META);
      const before = readFileSync(file);
      const labels = await readSlp(file, KEEP);
      editValues(labels);
      labels.labeledFrames[0].instances[0].metadata.annotator = "someone else";
      const update = buildLabelTableUpdate(labels);
      const error = await caught(() => {
        if (where === "worker") return updateInWorker(file, update);
        const h5 = new H5File(file, "a");
        try {
          writeLabelTablesInPlace(h5, update);
        } finally {
          h5.close();
        }
      });
      expect((error as Error).message).toContain("string value");
      const after = await readSlp(file, KEEP);
      expect(describePose(after)).toEqual(
        describePose(
          await readSlp(new Uint8Array(before), {
            ...KEEP,
            h5: { filenameHint: "before.slp" },
          }),
        ),
      );
    });
  }

  it("send a 2.x update of an edit-loaded 3.0 file to a full save", async () => {
    const file = tempCopy(POSE);
    const labels = await readSlp(file, { openVideos: false, format3: "edit" });
    const gate = await patchInPlace(file, labels, "main thread");
    expect(gate.ok).toBe(false);
  });
});

// ---- Python ---------------------------------------------------------------

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

/** Read a file in Python: the pose tables, flags, metadata and dtypes. */
const READ_BACK_PY = `
import json, math, sys
import h5py
import sleap_io as sio
path = sys.argv[1]
out = {"version": sio.__version__}
try:
    labels = sio.load_slp(path)
except Exception as e:
    out["error"] = repr(e)
    print(json.dumps(out))
    sys.exit(0)
with h5py.File(path, "r") as f:
    out["format_id"] = float(f["metadata"].attrs["format_id"])
    pts = f["points"]
    out["visible_dtype"] = str(pts["visible"].dtype)
def num(v):
    if v is None:
        return None
    v = float(v)
    return "nan" if math.isnan(v) else v
def meta(d):
    return {k: (int(v) if isinstance(v, bool) else v) for k, v in (d or {}).items()}
frames = []
for lf in labels.labeled_frames:
    insts = []
    for inst in lf.instances:
        p = inst.points
        insts.append({
            "predicted": type(inst).__name__ == "PredictedInstance",
            "track": inst.track.name if inst.track else None,
            "xy": [[num(c) for c in xy] for xy in p["xy"].tolist()],
            "visible": [bool(v) for v in p["visible"]],
            "labeled": [bool(v) for v in p["labeled"]] if "labeled" in p.dtype.names else None,
            "metadata": meta(getattr(inst, "metadata", {})),
        })
    frames.append({
        "video": labels.videos.index(lf.video),
        "frame_idx": int(lf.frame_idx),
        "negative": bool(getattr(lf, "is_negative", False)),
        "metadata": meta(getattr(lf, "metadata", {})),
        "bboxes": [meta(getattr(b, "metadata", {})) for b in getattr(lf, "bboxes", [])],
        "instances": insts,
    })
out["frames"] = frames
print(json.dumps(out))
`;

function readInPython(
  python: { cmd: string; args: string[] },
  file: string,
): Record<string, any> {
  const out = execFileSync(
    python.cmd,
    [...python.args, "-c", READ_BACK_PY, file],
    {
      timeout: 120_000,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).toString();
  return JSON.parse(out.trim().split("\n").pop()!);
}

/** The pose content of a Python read, as JS labels give it. */
function poseFromJs(labels: Labels) {
  const meta = (m: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(m).map(([k, v]) => [
        k,
        typeof v === "boolean" ? Number(v) : v,
      ]),
    );
  return labels.labeledFrames.map((f) => ({
    video: labels.videos.indexOf(f.video),
    frame_idx: f.frameIdx,
    negative: f.isNegative,
    metadata: meta(f.metadata),
    bboxes: f.bboxes.map((b) => meta(b.metadata)),
    instances: f.instances.map((i) => ({
      predicted: i instanceof PredictedInstance,
      track: i.track?.name ?? null,
      // Python 0.10 reads an unlabelled point, and a hidden one of a 2.x
      // file, without a location.
      xy: i.points.map((p) =>
        p.labeled === false ? ["nan", "nan"] : p.xy.map(num),
      ),
      visible: i.points.map((p) => p.visible),
      labeled: i.points.map((p) => p.labeled !== false),
      metadata: meta(i.metadata),
    })),
  }));
}

describe("format 3.0 saves read back in Python sleap-io", () => {
  for (const python of pythons()) {
    for (const [what, save] of [
      [
        `an eager save of ${META}`,
        async () => saveSlpToBytes(await readSlp(slpPath(META), KEEP)),
      ],
      [
        `a lazy save of ${META}`,
        async () => saveSlpToBytes(await readSlpLazy(slpPath(META), KEEP)),
      ],
      [
        "a save of labels built in memory",
        async () =>
          saveSlpToBytes(
            built({
              unlabeled: true,
              instanceMetadata: true,
              frameMetadata: true,
              boxMetadata: true,
            }),
          ),
      ],
    ] as const) {
      it.skipIf(SKIP_PYTHON)(`${what}, with ${python.label}`, async () => {
        const file = tempFile(await save());
        const result = readInPython(python, file);
        if (!String(result.version).startsWith("0.10")) {
          console.log(
            `${what} refused by sleap-io ${result.version} (${python.label}): ${result.error}`,
          );
          expect(result.error).toMatch(/3\.0|format/i);
          return;
        }
        console.log(
          `${what} read back with sleap-io ${result.version} (${python.label})`,
        );
        expect(result.error).toBeUndefined();
        expect(result.format_id).toBe(3);
        // Flags are uint8 on disk (h5wasm cannot write HDF5 booleans).
        expect(result.visible_dtype).toBe("uint8");
        const js = await readSlp(file, KEEP);
        expect(result.frames).toEqual(poseFromJs(js));
        if (what.includes(META)) {
          // As Python reads the fixture it wrote itself.
          const fixture = readInPython(python, slpPath(META));
          expect(result.frames).toEqual(fixture.frames);
        }
      });
    }

    it.skipIf(SKIP_PYTHON)(
      `format 3.0 saves of 2.x files write the points as stored, with ${python.label}`,
      async () => {
        // Hidden points keep their coordinates and visible points without
        // coordinates stay visible, as Python 0.10 loads an older file by
        // default (its clean_legacy_points option changes them).
        for (const name of [
          "centered_pair_predictions.slp",
          "py_written_bboxes.slp",
          "multiview.slp",
        ]) {
          const labels = await readSlp(slpPath(name), { openVideos: false });
          const file = tempFile(
            await saveSlpToBytes(labels, { slpVersion: "v3" }),
          );
          const result = readInPython(python, file);
          if (result.error) {
            expect(String(result.version).startsWith("0.10")).toBe(false);
            continue;
          }
          console.log(
            `a 3.0 save of ${name} read back with sleap-io ${result.version} (${python.label})`,
          );
          const js = await readSlp(file, KEEP);
          expect(describePose(js)).toEqual(describePose(labels));
          expect([name, result.frames]).toEqual([name, poseFromJs(labels)]);
        }
      },
    );

    it.skipIf(SKIP_PYTHON)(
      `a structural in-place patch of a chunked 2.x file, with ${python.label}`,
      async () => {
        const file = tempCopy("centered_pair_predictions.slp");
        const labels = await readSlp(file, KEEP);
        labels.labeledFrames[0].instances.pop();
        labels.labeledFrames[5].instances[0].points[1].xy = [11, 12];
        expect(await patchInPlace(file, labels, "worker")).toEqual({
          ok: true,
        });
        const result = readInPython(python, file);
        console.log(
          `a structural in-place patch read back with sleap-io ${result.version} (${python.label})`,
        );
        expect(result.visible_dtype).toBe("bool");
        expect(
          result.frames.map(
            (f: { instances: unknown[] }) => f.instances.length,
          ),
        ).toEqual(labels.labeledFrames.map((f) => f.instances.length));
        expect(result.frames[5].instances[0].xy[1]).toEqual([11, 12]);
      },
    );

    it.skipIf(SKIP_PYTHON)(
      `an in-place patch of a gzip-compressed format 3.0 file, with ${python.label}`,
      async () => {
        const version = String(readInPython(python, slpPath(POSE)).version);
        if (!version.startsWith("0.10")) return;
        // Python writes compressed columns when asked.
        const file = path.join(
          mkdtempSync(path.join(tmpdir(), "sleap-io-js-version-")),
          "gzip.slp",
        );
        execFileSync(
          python.cmd,
          [
            ...python.args,
            "-c",
            "import sys, sleap_io as sio\n" +
              "sio.save_slp(sio.load_slp(sys.argv[1]), sys.argv[2], compression='gzip')",
            slpPath(META),
            file,
          ],
          { timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
        );
        for (const where of ["main thread", "worker"] as const) {
          const copy = tempCopy(file);
          const labels = await readSlp(copy, KEEP);
          editValues(labels);
          expect(await patchInPlace(copy, labels, where)).toEqual({ ok: true });
          const back = await readSlp(copy, KEEP);
          expect(describePose(back)).toEqual(describePose(labels));
          const result = readInPython(python, copy);
          expect(result.frames).toEqual(poseFromJs(labels));
        }
      },
    );

    for (const where of ["main thread", "worker"] as const) {
      it.skipIf(SKIP_PYTHON)(
        `in-place patches of ${V2} (HDF5 booleans) and ${META}, ${where}, with ${python.label}`,
        async () => {
          for (const name of [V2, META]) {
            const file = tempCopy(name);
            const labels = await readSlp(file, KEEP);
            editValues(labels);
            expect(await patchInPlace(file, labels, where)).toEqual({
              ok: true,
            });
            const result = readInPython(python, file);
            if (result.error) {
              // sleap-io before 0.10 refuses the format 3.0 file only.
              expect(name).toBe(META);
              continue;
            }
            console.log(
              `in-place patch of ${name} read back with sleap-io ${result.version} (${python.label})`,
            );
            // The 2.x file keeps its HDF5 booleans.
            if (name === V2) expect(result.visible_dtype).toBe("bool");
            const inst = result.frames[0].instances[0];
            expect(inst.xy[0]).toEqual([101, 102]);
            expect(inst.visible[1]).toBe(
              labels.labeledFrames[0].instances[0].points[1].visible,
            );
            if (name === META) expect(inst.metadata.pass).toBe(7);
          }
        },
      );
    }
  }
});

it("labels from a format 3.0 file carry the keep mark on every record", async () => {
  const labels = await readSlp(slpPath(META), KEEP);
  expect(sourceMarkOf(labels.labeledFrames[0])?.access).toBe("keep");
  expect(sourceMarkOf(labels.labeledFrames[0].instances[0])?.access).toBe(
    "keep",
  );
});
