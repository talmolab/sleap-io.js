/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  SegmentationMask,
  encodeRle,
  decodeRle,
} from "../src/model/mask.js";
import { AnnotationType } from "../src/model/roi.js";

function makeMask2D(height: number, width: number, fill?: (r: number, c: number) => boolean): Uint8Array {
  const flat = new Uint8Array(height * width);
  if (fill) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        flat[r * width + c] = fill(r, c) ? 1 : 0;
      }
    }
  }
  return flat;
}

describe("encodeRle / decodeRle", () => {
  it("all zeros", () => {
    const mask = makeMask2D(5, 5);
    const rle = encodeRle(mask, 5, 5);
    expect(rle.length).toBe(1);
    expect(rle[0]).toBe(25);
  });

  it("all ones", () => {
    const mask = makeMask2D(5, 5, () => true);
    const rle = encodeRle(mask, 5, 5);
    expect(rle[0]).toBe(0);
    expect(rle[1]).toBe(25);
  });

  it("empty mask", () => {
    const mask = new Uint8Array(0);
    const rle = encodeRle(mask, 0, 0);
    expect(rle.length).toBe(0);
  });

  it("roundtrip", () => {
    const mask = makeMask2D(10, 10, (r, c) => r >= 2 && r < 5 && c >= 3 && c < 7);
    // Also set one isolated pixel
    mask[7 * 10 + 1] = 1;

    const rle = encodeRle(mask, 10, 10);
    const decoded = decodeRle(rle, 10, 10);
    expect(decoded).toEqual(mask);
  });

  it("roundtrip random", () => {
    // Simple PRNG (LCG) for reproducibility
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const mask = makeMask2D(20, 30, () => rand() > 0.5);
    const rle = encodeRle(mask, 20, 30);
    const decoded = decodeRle(rle, 20, 30);
    expect(decoded).toEqual(mask);
  });

  it("decode empty rle", () => {
    const rle = new Uint32Array(0);
    const mask = decodeRle(rle, 5, 5);
    expect(mask.length).toBe(25);
    let anySet = false;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) anySet = true;
    }
    expect(anySet).toBe(false);
  });
});

describe("SegmentationMask", () => {
  it("identity equality", () => {
    const mask1 = SegmentationMask.fromArray(makeMask2D(5, 5), 5, 5);
    const mask2 = SegmentationMask.fromArray(makeMask2D(5, 5), 5, 5);
    expect(mask1).not.toBe(mask2);
    expect(mask1 === mask2).toBe(false);
  });

  it("fromArray with metadata", () => {
    const data = makeMask2D(10, 15, (r, c) => r >= 2 && r < 5 && c >= 3 && c < 8);
    const mask = SegmentationMask.fromArray(data, 10, 15, { name: "test" });
    expect(mask.height).toBe(10);
    expect(mask.width).toBe(15);
    expect(mask.name).toBe("test");
    expect(mask.annotationType).toBe(AnnotationType.SEGMENTATION);
  });

  it("data roundtrip", () => {
    const original = makeMask2D(10, 10, (r, c) => r >= 3 && r < 7 && c >= 2 && c < 8);
    const mask = SegmentationMask.fromArray(original, 10, 10);
    const decoded = mask.data;
    expect(decoded).toEqual(original);
  });

  it("area", () => {
    // 3 rows * 4 cols = 12 pixels
    const data = makeMask2D(10, 10, (r, c) => r >= 2 && r < 5 && c >= 3 && c < 7);
    const mask = SegmentationMask.fromArray(data, 10, 10);
    expect(mask.area).toBe(12);
  });

  it("bbox", () => {
    const data = makeMask2D(20, 20, (r, c) => r >= 5 && r < 10 && c >= 3 && c < 8);
    const mask = SegmentationMask.fromArray(data, 20, 20);
    const bb = mask.bbox;
    expect(bb.x).toBe(3);
    expect(bb.y).toBe(5);
    expect(bb.width).toBe(5);
    expect(bb.height).toBe(5);
  });

  it("bbox empty", () => {
    const data = makeMask2D(10, 10);
    const mask = SegmentationMask.fromArray(data, 10, 10);
    const bb = mask.bbox;
    expect(bb.x).toBe(0);
    expect(bb.y).toBe(0);
    expect(bb.width).toBe(0);
    expect(bb.height).toBe(0);
  });

  it("annotation type defaults to SEGMENTATION", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(5, 5), 5, 5);
    expect(mask.annotationType).toBe(AnnotationType.SEGMENTATION);
  });

  it("with score", () => {
    const mask = SegmentationMask.fromArray(
      makeMask2D(5, 5, () => true),
      5,
      5,
      { score: 0.95 },
    );
    expect(mask.score).toBe(0.95);
  });

  it("fromArray with boolean 2D array", () => {
    const arr: boolean[][] = [];
    for (let r = 0; r < 5; r++) {
      arr.push([]);
      for (let c = 0; c < 5; c++) {
        arr[r].push(r >= 1 && r < 3 && c >= 1 && c < 4);
      }
    }
    const mask = SegmentationMask.fromArray(arr, 5, 5);
    expect(mask.area).toBe(6); // 2 rows * 3 cols
  });

  it("toPolygon creates an ROI", () => {
    const data = makeMask2D(20, 20, (r, c) => r >= 5 && r < 15 && c >= 5 && c < 15);
    const mask = SegmentationMask.fromArray(data, 20, 20, {
      name: "test_mask",
      category: "cat",
    });
    const roi = mask.toPolygon();
    expect(roi.name).toBe("test_mask");
    expect(roi.category).toBe("cat");
    expect(roi.area).toBeGreaterThan(0);
  });

  it("toPolygon empty mask", () => {
    const data = makeMask2D(10, 10);
    const mask = SegmentationMask.fromArray(data, 10, 10);
    const roi = mask.toPolygon();
    expect(roi.area).toBe(0);
  });
});
