// src/rendering/shapes.ts

import type { MarkerShape, RGB } from "./types.js";
import { rgbToCSS } from "./colors.js";

type DrawMarkerFn = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  edgeColor?: string,
  edgeWidth?: number
) => void;

/**
 * Draw a circle marker.
 */
export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  edgeColor?: string,
  edgeWidth: number = 1
): void {
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);

  ctx.fillStyle = fillColor;
  ctx.fill();

  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}

/**
 * Draw a square marker.
 */
export function drawSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  edgeColor?: string,
  edgeWidth: number = 1
): void {
  const half = size;
  ctx.fillStyle = fillColor;
  ctx.fillRect(x - half, y - half, half * 2, half * 2);

  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  }
}

/**
 * Draw a diamond marker (rotated square).
 */
export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  edgeColor?: string,
  edgeWidth: number = 1
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - size); // Top
  ctx.lineTo(x + size, y); // Right
  ctx.lineTo(x, y + size); // Bottom
  ctx.lineTo(x - size, y); // Left
  ctx.closePath();

  ctx.fillStyle = fillColor;
  ctx.fill();

  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}

/**
 * Draw a triangle marker (pointing up).
 */
export function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  edgeColor?: string,
  edgeWidth: number = 1
): void {
  const h = size * 0.866; // Height factor for equilateral triangle

  ctx.beginPath();
  ctx.moveTo(x, y - size); // Top
  ctx.lineTo(x + size, y + h); // Bottom right
  ctx.lineTo(x - size, y + h); // Bottom left
  ctx.closePath();

  ctx.fillStyle = fillColor;
  ctx.fill();

  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}

/**
 * Draw a cross/plus marker.
 */
export function drawCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  _edgeColor?: string,
  edgeWidth: number = 2
): void {
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = edgeWidth;
  ctx.lineCap = "round";

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}

/** Map of marker shape names to drawing functions */
export const MARKER_FUNCTIONS: Record<MarkerShape, DrawMarkerFn> = {
  circle: drawCircle,
  square: drawSquare,
  diamond: drawDiamond,
  triangle: drawTriangle,
  cross: drawCross,
};

/**
 * Get the drawing function for a marker shape.
 */
export function getMarkerFunction(shape: MarkerShape): DrawMarkerFn {
  return MARKER_FUNCTIONS[shape];
}

/** Options for {@link drawTrails}. */
export interface DrawTrailsOptions {
  /** RGB color used when `colors` is not provided. Default `[0, 255, 0]`. */
  color?: RGB;
  /** Per-trail RGB colors. If set, must match `trails` in length; overrides `color`. */
  colors?: RGB[];
  /** Trail line width in pixels (before `scale`). Default `2`. */
  lineWidth?: number;
  /** Fade opacity from faint (oldest segment) to opaque (newest). Default `true`. */
  alphaFade?: boolean;
  /** Global opacity multiplier (0–1). Default `1`. */
  alpha?: number;
  /** Output scale factor applied to coordinates and line width. Default `1`. */
  scale?: number;
  /** `[ox, oy]` offset subtracted from coordinates (for cropped images). Default `[0, 0]`. */
  offset?: [number, number];
}

/**
 * Draw motion trails as fading polylines on a canvas.
 *
 * Each trail is a polyline tracing a node or centroid position across past
 * frames. Segments are drawn individually so opacity can fade from faint
 * (oldest) to opaque (newest); non-finite points break the line into gaps.
 *
 * Port of Python sleap-io `draw_trails` (PR #434). The Python version rasterizes
 * into a separate `kSrc` buffer so overlapping joints take the newest segment's
 * alpha instead of accumulating it. This canvas port instead strokes each
 * segment directly with per-segment alpha — the same approach the pose-edge
 * renderer already uses — so overlapping joints may blend slightly. The visual
 * difference is negligible for trails and keeps the implementation idiomatic.
 *
 * @param ctx - Canvas 2D context. Coordinates are drawn pre-scaled by `scale`.
 * @param trails - List of trails, each an array of `[x, y]` points ordered
 *   oldest → newest. `NaN` rows break the polyline so missing detections leave
 *   gaps.
 * @param options - See {@link DrawTrailsOptions}.
 * @throws If `colors` is provided and its length does not match `trails`.
 */
export function drawTrails(
  ctx: CanvasRenderingContext2D,
  trails: Array<Array<[number, number] | number[]>>,
  options: DrawTrailsOptions = {}
): void {
  if (trails.length === 0) return;

  const {
    color = [0, 255, 0],
    colors,
    lineWidth = 2,
    alphaFade = true,
    alpha = 1,
    scale = 1,
    offset = [0, 0],
  } = options;

  if (colors !== undefined && colors.length !== trails.length) {
    throw new Error(
      `colors has length ${colors.length} but there are ${trails.length} ` +
        "trails; they must be the same length."
    );
  }

  const [ox, oy] = offset;
  const scaledWidth = lineWidth * scale;

  // Save/restore so we don't leak stroke state to later drawing (e.g. poses).
  const prevLineCap = ctx.lineCap;
  ctx.lineCap = "round";
  ctx.lineWidth = scaledWidth;

  for (let i = 0; i < trails.length; i++) {
    const trail = trails[i];
    const c = colors !== undefined ? colors[i] : color;
    const nPoints = trail.length;
    if (nPoints < 2) continue; // A single point has no segment to draw.

    const nSegments = nPoints - 1;
    for (let k = 0; k < nSegments; k++) {
      const [x0, y0] = trail[k];
      const [x1, y1] = trail[k + 1];
      if (
        !Number.isFinite(x0) ||
        !Number.isFinite(y0) ||
        !Number.isFinite(x1) ||
        !Number.isFinite(y1)
      ) {
        // Skip segments touching a missing (NaN) position.
        continue;
      }

      // Newest segment (k = nSegments - 1) is fully opaque; oldest stays faintly
      // visible rather than fully transparent.
      const segFrac = alphaFade ? Math.max((k + 1) / nSegments, 0.05) : 1.0;
      const segAlpha = Math.max(0, Math.min(1, segFrac * alpha));

      ctx.strokeStyle = rgbToCSS(c as RGB, segAlpha);
      ctx.beginPath();
      ctx.moveTo((x0 - ox) * scale, (y0 - oy) * scale);
      ctx.lineTo((x1 - ox) * scale, (y1 - oy) * scale);
      ctx.stroke();
    }
  }

  ctx.lineCap = prevLineCap;
}
