import { Labels } from "../model/labels.js";
import { LabeledFrame } from "../model/labeled-frame.js";
import { PredictedInstance, Track, predictedPointsFromArray } from "../model/instance.js";
import { Skeleton } from "../model/skeleton.js";
import { Video } from "../model/video.js";

export function toNumpy(labels: Labels, options?: { returnConfidence?: boolean; video?: Video }): number[][][][] {
  return labels.numpy({ returnConfidence: options?.returnConfidence, video: options?.video });
}

export function fromNumpy(
  data: number[][][][],
  options: {
    video?: Video;
    videos?: Video[];
    skeleton?: Skeleton;
    skeletons?: Skeleton[] | Skeleton;
    returnConfidence?: boolean;
    trackNames?: string[];
    firstFrame?: number;
  }
): Labels {
  if (data.length === 0 || data[0].length === undefined) {
    throw new Error("Input array must have 4 dimensions.");
  }
  const video = options.video ?? options.videos?.[0];
  if (!video) throw new Error("fromNumpy requires a video.");
  if (options.video && options.videos) {
    throw new Error("Cannot specify both video and videos.");
  }

  const skeleton = resolveSkeleton(options);
  const labels = labelsFromNumpy(data, {
    video,
    skeleton,
    trackNames: options.trackNames,
    firstFrame: options.firstFrame,
    returnConfidence: options.returnConfidence,
  });
  return labels;
}

export function labelsFromNumpy(
  data: number[][][][],
  options: {
    video: Video;
    skeleton: Skeleton;
    trackNames?: string[];
    firstFrame?: number;
    returnConfidence?: boolean;
  }
): Labels {
  const frameCount = data.length;
  if (!frameCount || data[0].length === undefined) {
    throw new Error("Input array must have 4 dimensions.");
  }
  const trackCount = data[0].length;
  const nodeCount = data[0][0]?.length ?? 0;
  if (!nodeCount) {
    throw new Error("Input array must have node dimension.");
  }

  const trackNames = options.trackNames ?? Array.from({ length: trackCount }, (_, idx) => `track${idx}`);
  const tracks = trackNames.map((name) => new Track(name));
  const labeledFrames: LabeledFrame[] = [];
  const startFrame = options.firstFrame ?? 0;

  for (let frameIdx = 0; frameIdx < frameCount; frameIdx += 1) {
    const instances: PredictedInstance[] = [];
    for (let trackIdx = 0; trackIdx < trackCount; trackIdx += 1) {
      const points = data[frameIdx][trackIdx];
      if (!points) continue;
      const hasData = points.some((point) => point.some((value) => !Number.isNaN(value)));
      if (!hasData) continue;

      const arrayPoints = points.map((point) => {
        if (options.returnConfidence) {
          return [point[0], point[1], point[2] ?? Number.NaN, 1, 0];
        }
        return [point[0], point[1], 1, 0];
      });

      const instance = new PredictedInstance({
        points: predictedPointsFromArray(arrayPoints, options.skeleton.nodeNames),
        skeleton: options.skeleton,
        track: tracks[trackIdx],
      });
      instances.push(instance);
    }

    labeledFrames.push(new LabeledFrame({
      video: options.video,
      frameIdx: startFrame + frameIdx,
      instances,
    }));
  }

  return new Labels({
    labeledFrames,
    videos: [options.video],
    skeletons: [options.skeleton],
    tracks,
  });
}

function resolveSkeleton(options: { skeleton?: Skeleton; skeletons?: Skeleton[] | Skeleton }): Skeleton {
  if (options.skeleton) return options.skeleton;
  if (Array.isArray(options.skeletons) && options.skeletons.length) return options.skeletons[0];
  if (options.skeletons && !Array.isArray(options.skeletons)) return options.skeletons;
  throw new Error("fromNumpy requires a skeleton.");
}
