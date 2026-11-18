/**
 * Bounding boxes (`/bboxes`) on disk, across readers and with Python sleap-io.
 *
 * Regressions covered:
 *  - JS wrote `/bboxes` as a flat 2-D f8 matrix (+ root `bbox_*` JSON string
 *    datasets). Python sleap-io writes and expects a columnar `/bboxes` GROUP
 *    (SLP 2.0+) and crashed loading JS-written boxes (`IndexError` in its
 *    legacy reader). JS now writes Python's group layout.
 *  - The eager/lazy JS reader only understood the matrix/compound layouts, so a
 *    Python-written file read back 0 boxes.
 *  - The streaming reader (browser / Tauri WebView via `loadSlp`) never read
 *    `/bboxes` at all, so every box was dropped on open.
 *
 * The streaming reader is driven through `readFromStreamingFile` with a fake
 * `StreamingH5File` (no Worker), same harness as streaming-centroids.test.ts.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import {
  Labels,
  LabeledFrame,
  Instance,
  Skeleton,
  Track,
  Video,
  UserBoundingBox,
  PredictedBoundingBox,
  saveSlpToBytes,
} from "../src/index.js";
import type { BoundingBox } from "../src/model/bbox.js";
import { ready, File as H5File } from "h5wasm/node";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PY_FIXTURE = join(
  fileURLToPath(new URL("./data", import.meta.url)),
  "slp",
  "py_written_bboxes.slp",
);

function unwrapAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    out[k] =
      v && typeof v === "object" && "value" in (v as Record<string, unknown>)
        ? (v as { value: unknown }).value
        : v;
  }
  return out;
}

/**
 * A project with:
 *  - frame 0: a pose instance + a UserBoundingBox linked to it (track, category,
 *    name, source, tracking score);
 *  - frame 1: a rotated PredictedBoundingBox on a second instance's frame;
 *  - frame 5: a box-only frame (no instances) with a PredictedBoundingBox.
 */
function bboxLabels(): Labels {
  const pose = new Skeleton({ nodes: ["nose", "tail"], name: "rodent" });
  const video = new Video({ filename: "v.mp4" });
  const trackA = new Track("a");
  const trackB = new Track("b");
  const inst0 = new Instance({
    skeleton: pose,
    track: trackA,
    points: [
      { xy: [10, 10], visible: true, complete: true },
      { xy: [30, 30], visible: true, complete: true },
    ],
  });
  const inst1 = new Instance({
    skeleton: pose,
    points: [
      { xy: [50, 50], visible: true, complete: true },
      { xy: [70, 80], visible: true, complete: true },
    ],
  });
  const ub = new UserBoundingBox({
    x1: 6,
    y1: 6,
    x2: 34,
    y2: 34,
    instance: inst0,
    track: trackA,
    trackingScore: 0.75,
    category: "mouse",
    name: "ub",
    source: "manual",
  });
  const pbRot = new PredictedBoundingBox({
    x1: 45.5,
    y1: 44.25,
    x2: 75,
    y2: 86,
    angle: 0.3,
    score: 0.91,
    instance: inst1,
    track: trackB,
    trackingScore: 0.5,
    name: "rot",
    source: "detector",
  });
  const pbOnly = new PredictedBoundingBox({
    x1: 1,
    y1: 2,
    x2: 3,
    y2: 4,
    score: 0.25,
  });
  return new Labels({
    skeletons: [pose],
    videos: [video],
    tracks: [trackA, trackB],
    labeledFrames: [
      new LabeledFrame({
        video,
        frameIdx: 0,
        instances: [inst0],
        bboxes: [ub],
      }),
      new LabeledFrame({
        video,
        frameIdx: 1,
        instances: [inst1],
        bboxes: [pbRot],
      }),
      new LabeledFrame({ video, frameIdx: 5, instances: [], bboxes: [pbOnly] }),
    ],
  });
}

/** Assert the boxes of {@link bboxLabels} came back intact. */
function expectBboxLabels(labels: Labels, linksResolved = true): void {
  const byFrame = new Map<number, LabeledFrame>();
  for (const lf of labels.labeledFrames) byFrame.set(lf.frameIdx, lf);
  const all = labels.labeledFrames.flatMap((lf) => lf.bboxes);
  expect(all.length).toBe(3);

  const ub = byFrame.get(0)!.bboxes[0];
  expect(ub).toBeInstanceOf(UserBoundingBox);
  expect([ub.x1, ub.y1, ub.x2, ub.y2, ub.angle]).toEqual([6, 6, 34, 34, 0]);
  expect(ub.track?.name).toBe("a");
  expect(ub.trackingScore).toBeCloseTo(0.75, 6);
  expect(ub.category).toBe("mouse");
  expect(ub.name).toBe("ub");
  expect(ub.source).toBe("manual");

  const rot = byFrame.get(1)!.bboxes[0] as PredictedBoundingBox;
  expect(rot).toBeInstanceOf(PredictedBoundingBox);
  expect([rot.x1, rot.y1, rot.x2, rot.y2]).toEqual([45.5, 44.25, 75, 86]);
  expect(rot.angle).toBeCloseTo(0.3, 6);
  expect(rot.score).toBeCloseTo(0.91, 6);
  expect(rot.track?.name).toBe("b");
  expect(rot.trackingScore).toBeCloseTo(0.5, 6);
  expect(rot.category).toBe("");
  expect(rot.name).toBe("rot");
  expect(rot.source).toBe("detector");

  // Box-only frame (no instances) still exists and carries its box.
  const only = byFrame.get(5);
  expect(only).toBeDefined();
  expect(only!.instances.length).toBe(0);
  const pb = only!.bboxes[0] as PredictedBoundingBox;
  expect(pb).toBeInstanceOf(PredictedBoundingBox);
  expect([pb.x1, pb.y1, pb.x2, pb.y2]).toEqual([1, 2, 3, 4]);
  expect(pb.score).toBeCloseTo(0.25, 6);
  expect(pb.track).toBeNull();
  expect(pb.trackingScore).toBeNull();
  expect(pb.instance).toBeNull();

  if (linksResolved) {
    // Box → instance links resolve to the live pose instance of that frame.
    expect(ub.instance).toBe(byFrame.get(0)!.instances[0]);
    expect(rot.instance).toBe(byFrame.get(1)!.instances[0]);
  }
}

/** Write `bytes` to a node temp file and an h5wasm MEMFS path. */
async function stage(bytes: Uint8Array, tag: string) {
  const module = await ready;
  const uniq = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const disk = join(tmpdir(), `${tag}_${uniq}.slp`);
  writeFileSync(disk, bytes);
  try {
    module.FS.mkdir("/tmp");
  } catch {
    /* exists */
  }
  const mem = `/tmp/${tag}_${uniq}.slp`;
  module.FS.writeFile(mem, bytes);
  const cleanup = () => {
    try {
      module.FS.unlink(mem);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(disk);
    } catch {
      /* ignore */
    }
  };
  return { module, disk, mem, cleanup };
}

/** Build a fake StreamingH5File over `bytes` (compound pose tables from a real
 * lazy store, every other dataset/attr from h5wasm/node). */
async function makeFakeStreamingFile(bytes: Uint8Array): Promise<{
  fake: StreamingH5File;
  close: () => void;
}> {
  const { disk, mem, cleanup } = await stage(bytes, "stream_bboxes");
  const h5 = new H5File(mem, "r");

  const store = (await readSlpLazy(disk, { openVideos: false }))._lazyDataStore;
  if (!store) throw new Error("readSlpLazy produced no lazy store");
  const columns: Record<string, Record<string, unknown[]>> = {
    frames: store.framesData,
    instances: store.instancesData,
    points: store.pointsData,
    pred_points: store.predPointsData,
  };
  const get = (dp: string) => h5.get(dp) as unknown as Record<string, unknown>;

  const fake = {
    keys: () => h5.keys() as string[],
    getKeys: async (dp: string) => {
      const node = (dp === "/" ? h5 : get(dp)) as any;
      return typeof node?.keys === "function" ? (node.keys() as string[]) : [];
    },
    getAttrs: async (dp: string) =>
      unwrapAttrs((get(dp)?.attrs as Record<string, unknown>) ?? {}),
    getDatasetMeta: async (dp: string) => {
      const d = get(dp);
      return {
        shape: (d?.shape as number[]) ?? [],
        dtype: (d?.dtype as string) ?? "",
      };
    },
    getDatasetValue: async (dp: string) => {
      if (dp in columns) return { value: columns[dp], shape: [], dtype: "" };
      const d = get(dp);
      if (!d || !("value" in d)) throw new Error(`not a dataset: ${dp}`);
      return {
        value: d.value,
        shape: (d.shape as number[]) ?? [],
        dtype: (d.dtype as string) ?? "",
      };
    },
  } as unknown as StreamingH5File;

  return {
    fake,
    close: () => {
      h5.close();
      cleanup();
    },
  };
}

const readStreaming = (fake: StreamingH5File, lazy: boolean) =>
  readFromStreamingFile(
    fake,
    "test.slp",
    "test.slp",
    false,
    undefined,
    false,
    lazy,
  );

/** Materialize every frame of a lazy Labels (main + supplementary). */
function lazyFrames(labels: Labels): LabeledFrame[] {
  const out: LabeledFrame[] = [];
  for (let i = 0; i < labels.length; i++) {
    const lf = labels._lazyFrameList!.at(i);
    if (lf) out.push(lf);
  }
  return out;
}

/** {@link bboxLabels} saved with `/bboxes` in the pre-fix JS layout: a flat
 * 2-D f8 matrix + `field_names` attr, with root `bbox_*` JSON string datasets
 * (written here the way the old writer did). */
async function legacyMatrixBboxBytes(): Promise<Uint8Array> {
  const labels = bboxLabels();
  for (const lf of labels.labeledFrames) lf.bboxes = [];
  const { module, mem, cleanup } = await stage(
    await saveSlpToBytes(labels),
    "legacy_bboxes",
  );
  try {
    const f = new H5File(mem, "a");
    const fields = [
      "x1",
      "y1",
      "x2",
      "y2",
      "angle",
      "video",
      "frame_idx",
      "track",
      "score",
      "instance",
      "tracking_score",
    ];
    const N = Number.NaN;
    const rows = [
      [6, 6, 34, 34, 0, 0, 0, 0, N, 0, 0.75],
      [45.5, 44.25, 75, 86, 0.3, 0, 1, 1, 0.91, 1, 0.5],
      [1, 2, 3, 4, 0, 0, 5, -1, 0.25, -1, N],
    ];
    f.create_dataset({
      name: "bboxes",
      data: Float64Array.from(rows.flat()),
      shape: [rows.length, fields.length],
      dtype: "<f8",
    });
    const strAttr = (target: any, name: string, value: string) =>
      target.create_attribute(
        name,
        value,
        null,
        `S${new TextEncoder().encode(value).length}`,
      );
    strAttr(f.get("bboxes"), "field_names", JSON.stringify(fields));
    const strDs = (name: string, values: string[]) => {
      const json = JSON.stringify(values);
      const b = new TextEncoder().encode(json);
      f.create_dataset({ name, data: b, shape: [b.length], dtype: "<B" });
      strAttr(f.get(name), "json", json);
    };
    strDs("bbox_categories", ["mouse", "", ""]);
    strDs("bbox_names", ["ub", "rot", ""]);
    strDs("bbox_sources", ["manual", "detector", ""]);
    f.close();
    return new Uint8Array(module.FS.readFile(mem));
  } finally {
    cleanup();
  }
}

describe("SLP /bboxes — writer layout", () => {
  it("writes Python's columnar /bboxes group (no matrix, no root bbox_*)", async () => {
    const bytes = await saveSlpToBytes(bboxLabels());
    const { mem, cleanup } = await stage(bytes, "bbox_layout");
    const f = new H5File(mem, "r");
    try {
      const grp = f.get("bboxes") as any;
      expect(grp?.type).toBe("Group");
      expect([...(grp.keys() as string[])].sort()).toEqual(
        [
          "angle",
          "category",
          "frame_idx",
          "instance",
          "is_predicted",
          "name",
          "score",
          "source",
          "track",
          "tracking_score",
          "video",
          "x1",
          "x2",
          "y1",
          "y2",
        ].sort(),
      );
      const v = (n: string) => Array.from((f.get(`bboxes/${n}`) as any).value);
      expect(v("is_predicted")).toEqual([0, 1, 1]);
      expect(v("video")).toEqual([0, 0, 0]);
      expect(v("frame_idx")).toEqual([0, 1, 5]);
      expect(v("track")).toEqual([0, 1, -1]);
      // Row of the linked instance in the `instances` table (pb has none).
      expect(v("instance")).toEqual([0, 1, -1]);
      expect(v("category")).toEqual(["mouse", "", ""]);
      expect(v("name")).toEqual(["ub", "rot", ""]);
      expect(v("source")).toEqual(["manual", "detector", ""]);
      expect(f.get("bbox_categories")).toBeNull();
      expect(f.get("bbox_names")).toBeNull();
      expect(f.get("bbox_sources")).toBeNull();
    } finally {
      f.close();
      cleanup();
    }
  });
});

describe("SLP /bboxes — JS write → read", () => {
  it("eager readSlp round-trips every box field + instance link", async () => {
    const bytes = await saveSlpToBytes(bboxLabels());
    const labels = await readSlp(bytes, { openVideos: false });
    expectBboxLabels(labels);
  });

  it("lazy readSlpLazy round-trips the boxes", async () => {
    const bytes = await saveSlpToBytes(bboxLabels());
    const labels = await readSlpLazy(bytes, { openVideos: false });
    const boxes = lazyFrames(labels).flatMap((lf) => lf.bboxes);
    expect(boxes.length).toBe(3);
    expect(boxes.filter((b) => b.isPredicted).length).toBe(2);
  });

  it("re-saving a lazily loaded file keeps the instance links", async () => {
    const lazy = await readSlpLazy(await saveSlpToBytes(bboxLabels()), {
      openVideos: false,
    });
    const again = await readSlp(await saveSlpToBytes(lazy), {
      openVideos: false,
    });
    expectBboxLabels(again);
  });

  it("eager streaming reads /bboxes (was silently dropped)", async () => {
    const { fake, close } = await makeFakeStreamingFile(
      await saveSlpToBytes(bboxLabels()),
    );
    try {
      expectBboxLabels(await readStreaming(fake, false));
    } finally {
      close();
    }
  });

  it("lazy streaming materializes /bboxes per frame", async () => {
    const { fake, close } = await makeFakeStreamingFile(
      await saveSlpToBytes(bboxLabels()),
    );
    try {
      const labels = await readStreaming(fake, true);
      const frames = lazyFrames(labels);
      const boxes = frames.flatMap((lf) => lf.bboxes);
      expect(boxes.length).toBe(3);
      const only = frames.find((lf) => lf.frameIdx === 5)!;
      expect(only.bboxes.length).toBe(1);
      expect((only.bboxes[0] as PredictedBoundingBox).score).toBeCloseTo(
        0.25,
        6,
      );
    } finally {
      close();
    }
  });
});

describe("SLP /bboxes — legacy JS matrix layout still reads", () => {
  it("eager readSlp", async () => {
    const bytes = await legacyMatrixBboxBytes();
    expectBboxLabels(await readSlp(bytes, { openVideos: false }));
  });

  it("streaming", async () => {
    const bytes = await legacyMatrixBboxBytes();
    const { fake, close } = await makeFakeStreamingFile(bytes);
    try {
      expectBboxLabels(await readStreaming(fake, false));
    } finally {
      close();
    }
  });
});

/**
 * `py_written_bboxes.slp` (see gen_bbox_fixture.py): Python sleap-io 0.9.3 on
 * SLEAP's centered_pair.slp, 3 labeled frames (0, 15, 31) with two user
 * instances each, a `to_bbox(padding=4)` UserBoundingBox per instance, a
 * standalone rotated PredictedBoundingBox on frame 15 and a box-only frame 100.
 */
function expectPyFixture(frames: LabeledFrame[], linksResolved: boolean) {
  const byFrame = new Map<number, LabeledFrame>();
  for (const lf of frames) byFrame.set(lf.frameIdx, lf);
  expect([...byFrame.keys()].sort((a, b) => a - b)).toEqual([0, 15, 31, 100]);
  const all: BoundingBox[] = frames.flatMap((lf) => lf.bboxes);
  expect(all.length).toBe(8);
  expect(byFrame.get(0)!.bboxes.length).toBe(2);
  expect(byFrame.get(15)!.bboxes.length).toBe(3);
  expect(byFrame.get(31)!.bboxes.length).toBe(2);
  expect(byFrame.get(100)!.bboxes.length).toBe(1);
  expect(byFrame.get(100)!.instances.length).toBe(0);

  // User boxes, each the padded tight box of its instance.
  const users = all.filter((b) => !b.isPredicted);
  expect(users.length).toBe(6);
  for (const b of users) expect(b).toBeInstanceOf(UserBoundingBox);
  const b0 = byFrame.get(0)!.bboxes[0];
  expect(b0.x1).toBeCloseTo(83.7496, 3);
  expect(b0.y1).toBeCloseTo(138.3588, 3);
  expect(b0.x2).toBeCloseTo(185.4483, 3);
  expect(b0.y2).toBeCloseTo(210.4289, 3);
  expect(b0.track?.name).toBe("mouse_a");
  expect(b0.trackingScore).toBeNull();
  expect(byFrame.get(0)!.bboxes[1].track).toBeNull();
  for (const b of byFrame.get(31)!.bboxes) expect(b.category).toBe("mouse");

  if (linksResolved) {
    for (const lf of [0, 15, 31].map((i) => byFrame.get(i)!)) {
      const linked = lf.bboxes.filter((b) => !b.isPredicted);
      expect(linked.map((b) => b.instance)).toEqual(lf.instances);
    }
  }

  // Standalone rotated predicted box (score/tracking_score are f4 on disk).
  const pred = byFrame.get(15)!.bboxes[2] as PredictedBoundingBox;
  expect(pred).toBeInstanceOf(PredictedBoundingBox);
  expect([pred.x1, pred.y1, pred.x2, pred.y2]).toEqual([100, 120, 180, 200]);
  expect(pred.angle).toBeCloseTo(0.5, 6);
  expect(pred.score).toBeCloseTo(0.85, 5);
  expect(pred.track?.name).toBe("mouse_b");
  expect(pred.trackingScore).toBeCloseTo(0.6, 5);
  expect(pred.instance).toBeNull();
  expect(pred.name).toBe("pred");
  expect(pred.source).toBe("detector");

  const only = byFrame.get(100)!.bboxes[0] as PredictedBoundingBox;
  expect(only).toBeInstanceOf(PredictedBoundingBox);
  expect([only.x1, only.y1, only.x2, only.y2]).toEqual([10, 20, 30, 50]);
  expect(only.score).toBeCloseTo(0.4, 5);
}

describe("SLP /bboxes — Python-written fixture", () => {
  const bytes = () => new Uint8Array(readFileSync(PY_FIXTURE));

  it("eager readSlp reads Python's /bboxes group", async () => {
    const labels = await readSlp(bytes(), { openVideos: false });
    expectPyFixture(labels.labeledFrames, true);
  });

  it("lazy readSlpLazy reads Python's /bboxes group", async () => {
    const labels = await readSlpLazy(bytes(), { openVideos: false });
    expectPyFixture(lazyFrames(labels), false);
  });

  it("eager streaming reads Python's /bboxes group", async () => {
    const { fake, close } = await makeFakeStreamingFile(bytes());
    try {
      const labels = await readStreaming(fake, false);
      expectPyFixture(labels.labeledFrames, true);
    } finally {
      close();
    }
  });

  it("lazy streaming reads Python's /bboxes group", async () => {
    const { fake, close } = await makeFakeStreamingFile(bytes());
    try {
      const labels = await readStreaming(fake, true);
      expectPyFixture(lazyFrames(labels), false);
    } finally {
      close();
    }
  });
});
