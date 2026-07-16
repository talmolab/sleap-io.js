declare class Node {
    name: string;
    constructor(name: string);
}
declare class Edge {
    source: Node;
    destination: Node;
    constructor(source: Node, destination: Node);
    at(index: number): Node;
}
declare class Symmetry {
    nodes: Set<Node>;
    constructor(nodes: Iterable<Node>);
    at(index: number): Node;
}
type NodeOrIndex = Node | string | number;
declare class Skeleton {
    nodes: Node[];
    edges: Edge[];
    symmetries: Symmetry[];
    name?: string;
    private nameToNode;
    private nodeToIndex;
    constructor(options: {
        nodes: Array<Node | string>;
        edges?: Array<Edge | [NodeOrIndex, NodeOrIndex]>;
        symmetries?: Array<Symmetry | [NodeOrIndex, NodeOrIndex]>;
        name?: string;
    } | Array<Node | string>);
    rebuildCache(nodes?: Node[]): void;
    get nodeNames(): string[];
    index(node: NodeOrIndex): number;
    node(node: NodeOrIndex): Node;
    get edgeIndices(): Array<[number, number]>;
    get symmetryNames(): Array<[string, string]>;
    /**
     * Check if this skeleton matches another skeleton's structure.
     *
     * Two skeletons match if they have the same nodes (by name), the same edges
     * (by directed source/destination name pairs), and the same symmetries (by
     * unordered node-name pairs). All comparisons are by node NAME, never by Node
     * identity. Two empty skeletons match.
     *
     * @param other Another skeleton to compare with.
     * @param opts.requireSameOrder If true, node names must be in the same order;
     *   if false (default), only the set of node names must match. Affects ONLY
     *   the node-name check — edges and symmetries are always compared as
     *   unordered sets.
     * @returns True if the skeletons match, false otherwise.
     */
    matches(other: Skeleton, opts?: {
        requireSameOrder?: boolean;
    }): boolean;
    /**
     * Calculate node overlap metrics with another skeleton.
     *
     * Node names are de-duplicated to sets first.
     *
     * @param other Another skeleton to compare with.
     * @returns An object with similarity metrics:
     *   - `nCommon`: Number of nodes in common.
     *   - `nSelfOnly`: Number of nodes only in this skeleton.
     *   - `nOtherOnly`: Number of nodes only in the other skeleton.
     *   - `jaccard`: Jaccard similarity (intersection/union), 0 if union empty.
     *   - `dice`: Dice coefficient (2*intersection/(nSelf+nOther)), 0 if both empty.
     */
    nodeSimilarities(other: Skeleton): {
        nCommon: number;
        nSelfOnly: number;
        nOtherOnly: number;
        jaccard: number;
        dice: number;
    };
    addEdge(source: NodeOrIndex, destination: NodeOrIndex): void;
    addSymmetry(left: NodeOrIndex, right: NodeOrIndex): void;
    private edgeFrom;
    private symmetryFrom;
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

/**
 * A per-detection re-ID appearance embedding (SLP 2.5+).
 *
 * Mirrors Python `sleap_io.model.embedding.Embedding`: a 1-D feature vector produced
 * by a re-identification / appearance model, attached to a detection alongside its
 * {@link Identity} assignment. Stored on disk in the `/embeddings` group as an
 * `(N, D)` float matrix joined to detections by `(owner_type, owner_id)`.
 */
declare class Embedding {
    /** The 1-D feature vector. */
    vector: number[];
    constructor(vector: ArrayLike<number>);
    /** Dimensionality `D` of the vector. */
    get dim(): number;
}

type CentroidFactory = (instance: Instance | PredictedInstance, options?: {
    method?: string;
    node?: string | number;
}) => any;
declare function _registerCentroidFactory(factory: CentroidFactory): void;
declare class Track {
    name: string;
    constructor(name?: string);
    matches(other: Track, method?: string): boolean;
}
type Point = {
    xy: [number, number];
    visible: boolean;
    complete: boolean;
    score?: number;
    name?: string;
};
type PredictedPoint = Point & {
    score: number;
};
type PointsArray = Point[];
type PredictedPointsArray = PredictedPoint[];
/**
 * The SLP readers' parsed point columns (`x`/`y`/`visible`/`complete`[/`score`]),
 * as plain `number[]` (eager reader) or `Float64Array` (streaming worker). Fed to
 * {@link Instance._fromColumns} to build an instance without a `Point[]`.
 */
interface PointColumns {
    x?: ArrayLike<number>;
    y?: ArrayLike<number>;
    visible?: ArrayLike<number>;
    complete?: ArrayLike<number>;
    score?: ArrayLike<number>;
}
declare function pointsEmpty(length: number, names?: string[]): PointsArray;
declare function predictedPointsEmpty(length: number, names?: string[]): PredictedPointsArray;
/**
 * Deep-copy a point into a fresh plain literal, optionally under a new node
 * name. Use this instead of `{ ...point }`: `instance.points[i]` returns a
 * {@link PointView} flyweight whose fields are accessors (not own enumerable
 * properties), so a spread would silently drop `visible`/`complete`/`score`.
 * The `score` field is copied only when present (predicted points).
 */
declare function clonePoint(p: Point, name?: string): Point;
declare function pointsFromArray(array: number[][], names?: string[]): PointsArray;
declare function predictedPointsFromArray(array: number[][], names?: string[]): PredictedPointsArray;
/**
 * A live view of one keypoint over an {@link Instance}'s columnar storage.
 *
 * `instance.points[i]` returns one of these instead of a stored `{xy,...}`
 * object, so a project's keypoints live in a few packed typed arrays per
 * instance (~a few bytes/point) rather than an object graph (~150 B/point). It
 * satisfies the structural `Point` type: reads go straight to the columns, and
 * writes (`point.xy = [...]`, `point.visible = ...`) write back through. `xy`
 * getter returns a fresh `[x, y]` copy — no code mutates `point.xy[0]` in place
 * (verified), and returning a copy keeps callers that stash `point.xy` by
 * reference (e.g. centroid math) reading a stable snapshot.
 */
declare class PointView {
    #private;
    constructor(owner: Instance, i: number);
    get xy(): [number, number];
    set xy(v: ArrayLike<number>);
    get visible(): boolean;
    set visible(v: boolean);
    get complete(): boolean;
    set complete(v: boolean);
    get score(): number | undefined;
    set score(v: number | undefined);
    get name(): string | undefined;
    set name(v: string | undefined);
}
declare class Instance {
    skeleton: Skeleton;
    track?: Track | null;
    fromPredicted?: PredictedInstance | null;
    trackingScore: number;
    /**
     * Persistent cross-video re-ID identity of this detection (SLP 2.5+), distinct
     * from the ephemeral within-video {@link Track}. Persisted in the `/identity`
     * catalog + `/identity/links`; attached after read, defaults to null.
     */
    identity?: Identity | null;
    /** Confidence of the {@link identity} assignment (SLP 2.5+); null if unrecorded. */
    identityScore?: number | null;
    /** Per-detection re-ID appearance embedding (SLP 2.5+); persisted in `/embeddings`. */
    identityEmbedding?: Embedding | null;
    _xy: Float64Array;
    _visible: Uint8Array;
    _complete: Uint8Array;
    _score: Float64Array | null;
    _names: (string | undefined)[] | null;
    _n: number;
    constructor(options: {
        points: PointsArray | Record<string, number[]>;
        skeleton: Skeleton;
        track?: Track | null;
        fromPredicted?: PredictedInstance | null;
        trackingScore?: number;
    });
    /** Pack a transient `Point[]` into the columnar typed-array storage. */
    _ingest(pts: PointsArray): void;
    /**
     * Fill the columnar storage directly from the SLP readers' parsed point
     * columns over `[start, end)`, skipping the intermediate `Point[]` literals
     * (the slicePoints → pointsFromArray → `_ingest` path allocates ~3 throwaway
     * objects per point). Values match that path exactly: `x ?? NaN`, `y ?? NaN`,
     * `Boolean(visible)`, `Boolean(complete)`, and (predicted) `score ?? NaN`;
     * names derive from the skeleton. Used by {@link Instance._fromColumns}.
     */
    _fillFromColumns(columns: PointColumns, start: number, end: number, predicted: boolean): void;
    /**
     * Build an Instance directly from reader point columns over `[start, end)`,
     * without materializing a `Point[]`. Internal fast path for buildLabeledFrames;
     * equivalent to `new Instance({ points: pointsFromArray(slicePoints(...)) })`.
     */
    static _fromColumns(opts: {
        columns: PointColumns;
        start: number;
        end: number;
        skeleton: Skeleton;
        track?: Track | null;
        fromPredicted?: PredictedInstance | null;
        trackingScore?: number;
    }): Instance;
    /** Lazily allocate the score column (for a user instance gaining scores). */
    _scoreColumn(): Float64Array;
    /** Node name for point `i` — derived from the skeleton unless overridden. */
    _pointName(i: number): string | undefined;
    _setPointName(i: number, v: string | undefined): void;
    /** The keypoints as an array of live {@link PointView}s (built on demand). */
    get points(): PointsArray;
    set points(pts: PointsArray);
    static fromArray(points: number[][], skeleton: Skeleton): Instance;
    static fromNumpy(options: {
        pointsData: number[][];
        skeleton: Skeleton;
        track?: Track | null;
        fromPredicted?: PredictedInstance | null;
        trackingScore?: number;
    }): Instance;
    static empty(options: {
        skeleton: Skeleton;
    }): Instance;
    get length(): number;
    get nVisible(): number;
    getPoint(target: number | string | Node): Point;
    numpy(options?: {
        invisibleAsNaN?: boolean;
    }): number[][];
    toString(): string;
    /** Mean of visible point coordinates as `[x, y]`, or `null` if no points visible. */
    get centroidXy(): [number, number] | null;
    /**
     * Create a Centroid from this instance.
     *
     * @param method - "centerOfMass" (default), "bboxCenter", or "anchor".
     * @param node - Node specification for "anchor" method.
     * @returns UserCentroid or PredictedCentroid depending on instance type.
     */
    toCentroid(method?: string, node?: string | number): any;
    get isEmpty(): boolean;
    /**
     * Check if this instance has the same pose as another instance.
     *
     * Mirrors Python `Instance.same_pose_as` (instance.py:699-753).
     *
     * @param other - Another instance to compare with.
     * @param tolerance - Maximum distance (in pixels) between corresponding points
     *   for them to be considered the same. If `null`/`undefined`, uses exact
     *   comparison including NaN==NaN handling.
     * @returns `true` if the instances have the same pose within tolerance.
     */
    samePoseAs(other: Instance, tolerance?: number | null): boolean;
    /**
     * Check if this instance has the same identity (track) as another instance.
     *
     * Mirrors Python `Instance.same_identity_as` (instance.py:755-770). Compares
     * tracks by reference identity, not by name.
     *
     * @param other - Another instance to compare with.
     * @returns `true` if both instances share the same `Track` object.
     */
    sameIdentityAs(other: Instance): boolean;
    /**
     * Check if this instance overlaps with another by bounding-box IoU.
     *
     * Mirrors Python `Instance.overlaps_with` (instance.py:772-830). Bounding
     * boxes are computed over VISIBLE points; if either has none, returns false.
     * If the boxes do not STRICTLY intersect on both axes (touching edges count
     * as no overlap), returns false regardless of `iouThreshold` — this matches
     * Python's `np.any(intersection_min >= intersection_max) -> False`
     * short-circuit, which runs before the threshold comparison.
     *
     * @param other - Another instance to compare with.
     * @param iouThreshold - Minimum IoU to count as overlapping (inclusive `>=`).
     */
    overlapsWith(other: Instance, iouThreshold?: number): boolean;
    /**
     * Get the bounding box of visible points.
     *
     * Mirrors Python `Instance.bounding_box` (instance.py:832-849).
     *
     * @returns `[[minX, minY], [maxX, maxY]]` over visible points, or `null` if
     *   there are no visible points.
     */
    boundingBox(): [[number, number], [number, number]] | null;
}
declare class PredictedInstance extends Instance {
    score: number;
    constructor(options: {
        points: PredictedPointsArray | Record<string, number[]>;
        skeleton: Skeleton;
        track?: Track | null;
        score?: number;
        trackingScore?: number;
        fromPredicted?: PredictedInstance | null;
    });
    static fromArray(points: number[][], skeleton: Skeleton, score?: number): PredictedInstance;
    static fromNumpy(options: {
        pointsData: number[][];
        skeleton: Skeleton;
        track?: Track | null;
        score?: number;
        trackingScore?: number;
    }): PredictedInstance;
    static empty(options: {
        skeleton: Skeleton;
    }): PredictedInstance;
    /**
     * Build a PredictedInstance directly from reader point columns over
     * `[start, end)`, without materializing a `Point[]`. Internal fast path for
     * buildLabeledFrames; equivalent to `new PredictedInstance({ points:
     * predictedPointsFromArray(slicePoints(...)) })`.
     */
    static _fromColumns(opts: {
        columns: PointColumns;
        start: number;
        end: number;
        skeleton: Skeleton;
        track?: Track | null;
        score?: number;
        trackingScore?: number;
        fromPredicted?: PredictedInstance | null;
    }): PredictedInstance;
    numpy(options?: {
        scores?: boolean;
        invisibleAsNaN?: boolean;
    }): number[][];
    toString(): string;
}
declare function pointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PointsArray;
declare function predictedPointsFromDict(pointsDict: Record<string, number[]>, skeleton: Skeleton): PredictedPointsArray;

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

type VideoFrame = ImageData | ImageBitmap | Uint8Array | ArrayBuffer;
/** Per-call options for {@link VideoBackend.getFrame}. */
interface GetFrameOptions {
    /**
     * When `false`, suppress this backend's read-ahead prefetch for this call.
     * Read-ahead helps sequential playback but is wasted (and saturates I/O) while
     * scrubbing, where the caller jumps past the prefetched frames. Backends with
     * no prefetch ignore it. Defaults to `true` (prefetch enabled).
     */
    prefetch?: boolean;
    /**
     * Optional cancellation signal. Backends that decode asynchronously (e.g. the
     * MP4 backend) bail early when it aborts; backends that don't ignore it.
     */
    signal?: AbortSignal;
}
/**
 * A lazy, seekable byte source for a video file — the video counterpart of the
 * HDF5 streaming reader's range source. Lets a backend read only the byte ranges
 * it needs (the container index + the samples for the frames being viewed)
 * instead of materializing the whole file in memory.
 *
 * The canonical use is desktop (Tauri), where the WebView has no lazy disk-backed
 * `File` for a raw path: `readRange` is backed by a native `read_range` command
 * so a multi-GB video never has to be read whole into RAM. Structurally mirrors
 * the HDF5 `RangeSource` used by `readSlpStreaming`.
 */
interface RangeSource {
    /** Total file size in bytes. */
    size: number;
    /** Read `[offset, offset + length)`; may return fewer bytes at EOF. */
    readRange: (offset: number, length: number) => Promise<Uint8Array>;
}
/**
 * True for a {@link RangeSource} — distinguishes it from a `string` URL / `File`
 * / `Blob`. A `Blob` also has a numeric `size`, so the `readRange` function is
 * the discriminator.
 */
declare function isRangeSource(source: unknown): source is RangeSource;
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
    getFrame(frameIndex: number, opts?: GetFrameOptions): Promise<VideoFrame | null>;
    getFrameTimes?(): Promise<number[] | null>;
    /**
     * Optional cheap liveness probe: resolve to `true` if the backend can read its
     * first frame's SOURCE bytes (no decode), else `false` (never throws). Used to
     * detect a backend built from stored metadata (an `ImageVideo` given a `shape`
     * skips the up-front decode) whose media is not actually reachable, so a
     * consumer can offer a locate/repair affordance instead of rendering blanks.
     * Backends that always read on `getFrame` (or verify at construction) may omit
     * this. See issue #213.
     */
    probeFirstFrame?(): Promise<boolean>;
    /**
     * Optional crop pushdown hook (Item 1 of JS issue #153, mirroring Python
     * `read_crop`, `video_reading.py:1647`).
     *
     * When a backend can read *only* the requested crop region directly from
     * storage — e.g. a raw rank-4 chunked HDF5 pixel array via an N-D hyperslab —
     * it implements this to return a `(y2-y1) x (x2-x1) x C` {@link RawFrame}
     * that is **byte-identical** to `cropFrame(fullFrame, crop, fill)` (same pad
     * value, same clamp arithmetic). Returning `null` signals "I cannot push this
     * down — fall back to a full decode + `cropFrame`". It must never throw for
     * out-of-bounds crops.
     *
     * Backends that store opaque encoded blobs (PNG/JPEG) or per-frame-indexed
     * rows (the embedded `pkg.slp` case) cannot spatially hyperslab a frame and
     * always return `null`. The JS port ships no raw rank-4 HDF5 video backend
     * today, so this is a no-op on every current fixture; the hook keeps the
     * architecture aligned with Python and leaves the fast path open.
     */
    readCrop?(frameIndex: number, crop: CropRect, fill: Fill): Promise<RawFrame | null>;
    /**
     * Embedded-image (pkg.slp) backends: return the RAW stored encoded bytes
     * (PNG/JPEG blob, or raw-pixel row) for source frame number `frameNumber`,
     * WITHOUT decoding — the JS analog of Python `HDF5Video.get_frame_raw_bytes`.
     * Returns null if this backend has no stored image for that frame or cannot
     * provide raw bytes. Continuous-video backends omit this method.
     */
    getFrameBuffer?(frameNumber: number): Promise<Uint8Array | null>;
    /** Encoded format of stored blobs ("png"|"jpg"|"jpeg"|raw). Embedded only. */
    readonly embeddedFormat?: string;
    /** Channel order of stored blobs ("RGB"|"BGR"). Embedded only. */
    readonly embeddedChannelOrder?: string;
    /**
     * Deferred (lazyVideoMetadata) backends: fetch per-video metadata skipped at
     * load. Idempotent; callers await it before reading frameNumbers. No-op /
     * omitted when everything is already loaded.
     */
    ensureLoaded?(): Promise<void>;
    close(): void;
}

/**
 * Default TTL (ms) for the per-instance {@link Video.exists} URL probe cache.
 * Analogous to Python's `SLEAP_IO_EXISTS_TTL`.
 */
declare const EXISTS_TTL_MS = 60000;
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
/**
 * Why a video's backend could not be opened during load (the backend is then
 * left `null`). Drives the consumer's message/action — e.g. "locate image
 * folder" for an image-sequence, "unsupported format" for `.avi`/`.mpeg`.
 */
type VideoBackendErrorKind = "image-sequence" | "unsupported-format" | "decode";
interface VideoBackendError {
    kind: VideoBackendErrorKind;
    message: string;
}
declare class Video {
    filename: string | string[];
    backend: VideoBackend | null;
    /** Set when the backend failed to open during load (then `backend` is null). */
    backendError: VideoBackendError | null;
    backendMetadata: Record<string, unknown>;
    sourceVideo: Video | null;
    openBackend: boolean;
    private _embedded;
    private _shape;
    private _fps;
    /** Auth headers persisted from a remote `.slp` load (mirror Python `_url_headers`). */
    private _urlHeaders?;
    /** Per-instance TTL cache for {@link exists}. */
    private _existsCache?;
    constructor(options: {
        filename: string | string[];
        backend?: VideoBackend | null;
        backendError?: VideoBackendError | null;
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
    getFrame(frameIndex: number, opts?: GetFrameOptions): Promise<VideoFrame | null>;
    /**
     * Raw stored encoded blob for `frameNumber` on an embedded video, WITHOUT
     * decoding — mirrors Python `HDF5Video.get_frame_raw_bytes`. Returns null for
     * a continuous video, a closed backend, or an unstored frame.
     */
    getFrameBuffer(frameNumber: number): Promise<Uint8Array | null>;
    getFrameTimes(): Promise<number[] | null>;
    close(): void;
    /**
     * Persist the remote auth headers from a remote `.slp` load so later
     * {@link exists} probes (and any URL-backed backend) stay authenticated.
     * Mirrors Python's `HDF5Video._url_headers`. Internal — set by the SLP reader.
     * @internal
     */
    _setUrlPersistence(persistence: {
        headers?: Record<string, string>;
    }): void;
    /**
     * The auth headers to use for remote requests on this video, preferring the
     * value persisted on this `Video`, then any persisted on the backend. Mirrors
     * Python `Video._backend_url_headers`.
     * @internal
     */
    _backendUrlHeaders(): Record<string, string> | undefined;
    /**
     * Non-throwing check that this video's source is reachable.
     *
     * For a URL filename, probes with HEAD (falling back to a `Range: bytes=0-0`
     * GET), forwarding any persisted auth headers, and caches the result
     * per-instance for {@link EXISTS_TTL_MS}. Never throws (a probe failure → a
     * cached `false`). For a non-URL (local/embedded) filename, this returns
     * `true` only when a backend is present (the JS port has no generic
     * filesystem stat); callers needing real local existence should use a Node
     * file check.
     *
     * Port of Python `Video.exists`.
     */
    exists(): Promise<boolean>;
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

type MaskFactory = (mask: Uint8Array, height: number, width: number, options: Record<string, unknown> & {
    score?: number;
}) => SegmentationMask;
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
/**
 * Trace the boundary contours of a binary raster as closed polygon rings.
 *
 * Uses pixel-edge boundary tracing: every foreground pixel contributes its four
 * cell-border edges with a fixed winding, and edges shared by two foreground
 * pixels cancel (they are emitted in opposite directions). What remains is the
 * exact region boundary, which chains into closed loops — one ring per outer
 * boundary or hole, for any number of disjoint components. Collinear runs are
 * collapsed, so an axis-aligned block yields four corners.
 *
 * Coordinates are pixel-corner integers in mask space: a foreground block
 * spanning columns `[c0, c1)` and rows `[r0, r1)` traces to the rectangle
 * `(c0, r0) → (c1, r0) → (c1, r1) → (c0, r1) → (c0, r0)`. Each ring is closed
 * (last point equals first). Returns `[]` for an all-background raster.
 *
 * Outer boundaries and holes get opposite winding (via the shoelace sign), so
 * {@link groupRingsIntoPolygons} can nest holes inside their containing outer.
 */
declare function traceMaskContours(raster: Uint8Array, height: number, width: number): number[][][];
/**
 * Group traced contour rings into GeoJSON-style polygons (`[outer, ...holes]`).
 *
 * Outer boundaries share the winding of the largest ring; the opposite winding
 * marks holes, each assigned to the smallest containing outer. The result feeds
 * a `Polygon` (one outer) or `MultiPolygon` (several).
 */
declare function groupRingsIntoPolygons(rings: number[][][]): number[][][][];
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
    /**
     * @internal Memoized decoded raster and the `rleCounts` it was decoded from.
     * `get data()` returns the cached buffer when `rleCounts` is unchanged, so
     * repeated reads (rendering, contour tracing, bbox) decode the RLE once. The
     * returned buffer is shared — treat it as read-only.
     */
    private _dataCache;
    private _dataCacheKey;
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
    /**
     * Trace the mask's boundary as closed polygon rings in image space.
     *
     * Returns an array of rings (`[x, y]` vertices, each closed so the last point
     * equals the first), honoring the mask's `scale`/`offset`. Disjoint blobs and
     * holes each produce their own ring; an empty mask returns `[]`. The outlines
     * are exact, axis-aligned ("staircase") boundaries — consumers wanting smooth
     * curves can post-process (e.g. Chaikin subdivision). For a GeoJSON polygon
     * with holes nested as interior rings, use {@link toPolygon}.
     *
     * Browser-safe (pure data, no canvas), enabling interactive UIs to draw real
     * mask outlines instead of just the bounding box.
     */
    contours(): number[][][];
    /**
     * Convert the mask to a polygon ROI tracing its actual boundary.
     *
     * Builds a `Polygon` (single blob, holes nested as interior rings) or a
     * `MultiPolygon` (disjoint blobs) from {@link contours}. An empty mask yields
     * an empty `Polygon`. Returns a `PredictedROI` (carrying `score`) for a
     * predicted mask, else a `UserROI`. Metadata (`name`, `category`, `source`,
     * `track`, `instance`) is carried over.
     *
     * Use {@link toBbox} or the `bbox` getter for the axis-aligned bounding box.
     */
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
     * @param method - The matching method (default IDENTITY — matches only the
     *   same Track object; correctness-first). Use NAME to match by track name. A
     *   bare string is coerced + validated.
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
 * Rewrite `fromPredicted` links to copied sources within a merged frame.
 *
 * Mirrors Python `_relink_from_predicted` (labeled_frame.py). After annotations
 * are copied into a merged frame, a user annotation's `fromPredicted` may still
 * reference the *original* predicted source rather than the copy that was placed
 * in the frame. This pass redirects each such link to the copied source (looked
 * up in `memo`) so the provenance link points at the in-frame object and would
 * survive serialization (which resolves links by object identity). Links whose
 * source was not copied (not in `memo`) are left unchanged.
 *
 * Generic over modality via `ann.fromPredicted`: only segmentation masks and
 * `Instance`s carry a `fromPredicted` link today, so other annotation types are
 * left untouched.
 *
 * @param annotations - The merged annotation list to repair in place.
 * @param memo - Map from an original annotation to its copy, as built by
 *   {@link _copyWithMemo} (or `Labels._mapInstance`).
 */
declare function _relinkFromPredicted(annotations: any[], memo: Map<object, object>): void;
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
    /**
     * Whether this frame carries any user-supplied labeling.
     *
     * True if it has at least one user instance, is asserted as a negative
     * (background) frame, or holds any non-predicted frame-level annotation —
     * a user centroid, bounding box, ROI, segmentation mask, or label image.
     * Mirrors Python `LabeledFrame.is_user_labeled` (the ROI clause is the
     * specific contribution of sleap-io PR #509). Predicted annotations alone do
     * not make a frame user-labeled.
     */
    get isUserLabeled(): boolean;
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
    score?: number;
    identity?: Identity;
    instance3d?: Instance3D;
    metadata: Record<string, unknown>;
    private _points?;
    /**
     * The CONCRETE camera→instance map. Set for in-memory construction and for the
     * JS-inline read path (point-dict instances). `undefined` for a pure-ref group
     * read from a camcorder-format file until first access resolves the refs. Read
     * directly (not via the caching getter) by the write path.
     * @internal
     */
    _instanceByCamera?: Map<Camera, Instance>;
    /**
     * Verbatim as-read index refs from `camcorder_to_lf_and_inst_idx_map`:
     * camera → [globalLabeledFrameIdx, instanceIdx]. Captured on read WITHOUT
     * materializing any frames, so an untouched group can be written back
     * losslessly (see hybrid write-back). `undefined` for in-memory groups.
     * @internal
     */
    _instanceRefsByCamera?: Map<Camera, [number, number]>;
    /**
     * Injected lazy frame resolver (`(globalLfIdx) => LabeledFrame | undefined`).
     * Declared (no runtime slot) so it is NEVER an own-enumerable property — it is
     * installed non-enumerably via `injectSessionFrameResolver` after Labels is
     * built. Enumerability matters: `structuredClone(labels.sessions)` in
     * `Labels.copy()` throws `DataCloneError` on an enumerable function property.
     * @internal
     */
    _frameResolver?: (globalLfIdx: number) => LabeledFrame | undefined;
    constructor(options: {
        instanceByCamera?: Map<Camera, Instance> | Record<string, Instance>;
        instanceRefsByCamera?: Map<Camera, [number, number]>;
        score?: number;
        points?: number[][];
        identity?: Identity;
        instance3d?: Instance3D;
        metadata?: Record<string, unknown>;
    });
    get points(): number[][] | undefined;
    set points(value: number[][] | undefined);
    /**
     * Camera→Instance map. Concrete when the group was built in memory (or via the
     * JS-inline read path); otherwise resolved lazily from `_instanceRefsByCamera`
     * on first access via the injected `_frameResolver` and cached. In-place
     * `.set()`/`.delete()` mutations therefore act on the resolved concrete map.
     */
    get instanceByCamera(): Map<Camera, Instance>;
    set instanceByCamera(value: Map<Camera, Instance>);
    get instances(): Instance[];
}
declare class FrameGroup {
    frameIdx: number;
    instanceGroups: InstanceGroup[];
    metadata: Record<string, unknown>;
    /**
     * The CONCRETE camera→labeledFrame map. Set for in-memory construction;
     * `undefined` for a pure-ref group read from a camcorder-format file until
     * first access resolves the refs. Read directly (not via the caching getter)
     * by the write path.
     * @internal
     */
    _labeledFrameByCamera?: Map<Camera, LabeledFrame>;
    /**
     * Verbatim as-read index refs from `labeled_frame_by_camera` (or reconstructed
     * from `camcorder_to_lf_and_inst_idx_map`): camera → globalLabeledFrameIdx.
     * Captured on read WITHOUT materializing any frames. `undefined` for in-memory
     * groups.
     * @internal
     */
    _labeledFrameRefsByCamera?: Map<Camera, number>;
    /** @see InstanceGroup._frameResolver @internal */
    _frameResolver?: (globalLfIdx: number) => LabeledFrame | undefined;
    constructor(options: {
        frameIdx: number;
        instanceGroups: InstanceGroup[];
        labeledFrameByCamera?: Map<Camera, LabeledFrame> | Record<string, LabeledFrame>;
        labeledFrameRefsByCamera?: Map<Camera, number>;
        metadata?: Record<string, unknown>;
    });
    /**
     * Camera→LabeledFrame map. Concrete when the group was built in memory;
     * otherwise resolved lazily from `_labeledFrameRefsByCamera` on first access
     * via the injected `_frameResolver` and cached.
     */
    get labeledFrameByCamera(): Map<Camera, LabeledFrame>;
    set labeledFrameByCamera(value: Map<Camera, LabeledFrame>);
    /**
     * Cameras participating in this frame group. Reads keys from whichever backing
     * map exists WITHOUT resolving refs, so listing cameras never materializes a
     * frame (crucial for the lazy/zero-materialization write path).
     */
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
    /**
     * @deprecated Transitional bridge, OPT-IN only. Pass `{ rawSessions: true }`
     * to a read entrypoint (`readSlp`/`readSlpLazy`/`readSlpStreaming`) to capture
     * it; it is `undefined` by default. The object model is now a faithful, lossless
     * projection of `sessions_json` (typed grouping via `InstanceGroup`/`FrameGroup`
     * refs), so consumers should read typed objects rather than this raw dict. It
     * will be removed once LUCID migrates off it. Capturing it deep-clones the whole
     * session payload, so leaving it off avoids doubling session memory in
     * `Labels.copy()`.
     *
     * The verbatim, as-read `sessions_json` dict for this session (when captured).
     *
     * This is a deep-cloned copy of the `JSON.parse` result of the session's
     * `sessions_json` entry, populated on read (eager, lazy, and streaming) ONLY
     * when `rawSessions` is requested. It lets 3D consumers (e.g. luc3d/LUCID) read
     * app-specific state — `calibration`, `camcorder_to_video_idx_map`,
     * `camcorder_to_lf_and_inst_idx_map`, `frame_group_dicts`, and any nested
     * `metadata.lucid` blob — without re-opening the HDF5, including keys
     * sleap-io.js does not itself model.
     *
     * Caveats:
     * - It is a READ-TIME SNAPSHOT: it is deep-cloned from the parsed dict and
     *   holds NO shared references with the object model, so mutating `rawJson`
     *   never affects the model (or what is written to disk) and mutating the
     *   model never affects `rawJson`.
     * - It is NEVER itself re-written to disk. The object model is the single
     *   source of truth on write; `rawJson` is a pure in-memory read surface.
     * - `undefined` for sessions constructed in-memory (never read from disk).
     */
    rawJson?: Record<string, unknown>;
    constructor(options?: {
        cameraGroup?: CameraGroup;
        frameGroupByFrameIdx?: Map<number, FrameGroup>;
        videoByCamera?: Map<Camera, Video>;
        cameraByVideo?: Map<Video, Camera>;
        metadata?: Record<string, unknown>;
        rawJson?: Record<string, unknown>;
    });
    get frameGroups(): Map<number, FrameGroup>;
    get videos(): Video[];
    get cameras(): Camera[];
    addVideo(video: Video, camera: Camera): void;
    getCamera(video: Video): Camera | undefined;
    getVideo(camera: Camera): Video | undefined;
}
/**
 * Install a lazy frame resolver onto every FrameGroup and InstanceGroup reachable
 * from `labels.sessions`. Session grouping is read BEFORE the frame store exists
 * in all readers, so this is called AFTER the `Labels` is constructed (and, for
 * the lazy reader, after `_lazyFrameList` is attached). The resolver routes
 * through `labels.frameAt(i)`, which materializes only frame `i` under the lazy
 * reader — so ref-backed groups resolve their instances/frames on first access
 * without forcing a full-table materialization.
 *
 * The resolver is installed NON-ENUMERABLE via `Object.defineProperty`: an
 * enumerable function property would make `structuredClone(labels.sessions)` in
 * `Labels.copy()` throw `DataCloneError`.
 */
declare function injectSessionFrameResolver(labels: Labels): void;
/**
 * Deep-clone a {@link RecordingSession} preserving class prototypes (so the lazy
 * grouping getters survive — unlike `structuredClone`, which strips prototypes
 * and the non-enumerable frame resolver) and the as-read index refs.
 *
 * Camera keys are remapped to freshly-cloned cameras; `Video` references are
 * remapped via `videoMap`. Ref-backed (disk-read) grouping is carried as refs
 * and re-resolves against the COPY once {@link injectSessionFrameResolver} runs
 * on it — the copied `labeledFrames` preserve the original's global ordering, so
 * the same indices resolve correctly. Concrete in-memory maps are carried with
 * Camera keys remapped and Instance/LabeledFrame values remapped via
 * `frameMap`/`instanceMap` when supplied (eager copy).
 *
 * NOTE: `identity` and `instance3d` are carried by reference — deep-copying those
 * across a `Labels.copy()` (and relinking to the copy's identities/skeletons) is
 * a separate, pre-existing concern outside the session-grouping model.
 */
declare function cloneRecordingSession(session: RecordingSession, opts?: {
    videoMap?: Map<Video, Video>;
    frameMap?: Map<LabeledFrame, LabeledFrame>;
    instanceMap?: Map<Instance, Instance>;
}): RecordingSession;
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
    /**
     * Memoized raw-`frames.video`-id -> `videos` index map (see
     * {@link buildVideoIdMap}). Lazily built on first frame access; rebuilt from
     * scratch by a copied store since `copy()` does not carry it over.
     */
    private _videoIdToIndex?;
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
     * Resolve a raw `frames.video` id to its `videos` array index, applying the
     * same remap the eager readers use so sparse / non-contiguous group ids
     * (e.g. `video0`, `video2`) resolve to the correct video. Falls back to the
     * raw id when unmapped — identical to `buildLabeledFrames`.
     */
    private videoIndexFor;
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
    /**
     * Max materialized frames to keep cached (0 = unbounded, the default). When
     * exceeded, the oldest-inserted entries are evicted (FIFO ≈ LRU for a
     * sequential sweep) so a read→transform→write pass over a huge lazy file stays
     * memory-bounded without the caller touching internals. Combine with (or use
     * instead of) explicit {@link release}/{@link releaseWindow}. See #207.
     */
    cacheLimit: number;
    constructor(store: LazyDataStore);
    get length(): number;
    /** Get a frame by index, materializing it if needed. */
    at(index: number): LabeledFrame | undefined;
    /** Drop the cached (materialized) frame at `index`, if any. */
    release(index: number): void;
    /** Drop cached frames in the half-open range `[start, end)`. */
    releaseWindow(start: number, end: number): void;
    /** Drop all cached frames (keeps the underlying store). */
    clearCache(): void;
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
    /**
     * @deprecated Transitional. Only populated when a read entrypoint is called
     * with `{ rawSessions: true }`; `undefined` per entry otherwise. Prefer the
     * faithful typed session model. See `RecordingSession.rawJson`.
     *
     * The verbatim, as-read `sessions_json` dicts, index-aligned with `sessions`.
     *
     * Derived (no stored field) so it cannot desync in length from `sessions`.
     * `rawSessionsJson[i]` corresponds to `sessions[i]`, and is `undefined` for
     * sessions constructed in-memory (or read without `rawSessions`). Each entry
     * is the untouched `JSON.parse` result of that session's `sessions_json`
     * entry — a read-time snapshot, never itself re-written to disk. See
     * `RecordingSession.rawJson`.
     */
    get rawSessionsJson(): Array<Record<string, unknown> | undefined>;
    /**
     * Get the labeled frame at global index `i`, materializing only that frame
     * under the lazy reader. Backs the session grouping's lazy frame resolver
     * (`injectSessionFrameResolver`): resolving one cross-camera ref materializes
     * a single frame via `LazyFrameList.at(i)` rather than the whole table, so an
     * untouched session round-trips with zero frame materialization.
     */
    frameAt(i: number): LabeledFrame | undefined;
    /**
     * Drop the cached (materialized) frame at `i` from a lazy `Labels`, so a
     * windowed read→transform→write sweep over a huge file stays memory-bounded
     * without reaching into internals. No-op on an eager `Labels`. See #207.
     */
    releaseFrame(i: number): void;
    /** Drop cached lazy frames in the half-open range `[start, end)`. No-op if eager. */
    releaseFrameWindow(start: number, end: number): void;
    /**
     * Bound how many materialized frames a lazy `Labels` keeps cached (0 =
     * unbounded). When exceeded, oldest-first eviction keeps peak memory flat
     * across a sequential sweep. No-op / returns 0 on an eager `Labels`.
     */
    get frameCacheLimit(): number;
    set frameCacheLimit(n: number);
    /**
     * Collect tracks from annotations on a frame into this.tracks.
     *
     * `seen` lets a caller iterating many frames share one membership set instead
     * of rebuilding `new Set(this.tracks)` per frame — the difference between
     * O(frames) and O(frames × tracks) on files with many tracks (e.g. a 21.8k-
     * frame / 7k-track project spent seconds here rebuilding the set). When
     * omitted (single-frame `append`), the set is built from the current tracks.
     * The set must stay in sync with `this.tracks`: every push here also adds to
     * it, so a later frame sees tracks an earlier one contributed.
     */
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
    /**
     * Append a labeled frame to the labels.
     *
     * Registers the frame's video, the skeletons and tracks of its instances, and
     * the tracks of its nested annotations. Skeletons are registered via
     * {@link _registerSkeleton}, so an instance referencing a structurally-equal
     * but distinct `Skeleton` is rebound to the existing canonical one instead of
     * growing `this.skeletons` (Python #447).
     *
     * Mirrors Python `Labels.append` (PR #447).
     */
    append(frame: LabeledFrame): void;
    /**
     * Append multiple labeled frames to the labels.
     *
     * Like calling {@link append} on each frame in `frames`: registers each
     * frame's video, the skeletons and tracks of its instances (deduplicating
     * structurally-equal skeletons via {@link _registerSkeleton}, Python #447),
     * and the tracks of its nested annotations.
     *
     * Mirrors Python `Labels.extend` (PR #447).
     */
    extend(frames: LabeledFrame[]): void;
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
     * Remove one or more videos and every reference to them — the "drop" analog
     * of {@link replaceVideos}. Labeled frames and suggestions belonging to a
     * removed video are dropped (a frame's ROIs go with it), as are static ROIs
     * that reference it. Videos not present are ignored (a no-op, matching
     * {@link addVideo}'s lenient convention).
     *
     * Tracks and skeletons are intentionally left untouched — cleaning those up
     * is a separate concern (see {@link clean}).
     */
    removeVideos(videos: Video[]): void;
    /** Remove a single video and all references to it (see {@link removeVideos}). */
    removeVideo(video: Video): void;
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
     * Register an instance's skeleton, deduplicating structurally-equal ones.
     *
     * If a skeleton with the same structure *and* the same node order already
     * exists in `this.skeletons`, the instance is rebound to that canonical object
     * instead of leaking a duplicate. If no match exists, the instance's skeleton
     * is appended as a new canonical skeleton.
     *
     * A skeleton that is already registered (by object identity) is left
     * untouched. This deliberately preserves distinct-but-compatible skeletons a
     * caller added explicitly (e.g. via `new Labels({ skeletons: [...] })`), so
     * workflows that reason about them separately keep working; only
     * newly-discovered duplicates are canonicalized.
     *
     * Matching uses `Skeleton.matches(..., { requireSameOrder: true })` — the same
     * strictness as {@link dedupSkeletons} — so a newly-seen skeleton is only
     * treated as a duplicate when its node names, edges, symmetries, *and* node
     * order all match an existing skeleton. Because the node order is identical,
     * the instance's positional points array is already aligned to the canonical
     * skeleton, so rebinding `inst.skeleton` never moves any point data. Two
     * structurally-equal skeletons with *different* node order are intentionally
     * kept distinct, since their positional point semantics genuinely differ.
     *
     * Mirrors Python `Labels._register_skeleton` (PR #447).
     *
     * @param inst - Instance whose skeleton should be registered. Both `Instance`
     *   and `PredictedInstance` are supported.
     */
    private _registerSkeleton;
    /**
     * Update data structures based on contents.
     *
     * Repopulates `videos`, `skeletons`, and `tracks` from the labeled frames,
     * their instances and nested annotations, and the suggestions. Existing
     * entries are preserved (in order); only missing ones are appended.
     *
     * Skeletons are registered via {@link _registerSkeleton}, so two
     * structurally-equal but distinct `Skeleton` objects collapse to a single
     * canonical entry (Python #447) instead of leaking a duplicate.
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
     * Mirrors Python `Labels._map_instance` (labels.py:3953-4020). The source
     * instance is never mutated: its points are deep-copied and the returned
     * instance is a fresh object of the SAME exact type (`Instance` vs
     * `PredictedInstance`, dispatched via `constructor ===`). Skeleton/track are
     * resolved through the maps with `?? original` fallback.
     *
     * When the source instance's node order differs from the mapped skeleton's
     * node order (e.g. the default structure matcher matched `[A, B, C]` with
     * `[C, B, A]`), the points are reordered by node NAME so that each node's
     * coordinates and score follow its name rather than its position (Python
     * #489). When the node orders are identical (the common case) the points are
     * copied positionally to avoid any overhead on the hot path. Nodes present in
     * the mapped skeleton but absent from the source are filled with a missing,
     * invisible point (NaN xy).
     *
     * @param instance - Instance to map.
     * @param skeletonMap - Map from old skeletons to new skeletons.
     * @param trackMap - Map from old tracks to new tracks.
     * @param memo - Optional map from the source instance to the new instance,
     *   mutated in place. Used by {@link _relinkFromPredicted} to repair
     *   `fromPredicted` links so a remapped user instance references the remapped
     *   source prediction now in the merged frame (Python #491).
     * @returns New instance with mapped skeleton and track.
     */
    _mapInstance(instance: Instance | PredictedInstance, skeletonMap: Map<Skeleton, Skeleton>, trackMap: Map<Track, Track>, memo?: Map<object, object>): Instance | PredictedInstance;
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
     * @param opts.track - Track matcher (`null` -> IDENTITY). The default matches
     *   tracks only by object identity (the same Track instance) and appends all
     *   other tracks as new — a correctness-first default that never collapses
     *   distinct tracks by their (often arbitrary, tracker-assigned) names. Pass
     *   `"name"` to match tracks by their name attribute instead, for cases where
     *   track names are semantically meaningful (e.g. user-assigned identities or
     *   identity-classification model outputs).
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
     * Warn when name-matched tracks diverge spatially on all shared frames.
     *
     * Faithful port of Python `Labels._warn_track_name_divergence`
     * (labels.py:3672-3776, PR talmolab/sleap-io#448). Name-based track merging
     * silently coalesces tracks that share a name across two `Labels`. If those
     * tracks actually label different animals, this can glue distinct tracks
     * together. This helper emits a diagnostic `console.warn` (purely additive; it
     * never changes the merge result) when a track pair matched by name carries
     * instances on overlapping frames that do not spatially correspond under the
     * merge's instance matcher.
     *
     * The check is a no-op unless track matching is by NAME (divergence is
     * meaningless for identity/object track matching) and the instance matcher is
     * spatial (SPATIAL or IOU). A warning fires at most once per colliding
     * `(otherTrack, selfTrack)` pair, only when the pair has at least one shared
     * frame with instances on both sides and zero spatial instance matches across
     * all such frames.
     *
     * @param other - The other `Labels` being merged into `self`.
     * @param videoMap - Mapping from `other` videos to the matched `self` videos,
     *   as built in {@link merge}.
     * @param trackMap - Mapping from `other` tracks to the matched `self` tracks
     *   (or back to themselves if appended as new), as built in {@link merge}.
     * @param trackMatcher - The `TrackMatcher` used for the merge. The check is
     *   skipped unless its method is NAME.
     * @param instanceMatcher - The `InstanceMatcher` used for the merge. Reused
     *   here as the divergence primitive (no new threshold introduced). Skipped
     *   when its method is IDENTITY (see below).
     */
    private _warnTrackNameDivergence;
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
     * @param opts.track - Track matcher (`null` -> IDENTITY). The default matches
     *   tracks only by object identity (the same Track instance); all other tracks
     *   map to `null` — a correctness-first default that never collapses distinct
     *   tracks by their (often arbitrary, tracker-assigned) names. Pass `"name"` to
     *   match tracks by their name attribute instead, for cases where track names
     *   are semantically meaningful (e.g. user-assigned identities or
     *   identity-classification model outputs).
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

export { _findAnnotationLinkMatches as $, AUTO_VIDEO_MATCHER as A, BoundingBox as B, Centroid as C, DUPLICATE_MATCHER as D, Edge as E, FrameGroup as F, PATH_VIDEO_MATCHER as G, BASENAME_VIDEO_MATCHER as H, Instance as I, IMAGE_DEDUP_VIDEO_MATCHER as J, SHAPE_VIDEO_MATCHER as K, Labels as L, MergeError as M, Node as N, OVERLAP_SKELETON_MATCHER as O, PredictedInstance as P, setFsResolver as Q, ROI as R, Skeleton as S, Track as T, UserROI as U, Video as V, type FsResolver as W, type MergeStrategy as X, _annotationCentroidXy as Y, _findAnnotationMatches as Z, _relinkFromPredicted as _, Symmetry as a, UserLabelImage as a$, _resolveMergedIsNegative as a0, _registerCentroidFactory as a1, type Point as a2, type PredictedPoint as a3, type PointsArray as a4, type PredictedPointsArray as a5, type PointColumns as a6, pointsEmpty as a7, predictedPointsEmpty as a8, clonePoint as a9, _registerMaskFactory as aA, AnnotationType as aB, type Geometry as aC, type ROIOptions as aD, rasterizeGeometry as aE, encodeWkb as aF, decodeWkb as aG, PredictedROI as aH, encodeRle as aI, decodeRle as aJ, resizeNearest as aK, traceMaskContours as aL, groupRingsIntoPolygons as aM, type SegmentationMaskOptions as aN, type UserSegmentationMaskOptions as aO, UserSegmentationMask as aP, PredictedSegmentationMask as aQ, type BoundingBoxOptions as aR, UserBoundingBox as aS, PredictedBoundingBox as aT, getCentroidSkeleton as aU, CENTROID_SKELETON as aV, type CentroidOptions as aW, UserCentroid as aX, PredictedCentroid as aY, type LabelImageObjectInfo as aZ, type LabelImageOptions as a_, pointsFromArray as aa, predictedPointsFromArray as ab, PointView as ac, pointsFromDict as ad, predictedPointsFromDict as ae, type NodeOrIndex as af, EXISTS_TTL_MS as ag, type CropOptions as ah, resolveCropRect as ai, type VideoBackendErrorKind as aj, type VideoBackendError as ak, SuggestionFrame as al, rodriguesTransformation as am, Camera as an, CameraGroup as ao, InstanceGroup as ap, RecordingSession as aq, injectSessionFrameResolver as ar, cloneRecordingSession as as, makeCameraFromDict as at, Identity as au, Embedding as av, Instance3D as aw, PredictedInstance3D as ax, LazyDataStore as ay, LazyFrameList as az, LabeledFrame as b, PredictedLabelImage as b0, normalizeLabelIds as b1, type VideoFrame as b2, type GetFrameOptions as b3, type RangeSource as b4, isRangeSource as b5, type VideoBackend as b6, type LabelsDict as b7, toDict as b8, fromDict as b9, cropPoints as ba, uncropPoints as bb, type CropRect as bc, type FlatPoints as bd, type PointPairs as be, cropFrame as bf, type FrameLike as bg, type RawFrame as bh, type Fill as bi, LabelsSet as c, LabelImage as d, SegmentationMask as e, SkeletonMatchMethod as f, InstanceMatchMethod as g, TrackMatchMethod as h, VideoMatchMethod as i, FrameStrategy as j, ErrorMode as k, SkeletonMatcher as l, InstanceMatcher as m, TrackMatcher as n, VideoMatcher as o, ConflictResolution as p, SkeletonMismatchError as q, MergeResult as r, MatchResult as s, MergeProgressBar as t, STRUCTURE_SKELETON_MATCHER as u, SUBSET_SKELETON_MATCHER as v, IOU_MATCHER as w, IDENTITY_INSTANCE_MATCHER as x, NAME_TRACK_MATCHER as y, IDENTITY_TRACK_MATCHER as z };
