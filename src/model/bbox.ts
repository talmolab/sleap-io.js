import type { Video } from "./video.js";
import type { Track, Instance } from "./instance.js";
import type { SegmentationMask } from "./mask.js";
import { ROI } from "./roi.js";

/** Options for constructing a BoundingBox. */
export interface BoundingBoxOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle?: number;
  video?: Video | null;
  frameIdx?: number | null;
  track?: Track | null;
  instance?: Instance | null;
  trackingScore?: number | null;
  category?: string;
  name?: string;
  source?: string;
}

/** Base bounding box class for detection/tracking workflows. */
export class BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle: number;
  video: Video | null;
  frameIdx: number | null;
  track: Track | null;
  trackingScore: number | null;
  instance: Instance | null;
  category: string;
  name: string;
  source: string;
  /** @internal Deferred instance index for lazy resolution. */
  _instanceIdx: number | null = null;

  constructor(options: BoundingBoxOptions) {
    if (new.target === BoundingBox) {
      throw new TypeError(
        "BoundingBox is abstract. Use UserBoundingBox or PredictedBoundingBox.",
      );
    }
    this.x1 = options.x1;
    this.y1 = options.y1;
    this.x2 = options.x2;
    this.y2 = options.y2;
    this.angle = options.angle ?? 0;
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.track = options.track ?? null;
    this.trackingScore = options.trackingScore ?? null;
    this.instance = options.instance ?? null;
    this.category = options.category ?? "";
    this.name = options.name ?? "";
    this.source = options.source ?? "";
  }

  /** Create from corner coordinates [x1, y1, x2, y2]. */
  static fromXyxy(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: Omit<BoundingBoxOptions, "x1" | "y1" | "x2" | "y2">,
  ): UserBoundingBox {
    return new UserBoundingBox({ x1, y1, x2, y2, ...options });
  }

  /** Create from top-left corner + size [x, y, w, h]. */
  static fromXywh(
    x: number,
    y: number,
    w: number,
    h: number,
    options?: Omit<BoundingBoxOptions, "x1" | "y1" | "x2" | "y2">,
  ): UserBoundingBox {
    return new UserBoundingBox({ x1: x, y1: y, x2: x + w, y2: y + h, ...options });
  }

  /** Center X coordinate (computed from x1, x2). */
  get xCenter(): number {
    return (this.x1 + this.x2) / 2;
  }

  /** Center Y coordinate (computed from y1, y2). */
  get yCenter(): number {
    return (this.y1 + this.y2) / 2;
  }

  /** Width of the bbox (computed from x1, x2). */
  get width(): number {
    return Math.abs(this.x2 - this.x1);
  }

  /** Height of the bbox (computed from y1, y2). */
  get height(): number {
    return Math.abs(this.y2 - this.y1);
  }

  /** Axis-aligned bounding box as [x1, y1, x2, y2]. */
  get xyxy(): [number, number, number, number] {
    if (!this.isRotated) {
      return [this.x1, this.y1, this.x2, this.y2];
    }
    // For rotated bboxes, compute AABB of the rotated corners
    const c = this.corners;
    const xs = c.map((p) => p[0]);
    const ys = c.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  /** Top-left x, y and size (AABB dimensions for rotated bboxes). */
  get xywh(): { x: number; y: number; width: number; height: number } {
    const [x1, y1, x2, y2] = this.xyxy;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  /** Four corner points of the (possibly rotated) bbox. */
  get corners(): number[][] {
    const hw = this.width / 2;
    const hh = this.height / 2;
    // Unrotated corners relative to center
    const local: [number, number][] = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    if (!this.isRotated) {
      return local.map(([dx, dy]) => [this.xCenter + dx, this.yCenter + dy]);
    }
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    return local.map(([dx, dy]) => [
      this.xCenter + dx * cos - dy * sin,
      this.yCenter + dx * sin + dy * cos,
    ]);
  }

  /** Axis-aligned bounds. */
  get bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const [x1, y1, x2, y2] = this.xyxy;
    return { minX: x1, minY: y1, maxX: x2, maxY: y2 };
  }

  /** Area of the bbox (width * height). */
  get area(): number {
    return this.width * this.height;
  }

  /** Center point as `[x, y]`. */
  get centroidXy(): [number, number] {
    return [this.xCenter, this.yCenter];
  }

  /** @deprecated Use `centroidXy` instead. */
  get centroid(): { x: number; y: number } {
    return { x: this.xCenter, y: this.yCenter };
  }

  /** Whether this is a predicted bbox (has a score). */
  get isPredicted(): boolean {
    return false;
  }

  /** Whether the bbox has no temporal association. */
  get isStatic(): boolean {
    return this.frameIdx === null;
  }

  /** Whether the bbox is rotated (angle != 0). */
  get isRotated(): boolean {
    return this.angle !== 0;
  }

  /** Convert to a Polygon ROI. */
  toRoi(): ROI {
    const c = this.corners;
    // Close the ring
    const ring = [...c, c[0]];
    return ROI.fromPolygon(ring, {
      name: this.name,
      category: this.category,
      source: this.source,
      video: this.video,
      frameIdx: this.frameIdx,
      track: this.track,
      instance: this.instance,
    });
  }

  /** Convert to a SegmentationMask by rasterizing the bbox polygon. */
  toMask(height: number, width: number): SegmentationMask {
    return this.toRoi().toMask(height, width);
  }
}

/** User-annotated bounding box (no prediction score). */
export class UserBoundingBox extends BoundingBox {}

/** Predicted bounding box with a confidence score. */
export class PredictedBoundingBox extends BoundingBox {
  score: number;

  constructor(options: BoundingBoxOptions & { score: number }) {
    super(options);
    this.score = options.score;
  }

  get isPredicted(): boolean {
    return true;
  }
}
