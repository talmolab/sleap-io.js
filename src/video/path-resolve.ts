// src/video/path-resolve.ts
//
// External video path resolution against the labels-file directory (issue #213).
//
// A `.slp` stores video sources by the ABSOLUTE path they had on the machine
// that wrote them. When the project is opened elsewhere — a different OS, or the
// media moved into a subfolder next to the `.slp` — those paths no longer point
// at anything, and the video silently fails to open. This module resolves a
// stored source (a single file OR an `ImageVideo` image list) to where the media
// actually lives, using the injected {@link FsResolver} (`setFsResolver`) for
// existence checks so the browser (injected), Node, and Tauri all share ONE
// resolution policy. With no resolver available it is never invoked; the caller
// degrades to the stored path verbatim.
//
// Candidate strategy (mirrors Python sleap-io's resolve-relative-to-`.slp` plus
// its `find_changed_subpath` / prefix-change logic, and unifies both):
//   1. the stored path verbatim (absolute / same-machine),
//   2. the stored path relative to the labels directory,
//   3. a common-suffix "anchor" between the labels dir and the stored path,
//   4. progressively shorter trailing tails grafted onto the labels dir
//      (`sub/sub/basename` → … → `basename`), most-specific-first.
//
// For an image sequence, only the FIRST frame is probed against the candidates;
// the winning candidate yields a single prefix-swap that is applied to every
// path in the list (an O(N) string op — never N filesystem checks), so a
// 15,000-image sequence resolves with a handful of `exists()` calls.

import type { FsResolver } from "../model/matching.js";

/** Deepest trailing-tail depth grafted onto the labels dir (bounds `exists()` calls). */
const DEFAULT_MAX_TAIL_DEPTH = 16;

/**
 * A path decomposed for cross-platform reasoning: backslashes normalized to `/`,
 * a Windows `drive` letter (`"C:"`, no slash) split out, and the remaining
 * segments in `parts` (with `.` and empty segments dropped, `..` preserved).
 */
export interface PosixPath {
  /** Whether the path is rooted (leading `/`, a UNC `//`, or a `drive` + `/`). */
  absolute: boolean;
  /** Windows drive prefix like `"C:"` (no trailing slash), or `null`. */
  drive: string | null;
  /**
   * A UNC / network-share root (leading `\\` or `//`, e.g. `\\server\share`).
   * Tracked separately so it round-trips as `//…` and is not collapsed to a
   * single-slash POSIX root — which on Windows would silently re-root the path
   * to the current drive and lose the share (issue #213).
   */
  unc: boolean;
  /** Path segments after the root/drive. */
  parts: string[];
}

/** Split a slash-joined remainder into segments, dropping `""` and `.`. */
function splitParts(s: string): string[] {
  return s.split("/").filter((c) => c.length > 0 && c !== ".");
}

/**
 * Parse a path string into a {@link PosixPath}. Handles UNC (`\\server\share`),
 * POSIX absolute (`/a/b`), Windows drive-absolute (`C:/a/b` or `C:\a\b`),
 * Windows drive-relative (`C:a`), and relative (`a/b`) forms. Never throws.
 */
export function parsePath(p: string): PosixPath {
  const norm = p.replace(/\\/g, "/");
  // UNC / network share (`\\server\share\…` -> `//server/share/…`): keep the
  // double-slash root so it is not collapsed to a single-slash POSIX root.
  if (norm.startsWith("//")) {
    return { absolute: true, drive: null, unc: true, parts: splitParts(norm) };
  }
  const driveMatch = /^([A-Za-z]:)(.*)$/.exec(norm);
  if (driveMatch) {
    const rest = driveMatch[2];
    return {
      absolute: rest.startsWith("/"),
      drive: driveMatch[1],
      unc: false,
      parts: splitParts(rest),
    };
  }
  if (norm.startsWith("/")) {
    return { absolute: true, drive: null, unc: false, parts: splitParts(norm) };
  }
  return { absolute: false, drive: null, unc: false, parts: splitParts(norm) };
}

/** Render a {@link PosixPath} back to a forward-slash string. Inverse of {@link parsePath}. */
export function formatPath(pp: PosixPath): string {
  const body = pp.parts.join("/");
  if (pp.unc) return `//${body}`;
  if (pp.drive) {
    return pp.absolute ? `${pp.drive}/${body}` : `${pp.drive}${body}`;
  }
  return pp.absolute ? `/${body}` : body;
}

/** Final path segment (cross-platform), or `""` for a rootless empty path. */
export function posixBasename(p: string): string {
  const { parts } = parsePath(p);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

/** Directory portion of a path (cross-platform), preserving root/drive. */
export function posixDirname(p: string): string {
  const pp = parsePath(p);
  return formatPath({ ...pp, parts: pp.parts.slice(0, -1) });
}

/** Join `tail` (treated as a relative segment) onto directory `dir`. */
export function posixJoin(dir: string, tail: string): string {
  const d = parsePath(dir);
  const t = parsePath(tail);
  return formatPath({ ...d, parts: [...d.parts, ...t.parts] });
}

/**
 * Index in `hay` just AFTER the last contiguous occurrence of `needle`, or `-1`
 * if `needle` is empty or does not occur. Used to locate the deepest shared
 * "anchor" run between the labels dir and a stored path.
 */
function lastIndexAfterContiguous(hay: string[], needle: string[]): number {
  if (needle.length === 0) return -1;
  for (let start = hay.length - needle.length; start >= 0; start--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[start + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return start + needle.length;
  }
  return -1;
}

/**
 * Reconstruct a candidate by grafting the stored path's tail onto the labels dir
 * at their longest shared "anchor": the longest suffix of the labels-dir
 * segments that also occurs contiguously within the stored path's directory
 * segments. The stored directory portion AFTER that anchor (plus the basename)
 * is appended to the FULL labels dir.
 *
 * Example — labels dir `L:/code/proj/2026-mars`, stored
 * `/home/u/code/proj/2026-mars/raw/img_0.jpg`: the anchor is
 * `code/proj/2026-mars`, so the candidate is
 * `L:/code/proj/2026-mars/raw/img_0.jpg`.
 *
 * Returns `null` when there is no shared anchor.
 */
export function anchorCandidate(
  storedPath: string,
  labelsDir: string,
): string | null {
  const sp = parsePath(storedPath);
  if (sp.parts.length === 0) return null;
  const basename = sp.parts[sp.parts.length - 1];
  const storedDir = sp.parts.slice(0, -1);
  const ld = parsePath(labelsDir);
  const ldParts = ld.parts;

  const maxL = Math.min(ldParts.length, storedDir.length);
  for (let L = maxL; L >= 1; L--) {
    const suffix = ldParts.slice(ldParts.length - L);
    const end = lastIndexAfterContiguous(storedDir, suffix);
    if (end >= 0) {
      const remainder = storedDir.slice(end);
      return formatPath({ ...ld, parts: [...ldParts, ...remainder, basename] });
    }
  }
  return null;
}

/**
 * Ordered, de-duplicated candidate paths for a single stored source path,
 * resolved against `labelsDir`. The first entry is always the verbatim
 * (normalized) stored path. Later entries require a non-empty `labelsDir`.
 * The trailing-tail grafts are emitted MOST-SPECIFIC-FIRST (deepest tail before
 * basename) so the first existing match is the least ambiguous.
 */
export function videoPathCandidates(
  storedPath: string,
  labelsDir: string,
  maxDepth: number = DEFAULT_MAX_TAIL_DEPTH,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (c: string): void => {
    if (c.length > 0 && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  };

  const sp = parsePath(storedPath);
  // 1. Verbatim (normalized) — absolute / same-machine.
  add(formatPath(sp));

  if (labelsDir != null && labelsDir !== "") {
    // 2. Relative-to-labels-dir (only when the stored path is itself relative).
    if (!sp.absolute && sp.drive == null) {
      add(posixJoin(labelsDir, storedPath));
    }
    // 3. Common-suffix anchor — high-precision single guess.
    const anchor = anchorCandidate(storedPath, labelsDir);
    if (anchor != null) add(anchor);
    // 4. Trailing tails grafted onto the labels dir, deepest-first.
    const parts = sp.parts;
    const maxK = Math.min(maxDepth, parts.length);
    for (let k = maxK; k >= 1; k--) {
      add(posixJoin(labelsDir, parts.slice(parts.length - k).join("/")));
    }
  }

  return out;
}

/**
 * A leading-prefix substitution derived from how the first frame resolved:
 * replace the `old` leading segment (root + parts) of a path with the `new` one,
 * preserving the shared `suffixLen` trailing segments. Applied to every path in
 * an image sequence so the whole list is remapped from one resolution probe.
 */
export interface PrefixSwap {
  old: PosixPath;
  new: PosixPath;
  suffixLen: number;
}

/**
 * Derive the {@link PrefixSwap} that turns `firstStored` into `firstResolved` by
 * keeping their longest common trailing segments and swapping everything before.
 */
export function derivePrefixSwap(
  firstStored: string,
  firstResolved: string,
): PrefixSwap {
  const s = parsePath(firstStored);
  const r = parsePath(firstResolved);
  let suffixLen = 0;
  while (
    suffixLen < s.parts.length &&
    suffixLen < r.parts.length &&
    s.parts[s.parts.length - 1 - suffixLen] ===
      r.parts[r.parts.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }
  return {
    old: {
      absolute: s.absolute,
      drive: s.drive,
      unc: s.unc,
      parts: s.parts.slice(0, s.parts.length - suffixLen),
    },
    new: {
      absolute: r.absolute,
      drive: r.drive,
      unc: r.unc,
      parts: r.parts.slice(0, r.parts.length - suffixLen),
    },
    suffixLen,
  };
}

/**
 * Apply a {@link PrefixSwap} to `path`: if `path` starts with the swap's `old`
 * leading prefix (same root/drive and leading segments), replace that prefix
 * with `new`; otherwise return `path` normalized and unchanged (paths in the
 * list that don't share the first frame's prefix are left as-is).
 */
export function applyPrefixSwap(path: string, swap: PrefixSwap): string {
  const p = parsePath(path);
  const { old: o, new: n } = swap;
  if (p.absolute !== o.absolute || p.drive !== o.drive || p.unc !== o.unc) {
    return formatPath(p);
  }
  if (p.parts.length < o.parts.length) return formatPath(p);
  for (let i = 0; i < o.parts.length; i++) {
    if (p.parts[i] !== o.parts[i]) return formatPath(p);
  }
  return formatPath({
    absolute: n.absolute,
    drive: n.drive,
    unc: n.unc,
    parts: [...n.parts, ...p.parts.slice(o.parts.length)],
  });
}

/**
 * First candidate that {@link FsResolver.exists} confirms, or `null` if none do.
 * A resolver that throws on a candidate is treated as "does not exist" for that
 * candidate (the scan continues) — matching the conservative degrade elsewhere.
 */
export async function resolveFirstExisting(
  candidates: string[],
  fs: FsResolver,
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      if (await fs.exists(candidate)) return candidate;
    } catch {
      // Treat a resolver error as "not found here" and try the next candidate.
    }
  }
  return null;
}

/** Result of resolving a video source against the labels directory. */
export interface ResolvedVideoSource {
  /**
   * The source remapped to on-disk paths where resolution succeeded, or the
   * original source unchanged when it resolved verbatim / could not be located.
   * Same shape as the input (string vs string[]).
   */
  filename: string | string[];
  /**
   * `true` IFF the resolver was consulted and the first frame/file could NOT be
   * located at ANY candidate — the signal for callers to withhold an unreadable
   * backend and record a "missing" reason.
   */
  firstMissing: boolean;
}

/**
 * Resolve a stored video source (single file or `ImageVideo` list) against the
 * labels-file directory using `fs` for existence checks.
 *
 * Only the first frame of a list is probed; the winning candidate yields one
 * prefix-swap applied to the whole list. Returns the original source unchanged
 * on a verbatim hit (no churn) or when nothing could be located (`firstMissing`
 * then flags the miss). Callers MUST only invoke this when an `FsResolver` is
 * available; with none, degrade to the stored source directly.
 */
export async function resolveVideoSource(
  source: string | string[],
  labelsDir: string,
  fs: FsResolver,
): Promise<ResolvedVideoSource> {
  if (Array.isArray(source)) {
    if (source.length === 0) return { filename: source, firstMissing: false };
    const first = source[0];
    const candidates = videoPathCandidates(first, labelsDir);
    const resolved = await resolveFirstExisting(candidates, fs);
    if (resolved == null) return { filename: source, firstMissing: true };
    // Verbatim hit: leave the list byte-for-byte unchanged.
    if (resolved === candidates[0])
      return { filename: source, firstMissing: false };
    const swap = derivePrefixSwap(first, resolved);
    return {
      filename: source.map((p) => applyPrefixSwap(p, swap)),
      firstMissing: false,
    };
  }

  const candidates = videoPathCandidates(source, labelsDir);
  const resolved = await resolveFirstExisting(candidates, fs);
  if (resolved == null) return { filename: source, firstMissing: true };
  if (resolved === candidates[0])
    return { filename: source, firstMissing: false };
  return { filename: resolved, firstMissing: false };
}
