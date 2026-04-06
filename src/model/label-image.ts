import type { Video } from "./video.js";
import type { Instance } from "./instance.js";
import { Track } from "./instance.js";
import {
  SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
  encodeRle,
  resizeNearest,
} from "./mask.js";

/** Per-object metadata in a LabelImage. */
export interface LabelImageObjectInfo {
  track: Track | null;
  category: string;
  name: string;
  instance: Instance | null;
  score?: number | null;
  /** @internal Deferred instance index for lazy resolution. */
  _instanceIdx?: number;
}

export interface LabelImageOptions {
  data: Int32Array;
  height: number;
  width: number;
  objects?: Map<number, LabelImageObjectInfo>;
  video?: Video | null;
  frameIdx?: number | null;
  source?: string;
  scale?: [number, number];
  offset?: [number, number];
}

/**
 * Dense integer label image for instance segmentation.
 *
 * Each pixel value encodes which object occupies that pixel:
 * 0 = background, positive integers = object IDs.
 *
 * This is the typical output format of tools like Cellpose, StarDist, etc.
 */
export class LabelImage {
  /** Flat (H*W) Int32Array, row-major. 0 = background, positive = object ID. */
  data: Int32Array;
  height: number;
  width: number;
  /** Map from label ID (positive int) to object metadata. */
  objects: Map<number, LabelImageObjectInfo>;
  video: Video | null;
  frameIdx: number | null;
  source: string;
  /** Spatial scale factor: image_coord = li_coord / scale + offset. Default [1, 1]. */
  scale: [number, number];
  /** Spatial offset: image_coord = li_coord / scale + offset. Default [0, 0]. */
  offset: [number, number];

  /** @internal Deferred instance indices for lazy resolution. Map<label_id, instance_idx> */
  _objectInstanceIdxs: Map<number, number> | null = null;

  constructor(options: LabelImageOptions) {
    if (new.target === LabelImage) {
      throw new TypeError(
        "LabelImage is abstract. Use UserLabelImage or PredictedLabelImage.",
      );
    }
    const scale = options.scale ?? [1, 1];
    if (scale[0] <= 0 || scale[1] <= 0) {
      throw new Error(`Scale must be positive, got [${scale[0]}, ${scale[1]}].`);
    }
    this.data = options.data;
    this.height = options.height;
    this.width = options.width;
    this.objects = options.objects ?? new Map();
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.source = options.source ?? "";
    this.scale = scale;
    this.offset = options.offset ?? [0, 0];
  }

  // --- Computed properties ---

  /** Number of objects in the label image metadata. */
  get nObjects(): number {
    return this.objects.size;
  }

  /** Sorted unique non-zero label IDs present in the data.
   *  Note: Scans the full pixel array on every call. Cache the result if needed multiple times. */
  get labelIds(): number[] {
    const ids = new Set<number>();
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] > 0) ids.add(this.data[i]);
    }
    return Array.from(ids).sort((a, b) => a - b);
  }

  /** Non-null tracks from objects, sorted by label ID. */
  get tracks(): Track[] {
    const result: Track[] = [];
    for (const lid of Array.from(this.objects.keys()).sort((a, b) => a - b)) {
      const info = this.objects.get(lid)!;
      if (info.track !== null) result.push(info.track);
    }
    return result;
  }

  /** Unique non-empty category strings across all objects. */
  get categories(): Set<string> {
    const cats = new Set<string>();
    for (const info of this.objects.values()) {
      if (info.category !== "") cats.add(info.category);
    }
    return cats;
  }

  /** Whether this label image has no temporal association (frameIdx is null). */
  get isStatic(): boolean {
    return this.frameIdx === null;
  }

  /** Whether this is a predicted label image (has a score). */
  get isPredicted(): boolean {
    return false;
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

  /** The image-space extent of this label image (accounting for scale). */
  get imageExtent(): { height: number; width: number } {
    return {
      height: Math.floor(this.height / this.scale[1]),
      width: Math.floor(this.width / this.scale[0]),
    };
  }

  /**
   * Create a resampled copy of this label image at the target dimensions.
   * The returned label image has scale=[1,1] and offset=[0,0].
   */
  resampled(targetHeight: number, targetWidth: number): LabelImage {
    const resizedData = resizeNearest(this.data, this.height, this.width, targetHeight, targetWidth);
    const baseOpts: LabelImageOptions = {
      data: resizedData,
      height: targetHeight,
      width: targetWidth,
      objects: new Map(this.objects),
      video: this.video,
      frameIdx: this.frameIdx,
      source: this.source,
      scale: [1, 1],
      offset: [0, 0],
    };

    if (this instanceof PredictedLabelImage) {
      const pli = this as PredictedLabelImage;
      let resampledScoreMap: Float32Array | null = null;
      if (pli.scoreMap) {
        resampledScoreMap = resizeNearest(
          pli.scoreMap,
          this.height,
          this.width,
          targetHeight,
          targetWidth,
        );
      }
      return new PredictedLabelImage({
        ...baseOpts,
        score: pli.score,
        scoreMap: resampledScoreMap,
      });
    }

    return new UserLabelImage(baseOpts);
  }

  // --- Mask extraction ---

  /** Get a binary mask (Uint8Array) for a specific label ID. */
  getObjectMask(labelId: number): Uint8Array {
    const mask = new Uint8Array(this.height * this.width);
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] === labelId) mask[i] = 1;
    }
    return mask;
  }

  /** Get a binary mask for all objects associated with a given track. */
  getTrackMask(track: Track): Uint8Array {
    const matchingIds: number[] = [];
    for (const [lid, info] of this.objects) {
      if (info.track === track) matchingIds.push(lid);
    }
    if (matchingIds.length === 0) {
      throw new Error(`Track "${track.name}" not found in this LabelImage.`);
    }
    const idSet = new Set(matchingIds);
    const mask = new Uint8Array(this.height * this.width);
    for (let i = 0; i < this.data.length; i++) {
      if (idSet.has(this.data[i])) mask[i] = 1;
    }
    return mask;
  }

  /** Get a binary mask for all objects with a given category. Throws if category not found. */
  getCategoryMask(category: string): Uint8Array {
    const matchingIds: number[] = [];
    for (const [lid, info] of this.objects) {
      if (info.category === category) matchingIds.push(lid);
    }
    if (matchingIds.length === 0) {
      throw new Error(`Category "${category}" not found in this LabelImage.`);
    }
    const idSet = new Set(matchingIds);
    const mask = new Uint8Array(this.height * this.width);
    for (let i = 0; i < this.data.length; i++) {
      if (idSet.has(this.data[i])) mask[i] = 1;
    }
    return mask;
  }

  // --- Iterator ---

  /** Iterate over objects as [track, category, binaryMask] tuples in sorted label ID order. */
  *items(): IterableIterator<[Track | null, string, Uint8Array]> {
    const ids = this.labelIds;
    const maskMap = new Map<number, Uint8Array>();
    for (const lid of ids) {
      maskMap.set(lid, new Uint8Array(this.height * this.width));
    }
    for (let i = 0; i < this.data.length; i++) {
      const mask = maskMap.get(this.data[i]);
      if (mask) mask[i] = 1;
    }
    for (const lid of ids) {
      const info = this.objects.get(lid) ?? {
        track: null,
        category: "",
        name: "",
        instance: null,
      };
      yield [info.track, info.category, maskMap.get(lid)!];
    }
  }

  // --- Factories ---

  /**
   * Create a LabelImage from a flat Int32Array or 2D number array.
   *
   * Tracks are auto-created when not provided. When provided as an array,
   * they are assigned positionally starting at label ID 1.
   */
  static fromArray(
    data: Int32Array | number[][],
    height: number,
    width: number,
    options?: {
      tracks?: Track[] | Map<number, Track>;
      categories?: string[] | Map<number, string>;
      video?: Video | null;
      frameIdx?: number | null;
      source?: string;
    },
  ): UserLabelImage {
    // Convert 2D array to flat Int32Array if needed
    let flat: Int32Array;
    if (data instanceof Int32Array) {
      flat = data;
    } else {
      flat = new Int32Array(height * width);
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          flat[r * width + c] = data[r][c];
        }
      }
    }

    // Find unique non-zero IDs
    const uniqueIds = new Set<number>();
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] > 0) uniqueIds.add(flat[i]);
    }
    const sortedIds = Array.from(uniqueIds).sort((a, b) => a - b);

    // Build track mapping
    const trackMap = new Map<number, Track>();
    const tracks = options?.tracks;
    if (tracks === undefined) {
      // Auto-create tracks
      for (const lid of sortedIds) {
        trackMap.set(lid, new Track(String(lid)));
      }
    } else if (Array.isArray(tracks)) {
      for (let i = 0; i < tracks.length; i++) {
        trackMap.set(i + 1, tracks[i]);
      }
    } else {
      for (const [k, v] of tracks) {
        trackMap.set(k, v);
      }
    }

    // Build category mapping
    const catMap = new Map<number, string>();
    const cats = options?.categories;
    if (cats !== undefined) {
      if (Array.isArray(cats)) {
        for (let i = 0; i < cats.length; i++) {
          catMap.set(i + 1, cats[i]);
        }
      } else {
        for (const [k, v] of cats) {
          catMap.set(k, v);
        }
      }
    }

    // Build objects dict
    const allIds = new Set([...sortedIds, ...trackMap.keys(), ...catMap.keys()]);
    const objects = new Map<number, LabelImageObjectInfo>();
    for (const lid of Array.from(allIds).sort((a, b) => a - b)) {
      objects.set(lid, {
        track: trackMap.get(lid) ?? null,
        category: catMap.get(lid) ?? "",
        name: "",
        instance: null,
      });
    }

    return new UserLabelImage({
      data: flat,
      height,
      width,
      objects,
      video: options?.video ?? null,
      frameIdx: options?.frameIdx ?? null,
      source: options?.source ?? "",
    });
  }

  /** Create a LabelImage by compositing an array of SegmentationMasks. */
  static fromMasks(
    masks: SegmentationMask[],
    options?: {
      video?: Video | null;
      frameIdx?: number | null;
      source?: string;
    },
  ): UserLabelImage {
    if (masks.length === 0) {
      throw new Error("Cannot create LabelImage from empty mask list.");
    }

    const height = masks[0].height;
    const width = masks[0].width;
    const scale: [number, number] = [...masks[0].scale];
    const offset: [number, number] = [...masks[0].offset];
    for (const m of masks.slice(1)) {
      if (m.height !== height || m.width !== width) {
        throw new Error(
          `All masks must have the same shape. Expected (${height}, ${width}), got (${m.height}, ${m.width}).`,
        );
      }
      if (m.scale[0] !== scale[0] || m.scale[1] !== scale[1]) {
        throw new Error(
          `All masks must have the same scale. Expected [${scale[0]}, ${scale[1]}], got [${m.scale[0]}, ${m.scale[1]}].`,
        );
      }
      if (m.offset[0] !== offset[0] || m.offset[1] !== offset[1]) {
        throw new Error(
          `All masks must have the same offset. Expected [${offset[0]}, ${offset[1]}], got [${m.offset[0]}, ${m.offset[1]}].`,
        );
      }
    }

    const data = new Int32Array(height * width);
    const objects = new Map<number, LabelImageObjectInfo>();

    for (let i = 0; i < masks.length; i++) {
      const labelId = i + 1;
      const maskData = masks[i].data;
      for (let j = 0; j < maskData.length; j++) {
        if (maskData[j]) data[j] = labelId;
      }
      objects.set(labelId, {
        track: masks[i].track,
        category: masks[i].category,
        name: masks[i].name,
        instance: masks[i].instance,
      });
    }

    return new UserLabelImage({
      data,
      height,
      width,
      objects,
      video: options?.video ?? null,
      frameIdx: options?.frameIdx ?? null,
      source: options?.source ?? "",
      scale,
      offset,
    });
  }

  /**
   * Create a list of LabelImages from a stack of 2D arrays (one per frame).
   *
   * Shared Track objects are created once and reused across frames.
   *
   * @param options.data - Array of flat Int32Arrays or 2D number arrays, one per frame.
   * @param options.tracks - Track objects to assign. Array (1-indexed) or Map<labelId, Track>.
   * @param options.categories - Category strings. Array (1-indexed) or Map<labelId, string>.
   * @param options.createTracks - If true and tracks is not provided, auto-create one Track
   *   per unique non-zero label ID found across ALL frames.
   * @param options.frameIdx - Custom frame indices. Defaults to [0, 1, ..., T-1].
   * @param options.video - Video reference shared across all frames.
   * @param options.source - Source string shared across all frames.
   */
  static fromStack(options: {
    data: number[][][];
    tracks?: Map<number, Track> | Track[] | null;
    categories?: Map<number, string> | string[] | null;
    createTracks?: boolean;
    frameIdx?: number[] | null;
    video?: Video | null;
    source?: string;
  }): UserLabelImage[] {
    const { data, video, source } = options;
    if (data.length === 0) return [];

    // Determine height/width from first frame
    const first = data[0];
    const height = first.length;
    const width = first[0]?.length ?? 0;

    // Collect all unique label IDs across all frames
    const allIds = new Set<number>();
    for (const frame of data) {
      if (Array.isArray(frame)) {
        for (const row of frame) {
          for (const val of row) {
            if (val > 0) allIds.add(val);
          }
        }
      }
    }
    const sortedIds = Array.from(allIds).sort((a, b) => a - b);

    // Build shared track map
    let trackMap: Map<number, Track> | undefined;
    if (options.tracks != null) {
      trackMap = new Map<number, Track>();
      if (Array.isArray(options.tracks)) {
        for (let i = 0; i < options.tracks.length; i++) {
          trackMap.set(i + 1, options.tracks[i]);
        }
      } else {
        for (const [k, v] of options.tracks) {
          trackMap.set(k, v);
        }
      }
    } else if (options.createTracks) {
      trackMap = new Map<number, Track>();
      for (const lid of sortedIds) {
        trackMap.set(lid, new Track(String(lid)));
      }
    }

    // Build shared category map
    let catMap: Map<number, string> | undefined;
    if (options.categories != null) {
      catMap = new Map<number, string>();
      if (Array.isArray(options.categories)) {
        for (let i = 0; i < options.categories.length; i++) {
          catMap.set(i + 1, options.categories[i]);
        }
      } else {
        for (const [k, v] of options.categories) {
          catMap.set(k, v);
        }
      }
    }

    const result: UserLabelImage[] = [];
    for (let t = 0; t < data.length; t++) {
      const frameData = data[t];
      const frameIdx = options.frameIdx ? options.frameIdx[t] : t;

      result.push(
        LabelImage.fromArray(frameData as number[][], height, width, {
          tracks: trackMap,
          categories: catMap,
          video,
          frameIdx,
          source,
        }),
      );
    }
    return result;
  }

  // --- Conversion ---

  /** Decompose this LabelImage into individual SegmentationMask objects. */
  toMasks(): SegmentationMask[] {
    const ids = this.labelIds;
    const maskMap = new Map<number, Uint8Array>();
    for (const lid of ids) {
      maskMap.set(lid, new Uint8Array(this.height * this.width));
    }
    for (let i = 0; i < this.data.length; i++) {
      const mask = maskMap.get(this.data[i]);
      if (mask) mask[i] = 1;
    }
    const result: SegmentationMask[] = [];
    for (const lid of ids) {
      const info = this.objects.get(lid) ?? {
        track: null,
        category: "",
        name: "",
        instance: null,
      };
      const rleCounts = encodeRle(maskMap.get(lid)!, this.height, this.width);
      const baseOpts = {
        rleCounts,
        height: this.height,
        width: this.width,
        track: info.track,
        category: info.category,
        name: info.name,
        instance: info.instance,
        video: this.video,
        frameIdx: this.frameIdx,
        source: this.source,
        scale: [...this.scale] as [number, number],
        offset: [...this.offset] as [number, number],
      };
      if (this instanceof PredictedLabelImage) {
        const pli = this as PredictedLabelImage;
        result.push(new PredictedSegmentationMask({
          ...baseOpts,
          score: info.score ?? pli.score,
        }));
      } else {
        result.push(new UserSegmentationMask(baseOpts));
      }
    }
    return result;
  }
}

/** User-annotated label image (no prediction score). */
export class UserLabelImage extends LabelImage {}

/** Predicted label image with a confidence score and optional score map. */
export class PredictedLabelImage extends LabelImage {
  score: number;
  scoreMap: Float32Array | null;
  /** Spatial scale for the score map. Default [1, 1]. */
  scoreMapScale: [number, number];
  /** Spatial offset for the score map. Default [0, 0]. */
  scoreMapOffset: [number, number];

  constructor(
    options: LabelImageOptions & {
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
