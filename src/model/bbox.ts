import type { Instance, Track } from "./instance.js";
import { PredictedInstance, _registerBboxFactory } from "./instance.js";
import type { SegmentationMask } from "./mask.js";
import { ROI } from "./roi.js";
import type { Identity } from "./identity.js";
import type { Embedding } from "./embedding.js";
import type { RecordMetadata } from "./record-metadata.js";
import {
  Centroid,
  PredictedCentroid,
  UserCentroid,
  normalizeCentroidSource,
} from "./centroid.js";

/**
 * Padding for box conversions: a scalar applies to both axes, an `[px, py]`
 * pair applies per axis. Negative values shrink the box; values are not
 * clamped. Mirrors the `padding` argument of Python `sleap-io`.
 */
export type BboxPadding = number | [number, number];

/** Inflate the axis-aligned extent `(x1, y1, x2, y2)` by `padding`. */
function applyPadding(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  padding: BboxPadding,
): [number, number, number, number] {
  const [px, py] = Array.isArray(padding) ? padding : [padding, padding];
  return [x1 - px, y1 - py, x2 + px, y2 + py];
}

/** Options for {@link BoundingBox.fromInstance} / `Instance.toBbox()`. */
export interface BboxFromInstanceOptions {
  /**
   * `"tight"` (default) fits the visible points; `"centered"` builds a
   * fixed-`size` box centered on the instance's centroid.
   */
  mode?: "tight" | "centered";
  /**
   * Box size for `mode: "centered"` (required there). A scalar yields a
   * square box; `[w, h]` sets width and height independently.
   */
  size?: number | [number, number];
  /** Amount to inflate the box outward (see {@link BboxPadding}). */
  padding?: BboxPadding;
  /** Anchor node (name or index) for `centerMethod: "anchor"`. */
  node?: string | number;
  /**
   * Centroid method for `mode: "centered"`: `"center_of_mass"` (default),
   * `"bbox_center"` or `"anchor"` (camelCase names are accepted too).
   */
  centerMethod?: string;
  /**
   * Throw when there is nothing to fit (no visible points, or an occluded
   * anchor node) instead of returning a degenerate box with NaN corners.
   */
  errorOnEmpty?: boolean;
}

/** Options for constructing a BoundingBox. */
export interface BoundingBoxOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle?: number;
  track?: Track | null;
  instance?: Instance | null;
  trackingScore?: number | null;
  category?: string;
  name?: string;
  source?: string;
  /** Per-box values (see {@link BoundingBox.metadata}). */
  metadata?: RecordMetadata;
}

/** Base bounding box class for detection/tracking workflows. */
export class BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle: number;
  track: Track | null;
  trackingScore: number | null;
  instance: Instance | null;
  /** Per-detection re-ID identity (SLP 2.5+); attached from /identity/links. */
  identity?: Identity | null = null;
  identityScore?: number | null = null;
  identityEmbedding?: Embedding | null = null;
  /** Category confidence + appearance embedding (SLP 2.7+). */
  categoryScore?: number | null = null;
  categoryEmbedding?: Embedding | null = null;
  category: string;
  name: string;
  source: string;
  /**
   * Per-box values (bool, number or string), stored by SLP format 3.0 in
   * `/bboxes/metadata`. The 2.x layout this version writes cannot store them,
   * so a save drops them (see `saveSlpToBytes`).
   */
  metadata: RecordMetadata;
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
    this.track = options.track ?? null;
    this.trackingScore = options.trackingScore ?? null;
    this.instance = options.instance ?? null;
    this.category = options.category ?? "";
    this.name = options.name ?? "";
    this.source = options.source ?? "";
    this.metadata = options.metadata ? { ...options.metadata } : {};
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
    return new UserBoundingBox({
      x1: x,
      y1: y,
      x2: x + w,
      y2: y + h,
      ...options,
    });
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

  /** Whether the bbox is rotated (angle != 0). */
  get isRotated(): boolean {
    return this.angle !== 0;
  }

  /** Convert to a Polygon ROI. */
  toRoi(): ROI {
    const c = this.corners;
    // Close the ring
    const ring = [...c, c[0]];
    const roi = ROI.fromPolygon(ring, {
      name: this.name,
      category: this.category,
      source: this.source,
      track: this.track,
      trackingScore: this.trackingScore,
      instance: this.instance,
    });
    roi._instanceIdx = this._instanceIdx;
    return roi;
  }

  /** Convert to a SegmentationMask by rasterizing the bbox polygon. */
  toMask(height: number, width: number): SegmentationMask {
    return this.toRoi().toMask(height, width);
  }

  /** Whether this box is degenerate (any corner coordinate is NaN). */
  get isEmpty(): boolean {
    return (
      Number.isNaN(this.x1) ||
      Number.isNaN(this.y1) ||
      Number.isNaN(this.x2) ||
      Number.isNaN(this.y2)
    );
  }

  /**
   * Return a new box inflated outward by `padding`.
   *
   * The result has the same class as this box (`UserBoundingBox` or
   * `PredictedBoundingBox`) and keeps `angle`, `score` and all metadata. For a
   * rotated box the pre-rotation extent is inflated about the center, so the
   * angle is unchanged. Mirrors Python `BoundingBox.pad`.
   */
  pad(padding: BboxPadding): BoundingBox {
    const [x1, y1, x2, y2] = applyPadding(
      this.x1,
      this.y1,
      this.x2,
      this.y2,
      padding,
    );
    const opts: BoundingBoxOptions = {
      x1,
      y1,
      x2,
      y2,
      angle: this.angle,
      track: this.track,
      trackingScore: this.trackingScore,
      instance: this.instance,
      category: this.category,
      name: this.name,
      source: this.source,
      metadata: this.metadata,
    };
    const out =
      this instanceof PredictedBoundingBox
        ? new PredictedBoundingBox({ ...opts, score: this.score })
        : new UserBoundingBox(opts);
    copyDetectionMetadata(this, out);
    out._instanceIdx = this._instanceIdx;
    return out;
  }

  /**
   * Convert to a centroid at this box's center.
   *
   * A `PredictedBoundingBox` yields a `PredictedCentroid` carrying its
   * `score`; any other box yields a `UserCentroid`. Metadata is inherited. A
   * degenerate box gives a NaN centroid, or throws with `errorOnEmpty`.
   * Mirrors Python `BoundingBox.to_centroid`.
   */
  toCentroid(options?: { errorOnEmpty?: boolean }): Centroid {
    let x = Number.NaN;
    let y = Number.NaN;
    if (this.isEmpty) {
      if (options?.errorOnEmpty) {
        throw new Error(
          "Cannot compute centroid of a degenerate (NaN) bounding box.",
        );
      }
    } else {
      [x, y] = this.centroidXy;
    }
    const opts = {
      x,
      y,
      track: this.track,
      trackingScore: this.trackingScore,
      instance: this.instance,
      category: this.category,
      name: this.name,
      source: this.source,
    };
    const out =
      this instanceof PredictedBoundingBox
        ? new PredictedCentroid({ ...opts, score: this.score })
        : new UserCentroid(opts);
    copyDetectionMetadata(this, out);
    out._instanceIdx = this._instanceIdx;
    return out;
  }

  /**
   * Create an axis-aligned bounding box from a pose instance.
   *
   * A `PredictedInstance` yields a `PredictedBoundingBox` carrying its
   * `score`; any other instance yields a `UserBoundingBox`. The box links back
   * to the instance (`box.instance`) and inherits its track, tracking score,
   * identity and category. With nothing to fit it returns a box with NaN
   * corners (see {@link BoundingBox.isEmpty}), or throws with `errorOnEmpty`.
   *
   * Mirrors Python `Instance.to_bbox`, except that oriented boxes
   * (`rotated=True` there) aren't supported yet: the result is always
   * axis-aligned.
   */
  static fromInstance(
    instance: Instance,
    options?: BboxFromInstanceOptions,
  ): BoundingBox {
    const mode = options?.mode ?? "tight";
    const padding = options?.padding ?? 0;
    const empty = (reason: string): [number, number, number, number] => {
      if (options?.errorOnEmpty) throw new Error(reason);
      return [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    };

    let corners: [number, number, number, number];
    if (mode === "tight") {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let any = false;
      for (const p of instance.points) {
        const [px, py] = p.xy;
        if (!p.visible || Number.isNaN(px) || Number.isNaN(py)) continue;
        any = true;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      corners = any
        ? applyPadding(minX, minY, maxX, maxY, padding)
        : empty("No visible points to compute bounding box.");
    } else if (mode === "centered") {
      const size = options?.size;
      if (size === undefined || size === null) {
        throw new Error("'size' is required for mode 'centered'.");
      }
      const center = centerOf(instance, options ?? {});
      if (center === null) {
        corners = empty("No visible points to compute the box center.");
      } else {
        const [w, h] = Array.isArray(size) ? size : [size, size];
        const [cx, cy] = center;
        corners = applyPadding(
          cx - w / 2,
          cy - h / 2,
          cx + w / 2,
          cy + h / 2,
          padding,
        );
      }
    } else {
      throw new Error(
        `Unknown mode ${JSON.stringify(mode)}. Expected 'tight' or 'centered'.`,
      );
    }

    const [x1, y1, x2, y2] = corners;
    const opts: BoundingBoxOptions = {
      x1,
      y1,
      x2,
      y2,
      track: instance.track ?? null,
      trackingScore: instance.trackingScore ?? null,
      instance,
      category: instance.category ?? "",
    };
    const out =
      instance instanceof PredictedInstance
        ? new PredictedBoundingBox({ ...opts, score: instance.score })
        : new UserBoundingBox(opts);
    copyDetectionMetadata(instance, out);
    return out;
  }
}

/** Metadata shared by every detection modality (set after construction). */
interface DetectionMetadata {
  identity?: Identity | null;
  identityScore?: number | null;
  identityEmbedding?: Embedding | null;
  categoryScore?: number | null;
  categoryEmbedding?: Embedding | null;
}

function copyDetectionMetadata(
  from: DetectionMetadata,
  to: DetectionMetadata,
): void {
  to.identity = from.identity ?? null;
  to.identityScore = from.identityScore ?? null;
  to.identityEmbedding = from.identityEmbedding ?? null;
  to.categoryScore = from.categoryScore ?? null;
  to.categoryEmbedding = from.categoryEmbedding ?? null;
}

/**
 * Center of a `mode: "centered"` box, or `null` when there is nothing to
 * center on (no visible points, or the anchor node is occluded), which Python
 * `sleap-io` treats as an empty centroid rather than an error.
 */
function centerOf(
  instance: Instance,
  options: BboxFromInstanceOptions,
): [number, number] | null {
  if (instance.isEmpty) return null;
  const method = normalizeCentroidSource(
    options.centerMethod ?? "center_of_mass",
  );
  if (method === "anchor" && options.node !== undefined) {
    const idx =
      typeof options.node === "string"
        ? instance.skeleton.index(options.node)
        : options.node;
    const p = instance.points[idx];
    if (p && (!p.visible || Number.isNaN(p.xy[0]) || Number.isNaN(p.xy[1]))) {
      return null;
    }
  }
  const c = Centroid.fromInstance(instance, { method, node: options.node });
  return [c.x, c.y];
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

// Register the bbox factory for Instance.toBbox()
_registerBboxFactory((instance, options) =>
  BoundingBox.fromInstance(instance, options),
);
