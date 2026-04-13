import { LabeledFrame } from "./labeled-frame.js";
import { Instance, PredictedInstance, Track } from "./instance.js";
import { Skeleton, Node, Edge, Symmetry } from "./skeleton.js";
import { SuggestionFrame } from "./suggestions.js";
import { Video } from "./video.js";
import { RecordingSession } from "./camera.js";
import { Identity } from "./identity.js";
import { toDict } from "../codecs/dictionary.js";
import { labelsFromNumpy } from "../codecs/numpy.js";
import { LazyDataStore, LazyFrameList } from "./lazy.js";
import type { ROI } from "./roi.js";
import type { SegmentationMask } from "./mask.js";
import type { BoundingBox } from "./bbox.js";
import type { Centroid } from "./centroid.js";
import type { LabelImage } from "./label-image.js";

/** Shared shape for annotations that support deferred instance resolution. */
interface DeferredInstanceRef {
  _instanceIdx: number | null;
  instance: Instance | null;
}

export class Labels {
  labeledFrames: LabeledFrame[];
  videos: Video[];
  skeletons: Skeleton[];
  tracks: Track[];
  suggestions: SuggestionFrame[];
  sessions: RecordingSession[];
  provenance: Record<string, unknown>;
  identities: Identity[];

  // Static ROIs: not tied to any specific frame (e.g., arena boundaries).
  _staticRois: ROI[];

  /** @internal Lazy frame list for on-demand materialization. */
  _lazyFrameList: LazyFrameList | null = null;
  /** @internal Lazy data store holding raw HDF5 data. */
  _lazyDataStore: LazyDataStore | null = null;

  // Index caches (excluded from serialization, rebuilt on demand)
  private _frameIndex: Map<Video, Map<number, LabeledFrame>> | null = null;
  private _frameIndexLen: number = -1;
  private _trackIndex: Map<
    Video,
    Map<
      Track,
      Array<
        | Centroid
        | BoundingBox
        | SegmentationMask
        | ROI
        | LabelImage
        | Instance
        | PredictedInstance
      >
    >
  > | null = null;
  private _trackIndexLen: number = -1;

  constructor(options?: {
    labeledFrames?: LabeledFrame[];
    videos?: Video[];
    skeletons?: Skeleton[];
    tracks?: Track[];
    suggestions?: SuggestionFrame[];
    sessions?: RecordingSession[];
    provenance?: Record<string, unknown>;
    rois?: ROI[];
    identities?: Identity[];
  }) {
    this.labeledFrames = options?.labeledFrames ?? [];
    this.videos = options?.videos ?? [];
    this.skeletons = options?.skeletons ?? [];
    this.tracks = options?.tracks ?? [];
    this.suggestions = options?.suggestions ?? [];
    this.sessions = options?.sessions ?? [];
    this.provenance = options?.provenance ?? {};
    this._staticRois = options?.rois ?? [];
    this.identities = options?.identities ?? [];

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

    // Collect tracks from annotations already on frames
    if (!this._lazyFrameList) {
      for (const lf of this.labeledFrames) {
        this._collectAnnotationTracks(lf);
      }
    }
    // Collect tracks from static ROIs
    for (const roi of this._staticRois) {
      if (roi.track && !this.tracks.includes(roi.track)) {
        this.tracks.push(roi.track);
      }
    }
  }

  /** Collect tracks from annotations on a frame into this.tracks. */
  private _collectAnnotationTracks(lf: LabeledFrame): void {
    const existing = new Set(this.tracks);
    const add = (track: Track | null | undefined) => {
      if (track && !existing.has(track)) {
        existing.add(track);
        this.tracks.push(track);
      }
    };
    for (const c of lf.centroids) add(c.track);
    for (const b of lf.bboxes) add(b.track);
    for (const m of lf.masks) add(m.track);
    for (const r of lf.rois) add(r.track);
    for (const li of lf.labelImages) {
      for (const info of li.objects.values()) add(info.track);
    }
  }

  /** Raise if Labels is lazy-loaded. */
  private _checkNotLazy(operation: string): void {
    if (this.isLazy) {
      throw new Error(
        `Cannot ${operation} on lazy-loaded Labels.\n\n` +
          `To use, first materialize:\n` +
          `    labels.materialize();\n` +
          `    labels.${operation}(...);`,
      );
    }
  }

  /** Clear all cached indices so they rebuild on next access. */
  private _invalidateIndices(): void {
    this._frameIndex = null;
    this._frameIndexLen = -1;
    this._trackIndex = null;
    this._trackIndexLen = -1;
  }

  /** Build or return the frame index, rebuilding if stale. */
  private _ensureFrameIndex(): Map<Video, Map<number, LabeledFrame>> {
    if (this._lazyFrameList) this.materialize();
    const n = this.labeledFrames.length;
    if (this._frameIndex !== null && this._frameIndexLen === n) {
      return this._frameIndex;
    }
    this._frameIndex = new Map();
    for (const lf of this.labeledFrames) {
      let videoMap = this._frameIndex.get(lf.video);
      if (!videoMap) {
        videoMap = new Map();
        this._frameIndex.set(lf.video, videoMap);
      }
      if (videoMap.has(lf.frameIdx)) {
        console.warn(
          `Duplicate LabeledFrame for video=${lf.video}, frame_idx=${lf.frameIdx}. Using last occurrence.`,
        );
      }
      videoMap.set(lf.frameIdx, lf);
    }
    this._frameIndexLen = n;
    return this._frameIndex;
  }

  /** Build or return the track index, rebuilding if stale. */
  private _ensureTrackIndex(): Map<
    Video,
    Map<
      Track,
      Array<
        | Centroid
        | BoundingBox
        | SegmentationMask
        | ROI
        | LabelImage
        | Instance
        | PredictedInstance
      >
    >
  > {
    if (this._lazyFrameList) this.materialize();
    const n = this.labeledFrames.length;
    if (this._trackIndex !== null && this._trackIndexLen === n) {
      return this._trackIndex;
    }
    this._trackIndex = new Map();
    for (const lf of this.labeledFrames) {
      let videoMap = this._trackIndex.get(lf.video);
      if (!videoMap) {
        videoMap = new Map();
        this._trackIndex.set(lf.video, videoMap);
      }
      for (const ann of [
        ...lf.centroids,
        ...lf.bboxes,
        ...lf.masks,
        ...lf.rois,
        ...lf.instances,
      ]) {
        const track = (ann as { track?: Track | null }).track;
        if (track) {
          let list = videoMap.get(track);
          if (!list) {
            list = [];
            videoMap.set(track, list);
          }
          list.push(ann);
        }
      }
      for (const li of lf.labelImages) {
        for (const info of li.objects.values()) {
          if (info.track) {
            let list = videoMap.get(info.track);
            if (!list) {
              list = [];
              videoMap.set(info.track, list);
            }
            list.push(li);
          }
        }
      }
    }
    // Build annotation -> frameIdx map for sorting
    const annFrameIdx = new Map<unknown, number>();
    for (const lf of this.labeledFrames) {
      for (const ann of [
        ...lf.centroids, ...lf.bboxes, ...lf.masks, ...lf.rois,
        ...lf.instances,
      ]) {
        annFrameIdx.set(ann, lf.frameIdx);
      }
      for (const li of lf.labelImages) {
        annFrameIdx.set(li, lf.frameIdx);
      }
    }
    // Sort each list by frameIdx
    for (const videoMap of this._trackIndex.values()) {
      for (const list of videoMap.values()) {
        list.sort(
          (a, b) => (annFrameIdx.get(a) ?? 0) - (annFrameIdx.get(b) ?? 0),
        );
      }
    }
    this._trackIndexLen = n;
    return this._trackIndex;
  }

  /**
   * O(1) lookup of a LabeledFrame by video and frame index.
   *
   * The index is rebuilt lazily. If you mutate frames directly (e.g.,
   * `lf.frameIdx = newIdx`) without calling `reindex()`, the lookup may
   * return stale results.
   */
  getFrame(video: Video, frameIdx: number): LabeledFrame | null {
    this._checkNotLazy("getFrame");
    return this._ensureFrameIndex().get(video)?.get(frameIdx) ?? null;
  }

  /**
   * O(1) lookup of all annotations for a track in a video, sorted by frameIdx.
   *
   * The index is rebuilt lazily. If you mutate frames directly (e.g.,
   * `lf.frameIdx = newIdx`) without calling `reindex()`, the lookup may
   * return stale results.
   */
  getTrackAnnotations(
    video: Video,
    track: Track,
  ): Array<
    | Centroid
    | BoundingBox
    | SegmentationMask
    | ROI
    | LabelImage
    | Instance
    | PredictedInstance
  > {
    this._checkNotLazy("getTrackAnnotations");
    return this._ensureTrackIndex().get(video)?.get(track) ?? [];
  }

  /** Force rebuild of all indices on next access. */
  reindex(): void {
    this._invalidateIndices();
  }

  /** Remove all predicted instances and predicted annotations from all frames. */
  removePredictions(): void {
    if (this._lazyFrameList) this.materialize();
    for (const lf of this.labeledFrames) {
      lf.removePredictions();
    }
    this._invalidateIndices();
  }

  /** Flat view of all centroids across all frames. */
  get centroids(): Centroid[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._centroidByFrame;
      const undist = this._lazyDataStore._undistributedCentroids;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return this.labeledFrames.flatMap((lf) => lf.centroids);
  }

  /** Flat view of all bounding boxes across all frames. */
  get bboxes(): BoundingBox[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._bboxByFrame;
      const undist = this._lazyDataStore._undistributedBboxes;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return this.labeledFrames.flatMap((lf) => lf.bboxes);
  }

  /** Flat view of all segmentation masks across all frames. */
  get masks(): SegmentationMask[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._maskByFrame;
      const undist = this._lazyDataStore._undistributedMasks;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return this.labeledFrames.flatMap((lf) => lf.masks);
  }

  /** Flat view of all label images across all frames. */
  get labelImages(): LabelImage[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._labelImageByFrame;
      const undist = this._lazyDataStore._undistributedLabelImages;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return this.labeledFrames.flatMap((lf) => lf.labelImages);
  }

  /** Flat view of all ROIs across all frames and static ROIs. */
  get rois(): ROI[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._roiByFrame;
      const undist = this._lazyDataStore._undistributedRois;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return [
      ...this._staticRois,
      ...this.labeledFrames.flatMap((lf) => lf.rois),
    ];
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
    const store = this._lazyDataStore;
    this.labeledFrames = this._lazyFrameList.toArray();
    this._lazyFrameList = null;
    this._lazyDataStore = null;

    // Resolve deferred instance references on per-frame annotations
    const allInstances = this.labeledFrames.flatMap((f) => f.instances);
    for (const lf of this.labeledFrames) {
      for (const ann of [...lf.centroids, ...lf.bboxes, ...lf.masks, ...lf.rois] as DeferredInstanceRef[]) {
        if (ann._instanceIdx !== null && ann._instanceIdx >= 0 && ann._instanceIdx < allInstances.length) {
          ann.instance = allInstances[ann._instanceIdx];
          ann._instanceIdx = null;
        }
      }
      for (const li of lf.labelImages) {
        if (li._objectInstanceIdxs) {
          for (const [labelId, instIdx] of li._objectInstanceIdxs) {
            const obj = li.objects.get(labelId);
            if (obj && instIdx >= 0 && instIdx < allInstances.length) {
              obj.instance = allInstances[instIdx];
            }
          }
          li._objectInstanceIdxs = null;
        }
      }
    }

    // Keep undistributed ROIs as static ROIs
    if (store) {
      this._staticRois = store._undistributedRois;
    }
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
    // Fast path: O(1) lookup when both video and frameIdx are specified
    if (options.video !== undefined && options.frameIdx !== undefined) {
      const frame = this.getFrame(options.video, options.frameIdx);
      return frame ? [frame] : [];
    }
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

  addVideo(video: Video): void {
    if (!this.videos.includes(video)) {
      this.videos.push(video);
    }
  }

  append(frame: LabeledFrame): void {
    if (this._lazyFrameList) this.materialize();
    this.labeledFrames.push(frame);
    this._invalidateIndices();
    this.addVideo(frame.video);
    this._collectAnnotationTracks(frame);
  }

  toDict(options?: { video?: Video | number; skipEmptyFrames?: boolean }) {
    if (this._lazyFrameList) this.materialize();
    return toDict(this, options);
  }

  /** Static ROIs (not attached to any LabeledFrame). */
  get staticRois(): ROI[] {
    return [...this._staticRois];
  }

  /** Frame-bound ROIs (attached to LabeledFrames). */
  get temporalRois(): ROI[] {
    return this.labeledFrames.flatMap((lf) => lf.rois);
  }

  /**
   * Filter ROIs across the Labels object.
   *
   * Filtering rule (matches sibling getters like `getMasks`/`getBboxes`):
   *   - Frame-aware filters (`video` or `frameIdx`) walk only `labeledFrames`.
   *     Static ROIs are excluded from these results.
   *   - Otherwise (no filter, or only `category`/`track`/`instance`/`predicted`)
   *     the search runs over `this.rois` — the union of static + frame-bound.
   *
   * To access static ROIs directly, use `staticRois`. To access only frame-bound
   * ROIs across all frames, use `temporalRois`.
   */
  getRois(filters?: {
    video?: Video;
    frameIdx?: number;
    category?: string;
    track?: Track;
    instance?: Instance | PredictedInstance;
    predicted?: boolean;
  }): ROI[] {
    if (!filters) return [...this.rois];
    let results: ROI[];
    if (filters.video !== undefined && filters.frameIdx !== undefined) {
      const lf = this.getFrame(filters.video, filters.frameIdx);
      results = lf ? lf.rois : [];
    } else if (filters.video !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.video === filters.video) results.push(...lf.rois);
      }
    } else if (filters.frameIdx !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.frameIdx === filters.frameIdx) results.push(...lf.rois);
      }
    } else {
      results = this.rois;
    }
    if (filters.category !== undefined) {
      results = results.filter((r) => r.category === filters.category);
    }
    if (filters.track !== undefined) {
      results = results.filter((r) => r.track === filters.track);
    }
    if (filters.instance !== undefined) {
      results = results.filter((r) => r.instance === filters.instance);
    }
    if (filters.predicted !== undefined) {
      results = results.filter((r) => r.isPredicted === filters.predicted);
    }
    return results;
  }

  getMasks(filters?: {
    video?: Video;
    frameIdx?: number;
    category?: string;
    track?: Track;
    instance?: Instance | PredictedInstance;
    predicted?: boolean;
  }): SegmentationMask[] {
    if (!filters) return [...this.masks];
    let results: SegmentationMask[];
    if (filters.video !== undefined && filters.frameIdx !== undefined) {
      const lf = this.getFrame(filters.video, filters.frameIdx);
      results = lf ? lf.masks : [];
    } else if (filters.video !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.video === filters.video) results.push(...lf.masks);
      }
    } else if (filters.frameIdx !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.frameIdx === filters.frameIdx) results.push(...lf.masks);
      }
    } else {
      results = this.masks;
    }
    if (filters.category !== undefined) {
      results = results.filter((m) => m.category === filters.category);
    }
    if (filters.track !== undefined) {
      results = results.filter((m) => m.track === filters.track);
    }
    if (filters.instance !== undefined) {
      results = results.filter((m) => m.instance === filters.instance);
    }
    if (filters.predicted !== undefined) {
      results = results.filter((m) => m.isPredicted === filters.predicted);
    }
    return results;
  }

  getBboxes(filters?: {
    video?: Video;
    frameIdx?: number;
    category?: string;
    track?: Track;
    instance?: Instance;
    predicted?: boolean;
  }): BoundingBox[] {
    if (!filters) return [...this.bboxes];
    let results: BoundingBox[];
    if (filters.video !== undefined && filters.frameIdx !== undefined) {
      const lf = this.getFrame(filters.video, filters.frameIdx);
      results = lf ? lf.bboxes : [];
    } else if (filters.video !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.video === filters.video) results.push(...lf.bboxes);
      }
    } else if (filters.frameIdx !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.frameIdx === filters.frameIdx) results.push(...lf.bboxes);
      }
    } else {
      results = this.bboxes;
    }
    if (filters.category !== undefined) {
      results = results.filter((b) => b.category === filters.category);
    }
    if (filters.track !== undefined) {
      results = results.filter((b) => b.track === filters.track);
    }
    if (filters.instance !== undefined) {
      results = results.filter((b) => b.instance === filters.instance);
    }
    if (filters.predicted !== undefined) {
      results = results.filter((b) => b.isPredicted === filters.predicted);
    }
    return results;
  }

  getCentroids(filters?: {
    video?: Video;
    frameIdx?: number;
    category?: string;
    track?: Track;
    instance?: Instance | PredictedInstance;
    predicted?: boolean;
  }): Centroid[] {
    if (!filters) return [...this.centroids];
    let results: Centroid[];
    if (filters.video !== undefined && filters.frameIdx !== undefined) {
      const lf = this.getFrame(filters.video, filters.frameIdx);
      results = lf ? lf.centroids : [];
    } else if (filters.video !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.video === filters.video) results.push(...lf.centroids);
      }
    } else if (filters.frameIdx !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.frameIdx === filters.frameIdx) results.push(...lf.centroids);
      }
    } else {
      results = this.centroids;
    }
    if (filters.category !== undefined) {
      results = results.filter((c) => c.category === filters.category);
    }
    if (filters.track !== undefined) {
      results = results.filter((c) => c.track === filters.track);
    }
    if (filters.instance !== undefined) {
      results = results.filter((c) => c.instance === filters.instance);
    }
    if (filters.predicted !== undefined) {
      results = results.filter((c) => c.isPredicted === filters.predicted);
    }
    return results;
  }

  getLabelImages(filters?: {
    video?: Video;
    frameIdx?: number;
    track?: Track;
    category?: string;
    predicted?: boolean;
  }): LabelImage[] {
    if (!filters) return [...this.labelImages];
    let results: LabelImage[];
    if (filters.video !== undefined && filters.frameIdx !== undefined) {
      const lf = this.getFrame(filters.video, filters.frameIdx);
      results = lf ? lf.labelImages : [];
    } else if (filters.video !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.video === filters.video) results.push(...lf.labelImages);
      }
    } else if (filters.frameIdx !== undefined) {
      results = [];
      for (const lf of this.labeledFrames) {
        if (lf.frameIdx === filters.frameIdx) results.push(...lf.labelImages);
      }
    } else {
      results = this.labelImages;
    }
    if (filters.track !== undefined) {
      results = results.filter((li) =>
        Array.from(li.objects.values()).some((info) => info.track === filters.track),
      );
    }
    if (filters.category !== undefined) {
      results = results.filter((li) =>
        Array.from(li.objects.values()).some(
          (info) => info.category === filters.category,
        ),
      );
    }
    if (filters.predicted !== undefined) {
      results = results.filter((li) => li.isPredicted === filters.predicted);
    }
    return results;
  }

  /**
   * Replace videos and update all references across the Labels object.
   *
   * Provide either `oldVideos`/`newVideos` arrays or a `videoMap`.
   * If only `newVideos` is provided and its length matches `this.videos`,
   * the current videos are used as `oldVideos`.
   */
  replaceVideos(options: {
    oldVideos?: Video[];
    newVideos?: Video[];
    videoMap?: Map<Video, Video>;
  }): void {
    if (this._lazyFrameList) this.materialize();

    let { oldVideos, newVideos, videoMap } = options;

    if (!oldVideos && newVideos && newVideos.length === this.videos.length) {
      oldVideos = this.videos;
    }

    if (!videoMap) {
      if (!oldVideos || !newVideos) {
        throw new Error("Must provide oldVideos/newVideos or videoMap.");
      }
      videoMap = new Map<Video, Video>();
      for (let i = 0; i < oldVideos.length; i++) {
        videoMap.set(oldVideos[i], newVideos[i]);
      }
    }

    for (const frame of this.labeledFrames) {
      const mapped = videoMap.get(frame.video);
      if (mapped) frame.video = mapped;

      // Update ROIs that have video references
      for (const r of frame.rois) {
        if (r.video && videoMap.has(r.video)) r.video = videoMap.get(r.video)!;
      }
    }

    for (const suggestion of this.suggestions) {
      const mapped = videoMap.get(suggestion.video);
      if (mapped) suggestion.video = mapped;
    }

    // Update static ROIs
    for (const roi of this._staticRois) {
      if (roi.video && videoMap.has(roi.video)) roi.video = videoMap.get(roi.video)!;
    }

    this.videos = this.videos.map((v) => videoMap!.get(v) ?? v);

    // Frame index is keyed by video identity, so must be rebuilt
    this._invalidateIndices();
  }

  /**
   * Create a deep copy of this Labels object.
   *
   * @param options.openVideos - Controls video backend behavior in the copy:
   *   - `undefined` (default): Preserve each video's current `openBackend` setting.
   *   - `true`: Enable auto-opening for all videos.
   *   - `false`: Disable auto-opening and close any open backends.
   * @returns A new Labels with deep-copied data. Video backends (file handles)
   *   are not copied — they will be re-opened on demand if `openBackend` is true.
   */
  copy(options?: { openVideos?: boolean }): Labels {
    // 1. Clone videos (without backends — file handles can't be copied)
    const videoMap = new Map<Video, Video>();
    const newVideos = this.videos.map((v) => {
      const nv = new Video({
        filename: Array.isArray(v.filename) ? [...v.filename] : v.filename,
        backendMetadata: { ...v.backendMetadata },
        openBackend: v.openBackend,
        embedded: v.hasEmbeddedImages,
      });
      nv.shape = v.shape;
      nv.fps = v.fps;
      videoMap.set(v, nv);
      return nv;
    });

    // 2. Clone skeletons (rebuild from constructors so internal maps are correct)
    const skeletonMap = new Map<Skeleton, Skeleton>();
    const newSkeletons = this.skeletons.map((s) => {
      const nodeMap = new Map<Node, Node>();
      const newNodes = s.nodes.map((n) => {
        const nn = new Node(n.name);
        nodeMap.set(n, nn);
        return nn;
      });
      const newEdges = s.edges.map(
        (e) => new Edge(nodeMap.get(e.source)!, nodeMap.get(e.destination)!),
      );
      const newSymmetries = s.symmetries.map((sym) => {
        const nodes = [...sym.nodes];
        return new Symmetry([nodeMap.get(nodes[0])!, nodeMap.get(nodes[1])!]);
      });
      const ns = new Skeleton({ nodes: newNodes, edges: newEdges, symmetries: newSymmetries, name: s.name });
      skeletonMap.set(s, ns);
      return ns;
    });

    // 3. Clone tracks
    const trackMap = new Map<Track, Track>();
    const newTracks = this.tracks.map((t) => {
      const nt = new Track(t.name);
      trackMap.set(t, nt);
      return nt;
    });

    // Helper: clone an instance with remapped skeleton/track
    const cloneInstance = (inst: Instance | PredictedInstance): Instance | PredictedInstance => {
      const newPoints = inst.points.map((p) => ({
        ...p,
        xy: [...p.xy] as [number, number],
      }));
      const newSkeleton = skeletonMap.get(inst.skeleton) ?? inst.skeleton;
      const newTrack = inst.track ? (trackMap.get(inst.track) ?? inst.track) : null;
      if (inst instanceof PredictedInstance) {
        return new PredictedInstance({
          points: newPoints as any,
          skeleton: newSkeleton,
          track: newTrack,
          score: inst.score,
          trackingScore: inst.trackingScore,
        });
      }
      const ni = new Instance({
        points: newPoints,
        skeleton: newSkeleton,
        track: newTrack,
        trackingScore: inst.trackingScore,
      });
      // fromPredicted can't be fully remapped (would need global instance identity),
      // so we leave it null on the copy.
      return ni;
    };

    // Helper: clone ancillary items by stripping object refs, structuredClone, then remap
    const cloneAncillary = <T extends object>(items: T[]): T[] =>
      items.map((item) => {
        const saved: [string, any][] = [];
        for (const key of ["video", "track", "instance"] as const) {
          if (key in item && (item as any)[key] != null) {
            saved.push([key, (item as any)[key]]);
            (item as any)[key] = null;
          }
        }
        // For LabelImage: also strip track/instance refs inside objects Map
        let objectRefs: Map<number, [any, any]> | null = null;
        if ("objects" in item && (item as any).objects instanceof Map) {
          objectRefs = new Map();
          for (const [id, info] of (item as any).objects as Map<number, any>) {
            if (info.track || info.instance) {
              objectRefs.set(id, [info.track, info.instance]);
              info.track = null;
              info.instance = null;
            }
          }
        }

        const clone = structuredClone(item);
        Object.setPrototypeOf(clone, Object.getPrototypeOf(item));

        // Restore original
        for (const [key, val] of saved) (item as any)[key] = val;
        if (objectRefs) {
          for (const [id, [track, inst]] of objectRefs) {
            const info = (item as any).objects.get(id);
            if (info) { info.track = track; info.instance = inst; }
          }
        }

        // Remap refs on clone
        for (const [key, val] of saved) {
          if (key === "video") (clone as any).video = videoMap.get(val) ?? val;
          else if (key === "track") (clone as any).track = trackMap.get(val) ?? val;
          else if (key === "instance") (clone as any).instance = null;
        }
        if (objectRefs) {
          for (const [id, [track]] of objectRefs) {
            const info = (clone as any).objects.get(id);
            if (info) {
              info.track = track ? (trackMap.get(track) ?? track) : null;
              info.instance = null;
            }
          }
        }
        return clone;
      });

    let labelsCopy: Labels;

    if (this.isLazy) {
      // Lazy-aware copy: deep copy the store with independent arrays
      // Annotations are stored on the lazy store's per-frame dicts
      // and will be attached to frames when they are materialized.
      const newStore = this._lazyDataStore!.copy();
      newStore.videos = newVideos;
      newStore.skeletons = newSkeletons;
      newStore.tracks = newTracks;

      const newLazyFrames = new LazyFrameList(newStore);

      // Copy supplementary frames (annotation-only, non-lazy)
      if (this._lazyFrameList?._supplementary.length) {
        newLazyFrames._supplementary = this._lazyFrameList._supplementary.map((lf) => {
          return new LabeledFrame({
            video: videoMap.get(lf.video) ?? lf.video,
            frameIdx: lf.frameIdx,
            instances: lf.instances.map(cloneInstance),
            isNegative: lf.isNegative,
            centroids: cloneAncillary(lf.centroids) as Centroid[],
            bboxes: cloneAncillary(lf.bboxes) as BoundingBox[],
            masks: cloneAncillary(lf.masks) as SegmentationMask[],
            labelImages: cloneAncillary(lf.labelImages) as LabelImage[],
            rois: cloneAncillary(lf.rois) as ROI[],
          });
        });
      }

      labelsCopy = new Labels({
        videos: newVideos,
        skeletons: newSkeletons,
        tracks: newTracks,
        suggestions: this.suggestions.map((s) => {
          const newVideo = videoMap.get(s.video) ?? s.video;
          return new SuggestionFrame({
            video: newVideo,
            frameIdx: s.frameIdx,
            group: s.group,
            metadata: { ...s.metadata },
          });
        }),
        sessions: structuredClone(this.sessions),
        provenance: { ...this.provenance },
        identities: structuredClone(this.identities),
      });

      labelsCopy._lazyDataStore = newStore;
      labelsCopy._lazyFrameList = newLazyFrames;
    } else {
      // Eager deep copy: rebuild from constructors, including per-frame annotations
      const newFrames = this.labeledFrames.map((f) => {
        const newInstances = f.instances.map(cloneInstance);
        return new LabeledFrame({
          video: videoMap.get(f.video) ?? f.video,
          frameIdx: f.frameIdx,
          instances: newInstances,
          isNegative: f.isNegative,
          centroids: cloneAncillary(f.centroids) as Centroid[],
          bboxes: cloneAncillary(f.bboxes) as BoundingBox[],
          masks: cloneAncillary(f.masks) as SegmentationMask[],
          labelImages: cloneAncillary(f.labelImages) as LabelImage[],
          rois: cloneAncillary(f.rois) as ROI[],
        });
      });

      labelsCopy = new Labels({
        labeledFrames: newFrames,
        videos: newVideos,
        skeletons: newSkeletons,
        tracks: newTracks,
        suggestions: this.suggestions.map((s) => {
          const newVideo = videoMap.get(s.video) ?? s.video;
          return new SuggestionFrame({
            video: newVideo,
            frameIdx: s.frameIdx,
            group: s.group,
            metadata: { ...s.metadata },
          });
        }),
        sessions: structuredClone(this.sessions),
        provenance: { ...this.provenance },
        rois: cloneAncillary(this._staticRois),
        identities: structuredClone(this.identities),
      });
    }

    if (options?.openVideos !== undefined) {
      for (const video of labelsCopy.videos) {
        video.openBackend = options.openVideos;
        if (!options.openVideos) video.close();
      }
    }

    return labelsCopy;
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

    let maxFrame = Math.max(...frames.map((frame) => frame.frameIdx));
    const videoLength = targetVideo.shape?.[0] ?? 0;
    if (videoLength > 0) {
      maxFrame = Math.max(maxFrame, videoLength - 1);
    }
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
