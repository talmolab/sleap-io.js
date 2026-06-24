// src/rendering/trails.ts
//
// Motion-trail computation helpers. Port of the trail logic in Python sleap-io
// `rendering/core.py` (`_resolve_trail_node`, `_compute_trails`,
// `_n_trail_palette_colors`) added in talmolab/sleap-io PR #434.
//
// These are pure, browser-safe functions: they build the trail polylines and
// their colors from a set of LabeledFrames. The actual canvas drawing lives in
// `drawTrails` (shapes.ts), and the wiring into the render pipeline lives in
// render.ts / video.ts.

import type { LabeledFrame } from "../model/labeled-frame.js";
import type { Instance, PredictedInstance, Track } from "../model/instance.js";
import type { Skeleton } from "../model/skeleton.js";
import type { RGB } from "./types.js";

/**
 * A resolved trail target: `null` means the instance centroid, a number is a
 * node index into the instance's points.
 */
export type TrailTarget = number | null;

/** A single trail: `[x, y]` points ordered oldest → newest. `NaN` marks gaps. */
export type Trail = Array<[number, number]>;

/**
 * Resolve a `trailNode` specification to a list of trail targets.
 *
 * Mirrors Python `_resolve_trail_node`.
 *
 * @param trailNode - `"centroid"`, a node name, or a list of node names (one
 *   trail per node). Matching of `"centroid"` is case-insensitive.
 * @param skeleton - Skeleton used to resolve node names to indices.
 * @returns One target per requested node — `null` (centroid) or a node index.
 * @throws If a node name is not present in the skeleton.
 */
export function resolveTrailNode(
  trailNode: string | string[],
  skeleton: Skeleton,
): TrailTarget[] {
  const names = typeof trailNode === "string" ? [trailNode] : [...trailNode];

  return names.map((name) => {
    if (typeof name === "string" && name.toLowerCase() === "centroid") {
      return null;
    }
    try {
      return skeleton.index(name);
    } catch {
      throw new Error(
        `Unknown trailNode ${JSON.stringify(name)}; skeleton nodes: ${JSON.stringify(
          skeleton.nodeNames,
        )}`,
      );
    }
  });
}

/**
 * Number of palette colors needed for motion trails.
 *
 * Mirrors Python `_n_trail_palette_colors`. Trails are colored by track when
 * tracks are present, otherwise by instance position index; in the latter case
 * the palette is sized to the largest instance count over the frames so the
 * coloring stays stable across a render.
 *
 * @param hasTracks - Whether the data has track assignments.
 * @param nTracks - Total number of tracks (used when `hasTracks` is true).
 * @param frames - Frames to scan for the peak instance count (used when
 *   `hasTracks` is false).
 * @returns The palette size, always at least 1.
 */
export function nTrailPaletteColors(
  hasTracks: boolean,
  nTracks: number,
  frames: Iterable<LabeledFrame>,
): number {
  if (hasTracks) {
    return Math.max(nTracks, 1);
  }
  let peak = 1;
  for (const lf of frames) {
    peak = Math.max(peak, lf.instances.length);
  }
  return Math.max(peak, 1);
}

/**
 * Collect the distinct tracks appearing across the given frames, in first-
 * appearance order.
 *
 * Used as the canonical track list for a `LabeledFrame` source (e.g. inside
 * `renderVideo`) when the project's `Labels.tracks` list is not directly
 * available. For a `Labels` source the renderer uses `Labels.tracks` instead,
 * matching how Python keys trails off `source.tracks`.
 */
export function collectTracks(frames: Iterable<LabeledFrame>): Track[] {
  const seen = new Set<Track>();
  const tracks: Track[] = [];
  for (const lf of frames) {
    for (const inst of lf.instances) {
      if (inst.track != null && !seen.has(inst.track)) {
        seen.add(inst.track);
        tracks.push(inst.track);
      }
    }
  }
  return tracks;
}

/**
 * Compute motion-trail polylines ending at a given frame.
 *
 * Mirrors Python `_compute_trails`. Trails are keyed by track (tracked data) or
 * instance position index (untracked) and colored from `paletteColors`.
 *
 * @param opts.frameIdx - Current frame index (the trail ends here).
 * @param opts.frameIdxToLf - Map from frame index to LabeledFrame.
 * @param opts.trailLength - Number of past frames behind the current frame. The
 *   trail spans frames `[frameIdx - trailLength, frameIdx]` inclusive.
 * @param opts.trailTargets - Targets from {@link resolveTrailNode}.
 * @param opts.trackIndexMap - Track → index map, used to key trails by track
 *   and to assign colors.
 * @param opts.paletteColors - Color palette indexed by track index (tracked) or
 *   instance index (untracked).
 * @param opts.hasTracks - Whether the data has track assignments. When false,
 *   trails are keyed by instance position index instead of track.
 * @param opts.ptsCache - Optional cache from instance to its extracted points,
 *   reused across the overlapping trail windows of consecutive frames.
 * @returns `{ trails, colors }` parallel arrays. Each trail has
 *   `trailLength + 1` points (oldest → newest, `NaN` for missing positions).
 */
export function computeTrails(opts: {
  frameIdx: number;
  frameIdxToLf: Map<number, LabeledFrame>;
  trailLength: number;
  trailTargets: TrailTarget[];
  trackIndexMap: Map<Track, number>;
  paletteColors: RGB[];
  hasTracks: boolean;
  ptsCache?: Map<Instance | PredictedInstance, number[][]>;
}): { trails: Trail[]; colors: RGB[] } {
  const {
    frameIdx,
    frameIdxToLf,
    trailLength,
    trailTargets,
    trackIndexMap,
    paletteColors,
    hasTracks,
    ptsCache,
  } = opts;

  const frameStart = frameIdx - trailLength;
  const nPoints = trailLength + 1;

  // Map from "keyIdx:targetIdx" -> { arr, keyIdx }, where keyIdx is the track
  // index (tracked) or instance index (untracked). Insertion order is preserved
  // so trail/color ordering matches Python's dict iteration.
  const trailData = new Map<string, { arr: Trail; keyIdx: number }>();

  for (let j = 0; j < nPoints; j++) {
    const f = frameStart + j;
    const lf = frameIdxToLf.get(f);
    if (!lf) continue;

    const insts = lf.instances;
    for (let instIdx = 0; instIdx < insts.length; instIdx++) {
      const inst = insts[instIdx];

      let keyIdx: number;
      if (hasTracks) {
        if (inst.track == null) continue;
        const k = trackIndexMap.get(inst.track);
        if (k === undefined) continue;
        keyIdx = k;
      } else {
        keyIdx = instIdx;
      }

      // Extract instance points once, reusing the cache across the overlapping
      // trail windows of consecutive frames when provided.
      let pts: number[][];
      if (ptsCache) {
        const cached = ptsCache.get(inst);
        if (cached) {
          pts = cached;
        } else {
          pts = inst.numpy();
          ptsCache.set(inst, pts);
        }
      } else {
        pts = inst.numpy();
      }

      for (let tIdx = 0; tIdx < trailTargets.length; tIdx++) {
        const target = trailTargets[tIdx];
        let coord: [number, number];
        if (target === null) {
          // Centroid: mean of visible points (visibility keyed off column 0,
          // matching Instance.centroidXy and Python's `pts[:, 0]` check).
          let sumX = 0;
          let sumY = 0;
          let count = 0;
          for (const p of pts) {
            if (!Number.isNaN(p[0])) {
              sumX += p[0];
              sumY += p[1];
              count++;
            }
          }
          coord = count > 0 ? [sumX / count, sumY / count] : [NaN, NaN];
        } else if (target < pts.length) {
          coord = [pts[target][0], pts[target][1]];
        } else {
          coord = [NaN, NaN];
        }

        const dkey = `${keyIdx}:${tIdx}`;
        let entry = trailData.get(dkey);
        if (!entry) {
          const arr: Trail = Array.from(
            { length: nPoints },
            () => [NaN, NaN] as [number, number],
          );
          entry = { arr, keyIdx };
          trailData.set(dkey, entry);
        }
        entry.arr[j] = coord;
      }
    }
  }

  const trails: Trail[] = [];
  const colors: RGB[] = [];
  for (const { arr, keyIdx } of trailData.values()) {
    // Drop trails with no finite positions at all.
    if (!arr.some((p) => Number.isFinite(p[0]) || Number.isFinite(p[1]))) {
      continue;
    }
    trails.push(arr);
    colors.push(paletteColors[keyIdx % paletteColors.length]);
  }

  return { trails, colors };
}
