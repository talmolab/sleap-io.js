/**
 * Opening SLP format 3.0 files when only the 2.x layout can be written.
 *
 * Format 3.0 (Python sleap-io 0.10) can store what the 2.x layout cannot:
 * points marked as not labelled, metadata on instances, frames and bounding
 * boxes, and columns added by newer writers. This version of sleap-io.js reads
 * 3.0 but writes only the 2.x layout, so saving a loaded 3.0 file rewrites it
 * in another layout and may drop those fields. That never happens silently:
 * every reader asks the caller to choose at open time, with the `format3`
 * option.
 *
 * - `format3: "view"` loads everything and marks the labels view-only; every
 *   writer refuses them with {@link SlpViewOnlyError}.
 * - `format3: "edit"` loads the same and lets writers save the 2.x layout,
 *   dropping what it cannot store: unlabelled points become hidden points with
 *   no location, and metadata and unknown columns are not written.
 *
 * Without the option, a 3.0 file throws {@link SlpFormat3ChoiceError}, whose
 * `summary` says what an edit would drop. The lite reader's `loadSlpMetadata`
 * returns the same summary, so an application can ask before a full read.
 *
 * This module has no HDF5 dependency.
 */

import { isUrl, redactUrl } from "../../io/remote.js";
import {
  type MetadataColumn,
  type MetadataColumns,
  type MetadataKind,
  metadataKeys,
} from "../../model/record-metadata.js";
import { SlpFormatError, SlpTableError } from "./format-check.js";

/** What a caller chooses to do with a format 3.0 file (see the module docs). */
export type Format3Access = "view" | "edit";

/**
 * Whether a 3.0 file that holds nothing the 2.x layout cannot store still asks
 * for the choice. `true`: it does, because saving it still rewrites it in
 * another layout. Set to `false` to load such files editable without the
 * option.
 */
export const LOSSLESS_FORMAT3_ASKS = true;

/** What a format 3.0 file holds that the 2.x layout cannot store. */
export interface Format3Summary {
  /** The file's `format_id`. */
  formatId: number;
  /** Points with `labeled` and `visible` both false, user and predicted. */
  unlabeledPoints: number;
  /** Of {@link unlabeledPoints}, those of user instances. */
  unlabeledUserPoints: number;
  /** Of {@link unlabeledPoints}, those of predicted instances. */
  unlabeledPredictedPoints: number;
  /** Metadata keys stored per table. */
  metadataKeys: { instances: string[]; frames: string[]; bboxes: string[] };
  /** Columns this version does not know, as paths like `points/foo`. */
  unknownColumns: string[];
  /**
   * Members of the file this version does not read at all, as paths: other
   * tables (for example `events` and `event_types`), and members of groups it
   * reads in part (for example `categories/meta_key`). See
   * {@link unreadMembers}.
   */
  unreadTables: string[];
  /** True when an edit would drop nothing (all of the above are empty). */
  lossless: boolean;
}

/** Where a set of labels came from, for files in format 3.0. */
export interface SlpSourceFormat {
  /** The file's `format_id`. */
  formatId: number;
  /** The caller's choice at open time. */
  access: Format3Access;
  /** What the file holds that the 2.x layout cannot store. */
  summary: Format3Summary;
  /** Path or name of the file, with URL credentials masked. */
  labelsPath: string;
}

/** `3` → `"3.0"`, so messages name formats the usual way. */
function formatLabel(formatId: number): string {
  return Number.isInteger(formatId) ? formatId.toFixed(1) : String(formatId);
}

/** Mask URL credentials, as every SLP error does. */
function safePath(source: string): string {
  return isUrl(source) ? redactUrl(source) : source;
}

/** The list of what an edit would drop, as words; empty when lossless. */
export function describeDrops(summary: Format3Summary): string[] {
  const drops: string[] = [];
  if (summary.unlabeledPoints > 0) {
    drops.push(
      `${summary.unlabeledPoints} unlabelled point(s) (saved as hidden ` +
        "points with no location)",
    );
  }
  for (const table of ["instances", "frames", "bboxes"] as const) {
    const keys = summary.metadataKeys[table];
    if (keys.length > 0) {
      const what = table === "bboxes" ? "bounding box" : table.slice(0, -1);
      drops.push(`${what} metadata (${keys.join(", ")})`);
    }
  }
  if (summary.unknownColumns.length > 0) {
    drops.push(`unknown columns (${summary.unknownColumns.join(", ")})`);
  }
  if (summary.unreadTables.length > 0) {
    drops.push(
      `what this version does not read (${summary.unreadTables.join(", ")})`,
    );
  }
  return drops;
}

/**
 * Thrown by every reader for a file in SLP format 3.0 when the caller did not
 * pass `format3: "view"` or `format3: "edit"`. `summary` says what the file
 * holds that the 2.x layout (the only one this version writes) cannot store.
 */
export class SlpFormat3ChoiceError extends SlpFormatError {
  readonly summary: Format3Summary;

  constructor(labelsPath: string, summary: Format3Summary) {
    const path = safePath(labelsPath);
    const drops = describeDrops(summary);
    super({
      message:
        `The SLEAP labels file '${path}' is in SLP format ` +
        `${formatLabel(summary.formatId)}. This version of sleap-io.js saves ` +
        "only the 2.x layout, so saving it would rewrite it in that layout" +
        (drops.length > 0
          ? ` and drop ${drops.join("; ")}.`
          : "; nothing in it would be dropped.") +
        ' Open it with the option format3: "view" to load it read-only, or ' +
        'format3: "edit" to allow saving in the 2.x layout.',
      labelsPath: path,
      formatId: summary.formatId,
    });
    this.name = "SlpFormat3ChoiceError";
    this.summary = summary;
  }
}

/**
 * Thrown by every SLP writer, before it touches its target, for labels loaded from
 * a format 3.0 file with `format3: "view"`.
 */
export class SlpViewOnlyError extends Error {
  readonly sourceFormat: SlpSourceFormat;

  constructor(sourceFormat: SlpSourceFormat) {
    const drops = describeDrops(sourceFormat.summary);
    super(
      `These labels were loaded from '${sourceFormat.labelsPath}' (SLP format ` +
        `${formatLabel(sourceFormat.formatId)}) for viewing only ` +
        '(format3: "view"), so they cannot be saved. This version of ' +
        "sleap-io.js saves only the 2.x layout" +
        (drops.length > 0 ? `, which would drop ${drops.join("; ")}` : "") +
        '. Load the file with format3: "edit" to save it in the 2.x layout.',
    );
    this.name = "SlpViewOnlyError";
    this.sourceFormat = sourceFormat;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A deeply frozen copy of a summary. */
function freezeSummary(summary: Format3Summary): Format3Summary {
  return Object.freeze({
    ...summary,
    metadataKeys: Object.freeze({
      instances: Object.freeze([...summary.metadataKeys.instances]),
      frames: Object.freeze([...summary.metadataKeys.frames]),
      bboxes: Object.freeze([...summary.metadataKeys.bboxes]),
    }) as Format3Summary["metadataKeys"],
    unknownColumns: Object.freeze([
      ...summary.unknownColumns,
    ]) as unknown as string[],
    unreadTables: Object.freeze([
      ...summary.unreadTables,
    ]) as unknown as string[],
  });
}

/**
 * Top-level members of an SLP file that this version reads, in some layout
 * (Python sleap-io's `_KNOWN_TOPLEVEL_HDF5_NAMES` without the event tables,
 * plus sleap-io.js's own `identities_json`). Per-video groups (`video0`, ...)
 * are read too.
 */
const READ_TOP_LEVEL: ReadonlySet<string> = new Set([
  "metadata",
  "videos_json",
  "tracks_json",
  "suggestions_json",
  "sessions_json",
  "session_data",
  "identity",
  "identities_json",
  "embeddings",
  "categories",
  "frames",
  "instances",
  "points",
  "pred_points",
  "negative_frames",
  "video_crops",
  "bboxes",
  "centroids",
  "rois",
  "roi_wkb",
  "roi_categories",
  "roi_names",
  "roi_sources",
  "masks",
  "mask_rle",
  "mask_categories",
  "mask_names",
  "mask_sources",
  "mask_score_map_index",
  "mask_score_maps",
  "label_images",
  "label_image_objects",
  "label_image_data",
  "label_image_sources",
  "label_image_obj_categories",
  "label_image_obj_names",
  "label_image_score_map_index",
  "label_image_score_maps",
]);

/**
 * The members of the groups this version reads that it reads. Category
 * metadata (`categories/meta_*`) is not read: categories are plain strings
 * here.
 */
const READ_GROUP_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> = {
  identity: new Set(["name", "meta_owner", "meta_key", "meta_val", "links"]),
  categories: new Set(["name", "links"]),
  embeddings: new Set([
    "vectors",
    "owner_type",
    "owner_id",
    "category_vectors",
    "category_owner_type",
    "category_owner_id",
  ]),
  session_data: new Set([
    "frame_groups",
    "instance_groups",
    "instance_group_members",
    "points_3d",
    "pred_points_3d",
    "frame_group_meta",
    "instance_group_meta",
  ]),
};

/** The groups whose members {@link unreadMembers} checks. */
export const PARTLY_READ_GROUPS: readonly string[] =
  Object.keys(READ_GROUP_MEMBERS);

/**
 * What a file holds that this version does not read at all, as paths: its
 * top-level members other than those it reads (for example `events` and
 * `event_types`, or a table added by a newer writer), and members of the
 * groups in {@link PARTLY_READ_GROUPS} other than those it reads.
 * `provenance_json` counts only when `/metadata`'s `json` attribute holds no
 * copy of the provenance (Python mirrors it there when it fits).
 *
 * @param root The file's top-level member names.
 * @param groups The member names of each group in {@link PARTLY_READ_GROUPS}
 *   that the file has.
 * @param provenanceInMetadata Whether `/metadata`'s `json` holds provenance.
 */
export function unreadMembers(options: {
  root: readonly string[];
  groups: Readonly<Record<string, readonly string[]>>;
  provenanceInMetadata: boolean;
}): string[] {
  const out: string[] = [];
  for (const name of options.root) {
    if (READ_TOP_LEVEL.has(name) || /^video\d+$/.test(name)) continue;
    if (name === "provenance_json" && options.provenanceInMetadata) continue;
    out.push(name);
  }
  for (const [group, members] of Object.entries(options.groups)) {
    const read = READ_GROUP_MEMBERS[group];
    if (!read) continue;
    for (const name of members) {
      if (!read.has(name)) out.push(`${group}/${name}`);
    }
  }
  return out.sort();
}

/** Build the summary of a 3.0 file from what the readers gathered. */
export function buildFormat3Summary(options: {
  formatId: number;
  unlabeledUserPoints: number;
  unlabeledPredictedPoints: number;
  metadataKeys: { instances: string[]; frames: string[]; bboxes: string[] };
  unknownColumns: string[];
  unreadTables?: string[];
}): Format3Summary {
  const unlabeledPoints =
    options.unlabeledUserPoints + options.unlabeledPredictedPoints;
  const { instances, frames, bboxes } = options.metadataKeys;
  return {
    formatId: options.formatId,
    unlabeledPoints,
    unlabeledUserPoints: options.unlabeledUserPoints,
    unlabeledPredictedPoints: options.unlabeledPredictedPoints,
    metadataKeys: {
      instances: [...instances].sort(),
      frames: [...frames].sort(),
      bboxes: [...bboxes].sort(),
    },
    unknownColumns: [...options.unknownColumns].sort(),
    unreadTables: [...(options.unreadTables ?? [])].sort(),
    lossless:
      unlabeledPoints === 0 &&
      instances.length + frames.length + bboxes.length === 0 &&
      options.unknownColumns.length === 0 &&
      (options.unreadTables ?? []).length === 0,
  };
}

/**
 * Apply the caller's `format3` choice to a 3.0 file, once its summary is known
 * and before frames are built.
 *
 * @returns The labels' source format, to set on `labels.sourceFormat`.
 * @throws {SlpFormat3ChoiceError} When `choice` is not given (and the file
 *   asks, see {@link LOSSLESS_FORMAT3_ASKS}).
 */
export function chooseFormat3Access(
  labelsPath: string,
  summary: Format3Summary,
  choice: Format3Access | undefined,
): SlpSourceFormat {
  checkFormat3Option(choice);
  const access =
    choice ?? (summary.lossless && !LOSSLESS_FORMAT3_ASKS ? "edit" : undefined);
  if (access === undefined) {
    throw new SlpFormat3ChoiceError(labelsPath, summary);
  }
  // Shared by the labels and every record's mark, so frozen: the choice is
  // changed with setSourceAccess, never by mutating this object.
  return Object.freeze({
    formatId: summary.formatId,
    access,
    summary: freezeSummary(summary),
    labelsPath: safePath(labelsPath),
  });
}

/**
 * Refuse a `format3` option that is neither `"view"` nor `"edit"` (nor unset).
 *
 * @throws {TypeError}
 */
export function checkFormat3Option(choice: unknown): void {
  if (choice !== undefined && choice !== "view" && choice !== "edit") {
    throw new TypeError(
      `format3 must be "view" or "edit", got ${JSON.stringify(choice)}.`,
    );
  }
}

/** Whether a file's `format_id` is in the 3.x range this version reads. */
export function isFormat3(formatId: number): boolean {
  return formatId >= 3.0;
}

/**
 * The kind of a metadata `values` dataset from its HDF5 type, as h5wasm (and
 * the streaming worker) describe it in `dataset.metadata`, or `null` for a
 * dataset readers ignore (not 1-D, or not bool, integer, float or string).
 * h5py stores bool as an enum of int8 with the members FALSE and TRUE.
 */
export function metadataKindFromH5(
  meta:
    | {
        type?: number;
        shape?: number[] | null;
        enum_type?: { members?: Record<string, unknown> } | null;
      }
    | null
    | undefined,
): MetadataKind | null {
  if (!meta || !Array.isArray(meta.shape) || meta.shape.length !== 1) {
    return null;
  }
  switch (meta.type) {
    case 0:
      return "int";
    case 1:
      return "float";
    case 3:
      return "str";
    case 8: {
      // h5py's bool; any other enum has an integer base, which Python reads
      // as integers.
      const names = Object.keys(meta.enum_type?.members ?? {}).sort();
      return names.length === 2 && names[0] === "FALSE" && names[1] === "TRUE"
        ? "bool"
        : "int";
    }
    default:
      return null;
  }
}

/**
 * Check a table's metadata columns have one row per record, as Python sleap-io
 * does.
 *
 * @throws {SlpTableError} Naming the table and key.
 */
export function checkMetadataColumns(
  table: string,
  columns: MetadataColumns,
  rows: number,
  labelsPath: string,
): void {
  for (const [key, column] of Object.entries(columns)) {
    if (
      column.values.length !== rows ||
      (column.present !== null && column.present.length !== rows)
    ) {
      throw new SlpTableError(
        labelsPath,
        `has /${table}/metadata/${key} without one row per record (${rows}).`,
        3,
      );
    }
  }
}

/**
 * Turn one metadata member as read into a column, or `null` when readers
 * ignore it.
 */
export function metadataColumn(
  kind: MetadataKind | null,
  values: unknown,
  present: unknown,
): MetadataColumn | null {
  if (kind === null || values === null || values === undefined) return null;
  if (typeof values !== "object" || !("length" in (values as object))) {
    return null;
  }
  return {
    kind,
    values: values as ArrayLike<unknown>,
    present:
      present === null || present === undefined
        ? null
        : (present as ArrayLike<unknown>),
  };
}

export { metadataKeys };
