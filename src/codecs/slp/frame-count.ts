/**
 * Resolve the source frame count (the seekbar / navigation extent) for an
 * embedded SLP video, synchronously, from metadata that is cheap to read.
 *
 * The extent is `max(declared, max(frame_numbers) + 1)`, where `declared` is:
 *  1. the `frames` HDF5 attribute — the source video's total frame count
 *     (written by recent sleap-io / sleap_io), else
 *  2. the frame count carried in videos_json `backend.shape[0]`.
 *
 * `max(frame_numbers) + 1` is a HARD LOWER BOUND, not merely a last-resort
 * fallback: a stored image at source index N proves the source had at least
 * N + 1 frames, so a `declared` count below it is impossible — e.g. a BOGUS
 * `frames` attr of 424 on a video whose frame_numbers reach 173997 — and must be
 * clamped up. Without this clamp such files collapse the seekbar to the (wrong)
 * declared count and drop every labeled frame beyond it. It also covers pkg.slp
 * files written WITHOUT a `frames` attr (older PyQt SLEAP), synchronously (no
 * async per-video decode probe, which raced the UI and produced 0 / "?" counts).
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

  // Declared source length: the `frames` attr (authoritative when correct),
  // else the videos_json `backend.shape[0]`.
  let declared = 0;
  if (framesAttr !== undefined && framesAttr > 0) declared = framesAttr;
  else if (jsonFrameCount !== undefined && jsonFrameCount > 0)
    declared = jsonFrameCount;

  // Hard lower bound from the stored source indices (see docstring): the axis
  // can never be shorter than the largest stored frame index + 1.
  let fromFrameNumbers = 0;
  if (frameNumbers && frameNumbers.length > 0) {
    // Loop (not Math.max(...spread)) to stay safe for large frame_numbers.
    let max = 0;
    for (const n of frameNumbers) {
      if (n > max) max = n;
    }
    fromFrameNumbers = max + 1;
  }

  const count = Math.max(declared, fromFrameNumbers);
  return count > 0 ? count : undefined;
}
