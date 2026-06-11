// src/video/image-video.ts
//
// `ImageVideoBackend` — decoder for image-sequence videos, where `filename` is a
// LIST of image paths (one image per frame). Port of Python sleap-io's
// `ImageVideo` (`sleap_io/io/video_reading.py`).
//
// Bytes for each frame are obtained through an injected `ImageBytesReader`
// (`image-source.ts`) — the browser sandbox can't read disk paths, and even on
// desktop the reader is environment-specific (Tauri `plugin-fs`, Node `fs`).
// Decoding reuses the shared `decodeEncoded` (`image-decode.ts`), which works in
// both a browser (`createImageBitmap`) and Node (`skia-canvas`). PNG/JPEG/BMP/…
// are supported; TIFF is NOT (no web decoder) — a TIFF source throws at decode.

import { VideoBackend, VideoFrame } from "./backend.js";
import { decodeEncoded } from "./image-decode.js";
import { getImageBytesReader, type ImageBytesReader } from "./image-source.js";

export interface ImageVideoOptions {
  /** Image paths, one per frame. */
  filename: string[];
  /** Byte reader; defaults to the globally-injected reader (`image-source`). */
  reader?: ImageBytesReader;
  /**
   * Optional `[frames, H, W, C]` from `.slp` metadata. When given, H/W/C are
   * trusted (frame count is always `filename.length`) and the first frame is
   * not decoded up front.
   */
  shape?: [number, number, number, number];
}

/** Default max decoded frames held in the bounded (FIFO-evicted) cache. */
const DEFAULT_CACHE_SIZE = 32;

export class ImageVideoBackend implements VideoBackend {
  filename: string[];
  shape: [number, number, number, number];
  private reader: ImageBytesReader;
  private cache = new Map<number, VideoFrame>();
  private maxCache = DEFAULT_CACHE_SIZE;

  private constructor(
    filename: string[],
    reader: ImageBytesReader,
    shape: [number, number, number, number]
  ) {
    this.filename = filename;
    this.reader = reader;
    this.shape = shape;
  }

  /**
   * Build a backend, inferring `shape` by decoding `filename[0]` once (cached)
   * when no `shape` is supplied — parity with Python `VideoBackend.img_shape`
   * (`read_test_frame` -> `_read_frame(0)`; index 0, not "first available").
   */
  static async create(opts: ImageVideoOptions): Promise<ImageVideoBackend> {
    const reader = opts.reader ?? getImageBytesReader();
    if (!reader) {
      throw new Error(
        "ImageVideoBackend requires an image-bytes reader, but none is " +
          "injected. On desktop/Node a default is registered; in the browser " +
          "supply one via setImageBytesReader()."
      );
    }
    const frames = opts.filename.length;
    let height = 0;
    let width = 0;
    let channels = 0;
    const seed = new Map<number, VideoFrame>();

    if (opts.shape) {
      [, height, width, channels] = opts.shape;
    } else if (frames > 0) {
      const first = await decodeEncoded(await reader(opts.filename[0]));
      seed.set(0, first);
      height = first.height;
      width = first.width;
      channels = isGrayscale(first) ? 1 : 3;
    }

    const be = new ImageVideoBackend(opts.filename, reader, [
      frames,
      height,
      width,
      channels,
    ]);
    for (const [k, v] of seed) be.cache.set(k, v);
    return be;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    if (frameIndex < 0 || frameIndex >= this.filename.length) return null;
    const cached = this.cache.get(frameIndex);
    if (cached) return cached;
    const frame = await decodeEncoded(await this.reader(this.filename[frameIndex]));
    this.put(frameIndex, frame);
    return frame;
  }

  private put(index: number, frame: VideoFrame): void {
    // Bounded cache with FIFO eviction (Map preserves insertion order): evict
    // the oldest-inserted frame once at capacity. Cheap and adequate for the
    // mostly-sequential scrubbing/playback access pattern.
    if (this.cache.size >= this.maxCache) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(index, frame);
  }

  close(): void {
    this.cache.clear();
  }
}

/**
 * Grayscale iff the first and last colour channels (R vs B in RGBA) are equal
 * for every pixel — parity with Python `VideoBackend.detect_grayscale`, which
 * compares `test_img[..., 0]` against `test_img[..., -1]`.
 */
function isGrayscale(img: ImageData): boolean {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] !== d[i + 2]) return false;
  }
  return true;
}
