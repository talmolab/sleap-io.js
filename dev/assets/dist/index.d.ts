import { Video, Labels, LabeledFrame, RenderOptions, VideoOptions } from './index.browser.js';
export { AUTO_VIDEO_MATCHER, AnnotationType, BASENAME_VIDEO_MATCHER, BoundingBox, BoundingBoxOptions, CENTROID_SKELETON, Camera, CameraGroup, Centroid, CentroidOptions, ColorScheme, ColorSpec, ConflictResolution, DUPLICATE_MATCHER, ErrorMode, FrameGroup, FrameStrategy, FsResolver, GeoJSONFeature, GeoJSONFeatureCollection, Geometry, IDENTITY_INSTANCE_MATCHER, IDENTITY_TRACK_MATCHER, IMAGE_DEDUP_VIDEO_MATCHER, IOU_MATCHER, Identity, Instance3D, InstanceContext, InstanceGroup, InstanceMatchMethod, InstanceMatcher, LabelImage, LabelImageObjectInfo, LabelImageOptions, LabelsDict, LabelsSet, LazyDataStore, LazyFrameList, MARKER_FUNCTIONS, MarkerShape, MatchResult, MediaBunnyOptions, MediaBunnyVideoBackend, MergeError, MergeProgressBar, MergeResult, MergeStrategy, Mp4BoxVideoBackend, NAMED_COLORS, NAME_TRACK_MATCHER, OVERLAP_SKELETON_MATCHER, PALETTES, PATH_VIDEO_MATCHER, PaletteName, PredictedBoundingBox, PredictedCentroid, PredictedInstance3D, PredictedLabelImage, PredictedROI, PredictedSegmentationMask, RGB, RGBA, ROI, ROIOptions, RecordingSession, RenderContext, SHAPE_VIDEO_MATCHER, STRUCTURE_SKELETON_MATCHER, SUBSET_SKELETON_MATCHER, SegmentationMask, SegmentationMaskOptions, SkeletonMatchMethod, SkeletonMatcher, SkeletonMismatchError, StreamingH5File, StreamingH5Source, StreamingHdf5VideoBackend, SuggestionFrame, TrackMatchMethod, TrackMatcher, UserBoundingBox, UserCentroid, UserLabelImage, UserROI, UserSegmentationMask, VideoBackend, VideoBackendType, VideoFrame, VideoMatchMethod, VideoMatcher, _annotationCentroidXy, _findAnnotationMatches, _registerMaskFactory, _resolveMergedIsNegative, createVideoBackend, decodeRle, decodeWkb, decodeYamlSkeleton, determineColorScheme, drawCircle, drawCross, drawDiamond, drawSquare, drawTriangle, encodeRle, encodeWkb, encodeYamlSkeleton, fromDict, fromNumpy, getCentroidSkeleton, getMarkerFunction, getPalette, isStreamingSupported, isTrainingConfig, labelsFromNumpy, loadSlp, loadSlpSet, loadVideo, makeCameraFromDict, normalizeLabelIds, openH5Worker, openStreamingH5, rasterizeGeometry, readGeoJSON, readSkeletonJson, readSlpStreaming, readTrainingConfigSkeleton, readTrainingConfigSkeletons, resizeNearest, resolveColor, rgbToCSS, rodriguesTransformation, roisFromGeoJSON, roisToGeoJSON, saveSlp, saveSlpSet, saveSlpToBytes, setFsResolver, toDict, toNumpy, writeGeoJSON } from './index.browser.js';
import { I as Instance, P as PredictedInstance } from './instance-DM1Nsppv.js';
export { E as Edge, N as Node, j as NodeOrIndex, a as Point, c as PointsArray, b as PredictedPoint, d as PredictedPointsArray, k as Skeleton, S as Symmetry, T as Track, _ as _registerCentroidFactory, p as pointsEmpty, f as pointsFromArray, h as pointsFromDict, e as predictedPointsEmpty, g as predictedPointsFromArray, i as predictedPointsFromDict } from './instance-DM1Nsppv.js';

/**
 * Read TrackMate CSV exports into sleap-io data structures.
 *
 * TrackMate (ImageJ/Fiji) exports tracking results as CSV files:
 * - `*_spots.csv` - Individual spot detections (required).
 * - `*_edges.csv` - Frame-to-frame linkages with assignment cost (optional).
 *
 * All CSVs have 4 header rows (field names, descriptions, abbreviations,
 * units) followed by data rows.
 */

/** Options for loading TrackMate CSV files. */
interface TrackMateOptions {
    /** Path to the edges CSV file. Auto-detected if not given. */
    edgesPath?: string;
    /** Video to associate with centroids. Can be a Video object or file path. */
    video?: Video | string;
}
/**
 * Check if a CSV file is a TrackMate spots export.
 *
 * Reads the first line and checks for the TrackMate column signature.
 */
declare function isTrackMateFile(filePath: string): boolean;
/**
 * Load TrackMate CSV exports into a Labels object.
 *
 * The spots CSV is required. The edges CSV is optional but provides
 * per-link `trackingScore` (from TrackMate's `LINK_COST`).
 *
 * @param spotsPath - Path to the `*_spots.csv` file.
 * @param options - Optional loading settings.
 * @returns A Labels object with centroids, tracks, and optionally videos.
 */
declare function readTrackMateCsv(spotsPath: string, options?: TrackMateOptions): Labels;
/**
 * Load TrackMate CSV exports and return a Labels object.
 *
 * Public API wrapper for readTrackMateCsv.
 *
 * @param filename - Path to the TrackMate spots CSV file.
 * @param options - Optional loading settings.
 * @returns Labels with centroids from TrackMate data.
 */
declare function loadTrackMate(filename: string, options?: TrackMateOptions): Labels;

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

export { Instance, LabeledFrame, Labels, PredictedInstance, RenderOptions, type TrackMateOptions, Video, VideoOptions, checkFfmpeg, isTrackMateFile, loadTrackMate, readTrackMateCsv, renderImage, renderVideo, saveImage, toDataURL, toJPEG, toPNG };
