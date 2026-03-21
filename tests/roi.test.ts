/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  ROI,
  AnnotationType,
  rasterizeGeometry,
  encodeWkb,
  decodeWkb,
} from "../src/model/roi.js";
import "../src/model/mask.js"; // Ensure mask factory is registered
import { Video } from "../src/model/video.js";
import type { Geometry } from "../src/model/roi.js";

describe("AnnotationType", () => {
  it("has correct enum values", () => {
    expect(AnnotationType.DEFAULT).toBe(0);
    expect(AnnotationType.BOUNDING_BOX).toBe(1);
    expect(AnnotationType.SEGMENTATION).toBe(2);
    expect(AnnotationType.ARENA).toBe(3);
    expect(AnnotationType.ANCHOR).toBe(4);
  });
});

describe("ROI", () => {
  it("identity equality - different objects are not equal", () => {
    const roi1 = ROI.fromBbox(0, 0, 10, 10);
    const roi2 = ROI.fromBbox(0, 0, 10, 10);
    expect(roi1).not.toBe(roi2);
    // They are different object references
    expect(roi1 === roi2).toBe(false);
  });

  it("fromBbox creates correct geometry", () => {
    const roi = ROI.fromBbox(10, 20, 30, 40);
    const b = roi.bounds;
    expect(b.minX).toBe(10);
    expect(b.minY).toBe(20);
    expect(b.maxX).toBe(40);
    expect(b.maxY).toBe(60);
    expect(roi.area).toBeCloseTo(30 * 40);
  });

  it("fromXyxy creates correct geometry", () => {
    const roi = ROI.fromXyxy(10, 20, 40, 60);
    const b = roi.bounds;
    expect(b.minX).toBe(10);
    expect(b.minY).toBe(20);
    expect(b.maxX).toBe(40);
    expect(b.maxY).toBe(60);
    expect(roi.area).toBeCloseTo(30 * 40);
  });

  it("fromPolygon creates correct geometry", () => {
    const coords = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const roi = ROI.fromPolygon(coords);
    expect(roi.area).toBeCloseTo(100);
  });

  it("fromPolygon preserves kwargs", () => {
    const coords = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const roi = ROI.fromPolygon(coords, { name: "test", category: "cat1" });
    expect(roi.name).toBe("test");
    expect(roi.category).toBe("cat1");
  });

  it("isStatic", () => {
    const roi1 = ROI.fromBbox(0, 0, 10, 10);
    expect(roi1.isStatic).toBe(true);

    const roi2 = ROI.fromBbox(0, 0, 10, 10, { frameIdx: 5 });
    expect(roi2.isStatic).toBe(false);
  });

  it("isBbox for axis-aligned rectangle", () => {
    const roi = ROI.fromBbox(0, 0, 10, 20);
    expect(roi.isBbox).toBe(true);
  });

  it("isBbox false for non-rectangular polygon", () => {
    const roi = ROI.fromPolygon([
      [0, 0],
      [10, 0],
      [5, 10],
    ]);
    expect(roi.isBbox).toBe(false);
  });

  it("isBbox false for point geometry", () => {
    const roi = new ROI({
      geometry: { type: "Point", coordinates: [0, 0] },
    });
    expect(roi.isBbox).toBe(false);
  });

  it("isBbox false for rotated rectangle (diamond)", () => {
    const coords = [
      [5, 0],
      [10, 5],
      [5, 10],
      [0, 5],
    ];
    const roi = ROI.fromPolygon(coords);
    expect(roi.isBbox).toBe(false);
  });

  it("bounds", () => {
    const roi = ROI.fromBbox(5, 10, 20, 30);
    const b = roi.bounds;
    expect(b.minX).toBe(5);
    expect(b.minY).toBe(10);
    expect(b.maxX).toBe(25);
    expect(b.maxY).toBe(40);
  });

  it("centroid", () => {
    const roi = ROI.fromBbox(0, 0, 10, 10);
    const c = roi.centroid;
    expect(c.x).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(5);
  });

  it("toMask rasterizes correctly", () => {
    const roi = ROI.fromBbox(2, 3, 4, 5, { name: "test_roi", category: "cat" });
    const mask = roi.toMask(20, 20);

    expect(mask.height).toBe(20);
    expect(mask.width).toBe(20);
    expect(mask.name).toBe("test_roi");
    expect(mask.category).toBe("cat");
    expect(mask.area).toBeGreaterThan(0);

    const data = mask.data;
    // Inside the bbox
    expect(data[5 * 20 + 4]).toBe(1);
    // Outside the bbox
    expect(data[0 * 20 + 0]).toBe(0);
  });

  it("with video and frameIdx", () => {
    const video = new Video({ filename: "test.mp4" });
    const roi = ROI.fromBbox(0, 0, 10, 10, { video, frameIdx: 5 });
    expect(roi.video).toBe(video);
    expect(roi.frameIdx).toBe(5);
  });

  it("rasterize point geometry returns empty mask", () => {
    const geom: Geometry = { type: "Point", coordinates: [5, 5] };
    const mask = rasterizeGeometry(geom, 10, 10);
    expect(mask.length).toBe(100);
    let anySet = false;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) anySet = true;
    }
    expect(anySet).toBe(false);
  });

  it("rasterize polygon with hole", () => {
    const outer = [
      [1, 1],
      [9, 1],
      [9, 9],
      [1, 9],
      [1, 1],
    ];
    const inner = [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
      [3, 3],
    ];
    const geom: Geometry = { type: "Polygon", coordinates: [outer, inner] };
    const mask = rasterizeGeometry(geom, 10, 10);

    // Outer region should be filled
    expect(mask[2 * 10 + 5]).toBe(1);
    // Inner hole should be empty
    expect(mask[5 * 10 + 5]).toBe(0);

    // Total filled area should be less than the outer polygon alone
    const outerOnly = rasterizeGeometry(
      { type: "Polygon", coordinates: [outer] },
      10,
      10,
    );
    const maskSum = mask.reduce((a, b) => a + b, 0);
    const outerSum = outerOnly.reduce((a, b) => a + b, 0);
    expect(maskSum).toBeLessThan(outerSum);
  });

  it("rasterize polygon fills center", () => {
    const geom: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [2, 2],
          [8, 2],
          [8, 8],
          [2, 8],
          [2, 2],
        ],
      ],
    };
    const mask = rasterizeGeometry(geom, 10, 10);
    expect(mask.length).toBe(100);
    // Center should be filled
    expect(mask[5 * 10 + 5]).toBe(1);
    // Corner should not
    expect(mask[0 * 10 + 0]).toBe(0);
  });
});

describe("WKB", () => {
  it("encode and decode point", () => {
    const geom: Geometry = { type: "Point", coordinates: [3.5, 7.2] };
    const wkb = encodeWkb(geom);
    const decoded = decodeWkb(wkb);
    expect(decoded.type).toBe("Point");
    if (decoded.type === "Point") {
      expect(decoded.coordinates[0]).toBeCloseTo(3.5);
      expect(decoded.coordinates[1]).toBeCloseTo(7.2);
    }
  });

  it("encode and decode multipolygon", () => {
    const geom: Geometry = {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
        [[[15, 15], [20, 15], [20, 20], [15, 20], [15, 15]]],
      ],
    };
    const wkb = encodeWkb(geom);
    const decoded = decodeWkb(wkb);
    expect(decoded.type).toBe("MultiPolygon");
    if (decoded.type === "MultiPolygon") {
      expect(decoded.coordinates.length).toBe(2);
      expect(decoded.coordinates[0][0][0]).toEqual([0, 0]);
      expect(decoded.coordinates[1][0][0]).toEqual([15, 15]);
    }
  });

  it("encode and decode polygon", () => {
    const geom: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };
    const wkb = encodeWkb(geom);
    const decoded = decodeWkb(wkb);
    expect(decoded.type).toBe("Polygon");
    if (decoded.type === "Polygon") {
      expect(decoded.coordinates[0].length).toBe(5);
      expect(decoded.coordinates[0][0]).toEqual([0, 0]);
      expect(decoded.coordinates[0][2]).toEqual([10, 10]);
    }
  });
});
