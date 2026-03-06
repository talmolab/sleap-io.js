import { Video, Labels, LabeledFrame, RenderOptions, VideoOptions } from './index.browser.js';
export { Camera, CameraGroup, ColorScheme, ColorSpec, FrameGroup, InstanceContext, InstanceGroup, LabelsDict, LabelsSet, LazyDataStore, LazyFrameList, MARKER_FUNCTIONS, MarkerShape, Mp4BoxVideoBackend, NAMED_COLORS, PALETTES, PaletteName, RGB, RGBA, RecordingSession, RenderContext, StreamingH5File, StreamingH5Source, StreamingHdf5VideoBackend, SuggestionFrame, VideoBackend, VideoFrame, decodeYamlSkeleton, determineColorScheme, drawCircle, drawCross, drawDiamond, drawSquare, drawTriangle, encodeYamlSkeleton, fromDict, fromNumpy, getMarkerFunction, getPalette, isStreamingSupported, isTrainingConfig, labelsFromNumpy, loadSlp, loadSlpSet, loadVideo, makeCameraFromDict, openH5Worker, openStreamingH5, readSkeletonJson, readSlpStreaming, readTrainingConfigSkeleton, readTrainingConfigSkeletons, resolveColor, rgbToCSS, rodriguesTransformation, saveSlp, saveSlpSet, saveSlpToBytes, toDict, toNumpy } from './index.browser.js';
import { T as Track, I as Instance, P as PredictedInstance } from './instance-CCNYsiwF.js';
export { E as Edge, N as Node, k as NodeOrIndex, b as Point, d as PointsArray, c as PredictedPoint, e as PredictedPointsArray, S as Skeleton, a as Symmetry, p as pointsEmpty, g as pointsFromArray, i as pointsFromDict, f as predictedPointsEmpty, h as predictedPointsFromArray, j as predictedPointsFromDict } from './instance-CCNYsiwF.js';

type MaskFactory = (mask: Uint8Array, height: number, width: number, options: Record<string, unknown>) => unknown;
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
};
declare class ROI {
    geometry: Geometry;
    annotationType: AnnotationType;
    name: string;
    category: string;
    score: number | null;
    source: string;
    video: Video | null;
    frameIdx: number | null;
    track: Track | null;
    instance: Instance | null;
    constructor(options: {
        geometry: Geometry;
        annotationType?: AnnotationType | number;
        name?: string;
        category?: string;
        score?: number | null;
        source?: string;
        video?: Video | null;
        frameIdx?: number | null;
        track?: Track | null;
        instance?: Instance | null;
    });
    static fromBbox(x: number, y: number, width: number, height: number, options?: Omit<ConstructorParameters<typeof ROI>[0], "geometry">): ROI;
    static fromXyxy(x1: number, y1: number, x2: number, y2: number, options?: Omit<ConstructorParameters<typeof ROI>[0], "geometry">): ROI;
    static fromPolygon(coords: number[][], options?: Omit<ConstructorParameters<typeof ROI>[0], "geometry">): ROI;
    get isPredicted(): boolean;
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
    toMask(height: number, width: number): unknown;
    private _allPoints;
}
declare function rasterizeGeometry(geometry: Geometry, height: number, width: number): Uint8Array;
declare function encodeWkb(geometry: Geometry): Uint8Array;
declare function decodeWkb(bytes: Uint8Array): Geometry;

declare function encodeRle(mask: Uint8Array, height: number, width: number): Uint32Array;
declare function decodeRle(rleCounts: Uint32Array, height: number, width: number): Uint8Array;
declare class SegmentationMask {
    rleCounts: Uint32Array;
    height: number;
    width: number;
    annotationType: AnnotationType;
    name: string;
    category: string;
    score: number | null;
    source: string;
    video: Video | null;
    frameIdx: number | null;
    track: Track | null;
    instance: Instance | null;
    constructor(options: {
        rleCounts: Uint32Array;
        height: number;
        width: number;
        annotationType?: AnnotationType | number;
        name?: string;
        category?: string;
        score?: number | null;
        source?: string;
        video?: Video | null;
        frameIdx?: number | null;
        track?: Track | null;
        instance?: Instance | null;
    });
    static fromArray(mask: Uint8Array | boolean[][], height: number, width: number, options?: Omit<ConstructorParameters<typeof SegmentationMask>[0], "rleCounts" | "height" | "width">): SegmentationMask;
    get data(): Uint8Array;
    get area(): number;
    get bbox(): {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    toPolygon(): ROI;
}

/**
 * Render poses on a single frame.
 *
 * @param source - Labels, LabeledFrame, or array of Instances to render
 * @param options - Rendering options
 * @returns ImageData with rendered poses
 */
declare function renderImage(source: Labels | LabeledFrame | (Instance | PredictedInstance)[], options?: RenderOptions): Promise<ImageData>;
/**
 * Convert ImageData to PNG buffer (Node.js only).
 */
declare function toPNG(imageData: ImageData): Promise<Buffer>;
/**
 * Convert ImageData to JPEG buffer (Node.js only).
 */
declare function toJPEG(imageData: ImageData, quality?: number): Promise<Buffer>;
/**
 * Convert ImageData to data URL.
 */
declare function toDataURL(imageData: ImageData, format?: "png" | "jpeg"): Promise<string>;
/**
 * Save ImageData to a file.
 */
declare function saveImage(imageData: ImageData, path: string): Promise<void>;

/**
 * Check if ffmpeg is available in PATH.
 */
declare function checkFfmpeg(): Promise<boolean>;
/**
 * Render video with pose overlays.
 * Requires ffmpeg to be installed and in PATH.
 *
 * @param source - Labels or array of LabeledFrames to render
 * @param outputPath - Path to save the output video
 * @param options - Video rendering options
 */
declare function renderVideo(source: Labels | LabeledFrame[], outputPath: string, options?: VideoOptions): Promise<void>;

export { AnnotationType, type Geometry, Instance, LabeledFrame, Labels, PredictedInstance, ROI, RenderOptions, SegmentationMask, Track, Video, VideoOptions, _registerMaskFactory, checkFfmpeg, decodeRle, decodeWkb, encodeRle, encodeWkb, rasterizeGeometry, renderImage, renderVideo, saveImage, toDataURL, toJPEG, toPNG };
