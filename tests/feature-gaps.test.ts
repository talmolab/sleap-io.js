/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlp, saveSlpToBytes } from "../src/io/main.js";
import { readSlp } from "../src/codecs/slp/read.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance, PredictedInstance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

async function loadFixture(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false });
}

async function loadFixtureLazy(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false, lazy: true });
}

describe("Unit 1: Source Video Restoration Mode", () => {
  it("embed='source' restores sourceVideo paths", async () => {
    const sourceVideo = new Video({ filename: "original.mp4" });
    const embeddedVideo = new Video({ filename: ".", embedded: true, sourceVideo });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    const frame = new LabeledFrame({ video: embeddedVideo, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [embeddedVideo],
      skeletons: [skeleton],
    });

    const bytes = await saveSlpToBytes(labels, { embed: "source" });
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.videos[0].filename).toBe("original.mp4");
    expect(reloaded.videos[0].hasEmbeddedImages).toBe(false);
  });

  it("embed='source' keeps original video when no sourceVideo", async () => {
    const video = new Video({ filename: "video.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const inst = new Instance({ points: { A: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
    });

    const bytes = await saveSlpToBytes(labels, { embed: "source" });
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.videos[0].filename).toBe("video.mp4");
  });

  it("embed='source' does not embed frame data", async () => {
    const labels = await loadFixture("minimal_instance.slp");
    const bytes = await saveSlpToBytes(labels, { embed: "source" });
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.videos[0].hasEmbeddedImages).toBe(false);
    expect(reloaded.labeledFrames.length).toBe(labels.labeledFrames.length);
  });

  it("embed='source' with multiple videos restores only those with sourceVideo", async () => {
    const sourceVideo = new Video({ filename: "original.mp4" });
    const embeddedVideo = new Video({ filename: ".", embedded: true, sourceVideo });
    const plainVideo = new Video({ filename: "other.mp4" });
    const skeleton = new Skeleton({ nodes: ["X"] });
    const inst1 = new Instance({ points: { X: [5, 5] }, skeleton });
    const inst2 = new Instance({ points: { X: [15, 25] }, skeleton });
    const frame1 = new LabeledFrame({ video: embeddedVideo, frameIdx: 0, instances: [inst1] });
    const frame2 = new LabeledFrame({ video: plainVideo, frameIdx: 0, instances: [inst2] });
    const labels = new Labels({
      labeledFrames: [frame1, frame2],
      videos: [embeddedVideo, plainVideo],
      skeletons: [skeleton],
    });

    const bytes = await saveSlpToBytes(labels, { embed: "source" });
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.videos[0].filename).toBe("original.mp4");
    expect(reloaded.videos[1].filename).toBe("other.mp4");
  });
});

describe("Unit 2: Format 1.2 tracking_score Handling", () => {
  it("tracking_score defaults to 0 for current format files", async () => {
    const labels = await loadFixture("typical.slp");
    for (const frame of labels.labeledFrames) {
      for (const inst of frame.instances) {
        expect(inst.trackingScore).toBe(0);
      }
    }
  });

  it("tracking_score round-trips through write/read", async () => {
    const skeleton = new Skeleton({ nodes: ["A"] });
    const video = new Video({ filename: "test.mp4" });
    const inst = new Instance({
      points: { A: [10, 20] },
      skeleton,
      trackingScore: 0.75,
    });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
    });

    const bytes = await saveSlpToBytes(labels);
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.labeledFrames[0].instances[0].trackingScore).toBeCloseTo(0.75);
  });

  it("tracking_score defaults to 0 for PredictedInstance", async () => {
    const skeleton = new Skeleton({ nodes: ["A"] });
    const video = new Video({ filename: "test.mp4" });
    const inst = new PredictedInstance({
      points: { A: { xy: [10, 20], score: 0.9 } },
      skeleton,
      score: 0.95,
    });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
    });

    const bytes = await saveSlpToBytes(labels);
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.labeledFrames[0].instances[0].trackingScore).toBe(0);
  });

  it("lazy mode also gets correct tracking_score", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const frame = lazy._lazyFrameList!.at(0);
    expect(frame).toBeDefined();
    for (const inst of frame!.instances) {
      expect(inst.trackingScore).toBe(0);
    }
  });
});

describe("Unit 3: Lazy toNumpy() Fast Path", () => {
  it("lazy numpy() matches eager numpy() output", async () => {
    const eager = await loadFixture("typical.slp");
    const lazy = await loadFixtureLazy("typical.slp");

    const eagerNumpy = eager.numpy();
    const lazyNumpy = lazy.numpy();

    expect(lazyNumpy.length).toBe(eagerNumpy.length);
    expect(lazyNumpy.length).toBeGreaterThan(0);

    // Check dimensions match
    expect(lazyNumpy[0].length).toBe(eagerNumpy[0].length);
    expect(lazyNumpy[0][0].length).toBe(eagerNumpy[0][0].length);
    expect(lazyNumpy[0][0][0].length).toBe(eagerNumpy[0][0][0].length);

    // Deep compare values (NaN === NaN for our purposes)
    for (let f = 0; f < eagerNumpy.length; f++) {
      for (let t = 0; t < eagerNumpy[f].length; t++) {
        for (let n = 0; n < eagerNumpy[f][t].length; n++) {
          for (let c = 0; c < eagerNumpy[f][t][n].length; c++) {
            const ev = eagerNumpy[f][t][n][c];
            const lv = lazyNumpy[f][t][n][c];
            if (Number.isNaN(ev)) {
              expect(Number.isNaN(lv)).toBe(true);
            } else {
              expect(lv).toBeCloseTo(ev);
            }
          }
        }
      }
    }
  });

  it("lazy numpy() with predictions matches eager", async () => {
    const eager = await loadFixture("centered_pair_predictions.slp");
    const lazy = await loadFixtureLazy("centered_pair_predictions.slp");

    const eagerNumpy = eager.numpy();
    const lazyNumpy = lazy.numpy();

    expect(lazyNumpy.length).toBe(eagerNumpy.length);

    // Spot-check a few frames
    for (let f = 0; f < Math.min(5, eagerNumpy.length); f++) {
      for (let t = 0; t < eagerNumpy[f].length; t++) {
        for (let n = 0; n < eagerNumpy[f][t].length; n++) {
          for (let c = 0; c < eagerNumpy[f][t][n].length; c++) {
            const ev = eagerNumpy[f][t][n][c];
            const lv = lazyNumpy[f][t][n][c];
            if (Number.isNaN(ev)) {
              expect(Number.isNaN(lv)).toBe(true);
            } else {
              expect(lv).toBeCloseTo(ev);
            }
          }
        }
      }
    }
  });

  it("lazy numpy() with returnConfidence matches eager", async () => {
    const eager = await loadFixture("centered_pair_predictions.slp");
    const lazy = await loadFixtureLazy("centered_pair_predictions.slp");

    const eagerNumpy = eager.numpy({ returnConfidence: true });
    const lazyNumpy = lazy.numpy({ returnConfidence: true });

    expect(lazyNumpy.length).toBe(eagerNumpy.length);
    // Verify 3rd channel (confidence) is present
    expect(lazyNumpy[0][0][0].length).toBe(3);

    // Spot-check
    for (let f = 0; f < Math.min(3, eagerNumpy.length); f++) {
      for (let t = 0; t < eagerNumpy[f].length; t++) {
        for (let n = 0; n < eagerNumpy[f][t].length; n++) {
          for (let c = 0; c < 3; c++) {
            const ev = eagerNumpy[f][t][n][c];
            const lv = lazyNumpy[f][t][n][c];
            if (Number.isNaN(ev)) {
              expect(Number.isNaN(lv)).toBe(true);
            } else {
              expect(lv).toBeCloseTo(ev);
            }
          }
        }
      }
    }
  });

  it("lazy numpy() does not materialize frames", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy.isLazy).toBe(true);

    lazy.numpy();

    // Should still be lazy — no materialization needed
    expect(lazy.isLazy).toBe(true);
    expect(lazy._lazyFrameList!.materializedCount).toBe(0);
  });

  it("lazy numpy() returns empty for non-existent video", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const fakeVideo = new Video({ filename: "nonexistent.mp4" });
    const result = lazy.numpy({ video: fakeVideo });
    expect(result).toEqual([]);
  });

  it("lazy toNumpy() on empty store returns empty", async () => {
    const { LazyDataStore } = await import("../src/model/lazy.js");
    const store = new LazyDataStore({
      framesData: { frame_id: [], video: [], frame_idx: [], instance_id_start: [], instance_id_end: [] },
      instancesData: { instance_type: [], skeleton: [], track: [], point_id_start: [], point_id_end: [], score: [], tracking_score: [], from_predicted: [] },
      pointsData: { x: [], y: [], visible: [], complete: [] },
      predPointsData: { x: [], y: [], visible: [], complete: [], score: [] },
      skeletons: [new Skeleton({ nodes: ["A"] })],
      tracks: [],
      videos: [new Video({ filename: "test.mp4" })],
      formatId: 1.4,
    });

    const result = store.toNumpy();
    expect(result).toEqual([]);
  });
});
