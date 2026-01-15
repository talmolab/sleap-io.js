import { openH5File, OpenH5Options, SlpSource } from "./h5.js";
import { Labels } from "../../model/labels.js";
import { LabeledFrame } from "../../model/labeled-frame.js";
import { Instance, PredictedInstance, Track, pointsFromArray, predictedPointsFromArray } from "../../model/instance.js";
import { Skeleton, Node, Edge, Symmetry } from "../../model/skeleton.js";
import { SuggestionFrame } from "../../model/suggestions.js";
import { Video } from "../../model/video.js";
import { createVideoBackend } from "../../video/factory.js";
import { Camera, CameraGroup, FrameGroup, InstanceGroup, RecordingSession } from "../../model/camera.js";

const textDecoder = new TextDecoder();

export async function readSlp(
  source: SlpSource,
  options?: { openVideos?: boolean; h5?: OpenH5Options }
): Promise<Labels> {
  const { file, close } = await openH5File(source, options?.h5);
  try {
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Missing /metadata group in SLP file");
    }

    const metadataAttrs = (metadataGroup as unknown as { attrs?: Record<string, any> }).attrs ?? {};
    const formatId = Number(metadataAttrs["format_id"]?.value ?? metadataAttrs["format_id"] ?? 1.0);
    const metadataJson = parseJsonAttr(metadataAttrs["json"]);

    const labelsPath = typeof source === "string" ? source : options?.h5?.filenameHint ?? "slp-data.slp";
    const skeletons = readSkeletons(metadataJson);
    const tracks = readTracks(file.get("tracks_json"));
    const videos = await readVideos(file.get("videos_json"), labelsPath, options?.openVideos ?? true, file);
    const suggestions = readSuggestions(file.get("suggestions_json"), videos);

    const framesData = normalizeStructDataset(file.get("frames"));
    const instancesData = normalizeStructDataset(file.get("instances"));
    const pointsData = normalizeStructDataset(file.get("points"));
    const predPointsData = normalizeStructDataset(file.get("pred_points"));

    const labeledFrames = buildLabeledFrames({
      framesData,
      instancesData,
      pointsData,
      predPointsData,
      skeletons,
      tracks,
      videos,
      formatId,
    });

    const sessions = readSessions(file.get("sessions_json"), videos, skeletons, labeledFrames);

    return new Labels({
      labeledFrames,
      videos,
      skeletons,
      tracks,
      suggestions,
      sessions,
      provenance: metadataJson?.provenance ?? {},
    });
  } finally {
    close();
  }
}

function parseJsonAttr(attr: any): any {
  if (!attr) return null;
  const value = attr.value ?? attr;
  if (typeof value === "string") return JSON.parse(value);
  if (value instanceof Uint8Array) return JSON.parse(textDecoder.decode(value));
  if (value.buffer) return JSON.parse(textDecoder.decode(new Uint8Array(value.buffer)));
  return JSON.parse(String(value));
}

function readSkeletons(metadataJson: any): Skeleton[] {
  if (!metadataJson) return [];
  const nodes = (metadataJson.nodes ?? []).map((node: any) => new Node(node.name ?? node));
  const skeletonEntries = metadataJson.skeletons ?? [];
  const skeletons: Skeleton[] = [];
  for (const entry of skeletonEntries) {
    const edges: Array<[number, number]> = [];
    const symmetries: Array<[number, number]> = [];
    const typeCache = new Map<number, number>();

    for (const link of entry.links ?? []) {
      const source = link.source;
      const target = link.target;
      const edgeType = resolveEdgeType(link.type, typeCache);
      if (edgeType === 2) {
        symmetries.push([source, target]);
      } else {
        edges.push([source, target]);
      }
    }

    const skeleton = new Skeleton({
      nodes,
      edges: edges.map(([src, dst]) => [src, dst]),
      symmetries: symmetries.map(([a, b]) => [a, b]),
      name: entry.graph?.name ?? entry.name,
    });
    skeletons.push(skeleton);
  }
  return skeletons;
}

function resolveEdgeType(edgeType: any, cache: Map<number, number>): number {
  if (!edgeType) return 1;
  if (edgeType["py/tuple"]) {
    const typeId = edgeType["py/tuple"][0];
    cache.set(cache.size + 1, typeId);
    return typeId;
  }
  if (edgeType["py/reduce"]) {
    const typeId = edgeType["py/reduce"][1]?.["py/tuple"]?.[0] ?? 1;
    cache.set(cache.size + 1, typeId);
    return typeId;
  }
  if (edgeType["py/id"]) {
    return cache.get(edgeType["py/id"]) ?? 1;
  }
  return 1;
}

function readTracks(dataset: any): Track[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const tracks: Track[] = [];
  for (const entry of values) {
    let parsed = entry;
    if (typeof entry === "string") {
      try {
        parsed = JSON.parse(entry);
      } catch {
        parsed = entry;
      }
    }
    if (Array.isArray(parsed)) {
      tracks.push(new Track(String(parsed[1] ?? parsed[0])));
    } else if (parsed?.name) {
      tracks.push(new Track(String(parsed.name)));
    } else {
      tracks.push(new Track(String(parsed)));
    }
  }
  return tracks;
}

async function readVideos(dataset: any, labelsPath: string, openVideos: boolean, file: any): Promise<Video[]> {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const videos: Video[] = [];

  for (const entry of values) {
    if (!entry) continue;
    const parsed = typeof entry === "string" ? JSON.parse(entry) : JSON.parse(textDecoder.decode(entry));
    const backendMeta = parsed.backend ?? {};
    let filename = backendMeta.filename ?? parsed.filename ?? "";
    let datasetPath = backendMeta.dataset ?? null;
    let embedded = false;

    if (filename === ".") {
      embedded = true;
      filename = labelsPath;
    }

    let backend = null;
    if (openVideos) {
      backend = await createVideoBackend(filename, {
        dataset: datasetPath ?? undefined,
        embedded,
        frameNumbers: readFrameNumbers(file, datasetPath),
        format: backendMeta.format,
        channelOrder: backendMeta.channel_order,
        shape: backendMeta.shape,
        fps: backendMeta.fps,
      });
    }

    const sourceVideo = parsed.source_video ? new Video({ filename: parsed.source_video.filename ?? "" }) : null;

    videos.push(
      new Video({
        filename,
        backend,
        backendMetadata: backendMeta,
        sourceVideo,
        openBackend: openVideos,
      })
    );
  }

  return videos;
}

function readFrameNumbers(file: any, datasetPath: string | null): number[] {
  if (!datasetPath) return [];
  const groupPath = datasetPath.endsWith("/video") ? datasetPath.slice(0, -6) : datasetPath;
  const frameDataset = file.get(`${groupPath}/frame_numbers`);
  if (!frameDataset) return [];
  const values = frameDataset.value ?? [];
  return Array.from(values).map((v: any) => Number(v));
}

function readSuggestions(dataset: any, videos: Video[]): SuggestionFrame[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const suggestions: SuggestionFrame[] = [];
  for (const entry of values) {
    const parsed = typeof entry === "string" ? JSON.parse(entry) : JSON.parse(textDecoder.decode(entry));
    const videoIndex = Number(parsed.video ?? 0);
    const video = videos[videoIndex];
    if (!video) continue;
    suggestions.push(new SuggestionFrame({ video, frameIdx: parsed.frame_idx ?? parsed.frameIdx ?? 0, metadata: parsed }));
  }
  return suggestions;
}

function readSessions(dataset: any, videos: Video[], skeletons: Skeleton[], labeledFrames: LabeledFrame[]): RecordingSession[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const sessions: RecordingSession[] = [];
  for (const entry of values) {
    const parsed = typeof entry === "string" ? JSON.parse(entry) : JSON.parse(textDecoder.decode(entry));
    const cameraGroup = new CameraGroup();
    const cameraMap = new Map<string, Camera>();
    const calibration = asRecord(parsed.calibration);
    for (const [key, data] of Object.entries(calibration)) {
      if (key === "metadata") continue;
      const cameraData = asRecord(data);
      const camera = new Camera({
        name: (cameraData.name as string | undefined) ?? key,
        rvec: (cameraData.rotation as number[] | undefined) ?? [0, 0, 0],
        tvec: (cameraData.translation as number[] | undefined) ?? [0, 0, 0],
        matrix: cameraData.matrix as number[][] | undefined,
        distortions: cameraData.distortions as number[] | undefined,
      });
      cameraGroup.cameras.push(camera);
      cameraMap.set(String(key), camera);
    }

    const session = new RecordingSession({ cameraGroup, metadata: (parsed.metadata as Record<string, unknown> | undefined) ?? {} });
    const map = asRecord(parsed.camcorder_to_video_idx_map);
    for (const [cameraKey, videoIdx] of Object.entries(map)) {
      const camera = cameraMap.get(cameraKey);
      const video = videos[Number(videoIdx)];
      if (camera && video) {
        session.addVideo(video, camera);
      }
    }

    const frameGroups = Array.isArray(parsed.frame_group_dicts) ? parsed.frame_group_dicts : [];
    for (const group of frameGroups) {
      const groupRecord = asRecord(group);
      const frameIdx = (groupRecord.frame_idx as number | undefined) ?? (groupRecord.frameIdx as number | undefined) ?? 0;
      const instanceGroups: InstanceGroup[] = [];
      const instanceGroupList = Array.isArray(groupRecord.instance_groups) ? groupRecord.instance_groups : [];
      for (const instanceGroup of instanceGroupList) {
        const instanceGroupRecord = asRecord(instanceGroup);
        const instanceByCamera = new Map<Camera, Instance>();
        const instancesRecord = asRecord(instanceGroupRecord.instances);
        for (const [cameraKey, points] of Object.entries(instancesRecord)) {
          const camera = cameraMap.get(cameraKey);
          if (!camera) continue;
          const skeleton = skeletons[0] ?? new Skeleton({ nodes: [] });
          instanceByCamera.set(camera, new Instance({ points: points as Record<string, number[]>, skeleton }));
        }
        const rawPoints = instanceGroupRecord.points;
        const pointsValue = Array.isArray(rawPoints) ? (rawPoints as number[][]) : undefined;
        instanceGroups.push(
          new InstanceGroup({
            instanceByCamera,
            score: instanceGroupRecord.score as number | undefined,
            points: pointsValue,
            metadata: (instanceGroupRecord.metadata as Record<string, unknown> | undefined) ?? {},
          })
        );
      }

      const labeledFrameByCamera = new Map<Camera, LabeledFrame>();
      const labeledFrameMap = asRecord(groupRecord.labeled_frame_by_camera);
      for (const [cameraKey, labeledFrameIdx] of Object.entries(labeledFrameMap)) {
        const camera = cameraMap.get(cameraKey);
        const labeledFrame = labeledFrames[Number(labeledFrameIdx)];
        if (camera && labeledFrame) {
          labeledFrameByCamera.set(camera, labeledFrame);
        }
      }

      session.frameGroups.set(
        Number(frameIdx),
        new FrameGroup({
          frameIdx: Number(frameIdx),
          instanceGroups,
          labeledFrameByCamera,
          metadata: (groupRecord.metadata as Record<string, unknown> | undefined) ?? {},
        })
      );
    }
    sessions.push(session);
  }
  return sessions;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}


function normalizeStructDataset(dataset: any): Record<string, any[]> {
  if (!dataset) return {};
  const raw = dataset.value;
  if (!raw) return {};

  const fieldNames = getFieldNames(dataset);

  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return mapStructuredRows(raw, fieldNames);
  }

  if (raw && ArrayBuffer.isView(raw) && Array.isArray(dataset.shape) && dataset.shape.length === 2) {
    const [rowCount, colCount] = dataset.shape as [number, number];
    const rows: any[][] = [];
    for (let i = 0; i < rowCount; i += 1) {
      const start = i * colCount;
      const end = start + colCount;
      const slice = Array.from((raw as any).slice(start, end));
      rows.push(slice);
    }
    return mapStructuredRows(rows, fieldNames);
  }

  if (raw && typeof raw === "object") {
    return raw;
  }

  return {};
}

function mapStructuredRows(rows: any[][], fieldNames: string[]): Record<string, any[]> {
  if (!fieldNames.length) {
    return rows.reduce((acc: Record<string, any[]>, row: any[], idx) => {
      acc[String(idx)] = row;
      return acc;
    }, {});
  }
  const data: Record<string, any[]> = {};
  fieldNames.forEach((field, idx) => {
    data[field] = rows.map((row) => row[idx]);
  });
  return data;
}

function getFieldNames(dataset: any): string[] {
  const fields = dataset.dtype?.fields ? Object.keys(dataset.dtype.fields) : [];
  if (fields.length) return fields;
  const compoundMembers = dataset.metadata?.compound_type?.members;
  if (Array.isArray(compoundMembers) && compoundMembers.length) {
    const names = compoundMembers.map((member: { name?: string }) => member.name).filter((name: string | undefined): name is string => !!name);
    if (names.length) return names;
  }
  const attr = dataset.attrs?.field_names ?? dataset.attrs?.fieldNames;
  if (!attr) return [];
  const value = attr.value ?? attr;
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      return value.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
  }
  if (value instanceof Uint8Array) {
    try {
      const parsed = JSON.parse(textDecoder.decode(value));
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      return [];
    }
  }
  return [];
}

function buildLabeledFrames(options: {
  framesData: Record<string, any[]>;
  instancesData: Record<string, any[]>;
  pointsData: Record<string, any[]>;
  predPointsData: Record<string, any[]>;
  skeletons: Skeleton[];
  tracks: Track[];
  videos: Video[];
  formatId: number;
}): LabeledFrame[] {
  const frames: LabeledFrame[] = [];
  const { framesData, instancesData, pointsData, predPointsData, skeletons, tracks, videos, formatId } = options;
  const frameIds = framesData.frame_id ?? [];
  const videoIdToIndex = buildVideoIdMap(framesData, videos);
  const instanceById = new Map<number, Instance | PredictedInstance>();
  const fromPredictedPairs: Array<[number, number]> = [];

  for (let frameIdx = 0; frameIdx < frameIds.length; frameIdx += 1) {
    const rawVideoId = Number(framesData.video?.[frameIdx] ?? 0);
    const videoIndex = videoIdToIndex.get(rawVideoId) ?? rawVideoId;
    const frameIndex = Number(framesData.frame_idx?.[frameIdx] ?? 0);
    const instStart = Number(framesData.instance_id_start?.[frameIdx] ?? 0);
    const instEnd = Number(framesData.instance_id_end?.[frameIdx] ?? 0);
    const video = videos[videoIndex];
    if (!video) continue;

    const instances: Array<Instance | PredictedInstance> = [];
    for (let instIdx = instStart; instIdx < instEnd; instIdx += 1) {
      const instanceType = Number(instancesData.instance_type?.[instIdx] ?? 0);
      const skeletonId = Number(instancesData.skeleton?.[instIdx] ?? 0);
      const trackId = Number(instancesData.track?.[instIdx] ?? -1);
      const pointStart = Number(instancesData.point_id_start?.[instIdx] ?? 0);
      const pointEnd = Number(instancesData.point_id_end?.[instIdx] ?? 0);
      const score = Number(instancesData.score?.[instIdx] ?? 0);
      const trackingScore = Number(instancesData.tracking_score?.[instIdx] ?? 0);
      const fromPredicted = Number(instancesData.from_predicted?.[instIdx] ?? -1);
      const skeleton = skeletons[skeletonId] ?? skeletons[0];
      const track = trackId >= 0 ? tracks[trackId] : null;

      let instance: Instance | PredictedInstance;
      if (instanceType === 0) {
        const points = slicePoints(pointsData, pointStart, pointEnd);
        instance = new Instance({ points: pointsFromArray(points, skeleton.nodeNames), skeleton, track, trackingScore });
        if (formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
        if (fromPredicted >= 0) {
          fromPredictedPairs.push([instIdx, fromPredicted]);
        }
      } else {
        const points = slicePoints(predPointsData, pointStart, pointEnd, true);
        instance = new PredictedInstance({ points: predictedPointsFromArray(points, skeleton.nodeNames), skeleton, track, score, trackingScore });
        if (formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
      }

      instanceById.set(instIdx, instance);
      instances.push(instance);
    }

    frames.push(new LabeledFrame({ video, frameIdx: frameIndex, instances }));
  }

  for (const [instanceId, fromPredictedId] of fromPredictedPairs) {
    const instance = instanceById.get(instanceId);
    const predicted = instanceById.get(fromPredictedId);
    if (instance && predicted instanceof PredictedInstance && instance instanceof Instance) {
      instance.fromPredicted = predicted;
    }
  }

  return frames;
}

function buildVideoIdMap(framesData: Record<string, any[]>, videos: Video[]): Map<number, number> {
  const videoIds = new Set<number>();
  for (const value of framesData.video ?? []) {
    videoIds.add(Number(value));
  }
  if (!videoIds.size) return new Map();

  const maxId = Math.max(...Array.from(videoIds));
  if (videoIds.size === videos.length && maxId === videos.length - 1) {
    const identity = new Map<number, number>();
    for (let i = 0; i < videos.length; i += 1) {
      identity.set(i, i);
    }
    return identity;
  }

  const map = new Map<number, number>();
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const dataset = (video.backend?.dataset ?? (video.backendMetadata?.dataset as string | undefined)) ?? "";
    const parsedId = parseVideoIdFromDataset(dataset);
    if (parsedId != null) {
      map.set(parsedId, index);
    }
  }
  return map;
}

function parseVideoIdFromDataset(dataset: string): number | null {
  if (!dataset) return null;
  const group = dataset.split("/")[0];
  if (!group.startsWith("video")) return null;
  const id = Number(group.slice(5));
  return Number.isNaN(id) ? null : id;
}

function slicePoints(data: Record<string, any[]>, start: number, end: number, predicted = false): number[][] {
  const xs = data.x ?? [];
  const ys = data.y ?? [];
  const visible = data.visible ?? [];
  const complete = data.complete ?? [];
  const scores = data.score ?? [];
  const points: number[][] = [];
  for (let i = start; i < end; i += 1) {
    if (predicted) {
      points.push([xs[i], ys[i], scores[i], visible[i], complete[i]]);
    } else {
      points.push([xs[i], ys[i], visible[i], complete[i]]);
    }
  }
  return points;
}
