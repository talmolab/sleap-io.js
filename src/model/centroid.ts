import type { Track } from "./instance.js";
import {
  Instance,
  PredictedInstance,
  _registerCentroidFactory,
} from "./instance.js";
import { Skeleton } from "./skeleton.js";
import type { Identity } from "./identity.js";
import type { Embedding } from "./embedding.js";

/**
 * Normalize a centroid `source`/`method` string to its canonical snake_case
 * form for Python/PyQt on-disk interop.
 *
 * The SLP on-disk format is snake_case (Python-compatible). Historically the JS
 * side used camelCase method names (`"centerOfMass"`, `"bboxCenter"`) both for
 * the `fromInstance` `method` param and — via that param — for the persisted
 * `source` value, which mismatched Python `sleap-io`. This maps the legacy
 * camelCase names to Python's snake_case:
 * - `"centerOfMass"` -> `"center_of_mass"`
 * - `"bboxCenter"`   -> `"bbox_center"`
 *
 * All other values pass through unchanged: already-snake_case names
 * (`"center_of_mass"`, `"bbox_center"`), `"anchor"` / `"anchor:<node>"`, and
 * arbitrary sources (e.g. `"trackmate"`). Used by both `Centroid.fromInstance`
 * (to normalize the `method` param) and the SLP reader (to normalize legacy
 * camelCase `source` values on load).
 */
export function normalizeCentroidSource(source: string): string {
  switch (source) {
    case "centerOfMass":
      return "center_of_mass";
    case "bboxCenter":
      return "bbox_center";
    default:
      return source;
  }
}

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
export const CENTROID_SKELETON: Skeleton = /* @__PURE__ */ (() =>
  getCentroidSkeleton())();

/** Options for constructing a Centroid. */
export interface CentroidOptions {
  x: number;
  y: number;
  z?: number | null;
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
 * Supports optional 3D coordinates, track/instance metadata,
 * and interconversion with single-node Instance objects.
 *
 * Spatial-temporal context (video, frame index) is derived from the parent
 * LabeledFrame, matching how Instance/PredictedInstance work.
 *
 * This class is abstract. Use UserCentroid or PredictedCentroid.
 */
export class Centroid {
  x: number;
  y: number;
  z: number | null;
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
   * @param options.method - Computation method. Accepts both the legacy JS
   *   camelCase names (`"centerOfMass"` (default), `"bboxCenter"`, `"anchor"`)
   *   and Python's snake_case names (`"center_of_mass"`, `"bbox_center"`). The
   *   persisted `source` is always the canonical snake_case value
   *   (`"center_of_mass"`, `"bbox_center"`, or `"anchor:<node>"`) to match
   *   Python `sleap-io` on disk.
   * @param options.node - Node name or index for "anchor" method.
   * @returns UserCentroid or PredictedCentroid depending on instance type.
   */
  static fromInstance(
    instance: Instance | PredictedInstance,
    options?: {
      method?: string;
      node?: string | number;
      [key: string]: unknown;
    },
  ): Centroid {
    // Normalize the method to its canonical snake_case form, accepting legacy
    // camelCase inputs. The normalized value doubles as the persisted `source`.
    const method = normalizeCentroidSource(options?.method ?? "centerOfMass");

    // Gather visible points
    const visiblePoints: [number, number][] = [];
    for (const point of instance.points) {
      if (
        point.visible &&
        !Number.isNaN(point.xy[0]) &&
        !Number.isNaN(point.xy[1])
      ) {
        visiblePoints.push(point.xy);
      }
    }

    let x: number;
    let y: number;

    if (method === "center_of_mass") {
      if (!visiblePoints.length) {
        throw new Error("No visible points for center_of_mass.");
      }
      x =
        visiblePoints.reduce((sum, p) => sum + p[0], 0) / visiblePoints.length;
      y =
        visiblePoints.reduce((sum, p) => sum + p[1], 0) / visiblePoints.length;
    } else if (method === "bbox_center") {
      if (!visiblePoints.length) {
        throw new Error("No visible points for bbox_center.");
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
        throw new Error(
          `Anchor node ${JSON.stringify(node)} is not visible in this instance.`,
        );
      }
      x = pt.xy[0];
      y = pt.xy[1];
    } else {
      throw new Error(
        `Unknown method ${JSON.stringify(method)}. Expected 'center_of_mass', 'bbox_center', or 'anchor' (camelCase 'centerOfMass'/'bboxCenter' also accepted).`,
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
    if (
      "score" in instance &&
      typeof (instance as PredictedInstance).score === "number"
    ) {
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
