/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlp, saveSlpToBytes } from "../src/io/main.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance, PredictedInstance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ready, File as H5File } from "h5wasm/node";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

async function loadFixture(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false });
}

describe("saveSlpToBytes", () => {
  it("returns a Uint8Array", async () => {
    const skeleton = new Skeleton({ name: "test", nodes: ["A", "B"] });
    const video = new Video({ filename: "test.mp4" });
    const instance = new Instance({
      skeleton,
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [30, 40], visible: true, complete: true },
      ],
    });
    const labeledFrame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instance],
    });
    const labels = new Labels({
      skeletons: [skeleton],
      videos: [video],
      labeledFrames: [labeledFrame],
    });

    const bytes = await saveSlpToBytes(labels);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // HDF5 files start with the magic bytes \x89HDF
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x48); // H
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  });

  it("round-trips Labels through saveSlpToBytes and loadSlp", async () => {
    const skeleton = new Skeleton({
      name: "fly",
      nodes: ["head", "thorax", "abdomen"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });
    const video = new Video({ filename: "video.mp4" });
    const instance = new Instance({
      skeleton,
      points: [
        { xy: [100, 200], visible: true, complete: true },
        { xy: [150, 250], visible: true, complete: false },
        { xy: [200, 300], visible: false, complete: false },
      ],
    });
    const labeledFrame = new LabeledFrame({
      video,
      frameIdx: 42,
      instances: [instance],
    });
    const labels = new Labels({
      skeletons: [skeleton],
      videos: [video],
      labeledFrames: [labeledFrame],
    });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await loadSlp(bytes, { openVideos: false });

    expect(loaded.skeletons.length).toBe(1);
    expect(loaded.skeletons[0].name).toBe("fly");
    expect(loaded.skeletons[0].nodeNames).toEqual(["head", "thorax", "abdomen"]);
    expect(loaded.skeletons[0].edges.length).toBe(2);
    expect(loaded.videos.length).toBe(1);
    expect(loaded.videos[0].filename).toBe("video.mp4");
    expect(loaded.labeledFrames.length).toBe(1);
    expect(loaded.labeledFrames[0].frameIdx).toBe(42);
    expect(loaded.labeledFrames[0].instances.length).toBe(1);

    const loadedInstance = loaded.labeledFrames[0].instances[0];
    expect(loadedInstance.points[0].xy[0]).toBeCloseTo(100);
    expect(loadedInstance.points[0].xy[1]).toBeCloseTo(200);
    expect(loadedInstance.points[1].xy[0]).toBeCloseTo(150);
    expect(loadedInstance.points[1].xy[1]).toBeCloseTo(250);
    expect(loadedInstance.points[2].visible).toBe(false);
  });

  it("round-trips a fixture file", async () => {
    const original = await loadFixture("typical.slp");
    const bytes = await saveSlpToBytes(original);
    const loaded = await loadSlp(bytes, { openVideos: false });

    expect(loaded.skeletons.length).toBe(original.skeletons.length);
    expect(loaded.videos.length).toBe(original.videos.length);
    expect(loaded.labeledFrames.length).toBe(original.labeledFrames.length);
    expect(loaded.tracks.length).toBe(original.tracks.length);

    for (let i = 0; i < original.labeledFrames.length; i++) {
      expect(loaded.labeledFrames[i].frameIdx).toBe(original.labeledFrames[i].frameIdx);
      expect(loaded.labeledFrames[i].instances.length).toBe(original.labeledFrames[i].instances.length);
    }
  });

  it("writes string attributes as bytes for Python compatibility (#76)", async () => {
    const skeleton = new Skeleton({ name: "test", nodes: ["A", "B"] });
    const video = new Video({ filename: "test.mp4" });
    const instance = new Instance({
      skeleton,
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [30, 40], visible: true, complete: true },
      ],
    });
    const labeledFrame = new LabeledFrame({
      video,
      frameIdx: 0,
      instances: [instance],
    });
    const labels = new Labels({
      skeletons: [skeleton],
      videos: [video],
      labeledFrames: [labeledFrame],
    });

    const bytes = await saveSlpToBytes(labels);

    // Round-trip still works
    const loaded = await loadSlp(bytes, { openVideos: false });
    expect(loaded.skeletons[0].name).toBe("test");
    expect(loaded.skeletons[0].nodeNames).toEqual(["A", "B"]);

    // Open HDF5 directly and verify attributes are byte arrays, not strings
    const module = await ready;
    const memPath = `/tmp/attr_type_test_${Date.now()}.slp`;
    module.FS.writeFile(memPath, bytes);
    const file = new H5File(memPath, "r");
    try {
      const metadataGroup = file.get("metadata");
      const jsonAttr = (metadataGroup as any).attrs["json"];
      expect(jsonAttr.value).toBeInstanceOf(Uint8Array);

      const framesDs = file.get("frames");
      const fieldNamesAttr = (framesDs as any).attrs["field_names"];
      expect(fieldNamesAttr.value).toBeInstanceOf(Uint8Array);

      // Verify the byte content decodes to valid JSON
      const decoder = new TextDecoder();
      const jsonStr = decoder.decode(jsonAttr.value as Uint8Array);
      const metadata = JSON.parse(jsonStr);
      expect(metadata).toHaveProperty("version");
      expect(metadata).toHaveProperty("skeletons");

      const fieldNamesStr = decoder.decode(fieldNamesAttr.value as Uint8Array);
      const fieldNames = JSON.parse(fieldNamesStr);
      expect(fieldNames).toContain("frame_id");
    } finally {
      file.close();
      module.FS.unlink(memPath);
    }
  });
});
