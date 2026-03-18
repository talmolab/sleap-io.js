import { Labels } from "../model/labels.js";
import { LabelsSet } from "../model/labels-set.js";
import { Video } from "../model/video.js";
import { readSlp, readSlpLazy } from "../codecs/slp/read.js";
import { readSlpStreaming } from "../codecs/slp/read-streaming.js";
import { writeSlp, saveSlpToBytes } from "../codecs/slp/write.js";
import { createVideoBackend } from "../video/factory.js";
import { OpenH5Options, SlpSource, isStreamingSupported } from "../codecs/slp/h5.js";

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
 * @returns Loaded Labels object
 */
export async function loadSlp(
  source: SlpSource,
  options?: { openVideos?: boolean; h5?: OpenH5Options; lazy?: boolean }
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
    } else if (typeof FileSystemFileHandle !== "undefined" && "getFile" in source) {
      streamingSource = await (source as FileSystemFileHandle).getFile();
    } else {
      streamingSource = null as unknown as File;
    }

    if (streamingSource !== null) {
      try {
        return await readSlpStreaming(streamingSource, {
          filenameHint: options?.h5?.filenameHint,
          openVideos,
        });
      } catch (e) {
        if (streamMode === "auto") {
          console.warn("[sleap-io] Worker-based loading failed, falling back to main thread:", e);
        } else {
          throw e;
        }
      }
    }
  }

  // Fall back to standard reader (Node.js, or browser without Worker support, or download mode)
  if (lazy) {
    return readSlpLazy(source, { openVideos, h5: options?.h5 });
  }
  return readSlp(source, { openVideos, h5: options?.h5 });
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
  }
): Promise<void> {
  await writeSlp(filename, labels, {
    embed: options?.embed ?? false,
    restoreOriginalVideos: options?.restoreOriginalVideos ?? true,
  });
}

export { saveSlpToBytes } from "../codecs/slp/write.js";

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
  options?: { openVideos?: boolean; h5?: OpenH5Options }
): Promise<LabelsSet> {
  const set = new LabelsSet();

  if (Array.isArray(sources)) {
    const results = await Promise.all(sources.map(src => loadSlp(src, options)));
    for (let i = 0; i < sources.length; i++) {
      set.set(sources[i], results[i]);
    }
  } else {
    const entries = Object.entries(sources);
    const results = await Promise.all(entries.map(([, src]) => loadSlp(src, options)));
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
  }
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
 * @param filename - Path to video file
 * @param options - Video loading options
 * @param options.dataset - HDF5 dataset path for embedded videos
 * @param options.openBackend - Whether to open the backend (default: true)
 * @returns Video object with backend
 */
export async function loadVideo(filename: string, options?: { dataset?: string; openBackend?: boolean }): Promise<Video> {
  const backend = await createVideoBackend(filename, { dataset: options?.dataset });
  return new Video({ filename, backend, openBackend: options?.openBackend ?? true });
}
