import { VideoBackend } from "./backend.js";
import { Hdf5VideoBackend } from "./hdf5-video.js";
import { MediaVideoBackend } from "./media-video.js";
import { Mp4BoxVideoBackend } from "./mp4box-video.js";
import { MediaBunnyVideoBackend } from "./mediabunny-video.js";
import { SeqVideoBackend } from "./seq-video.js";
import { openH5File } from "../codecs/slp/h5.js";

/** Supported video backend identifiers for user selection. */
export type VideoBackendType = "mp4box" | "mediabunny" | "media";

/**
 * File extensions that MediaBunny handles (non-MP4 formats). `ts` is MPEG-TS,
 * which MediaBunny demuxes (its typical H.264/H.265 payload is WebCodecs-decodable);
 * `.mpeg`/`.mpg` (MPEG program streams) and `.avi` are NOT here — MediaBunny has no
 * demuxer for them (see {@link UnsupportedVideoFormatError} and UNSUPPORTED_EXTENSIONS).
 */
const MEDIABUNNY_EXTENSIONS = ["webm", "mkv", "ogg", "mov", "ts"];

/**
 * File extensions no web video backend can decode. AVI has no demuxer in
 * MediaBunny, and AVI/MPEG payloads (MJPEG, Xvid/DivX, MPEG-1/2) are not
 * WebCodecs-decodable; routing them anywhere produces an opaque mid-decode
 * failure, so we reject them up front instead. Real support would need an
 * ffmpeg-class path (ffmpeg.wasm in the browser, or a native ffmpeg sidecar on
 * desktop) — tracked separately. Transcode to MP4 (H.264) as a workaround.
 */
const UNSUPPORTED_EXTENSIONS = ["avi", "mpeg", "mpg"];

/**
 * Thrown when a video file's container/codec cannot be decoded by any available
 * web backend (e.g. `.avi`, `.mpeg`, `.mpg`). This is a clean, catchable signal
 * so callers can show an actionable "unsupported format" message instead of
 * letting a backend fail opaquely mid-decode. Transcode to MP4 (H.264) first.
 */
export class UnsupportedVideoFormatError extends Error {
  /** The offending file extension (without the leading dot), e.g. `"avi"`. */
  readonly extension: string;

  constructor(extension: string) {
    super(
      `Unsupported video format ".${extension}". AVI and MPEG program streams ` +
        `cannot be decoded in the browser or desktop app. Transcode to MP4 (H.264) ` +
        `first, e.g. \`ffmpeg -i input.${extension} -c:v libx264 output.mp4\`.`
    );
    this.name = "UnsupportedVideoFormatError";
    this.extension = extension;
    // Restore the prototype chain so `instanceof` holds even under older
    // transpile targets (matches MergeError/SkeletonMismatchError convention).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export async function createVideoBackend(
  source: string | File | Blob,
  options?: {
    dataset?: string;
    embedded?: boolean;
    frameNumbers?: number[];
    frameSizes?: number[];
    format?: string;
    channelOrder?: string;
    shape?: [number, number, number, number];
    fps?: number;
    backend?: VideoBackendType;
  }
): Promise<VideoBackend> {
  const isBlob = typeof Blob !== "undefined" && source instanceof Blob;
  const filename = isBlob
    ? (source as File).name ?? ""
    : (source as string);
  const normalized = filename.split("?")[0]?.toLowerCase() ?? "";
  const ext = normalized.split(".").pop() ?? "";

  // HDF5/SLP files always use the HDF5 backend (not overridable)
  if (options?.embedded || ext === "slp" || ext === "h5" || ext === "hdf5") {
    const { file } = await openH5File(isBlob ? (source as File) : filename);
    const datasetPath = options?.dataset ?? "";
    return new Hdf5VideoBackend({
      filename,
      file,
      datasetPath,
      frameNumbers: options?.frameNumbers,
      frameSizes: options?.frameSizes,
      format: options?.format,
      channelOrder: options?.channelOrder,
      shape: options?.shape,
      fps: options?.fps,
    });
  }

  // Norpix .seq files use the dedicated SeqVideo backend (not overridable; no
  // other backend can read the format).
  if (ext === "seq") {
    return SeqVideoBackend.create(source);
  }

  // User-specified backend override
  if (options?.backend === "mediabunny") {
    if (isBlob) return MediaBunnyVideoBackend.fromBlob(source as Blob, filename);
    return MediaBunnyVideoBackend.fromUrl(filename);
  }
  if (options?.backend === "mp4box") {
    return new Mp4BoxVideoBackend(source);
  }
  if (options?.backend === "media") {
    if (isBlob) return new MediaVideoBackend(URL.createObjectURL(source as Blob));
    return new MediaVideoBackend(filename);
  }

  // Formats no web backend can decode: fail loudly with a clean, catchable
  // error rather than silently routing them to a backend that chokes mid-decode.
  // (Explicit `backend` overrides above are honored as an escape hatch.)
  if (UNSUPPORTED_EXTENSIONS.includes(ext)) {
    throw new UnsupportedVideoFormatError(ext);
  }

  // Auto-select by format
  const supportsWebCodecs =
    typeof window !== "undefined" &&
    typeof window.VideoDecoder !== "undefined" &&
    typeof window.EncodedVideoChunk !== "undefined";

  // MP4: prefer Mp4Box (better sequential performance)
  if (supportsWebCodecs && ext === "mp4") {
    return new Mp4BoxVideoBackend(source);
  }

  // Non-MP4 video formats: use MediaBunny
  if (supportsWebCodecs && MEDIABUNNY_EXTENSIONS.includes(ext)) {
    if (isBlob) return MediaBunnyVideoBackend.fromBlob(source as Blob, filename);
    return MediaBunnyVideoBackend.fromUrl(filename);
  }

  // Fallback: HTML5 video element
  if (isBlob) return new MediaVideoBackend(URL.createObjectURL(source as Blob));
  return new MediaVideoBackend(filename);
}
