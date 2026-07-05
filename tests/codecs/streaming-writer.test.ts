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
} from "../../src/codecs/slp/write.js";
import type { LabeledFrame } from "../../src/model/labeled-frame.js";

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
