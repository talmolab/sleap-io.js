import type { Video } from "./video.js";
import type { Track } from "./instance.js";
import { Instance, PredictedInstance, _registerCentroidFactory } from "./instance.js";
import { Skeleton } from "./skeleton.js";

/** Shared single-node skeleton for centroid-to-instance conversions. */
let _centroidSkeleton: Skeleton | null = null;

/** Return the shared single-node `Skeleton(["centroid"])` instance. */
export function getCentroidSkeleton(): Skeleton {
  if (!_centroidSkeleton) {
    _centroidSkeleton = new Skeleton({ nodes: ["centroid"], name: "centroid" });
  }
  return _centroidSkeleton;
}

/**
 * Module-level constant for the centroid skeleton.
 * Lazily initialized on first access.
 */
export const CENTROID_SKELETON: Skeleton = /* @__PURE__ */ (() => getCentroidSkeleton())();

/** Options for constructing a Centroid. */
export interface CentroidOptions {
  x: number;
  y: number;
  z?: number | null;
  video?: Video | null;
  frameIdx?: number | null;
  track?: Track | null;
  trackingScore?: number | null;
  instance?: Instance | null;
  category?: string;
  name?: string;
  source?: string;
}

/**
 * A point representing the center of an object.
 *
 * Supports optional 3D coordinates, video/frame/track/instance metadata,
 * and interconversion with single-node Instance objects.
 *
 * This class is abstract. Use UserCentroid or PredictedCentroid.
 */
export class Centroid {
  x: number;
  y: number;
  z: number | null;
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

  constructor(options: CentroidOptions) {
    if (new.target === Centroid) {
      throw new TypeError(
        "Centroid is abstract. Use UserCentroid or PredictedCentroid.",
      );
    }
    this.x = options.x;
    this.y = options.y;
    this.z = options.z ?? null;
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.track = options.track ?? null;
    this.trackingScore = options.trackingScore ?? null;
    this.instance = options.instance ?? null;
    this.category = options.category ?? "";
    this.name = options.name ?? "";
    this.source = options.source ?? "";
  }

  /** Coordinates as `[x, y]`. */
  get xy(): [number, number] {
    return [this.x, this.y];
  }

  /** Coordinates as `[y, x]` (row, col order). */
  get yx(): [number, number] {
    return [this.y, this.x];
  }

  /** Coordinates as `[x, y, z]`. */
  get xyz(): [number, number, number | null] {
    return [this.x, this.y, this.z];
  }

  /** Whether this is a predicted centroid (has a score). */
  get isPredicted(): boolean {
    return false;
  }

  /** Whether the centroid has no temporal association. */
  get isStatic(): boolean {
    return this.frameIdx === null;
  }

  /**
   * Convert this centroid to a single-node Instance.
   *
   * @param skeleton - Skeleton to use. Must have exactly one node.
   *   Defaults to the shared CENTROID_SKELETON.
   * @returns Instance or PredictedInstance depending on this centroid's type.
   */
  toInstance(skeleton?: Skeleton): Instance | PredictedInstance {
    const skel = skeleton ?? getCentroidSkeleton();
    if (skel.nodes.length > 1) {
      throw new Error(
        `Skeleton must have exactly 1 node for centroid conversion, got ${skel.nodes.length}.`,
      );
    }

    const point = {
      xy: [this.x, this.y] as [number, number],
      visible: true,
      complete: true,
      name: skel.nodeNames[0],
    };

    if (this instanceof PredictedCentroid) {
      return new PredictedInstance({
        points: [{ ...point, score: this.score }],
        skeleton: skel,
        track: this.track,
        score: this.score,
        trackingScore: this.trackingScore ?? undefined,
      });
    }

    return new Instance({
      points: [point],
      skeleton: skel,
      track: this.track,
      trackingScore: this.trackingScore ?? undefined,
    });
  }

  /**
   * Create a centroid from an Instance.
   *
   * @param instance - Source instance.
   * @param options - Options for centroid extraction.
   * @param options.method - "centerOfMass" (default), "bboxCenter", or "anchor".
   * @param options.node - Node name or index for "anchor" method.
   * @returns UserCentroid or PredictedCentroid depending on instance type.
   */
  static fromInstance(
    instance: Instance | PredictedInstance,
    options?: { method?: string; node?: string | number; [key: string]: unknown },
  ): Centroid {
    const method = options?.method ?? "centerOfMass";

    // Gather visible points
    const visiblePoints: [number, number][] = [];
    for (const point of instance.points) {
      if (point.visible && !Number.isNaN(point.xy[0]) && !Number.isNaN(point.xy[1])) {
        visiblePoints.push(point.xy);
      }
    }

    let x: number;
    let y: number;

    if (method === "centerOfMass") {
      if (!visiblePoints.length) {
        throw new Error("No visible points for centerOfMass.");
      }
      x = visiblePoints.reduce((sum, p) => sum + p[0], 0) / visiblePoints.length;
      y = visiblePoints.reduce((sum, p) => sum + p[1], 0) / visiblePoints.length;
    } else if (method === "bboxCenter") {
      if (!visiblePoints.length) {
        throw new Error("No visible points for bboxCenter.");
      }
      const xs = visiblePoints.map((p) => p[0]);
      const ys = visiblePoints.map((p) => p[1]);
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    } else if (method === "anchor") {
      const node = options?.node;
      if (node === undefined || node === null) {
        throw new Error("Must specify 'node' for anchor method.");
      }
      let nodeIdx: number;
      if (typeof node === "string") {
        nodeIdx = instance.skeleton.index(node);
      } else {
        nodeIdx = node;
      }
      const pt = instance.points[nodeIdx];
      if (!pt || Number.isNaN(pt.xy[0])) {
        throw new Error(`Anchor node ${JSON.stringify(node)} is not visible in this instance.`);
      }
      x = pt.xy[0];
      y = pt.xy[1];
    } else {
      throw new Error(
        `Unknown method ${JSON.stringify(method)}. Expected 'centerOfMass', 'bboxCenter', or 'anchor'.`,
      );
    }

    const { method: _, node: __, ...extraOptions } = options ?? {};
    const centroidOptions: CentroidOptions = {
      x,
      y,
      track: instance.track ?? null,
      trackingScore: instance.trackingScore ?? null,
      instance,
      source: method === "anchor" ? `anchor:${options?.node}` : method,
      ...extraOptions,
    };

    // Check if instance is predicted (has score property)
    if ("score" in instance && typeof (instance as PredictedInstance).score === "number") {
      return new PredictedCentroid({
        ...centroidOptions,
        score: (instance as PredictedInstance).score,
      });
    }
    return new UserCentroid(centroidOptions);
  }
}

/** User-annotated or derived centroid (no prediction score). */
export class UserCentroid extends Centroid {}

/** Predicted centroid with a confidence score. */
export class PredictedCentroid extends Centroid {
  score: number;

  constructor(options: CentroidOptions & { score: number }) {
    super(options);
    this.score = options.score;
  }

  get isPredicted(): boolean {
    return true;
  }
}

// Register the centroid factory for Instance.toCentroid()
_registerCentroidFactory((instance, options) =>
  Centroid.fromInstance(instance, options),
);
