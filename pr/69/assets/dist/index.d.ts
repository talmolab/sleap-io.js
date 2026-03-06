import { L as Labels, a as LabeledFrame, R as RenderOptions, V as VideoOptions } from './index.browser-DmCrg5tB.js';
export { A as AnnotationType, C as Camera, h as CameraGroup, a3 as ColorScheme, a2 as ColorSpec, F as FrameGroup, G as Geometry, ak as InstanceContext, I as InstanceGroup, K as LabelsDict, f as LabelsSet, k as LazyDataStore, l as LazyFrameList, ai as MARKER_FUNCTIONS, a5 as MarkerShape, M as Mp4BoxVideoBackend, a6 as NAMED_COLORS, a7 as PALETTES, a4 as PaletteName, a0 as RGB, a1 as RGBA, n as ROI, j as RecordingSession, aj as RenderContext, v as SegmentationMask, S as StreamingH5File, c as StreamingH5Source, y as StreamingHdf5VideoBackend, e as SuggestionFrame, d as Video, x as VideoBackend, w as VideoFrame, _ as _registerMaskFactory, u as decodeRle, s as decodeWkb, U as decodeYamlSkeleton, ab as determineColorScheme, ac as drawCircle, ag as drawCross, ae as drawDiamond, ad as drawSquare, af as drawTriangle, t as encodeRle, q as encodeWkb, W as encodeYamlSkeleton, O as fromDict, Q as fromNumpy, ah as getMarkerFunction, a8 as getPalette, i as isStreamingSupported, $ as isTrainingConfig, T as labelsFromNumpy, z as loadSlp, D as loadSlpSet, H as loadVideo, m as makeCameraFromDict, b as openH5Worker, o as openStreamingH5, p as rasterizeGeometry, X as readSkeletonJson, r as readSlpStreaming, Z as readTrainingConfigSkeleton, Y as readTrainingConfigSkeletons, a9 as resolveColor, aa as rgbToCSS, g as rodriguesTransformation, B as saveSlp, E as saveSlpSet, J as saveSlpToBytes, N as toDict, P as toNumpy } from './index.browser-DmCrg5tB.js';
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
