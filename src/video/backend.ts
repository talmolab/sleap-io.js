import type { CropRect } from "../transform/points.js";
import type { Fill, RawFrame } from "../transform/frame.js";

export type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;

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
  getFrame(frameIndex: number): Promise<VideoFrame | null>;
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
