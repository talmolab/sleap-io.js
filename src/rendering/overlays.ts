// src/rendering/overlays.ts
//
// Node-only VECTOR overlay drawing for bounding boxes and ROI geometries, plus
// the `applyOverlay` dispatcher. This is a faithful port of Python sleap-io's
// `sleap_io/rendering/overlays.py` (PR #374) plus the `_apply_overlay`
// dispatcher from `core.py`.
//
// The RASTER overlays (segmentation masks, integer label images) live in the
// browser-safe `overlays-raster.ts` and are re-exported here so existing Node
// importers are unaffected. Vector overlays draw through an internal skia-canvas
// `Canvas` (putImageData -> path ops -> getImageData -> copy back), which is why
// they remain Node-only; raster overlays blend pixels directly on the
// `Uint8ClampedArray` and so work in the browser too.
//
// All functions operate on an `ImageData` (RGBA, row-major), mutate
// `image.data` in place, and return the same `ImageData` for chaining. The
// alpha channel is always left at 255.

import type { SegmentationMask } from "../model/mask.js";
import type { LabelImage } from "../model/label-image.js";
import type { BoundingBox } from "../model/bbox.js";
import type { ROI, Geometry } from "../model/roi.js";
import type { RGB, PaletteName } from "./types.js";
import { getPalette, rgbToCSS } from "./colors.js";
import { createRequire } from "node:module";
import {
  drawMasks,
  drawLabelImage,
  clampAlpha,
  pickColor,
  type RawLabelImage,
} from "./overlays-raster.js";

// Re-export the browser-safe raster overlays so existing importers of
// `overlays.js` (rendering/index.ts, rendering/types.ts) keep resolving them
// here. The implementations live in `overlays-raster.ts` (no Node deps) and are
// also surfaced from the browser entry.
export { drawMasks, drawLabelImage } from "./overlays-raster.js";
export type { RawLabelImage } from "./overlays-raster.js";

// Synchronous, ESM-safe handle to the Node-only skia-canvas module. Created
// lazily on first vector draw so importing this module never eagerly loads
// skia-canvas (it remains an external/optional dependency, browser-excluded).
const requireCjs = createRequire(import.meta.url);
let _skiaCanvas: typeof import("skia-canvas") | null = null;
function getSkiaCanvas(): typeof import("skia-canvas") {
  if (_skiaCanvas === null) {
    _skiaCanvas = requireCjs("skia-canvas") as typeof import("skia-canvas");
  }
  return _skiaCanvas;
}

/** Stroke style used by vector overlays (square caps, no anti-alias). */
function configureStroke(
  ctx: CanvasRenderingContext2D,
  rgb: RGB,
  lineWidth: number,
): void {
  ctx.strokeStyle = rgbToCSS(rgb);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "square";
}

/**
 * Draw bounding boxes on an image.
 *
 * Each box is drawn as a closed path through its (rotation-aware) corners, with
 * an optional translucent fill, and—for `PredictedBoundingBox`—a "score" label
 * near the top-left corner. Rendered through an internal skia-canvas `Canvas`.
 * Port of `draw_bboxes` (overlays.py L363-510).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param bboxes - Bounding boxes to draw.
 * @param opts - `color` (default [0,255,0]), per-bbox `colors`, `lineWidth`
 *   (2), `fillAlpha` (0).
 * @returns The same ImageData.
 */
export function drawBboxes(
  image: ImageData,
  bboxes: BoundingBox[],
  opts?: {
    color?: RGB;
    colors?: RGB[];
    lineWidth?: number;
    fillAlpha?: number;
  },
): ImageData {
  if (bboxes.length === 0) return image;

  const color = opts?.color ?? [0, 255, 0];
  const colors = opts?.colors ?? null;
  const lineWidth = opts?.lineWidth ?? 2;
  const fillAlpha = clampAlpha(opts?.fillAlpha ?? 0);

  return withVectorCanvas(image, (ctx) => {
    for (let i = 0; i < bboxes.length; i++) {
      const bbox = bboxes[i];
      const c = pickColor(colors, i, color);
      const corners = bbox.corners;
      if (corners.length === 0) continue;

      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (let j = 1; j < corners.length; j++) {
        ctx.lineTo(corners[j][0], corners[j][1]);
      }
      ctx.closePath();

      if (fillAlpha > 0) {
        ctx.fillStyle = rgbToCSS(c, fillAlpha);
        ctx.fill();
      }
      configureStroke(ctx, c, lineWidth);
      ctx.stroke();

      // Score text for predicted bboxes (drawn near the top-left corner).
      if (bbox.isPredicted) {
        const score = (bbox as BoundingBox & { score: number }).score;
        ctx.font = "12px sans-serif";
        ctx.fillStyle = rgbToCSS(c);
        ctx.fillText(score.toFixed(2), corners[0][0], corners[0][1] - 5);
      }
    }
  });
}

/**
 * Draw ROI geometries on an image.
 *
 * Renders each ROI's GeoJSON geometry: polygons (with even-odd holes), points
 * and multipoints (filled circles, radius = max(lineWidth, 2)), and line
 * strings. Rendered through an internal skia-canvas `Canvas`. Port of
 * `draw_rois` + `_draw_geometry` (overlays.py L22-112, L513-640).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param rois - ROIs to draw.
 * @param opts - `color` (default [0,255,0]), per-ROI `colors`, `lineWidth` (2),
 *   `fillAlpha` (0).
 * @returns The same ImageData.
 */
export function drawRois(
  image: ImageData,
  rois: ROI[],
  opts?: {
    color?: RGB;
    colors?: RGB[];
    lineWidth?: number;
    fillAlpha?: number;
  },
): ImageData {
  if (rois.length === 0) return image;

  const color = opts?.color ?? [0, 255, 0];
  const colors = opts?.colors ?? null;
  const lineWidth = opts?.lineWidth ?? 2;
  const fillAlpha = clampAlpha(opts?.fillAlpha ?? 0);

  return withVectorCanvas(image, (ctx) => {
    for (let i = 0; i < rois.length; i++) {
      const c = pickColor(colors, i, color);
      drawGeometry(ctx, rois[i].geometry, c, lineWidth, fillAlpha);
    }
  });
}

/**
 * Recursively draw a GeoJSON geometry on a canvas context.
 *
 * Port of `_draw_geometry` (overlays.py L513-580). Polygon holes use the
 * even-odd fill rule; points/multipoints draw filled circles of radius
 * `max(lineWidth, 2)`.
 */
function drawGeometry(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry,
  rgb: RGB,
  lineWidth: number,
  fillAlpha: number,
): void {
  switch (geometry.type) {
    case "Polygon": {
      polygonToPath(ctx, geometry.coordinates);
      if (fillAlpha > 0) {
        ctx.fillStyle = rgbToCSS(rgb, fillAlpha);
        ctx.fill("evenodd");
      }
      configureStroke(ctx, rgb, lineWidth);
      ctx.stroke();
      break;
    }
    case "MultiPolygon": {
      for (const polygon of geometry.coordinates) {
        polygonToPath(ctx, polygon);
        if (fillAlpha > 0) {
          ctx.fillStyle = rgbToCSS(rgb, fillAlpha);
          ctx.fill("evenodd");
        }
        configureStroke(ctx, rgb, lineWidth);
        ctx.stroke();
      }
      break;
    }
    case "Point": {
      const radius = Math.max(lineWidth, 2);
      ctx.beginPath();
      ctx.arc(
        geometry.coordinates[0],
        geometry.coordinates[1],
        radius,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = rgbToCSS(rgb);
      ctx.fill();
      break;
    }
    case "MultiPoint": {
      const radius = Math.max(lineWidth, 2);
      ctx.fillStyle = rgbToCSS(rgb);
      for (const pt of geometry.coordinates) {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], radius, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "LineString": {
      const coords = geometry.coordinates;
      if (coords.length > 0) {
        ctx.beginPath();
        ctx.moveTo(coords[0][0], coords[0][1]);
        for (let i = 1; i < coords.length; i++) {
          ctx.lineTo(coords[i][0], coords[i][1]);
        }
        configureStroke(ctx, rgb, lineWidth);
        ctx.stroke();
      }
      break;
    }
    case "GeometryCollection": {
      for (const sub of geometry.geometries) {
        drawGeometry(ctx, sub, rgb, lineWidth, fillAlpha);
      }
      break;
    }
  }
}

/**
 * Build a polygon path (exterior + interior holes) on the context.
 *
 * Each ring is a closed sub-path. With the even-odd fill rule, interior rings
 * cut holes out of the exterior. Port of `_polygon_to_path` (overlays.py
 * L583-620).
 */
function polygonToPath(
  ctx: CanvasRenderingContext2D,
  rings: number[][][],
): void {
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length === 0) continue;
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(ring[i][0], ring[i][1]);
    }
    ctx.closePath();
  }
}

/**
 * Run a vector-drawing callback against the image through an internal
 * skia-canvas `Canvas`, copying the result back into `image.data` in place.
 *
 * Mirrors the Python pattern of padding to RGBA, drawing on a skia surface, and
 * copying RGB channels back. Here we keep the alpha channel at 255.
 */
function withVectorCanvas(
  image: ImageData,
  draw: (ctx: CanvasRenderingContext2D) => void,
): ImageData {
  const { Canvas } = getSkiaCanvas();
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(image as any, 0, 0);

  draw(ctx);

  const result = ctx.getImageData(0, 0, image.width, image.height);
  // Copy RGB channels back; keep alpha at 255 to match the raster path.
  const src = result.data;
  const dst = image.data;
  for (let i = 0; i < dst.length; i += 4) {
    dst[i] = src[i];
    dst[i + 1] = src[i + 1];
    dst[i + 2] = src[i + 2];
    dst[i + 3] = 255;
  }
  return image;
}

/** Runtime guard for a LabelImage-like object (has Int32Array `data`). */
function isLabelImageLike(value: unknown): value is LabelImage | RawLabelImage {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    (value as { data: unknown }).data instanceof Int32Array &&
    "width" in value &&
    "height" in value
  );
}

/** Runtime guard for a SegmentationMask (has `rleCounts` / `data` Uint8Array). */
function isSegmentationMask(value: unknown): value is SegmentationMask {
  return (
    typeof value === "object" &&
    value !== null &&
    "rleCounts" in value &&
    "hasSpatialTransform" in value
  );
}

/** Runtime guard for a BoundingBox (has `corners` and `x1`/`x2`). */
function isBoundingBox(value: unknown): value is BoundingBox {
  return (
    typeof value === "object" &&
    value !== null &&
    "corners" in value &&
    "x1" in value &&
    "x2" in value
  );
}

/** Runtime guard for an ROI (has GeoJSON `geometry`). */
function isROI(value: unknown): value is ROI {
  return (
    typeof value === "object" &&
    value !== null &&
    "geometry" in value &&
    typeof (value as { geometry: unknown }).geometry === "object"
  );
}

/**
 * Apply an annotation overlay to an image, dispatching by type.
 *
 * Mirrors Python `_apply_overlay` (core.py L473-566): a `LabelImage` (or raw
 * Int32Array-backed object) routes to {@link drawLabelImage}; a non-empty list
 * routes to {@link drawMasks} / {@link drawRois} / {@link drawBboxes} with
 * per-item palette colors. A `list[LabelImage]` raises (per-frame dispatch must
 * happen at the renderVideo level), and unknown element types raise.
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param overlay - A LabelImage, or a list of SegmentationMask / ROI / BoundingBox.
 * @param opts - `alpha` (0.3), `palette` ("distinct"), `outline` (false),
 *   `outlineWidth` (1), `outlineColor` (null), plus optional per-element
 *   `colors` for a list overlay. When `colors` is provided it overrides the
 *   positional `palette` coloring (used by callers to color overlays by track
 *   identity); it must match the overlay length and is ignored for label
 *   images. Mirrors Python `_apply_overlay` (core.py L473-566, PR #470).
 * @returns The same ImageData.
 */
export function applyOverlay(
  image: ImageData,
  overlay:
    | LabelImage
    | RawLabelImage
    | SegmentationMask
    | ROI
    | BoundingBox
    | SegmentationMask[]
    | ROI[]
    | BoundingBox[],
  opts?: {
    alpha?: number;
    palette?: PaletteName | string;
    outline?: boolean;
    outlineWidth?: number;
    outlineColor?: RGB | null;
    colors?: RGB[] | null;
  },
): ImageData {
  const alpha = clampAlpha(opts?.alpha ?? 0.3);
  const palette = opts?.palette ?? "distinct";
  const outline = opts?.outline ?? false;
  const outlineWidth = opts?.outlineWidth ?? 1;
  const outlineColor = opts?.outlineColor ?? null;
  const explicitColors = opts?.colors ?? null;

  // A single overlay object: a LabelImage takes its own raster path; a bare
  // SegmentationMask / ROI / BoundingBox is wrapped into a one-element list and
  // falls through to the list dispatch below (sleap-io PR #505). Anything else
  // is a no-op.
  if (!Array.isArray(overlay)) {
    if (isLabelImageLike(overlay)) {
      drawLabelImage(image, overlay, {
        alpha,
        palette,
        outline,
        outlineWidth,
        outlineColor,
      });
      return image;
    }
    if (isSegmentationMask(overlay)) overlay = [overlay];
    else if (isROI(overlay)) overlay = [overlay];
    else if (isBoundingBox(overlay)) overlay = [overlay];
    else return image;
  }

  // Empty list is a no-op.
  if (overlay.length === 0) return image;

  const first = overlay[0];

  // list[LabelImage] is not allowed here; per-frame dispatch belongs to video.
  if (isLabelImageLike(first)) {
    throw new TypeError(
      "Pass individual LabelImage objects to applyOverlay, not a list. " +
        "Per-frame dispatch from a list[LabelImage] should happen at the " +
        "renderVideo level.",
    );
  }

  // Explicit per-element colors (e.g. track-keyed) override positional palette.
  const colors = explicitColors ?? getPalette(palette, overlay.length);

  if (isSegmentationMask(first)) {
    drawMasks(image, overlay as SegmentationMask[], { colors, alpha });
  } else if (isROI(first)) {
    drawRois(image, overlay as ROI[], { colors, fillAlpha: alpha });
  } else if (isBoundingBox(first)) {
    drawBboxes(image, overlay as BoundingBox[], { colors, fillAlpha: alpha });
  } else {
    throw new TypeError(
      `Unsupported overlay element type: ${
        (first as { constructor?: { name?: string } })?.constructor?.name ??
        typeof first
      }. Expected SegmentationMask, ROI, or BoundingBox.`,
    );
  }

  return image;
}
