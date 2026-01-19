import { VideoBackend, VideoFrame } from "./backend.js";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

// PNG magic bytes: 0x89 P N G \r \n 0x1A \n
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// JPEG magic bytes: 0xFF 0xD8 0xFF
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);

/**
 * Video backend for embedded images in HDF5 files.
 *
 * Supports two data storage formats:
 * 1. vlen-encoded: Array of individual frame blobs (each index = one frame)
 * 2. Contiguous buffer: Single buffer with all frames concatenated
 */
export class Hdf5VideoBackend implements VideoBackend {
  filename: string;
  dataset?: string | null;
  shape?: [number, number, number, number];
  fps?: number;
  private file: any;
  private datasetPath: string;
  private frameNumbers: number[];
  private format: string;
  private channelOrder: string;
  private cachedData: unknown[] | Uint8Array | null;
  private frameOffsets: number[] | null;

  constructor(options: {
    filename: string;
    file: any;
    datasetPath: string;
    frameNumbers?: number[];
    format?: string;
    channelOrder?: string;
    shape?: [number, number, number, number];
    fps?: number;
  }) {
    this.filename = options.filename;
    this.file = options.file;
    this.datasetPath = options.datasetPath;
    this.dataset = options.datasetPath;
    this.frameNumbers = options.frameNumbers ?? [];
    this.format = options.format ?? "png";
    this.channelOrder = options.channelOrder ?? "RGB";
    this.shape = options.shape;
    this.fps = options.fps;
    this.cachedData = null;
    this.frameOffsets = null;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    const dataset = this.file.get(this.datasetPath);
    if (!dataset) return null;
    const index = this.frameNumbers.length ? this.frameNumbers.indexOf(frameIndex) : frameIndex;
    if (index < 0) return null;

    if (!this.cachedData) {
      const value = dataset.value;
      this.cachedData = normalizeVideoData(value);

      // Detect if this is a contiguous buffer of encoded images
      if (isContiguousEncodedBuffer(this.cachedData, this.format, this.shape)) {
        this.frameOffsets = findEncodedFrameOffsets(
          this.cachedData as Uint8Array,
          this.format,
          this.shape?.[0] ?? 0
        );
      }
    }

    let rawBytes: Uint8Array | null;

    // Handle contiguous buffer with computed frame offsets
    if (this.frameOffsets && this.frameOffsets.length > index) {
      const buffer = this.cachedData as Uint8Array;
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
      const decoded = await decodeImageBytes(rawBytes, this.format);
      return decoded ?? rawBytes;
    }

    const image = decodeRawFrame(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }

  close(): void {
    this.cachedData = null;
    this.frameOffsets = null;
  }
}

/**
 * Normalize video data to a consistent format.
 */
function normalizeVideoData(value: unknown): unknown[] | Uint8Array {
  if (Array.isArray(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const arr = value as ArrayBufferView;
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  }
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
  if (data.length < 8) return false;

  const isPng = matchesMagic(data, PNG_MAGIC);
  const isJpeg = matchesMagic(data, JPEG_MAGIC);

  if (!isPng && !isJpeg) return false;

  if (shape) {
    const frameCount = shape[0];
    if (frameCount > 1 && data.length > 10000) {
      return true;
    }
  }

  return true;
}

function matchesMagic(buffer: Uint8Array, magic: Uint8Array): boolean {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Find byte offsets of each encoded frame in a contiguous buffer.
 */
function findEncodedFrameOffsets(
  buffer: Uint8Array,
  format: string,
  expectedFrameCount: number
): number[] {
  const offsets: number[] = [];
  const magic = format.toLowerCase() === "png" ? PNG_MAGIC : JPEG_MAGIC;

  for (let i = 0; i <= buffer.length - magic.length; i++) {
    if (matchesMagic(buffer.subarray(i), magic)) {
      offsets.push(i);
      i += magic.length - 1;

      if (expectedFrameCount > 0 && offsets.length >= expectedFrameCount) {
        break;
      }
    }
  }

  return offsets;
}

function toUint8Array(entry: any): Uint8Array | null {
  if (entry instanceof Uint8Array) return entry;
  if (entry instanceof ArrayBuffer) return new Uint8Array(entry);
  if (ArrayBuffer.isView(entry)) return new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
  if (Array.isArray(entry)) return new Uint8Array(entry.flat());
  if (entry?.buffer) return new Uint8Array(entry.buffer);
  return null;
}

function isEncodedFormat(format: string): boolean {
  const normalized = format.toLowerCase();
  return normalized === "png" || normalized === "jpg" || normalized === "jpeg";
}

async function decodeImageBytes(bytes: Uint8Array, format: string): Promise<VideoFrame | null> {
  if (!isBrowser || typeof createImageBitmap === "undefined") return null;
  const mime = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: mime });
  return createImageBitmap(blob);
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
