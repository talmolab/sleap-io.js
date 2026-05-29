import { describe, it, expect } from "../bun-test";
import { loadSlp } from "../../src/io/main.js";
import { toNumpy, fromNumpy } from "../../src/codecs/numpy.js";
import { Labels } from "../../src/model/labels.js";
import { Instance, PredictedInstance } from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));

async function loadFixture(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false });
}

function buildSparseLabels(options: {
  shape?: [number, number, number, number] | null;
  labeledFrameIdx: number;
}): Labels {
  const video = new Video({ filename: "sparse.mp4" });
  if (options.shape !== undefined) video.shape = options.shape;
  const skeleton = new Skeleton(["a", "b"]);
  const frame = new LabeledFrame({
    video,
    frameIdx: options.labeledFrameIdx,
    instances: [Instance.fromArray([[1, 2], [3, 4]], skeleton)],
  });
  return new Labels({ labeledFrames: [frame], videos: [video], skeletons: [skeleton] });
}

describe("numpy codec", () => {
  it("converts labels to array", async () => {
    const labels = await loadFixture("typical.slp");
    const arr = toNumpy(labels);
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0][0][0]).toHaveLength(2);
  });

  it("supports confidence channel", async () => {
    const labels = await loadFixture("typical.slp");
    const arr = toNumpy(labels, { returnConfidence: true });
    expect(arr[0][0][0]).toHaveLength(3);
  });

  it("matches Labels.numpy", async () => {
    const labels = await loadFixture("typical.slp");
    const arr1 = toNumpy(labels);
    const arr2 = labels.numpy();
    expect(arr1).toEqual(arr2);
  });

  it("creates labels from array", () => {
    const arr = [
      [
        [
          [10, 20],
          [30, 40],
        ],
      ],
      [
        [
          [15, 25],
          [35, 45],
        ],
      ],
    ];
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton(["node1", "node2"]);

    const labels = fromNumpy(arr, { video, skeleton });
    expect(labels.labeledFrames.length).toBe(2);
    const inst = labels.labeledFrames[0].instances[0] as PredictedInstance;
    expect(inst).toBeInstanceOf(PredictedInstance);
  });

  it("handles confidence scores", () => {
    const arr = [
      [
        [
          [10, 20, 0.95],
          [30, 40, 0.98],
        ],
      ],
    ];
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton(["node1", "node2"]);

    const labels = fromNumpy(arr, { video, skeleton, returnConfidence: true });
    const inst = labels.labeledFrames[0].instances[0] as PredictedInstance;
    const scoredPoint = inst.points[0] as unknown as { score: number };
    expect(scoredPoint.score).toBeCloseTo(0.95, 6);
  });

  it("matches Labels.fromNumpy", () => {
    const arr = Array.from({ length: 2 }, () =>
      Array.from({ length: 2 }, () =>
        Array.from({ length: 3 }, () => [Math.random(), Math.random()])
      )
    );
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton(["a", "b", "c"]);

    const labels1 = fromNumpy(arr, { video, skeleton });
    const labels2 = Labels.fromNumpy(arr, { video, skeleton });
    expect(toNumpy(labels1)).toEqual(toNumpy(labels2));
  });

  it("creates track names and respects first frame", () => {
    const arr = [
      [
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ],
    ];
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton(["node1", "node2"]);

    const labels = fromNumpy(arr, { video, skeleton, trackNames: ["mouse1", "mouse2"], firstFrame: 10 });
    expect(labels.tracks[0].name).toBe("mouse1");
    expect(labels.labeledFrames[0].frameIdx).toBe(10);
  });

  it("validates inputs", () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton(["node1"]);

    expect(() => fromNumpy([] as any, { video, skeleton })).toThrow(/4 dimensions/);
    expect(() => fromNumpy([[[[0, 0]]]] as any, { skeleton })).toThrow(/video/);
    expect(() => fromNumpy([[[[0, 0]]]] as any, { video })).toThrow(/skeleton/);
    expect(() => fromNumpy([[[[0, 0]]]] as any, { video, videos: [video], skeleton })).toThrow(/both/);
  });

  it("sizes output to video.shape[0] when known and labels are sparse", () => {
    const labels = buildSparseLabels({ shape: [10, 1, 1, 1], labeledFrameIdx: 3 });
    const arr = labels.numpy();
    expect(arr.length).toBe(10);
    expect(arr[3][0][0]).toEqual([1, 2]);
    expect(Number.isNaN(arr[9][0][0][0])).toBe(true);
  });

  it("falls back to last labeled frame + 1 when video.shape is null", () => {
    const labels = buildSparseLabels({ shape: null, labeledFrameIdx: 3 });
    const arr = labels.numpy();
    expect(arr.length).toBe(4);
  });

  it("uses numFrames override when video.shape is null", () => {
    const labels = buildSparseLabels({ shape: null, labeledFrameIdx: 3 });
    const arr = labels.numpy({ numFrames: 10 });
    expect(arr.length).toBe(10);
    expect(arr[3][0][0]).toEqual([1, 2]);
  });

  it("numFrames overrides video.shape[0] when both provided", () => {
    const labels = buildSparseLabels({ shape: [5, 1, 1, 1], labeledFrameIdx: 1 });
    const arr = labels.numpy({ numFrames: 12 });
    expect(arr.length).toBe(12);
  });

  it("clamps numFrames up to maxLabeledFrame + 1", () => {
    const labels = buildSparseLabels({ shape: null, labeledFrameIdx: 7 });
    const arr = labels.numpy({ numFrames: 3 });
    expect(arr.length).toBe(8);
    expect(arr[7][0][0]).toEqual([1, 2]);
    expect(Number.isNaN(arr[0][0][0][0])).toBe(true);
    expect(Number.isNaN(arr[6][0][0][0])).toBe(true);
  });

  it("ignores numFrames <= 0", () => {
    const labels = buildSparseLabels({ shape: [6, 1, 1, 1], labeledFrameIdx: 1 });
    const arr = labels.numpy({ numFrames: 0 });
    expect(arr.length).toBe(6);
  });

  it("floors fractional numFrames and ignores non-finite values", () => {
    const labels = buildSparseLabels({ shape: null, labeledFrameIdx: 2 });
    expect(labels.numpy({ numFrames: 9.7 }).length).toBe(9);
    expect(labels.numpy({ numFrames: Number.NaN }).length).toBe(3);
    expect(labels.numpy({ numFrames: Number.POSITIVE_INFINITY }).length).toBe(3);
    expect(labels.numpy({ numFrames: -2.5 }).length).toBe(3);
  });

  it("threads numFrames through the toNumpy codec wrapper", () => {
    const labels = buildSparseLabels({ shape: null, labeledFrameIdx: 2 });
    const viaCodec = toNumpy(labels, { numFrames: 9 });
    const viaMethod = labels.numpy({ numFrames: 9 });
    expect(viaCodec).toEqual(viaMethod);
    expect(viaCodec.length).toBe(9);
  });
});
