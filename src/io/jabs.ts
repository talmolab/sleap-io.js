/**
 * JABS (Jackson Lab Animal Behavior System) pose-file reader.
 *
 * A TypeScript port of the reader half of Python sleap-io's
 * `sleap_io/io/jabs.py` (v0.7.x, PR #371), which:
 *
 * - returns {@link PredictedInstance} objects (with per-point confidence
 *   scores), and
 * - emits static objects (arena corners, lixit, food hopper, …) as
 *   {@link UserROI} objects in `labels.staticRois` — `category: "arena"` for
 *   `corners`, `category: "anchor"` otherwise, and `source: "jabs"` — rather
 *   than as synthetic instances/skeletons in frame 0.
 *
 * JABS pose files are HDF5 on disk, so this reader is Node-only (it reads
 * through `openH5File`, which uses h5wasm/node) and is exported from the Node
 * entry point only.
 *
 * Supported pose versions: 2 (single mouse) through 6. Segmentation data (v6)
 * and per-file attributes such as `cm_per_pixel` are ignored, matching Python.
 *
 * The writer half (`convert_labels` / `write_jabs_v*`) is intentionally not
 * ported: per issue #99, `saveJabs` is lower priority since the common workflow
 * is a one-time JABS → SLP conversion.
 */

import { openH5File, nodeFileExists } from "../codecs/slp/h5.js";
import { Labels } from "../model/labels.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { PredictedInstance, Track } from "../model/instance.js";
import { Skeleton, Node, Edge, Symmetry } from "../model/skeleton.js";
import { Video } from "../model/video.js";
import { UserROI, Geometry } from "../model/roi.js";

// =============================================================================
// Default JABS "Mouse" skeleton (12 keypoints)
// =============================================================================

/** Ordered JABS keypoint names (pose versions 2–6). */
export const JABS_DEFAULT_KEYPOINT_NAMES = [
  "NOSE",
  "LEFT_EAR",
  "RIGHT_EAR",
  "BASE_NECK",
  "LEFT_FRONT_PAW",
  "RIGHT_FRONT_PAW",
  "CENTER_SPINE",
  "LEFT_REAR_PAW",
  "RIGHT_REAR_PAW",
  "BASE_TAIL",
  "MID_TAIL",
  "TIP_TAIL",
] as const;

/** Edge connections (by node index) for the default JABS skeleton. Root is BASE_NECK (3). */
export const JABS_DEFAULT_EDGE_INDICES: Array<[number, number]> = [
  // Spine
  [3, 0],
  [3, 6],
  [6, 9],
  [9, 10],
  [10, 11],
  // Ears
  [0, 1],
  [0, 2],
  // Front paws
  [6, 4],
  [6, 5],
  // Rear paws
  [9, 7],
  [9, 8],
];

/** Symmetric node pairs (by node index) for the default JABS skeleton. */
export const JABS_DEFAULT_SYMMETRY_INDICES: Array<[number, number]> = [
  [1, 2], // ears
  [4, 5], // front paws
  [7, 8], // rear paws
];

/** Build a fresh copy of the default JABS "Mouse" skeleton. */
export function makeJabsDefaultSkeleton(): Skeleton {
  const nodes = JABS_DEFAULT_KEYPOINT_NAMES.map((name) => new Node(name));
  const edges = JABS_DEFAULT_EDGE_INDICES.map(([a, b]) => new Edge(nodes[a], nodes[b]));
  const symmetries = JABS_DEFAULT_SYMMETRY_INDICES.map(
    ([a, b]) => new Symmetry([nodes[a], nodes[b]]),
  );
  return new Skeleton({ nodes, edges, symmetries, name: "Mouse" });
}

/**
 * The default JABS "Mouse" skeleton (12 nodes, 11 edges, 3 symmetries).
 *
 * Shared module-level instance used as the default for {@link loadJabs}.
 * Treat it as read-only; callers needing a mutable skeleton should use
 * {@link makeJabsDefaultSkeleton}.
 */
export const JABS_DEFAULT_SKELETON: Skeleton = makeJabsDefaultSkeleton();

// =============================================================================
// Skeleton + instance helpers (ports of make_simple_skeleton /
// prediction_to_instance / _static_object_to_roi)
// =============================================================================

/** Create a `Skeleton` with `numPoints` nodes connected in a line. */
export function makeSimpleSkeleton(name: string, numPoints: number): Skeleton {
  const nodes = Array.from({ length: numPoints }, (_, i) => new Node(`${name}_kp${i}`));
  const edges = Array.from({ length: Math.max(0, numPoints - 1) }, (_, i) => new Edge(nodes[i], nodes[i + 1]));
  return new Skeleton({ nodes, edges, name });
}

/**
 * Build a {@link PredictedInstance} from JABS prediction data.
 *
 * @param data - Keypoint locations as `(nNodes, 2)` in `[x, y]` order (JABS
 *   stores `[y, x]`; the reader flips before calling this).
 * @param confidence - Per-keypoint confidence scores, length `nNodes`.
 * @param skeleton - Skeleton to use for the instance.
 * @param track - Optional track to assign.
 * @returns A `PredictedInstance` with per-point scores, or `null` if no
 *   keypoint has positive confidence.
 */
export function predictionToInstance(
  data: number[][],
  confidence: number[],
  skeleton: Skeleton,
  track?: Track | null,
): PredictedInstance | null {
  if (skeleton.nodes.length !== data.length) {
    throw new Error(
      `Skeleton (${skeleton.nodes.length}) does not match number of keypoints (${data.length})`,
    );
  }

  const pointsData: number[][] = [];
  const scores: number[] = [];
  for (let i = 0; i < skeleton.nodes.length; i++) {
    // Confidence of 0 indicates no keypoint predicted for this instance.
    if (confidence[i] > 0) {
      pointsData.push([data[i][0], data[i][1], confidence[i], 1]);
      scores.push(confidence[i]);
    } else {
      pointsData.push([Number.NaN, Number.NaN, Number.NaN, 0]);
    }
  }

  if (scores.length === 0) return null;
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  return PredictedInstance.fromNumpy({ pointsData, skeleton, track: track ?? null, score: meanScore });
}

/**
 * Convert JABS static-object keypoints into a {@link UserROI}.
 *
 * A single point becomes a `Point` geometry; multiple points become a
 * `MultiPoint`. Coordinates are kept in their stored order (static objects are
 * NOT y/x-flipped, unlike poses). Category is `"arena"` for `corners`,
 * `"anchor"` otherwise; `source` is `"jabs"`.
 */
export function staticObjectToRoi(name: string, coords: number[][], video: Video): UserROI {
  let geometry: Geometry;
  if (coords.length === 1) {
    geometry = { type: "Point", coordinates: [coords[0][0], coords[0][1]] };
  } else {
    geometry = { type: "MultiPoint", coordinates: coords.map(([x, y]) => [x, y]) };
  }
  const category = name === "corners" ? "arena" : "anchor";
  return new UserROI({ geometry, name, category, source: "jabs", video });
}

// =============================================================================
// HDF5 read helpers
// =============================================================================

/** Minimal h5wasm dataset surface used here. */
interface H5Dataset {
  value: ArrayLike<number | bigint>;
  shape: ArrayLike<number | bigint>;
}

/** Minimal h5wasm group surface used here. */
interface H5Group {
  attrs?: Record<string, unknown>;
  keys?: () => string[];
}

/** Minimal h5wasm file surface used here. */
interface H5File {
  get(name: string): unknown;
  keys?: () => string[];
}

/** Fetch a dataset by (possibly nested) path, or null if absent / not a dataset. */
function getDataset(file: H5File, name: string): H5Dataset | null {
  const item = file.get(name) as H5Dataset | null | undefined;
  if (item == null || !("value" in item)) return null;
  return item;
}

/** Unwrap an h5wasm attribute (its real value is behind a `.value` getter). */
function attrValue(attr: unknown): unknown {
  if (attr == null) return undefined;
  if (typeof attr === "object" && "value" in (attr as object)) {
    return (attr as { value: unknown }).value;
  }
  return attr;
}

/** Coerce a flat-array element (number | bigint) to a number. */
function num(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v;
}

// =============================================================================
// Reader (port of read_labels)
// =============================================================================

/** Options for {@link loadJabs}. */
export interface LoadJabsOptions {
  /**
   * Skeleton to use for instances. Defaults to {@link JABS_DEFAULT_SKELETON}
   * (the JABS v2–6 "Mouse" skeleton). Must have one node per keypoint column.
   */
  skeleton?: Skeleton | null;
}

/**
 * Read a JABS pose file (HDF5) into a {@link Labels} object.
 *
 * Instances are {@link PredictedInstance} objects with per-point confidence
 * scores; v5+ static objects are loaded as {@link UserROI} static ROIs. The
 * associated {@link Video} filename is derived from the pose-file name
 * (`*_pose_est_vN.h5` → `*.avi`).
 *
 * Node-only (reads HDF5 via h5wasm).
 *
 * Divergence from Python: a missing file raises (matching Python's
 * `FileNotFoundError`), but Python's separate `os.R_OK` `PermissionError` for a
 * present-but-unreadable file is not replicated — such a file instead surfaces
 * whatever error the underlying h5wasm reader throws.
 *
 * @param labelsPath - Path to the JABS pose file.
 * @param options - Optional `skeleton` override.
 */
export async function loadJabs(labelsPath: string, options?: LoadJabsOptions): Promise<Labels> {
  const skeleton = options?.skeleton ?? JABS_DEFAULT_SKELETON;

  // Video name is the pose file minus the pose-est suffix.
  const videoName = labelsPath.replace(/(_pose_est_v[2-6])?\.h5/g, ".avi");
  const video = new Video({ filename: videoName, openBackend: false });

  // Mirror Python's explicit existence check (h5wasm/node may not throw
  // synchronously for a missing path). Resolves to null in non-Node runtimes.
  const exists = await nodeFileExists(labelsPath);
  if (exists === false) {
    throw new Error(`${labelsPath} doesn't exist.`);
  }

  const tracks = new Map<number, Track>();
  const frames: LabeledFrame[] = [];

  const { file: rawFile, close } = await openH5File(labelsPath);
  const file = rawFile as unknown as H5File;
  try {
    const pointsDs = getDataset(file, "poseest/points");
    if (pointsDs == null) {
      throw new Error(`JABS pose file is missing 'poseest/points': ${labelsPath}`);
    }
    const pShape = Array.from(pointsDs.shape, num);
    const numFrames = pShape[0];

    // Resolve pose version from the `poseest` group's `version` attribute.
    const poseest = file.get("poseest") as H5Group | null;
    const verRaw = poseest?.attrs ? attrValue(poseest.attrs["version"]) : undefined;
    let poseVersion: number;
    if (verRaw != null && (verRaw as ArrayLike<unknown>).length > 0) {
      poseVersion = Number((verRaw as ArrayLike<number | bigint>)[0]);
    } else {
      // Version absent → assume v2; the points array must be single-mouse (3D).
      if (pShape.length !== 3) {
        throw new Error(
          `Pose version not present and shape does not match single mouse: ` +
            `shape of ${JSON.stringify(pShape)} for ${labelsPath}`,
        );
      }
      poseVersion = 2;
    }

    // Uniform indexing: treat single-mouse (3D [F, N, 2]) as M = 1, which has
    // the same flat layout as [F, 1, N, 2].
    const M = pShape.length === 4 ? pShape[1] : 1;
    const N = pShape[pShape.length - 2];

    const pointsVal = pointsDs.value;
    const confVal = (getDataset(file, "poseest/confidence")?.value ?? []) as ArrayLike<number | bigint>;

    if (poseVersion === 2) {
      tracks.set(1, new Track("1"));
    }

    // Identity field + per-frame instance counts for multi-mouse versions.
    // Mirror Python (which indexes these datasets directly and KeyErrors if
    // absent): a malformed multi-mouse file is rejected loudly rather than
    // silently yielding empty frames. (Consistent with the missing-`points`
    // and missing-version guards above.)
    let idVal: ArrayLike<number | bigint> | null = null;
    let instanceCountVal: ArrayLike<number | bigint> | null = null;
    if (poseVersion === 3) {
      const idDs = getDataset(file, "poseest/instance_track_id");
      const countDs = getDataset(file, "poseest/instance_count");
      if (idDs == null) {
        throw new Error(`JABS pose file is missing 'poseest/instance_track_id': ${labelsPath}`);
      }
      if (countDs == null) {
        throw new Error(`JABS pose file is missing 'poseest/instance_count': ${labelsPath}`);
      }
      idVal = idDs.value;
      instanceCountVal = countDs.value;
    } else if (poseVersion > 3) {
      const idDs = getDataset(file, "poseest/instance_embed_id");
      if (idDs == null) {
        throw new Error(`JABS pose file is missing 'poseest/instance_embed_id': ${labelsPath}`);
      }
      idVal = idDs.value;
    }

    /** Extract one instance's [x, y] keypoints (flipped from y,x) + confidence. */
    const extractInstance = (f: number, slot: number): { data: number[][]; conf: number[] } => {
      const data: number[][] = [];
      const conf: number[] = [];
      for (let n = 0; n < N; n++) {
        const flat = (f * M + slot) * N + n;
        const pbase = flat * 2;
        const rawY = num(pointsVal[pbase]);
        const rawX = num(pointsVal[pbase + 1]);
        data.push([rawX, rawY]); // flip JABS (y, x) → (x, y)
        conf.push(confVal.length ? num(confVal[flat]) : 0);
      }
      return { data, conf };
    };

    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      const instances: PredictedInstance[] = [];

      if (poseVersion === 2) {
        // Single-animal case.
        const { data, conf } = extractInstance(frameIdx, 0);
        const inst = predictionToInstance(data, conf, skeleton, tracks.get(1));
        // (Python appends unconditionally here; we guard out the all-zero-
        // confidence case to avoid placing a null in `instances`.)
        if (inst) instances.push(inst);
      } else {
        // Multi-animal case.
        let maxIds: number;
        if (poseVersion === 3) {
          maxIds = instanceCountVal ? num(instanceCountVal[frameIdx]) : M;
        } else {
          maxIds = M;
        }
        for (let curId = 0; curId < maxIds; curId++) {
          const poseId = idVal ? num(idVal[frameIdx * M + curId]) : 0;
          // v4+ uses reserved values (<= 0) for invalid/unused poses. (Ignores
          // `poseest/id_mask` to keep predictions not assigned a long-term id.)
          if (poseVersion > 3 && poseId <= 0) continue;
          if (!tracks.has(poseId)) {
            tracks.set(poseId, new Track(String(poseId)));
          }
          const { data, conf } = extractInstance(frameIdx, curId);
          const inst = predictionToInstance(data, conf, skeleton, tracks.get(poseId));
          if (inst) instances.push(inst);
        }
      }

      frames.push(new LabeledFrame({ video, frameIdx, instances }));
    }

    // Static objects (v5+) as ROIs.
    const rois: UserROI[] = [];
    const rootKeys = typeof file.keys === "function" ? file.keys() : [];
    if (poseVersion >= 5 && rootKeys.includes("static_objects")) {
      const soGroup = file.get("static_objects") as H5Group | null;
      const objNames = soGroup && typeof soGroup.keys === "function" ? soGroup.keys() : [];
      for (const objName of objNames) {
        const ds = getDataset(file, `static_objects/${objName}`);
        if (ds == null) continue;
        const shape = Array.from(ds.shape, num);
        const nPts = shape[0] ?? 0;
        const coords: number[][] = [];
        for (let k = 0; k < nPts; k++) {
          coords.push([num(ds.value[k * 2]), num(ds.value[k * 2 + 1])]);
        }
        rois.push(staticObjectToRoi(objName, coords, video));
      }
    }

    // Skeletons and tracks are auto-collected from instances by the Labels
    // constructor (mirroring Python's `Labels(frames, rois=rois)`); static ROIs
    // go to `labels.staticRois`.
    const labels = new Labels({ labeledFrames: frames, rois });
    labels.provenance["filename"] = labelsPath;
    return labels;
  } finally {
    close();
  }
}
