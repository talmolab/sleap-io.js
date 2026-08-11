/**
 * NWB (Neurodata Without Borders / ndx-pose) annotations reader.
 *
 * Reads an ndx-pose **PoseTraining** (user annotations) `.nwb` file into a
 * sleap-io.js {@link Labels} object. NWB is plain HDF5 and sleap-io.js already
 * bundles the HDF5 engine, so this is a schema-guided set of HDF5 reads (via the
 * caller-opened file) rather than a from-scratch NWB parser. Sibling of
 * {@link readNwbPredictions}.
 *
 * On-disk structure (from a real `sleap_io.save_nwb(..., "annotations")`):
 *
 *   /processing/behavior/PoseTraining/            [PoseTraining]
 *     source_videos/video_{i}/                    [ImageSeries]
 *       external_file <str>(1)   num_samples ()   dimension <int>(2)  (H, W)
 *     training_frames/{frameName}/                [TrainingFrame]
 *       @source_video_frame_index (uint)          <- the REAL video frame index
 *       source_video/                             [ImageSeries]  (link)
 *       skeleton_instances/instance_{j}/          [SkeletonInstance]
 *         @id (uint)                              <- the track id
 *         node_locations <float>(nNodes, 2)
 *         node_visibility <bool>(nNodes)
 *         {skeletonName}/  [Skeleton]  nodes <str>(n)  edges <uint8>(e,2)
 *
 * Unlike predictions (which store a TIME per sample and need frame recovery),
 * annotations store the frame index EXPLICITLY (`source_video_frame_index`) and
 * the track id EXPLICITLY (`SkeletonInstance.id`). Instances are USER
 * {@link Instance}s (not {@link PredictedInstance}). Track *names* are not stored
 * in this format, so tracks are reconstructed as `track_{id}`. The Skeleton
 * subgroup name varies by writer (`skeleton_0` / `Skeleton-0`), so it is located
 * by scanning the instance's children for a `nodes` dataset rather than hardcoded.
 *
 * Browser-safe: no Node-only imports.
 */

import { Labels } from "../model/labels.js";
import { Instance, Track } from "../model/instance.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { Skeleton } from "../model/skeleton.js";
import { Video } from "../model/video.js";
import {
  decodeStringArray,
  readNumberAttr,
  readStringAttr,
} from "./h5-read-utils.js";

// =============================================================================
// Minimal HDF5 entity surfaces + guards (kept local; mirror nwb-predictions.ts)
// =============================================================================

interface H5Group {
  keys(): string[];
  attrs?: Record<string, unknown>;
}
interface H5Dataset {
  value: unknown;
  shape?: ArrayLike<number | bigint>;
  attrs?: Record<string, unknown>;
}
interface H5Root {
  get(name: string): unknown;
  keys?: () => string[];
  attrs?: Record<string, unknown>;
}

function isGroup(o: unknown): o is H5Group {
  return (
    o != null &&
    typeof o === "object" &&
    typeof (o as { keys?: unknown }).keys === "function"
  );
}
function isDataset(o: unknown): o is H5Dataset {
  return o != null && typeof o === "object" && "value" in (o as object);
}
function neurodataType(entity: unknown): string | undefined {
  const attrs = (entity as { attrs?: Record<string, unknown> } | null)?.attrs;
  return readStringAttr(attrs, "neurodata_type");
}
function toNumberArray(value: unknown): number[] {
  if (value == null) return [];
  if (typeof value === "number") return [value];
  if (typeof value === "bigint") return [Number(value)];
  if (typeof value === "boolean") return [value ? 1 : 0];
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>, (v) => Number(v));
  }
  if (Array.isArray(value)) return value.map((v) => Number(v));
  return [];
}
function shapeToNumbers(
  shape: ArrayLike<number | bigint> | undefined,
): number[] {
  if (shape == null) return [];
  return Array.from(shape, (s) => Number(s));
}
function readScalarNumber(entity: unknown): number | undefined {
  if (!isDataset(entity)) return undefined;
  const v = entity.value;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const arr = toNumberArray(v);
  return arr.length ? arr[0] : undefined;
}

// =============================================================================
// Pure helpers (exported for unit testing)
// =============================================================================

/**
 * Reconstruct a track name from a `SkeletonInstance.id`. The annotations format
 * stores only the numeric id (names are not persisted), so tracks are named
 * `track_{id}`.
 *
 * @internal Exported for unit testing.
 */
export function trackNameForId(id: number): string {
  return `track_${id}`;
}

/**
 * Build per-node `[x, y, visible]` rows for {@link Instance.fromNumpy} from a
 * flat `node_locations` array (`[x0, y0, x1, y1, ...]`) and an optional
 * `node_visibility` array (0/1 per node).
 *
 * When `visibility` is provided, each row is `[x, y, vis]` so `fromNumpy` records
 * the explicit visibility (an invisible node keeps its stored `NaN` coordinates
 * with `visible = false`). When absent, 2-column rows let the model infer
 * visibility from `NaN`. Missing coordinates default to `NaN` (0 is preserved).
 *
 * @internal Exported for unit testing.
 */
export function annotationPointRows(
  locations: ArrayLike<number>,
  visibility: ArrayLike<number> | null | undefined,
  nNodes: number,
): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < nNodes; i++) {
    const x = locations[i * 2] ?? Number.NaN;
    const y = locations[i * 2 + 1] ?? Number.NaN;
    if (visibility != null) rows.push([x, y, visibility[i] ? 1 : 0]);
    else rows.push([x, y]);
  }
  return rows;
}

// =============================================================================
// Skeleton / video reading
// =============================================================================

/** Build a Skeleton from a group holding `nodes` + `edges` (index-pairs). */
function readSkeletonFromGroup(
  root: H5Root,
  basePath: string,
  name?: string,
): Skeleton | null {
  const nodesEntity = root.get(`${basePath}/nodes`);
  if (!isDataset(nodesEntity)) return null;
  const nodeNames = decodeStringArray(nodesEntity.value);
  if (!nodeNames.length) return null;

  const edges: Array<[string, string]> = [];
  const edgesEntity = root.get(`${basePath}/edges`);
  if (isDataset(edgesEntity) && edgesEntity.value != null) {
    const shape = shapeToNumbers(edgesEntity.shape);
    const nEdges = shape.length ? shape[0] : 0;
    const flat = toNumberArray(edgesEntity.value);
    for (let i = 0; i < nEdges; i++) {
      const sn = nodeNames[flat[i * 2]];
      const dn = nodeNames[flat[i * 2 + 1]];
      if (sn != null && dn != null) edges.push([sn, dn]);
    }
  }
  return new Skeleton({ nodes: nodeNames, edges, name });
}

/**
 * Find the Skeleton nested inside a SkeletonInstance group. The subgroup name
 * varies by writer, so scan the instance's children (skipping the point
 * datasets) for one carrying a `Skeleton` neurodata_type or a `nodes` dataset.
 */
function readSkeletonInInstance(
  root: H5Root,
  instPath: string,
): Skeleton | null {
  const inst = root.get(instPath);
  if (!isGroup(inst)) return null;
  for (const k of inst.keys()) {
    if (k === "node_locations" || k === "node_visibility") continue;
    const subPath = `${instPath}/${k}`;
    const sub = root.get(subPath);
    if (
      neurodataType(sub) === "Skeleton" ||
      isDataset(root.get(`${subPath}/nodes`))
    ) {
      const s = readSkeletonFromGroup(root, subPath, k);
      if (s) return s;
    }
  }
  return null;
}

/** The video's `external_file` path, or "" if absent. */
function externalFilePath(root: H5Root, imageSeriesPath: string): string {
  const ef = root.get(`${imageSeriesPath}/external_file`);
  if (isDataset(ef)) {
    const arr = decodeStringArray(ef.value);
    if (arr.length) return arr[0];
  }
  return "";
}

/**
 * Build a Video from an ImageSeries: filename from `external_file`, and shape
 * `[num_samples, H, W, 1]` from `num_samples` + `dimension` so the timeline
 * spans the whole source video (not just up to the last labeled frame). Shape is
 * only set when both a positive frame count and positive H/W are available.
 */
function readImageSeriesVideo(root: H5Root, svPath: string): Video {
  const video = new Video({ filename: externalFilePath(root, svPath) });
  const nSamples = readScalarNumber(root.get(`${svPath}/num_samples`));
  const dimEntity = root.get(`${svPath}/dimension`);
  const dim = isDataset(dimEntity) ? toNumberArray(dimEntity.value) : [];
  const h = dim[0] ?? 0;
  const w = dim[1] ?? 0;
  if (nSamples != null && nSamples > 0 && h > 0 && w > 0) {
    video.shape = [nSamples, h, w, 1];
  }
  return video;
}

// =============================================================================
// Read
// =============================================================================

/** Options for {@link readNwbAnnotations}. */
export interface ReadNwbAnnotationsOptions {
  /** Original source path, recorded in `labels.provenance.filename`. */
  filename?: string;
}

/** Locate the first `PoseTraining` group path under `/processing/*`. */
function findPoseTrainingPath(root: H5Root): string | null {
  const processing = root.get("processing");
  if (!isGroup(processing)) return null;
  for (const modKey of processing.keys()) {
    const mod = root.get(`processing/${modKey}`);
    if (!isGroup(mod)) continue;
    for (const childKey of mod.keys()) {
      const child = root.get(`processing/${modKey}/${childKey}`);
      if (neurodataType(child) === "PoseTraining") {
        return `processing/${modKey}/${childKey}`;
      }
    }
  }
  return null;
}

/**
 * Read an already-opened ndx-pose PoseTraining (annotations) HDF5 file into a
 * {@link Labels} object.
 *
 * The caller (`readNwb`) owns opening/closing the file; this only reads. Assumes
 * a single skeleton.
 *
 * @param file - An opened h5wasm file/root (from `openH5File`).
 * @param options - Optional provenance filename.
 */
export async function readNwbAnnotations(
  file: unknown,
  options?: ReadNwbAnnotationsOptions,
): Promise<Labels> {
  const root = file as H5Root;

  const ptPath = findPoseTrainingPath(root);
  if (!ptPath) {
    throw new Error(
      "NWB file does not contain any PoseTraining (annotations) data.",
    );
  }

  const framesGroup = root.get(`${ptPath}/training_frames`);
  if (!isGroup(framesGroup)) {
    throw new Error("NWB PoseTraining has no training_frames group.");
  }
  const frameKeys = framesGroup.keys();

  // Skeleton: from the first instance that carries one.
  let skeleton: Skeleton | null = null;
  for (const fk of frameKeys) {
    const si = root.get(`${ptPath}/training_frames/${fk}/skeleton_instances`);
    if (!isGroup(si)) continue;
    for (const ik of si.keys()) {
      skeleton = readSkeletonInInstance(
        root,
        `${ptPath}/training_frames/${fk}/skeleton_instances/${ik}`,
      );
      if (skeleton) break;
    }
    if (skeleton) break;
  }
  if (!skeleton) {
    throw new Error("NWB PoseTraining has no readable skeleton (nodes/edges).");
  }
  const nNodes = skeleton.nodeNames.length;

  // Videos: build from the source_videos container, indexed by external path.
  const videos: Video[] = [];
  const videosByPath = new Map<string, Video>();
  const svContainer = root.get(`${ptPath}/source_videos`);
  if (isGroup(svContainer)) {
    for (const vk of svContainer.keys()) {
      const svPath = `${ptPath}/source_videos/${vk}`;
      if (neurodataType(root.get(svPath)) !== "ImageSeries") continue;
      const video = readImageSeriesVideo(root, svPath);
      videos.push(video);
      videosByPath.set(String(video.filename), video);
    }
  }

  // Resolve the Video a TrainingFrame refers to (via its source_video link's
  // external_file path); fall back to the sole/first video, creating one if the
  // source_videos container was absent.
  const videoForFrame = (framePath: string): Video => {
    const p = externalFilePath(root, `${framePath}/source_video`);
    if (p) {
      const existing = videosByPath.get(p);
      if (existing) return existing;
      const created = new Video({ filename: p });
      videos.push(created);
      videosByPath.set(p, created);
      return created;
    }
    if (videos.length) return videos[0];
    const fallback = new Video({ filename: "" });
    videos.push(fallback);
    return fallback;
  };

  const tracksById = new Map<number, Track>();
  const trackForId = (id: number): Track => {
    let t = tracksById.get(id);
    if (!t) {
      t = new Track(trackNameForId(id));
      tracksById.set(id, t);
    }
    return t;
  };

  const labeledFrames: LabeledFrame[] = [];
  for (const fk of frameKeys) {
    const framePath = `${ptPath}/training_frames/${fk}`;
    const frameGroup = root.get(framePath);
    if (neurodataType(frameGroup) !== "TrainingFrame") continue;

    const frameIdx =
      readNumberAttr(
        (frameGroup as { attrs?: Record<string, unknown> }).attrs,
        "source_video_frame_index",
      ) ?? 0;
    const video = videoForFrame(framePath);

    const siGroup = root.get(`${framePath}/skeleton_instances`);
    const instances: Instance[] = [];
    if (isGroup(siGroup)) {
      for (const ik of siGroup.keys()) {
        const instPath = `${framePath}/skeleton_instances/${ik}`;
        const instGroup = root.get(instPath);
        if (neurodataType(instGroup) !== "SkeletonInstance") continue;

        const id = readNumberAttr(
          (instGroup as { attrs?: Record<string, unknown> }).attrs,
          "id",
        );
        const track = id != null ? trackForId(id) : null;

        const locEntity = root.get(`${instPath}/node_locations`);
        if (!isDataset(locEntity)) continue;
        const locations = toNumberArray(locEntity.value);
        const visEntity = root.get(`${instPath}/node_visibility`);
        const visibility = isDataset(visEntity)
          ? toNumberArray(visEntity.value)
          : null;

        const inst = Instance.fromNumpy({
          pointsData: annotationPointRows(locations, visibility, nNodes),
          skeleton,
          track,
        });
        instances.push(inst);
      }
    }

    if (instances.length) {
      labeledFrames.push(new LabeledFrame({ video, frameIdx, instances }));
    }
  }

  // Deterministic order: by video, then frame index.
  labeledFrames.sort((a, b) => {
    const va = videos.indexOf(a.video);
    const vb = videos.indexOf(b.video);
    return va !== vb ? va - vb : a.frameIdx - b.frameIdx;
  });

  const labels = new Labels({
    videos,
    skeletons: [skeleton],
    tracks: Array.from(tracksById.values()),
    labeledFrames,
  });
  if (options?.filename) {
    labels.provenance.filename = String(options.filename);
  }
  return labels;
}
