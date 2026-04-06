/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
  encodeRle,
  decodeRle,
  resizeNearest,
} from "../src/model/mask.js";
import { UserBoundingBox, PredictedBoundingBox } from "../src/model/bbox.js";
import { Track } from "../src/model/instance.js";
import { Video } from "../src/model/video.js";

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

describe("Abstract base and subclasses", () => {
  it("SegmentationMask cannot be instantiated directly", () => {
    const rle = encodeRle(new Uint8Array(25), 5, 5);
    expect(() => new (SegmentationMask as any)({ rleCounts: rle, height: 5, width: 5 })).toThrow(TypeError);
  });

  it("UserSegmentationMask is not predicted", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(5, 5), 5, 5);
    expect(mask).toBeInstanceOf(UserSegmentationMask);
    expect(mask.isPredicted).toBe(false);
  });

  it("PredictedSegmentationMask has score and isPredicted", () => {
    const rle = encodeRle(makeMask2D(5, 5, () => true), 5, 5);
    const mask = new PredictedSegmentationMask({
      rleCounts: rle, height: 5, width: 5, score: 0.85,
    });
    expect(mask.isPredicted).toBe(true);
    expect(mask.score).toBe(0.85);
    expect(mask.scoreMap).toBeNull();
    expect(mask.scoreMapScale).toEqual([1, 1]);
    expect(mask.scoreMapOffset).toEqual([0, 0]);
  });

  it("PredictedSegmentationMask stores scoreMap", () => {
    const rle = encodeRle(makeMask2D(3, 4, () => true), 3, 4);
    const sm = new Float32Array(12).fill(0.5);
    const mask = new PredictedSegmentationMask({
      rleCounts: rle, height: 3, width: 4, score: 0.9,
      scoreMap: sm, scoreMapScale: [2, 2], scoreMapOffset: [1, 1],
    });
    expect(mask.scoreMap).toBe(sm);
    expect(mask.scoreMapScale).toEqual([2, 2]);
    expect(mask.scoreMapOffset).toEqual([1, 1]);
  });
});

describe("Scale/offset spatial metadata", () => {
  it("default scale/offset is identity", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(5, 5), 5, 5);
    expect(mask.scale).toEqual([1, 1]);
    expect(mask.offset).toEqual([0, 0]);
    expect(mask.hasSpatialTransform).toBe(false);
  });

  it("hasSpatialTransform detects non-identity scale", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(10, 10), 10, 10, {
      scale: [2, 2],
    });
    expect(mask.hasSpatialTransform).toBe(true);
  });

  it("hasSpatialTransform detects non-zero offset", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(5, 5), 5, 5, {
      offset: [10, 20],
    });
    expect(mask.hasSpatialTransform).toBe(true);
  });

  it("imageExtent accounts for scale", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(20, 30), 20, 30, {
      scale: [2, 2],
    });
    expect(mask.imageExtent).toEqual({ height: 10, width: 15 });
  });

  it("bbox applies scale and offset", () => {
    // 5x5 mask with pixels at rows 1-3, cols 1-3
    const data = makeMask2D(5, 5, (r, c) => r >= 1 && r <= 3 && c >= 1 && c <= 3);
    const mask = SegmentationMask.fromArray(data, 5, 5, {
      scale: [2, 2], offset: [10, 20],
    });
    const bb = mask.bbox;
    // mask-space: x=1, y=1, w=3, h=3
    // image-space: x=1/2+10=10.5, y=1/2+20=20.5, w=3/2=1.5, h=3/2=1.5
    expect(bb.x).toBeCloseTo(10.5);
    expect(bb.y).toBeCloseTo(20.5);
    expect(bb.width).toBeCloseTo(1.5);
    expect(bb.height).toBeCloseTo(1.5);
  });

  it("stride sets scale to 1/stride", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(10, 10), 10, 10, {
      stride: 4,
    });
    expect(mask.scale).toEqual([0.25, 0.25]);
  });

  it("explicit scale takes precedence over stride", () => {
    const mask = SegmentationMask.fromArray(makeMask2D(10, 10), 10, 10, {
      stride: 4, scale: [3, 3],
    });
    expect(mask.scale).toEqual([3, 3]);
  });

  it("scale must be positive", () => {
    expect(() => SegmentationMask.fromArray(makeMask2D(5, 5), 5, 5, {
      scale: [0, 1],
    })).toThrow("Scale must be positive");
  });

  it("resampled returns identity scale/offset", () => {
    const data = makeMask2D(10, 10, (r, c) => r < 5 && c < 5);
    const mask = SegmentationMask.fromArray(data, 10, 10, {
      scale: [2, 2], offset: [5, 5],
    });
    const resampled = mask.resampled(5, 5);
    expect(resampled.height).toBe(5);
    expect(resampled.width).toBe(5);
    expect(resampled.scale).toEqual([1, 1]);
    expect(resampled.offset).toEqual([0, 0]);
    expect(resampled).toBeInstanceOf(UserSegmentationMask);
  });

  it("resampled preserves PredictedSegmentationMask", () => {
    const rle = encodeRle(makeMask2D(4, 4, () => true), 4, 4);
    const sm = new Float32Array(16).fill(0.7);
    const mask = new PredictedSegmentationMask({
      rleCounts: rle, height: 4, width: 4, score: 0.9, scoreMap: sm,
    });
    const resampled = mask.resampled(2, 2);
    expect(resampled).toBeInstanceOf(PredictedSegmentationMask);
    const pm = resampled as PredictedSegmentationMask;
    expect(pm.score).toBe(0.9);
    expect(pm.scoreMap).not.toBeNull();
    expect(pm.scoreMap!.length).toBe(4); // 2*2
  });
});

describe("resizeNearest", () => {
  it("upscales Uint8Array", () => {
    const src = new Uint8Array([1, 2, 3, 4]); // 2x2
    const dst = resizeNearest(src, 2, 2, 4, 4);
    expect(dst).toBeInstanceOf(Uint8Array);
    expect(dst.length).toBe(16);
    // Top-left 2x2 should all be 1
    expect(dst[0]).toBe(1);
    expect(dst[1]).toBe(1);
    expect(dst[4]).toBe(1);
    expect(dst[5]).toBe(1);
  });

  it("downscales Int32Array", () => {
    const src = new Int32Array([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]); // 4x4
    const dst = resizeNearest(src, 4, 4, 2, 2);
    expect(dst).toBeInstanceOf(Int32Array);
    expect(dst.length).toBe(4);
    expect(dst[0]).toBe(1);
    expect(dst[1]).toBe(2);
    expect(dst[2]).toBe(3);
    expect(dst[3]).toBe(4);
  });

  it("preserves Float32Array type", () => {
    const src = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const dst = resizeNearest(src, 2, 2, 2, 2);
    expect(dst).toBeInstanceOf(Float32Array);
    expect(dst.length).toBe(4);
  });
});

describe("SegmentationMask.toBbox", () => {
  it("basic toBbox matches bbox property", () => {
    const mask = makeMask2D(10, 10, (r, c) => r >= 5 && c >= 3 && c < 8);
    const sm = SegmentationMask.fromArray(mask, 10, 10);
    const bb = sm.toBbox();
    expect(bb).toBeInstanceOf(UserBoundingBox);
    const bboxProp = sm.bbox;
    expect(bb.x1).toBeCloseTo(bboxProp.x);
    expect(bb.y1).toBeCloseTo(bboxProp.y);
    expect(bb.width).toBeCloseTo(bboxProp.width);
    expect(bb.height).toBeCloseTo(bboxProp.height);
  });

  it("propagates metadata", () => {
    const track = new Track("t1");
    const video = new Video({ filename: "test.mp4" });
    const mask = makeMask2D(10, 10, (r, c) => r >= 2 && r < 5 && c >= 1 && c < 4);
    const sm = SegmentationMask.fromArray(mask, 10, 10, {
      track,
      video,
      frameIdx: 3,
      category: "cell",
      name: "obj1",
      source: "manual",
    });
    const bb = sm.toBbox();
    expect(bb.track).toBe(track);
    expect(bb.video).toBe(video);
    expect(bb.frameIdx).toBe(3);
    expect(bb.category).toBe("cell");
    expect(bb.name).toBe("obj1");
    expect(bb.source).toBe("manual");
  });

  it("returns PredictedBoundingBox for predicted mask", () => {
    const mask = makeMask2D(10, 10, (r, c) => r < 3 && c < 3);
    const sm = new PredictedSegmentationMask({
      rleCounts: encodeRle(mask, 10, 10),
      height: 10,
      width: 10,
      score: 0.95,
    });
    const bb = sm.toBbox();
    expect(bb).toBeInstanceOf(PredictedBoundingBox);
    expect((bb as PredictedBoundingBox).score).toBeCloseTo(0.95);
  });

  it("respects scale", () => {
    const mask = makeMask2D(10, 10, (r, c) => r >= 2 && r < 4 && c >= 3 && c < 6);
    const sm = SegmentationMask.fromArray(mask, 10, 10, {
      scale: [0.5, 0.5],
    });
    const bb = sm.toBbox();
    // mask coords: x=3, y=2, w=3, h=2 -> image: x=6, y=4, w=6, h=4
    expect(bb.xywh).toEqual({ x: 6, y: 4, width: 6, height: 4 });
  });

  it("respects offset", () => {
    const mask = makeMask2D(10, 10, (r, c) => r >= 2 && r < 4 && c >= 3 && c < 6);
    const sm = SegmentationMask.fromArray(mask, 10, 10, {
      offset: [10, 20],
    });
    const bb = sm.toBbox();
    expect(bb.xywh).toEqual({ x: 13, y: 22, width: 3, height: 2 });
  });

  it("handles empty mask", () => {
    const mask = new Uint8Array(100); // all zeros
    const sm = SegmentationMask.fromArray(mask, 10, 10);
    const bb = sm.toBbox();
    expect(bb.xywh).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
