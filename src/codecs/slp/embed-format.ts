/**
 * The image format embedded frames are stored in (`imageFormat` /
 * `imageQuality` of the SLP writers), as Python sleap-io's `image_format` /
 * `image_quality`: option checks, and turning one frame into the bytes stored
 * for it.
 *
 * With an explicit format, a frame already encoded in that format with RGB
 * channels is stored verbatim (image files, or encoded bytes a backend
 * returns); everything else is decoded and encoded in the format. Without
 * one, the writers keep the format they always used (see `planEmbedding`).
 *
 * @module
 */
import type { VideoBackend, VideoFrame } from "../../video/backend.js";
import { GrayscaleVideoBackend } from "../../video/grayscale-backend.js";
import { ImageVideoBackend } from "../../video/image-video.js";
import { encodePngPixels } from "../../video/png-encode.js";
import { encodeJpegPixels } from "../../video/jpeg-encode.js";
import {
  decodeEncoded,
  isEncodedBytes,
  toReadableFrame,
} from "../../video/image-decode.js";
import type { RawFrame } from "../../transform/frame.js";

/** Formats new embeds can be stored in. `"jpeg"` is accepted as `"jpg"`. */
export type EmbedImageFormat = "png" | "jpg";

/** The stored names {@link checkEmbedImageFormat} accepts. */
export const EMBED_IMAGE_FORMATS: readonly EmbedImageFormat[] = ["png", "jpg"];

/**
 * Check and normalize the `imageFormat` / `imageQuality` options, as Python
 * sleap-io's `_check_embed_image_format`.
 *
 * @param imageFormat - `undefined`/`null` (the writers' default), `"png"`,
 *   `"jpg"` or `"jpeg"`, in any case.
 * @param imageQuality - `undefined`/`null` for the encoder default, a JPEG
 *   quality (0-100) with `"jpg"` or a PNG compression level (0-9) with
 *   `"png"`.
 * @returns `"png"`, `"jpg"`, or `null` when no format was given.
 * @throws Error If the format is not one of {@link EMBED_IMAGE_FORMATS}, or
 *   the quality is given without an explicit format or out of its range.
 */
export function checkEmbedImageFormat(
  imageFormat: string | null | undefined,
  imageQuality?: number | null,
): EmbedImageFormat | null {
  let format: string | null = null;
  if (imageFormat != null) {
    format = String(imageFormat).toLowerCase();
    if (format === "jpeg") format = "jpg";
    if (format === "hdf5") {
      throw new Error(
        'imageFormat "hdf5" (raw pixel arrays) is not supported by ' +
          'sleap-io.js; use "png" or "jpg".',
      );
    }
    if (!(EMBED_IMAGE_FORMATS as readonly string[]).includes(format)) {
      throw new Error(
        `imageFormat must be "png", "jpg" ("jpeg") or undefined, got ${JSON.stringify(imageFormat)}.`,
      );
    }
  }
  if (imageQuality != null) {
    const bounds =
      format === "jpg" ? [0, 100] : format === "png" ? [0, 9] : null;
    if (bounds === null) {
      throw new Error(
        'imageQuality needs imageFormat "jpg" (quality 0-100) or "png" ' +
          "(compression level 0-9).",
      );
    }
    const q = Number(imageQuality);
    if (
      !Number.isFinite(q) ||
      Math.trunc(q) < bounds[0] ||
      Math.trunc(q) > bounds[1]
    ) {
      throw new Error(
        `imageQuality for imageFormat "${format}" must be in ` +
          `[${bounds[0]}, ${bounds[1]}], got ${imageQuality}.`,
      );
    }
  }
  return format as EmbedImageFormat | null;
}

/** The integer encoder setting of a checked `imageQuality`, or null. */
export function embedQuality(imageQuality?: number | null): number | null {
  return imageQuality == null ? null : Math.trunc(Number(imageQuality));
}

/** "png" or "jpg" from encoded bytes' signature; null for anything else. */
export function sniffImageFormat(bytes: Uint8Array): EmbedImageFormat | null {
  if (!isEncodedBytes(bytes)) return null;
  return bytes[0] === 0xff ? "jpg" : "png";
}

/**
 * Channels an encoded PNG or JPEG decodes to, from its header (no decode):
 * the PNG colour type, or the JPEG frame header's component count. Null when
 * the header can't be read.
 */
export function encodedImageChannels(bytes: Uint8Array): number | null {
  const format = sniffImageFormat(bytes);
  if (format === "png") {
    if (bytes.length < 26) return null;
    return (
      ({ 0: 1, 2: 3, 3: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]] ??
      null
    );
  }
  if (format === "jpg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return bytes[i + 9];
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
  }
  return null;
}

/** How one video's frames are stored when a format was chosen. */
export interface EmbedEncoding {
  format: EmbedImageFormat;
  /** JPEG quality / PNG compression level; null for the encoder default. */
  quality: number | null;
  /** Store one channel: the video is grayscale (it records 1 channel). */
  gray: boolean;
}

/** True when a grayscale wrapper forces this backend's frames to one channel. */
function forcesGray(backend: VideoBackend): boolean {
  return backend instanceof GrayscaleVideoBackend && backend.grayscale === true;
}

/**
 * The encoded bytes of an image-sequence frame stored verbatim, as Python
 * sleap-io's byte copy of an `ImageVideo` file: when the file is already in
 * the chosen format (by its extension), and, for a grayscale video, has one
 * channel. Null otherwise (the frame is decoded and encoded instead). A
 * cropped video is never copied verbatim: its stored frames are re-encoded.
 */
export async function imageFileBytes(
  backend: VideoBackend | null | undefined,
  frameIdx: number,
  encoding: EmbedEncoding,
): Promise<Uint8Array | null> {
  if (!backend) return null;
  const inner =
    backend instanceof GrayscaleVideoBackend ? backend.inner : backend;
  if (!(inner instanceof ImageVideoBackend)) return null;
  const name = inner.filename[frameIdx];
  if (typeof name !== "string") return null;
  const ext = name.toLowerCase().split(/[?#]/)[0].split(".").pop() ?? "";
  const fileFormat = ext === "jpeg" ? "jpg" : ext;
  if (fileFormat !== encoding.format) return null;
  const bytes = await inner.getEncodedBytes(frameIdx);
  if (!bytes || bytes.length === 0) return null;
  if (sniffImageFormat(bytes) !== encoding.format) return null;
  if (
    (encoding.gray || forcesGray(backend)) &&
    encodedImageChannels(bytes) !== 1
  ) {
    return null;
  }
  return bytes;
}

/**
 * Encoded bytes a backend returned that can be stored verbatim: already in
 * the chosen format, RGB channel order, and one channel for a grayscale
 * video. Null when they must be decoded and encoded.
 */
export function verbatimEncodedBytes(
  bytes: Uint8Array,
  channelOrder: string | undefined,
  encoding: EmbedEncoding,
): Uint8Array | null {
  if (sniffImageFormat(bytes) !== encoding.format) return null;
  if ((channelOrder ?? "RGB").toUpperCase() !== "RGB") return null;
  if (encoding.gray && encodedImageChannels(bytes) !== 1) return null;
  return bytes;
}

/** View a frame as bytes when it is a byte buffer; null for pixel objects. */
export function frameBytes(frame: unknown): Uint8Array | null {
  if (frame instanceof Uint8Array) return frame;
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  if (ArrayBuffer.isView(frame)) {
    const view = frame as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

/**
 * Readable pixels of a frame, ready to encode: interleaved bytes with an
 * explicit channel count. RGBA (an `ImageData`, or decoded image bytes) loses
 * its alpha; `gray` keeps the first channel only (as a grayscale read);
 * `swapRB` turns BGR pixels into RGB.
 */
export function framePixels(
  img: ImageData | RawFrame,
  { gray = false, swapRB = false }: { gray?: boolean; swapRB?: boolean } = {},
): { data: Uint8Array; width: number; height: number; channels: number } {
  const { width, height } = img;
  const n = width * height;
  const src = img.data;
  const explicit = "channels" in img ? img.channels : undefined;
  const channels = explicit ?? (src.length === n * 4 ? 4 : src.length / n);
  const rgba = explicit === undefined && channels === 4;
  const outCh = gray ? 1 : rgba ? 3 : channels;
  // BGR pixels are swapped before a grayscale collapse, so a grayscale read
  // keeps R (the first channel of the RGB image), as Python reads it.
  const swap = swapRB && channels >= 3;
  if (outCh === channels && !swap) {
    return {
      data:
        src instanceof Uint8Array
          ? src
          : new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
      width,
      height,
      channels,
    };
  }
  const out = new Uint8Array(n * outCh);
  for (let p = 0, i = 0, o = 0; p < n; p++, i += channels, o += outCh) {
    for (let c = 0; c < outCh; c++) out[o + c] = src[i + c];
    if (swap) {
      out[o] = src[i + 2];
      if (outCh >= 3) out[o + 2] = src[i];
    }
  }
  return { data: out, width, height, channels: outCh };
}

/** Encode pixels from {@link framePixels} in `format`. */
export async function encodePixels(
  px: { data: Uint8Array; width: number; height: number; channels: number },
  format: EmbedImageFormat,
  quality: number | null,
): Promise<Uint8Array> {
  // A JPEG has no alpha: gray + alpha is stored gray, RGBA as colour.
  if (format === "jpg") {
    return encodeJpegPixels(px.data, px.width, px.height, px.channels, quality);
  }
  return encodePngPixels(px.data, px.width, px.height, px.channels, quality);
}

/**
 * The bytes to store for one frame when a format was chosen: verbatim when
 * the frame is encoded bytes already in that format (see
 * {@link verbatimEncodedBytes}), else its pixels encoded in the format.
 * Encoded bytes in BGR order are decoded and swapped to RGB first.
 *
 * @param rawShape - The producing backend's `[frames, height, width,
 *   channels]`, to read raw pixel bytes by.
 */
export async function encodeFrameAs(
  frame: VideoFrame,
  encoding: EmbedEncoding,
  {
    channelOrder,
    rawShape,
  }: {
    channelOrder?: string;
    rawShape?: [number, number, number, number];
  } = {},
): Promise<Uint8Array> {
  const bytes = frameBytes(frame);
  if (bytes && isEncodedBytes(bytes)) {
    const verbatim = verbatimEncodedBytes(bytes, channelOrder, encoding);
    if (verbatim) return verbatim;
    const decoded = await decodeEncoded(bytes);
    const swapRB = (channelOrder ?? "RGB").toUpperCase() === "BGR";
    return encodePixels(
      framePixels(decoded, { gray: encoding.gray, swapRB }),
      encoding.format,
      encoding.quality,
    );
  }
  const readable = await toReadableFrame(frame, rawShape);
  return encodePixels(
    framePixels(readable, { gray: encoding.gray }),
    encoding.format,
    encoding.quality,
  );
}
