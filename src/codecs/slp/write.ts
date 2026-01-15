import { Labels } from "../../model/labels.js";
import { Instance, PredictedInstance } from "../../model/instance.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import { RecordingSession, Camera, InstanceGroup, FrameGroup } from "../../model/camera.js";
import { Skeleton } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video } from "../../model/video.js";
import { getH5Module } from "./h5.js";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const FORMAT_ID = 1.4;
const SPAWNED_ON = 0;

export async function writeSlp(
  filename: string,
  labels: Labels,
  options?: {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
  }
): Promise<void> {
  const embedMode = options?.embed ?? false;
  if (embedMode && embedMode !== "source") {
    throw new Error("Embedding frames is not supported yet in writeSlp.");
  }
  if (!isNode) {
    throw new Error("writeSlp currently requires a Node.js environment.");
  }

  const module = await getH5Module();

  const file = new module.File(filename, "w");
  try {
    writeMetadata(file, labels);
    writeVideos(file, labels.videos);
    writeTracks(file, labels.tracks);
    writeSuggestions(file, labels.suggestions, labels.videos);
    writeSessions(file, labels.sessions, labels.videos, labels.labeledFrames);
    writeLabeledFrames(file, labels);
  } finally {
    file.close();
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

  file.create_group("metadata");
  const metadataGroup = file.get("metadata");
  metadataGroup.create_attribute("format_id", FORMAT_ID);
  metadataGroup.create_attribute("json", JSON.stringify(metadata));
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
    const links: Array<{ source: number; target: number; type: any }> = [];

    for (const edge of skeleton.edges) {
      const source = nodeIndex.get(edge.source.name) ?? 0;
      const target = nodeIndex.get(edge.destination.name) ?? 0;
      links.push({ source, target, type: { "py/tuple": [1] } });
    }

    for (const [left, right] of skeleton.symmetryNames) {
      const source = nodeIndex.get(left) ?? 0;
      const target = nodeIndex.get(right) ?? 0;
      links.push({ source, target, type: { "py/tuple": [2] } });
    }

    return {
      links,
      name: skeleton.name ?? undefined,
      graph: skeleton.name ? { name: skeleton.name } : undefined,
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
      group: suggestion.metadata?.group ?? 0,
    })
  );
  file.create_dataset({ name: "suggestions_json", data: payload });
}

function writeSessions(file: any, sessions: RecordingSession[], videos: Video[], labeledFrames: LabeledFrame[]): void {
  const labeledFrameIndex = new Map<LabeledFrame, number>();
  labeledFrames.forEach((lf, idx) => labeledFrameIndex.set(lf, idx));

  const payload = sessions.map((session) => JSON.stringify(serializeSession(session, videos, labeledFrameIndex)));
  file.create_dataset({ name: "sessions_json", data: payload });
}

function serializeSession(
  session: RecordingSession,
  videos: Video[],
  labeledFrameIndex: Map<LabeledFrame, number>
): Record<string, unknown> {
  const calibration: Record<string, unknown> = { metadata: session.cameraGroup.metadata ?? {} };
  session.cameraGroup.cameras.forEach((camera, idx) => {
    const key = camera.name ?? String(idx);
    calibration[key] = {
      name: camera.name ?? key,
      rotation: camera.rvec,
      translation: camera.tvec,
      matrix: camera.matrix,
      distortions: camera.distortions,
    };
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
    frame_group_dicts.push(serializeFrameGroup(frameGroup, session, labeledFrameIndex));
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
  labeledFrameIndex: Map<LabeledFrame, number>
): Record<string, unknown> {
  const instance_groups = frameGroup.instanceGroups.map((group) => serializeInstanceGroup(group, session));
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

function serializeInstanceGroup(group: InstanceGroup, session: RecordingSession): Record<string, unknown> {
  const instances: Record<string, Record<string, number[]>> = {};
  for (const [camera, instance] of group.instanceByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    instances[cameraKey] = pointsToDict(instance);
  }

  const payload: Record<string, unknown> = {
    instances,
  };
  if (group.score != null) payload.score = group.score;
  if (group.points != null) payload.points = group.points;
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
    if ((point as any).score != null) {
      row.push((point as any).score as number);
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

function createMatrixDataset(file: any, name: string, rows: number[][], fieldNames: string[], dtype: string): void {
  const rowCount = rows.length;
  const colCount = fieldNames.length;
  const data = rows.flat();
  file.create_dataset({ name, data, shape: [rowCount, colCount], dtype });
  const dataset = file.get(name);
  dataset.create_attribute("field_names", fieldNames);
}
