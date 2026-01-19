import { Labels } from "../model/labels.js";
import { Video } from "../model/video.js";
import { readSlp } from "../codecs/slp/read.js";
import { readSlpStreaming } from "../codecs/slp/read-streaming.js";
import { writeSlp } from "../codecs/slp/write.js";
import { createVideoBackend } from "../video/factory.js";
import { OpenH5Options, SlpSource, isStreamingSupported } from "../codecs/slp/h5.js";

/**
 * Check if we're in a Node.js environment.
 */
function isNode(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}

/**
 * Check if we're in a browser environment with Worker support.
 */
function isBrowserWithWorkerSupport(): boolean {
  return typeof window !== "undefined" && isStreamingSupported();
}

/**
 * Load an SLP file.
 *
 * In browser environments, this function automatically uses a Web Worker for all
 * HDF5 operations, keeping the main thread responsive. For URLs, it uses HTTP
 * range requests to download only the data needed rather than the entire file.
 *
 * In Node.js, this uses the native h5wasm bindings directly.
 *
 * @param source - Path, URL, ArrayBuffer, File, or FileSystemFileHandle
 * @param options - Loading options
 * @param options.openVideos - Whether to open video backends (default: true)
 * @param options.h5 - HDF5 options including streaming mode
 * @param options.h5.stream - 'auto' | 'range' | 'download' (default: 'auto')
 *
 * @example
 * ```typescript
 * // Browser: Load from URL (automatically uses Worker + range requests)
 * const labels = await loadSlp('https://example.com/labels.slp');
 *
 * // Browser: Load from file input (automatically uses Worker)
 * const labels = await loadSlp(fileInput.files[0]);
 *
 * // Browser: Load from ArrayBuffer (automatically uses Worker)
 * const labels = await loadSlp(arrayBuffer);
 *
 * // Force full download instead of range requests
 * const labels = await loadSlp('https://example.com/labels.slp', {
 *   h5: { stream: 'download' }
 * });
 *
 * // Node.js: Load from file path
 * const labels = await loadSlp('/path/to/file.slp');
 * ```
 */
export async function loadSlp(
  source: SlpSource,
  options?: { openVideos?: boolean; h5?: OpenH5Options }
): Promise<Labels> {
  const streamMode = options?.h5?.stream ?? "auto";
  const openVideos = options?.openVideos ?? true;

  // In browser with Worker support, use the streaming reader for ALL sources
  // This offloads h5wasm to a Web Worker, keeping the main thread responsive
  if (isBrowserWithWorkerSupport() && !isNode() && streamMode !== "download") {
    // Convert source to a type supported by readSlpStreaming
    let streamingSource: string | ArrayBuffer | Uint8Array | File;

    if (typeof source === "string") {
      streamingSource = source;
    } else if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      streamingSource = source;
    } else if (typeof File !== "undefined" && source instanceof File) {
      streamingSource = source;
    } else if (typeof FileSystemFileHandle !== "undefined" && "getFile" in source) {
      // FileSystemFileHandle - get the File object
      streamingSource = await (source as FileSystemFileHandle).getFile();
    } else {
      // Unknown source type, fall through to standard reader
      streamingSource = null as unknown as File;
    }

    if (streamingSource !== null) {
      try {
        return await readSlpStreaming(streamingSource, {
          filenameHint: options?.h5?.filenameHint,
          openVideos,
        });
      } catch (e) {
        // If streaming fails and mode is 'auto', fall back to main thread
        if (streamMode === "auto") {
          console.warn("[sleap-io] Worker-based loading failed, falling back to main thread:", e);
        } else {
          throw e;
        }
      }
    }
  }

  // Fall back to standard reader (Node.js, or browser without Worker support, or download mode)
  return readSlp(source, { openVideos, h5: options?.h5 });
}

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

export async function loadVideo(filename: string, options?: { dataset?: string; openBackend?: boolean }): Promise<Video> {
  const backend = await createVideoBackend(filename, { dataset: options?.dataset });
  return new Video({ filename, backend, openBackend: options?.openBackend ?? true });
}
