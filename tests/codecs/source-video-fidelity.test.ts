/**
 * `source_video` lineage fidelity across a save/reload (issue #160).
 *
 * A video's `source_video` must round-trip with its recorded shape (and any
 * deeper chain), not filename-only, so `_getEffectiveShape` can resolve an
 * embedded subset's full frame extent after a real reload — the prerequisite
 * for the embedded-subset -> restore-original matching workflow. These tests
 * exercise the shared reconstruction helper, the eager reader against real
 * Python-written `.pkg.slp` fixtures (source in the HDF5 group and/or nested in
 * videos_json), the streaming group reader, and a full JS -> JS round-trip.
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadSlp } from "../../src/io/main.js";
import { saveSlpToBytes } from "../../src/codecs/slp/write.js";
import { readSlp } from "../../src/codecs/slp/read.js";
import { Video } from "../../src/model/video.js";
import { Instance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Labels } from "../../src/model/labels.js";
import {
  _getEffectiveShape,
  shapesCompatible,
} from "../../src/model/matching.js";
import { buildSourceVideoFromDict } from "../../src/codecs/slp/source-video.js";
import { readSourceVideoGroupJsonStreaming } from "../../src/codecs/slp/read-streaming.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const slp = (name: string) => path.join(fixtureRoot, "slp", name);

describe("buildSourceVideoFromDict", () => {
  it("recovers shape and a multi-level chain, backend left unopened", () => {
    const dict = {
      filename: "subset.pkg.slp",
      backend: { shape: [27, 384, 384, 1], filename: "subset.pkg.slp" },
      source_video: {
        filename: "original.mp4",
        backend: {
          type: "MediaVideo",
          shape: [80, 384, 384, 1],
          filename: "original.mp4",
        },
      },
    };
    const v = buildSourceVideoFromDict(dict);
    expect(v.backend).toBeNull(); // metadata-only; never opens the lineage file
    expect(v.shape).toEqual([27, 384, 384, 1]);
    expect(v.sourceVideo).not.toBeNull();
    expect(v.sourceVideo?.shape).toEqual([80, 384, 384, 1]);
    // The video's OWN shape is the subset extent...
    expect(v.shape).toEqual([27, 384, 384, 1]);
    // ...but _getEffectiveShape walks source-first, resolving to the source's
    // full extent (the point of the source chain for matching).
    expect(_getEffectiveShape(v)).toEqual([80, 384, 384, 1]);
  });

  it("resolves a '.' self-reference to the labels path", () => {
    const v = buildSourceVideoFromDict(
      { backend: { filename: ".", dataset: "video0/video" } },
      "/data/project.pkg.slp",
    );
    expect(v.filename).toBe("/data/project.pkg.slp");
    expect(v.hasEmbeddedImages).toBe(true);
  });

  it("falls back to the top-level filename when backend.filename is absent", () => {
    const v = buildSourceVideoFromDict({ filename: "bare.mp4", backend: {} });
    expect(v.filename).toBe("bare.mp4");
    expect(v.shape).toBeNull();
  });
});

describe("readSourceVideoGroupJsonStreaming", () => {
  const blob =
    '{"filename":"o.mp4","backend":{"shape":[80,384,384,1],"filename":"o.mp4"}}';

  it("reads the json attribute (normal case)", async () => {
    const file = {
      getKeys: async () => [],
      getAttrs: async (p: string) =>
        p === "video0/source_video" ? { json: blob } : {},
      getDatasetValue: async () => {
        throw new Error("no dataset");
      },
    };
    const dict = await readSourceVideoGroupJsonStreaming(file, "video0");
    expect(dict).not.toBeNull();
    expect((dict?.backend as any).shape).toEqual([80, 384, 384, 1]);
  });

  it("prefers the json dataset when present (oversized metadata)", async () => {
    const file = {
      getKeys: async () => ["json"],
      getAttrs: async () => ({}),
      getDatasetValue: async () => ({ value: blob, shape: [1], dtype: "S" }),
    };
    const dict = await readSourceVideoGroupJsonStreaming(file, "video0");
    expect((dict?.backend as any).shape).toEqual([80, 384, 384, 1]);
  });

  it("returns null when the group is absent", async () => {
    const file = {
      getKeys: async () => [],
      getAttrs: async () => ({}),
      getDatasetValue: async () => {
        throw new Error("no dataset");
      },
    };
    expect(await readSourceVideoGroupJsonStreaming(file, "video0")).toBeNull();
  });
});

describe("eager reader recovers source_video lineage from fixtures", () => {
  it("cropped_format_2_3.pkg.slp: source shape + chain from the nested videos_json dict", async () => {
    const labels = await readSlp(slp("cropped_format_2_3.pkg.slp"), {
      openVideos: false,
    });
    const v = labels.videos[0];
    // The video itself is a 192x256 crop of a 384x384 source.
    expect(v.shape).toEqual([1, 192, 256, 1]);
    expect(v.sourceVideo).not.toBeNull();
    expect(v.sourceVideo?.shape).toEqual([1, 384, 384, 1]);
    // Two-level chain: crop -> embedded subset -> original mp4.
    expect(v.sourceVideo?.sourceVideo).not.toBeNull();
    // Effective shape resolves to the uncropped source, not the cropped facade.
    expect(_getEffectiveShape(v)).toEqual([1, 384, 384, 1]);
  });

  it("minimal_instance.pkg.slp: source recovered from the {group}/source_video HDF5 group", async () => {
    const labels = await readSlp(slp("minimal_instance.pkg.slp"), {
      openVideos: false,
    });
    const v = labels.videos[0];
    // videos_json for this older file carries NO source_video; it lives only in
    // the HDF5 group. Before the fix, sourceVideo was dropped entirely.
    expect(v.sourceVideo).not.toBeNull();
    expect(String(v.sourceVideo?.filename)).toContain(".mp4");
  });
});

describe("#160 end-to-end: embedded subset -> restore-original matching survives a reload", () => {
  it("recovers the source's full shape and pairs the subset with the restored original", async () => {
    // An embedded pkg whose frames we can re-embed.
    const labels = await loadSlp(slp("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const subset = labels.videos[0];

    // Model the workflow: this embedded video is a SUBSET of a larger (80-frame)
    // original. Attach the original as its source (full extent in metadata).
    subset.sourceVideo = new Video({
      filename: "the_original.mp4",
      backendMetadata: { shape: [80, 384, 384, 1] },
    });
    expect(_getEffectiveShape(subset)).toEqual([80, 384, 384, 1]);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sleap-160-"));
    try {
      const tmpFile = path.join(tmpDir, "subset.pkg.slp");
      fs.writeFileSync(tmpFile, await saveSlpToBytes(labels, { embed: true }));

      const reloaded = await readSlp(tmpFile, { openVideos: false });
      const rv = reloaded.videos[0];
      expect(rv.hasEmbeddedImages).toBe(true);
      expect(rv.sourceVideo).not.toBeNull();
      // The source's full frame extent survives the round-trip...
      expect(rv.sourceVideo?.shape).toEqual([80, 384, 384, 1]);
      expect(_getEffectiveShape(rv)).toEqual([80, 384, 384, 1]);

      // ...so the restored original (80 frames) is judged compatible with the
      // subset instead of being rejected on the subset's own frame count.
      const restoredOriginal = new Video({
        filename: "the_original.mp4",
        backendMetadata: { shape: [80, 384, 384, 1] },
      });
      expect(shapesCompatible(rv, restoredOriginal)).toBe(true);

      // The authoritative HDF5 group (what Python reads for embedded videos) is
      // written, not only the videos_json nested dict.
      const { openH5File } = await import("../../src/codecs/slp/h5.js");
      const { file, close } = await openH5File(tmpFile);
      try {
        expect(file.get("video0/source_video")).not.toBeNull();
      } finally {
        close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("non-embedded videos_json source_video round-trip", () => {
  it("serializes and recovers a source with shape via the nested videos_json dict", async () => {
    const source = new Video({
      filename: "original.mp4",
      backendMetadata: { shape: [80, 384, 384, 1] },
    });
    const video = new Video({ filename: "derived.mp4", sourceVideo: source });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [1, 2], B: [3, 4] }, skeleton });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({ video, frameIdx: 0, instances: [inst] }),
      ],
      videos: [video],
      skeletons: [skeleton],
    });

    const bytes = await saveSlpToBytes(labels); // no embedding
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });
    const rv = reloaded.videos[0];
    expect(rv.hasEmbeddedImages).toBe(false);
    expect(rv.sourceVideo).not.toBeNull();
    expect(rv.sourceVideo?.shape).toEqual([80, 384, 384, 1]);
    expect(_getEffectiveShape(rv)).toEqual([80, 384, 384, 1]);
  });
});
