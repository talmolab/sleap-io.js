/**
 * Crop transform primitives for virtual cropping (SLP format 2.3).
 *
 * Pure, browser-safe ports of the Python `sleap_io.transform` crop helpers:
 * coordinate offsetting ({@link cropPoints}/{@link uncropPoints}) and frame
 * cropping with out-of-bounds pad-fill ({@link cropFrame}).
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
  type FrameLike,
  type RawFrame,
  type Fill,
} from "./frame.js";
