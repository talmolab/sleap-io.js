import { LabeledFrame } from "./labeled-frame.js";
import { Instance, PredictedInstance, Track, pointsFromArray, predictedPointsFromArray } from "./instance.js";
import { Skeleton } from "./skeleton.js";
import { Video } from "./video.js";

/**
 * Raw data store holding HDF5 dataset arrays for lazy materialization.
 * Keeps the parsed column data from frames/instances/points datasets
 * so individual frames can be materialized on demand.
 */
export class LazyDataStore {
  framesData: Record<string, any[]>;
  instancesData: Record<string, any[]>;
  pointsData: Record<string, any[]>;
  predPointsData: Record<string, any[]>;
  skeletons: Skeleton[];
  tracks: Track[];
  videos: Video[];
  formatId: number;
  negativeFrames: Set<string>;

  constructor(options: {
    framesData: Record<string, any[]>;
    instancesData: Record<string, any[]>;
    pointsData: Record<string, any[]>;
    predPointsData: Record<string, any[]>;
    skeletons: Skeleton[];
    tracks: Track[];
    videos: Video[];
    formatId: number;
    negativeFrames?: Set<string>;
  }) {
    this.framesData = options.framesData;
    this.instancesData = options.instancesData;
    this.pointsData = options.pointsData;
    this.predPointsData = options.predPointsData;
    this.skeletons = options.skeletons;
    this.tracks = options.tracks;
    this.videos = options.videos;
    this.formatId = options.formatId;
    this.negativeFrames = options.negativeFrames ?? new Set();
  }

  /** Total number of frames in the store. */
  get frameCount(): number {
    return (this.framesData.frame_id ?? []).length;
  }

  /**
   * Materialize a single LabeledFrame by index.
   */
  materializeFrame(frameIdx: number): LabeledFrame | null {
    const frameIds = this.framesData.frame_id ?? [];
    if (frameIdx < 0 || frameIdx >= frameIds.length) return null;

    const rawVideoId = Number(this.framesData.video?.[frameIdx] ?? 0);
    const videoIndex = rawVideoId;
    const frameIndex = Number(this.framesData.frame_idx?.[frameIdx] ?? 0);
    const instStart = Number(this.framesData.instance_id_start?.[frameIdx] ?? 0);
    const instEnd = Number(this.framesData.instance_id_end?.[frameIdx] ?? 0);
    const video = this.videos[videoIndex];
    if (!video) return null;

    const instances: Array<Instance | PredictedInstance> = [];
    const instanceById = new Map<number, Instance | PredictedInstance>();
    const fromPredictedPairs: Array<[number, number]> = [];

    for (let instIdx = instStart; instIdx < instEnd; instIdx++) {
      const instanceType = Number(this.instancesData.instance_type?.[instIdx] ?? 0);
      const skeletonId = Number(this.instancesData.skeleton?.[instIdx] ?? 0);
      const trackId = Number(this.instancesData.track?.[instIdx] ?? -1);
      const pointStart = Number(this.instancesData.point_id_start?.[instIdx] ?? 0);
      const pointEnd = Number(this.instancesData.point_id_end?.[instIdx] ?? 0);
      const score = Number(this.instancesData.score?.[instIdx] ?? 0);
      const rawTrackingScore = this.formatId < 1.2 ? 0 : Number(this.instancesData.tracking_score?.[instIdx] ?? 0);
      const trackingScore = Number.isNaN(rawTrackingScore) ? 0 : rawTrackingScore;
      const fromPredicted = Number(this.instancesData.from_predicted?.[instIdx] ?? -1);
      const skeleton = this.skeletons[skeletonId] ?? this.skeletons[0];
      const track = trackId >= 0 ? this.tracks[trackId] : null;

      let instance: Instance | PredictedInstance;
      if (instanceType === 0) {
        const points = this.slicePoints(this.pointsData, pointStart, pointEnd);
        instance = new Instance({ points: pointsFromArray(points, skeleton.nodeNames), skeleton, track, trackingScore });
        if (this.formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
        if (fromPredicted >= 0) {
          fromPredictedPairs.push([instIdx, fromPredicted]);
        }
      } else {
        const points = this.slicePoints(this.predPointsData, pointStart, pointEnd, true);
        instance = new PredictedInstance({ points: predictedPointsFromArray(points, skeleton.nodeNames), skeleton, track, score, trackingScore });
        if (this.formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
      }

      instanceById.set(instIdx, instance);
      instances.push(instance);
    }

    // Resolve from_predicted links
    for (const [instanceId, fromPredictedId] of fromPredictedPairs) {
      const instance = instanceById.get(instanceId);
      const predicted = instanceById.get(fromPredictedId);
      if (instance && predicted instanceof PredictedInstance && instance instanceof Instance) {
        instance.fromPredicted = predicted;
      }
    }

    const frame = new LabeledFrame({ video, frameIdx: frameIndex, instances });
    const negKey = `${videoIndex}:${frameIndex}`;
    if (this.negativeFrames.has(negKey)) {
      frame.isNegative = true;
    }
    return frame;
  }

  /**
   * Build a 4D numpy-like array directly from raw column data without
   * materializing any LabeledFrame or Instance objects.
   *
   * Returns [frames, tracks/instances, nodes, coords] where coords is
   * [x, y] or [x, y, score] when returnConfidence is true.
   */
  toNumpy(options?: { video?: Video; returnConfidence?: boolean }): number[][][][] {
    const targetVideo = options?.video ?? this.videos[0];
    if (!targetVideo) return [];

    const targetVideoIdx = this.videos.indexOf(targetVideo);
    if (targetVideoIdx < 0) return [];

    const frameIds = this.framesData.frame_id ?? [];
    const frameVideos = this.framesData.video ?? [];
    const frameIndices = this.framesData.frame_idx ?? [];
    const instStarts = this.framesData.instance_id_start ?? [];
    const instEnds = this.framesData.instance_id_end ?? [];

    // First pass: find max frame index and determine track count
    let maxFrameIdx = 0;
    const trackCount = this.tracks.length
      ? this.tracks.length
      : (() => {
          let maxInst = 1;
          for (let i = 0; i < frameIds.length; i++) {
            if (Number(frameVideos[i]) !== targetVideoIdx) continue;
            const count = Number(instEnds[i]) - Number(instStarts[i]);
            if (count > maxInst) maxInst = count;
          }
          return maxInst;
        })();

    // Collect matching frame indices
    const matchingFrames: number[] = [];
    for (let i = 0; i < frameIds.length; i++) {
      if (Number(frameVideos[i]) !== targetVideoIdx) continue;
      const fi = Number(frameIndices[i]);
      if (fi > maxFrameIdx) maxFrameIdx = fi;
      matchingFrames.push(i);
    }
    if (!matchingFrames.length) return [];

    const videoLength = targetVideo.shape?.[0] ?? 0;
    if (videoLength > 0) {
      maxFrameIdx = Math.max(maxFrameIdx, videoLength - 1);
    }

    const nodeCount = this.skeletons[0]?.nodes.length ?? 0;
    const channelCount = options?.returnConfidence ? 3 : 2;

    // Allocate NaN-filled output
    const output: number[][][][] = Array.from({ length: maxFrameIdx + 1 }, () =>
      Array.from({ length: trackCount }, () =>
        Array.from({ length: nodeCount }, () => Array.from({ length: channelCount }, () => Number.NaN))
      )
    );

    // Instance column data
    const instTypes = this.instancesData.instance_type ?? [];
    const instTracks = this.instancesData.track ?? [];
    const instPointStarts = this.instancesData.point_id_start ?? [];
    const instPointEnds = this.instancesData.point_id_end ?? [];
    const instScores = this.instancesData.score ?? [];

    // Point column data
    const px = this.pointsData.x ?? [];
    const py = this.pointsData.y ?? [];
    const ppx = this.predPointsData.x ?? [];
    const ppy = this.predPointsData.y ?? [];
    const ppScores = this.predPointsData.score ?? [];

    const coordOffset = this.formatId < 1.1 ? -0.5 : 0;

    for (const fi of matchingFrames) {
      const frameSlotIdx = Number(frameIndices[fi]);
      const frameSlot = output[frameSlotIdx];
      if (!frameSlot) continue;

      const iStart = Number(instStarts[fi]);
      const iEnd = Number(instEnds[fi]);
      let localIdx = 0;

      for (let instIdx = iStart; instIdx < iEnd; instIdx++) {
        const isPredicted = Number(instTypes[instIdx]) === 1;
        const trackId = Number(instTracks[instIdx]);
        const trackIndex = trackId >= 0 && this.tracks.length ? trackId : localIdx;
        localIdx++;

        const trackSlot = frameSlot[trackIndex];
        if (!trackSlot) continue;

        const pStart = Number(instPointStarts[instIdx]);
        const pEnd = Number(instPointEnds[instIdx]);
        const pointCount = Math.min(pEnd - pStart, nodeCount);

        if (isPredicted) {
          for (let p = 0; p < pointCount; p++) {
            const row = trackSlot[p];
            if (!row) continue;
            row[0] = Number(ppx[pStart + p]) + coordOffset;
            row[1] = Number(ppy[pStart + p]) + coordOffset;
            if (channelCount === 3) {
              row[2] = Number(ppScores[pStart + p] ?? Number.NaN);
            }
          }
        } else {
          for (let p = 0; p < pointCount; p++) {
            const row = trackSlot[p];
            if (!row) continue;
            row[0] = Number(px[pStart + p]) + coordOffset;
            row[1] = Number(py[pStart + p]) + coordOffset;
            if (channelCount === 3) {
              row[2] = Number.NaN;
            }
          }
        }
      }
    }

    return output;
  }

  /** Materialize all frames at once. */
  materializeAll(): LabeledFrame[] {
    const frames: LabeledFrame[] = [];
    for (let i = 0; i < this.frameCount; i++) {
      const frame = this.materializeFrame(i);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private slicePoints(data: Record<string, any[]>, start: number, end: number, predicted = false): number[][] {
    const xs = data.x ?? [];
    const ys = data.y ?? [];
    const visible = data.visible ?? [];
    const complete = data.complete ?? [];
    const scores = data.score ?? [];
    const points: number[][] = [];
    for (let i = start; i < end; i++) {
      if (predicted) {
        points.push([xs[i], ys[i], scores[i], visible[i], complete[i]]);
      } else {
        points.push([xs[i], ys[i], visible[i], complete[i]]);
      }
    }
    return points;
  }
}

/**
 * A lazy array-like container for LabeledFrames.
 * Frames are materialized from the LazyDataStore only when accessed.
 * Supports indexing, iteration, length, and conversion to a real array.
 */
export class LazyFrameList {
  private store: LazyDataStore;
  private cache: Map<number, LabeledFrame>;

  constructor(store: LazyDataStore) {
    this.store = store;
    this.cache = new Map();
  }

  get length(): number {
    return this.store.frameCount;
  }

  /** Get a frame by index, materializing it if needed. */
  at(index: number): LabeledFrame | undefined {
    if (index < 0 || index >= this.length) return undefined;
    if (this.cache.has(index)) return this.cache.get(index)!;
    const frame = this.store.materializeFrame(index);
    if (frame) {
      this.cache.set(index, frame);
    }
    return frame ?? undefined;
  }

  /** Materialize all frames and return as a regular array. */
  toArray(): LabeledFrame[] {
    const result: LabeledFrame[] = [];
    for (let i = 0; i < this.length; i++) {
      const frame = this.at(i);
      if (frame) result.push(frame);
    }
    return result;
  }

  /** Iterator support. Skips null frames instead of stopping early. */
  [Symbol.iterator](): Iterator<LabeledFrame> {
    let index = 0;
    const self = this;
    return {
      next(): IteratorResult<LabeledFrame> {
        while (index < self.length) {
          const frame = self.at(index++);
          if (frame) return { value: frame, done: false };
        }
        return { value: undefined as any, done: true };
      },
    };
  }

  /** Number of frames that have been materialized. */
  get materializedCount(): number {
    return this.cache.size;
  }
}
