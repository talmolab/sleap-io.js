/**
 * Resolve the source frame count (the seekbar / navigation extent) for an
 * embedded SLP video, synchronously, from metadata that is cheap to read.
 *
 * Priority:
 *  1. The `frames` HDF5 attribute — the source video's true total frame count
 *     (written by recent sleap-io / sleap_io). Authoritative when present.
 *  2. The frame count carried in videos_json `backend.shape[0]`.
 *  3. `max(frame_numbers) + 1` — a lower bound derived from the stored frames'
 *     source indices. Used for pkg.slp files written WITHOUT a `frames` attr
 *     (e.g. older PyQt SLEAP), so the seekbar still spans the labeled-frame
 *     range. This is intentionally computed here rather than via an async
 *     per-video image-decode probe (which raced the UI and produced 0 / "?" /
 *     wrong counts on multi-video packages).
 *
 * Note: this is the SOURCE extent (what the seekbar spans), NOT the number of
 * embedded images — that is `frame_numbers.length`, surfaced separately.
 *
 * Returns undefined when none of the inputs yield a positive count.
 */
export function resolveSourceFrameCount(opts: {
  /** Value of the dataset's `frames` HDF5 attribute, if present. */
  framesAttr?: number;
  /** Frame count from videos_json `backend.shape[0]`, if present. */
  jsonFrameCount?: number;
  /** Source frame indices of the stored (embedded) images. */
  frameNumbers?: number[];
}): number | undefined {
  const { framesAttr, jsonFrameCount, frameNumbers } = opts;
  if (framesAttr !== undefined && framesAttr > 0) return framesAttr;
  if (jsonFrameCount !== undefined && jsonFrameCount > 0) return jsonFrameCount;
  if (frameNumbers && frameNumbers.length > 0) {
    // Loop (not Math.max(...spread)) to stay safe for large frame_numbers.
    let max = 0;
    for (const n of frameNumbers) {
      if (n > max) max = n;
    }
    return max + 1;
  }
  return undefined;
}
