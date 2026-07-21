/**
 * Shared centroid reconstruction from columnar `/centroids` group data.
 *
 * Both the synchronous eager/lazy reader (`read.ts`) and the async streaming
 * reader (`read-streaming.ts`) gather the same per-field columns; this turns
 * those columns into `Centroid` objects so the construction logic (User vs
 * Predicted, NaN sentinels, track/instance relinking, source normalization)
 * lives in one place.
 */
import {
  type Centroid,
  UserCentroid,
  PredictedCentroid,
  normalizeCentroidSource,
} from "../../model/centroid.js";
import type { Track } from "../../model/instance.js";

/** Numeric columns of the `/centroids` group, keyed by field name. */
export type CentroidColumns = Record<string, ArrayLike<number>>;

/**
 * Build `[centroid, videoIdx, frameIdx]` routing tuples from centroid columns.
 * `data` holds the numeric columns (x, y, z, video, frame_idx, track, instance,
 * is_predicted, score, tracking_score); `categories`/`names`/`sources` are the
 * decoded string columns. `tracks` resolves the `track` index (−1 = none).
 * Missing z/score/tracking_score → `null`; `instance` index (−1 = none) is
 * stashed on `_instanceIdx` for deferred relinking by the caller.
 */
export function buildCentroidTuples(
  data: CentroidColumns,
  categories: string[],
  names: string[],
  sources: string[],
  tracks: Track[],
): [Centroid, number, number][] {
  const xs = data.x ?? [];
  const count = xs.length;
  if (!count) return [];

  const ys = data.y ?? [];
  const zs = data.z ?? [];
  const videoIndices = data.video ?? [];
  const frameIndices = data.frame_idx ?? [];
  const trackIndices = data.track ?? [];
  const instanceIndices = data.instance ?? [];
  const isPredictedCol = data.is_predicted ?? [];
  const scores = data.score ?? [];
  const trackingScores = data.tracking_score ?? [];

  const centroids: [Centroid, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const videoIdx = Number(videoIndices[i]);
    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    const zVal = zs.length > i ? Number(zs[i]) : Number.NaN;
    const z = Number.isNaN(zVal) ? null : zVal;

    const tsVal =
      trackingScores.length > i ? Number(trackingScores[i]) : Number.NaN;
    const trackingScore = Number.isNaN(tsVal) ? null : tsVal;

    const instanceIdx = Number(instanceIndices[i]);

    const options = {
      x: Number(xs[i]),
      y: Number(ys[i]),
      z,
      track,
      trackingScore,
      category: categories[i] ?? "",
      name: names[i] ?? "",
      // Normalize legacy camelCase `source` values written by older JS versions
      // to Python's canonical snake_case (`centerOfMass` -> `center_of_mass`,
      // etc.). `anchor:*` and arbitrary sources pass through unchanged.
      source: normalizeCentroidSource(sources[i] ?? ""),
    };

    const isPred =
      isPredictedCol.length > i ? Number(isPredictedCol[i]) === 1 : false;

    let centroid: Centroid;
    if (isPred) {
      const scoreVal = Number(scores[i]);
      centroid = new PredictedCentroid({
        ...options,
        score: Number.isNaN(scoreVal) ? 0 : scoreVal,
      });
    } else {
      centroid = new UserCentroid(options);
    }

    if (instanceIdx >= 0) {
      centroid._instanceIdx = instanceIdx;
    }

    centroids.push([centroid, videoIdx, frameIdxVal]);
  }
  return centroids;
}
