/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlp } from "../src/io/main.js";
import { readSlpLazy } from "../src/codecs/slp/read.js";
import { LazyDataStore, LazyFrameList } from "../src/model/lazy.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

async function loadFixture(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false });
}

async function loadFixtureLazy(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false, lazy: true });
}

describe("Lazy Loading", () => {
  it("loadSlp with lazy=true returns Labels in lazy mode", async () => {
    const labels = await loadFixtureLazy("typical.slp");
    expect(labels.isLazy).toBe(true);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels._lazyFrameList).not.toBeNull();
  });

  it("loadSlp with lazy=false returns eager Labels", async () => {
    const labels = await loadFixture("typical.slp");
    expect(labels.isLazy).toBe(false);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels._lazyFrameList).toBeNull();
  });

  it("lazy Labels.length matches eager Labels.length", async () => {
    const eager = await loadFixture("typical.slp");
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy.length).toBe(eager.length);
  });

  it("lazy frame access materializes individual frames", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy._lazyFrameList!.materializedCount).toBe(0);

    // Access frame 0
    const frame = lazy._lazyFrameList!.at(0);
    expect(frame).toBeDefined();
    expect(frame!.instances.length).toBeGreaterThan(0);
    expect(lazy._lazyFrameList!.materializedCount).toBe(1);
  });

  it("lazy frames are cached after first access", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const frame1 = lazy._lazyFrameList!.at(0);
    const frame2 = lazy._lazyFrameList!.at(0);
    expect(frame1).toBe(frame2); // Same object reference
  });

  it("lazy iteration materializes all frames", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const frames = [];
    for (const frame of lazy) {
      frames.push(frame);
    }
    expect(frames.length).toBe(lazy.length);
    expect(frames.length).toBeGreaterThan(0);
  });

  it("materialize() converts lazy to eager", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy.isLazy).toBe(true);

    lazy.materialize();

    expect(lazy.isLazy).toBe(false);
    expect(lazy.labeledFrames.length).toBeGreaterThan(0);
    expect(lazy._lazyFrameList).toBeNull();
    expect(lazy._lazyDataStore).toBeNull();
  });

  it("materialize() is a no-op on eager Labels", async () => {
    const eager = await loadFixture("typical.slp");
    const frameCount = eager.labeledFrames.length;
    eager.materialize(); // Should not throw
    expect(eager.labeledFrames.length).toBe(frameCount);
  });

  it("lazy→eager equivalence: same frame data", async () => {
    const eager = await loadFixture("typical.slp");
    const lazy = await loadFixtureLazy("typical.slp");
    lazy.materialize();

    expect(lazy.labeledFrames.length).toBe(eager.labeledFrames.length);
    expect(lazy.videos.length).toBe(eager.videos.length);
    expect(lazy.skeletons.length).toBe(eager.skeletons.length);
    expect(lazy.tracks.length).toBe(eager.tracks.length);

    // Compare first frame's instance data
    const eagerFrame = eager.labeledFrames[0];
    const lazyFrame = lazy.labeledFrames[0];
    expect(lazyFrame.frameIdx).toBe(eagerFrame.frameIdx);
    expect(lazyFrame.instances.length).toBe(eagerFrame.instances.length);

    // Compare point data
    for (let i = 0; i < eagerFrame.instances.length; i++) {
      const eagerInst = eagerFrame.instances[i];
      const lazyInst = lazyFrame.instances[i];
      expect(lazyInst.numpy()).toEqual(eagerInst.numpy());
    }
  });

  it("lazy→eager equivalence with predictions fixture", async () => {
    const eager = await loadFixture("centered_pair_predictions.slp");
    const lazy = await loadFixtureLazy("centered_pair_predictions.slp");
    lazy.materialize();

    expect(lazy.labeledFrames.length).toBe(eager.labeledFrames.length);

    // Spot check a few frames
    for (let i = 0; i < Math.min(3, eager.labeledFrames.length); i++) {
      const eagerFrame = eager.labeledFrames[i];
      const lazyFrame = lazy.labeledFrames[i];
      expect(lazyFrame.frameIdx).toBe(eagerFrame.frameIdx);
      expect(lazyFrame.instances.length).toBe(eagerFrame.instances.length);
    }
  });

  it("metadata is available without materializing frames", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy.skeletons.length).toBeGreaterThan(0);
    expect(lazy.videos.length).toBeGreaterThan(0);
    expect(lazy.skeletons[0].nodeNames.length).toBeGreaterThan(0);

    // Frames not yet materialized
    expect(lazy._lazyFrameList!.materializedCount).toBe(0);
  });
});

describe("LazyDataStore.copy", () => {
  it("creates an independent copy with shared videos/skeletons/tracks by default", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const store = lazy._lazyDataStore!;
    const copy = store.copy();

    // Column arrays are independent copies
    expect(copy.framesData.frame_id).toEqual(store.framesData.frame_id);
    copy.framesData.frame_id![0] = 999999;
    expect(store.framesData.frame_id![0]).not.toBe(999999);

    // Negative frames are independent
    copy.negativeFrames.add("99:99");
    expect(store.negativeFrames.has("99:99")).toBe(false);

    // References are shared by default (caller replaces them)
    expect(copy.videos).toBe(store.videos);
    expect(copy.skeletons).toBe(store.skeletons);
    expect(copy.tracks).toBe(store.tracks);

    // Format ID preserved
    expect(copy.formatId).toBe(store.formatId);

    // Frame count matches
    expect(copy.frameCount).toBe(store.frameCount);
  });
});

describe("LazyDataStore", () => {
  it("frameCount matches actual frame count", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy._lazyDataStore!.frameCount).toBe(lazy.length);
  });

  it("materializeFrame returns null for out-of-bounds", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy._lazyDataStore!.materializeFrame(-1)).toBeNull();
    expect(lazy._lazyDataStore!.materializeFrame(999999)).toBeNull();
  });

  it("materializeAll returns all frames", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const allFrames = lazy._lazyDataStore!.materializeAll();
    expect(allFrames.length).toBe(lazy.length);
  });
});

describe("LazyFrameList", () => {
  it("at() returns undefined for out-of-bounds", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy._lazyFrameList!.at(-1)).toBeUndefined();
    expect(lazy._lazyFrameList!.at(999999)).toBeUndefined();
  });

  it("toArray() returns all frames as regular array", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const arr = lazy._lazyFrameList!.toArray();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(lazy.length);
  });
});

describe("Lazy auto-materialization", () => {
  it("labels.instances in lazy mode returns correct results", async () => {
    const eager = await loadFixture("typical.slp");
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy.isLazy).toBe(true);
    const instances = lazy.instances;
    expect(instances.length).toBe(eager.instances.length);
    expect(instances.length).toBeGreaterThan(0);
  });

  it("labels.find() in lazy mode works correctly", async () => {
    const eager = await loadFixture("typical.slp");
    const lazy = await loadFixtureLazy("typical.slp");
    const video = lazy.videos[0];
    const eagerResults = eager.find({ video: eager.videos[0] });
    const lazyResults = lazy.find({ video });
    expect(lazyResults.length).toBe(eagerResults.length);
    expect(lazyResults.length).toBeGreaterThan(0);
  });

  it("labels.negativeFrames in lazy mode works", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    const negFrames = lazy.negativeFrames;
    expect(Array.isArray(negFrames)).toBe(true);
  });

  it("auto-materialization sets isLazy to false", async () => {
    const lazy = await loadFixtureLazy("typical.slp");
    expect(lazy.isLazy).toBe(true);
    lazy.instances;
    expect(lazy.isLazy).toBe(false);
  });

  it("labels.numpy() in lazy mode returns data", async () => {
    const eager = await loadFixture("typical.slp");
    const lazy = await loadFixtureLazy("typical.slp");
    const eagerNumpy = eager.numpy();
    const lazyNumpy = lazy.numpy();
    expect(lazyNumpy.length).toBe(eagerNumpy.length);
    expect(lazyNumpy.length).toBeGreaterThan(0);
  });
});
