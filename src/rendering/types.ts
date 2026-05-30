// src/rendering/types.ts

import type { RenderContext } from "./context.js";
import type { InstanceContext } from "./context.js";
import type { LabeledFrame } from "../model/labeled-frame.js";
import type { Instance, PredictedInstance, Track } from "../model/instance.js";

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

  // Background
  background?: "transparent" | ColorSpec;
  image?: ImageData | null;

  // Frame size (required if no image provided)
  width?: number;
  height?: number;

  // Callbacks (canvas is CanvasRenderingContext2D)
  preRenderCallback?: (ctx: RenderContext) => void;
  postRenderCallback?: (ctx: RenderContext) => void;
  perInstanceCallback?: (ctx: InstanceContext) => void;
}

/** Video rendering options (extends RenderOptions) */
export interface VideoOptions extends RenderOptions {
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
