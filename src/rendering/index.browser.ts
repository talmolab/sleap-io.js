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
  getMarkerFunction,
  MARKER_FUNCTIONS,
} from "./shapes.js";

// Context classes
export { RenderContext, InstanceContext } from "./context.js";
