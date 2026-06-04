import { VideoBackend, VideoFrame } from "./backend.js";
import type { StreamingH5File } from "../codecs/slp/h5-streaming.js";
import {
  type EmbeddedFrameReader,
  type Hdf5Slice,
  type LegacyFrameCache,
  type SliceReadResult,
  isEncodedFormat,
  readEmbeddedFrameBytes,
} from "./embedded-frame.js";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

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
  }) {
    this.filename = options.filename;
    this.h5file = options.h5file;
    this.datasetPath = options.datasetPath;
    this.dataset = options.datasetPath;
    // Build O(1) lookup map from frame numbers
    const frameNumbers = options.frameNumbers ?? [];
    this.frameNumbers = frameNumbers;
    this.frameNumberToIndex = new Map(frameNumbers.map((num, idx) => [num, idx]));
    this.format = options.format ?? "png";
    this.channelOrder = options.channelOrder ?? "RGB";
    this.frameSizes = options.frameSizes;
    this.shape = options.shape;
    this.fps = options.fps;
    this.legacy = { whole: null, offsets: null };
    this.metaCache = null;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    // Use O(1) Map lookup; if no frame numbers provided, use frameIndex directly
    const index = this.frameNumberToIndex.size > 0
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
      const decoded = await decodeImageBytes(rawBytes, this.format, this.channelOrder);
      return decoded ?? rawBytes;
    }

    const image = decodeRawFrame(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }

  async probeShape(sourceFrameCount?: number): Promise<void> {
    if (this.shape && this.shape[0] > 0) return;
    try {
      // Slice and decode only the first stored frame to recover H/W.
      const rawBytes = await readEmbeddedFrameBytes(this.buildReader(), 0);
      if (!rawBytes || rawBytes.length === 0) return;

      if (isEncodedFormat(this.format)) {
        const decoded = await decodeImageBytes(rawBytes, this.format, this.channelOrder);
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
          this.shape = [fc, decoded.height, decoded.width, 4];
        }
      }
    } catch { /* probe failed, shape stays undefined */ }
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
    };
  }

  close(): void {
    this.legacy.whole = null;
    this.legacy.offsets = null;
    this.metaCache = null;
    // Note: We don't close the h5file here as it may be shared across multiple backends
  }
}

async function decodeImageBytes(
  bytes: Uint8Array,
  format: string,
  channelOrder: string
): Promise<VideoFrame | null> {
  if (!isBrowser || typeof createImageBitmap === "undefined") return null;
  const mime = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);

  // If channel order is BGR, we need to swap R and B channels
  // This happens when images were encoded with OpenCV (which uses BGR order)
  // but the PNG/JPEG bytes were written directly without RGB conversion
  const useBgr = channelOrder.toUpperCase() === "BGR";
  if (!useBgr) {
    return bitmap;
  }

  // Swap R and B channels by drawing to canvas and manipulating pixel data
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return bitmap;

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const data = imageData.data;

  // Swap R and B for each pixel (RGBA format: indices 0=R, 1=G, 2=B, 3=A)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const b = data[i + 2];
    data[i] = b;
    data[i + 2] = r;
  }

  return imageData;
}

function decodeRawFrame(
  bytes: Uint8Array,
  shape: [number, number, number, number] | undefined,
  channelOrder: string
): VideoFrame | null {
  if (!isBrowser || !shape) return null;
  const [, height, width, channels] = shape;
  if (!height || !width || !channels) return null;

  const expectedLength = height * width * channels;
  if (bytes.length < expectedLength) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const useBgr = channelOrder.toUpperCase() === "BGR";

  for (let i = 0; i < width * height; i += 1) {
    const base = i * channels;
    const r = bytes[base + (useBgr ? 2 : 0)] ?? 0;
    const g = bytes[base + 1] ?? 0;
    const b = bytes[base + (useBgr ? 0 : 2)] ?? 0;
    const a = channels === 4 ? bytes[base + 3] ?? 255 : 255;
    const out = i * 4;
    rgba[out] = r;
    rgba[out + 1] = g;
    rgba[out + 2] = b;
    rgba[out + 3] = a;
  }

  return new ImageData(rgba, width, height);
}
