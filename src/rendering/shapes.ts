// src/rendering/shapes.ts

import type { MarkerShape } from "./types.js";

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
