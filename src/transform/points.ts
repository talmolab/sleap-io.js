/**
 * Point coordinate transformation functions for virtual cropping.
 *
 * Ported from Python `sleap_io/transform/points.py` ({@link crop_points},
 * {@link uncrop_points}). These adjust landmark coordinates to match a cropped
 * video frame. Both operations are copy-based (the input is never mutated) and
 * NaN-preserving (`NaN ± c` stays `NaN` naturally).
 *
 * Browser-safe: no Node-only imports.
 */

/**
 * A crop rectangle as `[x1, y1, x2, y2]` in source pixel coordinates.
 *
 * `x2`/`y2` are EXCLUSIVE (so the cropped width is `x2 - x1` and height is
 * `y2 - y1`), matching the Python `(x1, y1, x2, y2)` convention.
 */
export type CropRect = [number, number, number, number];

/**
 * A flat interleaved coordinate buffer `[x0, y0, x1, y1, ...]` (even lanes are
 * x, odd lanes are y). Matches the typed-array layout used by point buffers.
 */
export type FlatPoints = Float64Array | Float32Array | number[];

/** An array of `[x, y]` coordinate pairs (the `(..., 2)` numpy analog). */
export type PointPairs = ReadonlyArray<readonly [number, number]>;

/**
 * Offset interleaved coordinates by `(dx, dy)`, returning a same-typed copy.
 *
 * Even indices (x) are shifted by `dx`; odd indices (y) by `dy`. The input is
 * copied first so callers' buffers are never mutated. Non-coordinate lanes are
 * not present in this layout — the buffer is assumed to be pure interleaved
 * `(..., 2)` data.
 */
function offsetFlat<T extends FlatPoints>(
  points: T,
  dx: number,
  dy: number,
): T {
  if (Array.isArray(points)) {
    const out = points.slice() as number[];
    for (let i = 0; i + 1 < out.length; i += 2) {
      out[i] = (points as number[])[i] + dx;
      out[i + 1] = (points as number[])[i + 1] + dy;
    }
    return out as T;
  }
  // Typed array: preserve the concrete subtype (Float64Array / Float32Array).
  const typed = points as Float64Array | Float32Array;
  const out = typed.slice() as Float64Array | Float32Array;
  for (let i = 0; i + 1 < out.length; i += 2) {
    out[i] = typed[i] + dx;
    out[i + 1] = typed[i + 1] + dy;
  }
  return out as unknown as T;
}

/** Offset an array of `[x, y]` pairs by `(dx, dy)`, returning a fresh array. */
function offsetPairs(
  points: PointPairs,
  dx: number,
  dy: number,
): [number, number][] {
  return points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
}

/**
 * Adjust point coordinates for a crop transformation.
 *
 * Subtracts the crop origin `(x1, y1)` from every coordinate, mapping source
 * coordinates into the crop-local frame. NaN coordinates are preserved.
 *
 * Accepts either a flat interleaved buffer (`[x, y, x, y, ...]`, typed or
 * plain array) or an array of `[x, y]` pairs, and returns the same kind.
 *
 * @param points Source-frame coordinates.
 * @param crop Crop region `[x1, y1, x2, y2]` (x2/y2 exclusive).
 * @returns Crop-local coordinates (a copy; input unmutated).
 */
export function cropPoints<T extends FlatPoints>(points: T, crop: CropRect): T;
export function cropPoints(
  points: PointPairs,
  crop: CropRect,
): [number, number][];
export function cropPoints(
  points: FlatPoints | PointPairs,
  crop: CropRect,
): FlatPoints | [number, number][] {
  const [x1, y1] = crop;
  if (isPairs(points)) {
    return offsetPairs(points, -x1, -y1);
  }
  return offsetFlat(points, -x1, -y1);
}

/**
 * Map crop-local point coordinates back to source coordinates.
 *
 * Inverse of {@link cropPoints}: adds the crop origin `(x1, y1)` to every
 * coordinate. NaN coordinates are preserved.
 *
 * @param points Crop-local coordinates.
 * @param crop Crop region `[x1, y1, x2, y2]` (x2/y2 exclusive).
 * @returns Source-frame coordinates (a copy; input unmutated).
 */
export function uncropPoints<T extends FlatPoints>(
  points: T,
  crop: CropRect,
): T;
export function uncropPoints(
  points: PointPairs,
  crop: CropRect,
): [number, number][];
export function uncropPoints(
  points: FlatPoints | PointPairs,
  crop: CropRect,
): FlatPoints | [number, number][] {
  const [x1, y1] = crop;
  if (isPairs(points)) {
    return offsetPairs(points, x1, y1);
  }
  return offsetFlat(points, x1, y1);
}

/** Narrow to the array-of-pairs layout (vs a flat interleaved buffer). */
function isPairs(points: FlatPoints | PointPairs): points is PointPairs {
  return (
    Array.isArray(points) &&
    points.length > 0 &&
    Array.isArray((points as unknown[])[0])
  );
}
