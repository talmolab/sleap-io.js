/**
 * Builds SLP files whose instance point spans are deliberately wrong, for the
 * read-side span checks (issue #230). Not a test file itself.
 *
 * A file is made by saving clean labels, then rewriting only the
 * `point_id_start`/`point_id_end` columns of the `instances` table in place —
 * the point rows stay exactly as written, which is what the float32
 * `instances` bug (#231) did to real files.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ready, File as H5File } from "h5wasm/node";
import {
  buildLabelTableUpdate,
  saveSlpToBytes,
  writeLabelTablesInPlace,
} from "../src/codecs/slp/write.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import { Instance, PredictedInstance } from "../src/model/instance.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Labels } from "../src/model/labels.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";

const SCRATCH = mkdtempSync(path.join(tmpdir(), "sleap-point-spans-"));

export const SPAN_NODES = ["head", "thorax", "abdomen", "tail"];

/**
 * Point `k` of global instance `i` sits at `(100 * i + k, k)`, so `x % 100`
 * names the node a coordinate was written for.
 */
export function spanCoord(instance: number, node: number): [number, number] {
  return [100 * instance + node, node];
}

/**
 * Two frames on one video. `layout` lists each frame's instances as "u" (user)
 * or "p" (predicted); the default is two predicted instances per frame.
 */
export function makeSpanLabels(layout: string[] = ["pp", "pp"]): Labels {
  const skeleton = new Skeleton({ nodes: SPAN_NODES, name: "fly" });
  const video = new Video({ filename: "span-test.mp4" });
  let instanceIdx = 0;
  const frames = layout.map((kinds, frameIdx) => {
    const instances = [...kinds].map((kind) => {
      const xy = SPAN_NODES.map((_, node) => spanCoord(instanceIdx, node));
      instanceIdx++;
      return kind === "u"
        ? Instance.fromArray(xy, skeleton)
        : PredictedInstance.fromArray(xy, skeleton, {
            score: 0.5,
            pointScores: SPAN_NODES.map(() => 0.9),
          });
    });
    return new LabeledFrame({ video, frameIdx: frameIdx * 10, instances });
  });
  return new Labels({
    labeledFrames: frames,
    videos: [video],
    skeletons: [skeleton],
  });
}

/** `[point_id_start, point_id_end]` for each `instances` row, in row order. */
export type Spans = Array<[number, number]>;

/**
 * Save `labels`, then overwrite the instances' point spans with `spans` (rows
 * not listed keep theirs). Returns the bytes and the spans as first written.
 */
export async function writeSlpWithSpans(
  labels: Labels,
  spans: (original: Spans) => Spans,
): Promise<{ bytes: Uint8Array; original: Spans }> {
  await ready;
  const file = path.join(
    SCRATCH,
    `spans_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`,
  );
  writeFileSync(file, await saveSlpToBytes(labels));

  const update = buildLabelTableUpdate(labels);
  const startCol = update.instances.fields.indexOf("point_id_start");
  const endCol = update.instances.fields.indexOf("point_id_end");
  const original: Spans = update.instances.rows.map((row) => [
    Number(row[startCol]),
    Number(row[endCol]),
  ]);
  spans(original.map(([s, e]) => [s, e])).forEach(([start, end], row) => {
    update.instances.rows[row][startCol] = start;
    update.instances.rows[row][endCol] = end;
  });

  const h5 = new H5File(file, "a");
  try {
    writeLabelTablesInPlace(h5, update);
    h5.flush();
  } finally {
    h5.close();
  }
  return { bytes: new Uint8Array(readFileSync(file)), original };
}

/**
 * Shift the boundary between instance rows `row` and `row + 1` by `delta`
 * point rows — the #231 corruption: spans become `n + delta` and `n - delta`
 * while the rows still tile the point table.
 */
export function shiftBoundary(row: number, delta: number) {
  return (spans: Spans): Spans => {
    spans[row][1] += delta;
    spans[row + 1][0] += delta;
    return spans;
  };
}

/**
 * A minimal `StreamingH5File` over `bytes`, read with `h5wasm/node`, so the
 * Worker-only streaming reader can be driven from Node via
 * `readFromStreamingFile`.
 */
export async function makeStreamingFile(
  bytes: Uint8Array,
): Promise<{ file: StreamingH5File; close: () => void }> {
  await ready;
  const p = path.join(
    SCRATCH,
    `stream_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`,
  );
  writeFileSync(p, bytes);
  const h5 = new H5File(p, "r");
  const get = (dp: string) => h5.get(dp) as unknown as Record<string, any>;
  const unwrap = (attrs: Record<string, any> = {}) =>
    Object.fromEntries(
      Object.entries(attrs).map(([k, v]) => [
        k,
        v && typeof v === "object" && "value" in v ? v.value : v,
      ]),
    );
  const file = {
    keys: () => h5.keys() as string[],
    getKeys: async (dp: string) => (get(dp)?.keys?.() as string[]) ?? [],
    getAttrs: async (dp: string) => unwrap(get(dp)?.attrs),
    getDatasetMeta: async (dp: string) => {
      const d = get(dp);
      return { shape: d?.shape ?? [], dtype: d?.metadata ?? d?.dtype ?? "" };
    },
    getDatasetValue: async (dp: string) => {
      const d = get(dp);
      return { value: d?.value, shape: d?.shape ?? [], dtype: "" };
    },
  } as unknown as StreamingH5File;
  return { file, close: () => h5.close() };
}
