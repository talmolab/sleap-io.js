import type { VideoBackend, VideoFrame } from "./backend.js";
import { getH5EmscriptenModule } from "../codecs/slp/h5.js";
import {
  type EmbeddedFrameReader,
  type H5wasmModule,
  type Hdf5Slice,
  type LegacyFrameCache,
  type SliceReadResult,
  isEncodedFormat,
  readEmbeddedFrameBytes,
  readVlenElementManual,
} from "./embedded-frame.js";
import { decodeEmbeddedImage, decodeEmbeddedRaw } from "./image-decode.js";

/**
 * Video backend for embedded images in HDF5 files (synchronous h5wasm).
 *
 * Reads a single frame at a time via hyperslab slicing rather than loading and
 * caching the entire per-video dataset. Supports 2D padded, 1D concatenated
 * (with `frame_sizes`), and variable-length (vlen) blob layouts. See issue #135
 * and {@link readEmbeddedFrameBytes} for details.
 */
export class Hdf5VideoBackend implements VideoBackend {
  filename: string;
  dataset?: string | null;
  shape?: [number, number, number, number];
  fps?: number;
  /** Source frame numbers with a stored image (storage order). */
  frameNumbers: number[];
  private file: any;
  private datasetPath: string;
  private frameNumberToIndex: Map<number, number>;
  private format: string;
  private channelOrder: string;
  private frameSizes: number[] | undefined;
  private legacy: LegacyFrameCache;

  constructor(options: {
    filename: string;
    file: any;
    datasetPath: string;
    frameNumbers?: number[];
    frameSizes?: number[];
    format?: string;
    channelOrder?: string;
    shape?: [number, number, number, number];
    fps?: number;
  }) {
    this.filename = options.filename;
    this.file = options.file;
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
    this.shape = options.shape;
    this.fps = options.fps;
    this.frameSizes = options.frameSizes;
    this.legacy = { whole: null, offsets: null };
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    const dataset = this.file.get(this.datasetPath);
    if (!dataset) return null;
    // Use O(1) Map lookup; if no frame numbers provided, use frameIndex directly
    const index =
      this.frameNumberToIndex.size > 0
        ? this.frameNumberToIndex.get(frameIndex)
        : frameIndex;
    if (index === undefined) return null;

    const rawBytes = await readEmbeddedFrameBytes(
      this.buildReader(dataset),
      index,
    );
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

  /** Raw stored blob for source `frameNumber`, without decoding. */
  async getFrameBuffer(frameNumber: number): Promise<Uint8Array | null> {
    const dataset = this.file.get(this.datasetPath);
    if (!dataset) return null;
    const index =
      this.frameNumberToIndex.size > 0
        ? this.frameNumberToIndex.get(frameNumber)
        : frameNumber;
    if (index === undefined) return null;
    const bytes = await readEmbeddedFrameBytes(
      this.buildReader(dataset),
      index,
    );
    return bytes && bytes.length > 0 ? bytes : null;
  }

  /**
   * Crop pushdown hook (Item 1 of JS issue #153). Always returns `null`: this
   * embedded backend stores opaque encoded blobs (PNG/JPEG) or per-frame-indexed
   * raw rows, neither of which can be spatially hyperslabbed without first
   * decoding the whole frame. Pushdown is structurally impossible here, so the
   * crop wrapper falls back to full-decode + `cropFrame`. (A raw rank-4 chunked
   * HDF5 pixel-array backend, which COULD push down, does not exist in the JS
   * port yet; see backend.ts `readCrop` doc.) Short-circuits before touching the
   * dataset.
   */
  async readCrop(): Promise<null> {
    return null;
  }

  /** Build a single-frame reader bound to an open h5wasm dataset object. */
  private buildReader(dataset: any): EmbeddedFrameReader {
    return {
      frameCount: this.frameNumberToIndex.size,
      format: this.format,
      frameSizes: this.frameSizes,
      legacy: this.legacy,
      getMeta: async () => ({
        shape: dataset.shape ?? [],
        dtype: dataset.dtype,
      }),
      readSlice: async (slice?: Hdf5Slice): Promise<SliceReadResult> => {
        const value = slice ? dataset.slice(slice) : dataset.value;
        return { value, shape: dataset.shape ?? [] };
      },
      readVlenElement: async (index: number): Promise<Uint8Array | null> => {
        const Module = (await getH5EmscriptenModule()) as H5wasmModule | null;
        return readVlenElementManual(Module, dataset, index);
      },
    };
  }

  close(): void {
    this.legacy.whole = null;
    this.legacy.offsets = null;
  }
}
