// Tests for SegmentationMask boundary contour tracing (`contours()`), the
// upgraded `toPolygon()` (real outline + hole nesting), and the `get data()`
// RLE decode cache. These are browser-safe (pure data) — the primitives that
// let consuming UIs draw real mask outlines instead of just the bounding box.

import { describe, it, expect } from "../bun-test";
import {
  SegmentationMask,
  type UserSegmentationMask,
  PredictedSegmentationMask,
  encodeRle,
  traceMaskContours,
} from "../../src/model/mask.js";
import { PredictedROI, UserROI } from "../../src/model/roi.js";

/** Flat row-major binary raster from a fill predicate. */
function raster(
  h: number,
  w: number,
  fill: (r: number, c: number) => boolean,
): Uint8Array {
  const a = new Uint8Array(h * w);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) if (fill(r, c)) a[r * w + c] = 1;
  return a;
}

/** Shoelace area magnitude of a closed ring. */
function ringArea(ring: number[][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(s / 2);
}

/** Unique vertices (closing vertex dropped) as "x,y" strings. */
function vertexSet(ring: number[][]): Set<string> {
  return new Set(ring.slice(0, -1).map(([x, y]) => `${x},${y}`));
}

function maskOf(
  h: number,
  w: number,
  fill: (r: number, c: number) => boolean,
  opts?: Record<string, unknown>,
): UserSegmentationMask {
  return SegmentationMask.fromArray(raster(h, w, fill), h, w, opts);
}

describe("SegmentationMask.contours()", () => {
  it("traces a filled rectangle to four corners", () => {
    // rows [10,30), cols [20,50) -> 30x20 = 600 px.
    const mask = maskOf(
      64,
      64,
      (r, c) => r >= 10 && r < 30 && c >= 20 && c < 50,
    );
    const rings = mask.contours();
    expect(rings.length).toBe(1);
    const ring = rings[0];
    // Closed ring with exactly the 4 axis-aligned corners.
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(vertexSet(ring)).toEqual(
      new Set(["20,10", "50,10", "50,30", "20,30"]),
    );
    // Contour area is exactly the foreground pixel count.
    expect(ringArea(ring)).toBe(600);
    expect(ringArea(ring)).toBe(mask.area);
  });

  it("returns [] for an empty mask", () => {
    const mask = maskOf(16, 16, () => false);
    expect(mask.contours()).toEqual([]);
  });

  it("traces disjoint blobs as separate rings", () => {
    const mask = maskOf(
      64,
      64,
      (r, c) =>
        (r >= 5 && r < 15 && c >= 5 && c < 15) ||
        (r >= 40 && r < 55 && c >= 40 && c < 55),
    );
    const rings = mask.contours();
    expect(rings.length).toBe(2);
    const total = rings.reduce((s, ring) => s + ringArea(ring), 0);
    expect(total).toBe(mask.area); // 100 + 225
  });

  it("traces a hole as a second (oppositely wound) ring", () => {
    // Outer [10,40)^2 minus inner hole [18,32)^2.
    const mask = maskOf(
      64,
      64,
      (r, c) =>
        r >= 10 &&
        r < 40 &&
        c >= 10 &&
        c < 40 &&
        !(r >= 18 && r < 32 && c >= 18 && c < 32),
    );
    const rings = mask.contours();
    expect(rings.length).toBe(2);
    const [a, b] = rings.map(ringArea).sort((x, y) => y - x);
    expect(a).toBe(900); // outer
    expect(b).toBe(196); // hole
  });

  it("closes contours that touch the image border", () => {
    // Filled block anchored at the top-left corner (0,0).
    const mask = maskOf(20, 20, (r, c) => r < 10 && c < 10);
    const rings = mask.contours();
    expect(rings.length).toBe(1);
    expect(vertexSet(rings[0])).toEqual(
      new Set(["0,0", "10,0", "10,10", "0,10"]),
    );
    expect(ringArea(rings[0])).toBe(100);
  });

  it("maps contour coordinates through scale/offset into image space", () => {
    // mask pixel (r,c) -> image (c/scale + offset). scale [2,2], offset [10,20].
    const mask = maskOf(8, 8, (r, c) => r >= 2 && r < 6 && c >= 2 && c < 6, {
      scale: [2, 2],
      offset: [10, 20],
    });
    const rings = mask.contours();
    expect(rings.length).toBe(1);
    // Mask-space corners {2,6} -> image x = 2/2+10=11 .. 6/2+10=13; y = 2/2+20=21 .. 23.
    expect(vertexSet(rings[0])).toEqual(
      new Set(["11,21", "13,21", "13,23", "11,23"]),
    );
  });

  it("separates diagonal-touch pixels into distinct simple rings (saddle)", () => {
    // [1,0; 0,1]: two pixels touching only at the corner (1,1). 4-connectivity
    // -> two separate components, each its own simple (non-self-touching) ring.
    const mask = SegmentationMask.fromArray(
      Uint8Array.from([1, 0, 0, 1]),
      2,
      2,
    );
    const rings = mask.contours();
    expect(rings.length).toBe(2);
    for (const ring of rings) {
      expect(ringArea(ring)).toBe(1);
      // Simple ring: 4 unique corners (no vertex visited twice).
      expect(vertexSet(ring).size).toBe(4);
    }
    // Both diagonal orientations behave the same.
    const mask2 = SegmentationMask.fromArray(
      Uint8Array.from([0, 1, 1, 0]),
      2,
      2,
    );
    expect(mask2.contours().length).toBe(2);
  });

  it("traces a checkerboard as one ring per foreground pixel", () => {
    // 4x4 (r+c) even -> 8 disjoint single pixels, all diagonally touching.
    const mask = maskOf(4, 4, (r, c) => (r + c) % 2 === 0);
    const rings = mask.contours();
    expect(rings.length).toBe(8);
    const total = rings.reduce((s, ring) => s + ringArea(ring), 0);
    expect(total).toBe(mask.area); // 8
    for (const ring of rings) expect(vertexSet(ring).size).toBe(4);
    // toPolygon emits a MultiPolygon of 8 simple unit squares.
    const roi = mask.toPolygon();
    expect(roi.geometry.type).toBe("MultiPolygon");
    expect(roi.area).toBeCloseTo(mask.area);
  });

  it("traceMaskContours is exported and works on a raw raster", () => {
    const rings = traceMaskContours(
      raster(10, 10, (r, c) => r >= 2 && r < 5 && c >= 2 && c < 5),
      10,
      10,
    );
    expect(rings.length).toBe(1);
    expect(ringArea(rings[0])).toBe(9);
  });
});

describe("SegmentationMask.toPolygon() — real outline", () => {
  it("returns a single Polygon for one blob, area == mask area", () => {
    const mask = maskOf(
      32,
      32,
      (r, c) => r >= 5 && r < 25 && c >= 5 && c < 25,
      {
        name: "blob",
        category: "cell",
      },
    );
    const roi = mask.toPolygon();
    expect(roi).toBeInstanceOf(UserROI);
    expect(roi.geometry.type).toBe("Polygon");
    expect(roi.name).toBe("blob");
    expect(roi.category).toBe("cell");
    expect(roi.area).toBeCloseTo(mask.area); // 400
  });

  it("nests a hole so polygon area equals mask area", () => {
    const mask = maskOf(
      48,
      48,
      (r, c) =>
        r >= 8 &&
        r < 40 &&
        c >= 8 &&
        c < 40 &&
        !(r >= 16 && r < 32 && c >= 16 && c < 32),
    );
    const roi = mask.toPolygon();
    expect(roi.geometry.type).toBe("Polygon");
    // Polygon has an exterior + one interior (hole) ring.
    const coords = (roi.geometry as { coordinates: number[][][] }).coordinates;
    expect(coords.length).toBe(2);
    expect(roi.area).toBeCloseTo(mask.area); // (32^2 - 16^2) = 768
  });

  it("returns a MultiPolygon for disjoint blobs", () => {
    const mask = maskOf(
      64,
      64,
      (r, c) =>
        (r >= 4 && r < 14 && c >= 4 && c < 14) ||
        (r >= 40 && r < 50 && c >= 40 && c < 50),
    );
    const roi = mask.toPolygon();
    expect(roi.geometry.type).toBe("MultiPolygon");
    expect(roi.area).toBeCloseTo(mask.area); // 200
  });

  it("returns an empty Polygon (area 0) for an empty mask", () => {
    const mask = maskOf(10, 10, () => false);
    const roi = mask.toPolygon();
    expect(roi.geometry.type).toBe("Polygon");
    expect(roi.area).toBe(0);
  });

  it("carries score onto a PredictedROI for a predicted mask", () => {
    const rle = encodeRle(
      raster(16, 16, (r, c) => r >= 4 && r < 12 && c >= 4 && c < 12),
      16,
      16,
    );
    const mask = new PredictedSegmentationMask({
      rleCounts: rle,
      height: 16,
      width: 16,
      score: 0.73,
      name: "pred",
    });
    const roi = mask.toPolygon();
    expect(roi).toBeInstanceOf(PredictedROI);
    expect((roi as PredictedROI).score).toBeCloseTo(0.73);
    expect(roi.name).toBe("pred");
    expect(roi.area).toBeCloseTo(mask.area);
  });
});

describe("SegmentationMask.data cache", () => {
  it("returns a stable cached buffer with correct content", () => {
    const mask = maskOf(8, 8, (r, c) => r === 2 && c === 3);
    const d1 = mask.data;
    const d2 = mask.data;
    expect(d1).toBe(d2); // memoized — same reference
    expect(d1[2 * 8 + 3]).toBe(1);
    expect(d1.reduce((s, v) => s + v, 0)).toBe(1);
  });

  it("re-decodes when rleCounts is reassigned", () => {
    const mask = maskOf(8, 8, (r, c) => r === 0 && c === 0);
    const d1 = mask.data;
    mask.rleCounts = encodeRle(
      raster(8, 8, (r, c) => r === 7 && c === 7),
      8,
      8,
    );
    const d2 = mask.data;
    expect(d2).not.toBe(d1);
    expect(d2[7 * 8 + 7]).toBe(1);
    expect(d2[0]).toBe(0);
  });
});
