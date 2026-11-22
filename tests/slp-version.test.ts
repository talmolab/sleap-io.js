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
    const formatId = Number((h5.get("metadata") as any).attrs.format_id.value);
    const columnar = (h5.get("points") as any).type === "Group";
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
      trackingScore: num(i.trackingScore),
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
  ["readSlp", (f) => readSlp(f, { openVideos: false })],
  [
    "readSlpLazy",
    async (f) => {
      const labels = await readSlpLazy(f, { openVideos: false });
      labels.materialize();
      return labels;
    },
  ],
  ["readFromStreamingFile", (f) => readStreaming(f)],
  ["readFromStreamingFile (lazy)", (f) => readStreaming(f, undefined, true)],
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
    const meta = await readSlp(slpPath(META), { openVideos: false });
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
        const labels = await readSlp(slpPath(META), { openVideos: false });
        return [await saveSlpToBytes(labels), labels];
      },
    ],
    [
      `a lazy save of ${META}`,
      async () => {
        const labels = await readSlpLazy(slpPath(META), { openVideos: false });
        const bytes = await saveSlpToBytes(labels);
        return [bytes, await readSlp(slpPath(META), { openVideos: false })];
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
        const labels = await readSlpLazy(slpPath(META), { openVideos: false });
        const bytes = await saveSlpMergedFromStores([labels._lazyDataStore!]);
        return [bytes, await readSlp(slpPath(META), { openVideos: false })];
      },
    ],
    [
      `a streaming-writer save of ${META} (frames appended)`,
      async () => {
        const labels = await readSlp(slpPath(META), { openVideos: false });
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
    const labels = await readSlp(slpPath(META), { openVideos: false });
    const back = await readSlp(await saveSlpToBytes(labels), {
      openVideos: false,
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
      async () =>
        saveSlpToBytes(await readSlpLazy(slpPath(META), { openVideos: false })),
      async () =>
        saveSlpMergedFromStores([
          (await readSlpLazy(slpPath(META), { openVideos: false }))
            ._lazyDataStore!,
        ]),
      async () => {
        const labels = await readSlp(slpPath(META), { openVideos: false });
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
      await readSlp(slpPath(META), { openVideos: false }),
      await readSlpLazy(slpPath(META), { openVideos: false }),
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
        const labels = await readSlp(file, { openVideos: false });
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

  it("send a structural edit of a format 3.0 file to a full save", async () => {
    const file = tempCopy(POSE);
    const labels = await readSlp(file, { openVideos: false });
    labels.labeledFrames[0].instances.pop();
    const gate = await patchInPlace(file, labels, "main thread");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("row count changed");
  });

  it("send new metadata keys of a format 3.0 file to a full save", async () => {
    const file = tempCopy(META);
    const labels = await readSlp(file, { openVideos: false });
    labels.labeledFrames[0].instances[0].metadata.fresh = 1;
    const gate = await patchInPlace(file, labels, "main thread");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("metadata keys");
  });

  for (const where of ["main thread", "worker"] as const) {
    it(`refuse a changed string metadata value before writing anything (${where})`, async () => {
      const file = tempCopy(META);
      const before = readFileSync(file);
      const labels = await readSlp(file, { openVideos: false });
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
      const after = await readSlp(file, { openVideos: false });
      expect(describePose(after)).toEqual(
        describePose(
          await readSlp(new Uint8Array(before), {
            openVideos: false,
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
        async () =>
          saveSlpToBytes(await readSlp(slpPath(META), { openVideos: false })),
      ],
      [
        `a lazy save of ${META}`,
        async () =>
          saveSlpToBytes(
            await readSlpLazy(slpPath(META), { openVideos: false }),
          ),
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
        const js = await readSlp(file, { openVideos: false });
        expect(result.frames).toEqual(poseFromJs(js));
        if (what.includes(META)) {
          // As Python reads the fixture it wrote itself.
          const fixture = readInPython(python, slpPath(META));
          expect(result.frames).toEqual(fixture.frames);
        }
      });
    }

    for (const where of ["main thread", "worker"] as const) {
      it.skipIf(SKIP_PYTHON)(
        `in-place patches of ${V2} (HDF5 booleans) and ${META}, ${where}, with ${python.label}`,
        async () => {
          for (const name of [V2, META]) {
            const file = tempCopy(name);
            const labels = await readSlp(file, { openVideos: false });
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
  const labels = await readSlp(slpPath(META), { openVideos: false });
  expect(sourceMarkOf(labels.labeledFrames[0])?.access).toBe("keep");
  expect(sourceMarkOf(labels.labeledFrames[0].instances[0])?.access).toBe(
    "keep",
  );
});
