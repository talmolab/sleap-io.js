// src/rendering/index.ts

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
  Overlay,
  VideoOverlay,
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

// Motion-trail helpers
export {
  resolveTrailNode,
  computeTrails,
  nTrailPaletteColors,
  collectTracks,
} from "./trails.js";
export type { TrailTarget, Trail } from "./trails.js";

// Context classes
export { RenderContext, InstanceContext } from "./context.js";

// Main rendering functions
export {
  renderImage,
  toPNG,
  toJPEG,
  toDataURL,
  saveImage,
} from "./render.js";

// Video rendering
export { renderVideo, checkFfmpeg } from "./video.js";

// Overlay drawing (Node-only raster/vector overlays for segmentation masks,
// label images, bounding boxes, and ROIs). Not exported from the browser entry.
export {
  drawMasks,
  drawLabelImage,
  drawBboxes,
  drawRois,
  applyOverlay,
} from "./overlays.js";
export type { RawLabelImage } from "./overlays.js";
