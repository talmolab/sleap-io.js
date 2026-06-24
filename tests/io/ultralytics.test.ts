/**
 * Tests for Ultralytics YOLO I/O (`src/io/ultralytics.ts`).
 *
 * Mirrors the Python suite `tests/io/test_ultralytics.py` (adapted to the JS
 * API and the documented image-I/O divergences) plus JS-specific coverage of
 * the image-header prober and the PNG encoder used by the writer.
 *
 * The shared on-disk fixture under `tests/data/ultralytics` is copied verbatim
 * from the Python repo (`tests/data/ultralytics`), so the pose dataset and its
 * label files are byte-identical across both libraries.
 *
 * Image-I/O divergence (see module docs): JS reads dimensions from the file
 * header and, on write, copies on-disk source images verbatim or encodes raw
 * pixels to PNG. The pose/detect/segment write paths in these tests therefore
 * use frames backed by real image files so the round-trips stay hermetic
 * (no video decoding required).
 */
import { describe, it, expect, beforeEach, afterEach } from "../bun-test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseDataYaml,
  classNamesFromConfig,
  createSkeletonFromConfig,
  detectLineFormat,
  parseLabelFile,
  writeLabelFile,
  writeRoiLabelFile,
  writeBboxLabelFile,
  createDataYaml,
  normalizeCoordinates,
  denormalizeCoordinates,
  buildClassNamesFromRois,
  buildClassNamesFromBboxes,
  createSplitsFromLabels,
  readLabels,
  readLabelsSet,
  writeLabels,
  loadUltralytics,
  saveUltralytics,
  probeImageSize,
  encodePng,
} from "../../src/io/ultralytics.js";
import { Labels } from "../../src/model/labels.js";
import { LabelsSet } from "../../src/model/labels-set.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance } from "../../src/model/instance.js";
import { Skeleton, Node, Edge } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { UserROI } from "../../src/model/roi.js";
import { UserBoundingBox, PredictedBoundingBox } from "../../src/model/bbox.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const ultralyticsDataset = path.join(fixtureRoot, "ultralytics");
const ultralyticsDataYaml = path.join(ultralyticsDataset, "data.yaml");

/** Skeleton matching the shared test dataset (head/neck/center/tail_base/tail_tip). */
function ultralyticsSkeleton(): Skeleton {
  const nodes = [
    new Node("head"),
    new Node("neck"),
    new Node("center"),
    new Node("tail_base"),
    new Node("tail_tip"),
  ];
  const edges = [
    new Edge(nodes[0], nodes[1]),
    new Edge(nodes[1], nodes[2]),
    new Edge(nodes[2], nodes[3]),
    new Edge(nodes[2], nodes[4]),
  ];
  return new Skeleton({ nodes, edges, name: "test_animal" });
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ultralytics-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Write a tiny valid PNG of the given size into `dir` and return its path. */
function writeTestPng(
  dir: string,
  name: string,
  width: number,
  height: number,
): string {
  const rgba = new Uint8Array(width * height * 4).fill(0);
  const png = encodePng(rgba, width, height);
  const p = path.join(dir, name);
  fs.writeFileSync(p, png);
  return p;
}

// ===========================================================================
// data.yaml / skeleton
// ===========================================================================

describe("data.yaml + skeleton", () => {
  it("parses data.yaml configuration", () => {
    const config = parseDataYaml(ultralyticsDataYaml);
    expect("kpt_shape" in config).toBe(true);
    expect("skeleton" in config).toBe(true);
    expect("names" in config).toBe(true);
    expect(config.kpt_shape).toEqual([5, 3]);
    expect((config.skeleton as unknown[]).length).toBe(4);
    expect(classNamesFromConfig(config).get(0)).toBe("animal");
  });

  it("creates a skeleton from config", () => {
    const config = parseDataYaml(ultralyticsDataYaml);
    const skeleton = createSkeletonFromConfig(config);
    expect(skeleton.nodes.length).toBe(5);
    expect(skeleton.edges.length).toBe(4);
    expect(skeleton.name).toBe("ultralytics_skeleton");
  });
});

// ===========================================================================
// detectLineFormat
// ===========================================================================

describe("detectLineFormat", () => {
  it("auto-detects per-line formats", () => {
    expect(detectLineFormat(["0", "0.5", "0.5", "0.2", "0.3"])).toBe(
      "detection",
    );
    expect(detectLineFormat(["0", "0.5", "0.5", "0.2", "0.3", "0.9"])).toBe(
      "detection_conf",
    );
    expect(detectLineFormat(Array(8).fill("0"))).toBe("pose"); // 5 + 3*1
    expect(detectLineFormat(Array(11).fill("0"))).toBe("pose"); // 5 + 3*2
    expect(detectLineFormat(Array(9).fill("0"))).toBe("segmentation"); // 4 polygon pts
    expect(detectLineFormat(Array(13).fill("0"))).toBe("segmentation");
  });
});

// ===========================================================================
// parseLabelFile (pose)
// ===========================================================================

describe("parseLabelFile (pose)", () => {
  it("parses a single-instance label file", () => {
    const labelFile = path.join(
      ultralyticsDataset,
      "train",
      "labels",
      "image_001.txt",
    );
    const { instances, rois, bboxes } = parseLabelFile(
      labelFile,
      ultralyticsSkeleton(),
      [480, 640],
    );
    expect(instances.length).toBe(1);
    expect(rois.length).toBe(0);
    expect(bboxes.length).toBe(0);
    const instance = instances[0];
    expect(instance.points.length).toBe(5);
    expect(instance.skeleton.nodes.length).toBe(5);
    for (const point of instance.points) {
      if (point.visible) {
        expect(point.xy[0]).toBeGreaterThanOrEqual(0);
        expect(point.xy[0]).toBeLessThanOrEqual(640);
        expect(point.xy[1]).toBeGreaterThanOrEqual(0);
        expect(point.xy[1]).toBeLessThanOrEqual(480);
      }
    }
  });

  it("parses a multi-instance label file", () => {
    const labelFile = path.join(
      ultralyticsDataset,
      "train",
      "labels",
      "image_002.txt",
    );
    const { instances, rois } = parseLabelFile(
      labelFile,
      ultralyticsSkeleton(),
      [480, 640],
    );
    expect(instances.length).toBe(2);
    expect(rois.length).toBe(0);
    for (const instance of instances) {
      expect(instance.points.length).toBe(5);
    }
  });

  it("handles empty label files", () => {
    const labelFile = path.join(tmp, "empty.txt");
    fs.writeFileSync(labelFile, "");
    const { instances, rois, bboxes } = parseLabelFile(
      labelFile,
      ultralyticsSkeleton(),
      [480, 640],
    );
    expect(instances.length).toBe(0);
    expect(rois.length).toBe(0);
    expect(bboxes.length).toBe(0);
  });

  it("skips malformed lines without crashing", () => {
    const labelFile = path.join(tmp, "malformed.txt");
    fs.writeFileSync(labelFile, "invalid line\n0 0.5\n");
    const { instances, rois } = parseLabelFile(
      labelFile,
      ultralyticsSkeleton(),
      [480, 640],
    );
    expect(instances.length).toBe(0);
    expect(rois.length).toBe(0);
  });

  it("rejects instances when keypoint count mismatches skeleton", () => {
    const skeleton = new Skeleton([
      new Node("a"),
      new Node("b"),
      new Node("c"),
    ]);
    const labelFile = path.join(tmp, "mismatch.txt");
    fs.writeFileSync(labelFile, "0 0.5 0.5 0.2 0.4 0.1 0.1 2 0.2 0.2 2\n"); // only 2 keypoints
    const { instances } = parseLabelFile(labelFile, skeleton, [100, 100]);
    expect(instances.length).toBe(0);
  });

  it("warns and skips on non-numeric class id", () => {
    const labelFile = path.join(tmp, "invalid_data.txt");
    fs.writeFileSync(labelFile, "not_a_number 0.5 0.5 0.2 0.2\n");
    const { instances } = parseLabelFile(
      labelFile,
      ultralyticsSkeleton(),
      [480, 640],
    );
    expect(instances.length).toBe(0);
  });

  it("rejects pose lines with keypoints not divisible by 3", () => {
    const skeleton = new Skeleton([new Node("a"), new Node("b")]);
    const labelFile = path.join(tmp, "invalid_keypoints.txt");
    // 8 values: 5 bbox + 3 kp data = 1 keypoint, but skeleton expects 2 → mismatch.
    fs.writeFileSync(labelFile, "0 0.5 0.5 0.2 0.2 0.1 0.1 2\n");
    const { instances } = parseLabelFile(labelFile, skeleton, [480, 640]);
    expect(instances.length).toBe(0);
  });

  it("treats visibility 0 as invisible NaN and >0 as visible", () => {
    const skeleton = new Skeleton([new Node("a"), new Node("b")]);
    const labelFile = path.join(tmp, "vis.txt");
    // a: visible (v=2); b: not visible (v=0).
    fs.writeFileSync(labelFile, "0 0.5 0.5 0.2 0.2 0.5 0.5 2 0.25 0.25 0\n");
    const { instances } = parseLabelFile(labelFile, skeleton, [100, 200]);
    expect(instances.length).toBe(1);
    const pts = instances[0].points;
    expect(pts[0].visible).toBe(true);
    expect(pts[0].xy[0]).toBeCloseTo(0.5 * 200, 4);
    expect(pts[1].visible).toBe(false);
    expect(Number.isNaN(pts[1].xy[0])).toBe(true);
  });
});

// ===========================================================================
// readLabels (dataset)
// ===========================================================================

describe("readLabels", () => {
  it("reads the train split", () => {
    const labels = readLabels(ultralyticsDataset, { split: "train" });
    expect(labels.labeledFrames.length).toBe(2);
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].nodes.length).toBe(5);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(3); // 1 + 2
  });

  it("reads the val split", () => {
    const labels = readLabels(ultralyticsDataset, { split: "val" });
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.skeletons.length).toBe(1);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(1);
  });

  it("uses a custom skeleton when provided", () => {
    const nodes = Array.from(
      { length: 5 },
      (_, i) => new Node(`custom_node_${i}`),
    );
    const custom = new Skeleton({ nodes, name: "custom" });
    const labels = readLabels(ultralyticsDataset, { skeleton: custom });
    expect(labels.skeletons[0]).toBe(custom);
    for (const frame of labels.labeledFrames) {
      for (const instance of frame.instances) {
        expect(instance.skeleton).toBe(custom);
      }
    }
  });

  it("accepts a data.yaml path directly", () => {
    const labels = readLabels(ultralyticsDataYaml, { split: "train" });
    expect(labels.labeledFrames.length).toBe(2);
  });

  it("loadUltralytics is a convenience wrapper", () => {
    const labels = loadUltralytics(ultralyticsDataset, { split: "train" });
    expect(labels).toBeInstanceOf(Labels);
    expect(labels.labeledFrames.length).toBe(2);
  });

  it("throws when data.yaml is missing", () => {
    expect(() => readLabels(path.join(tmp, "nonexistent"))).toThrow(
      /data\.yaml not found/,
    );
  });

  it("throws when images directory is missing", () => {
    fs.writeFileSync(
      path.join(tmp, "data.yaml"),
      "kpt_shape: [1, 3]\ntrain: train/images\n",
    );
    expect(() => readLabels(tmp, { split: "train" })).toThrow(
      /Images directory not found/,
    );
  });

  it("throws when labels directory is missing", () => {
    fs.writeFileSync(
      path.join(tmp, "data.yaml"),
      "kpt_shape: [2, 3]\ntrain: train/images\nnode_names: [a, b]\n",
    );
    fs.mkdirSync(path.join(tmp, "train", "images"), { recursive: true });
    expect(() => readLabels(tmp, { split: "train" })).toThrow(
      /Labels directory not found/,
    );
  });

  it("reads image dimensions from the file header (denormalization)", () => {
    // image_001.jpg is 640x480; the center keypoint is at (0.5, 0.4) →
    // (320, 192) in pixels.
    const labels = readLabels(ultralyticsDataset, { split: "train" });
    const inst = labels.labeledFrames[0].instances[0];
    const center = inst.points[2];
    expect(center.xy[0]).toBeCloseTo(0.5 * 640, 2);
    expect(center.xy[1]).toBeCloseTo(0.4 * 480, 2);
  });
});

// ===========================================================================
// writeLabelFile (pose) + round trips
// ===========================================================================

describe("writeLabelFile (pose)", () => {
  it("writes one line with bbox + keypoints", () => {
    const skeleton = ultralyticsSkeleton();
    const pointsData = [
      [100, 150, 1],
      [110, 160, 1],
      [120, 170, 1],
      [130, 180, 0], // not visible
      [140, 190, 1],
    ];
    const instance = Instance.fromNumpy({ pointsData, skeleton });
    const frame = new LabeledFrame({
      video: new Video({ filename: "test.mp4", openBackend: false }),
      frameIdx: 0,
      instances: [instance],
    });
    const labelFile = path.join(tmp, "label.txt");
    writeLabelFile(labelFile, frame, skeleton, [480, 640], 0);
    const lines = fs.readFileSync(labelFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const parts = lines[0].split(" ");
    expect(parts[0]).toBe("0");
    expect(parts.length).toBe(20); // class_id + bbox(4) + keypoints(5*3)
  });

  it("writes an empty file when no points are visible", () => {
    const skeleton = new Skeleton([
      new Node("a"),
      new Node("b"),
      new Node("c"),
    ]);
    const pointsData = [
      [NaN, NaN, 0],
      [NaN, NaN, 0],
      [NaN, NaN, 0],
    ];
    const instance = Instance.fromNumpy({ pointsData, skeleton });
    const frame = new LabeledFrame({
      video: new Video({ filename: "test.mp4", openBackend: false }),
      frameIdx: 0,
      instances: [instance],
    });
    const labelFile = path.join(tmp, "no_visible.txt");
    writeLabelFile(labelFile, frame, skeleton, [480, 640], 0);
    expect(fs.readFileSync(labelFile, "utf-8")).toBe("");
  });

  it("skips instances whose point count mismatches the skeleton", () => {
    const skeleton = new Skeleton([
      new Node("a"),
      new Node("b"),
      new Node("c"),
    ]);
    const instance = Instance.fromNumpy({
      pointsData: [
        [10, 20, 1],
        [30, 40, 1],
      ],
      skeleton: new Skeleton([new Node("x"), new Node("y")]),
    });
    const frame = new LabeledFrame({
      video: new Video({ filename: "test.mp4", openBackend: false }),
      frameIdx: 0,
      instances: [instance],
    });
    const labelFile = path.join(tmp, "mismatch.txt");
    writeLabelFile(labelFile, frame, skeleton, [480, 640]);
    expect(fs.readFileSync(labelFile, "utf-8")).toBe("");
  });
});

describe("writeLabels (pose) round trips", () => {
  it("writes a single split with images + labels", async () => {
    // Three frames backed by real on-disk images (so the copy path runs).
    const skeleton = new Skeleton(
      [new Node("head"), new Node("tail")],
      [new Edge(new Node("head"), new Node("tail"))],
    );
    const frames: LabeledFrame[] = [];
    for (let i = 0; i < 3; i++) {
      const imgPath = writeTestPng(tmp, `src_${i}.png`, 64, 48);
      const instance = Instance.fromNumpy({
        pointsData: [
          [10, 20, 1],
          [30, 40, 1],
        ],
        skeleton,
      });
      frames.push(
        new LabeledFrame({
          video: new Video({ filename: imgPath, openBackend: false }),
          frameIdx: 0,
          instances: [instance],
        }),
      );
    }
    const labels = new Labels({ labeledFrames: frames, skeletons: [skeleton] });

    const outDir = path.join(tmp, "out");
    await writeLabels(labels, outDir, { splitRatios: { train: 1.0 } });

    expect(fs.existsSync(path.join(outDir, "data.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "train", "images"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "train", "labels"))).toBe(true);

    const config = parseDataYaml(path.join(outDir, "data.yaml"));
    expect(config.kpt_shape).toEqual([2, 3]);
    expect("train" in config).toBe(true);

    const images = fs.readdirSync(path.join(outDir, "train", "images")).sort();
    expect(images).toEqual(["0000000.png", "0000001.png", "0000002.png"]);
    const labelFiles = fs
      .readdirSync(path.join(outDir, "train", "labels"))
      .sort();
    expect(labelFiles).toEqual(["0000000.txt", "0000001.txt", "0000002.txt"]);
  });

  it("round-trips the shared dataset (ultralytics → SLEAP → ultralytics)", async () => {
    const original = readLabels(ultralyticsDataset, { split: "train" });
    const outDir = path.join(tmp, "round_trip");
    await writeLabels(original, outDir, { splitRatios: { train: 1.0 } });
    const reloaded = readLabels(outDir, { split: "train" });
    expect(reloaded.labeledFrames.length).toBe(original.labeledFrames.length);
    expect(reloaded.skeletons[0].nodes.length).toBe(
      original.skeletons[0].nodes.length,
    );
  });

  it("saveUltralytics is a convenience wrapper", async () => {
    const skeleton = new Skeleton([new Node("p")]);
    const imgPath = writeTestPng(tmp, "single.png", 32, 32);
    const instance = Instance.fromNumpy({
      pointsData: [[10, 10, 1]],
      skeleton,
    });
    const frame = new LabeledFrame({
      video: new Video({ filename: imgPath, openBackend: false }),
      frameIdx: 0,
      instances: [instance],
    });
    const labels = new Labels({
      labeledFrames: [frame],
      skeletons: [skeleton],
    });
    const outDir = path.join(tmp, "save_ultralytics");
    await saveUltralytics(labels, outDir);
    expect(fs.existsSync(path.join(outDir, "data.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "train"))).toBe(true);
  });

  it("throws on invalid split ratios", async () => {
    const skeleton = new Skeleton([new Node("node")]);
    const labels = new Labels({ labeledFrames: [], skeletons: [skeleton] });
    await expect(
      writeLabels(labels, path.join(tmp, "bad"), {
        splitRatios: { train: 0.5, val: 0.6 },
      }),
    ).rejects.toThrow(/Split ratios must sum to 1\.0/);
  });

  it("throws when pose labels have no skeleton", async () => {
    const labels = new Labels({ labeledFrames: [], skeletons: [] });
    await expect(writeLabels(labels, path.join(tmp, "noskel"))).rejects.toThrow(
      /at least one skeleton/,
    );
  });

  it("creates three-way splits via the fallback splitter", async () => {
    const skeleton = new Skeleton([new Node("a")]);
    const frames: LabeledFrame[] = [];
    for (let i = 0; i < 10; i++) {
      const imgPath = writeTestPng(tmp, `tw_${i}.png`, 16, 16);
      const instance = Instance.fromNumpy({
        pointsData: [[i, i, 1]],
        skeleton,
      });
      frames.push(
        new LabeledFrame({
          video: new Video({ filename: imgPath, openBackend: false }),
          frameIdx: 0,
          instances: [instance],
        }),
      );
    }
    const labels = new Labels({ labeledFrames: frames, skeletons: [skeleton] });
    const outDir = path.join(tmp, "three_way");
    await writeLabels(labels, outDir, {
      splitRatios: { train: 0.6, val: 0.2, test: 0.2 },
      verbose: false,
    });
    expect(fs.readdirSync(path.join(outDir, "train", "images")).length).toBe(6);
    expect(fs.readdirSync(path.join(outDir, "val", "images")).length).toBe(2);
    expect(fs.readdirSync(path.join(outDir, "test", "images")).length).toBe(2);
  });
});

// ===========================================================================
// normalize / denormalize
// ===========================================================================

describe("coordinate normalization", () => {
  it("normalizes coordinates", () => {
    const skeleton = new Skeleton([new Node("node1"), new Node("node2")]);
    const instance = Instance.fromNumpy({
      pointsData: [
        [100, 200, 1],
        [0, 0, 0],
      ],
      skeleton,
    });
    const normalized = normalizeCoordinates(instance, [400, 800]);
    expect(normalized[0]).toEqual([0.125, 0.5, 2]); // 100/800, 200/400
    expect(normalized[1]).toEqual([0.0, 0.0, 0]);
  });

  it("denormalizes coordinates", () => {
    const out = denormalizeCoordinates(
      [
        [0.125, 0.5, 2],
        [0.0, 0.0, 0],
      ],
      [400, 800],
    );
    expect(out[0][0]).toBe(100.0);
    expect(out[0][1]).toBe(200.0);
    expect(out[0][2]).toBe(1);
    expect(Number.isNaN(out[1][0])).toBe(true);
    expect(Number.isNaN(out[1][1])).toBe(true);
    expect(out[1][2]).toBe(0);
  });
});

// ===========================================================================
// Detection format
// ===========================================================================

describe("detection format", () => {
  function createDetectionDataset(base: string, withConfidence = false): void {
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "data.yaml"),
      "path: .\ntask: detect\nnames:\n  0: cat\n  1: dog\ntrain: train/images\n",
    );
    const imagesDir = path.join(base, "train", "images");
    const labelsDir = path.join(base, "train", "labels");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(labelsDir, { recursive: true });
    writeTestPng(imagesDir, "frame_000.png", 200, 100); // width 200, height 100
    const content = withConfidence
      ? "0 0.5 0.5 0.4 0.6 0.95\n1 0.25 0.25 0.2 0.3 0.85\n"
      : "0 0.5 0.5 0.4 0.6\n1 0.25 0.25 0.2 0.3\n";
    fs.writeFileSync(path.join(labelsDir, "frame_000.txt"), content);
  }

  it("reads + writes a detection dataset round-trip", async () => {
    const datasetPath = path.join(tmp, "det");
    createDetectionDataset(datasetPath);

    const labels = readLabels(datasetPath, { split: "train" });
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.bboxes.length).toBe(2);
    expect(labels.rois.length).toBe(0);

    const bbox0 = labels.bboxes[0];
    expect(bbox0.category).toBe("cat");
    expect(bbox0).toBeInstanceOf(UserBoundingBox);
    expect(labels.bboxes[1].category).toBe("dog");
    for (const bbox of labels.bboxes) {
      expect(bbox.area).toBeGreaterThan(0);
    }

    const outPath = path.join(tmp, "det_out");
    await writeLabels(labels, outPath, {
      splitRatios: { train: 1.0 },
      task: "detect",
      verbose: false,
    });

    const outConfig = parseDataYaml(path.join(outPath, "data.yaml"));
    expect(outConfig.task).toBe("detect");
    expect("kpt_shape" in outConfig).toBe(false);

    const labels2 = readLabels(outPath, { split: "train" });
    expect(labels2.bboxes.length).toBe(2);
  });

  it("reads detection-with-confidence as PredictedBoundingBox", () => {
    const datasetPath = path.join(tmp, "det_conf");
    createDetectionDataset(datasetPath, true);
    const labels = readLabels(datasetPath, { split: "train" });
    expect(labels.bboxes.length).toBe(2);
    expect(labels.rois.length).toBe(0);

    const bbox0 = labels.bboxes[0] as PredictedBoundingBox;
    expect(bbox0).toBeInstanceOf(PredictedBoundingBox);
    expect(bbox0.category).toBe("cat");
    expect(bbox0.score).toBeCloseTo(0.95, 4);

    const bbox1 = labels.bboxes[1] as PredictedBoundingBox;
    expect(bbox1).toBeInstanceOf(PredictedBoundingBox);
    expect(bbox1.category).toBe("dog");
    expect(bbox1.score).toBeCloseTo(0.85, 4);
  });

  it("normalizes/denormalizes detection coordinates correctly", () => {
    const labelFile = path.join(tmp, "det.txt");
    fs.writeFileSync(labelFile, "0 0.5 0.5 0.4 0.6\n");
    const { instances, rois, bboxes } = parseLabelFile(
      labelFile,
      new Skeleton([]),
      [100, 200],
      {
        classNames: new Map([[0, "obj"]]),
      },
    );
    expect(instances.length).toBe(0);
    expect(rois.length).toBe(0);
    expect(bboxes.length).toBe(1);

    const bbox = bboxes[0];
    expect(bbox.xCenter).toBeCloseTo(100.0, 4); // 0.5 * 200
    expect(bbox.yCenter).toBeCloseTo(50.0, 4); // 0.5 * 100
    expect(bbox.width).toBeCloseTo(80.0, 4); // 0.4 * 200
    expect(bbox.height).toBeCloseTo(60.0, 4); // 0.6 * 100

    const labelOut = path.join(tmp, "det_out.txt");
    writeBboxLabelFile(labelOut, bboxes, [100, 200], new Map([["obj", 0]]));
    const parts = fs.readFileSync(labelOut, "utf-8").trim().split(/\s+/);
    expect(parts[0]).toBe("0");
    expect(Number(parts[1])).toBeCloseTo(0.5, 4);
    expect(Number(parts[2])).toBeCloseTo(0.5, 4);
    expect(Number(parts[3])).toBeCloseTo(0.4, 4);
    expect(Number(parts[4])).toBeCloseTo(0.6, 4);
  });

  it("writes UserBoundingBox (5 values) and PredictedBoundingBox (6 values)", () => {
    const bboxes = [
      new UserBoundingBox({ x1: 60, y1: 20, x2: 140, y2: 80, category: "cat" }),
      new PredictedBoundingBox({
        x1: 30,
        y1: 10,
        x2: 70,
        y2: 40,
        category: "dog",
        score: 0.9,
      }),
    ];
    const labelPath = path.join(tmp, "bbox.txt");
    writeBboxLabelFile(
      labelPath,
      bboxes,
      [100, 200],
      new Map([
        ["cat", 0],
        ["dog", 1],
      ]),
    );
    const lines = fs.readFileSync(labelPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const parts0 = lines[0].split(" ");
    expect(parts0.length).toBe(5);
    expect(parts0[0]).toBe("0");
    expect(Number(parts0[1])).toBeCloseTo(0.5, 4);
    expect(Number(parts0[3])).toBeCloseTo(0.4, 4);

    const parts1 = lines[1].split(" ");
    expect(parts1.length).toBe(6);
    expect(parts1[0]).toBe("1");
    expect(Number(parts1[5])).toBeCloseTo(0.9, 4);

    // Round-trip.
    const { bboxes: readBack } = parseLabelFile(
      labelPath,
      new Skeleton([]),
      [100, 200],
      {
        classNames: new Map([
          [0, "cat"],
          [1, "dog"],
        ]),
      },
    );
    expect(readBack.length).toBe(2);
    expect(readBack[0]).toBeInstanceOf(UserBoundingBox);
    expect(readBack[0].category).toBe("cat");
    expect(readBack[1]).toBeInstanceOf(PredictedBoundingBox);
    expect((readBack[1] as PredictedBoundingBox).score).toBeCloseTo(0.9, 4);
  });
});

// ===========================================================================
// Segmentation format
// ===========================================================================

describe("segmentation format", () => {
  it("parses + writes a segmentation polygon round-trip", () => {
    const labelFile = path.join(tmp, "seg.txt");
    fs.writeFileSync(labelFile, "0 0.1 0.1 0.9 0.2 0.8 0.9 0.2 0.8\n");
    const { instances, rois, bboxes } = parseLabelFile(
      labelFile,
      new Skeleton([]),
      [100, 200],
      {
        classNames: new Map([[0, "animal"]]),
      },
    );
    expect(instances.length).toBe(0);
    expect(rois.length).toBe(1);
    expect(bboxes.length).toBe(0);

    const roi = rois[0];
    expect(roi.isBbox).toBe(false);
    expect(roi.category).toBe("animal");
    expect(roi.area).toBeGreaterThan(0);

    const coords = (roi.geometry as { coordinates: number[][][] })
      .coordinates[0];
    expect(coords.length).toBe(5); // 4 vertices + closing point
    expect(coords[0][0]).toBeCloseTo(0.1 * 200, 4);
    expect(coords[0][1]).toBeCloseTo(0.1 * 100, 4);

    const labelOut = path.join(tmp, "seg_out.txt");
    writeRoiLabelFile(labelOut, rois, [100, 200], new Map([["animal", 0]]));
    const { rois: rois2, bboxes: bboxes2 } = parseLabelFile(
      labelOut,
      new Skeleton([]),
      [100, 200],
      {
        classNames: new Map([[0, "animal"]]),
      },
    );
    expect(rois2.length).toBe(1);
    expect(bboxes2.length).toBe(0);
    expect(rois2[0].isBbox).toBe(false);
    expect(Math.abs(roi.area - rois2[0].area) / roi.area).toBeLessThan(0.01);
  });

  it("explodes MultiPolygon ROIs into separate lines", () => {
    const multi = UserROI.fromMultiPolygon(
      [
        [
          [
            [0, 0],
            [50, 0],
            [50, 50],
            [0, 50],
            [0, 0],
          ],
        ],
        [
          [
            [60, 60],
            [100, 60],
            [100, 100],
            [60, 100],
            [60, 60],
          ],
        ],
      ],
      { category: "obj" },
    );
    const labelPath = path.join(tmp, "multi.txt");
    writeRoiLabelFile(labelPath, [multi], [200, 200], new Map([["obj", 0]]));
    const lines = fs.readFileSync(labelPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2); // one line per polygon
  });

  it("warns and drops holes for polygons with interior rings", () => {
    // Non-rectangular exterior so isBbox=false (segmentation path).
    const exterior = [
      [0, 0],
      [100, 0],
      [80, 100],
      [0, 100],
      [0, 0],
    ];
    const hole = [
      [25, 25],
      [50, 25],
      [50, 50],
      [25, 50],
      [25, 25],
    ];
    const roi = new UserROI({
      geometry: { type: "Polygon", coordinates: [exterior, hole] },
      category: "obj",
    });
    const labelPath = path.join(tmp, "hole.txt");
    writeRoiLabelFile(labelPath, [roi], [200, 200], new Map([["obj", 0]]));
    const lines = fs.readFileSync(labelPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1); // exterior only
  });

  it("splits ROIs across train/val per ratios (_writeRoiLabels via segment task)", async () => {
    const labeledFrames: LabeledFrame[] = [];
    for (let i = 0; i < 10; i++) {
      const imgPath = writeTestPng(tmp, `roi_${i}.png`, 50, 50);
      const video = new Video({ filename: imgPath, openBackend: false });
      const roi = UserROI.fromXyxy(5, 5, 25, 25, { category: "obj", video });
      const lf = new LabeledFrame({ video, frameIdx: 0, rois: [roi] });
      labeledFrames.push(lf);
    }
    const labels = new Labels({ labeledFrames });
    const datasetPath = path.join(tmp, "roi_dataset");
    await writeLabels(labels, datasetPath, {
      splitRatios: { train: 0.8, val: 0.2 },
      task: "segment",
      verbose: false,
    });

    expect(
      fs.readdirSync(path.join(datasetPath, "train", "images")).length,
    ).toBe(8);
    expect(fs.readdirSync(path.join(datasetPath, "val", "images")).length).toBe(
      2,
    );
    expect(
      fs.readdirSync(path.join(datasetPath, "train", "labels")).length,
    ).toBe(8);
    expect(fs.readdirSync(path.join(datasetPath, "val", "labels")).length).toBe(
      2,
    );
  });
});

// ===========================================================================
// class-name builders + splits
// ===========================================================================

describe("class-name builders", () => {
  it("builds class names from bbox categories (sorted)", () => {
    const bboxes = [
      new UserBoundingBox({ x1: 0, y1: 0, x2: 1, y2: 1, category: "dog" }),
      new UserBoundingBox({ x1: 0, y1: 0, x2: 1, y2: 1, category: "cat" }),
    ];
    const names = buildClassNamesFromBboxes(bboxes);
    expect(names.get(0)).toBe("cat");
    expect(names.get(1)).toBe("dog");
  });

  it("falls back to {0: object} when no categories", () => {
    expect(buildClassNamesFromRois([]).get(0)).toBe("object");
  });
});

// ===========================================================================
// readLabelsSet
// ===========================================================================

describe("readLabelsSet", () => {
  function createDataset(base: string, splits: string[]): void {
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "data.yaml"),
      "path: .\ntrain: train/images\nval: val/images\ntest: test/images\nkpt_shape: [3, 2]\nnames: [animal]\n",
    );
    for (const split of splits) {
      const imagesDir = path.join(base, split, "images");
      const labelsDir = path.join(base, split, "labels");
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.mkdirSync(labelsDir, { recursive: true });
      for (let i = 0; i < 2; i++) {
        writeTestPng(
          imagesDir,
          `img_${String(i).padStart(3, "0")}.png`,
          10,
          10,
        );
        fs.writeFileSync(
          path.join(labelsDir, `img_${String(i).padStart(3, "0")}.txt`),
          "0 0.5 0.5 0.4 0.4 0.4 0.4 2 0.5 0.5 2 0.6 0.6 2\n",
        );
      }
    }
  }

  it("loads a LabelsSet from a dataset", () => {
    const datasetPath = path.join(tmp, "yolo");
    createDataset(datasetPath, ["train", "val"]);
    const set = readLabelsSet(datasetPath);
    expect(set).toBeInstanceOf(LabelsSet);
    expect(set.size).toBe(2);
    expect(set.get("train")).toBeDefined();
    expect(set.get("val")).toBeDefined();
    for (const split of ["train", "val"]) {
      const labels = set.get(split)!;
      expect(labels.labeledFrames.length).toBe(2);
      expect(labels.skeletons[0].nodes.length).toBe(3);
    }
  });

  it("loads specific splits only", () => {
    const datasetPath = path.join(tmp, "yolo");
    createDataset(datasetPath, ["train", "val", "test"]);
    const set = readLabelsSet(datasetPath, { splits: ["train", "test"] });
    expect(set.size).toBe(2);
    expect(set.get("train")).toBeDefined();
    expect(set.get("test")).toBeDefined();
    expect(set.get("val")).toBeUndefined();
  });

  it("uses a custom skeleton", () => {
    const datasetPath = path.join(tmp, "yolo");
    createDataset(datasetPath, ["train"]);
    const skeleton = new Skeleton([
      new Node("head"),
      new Node("body"),
      new Node("tail"),
    ]);
    const set = readLabelsSet(datasetPath, { skeleton });
    expect(set.get("train")!.skeletons[0].nodes[0].name).toBe("head");
    expect(set.get("train")!.skeletons[0].nodes[2].name).toBe("tail");
  });

  it("ignores missing splits", () => {
    const datasetPath = path.join(tmp, "yolo");
    createDataset(datasetPath, ["train"]);
    const set = readLabelsSet(datasetPath, {
      splits: ["train", "val", "test"],
    });
    expect(set.size).toBe(1);
    expect(set.get("train")).toBeDefined();
  });

  it("throws when no splits are found", () => {
    const datasetPath = path.join(tmp, "empty");
    fs.mkdirSync(datasetPath, { recursive: true });
    expect(() => readLabelsSet(datasetPath)).toThrow(/No splits found/);
  });

  it("auto-detects available splits (train + valid)", () => {
    const datasetPath = path.join(tmp, "yolo");
    createDataset(datasetPath, ["train", "valid"]);
    const set = readLabelsSet(datasetPath);
    expect(set.size).toBe(2);
    expect(set.get("train")).toBeDefined();
    expect(set.get("valid")).toBeDefined();
  });
});

// ===========================================================================
// createSplitsFromLabels
// ===========================================================================

describe("createSplitsFromLabels", () => {
  function dummyLabels(n: number): Labels {
    const skeleton = new Skeleton([new Node("a")]);
    const frames = Array.from({ length: n }, (_, i) => {
      const instance = Instance.fromNumpy({
        pointsData: [[i, i, 1]],
        skeleton,
      });
      return new LabeledFrame({
        video: new Video({ filename: `f_${i}.mp4`, openBackend: false }),
        frameIdx: i,
        instances: [instance],
      });
    });
    return new Labels({ labeledFrames: frames, skeletons: [skeleton] });
  }

  it("creates two-way splits with correct counts", () => {
    const splits = createSplitsFromLabels(dummyLabels(10), {
      train: 0.8,
      val: 0.2,
    });
    expect(splits.train.labeledFrames.length).toBe(8);
    expect(splits.val.labeledFrames.length).toBe(2);
  });

  it("creates three-way splits with correct counts", () => {
    const splits = createSplitsFromLabels(dummyLabels(10), {
      train: 0.6,
      val: 0.2,
      test: 0.2,
    });
    expect(splits.train.labeledFrames.length).toBe(6);
    expect(splits.val.labeledFrames.length).toBe(2);
    expect(splits.test.labeledFrames.length).toBe(2);
  });
});

// ===========================================================================
// Image prober + PNG encoder (JS-specific)
// ===========================================================================

describe("probeImageSize", () => {
  it("reads JPEG dimensions from the fixture", () => {
    const shape = probeImageSize(
      path.join(ultralyticsDataset, "train", "images", "image_001.jpg"),
    );
    expect(shape).toEqual([480, 640]); // [height, width]
  });

  it("reads PNG dimensions written by encodePng", () => {
    const p = writeTestPng(tmp, "probe.png", 123, 45);
    expect(probeImageSize(p)).toEqual([45, 123]);
  });

  it("returns null for non-image files", () => {
    const p = path.join(tmp, "garbage.bin");
    fs.writeFileSync(p, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(probeImageSize(p)).toBeNull();
  });
});

describe("encodePng", () => {
  it("produces a valid PNG signature + probeable dimensions", () => {
    const png = encodePng(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
    // PNG signature.
    expect(Array.from(png.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const p = path.join(tmp, "enc.png");
    fs.writeFileSync(p, png);
    expect(probeImageSize(p)).toEqual([4, 4]);
  });
});

// ===========================================================================
// Python-parity edge cases (locked in after adversarial review)
// ===========================================================================

describe("Python-parity edge cases", () => {
  it("skips pose lines with non-numeric bbox columns (Python validates parts[1:5])", () => {
    const skeleton = new Skeleton([new Node("a")]); // 1 node
    const labelFile = path.join(tmp, "badbbox.txt");
    // 8 tokens → pose; bbox columns non-numeric but keypoints valid + matching.
    fs.writeFileSync(labelFile, "0 bad bad bad bad 0.1 0.1 2\n");
    const { instances } = parseLabelFile(labelFile, skeleton, [100, 100]);
    expect(instances.length).toBe(0);
  });

  it("rejects radix-prefixed numeric literals like Python float()", () => {
    const labelFile = path.join(tmp, "hex.txt");
    fs.writeFileSync(labelFile, "0 0x10 0.5 0.5 0.5\n"); // 5 tokens → detection
    const { bboxes } = parseLabelFile(labelFile, new Skeleton([]), [100, 200], {
      classNames: new Map([[0, "obj"]]),
    });
    expect(bboxes.length).toBe(0); // 0x10 is invalid → line skipped
  });

  it("accepts scientific-notation floats", () => {
    const labelFile = path.join(tmp, "sci.txt");
    fs.writeFileSync(labelFile, "0 5e-1 0.5 0.4 0.6\n");
    const { bboxes } = parseLabelFile(labelFile, new Skeleton([]), [100, 200], {
      classNames: new Map([[0, "obj"]]),
    });
    expect(bboxes.length).toBe(1);
    expect(bboxes[0].xCenter).toBeCloseTo(0.5 * 200, 4);
  });

  it("ignores .tif and .gif images in the reader (Python uses .tiff/.jpg/.jpeg/.png/.bmp)", () => {
    const ds = path.join(tmp, "exts");
    fs.mkdirSync(path.join(ds, "train", "images"), { recursive: true });
    fs.mkdirSync(path.join(ds, "train", "labels"), { recursive: true });
    fs.writeFileSync(
      path.join(ds, "data.yaml"),
      "kpt_shape: [1, 3]\ntrain: train/images\nnames: [animal]\n",
    );
    writeTestPng(path.join(ds, "train", "images"), "a.png", 10, 10);
    // A GIF header (10x10) that the reader must ignore.
    fs.writeFileSync(
      path.join(ds, "train", "images", "b.gif"),
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 10, 0]),
    );
    fs.writeFileSync(
      path.join(ds, "train", "labels", "a.txt"),
      "0 0.5 0.5 0.2 0.2 0.5 0.5 2\n",
    );
    fs.writeFileSync(
      path.join(ds, "train", "labels", "b.txt"),
      "0 0.5 0.5 0.2 0.2 0.5 0.5 2\n",
    );
    const labels = readLabels(ds, { split: "train" });
    expect(labels.labeledFrames.length).toBe(1); // only a.png
  });

  it("uses banker's rounding for detect/segment split boundaries", async () => {
    const lfs: LabeledFrame[] = [];
    for (let i = 0; i < 5; i++) {
      const imgPath = writeTestPng(tmp, `bk_${i}.png`, 20, 20);
      const video = new Video({ filename: imgPath, openBackend: false });
      const roi = UserROI.fromXyxy(1, 1, 5, 5, { category: "obj", video });
      lfs.push(new LabeledFrame({ video, frameIdx: 0, rois: [roi] }));
    }
    const labels = new Labels({ labeledFrames: lfs });
    const ds = path.join(tmp, "bankers");
    await writeLabels(labels, ds, {
      splitRatios: { train: 0.5, val: 0.5 },
      task: "segment",
      verbose: false,
    });
    // boundary train = roundHalfToEven(0.5*5 = 2.5) = 2; val gets the remaining 3.
    expect(fs.readdirSync(path.join(ds, "train", "images")).length).toBe(2);
    expect(fs.readdirSync(path.join(ds, "val", "images")).length).toBe(3);
  });

  it("accepts split ratios within np.isclose tolerance (sum ~0.999999)", async () => {
    const skeleton = new Skeleton([new Node("p")]);
    const imgPath = writeTestPng(tmp, "tol.png", 16, 16);
    const instance = Instance.fromNumpy({ pointsData: [[5, 5, 1]], skeleton });
    const frame = new LabeledFrame({
      video: new Video({ filename: imgPath, openBackend: false }),
      frameIdx: 0,
      instances: [instance],
    });
    const labels = new Labels({
      labeledFrames: [frame],
      skeletons: [skeleton],
    });
    // 0.999999 is within ~1e-5 of 1.0 → accepted (was rejected by the old 1e-8 tolerance).
    await writeLabels(labels, path.join(tmp, "tol"), {
      splitRatios: { train: 0.999999 },
    });
    expect(fs.existsSync(path.join(tmp, "tol", "data.yaml"))).toBe(true);
  });

  it("leaves a filename gap when a frame image cannot be written (enumerate parity)", async () => {
    const skeleton = new Skeleton([new Node("p")]);
    const mk = (name: string): LabeledFrame => {
      const imgPath = writeTestPng(tmp, name, 16, 16);
      const inst = Instance.fromNumpy({ pointsData: [[5, 5, 1]], skeleton });
      return new LabeledFrame({
        video: new Video({ filename: imgPath, openBackend: false }),
        frameIdx: 0,
        instances: [inst],
      });
    };
    const good0 = mk("g0.png");
    // Middle frame: a non-existent, non-image source → skipped on write.
    const bad = new LabeledFrame({
      video: new Video({
        filename: path.join(tmp, "missing.mp4"),
        openBackend: false,
      }),
      frameIdx: 7,
      instances: [Instance.fromNumpy({ pointsData: [[5, 5, 1]], skeleton })],
    });
    const good2 = mk("g2.png");
    const labels = new Labels({
      labeledFrames: [good0, bad, good2],
      skeletons: [skeleton],
    });
    const ds = path.join(tmp, "gap");
    await writeLabels(labels, ds, { splitRatios: { train: 1.0 } });
    const images = fs.readdirSync(path.join(ds, "train", "images")).sort();
    expect(images).toEqual(["0000000.png", "0000002.png"]); // gap at index 1
  });
});
