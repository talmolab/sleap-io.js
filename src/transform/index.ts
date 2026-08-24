/**
 * Crop transform primitives for virtual cropping (SLP format 2.3).
 *
 * Pure, browser-safe ports of the Python `sleap_io.transform` crop helpers:
 * coordinate offsetting ({@link cropPoints}/{@link uncropPoints}), frame
 * cropping with out-of-bounds pad-fill ({@link cropFrame}), and grayscale
 * detection/collapsing ({@link detectGrayscale}/{@link grayscaleFrame}).
 */

export {
  cropPoints,
  uncropPoints,
  type CropRect,
  type FlatPoints,
  type PointPairs,
} from "./points.js";
export {
  cropFrame,
  detectGrayscale,
  grayscaleFrame,
  type FrameLike,
  type RawFrame,
  type Fill,
} from "./frame.js";
