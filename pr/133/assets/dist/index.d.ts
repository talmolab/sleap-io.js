import { Video, Labels, ROI, BoundingBox, LabeledFrame, LabelsSet, RenderOptions, VideoOptions } from './index.browser.js';
export { AUTO_VIDEO_MATCHER, AnnotationType, BASENAME_VIDEO_MATCHER, BoundingBoxOptions, CENTROID_SKELETON, Camera, CameraGroup, Centroid, CentroidOptions, ColorScheme, ColorSpec, ConflictResolution, DUPLICATE_MATCHER, ErrorMode, FrameGroup, FrameStrategy, FsResolver, GeoJSONFeature, GeoJSONFeatureCollection, Geometry, IDENTITY_INSTANCE_MATCHER, IDENTITY_TRACK_MATCHER, IMAGE_DEDUP_VIDEO_MATCHER, IOU_MATCHER, Identity, Instance3D, InstanceContext, InstanceGroup, InstanceMatchMethod, InstanceMatcher, LabelImage, LabelImageObjectInfo, LabelImageOptions, LabelsDict, LazyDataStore, LazyFrameList, MARKER_FUNCTIONS, MarkerShape, MatchResult, MediaBunnyOptions, MediaBunnyVideoBackend, MergeError, MergeProgressBar, MergeResult, MergeStrategy, Mp4BoxVideoBackend, NAMED_COLORS, NAME_TRACK_MATCHER, OVERLAP_SKELETON_MATCHER, PALETTES, PATH_VIDEO_MATCHER, PaletteName, PredictedBoundingBox, PredictedCentroid, PredictedInstance3D, PredictedLabelImage, PredictedROI, PredictedSegmentationMask, RGB, RGBA, ROIOptions, RecordingSession, RenderContext, SHAPE_VIDEO_MATCHER, STRUCTURE_SKELETON_MATCHER, SUBSET_SKELETON_MATCHER, SegmentationMask, SegmentationMaskOptions, SkeletonMatchMethod, SkeletonMatcher, SkeletonMismatchError, StreamingH5File, StreamingH5Source, StreamingHdf5VideoBackend, SuggestionFrame, TrackMatchMethod, TrackMatcher, UserBoundingBox, UserCentroid, UserLabelImage, UserROI, UserSegmentationMask, VideoBackend, VideoBackendType, VideoFrame, VideoMatchMethod, VideoMatcher, _annotationCentroidXy, _findAnnotationMatches, _registerMaskFactory, _resolveMergedIsNegative, createVideoBackend, decodeRle, decodeWkb, decodeYamlSkeleton, determineColorScheme, drawCircle, drawCross, drawDiamond, drawSquare, drawTriangle, encodeRle, encodeWkb, encodeYamlSkeleton, fromDict, fromNumpy, getCentroidSkeleton, getMarkerFunction, getPalette, isAnalysisH5File, isStreamingSupported, isTrainingConfig, labelsFromNumpy, loadAnalysisH5, loadSlp, loadSlpSet, loadVideo, makeCameraFromDict, normalizeLabelIds, openH5Worker, openStreamingH5, rasterizeGeometry, readGeoJSON, readSkeletonJson, readSlpStreaming, readTrainingConfigSkeleton, readTrainingConfigSkeletons, resizeNearest, resolveColor, rgbToCSS, rodriguesTransformation, roisFromGeoJSON, roisToGeoJSON, saveAnalysisH5, saveSlp, saveSlpSet, saveSlpToBytes, setFsResolver, toDict, toNumpy, writeGeoJSON } from './index.browser.js';
import { I as Instance, S as Skeleton, P as PredictedInstance } from './instance-DLj547bw.js';
export { E as Edge, N as Node, k as NodeOrIndex, b as Point, d as PointsArray, c as PredictedPoint, e as PredictedPointsArray, a as Symmetry, T as Track, _ as _registerCentroidFactory, p as pointsEmpty, g as pointsFromArray, i as pointsFromDict, f as predictedPointsEmpty, h as predictedPointsFromArray, j as predictedPointsFromDict } from './instance-DLj547bw.js';

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
 * Ultralytics YOLO format I/O (detection + segmentation + pose).
 *
 * This is a TypeScript port of `sleap_io/io/ultralytics.py` (Python sleap-io
 * v0.7.x, PR #395), adapted to the JS/Node data model and runtime.
 *
 * Ultralytics YOLO format specification:
 * - Directory structure: `dataset_root/<split>/images/` and
 *   `dataset_root/<split>/labels/`.
 * - Configuration: a `data.yaml` file defining dataset structure.
 * - Supported tasks (auto-detected per label line by value count):
 *   - **Pose**: `class_id x_center y_center width height x1 y1 v1 ... xn yn vn`
 *     (5 + 3k values) → {@link Instance}.
 *   - **Detection**: `class_id x_center y_center width height [confidence]`
 *     (5 or 6 values) → {@link UserBoundingBox} / {@link PredictedBoundingBox}.
 *   - **Segmentation**: `class_id x1 y1 x2 y2 ... xn yn` (polygon) →
 *     {@link UserROI}.
 * - Coordinates: normalized to `[0, 1]`, origin at top-left.
 * - Visibility (pose only): `0` = not visible, `1` = visible but occluded,
 *   `2` = visible and not occluded.
 *
 * Node-only: datasets are directory trees of many files, so this module reads
 * and writes through the Node `fs`/`path` APIs (like `io/trackmate.ts`) and is
 * exported only from the Node entry point (`src/index.ts`), never the browser
 * bundle.
 *
 * ## Image I/O divergence from Python
 *
 * Python uses `imageio` to read image dimensions and to extract/encode video
 * frames. JS/Node has no equivalent always-available image codec, so:
 *
 * - **Reading**: image dimensions are obtained by parsing the image file header
 *   ({@link probeImageSize}, supporting PNG/JPEG/GIF/BMP/TIFF) rather than
 *   decoding the pixels. Falls back to the `imageSize` option when probing
 *   fails.
 * - **Writing**: when a frame is backed by an on-disk image file, the file is
 *   **copied verbatim** (preserving its encoding and extension); when a frame
 *   yields raw `ImageData`-shaped pixels (`{ data, width, height }`), it is
 *   encoded to PNG via `pako`; otherwise the frame is skipped with a warning
 *   (mirroring Python's "could not load frame → skip" behavior). The
 *   `imageFormat`/`imageQuality` options apply only to the raw-pixel PNG path.
 */

/** Image dimensions as `[height, width]` in pixels. */
type ImageShape = [number, number];
/** Auto-detected YOLO annotation format for a single label line. */
type LineFormat = "detection" | "detection_conf" | "segmentation" | "pose";
/** Result of {@link parseLabelFile}: the 3-tuple of parsed annotations. */
interface ParsedLabelFile {
    instances: Instance[];
    rois: ROI[];
    bboxes: BoundingBox[];
}
/** Parse an Ultralytics `data.yaml` configuration file. */
declare function parseDataYaml(yamlPath: string): Record<string, unknown>;
/**
 * Build a class-id → category-name map from a parsed data.yaml `names` field.
 *
 * Accepts either a YAML list (`names: [cat, dog]`) or a mapping
 * (`names: {0: cat, 1: dog}`). Keys are coerced to integers so lookups work
 * regardless of how the YAML parser represented numeric keys.
 */
declare function classNamesFromConfig(config: Record<string, unknown>): Map<number, string>;
/** Create a {@link Skeleton} from an Ultralytics configuration object. */
declare function createSkeletonFromConfig(config: Record<string, unknown>): Skeleton;
/**
 * Detect the YOLO annotation format from a single line's parsed values.
 *
 * - **5 values** → `"detection"`
 * - **6 values** → `"detection_conf"`
 * - **5 + 3k values** → `"pose"`
 * - **even count > 5 with `(n - 1)` even** → `"segmentation"`
 * - otherwise → `"pose"`
 */
declare function detectLineFormat(parts: string[]): LineFormat;
/**
 * Normalize an instance's point coordinates to the `[0, 1]` range.
 *
 * @returns One `[xNorm, yNorm, visibility]` triple per point, where
 *   `visibility` is `2` for visible points and `0` for invisible/NaN points.
 */
declare function normalizeCoordinates(instance: Instance, imageShape: ImageShape): Array<[number, number, number]>;
/**
 * Denormalize coordinates from the `[0, 1]` range back to pixel coordinates.
 *
 * @returns One `[x, y, visible]` row per point. Invisible points (visibility
 *   `0`) become `[NaN, NaN, 0]`; visible points become `[xPx, yPx, 1]`.
 */
declare function denormalizeCoordinates(normalizedPoints: Array<[number, number, number]>, imageShape: ImageShape): number[][];
/** Options for {@link parseLabelFile}. */
interface ParseLabelFileOptions {
    /** Class-id → category-name mapping for category assignment. */
    classNames?: Map<number, string>;
    /** Video to associate with ROIs / bounding boxes (currently unused field). */
    video?: Video | null;
    /** Frame index for ROIs / bounding boxes. Defaults to 0. */
    frameIdx?: number;
}
/**
 * Parse a single Ultralytics label file into instances, ROIs, and bounding
 * boxes.
 *
 * The format is auto-detected per line via {@link detectLineFormat}:
 *
 * - **5 values** → {@link UserBoundingBox}
 * - **6 values** → {@link PredictedBoundingBox}
 * - **5 + 3k values** → {@link Instance} (pose)
 * - **segmentation polygon** → {@link UserROI}
 *
 * @param labelPath - Path to the `.txt` label file.
 * @param skeleton - Skeleton to use for pose instances.
 * @param imageShape - Image dimensions `[height, width]` for denormalization.
 * @param options - Optional category mapping / video / frame index.
 * @returns `{ instances, rois, bboxes }` parsed from the file.
 */
declare function parseLabelFile(labelPath: string, skeleton: Skeleton, imageShape: ImageShape, options?: ParseLabelFileOptions): ParsedLabelFile;
/**
 * Write a single Ultralytics **pose** label file for a frame.
 *
 * Each instance becomes a line `class_id x_center y_center width height` (a
 * 10px-padded bounding box over visible keypoints, normalized) followed by
 * `x y v` triples per keypoint. Instances whose point count does not match the
 * skeleton, or that have no visible points, are skipped.
 */
declare function writeLabelFile(labelPath: string, frame: LabeledFrame, skeleton: Skeleton, imageShape: ImageShape, classId?: number): void;
/**
 * Write a single Ultralytics label file for detection/segmentation ROIs.
 *
 * Multi-geometries are exploded so each polygon gets its own line. Polygon
 * ROIs are written as segmentation lines (normalized exterior vertices); ROIs
 * that are axis-aligned rectangles are written as detection bounding boxes.
 * Interior rings (holes) are dropped with a warning (YOLO segmentation has no
 * hole support).
 */
declare function writeRoiLabelFile(labelPath: string, rois: ROI[], imageShape: ImageShape, nameToId: Map<string, number>): void;
/**
 * Write a single Ultralytics label file for detection bounding boxes.
 *
 * {@link UserBoundingBox} → 5 values; {@link PredictedBoundingBox} → 6 values
 * (the trailing value is the confidence score).
 */
declare function writeBboxLabelFile(labelPath: string, bboxes: BoundingBox[], imageShape: ImageShape, nameToId: Map<string, number>): void;
/** Options for {@link createDataYaml}. */
interface CreateDataYamlOptions {
    /** YOLO task type. One of `"pose"` (default), `"detect"`, or `"segment"`. */
    task?: string;
    /** Class-id → category-name mapping. Defaults to `{ 0: "animal" }`. */
    classNames?: Map<number, string>;
}
/**
 * Create an Ultralytics `data.yaml` configuration file.
 *
 * For pose tasks, writes `kpt_shape`, `flip_idx`, `skeleton`, and `node_names`
 * derived from the skeleton. For detection/segmentation, writes the `task` key.
 */
declare function createDataYaml(yamlPath: string, skeleton: Skeleton | null, splitRatios: Record<string, number>, options?: CreateDataYamlOptions): void;
/** Build a class-id → name map from the distinct, sorted ROI categories. */
declare function buildClassNamesFromRois(rois: ROI[]): Map<number, string>;
/** Build a class-id → name map from the distinct, sorted bbox categories. */
declare function buildClassNamesFromBboxes(bboxes: BoundingBox[]): Map<number, string>;
/** Options for {@link readLabels}. */
interface ReadLabelsOptions {
    /** Dataset split to read (`"train"`, `"val"`, `"test"`, ...). Default `"train"`. */
    split?: string;
    /** Skeleton to use. If omitted, inferred from `data.yaml` (pose only). */
    skeleton?: Skeleton | null;
    /** Fallback image size `[height, width]` if header probing fails. Default `[480, 640]`. */
    imageSize?: ImageShape;
}
/**
 * Read an Ultralytics YOLO dataset into a {@link Labels} object.
 *
 * Automatically detects the annotation format (pose / detection / segmentation)
 * per label line. Pose lines become instances; detection lines become bounding
 * boxes; segmentation lines become ROIs.
 *
 * @param datasetPath - Path to the dataset root (containing `data.yaml`) or to
 *   the `data.yaml` file itself.
 * @param options - Optional split / skeleton / fallback image size.
 */
declare function readLabels(datasetPath: string, options?: ReadLabelsOptions): Labels;
/** Options for {@link readLabelsSet}. */
interface ReadLabelsSetOptions {
    /** Splits to load. If omitted, auto-detects `train`/`val`/`test`/`valid`. */
    splits?: string[];
    /** Skeleton to use. If omitted, inferred from `data.yaml`. */
    skeleton?: Skeleton | null;
    /** Fallback image size `[height, width]` if header probing fails. */
    imageSize?: ImageShape;
}
/**
 * Read multiple splits from an Ultralytics dataset as a {@link LabelsSet}.
 *
 * @param datasetPath - Path to the dataset root directory.
 * @param options - Optional splits / skeleton / fallback image size.
 */
declare function readLabelsSet(datasetPath: string, options?: ReadLabelsSetOptions): LabelsSet;
/** Options for {@link writeLabels}. */
interface WriteLabelsOptions {
    /** Split-name → ratio mapping (must sum to 1.0). Default `{ train: 0.8, val: 0.2 }`. */
    splitRatios?: Record<string, number>;
    /** Class ID to use for all pose instances. Default `0`. */
    classId?: number;
    /** Image format for raw-pixel frames (`"png"` default, lossless). */
    imageFormat?: string;
    /** PNG compression level (0–9) for raw-pixel frames. */
    imageQuality?: number | null;
    /** Show progress logging. Default `true`. */
    verbose?: boolean;
    /** YOLO task type: `"pose"` (default), `"detect"`, or `"segment"`. */
    task?: string;
}
/**
 * Write a {@link Labels} object to an Ultralytics YOLO dataset on disk.
 *
 * For `"pose"`, writes images + pose label files per labeled frame. For
 * `"detect"` and `"segment"`, writes bounding boxes / ROIs from the Labels
 * object instead of pose instances.
 *
 * See the module-level "Image I/O divergence" note for how frame images are
 * obtained (on-disk copy, raw-pixel PNG encode, or skip-with-warning).
 *
 * @param labels - Labels to export.
 * @param datasetPath - Output dataset root directory.
 * @param options - Export options (see {@link WriteLabelsOptions}).
 */
declare function writeLabels(labels: Labels, datasetPath: string, options?: WriteLabelsOptions): Promise<void>;
/**
 * Build dataset splits from a Labels object.
 *
 * - **Two splits**: a single fractional {@link Labels#split} (`split1`/`split2`).
 * - **Three splits**: mirrors Python `Labels.make_training_splits` — splits in
 *   `train → test → val` order, recomputing each later fraction relative to the
 *   original total and the current remainder so the per-split counts match the
 *   Python writer. (JS Labels has no `makeTrainingSplits`, so the algorithm is
 *   inlined here; unlike Python it does not pre-clean predictions, leaving the
 *   caller's frames untouched.)
 */
declare function createSplitsFromLabels(labels: Labels, splitRatios: Record<string, number>): Record<string, Labels>;
/**
 * Load an Ultralytics YOLO dataset into a {@link Labels} object.
 *
 * Convenience wrapper around {@link readLabels}.
 *
 * @param datasetPath - Path to the dataset root or its `data.yaml` file.
 * @param options - Optional split / skeleton / fallback image size.
 */
declare function loadUltralytics(datasetPath: string, options?: ReadLabelsOptions): Labels;
/**
 * Save a {@link Labels} object to an Ultralytics YOLO dataset on disk.
 *
 * Convenience wrapper around {@link writeLabels}.
 *
 * @param labels - Labels to export.
 * @param datasetPath - Output dataset root directory.
 * @param options - Export options (see {@link WriteLabelsOptions}).
 */
declare function saveUltralytics(labels: Labels, datasetPath: string, options?: WriteLabelsOptions): Promise<void>;
/**
 * Probe an image file's `[height, width]` from its header, without decoding
 * pixels. Supports PNG, JPEG, GIF, BMP, and TIFF. Returns `null` if the
 * dimensions cannot be determined.
 */
declare function probeImageSize(filePath: string): ImageShape | null;
/**
 * Encode RGBA pixels to a PNG byte stream using `pako` for the zlib stream.
 *
 * @param rgba - Row-major RGBA bytes (length `width * height * 4`).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param compressLevel - zlib compression level 0–9 (default 6).
 */
declare function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, compressLevel?: number | null): Uint8Array;

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

export { BoundingBox, type CreateDataYamlOptions, type ImageShape, Instance, LabeledFrame, Labels, LabelsSet, type LineFormat, type ParseLabelFileOptions, type ParsedLabelFile, PredictedInstance, ROI, type ReadLabelsOptions, type ReadLabelsSetOptions, RenderOptions, Skeleton, type TrackMateOptions, Video, VideoOptions, type WriteLabelsOptions, buildClassNamesFromBboxes, buildClassNamesFromRois, checkFfmpeg, classNamesFromConfig, createDataYaml, createSkeletonFromConfig, createSplitsFromLabels, denormalizeCoordinates, detectLineFormat, encodePng, isTrackMateFile, loadTrackMate, loadUltralytics, normalizeCoordinates, parseDataYaml, parseLabelFile, probeImageSize, readLabels, readLabelsSet, readTrackMateCsv, renderImage, renderVideo, saveImage, saveUltralytics, toDataURL, toJPEG, toPNG, writeBboxLabelFile, writeLabelFile, writeLabels, writeRoiLabelFile };
