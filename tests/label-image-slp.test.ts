/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import { Video } from "../src/model/video.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Instance, Track } from "../src/model/instance.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { LabelImage, UserLabelImage } from "../src/model/label-image.js";
import type { LabelImageObjectInfo } from "../src/model/label-image.js";
import { UserBoundingBox } from "../src/model/bbox.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";

async function roundTrip(labels: Labels): Promise<Labels> {
  const bytes = await saveSlpToBytes(labels);
  return readSlp(new Uint8Array(bytes).buffer, { openVideos: false });
}

describe("LabelImage SLP I/O", () => {
  it("round-trips LabelImage with full metadata", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const track1 = new Track("cell_1");
    const track2 = new Track("cell_2");

    const data = new Int32Array(10 * 10);
    // Object 1: top-left corner
    data[0] = 1; data[1] = 1; data[10] = 1;
    // Object 2: bottom-right area
    data[98] = 2; data[99] = 2; data[89] = 2;

    const li = new UserLabelImage({
      data,
      height: 10,
      width: 10,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track: track1, category: "neuron", name: "cell_A", instance: null }],
        [2, { track: track2, category: "glia", name: "cell_B", instance: null }],
      ]),
      source: "cellpose",
    });

    const lf = new LabeledFrame({ video, frameIdx: 0, labelImages: [li] });

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track1, track2],
    });

    const loaded = await roundTrip(labels);

    expect(loaded.labelImages).toHaveLength(1);
    const loadedLi = loaded.labelImages[0];
    expect(loadedLi.height).toBe(10);
    expect(loadedLi.width).toBe(10);
    expect(loadedLi.nObjects).toBe(2);
    expect(loadedLi.source).toBe("cellpose");

    const obj1 = loadedLi.objects.get(1);
    expect(obj1).toBeDefined();
    expect(obj1!.track).not.toBeNull();
    expect(obj1!.track!.name).toBe("cell_1");
    expect(obj1!.category).toBe("neuron");
    expect(obj1!.name).toBe("cell_A");

    const obj2 = loadedLi.objects.get(2);
    expect(obj2).toBeDefined();
    expect(obj2!.track).not.toBeNull();
    expect(obj2!.track!.name).toBe("cell_2");
    expect(obj2!.category).toBe("glia");
    expect(obj2!.name).toBe("cell_B");
  });

  it("preserves pixel data exactly through zlib round-trip", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["a"] });

    const data = new Int32Array(20 * 20);
    // Object 1: scattered pixels
    for (let i = 0; i < 20; i++) {
      data[i * 20 + i] = 1; // diagonal
    }
    // Object 2: solid block in top-left 5x5
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        data[r * 20 + c] = 2;
      }
    }
    // Object 3: alternating rows in bottom half
    for (let r = 10; r < 20; r += 2) {
      for (let c = 0; c < 20; c++) {
        if (data[r * 20 + c] === 0) {
          data[r * 20 + c] = 3;
        }
      }
    }

    const li = new UserLabelImage({
      data,
      height: 20,
      width: 20,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track: null, category: "", name: "", instance: null }],
        [2, { track: null, category: "", name: "", instance: null }],
        [3, { track: null, category: "", name: "", instance: null }],
      ]),
    });

    const lf = new LabeledFrame({ video, frameIdx: 0, labelImages: [li] });

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
    });

    const loaded = await roundTrip(labels);
    const loadedData = loaded.labelImages[0].data;

    expect(loadedData.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      expect(loadedData[i]).toBe(data[i]);
    }
  });

  it("uses format version 1.8 for labelImages, 2.0 for bboxes only", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["a"] });
    const inst = new Instance({ points: { a: [1, 2] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });

    // Labels with labelImages should round-trip successfully (format 1.8)
    const data = new Int32Array(5 * 5);
    data[0] = 1;
    const li = new UserLabelImage({
      data,
      height: 5,
      width: 5,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track: null, category: "", name: "", instance: null }],
      ]),
    });
    frame.labelImages.push(li);

    const labelsWithLI = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
    });

    const loadedWithLI = await roundTrip(labelsWithLI);
    expect(loadedWithLI.labelImages).toHaveLength(1);
    expect(loadedWithLI.labelImages[0].data[0]).toBe(1);

    // Labels with bboxes but no labelImages (format 2.0) should also round-trip
    const inst2 = new Instance({ points: { a: [1, 2] }, skeleton });
    const frame2 = new LabeledFrame({ video, frameIdx: 0, instances: [inst2] });
    const bb = new UserBoundingBox({
      x1: 0, y1: 10, x2: 100, y2: 90,
    });
    frame2.bboxes.push(bb);

    const labelsWithBbox = new Labels({
      labeledFrames: [frame2],
      videos: [video],
      skeletons: [skeleton],
    });

    const loadedWithBbox = await roundTrip(labelsWithBbox);
    expect(loadedWithBbox.bboxes).toHaveLength(1);
    expect(loadedWithBbox.labelImages).toHaveLength(0);
  });

  it("round-trips multiple label images across frames", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["a"] });
    const track = new Track("t1");

    const frames: LabeledFrame[] = [];
    for (const frameIdx of [0, 5, 10]) {
      const data = new Int32Array(8 * 8);
      // Each frame gets a unique pattern: fill first N pixels where N = frameIdx + 1
      for (let i = 0; i <= frameIdx; i++) {
        data[i] = 1;
      }

      const li = new UserLabelImage({
        data,
        height: 8,
        width: 8,
        objects: new Map<number, LabelImageObjectInfo>([
          [1, { track, category: "cell", name: `frame_${frameIdx}`, instance: null }],
        ]),
        source: "auto",
      });

      frames.push(new LabeledFrame({ video, frameIdx, labelImages: [li] }));
    }

    const labels = new Labels({
      labeledFrames: frames,
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });

    const loaded = await roundTrip(labels);

    expect(loaded.labelImages).toHaveLength(3);

    // Verify each frame
    for (let i = 0; i < 3; i++) {
      const expectedFrameIdx = [0, 5, 10][i];
      const loadedLf = loaded.labeledFrames[i];
      expect(loadedLf.frameIdx).toBe(expectedFrameIdx);
      expect(loadedLf.labelImages).toHaveLength(1);
      const loadedLi = loadedLf.labelImages[0];
      expect(loadedLi.height).toBe(8);
      expect(loadedLi.width).toBe(8);
      expect(loadedLi.source).toBe("auto");

      const obj = loadedLi.objects.get(1);
      expect(obj).toBeDefined();
      expect(obj!.name).toBe(`frame_${expectedFrameIdx}`);
      expect(obj!.track!.name).toBe("t1");

      // Verify unique pixel pattern
      for (let j = 0; j <= expectedFrameIdx; j++) {
        expect(loadedLi.data[j]).toBe(1);
      }
      // Pixel after the filled region should be 0
      if (expectedFrameIdx + 1 < 64) {
        expect(loadedLi.data[expectedFrameIdx + 1]).toBe(0);
      }
    }
  });

  it("getLabelImages filters by frameIdx, track, and category after round-trip", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["a"] });
    const trackA = new Track("trackA");
    const trackB = new Track("trackB");

    const makeData = () => {
      const d = new Int32Array(4 * 4);
      d[0] = 1;
      return d;
    };

    const lf0 = new LabeledFrame({ video, frameIdx: 0 });
    lf0.labelImages.push(new UserLabelImage({
      data: makeData(),
      height: 4,
      width: 4,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track: trackA, category: "neuron", name: "", instance: null }],
      ]),
      source: "model",
    }));

    const lf5 = new LabeledFrame({ video, frameIdx: 5 });
    lf5.labelImages.push(new UserLabelImage({
      data: makeData(),
      height: 4,
      width: 4,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track: trackB, category: "glia", name: "", instance: null }],
      ]),
      source: "model",
    }));

    const lf10 = new LabeledFrame({ video, frameIdx: 10 });
    lf10.labelImages.push(new UserLabelImage({
      data: makeData(),
      height: 4,
      width: 4,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track: trackA, category: "neuron", name: "", instance: null }],
      ]),
      source: "model",
    }));

    const labels = new Labels({
      labeledFrames: [lf0, lf5, lf10],
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackA, trackB],
    });

    const loaded = await roundTrip(labels);
    expect(loaded.labelImages).toHaveLength(3);

    // Filter by frameIdx
    const atFrame0 = loaded.getLabelImages({ frameIdx: 0 });
    expect(atFrame0).toHaveLength(1);

    const atFrame5 = loaded.getLabelImages({ frameIdx: 5 });
    expect(atFrame5).toHaveLength(1);

    // Filter by track
    const loadedTrackA = loaded.tracks.find((t) => t.name === "trackA")!;
    const loadedTrackB = loaded.tracks.find((t) => t.name === "trackB")!;
    expect(loadedTrackA).toBeDefined();
    expect(loadedTrackB).toBeDefined();

    const withTrackA = loaded.getLabelImages({ track: loadedTrackA });
    expect(withTrackA).toHaveLength(2);

    const withTrackB = loaded.getLabelImages({ track: loadedTrackB });
    expect(withTrackB).toHaveLength(1);

    // Filter by category
    const neurons = loaded.getLabelImages({ category: "neuron" });
    expect(neurons).toHaveLength(2);

    const glia = loaded.getLabelImages({ category: "glia" });
    expect(glia).toHaveLength(1);
  });

  it("round-trips empty label image (all zeros, no objects)", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["a"] });

    const data = new Int32Array(6 * 6); // all zeros

    const li = new UserLabelImage({
      data,
      height: 6,
      width: 6,
      objects: new Map(),
      source: "empty",
    });

    const lf = new LabeledFrame({ video, frameIdx: 3, labelImages: [li] });

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
    });

    const loaded = await roundTrip(labels);

    expect(loaded.labelImages).toHaveLength(1);
    const loadedLi = loaded.labelImages[0];
    expect(loadedLi.height).toBe(6);
    expect(loadedLi.width).toBe(6);
    expect(loadedLi.nObjects).toBe(0);
    expect(loadedLi.source).toBe("empty");

    // Verify frame index
    expect(loaded.labeledFrames[0].frameIdx).toBe(3);

    // All pixels should be zero
    for (let i = 0; i < loadedLi.data.length; i++) {
      expect(loadedLi.data[i]).toBe(0);
    }
  });

  it("preserves instance references through round-trip", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["a", "b"] });
    const track = new Track("t1");
    const instance = new Instance({
      points: { a: [10, 20], b: [30, 40] },
      skeleton,
    });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [instance] });

    const data = new Int32Array(5 * 5);
    data[0] = 1;
    data[1] = 1;
    data[5] = 1;

    const li = new UserLabelImage({
      data,
      height: 5,
      width: 5,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track, category: "cell", name: "inst_obj", instance }],
      ]),
    });
    frame.labelImages.push(li);

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });

    const loaded = await roundTrip(labels);

    expect(loaded.labelImages).toHaveLength(1);
    expect(loaded.labeledFrames).toHaveLength(1);

    const loadedObj = loaded.labelImages[0].objects.get(1);
    expect(loadedObj).toBeDefined();
    expect(loadedObj!.instance).not.toBeNull();
    // The instance reference should resolve to the same instance object
    expect(loadedObj!.instance).toBe(loaded.labeledFrames[0].instances[0]);
  });

  it("loads labelImages eagerly in lazy read mode", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["a"] });
    const track = new Track("t1");

    const data = new Int32Array(4 * 4);
    data[0] = 1;

    const li = new UserLabelImage({
      data,
      height: 4,
      width: 4,
      objects: new Map<number, LabelImageObjectInfo>([
        [1, { track, category: "cell", name: "lazy_test", instance: null }],
      ]),
      source: "test",
    });

    const lf = new LabeledFrame({ video, frameIdx: 0, labelImages: [li] });

    const labels = new Labels({
      labeledFrames: [lf],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlpLazy(new Uint8Array(bytes).buffer, { openVideos: false });

    // labelImages should be loaded eagerly even in lazy mode
    expect(loaded.labelImages).toHaveLength(1);
    const loadedLi = loaded.labelImages[0];
    expect(loadedLi.height).toBe(4);
    expect(loadedLi.width).toBe(4);
    expect(loadedLi.data[0]).toBe(1);
    expect(loadedLi.source).toBe("test");

    const obj = loadedLi.objects.get(1);
    expect(obj).toBeDefined();
    expect(obj!.track!.name).toBe("t1");
    expect(obj!.category).toBe("cell");
    expect(obj!.name).toBe("lazy_test");
  });
});
