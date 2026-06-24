// src/rendering/overlays.ts
//
// Node-only raster/vector overlay drawing for segmentation masks, integer
// label images, bounding boxes, and ROI geometries. This is a faithful port of
// Python sleap-io's `sleap_io/rendering/overlays.py` (PR #374) plus the
// `_apply_overlay` dispatcher from `core.py`.
//
// All functions operate on an `ImageData` (RGBA, row-major), mutate
// `image.data` in place, and return the same `ImageData` for chaining. The
// alpha channel is always left at 255. Raster overlays (masks, label images)
// blend pixels directly on the `Uint8ClampedArray`; vector overlays (bboxes,
// ROIs) draw through an internal skia-canvas `Canvas` (putImageData -> path
// ops -> getImageData -> copy back).
//
// Browser / OffscreenCanvas compositing is intentionally out of scope: these
// functions are exported from `index.ts` (Node) only, never `index.browser.ts`.

import type { SegmentationMask } from "../model/mask.js";
import { resizeNearest } from "../model/mask.js";
import type { LabelImage } from "../model/label-image.js";
import type { BoundingBox } from "../model/bbox.js";
import type { ROI, Geometry } from "../model/roi.js";
import type { RGB, PaletteName } from "./types.js";
import { getPalette, rgbToCSS } from "./colors.js";
import { createRequire } from "node:module";

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

/** A minimal raw label-image overlay (no spatial-transform object wrapper). */
export interface RawLabelImage {
  data: Int32Array;
  width: number;
  height: number;
  scale?: [number, number];
  offset?: [number, number];
}

/** Blend a single uint8 channel value: dst*(1-a) + src*a, floored to uint8. */
function blendChannel(dst: number, src: number, alpha: number): number {
  return Math.trunc(dst * (1 - alpha) + src * alpha);
}

/** Clamp a blend opacity to [0, 1]; non-finite inputs fall back to 0. */
function clampAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) return 0;
  return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
}

/**
 * Pick the per-item color for index `i`. When an explicit `colors` array is
 * shorter than the item list it cycles (`colors[i % colors.length]`) rather
 * than indexing out of bounds; an empty array falls back to `fallback`.
 */
function pickColor(colors: RGB[] | null, i: number, fallback: RGB): RGB {
  if (colors === null || colors.length === 0) return fallback;
  return colors[i % colors.length];
}

/**
 * Draw segmentation masks as colored overlays on an image.
 *
 * For each mask, the masked pixels are alpha-blended toward the mask color.
 * Spatial transforms (scale/offset) are honored: the binary mask is resized
 * (nearest-neighbor) to its image extent, placed at its offset, and clipped to
 * the image bounds. Port of `draw_masks` (overlays.py L115-176).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param masks - Segmentation masks to draw.
 * @param opts - `color` (default [255,0,0]), per-mask `colors`, `alpha` (0.3).
 * @returns The same ImageData.
 */
export function drawMasks(
  image: ImageData,
  masks: SegmentationMask[],
  opts?: { color?: RGB; colors?: RGB[]; alpha?: number },
): ImageData {
  const color = opts?.color ?? [255, 0, 0];
  const colors = opts?.colors ?? null;
  const alpha = clampAlpha(opts?.alpha ?? 0.3);

  const imgW = image.width;
  const imgH = image.height;
  const pixels = image.data;

  for (let i = 0; i < masks.length; i++) {
    const mask = masks[i];
    const maskColor = pickColor(colors, i, color);
    const maskData = mask.data; // binary 0/1, row-major (mask.height x mask.width)

    let region: Uint8Array; // binary mask aligned to a placement window
    let x0: number;
    let y0: number;
    let drawW: number;
    let drawH: number;

    if (mask.hasSpatialTransform) {
      // Resize the binary mask to its image-space extent then place at offset.
      const ext = mask.imageExtent;
      const targetH = ext.height;
      const targetW = ext.width;
      const resized = resizeNearest(
        maskData,
        mask.height,
        mask.width,
        targetH,
        targetW,
      );

      const ox = Math.trunc(mask.offset[0]);
      const oy = Math.trunc(mask.offset[1]);
      y0 = Math.max(0, oy);
      x0 = Math.max(0, ox);
      const y1 = Math.min(imgH, oy + targetH);
      const x1 = Math.min(imgW, ox + targetW);

      if (y1 <= y0 || x1 <= x0) continue;

      drawH = y1 - y0;
      drawW = x1 - x0;

      // Crop the resized mask to the visible window (handles negative offset).
      const my0 = y0 - oy;
      const mx0 = x0 - ox;
      region = new Uint8Array(drawH * drawW);
      for (let r = 0; r < drawH; r++) {
        const srcRow = (my0 + r) * targetW + mx0;
        region.set(resized.subarray(srcRow, srcRow + drawW), r * drawW);
      }
    } else {
      drawH = Math.min(mask.height, imgH);
      drawW = Math.min(mask.width, imgW);
      x0 = 0;
      y0 = 0;
      // Crop top-left window of the mask into a tight buffer.
      region = new Uint8Array(drawH * drawW);
      for (let r = 0; r < drawH; r++) {
        const srcRow = r * mask.width;
        region.set(maskData.subarray(srcRow, srcRow + drawW), r * drawW);
      }
    }

    const [cr, cg, cb] = maskColor;
    for (let r = 0; r < drawH; r++) {
      for (let c = 0; c < drawW; c++) {
        if (region[r * drawW + c] === 0) continue;
        const px = ((y0 + r) * imgW + (x0 + c)) * 4;
        pixels[px] = blendChannel(pixels[px], cr, alpha);
        pixels[px + 1] = blendChannel(pixels[px + 1], cg, alpha);
        pixels[px + 2] = blendChannel(pixels[px + 2], cb, alpha);
      }
    }
  }

  return image;
}

/**
 * Draw an integer label image as a colored overlay on an image.
 *
 * Builds a per-label color LUT (label_id -> palette[label_id % len]), blends
 * foreground pixels (label > 0) toward their color, and optionally draws region
 * outlines. Spatial transforms (scale/offset) are honored via nearest-neighbor
 * resize + offset placement + clip. Port of `draw_label_image` (overlays.py
 * L179-293).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param labels - A `LabelImage` or a raw `{ data, width, height, scale?, offset? }`.
 * @param opts - `alpha` (0.3), `palette` ("distinct"), `outline` (false),
 *   `outlineWidth` (1), `outlineColor` (null), plus optional `scale`/`offset`
 *   overrides for raw arrays.
 * @returns The same ImageData.
 */
export function drawLabelImage(
  image: ImageData,
  labels: LabelImage | RawLabelImage,
  opts?: {
    alpha?: number;
    palette?: PaletteName | string;
    outline?: boolean;
    outlineWidth?: number;
    outlineColor?: RGB | null;
    scale?: [number, number];
    offset?: [number, number];
  },
): ImageData {
  const alpha = clampAlpha(opts?.alpha ?? 0.3);
  const palette = opts?.palette ?? "distinct";
  const outline = opts?.outline ?? false;
  const outlineWidth = opts?.outlineWidth ?? 1;
  const outlineColor = opts?.outlineColor ?? null;

  const labData = labels.data;
  const labH = labels.height;
  const labW = labels.width;
  // Prefer explicit opts, then the object's own transform, else identity.
  const scale: [number, number] = opts?.scale ??
    (labels as LabelImage).scale ?? [1, 1];
  const offset: [number, number] = opts?.offset ??
    (labels as LabelImage).offset ?? [0, 0];

  // Unique non-background labels and max id.
  let maxId = 0;
  let hasFg = false;
  for (let i = 0; i < labData.length; i++) {
    const v = labData[i];
    if (v > 0) {
      hasFg = true;
      if (v > maxId) maxId = v;
    }
  }
  if (!hasFg) return image;

  // Build LUT: shape (maxId + 1) x 3 as Float32 (matches Python lut float32).
  const paletteColors = getPalette(palette, maxId + 1);
  const lut = new Float32Array((maxId + 1) * 3);
  for (let id = 1; id <= maxId; id++) {
    const col = paletteColors[id % paletteColors.length];
    lut[id * 3] = col[0];
    lut[id * 3 + 1] = col[1];
    lut[id * 3 + 2] = col[2];
  }

  const imgW = image.width;
  const imgH = image.height;
  const pixels = image.data;

  const hasTransform =
    scale[0] !== 1 || scale[1] !== 1 || offset[0] !== 0 || offset[1] !== 0;

  // The label window that will be blended/outlined: a tight buffer placed at
  // (x0, y0) of the target image, with dimensions drawW x drawH.
  let region: Int32Array;
  let x0: number;
  let y0: number;
  let drawW: number;
  let drawH: number;

  if (hasTransform) {
    const sx = scale[0];
    const sy = scale[1];
    const targetH = Math.trunc(labH / sy);
    const targetW = Math.trunc(labW / sx);
    const resized = resizeNearest(labData, labH, labW, targetH, targetW);

    const ox = Math.trunc(offset[0]);
    const oy = Math.trunc(offset[1]);
    y0 = Math.max(0, oy);
    x0 = Math.max(0, ox);
    const y1 = Math.min(imgH, oy + targetH);
    const x1 = Math.min(imgW, ox + targetW);

    if (y1 <= y0 || x1 <= x0) return image;

    drawH = y1 - y0;
    drawW = x1 - x0;

    const my0 = y0 - oy;
    const mx0 = x0 - ox;
    region = new Int32Array(drawH * drawW);
    for (let r = 0; r < drawH; r++) {
      const srcRow = (my0 + r) * targetW + mx0;
      region.set(resized.subarray(srcRow, srcRow + drawW), r * drawW);
    }
  } else {
    drawH = Math.min(labH, imgH);
    drawW = Math.min(labW, imgW);
    x0 = 0;
    y0 = 0;
    region = new Int32Array(drawH * drawW);
    for (let r = 0; r < drawH; r++) {
      const srcRow = r * labW;
      region.set(labData.subarray(srcRow, srcRow + drawW), r * drawW);
    }
  }

  // Vectorized blend: apply colored overlay where label > 0.
  for (let r = 0; r < drawH; r++) {
    for (let c = 0; c < drawW; c++) {
      const lab = region[r * drawW + c];
      if (lab <= 0) continue;
      const safe = lab > maxId ? maxId : lab;
      const li = safe * 3;
      const px = ((y0 + r) * imgW + (x0 + c)) * 4;
      pixels[px] = Math.trunc(pixels[px] * (1 - alpha) + lut[li] * alpha);
      pixels[px + 1] = Math.trunc(
        pixels[px + 1] * (1 - alpha) + lut[li + 1] * alpha,
      );
      pixels[px + 2] = Math.trunc(
        pixels[px + 2] * (1 - alpha) + lut[li + 2] * alpha,
      );
    }
  }

  if (outline) {
    drawLabelOutlines(
      image,
      region,
      x0,
      y0,
      drawH,
      drawW,
      outlineWidth,
      outlineColor,
      lut,
      maxId,
    );
  }

  return image;
}

/**
 * Paint outlines around labeled regions via edge detection.
 *
 * Detects boundary pixels (where a foreground label differs from a 4-neighbor),
 * optionally dilates the edge mask with a square structuring element, and
 * paints either a uniform `outlineColor` or a darkened per-label color
 * (`lut * 0.6`). Port of `_draw_label_outlines` (overlays.py L296-360).
 *
 * Operates on the same tight `region` buffer (drawH x drawW) placed at
 * (x0, y0) in the target image.
 */
function drawLabelOutlines(
  image: ImageData,
  region: Int32Array,
  x0: number,
  y0: number,
  drawH: number,
  drawW: number,
  outlineWidth: number,
  outlineColor: RGB | null,
  lut: Float32Array,
  maxId: number,
): void {
  const imgW = image.width;
  const pixels = image.data;

  // Edge mask: boundary where label differs from a neighbor, restricted to fg.
  const edges = new Uint8Array(drawH * drawW);
  const at = (r: number, c: number): number => region[r * drawW + c];
  for (let r = 0; r < drawH; r++) {
    for (let c = 0; c < drawW; c++) {
      const v = at(r, c);
      let edge = false;
      if (c + 1 < drawW && v !== at(r, c + 1)) edge = true;
      if (!edge && c - 1 >= 0 && v !== at(r, c - 1)) edge = true;
      if (!edge && r + 1 < drawH && v !== at(r + 1, c)) edge = true;
      if (!edge && r - 1 >= 0 && v !== at(r - 1, c)) edge = true;
      // Python ORs all 4 shifted comparisons into a symmetric edge map and then
      // ANDs with (label > 0). A pixel is an edge if any neighbor (existing) in
      // either direction differs and the pixel itself is foreground.
      if (edge && v > 0) edges[r * drawW + c] = 1;
    }
  }

  // Dilate for thicker outlines (square element, pad = width // 2).
  let finalEdges = edges;
  if (outlineWidth > 1) {
    const pad = Math.trunc(outlineWidth / 2);
    const dilated = new Uint8Array(drawH * drawW);
    for (let dy = -pad; dy <= pad; dy++) {
      for (let dx = -pad; dx <= pad; dx++) {
        const sy = Math.max(0, dy);
        const ey = drawH + Math.min(0, dy);
        const sx = Math.max(0, dx);
        const ex = drawW + Math.min(0, dx);
        const oy = Math.max(0, -dy);
        const ox = Math.max(0, -dx);
        for (let r = sy; r < ey; r++) {
          for (let c = sx; c < ex; c++) {
            if (edges[(oy + (r - sy)) * drawW + (ox + (c - sx))]) {
              dilated[r * drawW + c] = 1;
            }
          }
        }
      }
    }
    // Re-restrict dilated edges to foreground (matches Python `& labels > 0`).
    for (let i = 0; i < dilated.length; i++) {
      if (dilated[i] && region[i] > 0) dilated[i] = 1;
      else dilated[i] = 0;
    }
    finalEdges = dilated;
  }

  for (let r = 0; r < drawH; r++) {
    for (let c = 0; c < drawW; c++) {
      if (!finalEdges[r * drawW + c]) continue;
      const px = ((y0 + r) * imgW + (x0 + c)) * 4;
      if (outlineColor !== null) {
        pixels[px] = outlineColor[0];
        pixels[px + 1] = outlineColor[1];
        pixels[px + 2] = outlineColor[2];
      } else {
        const lab = region[r * drawW + c];
        const safe = lab > maxId ? maxId : lab;
        const li = safe * 3;
        // dark = (lut * 0.6) cast to uint8.
        pixels[px] = Math.trunc(lut[li] * 0.6);
        pixels[px + 1] = Math.trunc(lut[li + 1] * 0.6);
        pixels[px + 2] = Math.trunc(lut[li + 2] * 0.6);
      }
    }
  }
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

  // Single LabelImage (or raw Int32Array-backed) overlay.
  if (!Array.isArray(overlay)) {
    if (isLabelImageLike(overlay)) {
      drawLabelImage(image, overlay, {
        alpha,
        palette,
        outline,
        outlineWidth,
        outlineColor,
      });
    }
    return image;
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
