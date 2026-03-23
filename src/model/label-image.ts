import type { Video } from "./video.js";
import type { Instance } from "./instance.js";
import { Track } from "./instance.js";
import { SegmentationMask } from "./mask.js";

/** Per-object metadata in a LabelImage. */
export interface LabelImageObjectInfo {
  track: Track | null;
  category: string;
  name: string;
  instance: Instance | null;
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

  /** @internal Deferred instance indices for lazy resolution. Map<label_id, instance_idx> */
  _objectInstanceIdxs: Map<number, number> | null = null;

  constructor(options: {
    data: Int32Array;
    height: number;
    width: number;
    objects?: Map<number, LabelImageObjectInfo>;
    video?: Video | null;
    frameIdx?: number | null;
    source?: string;
  }) {
    this.data = options.data;
    this.height = options.height;
    this.width = options.width;
    this.objects = options.objects ?? new Map();
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.source = options.source ?? "";
  }

  // --- Computed properties ---

  /** Number of objects in the label image metadata. */
  get nObjects(): number {
    return this.objects.size;
  }

  /** Sorted unique non-zero label IDs present in the data. */
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

  /** Get a binary mask for all objects with a given category. Returns zeros if category not found. */
  getCategoryMask(category: string): Uint8Array {
    const matchingIds: number[] = [];
    for (const [lid, info] of this.objects) {
      if (info.category === category) matchingIds.push(lid);
    }
    if (matchingIds.length === 0) {
      return new Uint8Array(this.height * this.width);
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
    for (const lid of this.labelIds) {
      const info = this.objects.get(lid) ?? {
        track: null,
        category: "",
        name: "",
        instance: null,
      };
      yield [info.track, info.category, this.getObjectMask(lid)];
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
  ): LabelImage {
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

    return new LabelImage({
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
  ): LabelImage {
    if (masks.length === 0) {
      throw new Error("Cannot create LabelImage from empty mask list.");
    }

    const height = masks[0].height;
    const width = masks[0].width;
    for (const m of masks.slice(1)) {
      if (m.height !== height || m.width !== width) {
        throw new Error(
          `All masks must have the same shape. Expected (${height}, ${width}), got (${m.height}, ${m.width}).`,
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

    return new LabelImage({
      data,
      height,
      width,
      objects,
      video: options?.video ?? null,
      frameIdx: options?.frameIdx ?? null,
      source: options?.source ?? "",
    });
  }

  // --- Conversion ---

  /** Decompose this LabelImage into individual SegmentationMask objects. */
  toMasks(): SegmentationMask[] {
    const result: SegmentationMask[] = [];
    for (const lid of this.labelIds) {
      const info = this.objects.get(lid) ?? {
        track: null,
        category: "",
        name: "",
        instance: null,
      };
      const binaryMask = new Uint8Array(this.height * this.width);
      for (let i = 0; i < this.data.length; i++) {
        if (this.data[i] === lid) binaryMask[i] = 1;
      }
      result.push(
        SegmentationMask.fromArray(binaryMask, this.height, this.width, {
          track: info.track,
          category: info.category,
          name: info.name,
          instance: info.instance,
          video: this.video,
          frameIdx: this.frameIdx,
          source: this.source,
        }),
      );
    }
    return result;
  }
}
