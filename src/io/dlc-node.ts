/**
 * DeepLabCut (DLC) format I/O — Node file-path wrappers + train/test splits.
 *
 * Node-only companion to the browser-safe `dlc.ts` core (mirrors the
 * `coco.ts` / `coco-node.ts` split). This module:
 *
 * - supplies a real-`fs` {@link DlcFileSystem} adapter and re-exposes the core
 *   readers as path-based `loadDlc` / `loadDlcProject` (plus fs-backed
 *   `isDlcFile` / `readDlcConfig` / `discoverConfig` / `isDlcProjectPath`);
 * - implements `loadDlcSplits`, which recovers a DLC project's train/test
 *   partition from its `Documentation_data-*.pickle` — this needs a Python
 *   pickle decoder built on `Buffer`, so it lives here and never enters the
 *   browser bundle.
 *
 * Exported only from the Node entry point (`src/index.ts`), never the browser
 * bundle (`src/index.browser.ts` exports the `dlc.ts` core).
 */

import * as fs from "fs";
import * as path from "path";

import { Labels } from "../model/labels.js";
import { LabelsSet } from "../model/labels-set.js";
import {
  warn,
  readDlc,
  readDlcProject,
  isDlcData,
  isDlcProjectPath as coreIsDlcProjectPath,
  readDlcConfig as coreReadDlcConfig,
  discoverConfig as coreDiscoverConfig,
  readDlcDataframe,
  findProjectCsvs,
  resolveProjectConfigPath,
  videoSetsStemMap,
  type Config,
  type DlcFileSystem,
} from "./dlc.js";

// Re-export the browser-safe core + pure helpers so the Node entry point
// (which exports only this module for DLC) exposes the full public API.
export {
  readDlc,
  readDlcProject,
  isDlcData,
  parseDlcCrop,
  looksLikeDlcConfig,
  attachConfigSkeleton,
  videoSetsStemMap,
  extractFrameIndex,
  resolveConfig,
  setSourceVideo,
  findProjectCsvs,
  resolveProjectConfigPath,
  readDlcDataframe,
} from "./dlc.js";
export type {
  DlcFileSystem,
  Config,
  ReadDlcOptions,
  ReadDlcProjectOptions,
  DlcDataframe,
} from "./dlc.js";

// -----------------------------------------------------------------------------
// Real-fs adapter
// -----------------------------------------------------------------------------

/** A {@link DlcFileSystem} backed by the Node `fs` module. */
export const nodeDlcFileSystem: DlcFileSystem = {
  exists: (p) => fs.existsSync(p),
  isFile: (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  isDirectory: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readTextFile: (p) => fs.readFileSync(p, "utf-8"),
  readDir: (p) => fs.readdirSync(p),
};

// -----------------------------------------------------------------------------
// Node path-based wrappers (bind the real fs; resolve inputs to absolute so the
// core's cwd-free POSIX path helper behaves like Node's `path.resolve`).
// -----------------------------------------------------------------------------

export interface LoadDlcOptions {
  videoSearchPaths?: string[];
  config?: string | false | null;
  /** Accepted-and-ignored (PR #488 parity): openVideos, lazy, etc. */
  [key: string]: unknown;
}

/** Load DeepLabCut annotations from a single CSV file on disk. */
export function loadDlc(filename: string, options?: LoadDlcOptions): Labels {
  return readDlc(path.resolve(filename), {
    fs: nodeDlcFileSystem,
    videoSearchPaths: options?.videoSearchPaths,
    config: options?.config ?? null,
  });
}

export interface LoadDlcProjectOptions {
  videoSearchPaths?: string[];
  /** Accepted-and-ignored (PR #488 parity). */
  [key: string]: unknown;
}

/** Load an entire DeepLabCut project from its `config.yaml` on disk. */
export function loadDlcProject(
  config: string,
  options?: LoadDlcProjectOptions,
): Labels {
  return readDlcProject(path.resolve(config), {
    fs: nodeDlcFileSystem,
    videoSearchPaths: options?.videoSearchPaths,
  });
}

/**
 * Check if a file on disk appears to be a DLC annotation CSV. Reads the file
 * and delegates the header sniff to {@link isDlcData}; any read error (missing/
 * empty file) yields `false`.
 */
export function isDlcFile(filename: string): boolean {
  try {
    return isDlcData(fs.readFileSync(filename, "utf-8"));
  } catch {
    return false;
  }
}

/** Read a DLC project `config.yaml` on disk into a dictionary (or `null`). */
export function readDlcConfig(p: string): Config | null {
  return coreReadDlcConfig(p, nodeDlcFileSystem);
}

/** Search upward from a CSV on disk for a DLC project `config.yaml`. */
export function discoverConfig(csvPath: string, maxLevels = 3): string | null {
  return coreDiscoverConfig(
    path.resolve(csvPath),
    nodeDlcFileSystem,
    maxLevels,
  );
}

/** Whether a path on disk refers to a DLC project directory or `config.yaml`. */
export function isDlcProjectPath(filename: string): boolean {
  return coreIsDlcProjectPath(filename, nodeDlcFileSystem);
}

// -----------------------------------------------------------------------------
// Training-set splits (Node-only: decodes a Python pickle via `Buffer`)
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

/**
 * Read train/test positional indices from a DLC Documentation pickle.
 *
 * The pickle is a 4-element list `[data, trainIndices, testIndices,
 * trainFraction]`. `trainIndices` (`meta[1]`) and `testIndices` (`meta[2]`) are
 * the only elements consumed. Real DeepLabCut writes these as numpy integer
 * ndarrays (decoded by {@link readPickle} into {@link NumpyArray}); a
 * hand-rolled writer may instead emit plain Python `list[int]`. Both are
 * supported here; the `-1` padding sentinel (from `enforce_train_fraction`) is
 * filtered out, mirroring Python `_read_dlc_split`.
 */
export function readDlcSplit(picklePath: string): [number[], number[]] {
  const buf = fs.readFileSync(picklePath);
  const meta = readPickle(buf) as unknown[];
  return [extractIndexArray(meta[1]), extractIndexArray(meta[2])];
}

/**
 * Coerce a decoded pickle value (a numpy int {@link NumpyArray} or a plain
 * `number[]`) into a list of positional indices, dropping `-1` sentinels and
 * any non-finite entries.
 */
function extractIndexArray(value: unknown): number[] {
  const raw = value instanceof NumpyArray ? value.values : value;
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => Number(i)).filter((i) => i !== -1 && !Number.isNaN(i));
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
    for (const [folder, csv] of findProjectCsvs(
      projectDir,
      scorer,
      nodeDlcFileSystem,
    )) {
      included.push([folder, csv]);
    }
  }

  const merged: Array<[string, string]> = [];
  for (const [, csv] of included) {
    const df = readDlcDataframe(csv, nodeDlcFileSystem);
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
  const configPath = resolveProjectConfigPath(
    path.resolve(config),
    nodeDlcFileSystem,
  );
  const cfg = coreReadDlcConfig(configPath, nodeDlcFileSystem);
  if (cfg === null) {
    throw new Error(`Could not read DLC config: ${configPath}`);
  }
  const projectDir = path.dirname(configPath);

  // Load the full project, then partition its frames into train/test.
  const labels = readDlcProject(configPath, {
    fs: nodeDlcFileSystem,
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
  const SEP = " ";
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
// Minimal Python pickle reader (protocols 2-5), with numpy int-array decoding
// -----------------------------------------------------------------------------

/** Placeholder for callables/classes reached via GLOBAL/STACK_GLOBAL. */
class PickleGlobalRef {
  constructor(
    public module: string,
    public name: string,
  ) {}
}

/**
 * Decoded `numpy.dtype` descriptor (enough to interpret an int ndarray's raw
 * bytes). Built from the dtype-name string (e.g. `"i8"`, `"<i4"`, `"u2"`) seen
 * in the dtype reduction; `byteorder` may later be refined by the dtype BUILD
 * state (`"<"`, `">"`, `"="`, `"|"`).
 */
class NumpyDtype {
  kind: string; // "i" (signed), "u" (unsigned), "f" (float), etc.
  itemsize: number; // bytes per element
  littleEndian: boolean;

  constructor(name: string) {
    // Names look like "i8" / "<i4" / ">u2" / "=f8". A leading byteorder char is
    // optional; the trailing digits are the itemsize in bytes.
    let s = name;
    let little = true;
    if (
      s.length > 0 &&
      (s[0] === "<" || s[0] === ">" || s[0] === "=" || s[0] === "|")
    ) {
      little = s[0] !== ">";
      s = s.slice(1);
    }
    this.kind = s.length > 0 ? s[0] : "i";
    const size = parseInt(s.slice(1), 10);
    this.itemsize = Number.isNaN(size) ? 8 : size;
    this.littleEndian = little;
  }
}

/**
 * A decoded numpy integer ndarray, reduced to a flat JS `number[]` of its
 * values. DLC's `trainIndices`/`testIndices` are 1-D int arrays, so only the
 * flat values are retained (shape is not needed by the split reader).
 */
class NumpyArray {
  constructor(public values: number[]) {}
}

/** Coerce a value that may be a `Buffer`/bytes/latin1-string into a `Buffer`. */
function asByteBuffer(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === "string") return Buffer.from(raw, "latin1");
  return null;
}

/**
 * Decode a contiguous little/big-endian integer buffer into a `number[]`
 * according to a numpy dtype. Handles 1/2/4/8-byte signed and unsigned ints
 * (the dtypes numpy uses for DLC split-index arrays across platforms).
 */
function decodeIntBuffer(buf: Buffer, dtype: NumpyDtype): number[] {
  const { itemsize, kind, littleEndian } = dtype;
  const signed = kind === "i";
  const out: number[] = [];
  const n = Math.floor(buf.length / itemsize);
  for (let i = 0; i < n; i += 1) {
    const off = i * itemsize;
    let v: number;
    switch (itemsize) {
      case 1:
        v = signed ? buf.readInt8(off) : buf.readUInt8(off);
        break;
      case 2:
        v = littleEndian
          ? signed
            ? buf.readInt16LE(off)
            : buf.readUInt16LE(off)
          : signed
            ? buf.readInt16BE(off)
            : buf.readUInt16BE(off);
        break;
      case 4:
        v = littleEndian
          ? signed
            ? buf.readInt32LE(off)
            : buf.readUInt32LE(off)
          : signed
            ? buf.readInt32BE(off)
            : buf.readUInt32BE(off);
        break;
      case 8: {
        const big = littleEndian
          ? signed
            ? buf.readBigInt64LE(off)
            : buf.readBigUInt64LE(off)
          : signed
            ? buf.readBigInt64BE(off)
            : buf.readBigUInt64BE(off);
        v = Number(big);
        break;
      }
      default:
        // Unknown width: cannot decode reliably; bail with what we have.
        return out;
    }
    out.push(v);
  }
  return out;
}

/**
 * Build a {@link NumpyArray} from a numpy `_frombuffer`/`_reconstruct`+state
 * payload: a raw byte buffer plus its dtype. Returns `null` if the dtype is not
 * an integer dtype we can decode (the split reader only needs int arrays).
 */
function buildNumpyArray(rawdata: unknown, dtype: unknown): NumpyArray | null {
  if (!(dtype instanceof NumpyDtype)) return null;
  if (dtype.kind !== "i" && dtype.kind !== "u") return null;
  const buf = asByteBuffer(rawdata);
  if (buf === null) return null;
  return new NumpyArray(decodeIntBuffer(buf, dtype));
}

/**
 * Decode a Python pickle into JS values, supporting the subset of opcodes
 * needed for DLC's `Documentation_data-*.pickle`: a shallow
 * `[data, trainIndices, testIndices, trainFraction]` list. `trainIndices` /
 * `testIndices` may be plain Python `list[int]` (as a hand-rolled writer emits)
 * **or** numpy integer ndarrays — which is what real DeepLabCut writes, since
 * `SplitTrials` slices `np.random.permutation(...)` and `save_metadata` pickles
 * the resulting `np.ndarray`s without a `list()` conversion.
 *
 * Numpy arrays are decoded via two reductions:
 *   - modern numpy (1.17+/2.x): `numpy[._]core.numeric._frombuffer(rawbytes,
 *     dtype, shape, order)` — a single `REDUCE`, with `rawbytes` carried by a
 *     `BYTEARRAY8` opcode;
 *   - older numpy: `numpy.core.multiarray._reconstruct(...)` + `BUILD` with
 *     state `(version, shape, dtype, fortran_order, rawdata)`, where `rawdata`
 *     is often a `_codecs.encode(latin1str, 'latin1')` bytes reduction.
 * The `numpy.dtype(name, ...)` reduction is decoded to a {@link NumpyDtype} so
 * the raw bytes can be interpreted (int8/16/32/64, signed/unsigned, byteorder).
 *
 * The DLC split reader only consumes `meta[1]` / `meta[2]`; the lossy `data`
 * payload need not be perfectly reconstructed, so any unrecognized reduction is
 * returned as an opaque marker object.
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
      // numpy.dtype(name, align, copy) -> a decodable dtype descriptor.
      if (func.module.startsWith("numpy") && func.name === "dtype") {
        const name = args[0];
        if (typeof name === "string") return new NumpyDtype(name);
        return { __reduce__: [func.module, func.name], args };
      }
      // Modern numpy: _frombuffer(rawbytes, dtype, shape, order) -> ndarray.
      if (func.module.startsWith("numpy") && func.name === "_frombuffer") {
        const arr = buildNumpyArray(args[0], args[1]);
        if (arr !== null) return arr;
      }
      // Older numpy: _reconstruct(cls, shape, prototype) yields a bare ndarray
      // whose data arrives later via BUILD state; mark it for `build`.
      if (
        func.module.startsWith("numpy") &&
        (func.name === "_reconstruct" || func.name === "ndarray")
      ) {
        return { __numpy__: true } as Record<string, unknown>;
      }
      // _codecs.encode(latin1str, "latin1") -> raw bytes Buffer.
      if (func.module === "_codecs" && func.name === "encode") {
        const buf = asByteBuffer(args[0]);
        if (buf !== null) return buf;
      }
      return { __reduce__: [func.module, func.name], args };
    }
    return { __reduce__: func, args };
  };

  const build = (obj: unknown, state: unknown): unknown => {
    // numpy.dtype BUILD: state is (endian, ...); refine byteorder if present.
    if (obj instanceof NumpyDtype) {
      if (Array.isArray(state) && typeof state[1] === "string") {
        const bo = state[1];
        if (bo === ">") obj.littleEndian = false;
        else if (bo === "<" || bo === "=") obj.littleEndian = true;
      }
      return obj;
    }
    // ndarray BUILD: state is (version, shape, dtype, fortran_order, rawdata).
    if (
      obj &&
      typeof obj === "object" &&
      (obj as Record<string, unknown>).__numpy__
    ) {
      if (Array.isArray(state)) {
        const rawdata = state[state.length - 1];
        const dtype = state.length >= 3 ? state[2] : undefined;
        const arr = buildNumpyArray(rawdata, dtype);
        if (arr !== null) return arr;
        // Couldn't decode (non-int / unknown dtype); keep an opaque marker.
        (obj as Record<string, unknown>).rawdata = rawdata;
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
      case 0x96: {
        // BYTEARRAY8 (8-byte length) — protocol 5; numpy's _frombuffer raw data
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
