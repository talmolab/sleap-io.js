/**
 * Frame-level crop transform for virtual cropping.
 *
 * Ported from Python `sleap_io/transform/frame.py` ({@link crop_frame}). Crops a
 * decoded frame to a rectangle, padding any out-of-bounds region with a fill
 * value (the OOB region is padded, NOT clamped — pixels outside the source are
 * the fill value, not the nearest edge pixel).
 *
 * This function is PURE and synchronous: it reads pixels directly. It therefore
 * cannot accept a raw `ImageBitmap` (whose pixels are not synchronously
 * readable) and throws a clear error if given one — the video backend is
 * responsible for rasterizing an `ImageBitmap` to `ImageData` first.
 *
 * Browser-safe: no Node-only imports.
 */

import type { CropRect } from "./points.js";

/**
 * A raw pixel buffer with explicit dimensions and channel count. Channels are
 * interleaved (e.g. `[r, g, b, a, r, g, b, ...]` for `channels: 4`, or a single
 * lane per pixel for grayscale `channels: 1`). `channels` defaults to 1.
 */
export interface RawFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels?: number;
}

/**
 * Anything {@link cropFrame} can read pixels from: a browser `ImageData`
 * (always 4-channel RGBA) or a {@link RawFrame} with a threaded channel count.
 */
export type FrameLike = ImageData | RawFrame;

/**
 * Per-pixel fill for out-of-bounds regions: a single scalar applied to every
 * channel, or one value per channel.
 */
export type Fill = number | number[];

/** Detect a browser `ImageData` (4-channel RGBA, `colorSpace` present). */
function isImageData(frame: FrameLike): frame is ImageData {
  // `ImageData` is the only FrameLike without an own `channels` field; it is
  // always 4-channel RGBA. Duck-type rather than relying on a global ctor that
  // may be absent in Node.
  return (frame as RawFrame).channels === undefined;
}

/** Detect a raw `ImageBitmap` (opaque GPU handle; pixels not readable here). */
function isImageBitmap(value: unknown): boolean {
  if (
    typeof ImageBitmap !== "undefined" &&
    value instanceof (ImageBitmap as unknown as { new (): object })
  ) {
    return true;
  }
  // Fallback duck-type: an ImageBitmap exposes width/height + close() but no
  // readable `data` buffer.
  const v = value as { width?: unknown; height?: unknown; close?: unknown; data?: unknown };
  return (
    v != null &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.close === "function" &&
    v.data === undefined
  );
}

/** Resolve the (data, width, height, channels) tuple for any `FrameLike`. */
function frameInfo(frame: FrameLike): {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
} {
  if (isImageData(frame)) {
    return {
      data: frame.data,
      width: frame.width,
      height: frame.height,
      channels: 4,
    };
  }
  return {
    data: frame.data,
    width: frame.width,
    height: frame.height,
    channels: frame.channels ?? 1,
  };
}

/** Expand a scalar/array fill into a per-channel array of length `channels`. */
function resolveFill(fill: Fill, channels: number): number[] {
  if (Array.isArray(fill)) {
    // Always return a fresh array (defensive copy) so callers can never mutate
    // the caller-supplied fill, matching the other branches below.
    if (fill.length === channels) return [...fill];
    if (fill.length === 1) return new Array(channels).fill(fill[0]);
    // Pad/truncate to the channel count (extra channels reuse the last value).
    const out = new Array<number>(channels);
    for (let c = 0; c < channels; c++) {
      out[c] = c < fill.length ? fill[c] : fill[fill.length - 1] ?? 0;
    }
    return out;
  }
  return new Array<number>(channels).fill(fill);
}

/**
 * Wrap a raw RGBA buffer as an `ImageData` when a global constructor exists,
 * else return a duck-typed `ImageData`-shaped object (consumers read only
 * `width`/`height`/`data`). Mirrors the synchronous half of seq-video's
 * `makeImageData`.
 */
function asImageData(
  data: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number
): ImageData {
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { ImageData?: unknown }).ImageData !== "undefined"
  ) {
    return new ImageData(data, width, height);
  }
  return { data, width, height, colorSpace: "srgb" } as unknown as ImageData;
}

/**
 * Crop a decoded frame to `crop`, padding out-of-bounds regions with `fill`.
 *
 * Mirrors Python `crop_frame`: the source rectangle is clamped to the frame
 * bounds (so a crop lying wholly off one axis yields an empty source slice
 * rather than a negative extent), an output buffer of the cropped size is
 * allocated and filled with `fill`, and the valid source slice is pasted at
 * `(srcX1 - x1, srcY1 - y1)`. The channel count is preserved from the input.
 *
 * @param frame Decoded source frame (`ImageData` RGBA or a {@link RawFrame}).
 *   A raw `ImageBitmap` is rejected — rasterize it first.
 * @param crop Crop region `[x1, y1, x2, y2]` (x2/y2 exclusive).
 * @param fill OOB pad value (scalar applied to all channels, or per-channel).
 * @returns For an `ImageData` input, an `ImageData`-shaped RGBA result; for a
 *   {@link RawFrame} input, a {@link RawFrame} with the same channel count.
 */
export function cropFrame(frame: ImageData, crop: CropRect, fill?: Fill): ImageData;
export function cropFrame(frame: RawFrame, crop: CropRect, fill?: Fill): RawFrame;
export function cropFrame(
  frame: FrameLike,
  crop: CropRect,
  fill: Fill = 0
): ImageData | RawFrame {
  if (isImageBitmap(frame)) {
    throw new Error(
      "cropFrame cannot crop a raw ImageBitmap: its pixels are not synchronously " +
        "readable. Rasterize it to an ImageData (e.g. via OffscreenCanvas or " +
        "skia-canvas) before cropping. This is handled by CropVideoBackend.getFrame."
    );
  }

  const { data, width: w, height: h, channels } = frameInfo(frame);
  const [x1, y1, x2, y2] = crop;
  const cropW = x2 - x1;
  const cropH = y2 - y1;

  // Valid source region. Clamp the upper bounds to the lower bounds so a crop
  // wholly beyond the frame on an axis yields an empty (not negative) extent.
  const srcX1 = Math.max(0, x1);
  const srcY1 = Math.max(0, y1);
  const srcX2 = Math.max(srcX1, Math.min(w, x2));
  const srcY2 = Math.max(srcY1, Math.min(h, y2));

  const fills = resolveFill(fill, channels);
  const needsPad = x1 < 0 || y1 < 0 || x2 > w || y2 > h;

  const outLen = cropW * cropH * channels;
  // Match the source buffer kind so ImageData stays Uint8ClampedArray-backed.
  const out =
    data instanceof Uint8ClampedArray
      ? new Uint8ClampedArray(outLen)
      : new Uint8Array(outLen);

  if (needsPad) {
    // Fill the whole output with the pad value, then paste the source slice.
    for (let i = 0; i < outLen; i += channels) {
      for (let c = 0; c < channels; c++) out[i + c] = fills[c];
    }
  }

  const pasteX1 = srcX1 - x1;
  const pasteY1 = srcY1 - y1;
  const sliceW = srcX2 - srcX1;
  const sliceH = srcY2 - srcY1;

  for (let row = 0; row < sliceH; row++) {
    const srcRowStart = ((srcY1 + row) * w + srcX1) * channels;
    const dstRowStart = ((pasteY1 + row) * cropW + pasteX1) * channels;
    const rowLen = sliceW * channels;
    out.set(data.subarray(srcRowStart, srcRowStart + rowLen), dstRowStart);
  }

  if (isImageData(frame)) {
    return asImageData(out as Uint8ClampedArray<ArrayBuffer>, cropW, cropH);
  }
  return { data: out, width: cropW, height: cropH, channels };
}
