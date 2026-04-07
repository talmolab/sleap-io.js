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

export class Labels {
  labeledFrames: LabeledFrame[];
  videos: Video[];
  skeletons: Skeleton[];
  tracks: Track[];
  suggestions: SuggestionFrame[];
  sessions: RecordingSession[];
  provenance: Record<string, unknown>;
  rois: ROI[];
  masks: SegmentationMask[];
  bboxes: BoundingBox[];
  centroids: Centroid[] = [];
  labelImages: LabelImage[];
  identities: Identity[];

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
    rois?: ROI[];
    masks?: SegmentationMask[];
    bboxes?: BoundingBox[];
    centroids?: Centroid[];
    labelImages?: LabelImage[];
    identities?: Identity[];
  }) {
    this.labeledFrames = options?.labeledFrames ?? [];
    this.videos = options?.videos ?? [];
    this.skeletons = options?.skeletons ?? [];
    this.tracks = options?.tracks ?? [];
    this.suggestions = options?.suggestions ?? [];
    this.sessions = options?.sessions ?? [];
    this.provenance = options?.provenance ?? {};
    this.rois = options?.rois ?? [];
    this.masks = options?.masks ?? [];
    this.bboxes = options?.bboxes ?? [];
    this.centroids = options?.centroids ?? [];
    this.labelImages = options?.labelImages ?? [];
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

    // Resolve deferred ROI instance references
    const allInstances = this.labeledFrames.flatMap((f) => f.instances);
    for (const roi of this.rois) {
      if (roi._instanceIdx !== null && roi._instanceIdx >= 0 && roi._instanceIdx < allInstances.length) {
        roi.instance = allInstances[roi._instanceIdx];
        roi._instanceIdx = null;
      }
    }

    // Resolve bbox instance references
    for (const bbox of this.bboxes) {
      if (bbox._instanceIdx !== null && bbox._instanceIdx >= 0 && bbox._instanceIdx < allInstances.length) {
        bbox.instance = allInstances[bbox._instanceIdx];
        bbox._instanceIdx = null;
      }
    }

    // Resolve mask instance references
    for (const mask of this.masks) {
      if (mask._instanceIdx !== null && mask._instanceIdx >= 0 && mask._instanceIdx < allInstances.length) {
        mask.instance = allInstances[mask._instanceIdx];
        mask._instanceIdx = null;
      }
    }

    // Resolve centroid instance references
    for (const centroid of this.centroids) {
      if (centroid._instanceIdx !== null && centroid._instanceIdx >= 0 && centroid._instanceIdx < allInstances.length) {
        centroid.instance = allInstances[centroid._instanceIdx];
        centroid._instanceIdx = null;
      }
    }

    // Resolve label image object instance references
    for (const li of this.labelImages) {
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

  addVideo(video: Video): void {
    if (!this.videos.includes(video)) {
      this.videos.push(video);
    }
  }

  append(frame: LabeledFrame): void {
    if (this._lazyFrameList) this.materialize();
    this.labeledFrames.push(frame);
    this.addVideo(frame.video);
  }

  toDict(options?: { video?: Video | number; skipEmptyFrames?: boolean }) {
    if (this._lazyFrameList) this.materialize();
    return toDict(this, options);
  }

  get staticRois(): ROI[] {
    return this.rois.filter((roi) => roi.isStatic);
  }

  get temporalRois(): ROI[] {
    return this.rois.filter((roi) => !roi.isStatic);
  }

  getRois(filters?: {
    video?: Video;
    frameIdx?: number;
    category?: string;
    track?: Track;
    instance?: Instance | PredictedInstance;
    predicted?: boolean;
  }): ROI[] {
    if (!filters) return [...this.rois];
    let results = this.rois;
    if (filters.video !== undefined) {
      results = results.filter((r) => r.video === filters.video);
    }
    if (filters.frameIdx !== undefined) {
      results = results.filter((r) => r.frameIdx === filters.frameIdx);
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
    let results = this.masks;
    if (filters.video !== undefined) {
      results = results.filter((m) => m.video === filters.video);
    }
    if (filters.frameIdx !== undefined) {
      results = results.filter((m) => m.frameIdx === filters.frameIdx);
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

  get staticBboxes(): BoundingBox[] {
    return this.bboxes.filter((b) => b.isStatic);
  }

  get temporalBboxes(): BoundingBox[] {
    return this.bboxes.filter((b) => !b.isStatic);
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
    let results = this.bboxes;
    if (filters.video !== undefined) {
      results = results.filter((b) => b.video === filters.video);
    }
    if (filters.frameIdx !== undefined) {
      results = results.filter((b) => b.frameIdx === filters.frameIdx);
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
    let results = this.centroids;
    if (filters.video !== undefined) {
      results = results.filter((c) => c.video === filters.video);
    }
    if (filters.frameIdx !== undefined) {
      results = results.filter((c) => c.frameIdx === filters.frameIdx);
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

  get staticLabelImages(): LabelImage[] {
    return this.labelImages.filter((li) => li.isStatic);
  }

  get temporalLabelImages(): LabelImage[] {
    return this.labelImages.filter((li) => !li.isStatic);
  }

  getLabelImages(filters?: {
    video?: Video;
    frameIdx?: number;
    track?: Track;
    category?: string;
    predicted?: boolean;
  }): LabelImage[] {
    if (!filters) return [...this.labelImages];
    let results = this.labelImages;
    if (filters.video !== undefined) {
      results = results.filter((li) => li.video === filters.video);
    }
    if (filters.frameIdx !== undefined) {
      results = results.filter((li) => li.frameIdx === filters.frameIdx);
    }
    if (filters.track !== undefined) {
      results = results.filter((li) =>
        Array.from(li.objects.values()).some((info) => info.track === filters.track)
      );
    }
    if (filters.category !== undefined) {
      results = results.filter((li) =>
        Array.from(li.objects.values()).some((info) => info.category === filters.category)
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
    }

    for (const suggestion of this.suggestions) {
      const mapped = videoMap.get(suggestion.video);
      if (mapped) suggestion.video = mapped;
    }

    for (const roi of this.rois) {
      if (roi.video && videoMap.has(roi.video)) {
        roi.video = videoMap.get(roi.video)!;
      }
    }

    for (const mask of this.masks) {
      if (mask.video && videoMap.has(mask.video)) {
        mask.video = videoMap.get(mask.video)!;
      }
    }

    for (const bbox of this.bboxes) {
      if (bbox.video && videoMap.has(bbox.video)) {
        bbox.video = videoMap.get(bbox.video)!;
      }
    }

    for (const centroid of this.centroids) {
      if (centroid.video && videoMap.has(centroid.video)) {
        centroid.video = videoMap.get(centroid.video)!;
      }
    }

    for (const labelImage of this.labelImages) {
      if (labelImage.video && videoMap.has(labelImage.video)) {
        labelImage.video = videoMap.get(labelImage.video)!;
      }
    }

    this.videos = this.videos.map((v) => videoMap!.get(v) ?? v);
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
      const newStore = this._lazyDataStore!.copy();
      newStore.videos = newVideos;
      newStore.skeletons = newSkeletons;
      newStore.tracks = newTracks;

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
        rois: cloneAncillary(this.rois),
        masks: cloneAncillary(this.masks),
        bboxes: cloneAncillary(this.bboxes),
        centroids: cloneAncillary(this.centroids),
        labelImages: cloneAncillary(this.labelImages),
        identities: structuredClone(this.identities),
      });

      labelsCopy._lazyDataStore = newStore;
      labelsCopy._lazyFrameList = new LazyFrameList(newStore);
    } else {
      // Eager deep copy: rebuild from constructors
      const newFrames = this.labeledFrames.map((f) => {
        const newInstances = f.instances.map(cloneInstance);
        return new LabeledFrame({
          video: videoMap.get(f.video) ?? f.video,
          frameIdx: f.frameIdx,
          instances: newInstances,
          isNegative: f.isNegative,
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
        rois: cloneAncillary(this.rois),
        masks: cloneAncillary(this.masks),
        bboxes: cloneAncillary(this.bboxes),
        centroids: cloneAncillary(this.centroids),
        labelImages: cloneAncillary(this.labelImages),
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
