import { LabeledFrame } from "./labeled-frame.js";
import { Instance, PredictedInstance, Track } from "./instance.js";
import { Skeleton } from "./skeleton.js";
import { SuggestionFrame } from "./suggestions.js";
import { Video } from "./video.js";
import { RecordingSession } from "./camera.js";
import { toDict } from "../codecs/dictionary.js";
import { labelsFromNumpy } from "../codecs/numpy.js";
import type { LazyDataStore, LazyFrameList } from "./lazy.js";

export class Labels {
  labeledFrames: LabeledFrame[];
  videos: Video[];
  skeletons: Skeleton[];
  tracks: Track[];
  suggestions: SuggestionFrame[];
  sessions: RecordingSession[];
  provenance: Record<string, unknown>;

  /** @internal Lazy frame list for on-demand materialization. */
  _lazyFrameList: LazyFrameList | null = null;
  /** @internal Lazy data store holding raw HDF5 data. */
  _lazyDataStore: LazyDataStore | null = null;

  constructor(options?: {
    labeledFrames?: LabeledFrame[];
    videos?: Video[];
    skeletons?: Skeleton[];
    tracks?: Track[];
    suggestions?: SuggestionFrame[];
    sessions?: RecordingSession[];
    provenance?: Record<string, unknown>;
  }) {
    this.labeledFrames = options?.labeledFrames ?? [];
    this.videos = options?.videos ?? [];
    this.skeletons = options?.skeletons ?? [];
    this.tracks = options?.tracks ?? [];
    this.suggestions = options?.suggestions ?? [];
    this.sessions = options?.sessions ?? [];
    this.provenance = options?.provenance ?? {};

    if (!this.videos.length && this.labeledFrames.length) {
      const uniqueVideos = new Map<string | Video, Video>();
      for (const frame of this.labeledFrames) {
        uniqueVideos.set(frame.video, frame.video);
      }
      this.videos = Array.from(uniqueVideos.values());
    }

    if (!this.skeletons.length && this.labeledFrames.length) {
      const uniqueSkeletons = new Map<Skeleton, Skeleton>();
      for (const frame of this.labeledFrames) {
        for (const instance of frame.instances) {
          uniqueSkeletons.set(instance.skeleton, instance.skeleton);
        }
      }
      this.skeletons = Array.from(uniqueSkeletons.values());
    }

    if (!this.tracks.length && this.labeledFrames.length) {
      const uniqueTracks = new Map<Track, Track>();
      for (const frame of this.labeledFrames) {
        for (const instance of frame.instances) {
          if (instance.track) uniqueTracks.set(instance.track, instance.track);
        }
      }
      this.tracks = Array.from(uniqueTracks.values());
    }
  }

  /** Whether this Labels instance is in lazy mode. */
  get isLazy(): boolean {
    return this._lazyFrameList !== null;
  }

  /**
   * Materialize all lazy frames, converting to eager mode.
   * No-op if already eager.
   */
  materialize(): void {
    if (!this._lazyFrameList) return;
    this.labeledFrames = this._lazyFrameList.toArray();
    this._lazyFrameList = null;
    this._lazyDataStore = null;
  }

  get negativeFrames(): LabeledFrame[] {
    if (this._lazyFrameList) this.materialize();
    return this.labeledFrames.filter((f) => f.isNegative);
  }

  get video(): Video {
    if (!this.videos.length) {
      throw new Error("No videos available on Labels.");
    }
    return this.videos[0];
  }

  get length(): number {
    if (this._lazyFrameList) return this._lazyFrameList.length;
    return this.labeledFrames.length;
  }

  [Symbol.iterator](): Iterator<LabeledFrame> {
    if (this._lazyFrameList) return this._lazyFrameList[Symbol.iterator]();
    return this.labeledFrames[Symbol.iterator]();
  }

  get instances(): Array<Instance | PredictedInstance> {
    if (this._lazyFrameList) this.materialize();
    return this.labeledFrames.flatMap((frame) => frame.instances);
  }

  find(options: { video?: Video; frameIdx?: number }): LabeledFrame[] {
    if (this._lazyFrameList) this.materialize();
    return this.labeledFrames.filter((frame) => {
      if (options.video && frame.video !== options.video) {
        return false;
      }
      if (options.frameIdx !== undefined && frame.frameIdx !== options.frameIdx) {
        return false;
      }
      return true;
    });
  }

  append(frame: LabeledFrame): void {
    if (this._lazyFrameList) this.materialize();
    this.labeledFrames.push(frame);
    if (!this.videos.includes(frame.video)) {
      this.videos.push(frame.video);
    }
  }

  toDict(options?: { video?: Video | number; skipEmptyFrames?: boolean }) {
    if (this._lazyFrameList) this.materialize();
    return toDict(this, options);
  }

  static fromNumpy(
    data: number[][][][],
    options: { videos?: Video[]; video?: Video; skeletons?: Skeleton[] | Skeleton; skeleton?: Skeleton; trackNames?: string[]; firstFrame?: number; returnConfidence?: boolean }
  ): Labels {
    const video = options.video ?? options.videos?.[0];
    if (!video) throw new Error("fromNumpy requires a video.");
    if (options.video && options.videos) {
      throw new Error("Cannot specify both video and videos.");
    }
    const skeletons = Array.isArray(options.skeletons) ? options.skeletons : options.skeletons ? [options.skeletons] : options.skeleton ? [options.skeleton] : [];
    if (!skeletons.length) throw new Error("fromNumpy requires a skeleton.");
    return labelsFromNumpy(data, {
      video,
      skeleton: skeletons[0],
      trackNames: options.trackNames,
      firstFrame: options.firstFrame,
      returnConfidence: options.returnConfidence,
    });
  }

  numpy(options?: { video?: Video; returnConfidence?: boolean }): number[][][][] {
    if (this._lazyDataStore) {
      return this._lazyDataStore.toNumpy(options);
    }
    const targetVideo = options?.video ?? this.video;
    const frames = this.labeledFrames.filter((frame) => frame.video.matchesPath(targetVideo, true));
    if (!frames.length) return [];

    const maxFrame = Math.max(...frames.map((frame) => frame.frameIdx));
    const tracks = this.tracks.length ? this.tracks.length : Math.max(1, ...frames.map((frame) => frame.instances.length));
    const nodes = this.skeletons[0]?.nodes.length ?? 0;
    const channelCount = options?.returnConfidence ? 3 : 2;

    const videoArray: number[][][][] = Array.from({ length: maxFrame + 1 }, () =>
      Array.from({ length: tracks }, () =>
        Array.from({ length: nodes }, () => Array.from({ length: channelCount }, () => Number.NaN))
      )
    );

    for (const frame of frames) {
      const frameSlot = videoArray[frame.frameIdx];
      if (!frameSlot) continue;
      frame.instances.forEach((inst, idx) => {
        const trackIndex = inst.track ? this.tracks.indexOf(inst.track) : idx;
        const resolvedTrack = trackIndex >= 0 ? trackIndex : idx;
        const trackSlot = frameSlot[resolvedTrack];
        if (!trackSlot) return;
        inst.points.forEach((point, nodeIdx) => {
          if (!trackSlot[nodeIdx]) return;
          const row = [point.xy[0], point.xy[1]];
          if (options?.returnConfidence) {
            const score = "score" in point ? (point as { score: number }).score : Number.NaN;
            row.push(score);
          }
          trackSlot[nodeIdx] = row;
        });
      });
    }

    return videoArray;
  }
}
