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
import {
  SlpFormatError,
  SlpTableError,
} from "../src/codecs/slp/format-check.js";
import {
  type Format3Access,
  type Format3Option,
  type Format3Summary,
  SlpFormat3ChoiceError,
  SlpViewOnlyError,
} from "../src/codecs/slp/format3.js";
import {
  checkPoseTables,
  hasSkippedInstanceRows,
  poseTableFromColumns,
  skipsInstanceRow,
} from "../src/codecs/slp/columnar.js";
import {
  buildLabelTableRows,
  buildLabelTableUpdate,
  checkInPlaceWritable,
  openSlpWriter,
  saveSlpMergedFromStores,
  saveSlpMergedToSink,
  saveSlpStructureToBytes,
  saveSlpToBytes,
  checkSlpSavable,
  writeLabelTablesInPlace,
  writeSlp,
} from "../src/codecs/slp/write.js";
import { loadSlp, saveSlp, saveSlpSet } from "../src/index.js";
import { loadSlpMetadata, validateSlpBuffer } from "../src/lite.js";
import {
  Instance,
  PredictedInstance,
  clonePoint,
  type Point,
} from "../src/model/instance.js";
import { PredictedSegmentationMask } from "../src/model/mask.js";
import { LabelImage } from "../src/model/label-image.js";
import {
  copySourceMark,
  setSourceAccess,
  sourceMarkOf,
} from "../src/model/source-mark.js";
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
  format3?: Format3Option,
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

type Reader = (name: string, format3?: Format3Option) => Promise<Labels>;

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
  unreadTables: [],
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
  // Members of metadata/ the readers ignore: a save does not write them.
  unreadTables: [
    "frames/metadata/no_values",
    "instances/metadata/loose",
    "instances/metadata/two_d",
  ],
  lossless: false,
};

describe("what a 3.0 file holds that this version does not read", () => {
  // format3_events.slp: frame-spanning events and their types, and a
  // top-level dataset of a newer writer.
  const EVENTS = "format3_events.slp";
  const UNREAD = ["event_types", "events", "future_table"];

  for (const [label, load] of READERS) {
    it(`is in the summary of ${label}`, async () => {
      const error = (await caught(() =>
        load(EVENTS, "ask"),
      )) as SlpFormat3ChoiceError;
      expect(error).toBeInstanceOf(SlpFormat3ChoiceError);
      expect(error.summary.unreadTables).toEqual(UNREAD);
      expect(error.summary.lossless).toBe(false);
      expect(error.message).toContain(
        "what this version does not read (event_types, events, future_table)",
      );
    });
  }

  it("is in the lite reader's summary", async () => {
    const meta = await loadSlpMetadata(slpBytes(EVENTS));
    expect(meta.format3?.unreadTables).toEqual(UNREAD);
    expect(meta.format3?.lossless).toBe(false);
  });

  it("is dropped by an edit save, which keeps the poses", async () => {
    const labels = await readSlp(slpPath(EVENTS), {
      openVideos: false,
      format3: "edit",
    });
    expect(labels.sourceFormat?.summary.unreadTables).toEqual(UNREAD);
    const bytes = await saveSlpToBytes(labels);
    const back = await readSlp(bytes, { openVideos: false });
    expect(back.labeledFrames.length).toBe(4);
    const meta = await loadSlpMetadata(bytes);
    expect(meta.counts.instances).toBe(5);
    await ready;
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-unread-"));
    const file = path.join(dir, "saved.slp");
    writeFileSync(file, bytes);
    const h5 = new H5File(file, "r");
    try {
      const keys = h5.keys() as string[];
      for (const name of UNREAD) expect(keys).not.toContain(name);
    } finally {
      h5.close();
    }
  });

  it("files without such members have none", async () => {
    for (const name of [POSE, "format3_embedded.pkg.slp"]) {
      const labels = await readSlp(slpPath(name), {
        openVideos: false,
        format3: "view",
      });
      expect([name, labels.sourceFormat?.summary.unreadTables]).toEqual([
        name,
        [],
      ]);
    }
  });
});

describe("a 3.0 file opened to ask throws the choice error", () => {
  for (const [label, load] of READERS) {
    it(`${label} throws SlpFormat3ChoiceError for a lossless file`, async () => {
      const error = (await caught(() =>
        load(POSE, "ask"),
      )) as SlpFormat3ChoiceError;
      expect(error).toBeInstanceOf(SlpFormat3ChoiceError);
      expect(error).toBeInstanceOf(SlpFormatError);
      expect(error.formatId).toBe(3);
      expect(error.summary).toEqual(POSE_SUMMARY);
      expect(error.message).toContain("SLP format 3.0");
      expect(error.message).toContain("would drop nothing");
      expect(error.message).toContain('format3: "keep"');
      expect(error.message).toContain('format3: "view"');
      expect(error.message).toContain('format3: "edit"');
    });

    it(`${label} names what an edit would drop`, async () => {
      const error = (await caught(() =>
        load(META, "ask"),
      )) as SlpFormat3ChoiceError;
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

    it(`${label} loads a 3.0 file without the option to keep format 3.0`, async () => {
      for (const labels of [await load(POSE), await load(META, "keep")]) {
        expect(labels.sourceFormat?.access).toBe("keep");
        expect(labels.sourceFormat?.formatId).toBe(3);
        expect(labels.labeledFrames.length).toBe(4);
        expect(sourceMarkOf(labels.labeledFrames[0])?.access).toBe("keep");
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
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain(
      '"keep", "view", "edit" or "ask"',
    );
    // loadSlp refuses it before reading anything (even a missing file).
    const early = await caught(() =>
      loadSlp("/no/such/file.slp", { format3: "write" as Format3Access }),
    );
    expect(early).toBeInstanceOf(TypeError);
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
      // A file error, which loadSlp does not retry on the main thread.
      expect(error).toBeInstanceOf(SlpTableError);
      expect(error).toBeInstanceOf(SlpFormatError);
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

describe("3.0 instance rows of another type are skipped, as in Python", () => {
  /**
   * format3_metadata.slp with instance row 2 (the prediction the user instance
   * of frame 5 was corrected from) given instance type 2, and the first box
   * linked to row 3 (that user instance). Links are rows, so they must still
   * resolve past the skipped row.
   */
  const skippedFixture = async (): Promise<string> => {
    await ready;
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
    const file = path.join(dir, "format3_type2.slp");
    copyFileSync(slpPath(META), file);
    const h5 = new H5File(file, "a");
    try {
      const types = h5.get("instances/instance_type") as any;
      types.write_slice([[2, 3]], new Uint8Array([2]));
      const links = h5.get("bboxes/instance") as any;
      links.write_slice([[0, 1]], new Int32Array([3]));
    } finally {
      h5.close();
    }
    return file;
  };

  for (const [label, load] of READERS) {
    it(label, async () => {
      const labels = await load(await skippedFixture(), "edit");
      const [f0, f5, f2] = labels.labeledFrames;
      expect(labels.labeledFrames.map((f) => f.instances.length)).toEqual([
        2, 1, 1, 0,
      ]);
      const corrected = f5.instances[0];
      expect(corrected).not.toBeInstanceOf(PredictedInstance);
      expect(corrected.points[0].xy).toEqual([13, 23]);
      // Its source was the skipped row.
      expect(corrected.fromPredicted).toBeNull();
      // Rows after the skipped one keep their metadata and links.
      expect(f2.instances[0]).toBeInstanceOf(PredictedInstance);
      expect(f0.instances[0].metadata.annotator).toBe("someone");
      expect(f0.bboxes[0].instance).toBe(corrected);
    });
  }

  it("only 3.0 tables skip them; 2.x rows of any type are read", () => {
    const columnar = poseTableFromColumns(
      "instances",
      {
        instance_type: [0, 2, 1],
        frame_id: [0, 0, 0],
        skeleton: [0, 0, 0],
        point_id_start: [0, 0, 0],
        point_id_end: [0, 0, 0],
      },
      "a.slp",
    );
    expect([0, 1, 2].map((row) => skipsInstanceRow(columnar, row))).toEqual([
      false,
      true,
      false,
    ]);
    expect(hasSkippedInstanceRows(columnar)).toBe(true);
    const compound = { instance_type: [0, 2, 1] };
    expect(skipsInstanceRow(compound, 1)).toBe(false);
    expect(hasSkippedInstanceRows(compound)).toBe(false);
  });
});

describe("the open-time choice travels with the records", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const load = (format3: Format3Access, name = META) =>
    readSlp(slpPath(name), { openVideos: false, format3 });
  /** Labels built in memory from the given frames (no source format). */
  const fresh = (from: Labels, frames = from.labeledFrames) =>
    new Labels({
      labeledFrames: frames,
      videos: from.videos,
      skeletons: from.skeletons,
      tracks: from.tracks,
    });

  const viewMoves: Array<[string, () => Promise<unknown>]> = [
    [
      "merged into other labels",
      async () => {
        const target = new Labels();
        await target.merge(await load("view"));
        expect(target.sourceFormat).toBeNull();
        return saveSlpToBytes(target, { unlabeledAs: "absent" });
      },
    ],
    [
      "merged into a 2.x project",
      async () => {
        const target = await readSlp(slpPath(V2), { openVideos: false });
        await target.merge(await load("view"));
        return saveSlpToBytes(target, { unlabeledAs: "absent" });
      },
    ],
    [
      "handed to new Labels",
      async () => saveSlpToBytes(fresh(await load("view"))),
    ],
    [
      "materialized from a lazy load and handed to new Labels",
      async () => {
        const lazy = await readSlpLazy(slpPath(META), {
          openVideos: false,
          format3: "view",
        });
        const frames = Array.from(
          { length: lazy.length },
          (_, i) => lazy.frameAt(i) as LabeledFrame,
        );
        return saveSlpToBytes(fresh(lazy, frames));
      },
    ],
    [
      "read by the streaming reader and handed to new Labels",
      async () => saveSlpToBytes(fresh(await readStreaming(META, "view"))),
    ],
    [
      "appended to a streaming writer with a plain header",
      async () => {
        const view = await load("view");
        const writer = await openSlpWriter({
          videos: view.videos,
          skeletons: view.skeletons,
          tracks: view.tracks,
        });
        try {
          writer.appendFrames(view.labeledFrames);
        } finally {
          writer.dispose();
        }
      },
    ],
    [
      "copied into an in-place update",
      async () => buildLabelTableUpdate(fresh(await load("view"))),
    ],
    [
      "as a single box padded into labels built in memory",
      async () => {
        const view = await load("view");
        const video = view.videos[0];
        const frame = new LabeledFrame({
          video,
          frameIdx: 9,
          bboxes: [view.labeledFrames[0].bboxes[1].pad(1)],
        });
        return saveSlpToBytes(
          new Labels({ labeledFrames: [frame], videos: [video] }),
        );
      },
    ],
  ];
  for (const [label, move] of viewMoves) {
    it(`view-only content is refused when ${label}`, async () => {
      const error = (await caught(move)) as SlpViewOnlyError;
      expect(error).toBeInstanceOf(SlpViewOnlyError);
      expect(error.sourceFormat.access).toBe("view");
    });
  }

  it("edit content merged elsewhere is saved as chosen", async () => {
    const target = await readSlp(slpPath(V2), { openVideos: false });
    await target.merge(await load("edit"));
    expect(target.sourceFormat).toBeNull();
    // The 2.x layout, asked for ("auto" would keep the frames' metadata in
    // format 3.0, see slp-version.test.ts).
    const back = await readSlp(
      await saveSlpToBytes(target, { slpVersion: "v2" }),
      {
        openVideos: false,
        h5: { filenameHint: "merged.slp" },
      },
    );
    const user = back.labeledFrames[0].instances.find(
      (i) => !(i instanceof PredictedInstance) && i.points[2].xy[0] !== 50,
    );
    expect(user?.points[2].xy).toEqual([Number.NaN, Number.NaN]);
    // The merged instances and boxes are the caller's choice: no word about
    // them. The project's own frames took metadata keys, so those keys are
    // now the frames' own and their drop is warned about.
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("unlabelled"))).toBe(false);
    expect(messages).toEqual([
      expect.stringContaining("(frames: flagged, note)"),
    ]);
  });

  it("edit frames appended to a writer with a plain header are written absent", async () => {
    const edit = await load("edit");
    const writer = await openSlpWriter({
      videos: edit.videos,
      skeletons: edit.skeletons,
      tracks: edit.tracks,
    });
    writer.appendFrames(edit.labeledFrames);
    const back = await readSlp(writer.close(), {
      openVideos: false,
      h5: { filenameHint: "appended.slp" },
    });
    expect(back.labeledFrames[0].instances[0].points[2].xy).toEqual([
      Number.NaN,
      Number.NaN,
    ]);
  });

  it("records of other origins keep the in-memory rule", async () => {
    const labels = fresh(await load("edit"));
    // An instance built in memory with an unlabelled point.
    const inst = Instance.empty({ skeleton: labels.skeletons[0] });
    inst.points[0].xy = [1, 2];
    inst.points[0].visible = true;
    inst.points[1].labeled = false;
    inst.metadata.own = "yes";
    labels.labeledFrames[1].instances.push(inst);
    // The 2.x layout, asked for: the "auto" rule would write format 3.0 for
    // the in-memory content (see slp-version.test.ts).
    const error = (await caught(() =>
      saveSlpToBytes(labels, { slpVersion: "v2" }),
    )) as Error;
    // Only the in-memory point counts; the edit-loaded one is the caller's.
    expect(error.message).toContain("1 point(s) are unlabelled");
    await saveSlpToBytes(labels, { unlabeledAs: "absent", slpVersion: "v2" });
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("1 unlabelled point(s)"))).toBe(
      true,
    );
    // Only the in-memory instance's metadata is named.
    const dropped = messages.filter((m) => m.includes("metadata"));
    expect(dropped).toEqual([expect.stringContaining("(instances: own)")]);
  });

  it('an explicit unlabeledAs: "error" refuses edit content too', async () => {
    const edit = await load("edit");
    const refused = (await caught(() =>
      saveSlpToBytes(edit, { unlabeledAs: "error" }),
    )) as Error;
    expect(refused.message).toContain("2 point(s) are unlabelled");
  });

  it("marks survive copy, extract and a frame merge", async () => {
    const view = await load("view");
    for (const copy of [view.copy(), view.extract([0])]) {
      const plain = fresh(copy);
      expect(await caught(() => saveSlpToBytes(plain))).toBeInstanceOf(
        SlpViewOnlyError,
      );
    }
    // A frame of other labels that takes in a view-only frame.
    const own = await readSlp(slpPath(V2), { openVideos: false });
    const ownFrame = own.labeledFrames[0];
    ownFrame.merge(view.labeledFrames[0]);
    ownFrame.instances = ownFrame.instances.slice(0, 0);
    ownFrame.bboxes = [];
    own.labeledFrames = [ownFrame];
    expect(await caught(() => saveSlpToBytes(own))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("labels saved over their source can drop the source format", async () => {
    const labels = await load("edit");
    const update = buildLabelTableUpdate(labels);
    const empty = {
      tracksJson: null,
      suggestionsJson: null,
      metadataJson: null,
      videos: null,
    };
    const sidecars = { onDisk: empty, expected: empty };
    expect(checkInPlaceWritable(update, {}, sidecars).ok).toBe(false);
    labels.sourceFormat = null; // saved over the source: now a 2.x file
    const again = buildLabelTableUpdate(labels);
    expect(checkInPlaceWritable(again, {}, sidecars).ok).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("marks follow content, and can be carried or switched", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const own = () => readSlp(slpPath(V2), { openVideos: false });
  const load = (format3: Format3Access, name = POSE) =>
    readSlp(slpPath(name), { openVideos: false, format3 });

  it("a keep_original merge of a view-only twin leaves your frames yours", async () => {
    const labels = await own();
    await labels.merge(await load("view"), { frame: "keep_original" });
    expect(labels.labeledFrames.length).toBe(4);
    for (const frame of labels.labeledFrames) {
      expect(sourceMarkOf(frame)).toBeUndefined();
      for (const inst of frame.instances) {
        expect(sourceMarkOf(inst)).toBeUndefined();
      }
    }
    await saveSlpToBytes(labels);
    buildLabelTableRows(labels);
  });

  it("a frame that takes a metadata key from a view-only frame is view-only", async () => {
    const labels = await own();
    const view = await load("view", META);
    labels.labeledFrames[0].merge(view.labeledFrames[0], {
      frame: "keep_original",
    });
    expect(sourceMarkOf(labels.labeledFrames[0])?.access).toBe("view");
    expect(sourceMarkOf(labels.labeledFrames[1])).toBeUndefined();
  });

  it("an instance that takes a track from a view-only instance is view-only", async () => {
    const labels = await own();
    const view = await load("view");
    const frame = labels.labeledFrames[0];
    frame.merge(view.labeledFrames[0], { frame: "update_tracks" });
    expect(sourceMarkOf(frame)).toBeUndefined();
    expect(sourceMarkOf(frame.instances[0])?.access).toBe("view");
    expect(await caught(() => saveSlpToBytes(labels))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("taking from an edit-loaded frame keeps the warning for your own metadata", async () => {
    const labels = await own();
    const frame = labels.labeledFrames[0];
    frame.metadata = { mine: 1 };
    frame.merge((await load("edit", META)).labeledFrames[0], {
      frame: "keep_original",
    });
    expect(sourceMarkOf(frame)).toBeUndefined();
    await saveSlpToBytes(labels, { slpVersion: "v2" });
    const dropped = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("metadata"));
    expect(dropped.length).toBe(1);
    expect(dropped[0]).toContain("mine");
  });

  it("box, mask, ROI and label image conversions keep the mark", async () => {
    const view = await load("view", META);
    const box = view.labeledFrames[0].bboxes[1];
    const roi = box.toRoi();
    const mask = box.toMask(64, 64);
    const derived: Array<[string, object]> = [
      ["toRoi", roi],
      ["toMask", mask],
      ["mask.toBbox", mask.toBbox()],
      ["mask.toPolygon", mask.toPolygon()],
      ["mask.resampled", mask.resampled(32, 32)],
      ["roi.toMask", roi.toMask(64, 64)],
      ...roi.explode().map((r) => ["roi.explode", r] as [string, object]),
    ];
    if (mask instanceof PredictedSegmentationMask) {
      derived.push(["mask.toUser", mask.toUser()]);
    }
    const image = LabelImage.fromMasks([box.toMask(64, 64)]);
    // A composition takes the strictest mark of its masks.
    expect(sourceMarkOf(image)?.access).toBe("view");
    derived.push(
      ["labelImage.resampled", image.resampled(32, 32)],
      ...image.toMasks().map((m) => ["toMasks", m] as [string, object]),
      ...image.toBboxes().map((b) => ["toBboxes", b] as [string, object]),
    );
    for (const [label, record] of derived) {
      expect([label, sourceMarkOf(record)?.access]).toEqual([label, "view"]);
    }
    // And the writers see it: a converted ROI saved as one's own is refused.
    const labels = await own();
    labels.labeledFrames[0].rois.push(roi as never);
    expect(await caught(() => saveSlpToBytes(labels))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("buildLabelTableRows refuses view-only labels and records", async () => {
    const view = await load("view");
    expect(await caught(() => buildLabelTableRows(view))).toBeInstanceOf(
      SlpViewOnlyError,
    );
    const plain = new Labels({
      labeledFrames: view.labeledFrames,
      videos: view.videos,
      skeletons: view.skeletons,
      tracks: view.tracks,
    });
    expect(await caught(() => buildLabelTableRows(plain))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("copySourceMark carries the choice to records an application rebuilds", async () => {
    const view = await load("view");
    const original = view.labeledFrames[0].instances[0];
    const rebuilt = new Instance({
      points: original.points.map((p) => clonePoint(p)),
      skeleton: original.skeleton,
    });
    expect(sourceMarkOf(rebuilt)).toBeUndefined();
    copySourceMark(original, rebuilt);
    const labels = await own();
    labels.labeledFrames[0].instances.push(rebuilt);
    expect(await caught(() => saveSlpToBytes(labels))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("the source format is frozen; setSourceAccess switches the choice", async () => {
    const view = await load("view", META);
    expect(Object.isFrozen(view.sourceFormat)).toBe(true);
    expect(Object.isFrozen(view.sourceFormat?.summary)).toBe(true);
    expect(() => {
      (view.sourceFormat as { access: string }).access = "edit";
    }).toThrow();
    const elsewhere = view.copy();
    setSourceAccess(view, "edit");
    expect(view.sourceFormat?.access).toBe("edit");
    expect(sourceMarkOf(view.labeledFrames[0].bboxes[0])?.access).toBe("edit");
    await expectEditSave(await saveSlpToBytes(view));
    // A copy taken before keeps its own choice.
    expect(await caught(() => saveSlpToBytes(elsewhere))).toBeInstanceOf(
      SlpViewOnlyError,
    );
    expect(() => setSourceAccess(view, "write" as never)).toThrow(TypeError);
    // Labels holding no record of a 3.0 file: nothing to switch.
    expect(setSourceAccess(new Labels(), "edit")).toBe(0);
  });

  it("setSourceAccess switches view-only content merged into your own labels", async () => {
    const labels = await own();
    const view = await load("view", META);
    await labels.merge(view);
    labels.addStaticRoi(view.labeledFrames[0].bboxes[0].toRoi());
    expect(labels.sourceFormat).toBeNull();
    expect(await caught(() => saveSlpToBytes(labels))).toBeInstanceOf(
      SlpViewOnlyError,
    );
    expect(setSourceAccess(labels, "edit")).toBeGreaterThan(0);
    expect(labels.sourceFormat).toBeNull();
    await saveSlpToBytes(labels);
    // The file's own labels keep their choice.
    expect(view.sourceFormat?.access).toBe("view");
    expect(sourceMarkOf(view.labeledFrames[0])?.access).toBe("view");
    // And back.
    setSourceAccess(labels, "view");
    expect(await caught(() => saveSlpToBytes(labels))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("a static ROI made from view-only content is refused by the eager writers", async () => {
    const view = await load("view", META);
    const labels = await own();
    labels.addStaticRoi(view.labeledFrames[0].bboxes[0].toRoi());
    for (const write of [
      () => saveSlpToBytes(labels),
      () => saveSlpStructureToBytes(labels),
      () => buildLabelTableRows(labels),
      () => buildLabelTableUpdate(labels),
      () => checkSlpSavable(labels),
    ]) {
      expect(await caught(write)).toBeInstanceOf(SlpViewOnlyError);
    }
  });

  it("a label image composed of view-only masks is refused", async () => {
    const view = await load("view", META);
    const box = view.labeledFrames[0].bboxes[0];
    const edit = await load("edit", META);
    const editMask = edit.labeledFrames[0].bboxes[0].toMask(64, 64);
    const image = LabelImage.fromMasks([editMask, box.toMask(64, 64)]);
    expect(sourceMarkOf(image)?.access).toBe("view");
    expect(sourceMarkOf(LabelImage.fromMasks([editMask]))?.access).toBe("edit");
    const labels = await own();
    labels.labeledFrames[0].labelImages.push(image);
    expect(await caught(() => saveSlpToBytes(labels))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("update_tracks marks an instance only when its track or score changes", async () => {
    const view = await load("view");
    const labels = await own();
    const frame = labels.labeledFrames[0];
    const theirs = view.labeledFrames[0];
    // Every instance on both sides holds the same track and score, so the
    // matches (spatial, several per instance here) take nothing.
    const track = labels.tracks[0];
    for (const inst of [...frame.instances, ...theirs.instances]) {
      inst.track = track;
      inst.trackingScore = 0.25;
    }
    frame.merge(theirs, { frame: "update_tracks" });
    for (const inst of frame.instances) {
      expect(sourceMarkOf(inst)).toBeUndefined();
    }
    // A changed score is taken, and with it the view-only choice.
    theirs.instances[0].trackingScore = 0.5;
    frame.merge(theirs, { frame: "update_tracks" });
    expect(
      frame.instances.some((inst) => sourceMarkOf(inst)?.access === "view"),
    ).toBe(true);
  });

  it("setSourceAccess switches lazy labels, their store and materialized frames", async () => {
    const lazy = await readSlpLazy(slpPath(META), {
      openVideos: false,
      format3: "view",
    });
    const first = lazy.frameAt(0) as LabeledFrame;
    expect(sourceMarkOf(first)?.access).toBe("view");
    setSourceAccess(lazy, "edit");
    expect(sourceMarkOf(first)?.access).toBe("edit");
    expect(lazy._lazyDataStore?.sourceFormat?.access).toBe("edit");
    await expectEditSave(await saveSlpToBytes(lazy));
  });

  it("a box of your own added to a lazy frame stays yours", async () => {
    const lazy = await readSlpLazy(slpPath(META), {
      openVideos: false,
      format3: "edit",
    });
    const frame = lazy.frameAt(0) as LabeledFrame;
    const mine = new UserBoundingBox({
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      metadata: { mine: 1 },
    });
    frame.bboxes.push(mine);
    lazy.releaseFrame(0);
    const again = lazy.frameAt(0) as LabeledFrame;
    expect(again.bboxes).toContain(mine);
    expect(sourceMarkOf(mine)).toBeUndefined();
  });

  it("a lazy store holding a view-only annotation is refused", async () => {
    const view = await load("view", META);
    const lazy = await readSlpLazy(slpPath(META), {
      openVideos: false,
      format3: "edit",
    });
    const centroid = view.labeledFrames[0].bboxes[0].toCentroid();
    lazy._lazyDataStore?._centroidByFrame.set("0:0", [centroid]);
    expect(await caught(() => saveSlpToBytes(lazy))).toBeInstanceOf(
      SlpViewOnlyError,
    );
  });

  it("every reader refuses a wrong format3 value before reading", async () => {
    const bad = { openVideos: false, format3: "bogus" as Format3Access };
    expect(await caught(() => readSlp(slpPath(V2), bad))).toBeInstanceOf(
      TypeError,
    );
    expect(await caught(() => readSlpLazy(slpPath(V2), bad))).toBeInstanceOf(
      TypeError,
    );
    expect(
      await caught(() => readStreaming(V2, "bogus" as Format3Access)),
    ).toBeInstanceOf(TypeError);
  });

  it("the committed format 3.0 fixtures name no machine path", () => {
    for (const name of [
      "format3_pose.slp",
      "format3_pose.v2.slp",
      "format3_unlabeled.slp",
      "format3_rois_stub.slp",
      "format3_metadata.slp",
      "format3_defaults.slp",
      "format3_bad_frame_id.slp",
      "format3_embedded.pkg.slp",
      "format3_tables.slp",
      "format3_tables.v2.slp",
      "format3_label_images_blob.slp",
      "format3_label_images_blob.v2.slp",
      "format3_tables_unknown.slp",
      "format3_tables_defaults.slp",
    ]) {
      const text = Buffer.from(slpBytes(name)).toString("latin1");
      for (const needle of ["/scr/", "/home/", "/Users/", "/tmp/", ":\\\\"]) {
        expect([name, text.includes(needle)]).toEqual([name, false]);
      }
    }
  });
});

describe("raw-table writers skip the instance rows the readers skip", () => {
  /** format3_metadata.slp with row 2 of another type; box 0 links row 3. */
  const skippedFixture = async (): Promise<string> => {
    await ready;
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
    const file = path.join(dir, "format3_type2.slp");
    copyFileSync(slpPath(META), file);
    const h5 = new H5File(file, "a");
    try {
      (h5.get("instances/instance_type") as any).write_slice(
        [[2, 3]],
        new Uint8Array([2]),
      );
      (h5.get("bboxes/instance") as any).write_slice(
        [[0, 1]],
        new Int32Array([3]),
      );
    } finally {
      h5.close();
    }
    return file;
  };
  const saves: Array<[string, (file: string) => Promise<Uint8Array>]> = [
    [
      "the lazy fast path",
      async (file) =>
        saveSlpToBytes(
          await readSlpLazy(file, { openVideos: false, format3: "edit" }),
        ),
    ],
    [
      "SlpStreamWriter.appendStore",
      async (file) => {
        const labels = await readSlpLazy(file, {
          openVideos: false,
          format3: "edit",
        });
        const writer = await openSlpWriter(labels);
        writer.appendStore(labels._lazyDataStore!);
        return writer.close();
      },
    ],
    [
      "saveSlpMergedFromStores",
      async (file) => {
        const labels = await readSlpLazy(file, {
          openVideos: false,
          format3: "edit",
        });
        return saveSlpMergedFromStores([labels._lazyDataStore!]);
      },
    ],
    [
      "an eager save",
      async (file) =>
        saveSlpToBytes(
          await readSlp(file, { openVideos: false, format3: "edit" }),
        ),
    ],
  ];
  for (const [label, save] of saves) {
    it(label, async () => {
      const back = await readSlp(await save(await skippedFixture()), {
        openVideos: false,
        h5: { filenameHint: "skipped.slp" },
      });
      expect(back.labeledFrames.map((f) => f.instances.length)).toEqual([
        2, 1, 1, 0,
      ]);
      const corrected = back.labeledFrames[1].instances[0];
      expect(corrected).not.toBeInstanceOf(PredictedInstance);
      expect(corrected.points[0].xy).toEqual([13, 23]);
      expect(back.labeledFrames[0].bboxes[0].instance).toBe(corrected);
    });
  }
});

describe("columns and tables a newer writer may add", () => {
  it("a column of rank 2 is listed as unknown, not refused", async () => {
    await ready;
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
    const file = path.join(dir, "format3_cov.slp");
    copyFileSync(slpPath(POSE), file);
    const h5 = new H5File(file, "a");
    try {
      (h5.get("points") as any).create_dataset({
        name: "cov",
        data: new Float64Array(12),
        shape: [6, 2],
        dtype: "<d",
      });
    } finally {
      h5.close();
    }
    for (const [label, read] of READERS) {
      const error = (await caught(() =>
        read(file, "ask"),
      )) as SlpFormat3ChoiceError;
      expect([label, error.summary?.unknownColumns]).toEqual([
        label,
        ["points/cov"],
      ]);
      const labels = await read(file, "edit");
      expect(labels.labeledFrames.length).toBe(4);
    }
    const lite = await loadSlpMetadata(new Uint8Array(readFileSync(file)));
    expect(lite.format3?.unknownColumns).toEqual(["points/cov"]);
  });

  it("validateSlpBuffer accepts a 3.0 file with every table", () => {
    expect(validateSlpBuffer(slpBytes("format3_tables.slp"))).toBe(true);
    expect(validateSlpBuffer(slpBytes(POSE))).toBe(true);
  });

  it("the streaming reader counts unlabelled predictions it does not read", async () => {
    const { file, close } = await streamingFile(META);
    try {
      const error = (await caught(() =>
        readFromStreamingFile(
          file,
          `https://example.com/${META}`,
          undefined,
          false,
          undefined,
          false,
          false,
          false,
          true, // userInstancesOnly: /pred_points is not read
          false,
          "ask",
        ),
      )) as SlpFormat3ChoiceError;
      expect(error.summary).toEqual(META_SUMMARY);
    } finally {
      close();
    }
  });
});

describe("a 3.0 package whose embedded group number is not its index", () => {
  const EMBEDDED = "format3_embedded.pkg.slp";

  it("reads the frame onto the embedded video and its image", async () => {
    const labels = await readSlp(slpPath(EMBEDDED), {
      openVideos: true,
      format3: "edit",
    });
    try {
      expect(labels.videos.length).toBe(1);
      const video = labels.videos[0];
      expect(video.hasEmbeddedImages).toBe(true);
      expect(video.backendMetadata.dataset ?? video.backend?.dataset).toBe(
        "video2/video",
      );
      expect(labels.labeledFrames.length).toBe(1);
      expect(labels.labeledFrames[0].video).toBe(video);
      expect(labels.labeledFrames[0].instances.length).toBe(2);
      const image = await video.getFrame(0);
      expect(image).toBeTruthy();
    } finally {
      for (const video of labels.videos) video.close();
    }
  });

  for (const [label, load] of READERS) {
    it(`${label} puts the frame on video 0`, async () => {
      const labels = await load(EMBEDDED, "edit");
      expect(labels.labeledFrames.length).toBe(1);
      expect(labels.videos.indexOf(labels.labeledFrames[0].video)).toBe(0);
    });
  }

  it("an edit save keeps the frame, its poses and its embedded image", async () => {
    const labels = await readSlp(slpPath(EMBEDDED), {
      openVideos: true,
      format3: "edit",
    });
    const before = labels.labeledFrames[0].instances.map((i) =>
      i.points.map((p) => p.xy),
    );
    const bytes = await saveSlpToBytes(labels);
    for (const video of labels.videos) video.close();
    expect(await formatIdOf(bytes)).toBeLessThan(3);
    // From a file: the embedded backend reopens the package by path.
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
    const saved = path.join(dir, "saved.pkg.slp");
    writeFileSync(saved, bytes);
    const back = await readSlp(saved, { openVideos: true });
    try {
      expect(back.labeledFrames.length).toBe(1);
      expect(back.labeledFrames[0].video).toBe(back.videos[0]);
      expect(back.videos[0].hasEmbeddedImages).toBe(true);
      expect(
        back.labeledFrames[0].instances.map((i) => i.points.map((p) => p.xy)),
      ).toEqual(before);
      expect(await back.videos[0].getFrame(0)).toBeTruthy();
    } finally {
      for (const video of back.videos) video.close();
    }
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

  it('slpVersion: "v2" refuses unlabelled points, before anything is written', async () => {
    const labels = make();
    const error = (await caught(() =>
      saveSlpToBytes(labels, { slpVersion: "v2" }),
    )) as Error;
    expect(error.message).toContain("1 point(s) are unlabelled");
    expect(error.message).toContain('unlabeledAs: "absent"');
    expect(
      await caught(() => buildLabelTableUpdate(labels, { slpVersion: "v2" })),
    ).toBeInstanceOf(Error);
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
    const bytes = await saveSlpToBytes(make(), {
      unlabeledAs: "absent",
      slpVersion: "v2",
    });
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

  it('saveSlpSet with slpVersion: "v2" refuses unlabelled points before writing any file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
    const set = new LabelsSet();
    set.set(
      path.join(dir, "first.slp"),
      await readSlp(slpPath(V2), { openVideos: false }),
    );
    set.set(path.join(dir, "second.slp"), make());
    const error = (await caught(() =>
      saveSlpSet(set, { slpVersion: "v2" }),
    )) as Error;
    expect(error.message).toContain("1 point(s) are unlabelled");
    expect(existsSync(path.join(dir, "first.slp"))).toBe(false);
    expect(existsSync(path.join(dir, "second.slp"))).toBe(false);
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

/**
 * Set `SLEAP_IO_SKIP_PYTHON_TESTS=1` to skip the Python read-backs. Otherwise
 * they run, and a Python that cannot run fails the test.
 */
const SKIP_PYTHON = process.env.SLEAP_IO_SKIP_PYTHON_TESTS === "1";

const READ_BACK_PY = `
import json, math, sys
import h5py
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
def xy(v):
    return [None if math.isnan(c) else c for c in v]
frames = []
for lf in labels.labeled_frames:
    insts = []
    for inst in lf.instances:
        pts = inst.points
        names = pts.dtype.names
        insts.append({
            "predicted": type(inst).__name__ == "PredictedInstance",
            "track": inst.track.name if inst.track else None,
            "tracking_score": num(inst.tracking_score),
            "from_predicted": lf.instances.index(inst.from_predicted)
                if inst.from_predicted is not None else None,
            "xy": [xy(p) for p in pts["xy"].tolist()],
            "visible": [bool(v) for v in pts["visible"]],
            "labeled": [bool(v) for v in pts["labeled"]] if "labeled" in names else None,
            "metadata": dict(getattr(inst, "metadata", {}) or {}),
        })
    frames.append({
        "video": labels.videos.index(lf.video),
        "frame_idx": lf.frame_idx,
        "negative": bool(getattr(lf, "is_negative", False)),
        "bboxes": len(getattr(lf, "bboxes", [])),
        "metadata": dict(getattr(lf, "metadata", {}) or {}),
        "instances": insts,
    })
print(json.dumps({
    "version": sio.__version__,
    "format_id": format_id,
    "videos": [v.filename for v in labels.videos],
    "tracks": [t.name for t in labels.tracks],
    "frames": frames,
}))
`;

/** The edit saves of format3_metadata.slp that Python must read back. */
const EDIT_SAVES: Array<[string, () => Promise<Uint8Array>]> = [
  [
    "an eager save",
    async () =>
      saveSlpToBytes(
        await readSlp(slpPath(META), { openVideos: false, format3: "edit" }),
      ),
  ],
  [
    "a lazy save",
    async () =>
      saveSlpToBytes(
        await readSlpLazy(slpPath(META), {
          openVideos: false,
          format3: "edit",
        }),
      ),
  ],
  [
    "a merged-store save",
    async () => {
      const labels = await readSlpLazy(slpPath(META), {
        openVideos: false,
        format3: "edit",
      });
      return saveSlpMergedFromStores([labels._lazyDataStore!]);
    },
  ],
];

describe("an edit save reads back in Python sleap-io", () => {
  for (const python of pythons()) {
    for (const [what, save] of EDIT_SAVES) {
      it.skipIf(SKIP_PYTHON)(`${what}, with ${python.label}`, async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "sleap-io-js-format3-"));
        const file = path.join(dir, "edited.slp");
        writeFileSync(file, await save());
        // Throws (fails the test) if this Python cannot run.
        const out = execFileSync(
          python.cmd,
          [...python.args, "-c", READ_BACK_PY, file],
          { timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
        ).toString();
        const result = JSON.parse(out.trim().split("\n").pop()!);
        console.log(
          `${what} read back with sleap-io ${result.version} (${python.label})`,
        );
        expect(result.format_id).toBeLessThan(3);
        expect(result.videos).toEqual(["first.mp4", "second.mp4"]);
        expect(result.tracks).toEqual(["a", "b"]);
        expect(
          result.frames.map(
            (f: { video: number; frame_idx: number; negative: boolean }) => [
              f.video,
              f.frame_idx,
              f.negative,
            ],
          ),
        ).toEqual([
          [0, 0, false],
          [0, 5, false],
          [1, 2, false],
          [1, 7, true],
        ]);
        const [f0, f5, f2, f7] = result.frames;
        // Boxes go through the lazy writers' store maps and the eager one.
        expect(f0.bboxes).toBe(2);
        expect(f7.instances).toEqual([]);
        const [user, pred] = f0.instances;
        expect([user.predicted, user.track]).toEqual([false, "a"]);
        expect([pred.predicted, pred.track]).toEqual([true, "b"]);
        expect(pred.tracking_score).toBe(0.5);
        // No tracking score: NaN on disk, read as None (0.10) or NaN (0.9).
        expect([null, "nan"]).toContain(user.tracking_score);
        expect(user.xy).toEqual([
          [10, 20],
          [30, 40],
          [null, null],
        ]);
        expect(user.visible).toEqual([true, true, false]);
        expect(pred.xy[0]).toEqual([null, null]);
        expect(pred.visible).toEqual([false, true, true]);
        if (user.labeled !== null) {
          // sleap-io 0.10 reads a 2.x file as fully labelled.
          expect(user.labeled).toEqual([true, true, true]);
          expect(pred.labeled).toEqual([true, true, true]);
        }
        // The corrected user instance still points at its source prediction.
        expect(
          f5.instances.map((i: { predicted: boolean }) => i.predicted),
        ).toEqual([true, false]);
        expect(f5.instances[1].from_predicted).toBe(0);
        expect(f2.instances[0].track).toBeNull();
        for (const frame of result.frames) {
          expect(frame.metadata).toEqual({});
          for (const inst of frame.instances) expect(inst.metadata).toEqual({});
        }
      });
    }
  }
});
