/**
 * Unit tests for the crop point-coordinate transforms (`src/transform/points.ts`).
 *
 * Ports the behavior of Python `sleap_io/transform/points.py`
 * (`crop_points`/`uncrop_points`). Golden values were computed from the
 * authoritative Python implementation (sleap-io 0.8.0):
 *
 *   crop_points([[10,20],[nan,5],[0,0]], (3,4,100,100))
 *     -> [[7,16],[nan,1],[-3,-4]]
 *   crop_points([[5,5]], (-2,-3,10,10)) -> [[7,8]]   (negative origin)
 *
 * Invariants under test: offset by -(x1,y1) on crop / +(x1,y1) on uncrop, NaN
 * preservation, copy semantics (input never mutated), and both layouts
 * (interleaved typed/plain buffers AND arrays of [x,y] pairs).
 */
import { describe, it, expect } from "../bun-test";
import {
  cropPoints,
  uncropPoints,
  type CropRect,
} from "../../src/transform/points.js";

const CROP: CropRect = [3, 4, 100, 100];

describe("cropPoints / uncropPoints — pairs layout", () => {
  it("crops by subtracting the origin (Python golden)", () => {
    const out = cropPoints(
      [
        [10, 20],
        [0, 0],
      ],
      CROP,
    );
    expect(out).toEqual([
      [7, 16],
      [-3, -4],
    ]);
  });

  it("preserves NaN through crop and uncrop", () => {
    const pts: [number, number][] = [
      [10, 20],
      [NaN, 5],
      [0, 0],
    ];
    const cropped = cropPoints(pts, CROP);
    expect(cropped[1][0]).toBeNaN();
    expect(cropped[1][1]).toBe(1);
    // Python golden: crop_points([[10,20],[nan,5],[0,0]], (3,4,100,100))
    expect(cropped[0]).toEqual([7, 16]);
    expect(cropped[2]).toEqual([-3, -4]);

    const restored = uncropPoints(cropped, CROP);
    expect(restored[0]).toEqual([10, 20]);
    expect(restored[1][0]).toBeNaN();
    expect(restored[1][1]).toBe(5);
    expect(restored[2]).toEqual([0, 0]);
  });

  it("round-trips uncrop(crop(p)) === p", () => {
    const pts: [number, number][] = [
      [1.5, 2.5],
      [99, 100],
      [-7, 12],
    ];
    const restored = uncropPoints(cropPoints(pts, CROP), CROP);
    expect(restored).toEqual(pts);
  });

  it("handles a negative crop origin (Python golden)", () => {
    const out = cropPoints([[5, 5]], [-2, -3, 10, 10]);
    expect(out).toEqual([[7, 8]]);
  });

  it("does not mutate the input pairs", () => {
    const pts: [number, number][] = [
      [10, 20],
      [30, 40],
    ];
    const snapshot = JSON.parse(JSON.stringify(pts));
    cropPoints(pts, CROP);
    uncropPoints(pts, CROP);
    expect(pts).toEqual(snapshot);
  });
});

describe("cropPoints / uncropPoints — flat interleaved buffers", () => {
  it("crops a Float64Array and preserves the subtype + copy semantics", () => {
    const buf = new Float64Array([10, 20, NaN, 5, 0, 0]);
    const out = cropPoints(buf, CROP);
    expect(out).toBeInstanceOf(Float64Array);
    expect(out[0]).toBe(7);
    expect(out[1]).toBe(16);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(1);
    expect(out[4]).toBe(-3);
    expect(out[5]).toBe(-4);
    // Input untouched.
    expect(Array.from(buf)).toEqual([10, 20, NaN, 5, 0, 0].map((v) => v)); // NaN compare below
    expect(buf[0]).toBe(10);
    expect(buf[2]).toBeNaN();
  });

  it("crops a Float32Array and preserves the subtype", () => {
    const buf = new Float32Array([3, 4, 6, 8]);
    const out = cropPoints(buf, CROP);
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([0, 0, 3, 4]);
  });

  it("crops a plain number[] (interleaved) and returns a fresh array", () => {
    const buf = [10, 20, 0, 0];
    const out = cropPoints(buf, CROP);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([7, 16, -3, -4]);
    expect(buf).toEqual([10, 20, 0, 0]); // input unmutated
  });

  it("round-trips uncrop(crop(buf)) === buf for a typed buffer", () => {
    const buf = new Float64Array([1.5, 2.5, 99, 100, -7, 12]);
    const restored = uncropPoints(cropPoints(buf, CROP), CROP);
    expect(Array.from(restored)).toEqual(Array.from(buf));
  });
});
