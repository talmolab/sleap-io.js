import { Labels } from "../model/labels.js";
import { LabelsSet } from "../model/labels-set.js";
import { Video } from "../model/video.js";
import { readSlp, readSlpLazy } from "../codecs/slp/read.js";
import { readSlpStreaming } from "../codecs/slp/read-streaming.js";
import { writeSlp, saveSlpToBytes } from "../codecs/slp/write.js";
import { createVideoBackend, VideoBackendType } from "../video/factory.js";
import {
  OpenH5Options,
  SlpSource,
  isStreamingSupported,
} from "../codecs/slp/h5.js";
import { redactedCauseSummary } from "./remote.js";
import {
  readLabels as readAnalysisH5,
  writeLabels as writeAnalysisH5,
} from "./analysis-h5.js";

// TIFF label-image reader (browser-safe core; Node path reading is registered
// via the side-effect import of ./label-images-node.js in the Node entry).
export {
  loadLabelImages,
  setLabelImageFileReader,
  type PagesAs,
  type LoadLabelImagesOptions,
  type LabelImageFileReader,
} from "./label-images.js";

function isNode(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function isBrowserWithWorkerSupport(): boolean {
  return typeof window !== "undefined" && isStreamingSupported();
}

/**
 * Load a SLEAP labels file (.slp).
 *
 * Automatically selects the best loading strategy:
 * - Browser with Worker support: uses streaming reader via Web Worker
 * - Node.js or fallback: uses standard HDF5 reader
 *
 * @param source - Path to .slp file, ArrayBuffer, Uint8Array, File, or FileSystemFileHandle
 * @param options - Loading options
 * @param options.openVideos - Whether to open video backends (default: true)
 * @param options.h5 - HDF5 opening options (stream mode, filename hint)
 * @param options.lazy - If true, use lazy loading for on-demand frame materialization (default: false)
 * @param options.onProgress - Optional callback fired as loading advances through
 *   its stages: (current, total, message?), where current/total count completed
 *   stages and message labels the stage about to run. Emitted by all reader
 *   paths (streaming, eager, and lazy); the final call is (total, total,
 *   "Finalizing"). Stage counts differ by path (streaming is finer-grained).
 * @returns Loaded Labels object
 */
export async function loadSlp(
  source: SlpSource,
  options?: {
    openVideos?: boolean;
    h5?: OpenH5Options;
    lazy?: boolean;
    onProgress?: (current: number, total: number, message?: string) => void;
  },
): Promise<Labels> {
  const streamMode = options?.h5?.stream ?? "auto";
  const openVideos = options?.openVideos ?? true;
  const lazy = options?.lazy ?? false;

  if (isBrowserWithWorkerSupport() && !isNode() && streamMode !== "download") {
    let streamingSource: string | ArrayBuffer | Uint8Array | File;

    if (typeof source === "string") {
      streamingSource = source;
    } else if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      streamingSource = source;
    } else if (typeof File !== "undefined" && source instanceof File) {
      streamingSource = source;
    } else if (
      typeof FileSystemFileHandle !== "undefined" &&
      "getFile" in source
    ) {
      streamingSource = await (source as FileSystemFileHandle).getFile();
    } else {
      streamingSource = null as unknown as File;
    }

    if (streamingSource !== null) {
      try {
        return await readSlpStreaming(streamingSource, {
          filenameHint: options?.h5?.filenameHint,
          headers: options?.h5?.headers,
          h5wasmUrl: options?.h5?.h5wasmUrl,
          openVideos,
          onProgress: options?.onProgress,
          lazy,
        });
      } catch (e) {
        if (streamMode === "auto") {
          // Redact: the raw error can embed ?token= / userinfo (a remote URL).
          console.warn(
            "[sleap-io] Worker-based loading failed, falling back to main thread:",
            redactedCauseSummary(e),
          );
        } else {
          throw e;
        }
      }
    }
  }

  // Fall back to standard reader (Node.js, or browser without Worker support, or download mode)
  if (lazy) {
    return readSlpLazy(source, {
      openVideos,
      h5: options?.h5,
      onProgress: options?.onProgress,
    });
  }
  return readSlp(source, {
    openVideos,
    h5: options?.h5,
    onProgress: options?.onProgress,
  });
}

/**
 * Save labels to a SLEAP labels file (.slp).
 *
 * @param labels - Labels object to save
 * @param filename - Output file path
 * @param options - Save options
 * @param options.embed - Embed video frames: true/"all", "user", "suggestions", "user+suggestions"
 * @param options.restoreOriginalVideos - Restore source video paths on save (default: true)
 */
export async function saveSlp(
  labels: Labels,
  filename: string,
  options?: {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
  },
): Promise<void> {
  await writeSlp(filename, labels, {
    embed: options?.embed ?? false,
    restoreOriginalVideos: options?.restoreOriginalVideos ?? true,
  });
}

export { saveSlpToBytes } from "../codecs/slp/write.js";

/**
 * Load a SLEAP Analysis HDF5 file (.h5).
 *
 * Mirrors Python's `load_analysis_h5`. The axis ordering is detected from the
 * stored `dims` attributes, and extended metadata (skeleton symmetries, video
 * backend metadata) is used to reconstruct the full Labels context when present.
 *
 * @param filename - Path to the Analysis HDF5 file
 * @param options - Loading options
 * @param options.video - Video to associate with the data. If omitted, uses the
 *   `video_path` stored in the file. Can be a Video object or path string.
 * @returns Loaded Labels object
 */
export async function loadAnalysisH5(
  filename: string,
  options?: { video?: Video | string },
): Promise<Labels> {
  return readAnalysisH5(filename, { video: options?.video });
}

/**
 * Save labels to a SLEAP Analysis HDF5 file (.h5).
 *
 * Mirrors Python's `save_analysis_h5`. Node-only for disk I/O.
 *
 * @param labels - Labels object to save
 * @param filename - Output file path
 * @param options - Save options
 * @param options.video - Video to export. If omitted, uses the first video. Can
 *   be a Video object or an integer index.
 * @param options.labelsPath - Source labels path (stored as metadata)
 * @param options.allFrames - Include all frames from 0 to last labeled frame (default: true)
 * @param options.minOccupancy - Minimum track occupancy ratio (0-1) to keep (default: 0)
 * @param options.preset - Axis ordering preset ("matlab" default, "standard"); mutually exclusive with explicit dims
 * @param options.frameDim - Explicit position of the frame dimension (0-3)
 * @param options.trackDim - Explicit position of the track dimension (0-3)
 * @param options.nodeDim - Explicit position of the node dimension (0-3)
 * @param options.xyDim - Explicit position of the xy dimension (0-3)
 * @param options.saveMetadata - Store extended metadata for full round-trip (default: true)
 */
export async function saveAnalysisH5(
  labels: Labels,
  filename: string,
  options?: {
    video?: Video | number;
    labelsPath?: string;
    allFrames?: boolean;
    minOccupancy?: number;
    preset?: string;
    frameDim?: number;
    trackDim?: number;
    nodeDim?: number;
    xyDim?: number;
    saveMetadata?: boolean;
  },
): Promise<void> {
  await writeAnalysisH5(labels, filename, {
    video: options?.video,
    labelsPath: options?.labelsPath,
    allFrames: options?.allFrames,
    minOccupancy: options?.minOccupancy,
    preset: options?.preset,
    frameDim: options?.frameDim,
    trackDim: options?.trackDim,
    nodeDim: options?.nodeDim,
    xyDim: options?.xyDim,
    saveMetadata: options?.saveMetadata,
  });
}

/** Re-export the Analysis HDF5 format detector for public use. */
export { isAnalysisH5File } from "./analysis-h5.js";

/** SLEAP Analysis CSV export (browser-safe string + Node file write). */
export {
  labelsToCsv,
  saveLabelsCsv,
  type CsvExportOptions,
} from "./csv.js";

/**
 * Load multiple SLP files in parallel.
 *
 * Accepts either an array of file paths (keys default to filenames) or a
 * record mapping custom keys to file paths.
 *
 * Note: Uses Promise.all internally — if any single file fails to load,
 * the entire operation fails.
 *
 * @param sources - Array of file paths or record mapping keys to paths
 * @param options - Loading options (forwarded to loadSlp)
 * @returns LabelsSet containing all loaded labels
 */
export async function loadSlpSet(
  sources: string[] | Record<string, string>,
  options?: { openVideos?: boolean; h5?: OpenH5Options },
): Promise<LabelsSet> {
  const set = new LabelsSet();

  if (Array.isArray(sources)) {
    const results = await Promise.all(
      sources.map((src) => loadSlp(src, options)),
    );
    for (let i = 0; i < sources.length; i++) {
      set.set(sources[i], results[i]);
    }
  } else {
    const entries = Object.entries(sources);
    const results = await Promise.all(
      entries.map(([, src]) => loadSlp(src, options)),
    );
    for (let i = 0; i < entries.length; i++) {
      set.set(entries[i][0], results[i]);
    }
  }

  return set;
}

/**
 * Save all labels in a LabelsSet to their respective file paths.
 *
 * Each key in the set is used as the output filename, so keys should be
 * valid file paths.
 *
 * @param labelsSet - LabelsSet to save
 * @param options - Save options (forwarded to saveSlp)
 */
export async function saveSlpSet(
  labelsSet: LabelsSet,
  options?: {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
  },
): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [filename, labels] of labelsSet) {
    promises.push(saveSlp(labels, filename, options));
  }
  await Promise.all(promises);
}

/**
 * Load a video file and create a Video object with an active backend.
 *
 * @param source - Path to video file, or a browser File object
 * @param options - Video loading options
 * @param options.dataset - HDF5 dataset path for embedded videos
 * @param options.openBackend - Whether to open the backend (default: true)
 * @param options.backend - Explicit backend selection
 * @returns Video object with backend
 */
export async function loadVideo(
  source: string | File,
  options?: {
    dataset?: string;
    openBackend?: boolean;
    backend?: VideoBackendType;
  },
): Promise<Video> {
  const filename = typeof source === "string" ? source : source.name;
  const backend = await createVideoBackend(source, {
    dataset: options?.dataset,
    backend: options?.backend,
  });
  return new Video({
    filename,
    backend,
    openBackend: options?.openBackend ?? true,
  });
}
