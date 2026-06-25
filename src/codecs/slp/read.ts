import { openH5File, OpenH5Options, SlpSource } from "./h5.js";
import {
  attrToNumber,
  attrToString,
  parseJsonAttr,
  parseSkeletons,
  resolveCameraKey,
  reconstructInstance3D,
  resolveIdentity,
  resolveVideoFilename,
} from "./parsers.js";
import { Labels } from "../../model/labels.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import {
  Instance,
  PredictedInstance,
  Track,
  pointsFromArray,
  predictedPointsFromArray,
} from "../../model/instance.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video, type VideoBackendError } from "../../model/video.js";
import {
  createVideoBackend,
  UnsupportedVideoFormatError,
  isImageSource,
} from "../../video/factory.js";
import { CropVideoBackend } from "../../video/crop-backend.js";
import { resolveSourceFrameCount } from "./frame-count.js";
import type { CropRect } from "../../transform/points.js";
import type { Fill } from "../../transform/frame.js";
import {
  Camera,
  CameraGroup,
  FrameGroup,
  InstanceGroup,
  RecordingSession,
} from "../../model/camera.js";
import { Identity } from "../../model/identity.js";
import { LazyDataStore, LazyFrameList } from "../../model/lazy.js";
import {
  ROI,
  UserROI,
  PredictedROI,
  AnnotationType,
  decodeWkb,
} from "../../model/roi.js";
import {
  SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
} from "../../model/mask.js";
import {
  BoundingBox,
  UserBoundingBox,
  PredictedBoundingBox,
} from "../../model/bbox.js";
import {
  Centroid,
  UserCentroid,
  PredictedCentroid,
} from "../../model/centroid.js";
import {
  LabelImage,
  UserLabelImage,
  PredictedLabelImage,
} from "../../model/label-image.js";
import type { LabelImageObjectInfo } from "../../model/label-image.js";
import { inflate } from "pako";

const textDecoder = new TextDecoder();

/**
 * Ordered stage labels for the eager reader. `total` is derived from
 * `EAGER_STAGES.length` so the count can never drift from the labels — the
 * single source of truth for the eager path's progress. These are coarser than
 * the streaming reader's stages (frames/instances/points are read together as
 * one "Building labeled frames" step), which is fine: the consumer always gets
 * a consistent (current, total, message).
 */
const EAGER_STAGES = [
  "Reading metadata",
  "Reading tracks",
  "Reading videos",
  "Reading suggestions",
  "Building labeled frames",
  "Reading identities",
  "Reading sessions",
  "Reading annotations",
] as const;

export async function readSlp(
  source: SlpSource,
  options?: {
    openVideos?: boolean;
    h5?: OpenH5Options;
    /**
     * Optional progress callback fired as loading advances through its stages.
     * `current` counts completed stages out of `total`; `message` labels the
     * stage about to run. Matches the (current, total, message?) convention used
     * elsewhere in the library (Labels.merge, RenderOptions.onProgress). The
     * stages are coarser than the streaming reader's, but the contract is the
     * same. Reporting is a pure side effect and never alters the loaded Labels.
     */
    onProgress?: (current: number, total: number, message?: string) => void;
  },
): Promise<Labels> {
  // `total` is derived from the stage list (single source of truth) so the
  // count cannot drift from the labels. `report(i)` fires the i-th stage label.
  const total = EAGER_STAGES.length;
  const onProgress = options?.onProgress;
  const report = (i: number) => onProgress?.(i, total, EAGER_STAGES[i]);

  const { file, close } = await openH5File(source, options?.h5);
  try {
    report(0); // Reading metadata
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Missing /metadata group in SLP file");
    }

    const metadataAttrs =
      (metadataGroup as unknown as { attrs?: Record<string, any> }).attrs ?? {};
    const formatId = Number(
      metadataAttrs["format_id"]?.value ?? metadataAttrs["format_id"] ?? 1.0,
    );
    const metadataJson = parseJsonAttr(metadataAttrs["json"]) as Record<
      string,
      unknown
    > | null;

    const labelsPath =
      typeof source === "string"
        ? source
        : (options?.h5?.filenameHint ?? "slp-data.slp");
    const skeletons = parseSkeletons(metadataJson);
    report(1); // Reading tracks
    const tracks = readTracks(file.get("tracks_json"));
    const videoCrops = readVideoCrops(file);
    // Hold the bar at the "Reading videos" stage while videos open; the
    // per-video sub-reporter surfaces "Opening videos (i/n)" when openVideos is
    // true (probing embedded backends can be slow). Mirrors the streaming path.
    report(2); // Reading videos
    const openVideos = options?.openVideos ?? true;
    const videos = await readVideos(
      file.get("videos_json"),
      labelsPath,
      openVideos,
      file,
      formatId,
      videoCrops,
      openVideos
        ? (i, n) => onProgress?.(2, total, `Opening videos (${i}/${n})`)
        : undefined,
    );
    report(3); // Reading suggestions
    const suggestions = readSuggestions(file.get("suggestions_json"), videos);

    report(4); // Building labeled frames
    const framesData = normalizeStructDataset(file.get("frames"));
    const instancesData = normalizeStructDataset(file.get("instances"));
    const pointsData = normalizeStructDataset(file.get("points"));
    const predPointsData = normalizeStructDataset(file.get("pred_points"));

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

    // Read negative frames
    const negativeFramesDs = file.get("negative_frames");
    if (negativeFramesDs) {
      const negData = normalizeStructDataset(negativeFramesDs);
      const videoIds = negData.video_id ?? negData.video ?? [];
      const frameIdxs = negData.frame_idx ?? [];
      const negativeSet = new Set<string>();
      for (let i = 0; i < frameIdxs.length; i++) {
        negativeSet.add(`${Number(videoIds[i])}:${Number(frameIdxs[i])}`);
      }
      for (const frame of labeledFrames) {
        const videoIndex = Math.max(0, videos.indexOf(frame.video));
        if (negativeSet.has(`${videoIndex}:${frame.frameIdx}`)) {
          frame.isNegative = true;
        }
      }
    }

    report(5); // Reading identities
    const identities = readIdentities(file.get("identities_json"));
    report(6); // Reading sessions
    const sessions = readSessions(
      file.get("sessions_json"),
      videos,
      skeletons,
      labeledFrames,
      identities,
    );
    report(7); // Reading annotations
    const allInstances = labeledFrames.flatMap((f) => f.instances);
    const { rois: roiTuples, bboxes: bboxTuples } = readRoisAndBboxes(
      file,
      videos,
      tracks,
      allInstances,
    );
    const maskTuples = readMasks(file, videos, tracks);
    const centroidTuples = readCentroids(file, videos, tracks);
    const labelImageTuples = readLabelImages(
      file,
      videos,
      tracks,
      allInstances,
    );

    // Distribute annotations into LabeledFrames using routing tuples
    const frameMap = new Map<string, LabeledFrame>();
    for (const lf of labeledFrames) {
      const vidIdx = videos.indexOf(lf.video);
      frameMap.set(`${vidIdx}:${lf.frameIdx}`, lf);
    }
    const getOrCreateFrame = (
      vidIdx: number,
      frameIdx: number,
    ): LabeledFrame => {
      const key = `${vidIdx}:${frameIdx}`;
      let lf = frameMap.get(key);
      if (!lf) {
        lf = new LabeledFrame({ video: videos[vidIdx], frameIdx });
        frameMap.set(key, lf);
        labeledFrames.push(lf);
      }
      return lf;
    };

    const staticRois: ROI[] = [];
    const distributeTuples = <T>(
      tuples: [T, number, number][],
      push: (lf: LabeledFrame, ann: T) => void,
    ): void => {
      for (const [ann, vidIdx, frameIdx] of tuples) {
        if (vidIdx >= 0 && vidIdx < videos.length && frameIdx >= 0) {
          push(getOrCreateFrame(vidIdx, frameIdx), ann);
        }
      }
    };

    // Distribute ROIs — undistributed ones are static ROIs
    for (const [roi, vidIdx, frameIdx] of roiTuples) {
      if (vidIdx >= 0 && vidIdx < videos.length && frameIdx >= 0) {
        getOrCreateFrame(vidIdx, frameIdx).rois.push(roi);
      } else {
        staticRois.push(roi);
      }
    }

    distributeTuples(bboxTuples, (lf, b) => lf.bboxes.push(b));
    distributeTuples(maskTuples, (lf, m) => lf.masks.push(m));
    distributeTuples(centroidTuples, (lf, c) => lf.centroids.push(c));
    distributeTuples(labelImageTuples, (lf, li) => lf.labelImages.push(li));

    // Resolve deferred instance references (_instanceIdx) to live instances.
    // Mirrors Labels.materialize() for eager mode so bboxes/centroids/masks/
    // labelImages get their .instance set on read (ROIs are already resolved
    // in readRoisWithMigration since it receives `instances`).
    const allInstancesFlat = labeledFrames.flatMap((lf) => lf.instances);
    const resolveInstanceRef = (ann: {
      _instanceIdx: number | null;
      instance: Instance | null;
    }): void => {
      if (
        ann._instanceIdx !== null &&
        ann._instanceIdx >= 0 &&
        ann._instanceIdx < allInstancesFlat.length
      ) {
        ann.instance = allInstancesFlat[ann._instanceIdx];
        ann._instanceIdx = null;
      }
    };
    for (const lf of labeledFrames) {
      for (const b of lf.bboxes) resolveInstanceRef(b);
      for (const c of lf.centroids) resolveInstanceRef(c);
      for (const m of lf.masks) resolveInstanceRef(m);
      for (const r of lf.rois) resolveInstanceRef(r);
      for (const li of lf.labelImages) {
        if (li._objectInstanceIdxs) {
          for (const [labelId, instIdx] of li._objectInstanceIdxs) {
            const obj = li.objects.get(labelId);
            if (obj && instIdx >= 0 && instIdx < allInstancesFlat.length) {
              obj.instance = allInstancesFlat[instIdx];
            }
          }
          li._objectInstanceIdxs = null;
        }
      }
    }

    onProgress?.(total, total, "Finalizing");
    return new Labels({
      labeledFrames,
      videos,
      skeletons,
      tracks,
      suggestions,
      sessions,
      identities,
      provenance: (metadataJson?.provenance as Record<string, unknown>) ?? {},
      rois: staticRois,
    });
  } finally {
    close();
  }
}

/**
 * Ordered stage labels for the lazy reader. As with EAGER_STAGES, `total` is
 * derived from `LAZY_STAGES.length` (single source of truth). The lazy path
 * does NOT materialize labeled frames up front — it reads the raw frame/
 * instance/point columns into a LazyDataStore — so the "Reading frame data"
 * stage reads raw data rather than constructing LabeledFrames. The stages
 * otherwise mirror the eager reader's real steps.
 */
const LAZY_STAGES = [
  "Reading metadata",
  "Reading tracks",
  "Reading videos",
  "Reading suggestions",
  "Reading frame data",
  "Reading identities",
  "Reading sessions",
  "Reading annotations",
] as const;

/**
 * Read an SLP file in lazy mode. Frames are not materialized until accessed.
 * Returns a Labels object with a LazyFrameList that loads frames on demand.
 */
export async function readSlpLazy(
  source: SlpSource,
  options?: {
    openVideos?: boolean;
    h5?: OpenH5Options;
    /**
     * Optional progress callback fired as loading advances through its stages.
     * `current` counts completed stages out of `total`; `message` labels the
     * stage about to run. Matches the (current, total, message?) convention used
     * elsewhere in the library (Labels.merge, RenderOptions.onProgress). The
     * lazy path's stages are coarser than the streaming reader's. Reporting is a
     * pure side effect and never alters the loaded Labels.
     */
    onProgress?: (current: number, total: number, message?: string) => void;
  },
): Promise<Labels> {
  // `total` is derived from the stage list (single source of truth) so the
  // count cannot drift from the labels. `report(i)` fires the i-th stage label.
  const total = LAZY_STAGES.length;
  const onProgress = options?.onProgress;
  const report = (i: number) => onProgress?.(i, total, LAZY_STAGES[i]);

  const { file, close } = await openH5File(source, options?.h5);
  try {
    report(0); // Reading metadata
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Missing /metadata group in SLP file");
    }

    const metadataAttrs =
      (metadataGroup as unknown as { attrs?: Record<string, any> }).attrs ?? {};
    const formatId = Number(
      metadataAttrs["format_id"]?.value ?? metadataAttrs["format_id"] ?? 1.0,
    );
    const metadataJson = parseJsonAttr(metadataAttrs["json"]) as Record<
      string,
      unknown
    > | null;

    const labelsPath =
      typeof source === "string"
        ? source
        : (options?.h5?.filenameHint ?? "slp-data.slp");
    const skeletons = parseSkeletons(metadataJson);
    report(1); // Reading tracks
    const tracks = readTracks(file.get("tracks_json"));
    const videoCrops = readVideoCrops(file);
    // Hold the bar at the "Reading videos" stage while videos open; the
    // per-video sub-reporter surfaces "Opening videos (i/n)" when openVideos is
    // true. Mirrors the streaming and eager paths.
    report(2); // Reading videos
    const openVideos = options?.openVideos ?? true;
    const videos = await readVideos(
      file.get("videos_json"),
      labelsPath,
      openVideos,
      file,
      formatId,
      videoCrops,
      openVideos
        ? (i, n) => onProgress?.(2, total, `Opening videos (${i}/${n})`)
        : undefined,
    );
    report(3); // Reading suggestions
    const suggestions = readSuggestions(file.get("suggestions_json"), videos);

    report(4); // Reading frame data
    // Read raw data but don't build frames yet
    const framesData = normalizeStructDataset(file.get("frames"));
    const instancesData = normalizeStructDataset(file.get("instances"));
    const pointsData = normalizeStructDataset(file.get("points"));
    const predPointsData = normalizeStructDataset(file.get("pred_points"));

    // Read negative frames
    const negativeFrames = new Set<string>();
    const negativeFramesDs = file.get("negative_frames");
    if (negativeFramesDs) {
      const negData = normalizeStructDataset(negativeFramesDs);
      const videoIds = negData.video_id ?? negData.video ?? [];
      const frameIdxs = negData.frame_idx ?? [];
      for (let i = 0; i < frameIdxs.length; i++) {
        negativeFrames.add(`${Number(videoIds[i])}:${Number(frameIdxs[i])}`);
      }
    }

    const store = new LazyDataStore({
      framesData,
      instancesData,
      pointsData,
      predPointsData,
      skeletons,
      tracks,
      videos,
      formatId,
      negativeFrames,
    });

    const lazyFrames = new LazyFrameList(store);

    // Read sessions eagerly - they don't depend on frame data.
    // Pass empty labeledFrames since frames aren't materialized yet.
    report(5); // Reading identities
    const identities = readIdentities(file.get("identities_json"));
    report(6); // Reading sessions
    const sessions = readSessions(
      file.get("sessions_json"),
      videos,
      skeletons,
      [],
      identities,
    );
    report(7); // Reading annotations
    const { rois: roiTuples, bboxes: bboxTuples } = readRoisAndBboxes(
      file,
      videos,
      tracks,
    );
    const maskTuples = readMasks(file, videos, tracks);
    const centroidTuples = readCentroids(file, videos, tracks);
    const labelImageTuples = readLabelImages(file, videos, tracks);

    // Build per-frame annotation dicts for lazy materialization
    const buildAnnByFrame = <T>(
      tuples: [T, number, number][],
    ): { byFrame: Map<string, T[]>; undistributed: T[] } => {
      const byFrame = new Map<string, T[]>();
      const undistributed: T[] = [];
      for (const [ann, vidIdx, frameIdx] of tuples) {
        if (vidIdx >= 0 && frameIdx >= 0) {
          const key = `${vidIdx}:${frameIdx}`;
          const list = byFrame.get(key);
          if (list) list.push(ann);
          else byFrame.set(key, [ann]);
        } else {
          undistributed.push(ann);
        }
      }
      return { byFrame, undistributed };
    };

    const cResult = buildAnnByFrame(centroidTuples);
    const bResult = buildAnnByFrame(bboxTuples);
    const mResult = buildAnnByFrame(maskTuples);
    const rResult = buildAnnByFrame(roiTuples);
    const liResult = buildAnnByFrame(labelImageTuples);

    store._centroidByFrame = cResult.byFrame;
    store._bboxByFrame = bResult.byFrame;
    store._maskByFrame = mResult.byFrame;
    store._roiByFrame = rResult.byFrame;
    store._labelImageByFrame = liResult.byFrame;

    store._undistributedCentroids = cResult.undistributed;
    store._undistributedBboxes = bResult.undistributed;
    store._undistributedMasks = mResult.undistributed;
    store._undistributedRois = rResult.undistributed;
    store._undistributedLabelImages = liResult.undistributed;

    // Check for annotation-only frames not in /frames (e.g., TrackMate SLPs)
    const frameKeys = new Set<string>();
    const frameVideoIds = framesData.video ?? [];
    const frameFrameIdxs = framesData.frame_idx ?? [];
    for (let i = 0; i < (framesData.frame_id ?? []).length; i++) {
      frameKeys.add(`${Number(frameVideoIds[i])}:${Number(frameFrameIdxs[i])}`);
    }

    const allAnnKeys = new Set<string>();
    for (const dict of [
      store._centroidByFrame,
      store._bboxByFrame,
      store._maskByFrame,
      store._labelImageByFrame,
      store._roiByFrame,
    ]) {
      for (const key of dict.keys()) allAnnKeys.add(key);
    }

    // Create non-lazy frames for annotations without matching /frames entries
    for (const key of [...allAnnKeys].sort()) {
      if (frameKeys.has(key)) continue;
      const [vidIdxStr, fidxStr] = key.split(":");
      const vidIdx = Number(vidIdxStr);
      const fidx = Number(fidxStr);
      if (vidIdx >= 0 && vidIdx < videos.length) {
        lazyFrames._supplementary.push(
          new LabeledFrame({
            video: videos[vidIdx],
            frameIdx: fidx,
            centroids: store._centroidByFrame.get(key) ?? [],
            bboxes: store._bboxByFrame.get(key) ?? [],
            masks: store._maskByFrame.get(key) ?? [],
            labelImages: store._labelImageByFrame.get(key) ?? [],
            rois: store._roiByFrame.get(key) ?? [],
          }),
        );
      }
    }

    // Don't pass annotations to Labels — they live on the store
    const labels = new Labels({
      videos,
      skeletons,
      tracks,
      suggestions,
      sessions,
      identities,
      provenance: (metadataJson?.provenance as Record<string, unknown>) ?? {},
    });

    // Replace the eager labeledFrames with lazy proxy
    labels._lazyFrameList = lazyFrames;
    labels._lazyDataStore = store;

    onProgress?.(total, total, "Finalizing");
    return labels;
  } finally {
    close();
  }
}

// parseJsonAttr and parseSkeletons are imported from parsers.ts

function readTracks(dataset: any): Track[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const tracks: Track[] = [];
  for (const entry of values) {
    let parsed = entry;
    if (typeof entry === "string") {
      try {
        parsed = JSON.parse(entry);
      } catch {
        parsed = entry;
      }
    }
    if (Array.isArray(parsed)) {
      tracks.push(new Track(String(parsed[1] ?? parsed[0])));
    } else if (parsed?.name) {
      tracks.push(new Track(String(parsed.name)));
    } else {
      tracks.push(new Track(String(parsed)));
    }
  }
  return tracks;
}

/** A single `/video_crops` entry: the crop rect and OOB fill for one video. */
interface VideoCropEntry {
  crop: CropRect;
  fill: Fill;
}

/**
 * Read the top-level `/video_crops` dataset (SLP format 2.3) into a map keyed by
 * video index. Port of Python `read_video_crops` (slp.py:649-680).
 *
 * The dataset holds a single JSON string (the array form written by
 * {@link writeVideoCrops}, or the scalar `np.bytes_` form Python writes) listing
 * `{ video, crop: [x1,y1,x2,y2], fill }` entries, one per cropped video. It is
 * absent on old/uncropped files, in which case an empty map is returned so the
 * loader falls back to the uncropped source. h5wasm surfaces the value as a
 * plain string (Python's scalar S-dtype), a length-1 array of strings (the JS
 * vlen-array form), or raw bytes — all three are normalized here.
 */
function readVideoCrops(file: any): Map<number, VideoCropEntry> {
  const out = new Map<number, VideoCropEntry>();
  const keys = file.keys?.() ?? [];
  if (!keys.includes("video_crops")) return out;
  const ds = file.get("video_crops");
  if (!ds) return out;

  let raw: unknown = ds.value;
  if (Array.isArray(raw)) raw = raw[0];
  let json: string;
  if (typeof raw === "string") {
    json = raw;
  } else if (raw instanceof Uint8Array) {
    json = textDecoder.decode(raw);
  } else if (raw != null) {
    json = String(raw);
  } else {
    return out;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return out;
  }
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
}

async function readVideos(
  dataset: any,
  labelsPath: string,
  openVideos: boolean,
  file: any,
  formatId: number,
  videoCrops?: Map<number, VideoCropEntry>,
  onVideoProgress?: (current: number, total: number) => void,
): Promise<Video[]> {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const videos: Video[] = [];

  for (let videoIndex = 0; videoIndex < values.length; videoIndex++) {
    onVideoProgress?.(videoIndex + 1, values.length);
    const entry = values[videoIndex];
    if (!entry) continue;
    const parsed =
      typeof entry === "string"
        ? JSON.parse(entry)
        : JSON.parse(textDecoder.decode(entry));
    const backendMeta = parsed.backend ?? {};
    let filename = resolveVideoFilename(backendMeta, parsed);
    let datasetPath = backendMeta.dataset ?? null;
    let embedded = false;

    if (filename === ".") {
      embedded = true;
      filename = labelsPath;
    }

    // Auto-detect dataset path when embedded but not specified in metadata
    if (embedded && !datasetPath) {
      datasetPath = findVideoDataset(file, videoIndex);
    }

    // Read format, channel_order, and frames from HDF5 dataset attributes when
    // available. Matches Python sleap-io behavior (video_reading.py:987-1006).
    // The `frames` attribute records the source video's total frame count for
    // embedded videos — the dataset itself only holds a subset (e.g. labeled
    // frames), but downstream consumers (seekbar, re-embed) need the source
    // range. Falls back to JSON shape[0] when absent.
    let format = backendMeta.format as string | undefined;
    let channelOrderFromAttrs: string | undefined;
    let frameCountFromAttrs: number | undefined;
    let heightFromAttrs: number | undefined;
    let widthFromAttrs: number | undefined;
    let channelsFromAttrs: number | undefined;
    if (datasetPath) {
      const videoDs = file.get(datasetPath);
      if (videoDs) {
        const attrs =
          (videoDs as { attrs?: Record<string, unknown> }).attrs ?? {};
        if (!format) {
          format = attrToString(attrs.format);
        }
        channelOrderFromAttrs = attrToString(attrs.channel_order);
        const framesNum = attrToNumber(attrs.frames);
        if (framesNum !== undefined && framesNum > 0) {
          frameCountFromAttrs = framesNum;
        }
        // Height/width/channels from dataset attrs, used when JSON metadata is
        // missing (common for pkg.slp). Mirrors read-streaming.ts.
        const h = attrToNumber(attrs.height);
        if (h !== undefined && h > 0) heightFromAttrs = h;
        const w = attrToNumber(attrs.width);
        if (w !== undefined && w > 0) widthFromAttrs = w;
        const c = attrToNumber(attrs.channels);
        if (c !== undefined && c > 0) channelsFromAttrs = c;
      }
    }

    // Read frame_numbers up front so the source frame count can be resolved
    // synchronously (the dataset itself only holds a subset; see below). Reused
    // by the backend below so it is not read twice.
    const frameNumbers = datasetPath ? readFrameNumbers(file, datasetPath) : [];

    // Compose shape. Dimensions prefer the videos_json shape, falling back to
    // the dataset attrs (pkg.slp files often carry height/width/channels as
    // attrs with no JSON shape). The source frame count (seekbar extent) comes
    // from the `frames` attr, then videos_json, then max(frame_numbers)+1 — the
    // last keeps multi-video pkg.slp files written without a `frames` attr
    // (older PyQt SLEAP) resolving an extent instead of reporting none. Mirrors
    // read-streaming.ts so the eager and streaming readers stay in parity.
    const jsonShape = backendMeta.shape as number[] | undefined;
    const height = jsonShape?.[1] ?? heightFromAttrs;
    const width = jsonShape?.[2] ?? widthFromAttrs;
    const channels = jsonShape?.[3] ?? channelsFromAttrs;
    const frameCount = resolveSourceFrameCount({
      framesAttr: frameCountFromAttrs,
      jsonFrameCount: jsonShape?.[0],
      frameNumbers,
    });
    const shape: [number, number, number, number] | undefined =
      height && width && channels
        ? [frameCount ?? 0, height, width, channels]
        : undefined;

    // Determine channel order with priority:
    // 1. JSON metadata (backendMeta.channel_order)
    // 2. HDF5 dataset attribute (channelOrderFromAttrs)
    // 3. Legacy fallback based on format_id (BGR for < 1.4)
    const channelOrder =
      (backendMeta.channel_order as string | undefined) ??
      channelOrderFromAttrs ??
      (formatId < 1.4 ? "BGR" : "RGB");

    let backend = null;
    let backendError: VideoBackendError | null = null;
    if (openVideos) {
      try {
        backend = await createVideoBackend(filename, {
          dataset: datasetPath ?? undefined,
          embedded,
          frameNumbers,
          frameSizes: readFrameSizes(file, datasetPath),
          format,
          channelOrder,
          shape,
          fps: backendMeta.fps,
        });
      } catch (err) {
        // Resilient load: a single video whose backend can't be built — an
        // image-sequence with missing files, an unsupported `.avi`/`.mpeg`, or
        // a decode failure — must NOT abort the whole project load. Leave the
        // backend null and record the reason so the consumer can show an
        // actionable message / resolver instead of the load throwing.
        backend = null;
        backendError = {
          kind:
            err instanceof UnsupportedVideoFormatError
              ? "unsupported-format"
              : isImageSource(filename)
                ? "image-sequence"
                : "decode",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // NOTE: source_video is reconstructed filename-only, so the source's shape
    // is dropped on reload. This leaves _getEffectiveShape() with no source
    // shape for a reloaded embedded subset, keeping the embedded-subset ->
    // restore-original matching workflow broken across save/load. Tracked in
    // #160 (a follow-up to the in-memory #476 source-chain fix).
    const sourceVideo = parsed.source_video
      ? new Video({ filename: parsed.source_video.filename ?? "" })
      : null;

    // Crop reconstruction (SLP 2.3): the backend just built from videos_json is
    // the UNCROPPED inner. If a /video_crops entry exists for this index, wrap it
    // in a CropVideoBackend (open path) and ALWAYS seed crop/source_shape/shape/
    // crop_fill on backendMetadata so the closed (openVideos=false) path reports
    // the cropped view too. Port of Python make_video (slp.py:380-416).
    const cropEntry = videoCrops?.get(videoIndex);
    let backendMetadata: Record<string, unknown> =
      shape !== backendMeta.shape ? { ...backendMeta, shape } : backendMeta;
    if (cropEntry) {
      const [cx1, cy1, cx2, cy2] = cropEntry.crop;
      if (openVideos && backend) {
        backend = CropVideoBackend.wrap({
          inner: backend,
          crop: cropEntry.crop,
          fill: cropEntry.fill,
        });
      }
      // Copy before overwriting so a shared metadata dict is never mutated.
      backendMetadata = { ...backendMetadata };
      const innerShape = backendMetadata.shape as number[] | undefined;
      if (innerShape && innerShape.length === 4) {
        backendMetadata.source_shape = [...innerShape];
        backendMetadata.shape = [
          innerShape[0],
          cy2 - cy1,
          cx2 - cx1,
          innerShape[3],
        ];
      }
      backendMetadata.crop = [...cropEntry.crop];
      backendMetadata.crop_fill = cropEntry.fill;
    }

    videos.push(
      new Video({
        filename,
        backend,
        backendError,
        backendMetadata,
        sourceVideo,
        openBackend: openVideos,
        embedded,
      }),
    );
  }

  return videos;
}

function readFrameNumbers(file: any, datasetPath: string | null): number[] {
  if (!datasetPath) return [];
  const groupPath = datasetPath.endsWith("/video")
    ? datasetPath.slice(0, -6)
    : datasetPath;
  const frameDataset = file.get(`${groupPath}/frame_numbers`);
  if (!frameDataset) return [];
  const values = frameDataset.value ?? [];
  return Array.from(values).map((v: any) => Number(v));
}

function readFrameSizes(
  file: any,
  datasetPath: string | null,
): number[] | undefined {
  if (!datasetPath) return undefined;
  const groupPath = datasetPath.endsWith("/video")
    ? datasetPath.slice(0, -6)
    : datasetPath;
  const sizesDataset = file.get(`${groupPath}/frame_sizes`);
  if (!sizesDataset) return undefined;
  const values = sizesDataset.value ?? [];
  return Array.from(values).map((v: any) => Number(v));
}

/**
 * Auto-detect video dataset path by scanning HDF5 structure.
 * Tries explicit path first, then scans root keys for video groups.
 */
function findVideoDataset(file: any, videoIndex: number): string | null {
  // Try explicit path first (video0/video, video1/video, etc.)
  const explicitPath = `video${videoIndex}/video`;
  if (file.get(explicitPath)) {
    return explicitPath;
  }

  // Scan root keys for video groups
  const keys = file.keys?.() ?? [];
  for (const key of keys) {
    if (key.startsWith("video")) {
      const candidatePath = `${key}/video`;
      if (file.get(candidatePath)) {
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
    }
  }

  return null;
}

function readSuggestions(dataset: any, videos: Video[]): SuggestionFrame[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const suggestions: SuggestionFrame[] = [];
  for (const entry of values) {
    const parsed =
      typeof entry === "string"
        ? JSON.parse(entry)
        : JSON.parse(textDecoder.decode(entry));
    const videoIndex = Number(parsed.video ?? 0);
    const video = videos[videoIndex];
    if (!video) continue;
    suggestions.push(
      new SuggestionFrame({
        video,
        frameIdx: parsed.frame_idx ?? parsed.frameIdx ?? 0,
        group: parsed.group != null ? String(parsed.group) : undefined,
        metadata: parsed,
      }),
    );
  }
  return suggestions;
}

function readIdentities(dataset: any): Identity[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const identities: Identity[] = [];
  for (const entry of values) {
    const parsed =
      typeof entry === "string"
        ? JSON.parse(entry)
        : JSON.parse(textDecoder.decode(entry));
    const { name, color, ...rest } = parsed;
    identities.push(
      new Identity({
        name: name ?? "",
        color: color ?? undefined,
        metadata: rest,
      }),
    );
  }
  return identities;
}

function readSessions(
  dataset: any,
  videos: Video[],
  skeletons: Skeleton[],
  labeledFrames: LabeledFrame[],
  identities?: Identity[],
): RecordingSession[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const sessions: RecordingSession[] = [];
  for (const entry of values) {
    const parsed =
      typeof entry === "string"
        ? JSON.parse(entry)
        : JSON.parse(textDecoder.decode(entry));
    const cameraGroup = new CameraGroup();
    const cameraMap = new Map<string, Camera>();
    const calibration = asRecord(parsed.calibration);
    for (const [key, data] of Object.entries(calibration)) {
      if (key === "metadata") continue;
      const cameraData = asRecord(data);
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

    const session = new RecordingSession({
      cameraGroup,
      metadata: (parsed.metadata as Record<string, unknown> | undefined) ?? {},
    });
    const map = asRecord(parsed.camcorder_to_video_idx_map);
    for (const [cameraKey, videoIdx] of Object.entries(map)) {
      const camera = resolveCameraKey(
        cameraKey,
        cameraMap,
        cameraGroup.cameras,
      );
      const video = videos[Number(videoIdx)];
      if (camera && video) {
        session.addVideo(video, camera);
      }
    }

    const frameGroups = Array.isArray(parsed.frame_group_dicts)
      ? parsed.frame_group_dicts
      : [];
    for (const group of frameGroups) {
      const groupRecord = asRecord(group);
      const frameIdx =
        (groupRecord.frame_idx as number | undefined) ??
        (groupRecord.frameIdx as number | undefined) ??
        0;
      const instanceGroups: InstanceGroup[] = [];
      const instanceGroupList = Array.isArray(groupRecord.instance_groups)
        ? groupRecord.instance_groups
        : [];
      for (const instanceGroup of instanceGroupList) {
        const instanceGroupRecord = asRecord(instanceGroup);
        const instanceByCamera = new Map<Camera, Instance>();

        // Read JS-format instances (camera key -> point data)
        const instancesRecord = asRecord(instanceGroupRecord.instances);
        for (const [cameraKey, points] of Object.entries(instancesRecord)) {
          const camera = resolveCameraKey(
            cameraKey,
            cameraMap,
            cameraGroup.cameras,
          );
          if (!camera) {
            console.warn(
              `Camera key "${cameraKey}" not found in session calibration — skipping 2D instance data for this camera.`,
            );
            continue;
          }
          const skeleton = skeletons[0] ?? new Skeleton({ nodes: [] });
          instanceByCamera.set(
            camera,
            new Instance({
              points: points as Record<string, number[]>,
              skeleton,
            }),
          );
        }

        // Fall back to Python-format camcorder_to_lf_and_inst_idx_map
        if (instanceByCamera.size === 0) {
          const lfInstMap = asRecord(
            instanceGroupRecord.camcorder_to_lf_and_inst_idx_map,
          );
          for (const [camIdx, value] of Object.entries(lfInstMap)) {
            const camera = resolveCameraKey(
              camIdx,
              cameraMap,
              cameraGroup.cameras,
            );
            if (!camera) continue;
            const pair = value as unknown as [number, number];
            const lf = labeledFrames[Number(pair[0])];
            if (lf) {
              const inst = lf.instances[Number(pair[1])];
              if (inst) instanceByCamera.set(camera, inst as Instance);
            }
          }
        }

        const instance3d = reconstructInstance3D(
          instanceGroupRecord,
          skeletons,
        );
        const identity = resolveIdentity(instanceGroupRecord, identities);

        instanceGroups.push(
          new InstanceGroup({
            instanceByCamera,
            score: instanceGroupRecord.score as number | undefined,
            instance3d,
            identity,
            metadata:
              (instanceGroupRecord.metadata as
                | Record<string, unknown>
                | undefined) ?? {},
          }),
        );
      }

      const labeledFrameByCamera = new Map<Camera, LabeledFrame>();
      const labeledFrameMap = asRecord(groupRecord.labeled_frame_by_camera);
      for (const [cameraKey, labeledFrameIdx] of Object.entries(
        labeledFrameMap,
      )) {
        const camera = resolveCameraKey(
          cameraKey,
          cameraMap,
          cameraGroup.cameras,
        );
        if (!camera) {
          console.warn(
            `Camera key "${cameraKey}" not found in session calibration — skipping labeled frame mapping.`,
          );
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
          const igRecord = asRecord(instanceGroup);
          const lfInstMap = asRecord(igRecord.camcorder_to_lf_and_inst_idx_map);
          for (const [camIdx, value] of Object.entries(lfInstMap)) {
            const camera = resolveCameraKey(
              camIdx,
              cameraMap,
              cameraGroup.cameras,
            );
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
          metadata:
            (groupRecord.metadata as Record<string, unknown> | undefined) ?? {},
        }),
      );
    }
    sessions.push(session);
  }
  return sessions;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function readAttrString(dataset: any, name: string): string[] {
  const attrs = (dataset as { attrs?: Record<string, any> }).attrs ?? {};
  const raw = attrs[name];
  if (!raw) return [];
  const value = raw.value ?? raw;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (value instanceof Uint8Array) {
    try {
      return JSON.parse(textDecoder.decode(value));
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function readRoisAndBboxes(
  file: any,
  videos: Video[],
  tracks: Track[],
  instances?: Array<Instance | PredictedInstance>,
): { rois: [ROI, number, number][]; bboxes: [BoundingBox, number, number][] } {
  const { rois, migratedBboxes } = readRoisWithMigration(
    file,
    videos,
    tracks,
    instances,
  );
  let bboxes = readBboxes(file, videos, tracks);
  if (bboxes.length === 0 && migratedBboxes.length > 0) {
    bboxes = migratedBboxes;
  }
  return { rois, bboxes };
}

function readRoisWithMigration(
  file: any,
  videos: Video[],
  tracks: Track[],
  instances?: Array<Instance | PredictedInstance>,
): {
  rois: [ROI, number, number][];
  migratedBboxes: [BoundingBox, number, number][];
} {
  const roisDs = file.get("rois");
  if (!roisDs) return { rois: [], migratedBboxes: [] };
  const roisData = normalizeStructDataset(roisDs);
  const annotationTypes = roisData.annotation_type ?? [];
  if (!annotationTypes.length) return { rois: [], migratedBboxes: [] };

  const wkbDs = file.get("roi_wkb");
  if (!wkbDs) return { rois: [], migratedBboxes: [] };
  const wkbFlat: Uint8Array =
    wkbDs.value instanceof Uint8Array
      ? wkbDs.value
      : new Uint8Array(wkbDs.value ?? []);

  // v1.9+: string datasets; fallback to JSON attrs
  const categories = readStringMetadata(
    file,
    "roi_categories",
    roisDs,
    "categories",
  );
  const names = readStringMetadata(file, "roi_names", roisDs, "names");
  const sources = readStringMetadata(file, "roi_sources", roisDs, "sources");

  const videoIndices = roisData.video ?? [];
  const frameIndices = roisData.frame_idx ?? [];
  const trackIndices = roisData.track ?? [];
  const scores = roisData.score ?? [];
  const wkbStarts = roisData.wkb_start ?? [];
  const wkbEnds = roisData.wkb_end ?? [];
  const instanceIndices = roisData.instance ?? [];
  // v1.9+ column (may not exist in older files)
  const isPredictedCol = roisData.is_predicted ?? [];
  const trackingScoresCol = roisData.tracking_score ?? [];

  const rois: [ROI, number, number][] = [];
  const migratedBboxes: [BoundingBox, number, number][] = [];

  for (let i = 0; i < annotationTypes.length; i++) {
    const wkbStart = Number(wkbStarts[i]);
    const wkbEnd = Number(wkbEnds[i]);
    const wkbBytes = wkbFlat.slice(wkbStart, wkbEnd);
    const geometry = decodeWkb(wkbBytes);

    const videoIdx = Number(videoIndices[i]);
    const video =
      videoIdx >= 0 && videoIdx < videos.length ? videos[videoIdx] : null;

    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    const annotType = Number(annotationTypes[i]);

    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;

    const roiTsVal =
      trackingScoresCol.length > i ? Number(trackingScoresCol[i]) : Number.NaN;
    const roiTrackingScore = Number.isNaN(roiTsVal) ? null : roiTsVal;

    // Migration: annotation_type === 1 (BOUNDING_BOX) -> BoundingBox object
    // Skip predicted ROIs during bbox migration (only migrate user-type box-shaped ROIs)
    if (annotType === AnnotationType.BOUNDING_BOX && !isPred) {
      const tmpRoi = new UserROI({
        geometry,
        name: names[i] ?? "",
        category: categories[i] ?? "",
        source: sources[i] ?? "",
        video,
        track,
      });
      const b = tmpRoi.bounds;
      const scoreVal = Number(scores[i]);
      const bboxScore = Number.isNaN(scoreVal) ? null : scoreVal;

      const bboxOptions = {
        x1: b.minX,
        y1: b.minY,
        x2: b.maxX,
        y2: b.maxY,
        track,
        trackingScore: roiTrackingScore,
        category: categories[i] ?? "",
        name: names[i] ?? "",
        source: sources[i] ?? "",
      };

      let bbox: BoundingBox;
      if (bboxScore !== null) {
        bbox = new PredictedBoundingBox({ ...bboxOptions, score: bboxScore });
      } else {
        bbox = new UserBoundingBox(bboxOptions);
      }

      // Format >= 1.6: resolve instance references for migrated bboxes
      if (instanceIndices.length > 0) {
        const instIdx = Number(instanceIndices[i]);
        if (instances && instIdx >= 0 && instIdx < instances.length) {
          bbox.instance = instances[instIdx];
        } else if (instIdx >= 0) {
          bbox._instanceIdx = instIdx;
        }
      }

      migratedBboxes.push([bbox, videoIdx, frameIdxVal]);
    } else {
      const roiOptions = {
        geometry,
        name: names[i] ?? "",
        category: categories[i] ?? "",
        source: sources[i] ?? "",
        video,
        track,
        trackingScore: roiTrackingScore,
      };

      let roi: ROI;
      if (isPred) {
        const scoreVal = Number(scores[i]);
        roi = new PredictedROI({
          ...roiOptions,
          score: Number.isNaN(scoreVal) ? 0 : scoreVal,
        });
      } else {
        roi = new UserROI(roiOptions);
      }

      // Format >= 1.6: resolve instance references
      if (instanceIndices.length > 0) {
        const instIdx = Number(instanceIndices[i]);
        if (instances && instIdx >= 0 && instIdx < instances.length) {
          roi.instance = instances[instIdx];
        } else if (instIdx >= 0) {
          roi._instanceIdx = instIdx;
        }
      }

      rois.push([roi, videoIdx, frameIdxVal]);
    }
  }

  return { rois, migratedBboxes };
}

function readBboxes(
  file: any,
  _videos: Video[],
  tracks: Track[],
): [BoundingBox, number, number][] {
  const bboxesDs = file.get("bboxes");
  if (!bboxesDs) return [];
  const bboxesData = normalizeStructDataset(bboxesDs);

  // Legacy format: center-based columns (x_center, y_center, width, height)
  const xCenters = bboxesData.x_center ?? [];
  const isLegacy = xCenters.length > 0;

  // New format: corner-based columns (x1, y1, x2, y2)
  const x1s = bboxesData.x1 ?? [];
  const count = isLegacy ? xCenters.length : x1s.length;
  if (!count) return [];

  // v1.9+: string datasets at root level; fallback to JSON attrs on dataset
  const categories = readStringMetadata(
    file,
    "bbox_categories",
    bboxesDs,
    "categories",
  );
  const names = readStringMetadata(file, "bbox_names", bboxesDs, "names");
  const sources = readStringMetadata(file, "bbox_sources", bboxesDs, "sources");

  const yCenters = bboxesData.y_center ?? [];
  const widths = bboxesData.width ?? [];
  const heights = bboxesData.height ?? [];
  const y1s = bboxesData.y1 ?? [];
  const x2s = bboxesData.x2 ?? [];
  const y2s = bboxesData.y2 ?? [];
  const angles = bboxesData.angle ?? [];
  const videoIndices = bboxesData.video ?? [];
  const frameIndices = bboxesData.frame_idx ?? [];
  const trackIndices = bboxesData.track ?? [];
  const bboxScores = bboxesData.score ?? [];
  const instanceIndices = bboxesData.instance ?? [];
  const trackingScores = bboxesData.tracking_score ?? [];

  const bboxes: [BoundingBox, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const videoIdx = Number(videoIndices[i]);

    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    const scoreVal = Number(bboxScores[i]);
    const instanceIdx = Number(instanceIndices[i]);

    // Convert legacy center-based to corner-based
    let bx1: number, by1: number, bx2: number, by2: number;
    if (isLegacy) {
      const cx = Number(xCenters[i]);
      const cy = Number(yCenters[i]);
      const w = Number(widths[i]);
      const h = Number(heights[i]);
      bx1 = cx - w / 2;
      by1 = cy - h / 2;
      bx2 = cx + w / 2;
      by2 = cy + h / 2;
    } else {
      bx1 = Number(x1s[i]);
      by1 = Number(y1s[i]);
      bx2 = Number(x2s[i]);
      by2 = Number(y2s[i]);
    }

    const tsVal =
      trackingScores.length > i ? Number(trackingScores[i]) : Number.NaN;
    const trackingScore = Number.isNaN(tsVal) ? null : tsVal;

    const options = {
      x1: bx1,
      y1: by1,
      x2: bx2,
      y2: by2,
      angle: Number(angles[i]),
      track,
      trackingScore,
      category: categories[i] ?? "",
      name: names[i] ?? "",
      source: sources[i] ?? "",
    };

    let bbox: BoundingBox;
    if (Number.isNaN(scoreVal)) {
      bbox = new UserBoundingBox(options);
    } else {
      bbox = new PredictedBoundingBox({ ...options, score: scoreVal });
    }

    if (instanceIdx >= 0) {
      bbox._instanceIdx = instanceIdx;
    }

    bboxes.push([bbox, videoIdx, frameIdxVal]);
  }
  return bboxes;
}

/**
 * Read string metadata from a root-level dataset or fall back to a JSON attribute.
 * v1.9+ writes string datasets; older files use JSON-encoded attrs.
 */
function readStringMetadata(
  file: any,
  datasetPath: string,
  dataset: any,
  attrName: string,
): string[] {
  const ds = file.get(datasetPath);
  if (ds) {
    // Try the "json" attribute on the string dataset first
    const jsonAttr = readAttrString(ds, "json");
    if (jsonAttr.length > 0) return jsonAttr;
    // Fall back to raw value
    const val = ds.value;
    if (Array.isArray(val)) {
      return val.map((v: any) => (typeof v === "string" ? v : String(v ?? "")));
    }
  }
  return readAttrString(dataset, attrName);
}

/**
 * Read score maps from index + data datasets.
 * Returns a Map from annotation index to { scoreMap, height, width }.
 */
function readScoreMaps(
  file: any,
  indexPath: string,
  dataPath: string,
): Map<number, { scoreMap: Float32Array; height: number; width: number }> {
  const result = new Map<
    number,
    { scoreMap: Float32Array; height: number; width: number }
  >();
  const indexDs = file.get(indexPath);
  const dataDs = file.get(dataPath);
  if (!indexDs || !dataDs) return result;

  const indexData = normalizeStructDataset(indexDs);
  const idxCol = indexData.mask_idx ?? indexData.li_idx ?? [];
  const starts = indexData.data_start ?? [];
  const ends = indexData.data_end ?? [];
  const smHeights = indexData.height ?? [];
  const smWidths = indexData.width ?? [];

  const dataFlat: Uint8Array =
    dataDs.value instanceof Uint8Array
      ? dataDs.value
      : new Uint8Array(dataDs.value ?? []);

  for (let i = 0; i < idxCol.length; i++) {
    const annotIdx = Number(idxCol[i]);
    const start = Number(starts[i]);
    const end = Number(ends[i]);
    const h = Number(smHeights[i]);
    const w = Number(smWidths[i]);

    const compressed = dataFlat.slice(start, end);
    const decompressed = inflate(compressed);
    const expectedBytes = h * w * 4; // Float32 = 4 bytes per element
    if (decompressed.byteLength !== expectedBytes) {
      throw new Error(
        `Score map decompression size mismatch: expected ${expectedBytes} bytes, got ${decompressed.byteLength}`,
      );
    }
    const scoreMap = new Float32Array(
      decompressed.buffer.slice(
        decompressed.byteOffset,
        decompressed.byteOffset + decompressed.byteLength,
      ),
    );

    result.set(annotIdx, { scoreMap, height: h, width: w });
  }
  return result;
}

function readMasks(
  file: any,
  _videos: Video[],
  tracks: Track[],
): [SegmentationMask, number, number][] {
  const masksDs = file.get("masks");
  if (!masksDs) return [];
  const masksData = normalizeStructDataset(masksDs);
  const heights = masksData.height ?? [];
  if (!heights.length) return [];

  const rleDs = file.get("mask_rle");
  if (!rleDs) return [];
  const rleFlat: Uint8Array =
    rleDs.value instanceof Uint8Array
      ? rleDs.value
      : new Uint8Array(rleDs.value ?? []);

  // v1.9+: string datasets at root level; fallback to JSON attrs on mask dataset
  const categories = readStringMetadata(
    file,
    "mask_categories",
    masksDs,
    "categories",
  );
  const names = readStringMetadata(file, "mask_names", masksDs, "names");
  const sources = readStringMetadata(file, "mask_sources", masksDs, "sources");

  const widths = masksData.width ?? [];
  const videoIndices = masksData.video ?? [];
  const frameIndices = masksData.frame_idx ?? [];
  const trackIndices = masksData.track ?? [];
  const rleStarts = masksData.rle_start ?? [];
  const rleEnds = masksData.rle_end ?? [];
  // v1.9+ columns (may not exist in older files)
  const isPredictedCol = masksData.is_predicted ?? [];
  const scoreCol = masksData.score ?? [];
  const instanceCol = masksData.instance ?? [];
  const maskTrackingScoreCol = masksData.tracking_score ?? [];
  // v2.4+: from_predicted provenance index into the flat mask list. Absent in
  // pre-2.4 files (presence-gated by name) -> [] -> per-row fallback -1.
  const fromPredictedCol = masksData.from_predicted ?? [];

  // v2.1+: spatial metadata columns (default to 1.0/0.0 for old files)
  const scaleXCol = masksData.scale_x ?? [];
  const scaleYCol = masksData.scale_y ?? [];
  const offsetXCol = masksData.offset_x ?? [];
  const offsetYCol = masksData.offset_y ?? [];

  // Read score maps if present
  const scoreMaps = readScoreMaps(
    file,
    "mask_score_map_index",
    "mask_score_maps",
  );

  const masks: [SegmentationMask, number, number][] = [];
  // Deferred from_predicted re-link: collect (userMaskIdx, srcIdx) pairs and
  // resolve after ALL masks are built, since a source prediction can appear
  // later in the flat list (mirrors instance from_predicted).
  const fromPredictedPairs: Array<[number, number]> = [];
  for (let i = 0; i < heights.length; i++) {
    const rleStart = Number(rleStarts[i]);
    const rleEnd = Number(rleEnds[i]);
    const rleRaw = rleFlat.slice(rleStart, rleEnd);

    // Convert packed uint8 bytes back to Uint32Array (4 bytes per count, little-endian)
    const numCounts = rleRaw.byteLength / 4;
    const rleCounts = new Uint32Array(numCounts);
    const rleView = new DataView(
      rleRaw.buffer,
      rleRaw.byteOffset,
      rleRaw.byteLength,
    );
    for (let j = 0; j < numCounts; j++) {
      rleCounts[j] = rleView.getUint32(j * 4, true);
    }

    const videoIdx = Number(videoIndices[i]);

    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    const scaleX = scaleXCol.length > i ? Number(scaleXCol[i]) : 1;
    const scaleY = scaleYCol.length > i ? Number(scaleYCol[i]) : 1;
    const offsetX = offsetXCol.length > i ? Number(offsetXCol[i]) : 0;
    const offsetY = offsetYCol.length > i ? Number(offsetYCol[i]) : 0;

    const maskTsVal =
      maskTrackingScoreCol.length > i
        ? Number(maskTrackingScoreCol[i])
        : Number.NaN;
    const maskTrackingScore = Number.isNaN(maskTsVal) ? null : maskTsVal;

    const baseOptions = {
      rleCounts,
      height: Number(heights[i]),
      width: Number(widths[i]),
      name: names[i] ?? "",
      category: categories[i] ?? "",
      source: sources[i] ?? "",
      track,
      trackingScore: maskTrackingScore,
      scale: [scaleX, scaleY] as [number, number],
      offset: [offsetX, offsetY] as [number, number],
    };

    // Determine if predicted based on is_predicted column or NaN score fallback
    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;
    let mask: SegmentationMask;

    if (isPred) {
      const scoreVal = scoreCol.length > i ? Number(scoreCol[i]) : 0;
      const sm = scoreMaps.get(i);
      mask = new PredictedSegmentationMask({
        ...baseOptions,
        score: scoreVal,
        scoreMap: sm?.scoreMap ?? null,
      });
    } else {
      mask = new UserSegmentationMask(baseOptions);
      // Collect from_predicted link for deferred re-link (user masks only).
      const fpIdx =
        fromPredictedCol.length > i ? Number(fromPredictedCol[i]) : -1;
      if (fpIdx >= 0) fromPredictedPairs.push([i, fpIdx]);
    }

    // Resolve instance reference
    const instIdx = instanceCol.length > i ? Number(instanceCol[i]) : -1;
    if (instIdx >= 0) {
      mask._instanceIdx = instIdx;
    }

    masks.push([mask, videoIdx, frameIdxVal]);
  }

  // Deferred from_predicted re-link pass. Bounds-checked so out-of-range or -1
  // indices leave fromPredicted at its constructor default (null).
  for (const [i, fpIdx] of fromPredictedPairs) {
    if (fpIdx >= 0 && fpIdx < masks.length) {
      (masks[i][0] as UserSegmentationMask).fromPredicted = masks[
        fpIdx
      ][0] as PredictedSegmentationMask;
    }
  }

  return masks;
}

// Pixel data is eagerly materialized into a standalone Int32Array per
// LabelImage; the h5wasm File is closed by readSlp's finally block before
// Labels is returned. label-image .data therefore has no dependency on the
// source file lifetime — the Python issue addressed by PR #419 (h5py
// Dataset closure invalidated by Labels.__del__) does not apply here.
function readLabelImages(
  file: any,
  _videos: Video[],
  tracks: Track[],
  instances?: Array<Instance | PredictedInstance>,
): [LabelImage, number, number][] {
  const liDs = file.get("label_images");
  if (!liDs) return [];
  const liData = normalizeStructDataset(liDs);
  const videoIndices = liData.video ?? [];
  if (!videoIndices.length) return [];

  const frameIndices = liData.frame_idx ?? [];
  const heights = liData.height ?? [];
  const widths = liData.width ?? [];
  const nObjectsList = liData.n_objects ?? [];
  const objectsStarts = liData.objects_start ?? [];
  const dataStarts = liData.data_start ?? [];
  const dataEnds = liData.data_end ?? [];

  // v1.9+: string datasets; fallback to JSON attrs
  const sources = readStringMetadata(
    file,
    "label_image_sources",
    liDs,
    "sources",
  );

  // v1.9+ columns (may not exist in older files)
  const isPredictedCol = liData.is_predicted ?? [];
  const liScoreCol = liData.score ?? [];

  // v2.1+: spatial metadata columns (default to 1.0/0.0 for old files)
  const liScaleXCol = liData.scale_x ?? [];
  const liScaleYCol = liData.scale_y ?? [];
  const liOffsetXCol = liData.offset_x ?? [];
  const liOffsetYCol = liData.offset_y ?? [];

  // Read pixel data: either blob (1D, v1.8-v2.1) or chunked (3D, v2.2+)
  const dataDs = file.get("label_image_data");
  if (!dataDs) return [];
  const dataShape = dataDs.shape ?? [];
  const isChunked = dataShape.length === 3;
  // For blob format: flat Uint8Array of concatenated zlib-compressed frames
  // For chunked format: 3D Int32Array [T, H, W] (decompression handled by HDF5 lib)
  let dataFlat: Uint8Array = new Uint8Array(0);
  let dataChunked: any = null;
  if (isChunked) {
    dataChunked = dataDs.value; // 3D array or flat typed array with shape metadata
  } else {
    dataFlat =
      dataDs.value instanceof Uint8Array
        ? dataDs.value
        : new Uint8Array(dataDs.value ?? []);
  }

  // Read objects table (may not exist if all label images have 0 objects)
  let objLabelIds: any[] = [];
  let objTrackIndices: any[] = [];
  let objInstanceIndices: any[] = [];
  let objCategories: string[] = [];
  let objNames: string[] = [];
  let objScoreCol: any[] = [];
  let objTrackingScoreCol: any[] = [];

  const objDs = file.get("label_image_objects");
  if (objDs) {
    const objData = normalizeStructDataset(objDs);
    objLabelIds = objData.label_id ?? [];
    objTrackIndices = objData.track ?? [];
    objInstanceIndices = objData.instance ?? [];
    // v1.9+: string datasets at root level
    objCategories = readStringMetadata(
      file,
      "label_image_obj_categories",
      objDs,
      "categories",
    );
    objNames = readStringMetadata(
      file,
      "label_image_obj_names",
      objDs,
      "names",
    );
    objScoreCol = objData.score ?? [];
    objTrackingScoreCol = objData.tracking_score ?? [];
  }

  // Read score maps if present
  const liScoreMaps = readScoreMaps(
    file,
    "label_image_score_map_index",
    "label_image_score_maps",
  );

  const labelImages: [LabelImage, number, number][] = [];
  for (let i = 0; i < videoIndices.length; i++) {
    const videoIdx = Number(videoIndices[i]);
    const frameIdxVal = Number(frameIndices[i]);
    const height = Number(heights[i]);
    const width = Number(widths[i]);

    // Extract pixel data from blob or chunked format
    let pixelData: Int32Array;
    if (isChunked && dataChunked) {
      // v2.2+: 3D chunked dataset [T, H, W] — frames stored sequentially by the
      // Python writer, so loop index i maps directly to the i-th frame slice.
      const frameSize = height * width;
      if (dataChunked instanceof Int32Array) {
        // Flat typed array with shape [T, H, W] — slice by frame index
        pixelData = new Int32Array(
          dataChunked.buffer,
          dataChunked.byteOffset + i * frameSize * 4,
          frameSize,
        );
      } else if (ArrayBuffer.isView(dataChunked)) {
        // Other typed array — convert to Int32Array
        const offset = i * frameSize;
        pixelData = new Int32Array(frameSize);
        for (let p = 0; p < frameSize; p++) {
          pixelData[p] = (dataChunked as any)[offset + p];
        }
      } else {
        // Fallback: array of arrays or similar
        pixelData = new Int32Array(frameSize);
      }
    } else {
      // v1.8-v2.1: blob format — decompress from flat byte array
      const dataStart = Number(dataStarts[i]);
      const dataEnd = Number(dataEnds[i]);
      const compressed = dataFlat.slice(dataStart, dataEnd);
      const decompressed = inflate(compressed);
      // Convert bytes back to Int32Array (little-endian, matches native).
      // Use buffer.slice() to guarantee 4-byte alignment for Int32Array.
      pixelData = new Int32Array(
        decompressed.buffer.slice(
          decompressed.byteOffset,
          decompressed.byteOffset + decompressed.byteLength,
        ),
      );
    }

    // Build objects map
    const nObj = Number(nObjectsList[i]);
    const objStart = Number(objectsStarts[i]);
    const objects = new Map<number, LabelImageObjectInfo>();
    const deferredInstances = new Map<number, number>();

    for (let j = objStart; j < objStart + nObj; j++) {
      const labelId = Number(objLabelIds[j]);
      const trackIdx = Number(objTrackIndices[j]);
      const track =
        trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;
      const instIdx = Number(objInstanceIndices[j]);
      let instance: Instance | null = null;

      if (instances && instIdx >= 0 && instIdx < instances.length) {
        instance = instances[instIdx] as Instance;
      } else if (instIdx >= 0) {
        deferredInstances.set(labelId, instIdx);
      }

      const objScore = objScoreCol.length > j ? Number(objScoreCol[j]) : null;
      const objTsVal =
        objTrackingScoreCol.length > j ? Number(objTrackingScoreCol[j]) : null;

      objects.set(labelId, {
        track,
        category: objCategories[j] ?? "",
        name: objNames[j] ?? "",
        instance,
        score: objScore !== null && !Number.isNaN(objScore) ? objScore : null,
        trackingScore:
          objTsVal !== null && !Number.isNaN(objTsVal) ? objTsVal : null,
        _instanceIdx: instIdx >= 0 ? instIdx : -1,
      });
    }

    // Determine if predicted
    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;

    // v2.1+: spatial metadata
    const liScaleX = liScaleXCol.length > i ? Number(liScaleXCol[i]) : 1;
    const liScaleY = liScaleYCol.length > i ? Number(liScaleYCol[i]) : 1;
    const liOffsetX = liOffsetXCol.length > i ? Number(liOffsetXCol[i]) : 0;
    const liOffsetY = liOffsetYCol.length > i ? Number(liOffsetYCol[i]) : 0;
    const liScale: [number, number] = [liScaleX, liScaleY];
    const liOffset: [number, number] = [liOffsetX, liOffsetY];

    let li: LabelImage;
    if (isPred) {
      const liScore = liScoreCol.length > i ? Number(liScoreCol[i]) : 0;
      const sm = liScoreMaps.get(i);
      li = new PredictedLabelImage({
        data: pixelData,
        height,
        width,
        objects,
        source: sources[i] ?? "",
        score: liScore,
        scoreMap: sm?.scoreMap ?? null,
        scale: liScale,
        offset: liOffset,
      });
    } else {
      li = new UserLabelImage({
        data: pixelData,
        height,
        width,
        objects,
        source: sources[i] ?? "",
        scale: liScale,
        offset: liOffset,
      });
    }

    if (deferredInstances.size > 0) {
      li._objectInstanceIdxs = deferredInstances;
    }

    labelImages.push([li, videoIdx, frameIdxVal]);
  }
  return labelImages;
}

function normalizeStructDataset(dataset: any): Record<string, any[]> {
  if (!dataset) return {};
  const raw = dataset.value;
  if (!raw) return {};

  const fieldNames = getFieldNames(dataset);

  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return mapStructuredRows(raw, fieldNames);
  }

  if (
    raw &&
    ArrayBuffer.isView(raw) &&
    Array.isArray(dataset.shape) &&
    dataset.shape.length === 2
  ) {
    const [rowCount, colCount] = dataset.shape as [number, number];
    const rows: any[][] = [];
    for (let i = 0; i < rowCount; i += 1) {
      const start = i * colCount;
      const end = start + colCount;
      const slice = Array.from((raw as any).slice(start, end));
      rows.push(slice);
    }
    return mapStructuredRows(rows, fieldNames);
  }

  if (raw && typeof raw === "object") {
    return raw;
  }

  return {};
}

function mapStructuredRows(
  rows: any[][],
  fieldNames: string[],
): Record<string, any[]> {
  if (!fieldNames.length) {
    return rows.reduce((acc: Record<string, any[]>, row: any[], idx) => {
      acc[String(idx)] = row;
      return acc;
    }, {});
  }
  const data: Record<string, any[]> = {};
  fieldNames.forEach((field, idx) => {
    data[field] = rows.map((row) => row[idx]);
  });
  return data;
}

function getFieldNames(dataset: any): string[] {
  const fields = dataset.dtype?.fields ? Object.keys(dataset.dtype.fields) : [];
  if (fields.length) return fields;
  const compoundMembers = dataset.metadata?.compound_type?.members;
  if (Array.isArray(compoundMembers) && compoundMembers.length) {
    const names = compoundMembers
      .map((member: { name?: string }) => member.name)
      .filter((name: string | undefined): name is string => !!name);
    if (names.length) return names;
  }
  const attr = dataset.attrs?.field_names ?? dataset.attrs?.fieldNames;
  if (!attr) return [];
  const value = attr.value ?? attr;
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  if (value instanceof Uint8Array) {
    try {
      const parsed = JSON.parse(textDecoder.decode(value));
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      return [];
    }
  }
  return [];
}

function buildLabeledFrames(options: {
  framesData: Record<string, any[]>;
  instancesData: Record<string, any[]>;
  pointsData: Record<string, any[]>;
  predPointsData: Record<string, any[]>;
  skeletons: Skeleton[];
  tracks: Track[];
  videos: Video[];
  formatId: number;
}): LabeledFrame[] {
  const frames: LabeledFrame[] = [];
  const {
    framesData,
    instancesData,
    pointsData,
    predPointsData,
    skeletons,
    tracks,
    videos,
    formatId,
  } = options;
  const frameIds = framesData.frame_id ?? [];
  const videoIdToIndex = buildVideoIdMap(framesData, videos);
  const instanceById = new Map<number, Instance | PredictedInstance>();
  const fromPredictedPairs: Array<[number, number]> = [];

  for (let frameIdx = 0; frameIdx < frameIds.length; frameIdx += 1) {
    const rawVideoId = Number(framesData.video?.[frameIdx] ?? 0);
    const videoIndex = videoIdToIndex.get(rawVideoId) ?? rawVideoId;
    const frameIndex = Number(framesData.frame_idx?.[frameIdx] ?? 0);
    const instStart = Number(framesData.instance_id_start?.[frameIdx] ?? 0);
    const instEnd = Number(framesData.instance_id_end?.[frameIdx] ?? 0);
    const video = videos[videoIndex];
    if (!video) continue;

    const instances: Array<Instance | PredictedInstance> = [];
    for (let instIdx = instStart; instIdx < instEnd; instIdx += 1) {
      const instanceType = Number(instancesData.instance_type?.[instIdx] ?? 0);
      const skeletonId = Number(instancesData.skeleton?.[instIdx] ?? 0);
      const trackId = Number(instancesData.track?.[instIdx] ?? -1);
      const pointStart = Number(instancesData.point_id_start?.[instIdx] ?? 0);
      const pointEnd = Number(instancesData.point_id_end?.[instIdx] ?? 0);
      const score = Number(instancesData.score?.[instIdx] ?? 0);
      const rawTrackingScore =
        formatId < 1.2
          ? 0
          : Number(instancesData.tracking_score?.[instIdx] ?? 0);
      const trackingScore = Number.isNaN(rawTrackingScore)
        ? 0
        : rawTrackingScore;
      const fromPredicted = Number(
        instancesData.from_predicted?.[instIdx] ?? -1,
      );
      const skeleton = skeletons[skeletonId] ?? skeletons[0];
      const track = trackId >= 0 ? tracks[trackId] : null;

      let instance: Instance | PredictedInstance;
      if (instanceType === 0) {
        const points = slicePoints(pointsData, pointStart, pointEnd);
        instance = new Instance({
          points: pointsFromArray(points, skeleton.nodeNames),
          skeleton,
          track,
          trackingScore,
        });
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
        instance = new PredictedInstance({
          points: predictedPointsFromArray(points, skeleton.nodeNames),
          skeleton,
          track,
          score,
          trackingScore,
        });
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
    if (
      instance &&
      predicted instanceof PredictedInstance &&
      instance instanceof Instance
    ) {
      instance.fromPredicted = predicted;
    }
  }

  return frames;
}

function buildVideoIdMap(
  framesData: Record<string, any[]>,
  videos: Video[],
): Map<number, number> {
  const videoIds = new Set<number>();
  for (const value of framesData.video ?? []) {
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
    const dataset =
      video.backend?.dataset ??
      (video.backendMetadata?.dataset as string | undefined) ??
      "";
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

function readCentroids(
  file: any,
  _videos: Video[],
  tracks: Track[],
): [Centroid, number, number][] {
  const centroidsDs = file.get("centroids");
  if (!centroidsDs) return [];
  const data = normalizeStructDataset(centroidsDs);
  const xs = data.x ?? [];
  const count = xs.length;
  if (!count) return [];

  const categories = readStringMetadata(
    file,
    "centroid_categories",
    centroidsDs,
    "categories",
  );
  const names = readStringMetadata(
    file,
    "centroid_names",
    centroidsDs,
    "names",
  );
  const sources = readStringMetadata(
    file,
    "centroid_sources",
    centroidsDs,
    "sources",
  );

  const ys = data.y ?? [];
  const zs = data.z ?? [];
  const videoIndices = data.video ?? [];
  const frameIndices = data.frame_idx ?? [];
  const trackIndices = data.track ?? [];
  const instanceIndices = data.instance ?? [];
  const isPredictedCol = data.is_predicted ?? [];
  const scores = data.score ?? [];
  const trackingScores = data.tracking_score ?? [];

  const centroids: [Centroid, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const videoIdx = Number(videoIndices[i]);

    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    const zVal = zs.length > i ? Number(zs[i]) : Number.NaN;
    const z = Number.isNaN(zVal) ? null : zVal;

    const tsVal =
      trackingScores.length > i ? Number(trackingScores[i]) : Number.NaN;
    const trackingScore = Number.isNaN(tsVal) ? null : tsVal;

    const instanceIdx = Number(instanceIndices[i]);

    const options = {
      x: Number(xs[i]),
      y: Number(ys[i]),
      z,
      track,
      trackingScore,
      category: categories[i] ?? "",
      name: names[i] ?? "",
      source: sources[i] ?? "",
    };

    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;

    let centroid: Centroid;
    if (isPred) {
      const scoreVal = Number(scores[i]);
      centroid = new PredictedCentroid({
        ...options,
        score: Number.isNaN(scoreVal) ? 0 : scoreVal,
      });
    } else {
      centroid = new UserCentroid(options);
    }

    if (instanceIdx >= 0) {
      centroid._instanceIdx = instanceIdx;
    }

    centroids.push([centroid, videoIdx, frameIdxVal]);
  }
  return centroids;
}

function slicePoints(
  data: Record<string, any[]>,
  start: number,
  end: number,
  predicted = false,
): number[][] {
  const xs = data.x ?? [];
  const ys = data.y ?? [];
  const visible = data.visible ?? [];
  const complete = data.complete ?? [];
  const scores = data.score ?? [];
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
