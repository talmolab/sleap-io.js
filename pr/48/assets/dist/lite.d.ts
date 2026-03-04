import { S as Skeleton, T as Track } from './instance-D_5PPN1y.js';
export { E as Edge, N as Node, j as Symmetry } from './instance-D_5PPN1y.js';

/**
 * jsfive-based HDF5 file interface.
 * Pure JavaScript implementation for Workers-compatible environments.
 */
type JsfiveSource = ArrayBuffer | Uint8Array;

/**
 * Shared parsing functions for SLP file metadata.
 * Used by both the full h5wasm-based reader and the lite jsfive-based reader.
 */

/**
 * Video metadata extracted from videos_json without creating backends.
 */
interface VideoMetadata {
    /** Original filename or "." for embedded */
    filename: string;
    /** HDF5 dataset path for embedded videos */
    dataset?: string;
    /** Video format (e.g., "mp4", "hdf5") */
    format?: string;
    /** Video width in pixels */
    width?: number;
    /** Video height in pixels */
    height?: number;
    /** Number of color channels */
    channels?: number;
    /** Frames per second */
    fps?: number;
    /** Total number of frames */
    frameCount?: number;
    /** Channel order (e.g., "RGB", "BGR") */
    channelOrder?: string;
    /** Whether video is embedded in the SLP file */
    embedded: boolean;
    /** Source video metadata if this is derived */
    sourceVideo?: {
        filename: string;
    };
}
/**
 * Suggestion frame metadata.
 */
interface SuggestionMetadata {
    /** Video index */
    video: number;
    /** Frame index within the video */
    frameIdx: number;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Camera metadata from recording sessions.
 */
interface CameraMetadata {
    /** Camera name */
    name?: string;
    /** Rotation vector (Rodrigues) */
    rvec: number[];
    /** Translation vector */
    tvec: number[];
    /** 3x3 intrinsic camera matrix */
    matrix?: number[][];
    /** Lens distortion coefficients */
    distortions?: number[];
}
/**
 * Recording session metadata.
 */
interface SessionMetadata {
    /** Camera definitions with calibration */
    cameras: CameraMetadata[];
    /** Mapping of camera name/key to video index */
    videosByCamera: Record<string, number>;
    /** Additional session metadata */
    metadata?: Record<string, unknown>;
}

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

/**
 * Metadata extracted from an SLP file without loading pose data.
 */
interface SlpMetadata {
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
declare function loadSlpMetadata(source: JsfiveSource, options?: {
    filename?: string;
}): Promise<SlpMetadata>;
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
declare function validateSlpBuffer(source: JsfiveSource): boolean;
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
declare function isHdf5Buffer(source: JsfiveSource): boolean;

export { type CameraMetadata, type JsfiveSource, type SessionMetadata, Skeleton, type SlpMetadata, type SuggestionMetadata, Track, type VideoMetadata, isHdf5Buffer, loadSlpMetadata, validateSlpBuffer };
