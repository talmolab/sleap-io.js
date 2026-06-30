// src/rendering/overlays-raster.ts
//
// Browser-safe RASTER overlay drawing for segmentation masks and integer label
// images. These functions operate purely on an `ImageData` (RGBA, row-major),
// mutating `image.data` in place — no skia-canvas, no `node:module`, no other
// Node-only dependency — so they are exported from BOTH the Node entry (via
// `overlays.ts`, which adds the vector overlays) and the browser entry.
//
// Split out of `overlays.ts` (the faithful port of Python sleap-io's
// `sleap_io/rendering/overlays.py`, PR #374) so the pixel-blending paths can be
// used client-side: a consuming UI can `getImageData` from a canvas, composite
// masks/label-images here, and `putImageData` back. The vector overlays
// (bounding boxes, ROIs) stay in `overlays.ts` because they draw through a
// skia-canvas surface.

import type { SegmentationMask } from "../model/mask.js";
import { resizeNearest } from "../model/mask.js";
import type { LabelImage } from "../model/label-image.js";
import type { RGB, PaletteName } from "./types.js";
import { getPalette } from "./colors.js";

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
export function clampAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) return 0;
  return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
}

/**
 * Pick the per-item color for index `i`. When an explicit `colors` array is
 * shorter than the item list it cycles (`colors[i % colors.length]`) rather
 * than indexing out of bounds; an empty array falls back to `fallback`.
 */
export function pickColor(colors: RGB[] | null, i: number, fallback: RGB): RGB {
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
