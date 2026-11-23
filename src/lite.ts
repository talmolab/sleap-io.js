/**
 * Lightweight SLP file reader using jsfive (pure JavaScript).
 *
 * This module provides Workers-compatible SLP file reading without WASM.
 * It can extract all metadata but cannot read pose coordinates (which
 * require compound dataset support).
 *
 * @example
 * ```typescript
 * import { loadSlpMetadata } from '@talmolab/sleap-io.js/lite';
 *
 * const response = await fetch('https://example.com/file.slp');
 * const buffer = await response.arrayBuffer();
 * const metadata = await loadSlpMetadata(buffer);
 *
 * console.log('Skeletons:', metadata.skeletons.map(s => s.name));
 * console.log('Frames:', metadata.counts.labeledFrames);
 * ```
 *
 * @packageDocumentation
 */

import {
  openJsfiveFile,
  getAttrs,
  getShape,
  getValue,
  isDataset,
  isGroup,
  type JsfiveDataset,
  type JsfiveGroup,
  type JsfiveSource,
} from "./codecs/slp/jsfive.js";
import {
  countUnlabeledPoints,
  METADATA_SUBGROUP,
  type PoseTableName,
  unknownColumns,
} from "./codecs/slp/columnar.js";
import {
  type ColumnTable,
  FORMAT3_TABLES,
  type Format3TableName,
  isKnownTableColumn,
  reportTableProblems,
  sessionProblems,
  TABLE_SPECS,
  tableFromColumns,
  unknownTableColumns,
  unknownTableGroups,
} from "./codecs/slp/columnar-tables.js";
import {
  buildFormat3Summary,
  type Format3Summary,
  PARTLY_READ_GROUPS,
  unreadMembers,
} from "./codecs/slp/format3.js";
import { checkSlpFormat } from "./codecs/slp/format-check.js";
import {
  CARRIED_TABLES,
  type DatasetInfo,
  METADATA_TABLES,
  unreadMetadataMembers,
  unreadTableMembers,
} from "./codecs/slp/carry-read.js";
import { streamingUnreadMembers } from "./codecs/slp/streaming-coverage.js";
import {
  parseJsonAttr,
  parseSkeletons,
  parseTracks,
  parseVideosMetadata,
  parseSuggestions,
  parseSessionsMetadata,
  type SessionData,
  type SessionPointMatrix,
} from "./codecs/slp/parsers.js";
import type {
  VideoMetadata,
  SuggestionMetadata,
  SessionMetadata,
} from "./codecs/slp/parsers.js";
import type { Skeleton } from "./model/skeleton.js";
import type { Track } from "./model/instance.js";

// Re-export types for consumer convenience
export type {
  VideoMetadata,
  SuggestionMetadata,
  SessionMetadata,
  CameraMetadata,
} from "./codecs/slp/parsers.js";
export type { JsfiveSource } from "./codecs/slp/jsfive.js";
export { Skeleton, Node, Edge, Symmetry } from "./model/skeleton.js";
export { Track } from "./model/instance.js";
export {
  SlpFormatError,
  SLP_FORMAT_ID_LIMIT,
  SLP_SUPPORTED_FEATURES,
} from "./codecs/slp/format-check.js";
export {
  SlpFormat3ChoiceError,
  SlpViewOnlyError,
  LOSSLESS_FORMAT3_ASKS,
} from "./codecs/slp/format3.js";
export { SlpTableError } from "./codecs/slp/format-check.js";
export type {
  Format3Access,
  Format3Option,
  MetadataKindsByTable,
  Format3Summary,
  SlpSourceFormat,
} from "./codecs/slp/format3.js";

/**
 * Metadata extracted from an SLP file without loading pose data.
 */
export interface SlpMetadata {
  /** SLEAP version that created this file (e.g., "1.3.4") */
  version: string;

  /** HDF5 format ID (e.g., 1.2) */
  formatId: number;

  /** Skeleton definitions with nodes, edges, and symmetries */
  skeletons: Skeleton[];

  /** Track definitions */
  tracks: Track[];

  /** Video metadata (without loaded backends) */
  videos: VideoMetadata[];

  /** Suggestion frame metadata */
  suggestions: SuggestionMetadata[];

  /** Multi-camera recording session metadata */
  sessions: SessionMetadata[];

  /** Dataset counts */
  counts: {
    /** Number of labeled frames */
    labeledFrames: number;
    /** Total number of instances (user + predicted) */
    instances: number;
    /** Number of user-labeled points */
    points: number;
    /** Number of predicted points */
    predictedPoints: number;
  };

  /** Whether any video has embedded image data */
  hasEmbeddedImages: boolean;

  /** Raw provenance data (SLEAP version, build info, etc.) */
  provenance?: Record<string, unknown>;

  /**
   * For a file in SLP format 3.0: what it holds that the 2.x layout cannot
   * store. The full readers throw `SlpFormat3ChoiceError` with this same
   * summary when given `format3: "ask"`, so an application can read it here
   * first and ask the user.
   * Absent for files before 3.0.
   */
  format3?: Format3Summary;

  /**
   * What the file holds that the streaming reader (`readSlpStreaming`) does
   * not read, as paths: ROI, mask and label image tables (in any layout), and
   * `identity/links`, `categories/links` or `embeddings` when they hold rows
   * of detections other than instances. jsfive cannot read compound
   * datasets, so the link tables of Python-written 2.x files are listed
   * whenever present, even when they link instances only (which the streaming
   * reader reads). Empty when that reader reads everything the others read.
   *
   * `format3` describes `readSlp`, `readSlpLazy` and `loadSlp`. A 3.0 file
   * read with `readSlpStreaming` also drops these on an edit (its own summary
   * lists them), and `loadSlp` reads such a 3.0 file with the in-memory
   * reader in its default mode. A file before 3.0 is streamed by `loadSlp` in
   * a browser, without these.
   */
  streamingUnreadTables: string[];
}

/** Whether `path` is a group, and so is each of its parents. */
function isGroupPath(
  file: ReturnType<typeof openJsfiveFile>,
  path: string,
): boolean {
  let prefix = "";
  for (const part of path.split("/")) {
    prefix = prefix ? `${prefix}/${part}` : part;
    if (!isGroup(file.get(prefix))) return false;
  }
  return true;
}

/** The member datasets of a group (none when `path` is not a group). */
function groupDatasets(
  file: ReturnType<typeof openJsfiveFile>,
  path: string,
): string[] {
  if (!isGroupPath(file, path)) return [];
  const node = file.get(path) as JsfiveGroup;
  return node.keys.filter((name) => isDataset(file.get(`${path}/${name}`)));
}

/**
 * Read one of the format 3.0 tables other than the pose tables when it is
 * stored as a group of columns, or `null` when it is not (see
 * `columnar-tables.ts`).
 */
function readColumnTableJsfive(
  file: ReturnType<typeof openJsfiveFile>,
  table: Format3TableName,
  labelsPath: string,
): ColumnTable | null {
  if (!isGroupPath(file, table)) return null;
  const columns: Record<string, ArrayLike<unknown>> = {};
  const unknownLengths: Record<string, number> = {};
  for (const name of groupDatasets(file, table)) {
    const dataset = file.get(`${table}/${name}`);
    if (!isKnownTableColumn(table, name)) {
      const shape = getShape(dataset);
      if (name !== TABLE_SPECS[table].buffer && shape.length) {
        unknownLengths[name] = shape[0];
      }
      continue;
    }
    const value = getValue(dataset);
    if (value && typeof value === "object" && "length" in value) {
      columns[name] = value as ArrayLike<unknown>;
    }
  }
  return tableFromColumns(table, columns, labelsPath, unknownLengths);
}

/**
 * One column of a table read with jsfive: a 3.0 column dataset, or a column
 * of a flat 2-D table with a `field_names` attribute (as sleap-io.js writes
 * 2.x tables). `null` when it cannot be read here (a compound dataset).
 */
function columnJsfive(
  file: ReturnType<typeof openJsfiveFile>,
  path: string,
  column: string,
): number[] | null {
  const node = file.get(path);
  if (isGroup(node)) {
    if (!node.keys.includes(column)) return [];
    const value = getValue(file.get(`${path}/${column}`));
    return value && typeof value === "object" && "length" in value
      ? Array.from(value as ArrayLike<unknown>, Number)
      : null;
  }
  const flat = getValue(node) as ArrayLike<unknown> | null;
  const shape = getShape(node);
  const raw = (getAttrs(node) as Record<string, unknown>)?.field_names;
  let fields: string[] = [];
  try {
    fields = typeof raw === "string" ? (JSON.parse(raw) as string[]) : [];
  } catch {
    fields = [];
  }
  const j = fields.indexOf(column);
  if (!flat || shape.length !== 2 || j < 0) return null;
  const [rows, cols] = shape;
  return Array.from({ length: rows }, (_, i) => Number(flat[i * cols + j]));
}

/** What the streaming reader would not read (see `streamingUnreadTables`). */
function streamingUnreadJsfive(
  file: ReturnType<typeof openJsfiveFile>,
): string[] {
  const owners: Record<string, number[] | null> = {};
  for (const group of ["identity", "categories"]) {
    const node = file.get(group);
    if (isGroup(node) && node.keys.includes("links")) {
      owners[`${group}/links`] = columnJsfive(
        file,
        `${group}/links`,
        "owner_type",
      );
    }
  }
  const embeddings = file.get("embeddings");
  if (isGroup(embeddings)) {
    const types: number[] = [];
    for (const column of ["owner_type", "category_owner_type"]) {
      if (!embeddings.keys.includes(column)) continue;
      types.push(...(columnJsfive(file, "embeddings", column) ?? [Number.NaN]));
    }
    owners.embeddings = types;
  }
  return streamingUnreadMembers({ root: file.keys, owners });
}

/** Whether a jsfive dtype is one a metadata `values` column may have. */
function isMetadataDtype(dtype: unknown): boolean {
  if (Array.isArray(dtype)) return dtype[0] === "VLEN_STRING";
  if (typeof dtype !== "string") return false;
  return /^[<>|=]?[biuf]\d+$/.test(dtype) || /^\|?S\d+$/.test(dtype);
}

/**
 * A jsfive dataset described as the HDF5 readers describe it (see
 * `DatasetInfo` in carry-read.ts), or `null` for a type this reader cannot
 * tell.
 */
function jsfiveInfo(node: Parameters<typeof isDataset>[0]): DatasetInfo | null {
  if (!isDataset(node)) return null;
  const shape = getShape(node);
  const dtype = (node as { dtype?: unknown }).dtype;
  if (Array.isArray(dtype)) {
    return dtype[0] === "VLEN_STRING" ? { type: 3, shape } : null;
  }
  if (typeof dtype !== "string") return null;
  if (/^\|?S\d+$/.test(dtype)) return { type: 3, shape };
  const m = /^[<>|=]?([biuf])(\d+)$/.exec(dtype);
  if (!m) return null;
  const size = Number(m[2]);
  switch (m[1]) {
    case "b":
      return { type: 8, size: 1, shape };
    case "f":
      return { type: 1, size, shape };
    default:
      return { type: 0, size, signed: m[1] === "i", shape };
  }
}

/**
 * The summary of a format 3.0 file (see `Format3Summary`), read with jsfive.
 * Reads only the `labeled` and `visible` columns of the point tables and the
 * names of the tables' members.
 */
function format3SummaryJsfive(
  file: ReturnType<typeof openJsfiveFile>,
  formatId: number,
  provenanceInMetadata: boolean,
): Format3Summary {
  const members = (path: string): string[] => {
    const node = file.get(path);
    return isGroup(node) ? node.keys : [];
  };
  const datasets = (path: string): string[] =>
    members(path).filter((name) => isDataset(file.get(`${path}/${name}`)));
  const column = (path: string): ArrayLike<number> | undefined => {
    const value = getValue(file.get(path));
    return value && typeof value === "object" && "length" in value
      ? (value as ArrayLike<number>)
      : undefined;
  };
  const unlabeled = (table: string): number =>
    isGroup(file.get(table))
      ? countUnlabeledPoints({
          labeled: column(`${table}/labeled`),
          visible: column(`${table}/visible`),
        })
      : 0;
  const keys = (table: string): string[] => {
    const base = `${table}/${METADATA_SUBGROUP}`;
    return members(base).filter((key) => {
      const values = file.get(`${base}/${key}/values`);
      return (
        isGroup(file.get(`${base}/${key}`)) &&
        isDataset(values) &&
        getShape(values).length === 1 &&
        isMetadataDtype(values.dtype)
      );
    });
  };
  const poseTables: PoseTableName[] = [
    "frames",
    "instances",
    "points",
    "pred_points",
  ];
  return buildFormat3Summary({
    formatId,
    unreadTables: [
      ...unreadMembers({
        root: file.keys,
        groups: Object.fromEntries(
          PARTLY_READ_GROUPS.filter((g) => isGroup(file.get(g))).map((g) => [
            g,
            members(g),
          ]),
        ),
        provenanceInMetadata,
      }),
      ...FORMAT3_TABLES.flatMap((table) =>
        isGroupPath(file, table)
          ? unknownTableGroups(
              table,
              members(table).filter((n) => isGroup(file.get(`${table}/${n}`))),
            )
          : [],
      ),
      // What a format 3.0 save would not write back (see carry-read.ts).
      ...CARRIED_TABLES.flatMap((table) =>
        isGroupPath(file, table)
          ? unreadTableMembers(
              table,
              members(table).map((name) => {
                const node = file.get(`${table}/${name}`);
                return isGroup(node)
                  ? { name, group: true }
                  : { name, group: false, info: jsfiveInfo(node) };
              }),
            )
          : [],
      ),
      ...METADATA_TABLES.flatMap((table) =>
        isGroupPath(file, `${table}/${METADATA_SUBGROUP}`)
          ? unreadMetadataMembers(
              table,
              members(`${table}/${METADATA_SUBGROUP}`),
              keys(table),
            )
          : [],
      ),
    ],
    unlabeledUserPoints: unlabeled("points"),
    unlabeledPredictedPoints: unlabeled("pred_points"),
    metadataKeys: {
      instances: keys("instances"),
      frames: keys("frames"),
      bboxes: keys("bboxes"),
    },
    unknownColumns: [
      ...poseTables.flatMap((table) => unknownColumns(table, datasets(table))),
      ...unknownColumns("bboxes", datasets("bboxes")),
      ...FORMAT3_TABLES.flatMap((table) =>
        unknownTableColumns(table, groupDatasets(file, table)),
      ),
    ],
  });
}

/**
 * Load SLP file metadata using jsfive (no WASM required).
 *
 * This is a lightweight alternative to `loadSlp()` for environments
 * that don't support WebAssembly compilation (e.g., Cloudflare Workers).
 *
 * Returns metadata only - does NOT include:
 * - Actual pose coordinates (requires compound dataset reading)
 * - Video frame data (requires VLEN sequence reading)
 * - Instance-frame relationships
 * - Instance scores
 *
 * @param source - ArrayBuffer or Uint8Array containing the SLP file
 * @param options - Optional configuration
 * @param options.filename - Filename hint for embedded video paths
 * @returns SlpMetadata object with skeletons, counts, video info
 * @throws Error if the file is not a valid SLP file
 *
 * @example
 * ```typescript
 * const buffer = await fetch('file.slp').then(r => r.arrayBuffer());
 * const metadata = await loadSlpMetadata(buffer);
 *
 * console.log(`${metadata.skeletons.length} skeleton(s)`);
 * console.log(`${metadata.counts.labeledFrames} labeled frames`);
 * console.log(`${metadata.counts.instances} instances`);
 * ```
 */
/**
 * Read the columnar `/session_data` group (SLP 2.8) via jsfive into a
 * backend-agnostic {@link SessionData} for {@link parseSessionsMetadata}, or `null`
 * when the group is absent (legacy ≤2.7). jsfive returns a 2-D dataset's value as a
 * flat plain array + a `shape`, and the `field_names` attribute as a JSON string, so
 * the struct tables are strided into column records here. Whole-reads only (jsfive
 * has no hyperslab slicing); the tables are small and `points_3d` is chunked+gzip.
 */
function readSessionDataJsfive(
  file: ReturnType<typeof openJsfiveFile>,
  labelsPath: string,
): SessionData | null {
  const grp = file.get("session_data");
  if (!grp || !isGroup(grp)) return null;
  // Format 3.0 stores the three tables as groups of columns (a missing one is
  // empty, as in Python sleap-io); before, as compound datasets.
  const columnar = (
    ["frame_groups", "instance_groups", "instance_group_members"] as const
  ).some((name) => isGroupPath(file, `session_data/${name}`));

  const struct = (
    name: "frame_groups" | "instance_groups" | "instance_group_members",
  ): Record<string, ArrayLike<unknown>> | null => {
    if (columnar) {
      const table = `session_data/${name}` as const;
      return (
        readColumnTableJsfive(file, table, labelsPath) ??
        tableFromColumns(
          table,
          Object.fromEntries(TABLE_SPECS[table].numbers.map((c) => [c, []])),
          labelsPath,
        )
      );
    }
    const ds = file.get(`session_data/${name}`);
    if (!ds || !isDataset(ds)) return null;
    const flat = getValue(ds) as ArrayLike<number> | null;
    const shape = getShape(ds);
    const fnRaw = (getAttrs(ds) as Record<string, unknown>)?.field_names;
    let fields: string[] = [];
    if (typeof fnRaw === "string") {
      try {
        fields = JSON.parse(fnRaw) as string[];
      } catch {
        /* not JSON */
      }
    } else if (Array.isArray(fnRaw)) {
      fields = (fnRaw as unknown[]).map(String);
    }
    if (!flat || shape.length < 2 || fields.length === 0) return null;
    const [nrows, ncols] = shape;
    const cols: Record<string, unknown[]> = {};
    fields.forEach((f, j) => {
      const col = new Array<number>(nrows);
      for (let i = 0; i < nrows; i++) col[i] = Number(flat[i * ncols + j]);
      cols[f] = col;
    });
    return cols;
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
    if (!ds || !isDataset(ds)) return null;
    const flat = getValue(ds) as ArrayLike<number> | null;
    if (!flat) return null;
    const shape = getShape(ds);
    return { flat, ncols: shape.length >= 2 ? shape[1] : ncolsDefault };
  };
  const meta = (name: string): unknown[] | null => {
    const ds = file.get(`session_data/${name}`);
    if (!ds || !isDataset(ds)) return null;
    const v = getValue(ds);
    if (Array.isArray(v)) return v;
    return v != null ? [v] : null;
  };

  const points3d = matrix("points_3d", 3);
  const predPoints3d = matrix("pred_points_3d", 4);
  if (columnar) {
    // Python sleap-io's range checks on 3.0 session tables, as the other
    // readers run them.
    const rows = (m: SessionPointMatrix | null) =>
      m && m.ncols > 0 ? Math.floor(m.flat.length / m.ncols) : 0;
    const frames = file.get("frames");
    reportTableProblems(
      labelsPath,
      sessionProblems({
        frameGroups: frameGroups as ColumnTable,
        instanceGroups: instanceGroups as ColumnTable,
        members: members as ColumnTable,
        nPoints3d: rows(points3d),
        nPredPoints3d: rows(predPoints3d),
        nIdentities: getShape(file.get("identity/name"))[0] ?? 0,
        nFrames: frames
          ? (getShape(
              isGroup(frames) ? file.get("frames/frame_idx") : frames,
            )[0] ?? 0)
          : null,
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

export async function loadSlpMetadata(
  source: JsfiveSource,
  options?: { filename?: string },
): Promise<SlpMetadata> {
  const file = openJsfiveFile(source, options?.filename);

  try {
    // Refuse formats this version can't read before anything else, so that a
    // newer layout gets the message that names its format and not a complaint
    // about a missing table or, worse, zero counts with no error (#278).
    checkSlpFormat(
      options?.filename ?? "slp-data.slp",
      file.keys.includes("metadata") ? getAttrs(file.get("metadata")) : null,
    );

    // Verify SLEAP structure
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    for (const key of requiredKeys) {
      if (!file.keys.includes(key)) {
        throw new Error(`Invalid SLP file: missing /${key}`);
      }
    }

    // Read metadata group attributes
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Invalid SLP file: missing /metadata group");
    }

    const metadataAttrs = getAttrs(metadataGroup);
    const formatId = Number(
      (metadataAttrs.format_id as { value?: unknown })?.value ??
        metadataAttrs.format_id ??
        1.0,
    );
    const metadataJson = parseJsonAttr(metadataAttrs.json) as Record<
      string,
      unknown
    > | null;

    if (!metadataJson) {
      throw new Error("Invalid SLP file: missing metadata.attrs.json");
    }

    // Parse skeletons using shared logic
    const skeletons = parseSkeletons(metadataJson);

    // Parse tracks from tracks_json dataset
    const tracksDataset = file.get("tracks_json");
    const tracksValue = getValue(tracksDataset);
    const tracks = Array.isArray(tracksValue) ? parseTracks(tracksValue) : [];

    // Parse video metadata from videos_json dataset
    const videosDataset = file.get("videos_json");
    const videosValue = getValue(videosDataset);
    const labelsPath = options?.filename ?? "slp-data.slp";
    let videos = Array.isArray(videosValue)
      ? parseVideosMetadata(videosValue, labelsPath)
      : [];

    // Enrich embedded videos with attributes from their datasets
    videos = videos.map((video) => {
      if (!video.embedded || !video.dataset) return video;

      // Try to get video dataset attributes
      const videoDs = file.get(video.dataset);
      if (!videoDs || !isDataset(videoDs)) return video;

      const attrs = getAttrs(videoDs);
      const enriched = { ...video };

      if (attrs.format !== undefined) enriched.format = String(attrs.format);
      if (attrs.width !== undefined) enriched.width = Number(attrs.width);
      if (attrs.height !== undefined) enriched.height = Number(attrs.height);
      if (attrs.channels !== undefined)
        enriched.channels = Number(attrs.channels);

      // Try to get frame count from shape
      const shape = getShape(videoDs);
      if (shape.length > 0) {
        enriched.frameCount = shape[0];
      }

      return enriched;
    });

    // Parse suggestions from suggestions_json dataset
    const suggestionsDataset = file.get("suggestions_json");
    const suggestionsValue = getValue(suggestionsDataset);
    const suggestions = Array.isArray(suggestionsValue)
      ? parseSuggestions(suggestionsValue)
      : [];

    // Parse sessions from sessions_json dataset, reconstructing full 3D from the
    // columnar /session_data group (SLP 2.8+) when present.
    const sessionsDataset = file.get("sessions_json");
    const sessionsValue = getValue(sessionsDataset);
    const sessions = Array.isArray(sessionsValue)
      ? parseSessionsMetadata(
          sessionsValue,
          readSessionDataJsfive(file, labelsPath),
          skeletons,
        )
      : [];

    // Get counts from dataset shapes (works without reading compound values)
    const framesDs = file.get("frames");
    const instancesDs = file.get("instances");
    const pointsDs = file.get("points");
    const predPointsDs = file.get("pred_points");

    // Format 3.0 stores each table as a group with one dataset per column, so
    // the row count is the length of one of its required columns.
    const rows = (
      table: JsfiveDataset | JsfiveGroup | null,
      columnPath: string,
    ): number =>
      getShape(isGroup(table) ? file.get(columnPath) : table)[0] ?? 0;
    const counts = {
      labeledFrames: rows(framesDs, "frames/frame_idx"),
      instances: rows(instancesDs, "instances/instance_type"),
      points: rows(pointsDs, "points/x"),
      predictedPoints: rows(predPointsDs, "pred_points/x"),
    };

    // Check for embedded images by looking at video metadata
    const hasEmbeddedImages = videos.some(
      (v) => v.embedded && (v.format || v.width),
    );

    return {
      version: (metadataJson.version as string) ?? "unknown",
      formatId,
      skeletons,
      tracks,
      videos,
      suggestions,
      sessions,
      counts,
      hasEmbeddedImages,
      provenance: metadataJson.provenance as
        | Record<string, unknown>
        | undefined,
      streamingUnreadTables: streamingUnreadJsfive(file),
      ...(formatId >= 3.0
        ? {
            format3: format3SummaryJsfive(
              file,
              formatId,
              "provenance" in metadataJson,
            ),
          }
        : {}),
    };
  } finally {
    file.close();
  }
}

/**
 * Validate that a buffer contains a valid SLP file.
 *
 * Performs quick structural validation without fully parsing the file.
 * Returns true if valid, throws an error with details if invalid.
 *
 * @param source - ArrayBuffer or Uint8Array containing the SLP file
 * @returns true if the file is a valid SLP file
 * @throws Error with details if the file is invalid
 * @throws SlpFormatError if the file is in a format this version cannot read
 *
 * @example
 * ```typescript
 * try {
 *   validateSlpBuffer(buffer);
 *   console.log('Valid SLP file');
 * } catch (e) {
 *   console.error('Invalid:', e.message);
 * }
 * ```
 */
export function validateSlpBuffer(source: JsfiveSource): boolean {
  const file = openJsfiveFile(source);

  try {
    // A file in a format this version can't read is not one the caller can
    // go on to load, so it does not validate (#278).
    checkSlpFormat(
      "slp-data.slp",
      file.keys.includes("metadata") ? getAttrs(file.get("metadata")) : null,
    );

    // Check for required SLEAP structure
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    const missingKeys = requiredKeys.filter((k) => !file.keys.includes(k));

    if (missingKeys.length > 0) {
      throw new Error(`Invalid SLP file: missing ${missingKeys.join(", ")}`);
    }

    // Verify metadata has required attributes
    const metadata = file.get("metadata");
    if (!metadata) {
      throw new Error("Invalid SLP file: cannot read metadata group");
    }

    const attrs = getAttrs(metadata);
    if (!attrs.json) {
      throw new Error("Invalid SLP file: missing metadata.attrs.json");
    }

    return true;
  } finally {
    file.close();
  }
}

/**
 * Check if a buffer looks like an HDF5 file.
 *
 * Performs a quick magic number check without fully parsing.
 * This is faster than validateSlpBuffer for initial filtering.
 *
 * @param source - ArrayBuffer or Uint8Array to check
 * @returns true if the buffer starts with the HDF5 magic number
 *
 * @example
 * ```typescript
 * if (isHdf5Buffer(buffer)) {
 *   // Might be an SLP file, do full validation
 *   const metadata = await loadSlpMetadata(buffer);
 * }
 * ```
 */
export function isHdf5Buffer(source: JsfiveSource): boolean {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < 8) return false;

  // HDF5 magic number: 0x89 0x48 0x44 0x46 0x0d 0x0a 0x1a 0x0a
  // or ASCII: \211HDF\r\n\032\n
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x48 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}
