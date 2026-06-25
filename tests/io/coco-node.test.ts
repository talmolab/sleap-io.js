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
