/**
 * The tables of SLP format 3.0 other than the pose tables, read into the shape
 * the 2.x readers use.
 *
 * Formats 1.x and 2.x store ROIs, masks, label images, the identity and
 * category links and the session tables as compound datasets (or, when
 * sleap-io.js wrote them, flat 2-D arrays with a `field_names` attribute), with
 * their strings and byte buffers in separate root datasets (`/roi_wkb`,
 * `/mask_names`, `/label_image_objects`, ...). Format 3.0 (Python sleap-io
 * 0.10) stores each as a group with one 1-D dataset per column, and keeps the
 * strings, the byte buffer and the sub-tables inside that group:
 *
 * | 3.0 table                             | 2.x twin                               |
 * |---------------------------------------|----------------------------------------|
 * | `/rois` (+ `wkb`, strings)            | `/rois`, `/roi_wkb`, `/roi_*`          |
 * | `/masks` (+ `rle`, strings)           | `/masks`, `/mask_rle`, `/mask_*`       |
 * | `/masks/score_maps` (+ `data`)        | `/mask_score_map_index`, `/mask_score_maps` |
 * | `/label_images` (+ `data`, `source`)  | `/label_images`, `/label_image_data`, `/label_image_sources` |
 * | `/label_images/objects`               | `/label_image_objects`, `/label_image_obj_*` |
 * | `/label_images/score_maps` (+ `data`) | `/label_image_score_map_index`, `/label_image_score_maps` |
 * | `/identity/links`                     | the same path, a compound dataset      |
 * | `/categories/links`                   | the same path, a compound dataset      |
 * | `/session_data/{frame_groups, instance_groups, instance_group_members}` | the same paths, compound datasets |
 *
 * Each reader decides the layout of each table by node type, as Python
 * sleap-io does: a group is read as columns (here), a dataset as before. The
 * 3.0 reading rules are Python's: missing optional columns take a default
 * ({@link TABLE_SPECS}), any numeric type is accepted, and the range checks
 * below raise {@link SlpTableError} naming the table. Tables before 3.0 keep
 * the lenient reading they always had.
 *
 * This module has no HDF5 dependency: the h5wasm, streaming and jsfive readers
 * gather the raw columns and hand them to {@link tableFromColumns}.
 */

import { COLUMNAR_TABLE, numberColumn, type PoseTable } from "./columnar.js";
import { SlpTableError } from "./format-check.js";

/** The tables format 3.0 stores as groups of columns, besides the pose tables. */
export const FORMAT3_TABLES = [
  "rois",
  "masks",
  "masks/score_maps",
  "label_images",
  "label_images/objects",
  "label_images/score_maps",
  "identity/links",
  "categories/links",
  "session_data/frame_groups",
  "session_data/instance_groups",
  "session_data/instance_group_members",
] as const;

/** One of {@link FORMAT3_TABLES}. */
export type Format3TableName = (typeof FORMAT3_TABLES)[number];

/** How one of {@link FORMAT3_TABLES} is stored in format 3.0. */
interface TableSpec {
  /** Numeric columns, in Python's raw record order. */
  numbers: readonly string[];
  /** String columns (variable-length UTF-8). */
  strings: readonly string[];
  /** Defaults of the optional columns; every other column is required. */
  defaults: Readonly<Record<string, number | string>>;
  /** The byte (or pixel) buffer member the rows index into, if any. */
  buffer?: string;
}

const SPATIAL = ["scale_x", "scale_y", "offset_x", "offset_y"] as const;
const SPATIAL_DEFAULTS = { scale_x: 1, scale_y: 1, offset_x: 0, offset_y: 0 };
const SCORE_MAP_COLUMNS = [
  "data_start",
  "data_end",
  "height",
  "width",
  ...SPATIAL,
] as const;

/**
 * The columns of each table and the defaults of its optional ones, as Python
 * sleap-io 0.10 reads them (`_TABLE_SPECS` in `sleap_io/io/slp.py`).
 */
export const TABLE_SPECS: Readonly<Record<Format3TableName, TableSpec>> = {
  rois: {
    numbers: [
      "annotation_type",
      "video",
      "frame_idx",
      "track",
      "instance",
      "is_predicted",
      "score",
      "tracking_score",
      "wkb_start",
      "wkb_end",
    ],
    strings: ["name", "category", "source"],
    defaults: {
      annotation_type: 0,
      instance: -1,
      is_predicted: 0,
      score: Number.NaN,
      tracking_score: Number.NaN,
      name: "",
      category: "",
      source: "",
    },
    buffer: "wkb",
  },
  masks: {
    numbers: [
      "height",
      "width",
      "annotation_type",
      "video",
      "frame_idx",
      "track",
      "instance",
      "from_predicted",
      "is_predicted",
      "score",
      "tracking_score",
      "rle_start",
      "rle_end",
      ...SPATIAL,
    ],
    strings: ["name", "category", "source"],
    defaults: {
      annotation_type: 2,
      instance: -1,
      from_predicted: -1,
      is_predicted: 0,
      score: Number.NaN,
      tracking_score: Number.NaN,
      ...SPATIAL_DEFAULTS,
      name: "",
      category: "",
      source: "",
    },
    buffer: "rle",
  },
  "masks/score_maps": {
    numbers: ["mask_idx", ...SCORE_MAP_COLUMNS],
    strings: [],
    defaults: SPATIAL_DEFAULTS,
    buffer: "data",
  },
  label_images: {
    numbers: [
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
      ...SPATIAL,
    ],
    strings: ["source"],
    defaults: {
      is_predicted: 0,
      score: Number.NaN,
      ...SPATIAL_DEFAULTS,
      source: "",
    },
    buffer: "data",
  },
  "label_images/objects": {
    numbers: ["label_id", "track", "instance", "score", "tracking_score"],
    strings: ["name", "category"],
    defaults: {
      score: Number.NaN,
      tracking_score: Number.NaN,
      name: "",
      category: "",
    },
  },
  "label_images/score_maps": {
    numbers: ["li_idx", ...SCORE_MAP_COLUMNS],
    strings: [],
    defaults: SPATIAL_DEFAULTS,
    buffer: "data",
  },
  "identity/links": {
    numbers: ["owner_type", "owner_id", "identity_idx", "identity_score"],
    strings: [],
    defaults: {},
  },
  "categories/links": {
    numbers: ["owner_type", "owner_id", "category_idx", "category_score"],
    strings: [],
    defaults: {},
  },
  "session_data/frame_groups": {
    numbers: ["frame_idx", "ig_start", "ig_end"],
    strings: [],
    defaults: {},
  },
  "session_data/instance_groups": {
    numbers: [
      "identity_idx",
      "score",
      "instance_3d_score",
      "pts3d_start",
      "pts3d_end",
      "pts3d_predicted",
      "member_start",
      "member_end",
    ],
    strings: [],
    defaults: {},
  },
  "session_data/instance_group_members": {
    numbers: ["camera", "lf", "inst"],
    strings: [],
    defaults: {},
  },
};

/** Whether `name` is a column of `table` this version reads. */
export function isKnownTableColumn(
  table: Format3TableName,
  name: string,
): boolean {
  const spec = TABLE_SPECS[table];
  return spec.numbers.includes(name) || spec.strings.includes(name);
}

/** Whether `name` is a string column of `table`. */
export function isStringTableColumn(
  table: Format3TableName,
  name: string,
): boolean {
  return TABLE_SPECS[table].strings.includes(name);
}

/**
 * The datasets of a 3.0 table group that this version does not know, as paths
 * like `rois/foo`. `datasets` are the names of the group's member datasets;
 * the byte buffer is not a column, and sub-tables (groups) are not listed.
 */
export function unknownTableColumns(
  table: Format3TableName,
  datasets: readonly string[],
): string[] {
  const buffer = TABLE_SPECS[table].buffer;
  return datasets
    .filter((name) => name !== buffer && !isKnownTableColumn(table, name))
    .map((name) => `${table}/${name}`);
}

/** The sub-tables (groups) of each table that this version reads. */
const KNOWN_SUBTABLES: Readonly<Partial<Record<Format3TableName, string[]>>> = {
  masks: ["score_maps"],
  label_images: ["objects", "score_maps"],
};

/**
 * The groups inside a 3.0 table group that this version does not read (for
 * example a sub-table added by a newer writer), as paths like `masks/foo`.
 * `groups` are the names of the table's member groups.
 */
export function unknownTableGroups(
  table: Format3TableName,
  groups: readonly string[],
): string[] {
  const known = KNOWN_SUBTABLES[table] ?? [];
  return groups
    .filter((name) => !known.includes(name))
    .map((name) => `${table}/${name}`);
}

/**
 * A table as the readers pass it around: numeric columns as `Float64Array`,
 * string columns as `string[]`, by row, marked as read from the 3.0 layout.
 */
export type ColumnTable = PoseTable;

/** Decode one string value as h5wasm, the worker or jsfive hand it over. */
function decodeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Turn the raw columns of one of {@link FORMAT3_TABLES} into the columns the
 * 2.x readers consume. Missing optional columns read as Python sleap-io reads
 * them ({@link TABLE_SPECS}); numbers of any type become `Float64Array`s.
 *
 * @param table Which table the columns belong to.
 * @param columns Column name → values, as read from the group's datasets.
 *   Readers pass the known columns only (see {@link isKnownTableColumn}).
 * @param labelsPath Path or name of the file, for error messages.
 * @param unknownLengths The length (first dimension) of each column this
 *   version does not read, which must match too.
 * @throws {SlpTableError} If a required column is missing or the columns
 *   differ in length.
 */
export function tableFromColumns(
  table: Format3TableName,
  columns: Record<string, ArrayLike<unknown> | undefined>,
  labelsPath: string,
  unknownLengths: Readonly<Record<string, number>> = {},
): ColumnTable {
  const spec = TABLE_SPECS[table];
  const present = Object.keys(columns).filter((k) => columns[k] !== undefined);
  const missing = [...spec.numbers, ...spec.strings].filter(
    (c) => !(c in spec.defaults) && !present.includes(c),
  );
  if (missing.length > 0) {
    throw new SlpTableError(
      labelsPath,
      `has a /${table} table without the required column(s) ` +
        `${missing.join(", ")}.`,
      3,
    );
  }
  const out: ColumnTable = {};
  let rows = -1;
  let first = "";
  for (const name of present) {
    const raw = columns[name] as ArrayLike<unknown>;
    const values = spec.strings.includes(name)
      ? Array.from(raw, decodeString)
      : numberColumn(raw);
    if (rows === -1) {
      rows = values.length;
      first = name;
    }
    if (values.length !== rows) {
      throw new SlpTableError(
        labelsPath,
        `has /${table} columns of different lengths (${first}: ${rows} ` +
          `values, ${name}: ${values.length}).`,
        3,
      );
    }
    out[name] = values;
  }
  // Columns this version does not read must have the same length too, as
  // Python sleap-io checks every column of a table.
  for (const [name, length] of Object.entries(unknownLengths)) {
    if (rows !== -1 && length !== rows) {
      throw new SlpTableError(
        labelsPath,
        `has /${table} columns of different lengths (${first}: ${rows} ` +
          `values, ${name}: ${length}).`,
        3,
      );
    }
  }
  rows = Math.max(rows, 0);
  for (const [name, value] of Object.entries(spec.defaults)) {
    if (out[name] !== undefined) continue;
    out[name] =
      typeof value === "string"
        ? new Array<string>(rows).fill(value)
        : new Float64Array(rows).fill(value);
  }
  (out as unknown as Record<symbol, boolean>)[COLUMNAR_TABLE] = true;
  return out;
}

/** Rows of a table read by {@link tableFromColumns}. */
export function tableRows(table: ColumnTable | null | undefined): number {
  if (!table) return 0;
  for (const column of Object.values(table)) {
    if (column && typeof column.length === "number") return column.length;
  }
  return 0;
}

// ---- Range checks (Python sleap-io's, raised for 3.0 tables) ---------------

type Col = ArrayLike<number>;
const col = (table: ColumnTable, name: string): Col =>
  (table[name] ?? []) as Col;

/** Whether any `[start, end)` range isn't a range inside `[0, n)`. */
function spanOutOfRange(start: Col, end: Col, n: number): boolean {
  for (let i = 0; i < start.length; i += 1) {
    if (start[i] < 0 || end[i] < start[i] || end[i] > n) return true;
  }
  return false;
}

/** Whether any index isn't a row of a table of `n` rows (or -1 if optional). */
function indexOutOfRange(values: Col, n: number, optional = true): boolean {
  const lowest = optional ? -1 : 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] < lowest || values[i] >= n) return true;
  }
  return false;
}

/** What the checks of an annotation table compare its links against. */
export interface TableCounts {
  /** Videos in the file. */
  nVideos: number;
  /** Tracks in the file. */
  nTracks: number;
  /** Rows of `/instances`. */
  nInstances: number;
}

/** Links of an annotation table to videos, tracks and instances. */
function annotationProblems(
  table: string,
  rows: ColumnTable,
  counts: TableCounts,
  withVideo: boolean,
): string[] {
  const problems: string[] = [];
  const targets: Array<[string, number, string]> = [
    ["track", counts.nTracks, "tracks"],
    ["instance", counts.nInstances, "instances"],
  ];
  if (withVideo) targets.unshift(["video", counts.nVideos, "videos"]);
  for (const [column, n, what] of targets) {
    if (indexOutOfRange(col(rows, column), n)) {
      problems.push(`/${table} ${column} is not one of the ${n} ${what}`);
    }
  }
  return problems;
}

/** Raise the problems found in 3.0 tables, if any. */
export function reportTableProblems(
  labelsPath: string,
  problems: readonly string[],
): void {
  if (problems.length === 0) return;
  throw new SlpTableError(
    labelsPath,
    `has inconsistent tables: ${problems.join("; ")}.`,
    3,
  );
}

/**
 * Check a 3.0 `/rois` table: links to videos, tracks and instances, and
 * geometry ranges inside the `wkb` buffer of `nBytes` bytes.
 */
export function roiProblems(
  rows: ColumnTable,
  nBytes: number,
  counts: TableCounts,
): string[] {
  const problems = annotationProblems("rois", rows, counts, true);
  if (spanOutOfRange(col(rows, "wkb_start"), col(rows, "wkb_end"), nBytes)) {
    problems.push(`/rois wkb ranges fall outside the buffer (${nBytes})`);
  }
  return problems;
}

/**
 * Check a 3.0 `/masks` table: links to videos, tracks and instances,
 * `from_predicted` naming a mask row, and RLE ranges inside the `rle` buffer
 * of `nBytes` bytes.
 */
export function maskProblems(
  rows: ColumnTable,
  nBytes: number,
  counts: TableCounts,
): string[] {
  const problems = annotationProblems("masks", rows, counts, true);
  if (indexOutOfRange(col(rows, "from_predicted"), tableRows(rows))) {
    problems.push("/masks from_predicted is not a mask row");
  }
  if (spanOutOfRange(col(rows, "rle_start"), col(rows, "rle_end"), nBytes)) {
    problems.push(`/masks rle ranges fall outside the buffer (${nBytes})`);
  }
  return problems;
}

/**
 * Check a 3.0 score map index: each row names a row of the owning table
 * (`nOwners` rows) and a range inside its `data` buffer of `nBytes` bytes.
 */
export function scoreMapProblems(
  table: "masks/score_maps" | "label_images/score_maps",
  rows: ColumnTable,
  nOwners: number,
  nBytes: number,
): string[] {
  const index = table === "masks/score_maps" ? "mask_idx" : "li_idx";
  const owner = table === "masks/score_maps" ? "masks" : "label_images";
  const problems: string[] = [];
  if (indexOutOfRange(col(rows, index), nOwners, false)) {
    problems.push(`/${table} ${index} is not one of the ${nOwners} /${owner}`);
  }
  if (spanOutOfRange(col(rows, "data_start"), col(rows, "data_end"), nBytes)) {
    problems.push(`/${table} ranges fall outside the buffer (${nBytes})`);
  }
  return problems;
}

/**
 * Check 3.0 label image tables: video links, object ranges inside
 * `objects/`, pixel data for every row (`data` is the pixel dataset's shape,
 * `null` when there is none), and the objects' links to tracks and instances.
 */
export function labelImageProblems(
  rows: ColumnTable,
  objects: ColumnTable,
  data: readonly number[] | null,
  counts: TableCounts,
): string[] {
  const problems: string[] = [];
  if (indexOutOfRange(col(rows, "video"), counts.nVideos)) {
    problems.push(
      `/label_images video is not one of the ${counts.nVideos} videos`,
    );
  }
  const start = col(rows, "objects_start");
  const count = col(rows, "n_objects");
  const nObjects = tableRows(objects);
  for (let i = 0; i < start.length; i += 1) {
    const end = start[i] + count[i];
    if (start[i] < 0 || end < start[i] || end > nObjects) {
      problems.push(
        "/label_images object ranges fall outside /label_images/objects " +
          `(${nObjects} rows)`,
      );
      break;
    }
  }
  const n = tableRows(rows);
  if (data === null) {
    problems.push("/label_images has no pixel data");
  } else if (data.length === 3) {
    if (data[0] < n) {
      problems.push(
        `/label_images has ${n} rows but ${data[0]} frames of data`,
      );
    }
  } else if (
    spanOutOfRange(col(rows, "data_start"), col(rows, "data_end"), data[0] ?? 0)
  ) {
    problems.push(
      `/label_images data ranges fall outside the buffer (${data[0] ?? 0})`,
    );
  }
  return [
    ...problems,
    ...annotationProblems("label_images/objects", objects, counts, false),
  ];
}

/**
 * Check a 3.0 links table: each row names an entry of the catalog of
 * `nCatalog` names (`null` when the file has no catalog, which is not
 * checked).
 */
export function linkProblems(
  table: "identity/links" | "categories/links",
  rows: ColumnTable,
  nCatalog: number | null,
): string[] {
  const index = table === "identity/links" ? "identity_idx" : "category_idx";
  if (
    nCatalog === null ||
    !indexOutOfRange(col(rows, index), nCatalog, false)
  ) {
    return [];
  }
  return [`/${table} ${index} is not one of the ${nCatalog} catalog entries`];
}

/**
 * Check the 3.0 `/session_data` tables: frame group ranges inside
 * `instance_groups`, member ranges inside `instance_group_members`, 3D ranges
 * inside `points_3d` or `pred_points_3d`, `identity_idx` -1 or an identity,
 * `lf` a `/frames` row (unless `nFrames` is `null`: no frame table), and
 * `camera` and `inst` not negative.
 */
export function sessionProblems(options: {
  frameGroups: ColumnTable;
  instanceGroups: ColumnTable;
  members: ColumnTable;
  nPoints3d: number;
  nPredPoints3d: number;
  nIdentities: number;
  nFrames: number | null;
}): string[] {
  const { frameGroups, instanceGroups: groups, members } = options;
  const problems: string[] = [];
  const nGroups = tableRows(groups);
  const nMembers = tableRows(members);
  if (
    spanOutOfRange(
      col(frameGroups, "ig_start"),
      col(frameGroups, "ig_end"),
      nGroups,
    )
  ) {
    problems.push(
      "/session_data/frame_groups ranges fall outside instance_groups " +
        `(${nGroups} rows)`,
    );
  }
  if (
    spanOutOfRange(
      col(groups, "member_start"),
      col(groups, "member_end"),
      nMembers,
    )
  ) {
    problems.push(
      "/session_data/instance_groups ranges fall outside " +
        `instance_group_members (${nMembers} rows)`,
    );
  }
  const start = col(groups, "pts3d_start");
  const end = col(groups, "pts3d_end");
  const predicted = col(groups, "pts3d_predicted");
  for (const [isPredicted, name, n] of [
    [false, "points_3d", options.nPoints3d],
    [true, "pred_points_3d", options.nPredPoints3d],
  ] as const) {
    for (let i = 0; i < start.length; i += 1) {
      if (start[i] < 0 || !!predicted[i] !== isPredicted) continue;
      if (end[i] < start[i] || end[i] > n) {
        problems.push(
          `/session_data/instance_groups 3D ranges fall outside ${name} ` +
            `(${n} rows)`,
        );
        break;
      }
    }
  }
  if (indexOutOfRange(col(groups, "identity_idx"), options.nIdentities)) {
    problems.push(
      "/session_data/instance_groups identity_idx is not one of the " +
        `${options.nIdentities} identities`,
    );
  }
  if (
    options.nFrames !== null &&
    indexOutOfRange(col(members, "lf"), options.nFrames, false)
  ) {
    problems.push(
      "/session_data/instance_group_members lf is not one of the " +
        `${options.nFrames} frames`,
    );
  }
  const camera = col(members, "camera");
  const inst = col(members, "inst");
  for (let i = 0; i < camera.length; i += 1) {
    if (camera[i] < 0 || inst[i] < 0) {
      problems.push(
        "/session_data/instance_group_members has negative indices",
      );
      break;
    }
  }
  return problems;
}
