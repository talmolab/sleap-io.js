/**
 * Shared parsing functions for SLP file metadata.
 * Used by both the full h5wasm-based reader and the lite jsfive-based reader.
 */

import { Skeleton, Node } from "../../model/skeleton.js";
import { Track } from "../../model/instance.js";

const textDecoder = new TextDecoder();

/**
 * Parse JSON from HDF5 attribute.
 * Handles string, Uint8Array, and buffer variations.
 */
export function parseJsonAttr(attr: unknown): unknown {
  if (!attr) return null;
  const value = (attr as { value?: unknown }).value ?? attr;
  if (typeof value === "string") return JSON.parse(value);
  if (value instanceof Uint8Array) return JSON.parse(textDecoder.decode(value));
  if (value && typeof value === "object" && "buffer" in value) {
    return JSON.parse(textDecoder.decode(new Uint8Array((value as { buffer: ArrayBuffer }).buffer)));
  }
  // If value is already a parsed object (e.g., from streaming worker), return as-is
  if (value && typeof value === "object") {
    return value;
  }
  return JSON.parse(String(value));
}

/**
 * Trim trailing nulls and whitespace from a string (for fixed-width HDF5 strings).
 */
function trimHdf5String(str: string): string {
  return str.trim().replace(/\0+$/, "");
}

/**
 * Parse a single JSON entry from a dataset value.
 * Handles both string and Uint8Array entries.
 * Trims trailing nulls/whitespace for fixed-width HDF5 strings.
 */
export function parseJsonEntry(entry: unknown): unknown {
  if (typeof entry === "string") return JSON.parse(trimHdf5String(entry));
  if (entry instanceof Uint8Array) return JSON.parse(trimHdf5String(textDecoder.decode(entry)));
  if (entry && typeof entry === "object" && "buffer" in entry) {
    return JSON.parse(trimHdf5String(textDecoder.decode(new Uint8Array((entry as { buffer: ArrayBuffer }).buffer))));
  }
  return entry;
}

/**
 * Resolve edge type from py/reduce patterns in SLEAP metadata.
 * Type 1 = regular edge, Type 2 = symmetry.
 */
export function resolveEdgeType(
  edgeType: unknown,
  cache: Map<number, number>,
  state: { nextId: number }
): number {
  if (!edgeType || typeof edgeType !== "object") return 1;
  const et = edgeType as Record<string, unknown>;

  if (et["py/reduce"]) {
    const reduce = et["py/reduce"] as unknown[];
    const tuple = (reduce[1] as Record<string, unknown>)?.["py/tuple"] as number[] | undefined;
    const typeId = tuple?.[0] ?? 1;
    cache.set(state.nextId, typeId);
    state.nextId += 1;
    return typeId;
  }
  if (et["py/tuple"]) {
    const tuple = et["py/tuple"] as number[];
    const typeId = tuple[0] ?? 1;
    cache.set(state.nextId, typeId);
    state.nextId += 1;
    return typeId;
  }
  if (et["py/id"]) {
    const pyId = et["py/id"] as number;
    return cache.get(pyId) ?? pyId;
  }
  return 1;
}

/**
 * Parse skeletons from metadata JSON.
 * Handles py/reduce patterns for edge types and builds full Skeleton objects.
 */
export function parseSkeletons(metadataJson: unknown): Skeleton[] {
  if (!metadataJson || typeof metadataJson !== "object") return [];

  const meta = metadataJson as Record<string, unknown>;
  const nodeNames = (meta.nodes as Array<{ name?: string } | string> ?? []).map(
    (node) => (typeof node === "object" ? node.name ?? "" : String(node))
  );
  const skeletonEntries = meta.skeletons as Array<Record<string, unknown>> ?? [];
  const skeletons: Skeleton[] = [];

  for (const entry of skeletonEntries) {
    const edges: Array<[number, number]> = [];
    const symmetries: Array<[number, number]> = [];
    const typeCache = new Map<number, number>();
    const typeState = { nextId: 1 };

    const entryNodes = entry.nodes as Array<{ id?: number } | number> ?? [];
    const skeletonNodeIds = entryNodes.map((node) =>
      Number(typeof node === "object" ? node.id ?? 0 : node)
    );
    const nodeOrder = skeletonNodeIds.length
      ? skeletonNodeIds
      : nodeNames.map((_, index) => index);

    const nodes = nodeOrder
      .map((nodeId: number) => nodeNames[nodeId])
      .filter((name): name is string => name !== undefined)
      .map((name) => new Node(name));

    const nodeIndexById = new Map<number, number>();
    nodeOrder.forEach((nodeId: number, index: number) => {
      nodeIndexById.set(Number(nodeId), index);
    });

    const links = entry.links as Array<{ source: number; target: number; type?: unknown }> ?? [];
    for (const link of links) {
      const source = Number(link.source);
      const target = Number(link.target);
      const edgeType = resolveEdgeType(link.type, typeCache, typeState);
      if (edgeType === 2) {
        symmetries.push([source, target]);
      } else {
        edges.push([source, target]);
      }
    }

    const remapPair = (pair: [number, number]): [number, number] | null => {
      const sourceIndex = nodeIndexById.get(pair[0]);
      const targetIndex = nodeIndexById.get(pair[1]);
      if (sourceIndex === undefined || targetIndex === undefined) return null;
      return [sourceIndex, targetIndex];
    };

    const mappedEdges = edges
      .map(remapPair)
      .filter((pair): pair is [number, number] => pair !== null);

    const seenSymmetries = new Set<string>();
    const mappedSymmetries = symmetries
      .map(remapPair)
      .filter((pair): pair is [number, number] => pair !== null)
      .filter(([a, b]) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seenSymmetries.has(key)) return false;
        seenSymmetries.add(key);
        return true;
      });

    const graph = entry.graph as { name?: string } | undefined;
    const skeleton = new Skeleton({
      nodes,
      edges: mappedEdges,
      symmetries: mappedSymmetries,
      name: graph?.name ?? (entry.name as string | undefined),
    });
    skeletons.push(skeleton);
  }

  return skeletons;
}

/**
 * Parse tracks from tracks_json dataset values.
 */
export function parseTracks(values: unknown[]): Track[] {
  const tracks: Track[] = [];
  for (const entry of values) {
    let parsed = entry;
    if (typeof entry === "string") {
      try {
        parsed = JSON.parse(trimHdf5String(entry));
      } catch {
        parsed = trimHdf5String(entry);
      }
    } else if (entry instanceof Uint8Array) {
      try {
        parsed = JSON.parse(trimHdf5String(textDecoder.decode(entry)));
      } catch {
        parsed = trimHdf5String(textDecoder.decode(entry));
      }
    }

    if (Array.isArray(parsed)) {
      tracks.push(new Track(String(parsed[1] ?? parsed[0])));
    } else if (parsed && typeof parsed === "object" && "name" in parsed) {
      tracks.push(new Track(String((parsed as { name: unknown }).name)));
    } else {
      tracks.push(new Track(String(parsed)));
    }
  }
  return tracks;
}

/**
 * Video metadata extracted from videos_json without creating backends.
 */
export interface VideoMetadata {
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
  sourceVideo?: { filename: string };
}

/**
 * Parse video metadata from videos_json dataset values.
 * Returns metadata objects WITHOUT creating video backends.
 */
export function parseVideosMetadata(values: unknown[], labelsPath?: string): VideoMetadata[] {
  const videos: VideoMetadata[] = [];

  for (const entry of values) {
    if (!entry) continue;

    let parsed: Record<string, unknown>;
    if (typeof entry === "string") {
      // jsfive returns fixed-width strings with trailing spaces/nulls - trim before parsing
      parsed = JSON.parse(trimHdf5String(entry)) as Record<string, unknown>;
    } else if (entry instanceof Uint8Array) {
      parsed = JSON.parse(trimHdf5String(textDecoder.decode(entry))) as Record<string, unknown>;
    } else {
      parsed = entry as Record<string, unknown>;
    }

    const backendMeta = (parsed.backend ?? {}) as Record<string, unknown>;
    let filename = (backendMeta.filename ?? parsed.filename ?? "") as string;
    const dataset = (backendMeta.dataset ?? null) as string | null;
    let embedded = false;

    if (filename === ".") {
      embedded = true;
      filename = labelsPath ?? "embedded";
    }

    const shape = backendMeta.shape as number[] | undefined;

    videos.push({
      filename,
      dataset: dataset ?? undefined,
      format: backendMeta.format as string | undefined,
      width: shape?.[2],
      height: shape?.[1],
      channels: shape?.[3],
      frameCount: shape?.[0],
      fps: backendMeta.fps as number | undefined,
      channelOrder: backendMeta.channel_order as string | undefined,
      embedded,
      sourceVideo: parsed.source_video as { filename: string } | undefined,
    });
  }

  return videos;
}

/**
 * Suggestion frame metadata.
 */
export interface SuggestionMetadata {
  /** Video index */
  video: number;
  /** Frame index within the video */
  frameIdx: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Parse suggestions from suggestions_json dataset values.
 */
export function parseSuggestions(values: unknown[]): SuggestionMetadata[] {
  const suggestions: SuggestionMetadata[] = [];
  for (const entry of values) {
    const parsed = parseJsonEntry(entry) as Record<string, unknown>;
    suggestions.push({
      video: Number(parsed.video ?? 0),
      frameIdx: (parsed.frame_idx ?? parsed.frameIdx ?? 0) as number,
      metadata: parsed,
    });
  }
  return suggestions;
}

/**
 * Camera metadata from recording sessions.
 */
export interface CameraMetadata {
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
export interface SessionMetadata {
  /** Camera definitions with calibration */
  cameras: CameraMetadata[];
  /** Mapping of camera name/key to video index */
  videosByCamera: Record<string, number>;
  /** Additional session metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Parse recording session metadata from sessions_json dataset values.
 */
export function parseSessionsMetadata(values: unknown[]): SessionMetadata[] {
  const sessions: SessionMetadata[] = [];

  for (const entry of values) {
    const parsed = parseJsonEntry(entry) as Record<string, unknown>;
    const calibration = (parsed.calibration ?? {}) as Record<string, unknown>;
    const cameras: CameraMetadata[] = [];

    for (const [key, data] of Object.entries(calibration)) {
      if (key === "metadata") continue;
      const cameraData = data as Record<string, unknown>;
      cameras.push({
        name: (cameraData.name as string | undefined) ?? key,
        rvec: (cameraData.rotation as number[] | undefined) ?? [0, 0, 0],
        tvec: (cameraData.translation as number[] | undefined) ?? [0, 0, 0],
        matrix: cameraData.matrix as number[][] | undefined,
        distortions: cameraData.distortions as number[] | undefined,
      });
    }

    const videosByCamera: Record<string, number> = {};
    const map = (parsed.camcorder_to_video_idx_map ?? {}) as Record<string, unknown>;
    for (const [cameraKey, videoIdx] of Object.entries(map)) {
      videosByCamera[cameraKey] = Number(videoIdx);
    }

    sessions.push({
      cameras,
      videosByCamera,
      metadata: parsed.metadata as Record<string, unknown> | undefined,
    });
  }

  return sessions;
}
