/**
 * Shared bounding-box reconstruction from `/bboxes` column data.
 *
 * Both the synchronous eager/lazy reader (`read.ts`) and the async streaming
 * reader (`read-streaming.ts`) gather the same per-field columns; this turns
 * those columns into `BoundingBox` objects so the construction logic (layout
 * detection, User vs Predicted, NaN sentinels, track/instance relinking) lives
 * in one place.
 *
 * Three on-disk layouts produce these columns:
 *  - Python sleap-io (SLP 2.0+) / current JS: a `/bboxes` GROUP with one child
 *    dataset per field (x1, y1, x2, y2, angle, video, frame_idx, track,
 *    instance, is_predicted, score, tracking_score) plus vlen-str children
 *    (category/name/source).
 *  - Legacy JS: a flat 2-D `/bboxes` f8 matrix + `field_names` attr (corner
 *    columns, no `is_predicted`) with sibling root `bbox_categories` /
 *    `bbox_names` / `bbox_sources` JSON datasets.
 *  - Legacy Python (pre-2.0): a compound `/bboxes` dataset with center-based
 *    columns (x_center, y_center, width, height) and JSON string attrs.
 */
import {
  type BoundingBox,
  PredictedBoundingBox,
  UserBoundingBox,
} from "../../model/bbox.js";
import type { Track } from "../../model/instance.js";

/** Numeric columns of the `/bboxes` data, keyed by field name. */
export type BboxColumns = Record<string, ArrayLike<number>>;

/** Numeric child datasets of the columnar `/bboxes` group. */
export const BBOX_NUMERIC_COLUMNS = [
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
] as const;

/**
 * Build `[bbox, videoIdx, frameIdx]` routing tuples from bbox columns.
 * `data` holds the numeric columns, either corner-based (x1/y1/x2/y2) or the
 * legacy center-based layout (x_center/y_center/width/height).
 * `categories`/`names`/`sources` are the decoded string columns. `tracks`
 * resolves the `track` index (−1 = none).
 *
 * User vs Predicted: the `is_predicted` column decides when present (Python and
 * current JS files); otherwise (legacy JS matrix) a NaN score means User. A
 * missing/NaN `tracking_score` → `null`. The `instance` index (−1 = none) is
 * stashed on `_instanceIdx` for deferred relinking by the caller.
 */
export function buildBboxTuples(
  data: BboxColumns,
  categories: string[],
  names: string[],
  sources: string[],
  tracks: Track[],
): [BoundingBox, number, number][] {
  // Legacy format: center-based columns (x_center, y_center, width, height)
  const xCenters = data.x_center ?? [];
  const isCenterBased = xCenters.length > 0;
  const x1s = data.x1 ?? [];
  const count = isCenterBased ? xCenters.length : x1s.length;
  if (!count) return [];

  const yCenters = data.y_center ?? [];
  const widths = data.width ?? [];
  const heights = data.height ?? [];
  const y1s = data.y1 ?? [];
  const x2s = data.x2 ?? [];
  const y2s = data.y2 ?? [];
  const angles = data.angle ?? [];
  const videoIndices = data.video ?? [];
  const frameIndices = data.frame_idx ?? [];
  const trackIndices = data.track ?? [];
  const instanceIndices = data.instance ?? [];
  const isPredictedCol = data.is_predicted ?? [];
  const scores = data.score ?? [];
  const trackingScores = data.tracking_score ?? [];

  const bboxes: [BoundingBox, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const videoIdx = Number(videoIndices[i]);
    const frameIdxVal = Number(frameIndices[i]);

    const trackIdx = Number(trackIndices[i]);
    const track =
      trackIdx >= 0 && trackIdx < tracks.length ? tracks[trackIdx] : null;

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    if (isCenterBased) {
      const cx = Number(xCenters[i]);
      const cy = Number(yCenters[i]);
      const w = Number(widths[i]);
      const h = Number(heights[i]);
      x1 = cx - w / 2;
      y1 = cy - h / 2;
      x2 = cx + w / 2;
      y2 = cy + h / 2;
    } else {
      x1 = Number(x1s[i]);
      y1 = Number(y1s[i]);
      x2 = Number(x2s[i]);
      y2 = Number(y2s[i]);
    }

    const angleVal = angles.length > i ? Number(angles[i]) : 0;

    const tsVal =
      trackingScores.length > i ? Number(trackingScores[i]) : Number.NaN;
    const trackingScore = Number.isNaN(tsVal) ? null : tsVal;

    const options = {
      x1,
      y1,
      x2,
      y2,
      angle: Number.isNaN(angleVal) ? 0 : angleVal,
      track,
      trackingScore,
      category: categories[i] ?? "",
      name: names[i] ?? "",
      source: sources[i] ?? "",
    };

    const scoreVal = scores.length > i ? Number(scores[i]) : Number.NaN;
    const isPred =
      isPredictedCol.length > i
        ? Number(isPredictedCol[i]) !== 0 // any nonzero flag, as Python's bool()
        : !Number.isNaN(scoreVal);

    let bbox: BoundingBox;
    if (isPred) {
      bbox = new PredictedBoundingBox({
        ...options,
        score: Number.isNaN(scoreVal) ? 0 : scoreVal,
      });
    } else {
      bbox = new UserBoundingBox(options);
    }

    const instanceIdx = Number(instanceIndices[i]);
    if (instanceIdx >= 0) {
      bbox._instanceIdx = instanceIdx;
    }

    bboxes.push([bbox, videoIdx, frameIdxVal]);
  }
  return bboxes;
}
