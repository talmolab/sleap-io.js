/**
 * MP4/MOV edit lists and the frames they hide (issue #274).
 *
 * A clip cut with stream copy (`ffmpeg -ss 1.0 -i in.mp4 -t 9 -c copy out.mp4`)
 * usually starts between two keyframes. The muxer keeps the samples back to
 * the previous keyframe (the decoder needs them as references) and writes an
 * edit list (`elst`) whose `media_time` says "start showing here". Samples whose
 * presentation time falls before that point are decoded but never shown:
 * ffmpeg marks them as discard, and Python sleap-io (which reads through ffmpeg)
 * never counts them. sleap-io.js indexes frames the same way, so frame 0 is the
 * first frame that is actually shown.
 *
 * sleap-io.js 0.5.17 and earlier counted these hidden frames, so on such a video
 * every frame index was too high by `VideoBackend.hiddenLeadingFrames`.
 *
 * @module
 */

/** One `elst` entry as mp4box.js parses it. */
export interface EditListEntry {
  /** Edit duration in MOVIE timescale units (0 = ignore this entry). */
  segment_duration: number;
  /** First media time shown, in TRACK timescale units; -1 = empty edit (a gap). */
  media_time: number;
}

/**
 * The track media time where presentation starts, from an edit list: the
 * `media_time` of the first edit that maps media. Returns `null` when there is
 * no edit list or only empty edits, i.e. nothing is hidden. Only the first
 * such edit is used, like MediaBunny.
 */
export function editListStartTime(
  entries: readonly EditListEntry[] | null | undefined,
): number | null {
  if (!entries?.length) return null;
  for (const entry of entries) {
    if (entry.segment_duration === 0) continue;
    if (entry.media_time === -1) continue; // empty edit: a gap, hides nothing
    return entry.media_time;
  }
  return null;
}

/**
 * How many samples, in PRESENTATION order, start before `startTime` and are
 * therefore hidden by the edit list. `sortedTimes` must be ascending and in the
 * same units as `startTime`. A sample that starts before the edit but runs
 * past it is still hidden: ffmpeg drops it too. Never hides every sample (a
 * broken edit list must not make the video empty).
 */
export function countHiddenLeadingSamples(
  sortedTimes: readonly number[],
  startTime: number | null,
): number {
  if (startTime === null) return 0;
  let hidden = 0;
  while (hidden < sortedTimes.length && sortedTimes[hidden] < startTime) {
    hidden += 1;
  }
  return hidden >= sortedTimes.length ? 0 : hidden;
}
