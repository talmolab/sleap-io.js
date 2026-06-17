/**
 * Streaming SLP file reader using HTTP range requests.
 *
 * This module provides a streaming alternative to `readSlp` that uses
 * `StreamingH5File` for efficient range request-based file access.
 * Only the data actually needed is downloaded, rather than the entire file.
 *
 * @module
 */

import { openH5Worker, StreamingH5File, isStreamingSupported, type StreamingH5Source } from "./h5-streaming.js";
import { attrToNumber, attrToString, parseJsonAttr, parseJsonEntry, parseSkeletons, parseTracks, parseVideosMetadata, parseSuggestions, resolveCameraKey, reconstructInstance3D, resolveIdentity } from "./parsers.js";
import { Labels } from "../../model/labels.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import { Instance, PredictedInstance, Track, pointsFromArray, predictedPointsFromArray } from "../../model/instance.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video } from "../../model/video.js";
import { Camera, CameraGroup, FrameGroup, InstanceGroup, RecordingSession } from "../../model/camera.js";
import { Identity } from "../../model/identity.js";
import { StreamingHdf5VideoBackend } from "../../video/streaming-hdf5-video.js";
import { CropVideoBackend } from "../../video/crop-backend.js";
import { resolveSourceFrameCount } from "./frame-count.js";
import type { CropRect } from "../../transform/points.js";
import type { Fill } from "../../transform/frame.js";

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
 * Read an SLP file using a Web Worker for efficient, non-blocking HDF5 access.
 *
 * This function offloads all h5wasm operations to a Web Worker, keeping the
 * main thread responsive. For URLs, it uses HTTP range requests to download
 * only the data needed rather than the entire file.
 *
 * When `openVideos` is true, video backends are created for embedded videos,
 * allowing frame data to be retrieved. The underlying HDF5 file remains open
 * until all video backends are closed.
 *
 * @param source - URL, File, ArrayBuffer, or Uint8Array containing the SLP file
 * @param options - Optional settings
 * @returns Labels object with all annotation data
 *
 * @example
 * ```typescript
 * // Load from URL with video backends
 * const labels = await readSlpStreaming('https://example.com/labels.slp', {
 *   openVideos: true
 * });
 *
 * // Load from File object (file input)
 * const labels = await readSlpStreaming(fileInput.files[0], {
 *   openVideos: true
 * });
 *
 * // Load from ArrayBuffer
 * const labels = await readSlpStreaming(arrayBuffer, {
 *   filenameHint: 'data.slp'
 * });
 * ```
 */
export async function readSlpStreaming(
  source: StreamingH5Source,
  options?: StreamingSlpOptions
): Promise<Labels> {
  if (!isStreamingSupported()) {
    throw new Error("Streaming HDF5 requires Web Worker support (browser environment)");
  }

  const file = await openH5Worker(source, {
    h5wasmUrl: options?.h5wasmUrl,
    filenameHint: options?.filenameHint,
  });

  const openVideos = options?.openVideos ?? false;

  // Determine the source path for video resolution
  const sourcePath = typeof source === "string"
    ? source
    : (typeof File !== "undefined" && source instanceof File)
      ? source.name
      : options?.filenameHint ?? "slp-data.slp";

  try {
    return await readFromStreamingFile(file, sourcePath, options?.filenameHint, openVideos);
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

  // Read per-video crop records (SLP 2.3; empty on old/uncropped files).
  const videoCrops = await readVideoCropsStreaming(file);

  // Read video metadata (and optionally create backends for embedded videos)
  const videos = await readVideosStreaming(file, labelsPath, openVideos, formatId, videoCrops);

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

  // Read identities
  const identities = await readIdentitiesStreaming(file);

  // Read sessions
  const sessions = await readSessionsStreaming(file, videos, skeletons, labeledFrames, identities);

  return new Labels({
    labeledFrames,
    videos,
    skeletons,
    tracks,
    suggestions,
    sessions,
    identities,
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

/** A single `/video_crops` entry: the crop rect and OOB fill for one video. */
interface VideoCropEntry {
  crop: CropRect;
  fill: Fill;
}

/**
 * Read the top-level `/video_crops` dataset (SLP format 2.3) into a map keyed by
 * video index. Streaming mirror of `readVideoCrops` (read.ts). Absent on old/
 * uncropped files, in which case an empty map is returned.
 *
 * Exported for testing the h5wasm payload-form normalization (string, length-1
 * array, raw bytes); not part of the public API.
 */
export async function readVideoCropsStreaming(
  file: StreamingH5File
): Promise<Map<number, VideoCropEntry>> {
  const out = new Map<number, VideoCropEntry>();
  try {
    const keys = file.keys();
    if (!keys.includes("video_crops")) return out;

    const data = await file.getDatasetValue("video_crops");
    let raw: unknown = data.value;
    // h5wasm surfaces the vlen-string `/video_crops` payload as: (a) a plain
    // string, (b) a length-1 array of strings (the vlen form), or (c) raw
    // bytes (Uint8Array). Mirror the non-streaming readVideoCrops logic exactly:
    // unwrap the length-1 array, then decode raw bytes directly. Do NOT flatten
    // a Uint8Array via Array.from (that would extract a single byte value).
    if (Array.isArray(raw)) raw = raw[0];
    let json: string;
    if (typeof raw === "string") {
      json = raw;
    } else if (raw instanceof Uint8Array) {
      json = new TextDecoder().decode(raw);
    } else if (raw != null) {
      json = String(raw);
    } else {
      return out;
    }

    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return out;
    for (const entry of parsed as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== "object") continue;
      const videoIdx = Number(entry.video);
      const cropArr = entry.crop as number[] | undefined;
      if (!Array.isArray(cropArr) || cropArr.length !== 4) continue;
      const crop: CropRect = [
        Number(cropArr[0]),
        Number(cropArr[1]),
        Number(cropArr[2]),
        Number(cropArr[3]),
      ];
      const fillRaw = entry.fill;
      const fill: Fill = Array.isArray(fillRaw)
        ? (fillRaw as number[]).map((v) => Number(v))
        : Number(fillRaw ?? 0);
      out.set(videoIdx, { crop, fill });
    }
    return out;
  } catch {
    return out;
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
  formatId: number = 1.0,
  videoCrops?: Map<number, VideoCropEntry>
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

      // Auto-detect dataset path when embedded but not specified in metadata
      let datasetPath: string | undefined = meta.dataset;
      if (meta.embedded && !datasetPath) {
        datasetPath = (await findVideoDatasetStreaming(file, videoIndex)) ?? undefined;
      }

      // Read format/channel_order/frames from HDF5 dataset attributes when a
      // dataset path is known. Always probe even when openVideos is false —
      // downstream consumers (e.g. write.ts re-embed at line 1054) read
      // channel_order from Video.backendMetadata to avoid color corruption on
      // save, so metadata-only loads must populate it too. The `frames` attribute
      // records the source video's total frame count for embedded videos, used
      // by the seekbar. Matches Python sleap-io (video_reading.py:987-1006).
      let format = meta.format;
      let channelOrderFromAttrs: string | undefined;
      let frameCountFromAttrs: number | undefined;
      if (datasetPath) {
        try {
          const attrs = await file.getAttrs(datasetPath);
          if (!format) {
            format = attrToString(attrs.format);
          }
          channelOrderFromAttrs = attrToString(attrs.channel_order);
          const framesNum = attrToNumber(attrs.frames);
          if (framesNum !== undefined && framesNum > 0) {
            frameCountFromAttrs = framesNum;
          }
          // Read height/width/channels from dataset attributes when JSON metadata
          // is missing (common for pkg.slp files)
          const readNumAttr = (attr: unknown): number | undefined => {
            if (attr === undefined || attr === null) return undefined;
            const v = typeof attr === "object" && attr !== null && "value" in attr
              ? (attr as { value: unknown }).value : attr;
            const n = Number(v);
            return Number.isFinite(n) && n > 0 ? n : undefined;
          };
          if (!meta.height) meta.height = readNumAttr(attrs.height);
          if (!meta.width) meta.width = readNumAttr(attrs.width);
          if (!meta.channels) meta.channels = readNumAttr(attrs.channels);
        } catch {
          // Ignore attribute read errors
        }
      }

      // For embedded videos we read frame_numbers up front so the source frame
      // count (the seekbar extent) can be resolved synchronously — see below.
      // frame_sizes lets the 1D-concatenated layout (JS writer) byte-range
      // slice exactly, mirroring the sync reader (read.ts) — see issue #135.
      let frameNumbers: number[] = [];
      let frameSizes: number[] | undefined;
      if (openVideos && meta.embedded && datasetPath) {
        frameNumbers = await readFrameNumbersStreaming(file, datasetPath);
        frameSizes = await readFrameSizesStreaming(file, datasetPath);
      }

      // Source frame count: prefer the `frames` attr, then the videos_json
      // count, then max(frame_numbers)+1. The last fallback keeps multi-video
      // pkg.slp files (written without a `frames` attr, e.g. older PyQt SLEAP)
      // resolving a shape at read time instead of relying on an async per-video
      // image-decode probe that races the UI (reporting 0 / "?" / wrong counts).
      const frameCount = resolveSourceFrameCount({
        framesAttr: frameCountFromAttrs,
        jsonFrameCount: meta.frameCount,
        frameNumbers,
      });
      const shape: [number, number, number, number] | undefined =
        (meta.height && meta.width && meta.channels)
          ? [frameCount ?? 0, meta.height, meta.width, meta.channels]
          : undefined;

      // Determine channel order with priority:
      // 1. JSON metadata (meta.channelOrder)
      // 2. HDF5 dataset attribute (channelOrderFromAttrs)
      // 3. Legacy fallback based on format_id (BGR for < 1.4)
      const channelOrder = meta.channelOrder ?? channelOrderFromAttrs ?? (formatId < 1.4 ? "BGR" : "RGB");

      // Create streaming backend for embedded videos when openVideos is true
      let backend = null;
      if (openVideos && meta.embedded && datasetPath) {
        backend = new StreamingHdf5VideoBackend({
          // Embedded videos always carry a single string filename (the labels
          // path); the array form is only for image sequences, which never
          // reach this embedded branch. Narrow for the type checker.
          filename: Array.isArray(meta.filename)
            ? meta.filename[0] ?? ""
            : meta.filename,
          h5file: file,
          datasetPath,
          frameNumbers,
          frameSizes,
          format: format ?? "png",
          channelOrder,
          shape,
          fps: meta.fps,
        });

        // Only probe (decode one image) when height/width are still unknown —
        // i.e. neither the dataset attrs nor videos_json provided them. With a
        // resolved shape this is skipped, so the common pkg.slp path no longer
        // pays a per-video network decode.
        if (!shape || shape[0] === 0) {
          await backend.probeShape(frameCount ?? undefined);
        }
      }

      let videoBackend: typeof backend | CropVideoBackend = backend;
      const backendMetadata: Record<string, unknown> = {
        dataset: datasetPath,
        format,
        shape,
        fps: meta.fps,
        channel_order: channelOrder,
      };

      // Crop reconstruction (SLP 2.3): wrap the uncropped inner backend and seed
      // crop/source_shape/shape/crop_fill so streaming reads report the cropped
      // view identically to the eager reader. Mirrors read.ts readVideos.
      const cropEntry = videoCrops?.get(videoIndex);
      if (cropEntry) {
        const [cx1, cy1, cx2, cy2] = cropEntry.crop;
        if (openVideos && videoBackend) {
          videoBackend = CropVideoBackend.wrap({
            inner: videoBackend,
            crop: cropEntry.crop,
            fill: cropEntry.fill,
          });
        }
        if (shape && shape.length === 4) {
          backendMetadata.source_shape = [...shape];
          backendMetadata.shape = [shape[0], cy2 - cy1, cx2 - cx1, shape[3]];
        }
        backendMetadata.crop = [...cropEntry.crop];
        backendMetadata.crop_fill = cropEntry.fill;
      }

      videos.push(new Video({
        filename: meta.filename,
        backend: videoBackend,
        backendMetadata,
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
 * Read the frame_sizes dataset for a video, if present.
 *
 * frame_sizes records the encoded byte length of each embedded frame and is
 * written by the JS writer (1D concatenated layout). When available it lets the
 * backend byte-range slice an exact frame instead of scanning. Returns undefined
 * when the dataset is absent (e.g. Python-written 2D padded files).
 */
async function readFrameSizesStreaming(
  file: StreamingH5File,
  datasetPath: string
): Promise<number[] | undefined> {
  try {
    const groupPath = datasetPath.endsWith("/video")
      ? datasetPath.slice(0, -6)
      : datasetPath;

    const groupKeys = await file.getKeys(groupPath);
    if (!groupKeys.includes("frame_sizes")) {
      return undefined;
    }

    const data = await file.getDatasetValue(`${groupPath}/frame_sizes`);
    const values = data.value;

    if (Array.isArray(values)) {
      return values.map((v: unknown) => Number(v));
    }
    if (ArrayBuffer.isView(values)) {
      return Array.from(values as unknown as ArrayLike<number>).map(Number);
    }
    return undefined;
  } catch {
    return undefined;
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
 * Read identities from identities_json dataset.
 */
async function readIdentitiesStreaming(file: StreamingH5File): Promise<Identity[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("identities_json")) return [];

    const data = await file.getDatasetValue("identities_json");
    const values = normalizeDatasetArray(data.value);
    const identities: Identity[] = [];
    for (const entry of values) {
      const parsed = parseJsonEntry(entry) as Record<string, unknown>;
      const { name, color, ...rest } = parsed;
      identities.push(new Identity({
        name: (name as string) ?? "",
        color: color as string | undefined,
        metadata: rest,
      }));
    }
    return identities;
  } catch {
    return [];
  }
}

/**
 * Read recording sessions from sessions_json dataset.
 */
async function readSessionsStreaming(
  file: StreamingH5File,
  videos: Video[],
  skeletons: Skeleton[],
  labeledFrames: LabeledFrame[],
  identities?: Identity[]
): Promise<RecordingSession[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("sessions_json")) return [];

    const data = await file.getDatasetValue("sessions_json");
    const values = normalizeDatasetArray(data.value);

    const sessions: RecordingSession[] = [];
    for (const entry of values) {
      const parsed = parseJsonEntry(entry) as Record<string, unknown>;
      const calibration = (parsed.calibration ?? {}) as Record<string, unknown>;

      const cameraGroup = new CameraGroup();
      const cameraMap = new Map<string, Camera>();

      for (const [key, data] of Object.entries(calibration)) {
        if (key === "metadata") continue;
        const cameraData = data as Record<string, unknown>;
        const camera = new Camera({
          name: (cameraData.name as string | undefined) ?? key,
          rvec: (cameraData.rotation as number[] | undefined) ?? [0, 0, 0],
          tvec: (cameraData.translation as number[] | undefined) ?? [0, 0, 0],
          matrix: cameraData.matrix as number[][] | undefined,
          distortions: cameraData.distortions as number[] | undefined,
          size: cameraData.size as [number, number] | undefined,
        });
        cameraGroup.cameras.push(camera);
        cameraMap.set(String(key), camera);
      }

      const session = new RecordingSession({ cameraGroup, metadata: (parsed.metadata as Record<string, unknown> | undefined) ?? {} });

      const map = (parsed.camcorder_to_video_idx_map ?? {}) as Record<string, unknown>;
      for (const [cameraKey, videoIdx] of Object.entries(map)) {
        const camera = resolveCameraKey(cameraKey, cameraMap, cameraGroup.cameras);
        const video = videos[Number(videoIdx)];
        if (camera && video) {
          session.addVideo(video, camera);
        }
      }

      const frameGroups = Array.isArray(parsed.frame_group_dicts) ? parsed.frame_group_dicts : [];
      for (const group of frameGroups) {
        const groupRecord = group as Record<string, unknown>;
        const frameIdx = (groupRecord.frame_idx as number | undefined) ?? (groupRecord.frameIdx as number | undefined) ?? 0;
        const instanceGroups: InstanceGroup[] = [];
        const instanceGroupList = Array.isArray(groupRecord.instance_groups) ? groupRecord.instance_groups : [];
        for (const instanceGroup of instanceGroupList) {
          const instanceGroupRecord = instanceGroup as Record<string, unknown>;
          const instanceByCamera = new Map<Camera, Instance>();

          // Read JS-format instances (camera key -> point data)
          const instancesRecord = (instanceGroupRecord.instances ?? {}) as Record<string, unknown>;
          for (const [cameraKey, points] of Object.entries(instancesRecord)) {
            const camera = resolveCameraKey(cameraKey, cameraMap, cameraGroup.cameras);
            if (!camera) {
              console.warn(`Camera key "${cameraKey}" not found in session calibration — skipping 2D instance data for this camera.`);
              continue;
            }
            const skeleton = skeletons[0] ?? new Skeleton({ nodes: [] });
            instanceByCamera.set(camera, new Instance({ points: points as Record<string, number[]>, skeleton }));
          }

          // Fall back to Python-format camcorder_to_lf_and_inst_idx_map
          if (instanceByCamera.size === 0) {
            const lfInstMap = (instanceGroupRecord.camcorder_to_lf_and_inst_idx_map ?? {}) as Record<string, unknown>;
            for (const [camIdx, value] of Object.entries(lfInstMap)) {
              const camera = resolveCameraKey(camIdx, cameraMap, cameraGroup.cameras);
              if (!camera) continue;
              const pair = value as unknown as [number, number];
              const lf = labeledFrames[Number(pair[0])];
              if (lf) {
                const inst = lf.instances[Number(pair[1])];
                if (inst) instanceByCamera.set(camera, inst as Instance);
              }
            }
          }

          const instance3d = reconstructInstance3D(instanceGroupRecord, skeletons);
          const identity = resolveIdentity(instanceGroupRecord, identities);

          instanceGroups.push(
            new InstanceGroup({
              instanceByCamera,
              score: instanceGroupRecord.score as number | undefined,
              instance3d,
              identity,
              metadata: (instanceGroupRecord.metadata as Record<string, unknown> | undefined) ?? {},
            })
          );
        }

        const labeledFrameByCamera = new Map<Camera, LabeledFrame>();
        const labeledFrameMap = (groupRecord.labeled_frame_by_camera ?? {}) as Record<string, unknown>;
        for (const [cameraKey, labeledFrameIdx] of Object.entries(labeledFrameMap)) {
          const camera = resolveCameraKey(cameraKey, cameraMap, cameraGroup.cameras);
          if (!camera) {
            console.warn(`Camera key "${cameraKey}" not found in session calibration — skipping labeled frame mapping.`);
            continue;
          }
          const labeledFrame = labeledFrames[Number(labeledFrameIdx)];
          if (labeledFrame) {
            labeledFrameByCamera.set(camera, labeledFrame);
          }
        }

        // If no labeled_frame_by_camera, reconstruct from camcorder_to_lf_and_inst_idx_map
        if (labeledFrameByCamera.size === 0) {
          for (const instanceGroup of instanceGroupList) {
            const igRecord = instanceGroup as Record<string, unknown>;
            const lfInstMap = (igRecord.camcorder_to_lf_and_inst_idx_map ?? {}) as Record<string, unknown>;
            for (const [camIdx, value] of Object.entries(lfInstMap)) {
              const camera = resolveCameraKey(camIdx, cameraMap, cameraGroup.cameras);
              if (!camera) continue;
              const pair = value as unknown as [number, number];
              const lf = labeledFrames[Number(pair[0])];
              if (lf) labeledFrameByCamera.set(camera, lf);
            }
          }
        }

        session.frameGroups.set(
          Number(frameIdx),
          new FrameGroup({
            frameIdx: Number(frameIdx),
            instanceGroups,
            labeledFrameByCamera,
            metadata: (groupRecord.metadata as Record<string, unknown> | undefined) ?? {},
          })
        );
      }
      sessions.push(session);
    }
    return sessions;
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

    // Get field names: try dtype metadata first, then HDF5 dataset attributes.
    // Matches main-thread reader's getFieldNames (read.ts:1356-1372).
    let fieldNames = getFieldNamesFromMeta(meta);
    if (fieldNames.length === 0) {
      try {
        const attrs = await file.getAttrs(path);
        const fnAttr = attrs.field_names ?? attrs.fieldNames;
        if (fnAttr) {
          let raw = Array.isArray(fnAttr) ? fnAttr
            : (fnAttr as { value?: unknown })?.value;
          if (typeof raw === "string") {
            try { raw = JSON.parse(raw); } catch { /* not JSON */ }
          }
          if (raw instanceof Uint8Array) {
            try { raw = JSON.parse(new TextDecoder().decode(raw)); } catch { /* not JSON */ }
          }
          if (Array.isArray(raw)) {
            fieldNames = raw.map(String);
          }
        }
      } catch { /* ignore attribute read errors */ }
    }

    return normalizeStructData(data.value, data.shape, fieldNames);
  } catch {
    return {};
  }
}

/**
 * Extract field names from dataset metadata.
 */
export function getFieldNamesFromMeta(meta: {
  shape: number[];
  dtype: string;
}): string[] {
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

  if (Array.isArray(dtype)) {
    return dtype.map((pair: [string, string]) => pair[0]);
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
      const rawTrackingScore = formatId < 1.2 ? 0 : Number((instancesData.tracking_score as number[])?.[instIdx] ?? 0);
      const trackingScore = Number.isNaN(rawTrackingScore) ? 0 : rawTrackingScore;
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
