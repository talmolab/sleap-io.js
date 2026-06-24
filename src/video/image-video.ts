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
import { LruCache } from "./lru-cache.js";

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
  /** Byte budget for the raw-bytes cache tier (default 128 MB). */
  bytesCacheBytes?: number;
  /** Byte budget for the decoded-frame cache tier (default 64 MB). */
  decodedCacheBytes?: number;
  /** Max concurrent prefetch reads (default 6). */
  prefetchConcurrency?: number;
  /** Frames to read ahead in the direction of travel (default 8; 0 disables). */
  prefetchAhead?: number;
  /** Frames to read behind the direction of travel (default 2). */
  prefetchBehind?: number;
}

/**
 * Indices to prefetch around `current`, biased ahead in the direction of travel
 * (`current` vs the previous index `last`). Reading is the dominant cost, so we
 * read ahead where the user is most likely to go next, plus a couple behind for
 * back-stepping. Clamped to `[0, length)` and excludes `current`. Pure.
 */
export function computePrefetchWindow(
  current: number,
  last: number | null,
  length: number,
  ahead: number,
  behind: number,
): number[] {
  const dir = last === null || current >= last ? 1 : -1;
  const out: number[] = [];
  for (let k = 1; k <= ahead; k++) out.push(current + dir * k);
  for (let k = 1; k <= behind; k++) out.push(current - dir * k);
  return out.filter((i) => i >= 0 && i < length && i !== current);
}

/**
 * Default byte budgets for the two cache tiers. Bytes (encoded jpgs, ~106 KB
 * each) are cached generously because they are cheap and caching them kills the
 * dominant cost — the network read. Decoded frames (~5 MB each, RGBA) are 50×
 * larger, so the decoded tier is smaller; re-decoding from a cached jpg is ~4 ms.
 */
const DEFAULT_BYTES_CACHE = 128 * 1024 * 1024;
const DEFAULT_DECODED_CACHE = 64 * 1024 * 1024;
const DEFAULT_PREFETCH_CONCURRENCY = 6;
const DEFAULT_PREFETCH_AHEAD = 8;
const DEFAULT_PREFETCH_BEHIND = 2;

export class ImageVideoBackend implements VideoBackend {
  filename: string[];
  shape: [number, number, number, number];
  private reader: ImageBytesReader;
  // Two-tier cache: a large tier of raw encoded bytes (kills the network read on
  // revisit/prefetch) and a small tier of decoded frames (kills the re-decode).
  private bytesCache: LruCache<number, Uint8Array>;
  private decodedCache: LruCache<number, ImageData>;
  // In-flight byte reads, so a getFrame and a prefetch of the same frame share
  // one read instead of racing.
  private inflight = new Map<number, Promise<Uint8Array>>();
  private prefetchConcurrency: number;
  private prefetchAhead: number;
  private prefetchBehind: number;
  private lastIndex: number | null = null;
  // Bumped each time a new prefetch window is issued; in-flight prefetch workers
  // stop pulling new frames once superseded (e.g. the user jumps away).
  private prefetchGen = 0;
  /**
   * The in-flight auto-prefetch promise from the most recent `getFrame`. Resolves
   * when that window finishes (or is superseded). Exposed for coordination/tests;
   * callers normally ignore it.
   */
  lastPrefetch: Promise<void> = Promise.resolve();

  private constructor(
    filename: string[],
    reader: ImageBytesReader,
    shape: [number, number, number, number],
    cfg: {
      bytesCacheBytes: number;
      decodedCacheBytes: number;
      prefetchConcurrency: number;
      prefetchAhead: number;
      prefetchBehind: number;
    },
  ) {
    this.filename = filename;
    this.reader = reader;
    this.shape = shape;
    this.bytesCache = new LruCache(cfg.bytesCacheBytes, (b) => b.byteLength);
    this.decodedCache = new LruCache(
      cfg.decodedCacheBytes,
      (f) => f.data.byteLength,
    );
    this.prefetchConcurrency = cfg.prefetchConcurrency;
    this.prefetchAhead = cfg.prefetchAhead;
    this.prefetchBehind = cfg.prefetchBehind;
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
          "supply one via setImageBytesReader().",
      );
    }
    const frames = opts.filename.length;
    let height = 0;
    let width = 0;
    let channels = 0;
    let seedBytes: Uint8Array | undefined;
    let seedFrame: ImageData | undefined;

    if (opts.shape) {
      [, height, width, channels] = opts.shape;
    } else if (frames > 0) {
      seedBytes = await reader(opts.filename[0]);
      seedFrame = await decodeEncoded(seedBytes);
      height = seedFrame.height;
      width = seedFrame.width;
      channels = isGrayscale(seedFrame) ? 1 : 3;
    }

    const be = new ImageVideoBackend(
      opts.filename,
      reader,
      [frames, height, width, channels],
      {
        bytesCacheBytes: opts.bytesCacheBytes ?? DEFAULT_BYTES_CACHE,
        decodedCacheBytes: opts.decodedCacheBytes ?? DEFAULT_DECODED_CACHE,
        prefetchConcurrency:
          opts.prefetchConcurrency ?? DEFAULT_PREFETCH_CONCURRENCY,
        prefetchAhead: opts.prefetchAhead ?? DEFAULT_PREFETCH_AHEAD,
        prefetchBehind: opts.prefetchBehind ?? DEFAULT_PREFETCH_BEHIND,
      },
    );
    // Seed the cache with frame 0 (decoded up front when no shape was given).
    if (seedBytes) be.bytesCache.set(0, seedBytes);
    if (seedFrame) be.decodedCache.set(0, seedFrame);
    return be;
  }

  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    if (frameIndex < 0 || frameIndex >= this.filename.length) return null;
    // Kick off read-ahead before serving (so cache hits still prefetch ahead).
    this.triggerPrefetch(frameIndex);
    const decoded = this.decodedCache.get(frameIndex);
    if (decoded) return decoded;
    const bytes = await this.startRead(frameIndex);
    const frame = await decodeEncoded(bytes);
    this.decodedCache.set(frameIndex, frame);
    return frame;
  }

  /**
   * Read a frame's encoded bytes, serving from the bytes tier when present (no
   * network) and coalescing concurrent reads of the same frame via `inflight` so
   * a getFrame and a prefetch never read the same file twice.
   */
  private startRead(frameIndex: number): Promise<Uint8Array> {
    const cached = this.bytesCache.get(frameIndex);
    if (cached) return Promise.resolve(cached);
    const existing = this.inflight.get(frameIndex);
    if (existing) return existing;
    const p = (async () => {
      try {
        const bytes = await this.reader(this.filename[frameIndex]);
        this.bytesCache.set(frameIndex, bytes);
        return bytes;
      } finally {
        this.inflight.delete(frameIndex);
      }
    })();
    this.inflight.set(frameIndex, p);
    return p;
  }

  /**
   * Read a window of frames' bytes into the bytes tier, concurrency-capped, and
   * cancellable: a later prefetch (or a jump) bumps the generation so in-flight
   * workers stop pulling new frames. Resolves when this window finishes or is
   * superseded. Frames already cached or in flight are skipped.
   */
  prefetch(indices: number[]): Promise<void> {
    const gen = ++this.prefetchGen;
    const queue = [...new Set(indices)].filter(
      (i) => i >= 0 && i < this.filename.length && !this.bytesCache.has(i),
    );
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < queue.length && gen === this.prefetchGen) {
        const i = queue[next++];
        if (this.bytesCache.has(i)) continue;
        try {
          await this.startRead(i);
        } catch {
          // Leave uncached; a real getFrame for this index will surface the error.
        }
      }
    };
    const n = Math.min(this.prefetchConcurrency, queue.length);
    return Promise.all(Array.from({ length: n }, () => worker())).then(
      () => undefined,
    );
  }

  /** Compute and launch the read-ahead window for `frameIndex` (fire-and-forget). */
  private triggerPrefetch(frameIndex: number): void {
    const window = computePrefetchWindow(
      frameIndex,
      this.lastIndex,
      this.filename.length,
      this.prefetchAhead,
      this.prefetchBehind,
    );
    this.lastIndex = frameIndex;
    this.lastPrefetch = this.prefetch(window);
  }

  close(): void {
    this.bytesCache.clear();
    this.decodedCache.clear();
    this.inflight.clear();
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
