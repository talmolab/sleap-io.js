import {
  buildColumnCarry,
  carriedColumn,
  isUnknownColumn,
  POSE_TABLES,
  sessionCarryOwners,
  type UnknownColumns,
} from "./carry-read.js";
/**
 * Streaming SLP file reader using HTTP range requests.
 *
 * This module provides a streaming alternative to `readSlp` that uses
 * `StreamingH5File` for efficient range request-based file access.
 * Only the data actually needed is downloaded, rather than the entire file.
 *
 * @module
 */

import {
  checkPoseTables,
  countUnlabeledPoints,
  hasSkippedInstanceRows,
  isColumnarTable,
  isKnownPoseColumn,
  skipsInstanceRow,
  METADATA_SUBGROUP,
  negativeFrameKeysFromFrames,
  type PoseTableName,
  poseTableFromColumns,
  unknownColumns,
} from "./columnar.js";
import {
  type ColumnTable,
  FORMAT3_TABLES,
  type Format3TableName,
  isKnownTableColumn,
  linkProblems,
  reportTableProblems,
  sessionProblems,
  TABLE_SPECS,
  tableFromColumns,
  unknownTableColumns,
  unknownTableGroups,
} from "./columnar-tables.js";
import { checkSlpFormat, SlpFormatError } from "./format-check.js";
import { streamingUnreadMembers } from "./streaming-coverage.js";
import {
  buildFormat3Summary,
  checkFormat3Option,
  checkMetadataColumns,
  chooseFormat3Access,
  type Format3Option,
  metadataKindsOf,
  isFormat3,
  metadataColumn,
  metadataKindFromH5,
  PARTLY_READ_GROUPS,
  type SlpSourceFormat,
  unreadMembers,
} from "./format3.js";
import {
  type MetadataColumns,
  metadataKeys,
  metadataRecord,
} from "../../model/record-metadata.js";
import {
  markFrameSource,
  markSessionSource,
  markSource,
} from "../../model/source-mark.js";
import {
  openH5Worker,
  type StreamingH5File,
  isStreamingSupported,
  type StreamingH5Source,
} from "./h5-streaming.js";
import {
  attrToNumber,
  attrToString,
  datasetValueToString,
  parseMetadataJson,
  missingMetadataJsonError,
  parseJsonEntry,
  decodeEntryText,
  sessionsReadError,
  reconstructColumnarFrameGroups,
  sessionMetadataFromJson,
  type SessionData,
  type SessionPointMatrix,
  parseSkeletons,
  parseTracks,
  parseVideosMetadata,
  parseSuggestions,
  resolveCameraKey,
  normalizeCameraSize,
  reconstructInstance3D,
  resolveIdentity,
} from "./parsers.js";
import { buildSourceVideoFromDict } from "./source-video.js";
import { Labels } from "../../model/labels.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import type { Centroid } from "../../model/centroid.js";
import { buildCentroidTuples } from "./centroids.js";
import type { BoundingBox } from "../../model/bbox.js";
import { BBOX_NUMERIC_COLUMNS, buildBboxTuples } from "./bboxes.js";
import { LazyDataStore, LazyFrameList } from "../../model/lazy.js";
import { buildVideoIdMap } from "../../model/video-id-map.js";
import {
  markNegativeFrames,
  negativeFrameKeys,
} from "../../model/negative-frames.js";
import {
  Instance,
  PredictedInstance,
  type Track,
  type PointColumns,
} from "../../model/instance.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video } from "../../model/video.js";
import {
  Camera,
  CameraGroup,
  FrameGroup,
  InstanceGroup,
  injectSessionFrameResolver,
  RecordingSession,
} from "../../model/camera.js";
import { Identity } from "../../model/identity.js";
import { Embedding } from "../../model/embedding.js";
import { StreamingHdf5VideoBackend } from "../../video/streaming-hdf5-video.js";
import { CropVideoBackend } from "../../video/crop-backend.js";
import { resolveSourceFrameCount } from "./frame-count.js";
import { checkPointSpans, columnLength } from "./point-spans.js";
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
  /**
   * Extra HTTP request headers (e.g. `{ Authorization: "Bearer …" }`) forwarded
   * to the streaming worker. When non-empty, the worker downloads the file in a
   * buffer (authenticated) rather than using header-free range streaming.
   */
  headers?: Record<string, string>;
  /** Whether to open video backends for embedded videos (default: false) */
  openVideos?: boolean;
  /**
   * Capture the verbatim, deep-cloned `sessions_json` dict onto each
   * `RecordingSession.rawJson` (deprecated, transitional). Default `false`. See
   * `RecordingSession.rawJson`.
   */
  rawSessions?: boolean;
  /**
   * Defer frame materialization. When `true`, the pose tables are wrapped in a
   * `LazyDataStore`/`LazyFrameList` and individual `LabeledFrame`/`Instance`
   * objects are built only on first access (via `labels.frameAt(i)` /
   * `labels.materialize()`), instead of eagerly building the full object graph.
   * Bounds peak memory for very large prediction files. Default `false`.
   */
  lazy?: boolean;
  /**
   * Defer per-video metadata reads. When `true`, embedded videos are built from
   * `videos_json` ALONE — skipping the per-video HDF5 reads (dataset lookup,
   * `getAttrs`, `frame_numbers`, `frame_sizes`, `source_video`) that dominate
   * open time on many-video `pkg.slp` files read over high-latency storage
   * (hundreds of videos × several serial reads each). Shape/channel_order come
   * from JSON (with the `format_id` default fallback), so the videos panel still
   * shows dimensions; backends are NOT built — the caller opens them on demand
   * (e.g. on first view). Default `false`. Independent of `openVideos`; when
   * set, embedded backends are always deferred. Frames render blank until the
   * caller builds a backend on demand.
   */
  lazyVideoMetadata?: boolean;
  /**
   * Read only user (ground-truth) instances. Predicted instances are skipped and
   * the `pred_points` table is never read: in a predictions file that table is
   * most of the file, so a caller that only needs the labels (skeleton, videos,
   * user-labeled frames), reading over a slow link, avoids downloading it.
   * Frames whose only instances were predictions are dropped; frames that had
   * no instances to begin with (e.g. negative frames) are kept. A user
   * instance's `fromPredicted` link is left unset, and recording sessions
   * (multi-camera groupings) aren't read. Default `false`. Can't be combined
   * with `lazy`, and a file in SLP format 3.0 opens with it only with
   * `format3: "view"` (a save would lose what the filter skipped).
   */
  userInstancesOnly?: boolean;
  /**
   * When an instance's point span doesn't match its skeleton's node count,
   * the read throws `SlpPointSpanError` (like Python sleap-io). Set this to
   * recover files older sleap-io.js versions wrote: shifted spans are rebuilt
   * when that's provably exact (the point rows are intact: no gaps or
   * overlaps, one row per node), and an instance whose rows are provably its
   * own but sit under the wrong skeleton is loaded as stored, with a
   * `console.warn`. Anything else still throws. Default `false`. See #230.
   */
  repairPointSpans?: boolean;
  /**
   * Optional progress callback fired as loading advances through its stages.
   * `current` counts completed stages out of `total`; `message` labels the
   * stage about to run. Matches the (current, total, message?) convention used
   * elsewhere in the library (Labels.merge, RenderOptions.onProgress).
   */
  onProgress?: (current: number, total: number, message?: string) => void;
  /**
   * What a later save may do with a file in SLP format 3.0: unset or
   * `"keep"` (saves keep format 3.0), `"view"` (read-only, every SLP writer
   * refuses the labels), `"edit"` (a save writes the 2.x layout and drops what
   * it cannot store) or `"ask"` (throw `SlpFormat3ChoiceError`). See
   * `readSlp`.
   */
  format3?: Format3Option;
  /**
   * For a file in SLP format 3.0: throw {@link StreamingIncompleteError},
   * before reading any table, when it holds content this reader does not read
   * (ROIs, masks, label images, links and embeddings of detections other than
   * instances), so the caller can use the in-memory reader instead. `loadSlp`
   * does that in its default (`"auto"`) mode. Default `false`: such content is
   * not read, and the file's summary lists it as something an edit drops.
   * Files before 3.0 are read as always (this reader skips that content in
   * them too, without a summary).
   */
  failIfIncomplete?: boolean;
}

/**
 * Thrown by the streaming reader, when asked (`failIfIncomplete`), for a file
 * that holds content it does not read. `unread` lists it, as paths.
 */
export class StreamingIncompleteError extends Error {
  readonly unread: string[];

  constructor(labelsPath: string, unread: string[]) {
    super(
      `The streaming reader does not read ${unread.join(", ")} of ` +
        `'${labelsPath}'; read it with readSlp or readSlpLazy instead.`,
    );
    this.name = "StreamingIncompleteError";
    this.unread = unread;
    Object.setPrototypeOf(this, new.target.prototype);
  }
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
/**
 * Read the `/centroids` group (SLP first-class centroid annotations) via the
 * streaming file API. Mirrors the eager `readCentroids`, but each column is an
 * async range read. Returns `[centroid, videoIdx, frameIdx]` routing tuples;
 * `[]` when the group is absent. Without this, a browser/Tauri load (which uses
 * the streaming reader) silently drops centroids that the eager/lazy readers keep.
 */
async function readCentroidsStreaming(
  file: StreamingH5File,
  tracks: Track[],
): Promise<[Centroid, number, number][]> {
  try {
    if (!file.keys().includes("centroids")) return [];
    const numCol = async (name: string): Promise<ArrayLike<number>> => {
      try {
        const d = await file.getDatasetValue(`centroids/${name}`);
        return normalizeDatasetArray(d.value) as ArrayLike<number>;
      } catch {
        return [];
      }
    };
    const data: Record<string, ArrayLike<number>> = {
      x: await numCol("x"),
      y: await numCol("y"),
      z: await numCol("z"),
      video: await numCol("video"),
      frame_idx: await numCol("frame_idx"),
      track: await numCol("track"),
      instance: await numCol("instance"),
      is_predicted: await numCol("is_predicted"),
      score: await numCol("score"),
      tracking_score: await numCol("tracking_score"),
    };
    const strCol = async (name: string): Promise<string[]> => {
      try {
        const d = await file.getDatasetValue(`centroids/${name}`);
        return normalizeDatasetArray(d.value).map((v) =>
          typeof v === "string"
            ? v
            : v instanceof Uint8Array
              ? new TextDecoder().decode(v)
              : String(v ?? ""),
        );
      } catch {
        return [];
      }
    };
    const categories = await strCol("category");
    const names = await strCol("name");
    const sources = await strCol("source");
    return buildCentroidTuples(data, categories, names, sources, tracks);
  } catch {
    return [];
  }
}

/**
 * Read `/bboxes` (bounding-box annotations) via the streaming file API. Mirrors
 * the eager `readBboxes`: the Python / current-JS columnar GROUP (one child
 * dataset per field, each an async range read) is preferred; a legacy flat
 * `/bboxes` matrix (+ `field_names` attr and root `bbox_*` JSON string
 * datasets) or a pre-2.0 Python compound table is read as a fallback. Returns
 * `[bbox, videoIdx, frameIdx]` routing tuples; `[]` when absent. Without this,
 * a browser/Tauri load (which uses the streaming reader) silently drops every
 * box that the eager/lazy readers keep.
 */
async function readBboxesStreaming(
  file: StreamingH5File,
  tracks: Track[],
  metadata?: MetadataColumns | null,
): Promise<[BoundingBox, number, number][]> {
  try {
    if (!file.keys().includes("bboxes")) return [];
    const decode = (v: unknown): string =>
      typeof v === "string"
        ? v
        : v instanceof Uint8Array
          ? new TextDecoder().decode(v)
          : String(v ?? "");

    // Group layout: `/bboxes` is a group with an `x1` child. (A legacy dataset
    // has no keys; don't probe `bboxes/x1` directly, h5wasm resolves child
    // paths under a dataset to a bogus object.)
    let children: string[] = [];
    try {
      children = await file.getKeys("bboxes");
    } catch {
      children = [];
    }
    if (children.includes("x1")) {
      const data: Record<string, ArrayLike<number>> = {};
      for (const name of BBOX_NUMERIC_COLUMNS) {
        try {
          const d = await file.getDatasetValue(`bboxes/${name}`);
          data[name] = normalizeDatasetArray(d.value) as ArrayLike<number>;
        } catch {
          data[name] = [];
        }
      }
      const strCol = async (name: string): Promise<string[]> => {
        try {
          const d = await file.getDatasetValue(`bboxes/${name}`);
          return normalizeDatasetArray(d.value).map(decode);
        } catch {
          return [];
        }
      };
      const categories = await strCol("category");
      const names = await strCol("name");
      const sources = await strCol("source");
      const tuples = buildBboxTuples(data, categories, names, sources, tracks);
      // Format 3.0 record metadata, by `/bboxes` row (one tuple per row).
      if (metadata) {
        tuples.forEach(([bbox], row) => {
          bbox.metadata = metadataRecord(metadata, row);
        });
      }
      return tuples;
    }

    // Legacy layouts: a flat matrix (+ `field_names`) or compound dataset.
    const data = (await readStructDatasetStreaming(file, "bboxes")) as Record<
      string,
      ArrayLike<number>
    >;
    let bboxAttrs: Record<string, unknown> = {};
    try {
      bboxAttrs = await file.getAttrs("bboxes");
    } catch {
      bboxAttrs = {};
    }
    const keys = file.keys();
    const parseJsonList = (raw: unknown): string[] => {
      const v = (raw as { value?: unknown })?.value ?? raw;
      const text =
        typeof v === "string"
          ? v
          : v instanceof Uint8Array
            ? new TextDecoder().decode(v)
            : null;
      if (text === null) return Array.isArray(v) ? v.map(decode) : [];
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.map(decode) : [];
      } catch {
        return [];
      }
    };
    // v1.9+ JS: root `bbox_*` uint8 datasets holding JSON (also mirrored in a
    // `json` attr); older files: JSON string attrs on `/bboxes` itself.
    const strMeta = async (
      rootName: string,
      attrName: string,
    ): Promise<string[]> => {
      if (keys.includes(rootName)) {
        try {
          const attrs = await file.getAttrs(rootName);
          const fromAttr = parseJsonList(attrs.json);
          if (fromAttr.length) return fromAttr;
        } catch {
          /* fall through to the dataset bytes */
        }
        try {
          const d = await file.getDatasetValue(rootName);
          const v = d.value;
          const bytes =
            v instanceof Uint8Array
              ? v
              : ArrayBuffer.isView(v) || Array.isArray(v)
                ? Uint8Array.from(v as ArrayLike<number>)
                : null;
          if (bytes) {
            const fromData = parseJsonList(bytes);
            if (fromData.length) return fromData;
          }
        } catch {
          /* fall through to the attr on /bboxes */
        }
      }
      return parseJsonList(bboxAttrs[attrName]);
    };
    const categories = await strMeta("bbox_categories", "categories");
    const names = await strMeta("bbox_names", "names");
    const sources = await strMeta("bbox_sources", "sources");
    return buildBboxTuples(data, categories, names, sources, tracks);
  } catch {
    return [];
  }
}

/**
 * Route `[annotation, videoIdx, frameIdx]` tuples onto frames, shared by the
 * streaming centroid and bbox paths (mirrors the eager reader). Eager: push onto
 * the matching LabeledFrame (creating annotation-only frames) and resolve each
 * deferred `_instanceIdx` against the `instances` table rows. Lazy: hand the
 * per-frame map + undistributed list to the store for materializeFrame.
 */
function attachAnnotationTuples<
  T extends {
    instance: Instance | null;
    _instanceIdx: number | null;
  },
>(
  tuples: [T, number, number][],
  opts: {
    labeledFrames: LabeledFrame[] | undefined;
    lazyStore: LazyDataStore | undefined;
    videos: Video[];
    instanceRows: Map<number, Instance | PredictedInstance>;
    userInstancesOnly: boolean;
    frameList: (lf: LabeledFrame) => T[];
    setLazy: (
      store: LazyDataStore,
      byFrame: Map<string, T[]>,
      undistributed: T[],
    ) => void;
  },
): void {
  if (!tuples.length) return;
  const { labeledFrames, lazyStore, videos } = opts;
  if (labeledFrames) {
    const frameMap = new Map<string, LabeledFrame>();
    for (const lf of labeledFrames) {
      frameMap.set(`${videos.indexOf(lf.video)}:${lf.frameIdx}`, lf);
    }
    const getOrCreate = (vidIdx: number, frameIdx: number): LabeledFrame => {
      const key = `${vidIdx}:${frameIdx}`;
      let lf = frameMap.get(key);
      if (!lf) {
        lf = new LabeledFrame({ video: videos[vidIdx], frameIdx });
        frameMap.set(key, lf);
        labeledFrames.push(lf);
      }
      return lf;
    };
    const attached: T[] = [];
    for (const [ann, vidIdx, frameIdx] of tuples) {
      if (vidIdx >= 0 && vidIdx < videos.length && frameIdx >= 0) {
        opts.frameList(getOrCreate(vidIdx, frameIdx)).push(ann);
        attached.push(ann);
      }
    }
    // Resolve deferred instance refs (mirrors the eager reader).
    const allInst = instanceRowLookup(
      labeledFrames,
      opts.instanceRows,
      opts.userInstancesOnly,
    );
    for (const ann of attached) {
      if (ann._instanceIdx !== null && ann._instanceIdx >= 0) {
        const inst = allInst(ann._instanceIdx);
        if (inst) {
          ann.instance = inst;
          ann._instanceIdx = null;
        }
      }
    }
  } else if (lazyStore) {
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
    opts.setLazy(lazyStore, byFrame, undistributed);
  }
}

export async function readSlpStreaming(
  source: StreamingH5Source,
  options?: StreamingSlpOptions,
): Promise<Labels> {
  // A wrong option is the caller's error: refuse it before reading anything.
  checkFormat3Option(options?.format3);
  if (!isStreamingSupported()) {
    throw new Error(
      "Streaming HDF5 requires Web Worker support (browser environment)",
    );
  }

  const file = await openH5Worker(source, {
    h5wasmUrl: options?.h5wasmUrl,
    filenameHint: options?.filenameHint,
    headers: options?.headers,
  });

  const openVideos = options?.openVideos ?? false;
  const lazyVideoMetadata = options?.lazyVideoMetadata ?? false;

  // Determine the source path for video resolution
  const sourcePath =
    typeof source === "string"
      ? source
      : typeof File !== "undefined" && source instanceof File
        ? source.name
        : (options?.filenameHint ?? "slp-data.slp");

  let labels: Labels;
  try {
    labels = await readFromStreamingFile(
      file,
      sourcePath,
      options?.filenameHint,
      openVideos,
      options?.onProgress,
      options?.rawSessions ?? false,
      options?.lazy ?? false,
      lazyVideoMetadata,
      options?.userInstancesOnly ?? false,
      options?.repairPointSpans ?? false,
      options?.format3,
      options?.failIfIncomplete ?? false,
    );
  } catch (e) {
    // A failed read returns no Labels, so no video backend can need the file.
    // Close it, which also ends its worker: a refused file (SlpFormatError) is
    // an ordinary outcome and must not leave a worker running each time.
    await file.close().catch(() => {});
    throw e;
  }
  // Keep the file open when video backends need it: eager (openVideos) OR
  // deferred (lazyVideoMetadata), whose per-video backends read frame data on
  // demand from this same StreamingH5File. Only close for pure metadata reads.
  if (!openVideos && !lazyVideoMetadata) {
    await file.close();
  }
  return labels;
}

/**
 * Read Labels from an already-opened StreamingH5File.
 *
 * Exported for direct testing of the streaming metadata-error path: the full
 * streaming reader (`readSlpStreaming`) is browser/Worker-gated and unreachable
 * from the all-Node test suite, so the error-routing here is exercised by
 * driving this function with a minimal `getAttrs`-providing stub.
 */
export async function readFromStreamingFile(
  file: StreamingH5File,
  url: string,
  filenameHint?: string,
  openVideos: boolean = false,
  onProgress?: (current: number, total: number, message?: string) => void,
  rawSessions: boolean = false,
  lazy: boolean = false,
  lazyVideoMetadata: boolean = false,
  userInstancesOnly: boolean = false,
  repairPointSpans: boolean = false,
  format3Choice?: Format3Option,
  failIfIncomplete: boolean = false,
): Promise<Labels> {
  checkFormat3Option(format3Choice);
  if (lazy && userInstancesOnly) {
    throw new Error(
      "readSlpStreaming: userInstancesOnly can't be combined with lazy",
    );
  }
  // Stage-level progress. The orchestration in this function runs on the MAIN
  // thread — only the low-level HDF5 byte reads are delegated to the worker via
  // `file` — so each phase can be surfaced as it starts without any cross-worker
  // messaging. `current` counts completed stages; `message` labels the stage
  // about to run. (Shape matches Labels.merge / RenderOptions.onProgress.)
  //
  // `total` is DERIVED from this ordered label list (single source of truth) so
  // the count can never drift from the stages. report(i) fires STAGES[i].
  const STAGES = [
    "Reading metadata", // 0
    "Reading tracks", // 1
    "Reading video metadata", // 2 (also holds the bar for "Opening videos (i/n)")
    "Reading suggestions", // 3
    "Reading frames", // 4
    "Reading instances", // 5
    "Reading points", // 6
    "Building labeled frames", // 7
    "Reading identities", // 8
    "Reading sessions", // 9
  ] as const;
  const total = STAGES.length;
  const report = (n: number, message?: string) =>
    onProgress?.(n, total, message ?? STAGES[n]);

  report(0);
  const labelsPath =
    filenameHint ?? url.split("/").pop()?.split("?")[0] ?? "slp-data.slp";
  // A missing `metadata` group surfaces from the worker as a thrown
  // "Path not found: metadata"; treat that the same as a missing `json`
  // attribute (both indicate a truncated/corrupt file) and route it through
  // the same helpful error. Mirrors Python sleap-io PR #446, where
  // `read_metadata` catches the `KeyError` from BOTH cases and maps them to
  // the same `ValueError`, and matches the eager/lazy readers in read.ts.
  let metadataAttrs: Record<string, unknown>;
  try {
    metadataAttrs = await file.getAttrs("metadata");
  } catch {
    throw missingMetadataJsonError(labelsPath);
  }
  // Refuse formats this version can't read before touching anything else; a
  // newer layout would otherwise load with no error and no poses (#278).
  checkSlpFormat(labelsPath, metadataAttrs);
  const formatId = Number(
    (metadataAttrs["format_id"] as { value?: number })?.value ??
      metadataAttrs["format_id"] ??
      1.0,
  );
  // Throws the same helpful error if the `metadata` group exists but its
  // required `json` attribute is missing/empty (truncated/corrupt file);
  // mirrors Python sleap-io PR #446 and matches the eager/lazy readers.
  const metadataJson = parseMetadataJson(
    metadataAttrs["json"],
    labelsPath,
  ) as Record<string, unknown> | null;

  const skeletons = parseSkeletons(metadataJson);
  if (
    userInstancesOnly &&
    format3Choice !== "view" &&
    format3Choice !== "ask" &&
    isFormat3(formatId)
  ) {
    // The filter drops predicted instances and every recording session, which
    // a save of an edit load would then lose without the summary saying so.
    throw new Error(
      `readSlpStreaming: '${labelsPath}' is in SLP format 3.0; ` +
        "userInstancesOnly drops its predicted instances and sessions, so it " +
        'can only be opened with format3: "view" (or without the filter).',
    );
  }
  if (failIfIncomplete && isFormat3(formatId)) {
    const unread = await unreadByStreaming(file, file.keys());
    if (unread.length > 0) {
      throw new StreamingIncompleteError(labelsPath, unread);
    }
  }

  report(1);
  const tracks = await readTracksStreaming(file);

  // Read per-video crop records (SLP 2.3; empty on old/uncropped files).
  report(2);
  const videoCrops = await readVideoCropsStreaming(file);

  // Read video metadata (and optionally create backends for embedded videos).
  // When opening videos, the per-video reporter keeps the bar at this stage
  // while the label counts videos (probeShape per embedded backend is slow).
  const videos = await readVideosStreaming(
    file,
    labelsPath,
    openVideos,
    formatId,
    videoCrops,
    openVideos ? (i, n) => report(2, `Opening videos (${i}/${n})`) : undefined,
    lazyVideoMetadata,
  );

  report(3);
  const suggestions = await readSuggestionsStreaming(file, videos);

  // Read frame/instance/point data
  report(4);
  const readTable = (table: PoseTableName) =>
    readPoseTableStreaming(file, table, formatId, labelsPath);
  const framesData = await readTable("frames");
  report(5);
  const instancesData = await readTable("instances");
  report(6);
  const pointsData = await readTable("points");
  const predPointsData = userInstancesOnly
    ? {}
    : await readTable("pred_points");
  // With userInstancesOnly the predicted points are not read, but a 3.0
  // file's summary must still count their unlabelled points: fetch only the
  // two flag columns for that.
  const predPointFlags =
    userInstancesOnly && formatId >= 3.0
      ? await readPointFlagsStreaming(file, "pred_points")
      : null;
  // Format 3.0 keeps the negative flag as a `/frames` column.
  const negativeFrames = framesData.is_negative
    ? negativeFrameKeysFromFrames(framesData)
    : negativeFrameKeys(
        await readStructDatasetStreaming(file, "negative_frames"),
      );
  // Format 3.0: range checks, record metadata, and the caller's choice
  // (throws SlpFormat3ChoiceError without one) before frames are built.
  const format3 = await readFormat3Streaming(file, labelsPath, formatId, {
    framesData,
    instancesData,
    pointsData,
    predPointsData: userInstancesOnly ? null : predPointsData,
    predPointFlags,
    nVideos: videos.length,
    choice: format3Choice,
    provenanceInMetadata: !!metadataJson && "provenance" in metadataJson,
  });
  checkPointSpans({
    framesData,
    instancesData,
    skeletons,
    videos,
    pointsRowCount: columnLength(pointsData),
    predPointsRowCount: columnLength(predPointsData),
    repair: repairPointSpans,
    userInstancesOnly,
    labelsPath,
  });

  // Build labeled frames eagerly, or (lazy mode) wrap the columnar tables in a
  // LazyDataStore and defer LabeledFrame/Instance construction to first access.
  report(7);
  const lazyStore = lazy
    ? new LazyDataStore({
        framesData,
        instancesData,
        pointsData,
        predPointsData,
        skeletons,
        tracks,
        videos,
        formatId,
        negativeFrames,
        instanceMetadata: format3?.instanceMetadata,
        frameMetadata: format3?.frameMetadata,
        sourceFormat: format3?.sourceFormat,
      })
    : undefined;
  // Instances by their row in the `instances` table, which is what identity
  // links and centroid refs point at. Without `userInstancesOnly` that is
  // simply the frames' instances in order.
  const instanceRows = new Map<number, Instance | PredictedInstance>();
  // Look instances up by `/instances` row through `instanceRows` when the
  // frames' instances are not every row: predictions dropped, or 3.0 rows of
  // another instance type skipped.
  const rowsByMap = userInstancesOnly || hasSkippedInstanceRows(instancesData);
  const labeledFrames = lazyStore
    ? undefined
    : buildLabeledFrames({
        framesData,
        instancesData,
        pointsData,
        predPointsData,
        skeletons,
        tracks,
        videos,
        formatId,
        userInstancesOnly,
        instanceRows,
        instanceMetadata: format3?.instanceMetadata,
        frameMetadata: format3?.frameMetadata,
      });
  if (labeledFrames) {
    markNegativeFrames(labeledFrames, negativeFrames, framesData, videos);
  }

  // Read identities
  report(8);
  const identities = await readIdentitiesStreaming(file);

  // Per-detection identity (SLP 2.5) + category (SLP 2.7), OWNER_INSTANCE. Applied
  // directly to concrete instances (non-lazy) or handed to the lazy store for
  // on-demand attach in materializeFrame.
  if (labeledFrames || lazyStore) {
    const { links, embs, catLinks, catEmbs, categoryCatalog } =
      await readStreamingInstanceIdentity(file, labelsPath);
    if (links.size || embs.size || catLinks.size || catEmbs.size) {
      if (labeledFrames) {
        const allInstances = instanceRowLookup(
          labeledFrames,
          instanceRows,
          rowsByMap,
        );
        for (const [ownerId, [idx, score]] of links) {
          const inst = allInstances(ownerId);
          if (inst && idx >= 0 && idx < identities.length) {
            inst.identity = identities[idx];
            inst.identityScore = score;
          }
        }
        for (const [ownerId, emb] of embs) {
          const inst = allInstances(ownerId);
          if (inst) inst.identityEmbedding = emb;
        }
        for (const [ownerId, [idx, score]] of catLinks) {
          const inst = allInstances(ownerId);
          if (inst && idx >= 0 && idx < categoryCatalog.length) {
            inst.category = categoryCatalog[idx];
            inst.categoryScore = score;
          }
        }
        for (const [ownerId, emb] of catEmbs) {
          const inst = allInstances(ownerId);
          if (inst) inst.categoryEmbedding = emb;
        }
      }
      if (lazyStore) {
        lazyStore.identities = identities;
        lazyStore._instanceIdentityLinks = links;
        lazyStore._instanceEmbeddings = embs;
        lazyStore.categoryCatalog = categoryCatalog;
        lazyStore._instanceCategoryLinks = catLinks;
        lazyStore._instanceCategoryEmbeddings = catEmbs;
      }
    }
  }

  // Centroids (`/centroids` group) and bounding boxes (`/bboxes`). The eager and
  // lazy readers read these; the streaming reader (browser/Tauri WebView) must
  // too, or a loaded project silently drops its centroid / box annotations.
  const attachCommon = {
    labeledFrames,
    lazyStore,
    videos,
    instanceRows,
    userInstancesOnly: rowsByMap,
  };
  // Every record carries the open-time choice wherever it goes (frames and
  // instances are marked below, or by the lazy store as they materialize).
  const markTuples = <T extends object>(tuples: [T, number, number][]) => {
    for (const [ann] of tuples) markSource(ann, format3?.sourceFormat);
    return tuples;
  };
  attachAnnotationTuples<Centroid>(
    markTuples(await readCentroidsStreaming(file, tracks)),
    {
      ...attachCommon,
      frameList: (lf) => lf.centroids,
      setLazy: (store, byFrame, undistributed) => {
        store._centroidByFrame = byFrame;
        store._undistributedCentroids = undistributed;
      },
    },
  );
  attachAnnotationTuples<BoundingBox>(
    markTuples(await readBboxesStreaming(file, tracks, format3?.bboxMetadata)),
    {
      ...attachCommon,
      frameList: (lf) => lf.bboxes,
      setLazy: (store, byFrame, undistributed) => {
        store._bboxByFrame = byFrame;
        store._undistributedBboxes = undistributed;
      },
    },
  );

  // Read sessions — grouping captured as index refs (no frame materialization).
  // (Skipped with userInstancesOnly: their groupings refer to frames and
  // instances by position, which no longer line up once predictions are dropped.)
  report(9);
  const sessions = userInstancesOnly
    ? []
    : await readSessionsStreaming(
        file,
        videos,
        skeletons,
        identities,
        rawSessions,
        labelsPath,
        file.keys().includes("frames") ? columnLength(framesData) : null,
      );

  onProgress?.(total, total, "Finalizing");
  // In lazy mode omit `labeledFrames` entirely (mirrors readSlpLazy): the Labels
  // ctor's instance-track registration is guarded by `!_lazyFrameList`, and the
  // proxy is attached below — so tracks come only from the explicit `tracks`.
  const labels = new Labels({
    ...(labeledFrames ? { labeledFrames } : {}),
    videos,
    skeletons,
    tracks,
    suggestions,
    sessions,
    identities,
    provenance: (metadataJson?.provenance as Record<string, unknown>) ?? {},
  });
  labels.sourceFormat = format3?.sourceFormat ?? null;
  if (format3) {
    // Unknown columns of the tables this reader reads, kept to write back on
    // a format 3.0 save (the pose tables', and the links').
    const carried = [
      ...POSE_TABLES,
      "identity/links",
      "categories/links",
      "session_data/frame_groups",
      "session_data/instance_groups",
      "session_data/instance_group_members",
    ];
    const unknown = await readUnknownColumnsStreaming(file, carried);
    const column = async (p: string): Promise<number[]> =>
      Array.from(
        ((await file.getDatasetValue(p)).value ?? []) as ArrayLike<unknown>,
        Number,
      );
    const links = {
      identityLinks: await linkKeysStreaming(file, "identity/links"),
      categoryLinks: await linkKeysStreaming(file, "categories/links"),
      sessions: (await isGroupStreaming(file, "session_data/frame_groups"))
        ? sessionCarryOwners(sessions, {
            nFrameGroups: (await column("session_data/frame_groups/frame_idx"))
              .length,
            memberStart: await column(
              "session_data/instance_groups/member_start",
            ),
            memberEnd: await column("session_data/instance_groups/member_end"),
            camera: await column("session_data/instance_group_members/camera"),
          })
        : undefined,
    };
    if (lazyStore) {
      const pose: NonNullable<LazyDataStore["unknownColumns"]> = {};
      for (const table of POSE_TABLES) {
        if (unknown[table]) pose[table] = unknown[table];
      }
      lazyStore.unknownColumns = Object.keys(pose).length > 0 ? pose : null;
      lazyStore.annotationCarry = buildColumnCarry(
        unknown,
        links,
        carried.slice(POSE_TABLES.length),
      );
    } else if (labeledFrames) {
      const nFrameRows = columnLength(framesData);
      const nInstanceRows = (instancesData.instance_type ?? []).length;
      labels._carriedColumns = buildColumnCarry(
        unknown,
        {
          frames:
            labeledFrames.length === nFrameRows
              ? labeledFrames.slice()
              : undefined,
          instances: Array.from({ length: nInstanceRows }, (_, row) =>
            instanceRows.get(row),
          ),
          instanceRows: {
            type: instancesData.instance_type ?? [],
            start: instancesData.point_id_start ?? [],
            end: instancesData.point_id_end ?? [],
          },
          nPoints: columnLength(pointsData),
          nPredPoints: columnLength(predPointsData),
          pointsOf: (inst) => (inst as Instance)._xy,
          ...links,
        },
        carried,
      );
    }
  }
  markSessionSource(sessions, format3?.sourceFormat);
  if (labeledFrames) {
    for (const frame of labeledFrames) {
      markFrameSource(frame, format3?.sourceFormat);
    }
  }
  if (lazyStore) {
    // Attach the lazy proxies BEFORE injectSessionFrameResolver so the resolver's
    // frameAt() resolves against the lazy list (a single frame on demand, never
    // the full table). Note: LazyDataStore.materializeFrame indexes videos by the
    // raw video id (no buildVideoIdMap remap) — this matches readSlpLazy and only
    // differs from the eager streaming build for rare sparse/non-contiguous ids.
    labels._lazyFrameList = new LazyFrameList(lazyStore);
    labels._lazyDataStore = lazyStore;
    lazyStore.sourceSessionCount = sessions.length;
  }
  // Sessions are read before the frame store exists; wire the lazy frame
  // resolver now so ref-backed grouping resolves against labels.labeledFrames
  // (or, in lazy mode, the attached _lazyFrameList via frameAt).
  injectSessionFrameResolver(labels);
  return labels;
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
  file: StreamingH5File,
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
 * Read a video's `source_video` metadata JSON from its `{group}/source_video`
 * HDF5 group over the streaming worker, or `null` when absent. Checks a `json`
 * *dataset* first (oversized metadata) then the `json` *attribute* (normal
 * case), mirroring the sync reader and Python `_read_source_video_json`.
 */
export async function readSourceVideoGroupJsonStreaming(
  file: Pick<StreamingH5File, "getKeys" | "getAttrs" | "getDatasetValue">,
  groupPath: string,
): Promise<Record<string, unknown> | null> {
  const svPath = `${groupPath}/source_video`;
  let raw: string | undefined;
  try {
    const keys = await file.getKeys(svPath);
    if (keys.includes("json")) {
      // Oversized (spilled) metadata: a scalar `|S<n>` dataset. Decode every
      // backend representation through the shared helper (h5wasm string,
      // jsfive length-1 array, raw bytes) rather than the partial inline checks.
      // Scope the guard tightly (mirrors the sync reader) so a dataset-read
      // failure falls back to the `json` attribute instead of dropping the
      // lineage.
      try {
        const { value } = await file.getDatasetValue(`${svPath}/json`);
        raw = datasetValueToString(value);
      } catch {
        raw = undefined;
      }
    }
    if (raw === undefined) {
      const attrs = await file.getAttrs(svPath);
      raw = attrToString(attrs.json);
    }
  } catch {
    return null;
  }
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
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
  videoCrops?: Map<number, VideoCropEntry>,
  onVideoProgress?: (current: number, total: number) => void,
  lazyVideoMetadata: boolean = false,
): Promise<Video[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("videos_json")) return [];

    const data = await file.getDatasetValue("videos_json");
    const values = normalizeDatasetArray(data.value);
    const metadataList = parseVideosMetadata(values, labelsPath);

    const videos: Video[] = [];

    for (let videoIndex = 0; videoIndex < metadataList.length; videoIndex++) {
      onVideoProgress?.(videoIndex + 1, metadataList.length);
      const meta = metadataList[videoIndex];

      // Fast path: build the embedded Video from videos_json ALONE, skipping
      // every per-video HDF5 read (dataset lookup, getAttrs, frame_numbers,
      // frame_sizes, source_video). Those serial reads dominate open time on
      // many-video pkg.slp over high-latency storage. No backend is built here —
      // the caller opens one on demand (frames render blank until then). Shape
      // and channel_order come from JSON (with the format_id default fallback),
      // so the videos panel still reports dimensions.
      if (lazyVideoMetadata && meta.embedded) {
        const datasetPath = meta.dataset ?? `video${videoIndex}/video`;
        // Seed the source frame count from videos_json (the embedded/labeled
        // count); the deferred backend corrects it to the true source count from
        // frame_numbers/`frames` attr on first view.
        const frameCount = resolveSourceFrameCount({
          jsonFrameCount: meta.frameCount,
        });
        const shape: [number, number, number, number] | undefined =
          meta.height && meta.width && meta.channels
            ? [frameCount ?? 0, meta.height, meta.width, meta.channels]
            : undefined;
        const channelOrder =
          meta.channelOrder ?? (formatId < 1.4 ? "BGR" : "RGB");
        // Deferred backend: no per-video HDF5 reads now; getFrame() lazily reads
        // frame_numbers/frame_sizes/attrs on first view (ensureLoaded). Holds the
        // still-open StreamingH5File, so readSlpStreaming must NOT close it.
        const backend = new StreamingHdf5VideoBackend({
          filename: Array.isArray(meta.filename)
            ? (meta.filename[0] ?? "")
            : meta.filename,
          h5file: file,
          datasetPath,
          format: meta.format ?? "png",
          channelOrder,
          shape,
          fps: meta.fps,
          deferred: true,
        });
        const sourceVideo = meta.sourceVideo
          ? buildSourceVideoFromDict(meta.sourceVideo, labelsPath)
          : null;
        videos.push(
          new Video({
            filename: meta.filename,
            backend,
            backendMetadata: {
              dataset: datasetPath,
              format: meta.format,
              shape,
              fps: meta.fps,
              channel_order: channelOrder,
              grayscale: meta.grayscale,
            },
            sourceVideo,
            openBackend: false,
            embedded: meta.embedded,
          }),
        );
        continue;
      }

      // Auto-detect dataset path when embedded but not specified in metadata
      let datasetPath: string | undefined = meta.dataset;
      if (meta.embedded && !datasetPath) {
        datasetPath =
          (await findVideoDatasetStreaming(file, videoIndex)) ?? undefined;
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
            const v =
              typeof attr === "object" && attr !== null && "value" in attr
                ? (attr as { value: unknown }).value
                : attr;
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
        meta.height && meta.width && meta.channels
          ? [frameCount ?? 0, meta.height, meta.width, meta.channels]
          : undefined;

      // Determine channel order with priority:
      // 1. JSON metadata (meta.channelOrder)
      // 2. HDF5 dataset attribute (channelOrderFromAttrs)
      // 3. Legacy fallback based on format_id (BGR for < 1.4)
      const channelOrder =
        meta.channelOrder ??
        channelOrderFromAttrs ??
        (formatId < 1.4 ? "BGR" : "RGB");

      // Create streaming backend for embedded videos when openVideos is true
      let backend = null;
      if (openVideos && meta.embedded && datasetPath) {
        backend = new StreamingHdf5VideoBackend({
          // Embedded videos always carry a single string filename (the labels
          // path); the array form is only for image sequences, which never
          // reach this embedded branch. Narrow for the type checker.
          filename: Array.isArray(meta.filename)
            ? (meta.filename[0] ?? "")
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
        grayscale: meta.grayscale,
      };

      // Crop reconstruction (SLP 2.3): wrap the uncropped inner backend and seed
      // crop/source_shape/shape/crop_fill so streaming reads report the cropped
      // view identically to the eager reader. Mirrors read.ts readVideos.
      const cropEntry = videoCrops?.get(videoIndex);
      if (cropEntry) {
        const [cx1, cy1, cx2, cy2] = cropEntry.crop;
        if (openVideos && videoBackend) {
          // Each reloaded tile owns its freshly-reconstructed inner (ownsInner
          // defaults to true). We do NOT share one inner across sibling mosaic
          // tiles here: on read each video entry rebuilds a private inner, so
          // sharing would leave the inner unowned (leaked — never closed) for no
          // decode savings. The streaming inner already shares the single
          // StreamingH5File worker across all backends and never closes it
          // (streaming-hdf5-video.ts), so the per-tile wrapper is cheap and its
          // ownsInner=true is harmless (close() only clears the wrapper's tiny
          // legacy cache; it cannot tear down the shared worker file). Live
          // mosaic decode-sharing is opt-in and in-memory only, via
          // Video.crop({ shareDecode: true }). Mirrors Python slp.py make_video
          // (slp.py:393-401).
          videoBackend = CropVideoBackend.wrap({
            inner: videoBackend,
            crop: cropEntry.crop,
            fill: cropEntry.fill,
            // ownsInner: true (default) — see comment above.
          });
        }
        if (shape && shape.length === 4) {
          backendMetadata.source_shape = [...shape];
          backendMetadata.shape = [shape[0], cy2 - cy1, cx2 - cx1, shape[3]];
        }
        backendMetadata.crop = [...cropEntry.crop];
        backendMetadata.crop_fill = cropEntry.fill;
      }

      // Reconstruct the source_video lineage WITH its recorded shape (and any
      // deeper chain), preferring the authoritative `{group}/source_video` HDF5
      // group for embedded videos and falling back to the nested videos_json
      // dict — parity with the eager reader (read.ts) for #160.
      let sourceVideo: Video | null = null;
      if (meta.embedded && datasetPath) {
        const groupPath = datasetPath.endsWith("/video")
          ? datasetPath.slice(0, -6)
          : datasetPath;
        const svDict = await readSourceVideoGroupJsonStreaming(file, groupPath);
        if (svDict) sourceVideo = buildSourceVideoFromDict(svDict, labelsPath);
      }
      if (!sourceVideo && meta.sourceVideo) {
        sourceVideo = buildSourceVideoFromDict(meta.sourceVideo, labelsPath);
      }

      videos.push(
        new Video({
          filename: meta.filename,
          backend: videoBackend,
          backendMetadata,
          sourceVideo,
          openBackend: openVideos && meta.embedded,
          embedded: meta.embedded,
        }),
      );
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
  datasetPath: string,
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
  datasetPath: string,
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
  videoIndex: number,
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
async function readSuggestionsStreaming(
  file: StreamingH5File,
  videos: Video[],
): Promise<SuggestionFrame[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("suggestions_json")) return [];

    const data = await file.getDatasetValue("suggestions_json");
    const values = normalizeDatasetArray(data.value);
    const metadataList = parseSuggestions(values);

    return metadataList
      .map((meta) => {
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
async function readIdentitiesStreaming(
  file: StreamingH5File,
): Promise<Identity[]> {
  try {
    const keys = file.keys();
    if (keys.includes("identities_json")) {
      const data = await file.getDatasetValue("identities_json");
      const values = normalizeDatasetArray(data.value);
      const identities: Identity[] = [];
      for (const entry of values) {
        const parsed = parseJsonEntry(entry) as Record<string, unknown>;
        const { name, color, ...rest } = parsed;
        identities.push(
          new Identity({
            name: (name as string) ?? "",
            color: color as string | undefined,
            metadata: rest,
          }),
        );
      }
      return identities;
    }
    // Python-style /identity group fallback (no identities_json).
    if (keys.includes("identity")) {
      const children = await file.getKeys("identity");
      if (children.includes("name")) {
        const names = normalizeDatasetArray(
          (await file.getDatasetValue("identity/name")).value,
        ).map((n) => decodeEntryText(n) ?? "");
        const metadata: Record<string, unknown>[] = names.map(() => ({}));
        if (children.includes("meta_owner")) {
          const owners = normalizeDatasetArray(
            (await file.getDatasetValue("identity/meta_owner")).value,
          ).map(Number);
          const mkeys = normalizeDatasetArray(
            (await file.getDatasetValue("identity/meta_key")).value,
          ).map((k) => decodeEntryText(k) ?? "");
          const mvals = normalizeDatasetArray(
            (await file.getDatasetValue("identity/meta_val")).value,
          ).map((v) => decodeEntryText(v) ?? "");
          owners.forEach((o, i) => {
            if (metadata[o]) metadata[o][mkeys[i]] = mvals[i];
          });
        }
        return names.map((name, i) => {
          const m = metadata[i];
          const color = typeof m.color === "string" ? m.color : undefined;
          const { color: _color, ...rest } = m;
          return new Identity({ name, color, metadata: rest });
        });
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Read the OWNER_INSTANCE per-detection identity links + embeddings (SLP 2.5) over
 * the streaming API, keyed by global instance_id. Returns empty maps on pre-2.5
 * files. Streaming builds only `Instance`s, so only OWNER_INSTANCE is read; the
 * result is applied either to a concrete instance list (non-lazy) or handed to the
 * `LazyDataStore` for on-demand attach (lazy).
 */
async function readStreamingInstanceIdentity(
  file: StreamingH5File,
  labelsPath: string,
): Promise<{
  links: Map<number, [number, number | null]>;
  embs: Map<number, Embedding>;
  catLinks: Map<number, [number, number | null]>;
  catEmbs: Map<number, Embedding>;
  categoryCatalog: string[];
}> {
  const rootKeys = file.keys();

  // OWNER_INSTANCE rows of a links table (identity or categories).
  const readOwnerInstanceLinks = async (
    group: "identity" | "categories",
    idxField: string,
    scoreField: string,
  ): Promise<Map<number, [number, number | null]>> => {
    const out = new Map<number, [number, number | null]>();
    try {
      if (!rootKeys.includes(group)) return out;
      const children = await file.getKeys(group);
      if (!children.includes("links")) return out;
      // Format 3.0: a group of columns, whose catalog indices must name an
      // entry of the catalog beside it. Before: a compound dataset.
      const table = `${group}/links` as const;
      let cols: Record<string, ArrayLike<unknown>> | null =
        await readColumnTableStreaming(file, table, labelsPath);
      if (cols) {
        reportTableProblems(
          labelsPath,
          linkProblems(
            table,
            cols,
            await datasetLengthStreaming(file, group, "name"),
          ),
        );
      } else {
        cols = await readStructDatasetStreaming(file, table, true);
      }
      const ot = cols.owner_type ?? [];
      const oid = cols.owner_id ?? [];
      const idx = cols[idxField] ?? [];
      const sc = cols[scoreField] ?? [];
      for (let i = 0; i < ot.length; i += 1) {
        if (Number(ot[i]) !== 0) continue; // OWNER_INSTANCE only
        const score = Number(sc[i]);
        out.set(Number(oid[i]), [
          Number(idx[i]),
          Number.isNaN(score) ? null : score,
        ]);
      }
    } catch (err) {
      // Optional, except that inconsistent 3.0 tables are refused.
      if (err instanceof SlpFormatError) throw err;
    }
    return out;
  };

  // OWNER_INSTANCE rows of an /embeddings triple (identity or category).
  const readOwnerInstanceEmbs = async (
    vecName: string,
    otName: string,
    oidName: string,
  ): Promise<Map<number, Embedding>> => {
    const out = new Map<number, Embedding>();
    try {
      if (!rootKeys.includes("embeddings")) return out;
      if (!(await file.getKeys("embeddings")).includes(vecName)) return out;
      const vd = await file.getDatasetValue(`embeddings/${vecName}`);
      const flat = vd.value as ArrayLike<number>;
      const rows = vd.shape?.[0] ?? 0;
      const dim = vd.shape && vd.shape.length >= 2 ? vd.shape[1] : 0;
      if (!rows || !dim) return out;
      const ot = normalizeDatasetArray(
        (await file.getDatasetValue(`embeddings/${otName}`)).value,
      );
      const oid = normalizeDatasetArray(
        (await file.getDatasetValue(`embeddings/${oidName}`)).value,
      );
      for (let i = 0; i < rows; i += 1) {
        if (Number(ot[i]) !== 0) continue; // OWNER_INSTANCE only
        const vec = new Array<number>(dim);
        for (let j = 0; j < dim; j += 1) vec[j] = Number(flat[i * dim + j]);
        out.set(Number(oid[i]), new Embedding(vec));
      }
    } catch {
      /* optional */
    }
    return out;
  };

  let categoryCatalog: string[] = [];
  try {
    if (
      rootKeys.includes("categories") &&
      (await file.getKeys("categories")).includes("name")
    ) {
      categoryCatalog = normalizeDatasetArray(
        (await file.getDatasetValue("categories/name")).value,
      ).map((n) => decodeEntryText(n) ?? "");
    }
  } catch {
    /* optional */
  }

  return {
    links: await readOwnerInstanceLinks(
      "identity",
      "identity_idx",
      "identity_score",
    ),
    embs: await readOwnerInstanceEmbs("vectors", "owner_type", "owner_id"),
    catLinks: await readOwnerInstanceLinks(
      "categories",
      "category_idx",
      "category_score",
    ),
    catEmbs: await readOwnerInstanceEmbs(
      "category_vectors",
      "category_owner_type",
      "category_owner_id",
    ),
    categoryCatalog,
  };
}

/**
 * Read recording sessions from sessions_json dataset.
 */
// Exported for a Worker-free unit test of the streaming session-read wiring:
// the full streaming reader (`readSlpStreaming`) is browser/Worker-gated and
// unreachable in the Node test runner, so tests drive this directly with a fake
// `StreamingH5File`. Not re-exported from the package barrel (see src/index.ts).
export async function readSessionsStreaming(
  file: StreamingH5File,
  videos: Video[],
  skeletons: Skeleton[],
  identities?: Identity[],
  captureRaw: boolean = false,
  labelsPath: string = "slp-data.slp",
  nFrames: number | null = null,
): Promise<RecordingSession[]> {
  try {
    const keys = file.keys();
    if (!keys.includes("sessions_json")) return [];

    const data = await file.getDatasetValue("sessions_json");
    const values = normalizeDatasetArray(data.value);
    // A present-but-empty dataset is a legitimate "no sessions" state (return []).
    // A present dataset whose entries read back blank/unparseable is NOT — it is
    // the h5wasm vlen read ceiling (sleap-io.js#220), handled by sessionsReadError.
    if (values.length === 0) return [];

    // SLP 2.8 columnar /session_data (read once for all sessions), or null for
    // legacy ≤2.7 files.
    const sessionData = await readSessionDataStreaming(
      file,
      labelsPath,
      nFrames,
    );

    const sessions: RecordingSession[] = [];
    for (const entry of values) {
      let parsed: Record<string, unknown>;
      try {
        parsed = parseJsonEntry(entry) as Record<string, unknown>;
      } catch (err) {
        throw sessionsReadError(values.length, entry, err);
      }
      if (!parsed || typeof parsed !== "object") {
        throw sessionsReadError(values.length, entry);
      }
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
          size: normalizeCameraSize(cameraData.size),
        });
        cameraGroup.cameras.push(camera);
        cameraMap.set(String(key), camera);
      }
      cameraGroup.metadata =
        (calibration.metadata as Record<string, unknown> | undefined) ?? {};

      const session = new RecordingSession({
        cameraGroup,
        metadata: sessionMetadataFromJson(parsed),
      });
      // Optionally retain the verbatim parsed sessions_json dict (deprecated,
      // opt-in via `rawSessions`). Deep-cloned so it is an INDEPENDENT snapshot
      // (the object model reuses `parsed`'s nested metadata/calibration objects
      // by reference). Never re-written to disk; see RecordingSession.rawJson.
      // Mirrors readSessions in read.ts.
      if (captureRaw) session.rawJson = structuredClone(parsed);

      const map = (parsed.camcorder_to_video_idx_map ?? {}) as Record<
        string,
        unknown
      >;
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

      // SLP 2.8 columnar path: reconstruct from /session_data via the session's
      // fg_start/fg_end range (shared with the eager reader). Dispatched on both
      // fg_start (slim sessions_json) and the loaded /session_data group.
      const fgStart = parsed.fg_start;
      if (fgStart != null && sessionData) {
        const frameGroupMap = reconstructColumnarFrameGroups(
          cameraGroup.cameras,
          skeletons,
          identities,
          sessionData,
          Number(fgStart),
          Number(parsed.fg_end),
        );
        for (const [k, v] of frameGroupMap) session.frameGroups.set(k, v);
        sessions.push(session);
        continue;
      }

      // Legacy (≤2.7) inline path.
      const frameGroups = Array.isArray(parsed.frame_group_dicts)
        ? parsed.frame_group_dicts
        : [];
      for (const group of frameGroups) {
        const groupRecord = group as Record<string, unknown>;
        const frameIdx =
          (groupRecord.frame_idx as number | undefined) ??
          (groupRecord.frameIdx as number | undefined) ??
          0;
        const instanceGroups: InstanceGroup[] = [];
        const instanceGroupList = Array.isArray(groupRecord.instance_groups)
          ? groupRecord.instance_groups
          : [];
        for (const instanceGroup of instanceGroupList) {
          const instanceGroupRecord = instanceGroup as Record<string, unknown>;
          // Concrete instances only for the JS-inline format; the Python/
          // camcorder format is stored as index refs and resolved lazily via the
          // injected frame resolver (no frame materialization at read time).
          let instanceByCamera: Map<Camera, Instance> | undefined;
          const instancesRecord = (instanceGroupRecord.instances ??
            {}) as Record<string, unknown>;
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
            if (!instanceByCamera)
              instanceByCamera = new Map<Camera, Instance>();
            instanceByCamera.set(
              camera,
              new Instance({
                points: points as Record<string, number[]>,
                skeleton,
              }),
            );
          }

          // Capture verbatim index refs (camera -> [lfIdx, instIdx]) as NUMBERS.
          let instanceRefsByCamera: Map<Camera, [number, number]> | undefined;
          const lfInstMap =
            (instanceGroupRecord.camcorder_to_lf_and_inst_idx_map ??
              {}) as Record<string, unknown>;
          for (const [camIdx, value] of Object.entries(lfInstMap)) {
            const camera = resolveCameraKey(
              camIdx,
              cameraMap,
              cameraGroup.cameras,
            );
            if (!camera) continue;
            const pair = value as unknown as [unknown, unknown];
            if (!instanceRefsByCamera)
              instanceRefsByCamera = new Map<Camera, [number, number]>();
            instanceRefsByCamera.set(camera, [
              Number(pair[0]),
              Number(pair[1]),
            ]);
          }

          const instance3d = reconstructInstance3D(
            instanceGroupRecord,
            skeletons,
          );
          const identity = resolveIdentity(instanceGroupRecord, identities);

          instanceGroups.push(
            new InstanceGroup({
              instanceByCamera,
              instanceRefsByCamera,
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

        // Capture labeled-frame index refs (camera -> lfIdx) verbatim.
        let labeledFrameRefsByCamera: Map<Camera, number> | undefined;
        const labeledFrameMap = (groupRecord.labeled_frame_by_camera ??
          {}) as Record<string, unknown>;
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
          if (!labeledFrameRefsByCamera)
            labeledFrameRefsByCamera = new Map<Camera, number>();
          labeledFrameRefsByCamera.set(camera, Number(labeledFrameIdx));
        }

        // If no labeled_frame_by_camera, reconstruct refs from
        // camcorder_to_lf_and_inst_idx_map.
        if (!labeledFrameRefsByCamera) {
          for (const instanceGroup of instanceGroupList) {
            const igRecord = instanceGroup as Record<string, unknown>;
            const lfInstMap = (igRecord.camcorder_to_lf_and_inst_idx_map ??
              {}) as Record<string, unknown>;
            for (const [camIdx, value] of Object.entries(lfInstMap)) {
              const camera = resolveCameraKey(
                camIdx,
                cameraMap,
                cameraGroup.cameras,
              );
              if (!camera) continue;
              const pair = value as unknown as [unknown, unknown];
              if (!labeledFrameRefsByCamera)
                labeledFrameRefsByCamera = new Map<Camera, number>();
              labeledFrameRefsByCamera.set(camera, Number(pair[0]));
            }
          }
        }

        session.frameGroups.set(
          Number(frameIdx),
          new FrameGroup({
            frameIdx: Number(frameIdx),
            instanceGroups,
            labeledFrameRefsByCamera,
            metadata:
              (groupRecord.metadata as Record<string, unknown> | undefined) ??
              {},
          }),
        );
      }
      sessions.push(session);
    }
    return sessions;
  } catch (err) {
    // Fail loud (sleap-io.js#220): a present-but-unreadable sessions_json must
    // surface, not silently drop calibration + grouping + 3D as an empty list
    // (which the next save would then overwrite 2D-only). Absent/empty datasets
    // already returned [] above without reaching here.
    if (err instanceof Error) throw err;
    throw new Error(`Failed to read sessions_json: ${String(err)}`);
  }
}

/**
 * Read the columnar `/session_data` group (SLP 2.8) over the streaming/worker API
 * into a backend-agnostic {@link SessionData} for {@link reconstructColumnarFrameGroups},
 * or `null` when the group is absent (legacy ≤2.7) or missing a struct table.
 *
 * `file.keys()` is a root-level snapshot, so the group's child datasets are listed
 * via `getKeys("session_data")`; the struct tables are read through
 * `readStructDatasetStreaming` (with `assumePresent`, since presence is already
 * confirmed), and `points_3d`/`pred_points_3d` + the vlen meta arrays via
 * `getDatasetValue` (whole-read — the tables are small; range-reads can come later).
 */
async function readSessionDataStreaming(
  file: StreamingH5File,
  labelsPath: string,
  nFrames: number | null,
): Promise<SessionData | null> {
  if (!file.keys().includes("session_data")) return null;
  const children = new Set(await file.getKeys("session_data"));
  // Format 3.0 stores the three tables as groups of columns (a missing one is
  // empty, as in Python sleap-io); before, as compound datasets.
  const names = [
    "frame_groups",
    "instance_groups",
    "instance_group_members",
  ] as const;
  let columnar = false;
  for (const name of names) {
    if (
      children.has(name) &&
      !(await isDatasetStreaming(file, `session_data/${name}`))
    ) {
      columnar = true;
    }
  }

  const struct = async (
    name: (typeof names)[number],
  ): Promise<Record<string, ArrayLike<unknown>> | null> => {
    const table = `session_data/${name}` as const;
    if (columnar) {
      return (
        (await readColumnTableStreaming(file, table, labelsPath)) ??
        emptyColumnTable(table)
      );
    }
    if (!children.has(name)) return null;
    const cols = await readStructDatasetStreaming(file, table, true);
    return Object.keys(cols).length ? cols : null;
  };
  const frameGroups = await struct("frame_groups");
  const instanceGroups = await struct("instance_groups");
  const members = await struct("instance_group_members");
  if (!frameGroups || !instanceGroups || !members) return null;

  const matrix = async (
    name: string,
    ncolsDefault: number,
  ): Promise<SessionPointMatrix | null> => {
    if (!children.has(name)) return null;
    const d = await file.getDatasetValue(`session_data/${name}`);
    const ncols = d.shape && d.shape.length >= 2 ? d.shape[1] : ncolsDefault;
    return { flat: d.value as ArrayLike<number>, ncols };
  };
  const meta = async (name: string): Promise<unknown[] | null> => {
    if (!children.has(name)) return null;
    const d = await file.getDatasetValue(`session_data/${name}`);
    return normalizeDatasetArray(d.value);
  };

  const points3d = await matrix("points_3d", 3);
  const predPoints3d = await matrix("pred_points_3d", 4);
  if (columnar) {
    const rows = (m: SessionPointMatrix | null) =>
      m && m.ncols > 0 ? Math.floor(m.flat.length / m.ncols) : 0;
    reportTableProblems(
      labelsPath,
      sessionProblems({
        frameGroups: frameGroups as ColumnTable,
        instanceGroups: instanceGroups as ColumnTable,
        members: members as ColumnTable,
        nPoints3d: rows(points3d),
        nPredPoints3d: rows(predPoints3d),
        nIdentities: file.keys().includes("identity")
          ? ((await datasetLengthStreaming(file, "identity", "name")) ?? 0)
          : 0,
        nFrames,
      }),
    );
  }
  return {
    frameGroups,
    instanceGroups,
    members,
    points3d,
    predPoints3d,
    frameGroupMeta: await meta("frame_group_meta"),
    instanceGroupMeta: await meta("instance_group_meta"),
  };
}

/**
 * Read a structured dataset and normalize to column format.
 */
/** The children of a group, or none when the path is absent or a dataset. */
async function childKeys(
  file: StreamingH5File,
  path: string,
): Promise<string[]> {
  try {
    return await file.getKeys(path);
  } catch {
    return [];
  }
}

/**
 * Whether `path` is a group, and so is each of its parents (a path under a
 * dataset is not a group).
 */
async function isGroupStreaming(
  file: StreamingH5File,
  path: string,
): Promise<boolean> {
  const parts = path.split("/");
  let parent = "";
  for (const part of parts) {
    const children = parent ? await childKeys(file, parent) : file.keys();
    if (!children.includes(part)) return false;
    parent = parent ? `${parent}/${part}` : part;
    if (await isDatasetStreaming(file, parent)) return false;
  }
  return true;
}

/**
 * Read one of the format 3.0 tables other than the pose tables when it is
 * stored as a group of columns, or `null` when it is not. Mirrors
 * `readColumnTable` in read.ts: only the columns this version knows are
 * fetched.
 *
 * @throws {SlpTableError} When a required column is missing or the columns
 *   differ in length.
 */
async function readColumnTableStreaming(
  file: StreamingH5File,
  table: Format3TableName,
  labelsPath: string,
): Promise<ColumnTable | null> {
  if (!(await isGroupStreaming(file, table))) return null;
  const columns: Record<string, ArrayLike<unknown>> = {};
  const unknownLengths: Record<string, number> = {};
  for (const name of await membersStreaming(file, table, "Dataset")) {
    if (isKnownTableColumn(table, name)) {
      columns[name] = normalizeDatasetArray(
        (await file.getDatasetValue(`${table}/${name}`)).value,
      );
    } else if (name !== TABLE_SPECS[table].buffer) {
      const shape = (await file.getDatasetMeta(`${table}/${name}`)).shape;
      if (shape?.length) unknownLengths[name] = shape[0];
    }
  }
  return tableFromColumns(table, columns, labelsPath, unknownLengths);
}

/** An empty table of one of the format 3.0 tables. */
function emptyColumnTable(table: Format3TableName): ColumnTable {
  return tableFromColumns(
    table,
    Object.fromEntries(TABLE_SPECS[table].numbers.map((c) => [c, []])),
    "",
  );
}

/** The length of a 1-D dataset under `group`, or `null` when it is absent. */
async function datasetLengthStreaming(
  file: StreamingH5File,
  group: string,
  name: string,
): Promise<number | null> {
  if (!(await childKeys(file, group)).includes(name)) return null;
  const meta = await file.getDatasetMeta(`${group}/${name}`);
  return meta?.shape?.[0] ?? 0;
}

/**
 * Read one pose table in either layout: a compound dataset (formats 1.x and
 * 2.x) or, from format 3.0 on, a group with one dataset per column (see
 * columnar.ts). The columns are fetched one by one from the worker.
 */
async function readPoseTableStreaming(
  file: StreamingH5File,
  table: PoseTableName,
  formatId: number,
  labelsPath: string,
  // biome-ignore lint/suspicious/noExplicitAny: matches the 2.x table type
): Promise<Record<string, any>> {
  // The layout is decided per table by node type, as the eager reader and
  // Python sleap-io do: a group is read as columns, a dataset as 2.x.
  const present = file.keys().includes(table);
  const isGroup = present && !(await isDatasetStreaming(file, table));
  if (!isGroup) {
    if (formatId >= 3.0 && !present) return {};
    return readStructDatasetStreaming(file, table);
  }
  const columns: Record<string, ArrayLike<unknown>> = {};
  for (const name of await childKeys(file, table)) {
    // Only the columns this version knows are fetched; the others are listed
    // as unknown (see readFormat3Streaming) and would be dropped by a save.
    if (!isKnownPoseColumn(table, name)) continue;
    const data = await file.getDatasetValue(`${table}/${name}`);
    columns[name] = data.value as ArrayLike<unknown>;
  }
  return poseTableFromColumns(table, columns, labelsPath);
}

/**
 * The `labeled` and `visible` columns of a 3.0 point table, without the rest
 * of it, or `null` when it has no `labeled` column (every point labelled).
 */
async function readPointFlagsStreaming(
  file: StreamingH5File,
  table: "points" | "pred_points",
): Promise<Record<string, ArrayLike<unknown>> | null> {
  if (!file.keys().includes(table)) return null;
  const names = await childKeys(file, table);
  if (!names.includes("labeled")) return null;
  const flags: Record<string, ArrayLike<unknown>> = {};
  for (const name of ["labeled", "visible"]) {
    if (names.includes(name)) {
      flags[name] = normalizeDatasetArray(
        (await file.getDatasetValue(`${table}/${name}`)).value,
      );
    }
  }
  return flags;
}

/** Whether `path` is a dataset (a group has no shape). */
async function isDatasetStreaming(
  file: StreamingH5File,
  path: string,
): Promise<boolean> {
  try {
    const meta = await file.getDatasetMeta(path);
    return Array.isArray(meta?.shape);
  } catch {
    return false;
  }
}

/** The members of a group of the given type, or none when it is absent. */
/**
 * The unknown columns of a format 3.0 file's tables `tables` (see
 * carry-read.ts), read through the worker, to write them back on a format 3.0
 * save.
 */
async function readUnknownColumnsStreaming(
  file: StreamingH5File,
  tables: readonly string[],
): Promise<UnknownColumns> {
  const out: UnknownColumns = {};
  for (const table of tables) {
    if (!(await isGroupStreaming(file, table))) continue;
    for (const name of await membersStreaming(file, table, "Dataset")) {
      if (!isUnknownColumn(table, name)) continue;
      const path = `${table}/${name}`;
      const meta = await file.getDatasetMeta(path);
      const info = {
        ...((meta.metadata ?? {}) as object),
        shape: meta.shape ?? null,
      };
      if (!Array.isArray(meta.shape) || meta.shape.length !== 1) continue;
      const column = carriedColumn(
        info,
        (await file.getDatasetValue(path)).value,
      );
      if (column) {
        out[table] ??= {};
        out[table][name] = column;
      }
    }
  }
  return out;
}

/** The `(owner_type, owner_id, catalog index)` of each 3.0 link row. */
async function linkKeysStreaming(
  file: StreamingH5File,
  table: "identity/links" | "categories/links",
): Promise<number[][] | undefined> {
  if (!(await isGroupStreaming(file, table))) return undefined;
  const index = table === "identity/links" ? "identity_idx" : "category_idx";
  const read = async (name: string): Promise<ArrayLike<unknown>> =>
    ((await file.getDatasetValue(`${table}/${name}`))
      .value as ArrayLike<unknown>) ?? [];
  const type = await read("owner_type");
  const owner = await read("owner_id");
  const idx = await read(index);
  return Array.from({ length: type.length }, (_, i) => [
    Number(type[i]),
    Number(owner[i]),
    Number(idx[i]),
  ]);
}

async function membersStreaming(
  file: StreamingH5File,
  path: string,
  type: "Group" | "Dataset",
): Promise<string[]> {
  const out: string[] = [];
  for (const name of await childKeys(file, path)) {
    if (
      (await isDatasetStreaming(file, `${path}/${name}`)) ===
      (type === "Dataset")
    ) {
      out.push(name);
    }
  }
  return out;
}

/**
 * Read the record metadata of a format 3.0 table through the worker. Mirrors
 * `readMetadataColumns` in read.ts: members that are not a group with a 1-D
 * `values` dataset of a supported kind are ignored.
 *
 * @throws {Error} When a key does not have one row per record.
 */
async function readMetadataColumnsStreaming(
  file: StreamingH5File,
  table: string,
  rows: number,
  labelsPath: string,
): Promise<MetadataColumns | null> {
  const base = `${table}/${METADATA_SUBGROUP}`;
  const columns: MetadataColumns = {};
  for (const key of await membersStreaming(file, base, "Group")) {
    const datasets = await membersStreaming(file, `${base}/${key}`, "Dataset");
    if (!datasets.includes("values")) continue;
    const meta = await file.getDatasetMeta(`${base}/${key}/values`);
    const md = meta.metadata as Parameters<typeof metadataKindFromH5>[0];
    // A uint8 column written by this library may be marked boolean.
    const kindAttr =
      md?.type === 0
        ? await file
            .getAttrs(`${base}/${key}/values`)
            .then((attrs) => attrs.kind ?? null)
            .catch(() => null)
        : undefined;
    const kind = metadataKindFromH5(md, kindAttr);
    if (kind === null) continue;
    const values = (await file.getDatasetValue(`${base}/${key}/values`)).value;
    const present = datasets.includes("present")
      ? (await file.getDatasetValue(`${base}/${key}/present`)).value
      : null;
    const column = metadataColumn(kind, values, present);
    if (column) columns[key] = column;
  }
  checkMetadataColumns(table, columns, rows, labelsPath);
  return Object.keys(columns).length > 0 ? columns : null;
}

/** What the streaming reader keeps from the format 3.0 parts of a file. */
interface Format3ReadStreaming {
  sourceFormat: SlpSourceFormat;
  instanceMetadata: MetadataColumns | null;
  frameMetadata: MetadataColumns | null;
  bboxMetadata: MetadataColumns | null;
}

/**
 * For a file in format 3.0: run the range checks over its pose tables, read
 * its record metadata and unknown column names, and apply the caller's
 * `format3` choice. Mirrors `readFormat3` in read.ts. Returns `null` for files
 * before 3.0. `predPointsData` is `null` when `/pred_points` was not read
 * (`userInstancesOnly`): its range and unlabelled points are then not checked.
 *
 * @throws {SlpFormat3ChoiceError} When the caller gave no choice.
 * @throws {Error} When the 3.0 pose tables are inconsistent.
 */
async function readFormat3Streaming(
  file: StreamingH5File,
  labelsPath: string,
  formatId: number,
  tables: {
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTableStreaming
    framesData: Record<string, any>;
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTableStreaming
    instancesData: Record<string, any>;
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTableStreaming
    pointsData: Record<string, any>;
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTableStreaming
    predPointsData: Record<string, any> | null;
    /** `labeled`/`visible` of `/pred_points` when the table itself was not read. */
    predPointFlags?: Record<string, ArrayLike<unknown>> | null;
    nVideos: number;
    choice: Format3Option | undefined;
    /** Whether `/metadata`'s `json` attribute holds the provenance. */
    provenanceInMetadata?: boolean;
  },
): Promise<Format3ReadStreaming | null> {
  if (!isFormat3(formatId)) return null;
  const { framesData, instancesData, pointsData, predPointsData } = tables;
  if (isColumnarTable(framesData) && isColumnarTable(instancesData)) {
    checkPoseTables({
      frames: framesData,
      instances: instancesData,
      nPoints: columnLength(pointsData),
      nPredPoints: predPointsData ? columnLength(predPointsData) : null,
      nVideos: tables.nVideos,
      labelsPath,
    });
  }
  const instanceMetadata = await readMetadataColumnsStreaming(
    file,
    "instances",
    (instancesData.instance_type ?? []).length,
    labelsPath,
  );
  const frameMetadata = await readMetadataColumnsStreaming(
    file,
    "frames",
    (framesData.frame_idx ?? []).length,
    labelsPath,
  );
  const root = file.keys();
  const bboxColumns = root.includes("bboxes")
    ? await membersStreaming(file, "bboxes", "Dataset")
    : [];
  const bboxMetadata = bboxColumns.includes("x1")
    ? await readMetadataColumnsStreaming(
        file,
        "bboxes",
        (await file.getDatasetMeta("bboxes/x1")).shape?.[0] ?? 0,
        labelsPath,
      )
    : null;
  const unknown: string[] = [];
  for (const table of [
    "frames",
    "instances",
    "points",
    "pred_points",
  ] as const) {
    if (!root.includes(table)) continue;
    unknown.push(
      ...unknownColumns(table, await membersStreaming(file, table, "Dataset")),
    );
  }
  unknown.push(...unknownColumns("bboxes", bboxColumns));
  const unreadGroups: string[] = [];
  for (const table of FORMAT3_TABLES) {
    if (!(await isGroupStreaming(file, table))) continue;
    unknown.push(
      ...unknownTableColumns(
        table,
        await membersStreaming(file, table, "Dataset"),
      ),
    );
    unreadGroups.push(
      ...unknownTableGroups(
        table,
        await membersStreaming(file, table, "Group"),
      ),
    );
  }
  const groups: Record<string, string[]> = {};
  for (const group of PARTLY_READ_GROUPS) {
    if (root.includes(group)) groups[group] = await childKeys(file, group);
  }
  const summary = buildFormat3Summary({
    formatId,
    unreadTables: [
      ...unreadMembers({
        root,
        groups,
        provenanceInMetadata: tables.provenanceInMetadata ?? false,
      }),
      ...(await unreadByStreaming(file, root)),
      ...unreadGroups,
    ],
    unlabeledUserPoints: countUnlabeledPoints(pointsData),
    unlabeledPredictedPoints: countUnlabeledPoints(
      predPointsData ?? tables.predPointFlags ?? undefined,
    ),
    metadataKeys: {
      instances: metadataKeys(instanceMetadata),
      frames: metadataKeys(frameMetadata),
      bboxes: metadataKeys(bboxMetadata),
    },
    unknownColumns: unknown,
  });
  return {
    sourceFormat: chooseFormat3Access(labelsPath, summary, tables.choice, {
      instances: metadataKindsOf(instanceMetadata),
      frames: metadataKindsOf(frameMetadata),
      bboxes: metadataKindsOf(bboxMetadata),
    }),
    instanceMetadata,
    frameMetadata,
    bboxMetadata,
  };
}

/** The owner types of a links table or embeddings join column, as numbers. */
async function ownerTypesStreaming(
  file: StreamingH5File,
  path: string,
  column: string,
): Promise<number[]> {
  const group = await isGroupStreaming(file, path);
  if (group) {
    if (!(await childKeys(file, path)).includes(column)) return [];
    const value = (await file.getDatasetValue(`${path}/${column}`)).value;
    return normalizeDatasetArray(value).map(Number);
  }
  const cols = await readStructDatasetStreaming(file, path, true);
  return Array.from(cols[column] ?? [], Number);
}

/**
 * What a file holds that the streaming reader, unlike the others, does not
 * read: ROIs, masks and label images (in any layout), and the identity and
 * category links and embeddings of detections other than instances. Listed
 * in the format 3.0 summary so that an edit says it drops them.
 */
async function unreadByStreaming(
  file: StreamingH5File,
  root: readonly string[],
): Promise<string[]> {
  const owners: Record<string, number[]> = {};
  for (const group of ["identity", "categories"]) {
    if (!root.includes(group)) continue;
    if (!(await childKeys(file, group)).includes("links")) continue;
    owners[`${group}/links`] = await ownerTypesStreaming(
      file,
      `${group}/links`,
      "owner_type",
    );
  }
  if (root.includes("embeddings")) {
    const children = await childKeys(file, "embeddings");
    const types: number[] = [];
    for (const column of ["owner_type", "category_owner_type"]) {
      if (!children.includes(column)) continue;
      const value = (await file.getDatasetValue(`embeddings/${column}`)).value;
      types.push(...normalizeDatasetArray(value).map(Number));
    }
    owners.embeddings = types;
  }
  return streamingUnreadMembers({ root, owners });
}

async function readStructDatasetStreaming(
  file: StreamingH5File,
  path: string,
  assumePresent = false,
): Promise<Record<string, unknown[]>> {
  try {
    // `file.keys()` is a root-level snapshot, so a nested path (e.g.
    // `session_data/frame_groups`) is never listed there — callers that have
    // already confirmed presence via `getKeys` pass `assumePresent`.
    if (!assumePresent && !file.keys().includes(path)) return {};

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
          // Accept an array, a `{value}` wrapper (worker-serialized), or a bare
          // string/bytes (some backends return the attribute value unwrapped).
          let raw: unknown = Array.isArray(fnAttr)
            ? fnAttr
            : ((fnAttr as { value?: unknown })?.value ?? fnAttr);
          if (typeof raw === "string") {
            try {
              raw = JSON.parse(raw);
            } catch {
              /* not JSON */
            }
          }
          if (raw instanceof Uint8Array) {
            try {
              raw = JSON.parse(new TextDecoder().decode(raw));
            } catch {
              /* not JSON */
            }
          }
          if (Array.isArray(raw)) {
            fieldNames = raw.map(String);
          }
        }
      } catch {
        /* ignore attribute read errors */
      }
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
        return names.map((n) => n.replace(/'/g, ""));
      }
    }
  }

  if (Array.isArray(dtype)) {
    return dtype.map((pair: [string, string]) => pair[0]);
  }

  if (typeof dtype === "object" && dtype !== null) {
    const dtypeObj = dtype as Record<string, unknown>;
    if (dtypeObj.compound_type && typeof dtypeObj.compound_type === "object") {
      const compound = dtypeObj.compound_type as {
        members?: Array<{ name?: string }>;
      };
      if (compound.members) {
        return compound.members
          .map((m) => m.name)
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
  fieldNames: string[],
): Record<string, unknown[]> {
  if (!value) return {};

  // If value is already an object with arrays (column format)
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value)
  ) {
    const obj = value as Record<string, unknown>;
    // Check if it looks like column data: a `{ field: array }` record. Columns
    // may be plain arrays or TypedArrays — the streaming worker now returns
    // Float64Array columns (transferred, not cloned), which the downstream
    // builder consumes by index just like plain arrays.
    const firstKey = Object.keys(obj)[0];
    const firstCol = firstKey ? obj[firstKey] : undefined;
    if (firstKey && (Array.isArray(firstCol) || ArrayBuffer.isView(firstCol))) {
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
        result[field] = rows.map((row) => row[colIdx]);
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
/**
 * Look up an instance by its row in the `instances` table. Normally the frames'
 * instances, in order, are exactly those rows; with `userInstancesOnly` some rows
 * were skipped, so use the row map `buildLabeledFrames` filled in instead.
 */
function instanceRowLookup(
  labeledFrames: LabeledFrame[],
  instanceRows: Map<number, Instance | PredictedInstance>,
  userInstancesOnly: boolean,
): (row: number) => Instance | PredictedInstance | undefined {
  if (userInstancesOnly) return (row) => instanceRows.get(row);
  const all = labeledFrames.flatMap((f) => f.instances);
  return (row) => all[row];
}

function buildLabeledFrames(options: {
  framesData: Record<string, unknown[]>;
  instancesData: Record<string, unknown[]>;
  pointsData: Record<string, unknown[]>;
  predPointsData: Record<string, unknown[]>;
  skeletons: Skeleton[];
  tracks: Track[];
  videos: Video[];
  formatId: number;
  /** Skip predicted instances (and frames left with none); see `StreamingSlpOptions.userInstancesOnly`. */
  userInstancesOnly?: boolean;
  /** Filled with each built instance, keyed by its `instances` table row. */
  instanceRows?: Map<number, Instance | PredictedInstance>;
  /** Format 3.0 record metadata, by `/instances` and `/frames` row. */
  instanceMetadata?: MetadataColumns | null;
  frameMetadata?: MetadataColumns | null;
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
    userInstancesOnly = false,
    instanceMetadata,
    frameMetadata,
  } = options;
  const frameIds = (framesData.frame_id ?? []) as number[];
  const videoIdToIndex = buildVideoIdMap(framesData, videos);
  const instanceById =
    options.instanceRows ?? new Map<number, Instance | PredictedInstance>();
  const fromPredictedPairs: Array<[number, number]> = [];

  for (let frameIdx = 0; frameIdx < frameIds.length; frameIdx += 1) {
    const rawVideoId = Number((framesData.video as number[])?.[frameIdx] ?? 0);
    const videoIndex = videoIdToIndex.get(rawVideoId) ?? rawVideoId;
    const frameIndex = Number(
      (framesData.frame_idx as number[])?.[frameIdx] ?? 0,
    );
    const instStart = Number(
      (framesData.instance_id_start as number[])?.[frameIdx] ?? 0,
    );
    const instEnd = Number(
      (framesData.instance_id_end as number[])?.[frameIdx] ?? 0,
    );
    const video = videos[videoIndex];
    if (!video) continue;

    const instances: Array<Instance | PredictedInstance> = [];
    for (let instIdx = instStart; instIdx < instEnd; instIdx += 1) {
      const instanceType = Number(
        (instancesData.instance_type as number[])?.[instIdx] ?? 0,
      );
      if (userInstancesOnly && instanceType !== 0) continue;
      // A 3.0 row of another instance type is skipped, as in Python.
      if (skipsInstanceRow(instancesData, instIdx)) continue;
      const skeletonId = Number(
        (instancesData.skeleton as number[])?.[instIdx] ?? 0,
      );
      const trackId = Number(
        (instancesData.track as number[])?.[instIdx] ?? -1,
      );
      const pointStart = Number(
        (instancesData.point_id_start as number[])?.[instIdx] ?? 0,
      );
      const pointEnd = Number(
        (instancesData.point_id_end as number[])?.[instIdx] ?? 0,
      );
      const score = Number((instancesData.score as number[])?.[instIdx] ?? 0);
      const rawTrackingScore =
        formatId < 1.2
          ? 0
          : Number((instancesData.tracking_score as number[])?.[instIdx] ?? 0);
      // NaN means "no score". Files before 3.0 have always read it as 0;
      // from 3.0 it stays NaN, as Python sleap-io's None, so a save writes it
      // back as NaN.
      const trackingScore =
        Number.isNaN(rawTrackingScore) && formatId < 3 ? 0 : rawTrackingScore;
      const fromPredicted = Number(
        (instancesData.from_predicted as number[])?.[instIdx] ?? -1,
      );
      const skeleton =
        skeletons[skeletonId] ?? skeletons[0] ?? new Skeleton({ nodes: [] });
      const track = trackId >= 0 ? tracks[trackId] : null;
      const metadata = metadataRecord(instanceMetadata, instIdx);

      let instance: Instance | PredictedInstance;
      if (instanceType === 0) {
        // Build straight from the point columns — no intermediate Point[].
        instance = Instance._fromColumns({
          columns: pointsData as PointColumns,
          start: pointStart,
          end: pointEnd,
          skeleton,
          track,
          trackingScore,
          metadata,
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
        instance = PredictedInstance._fromColumns({
          columns: predPointsData as PointColumns,
          start: pointStart,
          end: pointEnd,
          skeleton,
          track,
          score,
          trackingScore,
          metadata,
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

    // A frame that only held predictions has nothing left to keep.
    if (userInstancesOnly && instEnd > instStart && instances.length === 0)
      continue;
    frames.push(
      new LabeledFrame({
        video,
        frameIdx: frameIndex,
        instances,
        metadata: metadataRecord(frameMetadata, frameIdx),
      }),
    );
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
