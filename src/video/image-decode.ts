// src/video/image-decode.ts
//
// Shared image decode/rasterize helpers, used by `CropVideoBackend` (to
// rasterize/decode inner frames before cropping), `GrayscaleVideoBackend` (to
// normalize inner frames before collapsing channels), `ImageVideoBackend`
// (to decode each image-sequence frame), and the embedded HDF5 backends (to
// decode stored frames in a browser).
//
// Channel order: embedded frames may be stored with "BGR" channel order (the
// `channel_order` attribute; files below format 1.4 default to BGR). This
// module owns the red/blue swap: every decode here that is given a stored
// channel order returns RGB pixels. A frame a backend hands out still encoded
// (or as raw pixel bytes) is in its stored order
// (`VideoBackend.embeddedChannelOrder`); a decoded frame (`ImageBitmap`,
// `ImageData`) is always RGB, so it is never swapped again.
//
// Browser-safe: this module never statically imports a Node-only decoder.
// Decoding/rasterizing uses `createImageBitmap` + `OffscreenCanvas` when
// available (browser) else a lazy dynamic `import("skia-canvas")` (Node),
// exactly like `seq-video.ts`. Bundlers must keep `skia-canvas` external.

import type { VideoFrame } from "./backend.js";
import type { RawFrame } from "../transform/frame.js";
import { encodePngPixels } from "./png-encode.js";

/** Whether a stored channel order is BGR (case-insensitive). */
export function isBgrOrder(channelOrder: string | null | undefined): boolean {
  return (
    typeof channelOrder === "string" && channelOrder.toUpperCase() === "BGR"
  );
}

/**
 * Swap the red and blue channels in place on interleaved pixels with
 * `channels` values per pixel (RGBA `ImageData` is `channels = 4`). A no-op for
 * fewer than 3 channels, which have no red/blue to swap.
 */
export function swapRedBlue(
  data: Uint8Array | Uint8ClampedArray,
  channels: number,
): void {
  if (channels < 3) return;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i];
    data[i] = data[i + 2];
    data[i + 2] = r;
  }
}

/** Rasterize an opaque `ImageBitmap` to RGBA `ImageData` (OffscreenCanvas / skia). */
export async function rasterizeBitmap(bitmap: ImageBitmap): Promise<ImageData> {
  // Browser: OffscreenCanvas.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context to rasterize a frame");
    }
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  }
  // Node: skia-canvas (lazy dynamic import; never statically bundled).
  try {
    const sc = await import("skia-canvas");
    const Canvas = (
      sc as unknown as { Canvas: new (w: number, h: number) => unknown }
    ).Canvas;
    const canvas = new Canvas(bitmap.width, bitmap.height) as {
      getContext: (t: string) => {
        drawImage: (i: unknown, x: number, y: number) => void;
        getImageData: (x: number, y: number, w: number, h: number) => ImageData;
      };
    };
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch (err) {
    throw new Error(
      "Rasterizing a frame returned as an ImageBitmap requires an image " +
        "rasterizer (a browser with OffscreenCanvas, or the optional " +
        "`skia-canvas` package on Node). " +
        `Original error: ${(err as Error).message}`,
    );
  }
}

/**
 * Detect an opaque `ImageBitmap` (its pixels are not synchronously readable
 * here). Duck-typed so it works cross-realm / on Node (where a browser-produced
 * bitmap is not an `instanceof` the local `ImageBitmap`). Mirrors the detector
 * in `crop-backend.ts`.
 */
export function isImageBitmapLike(value: unknown): boolean {
  if (
    typeof ImageBitmap !== "undefined" &&
    value instanceof (ImageBitmap as unknown as { new (): object })
  ) {
    return true;
  }
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
    v.data === undefined
  );
}

/** Detect an `ImageData`-shaped object (RGBA buffer with width/height). */
export function isImageDataLike(
  value: unknown,
): value is { data: Uint8ClampedArray; width: number; height: number } {
  const v = value as { data?: unknown; width?: unknown; height?: unknown };
  return (
    v != null &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    (v.data instanceof Uint8ClampedArray || v.data instanceof Uint8Array)
  );
}

/**
 * Encode a frame's raw pixels to PNG bytes, as Python sleap-io stores an
 * embedded frame. Used when embedding a frame that a backend returns as pixels
 * rather than pre-encoded bytes; the stored `format` for such frames MUST be
 * "png". Browser-safe, pure JS.
 *
 * An `ImageData` (RGBA by construction, real or a plain RGBA object) is stored
 * as a 3-channel RGB PNG: video frames have no alpha, and Python reads a PNG
 * back with exactly the channels it stores, so an RGBA PNG would come back as
 * a 4-channel image. A {@link RawFrame} keeps its own channel count, so
 * {@link GrayscaleVideoBackend}'s 1-channel frame becomes a grayscale PNG. (The
 * browser's canvas encoder isn't used: it can only write RGBA, and its
 * `putImageData` throws on anything but a real `ImageData`.)
 */
export async function encodeImageDataToPng(
  img: ImageData | RawFrame,
): Promise<Uint8Array> {
  const { data, width, height } = img;
  const explicit = "channels" in img ? img.channels : undefined;
  const pixels = width * height;
  if (explicit === undefined && data.length === pixels * 4) {
    const rgb = new Uint8Array(pixels * 3);
    for (let p = 0, i = 0, o = 0; p < pixels; p++, i += 4, o += 3) {
      rgb[o] = data[i];
      rgb[o + 1] = data[i + 1];
      rgb[o + 2] = data[i + 2];
    }
    return encodePngPixels(rgb, width, height, 3);
  }
  return encodePngPixels(data, width, height, explicit ?? data.length / pixels);
}

/**
 * Encode an opaque `ImageBitmap` to PNG bytes as Python sleap-io stores it (an
 * RGB PNG; see {@link encodeImageDataToPng}): rasterize it (OffscreenCanvas in
 * a browser, skia on Node), then encode. Browser-safe.
 */
export async function encodeBitmapToPng(
  bitmap: ImageBitmap,
): Promise<Uint8Array> {
  return encodeImageDataToPng(await rasterizeBitmap(bitmap));
}

/** PNG / JPEG magic-byte sniff for undecoded encoded frame bytes. */
export function isEncodedBytes(bytes: Uint8Array): boolean {
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
 * Normalize any {@link VideoFrame} into something a pure/sync pixel transform
 * (e.g. `cropFrame`, `grayscaleFrame`) can read pixels from: an `ImageData` or
 * a {@link RawFrame}, with RGB channel order.
 *
 * - `ImageData`-shaped: returned as-is (already RGB).
 * - `ImageBitmap`: rasterized to `ImageData` (OffscreenCanvas / skia-canvas).
 * - Encoded bytes (PNG/JPEG): decoded to `ImageData`, swapping red and blue
 *   when `channelOrder` is "BGR".
 * - Raw pixel bytes: wrapped as a {@link RawFrame} using `rawShape`'s
 *   width/height/channels (the `[frames, height, width, channels]` shape of
 *   the backend that produced `frame`); copied with red and blue swapped when
 *   `channelOrder` is "BGR" and there are at least 3 channels.
 *
 * @param channelOrder Stored channel order of the producing backend
 *   (`VideoBackend.embeddedChannelOrder`). Applies only to undecoded bytes.
 * @throws Error If `frame` is raw pixel bytes and no `rawShape` is given to
 *   interpret them.
 */
export async function toReadableFrame(
  frame: VideoFrame,
  rawShape?: [number, number, number, number],
  channelOrder?: string,
): Promise<ImageData | RawFrame> {
  if (isImageBitmapLike(frame)) {
    return rasterizeBitmap(frame as ImageBitmap);
  }
  if (isImageDataLike(frame)) {
    return frame as unknown as ImageData;
  }
  const bytes =
    frame instanceof ArrayBuffer
      ? new Uint8Array(frame)
      : (frame as Uint8Array);
  if (isEncodedBytes(bytes)) {
    return decodeEncoded(bytes, channelOrder);
  }
  if (!rawShape) {
    throw new Error(
      "toReadableFrame received raw pixel bytes but no shape was given to " +
        "interpret them. Provide the producing backend's resolved shape.",
    );
  }
  const [, height, width, channels] = rawShape;
  if (isBgrOrder(channelOrder) && channels >= 3) {
    const data = bytes.slice(0, width * height * channels);
    swapRedBlue(data, channels);
    return { data, width, height, channels };
  }
  return { data: bytes, width, height, channels };
}

/**
 * Decode encoded (PNG/JPEG/…) image bytes to RGBA `ImageData` (browser / skia).
 *
 * @param channelOrder Stored channel order of the bytes. "BGR" swaps red and
 *   blue after decoding so the result is RGB; anything else is left as is.
 */
export async function decodeEncoded(
  bytes: Uint8Array,
  channelOrder?: string,
): Promise<ImageData> {
  const img = await decodeEncodedPixels(bytes);
  if (isBgrOrder(channelOrder)) swapRedBlue(img.data, 4);
  return img;
}

/** Decode encoded image bytes to RGBA `ImageData` in their stored order. */
async function decodeEncodedPixels(bytes: Uint8Array): Promise<ImageData> {
  // Browser: createImageBitmap + OffscreenCanvas.
  if (
    typeof createImageBitmap !== "undefined" &&
    typeof OffscreenCanvas !== "undefined"
  ) {
    const safe = new Uint8Array(bytes);
    const bitmap = await createImageBitmap(new Blob([safe.buffer]));
    return rasterizeBitmap(bitmap);
  }
  // Node: skia-canvas loadImage. Wrap bytes in a Buffer so skia does not misread
  // a bare Uint8Array as a path.
  try {
    const sc = await import("skia-canvas");
    const src =
      typeof Buffer !== "undefined" ? Buffer.from(bytes) : (bytes as unknown);
    const img = await (
      sc as unknown as {
        loadImage: (b: unknown) => Promise<{ width: number; height: number }>;
      }
    ).loadImage(src);
    const Canvas = (
      sc as unknown as { Canvas: new (w: number, h: number) => unknown }
    ).Canvas;
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
      "Decoding undecoded JPEG/PNG image bytes requires an image decoder " +
        "(a browser, or the optional `skia-canvas` package on Node). " +
        `Original error: ${(err as Error).message}`,
    );
  }
}

/** Whether this runtime is a browser window (not Node, not a worker). */
function isBrowserWindow(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Browser decode of one stored embedded frame (the embedded HDF5 backends'
 * `getFrame`), returning RGB pixels: an `ImageBitmap` when the stored order is
 * RGB, else an `ImageData` with red and blue swapped.
 *
 * Returns `null` outside a browser window (Node, workers): the backend then
 * hands out the stored bytes, which {@link toReadableFrame} /
 * {@link decodeEncoded} decode given the backend's `embeddedChannelOrder`.
 */
export async function decodeEmbeddedImage(
  bytes: Uint8Array,
  format: string,
  channelOrder: string,
): Promise<VideoFrame | null> {
  if (!isBrowserWindow() || typeof createImageBitmap === "undefined") {
    return null;
  }
  const mime = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  if (!isBgrOrder(channelOrder)) return bitmap;

  // Images encoded by OpenCV are stored BGR: rasterize, then swap.
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  swapRedBlue(imageData.data, 4);
  return imageData;
}

/**
 * Browser expansion of one stored raw-pixel embedded frame to RGBA
 * `ImageData`, reading red and blue from their stored positions.
 *
 * Returns `null` outside a browser window, without a shape, or when the bytes
 * are shorter than the shape; the backend then hands out the stored bytes.
 */
export function decodeEmbeddedRaw(
  bytes: Uint8Array,
  shape: [number, number, number, number] | undefined,
  channelOrder: string,
): VideoFrame | null {
  if (!isBrowserWindow() || !shape) return null;
  const [, height, width, channels] = shape;
  if (!height || !width || !channels) return null;

  const expectedLength = height * width * channels;
  if (bytes.length < expectedLength) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const useBgr = isBgrOrder(channelOrder);

  for (let i = 0; i < width * height; i += 1) {
    const base = i * channels;
    const r = bytes[base + (useBgr ? 2 : 0)] ?? 0;
    const g = bytes[base + 1] ?? 0;
    const b = bytes[base + (useBgr ? 0 : 2)] ?? 0;
    const a = channels === 4 ? (bytes[base + 3] ?? 255) : 255;
    const out = i * 4;
    rgba[out] = r;
    rgba[out + 1] = g;
    rgba[out + 2] = b;
    rgba[out + 3] = a;
  }

  return new ImageData(rgba, width, height);
}
