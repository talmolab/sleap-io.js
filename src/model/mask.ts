import type { Video } from "./video.js";
import type { Track, Instance } from "./instance.js";
import { ROI, _registerMaskFactory } from "./roi.js";
import type { Geometry } from "./roi.js";
import { type BoundingBox, UserBoundingBox, PredictedBoundingBox } from "./bbox.js";

export function encodeRle(
  mask: Uint8Array,
  height: number,
  width: number,
): Uint32Array {
  const total = height * width;
  if (total === 0) return new Uint32Array(0);

  const runs: number[] = [];
  let currentVal = 0;
  let count = 0;

  for (let i = 0; i < total; i++) {
    const val = mask[i] ? 1 : 0;
    if (val === currentVal) {
      count++;
    } else {
      runs.push(count);
      currentVal = val;
      count = 1;
    }
  }
  runs.push(count);

  return new Uint32Array(runs);
}

export function decodeRle(
  rleCounts: Uint32Array,
  height: number,
  width: number,
): Uint8Array {
  const total = height * width;
  if (rleCounts.length === 0) return new Uint8Array(total);

  const flat = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < rleCounts.length; i++) {
    const val = i % 2 === 0 ? 0 : 1;
    const count = rleCounts[i];
    if (val === 1) {
      for (let j = 0; j < count && pos + j < total; j++) {
        flat[pos + j] = 1;
      }
    }
    pos += count;
  }

  return flat;
}

/**
 * Resize a typed array using nearest-neighbor interpolation.
 * The input is a flat (H*W) array and the output is a flat (dstH*dstW) array.
 */
export function resizeNearest<T extends Uint8Array | Int32Array | Float32Array>(
  data: T,
  srcH: number,
  srcW: number,
  dstH: number,
  dstW: number,
): T {
  const Ctor = data.constructor as new (len: number) => T;
  const result = new Ctor(dstH * dstW);
  for (let r = 0; r < dstH; r++) {
    const srcR = Math.min(Math.floor((r * srcH) / dstH), srcH - 1);
    for (let c = 0; c < dstW; c++) {
      const srcC = Math.min(Math.floor((c * srcW) / dstW), srcW - 1);
      result[r * dstW + c] = data[srcR * srcW + srcC];
    }
  }
  return result;
}

export interface SegmentationMaskOptions {
  rleCounts: Uint32Array;
  height: number;
  width: number;
  name?: string;
  category?: string;
  source?: string;
  video?: Video | null;
  frameIdx?: number | null;
  track?: Track | null;
  trackingScore?: number | null;
  instance?: Instance | null;
  scale?: [number, number];
  offset?: [number, number];
}

export class SegmentationMask {
  rleCounts: Uint32Array;
  height: number;
  width: number;
  name: string;
  category: string;
  source: string;
  video: Video | null;
  frameIdx: number | null;
  track: Track | null;
  trackingScore: number | null = null;
  instance: Instance | null;
  /** Spatial scale factor: image_coord = mask_coord / scale + offset. Default [1, 1]. */
  scale: [number, number];
  /** Spatial offset: image_coord = mask_coord / scale + offset. Default [0, 0]. */
  offset: [number, number];
  /** @internal Deferred instance index for lazy resolution. */
  _instanceIdx: number | null = null;

  constructor(options: SegmentationMaskOptions) {
    if (new.target === SegmentationMask) {
      throw new TypeError(
        "SegmentationMask is abstract. Use UserSegmentationMask or PredictedSegmentationMask.",
      );
    }
    const scale = options.scale ?? [1, 1];
    if (scale[0] <= 0 || scale[1] <= 0) {
      throw new Error(`Scale must be positive, got [${scale[0]}, ${scale[1]}].`);
    }
    this.rleCounts = options.rleCounts;
    this.height = options.height;
    this.width = options.width;
    this.name = options.name ?? "";
    this.category = options.category ?? "";
    this.source = options.source ?? "";
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.track = options.track ?? null;
    this.trackingScore = options.trackingScore ?? null;
    this.instance = options.instance ?? null;
    this.scale = scale;
    this.offset = options.offset ?? [0, 0];
  }

  static fromArray(
    mask: Uint8Array | boolean[][],
    height: number,
    width: number,
    options?: Omit<SegmentationMaskOptions, "rleCounts" | "height" | "width"> & { stride?: number },
  ): UserSegmentationMask {
    let flat: Uint8Array;
    if (mask instanceof Uint8Array) {
      flat = mask;
    } else {
      flat = new Uint8Array(height * width);
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          flat[r * width + c] = mask[r][c] ? 1 : 0;
        }
      }
    }
    const rleCounts = encodeRle(flat, height, width);
    // If stride is specified, derive scale as 1/stride. Explicit scale takes precedence.
    const stride = options?.stride;
    const scaleFromStride: [number, number] | undefined =
      stride != null ? [1 / stride, 1 / stride] : undefined;
    return new UserSegmentationMask({
      rleCounts,
      height,
      width,
      ...options,
      scale: options?.scale ?? scaleFromStride,
    });
  }

  get data(): Uint8Array {
    return decodeRle(this.rleCounts, this.height, this.width);
  }

  get area(): number {
    let total = 0;
    for (let i = 1; i < this.rleCounts.length; i += 2) {
      total += this.rleCounts[i];
    }
    return total;
  }

  /** Whether scale != [1,1] or offset != [0,0]. */
  get hasSpatialTransform(): boolean {
    return (
      this.scale[0] !== 1 ||
      this.scale[1] !== 1 ||
      this.offset[0] !== 0 ||
      this.offset[1] !== 0
    );
  }

  /** The image-space extent of this mask (accounting for scale). */
  get imageExtent(): { height: number; width: number } {
    return {
      height: Math.floor(this.height / this.scale[1]),
      width: Math.floor(this.width / this.scale[0]),
    };
  }

  get isPredicted(): boolean {
    return false;
  }

  /**
   * Create a resampled copy of this mask at the target dimensions.
   * The returned mask has scale=[1,1] and offset=[0,0].
   */
  resampled(targetHeight: number, targetWidth: number): SegmentationMask {
    const srcData = this.data;
    const resized = resizeNearest(srcData, this.height, this.width, targetHeight, targetWidth);
    const rleCounts = encodeRle(resized, targetHeight, targetWidth);

    const baseOpts: SegmentationMaskOptions = {
      rleCounts,
      height: targetHeight,
      width: targetWidth,
      name: this.name,
      category: this.category,
      source: this.source,
      video: this.video,
      frameIdx: this.frameIdx,
      track: this.track,
      instance: this.instance,
      scale: [1, 1],
      offset: [0, 0],
    };

    if (this instanceof PredictedSegmentationMask) {
      const pm = this as PredictedSegmentationMask;
      let resampledScoreMap: Float32Array | null = null;
      if (pm.scoreMap) {
        resampledScoreMap = resizeNearest(
          pm.scoreMap,
          this.height,
          this.width,
          targetHeight,
          targetWidth,
        );
      }
      return new PredictedSegmentationMask({
        ...baseOpts,
        score: pm.score,
        scoreMap: resampledScoreMap,
      });
    }

    return new UserSegmentationMask(baseOpts);
  }

  get bbox(): { x: number; y: number; width: number; height: number } {
    const flat = this.data;
    let minR = this.height,
      maxR = -1,
      minC = this.width,
      maxC = -1;

    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (flat[r * this.width + c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }

    if (maxR === -1) return { x: 0, y: 0, width: 0, height: 0 };

    const [sx, sy] = this.scale;
    const [ox, oy] = this.offset;
    return {
      x: minC / sx + ox,
      y: minR / sy + oy,
      width: (maxC - minC + 1) / sx,
      height: (maxR - minR + 1) / sy,
    };
  }

  /** Convert to a `BoundingBox` object with metadata.
   *
   * Returns a `UserBoundingBox` or `PredictedBoundingBox` depending on whether
   * this mask is predicted. Coordinates are in image space (respecting
   * scale/offset).
   */
  toBbox(): BoundingBox {
    const { x, y, width, height } = this.bbox;
    const opts = {
      x1: x,
      y1: y,
      x2: x + width,
      y2: y + height,
      video: this.video,
      frameIdx: this.frameIdx,
      track: this.track,
      instance: this.instance,
      category: this.category,
      name: this.name,
      source: this.source,
    };
    if (this instanceof PredictedSegmentationMask) {
      return new PredictedBoundingBox({
        ...opts,
        score: this.score,
      });
    }
    return new UserBoundingBox(opts);
  }

  /** Convert the mask to a bounding-box polygon ROI. */
  toPolygon(): ROI {
    const bb = this.bbox;
    let geometry: Geometry;
    if (bb.width === 0 || bb.height === 0) {
      geometry = { type: "Polygon", coordinates: [[]] };
    } else {
      const { x, y, width, height } = bb;
      geometry = {
        type: "Polygon",
        coordinates: [
          [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height],
            [x, y],
          ],
        ],
      };
    }

    return ROI.fromPolygon(
      (geometry as { type: "Polygon"; coordinates: number[][][] }).coordinates[0],
      {
        name: this.name,
        category: this.category,
        source: this.source,
        video: this.video,
        frameIdx: this.frameIdx,
        track: this.track,
        instance: this.instance,
      },
    );
  }
}

/** User-annotated segmentation mask (no prediction score). */
export class UserSegmentationMask extends SegmentationMask {}

/** Predicted segmentation mask with a confidence score and optional score map. */
export class PredictedSegmentationMask extends SegmentationMask {
  score: number;
  scoreMap: Float32Array | null;
  /** Spatial scale for the score map. Default [1, 1]. */
  scoreMapScale: [number, number];
  /** Spatial offset for the score map. Default [0, 0]. */
  scoreMapOffset: [number, number];

  constructor(
    options: SegmentationMaskOptions & {
      score: number;
      scoreMap?: Float32Array | null;
      scoreMapScale?: [number, number];
      scoreMapOffset?: [number, number];
    },
  ) {
    super(options);
    this.score = options.score;
    this.scoreMap = options.scoreMap ?? null;
    this.scoreMapScale = options.scoreMapScale ?? [1, 1];
    this.scoreMapOffset = options.scoreMapOffset ?? [0, 0];
  }

  get isPredicted(): boolean {
    return true;
  }
}

// Register mask factory for ROI.toMask() to use
_registerMaskFactory(
  (mask: Uint8Array, height: number, width: number, options: Record<string, unknown>) => {
    return SegmentationMask.fromArray(mask, height, width, options as Omit<
      SegmentationMaskOptions,
      "rleCounts" | "height" | "width"
    >);
  },
);
