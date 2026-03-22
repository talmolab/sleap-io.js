import { VideoBackend } from "./backend.js";
import { Hdf5VideoBackend } from "./hdf5-video.js";
import { MediaVideoBackend } from "./media-video.js";
import { Mp4BoxVideoBackend } from "./mp4box-video.js";
import { MediaBunnyVideoBackend } from "./mediabunny-video.js";
import { openH5File } from "../codecs/slp/h5.js";

/** Supported video backend identifiers for user selection. */
export type VideoBackendType = "mp4box" | "mediabunny" | "media";

/** File extensions that MediaBunny handles (non-MP4 formats). */
const MEDIABUNNY_EXTENSIONS = ["webm", "mkv", "ogg", "mov", "mpeg", "avi"];

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
