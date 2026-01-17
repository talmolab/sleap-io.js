// src/rendering/types.ts

import type { RenderContext } from "./context.js";
import type { InstanceContext } from "./context.js";

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
