/**
 * Lightweight SLP file reader using jsfive (pure JavaScript).
 *
 * This module provides Workers-compatible SLP file reading without WASM.
 * It can extract all metadata but cannot read pose coordinates (which
 * require compound dataset support).
 *
 * @example
 * ```typescript
 * import { loadSlpMetadata } from '@talmolab/sleap-io.js/lite';
 *
 * const response = await fetch('https://example.com/file.slp');
 * const buffer = await response.arrayBuffer();
 * const metadata = await loadSlpMetadata(buffer);
 *
 * console.log('Skeletons:', metadata.skeletons.map(s => s.name));
 * console.log('Frames:', metadata.counts.labeledFrames);
 * ```
 *
 * @packageDocumentation
 */

import {
  openJsfiveFile,
  getAttrs,
  getShape,
  getValue,
  isDataset,
  type JsfiveSource,
} from "./codecs/slp/jsfive.js";
import {
  parseJsonAttr,
  parseSkeletons,
  parseTracks,
  parseVideosMetadata,
  parseSuggestions,
  parseSessionsMetadata,
} from "./codecs/slp/parsers.js";
import type {
  VideoMetadata,
  SuggestionMetadata,
  SessionMetadata,
} from "./codecs/slp/parsers.js";
import type { Skeleton } from "./model/skeleton.js";
import type { Track } from "./model/instance.js";

// Re-export types for consumer convenience
export type {
  VideoMetadata,
  SuggestionMetadata,
  SessionMetadata,
  CameraMetadata,
} from "./codecs/slp/parsers.js";
export type { JsfiveSource } from "./codecs/slp/jsfive.js";
export { Skeleton, Node, Edge, Symmetry } from "./model/skeleton.js";
export { Track } from "./model/instance.js";

/**
 * Metadata extracted from an SLP file without loading pose data.
 */
export interface SlpMetadata {
  /** SLEAP version that created this file (e.g., "1.3.4") */
  version: string;

  /** HDF5 format ID (e.g., 1.2) */
  formatId: number;

  /** Skeleton definitions with nodes, edges, and symmetries */
  skeletons: Skeleton[];

  /** Track definitions */
  tracks: Track[];

  /** Video metadata (without loaded backends) */
  videos: VideoMetadata[];

  /** Suggestion frame metadata */
  suggestions: SuggestionMetadata[];

  /** Multi-camera recording session metadata */
  sessions: SessionMetadata[];

  /** Dataset counts */
  counts: {
    /** Number of labeled frames */
    labeledFrames: number;
    /** Total number of instances (user + predicted) */
    instances: number;
    /** Number of user-labeled points */
    points: number;
    /** Number of predicted points */
    predictedPoints: number;
  };

  /** Whether any video has embedded image data */
  hasEmbeddedImages: boolean;

  /** Raw provenance data (SLEAP version, build info, etc.) */
  provenance?: Record<string, unknown>;
}

/**
 * Load SLP file metadata using jsfive (no WASM required).
 *
 * This is a lightweight alternative to `loadSlp()` for environments
 * that don't support WebAssembly compilation (e.g., Cloudflare Workers).
 *
 * Returns metadata only - does NOT include:
 * - Actual pose coordinates (requires compound dataset reading)
 * - Video frame data (requires VLEN sequence reading)
 * - Instance-frame relationships
 * - Instance scores
 *
 * @param source - ArrayBuffer or Uint8Array containing the SLP file
 * @param options - Optional configuration
 * @param options.filename - Filename hint for embedded video paths
 * @returns SlpMetadata object with skeletons, counts, video info
 * @throws Error if the file is not a valid SLP file
 *
 * @example
 * ```typescript
 * const buffer = await fetch('file.slp').then(r => r.arrayBuffer());
 * const metadata = await loadSlpMetadata(buffer);
 *
 * console.log(`${metadata.skeletons.length} skeleton(s)`);
 * console.log(`${metadata.counts.labeledFrames} labeled frames`);
 * console.log(`${metadata.counts.instances} instances`);
 * ```
 */
export async function loadSlpMetadata(
  source: JsfiveSource,
  options?: { filename?: string }
): Promise<SlpMetadata> {
  const file = openJsfiveFile(source, options?.filename);

  try {
    // Verify SLEAP structure
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    for (const key of requiredKeys) {
      if (!file.keys.includes(key)) {
        throw new Error(`Invalid SLP file: missing /${key}`);
      }
    }

    // Read metadata group attributes
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Invalid SLP file: missing /metadata group");
    }

    const metadataAttrs = getAttrs(metadataGroup);
    const formatId = Number(
      (metadataAttrs.format_id as { value?: unknown })?.value ??
        metadataAttrs.format_id ??
        1.0
    );
    const metadataJson = parseJsonAttr(metadataAttrs.json) as Record<string, unknown> | null;

    if (!metadataJson) {
      throw new Error("Invalid SLP file: missing metadata.attrs.json");
    }

    // Parse skeletons using shared logic
    const skeletons = parseSkeletons(metadataJson);

    // Parse tracks from tracks_json dataset
    const tracksDataset = file.get("tracks_json");
    const tracksValue = getValue(tracksDataset);
    const tracks = Array.isArray(tracksValue) ? parseTracks(tracksValue) : [];

    // Parse video metadata from videos_json dataset
    const videosDataset = file.get("videos_json");
    const videosValue = getValue(videosDataset);
    const labelsPath = options?.filename ?? "slp-data.slp";
    let videos = Array.isArray(videosValue)
      ? parseVideosMetadata(videosValue, labelsPath)
      : [];

    // Enrich embedded videos with attributes from their datasets
    videos = videos.map((video) => {
      if (!video.embedded || !video.dataset) return video;

      // Try to get video dataset attributes
      const videoDs = file.get(video.dataset);
      if (!videoDs || !isDataset(videoDs)) return video;

      const attrs = getAttrs(videoDs);
      const enriched = { ...video };

      if (attrs.format !== undefined) enriched.format = String(attrs.format);
      if (attrs.width !== undefined) enriched.width = Number(attrs.width);
      if (attrs.height !== undefined) enriched.height = Number(attrs.height);
      if (attrs.channels !== undefined) enriched.channels = Number(attrs.channels);

      // Try to get frame count from shape
      const shape = getShape(videoDs);
      if (shape.length > 0) {
        enriched.frameCount = shape[0];
      }

      return enriched;
    });

    // Parse suggestions from suggestions_json dataset
    const suggestionsDataset = file.get("suggestions_json");
    const suggestionsValue = getValue(suggestionsDataset);
    const suggestions = Array.isArray(suggestionsValue)
      ? parseSuggestions(suggestionsValue)
      : [];

    // Parse sessions from sessions_json dataset
    const sessionsDataset = file.get("sessions_json");
    const sessionsValue = getValue(sessionsDataset);
    const sessions = Array.isArray(sessionsValue)
      ? parseSessionsMetadata(sessionsValue)
      : [];

    // Get counts from dataset shapes (works without reading compound values)
    const framesDs = file.get("frames");
    const instancesDs = file.get("instances");
    const pointsDs = file.get("points");
    const predPointsDs = file.get("pred_points");

    const counts = {
      labeledFrames: getShape(framesDs)[0] ?? 0,
      instances: getShape(instancesDs)[0] ?? 0,
      points: getShape(pointsDs)[0] ?? 0,
      predictedPoints: getShape(predPointsDs)[0] ?? 0,
    };

    // Check for embedded images by looking at video metadata
    const hasEmbeddedImages = videos.some(
      (v) => v.embedded && (v.format || v.width)
    );

    return {
      version: (metadataJson.version as string) ?? "unknown",
      formatId,
      skeletons,
      tracks,
      videos,
      suggestions,
      sessions,
      counts,
      hasEmbeddedImages,
      provenance: metadataJson.provenance as Record<string, unknown> | undefined,
    };
  } finally {
    file.close();
  }
}

/**
 * Validate that a buffer contains a valid SLP file.
 *
 * Performs quick structural validation without fully parsing the file.
 * Returns true if valid, throws an error with details if invalid.
 *
 * @param source - ArrayBuffer or Uint8Array containing the SLP file
 * @returns true if the file is a valid SLP file
 * @throws Error with details if the file is invalid
 *
 * @example
 * ```typescript
 * try {
 *   validateSlpBuffer(buffer);
 *   console.log('Valid SLP file');
 * } catch (e) {
 *   console.error('Invalid:', e.message);
 * }
 * ```
 */
export function validateSlpBuffer(source: JsfiveSource): boolean {
  const file = openJsfiveFile(source);

  try {
    // Check for required SLEAP structure
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    const missingKeys = requiredKeys.filter((k) => !file.keys.includes(k));

    if (missingKeys.length > 0) {
      throw new Error(`Invalid SLP file: missing ${missingKeys.join(", ")}`);
    }

    // Verify metadata has required attributes
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

/**
 * Check if a buffer looks like an HDF5 file.
 *
 * Performs a quick magic number check without fully parsing.
 * This is faster than validateSlpBuffer for initial filtering.
 *
 * @param source - ArrayBuffer or Uint8Array to check
 * @returns true if the buffer starts with the HDF5 magic number
 *
 * @example
 * ```typescript
 * if (isHdf5Buffer(buffer)) {
 *   // Might be an SLP file, do full validation
 *   const metadata = await loadSlpMetadata(buffer);
 * }
 * ```
 */
export function isHdf5Buffer(source: JsfiveSource): boolean {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < 8) return false;

  // HDF5 magic number: 0x89 0x48 0x44 0x46 0x0d 0x0a 0x1a 0x0a
  // or ASCII: \211HDF\r\n\032\n
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x48 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}
