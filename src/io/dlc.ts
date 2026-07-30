/**
 * DeepLabCut (DLC) format I/O — browser-safe read core.
 *
 * TypeScript port of `sleap_io/io/dlc.py` (READ path only), adapted to the
 * JS/Node data model and runtime.
 *
 * In addition to reading a single DLC annotation CSV ({@link readDlc}), this
 * module can import an entire DLC *project* from its `config.yaml`
 * ({@link readDlcProject}). Recovering the train/test splits stored by
 * `create_training_dataset` (`loadDlcSplits`) lives in the Node-only
 * `dlc-node.ts` wrapper, because it decodes a Python pickle via `Buffer`.
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
 * ## Browser-safe by construction
 *
 * DLC datasets are directory trees of many files (a project dir, per-image
 * folders). Rather than read them through the Node `fs`/`path` APIs directly
 * (which would pull `node:fs` into the browser bundle), this core takes an
 * injected {@link DlcFileSystem} — a small synchronous view over an already
 * enumerated directory tree — and uses an internal POSIX path helper. The
 * Node file-path wrappers (`loadDlc`/`loadDlcProject`/`loadDlcSplits` + the
 * pickle reader) live in `dlc-node.ts`, which supplies a real-`fs` adapter and
 * is exported only from the Node entry point. Mirrors the `coco.ts` /
 * `coco-node.ts` split.
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
 * 5. **`**kwargs` ignored.** Python's forwarded loader kwargs (PR #488/#492) are
 *    modeled as an index signature on the options objects and ignored.
 */

import YAML from "yaml";

import { Labels } from "../model/labels.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { Instance, Track } from "../model/instance.js";
import { Skeleton, Node } from "../model/skeleton.js";
import { Video } from "../model/video.js";

/** Emit a warning. Centralized so messages can later be routed. */
export function warn(msg: string): void {
  console.warn(msg);
}

// -----------------------------------------------------------------------------
// Injected filesystem seam + POSIX path helper (browser-safe)
// -----------------------------------------------------------------------------

/**
 * A minimal, **synchronous** view over an already-materialized directory tree.
 *
 * The DLC read core never touches a real filesystem: the caller supplies this
 * seam. In Node, `dlc-node.ts` backs it with `fs`; in the browser/Tauri, the
 * app pre-enumerates the picked directory and pre-reads the small text files
 * (config.yaml + CSVs) into an in-memory map, exposing image paths only through
 * {@link DlcFileSystem.exists} (their pixels are read lazily by the video
 * backend, never here). All paths are treated as POSIX-ish strings; the app is
 * responsible for rooting them consistently.
 */
export interface DlcFileSystem {
  /** Whether a file or directory exists at `p`. */
  exists(p: string): boolean;
  /** Whether `p` exists and is a regular file. */
  isFile(p: string): boolean;
  /** Whether `p` exists and is a directory. */
  isDirectory(p: string): boolean;
  /** Read a text file (UTF-8). Only called for config.yaml + CSVs. */
  readTextFile(p: string): string;
  /** List the immediate entry names (not full paths) of directory `p`. */
  readDir(p: string): string[];
}

/**
 * Pure path helpers that mirror Node's per-platform separator WITHOUT importing
 * `node:path`, so the browser core stays dependency-free. The separator is
 * chosen from the input: a Windows-rooted (`C:`) or backslash path uses `\`
 * (like `path.win32`); everything else uses `/` (like `path.posix`). This keeps
 * path round-tripping correct on both platforms — the app always feeds POSIX
 * paths, while io's Node wrappers feed native ones. Callers pass already-
 * absolute/rooted paths (the Node wrappers `path.resolve(...)` at the boundary).
 */
const posix = {
  _sep(parts: string[]): "/" | "\\" {
    const first = parts.find((p) => p !== "" && p != null);
    if (
      first != null &&
      (/^[A-Za-z]:/.test(first) ||
        (first.includes("\\") && !first.includes("/")))
    ) {
      return "\\";
    }
    return "/";
  },
  join(...parts: string[]): string {
    const sep = this._sep(parts);
    const first = parts.find((p) => p !== "" && p != null);
    const absolute = first != null && /^[/\\]/.test(first);
    let drive = "";
    const segs: string[] = [];
    for (const part of parts) {
      if (!part) continue;
      let s = part;
      const m = /^([A-Za-z]:)/.exec(s);
      if (m && !drive && segs.length === 0) {
        drive = m[1];
        s = s.slice(2);
      }
      for (const seg of s.split(/[/\\]+/)) {
        if (seg) segs.push(seg);
      }
    }
    const body = segs.join(sep);
    if (drive) return `${drive}${sep}${body}`;
    return absolute ? `${sep}${body}` : body;
  },
  dirname(p: string): string {
    const sep = this._sep([p]);
    const norm = p.replace(/[/\\]+$/, "");
    const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
    if (idx < 0) return ".";
    const head = norm.slice(0, idx);
    if (/^[A-Za-z]:$/.test(head)) return head + sep;
    if (head === "") return sep;
    return head;
  },
  basename(p: string): string {
    const norm = p.replace(/[/\\]+$/, "");
    const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
    return idx < 0 ? norm : norm.slice(idx + 1);
  },
  resolve(p: string): string {
    // Already absolute (Node wrappers resolve at the boundary); keep native seps.
    return p;
  },
};

// -----------------------------------------------------------------------------
// File / project detection
// -----------------------------------------------------------------------------

/**
 * Check whether raw CSV text looks like a DLC annotation CSV.
 *
 * Inspects the first four lines for DLC's characteristic header tokens. This is
 * the content-based sniff; the Node wrapper `isDlcFile(path)` reads a file and
 * delegates here.
 */
export function isDlcData(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .slice(0, 4)
    .map((l) => l.trim());
  const content = lines.join("\n").toLowerCase();
  if (content.trim() === "") return false;
  const hasScorer = content.includes("scorer");
  const hasCoords = content.includes("coords");
  const hasXy = content.includes("x") && content.includes("y");
  const hasBodyparts =
    content.includes("bodyparts") ||
    content.includes("animal") ||
    content.includes("individual");
  return hasScorer && hasCoords && hasXy && hasBodyparts;
}

/** Read + sniff a CSV through the injected fs; any read error yields `false`. */
function isDlcFileFs(filename: string, fsys: DlcFileSystem): boolean {
  try {
    return isDlcData(fsys.readTextFile(filename));
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
export function isDlcProjectPath(
  filename: string,
  fsys: DlcFileSystem,
): boolean {
  if (!fsys.exists(filename)) return false;
  if (fsys.isDirectory(filename)) {
    return (
      fsys.exists(posix.join(filename, "config.yaml")) &&
      fsys.exists(posix.join(filename, "labeled-data"))
    );
  }
  if (posix.basename(filename) === "config.yaml" && fsys.isFile(filename)) {
    const cfg = readDlcConfig(filename, fsys);
    return cfg !== null && looksLikeDlcConfig(cfg);
  }
  return false;
}

// -----------------------------------------------------------------------------
// Config parsing and discovery
// -----------------------------------------------------------------------------

export type Config = Record<string, unknown>;

/**
 * Read a DLC project `config.yaml` into a dictionary, or `null` if the file is
 * missing or does not parse to a mapping. A warning is emitted on failure so a
 * malformed/foreign config never breaks plain CSV loading.
 */
export function readDlcConfig(p: string, fsys: DlcFileSystem): Config | null {
  if (!fsys.exists(p) || !fsys.isFile(p)) {
    warn(`DLC config file not found: ${p}`);
    return null;
  }
  let cfg: unknown;
  try {
    cfg = YAML.parse(fsys.readTextFile(p));
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
export function discoverConfig(
  csvPath: string,
  fsys: DlcFileSystem,
  maxLevels = 3,
): string | null {
  const start = posix.dirname(posix.resolve(csvPath));
  const dirs: string[] = [start];
  let cur = start;
  for (let i = 0; i < maxLevels; i += 1) {
    const parent = posix.dirname(cur);
    if (parent === cur) break;
    dirs.push(parent);
    cur = parent;
  }
  for (const d of dirs) {
    const candidate = posix.join(d, "config.yaml");
    if (fsys.exists(candidate) && fsys.isFile(candidate)) {
      const cfg = readDlcConfig(candidate, fsys);
      if (cfg !== null && looksLikeDlcConfig(cfg)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve the `config` argument of {@link readDlc} to a parsed config dict.
 *
 * - `false` disables config entirely (strict legacy output).
 * - `null`/`undefined` auto-discovers `config.yaml` by walking up from the CSV.
 * - a string forces a specific config path.
 */
export function resolveConfig(
  csvPath: string,
  config: string | false | null,
  fsys: DlcFileSystem,
): Config | null {
  if (config === false) return null;
  if (config == null) {
    const discovered = discoverConfig(csvPath, fsys);
    return discovered !== null ? readDlcConfig(discovered, fsys) : null;
  }
  return readDlcConfig(config, fsys);
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

  // Mirror Python `int(float(token))`: a token must parse *fully* as a number;
  // partial tokens like "10abc" must be rejected (Python's `float("10abc")`
  // raises), unlike JS `parseFloat`, which would accept the leading "10".
  const nums: number[] = [];
  for (const p of parts) {
    if (typeof p === "number") {
      if (!Number.isFinite(p)) return null;
      nums.push(Math.trunc(p));
      continue;
    }
    const s = String(p).trim();
    // Full-string numeric match (int/float, optional sign/exponent).
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    nums.push(Math.trunc(v));
  }
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
  fsys: DlcFileSystem,
  searchPaths?: string[],
): { path: string; rect: [number, number, number, number] | null } | null {
  const entry = stemMap.get(folderName);
  if (entry === undefined) return null;
  const { original, rect } = entry;

  let resolvedPath = original;
  if (searchPaths?.length) {
    const basename = original.replace(/\\/g, "/").split("/").pop() ?? original;
    for (const dir of searchPaths) {
      const candidate = posix.join(dir, basename);
      if (fsys.exists(candidate)) {
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

export interface DlcDataframe {
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
export function readDlcDataframe(
  filename: string,
  fsys: DlcFileSystem,
): DlcDataframe {
  const raw = fsys.readTextFile(filename).split(/\r?\n/);
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
  const base = posix.basename(imgPath);
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
  return posix.basename(posix.dirname(imgPath)) || "default";
}

// -----------------------------------------------------------------------------
// Single-CSV loading
// -----------------------------------------------------------------------------

export interface ReadDlcOptions {
  /** The injected filesystem seam (required). */
  fs: DlcFileSystem;
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
 * Load DeepLabCut annotations from a single CSV file, reading through an
 * injected {@link DlcFileSystem}.
 *
 * @param filename Path to a DLC CSV file (within `options.fs`).
 * @param options Loader options ({@link ReadDlcOptions}); `fs` is required.
 * @returns A {@link Labels} object with the loaded data.
 */
export function readDlc(filename: string, options: ReadDlcOptions): Labels {
  const fsys = options.fs;
  const cfg = resolveConfig(filename, options.config ?? null, fsys);
  return loadDlcCsv(filename, {
    fs: fsys,
    config: cfg,
    videoSearchPaths: options.videoSearchPaths,
  });
}

interface LoadDlcCsvOpts {
  fs: DlcFileSystem;
  config: Config | null;
  videoSearchPaths?: string[];
  /** Shared skeleton (project load) — skips structure parsing + edge attach. */
  skeleton?: Skeleton;
  /** Shared tracks (project load). */
  tracks?: Track[];
}

/** Core single-CSV pipeline. Returns a {@link Labels}. */
function loadDlcCsv(filename: string, opts: LoadDlcCsvOpts): Labels {
  const fsys = opts.fs;
  const df = readDlcDataframe(filename, fsys);
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
  const csvDir = posix.dirname(posix.resolve(filename));
  const videos = new Map<string, Video>();
  const sortedVideoPaths = new Map<string, string[]>();
  for (const [videoName, imgPaths] of videoImagePaths) {
    const sortedImgPaths = [...imgPaths].sort(
      (a, b) => (frameMap.get(a) ?? 0) - (frameMap.get(b) ?? 0),
    );
    const actualImageFiles: string[] = [];
    for (const imgPath of sortedImgPaths) {
      const candidates = [
        posix.join(csvDir, imgPath),
        posix.join(csvDir, posix.basename(imgPath)),
        posix.join(posix.dirname(csvDir), imgPath),
      ];
      const found = candidates.find((c) => fsys.exists(c));
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
        fsys,
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

export interface ReadDlcProjectOptions {
  /** The injected filesystem seam (required). */
  fs: DlcFileSystem;
  videoSearchPaths?: string[];
  /** Accepted-and-ignored (PR #488 parity). */
  [key: string]: unknown;
}

/** Resolve a project argument to a `config.yaml` path. */
export function resolveProjectConfigPath(
  config: string,
  fsys: DlcFileSystem,
): string {
  if (fsys.exists(config) && fsys.isDirectory(config)) {
    const candidate = posix.join(config, "config.yaml");
    if (fsys.exists(candidate) && fsys.isFile(candidate)) {
      return candidate;
    }
    throw new Error(`No config.yaml found in DLC project directory: ${config}`);
  }
  return config;
}

/** Find per-video annotation CSVs under `labeled-data/`. */
export function findProjectCsvs(
  projectDir: string,
  scorer: string | null,
  fsys: DlcFileSystem,
): Array<[string, string]> {
  const labeledDir = posix.join(projectDir, "labeled-data");
  const folders: Array<[string, string]> = [];
  if (!fsys.exists(labeledDir) || !fsys.isDirectory(labeledDir)) {
    return folders;
  }
  const subs = fsys.readDir(labeledDir).sort();
  for (const sub of subs) {
    const subDir = posix.join(labeledDir, sub);
    if (!fsys.isDirectory(subDir)) continue;
    let csv = posix.join(subDir, `CollectedData_${scorer}.csv`);
    if (!fsys.exists(csv) || !fsys.isFile(csv)) {
      // Fall back to any DLC-looking CSV in the folder (sorted).
      const candidates = fsys
        .readDir(subDir)
        .filter((f) => f.endsWith(".csv"))
        .sort()
        .map((f) => posix.join(subDir, f))
        .filter((c) => isDlcFileFs(c, fsys));
      if (candidates.length === 0) continue;
      csv = candidates[0];
    }
    folders.push([sub, csv]);
  }
  return folders;
}

/**
 * Load an entire DeepLabCut project from its `config.yaml`, reading through an
 * injected {@link DlcFileSystem}.
 *
 * @param config Path to a `config.yaml`, or to a project directory with one.
 * @param options Loader options ({@link ReadDlcProjectOptions}); `fs` required.
 * @returns A {@link Labels} object with frames from every labeled video.
 */
export function readDlcProject(
  config: string,
  options: ReadDlcProjectOptions,
): Labels {
  const fsys = options.fs;
  const videoSearchPaths = options.videoSearchPaths;
  const configPath = resolveProjectConfigPath(config, fsys);
  const cfg = readDlcConfig(configPath, fsys);
  if (cfg === null) {
    throw new Error(`Could not read DLC config: ${configPath}`);
  }

  const projectDir = posix.dirname(configPath);
  const scorer = (cfg.scorer as string | undefined) ?? null;
  const folders = findProjectCsvs(projectDir, scorer, fsys);
  if (folders.length === 0) {
    throw new Error(
      `No DLC annotation CSVs found under ${posix.join(projectDir, "labeled-data")}`,
    );
  }

  // Build a single shared skeleton and track list across all videos.
  const nodeNames: string[] = [];
  const trackNames: string[] = [];
  for (const [, csv] of folders) {
    const df = readDlcDataframe(csv, fsys);
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
      fs: fsys,
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
