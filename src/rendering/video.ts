// src/rendering/video.ts

import type { ChildProcess } from "child_process";
import type { Labels } from "../model/labels.js";
import type { LabeledFrame } from "../model/labeled-frame.js";
import type { Video } from "../model/video.js";
import type { Instance, PredictedInstance, Track } from "../model/instance.js";
import type { LabelImage } from "../model/label-image.js";
import type {
  ColorScheme,
  Overlay,
  RenderOptions,
  VideoOptions,
  VideoOverlay,
} from "./types.js";
import { renderImage } from "./render.js";
import { determineColorScheme } from "./colors.js";

/**
 * Check if ffmpeg is available in PATH.
 */
export async function checkFfmpeg(): Promise<boolean> {
  const { spawn } = await import("child_process");
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Render video with pose overlays.
 * Requires ffmpeg to be installed and in PATH.
 *
 * @param source - Labels or array of LabeledFrames to render
 * @param outputPath - Path to save the output video
 * @param options - Video rendering options
 */
export async function renderVideo(
  source: Labels | LabeledFrame[],
  outputPath: string,
  options: VideoOptions = {},
): Promise<void> {
  // Check ffmpeg availability
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    throw new Error(
      "ffmpeg not found. Please install ffmpeg and ensure it is in your PATH.\n" +
        "Installation: https://ffmpeg.org/download.html",
    );
  }

  // Resolve frame selection + the per-frame render-option builder (overlay,
  // resolved color scheme, global track map). Shared with the ffmpeg-free
  // per-frame rendering path so coloring is identical with or without ffmpeg.
  const { selectedFrames, optsForFrame } = buildFrameRenderer(source, options);

  // Get frame dimensions from first frame
  const firstImage = await renderImage(
    selectedFrames[0],
    optsForFrame(selectedFrames[0], 0),
  );
  const width = firstImage.width;
  const height = firstImage.height;

  // Build ffmpeg command
  const fps = options.fps ?? 30;
  const codec = options.codec ?? "libx264";
  const crf = options.crf ?? 25;
  const preset = options.preset ?? "superfast";

  const ffmpegArgs = [
    "-y", // Overwrite output
    "-f",
    "rawvideo", // Input format
    "-pix_fmt",
    "rgba", // Input pixel format
    "-s",
    `${width}x${height}`, // Frame size
    "-r",
    String(fps), // Frame rate
    "-i",
    "pipe:0", // Read from stdin
    "-c:v",
    codec, // Video codec
    "-pix_fmt",
    "yuv420p", // Output pixel format
  ];

  // Add codec-specific options
  if (codec === "libx264") {
    ffmpegArgs.push("-crf", String(crf), "-preset", preset);
  }

  ffmpegArgs.push(outputPath);

  // Spawn ffmpeg process
  const { spawn } = await import("child_process");
  const ffmpeg: ChildProcess = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Handle errors
  let ffmpegError: Error | null = null;
  ffmpeg.on("error", (err) => {
    ffmpegError = err;
  });

  // Optionally capture stderr for debugging
  // ffmpeg.stderr?.on("data", (data) => {
  //   console.error(data.toString());
  // });

  // Render and pipe frames
  const total = selectedFrames.length;

  for (let i = 0; i < selectedFrames.length; i++) {
    if (ffmpegError) {
      throw ffmpegError;
    }

    const frame = selectedFrames[i];
    const imageData = await renderImage(frame, optsForFrame(frame, i));

    // Write raw RGBA data to ffmpeg stdin
    const buffer = Buffer.from(imageData.data.buffer);

    if (!ffmpeg.stdin) {
      throw new Error("ffmpeg stdin not available");
    }

    const canWrite = ffmpeg.stdin.write(buffer);

    // Handle backpressure
    if (!canWrite) {
      await new Promise<void>((resolve) =>
        ffmpeg.stdin?.once("drain", resolve),
      );
    }

    // Progress callback
    if (options.onProgress) {
      options.onProgress(i + 1, total);
    }
  }

  // Close stdin and wait for ffmpeg to finish
  ffmpeg.stdin?.end();

  return new Promise((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", reject);
  });
}

/**
 * The selected frames plus a per-frame `RenderOptions` builder shared by
 * {@link renderVideo} and its ffmpeg-free per-frame rendering path.
 */
export interface FrameRenderer {
  /** Frames to render, after applying `frameInds` / `start` / `end`. */
  selectedFrames: LabeledFrame[];
  /**
   * Build the single-frame `RenderOptions` for `frame` at render `position`.
   * Resolves the per-frame overlay, the video-level color scheme, and the
   * global track -> index map (all computed once for the whole pass).
   */
  optsForFrame: (frame: LabeledFrame, position: number) => RenderOptions;
}

/**
 * Resolve the frame selection and per-frame render-option builder for a video
 * render pass.
 *
 * Extracted from {@link renderVideo} so the SAME coloring code path (per-frame
 * overlay resolution, the video-level resolved color scheme, and the global
 * track -> index map) can be exercised without ffmpeg: render each frame with
 * `renderImage(frame, optsForFrame(frame, i))`. The global track map keys
 * overlay (mask / ROI / bbox) and pose colors off the project's `Labels.tracks`
 * (stable across frames), so a mask's color follows its GLOBAL track identity
 * rather than its per-frame position within `frame.masks` (fixes JS #162
 * flicker). Mirrors Python render_video `_track_idx_map` (core.py L1929-1934).
 */
export function buildFrameRenderer(
  source: Labels | LabeledFrame[],
  options: VideoOptions = {},
): FrameRenderer {
  // Extract labeled frames
  const frames = Array.isArray(source) ? source : source.labeledFrames;

  // Apply frame selection
  let selectedFrames = frames;
  if (options.frameInds) {
    selectedFrames = options.frameInds
      .map((i) => frames[i])
      .filter((f): f is LabeledFrame => f !== undefined);
  } else if (options.start !== undefined || options.end !== undefined) {
    const start = options.start ?? 0;
    const end = options.end ?? frames.length;
    selectedFrames = frames.slice(start, end);
  }

  if (selectedFrames.length === 0) {
    throw new Error("No frames to render");
  }

  // Resolve the per-frame overlay parameter (mirrors Python render_video,
  // core.py L1719-1754). Auto-detect: when no explicit overlay is given and a
  // Labels source has label images for the rendered video, use them as a
  // per-frame LabelImage[] (indexed by render position). Mirrors core.py
  // L1549-1556.
  let videoOverlay: VideoOverlay | undefined = options.overlay;
  if (
    videoOverlay === undefined &&
    !Array.isArray(source) &&
    source.labelImages.length > 0
  ) {
    const targetVideo = selectedFrames[0].video;
    const videoLabelImages = source.getLabelImages({ video: targetVideo });
    if (videoLabelImages.length > 0) {
      videoOverlay = videoLabelImages;
    }
  }
  // Auto-use segmentation masks as overlay when no explicit overlay (and no
  // label images) resolved. Masks live on specific frames at arbitrary frame
  // indices, so resolve them per-frame via a callable keyed by the source frame
  // index rather than a position-indexed list. label images take precedence
  // (resolved above). Mirrors Python render_video (core.py L1572-1588).
  if (
    videoOverlay === undefined &&
    !Array.isArray(source) &&
    source.masks.length > 0
  ) {
    const targetVideo = selectedFrames[0].video;
    const labels = source;
    if (labels.getMasks({ video: targetVideo }).length > 0) {
      videoOverlay = (frameIdx: number) =>
        labels.getMasks({ video: targetVideo, frameIdx });
    }
  }
  const overlayForFrame = makeOverlayResolver(videoOverlay);

  // Build per-video temporal context for motion trails once (keyed by frame
  // index), using ALL source frames so a trail can reach back before the
  // selected range. Each rendered frame then gets its video's frame map.
  const framesByVideo = new Map<Video, Map<number, LabeledFrame>>();
  // Shared points cache + canonical track list (computed once, like Python's
  // render_video) so trail colors are stable across the whole pass and we avoid
  // re-extracting instance points across overlapping trail windows.
  const trailPtsCache = options.showTrails
    ? new Map<Instance | PredictedInstance, number[][]>()
    : undefined;
  const canonicalTracks = Array.isArray(source) ? undefined : source.tracks;

  // Resolve the color scheme ONCE at the video level (mirrors Python
  // render_video, core.py L1754-1758): keyed off the project's global track
  // list so a mask-/centroid-only tracked project resolves "auto" -> "track".
  // The resolved scheme is then passed to each frame's renderImage so a bare
  // per-frame LabeledFrame (which has no `.tracks`) does not fall back to
  // positional "instance"/"node" coloring.
  const globalTracks: Track[] = canonicalTracks ?? [];
  const hasTracks = globalTracks.length > 0;
  const resolvedScheme: ColorScheme = determineColorScheme(
    options.colorBy ?? "auto",
    hasTracks,
    false,
  );
  // Global track -> index map (stable across frames) used to color overlay
  // elements (masks/ROIs/bboxes) by track identity. Mirrors Python
  // render_video `_track_idx_map` (core.py L1929-1934). Keyed off the project
  // track list so a mask's color follows its GLOBAL track identity rather than
  // its per-frame position within `frame.masks` (fixes flicker, JS #162).
  const overlayTrackIndexMap: Map<Track, number> | undefined = hasTracks
    ? new Map(globalTracks.map((t, i) => [t, i]))
    : undefined;

  if (options.showTrails) {
    for (const lf of frames) {
      let videoFrames = framesByVideo.get(lf.video);
      if (!videoFrames) {
        videoFrames = new Map<number, LabeledFrame>();
        framesByVideo.set(lf.video, videoFrames);
      }
      videoFrames.set(lf.frameIdx, lf);
    }
  }
  // Build the per-frame render options. Overlay is resolved per frame (static
  // value, position-indexed list, frame-index-keyed Map, or callable) and
  // passed through as the single-frame `overlay` that renderImage understands.
  const optsForFrame = (
    frame: LabeledFrame,
    position: number,
  ): RenderOptions => {
    // Strip the video-level (per-frame) `overlay` so the spread does not leak a
    // `VideoOverlay` into the single-frame `RenderOptions`; it is replaced by
    // the resolved single-frame overlay below.
    const { overlay: _ignored, ...rest } = options;
    void _ignored;
    const base: RenderOptions = options.showTrails
      ? {
          ...rest,
          trailFrames: framesByVideo.get(frame.video),
          trailTracks: options.trailTracks ?? canonicalTracks,
          trailPtsCache,
        }
      : { ...rest };
    base.overlay = overlayForFrame(frame, position);
    // Pass the video-level resolved color scheme and global track->index map so
    // each bare per-frame LabeledFrame still colors poses AND overlay elements
    // by GLOBAL track identity (stable across frames), instead of resolving
    // "auto" per frame or coloring overlays by per-frame list position.
    base.colorBy = resolvedScheme;
    base.overlayTrackIndexMap = overlayTrackIndexMap;
    return base;
  };

  return { selectedFrames, optsForFrame };
}

/** Whether a value is a `LabelImage`-like object (Int32Array-backed `data`). */
function isLabelImageLike(value: unknown): value is LabelImage {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    (value as { data: unknown }).data instanceof Int32Array
  );
}

/** Whether a value is a non-empty `LabelImage[]` (per-frame, position-indexed). */
function isLabelImageList(value: unknown): value is LabelImage[] {
  return Array.isArray(value) && value.length > 0 && isLabelImageLike(value[0]);
}

/**
 * Build a per-frame overlay resolver from the (already auto-detected) video
 * overlay parameter. Mirrors Python `_get_frame_overlay` (core.py L1732-1754):
 *
 * - `undefined` -> no overlay on any frame.
 * - callable `(frameIdx) => Overlay | undefined` -> invoked with the source
 *   frame index for each frame.
 * - `Map<number, Overlay>` -> keyed by the source frame index
 *   (`LabeledFrame.frameIdx`); missing keys yield no overlay.
 * - `LabelImage[]` -> indexed by the frame's render position; out-of-range
 *   positions yield no overlay.
 * - any other static {@link Overlay} (single `LabelImage`, or a list of
 *   `SegmentationMask` / `ROI` / `BoundingBox`) -> applied to every frame.
 *
 * The resolver returns the single-frame `Overlay` consumed by renderImage.
 */
function makeOverlayResolver(
  overlay: VideoOverlay | undefined,
): (frame: LabeledFrame, position: number) => Overlay | undefined {
  if (overlay === undefined) {
    return () => undefined;
  }
  if (typeof overlay === "function") {
    const fn = overlay as (frameIdx: number) => Overlay | undefined;
    return (frame) => fn(frame.frameIdx);
  }
  if (overlay instanceof Map) {
    const map = overlay as Map<number, Overlay>;
    return (frame) => map.get(frame.frameIdx);
  }
  if (isLabelImageList(overlay)) {
    const list = overlay;
    return (_frame, position) =>
      position < list.length ? list[position] : undefined;
  }
  // Static overlay (single LabelImage or a list of masks/rois/bboxes) applied
  // to every frame.
  const staticOverlay = overlay as Overlay;
  return () => staticOverlay;
}
