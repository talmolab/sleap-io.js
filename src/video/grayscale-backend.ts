// src/video/grayscale-backend.ts
//
// Virtual, on-read grayscale-forcing wrapper for an inner `VideoBackend`.
//
// Port of Python sleap-io's grayscale handling, which lives on the
// `VideoBackend` base class itself (`sleap_io/io/video_reading.py`):
// `get_frame`/`get_frames` slice `img[..., [0]]` whenever `self.grayscale` is
// (or resolves to) `True`, and `grayscale=None` autodetects on the first frame
// read by comparing the first and last channel for equality, caching the
// result. The JS `VideoBackend` is a plain interface with no shared base-class
// `getFrame`, so this wrapper centralizes the behavior once instead of
// touching every concrete backend (`media-video.ts`, `mediabunny-video.ts`,
// `mp4box-video.ts`, `hdf5-video.ts`, `streaming-hdf5-video.ts`,
// `image-video.ts`, `seq-video.ts`) — mirroring how `crop-backend.ts` already
// centralizes cropping instead of touching every backend.
//
// Browser-safe: this module never statically imports a Node-only decoder (it
// delegates any such need to `image-decode.ts`'s `toReadableFrame`).

import type { VideoBackend, VideoFrame, GetFrameOptions } from "./backend.js";
import { grayscaleFrame, detectGrayscale } from "../transform/frame.js";
import { toReadableFrame } from "./image-decode.js";
import { CropVideoBackend } from "./crop-backend.js";

/** Options for {@link GrayscaleVideoBackend.wrap}. */
export interface GrayscaleWrapOptions {
  /**
   * The backend to wrap (may itself be a `CropVideoBackend`; never itself a
   * `GrayscaleVideoBackend` — {@link GrayscaleVideoBackend.wrap} unwraps and
   * replaces an existing grayscale layer instead of nesting).
   */
  inner: VideoBackend;
  /**
   * `true` forces every frame to 1 channel; `false` forces the inner's native
   * channel count (never collapses, even if the source is genuinely
   * grayscale); `null` autodetects on the first `getFrame` call and caches the
   * resolved value on {@link GrayscaleVideoBackend.grayscale}. Tri-state,
   * matching Python's `grayscale: bool | None` exactly.
   */
  grayscale: boolean | null;
}

/**
 * Virtual, on-read grayscale-forcing view of an inner {@link VideoBackend}.
 *
 * Implements the {@link VideoBackend} interface, reporting a channel-forced
 * `[F, H, W, 1]` shape once `grayscale` has resolved `true`: {@link getFrame}
 * decodes the inner frame, normalizes it to readable pixels via
 * {@link toReadableFrame} (rasterizing an opaque `ImageBitmap` / decoding
 * undecoded encoded bytes as needed — the same normalization
 * {@link "./crop-backend.js".CropVideoBackend} performs before cropping),
 * autodetects on first read when unresolved, then applies the pure
 * {@link grayscaleFrame} slice. The frame count and spatial dimensions are
 * unchanged (grayscale-forcing is a channel operation, not spatial or
 * temporal).
 *
 * Always construct via {@link GrayscaleVideoBackend.wrap} (never the raw
 * constructor) so the "inner is never a GrayscaleVideoBackend" invariant holds
 * by construction.
 *
 * Note on `grayscale: null` (autodetect): because `shape` is a synchronous
 * getter and JS has no equivalent of Python's blocking `img_shape` property
 * (which decodes a test frame inline), the autodetect resolution only happens
 * on the first `getFrame()` call — `shape`/`grayscale` read as "unresolved"
 * (the inner's native channel count) until then. This is the same general
 * async-vs-sync characteristic already present elsewhere in this port (e.g.
 * `ImageVideoBackend.create()` decodes frame 0 up front precisely so `shape`
 * is resolved by construction time when no `shape` is supplied).
 */
export class GrayscaleVideoBackend implements VideoBackend {
  /** Derived from `inner.filename`. */
  filename: string | string[];
  /**
   * The wrapped source backend. Decodes full frames; this wrapper collapses
   * their channels. Invariant: `inner` is never itself a
   * `GrayscaleVideoBackend` (enforced by {@link wrap}).
   */
  readonly inner: VideoBackend;
  /**
   * Resolved/requested grayscale state. `true`/`false` are fixed at
   * construction; `null` (autodetect) is mutated in place to the resolved
   * value by the first {@link getFrame} call — mirrors Python's
   * `self.grayscale` being written by `detect_grayscale()`.
   */
  grayscale: boolean | null;

  /**
   * Private-by-convention constructor: prefer {@link GrayscaleVideoBackend.wrap},
   * which enforces the "inner is never a GrayscaleVideoBackend" invariant.
   */
  private constructor(inner: VideoBackend, grayscale: boolean | null) {
    this.inner = inner;
    this.grayscale = grayscale;
    this.filename = inner.filename;
  }

  /**
   * Wrap `inner` in a grayscale-forcing view.
   *
   * If `inner` is already a `GrayscaleVideoBackend`, it is unwrapped first —
   * the new `grayscale` setting replaces the old one outright (any previously
   * resolved autodetect result is intentionally dropped in favor of the new
   * request), so wrapping never nests and always reflects the latest call.
   */
  static wrap(options: GrayscaleWrapOptions): GrayscaleVideoBackend {
    const inner =
      options.inner instanceof GrayscaleVideoBackend
        ? options.inner.inner
        : options.inner;
    return new GrayscaleVideoBackend(inner, options.grayscale);
  }

  /** Inner backend's dataset name (delegated; a grayscale wrapper is channel-only). */
  get dataset(): string | null | undefined {
    return this.inner.dataset;
  }

  /** Inner backend's frame rate (delegated). */
  get fps(): number | undefined {
    return this.inner.fps;
  }

  /** Inner backend's embedded frame numbers (delegated; channel-forcing is frame-preserving). */
  get frameNumbers(): number[] | undefined {
    return this.inner.frameNumbers;
  }

  /** Inner backend's embedded blob format (delegated). */
  get embeddedFormat(): string | undefined {
    return this.inner.embeddedFormat;
  }

  /** Inner backend's embedded blob channel order (delegated). */
  get embeddedChannelOrder(): string | undefined {
    return this.inner.embeddedChannelOrder;
  }

  /**
   * Raw stored blob for `frameNumber`, delegated to the inner backend
   * verbatim. The stored blob is the inner's un-collapsed encoding; a raw byte
   * consumer (e.g. re-embedding) is expected to decode it itself, same as for
   * an unwrapped backend.
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

  /** Inner backend's per-frame presentation times (delegated; channel-only wrapper). */
  async getFrameTimes(): Promise<number[] | null> {
    if (typeof this.inner.getFrameTimes === "function") {
      return this.inner.getFrameTimes();
    }
    return null;
  }

  /** Inner backend's first-frame liveness probe (delegated; defaults to `true` if absent). */
  async probeFirstFrame(): Promise<boolean> {
    if (typeof this.inner.probeFirstFrame === "function") {
      return this.inner.probeFirstFrame();
    }
    return true;
  }

  /**
   * Channel-forced shape `[F, H, W, C]`: `C` is `1` once `grayscale` has
   * resolved `true`, `3` when explicitly `false`, and the inner's own
   * declared channel count when unresolved (`null` — see the class-level note
   * on autodetect timing).
   *
   * Mirrors Python `VideoBackend.img_shape`, which unconditionally sets
   * `channels = 1` for `grayscale is True` and `channels = 3` for
   * `grayscale is False` — NOT the inner's own declared count in either case.
   * This matters because `false` must positively override an inner that
   * independently declares itself 1-channel (e.g. `ImageVideoBackend`'s own
   * construction-time autodetection): `Video.grayscale`'s getter is
   * shape-driven (`shape[-1] === 1`), so without this override, setting
   * `grayscale = false` on such a video would still read back as grayscale.
   *
   * Returns `undefined` only when the inner has no resolved shape.
   */
  get shape(): [number, number, number, number] | undefined {
    const innerShape = this.inner.shape;
    if (!innerShape) return undefined;
    if (this.grayscale === true) {
      return [innerShape[0], innerShape[1], innerShape[2], 1];
    }
    if (this.grayscale === false) {
      return [innerShape[0], innerShape[1], innerShape[2], 3];
    }
    return innerShape;
  }

  /**
   * Read a single frame, forcing or autodetecting grayscale.
   *
   * - `grayscale === false`: never collapse — the inner frame is returned
   *   untouched (no decode/normalize overhead).
   * - `grayscale === true`: always collapse to 1 channel via
   *   {@link grayscaleFrame}.
   * - `grayscale === null`: autodetect via {@link resolveAutodetect}, CACHE
   *   the resolved value onto `this.grayscale`, then collapse only if it
   *   resolved `true` — mirrors Python's `get_frame`:
   *   `if self.grayscale is None: self.detect_grayscale(img)`.
   *
   * Returns `null` when the inner returns `null` (no such frame).
   */
  async getFrame(
    frameIndex: number,
    opts?: GetFrameOptions,
  ): Promise<VideoFrame | null> {
    const src = await this.inner.getFrame(frameIndex, opts);
    if (src == null) return null;
    if (this.grayscale === false) return src;

    if (this.grayscale === null) {
      this.grayscale = await this.resolveAutodetect(frameIndex, opts, src);
    }
    if (!this.grayscale) return src;
    const readable = await toReadableFrame(src, this.inner.shape);
    return grayscaleFrame(readable) as unknown as VideoFrame;
  }

  /**
   * Resolve the `null` (autodetect) case for frame `frameIndex`.
   *
   * When `inner` is a {@link CropVideoBackend}, detection is run on the
   * FULL, UNCROPPED first frame (`inner.inner`, not `inner` itself) — a
   * degenerate or unusual crop region (e.g. a 1px-wide slice, or a region
   * that happens to look grayscale in isolation on an otherwise-color source)
   * must never skew the result. This mirrors Python's
   * `CropVideoBackend.detect_grayscale`, which explicitly "resolves grayscale
   * from the inner, ignoring any passed cropped image." For any other inner,
   * detection runs on `frameSrc` (already decoded by the caller) directly.
   */
  private async resolveAutodetect(
    frameIndex: number,
    opts: GetFrameOptions | undefined,
    frameSrc: VideoFrame,
  ): Promise<boolean> {
    if (this.inner instanceof CropVideoBackend) {
      const fullSrc = await this.inner.inner.getFrame(frameIndex, opts);
      if (fullSrc != null) {
        const fullReadable = await toReadableFrame(
          fullSrc,
          this.inner.inner.shape,
        );
        return detectGrayscale(fullReadable);
      }
    }
    const readable = await toReadableFrame(frameSrc, this.inner.shape);
    return detectGrayscale(readable);
  }

  /** Release this wrapper's handle by releasing the inner's (always cascades). */
  close(): void {
    this.inner.close();
  }
}
