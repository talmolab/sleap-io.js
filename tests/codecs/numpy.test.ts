/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlp } from "../../src/io/main.js";
import { toNumpy, fromNumpy } from "../../src/codecs/numpy.js";
import { Labels } from "../../src/model/labels.js";
import { PredictedInstance } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));

async function loadFixture(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false });
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
});
