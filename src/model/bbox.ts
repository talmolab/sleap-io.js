import type { Video } from "./video.js";
import type { Track, Instance } from "./instance.js";
import { ROI } from "./roi.js";

/** Options for constructing a BoundingBox. */
export interface BoundingBoxOptions {
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
  angle?: number;
  video?: Video | null;
  frameIdx?: number | null;
  track?: Track | null;
  instance?: Instance | null;
  category?: string;
  name?: string;
  source?: string;
}

/** Base bounding box class for detection/tracking workflows. */
export class BoundingBox {
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
  angle: number;
  video: Video | null;
  frameIdx: number | null;
  track: Track | null;
  instance: Instance | null;
  category: string;
  name: string;
  source: string;
  _instanceIdx: number | null = null;

  constructor(options: BoundingBoxOptions) {
    this.xCenter = options.xCenter;
    this.yCenter = options.yCenter;
    this.width = options.width;
    this.height = options.height;
    this.angle = options.angle ?? 0;
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.track = options.track ?? null;
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
    options?: Omit<BoundingBoxOptions, "xCenter" | "yCenter" | "width" | "height">,
  ): UserBoundingBox {
    return new UserBoundingBox({
      xCenter: (x1 + x2) / 2,
      yCenter: (y1 + y2) / 2,
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      ...options,
    });
  }

  /** Create from top-left corner + size [x, y, w, h]. */
  static fromXywh(
    x: number,
    y: number,
    w: number,
    h: number,
    options?: Omit<BoundingBoxOptions, "xCenter" | "yCenter" | "width" | "height">,
  ): UserBoundingBox {
    return new UserBoundingBox({
      xCenter: x + w / 2,
      yCenter: y + h / 2,
      width: w,
      height: h,
      ...options,
    });
  }

  /** Axis-aligned bounding box as [x1, y1, x2, y2]. */
  get xyxy(): [number, number, number, number] {
    if (!this.isRotated) {
      return [
        this.xCenter - this.width / 2,
        this.yCenter - this.height / 2,
        this.xCenter + this.width / 2,
        this.yCenter + this.height / 2,
      ];
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

  /** Center point. */
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
  toMask(height: number, width: number) {
    return this.toRoi().toMask(height, width);
  }
}

/** User-annotated bounding box (no prediction score). */
export class UserBoundingBox extends BoundingBox {
  get isPredicted(): boolean {
    return false;
  }
}

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
