import { I as Instance, P as PredictedInstance, k as Skeleton, T as Track } from './instance-BmOdR704.js';
export { E as Edge, N as Node, j as NodeOrIndex, a as Point, c as PointsArray, b as PredictedPoint, d as PredictedPointsArray, S as Symmetry, p as pointsEmpty, f as pointsFromArray, h as pointsFromDict, e as predictedPointsEmpty, g as predictedPointsFromArray, i as predictedPointsFromDict } from './instance-BmOdR704.js';

type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;
interface VideoBackend {
    filename: string | string[];
    shape?: [number, number, number, number];
    fps?: number;
    dataset?: string | null;
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    getFrameTimes?(): Promise<number[] | null>;
    close(): void;
}

declare class Video {
    filename: string | string[];
    backend: VideoBackend | null;
    backendMetadata: Record<string, unknown>;
    sourceVideo: Video | null;
    openBackend: boolean;
    private _embedded;
    private _shape;
    private _fps;
    constructor(options: {
        filename: string | string[];
        backend?: VideoBackend | null;
        backendMetadata?: Record<string, unknown>;
        sourceVideo?: Video | null;
        openBackend?: boolean;
        embedded?: boolean;
    });
    get hasEmbeddedImages(): boolean;
    get originalVideo(): Video | null;
    get shape(): [number, number, number, number] | null;
    set shape(value: [number, number, number, number] | null);
    get fps(): number | null;
    set fps(value: number | null);
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    getFrameTimes(): Promise<number[] | null>;
    close(): void;
    matchesPath(other: Video, strict?: boolean): boolean;
}

declare class LabeledFrame {
    video: Video;
    frameIdx: number;
    instances: Array<Instance | PredictedInstance>;
    isNegative: boolean;
    constructor(options: {
        video: Video;
        frameIdx: number;
        instances?: Array<Instance | PredictedInstance>;
        isNegative?: boolean;
    });
    get length(): number;
    [Symbol.iterator](): Iterator<Instance | PredictedInstance>;
    at(index: number): Instance | PredictedInstance | undefined;
    get userInstances(): Instance[];
    get predictedInstances(): PredictedInstance[];
    get hasUserInstances(): boolean;
    get hasPredictedInstances(): boolean;
    numpy(): number[][][];
    get image(): Promise<ImageData | ImageBitmap | ArrayBuffer | Uint8Array | null>;
    get unusedPredictions(): PredictedInstance[];
    removePredictions(): void;
    removeEmptyInstances(): void;
}

declare class SuggestionFrame {
    video: Video;
    frameIdx: number;
    group: string;
    metadata: Record<string, unknown>;
    constructor(options: {
        video: Video;
        frameIdx: number;
        group?: string;
        metadata?: Record<string, unknown>;
    });
}

declare class Identity {
    name: string;
    color?: string;
    metadata: Record<string, unknown>;
    constructor(options?: {
        name?: string;
        color?: string;
        metadata?: Record<string, unknown>;
    });
}

declare class Instance3D {
    points: number[][] | null;
    skeleton: Skeleton;
    score?: number;
    metadata: Record<string, unknown>;
    constructor(options: {
        points: number[][] | null;
        skeleton: Skeleton;
        score?: number;
        metadata?: Record<string, unknown>;
    });
    get nVisible(): number;
    get isEmpty(): boolean;
}
declare class PredictedInstance3D extends Instance3D {
    pointScores?: number[];
    constructor(options: {
        points: number[][] | null;
        skeleton: Skeleton;
        score?: number;
        pointScores?: number[];
        metadata?: Record<string, unknown>;
    });
}

declare function rodriguesTransformation(input: number[][] | number[]): {
    matrix: number[][];
    vector: number[];
};
declare class Camera {
    name?: string;
    rvec: number[];
    tvec: number[];
    matrix?: number[][];
    distortions?: number[];
    size?: [number, number];
    constructor(options: {
        name?: string;
        rvec: number[];
        tvec: number[];
        matrix?: number[][];
        distortions?: number[];
        size?: [number, number];
    });
}
declare class CameraGroup {
    cameras: Camera[];
    metadata: Record<string, unknown>;
    constructor(options?: {
        cameras?: Camera[];
        metadata?: Record<string, unknown>;
    });
}
declare class InstanceGroup {
    instanceByCamera: Map<Camera, Instance>;
    score?: number;
    identity?: Identity;
    instance3d?: Instance3D;
    metadata: Record<string, unknown>;
    private _points?;
    constructor(options: {
        instanceByCamera: Map<Camera, Instance> | Record<string, Instance>;
        score?: number;
        points?: number[][];
        identity?: Identity;
        instance3d?: Instance3D;
        metadata?: Record<string, unknown>;
    });
    get points(): number[][] | undefined;
    set points(value: number[][] | undefined);
    get instances(): Instance[];
}
declare class FrameGroup {
    frameIdx: number;
    instanceGroups: InstanceGroup[];
    labeledFrameByCamera: Map<Camera, LabeledFrame>;
    metadata: Record<string, unknown>;
    constructor(options: {
        frameIdx: number;
        instanceGroups: InstanceGroup[];
        labeledFrameByCamera: Map<Camera, LabeledFrame> | Record<string, LabeledFrame>;
        metadata?: Record<string, unknown>;
    });
    get cameras(): Camera[];
    get labeledFrames(): LabeledFrame[];
    getFrame(camera: Camera): LabeledFrame | undefined;
}
declare class RecordingSession {
    cameraGroup: CameraGroup;
    frameGroupByFrameIdx: Map<number, FrameGroup>;
    videoByCamera: Map<Camera, Video>;
    cameraByVideo: Map<Video, Camera>;
    metadata: Record<string, unknown>;
    constructor(options?: {
        cameraGroup?: CameraGroup;
        frameGroupByFrameIdx?: Map<number, FrameGroup>;
        videoByCamera?: Map<Camera, Video>;
        cameraByVideo?: Map<Video, Camera>;
        metadata?: Record<string, unknown>;
    });
    get frameGroups(): Map<number, FrameGroup>;
    get videos(): Video[];
    get cameras(): Camera[];
    addVideo(video: Video, camera: Camera): void;
    getCamera(video: Video): Camera | undefined;
    getVideo(camera: Camera): Video | undefined;
}
declare function makeCameraFromDict(data: Record<string, unknown>): Camera;

/**
 * Raw data store holding HDF5 dataset arrays for lazy materialization.
 * Keeps the parsed column data from frames/instances/points datasets
 * so individual frames can be materialized on demand.
 */
declare class LazyDataStore {
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
    });
    /** Total number of frames in the store. */
    get frameCount(): number;
    /**
     * Materialize a single LabeledFrame by index.
     */
    materializeFrame(frameIdx: number): LabeledFrame | null;
    /**
     * Build a 4D numpy-like array directly from raw column data without
     * materializing any LabeledFrame or Instance objects.
     *
     * Returns [frames, tracks/instances, nodes, coords] where coords is
     * [x, y] or [x, y, score] when returnConfidence is true.
     */
    toNumpy(options?: {
        video?: Video;
        returnConfidence?: boolean;
    }): number[][][][];
    /** Materialize all frames at once. */
    materializeAll(): LabeledFrame[];
    private slicePoints;
}
/**
 * A lazy array-like container for LabeledFrames.
 * Frames are materialized from the LazyDataStore only when accessed.
 * Supports indexing, iteration, length, and conversion to a real array.
 */
declare class LazyFrameList {
    private store;
    private cache;
    constructor(store: LazyDataStore);
    get length(): number;
    /** Get a frame by index, materializing it if needed. */
    at(index: number): LabeledFrame | undefined;
    /** Materialize all frames and return as a regular array. */
    toArray(): LabeledFrame[];
    /** Iterator support. Skips null frames instead of stopping early. */
    [Symbol.iterator](): Iterator<LabeledFrame>;
    /** Number of frames that have been materialized. */
    get materializedCount(): number;
}

declare function encodeRle(mask: Uint8Array, height: number, width: number): Uint32Array;
declare function decodeRle(rleCounts: Uint32Array, height: number, width: number): Uint8Array;
/**
 * Resize a typed array using nearest-neighbor interpolation.
 * The input is a flat (H*W) array and the output is a flat (dstH*dstW) array.
 */
declare function resizeNearest<T extends Uint8Array | Int32Array | Float32Array>(data: T, srcH: number, srcW: number, dstH: number, dstW: number): T;
interface SegmentationMaskOptions {
    rleCounts: Uint32Array;
    height: number;
    width: number;
    name?: string;
    category?: string;
    source?: string;
    video?: Video | null;
    frameIdx?: number | null;
    track?: Track | null;
    instance?: Instance | null;
    scale?: [number, number];
    offset?: [number, number];
}
declare class SegmentationMask {
    rleCounts: Uint32Array;
    height: number;
    width: number;
    name: string;
    category: string;
    source: string;
    video: Video | null;
    frameIdx: number | null;
    track: Track | null;
    instance: Instance | null;
    /** Spatial scale factor: image_coord = mask_coord / scale + offset. Default [1, 1]. */
    scale: [number, number];
    /** Spatial offset: image_coord = mask_coord / scale + offset. Default [0, 0]. */
    offset: [number, number];
    /** @internal Deferred instance index for lazy resolution. */
    _instanceIdx: number | null;
    constructor(options: SegmentationMaskOptions);
    static fromArray(mask: Uint8Array | boolean[][], height: number, width: number, options?: Omit<SegmentationMaskOptions, "rleCounts" | "height" | "width"> & {
        stride?: number;
    }): UserSegmentationMask;
    get data(): Uint8Array;
    get area(): number;
    /** Whether scale != [1,1] or offset != [0,0]. */
    get hasSpatialTransform(): boolean;
    /** The image-space extent of this mask (accounting for scale). */
    get imageExtent(): {
        height: number;
        width: number;
    };
    get isPredicted(): boolean;
    /**
     * Create a resampled copy of this mask at the target dimensions.
     * The returned mask has scale=[1,1] and offset=[0,0].
     */
    resampled(targetHeight: number, targetWidth: number): SegmentationMask;
    get bbox(): {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Convert the mask to a bounding-box polygon ROI. */
    toPolygon(): ROI;
}
/** User-annotated segmentation mask (no prediction score). */
declare class UserSegmentationMask extends SegmentationMask {
}
/** Predicted segmentation mask with a confidence score and optional score map. */
declare class PredictedSegmentationMask extends SegmentationMask {
    score: number;
    scoreMap: Float32Array | null;
    /** Spatial scale for the score map. Default [1, 1]. */
    scoreMapScale: [number, number];
    /** Spatial offset for the score map. Default [0, 0]. */
    scoreMapOffset: [number, number];
    constructor(options: SegmentationMaskOptions & {
        score: number;
        scoreMap?: Float32Array | null;
        scoreMapScale?: [number, number];
        scoreMapOffset?: [number, number];
    });
    get isPredicted(): boolean;
}

type MaskFactory = (mask: Uint8Array, height: number, width: number, options: Record<string, unknown>) => SegmentationMask;
declare function _registerMaskFactory(factory: MaskFactory): void;
declare enum AnnotationType {
    DEFAULT = 0,
    BOUNDING_BOX = 1,
    SEGMENTATION = 2,
    ARENA = 3,
    ANCHOR = 4
}
type Geometry = {
    type: "Polygon";
    coordinates: number[][][];
} | {
    type: "Point";
    coordinates: number[];
} | {
    type: "MultiPolygon";
    coordinates: number[][][][];
} | {
    type: "MultiPoint";
    coordinates: number[][];
} | {
    type: "LineString";
    coordinates: number[][];
} | {
    type: "GeometryCollection";
    geometries: Geometry[];
};
interface ROIOptions {
    geometry: Geometry;
    name?: string;
    category?: string;
    source?: string;
    video?: Video | null;
    frameIdx?: number | null;
    track?: Track | null;
    instance?: Instance | null;
}
declare class ROI {
    geometry: Geometry;
    name: string;
    category: string;
    source: string;
    video: Video | null;
    frameIdx: number | null;
    track: Track | null;
    instance: Instance | null;
    /** @internal Deferred instance index for lazy resolution. */
    _instanceIdx: number | null;
    constructor(options: ROIOptions);
    /** @deprecated Use BoundingBox.fromXywh() instead. */
    static fromBbox(x: number, y: number, width: number, height: number, options?: Omit<ROIOptions, "geometry">): UserROI;
    /** @deprecated Use BoundingBox.fromXyxy() instead. */
    static fromXyxy(x1: number, y1: number, x2: number, y2: number, options?: Omit<ROIOptions, "geometry">): UserROI;
    static fromPolygon(coords: number[][], options?: Omit<ROIOptions, "geometry">): UserROI;
    static fromMultiPolygon(polygons: number[][][][], options?: Omit<ROIOptions, "geometry">): UserROI;
    /** Whether this is a predicted ROI (has a score). */
    get isPredicted(): boolean;
    explode(): ROI[];
    toGeoJSON(): {
        type: "Feature";
        geometry: Geometry;
        properties: Record<string, unknown>;
    };
    get isStatic(): boolean;
    get isBbox(): boolean;
    get bounds(): {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    };
    get area(): number;
    get centroid(): {
        x: number;
        y: number;
    };
    toMask(height: number, width: number): SegmentationMask;
    private _allPoints;
}
declare function rasterizeGeometry(geometry: Geometry, height: number, width: number): Uint8Array;
declare function encodeWkb(geometry: Geometry): Uint8Array;
declare function decodeWkb(bytes: Uint8Array): Geometry;
/** User-annotated region of interest (no prediction score). */
declare class UserROI extends ROI {
}
/** Predicted region of interest with a confidence score. */
declare class PredictedROI extends ROI {
    score: number;
    constructor(options: ROIOptions & {
        score: number;
    });
    get isPredicted(): boolean;
}

/** Options for constructing a BoundingBox. */
interface BoundingBoxOptions {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    angle?: number;
    video?: Video | null;
    frameIdx?: number | null;
    track?: Track | null;
    instance?: Instance | null;
    category?: string;
    name?: string;
    source?: string;
}
/** Base bounding box class for detection/tracking workflows. */
declare class BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    angle: number;
    video: Video | null;
    frameIdx: number | null;
    track: Track | null;
    instance: Instance | null;
    category: string;
    name: string;
    source: string;
    /** @internal Deferred instance index for lazy resolution. */
    _instanceIdx: number | null;
    constructor(options: BoundingBoxOptions);
    /** Create from corner coordinates [x1, y1, x2, y2]. */
    static fromXyxy(x1: number, y1: number, x2: number, y2: number, options?: Omit<BoundingBoxOptions, "x1" | "y1" | "x2" | "y2">): UserBoundingBox;
    /** Create from top-left corner + size [x, y, w, h]. */
    static fromXywh(x: number, y: number, w: number, h: number, options?: Omit<BoundingBoxOptions, "x1" | "y1" | "x2" | "y2">): UserBoundingBox;
    /** Center X coordinate (computed from x1, x2). */
    get xCenter(): number;
    /** Center Y coordinate (computed from y1, y2). */
    get yCenter(): number;
    /** Width of the bbox (computed from x1, x2). */
    get width(): number;
    /** Height of the bbox (computed from y1, y2). */
    get height(): number;
    /** Axis-aligned bounding box as [x1, y1, x2, y2]. */
    get xyxy(): [number, number, number, number];
    /** Top-left x, y and size (AABB dimensions for rotated bboxes). */
    get xywh(): {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Four corner points of the (possibly rotated) bbox. */
    get corners(): number[][];
    /** Axis-aligned bounds. */
    get bounds(): {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    };
    /** Area of the bbox (width * height). */
    get area(): number;
    /** Center point. */
    get centroid(): {
        x: number;
        y: number;
    };
    /** Whether this is a predicted bbox (has a score). */
    get isPredicted(): boolean;
    /** Whether the bbox has no temporal association. */
    get isStatic(): boolean;
    /** Whether the bbox is rotated (angle != 0). */
    get isRotated(): boolean;
    /** Convert to a Polygon ROI. */
    toRoi(): ROI;
    /** Convert to a SegmentationMask by rasterizing the bbox polygon. */
    toMask(height: number, width: number): SegmentationMask;
}
/** User-annotated bounding box (no prediction score). */
declare class UserBoundingBox extends BoundingBox {
}
/** Predicted bounding box with a confidence score. */
declare class PredictedBoundingBox extends BoundingBox {
    score: number;
    constructor(options: BoundingBoxOptions & {
        score: number;
    });
    get isPredicted(): boolean;
}

/** Per-object metadata in a LabelImage. */
interface LabelImageObjectInfo {
    track: Track | null;
    category: string;
    name: string;
    instance: Instance | null;
    score?: number | null;
    /** @internal Deferred instance index for lazy resolution. */
    _instanceIdx?: number;
}
interface LabelImageOptions {
    data: Int32Array;
    height: number;
    width: number;
    objects?: Map<number, LabelImageObjectInfo>;
    video?: Video | null;
    frameIdx?: number | null;
    source?: string;
    scale?: [number, number];
    offset?: [number, number];
}
/**
 * Dense integer label image for instance segmentation.
 *
 * Each pixel value encodes which object occupies that pixel:
 * 0 = background, positive integers = object IDs.
 *
 * This is the typical output format of tools like Cellpose, StarDist, etc.
 */
declare class LabelImage {
    /** Flat (H*W) Int32Array, row-major. 0 = background, positive = object ID. */
    data: Int32Array;
    height: number;
    width: number;
    /** Map from label ID (positive int) to object metadata. */
    objects: Map<number, LabelImageObjectInfo>;
    video: Video | null;
    frameIdx: number | null;
    source: string;
    /** Spatial scale factor: image_coord = li_coord / scale + offset. Default [1, 1]. */
    scale: [number, number];
    /** Spatial offset: image_coord = li_coord / scale + offset. Default [0, 0]. */
    offset: [number, number];
    /** @internal Deferred instance indices for lazy resolution. Map<label_id, instance_idx> */
    _objectInstanceIdxs: Map<number, number> | null;
    constructor(options: LabelImageOptions);
    /** Number of objects in the label image metadata. */
    get nObjects(): number;
    /** Sorted unique non-zero label IDs present in the data.
     *  Note: Scans the full pixel array on every call. Cache the result if needed multiple times. */
    get labelIds(): number[];
    /** Non-null tracks from objects, sorted by label ID. */
    get tracks(): Track[];
    /** Unique non-empty category strings across all objects. */
    get categories(): Set<string>;
    /** Whether this label image has no temporal association (frameIdx is null). */
    get isStatic(): boolean;
    /** Whether this is a predicted label image (has a score). */
    get isPredicted(): boolean;
    /** Whether scale != [1,1] or offset != [0,0]. */
    get hasSpatialTransform(): boolean;
    /** The image-space extent of this label image (accounting for scale). */
    get imageExtent(): {
        height: number;
        width: number;
    };
    /**
     * Create a resampled copy of this label image at the target dimensions.
     * The returned label image has scale=[1,1] and offset=[0,0].
     */
    resampled(targetHeight: number, targetWidth: number): LabelImage;
    /** Get a binary mask (Uint8Array) for a specific label ID. */
    getObjectMask(labelId: number): Uint8Array;
    /** Get a binary mask for all objects associated with a given track. */
    getTrackMask(track: Track): Uint8Array;
    /** Get a binary mask for all objects with a given category. Throws if category not found. */
    getCategoryMask(category: string): Uint8Array;
    /** Iterate over objects as [track, category, binaryMask] tuples in sorted label ID order. */
    items(): IterableIterator<[Track | null, string, Uint8Array]>;
    /**
     * Create a LabelImage from a flat Int32Array or 2D number array.
     *
     * Tracks are auto-created when not provided. When provided as an array,
     * they are assigned positionally starting at label ID 1.
     */
    static fromArray(data: Int32Array | number[][], height: number, width: number, options?: {
        tracks?: Track[] | Map<number, Track>;
        categories?: string[] | Map<number, string>;
        video?: Video | null;
        frameIdx?: number | null;
        source?: string;
    }): UserLabelImage;
    /** Create a LabelImage by compositing an array of SegmentationMasks. */
    static fromMasks(masks: SegmentationMask[], options?: {
        video?: Video | null;
        frameIdx?: number | null;
        source?: string;
    }): UserLabelImage;
    /**
     * Create a list of LabelImages from a stack of 2D arrays (one per frame).
     *
     * Shared Track objects are created once and reused across frames.
     *
     * @param options.data - Array of flat Int32Arrays or 2D number arrays, one per frame.
     * @param options.tracks - Track objects to assign. Array (1-indexed) or Map<labelId, Track>.
     * @param options.categories - Category strings. Array (1-indexed) or Map<labelId, string>.
     * @param options.createTracks - If true and tracks is not provided, auto-create one Track
     *   per unique non-zero label ID found across ALL frames.
     * @param options.frameIdx - Custom frame indices. Defaults to [0, 1, ..., T-1].
     * @param options.video - Video reference shared across all frames.
     * @param options.source - Source string shared across all frames.
     */
    static fromStack(options: {
        data: number[][][];
        tracks?: Map<number, Track> | Track[] | null;
        categories?: Map<number, string> | string[] | null;
        createTracks?: boolean;
        frameIdx?: number[] | null;
        video?: Video | null;
        source?: string;
    }): UserLabelImage[];
    /**
     * Create a LabelImage from per-object binary mask arrays.
     *
     * This is a convenience factory for workflows that produce per-object boolean
     * masks (e.g., SAM, Mask R-CNN) without going through SegmentationMask/RLE.
     *
     * Overlapping pixels are assigned to the last mask (same as fromMasks).
     *
     * @param masks - Binary masks as:
     *   - `number[][]` — single 2D mask (rows of pixel values)
     *   - `number[][][]` — array of 2D masks
     *   - `(Uint8Array | number[][])[]` — array of flat or 2D masks
     * @param options.height - Required when masks are flat Uint8Array.
     * @param options.width - Required when masks are flat Uint8Array.
     * @param options.labelIds - Explicit pixel values per mask. Must be positive and unique.
     *   Defaults to sequential [1, 2, ..., N].
     * @param options.tracks - Track objects per mask (positional).
     * @param options.categories - Category strings per mask (positional).
     * @param options.names - Name strings per mask (positional).
     * @param options.scores - Confidence scores per mask (positional).
     * @param options.createTracks - Auto-create Track objects named by label ID.
     */
    static fromBinaryMasks(masks: number[][] | number[][][] | (Uint8Array | number[][])[], options?: {
        height?: number;
        width?: number;
        labelIds?: number[] | null;
        tracks?: Track[] | null;
        categories?: string[] | null;
        names?: string[] | null;
        scores?: number[] | null;
        createTracks?: boolean;
        video?: Video | null;
        frameIdx?: number | null;
        source?: string;
        scale?: [number, number];
        offset?: [number, number];
    }): UserLabelImage;
    /** Decompose this LabelImage into individual SegmentationMask objects. */
    toMasks(): SegmentationMask[];
}
/** User-annotated label image (no prediction score). */
declare class UserLabelImage extends LabelImage {
}
/** Predicted label image with a confidence score and optional score map. */
declare class PredictedLabelImage extends LabelImage {
    score: number;
    scoreMap: Float32Array | null;
    /** Spatial scale for the score map. Default [1, 1]. */
    scoreMapScale: [number, number];
    /** Spatial offset for the score map. Default [0, 0]. */
    scoreMapOffset: [number, number];
    constructor(options: LabelImageOptions & {
        score: number;
        scoreMap?: Float32Array | null;
        scoreMapScale?: [number, number];
        scoreMapOffset?: [number, number];
    });
    get isPredicted(): boolean;
}
/**
 * Normalize label IDs across a list of LabelImages so that each Track (or
 * category) gets a globally consistent label ID.
 *
 * IDs are assigned in first-appearance order (frame-by-frame, sorted within
 * each frame). The label images are mutated in place.
 *
 * @param labelImages - Array of LabelImage objects to normalize.
 * @param options.by - Group by "track" (default, reference equality) or
 *   "category" (string equality; same-category objects within a frame merge).
 * @returns Map from Track (or category string) to assigned label ID.
 */
declare function normalizeLabelIds(labelImages: LabelImage[], options?: {
    by?: "track";
}): Map<Track, number>;
declare function normalizeLabelIds(labelImages: LabelImage[], options: {
    by: "category";
}): Map<string, number>;

declare class Labels {
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
    labelImages: LabelImage[];
    identities: Identity[];
    /** @internal Lazy frame list for on-demand materialization. */
    _lazyFrameList: LazyFrameList | null;
    /** @internal Lazy data store holding raw HDF5 data. */
    _lazyDataStore: LazyDataStore | null;
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
        labelImages?: LabelImage[];
        identities?: Identity[];
    });
    /** Whether this Labels instance is in lazy mode. */
    get isLazy(): boolean;
    /**
     * Materialize all lazy frames, converting to eager mode.
     * No-op if already eager.
     */
    materialize(): void;
    get negativeFrames(): LabeledFrame[];
    get video(): Video;
    get length(): number;
    [Symbol.iterator](): Iterator<LabeledFrame>;
    get instances(): Array<Instance | PredictedInstance>;
    find(options: {
        video?: Video;
        frameIdx?: number;
    }): LabeledFrame[];
    addVideo(video: Video): void;
    append(frame: LabeledFrame): void;
    toDict(options?: {
        video?: Video | number;
        skipEmptyFrames?: boolean;
    }): LabelsDict;
    get staticRois(): ROI[];
    get temporalRois(): ROI[];
    getRois(filters?: {
        video?: Video;
        frameIdx?: number;
        category?: string;
        track?: Track;
        instance?: Instance | PredictedInstance;
        predicted?: boolean;
    }): ROI[];
    getMasks(filters?: {
        video?: Video;
        frameIdx?: number;
        category?: string;
        track?: Track;
        instance?: Instance | PredictedInstance;
        predicted?: boolean;
    }): SegmentationMask[];
    get staticBboxes(): BoundingBox[];
    get temporalBboxes(): BoundingBox[];
    getBboxes(filters?: {
        video?: Video;
        frameIdx?: number;
        category?: string;
        track?: Track;
        instance?: Instance;
        predicted?: boolean;
    }): BoundingBox[];
    get staticLabelImages(): LabelImage[];
    get temporalLabelImages(): LabelImage[];
    getLabelImages(filters?: {
        video?: Video;
        frameIdx?: number;
        track?: Track;
        category?: string;
        predicted?: boolean;
    }): LabelImage[];
    static fromNumpy(data: number[][][][], options: {
        videos?: Video[];
        video?: Video;
        skeletons?: Skeleton[] | Skeleton;
        skeleton?: Skeleton;
        trackNames?: string[];
        firstFrame?: number;
        returnConfidence?: boolean;
    }): Labels;
    numpy(options?: {
        video?: Video;
        returnConfidence?: boolean;
    }): number[][][][];
}

declare class LabelsSet {
    labels: Map<string, Labels>;
    constructor(entries?: Record<string, Labels>);
    get size(): number;
    get(key: string): Labels | undefined;
    set(key: string, value: Labels): void;
    delete(key: string): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<Labels>;
    entries(): IterableIterator<[string, Labels]>;
    [Symbol.iterator](): IterableIterator<[string, Labels]>;
    static fromLabelsList(labelsList: Labels[], keys?: string[]): LabelsSet;
    toArray(): Labels[];
    keyArray(): string[];
}

declare class Mp4BoxVideoBackend implements VideoBackend {
    filename: string;
    shape?: [number, number, number, number];
    fps?: number;
    dataset?: string | null;
    private ready;
    private mp4box;
    private mp4boxFile;
    private videoTrack;
    private samples;
    private keyframeIndices;
    private cache;
    private cacheSize;
    private lookahead;
    private decoder;
    private config;
    private fileSize;
    private supportsRangeRequests;
    private fileBlob;
    private decodeQueue;
    private latestRequestedFrame;
    constructor(source: string | File | Blob, options?: {
        cacheSize?: number;
        lookahead?: number;
    });
    getFrame(frameIndex: number, signal?: AbortSignal): Promise<VideoFrame | null>;
    getFrameTimes(): Promise<number[] | null>;
    close(): void;
    private init;
    private openSource;
    private readChunk;
    private extractSamples;
    private findKeyframeBefore;
    private getCodecDescription;
    private readSampleDataByDecodeOrder;
    private decodeRange;
    private addToCache;
}

/**
 * MediaBunny Video Backend
 *
 * Alternative video decoding backend using MediaBunny. Supports additional
 * formats beyond MP4: WebM, Matroska, Ogg, MOV, MPEG-TS.
 *
 * Uses timestamp-based frame access internally, with a frame time index
 * built on initialization by iterating all packets.
 */

interface MediaBunnyOptions {
    cacheSize?: number;
}
declare class MediaBunnyVideoBackend implements VideoBackend {
    filename: string | string[];
    shape?: [number, number, number, number];
    fps?: number;
    dataset?: string | null;
    private input;
    private sink;
    private _frameTimes;
    private cache;
    private cacheSize;
    private frameCount;
    private decodingPromise;
    constructor(filename: string | string[], options?: MediaBunnyOptions);
    static fromUrl(url: string, options?: MediaBunnyOptions): Promise<MediaBunnyVideoBackend>;
    static fromBlob(blob: Blob, filename: string, options?: MediaBunnyOptions): Promise<MediaBunnyVideoBackend>;
    private initialize;
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    private decodeSingleFrame;
    prefetch(startIndex: number, endIndex: number): Promise<void>;
    getFrames(startIndex: number, endIndex: number): Promise<Map<number, ImageBitmap>>;
    private decodeRange;
    getFrameTimes(): Promise<number[] | null>;
    get numFrames(): number;
    close(): void;
    private cacheFrame;
}

/**
 * Streaming HDF5 file access via Web Worker.
 *
 * This module provides a high-level API for accessing remote HDF5 files
 * using HTTP range requests for efficient streaming. The actual HDF5
 * operations run in a Web Worker where synchronous XHR is allowed.
 *
 * @module
 */
/**
 * Options for opening a streaming HDF5 file.
 */
interface StreamingH5Options {
    /** URL to h5wasm IIFE bundle. Defaults to CDN. */
    h5wasmUrl?: string;
    /** Filename hint for the HDF5 file. */
    filenameHint?: string;
}
/**
 * Source types supported by the streaming HDF5 file.
 */
type StreamingH5Source = string | ArrayBuffer | Uint8Array | File;
/**
 * A streaming HDF5 file handle that uses a Web Worker for range request access.
 *
 * This class provides an API similar to h5wasm.File but operates via message
 * passing to a worker where createLazyFile enables HTTP range requests.
 */
declare class StreamingH5File {
    private worker;
    private messageId;
    private pendingMessages;
    private _keys;
    private _isOpen;
    constructor();
    private handleMessage;
    private handleError;
    private send;
    /**
     * Initialize the h5wasm module in the worker.
     */
    init(options?: StreamingH5Options): Promise<void>;
    /**
     * Open a remote HDF5 file for streaming access via URL.
     *
     * @param url - URL to the HDF5 file (must support HTTP range requests)
     * @param options - Optional settings
     */
    open(url: string, options?: StreamingH5Options): Promise<void>;
    /**
     * Open a local File object using WORKERFS (zero-copy).
     *
     * @param file - File object from file input or drag-and-drop
     * @param options - Optional settings
     */
    openLocal(file: File, options?: StreamingH5Options): Promise<void>;
    /**
     * Open an HDF5 file from an ArrayBuffer or Uint8Array.
     *
     * @param buffer - ArrayBuffer or Uint8Array containing the HDF5 file data
     * @param options - Optional settings
     */
    openBuffer(buffer: ArrayBuffer | Uint8Array, options?: StreamingH5Options): Promise<void>;
    /**
     * Open an HDF5 file from any supported source.
     *
     * @param source - URL string, File, ArrayBuffer, or Uint8Array
     * @param options - Optional settings
     */
    openAny(source: StreamingH5Source, options?: StreamingH5Options): Promise<void>;
    /**
     * Whether a file is currently open.
     */
    get isOpen(): boolean;
    /**
     * Get the root-level keys in the file.
     */
    keys(): string[];
    /**
     * Get the keys (children) at a given path.
     */
    getKeys(path: string): Promise<string[]>;
    /**
     * Get an attribute value.
     */
    getAttr(path: string, name: string): Promise<unknown>;
    /**
     * Get all attributes at a path.
     */
    getAttrs(path: string): Promise<Record<string, unknown>>;
    /**
     * Get dataset metadata (shape, dtype) without reading values.
     */
    getDatasetMeta(path: string): Promise<{
        shape: number[];
        dtype: string;
    }>;
    /**
     * Read a dataset's value.
     *
     * @param path - Path to the dataset
     * @param slice - Optional slice specification (array of [start, end] pairs)
     */
    getDatasetValue(path: string, slice?: Array<[number, number] | []>): Promise<{
        value: unknown;
        shape: number[];
        dtype: string;
    }>;
    /**
     * Close the file and terminate the worker.
     */
    close(): Promise<void>;
}
/**
 * Check if streaming via Web Worker is supported in the current environment.
 */
declare function isStreamingSupported(): boolean;
/**
 * Open a remote HDF5 file with streaming support.
 *
 * @param url - URL to the HDF5 file
 * @param options - Optional settings
 * @returns A StreamingH5File instance
 */
declare function openStreamingH5(url: string, options?: StreamingH5Options): Promise<StreamingH5File>;
/**
 * Open an HDF5 file from any supported source using a Web Worker.
 *
 * This is the recommended way to open HDF5 files in the browser as it
 * offloads all h5wasm operations to a Web Worker, avoiding main thread blocking.
 *
 * @param source - URL string, File object, ArrayBuffer, or Uint8Array
 * @param options - Optional settings
 * @returns A StreamingH5File instance
 *
 * @example
 * ```typescript
 * // From URL
 * const file = await openH5Worker("https://example.com/data.h5");
 *
 * // From File (file input)
 * const file = await openH5Worker(inputElement.files[0]);
 *
 * // From ArrayBuffer
 * const file = await openH5Worker(arrayBuffer);
 * ```
 */
declare function openH5Worker(source: StreamingH5Source, options?: StreamingH5Options): Promise<StreamingH5File>;

/**
 * Video backend for embedded images in HDF5 files accessed via streaming.
 *
 * This backend uses StreamingH5File (Web Worker + range requests) instead of
 * a synchronous h5wasm File object, making it suitable for browser environments
 * where the SLP file is loaded via HTTP range requests.
 *
 * Supports two data storage formats:
 * 1. vlen-encoded: Array of individual frame blobs (each index = one frame)
 * 2. Contiguous buffer: Single buffer with all frames concatenated
 */
declare class StreamingHdf5VideoBackend implements VideoBackend {
    filename: string;
    dataset?: string | null;
    shape?: [number, number, number, number];
    fps?: number;
    private h5file;
    private datasetPath;
    private frameNumberToIndex;
    private format;
    private channelOrder;
    private cachedData;
    private frameOffsets;
    constructor(options: {
        filename: string;
        h5file: StreamingH5File;
        datasetPath: string;
        frameNumbers?: number[];
        format?: string;
        channelOrder?: string;
        shape?: [number, number, number, number];
        fps?: number;
    });
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    close(): void;
}

/** Supported video backend identifiers for user selection. */
type VideoBackendType = "mp4box" | "mediabunny" | "media";
declare function createVideoBackend(source: string | File | Blob, options?: {
    dataset?: string;
    embedded?: boolean;
    frameNumbers?: number[];
    frameSizes?: number[];
    format?: string;
    channelOrder?: string;
    shape?: [number, number, number, number];
    fps?: number;
    backend?: VideoBackendType;
}): Promise<VideoBackend>;

type SlpSource = string | ArrayBuffer | Uint8Array | File | FileSystemFileHandle;
type StreamMode = "auto" | "range" | "download";
type OpenH5Options = {
    /**
     * Streaming mode for remote files:
     * - "auto": Try range requests, fall back to download
     * - "range": Use HTTP range requests (requires Worker support in browser)
     * - "download": Always download the entire file
     */
    stream?: StreamMode;
    /** Filename hint for the HDF5 file */
    filenameHint?: string;
};

type SlpWriteOptions = {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
};
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
declare function saveSlpToBytes(labels: Labels, options?: SlpWriteOptions): Promise<Uint8Array>;

/**
 * Load a SLEAP labels file (.slp).
 *
 * Automatically selects the best loading strategy:
 * - Browser with Worker support: uses streaming reader via Web Worker
 * - Node.js or fallback: uses standard HDF5 reader
 *
 * @param source - Path to .slp file, ArrayBuffer, Uint8Array, File, or FileSystemFileHandle
 * @param options - Loading options
 * @param options.openVideos - Whether to open video backends (default: true)
 * @param options.h5 - HDF5 opening options (stream mode, filename hint)
 * @param options.lazy - If true, use lazy loading for on-demand frame materialization (default: false)
 * @returns Loaded Labels object
 */
declare function loadSlp(source: SlpSource, options?: {
    openVideos?: boolean;
    h5?: OpenH5Options;
    lazy?: boolean;
}): Promise<Labels>;
/**
 * Save labels to a SLEAP labels file (.slp).
 *
 * @param labels - Labels object to save
 * @param filename - Output file path
 * @param options - Save options
 * @param options.embed - Embed video frames: true/"all", "user", "suggestions", "user+suggestions"
 * @param options.restoreOriginalVideos - Restore source video paths on save (default: true)
 */
declare function saveSlp(labels: Labels, filename: string, options?: {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
}): Promise<void>;

/**
 * Load multiple SLP files in parallel.
 *
 * Accepts either an array of file paths (keys default to filenames) or a
 * record mapping custom keys to file paths.
 *
 * Note: Uses Promise.all internally — if any single file fails to load,
 * the entire operation fails.
 *
 * @param sources - Array of file paths or record mapping keys to paths
 * @param options - Loading options (forwarded to loadSlp)
 * @returns LabelsSet containing all loaded labels
 */
declare function loadSlpSet(sources: string[] | Record<string, string>, options?: {
    openVideos?: boolean;
    h5?: OpenH5Options;
}): Promise<LabelsSet>;
/**
 * Save all labels in a LabelsSet to their respective file paths.
 *
 * Each key in the set is used as the output filename, so keys should be
 * valid file paths.
 *
 * @param labelsSet - LabelsSet to save
 * @param options - Save options (forwarded to saveSlp)
 */
declare function saveSlpSet(labelsSet: LabelsSet, options?: {
    embed?: boolean | string;
    restoreOriginalVideos?: boolean;
}): Promise<void>;
/**
 * Load a video file and create a Video object with an active backend.
 *
 * @param source - Path to video file, or a browser File object
 * @param options - Video loading options
 * @param options.dataset - HDF5 dataset path for embedded videos
 * @param options.openBackend - Whether to open the backend (default: true)
 * @param options.backend - Explicit backend selection
 * @returns Video object with backend
 */
declare function loadVideo(source: string | File, options?: {
    dataset?: string;
    openBackend?: boolean;
    backend?: VideoBackendType;
}): Promise<Video>;

/** GeoJSON Feature type */
interface GeoJSONFeature {
    type: "Feature";
    geometry: Geometry;
    properties?: Record<string, unknown>;
}
/** GeoJSON FeatureCollection type */
interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}
/**
 * Convert ROIs to a GeoJSON FeatureCollection object.
 */
declare function roisToGeoJSON(rois: ROI[]): GeoJSONFeatureCollection;
/**
 * Parse a GeoJSON object into ROIs.
 * Accepts either a FeatureCollection or a single Feature.
 */
declare function roisFromGeoJSON(geojson: GeoJSONFeatureCollection | GeoJSONFeature): ROI[];
/**
 * Serialize ROIs to a GeoJSON string.
 */
declare function writeGeoJSON(rois: ROI[]): string;
/**
 * Parse a GeoJSON string into ROIs.
 */
declare function readGeoJSON(json: string): ROI[];

type LabelsDict = {
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
        is_negative?: boolean;
    }>;
    suggestions: Array<Record<string, unknown>>;
    provenance: Record<string, unknown>;
};
declare function toDict(labels: Labels, options?: {
    video?: Video | number;
    skipEmptyFrames?: boolean;
}): LabelsDict;
declare function fromDict(data: LabelsDict): Labels;

declare function toNumpy(labels: Labels, options?: {
    returnConfidence?: boolean;
    video?: Video;
}): number[][][][];
declare function fromNumpy(data: number[][][][], options: {
    video?: Video;
    videos?: Video[];
    skeleton?: Skeleton;
    skeletons?: Skeleton[] | Skeleton;
    returnConfidence?: boolean;
    trackNames?: string[];
    firstFrame?: number;
}): Labels;
declare function labelsFromNumpy(data: number[][][][], options: {
    video: Video;
    skeleton: Skeleton;
    trackNames?: string[];
    firstFrame?: number;
    returnConfidence?: boolean;
}): Labels;

declare function decodeYamlSkeleton(yamlData: string): Skeleton | Skeleton[];
declare function encodeYamlSkeleton(skeletons: Skeleton | Skeleton[]): string;

/**
 * Parse a skeleton from jsonpickle graph format (used in .json skeleton files
 * and training config files).
 *
 * The jsonpickle format uses py/object for first occurrences and py/id for
 * back-references. Two format variants exist:
 * - Shared-object: nodes use py/id refs across links (flies13 style)
 * - Duplicate-object: every link has fresh py/object nodes (fly32 style)
 *
 * We use separate ID registries for nodes and edge types to handle both.
 */
declare function readSkeletonJson(json: string | Record<string, unknown>): Skeleton;

/**
 * Extract skeleton(s) from a SLEAP training config JSON file.
 * Training configs embed skeleton definitions in data.labels.skeletons[].
 */
declare function readTrainingConfigSkeletons(json: string | Record<string, unknown>): Skeleton[];
/**
 * Extract the first skeleton from a SLEAP training config JSON file.
 */
declare function readTrainingConfigSkeleton(json: string | Record<string, unknown>): Skeleton;
/**
 * Detect whether a JSON object or string is a training config format.
 */
declare function isTrainingConfig(json: string | Record<string, unknown>): boolean;

/**
 * Context passed to pre/post render callbacks.
 */
declare class RenderContext {
    /** The 2D canvas rendering context */
    readonly canvas: CanvasRenderingContext2D;
    /** Current frame index (0 for single images) */
    readonly frameIdx: number;
    /** Original frame size [width, height] */
    readonly frameSize: [number, number];
    /** Instances in this frame */
    readonly instances: (Instance | PredictedInstance)[];
    /** Skeleton edge connectivity as [srcIdx, dstIdx] pairs */
    readonly skeletonEdges: [number, number][];
    /** Node names from skeleton */
    readonly nodeNames: string[];
    /** Current scale factor */
    readonly scale: number;
    /** Offset for cropped views [x, y] */
    readonly offset: [number, number];
    constructor(
    /** The 2D canvas rendering context */
    canvas: CanvasRenderingContext2D, 
    /** Current frame index (0 for single images) */
    frameIdx: number, 
    /** Original frame size [width, height] */
    frameSize: [number, number], 
    /** Instances in this frame */
    instances: (Instance | PredictedInstance)[], 
    /** Skeleton edge connectivity as [srcIdx, dstIdx] pairs */
    skeletonEdges: [number, number][], 
    /** Node names from skeleton */
    nodeNames: string[], 
    /** Current scale factor */
    scale?: number, 
    /** Offset for cropped views [x, y] */
    offset?: [number, number]);
    /**
     * Transform world coordinates to canvas coordinates.
     */
    worldToCanvas(x: number, y: number): [number, number];
}
/**
 * Context passed to per-instance callbacks.
 */
declare class InstanceContext {
    /** The 2D canvas rendering context */
    readonly canvas: CanvasRenderingContext2D;
    /** Index of this instance within the frame */
    readonly instanceIdx: number;
    /** Keypoint coordinates as [[x0, y0], [x1, y1], ...] */
    readonly points: number[][];
    /** Skeleton edge connectivity */
    readonly skeletonEdges: [number, number][];
    /** Node names */
    readonly nodeNames: string[];
    /** Track ID (index in tracks array) */
    readonly trackIdx: number | null;
    /** Track name if available */
    readonly trackName: string | null;
    /** Instance confidence score */
    readonly confidence: number | null;
    /** Current scale factor */
    readonly scale: number;
    /** Offset for cropped views */
    readonly offset: [number, number];
    constructor(
    /** The 2D canvas rendering context */
    canvas: CanvasRenderingContext2D, 
    /** Index of this instance within the frame */
    instanceIdx: number, 
    /** Keypoint coordinates as [[x0, y0], [x1, y1], ...] */
    points: number[][], 
    /** Skeleton edge connectivity */
    skeletonEdges: [number, number][], 
    /** Node names */
    nodeNames: string[], 
    /** Track ID (index in tracks array) */
    trackIdx?: number | null, 
    /** Track name if available */
    trackName?: string | null, 
    /** Instance confidence score */
    confidence?: number | null, 
    /** Current scale factor */
    scale?: number, 
    /** Offset for cropped views */
    offset?: [number, number]);
    /**
     * Transform world coordinates to canvas coordinates.
     */
    worldToCanvas(x: number, y: number): [number, number];
    /**
     * Get centroid of valid (non-NaN) points.
     */
    getCentroid(): [number, number] | null;
    /**
     * Get bounding box of valid points.
     * Returns [x1, y1, x2, y2] or null if no valid points.
     */
    getBbox(): [number, number, number, number] | null;
}

/** RGB color as [r, g, b] with values 0-255 */
type RGB = [number, number, number];
/** RGBA color as [r, g, b, a] with values 0-255 */
type RGBA = [number, number, number, number];
/** Flexible color specification */
type ColorSpec = RGB | RGBA | string | number;
/** Available color schemes */
type ColorScheme = "track" | "instance" | "node" | "auto";
/** Built-in palette names */
type PaletteName = "standard" | "distinct" | "tableau10" | "viridis" | "rainbow" | "warm" | "cool" | "pastel" | "seaborn";
/** Marker shape types */
type MarkerShape = "circle" | "square" | "diamond" | "triangle" | "cross";
/** Render options for renderImage() */
interface RenderOptions {
    colorBy?: ColorScheme;
    palette?: PaletteName | string;
    markerShape?: MarkerShape;
    markerSize?: number;
    lineWidth?: number;
    alpha?: number;
    showNodes?: boolean;
    showEdges?: boolean;
    scale?: number;
    background?: "transparent" | ColorSpec;
    image?: ImageData | null;
    width?: number;
    height?: number;
    preRenderCallback?: (ctx: RenderContext) => void;
    postRenderCallback?: (ctx: RenderContext) => void;
    perInstanceCallback?: (ctx: InstanceContext) => void;
}
/** Video rendering options (extends RenderOptions) */
interface VideoOptions extends RenderOptions {
    frameInds?: number[];
    start?: number;
    end?: number;
    fps?: number;
    codec?: string;
    crf?: number;
    preset?: string;
    onProgress?: (current: number, total: number) => void;
}

/** Named CSS colors */
declare const NAMED_COLORS: Record<string, RGB>;
/** Built-in color palettes (port from Python sleap_io/rendering/colors.py) */
declare const PALETTES: Record<PaletteName, RGB[]>;
/**
 * Get n colors from a named palette, cycling if needed.
 */
declare function getPalette(name: PaletteName | string, n: number): RGB[];
/**
 * Resolve flexible color specification to RGB tuple.
 */
declare function resolveColor(color: ColorSpec): RGB;
/**
 * Convert RGB to CSS color string.
 */
declare function rgbToCSS(rgb: RGB, alpha?: number): string;
/**
 * Determine color scheme based on context.
 * - If tracks available: 'track'
 * - Else if single image: 'instance'
 * - Else: 'node' (prevents flicker in video)
 */
declare function determineColorScheme(scheme: ColorScheme, hasTracks: boolean, isSingleImage: boolean): ColorScheme;

type DrawMarkerFn = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fillColor: string, edgeColor?: string, edgeWidth?: number) => void;
/**
 * Draw a circle marker.
 */
declare function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fillColor: string, edgeColor?: string, edgeWidth?: number): void;
/**
 * Draw a square marker.
 */
declare function drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fillColor: string, edgeColor?: string, edgeWidth?: number): void;
/**
 * Draw a diamond marker (rotated square).
 */
declare function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fillColor: string, edgeColor?: string, edgeWidth?: number): void;
/**
 * Draw a triangle marker (pointing up).
 */
declare function drawTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fillColor: string, edgeColor?: string, edgeWidth?: number): void;
/**
 * Draw a cross/plus marker.
 */
declare function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fillColor: string, _edgeColor?: string, edgeWidth?: number): void;
/** Map of marker shape names to drawing functions */
declare const MARKER_FUNCTIONS: Record<MarkerShape, DrawMarkerFn>;
/**
 * Get the drawing function for a marker shape.
 */
declare function getMarkerFunction(shape: MarkerShape): DrawMarkerFn;

/**
 * Streaming SLP file reader using HTTP range requests.
 *
 * This module provides a streaming alternative to `readSlp` that uses
 * `StreamingH5File` for efficient range request-based file access.
 * Only the data actually needed is downloaded, rather than the entire file.
 *
 * @module
 */

/**
 * Options for streaming SLP file loading.
 */
interface StreamingSlpOptions {
    /** URL hint for h5wasm CDN */
    h5wasmUrl?: string;
    /** Filename hint for the HDF5 file */
    filenameHint?: string;
    /** Whether to open video backends for embedded videos (default: false) */
    openVideos?: boolean;
}
/**
 * Read an SLP file using a Web Worker for efficient, non-blocking HDF5 access.
 *
 * This function offloads all h5wasm operations to a Web Worker, keeping the
 * main thread responsive. For URLs, it uses HTTP range requests to download
 * only the data needed rather than the entire file.
 *
 * When `openVideos` is true, video backends are created for embedded videos,
 * allowing frame data to be retrieved. The underlying HDF5 file remains open
 * until all video backends are closed.
 *
 * @param source - URL, File, ArrayBuffer, or Uint8Array containing the SLP file
 * @param options - Optional settings
 * @returns Labels object with all annotation data
 *
 * @example
 * ```typescript
 * // Load from URL with video backends
 * const labels = await readSlpStreaming('https://example.com/labels.slp', {
 *   openVideos: true
 * });
 *
 * // Load from File object (file input)
 * const labels = await readSlpStreaming(fileInput.files[0], {
 *   openVideos: true
 * });
 *
 * // Load from ArrayBuffer
 * const labels = await readSlpStreaming(arrayBuffer, {
 *   filenameHint: 'data.slp'
 * });
 * ```
 */
declare function readSlpStreaming(source: StreamingH5Source, options?: StreamingSlpOptions): Promise<Labels>;

export { AnnotationType, BoundingBox, type BoundingBoxOptions, Camera, CameraGroup, type ColorScheme, type ColorSpec, FrameGroup, type GeoJSONFeature, type GeoJSONFeatureCollection, type Geometry, Identity, Instance, Instance3D, InstanceContext, InstanceGroup, LabelImage, type LabelImageObjectInfo, type LabelImageOptions, LabeledFrame, Labels, type LabelsDict, LabelsSet, LazyDataStore, LazyFrameList, MARKER_FUNCTIONS, type MarkerShape, type MediaBunnyOptions, MediaBunnyVideoBackend, Mp4BoxVideoBackend, NAMED_COLORS, PALETTES, type PaletteName, PredictedBoundingBox, PredictedInstance, PredictedInstance3D, PredictedLabelImage, PredictedROI, PredictedSegmentationMask, type RGB, type RGBA, ROI, type ROIOptions, RecordingSession, RenderContext, type RenderOptions, SegmentationMask, type SegmentationMaskOptions, Skeleton, StreamingH5File, type StreamingH5Source, StreamingHdf5VideoBackend, SuggestionFrame, Track, UserBoundingBox, UserLabelImage, UserROI, UserSegmentationMask, Video, type VideoBackend, type VideoBackendType, type VideoFrame, type VideoOptions, _registerMaskFactory, createVideoBackend, decodeRle, decodeWkb, decodeYamlSkeleton, determineColorScheme, drawCircle, drawCross, drawDiamond, drawSquare, drawTriangle, encodeRle, encodeWkb, encodeYamlSkeleton, fromDict, fromNumpy, getMarkerFunction, getPalette, isStreamingSupported, isTrainingConfig, labelsFromNumpy, loadSlp, loadSlpSet, loadVideo, makeCameraFromDict, normalizeLabelIds, openH5Worker, openStreamingH5, rasterizeGeometry, readGeoJSON, readSkeletonJson, readSlpStreaming, readTrainingConfigSkeleton, readTrainingConfigSkeletons, resizeNearest, resolveColor, rgbToCSS, rodriguesTransformation, roisFromGeoJSON, roisToGeoJSON, saveSlp, saveSlpSet, saveSlpToBytes, toDict, toNumpy, writeGeoJSON };
