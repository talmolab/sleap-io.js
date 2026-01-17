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
