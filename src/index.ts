// Register Node.js-specific h5wasm and file I/O providers.
// This side-effect import ensures the Node entry uses h5wasm/node and native fs,
// while the browser entry (index.browser.ts) never touches these modules.
import "./codecs/slp/h5-node.js";

export * from "./model/labels.js";
export * from "./model/labeled-frame.js";
export * from "./model/instance.js";
export * from "./model/skeleton.js";
export * from "./model/video.js";
export * from "./model/suggestions.js";
export * from "./model/labels-set.js";
export * from "./model/camera.js";
export * from "./model/identity.js";
export * from "./model/instance3d.js";
export * from "./model/lazy.js";
export * from "./model/roi.js";
export * from "./model/mask.js";
export * from "./model/bbox.js";
export * from "./model/centroid.js";
export * from "./model/label-image.js";
export * from "./video/backend.js";
export * from "./video/mp4box-video.js";
export * from "./video/mediabunny-video.js";
export * from "./video/streaming-hdf5-video.js";
export { createVideoBackend, type VideoBackendType } from "./video/factory.js";
export * from "./io/main.js";
export * from "./io/geojson.js";
export * from "./io/trackmate.js";
export * from "./codecs/dictionary.js";
export * from "./codecs/numpy.js";
export * from "./codecs/skeleton-yaml.js";
export * from "./codecs/skeleton-json.js";
export * from "./codecs/training-config.js";
export * from "./rendering/index.js";

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
