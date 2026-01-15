import { VideoBackend, VideoFrame } from "./backend.js";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

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
  private cachedData: any | null;

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
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    const dataset = this.file.get(this.datasetPath);
    if (!dataset) return null;
    const index = this.frameNumbers.length ? this.frameNumbers.indexOf(frameIndex) : frameIndex;
    if (index < 0) return null;

    if (!this.cachedData) {
      this.cachedData = dataset.value;
    }

    const entry = this.cachedData[index];
    if (entry == null) return null;

    const rawBytes = toUint8Array(entry);
    if (!rawBytes) return null;

    if (isEncodedFormat(this.format)) {
      const decoded = await decodeImageBytes(rawBytes, this.format);
      return decoded ?? rawBytes;
    }

    const image = decodeRawFrame(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }

  close(): void {
    this.cachedData = null;
  }
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
