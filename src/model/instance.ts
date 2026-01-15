import { Skeleton, Node } from "./skeleton.js";

export class Track {
  name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export type Point = {
  xy: [number, number];
  visible: boolean;
  complete: boolean;
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

  get isEmpty(): boolean {
    return this.points.every((point) => !point.visible || Number.isNaN(point.xy[0]));
  }

  overlapsWith(other: Instance, iouThreshold = 0.1): boolean {
    const boxA = this.boundingBox();
    const boxB = other.boundingBox();
    if (!boxA || !boxB) return false;
    const iou = intersectionOverUnion(boxA, boxB);
    return iou >= iouThreshold;
  }

  boundingBox(): [number, number, number, number] | null {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const point of this.points) {
      if (Number.isNaN(point.xy[0]) || Number.isNaN(point.xy[1])) continue;
      xs.push(point.xy[0]);
      ys.push(point.xy[1]);
    }
    if (!xs.length || !ys.length) return null;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return [minX, minY, maxX, maxY];
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
        return [xy[0], xy[1], (point as PredictedPoint).score ?? 0];
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

function intersectionOverUnion(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number {
  const [ax1, ay1, ax2, ay2] = boxA;
  const [bx1, by1, bx2, by2] = boxB;
  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);
  const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - interArea;
  if (union === 0) return 0;
  return interArea / union;
}
