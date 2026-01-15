import { Labels } from "../model/labels.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { Instance, PredictedInstance, Track, pointsFromArray, predictedPointsFromArray } from "../model/instance.js";
import { Skeleton, Edge, Node, Symmetry } from "../model/skeleton.js";
import { Video } from "../model/video.js";
import { SuggestionFrame } from "../model/suggestions.js";
import { MediaVideoBackend } from "../video/media-video.js";

export type LabelsDict = {
  version: string;
  skeletons: Array<{
    name?: string;
    nodes: string[];
    edges: Array<[number, number]>;
    symmetries: Array<[number, number]>;
  }>;
  videos: Array<{
    filename: string | string[];
    shape?: number[] | null;
    fps?: number | null;
    backend?: Record<string, unknown>;
  }>;
  tracks: Array<Record<string, unknown>>;
  labeled_frames: Array<{
    frame_idx: number;
    video_idx: number;
    instances: Array<Record<string, unknown>>;
  }>;
  suggestions: Array<Record<string, unknown>>;
  provenance: Record<string, unknown>;
};

export function toDict(
  labels: Labels,
  options?: { video?: Video | number; skipEmptyFrames?: boolean }
): LabelsDict {
  const videoFilter = resolveVideoFilter(labels, options?.video);
  const videos = videoFilter ? [videoFilter.video] : labels.videos;

  const tracks = collectTracks(labels, videoFilter?.video);
  const trackIndex = new Map(tracks.map((track, idx) => [track, idx]));

  const skeletons = labels.skeletons.map((skeleton) => {
    const edges: Array<[number, number]> = skeleton.edges.map((edge) => [
      skeleton.index(edge.source.name),
      skeleton.index(edge.destination.name),
    ]);
    const symmetries: Array<[number, number]> = skeleton.symmetries.map((sym) => {
      const [left, right] = sym.nodes;
      return [skeleton.index(left.name), skeleton.index(right.name)];
    });
    return {
      name: skeleton.name ?? undefined,
      nodes: skeleton.nodeNames,
      edges,
      symmetries,
    };
  });

  const labeledFrames: LabelsDict["labeled_frames"] = [];
  for (const frame of labels.labeledFrames) {
    if (videoFilter && !frame.video.matchesPath(videoFilter.video, true)) continue;
    if (options?.skipEmptyFrames && frame.instances.length === 0) continue;
    const videoIdx = videos.indexOf(frame.video);
    if (videoIdx < 0) continue;
    labeledFrames.push({
      frame_idx: frame.frameIdx,
      video_idx: videoIdx,
      instances: frame.instances.map((instance) => instanceToDict(instance, labels, trackIndex)),
    });
  }

  const suggestions = labels.suggestions
    .filter((suggestion) => !videoFilter || suggestion.video.matchesPath(videoFilter.video, true))
    .map((suggestion) => ({
      frame_idx: suggestion.frameIdx,
      video_idx: videos.indexOf(suggestion.video),
      ...suggestion.metadata,
    }));

  const videoDicts = videos.map((video) => {
    const backendType = resolveBackendType(video);
    const backend: Record<string, unknown> | undefined = backendType ? { type: backendType } : undefined;
    const shape = video.shape ? Array.from(video.shape) : undefined;
    const fps = video.fps ?? undefined;
    return {
      filename: video.filename,
      shape,
      fps,
      backend,
    };
  });

  return {
    version: "1.0.0",
    skeletons,
    videos: videoDicts,
    tracks: tracks.map((track) => trackToDict(track)),
    labeled_frames: labeledFrames,
    suggestions,
    provenance: labels.provenance ?? {},
  };
}

export function fromDict(data: LabelsDict): Labels {
  validateDict(data);

  const skeletons = data.skeletons.map((skeleton) => {
    const nodes = skeleton.nodes.map((name) => new Node(name));
    const edges = skeleton.edges.map(([sourceIdx, destIdx]) => new Edge(nodes[sourceIdx], nodes[destIdx]));
    const symmetries = (skeleton.symmetries ?? []).map(
      ([leftIdx, rightIdx]) => new Symmetry([nodes[leftIdx], nodes[rightIdx]])
    );
    return new Skeleton({ name: skeleton.name, nodes, edges, symmetries });
  });

  const videos = data.videos.map((video) => new Video({ filename: video.filename }));
  const tracks = data.tracks.map((track) => new Track(String(track.name ?? "")));

  const labeledFrames = data.labeled_frames.map((frame) => {
    const video = videos[frame.video_idx];
    const instances = frame.instances.map((inst) => dictToInstance(inst, skeletons, tracks));
    return new LabeledFrame({ video, frameIdx: frame.frame_idx, instances });
  });

  const suggestions = data.suggestions.map((suggestion) => {
    const entry = suggestion as Record<string, unknown>;
    const video = videos[(entry.video_idx as number | undefined) ?? 0];
    return new SuggestionFrame({ video, frameIdx: (entry.frame_idx as number) ?? 0, metadata: entry });
  });

  return new Labels({
    labeledFrames,
    videos,
    skeletons,
    tracks,
    suggestions,
    provenance: data.provenance ?? {},
  });
}

function resolveVideoFilter(labels: Labels, video?: Video | number) {
  if (video === undefined) return null;
  if (typeof video === "number") {
    const entry = labels.videos[video];
    if (!entry) throw new Error("Video index out of range.");
    return { video: entry };
  }
  return { video };
}

function collectTracks(labels: Labels, video?: Video): Track[] {
  const trackSet = new Set<Track>();
  for (const track of labels.tracks) {
    trackSet.add(track);
  }
  for (const frame of labels.labeledFrames) {
    if (video && !frame.video.matchesPath(video, true)) continue;
    for (const instance of frame.instances) {
      if (instance.track) trackSet.add(instance.track);
    }
  }
  return Array.from(trackSet);
}

function instanceToDict(
  instance: Instance | PredictedInstance,
  labels: Labels,
  trackIndex: Map<Track, number>
): Record<string, unknown> {
  const skeletonIdx = labels.skeletons.indexOf(instance.skeleton);
  const isPredicted = instance instanceof PredictedInstance;
  const points = instance.points.map((point) => {
    const payload: Record<string, unknown> = {
      x: point.xy[0],
      y: point.xy[1],
      visible: point.visible,
      complete: point.complete,
    };
    if (isPredicted && "score" in point) {
      payload.score = (point as { score: number }).score;
    }
    return payload;
  });

  const payload: Record<string, unknown> = {
    type: isPredicted ? "predicted_instance" : "instance",
    skeleton_idx: skeletonIdx,
    points,
  };

  if (instance.track) {
    payload.track_idx = trackIndex.get(instance.track);
  }

  if (isPredicted) {
    payload.score = (instance as PredictedInstance).score;
  }

  if (instance.trackingScore !== undefined) {
    payload.tracking_score = instance.trackingScore;
  }

  if (!isPredicted && instance.fromPredicted) {
    payload.has_from_predicted = true;
  }

  return payload;
}

function dictToInstance(
  data: Record<string, unknown>,
  skeletons: Skeleton[],
  tracks: Track[]
): Instance | PredictedInstance {
  const type = data.type === "predicted_instance" ? "predicted" : "instance";
  const skeleton = skeletons[(data.skeleton_idx as number) ?? 0] ?? skeletons[0];
  const trackIdx = data.track_idx as number | undefined;
  const track = trackIdx !== undefined ? tracks[trackIdx] : undefined;

  const points = Array.isArray(data.points) ? (data.points as Array<Record<string, unknown>>) : [];
  if (type === "predicted") {
    const pointRows = points.map((point) => [
      Number(point.x),
      Number(point.y),
      Number(point.score ?? Number.NaN),
      point.visible ? 1 : 0,
      point.complete ? 1 : 0,
    ]);
    return new PredictedInstance({
      points: predictedPointsFromArray(pointRows, skeleton.nodeNames),
      skeleton,
      track,
      score: Number(data.score ?? 0),
      trackingScore: Number(data.tracking_score ?? 0),
    });
  }

  const pointRows = points.map((point) => [
    Number(point.x),
    Number(point.y),
    point.visible ? 1 : 0,
    point.complete ? 1 : 0,
  ]);
  return new Instance({
    points: pointsFromArray(pointRows, skeleton.nodeNames),
    skeleton,
    track,
    trackingScore: Number(data.tracking_score ?? 0),
  });
}

function resolveBackendType(video: Video): string | null {
  if (!video.backend) return null;
  if (video.backend instanceof MediaVideoBackend) return "MediaVideo";
  return video.backend.constructor?.name ?? null;
}

function trackToDict(track: Track): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: track.name };
  const spawnedOn = (track as unknown as { spawned_on?: number }).spawned_on;
  if (spawnedOn !== undefined) {
    payload.spawned_on = spawnedOn;
  }
  return payload;
}

function validateDict(data: LabelsDict): void {
  const required = ["version", "skeletons", "videos", "tracks", "labeled_frames", "suggestions", "provenance"] as const;
  for (const key of required) {
    if (!(key in data)) {
      throw new Error(`Missing required key: ${key}`);
    }
  }
}
