import { Labels } from "../../model/labels.js";
import { Instance, PredictedInstance } from "../../model/instance.js";
import type { Track } from "../../model/instance.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import { RecordingSession, Camera, InstanceGroup, FrameGroup } from "../../model/camera.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video } from "../../model/video.js";
import { getH5Module, getH5FileSystem } from "./h5.js";
import { ROI, PredictedROI, encodeWkb } from "../../model/roi.js";
import { SegmentationMask, PredictedSegmentationMask } from "../../model/mask.js";
import { BoundingBox, PredictedBoundingBox } from "../../model/bbox.js";
import { Centroid, PredictedCentroid } from "../../model/centroid.js";
import { LabelImage, PredictedLabelImage } from "../../model/label-image.js";
import { deflate } from "pako";
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

/** Write a string array as a JSON-encoded string attribute dataset at root level. */
function writeStringDataset(file: any, name: string, values: string[]): void {
  const json = JSON.stringify(values);
  const bytes = textEncoder.encode(json);
  file.create_dataset({ name, data: bytes, shape: [bytes.length], dtype: "<B" });
  const ds = file.get(name);
  setStringAttr(ds, "json", json);
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
  writeMasks(file, labels.masks, labels.videos, labels.tracks, allInstances);
  writeBboxes(file, labels.bboxes, labels.videos, labels.tracks, allInstances);
  writeCentroids(file, labels.centroids, labels.videos, labels.tracks, allInstances);
  writeLabelImages(file, labels.labelImages, labels.videos, labels.tracks, allInstances);
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
      rois: labels.rois,
      masks: labels.masks,
      bboxes: labels.bboxes,
      centroids: labels.centroids,
      labelImages: labels.labelImages,
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
  const hasPredicted =
    labels.rois.some((r) => r.isPredicted) ||
    labels.masks.some((m) => m.isPredicted) ||
    (labels.labelImages ?? []).some((li) => li.isPredicted);
  const hasMaskInstances = labels.masks.some((m) => m.instance !== null || (m._instanceIdx != null && m._instanceIdx >= 0));
  let formatId = (labels.bboxes?.length ?? 0) > 0
    ? 2.0
    : (hasPredicted || hasMaskInstances)
      ? 1.9
      : (labels.labelImages?.length ?? 0) > 0
        ? 1.8
        : hasRoiInstance
          ? 1.6
          : (labels.rois.length > 0 || labels.masks.length > 0)
            ? 1.5
            : FORMAT_ID;
  if (hasIdentities) {
    formatId = Math.max(formatId, 1.9);
  }

  // v2.1: spatial transform metadata on masks or label images
  const hasSpatialTransform =
    labels.masks.some((m) => m.hasSpatialTransform) ||
    (labels.labelImages ?? []).some((li) => li.hasSpatialTransform);
  if (hasSpatialTransform) {
    formatId = Math.max(formatId, 2.1);
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
    for (const [key, value] of Object.entries(identity.metadata)) {
      if (key !== "name" && key !== "color") {
        d[key] = value;
      }
    }
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
    if (cameraKey !== "-1" && videoIndex >= 0) {
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
  const instance_groups = frameGroup.instanceGroups.map((group) => serializeInstanceGroup(group, session, identities, frameGroup, labeledFrameIndex));
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

function serializeInstanceGroup(
  group: InstanceGroup,
  session: RecordingSession,
  identities?: Identity[],
  frameGroup?: FrameGroup,
  labeledFrameIndex?: Map<LabeledFrame, number>,
): Record<string, unknown> {
  const instances: Record<string, Record<string, number[]>> = {};
  for (const [camera, instance] of group.instanceByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    instances[cameraKey] = pointsToDict(instance);
  }

  // Build Python-compatible camcorder_to_lf_and_inst_idx_map
  const camcorder_to_lf_and_inst_idx_map: Record<string, [number, number]> = {};
  if (frameGroup && labeledFrameIndex) {
    for (const [camera, instance] of group.instanceByCamera.entries()) {
      const cameraKey = cameraKeyForSession(camera, session);
      const labeledFrame = frameGroup.labeledFrameByCamera.get(camera);
      if (labeledFrame) {
        const lfIdx = labeledFrameIndex.get(labeledFrame);
        const instIdx = labeledFrame.instances.indexOf(instance as Instance);
        if (lfIdx !== undefined && instIdx >= 0) {
          camcorder_to_lf_and_inst_idx_map[cameraKey] = [lfIdx, instIdx];
        }
      }
    }
  }

  const payload: Record<string, unknown> = {
    instances,
  };
  if (Object.keys(camcorder_to_lf_and_inst_idx_map).length > 0) {
    payload.camcorder_to_lf_and_inst_idx_map = camcorder_to_lf_and_inst_idx_map;
  }
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
    } else {
      console.warn(`InstanceGroup references an Identity ("${group.identity.name}") not found in Labels.identities — identity will be dropped on save.`);
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
  return String(session.cameraGroup.cameras.indexOf(camera));
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
  // Pre-allocate typed array to avoid intermediate .flat() allocation
  const TypedArray = dtype.includes("i") ? (dtype.includes("4") ? Int32Array : Float64Array) : Float64Array;
  const data = new TypedArray(rowCount * colCount);
  for (let i = 0; i < rowCount; i++) {
    const row = rows[i];
    const offset = i * colCount;
    for (let j = 0; j < colCount; j++) {
      data[offset + j] = row[j];
    }
  }
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
    const score = roi.isPredicted ? (roi as PredictedROI).score : Number.NaN;
    const isPredicted = roi.isPredicted ? 1 : 0;
    const trackingScore = roi.trackingScore ?? Number.NaN;

    rows.push([0, videoIdx, frameIdx, trackIdx, score, trackingScore, wkbStart, wkbEnd, instanceIdx, isPredicted]);
    categories.push(roi.category);
    names.push(roi.name);
    sources.push(roi.source);
  }

  createMatrixDataset(file, "rois", rows,
    ["annotation_type", "video", "frame_idx", "track", "score", "tracking_score", "wkb_start", "wkb_end", "instance", "is_predicted"], "<f8");

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "roi_categories", categories);
  writeStringDataset(file, "roi_names", names);
  writeStringDataset(file, "roi_sources", sources);

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

function writeMasks(
  file: any,
  masks: SegmentationMask[],
  videos: Video[],
  tracks: Array<{ name: string }>,
  instances: (Instance | PredictedInstance)[],
): void {
  if (!masks.length) return;

  const rows: number[][] = [];
  const rleChunks: Uint8Array[] = [];
  let rleOffset = 0;
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  // Score map collection
  const scoreMapIndexRows: number[][] = [];
  const scoreMapChunks: Uint8Array[] = [];
  let smOffset = 0;

  for (let i = 0; i < masks.length; i++) {
    const mask = masks[i];
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
    const score = mask.isPredicted ? (mask as PredictedSegmentationMask).score : Number.NaN;
    const isPredicted = mask.isPredicted ? 1 : 0;
    const instanceIdx = mask.instance ? instances.indexOf(mask.instance as Instance) : (mask._instanceIdx ?? -1);
    const maskTrackingScore = mask.trackingScore ?? Number.NaN;

    rows.push([
      mask.height, mask.width, 2, videoIdx, frameIdx, trackIdx,
      score, rleStart, rleEnd, isPredicted, instanceIdx, maskTrackingScore,
      mask.scale[0], mask.scale[1], mask.offset[0], mask.offset[1],
    ]);
    categories.push(mask.category);
    names.push(mask.name);
    sources.push(mask.source);

    // Collect score maps for predicted masks
    if (mask.isPredicted) {
      const pm = mask as PredictedSegmentationMask;
      if (pm.scoreMap) {
        const smBytes = new Uint8Array(pm.scoreMap.buffer, pm.scoreMap.byteOffset, pm.scoreMap.byteLength);
        const compressed = deflate(smBytes);
        const smH = pm.scoreMap.length / mask.width;
        if (!Number.isInteger(smH)) {
          throw new Error(`Score map size ${pm.scoreMap.length} not divisible by width ${mask.width}`);
        }
        scoreMapIndexRows.push([i, smOffset, smOffset + compressed.length, smH, mask.width]);
        scoreMapChunks.push(compressed);
        smOffset += compressed.length;
      }
    }
  }

  createMatrixDataset(file, "masks", rows,
    ["height", "width", "annotation_type", "video", "frame_idx", "track", "score", "rle_start", "rle_end", "is_predicted", "instance", "tracking_score", "scale_x", "scale_y", "offset_x", "offset_y"], "<f8");

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "mask_categories", categories);
  writeStringDataset(file, "mask_names", names);
  writeStringDataset(file, "mask_sources", sources);

  // Write concatenated RLE bytes
  const totalRle = rleChunks.reduce((sum, c) => sum + c.length, 0);
  const rleFlat = new Uint8Array(totalRle);
  let offset = 0;
  for (const chunk of rleChunks) {
    rleFlat.set(chunk, offset);
    offset += chunk.length;
  }
  file.create_dataset({ name: "mask_rle", data: rleFlat, shape: [rleFlat.length], dtype: "<B" });

  // Write score maps
  if (scoreMapIndexRows.length > 0) {
    createMatrixDataset(file, "mask_score_map_index", scoreMapIndexRows,
      ["mask_idx", "data_start", "data_end", "height", "width"], "<f8");
    const totalSm = scoreMapChunks.reduce((sum, c) => sum + c.length, 0);
    const smFlat = new Uint8Array(totalSm);
    let smOff = 0;
    for (const chunk of scoreMapChunks) {
      smFlat.set(chunk, smOff);
      smOff += chunk.length;
    }
    file.create_dataset({ name: "mask_score_maps", data: smFlat, shape: [smFlat.length], dtype: "<B" });
  }
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

    const trackingScore = bbox.trackingScore ?? Number.NaN;

    rows.push([
      bbox.x1,
      bbox.y1,
      bbox.x2,
      bbox.y2,
      bbox.angle,
      videoIdx,
      frameIdx,
      trackIdx,
      score,
      instanceIdx,
      trackingScore,
    ]);
    categories.push(bbox.category);
    names.push(bbox.name);
    sources.push(bbox.source);
  }

  createMatrixDataset(file, "bboxes", rows,
    ["x1", "y1", "x2", "y2", "angle", "video", "frame_idx", "track", "score", "instance", "tracking_score"], "<f8");

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "bbox_categories", categories);
  writeStringDataset(file, "bbox_names", names);
  writeStringDataset(file, "bbox_sources", sources);
}

function writeLabelImages(
  file: any,
  labelImages: LabelImage[],
  videos: Video[],
  tracks: Track[],
  instances: (Instance | PredictedInstance)[],
): void {
  if (!labelImages.length) return;

  // Verify little-endian platform (label image data is stored as raw LE bytes)
  const endianCheck = new Uint8Array(new Uint16Array([0x0102]).buffer);
  if (endianCheck[0] !== 0x02) {
    throw new Error("LabelImage I/O requires a little-endian platform.");
  }

  const rows: number[][] = [];
  const compressedChunks: Uint8Array[] = [];
  let dataOffset = 0;
  const objectRows: number[][] = [];
  const objectCategories: string[] = [];
  const objectNames: string[] = [];
  const sources: string[] = [];
  let objectsOffset = 0;

  // Score map collection
  const smIndexRows: number[][] = [];
  const smChunks: Uint8Array[] = [];
  let smOffset = 0;

  for (let liIdx = 0; liIdx < labelImages.length; liIdx++) {
    const li = labelImages[liIdx];
    const videoIdx = li.video ? videos.indexOf(li.video) : -1;
    const frameIdx = li.frameIdx ?? -1;

    // Compress pixel data: Int32Array -> raw bytes -> zlib
    const pixelBytes = new Uint8Array(li.data.buffer, li.data.byteOffset, li.data.byteLength);
    const compressed = deflate(pixelBytes);
    const dataStart = dataOffset;
    const dataEnd = dataOffset + compressed.length;
    compressedChunks.push(compressed);
    dataOffset = dataEnd;

    const isPredicted = li.isPredicted ? 1 : 0;
    const liScore = li.isPredicted ? (li as PredictedLabelImage).score : Number.NaN;

    // Per-object entries
    const objectsStart = objectsOffset;
    for (const [labelId, info] of li.objects) {
      const trackIdx = info.track ? tracks.indexOf(info.track as Track) : -1;
      // PR #386: fall back to _instanceIdx when instance is null
      let instanceIdx = li._objectInstanceIdxs?.get(labelId) ?? -1;
      if (info.instance) {
        const found = instances.indexOf(info.instance as Instance);
        if (found >= 0) instanceIdx = found;
      } else if (info._instanceIdx != null && info._instanceIdx >= 0) {
        instanceIdx = info._instanceIdx;
      }
      const objScore = info.score != null ? info.score : Number.NaN;
      const objTrackingScore = info.trackingScore != null ? info.trackingScore : Number.NaN;
      objectRows.push([labelId, trackIdx, instanceIdx, objScore, objTrackingScore]);
      objectCategories.push(info.category);
      objectNames.push(info.name);
      objectsOffset++;
    }

    rows.push([videoIdx, frameIdx, li.height, li.width, li.nObjects, objectsStart, dataStart, dataEnd, isPredicted, liScore,
      li.scale[0], li.scale[1], li.offset[0], li.offset[1]]);
    sources.push(li.source);

    // Collect score maps for predicted label images
    if (li.isPredicted) {
      const pli = li as PredictedLabelImage;
      if (pli.scoreMap) {
        const smBytes = new Uint8Array(pli.scoreMap.buffer, pli.scoreMap.byteOffset, pli.scoreMap.byteLength);
        const smCompressed = deflate(smBytes);
        const smH = pli.scoreMap.length / li.width;
        if (!Number.isInteger(smH)) {
          throw new Error(`Score map size ${pli.scoreMap.length} not divisible by width ${li.width}`);
        }
        smIndexRows.push([liIdx, smOffset, smOffset + smCompressed.length, smH, li.width]);
        smChunks.push(smCompressed);
        smOffset += smCompressed.length;
      }
    }
  }

  // Write main metadata table
  createMatrixDataset(file, "label_images", rows,
    ["video", "frame_idx", "height", "width", "n_objects", "objects_start", "data_start", "data_end", "is_predicted", "score",
     "scale_x", "scale_y", "offset_x", "offset_y"], "<f8");

  // Write string metadata as datasets at root level (v1.9+)
  writeStringDataset(file, "label_image_sources", sources);

  // Write objects table (if any objects exist)
  if (objectRows.length > 0) {
    createMatrixDataset(file, "label_image_objects", objectRows,
      ["label_id", "track", "instance", "score", "tracking_score"], "<f8");
    // Write string metadata as datasets at root level (v1.9+)
    writeStringDataset(file, "label_image_obj_categories", objectCategories);
    writeStringDataset(file, "label_image_obj_names", objectNames);
  }

  // Write concatenated compressed pixel data
  const totalData = compressedChunks.reduce((sum, c) => sum + c.length, 0);
  const dataFlat = new Uint8Array(totalData);
  let offset = 0;
  for (const chunk of compressedChunks) {
    dataFlat.set(chunk, offset);
    offset += chunk.length;
  }
  file.create_dataset({ name: "label_image_data", data: dataFlat, shape: [dataFlat.length], dtype: "<B" });

  // Write score maps
  if (smIndexRows.length > 0) {
    createMatrixDataset(file, "label_image_score_map_index", smIndexRows,
      ["li_idx", "data_start", "data_end", "height", "width"], "<f8");
    const totalSm = smChunks.reduce((sum, c) => sum + c.length, 0);
    const smFlat = new Uint8Array(totalSm);
    let smOff = 0;
    for (const chunk of smChunks) {
      smFlat.set(chunk, smOff);
      smOff += chunk.length;
    }
    file.create_dataset({ name: "label_image_score_maps", data: smFlat, shape: [smFlat.length], dtype: "<B" });
  }
}

function writeCentroids(
  file: any,
  centroids: Centroid[],
  videos: Video[],
  tracks: Array<{ name: string }>,
  instances: (Instance | PredictedInstance)[],
): void {
  if (!centroids.length) return;

  const rows: number[][] = [];
  const categories: string[] = [];
  const names: string[] = [];
  const sources: string[] = [];

  for (const c of centroids) {
    const videoIdx = c.video ? videos.indexOf(c.video) : -1;
    const frameIdx = c.frameIdx ?? -1;
    const trackIdx = c.track ? tracks.indexOf(c.track as any) : -1;
    const score = c.isPredicted ? (c as PredictedCentroid).score : Number.NaN;
    const instanceIdx = c.instance ? instances.indexOf(c.instance as Instance) : -1;
    const isPredicted = c.isPredicted ? 1 : 0;
    const trackingScore = c.trackingScore ?? Number.NaN;

    rows.push([
      c.x, c.y, c.z ?? Number.NaN,
      videoIdx, frameIdx, trackIdx, instanceIdx,
      isPredicted, score, trackingScore,
    ]);
    categories.push(c.category);
    names.push(c.name);
    sources.push(c.source);
  }

  createMatrixDataset(file, "centroids", rows,
    ["x", "y", "z", "video", "frame_idx", "track", "instance", "is_predicted", "score", "tracking_score"], "<f8");

  writeStringDataset(file, "centroid_categories", categories);
  writeStringDataset(file, "centroid_names", names);
  writeStringDataset(file, "centroid_sources", sources);
}
