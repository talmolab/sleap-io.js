// src/video/crop-backend.ts
//
// Virtual, axis-aligned, on-read crop wrapper for an inner `VideoBackend`.
//
// Port of Python sleap-io's `CropVideoBackend`
// (`sleap_io/io/video_reading.py`, SLP format 2.3). Wraps an inner backend and
// reports a cropped `(F, h, w, c)` view: frames are decoded full by the inner
// backend, then cropped/padded by the pure `cropFrame` primitive
// (`src/transform/frame.ts`). No pixels are copied or re-encoded on disk; the
// frame count is unchanged (a crop is spatial, not temporal).
//
// Browser-safe: this module never statically imports a Node-only decoder.
// Rasterizing an opaque `ImageBitmap` (or undecoded encoded bytes on Node) uses
// `OffscreenCanvas` when available (browser) else a lazy dynamic
// `import("skia-canvas")` (Node), exactly like `seq-video.ts`.

import { VideoBackend, VideoFrame } from "./backend.js";
import { cropFrame, type Fill, type RawFrame } from "../transform/frame.js";
import {
  cropPoints,
  uncropPoints,
  type CropRect,
  type FlatPoints,
  type PointPairs,
} from "../transform/points.js";
import { decodeEncoded, rasterizeBitmap } from "./image-decode.js";

export type { CropRect };

/** Options for {@link CropVideoBackend.wrap}. */
export interface CropWrapOptions {
  /** The backend to wrap (may itself be a `CropVideoBackend`). */
  inner: VideoBackend;
  /** Outer crop region `[x1, y1, x2, y2]` (x2/y2 exclusive), in inner coords. */
  crop: CropRect;
  /** OOB pad value (scalar applied to all channels, or per-channel). Default 0. */
  fill?: Fill;
  /** Whether `close()` cascades to `inner.close()`. Default `true`. */
  ownsInner?: boolean;
}

/**
 * Normalize a fill to a comparable canonical form: an array becomes a
 * comma-joined string of integer-coerced values; a scalar is integer-coerced.
 * A list `[128]` and the scalar-equivalent must NOT compare equal here (Python
 * compares a tuple `(128,)` against the scalar `128` and they differ), but a
 * list and the equivalent tuple do — JS has only arrays, so element-wise.
 */
function normFill(fill: Fill): string {
  if (Array.isArray(fill)) {
    return "[" + fill.map((v) => String(Math.trunc(v))).join(",") + "]";
  }
  return String(Math.trunc(fill));
}

/** Detect an opaque `ImageBitmap` (pixels not synchronously readable here). */
function isImageBitmap(value: unknown): boolean {
  if (
    typeof ImageBitmap !== "undefined" &&
    value instanceof (ImageBitmap as unknown as { new (): object })
  ) {
    return true;
  }
  // Fallback duck-type: an ImageBitmap exposes width/height + close() but has no
  // readable `data` buffer.
  const v = value as {
    width?: unknown;
    height?: unknown;
    close?: unknown;
    data?: unknown;
  };
  return (
    v != null &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.close === "function" &&
    (v as { data?: unknown }).data === undefined
  );
}

/** Detect an `ImageData`-shaped object (RGBA buffer with width/height). */
function isImageDataLike(
  value: unknown
): value is { data: Uint8ClampedArray; width: number; height: number } {
  const v = value as {
    data?: unknown;
    width?: unknown;
    height?: unknown;
  };
  return (
    v != null &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    (v.data instanceof Uint8ClampedArray || v.data instanceof Uint8Array)
  );
}

/** PNG / JPEG magic-byte sniff for undecoded encoded frame bytes. */
function isEncodedBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // JPEG: FF D8 FF; PNG: 89 50 4E 47.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  return jpeg || png;
}

/**
 * Virtual, axis-aligned, on-read crop of an inner {@link VideoBackend}.
 *
 * Implements the {@link VideoBackend} interface, reporting a cropped
 * `[F, h, w, c]` view: {@link getFrame} decodes the inner full frame, normalizes
 * it to readable pixels (rasterizing an opaque `ImageBitmap` / decoding
 * undecoded encoded bytes as needed), then applies the pure {@link cropFrame}
 * primitive. The frame count is unchanged (a crop is spatial).
 *
 * Always construct via {@link CropVideoBackend.wrap} (never the raw constructor)
 * so the "inner is never a crop" invariant and the fill-aware flatten law hold
 * by construction.
 */
export class CropVideoBackend implements VideoBackend {
  /** Derived from `inner.filename`. */
  filename: string | string[];
  /**
   * The wrapped source backend. Decodes full frames; this wrapper crops them.
   * Invariant: `inner` is never itself a `CropVideoBackend` (enforced by
   * {@link wrap}).
   */
  readonly inner: VideoBackend;
  /** Crop region `[x1, y1, x2, y2]`, x2/y2 exclusive (source px, may be OOB). */
  readonly crop: CropRect;
  /** Fill value for out-of-bounds regions, forwarded to `cropFrame`. */
  readonly fill: Fill;
  /**
   * Whether this wrapper owns the inner backend's decode handle. When `true`
   * (the default), {@link close} cascades to `inner.close()`; when `false` (a
   * shared-decode mosaic tile), it does not, so closing one tile does not tear
   * down siblings sharing the inner.
   */
  readonly ownsInner: boolean;

  /**
   * Private-by-convention constructor: prefer {@link CropVideoBackend.wrap},
   * which enforces the flatten law and the "inner is never a crop" invariant.
   */
  private constructor(
    inner: VideoBackend,
    crop: CropRect,
    fill: Fill,
    ownsInner: boolean
  ) {
    this.inner = inner;
    this.crop = [
      Math.trunc(crop[0]),
      Math.trunc(crop[1]),
      Math.trunc(crop[2]),
      Math.trunc(crop[3]),
    ];
    this.fill = Array.isArray(fill) ? fill.map((v) => Math.trunc(v)) : fill;
    this.ownsInner = ownsInner;
    this.filename = inner.filename;
  }

  /**
   * Wrap `inner` in a crop view, flattening crop-of-crop when safe.
   *
   * Flattens (composes into a single wrapper) ONLY when `inner` is itself a
   * `CropVideoBackend`, the fills agree, AND the outer crop lies fully within
   * the inner cropped frame `[0, iw] x [0, ih]` (`iw = ix2 - ix1`,
   * `ih = iy2 - iy1`). Otherwise it nests, preserving byte-parity:
   *
   * - Different fills: the inner crop's materialized pad of value `inner.fill`
   *   would be silently replaced after a flatten.
   * - Outer crop exceeds the inner frame: a flatten would read real source
   *   pixels where the nested view pads with `fill`.
   *
   * The flatten composition law expresses the outer rect in source coordinates:
   * `(ix1 + ox1, iy1 + oy1, ix1 + ox2, iy1 + oy2)`. A flattened `inner` is
   * always unwrapped to `inner.inner` so the "inner is never a crop" invariant
   * holds.
   */
  static wrap(options: CropWrapOptions): CropVideoBackend {
    let { inner } = options;
    let crop: CropRect = [
      Math.trunc(options.crop[0]),
      Math.trunc(options.crop[1]),
      Math.trunc(options.crop[2]),
      Math.trunc(options.crop[3]),
    ];
    const fill: Fill = options.fill ?? 0;
    const ownsInner = options.ownsInner ?? true;

    if (
      inner instanceof CropVideoBackend &&
      normFill(inner.fill) === normFill(fill)
    ) {
      const [ix1, iy1, ix2, iy2] = inner.crop;
      const [ox1, oy1, ox2, oy2] = crop;
      const iw = ix2 - ix1;
      const ih = iy2 - iy1;
      if (0 <= ox1 && 0 <= oy1 && ox2 <= iw && oy2 <= ih) {
        crop = [ix1 + ox1, iy1 + oy1, ix1 + ox2, iy1 + oy2];
        inner = inner.inner; // invariant: inner.inner is never a crop
      }
    }
    return new CropVideoBackend(inner, crop, fill, ownsInner);
  }

  /** Inner backend's dataset name (delegated; `null`/`undefined` if absent). */
  get dataset(): string | null | undefined {
    return this.inner.dataset;
  }

  /** Inner backend's frame rate (delegated). */
  get fps(): number | undefined {
    return this.inner.fps;
  }

  /**
   * Inner backend's embedded frame numbers (delegated). A crop is spatial and
   * frame-preserving, so the embedded set is exactly the inner's. Without this,
   * a cropped `pkg.slp` would report no embedded set (see {@link VideoBackend.frameNumbers}).
   */
  get frameNumbers(): number[] | undefined {
    return this.inner.frameNumbers;
  }

  /**
   * Cropped frame shape `[F, h, w, c]`.
   *
   * Frame count and channel count come from the inner (a crop is spatial and
   * channel-preserving); height/width are the crop extents. Returns `undefined`
   * only when the inner has no resolved shape.
   */
  get shape(): [number, number, number, number] | undefined {
    const innerShape = this.inner.shape;
    if (!innerShape) return undefined;
    const [x1, y1, x2, y2] = this.crop;
    return [innerShape[0], y2 - y1, x2 - x1, innerShape[3]];
  }

  /**
   * Read a single cropped frame.
   *
   * Decodes the inner full frame, normalizes it to readable pixels (rasterizing
   * an opaque `ImageBitmap`, decoding undecoded encoded bytes, or wrapping raw
   * pixel bytes), then applies {@link cropFrame} with this wrapper's crop/fill.
   * Returns `null` when the inner returns `null` (no such frame).
   */
  async getFrame(frameIndex: number): Promise<VideoFrame | null> {
    const src = await this.inner.getFrame(frameIndex);
    if (src == null) return null;
    const readable = await this.toReadable(src);
    return cropFrame(readable as ImageData, this.crop, this.fill);
  }

  /**
   * Normalize any {@link VideoFrame} into something {@link cropFrame} can read
   * pixels from synchronously: an `ImageData` or a {@link RawFrame}.
   *
   * - `ImageData`-shaped: returned as-is.
   * - `ImageBitmap`: rasterized to `ImageData` (OffscreenCanvas / skia-canvas).
   * - Encoded bytes (PNG/JPEG): decoded to `ImageData`.
   * - Raw pixel bytes: wrapped as a {@link RawFrame} using the inner shape's
   *   width/height/channels.
   */
  private async toReadable(frame: VideoFrame): Promise<ImageData | RawFrame> {
    if (isImageBitmap(frame)) {
      return rasterizeBitmap(frame as ImageBitmap);
    }
    if (isImageDataLike(frame)) {
      return frame as unknown as ImageData;
    }
    // Raw bytes (Uint8Array or ArrayBuffer) from a Node backend: either
    // undecoded encoded frames or raw interleaved pixel data.
    const bytes =
      frame instanceof ArrayBuffer ? new Uint8Array(frame) : (frame as Uint8Array);
    if (isEncodedBytes(bytes)) {
      return decodeEncoded(bytes);
    }
    // Raw pixel buffer: reconstruct dimensions from the inner's shape.
    const innerShape = this.inner.shape;
    if (!innerShape) {
      throw new Error(
        "CropVideoBackend.getFrame received raw pixel bytes but the inner " +
          "backend has no resolved shape to interpret them. Provide a shape on " +
          "the inner backend, or use a backend that returns decoded frames."
      );
    }
    const [, height, width, channels] = innerShape;
    const raw: RawFrame = {
      data: bytes,
      width,
      height,
      channels,
    };
    return raw;
  }

  /** Inner backend's per-frame presentation times (delegated; a crop is spatial). */
  async getFrameTimes(): Promise<number[] | null> {
    if (typeof this.inner.getFrameTimes === "function") {
      return this.inner.getFrameTimes();
    }
    return null;
  }

  /**
   * Map source-frame `(x, y)` coordinates into the cropped frame.
   *
   * Translates by `-(x1, y1)` (copy-based, NaN-preserving). Accepts a flat
   * interleaved buffer or an array of `[x, y]` pairs and returns the same kind.
   */
  toCropCoords<T extends FlatPoints>(points: T): T;
  toCropCoords(points: PointPairs): [number, number][];
  toCropCoords(
    points: FlatPoints | PointPairs
  ): FlatPoints | [number, number][] {
    return cropPoints(points as FlatPoints, this.crop);
  }

  /**
   * Map cropped-frame `(x, y)` coordinates back to source coordinates.
   *
   * Inverse of {@link toCropCoords}: translates by `+(x1, y1)` (copy-based,
   * NaN-preserving).
   */
  toSourceCoords<T extends FlatPoints>(points: T): T;
  toSourceCoords(points: PointPairs): [number, number][];
  toSourceCoords(
    points: FlatPoints | PointPairs
  ): FlatPoints | [number, number][] {
    return uncropPoints(points as FlatPoints, this.crop);
  }

  /**
   * Release this wrapper's handle and the inner's, if owned.
   *
   * Cascades to `inner.close()` only when {@link ownsInner} (a shared-decode
   * mosaic tile leaves the shared inner open for its siblings).
   */
  close(): void {
    if (this.ownsInner) {
      this.inner.close();
    }
  }
}
