import type { CropRect } from "../transform/points.js";
import type { Fill, RawFrame } from "../transform/frame.js";

export type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;

/** Per-call options for {@link VideoBackend.getFrame}. */
export interface GetFrameOptions {
  /**
   * When `false`, suppress this backend's read-ahead prefetch for this call.
   * Read-ahead helps sequential playback but is wasted (and saturates I/O) while
   * scrubbing, where the caller jumps past the prefetched frames. Backends with
   * no prefetch ignore it. Defaults to `true` (prefetch enabled).
   */
  prefetch?: boolean;
  /**
   * Optional cancellation signal. Backends that decode asynchronously (e.g. the
   * MP4 backend) bail early when it aborts; backends that don't ignore it.
   */
  signal?: AbortSignal;
}

/**
 * A lazy, seekable byte source for a video file — the video counterpart of the
 * HDF5 streaming reader's range source. Lets a backend read only the byte ranges
 * it needs (the container index + the samples for the frames being viewed)
 * instead of materializing the whole file in memory.
 *
 * The canonical use is desktop (Tauri), where the WebView has no lazy disk-backed
 * `File` for a raw path: `readRange` is backed by a native `read_range` command
 * so a multi-GB video never has to be read whole into RAM. Structurally mirrors
 * the HDF5 `RangeSource` used by `readSlpStreaming`.
 */
export interface RangeSource {
  /** Total file size in bytes. */
  size: number;
  /** Read `[offset, offset + length)`; may return fewer bytes at EOF. */
  readRange: (offset: number, length: number) => Promise<Uint8Array>;
}

/**
 * True for a {@link RangeSource} — distinguishes it from a `string` URL / `File`
 * / `Blob`. A `Blob` also has a numeric `size`, so the `readRange` function is
 * the discriminator.
 */
export function isRangeSource(source: unknown): source is RangeSource {
  return (
    typeof source === "object" &&
    source !== null &&
    typeof (source as RangeSource).size === "number" &&
    typeof (source as RangeSource).readRange === "function"
  );
}

export interface VideoBackend {
  filename: string | string[];
  shape?: [number, number, number, number];
  fps?: number;
  dataset?: string | null;
  /**
   * Embedded-image (HDF5 / `pkg.slp`) backends: the source frame numbers that
   * have a stored image, in storage order. Left unset by continuous-video
   * backends (mp4 / seq / image-sequence), where every frame is decodable.
   */
  frameNumbers?: number[];
  getFrame(
    frameIndex: number,
    opts?: GetFrameOptions,
  ): Promise<VideoFrame | null>;
  getFrameTimes?(): Promise<number[] | null>;
  /**
   * Optional crop pushdown hook (Item 1 of JS issue #153, mirroring Python
   * `read_crop`, `video_reading.py:1647`).
   *
   * When a backend can read *only* the requested crop region directly from
   * storage — e.g. a raw rank-4 chunked HDF5 pixel array via an N-D hyperslab —
   * it implements this to return a `(y2-y1) x (x2-x1) x C` {@link RawFrame}
   * that is **byte-identical** to `cropFrame(fullFrame, crop, fill)` (same pad
   * value, same clamp arithmetic). Returning `null` signals "I cannot push this
   * down — fall back to a full decode + `cropFrame`". It must never throw for
   * out-of-bounds crops.
   *
   * Backends that store opaque encoded blobs (PNG/JPEG) or per-frame-indexed
   * rows (the embedded `pkg.slp` case) cannot spatially hyperslab a frame and
   * always return `null`. The JS port ships no raw rank-4 HDF5 video backend
   * today, so this is a no-op on every current fixture; the hook keeps the
   * architecture aligned with Python and leaves the fast path open.
   */
  readCrop?(
    frameIndex: number,
    crop: CropRect,
    fill: Fill,
  ): Promise<RawFrame | null>;
  close(): void;
}
