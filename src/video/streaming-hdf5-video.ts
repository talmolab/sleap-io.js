import type { VideoBackend, VideoFrame } from "./backend.js";
import type { StreamingH5File } from "../codecs/slp/h5-streaming.js";
import {
  type EmbeddedFrameReader,
  type Hdf5Slice,
  type LegacyFrameCache,
  type SliceReadResult,
  asUint8Array,
  isEncodedFormat,
  readEmbeddedFrameBytes,
} from "./embedded-frame.js";
import { decodeEmbeddedImage, decodeEmbeddedRaw } from "./image-decode.js";

/**
 * Video backend for embedded images in HDF5 files accessed via streaming.
 *
 * This backend uses StreamingH5File (Web Worker + range requests) instead of
 * a synchronous h5wasm File object, making it suitable for browser environments
 * where the SLP file is loaded via HTTP range requests.
 *
 * Reads one frame at a time via hyperslab slicing (issue #135) rather than
 * loading and caching the entire per-video dataset. Supports 2D padded, 1D
 * concatenated (with `frame_sizes`), and variable-length (vlen) blob layouts;
 * see {@link readEmbeddedFrameBytes}.
 */
export class StreamingHdf5VideoBackend implements VideoBackend {
  filename: string;
  dataset?: string | null;
  shape?: [number, number, number, number];
  fps?: number;
  /** Source frame numbers with a stored image (storage order). */
  frameNumbers: number[];
  private h5file: StreamingH5File;
  private datasetPath: string;
  private frameNumberToIndex: Map<number, number>;
  private format: string;
  private channelOrder: string;
  private frameSizes: number[] | undefined;
  private legacy: LegacyFrameCache;
  private metaCache: { shape: number[]; dtype: string } | null;
  /**
   * Deferred (lazyVideoMetadata) backend: constructed WITHOUT per-video HDF5
   * reads. The first getFrame() reads frame_numbers/frame_sizes/attrs on demand
   * (ensureLoaded) so a many-video pkg.slp opens fast and pays the per-video
   * cost only for videos actually viewed.
   */
  private deferred: boolean;
  private loaded: boolean;
  private loadPromise: Promise<void> | null;

  constructor(options: {
    filename: string;
    h5file: StreamingH5File;
    datasetPath: string;
    frameNumbers?: number[];
    frameSizes?: number[];
    format?: string;
    channelOrder?: string;
    shape?: [number, number, number, number];
    fps?: number;
    /** Build without per-video reads; ensureLoaded() fetches them on first use. */
    deferred?: boolean;
  }) {
    this.filename = options.filename;
    this.h5file = options.h5file;
    this.datasetPath = options.datasetPath;
    this.dataset = options.datasetPath;
    // Build O(1) lookup map from frame numbers
    const frameNumbers = options.frameNumbers ?? [];
    this.frameNumbers = frameNumbers;
    this.frameNumberToIndex = new Map(
      frameNumbers.map((num, idx) => [num, idx]),
    );
    this.format = options.format ?? "png";
    this.channelOrder = options.channelOrder ?? "RGB";
    this.frameSizes = options.frameSizes;
    this.shape = options.shape;
    this.fps = options.fps;
    this.legacy = { whole: null, offsets: null };
    this.metaCache = null;
    this.deferred = options.deferred ?? false;
    // Non-deferred backends already have everything; deferred ones load lazily.
    this.loaded = !this.deferred;
    this.loadPromise = null;
  }

  /** Whether a deferred backend has fetched its per-video metadata yet. */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Read the per-video HDF5 metadata skipped at load (lazyVideoMetadata):
   * frame_numbers (source→storage map + true source frame count), frame_sizes
   * (1D concatenated layout), and format/channel_order/dimensions from the
   * dataset attrs. Idempotent — the first getFrame() triggers it. Afterwards
   * `shape[0]` reflects the real source frame count, so the seekbar spans the
   * whole video (not just the embedded/labeled frames). No-op when not deferred.
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const groupPath = this.datasetPath.endsWith("/video")
        ? this.datasetPath.slice(0, -6)
        : this.datasetPath;
      try {
        const keys = await this.h5file.getKeys(groupPath);
        if (keys.includes("frame_numbers")) {
          const fn = await this.h5file.getDatasetValue(
            `${groupPath}/frame_numbers`,
          );
          const nums = toNumberArray(fn.value);
          this.frameNumbers = nums;
          this.frameNumberToIndex = new Map(nums.map((num, idx) => [num, idx]));
        }
        if (keys.includes("frame_sizes")) {
          const fs = await this.h5file.getDatasetValue(
            `${groupPath}/frame_sizes`,
          );
          this.frameSizes = toNumberArray(fs.value);
        }
      } catch {
        /* leave frame maps empty; getFrame falls back to a direct index */
      }
      try {
        const attrs = await this.h5file.getAttrs(this.datasetPath);
        const fmt = attrToStr(attrs.format);
        if (fmt) this.format = fmt;
        const co = attrToStr(attrs.channel_order);
        if (co) this.channelOrder = co;
        // True source frame count = max(`frames` attr, max(frame_numbers)+1).
        // The `frames` attr can badly under-report (bogus small values seen in
        // the wild: 18/109/424 while frame_numbers span 47k–175k), so never let
        // it shrink the axis below the highest stored source index. Mirrors the
        // eager reader's resolveSourceFrameCount.
        let count = attrToNum(attrs.frames) ?? 0;
        if (this.frameNumberToIndex.size > 0) {
          let maxNum = 0;
          for (const k of this.frameNumberToIndex.keys())
            if (k > maxNum) maxNum = k;
          count = Math.max(count, maxNum + 1);
        }
        const h = attrToNum(attrs.height) ?? this.shape?.[1] ?? 0;
        const w = attrToNum(attrs.width) ?? this.shape?.[2] ?? 0;
        const c = attrToNum(attrs.channels) ?? this.shape?.[3] ?? 0;
        if (count > 0 && h > 0 && w > 0) {
          this.shape = [count, h, w, c];
        }
      } catch {
        /* keep the JSON-seeded shape */
      }
      this.loaded = true;
    })();
    return this.loadPromise;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    if (!this.loaded) await this.ensureLoaded();
    // Use O(1) Map lookup; if no frame numbers provided, use frameIndex directly
    const index =
      this.frameNumberToIndex.size > 0
        ? this.frameNumberToIndex.get(frameIndex)
        : frameIndex;
    if (index === undefined) return null;

    let rawBytes: Uint8Array | null;
    try {
      rawBytes = await readEmbeddedFrameBytes(this.buildReader(), index);
    } catch {
      return null;
    }
    if (!rawBytes || rawBytes.length === 0) return null;

    if (isEncodedFormat(this.format)) {
      const decoded = await decodeEmbeddedImage(
        rawBytes,
        this.format,
        this.channelOrder,
      );
      return decoded ?? rawBytes;
    }

    const image = decodeEmbeddedRaw(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }

  get embeddedFormat(): string {
    return this.format;
  }
  get embeddedChannelOrder(): string {
    return this.channelOrder;
  }

  async getFrameBuffer(frameNumber: number): Promise<Uint8Array | null> {
    if (!this.loaded) await this.ensureLoaded();
    const index =
      this.frameNumberToIndex.size > 0
        ? this.frameNumberToIndex.get(frameNumber)
        : frameNumber;
    if (index === undefined) return null;
    try {
      const bytes = await readEmbeddedFrameBytes(this.buildReader(), index);
      return bytes && bytes.length > 0 ? bytes : null;
    } catch {
      return null;
    }
  }

  async probeShape(sourceFrameCount?: number): Promise<void> {
    if (this.shape && this.shape[0] > 0) return;
    try {
      // Slice and decode only the first stored frame to recover H/W.
      const rawBytes = await readEmbeddedFrameBytes(this.buildReader(), 0);
      if (!rawBytes || rawBytes.length === 0) return;

      if (isEncodedFormat(this.format)) {
        const decoded = await decodeEmbeddedImage(
          rawBytes,
          this.format,
          this.channelOrder,
        );
        if (decoded && "width" in decoded && "height" in decoded) {
          // Use source frame count if available, otherwise infer from max frame number
          let fc = sourceFrameCount ?? 0;
          if (!fc && this.frameNumberToIndex.size > 0) {
            let maxIdx = 0;
            for (const key of this.frameNumberToIndex.keys()) {
              if (key > maxIdx) maxIdx = key;
            }
            fc = maxIdx + 1;
          }
          // Prefer the real channel count (from the dataset attrs, carried on
          // the seed shape) over the decoded bitmap's channels, which is always
          // 4 (RGBA) regardless of the stored grayscale/RGB image.
          const channels = this.shape?.[3] ?? 4;
          this.shape = [fc, decoded.height, decoded.width, channels];
        }
      }
    } catch {
      /* probe failed, shape stays undefined */
    }
  }

  /**
   * Crop pushdown hook (Item 1 of JS issue #153). Always returns `null`: this
   * streaming embedded backend stores opaque encoded blobs (PNG/JPEG) or
   * per-frame-indexed raw rows, neither of which can be spatially hyperslabbed
   * without first decoding the whole frame. Pushdown is structurally impossible
   * here, so the crop wrapper falls back to full-decode + `cropFrame`. (A raw
   * rank-4 chunked HDF5 pixel-array backend, which COULD push down over the
   * worker's `dataset.slice`, does not exist in the JS port yet; see backend.ts
   * `readCrop` doc.) Short-circuits before any network read.
   */
  async readCrop(): Promise<null> {
    return null;
  }

  /** Build a single-frame reader bound to the streaming worker file. */
  private buildReader(): EmbeddedFrameReader {
    return {
      frameCount: this.frameNumberToIndex.size,
      format: this.format,
      frameSizes: this.frameSizes,
      legacy: this.legacy,
      getMeta: async () => {
        if (!this.metaCache) {
          this.metaCache = await this.h5file.getDatasetMeta(this.datasetPath);
        }
        return this.metaCache;
      },
      readSlice: async (slice?: Hdf5Slice): Promise<SliceReadResult> => {
        const data = await this.h5file.getDatasetValue(this.datasetPath, slice);
        return { value: data.value, shape: data.shape };
      },
      readVlenElement: async (index: number): Promise<Uint8Array | null> => {
        // The worker reads the single vlen element manually (the safe path) and
        // returns one Uint8Array. If it cannot (e.g. unexpected hvl_t size) it
        // returns the whole array of blobs instead; index into it.
        const data = await this.h5file.getDatasetValue(this.datasetPath, [
          [index, index + 1],
        ]);
        const value = data.value;
        if (value instanceof Uint8Array) return value;
        if (Array.isArray(value)) return asUint8Array(value[index]);
        return asUint8Array(value);
      },
    };
  }

  close(): void {
    this.legacy.whole = null;
    this.legacy.offsets = null;
    this.metaCache = null;
    // Note: We don't close the h5file here as it may be shared across multiple backends
  }
}

/** Coerce an HDF5 dataset value (array or typed-array) into number[]. */
function toNumberArray(values: unknown): number[] {
  if (Array.isArray(values)) return values.map((v) => Number(v));
  if (ArrayBuffer.isView(values))
    return Array.from(values as unknown as ArrayLike<number>).map(Number);
  return [];
}

/** Unwrap an h5wasm attribute ({value} or plain) to a non-empty string. */
function attrToStr(attr: unknown): string | undefined {
  if (attr == null) return undefined;
  const v =
    typeof attr === "object" && attr !== null && "value" in attr
      ? (attr as { value: unknown }).value
      : attr;
  if (v == null) return undefined;
  const s = String(Array.isArray(v) ? v[0] : v);
  return s.length > 0 ? s : undefined;
}

/** Unwrap an h5wasm attribute to a positive finite number, else undefined. */
function attrToNum(attr: unknown): number | undefined {
  if (attr == null) return undefined;
  const v =
    typeof attr === "object" && attr !== null && "value" in attr
      ? (attr as { value: unknown }).value
      : attr;
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
