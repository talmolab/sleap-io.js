import { Labels } from "../../model/labels.js";
import { Instance, PredictedInstance } from "../../model/instance.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import { RecordingSession, Camera, InstanceGroup, FrameGroup } from "../../model/camera.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video } from "../../model/video.js";
import { getH5Module, getH5FileSystem } from "./h5.js";
import { ROI, encodeWkb } from "../../model/roi.js";
import { SegmentationMask } from "../../model/mask.js";
import { BoundingBox, PredictedBoundingBox } from "../../model/bbox.js";
import { Identity } from "../../model/identity.js";
import { Instance3D, PredictedInstance3D } from "../../model/instance3d.js";

// File writer hook — registered by h5-node.ts (imported as side-effect from Node entry point).
let _writeToFile: ((filename: string, bytes: Uint8Array) => Promise<void>) | null = null;

/**
 * Register a file writer for Node.js environments.
 * Called as a side-effect when the Node entry point imports h5-node.ts.
 * @internal
 */
export function _registerFileWriter(
  writer: (filename: string, bytes: Uint8Array) => Promise<void>
): void {
  _writeToFile = writer;
}

const FORMAT_ID = 1.4;
const textEncoder = new TextEncoder();

/** Write a string as a fixed-length HDF5 string attribute (H5T_STRING).
 *  h5py reads fixed-length strings as `bytes`, so Python's `.decode()` works.
 *  Using `S<n>` dtype avoids variable-length strings (returned as `str`)
 *  and uint8 arrays (returned as `numpy.ndarray`). */
function setStringAttr(target: any, name: string, value: string): void {
  const byteLength = textEncoder.encode(value).length;
  target.create_attribute(name, value, null, `S${byteLength}`);
}
const SPAWNED_ON = 0;

export type SlpWriteOptions = {
  embed?: boolean | string;
  restoreOriginalVideos?: boolean;
};

/** Frame data collected for embedding a single video. */
interface EmbeddedVideoFrames {
  /** Video index in labels.videos */
  videoIndex: number;
  /** Frame indices (original video frame numbers) */
  frameNumbers: number[];
  /** Encoded frame bytes (PNG/JPEG) indexed by frame number */
  frameData: Map<number, Uint8Array>;
  /** Image format (png, jpeg) */
  format: string;
  /** Channel order (RGB, BGR) */
  channelOrder: string;
}

function writeSlpToFile(file: any, labels: Labels, embeddedVideoData?: Map<number, EmbeddedVideoFrames> | null): void {
  writeMetadata(file, labels);

  if (embeddedVideoData && embeddedVideoData.size > 0) {
    writeEmbeddedVideos(file, labels, embeddedVideoData);
  } else {
    writeVideos(file, labels.videos);
  }

  writeTracks(file, labels.tracks);
  writeSuggestions(file, labels.suggestions, labels.videos);
  writeIdentities(file, labels.identities);
  writeSessions(file, labels.sessions, labels.videos, labels.labeledFrames, labels.identities);
  writeLabeledFrames(file, labels);
  writeNegativeFrames(file, labels);
  const allInstances = labels.labeledFrames.flatMap((f) => f.instances);
  writeRois(file, labels.rois, labels.videos, labels.tracks, allInstances);
  writeMasks(file, labels.masks, labels.videos, labels.tracks);
  writeBboxes(file, labels.bboxes, labels.videos, labels.tracks, allInstances);
}

/**
 * Serialize Labels to SLP format and return the bytes.
 * Works in both Node.js and browser environments.
 *
 * When `embed` is set, video frames are read from their backends and stored
 * directly in the SLP file as HDF5 datasets (video0/video, video1/video, etc.).
 * The video backends must be open and able to return frame data.
 *
 * Supported embed modes:
 * - `true` or `"all"` - Embed all labeled frames
 * - `"user"` - Embed only frames with user instances
 * - `"suggestions"` - Embed only suggestion frames
 * - `"user+suggestions"` - Embed user instance frames and suggestion frames
 * - `"source"` - Restore original video paths (no embedding)
 */
export async function saveSlpToBytes(
  labels: Labels,
  options?: SlpWriteOptions
): Promise<Uint8Array> {
  const embedMode = options?.embed ?? false;

  // Source mode: restore original video paths before writing
  let writeLabels = labels;
  if (embedMode === "source") {
    const restoredVideos = labels.videos.map((video) => {
      if (video.sourceVideo) return video.sourceVideo;
      return video;
    });
    writeLabels = new Labels({
      labeledFrames: labels.labeledFrames.map((frame) => {
        const videoIdx = labels.videos.indexOf(frame.video);
        const restoredVideo = videoIdx >= 0 ? restoredVideos[videoIdx] : frame.video;
        return new LabeledFrame({ video: restoredVideo, frameIdx: frame.frameIdx, instances: frame.instances });
      }),
      videos: restoredVideos,
      skeletons: labels.skeletons,
      tracks: labels.tracks,
      suggestions: labels.suggestions,
      sessions: labels.sessions,
      provenance: labels.provenance,
      identities: labels.identities,
    });
  }

  const module = await getH5Module();
  const memPath = `/tmp/sleap_output_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;

  // If embedding, we need to determine frames per video and prepare embedded data
  let embeddedVideoData: Map<number, EmbeddedVideoFrames> | null = null;
  if (embedMode && embedMode !== "source") {
    embeddedVideoData = await collectFramesForEmbedding(labels, embedMode);
  }

  const file = new module.File(memPath, "w");
  try {
    writeSlpToFile(file, writeLabels, embeddedVideoData);
  } finally {
    file.close();
  }

  const fs = getH5FileSystem(module);
  const bytes = fs.readFile!(memPath);
  fs.unlink!(memPath);
  return bytes;
}

export async function writeSlp(
  filename: string,
  labels: Labels,
  options?: SlpWriteOptions
): Promise<void> {
  const bytes = await saveSlpToBytes(labels, options);

  if (_writeToFile) {
    await _writeToFile(filename, bytes);
  } else {
    throw new Error(
      "writeSlp requires a Node.js environment for file I/O. " +
      "Use saveSlpToBytes() to get the SLP data as a Uint8Array in the browser."
    );
  }
}

function writeMetadata(file: any, labels: Labels): void {
  const { skeletons, nodes } = serializeSkeletons(labels.skeletons);
  const metadata = {
    version: "2.0.0",
    skeletons,
    nodes,
    videos: [],
    tracks: [],
    suggestions: [],
    negative_anchors: {},
    provenance: labels.provenance ?? {},
  };

  const hasRoiInstance = labels.rois.some((roi) => roi.instance !== null);
  const hasIdentities = (labels.identities?.length ?? 0) > 0;
  let formatId = (labels.bboxes?.length ?? 0) > 0
    ? 1.7
    : hasRoiInstance
      ? 1.6
      : (labels.rois.length > 0 || labels.masks.length > 0)
        ? 1.5
        : FORMAT_ID;
  if (hasIdentities) {
    formatId = Math.max(formatId, 1.9);
  }

  file.create_group("metadata");
  const metadataGroup = file.get("metadata");
  metadataGroup.create_attribute("format_id", formatId);
  setStringAttr(metadataGroup, "json", JSON.stringify(metadata));
}

function serializeSkeletons(skeletons: Skeleton[]): { skeletons: any[]; nodes: Array<{ name: string }> } {
  const nodes: Array<{ name: string }> = [];
  const nodeIndex = new Map<string, number>();

  for (const skeleton of skeletons) {
    for (const nodeName of skeleton.nodeNames) {
      if (!nodeIndex.has(nodeName)) {
        nodeIndex.set(nodeName, nodes.length);
        nodes.push({ name: nodeName });
      }
    }
  }

  const serialized = skeletons.map((skeleton) => {
    const links: Array<Record<string, any>> = [];
    // Track py/id assignments for edge types (jsonpickle convention).
    // First occurrence of each edge type gets py/reduce; subsequent get py/id.
    const edgeTypePyId: Record<number, number> = {};
    let nextPyId = 1;
    let edgeInsertIdx = 0;

    function makeEdgeType(typeVal: number): any {
      if (edgeTypePyId[typeVal] != null) {
        return { "py/id": edgeTypePyId[typeVal] };
      }
      edgeTypePyId[typeVal] = nextPyId++;
      return {
        "py/reduce": [
          { "py/type": "sleap.skeleton.EdgeType" },
          { "py/tuple": [typeVal] },
        ],
      };
    }

    for (const edge of skeleton.edges) {
      const source = nodeIndex.get(edge.source.name) ?? 0;
      const target = nodeIndex.get(edge.destination.name) ?? 0;
      links.push({
        edge_insert_idx: edgeInsertIdx++,
        key: 0,
        source,
        target,
        type: makeEdgeType(1),
      });
    }

    for (const [left, right] of skeleton.symmetryNames) {
      const source = nodeIndex.get(left) ?? 0;
      const target = nodeIndex.get(right) ?? 0;
      links.push({ key: 0, source, target, type: makeEdgeType(2) });
    }

    // Build per-skeleton node index list (global indices of this skeleton's nodes)
    const skeletonNodeIds = skeleton.nodeNames.map((name) => nodeIndex.get(name) ?? 0);

    return {
      directed: true,
      graph: {
        name: skeleton.name ?? "",
        num_edges_inserted: skeleton.edges.length,
      },
      links,
      multigraph: true,
      nodes: skeletonNodeIds.map((id) => ({ id })),
    };
  });

  return { skeletons: serialized, nodes };
}

function writeVideos(file: any, videos: Video[]): void {
  const payload = videos.map((video) => JSON.stringify(serializeVideo(video)));
  file.create_dataset({ name: "videos_json", data: payload });
}

function serializeVideo(video: Video): Record<string, unknown> {
  const backend = { ...(video.backendMetadata ?? {}) } as Record<string, unknown>;
  if (backend.filename == null) backend.filename = video.filename;
  if (backend.dataset == null && video.backend?.dataset) backend.dataset = video.backend.dataset;
  if (backend.shape == null && video.backend?.shape) backend.shape = video.backend.shape;
  if (backend.fps == null && video.backend?.fps != null) backend.fps = video.backend.fps;

  const entry: Record<string, unknown> = {
    filename: video.filename,
    backend,
  };

  if (video.sourceVideo) {
    entry.source_video = { filename: video.sourceVideo.filename };
  }

  return entry;
}

function writeTracks(file: any, tracks: Array<{ name: string }>): void {
  const payload = tracks.map((track) => JSON.stringify([SPAWNED_ON, track.name]));
  file.create_dataset({ name: "tracks_json", data: payload });
}

function writeSuggestions(file: any, suggestions: SuggestionFrame[], videos: Video[]): void {
  const payload = suggestions.map((suggestion) =>
    JSON.stringify({
      video: String(videos.indexOf(suggestion.video)),
      frame_idx: suggestion.frameIdx,
      group: suggestion.group ?? "default",
    })
  );
  file.create_dataset({ name: "suggestions_json", data: payload });
}

function writeIdentities(file: any, identities: Identity[]): void {
  if (!identities.length) return;
  const payload = identities.map((identity) => {
    const d: Record<string, unknown> = { name: identity.name };
    if (identity.color != null) d.color = identity.color;
    Object.assign(d, identity.metadata);
    return JSON.stringify(d);
  });
  file.create_dataset({ name: "identities_json", data: payload });
}

function writeSessions(file: any, sessions: RecordingSession[], videos: Video[], labeledFrames: LabeledFrame[], identities?: Identity[]): void {
  const labeledFrameIndex = new Map<LabeledFrame, number>();
  labeledFrames.forEach((lf, idx) => labeledFrameIndex.set(lf, idx));

  const payload = sessions.map((session) => JSON.stringify(serializeSession(session, videos, labeledFrameIndex, identities)));
  file.create_dataset({ name: "sessions_json", data: payload });
}

function serializeSession(
  session: RecordingSession,
  videos: Video[],
  labeledFrameIndex: Map<LabeledFrame, number>,
  identities?: Identity[]
): Record<string, unknown> {
  const calibration: Record<string, unknown> = { metadata: session.cameraGroup.metadata ?? {} };
  session.cameraGroup.cameras.forEach((camera, idx) => {
    const key = camera.name ?? String(idx);
    const camData: Record<string, unknown> = {
      name: camera.name ?? key,
      rotation: camera.rvec,
      translation: camera.tvec,
      matrix: camera.matrix,
      distortions: camera.distortions,
    };
    if (camera.size) camData.size = camera.size;
    calibration[key] = camData;
  });

  const camcorder_to_video_idx_map: Record<string, number> = {};
  for (const [camera, video] of session.videoByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    const videoIndex = videos.indexOf(video);
    if (videoIndex >= 0) {
      camcorder_to_video_idx_map[cameraKey] = videoIndex;
    }
  }

  const frame_group_dicts: Record<string, unknown>[] = [];
  for (const frameGroup of session.frameGroups.values()) {
    if (!frameGroup.instanceGroups.length) continue;
    frame_group_dicts.push(serializeFrameGroup(frameGroup, session, labeledFrameIndex, identities));
  }

  return {
    calibration,
    camcorder_to_video_idx_map,
    frame_group_dicts,
    metadata: session.metadata ?? {},
  };
}

function serializeFrameGroup(
  frameGroup: FrameGroup,
  session: RecordingSession,
  labeledFrameIndex: Map<LabeledFrame, number>,
  identities?: Identity[]
): Record<string, unknown> {
  const instance_groups = frameGroup.instanceGroups.map((group) => serializeInstanceGroup(group, session, identities));
  const labeled_frame_by_camera: Record<string, number> = {};
  for (const [camera, labeledFrame] of frameGroup.labeledFrameByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    const index = labeledFrameIndex.get(labeledFrame);
    if (index !== undefined) {
      labeled_frame_by_camera[cameraKey] = index;
    }
  }

  return {
    frame_idx: frameGroup.frameIdx,
    instance_groups,
    labeled_frame_by_camera,
    metadata: frameGroup.metadata ?? {},
  };
}

function serializeInstanceGroup(group: InstanceGroup, session: RecordingSession, identities?: Identity[]): Record<string, unknown> {
  const instances: Record<string, Record<string, number[]>> = {};
  for (const [camera, instance] of group.instanceByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    instances[cameraKey] = pointsToDict(instance);
  }

  const payload: Record<string, unknown> = {
    instances,
  };
  if (group.score != null) payload.score = group.score;

  // 3D points — serialize from Instance3D if present, otherwise raw points
  if (group.instance3d) {
    if (group.instance3d.points) {
      payload.points = group.instance3d.points;
    }
    if (group.instance3d.score != null) {
      payload.instance_3d_score = group.instance3d.score;
    }
    if (group.instance3d instanceof PredictedInstance3D && group.instance3d.pointScores) {
      payload.instance_3d_point_scores = group.instance3d.pointScores;
    }
  } else if (group.points != null) {
    payload.points = group.points;
  }

  // Identity — serialize as index into Labels.identities
  if (group.identity && identities) {
    const identityIdx = identities.indexOf(group.identity);
    if (identityIdx >= 0) {
      payload.identity_idx = identityIdx;
    }
  }

  if (group.metadata && Object.keys(group.metadata).length) payload.metadata = group.metadata;
  return payload;
}

function pointsToDict(instance: Instance): Record<string, number[]> {
  const names = instance.skeleton.nodeNames;
  const dict: Record<string, number[]> = {};
  instance.points.forEach((point, idx) => {
    const name = point.name ?? names[idx] ?? String(idx);
    const row = [
      point.xy[0],
      point.xy[1],
      point.visible ? 1 : 0,
      point.complete ? 1 : 0,
    ];
    if (point.score != null) {
      row.push(point.score);
    }
    dict[name] = row;
  });
  return dict;
}

function cameraKeyForSession(camera: Camera, session: RecordingSession): string {
  const index = session.cameraGroup.cameras.indexOf(camera);
  return camera.name ?? String(index);
}

function writeLabeledFrames(file: any, labels: Labels): void {
  const frames: number[][] = [];
  const instances: number[][] = [];
  const points: number[][] = [];
  const predPoints: number[][] = [];
  const instanceIndex = new Map<Instance, number>();
  const predictedLinks: Array<[number, PredictedInstance]> = [];

  for (const labeledFrame of labels.labeledFrames) {
    const frameId = frames.length;
    const instanceStart = instances.length;
    const videoIndex = Math.max(0, labels.videos.indexOf(labeledFrame.video));

    for (const instance of labeledFrame.instances) {
      const instanceId = instances.length;
      instanceIndex.set(instance as Instance, instanceId);

      const skeletonId = Math.max(0, labels.skeletons.indexOf(instance.skeleton));
      const trackId = instance.track ? labels.tracks.indexOf(instance.track) : -1;
      const trackingScore = instance.trackingScore ?? 0;
      let fromPredicted = -1;
      let score = 0;
      let pointStart = 0;
      let pointEnd = 0;

      if (instance instanceof PredictedInstance) {
        score = instance.score ?? 0;
        pointStart = predPoints.length;
        for (const point of instance.points) {
          predPoints.push([
            point.xy[0],
            point.xy[1],
            point.visible ? 1 : 0,
            point.complete ? 1 : 0,
            (point as any).score ?? 0,
          ]);
        }
        pointEnd = predPoints.length;
      } else {
        pointStart = points.length;
        for (const point of instance.points) {
          points.push([
            point.xy[0],
            point.xy[1],
            point.visible ? 1 : 0,
            point.complete ? 1 : 0,
          ]);
        }
        pointEnd = points.length;
        if (instance.fromPredicted) {
          predictedLinks.push([instanceId, instance.fromPredicted]);
        }
      }

      instances.push([
        instanceId,
        instance instanceof PredictedInstance ? 1 : 0,
        frameId,
        skeletonId,
        trackId,
        fromPredicted,
        score,
        pointStart,
        pointEnd,
        trackingScore,
      ]);
    }

    const instanceEnd = instances.length;
    frames.push([frameId, videoIndex, labeledFrame.frameIdx, instanceStart, instanceEnd]);
  }

  for (const [instanceId, fromPredictedInstance] of predictedLinks) {
    const fromIndex = instanceIndex.get(fromPredictedInstance as Instance);
    if (fromIndex != null) {
      instances[instanceId][5] = fromIndex;
    } else {
      instances[instanceId][5] = -1;
    }
  }

  createMatrixDataset(file, "frames", frames, ["frame_id", "video", "frame_idx", "instance_id_start", "instance_id_end"], "<i8");
  createMatrixDataset(
    file,
    "instances",
    instances,
    [
      "instance_id",
      "instance_type",
      "frame_id",
      "skeleton",
      "track",
      "from_predicted",
      "score",
      "point_id_start",
      "point_id_end",
      "tracking_score",
    ],
    "<f8"
  );
  createMatrixDataset(file, "points", points, ["x", "y", "visible", "complete"], "<f8");
  createMatrixDataset(file, "pred_points", predPoints, ["x", "y", "visible", "complete", "score"], "<f8");
}

function writeNegativeFrames(file: any, labels: Labels): void {
  const negativeFrames = labels.labeledFrames.filter((f) => f.isNegative);
  if (!negativeFrames.length) return;
  const rows: number[][] = [];
  for (const frame of negativeFrames) {
    const videoIndex = Math.max(0, labels.videos.indexOf(frame.video));
    rows.push([videoIndex, frame.frameIdx]);
  }
  createMatrixDataset(file, "negative_frames", rows, ["video_id", "frame_idx"], "<i8");
}

/**
 * Collect frame data for embedding from video backends.
 */
async function collectFramesForEmbedding(
  labels: Labels,
  embedMode: boolean | string
): Promise<Map<number, EmbeddedVideoFrames>> {
  const result = new Map<number, EmbeddedVideoFrames>();

  // Determine which frame indices to embed per video
  const framesByVideo = new Map<number, Set<number>>();
  const mode = embedMode === true ? "all" : String(embedMode).toLowerCase();

  for (const frame of labels.labeledFrames) {
    const videoIndex = labels.videos.indexOf(frame.video);
    if (videoIndex < 0) continue;

    let include = false;
    if (mode === "all") {
      include = true;
    } else if (mode === "user") {
      include = frame.hasUserInstances;
    } else if (mode === "suggestions") {
      // Include if this frame is a suggestion
      include = false; // handled below
    } else if (mode === "user+suggestions") {
      include = frame.hasUserInstances;
    }

    if (include) {
      if (!framesByVideo.has(videoIndex)) framesByVideo.set(videoIndex, new Set());
      framesByVideo.get(videoIndex)!.add(frame.frameIdx);
    }
  }

  // Add suggestion frames
  if (mode === "suggestions" || mode === "user+suggestions") {
    for (const suggestion of labels.suggestions) {
      const videoIndex = labels.videos.indexOf(suggestion.video);
      if (videoIndex < 0) continue;
      if (!framesByVideo.has(videoIndex)) framesByVideo.set(videoIndex, new Set());
      framesByVideo.get(videoIndex)!.add(suggestion.frameIdx);
    }
  }

  // Read frames from backends
  for (const [videoIndex, frameIndices] of framesByVideo) {
    const video = labels.videos[videoIndex];
    if (!video || !video.backend) continue;

    const sortedFrames = Array.from(frameIndices).sort((a, b) => a - b);
    const frameData = new Map<number, Uint8Array>();

    for (const frameIdx of sortedFrames) {
      const frame = await video.getFrame(frameIdx);
      if (frame) {
        const bytes = frameToBytes(frame);
        if (bytes) {
          frameData.set(frameIdx, bytes);
        }
      }
    }

    if (frameData.size > 0) {
      const backendFormat = (video.backendMetadata?.format as string) ?? "png";
      const backendChannelOrder = (video.backendMetadata?.channel_order as string) ?? "RGB";
      result.set(videoIndex, {
        videoIndex,
        frameNumbers: sortedFrames.filter((f) => frameData.has(f)),
        frameData,
        format: backendFormat,
        channelOrder: backendChannelOrder,
      });
    }
  }

  return result;
}

/**
 * Convert a video frame to Uint8Array bytes for embedding.
 */
function frameToBytes(frame: unknown): Uint8Array | null {
  if (frame instanceof Uint8Array) return frame;
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  if (ArrayBuffer.isView(frame)) {
    const view = frame as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

/**
 * Write video metadata and embedded frame data for videos that are being embedded.
 */
function writeEmbeddedVideos(
  file: any,
  labels: Labels,
  embeddedVideoData: Map<number, EmbeddedVideoFrames>
): void {
  const payload = labels.videos.map((video, videoIndex) => {
    const embedData = embeddedVideoData.get(videoIndex);
    if (embedData) {
      // This video is being embedded - update metadata
      const backend: Record<string, unknown> = {
        filename: ".",
        dataset: `video${videoIndex}/video`,
        format: embedData.format,
        channel_order: embedData.channelOrder,
      };
      if (video.backend?.shape) backend.shape = video.backend.shape;
      if (video.backend?.fps != null) backend.fps = video.backend.fps;

      const entry: Record<string, unknown> = {
        filename: ".",
        backend,
      };
      // Preserve source_video reference to original
      if (video.sourceVideo) {
        entry.source_video = { filename: video.sourceVideo.filename };
      } else if (!video.hasEmbeddedImages) {
        // If this video wasn't already embedded, save original path as source
        entry.source_video = { filename: Array.isArray(video.filename) ? video.filename[0] : video.filename };
      }
      return JSON.stringify(entry);
    } else {
      return JSON.stringify(serializeVideo(video));
    }
  });
  file.create_dataset({ name: "videos_json", data: payload });

  // Write embedded video datasets
  for (const [videoIndex, embedData] of embeddedVideoData) {
    const groupName = `video${videoIndex}`;
    file.create_group(groupName);

    // Write frame data as vlen array
    const frameBytes: Uint8Array[] = [];
    for (const frameNum of embedData.frameNumbers) {
      const data = embedData.frameData.get(frameNum);
      if (data) frameBytes.push(data);
    }

    // Concatenate all frame bytes into a single buffer
    const totalSize = frameBytes.reduce((sum, b) => sum + b.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const bytes of frameBytes) {
      combined.set(bytes, offset);
      offset += bytes.length;
    }

    // Write video data as a 1D uint8 dataset
    file.create_dataset({
      name: `${groupName}/video`,
      data: combined,
      shape: [combined.length],
      dtype: "<B",
    });

    // Set format and channel_order attributes on the dataset
    const videoDs = file.get(`${groupName}/video`);
    if (videoDs) {
      setStringAttr(videoDs, "format", embedData.format);
      setStringAttr(videoDs, "channel_order", embedData.channelOrder);
    }

    // Write frame_numbers dataset
    file.create_dataset({
      name: `${groupName}/frame_numbers`,
      data: embedData.frameNumbers,
      shape: [embedData.frameNumbers.length],
      dtype: "<i4",
    });

    // Write frame_sizes dataset for reliable frame boundary detection
    const frameSizes = frameBytes.map(b => b.length);
    file.create_dataset({
      name: `${groupName}/frame_sizes`,
      data: frameSizes,
      shape: [frameSizes.length],
      dtype: "<i4",
    });
  }
}

function createMatrixDataset(file: any, name: string, rows: number[][], fieldNames: string[], dtype: string): void {
  const rowCount = rows.length;
  const colCount = fieldNames.length;
  const data = rows.flat();
  file.create_dataset({ name, data, shape: [rowCount, colCount], dtype });
  const dataset = file.get(name);
  setStringAttr(dataset, "field_names", JSON.stringify(fieldNames));
}

function writeRois(file: any, rois: ROI[], videos: Video[], tracks: Array<{ name: string }>, instances?: Array<Instance | PredictedInstance>): void {
  if (!rois.length) return;

  const rows: number[][] = [];
  const wkbChunks: Uint8Array[] = [];
  let wkbOffset = 0;
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];
  const hasInstances = instances && instances.length > 0;

  for (const roi of rois) {
    const wkb = encodeWkb(roi.geometry);
    const wkbStart = wkbOffset;
    const wkbEnd = wkbOffset + wkb.length;
    wkbChunks.push(wkb);
    wkbOffset = wkbEnd;

    const videoIdx = roi.video ? videos.indexOf(roi.video) : -1;
    const frameIdx = roi.frameIdx ?? -1;
    const trackIdx = roi.track ? tracks.indexOf(roi.track as any) : -1;
    const instanceIdx = hasInstances && roi.instance ? instances.indexOf(roi.instance) : -1;

    // Hardcode annotation_type=0 (DEFAULT) and score=NaN for backward compat
    rows.push([0, videoIdx, frameIdx, trackIdx, Number.NaN, wkbStart, wkbEnd, instanceIdx]);
    categories.push(roi.category);
    names.push(roi.name);
    sources.push(roi.source);
  }

  createMatrixDataset(file, "rois", rows,
    ["annotation_type", "video", "frame_idx", "track", "score", "wkb_start", "wkb_end", "instance"], "<f8");

  // Set string metadata as attributes
  const roisDs = file.get("rois");
  setStringAttr(roisDs, "categories", JSON.stringify(categories));
  setStringAttr(roisDs, "names", JSON.stringify(names));
  setStringAttr(roisDs, "sources", JSON.stringify(sources));

  // Write concatenated WKB bytes
  const totalWkb = wkbChunks.reduce((sum, c) => sum + c.length, 0);
  const wkbFlat = new Uint8Array(totalWkb);
  let offset = 0;
  for (const chunk of wkbChunks) {
    wkbFlat.set(chunk, offset);
    offset += chunk.length;
  }
  file.create_dataset({ name: "roi_wkb", data: wkbFlat, shape: [wkbFlat.length], dtype: "<B" });
}

function writeMasks(file: any, masks: SegmentationMask[], videos: Video[], tracks: Array<{ name: string }>): void {
  if (!masks.length) return;

  const rows: number[][] = [];
  const rleChunks: Uint8Array[] = [];
  let rleOffset = 0;
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  for (const mask of masks) {
    // Convert Uint32Array RLE counts to bytes (little-endian)
    const rleBytes = new Uint8Array(mask.rleCounts.length * 4);
    const view = new DataView(rleBytes.buffer);
    for (let j = 0; j < mask.rleCounts.length; j++) {
      view.setUint32(j * 4, mask.rleCounts[j], true);
    }
    const rleStart = rleOffset;
    const rleEnd = rleOffset + rleBytes.length;
    rleChunks.push(rleBytes);
    rleOffset = rleEnd;

    const videoIdx = mask.video ? videos.indexOf(mask.video) : -1;
    const frameIdx = mask.frameIdx ?? -1;
    const trackIdx = mask.track ? tracks.indexOf(mask.track as any) : -1;

    // Hardcode annotation_type=2 (SEGMENTATION) and score=NaN for backward compat
    rows.push([mask.height, mask.width, 2, videoIdx, frameIdx, trackIdx, Number.NaN, rleStart, rleEnd]);
    categories.push(mask.category);
    names.push(mask.name);
    sources.push(mask.source);
  }

  createMatrixDataset(file, "masks", rows,
    ["height", "width", "annotation_type", "video", "frame_idx", "track", "score", "rle_start", "rle_end"], "<f8");

  // Set string metadata as attributes
  const masksDs = file.get("masks");
  setStringAttr(masksDs, "categories", JSON.stringify(categories));
  setStringAttr(masksDs, "names", JSON.stringify(names));
  setStringAttr(masksDs, "sources", JSON.stringify(sources));

  // Write concatenated RLE bytes
  const totalRle = rleChunks.reduce((sum, c) => sum + c.length, 0);
  const rleFlat = new Uint8Array(totalRle);
  let offset = 0;
  for (const chunk of rleChunks) {
    rleFlat.set(chunk, offset);
    offset += chunk.length;
  }
  file.create_dataset({ name: "mask_rle", data: rleFlat, shape: [rleFlat.length], dtype: "<B" });
}

function writeBboxes(
  file: any,
  bboxes: BoundingBox[],
  videos: Video[],
  tracks: Array<{ name: string }>,
  instances: (Instance | PredictedInstance)[],
): void {
  if (!bboxes.length) return;

  const rows: number[][] = [];
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  for (const bbox of bboxes) {
    const videoIdx = bbox.video ? videos.indexOf(bbox.video) : -1;
    const frameIdx = bbox.frameIdx ?? -1;
    const trackIdx = bbox.track ? tracks.indexOf(bbox.track as any) : -1;
    const score = bbox.isPredicted ? (bbox as PredictedBoundingBox).score : Number.NaN;
    const instanceIdx = bbox.instance ? instances.indexOf(bbox.instance as Instance) : -1;

    rows.push([
      bbox.xCenter,
      bbox.yCenter,
      bbox.width,
      bbox.height,
      bbox.angle,
      videoIdx,
      frameIdx,
      trackIdx,
      score,
      instanceIdx,
    ]);
    categories.push(bbox.category);
    names.push(bbox.name);
    sources.push(bbox.source);
  }

  createMatrixDataset(file, "bboxes", rows,
    ["x_center", "y_center", "width", "height", "angle", "video", "frame_idx", "track", "score", "instance"], "<f8");

  // Set string metadata as attributes
  const bboxesDs = file.get("bboxes");
  setStringAttr(bboxesDs, "categories", JSON.stringify(categories));
  setStringAttr(bboxesDs, "names", JSON.stringify(names));
  setStringAttr(bboxesDs, "sources", JSON.stringify(sources));
}
