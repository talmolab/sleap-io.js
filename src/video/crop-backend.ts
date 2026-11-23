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

import type { VideoBackend, VideoFrame, GetFrameOptions } from "./backend.js";
import { cropFrame, type Fill } from "../transform/frame.js";
import {
  cropPoints,
  uncropPoints,
  type CropRect,
  type FlatPoints,
  type PointPairs,
} from "../transform/points.js";
import { toReadableFrame } from "./image-decode.js";

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
    ownsInner: boolean,
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

  /** Inner backend's embedded blob format (delegated; a crop is spatial). */
  get embeddedFormat(): string | undefined {
    return this.inner.embeddedFormat;
  }

  /** Inner backend's embedded blob channel order (delegated). */
  get embeddedChannelOrder(): string | undefined {
    return this.inner.embeddedChannelOrder;
  }

  /**
   * Raw stored blob for `frameNumber`, delegated to the inner backend. The
   * stored blobs are the uncropped inner frames (the crop rides `/video_crops`),
   * so re-embedding copies the inner blobs verbatim.
   */
  getFrameBuffer(frameNumber: number): Promise<Uint8Array | null> {
    return this.inner.getFrameBuffer
      ? this.inner.getFrameBuffer(frameNumber)
      : Promise.resolve(null);
  }

  /** Deferred-metadata load, delegated to the inner backend (no-op if absent). */
  ensureLoaded(): Promise<void> {
    return this.inner.ensureLoaded?.() ?? Promise.resolve();
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
   * First attempts crop pushdown: if the inner backend implements the optional
   * {@link VideoBackend.readCrop} hook (Item 1 of JS issue #153, mirroring
   * Python `_source_frame`, `video_reading.py:2392`) it is given the chance to
   * read only the crop region directly from storage. A non-null result is
   * already cropped/padded and is byte-identical to the fallback, so it is
   * returned as-is. `null` (the default for every shipping backend — encoded
   * blobs / per-frame rows cannot be spatially hyperslabbed) means fall back.
   *
   * Fallback: decode the inner full frame, normalize it to readable RGB pixels
   * (rasterizing an opaque `ImageBitmap`, decoding undecoded encoded bytes, or
   * wrapping raw pixel bytes, in the inner's `embeddedChannelOrder`), then
   * apply {@link cropFrame} with this wrapper's crop/fill. Returns `null` when
   * the inner returns `null` (no such frame).
   */
  async getFrame(
    frameIndex: number,
    opts?: GetFrameOptions,
  ): Promise<VideoFrame | null> {
    if (typeof this.inner.readCrop === "function") {
      const pushed = await this.inner.readCrop(
        frameIndex,
        this.crop,
        this.fill,
      );
      // Non-null is already cropped/padded (byte-identical to the fallback).
      if (pushed != null) return pushed as unknown as VideoFrame;
    }
    const src = await this.inner.getFrame(frameIndex, opts);
    if (src == null) return null;
    const readable = await toReadableFrame(
      src,
      this.inner.shape,
      this.inner.embeddedChannelOrder,
    );
    return cropFrame(readable as ImageData, this.crop, this.fill);
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
    points: FlatPoints | PointPairs,
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
    points: FlatPoints | PointPairs,
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
