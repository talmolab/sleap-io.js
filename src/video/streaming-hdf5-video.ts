import { VideoBackend, VideoFrame } from "./backend.js";
import type { StreamingH5File } from "../codecs/slp/h5-streaming.js";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

// PNG magic bytes: 0x89 P N G \r \n 0x1A \n
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// JPEG magic bytes: 0xFF 0xD8 0xFF
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);

/**
 * Video backend for embedded images in HDF5 files accessed via streaming.
 *
 * This backend uses StreamingH5File (Web Worker + range requests) instead of
 * a synchronous h5wasm File object, making it suitable for browser environments
 * where the SLP file is loaded via HTTP range requests.
 *
 * Supports two data storage formats:
 * 1. vlen-encoded: Array of individual frame blobs (each index = one frame)
 * 2. Contiguous buffer: Single buffer with all frames concatenated
 */
export class StreamingHdf5VideoBackend implements VideoBackend {
  filename: string;
  dataset?: string | null;
  shape?: [number, number, number, number];
  fps?: number;
  private h5file: StreamingH5File;
  private datasetPath: string;
  private frameNumberToIndex: Map<number, number>;
  private format: string;
  private channelOrder: string;
  private cachedData: unknown[] | Uint8Array | null;
  private frameOffsets: number[] | null;  // For contiguous buffer: byte offsets of each frame

  constructor(options: {
    filename: string;
    h5file: StreamingH5File;
    datasetPath: string;
    frameNumbers?: number[];
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
    this.frameNumberToIndex = new Map(frameNumbers.map((num, idx) => [num, idx]));
    this.format = options.format ?? "png";
    this.channelOrder = options.channelOrder ?? "RGB";
    this.shape = options.shape;
    this.fps = options.fps;
    this.cachedData = null;
    this.frameOffsets = null;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    // Use O(1) Map lookup; if no frame numbers provided, use frameIndex directly
    const index = this.frameNumberToIndex.size > 0
      ? this.frameNumberToIndex.get(frameIndex)
      : frameIndex;
    if (index === undefined) return null;

    // Load data if not cached
    if (!this.cachedData) {
      try {
        const data = await this.h5file.getDatasetValue(this.datasetPath);
        this.cachedData = normalizeVideoData(data.value, data.shape);

        // Detect if this is a contiguous buffer of encoded images
        if (isContiguousEncodedBuffer(this.cachedData, this.format, this.shape)) {
          this.frameOffsets = findEncodedFrameOffsets(
            this.cachedData as unknown as Uint8Array,
            this.format,
            this.shape?.[0] ?? 0
          );
        }
      } catch {
        return null;
      }
    }

    let rawBytes: Uint8Array | null;

    // Handle contiguous buffer with computed frame offsets
    if (this.frameOffsets && this.frameOffsets.length > index) {
      const buffer = this.cachedData as unknown as Uint8Array;
      const start = this.frameOffsets[index];
      const end = index + 1 < this.frameOffsets.length
        ? this.frameOffsets[index + 1]
        : buffer.length;
      rawBytes = buffer.slice(start, end);
    } else {
      // Standard vlen-encoded array: each index is a frame blob
      const entry = (this.cachedData as unknown[])[index];
      if (entry == null) return null;
      rawBytes = toUint8Array(entry);
    }

    if (!rawBytes || rawBytes.length === 0) return null;

    if (isEncodedFormat(this.format)) {
      const decoded = await decodeImageBytes(rawBytes, this.format, this.channelOrder);
      return decoded ?? rawBytes;
    }

    const image = decodeRawFrame(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }

  close(): void {
    this.cachedData = null;
    this.frameOffsets = null;
    // Note: We don't close the h5file here as it may be shared across multiple backends
  }
}

/**
 * Normalize video data to a consistent format.
 * Handles both TypedArrays (contiguous) and regular arrays (vlen-encoded).
 */
function normalizeVideoData(value: unknown, _shape: number[]): unknown[] | Uint8Array {
  // Already an array of frame blobs
  if (Array.isArray(value)) {
    return value;
  }

  // TypedArray - could be contiguous buffer or raw pixel data
  if (ArrayBuffer.isView(value)) {
    // Return as Uint8Array for further processing
    const arr = value as ArrayBufferView;
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  }

  // Fallback
  return [];
}

/**
 * Check if the data is a contiguous buffer of encoded (PNG/JPEG) images.
 */
function isContiguousEncodedBuffer(
  data: unknown[] | Uint8Array,
  format: string,
  shape?: [number, number, number, number]
): boolean {
  if (!isEncodedFormat(format)) return false;
  if (!(data instanceof Uint8Array)) return false;

  // If it's a Uint8Array and format is PNG/JPEG, check for magic bytes
  if (data.length < 8) return false;

  // Check if buffer starts with PNG or JPEG magic bytes
  const isPng = matchesMagic(data, PNG_MAGIC);
  const isJpeg = matchesMagic(data, JPEG_MAGIC);

  if (!isPng && !isJpeg) return false;

  // If we have shape info, check if buffer is much larger than a single frame
  // (indicating multiple concatenated frames)
  if (shape) {
    const frameCount = shape[0];
    if (frameCount > 1 && data.length > 10000) {
      return true;
    }
  }

  return true;
}

/**
 * Check if buffer starts with magic bytes.
 */
function matchesMagic(buffer: Uint8Array, magic: Uint8Array): boolean {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Find byte offsets of each encoded frame in a contiguous buffer.
 * Scans for PNG/JPEG magic bytes to find frame boundaries.
 */
function findEncodedFrameOffsets(
  buffer: Uint8Array,
  format: string,
  expectedFrameCount: number
): number[] {
  const offsets: number[] = [];
  const magic = format.toLowerCase() === "png" ? PNG_MAGIC : JPEG_MAGIC;

  // Scan for magic bytes
  for (let i = 0; i <= buffer.length - magic.length; i++) {
    if (matchesMagic(buffer.subarray(i), magic)) {
      offsets.push(i);
      // Skip ahead to avoid finding embedded magic bytes
      // For PNG, skip at least the header (8 bytes)
      // For JPEG, we need to be more careful as magic is only 3 bytes
      i += magic.length - 1;

      // Early exit if we found expected number of frames
      if (expectedFrameCount > 0 && offsets.length >= expectedFrameCount) {
        break;
      }
    }
  }

  return offsets;
}

function toUint8Array(entry: unknown): Uint8Array | null {
  if (entry instanceof Uint8Array) return entry;
  if (entry instanceof ArrayBuffer) return new Uint8Array(entry);
  if (ArrayBuffer.isView(entry)) return new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
  if (Array.isArray(entry)) return new Uint8Array(entry.flat());
  if (entry && typeof entry === "object" && "buffer" in entry) {
    return new Uint8Array((entry as { buffer: ArrayBuffer }).buffer);
  }
  return null;
}

function isEncodedFormat(format: string): boolean {
  const normalized = format.toLowerCase();
  return normalized === "png" || normalized === "jpg" || normalized === "jpeg";
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
