/**
 * Reading the pose tables of SLP format 3.0 (one dataset per column).
 *
 * Fixtures (`tests/data/slp/gen_format3_pose_fixture.py`) were written with
 * Python sleap-io 0.10.0 from the `release/0.10` branch at commit fe4f91c7b:
 *   - format3_pose.slp: format 3.0
 *   - format3_pose.v2.slp: the same labels in the 2.x layout
 *   - format3_unlabeled.slp: format 3.0 with a point marked as not labelled
 *     and metadata on a frame and an instance
 *   - format3_rois_stub.slp: format3_pose.slp plus an empty `/rois` group
 *
 * Each reader (in memory, lazy, streaming, lite) must give the same result for
 * the 3.0 file as for its 2.x twin, and the values the generator wrote.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import { SlpFormatError } from "../src/codecs/slp/format-check.js";
import {
  poseTableFromColumns,
  negativeFrameKeysFromFrames,
  VIDEO_IS_INDEX,
} from "../src/codecs/slp/columnar.js";
import { buildVideoIdMap } from "../src/model/video-id-map.js";
import { loadSlp } from "../src/index.js";
import { loadSlpMetadata } from "../src/lite.js";
import { PredictedInstance } from "../src/model/instance.js";
import type { Labels } from "../src/model/labels.js";
import { Video } from "../src/model/video.js";
import { ready, File as H5File } from "h5wasm/node";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const slpDir = path.join(
  fileURLToPath(new URL("./data", import.meta.url)),
  "slp",
);
const slpPath = (name: string) => path.join(slpDir, name);
const slpBytes = (name: string) => new Uint8Array(readFileSync(slpPath(name)));

const V3 = "format3_pose.slp";
const V2 = "format3_pose.v2.slp";
const UNLABELED = "format3_unlabeled.slp";
const ROIS_STUB = "format3_rois_stub.slp";

/**
 * A `StreamingH5File` over a real fixture, read with h5wasm/node.
 * `readSlpStreaming` needs a Web Worker and can't run in this suite, so the
 * streaming reader is driven through `readFromStreamingFile`. Attributes come
 * back wrapped as `{ value }`, as the worker's `getAttrs` returns them.
 * `compound` supplies the already-columnar pose tables of a 2.x file, which
 * the worker reads with a fast path this stand-in doesn't have.
 */
async function streamingFile(
  name: string,
  compound: Record<string, unknown> = {},
): Promise<{ file: StreamingH5File; close: () => void }> {
  await ready;
  const h5 = new H5File(slpPath(name), "r");
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm entities
  const get = (p: string) => h5.get(p) as any;
  const file = {
    keys: () => h5.keys() as string[],
    getKeys: async (p: string) => {
      const node = get(p);
      if (!node || node.type !== "Group") {
        throw new Error(`Not a group: ${p}`);
      }
      return node.keys() as string[];
    },
    getAttrs: async (p: string) => {
      const node = get(p);
      if (!node) throw new Error(`Path not found: ${p}`);
      const out: Record<string, unknown> = {};
      for (const [key, attr] of Object.entries(node.attrs ?? {})) {
        out[key] = { value: (attr as { value: unknown }).value };
      }
      return out;
    },
    getDatasetMeta: async (p: string) => {
      const d = get(p);
      return { shape: d?.shape ?? [], dtype: d?.dtype ?? "" };
    },
    getDatasetValue: async (p: string) => {
      if (p in compound) return { value: compound[p], shape: [], dtype: "" };
      const d = get(p);
      return { value: d?.value, shape: d?.shape ?? [], dtype: d?.dtype ?? "" };
    },
  } as unknown as StreamingH5File;
  return { file, close: () => h5.close() };
}

/** Load a fixture through the streaming reader, eagerly or lazily. */
async function readStreaming(name: string, lazy = false): Promise<Labels> {
  let compound: Record<string, unknown> = {};
  if (name === V2) {
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
      `https://example.com/${name}`,
      undefined,
      false,
      undefined,
      false,
      lazy,
    );
    if (lazy) labels.materialize();
    return labels;
  } finally {
    close();
  }
}

/** Everything about the poses that the two layouts must agree on. */
function summarize(labels: Labels) {
  const all = labels.labeledFrames.flatMap((f) => f.instances);
  return {
    videos: labels.videos.map((v) => v.filename),
    tracks: labels.tracks.map((t) => t.name),
    nodes: labels.skeletons.map((s) => s.nodeNames),
    frames: labels.labeledFrames.map((frame) => ({
      video: labels.videos.indexOf(frame.video),
      frameIdx: frame.frameIdx,
      isNegative: frame.isNegative,
      instances: frame.instances.map((inst) => ({
        predicted: inst instanceof PredictedInstance,
        track: inst.track?.name ?? null,
        xy: inst.points.map((p) => [p.xy[0], p.xy[1]]),
        visible: inst.points.map((p) => p.visible),
        complete: inst.points.map((p) => p.complete),
        pointScores:
          inst instanceof PredictedInstance
            ? inst.points.map((p) => p.score)
            : null,
        score: inst instanceof PredictedInstance ? inst.score : null,
        trackingScore: inst.trackingScore,
        fromPredicted:
          !(inst instanceof PredictedInstance) && inst.fromPredicted
            ? all.indexOf(inst.fromPredicted)
            : null,
      })),
    })),
  };
}

/** The readers that return poses, as calls that load the named fixture. */
const READERS: Array<[string, (name: string) => Promise<Labels>]> = [
  ["readSlp (in memory)", (n) => readSlp(slpPath(n), { openVideos: false })],
  [
    "readSlp (in memory, from bytes)",
    (n) => readSlp(slpBytes(n), { openVideos: false, h5: { filenameHint: n } }),
  ],
  [
    "readSlpLazy",
    async (n) => {
      const labels = await readSlpLazy(slpPath(n), { openVideos: false });
      expect(labels.isLazy).toBe(true);
      labels.materialize();
      return labels;
    },
  ],
  ["loadSlp", (n) => loadSlp(slpPath(n), { openVideos: false })],
  ["readFromStreamingFile (streaming)", (n) => readStreaming(n)],
  ["readFromStreamingFile (streaming, lazy)", (n) => readStreaming(n, true)],
];

describe("format 3.0 pose tables", () => {
  for (const [label, load] of READERS) {
    it(`${label} reads the 3.0 file exactly as its 2.x twin`, async () => {
      const v3 = summarize(await load(V3));
      const v2 = summarize(await load(V2));
      expect(v3).toEqual(v2);
    });

    it(`${label} reads the values the generator wrote`, async () => {
      const s = summarize(await load(V3));
      expect(s.videos).toEqual(["first.mp4", "second.mp4"]);
      expect(s.tracks).toEqual(["a", "b"]);
      expect(s.nodes).toEqual([["head", "body", "tail"]]);
      // `/frames/video` is the video's index; the row number is the frame id.
      expect(s.frames.map((f) => [f.video, f.frameIdx])).toEqual([
        [0, 0],
        [0, 5],
        [1, 2],
        [1, 7],
      ]);
      // `/frames/is_negative` replaces `/negative_frames`.
      expect(s.frames.map((f) => f.isNegative)).toEqual([
        false,
        false,
        false,
        true,
      ]);
      expect(s.frames.map((f) => f.instances.length)).toEqual([2, 2, 1, 0]);

      const [user, predicted] = s.frames[0].instances;
      expect(user.predicted).toBe(false);
      expect(user.track).toBe("a");
      expect(user.xy).toEqual([
        [10, 20],
        [30, 40],
        [50, 60],
      ]);
      expect(predicted.predicted).toBe(true);
      expect(predicted.track).toBe("b");
      expect(predicted.score).toBe(0.75);
      expect(predicted.trackingScore).toBe(0.5);
      expect(predicted.pointScores).toEqual([0.9, 0.8, 0.7]);

      // Frame 5: the prediction, then the user instance corrected from it.
      const [source, corrected] = s.frames[1].instances;
      expect(source.predicted).toBe(true);
      expect(source.trackingScore).toBe(0.125);
      expect(corrected.fromPredicted).toBe(2);
      // `verified` is read as `complete`.
      expect(corrected.complete).toEqual([true, false, false]);
      // The hidden tail has no coordinates.
      expect(corrected.visible).toEqual([true, true, false]);
      expect(corrected.xy[2]).toEqual([Number.NaN, Number.NaN]);

      expect(s.frames[2].instances[0].track).toBeNull();
    });
  }

  it("the lite reader counts the rows of a 3.0 file", async () => {
    const v3 = await loadSlpMetadata(slpBytes(V3));
    const v2 = await loadSlpMetadata(slpBytes(V2));
    expect(v3.formatId).toBe(3);
    expect(v3.counts).toEqual({
      labeledFrames: 4,
      instances: 5,
      points: 6,
      predictedPoints: 9,
    });
    expect(v3.counts).toEqual(v2.counts);
    expect(v3.skeletons[0].nodeNames).toEqual(v2.skeletons[0].nodeNames);
    expect(v3.tracks.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("a lazily loaded 3.0 file reports its frame count before materializing", async () => {
    const labels = await readSlpLazy(slpPath(V3), { openVideos: false });
    expect(labels.length).toBe(4);
  });
});

describe("a 3.0 file with a table that is not read yet is refused by name", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["readSlp", () => readSlp(slpPath(ROIS_STUB), { openVideos: false })],
    [
      "readSlpLazy",
      () => readSlpLazy(slpPath(ROIS_STUB), { openVideos: false }),
    ],
    ["readFromStreamingFile", () => readStreaming(ROIS_STUB)],
    ["loadSlpMetadata (lite)", () => loadSlpMetadata(slpBytes(ROIS_STUB))],
  ];
  for (const [label, load] of cases) {
    it(label, async () => {
      let error: unknown;
      try {
        await load();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SlpFormatError);
      expect((error as SlpFormatError).formatId).toBe(3);
      expect((error as Error).message).toContain("/rois");
      expect((error as Error).message).toContain("SLP format 3.0");
    });
  }
});

describe("a 3.0 file with content the 2.x layout cannot store", () => {
  // The `labeled` flag and record metadata are not in the model yet. Until
  // they are, the poses must still load: the unlabelled tail reads as hidden.
  for (const [label, load] of READERS) {
    it(`${label} loads its poses`, async () => {
      const s = summarize(await load(UNLABELED));
      expect(s.frames.map((f) => f.instances.length)).toEqual([2, 2, 1, 0]);
      const user = s.frames[0].instances[0];
      expect(user.visible).toEqual([true, true, false]);
      expect(user.xy[2]).toEqual([Number.NaN, Number.NaN]);
    });
  }
});

describe("poseTableFromColumns", () => {
  it("fills in the ids, the `complete` alias and the `labeled` default", () => {
    const frames = poseTableFromColumns(
      "frames",
      {
        video: new BigInt64Array([1n, 1n]),
        frame_idx: new BigInt64Array([3n, 9n]),
        instance_id_start: new BigInt64Array([0n, 1n]),
        instance_id_end: new BigInt64Array([1n, 1n]),
        is_negative: new Int8Array([0, 1]),
      },
      "a.slp",
    );
    expect(Array.from(frames.frame_id)).toEqual([0, 1]);
    expect(Array.from(frames.video)).toEqual([1, 1]);
    expect([...negativeFrameKeysFromFrames(frames)]).toEqual(["1:9"]);

    const points = poseTableFromColumns(
      "points",
      {
        x: new Float64Array([1, 2]),
        y: new Float64Array([3, 4]),
        visible: new Int8Array([1, 0]),
        verified: new Int8Array([0, 1]),
      },
      "a.slp",
    );
    expect(Array.from(points.complete)).toEqual([0, 1]);
    expect(Array.from(points.labeled)).toEqual([1, 1]);
  });

  it("marks the frames table so video indices are not remapped as group ids", () => {
    // Two videos, frames on the second only, whose embedded group is `video0`.
    // Read as a 2.x group id, video 1 would resolve to nothing.
    const videos = [
      new Video({ filename: "a.mp4" }),
      new Video({ filename: "b.pkg.slp", dataset: "video0/video" }),
    ];
    const frames = poseTableFromColumns(
      "frames",
      {
        video: [1],
        frame_idx: [0],
        instance_id_start: [0],
        instance_id_end: [0],
      },
      "a.slp",
    );
    expect((frames as unknown as Record<symbol, unknown>)[VIDEO_IS_INDEX]).toBe(
      true,
    );
    expect(buildVideoIdMap(frames, videos).size).toBe(0);
    // A copy keeps the mark.
    expect(buildVideoIdMap({ ...frames }, videos).size).toBe(0);
  });

  it("refuses a table without a required column", () => {
    expect(() =>
      poseTableFromColumns("points", { x: [1], visible: [1] }, "a.slp"),
    ).toThrow("required column(s) y");
  });

  it("refuses columns of different lengths", () => {
    expect(() =>
      poseTableFromColumns(
        "points",
        { x: [1, 2], y: [1, 2], visible: [1] },
        "a.slp",
      ),
    ).toThrow("different lengths");
  });
});
