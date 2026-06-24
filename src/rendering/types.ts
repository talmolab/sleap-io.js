// src/rendering/types.ts

import type { RenderContext } from "./context.js";
import type { InstanceContext } from "./context.js";
import type { LabeledFrame } from "../model/labeled-frame.js";
import type { Instance, PredictedInstance, Track } from "../model/instance.js";
import type { SegmentationMask } from "../model/mask.js";
import type { LabelImage } from "../model/label-image.js";
import type { BoundingBox } from "../model/bbox.js";
import type { ROI } from "../model/roi.js";
import type { RawLabelImage } from "./overlays.js";

/**
 * A single-frame annotation overlay applied before poses are drawn.
 *
 * Mirrors Python `_apply_overlay` dispatch (core.py L473-566): a `LabelImage`
 * (or a raw `Int32Array`-backed object) routes to the label-image raster path;
 * a list of `SegmentationMask` / `ROI` / `BoundingBox` routes to the
 * corresponding draw function with per-item palette colors.
 */
export type Overlay =
  | LabelImage
  | RawLabelImage
  | SegmentationMask[]
  | ROI[]
  | BoundingBox[];

/** RGB color as [r, g, b] with values 0-255 */
export type RGB = [number, number, number];

/** RGBA color as [r, g, b, a] with values 0-255 */
export type RGBA = [number, number, number, number];

/** Flexible color specification */
export type ColorSpec =
  | RGB // [255, 128, 0]
  | RGBA // [255, 128, 0, 128]
  | string // 'red', '#ff8000', 'rgb(255,128,0)', 'tableau10[2]'
  | number; // Grayscale 0-255

/** Available color schemes */
export type ColorScheme = "track" | "instance" | "node" | "auto";

/** Built-in palette names */
export type PaletteName =
  | "standard"
  | "distinct"
  | "tableau10"
  | "viridis"
  | "rainbow"
  | "warm"
  | "cool"
  | "pastel"
  | "seaborn";

/** Marker shape types */
export type MarkerShape =
  | "circle"
  | "square"
  | "diamond"
  | "triangle"
  | "cross";

/** Render options for renderImage() */
export interface RenderOptions {
  // Appearance
  colorBy?: ColorScheme;
  palette?: PaletteName | string;
  markerShape?: MarkerShape;
  markerSize?: number; // Default: 4
  lineWidth?: number; // Default: 2
  alpha?: number; // Default: 1.0 (0-1 range)
  showNodes?: boolean; // Default: true
  showEdges?: boolean; // Default: true
  scale?: number; // Default: 1.0

  // Motion trails (trace a node/centroid trajectory over the last N frames).
  // Trails need temporal context, so they are only drawn when `source` is a
  // `Labels` object or when `trailFrames` provides sibling frames; they are a
  // no-op for an instance-list source.
  showTrails?: boolean; // Default: false
  trailLength?: number; // Default: 10 (past frames behind the current frame)
  trailNode?: string | string[]; // Default: "centroid" (or a node name / list)
  trailWidth?: number; // Default: 2.0 (line width in pixels)
  trailAlphaFade?: boolean; // Default: true (fade oldest -> newest)
  trailAlpha?: number; // Default: 1.0 (global opacity multiplier, 0-1)
  trailColor?: ColorSpec | null; // Default: null (match pose colors)
  /**
   * Advanced: temporal context for trails when `source` is a single
   * `LabeledFrame`. Pass all of the video's labeled frames (a `Map` keyed by
   * frame index is the efficient form; an array is also accepted). Auto-derived
   * when `source` is a `Labels`, and populated per video by `renderVideo`.
   */
  trailFrames?: LabeledFrame[] | Map<number, LabeledFrame>;
  /**
   * Advanced: canonical track list used to key and color trails (mirrors
   * Python keying off `Labels.tracks`). Auto-derived from `Labels.tracks` for a
   * `Labels` source; populated by `renderVideo` for a `Labels` source. Falls
   * back to the tracks discovered in `trailFrames` when omitted.
   */
  trailTracks?: Track[];
  /**
   * Advanced: shared cache mapping an instance to its extracted points, reused
   * across the overlapping trail windows of consecutive frames. Populated once
   * per render by `renderVideo` to avoid recomputing instance points.
   */
  trailPtsCache?: Map<Instance | PredictedInstance, number[][]>;
  /**
   * Advanced: global track -> index map used to color overlay elements
   * (masks / ROIs / bboxes) by track identity under `colorBy: "track"`, keyed
   * off the project's `Labels.tracks` (stable across frames). Populated by
   * `renderVideo` so a bare per-frame `LabeledFrame` still gets GLOBAL
   * track-identity overlay colors instead of per-frame positional colors
   * (mirrors Python render_video `_track_idx_map`, fixing JS #162 flicker).
   * For a `Labels` source this is derived automatically from `Labels.tracks`.
   */
  overlayTrackIndexMap?: Map<Track, number> | null;

  // Background
  background?: "transparent" | ColorSpec;
  image?: ImageData | null;

  // Segmentation / annotation overlay (applied AFTER the background and BEFORE
  // trails and poses, mirroring Python render_image L1159-1180). Node-only:
  // overlay drawing lives in the raster render path and is not part of the
  // browser entry. See `applyOverlay` in overlays.ts.
  /**
   * Annotation overlay drawn behind the poses: a single `LabelImage` (or a raw
   * `Int32Array`-backed object), or a list of `SegmentationMask` / `ROI` /
   * `BoundingBox`. Overlay coordinates are in source pixels and are scaled to
   * match the poses (see `scale`). Default: undefined (no overlay).
   */
  overlay?: Overlay;
  overlayAlpha?: number; // Default: 0.3 (fill opacity, 0-1)
  overlayPalette?: PaletteName | string; // Default: "distinct"
  overlayOutline?: boolean; // Default: false (label images only)
  overlayOutlineWidth?: number; // Default: 1 (pixels, label images only)
  overlayOutlineColor?: RGB | null; // Default: null (darkened per-label color)

  // Frame size (required if no image provided)
  width?: number;
  height?: number;

  // Callbacks (canvas is CanvasRenderingContext2D)
  preRenderCallback?: (ctx: RenderContext) => void;
  postRenderCallback?: (ctx: RenderContext) => void;
  perInstanceCallback?: (ctx: InstanceContext) => void;
}

/**
 * Per-frame overlay resolved for each rendered frame of a video.
 *
 * Mirrors Python render_video overlay dispatch (core.py L1719-1754):
 * - A static {@link Overlay} (single `LabelImage` or a list of masks/rois/bboxes)
 *   is applied to every frame.
 * - `LabelImage[]` is indexed by the position of the frame in the render
 *   sequence (one label image per frame); out-of-range frames get no overlay.
 * - A `Map<number, Overlay>` is keyed by the source frame index
 *   (`LabeledFrame.frameIdx`); missing keys get no overlay.
 * - A callable `(frameIdx) => Overlay | undefined` is invoked per frame with the
 *   source frame index, returning that frame's overlay (or `undefined`).
 */
export type VideoOverlay =
  | Overlay
  | LabelImage[]
  | Map<number, Overlay>
  | ((frameIdx: number) => Overlay | undefined);

/** Video rendering options (extends RenderOptions) */
export interface VideoOptions extends Omit<RenderOptions, "overlay"> {
  /**
   * Per-frame annotation overlay. See {@link VideoOverlay}. A single static
   * overlay applies to every frame; a `LabelImage[]` is indexed by render
   * position; a `Map` is keyed by source frame index; a callable is invoked per
   * frame. Mirrors Python render_video (core.py L1719-1754).
   */
  overlay?: VideoOverlay;

  // Frame selection
  frameInds?: number[];
  start?: number;
  end?: number;

  // Encoding
  fps?: number; // Default: from source video or 30
  codec?: string; // Default: 'libx264'
  crf?: number; // Default: 25
  preset?: string; // Default: 'superfast'

  // Progress
  onProgress?: (current: number, total: number) => void;
}
