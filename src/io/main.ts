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

export async function loadVideo(filename: string, options?: { dataset?: string; openBackend?: boolean }): Promise<Video> {
  const backend = await createVideoBackend(filename, { dataset: options?.dataset });
  return new Video({ filename, backend, openBackend: options?.openBackend ?? true });
}
