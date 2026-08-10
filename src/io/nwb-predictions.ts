/**
 * NWB (Neurodata Without Borders / ndx-pose) predictions reader.
 *
 * Reads an ndx-pose **PoseEstimation** (predictions) `.nwb` file into a
 * sleap-io.js {@link Labels} object. NWB is plain HDF5, and sleap-io.js already
 * bundles the HDF5 engine, so this is a schema-guided set of HDF5 reads (via
 * `openH5File`) rather than a from-scratch NWB parser. Mirrors the structure of
 * `analysis-h5.ts`.
 *
 * On-disk structure (from a real `sleap_io.save_nwb(..., "predictions")`):
 *
 *   /processing/
 *     SLEAP_VIDEO_{NNN}_{stem}/          [ProcessingModule]     one per video
 *       track={name}/                     [PoseEstimation]       one per track
 *         {NodeName}/  [PoseEstimationSeries]                    one GROUP per node
 *           data          (T,2)   confidence  (T,)
 *           starting_time ()   OR  timestamps  (T,)              (exactly one)
 *         original_videos  <str>(N)   labeled_videos  <str>(N)
 *       behavior/  [ProcessingModule]
 *         Skeletons/  [Skeletons]
 *           {SkeletonName}/  [Skeleton]  nodes <str>(n)  edges <uint8>(e,2)
 *
 * This reader deliberately RECOVERS two things the reference Python reader
 * drops: **track identity** (parsed from the `track={name}` container name) and
 * **integer frame indices** (recovered from each series' integer timestamps /
 * `starting_time`). An all-NaN node for a track is written as an EMPTY series
 * (shape `[0,2]`) and contributes no points.
 *
 * Legacy ndx-pose (0.1.x) stores `nodes`/`edges` directly on the PoseEstimation
 * group (no `Skeletons` container); both eras are handled.
 *
 * Browser-safe: no Node-only imports.
 */

import { Labels } from "../model/labels.js";
import { PredictedInstance, Track } from "../model/instance.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { Skeleton } from "../model/skeleton.js";
import { Video } from "../model/video.js";
import { decodeStringArray, readStringAttr } from "./h5-read-utils.js";

// =============================================================================
// Minimal HDF5 entity surfaces + type guards
// =============================================================================

/** Minimal h5wasm group surface: has a `keys()` method and `attrs`. */
interface H5Group {
  keys(): string[];
  attrs?: Record<string, unknown>;
}

/** Minimal h5wasm dataset surface: has a `value` (and optional shape/attrs). */
interface H5Dataset {
  value: unknown;
  shape?: ArrayLike<number | bigint>;
  attrs?: Record<string, unknown>;
}

/** Minimal traversable file/root surface. */
interface H5Root {
  get(name: string): unknown;
  keys?: () => string[];
  attrs?: Record<string, unknown>;
}

/** A Group has a `keys()` METHOD; a Dataset has a `value`. */
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

/** Read the `neurodata_type` attr of a group/dataset, if present. */
function neurodataType(entity: unknown): string | undefined {
  const attrs = (entity as { attrs?: Record<string, unknown> } | null)?.attrs;
  return readStringAttr(attrs, "neurodata_type");
}

/** Coerce any h5wasm numeric value (typed array / array / scalar) to number[]. */
function toNumberArray(value: unknown): number[] {
  if (value == null) return [];
  if (typeof value === "number") return [value];
  if (typeof value === "bigint") return [Number(value)];
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>, (v) => Number(v));
  }
  if (Array.isArray(value)) return value.map((v) => Number(v));
  return [];
}

/** Coerce a shape (number | bigint entries) to a plain number[]. */
function shapeToNumbers(
  shape: ArrayLike<number | bigint> | undefined,
): number[] {
  if (shape == null) return [];
  return Array.from(shape, (s) => Number(s));
}

/** Read a scalar number dataset (`starting_time`), or undefined if absent. */
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
 * Parse a PoseEstimation container name into a track name.
 *
 * `"track={name}"` → `name`; `"track=untracked"` → `null` (no track); a name
 * that does not start with `"track="` → `null` (an untracked animal container,
 * e.g. from a non-SLEAP writer).
 *
 * @internal Exported for unit testing.
 */
export function parseTrackName(containerName: string): string | null {
  const PREFIX = "track=";
  if (!containerName.startsWith(PREFIX)) return null;
  const name = containerName.slice(PREFIX.length);
  if (name === "untracked" || name.length === 0) return null;
  return name;
}

/**
 * Recover integer frame indices for one PoseEstimationSeries.
 *
 * When `timestamps` is present (even if empty), each is rounded to the nearest
 * integer frame (SLEAP encodes frame numbers as integer timestamps). Otherwise
 * frames are consecutive from `startingTime`: `round(startingTime) + i` for
 * `i` in `0..count-1` (rate is effectively 0/absent for SLEAP).
 *
 * @internal Exported for unit testing.
 */
export function recoverFrameIndices(
  timestamps: ArrayLike<number> | null | undefined,
  startingTime: number | undefined,
  count: number,
): number[] {
  if (timestamps != null) {
    return Array.from(timestamps, (t) => Math.round(Number(t)));
  }
  const base = Math.round(startingTime ?? 0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(base + i);
  return out;
}

// =============================================================================
// Skeleton reading
// =============================================================================

/**
 * Build a Skeleton from a group holding `nodes` (string[]) and `edges`
 * (uint8 index-pairs, shape [e,2]). Returns null when there are no nodes.
 */
function readSkeletonAt(
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
      const s = flat[i * 2];
      const d = flat[i * 2 + 1];
      const sn = nodeNames[s];
      const dn = nodeNames[d];
      if (sn != null && dn != null) edges.push([sn, dn]);
    }
  }

  return new Skeleton({ nodes: nodeNames, edges, name });
}

/**
 * Resolve the single skeleton for the file. Prefers the modern
 * `/processing/behavior/Skeletons/{name}` container; falls back to a
 * PoseEstimation group's linked `Skeleton` subgroup, then to legacy
 * `nodes`/`edges` datasets directly on the PoseEstimation group.
 */
function resolveSkeleton(
  root: H5Root,
  poseEstimationPaths: string[],
): Skeleton | null {
  // Modern: Skeletons container under a behavior ProcessingModule.
  const skeletons = root.get("processing/behavior/Skeletons");
  if (isGroup(skeletons)) {
    for (const key of skeletons.keys()) {
      const s = readSkeletonAt(
        root,
        `processing/behavior/Skeletons/${key}`,
        key,
      );
      if (s) return s;
    }
  }

  // Fallbacks off the first PoseEstimation group: linked Skeleton subgroup,
  // then legacy nodes/edges directly on the group.
  for (const posePath of poseEstimationPaths) {
    const linked = root.get(`${posePath}/Skeleton`);
    if (isGroup(linked)) {
      const s = readSkeletonAt(root, `${posePath}/Skeleton`, "Skeleton");
      if (s) return s;
    }
    const legacy = readSkeletonAt(root, posePath);
    if (legacy) return legacy;
  }

  return null;
}

// =============================================================================
// Read
// =============================================================================

/** Options for {@link readNwbPredictions}. */
export interface ReadNwbPredictionsOptions {
  /** Original source path, recorded in `labels.provenance.filename`. */
  filename?: string;
}

/**
 * Read an already-opened ndx-pose PoseEstimation (predictions) HDF5 file into a
 * {@link Labels} object.
 *
 * The caller (`readNwb`) owns opening/closing the file; this function only
 * reads. Assumes a single skeleton for M1.
 *
 * @param file - An opened h5wasm file/root (from `openH5File`).
 * @param options - Optional provenance filename.
 */
export async function readNwbPredictions(
  file: unknown,
  options?: ReadNwbPredictionsOptions,
): Promise<Labels> {
  const root = file as H5Root;

  const processing = root.get("processing");
  if (!isGroup(processing)) {
    throw new Error("NWB file has no /processing group with pose data.");
  }

  // First pass: collect every PoseEstimation group path, grouped by module.
  const modulePoseGroups: Array<{ modKey: string; poseKeys: string[] }> = [];
  const allPosePaths: string[] = [];
  for (const modKey of processing.keys()) {
    const mod = root.get(`processing/${modKey}`);
    if (!isGroup(mod)) continue;
    const poseKeys: string[] = [];
    for (const childKey of mod.keys()) {
      const child = root.get(`processing/${modKey}/${childKey}`);
      if (neurodataType(child) === "PoseEstimation") {
        poseKeys.push(childKey);
        allPosePaths.push(`processing/${modKey}/${childKey}`);
      }
    }
    if (poseKeys.length) modulePoseGroups.push({ modKey, poseKeys });
  }

  if (!allPosePaths.length) {
    throw new Error(
      "NWB file does not contain any PoseEstimation (predictions) data.",
    );
  }

  const skeleton = resolveSkeleton(root, allPosePaths);
  if (!skeleton) {
    throw new Error("NWB file has no readable skeleton (nodes/edges).");
  }
  const nodeNames = skeleton.nodeNames;
  const nNodes = nodeNames.length;
  const nodeIndex = new Map<string, number>();
  nodeNames.forEach((n, i) => {
    nodeIndex.set(n, i);
  });

  const videos: Video[] = [];
  const labeledFrames: LabeledFrame[] = [];
  // Recover tracks across the whole file, deduped by name.
  const tracksByName = new Map<string, Track>();

  for (const { modKey, poseKeys } of modulePoseGroups) {
    // One Video per module (SLEAP_VIDEO_*). All PoseEstimation groups in the
    // module reference the same video; read it from the first.
    let filename = "";
    const firstPosePath = `processing/${modKey}/${poseKeys[0]}`;
    const ov = root.get(`${firstPosePath}/original_videos`);
    if (isDataset(ov)) {
      const arr = decodeStringArray(ov.value);
      if (arr.length) filename = arr[0];
    }
    const video = new Video({ filename });
    videos.push(video);

    // frameIdx -> instances at that frame in this video.
    const framesByIdx = new Map<number, PredictedInstance[]>();

    for (const poseKey of poseKeys) {
      const posePath = `processing/${modKey}/${poseKey}`;
      const poseGroup = root.get(posePath);
      if (!isGroup(poseGroup)) continue;

      const trackName = parseTrackName(poseKey);
      let track: Track | null = null;
      if (trackName != null) {
        track = tracksByName.get(trackName) ?? null;
        if (!track) {
          track = new Track(trackName);
          tracksByName.set(trackName, track);
        }
      }

      // frameIdx -> per-node [x, y, score] rows (NaN default) for this track.
      const trackFrames = new Map<number, number[][]>();

      for (const seriesKey of poseGroup.keys()) {
        const seriesPath = `${posePath}/${seriesKey}`;
        const seriesGroup = root.get(seriesPath);
        if (neurodataType(seriesGroup) !== "PoseEstimationSeries") continue;

        // The series name IS the node name.
        const ni = nodeIndex.get(seriesKey);
        if (ni === undefined) continue; // node not in skeleton — skip.

        const dataEntity = root.get(`${seriesPath}/data`);
        if (!isDataset(dataEntity)) continue;
        const dataShape = shapeToNumbers(dataEntity.shape);
        const T = dataShape.length ? dataShape[0] : 0;
        if (T === 0) continue; // empty series → all-NaN node, no samples.
        const dataFlat = toNumberArray(dataEntity.value);

        const confEntity = root.get(`${seriesPath}/confidence`);
        const conf = isDataset(confEntity)
          ? toNumberArray(confEntity.value)
          : null;

        const tsEntity = root.get(`${seriesPath}/timestamps`);
        const timestamps = isDataset(tsEntity)
          ? toNumberArray(tsEntity.value)
          : null;
        const startingTime = readScalarNumber(
          root.get(`${seriesPath}/starting_time`),
        );
        const frameIdxs = recoverFrameIndices(timestamps, startingTime, T);

        for (let i = 0; i < T; i++) {
          const fidx = frameIdxs[i];
          if (fidx === undefined) continue;
          let rows = trackFrames.get(fidx);
          if (!rows) {
            rows = Array.from({ length: nNodes }, () => [
              Number.NaN,
              Number.NaN,
              Number.NaN,
            ]);
            trackFrames.set(fidx, rows);
          }
          rows[ni][0] = dataFlat[i * 2];
          rows[ni][1] = dataFlat[i * 2 + 1];
          rows[ni][2] = conf ? (conf[i] ?? Number.NaN) : Number.NaN;
        }
      }

      // Assemble one PredictedInstance per frame for this track.
      for (const [fidx, rows] of trackFrames) {
        const allNaN = rows.every((r) => Number.isNaN(r[0]));
        if (allNaN) continue;
        const inst = PredictedInstance.fromNumpy({
          pointsData: rows,
          skeleton,
          track,
        });
        let list = framesByIdx.get(fidx);
        if (!list) {
          list = [];
          framesByIdx.set(fidx, list);
        }
        list.push(inst);
      }
    }

    // Group instances into LabeledFrames (multiple tracks share a frame).
    const sortedFrameIdxs = Array.from(framesByIdx.keys()).sort(
      (a, b) => a - b,
    );
    for (const fidx of sortedFrameIdxs) {
      const instances = framesByIdx.get(fidx)!;
      if (instances.length) {
        labeledFrames.push(
          new LabeledFrame({ video, frameIdx: fidx, instances }),
        );
      }
    }
  }

  const tracks = Array.from(tracksByName.values());
  const labels = new Labels({
    videos,
    skeletons: [skeleton],
    tracks,
    labeledFrames,
  });
  if (options?.filename) {
    labels.provenance.filename = String(options.filename);
  }
  return labels;
}
