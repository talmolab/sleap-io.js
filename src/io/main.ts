import { Labels } from "../model/labels.js";
import { Video } from "../model/video.js";
import { readSlp } from "../codecs/slp/read.js";
import { readSlpStreaming } from "../codecs/slp/read-streaming.js";
import { writeSlp } from "../codecs/slp/write.js";
import { createVideoBackend } from "../video/factory.js";
import { OpenH5Options, SlpSource, isStreamingSupported } from "../codecs/slp/h5.js";

/**
 * Check if a source looks like a URL.
 */
function isProbablyUrl(source: SlpSource): source is string {
  return typeof source === "string" && /^https?:\/\//i.test(source);
}

/**
 * Check if we're in a browser environment.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

/**
 * Load an SLP file.
 *
 * When loading from a URL in a browser with `h5.stream` set to 'range' or 'auto',
 * this function automatically uses HTTP range requests for efficient streaming.
 * Only the annotation data needed is downloaded, not the entire file.
 *
 * @param source - Path, URL, ArrayBuffer, File, or FileSystemFileHandle
 * @param options - Loading options
 * @param options.openVideos - Whether to open video backends (default: true, but false for streaming)
 * @param options.h5 - HDF5 options including streaming mode
 * @param options.h5.stream - 'auto' | 'range' | 'download' (default: 'auto')
 *
 * @example
 * ```typescript
 * // Load from URL with streaming (uses range requests automatically)
 * const labels = await loadSlp('https://example.com/labels.slp', {
 *   h5: { stream: 'range' }
 * });
 *
 * // Force full download
 * const labels = await loadSlp('https://example.com/labels.slp', {
 *   h5: { stream: 'download' }
 * });
 * ```
 */
export async function loadSlp(
  source: SlpSource,
  options?: { openVideos?: boolean; h5?: OpenH5Options }
): Promise<Labels> {
  const streamMode = options?.h5?.stream ?? "auto";

  // Use streaming reader for URLs in browser when range requests are enabled
  if (
    isProbablyUrl(source) &&
    isBrowser() &&
    isStreamingSupported() &&
    (streamMode === "range" || streamMode === "auto")
  ) {
    try {
      return await readSlpStreaming(source, {
        filenameHint: options?.h5?.filenameHint,
      });
    } catch (e) {
      // If streaming fails and mode is 'auto', fall back to full download
      if (streamMode === "auto") {
        console.warn("Streaming failed, falling back to full download:", e);
      } else {
        throw e;
      }
    }
  }

  // Fall back to standard reader
  return readSlp(source, { openVideos: options?.openVideos ?? true, h5: options?.h5 });
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
