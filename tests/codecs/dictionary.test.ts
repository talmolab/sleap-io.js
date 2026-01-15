/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlp } from "../../src/io/main.js";
import { toDict, fromDict } from "../../src/codecs/dictionary.js";
import { Instance, PredictedInstance, Track } from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Labels } from "../../src/model/labels.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { SuggestionFrame } from "../../src/model/suggestions.js";
import { Video } from "../../src/model/video.js";

const fixtureRoot = "/Users/talmo/sleap-io.js/tests/data";

async function loadFixture(path: string) {
  return loadSlp(path, { openVideos: false });
}

describe("dictionary codec", () => {
  it("serializes basic structure", async () => {
    const labels = await loadFixture(`${fixtureRoot}/slp/typical.slp`);
    const data = toDict(labels);

    expect(data.version).toBe("1.0.0");
    expect(data.skeletons.length).toBeGreaterThan(0);
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.tracks).toBeDefined();
    expect(data.labeled_frames.length).toBeGreaterThan(0);
    expect(data.suggestions).toBeDefined();
    expect(data.provenance).toBeDefined();

    const skeleton = data.skeletons[0];
    expect(Array.isArray(skeleton.nodes)).toBe(true);
    expect(Array.isArray(skeleton.edges)).toBe(true);

    const frame = data.labeled_frames[0];
    expect(frame).toHaveProperty("frame_idx");
    expect(frame).toHaveProperty("video_idx");
    expect(Array.isArray(frame.instances)).toBe(true);
  });

  it("is JSON serializable", async () => {
    const labels = await loadFixture(`${fixtureRoot}/slp/typical.slp`);
    const data = toDict(labels);
    const json = JSON.stringify(data);
    expect(json.length).toBeGreaterThan(0);
    const roundtrip = JSON.parse(json);
    expect(Object.keys(roundtrip)).toEqual(Object.keys(data));
  });

  it("filters by video and skips empty frames", async () => {
    const labels = await loadFixture(`${fixtureRoot}/slp/typical.slp`);
    const video = labels.videos[0];
    const filtered = toDict(labels, { video });
    filtered.labeled_frames.forEach((frame) => expect(frame.video_idx).toBe(0));

    const nonEmptyCount = labels.labeledFrames.filter((lf) => lf.instances.length > 0).length;
    const skipped = toDict(labels, { skipEmptyFrames: true });
    expect(skipped.labeled_frames.length).toBe(nonEmptyCount);
  });

  it("includes tracks and distinguishes predicted instances", () => {
    const skeleton = new Skeleton({ nodes: ["node1", "node2"] });
    const video = new Video({ filename: "test.mp4" });
    const track1 = new Track("track1");
    const track2 = new Track("track2");

    const instance1 = PredictedInstance.fromNumpy({
      pointsData: [
        [1, 2],
        [3, 4],
      ],
      skeleton,
      track: track1,
      score: 0.9,
    });
    const instance2 = PredictedInstance.fromNumpy({
      pointsData: [
        [5, 6],
        [7, 8],
      ],
      skeleton,
      track: track2,
      score: 0.8,
    });

    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [instance1, instance2] });
    const labels = new Labels({ labeledFrames: [lf], tracks: [track1, track2] });

    const data = toDict(labels);
    expect(data.tracks.length).toBe(2);
    expect(data.tracks[0].name).toBe("track1");
    expect(data.tracks[1].name).toBe("track2");

    const frame = data.labeled_frames[0];
    expect(frame.instances[0]).toHaveProperty("track_idx");
  });

  it("serializes symmetries and provenance", () => {
    const skeleton = new Skeleton({ nodes: ["left", "right", "center"] });
    skeleton.addSymmetry("left", "right");
    const video = new Video({ filename: "test.mp4" });
    const instance = Instance.fromNumpy({
      pointsData: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      skeleton,
    });
    const labels = new Labels({ labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [instance] })] });
    labels.provenance = { source: "test", metadata: { key: "value" } };

    const data = toDict(labels);
    expect(data.skeletons[0].symmetries[0]).toEqual([0, 1]);
    expect(data.provenance).toEqual(labels.provenance);
  });

  it("round-trips through dict", async () => {
    const labels = await loadFixture(`${fixtureRoot}/slp/typical.slp`);
    const dict = toDict(labels);
    const restored = fromDict(dict);

    expect(restored.skeletons.length).toBe(labels.skeletons.length);
    expect(restored.videos.length).toBe(labels.videos.length);
    expect(restored.labeledFrames.length).toBe(labels.labeledFrames.length);
  });

  it("round-trips tracks and suggestions", () => {
    const skeleton = new Skeleton({ nodes: ["node1"] });
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("animal1");
    const instance = PredictedInstance.fromNumpy({ pointsData: [[1, 2]], skeleton, track, score: 0.95 });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [instance] });
    const labels = new Labels({ labeledFrames: [lf], tracks: [track] });
    labels.suggestions = [new SuggestionFrame({ video, frameIdx: 10 })];

    const restored = fromDict(toDict(labels));
    expect(restored.tracks[0].name).toBe("animal1");
    expect(restored.labeledFrames[0].instances[0].track?.name).toBe("animal1");
    expect(restored.suggestions[0].frameIdx).toBe(10);
  });

  it("handles empty dict and missing keys", () => {
    const data = {
      version: "1.0.0",
      skeletons: [],
      videos: [],
      tracks: [],
      labeled_frames: [],
      suggestions: [],
      provenance: {},
    };
    const labels = fromDict(data);
    expect(labels.labeledFrames.length).toBe(0);

    expect(() => fromDict({ skeletons: [] } as any)).toThrow(/Missing required key/);
  });

  it("serializes tracking_score and from_predicted flag", () => {
    const skeleton = new Skeleton({ nodes: ["node1"] });
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("animal1");

    const predicted = PredictedInstance.fromNumpy({ pointsData: [[5, 6]], skeleton, track, score: 0.9 });
    const user = Instance.fromNumpy({ pointsData: [[1, 2]], skeleton, track, fromPredicted: predicted });
    user.trackingScore = 0.85;

    const labels = new Labels({ labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [predicted, user] })] });
    const data = toDict(labels);
    const userDict = data.labeled_frames[0].instances.find((inst) => inst.type === "instance") as any;
    expect(userDict.has_from_predicted).toBe(true);
    expect(userDict.tracking_score).toBeCloseTo(0.85);
  });

  it("serializes video shape and backend", () => {
    const skeleton = new Skeleton({ nodes: ["node1"] });
    const video = new Video({
      filename: "test.mp4",
      backend: { constructor: { name: "MediaVideo" }, shape: [1, 384, 384, 1] } as any,
    });

    const instance = Instance.fromNumpy({ pointsData: [[1, 2]], skeleton });
    const labels = new Labels({ labeledFrames: [new LabeledFrame({ video, frameIdx: 0, instances: [instance] })] });
    const data = toDict(labels);

    const videoDict = data.videos[0];
    expect(videoDict.shape).toHaveLength(4);
    expect(videoDict.backend?.type).toBe("MediaVideo");
  });

  it("labels.toDict wrapper matches codec", async () => {
    const labels = await loadFixture(`${fixtureRoot}/slp/typical.slp`);
    const data = labels.toDict();
    expect(data.version).toBe("1.0.0");
    const filtered = labels.toDict({ video: 0 });
    expect(filtered.videos.length).toBe(1);
  });
});
