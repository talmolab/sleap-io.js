import { V as Video, l as Labels, I as Instance, R as ROI, B as BoundingBox, S as Skeleton, m as LabeledFrame, n as LabelsSet, T as Track, o as PredictedInstance, U as UserROI, C as Centroid, p as LabelImage, q as SegmentationMask } from './dictionary-CT771WRc.js';
export { a3 as AUTO_VIDEO_MATCHER, a_ as AnnotationType, a5 as BASENAME_VIDEO_MATCHER, bf as BboxFromInstanceOptions, be as BboxPadding, bg as BoundingBoxOptions, bl as CENTROID_SKELETON, aM as Camera, aN as CameraGroup, bm as CentroidOptions, H as ConflictResolution, ax as CropOptions, bC as CropRect, aD as DEFAULT_PREVIEW_MAX_SIZE, aE as DEFAULT_PREVIEW_QUALITY, _ as DUPLICATE_MATCHER, aw as EXISTS_TTL_MS, E as Edge, aU as Embedding, aH as EncodePreviewOptions, y as ErrorMode, bK as Fill, bD as FlatPoints, i as Format3Access, j as Format3Option, a as Format3Summary, F as FrameGroup, bI as FrameLike, x as FrameStrategy, a9 as FsResolver, a$ as Geometry, bv as GetFrameOptions, a0 as IDENTITY_INSTANCE_MATCHER, a2 as IDENTITY_TRACK_MATCHER, a6 as IMAGE_DEDUP_VIDEO_MATCHER, $ as IOU_MATCHER, aT as Identity, aV as Instance3D, aO as InstanceGroup, u as InstanceMatchMethod, A as InstanceMatcher, L as LOSSLESS_FORMAT3_ASKS, bp as LabelImageObjectInfo, bq as LabelImageOptions, bx as LabelsDict, aX as LazyDataStore, aY as LazyFrameList, Q as MatchResult, J as MergeError, W as MergeProgressBar, O as MergeResult, aa as MergeStrategy, M as MetadataKindsByTable, a1 as NAME_TRACK_MATCHER, N as Node, av as NodeOrIndex, Z as OVERLAP_SKELETON_MATCHER, a4 as PATH_VIDEO_MATCHER, aC as PREVIEW_FORMAT_VERSION, ai as Point, am as PointColumns, bE as PointPairs, as as PointView, ak as PointsArray, bi as PredictedBoundingBox, bo as PredictedCentroid, aW as PredictedInstance3D, bs as PredictedLabelImage, aj as PredictedPoint, al as PredictedPointsArray, b4 as PredictedROI, bd as PredictedSegmentationMask, aG as PreviewFrame, aF as PreviewFrameOptions, P as PreviewMetadata, b0 as ROIOptions, bJ as RawFrame, r as RecordMetadata, s as RecordMetadataValue, aP as RecordingSession, a7 as SHAPE_VIDEO_MATCHER, d as SLP_FORMAT_ID_LIMIT, e as SLP_SUPPORTED_FEATURES, X as STRUCTURE_SKELETON_MATCHER, Y as SUBSET_SKELETON_MATCHER, ba as SegmentationMaskOptions, t as SkeletonMatchMethod, z as SkeletonMatcher, K as SkeletonMismatchError, f as SlpFormat3ChoiceError, c as SlpFormatError, k as SlpSourceFormat, h as SlpTableError, g as SlpViewOnlyError, aB as SuggestionFrame, b as Symmetry, v as TrackMatchMethod, D as TrackMatcher, bh as UserBoundingBox, bn as UserCentroid, br as UserLabelImage, bc as UserSegmentationMask, bb as UserSegmentationMaskOptions, bw as VideoBackend, aA as VideoBackendError, az as VideoBackendErrorKind, bu as VideoFrame, w as VideoMatchMethod, G as VideoMatcher, ac as _annotationCentroidXy, ae as _findAnnotationLinkMatches, ad as _findAnnotationMatches, ah as _registerBboxFactory, ag as _registerCentroidFactory, aZ as _registerMaskFactory, ab as _relinkFromPredicted, af as _resolveMergedIsNegative, ap as clonePoint, aR as cloneRecordingSession, aJ as createPreviewFrameFromPixels, aK as createPreviewFrameFromVideoFrame, bF as cropFrame, bA as cropPoints, b6 as decodeRle, b3 as decodeWkb, bG as detectGrayscale, aI as encodePreviewJpeg, b5 as encodeRle, b2 as encodeWkb, bz as fromDict, bk as getCentroidSkeleton, bH as grayscaleFrame, b9 as groupRingsIntoPolygons, aQ as injectSessionFrameResolver, aS as makeCameraFromDict, bj as normalizeCentroidSource, bt as normalizeLabelIds, an as pointsEmpty, aq as pointsFromArray, at as pointsFromDict, ao as predictedPointsEmpty, ar as predictedPointsFromArray, au as predictedPointsFromDict, b1 as rasterizeGeometry, b7 as resizeNearest, ay as resolveCropRect, aL as rodriguesTransformation, a8 as setFsResolver, by as toDict, b8 as traceMaskContours, bB as uncropPoints } from './dictionary-CT771WRc.js';
import { R as ReadCocoOptions, D as DlcFileSystem, C as Config, a as RenderOptions, V as VideoOptions, b as RGB, c as RawLabelImage, P as PaletteName } from './index.browser-5RtCosKN.js';
export { bx as AppendEncodedVideosOptions, bo as AppendStoreOptions, aN as AviVideoBackend, aM as AviVideoOptions, E as BlobByteSource, F as ByteSource, ay as ByteSourceDescriptor, ao as CACHE_WINDOW_BEHIND, c1 as CLOUD_SCHEMES, cv as CocoAnnotation, cr as CocoCategory, cs as CocoImage, cw as CocoJson, ct as CocoRle, cu as CocoSegmentation, d6 as ColorScheme, d5 as ColorSpec, J as CreateVideoBackendOptions, K as CropVideoBackend, M as CropWrapOptions, b$ as CsvExportOptions, Y as DEFAULT_MAX_BYTES, bV as DatasetMetaLike, cV as DlcDataframe, dp as DrawTrailsOptions, bg as EMBED_IMAGE_FORMATS, bh as EmbedImageFormat, bc as EmbedOption, bs as EmbeddedVideoAttrs, by as EncodeFramePayload, bz as EncodedVideoSink, bb as ExportCancelled, bA as ExternalFrameReader, ak as FeedEntry, c2 as GDRIVE_HOSTS, cl as GeoJSONFeature, cm as GeoJSONFeatureCollection, N as GrayscaleVideoBackend, O as GrayscaleWrapOptions, I as ImageBytesReader, aR as ImageVideoBackend, aP as ImageVideoOptions, bU as InPlaceWritable, dx as InstanceContext, b3 as LabelImageFileReader, bN as LabelTable, bO as LabelTableRows, bP as LabelTableUpdate, f as LibavDecoderConfig, L as LibavH264Decoder, b2 as LoadLabelImagesOptions, dn as MARKER_FUNCTIONS, aB as MP4_DECODE_WORKER_CODE, d7 as MarkerShape, aH as MediaBunnyOptions, aI as MediaBunnyVideoBackend, bq as MergeStoresOptions, ag as Mp4BoxVideoBackend, aj as Mp4ParseResult, ah as Mp4Sample, da as NAMED_COLORS, bQ as OnDiskMember, bT as OnDiskSidecars, bR as OnDiskTable, bS as OnDiskTables, d8 as Overlay, db as PALETTES, b1 as PagesAs, ac as PointSpanMismatch, x as PosixPath, y as PrefixSwap, be as PreviewOption, c5 as RETRYABLE_STATUSES, d4 as RGBA, a8 as RangeSink, a7 as RangeSource, cT as ReadDlcOptions, cU as ReadDlcProjectOptions, al as ReadRegion, ca as RemoteIOError, dw as RenderContext, cb as ResolvedUrl, z as ResolvedVideoSource, c3 as SENSITIVE_HEADERS, c4 as SENSITIVE_QUERY_PARAMS, A as SeqHeader, B as SeqIndex, S as SeqVideoBackend, ai as SerializableDecoderConfig, bt as SerializableEmbedEntry, bv as SerializableEmbedPlan, bu as SerializableEncodeEntry, ba as SlpLayout, ab as SlpPointSpanError, bk as SlpStreamWriter, b9 as SlpVersion, bn as SlpWriteHeader, bd as SlpWriteOptions, bp as SlpWriteSink, Z as StreamingH5File, a6 as StreamingH5Source, _ as StreamingH5Writer, aO as StreamingHdf5VideoBackend, aa as StreamingIncompleteError, dv as Trail, du as TrailTarget, c0 as URL_SCHEMES, U as UnsupportedVideoFormatError, b8 as V3_DEFAULTS_ENV, H as VideoBackendType, d9 as VideoOverlay, aJ as WebDemuxerConfig, aF as WorkerBackendParams, az as WorkerInMessage, aE as WorkerLike, aG as WorkerMp4BoxBackend, aA as WorkerOutMessage, j as anchorCandidate, bw as appendEncodedVideos, l as applyPrefixSwap, cL as attachConfigSkeleton, bH as buildExpectedSidecars, bB as buildLabelTableRows, bC as buildLabelTableUpdate, bD as buildMetadataJson, br as buildSerializableEmbedPlan, bF as buildSuggestionsJson, bE as buildTracksJson, bG as buildVideoSignatures, W as checkDownloadHost, bf as checkEmbedImageFormat, bI as checkInPlaceWritable, dt as collectTracks, aq as computeCacheWindow, aQ as computePrefetchWindow, dr as computeTrails, d as configureLibavDecoder, aK as configureWebDemuxer, ad as copySourceMark, aC as createDecodeWorker, cz as createSkeletonFromCategory, G as createVideoBackend, cC as decodeCocoRle, cB as decodeCompressedRleCounts, cA as decodeKeypoints, cD as decodeSegmentation, cZ as decodeYamlSkeleton, k as derivePrefixSwap, df as determineColorScheme, dg as drawCircle, dk as drawCross, di as drawDiamond, dz as drawLabelImage, dy as drawMasks, dh as drawSquare, dl as drawTrails, dj as drawTriangle, c_ as encodeYamlSkeleton, e as ensureNativeH264Probe, cN as extractFrameIndex, cj as fetchRetrying, am as findKeyframeBefore, cQ as findProjectCsvs, q as formatPath, cX as fromNumpy, g as getImageBytesReader, dm as getMarkerFunction, dc as getPalette, b7 as getV3Defaults, ck as headOrRangeProbe, cf as identityHeaders, bW as isAnalysisH5File, cx as isCocoData, cI as isDlcData, c7 as isGdriveUrl, i as isLibavDecoderConfigured, bY as isNwbFile, a2 as isRangeSource, a1 as isStreamingSupported, d3 as isTrainingConfig, c6 as isUrl, aL as isWebDemuxerConfigured, aD as isWorkerDecodeAvailable, cY as labelsFromNumpy, bZ as labelsToCsv, aU as loadAnalysisH5, a$ as loadLabelImages, aX as loadNwb, aS as loadSlp, aY as loadSlpSet, a_ as loadVideo, cK as looksLikeDlcConfig, ar as markViewed, ds as nTrailPaletteColors, n as nativeH264DecodableSync, aw as nextUncached, bK as onDiskColumnTableFromMeta, bJ as onDiskTableFromMeta, bL as onDiskTablesFromFile, X as openGdrive, a0 as openH5Worker, bj as openSlpWriter, $ as openStreamingH5, o as overrideNativeH264Decodable, cy as parseCocoJson, cJ as parseDlcCrop, Q as parseGdrive, p as parsePath, ci as parseRetryAfterMs, as as pickEvictionVictim, an as planDecodeRange, au as planReadRegions, u as posixBasename, t as posixDirname, w as posixJoin, ce as raiseRemote, cE as readCoco, cF as readCocoSet, cG as readDlc, cS as readDlcDataframe, cH as readDlcProject, cq as readGeoJSON, bX as readNwb, av as readSamplesByDecodeOrder, c$ as readSkeletonJson, a9 as readSlpStreaming, d2 as readTrainingConfigSkeleton, d1 as readTrainingConfigSkeletons, c8 as redactUrl, c9 as redactedCauseSummary, r as registerLibavH264Decoder, dd as resolveColor, cO as resolveConfig, m as resolveFirstExisting, cR as resolveProjectConfigPath, b5 as resolveSlpVersion, dq as resolveTrailNode, cc as resolveUrl, h as resolveVideoSource, de as rgbToCSS, co as roisFromGeoJSON, cn as roisToGeoJSON, aV as saveAnalysisH5, aW as saveAnalysisH5ToBytes, b_ as saveLabelsCsv, aT as saveSlp, bl as saveSlpMergedFromStores, bm as saveSlpMergedToSink, aZ as saveSlpSet, bi as saveSlpStructureToBytes, b4 as saveSlpToBytes, at as selectFeedSamples, a3 as serviceRangeBridge, a5 as serviceTruncateBridge, a4 as serviceWriteBridge, s as setImageBytesReader, b0 as setLabelImageFileReader, af as setSourceAccess, cP as setSourceVideo, b6 as setV3Defaults, ax as shouldDecodeAhead, ae as sourceMarkOf, cd as statusToMessage, cg as stripCrossOriginHeaders, cW as toNumpy, T as urlFromConfirmation, v as videoPathCandidates, cM as videoSetsStemMap, ap as viewedFrameCapacity, ch as withRetries, cp as writeGeoJSON, bM as writeLabelTablesInPlace, d0 as writeSkeletonJson } from './index.browser-5RtCosKN.js';
import 'mediabunny';

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
 * DeepLabCut (DLC) format I/O — Node file-path wrappers + train/test splits.
 *
 * Node-only companion to the browser-safe `dlc.ts` core (mirrors the
 * `coco.ts` / `coco-node.ts` split). This module:
 *
 * - supplies a real-`fs` {@link DlcFileSystem} adapter and re-exposes the core
 *   readers as path-based `loadDlc` / `loadDlcProject` (plus fs-backed
 *   `isDlcFile` / `readDlcConfig` / `discoverConfig` / `isDlcProjectPath`);
 * - implements `loadDlcSplits`, which recovers a DLC project's train/test
 *   partition from its `Documentation_data-*.pickle` — this needs a Python
 *   pickle decoder built on `Buffer`, so it lives here and never enters the
 *   browser bundle.
 *
 * Exported only from the Node entry point (`src/index.ts`), never the browser
 * bundle (`src/index.browser.ts` exports the `dlc.ts` core).
 */

/** A {@link DlcFileSystem} backed by the Node `fs` module. */
declare const nodeDlcFileSystem: DlcFileSystem;
interface LoadDlcOptions {
    videoSearchPaths?: string[];
    config?: string | false | null;
    /** Accepted-and-ignored (PR #488 parity): openVideos, lazy, etc. */
    [key: string]: unknown;
}
/** Load DeepLabCut annotations from a single CSV file on disk. */
declare function loadDlc(filename: string, options?: LoadDlcOptions): Labels;
interface LoadDlcProjectOptions {
    videoSearchPaths?: string[];
    /** Accepted-and-ignored (PR #488 parity). */
    [key: string]: unknown;
}
/** Load an entire DeepLabCut project from its `config.yaml` on disk. */
declare function loadDlcProject(config: string, options?: LoadDlcProjectOptions): Labels;
/**
 * Check if a file on disk appears to be a DLC annotation CSV. Reads the file
 * and delegates the header sniff to {@link isDlcData}; any read error (missing/
 * empty file) yields `false`.
 */
declare function isDlcFile(filename: string): boolean;
/** Read a DLC project `config.yaml` on disk into a dictionary (or `null`). */
declare function readDlcConfig(p: string): Config | null;
/** Search upward from a CSV on disk for a DLC project `config.yaml`. */
declare function discoverConfig(csvPath: string, maxLevels?: number): string | null;
/** Whether a path on disk refers to a DLC project directory or `config.yaml`. */
declare function isDlcProjectPath(filename: string): boolean;
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
 * Draw centroids as filled circle markers on an image.
 *
 * Each centroid is drawn as a filled circle of radius `markerSize` at
 * `(centroid.x - offsetX, centroid.y - offsetY)`, in a single `color` or a
 * per-centroid `colors` list (cycled when shorter than the centroid list).
 * Rendered through an internal skia-canvas `Canvas`. Port of `draw_centroids`
 * (overlays.py, sleap-io PR #506).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param centroids - Centroids to draw.
 * @param opts - `color` (default [0,255,0]), per-centroid `colors`, `markerSize`
 *   (5), `alpha` (1), `offset` ([0,0]).
 * @returns The same ImageData.
 */
declare function drawCentroids(image: ImageData, centroids: Centroid[], opts?: {
    color?: RGB;
    colors?: RGB[];
    markerSize?: number;
    alpha?: number;
    offset?: [number, number];
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
declare function applyOverlay(image: ImageData, overlay: LabelImage | RawLabelImage | SegmentationMask | ROI | BoundingBox | SegmentationMask[] | ROI[] | BoundingBox[], opts?: {
    alpha?: number;
    palette?: PaletteName | string;
    outline?: boolean;
    outlineWidth?: number;
    outlineColor?: RGB | null;
    colors?: RGB[] | null;
}): ImageData;

export { BoundingBox, Centroid, Config, type CreateDataYamlOptions, DlcFileSystem, type ImageShape, Instance, JABS_DEFAULT_EDGE_INDICES, JABS_DEFAULT_KEYPOINT_NAMES, JABS_DEFAULT_SKELETON, JABS_DEFAULT_SYMMETRY_INDICES, LabelImage, LabeledFrame, Labels, LabelsSet, type LineFormat, type LoadDlcOptions, type LoadDlcProjectOptions, type LoadDlcSplitsOptions, type LoadJabsOptions, PaletteName, type ParseLabelFileOptions, type ParsedLabelFile, PredictedInstance, RGB, ROI, RawLabelImage, ReadCocoOptions, type ReadLabelsOptions, type ReadLabelsSetOptions, RenderOptions, SegmentationMask, Skeleton, Track, type TrackMateOptions, UserROI, Video, VideoOptions, type WriteLabelsOptions, applyOverlay, buildClassNamesFromBboxes, buildClassNamesFromRois, checkFfmpeg, classNamesFromConfig, createDataYaml, createSkeletonFromConfig, createSplitsFromLabels, denormalizeCoordinates, detectLineFormat, discoverConfig, dlcMergedOrder, drawBboxes, drawCentroids, drawRois, encodePng, isDlcFile, isDlcProjectPath, isTrackMateFile, loadCoco, loadCocoSet, loadDlc, loadDlcProject, loadDlcSplits, loadJabs, loadTrackMate, loadUltralytics, makeJabsDefaultSkeleton, makeSimpleSkeleton, nodeDlcFileSystem, normalizeCoordinates, parseDataYaml, parseLabelFile, predictionToInstance, probeImageSize, readCsvScorer, readDlcConfig, readDlcSplit, readLabels, readLabelsSet, readPickle, readTrackMateCsv, renderImage, renderVideo, saveImage, saveUltralytics, staticObjectToRoi, toDataURL, toJPEG, toPNG, warnIfNonlexicographic, writeBboxLabelFile, writeLabelFile, writeLabels, writeRoiLabelFile };
