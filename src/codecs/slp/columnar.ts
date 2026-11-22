/**
 * The pose tables of SLP format 3.0, read into the shape the 2.x readers use.
 *
 * Formats 1.x and 2.x store `/frames`, `/instances`, `/points` and
 * `/pred_points` as compound datasets. Format 3.0 (Python sleap-io 0.10) stores
 * each as a group with one 1-D dataset per column:
 *
 * - There are no id columns. The row number is the id, so `frame_id` and
 *   `instance_id` are filled in here.
 * - `/frames/video` is the index of the video in the videos list, not the id
 *   of its `videoN` group. The returned table is marked so that
 *   `buildVideoIdMap` leaves it alone.
 * - `/frames/is_negative` replaces the `/negative_frames` table.
 * - Points have `verified` in place of `complete`, and a `labeled` flag. A
 *   missing `labeled` column reads as all true.
 * - A `metadata/` subgroup may hold per-record metadata.
 *
 * Both HDF5 readers (h5wasm on the main thread, the streaming worker) gather
 * the raw columns and hand them to {@link poseTableFromColumns}, so the layout
 * rules live in one place. This module has no HDF5 dependency.
 */

/** The four pose tables. */
export type PoseTableName = "frames" | "instances" | "points" | "pred_points";

/** A table as the readers pass it around: column name → values, by row. */
// biome-ignore lint/suspicious/noExplicitAny: matches the 2.x readers' table type
export type PoseTable = Record<string, any>;

/**
 * Marks a frames table whose `video` column already holds indices into the
 * videos list (format 3.0). A symbol key stays out of `Object.keys`, so code
 * that walks the columns never sees it, while object spread still copies it.
 */
export const VIDEO_IS_INDEX: unique symbol = Symbol.for(
  "sleap-io.slp.videoIsIndex",
);

/** Columns a format 3.0 table must have; a file without one is refused. */
const REQUIRED_COLUMNS: Record<PoseTableName, readonly string[]> = {
  frames: ["video", "frame_idx", "instance_id_start", "instance_id_end"],
  instances: [
    "instance_type",
    "skeleton",
    "track",
    "point_id_start",
    "point_id_end",
  ],
  points: ["x", "y", "visible"],
  pred_points: ["x", "y", "visible"],
};

/** Columns this version understands, required ones included. */
const KNOWN_COLUMNS: Record<PoseTableName, readonly string[]> = {
  frames: [...REQUIRED_COLUMNS.frames, "is_negative"],
  instances: [
    ...REQUIRED_COLUMNS.instances,
    "frame_id",
    "from_predicted",
    "score",
    "tracking_score",
  ],
  points: [...REQUIRED_COLUMNS.points, "verified", "labeled"],
  pred_points: [
    ...REQUIRED_COLUMNS.pred_points,
    "verified",
    "labeled",
    "score",
  ],
};

/** The child of a column group that holds per-record metadata, not a column. */
export const METADATA_SUBGROUP = "metadata";

/** Whether `name` is a column this version of the reader understands. */
export function isKnownPoseColumn(table: PoseTableName, name: string): boolean {
  return KNOWN_COLUMNS[table].includes(name);
}

/**
 * A column as a `Float64Array`, the type the 2.x fast path already returns.
 * h5wasm hands 64-bit integers over as `BigInt64Array`, which the frame
 * builders can't do index arithmetic with, and booleans as `Int8Array`.
 */
function numberColumn(values: ArrayLike<unknown> | undefined): Float64Array {
  if (!values) return new Float64Array(0);
  if (values instanceof Float64Array) return values;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = Number(values[i]);
  return out;
}

/**
 * Turn the raw columns of one format 3.0 pose table into the table the frame
 * builders, the point-span check and the lazy store consume.
 *
 * @param table Which pose table the columns belong to.
 * @param columns Column name → values, as read from the group's datasets.
 * @param labelsPath Path or name of the file, for error messages.
 * @throws {Error} If a required column is missing or the columns differ in
 *   length; a short or missing column would otherwise shift or drop poses.
 */
export function poseTableFromColumns(
  table: PoseTableName,
  columns: Record<string, ArrayLike<unknown> | undefined>,
  labelsPath: string,
): PoseTable {
  const present = Object.keys(columns).filter((k) => columns[k] !== undefined);
  const missing = REQUIRED_COLUMNS[table].filter((c) => !present.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `The SLEAP labels file '${labelsPath}' has a /${table} table without ` +
        `the required column(s) ${missing.join(", ")}.`,
    );
  }

  const out: PoseTable = {};
  let rows = -1;
  for (const name of present) {
    const values = numberColumn(columns[name]);
    if (rows === -1) rows = values.length;
    if (values.length !== rows) {
      throw new Error(
        `The SLEAP labels file '${labelsPath}' has /${table} columns of ` +
          `different lengths (${name}: ${values.length}, expected ${rows}).`,
      );
    }
    out[name] = values;
  }
  rows = Math.max(rows, 0);
  const rowIds = () => Float64Array.from({ length: rows }, (_, i) => i);

  if (table === "frames") {
    out.frame_id = rowIds();
    (out as unknown as Record<symbol, boolean>)[VIDEO_IS_INDEX] = true;
  } else if (table === "instances") {
    out.instance_id = rowIds();
    out.from_predicted ??= new Float64Array(rows).fill(-1);
  } else {
    // `verified` is the 3.0 name of `complete`.
    out.complete = out.verified ?? new Float64Array(rows);
    out.labeled ??= new Float64Array(rows).fill(1);
  }
  return out;
}

/**
 * The negative frames of a format 3.0 frames table, as the `video:frame_idx`
 * keys that `negativeFrameKeys` returns for a 2.x `/negative_frames` table.
 */
export function negativeFrameKeysFromFrames(frames: PoseTable): Set<string> {
  const keys = new Set<string>();
  const flags = frames.is_negative ?? [];
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i]) keys.add(`${frames.video[i]}:${frames.frame_idx[i]}`);
  }
  return keys;
}

/**
 * Tables that format 3.0 stores in a new form which this version does not read
 * yet. A file that has one is refused by name: loading it would drop those
 * annotations without a word.
 */
export const UNREAD_FORMAT_3_TABLES = [
  "rois",
  "masks",
  "label_images",
  "identity/links",
  "categories/links",
  "session_data",
] as const;
