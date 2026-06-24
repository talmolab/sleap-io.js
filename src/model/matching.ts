/**
 * Unified matcher system for comparing and matching data structures during merging.
 *
 * TypeScript port of Python `sleap_io/model/matching.py` (pinned @ 054cce39f).
 * PART 1 implements the six enums (+ validators), the result/error types, the
 * progress-bar stub, and the module-level helper functions (video file/shape/
 * pose/image matching). The four matcher classes and preconfigured singletons
 * are added in PART 2.
 *
 * Identity policy (ARCHITECTURE §9): all model objects compare by reference
 * (`===`) and are used directly as `Map`/`Set` keys. Value comparison happens
 * ONLY through the named `.matches*` / `samePoseAs` / etc. methods. Maps preserve
 * insertion order. Exact-type discrimination uses `x.constructor === Instance` /
 * `=== PredictedInstance` (mirrors Python `type(x) is ...`).
 */

import { Instance, PredictedInstance, Track } from "./instance.js";
import { Skeleton } from "./skeleton.js";
import { Video } from "./video.js";
import type { LabeledFrame } from "./labeled-frame.js";
import type { Labels } from "./labels.js";
import type { VideoFrame } from "../video/backend.js";

// =============================================================================
// Enums (matching.py:34-135)
//
// Each Python enum is `class X(str, Enum)` where each member IS its lowercase
// string value (e.g. `SkeletonMatchMethod.EXACT == "exact"`). We model each as a
// `const` object mapping MEMBER -> string value plus a string-literal union, so a
// bare string and a "member" are interchangeable under `===`.
// =============================================================================

/** Methods for matching skeletons (matching.py:34-47). */
export const SkeletonMatchMethod = {
  EXACT: "exact",
  STRUCTURE: "structure",
  OVERLAP: "overlap",
  SUBSET: "subset",
} as const;
export type SkeletonMatchMethod =
  (typeof SkeletonMatchMethod)[keyof typeof SkeletonMatchMethod];

/** Methods for matching instances (matching.py:50-61). */
export const InstanceMatchMethod = {
  SPATIAL: "spatial",
  IDENTITY: "identity",
  IOU: "iou",
} as const;
export type InstanceMatchMethod =
  (typeof InstanceMatchMethod)[keyof typeof InstanceMatchMethod];

/** Methods for matching tracks (matching.py:64-73). */
export const TrackMatchMethod = {
  NAME: "name",
  IDENTITY: "identity",
} as const;
export type TrackMatchMethod =
  (typeof TrackMatchMethod)[keyof typeof TrackMatchMethod];

/** Methods for matching videos (matching.py:76-99). */
export const VideoMatchMethod = {
  PATH: "path",
  BASENAME: "basename",
  CONTENT: "content",
  AUTO: "auto",
  IMAGE_DEDUP: "image_dedup",
  SHAPE: "shape",
} as const;
export type VideoMatchMethod =
  (typeof VideoMatchMethod)[keyof typeof VideoMatchMethod];

/** Strategies for handling frame merging (matching.py:102-121). */
export const FrameStrategy = {
  AUTO: "auto",
  KEEP_ORIGINAL: "keep_original",
  KEEP_NEW: "keep_new",
  KEEP_BOTH: "keep_both",
  UPDATE_TRACKS: "update_tracks",
  REPLACE_PREDICTIONS: "replace_predictions",
} as const;
export type FrameStrategy = (typeof FrameStrategy)[keyof typeof FrameStrategy];

/** Error handling modes for merge operations (matching.py:124-135). */
export const ErrorMode = {
  CONTINUE: "continue",
  STRICT: "strict",
  WARN: "warn",
} as const;
export type ErrorMode = (typeof ErrorMode)[keyof typeof ErrorMode];

// -----------------------------------------------------------------------------
// Enum validator helpers — coerce a string to the enum value, THROW on unknown.
// These mirror the attrs converter `X(x)` which raises `ValueError` on a bad
// string. The public merge()/match() API uses them so passing a bogus method
// string fails fast (BEFORE the merge try-block, so it propagates).
// -----------------------------------------------------------------------------

function coerceEnum<T extends Record<string, string>>(
  enumObj: T,
  value: string,
  label: string,
): T[keyof T] {
  for (const member in enumObj) {
    if (enumObj[member] === value) {
      return enumObj[member] as T[keyof T];
    }
  }
  // Mirror Python's `ValueError("'bogus' is not a valid X")`.
  throw new Error(`'${value}' is not a valid ${label}`);
}

/** Coerce a string to a {@link SkeletonMatchMethod}; throws on unknown. */
export function toSkeletonMatchMethod(value: string): SkeletonMatchMethod {
  return coerceEnum(SkeletonMatchMethod, value, "SkeletonMatchMethod");
}

/** Coerce a string to an {@link InstanceMatchMethod}; throws on unknown. */
export function toInstanceMatchMethod(value: string): InstanceMatchMethod {
  return coerceEnum(InstanceMatchMethod, value, "InstanceMatchMethod");
}

/** Coerce a string to a {@link TrackMatchMethod}; throws on unknown. */
export function toTrackMatchMethod(value: string): TrackMatchMethod {
  return coerceEnum(TrackMatchMethod, value, "TrackMatchMethod");
}

/** Coerce a string to a {@link VideoMatchMethod}; throws on unknown. */
export function toVideoMatchMethod(value: string): VideoMatchMethod {
  return coerceEnum(VideoMatchMethod, value, "VideoMatchMethod");
}

/** Coerce a string to an {@link ErrorMode}; throws on unknown. */
export function toErrorMode(value: string): ErrorMode {
  return coerceEnum(ErrorMode, value, "ErrorMode");
}

// =============================================================================
// Result & error types (matching.py:1150-1388)
// =============================================================================

/**
 * Information about a conflict that was resolved during merging
 * (matching.py:1150-1170). Plain data record; equality is not exercised.
 *
 * Only two `conflictType` values are emitted: `"instance_conflict"` and
 * `"negative_flag_conflict"`.
 */
export class ConflictResolution {
  frame: LabeledFrame;
  conflictType: string;
  originalData: unknown;
  newData: unknown;
  resolution: string;

  constructor(
    frame: LabeledFrame,
    conflictType: string,
    originalData: unknown,
    newData: unknown,
    resolution: string,
  ) {
    this.frame = frame;
    this.conflictType = conflictType;
    this.originalData = originalData;
    this.newData = newData;
    this.resolution = resolution;
  }
}

/**
 * Base exception for merge errors (matching.py:1173-1183).
 *
 * `details` is a FRESH `{}` per instance (never a shared module object).
 */
export class MergeError extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MergeError";
    // Fresh object per instance when not supplied.
    this.details = details ?? {};
    // Restore the prototype chain so `instanceof MergeError` holds even under
    // older transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when skeletons don't match during merge (matching.py:1186-1189).
 *
 * Extends {@link MergeError} with no new fields/methods; `instanceof MergeError`
 * MUST hold so a single `catch (e) { if (e instanceof MergeError) ... }`
 * captures both.
 */
export class SkeletonMismatchError extends MergeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = "SkeletonMismatchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Result of a merge operation (matching.py:1192-1242).
 *
 * `merge()` never touches `instancesUpdated`/`instancesSkipped` — they stay 0.
 * `conflicts` and `errors` are fresh arrays per instance.
 */
export class MergeResult {
  successful: boolean;
  framesMerged: number;
  instancesAdded: number;
  instancesUpdated: number;
  instancesSkipped: number;
  conflicts: ConflictResolution[];
  errors: MergeError[];

  constructor(
    successful: boolean,
    options: {
      framesMerged?: number;
      instancesAdded?: number;
      instancesUpdated?: number;
      instancesSkipped?: number;
      conflicts?: ConflictResolution[];
      errors?: MergeError[];
    } = {},
  ) {
    this.successful = successful;
    this.framesMerged = options.framesMerged ?? 0;
    this.instancesAdded = options.instancesAdded ?? 0;
    this.instancesUpdated = options.instancesUpdated ?? 0;
    this.instancesSkipped = options.instancesSkipped ?? 0;
    // Fresh arrays per instance.
    this.conflicts = options.conflicts ?? [];
    this.errors = options.errors ?? [];
  }

  /**
   * Generate a human-readable summary of the merge result (matching.py:1214-1242).
   *
   * Byte-exact: U+2713 (checkmark) / U+2717 (ballot X) prefix; 2-space indents
   * for counts, 4-space "- " indents for error lines; optional int lines gated
   * on `!== 0`; list lines gated on `.length > 0`; first-5 errors + overflow
   * line. No trailing newline.
   */
  summary(): string {
    const lines: string[] = [];

    if (this.successful) {
      lines.push("✓ Merge completed successfully");
    } else {
      lines.push("✗ Merge completed with errors");
    }

    lines.push(`  Frames merged: ${this.framesMerged}`);
    lines.push(`  Instances added: ${this.instancesAdded}`);

    if (this.instancesUpdated !== 0) {
      lines.push(`  Instances updated: ${this.instancesUpdated}`);
    }

    if (this.instancesSkipped !== 0) {
      lines.push(`  Instances skipped: ${this.instancesSkipped}`);
    }

    if (this.conflicts.length) {
      lines.push(`  Conflicts resolved: ${this.conflicts.length}`);
    }

    if (this.errors.length) {
      lines.push(`  Errors encountered: ${this.errors.length}`);
      for (const error of this.errors.slice(0, 5)) {
        lines.push(`    - ${error.message}`);
      }
      if (this.errors.length > 5) {
        lines.push(`    ... and ${this.errors.length - 5} more`);
      }
    }

    return lines.join("\n");
  }
}

/**
 * Result of matching two Labels objects (matching.py:1245-1336).
 *
 * Maps are keyed by `other`'s objects (by reference) and store `self`'s objects
 * or `null` on no-match. `Map` preserves insertion order, which the
 * `unmatched*`/`summary()` consumers rely on.
 */
export class MatchResult {
  videoMap: Map<Video, Video | null>;
  skeletonMap: Map<Skeleton, Skeleton | null>;
  trackMap: Map<Track, Track | null>;

  constructor(
    options: {
      videoMap?: Map<Video, Video | null>;
      skeletonMap?: Map<Skeleton, Skeleton | null>;
      trackMap?: Map<Track, Track | null>;
    } = {},
  ) {
    // Fresh maps per instance.
    this.videoMap = options.videoMap ?? new Map();
    this.skeletonMap = options.skeletonMap ?? new Map();
    this.trackMap = options.trackMap ?? new Map();
  }

  /** Videos from `other` that had no match in `self` (insertion order). */
  get unmatchedVideos(): Video[] {
    const out: Video[] = [];
    for (const [v, match] of this.videoMap) {
      if (match == null) out.push(v);
    }
    return out;
  }

  /** Skeletons from `other` that had no match in `self` (insertion order). */
  get unmatchedSkeletons(): Skeleton[] {
    const out: Skeleton[] = [];
    for (const [s, match] of this.skeletonMap) {
      if (match == null) out.push(s);
    }
    return out;
  }

  /** Tracks from `other` that had no match in `self` (insertion order). */
  get unmatchedTracks(): Track[] {
    const out: Track[] = [];
    for (const [t, match] of this.trackMap) {
      if (match == null) out.push(t);
    }
    return out;
  }

  /** True if all videos from `other` were matched (empty map => true). */
  get allVideosMatched(): boolean {
    return this.unmatchedVideos.length === 0;
  }

  /** True if all skeletons from `other` were matched (empty map => true). */
  get allSkeletonsMatched(): boolean {
    return this.unmatchedSkeletons.length === 0;
  }

  /** True if all tracks from `other` were matched (empty map => true). */
  get allTracksMatched(): boolean {
    return this.unmatchedTracks.length === 0;
  }

  /** Number of videos successfully matched (counts `value != null`). */
  get nVideosMatched(): number {
    let n = 0;
    for (const v of this.videoMap.values()) {
      if (v != null) n += 1;
    }
    return n;
  }

  /** Number of skeletons successfully matched (counts `value != null`). */
  get nSkeletonsMatched(): number {
    let n = 0;
    for (const s of this.skeletonMap.values()) {
      if (s != null) n += 1;
    }
    return n;
  }

  /** Number of tracks successfully matched (counts `value != null`). */
  get nTracksMatched(): number {
    let n = 0;
    for (const t of this.trackMap.values()) {
      if (t != null) n += 1;
    }
    return n;
  }

  /**
   * Generate a human-readable summary of the match result (matching.py:1319-1336).
   *
   * Three always-present count lines (no leading space). Only videos get an
   * unmatched listing (first 5 + overflow), 2-space "- " indents. No trailing
   * newline.
   */
  summary(): string {
    const lines: string[] = [];
    lines.push(`Videos: ${this.nVideosMatched}/${this.videoMap.size} matched`);
    lines.push(
      `Skeletons: ${this.nSkeletonsMatched}/${this.skeletonMap.size} matched`,
    );
    lines.push(`Tracks: ${this.nTracksMatched}/${this.trackMap.size} matched`);

    const unmatchedVideos = this.unmatchedVideos;
    if (unmatchedVideos.length) {
      lines.push("Unmatched videos:");
      for (const v of unmatchedVideos.slice(0, 5)) {
        const fn = typeof v.filename === "string" ? v.filename : v.filename[0];
        lines.push(`  - ${fn}`);
      }
      if (unmatchedVideos.length > 5) {
        lines.push(`  ... and ${unmatchedVideos.length - 5} more`);
      }
    }

    return lines.join("\n");
  }
}

/**
 * Presentation-only progress bar stub (matching.py:1339-1388).
 *
 * The only contract that matters for merge output parity is the
 * `callback(current, total, message)` signature `merge()` calls. There is no
 * tqdm in JS, so the bar is a no-op (optionally logs). The context-manager
 * shape is preserved via `[Symbol.dispose]` (for `using`) and explicit `enter`/
 * `exit` methods.
 */
export class MergeProgressBar {
  desc: string;
  leave: boolean;
  pbar: unknown;

  constructor(desc = "Merging", leave = true) {
    this.desc = desc;
    this.leave = leave;
    this.pbar = null;
  }

  /** Context-manager enter: returns self. */
  enter(): this {
    return this;
  }

  /** Context-manager exit: closes the (stub) bar. */
  exit(): void {
    this.pbar = null;
  }

  /** `using` support: dispose closes the (stub) bar. */
  [Symbol.dispose](): void {
    this.exit();
  }

  /**
   * Progress callback for merge operations. Creates the (stub) bar lazily only
   * when `total` is truthy (nonzero), then records absolute progress. No-op
   * presentation.
   */
  callback(current: number, total: number, message = ""): void {
    if (this.pbar == null && total) {
      // Lazily "create" the bar. Stubbed: no tqdm equivalent.
      this.pbar = { total, n: 0, desc: this.desc, leave: this.leave };
    }
    if (this.pbar != null) {
      const bar = this.pbar as { n: number; desc: string };
      bar.desc = message ? `${this.desc}: ${message}` : this.desc;
      bar.n = current;
    }
  }
}

// =============================================================================
// Filesystem resolver injection (DECISIONS D7)
//
// `_fileExists`, `isSameFile`/`_isSameFileDirect`, and `originalVideosConflict`
// need filesystem access. We inject an optional resolver; the default uses Node
// `fs` (loaded lazily via dynamic import so the browser bundle never pulls it).
// In a browser (or whenever no resolver is available), the conservative results
// (`exists -> false`, `sameFile -> false`) land on Python's "don't reject / no
// positive file match" path.
//
// Tests and the Matchers phase can stub the resolver via `setFsResolver()`.
// =============================================================================

/**
 * Abstract filesystem operations needed by the video file helpers. All methods
 * are async. A browser/no-FS environment supplies a resolver whose methods
 * return the conservative answers (or simply leaves the default, which detects
 * the missing `fs` and degrades).
 */
export interface FsResolver {
  /** True if the path exists on disk. */
  exists(path: string): Promise<boolean>;
  /**
   * True if both paths refer to the same file (e.g. via inode `dev`+`ino`).
   * Implementations may throw; callers wrap in try/catch.
   */
  sameFile(path1: string, path2: string): Promise<boolean>;
  /**
   * Canonical absolute path (symlinks resolved when the file exists, else a
   * plain absolute resolution). Used for the resolved-path equality fallback.
   * May throw; callers wrap in try/catch.
   */
  realpath(path: string): Promise<string>;
}

let _fsResolver: FsResolver | null = null;
let _defaultFsResolver: FsResolver | null = null;

/**
 * Override the filesystem resolver (DECISIONS D7). Pass `null` to clear the
 * explicit override and fall back to the registered default — the Node `fs`
 * resolver in Node builds/tests, or none in the browser bundle (which degrades
 * to the conservative "cannot verify" path). Tests use this to inject a stub.
 */
export function setFsResolver(resolver: FsResolver | null): void {
  _fsResolver = resolver;
}

/**
 * Register the DEFAULT FS resolver used when no override is set. Called by the
 * Node-only `node-fs-resolver` module (which the Node entry point and the test
 * setup import). The browser bundle never imports that module, so no `node:fs`
 * reference enters the browser-reachable module graph (issue #70).
 */
export function setDefaultFsResolver(resolver: FsResolver | null): void {
  _defaultFsResolver = resolver;
}

/** The effective FS resolver: the explicit override if set, else the default. */
export function getFsResolver(): FsResolver | null {
  return _fsResolver ?? _defaultFsResolver;
}

// =============================================================================
// Module helper functions — video file/shape helpers (matching.py:143-644)
// =============================================================================

/**
 * Find the root video in the provenance chain (matching.py:143-163):
 * `video.originalVideo ?? video`.
 */
export function _getRootVideo(video: Video): Video {
  return video.originalVideo ?? video;
}

/** Real key-presence check (a stored `null`/`undefined` still counts). */
function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Get the effective shape for comparison purposes (matching.py:531-559).
 *
 * Walks the `sourceVideo` chain NEAREST-FIRST and returns the first known shape
 * along it. An embedded subset's frame count is a view of its source video (e.g.
 * a 27-frame embedded subset of an 80-frame restored original), so the nearest
 * source's full shape is the right identity for shape comparison — even when the
 * deeper chain root has an unknown shape. Recursion bottoms out at the root
 * (`sourceVideo == null`). If no source shape is found, uses a KEY-PRESENCE
 * check on `backendMetadata["shape"]` (returns the stored value AS-IS, even if
 * `null`); else falls back to `video.shape`.
 *
 * This reads only in-memory metadata (no file I/O); the heavier `isSameFile`
 * identity check is reserved for the actual match so that shape stays a
 * permissive pre-filter.
 *
 * PARITY: uses real key-presence (`hasOwnProperty`), NOT truthiness, and does
 * NOT rely on the JS `shape` getter's `??` ordering.
 */
export function _getEffectiveShape(
  video: Video,
): [number, number, number, number] | null {
  // Prefer the nearest source's shape (subset frame counts are a view of it).
  const source = video.sourceVideo;
  if (source != null) {
    const sourceShape = _getEffectiveShape(source);
    if (sourceShape != null) {
      return sourceShape;
    }
  }

  // Try backend_metadata first (for videos with openBackend=false).
  if (hasKey(video.backendMetadata, "shape")) {
    return video.backendMetadata.shape as
      | [number, number, number, number]
      | null;
  }

  // Fall back to the actual shape property.
  return video.shape;
}

/**
 * Check if two videos have compatible shapes (matching.py:558-591).
 *
 * Tri-state for REJECTION-only use: `false` => definitely incompatible (differ
 * on frames, height, OR width); `true` => compatible; `null` => cannot determine
 * (missing metadata). Compares ONLY (frames, height, width) — channels
 * (index 3) are EXCLUDED.
 */
export function shapesCompatible(video1: Video, video2: Video): boolean | null {
  const shape1 = _getEffectiveShape(video1);
  const shape2 = _getEffectiveShape(video2);

  if (shape1 == null || shape2 == null) {
    return null;
  }

  return (
    shape1[0] === shape2[0] && // frames
    shape1[1] === shape2[1] && // height
    shape1[2] === shape2[2] // width
  );
}

/** Basename: final path component, splitting on BOTH "/" and "\\" (D6). */
function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1];
}

/**
 * Deterministic posix-style path normalization (DECISIONS D6). Sanitizes
 * backslashes to forward slashes, collapses repeated slashes, and drops a
 * single trailing slash (but preserves a lone root "/"). URLs are returned
 * unchanged. NOT Node `path` (which is OS-dependent).
 */
export function sanitizeFilename(filename: string): string {
  // Leave URLs untouched (scheme like "http://", "s3://", "file://").
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(filename)) {
    return filename;
  }
  let p = filename.replace(/\\/g, "/");
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Emulate `PurePosixPath(path).parts` regardless of host OS (DECISIONS D6).
 *
 * Absolute (`/...`) => first part `"/"` then segments; relative => segments
 * split on `/`. Does NOT special-case drive letters (`C:/a` => `["C:", "a"]`).
 * Collapses repeated slashes; drops trailing slash. Empty / "/" handled like
 * Python (`""` => `[]`, `"/"` => `["/"]`).
 */
export function posixParts(path: string): string[] {
  if (path === "") return [];
  const isAbsolute = path.startsWith("/");
  // Split on runs of "/", dropping empty segments.
  const segments = path.split("/").filter((seg) => seg !== "");
  if (isAbsolute) {
    return ["/", ...segments];
  }
  return segments;
}

/**
 * Get path parts for a video (matching.py:969-975): resolve to the root video,
 * sanitize its filename (first element for an image-sequence list), and split
 * into posix parts.
 */
export function getPathParts(video: Video): string[] {
  const root = _getRootVideo(video);
  let fn = root.filename;
  if (Array.isArray(fn)) {
    fn = fn[0]; // Use first for ImageVideo.
  }
  return posixParts(sanitizeFilename(fn));
}

/**
 * Check if file(s) exist on disk (matching.py:166-179).
 *
 * List => ALL must exist (`every`); EMPTY list => `true`; scalar => that path
 * exists. Uses the injected FS resolver; browser/no-FS => `false`.
 */
export async function _fileExists(
  filename: string | string[],
): Promise<boolean> {
  const fs = getFsResolver();
  if (fs == null) {
    // Cannot verify: conservative answer.
    return false;
  }
  if (Array.isArray(filename)) {
    for (const f of filename) {
      if (!(await fs.exists(f))) return false;
    }
    return true; // empty list => true
  }
  return fs.exists(filename);
}

/** The dataset path for an HDF5/embedded video, or `null`. */
function videoDataset(video: Video): string | null {
  const fromBackend = video.backend?.dataset;
  if (fromBackend != null) return fromBackend;
  const fromMeta = video.backendMetadata.dataset;
  return typeof fromMeta === "string" ? fromMeta : null;
}

/**
 * Low-level same-file check on ALREADY-ROOTED videos (matching.py:437-504).
 *
 * - Both lists => exact ORDERED element-wise equality.
 * - Exactly one list => `false`.
 * - Both scalar:
 *   1. `samefile` (dev+ino) if BOTH exist (try/catch fall-through);
 *   2. else resolved-path equality (realpath when exists, else absolute
 *      resolve) (try/catch fall-through);
 *   3. else posix-normalized string equality.
 *   If none match => `false`. Then HDF5 dataset disambiguation: if both
 *   backends non-null AND both `dataset` non-null, require `dataset1 ===
 *   dataset2`; else `true`.
 */
export async function _isSameFileDirect(
  video1: Video,
  video2: Video,
): Promise<boolean> {
  const fn1 = video1.filename;
  const fn2 = video2.filename;

  // Handle ImageVideo (list of filenames).
  if (Array.isArray(fn1) && Array.isArray(fn2)) {
    if (fn1.length !== fn2.length) return false;
    for (let i = 0; i < fn1.length; i += 1) {
      if (fn1[i] !== fn2[i]) return false;
    }
    return true;
  }
  if (Array.isArray(fn1) || Array.isArray(fn2)) {
    return false;
  }

  // Both are single file paths.
  const path1 = fn1 as string;
  const path2 = fn2 as string;
  const fs = getFsResolver();

  let filesMatch = false;

  // 1. os.path.samefile first if both files exist (handles symlinks).
  if (fs != null) {
    try {
      if ((await fs.exists(path1)) && (await fs.exists(path2))) {
        filesMatch = await fs.sameFile(path1, path2);
      }
    } catch {
      // File access failed, fall through to path comparison.
    }
  }

  // 2. Compare resolved paths (handles relative vs absolute).
  if (!filesMatch && fs != null) {
    try {
      if ((await fs.realpath(path1)) === (await fs.realpath(path2))) {
        filesMatch = true;
      }
    } catch {
      // Resolution failed, fall through to string comparison.
    }
  }

  // 3. Final check: posix-normalized string match.
  if (!filesMatch) {
    filesMatch = sanitizeFilename(path1) === sanitizeFilename(path2);
  }

  if (!filesMatch) {
    return false;
  }

  // Files match - now check HDF5 datasets if applicable.
  const backend1 = video1.backend;
  const backend2 = video2.backend;
  if (backend1 != null && backend2 != null) {
    const dataset1 = videoDataset(video1);
    const dataset2 = videoDataset(video2);
    if (dataset1 != null && dataset2 != null) {
      return dataset1 === dataset2;
    }
  }

  return true;
}

/**
 * Return a video's crop rect as an identity key, or `null` (matching.py:507-524).
 *
 * The per-video crop identity used to disambiguate distinct crops (e.g. mosaic
 * tiles) of one underlying source file. Reads the composed source-coordinate
 * crop rect via {@link Video._cropTuple} (which prefers `backend.crop` on an
 * open `CropVideoBackend` and falls back to `backendMetadata["crop"]` when
 * closed). `null` when the video is not cropped (or does not expose
 * `_cropTuple`).
 */
export function _cropKey(
  video: Video,
): [number, number, number, number] | null {
  const fn = (video as { _cropTuple?: () => unknown })._cropTuple;
  if (typeof fn !== "function") {
    return null;
  }
  const crop = fn.call(video);
  return crop != null
    ? ([...(crop as number[])] as [number, number, number, number])
    : null;
}

/** Equality on two crop keys (element-wise; both `null` => equal). */
function _cropKeysEqual(
  key1: [number, number, number, number] | null,
  key2: [number, number, number, number] | null,
): boolean {
  if (key1 == null || key2 == null) {
    return key1 === key2; // both null => equal; one null => unequal
  }
  return (
    key1[0] === key2[0] &&
    key1[1] === key2[1] &&
    key1[2] === key2[2] &&
    key1[3] === key2[3]
  );
}

/**
 * Check if two videos refer to the same underlying file (matching.py:527-559).
 *
 * Resolves both to their chain roots and defers to {@link _isSameFileDirect};
 * then ALSO requires equal crop keys so two distinct crops of one source file
 * (e.g. mosaic tiles) are NOT collapsed into one video. The crop keys are read
 * from the ORIGINAL videos (not the resolved roots): two tiles share one
 * uncropped source whose own crop key is `null`, so the disambiguation must use
 * each video's own crop rect. For non-cropped videos both keys are `null`, so
 * behavior is unchanged.
 */
export async function isSameFile(
  video1: Video,
  video2: Video,
): Promise<boolean> {
  const root1 = _getRootVideo(video1);
  const root2 = _getRootVideo(video2);
  if (!(await _isSameFileDirect(root1, root2))) {
    return false;
  }
  // Same underlying file: distinct crops of it are distinct videos.
  return _cropKeysEqual(_cropKey(video1), _cropKey(video2));
}

/**
 * Check if two videos have conflicting `originalVideo` references
 * (matching.py:594-644). Used for REJECTION.
 *
 * Returns `true` ONLY if ALL of: (a) BOTH have provenance
 * (`originalVideo != null || sourceVideo != null`); (b) their roots are NOT the
 * same file; (c) at least one root file exists (if BOTH missing => `false`).
 * The two existence probes are short-circuited with `&&` (matching Python).
 */
export async function originalVideosConflict(
  video1: Video,
  video2: Video,
): Promise<boolean> {
  const root1 = _getRootVideo(video1);
  const root2 = _getRootVideo(video2);

  const hasProvenance1 =
    video1.originalVideo != null || video1.sourceVideo != null;
  const hasProvenance2 =
    video2.originalVideo != null || video2.sourceVideo != null;

  if (!(hasProvenance1 && hasProvenance2)) {
    // At least one has no provenance - no conflict.
    return false;
  }

  // Both have provenance - check if roots are the same file.
  if (await _isSameFileDirect(root1, root2)) {
    return false; // Definitely same - no conflict.
  }

  // If neither file exists, we can't verify - don't reject.
  // Short-circuit the two existence probes with && (Python parity).
  if (
    !(await _fileExists(root1.filename)) &&
    !(await _fileExists(root2.filename))
  ) {
    return false;
  }

  // At least one file exists and they don't match - conflict.
  return true;
}

/**
 * Check if two videos are the same source file but DIFFERENT crops
 * (matching.py:678-712). Used for REJECTION in the AUTO cascade.
 *
 * The definitive disambiguation for mosaic tiles: two distinct crops of one
 * physical file share a root file (so the file-identity / strict-path / leaf
 * rungs would otherwise collapse them) but have different crop rects, making
 * them genuinely different videos.
 *
 * Returns `true` ONLY when the two videos resolve to the same underlying root
 * file (verifiable identity OR matching root basename) AND their crop keys
 * differ. For non-cropped videos (both keys `null`) this is always `false`, so
 * behavior for non-crop videos is unchanged.
 */
export async function _sameFileDifferentCrop(
  video1: Video,
  video2: Video,
): Promise<boolean> {
  if (_cropKeysEqual(_cropKey(video1), _cropKey(video2))) {
    return false;
  }

  const root1 = _getRootVideo(video1);
  const root2 = _getRootVideo(video2);
  if (await _isSameFileDirect(root1, root2)) {
    return true;
  }

  // Even without verifiable file identity, a shared root basename means the
  // path/leaf rungs could re-match the pair; differing crops still disambiguate.
  const fn1 = root1.filename;
  const fn2 = root2.filename;
  if (Array.isArray(fn1) || Array.isArray(fn2)) {
    return false;
  }
  return basename(fn1) === basename(fn2);
}

// =============================================================================
// Module helper functions — video pose/image helpers
// (matching.py:182-434, 1033-1126)
// =============================================================================

/**
 * Get `frameIdx -> instances` mapping for a video (matching.py:182-212).
 *
 * Iterates `labels.labeledFrames` in order; skips frames whose `lf.video` is not
 * the SAME REFERENCE as `video`; keeps instances where `includePredictions ||
 * !(inst instanceof PredictedInstance)`; adds a frame only if >= 1 instance was
 * kept; last-write-wins on duplicate `frameIdx`.
 */
export function _getFrameInstances(
  labels: Labels,
  video: Video,
  includePredictions: boolean,
): Map<number, Instance[]> {
  const result = new Map<number, Instance[]>();
  for (const lf of labels.labeledFrames) {
    if (lf.video !== video) {
      continue;
    }

    const instances: Instance[] = [];
    for (const inst of lf.instances) {
      if (includePredictions || !(inst instanceof PredictedInstance)) {
        instances.push(inst);
      }
    }

    if (instances.length) {
      result.set(lf.frameIdx, instances); // last-write-wins
    }
  }
  return result;
}

/**
 * Check if a video has any user (non-predicted) instances (matching.py:215-233).
 */
export function _videoHasUserInstances(labels: Labels, video: Video): boolean {
  for (const lf of labels.labeledFrames) {
    if (lf.video !== video) {
      continue;
    }
    for (const inst of lf.instances) {
      if (!(inst instanceof PredictedInstance)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolve `"auto"` comparePredictions to a boolean (matching.py:236-255).
 *
 * `"auto"` => include predictions only if the video has NO user instances. Any
 * other value uses Python truthiness (`Boolean(x)` — non-empty string => true).
 */
export function _resolveComparePredictions(
  comparePredictions: string | boolean,
  labels: Labels,
  video: Video,
): boolean {
  if (comparePredictions === "auto") {
    return !_videoHasUserInstances(labels, video);
  }
  return Boolean(comparePredictions);
}

/**
 * Check if ANY pair of instances has identical poses (matching.py:258-278).
 * Nested loop: A outer, B inner; first identical pair => `true`.
 */
export function _frameHasMatchingPose(
  instancesA: Instance[],
  instancesB: Instance[],
): boolean {
  for (const instA of instancesA) {
    const ptsA = instA.numpy();
    for (const instB of instancesB) {
      const ptsB = instB.numpy();
      if (_posesIdentical(ptsA, ptsB)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if two pose arrays are EXACTLY identical (matching.py:281-311).
 *
 * Core pose tolerance is EXACT equality (NO allclose, NO epsilon):
 * 1. shape mismatch => false;
 * 2. per-cell NaN masks must be equal (cell-by-cell) else false;
 * 3. at least one non-NaN cell required (all-NaN never matches);
 * 4. the non-NaN values compared with strict `===` (`0 === -0` is true).
 */
export function _posesIdentical(ptsA: number[][], ptsB: number[][]): boolean {
  // 1. Shape mismatch (rows or per-row columns).
  if (ptsA.length !== ptsB.length) return false;
  for (let i = 0; i < ptsA.length; i += 1) {
    if (ptsA[i].length !== ptsB[i].length) return false;
  }

  // 2. Same NaN pattern, AND collect non-NaN equality result inline.
  let anyValid = false;
  for (let i = 0; i < ptsA.length; i += 1) {
    for (let j = 0; j < ptsA[i].length; j += 1) {
      const aNaN = Number.isNaN(ptsA[i][j]);
      const bNaN = Number.isNaN(ptsB[i][j]);
      if (aNaN !== bNaN) return false;
      if (!aNaN) {
        anyValid = true;
        // 4. Valid points must be exactly equal.
        if (ptsA[i][j] !== ptsB[i][j]) return false;
      }
    }
  }

  // 3. Must have at least some valid points.
  if (!anyValid) return false;

  return true;
}

/**
 * Sample frame indices evenly if too many, else return all (matching.py:314-329).
 *
 * Sorts ascending; if `<= maxSamples` returns all; else `step =
 * len / maxSamples` (TRUE float division) and picks
 * `list[Math.trunc(i * step)]` for `i` in `0..maxSamples-1`.
 */
export function _sampleFrameIndices(
  indices: Set<number> | Iterable<number>,
  maxSamples: number,
): number[] {
  const list = [...indices].sort((a, b) => a - b);
  if (list.length <= maxSamples) {
    return list;
  }
  const step = list.length / maxSamples; // true float division
  const out: number[] = [];
  for (let i = 0; i < maxSamples; i += 1) {
    out.push(list[Math.trunc(i * step)]);
  }
  return out;
}

/**
 * Get frame indices embedded in a video, or `null` (matching.py:332-351).
 *
 * No backend => `null`; `backend.embedded_frame_inds` present & non-null =>
 * `[...it]`; else a non-empty `frame_map` => `[...keys]`; else `null`.
 * PARITY: an EMPTY `frame_map` yields `null` (not `[]`).
 */
export function _getEmbeddedFrameIndices(video: Video): number[] | null {
  const backend = video.backend as
    | {
        embedded_frame_inds?: Iterable<number> | null;
        frame_map?: Map<number, unknown> | Record<number, unknown> | null;
      }
    | null
    | undefined;
  if (backend == null) {
    return null;
  }
  if ("embedded_frame_inds" in backend && backend.embedded_frame_inds != null) {
    return [...backend.embedded_frame_inds];
  }
  if ("frame_map" in backend && backend.frame_map) {
    const fm = backend.frame_map;
    const keys =
      fm instanceof Map
        ? [...fm.keys()]
        : Object.keys(fm).map((k) => Number(k));
    // A non-empty frame_map yields its keys; an empty map is falsy above.
    if (keys.length) {
      return keys;
    }
    return null;
  }
  return null;
}

/**
 * Get frame indices embedded in BOTH videos (matching.py:354-370). If either
 * side is `null`, returns an empty set; else the set intersection.
 */
export function _getCommonEmbeddedIndices(
  video1: Video,
  video2: Video,
): Set<number> {
  const inds1 = _getEmbeddedFrameIndices(video1);
  const inds2 = _getEmbeddedFrameIndices(video2);

  if (inds1 == null || inds2 == null) {
    return new Set();
  }

  const set2 = new Set(inds2);
  const out = new Set<number>();
  for (const i of inds1) {
    if (set2.has(i)) out.add(i);
  }
  return out;
}

/**
 * Convert a frame to a grayscale Float32 [0, 1] HxW image (matching.py:409-434).
 *
 * Mirrors the ndim/channel cascade: ndim 2 (single-channel) => cast; ndim 3
 * with ch==1 => channel 0; ch>=3 => BT.601 `0.299R + 0.587G + 0.114B` (channels
 * 0,1,2; alpha ignored); ch==2 => channel 0; else => throw. Then divides by
 * 255. No resize/downsample.
 *
 * In JS the structured frame type is `ImageData` (RGBA, 4 channels). A bare
 * `Uint8Array`/`ArrayBuffer` carries no shape, so it falls to the throw branch
 * (which `_framesSimilarByImage` catches => `false`, matching "ANY exception").
 */
export function _toGrayscaleFloat(frame: VideoFrame): {
  width: number;
  height: number;
  data: Float32Array;
} {
  // Only ImageData carries width/height + per-channel pixel data.
  const img = frame as {
    width?: number;
    height?: number;
    data?: ArrayLike<number>;
  };
  if (
    typeof img.width === "number" &&
    typeof img.height === "number" &&
    img.data != null
  ) {
    const width = img.width;
    const height = img.height;
    const src = img.data;
    const n = width * height;
    // ImageData is always RGBA (4 channels) => ch >= 3 branch (BT.601).
    const channels = src.length / n;
    const out = new Float32Array(n);
    if (channels === 1) {
      for (let i = 0; i < n; i += 1) {
        out[i] = src[i] / 255.0;
      }
    } else if (channels >= 3) {
      for (let i = 0; i < n; i += 1) {
        const base = i * channels;
        const r = src[base];
        const g = src[base + 1];
        const b = src[base + 2];
        out[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
      }
    } else if (channels === 2) {
      for (let i = 0; i < n; i += 1) {
        out[i] = src[i * 2] / 255.0;
      }
    } else {
      throw new Error(
        `Unexpected frame shape: [${height}, ${width}, ${channels}]`,
      );
    }
    return { width, height, data: out };
  }

  // No structured shape available.
  throw new Error("Unexpected frame shape: <unstructured frame>");
}

/**
 * Check if two videos' frames are similar by image content (matching.py:373-406).
 *
 * Decodes both frames, converts to grayscale float; if shapes differ => false;
 * `mean(abs(diff)) <= threshold` (inclusive). ANY exception (including decode
 * failures or unstructured frames) => `false`.
 */
export async function _framesSimilarByImage(
  video1: Video,
  video2: Video,
  frameIdx: number,
  threshold: number,
): Promise<boolean> {
  try {
    const frame1 = await video1.getFrame(frameIdx);
    const frame2 = await video2.getFrame(frameIdx);
    if (frame1 == null || frame2 == null) {
      return false;
    }

    const gray1 = _toGrayscaleFloat(frame1);
    const gray2 = _toGrayscaleFloat(frame2);

    if (gray1.width !== gray2.width || gray1.height !== gray2.height) {
      return false;
    }

    const n = gray1.data.length;
    if (n === 0) {
      // mean of empty is NaN in numpy; NaN <= threshold is false.
      return false;
    }
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      sum += Math.abs(gray1.data[i] - gray2.data[i]);
    }
    const diff = sum / n;
    return diff <= threshold;
  } catch {
    return false;
  }
}

// =============================================================================
// PART 2 — Matcher classes + find_matches / find_match + preconfigured singletons
// (matching.py:647-1031, 1130-1147)
//
// These build on the PART 1 enums/types/helpers above. Identity policy unchanged:
// model objects compare by reference; value comparison only via the named
// `.matches*` / `samePoseAs` / etc. methods. The four matcher classes default
// their `method` to the enum member; dispatch compares on the string value so a
// bare string and a "member" are interchangeable. Per ARCHITECTURE §4.0 the
// `find_matches` (full Cartesian) and `find_match` (single Video | null) shapes
// are kept distinct.
// =============================================================================

/**
 * Matcher for comparing and matching skeletons (matching.py:647-684).
 *
 * @remarks
 * - `requireSameOrder` is consulted ONLY by the STRUCTURE method (EXACT forces
 *   `requireSameOrder=true`).
 * - `minOverlap` is consulted ONLY by the OVERLAP method.
 */
export class SkeletonMatcher {
  method: SkeletonMatchMethod;
  requireSameOrder: boolean;
  minOverlap: number;

  /**
   * @param method - The matching method (default STRUCTURE). A bare string is
   *   coerced to the enum value and validated (throws on unknown).
   * @param options - `requireSameOrder` (default `false`), `minOverlap`
   *   (default `0.5`).
   */
  constructor(
    method: SkeletonMatchMethod | string = SkeletonMatchMethod.STRUCTURE,
    options: { requireSameOrder?: boolean; minOverlap?: number } = {},
  ) {
    this.method =
      typeof method === "string" ? toSkeletonMatchMethod(method) : method;
    this.requireSameOrder = options.requireSameOrder ?? false;
    this.minOverlap = options.minOverlap ?? 0.5;
  }

  /**
   * Check if two skeletons match according to the configured method
   * (matching.py:667-684). Dispatch order is load-bearing.
   */
  match(skeleton1: Skeleton, skeleton2: Skeleton): boolean {
    if (this.method === SkeletonMatchMethod.EXACT) {
      // FORCE requireSameOrder=true, ignoring this.requireSameOrder.
      return skeleton1.matches(skeleton2, { requireSameOrder: true });
    } else if (this.method === SkeletonMatchMethod.STRUCTURE) {
      return skeleton1.matches(skeleton2, {
        requireSameOrder: this.requireSameOrder,
      });
    } else if (this.method === SkeletonMatchMethod.OVERLAP) {
      const metrics = skeleton1.nodeSimilarities(skeleton2);
      return metrics.jaccard >= this.minOverlap; // inclusive
    } else if (this.method === SkeletonMatchMethod.SUBSET) {
      // Asymmetric: skeleton1's node names ⊆ skeleton2's node names. De-duplicated
      // sets; empty set ⊆ anything.
      const nodes1 = new Set(skeleton1.nodeNames);
      const nodes2 = new Set(skeleton2.nodeNames);
      for (const name of nodes1) {
        if (!nodes2.has(name)) return false;
      }
      return true;
    } else {
      throw new Error(`Unknown skeleton match method: ${this.method}`);
    }
  }
}

/**
 * Matcher for comparing and matching instances (matching.py:687-771).
 *
 * @remarks
 * Threshold semantics depend on method: SPATIAL → pixel tolerance, IOU → minimum
 * IoU, IDENTITY → unused.
 */
export class InstanceMatcher {
  method: InstanceMatchMethod;
  threshold: number;

  /**
   * @param method - The matching method (default SPATIAL). A bare string is
   *   coerced + validated.
   * @param options - `threshold` (default `5.0`).
   */
  constructor(
    method: InstanceMatchMethod | string = InstanceMatchMethod.SPATIAL,
    options: { threshold?: number } = {},
  ) {
    this.method =
      typeof method === "string" ? toInstanceMatchMethod(method) : method;
    this.threshold = options.threshold ?? 5.0;
  }

  /**
   * Check if two instances match according to the configured method
   * (matching.py:705-714).
   */
  match(instance1: Instance, instance2: Instance): boolean {
    if (this.method === InstanceMatchMethod.SPATIAL) {
      // Always passes a number via the matcher (never the tolerance=null branch).
      return instance1.samePoseAs(instance2, this.threshold);
    } else if (this.method === InstanceMatchMethod.IDENTITY) {
      return instance1.sameIdentityAs(instance2);
    } else if (this.method === InstanceMatchMethod.IOU) {
      return instance1.overlapsWith(instance2, this.threshold);
    } else {
      throw new Error(`Unknown instance match method: ${this.method}`);
    }
  }

  /**
   * Find all matching instances between two lists (matching.py:716-771).
   *
   * Returns the FULL Cartesian product of `[idx1, idx2, score]` triples for
   * matching pairs (NOT greedy/one-to-one). Output order = nested-loop encounter
   * order (`i` outer, `j` inner). The gate ({@link match}) and the score are
   * computed by SEPARATE code paths, so a subclass that overrides `match()` to
   * always-true still gets a correct (or zero) score.
   */
  findMatches(
    instances1: Instance[],
    instances2: Instance[],
  ): [number, number, number][] {
    const matches: [number, number, number][] = [];

    for (let i = 0; i < instances1.length; i += 1) {
      const inst1 = instances1[i];
      for (let j = 0; j < instances2.length; j += 1) {
        const inst2 = instances2[j];
        if (this.match(inst1, inst2)) {
          let score: number;
          if (this.method === InstanceMatchMethod.SPATIAL) {
            // Inverse mean distance over valid (visible-in-both, x-coord) nodes.
            const pts1 = inst1.numpy();
            const pts2 = inst2.numpy();
            const distances: number[] = [];
            const n = Math.min(pts1.length, pts2.length);
            for (let k = 0; k < n; k += 1) {
              const valid =
                !Number.isNaN(pts1[k][0]) && !Number.isNaN(pts2[k][0]);
              if (valid) {
                const dx = pts1[k][0] - pts2[k][0];
                const dy = pts1[k][1] - pts2[k][1];
                distances.push(Math.hypot(dx, dy));
              }
            }
            if (distances.length) {
              let sum = 0;
              for (const d of distances) sum += d;
              const mean = sum / distances.length;
              score = 1.0 / (1.0 + mean);
            } else {
              score = 0.0;
            }
          } else if (this.method === InstanceMatchMethod.IOU) {
            // Actual IoU as score, recomputed from VISIBLE-point bounding boxes.
            const bbox1 = inst1.boundingBox();
            const bbox2 = inst2.boundingBox();
            if (bbox1 != null && bbox2 != null) {
              // bbox[0] = mins, bbox[1] = maxs.
              const interMinX = Math.max(bbox1[0][0], bbox2[0][0]);
              const interMinY = Math.max(bbox1[0][1], bbox2[0][1]);
              const interMaxX = Math.min(bbox1[1][0], bbox2[1][0]);
              const interMaxY = Math.min(bbox1[1][1], bbox2[1][1]);
              // Strict `<` on BOTH axes (touching counts as no overlap).
              if (interMinX < interMaxX && interMinY < interMaxY) {
                const interArea =
                  (interMaxX - interMinX) * (interMaxY - interMinY);
                const area1 =
                  (bbox1[1][0] - bbox1[0][0]) * (bbox1[1][1] - bbox1[0][1]);
                const area2 =
                  (bbox2[1][0] - bbox2[0][0]) * (bbox2[1][1] - bbox2[0][1]);
                const unionArea = area1 + area2 - interArea;
                score = unionArea > 0 ? interArea / unionArea : 0;
              } else {
                score = 0.0;
              }
            } else {
              score = 0.0;
            }
          } else {
            // IDENTITY / else: binary match.
            score = 1.0;
          }
          matches.push([i, j, score]);
        }
      }
    }

    return matches;
  }
}

/**
 * Matcher for comparing and matching tracks (matching.py:774-790).
 *
 * @remarks
 * Delegates to `Track.matches(other, method)`, passing the string VALUE of the
 * configured method ("name" / "identity").
 */
export class TrackMatcher {
  method: TrackMatchMethod;

  /**
   * @param method - The matching method (default IDENTITY — matches only the
   *   same Track object; correctness-first). Use NAME to match by track name. A
   *   bare string is coerced + validated.
   */
  constructor(method: TrackMatchMethod | string = TrackMatchMethod.IDENTITY) {
    this.method =
      typeof method === "string" ? toTrackMatchMethod(method) : method;
  }

  /** Check if two tracks match according to the configured method. */
  match(track1: Track, track2: Track): boolean {
    return track1.matches(track2, this.method);
  }
}

/**
 * Per-VideoMatcher reference-keyed frame cache. Mirrors Python's
 * `(id(labels), id(video), include_predictions)` keyed dict — here a nested
 * `Map` keyed by object reference so identity (not value) drives caching.
 */
type FrameCache = Map<
  Labels,
  Map<Video, Map<boolean, Map<number, Instance[]>>>
>;

/**
 * Matcher for comparing and matching videos (matching.py:793-1126).
 *
 * @remarks
 * `strict` is consulted ONLY by the PATH method. The AUTO method uses
 * `strict=true` for one internal stage and `strict=false` for another,
 * regardless of `this.strict`. The per-instance `_frameCache` is fresh per
 * matcher and excluded from any equality/repr (it is identity-keyed).
 *
 * Async-ness (DECISIONS D8): the AUTO cascade reaches filesystem checks
 * (`isSameFile`, `originalVideosConflict`, `_fileExists`) and image pixels
 * (`getFrame`), all of which are async, so {@link match} and {@link findMatch}
 * return `Promise`. Every FS/image helper is awaited (a non-awaited Promise is
 * truthy and would cause false matches).
 */
export class VideoMatcher {
  method: VideoMatchMethod;
  strict: boolean;
  contentFrames: number;
  comparePredictions: string | boolean;
  compareImages: boolean;
  imageSimilarityThreshold: number;
  /** Fresh, reference-keyed per matcher; NOT a constructor argument. */
  private _frameCache: FrameCache;

  /**
   * @param method - The matching method (default AUTO). A bare string is coerced
   *   + validated.
   * @param options - `strict` (default `false`), `contentFrames` (default `3`),
   *   `comparePredictions` (default `"auto"`), `compareImages` (default
   *   `false`), `imageSimilarityThreshold` (default `0.05`).
   */
  constructor(
    method: VideoMatchMethod | string = VideoMatchMethod.AUTO,
    options: {
      strict?: boolean;
      contentFrames?: number;
      comparePredictions?: string | boolean;
      compareImages?: boolean;
      imageSimilarityThreshold?: number;
    } = {},
  ) {
    this.method =
      typeof method === "string" ? toVideoMatchMethod(method) : method;
    this.strict = options.strict ?? false;
    this.contentFrames = options.contentFrames ?? 3;
    this.comparePredictions = options.comparePredictions ?? "auto";
    this.compareImages = options.compareImages ?? false;
    this.imageSimilarityThreshold = options.imageSimilarityThreshold ?? 0.05;
    this._frameCache = new Map();
  }

  /**
   * Get frame instances with reference-keyed caching (matching.py:834-850).
   * Avoids recomputing the per-video frame map during a merge.
   */
  private _getCachedFrameInstances(
    labels: Labels,
    video: Video,
    includePredictions: boolean,
  ): Map<number, Instance[]> {
    let byVideo = this._frameCache.get(labels);
    if (byVideo == null) {
      byVideo = new Map();
      this._frameCache.set(labels, byVideo);
    }
    let byPred = byVideo.get(video);
    if (byPred == null) {
      byPred = new Map();
      byVideo.set(video, byPred);
    }
    let result = byPred.get(includePredictions);
    if (result == null) {
      result = _getFrameInstances(labels, video, includePredictions);
      byPred.set(includePredictions, result);
    }
    return result;
  }

  /**
   * Check if two videos match according to the configured method
   * (matching.py:852-897) — PAIRWISE (NOT the full AUTO cascade).
   *
   * For AUTO this performs rejection checks + definitive identity + path match;
   * for the full AUTO matching with leaf-uniqueness use {@link findMatch}.
   *
   * Async because the AUTO branch awaits `isSameFile` / `originalVideosConflict`.
   */
  async match(video1: Video, video2: Video): Promise<boolean> {
    if (this.method === VideoMatchMethod.AUTO) {
      // Pairwise AUTO, short-circuiting:
      // Rejection: incompatible shapes (=== false ONLY; null/unknown passes).
      if (shapesCompatible(video1, video2) === false) {
        return false;
      }
      // Rejection: conflicting provenance.
      if (await originalVideosConflict(video1, video2)) {
        return false;
      }
      // Rejection: same source file but different crop (mosaic tiles). Must run
      // before any path rung, which would otherwise re-match the shared root
      // file. For non-crop videos this is always false.
      if (await _sameFileDifferentCrop(video1, video2)) {
        return false;
      }
      // Definitive: same file identity (crop-aware).
      if (await isSameFile(video1, video2)) {
        return true;
      }
      // String: strict path match.
      if (video1.matchesPath(video2, true)) {
        return true;
      }
      // String: basename match (the pairwise fallback).
      if (video1.matchesPath(video2, false)) {
        return true;
      }
      return false;
    } else if (this.method === VideoMatchMethod.PATH) {
      return video1.matchesPath(video2, this.strict);
    } else if (this.method === VideoMatchMethod.BASENAME) {
      return video1.matchesPath(video2, false);
    } else if (this.method === VideoMatchMethod.CONTENT) {
      return video1.matchesContent(video2);
    } else if (this.method === VideoMatchMethod.IMAGE_DEDUP) {
      return video1.hasOverlappingImages(video2);
    } else if (this.method === VideoMatchMethod.SHAPE) {
      return video1.matchesShape(video2);
    } else {
      throw new Error(`Unknown video match method: ${this.method}`);
    }
  }

  /**
   * Find a matching video from `candidates` using the configured method
   * (matching.py:899-1031). Returns a `Video` from `candidates` (by reference)
   * or `null`.
   *
   * Non-AUTO: first candidate where `this.match(candidate, incoming)` is true.
   * AUTO: the exact 6-stage safe cascade (file identity → strict path → leaf-path
   * uniqueness at increasing depth → pose matching → image matching → null).
   *
   * Async (DECISIONS D8): awaits FS + pixel helpers throughout.
   */
  async findMatch(
    incoming: Video,
    candidates: Video[],
    opts: { labelsIncoming?: Labels | null; labelsBase?: Labels | null } = {},
  ): Promise<Video | null> {
    const labelsIncoming = opts.labelsIncoming ?? null;
    const labelsBase = opts.labelsBase ?? null;

    if (this.method !== VideoMatchMethod.AUTO) {
      // Non-AUTO: pairwise match(), arg order (candidate, incoming).
      for (const candidate of candidates) {
        if (await this.match(candidate, incoming)) {
          return candidate;
        }
      }
      return null;
    }

    // ---- AUTO safe cascade --------------------------------------------------

    // STAGE 0: build `viable` (rejection filter), preserving candidate order.
    const viable: Video[] = [];
    for (const candidate of candidates) {
      // REJECTION 1: shapes definitely incompatible (=== false only; UNKNOWN
      // /null KEPT).
      if (shapesCompatible(candidate, incoming) === false) {
        continue;
      }
      // REJECTION 2: provenance conflict.
      if (await originalVideosConflict(candidate, incoming)) {
        continue;
      }
      // REJECTION 3: same source file, different crop. Distinct crops (mosaic
      // tiles) of one physical file share a root file, so dropping them here
      // prevents the file-identity, strict-path, and leaf-uniqueness rungs from
      // collapsing them. For non-crop candidates this is always false.
      if (await _sameFileDifferentCrop(candidate, incoming)) {
        continue;
      }
      viable.push(candidate);
    }

    // STAGE 1: definitive file identity.
    for (const candidate of viable) {
      if (await isSameFile(candidate, incoming)) {
        return candidate;
      }
    }

    // STAGE 2: strict full-path match.
    for (const candidate of viable) {
      if (candidate.matchesPath(incoming, true)) {
        return candidate;
      }
    }

    // STAGE 3: leaf-path uniqueness at increasing depth (only if viable).
    if (viable.length) {
      const incomingParts = getPathParts(incoming);
      const candidateParts: [Video, string[]][] = viable.map((v) => [
        v,
        getPathParts(v),
      ]);
      // ALL candidates (not just viable) drive maxDepth.
      const allParts: [Video, string[]][] = candidates.map((v) => [
        v,
        getPathParts(v),
      ]);

      let maxAllLen = 0;
      for (const [, p] of allParts) {
        if (p.length > maxAllLen) maxAllLen = p.length;
      }
      const maxDepth = Math.max(incomingParts.length, maxAllLen);

      for (let depth = 1; depth <= maxDepth; depth += 1) {
        if (incomingParts.length < depth) continue;
        const incomingLeaf = incomingParts.slice(-depth).join("/");

        const matchesAtDepth: Video[] = [];
        for (const [candidate, parts] of candidateParts) {
          if (parts.length < depth) continue;
          const candidateLeaf = parts.slice(-depth).join("/");
          if (candidateLeaf === incomingLeaf) {
            matchesAtDepth.push(candidate);
          }
        }

        // Exactly one => unique match wins; 0 or >1 => go deeper.
        if (matchesAtDepth.length === 1) {
          return matchesAtDepth[0];
        }
      }
    }

    // STAGE 4: pose matching (only if both labels provided).
    if (labelsIncoming != null && labelsBase != null) {
      const m = await this._matchByPoses(
        incoming,
        viable,
        labelsIncoming,
        labelsBase,
      );
      if (m != null) return m;
    }

    // STAGE 5: image matching (only if compareImages).
    if (this.compareImages) {
      const m = await this._matchByImages(incoming, viable);
      if (m != null) return m;
    }

    // STAGE 6: no match.
    return null;
  }

  /**
   * Try to match a video by comparing pose annotations (matching.py:1033-1091).
   *
   * Resolves `includePredictions` separately for incoming and EACH candidate;
   * uses the reference-keyed frame cache; for each candidate computes the common
   * frame-index intersection, requires `min(contentFrames, common.size)` matching
   * sampled frames (sampling up to `contentFrames * 2`), and short-circuits the
   * moment the count reaches `required`. Returns the matched candidate or `null`.
   */
  private async _matchByPoses(
    incoming: Video,
    candidates: Video[],
    labelsIncoming: Labels,
    labelsBase: Labels,
  ): Promise<Video | null> {
    // Resolve whether to include predictions for the incoming video.
    const includePreds = _resolveComparePredictions(
      this.comparePredictions,
      labelsIncoming,
      incoming,
    );

    const incomingFrames = this._getCachedFrameInstances(
      labelsIncoming,
      incoming,
      includePreds,
    );
    if (incomingFrames.size === 0) {
      return null; // No annotations to compare.
    }

    for (const candidate of candidates) {
      const includePredsCand = _resolveComparePredictions(
        this.comparePredictions,
        labelsBase,
        candidate,
      );
      const candidateFrames = this._getCachedFrameInstances(
        labelsBase,
        candidate,
        includePredsCand,
      );
      if (candidateFrames.size === 0) {
        continue;
      }

      // Common frame indices.
      const common = new Set<number>();
      for (const idx of incomingFrames.keys()) {
        if (candidateFrames.has(idx)) common.add(idx);
      }
      if (common.size === 0) {
        continue;
      }

      const required = Math.min(this.contentFrames, common.size);
      const samples = _sampleFrameIndices(common, this.contentFrames * 2);

      let matching = 0;
      for (const frameIdx of samples) {
        const a = incomingFrames.get(frameIdx);
        const b = candidateFrames.get(frameIdx);
        if (a != null && b != null && _frameHasMatchingPose(a, b)) {
          matching += 1;
          if (matching >= required) {
            return candidate; // Found match.
          }
        }
      }
    }

    return null;
  }

  /**
   * Try to match a video by comparing image content (matching.py:1093-1126).
   *
   * Only used when `compareImages` is true (expensive). Same control flow as
   * {@link _matchByPoses} but over common EMBEDDED frame indices, using
   * pixel-similarity (`imageSimilarityThreshold`). Returns the matched candidate
   * or `null`.
   */
  private async _matchByImages(
    incoming: Video,
    candidates: Video[],
  ): Promise<Video | null> {
    for (const candidate of candidates) {
      const common = _getCommonEmbeddedIndices(incoming, candidate);
      if (common.size === 0) {
        continue;
      }

      const required = Math.min(this.contentFrames, common.size);
      const samples = _sampleFrameIndices(common, this.contentFrames * 2);

      let matching = 0;
      for (const frameIdx of samples) {
        if (
          await _framesSimilarByImage(
            incoming,
            candidate,
            frameIdx,
            this.imageSimilarityThreshold,
          )
        ) {
          matching += 1;
          if (matching >= required) {
            return candidate;
          }
        }
      }
    }

    return null;
  }
}

// =============================================================================
// Preconfigured matcher singletons (matching.py:1130-1147)
//
// Exact constants — load-bearing, asserted by tests. NOTE: OVERLAP_SKELETON_MATCHER
// uses minOverlap=0.7, distinct from the bare SkeletonMatcher() default of 0.5.
// Each VideoMatcher singleton carries its own identity-keyed _frameCache.
// =============================================================================

export const STRUCTURE_SKELETON_MATCHER = new SkeletonMatcher(
  SkeletonMatchMethod.STRUCTURE,
);
export const SUBSET_SKELETON_MATCHER = new SkeletonMatcher(
  SkeletonMatchMethod.SUBSET,
);
export const OVERLAP_SKELETON_MATCHER = new SkeletonMatcher(
  SkeletonMatchMethod.OVERLAP,
  { minOverlap: 0.7 },
);

export const DUPLICATE_MATCHER = new InstanceMatcher(
  InstanceMatchMethod.SPATIAL,
  { threshold: 5.0 },
);
export const IOU_MATCHER = new InstanceMatcher(InstanceMatchMethod.IOU, {
  threshold: 0.5,
});
export const IDENTITY_INSTANCE_MATCHER = new InstanceMatcher(
  InstanceMatchMethod.IDENTITY,
);

export const NAME_TRACK_MATCHER = new TrackMatcher(TrackMatchMethod.NAME);
export const IDENTITY_TRACK_MATCHER = new TrackMatcher(
  TrackMatchMethod.IDENTITY,
);

export const AUTO_VIDEO_MATCHER = new VideoMatcher(VideoMatchMethod.AUTO);
export const PATH_VIDEO_MATCHER = new VideoMatcher(VideoMatchMethod.PATH, {
  strict: true,
});
export const BASENAME_VIDEO_MATCHER = new VideoMatcher(
  VideoMatchMethod.BASENAME,
);
export const IMAGE_DEDUP_VIDEO_MATCHER = new VideoMatcher(
  VideoMatchMethod.IMAGE_DEDUP,
);
export const SHAPE_VIDEO_MATCHER = new VideoMatcher(VideoMatchMethod.SHAPE);
