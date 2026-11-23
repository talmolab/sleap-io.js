/**
 * The image format embedded frames are stored in (`imageFormat` /
 * `imageQuality` of the SLP writers), as Python sleap-io's `image_format` /
 * `image_quality`: option checks, and turning one frame into the bytes stored
 * for it.
 *
 * With an explicit format, a frame already encoded in that format that needs
 * no red/blue swap is stored verbatim (image files, or encoded bytes a backend
 * returns); everything else is decoded to RGB and encoded in the format.
 * Without one, the writers keep the format they always used (see
 * `planEmbedding`).
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
  encodedChannelCount,
  isEncodedBytes,
  needsRedBlueSwap,
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
    encodedChannelCount(bytes) !== 1
  ) {
    return null;
  }
  return bytes;
}

/**
 * Encoded bytes a backend returned that can be stored verbatim: already in
 * the chosen format, needing no red/blue swap (`needsRedBlueSwap`: RGB, or a
 * BGR image without 3 colour channels, as Python reads it), and one channel
 * for a grayscale video. Null when they must be decoded and encoded.
 */
export function verbatimEncodedBytes(
  bytes: Uint8Array,
  channelOrder: string | undefined,
  encoding: EmbedEncoding,
): Uint8Array | null {
  if (sniffImageFormat(bytes) !== encoding.format) return null;
  if (needsRedBlueSwap(bytes, channelOrder)) return null;
  if (encoding.gray && encodedChannelCount(bytes) !== 1) return null;
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
 * its alpha; `gray` keeps the first channel only (as a grayscale read).
 * Pixels must already be RGB: the shared decoder (`decodeEncoded`,
 * `toReadableFrame`) applies the stored channel order.
 */
export function framePixels(
  img: ImageData | RawFrame,
  { gray = false }: { gray?: boolean } = {},
): { data: Uint8Array; width: number; height: number; channels: number } {
  const { width, height } = img;
  const n = width * height;
  const src = img.data;
  const explicit = "channels" in img ? img.channels : undefined;
  const channels = explicit ?? (src.length === n * 4 ? 4 : src.length / n);
  const rgba = explicit === undefined && channels === 4;
  const outCh = gray ? 1 : rgba ? 3 : channels;
  if (outCh === channels) {
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
 * Encoded 3-channel colour bytes stored BGR are swapped to RGB as they are
 * decoded (`decodeEncoded`); gray and alpha images are not swapped.
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
    // Decoded to RGB (a BGR colour image is swapped before any grayscale
    // collapse, so a grayscale read keeps R, as Python reads it).
    return encodePixels(
      framePixels(await decodeEncoded(bytes, channelOrder), {
        gray: encoding.gray,
      }),
      encoding.format,
      encoding.quality,
    );
  }
  const readable = await toReadableFrame(frame, rawShape, channelOrder);
  return encodePixels(
    framePixels(readable, { gray: encoding.gray }),
    encoding.format,
    encoding.quality,
  );
}
