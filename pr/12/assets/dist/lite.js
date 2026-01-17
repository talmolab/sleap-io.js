import {
  Edge,
  Node,
  Skeleton,
  Symmetry,
  Track,
  parseJsonAttr,
  parseSessionsMetadata,
  parseSkeletons,
  parseSuggestions,
  parseTracks,
  parseVideosMetadata
} from "./chunk-CDU5QGU6.js";

// src/codecs/slp/jsfive.ts
import * as hdf5 from "jsfive";
function openJsfiveFile(source, filename) {
  let buffer;
  if (source instanceof Uint8Array) {
    const slice = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    buffer = slice;
  } else {
    buffer = source;
  }
  const file = new hdf5.File(buffer, filename ?? "data.slp");
  return {
    get: (path) => {
      try {
        const item = file.get(path);
        if (!item) return null;
        return item;
      } catch {
        return null;
      }
    },
    keys: file.keys,
    close: () => {
    }
  };
}
function isDataset(item) {
  if (!item) return false;
  return "value" in item || "shape" in item;
}
function getAttrs(item) {
  if (!item) return {};
  return item.attrs ?? {};
}
function getShape(item) {
  if (!item || !isDataset(item)) return [];
  return item.shape ?? [];
}
function getValue(item) {
  if (!item || !isDataset(item)) return null;
  try {
    return item.value;
  } catch {
    return null;
  }
}

// src/lite.ts
async function loadSlpMetadata(source, options) {
  const file = openJsfiveFile(source, options?.filename);
  try {
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    for (const key of requiredKeys) {
      if (!file.keys.includes(key)) {
        throw new Error(`Invalid SLP file: missing /${key}`);
      }
    }
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Invalid SLP file: missing /metadata group");
    }
    const metadataAttrs = getAttrs(metadataGroup);
    const formatId = Number(
      metadataAttrs.format_id?.value ?? metadataAttrs.format_id ?? 1
    );
    const metadataJson = parseJsonAttr(metadataAttrs.json);
    if (!metadataJson) {
      throw new Error("Invalid SLP file: missing metadata.attrs.json");
    }
    const skeletons = parseSkeletons(metadataJson);
    const tracksDataset = file.get("tracks_json");
    const tracksValue = getValue(tracksDataset);
    const tracks = Array.isArray(tracksValue) ? parseTracks(tracksValue) : [];
    const videosDataset = file.get("videos_json");
    const videosValue = getValue(videosDataset);
    const labelsPath = options?.filename ?? "slp-data.slp";
    let videos = Array.isArray(videosValue) ? parseVideosMetadata(videosValue, labelsPath) : [];
    videos = videos.map((video) => {
      if (!video.embedded || !video.dataset) return video;
      const videoDs = file.get(video.dataset);
      if (!videoDs || !isDataset(videoDs)) return video;
      const attrs = getAttrs(videoDs);
      const enriched = { ...video };
      if (attrs.format !== void 0) enriched.format = String(attrs.format);
      if (attrs.width !== void 0) enriched.width = Number(attrs.width);
      if (attrs.height !== void 0) enriched.height = Number(attrs.height);
      if (attrs.channels !== void 0) enriched.channels = Number(attrs.channels);
      const shape = getShape(videoDs);
      if (shape.length > 0) {
        enriched.frameCount = shape[0];
      }
      return enriched;
    });
    const suggestionsDataset = file.get("suggestions_json");
    const suggestionsValue = getValue(suggestionsDataset);
    const suggestions = Array.isArray(suggestionsValue) ? parseSuggestions(suggestionsValue) : [];
    const sessionsDataset = file.get("sessions_json");
    const sessionsValue = getValue(sessionsDataset);
    const sessions = Array.isArray(sessionsValue) ? parseSessionsMetadata(sessionsValue) : [];
    const framesDs = file.get("frames");
    const instancesDs = file.get("instances");
    const pointsDs = file.get("points");
    const predPointsDs = file.get("pred_points");
    const counts = {
      labeledFrames: getShape(framesDs)[0] ?? 0,
      instances: getShape(instancesDs)[0] ?? 0,
      points: getShape(pointsDs)[0] ?? 0,
      predictedPoints: getShape(predPointsDs)[0] ?? 0
    };
    const hasEmbeddedImages = videos.some(
      (v) => v.embedded && (v.format || v.width)
    );
    return {
      version: metadataJson.version ?? "unknown",
      formatId,
      skeletons,
      tracks,
      videos,
      suggestions,
      sessions,
      counts,
      hasEmbeddedImages,
      provenance: metadataJson.provenance
    };
  } finally {
    file.close();
  }
}
function validateSlpBuffer(source) {
  const file = openJsfiveFile(source);
  try {
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    const missingKeys = requiredKeys.filter((k) => !file.keys.includes(k));
    if (missingKeys.length > 0) {
      throw new Error(`Invalid SLP file: missing ${missingKeys.join(", ")}`);
    }
    const metadata = file.get("metadata");
    if (!metadata) {
      throw new Error("Invalid SLP file: cannot read metadata group");
    }
    const attrs = getAttrs(metadata);
    if (!attrs.json) {
      throw new Error("Invalid SLP file: missing metadata.attrs.json");
    }
    return true;
  } finally {
    file.close();
  }
}
function isHdf5Buffer(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < 8) return false;
  return bytes[0] === 137 && bytes[1] === 72 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}
export {
  Edge,
  Node,
  Skeleton,
  Symmetry,
  Track,
  isHdf5Buffer,
  loadSlpMetadata,
  validateSlpBuffer
};
