import { Skeleton, Node } from "./skeleton.js";

// Late-binding factory to avoid circular imports with centroid.ts.
// Set by centroid.ts when it is imported.
type CentroidFactory = (instance: Instance | PredictedInstance, options?: { method?: string; node?: string | number }) => any;
let _centroidFactory: CentroidFactory | null = null;
export function _registerCentroidFactory(factory: CentroidFactory): void {
  _centroidFactory = factory;
}

export class Track {
  name: string;

  constructor(name = "") {
    this.name = name;
  }

  matches(other: Track, method = "name"): boolean {
    if (method === "name") {
      return this.name === other.name;
    }
    if (method === "identity") {
      return this === other;
    }
    throw new Error("Unknown matching method: " + method);
  }
}

export type Point = {
  xy: [number, number];
  visible: boolean;
  complete: boolean;
  score?: number;
  name?: string;
};

export type PredictedPoint = Point & { score: number };

export type PointsArray = Point[];
export type PredictedPointsArray = PredictedPoint[];

export function pointsEmpty(length: number, names?: string[]): PointsArray {
  const pts: PointsArray = [];
  for (let i = 0; i < length; i += 1) {
    pts.push({
      xy: [Number.NaN, Number.NaN],
      visible: false,
      complete: false,
      name: names?.[i],
    });
  }
  return pts;
}

export function predictedPointsEmpty(length: number, names?: string[]): PredictedPointsArray {
  const pts: PredictedPointsArray = [];
  for (let i = 0; i < length; i += 1) {
    pts.push({
      xy: [Number.NaN, Number.NaN],
      visible: false,
      complete: false,
      score: Number.NaN,
      name: names?.[i],
    });
  }
  return pts;
}

export function pointsFromArray(array: number[][], names?: string[]): PointsArray {
  const pts: PointsArray = [];
  for (let i = 0; i < array.length; i += 1) {
    const row = array[i] ?? [Number.NaN, Number.NaN];
    const visible = row.length > 2 ? Boolean(row[2]) : !Number.isNaN(row[0]);
    const complete = row.length > 3 ? Boolean(row[3]) : false;
    pts.push({ xy: [row[0] ?? Number.NaN, row[1] ?? Number.NaN], visible, complete, name: names?.[i] });
  }
  return pts;
}

export function predictedPointsFromArray(array: number[][], names?: string[]): PredictedPointsArray {
  const pts: PredictedPointsArray = [];
  for (let i = 0; i < array.length; i += 1) {
    const row = array[i] ?? [Number.NaN, Number.NaN, Number.NaN];
    const visible = row.length > 3 ? Boolean(row[3]) : !Number.isNaN(row[0]);
    const complete = row.length > 4 ? Boolean(row[4]) : false;
    pts.push({
      xy: [row[0] ?? Number.NaN, row[1] ?? Number.NaN],
      score: row[2] ?? Number.NaN,
      visible,
      complete,
      name: names?.[i],
    });
  }
  return pts;
}

export class Instance {
  points: PointsArray;
  skeleton: Skeleton;
  track?: Track | null;
  fromPredicted?: PredictedInstance | null;
  trackingScore: number;

  constructor(options: {
    points: PointsArray | Record<string, number[]>;
    skeleton: Skeleton;
    track?: Track | null;
    fromPredicted?: PredictedInstance | null;
    trackingScore?: number;
  }) {
    this.skeleton = options.skeleton;
    this.track = options.track ?? null;
    this.fromPredicted = options.fromPredicted ?? null;
    this.trackingScore = options.trackingScore ?? 0;
    if (Array.isArray(options.points)) {
      this.points = options.points;
    } else {
      this.points = pointsFromDict(options.points, options.skeleton);
    }
  }

  static fromArray(points: number[][], skeleton: Skeleton): Instance {
    return new Instance({ points: pointsFromArray(points, skeleton.nodeNames), skeleton });
  }

  static fromNumpy(options: {
    pointsData: number[][];
    skeleton: Skeleton;
    track?: Track | null;
    fromPredicted?: PredictedInstance | null;
    trackingScore?: number;
  }): Instance {
    return new Instance({
      points: pointsFromArray(options.pointsData, options.skeleton.nodeNames),
      skeleton: options.skeleton,
      track: options.track ?? null,
      fromPredicted: options.fromPredicted ?? null,
      trackingScore: options.trackingScore,
    });
  }

  static empty(options: { skeleton: Skeleton }): Instance {
    return new Instance({ points: pointsEmpty(options.skeleton.nodeNames.length, options.skeleton.nodeNames), skeleton: options.skeleton });
  }

  get length(): number {
    return this.points.length;
  }

  get nVisible(): number {
    return this.points.filter((point) => point.visible).length;
  }

  getPoint(target: number | string | Node): Point {
    if (typeof target === "number") {
      if (target < 0 || target >= this.points.length) throw new Error("Point index out of range.");
      return this.points[target];
    }
    if (typeof target === "string") {
      const index = this.skeleton.index(target);
      return this.points[index];
    }
    const index = this.skeleton.index(target.name);
    return this.points[index];
  }

  numpy(options?: { invisibleAsNaN?: boolean }): number[][] {
    const invisibleAsNaN = options?.invisibleAsNaN ?? true;
    return this.points.map((point) => {
      if (invisibleAsNaN && !point.visible) {
        return [Number.NaN, Number.NaN];
      }
      return [point.xy[0], point.xy[1]];
    });
  }

  toString(): string {
    const trackName = this.track ? `"${this.track.name}"` : "None";
    return `Instance(points=${JSON.stringify(this.numpy({ invisibleAsNaN: false }))}, track=${trackName})`;
  }

  /** Mean of visible point coordinates as `[x, y]`, or `null` if no points visible. */
  get centroidXy(): [number, number] | null {
    let sumX = 0, sumY = 0, count = 0;
    for (const point of this.points) {
      if (point.visible && !Number.isNaN(point.xy[0]) && !Number.isNaN(point.xy[1])) {
        sumX += point.xy[0];
        sumY += point.xy[1];
        count++;
      }
    }
    if (count === 0) return null;
    return [sumX / count, sumY / count];
  }

  /**
   * Create a Centroid from this instance.
   *
   * @param method - "centerOfMass" (default), "bboxCenter", or "anchor".
   * @param node - Node specification for "anchor" method.
   * @returns UserCentroid or PredictedCentroid depending on instance type.
   */
  toCentroid(method?: string, node?: string | number) {
    if (!_centroidFactory) {
      throw new Error(
        "Centroid not available. Import centroid.ts before calling toCentroid().",
      );
    }
    return _centroidFactory(this, { method, node });
  }

  get isEmpty(): boolean {
    return this.points.every((point) => !point.visible || Number.isNaN(point.xy[0]));
  }

  /**
   * Check if this instance has the same pose as another instance.
   *
   * Mirrors Python `Instance.same_pose_as` (instance.py:699-753).
   *
   * @param other - Another instance to compare with.
   * @param tolerance - Maximum distance (in pixels) between corresponding points
   *   for them to be considered the same. If `null`/`undefined`, uses exact
   *   comparison including NaN==NaN handling.
   * @returns `true` if the instances have the same pose within tolerance.
   */
  samePoseAs(other: Instance, tolerance?: number | null): boolean {
    // Check skeleton compatibility (default requireSameOrder=false). Short-circuit
    // before any point comparison.
    if (!this.skeleton.matches(other.skeleton)) return false;

    const a = this.numpy();
    const b = other.numpy();

    if (tolerance == null) {
      // Exact comparison with NaN treated as equal to NaN.
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          const av = a[i][j];
          const bv = b[i][j];
          const aNaN = Number.isNaN(av);
          const bNaN = Number.isNaN(bv);
          if (aNaN !== bNaN) return false;
          if (!aNaN && av !== bv) return false;
        }
      }
      return true;
    }

    // Tolerance-based comparison with NaN-pattern check.
    if (a.length !== b.length) return false;
    // First, check that the NaN patterns match exactly over the full (n, 2).
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        if (Number.isNaN(a[i][j]) !== Number.isNaN(b[i][j])) return false;
      }
    }

    // Gather the non-NaN values row-major from both arrays.
    const aVals: number[] = [];
    const bVals: number[] = [];
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        if (!Number.isNaN(a[i][j])) {
          aVals.push(a[i][j]);
          bVals.push(b[i][j]);
        }
      }
    }

    // If all values are NaN, they are considered equal.
    if (aVals.length === 0) return true;

    // Pair into (k, 2) and compare per-pair Euclidean distance.
    for (let k = 0; k < aVals.length; k += 2) {
      const dx = aVals[k] - bVals[k];
      const dy = aVals[k + 1] - bVals[k + 1];
      const distance = Math.hypot(dx, dy);
      if (!(distance <= tolerance)) return false;
    }
    return true;
  }

  /**
   * Check if this instance has the same identity (track) as another instance.
   *
   * Mirrors Python `Instance.same_identity_as` (instance.py:755-770). Compares
   * tracks by reference identity, not by name.
   *
   * @param other - Another instance to compare with.
   * @returns `true` if both instances share the same `Track` object.
   */
  sameIdentityAs(other: Instance): boolean {
    if (this.track == null || other.track == null) return false;
    return this.track === other.track;
  }

  /**
   * Check if this instance overlaps with another by bounding-box IoU.
   *
   * Mirrors Python `Instance.overlaps_with` (instance.py:772-830). Bounding
   * boxes are computed over VISIBLE points; if either has none, returns false.
   * If the boxes do not STRICTLY intersect on both axes (touching edges count
   * as no overlap), returns false regardless of `iouThreshold` — this matches
   * Python's `np.any(intersection_min >= intersection_max) -> False`
   * short-circuit, which runs before the threshold comparison.
   *
   * @param other - Another instance to compare with.
   * @param iouThreshold - Minimum IoU to count as overlapping (inclusive `>=`).
   */
  overlapsWith(other: Instance, iouThreshold = 0.5): boolean {
    const boxA = this.boundingBox();
    const boxB = other.boundingBox();
    if (!boxA || !boxB) return false;

    // box[0] = [minX, minY] (mins), box[1] = [maxX, maxY] (maxs).
    const interMinX = Math.max(boxA[0][0], boxB[0][0]);
    const interMinY = Math.max(boxA[0][1], boxB[0][1]);
    const interMaxX = Math.min(boxA[1][0], boxB[1][0]);
    const interMaxY = Math.min(boxA[1][1], boxB[1][1]);

    // No strict intersection on either axis -> not overlapping, independent of
    // the threshold (Python returns False here before the `>= threshold` check).
    if (interMinX >= interMaxX || interMinY >= interMaxY) return false;

    const interArea = (interMaxX - interMinX) * (interMaxY - interMinY);
    const areaA = (boxA[1][0] - boxA[0][0]) * (boxA[1][1] - boxA[0][1]);
    const areaB = (boxB[1][0] - boxB[0][0]) * (boxB[1][1] - boxB[0][1]);
    const union = areaA + areaB - interArea;
    const iou = union > 0 ? interArea / union : 0;
    return iou >= iouThreshold;
  }

  /**
   * Get the bounding box of visible points.
   *
   * Mirrors Python `Instance.bounding_box` (instance.py:832-849).
   *
   * @returns `[[minX, minY], [maxX, maxY]]` over visible points, or `null` if
   *   there are no visible points.
   */
  boundingBox(): [[number, number], [number, number]] | null {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const point of this.points) {
      if (!point.visible) continue;
      xs.push(point.xy[0]);
      ys.push(point.xy[1]);
    }
    if (!xs.length) return null;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return [[minX, minY], [maxX, maxY]];
  }
}

export class PredictedInstance extends Instance {
  score: number;

  constructor(options: {
    points: PredictedPointsArray | Record<string, number[]>;
    skeleton: Skeleton;
    track?: Track | null;
    score?: number;
    trackingScore?: number;
  }) {
    const { score = 0, ...rest } = options;
    const pts = Array.isArray(rest.points)
      ? rest.points
      : predictedPointsFromDict(rest.points as Record<string, number[]>, rest.skeleton);
    super({
      points: pts as PointsArray,
      skeleton: rest.skeleton,
      track: rest.track,
      trackingScore: rest.trackingScore,
    });
    this.score = score;
  }

  static fromArray(points: number[][], skeleton: Skeleton, score?: number): PredictedInstance {
    return new PredictedInstance({
      points: predictedPointsFromArray(points, skeleton.nodeNames),
      skeleton,
      score,
    });
  }

  static fromNumpy(options: {
    pointsData: number[][];
    skeleton: Skeleton;
    track?: Track | null;
    score?: number;
    trackingScore?: number;
  }): PredictedInstance {
    return new PredictedInstance({
      points: predictedPointsFromArray(options.pointsData, options.skeleton.nodeNames),
      skeleton: options.skeleton,
      track: options.track ?? null,
      score: options.score,
      trackingScore: options.trackingScore,
    });
  }

  static empty(options: { skeleton: Skeleton }): PredictedInstance {
    return new PredictedInstance({ points: predictedPointsEmpty(options.skeleton.nodeNames.length, options.skeleton.nodeNames), skeleton: options.skeleton });
  }

  numpy(options?: { scores?: boolean; invisibleAsNaN?: boolean }): number[][] {
    const invisibleAsNaN = options?.invisibleAsNaN ?? true;
    return this.points.map((point) => {
      const xy = invisibleAsNaN && !point.visible ? [Number.NaN, Number.NaN] : [point.xy[0], point.xy[1]];
      if (options?.scores) {
        return [xy[0], xy[1], point.score ?? 0];
      }
      return xy;
    });
  }

  toString(): string {
    const trackName = this.track ? `"${this.track.name}"` : "None";
    return `PredictedInstance(points=${JSON.stringify(this.numpy({ invisibleAsNaN: false }))}, track=${trackName}, score=${this.score.toFixed(2)}, tracking_score=${this.trackingScore ?? "None"})`;
  }
}

export function pointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PointsArray {
  const points = pointsEmpty(skeleton.nodeNames.length, skeleton.nodeNames);
  for (const [nodeName, data] of Object.entries(pointsDict)) {
    const index = skeleton.index(nodeName);
    points[index] = {
      xy: [data[0] ?? Number.NaN, data[1] ?? Number.NaN],
      visible: data.length > 2 ? Boolean(data[2]) : !Number.isNaN(data[0]),
      complete: data.length > 3 ? Boolean(data[3]) : false,
      name: nodeName,
    };
  }
  return points;
}

export function predictedPointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PredictedPointsArray {
  const points = predictedPointsEmpty(skeleton.nodeNames.length, skeleton.nodeNames);
  for (const [nodeName, data] of Object.entries(pointsDict)) {
    const index = skeleton.index(nodeName);
    points[index] = {
      xy: [data[0] ?? Number.NaN, data[1] ?? Number.NaN],
      score: data[2] ?? Number.NaN,
      visible: data.length > 3 ? Boolean(data[3]) : !Number.isNaN(data[0]),
      complete: data.length > 4 ? Boolean(data[4]) : false,
      name: nodeName,
    };
  }
  return points;
}

