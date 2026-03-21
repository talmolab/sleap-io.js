/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { LabeledFrame, Labels, Video, Skeleton, Instance } from "../src/index.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";

describe("Negative Frames", () => {
  it("LabeledFrame has isNegative property defaulting to false", () => {
    const video = new Video({ filename: "test.mp4" });
    const frame = new LabeledFrame({ video, frameIdx: 0 });
    expect(frame.isNegative).toBe(false);
  });

  it("LabeledFrame can be created with isNegative=true", () => {
    const video = new Video({ filename: "test.mp4" });
    const frame = new LabeledFrame({ video, frameIdx: 0, isNegative: true });
    expect(frame.isNegative).toBe(true);
  });

  it("Labels.negativeFrames filters correctly", () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const frame1 = new LabeledFrame({ video, frameIdx: 0, isNegative: false });
    const frame2 = new LabeledFrame({ video, frameIdx: 1, isNegative: true });
    const frame3 = new LabeledFrame({ video, frameIdx: 2, isNegative: true });
    const labels = new Labels({ labeledFrames: [frame1, frame2, frame3], videos: [video], skeletons: [skeleton] });
    expect(labels.negativeFrames.length).toBe(2);
    expect(labels.negativeFrames[0].frameIdx).toBe(1);
    expect(labels.negativeFrames[1].frameIdx).toBe(2);
  });

  it("round-trips negative frames through write and read", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    const frame1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const frame2 = new LabeledFrame({ video, frameIdx: 5, isNegative: true });
    const frame3 = new LabeledFrame({ video, frameIdx: 10, instances: [inst], isNegative: true });
    const labels = new Labels({ labeledFrames: [frame1, frame2, frame3], videos: [video], skeletons: [skeleton] });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.labeledFrames.length).toBe(3);
    expect(loaded.labeledFrames[0].isNegative).toBe(false);
    expect(loaded.labeledFrames[1].isNegative).toBe(true);
    expect(loaded.labeledFrames[2].isNegative).toBe(true);
    expect(loaded.negativeFrames.length).toBe(2);
  });

  it("preserves negative frames through lazy load cycle", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    const frame1 = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const frame2 = new LabeledFrame({ video, frameIdx: 5, isNegative: true });
    const frame3 = new LabeledFrame({ video, frameIdx: 10, instances: [inst], isNegative: true });
    const labels = new Labels({ labeledFrames: [frame1, frame2, frame3], videos: [video], skeletons: [skeleton] });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlpLazy(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.isLazy).toBe(true);
    loaded.materialize();
    expect(loaded.isLazy).toBe(false);

    expect(loaded.labeledFrames.length).toBe(3);
    expect(loaded.labeledFrames[0].isNegative).toBe(false);
    expect(loaded.labeledFrames[1].isNegative).toBe(true);
    expect(loaded.labeledFrames[2].isNegative).toBe(true);
    expect(loaded.negativeFrames.length).toBe(2);
  });

  it("numpy() output spans full video length, not just to last labeled frame", () => {
    const video = new Video({ filename: "test.mp4" });
    // Set video shape: 100 frames, 384x384, 1 channel
    video.shape = [100, 384, 384, 1];
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    // Only label frame 5 — video has 100 frames
    const frame = new LabeledFrame({ video, frameIdx: 5, instances: [inst] });
    const labels = new Labels({ labeledFrames: [frame], videos: [video], skeletons: [skeleton] });

    const arr = labels.numpy();
    // Should span all 100 frames (indices 0..99), not just 0..5
    expect(arr.length).toBe(100);
    // Frame 5 should have data
    expect(arr[5][0][0][0]).toBe(10);
    expect(arr[5][0][0][1]).toBe(20);
    // Other frames should be NaN-filled
    expect(Number.isNaN(arr[0][0][0][0])).toBe(true);
    expect(Number.isNaN(arr[99][0][0][0])).toBe(true);
  });
});
