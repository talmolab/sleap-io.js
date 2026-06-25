/**
 * DeepLabCut (DLC) format I/O (read path).
 *
 * TypeScript port of `sleap_io/io/dlc.py` (READ path only), adapted to the
 * JS/Node data model and runtime.
 *
 * In addition to reading a single DLC annotation CSV ({@link loadDlc}), this
 * module can import an entire DLC *project* from its `config.yaml`
 * ({@link loadDlcProject}) and recover the train/test splits stored by
 * `create_training_dataset` ({@link loadDlcSplits}).
 *
 * ## Format overview
 *
 * - **Single-animal (SADLC)** CSV: 3 header rows (`scorer` / `bodyparts` /
 *   `coords`) followed by one row per labeled image; each bodypart contributes
 *   an `x` and a `y` column.
 * - **Multi-animal (maDLC / MAUDLC)** CSV: 4 header rows (a leading `scorer`
 *   row, then `individuals` / `bodyparts` / `coords`); the `individuals` level
 *   names the animal each column belongs to. MAUDLC adds a `single` individual
 *   carrying unique (single-animal) bodyparts.
 * - Image paths appear either as a single column
 *   (`labeled-data/video/img000.png`) or split across three index columns
 *   (`labeled-data`, `video`, `img000.png`); the latter is joined with `/`.
 * - A project `config.yaml` supplies skeleton edges (the `skeleton:` list),
 *   the `scorer`/`Task`/`date`, and `video_sets` (source-video links + crops).
 *
 * When a config is available, the returned `Labels` gains skeleton edges and
 * per-video `Video.sourceVideo` links that link each `labeled-data/<video>/`
 * image folder back to its original video file (matched by filename stem).
 * DLC's `video_sets[...].crop` is a virtual read-time crop; its rect (DLC's
 * width-range-first `x1, x2, y1, y2` reordered to the sleap rect
 * `(x1, y1, x2, y2)`) is recorded under `provenance["dlc_crops"]`, keyed by
 * source-video path. No offset is ever applied to point coordinates.
 *
 * ## Node-only
 *
 * DLC datasets are directory trees of many files (a project dir, per-image
 * folders), so this module reads through the Node `fs`/`path` APIs (like
 * `io/ultralytics.ts` / `io/jabs.ts` / `io/trackmate.ts`) and is exported only
 * from the Node entry point (`src/index.ts`), never the browser bundle.
 *
 * ## Divergences from Python `dlc.py`
 *
 * 1. **No crop view.** The JS `Video` has no `from_crop` / `is_cropped` /
 *    `crop_rect` / `to_source_coords`. Python links a `Video.from_crop` view
 *    when a non-identity crop's source video exists on disk; JS cannot, so
 *    `sourceVideo` is **always** a closed `Video` ({@link Video} with
 *    `openBackend: false`) and the crop lives only in
 *    `provenance["dlc_crops"]`. Point coordinates are unaffected either way.
 * 2. **Errors.** Python's `ValueError` / `FileNotFoundError` distinction
 *    collapses to a single `Error` with the same message text.
 * 3. **Warnings** are emitted via `console.warn` (vs Python `warnings.warn`);
 *    message text is preserved so callers / tests can match on substrings.
 * 4. **No `addEdges`.** Edges are added one pair at a time via
 *    `Skeleton.addEdge`, after validating both endpoints exist.
 * 5. **Pickle decoding.** `loadDlcSplits` requires reading a Python pickle
 *    (the DLC `Documentation_data-*.pickle`); a minimal protocol 2-5 opcode
 *    interpreter is implemented here ({@link readPickle}) since the repo has no
 *    pickle dependency. `loadDlc` / `loadDlcProject` have no pickle dependency.
 * 6. **`**kwargs` ignored.** Python's forwarded loader kwargs (PR #488/#492) are
 *    modeled as an index signature on the options objects and ignored.
 */

import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";

import { Labels } from "../model/labels.js";
import { LabelsSet } from "../model/labels-set.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { Instance, Track } from "../model/instance.js";
import { Skeleton, Node } from "../model/skeleton.js";
import { Video } from "../model/video.js";

/** Emit a warning. Centralized so messages can later be routed. */
function warn(msg: string): void {
  console.warn(msg);
}

// -----------------------------------------------------------------------------
// File / project detection
// -----------------------------------------------------------------------------

/**
 * Check if a file appears to be a DLC annotation CSV.
 *
 * Reads the first four lines as raw text and looks for DLC's characteristic
 * header tokens. Any read error (missing/empty file) yields `false`.
 */
export function isDlcFile(filename: string): boolean {
  try {
    const lines = fs
      .readFileSync(filename, "utf-8")
      .split(/\r?\n/)
      .slice(0, 4)
      .map((l) => l.trim());
    const content = lines.join("\n").toLowerCase();
    const hasScorer = content.includes("scorer");
    const hasCoords = content.includes("coords");
    const hasXy = content.includes("x") && content.includes("y");
    const hasBodyparts =
      content.includes("bodyparts") ||
      content.includes("animal") ||
      content.includes("individual");
    return hasScorer && hasCoords && hasXy && hasBodyparts;
  } catch {
    return false;
  }
}

/** Keys that identify a mapping as a DLC project `config.yaml`. */
const DLC_CONFIG_KEYS = [
  "video_sets",
  "bodyparts",
  "scorer",
  "Task",
  "skeleton",
  "individuals",
] as const;

/**
 * Return whether a path refers to a DLC project (directory containing both
 * `config.yaml` and `labeled-data/`, or a `config.yaml` file validating as a
 * DLC project config).
 */
export function isDlcProjectPath(filename: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filename);
  } catch {
    return false;
  }
  if (stat.isDirectory()) {
    return (
      fs.existsSync(path.join(filename, "config.yaml")) &&
      fs.existsSync(path.join(filename, "labeled-data"))
    );
  }
  if (path.basename(filename) === "config.yaml" && stat.isFile()) {
    const cfg = readDlcConfig(filename);
    return cfg !== null && looksLikeDlcConfig(cfg);
  }
  return false;
}

// -----------------------------------------------------------------------------
// Config parsing and discovery
// -----------------------------------------------------------------------------

type Config = Record<string, unknown>;

/**
 * Read a DLC project `config.yaml` into a dictionary, or `null` if the file is
 * missing or does not parse to a mapping. A warning is emitted on failure so a
 * malformed/foreign config never breaks plain CSV loading.
 */
export function readDlcConfig(p: string): Config | null {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    warn(`DLC config file not found: ${p}`);
    return null;
  }
  let cfg: unknown;
  try {
    cfg = YAML.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    warn(`Failed to parse DLC config ${p}: ${e}`);
    return null;
  }
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
    warn(`DLC config ${p} did not parse to a mapping.`);
    return null;
  }
  return cfg as Config;
}

/** Return whether a parsed mapping looks like a DLC project config (>=2 keys). */
export function looksLikeDlcConfig(cfg: unknown): boolean {
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
    return false;
  }
  const obj = cfg as Config;
  return DLC_CONFIG_KEYS.filter((k) => Object.hasOwn(obj, k)).length >= 2;
}

/**
 * Search upward from a CSV for a DLC project `config.yaml` (up to `maxLevels`
 * parent directories). Returns the path to a validated config, or `null`.
 */
export function discoverConfig(csvPath: string, maxLevels = 3): string | null {
  const start = path.dirname(path.resolve(csvPath));
  const dirs: string[] = [start];
  let cur = start;
  for (let i = 0; i < maxLevels; i += 1) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    dirs.push(parent);
    cur = parent;
  }
  for (const d of dirs) {
    const candidate = path.join(d, "config.yaml");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const cfg = readDlcConfig(candidate);
      if (cfg !== null && looksLikeDlcConfig(cfg)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve the `config` argument of {@link loadDlc} to a parsed config dict.
 *
 * - `false` disables config entirely (strict legacy output).
 * - `null`/`undefined` auto-discovers `config.yaml` by walking up from the CSV.
 * - a string forces a specific config path.
 */
export function resolveConfig(
  csvPath: string,
  config: string | false | null,
): Config | null {
  if (config === false) return null;
  if (config == null) {
    const discovered = discoverConfig(csvPath);
    return discovered !== null ? readDlcConfig(discovered) : null;
  }
  return readDlcConfig(config);
}

/**
 * Attach skeleton edges (and name) from a DLC config to a `Skeleton` in place.
 * Edges referencing bodyparts not present in the skeleton are dropped with a
 * warning. Resolution is strictly name-based.
 */
export function attachConfigSkeleton(skeleton: Skeleton, cfg: Config): void {
  const task = cfg.Task;
  if (task && skeleton.name == null) {
    skeleton.name = String(task);
  }

  const rawEdges = (cfg.skeleton as unknown[]) ?? [];
  const nodeNames = new Set(skeleton.nodeNames);
  const valid: Array<[string, string]> = [];
  const dropped: unknown[] = [];
  for (const entry of rawEdges) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      dropped.push(entry);
      continue;
    }
    const src = String(entry[0]);
    const dst = String(entry[1]);
    if (nodeNames.has(src) && nodeNames.has(dst)) {
      valid.push([src, dst]);
    } else {
      dropped.push([src, dst]);
    }
  }

  for (const [src, dst] of valid) {
    skeleton.addEdge(src, dst);
  }
  if (dropped.length) {
    warn(
      `Dropped ${dropped.length} DLC skeleton edge(s) referencing bodyparts ` +
        `not present in the labeled data: ${JSON.stringify(dropped)}`,
    );
  }
}

/**
 * Parse a DLC `video_sets[...].crop` value into a sleap crop rect.
 *
 * DLC stores the crop width-range-first as `x1, x2, y1, y2` (string or list);
 * this is reordered to `(x1, y1, x2, y2)` with x2/y2 exclusive, 0-indexed.
 * Returns `null` when missing/empty/unparsable, wrong arity, inverted (warns),
 * or an identity crop at origin `(0, 0)`.
 */
export function parseDlcCrop(
  crop: unknown,
): [number, number, number, number] | null {
  if (crop == null) return null;

  let parts: unknown[];
  if (typeof crop === "string") {
    parts = crop
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  } else if (Array.isArray(crop)) {
    parts = [...crop];
  } else {
    return null;
  }

  if (parts.length !== 4) return null;

  const nums = parts.map((p) => Math.trunc(parseFloat(String(p))));
  if (nums.some((n) => Number.isNaN(n))) return null;
  const [x1, x2, y1, y2] = nums as [number, number, number, number];

  if (x2 <= x1 || y2 <= y1) {
    warn(
      `Ignoring inverted DLC crop ${JSON.stringify(crop)}: expected x1 < x2 ` +
        "and y1 < y2 (width-range-first 'x1, x2, y1, y2').",
    );
    return null;
  }

  // Identity crop at origin (0, 0) is a no-op (DLC's default full-frame crop).
  if (x1 === 0 && y1 === 0) return null;

  return [x1, y1, x2, y2];
}

type StemEntry = {
  original: string;
  rect: [number, number, number, number] | null;
};

/**
 * Map video filename stems to original paths and crop rects from config.
 * Windows backslash separators are normalized; placeholder entries are skipped.
 * Preserves config (object key) order.
 */
export function videoSetsStemMap(cfg: Config): Map<string, StemEntry> {
  const out = new Map<string, StemEntry>();
  const videoSets = (cfg.video_sets as Record<string, unknown>) ?? {};
  for (const [key, value] of Object.entries(videoSets)) {
    const keyStr = String(key);
    if (keyStr.includes("WILL BE AUTOMATICALLY UPDATED")) continue;
    const name = keyStr.replace(/\\/g, "/").split("/").pop() ?? "";
    const stem = name.includes(".")
      ? name.slice(0, name.lastIndexOf("."))
      : name;
    if (stem) {
      const crop =
        value && typeof value === "object"
          ? (value as Record<string, unknown>).crop
          : null;
      out.set(stem, { original: keyStr, rect: parseDlcCrop(crop) });
    }
  }
  return out;
}

/**
 * Link an image-folder `Video` back to its original source video. Returns
 * `{ path, rect }` for the linked source, or `null` on a stem mismatch.
 *
 * JS divergence: `video.sourceVideo` is always a closed `Video`
 * (`openBackend: false`); there is no crop view (see module banner).
 */
export function setSourceVideo(
  video: Video,
  folderName: string,
  stemMap: Map<string, StemEntry>,
  searchPaths?: string[],
): { path: string; rect: [number, number, number, number] | null } | null {
  const entry = stemMap.get(folderName);
  if (entry === undefined) return null;
  const { original, rect } = entry;

  let resolvedPath = original;
  if (searchPaths?.length) {
    const basename = original.replace(/\\/g, "/").split("/").pop() ?? original;
    for (const dir of searchPaths) {
      const candidate = path.join(dir, basename);
      if (fs.existsSync(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
  }

  // JS has no crop view: always a closed Video (the original/repaired path
  // string is preserved verbatim, including Windows `D:\...` paths).
  video.sourceVideo = new Video({ filename: resolvedPath, openBackend: false });
  return { path: resolvedPath, rect };
}

// -----------------------------------------------------------------------------
// CSV reading
// -----------------------------------------------------------------------------

type ColumnTuple = [string, string, string];

interface DlcDataframe {
  index: string[];
  columns: ColumnTuple[];
  /** rows[r][c] aligns to columns[c]; `null` means missing/NaN. */
  rows: Array<Array<number | null>>;
  isMultianimal: boolean;
}

/**
 * Read a DLC annotation CSV into a flattened-index multi-column table,
 * emulating pandas `read_csv` with multi-row headers.
 */
export function readDlcDataframe(filename: string): DlcDataframe {
  const raw = fs.readFileSync(filename, "utf-8").split(/\r?\n/);
  // Strip a single trailing empty line if present.
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  const cells = raw.map((line) => line.split(","));

  // Peek: detect format. Wrap in try/catch — too-few-rows -> SADLC path.
  let isMultianimal = false;
  let isMultiindex = false;
  try {
    if (cells.length < 5) throw new Error("too few rows to peek");
    isMultianimal = cells[1][0] === "individuals";
    isMultiindex = cells[4][0] === "labeled-data";
  } catch {
    isMultianimal = false;
    isMultiindex = false;
  }

  const headerRowIdxs = isMultianimal ? [1, 2, 3] : [0, 1, 2];
  const dataStartRow = isMultianimal ? 4 : 3;
  const indexColCount = isMultiindex ? 3 : 1;

  // Build column tuples (columns at index >= indexColCount).
  const columns: ColumnTuple[] = [];
  const headerRow0 = cells[headerRowIdxs[0]] ?? [];
  const ncols = headerRow0.length;
  for (let j = indexColCount; j < ncols; j += 1) {
    columns.push([
      cells[headerRowIdxs[0]]?.[j] ?? "",
      cells[headerRowIdxs[1]]?.[j] ?? "",
      cells[headerRowIdxs[2]]?.[j] ?? "",
    ]);
  }

  const index: string[] = [];
  const rows: Array<Array<number | null>> = [];
  for (let r = dataStartRow; r < cells.length; r += 1) {
    const row = cells[r];
    if (!row) continue;
    // Skip fully-empty rows.
    if (row.every((c) => c === "")) continue;

    let idxStr: string;
    if (isMultiindex) {
      idxStr = [row[0] ?? "", row[1] ?? "", row[2] ?? ""].join("/");
    } else {
      idxStr = row[0] ?? "";
    }
    index.push(idxStr);

    const values: Array<number | null> = [];
    for (let j = indexColCount; j < ncols; j += 1) {
      const cell = row[j];
      if (cell === undefined || cell === "") {
        values.push(null);
      } else {
        const v = parseFloat(cell);
        values.push(Number.isNaN(v) ? null : v);
      }
    }
    rows.push(values);
  }

  return { index, columns, rows, isMultianimal };
}

// -----------------------------------------------------------------------------
// Structure / row parsing
// -----------------------------------------------------------------------------

/** Parse single-animal DLC structure to extract a `Skeleton`. */
function parseSingleAnimalStructure(df: DlcDataframe): Skeleton {
  const collected: string[] = [];
  const seen = new Set<string>();
  for (const [, bodypart, coord] of df.columns) {
    if (coord === "x" && bodypart !== "" && bodypart != null) {
      if (!seen.has(bodypart)) {
        seen.add(bodypart);
        collected.push(bodypart);
      }
    }
  }
  const nodeNames = [...new Set(collected)].sort();
  return new Skeleton({ nodes: nodeNames.map((n) => new Node(n)) });
}

/** Parse multi-animal DLC structure to extract a `Skeleton` and `Track`s. */
function parseMultiAnimalStructure(df: DlcDataframe): {
  skeleton: Skeleton;
  tracks: Track[];
} {
  const trackMap = new Map<string, Track>();
  const collected: string[] = [];
  const seen = new Set<string>();
  for (const [individual, bodypart, coord] of df.columns) {
    if (coord !== "x") continue;
    if (
      individual !== "" &&
      individual != null &&
      individual !== "individuals" &&
      !trackMap.has(individual)
    ) {
      trackMap.set(individual, new Track(individual));
    }
    if (
      bodypart !== "" &&
      bodypart != null &&
      bodypart !== "bodyparts" &&
      !seen.has(bodypart)
    ) {
      seen.add(bodypart);
      collected.push(bodypart);
    }
  }
  const nodeNames = [...new Set(collected)].sort();
  const skeleton = new Skeleton({ nodes: nodeNames.map((n) => new Node(n)) });
  const tracks = [...trackMap.values()];
  return { skeleton, tracks };
}

/** A single CSV row, as a parallel array of numeric/null values per column. */
type RowValues = Array<number | null>;

/** Parse a row of single-animal DLC data into 0 or 1 instances. */
function parseSingleAnimalRow(
  columns: ColumnTuple[],
  values: RowValues,
  skeleton: Skeleton,
): Instance[] {
  const bodypartsData = new Map<
    string,
    { x?: number | null; y?: number | null }
  >();
  for (let c = 0; c < columns.length; c += 1) {
    const [, bodypart, coord] = columns[c];
    if (bodypart && bodypart !== "") {
      let bp = bodypartsData.get(bodypart);
      if (!bp) {
        bp = {};
        bodypartsData.set(bodypart, bp);
      }
      if (coord === "x") bp.x = values[c];
      else if (coord === "y") bp.y = values[c];
    }
  }

  let hasValidPoints = false;
  const pointsData: number[][] = skeleton.nodeNames.map((name) => {
    const bp = bodypartsData.get(name);
    const x = bp?.x;
    const y = bp?.y;
    if (x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y)) {
      hasValidPoints = true;
      return [Number(x), Number(y)];
    }
    return [Number.NaN, Number.NaN];
  });

  if (hasValidPoints) {
    return [Instance.fromNumpy({ pointsData, skeleton })];
  }
  return [];
}

/** Parse a row of multi-animal DLC data into 0..N instances. */
function parseMultiAnimalRow(
  columns: ColumnTuple[],
  values: RowValues,
  skeleton: Skeleton,
  tracks: Track[],
): Instance[] {
  const instancesDict = new Map<
    string,
    Map<string, { x?: number | null; y?: number | null }>
  >();
  for (let c = 0; c < columns.length; c += 1) {
    const [individual, bodypart, coord] = columns[c];
    if (!individual || individual === "" || individual === "individuals") {
      continue;
    }
    let bps = instancesDict.get(individual);
    if (!bps) {
      bps = new Map();
      instancesDict.set(individual, bps);
    }
    if (bodypart && bodypart !== "") {
      let bp = bps.get(bodypart);
      if (!bp) {
        bp = {};
        bps.set(bodypart, bp);
      }
      if (coord === "x") bp.x = values[c];
      else if (coord === "y") bp.y = values[c];
    }
  }

  const instances: Instance[] = [];
  for (const [individual, bodypartsData] of instancesDict) {
    const track = tracks.find((t) => t.name === individual) ?? null;
    let hasValidPoints = false;
    const pointsData: number[][] = skeleton.nodeNames.map((name) => {
      const bp = bodypartsData.get(name);
      const x = bp?.x;
      const y = bp?.y;
      if (x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y)) {
        hasValidPoints = true;
        return [Number(x), Number(y)];
      }
      return [Number.NaN, Number.NaN];
    });
    if (hasValidPoints) {
      instances.push(Instance.fromNumpy({ pointsData, skeleton, track }));
    }
  }
  return instances;
}

/** Extract the last numeric run from an image filename stem (for sorting). */
export function extractFrameIndex(imgPath: string): number {
  const base = path.basename(imgPath);
  const stem = base.replace(/\.[^.]*$/, "");
  const matches = stem.match(/\d+/g);
  return matches ? parseInt(matches[matches.length - 1], 10) : 0;
}

/** Derive the video-folder name from an index string. */
function videoNameFor(imgPath: string): string {
  const parts = imgPath.split("/");
  if (parts.length >= 2 && parts[0] === "labeled-data") {
    return parts[1];
  }
  return path.basename(path.dirname(imgPath)) || "default";
}

// -----------------------------------------------------------------------------
// Single-CSV loading
// -----------------------------------------------------------------------------

export interface LoadDlcOptions {
  videoSearchPaths?: string[];
  /**
   * `null`/`undefined` = auto-discover `config.yaml` walking up from the CSV;
   * `false` = disable config entirely (legacy output, no edges/links/crops);
   * string = force this config path.
   */
  config?: string | false | null;
  /** Accepted-and-ignored (PR #488 parity): openVideos, lazy, etc. */
  [key: string]: unknown;
}

/**
 * Load DeepLabCut annotations from a single CSV file.
 *
 * @param filename Path to a DLC CSV file.
 * @param options Loader options ({@link LoadDlcOptions}).
 * @returns A {@link Labels} object with the loaded data.
 */
export function loadDlc(filename: string, options?: LoadDlcOptions): Labels {
  const cfg = resolveConfig(filename, options?.config ?? null);
  return loadDlcCsv(filename, {
    config: cfg,
    videoSearchPaths: options?.videoSearchPaths,
  });
}

interface LoadDlcCsvOpts {
  config: Config | null;
  videoSearchPaths?: string[];
  /** Shared skeleton (project load) — skips structure parsing + edge attach. */
  skeleton?: Skeleton;
  /** Shared tracks (project load). */
  tracks?: Track[];
}

/** Core single-CSV pipeline. Returns a {@link Labels}. */
function loadDlcCsv(filename: string, opts: LoadDlcCsvOpts): Labels {
  const df = readDlcDataframe(filename);
  const { isMultianimal } = df;

  // Parse structure (unless a shared skeleton was provided).
  let skeleton: Skeleton;
  let tracks: Track[];
  if (opts.skeleton) {
    skeleton = opts.skeleton;
    tracks = opts.tracks ?? [];
  } else {
    if (isMultianimal) {
      const parsed = parseMultiAnimalStructure(df);
      skeleton = parsed.skeleton;
      tracks = parsed.tracks;
    } else {
      skeleton = parseSingleAnimalStructure(df);
      tracks = [];
    }
    if (opts.config != null) {
      attachConfigSkeleton(skeleton, opts.config);
    }
  }

  // Group all image paths by their video directory.
  const videoImagePaths = new Map<string, string[]>();
  const frameMap = new Map<string, number>();
  for (const imgPath of df.index) {
    frameMap.set(imgPath, extractFrameIndex(imgPath));
    const videoName = videoNameFor(imgPath);
    if (!videoImagePaths.has(videoName)) videoImagePaths.set(videoName, []);
    videoImagePaths.get(videoName)!.push(imgPath);
  }

  // Create one Video object per video directory.
  const csvDir = path.dirname(path.resolve(filename));
  const videos = new Map<string, Video>();
  const sortedVideoPaths = new Map<string, string[]>();
  for (const [videoName, imgPaths] of videoImagePaths) {
    const sortedImgPaths = [...imgPaths].sort(
      (a, b) => (frameMap.get(a) ?? 0) - (frameMap.get(b) ?? 0),
    );
    const actualImageFiles: string[] = [];
    for (const imgPath of sortedImgPaths) {
      const candidates = [
        path.join(csvDir, imgPath),
        path.join(csvDir, path.basename(imgPath)),
        path.join(path.dirname(csvDir), imgPath),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      if (found) actualImageFiles.push(found);
    }
    if (actualImageFiles.length > 0) {
      videos.set(
        videoName,
        new Video({ filename: actualImageFiles, openBackend: false }),
      );
      sortedVideoPaths.set(videoName, sortedImgPaths);
    }
  }

  // Link image folders back to their original videos from config video_sets.
  const dlcCrops: Record<string, number[]> = {};
  if (opts.config != null && videos.size > 0) {
    const stemMap = videoSetsStemMap(opts.config);
    for (const [videoName, video] of videos) {
      const result = setSourceVideo(
        video,
        videoName,
        stemMap,
        opts.videoSearchPaths,
      );
      if (result != null && result.rect != null) {
        dlcCrops[result.path] = [...result.rect];
      }
    }
  }

  // Parse data rows -> labeled frames (in original CSV row order).
  const allFrames: LabeledFrame[] = [];
  for (let r = 0; r < df.index.length; r += 1) {
    const imgPath = df.index[r];
    const videoName = videoNameFor(imgPath);
    if (!videos.has(videoName)) continue;
    const video = videos.get(videoName)!;
    const sortedPaths = sortedVideoPaths.get(videoName)!;
    const videoFrameIdx = sortedPaths.indexOf(imgPath);

    const instances = isMultianimal
      ? parseMultiAnimalRow(df.columns, df.rows[r], skeleton, tracks)
      : parseSingleAnimalRow(df.columns, df.rows[r], skeleton);

    allFrames.push(
      new LabeledFrame({ video, frameIdx: videoFrameIdx, instances }),
    );
  }

  const labels = new Labels({
    labeledFrames: allFrames,
    videos: [...videos.values()],
    tracks,
    skeletons: skeleton.nodes.length ? [skeleton] : [],
  });
  if (Object.keys(dlcCrops).length) {
    labels.provenance.dlc_crops = dlcCrops;
  }
  return labels;
}

// -----------------------------------------------------------------------------
// Project loading
// -----------------------------------------------------------------------------

export interface LoadDlcProjectOptions {
  videoSearchPaths?: string[];
  /** Accepted-and-ignored (PR #488 parity). */
  [key: string]: unknown;
}

/** Resolve a project argument to a `config.yaml` path. */
function resolveProjectConfigPath(config: string): string {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(config);
  } catch {
    stat = null;
  }
  if (stat?.isDirectory()) {
    const candidate = path.join(config, "config.yaml");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    throw new Error(`No config.yaml found in DLC project directory: ${config}`);
  }
  return config;
}

/** Find per-video annotation CSVs under `labeled-data/`. */
function findProjectCsvs(
  projectDir: string,
  scorer: string | null,
): Array<[string, string]> {
  const labeledDir = path.join(projectDir, "labeled-data");
  const folders: Array<[string, string]> = [];
  if (!fs.existsSync(labeledDir) || !fs.statSync(labeledDir).isDirectory()) {
    return folders;
  }
  const subs = fs.readdirSync(labeledDir).sort();
  for (const sub of subs) {
    const subDir = path.join(labeledDir, sub);
    if (!fs.statSync(subDir).isDirectory()) continue;
    let csv = path.join(subDir, `CollectedData_${scorer}.csv`);
    if (!fs.existsSync(csv) || !fs.statSync(csv).isFile()) {
      // Fall back to any DLC-looking CSV in the folder (sorted).
      const candidates = fs
        .readdirSync(subDir)
        .filter((f) => f.endsWith(".csv"))
        .sort()
        .map((f) => path.join(subDir, f))
        .filter((c) => isDlcFile(c));
      if (candidates.length === 0) continue;
      csv = candidates[0];
    }
    folders.push([sub, csv]);
  }
  return folders;
}

/**
 * Load an entire DeepLabCut project from its `config.yaml`.
 *
 * @param config Path to a `config.yaml`, or to a project directory with one.
 * @param options Loader options ({@link LoadDlcProjectOptions}).
 * @returns A {@link Labels} object with frames from every labeled video.
 */
export function loadDlcProject(
  config: string,
  options?: LoadDlcProjectOptions,
): Labels {
  const videoSearchPaths = options?.videoSearchPaths;
  const configPath = resolveProjectConfigPath(config);
  const cfg = readDlcConfig(configPath);
  if (cfg === null) {
    throw new Error(`Could not read DLC config: ${configPath}`);
  }

  const projectDir = path.dirname(configPath);
  const scorer = (cfg.scorer as string | undefined) ?? null;
  const folders = findProjectCsvs(projectDir, scorer);
  if (folders.length === 0) {
    throw new Error(
      `No DLC annotation CSVs found under ${path.join(projectDir, "labeled-data")}`,
    );
  }

  // Build a single shared skeleton and track list across all videos.
  const nodeNames: string[] = [];
  const trackNames: string[] = [];
  for (const [, csv] of folders) {
    const df = readDlcDataframe(csv);
    if (df.isMultianimal) {
      const { skeleton: folderSkeleton, tracks: folderTracks } =
        parseMultiAnimalStructure(df);
      for (const track of folderTracks) {
        if (!trackNames.includes(track.name)) trackNames.push(track.name);
      }
      for (const name of folderSkeleton.nodeNames) {
        if (!nodeNames.includes(name)) nodeNames.push(name);
      }
    } else {
      const folderSkeleton = parseSingleAnimalStructure(df);
      for (const name of folderSkeleton.nodeNames) {
        if (!nodeNames.includes(name)) nodeNames.push(name);
      }
    }
  }

  const sharedSkeleton = new Skeleton({
    nodes: [...new Set(nodeNames)].sort().map((n) => new Node(n)),
  });
  attachConfigSkeleton(sharedSkeleton, cfg);
  const sharedTracks = trackNames.map((n) => new Track(n));

  // Load each folder using the shared skeleton/tracks.
  const allFrames: LabeledFrame[] = [];
  const allVideos: Video[] = [];
  const dlcCrops: Record<string, number[]> = {};
  for (const [, csv] of folders) {
    const folderLabels = loadDlcCsv(csv, {
      config: cfg,
      videoSearchPaths,
      skeleton: sharedSkeleton,
      tracks: sharedTracks,
    });
    allFrames.push(...folderLabels.labeledFrames);
    allVideos.push(...folderLabels.videos);
    const crops = folderLabels.provenance.dlc_crops as
      | Record<string, number[]>
      | undefined;
    if (crops) Object.assign(dlcCrops, crops);
  }

  const labels = new Labels({
    labeledFrames: allFrames,
    videos: allVideos,
    tracks: sharedTracks,
    skeletons: sharedSkeleton.nodes.length ? [sharedSkeleton] : [],
  });
  labels.provenance.dlc_project = String(configPath);
  labels.provenance.dlc_scorer = scorer;
  labels.provenance.dlc_task = cfg.Task ?? null;
  if (Object.keys(dlcCrops).length) {
    labels.provenance.dlc_crops = dlcCrops;
  }
  return labels;
}

// -----------------------------------------------------------------------------
// Training-set splits
// -----------------------------------------------------------------------------

/** Return the `UnaugmentedDataSet` folder for a project iteration. */
function getTrainingSetFolder(
  projectDir: string,
  cfg: Config,
  iteration: number | undefined,
): string {
  const it =
    iteration == null
      ? ((cfg.iteration as number | undefined) ?? 0)
      : iteration;
  const task = (cfg.Task as string | undefined) ?? "";
  const date = (cfg.date as string | undefined) ?? "";
  return path.join(
    projectDir,
    "training-datasets",
    `iteration-${it}`,
    `UnaugmentedDataSet_${task}${date}`,
  );
}

/** Locate the `Documentation_data-*.pickle` for the requested split. */
function selectDocumentationPickle(
  projectDir: string,
  cfg: Config,
  selectors: {
    shuffle?: number;
    trainFraction?: number;
    iteration?: number;
  },
): string {
  const trainsetDir = getTrainingSetFolder(
    projectDir,
    cfg,
    selectors.iteration,
  );
  const pickles = (
    fs.existsSync(trainsetDir) && fs.statSync(trainsetDir).isDirectory()
      ? fs
          .readdirSync(trainsetDir)
          .filter((f) => /^Documentation_data-.*\.pickle$/.test(f))
      : []
  ).sort();
  if (pickles.length === 0) {
    throw new Error(
      `No DLC Documentation_data-*.pickle found in ${trainsetDir}. ` +
        "Run create_training_dataset in DLC to generate splits.",
    );
  }

  const pattern = /^Documentation_data-(.+)_(\d+)shuffle(\d+)\.pickle$/;
  const parsed: Array<{ path: string; fracInt: number; shuffleInt: number }> =
    [];
  for (const name of pickles) {
    const m = pattern.exec(name);
    if (m) {
      parsed.push({
        path: path.join(trainsetDir, name),
        fracInt: parseInt(m[2], 10),
        shuffleInt: parseInt(m[3], 10),
      });
    }
  }

  if (parsed.length === 0) {
    if (pickles.length === 1) return path.join(trainsetDir, pickles[0]);
    throw new Error(
      `Could not parse train_fraction/shuffle from pickles in ${trainsetDir}: ` +
        JSON.stringify(pickles),
    );
  }

  let candidates = parsed;
  if (selectors.trainFraction != null) {
    const fracInt = Math.round(selectors.trainFraction * 100);
    candidates = candidates.filter((c) => c.fracInt === fracInt);
  }
  if (selectors.shuffle != null) {
    candidates = candidates.filter((c) => c.shuffleInt === selectors.shuffle);
  }

  if (candidates.length === 0) {
    const available = parsed.map((c) => [
      path.basename(c.path),
      c.fracInt,
      c.shuffleInt,
    ]);
    throw new Error(
      `No Documentation pickle matched train_fraction=${selectors.trainFraction}, ` +
        `shuffle=${selectors.shuffle}. Available: ${JSON.stringify(available)}`,
    );
  }
  if (candidates.length > 1) {
    const available = candidates.map((c) => [
      path.basename(c.path),
      c.fracInt,
      c.shuffleInt,
    ]);
    throw new Error(
      "Multiple DLC splits found; specify trainFraction and/or shuffle. " +
        `Available (name, train%, shuffle): ${JSON.stringify(available)}`,
    );
  }
  return candidates[0].path;
}

/** Read train/test positional indices from a DLC Documentation pickle. */
export function readDlcSplit(picklePath: string): [number[], number[]] {
  const buf = fs.readFileSync(picklePath);
  const meta = readPickle(buf) as unknown[];
  const toInts = (arr: unknown): number[] =>
    (arr as unknown[])
      .map((i) => Number(i))
      .filter((i) => i !== -1 && !Number.isNaN(i));
  return [toInts(meta[1]), toInts(meta[2])];
}

/** Read the scorer name from the first row of a DLC CSV. */
export function readCsvScorer(csv: string): string | null {
  let first: string;
  try {
    const content = fs.readFileSync(csv, "utf-8");
    first = content.split(/\r?\n/)[0]?.trim() ?? "";
  } catch {
    return null;
  }
  const parts = first.split(",");
  return parts.length > 1 ? parts[1] : null;
}

/** Reconstruct DLC's globally merged frame order as `(folder, filename)`. */
export function dlcMergedOrder(
  projectDir: string,
  cfg: Config,
): Array<[string, string]> {
  const scorer = (cfg.scorer as string | undefined) ?? null;
  const stemMap = videoSetsStemMap(cfg);

  // Determine the included folders, mirroring DLC's merge skip-rules.
  const included: Array<[string, string]> = [];
  for (const stem of stemMap.keys()) {
    const csv = path.join(
      projectDir,
      "labeled-data",
      stem,
      `CollectedData_${scorer}.csv`,
    );
    if (!fs.existsSync(csv) || !fs.statSync(csv).isFile()) continue;
    const csvScorer = readCsvScorer(csv);
    if (scorer != null && csvScorer != null && csvScorer !== scorer) {
      warn(
        `Skipping ${csv} labeled by '${csvScorer}' (project scorer is ` +
          `'${scorer}'); this matches DLC's training-set merge behavior.`,
      );
      continue;
    }
    included.push([stem, csv]);
  }

  // Fallback: video_sets stems did not match any labeled-data folder.
  if (included.length === 0) {
    for (const [folder, csv] of findProjectCsvs(projectDir, scorer)) {
      included.push([folder, csv]);
    }
  }

  const merged: Array<[string, string]> = [];
  for (const [, csv] of included) {
    const df = readDlcDataframe(csv);
    for (const idx of df.index) {
      merged.push([path.basename(path.dirname(idx)), path.basename(idx)]);
    }
  }

  // DLC applies a global lexicographic sort across all merged frames.
  merged.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });
  return merged;
}

/** Warn if numeric filename order differs from DLC's lexicographic order. */
export function warnIfNonlexicographic(merged: Array<[string, string]>): void {
  const lastDigitsRun = (fname: string): number => {
    const nums = fname.match(/\d+/g);
    return nums ? parseInt(nums[nums.length - 1], 10) : -1;
  };
  const lexCmp = (a: [string, string], b: [string, string]): number => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  };
  const numericCmp = (a: [string, string], b: [string, string]): number => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    const na = lastDigitsRun(a[1]);
    const nb = lastDigitsRun(b[1]);
    if (na !== nb) return na - nb;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  };
  const lex = [...merged].sort(lexCmp);
  const num = [...merged].sort(numericCmp);
  const differ =
    lex.length !== num.length ||
    lex.some((m, i) => m[0] !== num[i][0] || m[1] !== num[i][1]);
  if (differ) {
    warn(
      "DLC split import: image filenames are not zero-padded, so DLC's " +
        "lexicographic ordering differs from numeric order (e.g. 'img10' < " +
        "'img2'). Train/test assignment follows DLC's lexicographic order; " +
        "verify the result.",
    );
  }
}

export interface LoadDlcSplitsOptions {
  shuffle?: number;
  trainFraction?: number;
  iteration?: number;
  videoSearchPaths?: string[];
  /** Accepted-and-ignored (PR #488/#492 parity). */
  [key: string]: unknown;
}

/**
 * Load DeepLabCut train/test splits from a project's Documentation pickle.
 *
 * @param config Path to a DLC project `config.yaml` (or its project directory).
 * @param options Selector + loader options ({@link LoadDlcSplitsOptions}).
 * @returns A {@link LabelsSet} with `"train"` and `"test"` keys.
 */
export function loadDlcSplits(
  config: string,
  options?: LoadDlcSplitsOptions,
): LabelsSet {
  const configPath = resolveProjectConfigPath(config);
  const cfg = readDlcConfig(configPath);
  if (cfg === null) {
    throw new Error(`Could not read DLC config: ${configPath}`);
  }
  const projectDir = path.dirname(configPath);

  // Load the full project, then partition its frames into train/test.
  const labels = loadDlcProject(configPath, {
    videoSearchPaths: options?.videoSearchPaths,
  });

  const merged = dlcMergedOrder(projectDir, cfg);
  warnIfNonlexicographic(merged);

  // Splits require labeled images present so each merged frame maps to a frame.
  if (merged.length && labels.labeledFrames.length === 0) {
    warn(
      "DLC split import: the project's labeled images were not found on " +
        "disk, so no frames could be loaded and the train/test splits will be " +
        "empty. Restore the referenced images under 'labeled-data/' (or pass " +
        "videoSearchPaths) and try again.",
    );
  }

  const picklePath = selectDocumentationPickle(projectDir, cfg, {
    shuffle: options?.shuffle,
    trainFraction: options?.trainFraction,
    iteration: options?.iteration,
  });
  const [trainIdx, testIdx] = readDlcSplit(picklePath);

  // Build a lookup from (folder \0 filename) -> global LabeledFrame index.
  const SEP = " ";
  const lfLookup = new Map<string, number>();
  for (let g = 0; g < labels.labeledFrames.length; g += 1) {
    const lf = labels.labeledFrames[g];
    const filename = lf.video.filename;
    const fname = Array.isArray(filename) ? filename[lf.frameIdx] : filename;
    const key = `${path.basename(path.dirname(fname))}${SEP}${path.basename(fname)}`;
    lfLookup.set(key, g);
  }

  const mapIndices = (indices: number[]): number[] => {
    const out: number[] = [];
    for (const i of indices) {
      if (i >= 0 && i < merged.length) {
        const [folder, fname] = merged[i];
        const g = lfLookup.get(`${folder}${SEP}${fname}`);
        if (g !== undefined) out.push(g);
      }
    }
    return out;
  };

  const trainGlobal = mapIndices(trainIdx);
  const testGlobal = mapIndices(testIdx);

  const train = labels.extract(trainGlobal, true);
  const test = labels.extract(testGlobal, true);

  return new LabelsSet({ train, test });
}

// -----------------------------------------------------------------------------
// Minimal Python pickle reader (protocols 2-5)
// -----------------------------------------------------------------------------

/** Placeholder for callables/classes reached via GLOBAL/STACK_GLOBAL. */
class PickleGlobalRef {
  constructor(
    public module: string,
    public name: string,
  ) {}
}

/**
 * Decode a Python pickle into JS values, supporting the subset of opcodes
 * needed for DLC's `Documentation_data-*.pickle` (a shallow
 * `[list, list[int], list[int], float]`, where the first `list` may contain
 * dicts whose values are tuples/strings/ints, and optionally numpy arrays).
 *
 * The DLC split reader only consumes `meta[1]` / `meta[2]` (plain int lists),
 * so the lossy `data` payload need not be perfectly reconstructed; unrecognized
 * reductions are returned as opaque marker objects.
 */
export function readPickle(buffer: Buffer): unknown {
  const MARK = Symbol("mark");
  const stack: unknown[] = [];
  const memo = new Map<number, unknown>();
  let pos = 0;

  const popMark = (): unknown[] => {
    const items: unknown[] = [];
    while (stack.length > 0) {
      const top = stack.pop();
      if (top === MARK) return items.reverse();
      items.push(top);
    }
    throw new Error("pickle: MARK not found on stack");
  };

  const readLine = (): string => {
    let end = pos;
    while (end < buffer.length && buffer[end] !== 0x0a) end += 1;
    const s = buffer.toString("latin1", pos, end);
    pos = end + 1;
    return s;
  };

  const reduce = (func: unknown, args: unknown[]): unknown => {
    if (func instanceof PickleGlobalRef) {
      if (
        func.module.startsWith("numpy") &&
        (func.name === "_reconstruct" || func.name === "ndarray")
      ) {
        return { __numpy__: true } as Record<string, unknown>;
      }
      return { __reduce__: [func.module, func.name], args };
    }
    return { __reduce__: func, args };
  };

  const build = (obj: unknown, state: unknown): unknown => {
    if (
      obj &&
      typeof obj === "object" &&
      (obj as Record<string, unknown>).__numpy__
    ) {
      if (Array.isArray(state)) {
        (obj as Record<string, unknown>).rawdata = state[state.length - 1];
      }
      return obj;
    }
    return obj;
  };

  while (pos < buffer.length) {
    const op = buffer[pos];
    pos += 1;
    switch (op) {
      case 0x80: // PROTO
        pos += 1;
        break;
      case 0x95: // FRAME
        pos += 8;
        break;
      case 0x2e: // STOP "."
        return stack.pop();
      case 0x28: // MARK "("
        stack.push(MARK);
        break;
      case 0x4e: // NONE "N"
        stack.push(null);
        break;
      case 0x88: // NEWTRUE
        stack.push(true);
        break;
      case 0x89: // NEWFALSE
        stack.push(false);
        break;
      // ---- ints ----
      case 0x4b: // BININT1 "K" (1 byte)
        stack.push(buffer[pos]);
        pos += 1;
        break;
      case 0x4d: // BININT2 "M" (2 bytes LE)
        stack.push(buffer.readUInt16LE(pos));
        pos += 2;
        break;
      case 0x4a: // BININT "J" (4 bytes signed LE)
        stack.push(buffer.readInt32LE(pos));
        pos += 4;
        break;
      case 0x49: {
        // INT "I" (text)
        const s = readLine();
        if (s === "00") stack.push(false);
        else if (s === "01") stack.push(true);
        else stack.push(parseInt(s, 10));
        break;
      }
      case 0x8a: {
        // LONG1 (1-byte length, little-endian signed)
        const n = buffer[pos];
        pos += 1;
        let val = 0;
        for (let i = 0; i < n; i += 1) val += buffer[pos + i] * 2 ** (8 * i);
        if (n > 0 && buffer[pos + n - 1] & 0x80) val -= 2 ** (8 * n);
        pos += n;
        stack.push(val);
        break;
      }
      case 0x8b: {
        // LONG4 (4-byte length)
        const n = buffer.readUInt32LE(pos);
        pos += 4;
        let val = 0;
        for (let i = 0; i < n; i += 1) val += buffer[pos + i] * 2 ** (8 * i);
        if (n > 0 && buffer[pos + n - 1] & 0x80) val -= 2 ** (8 * n);
        pos += n;
        stack.push(val);
        break;
      }
      case 0x4c: {
        // LONG "L" (text, trailing 'L')
        const s = readLine().replace(/L$/, "");
        stack.push(parseInt(s, 10));
        break;
      }
      // ---- floats ----
      case 0x47: // BINFLOAT "G" (8 bytes BE)
        stack.push(buffer.readDoubleBE(pos));
        pos += 8;
        break;
      case 0x46: // FLOAT "F" (text)
        stack.push(parseFloat(readLine()));
        break;
      // ---- strings / unicode / bytes ----
      case 0x8c: {
        // SHORT_BINUNICODE (1-byte length)
        const len = buffer[pos];
        pos += 1;
        stack.push(buffer.toString("utf-8", pos, pos + len));
        pos += len;
        break;
      }
      case 0x58: {
        // BINUNICODE "X" (4-byte length)
        const len = buffer.readUInt32LE(pos);
        pos += 4;
        stack.push(buffer.toString("utf-8", pos, pos + len));
        pos += len;
        break;
      }
      case 0x8d: {
        // BINUNICODE8 (8-byte length)
        const len = Number(buffer.readBigUInt64LE(pos));
        pos += 8;
        stack.push(buffer.toString("utf-8", pos, pos + len));
        pos += len;
        break;
      }
      case 0x55: {
        // SHORT_BINSTRING "U" (1-byte length)
        const len = buffer[pos];
        pos += 1;
        stack.push(buffer.toString("latin1", pos, pos + len));
        pos += len;
        break;
      }
      case 0x54: {
        // BINSTRING "T" (4-byte length)
        const len = buffer.readUInt32LE(pos);
        pos += 4;
        stack.push(buffer.toString("latin1", pos, pos + len));
        pos += len;
        break;
      }
      case 0x43: {
        // SHORT_BINBYTES "C" (1-byte length)
        const len = buffer[pos];
        pos += 1;
        stack.push(buffer.subarray(pos, pos + len));
        pos += len;
        break;
      }
      case 0x42: {
        // BINBYTES "B" (4-byte length)
        const len = buffer.readUInt32LE(pos);
        pos += 4;
        stack.push(buffer.subarray(pos, pos + len));
        pos += len;
        break;
      }
      case 0x8e: {
        // BINBYTES8 (8-byte length)
        const len = Number(buffer.readBigUInt64LE(pos));
        pos += 8;
        stack.push(buffer.subarray(pos, pos + len));
        pos += len;
        break;
      }
      // ---- lists ----
      case 0x5d: // EMPTY_LIST "]"
        stack.push([]);
        break;
      case 0x6c: // LIST "l"
        stack.push(popMark());
        break;
      case 0x61: {
        // APPEND "a"
        const value = stack.pop();
        (stack[stack.length - 1] as unknown[]).push(value);
        break;
      }
      case 0x65: {
        // APPENDS "e"
        const items = popMark();
        const list = stack[stack.length - 1] as unknown[];
        for (const it of items) list.push(it);
        break;
      }
      // ---- dicts ----
      case 0x7d: // EMPTY_DICT "}"
        stack.push(new Map<unknown, unknown>());
        break;
      case 0x64: {
        // DICT "d"
        const items = popMark();
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < items.length; i += 2) {
          map.set(items[i], items[i + 1]);
        }
        stack.push(map);
        break;
      }
      case 0x73: {
        // SETITEM "s"
        const value = stack.pop();
        const key = stack.pop();
        (stack[stack.length - 1] as Map<unknown, unknown>).set(key, value);
        break;
      }
      case 0x75: {
        // SETITEMS "u"
        const items = popMark();
        const map = stack[stack.length - 1] as Map<unknown, unknown>;
        for (let i = 0; i < items.length; i += 2) {
          map.set(items[i], items[i + 1]);
        }
        break;
      }
      // ---- tuples ----
      case 0x29: // EMPTY_TUPLE ")"
        stack.push([]);
        break;
      case 0x74: // TUPLE "t"
        stack.push(popMark());
        break;
      case 0x85: {
        // TUPLE1
        const a = stack.pop();
        stack.push([a]);
        break;
      }
      case 0x86: {
        // TUPLE2
        const b = stack.pop();
        const a = stack.pop();
        stack.push([a, b]);
        break;
      }
      case 0x87: {
        // TUPLE3
        const c = stack.pop();
        const b = stack.pop();
        const a = stack.pop();
        stack.push([a, b, c]);
        break;
      }
      // ---- memo ----
      case 0x71: // BINPUT "q"
        memo.set(buffer[pos], stack[stack.length - 1]);
        pos += 1;
        break;
      case 0x72: // LONG_BINPUT "r"
        memo.set(buffer.readUInt32LE(pos), stack[stack.length - 1]);
        pos += 4;
        break;
      case 0x94: // MEMOIZE
        memo.set(memo.size, stack[stack.length - 1]);
        break;
      case 0x70: {
        // PUT "p" (text)
        const idx = parseInt(readLine(), 10);
        memo.set(idx, stack[stack.length - 1]);
        break;
      }
      case 0x68: // BINGET "h"
        stack.push(memo.get(buffer[pos]));
        pos += 1;
        break;
      case 0x6a: // LONG_BINGET "j"
        stack.push(memo.get(buffer.readUInt32LE(pos)));
        pos += 4;
        break;
      case 0x67: // GET "g" (text)
        stack.push(memo.get(parseInt(readLine(), 10)));
        break;
      // ---- globals / reduce / build / newobj ----
      case 0x63: {
        // GLOBAL "c" (module\nname\n)
        const module = readLine();
        const name = readLine();
        stack.push(new PickleGlobalRef(module, name));
        break;
      }
      case 0x93: {
        // STACK_GLOBAL
        const name = stack.pop();
        const module = stack.pop();
        stack.push(new PickleGlobalRef(String(module), String(name)));
        break;
      }
      case 0x52: {
        // REDUCE "R"
        const args = stack.pop();
        const func = stack.pop();
        stack.push(reduce(func, args as unknown[]));
        break;
      }
      case 0x62: {
        // BUILD "b"
        const state = stack.pop();
        const obj = stack[stack.length - 1];
        stack[stack.length - 1] = build(obj, state);
        break;
      }
      case 0x81: {
        // NEWOBJ
        const args = stack.pop();
        const cls = stack.pop();
        stack.push(reduce(cls, args as unknown[]));
        break;
      }
      case 0x92: {
        // NEWOBJ_EX
        stack.pop(); // kwargs
        const args = stack.pop();
        const cls = stack.pop();
        stack.push(reduce(cls, args as unknown[]));
        break;
      }
      default:
        throw new Error(
          `pickle: unsupported opcode 0x${op.toString(16)} at offset ${pos - 1}`,
        );
    }
  }
  throw new Error("pickle: reached end of buffer without STOP");
}
