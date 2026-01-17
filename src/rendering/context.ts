// src/rendering/context.ts

import type { Instance, PredictedInstance } from "../model/instance.js";

/**
 * Context passed to pre/post render callbacks.
 */
export class RenderContext {
  constructor(
    /** The 2D canvas rendering context */
    public readonly canvas: CanvasRenderingContext2D,
    /** Current frame index (0 for single images) */
    public readonly frameIdx: number,
    /** Original frame size [width, height] */
    public readonly frameSize: [number, number],
    /** Instances in this frame */
    public readonly instances: (Instance | PredictedInstance)[],
    /** Skeleton edge connectivity as [srcIdx, dstIdx] pairs */
    public readonly skeletonEdges: [number, number][],
    /** Node names from skeleton */
    public readonly nodeNames: string[],
    /** Current scale factor */
    public readonly scale: number = 1.0,
    /** Offset for cropped views [x, y] */
    public readonly offset: [number, number] = [0, 0]
  ) {}

  /**
   * Transform world coordinates to canvas coordinates.
   */
  worldToCanvas(x: number, y: number): [number, number] {
    return [
      (x - this.offset[0]) * this.scale,
      (y - this.offset[1]) * this.scale,
    ];
  }
}

/**
 * Context passed to per-instance callbacks.
 */
export class InstanceContext {
  constructor(
    /** The 2D canvas rendering context */
    public readonly canvas: CanvasRenderingContext2D,
    /** Index of this instance within the frame */
    public readonly instanceIdx: number,
    /** Keypoint coordinates as [[x0, y0], [x1, y1], ...] */
    public readonly points: number[][],
    /** Skeleton edge connectivity */
    public readonly skeletonEdges: [number, number][],
    /** Node names */
    public readonly nodeNames: string[],
    /** Track ID (index in tracks array) */
    public readonly trackIdx: number | null = null,
    /** Track name if available */
    public readonly trackName: string | null = null,
    /** Instance confidence score */
    public readonly confidence: number | null = null,
    /** Current scale factor */
    public readonly scale: number = 1.0,
    /** Offset for cropped views */
    public readonly offset: [number, number] = [0, 0]
  ) {}

  /**
   * Transform world coordinates to canvas coordinates.
   */
  worldToCanvas(x: number, y: number): [number, number] {
    return [
      (x - this.offset[0]) * this.scale,
      (y - this.offset[1]) * this.scale,
    ];
  }

  /**
   * Get centroid of valid (non-NaN) points.
   */
  getCentroid(): [number, number] | null {
    let sumX = 0,
      sumY = 0,
      count = 0;

    for (const pt of this.points) {
      const x = pt[0];
      const y = pt[1];
      if (!isNaN(x) && !isNaN(y)) {
        sumX += x;
        sumY += y;
        count++;
      }
    }

    if (count === 0) return null;
    return [sumX / count, sumY / count];
  }

  /**
   * Get bounding box of valid points.
   * Returns [x1, y1, x2, y2] or null if no valid points.
   */
  getBbox(): [number, number, number, number] | null {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;
    let hasValid = false;

    for (const pt of this.points) {
      const x = pt[0];
      const y = pt[1];
      if (!isNaN(x) && !isNaN(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        hasValid = true;
      }
    }

    if (!hasValid) return null;
    return [minX, minY, maxX, maxY];
  }
}
