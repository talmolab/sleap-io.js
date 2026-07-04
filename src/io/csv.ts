/**
 * SLEAP Analysis CSV export.
 *
 * Writes `Labels` to the "SLEAP Analysis" CSV format — one row per instance per
 * frame with columns `track, frame_idx, instance.score, {node}.score,
 * {node}.x, {node}.y, ...` (node columns sorted alphabetically). A faithful
 * port of the `format="sleap"` path of Python `sleap_io.io.csv.write_labels`
 * (`_write_sleap` + `_transform_to_sleap_format`) over the instances-DataFrame
 * builder in `sleap_io.codecs.dataframe` (`_to_instances_df`).
 *
 * With `includeEmpty`, frames without instances are emitted as NaN rows and each
 * video's range is padded up to its full length — the fix from sleap-io PR #480
 * (matching the numpy / Analysis-HDF5 export, which already spans the whole
 * video).
 *
 * {@link labelsToCsv} is pure (browser-safe) and returns the CSV text;
 * {@link saveLabelsCsv} writes it to disk via the Node fs writer registered by
 * `h5-node.ts`, so this module stays free of Node-only imports.
 */

import type { Labels } from "../model/labels.js";
import type { Video } from "../model/video.js";
import { PredictedInstance } from "../model/instance.js";
import { nodeWriteFile } from "../codecs/slp/h5.js";

export interface CsvExportOptions {
  /** Restrict output to one video (a `Video` or its index). Default: all videos. */
  video?: Video | number | null;
  /** Include per-node and instance confidence scores. Default `true`. */
  includeScore?: boolean;
  /**
   * Emit NaN-filled rows for frames with no instances, padding each video's
   * range up to its full length (falling back to last labeled frame + 1 when
   * the length is unknown). Default `false`. Mirrors sleap-io PR #480.
   */
  includeEmpty?: boolean;
  /**
   * First frame index (inclusive). Default: `0` when `includeEmpty`, else the
   * first labeled frame.
   */
  startFrame?: number | null;
  /**
   * End frame index (exclusive). Default: the full video length when known,
   * else last labeled frame + 1.
   */
  endFrame?: number | null;
}

/** Best-effort video frame count (matches Python `len(video)`; 0 if unknown). */
function videoFrameCount(video: Video): number {
  const shape = video.shape;
  if (shape && shape.length > 0 && typeof shape[0] === "number") {
    return shape[0];
  }
  return 0;
}

/** Format one CSV cell: `null`/`NaN` -> empty, numbers as-is, strings quoted if needed. */
function csvCell(value: number | string | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number")
    return Number.isNaN(value) ? "" : String(value);
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

type Row = { video: Video; cols: Map<string, number | string | null> };

/**
 * Build the SLEAP Analysis CSV text for `labels`.
 *
 * Pure and browser-safe. See {@link saveLabelsCsv} to write it to disk.
 */
export function labelsToCsv(
  labels: Labels,
  options: CsvExportOptions = {},
): string {
  const includeScore = options.includeScore ?? true;
  const includeEmpty = options.includeEmpty ?? false;
  const startFrame = options.startFrame ?? null;
  const endFrame = options.endFrame ?? null;

  // Resolve the video filter.
  let selectedVideos: Video[];
  if (options.video == null) {
    selectedVideos = labels.videos;
  } else if (typeof options.video === "number") {
    const v = labels.videos[options.video];
    if (!v) throw new Error(`Video index ${options.video} out of range.`);
    selectedVideos = [v];
  } else {
    selectedVideos = [options.video];
  }
  const videoSet = new Set(selectedVideos);
  const videoIndex = new Map(labels.videos.map((v, i) => [v, i]));

  const frames = labels.labeledFrames.filter((lf) => videoSet.has(lf.video));

  const rows: Row[] = [];
  const nodeColSet = new Set<string>();
  // Frames actually emitted (passed the range filter), per video, for padding.
  const seen = new Set<string>();
  const seenByVideo = new Map<Video, number[]>();
  const seenKey = (v: Video, f: number) => `${videoIndex.get(v)}:${f}`;

  for (const lf of frames) {
    if (startFrame != null && lf.frameIdx < startFrame) continue;
    if (endFrame != null && lf.frameIdx >= endFrame) continue;
    seen.add(seenKey(lf.video, lf.frameIdx));
    const byVid = seenByVideo.get(lf.video);
    if (byVid) byVid.push(lf.frameIdx);
    else seenByVideo.set(lf.video, [lf.frameIdx]);

    const instances = [...lf.userInstances, ...lf.predictedInstances];
    for (const inst of instances) {
      const predicted = inst instanceof PredictedInstance;
      const cols = new Map<string, number | string | null>();
      cols.set("frame_idx", lf.frameIdx);
      cols.set("track", inst.track ? inst.track.name : null);
      cols.set(
        "instance.score",
        predicted ? ((inst as PredictedInstance).score ?? null) : null,
      );
      const nodes = inst.skeleton.nodes;
      for (let i = 0; i < nodes.length; i++) {
        const name = nodes[i].name;
        const pt = inst.points[i];
        const xKey = `${name}.x`;
        const yKey = `${name}.y`;
        cols.set(xKey, pt ? pt.xy[0] : Number.NaN);
        cols.set(yKey, pt ? pt.xy[1] : Number.NaN);
        nodeColSet.add(xKey);
        nodeColSet.add(yKey);
        // Per-node scores are emitted only for predicted instances (matching
        // Python `_to_instances_df`); user rows leave the cell empty.
        if (includeScore && predicted) {
          const sKey = `${name}.score`;
          cols.set(sKey, pt?.score ?? Number.NaN);
          nodeColSet.add(sKey);
        }
      }
      rows.push({ video: lf.video, cols });
    }
  }

  // Empty-frame padding, spanning the full video length (sleap-io PR #480).
  if (includeEmpty && frames.length) {
    const skeleton = labels.skeletons[0];
    for (const vid of selectedVideos) {
      const emitted = seenByVideo.get(vid);
      if (!emitted || !emitted.length) continue;

      const first = startFrame != null ? startFrame : 0;
      let last: number;
      if (endFrame != null) {
        last = endFrame;
      } else {
        let maxIdx = emitted[0];
        for (const f of emitted) if (f > maxIdx) maxIdx = f;
        last = maxIdx + 1;
        const len = videoFrameCount(vid);
        if (len > 0) last = Math.max(last, len);
      }

      for (let f = first; f < last; f++) {
        if (seen.has(seenKey(vid, f))) continue;
        const cols = new Map<string, number | string | null>();
        cols.set("frame_idx", f);
        cols.set("track", null);
        cols.set("instance.score", null);
        if (skeleton) {
          for (const node of skeleton.nodes) {
            cols.set(`${node.name}.x`, Number.NaN);
            cols.set(`${node.name}.y`, Number.NaN);
            nodeColSet.add(`${node.name}.x`);
            nodeColSet.add(`${node.name}.y`);
            if (includeScore) {
              cols.set(`${node.name}.score`, Number.NaN);
              nodeColSet.add(`${node.name}.score`);
            }
          }
        }
        rows.push({ video: vid, cols });
      }
    }
    // Sort by (video index, frame_idx), matching Python's all_frames output.
    rows.sort((a, b) => {
      const va = videoIndex.get(a.video) ?? 0;
      const vb = videoIndex.get(b.video) ?? 0;
      if (va !== vb) return va - vb;
      return (
        (a.cols.get("frame_idx") as number) -
        (b.cols.get("frame_idx") as number)
      );
    });
  }

  // Header: base columns then alphabetically-sorted node columns (matching
  // `_transform_to_sleap_format`; `video_path`/`track_score` are not emitted).
  const nodeCols = [...nodeColSet].sort();
  const header = ["track", "frame_idx", "instance.score", ...nodeCols];

  const lines: string[] = [header.join(",")];
  for (const row of rows) {
    lines.push(
      header.map((col) => csvCell(row.cols.get(col) ?? null)).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Write `labels` to a SLEAP Analysis CSV file. Node-only (disk I/O); use
 * {@link labelsToCsv} for the browser-safe string.
 */
export async function saveLabelsCsv(
  labels: Labels,
  filename: string,
  options: CsvExportOptions = {},
): Promise<void> {
  const text = labelsToCsv(labels, options);
  const bytes = new TextEncoder().encode(text);
  await nodeWriteFile(filename, bytes);
}
