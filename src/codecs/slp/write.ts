import { Labels } from "../../model/labels.js";
import { type Instance, PredictedInstance } from "../../model/instance.js";
import type { Track } from "../../model/instance.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import type {
  RecordingSession,
  Camera,
  InstanceGroup,
  FrameGroup,
} from "../../model/camera.js";
import type { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import type { Video } from "../../model/video.js";
import { CropVideoBackend } from "../../video/crop-backend.js";
import { getH5Module, getH5FileSystem, ensureH5StagingDir } from "./h5.js";
import { type ROI, type PredictedROI, encodeWkb } from "../../model/roi.js";
import type {
  SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
} from "../../model/mask.js";
import type { BoundingBox, PredictedBoundingBox } from "../../model/bbox.js";
import type { Centroid, PredictedCentroid } from "../../model/centroid.js";
import type {
  LabelImage,
  PredictedLabelImage,
} from "../../model/label-image.js";
import { deflate } from "pako";
import type { Identity } from "../../model/identity.js";
import { Instance3D, PredictedInstance3D } from "../../model/instance3d.js";
import type { LazyDataStore } from "../../model/lazy.js";

// File writer hook — registered by h5-node.ts (imported as side-effect from Node entry point).
let _writeToFile:
  | ((filename: string, bytes: Uint8Array) => Promise<void>)
  | null = null;

/**
 * Register a file writer for Node.js environments.
 * Called as a side-effect when the Node entry point imports h5-node.ts.
 * @internal
 */
export function _registerFileWriter(
  writer: (filename: string, bytes: Uint8Array) => Promise<void>,
): void {
  _writeToFile = writer;
}

const FORMAT_ID = 1.4;
const textEncoder = new TextEncoder();

/** Write a string as a fixed-length HDF5 string attribute (H5T_STRING).
 *  h5py reads fixed-length strings as `bytes`, so Python's `.decode()` works.
 *  Using `S<n>` dtype avoids variable-length strings (returned as `str`)
 *  and uint8 arrays (returned as `numpy.ndarray`). */
function setStringAttr(target: any, name: string, value: string): void {
  const byteLength = textEncoder.encode(value).length;
  target.create_attribute(name, value, null, `S${byteLength}`);
}

/** Write a string array as a JSON-encoded string attribute dataset at root level. */
function writeStringDataset(file: any, name: string, values: string[]): void {
  const json = JSON.stringify(values);
  const bytes = textEncoder.encode(json);
  file.create_dataset({
    name,
    data: bytes,
    shape: [bytes.length],
    dtype: "<B",
  });
  const ds = file.get(name);
  setStringAttr(ds, "json", json);
}

const SPAWNED_ON = 0;

export type SlpWriteOptions = {
  embed?: boolean | string;
  restoreOriginalVideos?: boolean;
};

/** Frame data collected for embedding a single video. */
interface EmbeddedVideoFrames {
  /** Video index in labels.videos */
  videoIndex: number;
  /** Frame indices (original video frame numbers) */
  frameNumbers: number[];
  /** Encoded frame bytes (PNG/JPEG) indexed by frame number */
  frameData: Map<number, Uint8Array>;
  /** Image format (png, jpeg) */
  format: string;
  /** Channel order (RGB, BGR) */
  channelOrder: string;
}

function writeSlpToFile(
  file: any,
  labels: Labels,
  embeddedVideoData?: Map<number, EmbeddedVideoFrames> | null,
): void {
  writeMetadata(file, labels);

  if (embeddedVideoData && embeddedVideoData.size > 0) {
    writeEmbeddedVideos(file, labels, embeddedVideoData);
  } else {
    writeVideos(file, labels.videos);
  }
  writeVideoCrops(file, labels.videos);

  writeTracks(file, labels.tracks);
  writeSuggestions(file, labels.suggestions, labels.videos);
  writeIdentities(file, labels.identities);
  writeSessions(
    file,
    labels.sessions,
    labels.videos,
    labels.labeledFrames,
    labels.identities,
  );
  writeLabeledFrames(file, labels);
  writeNegativeFrames(file, labels);
  const allInstances = labels.labeledFrames.flatMap((f) => f.instances);

  // Build flat annotation lists with routing contexts from parent LabeledFrames
  const allRois: ROI[] = [];
  const roiCtx: [number, number][] = [];
  const allMasks: SegmentationMask[] = [];
  const maskCtx: [number, number][] = [];
  const allBboxes: BoundingBox[] = [];
  const bboxCtx: [number, number][] = [];
  const allCentroids: Centroid[] = [];
  const centroidCtx: [number, number][] = [];
  const allLabelImages: LabelImage[] = [];
  const liCtx: [number, number][] = [];

  for (const lf of labels.labeledFrames) {
    const vidIdx = labels.videos.indexOf(lf.video);
    for (const r of lf.rois) {
      allRois.push(r);
      roiCtx.push([vidIdx, lf.frameIdx]);
    }
    for (const m of lf.masks) {
      allMasks.push(m);
      maskCtx.push([vidIdx, lf.frameIdx]);
    }
    for (const b of lf.bboxes) {
      allBboxes.push(b);
      bboxCtx.push([vidIdx, lf.frameIdx]);
    }
    for (const c of lf.centroids) {
      allCentroids.push(c);
      centroidCtx.push([vidIdx, lf.frameIdx]);
    }
    for (const li of lf.labelImages) {
      allLabelImages.push(li);
      liCtx.push([vidIdx, lf.frameIdx]);
    }
  }
  // Static ROIs
  for (const r of labels._staticRois) {
    allRois.push(r);
    roiCtx.push([r.video ? labels.videos.indexOf(r.video) : -1, -1]);
  }

  writeRois(file, allRois, labels.videos, labels.tracks, allInstances, roiCtx);
  writeMasks(
    file,
    allMasks,
    labels.videos,
    labels.tracks,
    allInstances,
    maskCtx,
  );
  writeBboxes(
    file,
    allBboxes,
    labels.videos,
    labels.tracks,
    allInstances,
    bboxCtx,
  );
  writeCentroids(
    file,
    allCentroids,
    labels.videos,
    labels.tracks,
    allInstances,
    centroidCtx,
  );
  writeLabelImages(
    file,
    allLabelImages,
    labels.videos,
    labels.tracks,
    allInstances,
    liCtx,
  );
}

/**
 * Sentinel error thrown by {@link makeLazySourceLabels} when the lazy source
 * fast path cannot safely swap videos in place (multi-camera sessions
 * referencing a video that's getting swapped). The dispatch layer catches
 * this and falls back to materializing the labels.
 */
class LazySourceFallback extends Error {
  constructor() {
    super("lazy source mode requires materialization");
    this.name = "LazySourceFallback";
  }
}

/**
 * Build a shallow Labels copy with `videos[]` swapped to source paths,
 * suitable for the lazy fast-path writer when `embed: "source"` is set.
 *
 * The lazy data store is keyed by `videoIdx` (not video object identity),
 * so we don't need to remap any annotations — only the `videos[]` array,
 * the `suggestions` (which reference videos by identity), and we need to
 * verify no `RecordingSession` references a video that's being swapped.
 *
 * Note: the eager source-mode path (`saveSlpToBytes`) does NOT remap
 * suggestions or check sessions today. The lazy path here is more correct;
 * fixing eager is a separate follow-up.
 *
 * @throws LazySourceFallback if any session references a swapped video.
 */
function makeLazySourceLabels(labels: Labels): Labels {
  const restoredVideos = labels.videos.map((v) => v.sourceVideo ?? v);
  const videoMap = new Map<Video, Video>();
  for (let i = 0; i < labels.videos.length; i++) {
    if (labels.videos[i] !== restoredVideos[i]) {
      videoMap.set(labels.videos[i], restoredVideos[i]);
    }
  }

  // No swaps needed — just return the original labels.
  if (videoMap.size === 0) return labels;

  // Multi-camera sessions referencing a swapped video are too complex for
  // the lazy fast path. Bail out so the dispatch layer can materialize.
  for (const session of labels.sessions) {
    for (const v of session.videoByCamera.values()) {
      if (videoMap.has(v)) {
        throw new LazySourceFallback();
      }
    }
  }

  const remappedSuggestions = labels.suggestions.map((s) => {
    const newVideo = videoMap.get(s.video);
    if (!newVideo) return s;
    return new SuggestionFrame({
      video: newVideo,
      frameIdx: s.frameIdx,
      group: s.group,
      metadata: s.metadata,
    });
  });

  const out = new Labels({
    videos: restoredVideos,
    skeletons: labels.skeletons,
    tracks: labels.tracks,
    suggestions: remappedSuggestions,
    sessions: labels.sessions, // safe: verified no swapped refs
    identities: labels.identities,
    provenance: labels.provenance,
    rois: labels._staticRois,
  });
  out._lazyFrameList = labels._lazyFrameList;
  out._lazyDataStore = labels._lazyDataStore;
  return out;
}

/**
 * Write `frames`/`instances`/`points`/`pred_points` HDF5 datasets directly
 * from the lazy store's parsed column data, bypassing materialization.
 *
 * The columns are stored as `Record<string, any[]>` (parsed from the original
 * HDF5 reader). We rebuild row-major typed arrays and call the existing
 * {@link createMatrixDataset} helper so we get identical output to the eager
 * writer for these four datasets.
 *
 * TODO: a column-aware fast path could avoid the row rebuild entirely.
 */
function writeLazyMatrixDataset(
  file: any,
  name: string,
  columns: Record<string, any[]>,
  fieldNames: string[],
  dtype: string,
): void {
  const rowCount = (columns[fieldNames[0]] ?? []).length;
  const colCount = fieldNames.length;
  const rows: number[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const row = new Array<number>(colCount);
    for (let j = 0; j < colCount; j++) {
      const col = columns[fieldNames[j]] ?? [];
      const v = col[i];
      row[j] = v === undefined || v === null ? 0 : Number(v);
    }
    rows.push(row);
  }
  createMatrixDataset(file, name, rows, fieldNames, dtype);
}

function writeLazyFramesAndInstances(file: any, store: LazyDataStore): void {
  writeLazyMatrixDataset(
    file,
    "frames",
    store.framesData,
    ["frame_id", "video", "frame_idx", "instance_id_start", "instance_id_end"],
    "<i8",
  );
  writeLazyMatrixDataset(
    file,
    "instances",
    store.instancesData,
    [
      "instance_id",
      "instance_type",
      "frame_id",
      "skeleton",
      "track",
      "from_predicted",
      "score",
      "point_id_start",
      "point_id_end",
      "tracking_score",
    ],
    "<f8",
  );
  writeLazyMatrixDataset(
    file,
    "points",
    store.pointsData,
    ["x", "y", "visible", "complete"],
    "<f8",
  );
  writeLazyMatrixDataset(
    file,
    "pred_points",
    store.predPointsData,
    ["x", "y", "visible", "complete", "score"],
    "<f8",
  );
}

function writeLazyNegativeFrames(file: any, store: LazyDataStore): void {
  if (store.negativeFrames.size === 0) return;
  const rows: number[][] = [];
  for (const key of store.negativeFrames) {
    const [vidStr, fidxStr] = key.split(":");
    rows.push([Number(vidStr), Number(fidxStr)]);
  }
  // Deterministic ordering for byte-stable output.
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  createMatrixDataset(
    file,
    "negative_frames",
    rows,
    ["video_id", "frame_idx"],
    "<i8",
  );
}

/**
 * Lazy fast-path SLP writer. Mirrors Python's `_write_labels_lazy`.
 *
 * Reuses metadata writers (which only depend on eager `Labels` fields like
 * `videos`/`tracks`/`suggestions`/`identities`/`sessions`/`provenance`) and
 * pulls frames/instances/points/pred_points/negative_frames + per-type
 * annotation maps directly from `LazyDataStore`. No `LabeledFrame` or
 * `Instance` objects are constructed in this path.
 *
 * Limitations (matching Python):
 *   - `writeSessions` is called with an empty `labeledFrames` list, so any
 *     `FrameGroup` references that resolve via labeled-frame index are lost.
 *   - Instance associations on annotations are persisted via the stored
 *     `_instanceIdx` field (no live `instance` references in lazy mode).
 *
 * @throws Error if `labels.isLazy` is false or the lazy store is missing.
 */
function writeSlpToFileLazy(file: any, labels: Labels): void {
  const store = labels._lazyDataStore;
  if (!labels.isLazy || !store) {
    throw new Error(
      "writeSlpToFileLazy requires lazy Labels with a data store",
    );
  }

  writeMetadata(file, labels);
  writeVideos(file, labels.videos);
  writeVideoCrops(file, labels.videos);
  writeTracks(file, labels.tracks);
  writeSuggestions(file, labels.suggestions, labels.videos);
  writeIdentities(file, labels.identities);
  // Sessions: pass empty labeledFrames since they aren't materialized.
  // Frame-group refs resolved by lf index will be lost — matches Python.
  writeSessions(file, labels.sessions, labels.videos, [], labels.identities);

  writeLazyFramesAndInstances(file, store);
  writeLazyNegativeFrames(file, store);

  // Build per-type (annotation, context) pairs from the lazy store maps.
  // Per-frame Map keys are "vidIdx:frameIdx" strings (see read.ts).
  const allRois: ROI[] = [];
  const roiCtx: [number, number][] = [];
  const allMasks: SegmentationMask[] = [];
  const maskCtx: [number, number][] = [];
  const allBboxes: BoundingBox[] = [];
  const bboxCtx: [number, number][] = [];
  const allCentroids: Centroid[] = [];
  const centroidCtx: [number, number][] = [];
  const allLabelImages: LabelImage[] = [];
  const liCtx: [number, number][] = [];

  const collectFrameBound = <T>(
    byFrame: Map<string, T[]>,
    out: T[],
    ctxOut: [number, number][],
  ): void => {
    for (const [key, list] of byFrame) {
      const [vidStr, fidxStr] = key.split(":");
      const vidIdx = Number(vidStr);
      const fidx = Number(fidxStr);
      for (const ann of list) {
        out.push(ann);
        ctxOut.push([vidIdx, fidx]);
      }
    }
  };

  collectFrameBound(store._roiByFrame, allRois, roiCtx);
  collectFrameBound(store._maskByFrame, allMasks, maskCtx);
  collectFrameBound(store._bboxByFrame, allBboxes, bboxCtx);
  collectFrameBound(store._centroidByFrame, allCentroids, centroidCtx);
  collectFrameBound(store._labelImageByFrame, allLabelImages, liCtx);

  // Undistributed ROIs (static ROIs): preserve the video association by
  // looking up videos.indexOf(roi.video) instead of using -1. The other
  // four undistributed lists shouldn't have annotations with .video after
  // PR #94 (those classes no longer carry video), so they always use -1.
  // Mirrors the fix from Python sleap-io PR #414 (talmolab/sleap-io); the
  // JS port already had this in place via Side fix B and is covered by
  // tests/lazy-write.test.ts "preserves static ROI video association".
  for (const roi of store._undistributedRois) {
    allRois.push(roi);
    const vidIdx = roi.video ? labels.videos.indexOf(roi.video) : -1;
    roiCtx.push([vidIdx, -1]);
  }
  for (const m of store._undistributedMasks) {
    allMasks.push(m);
    maskCtx.push([-1, -1]);
  }
  for (const b of store._undistributedBboxes) {
    allBboxes.push(b);
    bboxCtx.push([-1, -1]);
  }
  for (const c of store._undistributedCentroids) {
    allCentroids.push(c);
    centroidCtx.push([-1, -1]);
  }
  for (const li of store._undistributedLabelImages) {
    allLabelImages.push(li);
    liCtx.push([-1, -1]);
  }

  // Pass undefined for `instances` so each writer uses the _instanceIdx
  // fallback (Side fix A) for any annotations with deferred instance links.
  writeRois(file, allRois, labels.videos, labels.tracks, undefined, roiCtx);
  writeMasks(file, allMasks, labels.videos, labels.tracks, [], maskCtx);
  writeBboxes(file, allBboxes, labels.videos, labels.tracks, [], bboxCtx);
  writeCentroids(
    file,
    allCentroids,
    labels.videos,
    labels.tracks,
    [],
    centroidCtx,
  );
  writeLabelImages(
    file,
    allLabelImages,
    labels.videos,
    labels.tracks,
    [],
    liCtx,
  );
}

/**
 * Serialize Labels to SLP format and return the bytes.
 * Works in both Node.js and browser environments.
 *
 * When `embed` is set, video frames are read from their backends and stored
 * directly in the SLP file as HDF5 datasets (video0/video, video1/video, etc.).
 * The video backends must be open and able to return frame data.
 *
 * Supported embed modes:
 * - `true` or `"all"` - Embed all labeled frames
 * - `"user"` - Embed only frames with user instances
 * - `"suggestions"` - Embed only suggestion frames
 * - `"user+suggestions"` - Embed user instance frames and suggestion frames
 * - `"source"` - Restore original video paths (no embedding)
 */
export async function saveSlpToBytes(
  labels: Labels,
  options?: SlpWriteOptions,
): Promise<Uint8Array> {
  const embedMode = options?.embed ?? false;

  // Lazy fast path: skip materialization for embed modes that don't need
  // to read pixel data from videos. Mirrors Python's write_labels dispatch.
  if (labels.isLazy) {
    const needsMaterialization =
      embedMode === true ||
      embedMode === "all" ||
      embedMode === "user" ||
      embedMode === "suggestions" ||
      embedMode === "user+suggestions";

    if (!needsMaterialization) {
      let lazyWriteLabels: Labels = labels;
      let proceedWithFastPath = true;

      if (embedMode === "source") {
        try {
          lazyWriteLabels = makeLazySourceLabels(labels);
        } catch (e) {
          if (e instanceof LazySourceFallback) {
            // Multi-camera session references would break under the swap.
            // Fall back to materialization + the eager source-mode path.
            labels.materialize();
            proceedWithFastPath = false;
          } else {
            throw e;
          }
        }
      }

      if (proceedWithFastPath) {
        const module = await getH5Module();
        ensureH5StagingDir(module);
        const memPath = `/tmp/sleap_output_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;
        const file = new module.File(memPath, "w");
        try {
          writeSlpToFileLazy(file, lazyWriteLabels);
        } finally {
          file.close();
        }
        const fs = getH5FileSystem(module);
        const bytes = fs.readFile!(memPath);
        fs.unlink!(memPath);
        return bytes;
      }
    } else {
      // Embed modes that need pixel data: materialize and continue with eager path.
      labels.materialize();
    }
  }

  // Source mode: restore original video paths before writing
  let writeLabels = labels;
  if (embedMode === "source") {
    const restoredVideos = labels.videos.map((video) => {
      if (video.sourceVideo) return video.sourceVideo;
      return video;
    });
    writeLabels = new Labels({
      labeledFrames: labels.labeledFrames.map((frame) => {
        const videoIdx = labels.videos.indexOf(frame.video);
        const restoredVideo =
          videoIdx >= 0 ? restoredVideos[videoIdx] : frame.video;
        return new LabeledFrame({
          video: restoredVideo,
          frameIdx: frame.frameIdx,
          instances: frame.instances,
          centroids: frame.centroids,
          bboxes: frame.bboxes,
          masks: frame.masks,
          labelImages: frame.labelImages,
          rois: frame.rois,
        });
      }),
      videos: restoredVideos,
      skeletons: labels.skeletons,
      tracks: labels.tracks,
      suggestions: labels.suggestions,
      sessions: labels.sessions,
      provenance: labels.provenance,
      rois: labels._staticRois,
      identities: labels.identities,
    });
  }

  const module = await getH5Module();
  ensureH5StagingDir(module);
  const memPath = `/tmp/sleap_output_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;

  // If embedding, we need to determine frames per video and prepare embedded data
  let embeddedVideoData: Map<number, EmbeddedVideoFrames> | null = null;
  if (embedMode && embedMode !== "source") {
    embeddedVideoData = await collectFramesForEmbedding(labels, embedMode);
  }

  const file = new module.File(memPath, "w");
  try {
    writeSlpToFile(file, writeLabels, embeddedVideoData);
  } finally {
    file.close();
  }

  const fs = getH5FileSystem(module);
  const bytes = fs.readFile!(memPath);
  fs.unlink!(memPath);
  return bytes;
}

export async function writeSlp(
  filename: string,
  labels: Labels,
  options?: SlpWriteOptions,
): Promise<void> {
  const bytes = await saveSlpToBytes(labels, options);

  if (_writeToFile) {
    await _writeToFile(filename, bytes);
  } else {
    throw new Error(
      "writeSlp requires a Node.js environment for file I/O. " +
        "Use saveSlpToBytes() to get the SLP data as a Uint8Array in the browser.",
    );
  }
}

function writeMetadata(file: any, labels: Labels): void {
  const { skeletons, nodes } = serializeSkeletons(labels.skeletons);
  const metadata = {
    version: "2.0.0",
    skeletons,
    nodes,
    videos: [],
    tracks: [],
    suggestions: [],
    negative_anchors: {},
    provenance: labels.provenance ?? {},
  };

  const hasRoiInstance = labels.rois.some((roi) => roi.instance !== null);
  const hasIdentities = (labels.identities?.length ?? 0) > 0;
  const hasPredicted =
    labels.rois.some((r) => r.isPredicted) ||
    labels.masks.some((m) => m.isPredicted) ||
    (labels.labelImages ?? []).some((li) => li.isPredicted);
  const hasMaskInstances = labels.masks.some(
    (m) =>
      m.instance !== null || (m._instanceIdx != null && m._instanceIdx >= 0),
  );
  let formatId =
    (labels.bboxes?.length ?? 0) > 0
      ? 2.0
      : hasPredicted || hasMaskInstances
        ? 1.9
        : (labels.labelImages?.length ?? 0) > 0
          ? 1.8
          : hasRoiInstance
            ? 1.6
            : labels.rois.length > 0 || labels.masks.length > 0
              ? 1.5
              : FORMAT_ID;
  if (hasIdentities) {
    formatId = Math.max(formatId, 1.9);
  }

  // v2.1: spatial transform metadata on masks or label images
  const hasSpatialTransform =
    labels.masks.some((m) => m.hasSpatialTransform) ||
    (labels.labelImages ?? []).some((li) => li.hasSpatialTransform);
  if (hasSpatialTransform) {
    formatId = Math.max(formatId, 2.1);
  }

  // v2.3: virtual on-read video crops (/video_crops dataset). Bumped ONLY when a
  // video is cropped, so uncropped files keep their lower format_id. 2.3 is
  // purely additive — old readers (<= 2.2) skip /video_crops and read the
  // uncropped videos_json safely. Port of Python write_metadata (slp.py:1891-1895).
  if (labels.videos.some((v) => v._cropTuple() !== null)) {
    formatId = Math.max(formatId, 2.3);
  }

  // v2.4: persisted mask from_predicted provenance link. Bumped ONLY when some
  // user mask actually records a *resolvable* link — i.e. its source prediction
  // is itself in the saved mask list (object identity), mirroring the persisted
  // from_predicted index being >= 0. A dangling link (source omitted from the
  // saved frames) writes -1 and must NOT bump the format. The from_predicted
  // column is always written; reads are presence-gated so pre-2.4 files load the
  // link as null.
  const savedMasks = labels.masks;
  const savedMaskSet = new Set<SegmentationMask>(savedMasks);
  if (
    savedMasks.some(
      (m) =>
        (m as UserSegmentationMask).fromPredicted != null &&
        savedMaskSet.has(
          (m as UserSegmentationMask).fromPredicted as SegmentationMask,
        ),
    )
  ) {
    formatId = Math.max(formatId, 2.4);
  }

  // NOTE (sessions): the canonical `sessions_json` shape written here
  // (calibration keyed `cam_<i>`, camcorder/labeled_frame maps keyed by integer
  // index) is a CONVERGENCE to Python `sleap-io`'s existing format — not a new
  // on-disk feature — so it deliberately does NOT bump format_id. `format_id` is
  // a namespace shared with Python, which already defines 2.5 (/identity_links),
  // 2.6 (/embeddings) and 2.7 (categories); minting a value here would collide
  // and mislabel the file. Reading stays tolerant of the legacy name-keyed shape,
  // so re-saving a legacy file upgrades its sessions to the canonical shape with
  // no version change required.

  file.create_group("metadata");
  const metadataGroup = file.get("metadata");
  metadataGroup.create_attribute("format_id", formatId);
  setStringAttr(metadataGroup, "json", JSON.stringify(metadata));
}

function serializeSkeletons(skeletons: Skeleton[]): {
  skeletons: any[];
  nodes: Array<{ name: string }>;
} {
  const nodes: Array<{ name: string }> = [];
  const nodeIndex = new Map<string, number>();

  for (const skeleton of skeletons) {
    for (const nodeName of skeleton.nodeNames) {
      if (!nodeIndex.has(nodeName)) {
        nodeIndex.set(nodeName, nodes.length);
        nodes.push({ name: nodeName });
      }
    }
  }

  const serialized = skeletons.map((skeleton) => {
    const links: Array<Record<string, any>> = [];
    // Track py/id assignments for edge types (jsonpickle convention).
    // First occurrence of each edge type gets py/reduce; subsequent get py/id.
    const edgeTypePyId: Record<number, number> = {};
    let nextPyId = 1;
    let edgeInsertIdx = 0;

    function makeEdgeType(typeVal: number): any {
      if (edgeTypePyId[typeVal] != null) {
        return { "py/id": edgeTypePyId[typeVal] };
      }
      edgeTypePyId[typeVal] = nextPyId++;
      return {
        "py/reduce": [
          { "py/type": "sleap.skeleton.EdgeType" },
          { "py/tuple": [typeVal] },
        ],
      };
    }

    for (const edge of skeleton.edges) {
      const source = nodeIndex.get(edge.source.name) ?? 0;
      const target = nodeIndex.get(edge.destination.name) ?? 0;
      links.push({
        edge_insert_idx: edgeInsertIdx++,
        key: 0,
        source,
        target,
        type: makeEdgeType(1),
      });
    }

    for (const [left, right] of skeleton.symmetryNames) {
      const source = nodeIndex.get(left) ?? 0;
      const target = nodeIndex.get(right) ?? 0;
      links.push({ key: 0, source, target, type: makeEdgeType(2) });
    }

    // Build per-skeleton node index list (global indices of this skeleton's nodes)
    const skeletonNodeIds = skeleton.nodeNames.map(
      (name) => nodeIndex.get(name) ?? 0,
    );

    return {
      directed: true,
      graph: {
        name: skeleton.name ?? "",
        num_edges_inserted: skeleton.edges.length,
      },
      links,
      multigraph: true,
      nodes: skeletonNodeIds.map((id) => ({ id })),
    };
  });

  return { skeletons: serialized, nodes };
}

function writeVideos(file: any, videos: Video[]): void {
  const payload = videos.map((video) => JSON.stringify(serializeVideo(video)));
  file.create_dataset({ name: "videos_json", data: payload });
}

function serializeVideo(video: Video): Record<string, unknown> {
  const backend = { ...(video.backendMetadata ?? {}) } as Record<
    string,
    unknown
  >;
  if (backend.filename == null) backend.filename = video.filename;

  // Crop unwrap (SLP 2.3): a cropped Video serializes as its UNCROPPED inner so
  // videos_json describes the full frame and old readers never hit an unknown
  // wrapper type. The crop rides /video_crops (see writeVideoCrops); it must NOT
  // enter videos_json. Port of Python video_to_dict (slp.py:503-580).
  const liveBackend = video.backend;
  if (liveBackend instanceof CropVideoBackend) {
    const inner = liveBackend.inner;
    if (inner instanceof CropVideoBackend) {
      // A nested (un-flattened) crop-of-crop can't be represented by the
      // single-crop-per-video /video_crops schema. wrap() only nests when fills
      // differ or the outer rect exceeds the inner frame.
      throw new Error(
        "Cannot serialize a nested crop-of-crop video: the /video_crops format " +
          "stores a single crop per video. Flatten the crop (use matching fills " +
          "and an in-bounds region) before saving.",
      );
    }
    // Serialize the inner's full-frame shape/dataset/fps, not the cropped facade.
    const innerShape =
      inner.shape ??
      (backend.source_shape as number[] | undefined) ??
      video.sourceVideo?.shape;
    if (innerShape != null) backend.shape = [...innerShape];
    else delete backend.shape;
    if (inner.dataset != null) backend.dataset = inner.dataset;
    if (inner.fps != null) backend.fps = inner.fps;
  } else if (liveBackend == null && "crop" in backend) {
    // Closed cropped path: backendMetadata carries the CROPPED shape plus a crop
    // record. Restore the UNCROPPED source shape so videos_json describes the
    // full frame; refuse to emit a self-inconsistent entry when unavailable.
    let srcShape: number[] | null = null;
    if (video.sourceVideo?.shape != null) {
      srcShape = [...video.sourceVideo.shape];
    } else if (backend.source_shape != null) {
      srcShape = [...(backend.source_shape as number[])];
    }
    if (srcShape == null) {
      throw new Error(
        "Cannot serialize closed cropped video: the uncropped source shape is " +
          "unavailable (no source_video and no recorded source_shape), so " +
          "videos_json cannot describe the full frame.",
      );
    }
    backend.shape = srcShape;
  } else {
    if (backend.dataset == null && liveBackend?.dataset)
      backend.dataset = liveBackend.dataset;
    if (backend.shape == null && liveBackend?.shape)
      backend.shape = liveBackend.shape;
    if (backend.fps == null && liveBackend?.fps != null)
      backend.fps = liveBackend.fps;
  }

  // Strip crop keys from videos_json regardless of path (they ride /video_crops).
  delete backend.crop;
  delete backend.crop_fill;
  delete backend.source_shape;

  const entry: Record<string, unknown> = {
    filename: video.filename,
    backend,
  };

  if (video.sourceVideo) {
    entry.source_video = { filename: video.sourceVideo.filename };
  }

  return entry;
}

/**
 * Write the top-level `/video_crops` dataset (SLP format 2.3) when at least one
 * video carries a virtual crop. Port of Python `write_video_crops`
 * (slp.py:683-711).
 *
 * Emits one `{ video, crop: [x1,y1,x2,y2], fill }` entry per cropped video in
 * `videos` order, encoded as a single compact JSON string in a length-1 vlen
 * string array — the only h5wasm-producible form accepted by Python's
 * `read_video_crops` (the scalar `np.bytes_` form Python writes is read-equivalent).
 * The dataset is omitted entirely when no video is cropped so uncropped files
 * stay byte-identical and old readers never see an unknown dataset.
 */
function writeVideoCrops(file: any, videos: Video[]): void {
  const crops: Array<Record<string, unknown>> = [];
  for (let i = 0; i < videos.length; i++) {
    const rect = videos[i]._cropTuple();
    if (rect == null) continue;
    crops.push({ video: i, crop: [...rect], fill: videos[i]._cropFill() });
  }
  if (crops.length === 0) return;
  // JSON.stringify uses no spaces by default, matching Python's
  // json.dumps(separators=(",",":")) byte-for-byte.
  const payload = JSON.stringify(crops);
  file.create_dataset({ name: "video_crops", data: [payload] });
}

function writeTracks(file: any, tracks: Array<{ name: string }>): void {
  const payload = tracks.map((track) =>
    JSON.stringify([SPAWNED_ON, track.name]),
  );
  file.create_dataset({ name: "tracks_json", data: payload });
}

function writeSuggestions(
  file: any,
  suggestions: SuggestionFrame[],
  videos: Video[],
): void {
  const payload = suggestions.map((suggestion) =>
    JSON.stringify({
      video: String(videos.indexOf(suggestion.video)),
      frame_idx: suggestion.frameIdx,
      group: suggestion.group ?? "default",
    }),
  );
  file.create_dataset({ name: "suggestions_json", data: payload });
}

function writeIdentities(file: any, identities: Identity[]): void {
  if (!identities.length) return;
  const payload = identities.map((identity) => {
    const d: Record<string, unknown> = { name: identity.name };
    if (identity.color != null) d.color = identity.color;
    for (const [key, value] of Object.entries(identity.metadata)) {
      if (key !== "name" && key !== "color") {
        d[key] = value;
      }
    }
    return JSON.stringify(d);
  });
  file.create_dataset({ name: "identities_json", data: payload });
}

function writeSessions(
  file: any,
  sessions: RecordingSession[],
  videos: Video[],
  labeledFrames: LabeledFrame[],
  identities?: Identity[],
): void {
  const labeledFrameIndex = new Map<LabeledFrame, number>();
  labeledFrames.forEach((lf, idx) => {
    labeledFrameIndex.set(lf, idx);
  });

  const payload = sessions.map((session) =>
    JSON.stringify(
      serializeSession(session, videos, labeledFrameIndex, identities),
    ),
  );
  file.create_dataset({ name: "sessions_json", data: payload });
}

function serializeSession(
  session: RecordingSession,
  videos: Video[],
  labeledFrameIndex: Map<LabeledFrame, number>,
  identities?: Identity[],
): Record<string, unknown> {
  const calibration: Record<string, unknown> = {
    metadata: session.cameraGroup.metadata ?? {},
  };
  // Key calibration by `cam_<index>` to match Python `sleap-io`'s
  // `camera_group_to_dict` byte-for-byte (keeps our on-disk shape a clean subset
  // of the Python format, per the "upstreamable" goal). The calibration key is
  // cosmetic on read — both readers resolve cameras by dict ORDER / positional
  // index, and the camcorder maps below key by bare integer index
  // (cameraKeyForSession = String(index)), exactly as Python does. `name` is
  // kept as a field inside each camera dict.
  session.cameraGroup.cameras.forEach((camera, idx) => {
    const key = `cam_${idx}`;
    const camData: Record<string, unknown> = {
      name: camera.name ?? key,
      rotation: camera.rvec,
      translation: camera.tvec,
      matrix: camera.matrix,
      distortions: camera.distortions,
    };
    if (camera.size) camData.size = camera.size;
    calibration[key] = camData;
  });

  const camcorder_to_video_idx_map: Record<string, number> = {};
  for (const [camera, video] of session.videoByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    const videoIndex = videos.indexOf(video);
    if (cameraKey !== "-1" && videoIndex >= 0) {
      camcorder_to_video_idx_map[cameraKey] = videoIndex;
    }
  }

  const frame_group_dicts: Record<string, unknown>[] = [];
  for (const frameGroup of session.frameGroups.values()) {
    if (!frameGroup.instanceGroups.length) continue;
    frame_group_dicts.push(
      serializeFrameGroup(frameGroup, session, labeledFrameIndex, identities),
    );
  }

  return {
    calibration,
    camcorder_to_video_idx_map,
    frame_group_dicts,
    metadata: session.metadata ?? {},
  };
}

function serializeFrameGroup(
  frameGroup: FrameGroup,
  session: RecordingSession,
  labeledFrameIndex: Map<LabeledFrame, number>,
  identities?: Identity[],
): Record<string, unknown> {
  const instance_groups = frameGroup.instanceGroups.map((group) =>
    serializeInstanceGroup(
      group,
      session,
      identities,
      frameGroup,
      labeledFrameIndex,
    ),
  );
  // Derive-then-ref-fallback (hybrid write-back), reading RAW backing fields so
  // an untouched (lazy) group serializes from its stored refs with ZERO frame
  // materialization, while a mutated/in-memory group re-derives indices from the
  // concrete map (reflecting any reorder/edit). Never touches the caching getter
  // (that would materialize + cache between the two saves of the round-trip
  // equality test).
  const concreteLfByCamera = frameGroup._labeledFrameByCamera;
  const lfRefsByCamera = frameGroup._labeledFrameRefsByCamera;
  const labeled_frame_by_camera: Record<string, number> = {};
  const frameCameras = new Set<Camera>([
    ...(concreteLfByCamera?.keys() ?? []),
    ...(lfRefsByCamera?.keys() ?? []),
  ]);
  for (const camera of frameCameras) {
    const cameraKey = cameraKeyForSession(camera, session);
    const labeledFrame = concreteLfByCamera?.get(camera);
    let index =
      labeledFrame !== undefined
        ? labeledFrameIndex.get(labeledFrame)
        : undefined;
    if (index === undefined) index = lfRefsByCamera?.get(camera);
    if (index !== undefined) {
      labeled_frame_by_camera[cameraKey] = index;
    }
  }

  return {
    frame_idx: frameGroup.frameIdx,
    instance_groups,
    labeled_frame_by_camera,
    metadata: frameGroup.metadata ?? {},
  };
}

function serializeInstanceGroup(
  group: InstanceGroup,
  session: RecordingSession,
  identities?: Identity[],
  frameGroup?: FrameGroup,
  labeledFrameIndex?: Map<LabeledFrame, number>,
): Record<string, unknown> {
  // Hybrid write-back: read RAW backing fields (never the caching getter, which
  // would materialize + cache concrete maps between the two saves of the
  // round-trip equality test). Per camera: try OBJECT DERIVATION first
  // (labeledFrameIndex.get(lf) + lf.instances.indexOf(inst)) so any
  // mutation/reorder is reflected; FALL BACK to the stored index refs when the
  // group was never materialized (lazy pure-ref group). `instances` points are
  // emitted ONLY for concrete groups (pure-ref groups omit `instances`, matching
  // Python-canonical shape) — zero frame materialization for untouched groups.
  const concreteInst = group._instanceByCamera;
  const instRefs = group._instanceRefsByCamera;
  // Resolve the frame group's labeled-frame map ONLY when this instance group is
  // concrete (materialized/in-memory) — via the GETTER, not the raw field, so
  // derivation works even when the consumer reached the mutation through
  // `instanceByCamera` alone (which does NOT populate the frame group's raw map).
  // For a concrete instance group the frames are already materialized, so the
  // getter resolves from cache with no NEW materialization; for an untouched
  // pure-ref group `concreteInst` is undefined, so we never touch the getter and
  // the zero-materialization guarantee holds.
  const lfByCamera =
    concreteInst && frameGroup ? frameGroup.labeledFrameByCamera : undefined;

  const instances: Record<string, Record<string, number[]>> = {};
  const camcorder_to_lf_and_inst_idx_map: Record<string, [number, number]> = {};
  const instCameras = new Set<Camera>([
    ...(concreteInst?.keys() ?? []),
    ...(instRefs?.keys() ?? []),
  ]);
  for (const camera of instCameras) {
    const cameraKey = cameraKeyForSession(camera, session);
    const instance = concreteInst?.get(camera);
    let pair: [number, number] | undefined;
    if (instance) {
      if (labeledFrameIndex) {
        const labeledFrame = lfByCamera?.get(camera);
        const lfIdx =
          labeledFrame !== undefined
            ? labeledFrameIndex.get(labeledFrame)
            : undefined;
        const instIdx = labeledFrame
          ? labeledFrame.instances.indexOf(instance as Instance)
          : -1;
        if (lfIdx !== undefined && instIdx >= 0) pair = [lfIdx, instIdx];
      }
      instances[cameraKey] = pointsToDict(instance);
    }
    if (!pair && instRefs?.has(camera)) pair = instRefs.get(camera);
    if (pair) camcorder_to_lf_and_inst_idx_map[cameraKey] = pair;
  }

  const payload: Record<string, unknown> = {};
  if (Object.keys(instances).length > 0) {
    payload.instances = instances;
  }
  if (Object.keys(camcorder_to_lf_and_inst_idx_map).length > 0) {
    payload.camcorder_to_lf_and_inst_idx_map = camcorder_to_lf_and_inst_idx_map;
  }
  if (group.score != null) payload.score = group.score;

  // 3D points — serialize from Instance3D if present, otherwise raw points
  if (group.instance3d) {
    if (group.instance3d.points) {
      payload.points = group.instance3d.points;
    }
    if (group.instance3d.score != null) {
      payload.instance_3d_score = group.instance3d.score;
    }
    if (
      group.instance3d instanceof PredictedInstance3D &&
      group.instance3d.pointScores
    ) {
      payload.instance_3d_point_scores = group.instance3d.pointScores;
    }
  } else if (group.points != null) {
    payload.points = group.points;
  }

  // Identity — serialize as index into Labels.identities
  if (group.identity && identities) {
    const identityIdx = identities.indexOf(group.identity);
    if (identityIdx >= 0) {
      payload.identity_idx = identityIdx;
    } else {
      console.warn(
        `InstanceGroup references an Identity ("${group.identity.name}") not found in Labels.identities — identity will be dropped on save.`,
      );
    }
  }

  if (group.metadata && Object.keys(group.metadata).length)
    payload.metadata = group.metadata;
  return payload;
}

function pointsToDict(instance: Instance): Record<string, number[]> {
  const names = instance.skeleton.nodeNames;
  const dict: Record<string, number[]> = {};
  instance.points.forEach((point, idx) => {
    const name = point.name ?? names[idx] ?? String(idx);
    const row = [
      point.xy[0],
      point.xy[1],
      point.visible ? 1 : 0,
      point.complete ? 1 : 0,
    ];
    if (point.score != null) {
      row.push(point.score);
    }
    dict[name] = row;
  });
  return dict;
}

function cameraKeyForSession(
  camera: Camera,
  session: RecordingSession,
): string {
  return String(session.cameraGroup.cameras.indexOf(camera));
}

function writeLabeledFrames(file: any, labels: Labels): void {
  const frames: number[][] = [];
  const instances: number[][] = [];
  const points: number[][] = [];
  const predPoints: number[][] = [];
  const instanceIndex = new Map<Instance, number>();
  const predictedLinks: Array<[number, PredictedInstance]> = [];

  for (const labeledFrame of labels.labeledFrames) {
    const frameId = frames.length;
    const instanceStart = instances.length;
    const videoIndex = Math.max(0, labels.videos.indexOf(labeledFrame.video));

    for (const instance of labeledFrame.instances) {
      const instanceId = instances.length;
      instanceIndex.set(instance as Instance, instanceId);

      const skeletonId = Math.max(
        0,
        labels.skeletons.indexOf(instance.skeleton),
      );
      const trackId = instance.track
        ? labels.tracks.indexOf(instance.track)
        : -1;
      const trackingScore = instance.trackingScore ?? 0;
      const fromPredicted = -1;
      let score = 0;
      let pointStart = 0;
      let pointEnd = 0;

      if (instance instanceof PredictedInstance) {
        score = instance.score ?? 0;
        pointStart = predPoints.length;
        for (const point of instance.points) {
          predPoints.push([
            point.xy[0],
            point.xy[1],
            point.visible ? 1 : 0,
            point.complete ? 1 : 0,
            (point as any).score ?? 0,
          ]);
        }
        pointEnd = predPoints.length;
      } else {
        pointStart = points.length;
        for (const point of instance.points) {
          points.push([
            point.xy[0],
            point.xy[1],
            point.visible ? 1 : 0,
            point.complete ? 1 : 0,
          ]);
        }
        pointEnd = points.length;
        if (instance.fromPredicted) {
          predictedLinks.push([instanceId, instance.fromPredicted]);
        }
      }

      instances.push([
        instanceId,
        instance instanceof PredictedInstance ? 1 : 0,
        frameId,
        skeletonId,
        trackId,
        fromPredicted,
        score,
        pointStart,
        pointEnd,
        trackingScore,
      ]);
    }

    const instanceEnd = instances.length;
    frames.push([
      frameId,
      videoIndex,
      labeledFrame.frameIdx,
      instanceStart,
      instanceEnd,
    ]);
  }

  for (const [instanceId, fromPredictedInstance] of predictedLinks) {
    const fromIndex = instanceIndex.get(fromPredictedInstance as Instance);
    if (fromIndex != null) {
      instances[instanceId][5] = fromIndex;
    } else {
      instances[instanceId][5] = -1;
    }
  }

  createMatrixDataset(
    file,
    "frames",
    frames,
    ["frame_id", "video", "frame_idx", "instance_id_start", "instance_id_end"],
    "<i8",
  );
  createMatrixDataset(
    file,
    "instances",
    instances,
    [
      "instance_id",
      "instance_type",
      "frame_id",
      "skeleton",
      "track",
      "from_predicted",
      "score",
      "point_id_start",
      "point_id_end",
      "tracking_score",
    ],
    "<f8",
  );
  createMatrixDataset(
    file,
    "points",
    points,
    ["x", "y", "visible", "complete"],
    "<f8",
  );
  createMatrixDataset(
    file,
    "pred_points",
    predPoints,
    ["x", "y", "visible", "complete", "score"],
    "<f8",
  );
}

function writeNegativeFrames(file: any, labels: Labels): void {
  const negativeFrames = labels.labeledFrames.filter((f) => f.isNegative);
  if (!negativeFrames.length) return;
  const rows: number[][] = [];
  for (const frame of negativeFrames) {
    const videoIndex = Math.max(0, labels.videos.indexOf(frame.video));
    rows.push([videoIndex, frame.frameIdx]);
  }
  createMatrixDataset(
    file,
    "negative_frames",
    rows,
    ["video_id", "frame_idx"],
    "<i8",
  );
}

/**
 * Collect frame data for embedding from video backends.
 */
async function collectFramesForEmbedding(
  labels: Labels,
  embedMode: boolean | string,
): Promise<Map<number, EmbeddedVideoFrames>> {
  const result = new Map<number, EmbeddedVideoFrames>();

  // Determine which frame indices to embed per video
  const framesByVideo = new Map<number, Set<number>>();
  const mode = embedMode === true ? "all" : String(embedMode).toLowerCase();

  for (const frame of labels.labeledFrames) {
    const videoIndex = labels.videos.indexOf(frame.video);
    if (videoIndex < 0) continue;

    let include = false;
    if (mode === "all") {
      include = true;
    } else if (mode === "user") {
      include = frame.hasUserInstances;
    } else if (mode === "suggestions") {
      // Include if this frame is a suggestion
      include = false; // handled below
    } else if (mode === "user+suggestions") {
      include = frame.hasUserInstances;
    }

    if (include) {
      if (!framesByVideo.has(videoIndex))
        framesByVideo.set(videoIndex, new Set());
      framesByVideo.get(videoIndex)!.add(frame.frameIdx);
    }
  }

  // Add suggestion frames
  if (mode === "suggestions" || mode === "user+suggestions") {
    for (const suggestion of labels.suggestions) {
      const videoIndex = labels.videos.indexOf(suggestion.video);
      if (videoIndex < 0) continue;
      if (!framesByVideo.has(videoIndex))
        framesByVideo.set(videoIndex, new Set());
      framesByVideo.get(videoIndex)!.add(suggestion.frameIdx);
    }
  }

  // Read frames from backends
  for (const [videoIndex, frameIndices] of framesByVideo) {
    const video = labels.videos[videoIndex];
    if (!video || !video.backend) continue;

    const sortedFrames = Array.from(frameIndices).sort((a, b) => a - b);
    const frameData = new Map<number, Uint8Array>();

    for (const frameIdx of sortedFrames) {
      const frame = await video.getFrame(frameIdx);
      if (frame) {
        const bytes = frameToBytes(frame);
        if (bytes) {
          frameData.set(frameIdx, bytes);
        }
      }
    }

    if (frameData.size > 0) {
      const backendFormat = (video.backendMetadata?.format as string) ?? "png";
      const backendChannelOrder =
        (video.backendMetadata?.channel_order as string) ?? "RGB";
      result.set(videoIndex, {
        videoIndex,
        frameNumbers: sortedFrames.filter((f) => frameData.has(f)),
        frameData,
        format: backendFormat,
        channelOrder: backendChannelOrder,
      });
    }
  }

  return result;
}

/**
 * Convert a video frame to Uint8Array bytes for embedding.
 */
function frameToBytes(frame: unknown): Uint8Array | null {
  if (frame instanceof Uint8Array) return frame;
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  if (ArrayBuffer.isView(frame)) {
    const view = frame as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

/**
 * Write video metadata and embedded frame data for videos that are being embedded.
 */
function writeEmbeddedVideos(
  file: any,
  labels: Labels,
  embeddedVideoData: Map<number, EmbeddedVideoFrames>,
): void {
  const payload = labels.videos.map((video, videoIndex) => {
    const embedData = embeddedVideoData.get(videoIndex);
    if (embedData) {
      // This video is being embedded - update metadata
      const backend: Record<string, unknown> = {
        filename: ".",
        dataset: `video${videoIndex}/video`,
        format: embedData.format,
        channel_order: embedData.channelOrder,
      };
      // For a cropped video, videos_json must describe the UNCROPPED inner frame
      // (the crop rides /video_crops and is re-applied once on read); read the
      // shape/fps from the inner backend, not the cropped facade.
      const inner =
        video.backend instanceof CropVideoBackend
          ? video.backend.inner
          : video.backend;
      const innerShape =
        inner?.shape ??
        (video.backendMetadata?.source_shape as number[] | undefined);
      if (innerShape) backend.shape = innerShape;
      if (inner?.fps != null) backend.fps = inner.fps;

      const entry: Record<string, unknown> = {
        filename: ".",
        backend,
      };
      // Preserve source_video reference to original
      if (video.sourceVideo) {
        entry.source_video = { filename: video.sourceVideo.filename };
      } else if (!video.hasEmbeddedImages) {
        // If this video wasn't already embedded, save original path as source
        entry.source_video = {
          filename: Array.isArray(video.filename)
            ? video.filename[0]
            : video.filename,
        };
      }
      return JSON.stringify(entry);
    } else {
      return JSON.stringify(serializeVideo(video));
    }
  });
  file.create_dataset({ name: "videos_json", data: payload });

  // Write embedded video datasets
  for (const [videoIndex, embedData] of embeddedVideoData) {
    const groupName = `video${videoIndex}`;
    file.create_group(groupName);

    // Write frame data as vlen array
    const frameBytes: Uint8Array[] = [];
    for (const frameNum of embedData.frameNumbers) {
      const data = embedData.frameData.get(frameNum);
      if (data) frameBytes.push(data);
    }

    // Concatenate all frame bytes into a single buffer
    const totalSize = frameBytes.reduce((sum, b) => sum + b.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const bytes of frameBytes) {
      combined.set(bytes, offset);
      offset += bytes.length;
    }

    // Write video data as a 1D uint8 dataset
    file.create_dataset({
      name: `${groupName}/video`,
      data: combined,
      shape: [combined.length],
      dtype: "<B",
    });

    // Set format and channel_order attributes on the dataset
    const videoDs = file.get(`${groupName}/video`);
    if (videoDs) {
      setStringAttr(videoDs, "format", embedData.format);
      setStringAttr(videoDs, "channel_order", embedData.channelOrder);
    }

    // Write frame_numbers dataset
    file.create_dataset({
      name: `${groupName}/frame_numbers`,
      data: embedData.frameNumbers,
      shape: [embedData.frameNumbers.length],
      dtype: "<i4",
    });

    // Write frame_sizes dataset for reliable frame boundary detection
    const frameSizes = frameBytes.map((b) => b.length);
    file.create_dataset({
      name: `${groupName}/frame_sizes`,
      data: frameSizes,
      shape: [frameSizes.length],
      dtype: "<i4",
    });
  }
}

function createMatrixDataset(
  file: any,
  name: string,
  rows: number[][],
  fieldNames: string[],
  dtype: string,
): void {
  const rowCount = rows.length;
  const colCount = fieldNames.length;
  // Pre-allocate typed array to avoid intermediate .flat() allocation
  const TypedArray = dtype.includes("i")
    ? dtype.includes("4")
      ? Int32Array
      : Float64Array
    : Float64Array;
  const data = new TypedArray(rowCount * colCount);
  for (let i = 0; i < rowCount; i++) {
    const row = rows[i];
    const offset = i * colCount;
    for (let j = 0; j < colCount; j++) {
      data[offset + j] = row[j];
    }
  }
  file.create_dataset({ name, data, shape: [rowCount, colCount], dtype });
  const dataset = file.get(name);
  setStringAttr(dataset, "field_names", JSON.stringify(fieldNames));
}

function writeRois(
  file: any,
  rois: ROI[],
  videos: Video[],
  tracks: Array<{ name: string }>,
  instances?: Array<Instance | PredictedInstance>,
  contexts?: [number, number][],
): void {
  if (!rois.length) return;

  const rows: number[][] = [];
  const wkbChunks: Uint8Array[] = [];
  let wkbOffset = 0;
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];
  const hasInstances = instances && instances.length > 0;

  for (let i = 0; i < rois.length; i++) {
    const roi = rois[i];
    const wkb = encodeWkb(roi.geometry);
    const wkbStart = wkbOffset;
    const wkbEnd = wkbOffset + wkb.length;
    wkbChunks.push(wkb);
    wkbOffset = wkbEnd;

    const videoIdx = contexts
      ? contexts[i][0]
      : roi.video
        ? videos.indexOf(roi.video)
        : -1;
    const frameIdx = contexts ? contexts[i][1] : -1;
    const trackIdx = roi.track ? tracks.indexOf(roi.track as any) : -1;
    // Fall back to stored _instanceIdx when no live instance link (e.g., lazy mode).
    const instanceIdx =
      hasInstances && roi.instance
        ? instances.indexOf(roi.instance)
        : (roi._instanceIdx ?? -1);
    const score = roi.isPredicted ? (roi as PredictedROI).score : Number.NaN;
    const isPredicted = roi.isPredicted ? 1 : 0;
    const trackingScore = roi.trackingScore ?? Number.NaN;

    rows.push([
      0,
      videoIdx,
      frameIdx,
      trackIdx,
      score,
      trackingScore,
      wkbStart,
      wkbEnd,
      instanceIdx,
      isPredicted,
    ]);
    categories.push(roi.category);
    names.push(roi.name);
    sources.push(roi.source);
  }

  createMatrixDataset(
    file,
    "rois",
    rows,
    [
      "annotation_type",
      "video",
      "frame_idx",
      "track",
      "score",
      "tracking_score",
      "wkb_start",
      "wkb_end",
      "instance",
      "is_predicted",
    ],
    "<f8",
  );

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "roi_categories", categories);
  writeStringDataset(file, "roi_names", names);
  writeStringDataset(file, "roi_sources", sources);

  // Write concatenated WKB bytes
  const totalWkb = wkbChunks.reduce((sum, c) => sum + c.length, 0);
  const wkbFlat = new Uint8Array(totalWkb);
  let offset = 0;
  for (const chunk of wkbChunks) {
    wkbFlat.set(chunk, offset);
    offset += chunk.length;
  }
  // gzip-compress the packed WKB blob (Python #465). Transparent on read:
  // h5wasm/.value and Python h5py natively decompress the HDF5 deflate filter.
  // h5wasm throws "cannot specify compression without chunks" and rejects a
  // 0-size chunk dim, so only enable the filter when there are bytes to write;
  // writeRois early-returns on empty input, but the length>0 guard is the safe
  // pattern (mirrors Python keeping empty datasets uncompressed).
  if (wkbFlat.length > 0) {
    file.create_dataset({
      name: "roi_wkb",
      data: wkbFlat,
      shape: [wkbFlat.length],
      dtype: "<B",
      chunks: [wkbFlat.length],
      compression: "gzip",
      compression_opts: 1,
    });
  } else {
    file.create_dataset({
      name: "roi_wkb",
      data: wkbFlat,
      shape: [wkbFlat.length],
      dtype: "<B",
    });
  }
}

function writeMasks(
  file: any,
  masks: SegmentationMask[],
  videos: Video[],
  tracks: Array<{ name: string }>,
  instances: (Instance | PredictedInstance)[],
  contexts?: [number, number][],
): void {
  if (!masks.length) return;

  const rows: number[][] = [];
  const rleChunks: Uint8Array[] = [];
  let rleOffset = 0;
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  // Score map collection
  const scoreMapIndexRows: number[][] = [];
  const scoreMapChunks: Uint8Array[] = [];
  let smOffset = 0;

  // Map each mask object to its position in the flat list so a user mask's
  // `fromPredicted` link can be resolved to a global index (mirrors instance
  // from_predicted). Keyed by the object itself (object identity) — the JS
  // analog of Python's id(mask).
  const maskIdToIdx = new Map<SegmentationMask, number>();
  masks.forEach((m, i) => {
    maskIdToIdx.set(m, i);
  });

  for (let i = 0; i < masks.length; i++) {
    const mask = masks[i];
    // Convert Uint32Array RLE counts to bytes (little-endian)
    const rleBytes = new Uint8Array(mask.rleCounts.length * 4);
    const view = new DataView(rleBytes.buffer);
    for (let j = 0; j < mask.rleCounts.length; j++) {
      view.setUint32(j * 4, mask.rleCounts[j], true);
    }
    const rleStart = rleOffset;
    const rleEnd = rleOffset + rleBytes.length;
    rleChunks.push(rleBytes);
    rleOffset = rleEnd;

    const videoIdx = contexts ? contexts[i][0] : -1;
    const frameIdx = contexts ? contexts[i][1] : -1;
    const trackIdx = mask.track ? tracks.indexOf(mask.track as any) : -1;
    const score = mask.isPredicted
      ? (mask as PredictedSegmentationMask).score
      : Number.NaN;
    const isPredicted = mask.isPredicted ? 1 : 0;
    const instanceIdx = mask.instance
      ? instances.indexOf(mask.instance as Instance)
      : (mask._instanceIdx ?? -1);
    const maskTrackingScore = mask.trackingScore ?? Number.NaN;

    // Resolve the from_predicted provenance link to a global index into the
    // flat mask list. -1 sentinel when there is no link or the source
    // prediction is absent from the saved list (Map miss). Only user masks
    // carry fromPredicted; predicted masks always resolve to -1.
    const fromPredictedSrc =
      (mask as UserSegmentationMask).fromPredicted ?? null;
    const fromPredictedIdx =
      fromPredictedSrc != null ? (maskIdToIdx.get(fromPredictedSrc) ?? -1) : -1;

    rows.push([
      mask.height,
      mask.width,
      2,
      videoIdx,
      frameIdx,
      trackIdx,
      score,
      rleStart,
      rleEnd,
      isPredicted,
      instanceIdx,
      maskTrackingScore,
      mask.scale[0],
      mask.scale[1],
      mask.offset[0],
      mask.offset[1],
      fromPredictedIdx,
    ]);
    categories.push(mask.category);
    names.push(mask.name);
    sources.push(mask.source);

    // Collect score maps for predicted masks
    if (mask.isPredicted) {
      const pm = mask as PredictedSegmentationMask;
      if (pm.scoreMap) {
        const smBytes = new Uint8Array(
          pm.scoreMap.buffer,
          pm.scoreMap.byteOffset,
          pm.scoreMap.byteLength,
        );
        const compressed = deflate(smBytes);
        const smH = pm.scoreMap.length / mask.width;
        if (!Number.isInteger(smH)) {
          throw new Error(
            `Score map size ${pm.scoreMap.length} not divisible by width ${mask.width}`,
          );
        }
        scoreMapIndexRows.push([
          i,
          smOffset,
          smOffset + compressed.length,
          smH,
          mask.width,
        ]);
        scoreMapChunks.push(compressed);
        smOffset += compressed.length;
      }
    }
  }

  createMatrixDataset(
    file,
    "masks",
    rows,
    [
      "height",
      "width",
      "annotation_type",
      "video",
      "frame_idx",
      "track",
      "score",
      "rle_start",
      "rle_end",
      "is_predicted",
      "instance",
      "tracking_score",
      "scale_x",
      "scale_y",
      "offset_x",
      "offset_y",
      "from_predicted",
    ],
    "<f8",
  );

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "mask_categories", categories);
  writeStringDataset(file, "mask_names", names);
  writeStringDataset(file, "mask_sources", sources);

  // Write concatenated RLE bytes
  const totalRle = rleChunks.reduce((sum, c) => sum + c.length, 0);
  const rleFlat = new Uint8Array(totalRle);
  let offset = 0;
  for (const chunk of rleChunks) {
    rleFlat.set(chunk, offset);
    offset += chunk.length;
  }
  // gzip-compress the packed RLE blob (Python #464). Transparent on read:
  // h5wasm/.value and Python h5py natively decompress the HDF5 deflate filter.
  // A fully-empty mask raster encodes to a zero-length RLE, so rleFlat can be
  // empty even when masks are present; h5wasm rejects a 0-size chunk dim and
  // throws "cannot specify compression without chunks", so only enable the
  // filter when there are bytes (mirrors Python keeping empty mask_rle raw).
  if (rleFlat.length > 0) {
    file.create_dataset({
      name: "mask_rle",
      data: rleFlat,
      shape: [rleFlat.length],
      dtype: "<B",
      chunks: [rleFlat.length],
      compression: "gzip",
      compression_opts: 1,
    });
  } else {
    file.create_dataset({
      name: "mask_rle",
      data: rleFlat,
      shape: [rleFlat.length],
      dtype: "<B",
    });
  }

  // Write score maps
  if (scoreMapIndexRows.length > 0) {
    createMatrixDataset(
      file,
      "mask_score_map_index",
      scoreMapIndexRows,
      ["mask_idx", "data_start", "data_end", "height", "width"],
      "<f8",
    );
    const totalSm = scoreMapChunks.reduce((sum, c) => sum + c.length, 0);
    const smFlat = new Uint8Array(totalSm);
    let smOff = 0;
    for (const chunk of scoreMapChunks) {
      smFlat.set(chunk, smOff);
      smOff += chunk.length;
    }
    file.create_dataset({
      name: "mask_score_maps",
      data: smFlat,
      shape: [smFlat.length],
      dtype: "<B",
    });
  }
}

function writeBboxes(
  file: any,
  bboxes: BoundingBox[],
  _videos: Video[],
  tracks: Array<{ name: string }>,
  instances: (Instance | PredictedInstance)[],
  contexts?: [number, number][],
): void {
  if (!bboxes.length) return;

  const rows: number[][] = [];
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  for (let i = 0; i < bboxes.length; i++) {
    const bbox = bboxes[i];
    const videoIdx = contexts ? contexts[i][0] : -1;
    const frameIdx = contexts ? contexts[i][1] : -1;
    const trackIdx = bbox.track ? tracks.indexOf(bbox.track as any) : -1;
    const score = bbox.isPredicted
      ? (bbox as PredictedBoundingBox).score
      : Number.NaN;
    // Fall back to stored _instanceIdx when no live instance link (e.g., lazy mode).
    const instanceIdx = bbox.instance
      ? instances.indexOf(bbox.instance as Instance)
      : (bbox._instanceIdx ?? -1);

    const trackingScore = bbox.trackingScore ?? Number.NaN;

    rows.push([
      bbox.x1,
      bbox.y1,
      bbox.x2,
      bbox.y2,
      bbox.angle,
      videoIdx,
      frameIdx,
      trackIdx,
      score,
      instanceIdx,
      trackingScore,
    ]);
    categories.push(bbox.category);
    names.push(bbox.name);
    sources.push(bbox.source);
  }

  createMatrixDataset(
    file,
    "bboxes",
    rows,
    [
      "x1",
      "y1",
      "x2",
      "y2",
      "angle",
      "video",
      "frame_idx",
      "track",
      "score",
      "instance",
      "tracking_score",
    ],
    "<f8",
  );

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "bbox_categories", categories);
  writeStringDataset(file, "bbox_names", names);
  writeStringDataset(file, "bbox_sources", sources);
}

function writeLabelImages(
  file: any,
  labelImages: LabelImage[],
  _videos: Video[],
  tracks: Track[],
  instances: (Instance | PredictedInstance)[],
  contexts?: [number, number][],
): void {
  if (!labelImages.length) return;

  // Verify little-endian platform (label image data is stored as raw LE bytes)
  const endianCheck = new Uint8Array(new Uint16Array([0x0102]).buffer);
  if (endianCheck[0] !== 0x02) {
    throw new Error("LabelImage I/O requires a little-endian platform.");
  }

  const rows: number[][] = [];
  const compressedChunks: Uint8Array[] = [];
  let dataOffset = 0;
  const objectRows: number[][] = [];
  const objectCategories: string[] = [];
  const objectNames: string[] = [];
  const sources: string[] = [];
  let objectsOffset = 0;

  // Score map collection
  const smIndexRows: number[][] = [];
  const smChunks: Uint8Array[] = [];
  let smOffset = 0;

  for (let liIdx = 0; liIdx < labelImages.length; liIdx++) {
    const li = labelImages[liIdx];
    const videoIdx = contexts ? contexts[liIdx][0] : -1;
    const frameIdx = contexts ? contexts[liIdx][1] : -1;

    // Compress pixel data: Int32Array -> raw bytes -> zlib
    const pixelBytes = new Uint8Array(
      li.data.buffer,
      li.data.byteOffset,
      li.data.byteLength,
    );
    const compressed = deflate(pixelBytes);
    const dataStart = dataOffset;
    const dataEnd = dataOffset + compressed.length;
    compressedChunks.push(compressed);
    dataOffset = dataEnd;

    const isPredicted = li.isPredicted ? 1 : 0;
    const liScore = li.isPredicted
      ? (li as PredictedLabelImage).score
      : Number.NaN;

    // Per-object entries
    const objectsStart = objectsOffset;
    for (const [labelId, info] of li.objects) {
      const trackIdx = info.track ? tracks.indexOf(info.track as Track) : -1;
      // PR #386: fall back to _instanceIdx when instance is null
      let instanceIdx = li._objectInstanceIdxs?.get(labelId) ?? -1;
      if (info.instance) {
        const found = instances.indexOf(info.instance as Instance);
        if (found >= 0) instanceIdx = found;
      } else if (info._instanceIdx != null && info._instanceIdx >= 0) {
        instanceIdx = info._instanceIdx;
      }
      const objScore = info.score != null ? info.score : Number.NaN;
      const objTrackingScore =
        info.trackingScore != null ? info.trackingScore : Number.NaN;
      objectRows.push([
        labelId,
        trackIdx,
        instanceIdx,
        objScore,
        objTrackingScore,
      ]);
      objectCategories.push(info.category);
      objectNames.push(info.name);
      objectsOffset++;
    }

    rows.push([
      videoIdx,
      frameIdx,
      li.height,
      li.width,
      li.nObjects,
      objectsStart,
      dataStart,
      dataEnd,
      isPredicted,
      liScore,
      li.scale[0],
      li.scale[1],
      li.offset[0],
      li.offset[1],
    ]);
    sources.push(li.source);

    // Collect score maps for predicted label images
    if (li.isPredicted) {
      const pli = li as PredictedLabelImage;
      if (pli.scoreMap) {
        const smBytes = new Uint8Array(
          pli.scoreMap.buffer,
          pli.scoreMap.byteOffset,
          pli.scoreMap.byteLength,
        );
        const smCompressed = deflate(smBytes);
        const smH = pli.scoreMap.length / li.width;
        if (!Number.isInteger(smH)) {
          throw new Error(
            `Score map size ${pli.scoreMap.length} not divisible by width ${li.width}`,
          );
        }
        smIndexRows.push([
          liIdx,
          smOffset,
          smOffset + smCompressed.length,
          smH,
          li.width,
        ]);
        smChunks.push(smCompressed);
        smOffset += smCompressed.length;
      }
    }
  }

  // Write main metadata table
  createMatrixDataset(
    file,
    "label_images",
    rows,
    [
      "video",
      "frame_idx",
      "height",
      "width",
      "n_objects",
      "objects_start",
      "data_start",
      "data_end",
      "is_predicted",
      "score",
      "scale_x",
      "scale_y",
      "offset_x",
      "offset_y",
    ],
    "<f8",
  );

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "label_image_sources", sources);

  // Write objects table (if any objects exist)
  if (objectRows.length > 0) {
    createMatrixDataset(
      file,
      "label_image_objects",
      objectRows,
      ["label_id", "track", "instance", "score", "tracking_score"],
      "<f8",
    );
    // Write string metadata as datasets at root level (v1.9+)
    writeStringDataset(file, "label_image_obj_categories", objectCategories);
    writeStringDataset(file, "label_image_obj_names", objectNames);
  }

  // Write concatenated compressed pixel data
  const totalData = compressedChunks.reduce((sum, c) => sum + c.length, 0);
  const dataFlat = new Uint8Array(totalData);
  let offset = 0;
  for (const chunk of compressedChunks) {
    dataFlat.set(chunk, offset);
    offset += chunk.length;
  }
  file.create_dataset({
    name: "label_image_data",
    data: dataFlat,
    shape: [dataFlat.length],
    dtype: "<B",
  });

  // Write score maps
  if (smIndexRows.length > 0) {
    createMatrixDataset(
      file,
      "label_image_score_map_index",
      smIndexRows,
      ["li_idx", "data_start", "data_end", "height", "width"],
      "<f8",
    );
    const totalSm = smChunks.reduce((sum, c) => sum + c.length, 0);
    const smFlat = new Uint8Array(totalSm);
    let smOff = 0;
    for (const chunk of smChunks) {
      smFlat.set(chunk, smOff);
      smOff += chunk.length;
    }
    file.create_dataset({
      name: "label_image_score_maps",
      data: smFlat,
      shape: [smFlat.length],
      dtype: "<B",
    });
  }
}

function writeCentroids(
  file: any,
  centroids: Centroid[],
  _videos: Video[],
  tracks: Array<{ name: string }>,
  instances: (Instance | PredictedInstance)[],
  contexts?: [number, number][],
): void {
  if (!centroids.length) return;

  const rows: number[][] = [];
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  for (let i = 0; i < centroids.length; i++) {
    const c = centroids[i];
    const videoIdx = contexts ? contexts[i][0] : -1;
    const frameIdx = contexts ? contexts[i][1] : -1;
    const trackIdx = c.track ? tracks.indexOf(c.track as any) : -1;
    const score = c.isPredicted ? (c as PredictedCentroid).score : Number.NaN;
    // Fall back to stored _instanceIdx when no live instance link (e.g., lazy mode).
    const instanceIdx = c.instance
      ? instances.indexOf(c.instance as Instance)
      : (c._instanceIdx ?? -1);
    const isPredicted = c.isPredicted ? 1 : 0;
    const trackingScore = c.trackingScore ?? Number.NaN;

    rows.push([
      c.x,
      c.y,
      c.z ?? Number.NaN,
      videoIdx,
      frameIdx,
      trackIdx,
      instanceIdx,
      isPredicted,
      score,
      trackingScore,
    ]);
    categories.push(c.category);
    names.push(c.name);
    sources.push(c.source);
  }

  createMatrixDataset(
    file,
    "centroids",
    rows,
    [
      "x",
      "y",
      "z",
      "video",
      "frame_idx",
      "track",
      "instance",
      "is_predicted",
      "score",
      "tracking_score",
    ],
    "<f8",
  );

  writeStringDataset(file, "centroid_categories", categories);
  writeStringDataset(file, "centroid_names", names);
  writeStringDataset(file, "centroid_sources", sources);
}
