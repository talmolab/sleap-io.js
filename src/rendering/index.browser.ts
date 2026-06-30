// src/rendering/index.browser.ts
// Browser-safe rendering exports (excludes Node-only skia-canvas and child_process)

// Types
export type {
  RGB,
  RGBA,
  ColorSpec,
  ColorScheme,
  PaletteName,
  MarkerShape,
  RenderOptions,
  VideoOptions,
} from "./types.js";

// Color utilities
export {
  NAMED_COLORS,
  PALETTES,
  getPalette,
  resolveColor,
  rgbToCSS,
  determineColorScheme,
} from "./colors.js";

// Shape drawing
export {
  drawCircle,
  drawSquare,
  drawDiamond,
  drawTriangle,
  drawCross,
  drawTrails,
  getMarkerFunction,
  MARKER_FUNCTIONS,
} from "./shapes.js";
export type { DrawTrailsOptions } from "./shapes.js";

// Motion-trail helpers (pure / canvas-based; browser-safe)
export {
  resolveTrailNode,
  computeTrails,
  nTrailPaletteColors,
  collectTracks,
} from "./trails.js";
export type { TrailTarget, Trail } from "./trails.js";

// Context classes
export { RenderContext, InstanceContext } from "./context.js";

// Browser-safe RASTER overlay drawing (segmentation masks + integer label
// images). These mutate an `ImageData` in place with no Node dependency, so a
// consuming UI can composite masks onto a canvas client-side. The vector
// overlays (bounding boxes, ROIs) and the `applyOverlay` dispatcher remain
// Node-only (skia-canvas) and are exported only from the main entry.
export {
  drawMasks,
  drawLabelImage,
  clampAlpha,
  pickColor,
} from "./overlays-raster.js";
export type { RawLabelImage } from "./overlays-raster.js";
