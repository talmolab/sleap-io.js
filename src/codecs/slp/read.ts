import { markNanTrackingScore } from "../../model/stored-nan.js";
import {
  buildColumnCarry,
  CARRIED_TABLES,
  carriedColumn,
  isCarriable,
  isUnknownColumn,
  METADATA_TABLES,
  type TableMember,
  unreadMetadataMembers,
  unreadTableMembers,
  POSE_TABLES,
  sessionCarryOwners,
  type UnknownColumns,
} from "./carry-read.js";
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
  labelImageProblems,
  linkProblems,
  maskProblems,
  reportTableProblems,
  roiProblems,
  scoreMapProblems,
  sessionProblems,
  type TableCounts,
  TABLE_SPECS,
  tableFromColumns,
  tableRows,
  unknownTableColumns,
  unknownTableGroups,
} from "./columnar-tables.js";
import { checkSlpFormat } from "./format-check.js";
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
  openH5File,
  type OpenH5Options,
  type SlpSource,
  getH5EmscriptenModule,
} from "./h5.js";
import { readCompoundColumnsManual } from "./h5-compound.js";
import {
  attrToNumber,
  attrToString,
  datasetValueToString,
  parseMetadataJson,
  missingMetadataJsonError,
  parseJsonEntry,
  sessionsReadError,
  reconstructColumnarFrameGroups,
  sessionMetadataFromJson,
  type SessionData,
  type SessionPointMatrix,
  parseSkeletons,
  resolveCameraKey,
  normalizeCameraSize,
  reconstructInstance3D,
  resolveIdentity,
  resolveVideoFilename,
} from "./parsers.js";
import { buildSourceVideoFromDict } from "./source-video.js";
import { Labels } from "../../model/labels.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import { Instance, PredictedInstance, Track } from "../../model/instance.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video, type VideoBackendError } from "../../model/video.js";
import {
  createVideoBackend,
  UnsupportedVideoFormatError,
  isImageSource,
} from "../../video/factory.js";
import {
  resolveVideoSource,
  posixDirname,
  posixBasename,
} from "../../video/path-resolve.js";
import { getFsResolver } from "../../model/matching.js";
import { isUrl } from "../../io/remote.js";
import { CropVideoBackend } from "../../video/crop-backend.js";
import { resolveSourceFrameCount } from "./frame-count.js";
import type { CropRect } from "../../transform/points.js";
import type { Fill } from "../../transform/frame.js";
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
import { LazyDataStore, LazyFrameList } from "../../model/lazy.js";
import { buildVideoIdMap } from "../../model/video-id-map.js";
import {
  markNegativeFrames,
  negativeFrameKeys,
} from "../../model/negative-frames.js";
import {
  type ROI,
  UserROI,
  PredictedROI,
  AnnotationType,
  decodeWkb,
} from "../../model/roi.js";
import {
  type SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
} from "../../model/mask.js";
import {
  type BoundingBox,
  UserBoundingBox,
  PredictedBoundingBox,
} from "../../model/bbox.js";
import type { Centroid } from "../../model/centroid.js";
import { buildCentroidTuples } from "./centroids.js";
import { BBOX_NUMERIC_COLUMNS, buildBboxTuples } from "./bboxes.js";
import {
  type LabelImage,
  UserLabelImage,
  PredictedLabelImage,
} from "../../model/label-image.js";
import type { LabelImageObjectInfo } from "../../model/label-image.js";
import { inflate } from "pako";
import { checkPointSpans, columnLength } from "./point-spans.js";

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
     * Capture the verbatim, deep-cloned `sessions_json` dict onto each
     * `RecordingSession.rawJson` (deprecated, transitional). Default `false`:
     * the faithful typed session model is the source of truth, and skipping the
     * clone avoids doubling session memory in `Labels.copy()`. See
     * `RecordingSession.rawJson`.
     */
    rawSessions?: boolean;
    /**
     * Optional progress callback fired as loading advances through its stages.
     * `current` counts completed stages out of `total`; `message` labels the
     * stage about to run. Matches the (current, total, message?) convention used
     * elsewhere in the library (Labels.merge, RenderOptions.onProgress). The
     * stages are coarser than the streaming reader's, but the contract is the
     * same. Reporting is a pure side effect and never alters the loaded Labels.
     */
    onProgress?: (current: number, total: number, message?: string) => void;
    /**
     * When an instance's point span doesn't match its skeleton's node count,
     * the read throws {@link SlpPointSpanError} (like Python sleap-io). Set this
     * to recover files older sleap-io.js versions wrote: shifted spans are
     * rebuilt when that's provably exact (the point rows are intact: no gaps or
     * overlaps, one row per node), and an instance whose rows are provably its
     * own but sit under the wrong skeleton is loaded as stored, with a
     * `console.warn`. Anything else still throws. Default `false`. See #230.
     */
    repairPointSpans?: boolean;
    /**
     * What a later save may do with a file in SLP format 3.0. `"keep"` (the
     * default): load it editable, and a save keeps format 3.0; without the
     * option, a file holding what this version does not read (the summary's
     * `unreadTables`) throws as `"ask"` does, since a save would drop it.
     * `"view"` loads
     * it read-only: every SLP writer refuses the labels. `"edit"` loads it so
     * that a save writes the 2.x layout and drops what that layout cannot
     * store (unlabelled points become hidden points with no location; record
     * metadata and unknown columns are not written). `"ask"` throws
     * {@link SlpFormat3ChoiceError}, whose `summary` lists what an edit would
     * drop. Files before 3.0 ignore it.
     */
    format3?: Format3Option;
  },
): Promise<Labels> {
  // `total` is derived from the stage list (single source of truth) so the
  // count cannot drift from the labels. `report(i)` fires the i-th stage label.
  // A wrong option is the caller's error: refuse it before reading anything.
  checkFormat3Option(options?.format3);
  const total = EAGER_STAGES.length;
  const onProgress = options?.onProgress;
  const report = (i: number) => onProgress?.(i, total, EAGER_STAGES[i]);

  const { file, close } = await openH5File(source, options?.h5);
  // Remote auth headers to persist onto video backends (so existence probes /
  // URL-backed reopens stay authenticated). Only present when loading a remote
  // `.slp` with headers.
  const remote = {
    urlHeaders: options?.h5?.headers,
  };
  try {
    report(0); // Reading metadata
    const labelsPath =
      typeof source === "string"
        ? source
        : (options?.h5?.filenameHint ?? "slp-data.slp");
    const metadataGroup = file.get("metadata");
    // A missing `metadata` group is treated the same as a missing `json`
    // attribute: both indicate a truncated/corrupt file. Mirrors Python
    // sleap-io PR #446, where `read_metadata` catches the `KeyError` from
    // BOTH cases and maps them to the same helpful `ValueError`.
    if (!metadataGroup) {
      throw missingMetadataJsonError(labelsPath);
    }

    const metadataAttrs =
      (metadataGroup as unknown as { attrs?: Record<string, any> }).attrs ?? {};
    // Refuse formats this version can't read before touching anything else;
    // a newer layout would otherwise load with no error and no poses (#278).
    checkSlpFormat(labelsPath, metadataAttrs);
    const formatId = Number(
      metadataAttrs["format_id"]?.value ?? metadataAttrs["format_id"] ?? 1.0,
    );
    // Throws the same helpful error if the `metadata` group exists but its
    // required `json` attribute is missing/empty (truncated/corrupt file);
    // mirrors Python sleap-io PR #446.
    const metadataJson = parseMetadataJson(
      metadataAttrs["json"],
      labelsPath,
    ) as Record<string, unknown> | null;

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
      remote,
    );
    report(3); // Reading suggestions
    const suggestions = readSuggestions(file.get("suggestions_json"), videos);

    report(4); // Building labeled frames
    // Low-level Module for the fast columnar compound read (falls back to
    // `.value` when unavailable). Fetched once; null on browsers without the
    // raw surface, which is fine — normalizeStructDataset then uses `.value`.
    const emscripten = await getH5EmscriptenModule();
    const framesData = readPoseTable(file, "frames", emscripten, labelsPath);
    const instancesData = readPoseTable(
      file,
      "instances",
      emscripten,
      labelsPath,
    );
    const pointsData = readPoseTable(file, "points", emscripten, labelsPath);
    const predPointsData = readPoseTable(
      file,
      "pred_points",
      emscripten,
      labelsPath,
    );
    // Format 3.0: range checks, record metadata, and the caller's choice
    // (throws SlpFormat3ChoiceError without one) before frames are built.
    const format3 = readFormat3(file, labelsPath, formatId, videos.length, {
      framesData,
      instancesData,
      pointsData,
      predPointsData,
      choice: options?.format3,
      provenanceInMetadata: !!metadataJson && "provenance" in metadataJson,
    });
    checkPointSpans({
      framesData,
      instancesData,
      skeletons,
      videos,
      pointsRowCount: columnLength(pointsData),
      predPointsRowCount: columnLength(predPointsData),
      repair: options?.repairPointSpans ?? false,
      labelsPath,
    });

    const instanceRows = new Map<number, Instance | PredictedInstance>();
    const labeledFrames = buildLabeledFrames({
      framesData,
      instancesData,
      pointsData,
      predPointsData,
      skeletons,
      tracks,
      videos,
      formatId,
      instanceMetadata: format3?.instanceMetadata,
      frameMetadata: format3?.frameMetadata,
      instanceRows,
    });
    // The frames built from `/frames` rows, before annotation-only frames.
    const poseFrames = labeledFrames.slice();
    // Links to instances (box and centroid `instance`, identity and category
    // owners) are `/instances` rows. When the reader skipped rows (a 3.0
    // instance type other than user or predicted), index by row, with a hole
    // for each skipped one; otherwise the frames' instances in order are the
    // rows, as before.
    const instancesByRow = (): Array<Instance | PredictedInstance> =>
      hasSkippedInstanceRows(instancesData)
        ? Array.from(
            { length: (instancesData.instance_type ?? []).length },
            (_, row) => instanceRows.get(row) as Instance | PredictedInstance,
          )
        : labeledFrames.flatMap((f) => f.instances);

    // Read negative frames (video ids resolved like /frames', see helper)
    // Format 3.0 keeps the flag as a `/frames` column.
    const negativeFramesDs = file.get("negative_frames");
    if (framesData.is_negative) {
      markNegativeFrames(
        labeledFrames,
        negativeFrameKeysFromFrames(framesData),
        framesData,
        videos,
      );
    } else if (negativeFramesDs) {
      markNegativeFrames(
        labeledFrames,
        negativeFrameKeys(normalizeStructDataset(negativeFramesDs)),
        framesData,
        videos,
      );
    }

    report(5); // Reading identities
    const identities = readIdentityCatalog(file);
    report(6); // Reading sessions
    const tables = tableContext(file, labelsPath, videos, tracks, {
      framesData,
      instancesData,
    });
    const sessions = readSessions(
      file.get("sessions_json"),
      videos,
      skeletons,
      identities,
      options?.rawSessions ?? false,
      readSessionDataEager(file, labelsPath, tables.nFrames, emscripten),
    );
    report(7); // Reading annotations
    const allInstances = instancesByRow();
    const { rois: roiTuples, bboxes: bboxTuples } = readRoisAndBboxes(
      file,
      videos,
      tracks,
      tables,
      allInstances,
      format3?.bboxMetadata,
    );
    const maskTuples = readMasks(file, videos, tracks, tables);
    const centroidTuples = readCentroids(file, videos, tracks);
    const labelImageTuples = readLabelImages(
      file,
      videos,
      tracks,
      tables,
      allInstances,
    );

    // Per-detection re-ID identity (SLP 2.5) + category (SLP 2.7): attach onto each
    // modality's ordered detection list (index == owner_id). No-op on older files.
    const pdMaps = readPerDetectionMaps(file, labelsPath, emscripten);
    attachOwnerType(pdMaps, 0, allInstances, identities);
    attachOwnerType(
      pdMaps,
      2,
      centroidTuples.map((t) => t[0]),
      identities,
    );
    attachOwnerType(
      pdMaps,
      3,
      maskTuples.map((t) => t[0]),
      identities,
    );
    attachOwnerType(
      pdMaps,
      4,
      bboxTuples.map((t) => t[0]),
      identities,
    );
    attachOwnerType(
      pdMaps,
      5,
      roiTuples.map((t) => t[0]),
      identities,
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
    const allInstancesFlat = instancesByRow();
    const resolveInstanceRef = (ann: {
      _instanceIdx: number | null;
      instance: Instance | null;
    }): void => {
      if (
        ann._instanceIdx !== null &&
        ann._instanceIdx >= 0 &&
        ann._instanceIdx < allInstancesFlat.length &&
        allInstancesFlat[ann._instanceIdx]
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
            if (
              obj &&
              instIdx >= 0 &&
              instIdx < allInstancesFlat.length &&
              allInstancesFlat[instIdx]
            ) {
              obj.instance = allInstancesFlat[instIdx];
            }
          }
          li._objectInstanceIdxs = null;
        }
      }
    }

    onProgress?.(total, total, "Finalizing");
    const labels = new Labels({
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
    labels.sourceFormat = format3?.sourceFormat ?? null;
    if (format3) {
      // Unknown columns, kept to write back on a format 3.0 save.
      const nFrameRows = (framesData.frame_idx ?? []).length;
      const nInstanceRows = (instancesData.instance_type ?? []).length;
      const labelImages = labelImageTuples.map((t) => t[0]);
      labels._carriedColumns = buildColumnCarry(readUnknownColumnsH5(file), {
        frames: poseFrames.length === nFrameRows ? poseFrames : undefined,
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
        rois: roiTuples.map((t) => t[0]),
        bboxes: bboxTuples.map((t) => t[0]),
        masks: maskTuples.map((t) => t[0]),
        maskScoreMapOwners: columnH5(file, "masks/score_maps/mask_idx"),
        labelImages,
        labelImageObjects: labelImages.flatMap((li) => [
          ...li.objects.values(),
        ]),
        labelImageScoreMapOwners: columnH5(
          file,
          "label_images/score_maps/li_idx",
        ),
        identityLinks: linkKeysH5(file, "identity/links"),
        categoryLinks: linkKeysH5(file, "categories/links"),
        sessions: sessionOwnersH5(file, sessions),
      });
    }
    // Every record carries the open-time choice wherever it goes.
    for (const frame of labels.labeledFrames) {
      markFrameSource(frame, format3?.sourceFormat);
    }
    for (const roi of staticRois) markSource(roi, format3?.sourceFormat);
    markSessionSource(sessions, format3?.sourceFormat);
    // Sessions are read before the frame store exists; wire the lazy frame
    // resolver now so ref-backed grouping resolves against labels.labeledFrames.
    injectSessionFrameResolver(labels);
    return labels;
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
     * Capture the verbatim, deep-cloned `sessions_json` dict onto each
     * `RecordingSession.rawJson` (deprecated, transitional). Default `false`.
     * See `readSlp` and `RecordingSession.rawJson`.
     */
    rawSessions?: boolean;
    /**
     * Optional progress callback fired as loading advances through its stages.
     * `current` counts completed stages out of `total`; `message` labels the
     * stage about to run. Matches the (current, total, message?) convention used
     * elsewhere in the library (Labels.merge, RenderOptions.onProgress). The
     * lazy path's stages are coarser than the streaming reader's. Reporting is a
     * pure side effect and never alters the loaded Labels.
     */
    onProgress?: (current: number, total: number, message?: string) => void;
    /**
     * When an instance's point span doesn't match its skeleton's node count,
     * the read throws {@link SlpPointSpanError} (like Python sleap-io). Set this
     * to recover files older sleap-io.js versions wrote: shifted spans are
     * rebuilt when that's provably exact (the point rows are intact: no gaps or
     * overlaps, one row per node), and an instance whose rows are provably its
     * own but sit under the wrong skeleton is loaded as stored, with a
     * `console.warn`. Anything else still throws. Default `false`. See #230.
     */
    repairPointSpans?: boolean;
    /**
     * What a later save may do with a file in SLP format 3.0. `"keep"` (the
     * default): load it editable, and a save keeps format 3.0; without the
     * option, a file holding what this version does not read (the summary's
     * `unreadTables`) throws as `"ask"` does, since a save would drop it.
     * `"view"` loads
     * it read-only: every SLP writer refuses the labels. `"edit"` loads it so
     * that a save writes the 2.x layout and drops what that layout cannot
     * store (unlabelled points become hidden points with no location; record
     * metadata and unknown columns are not written). `"ask"` throws
     * {@link SlpFormat3ChoiceError}, whose `summary` lists what an edit would
     * drop. Files before 3.0 ignore it.
     */
    format3?: Format3Option;
  },
): Promise<Labels> {
  // `total` is derived from the stage list (single source of truth) so the
  // count cannot drift from the labels. `report(i)` fires the i-th stage label.
  // A wrong option is the caller's error: refuse it before reading anything.
  checkFormat3Option(options?.format3);
  const total = LAZY_STAGES.length;
  const onProgress = options?.onProgress;
  const report = (i: number) => onProgress?.(i, total, LAZY_STAGES[i]);

  const { file, close } = await openH5File(source, options?.h5);
  const remote = {
    urlHeaders: options?.h5?.headers,
  };
  try {
    report(0); // Reading metadata
    const labelsPath =
      typeof source === "string"
        ? source
        : (options?.h5?.filenameHint ?? "slp-data.slp");
    const metadataGroup = file.get("metadata");
    // A missing `metadata` group is treated the same as a missing `json`
    // attribute: both indicate a truncated/corrupt file. Mirrors Python
    // sleap-io PR #446 (and the eager/streaming readers).
    if (!metadataGroup) {
      throw missingMetadataJsonError(labelsPath);
    }

    const metadataAttrs =
      (metadataGroup as unknown as { attrs?: Record<string, any> }).attrs ?? {};
    // Refuse formats this version can't read before touching anything else;
    // a newer layout would otherwise load with no error and no poses (#278).
    checkSlpFormat(labelsPath, metadataAttrs);
    const formatId = Number(
      metadataAttrs["format_id"]?.value ?? metadataAttrs["format_id"] ?? 1.0,
    );
    // Throws the same helpful error if the `metadata` group exists but its
    // required `json` attribute is missing/empty (truncated/corrupt file);
    // mirrors Python sleap-io PR #446.
    const metadataJson = parseMetadataJson(
      metadataAttrs["json"],
      labelsPath,
    ) as Record<string, unknown> | null;

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
      remote,
    );
    report(3); // Reading suggestions
    const suggestions = readSuggestions(file.get("suggestions_json"), videos);

    report(4); // Reading frame data
    // Read raw data but don't build frames yet. Use the fast columnar compound
    // read (falls back to `.value`); see normalizeStructDataset / h5-compound.ts.
    const emscripten = await getH5EmscriptenModule();
    const framesData = readPoseTable(file, "frames", emscripten, labelsPath);
    const instancesData = readPoseTable(
      file,
      "instances",
      emscripten,
      labelsPath,
    );
    const pointsData = readPoseTable(file, "points", emscripten, labelsPath);
    const predPointsData = readPoseTable(
      file,
      "pred_points",
      emscripten,
      labelsPath,
    );
    // Format 3.0: range checks, record metadata, and the caller's choice
    // (throws SlpFormat3ChoiceError without one) before the store is built.
    const format3 = readFormat3(file, labelsPath, formatId, videos.length, {
      framesData,
      instancesData,
      pointsData,
      predPointsData,
      choice: options?.format3,
      provenanceInMetadata: !!metadataJson && "provenance" in metadataJson,
    });
    checkPointSpans({
      framesData,
      instancesData,
      skeletons,
      videos,
      pointsRowCount: columnLength(pointsData),
      predPointsRowCount: columnLength(predPointsData),
      repair: options?.repairPointSpans ?? false,
      labelsPath,
    });

    // Read negative frames (raw video ids; the store resolves them per frame)
    // Format 3.0 keeps the flag as a `/frames` column.
    const negativeFramesDs = file.get("negative_frames");
    const negativeFrames = framesData.is_negative
      ? negativeFrameKeysFromFrames(framesData)
      : negativeFramesDs
        ? negativeFrameKeys(normalizeStructDataset(negativeFramesDs))
        : new Set<string>();

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
      instanceMetadata: format3?.instanceMetadata,
      frameMetadata: format3?.frameMetadata,
      sourceFormat: format3?.sourceFormat,
    });

    const lazyFrames = new LazyFrameList(store);

    // Read sessions — grouping is captured as index refs only (no frame
    // materialization); refs resolve lazily via the injected frame resolver.
    report(5); // Reading identities
    const identities = readIdentityCatalog(file);
    report(6); // Reading sessions
    const tables = tableContext(file, labelsPath, videos, tracks, {
      framesData,
      instancesData,
    });
    const sessions = readSessions(
      file.get("sessions_json"),
      videos,
      skeletons,
      identities,
      options?.rawSessions ?? false,
      readSessionDataEager(file, labelsPath, tables.nFrames, emscripten),
    );
    report(7); // Reading annotations
    const { rois: roiTuples, bboxes: bboxTuples } = readRoisAndBboxes(
      file,
      videos,
      tracks,
      tables,
      undefined,
      format3?.bboxMetadata,
    );
    const maskTuples = readMasks(file, videos, tracks, tables);
    const centroidTuples = readCentroids(file, videos, tracks);
    const labelImageTuples = readLabelImages(file, videos, tracks, tables);

    // Per-detection identity (SLP 2.5) + category (SLP 2.7). Instances materialize
    // lazily, so the OWNER_INSTANCE maps + catalogs are handed to the store and
    // attached in materializeFrame; the other modalities are concrete and attached
    // now.
    const pdMaps = readPerDetectionMaps(file, labelsPath, emscripten);
    store.identities = identities;
    store._instanceIdentityLinks = pdMaps.idLinks.get(0);
    store._instanceEmbeddings = pdMaps.idEmbs.get(0);
    store.categoryCatalog = pdMaps.categoryCatalog;
    store._instanceCategoryLinks = pdMaps.catLinks.get(0);
    store._instanceCategoryEmbeddings = pdMaps.catEmbs.get(0);
    attachOwnerType(
      pdMaps,
      2,
      centroidTuples.map((t) => t[0]),
      identities,
    );
    attachOwnerType(
      pdMaps,
      3,
      maskTuples.map((t) => t[0]),
      identities,
    );
    attachOwnerType(
      pdMaps,
      4,
      bboxTuples.map((t) => t[0]),
      identities,
    );
    attachOwnerType(
      pdMaps,
      5,
      roiTuples.map((t) => t[0]),
      identities,
    );

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

    // Every record carries the open-time choice wherever it goes; the store
    // marks frames and instances as they materialize.
    for (const tuples of [
      centroidTuples,
      bboxTuples,
      maskTuples,
      roiTuples,
      labelImageTuples,
    ] as Array<Array<[object, number, number]>>) {
      for (const [ann] of tuples) markSource(ann, format3?.sourceFormat);
    }
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

    if (format3) {
      // Unknown columns: the pose tables' are written back with the raw rows;
      // the others' while the annotations are the ones loaded.
      const unknown = readUnknownColumnsH5(file);
      const pose: NonNullable<LazyDataStore["unknownColumns"]> = {};
      for (const table of POSE_TABLES) {
        if (unknown[table]) pose[table] = unknown[table];
      }
      store.unknownColumns = Object.keys(pose).length > 0 ? pose : null;
      const labelImages = labelImageTuples.map((t) => t[0]);
      store.annotationCarry = buildColumnCarry(
        unknown,
        {
          rois: roiTuples.map((t) => t[0]),
          bboxes: bboxTuples.map((t) => t[0]),
          masks: maskTuples.map((t) => t[0]),
          maskScoreMapOwners: columnH5(file, "masks/score_maps/mask_idx"),
          labelImages,
          labelImageObjects: labelImages.flatMap((li) => [
            ...li.objects.values(),
          ]),
          labelImageScoreMapOwners: columnH5(
            file,
            "label_images/score_maps/li_idx",
          ),
          identityLinks: linkKeysH5(file, "identity/links"),
          categoryLinks: linkKeysH5(file, "categories/links"),
          sessions: sessionOwnersH5(file, sessions),
        },
        ["bboxes", ...FORMAT3_TABLES],
      );
    }

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
        const frame = new LabeledFrame({
          video: videos[vidIdx],
          frameIdx: fidx,
          centroids: store._centroidByFrame.get(key) ?? [],
          bboxes: store._bboxByFrame.get(key) ?? [],
          masks: store._maskByFrame.get(key) ?? [],
          labelImages: store._labelImageByFrame.get(key) ?? [],
          rois: store._roiByFrame.get(key) ?? [],
        });
        markFrameSource(frame, format3?.sourceFormat);
        lazyFrames._supplementary.push(frame);
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

    markSessionSource(sessions, format3?.sourceFormat);
    store.sourceSessionCount = sessions.length;
    // Replace the eager labeledFrames with lazy proxy
    labels._lazyFrameList = lazyFrames;
    labels._lazyDataStore = store;
    labels.sourceFormat = format3?.sourceFormat ?? null;

    // Wire the lazy frame resolver AFTER _lazyFrameList is attached so ref-backed
    // grouping resolves a single frame on demand (never the full table).
    injectSessionFrameResolver(labels);

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
export function readVideoCrops(file: any): Map<number, VideoCropEntry> {
  const out = new Map<number, VideoCropEntry>();
  const keys = file.keys?.() ?? [];
  if (!keys.includes("video_crops")) return out;
  const ds = file.get("video_crops");
  if (!ds) return out;

  // Python writes /video_crops as a scalar `|S<n>` (np.bytes_) JSON dataset;
  // decode every backend's representation through the shared, throw-safe helper.
  let json: string | undefined;
  try {
    json = datasetValueToString((ds as { value?: unknown }).value);
  } catch {
    json = undefined;
  }
  if (json === undefined) return out;

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

/**
 * Read a video's `source_video` metadata JSON from its `{group}/source_video`
 * HDF5 group, or `null` when the group is absent. Checks a `json` *dataset*
 * first (where oversized metadata is stored) then the `json` *attribute* (the
 * normal case), mirroring Python `_read_source_video_json`. h5wasm sync path.
 */
export function readSourceVideoGroupJson(
  file: any,
  groupPath: string,
): Record<string, unknown> | null {
  const grp = file.get(`${groupPath}/source_video`);
  if (!grp) return null;
  let raw: string | undefined;
  // Prefer the spilled `json` DATASET (oversized metadata, e.g. an ImageVideo
  // source with thousands of filenames — Python writes it as a scalar `|S<n>`
  // via np.bytes_). The read is guarded: h5wasm `.value` can throw on unusual
  // scalar/large datasets, and a throw here would otherwise abort the whole
  // file open (this runs inside readVideos with no surrounding try/catch), so
  // fall back to the `json` attribute rather than failing the load.
  try {
    const ds = file.get(`${groupPath}/source_video/json`);
    if (ds) raw = datasetValueToString((ds as { value?: unknown }).value);
  } catch {
    raw = undefined;
  }
  if (raw === undefined) {
    raw = attrToString((grp.attrs ?? {}).json);
  }
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readVideos(
  dataset: any,
  labelsPath: string,
  openVideos: boolean,
  file: any,
  formatId: number,
  videoCrops?: Map<number, VideoCropEntry>,
  onVideoProgress?: (current: number, total: number) => void,
  remote?: {
    urlHeaders?: Record<string, string>;
  },
): Promise<Video[]> {
  if (!dataset) return [];
  const urlHeaders = remote?.urlHeaders;
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

    // Resolve external (non-embedded) source paths against the labels-file
    // directory so a project moved between machines — or whose media now lives
    // in a subfolder next to the `.slp` — still opens. Uses the injected
    // FsResolver for existence checks (Node, Tauri, and browser-injected all
    // share one policy); with no resolver, or for URLs / embedded videos, the
    // stored source is used verbatim. See issue #213 and video/path-resolve.ts.
    let openFilename: string | string[] = filename;
    let sourceMissing = false;
    if (openVideos && !embedded) {
      const fsResolver = getFsResolver();
      const sourceIsUrl = typeof filename === "string" && isUrl(filename);
      if (fsResolver && !sourceIsUrl && !isUrl(labelsPath)) {
        const resolved = await resolveVideoSource(
          filename,
          posixDirname(labelsPath),
          fsResolver,
        );
        openFilename = resolved.filename;
        sourceMissing = resolved.firstMissing;
      }
    }

    let backend = null;
    let backendError: VideoBackendError | null = null;
    if (openVideos) {
      if (sourceMissing && isImageSource(filename)) {
        // The resolver confirms the first image is unreachable. Do NOT hand back
        // a backend that looks healthy: an ImageVideo given a stored `shape`
        // skips the up-front frame-0 decode, so it would open "successfully"
        // while unable to read a single frame (issue #213). Record the reason so
        // consumers can surface a locate/repair affordance instead of silently
        // rendering blank frames.
        const firstStored = Array.isArray(filename)
          ? (filename[0] ?? "")
          : filename;
        backendError = {
          kind: "image-sequence",
          message:
            `Image sequence not found: could not locate ` +
            `"${posixBasename(firstStored)}" relative to the labels directory ` +
            `"${posixDirname(labelsPath)}". The stored path "${firstStored}" ` +
            `was likely saved on another machine; move or locate the image folder.`,
        };
      } else {
        try {
          backend = await createVideoBackend(openFilename, {
            dataset: datasetPath ?? undefined,
            embedded,
            frameNumbers,
            frameSizes: readFrameSizes(file, datasetPath),
            format,
            channelOrder,
            shape,
            fps: backendMeta.fps,
            // Persist the remote `.slp` auth headers onto remote/embedded video
            // backends so reopens / existence probes stay authenticated. The
            // factory only uses them for URL-backed backends; embedded/local
            // backends ignore them.
            headers: urlHeaders,
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
    }

    // Reconstruct the source_video lineage WITH its recorded shape (and any
    // deeper chain) so a reloaded embedded subset can resolve its source's full
    // frame extent via _getEffectiveShape — the prerequisite for the
    // embedded-subset -> restore-original matching workflow (#160). Embedded
    // videos store their source in the authoritative `{group}/source_video`
    // HDF5 group (older `.pkg.slp` omit it from videos_json entirely); prefer it
    // and fall back to a nested videos_json `source_video` (non-embedded videos,
    // and newer files that carry both).
    let sourceVideo: Video | null = null;
    if (embedded && datasetPath) {
      const groupPath = datasetPath.endsWith("/video")
        ? datasetPath.slice(0, -6)
        : datasetPath;
      const svDict = readSourceVideoGroupJson(file, groupPath);
      if (svDict) sourceVideo = buildSourceVideoFromDict(svDict, labelsPath);
    }
    if (!sourceVideo && parsed.source_video) {
      sourceVideo = buildSourceVideoFromDict(
        parsed.source_video as Record<string, unknown>,
        labelsPath,
      );
    }

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
        // Each reloaded tile owns its freshly-reconstructed inner (ownsInner
        // defaults to true). We do NOT share one inner across sibling mosaic
        // tiles here: on read each video entry rebuilds a private inner, so
        // sharing would leave the inner unowned (leaked — never closed) for no
        // decode savings. The Hdf5VideoBackend is a thin per-frame slicer over
        // the already-shared open h5 `file`, so duplicating it per tile is
        // cheap. Live mosaic decode-sharing is opt-in and in-memory only, via
        // Video.crop({ shareDecode: true }). Mirrors Python slp.py make_video
        // (slp.py:393-401).
        backend = CropVideoBackend.wrap({
          inner: backend,
          crop: cropEntry.crop,
          fill: cropEntry.fill,
          // ownsInner: true (default) — see comment above.
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

    const video = new Video({
      filename,
      backend,
      backendError,
      backendMetadata,
      sourceVideo,
      openBackend: openVideos,
      embedded,
    });
    // Persist remote auth headers so a later Video.exists() probe (or a
    // URL-backed backend reopen) stays authenticated. Mirrors Python
    // HDF5Video._url_headers. Only meaningful for videos backed by a remote
    // `.slp` (urlHeaders is undefined for local loads).
    if (urlHeaders) {
      video._setUrlPersistence({ headers: urlHeaders });
    }
    videos.push(video);
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

/** Decode a vlen-string dataset element (string / bytes) to a plain string. */
function decodeStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return textDecoder.decode(v);
  return String(v ?? "");
}

/**
 * Read the Python-compatible `/identity` group (SLP 2.5): a native vlen `name`
 * catalog + optional EAV metadata (`meta_owner`/`meta_key`/`meta_val`). Color is
 * recovered from `metadata["color"]` back onto `Identity.color`. Returns `[]` when
 * the group is absent. Used as the fallback when a file has no legacy
 * `identities_json` (i.e. a Python-written file); JS-written files carry both and
 * prefer the typed `identities_json`.
 */
function readIdentityGroup(file: any): Identity[] {
  if (!file.get("identity") || !file.get("identity/name")) return [];
  const names = (file.get("identity/name").value ?? []).map(decodeStr);
  const metadata: Record<string, unknown>[] = names.map(() => ({}));
  const ownerDs = file.get("identity/meta_owner");
  if (ownerDs) {
    const owners = Array.from(ownerDs.value ?? []).map(Number);
    const keys = (file.get("identity/meta_key")?.value ?? []).map(decodeStr);
    const vals = (file.get("identity/meta_val")?.value ?? []).map(decodeStr);
    owners.forEach((o: number, i: number) => {
      if (metadata[o]) metadata[o][keys[i]] = vals[i];
    });
  }
  return names.map((name: string, i: number) => {
    const meta = metadata[i];
    const color = typeof meta.color === "string" ? meta.color : undefined;
    const { color: _color, ...rest } = meta;
    return new Identity({ name, color, metadata: rest });
  });
}

/**
 * Read the identity catalog, preferring the legacy typed `identities_json` (JS-native,
 * present on JS-written files) and falling back to the Python `/identity` group (on
 * Python-written files). Both are written by the JS writer (dual-write).
 */
function readIdentityCatalog(file: any): Identity[] {
  const json = file.get("identities_json");
  if (json) return readIdentities(json);
  return readIdentityGroup(file);
}

/** A detection that can carry a per-detection identity/embedding (SLP 2.5). */
interface IdentityBearingRead {
  identity?: Identity | null;
  identityScore?: number | null;
  identityEmbedding?: Embedding | null;
  category?: string | null;
  categoryScore?: number | null;
  categoryEmbedding?: Embedding | null;
}

/**
 * Read a per-detection links table — `/identity/links` (SLP 2.5) or
 * `/categories/links` (SLP 2.7) — a genuine compound (Python) or a
 * flat-2-D+`field_names` (JS) `(owner_type, owner_id, <idxField>, <scoreField>)`
 * table via `normalizeStructDataset` (handles both). Returns
 * `owner_type → owner_id → [idx, score|null]` (NaN score → null); empty when the
 * dataset is absent. `i8`/`u8` columns are `Number()`-coerced.
 */
function readLinksTable(
  file: any,
  path: "identity/links" | "categories/links",
  idxField: string,
  scoreField: string,
  labelsPath: string,
  emscripten?: unknown,
): Map<number, Map<number, [number, number | null]>> {
  const result = new Map<number, Map<number, [number, number | null]>>();
  // Format 3.0: a group of columns, whose catalog indices must name an entry
  // of the catalog beside it.
  let cols: Record<string, any> | null = readColumnTable(
    file,
    path,
    labelsPath,
  );
  if (cols) {
    const catalog = path.split("/")[0];
    const names = h5Members(file, catalog, "Dataset").includes("name")
      ? (file.get(`${catalog}/name`).shape?.[0] ?? 0)
      : null;
    reportTableProblems(labelsPath, linkProblems(path, cols, names));
  } else {
    const ds = file.get(path);
    if (!ds) return result;
    cols = normalizeStructDataset(ds, emscripten);
  }
  const ot = cols.owner_type ?? [];
  const oid = cols.owner_id ?? [];
  const idx = cols[idxField] ?? [];
  const sc = cols[scoreField] ?? [];
  for (let i = 0; i < ot.length; i += 1) {
    const ownerType = Number(ot[i]);
    const ownerId = Number(oid[i]);
    const score = Number(sc[i]);
    let sub = result.get(ownerType);
    if (!sub) {
      sub = new Map();
      result.set(ownerType, sub);
    }
    sub.set(ownerId, [Number(idx[i]), Number.isNaN(score) ? null : score]);
  }
  return result;
}

const readIdentityLinks = (
  file: any,
  labelsPath: string,
  emscripten?: unknown,
) =>
  readLinksTable(
    file,
    "identity/links",
    "identity_idx",
    "identity_score",
    labelsPath,
    emscripten,
  );

const readCategoryLinks = (
  file: any,
  labelsPath: string,
  emscripten?: unknown,
) =>
  readLinksTable(
    file,
    "categories/links",
    "category_idx",
    "category_score",
    labelsPath,
    emscripten,
  );

/** Read the `/categories/name` catalog (SLP 2.7) as plain strings. */
function readCategoryCatalog(file: any): string[] {
  const ds = file.get("categories/name");
  if (!ds) return [];
  return (ds.value ?? []).map(decodeStr);
}

/**
 * Read one `/embeddings` triple — `(vectors, owner_type, owner_id)` (identity, SLP
 * 2.5) or `(category_vectors, category_owner_type, category_owner_id)` (category,
 * SLP 2.7) — a plain `(N, D)` float matrix + parallel join columns. Returns
 * `owner_type → owner_id → Embedding`; empty when absent. `i8` columns are
 * `Number()`-coerced.
 */
function readEmbeddingTriple(
  file: any,
  vecName: string,
  otName: string,
  oidName: string,
): Map<number, Map<number, Embedding>> {
  const result = new Map<number, Map<number, Embedding>>();
  const vecDs = file.get(`embeddings/${vecName}`);
  if (!vecDs) return result;
  const flat = vecDs.value as ArrayLike<number>;
  const shape = vecDs.shape as number[] | undefined;
  const rows = shape?.[0] ?? 0;
  const dim = shape && shape.length >= 2 ? shape[1] : 0;
  if (!rows || !dim) return result;
  const ot = file.get(`embeddings/${otName}`)?.value ?? [];
  const oid = file.get(`embeddings/${oidName}`)?.value ?? [];
  for (let i = 0; i < rows; i += 1) {
    const ownerType = Number(ot[i]);
    const ownerId = Number(oid[i]);
    const vec = new Array<number>(dim);
    for (let j = 0; j < dim; j += 1) vec[j] = Number(flat[i * dim + j]);
    let sub = result.get(ownerType);
    if (!sub) {
      sub = new Map();
      result.set(ownerType, sub);
    }
    sub.set(ownerId, new Embedding(vec));
  }
  return result;
}

const readEmbeddings = (file: any) =>
  readEmbeddingTriple(file, "vectors", "owner_type", "owner_id");

const readCategoryEmbeddings = (file: any) =>
  readEmbeddingTriple(
    file,
    "category_vectors",
    "category_owner_type",
    "category_owner_id",
  );

/**
 * Attach per-detection identity + score + embedding onto a modality's ordered
 * detection list (index == `owner_id`), from the `/identity/links` + `/embeddings`
 * maps for one owner type. Mutates the detection objects in place.
 */
function attachIdentityToOwners(
  owners: IdentityBearingRead[],
  identities: Identity[],
  links: Map<number, [number, number | null]> | undefined,
  embs: Map<number, Embedding> | undefined,
): void {
  if (links) {
    for (const [ownerId, [idx, score]] of links) {
      const det = owners[ownerId];
      if (det && idx >= 0 && idx < identities.length) {
        det.identity = identities[idx];
        det.identityScore = score;
      }
    }
  }
  if (embs) {
    for (const [ownerId, emb] of embs) {
      const det = owners[ownerId];
      if (det) det.identityEmbedding = emb;
    }
  }
}

/**
 * Attach per-detection category (string) + score + embedding onto a modality's
 * ordered detection list (index == `owner_id`), from the `/categories` catalog +
 * `/categories/links` + category embeddings for one owner type.
 */
function attachCategoryToOwners(
  owners: IdentityBearingRead[],
  catalog: string[],
  links: Map<number, [number, number | null]> | undefined,
  embs: Map<number, Embedding> | undefined,
): void {
  if (links) {
    for (const [ownerId, [idx, score]] of links) {
      const det = owners[ownerId];
      if (det && idx >= 0 && idx < catalog.length) {
        det.category = catalog[idx];
        det.categoryScore = score;
      }
    }
  }
  if (embs) {
    for (const [ownerId, emb] of embs) {
      const det = owners[ownerId];
      if (det) det.categoryEmbedding = emb;
    }
  }
}

/** All per-detection identity (SLP 2.5) + category (SLP 2.7) join maps + the
 * category catalog, read once. Empty maps on pre-2.5/2.7 files. */
interface PerDetectionMaps {
  idLinks: Map<number, Map<number, [number, number | null]>>;
  idEmbs: Map<number, Map<number, Embedding>>;
  catLinks: Map<number, Map<number, [number, number | null]>>;
  catEmbs: Map<number, Map<number, Embedding>>;
  categoryCatalog: string[];
}

function readPerDetectionMaps(
  file: any,
  labelsPath: string,
  emscripten?: unknown,
): PerDetectionMaps {
  return {
    idLinks: readIdentityLinks(file, labelsPath, emscripten),
    idEmbs: readEmbeddings(file),
    catLinks: readCategoryLinks(file, labelsPath, emscripten),
    catEmbs: readCategoryEmbeddings(file),
    categoryCatalog: readCategoryCatalog(file),
  };
}

/** Attach identity + category for one owner type onto its ordered detection list. */
function attachOwnerType(
  maps: PerDetectionMaps,
  ownerType: number,
  owners: IdentityBearingRead[],
  identities: Identity[],
): void {
  attachIdentityToOwners(
    owners,
    identities,
    maps.idLinks.get(ownerType),
    maps.idEmbs.get(ownerType),
  );
  attachCategoryToOwners(
    owners,
    maps.categoryCatalog,
    maps.catLinks.get(ownerType),
    maps.catEmbs.get(ownerType),
  );
}

/**
 * Read the columnar `/session_data` group (SLP 2.8) into an in-memory
 * {@link SessionData} for the eager (h5wasm) reader, or `null` when the group is
 * absent (legacy ≤2.7 files) or missing a required struct table. Struct tables go
 * through `normalizeStructDataset` (so both a JS-written flat-2D+`field_names` matrix
 * and a Python-written compound resolve to column records); the `points_3d` /
 * `pred_points_3d` float matrices are read raw (flat buffer + column count).
 */
function readSessionDataEager(
  file: any,
  labelsPath: string,
  nFrames: number | null,
  emscripten?: unknown,
): SessionData | null {
  if (!file.get("session_data")) return null;
  // Format 3.0 stores the three tables as groups of columns (a missing one is
  // empty, as in Python sleap-io); before, as compound datasets.
  const names = [
    "frame_groups",
    "instance_groups",
    "instance_group_members",
  ] as const;
  const columnar = names.some((name) =>
    isH5Group(file, `session_data/${name}`),
  );
  const struct = (name: (typeof names)[number]): Record<string, any> | null => {
    const table = `session_data/${name}` as const;
    if (columnar) {
      return (
        readColumnTable(file, table, labelsPath) ?? emptyColumnTable(table)
      );
    }
    const ds = file.get(table);
    return ds ? normalizeStructDataset(ds, emscripten) : null;
  };
  const frameGroups = struct("frame_groups");
  const instanceGroups = struct("instance_groups");
  const members = struct("instance_group_members");
  if (!frameGroups || !instanceGroups || !members) return null;

  const matrix = (
    name: string,
    ncolsDefault: number,
  ): SessionPointMatrix | null => {
    const ds = file.get(`session_data/${name}`);
    if (!ds) return null;
    const shape = ds.shape as number[] | undefined;
    return {
      flat: ds.value as ArrayLike<number>,
      ncols: shape && shape.length >= 2 ? shape[1] : ncolsDefault,
    };
  };
  const meta = (name: string): unknown[] | null => {
    const ds = file.get(`session_data/${name}`);
    if (!ds) return null;
    const v = ds.value;
    if (Array.isArray(v)) return v;
    return v != null ? Array.from(v as ArrayLike<unknown>) : null;
  };

  const points3d = matrix("points_3d", 3);
  const predPoints3d = matrix("pred_points_3d", 4);
  if (columnar) {
    const identityNames = h5Members(file, "identity", "Dataset").includes(
      "name",
    )
      ? (file.get("identity/name").shape?.[0] ?? 0)
      : 0;
    reportTableProblems(
      labelsPath,
      sessionProblems({
        frameGroups,
        instanceGroups,
        members,
        nPoints3d: matrixRows(points3d),
        nPredPoints3d: matrixRows(predPoints3d),
        nIdentities: identityNames,
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
    frameGroupMeta: meta("frame_group_meta"),
    instanceGroupMeta: meta("instance_group_meta"),
  };
}

/** Rows of a `points_3d` / `pred_points_3d` matrix (0 when absent). */
function matrixRows(matrix: SessionPointMatrix | null): number {
  if (!matrix || matrix.ncols <= 0) return 0;
  return Math.floor(matrix.flat.length / matrix.ncols);
}

/** An empty table of one of the format 3.0 tables. */
function emptyColumnTable(table: Format3TableName): ColumnTable {
  return tableFromColumns(
    table,
    Object.fromEntries(TABLE_SPECS[table].numbers.map((c) => [c, []])),
    "",
  );
}

function readSessions(
  dataset: any,
  videos: Video[],
  skeletons: Skeleton[],
  identities?: Identity[],
  captureRaw: boolean = false,
  sessionData?: SessionData | null,
): RecordingSession[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  // Present-but-empty is a legitimate "no sessions" state; a present dataset whose
  // entries read back blank/unparseable is the h5wasm vlen ceiling (sleap-io.js#220)
  // and must fail loud rather than silently drop calibration + grouping + 3D.
  if (values.length === 0) return [];
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
    // opt-in via `rawSessions`). Deep-cloned so it is an INDEPENDENT snapshot:
    // the object model reuses `parsed`'s nested metadata/calibration objects by
    // reference, so without the clone a consumer mutating `rawJson` would
    // silently alter what `serializeSession` writes to disk (and vice versa).
    // Never re-written to disk; see RecordingSession.rawJson.
    if (captureRaw) session.rawJson = structuredClone(parsed);
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

    // SLP 2.8 columnar path: reconstruct frame groups from the /session_data tables
    // via the session's fg_start/fg_end range. Dispatched on the presence of both
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

    // Legacy (≤2.7) inline path: frame groups nested in the sessions_json blob.
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
        // Concrete instances are built ONLY for the JS-inline format (camera key
        // -> point dict). The Python/camcorder format is stored as index refs and
        // resolved lazily via the injected frame resolver — no frame
        // materialization at read time.
        let instanceByCamera: Map<Camera, Instance> | undefined;
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
          if (!instanceByCamera) instanceByCamera = new Map<Camera, Instance>();
          instanceByCamera.set(
            camera,
            new Instance({
              points: points as Record<string, number[]>,
              skeleton,
            }),
          );
        }

        // Capture verbatim index refs (camera -> [lfIdx, instIdx]) from the
        // Python-canonical camcorder map, as NUMBERS (the fixture stores them as
        // strings). Kept even when concrete instances exist so an untouched
        // round-trip re-derives / falls back to them losslessly on write.
        let instanceRefsByCamera: Map<Camera, [number, number]> | undefined;
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
          const pair = value as unknown as [unknown, unknown];
          if (!instanceRefsByCamera)
            instanceRefsByCamera = new Map<Camera, [number, number]>();
          instanceRefsByCamera.set(camera, [Number(pair[0]), Number(pair[1])]);
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

      // Capture labeled-frame index refs (camera -> lfIdx) verbatim; resolved
      // lazily on access. No frame materialization at read time.
      let labeledFrameRefsByCamera: Map<Camera, number> | undefined;
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
        if (!labeledFrameRefsByCamera)
          labeledFrameRefsByCamera = new Map<Camera, number>();
        labeledFrameRefsByCamera.set(camera, Number(labeledFrameIdx));
      }

      // If no labeled_frame_by_camera, reconstruct refs from
      // camcorder_to_lf_and_inst_idx_map.
      if (!labeledFrameRefsByCamera) {
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
  ctx: TableContext,
  instances?: Array<Instance | PredictedInstance>,
  bboxMetadata?: MetadataColumns | null,
): { rois: [ROI, number, number][]; bboxes: [BoundingBox, number, number][] } {
  const { rois, migratedBboxes } = readRoisWithMigration(
    file,
    videos,
    tracks,
    ctx,
    instances,
  );
  let bboxes = readBboxes(file, videos, tracks, bboxMetadata);
  if (bboxes.length === 0 && migratedBboxes.length > 0) {
    bboxes = migratedBboxes;
  }
  return { rois, bboxes };
}

function readRoisWithMigration(
  file: any,
  videos: Video[],
  tracks: Track[],
  ctx: TableContext,
  instances?: Array<Instance | PredictedInstance>,
): {
  rois: [ROI, number, number][];
  migratedBboxes: [BoundingBox, number, number][];
} {
  const none = { rois: [], migratedBboxes: [] };
  let roisData: Record<string, any>;
  let wkbFlat: Uint8Array;
  let categories: string[];
  let names: string[];
  let sources: string[];
  // Format 3.0: a group of columns holding its strings and `wkb` buffer.
  const columnar = readColumnTable(file, "rois", ctx.labelsPath);
  if (columnar) {
    if (tableRows(columnar) === 0) return none;
    roisData = columnar;
    wkbFlat = bufferBytes(tableBuffer(file, "rois"));
    reportTableProblems(
      ctx.labelsPath,
      roiProblems(columnar, wkbFlat.length, ctx.counts),
    );
    categories = columnar.category;
    names = columnar.name;
    sources = columnar.source;
  } else {
    const roisDs = file.get("rois");
    if (!roisDs) return none;
    roisData = normalizeStructDataset(roisDs);
    if (!(roisData.annotation_type ?? []).length) return none;

    const wkbDs = file.get("roi_wkb");
    if (!wkbDs) return none;
    wkbFlat = bufferBytes(wkbDs);

    // v1.9+: string datasets; fallback to JSON attrs
    categories = readStringMetadata(
      file,
      "roi_categories",
      roisDs,
      "categories",
    );
    names = readStringMetadata(file, "roi_names", roisDs, "names");
    sources = readStringMetadata(file, "roi_sources", roisDs, "sources");
  }
  const annotationTypes = roisData.annotation_type ?? [];

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
      isPredictedCol.length > i ? Number(isPredictedCol[i]) !== 0 : false;

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
  metadata?: MetadataColumns | null,
): [BoundingBox, number, number][] {
  // Layouts (see bboxes.ts): Python / current JS write a `/bboxes` GROUP with one
  // child dataset per field; older JS wrote a flat matrix + `field_names` attr
  // with root `bbox_*` JSON string datasets; pre-2.0 Python wrote a center-based
  // compound dataset with JSON string attrs.
  let data: Record<string, ArrayLike<number>>;
  let categories: string[];
  let names: string[];
  let sources: string[];

  const bboxesNode = file.get("bboxes");
  if (!bboxesNode) return [];
  // Check the node type before touching children: h5wasm's `get("bboxes/x1")`
  // on a legacy *dataset* returns a bogus truthy Group rather than null.
  if (bboxesNode.type === "Group") {
    // Group layout (matches Python sleap-io, SLP 2.0+).
    data = {};
    for (const name of BBOX_NUMERIC_COLUMNS) {
      data[name] =
        (file.get(`bboxes/${name}`)?.value as ArrayLike<number>) ?? [];
    }
    const strCol = (name: string): string[] => {
      const ds = file.get(`bboxes/${name}`);
      if (!ds) return [];
      try {
        return ((ds.value as ArrayLike<unknown>) ?? []).length
          ? Array.from(ds.value as ArrayLike<unknown>, decodeStr)
          : [];
      } catch {
        // Python stores these as vlen-str, which h5wasm can't always read; the
        // box geometry/type/links still round-trip without them.
        return [];
      }
    };
    categories = strCol("category");
    names = strCol("name");
    sources = strCol("source");
  } else {
    const bboxesDs = bboxesNode;
    data = normalizeStructDataset(bboxesDs);
    // v1.9+ JS: string datasets at root level; fallback to JSON attrs on dataset
    categories = readStringMetadata(
      file,
      "bbox_categories",
      bboxesDs,
      "categories",
    );
    names = readStringMetadata(file, "bbox_names", bboxesDs, "names");
    sources = readStringMetadata(file, "bbox_sources", bboxesDs, "sources");
  }

  const tuples = buildBboxTuples(data, categories, names, sources, tracks);
  // Format 3.0 record metadata, by `/bboxes` row (one tuple per row).
  if (metadata) {
    tuples.forEach(([bbox], row) => {
      bbox.metadata = metadataRecord(metadata, row);
    });
  }
  return tuples;
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

/** A score map read from a score map index and its buffer. */
interface ScoreMapEntry {
  scoreMap: Float32Array;
  height: number;
  width: number;
  scale: [number, number];
  offset: [number, number];
}

/**
 * Read score maps from index + data datasets.
 * Returns a Map from annotation index to its score map, size, and the score
 * map's scale and offset (format 2.1+; 1 and 0 when not stored).
 */
function readScoreMaps(
  file: any,
  table: "masks/score_maps" | "label_images/score_maps",
  nOwners: number,
  labelsPath: string,
): Map<number, ScoreMapEntry> {
  const result = new Map<number, ScoreMapEntry>();
  let indexData: Record<string, any>;
  let dataFlat: Uint8Array;
  // Format 3.0: a group of columns inside the owning table, with its `data`
  // buffer. Before: an index dataset and a buffer at the root.
  const columnar = readColumnTable(file, table, labelsPath);
  if (columnar) {
    indexData = columnar;
    dataFlat = bufferBytes(tableBuffer(file, table));
    reportTableProblems(
      labelsPath,
      scoreMapProblems(table, columnar, nOwners, dataFlat.length),
    );
  } else {
    const [indexPath, dataPath] =
      table === "masks/score_maps"
        ? ["mask_score_map_index", "mask_score_maps"]
        : ["label_image_score_map_index", "label_image_score_maps"];
    const indexDs = file.get(indexPath);
    const dataDs = file.get(dataPath);
    if (!indexDs || !dataDs) return result;
    indexData = normalizeStructDataset(indexDs);
    dataFlat = bufferBytes(dataDs);
  }
  const idxCol = indexData.mask_idx ?? indexData.li_idx ?? [];
  const starts = indexData.data_start ?? [];
  const ends = indexData.data_end ?? [];
  const smHeights = indexData.height ?? [];
  const smWidths = indexData.width ?? [];
  const spatial = (name: string, i: number, fallback: number): number => {
    const column = indexData[name];
    return column && column.length > i ? Number(column[i]) : fallback;
  };

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

    result.set(annotIdx, {
      scoreMap,
      height: h,
      width: w,
      scale: [spatial("scale_x", i, 1), spatial("scale_y", i, 1)],
      offset: [spatial("offset_x", i, 0), spatial("offset_y", i, 0)],
    });
  }
  return result;
}

function readMasks(
  file: any,
  _videos: Video[],
  tracks: Track[],
  ctx: TableContext,
): [SegmentationMask, number, number][] {
  let masksData: Record<string, any>;
  let rleFlat: Uint8Array;
  let categories: string[];
  let names: string[];
  let sources: string[];
  // Format 3.0: a group of columns holding its strings and `rle` buffer.
  const columnar = readColumnTable(file, "masks", ctx.labelsPath);
  if (columnar) {
    if (tableRows(columnar) === 0) return [];
    masksData = columnar;
    rleFlat = bufferBytes(tableBuffer(file, "masks"));
    reportTableProblems(
      ctx.labelsPath,
      maskProblems(columnar, rleFlat.length, ctx.counts),
    );
    categories = columnar.category;
    names = columnar.name;
    sources = columnar.source;
  } else {
    const masksDs = file.get("masks");
    if (!masksDs) return [];
    masksData = normalizeStructDataset(masksDs);
    if (!(masksData.height ?? []).length) return [];

    const rleDs = file.get("mask_rle");
    if (!rleDs) return [];
    rleFlat = bufferBytes(rleDs);

    // v1.9+: string datasets at root level; fallback to JSON attrs on mask dataset
    categories = readStringMetadata(
      file,
      "mask_categories",
      masksDs,
      "categories",
    );
    names = readStringMetadata(file, "mask_names", masksDs, "names");
    sources = readStringMetadata(file, "mask_sources", masksDs, "sources");
  }
  const heights = masksData.height ?? [];

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
    "masks/score_maps",
    heights.length,
    ctx.labelsPath,
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
      isPredictedCol.length > i ? Number(isPredictedCol[i]) !== 0 : false;
    let mask: SegmentationMask;

    if (isPred) {
      // A missing score (NaN) reads as 0, as in Python sleap-io.
      const rawScore = scoreCol.length > i ? Number(scoreCol[i]) : 0;
      const scoreVal = Number.isNaN(rawScore) ? 0 : rawScore;
      const sm = scoreMaps.get(i);
      mask = new PredictedSegmentationMask({
        ...baseOptions,
        score: scoreVal,
        scoreMap: sm?.scoreMap ?? null,
        scoreMapScale: sm?.scale,
        scoreMapOffset: sm?.offset,
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
  ctx: TableContext,
  instances?: Array<Instance | PredictedInstance>,
): [LabelImage, number, number][] {
  let liData: Record<string, any>;
  let sources: string[];
  let dataDs: any;
  let objData: Record<string, any> | null = null;
  let objCategories: string[] = [];
  let objNames: string[] = [];
  // Format 3.0: a group of columns holding `source`, the pixel `data` and the
  // `objects/` table (with its own strings).
  const columnar = readColumnTable(file, "label_images", ctx.labelsPath);
  if (columnar) {
    if (tableRows(columnar) === 0) return [];
    liData = columnar;
    sources = columnar.source;
    dataDs = tableBuffer(file, "label_images");
    const objects =
      readColumnTable(file, "label_images/objects", ctx.labelsPath) ??
      emptyColumnTable("label_images/objects");
    reportTableProblems(
      ctx.labelsPath,
      labelImageProblems(
        columnar,
        objects,
        dataDs ? ((dataDs.shape ?? []) as number[]) : null,
        ctx.counts,
      ),
    );
    objData = objects;
    objCategories = objects.category;
    objNames = objects.name;
  } else {
    const liDs = file.get("label_images");
    if (!liDs) return [];
    liData = normalizeStructDataset(liDs);
    if (!(liData.video ?? []).length) return [];
    // v1.9+: string datasets; fallback to JSON attrs
    sources = readStringMetadata(file, "label_image_sources", liDs, "sources");
    dataDs = file.get("label_image_data");
    if (!dataDs) return [];
    // Objects table (may not exist if all label images have 0 objects)
    const objDs = file.get("label_image_objects");
    if (objDs) {
      objData = normalizeStructDataset(objDs);
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
    }
  }
  const videoIndices = liData.video ?? [];
  const frameIndices = liData.frame_idx ?? [];
  const heights = liData.height ?? [];
  const widths = liData.width ?? [];
  const nObjectsList = liData.n_objects ?? [];
  const objectsStarts = liData.objects_start ?? [];
  const dataStarts = liData.data_start ?? [];
  const dataEnds = liData.data_end ?? [];

  // v1.9+ columns (may not exist in older files)
  const isPredictedCol = liData.is_predicted ?? [];
  const liScoreCol = liData.score ?? [];

  // v2.1+: spatial metadata columns (default to 1.0/0.0 for old files)
  const liScaleXCol = liData.scale_x ?? [];
  const liScaleYCol = liData.scale_y ?? [];
  const liOffsetXCol = liData.offset_x ?? [];
  const liOffsetYCol = liData.offset_y ?? [];

  // Read pixel data: either blob (1D, v1.8-v2.1) or chunked (3D, v2.2+)
  const dataShape = dataDs.shape ?? [];
  const isChunked = dataShape.length === 3;
  // For blob format: flat Uint8Array of concatenated zlib-compressed frames
  // For chunked format: 3D Int32Array [T, H, W] (decompression handled by HDF5 lib)
  let dataFlat: Uint8Array = new Uint8Array(0);
  let dataChunked: any = null;
  if (isChunked) {
    dataChunked = dataDs.value; // 3D array or flat typed array with shape metadata
  } else {
    dataFlat = bufferBytes(dataDs);
  }

  const objLabelIds: any[] = objData?.label_id ?? [];
  const objTrackIndices: any[] = objData?.track ?? [];
  const objInstanceIndices: any[] = objData?.instance ?? [];
  const objScoreCol: any[] = objData?.score ?? [];
  const objTrackingScoreCol: any[] = objData?.tracking_score ?? [];

  // Read score maps if present
  const liScoreMaps = readScoreMaps(
    file,
    "label_images/score_maps",
    videoIndices.length,
    ctx.labelsPath,
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
      isPredictedCol.length > i ? Number(isPredictedCol[i]) !== 0 : false;

    // v2.1+: spatial metadata
    const liScaleX = liScaleXCol.length > i ? Number(liScaleXCol[i]) : 1;
    const liScaleY = liScaleYCol.length > i ? Number(liScaleYCol[i]) : 1;
    const liOffsetX = liOffsetXCol.length > i ? Number(liOffsetXCol[i]) : 0;
    const liOffsetY = liOffsetYCol.length > i ? Number(liOffsetYCol[i]) : 0;
    const liScale: [number, number] = [liScaleX, liScaleY];
    const liOffset: [number, number] = [liOffsetX, liOffsetY];

    let li: LabelImage;
    if (isPred) {
      // A missing score (NaN) reads as 0, as in Python sleap-io.
      const rawLiScore = liScoreCol.length > i ? Number(liScoreCol[i]) : 0;
      const liScore = Number.isNaN(rawLiScore) ? 0 : rawLiScore;
      const sm = liScoreMaps.get(i);
      li = new PredictedLabelImage({
        data: pixelData,
        height,
        width,
        objects,
        source: sources[i] ?? "",
        score: liScore,
        scoreMap: sm?.scoreMap ?? null,
        scoreMapScale: sm?.scale,
        scoreMapOffset: sm?.offset,
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

/**
 * Whether `path` is a group, and so is each of its parents. h5wasm hands back a
 * bogus truthy group for a path under a dataset (`masks/score_maps` when
 * `/masks` is a 2.x dataset), so every level is checked.
 */
function isH5Group(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  path: string,
): boolean {
  let prefix = "";
  for (const part of path.split("/")) {
    prefix = prefix ? `${prefix}/${part}` : part;
    try {
      if (file.get(prefix)?.type !== "Group") return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * The unknown columns of a format 3.0 file's tables (see carry-read.ts), to
 * write them back on a format 3.0 save.
 */
function readUnknownColumnsH5(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
): UnknownColumns {
  const out: UnknownColumns = {};
  for (const table of CARRIED_TABLES) {
    if (!isH5Group(file, table)) continue;
    for (const name of h5Members(file, table, "Dataset")) {
      if (!isUnknownColumn(table, name)) continue;
      const ds = file.get(`${table}/${name}`);
      const md = ds?.metadata;
      const column = carriedColumn(
        md ? { ...md, shape: ds.shape } : null,
        md && isCarriable({ ...md, shape: ds.shape }) ? ds.value : null,
      );
      if (column) {
        out[table] ??= {};
        out[table][name] = column;
      }
    }
  }
  return out;
}

/**
 * What a format 3.0 save would not write back, as paths for the summary's
 * `unreadTables`: groups inside the pose tables and `/bboxes`, unknown
 * columns that cannot be carried, and members of `metadata/` groups the
 * readers do not read (see carry-read.ts).
 */
function uncarriedMembersH5(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  metadata: Record<string, MetadataColumns | null>,
): string[] {
  const out: string[] = [];
  for (const table of CARRIED_TABLES) {
    if (!isH5Group(file, table)) continue;
    const members: TableMember[] = h5Members(file, table).map((name) => {
      const node = file.get(`${table}/${name}`);
      return node?.type === "Group"
        ? { name, group: true }
        : {
            name,
            group: false,
            info: node ? { ...node.metadata, shape: node.shape } : null,
          };
    });
    out.push(...unreadTableMembers(table, members));
  }
  for (const table of METADATA_TABLES) {
    const base = `${table}/${METADATA_SUBGROUP}`;
    if (!isH5Group(file, base)) continue;
    out.push(
      ...unreadMetadataMembers(
        table,
        h5Members(file, base),
        metadataKeys(metadata[table]),
      ),
    );
  }
  return out;
}

/** The `(owner_type, owner_id, catalog index)` of each 3.0 link row. */
function linkKeysH5(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  table: "identity/links" | "categories/links",
): number[][] | undefined {
  if (!isH5Group(file, table)) return undefined;
  const index = table === "identity/links" ? "identity_idx" : "category_idx";
  const read = (name: string): ArrayLike<unknown> =>
    file.get(`${table}/${name}`)?.value ?? [];
  const type = read("owner_type");
  const owner = read("owner_id");
  const idx = read(index);
  return Array.from({ length: type.length }, (_, i) => [
    Number(type[i]),
    Number(owner[i]),
    Number(idx[i]),
  ]);
}

/** The records owning the rows of a 3.0 file's session tables. */
function sessionOwnersH5(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  sessions: RecordingSession[],
) {
  if (!isH5Group(file, "session_data/frame_groups")) return undefined;
  return sessionCarryOwners(sessions, {
    nFrameGroups:
      columnH5(file, "session_data/frame_groups/frame_idx")?.length ?? 0,
    memberStart:
      columnH5(file, "session_data/instance_groups/member_start") ?? [],
    memberEnd: columnH5(file, "session_data/instance_groups/member_end") ?? [],
    camera: columnH5(file, "session_data/instance_group_members/camera") ?? [],
  });
}

/** A column of a 3.0 table as numbers, or none when absent. */
function columnH5(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  path: string,
): number[] | undefined {
  try {
    const ds = file.get(path);
    if (!ds || ds.type === "Group") return undefined;
    return Array.from(ds.value as ArrayLike<unknown>, Number);
  } catch {
    return undefined;
  }
}

/**
 * Read one of the format 3.0 tables other than the pose tables when it is
 * stored as a group of columns, or `null` when it is not (absent, or a 2.x
 * dataset). Only the columns this version knows are read; the others are
 * listed as unknown in the summary (see readFormat3).
 *
 * @throws {SlpTableError} When a required column is missing or the columns
 *   differ in length.
 */
function readColumnTable(
  file: any,
  table: Format3TableName,
  labelsPath: string,
): ColumnTable | null {
  if (!isH5Group(file, table)) return null;
  const columns: Record<string, ArrayLike<unknown>> = {};
  const unknownLengths: Record<string, number> = {};
  for (const name of h5Members(file, table, "Dataset")) {
    const dataset = file.get(`${table}/${name}`);
    if (isKnownTableColumn(table, name)) {
      columns[name] = dataset.value as ArrayLike<unknown>;
    } else if (name !== TABLE_SPECS[table].buffer && dataset.shape?.length) {
      unknownLengths[name] = dataset.shape[0];
    }
  }
  return tableFromColumns(table, columns, labelsPath, unknownLengths);
}

/** The bytes of a flat `uint8` buffer dataset, or none when it is absent. */
function bufferBytes(dataset: any): Uint8Array {
  if (!dataset) return new Uint8Array(0);
  const value = dataset.value;
  return value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
}

/** The buffer member of a 3.0 table group, or `null` when it has none. */
function tableBuffer(file: any, table: Format3TableName): any {
  const name = TABLE_SPECS[table].buffer;
  if (!name || !h5Members(file, table, "Dataset").includes(name)) return null;
  return file.get(`${table}/${name}`);
}

/** What the readers of the format 3.0 tables check links against. */
interface TableContext {
  labelsPath: string;
  counts: TableCounts;
  /** Rows of `/frames`, or `null` when the file has no frame table. */
  nFrames: number | null;
}

/** The counts the format 3.0 tables' links are checked against. */
function tableContext(
  file: any,
  labelsPath: string,
  videos: Video[],
  tracks: Track[],
  pose: { framesData: Record<string, any>; instancesData: Record<string, any> },
): TableContext {
  return {
    labelsPath,
    counts: {
      nVideos: videos.length,
      nTracks: tracks.length,
      nInstances: columnLength(pose.instancesData),
    },
    nFrames: file.get("frames") ? columnLength(pose.framesData) : null,
  };
}

/**
 * Read one pose table in either layout: a compound dataset (formats 1.x and
 * 2.x) or a group with one dataset per column (format 3.0, see columnar.ts).
 */
function readPoseTable(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  table: PoseTableName,
  module: unknown,
  labelsPath: string,
  // biome-ignore lint/suspicious/noExplicitAny: matches normalizeStructDataset
): Record<string, any[]> {
  const node = file.get(table);
  if (node && node.type === "Group") {
    const columns: Record<string, ArrayLike<unknown>> = {};
    for (const name of node.keys() as string[]) {
      // Only the columns this version knows are read; the others are listed
      // as unknown (see readFormat3) and would be dropped by a save anyway.
      if (!isKnownPoseColumn(table, name)) continue;
      const child = file.get(`${table}/${name}`);
      if (!child || child.type === "Group") continue;
      columns[name] = child.value as ArrayLike<unknown>;
    }
    return poseTableFromColumns(table, columns, labelsPath);
  }
  return normalizeStructDataset(node, module);
}

/** The members of an HDF5 group, or none when `path` is absent or a dataset. */
function h5Members(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  path: string,
  type?: "Group" | "Dataset",
): string[] {
  try {
    const node = file.get(path);
    if (!node || node.type !== "Group") return [];
    const names = node.keys() as string[];
    if (!type) return names;
    return names.filter((name) => file.get(`${path}/${name}`)?.type === type);
  } catch {
    return [];
  }
}

/**
 * Read the record metadata of a format 3.0 table
 * (`<table>/metadata/<key>/{values,present}`). Members that are not a group
 * with a 1-D `values` dataset of a supported kind (bool, integer, float or
 * string) are ignored, as in Python sleap-io.
 *
 * @throws {Error} When a key does not have one row per record.
 */
function readMetadataColumns(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  table: string,
  rows: number,
  labelsPath: string,
): MetadataColumns | null {
  const base = `${table}/${METADATA_SUBGROUP}`;
  const columns: MetadataColumns = {};
  for (const key of h5Members(file, base, "Group")) {
    const datasets = h5Members(file, `${base}/${key}`, "Dataset");
    if (!datasets.includes("values")) continue;
    const values = file.get(`${base}/${key}/values`);
    let kindAttr: unknown;
    try {
      kindAttr = values.attrs?.kind?.value;
    } catch {
      kindAttr = undefined;
    }
    const column = metadataColumn(
      metadataKindFromH5(values.metadata, kindAttr),
      values.value,
      datasets.includes("present")
        ? file.get(`${base}/${key}/present`).value
        : null,
    );
    if (column) columns[key] = column;
  }
  checkMetadataColumns(table, columns, rows, labelsPath);
  return Object.keys(columns).length > 0 ? columns : null;
}

/** What the readers keep from the format 3.0 parts of a file. */
interface Format3Read {
  sourceFormat: SlpSourceFormat;
  instanceMetadata: MetadataColumns | null;
  frameMetadata: MetadataColumns | null;
  bboxMetadata: MetadataColumns | null;
}

/**
 * For a file in format 3.0: run the range checks over its pose tables, read
 * its record metadata and unknown column names, and apply the caller's
 * `format3` choice. Returns `null` for files before 3.0.
 *
 * @throws {SlpFormat3ChoiceError} When the caller gave no choice.
 * @throws {Error} When the 3.0 pose tables are inconsistent.
 */
function readFormat3(
  // biome-ignore lint/suspicious/noExplicitAny: h5wasm File
  file: any,
  labelsPath: string,
  formatId: number,
  nVideos: number,
  tables: {
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTable
    framesData: Record<string, any>;
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTable
    instancesData: Record<string, any>;
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTable
    pointsData: Record<string, any>;
    // biome-ignore lint/suspicious/noExplicitAny: matches readPoseTable
    predPointsData: Record<string, any>;
    choice: Format3Option | undefined;
    /** Whether `/metadata`'s `json` attribute holds the provenance. */
    provenanceInMetadata?: boolean;
  },
): Format3Read | null {
  if (!isFormat3(formatId)) return null;
  const { framesData, instancesData, pointsData, predPointsData } = tables;
  if (isColumnarTable(framesData) && isColumnarTable(instancesData)) {
    checkPoseTables({
      frames: framesData,
      instances: instancesData,
      nPoints: columnLength(pointsData),
      nPredPoints: columnLength(predPointsData),
      nVideos,
      labelsPath,
    });
  }
  const instanceMetadata = readMetadataColumns(
    file,
    "instances",
    (instancesData.instance_type ?? []).length,
    labelsPath,
  );
  const frameMetadata = readMetadataColumns(
    file,
    "frames",
    (framesData.frame_idx ?? []).length,
    labelsPath,
  );
  const bboxColumns = h5Members(file, "bboxes", "Dataset");
  const bboxMetadata = bboxColumns.includes("x1")
    ? readMetadataColumns(
        file,
        "bboxes",
        file.get("bboxes/x1")?.shape?.[0] ?? 0,
        labelsPath,
      )
    : null;
  const summary = buildFormat3Summary({
    formatId,
    unreadTables: [
      ...unreadMembers({
        root: file.keys() as string[],
        groups: Object.fromEntries(
          PARTLY_READ_GROUPS.map((g) => [g, h5Members(file, g)]),
        ),
        provenanceInMetadata: tables.provenanceInMetadata ?? false,
      }),
      ...FORMAT3_TABLES.flatMap((table) =>
        isH5Group(file, table)
          ? unknownTableGroups(table, h5Members(file, table, "Group"))
          : [],
      ),
      ...uncarriedMembersH5(file, {
        instances: instanceMetadata,
        frames: frameMetadata,
        bboxes: bboxMetadata,
      }),
    ],
    unlabeledUserPoints: countUnlabeledPoints(pointsData),
    unlabeledPredictedPoints: countUnlabeledPoints(predPointsData),
    metadataKeys: {
      instances: metadataKeys(instanceMetadata),
      frames: metadataKeys(frameMetadata),
      bboxes: metadataKeys(bboxMetadata),
    },
    unknownColumns: [
      ...(["frames", "instances", "points", "pred_points"] as const).flatMap(
        (table) => unknownColumns(table, h5Members(file, table, "Dataset")),
      ),
      ...unknownColumns("bboxes", bboxColumns),
      ...FORMAT3_TABLES.flatMap((table) =>
        isH5Group(file, table)
          ? unknownTableColumns(table, h5Members(file, table, "Dataset"))
          : [],
      ),
    ],
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

function normalizeStructDataset(
  dataset: any,
  module?: unknown,
): Record<string, any[]> {
  if (!dataset) return {};

  // Fast path: read fixed-size compound tables (frames/instances/points/
  // pred_points) column-wise straight from the record blob, skipping h5wasm's
  // per-row/per-member `Dataset.value` materialization (the dominant open cost
  // on large point tables). Returns null — and we fall through to `.value` —
  // for anything it can't read exactly. See ./h5-compound.ts.
  if (module) {
    const fast = readCompoundColumnsManual(module, dataset);
    if (fast) return fast as Record<string, any[]>;
  }

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
    const flat = raw as unknown as { readonly [i: number]: number };
    if (fieldNames.length) {
      // Fast path: extract each field's column DIRECTLY from the flat typed
      // array by stride, in a single sequential pass. The previous code built
      // an intermediate array-of-rows — one boxed `Array.from(slice)` per row
      // (millions of tiny allocations on a large points table) — then re-mapped
      // it column-by-column; that transpose-and-back dominated large-file loads
      // (~2.7s of an 11s open on a 0.9M-point file). Column j gets `undefined`
      // past colCount and columns past fieldNames are dropped, matching the old
      // `rows.map(row => row[idx])` semantics exactly.
      const cols: any[][] = fieldNames.map(() => new Array(rowCount));
      const fillCols = Math.min(fieldNames.length, colCount);
      for (let i = 0; i < rowCount; i += 1) {
        const base = i * colCount;
        for (let j = 0; j < fillCols; j += 1) {
          cols[j][i] = flat[base + j];
        }
      }
      const data: Record<string, any[]> = {};
      for (let j = 0; j < fieldNames.length; j += 1) {
        data[fieldNames[j]] = cols[j];
      }
      return data;
    }
    // No field names (malformed/legacy): preserve the row-index-keyed fallback.
    const rows: any[][] = [];
    for (let i = 0; i < rowCount; i += 1) {
      const start = i * colCount;
      rows.push(Array.from((raw as any).slice(start, start + colCount)));
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
  instanceMetadata?: MetadataColumns | null;
  frameMetadata?: MetadataColumns | null;
  /** Filled with each built instance, keyed by its `/instances` row. */
  instanceRows?: Map<number, Instance | PredictedInstance>;
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
    instanceMetadata,
    frameMetadata,
  } = options;
  const frameIds = framesData.frame_id ?? [];
  const videoIdToIndex = buildVideoIdMap(framesData, videos);
  const instanceById =
    options.instanceRows ?? new Map<number, Instance | PredictedInstance>();
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
      // A 3.0 row of another instance type is skipped, as in Python.
      if (skipsInstanceRow(instancesData, instIdx)) continue;
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
      // NaN means "no score". Files before 3.0 have always read it as 0;
      // from 3.0 it stays NaN, as Python sleap-io's None, so a save writes it
      // back as NaN.
      const trackingScore =
        Number.isNaN(rawTrackingScore) && formatId < 3 ? 0 : rawTrackingScore;
      const fromPredicted = Number(
        instancesData.from_predicted?.[instIdx] ?? -1,
      );
      const skeleton = skeletons[skeletonId] ?? skeletons[0];
      const track = trackId >= 0 ? tracks[trackId] : null;
      const metadata = metadataRecord(instanceMetadata, instIdx);

      let instance: Instance | PredictedInstance;
      if (instanceType === 0) {
        // Build straight from the point columns — no intermediate Point[].
        instance = Instance._fromColumns({
          columns: pointsData,
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
          columns: predPointsData,
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
      if (Number.isNaN(rawTrackingScore) && formatId < 3) {
        markNanTrackingScore(instance);
      }
      instances.push(instance);
    }

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

function readCentroids(
  file: any,
  _videos: Video[],
  tracks: Track[],
): [Centroid, number, number][] {
  // Two on-disk layouts are supported:
  //  - Python / current JS: a `/centroids` GROUP with one child dataset per
  //    field (x, y, z, video, frame_idx, track, instance, is_predicted, score,
  //    tracking_score) plus string children (category/name/source).
  //  - Legacy JS: a flat `/centroids` matrix dataset + `field_names` attr, with
  //    sibling `centroid_categories`/`centroid_names`/`centroid_sources`.
  let data: Record<string, ArrayLike<number>>;
  let categories: string[];
  let names: string[];
  let sources: string[];

  if (file.get("centroids/x")) {
    // Group layout (matches Python sleap-io).
    const col = (name: string): ArrayLike<number> =>
      (file.get(`centroids/${name}`)?.value as ArrayLike<number>) ?? [];
    data = {
      x: col("x"),
      y: col("y"),
      z: col("z"),
      video: col("video"),
      frame_idx: col("frame_idx"),
      track: col("track"),
      instance: col("instance"),
      is_predicted: col("is_predicted"),
      score: col("score"),
      tracking_score: col("tracking_score"),
    };
    const strCol = (name: string): string[] => {
      const ds = file.get(`centroids/${name}`);
      if (!ds) return [];
      try {
        return ((ds.value as ArrayLike<unknown>) ?? []).length
          ? Array.from(ds.value as ArrayLike<unknown>, decodeStr)
          : [];
      } catch {
        // Python may store these as vlen-str, which h5wasm can't always read;
        // the centroid position/type/link still round-trips without them.
        return [];
      }
    };
    categories = strCol("category");
    names = strCol("name");
    sources = strCol("source");
  } else {
    const centroidsDs = file.get("centroids");
    if (!centroidsDs) return [];
    data = normalizeStructDataset(centroidsDs);
    categories = readStringMetadata(
      file,
      "centroid_categories",
      centroidsDs,
      "categories",
    );
    names = readStringMetadata(file, "centroid_names", centroidsDs, "names");
    sources = readStringMetadata(
      file,
      "centroid_sources",
      centroidsDs,
      "sources",
    );
  }

  return buildCentroidTuples(data, categories, names, sources, tracks);
}
