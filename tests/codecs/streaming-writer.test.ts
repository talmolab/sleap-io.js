/**
 * Streaming / incremental SLP writer + multi-store merge (issue #207).
 *
 * The write-side companion to `readSlpStreaming({ lazy })`: `openSlpWriter` +
 * `appendStore` + `close` build an SLP by appending pose frames to resizable
 * HDF5 datasets, and `saveSlpMergedFromStores` concatenates N per-camera
 * `LazyDataStore`s into one combined multi-video `.slp`. These tests assert the
 * output round-trips frame-for-frame through the eager reader.
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSlp, readSlpLazy } from "../../src/codecs/slp/read.js";
import {
  openSlpWriter,
  saveSlpMergedFromStores,
  saveSlpMergedToSink,
} from "../../src/codecs/slp/write.js";
import { LazyDataStore } from "../../src/model/lazy.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import {
  Instance,
  PredictedInstance,
  Track,
} from "../../src/model/instance.js";
import { Labels } from "../../src/model/labels.js";
import { UserSegmentationMask } from "../../src/model/mask.js";
import { UserROI } from "../../src/model/roi.js";
import { saveSlpToBytes } from "../../src/codecs/slp/write.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const slp = (name: string) => path.join(fixtureRoot, "slp", name);
const FIX = slp("centered_pair_predictions.slp");
const OTHER = slp("predictions_1.2.7_provenance_and_tracking.slp");

/** Order-preserving structural signature of a frame's pose content. */
function frameSig(f: LabeledFrame): string {
  const insts = f.instances.map((inst) => {
    const isPred = inst.constructor.name.includes("Predicted");
    const trackName = inst.track?.name ?? "";
    const score = (inst as { score?: number }).score ?? "";
    const pts = inst.points.map((p) => `${p.xy[0]},${p.xy[1]}`).join(";");
    return `${isPred ? "P" : "U"}|${trackName}|${score}|${pts}`;
  });
  return `f${f.frameIdx}[${insts.join("/")}]`;
}

const store = async (p: string) => {
  const lazy = await readSlpLazy(p, { openVideos: false });
  const s = lazy._lazyDataStore;
  if (!s) throw new Error("no lazy store");
  return s;
};

/** A chunk-collecting {@link SlpWriteSink} for tests. */
function collectingSink() {
  const chunks: Uint8Array[] = [];
  let closed = false;
  return {
    sink: {
      write(c: Uint8Array) {
        chunks.push(c.slice());
      },
      close() {
        closed = true;
      },
    },
    get closed() {
      return closed;
    },
    get chunkCount() {
      return chunks.length;
    },
    bytes(): Uint8Array {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    },
  };
}

describe("openSlpWriter — single-store streaming write", () => {
  it("round-trips frame-for-frame with the eager reader", async () => {
    const eager = await readSlp(FIX, { openVideos: false });
    const s = await store(FIX);

    const writer = await openSlpWriter({
      skeletons: s.skeletons,
      videos: s.videos,
      tracks: s.tracks,
    });
    writer.appendStore(s);
    const bytes = writer.close();

    const rt = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });
    expect(rt.videos.length).toBe(eager.videos.length);
    expect(rt.labeledFrames.length).toBe(eager.labeledFrames.length);
    expect(rt.labeledFrames.map(frameSig)).toEqual(
      eager.labeledFrames.map(frameSig),
    );
  });

  it("rejects use after close", async () => {
    const s = await store(FIX);
    const writer = await openSlpWriter({
      skeletons: s.skeletons,
      videos: s.videos,
      tracks: s.tracks,
    });
    writer.close();
    expect(() => writer.appendStore(s)).toThrow(/closed/);
    expect(() => writer.close()).toThrow(/already closed/);
  });
});

describe("saveSlpMergedFromStores — multi-store merge", () => {
  it("concatenates two stores into one multi-video file, frame-for-frame", async () => {
    const eager = await readSlp(FIX, { openVideos: false });
    const nFramesEach = eager.labeledFrames.length;

    // Two lazy loads of the same fixture stand in for two cameras that share a
    // skeleton but have distinct videos.
    const s0 = await store(FIX);
    const s1 = await store(FIX);
    const bytes = await saveSlpMergedFromStores([s0, s1]);

    const merged = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });

    // Two videos, double the frames, correctly split by source video.
    expect(merged.videos.length).toBe(2);
    expect(merged.labeledFrames.length).toBe(2 * nFramesEach);

    const vi = (f: LabeledFrame) => merged.videos.indexOf(f.video);
    const v0 = merged.labeledFrames.filter((f) => vi(f) === 0);
    const v1 = merged.labeledFrames.filter((f) => vi(f) === 1);
    expect(v0.length).toBe(nFramesEach);
    expect(v1.length).toBe(nFramesEach);

    // Each video's frames match the original fixture frame-for-frame.
    const ref = eager.labeledFrames.map(frameSig);
    expect(v0.map(frameSig)).toEqual(ref);
    expect(v1.map(frameSig)).toEqual(ref);
  });

  it("remaps tracks per store (combined tracks = concatenation)", async () => {
    const eager = await readSlp(FIX, { openVideos: false });
    const srcTrackNames = new Set(
      eager.labeledFrames.flatMap((f) =>
        f.instances.map((i) => i.track?.name).filter(Boolean),
      ),
    );
    // Only meaningful if the fixture actually has tracks.
    if (srcTrackNames.size === 0) return;

    const bytes = await saveSlpMergedFromStores([
      await store(FIX),
      await store(FIX),
    ]);
    const merged = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });

    // Combined tracks = both stores' tracks concatenated (distinct objects).
    expect(merged.tracks.length).toBe(2 * eager.tracks.length);
    // Every instance still resolves to a track with one of the original names.
    for (const f of merged.labeledFrames) {
      for (const inst of f.instances) {
        if (inst.track) expect(srcTrackNames.has(inst.track.name)).toBe(true);
      }
    }
  });

  it("throws when stores have different skeletons", async () => {
    const a = await store(FIX);
    const b = await store(OTHER);
    await expect(saveSlpMergedFromStores([a, b])).rejects.toThrow(
      /different skeleton/,
    );
  });

  it("throws for an empty store list", async () => {
    await expect(saveSlpMergedFromStores([])).rejects.toThrow(
      /at least one store/,
    );
  });
});

describe("appendStore — non-monotonic point ranges (#208 review)", () => {
  it("attributes points correctly when store point ranges aren't frame-ordered", async () => {
    // A reader-valid store whose point table is NOT monotonic in frame order:
    // frame 0's instance owns store points [3,6); frame 1's owns [0,3). The
    // writer re-packs points in frame order, so it must stamp the PACKED index,
    // not the store's original offset — otherwise the two frames' point sets swap.
    const skeleton = new Skeleton({ nodes: ["A", "B", "C"] });
    const video = new Video({
      filename: ".",
      backendMetadata: { dataset: "video0/video" },
    });
    const store = new LazyDataStore({
      framesData: {
        frame_id: [0, 1],
        video: [0, 0],
        frame_idx: [0, 1],
        instance_id_start: [0, 1],
        instance_id_end: [1, 2],
      },
      instancesData: {
        instance_type: [0, 0],
        skeleton: [0, 0],
        track: [-1, -1],
        from_predicted: [-1, -1],
        score: [0, 0],
        point_id_start: [3, 0], // frame 0 -> points 3..6, frame 1 -> points 0..3
        point_id_end: [6, 3],
        tracking_score: [0, 0],
      },
      pointsData: {
        x: [10, 11, 12, 30, 31, 32],
        y: [10, 11, 12, 30, 31, 32],
        visible: [1, 1, 1, 1, 1, 1],
        complete: [1, 1, 1, 1, 1, 1],
        score: [0, 0, 0, 0, 0, 0],
      },
      predPointsData: { x: [], y: [], visible: [], complete: [], score: [] },
      skeletons: [skeleton],
      tracks: [],
      videos: [video],
      formatId: 1.2,
    });

    const writer = await openSlpWriter({
      skeletons: [skeleton],
      videos: [video],
      tracks: [],
    });
    writer.appendStore(store);
    const bytes = writer.close();
    const rt = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });

    const f0 = rt.labeledFrames.find((f) => f.frameIdx === 0)!;
    const f1 = rt.labeledFrames.find((f) => f.frameIdx === 1)!;
    // frame 0 owns the (30,31,32) block; frame 1 owns the (10,11,12) block.
    expect(f0.instances[0].points.map((p) => p.xy[0])).toEqual([30, 31, 32]);
    expect(f1.instances[0].points.map((p) => p.xy[0])).toEqual([10, 11, 12]);
  });
});

describe("SlpStreamWriter.appendFrames — materialized-frame overlay", () => {
  const skeleton = new Skeleton(["A", "B"]);
  const video = new Video({ filename: "overlay.mp4" });
  const track = new Track("t0");
  const mkUser = (frameIdx: number, x: number) =>
    new LabeledFrame({
      video,
      frameIdx,
      instances: [
        new Instance({
          points: [
            { xy: [x, x + 1], visible: true, complete: true },
            { xy: [x + 2, x + 3], visible: true, complete: true },
          ],
          skeleton,
          track,
        }),
      ],
    });

  it("writes a batch of user + predicted frames that round-trip", async () => {
    const pred = new LabeledFrame({
      video,
      frameIdx: 1,
      instances: [
        new PredictedInstance({
          points: [
            { xy: [5, 6], visible: true, complete: true, score: 0.9 },
            { xy: [7, 8], visible: true, complete: true, score: 0.8 },
          ],
          skeleton,
          score: 0.7,
        }),
      ],
    });

    const writer = await openSlpWriter({
      skeletons: [skeleton],
      videos: [video],
      tracks: [track],
    });
    writer.appendFrames([mkUser(0, 1), pred]);
    const rt = await readSlp(new Uint8Array(writer.close()).buffer, {
      openVideos: false,
    });

    expect(rt.labeledFrames.length).toBe(2);
    const f0 = rt.labeledFrames.find((f) => f.frameIdx === 0)!;
    const f1 = rt.labeledFrames.find((f) => f.frameIdx === 1)!;
    expect(f0.instances[0].points.map((p) => p.xy)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(f0.instances[0].track?.name).toBe("t0");
    expect(f1.instances[0].constructor.name).toContain("Predicted");
    expect(f1.instances[0].points.map((p) => p.xy)).toEqual([
      [5, 6],
      [7, 8],
    ]);
  });

  it("interleaves appendStore (bulk) with appendFrames (overlay edits)", async () => {
    const eager = await readSlp(FIX, { openVideos: false });
    const s = await store(FIX);

    const writer = await openSlpWriter({
      skeletons: s.skeletons,
      videos: [...s.videos, video], // store's video(s) + the overlay video
      tracks: [...s.tracks, track],
    });
    writer.appendStore(s); // bulk lazy frames onto video 0
    writer.appendFrames([mkUser(0, 100), mkUser(1, 200)]); // 2 extra frames on the overlay video
    const rt = await readSlp(new Uint8Array(writer.close()).buffer, {
      openVideos: false,
    });

    expect(rt.videos.length).toBe(s.videos.length + 1);
    expect(rt.labeledFrames.length).toBe(eager.labeledFrames.length + 2);
    // The two overlay frames landed on the last video with the right points.
    const overlayIdx = rt.videos.length - 1;
    const overlay = rt.labeledFrames.filter(
      (f) => rt.videos.indexOf(f.video) === overlayIdx,
    );
    expect(overlay.length).toBe(2);
    expect(overlay.map((f) => f.instances[0].points[0].xy[0]).sort()).toEqual([
      100, 200,
    ]);
  });
});

describe("writeToSink / saveSlpMergedToSink — streamed output", () => {
  it("writeToSink streams a valid file in multiple chunks", async () => {
    const s = await store(FIX);
    const eager = await readSlp(FIX, { openVideos: false });

    const writer = await openSlpWriter({
      skeletons: s.skeletons,
      videos: s.videos,
      tracks: s.tracks,
    });
    writer.appendStore(s);
    const collected = collectingSink();
    await writer.writeToSink(collected.sink, { chunkBytes: 64 * 1024 });

    expect(collected.closed).toBe(true);
    expect(collected.chunkCount).toBeGreaterThan(1); // actually chunked
    // The streamed bytes are a valid SLP that round-trips frame-for-frame.
    const rt = await readSlp(new Uint8Array(collected.bytes()).buffer, {
      openVideos: false,
    });
    expect(rt.labeledFrames.length).toBe(eager.labeledFrames.length);
    expect(rt.labeledFrames.map(frameSig)).toEqual(
      eager.labeledFrames.map(frameSig),
    );
  });

  it("saveSlpMergedToSink streams a merged multi-video file", async () => {
    const collected = collectingSink();
    await saveSlpMergedToSink(
      [await store(FIX), await store(FIX)],
      collected.sink,
      { chunkBytes: 128 * 1024 },
    );
    expect(collected.closed).toBe(true);
    const merged = await readSlp(new Uint8Array(collected.bytes()).buffer, {
      openVideos: false,
    });
    expect(merged.videos.length).toBe(2);
    const eager = await readSlp(FIX, { openVideos: false });
    expect(merged.labeledFrames.length).toBe(2 * eager.labeledFrames.length);
  });
});

describe("annotation overlays (masks / rois)", () => {
  it("carries a store's per-frame masks + rois through appendStore", async () => {
    // Build a Labels with a frame-bound mask + roi, save eager, read lazy so the
    // store carries the annotation maps.
    const video = new Video({ filename: "ann.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [0, 0] }, skeleton });
    const mask = UserSegmentationMask.fromArray(new Uint8Array(16), 4, 4, {
      name: "m1",
      category: "cell",
    });
    const roi = UserROI.fromBbox(0, 0, 50, 50, { category: "box" });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 3,
          instances: [inst],
          masks: [mask],
          rois: [roi],
        }),
      ],
    });
    const lazy = await readSlpLazy(
      new Uint8Array(await saveSlpToBytes(labels)).buffer,
      { openVideos: false },
    );
    const s = lazy._lazyDataStore!;

    const writer = await openSlpWriter({
      skeletons: s.skeletons,
      videos: s.videos,
      tracks: s.tracks,
    });
    writer.appendStore(s);
    const rt = await readSlp(new Uint8Array(writer.close()).buffer, {
      openVideos: false,
    });

    const f = rt.labeledFrames.find((x) => x.frameIdx === 3)!;
    expect(f.masks).toHaveLength(1);
    expect(f.masks[0].name).toBe("m1");
    expect(f.masks[0].category).toBe("cell");
    expect(f.rois).toHaveLength(1);
  });

  it("carries masks from appendFrames (materialized overlay)", async () => {
    const video = new Video({ filename: "ann.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [0, 0] }, skeleton });
    const mask = UserSegmentationMask.fromArray(new Uint8Array(16), 4, 4, {
      name: "mm",
      category: "cell",
    });
    const frame = new LabeledFrame({
      video,
      frameIdx: 7,
      instances: [inst],
      masks: [mask],
    });
    const writer = await openSlpWriter({
      skeletons: [skeleton],
      videos: [video],
      tracks: [],
    });
    writer.appendFrames([frame]);
    const rt = await readSlp(new Uint8Array(writer.close()).buffer, {
      openVideos: false,
    });

    const f = rt.labeledFrames.find((x) => x.frameIdx === 7)!;
    expect(f.masks).toHaveLength(1);
    expect(f.masks[0].name).toBe("mm");
  });
});
