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
  identities: Identity[];

  // Annotation fields: accepted as constructor kwargs, distributed into
  // LabeledFrames at init time. Undistributed annotations (video=null or
  // frameIdx=null) are kept here. Access via property getters.
  _initRois: ROI[];
  _initMasks: SegmentationMask[];
  _initBboxes: BoundingBox[];
  _initCentroids: Centroid[];
  _initLabelImages: LabelImage[];

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
    this._initRois = options?.rois ?? [];
    this._initMasks = options?.masks ?? [];
    this._initBboxes = options?.bboxes ?? [];
    this._initCentroids = options?.centroids ?? [];
    this._initLabelImages = options?.labelImages ?? [];
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

    // Skip distribution for lazy Labels — annotations handled by LazyDataStore
    if (!this._lazyFrameList) {
      this._distributeAnnotations();
      // Collect tracks from annotations on frames
      for (const lf of this.labeledFrames) {
        this._collectAnnotationTracks(lf);
      }
    }
  }

  /** Distribute flat annotation lists into their corresponding LabeledFrames. */
  private _distributeAnnotations(): void {
    const getOrCreate = (video: Video, frameIdx: number): LabeledFrame => {
      // Use object identity for video key
      let found: LabeledFrame | undefined;
      for (const lf of this.labeledFrames) {
        if (lf.video === video && lf.frameIdx === frameIdx) {
          found = lf;
          break;
        }
      }
      if (!found) {
        found = new LabeledFrame({ video, frameIdx });
        this.labeledFrames.push(found);
      }
      return found;
    };

    const distribute = <T extends { video: Video | null; frameIdx: number | null }>(
      items: T[],
      attr: "centroids" | "bboxes" | "masks" | "labelImages" | "rois",
    ): T[] => {
      const remaining: T[] = [];
      for (const ann of items) {
        if (ann.video !== null && ann.frameIdx !== null) {
          const lf = getOrCreate(ann.video, ann.frameIdx);
          (lf[attr] as unknown[]).push(ann);
        } else {
          remaining.push(ann);
        }
      }
      return remaining;
    };

    this._initCentroids = distribute(this._initCentroids, "centroids");
    this._initBboxes = distribute(this._initBboxes, "bboxes");
    this._initMasks = distribute(this._initMasks, "masks");
    this._initLabelImages = distribute(this._initLabelImages, "labelImages");
    this._initRois = distribute(this._initRois, "rois");
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

  /** Find an existing LabeledFrame or create a new one. */
  private _findOrCreateFrame(video: Video, frameIdx: number): LabeledFrame {
    for (const lf of this.labeledFrames) {
      if (lf.video === video && lf.frameIdx === frameIdx) return lf;
    }
    const lf = new LabeledFrame({ video, frameIdx });
    this.labeledFrames.push(lf);
    return lf;
  }

  /** Add an annotation to the appropriate LabeledFrame. */
  private _addAnnotation(
    annotation: { video: Video | null; frameIdx: number | null; track?: Track | null },
    attr: "centroids" | "bboxes" | "masks" | "labelImages" | "rois",
  ): void {
    if (annotation.video === null || annotation.frameIdx === null) {
      throw new Error(`Annotation must have video and frameIdx set.`);
    }
    const lf = this._findOrCreateFrame(annotation.video, annotation.frameIdx);
    (lf[attr] as unknown[]).push(annotation);
    if (!this.videos.includes(annotation.video)) this.videos.push(annotation.video);
    if (annotation.track && !this.tracks.includes(annotation.track)) {
      this.tracks.push(annotation.track);
    }
  }

  addCentroid(centroid: Centroid): void {
    this._addAnnotation(centroid, "centroids");
  }

  addBbox(bbox: BoundingBox): void {
    this._addAnnotation(bbox, "bboxes");
  }

  addMask(mask: SegmentationMask): void {
    this._addAnnotation(mask, "masks");
  }

  addLabelImage(labelImage: LabelImage): void {
    this._addAnnotation(labelImage, "labelImages");
    for (const info of labelImage.objects.values()) {
      if (info.track && !this.tracks.includes(info.track)) {
        this.tracks.push(info.track);
      }
    }
  }

  addRoi(roi: ROI): void {
    this._addAnnotation(roi, "rois");
  }

  /** Flat view of all centroids across all frames. */
  get centroids(): Centroid[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._centroidByFrame;
      const undist = this._lazyDataStore._undistributedCentroids;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return [
      ...this._initCentroids,
      ...this.labeledFrames.flatMap((lf) => lf.centroids),
    ];
  }

  /** Flat view of all bounding boxes across all frames. */
  get bboxes(): BoundingBox[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._bboxByFrame;
      const undist = this._lazyDataStore._undistributedBboxes;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return [
      ...this._initBboxes,
      ...this.labeledFrames.flatMap((lf) => lf.bboxes),
    ];
  }

  /** Flat view of all segmentation masks across all frames. */
  get masks(): SegmentationMask[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._maskByFrame;
      const undist = this._lazyDataStore._undistributedMasks;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return [
      ...this._initMasks,
      ...this.labeledFrames.flatMap((lf) => lf.masks),
    ];
  }

  /** Flat view of all label images across all frames. */
  get labelImages(): LabelImage[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._labelImageByFrame;
      const undist = this._lazyDataStore._undistributedLabelImages;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return [
      ...this._initLabelImages,
      ...this.labeledFrames.flatMap((lf) => lf.labelImages),
    ];
  }

  /** Flat view of all ROIs across all frames. */
  get rois(): ROI[] {
    if (this._lazyFrameList && this._lazyDataStore) {
      const byFrame = this._lazyDataStore._roiByFrame;
      const undist = this._lazyDataStore._undistributedRois;
      return [...undist, ...[...byFrame.values()].flat()];
    }
    return [
      ...this._initRois,
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
      for (const ann of [...lf.centroids, ...lf.bboxes, ...lf.masks, ...lf.rois] as any[]) {
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

    // Keep undistributed annotations from the store
    if (store) {
      this._initRois = store._undistributedRois;
      this._initMasks = store._undistributedMasks;
      this._initBboxes = store._undistributedBboxes;
      this._initCentroids = store._undistributedCentroids;
      this._initLabelImages = store._undistributedLabelImages;
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
    this._collectAnnotationTracks(frame);
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

      // Update nested annotations
      for (const c of frame.centroids) {
        if (c.video && videoMap.has(c.video)) c.video = videoMap.get(c.video)!;
      }
      for (const b of frame.bboxes) {
        if (b.video && videoMap.has(b.video)) b.video = videoMap.get(b.video)!;
      }
      for (const m of frame.masks) {
        if (m.video && videoMap.has(m.video)) m.video = videoMap.get(m.video)!;
      }
      for (const r of frame.rois) {
        if (r.video && videoMap.has(r.video)) r.video = videoMap.get(r.video)!;
      }
      for (const li of frame.labelImages) {
        if (li.video && videoMap.has(li.video)) li.video = videoMap.get(li.video)!;
      }
    }

    for (const suggestion of this.suggestions) {
      const mapped = videoMap.get(suggestion.video);
      if (mapped) suggestion.video = mapped;
    }

    // Update undistributed annotations (e.g., static ROIs with frameIdx=null)
    for (const ann of [
      ...this._initCentroids,
      ...this._initBboxes,
      ...this._initMasks,
      ...this._initRois,
    ] as any[]) {
      if (ann.video && videoMap.has(ann.video)) ann.video = videoMap.get(ann.video)!;
    }
    for (const li of this._initLabelImages) {
      if (li.video && videoMap.has(li.video)) li.video = videoMap.get(li.video)!;
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
        rois: cloneAncillary(this._initRois),
        masks: cloneAncillary(this._initMasks),
        bboxes: cloneAncillary(this._initBboxes),
        centroids: cloneAncillary(this._initCentroids),
        labelImages: cloneAncillary(this._initLabelImages),
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
