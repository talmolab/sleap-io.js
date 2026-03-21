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
  filename: string,
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
  // HDF5/SLP files always use the HDF5 backend (not overridable)
  if (options?.embedded || filename.endsWith(".slp") || filename.endsWith(".h5") || filename.endsWith(".hdf5")) {
    const { file } = await openH5File(filename);
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
    return MediaBunnyVideoBackend.fromUrl(filename);
  }
  if (options?.backend === "mp4box") {
    return new Mp4BoxVideoBackend(filename);
  }
  if (options?.backend === "media") {
    return new MediaVideoBackend(filename);
  }

  // Auto-select by format
  const supportsWebCodecs =
    typeof window !== "undefined" &&
    typeof window.VideoDecoder !== "undefined" &&
    typeof window.EncodedVideoChunk !== "undefined";

  const normalized = filename.split("?")[0]?.toLowerCase() ?? "";
  const ext = normalized.split(".").pop() ?? "";

  // MP4: prefer Mp4Box (better sequential performance)
  if (supportsWebCodecs && ext === "mp4") {
    return new Mp4BoxVideoBackend(filename);
  }

  // Non-MP4 video formats: use MediaBunny
  if (supportsWebCodecs && MEDIABUNNY_EXTENSIONS.includes(ext)) {
    return MediaBunnyVideoBackend.fromUrl(filename);
  }

  // Fallback: HTML5 video element
  return new MediaVideoBackend(filename);
}
