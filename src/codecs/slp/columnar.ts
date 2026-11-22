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
 * - Points have `verified` in place of `complete`, and a `labeled` flag,
 *   read as `labeled | visible` (a visible point is always labelled).
 * - Missing optional columns take the defaults of Python sleap-io's reading
 *   rules (see {@link poseTableFromColumns}).
 * - A `metadata/` subgroup may hold per-record metadata (read by the readers
 *   beside the columns, see `record-metadata.ts`).
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

/**
 * Marks a table read from the 3.0 layout (one dataset per column), so the
 * readers know to apply the 3.0 range checks (see {@link checkPoseTables}).
 */
export const COLUMNAR_TABLE: unique symbol = Symbol.for(
  "sleap-io.slp.columnarTable",
);

/**
 * Columns a format 3.0 table must have; a file without one is refused. As in
 * Python sleap-io, only these are required; the others take the defaults in
 * {@link OPTIONAL_COLUMNS}.
 */
const REQUIRED_COLUMNS: Record<PoseTableName, readonly string[]> = {
  frames: ["video", "frame_idx", "instance_id_start", "instance_id_end"],
  instances: [
    "instance_type",
    "frame_id",
    "skeleton",
    "point_id_start",
    "point_id_end",
  ],
  points: ["x", "y"],
  pred_points: ["x", "y"],
};

/** Optional columns and the value a missing one reads as, per Python sleap-io. */
const OPTIONAL_COLUMNS: Record<PoseTableName, Record<string, number>> = {
  frames: { is_negative: 0 },
  instances: {
    track: -1,
    from_predicted: -1,
    score: Number.NaN,
    tracking_score: Number.NaN,
  },
  points: { visible: 0, verified: 0, labeled: 1 },
  pred_points: { visible: 0, verified: 0, labeled: 1, score: Number.NaN },
};

/**
 * Columns this version understands. The id columns (`frame_id` of frames,
 * `instance_id` of instances) are known too: 3.0 does not write them, and if a
 * file has one, the row number wins, as in Python sleap-io.
 */
const KNOWN_COLUMNS: Record<PoseTableName, readonly string[]> = {
  frames: [
    ...REQUIRED_COLUMNS.frames,
    ...Object.keys(OPTIONAL_COLUMNS.frames),
    "frame_id",
  ],
  instances: [
    ...REQUIRED_COLUMNS.instances,
    ...Object.keys(OPTIONAL_COLUMNS.instances),
    "instance_id",
  ],
  points: [...REQUIRED_COLUMNS.points, ...Object.keys(OPTIONAL_COLUMNS.points)],
  pred_points: [
    ...REQUIRED_COLUMNS.pred_points,
    ...Object.keys(OPTIONAL_COLUMNS.pred_points),
  ],
};

/** The child of a column group that holds per-record metadata, not a column. */
export const METADATA_SUBGROUP = "metadata";

/** Whether `name` is a column this version of the reader understands. */
export function isKnownPoseColumn(table: PoseTableName, name: string): boolean {
  return KNOWN_COLUMNS[table].includes(name);
}

/**
 * The columns of `/bboxes` this version understands. Any other column is
 * unknown: it is not read, and a save drops it.
 */
export const KNOWN_BBOX_COLUMNS: readonly string[] = [
  "x1",
  "y1",
  "x2",
  "y2",
  "angle",
  "video",
  "frame_idx",
  "track",
  "instance",
  "is_predicted",
  "score",
  "tracking_score",
  "category",
  "name",
  "source",
];

/**
 * The members of a 3.0 table group that are columns this version does not
 * know, as paths like `points/foo`. `children` are the group's member names;
 * the `metadata` subgroup is not a column.
 */
export function unknownColumns(
  table: PoseTableName | "bboxes",
  children: readonly string[],
): string[] {
  const known = table === "bboxes" ? KNOWN_BBOX_COLUMNS : KNOWN_COLUMNS[table];
  return children
    .filter((name) => name !== METADATA_SUBGROUP && !known.includes(name))
    .map((name) => `${table}/${name}`);
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
 * Missing optional columns read as Python sleap-io reads them: points
 * `visible` and `verified` false, `labeled` true and `score` NaN; instances
 * `track` and `from_predicted` -1, `score` and `tracking_score` NaN; frames
 * `is_negative` false. `labeled` is stored as `labeled | visible`. Unknown
 * columns are kept in the table, which no consumer reads.
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

  for (const [name, value] of Object.entries(OPTIONAL_COLUMNS[table])) {
    out[name] ??= new Float64Array(rows).fill(value);
  }
  const marks = out as unknown as Record<symbol, boolean>;
  marks[COLUMNAR_TABLE] = true;
  if (table === "frames") {
    out.frame_id = rowIds();
    marks[VIDEO_IS_INDEX] = true;
  } else if (table === "instances") {
    out.instance_id = rowIds();
  } else {
    // `verified` is the 3.0 name of `complete`.
    out.complete = out.verified;
    // A visible point is always labelled.
    const labeled = out.labeled as Float64Array;
    const visible = out.visible as Float64Array;
    for (let i = 0; i < rows; i += 1) {
      if (visible[i]) labeled[i] = 1;
    }
  }
  return out;
}

/** Whether a pose table was read from the 3.0 layout. */
export function isColumnarTable(table: PoseTable | undefined): boolean {
  return !!table && !!(table as Record<symbol, unknown>)[COLUMNAR_TABLE];
}

/**
 * Number of unlabelled points (`labeled` and `visible` both false) in a point
 * table. Tables without a `labeled` column (1.x and 2.x) have none.
 */
export function countUnlabeledPoints(points: PoseTable | undefined): number {
  const labeled = points?.labeled as ArrayLike<number> | undefined;
  if (!labeled) return 0;
  const visible = (points?.visible ?? []) as ArrayLike<number>;
  let count = 0;
  for (let i = 0; i < labeled.length; i += 1) {
    if (!Number(labeled[i]) && !Number(visible[i])) count += 1;
  }
  return count;
}

/**
 * The range checks Python sleap-io runs over the 3.0 pose tables, in one
 * pass: the frames' instance ranges never decrease and end at the instance
 * count, each instance's `frame_id` is the frame whose range holds it, point
 * ranges fit inside their point table, `from_predicted` is an instance row or
 * -1, and `video` indexes a video. Empty tables are valid.
 *
 * Run only when `/frames` and `/instances` are both in the 3.0 layout (see
 * {@link isColumnarTable}); 2.x tables keep the lenient reading they always had.
 *
 * @param nPredPoints Rows of `/pred_points`, or `null` when that table was not
 *   read (the streaming reader's `userInstancesOnly`).
 * @throws {Error} Naming each table that fails a check.
 */
export function checkPoseTables(options: {
  frames: PoseTable;
  instances: PoseTable;
  nPoints: number;
  nPredPoints: number | null;
  nVideos: number;
  labelsPath: string;
}): void {
  const { frames, instances, nPoints, nPredPoints, nVideos } = options;
  const col = (t: PoseTable, name: string): ArrayLike<number> =>
    (t[name] ?? []) as ArrayLike<number>;
  const start = col(frames, "instance_id_start");
  const end = col(frames, "instance_id_end");
  const video = col(frames, "video");
  const nFrames = start.length;
  const nInstances = col(instances, "instance_type").length;
  const problems: string[] = [];

  let rangesOk = true;
  for (let i = 0; i < nFrames; i += 1) {
    if (end[i] < start[i] || start[i] < 0 || (i > 0 && start[i] < end[i - 1])) {
      rangesOk = false;
      break;
    }
  }
  if (!rangesOk) problems.push("/frames instance ranges decrease or overlap");
  const last = nFrames > 0 ? Number(end[nFrames - 1]) : 0;
  if (last !== nInstances) {
    problems.push(
      `/frames instance ranges end at ${last}, not at the instance count ` +
        `(${nInstances})`,
    );
  }
  if (rangesOk) {
    // The frame whose range holds each instance row, or -1.
    const owner = new Float64Array(nInstances).fill(-1);
    for (let f = 0; f < nFrames; f += 1) {
      for (let i = start[f]; i < end[f] && i < nInstances; i += 1) {
        owner[i] = f;
      }
    }
    const frameId = col(instances, "frame_id");
    for (let i = 0; i < nInstances; i += 1) {
      if (Number(frameId[i]) !== owner[i]) {
        problems.push("/instances frame_id disagrees with the /frames ranges");
        break;
      }
    }
  }
  const type = col(instances, "instance_type");
  const pStart = col(instances, "point_id_start");
  const pEnd = col(instances, "point_id_end");
  for (const [instanceType, n, table] of [
    [0, nPoints, "points"],
    [1, nPredPoints, "pred_points"],
  ] as const) {
    if (n === null) continue;
    for (let i = 0; i < nInstances; i += 1) {
      if (Number(type[i]) !== instanceType) continue;
      if (pStart[i] < 0 || pEnd[i] < pStart[i] || pEnd[i] > n) {
        problems.push(
          `/instances point ranges fall outside /${table} (${n} rows)`,
        );
        break;
      }
    }
  }
  const fromPredicted = col(instances, "from_predicted");
  for (let i = 0; i < fromPredicted.length; i += 1) {
    if (fromPredicted[i] < -1 || fromPredicted[i] >= nInstances) {
      problems.push("/instances from_predicted is not an instance row");
      break;
    }
  }
  for (let i = 0; i < video.length; i += 1) {
    if (video[i] < 0 || video[i] >= nVideos) {
      problems.push(`/frames video is not one of the ${nVideos} videos`);
      break;
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `The SLEAP labels file '${options.labelsPath}' has inconsistent pose ` +
        `tables: ${problems.join("; ")}.`,
    );
  }
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
