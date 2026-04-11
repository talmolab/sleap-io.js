/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../../src/model/labels.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { Instance, PredictedInstance, Track } from "../../src/model/instance.js";
import { Skeleton, Node, Edge } from "../../src/model/skeleton.js";
import { SuggestionFrame } from "../../src/model/suggestions.js";
import { UserROI } from "../../src/model/roi.js";
import { UserBoundingBox } from "../../src/model/bbox.js";
import { UserCentroid } from "../../src/model/centroid.js";
import { UserLabelImage } from "../../src/model/label-image.js";
import { loadSlp } from "../../src/io/main.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));

function makeLabels(): Labels {
  const nodeA = new Node("a");
  const nodeB = new Node("b");
  const skeleton = new Skeleton({ nodes: [nodeA, nodeB], edges: [new Edge(nodeA, nodeB)] });
  const video = new Video({ filename: "test.mp4" });
  const track = new Track("t1");
  const instance = Instance.fromArray([[10, 20], [30, 40]], skeleton);
  instance.track = track;
  const predicted = PredictedInstance.fromArray([[11, 21], [31, 41]], skeleton, 0.95);
  predicted.track = track;
  const frame = new LabeledFrame({ video, frameIdx: 0, instances: [instance, predicted] });
  const suggestion = new SuggestionFrame({ video, frameIdx: 5 });
  const roi = new UserROI({
    geometry: { type: "Point", coordinates: [1, 2] },
    video,
  });
  const centroid = new UserCentroid({ x: 5, y: 6 });
  const bbox = new UserBoundingBox({ x1: 0, y1: 0, x2: 10, y2: 10 });
  const li = new UserLabelImage({
    data: new Int32Array([0, 1, 0, 0]),
    height: 2,
    width: 2,
  });
  frame.centroids.push(centroid);
  frame.bboxes.push(bbox);
  frame.labelImages.push(li);
  frame.rois.push(roi);
  return new Labels({
    labeledFrames: [frame],
    videos: [video],
    skeletons: [skeleton],
    tracks: [track],
    suggestions: [suggestion],
  });
}

describe("Labels.copy (eager)", () => {
  it("creates an independent deep copy", () => {
    const labels = makeLabels();
    const copy = labels.copy();

    // Data values are preserved
    expect(copy.labeledFrames.length).toBe(1);
    expect(copy.videos.length).toBe(1);
    expect(copy.skeletons.length).toBe(1);
    expect(copy.tracks.length).toBe(1);
    expect(copy.suggestions.length).toBe(1);
    expect(copy.rois.length).toBe(1);
    expect(copy.centroids.length).toBe(1);
    expect(copy.bboxes.length).toBe(1);
    expect(copy.labelImages.length).toBe(1);

    // Objects are not the same references
    expect(copy.videos[0]).not.toBe(labels.videos[0]);
    expect(copy.skeletons[0]).not.toBe(labels.skeletons[0]);
    expect(copy.tracks[0]).not.toBe(labels.tracks[0]);
    expect(copy.labeledFrames[0]).not.toBe(labels.labeledFrames[0]);
    expect(copy.suggestions[0]).not.toBe(labels.suggestions[0]);
    expect(copy.rois[0]).not.toBe(labels.rois[0]);
    expect(copy.centroids[0]).not.toBe(labels.centroids[0]);
    expect(copy.bboxes[0]).not.toBe(labels.bboxes[0]);
    expect(copy.labelImages[0]).not.toBe(labels.labelImages[0]);
  });

  it("mutating copy does not affect original", () => {
    const labels = makeLabels();
    const copy = labels.copy();

    copy.labeledFrames[0].frameIdx = 999;
    expect(labels.labeledFrames[0].frameIdx).toBe(0);

    copy.tracks[0].name = "renamed";
    expect(labels.tracks[0].name).toBe("t1");
  });

  it("preserves video filename in copy", () => {
    const labels = makeLabels();
    const copy = labels.copy();
    expect(copy.videos[0].filename).toBe("test.mp4");
  });

  it("preserves instance point data in copy", () => {
    const labels = makeLabels();
    const copy = labels.copy();
    const pt = copy.labeledFrames[0].instances[0].points[0];
    expect(pt.xy).toEqual([10, 20]);
  });

  it("preserves predicted instance data in copy", () => {
    const labels = makeLabels();
    const copy = labels.copy();
    const pred = copy.labeledFrames[0].instances[1];
    expect(pred).toBeInstanceOf(PredictedInstance);
    expect((pred as PredictedInstance).score).toBe(0.95);
    expect(pred.points[0].xy).toEqual([11, 21]);
  });

  it("copy has consistent internal references", () => {
    const labels = makeLabels();
    const copy = labels.copy();

    // Frame's video should be the copy's video
    expect(copy.labeledFrames[0].video).toBe(copy.videos[0]);
    // Instance's skeleton should be the copy's skeleton
    expect(copy.labeledFrames[0].instances[0].skeleton).toBe(copy.skeletons[0]);
    // Instance's track should be the copy's track
    expect(copy.labeledFrames[0].instances[0].track).toBe(copy.tracks[0]);
    // Suggestion's video should be the copy's video
    expect(copy.suggestions[0].video).toBe(copy.videos[0]);
    // ROI's video should be the copy's video
    expect(copy.rois[0].video).toBe(copy.videos[0]);
    // Centroid's video should be the copy's video
    // centroids no longer have .video
    // BBox's video should be the copy's video
    // bboxes no longer have .video
    // LabelImage's video should be the copy's video
    // labelImages no longer have .video
  });

  it("copy preserves skeleton structure", () => {
    const labels = makeLabels();
    const copy = labels.copy();
    const skel = copy.skeletons[0];
    expect(skel.nodeNames).toEqual(["a", "b"]);
    expect(skel.edges.length).toBe(1);
    expect(skel.edges[0].source).toBe(skel.nodes[0]);
    expect(skel.edges[0].destination).toBe(skel.nodes[1]);
  });

  it("copy preserves class prototypes", () => {
    const labels = makeLabels();
    const copy = labels.copy();
    expect(copy).toBeInstanceOf(Labels);
    expect(copy.labeledFrames[0]).toBeInstanceOf(LabeledFrame);
    expect(copy.labeledFrames[0].instances[0]).toBeInstanceOf(Instance);
    expect(copy.videos[0]).toBeInstanceOf(Video);
    expect(copy.skeletons[0]).toBeInstanceOf(Skeleton);
  });

  it("copy preserves ancillary data values", () => {
    const labels = makeLabels();
    const copy = labels.copy();
    expect(copy.centroids[0].x).toBe(5);
    expect(copy.centroids[0].y).toBe(6);
    expect(copy.bboxes[0].x1).toBe(0);
    expect(copy.bboxes[0].x2).toBe(10);
    expect(copy.labelImages[0].data).toEqual(new Int32Array([0, 1, 0, 0]));
  });

  it("openVideos=false disables backend on copy", () => {
    const labels = makeLabels();
    const copy = labels.copy({ openVideos: false });
    expect(copy.videos[0].openBackend).toBe(false);
  });

  it("openVideos=true enables backend on copy", () => {
    const video = new Video({ filename: "test.mp4", openBackend: false });
    const labels = new Labels({ videos: [video] });
    const copy = labels.copy({ openVideos: true });
    expect(copy.videos[0].openBackend).toBe(true);
  });
});

describe("Labels.copy (lazy)", () => {
  it("creates an independent lazy copy", async () => {
    const labels = await loadSlp(
      path.join(fixtureRoot, "slp", "typical.slp"),
      { openVideos: false, lazy: true },
    );
    expect(labels.isLazy).toBe(true);

    const copy = labels.copy();

    expect(copy.isLazy).toBe(true);
    expect(copy.length).toBe(labels.length);

    // Independent video objects
    expect(copy.videos[0]).not.toBe(labels.videos[0]);
    expect(copy.videos[0].filename).toBe(labels.videos[0].filename);

    // Independent stores
    expect(copy._lazyDataStore).not.toBe(labels._lazyDataStore);
    expect(copy._lazyFrameList).not.toBe(labels._lazyFrameList);
  });

  it("lazy copy materializes independently", async () => {
    const labels = await loadSlp(
      path.join(fixtureRoot, "slp", "typical.slp"),
      { openVideos: false, lazy: true },
    );
    const copy = labels.copy();

    // Materialize the copy
    copy.materialize();
    expect(copy.isLazy).toBe(false);
    expect(copy.labeledFrames.length).toBeGreaterThan(0);

    // Original is still lazy
    expect(labels.isLazy).toBe(true);
  });

  it("lazy copy has consistent skeleton/track refs after materialize", async () => {
    const labels = await loadSlp(
      path.join(fixtureRoot, "slp", "typical.slp"),
      { openVideos: false, lazy: true },
    );
    const copy = labels.copy();
    copy.materialize();

    // Frame videos should be the copy's videos
    for (const frame of copy.labeledFrames) {
      expect(copy.videos).toContain(frame.video);
    }

    // Instance skeletons should be the copy's skeletons
    for (const frame of copy.labeledFrames) {
      for (const inst of frame.instances) {
        expect(copy.skeletons).toContain(inst.skeleton);
      }
    }
  });
});

describe("Labels.copy + replaceVideos integration", () => {
  it("copy then replaceVideos produces fully independent result", () => {
    const nodeA = new Node("a");
    const skeleton = new Skeleton({ nodes: [nodeA] });
    const video = new Video({ filename: "original.mp4" });
    const track = new Track("t1");
    const centroid = new UserCentroid({ x: 1, y: 2 });
    const li = new UserLabelImage({
      data: new Int32Array([0, 1, 0, 0]),
      height: 2,
      width: 2,
    });
    const instance = Instance.fromArray([[5, 10]], skeleton);
    instance.track = track;
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [instance], centroids: [centroid], labelImages: [li] });

    const labels = new Labels({
      labeledFrames: [frame],
      videos: [video],
      skeletons: [skeleton],
      tracks: [track],
    });

    const copy = labels.copy();
    const replacement = new Video({ filename: "replaced.mp4" });
    copy.replaceVideos({ newVideos: [replacement] });

    // Original is untouched
    expect(labels.videos[0].filename).toBe("original.mp4");
    expect(labels.labeledFrames[0].video.filename).toBe("original.mp4");
    // centroids no longer have .video
    // labelImages no longer have .video

    // Copy has the replacement
    expect(copy.videos[0].filename).toBe("replaced.mp4");
    expect(copy.labeledFrames[0].video.filename).toBe("replaced.mp4");
    // centroids no longer have .video
    // labelImages no longer have .video
  });
});
