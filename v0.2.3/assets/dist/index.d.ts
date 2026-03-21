import { Labels, LabeledFrame, RenderOptions, VideoOptions } from './index.browser.js';
export { AnnotationType, BoundingBox, BoundingBoxOptions, Camera, CameraGroup, ColorScheme, ColorSpec, FrameGroup, GeoJSONFeature, GeoJSONFeatureCollection, Geometry, InstanceContext, InstanceGroup, LabelsDict, LabelsSet, LazyDataStore, LazyFrameList, MARKER_FUNCTIONS, MarkerShape, MediaBunnyOptions, MediaBunnyVideoBackend, Mp4BoxVideoBackend, NAMED_COLORS, PALETTES, PaletteName, PredictedBoundingBox, RGB, RGBA, ROI, RecordingSession, RenderContext, SegmentationMask, StreamingH5File, StreamingH5Source, StreamingHdf5VideoBackend, SuggestionFrame, UserBoundingBox, Video, VideoBackend, VideoBackendType, VideoFrame, _registerMaskFactory, createVideoBackend, decodeRle, decodeWkb, decodeYamlSkeleton, determineColorScheme, drawCircle, drawCross, drawDiamond, drawSquare, drawTriangle, encodeRle, encodeWkb, encodeYamlSkeleton, fromDict, fromNumpy, getMarkerFunction, getPalette, isStreamingSupported, isTrainingConfig, labelsFromNumpy, loadSlp, loadSlpSet, loadVideo, makeCameraFromDict, openH5Worker, openStreamingH5, rasterizeGeometry, readGeoJSON, readSkeletonJson, readSlpStreaming, readTrainingConfigSkeleton, readTrainingConfigSkeletons, resolveColor, rgbToCSS, rodriguesTransformation, roisFromGeoJSON, roisToGeoJSON, saveSlp, saveSlpSet, saveSlpToBytes, toDict, toNumpy, writeGeoJSON } from './index.browser.js';
import { I as Instance, P as PredictedInstance } from './instance-BmOdR704.js';
export { E as Edge, N as Node, j as NodeOrIndex, a as Point, c as PointsArray, b as PredictedPoint, d as PredictedPointsArray, k as Skeleton, S as Symmetry, T as Track, p as pointsEmpty, f as pointsFromArray, h as pointsFromDict, e as predictedPointsEmpty, g as predictedPointsFromArray, i as predictedPointsFromDict } from './instance-BmOdR704.js';

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

export { Instance, LabeledFrame, Labels, PredictedInstance, RenderOptions, VideoOptions, checkFfmpeg, renderImage, renderVideo, saveImage, toDataURL, toJPEG, toPNG };
