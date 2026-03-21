import type { Video } from "./video.js";
import type { Track, Instance } from "./instance.js";
import { ROI, _registerMaskFactory } from "./roi.js";
import type { Geometry } from "./roi.js";

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
  instance: Instance | null;

  constructor(options: {
    rleCounts: Uint32Array;
    height: number;
    width: number;
    name?: string;
    category?: string;
    source?: string;
    video?: Video | null;
    frameIdx?: number | null;
    track?: Track | null;
    instance?: Instance | null;
  }) {
    this.rleCounts = options.rleCounts;
    this.height = options.height;
    this.width = options.width;
    this.name = options.name ?? "";
    this.category = options.category ?? "";
    this.source = options.source ?? "";
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.track = options.track ?? null;
    this.instance = options.instance ?? null;
  }

  static fromArray(
    mask: Uint8Array | boolean[][],
    height: number,
    width: number,
    options?: Omit<ConstructorParameters<typeof SegmentationMask>[0], "rleCounts" | "height" | "width">,
  ): SegmentationMask {
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
    return new SegmentationMask({
      rleCounts,
      height,
      width,
      ...options,
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

    return {
      x: minC,
      y: minR,
      width: maxC - minC + 1,
      height: maxR - minR + 1,
    };
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

    return new ROI({
      geometry,
      name: this.name,
      category: this.category,
      source: this.source,
      video: this.video,
      frameIdx: this.frameIdx,
      track: this.track,
      instance: this.instance,
    });
  }
}

// Register mask factory for ROI.toMask() to use
_registerMaskFactory(
  (mask: Uint8Array, height: number, width: number, options: Record<string, unknown>) => {
    return SegmentationMask.fromArray(mask, height, width, options as Omit<
      ConstructorParameters<typeof SegmentationMask>[0],
      "rleCounts" | "height" | "width"
    >);
  },
);
