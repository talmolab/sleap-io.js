/**
 * Streaming SLP file reader using HTTP range requests.
 *
 * This module provides a streaming alternative to `readSlp` that uses
 * `StreamingH5File` for efficient range request-based file access.
 * Only the data actually needed is downloaded, rather than the entire file.
 *
 * @module
 */

import { openStreamingH5, StreamingH5File, isStreamingSupported } from "./h5-streaming.js";
import { parseJsonAttr, parseSkeletons, parseTracks, parseVideosMetadata, parseSuggestions } from "./parsers.js";
import { Labels } from "../../model/labels.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import { Instance, PredictedInstance, Track, pointsFromArray, predictedPointsFromArray } from "../../model/instance.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video } from "../../model/video.js";
import { StreamingHdf5VideoBackend } from "../../video/streaming-hdf5-video.js";

/**
 * Options for streaming SLP file loading.
 */
export interface StreamingSlpOptions {
  /** URL hint for h5wasm CDN */
  h5wasmUrl?: string;
  /** Filename hint for the HDF5 file */
  filenameHint?: string;
  /** Whether to open video backends for embedded videos (default: false) */
  openVideos?: boolean;
}

/**
 * Read an SLP file using HTTP range requests for efficient streaming.
 *
 * This function downloads only the data needed (metadata, frames, instances, points)
 * rather than the entire file.
 *
 * When `openVideos` is true, video backends are created for embedded videos,
 * allowing frame data to be retrieved. The underlying HDF5 file remains open
 * until all video backends are closed.
 *
 * @param url - URL to the SLP file (must support HTTP range requests)
 * @param options - Optional settings
 * @returns Labels object with all annotation data
 *
 * @example
 * ```typescript
 * // Load with video backends for embedded images
 * const labels = await readSlpStreaming('https://example.com/labels.slp', {
 *   openVideos: true
 * });
 * const frame = await labels.video.getFrame(0);
 * ```
 */
export async function readSlpStreaming(
  url: string,
  options?: StreamingSlpOptions
): Promise<Labels> {
  if (!isStreamingSupported()) {
    throw new Error("Streaming HDF5 requires Web Worker support (browser environment)");
  }

  const file = await openStreamingH5(url, {
    h5wasmUrl: options?.h5wasmUrl,
    filenameHint: options?.filenameHint,
  });

  const openVideos = options?.openVideos ?? false;

  try {
    return await readFromStreamingFile(file, url, options?.filenameHint, openVideos);
  } finally {
    // Only close the file if we're NOT opening video backends.
    // When openVideos is true, the file must remain open for video frame access.
    if (!openVideos) {
      await file.close();
    }
  }
}

/**
 * Read Labels from an already-opened StreamingH5File.
 */
async function readFromStreamingFile(
  file: StreamingH5File,
  url: string,
  filenameHint?: string,
  openVideos: boolean = false
): Promise<Labels> {
  // Read metadata
  const metadataAttrs = await file.getAttrs("metadata");
  const formatId = Number(
    (metadataAttrs["format_id"] as { value?: number })?.value ??
    metadataAttrs["format_id"] ??
    1.0
  );
  const metadataJson = parseJsonAttr(metadataAttrs["json"]) as Record<string, unknown> | null;

  const labelsPath = filenameHint ?? url.split("/").pop()?.split("?")[0] ?? "slp-data.slp";
  const skeletons = parseSkeletons(metadataJson);

  // Read tracks
  const tracks = await readTracksStreaming(file);

  // Read video metadata (and optionally create backends for embedded videos)
  const videos = await readVideosStreaming(file, labelsPath, openVideos, formatId);

  // Read suggestions
  const suggestions = await readSuggestionsStreaming(file, videos);

  // Read frame/instance/point data
  const framesData = await readStructDatasetStreaming(file, "frames");
  const instancesData = await readStructDatasetStreaming(file, "instances");
  const pointsData = await readStructDatasetStreaming(file, "points");
  const predPointsData = await readStructDatasetStreaming(file, "pred_points");

  // Build labeled frames
  const labeledFrames = buildLabeledFrames({
    framesData,
    instancesData,
    pointsData,
    predPointsData,
    skeletons,
    tracks,
    videos,
    formatId,
  });

  return new Labels({
    labeledFrames,
    videos,
    skeletons,
    tracks,
    suggestions,
    sessions: [], // Sessions require complex parsing, skip for now
    provenance: (metadataJson?.provenance as Record<string, unknown>) ?? {},
  });
}

/**
 * Read tracks from tracks_json dataset.
 */
async function readTracksStreaming(file: StreamingH5File): Promise<Track[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("tracks_json")) return [];

    const data = await file.getDatasetValue("tracks_json");
    const values = normalizeDatasetArray(data.value);
    return parseTracks(values);
  } catch {
    return [];
  }
}

/**
 * Read video metadata from videos_json dataset.
 * When openVideos is true, creates StreamingHdf5VideoBackend for embedded videos.
 */
async function readVideosStreaming(
  file: StreamingH5File,
  labelsPath: string,
  openVideos: boolean = false,
  formatId: number = 1.0
): Promise<Video[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("videos_json")) return [];

    const data = await file.getDatasetValue("videos_json");
    const values = normalizeDatasetArray(data.value);
    const metadataList = parseVideosMetadata(values, labelsPath);

    const videos: Video[] = [];

    for (let videoIndex = 0; videoIndex < metadataList.length; videoIndex++) {
      const meta = metadataList[videoIndex];
      const shape: [number, number, number, number] | undefined =
        meta.frameCount && meta.height && meta.width && meta.channels
          ? [meta.frameCount, meta.height, meta.width, meta.channels]
          : undefined;

      // Auto-detect dataset path when embedded but not specified in metadata
      let datasetPath: string | undefined = meta.dataset;
      if (meta.embedded && !datasetPath) {
        datasetPath = (await findVideoDatasetStreaming(file, videoIndex)) ?? undefined;
      }

      // Determine channel order: use explicit attribute if present, otherwise
      // default to BGR for legacy files (format_id < 1.4) since they were
      // typically encoded with OpenCV which uses BGR order
      const channelOrder = meta.channelOrder ?? (formatId < 1.4 ? "BGR" : "RGB");

      // Read format from metadata, or fall back to HDF5 dataset attributes
      let format = meta.format;
      if (!format && datasetPath) {
        try {
          const attrs = await file.getAttrs(datasetPath);
          const formatAttr = attrs.format;
          if (formatAttr) {
            format = typeof formatAttr === "string"
              ? formatAttr
              : (formatAttr as { value?: string })?.value;
          }
        } catch {
          // Ignore attribute read errors
        }
      }

      // Create streaming backend for embedded videos when openVideos is true
      let backend = null;
      if (openVideos && meta.embedded && datasetPath) {
        // Read frame_numbers for this video
        const frameNumbers = await readFrameNumbersStreaming(file, datasetPath);

        backend = new StreamingHdf5VideoBackend({
          filename: meta.filename,
          h5file: file,
          datasetPath,
          frameNumbers,
          format: format ?? "png",
          channelOrder,
          shape,
          fps: meta.fps,
        });
      }

      videos.push(new Video({
        filename: meta.filename,
        backend,
        backendMetadata: {
          dataset: datasetPath,
          format,
          shape,
          fps: meta.fps,
          channel_order: channelOrder,
        },
        sourceVideo: meta.sourceVideo ? new Video({ filename: meta.sourceVideo.filename }) : null,
        openBackend: openVideos && meta.embedded,
        embedded: meta.embedded,
      }));
    }

    return videos;
  } catch {
    return [];
  }
}

/**
 * Read frame_numbers dataset for a video.
 * Returns the mapping from frame indices to storage indices.
 */
async function readFrameNumbersStreaming(
  file: StreamingH5File,
  datasetPath: string
): Promise<number[]> {
  try {
    // Extract group path from dataset path (e.g., "video0/video" -> "video0")
    const groupPath = datasetPath.endsWith("/video")
      ? datasetPath.slice(0, -6)
      : datasetPath;

    const frameNumbersPath = `${groupPath}/frame_numbers`;

    // Check if dataset exists
    const groupKeys = await file.getKeys(groupPath);
    if (!groupKeys.includes("frame_numbers")) {
      return [];
    }

    const data = await file.getDatasetValue(frameNumbersPath);
    const values = data.value;

    // Convert to number array
    if (Array.isArray(values)) {
      return values.map((v: unknown) => Number(v));
    }
    if (ArrayBuffer.isView(values)) {
      return Array.from(values as unknown as ArrayLike<number>).map(Number);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Auto-detect video dataset path by scanning HDF5 structure.
 * Async version for streaming file access.
 */
async function findVideoDatasetStreaming(
  file: StreamingH5File,
  videoIndex: number
): Promise<string | null> {
  try {
    // Try explicit path first (video0/video, video1/video, etc.)
    const explicitPath = `video${videoIndex}/video`;
    const explicitGroupPath = `video${videoIndex}`;
    try {
      const groupKeys = await file.getKeys(explicitGroupPath);
      if (groupKeys.includes("video")) {
        return explicitPath;
      }
    } catch {
      // Group doesn't exist, continue to scan
    }

    // Scan root keys for video groups
    const rootKeys = file.keys();
    for (const key of rootKeys) {
      if (key.startsWith("video")) {
        try {
          const groupKeys = await file.getKeys(key);
          if (groupKeys.includes("video")) {
            const candidatePath = `${key}/video`;
            // For single video case, return first found
            if (videoIndex === 0) {
              return candidatePath;
            }
            // For multi-video, try to match by index from key
            const keyIndex = parseInt(key.slice(5), 10);
            if (!isNaN(keyIndex) && keyIndex === videoIndex) {
              return candidatePath;
            }
          }
        } catch {
          // Group read failed, skip
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Read suggestions from suggestions_json dataset.
 */
async function readSuggestionsStreaming(file: StreamingH5File, videos: Video[]): Promise<SuggestionFrame[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("suggestions_json")) return [];

    const data = await file.getDatasetValue("suggestions_json");
    const values = normalizeDatasetArray(data.value);
    const metadataList = parseSuggestions(values);

    return metadataList
      .map(meta => {
        const video = videos[meta.video];
        if (!video) return null;
        return new SuggestionFrame({
          video,
          frameIdx: meta.frameIdx,
          metadata: meta.metadata,
        });
      })
      .filter((s): s is SuggestionFrame => s !== null);
  } catch {
    return [];
  }
}

/**
 * Read a structured dataset and normalize to column format.
 */
async function readStructDatasetStreaming(
  file: StreamingH5File,
  path: string
): Promise<Record<string, unknown[]>> {
  try {
    const keys = file.keys();
    if (!keys.includes(path)) return {};

    const meta = await file.getDatasetMeta(path);
    const data = await file.getDatasetValue(path);

    // Get field names from metadata
    const fieldNames = getFieldNamesFromMeta(meta);

    return normalizeStructData(data.value, data.shape, fieldNames);
  } catch {
    return {};
  }
}

/**
 * Extract field names from dataset metadata.
 */
function getFieldNamesFromMeta(meta: { shape: number[]; dtype: string }): string[] {
  // dtype might be a string like "{'names':['x','y','visible','complete'],...}"
  // or an object with compound type info
  const dtype = meta.dtype;

  if (typeof dtype === "string") {
    // Try to parse compound type from string representation
    const namesMatch = dtype.match(/'names':\s*\[([^\]]+)\]/);
    if (namesMatch) {
      const namesStr = namesMatch[1];
      const names = namesStr.match(/'([^']+)'/g);
      if (names) {
        return names.map(n => n.replace(/'/g, ""));
      }
    }
  }

  if (typeof dtype === "object" && dtype !== null) {
    const dtypeObj = dtype as Record<string, unknown>;
    if (dtypeObj.compound_type && typeof dtypeObj.compound_type === "object") {
      const compound = dtypeObj.compound_type as { members?: Array<{ name?: string }> };
      if (compound.members) {
        return compound.members
          .map(m => m.name)
          .filter((n): n is string => !!n);
      }
    }
  }

  return [];
}

/**
 * Normalize dataset value to column-oriented format.
 */
function normalizeStructData(
  value: unknown,
  shape: number[],
  fieldNames: string[]
): Record<string, unknown[]> {
  if (!value) return {};

  // If value is already an object with arrays (column format)
  if (value && typeof value === "object" && !Array.isArray(value) && !ArrayBuffer.isView(value)) {
    const obj = value as Record<string, unknown>;
    // Check if it looks like column data
    const firstKey = Object.keys(obj)[0];
    if (firstKey && Array.isArray(obj[firstKey])) {
      return obj as Record<string, unknown[]>;
    }
  }

  // If value is a typed array with 2D shape, convert to columns
  if (ArrayBuffer.isView(value) && shape.length === 2) {
    const [rowCount, colCount] = shape;
    const arr = value as unknown as ArrayLike<number>;

    if (fieldNames.length === colCount) {
      const result: Record<string, unknown[]> = {};
      for (let col = 0; col < colCount; col++) {
        const colData: unknown[] = [];
        for (let row = 0; row < rowCount; row++) {
          colData.push(arr[row * colCount + col]);
        }
        result[fieldNames[col]] = colData;
      }
      return result;
    }
  }

  // If value is an array of arrays (row format)
  if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) {
    const rows = value as unknown[][];
    if (fieldNames.length) {
      const result: Record<string, unknown[]> = {};
      fieldNames.forEach((field, colIdx) => {
        result[field] = rows.map(row => row[colIdx]);
      });
      return result;
    }
  }

  return {};
}

/**
 * Normalize a dataset value to an array.
 */
function normalizeDatasetArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value)) {
    // For typed arrays of strings or buffers, convert to array
    return Array.from(value as unknown as ArrayLike<unknown>);
  }
  return [];
}

/**
 * Build LabeledFrame objects from normalized data.
 * (Adapted from read.ts)
 */
function buildLabeledFrames(options: {
  framesData: Record<string, unknown[]>;
  instancesData: Record<string, unknown[]>;
  pointsData: Record<string, unknown[]>;
  predPointsData: Record<string, unknown[]>;
  skeletons: Skeleton[];
  tracks: Track[];
  videos: Video[];
  formatId: number;
}): LabeledFrame[] {
  const frames: LabeledFrame[] = [];
  const { framesData, instancesData, pointsData, predPointsData, skeletons, tracks, videos, formatId } = options;
  const frameIds = (framesData.frame_id ?? []) as number[];
  const videoIdToIndex = buildVideoIdMap(framesData, videos);
  const instanceById = new Map<number, Instance | PredictedInstance>();
  const fromPredictedPairs: Array<[number, number]> = [];

  for (let frameIdx = 0; frameIdx < frameIds.length; frameIdx += 1) {
    const rawVideoId = Number((framesData.video as number[])?.[frameIdx] ?? 0);
    const videoIndex = videoIdToIndex.get(rawVideoId) ?? rawVideoId;
    const frameIndex = Number((framesData.frame_idx as number[])?.[frameIdx] ?? 0);
    const instStart = Number((framesData.instance_id_start as number[])?.[frameIdx] ?? 0);
    const instEnd = Number((framesData.instance_id_end as number[])?.[frameIdx] ?? 0);
    const video = videos[videoIndex];
    if (!video) continue;

    const instances: Array<Instance | PredictedInstance> = [];
    for (let instIdx = instStart; instIdx < instEnd; instIdx += 1) {
      const instanceType = Number((instancesData.instance_type as number[])?.[instIdx] ?? 0);
      const skeletonId = Number((instancesData.skeleton as number[])?.[instIdx] ?? 0);
      const trackId = Number((instancesData.track as number[])?.[instIdx] ?? -1);
      const pointStart = Number((instancesData.point_id_start as number[])?.[instIdx] ?? 0);
      const pointEnd = Number((instancesData.point_id_end as number[])?.[instIdx] ?? 0);
      const score = Number((instancesData.score as number[])?.[instIdx] ?? 0);
      const trackingScore = Number((instancesData.tracking_score as number[])?.[instIdx] ?? 0);
      const fromPredicted = Number((instancesData.from_predicted as number[])?.[instIdx] ?? -1);
      const skeleton = skeletons[skeletonId] ?? skeletons[0] ?? new Skeleton({ nodes: [] });
      const track = trackId >= 0 ? tracks[trackId] : null;

      let instance: Instance | PredictedInstance;
      if (instanceType === 0) {
        const points = slicePoints(pointsData, pointStart, pointEnd);
        instance = new Instance({ points: pointsFromArray(points, skeleton.nodeNames), skeleton, track, trackingScore });
        if (formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
        if (fromPredicted >= 0) {
          fromPredictedPairs.push([instIdx, fromPredicted]);
        }
      } else {
        const points = slicePoints(predPointsData, pointStart, pointEnd, true);
        instance = new PredictedInstance({ points: predictedPointsFromArray(points, skeleton.nodeNames), skeleton, track, score, trackingScore });
        if (formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
      }

      instanceById.set(instIdx, instance);
      instances.push(instance);
    }

    frames.push(new LabeledFrame({ video, frameIdx: frameIndex, instances }));
  }

  for (const [instanceId, fromPredictedId] of fromPredictedPairs) {
    const instance = instanceById.get(instanceId);
    const predicted = instanceById.get(fromPredictedId);
    if (instance && predicted instanceof PredictedInstance && instance instanceof Instance) {
      instance.fromPredicted = predicted;
    }
  }

  return frames;
}

function buildVideoIdMap(framesData: Record<string, unknown[]>, videos: Video[]): Map<number, number> {
  const videoIds = new Set<number>();
  for (const value of (framesData.video ?? []) as number[]) {
    videoIds.add(Number(value));
  }
  if (!videoIds.size) return new Map();

  const maxId = Math.max(...Array.from(videoIds));
  if (videoIds.size === videos.length && maxId === videos.length - 1) {
    const identity = new Map<number, number>();
    for (let i = 0; i < videos.length; i += 1) {
      identity.set(i, i);
    }
    return identity;
  }

  const map = new Map<number, number>();
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const dataset = (video.backendMetadata?.dataset as string | undefined) ?? "";
    const parsedId = parseVideoIdFromDataset(dataset);
    if (parsedId != null) {
      map.set(parsedId, index);
    }
  }
  return map;
}

function parseVideoIdFromDataset(dataset: string): number | null {
  if (!dataset) return null;
  const group = dataset.split("/")[0];
  if (!group.startsWith("video")) return null;
  const id = Number(group.slice(5));
  return Number.isNaN(id) ? null : id;
}

function slicePoints(data: Record<string, unknown[]>, start: number, end: number, predicted = false): number[][] {
  const xs = (data.x ?? []) as number[];
  const ys = (data.y ?? []) as number[];
  const visible = (data.visible ?? []) as number[];
  const complete = (data.complete ?? []) as number[];
  const scores = (data.score ?? []) as number[];
  const points: number[][] = [];
  for (let i = start; i < end; i += 1) {
    if (predicted) {
      points.push([xs[i], ys[i], scores[i], visible[i], complete[i]]);
    } else {
      points.push([xs[i], ys[i], visible[i], complete[i]]);
    }
  }
  return points;
}
