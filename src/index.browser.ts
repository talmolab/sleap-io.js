// Browser-safe entry point.
// Excludes Node-only rendering functions (skia-canvas, child_process).
// Bundlers (Vite, Rollup, webpack) resolve this via the "browser" condition
// in package.json exports.

export * from "./model/labels.js";
export * from "./model/labeled-frame.js";
export * from "./model/instance.js";
export * from "./model/skeleton.js";
export * from "./model/video.js";
export * from "./model/suggestions.js";
export * from "./model/labels-set.js";
export * from "./model/camera.js";
export * from "./model/lazy.js";
export * from "./model/roi.js";
export * from "./model/mask.js";
export * from "./video/backend.js";
export * from "./video/mp4box-video.js";
export * from "./video/mediabunny-video.js";
export * from "./video/streaming-hdf5-video.js";
export { createVideoBackend, type VideoBackendType } from "./video/factory.js";
export * from "./io/main.js";
export * from "./codecs/dictionary.js";
export * from "./codecs/numpy.js";
export * from "./codecs/skeleton-yaml.js";
export * from "./codecs/skeleton-json.js";
export * from "./codecs/training-config.js";
export * from "./rendering/index.browser.js";

// Streaming HDF5 utilities for advanced use cases
export {
  StreamingH5File,
  openStreamingH5,
  openH5Worker,
  isStreamingSupported,
  type StreamingH5Source,
} from "./codecs/slp/h5-streaming.js";

// Streaming SLP reader (uses Web Worker, recommended for browser)
export { readSlpStreaming } from "./codecs/slp/read-streaming.js";
