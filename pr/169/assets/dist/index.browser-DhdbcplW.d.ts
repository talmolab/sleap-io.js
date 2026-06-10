import { T as Track, I as Instance, S as Skeleton, P as PredictedInstance } from './instance-DLj547bw.js';

type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;
interface VideoBackend {
    filename: string | string[];
    shape?: [number, number, number, number];
    fps?: number;
    dataset?: string | null;
    /**
     * Embedded-image (HDF5 / `pkg.slp`) backends: the source frame numbers that
     * have a stored image, in storage order. Left unset by continuous-video
     * backends (mp4 / seq / image-sequence), where every frame is decodable.
     */
    frameNumbers?: number[];
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    getFrameTimes?(): Promise<number[] | null>;
    close(): void;
}

/**
 * Point coordinate transformation functions for virtual cropping.
 *
 * Ported from Python `sleap_io/transform/points.py` ({@link crop_points},
 * {@link uncrop_points}). These adjust landmark coordinates to match a cropped
 * video frame. Both operations are copy-based (the input is never mutated) and
 * NaN-preserving (`NaN ± c` stays `NaN` naturally).
 *
 * Browser-safe: no Node-only imports.
 */
/**
 * A crop rectangle as `[x1, y1, x2, y2]` in source pixel coordinates.
 *
 * `x2`/`y2` are EXCLUSIVE (so the cropped width is `x2 - x1` and height is
 * `y2 - y1`), matching the Python `(x1, y1, x2, y2)` convention.
 */
type CropRect = [number, number, number, number];
/**
 * A flat interleaved coordinate buffer `[x0, y0, x1, y1, ...]` (even lanes are
 * x, odd lanes are y). Matches the typed-array layout used by point buffers.
 */
type FlatPoints = Float64Array | Float32Array | number[];
/** An array of `[x, y]` coordinate pairs (the `(..., 2)` numpy analog). */
type PointPairs = ReadonlyArray<readonly [number, number]>;
/**
 * Adjust point coordinates for a crop transformation.
 *
 * Subtracts the crop origin `(x1, y1)` from every coordinate, mapping source
 * coordinates into the crop-local frame. NaN coordinates are preserved.
 *
 * Accepts either a flat interleaved buffer (`[x, y, x, y, ...]`, typed or
 * plain array) or an array of `[x, y]` pairs, and returns the same kind.
 *
 * @param points Source-frame coordinates.
 * @param crop Crop region `[x1, y1, x2, y2]` (x2/y2 exclusive).
 * @returns Crop-local coordinates (a copy; input unmutated).
 */
declare function cropPoints<T extends FlatPoints>(points: T, crop: CropRect): T;
declare function cropPoints(points: PointPairs, crop: CropRect): [number, number][];
/**
 * Map crop-local point coordinates back to source coordinates.
 *
 * Inverse of {@link cropPoints}: adds the crop origin `(x1, y1)` to every
 * coordinate. NaN coordinates are preserved.
 *
 * @param points Crop-local coordinates.
 * @param crop Crop region `[x1, y1, x2, y2]` (x2/y2 exclusive).
 * @returns Source-frame coordinates (a copy; input unmutated).
 */
declare function uncropPoints<T extends FlatPoints>(points: T, crop: CropRect): T;
declare function uncropPoints(points: PointPairs, crop: CropRect): [number, number][];

/**
 * Frame-level crop transform for virtual cropping.
 *
 * Ported from Python `sleap_io/transform/frame.py` ({@link crop_frame}). Crops a
 * decoded frame to a rectangle, padding any out-of-bounds region with a fill
 * value (the OOB region is padded, NOT clamped — pixels outside the source are
 * the fill value, not the nearest edge pixel).
 *
 * This function is PURE and synchronous: it reads pixels directly. It therefore
 * cannot accept a raw `ImageBitmap` (whose pixels are not synchronously
 * readable) and throws a clear error if given one — the video backend is
 * responsible for rasterizing an `ImageBitmap` to `ImageData` first.
 *
 * Browser-safe: no Node-only imports.
 */

/**
 * A raw pixel buffer with explicit dimensions and channel count. Channels are
 * interleaved (e.g. `[r, g, b, a, r, g, b, ...]` for `channels: 4`, or a single
 * lane per pixel for grayscale `channels: 1`). `channels` defaults to 1.
 */
interface RawFrame {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
    channels?: number;
}
/**
 * Anything {@link cropFrame} can read pixels from: a browser `ImageData`
 * (always 4-channel RGBA) or a {@link RawFrame} with a threaded channel count.
 */
type FrameLike = ImageData | RawFrame;
/**
 * Per-pixel fill for out-of-bounds regions: a single scalar applied to every
 * channel, or one value per channel.
 */
type Fill = number | number[];
/**
 * Crop a decoded frame to `crop`, padding out-of-bounds regions with `fill`.
 *
 * Mirrors Python `crop_frame`: the source rectangle is clamped to the frame
 * bounds (so a crop lying wholly off one axis yields an empty source slice
 * rather than a negative extent), an output buffer of the cropped size is
 * allocated and filled with `fill`, and the valid source slice is pasted at
 * `(srcX1 - x1, srcY1 - y1)`. The channel count is preserved from the input.
 *
 * @param frame Decoded source frame (`ImageData` RGBA or a {@link RawFrame}).
 *   A raw `ImageBitmap` is rejected — rasterize it first.
 * @param crop Crop region `[x1, y1, x2, y2]` (x2/y2 exclusive).
 * @param fill OOB pad value (scalar applied to all channels, or per-channel).
 * @returns For an `ImageData` input, an `ImageData`-shaped RGBA result; for a
 *   {@link RawFrame} input, a {@link RawFrame} with the same channel count.
 */
declare function cropFrame(frame: ImageData, crop: CropRect, fill?: Fill): ImageData;
declare function cropFrame(frame: RawFrame, crop: CropRect, fill?: Fill): RawFrame;

/**
 * Bounding-box / region specs accepted by {@link Video.crop} and
 * {@link Video.fromCrop} (in addition to an explicit `crop` rect).
 *
 * Exactly one region spec must be provided across `crop` (the positional rect),
 * `bbox`, `roi`, or the (`center`, `size`) pair. Mirrors the keyword arguments
 * of Python `Video.crop` / `_resolve_crop_rect`.
 */
interface CropOptions {
    /** A bounding box `[x1, y1, x2, y2]`; bounds may be float (floor/ceil). */
    bbox?: [number, number, number, number];
    /**
     * An object exposing axis-aligned `.bounds` as `[minx, miny, maxx, maxy]`
     * (e.g. a shapely-like geometry). `margin` is applied symmetrically around it.
     */
    roi?: {
        bounds: [number, number, number, number];
    };
    /** Window center `[cx, cy]` (used with `size`). */
    center?: [number, number];
    /** Fixed output `[width, height]` (used with `center`). */
    size?: [number, number];
    /** Pixels added around the `roi` bounds on every side. Default `0`. */
    margin?: number;
    /** Fill value for out-of-bounds regions. Default `0`. */
    fill?: Fill;
    /**
     * If `true` (the default), reuse this video's backend as the shared inner so a
     * mosaic of tiles over one file decodes each source frame once; in that case
     * the new tile does NOT own the shared decoder. Maps to
     * `ownsInner = !shareDecode` on {@link CropVideoBackend.wrap}.
     */
    shareDecode?: boolean;
}
/**
 * Resolve a crop region spec into an integer `[x1, y1, x2, y2]` rect.
 *
 * Port of Python `_resolve_crop_rect` (video.py:24-99). Exactly one region spec
 * must be provided: an explicit `crop` rect, a `bbox`, a `roi` (its axis-aligned
 * bounds + `margin`), or a (`center`, `size`) pair for a fixed-shape centered
 * window. Float bounds are rounded OUTWARD (floor of the mins, ceil of the maxs)
 * so the integer rect always *contains* the requested region; the centered
 * window uses `round` so the output shape is exactly `size`. Truncation toward
 * zero is never used for the float paths (the explicit `crop` path matches
 * Python's `int()` truncation).
 *
 * @param crop Explicit crop region `[x1, y1, x2, y2]`, x2/y2 exclusive.
 * @param opts One of `bbox` / `roi` / (`center` + `size`), plus `margin`.
 * @returns An integer crop region `[x1, y1, x2, y2]`, possibly out of bounds.
 * @throws Error If not exactly one region spec is provided, `center`/`size` are
 *   not given together, or the resolved rect is inverted (`x2 < x1`/`y2 < y1`).
 */
declare function resolveCropRect(crop?: CropRect | null, opts?: CropOptions): CropRect;
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
    /**
     * Sorted, de-duplicated source frame numbers that have an available image, or
     * `null` when every frame is available (continuous video) or the set is
     * unknown / the backend is closed. For an embedded-image video (`pkg.slp`)
     * the backend exposes the stored `frame_numbers`; callers should treat `null`
     * as "no restriction" (all frames imaged).
     */
    get embeddedFrameIndices(): number[] | null;
    get originalVideo(): Video | null;
    get shape(): [number, number, number, number] | null;
    set shape(value: [number, number, number, number] | null);
    get fps(): number | null;
    set fps(value: number | null);
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    getFrameTimes(): Promise<number[] | null>;
    close(): void;
    /**
     * Return a virtual, on-read cropped view of this video.
     *
     * Port of Python `Video.crop` (video.py:304-389). Exactly one region spec must
     * be given: an explicit `crop` rect (the positional argument), or one of
     * `bbox` / `roi` / (`center` + `size`) via {@link CropOptions}. The returned
     * `Video` shares no pixels with this one; frames are decoded on read and
     * cropped, with out-of-bounds regions pad-filled with `fill` (never clamped),
     * so the output shape is always exactly `[y2 - y1, x2 - x1]`.
     *
     * The crop composes (FLATTENS when fills agree and the region is in-bounds)
     * with any existing crop via {@link CropVideoBackend.wrap}. `sourceVideo` is
     * set to this video for provenance, and `backendMetadata` is seeded with the
     * cropped `shape`, the uncropped `source_shape`, the composed `crop` rect, and
     * `crop_fill` so a closed re-serialize and a close/open round-trip keep the
     * crop. When `shareDecode` (the default), the new crop reuses this video's
     * backend as the shared inner (the new tile does NOT own the decoder).
     *
     * @param crop Explicit crop region `[x1, y1, x2, y2]`, x2/y2 exclusive.
     * @param opts One of `bbox` / `roi` / (`center` + `size`), plus `margin`,
     *   `fill`, and `shareDecode`.
     * @returns A new `Video` exposing the cropped view.
     * @throws Error If there is no backend to crop, or the region spec is invalid.
     */
    crop(crop?: CropRect | null, opts?: CropOptions): Video;
    /**
     * Crop a `Video` and return a virtual cropped view.
     *
     * Port of Python `Video.from_crop` (video.py:391-440). Accepts the same region
     * specs as {@link crop}. Unlike Python (which can open a path via
     * `from_filename`), the JS port has no generic filesystem-backed open facade,
     * so `video` must already be a `Video` with a backend; passing a path string
     * throws.
     *
     * @param video An existing `Video` to crop.
     * @param crop Explicit crop region `[x1, y1, x2, y2]`, x2/y2 exclusive.
     * @param opts One of `bbox` / `roi` / (`center` + `size`), plus `margin`,
     *   `fill`, and `shareDecode`.
     * @returns A new `Video` exposing the cropped view.
     * @throws Error If `video` is a path string (unsupported in the JS port).
     */
    static fromCrop(video: Video | string, crop?: CropRect | null, opts?: CropOptions): Video;
    /**
     * Return this video's crop rect `[x1, y1, x2, y2]` or `null`.
     *
     * Port of Python `Video._crop_tuple` (video.py:442-454). Reads `backend.crop`
     * when the backend is a {@link CropVideoBackend} (open path), else
     * `backendMetadata.crop` (closed path), else `null` (uncropped).
     */
    _cropTuple(): CropRect | null;
    /**
     * Return this video's crop fill value (open: backend; closed: metadata).
     *
     * Port of Python `Video._crop_fill` (video.py:456-465). Returns `0` for an
     * uncropped video.
     */
    _cropFill(): Fill;
    /** Whether this video is a virtual crop of another video. */
    get isCropped(): boolean;
    /** Crop rect `[x1, y1, x2, y2]` in source coords, or `null` if uncropped. */
    get cropRect(): CropRect | null;
    /** The out-of-bounds fill value for this video's crop (`0` if uncropped). */
    get cropFill(): Fill;
    /**
     * Map source-frame `(x, y)` coordinates into this video's cropped frame.
     *
     * Port of Python `Video.to_crop_coords` (video.py:482-494). If this video is
     * not cropped, a copy of `points` is returned unchanged (NaN preserved).
     * Accepts a flat interleaved buffer or an array of `[x, y]` pairs and returns
     * the same kind.
     */
    toCropCoords<T extends FlatPoints>(points: T): T;
    toCropCoords(points: PointPairs): [number, number][];
    /**
     * Map cropped-frame `(x, y)` coordinates back to source-frame coordinates.
     *
     * Port of Python `Video.to_source_coords` (video.py:496-510). Inverse of
     * {@link toCropCoords}. If this video is not cropped, a copy of `points` is
     * returned unchanged (NaN preserved).
     */
    toSourceCoords<T extends FlatPoints>(points: T): T;
    toSourceCoords(points: PointPairs): [number, number][];
    /**
     * Check if this video has the same path as another video.
     *
     * Port of Python `Video.matches_path` (video.py:637-715). The public default
     * is kept at `strict = true` (DECISIONS D1) because every merge/match call
     * site passes `strict` explicitly, so the default is never load-bearing for
     * parity; the LOGIC below mirrors Python exactly.
     *
     * @param other - Another video to compare with.
     * @param strict - If `true`, require an exact (posix-normalized) path match.
     *   If `false`, consider videos with the same basename as matching.
     */
    matchesPath(other: Video, strict?: boolean): boolean;
    /**
     * Check if this video has the same content as another video.
     *
     * Port of Python `Video.matches_content` (video.py:717-742). Compares the
     * FULL 4-tuple shape (frames, height, width, channels) and the backend type
     * name, NOT actual frame data.
     *
     * @param other - Another video to compare with.
     * @returns `true` if the videos have the same shape and backend type.
     */
    matchesContent(other: Video): boolean;
    /**
     * Check if this video has the same shape as another video.
     *
     * Port of Python `Video.matches_shape` (video.py:744-772). Compares only
     * height, width, and channels (INCLUDING channels, EXCLUDING frames).
     *
     * @param other - Another video to compare with.
     * @returns `true` if the videos have the same height, width, and channels.
     */
    matchesShape(other: Video): boolean;
    /**
     * Check if this video has overlapping images with another video.
     *
     * Port of Python `Video.has_overlapping_images` (video.py:774-799). Only
     * meaningful for image sequences (list filenames); compares basenames.
     *
     * @param other - Another video to compare with.
     * @returns `true` if both are image sequences with at least one shared
     *   image basename, `false` otherwise.
     */
    hasOverlappingImages(other: Video): boolean;
    /**
     * Whether this video is grayscale, or `null` if unknown.
     *
     * Port of Python `Video.grayscale` getter (video.py:225-239): if the shape is
     * known, grayscale is `shape[-1] === 1`; otherwise fall back to a stored
     * `backendMetadata["grayscale"]` value (real key-presence, so a stored `null`
     * is returned as-is), else `null`. Used by `deduplicateWith` / `mergeWith` to
     * carry the grayscale hint onto the newly created video.
     */
    get grayscale(): boolean | null;
    /**
     * Create a new video with duplicate images removed.
     *
     * Port of Python `Video.deduplicate_with` (video.py:801-840). Specific to
     * image-sequence videos (ImageVideo: `filename` is a list). Images are
     * considered duplicates when they share a basename. The returned video
     * contains only the images from THIS video whose basename is not present in
     * `other`, preserving this video's order.
     *
     * Return contract (matches Python exactly): returns `null` when ALL of this
     * video's images are duplicates (Python returns `None`); otherwise returns a
     * NEW `Video` (never `this`, never `other`) carrying the surviving image paths.
     *
     * @param other - Another image-sequence video to deduplicate against.
     * @returns A new `Video` with the non-duplicate images, or `null` if every
     *   image was a duplicate.
     * @throws Error - If either video's `filename` is not a list (ImageVideo).
     */
    deduplicateWith(other: Video): Video | null;
    /**
     * Merge another video's images into this one.
     *
     * Port of Python `Video.merge_with` (video.py:842-883). Specific to
     * image-sequence videos (ImageVideo: `filename` is a list). Returns a NEW
     * `Video` containing all unique images (by basename) from both videos,
     * preserving order: every unique image from THIS video first, then any image
     * from `other` whose basename has not already been seen.
     *
     * @param other - Another image-sequence video to merge with.
     * @returns A new `Video` with the de-duplicated union of both videos' images.
     * @throws Error - If either video's `filename` is not a list (ImageVideo).
     */
    mergeWith(other: Video): Video;
}

/** Return the shared single-node `Skeleton(["centroid"])` instance. */
declare function getCentroidSkeleton(): Skeleton;
/**
 * Module-level constant for the centroid skeleton.
 * Lazily initialized on first access.
 */
declare const CENTROID_SKELETON: Skeleton;
/** Options for constructing a Centroid. */
interface CentroidOptions {
    x: number;
    y: number;
    z?: number | null;
    track?: Track | null;
    trackingScore?: number | null;
    instance?: Instance | null;
    category?: string;
    name?: string;
    source?: string;
}
/**
 * A point representing the center of an object.
 *
 * Supports optional 3D coordinates, track/instance metadata,
 * and interconversion with single-node Instance objects.
 *
 * Spatial-temporal context (video, frame index) is derived from the parent
 * LabeledFrame, matching how Instance/PredictedInstance work.
 *
 * This class is abstract. Use UserCentroid or PredictedCentroid.
 */
declare class Centroid {
    x: number;
    y: number;
    z: number | null;
    track: Track | null;
    trackingScore: number | null;
    instance: Instance | null;
    category: string;
    name: string;
    source: string;
    /** @internal Deferred instance index for lazy resolution. */
    _instanceIdx: number | null;
    constructor(options: CentroidOptions);
    /** Coordinates as `[x, y]`. */
    get xy(): [number, number];
    /** Coordinates as `[y, x]` (row, col order). */
    get yx(): [number, number];
    /** Coordinates as `[x, y, z]`. */
    get xyz(): [number, number, number | null];
    /** Whether this is a predicted centroid (has a score). */
    get isPredicted(): boolean;
    /**
     * Convert this centroid to a single-node Instance.
     *
     * @param skeleton - Skeleton to use. Must have exactly one node.
     *   Defaults to the shared CENTROID_SKELETON.
     * @returns Instance or PredictedInstance depending on this centroid's type.
     */
    toInstance(skeleton?: Skeleton): Instance | PredictedInstance;
    /**
     * Create a centroid from an Instance.
     *
     * @param instance - Source instance.
     * @param options - Options for centroid extraction.
     * @param options.method - "centerOfMass" (default), "bboxCenter", or "anchor".
     * @param options.node - Node name or index for "anchor" method.
     * @returns UserCentroid or PredictedCentroid depending on instance type.
     */
    static fromInstance(instance: Instance | PredictedInstance, options?: {
        method?: string;
        node?: string | number;
        [key: string]: unknown;
    }): Centroid;
}
/** User-annotated or derived centroid (no prediction score). */
declare class UserCentroid extends Centroid {
}
/** Predicted centroid with a confidence score. */
declare class PredictedCentroid extends Centroid {
    score: number;
    constructor(options: CentroidOptions & {
        score: number;
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
    track?: Track | null;
    trackingScore?: number | null;
    instance?: Instance | null;
}
declare class ROI {
    geometry: Geometry;
    name: string;
    category: string;
    source: string;
    video: Video | null;
    track: Track | null;
    trackingScore: number | null;
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
    get isBbox(): boolean;
    get bounds(): {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    };
    get area(): number;
    /** Centroid of the geometry as `[x, y]`. */
    get centroidXy(): [number, number];
    /** @deprecated Use `centroidXy` instead. */
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
    track?: Track | null;
    trackingScore?: number | null;
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
    track: Track | null;
    trackingScore: number | null;
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
    /** Convert to a `BoundingBox` object with metadata.
     *
     * Returns a `UserBoundingBox` or `PredictedBoundingBox` depending on whether
     * this mask is predicted. Coordinates are in image space (respecting
     * scale/offset).
     */
    toBbox(): BoundingBox;
    /** Convert the mask to a bounding-box polygon ROI. */
    toPolygon(): ROI;
}
interface UserSegmentationMaskOptions extends SegmentationMaskOptions {
    /**
     * Provenance link to the predicted mask this was adopted from. Persisted to
     * the SLP format as an index into the saved mask list (see
     * {@link UserSegmentationMask.fromPredicted}).
     */
    fromPredicted?: PredictedSegmentationMask | null;
}
/** User-annotated segmentation mask (no prediction score). */
declare class UserSegmentationMask extends SegmentationMask {
    /**
     * Provenance link to the `PredictedSegmentationMask` this user mask was
     * adopted from, set by {@link PredictedSegmentationMask.toUser}.
     *
     * Mirroring `Instance.fromPredicted`, this link is persisted to the SLP
     * format as an index into the saved mask list. It survives a save/load
     * round-trip as long as the source prediction is also saved (in the same or
     * another frame). Files written before this column existed load it as `null`.
     */
    fromPredicted: PredictedSegmentationMask | null;
    constructor(options: UserSegmentationMaskOptions);
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
    /**
     * Adopt this predicted mask as a user-annotated mask (human-in-the-loop).
     *
     * Returns a NEW {@link UserSegmentationMask} that carries an independent
     * COPY of the RLE raster (via `rleCounts.slice()`) plus the metadata
     * (`name`, `category`, `source`, `track`, `trackingScore`, `instance`,
     * `scale`, `offset`). Prediction-only fields (`score`, `scoreMap`,
     * `scoreMapScale`, `scoreMapOffset`) are dropped. The internal
     * `_instanceIdx` is carried over.
     *
     * The `track` and `instance` references are SHARED (not deep-copied), while
     * the RLE raster and the `scale`/`offset` tuples are copied so the user mask
     * owns independent buffers.
     *
     * Mirrors `Instance.fromPredicted` semantics: the resulting `fromPredicted`
     * link is persisted to the SLP format as an index into the saved mask list,
     * and survives a save/load round-trip as long as the source prediction is
     * also saved. Files written before this column existed load it as `null`.
     *
     * @param link - When `true` (default), set the returned mask's
     *   `fromPredicted` to this predicted mask. When `false`, leave it `null`.
     */
    toUser(link?: boolean): UserSegmentationMask;
}

/** Options for constructing a BoundingBox. */
interface BoundingBoxOptions {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    angle?: number;
    track?: Track | null;
    instance?: Instance | null;
    trackingScore?: number | null;
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
    track: Track | null;
    trackingScore: number | null;
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
    /** Center point as `[x, y]`. */
    get centroidXy(): [number, number];
    /** @deprecated Use `centroidXy` instead. */
    get centroid(): {
        x: number;
        y: number;
    };
    /** Whether this is a predicted bbox (has a score). */
    get isPredicted(): boolean;
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
    trackingScore?: number | null;
    /** @internal Deferred instance index for lazy resolution. */
    _instanceIdx?: number;
}
interface LabelImageOptions {
    data: Int32Array;
    height: number;
    width: number;
    objects?: Map<number, LabelImageObjectInfo>;
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
     * Tracks are NOT created by default (mirrors Python `LabelImage.from_numpy`
     * after sleap-io PR #387): pure segmentation workflows (e.g. Cellpose) produce
     * instances that don't need tracking. Pass `createTracks: true` to auto-create
     * one Track per unique non-zero label ID, or provide `tracks` explicitly. When
     * provided as an array, tracks are assigned positionally starting at label
     * ID 1; as a `Map`, by label ID. Providing `tracks` takes precedence over
     * `createTracks`.
     */
    static fromArray(data: Int32Array | number[][], height: number, width: number, options?: {
        tracks?: Track[] | Map<number, Track>;
        categories?: string[] | Map<number, string>;
        createTracks?: boolean;
        source?: string;
    }): UserLabelImage;
    /** Create a LabelImage by compositing an array of SegmentationMasks. */
    static fromMasks(masks: SegmentationMask[], options?: {
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
     * @param options.source - Source string shared across all frames.
     */
    static fromStack(options: {
        data: number[][][];
        tracks?: Map<number, Track> | Track[] | null;
        categories?: Map<number, string> | string[] | null;
        createTracks?: boolean;
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
        source?: string;
        scale?: [number, number];
        offset?: [number, number];
    }): UserLabelImage;
    /** Decompose this LabelImage into individual SegmentationMask objects. */
    toMasks(): SegmentationMask[];
    /** Extract tight bounding boxes for each object in the label image.
     *
     * Returns `UserBoundingBox` or `PredictedBoundingBox` objects depending on
     * whether this label image is predicted. Each bounding box inherits track,
     * category, name, instance, and score from the corresponding object entry.
     *
     * Bounding boxes are in image coordinates (respecting scale/offset).
     * Label IDs present in `objects` but with no pixels in the data are skipped.
     */
    toBboxes(): BoundingBox[];
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

/**
 * Unified matcher system for comparing and matching data structures during merging.
 *
 * TypeScript port of Python `sleap_io/model/matching.py` (pinned @ 054cce39f).
 * PART 1 implements the six enums (+ validators), the result/error types, the
 * progress-bar stub, and the module-level helper functions (video file/shape/
 * pose/image matching). The four matcher classes and preconfigured singletons
 * are added in PART 2.
 *
 * Identity policy (ARCHITECTURE §9): all model objects compare by reference
 * (`===`) and are used directly as `Map`/`Set` keys. Value comparison happens
 * ONLY through the named `.matches*` / `samePoseAs` / etc. methods. Maps preserve
 * insertion order. Exact-type discrimination uses `x.constructor === Instance` /
 * `=== PredictedInstance` (mirrors Python `type(x) is ...`).
 */

/** Methods for matching skeletons (matching.py:34-47). */
declare const SkeletonMatchMethod: {
    readonly EXACT: "exact";
    readonly STRUCTURE: "structure";
    readonly OVERLAP: "overlap";
    readonly SUBSET: "subset";
};
type SkeletonMatchMethod = (typeof SkeletonMatchMethod)[keyof typeof SkeletonMatchMethod];
/** Methods for matching instances (matching.py:50-61). */
declare const InstanceMatchMethod: {
    readonly SPATIAL: "spatial";
    readonly IDENTITY: "identity";
    readonly IOU: "iou";
};
type InstanceMatchMethod = (typeof InstanceMatchMethod)[keyof typeof InstanceMatchMethod];
/** Methods for matching tracks (matching.py:64-73). */
declare const TrackMatchMethod: {
    readonly NAME: "name";
    readonly IDENTITY: "identity";
};
type TrackMatchMethod = (typeof TrackMatchMethod)[keyof typeof TrackMatchMethod];
/** Methods for matching videos (matching.py:76-99). */
declare const VideoMatchMethod: {
    readonly PATH: "path";
    readonly BASENAME: "basename";
    readonly CONTENT: "content";
    readonly AUTO: "auto";
    readonly IMAGE_DEDUP: "image_dedup";
    readonly SHAPE: "shape";
};
type VideoMatchMethod = (typeof VideoMatchMethod)[keyof typeof VideoMatchMethod];
/** Strategies for handling frame merging (matching.py:102-121). */
declare const FrameStrategy: {
    readonly AUTO: "auto";
    readonly KEEP_ORIGINAL: "keep_original";
    readonly KEEP_NEW: "keep_new";
    readonly KEEP_BOTH: "keep_both";
    readonly UPDATE_TRACKS: "update_tracks";
    readonly REPLACE_PREDICTIONS: "replace_predictions";
};
type FrameStrategy = (typeof FrameStrategy)[keyof typeof FrameStrategy];
/** Error handling modes for merge operations (matching.py:124-135). */
declare const ErrorMode: {
    readonly CONTINUE: "continue";
    readonly STRICT: "strict";
    readonly WARN: "warn";
};
type ErrorMode = (typeof ErrorMode)[keyof typeof ErrorMode];
/**
 * Information about a conflict that was resolved during merging
 * (matching.py:1150-1170). Plain data record; equality is not exercised.
 *
 * Only two `conflictType` values are emitted: `"instance_conflict"` and
 * `"negative_flag_conflict"`.
 */
declare class ConflictResolution {
    frame: LabeledFrame;
    conflictType: string;
    originalData: unknown;
    newData: unknown;
    resolution: string;
    constructor(frame: LabeledFrame, conflictType: string, originalData: unknown, newData: unknown, resolution: string);
}
/**
 * Base exception for merge errors (matching.py:1173-1183).
 *
 * `details` is a FRESH `{}` per instance (never a shared module object).
 */
declare class MergeError extends Error {
    details: Record<string, unknown>;
    constructor(message: string, details?: Record<string, unknown>);
}
/**
 * Raised when skeletons don't match during merge (matching.py:1186-1189).
 *
 * Extends {@link MergeError} with no new fields/methods; `instanceof MergeError`
 * MUST hold so a single `catch (e) { if (e instanceof MergeError) ... }`
 * captures both.
 */
declare class SkeletonMismatchError extends MergeError {
    constructor(message: string, details?: Record<string, unknown>);
}
/**
 * Result of a merge operation (matching.py:1192-1242).
 *
 * `merge()` never touches `instancesUpdated`/`instancesSkipped` — they stay 0.
 * `conflicts` and `errors` are fresh arrays per instance.
 */
declare class MergeResult {
    successful: boolean;
    framesMerged: number;
    instancesAdded: number;
    instancesUpdated: number;
    instancesSkipped: number;
    conflicts: ConflictResolution[];
    errors: MergeError[];
    constructor(successful: boolean, options?: {
        framesMerged?: number;
        instancesAdded?: number;
        instancesUpdated?: number;
        instancesSkipped?: number;
        conflicts?: ConflictResolution[];
        errors?: MergeError[];
    });
    /**
     * Generate a human-readable summary of the merge result (matching.py:1214-1242).
     *
     * Byte-exact: U+2713 (checkmark) / U+2717 (ballot X) prefix; 2-space indents
     * for counts, 4-space "- " indents for error lines; optional int lines gated
     * on `!== 0`; list lines gated on `.length > 0`; first-5 errors + overflow
     * line. No trailing newline.
     */
    summary(): string;
}
/**
 * Result of matching two Labels objects (matching.py:1245-1336).
 *
 * Maps are keyed by `other`'s objects (by reference) and store `self`'s objects
 * or `null` on no-match. `Map` preserves insertion order, which the
 * `unmatched*`/`summary()` consumers rely on.
 */
declare class MatchResult {
    videoMap: Map<Video, Video | null>;
    skeletonMap: Map<Skeleton, Skeleton | null>;
    trackMap: Map<Track, Track | null>;
    constructor(options?: {
        videoMap?: Map<Video, Video | null>;
        skeletonMap?: Map<Skeleton, Skeleton | null>;
        trackMap?: Map<Track, Track | null>;
    });
    /** Videos from `other` that had no match in `self` (insertion order). */
    get unmatchedVideos(): Video[];
    /** Skeletons from `other` that had no match in `self` (insertion order). */
    get unmatchedSkeletons(): Skeleton[];
    /** Tracks from `other` that had no match in `self` (insertion order). */
    get unmatchedTracks(): Track[];
    /** True if all videos from `other` were matched (empty map => true). */
    get allVideosMatched(): boolean;
    /** True if all skeletons from `other` were matched (empty map => true). */
    get allSkeletonsMatched(): boolean;
    /** True if all tracks from `other` were matched (empty map => true). */
    get allTracksMatched(): boolean;
    /** Number of videos successfully matched (counts `value != null`). */
    get nVideosMatched(): number;
    /** Number of skeletons successfully matched (counts `value != null`). */
    get nSkeletonsMatched(): number;
    /** Number of tracks successfully matched (counts `value != null`). */
    get nTracksMatched(): number;
    /**
     * Generate a human-readable summary of the match result (matching.py:1319-1336).
     *
     * Three always-present count lines (no leading space). Only videos get an
     * unmatched listing (first 5 + overflow), 2-space "- " indents. No trailing
     * newline.
     */
    summary(): string;
}
/**
 * Presentation-only progress bar stub (matching.py:1339-1388).
 *
 * The only contract that matters for merge output parity is the
 * `callback(current, total, message)` signature `merge()` calls. There is no
 * tqdm in JS, so the bar is a no-op (optionally logs). The context-manager
 * shape is preserved via `[Symbol.dispose]` (for `using`) and explicit `enter`/
 * `exit` methods.
 */
declare class MergeProgressBar {
    desc: string;
    leave: boolean;
    pbar: unknown;
    constructor(desc?: string, leave?: boolean);
    /** Context-manager enter: returns self. */
    enter(): this;
    /** Context-manager exit: closes the (stub) bar. */
    exit(): void;
    /** `using` support: dispose closes the (stub) bar. */
    [Symbol.dispose](): void;
    /**
     * Progress callback for merge operations. Creates the (stub) bar lazily only
     * when `total` is truthy (nonzero), then records absolute progress. No-op
     * presentation.
     */
    callback(current: number, total: number, message?: string): void;
}
/**
 * Abstract filesystem operations needed by the video file helpers. All methods
 * are async. A browser/no-FS environment supplies a resolver whose methods
 * return the conservative answers (or simply leaves the default, which detects
 * the missing `fs` and degrades).
 */
interface FsResolver {
    /** True if the path exists on disk. */
    exists(path: string): Promise<boolean>;
    /**
     * True if both paths refer to the same file (e.g. via inode `dev`+`ino`).
     * Implementations may throw; callers wrap in try/catch.
     */
    sameFile(path1: string, path2: string): Promise<boolean>;
    /**
     * Canonical absolute path (symlinks resolved when the file exists, else a
     * plain absolute resolution). Used for the resolved-path equality fallback.
     * May throw; callers wrap in try/catch.
     */
    realpath(path: string): Promise<string>;
}
/**
 * Override the filesystem resolver (DECISIONS D7). Pass `null` to clear the
 * explicit override and fall back to the registered default — the Node `fs`
 * resolver in Node builds/tests, or none in the browser bundle (which degrades
 * to the conservative "cannot verify" path). Tests use this to inject a stub.
 */
declare function setFsResolver(resolver: FsResolver | null): void;
/**
 * Matcher for comparing and matching skeletons (matching.py:647-684).
 *
 * @remarks
 * - `requireSameOrder` is consulted ONLY by the STRUCTURE method (EXACT forces
 *   `requireSameOrder=true`).
 * - `minOverlap` is consulted ONLY by the OVERLAP method.
 */
declare class SkeletonMatcher {
    method: SkeletonMatchMethod;
    requireSameOrder: boolean;
    minOverlap: number;
    /**
     * @param method - The matching method (default STRUCTURE). A bare string is
     *   coerced to the enum value and validated (throws on unknown).
     * @param options - `requireSameOrder` (default `false`), `minOverlap`
     *   (default `0.5`).
     */
    constructor(method?: SkeletonMatchMethod | string, options?: {
        requireSameOrder?: boolean;
        minOverlap?: number;
    });
    /**
     * Check if two skeletons match according to the configured method
     * (matching.py:667-684). Dispatch order is load-bearing.
     */
    match(skeleton1: Skeleton, skeleton2: Skeleton): boolean;
}
/**
 * Matcher for comparing and matching instances (matching.py:687-771).
 *
 * @remarks
 * Threshold semantics depend on method: SPATIAL → pixel tolerance, IOU → minimum
 * IoU, IDENTITY → unused.
 */
declare class InstanceMatcher {
    method: InstanceMatchMethod;
    threshold: number;
    /**
     * @param method - The matching method (default SPATIAL). A bare string is
     *   coerced + validated.
     * @param options - `threshold` (default `5.0`).
     */
    constructor(method?: InstanceMatchMethod | string, options?: {
        threshold?: number;
    });
    /**
     * Check if two instances match according to the configured method
     * (matching.py:705-714).
     */
    match(instance1: Instance, instance2: Instance): boolean;
    /**
     * Find all matching instances between two lists (matching.py:716-771).
     *
     * Returns the FULL Cartesian product of `[idx1, idx2, score]` triples for
     * matching pairs (NOT greedy/one-to-one). Output order = nested-loop encounter
     * order (`i` outer, `j` inner). The gate ({@link match}) and the score are
     * computed by SEPARATE code paths, so a subclass that overrides `match()` to
     * always-true still gets a correct (or zero) score.
     */
    findMatches(instances1: Instance[], instances2: Instance[]): [number, number, number][];
}
/**
 * Matcher for comparing and matching tracks (matching.py:774-790).
 *
 * @remarks
 * Delegates to `Track.matches(other, method)`, passing the string VALUE of the
 * configured method ("name" / "identity").
 */
declare class TrackMatcher {
    method: TrackMatchMethod;
    /**
     * @param method - The matching method (default NAME). A bare string is coerced
     *   + validated.
     */
    constructor(method?: TrackMatchMethod | string);
    /** Check if two tracks match according to the configured method. */
    match(track1: Track, track2: Track): boolean;
}
/**
 * Matcher for comparing and matching videos (matching.py:793-1126).
 *
 * @remarks
 * `strict` is consulted ONLY by the PATH method. The AUTO method uses
 * `strict=true` for one internal stage and `strict=false` for another,
 * regardless of `this.strict`. The per-instance `_frameCache` is fresh per
 * matcher and excluded from any equality/repr (it is identity-keyed).
 *
 * Async-ness (DECISIONS D8): the AUTO cascade reaches filesystem checks
 * (`isSameFile`, `originalVideosConflict`, `_fileExists`) and image pixels
 * (`getFrame`), all of which are async, so {@link match} and {@link findMatch}
 * return `Promise`. Every FS/image helper is awaited (a non-awaited Promise is
 * truthy and would cause false matches).
 */
declare class VideoMatcher {
    method: VideoMatchMethod;
    strict: boolean;
    contentFrames: number;
    comparePredictions: string | boolean;
    compareImages: boolean;
    imageSimilarityThreshold: number;
    /** Fresh, reference-keyed per matcher; NOT a constructor argument. */
    private _frameCache;
    /**
     * @param method - The matching method (default AUTO). A bare string is coerced
     *   + validated.
     * @param options - `strict` (default `false`), `contentFrames` (default `3`),
     *   `comparePredictions` (default `"auto"`), `compareImages` (default
     *   `false`), `imageSimilarityThreshold` (default `0.05`).
     */
    constructor(method?: VideoMatchMethod | string, options?: {
        strict?: boolean;
        contentFrames?: number;
        comparePredictions?: string | boolean;
        compareImages?: boolean;
        imageSimilarityThreshold?: number;
    });
    /**
     * Get frame instances with reference-keyed caching (matching.py:834-850).
     * Avoids recomputing the per-video frame map during a merge.
     */
    private _getCachedFrameInstances;
    /**
     * Check if two videos match according to the configured method
     * (matching.py:852-897) — PAIRWISE (NOT the full AUTO cascade).
     *
     * For AUTO this performs rejection checks + definitive identity + path match;
     * for the full AUTO matching with leaf-uniqueness use {@link findMatch}.
     *
     * Async because the AUTO branch awaits `isSameFile` / `originalVideosConflict`.
     */
    match(video1: Video, video2: Video): Promise<boolean>;
    /**
     * Find a matching video from `candidates` using the configured method
     * (matching.py:899-1031). Returns a `Video` from `candidates` (by reference)
     * or `null`.
     *
     * Non-AUTO: first candidate where `this.match(candidate, incoming)` is true.
     * AUTO: the exact 6-stage safe cascade (file identity → strict path → leaf-path
     * uniqueness at increasing depth → pose matching → image matching → null).
     *
     * Async (DECISIONS D8): awaits FS + pixel helpers throughout.
     */
    findMatch(incoming: Video, candidates: Video[], opts?: {
        labelsIncoming?: Labels | null;
        labelsBase?: Labels | null;
    }): Promise<Video | null>;
    /**
     * Try to match a video by comparing pose annotations (matching.py:1033-1091).
     *
     * Resolves `includePredictions` separately for incoming and EACH candidate;
     * uses the reference-keyed frame cache; for each candidate computes the common
     * frame-index intersection, requires `min(contentFrames, common.size)` matching
     * sampled frames (sampling up to `contentFrames * 2`), and short-circuits the
     * moment the count reaches `required`. Returns the matched candidate or `null`.
     */
    private _matchByPoses;
    /**
     * Try to match a video by comparing image content (matching.py:1093-1126).
     *
     * Only used when `compareImages` is true (expensive). Same control flow as
     * {@link _matchByPoses} but over common EMBEDDED frame indices, using
     * pixel-similarity (`imageSimilarityThreshold`). Returns the matched candidate
     * or `null`.
     */
    private _matchByImages;
}
declare const STRUCTURE_SKELETON_MATCHER: SkeletonMatcher;
declare const SUBSET_SKELETON_MATCHER: SkeletonMatcher;
declare const OVERLAP_SKELETON_MATCHER: SkeletonMatcher;
declare const DUPLICATE_MATCHER: InstanceMatcher;
declare const IOU_MATCHER: InstanceMatcher;
declare const IDENTITY_INSTANCE_MATCHER: InstanceMatcher;
declare const NAME_TRACK_MATCHER: TrackMatcher;
declare const IDENTITY_TRACK_MATCHER: TrackMatcher;
declare const AUTO_VIDEO_MATCHER: VideoMatcher;
declare const PATH_VIDEO_MATCHER: VideoMatcher;
declare const BASENAME_VIDEO_MATCHER: VideoMatcher;
declare const IMAGE_DEDUP_VIDEO_MATCHER: VideoMatcher;
declare const SHAPE_VIDEO_MATCHER: VideoMatcher;

/** Strategy for merging annotation lists between frames. */
type MergeStrategy = "keep_both" | "keep_original" | "keep_new" | "replace_predictions" | "auto" | "update_tracks";
/** Union of all annotation types stored on a LabeledFrame. */
type Annotation = Centroid | BoundingBox | SegmentationMask | LabelImage | ROI;
/** Annotation attribute names on LabeledFrame. */
type AnnotationAttr = "centroids" | "bboxes" | "masks" | "labelImages" | "rois";
/**
 * Extract centroid (x, y) from an annotation based on its modality.
 *
 * @returns A tuple of [x, y] coordinates, or null if the centroid cannot be
 *   computed (e.g., empty mask or empty ROI geometry).
 */
declare function _annotationCentroidXy(annotation: Annotation, attr: AnnotationAttr): [number, number] | null;
/**
 * Find matching annotations between two lists by centroid distance.
 *
 * @returns List of {selfIdx, otherIdx, score} where score = 1 / (1 + distance).
 *
 * NOTE: O(n*m) brute-force without bipartite assignment. Callers are
 * responsible for resolving many-to-one conflicts (e.g., greedy 1:1 in
 * _resolveAnnotationAuto). Fine for typical annotation counts per frame.
 */
declare function _findAnnotationMatches(selfList: Annotation[], otherList: Annotation[], attr: AnnotationAttr, threshold: number): Array<{
    selfIdx: number;
    otherIdx: number;
    score: number;
}>;
/**
 * Find provenance-link matches between two annotation lists.
 *
 * A user annotation in one list is "linked" to a prediction in the other list
 * when its `fromPredicted` reference points (by object identity) at that
 * prediction. Such matches are scored `Infinity` so the greedy 1:1 pass in
 * {@link _resolveAnnotationAuto} prefers them and bypasses the spatial distance
 * threshold entirely (an explicit link always beats spatial proximity).
 *
 * Generic over modality via `(ann as any).fromPredicted`: only segmentation
 * masks carry a `fromPredicted` link today, so other annotation types produce
 * zero link matches and behave exactly as before.
 *
 * @returns List of {selfIdx, otherIdx, score} with score = Infinity. Links are
 *   detected in both directions (a user in self pointing into other, and a user
 *   in other pointing into self).
 */
declare function _findAnnotationLinkMatches(selfList: Annotation[], otherList: Annotation[]): Array<{
    selfIdx: number;
    otherIdx: number;
    score: number;
}>;
/**
 * Resolve the `isNegative` flag for a merged frame
 * (labeled_frame.py:204-226).
 *
 * A frame asserted as negative (background) by either side of a merge stays
 * negative, unless the merge produced a real user pose -- a frame with a
 * labeled animal is not a background frame. Predicted instances do not cancel
 * the flag, keeping the predict -> merge-back workflow correct.
 *
 * @param selfNeg - The `isNegative` flag of the base frame.
 * @param otherNeg - The `isNegative` flag of the incoming frame.
 * @param merged - The merged instance list.
 * @returns A tuple `[resolved, conflict]` where `resolved` is the merged
 *   `isNegative` value and `conflict` is `true` if a negative flag was dropped
 *   because the merge produced a user pose.
 */
declare function _resolveMergedIsNegative(selfNeg: boolean, otherNeg: boolean, merged: Array<Instance | PredictedInstance>): [boolean, boolean];
declare class LabeledFrame {
    video: Video;
    frameIdx: number;
    instances: Array<Instance | PredictedInstance>;
    isNegative: boolean;
    centroids: Centroid[];
    bboxes: BoundingBox[];
    masks: SegmentationMask[];
    labelImages: LabelImage[];
    rois: ROI[];
    constructor(options: {
        video: Video;
        frameIdx: number;
        instances?: Array<Instance | PredictedInstance>;
        isNegative?: boolean;
        centroids?: Centroid[];
        bboxes?: BoundingBox[];
        masks?: SegmentationMask[];
        labelImages?: LabelImage[];
        rois?: ROI[];
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
    /**
     * Predicted masks in this frame that have not been adopted by a user mask.
     *
     * The mask analogue of {@link unusedPredictions}. A prediction is considered
     * adopted (and therefore excluded) when a user mask in the same frame:
     *   1. links to it via `fromPredicted` (checked FIRST, by object identity), or
     *   2. lacking such a link, spatially overlaps it (bbox-centroid within 5 px,
     *      the auto-merge default).
     *
     * Predictions that no user mask claims by either rule are returned, e.g. for
     * surfacing them in a proofreading UI.
     */
    get unusedPredictedMasks(): PredictedSegmentationMask[];
    removePredictions(): void;
    /**
     * Merge annotation lists from another frame into this frame.
     *
     * Shallow-copies annotations from the other frame to avoid mutating the
     * source when references are later remapped. Video and track references
     * are preserved so that remapping can find them in the mapping dicts.
     *
     * @param other - The frame to merge annotations from.
     * @param strategy - The merge strategy. Controls which annotations are kept:
     *   - "keep_original": Keep self only.
     *   - "keep_new": Replace with other's annotations.
     *   - "keep_both": Keep self + add other's (default).
     *   - "replace_predictions": Keep user from self, add predicted from other.
     *   - "auto": Spatial matching + user-vs-predicted resolution cascade.
     *   - "update_tracks": Spatial matching, then update track assignments.
     * @param threshold - Maximum centroid distance (pixels) for spatial matching
     *   in "auto" and "update_tracks" strategies.
     */
    mergeAnnotations(other: LabeledFrame, strategy?: MergeStrategy, threshold?: number): void;
    /**
     * Merge instances from another frame into this frame
     * (labeled_frame.py:530-702).
     *
     * The merged instance list is RETURNED (not assigned back) so the caller can
     * decide what to do with it. Frame-level annotations (centroids, bboxes,
     * masks, label images, rois) and the `isNegative` flag ARE updated on this
     * frame in place.
     *
     * Instances added from `other` (in the auto/replace/update strategies) are
     * the ORIGINAL `other` objects, NOT copies, so they alias the other frame's
     * instances. Skeleton/track remap of merged instances is handled by the
     * `Labels.merge` driver, not here.
     *
     * @param other - Another LabeledFrame to merge instances from.
     * @param opts.instance - Matcher to use for finding duplicate instances. If
     *   omitted, uses default spatial matching with 5px tolerance.
     * @param opts.frame - The merge strategy string (default `"auto"`). One of:
     *   `"auto"`, `"keep_original"`, `"keep_new"`, `"keep_both"`,
     *   `"update_tracks"`, `"replace_predictions"`. Any other string falls
     *   through to the auto branch.
     * @returns A tuple `[mergedInstances, conflicts]` where `conflicts` is a list
     *   of `[selfInst, otherInst, resolution]` tuples.
     */
    merge(other: LabeledFrame, opts?: {
        instance?: InstanceMatcher;
        frame?: string;
    }): [
        Array<Instance | PredictedInstance>,
        Array<[Instance, Instance, string]>
    ];
    /**
     * Append an annotation to this frame, routing to the correct list by type.
     *
     * @param annotation - Any annotation type: Instance, PredictedInstance,
     *   Centroid, BoundingBox, SegmentationMask, LabelImage, or ROI.
     * @throws TypeError if the annotation type is not recognized.
     */
    append(annotation: Instance | PredictedInstance | Centroid | BoundingBox | SegmentationMask | LabelImage | ROI): void;
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
    _centroidByFrame: Map<string, Centroid[]>;
    _bboxByFrame: Map<string, BoundingBox[]>;
    _maskByFrame: Map<string, SegmentationMask[]>;
    _labelImageByFrame: Map<string, LabelImage[]>;
    _roiByFrame: Map<string, ROI[]>;
    _undistributedCentroids: Centroid[];
    _undistributedBboxes: BoundingBox[];
    _undistributedMasks: SegmentationMask[];
    _undistributedLabelImages: LabelImage[];
    _undistributedRois: ROI[];
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
    /**
     * Create an independent copy of this store's raw column data.
     * Videos, skeletons, and tracks arrays are shared (not cloned) —
     * the caller is expected to replace them with new references.
     */
    copy(): LazyDataStore;
    /** Total number of frames in the store. */
    get frameCount(): number;
    /**
     * Materialize a single LabeledFrame by index.
     */
    materializeFrame(frameIdx: number): LabeledFrame | null;
    /**
     * Convert lazy-mode labels to a dense `[frames, tracks, nodes, coords]` array
     * directly from raw column data without materializing any LabeledFrame or
     * Instance objects. Coords is `[x, y]` or `[x, y, score]` when
     * `returnConfidence` is true.
     *
     * @param options.numFrames Optional explicit length of the output's frame
     *   dimension. Takes precedence over `video.shape[0]` (the inferred fallback).
     *   Useful when `video.shape` is null — for example, Mp4Box-backed browser
     *   videos — and you still want a video-length-sized array. If smaller than
     *   `maxLabeledFrame + 1`, it is clamped up so no labeled frames are dropped.
     *   Non-finite, non-positive, or fractional values are sanitized via
     *   `Math.floor` and ignored when `<= 0`.
     */
    toNumpy(options?: {
        video?: Video;
        returnConfidence?: boolean;
        numFrames?: number;
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
    _supplementary: LabeledFrame[];
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

declare class Labels {
    labeledFrames: LabeledFrame[];
    videos: Video[];
    skeletons: Skeleton[];
    tracks: Track[];
    suggestions: SuggestionFrame[];
    sessions: RecordingSession[];
    provenance: Record<string, unknown>;
    identities: Identity[];
    _staticRois: ROI[];
    /** @internal Lazy frame list for on-demand materialization. */
    _lazyFrameList: LazyFrameList | null;
    /** @internal Lazy data store holding raw HDF5 data. */
    _lazyDataStore: LazyDataStore | null;
    private _frameIndex;
    private _frameIndexLen;
    private _trackIndex;
    private _trackIndexLen;
    constructor(options?: {
        labeledFrames?: LabeledFrame[];
        videos?: Video[];
        skeletons?: Skeleton[];
        tracks?: Track[];
        suggestions?: SuggestionFrame[];
        sessions?: RecordingSession[];
        provenance?: Record<string, unknown>;
        rois?: ROI[];
        identities?: Identity[];
    });
    /** Collect tracks from annotations on a frame into this.tracks. */
    private _collectAnnotationTracks;
    /** Raise if Labels is lazy-loaded. */
    private _checkNotLazy;
    /** Clear all cached indices so they rebuild on next access. */
    private _invalidateIndices;
    /** Build or return the frame index, rebuilding if stale. */
    private _ensureFrameIndex;
    /** Build or return the track index, rebuilding if stale. */
    private _ensureTrackIndex;
    /**
     * O(1) lookup of a LabeledFrame by video and frame index.
     *
     * The index is rebuilt lazily. If you mutate frames directly (e.g.,
     * `lf.frameIdx = newIdx`) without calling `reindex()`, the lookup may
     * return stale results.
     */
    getFrame(video: Video, frameIdx: number): LabeledFrame | null;
    /**
     * O(1) lookup of all annotations for a track in a video, sorted by frameIdx.
     *
     * The index is rebuilt lazily. If you mutate frames directly (e.g.,
     * `lf.frameIdx = newIdx`) without calling `reindex()`, the lookup may
     * return stale results.
     */
    getTrackAnnotations(video: Video, track: Track): Array<Centroid | BoundingBox | SegmentationMask | ROI | LabelImage | Instance | PredictedInstance>;
    /** Force rebuild of all indices on next access. */
    reindex(): void;
    /**
     * Remove all predicted instances and predicted annotations from all frames.
     *
     * Mirrors Python `Labels.remove_predictions` (labels.py:1684-1710).
     *
     * @param clean - If `true` (the default), also prune empty frames and unused
     *   skeletons/tracks via {@link clean} with `frames`, `skeletons`, `tracks`
     *   enabled and `emptyInstances`/`videos` disabled. Does NOT remove videos
     *   with no labeled frames, nor instances with no visible points.
     */
    removePredictions(clean?: boolean): void;
    /**
     * Collapse structurally-equal skeletons into a single canonical entry.
     *
     * Skeletons are partitioned via {@link Skeleton.matches} called with
     * `requireSameOrder: true` (same node count, same node names IN THE SAME
     * ORDER, same edge set, and same symmetry set). The first member of each
     * equivalence class is kept as canonical; the rest are removed from
     * `this.skeletons` and every instance referencing a non-canonical skeleton is
     * reassigned to the canonical via direct property assignment. Points are
     * positional and are NOT remapped, so order-identical matching is required to
     * keep reassignment safe.
     *
     * Note: skeleton `name` is not part of `matches()` — the canonical's name wins.
     *
     * Note: skeletons that share node names but differ in node ORDER are treated
     * as distinct here (they are not collapsed), since collapsing them would
     * misalign instance points.
     *
     * Legacy `.slp` files often carry content-duplicate skeletons (a pre-1.5 Python
     * sleap quirk). Call this method after `loadSlp` if you want them collapsed —
     * it is not run automatically on load.
     *
     * In lazy mode this forces full materialization, consistent with other Labels
     * mutators.
     *
     * @returns Number of duplicate skeletons collapsed (0 if none).
     */
    dedupSkeletons(): {
        canonicalized: number;
    };
    /** Flat view of all centroids across all frames. */
    get centroids(): Centroid[];
    /** Flat view of all bounding boxes across all frames. */
    get bboxes(): BoundingBox[];
    /** Flat view of all segmentation masks across all frames. */
    get masks(): SegmentationMask[];
    /** Flat view of all label images across all frames. */
    get labelImages(): LabelImage[];
    /** Flat view of all ROIs across all frames and static ROIs. */
    get rois(): ROI[];
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
    /**
     * Search for labeled frames given video and/or frame index.
     *
     * A foreign `Video` instance or filename (`string`/`URL`) is resolved to the
     * matching `Video` in `this.videos` via {@link _resolveVideo} (SYNC; see its
     * documented divergence from `matchVideo`), so an object created independently
     * still works. When the video does not resolve to a project video the foreign
     * reference is used as-is, so identity-based lookups yield no results.
     */
    find(options: {
        video?: Video | string | URL;
        frameIdx?: number;
    }): LabeledFrame[];
    addVideo(video: Video): void;
    append(frame: LabeledFrame): void;
    /**
     * Add a static ROI (not tied to any specific frame, e.g., an arena boundary).
     *
     * Registers the ROI's track (if any) on `this.tracks`. Use
     * `lf.append(roi)` on a `LabeledFrame` to add a frame-bound ROI instead.
     */
    addStaticRoi(roi: ROI): void;
    toDict(options?: {
        video?: Video | number;
        skipEmptyFrames?: boolean;
    }): LabelsDict;
    /** Static ROIs (not attached to any LabeledFrame). */
    get staticRois(): ROI[];
    /** Frame-bound ROIs (attached to LabeledFrames). */
    get temporalRois(): ROI[];
    /**
     * Filter ROIs across the Labels object.
     *
     * Filtering rule (matches sibling getters like `getMasks`/`getBboxes`):
     *   - Frame-aware filters (`video` or `frameIdx`) walk only `labeledFrames`.
     *     Static ROIs are excluded from these results.
     *   - Otherwise (no filter, or only `category`/`track`/`instance`/`predicted`)
     *     the search runs over `this.rois` — the union of static + frame-bound.
     *
     * To access static ROIs directly, use `staticRois`. To access only frame-bound
     * ROIs across all frames, use `temporalRois`.
     */
    getRois(filters?: {
        video?: Video | string | URL;
        frameIdx?: number;
        category?: string;
        track?: Track;
        instance?: Instance | PredictedInstance;
        predicted?: boolean;
    }): ROI[];
    getMasks(filters?: {
        video?: Video | string | URL;
        frameIdx?: number;
        category?: string;
        track?: Track;
        instance?: Instance | PredictedInstance;
        predicted?: boolean;
    }): SegmentationMask[];
    getBboxes(filters?: {
        video?: Video | string | URL;
        frameIdx?: number;
        category?: string;
        track?: Track;
        instance?: Instance;
        predicted?: boolean;
    }): BoundingBox[];
    getCentroids(filters?: {
        video?: Video | string | URL;
        frameIdx?: number;
        category?: string;
        track?: Track;
        instance?: Instance | PredictedInstance;
        predicted?: boolean;
    }): Centroid[];
    getLabelImages(filters?: {
        video?: Video | string | URL;
        frameIdx?: number;
        track?: Track;
        category?: string;
        predicted?: boolean;
    }): LabelImage[];
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
    }): void;
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
    copy(options?: {
        openVideos?: boolean;
    }): Labels;
    static fromNumpy(data: number[][][][], options: {
        videos?: Video[];
        video?: Video;
        skeletons?: Skeleton[] | Skeleton;
        skeleton?: Skeleton;
        trackNames?: string[];
        firstFrame?: number;
        returnConfidence?: boolean;
    }): Labels;
    /**
     * Convert labels to a dense `[frames, tracks, nodes, coords]` array.
     *
     * @param options.numFrames Optional explicit length of the output's frame
     *   dimension. Takes precedence over `video.shape[0]` (the inferred fallback).
     *   Useful when `video.shape` is null — for example, Mp4Box-backed browser
     *   videos — and you still want a video-length-sized array. If smaller than
     *   `maxLabeledFrame + 1`, it is clamped up so no labeled frames are dropped.
     *   Non-finite, non-positive, or fractional values are sanitized via
     *   `Math.floor` and ignored when `<= 0`.
     */
    /**
     * Build a dense `(frames, tracks, nodes, channels)` array from instance points.
     *
     * A foreign `Video` instance or filename (`string`/`URL`) is resolved to the
     * matching project `Video` via {@link _resolveVideo} (SYNC; see its documented
     * divergence from `matchVideo`). When `options.video` is absent, defaults to
     * `this.video` (the first video).
     */
    numpy(options?: {
        video?: Video | string | URL;
        returnConfidence?: boolean;
        numFrames?: number;
    }): number[][][][];
    /**
     * Update data structures based on contents.
     *
     * Repopulates `videos`, `skeletons`, and `tracks` from the labeled frames,
     * their instances and nested annotations, and the suggestions. Existing
     * entries are preserved (in order); only missing ones are appended.
     *
     * Mirrors Python `Labels.update` (labels.py:435-457).
     */
    update(): void;
    /**
     * Remap video and track references on a frame's annotations in place.
     *
     * Mirrors Python `Labels._remap_frame_annotations` (labels.py:3621-3648).
     * Centroids/bboxes/masks: only `.track` is remapped. ROIs: both `.video` and
     * `.track`. Label-image objects: nested `info.track` only. Membership is by
     * reference via `Map.has`/`Map.get` (never a `?? default`), so a track/video
     * absent from the map is left untouched.
     *
     * @param frame - LabeledFrame whose annotations should be remapped.
     * @param videoMap - Map from old videos to new videos.
     * @param trackMap - Map from old tracks to new tracks.
     */
    static _remapFrameAnnotations(frame: LabeledFrame, videoMap: Map<Video, Video>, trackMap: Map<Track, Track>): void;
    /**
     * Map an instance to use mapped skeleton and track, returning a NEW instance.
     *
     * Mirrors Python `Labels._map_instance` (labels.py:3650-3687). The source
     * instance is never mutated: its points are deep-copied and the returned
     * instance is a fresh object of the SAME exact type (`Instance` vs
     * `PredictedInstance`, dispatched via `constructor ===`). Skeleton/track are
     * resolved through the maps with `?? original` fallback.
     *
     * @param instance - Instance to map.
     * @param skeletonMap - Map from old skeletons to new skeletons.
     * @param trackMap - Map from old tracks to new tracks.
     * @returns New instance with mapped skeleton and track.
     */
    _mapInstance(instance: Instance | PredictedInstance, skeletonMap: Map<Skeleton, Skeleton>, trackMap: Map<Track, Track>): Instance | PredictedInstance;
    /**
     * Merge another `Labels` object into this one in place.
     *
     * Faithful port of Python `Labels.merge` (labels.py:3149-3618). Runs the fixed
     * 5-step pipeline (skeletons -> videos -> tracks -> frames -> suggestions),
     * building reference-keyed maps FROM `other`'s objects TO `self`'s objects (or
     * to a newly-appended `other` object), and returns a {@link MergeResult}.
     *
     * Async (DECISIONS D8): the AUTO video cascade awaits filesystem and pixel
     * reads. Coercion of the matcher/error-mode arguments happens BEFORE the merge
     * body, so a bad method/error-mode string propagates (it is NOT collected into
     * the result).
     *
     * @param other - The `Labels` to merge into `self`.
     * @param opts.skeleton - Skeleton matcher (`null` -> STRUCTURE; string ->
     *   validated; else used as-is).
     * @param opts.video - Video matcher (`null` -> AUTO).
     * @param opts.track - Track matcher (`null` -> NAME).
     * @param opts.frame - The frame merge strategy as a RAW string (default
     *   `"auto"`; NOT validated against the enum — an invalid value falls through
     *   `LabeledFrame.merge`'s strategy chain into the AUTO branch).
     * @param opts.instance - Instance matcher (`null` -> SPATIAL/5.0).
     * @param opts.validate - If `true` (default), an unmatched skeleton under
     *   STRICT raises `SkeletonMismatchError`.
     * @param opts.progressCallback - Called `(current, total, message)` per frame
     *   and once at the end.
     * @param opts.errorMode - `"continue"` (default), `"strict"`, or `"warn"`.
     */
    merge(other: Labels, opts?: {
        skeleton?: string | SkeletonMatcher | null;
        video?: string | VideoMatcher | null;
        track?: string | TrackMatcher | null;
        frame?: string;
        instance?: string | InstanceMatcher | null;
        validate?: boolean;
        progressCallback?: (current: number, total: number, message: string) => void;
        errorMode?: string;
    }): Promise<MergeResult>;
    /**
     * Build correspondence maps between this `Labels` and another WITHOUT mutating
     * either (read-only twin of {@link merge}).
     *
     * Faithful port of Python `Labels.match` (labels.py:3020-3147). Coerces only
     * the video/skeleton/track matchers (NO instance matcher, NO error mode). No
     * lazy guard, no try/except, no provenance, no mutation. AUTO videos use the
     * full `findMatch` cascade; every other method (including IMAGE_DEDUP/SHAPE)
     * uses a simple first-match-wins loop. Unmatched -> `null`.
     *
     * Async (DECISIONS D8): the AUTO cascade awaits filesystem/pixel reads.
     *
     * @param other - The `Labels` to match against (maps `other` -> `self`).
     * @param opts.video - Video matcher (`null` -> AUTO).
     * @param opts.skeleton - Skeleton matcher (`null` -> STRUCTURE).
     * @param opts.track - Track matcher (`null` -> NAME).
     */
    match(other: Labels, opts?: {
        video?: string | VideoMatcher | null;
        skeleton?: string | SkeletonMatcher | null;
        track?: string | TrackMatcher | null;
    }): Promise<MatchResult>;
    /**
     * Resolve a video argument to the canonical `Video` in this `Labels` (SYNC).
     *
     * Mirrors Python `Labels._resolve_video` (labels.py:1346-1374). Used internally
     * by the video-accepting query methods ({@link find}, {@link numpy},
     * {@link extract}, and the `get*` family) to canonicalize a foreign `Video`,
     * filename, or index so that identity-based lookups succeed.
     *
     * DOCUMENTED DIVERGENCE (DECISIONS-107): unlike the async {@link matchVideo},
     * this resolver is SYNCHRONOUS and therefore does NOT perform inode/pose/image
     * matching. It uses only the synchronous matching subset:
     *   1. identity (`===`),
     *   2. unique `v.matchesPath(query, true)` (strict; posix-normalized),
     *   3. unique `v.matchesPath(query, false)` (basename),
     * raising on ambiguity (>1 match at a tier) with messages mirroring
     * {@link matchVideo}. For all in-memory and non-existent-file lookups (the
     * realistic case) this is observably identical to Python's `match_video`-based
     * resolution, since strict `matchesPath` already does normalized path equality.
     *
     * @param video - A `Video`, filename (`string`/`URL`), integer index into
     *   `this.videos`, or `null`/`undefined`.
     * @returns The canonical `Video`, or `null` if `video` is `null`/`undefined`.
     *   If no video matches, the foreign `Video` is returned unchanged and a
     *   path is coerced into a new (unopened) `Video`, so identity-based lookups
     *   simply yield empty results (preserving the "no match" behavior).
     */
    private _resolveVideo;
    /**
     * Resolve a foreign `Video` or path to the canonical `Video` in `this.videos`.
     *
     * Faithful port of Python `Labels.match_video` (labels.py:1216-1344). Uses its
     * OWN simpler cascade (NOT `findMatch`). Method validation runs BEFORE the
     * identity short-circuit. RAISES on ambiguity (>1 candidate), unlike
     * {@link match} which silently takes the first.
     *
     * Async (DECISIONS D8): the file-identity tier awaits `isSameFile` / FS checks.
     *
     * @param videoOrPath - A `Video`, or a filename string (wrapped in an unopened
     *   `Video`).
     * @param method - `"auto"` (default), another method string, or a
     *   `VideoMatcher`. AUTO (string or matcher) uses the tiered cascade.
     * @returns The canonical `Video` from `this.videos`, or `null` if none match.
     */
    matchVideo(videoOrPath: Video | string, method?: string | VideoMatcher): Promise<Video | null>;
    /**
     * Remove empty frames, unused skeletons, tracks and videos.
     *
     * Mirrors Python `Labels.clean` (labels.py:1577-1682). In-place, returns
     * void. This is an explicit opt-in operation (never auto-run on load).
     *
     * @param opts.frames - If `true` (default), remove empty frames. Negative
     *   frames (`isNegative === true`) and annotation-only frames are preserved.
     * @param opts.emptyInstances - If `true` (NOT default), remove instances with
     *   no visible points (before the emptiness check).
     * @param opts.skeletons - If `true` (default), remove unused skeletons.
     * @param opts.tracks - If `true` (default), remove unused tracks and the
     *   annotations/objects that reference removed tracks (track=null is always
     *   preserved).
     * @param opts.videos - If `true` (NOT default), remove videos with no labeled
     *   frames.
     */
    clean(opts?: {
        frames?: boolean;
        emptyInstances?: boolean;
        skeletons?: boolean;
        tracks?: boolean;
        videos?: boolean;
    }): void;
    /**
     * Extract a set of frames into a new Labels object.
     *
     * Mirrors Python `Labels.extract` (labels.py:2482-2551). Copies the selected
     * frames and their reachable graph (instances/skeletons/tracks/videos/
     * annotations) with structural sharing (each shared object copied once), keeps
     * the relative ordering of tracks/skeletons by NAME, copies/dedups suggestions
     * for the extracted videos, and records the source labels in provenance.
     *
     * @param inds - Frame selection: an array of integer indices, an array of
     *   `[Video, frameIdx]` tuples, or a single `Video` (all of its frames). A
     *   foreign `Video`/filename (`string`/`URL`) selector or tuple element is
     *   resolved to the matching project `Video` via {@link _resolveVideo} (SYNC;
     *   see its documented divergence from `matchVideo`).
     * @param copy - If `true` (default), deep-copy the frames and containing
     *   objects; otherwise share references with this Labels.
     * @returns A new `Labels` containing the selected frames.
     */
    extract(inds: number[] | Array<[Video | string | URL, number]> | Video | string | URL, copy?: boolean): Labels;
    /**
     * Canonicalize an {@link extract} selector, resolving foreign `Video` /
     * filename references to the matching project `Video` via {@link _resolveVideo}
     * (SYNC). The `number[]` index-array path is returned unchanged. Returns a
     * narrowed selector that {@link _selectFrames} can consume directly.
     */
    private _resolveExtractInds;
    /**
     * Resolve an extraction selection to a list of LabeledFrame references.
     *
     * Supports the subset of Python `__getitem__` selectors needed by
     * `extract`/`split`: integer index arrays, `[Video, frameIdx]` tuple arrays,
     * and a single `Video`. Foreign `Video`/filename references are canonicalized
     * by {@link _resolveExtractInds} before reaching this method, so it receives
     * canonical project `Video` instances.
     */
    private _selectFrames;
    /**
     * Deep-copy a list of frames with structural sharing.
     *
     * Reproduces Python `deepcopy(lfs)`: shared Track/Skeleton/Video objects within
     * the selected subgraph are copied exactly once (via memo maps), so references
     * shared across frames/instances remain shared in the copy.
     */
    private _deepCopyFrames;
    /**
     * Separate the labels into two random splits.
     *
     * Mirrors Python `Labels.split` (labels.py:2553-2607) for the count/branch
     * logic. Per DECISIONS D5, the index selection uses a deterministic seeded
     * RNG (NOT NumPy PCG64) — counts and edge cases match Python exactly, but the
     * specific frames chosen are not bit-identical to NumPy.
     *
     * @param n - Size of the first split. `>= 1` is an absolute frame count;
     *   `< 1.0` is a fraction of the total (`max(trunc(n0*n), 1)`).
     * @param seed - Optional integer seed for reproducibility within JS. When
     *   omitted/null, a fixed default seed is used.
     * @returns A `LabelsSet` with keys `"split1"` and `"split2"`.
     */
    split(n: number, seed?: number | null): LabelsSet;
    /** Deterministic 32-bit RNG (mulberry32). Returns floats in [0, 1). */
    private static _mulberry32;
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
 * Reads one frame at a time via hyperslab slicing (issue #135) rather than
 * loading and caching the entire per-video dataset. Supports 2D padded, 1D
 * concatenated (with `frame_sizes`), and variable-length (vlen) blob layouts;
 * see {@link readEmbeddedFrameBytes}.
 */
declare class StreamingHdf5VideoBackend implements VideoBackend {
    filename: string;
    dataset?: string | null;
    shape?: [number, number, number, number];
    fps?: number;
    /** Source frame numbers with a stored image (storage order). */
    frameNumbers: number[];
    private h5file;
    private datasetPath;
    private frameNumberToIndex;
    private format;
    private channelOrder;
    private frameSizes;
    private legacy;
    private metaCache;
    constructor(options: {
        filename: string;
        h5file: StreamingH5File;
        datasetPath: string;
        frameNumbers?: number[];
        frameSizes?: number[];
        format?: string;
        channelOrder?: string;
        shape?: [number, number, number, number];
        fps?: number;
    });
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    probeShape(sourceFrameCount?: number): Promise<void>;
    /** Build a single-frame reader bound to the streaming worker file. */
    private buildReader;
    close(): void;
}

/**
 * Random-access reader over the bytes of a `.seq` file. Implementations: a
 * `Blob` (browser) and an injected `node:fs`-backed source (Node, registered by
 * `seq-node.ts`).
 */
interface ByteSource {
    /** Total size of the source in bytes. */
    size(): Promise<number>;
    /** Read `length` bytes starting at `offset` (clamped to EOF). */
    read(offset: number, length: number): Promise<Uint8Array>;
    /** Release any underlying handle. */
    close(): void;
}
/** `Blob`/`File`-backed byte source (browser-safe). */
declare class BlobByteSource implements ByteSource {
    private blob;
    constructor(blob: Blob);
    size(): Promise<number>;
    read(offset: number, length: number): Promise<Uint8Array>;
    close(): void;
}
/** Parsed header of a Norpix `.seq` file (port of Python `SeqHeader`). */
declare class SeqHeader {
    magic: number;
    name: string;
    version: number;
    headerSize: number;
    description: string;
    width: number;
    height: number;
    bitDepth: number;
    bitDepthReal: number;
    imageSizeBytes: number;
    imageFormat: number;
    numFrames: number;
    trueImageSize: number;
    fps: number;
    codec: string;
    /** Human-readable codec name (e.g. `"monoraw"`). */
    get codecName(): string;
    /** Whether frames use variable-length compression (JPEG/PNG). */
    get isCompressed(): boolean;
    /** Number of color channels (`bitDepth / bitDepthReal`). */
    get numChannels(): number;
    /**
     * Parse the 1024-byte header from a byte buffer.
     *
     * @throws If the buffer is too small or has an invalid magic number.
     */
    static fromBytes(raw: Uint8Array): SeqHeader;
}
/** Frame seek index for a `.seq` file (port of Python `SeqIndex`). */
declare class SeqIndex {
    offsets: number[];
    numFrames: number;
    /** Per-frame timestamp size in bytes (6 for version < 5, else 8). */
    timestampSize: number;
    constructor(offsets: number[], numFrames: number, timestampSize: number);
    /** Byte offset for a frame. @throws If out of range. */
    frameOffset(frame: number): number;
    /** Build the index for uncompressed formats (constant frame stride). */
    static buildUncompressed(header: SeqHeader): SeqIndex;
    /**
     * Build the index for compressed formats by scanning the file.
     *
     * Compressed frames are variable-length, so the file is scanned sequentially:
     * each frame begins with a uint32 size; the next frame is located by probing
     * for the next `size + magic` past the timestamp, allowing small even padding.
     */
    static buildCompressed(source: ByteSource, header: SeqHeader): Promise<SeqIndex>;
}
/**
 * Video backend for reading Norpix `.seq` files.
 *
 * Supported codecs: `monoraw` (grayscale raw), `raw` (BGR raw → RGB),
 * `monojpg`/`jpg` (JPEG), `monopng`/`png` (PNG). Bayer codecs are unsupported.
 *
 * Construct via {@link SeqVideoBackend.create} (async; parses the header, builds
 * the seek index, and computes FPS from timestamps).
 */
declare class SeqVideoBackend implements VideoBackend {
    filename: string;
    dataset?: string | null;
    shape: [number, number, number, number];
    fps?: number;
    private source;
    private headerData;
    private index;
    private constructor();
    /** Open a `.seq` file from a path (Node) or a `File`/`Blob` (browser). */
    static create(source: string | File | Blob): Promise<SeqVideoBackend>;
    /** The parsed `.seq` header. */
    get header(): SeqHeader;
    /** Number of frames in the video. */
    get numFrames(): number;
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    /**
     * Absolute per-frame timestamps as seconds since the Unix epoch (Python
     * `get_timestamps` parity).
     */
    getTimestamps(): Promise<number[]>;
    /** Absolute timestamp (seconds since epoch) for a single frame. */
    getTimestamp(frameIndex: number): Promise<number>;
    /**
     * Presentation times in seconds relative to the first frame (consistent with
     * the other backends' {@link VideoBackend.getFrameTimes}). For absolute
     * timestamps use {@link getTimestamps}.
     */
    getFrameTimes(): Promise<number[] | null>;
    close(): void;
}

/** Supported video backend identifiers for user selection. */
type VideoBackendType = "mp4box" | "mediabunny" | "media";
/**
 * Thrown when a video file's container/codec cannot be decoded by any available
 * web backend (e.g. `.avi`, `.mpeg`, `.mpg`). This is a clean, catchable signal
 * so callers can show an actionable "unsupported format" message instead of
 * letting a backend fail opaquely mid-decode. Transcode to MP4 (H.264) first.
 */
declare class UnsupportedVideoFormatError extends Error {
    /** The offending file extension (without the leading dot), e.g. `"avi"`. */
    readonly extension: string;
    constructor(extension: string);
}
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

/** Options for {@link CropVideoBackend.wrap}. */
interface CropWrapOptions {
    /** The backend to wrap (may itself be a `CropVideoBackend`). */
    inner: VideoBackend;
    /** Outer crop region `[x1, y1, x2, y2]` (x2/y2 exclusive), in inner coords. */
    crop: CropRect;
    /** OOB pad value (scalar applied to all channels, or per-channel). Default 0. */
    fill?: Fill;
    /** Whether `close()` cascades to `inner.close()`. Default `true`. */
    ownsInner?: boolean;
}
/**
 * Virtual, axis-aligned, on-read crop of an inner {@link VideoBackend}.
 *
 * Implements the {@link VideoBackend} interface, reporting a cropped
 * `[F, h, w, c]` view: {@link getFrame} decodes the inner full frame, normalizes
 * it to readable pixels (rasterizing an opaque `ImageBitmap` / decoding
 * undecoded encoded bytes as needed), then applies the pure {@link cropFrame}
 * primitive. The frame count is unchanged (a crop is spatial).
 *
 * Always construct via {@link CropVideoBackend.wrap} (never the raw constructor)
 * so the "inner is never a crop" invariant and the fill-aware flatten law hold
 * by construction.
 */
declare class CropVideoBackend implements VideoBackend {
    /** Derived from `inner.filename`. */
    filename: string | string[];
    /**
     * The wrapped source backend. Decodes full frames; this wrapper crops them.
     * Invariant: `inner` is never itself a `CropVideoBackend` (enforced by
     * {@link wrap}).
     */
    readonly inner: VideoBackend;
    /** Crop region `[x1, y1, x2, y2]`, x2/y2 exclusive (source px, may be OOB). */
    readonly crop: CropRect;
    /** Fill value for out-of-bounds regions, forwarded to `cropFrame`. */
    readonly fill: Fill;
    /**
     * Whether this wrapper owns the inner backend's decode handle. When `true`
     * (the default), {@link close} cascades to `inner.close()`; when `false` (a
     * shared-decode mosaic tile), it does not, so closing one tile does not tear
     * down siblings sharing the inner.
     */
    readonly ownsInner: boolean;
    /**
     * Private-by-convention constructor: prefer {@link CropVideoBackend.wrap},
     * which enforces the flatten law and the "inner is never a crop" invariant.
     */
    private constructor();
    /**
     * Wrap `inner` in a crop view, flattening crop-of-crop when safe.
     *
     * Flattens (composes into a single wrapper) ONLY when `inner` is itself a
     * `CropVideoBackend`, the fills agree, AND the outer crop lies fully within
     * the inner cropped frame `[0, iw] x [0, ih]` (`iw = ix2 - ix1`,
     * `ih = iy2 - iy1`). Otherwise it nests, preserving byte-parity:
     *
     * - Different fills: the inner crop's materialized pad of value `inner.fill`
     *   would be silently replaced after a flatten.
     * - Outer crop exceeds the inner frame: a flatten would read real source
     *   pixels where the nested view pads with `fill`.
     *
     * The flatten composition law expresses the outer rect in source coordinates:
     * `(ix1 + ox1, iy1 + oy1, ix1 + ox2, iy1 + oy2)`. A flattened `inner` is
     * always unwrapped to `inner.inner` so the "inner is never a crop" invariant
     * holds.
     */
    static wrap(options: CropWrapOptions): CropVideoBackend;
    /** Inner backend's dataset name (delegated; `null`/`undefined` if absent). */
    get dataset(): string | null | undefined;
    /** Inner backend's frame rate (delegated). */
    get fps(): number | undefined;
    /**
     * Inner backend's embedded frame numbers (delegated). A crop is spatial and
     * frame-preserving, so the embedded set is exactly the inner's. Without this,
     * a cropped `pkg.slp` would report no embedded set (see {@link VideoBackend.frameNumbers}).
     */
    get frameNumbers(): number[] | undefined;
    /**
     * Cropped frame shape `[F, h, w, c]`.
     *
     * Frame count and channel count come from the inner (a crop is spatial and
     * channel-preserving); height/width are the crop extents. Returns `undefined`
     * only when the inner has no resolved shape.
     */
    get shape(): [number, number, number, number] | undefined;
    /**
     * Read a single cropped frame.
     *
     * Decodes the inner full frame, normalizes it to readable pixels (rasterizing
     * an opaque `ImageBitmap`, decoding undecoded encoded bytes, or wrapping raw
     * pixel bytes), then applies {@link cropFrame} with this wrapper's crop/fill.
     * Returns `null` when the inner returns `null` (no such frame).
     */
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    /**
     * Normalize any {@link VideoFrame} into something {@link cropFrame} can read
     * pixels from synchronously: an `ImageData` or a {@link RawFrame}.
     *
     * - `ImageData`-shaped: returned as-is.
     * - `ImageBitmap`: rasterized to `ImageData` (OffscreenCanvas / skia-canvas).
     * - Encoded bytes (PNG/JPEG): decoded to `ImageData`.
     * - Raw pixel bytes: wrapped as a {@link RawFrame} using the inner shape's
     *   width/height/channels.
     */
    private toReadable;
    /** Inner backend's per-frame presentation times (delegated; a crop is spatial). */
    getFrameTimes(): Promise<number[] | null>;
    /**
     * Map source-frame `(x, y)` coordinates into the cropped frame.
     *
     * Translates by `-(x1, y1)` (copy-based, NaN-preserving). Accepts a flat
     * interleaved buffer or an array of `[x, y]` pairs and returns the same kind.
     */
    toCropCoords<T extends FlatPoints>(points: T): T;
    toCropCoords(points: PointPairs): [number, number][];
    /**
     * Map cropped-frame `(x, y)` coordinates back to source coordinates.
     *
     * Inverse of {@link toCropCoords}: translates by `+(x1, y1)` (copy-based,
     * NaN-preserving).
     */
    toSourceCoords<T extends FlatPoints>(points: T): T;
    toSourceCoords(points: PointPairs): [number, number][];
    /**
     * Release this wrapper's handle and the inner's, if owned.
     *
     * Cascades to `inner.close()` only when {@link ownsInner} (a shared-decode
     * mosaic tile leaves the shared inner open for its siblings).
     */
    close(): void;
}

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

/** How TIFF pages map onto LabelImage frames. Mirrors Python `pages_as`. */
type PagesAs = "auto" | "time" | "classes";
interface LoadLabelImagesOptions {
    /** Page→frame mapping. Default `"auto"` (parity with Python). */
    pagesAs?: PagesAs;
    /**
     * Auto-create one Track per unique non-zero label ID (shared across frames).
     * Default `false` — pure-segmentation parity with `LabelImage.fromArray`
     * (PR #387). Ignored in `classes` mode (matches Python). Time mode only.
     */
    createTracks?: boolean;
    /** Explicit Track assignment by label ID (`Map`) or positional (`Track[]`). Time mode. */
    tracks?: Map<number, Track> | Track[] | null;
    /**
     * Explicit category assignment. `Map<id,string>` (by label ID) in time mode;
     * `string[]` (positional, one per class) in classes mode.
     */
    categories?: Map<number, string> | string[] | null;
    /** Decode only this subset of pages (0-based), in order. Default: all pages. */
    frames?: number[] | null;
    /** Source string stored on each LabelImage. Defaults to filename / blob name. */
    source?: string;
}
/**
 * Reader for a `.tif`/`.tiff` path (Node only). Returns the file bytes, or a
 * list of per-file byte arrays for a directory. Registered by
 * `label-images-node.ts`; absent in the browser graph (issue #70).
 */
type LabelImageFileReader = (path: string) => Promise<Uint8Array | {
    files: Uint8Array[];
}>;
/** Register the Node `node:fs`-backed TIFF path reader. */
declare function setLabelImageFileReader(fn: LabelImageFileReader | null): void;
/**
 * Load dense integer label images from a TIFF file (or a directory of TIFFs on
 * Node). Mirrors Python `read_label_images`.
 *
 * @param source Node: a path string (file or directory). Browser: a `File`/`Blob`.
 * @returns One `UserLabelImage` per page in `time`/`auto`(→time) mode, or a
 *   single-element array in `classes` mode.
 */
declare function loadLabelImages(source: string | File | Blob, options?: LoadLabelImagesOptions): Promise<UserLabelImage[]>;

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
 * SLEAP Analysis HDF5 format I/O.
 *
 * A portable format for exporting pose-tracking predictions as dense numpy
 * arrays. This is a 1:1 TypeScript port of `sleap_io/io/analysis_h5.py`
 * (`read_labels` / `write_labels` / `is_analysis_h5_file`) together with the
 * occupancy/location array builder `to_analysis_arrays` from
 * `sleap_io/codecs/numpy.py`.
 *
 * Format features:
 * - Configurable axis ordering via presets ("matlab" default, "standard") or
 *   explicit dimension positions.
 * - Gzip-compressed storage.
 * - Self-documenting: dimension names stored as the dataset `dims` attribute
 *   (a JSON array string, matching Python's `json.dumps`).
 * - Optional extended metadata (skeleton symmetries, video backend metadata)
 *   for full round-trip.
 *
 * Canonical internal shape for `tracks` is `(frame, track, node, xy)`; other
 * arrays drop trailing dims: `point_scores` `(frame, track, node)`,
 * `instance_scores`/`tracking_scores`/`track_occupancy` `(frame, track)`.
 *
 * Reading works in both Node and the browser (via `openH5File`). Writing is
 * Node-only for disk I/O: bytes are built in an h5wasm in-memory virtual FS and
 * written through the Node filesystem ops registered by `h5-node.ts`, so this
 * module stays free of Node-only imports and the browser bundle stays clean.
 */

/**
 * Check whether a file is a SLEAP Analysis HDF5 file.
 *
 * True iff the file opens as HDF5 and contains a `track_occupancy` dataset.
 * Returns false on any error. This distinguishes Analysis HDF5 files from JABS
 * HDF5 files (which have a `poseest` group instead).
 */
declare function isAnalysisH5File(source: string | ArrayBuffer | Uint8Array): Promise<boolean>;

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
 * Load a SLEAP Analysis HDF5 file (.h5).
 *
 * Mirrors Python's `load_analysis_h5`. The axis ordering is detected from the
 * stored `dims` attributes, and extended metadata (skeleton symmetries, video
 * backend metadata) is used to reconstruct the full Labels context when present.
 *
 * @param filename - Path to the Analysis HDF5 file
 * @param options - Loading options
 * @param options.video - Video to associate with the data. If omitted, uses the
 *   `video_path` stored in the file. Can be a Video object or path string.
 * @returns Loaded Labels object
 */
declare function loadAnalysisH5(filename: string, options?: {
    video?: Video | string;
}): Promise<Labels>;
/**
 * Save labels to a SLEAP Analysis HDF5 file (.h5).
 *
 * Mirrors Python's `save_analysis_h5`. Node-only for disk I/O.
 *
 * @param labels - Labels object to save
 * @param filename - Output file path
 * @param options - Save options
 * @param options.video - Video to export. If omitted, uses the first video. Can
 *   be a Video object or an integer index.
 * @param options.labelsPath - Source labels path (stored as metadata)
 * @param options.allFrames - Include all frames from 0 to last labeled frame (default: true)
 * @param options.minOccupancy - Minimum track occupancy ratio (0-1) to keep (default: 0)
 * @param options.preset - Axis ordering preset ("matlab" default, "standard"); mutually exclusive with explicit dims
 * @param options.frameDim - Explicit position of the frame dimension (0-3)
 * @param options.trackDim - Explicit position of the track dimension (0-3)
 * @param options.nodeDim - Explicit position of the node dimension (0-3)
 * @param options.xyDim - Explicit position of the xy dimension (0-3)
 * @param options.saveMetadata - Store extended metadata for full round-trip (default: true)
 */
declare function saveAnalysisH5(labels: Labels, filename: string, options?: {
    video?: Video | number;
    labelsPath?: string;
    allFrames?: boolean;
    minOccupancy?: number;
    preset?: string;
    frameDim?: number;
    trackDim?: number;
    nodeDim?: number;
    xyDim?: number;
    saveMetadata?: boolean;
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

/**
 * Convert labels to a dense `[frames, tracks, nodes, coords]` array.
 *
 * @param options.numFrames Optional explicit length of the output's frame
 *   dimension. Takes precedence over `video.shape[0]` (the inferred fallback).
 *   Useful when `video.shape` is null — for example, Mp4Box-backed browser
 *   videos — and you still want a video-length-sized array. If smaller than
 *   `maxLabeledFrame + 1`, it is clamped up so no labeled frames are dropped.
 *   Non-finite, non-positive, or fractional values are sanitized via
 *   `Math.floor` and ignored when `<= 0`.
 */
declare function toNumpy(labels: Labels, options?: {
    returnConfidence?: boolean;
    video?: Video;
    numFrames?: number;
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
 * Serialize skeleton(s) to the jsonpickle graph format consumed by
 * {@link readSkeletonJson} and by PyQt SLEAP / Python `sleap_io`'s
 * `SkeletonDecoder`. Port of Python `sleap_io.io.skeleton.SkeletonEncoder`.
 *
 * Emits the "duplicate-object" variant: every link source/target is a fresh
 * py/object Node; the first occurrence of each edge type uses py/reduce, later
 * occurrences a py/id back-reference. A single Skeleton serializes to a bare
 * object; a list to a JSON array (matching the two standalone-file shapes).
 */
declare function writeSkeletonJson(skeletons: Skeleton | Skeleton[]): string;

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

/** A minimal raw label-image overlay (no spatial-transform object wrapper). */
interface RawLabelImage {
    data: Int32Array;
    width: number;
    height: number;
    scale?: [number, number];
    offset?: [number, number];
}
/**
 * Draw segmentation masks as colored overlays on an image.
 *
 * For each mask, the masked pixels are alpha-blended toward the mask color.
 * Spatial transforms (scale/offset) are honored: the binary mask is resized
 * (nearest-neighbor) to its image extent, placed at its offset, and clipped to
 * the image bounds. Port of `draw_masks` (overlays.py L115-176).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param masks - Segmentation masks to draw.
 * @param opts - `color` (default [255,0,0]), per-mask `colors`, `alpha` (0.3).
 * @returns The same ImageData.
 */
declare function drawMasks(image: ImageData, masks: SegmentationMask[], opts?: {
    color?: RGB;
    colors?: RGB[];
    alpha?: number;
}): ImageData;
/**
 * Draw an integer label image as a colored overlay on an image.
 *
 * Builds a per-label color LUT (label_id -> palette[label_id % len]), blends
 * foreground pixels (label > 0) toward their color, and optionally draws region
 * outlines. Spatial transforms (scale/offset) are honored via nearest-neighbor
 * resize + offset placement + clip. Port of `draw_label_image` (overlays.py
 * L179-293).
 *
 * @param image - RGBA ImageData, mutated in place.
 * @param labels - A `LabelImage` or a raw `{ data, width, height, scale?, offset? }`.
 * @param opts - `alpha` (0.3), `palette` ("distinct"), `outline` (false),
 *   `outlineWidth` (1), `outlineColor` (null), plus optional `scale`/`offset`
 *   overrides for raw arrays.
 * @returns The same ImageData.
 */
declare function drawLabelImage(image: ImageData, labels: LabelImage | RawLabelImage, opts?: {
    alpha?: number;
    palette?: PaletteName | string;
    outline?: boolean;
    outlineWidth?: number;
    outlineColor?: RGB | null;
    scale?: [number, number];
    offset?: [number, number];
}): ImageData;
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
 *   `outlineWidth` (1), `outlineColor` (null).
 * @returns The same ImageData.
 */
declare function applyOverlay(image: ImageData, overlay: LabelImage | RawLabelImage | SegmentationMask[] | ROI[] | BoundingBox[], opts?: {
    alpha?: number;
    palette?: PaletteName | string;
    outline?: boolean;
    outlineWidth?: number;
    outlineColor?: RGB | null;
}): ImageData;

/**
 * A single-frame annotation overlay applied before poses are drawn.
 *
 * Mirrors Python `_apply_overlay` dispatch (core.py L473-566): a `LabelImage`
 * (or a raw `Int32Array`-backed object) routes to the label-image raster path;
 * a list of `SegmentationMask` / `ROI` / `BoundingBox` routes to the
 * corresponding draw function with per-item palette colors.
 */
type Overlay = LabelImage | RawLabelImage | SegmentationMask[] | ROI[] | BoundingBox[];
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
    showTrails?: boolean;
    trailLength?: number;
    trailNode?: string | string[];
    trailWidth?: number;
    trailAlphaFade?: boolean;
    trailAlpha?: number;
    trailColor?: ColorSpec | null;
    /**
     * Advanced: temporal context for trails when `source` is a single
     * `LabeledFrame`. Pass all of the video's labeled frames (a `Map` keyed by
     * frame index is the efficient form; an array is also accepted). Auto-derived
     * when `source` is a `Labels`, and populated per video by `renderVideo`.
     */
    trailFrames?: LabeledFrame[] | Map<number, LabeledFrame>;
    /**
     * Advanced: canonical track list used to key and color trails (mirrors
     * Python keying off `Labels.tracks`). Auto-derived from `Labels.tracks` for a
     * `Labels` source; populated by `renderVideo` for a `Labels` source. Falls
     * back to the tracks discovered in `trailFrames` when omitted.
     */
    trailTracks?: Track[];
    /**
     * Advanced: shared cache mapping an instance to its extracted points, reused
     * across the overlapping trail windows of consecutive frames. Populated once
     * per render by `renderVideo` to avoid recomputing instance points.
     */
    trailPtsCache?: Map<Instance | PredictedInstance, number[][]>;
    background?: "transparent" | ColorSpec;
    image?: ImageData | null;
    /**
     * Annotation overlay drawn behind the poses: a single `LabelImage` (or a raw
     * `Int32Array`-backed object), or a list of `SegmentationMask` / `ROI` /
     * `BoundingBox`. Overlay coordinates are in source pixels and are scaled to
     * match the poses (see `scale`). Default: undefined (no overlay).
     */
    overlay?: Overlay;
    overlayAlpha?: number;
    overlayPalette?: PaletteName | string;
    overlayOutline?: boolean;
    overlayOutlineWidth?: number;
    overlayOutlineColor?: RGB | null;
    width?: number;
    height?: number;
    preRenderCallback?: (ctx: RenderContext) => void;
    postRenderCallback?: (ctx: RenderContext) => void;
    perInstanceCallback?: (ctx: InstanceContext) => void;
}
/**
 * Per-frame overlay resolved for each rendered frame of a video.
 *
 * Mirrors Python render_video overlay dispatch (core.py L1719-1754):
 * - A static {@link Overlay} (single `LabelImage` or a list of masks/rois/bboxes)
 *   is applied to every frame.
 * - `LabelImage[]` is indexed by the position of the frame in the render
 *   sequence (one label image per frame); out-of-range frames get no overlay.
 * - A `Map<number, Overlay>` is keyed by the source frame index
 *   (`LabeledFrame.frameIdx`); missing keys get no overlay.
 * - A callable `(frameIdx) => Overlay | undefined` is invoked per frame with the
 *   source frame index, returning that frame's overlay (or `undefined`).
 */
type VideoOverlay = Overlay | LabelImage[] | Map<number, Overlay> | ((frameIdx: number) => Overlay | undefined);
/** Video rendering options (extends RenderOptions) */
interface VideoOptions extends Omit<RenderOptions, "overlay"> {
    /**
     * Per-frame annotation overlay. See {@link VideoOverlay}. A single static
     * overlay applies to every frame; a `LabelImage[]` is indexed by render
     * position; a `Map` is keyed by source frame index; a callable is invoked per
     * frame. Mirrors Python render_video (core.py L1719-1754).
     */
    overlay?: VideoOverlay;
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
/** Options for {@link drawTrails}. */
interface DrawTrailsOptions {
    /** RGB color used when `colors` is not provided. Default `[0, 255, 0]`. */
    color?: RGB;
    /** Per-trail RGB colors. If set, must match `trails` in length; overrides `color`. */
    colors?: RGB[];
    /** Trail line width in pixels (before `scale`). Default `2`. */
    lineWidth?: number;
    /** Fade opacity from faint (oldest segment) to opaque (newest). Default `true`. */
    alphaFade?: boolean;
    /** Global opacity multiplier (0–1). Default `1`. */
    alpha?: number;
    /** Output scale factor applied to coordinates and line width. Default `1`. */
    scale?: number;
    /** `[ox, oy]` offset subtracted from coordinates (for cropped images). Default `[0, 0]`. */
    offset?: [number, number];
}
/**
 * Draw motion trails as fading polylines on a canvas.
 *
 * Each trail is a polyline tracing a node or centroid position across past
 * frames. Segments are drawn individually so opacity can fade from faint
 * (oldest) to opaque (newest); non-finite points break the line into gaps.
 *
 * Port of Python sleap-io `draw_trails` (PR #434). The Python version rasterizes
 * into a separate `kSrc` buffer so overlapping joints take the newest segment's
 * alpha instead of accumulating it. This canvas port instead strokes each
 * segment directly with per-segment alpha — the same approach the pose-edge
 * renderer already uses — so overlapping joints may blend slightly. The visual
 * difference is negligible for trails and keeps the implementation idiomatic.
 *
 * @param ctx - Canvas 2D context. Coordinates are drawn pre-scaled by `scale`.
 * @param trails - List of trails, each an array of `[x, y]` points ordered
 *   oldest → newest. `NaN` rows break the polyline so missing detections leave
 *   gaps.
 * @param options - See {@link DrawTrailsOptions}.
 * @throws If `colors` is provided and its length does not match `trails`.
 */
declare function drawTrails(ctx: CanvasRenderingContext2D, trails: Array<Array<[number, number] | number[]>>, options?: DrawTrailsOptions): void;

/**
 * A resolved trail target: `null` means the instance centroid, a number is a
 * node index into the instance's points.
 */
type TrailTarget = number | null;
/** A single trail: `[x, y]` points ordered oldest → newest. `NaN` marks gaps. */
type Trail = Array<[number, number]>;
/**
 * Resolve a `trailNode` specification to a list of trail targets.
 *
 * Mirrors Python `_resolve_trail_node`.
 *
 * @param trailNode - `"centroid"`, a node name, or a list of node names (one
 *   trail per node). Matching of `"centroid"` is case-insensitive.
 * @param skeleton - Skeleton used to resolve node names to indices.
 * @returns One target per requested node — `null` (centroid) or a node index.
 * @throws If a node name is not present in the skeleton.
 */
declare function resolveTrailNode(trailNode: string | string[], skeleton: Skeleton): TrailTarget[];
/**
 * Number of palette colors needed for motion trails.
 *
 * Mirrors Python `_n_trail_palette_colors`. Trails are colored by track when
 * tracks are present, otherwise by instance position index; in the latter case
 * the palette is sized to the largest instance count over the frames so the
 * coloring stays stable across a render.
 *
 * @param hasTracks - Whether the data has track assignments.
 * @param nTracks - Total number of tracks (used when `hasTracks` is true).
 * @param frames - Frames to scan for the peak instance count (used when
 *   `hasTracks` is false).
 * @returns The palette size, always at least 1.
 */
declare function nTrailPaletteColors(hasTracks: boolean, nTracks: number, frames: Iterable<LabeledFrame>): number;
/**
 * Collect the distinct tracks appearing across the given frames, in first-
 * appearance order.
 *
 * Used as the canonical track list for a `LabeledFrame` source (e.g. inside
 * `renderVideo`) when the project's `Labels.tracks` list is not directly
 * available. For a `Labels` source the renderer uses `Labels.tracks` instead,
 * matching how Python keys trails off `source.tracks`.
 */
declare function collectTracks(frames: Iterable<LabeledFrame>): Track[];
/**
 * Compute motion-trail polylines ending at a given frame.
 *
 * Mirrors Python `_compute_trails`. Trails are keyed by track (tracked data) or
 * instance position index (untracked) and colored from `paletteColors`.
 *
 * @param opts.frameIdx - Current frame index (the trail ends here).
 * @param opts.frameIdxToLf - Map from frame index to LabeledFrame.
 * @param opts.trailLength - Number of past frames behind the current frame. The
 *   trail spans frames `[frameIdx - trailLength, frameIdx]` inclusive.
 * @param opts.trailTargets - Targets from {@link resolveTrailNode}.
 * @param opts.trackIndexMap - Track → index map, used to key trails by track
 *   and to assign colors.
 * @param opts.paletteColors - Color palette indexed by track index (tracked) or
 *   instance index (untracked).
 * @param opts.hasTracks - Whether the data has track assignments. When false,
 *   trails are keyed by instance position index instead of track.
 * @param opts.ptsCache - Optional cache from instance to its extracted points,
 *   reused across the overlapping trail windows of consecutive frames.
 * @returns `{ trails, colors }` parallel arrays. Each trail has
 *   `trailLength + 1` points (oldest → newest, `NaN` for missing positions).
 */
declare function computeTrails(opts: {
    frameIdx: number;
    frameIdxToLf: Map<number, LabeledFrame>;
    trailLength: number;
    trailTargets: TrailTarget[];
    trackIndexMap: Map<Track, number>;
    paletteColors: RGB[];
    hasTracks: boolean;
    ptsCache?: Map<Instance | PredictedInstance, number[][]>;
}): {
    trails: Trail[];
    colors: RGB[];
};

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

export { SHAPE_VIDEO_MATCHER as $, MergeResult as A, BoundingBox as B, CropVideoBackend as C, MatchResult as D, ErrorMode as E, FrameStrategy as F, MergeProgressBar as G, STRUCTURE_SKELETON_MATCHER as H, InstanceMatchMethod as I, SUBSET_SKELETON_MATCHER as J, DUPLICATE_MATCHER as K, Labels as L, MergeError as M, IOU_MATCHER as N, OVERLAP_SKELETON_MATCHER as O, IDENTITY_INSTANCE_MATCHER as P, NAME_TRACK_MATCHER as Q, ROI as R, SeqVideoBackend as S, TrackMatchMethod as T, UserROI as U, Video as V, IDENTITY_TRACK_MATCHER as W, AUTO_VIDEO_MATCHER as X, PATH_VIDEO_MATCHER as Y, BASENAME_VIDEO_MATCHER as Z, IMAGE_DEDUP_VIDEO_MATCHER as _, LabeledFrame as a, loadSlpSet as a$, setFsResolver as a0, type FsResolver as a1, type MergeStrategy as a2, _annotationCentroidXy as a3, _findAnnotationMatches as a4, _findAnnotationLinkMatches as a5, _resolveMergedIsNegative as a6, type CropOptions as a7, resolveCropRect as a8, SuggestionFrame as a9, UserSegmentationMask as aA, PredictedSegmentationMask as aB, type BoundingBoxOptions as aC, UserBoundingBox as aD, PredictedBoundingBox as aE, getCentroidSkeleton as aF, CENTROID_SKELETON as aG, type CentroidOptions as aH, Centroid as aI, UserCentroid as aJ, PredictedCentroid as aK, type LabelImageObjectInfo as aL, type LabelImageOptions as aM, LabelImage as aN, UserLabelImage as aO, PredictedLabelImage as aP, normalizeLabelIds as aQ, type VideoFrame as aR, type VideoBackend as aS, Mp4BoxVideoBackend as aT, type MediaBunnyOptions as aU, MediaBunnyVideoBackend as aV, StreamingHdf5VideoBackend as aW, loadSlp as aX, saveSlp as aY, loadAnalysisH5 as aZ, saveAnalysisH5 as a_, rodriguesTransformation as aa, Camera as ab, CameraGroup as ac, InstanceGroup as ad, FrameGroup as ae, RecordingSession as af, makeCameraFromDict as ag, Identity as ah, Instance3D as ai, PredictedInstance3D as aj, LazyDataStore as ak, LazyFrameList as al, _registerMaskFactory as am, AnnotationType as an, type Geometry as ao, type ROIOptions as ap, rasterizeGeometry as aq, encodeWkb as ar, decodeWkb as as, PredictedROI as at, encodeRle as au, decodeRle as av, resizeNearest as aw, type SegmentationMaskOptions as ax, SegmentationMask as ay, type UserSegmentationMaskOptions as az, LabelsSet as b, applyOverlay as b$, saveSlpSet as b0, loadVideo as b1, loadLabelImages as b2, setLabelImageFileReader as b3, type PagesAs as b4, type LoadLabelImagesOptions as b5, type LabelImageFileReader as b6, saveSlpToBytes as b7, isAnalysisH5File as b8, type GeoJSONFeature as b9, NAMED_COLORS as bA, PALETTES as bB, getPalette as bC, resolveColor as bD, rgbToCSS as bE, determineColorScheme as bF, drawCircle as bG, drawSquare as bH, drawDiamond as bI, drawTriangle as bJ, drawCross as bK, drawTrails as bL, getMarkerFunction as bM, MARKER_FUNCTIONS as bN, type DrawTrailsOptions as bO, resolveTrailNode as bP, computeTrails as bQ, nTrailPaletteColors as bR, collectTracks as bS, type TrailTarget as bT, type Trail as bU, RenderContext as bV, InstanceContext as bW, drawMasks as bX, drawLabelImage as bY, drawBboxes as bZ, drawRois as b_, type GeoJSONFeatureCollection as ba, roisToGeoJSON as bb, roisFromGeoJSON as bc, writeGeoJSON as bd, readGeoJSON as be, type LabelsDict as bf, toDict as bg, fromDict as bh, toNumpy as bi, fromNumpy as bj, labelsFromNumpy as bk, decodeYamlSkeleton as bl, encodeYamlSkeleton as bm, readSkeletonJson as bn, writeSkeletonJson as bo, readTrainingConfigSkeletons as bp, readTrainingConfigSkeleton as bq, isTrainingConfig as br, type RGB as bs, type RGBA as bt, type ColorSpec as bu, type ColorScheme as bv, type PaletteName as bw, type MarkerShape as bx, type Overlay as by, type VideoOverlay as bz, type RenderOptions as c, type RawLabelImage as c0, cropPoints as c1, uncropPoints as c2, type CropRect as c3, type FlatPoints as c4, type PointPairs as c5, cropFrame as c6, type FrameLike as c7, type RawFrame as c8, type Fill as c9, type VideoOptions as d, SeqHeader as e, SeqIndex as f, BlobByteSource as g, type ByteSource as h, createVideoBackend as i, UnsupportedVideoFormatError as j, type VideoBackendType as k, type CropWrapOptions as l, StreamingH5File as m, openH5Worker as n, openStreamingH5 as o, isStreamingSupported as p, type StreamingH5Source as q, readSlpStreaming as r, SkeletonMatchMethod as s, VideoMatchMethod as t, SkeletonMatcher as u, InstanceMatcher as v, TrackMatcher as w, VideoMatcher as x, ConflictResolution as y, SkeletonMismatchError as z };
