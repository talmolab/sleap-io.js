import { V as Video, L as Labels, R as ROI, B as BoundingBox, a as LabeledFrame, b as LabelsSet, c as ReadCocoOptions, U as UserROI, d as RenderOptions, e as VideoOptions, f as RGB, g as LabelImage, h as RawLabelImage, S as SegmentationMask, P as PaletteName } from './index.browser-S8Yz42ID.js';
export { a9 as AUTO_VIDEO_MATCHER, aF as AnnotationType, ab as BASENAME_VIDEO_MATCHER, m as BlobByteSource, aV as BoundingBoxOptions, n as ByteSource, aZ as CENTROID_SKELETON, bw as CLOUD_SCHEMES, at as Camera, au as CameraGroup, a$ as Centroid, a_ as CentroidOptions, b_ as CocoAnnotation, bW as CocoCategory, bX as CocoImage, b$ as CocoJson, bY as CocoRle, bZ as CocoSegmentation, co as ColorScheme, cn as ColorSpec, X as ConflictResolution, an as CropOptions, cT as CropRect, C as CropVideoBackend, r as CropWrapOptions, D as DEFAULT_MAX_BYTES, a4 as DUPLICATE_MATCHER, cG as DrawTrailsOptions, am as EXISTS_TTL_MS, M as ErrorMode, cZ as Fill, cU as FlatPoints, aw as FrameGroup, cX as FrameLike, K as FrameStrategy, af as FsResolver, bx as GDRIVE_HOSTS, bQ as GeoJSONFeature, bR as GeoJSONFeatureCollection, aG as Geometry, b8 as GetFrameOptions, a6 as IDENTITY_INSTANCE_MATCHER, a8 as IDENTITY_TRACK_MATCHER, ac as IMAGE_DEDUP_VIDEO_MATCHER, a5 as IOU_MATCHER, az as Identity, I as ImageBytesReader, bg as ImageVideoBackend, be as ImageVideoOptions, aA as Instance3D, cO as InstanceContext, av as InstanceGroup, H as InstanceMatchMethod, O as InstanceMatcher, bs as LabelImageFileReader, b2 as LabelImageObjectInfo, b3 as LabelImageOptions, c9 as LabelsDict, aC as LazyDataStore, aD as LazyFrameList, br as LoadLabelImagesOptions, cF as MARKER_FUNCTIONS, cp as MarkerShape, $ as MatchResult, bb as MediaBunnyOptions, bc as MediaBunnyVideoBackend, Y as MergeError, a0 as MergeProgressBar, _ as MergeResult, ag as MergeStrategy, ba as Mp4BoxVideoBackend, cs as NAMED_COLORS, a7 as NAME_TRACK_MATCHER, a3 as OVERLAP_SKELETON_MATCHER, cq as Overlay, ct as PALETTES, aa as PATH_VIDEO_MATCHER, bq as PagesAs, cV as PointPairs, aX as PredictedBoundingBox, b1 as PredictedCentroid, aB as PredictedInstance3D, b5 as PredictedLabelImage, aL as PredictedROI, aU as PredictedSegmentationMask, bA as RETRYABLE_STATUSES, cm as RGBA, aH as ROIOptions, cY as RawFrame, ax as RecordingSession, bF as RemoteIOError, cN as RenderContext, bG as ResolvedUrl, by as SENSITIVE_HEADERS, bz as SENSITIVE_QUERY_PARAMS, ad as SHAPE_VIDEO_MATCHER, a1 as STRUCTURE_SKELETON_MATCHER, a2 as SUBSET_SKELETON_MATCHER, aR as SegmentationMaskOptions, k as SeqHeader, l as SeqIndex, j as SeqVideoBackend, G as SkeletonMatchMethod, N as SkeletonMatcher, Z as SkeletonMismatchError, x as StreamingH5File, E as StreamingH5Source, bd as StreamingHdf5VideoBackend, ar as SuggestionFrame, T as TrackMatchMethod, Q as TrackMatcher, cM as Trail, cL as TrailTarget, bv as URL_SCHEMES, p as UnsupportedVideoFormatError, aW as UserBoundingBox, b0 as UserCentroid, b4 as UserLabelImage, aT as UserSegmentationMask, aS as UserSegmentationMaskOptions, b9 as VideoBackend, aq as VideoBackendError, ap as VideoBackendErrorKind, q as VideoBackendType, b7 as VideoFrame, J as VideoMatchMethod, W as VideoMatcher, cr as VideoOverlay, ai as _annotationCentroidXy, ak as _findAnnotationLinkMatches, aj as _findAnnotationMatches, aE as _registerMaskFactory, ah as _relinkFromPredicted, al as _resolveMergedIsNegative, v as checkDownloadHost, cK as collectTracks, bf as computePrefetchWindow, cI as computeTrails, c2 as createSkeletonFromCategory, o as createVideoBackend, cW as cropFrame, cR as cropPoints, c5 as decodeCocoRle, c4 as decodeCompressedRleCounts, c3 as decodeKeypoints, aN as decodeRle, c6 as decodeSegmentation, aK as decodeWkb, cf as decodeYamlSkeleton, cx as determineColorScheme, cy as drawCircle, cC as drawCross, cA as drawDiamond, cQ as drawLabelImage, cP as drawMasks, cz as drawSquare, cD as drawTrails, cB as drawTriangle, aM as encodeRle, aJ as encodeWkb, cg as encodeYamlSkeleton, bO as fetchRetrying, cb as fromDict, cd as fromNumpy, aY as getCentroidSkeleton, i as getImageBytesReader, cE as getMarkerFunction, cu as getPalette, aQ as groupRingsIntoPolygons, bP as headOrRangeProbe, bK as identityHeaders, bu as isAnalysisH5File, c0 as isCocoData, bC as isGdriveUrl, A as isStreamingSupported, cl as isTrainingConfig, bB as isUrl, ce as labelsFromNumpy, bj as loadAnalysisH5, bo as loadLabelImages, bh as loadSlp, bl as loadSlpSet, bn as loadVideo, ay as makeCameraFromDict, cJ as nTrailPaletteColors, b6 as normalizeLabelIds, w as openGdrive, z as openH5Worker, y as openStreamingH5, c1 as parseCocoJson, t as parseGdrive, bN as parseRetryAfterMs, bJ as raiseRemote, aI as rasterizeGeometry, c7 as readCoco, c8 as readCocoSet, bV as readGeoJSON, ch as readSkeletonJson, F as readSlpStreaming, ck as readTrainingConfigSkeleton, cj as readTrainingConfigSkeletons, bD as redactUrl, bE as redactedCauseSummary, aO as resizeNearest, cv as resolveColor, ao as resolveCropRect, cH as resolveTrailNode, bH as resolveUrl, cw as rgbToCSS, as as rodriguesTransformation, bT as roisFromGeoJSON, bS as roisToGeoJSON, bk as saveAnalysisH5, bi as saveSlp, bm as saveSlpSet, bt as saveSlpToBytes, ae as setFsResolver, s as setImageBytesReader, bp as setLabelImageFileReader, bI as statusToMessage, bL as stripCrossOriginHeaders, ca as toDict, cc as toNumpy, aP as traceMaskContours, cS as uncropPoints, u as urlFromConfirmation, bM as withRetries, bU as writeGeoJSON, ci as writeSkeletonJson } from './index.browser-S8Yz42ID.js';
import { I as Instance, S as Skeleton, T as Track, P as PredictedInstance } from './instance-Dtvrjx8R.js';
export { E as Edge, N as Node, k as NodeOrIndex, b as Point, d as PointsArray, c as PredictedPoint, e as PredictedPointsArray, a as Symmetry, _ as _registerCentroidFactory, p as pointsEmpty, g as pointsFromArray, i as pointsFromDict, f as predictedPointsEmpty, h as predictedPointsFromArray, j as predictedPointsFromDict } from './instance-Dtvrjx8R.js';

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
 * Node-only path-based COCO loaders (file I/O + image-path resolution).
 *
 * Wraps the browser-safe core in `coco.ts`. Reads the annotation JSON from disk
 * and installs a default fs-based image resolver replicating Python
 * `resolve_image_path` (direct path, common prefixes, recursive basename glob).
 */

/**
 * Read a COCO dataset from a JSON file on disk. Defaults `datasetRoot` to the
 * JSON file's directory and installs the fs-based image resolver unless the
 * caller supplied one. Mirrors Python `read_labels(json_path)`.
 */
declare function loadCoco(jsonPath: string, options?: ReadCocoOptions): Labels;
/**
 * Read multiple COCO splits from a directory of `*.json` annotation files. When
 * `jsonFiles` is omitted, discovers all top-level `.json` files (non-recursive).
 * Split names are filename stems. Tracks are independent per split. Mirrors
 * Python `read_labels_set`.
 */
declare function loadCocoSet(datasetPath: string, options?: ReadCocoOptions & {
    jsonFiles?: string[];
}): Record<string, Labels>;

/**
 * JABS (Jackson Lab Animal Behavior System) pose-file reader.
 *
 * A TypeScript port of the reader half of Python sleap-io's
 * `sleap_io/io/jabs.py` (v0.7.x, PR #371), which:
 *
 * - returns {@link PredictedInstance} objects (with per-point confidence
 *   scores), and
 * - emits static objects (arena corners, lixit, food hopper, …) as
 *   {@link UserROI} objects in `labels.staticRois` — `category: "arena"` for
 *   `corners`, `category: "anchor"` otherwise, and `source: "jabs"` — rather
 *   than as synthetic instances/skeletons in frame 0.
 *
 * JABS pose files are HDF5 on disk, so this reader is Node-only (it reads
 * through `openH5File`, which uses h5wasm/node) and is exported from the Node
 * entry point only.
 *
 * Supported pose versions: 2 (single mouse) through 6. Segmentation data (v6)
 * and per-file attributes such as `cm_per_pixel` are ignored, matching Python.
 *
 * The writer half (`convert_labels` / `write_jabs_v*`) is intentionally not
 * ported: per issue #99, `saveJabs` is lower priority since the common workflow
 * is a one-time JABS → SLP conversion.
 */

/** Ordered JABS keypoint names (pose versions 2–6). */
declare const JABS_DEFAULT_KEYPOINT_NAMES: readonly ["NOSE", "LEFT_EAR", "RIGHT_EAR", "BASE_NECK", "LEFT_FRONT_PAW", "RIGHT_FRONT_PAW", "CENTER_SPINE", "LEFT_REAR_PAW", "RIGHT_REAR_PAW", "BASE_TAIL", "MID_TAIL", "TIP_TAIL"];
/** Edge connections (by node index) for the default JABS skeleton. Root is BASE_NECK (3). */
declare const JABS_DEFAULT_EDGE_INDICES: Array<[number, number]>;
/** Symmetric node pairs (by node index) for the default JABS skeleton. */
declare const JABS_DEFAULT_SYMMETRY_INDICES: Array<[number, number]>;
/** Build a fresh copy of the default JABS "Mouse" skeleton. */
declare function makeJabsDefaultSkeleton(): Skeleton;
/**
 * The default JABS "Mouse" skeleton (12 nodes, 11 edges, 3 symmetries).
 *
 * Shared module-level instance used as the default for {@link loadJabs}.
 * Treat it as read-only; callers needing a mutable skeleton should use
 * {@link makeJabsDefaultSkeleton}.
 */
declare const JABS_DEFAULT_SKELETON: Skeleton;
/** Create a `Skeleton` with `numPoints` nodes connected in a line. */
declare function makeSimpleSkeleton(name: string, numPoints: number): Skeleton;
/**
 * Build a {@link PredictedInstance} from JABS prediction data.
 *
 * @param data - Keypoint locations as `(nNodes, 2)` in `[x, y]` order (JABS
 *   stores `[y, x]`; the reader flips before calling this).
 * @param confidence - Per-keypoint confidence scores, length `nNodes`.
 * @param skeleton - Skeleton to use for the instance.
 * @param track - Optional track to assign.
 * @returns A `PredictedInstance` with per-point scores, or `null` if no
 *   keypoint has positive confidence.
 */
declare function predictionToInstance(data: number[][], confidence: number[], skeleton: Skeleton, track?: Track | null): PredictedInstance | null;
/**
 * Convert JABS static-object keypoints into a {@link UserROI}.
 *
 * A single point becomes a `Point` geometry; multiple points become a
 * `MultiPoint`. Coordinates are kept in their stored order (static objects are
 * NOT y/x-flipped, unlike poses). Category is `"arena"` for `corners`,
 * `"anchor"` otherwise; `source` is `"jabs"`.
 */
declare function staticObjectToRoi(name: string, coords: number[][], video: Video): UserROI;
/** Options for {@link loadJabs}. */
interface LoadJabsOptions {
    /**
     * Skeleton to use for instances. Defaults to {@link JABS_DEFAULT_SKELETON}
     * (the JABS v2–6 "Mouse" skeleton). Must have one node per keypoint column.
     */
    skeleton?: Skeleton | null;
}
/**
 * Read a JABS pose file (HDF5) into a {@link Labels} object.
 *
 * Instances are {@link PredictedInstance} objects with per-point confidence
 * scores; v5+ static objects are loaded as {@link UserROI} static ROIs. The
 * associated {@link Video} filename is derived from the pose-file name
 * (`*_pose_est_vN.h5` → `*.avi`).
 *
 * Node-only (reads HDF5 via h5wasm).
 *
 * Divergence from Python: a missing file raises (matching Python's
 * `FileNotFoundError`), but Python's separate `os.R_OK` `PermissionError` for a
 * present-but-unreadable file is not replicated — such a file instead surfaces
 * whatever error the underlying h5wasm reader throws.
 *
 * @param labelsPath - Path to the JABS pose file.
 * @param options - Optional `skeleton` override.
 */
declare function loadJabs(labelsPath: string, options?: LoadJabsOptions): Promise<Labels>;

/**
 * DeepLabCut (DLC) format I/O (read path).
 *
 * TypeScript port of `sleap_io/io/dlc.py` (READ path only), adapted to the
 * JS/Node data model and runtime.
 *
 * In addition to reading a single DLC annotation CSV ({@link loadDlc}), this
 * module can import an entire DLC *project* from its `config.yaml`
 * ({@link loadDlcProject}) and recover the train/test splits stored by
 * `create_training_dataset` ({@link loadDlcSplits}).
 *
 * ## Format overview
 *
 * - **Single-animal (SADLC)** CSV: 3 header rows (`scorer` / `bodyparts` /
 *   `coords`) followed by one row per labeled image; each bodypart contributes
 *   an `x` and a `y` column.
 * - **Multi-animal (maDLC / MAUDLC)** CSV: 4 header rows (a leading `scorer`
 *   row, then `individuals` / `bodyparts` / `coords`); the `individuals` level
 *   names the animal each column belongs to. MAUDLC adds a `single` individual
 *   carrying unique (single-animal) bodyparts.
 * - Image paths appear either as a single column
 *   (`labeled-data/video/img000.png`) or split across three index columns
 *   (`labeled-data`, `video`, `img000.png`); the latter is joined with `/`.
 * - A project `config.yaml` supplies skeleton edges (the `skeleton:` list),
 *   the `scorer`/`Task`/`date`, and `video_sets` (source-video links + crops).
 *
 * When a config is available, the returned `Labels` gains skeleton edges and
 * per-video `Video.sourceVideo` links that link each `labeled-data/<video>/`
 * image folder back to its original video file (matched by filename stem).
 * DLC's `video_sets[...].crop` is a virtual read-time crop; its rect (DLC's
 * width-range-first `x1, x2, y1, y2` reordered to the sleap rect
 * `(x1, y1, x2, y2)`) is recorded under `provenance["dlc_crops"]`, keyed by
 * source-video path. No offset is ever applied to point coordinates.
 *
 * ## Node-only
 *
 * DLC datasets are directory trees of many files (a project dir, per-image
 * folders), so this module reads through the Node `fs`/`path` APIs (like
 * `io/ultralytics.ts` / `io/jabs.ts` / `io/trackmate.ts`) and is exported only
 * from the Node entry point (`src/index.ts`), never the browser bundle.
 *
 * ## Divergences from Python `dlc.py`
 *
 * 1. **No crop view.** The JS `Video` has no `from_crop` / `is_cropped` /
 *    `crop_rect` / `to_source_coords`. Python links a `Video.from_crop` view
 *    when a non-identity crop's source video exists on disk; JS cannot, so
 *    `sourceVideo` is **always** a closed `Video` ({@link Video} with
 *    `openBackend: false`) and the crop lives only in
 *    `provenance["dlc_crops"]`. Point coordinates are unaffected either way.
 * 2. **Errors.** Python's `ValueError` / `FileNotFoundError` distinction
 *    collapses to a single `Error` with the same message text.
 * 3. **Warnings** are emitted via `console.warn` (vs Python `warnings.warn`);
 *    message text is preserved so callers / tests can match on substrings.
 * 4. **No `addEdges`.** Edges are added one pair at a time via
 *    `Skeleton.addEdge`, after validating both endpoints exist.
 * 5. **Pickle decoding.** `loadDlcSplits` requires reading a Python pickle
 *    (the DLC `Documentation_data-*.pickle`); a minimal protocol 2-5 opcode
 *    interpreter is implemented here ({@link readPickle}) since the repo has no
 *    pickle dependency. It decodes the train/test index arrays whether they are
 *    plain Python `list[int]` or **numpy integer ndarrays** — the latter being
 *    what real DeepLabCut writes (`SplitTrials` slices `np.random.permutation`
 *    and `save_metadata` pickles the resulting `np.ndarray`s directly). Both
 *    the modern `_frombuffer`/`BYTEARRAY8` and the older `_reconstruct`+`BUILD`
 *    numpy encodings are handled. `loadDlc` / `loadDlcProject` need no pickle.
 * 6. **`**kwargs` ignored.** Python's forwarded loader kwargs (PR #488/#492) are
 *    modeled as an index signature on the options objects and ignored.
 */

/**
 * Check if a file appears to be a DLC annotation CSV.
 *
 * Reads the first four lines as raw text and looks for DLC's characteristic
 * header tokens. Any read error (missing/empty file) yields `false`.
 */
declare function isDlcFile(filename: string): boolean;
/**
 * Return whether a path refers to a DLC project (directory containing both
 * `config.yaml` and `labeled-data/`, or a `config.yaml` file validating as a
 * DLC project config).
 */
declare function isDlcProjectPath(filename: string): boolean;
type Config = Record<string, unknown>;
/**
 * Read a DLC project `config.yaml` into a dictionary, or `null` if the file is
 * missing or does not parse to a mapping. A warning is emitted on failure so a
 * malformed/foreign config never breaks plain CSV loading.
 */
declare function readDlcConfig(p: string): Config | null;
/** Return whether a parsed mapping looks like a DLC project config (>=2 keys). */
declare function looksLikeDlcConfig(cfg: unknown): boolean;
/**
 * Search upward from a CSV for a DLC project `config.yaml` (up to `maxLevels`
 * parent directories). Returns the path to a validated config, or `null`.
 */
declare function discoverConfig(csvPath: string, maxLevels?: number): string | null;
/**
 * Resolve the `config` argument of {@link loadDlc} to a parsed config dict.
 *
 * - `false` disables config entirely (strict legacy output).
 * - `null`/`undefined` auto-discovers `config.yaml` by walking up from the CSV.
 * - a string forces a specific config path.
 */
declare function resolveConfig(csvPath: string, config: string | false | null): Config | null;
/**
 * Attach skeleton edges (and name) from a DLC config to a `Skeleton` in place.
 * Edges referencing bodyparts not present in the skeleton are dropped with a
 * warning. Resolution is strictly name-based.
 */
declare function attachConfigSkeleton(skeleton: Skeleton, cfg: Config): void;
/**
 * Parse a DLC `video_sets[...].crop` value into a sleap crop rect.
 *
 * DLC stores the crop width-range-first as `x1, x2, y1, y2` (string or list);
 * this is reordered to `(x1, y1, x2, y2)` with x2/y2 exclusive, 0-indexed.
 * Returns `null` when missing/empty/unparsable, wrong arity, inverted (warns),
 * or an identity crop at origin `(0, 0)`.
 */
declare function parseDlcCrop(crop: unknown): [number, number, number, number] | null;
type StemEntry = {
    original: string;
    rect: [number, number, number, number] | null;
};
/**
 * Map video filename stems to original paths and crop rects from config.
 * Windows backslash separators are normalized; placeholder entries are skipped.
 * Preserves config (object key) order.
 */
declare function videoSetsStemMap(cfg: Config): Map<string, StemEntry>;
/**
 * Link an image-folder `Video` back to its original source video. Returns
 * `{ path, rect }` for the linked source, or `null` on a stem mismatch.
 *
 * JS divergence: `video.sourceVideo` is always a closed `Video`
 * (`openBackend: false`); there is no crop view (see module banner).
 */
declare function setSourceVideo(video: Video, folderName: string, stemMap: Map<string, StemEntry>, searchPaths?: string[]): {
    path: string;
    rect: [number, number, number, number] | null;
} | null;
type ColumnTuple = [string, string, string];
interface DlcDataframe {
    index: string[];
    columns: ColumnTuple[];
    /** rows[r][c] aligns to columns[c]; `null` means missing/NaN. */
    rows: Array<Array<number | null>>;
    isMultianimal: boolean;
}
/**
 * Read a DLC annotation CSV into a flattened-index multi-column table,
 * emulating pandas `read_csv` with multi-row headers.
 */
declare function readDlcDataframe(filename: string): DlcDataframe;
/** Extract the last numeric run from an image filename stem (for sorting). */
declare function extractFrameIndex(imgPath: string): number;
interface LoadDlcOptions {
    videoSearchPaths?: string[];
    /**
     * `null`/`undefined` = auto-discover `config.yaml` walking up from the CSV;
     * `false` = disable config entirely (legacy output, no edges/links/crops);
     * string = force this config path.
     */
    config?: string | false | null;
    /** Accepted-and-ignored (PR #488 parity): openVideos, lazy, etc. */
    [key: string]: unknown;
}
/**
 * Load DeepLabCut annotations from a single CSV file.
 *
 * @param filename Path to a DLC CSV file.
 * @param options Loader options ({@link LoadDlcOptions}).
 * @returns A {@link Labels} object with the loaded data.
 */
declare function loadDlc(filename: string, options?: LoadDlcOptions): Labels;
interface LoadDlcProjectOptions {
    videoSearchPaths?: string[];
    /** Accepted-and-ignored (PR #488 parity). */
    [key: string]: unknown;
}
/**
 * Load an entire DeepLabCut project from its `config.yaml`.
 *
 * @param config Path to a `config.yaml`, or to a project directory with one.
 * @param options Loader options ({@link LoadDlcProjectOptions}).
 * @returns A {@link Labels} object with frames from every labeled video.
 */
declare function loadDlcProject(config: string, options?: LoadDlcProjectOptions): Labels;
/**
 * Read train/test positional indices from a DLC Documentation pickle.
 *
 * The pickle is a 4-element list `[data, trainIndices, testIndices,
 * trainFraction]`. `trainIndices` (`meta[1]`) and `testIndices` (`meta[2]`) are
 * the only elements consumed. Real DeepLabCut writes these as numpy integer
 * ndarrays (decoded by {@link readPickle} into {@link NumpyArray}); a
 * hand-rolled writer may instead emit plain Python `list[int]`. Both are
 * supported here; the `-1` padding sentinel (from `enforce_train_fraction`) is
 * filtered out, mirroring Python `_read_dlc_split`.
 */
declare function readDlcSplit(picklePath: string): [number[], number[]];
/** Read the scorer name from the first row of a DLC CSV. */
declare function readCsvScorer(csv: string): string | null;
/** Reconstruct DLC's globally merged frame order as `(folder, filename)`. */
declare function dlcMergedOrder(projectDir: string, cfg: Config): Array<[string, string]>;
/** Warn if numeric filename order differs from DLC's lexicographic order. */
declare function warnIfNonlexicographic(merged: Array<[string, string]>): void;
interface LoadDlcSplitsOptions {
    shuffle?: number;
    trainFraction?: number;
    iteration?: number;
    videoSearchPaths?: string[];
    /** Accepted-and-ignored (PR #488/#492 parity). */
    [key: string]: unknown;
}
/**
 * Load DeepLabCut train/test splits from a project's Documentation pickle.
 *
 * @param config Path to a DLC project `config.yaml` (or its project directory).
 * @param options Selector + loader options ({@link LoadDlcSplitsOptions}).
 * @returns A {@link LabelsSet} with `"train"` and `"test"` keys.
 */
declare function loadDlcSplits(config: string, options?: LoadDlcSplitsOptions): LabelsSet;
/**
 * Decode a Python pickle into JS values, supporting the subset of opcodes
 * needed for DLC's `Documentation_data-*.pickle`: a shallow
 * `[data, trainIndices, testIndices, trainFraction]` list. `trainIndices` /
 * `testIndices` may be plain Python `list[int]` (as a hand-rolled writer emits)
 * **or** numpy integer ndarrays — which is what real DeepLabCut writes, since
 * `SplitTrials` slices `np.random.permutation(...)` and `save_metadata` pickles
 * the resulting `np.ndarray`s without a `list()` conversion.
 *
 * Numpy arrays are decoded via two reductions:
 *   - modern numpy (1.17+/2.x): `numpy[._]core.numeric._frombuffer(rawbytes,
 *     dtype, shape, order)` — a single `REDUCE`, with `rawbytes` carried by a
 *     `BYTEARRAY8` opcode;
 *   - older numpy: `numpy.core.multiarray._reconstruct(...)` + `BUILD` with
 *     state `(version, shape, dtype, fortran_order, rawdata)`, where `rawdata`
 *     is often a `_codecs.encode(latin1str, 'latin1')` bytes reduction.
 * The `numpy.dtype(name, ...)` reduction is decoded to a {@link NumpyDtype} so
 * the raw bytes can be interpreted (int8/16/32/64, signed/unsigned, byteorder).
 *
 * The DLC split reader only consumes `meta[1]` / `meta[2]`; the lossy `data`
 * payload need not be perfectly reconstructed, so any unrecognized reduction is
 * returned as an opaque marker object.
 */
declare function readPickle(buffer: Buffer): unknown;

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

/**
 * Draw bounding boxes on an image.
 *
 * Each box is drawn as a closed path through its (rotation-aware) corners, with
 * an optional translucent fill, and—for `PredictedBoundingBox`—a "score" label
 * near the top-left corner. Rendered through an internal skia-canvas `Canvas`.
 * Port of `draw_bboxes` (overlays.py L363-510).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param bboxes - Bounding boxes to draw.
 * @param opts - `color` (default [0,255,0]), per-bbox `colors`, `lineWidth`
 *   (2), `fillAlpha` (0).
 * @returns The same ImageData.
 */
declare function drawBboxes(image: ImageData, bboxes: BoundingBox[], opts?: {
    color?: RGB;
    colors?: RGB[];
    lineWidth?: number;
    fillAlpha?: number;
}): ImageData;
/**
 * Draw ROI geometries on an image.
 *
 * Renders each ROI's GeoJSON geometry: polygons (with even-odd holes), points
 * and multipoints (filled circles, radius = max(lineWidth, 2)), and line
 * strings. Rendered through an internal skia-canvas `Canvas`. Port of
 * `draw_rois` + `_draw_geometry` (overlays.py L22-112, L513-640).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param rois - ROIs to draw.
 * @param opts - `color` (default [0,255,0]), per-ROI `colors`, `lineWidth` (2),
 *   `fillAlpha` (0).
 * @returns The same ImageData.
 */
declare function drawRois(image: ImageData, rois: ROI[], opts?: {
    color?: RGB;
    colors?: RGB[];
    lineWidth?: number;
    fillAlpha?: number;
}): ImageData;
/**
 * Apply an annotation overlay to an image, dispatching by type.
 *
 * Mirrors Python `_apply_overlay` (core.py L473-566): a `LabelImage` (or raw
 * Int32Array-backed object) routes to {@link drawLabelImage}; a non-empty list
 * routes to {@link drawMasks} / {@link drawRois} / {@link drawBboxes} with
 * per-item palette colors. A `list[LabelImage]` raises (per-frame dispatch must
 * happen at the renderVideo level), and unknown element types raise.
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param overlay - A LabelImage, or a list of SegmentationMask / ROI / BoundingBox.
 * @param opts - `alpha` (0.3), `palette` ("distinct"), `outline` (false),
 *   `outlineWidth` (1), `outlineColor` (null), plus optional per-element
 *   `colors` for a list overlay. When `colors` is provided it overrides the
 *   positional `palette` coloring (used by callers to color overlays by track
 *   identity); it must match the overlay length and is ignored for label
 *   images. Mirrors Python `_apply_overlay` (core.py L473-566, PR #470).
 * @returns The same ImageData.
 */
declare function applyOverlay(image: ImageData, overlay: LabelImage | RawLabelImage | SegmentationMask[] | ROI[] | BoundingBox[], opts?: {
    alpha?: number;
    palette?: PaletteName | string;
    outline?: boolean;
    outlineWidth?: number;
    outlineColor?: RGB | null;
    colors?: RGB[] | null;
}): ImageData;

export { BoundingBox, type CreateDataYamlOptions, type ImageShape, Instance, JABS_DEFAULT_EDGE_INDICES, JABS_DEFAULT_KEYPOINT_NAMES, JABS_DEFAULT_SKELETON, JABS_DEFAULT_SYMMETRY_INDICES, LabelImage, LabeledFrame, Labels, LabelsSet, type LineFormat, type LoadDlcOptions, type LoadDlcProjectOptions, type LoadDlcSplitsOptions, type LoadJabsOptions, PaletteName, type ParseLabelFileOptions, type ParsedLabelFile, PredictedInstance, RGB, ROI, RawLabelImage, ReadCocoOptions, type ReadLabelsOptions, type ReadLabelsSetOptions, RenderOptions, SegmentationMask, Skeleton, Track, type TrackMateOptions, UserROI, Video, VideoOptions, type WriteLabelsOptions, applyOverlay, attachConfigSkeleton, buildClassNamesFromBboxes, buildClassNamesFromRois, checkFfmpeg, classNamesFromConfig, createDataYaml, createSkeletonFromConfig, createSplitsFromLabels, denormalizeCoordinates, detectLineFormat, discoverConfig, dlcMergedOrder, drawBboxes, drawRois, encodePng, extractFrameIndex, isDlcFile, isDlcProjectPath, isTrackMateFile, loadCoco, loadCocoSet, loadDlc, loadDlcProject, loadDlcSplits, loadJabs, loadTrackMate, loadUltralytics, looksLikeDlcConfig, makeJabsDefaultSkeleton, makeSimpleSkeleton, normalizeCoordinates, parseDataYaml, parseDlcCrop, parseLabelFile, predictionToInstance, probeImageSize, readCsvScorer, readDlcConfig, readDlcDataframe, readDlcSplit, readLabels, readLabelsSet, readPickle, readTrackMateCsv, renderImage, renderVideo, resolveConfig, saveImage, saveUltralytics, setSourceVideo, staticObjectToRoi, toDataURL, toJPEG, toPNG, videoSetsStemMap, warnIfNonlexicographic, writeBboxLabelFile, writeLabelFile, writeLabels, writeRoiLabelFile };
