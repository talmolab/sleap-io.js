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
import { GrayscaleVideoBackend } from "../../video/grayscale-backend.js";
import {
  decodeEncoded,
  encodeBitmapToPng,
  encodeImageDataToPng,
  isImageBitmapLike,
  isImageDataLike,
  needsRedBlueSwap,
} from "../../video/image-decode.js";
import { getH5Module, getH5FileSystem, ensureH5StagingDir } from "./h5.js";
import { type ROI, type PredictedROI, encodeWkb } from "../../model/roi.js";
import type {
  SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
} from "../../model/mask.js";
import type { BoundingBox, PredictedBoundingBox } from "../../model/bbox.js";
import type { Centroid, PredictedCentroid } from "../../model/centroid.js";
import { normalizeCentroidSource } from "../../model/centroid.js";
import type {
  LabelImage,
  PredictedLabelImage,
} from "../../model/label-image.js";
import { deflate } from "pako";
import type { Identity } from "../../model/identity.js";
import { PredictedInstance3D } from "../../model/instance3d.js";
import type { LazyDataStore } from "../../model/lazy.js";
import { buildVideoIdMap } from "../../model/video-id-map.js";
import {
  type MetadataColumn,
  type MetadataKind,
  type RecordMetadata,
  metadataKeys,
  metadataKeysOf,
  metadataRecord,
} from "../../model/record-metadata.js";
import {
  type SlpSourceFormat,
  SlpViewOnlyError,
  metadataKindFromH5,
} from "./format3.js";
import {
  type SlpLayout,
  type SlpVersion,
  checkSlpVersion,
  getV3Defaults,
  SLP_FORMAT3_ID,
} from "./slp-version.js";
import {
  type Column,
  type ColumnType,
  metadataColumnsOf,
  writeByteBuffer,
  writeColumnTable,
  writeMetadataColumns,
  ensureGroup,
  withBoolMetadataNotice,
} from "./write-columns.js";
import {
  type ColumnCarry,
  CarrySession,
  warnDropped,
  warnDroppedCarry,
} from "./column-carry.js";
import {
  countUnlabeledPoints,
  hasSkippedInstanceRows,
  skipsInstanceRow,
} from "./columnar.js";
import {
  keepSourceMark,
  sessionRecords,
  sourceMarkOf,
} from "../../model/source-mark.js";
import { hadNanTrackingScore } from "../../model/stored-nan.js";
import {
  checkEmbedImageFormat,
  embedQuality,
  encodeFrameAs,
  imageFileBytes,
  type EmbedEncoding,
  type EmbedImageFormat,
} from "./embed-format.js";

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

const SPAWNED_ON = 0;

/**
 * Which frame images `saveSlp` / `saveSlpToBytes` embed, as Python sleap-io's
 * `embed`: `true`/`"all"` (all labeled frames and suggestions), `"user"`,
 * `"suggestions"`, `"user+suggestions"`, `"source"` (no images; restore the
 * source video), `false` (no embedding), or an explicit list of
 * `[video, frameIdx]` pairs. `"all+suggestions"` is kept as an alias of
 * `"all"`.
 */
export type EmbedOption = boolean | string | Array<[Video, number]>;

/**
 * Thrown when an `onProgress` callback returns `false` during an embedding
 * save, as Python sleap-io's `ExportCancelled`. Nothing is written.
 */
export class ExportCancelled extends Error {
  constructor(message = "Export cancelled") {
    super(message);
    this.name = "ExportCancelled";
  }
}

export type SlpWriteOptions = {
  embed?: EmbedOption;
  restoreOriginalVideos?: boolean;
  /**
   * When embedding, also turn videos with no frames to embed into (empty)
   * embedded videos that reference the package, so it doesn't point at source
   * files that may not travel with it. Default `true`, as Python sleap-io's
   * `embed_all_videos`. `false` leaves those videos as external references.
   */
  embedAllVideos?: boolean;
  /**
   * Called as frame images are read and encoded for embedding from a
   * continuous video (`message` "Embedding frames"), then as embedded images
   * are written (`message` "Writing frames"), with `current` of `total`.
   * Already-embedded videos copy their stored images in one go and don't
   * report reading. Return `false` to cancel: the save throws
   * {@link ExportCancelled}, as Python's `progress_callback`.
   */
  onProgress?: (current: number, total: number, message?: string) => unknown;
  /**
   * Image format to store embedded frames in: `"png"` (lossless) or
   * `"jpg"` (lossy, smaller and faster to decode; `"jpeg"` is accepted and
   * stored as `"jpg"`), as Python sleap-io's `image_format`. With a format,
   * frames already encoded in it (image files, encoded bytes a backend
   * returns that need no red/blue swap, or an already-embedded video's
   * stored images) are stored verbatim and every other frame is decoded and encoded
   * in it, so an already-embedded video stored in another format is
   * converted; a grayscale video's frames are stored with one channel.
   * Unlike Python, a conversion keeps all of the video's stored images
   * (Python keeps only the frames `embed` selects), and a save without
   * `embed` converts too (Python's `embed=False` writes no images). When
   * omitted, frames are stored as before: new frames as PNG, except encoded
   * bytes a backend returns, which are kept as they are (color bytes stored
   * BGR are re-encoded as RGB PNGs), and already-embedded images copied as
   * they are.
   */
  imageFormat?: EmbedImageFormat | "jpeg";
  /**
   * Encoder setting for frames encoded with {@link imageFormat}: JPEG quality
   * (0-100, default 95) for `"jpg"`, or PNG compression level (0-9) for
   * `"png"`. Needs an explicit `imageFormat`. Frames stored verbatim keep
   * their bytes. (The streaming writer's worker compresses PNGs with the
   * platform's zlib, whose level can't be set: there 0 stores them
   * uncompressed and any other level uses its default.)
   */
  imageQuality?: number | null;
  /**
   * How the 2.x layout saves unlabelled points (`labeled` and `visible` both
   * false), which it cannot store; see {@link UnlabeledAs}. Ignored when
   * format 3.0 is written, which stores them.
   * Decided record by record: points of instances loaded from a format 3.0
   * file with `format3: "edit"` (wherever they have been merged or copied
   * since) are written as absent unless this is `"error"`; points of any other
   * instance are refused unless this is `"absent"`. Records loaded with
   * `format3: "view"` are never written.
   */
  unlabeledAs?: UnlabeledAs;
  /**
   * The layout to write: `"auto"` (the default) writes the SLP 2.x layout that
   * SLEAP and sleap-io < 0.10 open, unless the labels need format 3.0 (see
   * {@link resolveSlpVersion}); `"v2"` always writes the 2.x layout, with
   * `unlabeledAs` and dropping metadata with a warning; `"v3"` always writes
   * format 3.0, which stores everything (`unlabeledAs` is ignored).
   */
  slpVersion?: SlpVersion;
};

/**
 * How a writer of the 2.x layout handles unlabelled points, as Python
 * sleap-io's `unlabeled_as`: `"error"` throws before anything is written,
 * naming the count; `"absent"` writes them as hidden points with no location
 * (labelled, not visible, NaN coordinates), which is how a 2.x reader will
 * read them back.
 */
export type UnlabeledAs = "error" | "absent";

/**
 * Throw {@link SlpViewOnlyError} for labels (or a lazy store, or a table
 * update) loaded from a format 3.0 file with `format3: "view"`. Every SLP writer
 * calls this before it touches its target.
 */
export function refuseViewOnly(
  source:
    | { sourceFormat?: SlpSourceFormat | null; sessions?: RecordingSession[] }
    | null
    | undefined,
): void {
  const sourceFormat = source?.sourceFormat;
  if (sourceFormat?.access === "view") throw new SlpViewOnlyError(sourceFormat);
  // The frame groups and instance groups of recording sessions, which no
  // frame holds.
  for (const record of sessionRecords(source?.sessions ?? [])) {
    const mark = sourceMarkOf(record);
    if (mark?.access === "view") throw new SlpViewOnlyError(mark);
  }
}

/**
 * Whether a centroid, box, mask or ROI holds what the streaming writer does
 * not write: an identity, a category score or an embedding. Its category
 * itself is kept, in the table's own `category` column.
 */
function annotationLinkLoss(d: IdentityBearing): boolean {
  return (
    d.identity != null ||
    d.identityEmbedding != null ||
    d.categoryScore != null ||
    d.categoryEmbedding != null
  );
}

/**
 * Whether an instance holds what the streaming writer does not write: an
 * identity, a category (instances have no category column) or an embedding.
 */
function instanceLinkLoss(d: IdentityBearing): boolean {
  return (
    d.identity != null ||
    d.identityEmbedding != null ||
    (d.category != null && d.category !== "") ||
    d.categoryEmbedding != null
  );
}

/**
 * `SlpStreamWriter.appendFrames` writes frames' poses and annotations but no
 * per-detection identity or category links or embeddings. Frames whose
 * instances or annotations were loaded from a format 3.0 file for editing,
 * and hold any of those, are refused before anything is written, as
 * {@link refuseFormat3StoreLosses} refuses stores.
 *
 * @throws {Error} Naming what would be lost and the writers that keep it.
 */
function refuseFormat3FrameLosses(frames: Iterable<LabeledFrame>): void {
  const fromFormat3 = (record: object) => !!sourceMarkOf(record);
  let instances = false;
  let annotations = false;
  let source: SlpSourceFormat | undefined;
  for (const frame of frames) {
    for (const inst of frame.instances) {
      if (fromFormat3(inst) && instanceLinkLoss(inst as IdentityBearing)) {
        instances = true;
        source ??= sourceMarkOf(inst);
      }
    }
    for (const list of [
      frame.centroids,
      frame.bboxes,
      frame.masks,
      frame.rois,
    ] as IdentityBearing[][]) {
      for (const d of list) {
        if (fromFormat3(d as object) && annotationLinkLoss(d)) {
          annotations = true;
          source ??= sourceMarkOf(d as object);
        }
      }
    }
  }
  if (!source) return;
  const lost = [
    ...(instances
      ? ["the identities, categories or embeddings of their instances"]
      : []),
    ...(annotations
      ? [
          "the identities, category scores or embeddings of their " +
            "centroids, boxes, masks or ROIs",
        ]
      : []),
  ];
  throw new Error(
    `Frames loaded from '${source.labelsPath}' (SLP format ` +
      `${Number.isInteger(source.formatId) ? source.formatId.toFixed(1) : source.formatId}) hold ` +
      `${lost.join(", and ")}, which SlpStreamWriter.appendFrames does not ` +
      "write. Save them with saveSlp or saveSlpToBytes, which keep them.",
  );
}

/**
 * A format 3.0 streaming writer writes the links of appended frames, but only
 * to the identities in its header. Frames whose instances or annotations were
 * loaded from a 3.0 file and hold an identity are refused, before anything is
 * written, when the header has none, as {@link refuseFormat3StoreLosses}
 * refuses stores.
 *
 * @throws {Error} Naming what would be lost.
 */
function refuseFormat3FrameIdentities(
  frames: Iterable<LabeledFrame>,
  headerHasIdentities: boolean,
): void {
  if (headerHasIdentities) return;
  for (const frame of frames) {
    for (const record of [
      ...frame.instances,
      ...frame.centroids,
      ...frame.bboxes,
      ...frame.masks,
      ...frame.rois,
    ] as Array<IdentityBearing & object>) {
      const source = sourceMarkOf(record);
      if (!source || record.identity == null) continue;
      throw new Error(
        `Frames loaded from '${source.labelsPath}' (SLP format ` +
          `${Number.isInteger(source.formatId) ? source.formatId.toFixed(1) : source.formatId}) hold ` +
          "identities, which SlpStreamWriter.appendFrames writes only when " +
          "the writer's header holds them. Pass the identities in the " +
          "header, or save the labels with saveSlp or saveSlpToBytes.",
      );
    }
  }
}

/**
 * The streaming writer (`SlpStreamWriter.appendStore`, and so
 * `saveSlpMergedFromStores` and `saveSlpMergedToSink`) writes a store's
 * poses and annotations, but no per-detection identity or category links or
 * embeddings, and only the identities and sessions given in its header. A
 * store loaded from a format 3.0 file for editing promised that a save drops
 * only what its summary lists, so such a store holding any of those is refused
 * before it is written, naming what would be lost. Stores from files before 3.0
 * are written as before. A writer of format 3.0 (`writesLinks`) writes the
 * links and embeddings of the store's instances and annotations, so only
 * identities and sessions missing from its header are refused there.
 *
 * @throws {Error} Naming what would be lost and the writers that keep it.
 */
export function refuseFormat3StoreLosses(
  store: LazyDataStore,
  header: { identities: boolean; sessions: boolean },
  writesLinks = false,
): void {
  const source = store.sourceFormat;
  if (!source) return;
  const lost: string[] = [];
  if ((store.identities ?? []).length > 0 && !header.identities) {
    lost.push("its identities");
  }
  if (
    !writesLinks &&
    (store._instanceIdentityLinks?.size ||
      store._instanceCategoryLinks?.size ||
      store._instanceEmbeddings?.size ||
      store._instanceCategoryEmbeddings?.size)
  ) {
    lost.push("the identities, categories or embeddings of its instances");
  }
  const annotations: IdentityBearing[] = [];
  for (const [byFrame, undistributed] of [
    [store._centroidByFrame, store._undistributedCentroids],
    [store._bboxByFrame, store._undistributedBboxes],
    [store._maskByFrame, store._undistributedMasks],
    [store._roiByFrame, store._undistributedRois],
  ] as Array<[Map<string, IdentityBearing[]>, IdentityBearing[]]>) {
    annotations.push(...undistributed, ...[...byFrame.values()].flat());
  }
  if (!writesLinks && annotations.some(annotationLinkLoss)) {
    lost.push(
      "the identities, category scores or embeddings of its centroids, " +
        "boxes, masks or ROIs",
    );
  }
  if (store.sourceSessionCount > 0 && !header.sessions) {
    lost.push("its recording sessions");
  }
  if (lost.length > 0) {
    throw new Error(
      // (A format 3.0 writer writes the links and embeddings itself.)
      `The labels loaded from '${source.labelsPath}' (SLP format ` +
        `${Number.isInteger(source.formatId) ? source.formatId.toFixed(1) : source.formatId}) hold ${lost.join(", ")}, which the streaming ` +
        "writer (appendStore, saveSlpMergedFromStores, saveSlpMergedToSink) " +
        "does not write. Save them with saveSlp or saveSlpToBytes, which " +
        "keep them, or pass the identities and sessions in the writer's " +
        "header.",
    );
  }
}

/**
 * What records about to be written hold that the 2.x layout cannot store,
 * split by where the records came from (see `model/source-mark.ts`).
 */
interface LegacyLosses {
  /** The source of a record loaded with `format3: "view"`, if any. */
  viewOnly: SlpSourceFormat | null;
  /** Unlabelled points of records loaded with `format3: "edit"`. */
  unlabeledEdit: number;
  /**
   * Unlabelled points of other records: not loaded from a 3.0 file, or loaded
   * to be kept in format 3.0 (`"keep"`).
   */
  unlabeledOwn: number;
  /** Metadata keys of those other records, per table. */
  metadataKeys: Array<[table: string, keys: string[]]>;
  /** Whether some record was loaded from a 3.0 file to be kept in 3.0. */
  keep: boolean;
}

/** Keep the tables that have keys. */
function tablesWithKeys(
  tables: Array<[string, string[]]>,
): Array<[string, string[]]> {
  return tables.filter(([, keys]) => keys.length > 0);
}

/**
 * Whether a record's mark leaves its content to the caller's 2.x rules: no
 * mark, or one of a file loaded to be kept in format 3.0 (when such a record
 * is written in the 2.x layout, which only an explicit choice or a remembered
 * layout does, it follows the strict rules of the caller's own records).
 */
function ownContent(mark: SlpSourceFormat | undefined): boolean {
  return !mark || mark.access === "keep";
}

/** The {@link LegacyLosses} of materialized frames, record by record. */
function framesLegacyLosses(
  frames: Iterable<LabeledFrame>,
  staticRois: Iterable<object> = [],
): LegacyLosses {
  let viewOnly: SlpSourceFormat | null = null;
  let keep = false;
  let unlabeledEdit = 0;
  let unlabeledOwn = 0;
  const ownInstances: Instance[] = [];
  const ownFrames: LabeledFrame[] = [];
  const ownBoxes: BoundingBox[] = [];
  const markOf = (record: object): SlpSourceFormat | undefined => {
    const mark = sourceMarkOf(record);
    if (mark?.access === "view") viewOnly ??= mark;
    else if (mark?.access === "keep") keep = true;
    return mark;
  };
  // Static ROIs (not on any frame) are written too.
  for (const roi of staticRois) markOf(roi);
  for (const frame of frames) {
    if (ownContent(markOf(frame))) ownFrames.push(frame);
    for (const inst of frame.instances) {
      const mark = markOf(inst);
      if (mark?.access === "edit") unlabeledEdit += inst.nUnlabeled;
      else if (ownContent(mark)) {
        unlabeledOwn += inst.nUnlabeled;
        ownInstances.push(inst);
      }
    }
    for (const box of frame.bboxes) {
      if (ownContent(markOf(box))) ownBoxes.push(box);
    }
    for (const list of [
      frame.centroids,
      frame.masks,
      frame.labelImages,
      frame.rois,
    ] as object[][]) {
      for (const record of list) markOf(record);
    }
  }
  return {
    viewOnly,
    unlabeledEdit,
    unlabeledOwn,
    metadataKeys: tablesWithKeys([
      ["instances", metadataKeysOf(ownInstances)],
      ["frames", metadataKeysOf(ownFrames)],
      ["bboxes", metadataKeysOf(ownBoxes)],
    ]),
    keep,
  };
}

/**
 * Throw {@link SlpViewOnlyError} if any frame, instance or annotation in
 * `frames` was loaded with `format3: "view"`.
 */
function refuseViewOnlyRecords(
  frames: Iterable<LabeledFrame>,
  staticRois: Iterable<object> = [],
): void {
  const check = (record: object): void => {
    const mark = sourceMarkOf(record);
    if (mark?.access === "view") throw new SlpViewOnlyError(mark);
  };
  for (const roi of staticRois) check(roi);
  for (const frame of frames) {
    check(frame);
    for (const list of [
      frame.instances,
      frame.centroids,
      frame.bboxes,
      frame.masks,
      frame.labelImages,
      frame.rois,
    ] as object[][]) {
      for (const record of list) check(record);
    }
  }
}

/**
 * The {@link LegacyLosses} of a lazy store, read from its raw columns. The
 * store's source covers its pose rows; boxes are checked one by one.
 */
function storeLegacyLosses(store: LazyDataStore): LegacyLosses {
  let viewOnly: SlpSourceFormat | null =
    store.sourceFormat?.access === "view" ? store.sourceFormat : null;
  let keep = store.sourceFormat?.access === "keep";
  const ownBoxes: BoundingBox[] = [];
  const boxes: BoundingBox[] = [...store._undistributedBboxes];
  for (const list of store._bboxByFrame.values()) boxes.push(...list);
  for (const box of boxes) {
    const mark = sourceMarkOf(box);
    if (mark?.access === "view") viewOnly ??= mark;
    if (mark?.access === "keep") keep = true;
    if (ownContent(mark)) ownBoxes.push(box);
  }
  // The other annotations the lazy writers write from the store's maps.
  for (const [byFrame, undistributed] of [
    [store._centroidByFrame, store._undistributedCentroids],
    [store._maskByFrame, store._undistributedMasks],
    [store._roiByFrame, store._undistributedRois],
    [store._labelImageByFrame, store._undistributedLabelImages],
  ] as Array<[Map<string, object[]>, object[]]>) {
    for (const record of [...undistributed, ...[...byFrame.values()].flat()]) {
      const mark = sourceMarkOf(record);
      if (mark?.access === "view") viewOnly ??= mark;
      if (mark?.access === "keep") keep = true;
    }
  }
  const unlabeled =
    countUnlabeledPoints(store.pointsData) +
    countUnlabeledPoints(store.predPointsData);
  const edit = store.sourceFormat?.access === "edit";
  return {
    viewOnly,
    unlabeledEdit: edit ? unlabeled : 0,
    unlabeledOwn: edit ? 0 : unlabeled,
    metadataKeys: tablesWithKeys([
      ["instances", edit ? [] : metadataKeys(store.instanceMetadata)],
      ["frames", edit ? [] : metadataKeys(store.frameMetadata)],
      ["bboxes", metadataKeysOf(ownBoxes)],
    ]),
    keep,
  };
}

/**
 * Apply the 2.x layout's limits before a write, record by record:
 *
 * - a record loaded with `format3: "view"` throws {@link SlpViewOnlyError};
 * - records loaded with `format3: "edit"` have their unlabelled points written
 *   as absent and their metadata dropped without a word (the caller chose);
 * - other records follow Python sleap-io's `legacy_format=True`: unlabelled
 *   points throw unless `unlabeledAs` is `"absent"` (then a warning), and
 *   metadata is dropped with one warning naming the keys.
 *
 * An explicit `unlabeledAs: "error"` refuses unlabelled points of every
 * record. `warn: false` checks without warning (a dry run).
 *
 * @throws {SlpViewOnlyError} For a view-only record.
 * @throws {Error} For unlabelled points the mode refuses.
 */
function enforceLegacyLayout(
  losses: LegacyLosses,
  unlabeledAs: UnlabeledAs | undefined,
  options?: { warn?: boolean },
): void {
  if (losses.viewOnly) throw new SlpViewOnlyError(losses.viewOnly);
  checkUnlabeledAs(unlabeledAs);
  const own = losses.unlabeledOwn;
  const refused =
    unlabeledAs === "error"
      ? own + losses.unlabeledEdit
      : unlabeledAs === undefined
        ? own
        : 0;
  if (refused > 0) {
    throw new Error(
      `${refused} point(s) are unlabelled, but the SLP 2.x layout cannot ` +
        "store unlabelled points: they would read back as labelled hidden " +
        'points. Pass unlabeledAs: "absent" to save them as hidden points ' +
        'with no location, or slpVersion: "v3" to save them in format 3.0.',
    );
  }
  if (options?.warn === false) return;
  if (own > 0) {
    console.warn(
      `Saving ${own} unlabelled point(s) as hidden points with no location ` +
        "(labelled, not visible), since the SLP 2.x layout cannot store " +
        "unlabelled points.",
    );
  }
  if (losses.metadataKeys.length > 0) {
    const named = losses.metadataKeys
      .map(([table, keys]) => `${table}: ${keys.join(", ")}`)
      .join("; ");
    console.warn(
      "Instance, frame and bounding box metadata can't be stored in the SLP " +
        `2.x layout and was not saved (${named}).`,
    );
  }
}

/**
 * Throw {@link SlpViewOnlyError} for labels, or any record they hold, loaded
 * with `format3: "view"`.
 */
export function refuseViewOnlyLabels(labels: Labels): void {
  refuseViewOnly(labels);
  const store = labels._lazyDataStore;
  const losses =
    labels.isLazy && store
      ? storeLegacyLosses(store)
      : framesLegacyLosses(labels.labeledFrames, labels._staticRois);
  if (losses.viewOnly) throw new SlpViewOnlyError(losses.viewOnly);
}

/**
 * Check, without writing or warning, that `labels` can be saved with
 * `options`: not view-only (labels or any record); and, for the 2.x layout,
 * no unlabelled points the `unlabeledAs` mode refuses; for format 3.0, one
 * kind per metadata key. Lets a caller saving several files refuse them all
 * before writing any. `slpVersion` defaults to `"auto"`, decided without a
 * warning.
 *
 * @throws {SlpViewOnlyError} For view-only labels or records.
 * @throws {Error} For unlabelled points the mode refuses.
 * @throws {TypeError} For an invalid `slpVersion`, or (format 3.0) a metadata
 *   key that mixes kinds.
 */
export function checkSlpSavable(
  labels: Labels,
  options?: { unlabeledAs?: UnlabeledAs; slpVersion?: SlpVersion },
): void {
  refuseViewOnly(labels);
  const layout = resolveSlpVersion(
    labels,
    checkSlpVersion(options?.slpVersion),
    {
      warn: false,
    },
  );
  const store = labels._lazyDataStore;
  const losses =
    labels.isLazy && store
      ? storeLegacyLosses(store)
      : framesLegacyLosses(labels.labeledFrames, labels._staticRois);
  if (layout === "v3") {
    enforceV3Layout(losses, options?.unlabeledAs);
    if (!labels.isLazy) checkV3Metadata(labels.labeledFrames);
    return;
  }
  enforceLegacyLayout(losses, options?.unlabeledAs, { warn: false });
}

// ===========================================================================
// Which layout a save writes (`slpVersion`)
//
// "auto" writes the 2.x layout unless the labels need format 3.0, as Python
// sleap-io's `resolve_slp_version` (see `resolveSlpVersion`). The decision is
// made once, before anything is written, from the eager labels or the lazy
// store's raw tables; every table writer then follows it.
// ===========================================================================

/** What the "auto" rule looks at in one set of labels (or a lazy store). */
interface LayoutFacts {
  /** The layout the labels were last saved in, if remembered. */
  remembered: SlpLayout | null;
  /** The labels were loaded from a 3.0 file with `format3: "edit"`. */
  editChoice: boolean;
  /** Some content was loaded from a 3.0 file to be kept in format 3.0. */
  keep: boolean;
  /** What only format 3.0 can store, outside content loaded for editing. */
  reasons: string[];
}

/** Describe what in `losses` only format 3.0 can store. */
function contentReasons(
  losses: LegacyLosses,
  carriedTables: readonly string[],
): string[] {
  const reasons: string[] = [];
  if (losses.unlabeledOwn > 0) {
    reasons.push(`${losses.unlabeledOwn} point(s) marked as not labelled`);
  }
  if (losses.metadataKeys.length > 0) {
    const named = losses.metadataKeys
      .map(([table, keys]) => `${table}: ${keys.join(", ")}`)
      .join("; ");
    reasons.push(`metadata on instances, frames or bounding boxes (${named})`);
  }
  if (carriedTables.length > 0) {
    reasons.push(
      `unknown columns kept from a newer file (${carriedTables.join(", ")})`,
    );
  }
  return reasons;
}

/** Whether a recording session's frame or instance group is kept in 3.0. */
function sessionsKeep(sessions: Iterable<RecordingSession>): boolean {
  for (const record of sessionRecords(sessions)) {
    if (sourceMarkOf(record)?.access === "keep") return true;
  }
  return false;
}

/** The {@link LayoutFacts} of eager or lazy labels. */
function labelsLayoutFacts(labels: Labels): LayoutFacts {
  const store = labels.isLazy ? labels._lazyDataStore : null;
  const losses = store
    ? storeLegacyLosses(store)
    : framesLegacyLosses(labels.labeledFrames, labels._staticRois);
  const carried = [
    ...carriedNotEdited(labels._carriedColumns),
    ...(store && store.sourceFormat?.access !== "edit"
      ? storeCarriedTables(store)
      : []),
  ];
  const access = labels.sourceFormat?.access ?? store?.sourceFormat?.access;
  return {
    remembered: labels._slpLayout ?? null,
    editChoice: access === "edit",
    keep: access === "keep" || losses.keep || sessionsKeep(labels.sessions),
    reasons: contentReasons(losses, carried),
  };
}

/**
 * The tables of a carry with unknown columns, as paths, except those whose
 * records were loaded with `format3: "edit"` (which chose to drop them).
 */
function carriedNotEdited(carry: ColumnCarry | null | undefined): string[] {
  if (!carry) return [];
  const out: string[] = [];
  for (const [table, carried] of carry.tables) {
    const owner = carried.owners
      ?.flat()
      .find((o): o is object => typeof o === "object" && o !== null);
    if (owner && sourceMarkOf(owner)?.access === "edit") continue;
    out.push(`/${table}`);
  }
  return out;
}

/** The tables of a lazy store with unknown columns, as paths. */
function storeCarriedTables(store: LazyDataStore): string[] {
  return [
    ...Object.entries(store.unknownColumns ?? {})
      .filter(([, columns]) => Object.keys(columns ?? {}).length > 0)
      .map(([table]) => `/${table}`),
    ...(store.annotationCarry?.tablePaths() ?? []),
  ];
}

/** The {@link LayoutFacts} of a lazy store given to a streaming writer. */
function storeLayoutFacts(store: LazyDataStore): LayoutFacts {
  const losses = storeLegacyLosses(store);
  return {
    remembered: null,
    editChoice: store.sourceFormat?.access === "edit",
    keep: losses.keep,
    reasons: contentReasons(losses, storeCarriedTables(store)),
  };
}

/** The {@link LayoutFacts} of frames given to a streaming writer. */
function framesLayoutFacts(frames: Iterable<LabeledFrame>): LayoutFacts {
  const losses = framesLegacyLosses(frames);
  return {
    remembered: null,
    editChoice: false,
    keep: losses.keep,
    reasons: contentReasons(losses, []),
  };
}

/**
 * Decide the layout of a save from the facts of every set of labels written
 * together (see {@link resolveSlpVersion}), warning once when "auto" picks
 * format 3.0 because of content.
 */
function decideLayout(
  facts: readonly LayoutFacts[],
  slpVersion: unknown,
  warn = true,
): SlpLayout {
  const version = checkSlpVersion(slpVersion);
  if (version !== "auto") return version;
  // Per set of labels: "v3" (a format 3.0 file, which keeps its layout),
  // "edit" (the caller chose the 2.x layout for it) or "content".
  const kinds = facts.map((f) =>
    f.remembered === "v3"
      ? "v3"
      : f.editChoice
        ? "edit"
        : f.keep && f.remembered !== "v2"
          ? "v3"
          : "content",
  );
  if (kinds.length > 0 && kinds.every((k) => k === "v3")) return "v3";
  if (
    getV3Defaults() &&
    !(kinds.length > 0 && kinds.every((k) => k === "edit"))
  ) {
    return "v3";
  }
  if (kinds.some((k) => k === "v3")) {
    // Files written together share a layout, so the others change layout.
    if (warn) {
      console.warn(
        "Saving these files in SLP format 3.0, which SLEAP and sleap-io < 0.10 " +
          "cannot open, because some of them come from format 3.0 files and " +
          'files written together share one layout. Pass slpVersion: "v2" ' +
          "to write the 2.x layout instead.",
      );
    }
    return "v3";
  }
  const reasons: string[] = [];
  facts.forEach((f, i) => {
    if (kinds[i] === "edit") return;
    for (const reason of f.reasons) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  });
  if (reasons.length === 0) return "v2";
  if (warn) {
    console.warn(
      "Saving in SLP format 3.0, which SLEAP and sleap-io < 0.10 cannot open, " +
        `because the 2.x layout cannot store: ${reasons.join("; ")}. Pass ` +
        'slpVersion: "v3" to choose format 3.0 without this warning, or ' +
        'slpVersion: "v2" to write the 2.x layout, which drops that content ' +
        "or refuses it.",
    );
  }
  return "v3";
}

/**
 * Decide the SLP layout of a save: `"v2"` (the 2.x layout) or `"v3"` (format
 * 3.0), as every SLP writer does before it writes anything.
 *
 * With `slpVersion: "auto"` (the default of every writer), the layout is:
 *
 * 1. the layout the labels were last saved in, when that was format 3.0;
 * 2. the 2.x layout for labels loaded from a 3.0 file with `format3: "edit"`
 *    (the caller chose to save that layout and drop what it cannot store);
 * 3. format 3.0 when the format 3.0 defaults are on ({@link setV3Defaults});
 * 4. format 3.0 when the labels, or any of their records, were loaded from a
 *    3.0 file without `"edit"`, so a file never changes layout silently
 *    (copies, extracts and materialized labels keep this) — unless the labels
 *    were since saved in the 2.x layout;
 * 5. format 3.0 when the labels hold what only format 3.0 can store: points
 *    marked as not labelled, metadata on instances, frames or bounding boxes,
 *    or unknown columns kept from a newer file. This warns once
 *    (`console.warn`), naming the content;
 * 6. the 2.x layout otherwise.
 *
 * Several files written together share one layout: format 3.0 if any of them
 * needs it. Pass all their labels to decide them together.
 *
 * @param labels The labels of one file, or of every file written together.
 * @param slpVersion `"auto"`, `"v2"` or `"v3"`; `"v2"` and `"v3"` are
 *   returned as they are.
 * @param options.warn Warn when `"auto"` picks format 3.0 because of content
 *   (default `true`).
 * @throws {TypeError} If `slpVersion` is not one of the three values.
 */
export function resolveSlpVersion(
  labels: Labels | Iterable<Labels>,
  slpVersion: SlpVersion = "auto",
  options?: { warn?: boolean },
): SlpLayout {
  const list = labels instanceof Labels ? [labels] : [...labels];
  return decideLayout(
    list.map(labelsLayoutFacts),
    slpVersion,
    options?.warn ?? true,
  );
}

/**
 * Refuse records loaded with `format3: "view"` before a format 3.0 write, and
 * check the `unlabeledAs` value (ignored by format 3.0, which stores
 * unlabelled points).
 */
function enforceV3Layout(
  losses: LegacyLosses,
  unlabeledAs: UnlabeledAs | undefined,
): void {
  if (losses.viewOnly) throw new SlpViewOnlyError(losses.viewOnly);
  checkUnlabeledAs(unlabeledAs);
}

/**
 * Warn that a 2.x save of a lazy store drops its unknown columns (unless it
 * was loaded with `format3: "edit"`, which chose to drop them).
 */
function dropCarryForV2(store: LazyDataStore): void {
  if (store.sourceFormat?.access === "edit") return;
  const tables: Array<[string, Record<string, unknown>]> = Object.entries(
    store.unknownColumns ?? {},
  ).filter(([, columns]) => Object.keys(columns ?? {}).length > 0) as Array<
    [string, Record<string, unknown>]
  >;
  for (const [table, columns] of tables) {
    console.warn(
      `Unknown column(s) ${Object.keys(columns).join(", ")} of /${table} ` +
        "were not saved: the SLP 2.x layout cannot store them.",
    );
  }
  warnDroppedCarry(store.annotationCarry);
}

/** Refuse an `unlabeledAs` value that is not `"error"` or `"absent"`. */
function checkUnlabeledAs(unlabeledAs: unknown): void {
  if (
    unlabeledAs !== undefined &&
    unlabeledAs !== "error" &&
    unlabeledAs !== "absent"
  ) {
    throw new Error(
      `unlabeledAs must be "error" or "absent", got ${JSON.stringify(unlabeledAs)}.`,
    );
  }
}

/**
 * A point table's columns with unlabelled points (`labeled` and `visible` both
 * false) given NaN coordinates, as the 2.x layout stores them. Returns the
 * table itself when it has none.
 */
function absentPointColumns(
  // biome-ignore lint/suspicious/noExplicitAny: lazy store column type
  columns: Record<string, any>,
  // biome-ignore lint/suspicious/noExplicitAny: lazy store column type
): Record<string, any> {
  if (countUnlabeledPoints(columns) === 0) return columns;
  const labeled = columns.labeled as ArrayLike<number>;
  const visible = (columns.visible ?? []) as ArrayLike<number>;
  const x = Array.from(columns.x as ArrayLike<number>, Number);
  const y = Array.from(columns.y as ArrayLike<number>, Number);
  for (let i = 0; i < labeled.length; i += 1) {
    if (!Number(labeled[i]) && !Number(visible[i])) {
      x[i] = Number.NaN;
      y[i] = Number.NaN;
    }
  }
  return { ...columns, x, y };
}

/** Report progress; throw {@link ExportCancelled} if the callback says stop. */
function reportProgress(
  report: SlpWriteOptions["onProgress"],
  current: number,
  total: number,
  message: string,
): void {
  if (report?.(current, total, message) === false) throw new ExportCancelled();
}

/**
 * A planned embedded video output: copy raw blobs, or (legacy) encode.
 *
 * `kind: "raw"` copies an already-embedded video's stored encoded blobs verbatim
 * via `getFrameBuffer` (no decode / re-encode) — the fast, lossless path that
 * mirrors Python's re-save of a `.pkg.slp`. `kind: "encode"` is the new-embed
 * of a continuous video: read each selected frame via `getFrame`, then store its
 * bytes directly (`frameToBytes`) when the backend already returns encoded bytes,
 * or PNG-encode it when the backend returns raw pixels (an `ImageBitmap` /
 * `ImageData` — the MediaBunny / Mp4Box mp4 case). With an explicit
 * `imageFormat`, "encode" follows that format's rules instead (see
 * `encodeFrameAs` in embed-format.ts). Works in both browser and Node.
 */
type EmbedPlanEntry = {
  kind: "raw" | "encode";
  videoIndex: number;
  video: Video;
  frameNumbers: number[]; // source frame numbers to write, in order
  format: string;
  channelOrder: string;
  /** For "encode" with an explicit `imageFormat`: the encoder settings. */
  encoding?: EmbedEncoding;
  /** For "encode": pre-collected bytes keyed by frame number. */
  frameData?: Map<number, Uint8Array>;
};
type EmbedPlan = Map<number, EmbedPlanEntry>;

/** True for a video whose stored encoded blobs we can copy verbatim. */
function isRawCopyable(video: Video): boolean {
  return !!(video.hasEmbeddedImages && video.backend?.getFrameBuffer);
}

function writeSlpToFile(
  file: any,
  labels: Labels,
  plan?: EmbedPlan | null,
  layout: SlpLayout = "v2",
): void {
  const v3: V3Write | null =
    layout === "v3"
      ? { carry: new CarrySession(labels._carriedColumns) }
      : null;
  writeMetadata(file, labels, layout);

  if (plan && plan.size > 0) {
    writeEmbeddedVideosJson(file, labels, plan);
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
    v3,
  );
  if (v3) {
    writePoseTablesV3(file, labels, v3.carry);
  } else {
    writeLabeledFrames(file, labels);
    writeNegativeFrames(file, labels);
  }
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

  writeRois(
    file,
    allRois,
    labels.videos,
    labels.tracks,
    allInstances,
    roiCtx,
    v3,
  );
  writeMasks(
    file,
    allMasks,
    labels.videos,
    labels.tracks,
    allInstances,
    maskCtx,
    v3,
  );
  writeBboxes(
    file,
    allBboxes,
    labels.videos,
    labels.tracks,
    allInstances,
    bboxCtx,
    v3,
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
    v3,
  );

  // Per-detection re-ID identity (SLP 2.5): /identity/links + /embeddings. The flat
  // per-modality lists above are in the SAME global order the modality datasets were
  // written, so a detection's array index == its owner_id (matching Python).
  const detections: DetectionCollections = {
    instance: allInstances,
    centroid: allCentroids,
    mask: allMasks,
    bbox: allBboxes,
    roi: allRois,
  };
  writeIdentityLinks(file, labels.identities, detections, v3);
  writeCategoryLinks(file, detections, v3);
  writeEmbeddings(file, detections);
  v3?.carry.finish();
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
 * Rebuild row-major `number[][]` from a lazy store's parsed column data
 * (`Record<string, any[]>`, from the HDF5 reader), so the pose datasets can be
 * written with the same helpers the eager writer uses ({@link createMatrixDataset}
 * / {@link createCompoundDataset}) for byte-identical output.
 *
 * TODO: a column-aware fast path could avoid the row rebuild entirely.
 */
function lazyColumnsToRows(
  columns: Record<string, any[]>,
  fieldNames: string[],
): number[][] {
  const rowCount = (columns[fieldNames[0]] ?? []).length;
  const colCount = fieldNames.length;
  const rows: number[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const row = new Array<number>(colCount);
    for (let j = 0; j < colCount; j++) {
      const v = (columns[fieldNames[j]] ?? [])[i];
      row[j] = v === undefined || v === null ? 0 : Number(v);
    }
    rows.push(row);
  }
  return rows;
}

function writeLazyMatrixDataset(
  file: any,
  name: string,
  columns: Record<string, any[]>,
  fieldNames: string[],
  dtype: string,
): void {
  // resizable=true: the lazy fast-path writer's label tables must also be
  // in-place-editable on re-save (matches the eager writer). Only `frames` (a
  // flat int matrix) uses this now; the pose tables go through
  // writeLazyCompoundDataset.
  createMatrixDataset(
    file,
    name,
    lazyColumnsToRows(columns, fieldNames),
    fieldNames,
    dtype,
    true,
  );
}

/** Lazy-store analog of {@link createCompoundDataset}: columns → compound. */
function writeLazyCompoundDataset(
  file: any,
  name: string,
  columns: Record<string, any[]>,
  fields: CompoundField[],
): void {
  const fieldNames = fields.map(([fieldName]) => fieldName);
  createCompoundDataset(
    file,
    name,
    lazyColumnsToRows(columns, fieldNames),
    fields,
  );
}

function writeLazyFramesAndInstances(file: any, store: LazyDataStore): void {
  writeLazyMatrixDataset(
    file,
    "frames",
    store.framesData,
    ["frame_id", "video", "frame_idx", "instance_id_start", "instance_id_end"],
    "<i8",
  );
  writeLazyCompoundDataset(
    file,
    "instances",
    store.instancesData,
    INSTANCE_COMPOUND_FIELDS,
  );
  // Unlabelled points (format 3.0) are written as absent: the caller has
  // already been through enforceLegacyLayout.
  writeLazyCompoundDataset(
    file,
    "points",
    absentPointColumns(store.pointsData),
    POINT_COMPOUND_FIELDS,
  );
  writeLazyCompoundDataset(
    file,
    "pred_points",
    absentPointColumns(store.predPointsData),
    PRED_POINT_COMPOUND_FIELDS,
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
  createCompoundDataset(
    file,
    "negative_frames",
    rows,
    NEGATIVE_FRAME_COMPOUND_FIELDS,
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
function writeSlpToFileLazy(
  file: any,
  labels: Labels,
  layout: SlpLayout = "v2",
): void {
  const store = labels._lazyDataStore;
  if (!labels.isLazy || !store) {
    throw new Error(
      "writeSlpToFileLazy requires lazy Labels with a data store",
    );
  }
  // The pose tables' unknown columns are written from the store; the other
  // tables' while the store's annotations are the ones loaded.
  const v3: V3Write | null =
    layout === "v3" ? { carry: new CarrySession(store.annotationCarry) } : null;

  writeMetadata(file, labels, layout);
  writeVideos(file, labels.videos);
  writeVideoCrops(file, labels.videos);
  writeTracks(file, labels.tracks);
  writeSuggestions(file, labels.suggestions, labels.videos);
  writeIdentities(file, labels.identities);
  // Sessions: pass empty labeledFrames since they aren't materialized.
  // Frame-group refs resolved by lf index will be lost — matches Python.
  writeSessions(
    file,
    labels.sessions,
    labels.videos,
    [],
    labels.identities,
    v3,
  );

  if (v3) {
    writeLazyPoseTablesV3(file, store);
  } else {
    writeLazyFramesAndInstances(file, store);
    writeLazyNegativeFrames(file, store);
  }

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
  writeRois(file, allRois, labels.videos, labels.tracks, undefined, roiCtx, v3);
  writeMasks(file, allMasks, labels.videos, labels.tracks, [], maskCtx, v3);
  writeBboxes(file, allBboxes, labels.videos, labels.tracks, [], bboxCtx, v3);
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
    v3,
  );

  // Per-detection identity and category links (and embeddings), as the eager
  // writer writes them. The instances are the store's rows, written in order
  // above, so their links come from the store by row; the other detections
  // are objects, in the order their tables were just written.
  const detections: DetectionCollections = {
    instance: lazyInstanceDetections(store, labels.identities),
    centroid: allCentroids,
    mask: allMasks,
    bbox: allBboxes,
    roi: allRois,
  };
  writeIdentityLinks(file, labels.identities, detections, v3);
  writeCategoryLinks(file, detections, v3);
  writeEmbeddings(file, detections);
  v3?.carry.finish();
}

/**
 * The identity and category of each `/instances` row of a lazy store, as the
 * readers attach them when a frame materializes: one entry per row (empty for
 * rows without links), from the store's link and embedding maps.
 */
function lazyInstanceDetections(
  store: LazyDataStore,
  identities: Identity[],
): IdentityBearing[] {
  const rows = (store.instancesData.instance_type ?? []).length;
  const out: IdentityBearing[] = Array.from({ length: rows }, () => ({}));
  const catalog = store.identities ?? identities;
  for (const [row, [idx, score]] of store._instanceIdentityLinks ?? []) {
    const identity = catalog[idx];
    if (out[row] && identity) {
      out[row].identity = identity;
      out[row].identityScore = score;
    }
  }
  for (const [row, embedding] of store._instanceEmbeddings ?? []) {
    if (out[row]) out[row].identityEmbedding = embedding;
  }
  const categories = store.categoryCatalog ?? [];
  for (const [row, [idx, score]] of store._instanceCategoryLinks ?? []) {
    if (out[row] && idx >= 0 && idx < categories.length) {
      out[row].category = categories[idx];
      out[row].categoryScore = score;
    }
  }
  for (const [row, embedding] of store._instanceCategoryEmbeddings ?? []) {
    if (out[row]) out[row].categoryEmbedding = embedding;
  }
  return out;
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
 * - `"user"` - Embed only user-labeled frames ({@link Labels.userLabeledFrames}:
 *   user instances, negative frames, user centroids/boxes/masks/ROIs)
 * - `"suggestions"` - Embed only suggestion frames
 * - `"user+suggestions"` - Embed user-labeled frames and suggestion frames
 * - `"all+suggestions"` - Embed all labeled frames AND all suggestion frames
 * - `"source"` - Restore original video paths (no embedding)
 *
 * ALREADY-EMBEDDED videos (a `.pkg.slp` loaded with open backends) are ALWAYS
 * preserved: their full stored set of encoded image blobs is copied VERBATIM
 * (no decode/re-encode — see {@link writeRawEmbeddedVideo}), regardless of the
 * `embed` mode, UNLESS `embed:"source"` is passed to externalize them. So even
 * a bare `saveSlpToBytes(labels)` (no options) cannot silently drop embedded
 * images — the fix for the #213 re-save data loss. As a backstop, the raw-copy
 * path THROWS (rather than writing a stripped file) if it planned to copy N
 * frames but could read fewer than N blobs.
 */
// ===========================================================================
// Streaming / incremental SLP writer (issue #207)
//
// A write-side companion to `readSlpStreaming({ lazy })`: build an SLP file by
// appending pose frames/instances/points in bounded windows to *resizable* HDF5
// datasets (create-empty → `resize` + `write_slice` per window), rather than
// materializing the whole `Labels` graph or a full row matrix. Also supports
// MERGING N per-camera `LazyDataStore`s into one combined multi-video `.slp`,
// remapping video/instance/point/track ids as each store is appended — the
// downstream LUCID export path (one combined multi-camera file, memory-bounded).
//
// Scope (v1): pose tables only (frames/instances/points/pred_points) +
// negative_frames + all header metadata (videos/tracks/skeletons/suggestions/
// identities/sessions/provenance). Per-frame annotation overlays (masks/rois/
// bboxes/centroids/label-images), an edit overlay of corrected frames, and a
// `FileSystemWritableFileStream` sink are follow-ups.
// ===========================================================================

/** Frames per append window — bounds the per-window typed-array allocation. */
const DEFAULT_WRITE_WINDOW_FRAMES = 5000;
/** HDF5 chunk row count for the appendable pose datasets. */
const WRITE_CHUNK_ROWS = 8192;

const FRAMES_FIELDS = [
  "frame_id",
  "video",
  "frame_idx",
  "instance_id_start",
  "instance_id_end",
];
const INSTANCES_FIELDS = [
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
];
const POINTS_FIELDS = ["x", "y", "visible", "complete"];
const PRED_POINTS_FIELDS = ["x", "y", "visible", "complete", "score"];
const NEGATIVE_FRAMES_FIELDS = ["video_id", "frame_idx"];

/**
 * The `instances.skeleton` id for `instance`: its skeleton's index in the
 * skeletons being written. Throws when the skeleton isn't among them, like
 * Python sleap-io's `labels.skeletons.index(inst.skeleton)`. Writing id 0
 * instead (the old fallback) stored the instance's points against a skeleton
 * with a different node count — a file whose point spans don't match its
 * skeletons, which readers refuse (#230).
 */
function skeletonIdForWrite(
  skeletons: Skeleton[],
  instance: Instance | PredictedInstance,
  frame: LabeledFrame,
): number {
  const id = skeletons.indexOf(instance.skeleton);
  if (id >= 0) return id;
  const name = instance.skeleton.name ? ` "${instance.skeleton.name}"` : "";
  const video = frame.video?.filename;
  throw new Error(
    `Can't save: an instance in frame ${frame.frameIdx}` +
      `${typeof video === "string" ? ` of ${video}` : ""} uses skeleton${name} ` +
      `(${instance.skeleton.nodes.length} nodes), which isn't in the labels' ` +
      `skeletons. Add it to labels.skeletons, or add the frame with ` +
      `labels.append() so it's registered, before saving.`,
  );
}

/** Read a numeric column cell with a default (mirrors the lazy reader). */
function numAt(col: any[] | undefined, i: number, def = 0): number {
  const v = col?.[i];
  return v === undefined || v === null ? def : Number(v);
}

/**
 * Create an empty, row-resizable 2D dataset (`[0, cols]`, maxshape
 * `[null, cols]`, chunked) and stamp its `field_names` attribute — the
 * append-mode analog of {@link createMatrixDataset}.
 */
function createAppendableMatrixDataset(
  file: any,
  name: string,
  fieldNames: string[],
  dtype: string,
): void {
  const colCount = fieldNames.length;
  file.create_dataset({
    name,
    data: new Float64Array(0),
    shape: [0, colCount],
    maxshape: [null, colCount],
    chunks: [WRITE_CHUNK_ROWS, colCount],
    dtype,
  });
  setStringAttr(file.get(name), "field_names", JSON.stringify(fieldNames));
}

/** Resize a matrix dataset by `rowCount` rows and write `flat` into the tail. */
function appendMatrixRows(
  file: any,
  name: string,
  flat: Float64Array,
  rowCount: number,
  colCount: number,
  currentRows: number,
): void {
  if (rowCount === 0) return;
  const ds = file.get(name);
  ds.resize([currentRows + rowCount, colCount]);
  ds.write_slice(
    [
      [currentRows, currentRows + rowCount],
      [0, colCount],
    ],
    flat,
  );
}

/** The 3.0 column types of the pose tables, by table and column. */
function v3PoseColumnTypes(table: string): Array<[string, ColumnType]> {
  return table === "frames"
    ? V3_FRAME_COLUMNS
    : table === "instances"
      ? V3_INSTANCE_COLUMNS
      : table === "points"
        ? V3_POINT_COLUMNS
        : V3_PRED_POINT_COLUMNS;
}

/** Create a 3.0 pose table as empty, appendable (chunked) columns. */
function createAppendableColumnTable(file: any, table: string): void {
  ensureGroup(file, table);
  for (const [name, type] of v3PoseColumnTypes(table)) {
    const dtype = type === "f8" ? "<d" : type === "i8" ? "<q" : "<B";
    file.create_dataset({
      name: `${table}/${name}`,
      data: type === "i8" ? new BigInt64Array(0) : new Float64Array(0),
      shape: [0],
      maxshape: [null],
      chunks: [WRITE_CHUNK_ROWS],
      dtype,
    });
  }
}

/** Append `n` rows to the columns of a 3.0 pose table holding `current`. */
function appendColumnRows(
  file: any,
  table: string,
  current: number,
  n: number,
  columns: Record<string, ArrayLike<number>>,
): void {
  if (n === 0) return;
  for (const [name, type] of v3PoseColumnTypes(table)) {
    const ds = file.get(`${table}/${name}`);
    ds.resize([current + n]);
    const values = columns[name];
    const data =
      type === "i8"
        ? BigInt64Array.from(Array.from(values, (v) => BigInt(Math.trunc(v))))
        : type === "f8"
          ? Float64Array.from(values)
          : Uint8Array.from(values, (v) => (v ? 1 : 0));
    ds.write_slice([[current, current + n]], data);
  }
}

/** Push the `labeled` flag of each of `instance`'s node rows (format 3.0). */
function pushLabeled(
  target: number[],
  instance: Instance | PredictedInstance,
): void {
  const nNodes = instance.skeleton.nodeNames.length;
  const labeled = instance._labeled;
  for (let i = 0; i < nNodes; i++) {
    target.push(
      i < instance._n && labeled && !labeled[i] && !instance._visible[i]
        ? 0
        : 1,
    );
  }
}

/** Static header (everything except the pose frames) for {@link openSlpWriter}. */
export interface SlpWriteHeader {
  skeletons: Skeleton[];
  videos: Video[];
  tracks?: Track[];
  suggestions?: SuggestionFrame[];
  identities?: Identity[];
  sessions?: RecordingSession[];
  provenance?: Record<string, unknown>;
}

/** Per-store id offsets applied while appending (see {@link SlpStreamWriter.appendStore}). */
export interface AppendStoreOptions {
  /** Added to each frame's (remapped) video index. */
  videoIndexOffset?: number;
  /** Added to each instance's non-null track index. */
  trackOffset?: number;
  /** Added to each instance's skeleton index. */
  skeletonOffset?: number;
  /** Frames per append window (defaults to {@link DEFAULT_WRITE_WINDOW_FRAMES}). */
  windowFrames?: number;
  /**
   * How to write unlabelled points (see {@link UnlabeledAs}). Points of a
   * store loaded with `format3: "edit"` are written as absent unless this is
   * `"error"`; any other store's are refused unless this is `"absent"`.
   */
  unlabeledAs?: UnlabeledAs;
  /**
   * The layout this append may write, which must be the writer's (see
   * {@link openSlpWriter}): `"auto"` (the default) writes the writer's layout,
   * but a writer of the 2.x layout refuses a store loaded from a format 3.0
   * file to be kept in 3.0, so its layout never changes silently; `"v2"`
   * writes such a store in the 2.x layout anyway (unlabelled points follow
   * `unlabeledAs`, metadata is dropped with a warning); `"v3"` requires a
   * format 3.0 writer.
   */
  slpVersion?: SlpVersion;
}

/**
 * A chunked byte sink for {@link SlpStreamWriter.writeToSink} — the output-side
 * companion to the append writer. Satisfied by a browser
 * `FileSystemWritableFileStream` (OPFS / save-file-picker) and by Node's
 * `fs.WriteStream`, so the finished file need not be resident as one big
 * `Uint8Array`.
 */
export interface SlpWriteSink {
  write(chunk: Uint8Array): unknown | Promise<unknown>;
  close?(): unknown | Promise<unknown>;
}

/** Emscripten-FS methods used for chunked reads (present on h5wasm's `module.FS`). */
interface ChunkedFs {
  open?: (path: string, flags: string) => unknown;
  read?: (
    stream: unknown,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number;
  close?: (stream: unknown) => void;
  stat?: (path: string) => { size: number };
}

/** An annotation with the instance link the writers read via fallback. */
type AnnLinked = { instance: Instance | null; _instanceIdx: number | null };
/** Accumulated annotations of one type: objects + `[vid,frame]` ctx + global inst idx. */
interface AnnBucket<T> {
  anns: T[];
  ctx: [number, number][];
  inst: number[];
}
function newAnnBucket<T>(): AnnBucket<T> {
  return { anns: [], ctx: [], inst: [] };
}

/**
 * Incremental SLP writer. Open with {@link openSlpWriter} (which writes the
 * header and creates the resizable pose datasets), append one or more
 * {@link LazyDataStore}s with {@link appendStore}, then {@link close} to get the
 * file bytes. Ids are rebased per store so multiple stores concatenate into one
 * consistent multi-video file.
 */
export class SlpStreamWriter {
  private file: any;
  private module: any;
  private memPath: string;
  private videos: Video[];
  private skeletons: Skeleton[];
  private tracks: Track[];
  private frameRows = 0;
  private instRows = 0;
  private pointRows = 0;
  private predPointRows = 0;
  private negativeFrames = new Set<string>();
  private closed = false;
  /** The layout of the file, decided at open. */
  readonly layout: SlpLayout;
  /** Format 3.0: metadata of frame and instance rows, by output row. */
  private frameMeta = new Map<number, RecordMetadata>();
  private instanceMeta = new Map<number, RecordMetadata>();
  private metaKinds = {
    instances: new Map<string, MetadataKind>(),
    frames: new Map<string, MetadataKind>(),
    bboxes: new Map<string, MetadataKind>(),
  };
  /** The header labels, which remember the layout once the file is done. */
  private headerLabels: Labels | null = null;
  /** The identity catalog written in the header. */
  private identities: Identity[] = [];
  /**
   * Format 3.0: the identity and category of each output instance row that
   * has any (links and embeddings are written at finalize).
   */
  private instanceDetections = new Map<number, IdentityBearing>();
  // Combined `${videoIndex}:${frameIdx}` keys already written, for dedup across
  // appendStore/appendFrames. First write wins: a later append that repeats a
  // key skips that frame entirely. Append overlays (appendFrames) BEFORE bulk
  // stores so the overlay's frame is the one kept. See #208 follow-up.
  private writtenFrames = new Set<string>();
  // Per-frame annotations (masks/rois/bboxes/centroids/label-images) accumulated
  // across appends and written once at finalize — they're far fewer than pose
  // points, so they are not windowed. `ctx` is `[videoIndex, frameIdx]`; `inst`
  // is the resolved GLOBAL instance index (or -1) for the annotation's link.
  private pendingRois = newAnnBucket<ROI>();
  private pendingMasks = newAnnBucket<SegmentationMask>();
  private pendingBboxes = newAnnBucket<BoundingBox>();
  private pendingCentroids = newAnnBucket<Centroid>();
  // Label images carry instance links PER OBJECT (not on the top-level object),
  // so only their video/frame context is remapped here; each object's
  // `_instanceIdx` passes through (correct single-store; may be off in a
  // multi-store merge — a niche edge, tracked on #207).
  private pendingLabelImages: {
    anns: LabelImage[];
    ctx: [number, number][];
  } = { anns: [], ctx: [] };

  /** @internal — use {@link openSlpWriter}. */
  constructor(
    module: any,
    file: any,
    memPath: string,
    header: {
      videos: Video[];
      skeletons: Skeleton[];
      tracks: Track[];
      identities?: Identity[];
      sessions?: RecordingSession[];
    },
    layout: SlpLayout = "v2",
    headerLabels: Labels | null = null,
  ) {
    this.module = module;
    this.file = file;
    this.memPath = memPath;
    this.videos = header.videos;
    this.skeletons = header.skeletons;
    this.tracks = header.tracks;
    this.headerHas = {
      identities: (header.identities ?? []).length > 0,
      sessions: (header.sessions ?? []).length > 0,
    };
    this.identities = header.identities ?? [];
    this.layout = layout;
    this.headerLabels = headerLabels;
  }

  /**
   * Check, before anything of an append is written, that its content may go
   * into this writer's layout (see {@link AppendStoreOptions.slpVersion}).
   */
  private checkAppendLayout(
    slpVersion: unknown,
    facts: LayoutFacts,
  ): "v2" | "v3" {
    const version = checkSlpVersion(slpVersion);
    if (version !== "auto" && version !== this.layout) {
      throw new Error(
        `This writer writes ${this.layout === "v3" ? "SLP format 3.0" : "the SLP 2.x layout"}, ` +
          `so it cannot append with slpVersion: "${version}". Open it with ` +
          `slpVersion: "${version}" instead.`,
      );
    }
    if (
      version === "auto" &&
      this.layout === "v2" &&
      facts.keep &&
      !facts.editChoice
    ) {
      throw new Error(
        "This content was loaded from an SLP format 3.0 file, but this writer " +
          "writes the SLP 2.x layout, which would change its layout. Open the " +
          'writer with slpVersion: "v3" to keep format 3.0, or append with ' +
          'slpVersion: "v2" to write the 2.x layout.',
      );
    }
    return this.layout;
  }

  /** Format 3.0: remember metadata kinds read from a source. */
  private noteKinds(mark: SlpSourceFormat | null | undefined): void {
    const kinds = mark?.metadataKinds;
    if (!kinds) return;
    for (const table of ["instances", "frames", "bboxes"] as const) {
      for (const [key, kind] of Object.entries(kinds[table])) {
        if (this.metaKinds[table].get(key) !== "float") {
          this.metaKinds[table].set(key, kind);
        }
      }
    }
  }

  /**
   * Append rows to the pose tables, from row-major buffers in the 2.x column
   * order (frames: id, video, frame_idx, start, end; instances: the 10
   * columns of `INSTANCES_FIELDS`; points: x, y, visible, complete[, score]).
   * Format 3.0 drops the id columns and takes `is_negative` per frame and
   * `labeled` per point.
   */
  private appendPoseRows(
    frames: Float64Array,
    instances: Float64Array,
    userPoints: Float64Array,
    predPoints: Float64Array,
    v3?: { isNegative: number[]; userLabeled: number[]; predLabeled: number[] },
  ): void {
    const nF = frames.length / 5;
    const nI = instances.length / 10;
    const nU = userPoints.length / 4;
    const nP = predPoints.length / 5;
    if (this.layout === "v2" || !v3) {
      appendMatrixRows(this.file, "frames", frames, nF, 5, this.frameRows);
      appendMatrixRows(
        this.file,
        "instances",
        instances,
        nI,
        10,
        this.instRows,
      );
      appendMatrixRows(this.file, "points", userPoints, nU, 4, this.pointRows);
      appendMatrixRows(
        this.file,
        "pred_points",
        predPoints,
        nP,
        5,
        this.predPointRows,
      );
    } else {
      const pick = (flat: Float64Array, width: number, j: number) => {
        const n = flat.length / width;
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) out[i] = flat[i * width + j];
        return out;
      };
      appendColumnRows(this.file, "frames", this.frameRows, nF, {
        video: pick(frames, 5, 1),
        frame_idx: pick(frames, 5, 2),
        instance_id_start: pick(frames, 5, 3),
        instance_id_end: pick(frames, 5, 4),
        is_negative: v3.isNegative,
      });
      appendColumnRows(this.file, "instances", this.instRows, nI, {
        instance_type: pick(instances, 10, 1),
        frame_id: pick(instances, 10, 2),
        skeleton: pick(instances, 10, 3),
        track: pick(instances, 10, 4),
        from_predicted: pick(instances, 10, 5),
        score: pick(instances, 10, 6),
        point_id_start: pick(instances, 10, 7),
        point_id_end: pick(instances, 10, 8),
        tracking_score: pick(instances, 10, 9),
      });
      appendColumnRows(this.file, "points", this.pointRows, nU, {
        x: pick(userPoints, 4, 0),
        y: pick(userPoints, 4, 1),
        visible: pick(userPoints, 4, 2),
        verified: pick(userPoints, 4, 3),
        labeled: v3.userLabeled,
      });
      appendColumnRows(this.file, "pred_points", this.predPointRows, nP, {
        x: pick(predPoints, 5, 0),
        y: pick(predPoints, 5, 1),
        visible: pick(predPoints, 5, 2),
        verified: pick(predPoints, 5, 3),
        labeled: v3.predLabeled,
        score: pick(predPoints, 5, 4),
      });
    }
    this.frameRows += nF;
    this.instRows += nI;
    this.pointRows += nU;
    this.predPointRows += nP;
  }

  /** Whether the header written at open holds identities and sessions. */
  private headerHas: { identities: boolean; sessions: boolean };

  /**
   * Append every frame of `store` (in windows), rebasing its ids onto the
   * running file so the store's videos/instances/points/tracks land at the
   * offsets given in `opts`. Point coordinates and all per-instance fields are
   * copied verbatim from the store's columns — no `Instance`/`LabeledFrame`
   * object is constructed. The store's frame/instance/point tables are assumed
   * ordered by frame (the SLP on-disk invariant).
   *
   * A `(video, frameIdx)` already written (by an earlier append) is SKIPPED — so
   * append overlays via {@link appendFrames} first for them to win. Frame /
   * instance / point ids are assigned from running OUTPUT counters (not the
   * store's positions), so skips leave no gaps; cross-references
   * (`from_predicted`, annotation instance links) are remapped through the
   * skipped ranges. `store` must not itself contain duplicate `(video, frameIdx)`.
   */
  appendStore(store: LazyDataStore, opts?: AppendStoreOptions): void {
    if (this.closed) throw new Error("SlpStreamWriter is closed");
    // Before any row is written: a view-only store is refused, the layout is
    // checked, and (2.x layout) unlabelled points are refused or written as
    // absent.
    refuseViewOnly(store);
    const v3 =
      this.checkAppendLayout(opts?.slpVersion, storeLayoutFacts(store)) ===
      "v3";
    // A format 3.0 file writes the links and embeddings of the store's
    // instances and annotations; either layout writes only the identities
    // and sessions of the header.
    refuseFormat3StoreLosses(store, this.headerHas, v3);
    // Format 3.0: the identities and categories of the store's instances, by
    // store row, kept by output row as the rows are written.
    const storeDetections = v3
      ? lazyInstanceDetections(store, this.identities)
      : null;
    if (v3) {
      enforceV3Layout(storeLegacyLosses(store), opts?.unlabeledAs);
      this.noteKinds(store.sourceFormat);
    } else {
      enforceLegacyLayout(storeLegacyLosses(store), opts?.unlabeledAs);
    }
    if (storeCarriedTables(store).length > 0) {
      console.warn(
        `Unknown columns (${storeCarriedTables(store).join(", ")}) were not ` +
          "saved: the streaming writer rebuilds the tables they belong to.",
      );
    }
    const windowFrames = opts?.windowFrames ?? DEFAULT_WRITE_WINDOW_FRAMES;
    const vOff = opts?.videoIndexOffset ?? 0;
    const tOff = opts?.trackOffset ?? 0;
    const kOff = opts?.skeletonOffset ?? 0;

    const fd = store.framesData;
    const idn = store.instancesData;
    const nFrames = (fd.frame_id ?? fd.video ?? []).length;
    if (nFrames === 0) return;

    // Remap this store's raw `frames.video` ids to its own video indices (#204)
    // before offsetting into the combined `videos` array.
    const videoIdMap = buildVideoIdMap(fd, store.videos);
    const remapVideo = (raw: number) => vOff + (videoIdMap.get(raw) ?? raw);

    // Per-store OUTPUT bases: the first output row/instance/point this store
    // contributes. Ids are `base + <running output counter>`, so skipped frames
    // leave no gaps.
    const frameBase = this.frameRows;
    const instBase = this.instRows;
    const pointBase = this.pointRows;
    const predBase = this.predPointRows;

    // Unlabelled points (format 3.0) get NaN coordinates: written as absent.
    const userPoints = absentPointColumns(store.pointsData);
    const predPoints = absentPointColumns(store.predPointsData);
    const px = userPoints.x,
      py = userPoints.y,
      pv = userPoints.visible,
      pc = userPoints.complete;
    const qx = predPoints.x,
      qy = predPoints.y,
      qv = predPoints.visible,
      qc = predPoints.complete,
      qs = predPoints.score;
    // Format 3.0: `labeled` (default true) per point.
    const pl = store.pointsData.labeled;
    const ql = store.predPointsData.labeled;
    const labeledAt = (col: any, vis: any, p: number) =>
      !col || Number(col[p]) || numAt(vis, p) ? 1 : 0;

    // Pre-pass: the instance ranges of frames that will be SKIPPED (their
    // `(video, frameIdx)` was already written). Sorted by construction (frames
    // are in order). `outIdxOf` maps a store instance index to its output
    // position — identity when nothing is skipped, so the no-overlap path is
    // unchanged — or `null` when that instance falls in a skipped frame.
    const skippedRanges: Array<[number, number]> = [];
    const skippedKeys = new Set<string>();
    const skipRows = hasSkippedInstanceRows(idn);
    for (let r = 0; r < nFrames; r++) {
      const key = `${remapVideo(numAt(fd.video, r))}:${numAt(fd.frame_idx, r)}`;
      const iStart = numAt(fd.instance_id_start, r);
      const iEnd = numAt(fd.instance_id_end, r);
      if (this.writtenFrames.has(key)) {
        skippedRanges.push([iStart, iEnd]);
        skippedKeys.add(key);
      } else if (skipRows) {
        // 3.0 rows of another instance type, which the readers skip too.
        for (let j = iStart; j < iEnd; j++) {
          if (skipsInstanceRow(idn, j)) skippedRanges.push([j, j + 1]);
        }
      }
    }
    const outIdxOf = (idx: number): number | null => {
      if (skippedRanges.length === 0) return idx;
      let shift = 0;
      for (const [s, e] of skippedRanges) {
        if (idx < s) break; // ranges sorted; the rest are past idx
        if (idx < e) return null; // idx is inside a skipped frame → dangling
        shift += e - s;
      }
      return idx - shift;
    };

    // Running OUTPUT counters for this store (across all its windows): emitted
    // frames, instances, and re-packed user / predicted points.
    let outFrames = 0;
    let outInsts = 0;
    let userWritten = 0;
    let predWritten = 0;

    try {
      for (let wStart = 0; wStart < nFrames; wStart += windowFrames) {
        const wEnd = Math.min(wStart + windowFrames, nFrames);
        const wFrames = wEnd - wStart;

        // Pass 1: size the window's buffers at max (skips only shrink usage; the
        // actually-filled slice is written below).
        let nInst = 0;
        let nUserPts = 0;
        let nPredPts = 0;
        for (let r = wStart; r < wEnd; r++) {
          const iStart = numAt(fd.instance_id_start, r);
          const iEnd = numAt(fd.instance_id_end, r);
          nInst += iEnd - iStart;
          for (let j = iStart; j < iEnd; j++) {
            const cnt =
              numAt(idn.point_id_end, j) - numAt(idn.point_id_start, j);
            if (numAt(idn.instance_type, j) === 1) nPredPts += cnt;
            else nUserPts += cnt;
          }
        }

        const framesFlat = new Float64Array(wFrames * 5);
        const instFlat = new Float64Array(nInst * 10);
        const userPtsFlat = new Float64Array(nUserPts * 4);
        const predPtsFlat = new Float64Array(nPredPts * 5);
        let fi = 0;
        let ii = 0;
        let upi = 0;
        let ppi = 0;
        const extra = v3
          ? {
              isNegative: [] as number[],
              userLabeled: [] as number[],
              predLabeled: [] as number[],
            }
          : undefined;

        // Pass 2: emit rows for non-skipped frames, assigning ids from the
        // running output counters.
        for (let r = wStart; r < wEnd; r++) {
          const combinedVideo = remapVideo(numAt(fd.video, r));
          const frameIdx = numAt(fd.frame_idx, r);
          const key = `${combinedVideo}:${frameIdx}`;
          const iStart = numAt(fd.instance_id_start, r);
          const iEnd = numAt(fd.instance_id_end, r);

          if (this.writtenFrames.has(key)) continue; // dedup: first write wins

          const newFrameId = frameBase + outFrames;
          outFrames++;
          framesFlat[fi++] = newFrameId;
          framesFlat[fi++] = combinedVideo;
          framesFlat[fi++] = frameIdx;
          let kept = iEnd - iStart;
          if (skipRows) {
            for (let j = iStart; j < iEnd; j++) {
              if (skipsInstanceRow(idn, j)) kept--;
            }
          }
          framesFlat[fi++] = instBase + outInsts; // instance range start
          framesFlat[fi++] = instBase + outInsts + kept; // end

          const negative = store.negativeFrames.has(
            `${numAt(fd.video, r)}:${frameIdx}`,
          );
          if (negative && !v3) {
            this.negativeFrames.add(`${combinedVideo}:${frameIdx}`);
          }
          if (extra) {
            extra.isNegative.push(negative ? 1 : 0);
            if (store.frameMetadata) {
              const md = metadataRecord(store.frameMetadata, r);
              if (Object.keys(md).length > 0)
                this.frameMeta.set(newFrameId, md);
            }
          }

          for (let j = iStart; j < iEnd; j++) {
            if (skipRows && skipsInstanceRow(idn, j)) continue;
            const type = numAt(idn.instance_type, j);
            const ptStart = numAt(idn.point_id_start, j);
            const ptEnd = numAt(idn.point_id_end, j);
            const trk = numAt(idn.track, j, -1);
            const fp = numAt(idn.from_predicted, j, -1);
            const fpOut = fp >= 0 ? outIdxOf(fp) : null;

            const det = storeDetections?.[j];
            if (det && Object.keys(det).length > 0) {
              this.instanceDetections.set(instBase + outInsts, det);
            }
            if (extra && store.instanceMetadata) {
              const md = metadataRecord(store.instanceMetadata, j);
              if (Object.keys(md).length > 0) {
                this.instanceMeta.set(instBase + outInsts, md);
              }
            }
            instFlat[ii++] = instBase + outInsts; // instance_id
            instFlat[ii++] = type; // instance_type
            instFlat[ii++] = newFrameId; // frame_id
            instFlat[ii++] = numAt(idn.skeleton, j) + kOff; // skeleton
            instFlat[ii++] = trk >= 0 ? trk + tOff : -1; // track
            instFlat[ii++] = fpOut != null ? instBase + fpOut : -1; // from_predicted
            instFlat[ii++] = numAt(idn.score, j); // score
            if (type === 1) {
              // point_id range = position in the re-packed pred-point stream.
              instFlat[ii++] = predBase + predWritten;
              instFlat[ii++] = predBase + predWritten + (ptEnd - ptStart);
              for (let p = ptStart; p < ptEnd; p++) {
                predPtsFlat[ppi++] = numAt(qx, p);
                predPtsFlat[ppi++] = numAt(qy, p);
                predPtsFlat[ppi++] = numAt(qv, p);
                predPtsFlat[ppi++] = numAt(qc, p);
                predPtsFlat[ppi++] = numAt(qs, p);
                extra?.predLabeled.push(labeledAt(ql, qv, p));
              }
              predWritten += ptEnd - ptStart;
            } else {
              instFlat[ii++] = pointBase + userWritten;
              instFlat[ii++] = pointBase + userWritten + (ptEnd - ptStart);
              for (let p = ptStart; p < ptEnd; p++) {
                userPtsFlat[upi++] = numAt(px, p);
                userPtsFlat[upi++] = numAt(py, p);
                userPtsFlat[upi++] = numAt(pv, p);
                userPtsFlat[upi++] = numAt(pc, p);
                extra?.userLabeled.push(labeledAt(pl, pv, p));
              }
              userWritten += ptEnd - ptStart;
            }
            const ts = numAt(idn.tracking_score, j);
            // Format 3.0 stores a user instance's "none" (0) as NaN.
            instFlat[ii++] = v3 && type === 0 && !ts ? Number.NaN : ts; // tracking_score
            outInsts++;
          }
          this.writtenFrames.add(key);
        }

        // Write only the actually-filled slice of each (max-sized) buffer.
        this.appendPoseRows(
          framesFlat.subarray(0, fi),
          instFlat.subarray(0, ii),
          userPtsFlat.subarray(0, upi),
          predPtsFlat.subarray(0, ppi),
          extra,
        );
      }
      // Per-frame + undistributed annotations (masks/rois/…), video + instance
      // remapped, skipping any that belong to a skipped (overlaid) frame.
      this.collectStoreAnnotations(
        store,
        vOff,
        instBase,
        outIdxOf,
        skippedKeys,
      );
    } catch (e) {
      // A mid-write failure leaves a partial file — release it rather than leak.
      this.dispose();
      throw e;
    }
  }

  /**
   * Append a batch of already-materialized `LabeledFrame`s — the write-side of
   * an edit overlay: user-corrected or newly-added frames layered onto a lazy
   * stream. Each frame's `video`/`skeleton`/`track` is resolved against this
   * writer's header (by identity); `from_predicted` links are resolved among the
   * batch. Intended for a bounded batch (the corrected subset), so it is not
   * windowed. Interleave freely with {@link appendStore}.
   *
   * Before anything is written, each frame, instance and annotation is
   * checked against the format 3.0 file it was loaded from, if any: a record
   * loaded with `format3: "view"` throws {@link SlpViewOnlyError}; unlabelled
   * points of records loaded with `"edit"` are written as absent; those of
   * other records follow `options.unlabeledAs` (see {@link UnlabeledAs},
   * default `"error"`).
   */
  appendFrames(
    frames: LabeledFrame[],
    options?: { unlabeledAs?: UnlabeledAs; slpVersion?: SlpVersion },
  ): void {
    if (this.closed) throw new Error("SlpStreamWriter is closed");
    if (frames.length === 0) return;
    const v3 =
      this.checkAppendLayout(options?.slpVersion, framesLayoutFacts(frames)) ===
      "v3";
    if (v3) {
      enforceV3Layout(framesLegacyLosses(frames), options?.unlabeledAs);
      checkV3Metadata(frames);
      refuseFormat3FrameIdentities(frames, this.headerHas.identities);
      for (const frame of frames) {
        this.noteKinds(sourceMarkOf(frame));
        for (const inst of frame.instances) this.noteKinds(sourceMarkOf(inst));
        for (const box of frame.bboxes) this.noteKinds(sourceMarkOf(box));
      }
    } else {
      enforceLegacyLayout(framesLegacyLosses(frames), options?.unlabeledAs);
      // A format 3.0 writer writes the links and embeddings of the frames'
      // instances and annotations; the 2.x layout does not.
      refuseFormat3FrameLosses(frames);
    }
    const extra = v3
      ? {
          isNegative: [] as number[],
          userLabeled: [] as number[],
          predLabeled: [] as number[],
        }
      : undefined;
    try {
      const frameBase = this.frameRows;
      const instBase = this.instRows;
      const pointBase = this.pointRows;
      const predBase = this.predPointRows;

      // Build the batch with LOCAL 0-based ids, then offset onto the file.
      const framesRows: number[][] = [];
      const instRows: number[][] = [];
      const userPts: number[][] = [];
      const predPts: number[][] = [];
      const localId = new Map<Instance, number>();
      const links: Array<[number, PredictedInstance]> = [];

      for (const frame of frames) {
        const videoIndex = Math.max(0, this.videos.indexOf(frame.video));
        const key = `${videoIndex}:${frame.frameIdx}`;
        if (this.writtenFrames.has(key)) continue; // dedup: first write wins
        this.writtenFrames.add(key);
        const localFrameId = framesRows.length;
        const instanceStart = instRows.length;
        for (const inst of frame.instances) {
          const localInstId = instRows.length;
          localId.set(inst as Instance, localInstId);
          const skeletonId = skeletonIdForWrite(this.skeletons, inst, frame);
          const trackId = inst.track ? this.tracks.indexOf(inst.track) : -1;
          // Format 3.0 stores a user instance's "none" (0 here) as NaN.
          const trackingScore =
            v3 && !(inst instanceof PredictedInstance) && !inst.trackingScore
              ? Number.NaN
              : (inst.trackingScore ?? 0);
          let type = 0;
          let score = 0;
          let ptStart = 0;
          let ptEnd = 0;
          if (inst instanceof PredictedInstance) {
            type = 1;
            score = inst.score ?? 0;
            ptStart = predPts.length;
            emitInstancePoints(predPts, inst, true);
            ptEnd = predPts.length;
            if (extra) pushLabeled(extra.predLabeled, inst);
          } else {
            ptStart = userPts.length;
            emitInstancePoints(userPts, inst as Instance, false);
            ptEnd = userPts.length;
            if (extra) pushLabeled(extra.userLabeled, inst);
            if (inst.fromPredicted)
              links.push([localInstId, inst.fromPredicted]);
          }
          if (extra && Object.keys(inst.metadata ?? {}).length > 0) {
            this.instanceMeta.set(instBase + localInstId, inst.metadata);
          }
          if (extra) {
            this.instanceDetections.set(
              instBase + localInstId,
              inst as IdentityBearing,
            );
          }
          instRows.push([
            localInstId,
            type,
            localFrameId,
            skeletonId,
            trackId,
            -1, // from_predicted (patched below)
            score,
            ptStart,
            ptEnd,
            trackingScore,
          ]);
        }
        framesRows.push([
          localFrameId,
          videoIndex,
          frame.frameIdx,
          instanceStart,
          instRows.length,
        ]);
        if (extra) {
          extra.isNegative.push(frame.isNegative ? 1 : 0);
          if (Object.keys(frame.metadata ?? {}).length > 0) {
            this.frameMeta.set(frameBase + localFrameId, frame.metadata);
          }
        } else if (frame.isNegative) {
          this.negativeFrames.add(`${videoIndex}:${frame.frameIdx}`);
        }
        this.collectFrameAnnotations(frame, videoIndex, instBase, localId);
      }

      // Resolve from_predicted to a GLOBAL instance id (or -1 if the source is
      // not in this batch — a dangling link, matching the eager writer).
      for (const [local, src] of links) {
        const srcLocal = localId.get(src as unknown as Instance);
        instRows[local][5] = srcLocal != null ? instBase + srcLocal : -1;
      }

      const nF = framesRows.length;
      const nI = instRows.length;
      const nU = userPts.length;
      const nP = predPts.length;

      const framesFlat = new Float64Array(nF * 5);
      for (let i = 0; i < nF; i++) {
        const r = framesRows[i];
        const o = i * 5;
        framesFlat[o] = frameBase + r[0];
        framesFlat[o + 1] = r[1];
        framesFlat[o + 2] = r[2];
        framesFlat[o + 3] = instBase + r[3];
        framesFlat[o + 4] = instBase + r[4];
      }
      const instFlat = new Float64Array(nI * 10);
      for (let i = 0; i < nI; i++) {
        const r = instRows[i];
        const o = i * 10;
        const ptBase = r[1] === 1 ? predBase : pointBase;
        instFlat[o] = instBase + r[0];
        instFlat[o + 1] = r[1];
        instFlat[o + 2] = frameBase + r[2];
        instFlat[o + 3] = r[3];
        instFlat[o + 4] = r[4];
        instFlat[o + 5] = r[5]; // already global (or -1)
        instFlat[o + 6] = r[6];
        instFlat[o + 7] = ptBase + r[7];
        instFlat[o + 8] = ptBase + r[8];
        instFlat[o + 9] = r[9];
      }
      const userFlat = new Float64Array(nU * 4);
      for (let i = 0; i < nU; i++) {
        const r = userPts[i];
        const o = i * 4;
        userFlat[o] = r[0];
        userFlat[o + 1] = r[1];
        userFlat[o + 2] = r[2];
        userFlat[o + 3] = r[3];
      }
      const predFlat = new Float64Array(nP * 5);
      for (let i = 0; i < nP; i++) {
        const r = predPts[i];
        const o = i * 5;
        predFlat[o] = r[0];
        predFlat[o + 1] = r[1];
        predFlat[o + 2] = r[2];
        predFlat[o + 3] = r[3];
        predFlat[o + 4] = r[4];
      }

      this.appendPoseRows(framesFlat, instFlat, userFlat, predFlat, extra);
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  /**
   * Collect a store's per-frame + undistributed annotations, remapping the
   * video index (`+vOff`) and the instance link (through `outIdxOf`, `+instBase`)
   * onto the combined file. Annotations on a SKIPPED (overlaid) frame — whose
   * combined `"vid:frameIdx"` key is in `skippedKeys` — are dropped. The store's
   * map keys are `"videoIndex:frameIdx"` (array-index video).
   */
  private collectStoreAnnotations(
    store: LazyDataStore,
    vOff: number,
    instBase: number,
    outIdxOf: (idx: number) => number | null,
    skippedKeys: Set<string>,
  ): void {
    const resolve = (idx: number | null | undefined): number => {
      if (idx == null || idx < 0) return -1;
      const o = outIdxOf(idx);
      return o != null ? instBase + o : -1;
    };
    const fromMap = <T extends AnnLinked>(
      map: Map<string, T[]>,
      bucket: AnnBucket<T>,
    ): void => {
      for (const [key, list] of map) {
        const sep = key.indexOf(":");
        const vid = vOff + Number(key.slice(0, sep));
        const fidx = Number(key.slice(sep + 1));
        if (skippedKeys.has(`${vid}:${fidx}`)) continue; // overlaid frame wins
        for (const ann of list) {
          bucket.anns.push(ann);
          bucket.ctx.push([vid, fidx]);
          bucket.inst.push(resolve(ann._instanceIdx));
        }
      }
    };
    fromMap(store._roiByFrame, this.pendingRois);
    fromMap(store._maskByFrame, this.pendingMasks);
    fromMap(store._bboxByFrame, this.pendingBboxes);
    fromMap(store._centroidByFrame, this.pendingCentroids);
    for (const [key, list] of store._labelImageByFrame) {
      const sep = key.indexOf(":");
      const vid = vOff + Number(key.slice(0, sep));
      const fidx = Number(key.slice(sep + 1));
      if (skippedKeys.has(`${vid}:${fidx}`)) continue;
      for (const li of list) {
        this.pendingLabelImages.anns.push(li);
        this.pendingLabelImages.ctx.push([vid, fidx]);
      }
    }

    const undist = <T extends AnnLinked>(
      list: T[],
      bucket: AnnBucket<T>,
      vidFor: (ann: T) => number,
    ): void => {
      for (const ann of list) {
        bucket.anns.push(ann);
        bucket.ctx.push([vidFor(ann), -1]);
        bucket.inst.push(resolve(ann._instanceIdx));
      }
    };
    // Static ROIs keep their video association (via the combined videos array).
    undist(store._undistributedRois, this.pendingRois, (roi) =>
      (roi as ROI).video ? this.videos.indexOf((roi as ROI).video!) : -1,
    );
    undist(store._undistributedMasks, this.pendingMasks, () => -1);
    undist(store._undistributedBboxes, this.pendingBboxes, () => -1);
    undist(store._undistributedCentroids, this.pendingCentroids, () => -1);
    for (const li of store._undistributedLabelImages) {
      this.pendingLabelImages.anns.push(li);
      this.pendingLabelImages.ctx.push([-1, -1]);
    }
  }

  /**
   * Collect a materialized frame's annotations, resolving each annotation's live
   * `instance` to its GLOBAL index via the batch's local map (`+instBase`).
   * Annotations without a live `instance` in the batch drop their link (-1).
   */
  private collectFrameAnnotations(
    frame: LabeledFrame,
    vid: number,
    instBase: number,
    localId: Map<Instance, number>,
  ): void {
    const resolve = (inst: Instance | null | undefined): number => {
      if (!inst) return -1;
      const l = localId.get(inst);
      return l != null ? instBase + l : -1;
    };
    const push = <T extends AnnLinked>(
      list: T[],
      bucket: AnnBucket<T>,
    ): void => {
      for (const ann of list) {
        bucket.anns.push(ann);
        bucket.ctx.push([vid, frame.frameIdx]);
        bucket.inst.push(resolve(ann.instance));
      }
    };
    push(frame.rois, this.pendingRois);
    push(frame.masks, this.pendingMasks);
    push(frame.bboxes, this.pendingBboxes);
    push(frame.centroids, this.pendingCentroids);
    for (const li of frame.labelImages) {
      this.pendingLabelImages.anns.push(li);
      this.pendingLabelImages.ctx.push([vid, frame.frameIdx]);
    }
  }

  /**
   * Write all accumulated annotation datasets. The per-type writers read the
   * instance link off each object, so the resolved GLOBAL index is applied via a
   * contained mutate→write→restore (source annotations are left unchanged).
   */
  private writePendingAnnotations(): void {
    // Format 3.0: the streaming writer rebuilds these tables, so it carries
    // no unknown columns (appendStore warned about any).
    const v3: V3Write | null =
      this.layout === "v3" ? { carry: new CarrySession(null) } : null;
    const writeBucket = <T extends AnnLinked>(
      bucket: AnnBucket<T>,
      fn: (
        file: any,
        anns: T[],
        videos: Video[],
        tracks: Track[],
        instances: never[],
        ctx: [number, number][],
        v3?: V3Write | null,
      ) => void,
    ): void => {
      if (bucket.anns.length === 0) return;
      const saved = bucket.anns.map(
        (a) => [a.instance, a._instanceIdx] as const,
      );
      try {
        for (let i = 0; i < bucket.anns.length; i++) {
          bucket.anns[i].instance = null;
          bucket.anns[i]._instanceIdx =
            bucket.inst[i] >= 0 ? bucket.inst[i] : null;
        }
        fn(
          this.file,
          bucket.anns,
          this.videos,
          this.tracks,
          [],
          bucket.ctx,
          v3,
        );
      } finally {
        for (let i = 0; i < bucket.anns.length; i++) {
          bucket.anns[i].instance = saved[i][0];
          bucket.anns[i]._instanceIdx = saved[i][1];
        }
      }
    };
    writeBucket(this.pendingRois, writeRois);
    writeBucket(this.pendingMasks, writeMasks);
    writeBucket(this.pendingBboxes, writeBboxes);
    writeBucket(this.pendingCentroids, writeCentroids);
    if (this.pendingLabelImages.anns.length > 0) {
      writeLabelImages(
        this.file,
        this.pendingLabelImages.anns,
        this.videos,
        this.tracks,
        [],
        this.pendingLabelImages.ctx,
        v3,
      );
    }
  }

  /** Write pending `negative_frames` and close the HDF5 file (shared finalize). */
  private finalizeFile(): void {
    withBoolMetadataNotice(() => this.finalizeTables());
    this.file.close();
  }

  /** Write the pending annotations, links, metadata and negative frames. */
  private finalizeTables(): void {
    this.writePendingAnnotations();
    if (this.layout === "v3") {
      // Per-detection identity and category links and embeddings: instances
      // by output row, annotations in the order their tables were written.
      const detections: DetectionCollections = {
        instance: Array.from(
          { length: this.instRows },
          (_, i) => this.instanceDetections.get(i) ?? {},
        ),
        centroid: this.pendingCentroids.anns,
        mask: this.pendingMasks.anns,
        bbox: this.pendingBboxes.anns,
        roi: this.pendingRois.anns,
      };
      const v3: V3Write = { carry: new CarrySession(null) };
      writeIdentityLinks(this.file, this.identities, detections, v3);
      writeCategoryLinks(this.file, detections, v3);
      writeEmbeddings(this.file, detections);
      // Record metadata of the rows appended, by output row.
      for (const [table, map, rows] of [
        ["frames", this.frameMeta, this.frameRows],
        ["instances", this.instanceMeta, this.instRows],
      ] as const) {
        if (map.size === 0) continue;
        const records = Array.from({ length: rows }, (_, i) => ({
          metadata: map.get(i),
        }));
        const kinds = this.metaKinds[table];
        writeMetadataColumns(
          this.file,
          table,
          metadataColumnsOf(records, table, (key) => kinds.get(key)),
        );
      }
    }
    if (this.negativeFrames.size > 0) {
      const rows: number[][] = [];
      for (const key of this.negativeFrames) {
        const [v, f] = key.split(":");
        rows.push([Number(v), Number(f)]);
      }
      rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      createMatrixDataset(
        this.file,
        "negative_frames",
        rows,
        ["video_id", "frame_idx"],
        "<i8",
      );
    }
  }

  /** Finalize the file (writes `negative_frames` if any) and return its bytes. */
  close(): Uint8Array {
    if (this.closed) throw new Error("SlpStreamWriter is already closed");
    this.closed = true;
    this.finalizeFile();
    const fs = getH5FileSystem(this.module);
    const bytes = fs.readFile!(this.memPath);
    fs.unlink!(this.memPath);
    if (this.headerLabels) this.headerLabels._slpLayout = this.layout;
    return bytes;
  }

  /**
   * Finalize and stream the file to `sink` in chunks, then unlink it — the
   * output-side companion to {@link appendStore}, so the finished file never has
   * to be resident as one big `Uint8Array` on the JS side. Reads the in-memory
   * HDF5 file with chunked FS reads when available (falling back to a single
   * read). `sink.close()` is awaited if present.
   *
   * @param opts.chunkBytes Chunk size (default 8 MiB).
   */
  async writeToSink(
    sink: SlpWriteSink,
    opts?: { chunkBytes?: number },
  ): Promise<void> {
    if (this.closed) throw new Error("SlpStreamWriter is already closed");
    this.closed = true;
    this.finalizeFile();

    const fs = getH5FileSystem(this.module);
    const cfs = fs as unknown as ChunkedFs;
    const chunkBytes = Math.max(
      1,
      Math.trunc(opts?.chunkBytes ?? 8 * 1024 * 1024),
    );
    try {
      if (cfs.open && cfs.read && cfs.close && cfs.stat) {
        const size = Number(cfs.stat(this.memPath).size);
        const stream = cfs.open(this.memPath, "r");
        try {
          const buf = new Uint8Array(chunkBytes);
          let pos = 0;
          while (pos < size) {
            const want = Math.min(chunkBytes, size - pos);
            const n = cfs.read(stream, buf, 0, want, pos);
            if (n <= 0) break;
            await sink.write(buf.slice(0, n)); // copy — buf is reused
            pos += n;
          }
        } finally {
          cfs.close(stream);
        }
      } else {
        // No chunked FS reads: read once, then hand out slices.
        const bytes = fs.readFile!(this.memPath);
        for (let pos = 0; pos < bytes.length; pos += chunkBytes) {
          await sink.write(
            bytes.slice(pos, Math.min(pos + chunkBytes, bytes.length)),
          );
        }
      }
      if (sink.close) await sink.close();
      if (this.headerLabels) this.headerLabels._slpLayout = this.layout;
    } finally {
      fs.unlink!(this.memPath);
    }
  }

  /**
   * Release the underlying HDF5 file WITHOUT producing bytes — call to clean up
   * a writer that will not be finished (e.g. after an error). Idempotent and
   * best-effort (never throws); the file/MEMFS path are closed and unlinked.
   */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.file.close();
    } catch {
      // best-effort
    }
    try {
      getH5FileSystem(this.module).unlink?.(this.memPath);
    } catch {
      // best-effort
    }
  }
}

/**
 * Open a streaming SLP writer: create the in-memory HDF5 file, write the header
 * (skeletons/videos/tracks/suggestions/identities/sessions/provenance), and
 * create the resizable `frames`/`instances`/`points`/`pred_points` datasets.
 * Frame data is appended later via {@link SlpStreamWriter.appendStore}.
 *
 * `header` may be a `Labels`; labels loaded with `format3: "view"` are refused
 * with {@link SlpViewOnlyError} before anything is created.
 */
export async function openSlpWriter(
  header: SlpWriteHeader,
  options?: { slpVersion?: SlpVersion },
): Promise<SlpStreamWriter> {
  const sourceFormat = (header as { sourceFormat?: SlpSourceFormat | null })
    .sourceFormat;
  refuseViewOnly({ sourceFormat, sessions: header.sessions });
  // The layout is decided now, from what the header says: the frames come
  // later. "auto" writes format 3.0 when the format 3.0 defaults are on, or
  // when the header is labels loaded from (or last saved in) format 3.0.
  const headerLabels = header instanceof Labels ? header : null;
  const layout = decideLayout(
    [
      {
        remembered: headerLabels?._slpLayout ?? null,
        editChoice: sourceFormat?.access === "edit",
        keep:
          sourceFormat?.access === "keep" ||
          sessionsKeep(header.sessions ?? []),
        reasons: [],
      },
    ],
    options?.slpVersion,
  );
  const module = await getH5Module();
  ensureH5StagingDir(module);
  const memPath = `/tmp/sleap_stream_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;
  const file = new module.File(memPath, "w");

  try {
    // Reuse the eager metadata writers via a frameless header `Labels` (they read
    // only header fields). Sessions are written with an empty labeled-frame list,
    // so frame-group refs that resolve by labeled-frame index are dropped — matches
    // the lazy fast-path (`writeSlpToFileLazy`).
    const frameless = new Labels({
      labeledFrames: [],
      videos: header.videos,
      skeletons: header.skeletons,
      tracks: header.tracks ?? [],
      suggestions: header.suggestions ?? [],
      sessions: header.sessions ?? [],
      identities: header.identities ?? [],
      provenance: header.provenance ?? {},
    });

    writeMetadata(file, frameless, layout);
    writeVideos(file, frameless.videos);
    writeVideoCrops(file, frameless.videos);
    writeTracks(file, frameless.tracks);
    writeSuggestions(file, frameless.suggestions, frameless.videos);
    writeIdentities(file, frameless.identities);
    writeSessions(
      file,
      frameless.sessions,
      frameless.videos,
      [],
      frameless.identities,
      layout === "v3" ? { carry: new CarrySession(null) } : null,
    );

    if (layout === "v3") {
      for (const table of ["frames", "instances", "points", "pred_points"]) {
        createAppendableColumnTable(file, table);
      }
      return new SlpStreamWriter(
        module,
        file,
        memPath,
        {
          videos: header.videos,
          skeletons: header.skeletons,
          tracks: header.tracks ?? [],
          identities: header.identities ?? [],
          sessions: header.sessions ?? [],
        },
        layout,
        headerLabels,
      );
    }

    // dtype chars matter: h5wasm keys off the type CHAR and IGNORES the trailing
    // digit, so "<f8" resolves to float32 (char 'f'=4 bytes) and "<i8" to int32
    // (char 'i'=4). See the notes above INSTANCE_COMPOUND_FIELDS and
    // SESSION_FRAME_GROUP_FIELDS.
    //
    // `frames`: this is actually int32 ("<q" is h5wasm's int64 code). Harmless
    // below 2^31 frame/instance rows; the Python reader casts positionally.
    createAppendableMatrixDataset(file, "frames", FRAMES_FIELDS, "<i8");
    // `instances`: MUST be true float64 ("<d"), NOT "<f8" (== float32 in h5wasm).
    // This table holds integer bookkeeping columns (instance_id, frame_id,
    // skeleton, track, point_id_start/point_id_end, …); float32 cannot represent
    // odd integers above 2^24 (16,777,216), so on files with >~16.7M point rows the
    // point_id_start/end spans round to even → instances read back with the wrong
    // node count → points misattributed to the wrong skeleton nodes, silently
    // (#231). "<d" (char 'd'=8 bytes) is exact to 2^53. The eager/lazy writers dodge
    // this via HDF5 compound columns (#218); this streaming path stays a float
    // matrix, so it must use true float64 here.
    createAppendableMatrixDataset(file, "instances", INSTANCES_FIELDS, "<d");
    // `points`/`pred_points` hold only coordinates, visibility flags, and scores —
    // no large integer ids — so float32 ("<f8") is an intentional, acceptable
    // choice here (contrast `instances` above, which MUST be "<d"). Remember "<f8"
    // == float32 in h5wasm (only the type char is read).
    createAppendableMatrixDataset(file, "points", POINTS_FIELDS, "<f8");
    createAppendableMatrixDataset(
      file,
      "pred_points",
      PRED_POINTS_FIELDS,
      "<f8",
    );
  } catch (e) {
    // Don't leak the MEMFS file if header setup fails before a writer exists.
    try {
      file.close();
    } catch {
      // best-effort
    }
    try {
      getH5FileSystem(module).unlink?.(memPath);
    } catch {
      // best-effort
    }
    throw e;
  }

  return new SlpStreamWriter(
    module,
    file,
    memPath,
    {
      videos: header.videos,
      skeletons: header.skeletons,
      tracks: header.tracks ?? [],
      identities: header.identities ?? [],
      sessions: header.sessions ?? [],
    },
    layout,
    headerLabels,
  );
}

/**
 * Structural signature of a skeleton list — node names, edges, and symmetries —
 * for cross-store equality. Instances from every store are read back against the
 * combined (store 0's) skeleton, so topology must match, not just node names.
 */
function skeletonSignature(skeletons: Skeleton[]): string {
  return JSON.stringify(
    skeletons.map((s) => ({
      nodes: s.nodeNames,
      edges: s.edges.map((e) => [e.source.name, e.destination.name]),
      symmetries: s.symmetryNames,
    })),
  );
}

/**
 * Merge N per-camera {@link LazyDataStore}s into one combined multi-video
 * `.slp`, streaming each store's frames in bounded windows (peak memory ≪ the
 * whole graph). The combined `videos` and `tracks` are the concatenation of the
 * stores' (video index and track index remapped accordingly); all stores must
 * share a structurally-identical skeleton list (the multi-camera case), which
 * becomes the combined skeleton set. Session graph / identities / suggestions /
 * provenance for the combined file are supplied via `options`.
 *
 * @returns the SLP file bytes (round-trips via `readSlpStreaming` / `readSlp`).
 */
export interface MergeStoresOptions {
  /**
   * The layout of the merged file: `"auto"` (the default) writes the 2.x
   * layout unless a store needs format 3.0 (loaded from a 3.0 file without
   * `format3: "edit"`, or holding content only 3.0 can store), `"v2"` or
   * `"v3"`. See {@link resolveSlpVersion}.
   */
  slpVersion?: SlpVersion;
  sessions?: RecordingSession[];
  identities?: Identity[];
  suggestions?: SuggestionFrame[];
  provenance?: Record<string, unknown>;
  windowFrames?: number;
}

/**
 * Validate the stores share a skeleton, open a writer over the concatenated
 * videos/tracks, and append every store (windowed) with cumulative offsets.
 * Returns the OPEN writer — the caller finalizes via `close()` (bytes) or
 * `writeToSink()` (streamed output). On error the partial file is disposed.
 */
async function buildMergedWriter(
  stores: LazyDataStore[],
  options?: MergeStoresOptions,
): Promise<SlpStreamWriter> {
  if (stores.length === 0) {
    throw new Error("merging SLP stores requires at least one store");
  }
  // Refuse a view-only store before the writer is opened, decide the file's
  // layout once for every store, and refuse a store from a 3.0 file holding
  // what this writer would drop in that layout.
  for (const store of stores) refuseViewOnly(store);
  const layout = decideLayout(
    stores.map(storeLayoutFacts),
    options?.slpVersion,
  );
  for (const store of stores) {
    refuseFormat3StoreLosses(
      store,
      {
        identities: (options?.identities ?? []).length > 0,
        sessions: (options?.sessions ?? []).length > 0,
      },
      layout === "v3",
    );
  }
  const sig = skeletonSignature(stores[0].skeletons);
  for (let i = 1; i < stores.length; i++) {
    if (skeletonSignature(stores[i].skeletons) !== sig) {
      throw new Error(
        `merging SLP stores: store ${i} has a different skeleton than store 0; ` +
          "all stores must share the same skeletons to merge into one file.",
      );
    }
  }

  const videos: Video[] = stores.flatMap((s) => s.videos);
  const tracks: Track[] = stores.flatMap((s) => s.tracks);

  const writer = await openSlpWriter(
    {
      skeletons: stores[0].skeletons,
      videos,
      tracks,
      suggestions: options?.suggestions,
      identities: options?.identities,
      sessions: options?.sessions,
      provenance: options?.provenance,
    },
    { slpVersion: layout },
  );

  try {
    let videoOffset = 0;
    let trackOffset = 0;
    for (const store of stores) {
      writer.appendStore(store, {
        videoIndexOffset: videoOffset,
        trackOffset,
        skeletonOffset: 0, // shared skeletons (validated)
        windowFrames: options?.windowFrames,
        slpVersion: layout,
      });
      videoOffset += store.videos.length;
      trackOffset += store.tracks.length;
    }
  } catch (e) {
    writer.dispose();
    throw e;
  }

  return writer;
}

/**
 * Merge N per-camera {@link LazyDataStore}s into one combined multi-video
 * `.slp`, streaming each store's frames in bounded windows (peak memory ≪ the
 * whole graph). The combined `videos` and `tracks` are the concatenation of the
 * stores' (video index and track index remapped accordingly); all stores must
 * share a structurally-identical skeleton list (the multi-camera case), which
 * becomes the combined skeleton set. Session graph / identities / suggestions /
 * provenance for the combined file are supplied via `options`.
 *
 * @returns the SLP file bytes (round-trips via `readSlpStreaming` / `readSlp`).
 */
export async function saveSlpMergedFromStores(
  stores: LazyDataStore[],
  options?: MergeStoresOptions,
): Promise<Uint8Array> {
  const writer = await buildMergedWriter(stores, options);
  return writer.close();
}

/**
 * Like {@link saveSlpMergedFromStores}, but streams the combined file to `sink`
 * in chunks instead of returning bytes — so neither the input `Labels` graph nor
 * the whole output is ever fully resident. Use with a browser
 * `FileSystemWritableFileStream` (OPFS / save picker) or Node `fs.WriteStream`.
 */
export async function saveSlpMergedToSink(
  stores: LazyDataStore[],
  sink: SlpWriteSink,
  options?: MergeStoresOptions & { chunkBytes?: number },
): Promise<void> {
  const writer = await buildMergedWriter(stores, options);
  await writer.writeToSink(sink, { chunkBytes: options?.chunkBytes });
}

export async function saveSlpToBytes(
  labels: Labels,
  options?: SlpWriteOptions,
): Promise<Uint8Array> {
  return writeSlpBytes(labels, options, { includeEmbeddedData: true });
}

/**
 * Main-thread half of the streaming pkg.slp writer (Phase 2 / Task 2.1, see
 * spike/write-bseam-device): write the small structure ONLY — labels,
 * skeletons, tracks, suggestions, metadata, and `videos_json` (marking
 * embedded videos per the same plan `saveSlpToBytes` would use) — but SKIP
 * the big `video{i}/video` embedded-image datasets (and their sibling
 * `frame_numbers`/`frame_sizes`). A Web Worker later opens the resulting file
 * in append mode and adds those datasets directly to disk via the raw-copy
 * path (see `buildSerializableEmbedPlan`), so a desktop save of a many-GB
 * pkg.slp never needs to hold the embedded image bytes in the wasm heap on
 * the main thread.
 *
 * Shares its setup (embed-mode resolution, lazy materialization, the
 * `embed:"source"` rebuild, and embedding plan computation) with
 * `saveSlpToBytes` via the private `writeSlpBytes` helper — the two functions
 * differ only in whether `writeEmbeddedVideoData` runs afterward, and in that
 * this one plans a new embed of a continuous video WITHOUT reading its frames
 * (the worker encodes and appends them; see `appendEncodedVideos` in
 * stream-embed.ts).
 *
 * @returns SLP bytes containing the structure only. NOT a directly-loadable
 *   embedded pkg.slp on its own if the plan embeds anything (the videos_json
 *   claims embedded images that aren't actually present yet) — it is an
 *   intermediate artifact meant to be completed by the worker's append step.
 */
export async function saveSlpStructureToBytes(
  labels: Labels,
  options?: SlpWriteOptions,
): Promise<Uint8Array> {
  return writeSlpBytes(labels, options, { includeEmbeddedData: false });
}

async function writeSlpBytes(
  labels: Labels,
  options: SlpWriteOptions | undefined,
  { includeEmbeddedData }: { includeEmbeddedData: boolean },
): Promise<Uint8Array> {
  // Labels loaded with `format3: "view"` are never written.
  refuseViewOnly(labels);
  // Checked before anything else, as Python, so a bad option writes nothing.
  const imageFormat = checkEmbedImageFormat(
    options?.imageFormat,
    options?.imageQuality,
  );
  // Decide the layout once, before anything is written (or materialized):
  // every table writer below follows it.
  const layout = resolveSlpVersion(
    labels,
    checkSlpVersion(options?.slpVersion),
  );
  const bytes = await writeSlpBytesIn(labels, options, layout, {
    includeEmbeddedData,
    imageFormat,
  });
  // The next "auto" save of these labels keeps the layout just written.
  labels._slpLayout = layout;
  return bytes;
}

async function writeSlpBytesIn(
  labels: Labels,
  options: SlpWriteOptions | undefined,
  layout: SlpLayout,
  {
    includeEmbeddedData,
    imageFormat,
  }: { includeEmbeddedData: boolean; imageFormat: EmbedImageFormat | null },
): Promise<Uint8Array> {
  const embedMode = options?.embed ?? false;

  // Auto-preserve already-embedded videos unless the caller externalizes them.
  // An already-embedded video is ALWAYS raw-copied (preserved) unless the caller
  // explicitly passes embed:"source" (which restores the external source video),
  // so even a bare saveSlpToBytes(labels) keeps its stored images (fixes #213).
  const hasEmbeddedToPreserve =
    embedMode !== "source" && labels.videos.some(isRawCopyable);
  const doEmbed =
    (embedMode !== false && embedMode !== "source") || hasEmbeddedToPreserve;

  // Lazy fast path: skip materialization only when we don't need frame data.
  // Any real embed OR a preserve of already-embedded images needs frame bytes,
  // so materialize and continue with the eager path. Mirrors Python's dispatch.
  if (labels.isLazy) {
    // The fast path copies the raw tables. A 3.0 table with rows the readers
    // skip (another instance type) is written from its frames instead, so the
    // saved file holds what was read.
    const store = labels._lazyDataStore;
    if (
      doEmbed ||
      (store && hasSkippedInstanceRows(store.instancesData)) ||
      (layout === "v3" && store && !lazyStoreWritableAsV3(store))
    ) {
      labels.materialize();
    } else {
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
        const lazyStore = lazyWriteLabels._lazyDataStore;
        if (lazyStore && layout === "v3") {
          const losses = storeLegacyLosses(lazyStore);
          enforceV3Layout(losses, options?.unlabeledAs);
          metadataColumnsOf(
            [
              ...lazyStore._undistributedBboxes,
              ...[...lazyStore._bboxByFrame.values()].flat(),
            ],
            "bboxes",
          );
        } else if (lazyStore) {
          enforceLegacyLayout(
            storeLegacyLosses(lazyStore),
            options?.unlabeledAs,
          );
          dropCarryForV2(lazyStore);
        }
        const module = await getH5Module();
        ensureH5StagingDir(module);
        const memPath = `/tmp/sleap_output_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;
        const file = new module.File(memPath, "w");
        try {
          withBoolMetadataNotice(() =>
            writeSlpToFileLazy(file, lazyWriteLabels, layout),
          );
        } finally {
          file.close();
        }
        const fs = getH5FileSystem(module);
        const bytes = fs.readFile!(memPath);
        fs.unlink!(memPath);
        return bytes;
      }
    }
  }

  if (layout === "v3") {
    enforceV3Layout(
      framesLegacyLosses(labels.labeledFrames, labels._staticRois),
      options?.unlabeledAs,
    );
    checkV3Metadata(labels.labeledFrames);
  } else {
    enforceLegacyLayout(
      framesLegacyLosses(labels.labeledFrames, labels._staticRois),
      options?.unlabeledAs,
    );
    for (const table of carriedNotEdited(labels._carriedColumns)) {
      const carried = labels._carriedColumns?.tables.get(table.slice(1));
      if (carried) warnDropped(table.slice(1), carried, "legacy");
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
        return keepSourceMark(
          frame,
          new LabeledFrame({
            video: restoredVideo,
            frameIdx: frame.frameIdx,
            instances: frame.instances,
            centroids: frame.centroids,
            bboxes: frame.bboxes,
            masks: frame.masks,
            labelImages: frame.labelImages,
            rois: frame.rois,
            metadata: frame.metadata,
            isNegative: frame.isNegative,
          }),
        );
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
    // The rebuilt frames hold the same records, so the same unknown columns.
    writeLabels._carriedColumns = labels._carriedColumns;
  }

  const module = await getH5Module();
  ensureH5StagingDir(module);
  const memPath = `/tmp/sleap_output_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;

  // Plan which videos to embed (raw-copy preserved ones + any new-embed target).
  // The plan reads raw blobs from `labels.videos` (the ORIGINAL videos), not the
  // source-mode `writeLabels` copy — but source mode never embeds (plan is null).
  // A structure-only save never writes the images, so it plans without reading
  // them; the streaming writer embeds them afterwards.
  const plan = doEmbed
    ? await planEmbedding(
        labels,
        embedMode,
        options?.onProgress,
        options?.embedAllVideos ?? true,
        {
          readFrames: includeEmbeddedData,
          imageFormat,
          imageQuality: embedQuality(options?.imageQuality),
        },
      )
    : null;

  const fs = getH5FileSystem(module);
  const file = new module.File(memPath, "w");
  try {
    try {
      withBoolMetadataNotice(() =>
        writeSlpToFile(file, writeLabels, plan, layout),
      );
      if (includeEmbeddedData && plan && plan.size > 0) {
        await writeEmbeddedVideoData(file, labels, plan, options?.onProgress);
      }
    } finally {
      file.close();
    }
    return fs.readFile!(memPath);
  } finally {
    try {
      fs.unlink!(memPath);
    } catch {
      // best-effort cleanup
    }
  }
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

/**
 * Build the exact JSON string written into the `/metadata` `json` attribute by
 * {@link writeMetadata}. Exposed so the in-place saver can re-emit that attribute
 * (via {@link writeLabelTablesInPlace}) without re-serializing the whole file.
 * The caller decides WHEN metadata actually changed and passes this into
 * {@link buildLabelTableUpdate}'s `metadataJson` option; a value-only pose edit
 * leaves it unset so the attribute is untouched.
 */
export function buildMetadataJson(labels: Labels): string {
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
  return JSON.stringify(metadata);
}

function writeMetadata(
  file: any,
  labels: Labels,
  layout: SlpLayout = "v2",
): void {
  const metadataJson = buildMetadataJson(labels);

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

  // The slim `sessions_json` shape itself (calibration keyed `cam_<i>`, camcorder
  // map keyed by integer index) is a convergence to Python's existing format and
  // does not, on its own, bump `format_id`. `format_id` is a namespace shared with
  // Python (2.5 identity + re-ID embeddings, 2.6 events, 2.7 categories).
  //
  // v2.5: per-detection re-ID identity (/identity/links + /embeddings). Bumped only
  // when a detection actually carries an identity link or embedding; the identity
  // CATALOG alone (identities present but unlinked) does not trigger it.
  if (hasPerDetectionIdentity(labels)) {
    formatId = Math.max(formatId, 2.5);
  }

  // v2.7: class/category subsystem (/categories catalog + /categories/links +
  // category_* embeddings), gated on a detection actually carrying a category.
  if (hasPerDetectionCategory(labels)) {
    formatId = Math.max(formatId, 2.7);
  }

  // v2.8: columnar RecordingSession frame-group data (the `/session_data` group).
  // Bumped ONLY when a session carries frame groups — session-free / single-view
  // files write no group and stay byte-identical below 2.8. Gated on the same
  // predicate `writeSessions` uses to write the group, so the version and the
  // on-disk group never disagree (mirrors Python's group-presence gate).
  if (sessionsHaveFrameGroups(labels.sessions)) {
    formatId = Math.max(formatId, 2.8);
  }

  // Format 3.0: every table a group of columns.
  if (layout === "v3") formatId = Math.max(formatId, SLP_FORMAT3_ID);

  file.create_group("metadata");
  const metadataGroup = file.get("metadata");
  if (layout === "v3") {
    // A float, as Python writes it (h5wasm would guess an integer for 3.0).
    metadataGroup.create_attribute("format_id", formatId, null, "<d");
  } else {
    metadataGroup.create_attribute("format_id", formatId);
  }
  setStringAttr(metadataGroup, "json", metadataJson);
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
  // ImageVideo (image sequence): the canonical SLP format stores the full
  // ordered list under `filenames` (plural) and only the FIRST image under the
  // scalar `filename` (Python `video_to_dict`, and sleap-io.js's own reader in
  // parsers.ts `resolveVideoFilename`). Emitting the whole list under `filename`
  // makes Python's `make_video` do `Path(list)` and crash (#221).
  if (Array.isArray(video.filename)) {
    backend.filenames = video.filename;
    backend.filename = video.filename[0] ?? "";
  } else if (backend.filename == null) {
    backend.filename = video.filename;
  }

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

  // Serialize the full source_video lineage (filename + backend incl. shape +
  // any deeper chain), not just its filename, so a reload can recover the
  // source's frame extent. Mirrors Python `video_to_dict` (recursive). See #160.
  if (video.sourceVideo) {
    entry.source_video = serializeVideo(video.sourceVideo);
  }

  return entry;
}

/**
 * The full source-video dict to persist for a video that is being embedded, or
 * `null` when there is nothing to record. Prefers an explicit `sourceVideo`
 * (its lineage, incl. shape); otherwise, for a not-yet-embedded video, records
 * the video itself as its own source (mirrors Python `process_and_embed_frames`,
 * where `source_video = video.source_video or video`). An already-embedded video
 * with no known source contributes nothing.
 */
function sourceVideoDict(video: Video): Record<string, unknown> | null {
  if (video.sourceVideo) return serializeVideo(video.sourceVideo);
  if (!video.hasEmbeddedImages) return serializeVideo(video);
  return null;
}

/** Python `METADATA_ATTR_SIZE_LIMIT`: the HDF5 64 KB attribute ceiling. */
const SOURCE_VIDEO_ATTR_LIMIT = 64000;

/**
 * Write a source video's metadata JSON into its `{group}/source_video` HDF5
 * group, the authoritative location an embedded video's source is read from,
 * exactly as Python `_write_source_video_json`: normally a `json` variable-
 * length string *attribute*; if the blob would exceed the 64 KB attribute
 * ceiling, a scalar fixed-length bytes `json` *dataset* in the same group
 * instead (Python's `np.bytes_`; readers check the dataset first).
 */
function writeSourceVideoJson(
  file: any,
  groupPath: string,
  sourceDict: Record<string, unknown>,
): void {
  const blob = JSON.stringify(sourceDict);
  file.create_group(`${groupPath}/source_video`);
  const byteLength = new TextEncoder().encode(blob).length;
  if (byteLength <= SOURCE_VIDEO_ATTR_LIMIT) {
    file.get(`${groupPath}/source_video`).create_attribute("json", blob);
    return;
  }
  file.create_dataset({
    name: `${groupPath}/source_video/json`,
    data: blob,
    shape: [],
    dtype: `S${byteLength}`,
  });
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

/**
 * Serialize `tracks` to the exact per-track JSON strings written into the
 * `tracks_json` dataset. Shared by {@link writeTracks} and the in-place
 * writability gate ({@link buildExpectedSidecars}) so the gate's comparison to
 * the on-disk `tracks_json` is byte-exact.
 */
export function buildTracksJson(tracks: Array<{ name: string }>): string[] {
  return tracks.map((track) => JSON.stringify([SPAWNED_ON, track.name]));
}

/**
 * Serialize `suggestions` to the exact per-suggestion JSON strings written into
 * the `suggestions_json` dataset. Shared by {@link writeSuggestions} and the
 * in-place writability gate so the comparison is byte-exact.
 */
export function buildSuggestionsJson(
  suggestions: SuggestionFrame[],
  videos: Video[],
): string[] {
  return suggestions.map((suggestion) =>
    JSON.stringify({
      video: String(videos.indexOf(suggestion.video)),
      frame_idx: suggestion.frameIdx,
      group: suggestion.group ?? "default",
    }),
  );
}

/**
 * A cheap per-video signature — filename(s), shape, and embedded-flag — that
 * uniquely identifies a video WITHOUT reproducing the full `videos_json`
 * serialization (which depends on backend metadata and is easy to diff
 * spuriously). Used by the in-place writability gate to refuse an edit that
 * added/removed/repointed a video (which would leave `videos_json` — and the
 * embedded `video{i}` groups — stale relative to the rewritten frames table).
 * The caller builds the on-disk side from the videos it parsed on open, and the
 * expected side (via {@link buildExpectedSidecars}) from the current labels.
 */
export function buildVideoSignatures(videos: Video[]): string[] {
  return videos.map((v) =>
    JSON.stringify({
      filename: v.filename,
      shape: v.shape ?? null,
      embedded: v.hasEmbeddedImages,
    }),
  );
}

function writeTracks(file: any, tracks: Array<{ name: string }>): void {
  file.create_dataset({ name: "tracks_json", data: buildTracksJson(tracks) });
}

function writeSuggestions(
  file: any,
  suggestions: SuggestionFrame[],
  videos: Video[],
): void {
  file.create_dataset({
    name: "suggestions_json",
    data: buildSuggestionsJson(suggestions, videos),
  });
}

function writeIdentities(file: any, identities: Identity[]): void {
  if (!identities.length) return;
  // Legacy JS-native `identities_json` (typed metadata; kept for older JS readers).
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

  // Python-compatible /identity group (SLP 2.5): a native vlen `name` catalog plus
  // an optional entity-attribute-value metadata table. Written ALONGSIDE
  // identities_json (dual-write) so both Python and older JS readers interoperate.
  // Python has no first-class `color`, so color is folded into metadata["color"]
  // (docs/formats/slp.md). Values are stringified to match Python's string-only EAV.
  file.create_group("identity");
  file.create_dataset({
    name: "identity/name",
    data: identities.map((i) => i.name),
  });
  const metaOwner: number[] = [];
  const metaKey: string[] = [];
  const metaVal: string[] = [];
  identities.forEach((identity, idx) => {
    const meta: Record<string, unknown> = { ...identity.metadata };
    if (identity.color != null && meta.color == null)
      meta.color = identity.color;
    for (const [k, v] of Object.entries(meta)) {
      metaOwner.push(idx);
      metaKey.push(String(k));
      metaVal.push(String(v));
    }
  });
  if (metaOwner.length) {
    file.create_dataset({
      name: "identity/meta_owner",
      data: new Int32Array(metaOwner),
      shape: [metaOwner.length],
      dtype: "<i", // int32 (see the dtype-char note above)
    });
    file.create_dataset({ name: "identity/meta_key", data: metaKey });
    file.create_dataset({ name: "identity/meta_val", data: metaVal });
  }
}

// ---- Per-detection identity/embedding owner types (SLP 2.5) --------------------
// Shared with Python (slp.py OWNER_*). Value 1 is unused; label images get none.
const OWNER_INSTANCE = 0;
const OWNER_CENTROID = 2;
const OWNER_MASK = 3;
const OWNER_BBOX = 4;
const OWNER_ROI = 5;

/** A detection that can carry per-detection identity + category (SLP 2.5/2.7). */
interface IdentityBearing {
  identity?: Identity | null;
  identityScore?: number | null;
  identityEmbedding?: { vector: number[] } | null;
  category?: string | null;
  categoryScore?: number | null;
  categoryEmbedding?: { vector: number[] } | null;
}

/** The five detection collections, each in the SAME global order its modality
 * dataset was written (array index == owner_id). */
interface DetectionCollections {
  instance: IdentityBearing[];
  centroid: IdentityBearing[];
  mask: IdentityBearing[];
  bbox: IdentityBearing[];
  roi: IdentityBearing[];
}

/** Owner-type → ordered detection list (owner_id = index within each list). */
function ownerCollections(
  c: DetectionCollections,
): Array<[number, IdentityBearing[]]> {
  return [
    [OWNER_INSTANCE, c.instance],
    [OWNER_CENTROID, c.centroid],
    [OWNER_MASK, c.mask],
    [OWNER_BBOX, c.bbox],
    [OWNER_ROI, c.roi],
  ];
}

/**
 * Write per-detection identity links (SLP 2.5) to `/identity/links`: one
 * `(owner_type, owner_id, identity_idx, identity_score)` row per detection carrying
 * an `Identity` registered in the catalog. `owner_id` is the detection's global
 * per-modality index (matching how the modality datasets — and Python — are
 * written). Emitted as a flat-2-D `<d` matrix + `field_names` (the h5wasm compound
 * stand-in); the coordinated Python reader (sleap-io#547) converts it. No-op when
 * there are no identities or no linked detections.
 */
function writeIdentityLinks(
  file: any,
  identities: Identity[],
  c: DetectionCollections,
  v3?: V3Write | null,
): void {
  if (!identities.length) return;
  const idToIdx = new Map<Identity, number>(identities.map((id, i) => [id, i]));
  const rows: number[][] = [];
  for (const [ownerType, list] of ownerCollections(c)) {
    list.forEach((det, ownerId) => {
      if (det.identity == null) return;
      const idx = idToIdx.get(det.identity);
      if (idx == null) {
        console.warn(
          `Detection references an Identity ("${det.identity.name}") not found in Labels.identities — identity link dropped on save.`,
        );
        return;
      }
      rows.push([ownerType, ownerId, idx, det.identityScore ?? Number.NaN]);
    });
  }
  if (!rows.length) return;
  // The /identity group is created by writeIdentities (runs earlier when
  // identities exist); create defensively in case it does not.
  if (!file.get("identity")) file.create_group("identity");
  if (v3) {
    writeLinkTableV3(file, "identity", rows, v3);
    return;
  }
  createMatrixDataset(
    file,
    "identity/links",
    rows,
    ["owner_type", "owner_id", "identity_idx", "identity_score"],
    "<d",
  );
}

/**
 * Write one `/embeddings` triple: a `(N, D)` float `vectors` matrix (chunked+gzip,
 * no field_names) + parallel `owner_type` / `owner_id` join columns. Used for both
 * the identity vectors (`vectors`/`owner_type`/`owner_id`) and the independent
 * category vectors (`category_vectors`/`category_owner_type`/`category_owner_id`).
 * All vectors in a triple must share one dimension. No-op when none present.
 */
function writeEmbeddingTriple(
  file: any,
  c: DetectionCollections,
  names: [string, string, string],
  get: (d: IdentityBearing) => { vector: number[] } | null | undefined,
): void {
  const vectors: number[][] = [];
  const ownerTypes: number[] = [];
  const ownerIds: number[] = [];
  let dim = -1;
  for (const [ownerType, list] of ownerCollections(c)) {
    list.forEach((det, ownerId) => {
      const emb = get(det);
      if (emb == null) return;
      if (dim === -1) dim = emb.vector.length;
      if (emb.vector.length !== dim) {
        throw new Error(
          `All ${names[0]} must share one dimension; got ${emb.vector.length} and ${dim}.`,
        );
      }
      vectors.push(emb.vector);
      ownerTypes.push(ownerType);
      ownerIds.push(ownerId);
    });
  }
  if (!vectors.length) return;
  if (!file.get("embeddings")) file.create_group("embeddings");
  createGzipFloatMatrix(file, `embeddings/${names[0]}`, vectors, dim);
  file.create_dataset({
    name: `embeddings/${names[1]}`,
    data: new Float64Array(ownerTypes),
    shape: [ownerTypes.length],
    dtype: "<d",
  });
  file.create_dataset({
    name: `embeddings/${names[2]}`,
    data: new Float64Array(ownerIds),
    shape: [ownerIds.length],
    dtype: "<d",
  });
}

/**
 * Write per-detection re-ID (SLP 2.5) + category (SLP 2.7) embeddings to the
 * `/embeddings` group as two independent triples sharing the same owner join.
 * Written whenever a detection carries the corresponding embedding (lossless
 * preserve). No-op when none present.
 */
function writeEmbeddings(file: any, c: DetectionCollections): void {
  writeEmbeddingTriple(
    file,
    c,
    ["vectors", "owner_type", "owner_id"],
    (d) => d.identityEmbedding,
  );
  writeEmbeddingTriple(
    file,
    c,
    ["category_vectors", "category_owner_type", "category_owner_id"],
    (d) => d.categoryEmbedding,
  );
}

/** Distinct non-empty category strings across all detections, in first-seen order
 * (the `/categories/name` catalog). JS categories are plain strings, so the catalog
 * is derived from the strings themselves (no per-category metadata). */
function collectCategoryCatalog(c: DetectionCollections): string[] {
  const seen = new Set<string>();
  const catalog: string[] = [];
  for (const [, list] of ownerCollections(c)) {
    for (const det of list) {
      const cat = det.category;
      if (cat && !seen.has(cat)) {
        seen.add(cat);
        catalog.push(cat);
      }
    }
  }
  return catalog;
}

/**
 * Write the class/category subsystem (SLP 2.7): the `/categories/name` catalog
 * (distinct category strings) + `/categories/links` (owner_type, owner_id,
 * category_idx, category_score) — one row per detection with a non-empty category,
 * flat-2-D `<d`+field_names (the Python reader converts it, sleap-io#548). No-op
 * when no detection carries a category.
 */
function writeCategoryLinks(
  file: any,
  c: DetectionCollections,
  v3?: V3Write | null,
): void {
  const catalog = collectCategoryCatalog(c);
  if (!catalog.length) return;
  const catToIdx = new Map<string, number>(catalog.map((n, i) => [n, i]));
  const rows: number[][] = [];
  for (const [ownerType, list] of ownerCollections(c)) {
    list.forEach((det, ownerId) => {
      const cat = det.category;
      if (!cat) return;
      rows.push([
        ownerType,
        ownerId,
        catToIdx.get(cat) as number,
        det.categoryScore ?? Number.NaN,
      ]);
    });
  }
  if (!rows.length) return;
  file.create_group("categories");
  file.create_dataset({ name: "categories/name", data: catalog });
  if (v3) {
    writeLinkTableV3(file, "categories", rows, v3);
    return;
  }
  createMatrixDataset(
    file,
    "categories/links",
    rows,
    ["owner_type", "owner_id", "category_idx", "category_score"],
    "<d",
  );
}

/**
 * Write `/identity/links` or `/categories/links` in format 3.0: a group of
 * resizable columns, as Python writes it. Unknown columns kept from loading
 * are matched to rows by their `(owner_type, owner_id, catalog index)`.
 */
function writeLinkTableV3(
  file: any,
  catalog: "identity" | "categories",
  rows: number[][],
  v3: V3Write,
): void {
  const index = catalog === "identity" ? "identity" : "category";
  const table = `${catalog}/links`;
  writeColumnTable(
    file,
    table,
    rowColumns(
      rows,
      ["owner_type", "owner_id", `${index}_idx`, `${index}_score`],
      v3LinkColumns(index),
    ),
    {
      resizable: true,
      carried: v3.carry.columnsFor(
        table,
        rows.map((row) => [row[0], row[1], row[2]]),
      ),
    },
  );
}

/** Whether any detection satisfies `pred` across all five modalities (used to gate
 * the identity 2.5 / category 2.7 format bumps). */
function anyDetection(
  labels: Labels,
  pred: (d: IdentityBearing) => boolean,
): boolean {
  const any = (list: IdentityBearing[]) => list.some(pred);
  return (
    labels.labeledFrames.some((f) => any(f.instances as IdentityBearing[])) ||
    any(labels.masks as IdentityBearing[]) ||
    any(labels.centroids as IdentityBearing[]) ||
    any(labels.bboxes as IdentityBearing[]) ||
    any(labels.rois as IdentityBearing[])
  );
}

/** Whether any detection carries a per-detection identity or embedding (format 2.5). */
function hasPerDetectionIdentity(labels: Labels): boolean {
  // A lazy store keeps its instances' links by row (written by the lazy saves).
  const store = labels.isLazy ? labels._lazyDataStore : null;
  if (store?._instanceIdentityLinks?.size || store?._instanceEmbeddings?.size) {
    return true;
  }
  return anyDetection(
    labels,
    (d) => d.identity != null || d.identityEmbedding != null,
  );
}

/** Whether any detection carries a category or category embedding (format 2.7). */
function hasPerDetectionCategory(labels: Labels): boolean {
  const store = labels.isLazy ? labels._lazyDataStore : null;
  if (
    store?._instanceCategoryLinks?.size ||
    store?._instanceCategoryEmbeddings?.size
  ) {
    return true;
  }
  return anyDetection(
    labels,
    (d) =>
      (d.category != null && d.category !== "") || d.categoryEmbedding != null,
  );
}

// ---- SLP 2.8 columnar /session_data field names (snake_case, Python-compatible) --
// h5wasm cannot create HDF5 compound datasets, so these struct tables are written as
// flat 2-D float64 matrices + a `field_names` attribute (exactly as points/instances/
// frames are), and the coordinated Python reader rebuilds the structured array via
// `_read_dataset_from_open_file`. float64 losslessly holds every index (≤ 2^53), the
// `-1` sentinels, and the `NaN` scores; the Python reader's int()/float()/isnan casts
// tolerate the f8 backing. points_3d / pred_points_3d are PLAIN float64 matrices with
// NO field_names (Python slices them as `block[:, :3]`).
//
// NOTE: the on-disk dtype MUST be "<d" (float64), NOT "<f8": h5wasm's dtype parser
// keys off the type CHAR and ignores the digit, so "<f8" resolves to float32 (char
// 'f'=4 bytes) and "<i8" to int32 (char 'i'=4) — which would silently truncate 3D
// precision and, worse, CORRUPT any index past 2^24. "<d" = float64 (char 'd'=8).
const SESSION_FRAME_GROUP_FIELDS = ["frame_idx", "ig_start", "ig_end"];
const SESSION_INSTANCE_GROUP_FIELDS = [
  "identity_idx",
  "score",
  "instance_3d_score",
  "pts3d_start",
  "pts3d_end",
  "pts3d_predicted",
  "member_start",
  "member_end",
];
const SESSION_INSTANCE_GROUP_MEMBER_FIELDS = ["camera", "lf", "inst"];

/**
 * Whether any session carries a frame group with ≥1 instance group. Gates both the
 * `/session_data` group and the format 2.8 bump — session-free / single-view files
 * write no group and stay byte-identical.
 */
export function sessionsHaveFrameGroups(sessions: RecordingSession[]): boolean {
  return sessions.some((s) =>
    [...s.frameGroups.values()].some((fg) => fg.instanceGroups.length > 0),
  );
}

/**
 * Coerce an inline/legacy 3-D point row (possibly `null`, or with `null` coords) to a
 * fixed-width float row, mapping every missing entry to `NaN` — never `Number(null)`
 * (=== 0), which would move a missing keypoint to the origin. Ports Python's
 * `_inline_3d_to_array`; `NaN` then round-trips natively in the float dataset.
 */
function coerce3dRow(row: unknown, width: number): number[] {
  const out = new Array<number>(width);
  if (row == null) {
    out.fill(Number.NaN);
    return out;
  }
  const arr = row as ArrayLike<unknown>;
  for (let i = 0; i < width; i++) {
    const v = arr[i];
    out[i] = v == null ? Number.NaN : Number(v);
  }
  return out;
}

/**
 * Build the slim calibration + camera→video map that stays inline in `sessions_json`
 * (the O(cameras) data). Unchanged from the legacy serializer so the on-disk shape of
 * these fields is identical; only the per-frame payload moves to `/session_data`.
 */
function sessionCalibrationDict(
  session: RecordingSession,
  videos: Video[],
): {
  calibration: Record<string, unknown>;
  camcorder_to_video_idx_map: Record<string, number>;
} {
  const calibration: Record<string, unknown> = {
    metadata: session.cameraGroup.metadata ?? {},
  };
  // Key calibration by `cam_<index>` to match Python `camera_group_to_dict`. The key
  // is cosmetic on read (cameras resolve by positional index); the camcorder map
  // keys by bare integer index, exactly as Python does.
  session.cameraGroup.cameras.forEach((camera, idx) => {
    const key = `cam_${idx}`;
    const camData: Record<string, unknown> = {
      name: camera.name ?? key,
      rotation: camera.rvec,
      translation: camera.tvec,
      matrix: camera.matrix,
      distortions: camera.distortions,
    };
    // Always write `size`, using "" when unknown — matches Python `camera_to_dict`
    // (`"" if camera.size is None else list(size)`). Python's `make_camera` does a
    // bare `camera_dict.pop("size")`, so omitting the key KeyErrors on read.
    camData.size = camera.size && camera.size.length === 2 ? camera.size : "";
    calibration[key] = camData;
  });

  const camcorder_to_video_idx_map: Record<string, number> = {};
  for (const [camera, video] of session.videoByCamera.entries()) {
    const camIdx = session.cameraGroup.cameras.indexOf(camera);
    const videoIndex = videos.indexOf(video);
    if (camIdx >= 0 && videoIndex >= 0) {
      camcorder_to_video_idx_map[String(camIdx)] = videoIndex;
    }
  }
  return { calibration, camcorder_to_video_idx_map };
}

/**
 * Resolve an instance group's members to `(cameraIdx, lfIdx, instIdx)` rows — the
 * columnarized `camcorder_to_lf_and_inst_idx_map`. Mirrors the legacy serializer's
 * hybrid derivation: concrete instances resolved via `labeledFrameIndex` first (so
 * edits/reorders are reflected), falling back to the stored index refs so an
 * untouched lazy group serializes with ZERO frame materialization.
 */
function instanceGroupMemberRows(
  group: InstanceGroup,
  session: RecordingSession,
  frameGroup: FrameGroup,
  labeledFrameIndex: Map<LabeledFrame, number>,
): Array<[number, number, number]> {
  const concreteInst = group._instanceByCamera;
  const instRefs = group._instanceRefsByCamera;
  const lfByCamera =
    concreteInst && labeledFrameIndex.size > 0
      ? frameGroup.labeledFrameByCamera
      : undefined;
  const cameras = session.cameraGroup.cameras;
  const rows: Array<[number, number, number]> = [];
  const seen = new Set<Camera>([
    ...(concreteInst?.keys() ?? []),
    ...(instRefs?.keys() ?? []),
  ]);
  for (const camera of seen) {
    const camIdx = cameras.indexOf(camera);
    if (camIdx < 0) continue;
    let pair: [number, number] | undefined;
    const instance = concreteInst?.get(camera);
    if (instance && lfByCamera) {
      const lf = lfByCamera.get(camera);
      const lfIdx = lf !== undefined ? labeledFrameIndex.get(lf) : undefined;
      const instIdx = lf ? lf.instances.indexOf(instance as Instance) : -1;
      if (lfIdx !== undefined && instIdx >= 0) pair = [lfIdx, instIdx];
    }
    if (!pair && instRefs?.has(camera)) pair = instRefs.get(camera);
    if (pair) rows.push([camIdx, pair[0], pair[1]]);
  }
  return rows;
}

/**
 * Create a chunked + gzip 2-D float64 dataset with NO `field_names` attribute — the
 * Python reader slices `points_3d`/`pred_points_3d` as a plain matrix (`block[:, :3]`),
 * and a `field_names` attr would make it rebuild a structured array and break that.
 * gzip requires a non-zero chunk dim, so callers must guard on `rows.length > 0`.
 */
function createGzipFloatMatrix(
  file: any,
  name: string,
  rows: number[][],
  ncols: number,
): void {
  const n = rows.length;
  const data = new Float64Array(n * ncols);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const off = i * ncols;
    for (let j = 0; j < ncols; j++) data[off + j] = r[j];
  }
  file.create_dataset({
    name,
    data,
    shape: [n, ncols],
    dtype: "<d", // float64 — see the dtype-char note above ("<f8" would be float32)
    chunks: [Math.min(WRITE_CHUNK_ROWS, Math.max(1, n)), ncols],
    compression: "gzip",
    compression_opts: 1,
  });
}

/**
 * Write `RecordingSession` metadata (SLP 2.8 columnar layout).
 *
 * `sessions_json` holds only the slim per-session blob (calibration +
 * `camcorder_to_video_idx_map` + session metadata + an `fg_start`/`fg_end` half-open
 * range into `session_data/frame_groups`). The unbounded per-frame payload — frame
 * groups, instance groups, the columnarized member map, and 3-D points — goes into
 * the `/session_data` group, written only when a session has frame groups (so
 * session-free / single-view files stay byte-identical and below format 2.8).
 *
 * `labeledFrames` may be empty (the lazy / streaming-header paths): member rows then
 * derive from the stored index refs rather than concrete instances.
 */
function writeSessions(
  file: any,
  sessions: RecordingSession[],
  videos: Video[],
  labeledFrames: LabeledFrame[],
  identities?: Identity[],
  v3?: V3Write | null,
): void {
  const labeledFrameIndex = new Map<LabeledFrame, number>();
  labeledFrames.forEach((lf, idx) => {
    labeledFrameIndex.set(lf, idx);
  });

  // Columnar accumulators for /session_data (small: fixed-width ints/floats per frame
  // group / instance group / member, plus the 3-D point rows).
  const fgRows: number[][] = []; // [frame_idx, ig_start, ig_end]
  const igRows: number[][] = []; // SESSION_INSTANCE_GROUP_FIELDS
  const memberRows: number[][] = []; // [camera, lf, inst]
  const fgMeta: string[] = [];
  const igMeta: string[] = [];
  const pts3dRows: number[][] = []; // [x, y, z]
  const predPts3dRows: number[][] = []; // [x, y, z, score]
  // The records owning each row, for unknown columns (format 3.0).
  const fgOwners: unknown[][] = [];
  const igOwners: unknown[][] = [];
  const memberOwners: unknown[][] = [];

  const sessionsJson: string[] = [];
  for (const session of sessions) {
    const { calibration, camcorder_to_video_idx_map } = sessionCalibrationDict(
      session,
      videos,
    );

    const fgStart = fgRows.length;
    for (const frameGroup of session.frameGroups.values()) {
      if (!frameGroup.instanceGroups.length) continue;

      const igStart = igRows.length;
      for (const group of frameGroup.instanceGroups) {
        const memberStart = memberRows.length;
        for (const m of instanceGroupMemberRows(
          group,
          session,
          frameGroup,
          labeledFrameIndex,
        )) {
          memberRows.push(m);
          memberOwners.push([group, session.cameraGroup.cameras[m[0]]]);
        }
        const memberEnd = memberRows.length;

        // Identity → catalog index (-1 when unset / not registered).
        let identityIdx = -1;
        if (group.identity && identities) {
          identityIdx = identities.indexOf(group.identity);
          if (identityIdx < 0) {
            console.warn(
              `InstanceGroup references an Identity ("${group.identity.name}") not found in Labels.identities — identity will be dropped on save.`,
            );
          }
        }

        const score = group.score != null ? group.score : Number.NaN;

        // 3-D points → points_3d / pred_points_3d row range (NaN = missing keypoint).
        let pts3dStart = -1;
        let pts3dEnd = -1;
        let pts3dPredicted = 0;
        let i3dScore = Number.NaN;
        const inst3d = group.instance3d;
        const points3d = inst3d?.points ?? group.points;
        if (points3d) {
          const isPred =
            inst3d instanceof PredictedInstance3D && inst3d.pointScores != null;
          if (isPred) {
            const scores = (inst3d as PredictedInstance3D)
              .pointScores as number[];
            pts3dStart = predPts3dRows.length;
            points3d.forEach((row, i) => {
              const xyz = coerce3dRow(row, 3);
              const s = scores[i];
              predPts3dRows.push([
                xyz[0],
                xyz[1],
                xyz[2],
                s == null ? Number.NaN : Number(s),
              ]);
            });
            pts3dEnd = predPts3dRows.length;
            pts3dPredicted = 1;
          } else {
            pts3dStart = pts3dRows.length;
            for (const row of points3d) pts3dRows.push(coerce3dRow(row, 3));
            pts3dEnd = pts3dRows.length;
          }
          if (inst3d?.score != null) i3dScore = inst3d.score;
        }

        igOwners.push([group]);
        igRows.push([
          identityIdx,
          score,
          i3dScore,
          pts3dStart,
          pts3dEnd,
          pts3dPredicted,
          memberStart,
          memberEnd,
        ]);
        igMeta.push(
          group.metadata && Object.keys(group.metadata).length
            ? JSON.stringify(group.metadata)
            : "",
        );
      }
      const igEnd = igRows.length;
      fgRows.push([frameGroup.frameIdx, igStart, igEnd]);
      fgOwners.push([frameGroup]);
      fgMeta.push(
        frameGroup.metadata && Object.keys(frameGroup.metadata).length
          ? JSON.stringify(frameGroup.metadata)
          : "",
      );
    }
    const fgEnd = fgRows.length;

    // Session metadata goes at the top level of the entry, as Python sleap-io
    // writes it (`session_dict.update(session.metadata)`); the keys of the
    // session's structure win over metadata keys of the same name.
    sessionsJson.push(
      JSON.stringify({
        ...(session.metadata ?? {}),
        calibration,
        camcorder_to_video_idx_map,
        fg_start: fgStart,
        fg_end: fgEnd,
      }),
    );
  }

  file.create_dataset({ name: "sessions_json", data: sessionsJson });

  // Columnar /session_data group — only when some session has frame groups.
  if (fgRows.length > 0) {
    file.create_group("session_data");
  }
  if (fgRows.length > 0 && v3) {
    // Format 3.0: the three tables as groups of resizable columns.
    const tables: Array<
      [string, number[][], string[], Array<[string, ColumnType]>, unknown[][]]
    > = [
      [
        "frame_groups",
        fgRows,
        SESSION_FRAME_GROUP_FIELDS,
        V3_FRAME_GROUP_COLUMNS,
        fgOwners,
      ],
      [
        "instance_groups",
        igRows,
        SESSION_INSTANCE_GROUP_FIELDS,
        V3_INSTANCE_GROUP_COLUMNS,
        igOwners,
      ],
      [
        "instance_group_members",
        memberRows,
        SESSION_INSTANCE_GROUP_MEMBER_FIELDS,
        V3_MEMBER_COLUMNS,
        memberOwners,
      ],
    ];
    for (const [name, rows, fields, spec, owners] of tables) {
      const table = `session_data/${name}`;
      writeColumnTable(file, table, rowColumns(rows, fields, spec), {
        resizable: true,
        carried: v3.carry.columnsFor(table, owners),
      });
    }
  } else if (fgRows.length > 0) {
    createMatrixDataset(
      file,
      "session_data/frame_groups",
      fgRows,
      SESSION_FRAME_GROUP_FIELDS,
      "<d",
    );
    createMatrixDataset(
      file,
      "session_data/instance_groups",
      igRows,
      SESSION_INSTANCE_GROUP_FIELDS,
      "<d",
    );
    createMatrixDataset(
      file,
      "session_data/instance_group_members",
      memberRows,
      SESSION_INSTANCE_GROUP_MEMBER_FIELDS,
      "<d",
    );
  }
  if (fgRows.length > 0) {
    if (pts3dRows.length > 0) {
      createGzipFloatMatrix(file, "session_data/points_3d", pts3dRows, 3);
    }
    if (predPts3dRows.length > 0) {
      createGzipFloatMatrix(
        file,
        "session_data/pred_points_3d",
        predPts3dRows,
        4,
      );
    }
    // Per-row metadata JSON blobs, presence-guarded (omitted when all empty).
    if (fgMeta.some((s) => s.length > 0)) {
      file.create_dataset({
        name: "session_data/frame_group_meta",
        data: fgMeta,
      });
    }
    if (igMeta.some((s) => s.length > 0)) {
      file.create_dataset({
        name: "session_data/instance_group_meta",
        data: igMeta,
      });
    }
  }
}

// One-time warning keys for the point-count enforcement below (avoids log spam
// across 100k+ frames when an upstream produced malformed instances).
const _spanWarned = new Set<string>();

/**
 * Push exactly `nNodes` point rows for `instance` into `target`, enforcing the SLP
 * invariant that an instance's point count equals its skeleton's node count. Python
 * `read_instances` requires `point_id_end - point_id_start == n_nodes`; an instance
 * that somehow holds a different number of points (e.g. built from a coordinate array
 * whose length ≠ the skeleton — see `pointsFromArray`) would otherwise write an
 * inconsistent span that breaks the Python reader (luc3d#161). Missing points are
 * padded as invisible `NaN` rows and any extras are dropped, warning once.
 *
 * `predicted` selects a 5-col row (x, y, visible, complete, score) vs 4-col.
 */
function emitInstancePoints(
  target: number[][],
  instance: Instance | PredictedInstance,
  predicted: boolean,
): void {
  const nNodes = instance.skeleton.nodeNames.length;
  const pts = instance.points;
  if (pts.length !== nNodes && !_spanWarned.has(instance.skeleton.name ?? "")) {
    _spanWarned.add(instance.skeleton.name ?? "");
    console.warn(
      `Instance has ${pts.length} point(s) but its skeleton "${instance.skeleton.name ?? "?"}" has ${nNodes} node(s); ` +
        "padding/truncating to the node count so the written SLP stays self-consistent (a mismatch would break the Python reader).",
    );
  }
  // Unlabelled points (neither labelled nor visible) are written as absent:
  // the 2.x layout has no `labeled` column (see enforceLegacyLayout).
  const labeled = instance._labeled;
  for (let i = 0; i < nNodes; i++) {
    const p = pts[i];
    if (p) {
      const absent = labeled !== null && !labeled[i] && !p.visible;
      const row = absent
        ? [Number.NaN, Number.NaN, 0, p.complete ? 1 : 0]
        : [p.xy[0], p.xy[1], p.visible ? 1 : 0, p.complete ? 1 : 0];
      if (predicted) row.push((p as { score?: number }).score ?? 0);
      target.push(row);
    } else {
      target.push(
        predicted
          ? [Number.NaN, Number.NaN, 0, 0, 0]
          : [Number.NaN, Number.NaN, 0, 0],
      );
    }
  }
}

/** The five mutable label tables as `number[][]` matrices (shared row builder). */
export interface LabelTableRows {
  frames: number[][];
  instances: number[][];
  points: number[][];
  predPoints: number[][];
  negativeFrames: number[][];
}

/** Build the `negative_frames` rows (`[video_id, frame_idx]`), in frame order. */
function buildNegativeFrameRows(labels: Labels): number[][] {
  const rows: number[][] = [];
  for (const frame of labels.labeledFrames) {
    if (!frame.isNegative) continue;
    const videoIndex = Math.max(0, labels.videos.indexOf(frame.video));
    rows.push([videoIndex, frame.frameIdx]);
  }
  return rows;
}

/**
 * Build the `frames`/`instances`/`points`/`pred_points`/`negative_frames` row
 * matrices from `labels`, exactly as the eager writer would serialize them.
 *
 * Shared by {@link writeLabeledFrames} (the full save path) and
 * {@link buildLabelTableUpdate} (the in-place save path) so both emit
 * byte-identical columns using the same field-name constants. Contains no HDF5
 * I/O — pure `Labels` → `number[][]`.
 *
 * Content loaded with `format3: "view"` (the labels, or any frame, instance or
 * annotation) is refused, since a caller may build an in-place update from
 * these rows by hand. Unlabelled points are written as absent; for the
 * `unlabeledAs` rule and the metadata warning, use {@link buildLabelTableUpdate}.
 *
 * @throws {SlpViewOnlyError} For view-only labels or records.
 */
export function buildLabelTableRows(labels: Labels): LabelTableRows {
  refuseViewOnly(labels);
  refuseViewOnlyRecords(labels.labeledFrames, labels._staticRois);
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

      const skeletonId = skeletonIdForWrite(
        labels.skeletons,
        instance,
        labeledFrame,
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
        emitInstancePoints(predPoints, instance, true);
        pointEnd = predPoints.length;
      } else {
        pointStart = points.length;
        emitInstancePoints(points, instance as Instance, false);
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

  return {
    frames,
    instances,
    points,
    predPoints,
    negativeFrames: buildNegativeFrameRows(labels),
  };
}

function writeLabeledFrames(file: any, labels: Labels): void {
  const { frames, instances, points, predPoints } = buildLabelTableRows(labels);

  // `frames` stays a flat int matrix (Python reads it positionally), written
  // CHUNKED + unlimited (resizable=true) so it can be resized in place on an edit
  // re-save. The pose tables are HDF5 COMPOUND with integer id columns — so files
  // open in Python sleap-io / the PyQt GUI (#218) — AND chunked + unlimited, so
  // the fast in-place edit-save can patch them via write_slice / resize without
  // rewriting the embedded video groups. See createCompoundDataset /
  // writeLabelTablesInPlace.
  createMatrixDataset(file, "frames", frames, FRAMES_FIELDS, "<i8", true);
  createCompoundDataset(file, "instances", instances, INSTANCE_COMPOUND_FIELDS);
  createCompoundDataset(file, "points", points, POINT_COMPOUND_FIELDS);
  createCompoundDataset(
    file,
    "pred_points",
    predPoints,
    PRED_POINT_COMPOUND_FIELDS,
  );
}

function writeNegativeFrames(file: any, labels: Labels): void {
  const rows = buildNegativeFrameRows(labels);
  if (!rows.length) return;
  createCompoundDataset(
    file,
    "negative_frames",
    rows,
    NEGATIVE_FRAME_COMPOUND_FIELDS,
  );
}

// ===========================================================================
// Format 3.0 pose tables
//
// `/frames`, `/instances`, `/points` and `/pred_points` as groups of 1-D
// columns, exactly as Python sleap-io 0.10 lays them out: no id columns (the
// row number is the id), `frames/video` as the index into the videos list,
// `frames/is_negative` in place of `/negative_frames`, points with `verified`
// (the 2.x `complete`) and `labeled` written as `labeled | visible`, and the
// coordinates of unlabelled points as NaN. Flags are uint8 (see
// write-columns.ts). Record metadata goes to `<table>/metadata/`.
// ===========================================================================

/** Column names and types of the 3.0 pose tables (Python's raw layouts). */
const V3_FRAME_COLUMNS: Array<[string, ColumnType]> = [
  ["video", "i8"],
  ["frame_idx", "i8"],
  ["instance_id_start", "i8"],
  ["instance_id_end", "i8"],
  ["is_negative", "bool"],
];
const V3_INSTANCE_COLUMNS: Array<[string, ColumnType]> = [
  ["instance_type", "u1"],
  ["frame_id", "i8"],
  ["skeleton", "i8"],
  ["track", "i8"],
  ["from_predicted", "i8"],
  ["score", "f8"],
  ["point_id_start", "i8"],
  ["point_id_end", "i8"],
  ["tracking_score", "f8"],
];
const V3_POINT_COLUMNS: Array<[string, ColumnType]> = [
  ["x", "f8"],
  ["y", "f8"],
  ["visible", "bool"],
  ["verified", "bool"],
  ["labeled", "bool"],
];
const V3_PRED_POINT_COLUMNS: Array<[string, ColumnType]> = [
  ...V3_POINT_COLUMNS,
  ["score", "f8"],
];

/** The pose tables of a format 3.0 file, as columns of numbers. */
interface PoseColumnsV3 {
  frames: Record<string, number[]>;
  instances: Record<string, number[]>;
  points: Record<string, number[]>;
  predPoints: Record<string, number[]>;
}

/** Empty columns for each name of `spec`. */
function emptyColumns(
  spec: Array<[string, ColumnType]>,
): Record<string, number[]> {
  return Object.fromEntries(spec.map(([name]) => [name, [] as number[]]));
}

/**
 * Push the points of `instance` onto 3.0 point columns, exactly `nNodes`
 * rows, as {@link emitInstancePoints} does for the 2.x layout: missing points
 * are absent (labelled, hidden, no location), extras are dropped.
 */
function emitInstancePointsV3(
  target: Record<string, number[]>,
  instance: Instance | PredictedInstance,
  predicted: boolean,
): void {
  const nNodes = instance.skeleton.nodeNames.length;
  const n = instance._n;
  if (n !== nNodes && !_spanWarned.has(instance.skeleton.name ?? "")) {
    _spanWarned.add(instance.skeleton.name ?? "");
    console.warn(
      `Instance has ${n} point(s) but its skeleton "${instance.skeleton.name ?? "?"}" has ${nNodes} node(s); ` +
        "padding/truncating to the node count so the written SLP stays self-consistent (a mismatch would break the Python reader).",
    );
  }
  const xy = instance._xy;
  const visible = instance._visible;
  const complete = instance._complete;
  const labeledCol = instance._labeled;
  const score = instance._score;
  for (let i = 0; i < nNodes; i++) {
    if (i < n) {
      const vis = visible[i] ? 1 : 0;
      const labeled = labeledCol && !labeledCol[i] && !vis ? 0 : 1;
      target.x.push(labeled ? xy[2 * i] : Number.NaN);
      target.y.push(labeled ? xy[2 * i + 1] : Number.NaN);
      target.visible.push(vis);
      target.verified.push(complete[i] ? 1 : 0);
      target.labeled.push(labeled);
      // A missing point score is NaN in format 3.0, as Python's "none".
      if (predicted) target.score.push(score ? score[i] : Number.NaN);
    } else {
      target.x.push(Number.NaN);
      target.y.push(Number.NaN);
      target.visible.push(0);
      target.verified.push(0);
      target.labeled.push(1);
      if (predicted) target.score.push(0);
    }
  }
}

/**
 * Build the format 3.0 pose tables of eager labels, in the order the 2.x
 * writer uses (frames, and their instances, as `labels.labeledFrames` holds
 * them).
 */
function buildPoseColumnsV3(labels: Labels): PoseColumnsV3 {
  const frames = emptyColumns(V3_FRAME_COLUMNS);
  const instances = emptyColumns(V3_INSTANCE_COLUMNS);
  const points = emptyColumns(V3_POINT_COLUMNS);
  const predPoints = emptyColumns(V3_PRED_POINT_COLUMNS);
  const instanceIndex = new Map<Instance, number>();
  const predictedLinks: Array<[number, PredictedInstance]> = [];
  let nInstances = 0;
  for (const labeledFrame of labels.labeledFrames) {
    const frameId = frames.video.length;
    const instanceStart = nInstances;
    for (const instance of labeledFrame.instances) {
      const instanceId = nInstances++;
      instanceIndex.set(instance as Instance, instanceId);
      const predicted = instance instanceof PredictedInstance;
      const target = predicted ? predPoints : points;
      const pointStart = target.x.length;
      emitInstancePointsV3(target, instance, predicted);
      if (!predicted && instance.fromPredicted) {
        predictedLinks.push([instanceId, instance.fromPredicted]);
      }
      instances.instance_type.push(predicted ? 1 : 0);
      instances.frame_id.push(frameId);
      instances.skeleton.push(
        skeletonIdForWrite(labels.skeletons, instance, labeledFrame),
      );
      instances.track.push(
        instance.track ? labels.tracks.indexOf(instance.track) : -1,
      );
      instances.from_predicted.push(-1);
      instances.score.push(
        predicted ? ((instance as PredictedInstance).score ?? 0) : 0,
      );
      instances.point_id_start.push(pointStart);
      instances.point_id_end.push(target.x.length);
      // A user instance's tracking score of 0 is this model's "none", which
      // format 3.0 stores as NaN, as Python does.
      instances.tracking_score.push(
        !predicted && !instance.trackingScore
          ? Number.NaN
          : (instance.trackingScore ?? Number.NaN),
      );
    }
    frames.video.push(Math.max(0, labels.videos.indexOf(labeledFrame.video)));
    frames.frame_idx.push(labeledFrame.frameIdx);
    frames.instance_id_start.push(instanceStart);
    frames.instance_id_end.push(nInstances);
    frames.is_negative.push(labeledFrame.isNegative ? 1 : 0);
  }
  for (const [instanceId, source] of predictedLinks) {
    instances.from_predicted[instanceId] =
      instanceIndex.get(source as unknown as Instance) ?? -1;
  }
  return { frames, instances, points, predPoints };
}

/**
 * The kind each metadata key of `table` was read as, from the source formats
 * of `records` (a key read as float stays float).
 */
function metadataKindHint(
  records: Iterable<object>,
  table: "instances" | "frames" | "bboxes",
): (key: string) => MetadataKind | undefined {
  const kinds = new Map<string, MetadataKind>();
  const seen = new Set<SlpSourceFormat>();
  for (const record of records) {
    const mark = sourceMarkOf(record);
    if (!mark?.metadataKinds || seen.has(mark)) continue;
    seen.add(mark);
    for (const [key, kind] of Object.entries(mark.metadataKinds[table])) {
      if (kinds.get(key) !== "float") kinds.set(key, kind);
    }
  }
  return (key) => kinds.get(key);
}

/** Columns of `spec`, with `values` from `columns`, ready to write. */
function specColumns(
  spec: Array<[string, ColumnType]>,
  columns: Record<string, ArrayLike<number>>,
): Column[] {
  return spec.map(([name, type]) => ({ name, type, values: columns[name] }));
}

/**
 * The per-row owner keys of the 3.0 pose tables of eager labels, for unknown
 * columns (see column-carry.ts): frames, instances, and the instances owning
 * the point rows (with their point arrays).
 */
function poseCarryKeys(labels: Labels): {
  frames: unknown[][];
  instances: unknown[][];
  points: unknown[][];
  predPoints: unknown[][];
} {
  const frames: unknown[][] = [];
  const instances: unknown[][] = [];
  const points: unknown[][] = [];
  const predPoints: unknown[][] = [];
  for (const frame of labels.labeledFrames) {
    frames.push([frame]);
    for (const instance of frame.instances) {
      instances.push([instance]);
      (instance instanceof PredictedInstance ? predPoints : points).push([
        instance,
        instance._xy,
      ]);
    }
  }
  return { frames, instances, points, predPoints };
}

/**
 * Write the 3.0 pose tables of eager labels, with their record metadata and
 * any unknown columns kept from the file they were loaded from.
 *
 * @throws {TypeError} If a metadata key mixes kinds (checked before writing
 *   by the caller, see {@link checkV3Metadata}).
 */
function writePoseTablesV3(
  file: any,
  labels: Labels,
  carry: CarrySession,
): void {
  const pose = buildPoseColumnsV3(labels);
  const keys = poseCarryKeys(labels);
  const allInstances = labels.labeledFrames.flatMap((f) => f.instances);
  writeColumnTable(file, "points", specColumns(V3_POINT_COLUMNS, pose.points), {
    carried: carry.columnsFor("points", keys.points),
  });
  writeColumnTable(
    file,
    "pred_points",
    specColumns(V3_PRED_POINT_COLUMNS, pose.predPoints),
    { carried: carry.columnsFor("pred_points", keys.predPoints) },
  );
  writeColumnTable(
    file,
    "instances",
    specColumns(V3_INSTANCE_COLUMNS, pose.instances),
    { carried: carry.columnsFor("instances", keys.instances) },
  );
  writeMetadataColumns(
    file,
    "instances",
    metadataColumnsOf(
      allInstances,
      "instances",
      metadataKindHint(allInstances, "instances"),
    ),
  );
  writeColumnTable(file, "frames", specColumns(V3_FRAME_COLUMNS, pose.frames), {
    carried: carry.columnsFor("frames", keys.frames),
  });
  writeMetadataColumns(
    file,
    "frames",
    metadataColumnsOf(
      labels.labeledFrames,
      "frames",
      metadataKindHint(labels.labeledFrames, "frames"),
    ),
  );
}

/**
 * Check the record metadata of eager labels can be written in format 3.0
 * (one kind per key), before anything is written.
 *
 * @throws {TypeError} Naming the table and key of a key that mixes kinds.
 */
function checkV3Metadata(
  frames: readonly LabeledFrame[],
  extraBoxes: readonly BoundingBox[] = [],
): void {
  metadataColumnsOf(frames, "frames");
  metadataColumnsOf(
    frames.flatMap((f) => f.instances),
    "instances",
  );
  metadataColumnsOf(
    [...frames.flatMap((f) => f.bboxes), ...extraBoxes],
    "bboxes",
  );
}

/**
 * Whether the raw pose tables of a lazy store can be written as format 3.0
 * columns row for row: the ids are the row numbers, every instance row lies
 * in its frame's range, and the coordinates need no conversion. Otherwise the
 * lazy save materializes and writes the frames.
 */
function lazyStoreWritableAsV3(store: LazyDataStore): boolean {
  if (store.formatId < 1.1) return false;
  const fd = store.framesData;
  const idn = store.instancesData;
  const nFrames = (fd.frame_idx ?? []).length;
  const nInst = (idn.instance_type ?? []).length;
  const frameIds = fd.frame_id ?? [];
  const instIds = idn.instance_id ?? [];
  for (let i = 0; i < frameIds.length; i++) {
    if (Number(frameIds[i]) !== i) return false;
  }
  for (let i = 0; i < instIds.length; i++) {
    if (Number(instIds[i]) !== i) return false;
  }
  let expected = 0;
  for (let r = 0; r < nFrames; r++) {
    const start = numAt(fd.instance_id_start, r);
    const end = numAt(fd.instance_id_end, r);
    if (start !== expected || end < start) return false;
    for (let j = start; j < end; j++) {
      if (numAt(idn.frame_id, j) !== r) return false;
    }
    expected = end;
  }
  if (expected !== nInst) return false;
  // Negative frames without a frame row would need rows of their own.
  if (store.negativeFrames.size > 0) {
    const rows = new Set<string>();
    for (let r = 0; r < nFrames; r++) {
      rows.add(`${numAt(fd.video, r)}:${numAt(fd.frame_idx, r)}`);
    }
    for (const key of store.negativeFrames) if (!rows.has(key)) return false;
  }
  return true;
}

/**
 * Write the 3.0 pose tables of a lazy store from its raw rows, without
 * materializing: the store's metadata columns and unknown columns are written
 * back as they were read. Call only when {@link lazyStoreWritableAsV3}.
 */
function writeLazyPoseTablesV3(file: any, store: LazyDataStore): void {
  const fd = store.framesData;
  const idn = store.instancesData;
  const nFrames = (fd.frame_idx ?? []).length;
  const nInst = (idn.instance_type ?? []).length;
  const videoIdMap = buildVideoIdMap(fd, store.videos);
  const isNegative = new Uint8Array(nFrames);
  const video = new Float64Array(nFrames);
  for (let r = 0; r < nFrames; r++) {
    const raw = numAt(fd.video, r);
    video[r] = videoIdMap.get(raw) ?? raw;
    if (store.negativeFrames.has(`${raw}:${numAt(fd.frame_idx, r)}`)) {
      isNegative[r] = 1;
    }
  }
  const formatId = store.formatId;
  const trackingScore = new Float64Array(nInst);
  for (let i = 0; i < nInst; i++) {
    const raw = formatId < 1.2 ? 0 : numAt(idn.tracking_score, i);
    // As the readers: NaN reads as 0 before 3.0. A user instance's 0 (no
    // score) is NaN in format 3.0, as the eager writer writes it.
    const read = Number.isNaN(raw) && formatId < 3 ? 0 : raw;
    trackingScore[i] =
      numAt(idn.instance_type, i) === 0 && !read ? Number.NaN : read;
  }
  const col = (table: Record<string, any>, name: string, def: number) => {
    const values = table[name];
    if (values && values.length === (table === fd ? nFrames : nInst)) {
      return values as ArrayLike<number>;
    }
    return new Float64Array(table === fd ? nFrames : nInst).fill(def);
  };
  const pointColumns = (
    table: Record<string, any>,
    predicted: boolean,
  ): Column[] => {
    const n = (table.x ?? []).length;
    const x = Float64Array.from(table.x ?? [], Number);
    const y = Float64Array.from(table.y ?? [], Number);
    const visible = new Uint8Array(n);
    const verified = new Uint8Array(n);
    const labeled = new Uint8Array(n);
    const vis = table.visible ?? [];
    const ver = table.verified ?? table.complete ?? [];
    const lab = table.labeled;
    for (let i = 0; i < n; i++) {
      visible[i] = Number(vis[i] ?? 0) ? 1 : 0;
      verified[i] = Number(ver[i] ?? 0) ? 1 : 0;
      labeled[i] = !lab || Number(lab[i]) || visible[i] ? 1 : 0;
      if (!labeled[i]) {
        x[i] = Number.NaN;
        y[i] = Number.NaN;
      }
    }
    const out: Column[] = [
      { name: "x", type: "f8", values: x },
      { name: "y", type: "f8", values: y },
      { name: "visible", type: "bool", values: visible },
      { name: "verified", type: "bool", values: verified },
      { name: "labeled", type: "bool", values: labeled },
    ];
    if (predicted) {
      const score = table.score;
      out.push({
        name: "score",
        type: "f8",
        values:
          score && score.length === n
            ? Float64Array.from(score, Number)
            : new Float64Array(n).fill(Number.NaN),
      });
    }
    return out;
  };
  const unknown = store.unknownColumns ?? {};
  writeColumnTable(file, "points", pointColumns(store.pointsData, false), {
    carried: unknown.points,
  });
  writeColumnTable(
    file,
    "pred_points",
    pointColumns(store.predPointsData, true),
    {
      carried: unknown.pred_points,
    },
  );
  writeColumnTable(
    file,
    "instances",
    [
      {
        name: "instance_type",
        type: "u1",
        values: col(idn, "instance_type", 0),
      },
      { name: "frame_id", type: "i8", values: col(idn, "frame_id", 0) },
      { name: "skeleton", type: "i8", values: col(idn, "skeleton", 0) },
      { name: "track", type: "i8", values: col(idn, "track", -1) },
      {
        name: "from_predicted",
        type: "i8",
        values: col(idn, "from_predicted", -1),
      },
      { name: "score", type: "f8", values: col(idn, "score", 0) },
      {
        name: "point_id_start",
        type: "i8",
        values: col(idn, "point_id_start", 0),
      },
      { name: "point_id_end", type: "i8", values: col(idn, "point_id_end", 0) },
      { name: "tracking_score", type: "f8", values: trackingScore },
    ],
    { carried: unknown.instances },
  );
  writeMetadataColumns(file, "instances", store.instanceMetadata);
  writeColumnTable(
    file,
    "frames",
    [
      { name: "video", type: "i8", values: video },
      { name: "frame_idx", type: "i8", values: col(fd, "frame_idx", 0) },
      {
        name: "instance_id_start",
        type: "i8",
        values: col(fd, "instance_id_start", 0),
      },
      {
        name: "instance_id_end",
        type: "i8",
        values: col(fd, "instance_id_end", 0),
      },
      { name: "is_negative", type: "bool", values: isNegative },
    ],
    { carried: unknown.frames },
  );
  writeMetadataColumns(file, "frames", store.frameMetadata);
}

// ===========================================================================
// Fast in-place label save (edit re-save)
//
// Re-save an existing `.pkg.slp` by patching ONLY the small label tables
// (frames/instances/points/pred_points/negative_frames) + the /metadata `json`
// attribute, NEVER reading or writing the multi-GB embedded `video{i}/video`
// groups. On a network share this makes an edit-save ~100x faster (no re-copy of
// the embedded images). Feasibility + primitives were validated against h5wasm:
// `write_slice` (same-shape overwrite) works on flat AND compound datasets with
// ZERO file growth; `resize` (H5Dset_extent) grows/shrinks chunked+unlimited
// datasets in place. Python-written files store points `visible`/`complete` as an
// HDF5 enum/bool (typeClass 8) that h5wasm cannot write — such files must fall
// back to a full re-save (see checkInPlaceWritable).
// ===========================================================================

/** HDF5 datatype class id for an enum member (bool/enum) — not writable by h5wasm. */
const H5T_ENUM_CLASS = 8;
/** HDF5 datatype class id for a float member. */
const H5T_FLOAT_CLASS = 1;

/** One label table as logical rows + its column (field) names. */
export interface LabelTable {
  fields: string[];
  rows: number[][];
}

/**
 * The small, mutable structure of a `.pkg.slp`, ready to patch in place. Each
 * table is `{ fields, rows }` (logical `number[][]`, layout-agnostic — the writer
 * packs it into whatever on-disk layout the target dataset uses). `metadataJson`
 * is set only when metadata actually changed (caller decides) so a value-only
 * pose edit leaves the `/metadata` attribute untouched.
 */
export interface LabelTableUpdate {
  frames: LabelTable;
  instances: LabelTable;
  points: LabelTable;
  predPoints: LabelTable;
  negativeFrames?: LabelTable;
  metadataJson?: string;
  /**
   * The `sourceFormat` of the labels the update was built from (see
   * `Labels.sourceFormat`). A view-only source is refused by every in-place
   * function; labels loaded from a 3.0 file with `format3: "edit"` build a
   * 2.x update, which never patches their 3.0 file.
   */
  sourceFormat?: SlpSourceFormat | null;
  /**
   * The layout of the update: absent or `"v2"` for the 2.x tables
   * (`fields` as the 2.x columns, plus `negativeFrames`), `"v3"` for format
   * 3.0 (`fields` as the 3.0 columns of each pose table, `is_negative` in
   * `frames`, and {@link metadata}). A 3.0 update patches a 3.0 file column by
   * column.
   */
  layout?: SlpLayout;
  /** Format 3.0: the record metadata of `/instances` and `/frames`. */
  metadata?: {
    instances: Record<string, MetadataColumn>;
    frames: Record<string, MetadataColumn>;
  };
  /**
   * Format 3.0: `false` when the labels carry unknown columns of the pose
   * tables whose rows no longer line up with the records (see
   * column-carry.ts); the file then needs a full save, which drops them.
   */
  unknownColumnsAligned?: boolean;
}

/** Rows of `columns` (one per row) in the order of `spec`. */
function columnsToRows(
  spec: ReadonlyArray<[string, ColumnType]>,
  columns: Record<string, number[]>,
): { fields: string[]; rows: number[][] } {
  const fields = spec.map(([name]) => name);
  const n = (columns[fields[0]] ?? []).length;
  const rows: number[][] = new Array(n);
  for (let i = 0; i < n; i++) rows[i] = fields.map((f) => columns[f][i]);
  return { fields, rows };
}

/** The format 3.0 {@link LabelTableUpdate} of `labels`. */
function buildLabelTableUpdateV3(
  labels: Labels,
  opts?: { metadataJson?: string; unlabeledAs?: UnlabeledAs },
): LabelTableUpdate {
  if (labels.isLazy) labels.materialize();
  enforceV3Layout(
    framesLegacyLosses(labels.labeledFrames, labels._staticRois),
    opts?.unlabeledAs,
  );
  const pose = buildPoseColumnsV3(labels);
  const allInstances = labels.labeledFrames.flatMap((f) => f.instances);
  // Unknown pose columns stay where they are on disk, so the records must
  // still be the ones they were read with.
  const keys = poseCarryKeys(labels);
  let aligned = true;
  const carry = labels._carriedColumns;
  for (const [table, k] of [
    ["frames", keys.frames],
    ["instances", keys.instances],
    ["points", keys.points],
    ["pred_points", keys.predPoints],
  ] as const) {
    const carried = carry?.tables.get(table);
    if (!carried) continue;
    const owners = carried.owners;
    if (
      !owners ||
      owners.length !== k.length ||
      !owners.every(
        (o, i) => o.length === k[i].length && o.every((x, j) => x === k[i][j]),
      )
    ) {
      aligned = false;
    }
  }
  const update: LabelTableUpdate = {
    frames: columnsToRows(V3_FRAME_COLUMNS, pose.frames),
    instances: columnsToRows(V3_INSTANCE_COLUMNS, pose.instances),
    points: columnsToRows(V3_POINT_COLUMNS, pose.points),
    predPoints: columnsToRows(V3_PRED_POINT_COLUMNS, pose.predPoints),
    layout: "v3",
    metadata: {
      instances: metadataColumnsOf(
        allInstances,
        "instances",
        metadataKindHint(allInstances, "instances"),
      ),
      frames: metadataColumnsOf(
        labels.labeledFrames,
        "frames",
        metadataKindHint(labels.labeledFrames, "frames"),
      ),
    },
    unknownColumnsAligned: aligned,
  };
  if (opts?.metadataJson !== undefined) update.metadataJson = opts.metadataJson;
  if (labels.sourceFormat) update.sourceFormat = labels.sourceFormat;
  return update;
}

/**
 * Build a {@link LabelTableUpdate} from `labels` — the in-place counterpart to
 * the eager writer. Reuses {@link buildLabelTableRows} so the columns are
 * byte-identical to a full save. `negativeFrames` is always included (possibly
 * with 0 rows) so an in-place save can also empty an existing `negative_frames`
 * table when the user removed all negative frames. Pass `opts.metadataJson`
 * (e.g. from {@link buildMetadataJson}) only when metadata changed.
 *
 * The layout follows `opts.slpVersion` (default `"auto"`, decided without a
 * warning, see {@link resolveSlpVersion}): labels loaded from a format 3.0 file
 * (without `format3: "edit"`) build a 3.0 update, patched into their file
 * column by column. A 3.0 update of lazy labels materializes them.
 *
 * @returns The update. For a 3.0 update of lazy labels, the labels are
 *   materialized first (`labels.materialize()`), so they are eager afterwards.
 * @throws {SlpViewOnlyError} For labels loaded with `format3: "view"`.
 * @throws {Error} For unlabelled points with `unlabeledAs: "error"` (see
 *   {@link UnlabeledAs}), in the 2.x layout.
 */
export function buildLabelTableUpdate(
  labels: Labels,
  opts?: {
    metadataJson?: string;
    unlabeledAs?: UnlabeledAs;
    slpVersion?: SlpVersion;
  },
): LabelTableUpdate {
  refuseViewOnly(labels);
  const layout = resolveSlpVersion(labels, checkSlpVersion(opts?.slpVersion), {
    warn: false,
  });
  if (layout === "v3") return buildLabelTableUpdateV3(labels, opts);
  enforceLegacyLayout(
    framesLegacyLosses(labels.labeledFrames, labels._staticRois),
    opts?.unlabeledAs,
  );
  const r = buildLabelTableRows(labels);
  // The NaN tracking scores the readers read as 0 are patched back as NaN,
  // for the instances read with one (by record, so an edit that replaces an
  // instance does not give its NaN to another).
  let row = 0;
  for (const frame of labels.labeledFrames) {
    for (const instance of frame.instances) {
      if (instance.trackingScore === 0 && hadNanTrackingScore(instance)) {
        r.instances[row][9] = Number.NaN;
      }
      row += 1;
    }
  }
  const update: LabelTableUpdate = {
    frames: { fields: FRAMES_FIELDS, rows: r.frames },
    instances: { fields: INSTANCES_FIELDS, rows: r.instances },
    points: { fields: POINTS_FIELDS, rows: r.points },
    predPoints: { fields: PRED_POINTS_FIELDS, rows: r.predPoints },
    negativeFrames: { fields: NEGATIVE_FRAMES_FIELDS, rows: r.negativeFrames },
  };
  if (opts?.metadataJson !== undefined) update.metadataJson = opts.metadataJson;
  if (labels.sourceFormat) update.sourceFormat = labels.sourceFormat;
  return update;
}

/** One on-disk compound member's identity (for the writability gate). */
export interface OnDiskMember {
  name: string;
  /** HDF5 datatype class id (`H5Tget_class`): 0=int, 1=float, 8=enum. */
  typeClass: number;
  /** Member size in bytes. */
  size?: number;
  /** Whether the integer member is signed (h5wasm reports float as unsigned). */
  signed?: boolean;
  /** Rows of the column (`layout: "columns"` only). */
  rows?: number;
  /** For an enum member, its members' names and values. */
  enumMembers?: Record<string, number>;
}

/** On-disk shape/layout of one label table, as seen by the writability gate. */
export interface OnDiskTable {
  /** Current row count (axis-0 extent). */
  rows: number;
  /** Column count (matrix width, or compound member count). */
  cols: number;
  /**
   * Storage layout: a 2-D numeric matrix, a 1-D compound record dataset, or
   * (format 3.0) a group of 1-D columns.
   */
  layout: "flat" | "compound" | "columns";
  /** Whether the dataset is chunked (⇒ resizable on axis 0). */
  chunked?: boolean;
  /**
   * Compound members (`layout: "compound"`), or the group's columns
   * (`layout: "columns"`).
   */
  members?: OnDiskMember[];
  /**
   * Format 3.0: the record metadata on disk, by key (the kind of its
   * `values`, and whether it has a `present` column).
   */
  metadata?: Record<string, { kind: MetadataKind | null; present: boolean }>;
}

/** The on-disk state of the label tables the gate inspects. */
export interface OnDiskTables {
  frames?: OnDiskTable;
  instances?: OnDiskTable;
  points?: OnDiskTable;
  predPoints?: OnDiskTable;
  negativeFrames?: OnDiskTable;
}

/** Result of {@link checkInPlaceWritable}. */
export type InPlaceWritable = { ok: true } | { ok: false; reason: string };

/** Minimal `getDatasetMeta` shape consumed by {@link onDiskTableFromMeta}. */
export interface DatasetMetaLike {
  shape?: number[];
  metadata?: {
    chunks?: unknown;
    compound_type?: {
      members?: Array<{
        name: string;
        type: number;
        size?: number;
        signed?: boolean;
        enum_type?: { members?: Record<string, number> } | null;
      }>;
    };
  };
}

/**
 * Convert a `getDatasetMeta` result (from the streaming reader) into an
 * {@link OnDiskTable} for the writability gate. Returns `undefined` when the
 * dataset is absent. Detects compound vs flat from the presence of
 * `compound_type.members`, and resizability from the presence of `chunks`.
 */
export function onDiskTableFromMeta(
  meta: DatasetMetaLike | null | undefined,
): OnDiskTable | undefined {
  if (!meta || !Array.isArray(meta.shape)) return undefined;
  const md = meta.metadata;
  const members = md?.compound_type?.members;
  const chunked = !!md?.chunks;
  if (members && members.length > 0) {
    return {
      rows: meta.shape[0] ?? 0,
      cols: members.length,
      layout: "compound",
      chunked,
      members: members.map((m) => ({
        name: m.name,
        typeClass: m.type,
        size: m.size,
        signed: m.signed,
        ...(m.enum_type?.members
          ? { enumMembers: { ...m.enum_type.members } }
          : {}),
      })),
    };
  }
  return {
    rows: meta.shape[0] ?? 0,
    cols: meta.shape[1] ?? 1,
    layout: "flat",
    chunked,
  };
}

/**
 * Describe a format 3.0 table (a group of 1-D columns) for the writability
 * gate, from the `getDatasetMeta` result of each column (the worker's, or
 * h5wasm's `{ shape, metadata }`) and, for `/instances` and `/frames`, of each
 * metadata key's `values` (with its `kind` attribute, if any) and whether it
 * has `present`.
 */
export function onDiskColumnTableFromMeta(
  columns: Readonly<Record<string, DatasetMetaLike>>,
  metadata?: Readonly<
    Record<
      string,
      { values: DatasetMetaLike; kindAttr?: unknown; present: boolean }
    >
  >,
): OnDiskTable {
  const members: OnDiskMember[] = [];
  let rows = 0;
  for (const [name, meta] of Object.entries(columns)) {
    const md = meta.metadata as
      | {
          type?: number;
          size?: number;
          signed?: boolean;
          enum_type?: { members?: Record<string, number> } | null;
        }
      | undefined;
    if (!Array.isArray(meta.shape) || meta.shape.length !== 1) continue;
    rows = Math.max(rows, meta.shape[0] ?? 0);
    members.push({
      name,
      typeClass: md?.type ?? -1,
      size: md?.size,
      signed: md?.signed,
      rows: meta.shape[0] ?? 0,
      ...(md?.enum_type?.members
        ? { enumMembers: { ...md.enum_type.members } }
        : {}),
    });
  }
  const out: OnDiskTable = {
    rows,
    cols: members.length,
    layout: "columns",
    chunked: false,
    members,
  };
  if (metadata) {
    out.metadata = {};
    for (const [key, m] of Object.entries(metadata)) {
      const kind = metadataKindFromH5(
        {
          ...((m.values.metadata ?? {}) as object),
          shape: m.values.shape ?? null,
        } as Parameters<typeof metadataKindFromH5>[0],
        m.kindAttr,
      );
      // Readers ignore members they cannot read, and so does the gate.
      if (kind !== null) out.metadata[key] = { kind, present: m.present };
    }
  }
  return out;
}

/**
 * Describe the label tables of an open h5wasm file for the writability gate,
 * in whichever layout each is stored (see {@link onDiskTableFromMeta} and
 * {@link onDiskColumnTableFromMeta}).
 */
export function onDiskTablesFromFile(file: any): OnDiskTables {
  const node = (path: string): any => {
    try {
      return file.get(path) ?? null;
    } catch {
      return null;
    }
  };
  const describe = (name: string): OnDiskTable | undefined => {
    const n = node(name);
    if (!n) return undefined;
    if (n.type !== "Group") {
      return onDiskTableFromMeta({ shape: n.shape, metadata: n.metadata });
    }
    const columns: Record<string, DatasetMetaLike> = {};
    for (const child of n.keys() as string[]) {
      const ds = node(`${name}/${child}`);
      if (ds && ds.type !== "Group") {
        columns[child] = { shape: ds.shape, metadata: ds.metadata };
      }
    }
    let metadata:
      | Record<
          string,
          { values: DatasetMetaLike; kindAttr?: unknown; present: boolean }
        >
      | undefined;
    if (name === "instances" || name === "frames") {
      metadata = {};
      for (const key of readMetadataKeysInPlace(file, name)) {
        {
          const values = node(`${name}/metadata/${key}/values`);
          let kindAttr: unknown;
          try {
            kindAttr = values.attrs?.kind?.value;
          } catch {
            kindAttr = undefined;
          }
          metadata[key] = {
            values: { shape: values.shape, metadata: values.metadata },
            kindAttr,
            present: !!node(`${name}/metadata/${key}/present`),
          };
        }
      }
    }
    return onDiskColumnTableFromMeta(columns, metadata);
  };
  return {
    frames: describe("frames"),
    instances: describe("instances"),
    points: describe("points"),
    predPoints: describe("pred_points"),
    negativeFrames: describe("negative_frames"),
  };
}

/**
 * The JSON sidecar datasets/attribute that the in-place writer does NOT rewrite
 * but which the label tables reference by index — so an edit that changed any of
 * them would leave the (rewritten) tables pointing into stale sidecar data. The
 * gate compares these to prove the save is confined to the label tables (+ the
 * `/metadata` json attr). `tracks_json` / `suggestions_json` are the on-disk
 * per-element JSON string arrays; `metadataJson` is the `/metadata` `json`
 * attribute string. `null` means the dataset/attr is absent.
 *
 * The video SET is covered SEMANTICALLY via `videos` (per-video signatures, see
 * {@link buildVideoSignatures}) rather than a byte-exact `videos_json` compare.
 *
 * NOT covered here (the in-place path is only safe for edits that leave these
 * unchanged; the caller must guarantee it, and the app's post-write verify is the
 * final backstop): `identities_json`, `sessions_json`, and the annotation
 * datasets (rois/masks/bboxes/centroids/label_images) — their serializers are
 * complex and reproducing them risks spurious refusals. Extending the gate to
 * those is a follow-up.
 */
export interface OnDiskSidecars {
  tracksJson: string[] | null;
  suggestionsJson: string[] | null;
  metadataJson: string | null;
  /** Per-video signatures (see {@link buildVideoSignatures}). */
  videos: string[] | null;
}

/**
 * Serialize the sidecars a `labels` would write, for exact comparison against
 * {@link OnDiskSidecars} in {@link checkInPlaceWritable}. Reuses the same
 * serializers the full writer uses ({@link buildTracksJson},
 * {@link buildSuggestionsJson}, {@link buildMetadataJson}) so the comparison is
 * byte-exact.
 */
export function buildExpectedSidecars(labels: Labels): OnDiskSidecars {
  return {
    tracksJson: buildTracksJson(labels.tracks),
    suggestionsJson: buildSuggestionsJson(labels.suggestions, labels.videos),
    metadataJson: buildMetadataJson(labels),
    videos: buildVideoSignatures(labels.videos),
  };
}

/** Element-wise string-array equality (null treated as empty). */
function sameStringArray(a: string[] | null, b: string[] | null): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

/**
 * Decide whether `update` can be written into `onDisk` IN PLACE, or whether the
 * caller must fall back to a full re-save. NOT writable when:
 *  - any table's compound members include an HDF5 enum/bool (typeClass 8) —
 *    Python-written points store `visible`/`complete` this way and h5wasm cannot
 *    write them; OR
 *  - a table's row count changes (structural edit) but the on-disk dataset is
 *    contiguous (not chunked ⇒ not resizable) — an old file written before the
 *    chunked-table change (value-only edits are fine on contiguous); OR
 *  - the track set/order or the suggestions changed — the in-place writer does
 *    NOT rewrite `tracks_json` / `suggestions_json`, so the (rewritten) instances
 *    table's `track` indices would point into a STALE `tracks_json` → silent
 *    track/suggestion corruption on reload (the HIGH bug this guards); OR
 *  - the VIDEO SET changed (a video was added/removed/repointed) — the in-place
 *    writer does NOT rewrite `videos_json` or the embedded `video{i}` groups, so
 *    the (rewritten) frames table's `video` indices would point into a stale
 *    video list. Compared semantically via per-video signatures
 *    ({@link buildVideoSignatures}), not a byte-exact `videos_json` diff; OR
 *  - the `/metadata` json changed (e.g. a skeleton or provenance edit) but
 *    `update.metadataJson` was not set to carry that change into the attr.
 *
 * A pose/point/visibility/score/track-membership-preserving edit still passes.
 *
 * CALLER CONTRACT:
 *  - `onDisk` MUST describe every label table that actually exists on disk
 *    (frames/instances/points/pred_points/negative_frames) — an omitted table
 *    skips its resizability check here; the post-resize assertion inside
 *    {@link writeLabelTablesInPlace} is the loud backstop if one is missed.
 *  - This gate proves confinement for the label tables + tracks + suggestions +
 *    videos + metadata ONLY. It does NOT check `identities_json`, `sessions_json`,
 *    or the annotation datasets (rois/masks/bboxes/centroids/label_images). The
 *    in-place path therefore ASSUMES those are unchanged; the caller (app) MUST
 *    NOT route an edit that touches them to in-place (route it to a full re-save),
 *    and its post-write verify is the final backstop.
 * Pure function (no I/O): the caller reads `sidecars.onDisk` from the file (the
 * videos it parsed on open) and builds `sidecars.expected` via
 * {@link buildExpectedSidecars}.
 */
export function checkInPlaceWritable(
  update: LabelTableUpdate,
  onDisk: OnDiskTables,
  sidecars: { onDisk: OnDiskSidecars; expected: OnDiskSidecars },
): InPlaceWritable {
  refuseViewOnly(update);
  const tables = checkTablesWritable(update, onDisk);
  if (!tables.ok) return tables;
  return checkSidecarsUnchanged(update, sidecars);
}

/**
 * Whether an enum is h5py's bool: a one-byte enum whose only members are
 * `FALSE = 0` and `TRUE = 1`.
 */
function isH5pyBool(
  size: number | undefined,
  members: Record<string, unknown> | null | undefined,
): boolean {
  const names = Object.keys(members ?? {}).sort();
  return (
    (size ?? 1) === 1 &&
    names.length === 2 &&
    names[0] === "FALSE" &&
    names[1] === "TRUE" &&
    Number(members?.FALSE) === 0 &&
    Number(members?.TRUE) === 1
  );
}

/** Whether an integer, float or h5py bool column can be patched. */
function writableNumeric(member: OnDiskMember): boolean {
  if (member.typeClass === 0 || member.typeClass === H5T_FLOAT_CLASS) {
    return true;
  }
  // h5py's bool is written as 0/1 with the dataset's own type, which h5wasm
  // can do (see writeWithFileType). Other enums are refused: a value written
  // through their base integer might name no member.
  return (
    member.typeClass === H5T_ENUM_CLASS &&
    isH5pyBool(member.size, member.enumMembers)
  );
}

/** The table checks of {@link checkInPlaceWritable}. */
function checkTablesWritable(
  update: LabelTableUpdate,
  onDisk: OnDiskTables,
): InPlaceWritable {
  const pose: Array<[string, LabelTable, OnDiskTable | undefined]> = [
    ["frames", update.frames, onDisk.frames],
    ["instances", update.instances, onDisk.instances],
    ["points", update.points, onDisk.points],
    ["pred_points", update.predPoints, onDisk.predPoints],
  ];
  if (update.layout === "v3") {
    if (update.unknownColumnsAligned === false) {
      return {
        ok: false,
        reason:
          "the records changed since loading, so the unknown columns kept from the file no longer line up — re-save the whole file instead",
      };
    }
    for (const [name, table, od] of pose) {
      if (!od || od.layout !== "columns") {
        return {
          ok: false,
          reason: `table "${name}" is ${od ? "in the SLP 2.x layout" : "absent"} on disk but the update is in format 3.0 — re-save the whole file instead`,
        };
      }
      if (table.rows.length !== od.rows) {
        return {
          ok: false,
          reason: `table "${name}" row count changed (${od.rows} → ${table.rows.length}); format 3.0 columns are patched value by value only — re-save the whole file instead`,
        };
      }
      for (const field of table.fields) {
        const member = od.members?.find((m) => m.name === field);
        if (!member) {
          return {
            ok: false,
            reason: `table "${name}" has no column "${field}" on disk — re-save the whole file instead`,
          };
        }
        if (!writableNumeric(member) || (member.rows ?? od.rows) !== od.rows) {
          return {
            ok: false,
            reason: `column "${name}/${field}" cannot be patched in place (HDF5 type class ${member.typeClass}) — re-save the whole file instead`,
          };
        }
      }
    }
    for (const [name, od] of [
      ["instances", onDisk.instances],
      ["frames", onDisk.frames],
    ] as const) {
      const want = update.metadata?.[name] ?? {};
      const have = od?.metadata ?? {};
      const wantKeys = Object.keys(want).sort();
      const haveKeys = Object.keys(have).sort();
      if (wantKeys.join("\0") !== haveKeys.join("\0")) {
        return {
          ok: false,
          reason: `the metadata keys of "${name}" changed — re-save the whole file instead`,
        };
      }
      for (const key of wantKeys) {
        if (
          want[key].kind !== have[key].kind ||
          (want[key].present !== null) !== have[key].present
        ) {
          return {
            ok: false,
            reason: `the metadata "${name}/${key}" changed kind or which records hold it — re-save the whole file instead`,
          };
        }
      }
    }
    return { ok: true };
  }
  if (
    update.sourceFormat?.formatId !== undefined &&
    update.sourceFormat.formatId >= 3
  ) {
    // Labels loaded from a 3.0 file to be saved in the 2.x layout.
    return {
      ok: false,
      reason:
        "the labels were loaded from a file in SLP format 3.0 and the update is in the 2.x layout, which an in-place save cannot write into that file — re-save the whole file instead",
    };
  }
  for (const [name, , od] of pose) {
    if (od?.layout === "columns") {
      return {
        ok: false,
        reason: `table "${name}" is in SLP format 3.0 on disk but the update is in the 2.x layout — re-save the whole file instead`,
      };
    }
  }
  const checks: Array<
    [string, LabelTable | undefined, OnDiskTable | undefined]
  > = [
    ["frames", update.frames, onDisk.frames],
    ["instances", update.instances, onDisk.instances],
    ["points", update.points, onDisk.points],
    ["pred_points", update.predPoints, onDisk.predPoints],
    ["negative_frames", update.negativeFrames, onDisk.negativeFrames],
  ];
  for (const [name, table, od] of checks) {
    if (!od) continue; // absent on disk → writer creates it (resizable)
    if (od.layout === "compound" && od.members) {
      const bad = od.members.find((m) => !writableNumeric(m));
      if (bad) {
        return {
          ok: false,
          reason: `table "${name}" member "${bad.name}" (HDF5 type class ${bad.typeClass}) cannot be written in place — re-save the whole file instead`,
        };
      }
    }
    if (table && table.rows.length !== od.rows && !od.chunked) {
      return {
        ok: false,
        reason: `table "${name}" row count changed (${od.rows} → ${table.rows.length}) but the on-disk dataset is contiguous (not resizable) — re-save the whole file instead`,
      };
    }
  }
  return { ok: true };
}

/** The confinement checks of {@link checkInPlaceWritable}. */
function checkSidecarsUnchanged(
  update: LabelTableUpdate,
  sidecars: { onDisk: OnDiskSidecars; expected: OnDiskSidecars },
): InPlaceWritable {
  // Confinement: the label tables index into tracks_json / suggestions_json /
  // metadata, which the in-place writer does NOT rewrite (except the /metadata
  // attr, and only when update.metadataJson is set). If any changed, an in-place
  // save would desync — refuse so the caller full-rewrites.
  if (
    !sameStringArray(sidecars.onDisk.tracksJson, sidecars.expected.tracksJson)
  ) {
    return {
      ok: false,
      reason:
        "the track set/order changed; an in-place save cannot update tracks_json (the instances table would point into a stale track list) — re-save the whole file instead",
    };
  }
  if (
    !sameStringArray(
      sidecars.onDisk.suggestionsJson,
      sidecars.expected.suggestionsJson,
    )
  ) {
    return {
      ok: false,
      reason:
        "the suggestions changed; an in-place save cannot update suggestions_json — re-save the whole file instead",
    };
  }
  if (!sameStringArray(sidecars.onDisk.videos, sidecars.expected.videos)) {
    return {
      ok: false,
      reason:
        "the video set changed (a video was added, removed, or repointed); an in-place save cannot update videos_json or the embedded video groups (the frames table would point into a stale video list) — re-save the whole file instead",
    };
  }
  if (
    sidecars.onDisk.metadataJson !== sidecars.expected.metadataJson &&
    update.metadataJson === undefined
  ) {
    return {
      ok: false,
      reason:
        "the /metadata json changed (e.g. a skeleton or provenance edit) but update.metadataJson was not set to carry it — set update.metadataJson, or re-save the whole file instead",
    };
  }

  return { ok: true };
}

/**
 * Pack one logical column (`values`, extracted from the update rows) into the
 * TypedArray that matches an on-disk compound `member`'s dtype, honoring
 * h5wasm's single-char member dtype (int/float, width, signedness). Int64
 * members become Big(U)Int64Array (values are exact ≤ 2^53). Throws on an enum
 * member (the gate should have refused the file first).
 */
function memberColumnTypedArray(
  member: { name: string; type: number; size?: number; signed?: boolean },
  values: number[],
): ArrayBufferView {
  const size = member.size ?? 8;
  if (member.type === H5T_ENUM_CLASS) {
    // h5py's bool (the only enum written, see writeWithFileType): 0 or 1.
    const flags = values.map((v) => (v ? 1 : 0));
    return memberColumnTypedArray(
      { name: member.name, type: 0, size, signed: member.signed },
      flags,
    );
  }
  if (member.type === H5T_FLOAT_CLASS) {
    return size === 4 ? Float32Array.from(values) : Float64Array.from(values);
  }
  // Integer member. h5wasm reports floats as signed:false, so default ints to
  // signed unless explicitly unsigned (matches readCompoundColumnsManual).
  const signed = member.signed !== false;
  if (size === 8) {
    const big = values.map((v) => BigInt(Math.trunc(v)));
    return signed ? BigInt64Array.from(big) : BigUint64Array.from(big);
  }
  if (size === 1) return (signed ? Int8Array : Uint8Array).from(values);
  if (size === 2) return (signed ? Int16Array : Uint16Array).from(values);
  return (signed ? Int32Array : Uint32Array).from(values);
}

/**
 * Run `write` (an h5wasm `write_slice`) on a dataset whose type holds an HDF5
 * enum (h5py's bool), which h5wasm's high-level writer refuses: for the
 * write, the dataset's cached description names each enum as its base
 * integer, so h5wasm packs the values at the members' offsets, and the bytes
 * go to the file with the dataset's own type (h5wasm writes with the file
 * type), so they are stored as the enum values they are. Datasets without an
 * enum are written as they are.
 */
function writeWithFileType(ds: any, write: () => void): void {
  const md = ds.metadata;
  const asInt = (m: any) =>
    m.type === H5T_ENUM_CLASS
      ? {
          ...m,
          type: 0,
          signed: m.signed !== false,
          enum_type: undefined,
        }
      : m;
  const members = md?.compound_type?.members as any[] | undefined;
  const enums = members
    ? members.filter((m) => m.type === H5T_ENUM_CLASS)
    : md?.type === H5T_ENUM_CLASS
      ? [md]
      : [];
  if (enums.length === 0) {
    write();
    return;
  }
  // Backstop for a caller that skipped the gate: only h5py's bool.
  for (const m of enums) {
    if (!isH5pyBool(m.size, m.enum_type?.members)) {
      throw new Error(
        `in-place save: "${ds.path}" holds an enum other than a boolean, which this writer does not write — re-save the whole file instead`,
      );
    }
  }
  ds._metadata = members
    ? {
        ...md,
        compound_type: { ...md.compound_type, members: members.map(asInt) },
      }
    : asInt(md);
  try {
    write();
  } finally {
    delete ds._metadata;
  }
}

/** Rows per slice when an in-place write reads a table back. */
const VERIFY_CHUNK_ROWS = 65536;

/**
 * Read rows `[0, n)` of a dataset in bounded slices, calling `visit` with each
 * slice (an array of records for a compound dataset, a typed array for a 1-D
 * one) and its first row.
 */
function forEachSlice(
  ds: any,
  n: number,
  visit: (rows: ArrayLike<unknown>, start: number) => void,
): void {
  for (let start = 0; start < n; start += VERIFY_CHUNK_ROWS) {
    const end = Math.min(n, start + VERIFY_CHUNK_ROWS);
    visit(ds.slice([[start, end]]) as ArrayLike<unknown>, start);
  }
}

/**
 * After an enum write, read the dataset back, a bounded slice at a time, and
 * check each enum member holds what was written (0/1 for a flag), so a wrong
 * write is never left unnoticed.
 *
 * @throws {Error} If a value differs.
 */
function verifyEnumMembers(
  ds: any,
  diskName: string,
  members: Array<{ name: string; type: number }>,
  table: LabelTable,
  rowCount: number,
): void {
  const checks = members
    .map((m, mi) => [mi, table.fields.indexOf(m.name), m] as const)
    .filter(([, , m]) => m.type === H5T_ENUM_CLASS);
  if (checks.length === 0) return;
  forEachSlice(ds, rowCount, (rows, start) => {
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k] as ArrayLike<unknown>;
      for (const [mi, ci, m] of checks) {
        const got = Number(row?.[mi]);
        const want = table.rows[start + k][ci] ? 1 : 0;
        if (got !== want) {
          throw new Error(
            `in-place write of "${diskName}" member "${m.name}" did not take effect (row ${start + k}: wrote ${want}, read ${got}) — re-save the whole file instead`,
          );
        }
      }
    }
  });
}

/**
 * Write one 1-D numeric dataset (format 3.0 column) in place with `values`,
 * in the dataset's own type (an enum as its base integer, see
 * {@link writeWithFileType}).
 */
function writeColumnInPlace(ds: any, values: ArrayLike<number>): void {
  const md = ds.metadata;
  const n = values.length;
  if (n === 0) return;
  const data = memberColumnTypedArray(
    { name: ds.path, type: md.type, size: md.size, signed: md.signed },
    Array.from(values, Number),
  );
  writeWithFileType(ds, () => ds.write_slice([[0, n]], data));
  if (md.type === H5T_ENUM_CLASS) {
    forEachSlice(ds, n, (rows, start) => {
      for (let k = 0; k < rows.length; k++) {
        if (Number(rows[k]) !== (values[start + k] ? 1 : 0)) {
          throw new Error(
            `in-place write of "${ds.path}" did not take effect (row ${start + k}) — re-save the whole file instead`,
          );
        }
      }
    });
  }
}

/**
 * Overwrite one already-open dataset (`diskName`) with `table`'s rows, resizing
 * first when the row count changed. Handles BOTH on-disk layouts:
 *  - flat 2-D matrix: `write_slice([[0,n],[0,cols]], Float64Array)` (h5wasm
 *    converts f64 → the dataset's `<i8`/`<f8` dtype, mirroring how it was
 *    written); and
 *  - 1-D compound: a per-member column `Map` keyed by the on-disk member name,
 *    each column packed to the member's dtype.
 * Creates the dataset (chunked/resizable, flat) if it is absent AND non-empty.
 * NEVER touches any `video{i}` group.
 */
function writeOneTableInPlace(
  file: any,
  diskName: string,
  table: LabelTable,
  dtype: string,
): void {
  const rowCount = table.rows.length;
  const colCount = table.fields.length;
  const ds = file.get(diskName);
  if (!ds) {
    // Absent on disk: create it fresh (resizable, matching the eager writer).
    // Skip an empty table so we don't add a dataset a file never had.
    if (rowCount === 0) return;
    createMatrixDataset(file, diskName, table.rows, table.fields, dtype, true);
    return;
  }

  const md = ds.metadata;
  const members = md?.compound_type?.members as
    | Array<{ name: string; type: number; size?: number; signed?: boolean }>
    | undefined;
  const isCompound = !!(members && members.length > 0);
  const curRows = ds.shape?.[0] ?? 0;

  if (curRows !== rowCount) {
    ds.resize(isCompound ? [rowCount] : [rowCount, colCount]);
    // h5wasm SILENTLY no-ops resize() on a non-resizable (contiguous) dataset
    // rather than throwing — which would leave stale ghost rows / a short write.
    // Read the shape back and abort loudly so the caller full-rewrites instead
    // of corrupting the file. (The gate should have refused this, but this is the
    // backstop if the caller passed an incomplete OnDiskTables.)
    const newRows = ds.shape?.[0] ?? -1;
    if (newRows !== rowCount) {
      throw new Error(
        `in-place resize of "${diskName}" did not take effect (had ${curRows} rows, wanted ${rowCount}, got ${newRows}); the dataset is not resizable — re-save the whole file instead`,
      );
    }
  }
  if (rowCount === 0) return; // resized to empty; nothing to write

  if (isCompound) {
    const fieldIndex = new Map(table.fields.map((f, i) => [f, i]));
    const columns = new Map<string, ArrayBufferView>();
    for (const m of members!) {
      const ci = fieldIndex.get(m.name);
      if (ci === undefined) {
        throw new Error(
          `in-place update for "${diskName}" is missing compound member "${m.name}"`,
        );
      }
      const colVals = table.rows.map((row) => row[ci]);
      columns.set(m.name, memberColumnTypedArray(m, colVals));
    }
    writeWithFileType(ds, () => ds.write_slice([[0, rowCount]], columns));
    verifyEnumMembers(ds, diskName, members!, table, rowCount);
  } else {
    const flat = new Float64Array(rowCount * colCount);
    for (let i = 0; i < rowCount; i++) {
      const row = table.rows[i];
      const off = i * colCount;
      for (let j = 0; j < colCount; j++) flat[off + j] = row[j];
    }
    ds.write_slice(
      [
        [0, rowCount],
        [0, colCount],
      ],
      flat,
    );
  }
}

/**
 * Patch the label tables of an ALREADY-OPEN, writable h5wasm `File` (opened r+ /
 * mode `"a"`) in place from `update`, then (if `update.metadataJson` is set)
 * replace the `/metadata` `json` attribute. Works on any open h5wasm File —
 * Node FS, MEMFS, or the bridged write device (the streaming worker).
 *
 * DATA SAFETY: only the frames/instances/points/pred_points/negative_frames
 * datasets and the `/metadata` attribute are ever referenced — the embedded
 * `video{i}/video` groups are never opened, read, or written. The caller is
 * responsible for having gated with {@link checkInPlaceWritable} (and, ideally,
 * a post-write verify) before calling this: the gate proves the edit is confined
 * to these tables (tracks/suggestions/metadata unchanged or carried). As a
 * backstop for an incomplete gate, each per-table resize is asserted to have
 * actually taken effect (h5wasm silently no-ops resize on a non-resizable
 * dataset) — a resize that can't happen THROWS here rather than writing ghost
 * rows, so the caller falls back to a full re-save.
 *
 * IF THIS THROWS, THE FILE MAY BE PARTLY WRITTEN: checks run before the first
 * write catch what they can, but a failure after it (an I/O error, the
 * read-back check of HDF5 booleans, a resize the gate did not see) leaves
 * some tables patched. The caller must then do a full save to the same
 * target.
 *
 * Does NOT flush or close the file — the caller owns the file lifecycle.
 */
export function writeLabelTablesInPlace(
  file: any,
  update: LabelTableUpdate,
): void {
  refuseViewOnly(update);
  if (update.layout === "v3") {
    writeLabelColumnsInPlace(file, update);
    writeMetadataJsonInPlace(file, update.metadataJson);
    return;
  }
  // A 3.0 file stores its pose tables as groups of columns; patching them as
  // 2.x tables would corrupt it. Refuse before touching anything.
  for (const name of ["frames", "instances", "points", "pred_points"]) {
    if (file.get(name)?.type === "Group") {
      throw new Error(
        `in-place save: "${name}" is in the SLP format 3.0 layout, which this version cannot patch — re-save the whole file instead`,
      );
    }
  }
  // The `dtype` here is only consulted when a table is ABSENT on disk and gets
  // created fresh as a flat matrix (writeOneTableInPlace → createMatrixDataset);
  // for an existing dataset the on-disk layout/dtype wins and this arg is ignored.
  // Even so, `instances` uses "<d" (true float64), NEVER "<f8" (== float32 in
  // h5wasm — only the type char is read): its id / point_id columns must survive
  // integers past 2^24 (#231). frames stays int32 ("<i8"); points/pred_points are
  // coordinate-only, so float32 ("<f8") is acceptable.
  writeOneTableInPlace(file, "frames", update.frames, "<i8");
  writeOneTableInPlace(file, "instances", update.instances, "<d");
  writeOneTableInPlace(file, "points", update.points, "<f8");
  writeOneTableInPlace(file, "pred_points", update.predPoints, "<f8");
  if (update.negativeFrames) {
    writeOneTableInPlace(file, "negative_frames", update.negativeFrames, "<i8");
  }
  writeMetadataJsonInPlace(file, update.metadataJson);
}

/**
 * Patch the format 3.0 pose tables of an open file column by column from a
 * 3.0 update (values only: every column keeps its length), and the values of
 * their record metadata. Everything is checked before anything is written: a
 * missing column, a changed length, changed metadata keys, or a changed
 * string metadata value (h5wasm cannot rewrite variable-length strings)
 * throws, so the caller re-saves the whole file.
 */
function writeLabelColumnsInPlace(file: any, update: LabelTableUpdate): void {
  const node = (path: string): any => {
    try {
      return file.get(path) ?? null;
    } catch {
      return null;
    }
  };
  const fail = (why: string): never => {
    throw new Error(`in-place save: ${why} — re-save the whole file instead`);
  };
  const writes: Array<[any, ArrayLike<number>]> = [];
  for (const [name, table] of [
    ["frames", update.frames],
    ["instances", update.instances],
    ["points", update.points],
    ["pred_points", update.predPoints],
  ] as const) {
    if (node(name)?.type !== "Group") {
      fail(`"${name}" is not in the SLP format 3.0 layout`);
    }
    table.fields.forEach((field, j) => {
      const ds = node(`${name}/${field}`);
      if (!ds || ds.type === "Group") fail(`"${name}/${field}" is missing`);
      if (ds.shape?.length !== 1 || ds.shape[0] !== table.rows.length) {
        fail(`"${name}/${field}" changed length`);
      }
      writes.push([ds, table.rows.map((row) => row[j])]);
    });
  }
  for (const name of ["instances", "frames"] as const) {
    const columns = update.metadata?.[name] ?? {};
    const onDisk = readMetadataKeysInPlace(file, name);
    if (
      [...onDisk].sort().join("\0") !== Object.keys(columns).sort().join("\0")
    ) {
      fail(`the metadata keys of "${name}" changed`);
    }
    for (const [key, column] of Object.entries(columns)) {
      const values = node(`${name}/metadata/${key}/values`);
      const present = node(`${name}/metadata/${key}/present`);
      if (!values || values.shape?.[0] !== column.values.length) {
        fail(`"${name}/metadata/${key}" changed length`);
      }
      if (!!present !== (column.present !== null)) {
        fail(`which records hold "${name}/metadata/${key}" changed`);
      }
      if (column.kind === "str") {
        const stored = Array.from(values.value as ArrayLike<unknown>, (v) =>
          v instanceof Uint8Array ? new TextDecoder().decode(v) : String(v),
        );
        const same = stored.every(
          (v, i) => column.present?.[i] === 0 || v === String(column.values[i]),
        );
        if (!same) fail(`a string value of "${name}/metadata/${key}" changed`);
      } else {
        writes.push([
          values,
          Array.from(column.values, (v) =>
            column.kind === "bool" ? (v ? 1 : 0) : Number(v),
          ),
        ]);
      }
      if (present && column.present) {
        writes.push([present, Array.from(column.present, Number)]);
      }
    }
  }
  for (const [ds, values] of writes) writeColumnInPlace(ds, values);
}

/**
 * The metadata keys of a 3.0 table that readers read: groups under
 * `<table>/metadata` with a 1-D `values` dataset of a supported kind.
 */
function readMetadataKeysInPlace(file: any, table: string): string[] {
  const get = (path: string): any => {
    try {
      return file.get(path) ?? null;
    } catch {
      return null;
    }
  };
  const md = get(`${table}/metadata`);
  if (!md || md.type !== "Group") return [];
  const keys: string[] = [];
  for (const key of md.keys() as string[]) {
    const group = get(`${table}/metadata/${key}`);
    if (!group || group.type !== "Group") continue;
    if (!(group.keys() as string[]).includes("values")) continue;
    const values = get(`${table}/metadata/${key}/values`);
    if (!values || values.type === "Group") continue;
    let kindAttr: unknown;
    try {
      kindAttr = values.attrs?.kind?.value;
    } catch {
      kindAttr = undefined;
    }
    const kind = metadataKindFromH5(
      { ...(values.metadata ?? {}), shape: values.shape },
      kindAttr,
    );
    if (kind !== null) keys.push(key);
  }
  return keys;
}

/** Replace the `/metadata` `json` attribute, when the update carries it. */
function writeMetadataJsonInPlace(file: any, metadataJson?: string): void {
  if (metadataJson !== undefined) {
    const metadataGroup = file.get("metadata");
    if (metadataGroup) {
      // The json attr is a fixed-length S-string; a new value of a different
      // length can't overwrite in place, so delete + recreate. (Attribute
      // storage may relocate within the object header — harmless to dataset
      // bytes, but noted as a risk for very large metadata.)
      try {
        metadataGroup.delete_attribute("json");
      } catch {
        // no existing attr — fine
      }
      setStringAttr(metadataGroup, "json", metadataJson);
    }
  }
}

/**
 * Plan which videos to embed and how. An already-embedded video is ALWAYS
 * raw-copied (its FULL stored set preserved via `getFrameBuffer`, no decode)
 * regardless of `embedMode`; only a NEW embed of a continuous video takes the
 * legacy getFrame+encode path — and only when a real embed mode was requested.
 * (`embedMode === "source"` never reaches here — the caller externalizes.)
 * A new embed is stored in `imageFormat` when one is given (checked by
 * `checkEmbedImageFormat`), else as it always was.
 */
async function planEmbedding(
  labels: Labels,
  embedMode: EmbedOption,
  onProgress?: SlpWriteOptions["onProgress"],
  embedAllVideos = true,
  {
    readFrames = true,
    imageFormat = null,
    imageQuality = null,
  }: {
    readFrames?: boolean;
    imageFormat?: EmbedImageFormat | null;
    imageQuality?: number | null;
  } = {},
): Promise<EmbedPlan> {
  const plan: EmbedPlan = new Map();
  // With an explicit format, each new embed's encoder settings; a grayscale
  // video (one recorded channel) stores one-channel images, as Python.
  const encodingFor = (video: Video): EmbedEncoding | undefined =>
    imageFormat
      ? {
          format: imageFormat,
          quality: imageQuality,
          gray: embeddedVideoAttrs(video)?.channels === 1,
        }
      : undefined;
  const isRealMode = embedMode !== false && embedMode !== "source";
  if (Array.isArray(embedMode)) {
    for (const [video] of embedMode) {
      if (!labels.videos.includes(video)) {
        throw new Error(
          `embed lists a frame of a video that isn't in these labels: ${video.filename}`,
        );
      }
    }
  }
  // Progress spans every frame read from a continuous video, across videos.
  const toEncode = labels.videos.map((video, vi) =>
    isRealMode && video.backend && !isRawCopyable(video)
      ? selectEmbedFrames(labels, vi, embedMode)
      : [],
  );
  // An already-embedded video whose stored images aren't in the chosen format
  // is converted (its FULL stored set, as the raw copy), as Python converts
  // every embedded video to an explicit `image_format`. Without one, or in the
  // same format, it is raw-copied as always.
  const toConvert = new Map<number, number[]>();
  if (imageFormat) {
    for (let vi = 0; vi < labels.videos.length; vi++) {
      const video = labels.videos[vi];
      if (!isRawCopyable(video)) continue;
      await video.backend!.ensureLoaded?.();
      if (needsConversion(video, encodingFor(video)!)) {
        toConvert.set(vi, video.embeddedFrameIndices ?? []);
      }
    }
  }
  const progress = {
    done: 0,
    total:
      toEncode.reduce((n, frames) => n + frames.length, 0) +
      (readFrames
        ? [...toConvert.values()].reduce((n, f) => n + f.length, 0)
        : 0),
    report: onProgress,
  };
  for (let vi = 0; vi < labels.videos.length; vi++) {
    const video = labels.videos[vi];
    const converted = toConvert.get(vi);
    if (converted) {
      if (converted.length === 0) continue;
      const encoding = encodingFor(video)!;
      plan.set(vi, {
        kind: "encode",
        videoIndex: vi,
        video,
        frameNumbers: converted,
        format: encoding.format,
        channelOrder: "RGB",
        encoding,
        frameData: readFrames
          ? await convertEmbeddedFrames(video, converted, encoding, progress)
          : undefined,
      });
    } else if (isRawCopyable(video)) {
      // Preserve the FULL stored set regardless of embedMode (semantics A).
      await video.backend!.ensureLoaded?.();
      const frameNumbers = video.embeddedFrameIndices ?? [];
      if (frameNumbers.length === 0) continue;
      plan.set(vi, {
        kind: "raw",
        videoIndex: vi,
        video,
        frameNumbers,
        format: video.backend!.embeddedFormat ?? "png",
        channelOrder: video.backend!.embeddedChannelOrder ?? "RGB",
      });
    } else if (isRealMode && video.backend && !readFrames) {
      // Plan only (the streaming writer reads and encodes later, in a worker):
      // every selected frame inside the video, as PNG — what reading would
      // produce, since frames past the end are skipped and any other frame
      // that can't be read fails the save.
      const frameCount = video.shape?.[0];
      const frameNumbers = toEncode[vi].filter(
        (f) => frameCount == null || f < frameCount,
      );
      if (frameNumbers.length === 0) continue;
      plan.set(vi, {
        kind: "encode",
        videoIndex: vi,
        video,
        frameNumbers,
        format: imageFormat ?? "png",
        channelOrder: "RGB",
        encoding: encodingFor(video),
      });
    } else if (isRealMode && video.backend) {
      // New-embed of a continuous video: legacy getFrame+encode path. Frames a
      // backend returns as raw pixels (ImageBitmap/ImageData — the MediaBunny/
      // Mp4Box mp4 case) are PNG-encoded by collectEncodedFrames; when that
      // happens the stored `format` MUST be "png" (the encoded bytes ARE PNG),
      // overriding any codec-ish `backendMetadata.format`, or the reader would
      // mis-decode. Their channel order is RGB (decoded pixels, or copied image
      // bytes), which is what Python records for both. An explicit format
      // stores every frame in it.
      const encoding = encodingFor(video);
      const { frameData, encodedFormat } = await collectEncodedFrames(
        video,
        toEncode[vi],
        progress,
        encoding,
      );
      if (frameData.size === 0) continue;
      const frameNumbers = [...frameData.keys()].sort((a, b) => a - b);
      plan.set(vi, {
        kind: "encode",
        videoIndex: vi,
        video,
        frameNumbers,
        format:
          encoding?.format ??
          encodedFormat ??
          (video.backendMetadata?.format as string) ??
          "png",
        channelOrder: "RGB",
        encoding,
        frameData,
      });
    }
  }
  // Python's embed_all_videos: a video with NO frames selected still becomes an
  // embedded (empty) reference to the package. One whose selected frames
  // couldn't be read (e.g. no open backend) stays external on purpose: making
  // it "embedded" would hide that its images are missing.
  if (isRealMode && embedAllVideos) {
    labels.videos.forEach((video, vi) => {
      if (plan.has(vi) || isRawCopyable(video)) return;
      if (selectEmbedFrames(labels, vi, embedMode).length > 0) return;
      plan.set(vi, {
        kind: "encode",
        videoIndex: vi,
        video,
        frameNumbers: [],
        format: imageFormat ?? "png",
        channelOrder: "RGB",
        encoding: encodingFor(video),
        frameData: new Map(),
      });
    });
  }
  return plan;
}

/**
 * Serializable projection of one raw-copyable {@link EmbedPlanEntry}, safe to
 * pass across a Web Worker boundary via `structuredClone` (Task 1.1 of the
 * streaming pkg.slp writer). Contains only plain data — no `Video`/backend
 * instances, functions, or open file handles — so a worker holding ONLY this
 * entry plus read access to the SOURCE file (via
 * {@link SerializableEmbedPlan.sourcePath}) can locate and copy the video's
 * stored embedded images into the destination file without ever touching the
 * live `Labels` graph.
 */
export type SerializableEmbedEntry = {
  /**
   * Destination video index — this video's position in `labels.videos` of the
   * file being WRITTEN. NOT assumed to equal the video's index in the SOURCE
   * file (videos can be added/removed/reordered between load and save); the
   * actual source location is carried separately in `sourceDataset`/
   * `sourceGroup` below.
   */
  videoIndex: number;
  /**
   * The SOURCE file's HDF5 dataset path holding the raw encoded blobs (e.g.
   * `"video0/video"`), read directly off the live backend's `dataset`
   * property (`VideoBackend.dataset`) — the same path `Hdf5VideoBackend` /
   * `StreamingHdf5VideoBackend` use internally for `getFrameBuffer`
   * (delegated through `CropVideoBackend` for a cropped video). This is the
   * authoritative source location; it is never derived from `videoIndex`.
   */
  sourceDataset: string;
  /**
   * The SOURCE file's HDF5 GROUP containing `sourceDataset` and its sibling
   * `frame_numbers` / `frame_sizes` / `source_video` datasets/group — derived
   * by stripping a trailing `"/video"` from `sourceDataset` (mirrors
   * `StreamingHdf5VideoBackend.ensureLoaded`'s `groupPath` derivation). The
   * worker reads `{sourceGroup}/frame_numbers` etc. from the SOURCE file and
   * writes the copy under `video{videoIndex}` in the destination.
   */
  sourceGroup: string;
  /** Stored image format (`VideoBackend.embeddedFormat`), e.g. "png"/"jpg". */
  format: string;
  /**
   * Stored channel order (`VideoBackend.embeddedChannelOrder`), e.g.
   * "RGB"/"BGR".
   */
  channelOrder: string;
  /**
   * The FULL stored source frame numbers being preserved, in storage order
   * (the raw path always copies the entire stored set regardless of embed
   * mode — semantics A; see {@link planEmbedding}). Always non-empty:
   * `planEmbedding` skips 0-frame videos before they can reach this builder.
   */
  frameNumbers: number[];
  /**
   * Plain-object `source_video` lineage (from {@link sourceVideoDict}), or
   * `null` when this video has no separate source to record. The worker
   * writes this into the destination's `{group}/source_video` HDF5 group
   * using the same JSON/attr logic as {@link writeSourceVideoJson}, without
   * needing the live `Labels`/`Video` object.
   */
  sourceVideoJson: Record<string, unknown> | null;
  /**
   * The source dimensions to record on the copied dataset, as Python (see
   * {@link EmbeddedVideoAttrs}). Optional: an older plan without it writes no
   * dimension attributes.
   */
  videoAttrs?: EmbeddedVideoAttrs;
};

/**
 * Serializable projection of one "encode" {@link EmbedPlanEntry}: a video
 * whose frames are read on the main thread and encoded + appended by the
 * streaming writer's worker (see {@link appendEncodedVideos}). That is a new
 * embed of a continuous video (e.g. an mp4), or, with `imageFormat`, an
 * already-embedded video converted to that format (its stored images are
 * read as stored). Only returned when {@link buildSerializableEmbedPlan} is
 * called with `allowEncode`.
 */
export type SerializableEncodeEntry = {
  /** This video's position in `labels.videos` (and its `video{i}` group). */
  videoIndex: number;
  /** Source frame numbers to embed, sorted. Empty for an empty embedded video. */
  frameNumbers: number[];
  /**
   * Stored image format of every frame: `"png"`, or the `imageFormat` the
   * plan was built with (`"png"` / `"jpg"`).
   */
  format: string;
  /**
   * True when the format was chosen with `imageFormat`: frames already
   * encoded in it are stored verbatim, the rest are encoded in it, and a
   * grayscale video's frames keep one channel (see `encodeFrameAs`).
   * Absent or false: every frame is a PNG, as before the option existed.
   */
  formatChosen?: boolean;
  /**
   * JPEG quality / PNG compression level for encoded frames (`imageQuality`),
   * or null/absent for the encoder default.
   */
  quality?: number | null;
  /** Channel order recorded for the stored images, e.g. "RGB". */
  channelOrder: string;
  /** Plain-object `source_video` lineage, or `null` (see the raw entry). */
  sourceVideoJson: Record<string, unknown> | null;
  /** The source dimensions to record on the dataset, as Python. */
  videoAttrs: EmbeddedVideoAttrs;
};

/**
 * Fully `structuredClone`-safe embed plan handed to the streaming writer's Web
 * Worker (Task 1.1): raw-copy `entries` for already-embedded videos, plus
 * (opt-in) `encodeEntries` for new embeds of continuous videos — see
 * {@link buildSerializableEmbedPlan}.
 */
export type SerializableEmbedPlan = {
  /**
   * On-disk path of the SOURCE pkg.slp that every entry's `sourceDataset` /
   * `sourceGroup` are relative to. A single shared path is sufficient because
   * this task's scope is re-saving ONE already-embedded file; a future
   * "merge multiple pkg.slp sources into one" scenario would need to move
   * this onto each entry instead.
   */
  sourcePath: string;
  entries: SerializableEmbedEntry[];
  /**
   * New embeds of continuous videos, written by `appendEncodedVideos`.
   * Always empty unless {@link buildSerializableEmbedPlan} was called with
   * `allowEncode`.
   */
  encodeEntries: SerializableEncodeEntry[];
};

/**
 * Project a `planEmbedding` result into a worker-transportable
 * {@link SerializableEmbedPlan} (Task 1.1 of the streaming pkg.slp writer).
 * Reuses `planEmbedding` for video
 * selection/frameNumbers (no re-derivation of that logic), then strips each
 * raw entry down to plain data a worker can act on without the live `Labels`/
 * `Video`/backend objects.
 *
 * By default, throws if `planEmbedding` selected a `kind: "encode"` entry for
 * any video: a new embed of a continuous video, or, with an `imageFormat`, an
 * already-embedded video stored in another format, which is converted. So a
 * raw-copy re-save that passes `imageFormat` needs `allowEncode` whenever a
 * video converts. With `allowEncode`, those are returned as `encodeEntries`
 * instead (planned without reading any frame), for `appendEncodedVideos`
 * (stream-embed.ts) to read, encode and append.
 *
 * @param labels Labels to save (already-open embedded video backends).
 * @param embedMode Same `embed` option as `saveSlpToBytes`/`planEmbedding`.
 * @param sourcePath On-disk path of the SOURCE pkg.slp; the worker opens it
 *   via its own read bridge to copy the embedded groups from. Unused when
 *   there are no raw entries.
 * @throws Error if any selected video would use the "encode" path (a new
 *   embed, or a conversion to `imageFormat`) without `allowEncode`, or a
 *   raw-copyable video's backend exposes no
 *   `dataset` to locate its source embedded group by.
 */
export async function buildSerializableEmbedPlan(
  labels: Labels,
  embedMode: EmbedOption,
  sourcePath: string,
  options: {
    /**
     * Also plan new embeds of continuous videos, and conversions of
     * already-embedded videos to `imageFormat` (`encodeEntries`), instead of
     * throwing, without reading their frames. Use with the same `embed`,
     * `embedAllVideos` and image options as the structure write, so the two
     * agree.
     */
    allowEncode?: boolean;
    /** As {@link SlpWriteOptions.embedAllVideos}; only with `allowEncode`. */
    embedAllVideos?: boolean;
    /**
     * As {@link SlpWriteOptions.imageFormat}: the format `encodeEntries` are
     * stored in. An already-embedded video stored in another format becomes
     * an encode entry (a conversion), which needs `allowEncode`. Use the same
     * as the structure write.
     */
    imageFormat?: SlpWriteOptions["imageFormat"];
    /** As {@link SlpWriteOptions.imageQuality}. */
    imageQuality?: number | null;
  } = {},
): Promise<SerializableEmbedPlan> {
  const imageFormat = checkEmbedImageFormat(
    options.imageFormat,
    options.imageQuality,
  );
  // Raw-copy only (the default): no empty embedded videos on this path.
  const plan = await planEmbedding(
    labels,
    embedMode,
    undefined,
    options.allowEncode ? (options.embedAllVideos ?? true) : false,
    {
      readFrames: false,
      imageFormat,
      imageQuality: embedQuality(options.imageQuality),
    },
  );
  const entries: SerializableEmbedEntry[] = [];
  const encodeEntries: SerializableEncodeEntry[] = [];
  for (const entry of plan.values()) {
    if (entry.kind === "encode" && options.allowEncode) {
      const video = labels.videos[entry.videoIndex];
      encodeEntries.push({
        videoIndex: entry.videoIndex,
        frameNumbers: [...entry.frameNumbers],
        format: entry.format,
        // Only with a chosen format, so a plan without one is as before.
        ...(entry.encoding
          ? { formatChosen: true, quality: entry.encoding.quality }
          : {}),
        channelOrder: entry.channelOrder,
        sourceVideoJson: sourceVideoDict(video),
        videoAttrs: embeddedVideoAttrs(video),
      });
      continue;
    }
    if (entry.kind !== "raw") {
      throw new Error(
        entry.video.hasEmbeddedImages
          ? `buildSerializableEmbedPlan: converting embedded video${entry.videoIndex} ` +
              `to imageFormat "${entry.format}" uses the "encode" path; pass ` +
              "allowEncode and write its encodeEntries with appendEncodedVideos."
          : `buildSerializableEmbedPlan: video${entry.videoIndex} would use the ` +
              `new-embed ("encode") path; pass allowEncode and write its ` +
              "encodeEntries with appendEncodedVideos (without it, the plan is " +
              "raw-copy only, for already-embedded videos).",
      );
    }
    const sourceDataset =
      entry.video.backend?.dataset ??
      (entry.video.backendMetadata.dataset as string | undefined);
    if (!sourceDataset) {
      throw new Error(
        `buildSerializableEmbedPlan: video${entry.videoIndex} is raw-copyable ` +
          'but its backend exposes no "dataset" path, so the worker has no ' +
          "way to locate its source embedded group.",
      );
    }
    const sourceGroup = sourceDataset.endsWith("/video")
      ? sourceDataset.slice(0, -"/video".length)
      : sourceDataset;
    entries.push({
      videoIndex: entry.videoIndex,
      sourceDataset,
      sourceGroup,
      format: entry.format,
      channelOrder: entry.channelOrder,
      frameNumbers: [...entry.frameNumbers],
      sourceVideoJson: sourceVideoDict(entry.video),
      videoAttrs: embeddedVideoAttrs(entry.video),
    });
  }
  return { sourcePath, entries, encodeEntries };
}

/**
 * The frame indices of video `videoIndex` whose images `embedMode` embeds,
 * sorted. `"user"` / `"user+suggestions"` take every user-labeled frame
 * (`isUserLabeled`: user instances, negative frames, user centroids/boxes/
 * masks/ROIs), as sleap-io's `user_labeled_frames`.
 */
function selectEmbedFrames(
  labels: Labels,
  videoIndex: number,
  embedMode: EmbedOption,
): number[] {
  const frameIndices = new Set<number>();
  if (Array.isArray(embedMode)) {
    const video = labels.videos[videoIndex];
    for (const [v, frameIdx] of embedMode) {
      if (v === video) frameIndices.add(frameIdx);
    }
    return Array.from(frameIndices).sort((a, b) => a - b);
  }
  const mode = embedMode === true ? "all" : String(embedMode).toLowerCase();
  // "all" is every labeled frame AND every suggestion, as Python sleap-io
  // (`embed_videos`); "all+suggestions" is kept as an alias of it.
  const includeAllLabeled = mode === "all" || mode === "all+suggestions";
  const includeSuggestions =
    mode === "suggestions" ||
    mode === "user+suggestions" ||
    mode === "all" ||
    mode === "all+suggestions";

  for (const frame of labels.labeledFrames) {
    if (labels.videos.indexOf(frame.video) !== videoIndex) continue;
    let include = false;
    if (includeAllLabeled) {
      include = true;
    } else if (mode === "user" || mode === "user+suggestions") {
      // Any user labeling — instances, negative flag, user centroids/boxes/
      // masks/ROIs — as sleap-io's `user_labeled_frames` (slp.py embed).
      include = frame.isUserLabeled;
    } // "suggestions": added below
    if (include) frameIndices.add(frame.frameIdx);
  }

  if (includeSuggestions) {
    for (const suggestion of labels.suggestions) {
      if (labels.videos.indexOf(suggestion.video) !== videoIndex) continue;
      frameIndices.add(suggestion.frameIdx);
    }
  }
  return Array.from(frameIndices).sort((a, b) => a - b);
}

/** Read attempts per frame before giving up — a decoder may drop a read. */
const EMBED_READ_ATTEMPTS = 3;

/** Channels of the images an embedded video stores (its innermost backend). */
function storedChannels(video: Video): number | undefined {
  let backend = video.backend;
  while (
    backend instanceof GrayscaleVideoBackend ||
    backend instanceof CropVideoBackend
  ) {
    backend = backend.inner;
  }
  return backend?.shape?.[3];
}

/**
 * True when an already-embedded video can't be raw-copied under a chosen
 * format: its images are stored in another format, or it is grayscale and
 * stores multi-channel images (Python's `can_use_fast_path`).
 */
function needsConversion(video: Video, encoding: EmbedEncoding): boolean {
  const stored = (video.backend?.embeddedFormat ?? "png").toLowerCase();
  if ((stored === "jpeg" ? "jpg" : stored) !== encoding.format) return true;
  const channels = storedChannels(video);
  return encoding.gray && channels != null && channels !== 1;
}

/**
 * Convert an already-embedded video's stored images to `encoding` (see
 * {@link encodeFrameAs}): every one of `frameNumbers`, read as stored. A
 * stored image that can't be read fails the save, as the raw copy does.
 */
async function convertEmbeddedFrames(
  video: Video,
  frameNumbers: number[],
  encoding: EmbedEncoding,
  progress: {
    done: number;
    total: number;
    report?: SlpWriteOptions["onProgress"];
  },
): Promise<Map<number, Uint8Array>> {
  const frameData = new Map<number, Uint8Array>();
  for (const fn of frameNumbers) {
    const blob = await video.getFrameBuffer(fn);
    if (!blob || blob.length === 0) {
      throw new Error(
        `Couldn't read the stored image of frame ${fn} of "${
          Array.isArray(video.filename) ? video.filename[0] : video.filename
        }" to convert it. The package was not written.`,
      );
    }
    frameData.set(
      fn,
      await encodeFrameAs(blob, encoding, {
        channelOrder: video.backend?.embeddedChannelOrder,
        rawShape: video.backend?.shape,
      }),
    );
    progress.done += 1;
    reportProgress(
      progress.report,
      progress.done,
      progress.total,
      "Embedding frames",
    );
  }
  return frameData;
}

/**
 * Collect encoded frame bytes for a NEW embed of one continuous video, reading
 * each of `sortedFrames` (from {@link selectEmbedFrames}) via `getFrame` +
 * {@link frameToBytes} (the legacy path). Reads are `pinned` and retried, and a
 * frame inside the video that still can't be read fails the save rather than
 * leaving a package that silently lacks its image.
 *
 * With `encoding` (an explicit `imageFormat`), every frame is stored in that
 * format: an image file already in it is copied verbatim without decoding,
 * and any other frame goes through {@link encodeFrameAs}.
 */
async function collectEncodedFrames(
  video: Video,
  sortedFrames: number[],
  progress: {
    done: number;
    total: number;
    report?: SlpWriteOptions["onProgress"];
  },
  encoding?: EmbedEncoding,
): Promise<{
  frameData: Map<number, Uint8Array>;
  encodedFormat: string | null;
}> {
  const frameData = new Map<number, Uint8Array>();
  if (!video?.backend) return { frameData, encodedFormat: null };

  // True once any frame was re-encoded from raw pixels (an ImageBitmap or
  // ImageData) — those bytes are PNG, so the recorded `format` MUST be "png".
  // A frame returned as ready-made encoded bytes (e.g. an already-embedded
  // source) is stored verbatim and does NOT flip this.
  let encodedToPng = false;
  const frameCount = video.shape?.[0];
  const unreadable: number[] = [];
  for (const frameIdx of sortedFrames) {
    const fileBytes = encoding
      ? await imageFileBytes(video.backend, frameIdx, encoding)
      : null;
    // `pinned`: the app may keep showing other frames meanwhile, and the mp4/
    // AVI decoders otherwise cancel an older read for the newest one.
    let frame: Awaited<ReturnType<Video["getFrame"]>> = null;
    for (
      let attempt = 0;
      attempt < EMBED_READ_ATTEMPTS && !frame && !fileBytes;
      attempt++
    ) {
      frame = await video.getFrame(frameIdx, { pinned: true, prefetch: false });
    }
    progress.done += 1;
    reportProgress(
      progress.report,
      progress.done,
      progress.total,
      "Embedding frames",
    );
    if (fileBytes) {
      frameData.set(frameIdx, fileBytes);
      continue;
    }
    if (!frame) {
      // A frame past the video's end has no image to embed; one inside it
      // should — writing the package without it would silently lose it.
      if (frameCount == null || frameIdx < frameCount)
        unreadable.push(frameIdx);
      continue;
    }
    if (encoding) {
      frameData.set(
        frameIdx,
        await encodeFrameAs(frame, encoding, {
          channelOrder: video.backend.embeddedChannelOrder,
          rawShape: video.backend.shape,
        }),
      );
      continue;
    }
    let bytes = frameToBytes(frame);
    const channelOrder = video.backend?.embeddedChannelOrder;
    if (bytes && needsRedBlueSwap(bytes, channelOrder)) {
      // A color image stored BGR (e.g. encoded by OpenCV); the new embed records RGB.
      bytes = await encodeImageDataToPng(
        await decodeEncoded(bytes, channelOrder),
      );
      encodedToPng = true;
    }
    if (!bytes) {
      // The MediaBunny/Mp4Box (and image/seq) backends return raw pixels
      // (ImageBitmap / ImageData) rather than encoded bytes; PNG-encode them
      // so the frame is actually embedded instead of silently dropped.
      if (isImageBitmapLike(frame)) {
        bytes = await encodeBitmapToPng(frame as ImageBitmap);
        encodedToPng = true;
      } else if (isImageDataLike(frame)) {
        bytes = await encodeImageDataToPng(frame);
        encodedToPng = true;
      }
    }
    if (bytes) frameData.set(frameIdx, bytes);
  }
  if (unreadable.length > 0) {
    const name = Array.isArray(video.filename)
      ? video.filename[0]
      : video.filename;
    const list =
      unreadable.slice(0, 10).join(", ") +
      (unreadable.length > 10 ? ", …" : "");
    throw new Error(
      `Couldn't read ${unreadable.length} frame image(s) from "${name}" to embed ` +
        `(frame ${list}). The package was not written.`,
    );
  }
  return { frameData, encodedFormat: encodedToPng ? "png" : null };
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
 * The source video's dimensions recorded on an embedded video dataset, as
 * Python sleap-io's `frames`/`height`/`width`/`channels`/`fps` attributes: the
 * UNCROPPED frame for a cropped video (the embedded pixels are the full source
 * frame), and the channel-forced shape for a grayscale one. `null` when the
 * shape isn't known.
 */
export type EmbeddedVideoAttrs = {
  frames: number;
  height: number;
  width: number;
  channels: number;
  fps: number | null;
} | null;

function embeddedVideoAttrs(video: Video): EmbeddedVideoAttrs {
  const inner =
    video.backend instanceof CropVideoBackend ? video.backend.inner : null;
  const shape =
    (inner ? inner.shape : video.shape) ??
    (video.backendMetadata?.source_shape as number[] | undefined);
  if (!shape) return null;
  const fps = (inner ? inner.fps : video.fps) ?? null;
  return {
    frames: shape[0],
    height: shape[1],
    width: shape[2],
    channels: shape[3],
    fps,
  };
}

/**
 * Write ONLY the `videos_json` dataset for a plan-driven embed: each planned
 * video gets the entry Python sleap-io writes for an embedded video (an
 * `HDF5Video` over `video{vi}/video`, whose shape counts the EMBEDDED frames,
 * plus the source_video lineage); every other video is serialized normally.
 * The top-level `filename` is "." (Python writes the package's own path, which
 * a byte-producing save doesn't know; both readers resolve either to the
 * package). The per-group image datasets are written separately by
 * {@link writeEmbeddedVideoData}.
 */
function writeEmbeddedVideosJson(
  file: any,
  labels: Labels,
  plan: EmbedPlan,
): void {
  const payload = labels.videos.map((video, videoIndex) => {
    const entry = plan.get(videoIndex);
    if (entry) {
      // For a cropped video, videos_json must describe the UNCROPPED inner frame
      // (the crop rides /video_crops and is re-applied once on read).
      const attrs = embeddedVideoAttrs(video);
      const outEntry: Record<string, unknown> = {
        filename: ".",
        backend: {
          type: "HDF5Video",
          shape: attrs
            ? [
                entry.frameNumbers.length,
                attrs.height,
                attrs.width,
                attrs.channels,
              ]
            : null,
          filename: ".",
          dataset: `video${videoIndex}/video`,
          input_format: "channels_last",
          convert_range: false,
          has_embedded_images: true,
          grayscale: attrs ? attrs.channels === 1 : null,
          fps: attrs?.fps ?? null,
        },
      };
      // Preserve the full source_video lineage (filename + backend incl. shape
      // + deeper chain), mirroring newer Python which nests it in videos_json as
      // well as the authoritative HDF5 group written below. See #160.
      const srcDict = sourceVideoDict(video);
      if (srcDict) outEntry.source_video = srcDict;
      return JSON.stringify(outEntry);
    }
    return JSON.stringify(serializeVideo(video));
  });
  file.create_dataset({ name: "videos_json", data: payload });
}

/**
 * HDF5 chunk width for a padded embedded video dataset written row by row
 * (when the widest frame isn't known up front). Each written row allocates
 * whole chunks, so this bounds the per-frame overhead to ~1/8 of the first
 * frame's size while keeping chunk counts modest.
 */
export function paddedChunkWidth(firstFrameBytes: number): number {
  let width = 4096;
  while (width < firstFrameBytes / 8 && width < 262144) width *= 2;
  return width;
}

/** View encoded bytes as the `int8` Python stores them as (no copy). */
function asInt8(bytes: Uint8Array): Int8Array {
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Write an embedded video dataset's attributes exactly as Python sleap-io:
 * `format` and `channel_order` as variable-length UTF-8 strings, the source
 * dimensions as int64 and `fps` as float64.
 */
function writeEmbeddedVideoAttrs(
  ds: any,
  format: string,
  channelOrder: string,
  attrs: EmbeddedVideoAttrs,
): void {
  ds.create_attribute("format", format);
  ds.create_attribute("channel_order", channelOrder);
  if (!attrs) return;
  for (const key of ["frames", "height", "width", "channels"] as const) {
    ds.create_attribute(
      key,
      BigInt64Array.from([BigInt(attrs[key])]),
      [],
      "<q",
    );
  }
  if (attrs.fps != null) ds.create_attribute("fps", attrs.fps, [], "<d");
}

/**
 * `{group}/frame_numbers` as Python sleap-io writes it: int64, or (for an
 * empty embedded video, written from an empty list) an empty float64 array.
 */
function writeFrameNumbers(
  file: any,
  group: string,
  frameNumbers: number[],
): void {
  file.create_dataset(
    frameNumbers.length > 0
      ? {
          name: `${group}/frame_numbers`,
          data: BigInt64Array.from(frameNumbers, (f) => BigInt(f)),
          shape: [frameNumbers.length],
          dtype: "<q",
        }
      : {
          name: `${group}/frame_numbers`,
          data: new Float64Array(0),
          shape: [0],
          dtype: "<d",
        },
  );
}

/**
 * Write the per-video embedded image datasets for each planned video, in
 * Python sleap-io's layout: `{group}/video` is a 2-D `int8` dataset with one
 * encoded image per row, zero-padded to the widest image (Python's
 * `fixed_length` default), with `format`, `channel_order` and the source's
 * `frames`/`height`/`width`/`channels`/`fps` attributes; `frame_numbers` lists
 * the source frame of each row; `source_video` records the lineage. A video
 * with no frames is written as Python's empty embedded video (a 1-D empty
 * dataset). Raw entries copy the stored encoded blobs verbatim via
 * `getFrameBuffer`; encode entries write the pre-collected bytes.
 *
 * Peak memory: the raw path STREAMS stored blobs one row at a time into a
 * chunked dataset whose width grows to the widest blob (the widest isn't known
 * until every blob is read), rather than holding every blob at once. The
 * encode path's bytes are already in memory, so it writes Python's contiguous
 * dataset directly. Readers see the same rows either way.
 *
 * Backstop (raw path only): if a video planned N frames but fewer blobs could
 * be read, throw rather than silently write a file with the images stripped —
 * exactly the #213 data-loss this fix prevents.
 */
async function writeEmbeddedVideoData(
  file: any,
  labels: Labels,
  plan: EmbedPlan,
  onProgress?: SlpWriteOptions["onProgress"],
): Promise<void> {
  const totalFrames = [...plan.values()].reduce(
    (n, e) => n + e.frameNumbers.length,
    0,
  );
  let framesWritten = 0;
  for (const entry of plan.values()) {
    const group = `video${entry.videoIndex}`;
    const video = labels.videos[entry.videoIndex];
    file.create_group(group);

    const writtenFns =
      entry.kind === "raw"
        ? await writeRawEmbeddedVideo(file, group, entry)
        : writeEncodedEmbeddedVideo(file, group, entry);

    // Backstop (raw path only): a raw copy's frameNumbers IS the exact stored
    // set (embeddedFrameIndices), so every frame must read a blob — a partial
    // read is anomalous data loss. Refuse to write a stripped file rather than
    // silently drop images (the #213 data-loss this fix prevents). Note
    // frameNumbers.length is always > 0 for a raw entry (planEmbedding skips
    // 0-frame videos).
    if (entry.kind === "raw" && writtenFns.length < entry.frameNumbers.length) {
      throw new Error(
        `embedding video${entry.videoIndex}: read ${writtenFns.length} of ` +
          `${entry.frameNumbers.length} planned frame(s) - refusing to write a ` +
          `file with dropped images.`,
      );
    }

    writeEmbeddedVideoAttrs(
      file.get(`${group}/video`),
      entry.format,
      entry.channelOrder,
      embeddedVideoAttrs(video),
    );
    if (totalFrames > 0 && writtenFns.length > 0) {
      framesWritten += writtenFns.length;
      reportProgress(onProgress, framesWritten, totalFrames, "Writing frames");
    }
    writeFrameNumbers(file, group, writtenFns);

    // Write the source video lineage into the authoritative
    // `{group}/source_video` HDF5 group — the location Python reads for an
    // embedded `.pkg.slp` (it ignores videos_json's source_video for embedded
    // videos). Mirrors Python `write_videos`' lineage pass. See #160.
    const srcDict = sourceVideoDict(video);
    if (srcDict) writeSourceVideoJson(file, group, srcDict);
  }
}

/**
 * Raw path: copy a video's stored encoded blobs, one per row, into a chunked
 * 2-D `int8` dataset at `{group}/video` whose width grows to the widest blob,
 * so only one blob is in memory at a time. A blob that reads back null/empty
 * is skipped (the caller's backstop then refuses to write a file with dropped
 * images). Returns the frame numbers written, in row order.
 */
async function writeRawEmbeddedVideo(
  file: any,
  group: string,
  entry: EmbedPlanEntry,
): Promise<number[]> {
  const rows = entry.frameNumbers.length;
  const writtenFns: number[] = [];
  let ds: any = null;
  let width = 0;
  for (const fn of entry.frameNumbers) {
    const blob = await entry.video.getFrameBuffer(fn);
    if (!blob || blob.length === 0) continue;
    if (!ds) {
      file.create_dataset({
        name: `${group}/video`,
        data: new Int8Array(0),
        shape: [rows, 0],
        maxshape: [rows, null],
        chunks: [1, paddedChunkWidth(blob.length)],
        dtype: "<b",
      });
      ds = file.get(`${group}/video`);
    }
    if (blob.length > width) {
      width = blob.length;
      ds.resize([rows, width]);
    }
    const row = writtenFns.length;
    ds.write_slice(
      [
        [row, row + 1],
        [0, blob.length],
      ],
      asInt8(blob),
    );
    writtenFns.push(fn);
  }
  if (!ds) {
    file.create_dataset({
      name: `${group}/video`,
      data: new Int8Array(0),
      shape: [0],
      dtype: "<b",
    });
  }
  return writtenFns;
}

/**
 * Encode path: write a video's pre-collected frame bytes (`entry.frameData`,
 * already fully in memory) exactly as Python sleap-io: a contiguous
 * `[frames, widest]` `int8` dataset, each row zero-padded; for no frames,
 * Python's empty `[0]` dataset. Returns the frame numbers written.
 */
function writeEncodedEmbeddedVideo(
  file: any,
  group: string,
  entry: EmbedPlanEntry,
): number[] {
  const blobs: Uint8Array[] = [];
  const writtenFns: number[] = [];
  for (const fn of entry.frameNumbers) {
    const blob = entry.frameData!.get(fn) ?? null;
    if (!blob || blob.length === 0) continue;
    blobs.push(blob);
    writtenFns.push(fn);
  }
  if (blobs.length === 0) {
    file.create_dataset({
      name: `${group}/video`,
      data: new Int8Array(0),
      shape: [0],
      dtype: "<b",
    });
    return writtenFns;
  }
  const width = blobs.reduce((w, b) => Math.max(w, b.length), 0);
  const padded = new Int8Array(blobs.length * width);
  for (let row = 0; row < blobs.length; row++) {
    padded.set(asInt8(blobs[row]), row * width);
  }
  file.create_dataset({
    name: `${group}/video`,
    data: padded,
    shape: [blobs.length, width],
    dtype: "<b",
  });
  return writtenFns;
}

/**
 * Write a 2-D matrix dataset with a `field_names` attribute.
 *
 * When `resizable` is true the dataset is created CHUNKED with an unlimited
 * axis-0 `maxshape` (mirroring {@link createAppendableMatrixDataset}) so it can
 * later be grown/shrunk in place via `resize` + `write_slice` — the on-disk
 * pre-requisite for the fast in-place label save ({@link writeLabelTablesInPlace}).
 * The logical content is byte-for-byte identical to the contiguous layout; only
 * the storage layout changes. Used for the mutable label tables
 * (frames/instances/points/pred_points/negative_frames); the annotation tables
 * stay contiguous (`resizable` defaults to false).
 */
function createMatrixDataset(
  file: any,
  name: string,
  rows: number[][],
  fieldNames: string[],
  dtype: string,
  resizable = false,
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
  if (resizable) {
    // Chunk rows cap the per-chunk allocation for large tables while staying
    // small for tiny files (chunk >= 1 is required by HDF5, even for 0 rows).
    const chunkRows = Math.max(1, Math.min(WRITE_CHUNK_ROWS, rowCount || 1));
    file.create_dataset({
      name,
      data,
      shape: [rowCount, colCount],
      maxshape: [null, colCount],
      chunks: [chunkRows, colCount],
      dtype,
    });
  } else {
    file.create_dataset({ name, data, shape: [rowCount, colCount], dtype });
  }
  const dataset = file.get(name);
  setStringAttr(dataset, "field_names", JSON.stringify(fieldNames));
}

/** One member of a compound (structured) dataset: `[name, HDF5 dtype]`. */
type CompoundField = [name: string, dtype: string];

// Per-member (name, dtype) layout for the pose tables written as HDF5 COMPOUND
// datasets — matching Python sleap-io's on-disk dtypes (see `io/slp.py`
// `instance_dtype`/`point_dtype`/`predicted_point_dtype` + the negative-frames
// dtype). Writing these as a flat float matrix made Python read the id/count
// columns (skeleton, track, …) back as `numpy.float32`, so `skeletons[id]`
// raised `TypeError: list indices must be integers` (#218) — the values were
// fine, only the on-disk dtype was wrong.
//
// NB: h5wasm dtype strings are SINGLE-CHAR — the trailing digits are ignored
// (`<f8` is really float32!), and `u`/numpy widths aren't accepted. The chars:
// `q`/`Q` = (u)int64, `i`/`I` = (u)int32, `b`/`B` = (u)int8, `f` = float32,
// `d` = float64. Python stores `visible`/`complete` as bool (`?`); HDF5-bool
// isn't writable through h5wasm, so we store them as uint8 (Python casts them
// back to bool on read).
const INSTANCE_COMPOUND_FIELDS: CompoundField[] = [
  ["instance_id", "<q"], // i8
  ["instance_type", "<B"], // u1
  ["frame_id", "<Q"], // u8
  ["skeleton", "<I"], // u4
  ["track", "<i"], // i4 (carries -1)
  ["from_predicted", "<q"], // i8 (carries -1)
  ["score", "<f"], // f4
  ["point_id_start", "<Q"], // u8
  ["point_id_end", "<Q"], // u8
  ["tracking_score", "<f"], // f4
];
const POINT_COMPOUND_FIELDS: CompoundField[] = [
  ["x", "<d"], // f8
  ["y", "<d"], // f8
  ["visible", "<B"], // bool -> u1
  ["complete", "<B"], // bool -> u1
];
const PRED_POINT_COMPOUND_FIELDS: CompoundField[] = [
  ["x", "<d"], // f8
  ["y", "<d"], // f8
  ["visible", "<B"], // bool -> u1
  ["complete", "<B"], // bool -> u1
  ["score", "<d"], // f8
];
const NEGATIVE_FRAME_COMPOUND_FIELDS: CompoundField[] = [
  ["video_id", "<I"], // u4
  ["frame_idx", "<Q"], // u8
];

/**
 * Write `rows` as an HDF5 COMPOUND (structured) dataset — one struct per row,
 * each member with its own dtype — the layout Python sleap-io expects for the
 * pose tables. `fields` gives `[memberName, hdf5Dtype]` in column order;
 * `rows[i][j]` supplies member j of row i. h5wasm takes the columns as a
 * per-member `Map` and packs them into an array-of-structures; passing plain
 * number columns lets it widen 64-bit int members to BigInt itself.
 *
 * A `field_names` attribute is stamped too — Python ignores it (it reads the
 * compound member names), and it keeps this dataset shape identical to the old
 * matrix output for any JS reader that keys off the attribute.
 */
function createCompoundDataset(
  file: any,
  name: string,
  rows: number[][],
  fields: CompoundField[],
): void {
  const rowCount = rows.length;
  const columns = new Map<string, number[]>();
  for (let j = 0; j < fields.length; j++) {
    const col = new Array<number>(rowCount);
    for (let i = 0; i < rowCount; i++) col[i] = rows[i][j];
    columns.set(fields[j][0], col);
  }
  // Emit the compound pose tables CHUNKED + unlimited (1-D `maxshape: [null]`) so
  // a later edit can be re-saved IN PLACE (`write_slice` for value edits,
  // `resize` + `write_slice` for structural edits) without rewriting the
  // multi-GB embedded video groups — the reconciliation of #218 (compound, for
  // Python interop) with the in-place edit-save (which requires resizable tables;
  // see writeLabelTablesInPlace / checkInPlaceWritable). chunk >= 1 is required by
  // HDF5 even for 0 rows.
  const chunkRows = Math.max(1, Math.min(WRITE_CHUNK_ROWS, rowCount || 1));
  file.create_dataset({
    name,
    data: columns,
    shape: [rowCount],
    maxshape: [null],
    chunks: [chunkRows],
    dtype: fields,
  });
  setStringAttr(
    file.get(name),
    "field_names",
    JSON.stringify(fields.map(([fieldName]) => fieldName)),
  );
}

// The 2.x annotation tables as Python sleap-io writes them (`legacy_format=True`
// in 0.10, and 0.9.x): contiguous compound datasets with these member types
// (`_TABLE_SPECS[...].legacy`, `LI_DTYPE`, `OBJ_DTYPE`, `LI_SM_INDEX_DTYPE`),
// and the strings in variable-length UTF-8 string datasets beside them. See
// the note above INSTANCE_COMPOUND_FIELDS for the h5wasm dtype characters.
const SPATIAL_COMPOUND_FIELDS: CompoundField[] = [
  ["scale_x", "<f"], // f4
  ["scale_y", "<f"], // f4
  ["offset_x", "<f"], // f4
  ["offset_y", "<f"], // f4
];
const ROI_COMPOUND_FIELDS: CompoundField[] = [
  ["annotation_type", "<B"], // u1
  ["video", "<i"], // i4
  ["frame_idx", "<q"], // i8
  ["track", "<i"], // i4
  ["is_predicted", "<B"], // u1
  ["score", "<f"], // f4
  ["tracking_score", "<f"], // f4
  ["wkb_start", "<Q"], // u8
  ["wkb_end", "<Q"], // u8
  ["instance", "<i"], // i4
];
const MASK_COMPOUND_FIELDS: CompoundField[] = [
  ["height", "<I"], // u4
  ["width", "<I"], // u4
  ["annotation_type", "<B"], // u1
  ["video", "<i"], // i4
  ["frame_idx", "<q"], // i8
  ["track", "<i"], // i4
  ["instance", "<i"], // i4
  ["from_predicted", "<i"], // i4
  ["is_predicted", "<B"], // u1
  ["score", "<f"], // f4
  ["tracking_score", "<f"], // f4
  ["rle_start", "<Q"], // u8
  ["rle_end", "<Q"], // u8
  ...SPATIAL_COMPOUND_FIELDS,
];
const scoreMapIndexFields = (index: string): CompoundField[] => [
  [index, "<I"], // u4
  ["data_start", "<Q"], // u8
  ["data_end", "<Q"], // u8
  ["height", "<I"], // u4
  ["width", "<I"], // u4
  ...SPATIAL_COMPOUND_FIELDS,
];
const LABEL_IMAGE_COMPOUND_FIELDS: CompoundField[] = [
  ["video", "<i"], // i4
  ["frame_idx", "<q"], // i8
  ["height", "<I"], // u4
  ["width", "<I"], // u4
  ["n_objects", "<I"], // u4
  ["objects_start", "<I"], // u4
  ["data_start", "<Q"], // u8
  ["data_end", "<Q"], // u8
  ["is_predicted", "<B"], // u1
  ["score", "<f"], // f4
  ...SPATIAL_COMPOUND_FIELDS,
];
const LABEL_IMAGE_OBJECT_COMPOUND_FIELDS: CompoundField[] = [
  ["label_id", "<i"], // i4
  ["track", "<i"], // i4
  ["instance", "<i"], // i4
  ["score", "<f"], // f4
  ["tracking_score", "<f"], // f4
];

/**
 * Write one of the 2.x annotation tables as Python sleap-io does: a
 * contiguous compound dataset with `fields` as its members. `rows[i][j]` is
 * the value of column `columns[j]` of row i, in any order.
 */
function createLegacyTable(
  file: any,
  name: string,
  rows: number[][],
  columns: string[],
  fields: CompoundField[],
): void {
  const data = new Map<string, number[]>();
  for (const [field] of fields) {
    const j = columns.indexOf(field);
    if (j < 0) throw new Error(`${name}: no value for column ${field}`);
    data.set(
      field,
      rows.map((row) => row[j]),
    );
  }
  file.create_dataset({ name, data, shape: [rows.length], dtype: fields });
}

/** Write strings as Python sleap-io does: a variable-length UTF-8 dataset. */
function writeVlenStrings(file: any, name: string, values: string[]): void {
  file.create_dataset({
    name,
    data: values,
    shape: [values.length],
    dtype: "S",
  });
}

/** How a table writer writes format 3.0 (`null`: the 2.x layout). */
interface V3Write {
  /** Unknown columns kept from loading, offered to each table. */
  carry: CarrySession;
}

/** Concatenate byte chunks into one buffer. */
function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Columns of a 3.0 table from rows built for the 2.x writers: `names[j]` is
 * the column of `rows[i][j]`; `spec` gives the 3.0 columns to write, in order.
 */
function rowColumns(
  rows: readonly number[][],
  names: readonly string[],
  spec: ReadonlyArray<[string, ColumnType]>,
): Column[] {
  return spec.map(([name, type]) => {
    const j = names.indexOf(name);
    if (j < 0) throw new Error(`no value for column ${name}`);
    return { name, type, values: rows.map((row) => row[j]) };
  });
}

/** A string column of a 3.0 table. */
function stringColumn(name: string, values: readonly string[]): Column {
  return { name, type: "str", values };
}

// Format 3.0 column types of the annotation, link and session tables
// (Python's `_TABLE_SPECS[...].raw`).
const V3_SPATIAL_COLUMNS: Array<[string, ColumnType]> = [
  ["scale_x", "f8"],
  ["scale_y", "f8"],
  ["offset_x", "f8"],
  ["offset_y", "f8"],
];
const V3_ROI_COLUMNS: Array<[string, ColumnType]> = [
  ["annotation_type", "u1"],
  ["video", "i8"],
  ["frame_idx", "i8"],
  ["track", "i8"],
  ["instance", "i8"],
  ["is_predicted", "bool"],
  ["score", "f8"],
  ["tracking_score", "f8"],
  ["wkb_start", "i8"],
  ["wkb_end", "i8"],
];
const V3_MASK_COLUMNS: Array<[string, ColumnType]> = [
  ["height", "i8"],
  ["width", "i8"],
  ["annotation_type", "u1"],
  ["video", "i8"],
  ["frame_idx", "i8"],
  ["track", "i8"],
  ["instance", "i8"],
  ["from_predicted", "i8"],
  ["is_predicted", "bool"],
  ["score", "f8"],
  ["tracking_score", "f8"],
  ["rle_start", "i8"],
  ["rle_end", "i8"],
  ...V3_SPATIAL_COLUMNS,
];
const v3ScoreMapColumns = (index: string): Array<[string, ColumnType]> => [
  [index, "i8"],
  ["data_start", "i8"],
  ["data_end", "i8"],
  ["height", "i8"],
  ["width", "i8"],
  ...V3_SPATIAL_COLUMNS,
];
const V3_LABEL_IMAGE_COLUMNS: Array<[string, ColumnType]> = [
  ["video", "i8"],
  ["frame_idx", "i8"],
  ["height", "i8"],
  ["width", "i8"],
  ["n_objects", "i8"],
  ["objects_start", "i8"],
  ["data_start", "i8"],
  ["data_end", "i8"],
  ["is_predicted", "bool"],
  ["score", "f8"],
  ...V3_SPATIAL_COLUMNS,
];
const V3_LABEL_IMAGE_OBJECT_COLUMNS: Array<[string, ColumnType]> = [
  ["label_id", "i8"],
  ["track", "i8"],
  ["instance", "i8"],
  ["score", "f8"],
  ["tracking_score", "f8"],
];
const v3LinkColumns = (catalog: string): Array<[string, ColumnType]> => [
  ["owner_type", "u1"],
  ["owner_id", "i8"],
  [`${catalog}_idx`, "i8"],
  [`${catalog}_score`, "f8"],
];
const V3_FRAME_GROUP_COLUMNS: Array<[string, ColumnType]> = [
  ["frame_idx", "i8"],
  ["ig_start", "i8"],
  ["ig_end", "i8"],
];
const V3_INSTANCE_GROUP_COLUMNS: Array<[string, ColumnType]> = [
  ["identity_idx", "i8"],
  ["score", "f8"],
  ["instance_3d_score", "f8"],
  ["pts3d_start", "i8"],
  ["pts3d_end", "i8"],
  ["pts3d_predicted", "bool"],
  ["member_start", "i8"],
  ["member_end", "i8"],
];
const V3_MEMBER_COLUMNS: Array<[string, ColumnType]> = [
  ["camera", "i8"],
  ["lf", "i8"],
  ["inst", "i8"],
];

function writeRois(
  file: any,
  rois: ROI[],
  videos: Video[],
  tracks: Array<{ name: string }>,
  instances?: Array<Instance | PredictedInstance>,
  contexts?: [number, number][],
  v3?: V3Write | null,
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

  if (v3) {
    // Format 3.0: a `/rois` group of columns holding the gzipped `wkb`.
    writeColumnTable(
      file,
      "rois",
      [
        ...rowColumns(
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
          V3_ROI_COLUMNS,
        ),
        stringColumn("name", names),
        stringColumn("category", categories),
        stringColumn("source", sources),
      ],
      {
        carried: v3.carry.columnsFor(
          "rois",
          rois.map((r) => [r]),
        ),
      },
    );
    writeByteBuffer(file, "rois/wkb", concatBytes(wkbChunks), true);
    return;
  }

  createLegacyTable(
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
    ROI_COMPOUND_FIELDS,
  );

  // Write string metadata as datasets at root level (v1.9+)
  writeVlenStrings(file, "roi_categories", categories);
  writeVlenStrings(file, "roi_names", names);
  writeVlenStrings(file, "roi_sources", sources);

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
  v3?: V3Write | null,
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
          pm.scoreMapScale[0],
          pm.scoreMapScale[1],
          pm.scoreMapOffset[0],
          pm.scoreMapOffset[1],
        ]);
        scoreMapChunks.push(compressed);
        smOffset += compressed.length;
      }
    }
  }

  if (v3) {
    // Format 3.0: a `/masks` group of columns holding the gzipped `rle`, and
    // a `score_maps/` group with its `data` buffer.
    writeColumnTable(
      file,
      "masks",
      [
        ...rowColumns(
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
          V3_MASK_COLUMNS,
        ),
        stringColumn("name", names),
        stringColumn("category", categories),
        stringColumn("source", sources),
      ],
      {
        carried: v3.carry.columnsFor(
          "masks",
          masks.map((m) => [m]),
        ),
      },
    );
    writeByteBuffer(file, "masks/rle", concatBytes(rleChunks), true);
    const smKeys = scoreMapIndexRows.map((row) => [masks[row[0]]]);
    const smCarried = v3.carry.columnsFor("masks/score_maps", smKeys);
    if (scoreMapIndexRows.length > 0) {
      writeColumnTable(
        file,
        "masks/score_maps",
        rowColumns(
          scoreMapIndexRows,
          [
            "mask_idx",
            "data_start",
            "data_end",
            "height",
            "width",
            "scale_x",
            "scale_y",
            "offset_x",
            "offset_y",
          ],
          v3ScoreMapColumns("mask_idx"),
        ),
        { carried: smCarried },
      );
      writeByteBuffer(
        file,
        "masks/score_maps/data",
        concatBytes(scoreMapChunks),
        false,
      );
    }
    return;
  }

  createLegacyTable(
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
    MASK_COMPOUND_FIELDS,
  );

  // Write string metadata as datasets at root level (v1.9+)
  writeVlenStrings(file, "mask_categories", categories);
  writeVlenStrings(file, "mask_names", names);
  writeVlenStrings(file, "mask_sources", sources);

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
    createLegacyTable(
      file,
      "mask_score_map_index",
      scoreMapIndexRows,
      [
        "mask_idx",
        "data_start",
        "data_end",
        "height",
        "width",
        "scale_x",
        "scale_y",
        "offset_x",
        "offset_y",
      ],
      scoreMapIndexFields("mask_idx"),
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
  v3?: V3Write | null,
): void {
  if (!bboxes.length) return;

  const n = bboxes.length;
  const x1 = new Float64Array(n);
  const y1 = new Float64Array(n);
  const x2 = new Float64Array(n);
  const y2 = new Float64Array(n);
  const angle = new Float64Array(n);
  const video = new Int32Array(n);
  const frameIdx = new Int32Array(n);
  const track = new Int32Array(n);
  const instance = new Int32Array(n);
  const isPredicted = new Uint8Array(n);
  const score = new Float64Array(n);
  const trackingScore = new Float64Array(n);
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  // Row order is the bbox order passed in: identity/category/embedding links
  // (OWNER_BBOX) are keyed by this row index, so it must not be reordered.
  for (let i = 0; i < n; i++) {
    const bbox = bboxes[i];
    x1[i] = bbox.x1;
    y1[i] = bbox.y1;
    x2[i] = bbox.x2;
    y2[i] = bbox.y2;
    angle[i] = bbox.angle;
    video[i] = contexts ? contexts[i][0] : -1;
    frameIdx[i] = contexts ? contexts[i][1] : -1;
    track[i] = bbox.track ? tracks.indexOf(bbox.track as any) : -1;
    // Fall back to stored _instanceIdx when no live instance link (e.g., lazy mode).
    instance[i] = bbox.instance
      ? instances.indexOf(bbox.instance as Instance)
      : (bbox._instanceIdx ?? -1);
    isPredicted[i] = bbox.isPredicted ? 1 : 0;
    score[i] = bbox.isPredicted
      ? (bbox as PredictedBoundingBox).score
      : Number.NaN;
    trackingScore[i] = bbox.trackingScore ?? Number.NaN;
    categories.push(bbox.category);
    names.push(bbox.name);
    sources.push(bbox.source);
  }

  // Match Python sleap-io's on-disk layout (SLP 2.0+): a `/bboxes` GROUP with
  // one named dataset per field (NOT a flat matrix), so Python/PyQt sleap-io can
  // read JS-written boxes. (Previously JS wrote a 2-D f8 matrix dataset + a
  // `field_names` attr and root `bbox_categories`/`bbox_names`/`bbox_sources`
  // JSON datasets; Python treats a non-group `/bboxes` as its legacy compound
  // table and crashed indexing `row["video"]`.) Dtypes follow Python except
  // `frame_idx` (i4, as for centroids) and `score`/`tracking_score` (f8, so JS
  // scores round-trip exactly; Python reads either width).
  file.create_group("bboxes");
  const col = (name: string, data: ArrayLike<number>, dtype: string) =>
    file.create_dataset({ name: `bboxes/${name}`, data, shape: [n], dtype });
  col("x1", x1, "<d");
  col("y1", y1, "<d");
  col("x2", x2, "<d");
  col("y2", y2, "<d");
  col("angle", angle, "<d");
  col("video", video, "<i4");
  col("frame_idx", frameIdx, "<i4");
  col("track", track, "<i4");
  col("instance", instance, "<i4");
  col("is_predicted", isPredicted, "<B");
  col("score", score, "<d");
  col("tracking_score", trackingScore, "<d");
  file.create_dataset({ name: "bboxes/category", data: categories });
  file.create_dataset({ name: "bboxes/name", data: names });
  file.create_dataset({ name: "bboxes/source", data: sources });
  if (v3) {
    // Format 3.0 keeps the 2.0 columns, any unknown columns still lining up
    // with the boxes, and the boxes' metadata.
    for (const [name, column] of Object.entries(
      v3.carry.columnsFor(
        "bboxes",
        bboxes.map((b) => [b]),
      ),
    )) {
      writeColumnTable(file, "bboxes", [], { carried: { [name]: column } });
    }
    writeMetadataColumns(
      file,
      "bboxes",
      metadataColumnsOf(bboxes, "bboxes", metadataKindHint(bboxes, "bboxes")),
    );
  }
}

function writeLabelImages(
  file: any,
  labelImages: LabelImage[],
  _videos: Video[],
  tracks: Track[],
  instances: (Instance | PredictedInstance)[],
  contexts?: [number, number][],
  v3?: V3Write | null,
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
  const objectOwners: unknown[][] = [];
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
      objectOwners.push([info]);
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
          pli.scoreMapScale[0],
          pli.scoreMapScale[1],
          pli.scoreMapOffset[0],
          pli.scoreMapOffset[1],
        ]);
        smChunks.push(smCompressed);
        smOffset += smCompressed.length;
      }
    }
  }

  if (v3) {
    // Format 3.0: a `/label_images` group of columns holding the pixel `data`
    // (each image zlib-compressed, indexed by data_start/data_end), with
    // `objects/` and `score_maps/` groups.
    const carry = v3.carry;
    writeColumnTable(
      file,
      "label_images",
      [
        ...rowColumns(
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
          V3_LABEL_IMAGE_COLUMNS,
        ),
        stringColumn("source", sources),
      ],
      {
        carried: carry.columnsFor(
          "label_images",
          labelImages.map((li) => [li]),
        ),
      },
    );
    writeByteBuffer(
      file,
      "label_images/data",
      concatBytes(compressedChunks),
      false,
    );
    writeColumnTable(
      file,
      "label_images/objects",
      [
        ...rowColumns(
          objectRows,
          ["label_id", "track", "instance", "score", "tracking_score"],
          V3_LABEL_IMAGE_OBJECT_COLUMNS,
        ),
        stringColumn("name", objectNames),
        stringColumn("category", objectCategories),
      ],
      { carried: carry.columnsFor("label_images/objects", objectOwners) },
    );
    const smCarried = carry.columnsFor(
      "label_images/score_maps",
      smIndexRows.map((row) => [labelImages[row[0]]]),
    );
    if (smIndexRows.length > 0) {
      writeColumnTable(
        file,
        "label_images/score_maps",
        rowColumns(
          smIndexRows,
          [
            "li_idx",
            "data_start",
            "data_end",
            "height",
            "width",
            "scale_x",
            "scale_y",
            "offset_x",
            "offset_y",
          ],
          v3ScoreMapColumns("li_idx"),
        ),
        { carried: smCarried },
      );
      writeByteBuffer(
        file,
        "label_images/score_maps/data",
        concatBytes(smChunks),
        false,
      );
    }
    return;
  }

  // Write main metadata table
  createLegacyTable(
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
    LABEL_IMAGE_COMPOUND_FIELDS,
  );

  // Write string metadata as datasets at root level (v1.9+)
  writeVlenStrings(file, "label_image_sources", sources);

  // Write objects table (if any objects exist)
  if (objectRows.length > 0) {
    createLegacyTable(
      file,
      "label_image_objects",
      objectRows,
      ["label_id", "track", "instance", "score", "tracking_score"],
      LABEL_IMAGE_OBJECT_COMPOUND_FIELDS,
    );
    // Write string metadata as datasets at root level (v1.9+)
    writeVlenStrings(file, "label_image_obj_categories", objectCategories);
    writeVlenStrings(file, "label_image_obj_names", objectNames);
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
    createLegacyTable(
      file,
      "label_image_score_map_index",
      smIndexRows,
      [
        "li_idx",
        "data_start",
        "data_end",
        "height",
        "width",
        "scale_x",
        "scale_y",
        "offset_x",
        "offset_y",
      ],
      scoreMapIndexFields("li_idx"),
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

  const n = centroids.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const video = new Int32Array(n);
  const frameIdx = new Int32Array(n);
  const track = new Int32Array(n);
  const instance = new Int32Array(n);
  const isPredicted = new Uint8Array(n);
  const score = new Float64Array(n);
  const trackingScore = new Float64Array(n);
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  for (let i = 0; i < n; i++) {
    const c = centroids[i];
    x[i] = c.x;
    y[i] = c.y;
    z[i] = c.z ?? Number.NaN;
    video[i] = contexts ? contexts[i][0] : -1;
    frameIdx[i] = contexts ? contexts[i][1] : -1;
    track[i] = c.track ? tracks.indexOf(c.track as any) : -1;
    // Fall back to stored _instanceIdx when no live instance link (e.g., lazy mode).
    instance[i] = c.instance
      ? instances.indexOf(c.instance as Instance)
      : (c._instanceIdx ?? -1);
    isPredicted[i] = c.isPredicted ? 1 : 0;
    score[i] = c.isPredicted ? (c as PredictedCentroid).score : Number.NaN;
    trackingScore[i] = c.trackingScore ?? Number.NaN;
    categories.push(c.category);
    names.push(c.name);
    // Persist the canonical snake_case source for Python/PyQt interop. Normally
    // `c.source` is already snake_case (set by `fromInstance`/reader), but
    // normalize defensively in case a caller built the Centroid with a legacy
    // camelCase source directly.
    sources.push(normalizeCentroidSource(c.source));
  }

  // Match Python sleap-io's on-disk layout: a `/centroids` GROUP with one named
  // dataset per field (NOT a flat matrix), so Python/PyQt sleap-io can read
  // JS-written centroids. (Previously JS wrote a 2-D matrix dataset + a
  // `field_names` attr, which Python's group-expecting reader rejects with
  // "Field names only allowed for compound types".)
  file.create_group("centroids");
  const col = (name: string, data: ArrayLike<number>, dtype: string) =>
    file.create_dataset({ name: `centroids/${name}`, data, shape: [n], dtype });
  col("x", x, "<d");
  col("y", y, "<d");
  col("z", z, "<d");
  col("video", video, "<i4");
  col("frame_idx", frameIdx, "<i4");
  col("track", track, "<i4");
  col("instance", instance, "<i4");
  col("is_predicted", isPredicted, "<B");
  col("score", score, "<d");
  col("tracking_score", trackingScore, "<d");
  file.create_dataset({ name: "centroids/category", data: categories });
  file.create_dataset({ name: "centroids/name", data: names });
  file.create_dataset({ name: "centroids/source", data: sources });
}
