/**
 * SLP format 3.0 content the 2.x layout cannot store, and the choice every
 * reader asks for at open time (`format3: "view" | "edit"`).
 *
 * Fixtures (`tests/data/slp/gen_format3_pose_fixture.py`, written with Python
 * sleap-io 0.10.0 from `release/0.10` at commit fe4f91c7b):
 *   - format3_pose.slp: format 3.0 with nothing the 2.x layout cannot store
 *   - format3_metadata.slp: unlabelled user and predicted points, metadata of
 *     every kind on instances, frames and boxes (some records lacking a key),
 *     unknown columns, and `metadata/` members readers ignore
 *   - format3_defaults.slp: format3_pose.slp without any optional column
 *   - format3_bad_frame_id.slp: an instance whose `frame_id` is wrong
 *
 * Python read-backs run each interpreter listed (comma-separated) in
 * `SLEAP_IO_TEST_PYTHONS`, or `uv run --with sleap-io python` when unset, and
 * print the sleap-io version each one ran.
 */
import {
  describe,
  it,
  expect,
  setDefaultTimeout,
  afterEach,
  beforeEach,
  vi,
} from "./bun-test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ready, File as H5File } from "h5wasm/node";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import { SlpFormatError } from "../src/codecs/slp/format-check.js";
import {
  type Format3Access,
  type Format3Summary,
  SlpFormat3ChoiceError,
  SlpViewOnlyError,
} from "../src/codecs/slp/format3.js";
import { checkPoseTables } from "../src/codecs/slp/columnar.js";
import {
  buildLabelTableUpdate,
  checkInPlaceWritable,
  openSlpWriter,
  saveSlpMergedFromStores,
  saveSlpMergedToSink,
  saveSlpStructureToBytes,
  saveSlpToBytes,
  writeLabelTablesInPlace,
  writeSlp,
} from "../src/codecs/slp/write.js";
import { loadSlp, saveSlp, saveSlpSet } from "../src/index.js";
import { loadSlpMetadata } from "../src/lite.js";
import {
  Instance,
  PredictedInstance,
  type Point,
} from "../src/model/instance.js";
import { Labels } from "../src/model/labels.js";
import { LabelsSet } from "../src/model/labels-set.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { UserBoundingBox } from "../src/model/bbox.js";
import { slpBytes, slpPath, streamingFile } from "./slp-format3-files";

setDefaultTimeout(120_000);

const POSE = "format3_pose.slp";
const META = "format3_metadata.slp";
const DEFAULTS = "format3_defaults.slp";
const BAD_FRAME_ID = "format3_bad_frame_id.slp";
const V2 = "format3_pose.v2.slp";

/** Load a fixture through the streaming reader (see slp-format3-files.ts). */
async function readStreaming(
  name: string,
  format3?: Format3Access,
  lazy = false,
): Promise<Labels> {
  const { file, close } = await streamingFile(name);
  try {
    const labels = await readFromStreamingFile(
      file,
      `https://example.com/${name}`,
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

type Reader = (name: string, format3?: Format3Access) => Promise<Labels>;

/** Every reader that returns labels, as calls that load the named fixture. */
const READERS: Array<[string, Reader]> = [
  ["readSlp", (n, f) => readSlp(slpPath(n), { openVideos: false, format3: f })],
  [
    "readSlpLazy",
    async (n, f) => {
      const labels = await readSlpLazy(slpPath(n), {
        openVideos: false,
        format3: f,
      });
      labels.materialize();
      return labels;
    },
  ],
  ["loadSlp", (n, f) => loadSlp(slpPath(n), { openVideos: false, format3: f })],
  ["readFromStreamingFile", (n, f) => readStreaming(n, f)],
  ["readFromStreamingFile (lazy)", (n, f) => readStreaming(n, f, true)],
];

async function caught(run: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("expected an error");
}

const POSE_SUMMARY: Format3Summary = {
  formatId: 3,
  unlabeledPoints: 0,
  unlabeledUserPoints: 0,
  unlabeledPredictedPoints: 0,
  metadataKeys: { instances: [], frames: [], bboxes: [] },
  unknownColumns: [],
  lossless: true,
};

const META_SUMMARY: Format3Summary = {
  formatId: 3,
  unlabeledPoints: 2,
  unlabeledUserPoints: 1,
  unlabeledPredictedPoints: 1,
  metadataKeys: {
    instances: ["annotator", "pass", "quality", "reviewed"],
    frames: ["flagged", "note"],
    bboxes: ["label", "source_id"],
  },
  unknownColumns: [
    "bboxes/extra",
    "frames/extra",
    "instances/extra",
    "points/extra",
    "pred_points/extra",
  ],
  lossless: false,
};

describe("a 3.0 file asks for the choice at open time", () => {
  for (const [label, load] of READERS) {
    it(`${label} throws SlpFormat3ChoiceError for a lossless file`, async () => {
      const error = (await caught(() => load(POSE))) as SlpFormat3ChoiceError;
      expect(error).toBeInstanceOf(SlpFormat3ChoiceError);
      expect(error).toBeInstanceOf(SlpFormatError);
      expect(error.formatId).toBe(3);
      expect(error.summary).toEqual(POSE_SUMMARY);
      expect(error.message).toContain("SLP format 3.0");
      expect(error.message).toContain("nothing in it would be dropped");
      expect(error.message).toContain('format3: "view"');
      expect(error.message).toContain('format3: "edit"');
    });

    it(`${label} names what an edit would drop`, async () => {
      const error = (await caught(() => load(META))) as SlpFormat3ChoiceError;
      expect(error).toBeInstanceOf(SlpFormat3ChoiceError);
      expect(error.summary).toEqual(META_SUMMARY);
      expect(error.message).toContain("2 unlabelled point(s)");
      expect(error.message).toContain(
        "instance metadata (annotator, pass, quality, reviewed)",
      );
      expect(error.message).toContain("points/extra");
    });

    it(`${label} ignores the option for a 2.x file`, async () => {
      const plain = await load(V2);
      const edit = await load(V2, "edit");
      const view = await load(V2, "view");
      for (const labels of [plain, edit, view]) {
        expect(labels.sourceFormat).toBeNull();
        expect(labels.labeledFrames.length).toBe(4);
      }
    });

    it(`${label} records the choice on the labels`, async () => {
      const view = await load(META, "view");
      expect(view.sourceFormat?.access).toBe("view");
      expect(view.sourceFormat?.formatId).toBe(3);
      expect(view.sourceFormat?.summary).toEqual(META_SUMMARY);
      const edit = await load(POSE, "edit");
      expect(edit.sourceFormat?.access).toBe("edit");
      expect(edit.sourceFormat?.summary.lossless).toBe(true);
    });
  }

  it("refuses an unknown choice", async () => {
    const error = await caught(() =>
      readSlp(slpPath(POSE), {
        openVideos: false,
        format3: "write" as Format3Access,
      }),
    );
    expect((error as Error).message).toContain('"view" or "edit"');
  });

  it("the lite reader returns the same summary without throwing", async () => {
    expect((await loadSlpMetadata(slpBytes(POSE))).format3).toEqual(
      POSE_SUMMARY,
    );
    expect((await loadSlpMetadata(slpBytes(META))).format3).toEqual(
      META_SUMMARY,
    );
    expect((await loadSlpMetadata(slpBytes(V2))).format3).toBeUndefined();
  });
});

describe("what format 3.0 adds is read into the model", () => {
  for (const [label, load] of READERS) {
    it(`${label} reads labelled flags and metadata of each kind`, async () => {
      const labels = await load(META, "view");
      const [f0, f5, f2, f7] = labels.labeledFrames;
      const [user, pred] = f0.instances;
      expect(user.points.map((p) => p.labeled)).toEqual([true, true, false]);
      expect(user.points.map((p) => p.visible)).toEqual([true, true, false]);
      expect(pred.points.map((p) => p.labeled)).toEqual([false, true, true]);
      expect(user.nUnlabeled).toBe(1);
      expect(f5.instances[0].points.every((p) => p.labeled)).toBe(true);

      // Every kind, with keys only on the records that hold them (`present`).
      expect(user.metadata).toEqual({
        annotator: "someone",
        reviewed: true,
        pass: 2,
        quality: 0.5,
      });
      expect(pred.metadata).toEqual({
        reviewed: false,
        pass: 1,
        quality: 0.25,
      });
      expect(f5.instances.map((i) => i.metadata)).toEqual([{ pass: 3 }, {}]);
      expect(f2.instances[0].metadata).toEqual({});
      expect(f0.metadata).toEqual({ note: "frame note", flagged: true });
      expect(f5.metadata).toEqual({});
      expect(f7.metadata).toEqual({ note: "negative" });
      expect(f7.isNegative).toBe(true);
      expect(f0.bboxes.map((b) => b.metadata)).toEqual([
        { source_id: 7, label: "box" },
        {},
      ]);
      // No tracking score (Python's None) stays NaN from a 3.0 file.
      expect(user.trackingScore).toBeNaN();
      expect(pred.trackingScore).toBe(0.5);
    });

    it(`${label} reads missing optional columns as their defaults`, async () => {
      const labels = await load(DEFAULTS, "edit");
      expect(labels.labeledFrames.map((f) => f.isNegative)).toEqual([
        false,
        false,
        false,
        false,
      ]);
      for (const inst of labels.labeledFrames.flatMap((f) => f.instances)) {
        expect(inst.track).toBeNull();
        expect(inst.trackingScore).toBeNaN();
        expect(inst.fromPredicted).toBeNull();
        for (const p of inst.points) {
          expect(p.visible).toBe(false);
          expect(p.complete).toBe(false);
          expect(p.labeled).toBe(true);
        }
        if (inst instanceof PredictedInstance) {
          expect(inst.score).toBeNaN();
          expect(inst.points.every((p) => Number.isNaN(p.score))).toBe(true);
        }
      }
      expect(labels.labeledFrames[0].instances[0].points[0].xy).toEqual([
        10, 20,
      ]);
    });

    it(`${label} refuses inconsistent 3.0 tables, naming the table`, async () => {
      const error = (await caught(() => load(BAD_FRAME_ID, "edit"))) as Error;
      expect(error).not.toBeInstanceOf(SlpFormat3ChoiceError);
      expect(error.message).toContain("inconsistent pose tables");
      expect(error.message).toContain(
        "/instances frame_id disagrees with the /frames ranges",
      );
    });
  }

  it("copy and extract carry the source format, flags and metadata", async () => {
    const labels = await readSlp(slpPath(META), {
      openVideos: false,
      format3: "view",
    });
    for (const copy of [labels.copy(), labels.extract([0, 3])]) {
      expect(copy.sourceFormat).toBe(labels.sourceFormat);
      const f0 = copy.labeledFrames[0];
      expect(f0.metadata).toEqual({ note: "frame note", flagged: true });
      expect(f0.instances[0].metadata.annotator).toBe("someone");
      expect(f0.instances[0].points[2].labeled).toBe(false);
      expect(f0.bboxes[0].metadata).toEqual({ source_id: 7, label: "box" });
      // Independent dictionaries.
      f0.metadata.note = "changed";
      expect(labels.labeledFrames[0].metadata.note).toBe("frame note");
    }
    const lazy = await readSlpLazy(slpPath(META), {
      openVideos: false,
      format3: "view",
    });
    const lazyCopy = lazy.copy();
    expect(lazyCopy.sourceFormat?.access).toBe("view");
    expect(lazyCopy._lazyDataStore?.sourceFormat?.access).toBe("view");
    lazyCopy.materialize();
    expect(lazyCopy.labeledFrames[0].instances[0].metadata.pass).toBe(2);
    expect(
      lazyCopy.labeledFrames.map((f) => lazyCopy.videos.indexOf(f.video)),
    ).toEqual([0, 0, 1, 1]);
  });

  it("merge carries instance and frame metadata", async () => {
    const source = await readSlp(slpPath(META), {
      openVideos: false,
      format3: "view",
    });
    const target = new Labels();
    await target.merge(source);
    const f0 = target.labeledFrames[0];
    expect(f0.metadata).toEqual({ note: "frame note", flagged: true });
    expect(f0.instances[0].metadata.annotator).toBe("someone");
    expect(f0.instances[0].points[2].labeled).toBe(false);
    // Merging is not loading: the target was not opened from a file.
    expect(target.sourceFormat).toBeNull();
  });
});

describe("labels loaded view-only are refused by every writer", () => {
  const view = () =>
    readSlp(slpPath(META), { openVideos: false, format3: "view" });
  const viewLazy = () =>
    readSlpLazy(slpPath(META), { openVideos: false, format3: "view" });
  const tmp = () => mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));

  const writers: Array<[string, () => Promise<unknown>]> = [
    ["saveSlpToBytes", async () => saveSlpToBytes(await view())],
    ["saveSlpToBytes (lazy)", async () => saveSlpToBytes(await viewLazy())],
    [
      "saveSlpStructureToBytes",
      async () => saveSlpStructureToBytes(await view()),
    ],
    ["openSlpWriter", async () => openSlpWriter(await view())],
    [
      "SlpStreamWriter.appendStore",
      async () => {
        const labels = await viewLazy();
        const writer = await openSlpWriter({
          skeletons: labels.skeletons,
          videos: labels.videos,
          tracks: labels.tracks,
        });
        try {
          writer.appendStore(labels._lazyDataStore!);
        } finally {
          writer.dispose();
        }
      },
    ],
    [
      "saveSlpMergedFromStores",
      async () => saveSlpMergedFromStores([(await viewLazy())._lazyDataStore!]),
    ],
    ["buildLabelTableUpdate", async () => buildLabelTableUpdate(await view())],
    [
      "checkInPlaceWritable",
      async () => {
        const labels = await view();
        const empty = {
          tracksJson: null,
          suggestionsJson: null,
          metadataJson: null,
          videos: null,
        };
        return checkInPlaceWritable(
          {
            frames: { fields: [], rows: [] },
            instances: { fields: [], rows: [] },
            points: { fields: [], rows: [] },
            predPoints: { fields: [], rows: [] },
            sourceFormat: labels.sourceFormat,
          },
          {},
          { onDisk: empty, expected: empty },
        );
      },
    ],
  ];
  for (const [label, write] of writers) {
    it(label, async () => {
      const error = (await caught(write)) as SlpViewOnlyError;
      expect(error).toBeInstanceOf(SlpViewOnlyError);
      expect(error.sourceFormat.access).toBe("view");
      expect(error.message).toContain('format3: "edit"');
      expect(error.message).toContain(META);
    });
  }

  it("writeSlp and saveSlp leave no file", async () => {
    const dir = tmp();
    const labels = await view();
    for (const save of [
      () => writeSlp(path.join(dir, "a.slp"), labels),
      () => saveSlp(labels, path.join(dir, "b.slp")),
    ]) {
      expect(await caught(save)).toBeInstanceOf(SlpViewOnlyError);
    }
    expect(existsSync(path.join(dir, "a.slp"))).toBe(false);
    expect(existsSync(path.join(dir, "b.slp"))).toBe(false);
  });

  it("saveSlpSet writes none of the set", async () => {
    const dir = tmp();
    const editable = await readSlp(slpPath(V2), { openVideos: false });
    const set = new LabelsSet();
    set.set(path.join(dir, "first.slp"), editable);
    set.set(path.join(dir, "second.slp"), await view());
    expect(await caught(() => saveSlpSet(set))).toBeInstanceOf(
      SlpViewOnlyError,
    );
    expect(existsSync(path.join(dir, "first.slp"))).toBe(false);
    expect(existsSync(path.join(dir, "second.slp"))).toBe(false);
  });

  it("saveSlpMergedToSink writes nothing to the sink", async () => {
    const chunks: Uint8Array[] = [];
    const sink = { write: (c: Uint8Array) => void chunks.push(c) };
    const store = (await viewLazy())._lazyDataStore!;
    expect(
      await caught(() => saveSlpMergedToSink([store], sink)),
    ).toBeInstanceOf(SlpViewOnlyError);
    expect(chunks.length).toBe(0);
  });

  it("writeLabelTablesInPlace leaves the file as it was", async () => {
    await ready;
    const dir = tmp();
    const target = path.join(dir, "inplace.slp");
    copyFileSync(slpPath(V2), target);
    const before = readFileSync(target);
    const editable = await readSlp(slpPath(V2), { openVideos: false });
    const update = buildLabelTableUpdate(editable);
    update.sourceFormat = (await view()).sourceFormat;
    const file = new H5File(target, "a");
    try {
      expect(
        await caught(() => writeLabelTablesInPlace(file, update)),
      ).toBeInstanceOf(SlpViewOnlyError);
    } finally {
      file.close();
    }
    expect(readFileSync(target).equals(before)).toBe(true);
  });
});

/** Read back a JS save in JS: the 2.x layout, with nothing 3.0-only left. */
async function expectEditSave(bytes: Uint8Array): Promise<Labels> {
  const back = await readSlp(bytes, {
    openVideos: false,
    h5: { filenameHint: "saved.slp" },
  });
  expect(back.sourceFormat).toBeNull();
  const [f0, f5, , f7] = back.labeledFrames;
  const [user, pred] = f0.instances;
  // Unlabelled points come back as hidden points with no location.
  expect(user.points.map((p) => p.visible)).toEqual([true, true, false]);
  expect(user.points[2].xy).toEqual([Number.NaN, Number.NaN]);
  expect(pred.points[0].visible).toBe(false);
  expect(pred.points[0].xy).toEqual([Number.NaN, Number.NaN]);
  expect(user.points[0].xy).toEqual([10, 20]);
  for (const inst of back.labeledFrames.flatMap((f) => f.instances)) {
    expect(inst.points.every((p) => p.labeled)).toBe(true);
    expect(inst.metadata).toEqual({});
  }
  for (const frame of back.labeledFrames) {
    expect(frame.metadata).toEqual({});
    for (const box of frame.bboxes) expect(box.metadata).toEqual({});
  }
  expect(f0.bboxes.length).toBe(2);
  expect(f7.isNegative).toBe(true);
  expect(f5.instances[1].fromPredicted).toBe(f5.instances[0]);
  return back;
}

/** The SLP format of a file on disk. */
async function formatIdOf(bytes: Uint8Array): Promise<number> {
  await ready;
  const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
  const file = path.join(dir, "probe.slp");
  writeFileSync(file, bytes);
  const h5 = new H5File(file, "r");
  try {
    return Number((h5.get("metadata") as any).attrs.format_id.value);
  } finally {
    h5.close();
  }
}

describe("labels loaded for editing save the 2.x layout", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("in memory", async () => {
    const labels = await readSlp(slpPath(META), {
      openVideos: false,
      format3: "edit",
    });
    const bytes = await saveSlpToBytes(labels);
    expect(await formatIdOf(bytes)).toBeLessThan(3);
    await expectEditSave(bytes);
    // The caller already chose to drop these: no warning.
    expect(warn).not.toHaveBeenCalled();
  });

  it("lazy (written from the raw tables)", async () => {
    const labels = await readSlpLazy(slpPath(META), {
      openVideos: false,
      format3: "edit",
    });
    await expectEditSave(await saveSlpToBytes(labels));
    expect(labels.isLazy).toBe(true);
  });

  it("streaming writer and merge", async () => {
    const labels = await readSlpLazy(slpPath(META), {
      openVideos: false,
      format3: "edit",
    });
    const writer = await openSlpWriter(labels);
    writer.appendStore(labels._lazyDataStore!);
    const back = await readSlp(writer.close(), {
      openVideos: false,
      h5: { filenameHint: "streamed.slp" },
    });
    const user = back.labeledFrames[0].instances[0];
    expect(user.points[2].visible).toBe(false);
    expect(user.points[2].xy).toEqual([Number.NaN, Number.NaN]);
    const merged = await readSlp(
      await saveSlpMergedFromStores([labels._lazyDataStore!]),
      { openVideos: false, h5: { filenameHint: "merged.slp" } },
    );
    expect(merged.labeledFrames[0].instances[1].points[0].xy).toEqual([
      Number.NaN,
      Number.NaN,
    ]);
  });

  it("in place: a 3.0 file goes to a full save, never patched", async () => {
    await ready;
    const labels = await readSlp(slpPath(META), {
      openVideos: false,
      format3: "edit",
    });
    const update = buildLabelTableUpdate(labels);
    expect(update.sourceFormat?.access).toBe("edit");
    const empty = {
      tracksJson: null,
      suggestionsJson: null,
      metadataJson: null,
      videos: null,
    };
    const verdict = checkInPlaceWritable(
      update,
      {},
      {
        onDisk: empty,
        expected: empty,
      },
    );
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain("3.0");

    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
    const target = path.join(dir, "v3.slp");
    copyFileSync(slpPath(META), target);
    const before = readFileSync(target);
    delete update.sourceFormat; // even a bare update cannot patch a 3.0 file
    const file = new H5File(target, "a");
    try {
      const error = (await caught(() =>
        writeLabelTablesInPlace(file, update),
      )) as Error;
      expect(error.message).toContain("format 3.0 layout");
    } finally {
      file.close();
    }
    expect(readFileSync(target).equals(before)).toBe(true);
  });
});

describe("labels built in memory with 3.0-only content", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const skeleton = new Skeleton({ nodes: ["a", "b"] });
  const video = new Video({ filename: "clip.mp4" });
  const make = (): Labels => {
    const points: Point[] = [
      { xy: [1, 2], visible: true, complete: false },
      { xy: [3, 4], visible: false, complete: false, labeled: false },
    ];
    const inst = new Instance({ points, skeleton, metadata: { who: "me" } });
    const frame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [inst],
      bboxes: [
        new UserBoundingBox({ x1: 0, y1: 0, x2: 1, y2: 1, metadata: { k: 1 } }),
      ],
      metadata: { flag: true },
    });
    return new Labels({ labeledFrames: [frame], videos: [video] });
  };

  it("unlabelled points are refused by default, before anything is written", async () => {
    const labels = make();
    const error = (await caught(() => saveSlpToBytes(labels))) as Error;
    expect(error.message).toContain("1 point(s) are unlabelled");
    expect(error.message).toContain('unlabeledAs: "absent"');
    expect(await caught(() => buildLabelTableUpdate(labels))).toBeInstanceOf(
      Error,
    );
    const writer = await openSlpWriter(labels);
    expect(
      await caught(() => writer.appendFrames(labels.labeledFrames)),
    ).toBeInstanceOf(Error);
    // The writer is still usable: nothing was written.
    writer.appendFrames(labels.labeledFrames, { unlabeledAs: "absent" });
    const back = await readSlp(writer.close(), {
      openVideos: false,
      h5: { filenameHint: "frames.slp" },
    });
    expect(back.labeledFrames[0].instances[0].points[1].xy).toEqual([
      Number.NaN,
      Number.NaN,
    ]);
  });

  it('unlabeledAs: "absent" writes them as hidden with no location, with warnings', async () => {
    const bytes = await saveSlpToBytes(make(), { unlabeledAs: "absent" });
    const back = await readSlp(bytes, {
      openVideos: false,
      h5: { filenameHint: "memory.slp" },
    });
    const inst = back.labeledFrames[0].instances[0];
    expect(inst.points[1].visible).toBe(false);
    expect(inst.points[1].xy).toEqual([Number.NaN, Number.NaN]);
    expect(inst.points[1].labeled).toBe(true);
    expect(inst.points[0].xy).toEqual([1, 2]);
    expect(inst.metadata).toEqual({});
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("1 unlabelled point(s)"))).toBe(
      true,
    );
    const dropped = messages.filter((m) => m.includes("metadata"));
    expect(dropped.length).toBe(1);
    expect(dropped[0]).toContain("instances: who");
    expect(dropped[0]).toContain("frames: flag");
    expect(dropped[0]).toContain("bboxes: k");
  });

  it("hidden points that keep their coordinates need no choice", async () => {
    const points: Point[] = [
      { xy: [1, 2], visible: true, complete: false },
      { xy: [3, 4], visible: false, complete: false },
    ];
    const inst = new Instance({ points, skeleton });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 0, instances: [inst] }),
      ],
      videos: [video],
    });
    const back = await readSlp(await saveSlpToBytes(labels), {
      openVideos: false,
      h5: { filenameHint: "hidden.slp" },
    });
    expect(back.labeledFrames[0].instances[0].points[1].xy).toEqual([3, 4]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("checkPoseTables", () => {
  const frames = {
    video: [0, 0],
    frame_idx: [0, 1],
    instance_id_start: [0, 1],
    instance_id_end: [1, 2],
  };
  const instances = {
    instance_type: [0, 1],
    frame_id: [0, 1],
    point_id_start: [0, 0],
    point_id_end: [2, 2],
    from_predicted: [1, -1],
  };
  const check = (
    f: Record<string, number[]> = frames,
    i: Record<string, number[]> = instances,
    nVideos = 1,
  ) =>
    checkPoseTables({
      frames: f,
      instances: i,
      nPoints: 2,
      nPredPoints: 2,
      nVideos,
      labelsPath: "a.slp",
    });

  it("passes consistent tables, and empty ones", () => {
    check();
    check(
      { video: [], frame_idx: [], instance_id_start: [], instance_id_end: [] },
      { instance_type: [], frame_id: [], point_id_start: [], point_id_end: [] },
    );
  });

  const cases: Array<[string, () => void, string]> = [
    [
      "decreasing ranges",
      () =>
        check({
          ...frames,
          instance_id_start: [1, 0],
          instance_id_end: [2, 1],
        }),
      "/frames instance ranges decrease or overlap",
    ],
    [
      "ranges that stop short",
      () => check({ ...frames, instance_id_end: [1, 1] }),
      "/frames instance ranges end at 1, not at the instance count (2)",
    ],
    [
      "a wrong frame_id",
      () => check(frames, { ...instances, frame_id: [0, 0] }),
      "/instances frame_id disagrees with the /frames ranges",
    ],
    [
      "point ranges past the table",
      () => check(frames, { ...instances, point_id_end: [3, 2] }),
      "/instances point ranges fall outside /points (2 rows)",
    ],
    [
      "a from_predicted that is no row",
      () => check(frames, { ...instances, from_predicted: [5, -1] }),
      "/instances from_predicted is not an instance row",
    ],
    [
      "a video that is not in the file",
      () => check(frames, instances, 0),
      "/frames video is not one of the 0 videos",
    ],
  ];
  for (const [label, run, message] of cases) {
    it(`refuses ${label}`, () => {
      expect(run).toThrow(message);
    });
  }
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

const READ_BACK_PY = `
import json, math, sys
import h5py
import sleap_io as sio
path = sys.argv[1]
labels = sio.load_slp(path)
with h5py.File(path, "r") as f:
    format_id = float(f["metadata"].attrs["format_id"])
def xy(v):
    return [None if math.isnan(c) else c for c in v]
frames = []
for lf in labels.labeled_frames:
    insts = []
    for inst in lf.instances:
        pts = inst.points
        names = pts.dtype.names
        insts.append({
            "xy": [xy(p) for p in pts["xy"].tolist()],
            "visible": [bool(v) for v in pts["visible"]],
            "labeled": [bool(v) for v in pts["labeled"]] if "labeled" in names else None,
            "metadata": dict(getattr(inst, "metadata", {}) or {}),
        })
    frames.append({
        "frame_idx": lf.frame_idx,
        "metadata": dict(getattr(lf, "metadata", {}) or {}),
        "instances": insts,
    })
print(json.dumps({"version": sio.__version__, "format_id": format_id, "frames": frames}))
`;

describe("an edit save reads back in Python sleap-io", () => {
  for (const python of pythons()) {
    it(`with ${python.label}`, async () => {
      const labels = await readSlp(slpPath(META), {
        openVideos: false,
        format3: "edit",
      });
      const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
      const file = path.join(dir, "edited.slp");
      writeFileSync(file, await saveSlpToBytes(labels));
      let out: string;
      try {
        out = execFileSync(
          python.cmd,
          [...python.args, "-c", READ_BACK_PY, file],
          { timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
        ).toString();
      } catch (e) {
        console.log(`skipped: ${python.label} could not run (${e})`);
        return;
      }
      const result = JSON.parse(out.trim().split("\n").pop()!);
      console.log(
        `read back with sleap-io ${result.version} (${python.label})`,
      );
      expect(result.format_id).toBeLessThan(3);
      expect(result.frames.length).toBe(4);
      const [user, pred] = result.frames[0].instances;
      expect(user.xy[2]).toEqual([null, null]);
      expect(user.visible).toEqual([true, true, false]);
      expect(user.xy[0]).toEqual([10, 20]);
      expect(pred.xy[0]).toEqual([null, null]);
      expect(pred.visible[0]).toBe(false);
      if (user.labeled !== null) {
        // sleap-io 0.10 reads a 2.x file as fully labelled.
        expect(user.labeled).toEqual([true, true, true]);
        expect(pred.labeled).toEqual([true, true, true]);
      }
      for (const frame of result.frames) {
        expect(frame.metadata).toEqual({});
        for (const inst of frame.instances) expect(inst.metadata).toEqual({});
      }
    });
  }
});
