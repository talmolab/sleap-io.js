// src/video/seq-video.ts
//
// Backend for reading Norpix StreamPix `.seq` video files.
//
// The `.seq` format is used by StreamPix / Norpix for high-speed video recording
// in behavioral neuroscience. This is a faithful port of Python sleap-io's
// `sleap_io/io/seq.py` (PR #380), adapted to the JS `VideoBackend` interface.
//
// Format overview:
//   - 1024-byte little-endian binary header (magic 0xFEED)
//   - Uncompressed (raw grayscale / BGR) and compressed (JPEG, PNG) codecs
//   - Per-frame timestamps (seconds + milliseconds + optional microseconds)
//   - Compressed formats use variable-length frames requiring a seek index
//
// This module is browser-reachable (via the video factory), so it must not
// statically import `node:fs`. File access on Node is provided through an
// injected byte-source factory (see `seq-node.ts`); browsers use a `Blob`.

import { VideoBackend, VideoFrame } from "./backend.js";

/** Numeric image-format code → codec name (Python `_IMAGE_FORMAT_CODES`). */
const IMAGE_FORMAT_CODES: Record<number, string> = {
  100: "monoraw", // Grayscale uncompressed
  200: "raw", // Color BGR uncompressed
  101: "brgb8", // Bayer pattern raw
  102: "monojpg", // Grayscale JPEG compressed
  201: "jpg", // Color JPEG compressed
  103: "jbrgb", // Bayer JPEG compressed
  1: "monopng", // Grayscale PNG compressed
  2: "png", // Color PNG compressed
};

const COMPRESSED_CODECS = new Set(["monojpg", "jpg", "jbrgb", "monopng", "png"]);
const BAYER_CODECS = new Set(["brgb8", "jbrgb"]);

const HEADER_SIZE = 1024;
const MAGIC = 0xfeed;

// =============================================================================
// Byte source abstraction
// =============================================================================

/**
 * Random-access reader over the bytes of a `.seq` file. Implementations: a
 * `Blob` (browser) and an injected `node:fs`-backed source (Node, registered by
 * `seq-node.ts`).
 */
export interface ByteSource {
  /** Total size of the source in bytes. */
  size(): Promise<number>;
  /** Read `length` bytes starting at `offset` (clamped to EOF). */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Release any underlying handle. */
  close(): void;
}

/** `Blob`/`File`-backed byte source (browser-safe). */
export class BlobByteSource implements ByteSource {
  private blob: Blob;
  constructor(blob: Blob) {
    this.blob = blob;
  }
  async size(): Promise<number> {
    return this.blob.size;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(offset + length, this.blob.size);
    if (end <= offset) return new Uint8Array(0);
    const buf = await this.blob.slice(offset, end).arrayBuffer();
    return new Uint8Array(buf);
  }
  close(): void {
    // Nothing to release for a Blob.
  }
}

/** Factory for a file-path byte source; registered by the Node entry point. */
export type FileByteSourceFactory = (path: string) => ByteSource;

let fileByteSourceFactory: FileByteSourceFactory | null = null;

/** Register the Node `node:fs`-backed byte source factory (see `seq-node.ts`). */
export function setSeqFileByteSourceFactory(
  factory: FileByteSourceFactory | null
): void {
  fileByteSourceFactory = factory;
}

function createFileByteSource(path: string): ByteSource {
  if (!fileByteSourceFactory) {
    throw new Error(
      "Reading .seq files from a path requires the Node entry point " +
        "(`@talmolab/sleap-io.js`). In the browser, pass a File/Blob instead."
    );
  }
  return fileByteSourceFactory(path);
}

// =============================================================================
// Header
// =============================================================================

/** Parsed header of a Norpix `.seq` file (port of Python `SeqHeader`). */
export class SeqHeader {
  magic = MAGIC;
  name = "Norpix seq";
  version = 0;
  headerSize = HEADER_SIZE;
  description = "";
  width = 0;
  height = 0;
  bitDepth = 8;
  bitDepthReal = 8;
  imageSizeBytes = 0;
  imageFormat = 100;
  numFrames = 0;
  trueImageSize = 0;
  fps = 30.0;
  codec = "";

  /** Human-readable codec name (e.g. `"monoraw"`). */
  get codecName(): string {
    return IMAGE_FORMAT_CODES[this.imageFormat] ?? `unknown(${this.imageFormat})`;
  }

  /** Whether frames use variable-length compression (JPEG/PNG). */
  get isCompressed(): boolean {
    return COMPRESSED_CODECS.has(this.codecName);
  }

  /** Number of color channels (`bitDepth / bitDepthReal`). */
  get numChannels(): number {
    return Math.floor(this.bitDepth / (this.bitDepthReal || 8));
  }

  /**
   * Parse the 1024-byte header from a byte buffer.
   *
   * @throws If the buffer is too small or has an invalid magic number.
   */
  static fromBytes(raw: Uint8Array): SeqHeader {
    if (raw.length < HEADER_SIZE) {
      throw new Error("File too small to contain a valid .seq header");
    }
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    const magic = dv.getUint32(0, true);
    if (magic !== MAGIC) {
      throw new Error(
        `Invalid .seq magic: 0x${magic.toString(16).toUpperCase()} ` +
          `(expected 0x${MAGIC.toString(16).toUpperCase()})`
      );
    }

    const readU16String = (start: number, count: number): string => {
      let s = "";
      for (let i = 0; i < count; i++) {
        const c = dv.getUint16(start + i * 2, true);
        if (c > 0 && c < 128) s += String.fromCharCode(c);
      }
      return s.trim();
    };

    const header = new SeqHeader();
    header.magic = magic;
    header.name = readU16String(4, 10); // bytes 4-23
    header.version = dv.getInt32(28, true);
    header.headerSize = dv.getUint32(32, true);
    header.description = readU16String(36, 256); // bytes 36-547

    // 9 uint32 fields starting at byte 548.
    header.width = dv.getUint32(548, true);
    header.height = dv.getUint32(552, true);
    header.bitDepth = dv.getUint32(556, true);
    header.bitDepthReal = dv.getUint32(560, true);
    header.imageSizeBytes = dv.getUint32(564, true);
    header.imageFormat = dv.getUint32(568, true);
    header.numFrames = dv.getUint32(572, true);
    // field[7] @576 is unused.
    header.trueImageSize = dv.getUint32(580, true);

    header.fps = dv.getFloat64(584, true);
    header.codec = `imageFormat${String(header.imageFormat).padStart(3, "0")}`;

    return header;
  }
}

// =============================================================================
// Seek index
// =============================================================================

const JPEG_SOI = [0xff, 0xd8];
const PNG_SIG = [0x89, 0x50];

/** Frame seek index for a `.seq` file (port of Python `SeqIndex`). */
export class SeqIndex {
  offsets: number[];
  numFrames: number;
  /** Per-frame timestamp size in bytes (6 for version < 5, else 8). */
  timestampSize: number;

  constructor(offsets: number[], numFrames: number, timestampSize: number) {
    this.offsets = offsets;
    this.numFrames = numFrames;
    this.timestampSize = timestampSize;
  }

  /** Byte offset for a frame. @throws If out of range. */
  frameOffset(frame: number): number {
    if (frame < 0 || frame >= this.numFrames) {
      throw new Error(`Frame ${frame} out of range [0, ${this.numFrames})`);
    }
    return this.offsets[frame];
  }

  /** Build the index for uncompressed formats (constant frame stride). */
  static buildUncompressed(header: SeqHeader): SeqIndex {
    const offsets: number[] = [];
    for (let i = 0; i < header.numFrames; i++) {
      offsets.push(HEADER_SIZE + i * header.trueImageSize);
    }
    return new SeqIndex(offsets, header.numFrames, header.version >= 5 ? 8 : 6);
  }

  /**
   * Build the index for compressed formats by scanning the file.
   *
   * Compressed frames are variable-length, so the file is scanned sequentially:
   * each frame begins with a uint32 size; the next frame is located by probing
   * for the next `size + magic` past the timestamp, allowing small even padding.
   */
  static async buildCompressed(
    source: ByteSource,
    header: SeqHeader
  ): Promise<SeqIndex> {
    const fileSize = await source.size();
    const nMax = header.numFrames > 0 ? header.numFrames : 10_000_000;
    const tsSize = header.version >= 5 ? 8 : 6;
    let extra: number | null = null;

    const readU32 = async (pos: number): Promise<number | null> => {
      const b = await source.read(pos, 4);
      if (b.length < 4) return null;
      return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
    };

    const offsets: number[] = [HEADER_SIZE];

    for (let i = 1; i < nMax; i++) {
      const prev = offsets[i - 1];
      const frameSize = await readU32(prev);
      if (frameSize === null) break;
      if (frameSize === 0 || frameSize > fileSize) break;

      let nextOffset: number;
      if (extra !== null) {
        nextOffset = prev + frameSize + extra;
      } else {
        const searchStart = prev + frameSize + tsSize;
        let found = false;
        nextOffset = 0;
        for (let pad = 0; pad < 32; pad += 2) {
          const candidate = searchStart + pad;
          if (candidate + 6 > fileSize) break;
          const probe = await source.read(candidate, 6);
          if (probe.length < 6) break;
          const candSize = new DataView(
            probe.buffer,
            probe.byteOffset,
            6
          ).getUint32(0, true);
          const m0 = probe[4];
          const m1 = probe[5];
          const isMagic =
            (m0 === JPEG_SOI[0] && m1 === JPEG_SOI[1]) ||
            (m0 === PNG_SIG[0] && m1 === PNG_SIG[1]);
          if (candSize > 0 && candSize < fileSize && isMagic) {
            extra = tsSize + pad;
            nextOffset = candidate;
            found = true;
            break;
          }
        }
        if (!found) break;
      }

      if (nextOffset >= fileSize) break;

      // Validate the next frame begins with a plausible size field. Read 6 bytes
      // (size + magic) and require all 6 to be present, matching Python's scan.
      const check = await source.read(nextOffset, 6);
      if (check.length < 6) break;
      const checkSize = new DataView(check.buffer, check.byteOffset, 6).getUint32(
        0,
        true
      );
      if (checkSize === 0 || checkSize > fileSize) break;

      offsets.push(nextOffset);
    }

    return new SeqIndex(offsets, offsets.length, tsSize);
  }
}

// =============================================================================
// Image decoding helpers
// =============================================================================

const hasGlobalImageData = typeof globalThis !== "undefined" &&
  typeof (globalThis as { ImageData?: unknown }).ImageData !== "undefined";

/** Construct an `ImageData` from RGBA bytes, in browser or Node (skia-canvas). */
async function makeImageData(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number
): Promise<ImageData> {
  if (hasGlobalImageData) {
    return new ImageData(rgba, width, height);
  }
  try {
    const sc = await import("skia-canvas");
    return new (sc as unknown as {
      ImageData: new (
        d: Uint8ClampedArray<ArrayBuffer>,
        w: number,
        h: number
      ) => ImageData;
    }).ImageData(rgba, width, height);
  } catch {
    // Last-resort duck-typed frame: consumers only read width/height/data.
    return { data: rgba, width, height, colorSpace: "srgb" } as unknown as ImageData;
  }
}

/** Decode a JPEG/PNG byte buffer to an RGBA `ImageData`. */
async function decodeEncoded(bytes: Uint8Array): Promise<ImageData> {
  // Browser: createImageBitmap + canvas.
  if (
    typeof createImageBitmap !== "undefined" &&
    typeof OffscreenCanvas !== "undefined"
  ) {
    const safe = new Uint8Array(bytes);
    const bitmap = await createImageBitmap(new Blob([safe.buffer]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context for .seq frame decode");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  }
  // Node: skia-canvas loadImage + canvas. skia-canvas's loadImage wants a Node
  // Buffer (a bare Uint8Array is misread as a path), so wrap the bytes.
  try {
    const sc = await import("skia-canvas");
    const src =
      typeof Buffer !== "undefined" ? Buffer.from(bytes) : (bytes as unknown);
    const img = await (
      sc as unknown as { loadImage: (b: unknown) => Promise<{ width: number; height: number }> }
    ).loadImage(src);
    const Canvas = (sc as unknown as { Canvas: new (w: number, h: number) => unknown })
      .Canvas;
    const canvas = new Canvas(img.width, img.height) as {
      getContext: (t: string) => {
        drawImage: (i: unknown, x: number, y: number) => void;
        getImageData: (x: number, y: number, w: number, h: number) => ImageData;
      };
    };
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  } catch (err) {
    throw new Error(
      "Decoding JPEG/PNG frames in .seq files requires an image decoder " +
        "(a browser, or the optional `skia-canvas` package on Node). " +
        `Original error: ${(err as Error).message}`
    );
  }
}

// =============================================================================
// Backend
// =============================================================================

/**
 * Video backend for reading Norpix `.seq` files.
 *
 * Supported codecs: `monoraw` (grayscale raw), `raw` (BGR raw → RGB),
 * `monojpg`/`jpg` (JPEG), `monopng`/`png` (PNG). Bayer codecs are unsupported.
 *
 * Construct via {@link SeqVideoBackend.create} (async; parses the header, builds
 * the seek index, and computes FPS from timestamps).
 */
export class SeqVideoBackend implements VideoBackend {
  filename: string;
  dataset?: string | null = null;
  shape: [number, number, number, number];
  fps?: number;

  private source: ByteSource;
  private headerData: SeqHeader;
  private index: SeqIndex;

  private constructor(
    filename: string,
    source: ByteSource,
    header: SeqHeader,
    index: SeqIndex,
    fps: number | undefined
  ) {
    this.filename = filename;
    this.source = source;
    this.headerData = header;
    this.index = index;
    this.fps = fps;
    const channels = header.numChannels === 1 ? 1 : 3;
    this.shape = [index.numFrames, header.height, header.width, channels];
  }

  /** Open a `.seq` file from a path (Node) or a `File`/`Blob` (browser). */
  static async create(source: string | File | Blob): Promise<SeqVideoBackend> {
    const isBlob = typeof Blob !== "undefined" && source instanceof Blob;
    const filename = isBlob ? ((source as File).name ?? "") : (source as string);
    const byteSource = isBlob
      ? new BlobByteSource(source as Blob)
      : createFileByteSource(source as string);

    try {
      const header = SeqHeader.fromBytes(await byteSource.read(0, HEADER_SIZE));
      if (BAYER_CODECS.has(header.codecName)) {
        throw new Error(
          `Bayer codec '${header.codecName}' is not supported in .seq files. ` +
            "Convert the file to a standard format first."
        );
      }
      const index = header.isCompressed
        ? await SeqIndex.buildCompressed(byteSource, header)
        : SeqIndex.buildUncompressed(header);
      const fps = await computeFps(byteSource, header, index, (i, h) =>
        readTimestamp(byteSource, h, index, i)
      );
      return new SeqVideoBackend(filename, byteSource, header, index, fps);
    } catch (err) {
      byteSource.close();
      throw err;
    }
  }

  /** The parsed `.seq` header. */
  get header(): SeqHeader {
    return this.headerData;
  }

  /** Number of frames in the video. */
  get numFrames(): number {
    return this.index.numFrames;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    let idx = frameIndex;
    if (idx < 0) idx = this.index.numFrames + idx;
    if (idx < 0 || idx >= this.index.numFrames) return null;

    const data = await readFrameData(this.source, this.headerData, this.index, idx);
    return decodeFrame(this.headerData, data);
  }

  /**
   * Absolute per-frame timestamps as seconds since the Unix epoch (Python
   * `get_timestamps` parity).
   */
  async getTimestamps(): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < this.index.numFrames; i++) {
      out.push(await readTimestamp(this.source, this.headerData, this.index, i));
    }
    return out;
  }

  /** Absolute timestamp (seconds since epoch) for a single frame. */
  async getTimestamp(frameIndex: number): Promise<number> {
    let idx = frameIndex;
    if (idx < 0) idx = this.index.numFrames + idx;
    if (idx < 0 || idx >= this.index.numFrames) {
      throw new Error(
        `Frame ${frameIndex} out of range [0, ${this.index.numFrames})`
      );
    }
    return readTimestamp(this.source, this.headerData, this.index, idx);
  }

  /**
   * Presentation times in seconds relative to the first frame (consistent with
   * the other backends' {@link VideoBackend.getFrameTimes}). For absolute
   * timestamps use {@link getTimestamps}.
   */
  async getFrameTimes(): Promise<number[] | null> {
    const ts = await this.getTimestamps();
    if (ts.length === 0) return null;
    const t0 = ts[0];
    return ts.map((t) => t - t0);
  }

  close(): void {
    this.source.close();
  }
}

// =============================================================================
// Frame / timestamp / fps helpers (free functions; operate on a ByteSource)
// =============================================================================

/** Read the compressed frame's leading 4-byte size field (includes itself). */
async function readCompressedFrameSize(
  source: ByteSource,
  offset: number
): Promise<number> {
  const sizeBytes = await source.read(offset, 4);
  return new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 4).getUint32(0, true);
}

/** Read the raw (possibly compressed) bytes of a frame. */
async function readFrameData(
  source: ByteSource,
  header: SeqHeader,
  index: SeqIndex,
  frameIdx: number
): Promise<Uint8Array> {
  const offset = index.frameOffset(frameIdx);
  if (header.isCompressed) {
    const nbytes = await readCompressedFrameSize(source, offset);
    return source.read(offset + 4, nbytes - 4);
  }
  return source.read(offset, header.imageSizeBytes);
}

/** Read the timestamp (seconds since epoch) for a frame. */
async function readTimestamp(
  source: ByteSource,
  header: SeqHeader,
  index: SeqIndex,
  frameIdx: number
): Promise<number> {
  // The timestamp directly follows the image data. Its position is nominal in
  // both cases (matching Python's value for well-formed files) — no need to read
  // the frame data: uncompressed is a fixed stride; compressed uses the leading
  // 4-byte size field (which includes itself), so the timestamp is at
  // `offset + frameSize`. This keeps timestamp/FPS reads cheap.
  const offset = index.frameOffset(frameIdx);
  const tsPos = header.isCompressed
    ? offset + (await readCompressedFrameSize(source, offset))
    : offset + header.imageSizeBytes;

  const buf = await source.read(tsPos, index.timestampSize);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sec = dv.getUint32(0, true);
  const ms = dv.getUint16(4, true);
  let result = sec + ms / 1000.0;
  if (index.timestampSize === 8) {
    const us = dv.getUint16(6, true);
    result += us / 1_000_000.0;
  }
  return result;
}

/** Decode raw frame bytes into an RGBA `ImageData`. */
async function decodeFrame(header: SeqHeader, data: Uint8Array): Promise<ImageData> {
  const codec = header.codecName;
  const h = header.height;
  const w = header.width;
  const nch = header.numChannels;

  if (codec === "monoraw" || codec === "raw") {
    const rgba = new Uint8ClampedArray(w * h * 4);
    if (nch === 1) {
      for (let i = 0; i < w * h; i++) {
        const gray = data[i] ?? 0;
        const o = i * 4;
        rgba[o] = gray;
        rgba[o + 1] = gray;
        rgba[o + 2] = gray;
        rgba[o + 3] = 255;
      }
    } else {
      // BGR -> RGBA.
      for (let i = 0; i < w * h; i++) {
        const base = i * nch;
        const o = i * 4;
        rgba[o] = data[base + 2] ?? 0; // R <- B
        rgba[o + 1] = data[base + 1] ?? 0; // G
        rgba[o + 2] = data[base] ?? 0; // B <- R
        rgba[o + 3] = 255;
      }
    }
    return makeImageData(rgba, w, h);
  }

  if (
    codec === "monojpg" ||
    codec === "jpg" ||
    codec === "monopng" ||
    codec === "png"
  ) {
    return decodeEncoded(data);
  }

  throw new Error(`Unsupported .seq codec: ${codec}`);
}

/**
 * Recompute FPS from actual frame timestamps using the first 100 frames (robust
 * median-filtered estimate). Falls back to the header FPS (if >= 1) else
 * `undefined`. Mirrors Python `_recompute_fps`.
 */
async function computeFps(
  source: ByteSource,
  header: SeqHeader,
  index: SeqIndex,
  read: (i: number, h: SeqHeader) => Promise<number>
): Promise<number | undefined> {
  const fallback = header.fps >= 1.0 ? header.fps : undefined;
  try {
    const n = Math.min(100, index.numFrames);
    if (n < 2) return fallback;

    const ts: number[] = [];
    for (let i = 0; i < n; i++) ts.push(await read(i, header));

    const ds: number[] = [];
    for (let i = 1; i < ts.length; i++) ds.push(ts[i] - ts[i - 1]);

    const median = medianOf(ds);
    // 5ms tolerance — tuned for high-speed video (>100 fps); slower framerates
    // with larger jitter fall back to the header FPS.
    const filtered = ds.filter((d) => Math.abs(d - median) < 0.005);
    if (filtered.length > 0) {
      const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
      const computed = 1.0 / mean;
      if (Number.isFinite(computed) && computed >= 1.0) {
        return computed;
      }
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
