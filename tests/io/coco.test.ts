import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "../bun-test";
import {
  type CocoJson,
  createSkeletonFromCategory,
  decodeCocoRle,
  decodeCompressedRleCounts,
  decodeKeypoints,
  decodeSegmentation,
  isCocoData,
  parseCocoJson,
  readCoco,
  readCocoSet,
} from "../../src/io/coco.js";
import "../../src/model/mask.js"; // register mask factory for ROI.toMask
import { PredictedBoundingBox, UserBoundingBox } from "../../src/model/bbox.js";
import {
  PredictedSegmentationMask,
  UserSegmentationMask,
} from "../../src/model/mask.js";
import { PredictedROI, UserROI } from "../../src/model/roi.js";
import { Skeleton } from "../../src/model/skeleton.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const cocoRoot = path.join(fixtureRoot, "coco");

function loadFixture(...parts: string[]): CocoJson {
  return JSON.parse(fs.readFileSync(path.join(cocoRoot, ...parts), "utf-8"));
}

describe("createSkeletonFromCategory", () => {
  it("creates 1-based edges from skeleton connections", () => {
    const skel = createSkeletonFromCategory({
      id: 1,
      name: "x",
      keypoints: ["a", "b", "c"],
      skeleton: [
        [1, 2],
        [2, 3],
      ],
    });
    expect(skel.nodeNames).toEqual(["a", "b", "c"]);
    expect(skel.edges.length).toBe(2);
    expect(skel.edges[0].source.name).toBe("a");
    expect(skel.edges[0].destination.name).toBe("b");
    expect(skel.edges[1].source.name).toBe("b");
    expect(skel.edges[1].destination.name).toBe("c");
  });

  it("handles empty skeleton (CVAT) with zero edges", () => {
    const skel = createSkeletonFromCategory({
      id: 1,
      name: "m",
      keypoints: ["a", "b"],
      skeleton: [],
    });
    expect(skel.edges.length).toBe(0);
    expect(skel.nodeNames).toEqual(["a", "b"]);
  });

  it("skips out-of-range and non-pair connections", () => {
    const skel = createSkeletonFromCategory({
      id: 1,
      name: "m",
      keypoints: ["a", "b"],
      skeleton: [
        [1, 2],
        [1, 5], // out of range
        [1, 2, 3] as unknown as number[], // not a pair
      ],
    });
    expect(skel.edges.length).toBe(1);
  });

  it("throws when keypoints are missing", () => {
    expect(() => createSkeletonFromCategory({ id: 1, name: "m" })).toThrow(
      /no keypoint definitions/,
    );
  });
});

describe("decodeKeypoints", () => {
  const skel = new Skeleton({ nodes: ["a", "b"], name: "s" });

  it("maps v=0 to NaN invisible and others to visible", () => {
    const pts = decodeKeypoints([10, 20, 0, 30, 40, 2], 2, skel);
    expect(Number.isNaN(pts[0][0])).toBe(true);
    expect(Number.isNaN(pts[0][1])).toBe(true);
    expect(pts[0][2]).toBe(0);
    expect(pts[1]).toEqual([30, 40, 1]);
  });

  it("treats v=1, v=2, and unknown values as visible", () => {
    const skel3 = new Skeleton({ nodes: ["a", "b", "c"], name: "s" });
    const pts = decodeKeypoints([1, 1, 1, 2, 2, 2, 3, 3, 99], 3, skel3);
    expect(pts[0]).toEqual([1, 1, 1]);
    expect(pts[1]).toEqual([2, 2, 1]);
    expect(pts[2]).toEqual([3, 3, 1]);
  });

  it("throws on length mismatch", () => {
    expect(() => decodeKeypoints([1, 2, 1], 2, skel)).toThrow(
      /doesn't match expected/,
    );
  });

  it("throws on node/keypoint count mismatch", () => {
    const skel3 = new Skeleton({ nodes: ["a", "b", "c"], name: "s" });
    expect(() => decodeKeypoints([1, 2, 1, 3, 4, 1], 2, skel3)).toThrow(
      /Skeleton has 3 nodes/,
    );
  });
});

describe("RLE decoders", () => {
  it("decodeCompressedRleCounts('05d0') = [0, 5, 20]", () => {
    expect(decodeCompressedRleCounts("05d0")).toEqual([0, 5, 20]);
  });

  it("decodeCocoRle uncompressed [0,5,5,5,5] fills columns 0 and 2", () => {
    const mask = decodeCocoRle([0, 5, 5, 5, 5], [5, 5]);
    for (let r = 0; r < 5; r++) {
      expect(mask[r][0]).toBe(true);
      expect(mask[r][1]).toBe(false);
      expect(mask[r][2]).toBe(true);
    }
  });

  it("decodeCocoRle compressed '05d0' fills the entire first column", () => {
    const mask = decodeCocoRle("05d0", [5, 5]);
    for (let r = 0; r < 5; r++) {
      expect(mask[r][0]).toBe(true);
      for (let c = 1; c < 5; c++) expect(mask[r][c]).toBe(false);
    }
  });

  it("decodeCocoRle compressed '01;000' is the main diagonal", () => {
    const mask = decodeCocoRle("01;000", [5, 5]);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        expect(mask[r][c]).toBe(r === c && (r === 0 || r === 2 || r === 4));
      }
    }
    // Pin the three diagonal pixels explicitly.
    expect(mask[0][0]).toBe(true);
    expect(mask[2][2]).toBe(true);
    expect(mask[4][4]).toBe(true);
    expect(mask[1][1]).toBe(false);
    expect(mask[3][3]).toBe(false);
  });
});

describe("isCocoData", () => {
  it("true for object with three arrays", () => {
    expect(isCocoData({ images: [], annotations: [], categories: [] })).toBe(
      true,
    );
  });
  it("false for an array", () => {
    expect(isCocoData([1, 2, 3])).toBe(false);
  });
  it("false when a required array is missing", () => {
    expect(isCocoData({ images: [], annotations: [] })).toBe(false);
  });
});

describe("parseCocoJson / validation", () => {
  it("throws on missing required field", () => {
    expect(() =>
      parseCocoJson({ images: [], annotations: [] } as unknown as CocoJson),
    ).toThrow(/Missing required COCO field: categories/);
  });

  it("readCoco throws on invalid segmentationFormat before parsing", () => {
    expect(() =>
      readCoco(
        { images: [], annotations: [], categories: [] },
        {
          segmentationFormat: "bogus" as unknown as "mask",
        },
      ),
    ).toThrow(/segmentationFormat must be 'mask' or 'roi'/);
  });
});

describe("readCoco flat images (fixtures)", () => {
  it("annotations.json: 3 frames, 3 instances, frame[1] has 1", () => {
    const json = loadFixture("flat_images", "annotations.json");
    const labels = readCoco(json, { datasetRoot: "/fake/root" });
    expect(labels.labeledFrames.length).toBe(3);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(3);
    expect(labels.labeledFrames[1].instances.length).toBe(1);
    expect(labels.labeledFrames[0].instances[0].points.length).toBe(17);
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].name).toBe("mouse");
  });

  it("annotations_negative_frame.json: 3 frames, 2 instances, frame[1] empty", () => {
    const json = loadFixture("flat_images", "annotations_negative_frame.json");
    const labels = readCoco(json, { datasetRoot: "/fake/root" });
    expect(labels.labeledFrames.length).toBe(3);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(2);
    expect(labels.labeledFrames[1].instances.length).toBe(0);
  });

  it("mixed animals: 2 skeletons, 2 instances per frame", () => {
    const json = loadFixture("mixed_animals", "annotations.json");
    const labels = readCoco(json, { datasetRoot: "/fake/root" });
    expect(labels.labeledFrames.length).toBe(3);
    expect(labels.skeletons.length).toBe(2);
    const total = labels.labeledFrames.reduce(
      (s, f) => s + f.instances.length,
      0,
    );
    expect(total).toBe(6);
    const names = labels.labeledFrames[0].instances
      .map((i) => i.skeleton.name)
      .sort();
    expect(names).toEqual(["fly", "mouse"]);
    const nodeCounts = labels.skeletons.map((s) => s.nodeNames.length).sort();
    expect(nodeCounts).toEqual([13, 17]);
  });
});

describe("readCoco shape grouping + videos", () => {
  it("shares a Video for same-shape images, sequential frame indices", () => {
    const data: CocoJson = {
      images: [
        { id: 1, file_name: "a.jpg", width: 100, height: 100 },
        { id: 2, file_name: "b.jpg", width: 100, height: 100 },
        { id: 3, file_name: "c.jpg", width: 200, height: 150 },
        { id: 4, file_name: "d.jpg", width: 100, height: 100 },
      ],
      annotations: [],
      categories: [{ id: 1, name: "x" }],
    };
    const labels = readCoco(data);
    expect(labels.labeledFrames.length).toBe(4);
    const v100 = labels.labeledFrames[0].video;
    expect(labels.labeledFrames[1].video).toBe(v100);
    expect(labels.labeledFrames[3].video).toBe(v100);
    expect(labels.labeledFrames[2].video).not.toBe(v100);
    // Frame indices: 100x100 group at 0,1,2; 200x150 group at 0.
    const idx100 = labels.labeledFrames
      .filter((f) => f.video === v100)
      .map((f) => f.frameIdx)
      .sort();
    expect(idx100).toEqual([0, 1, 2]);
    expect(labels.labeledFrames[2].frameIdx).toBe(0);
    expect(v100.shape).toEqual([3, 100, 100, 3]);
  });

  it("grayscale sets channel count to 1", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "a.jpg", width: 100, height: 100 }],
      annotations: [],
      categories: [{ id: 1, name: "x" }],
    };
    const rgb = readCoco(data);
    expect(rgb.labeledFrames[0].video.shape?.[3]).toBe(3);
    const gray = readCoco(data, { grayscale: true });
    expect(gray.labeledFrames[0].video.shape?.[3]).toBe(1);
    expect(gray.labeledFrames[0].video.backendMetadata.grayscale).toBe(true);
  });

  it("duplicate file_name entries get distinct frames", () => {
    const data: CocoJson = {
      images: [
        { id: 10, file_name: "dup.png", height: 40, width: 40 },
        { id: 11, file_name: "dup.png", height: 40, width: 40 },
        { id: 12, file_name: "dup.png", height: 40, width: 40 },
      ],
      annotations: [
        {
          id: 1,
          image_id: 10,
          category_id: 1,
          segmentation: [[1, 1, 10, 1, 10, 10, 1, 10]],
        },
        {
          id: 2,
          image_id: 11,
          category_id: 1,
          segmentation: [[2, 2, 12, 2, 12, 12, 2, 12]],
        },
        {
          id: 3,
          image_id: 12,
          category_id: 1,
          segmentation: [[3, 3, 13, 3, 13, 13, 3, 13]],
        },
      ],
      categories: [{ id: 1, name: "obj" }],
    };
    const labels = readCoco(data);
    expect(labels.labeledFrames.length).toBe(3);
    expect(labels.labeledFrames.map((f) => f.frameIdx).sort()).toEqual([
      0, 1, 2,
    ]);
    expect(labels.labeledFrames.every((f) => f.masks.length === 1)).toBe(true);
    expect(labels.masks.length).toBe(3);
  });
});

describe("readCoco detection-only", () => {
  it("polygon + RLE -> two masks, bbox-only -> one UserBoundingBox", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "image_001.png", height: 100, width: 200 }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          bbox: [10, 20, 30, 40],
          iscrowd: 0,
        },
        {
          id: 2,
          image_id: 1,
          category_id: 2,
          segmentation: [[5, 5, 50, 5, 30, 50, 5, 50]],
          bbox: [5, 5, 45, 45],
          iscrowd: 0,
        },
        {
          id: 3,
          image_id: 1,
          category_id: 1,
          segmentation: { counts: [0, 5, 5, 5, 5], size: [5, 5] },
          bbox: [0, 0, 5, 5],
          iscrowd: 1,
        },
      ],
      categories: [
        { id: 1, name: "animal" },
        { id: 2, name: "plant" },
      ],
    };
    const labels = readCoco(data);
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.labeledFrames[0].instances.length).toBe(0);
    expect(labels.rois.length).toBe(0);
    expect(labels.masks.length).toBe(2);
    const byCat = new Map(labels.masks.map((m) => [m.category, m]));
    const plant = byCat.get("plant")!;
    expect(plant.height).toBe(100);
    expect(plant.width).toBe(200);
    expect(plant.area).toBeGreaterThan(0);
    const animal = byCat.get("animal")!;
    expect(animal.height).toBe(5);
    expect(animal.width).toBe(5);
    // iscrowd is ignored; RLE mask is a user mask.
    expect(animal).toBeInstanceOf(UserSegmentationMask);
    expect(labels.bboxes.length).toBe(1);
    expect(labels.bboxes[0].category).toBe("animal");
    expect(labels.bboxes[0]).toBeInstanceOf(UserBoundingBox);

    const roiLabels = readCoco(data, { segmentationFormat: "roi" });
    expect(roiLabels.rois.length).toBe(1);
    expect(roiLabels.rois[0].category).toBe("plant");
    expect(roiLabels.masks.length).toBe(1);
    expect(roiLabels.masks[0].category).toBe("animal");
    expect(roiLabels.bboxes.length).toBe(1);
  });

  it("bbox-only reads as UserBoundingBox with correct xywh", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "det.png", height: 200, width: 300 }],
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [15, 25, 50, 60] },
        { id: 2, image_id: 1, category_id: 1, bbox: [100, 110, 40, 30] },
      ],
      categories: [{ id: 1, name: "person" }],
    };
    const labels = readCoco(data);
    expect(labels.bboxes.length).toBe(2);
    expect(labels.rois.length).toBe(0);
    expect(labels.masks.length).toBe(0);
    for (const b of labels.bboxes) {
      expect(b).toBeInstanceOf(UserBoundingBox);
      expect(b.category).toBe("person");
    }
    expect(labels.bboxes[0].width).toBeCloseTo(50);
    expect(labels.bboxes[0].height).toBeCloseTo(60);
    expect(labels.bboxes[0].x1).toBeCloseTo(15);
    expect(labels.bboxes[0].y1).toBeCloseTo(25);
  });

  it("scored bbox -> PredictedBoundingBox with the score", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "pred.png", height: 100, width: 100 }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          bbox: [10, 20, 30, 40],
          score: 0.95,
        },
        {
          id: 2,
          image_id: 1,
          category_id: 1,
          bbox: [50, 60, 20, 15],
          score: 0.42,
        },
      ],
      categories: [{ id: 1, name: "cat" }],
    };
    const labels = readCoco(data);
    expect(labels.bboxes.length).toBe(2);
    for (const b of labels.bboxes) {
      expect(b).toBeInstanceOf(PredictedBoundingBox);
    }
    expect((labels.bboxes[0] as PredictedBoundingBox).score).toBeCloseTo(0.95);
    expect((labels.bboxes[1] as PredictedBoundingBox).score).toBeCloseTo(0.42);
    expect(labels.bboxes[0].x1).toBeCloseTo(10);
    expect(labels.bboxes[0].width).toBeCloseTo(30);
  });
});

describe("readCoco bbox fallback gating (#493)", () => {
  it("valid polygon -> mask, no spurious bbox", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "img.png", height: 100, width: 100 }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          segmentation: [[10, 10, 50, 10, 50, 50, 10, 50]],
          bbox: [10, 10, 40, 40],
        },
      ],
      categories: [{ id: 1, name: "obj" }],
    };
    const labels = readCoco(data);
    expect(labels.masks.length).toBe(1);
    expect(labels.rois.length).toBe(0);
    expect(labels.bboxes.length).toBe(0);
  });

  it("degenerate single-point ring -> fallback bbox", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "img.png", height: 100, width: 200 }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          segmentation: [[5, 5]],
          bbox: [2, 2, 10, 10],
        },
      ],
      categories: [{ id: 1, name: "animal" }],
    };
    const labels = readCoco(data);
    expect(labels.masks.length).toBe(0);
    expect(labels.rois.length).toBe(0);
    expect(labels.bboxes.length).toBe(1);
    expect(labels.bboxes[0]).toBeInstanceOf(UserBoundingBox);
    expect(labels.bboxes[0].x1).toBeCloseTo(2);
    expect(labels.bboxes[0].width).toBeCloseTo(10);
  });

  it("empty segmentation [] -> fallback bbox", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "img.png", height: 100, width: 200 }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          segmentation: [],
          bbox: [10, 20, 30, 40],
        },
      ],
      categories: [{ id: 1, name: "animal" }],
    };
    const labels = readCoco(data);
    expect(labels.masks.length).toBe(0);
    expect(labels.rois.length).toBe(0);
    expect(labels.bboxes.length).toBe(1);
  });
});

describe("readCoco scored segmentation -> predicted", () => {
  const data: CocoJson = {
    images: [{ id: 1, file_name: "pred.png", height: 30, width: 30 }],
    annotations: [
      {
        id: 1,
        image_id: 1,
        category_id: 1,
        score: 0.9,
        segmentation: [[2, 2, 15, 2, 15, 15, 2, 15]],
      },
      {
        id: 2,
        image_id: 1,
        category_id: 1,
        score: 0.7,
        segmentation: { counts: [0, 5, 5, 5, 5], size: [5, 5] },
      },
      {
        id: 3,
        image_id: 1,
        category_id: 1,
        segmentation: [[20, 20, 28, 20, 28, 28, 20, 28]],
      },
    ],
    categories: [{ id: 1, name: "obj" }],
  };

  it("mask mode: scored -> predicted, unscored -> user", () => {
    const labels = readCoco(data);
    const masks = labels.labeledFrames[0].masks;
    expect(masks.length).toBe(3);
    const predicted = masks.filter(
      (m) => m instanceof PredictedSegmentationMask,
    ) as PredictedSegmentationMask[];
    const user = masks.filter((m) => m.constructor === UserSegmentationMask);
    expect(predicted.length).toBe(2);
    expect(user.length).toBe(1);
    expect(predicted.map((m) => m.score).sort()).toEqual([0.7, 0.9]);
  });

  it("roi mode: scored polygon -> PredictedROI; scored RLE stays a mask", () => {
    const labels = readCoco(data, { segmentationFormat: "roi" });
    const rois = labels.labeledFrames[0].rois;
    expect(rois.map((r) => r.constructor)).toEqual([PredictedROI, UserROI]);
    expect((rois[0] as PredictedROI).score).toBeCloseTo(0.9);
    expect(labels.labeledFrames[0].masks.length).toBe(1);
  });
});

describe("readCoco polygon handling", () => {
  it("mask mode without dims falls back to one ROI", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "img.png" }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          segmentation: [[1, 1, 5, 1, 5, 5, 1, 5]],
        },
      ],
      categories: [{ id: 1, name: "obj" }],
    };
    const labels = readCoco(data);
    expect(labels.masks.length).toBe(0);
    expect(labels.rois.length).toBe(1);
    expect(labels.rois[0].category).toBe("obj");
  });

  it("multipolygon (two disjoint squares) -> single mask spanning both", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "img.png", height: 50, width: 50 }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          segmentation: [
            [1, 1, 10, 1, 10, 10, 1, 10],
            [20, 20, 30, 20, 30, 30, 20, 30],
          ],
        },
      ],
      categories: [{ id: 1, name: "obj" }],
    };
    const labels = readCoco(data);
    expect(labels.masks.length).toBe(1);
    const m = labels.masks[0];
    expect(m.area).toBeGreaterThan(0);
    const bb = m.bbox;
    expect(bb.x).toBeCloseTo(1, 0);
    expect(bb.x + bb.width).toBeCloseTo(30, 0);
    expect(bb.y).toBeCloseTo(1, 0);
    expect(bb.y + bb.height).toBeCloseTo(30, 0);
  });

  it("roi mode keeps native vector geometry, one ROI per ring", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "img.png", height: 100, width: 100 }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          segmentation: [[10, 10, 50, 10, 50, 50, 10, 50]],
        },
      ],
      categories: [{ id: 1, name: "obj" }],
    };
    const labels = readCoco(data, { segmentationFormat: "roi" });
    expect(labels.masks.length).toBe(0);
    expect(labels.rois.length).toBe(1);
    const b = labels.rois[0].bounds;
    expect(b.minX).toBeCloseTo(10);
    expect(b.minY).toBeCloseTo(10);
    expect(b.maxX).toBeCloseTo(50);
    expect(b.maxY).toBeCloseTo(50);
  });

  it("degenerate ring alongside a valid one: skipped, no crash", () => {
    const result = decodeSegmentation(
      [
        [5, 5],
        [1, 1, 10, 1, 10, 10, 1, 10],
      ],
      40,
      40,
      "mask",
      {},
    );
    expect(result.masks.length).toBe(1);
    expect(result.masks[0].area).toBeGreaterThan(0);
  });
});

describe("readCoco keypoints + linked segmentation/bbox", () => {
  it("polygon segmentation: instance + linked mask + linked bbox share track", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "image.png", height: 100, width: 100 }],
      categories: [
        {
          id: 1,
          name: "animal",
          keypoints: ["nose", "tail"],
          skeleton: [[1, 2]],
        },
      ],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          keypoints: [50, 50, 2, 70, 70, 2],
          num_keypoints: 2,
          segmentation: [[10, 10, 90, 10, 90, 90, 10, 90]],
          bbox: [10, 10, 80, 80],
        },
      ],
    };
    const labels = readCoco(data);
    expect(labels.labeledFrames.length).toBe(1);
    expect(labels.labeledFrames[0].instances.length).toBe(1);
    const instance = labels.labeledFrames[0].instances[0];
    expect(instance.points[0].xy[0]).toBeCloseTo(50);
    expect(instance.points[1].xy[0]).toBeCloseTo(70);

    expect(labels.rois.length).toBe(0);
    expect(labels.masks.length).toBe(1);
    const mask = labels.masks[0];
    expect(mask).toBeInstanceOf(UserSegmentationMask);
    expect(mask.category).toBe("animal");
    expect(mask.instance).toBe(instance);
    expect(mask.height).toBe(100);
    expect(mask.width).toBe(100);

    expect(labels.bboxes.length).toBe(1);
    const bbox = labels.bboxes[0];
    expect(bbox).toBeInstanceOf(UserBoundingBox);
    expect(bbox.instance).toBe(instance);
    expect(bbox.category).toBe("animal");
    expect(bbox.width).toBeCloseTo(80);
  });

  it("RLE segmentation linked to keypoint instance is a user mask", () => {
    const data: CocoJson = {
      images: [{ id: 1, file_name: "image.png", height: 5, width: 5 }],
      categories: [
        { id: 1, name: "animal", keypoints: ["nose", "tail"], skeleton: [] },
      ],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          keypoints: [1, 1, 2, 3, 3, 2],
          num_keypoints: 2,
          segmentation: { counts: [0, 5, 5, 5, 5], size: [5, 5] },
          score: 0.9, // ignored in Branch A
        },
      ],
    };
    const labels = readCoco(data);
    expect(labels.labeledFrames[0].instances.length).toBe(1);
    expect(labels.masks.length).toBe(1);
    expect(labels.masks[0]).toBeInstanceOf(UserSegmentationMask);
    expect(labels.masks[0].instance).toBe(labels.labeledFrames[0].instances[0]);
  });
});

describe("readCoco category_as_track", () => {
  const data: CocoJson = {
    images: [
      { id: 1, file_name: "img1.png", height: 40, width: 40 },
      { id: 2, file_name: "img2.png", height: 40, width: 40 },
    ],
    annotations: [
      {
        id: 1,
        image_id: 1,
        category_id: 1,
        segmentation: [[1, 1, 10, 1, 10, 10, 1, 10]],
      },
      {
        id: 2,
        image_id: 1,
        category_id: 2,
        segmentation: [[20, 20, 30, 20, 30, 30, 20, 30]],
      },
      {
        id: 3,
        image_id: 2,
        category_id: 1,
        segmentation: [[2, 2, 12, 2, 12, 12, 2, 12]],
      },
      { id: 4, image_id: 2, category_id: 2, bbox: [5, 5, 8, 8] },
    ],
    categories: [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ],
  };

  it("assigns one shared Track per category", () => {
    const labels = readCoco(data, { categoryAsTrack: true });
    expect(new Set(labels.tracks.map((t) => t.name))).toEqual(
      new Set(["a", "b"]),
    );
    for (const m of labels.masks) {
      expect(m.track).not.toBeNull();
      expect(m.track!.name).toBe(m.category);
    }
    expect(labels.bboxes.length).toBe(1);
    expect(labels.bboxes[0].track).not.toBeNull();
    expect(labels.bboxes[0].track!.name).toBe("b");
    const bMask = labels.masks.find((m) => m.category === "b")!;
    expect(labels.bboxes[0].track).toBe(bMask.track);
    const aMasks = labels.masks.filter((m) => m.category === "a");
    expect(aMasks.length).toBe(2);
    expect(aMasks[0].track).toBe(aMasks[1].track);
  });

  it("roi mode assigns category tracks to ROIs", () => {
    const labels = readCoco(data, {
      categoryAsTrack: true,
      segmentationFormat: "roi",
    });
    expect(new Set(labels.tracks.map((t) => t.name))).toEqual(
      new Set(["a", "b"]),
    );
    for (const r of labels.rois) {
      expect(r.track).not.toBeNull();
      expect(r.track!.name).toBe(r.category);
    }
  });

  it("default (false) leaves masks/bboxes untracked", () => {
    const labels = readCoco(data);
    expect(labels.tracks.length).toBe(0);
    expect(labels.masks.every((m) => m.track === null)).toBe(true);
    expect(labels.bboxes.every((b) => b.track === null)).toBe(true);
  });
});

describe("readCoco explicit track ids (CVAT)", () => {
  function poseData(trackField: Record<string, unknown>): CocoJson {
    return {
      images: [{ id: 1, file_name: "frame01.jpg", width: 100, height: 100 }],
      categories: [
        {
          id: 1,
          name: "mouse",
          keypoints: ["nose", "head", "tail"],
          skeleton: [],
        },
      ],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          keypoints: [10, 10, 2, 20, 20, 2, 30, 30, 2],
          num_keypoints: 3,
          ...trackField,
        },
      ],
    };
  }

  it("attributes.object_id shared across frames", () => {
    const data: CocoJson = {
      images: [
        { id: 1, file_name: "frame01.jpg", width: 100, height: 100 },
        { id: 2, file_name: "frame02.jpg", width: 100, height: 100 },
      ],
      categories: [
        {
          id: 1,
          name: "mouse",
          keypoints: ["nose", "head", "tail"],
          skeleton: [],
        },
      ],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          attributes: { object_id: 101 },
          keypoints: [10, 10, 2, 20, 20, 2, 30, 30, 2],
          num_keypoints: 3,
        },
        {
          id: 2,
          image_id: 1,
          category_id: 1,
          attributes: { object_id: 102 },
          keypoints: [40, 40, 2, 50, 50, 2, 60, 60, 2],
          num_keypoints: 3,
        },
        {
          id: 3,
          image_id: 2,
          category_id: 1,
          attributes: { object_id: 101 },
          keypoints: [12, 12, 2, 22, 22, 2, 32, 32, 2],
          num_keypoints: 3,
        },
        {
          id: 4,
          image_id: 2,
          category_id: 1,
          attributes: { object_id: 102 },
          keypoints: [42, 42, 2, 52, 52, 2, 62, 62, 2],
          num_keypoints: 3,
        },
      ],
    };
    const labels = readCoco(data);
    expect(labels.labeledFrames.length).toBe(2);
    expect(labels.labeledFrames[0].instances.length).toBe(2);
    const names = labels.tracks.map((t) => t.name).sort();
    expect(names).toEqual(["track_101", "track_102"]);
    // Same Track objects shared across frames.
    const f1 = labels.labeledFrames[0].instances.map((i) => i.track);
    const f2 = labels.labeledFrames[1].instances.map((i) => i.track);
    expect(f1).toEqual(f2);
  });

  it("track_id and instance_id fields, precedence object_id > track_id > instance_id", () => {
    const tid = readCoco(poseData({ track_id: 301 }));
    expect(tid.tracks.map((t) => t.name)).toEqual(["track_301"]);
    const iid = readCoco(poseData({ instance_id: 401 }));
    expect(iid.tracks.map((t) => t.name)).toEqual(["track_401"]);
    const prec = readCoco(
      poseData({
        attributes: { object_id: 101 },
        track_id: 301,
        instance_id: 401,
      }),
    );
    expect(prec.tracks.map((t) => t.name)).toEqual(["track_101"]);
  });

  it("standard COCO without ids yields no tracks", () => {
    const labels = readCoco(poseData({}));
    expect(labels.tracks.length).toBe(0);
    expect(labels.labeledFrames[0].instances[0].track).toBeNull();
  });

  it("occluded keypoint (v=0) yields NaN coords", () => {
    const data = poseData({
      attributes: { object_id: 202 },
    });
    (data.annotations[0].keypoints as number[]) = [
      40, 40, 2, 50, 50, 2, 0, 0, 0,
    ];
    const labels = readCoco(data);
    const inst = labels.labeledFrames[0].instances[0];
    expect(Number.isNaN(inst.points[2].xy[0])).toBe(true);
    expect(inst.points[2].visible).toBe(false);
  });
});

describe("readCocoSet (browser core)", () => {
  it("reads each split independently with its own tracks", () => {
    const train = loadFixture("flat_images", "annotations.json");
    const val = loadFixture("mixed_animals", "annotations.json");
    const result = readCocoSet({ train, val });
    expect(Object.keys(result).sort()).toEqual(["train", "val"]);
    expect(result.train.skeletons.length).toBe(1);
    expect(result.val.skeletons.length).toBe(2);
    expect(result.train.provenance.split).toBe("train");
  });
});
