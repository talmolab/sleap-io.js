import type { Video } from "./video.js";
import type { VideoFrame } from "../video/backend.js";
import { encodeJpegPixels } from "../video/jpeg-encode.js";
import { toReadableFrame } from "../video/image-decode.js";

/** Schema version stored in `/preview` group's `format_version` attribute. */
export const PREVIEW_FORMAT_VERSION = 1;

/** Default maximum long-edge dimension in pixels for preview thumbnails. */
export const DEFAULT_PREVIEW_MAX_SIZE = 768;

/** Default baseline JPEG quality (1-100) for preview thumbnails. */
export const DEFAULT_PREVIEW_QUALITY = 80;

export interface PreviewFrameOptions {
  video: Video;
  frameIdx: number;
  origWidth: number;
  origHeight: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Lightweight preview frame metadata returned by the zero-WASM lite reader
 * (`loadSlpPreview`), using a 0-based `videoIdx` into `videos_json`.
 */
export interface PreviewMetadata {
  videoIdx: number;
  frameIdx: number;
  origWidth: number;
  origHeight: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * A downscaled baseline JPEG preview frame stored in an SLP file's optional
 * `/preview` HDF5 group so external viewers (e.g. macOS Finder Quick Look) can
 * render video frames under vector pose overlays even when videos are linked
 * externally.
 */
export class PreviewFrame {
  video: Video;
  frameIdx: number;
  origWidth: number;
  origHeight: number;
  width: number;
  height: number;
  data: Uint8Array;

  constructor(options: PreviewFrameOptions) {
    this.video = options.video;
    this.frameIdx = Math.trunc(options.frameIdx);
    this.origWidth = Math.trunc(options.origWidth);
    this.origHeight = Math.trunc(options.origHeight);
    this.width = Math.trunc(options.width);
    this.height = Math.trunc(options.height);
    this.data = options.data;
  }
}

export interface EncodePreviewOptions {
  /** Maximum long-edge dimension in pixels (default 768). Never upscales. */
  maxSize?: number;
  /** Baseline JPEG quality 1-100 (default 80). */
  quality?: number;
}

/**
 * Area-average (box filter) downscaler for interleaved 8-bit pixels.
 * Preserves aspect ratio and never upscales.
 */
function downscaleArea(
  src: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  channels: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * channels);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = dy * scaleY;
    const sy1 = Math.min(srcH, (dy + 1) * scaleY);
    const iy0 = Math.floor(sy0);
    const iy1 = Math.min(srcH - 1, Math.ceil(sy1) - 1);

    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = dx * scaleX;
      const sx1 = Math.min(srcW, (dx + 1) * scaleX);
      const ix0 = Math.floor(sx0);
      const ix1 = Math.min(srcW - 1, Math.ceil(sx1) - 1);

      const dstBase = (dy * dstW + dx) * channels;
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        let weightSum = 0;
        for (let sy = iy0; sy <= iy1; sy++) {
          const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
          if (wy <= 0) continue;
          const rowOff = sy * srcW * channels;
          for (let sx = ix0; sx <= ix1; sx++) {
            const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
            if (wx <= 0) continue;
            const w = wx * wy;
            sum += src[rowOff + sx * channels + c] * w;
            weightSum += w;
          }
        }
        dst[dstBase + c] =
          weightSum > 0
            ? Math.min(255, Math.max(0, Math.round(sum / weightSum)))
            : 0;
      }
    }
  }
  return dst;
}

/**
 * Normalize interleaved 1/2/3/4-channel pixels to 1 (grayscale) or 3 (RGB),
 * collapsing RGB(A) images whose R=G=B channels are identical to 1-channel
 * grayscale for smaller JPEGs.
 */
function normalizePreviewChannels(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
): { data: Uint8Array; channels: 1 | 3 } {
  const n = width * height;
  if (channels === 1) {
    return {
      data:
        pixels instanceof Uint8Array
          ? pixels
          : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      channels: 1,
    };
  }
  if (channels === 2) {
    const gray = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 2) gray[p] = pixels[i];
    return { data: gray, channels: 1 };
  }

  // Check whether R === G === B for every pixel.
  let isGray = true;
  for (let p = 0, i = 0; p < n; p++, i += channels) {
    const r = pixels[i];
    if (pixels[i + 1] !== r || pixels[i + 2] !== r) {
      isGray = false;
      break;
    }
  }

  if (isGray) {
    const gray = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += channels) gray[p] = pixels[i];
    return { data: gray, channels: 1 };
  }

  if (channels === 3) {
    return {
      data:
        pixels instanceof Uint8Array
          ? pixels
          : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      channels: 3,
    };
  }

  const rgb = new Uint8Array(n * 3);
  for (let p = 0, i = 0, o = 0; p < n; p++, i += channels, o += 3) {
    rgb[o] = pixels[i];
    rgb[o + 1] = pixels[i + 1];
    rgb[o + 2] = pixels[i + 2];
  }
  return { data: rgb, channels: 3 };
}

/**
 * Downscale (aspect-preserving, never upscaling) and baseline-JPEG-encode raw
 * interleaved 8-bit pixels into a preview image.
 */
export function encodePreviewJpeg(
  pixels: Uint8Array | Uint8ClampedArray,
  origWidth: number,
  origHeight: number,
  channels: number,
  options?: EncodePreviewOptions,
): { width: number; height: number; data: Uint8Array } {
  const maxSize = options?.maxSize ?? DEFAULT_PREVIEW_MAX_SIZE;
  const quality = Math.min(
    100,
    Math.max(1, Math.trunc(options?.quality ?? DEFAULT_PREVIEW_QUALITY)),
  );

  const normalized = normalizePreviewChannels(
    pixels,
    origWidth,
    origHeight,
    channels,
  );
  let width = origWidth;
  let height = origHeight;
  let data = normalized.data;

  const longEdge = Math.max(origWidth, origHeight);
  if (maxSize > 0 && longEdge > maxSize) {
    const scale = maxSize / longEdge;
    width = Math.max(1, Math.round(origWidth * scale));
    height = Math.max(1, Math.round(origHeight * scale));
    data = downscaleArea(
      data,
      origWidth,
      origHeight,
      normalized.channels,
      width,
      height,
    );
  }

  const jpeg = encodeJpegPixels(
    data,
    width,
    height,
    normalized.channels,
    quality,
  );
  return { width, height, data: jpeg };
}

/**
 * Create a {@link PreviewFrame} from raw interleaved 8-bit pixels.
 */
export function createPreviewFrameFromPixels(
  video: Video,
  frameIdx: number,
  pixels: Uint8Array | Uint8ClampedArray,
  origWidth: number,
  origHeight: number,
  channels: number,
  options?: EncodePreviewOptions,
): PreviewFrame {
  const encoded = encodePreviewJpeg(
    pixels,
    origWidth,
    origHeight,
    channels,
    options,
  );
  return new PreviewFrame({
    video,
    frameIdx,
    origWidth,
    origHeight,
    width: encoded.width,
    height: encoded.height,
    data: encoded.data,
  });
}

/**
 * Create a {@link PreviewFrame} from any decoded or encoded {@link VideoFrame}
 * (`ImageData`, `ImageBitmap`, encoded PNG/JPEG bytes, or raw pixel bytes).
 */
export async function createPreviewFrameFromVideoFrame(
  video: Video,
  frameIdx: number,
  frame: VideoFrame,
  options?: EncodePreviewOptions & {
    channelOrder?: string;
    rawShape?: [number, number, number, number];
  },
): Promise<PreviewFrame> {
  const readable = await toReadableFrame(
    frame,
    options?.rawShape ?? video.shape ?? undefined,
    options?.channelOrder ?? video.backend?.embeddedChannelOrder,
  );
  const { width, height, data } = readable;
  const explicitCh = "channels" in readable ? readable.channels : undefined;
  const channels =
    explicitCh ??
    (data.length === width * height * 4 ? 4 : data.length / (width * height));
  return createPreviewFrameFromPixels(
    video,
    frameIdx,
    data,
    width,
    height,
    channels,
    options,
  );
}
