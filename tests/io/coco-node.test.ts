import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "../bun-test";
import { loadCoco, loadCocoSet } from "../../src/io/coco-node.js";
import "../../src/model/mask.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const cocoRoot = path.join(fixtureRoot, "coco");

describe("loadCoco (Node)", () => {
  it("loads flat_images annotations from disk", () => {
    const labels = loadCoco(
      path.join(cocoRoot, "flat_images", "annotations.json"),
    );
    expect(labels.labeledFrames.length).toBe(3);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(3);
    expect(labels.labeledFrames[1].instances.length).toBe(1);
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].name).toBe("mouse");
  });

  it("resolves deeply nested image paths and produces frames", () => {
    const labels = loadCoco(
      path.join(cocoRoot, "nested_paths", "annotations.json"),
    );
    expect(labels.labeledFrames.length).toBe(3);
    expect(labels.skeletons.length).toBe(1);
    for (const f of labels.labeledFrames) {
      expect(f.video).not.toBeNull();
    }
  });

  it("throws when the annotation file is missing", () => {
    expect(() => loadCoco("/does/not/exist.json")).toThrow(
      /COCO annotation file not found/,
    );
  });
});

// Ports of Python tests in tests/io/test_coco.py:
// TestCOCODatasetVariants.test_category_folders / test_visibility_binary /
// test_visibility_ternary / test_multi_source. These exercise the on-disk
// fixtures whose images live in category/source subfolders, which only the
// Node loader can resolve.
describe("loadCoco dataset variants (fixtures)", () => {
  it("category_folders: per-category skeletons and instances", () => {
    // Images organized in mouse/ and fly/ subfolders, each annotation in a
    // distinct image: two mouse (17 kp) + one fly (13 kp) = 3 frames.
    const labels = loadCoco(
      path.join(cocoRoot, "category_folders", "annotations.json"),
    );
    expect(labels.labeledFrames.length).toBe(3);
    expect(labels.skeletons.length).toBe(2);
    const names = labels.skeletons.map((s) => s.name).sort();
    expect(names).toEqual(["fly", "mouse"]);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(3);
    // Distinct skeletons carry the expected node counts.
    const nodeCounts = labels.skeletons
      .map((s) => s.nodeNames.length)
      .sort((a, b) => a - b);
    expect(nodeCounts).toEqual([13, 17]);
  });

  it("visibility_binary: v=0 -> invisible NaN, v=1 -> visible", () => {
    // Binary encoding (0=not visible, 1=visible); ann 0 has 6 zeros + 11 ones.
    const labels = loadCoco(
      path.join(cocoRoot, "visibility_binary", "annotations.json"),
    );
    expect(labels.labeledFrames.length).toBe(3);
    const instance = labels.labeledFrames[0].instances[0];
    const totalPoints = instance.points.length;
    const visibleCount = instance.points.filter((p) => p.visible).length;
    // Some points visible, some not (mirrors the Python assertions).
    expect(visibleCount).toBeGreaterThan(0);
    expect(visibleCount).toBeLessThan(totalPoints);
    // v=0 points decode to NaN coordinates; visible ones are finite.
    for (const p of instance.points) {
      if (p.visible) {
        expect(Number.isNaN(p.xy[0])).toBe(false);
        expect(Number.isNaN(p.xy[1])).toBe(false);
      } else {
        expect(Number.isNaN(p.xy[0])).toBe(true);
        expect(Number.isNaN(p.xy[1])).toBe(true);
      }
    }
  });

  it("visibility_ternary: v=0 invisible, v=1/v=2 visible", () => {
    // Ternary encoding (0=not labeled, 1=labeled occluded, 2=labeled visible);
    // ann 0 has 6 zeros, 6 ones, 5 twos. Both v=1 and v=2 read as visible.
    const labels = loadCoco(
      path.join(cocoRoot, "visibility_ternary", "annotations.json"),
    );
    expect(labels.labeledFrames.length).toBe(3);
    const instance = labels.labeledFrames[0].instances[0];
    const totalPoints = instance.points.length;
    const visibleCount = instance.points.filter((p) => p.visible).length;
    expect(visibleCount).toBeGreaterThan(0);
    expect(visibleCount).toBeLessThan(totalPoints);
    // 11 keypoints visible (v=1 plus v=2), 6 not (v=0 -> NaN).
    expect(visibleCount).toBe(11);
    for (const p of instance.points) {
      expect(Number.isNaN(p.xy[0])).toBe(!p.visible);
      expect(Number.isNaN(p.xy[1])).toBe(!p.visible);
    }
  });

  it("multi_source: groups images from multiple source folders", () => {
    // Images split across source1/ and source2/; single mouse skeleton,
    // one instance per image across 3 frames.
    const labels = loadCoco(
      path.join(cocoRoot, "multi_source", "annotations.json"),
    );
    expect(labels.labeledFrames.length).toBe(3);
    expect(labels.skeletons.length).toBe(1);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(3);
    // Same-shape images (all 384x384) are grouped under a single Video.
    const videos = new Set(labels.labeledFrames.map((f) => f.video));
    expect(videos.size).toBe(1);
  });
});

describe("loadCoco image resolution / skipping", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-node-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves via 'images' prefix and skips missing images (no frame)", () => {
    const imagesDir = path.join(tmpDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, "present.png"), "");
    const data = {
      images: [
        { id: 1, file_name: "present.png", height: 10, width: 10 },
        { id: 2, file_name: "absent.png", height: 10, width: 10 },
      ],
      annotations: [],
      categories: [{ id: 1, name: "x" }],
    };
    const jsonPath = path.join(tmpDir, "prefix.json");
    fs.writeFileSync(jsonPath, JSON.stringify(data));
    const labels = loadCoco(jsonPath);
    // Only the resolvable image becomes a frame.
    expect(labels.labeledFrames.length).toBe(1);
  });
});

describe("loadCocoSet (Node)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-set-"));
    // Two splits referencing images by basename; create flat image stubs.
    fs.writeFileSync(path.join(tmpDir, "image_001.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "image_002.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "image_003.jpg"), "");
    fs.copyFileSync(
      path.join(cocoRoot, "flat_images", "annotations.json"),
      path.join(tmpDir, "train.json"),
    );
    fs.copyFileSync(
      path.join(cocoRoot, "mixed_animals", "annotations.json"),
      path.join(tmpDir, "val.json"),
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("auto-discovers *.json keyed by stem with independent tracks", () => {
    const result = loadCocoSet(tmpDir);
    expect(Object.keys(result).sort()).toEqual(["train", "val"]);
    expect(result.train.skeletons.length).toBe(1);
    expect(result.val.skeletons.length).toBe(2);
    expect(result.train.provenance.split).toBe("train");
  });

  it("respects an explicit jsonFiles list", () => {
    const result = loadCocoSet(tmpDir, { jsonFiles: ["train.json"] });
    expect(Object.keys(result)).toEqual(["train"]);
  });

  it("throws when no JSON files are present", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "coco-empty-"));
    try {
      expect(() => loadCocoSet(emptyDir)).toThrow(
        /No JSON annotation files found/,
      );
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
