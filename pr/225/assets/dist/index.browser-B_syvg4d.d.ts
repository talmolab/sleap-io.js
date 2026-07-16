import { b6 as VideoBackend, b4 as RangeSource$1, b3 as GetFrameOptions, b2 as VideoFrame, W as FsResolver, bc as CropRect, bi as Fill, bd as FlatPoints, be as PointPairs, T as Track, a$ as UserLabelImage, L as Labels, S as Skeleton, V as Video, al as SuggestionFrame, au as Identity, aq as RecordingSession, ay as LazyDataStore, b as LabeledFrame, c as LabelsSet, aC as Geometry, R as ROI, I as Instance, e as SegmentationMask, P as PredictedInstance, d as LabelImage, B as BoundingBox } from './dictionary-C9kfm8xi.js';

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
    /**
     * Lazy byte source (desktop): read only the ranges we need via a native
     * `read_range` instead of materializing the whole file. Mutually exclusive
     * with `fileBlob` / URL fetching.
     */
    private rangeSource;
    private decodeQueue;
    private latestRequestedFrame;
    /** Extra HTTP headers (e.g. Authorization) applied to every byte fetch. */
    private headers;
    constructor(source: string | File | Blob | RangeSource$1, options?: {
        cacheSize?: number;
        lookahead?: number;
        headers?: Record<string, string>;
        /** Display name when the source carries none (e.g. a {@link RangeSource}). */
        filename?: string;
    });
    getFrame(frameIndex: number, opts?: GetFrameOptions): Promise<VideoFrame | null>;
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
    static fromUrl(url: string, options?: MediaBunnyOptions & {
        headers?: Record<string, string>;
    }): Promise<MediaBunnyVideoBackend>;
    static fromBlob(blob: Blob, filename: string, options?: MediaBunnyOptions): Promise<MediaBunnyVideoBackend>;
    /**
     * Build from a lazy {@link RangeSource} — reads only the container index +
     * decoded frames' byte ranges via `readRange`, never the whole file. The
     * desktop counterpart of {@link fromBlob}, avoiding a multi-GB in-memory copy.
     * MediaBunny's {@link StreamSource} drives the reads; `read(start, end)` uses
     * an EXCLUSIVE end, so length is `end - start`.
     */
    static fromRangeSource(rangeSource: RangeSource$1, filename: string, options?: MediaBunnyOptions): Promise<MediaBunnyVideoBackend>;
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
    /**
     * Extra HTTP request headers forwarded to the worker's `openUrl`. When
     * non-empty, the worker buffer-downloads the file (authenticated) instead of
     * using header-free `createLazyFile` range streaming.
     */
    headers?: Record<string, string>;
}
/**
 * A lazy random-access byte source backed by native reads (e.g. a Tauri
 * `read_range` command). The streaming Worker pulls slices on demand through a
 * SharedArrayBuffer + `Atomics` bridge (the "B-seam" range reader), so large
 * files are never fully materialized in WASM memory. `readRange` runs on the
 * MAIN thread (the Worker cannot do the native IPC itself).
 */
interface RangeSource {
    /** Total file size in bytes. */
    size: number;
    /** Read `[offset, offset + length)`; may return fewer bytes at EOF. */
    readRange: (offset: number, length: number) => Promise<Uint8Array>;
}
/**
 * Source types supported by the streaming HDF5 file.
 */
type StreamingH5Source = string | ArrayBuffer | Uint8Array | File | RangeSource;
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
    private rangeReader?;
    private rangeControl?;
    private rangeData?;
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
     * The scheme is resolved on the MAIN thread (the worker cannot import the
     * scheme gate): `gs://`/`gcs://` are mapped to `storage.googleapis.com`, and
     * `s3://`/`az://`/`abfs://` fail fast with a redacted {@link RemoteIOError}.
     * Google Drive is NOT supported on the streaming worker path (Drive requires a
     * buffered, interstitial-following download, not range streaming); a Drive URL
     * throws a redacted {@link RemoteIOError} directing the caller to the
     * non-streaming reader. The worker only ever fetches an already-resolved
     * http(s) URL.
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
     * Open an HDF5 file from a lazy {@link RangeSource} via the B-seam bridge.
     *
     * The Worker registers a custom Emscripten device whose synchronous `read`
     * blocks on `Atomics.wait` over a SharedArrayBuffer; this main thread services
     * each request by calling `readRange` and waking the Worker. Requires
     * cross-origin isolation (SharedArrayBuffer / COOP+COEP).
     */
    openRange(source: RangeSource, options?: StreamingH5Options): Promise<void>;
    /**
     * Service a Worker byte-request: read via the app's `readRange`, copy the
     * bytes into the shared data area, then wake the (blocked) Worker. STATE is
     * stored last (release) so the Worker's `Atomics.wait` return (acquire) sees
     * the data + returned length.
     */
    private serviceRangeRequest;
    /**
     * Open an HDF5 file from any supported source.
     *
     * @param source - URL string, File, ArrayBuffer, Uint8Array, or RangeSource
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
    /**
     * Deferred (lazyVideoMetadata) backend: constructed WITHOUT per-video HDF5
     * reads. The first getFrame() reads frame_numbers/frame_sizes/attrs on demand
     * (ensureLoaded) so a many-video pkg.slp opens fast and pays the per-video
     * cost only for videos actually viewed.
     */
    private deferred;
    private loaded;
    private loadPromise;
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
        /** Build without per-video reads; ensureLoaded() fetches them on first use. */
        deferred?: boolean;
    });
    /** Whether a deferred backend has fetched its per-video metadata yet. */
    get isLoaded(): boolean;
    /**
     * Read the per-video HDF5 metadata skipped at load (lazyVideoMetadata):
     * frame_numbers (source→storage map + true source frame count), frame_sizes
     * (1D concatenated layout), and format/channel_order/dimensions from the
     * dataset attrs. Idempotent — the first getFrame() triggers it. Afterwards
     * `shape[0]` reflects the real source frame count, so the seekbar spans the
     * whole video (not just the embedded/labeled frames). No-op when not deferred.
     */
    ensureLoaded(): Promise<void>;
    getFrame(frameIndex: number): Promise<VideoFrame | null>;
    get embeddedFormat(): string;
    get embeddedChannelOrder(): string;
    getFrameBuffer(frameNumber: number): Promise<Uint8Array | null>;
    probeShape(sourceFrameCount?: number): Promise<void>;
    /**
     * Crop pushdown hook (Item 1 of JS issue #153). Always returns `null`: this
     * streaming embedded backend stores opaque encoded blobs (PNG/JPEG) or
     * per-frame-indexed raw rows, neither of which can be spatially hyperslabbed
     * without first decoding the whole frame. Pushdown is structurally impossible
     * here, so the crop wrapper falls back to full-decode + `cropFrame`. (A raw
     * rank-4 chunked HDF5 pixel-array backend, which COULD push down over the
     * worker's `dataset.slice`, does not exist in the JS port yet; see backend.ts
     * `readCrop` doc.) Short-circuits before any network read.
     */
    readCrop(): Promise<null>;
    /** Build a single-frame reader bound to the streaming worker file. */
    private buildReader;
    close(): void;
}

type ImageBytesReader = (path: string) => Promise<Uint8Array>;
/** Override the image-bytes reader. Pass `null` to fall back to the default. */
declare function setImageBytesReader(reader: ImageBytesReader | null): void;
/** The effective reader: explicit override if set, else the registered default. */
declare function getImageBytesReader(): ImageBytesReader | null;

interface ImageVideoOptions {
    /** Image paths, one per frame. */
    filename: string[];
    /** Byte reader; defaults to the globally-injected reader (`image-source`). */
    reader?: ImageBytesReader;
    /**
     * Optional `[frames, H, W, C]` from `.slp` metadata. When given, H/W/C are
     * trusted (frame count is always `filename.length`) and the first frame is
     * not decoded up front.
     */
    shape?: [number, number, number, number];
    /** Byte budget for the raw-bytes cache tier (default 128 MB). */
    bytesCacheBytes?: number;
    /** Byte budget for the decoded-frame cache tier (default 64 MB). */
    decodedCacheBytes?: number;
    /** Max concurrent prefetch reads (default 6). */
    prefetchConcurrency?: number;
    /** Frames to read ahead in the direction of travel (default 8; 0 disables). */
    prefetchAhead?: number;
    /** Frames to read behind the direction of travel (default 2). */
    prefetchBehind?: number;
}
/**
 * Indices to prefetch around `current`, biased ahead in the direction of travel
 * (`current` vs the previous index `last`). Reading is the dominant cost, so we
 * read ahead where the user is most likely to go next, plus a couple behind for
 * back-stepping. Clamped to `[0, length)` and excludes `current`. Pure.
 */
declare function computePrefetchWindow(current: number, last: number | null, length: number, ahead: number, behind: number): number[];
declare class ImageVideoBackend implements VideoBackend {
    filename: string[];
    shape: [number, number, number, number];
    private reader;
    private bytesCache;
    private decodedCache;
    private inflight;
    private prefetchConcurrency;
    private prefetchAhead;
    private prefetchBehind;
    private lastIndex;
    private prefetchGen;
    /**
     * The in-flight auto-prefetch promise from the most recent `getFrame`. Resolves
     * when that window finishes (or is superseded). Exposed for coordination/tests;
     * callers normally ignore it.
     */
    lastPrefetch: Promise<void>;
    private constructor();
    /**
     * Build a backend, inferring `shape` by decoding `filename[0]` once (cached)
     * when no `shape` is supplied — parity with Python `VideoBackend.img_shape`
     * (`read_test_frame` -> `_read_frame(0)`; index 0, not "first available").
     */
    static create(opts: ImageVideoOptions): Promise<ImageVideoBackend>;
    getFrame(frameIndex: number, opts?: GetFrameOptions): Promise<VideoFrame | null>;
    /**
     * Read a frame's encoded bytes, serving from the bytes tier when present (no
     * network) and coalescing concurrent reads of the same frame via `inflight` so
     * a getFrame and a prefetch never read the same file twice.
     */
    private startRead;
    /**
     * Read a window of frames' bytes into the bytes tier, concurrency-capped, and
     * cancellable: a later prefetch (or a jump) bumps the generation so in-flight
     * workers stop pulling new frames. Resolves when this window finishes or is
     * superseded. Frames already cached or in flight are skipped.
     */
    prefetch(indices: number[]): Promise<void>;
    /** Compute and launch the read-ahead window for `frameIndex` (fire-and-forget). */
    private triggerPrefetch;
    /**
     * Cheap liveness probe: attempt to read frame 0's ENCODED bytes (no decode),
     * serving from / seeding the bytes cache. Resolves `true` when the read
     * succeeds, `false` when it throws (missing file, unreadable path, injected
     * reader that rejects). Never throws.
     *
     * When {@link create} is given a `shape` it skips the up-front frame-0 decode,
     * so the returned backend can look healthy while pointing at media that isn't
     * there (issue #213). This lets the SLP loader — or any consumer that opens a
     * backend from stored metadata — confirm the first frame is reachable and drop
     * the backend if not.
     */
    probeFirstFrame(): Promise<boolean>;
    close(): void;
}

/**
 * A path decomposed for cross-platform reasoning: backslashes normalized to `/`,
 * a Windows `drive` letter (`"C:"`, no slash) split out, and the remaining
 * segments in `parts` (with `.` and empty segments dropped, `..` preserved).
 */
interface PosixPath {
    /** Whether the path is rooted (leading `/`, a UNC `//`, or a `drive` + `/`). */
    absolute: boolean;
    /** Windows drive prefix like `"C:"` (no trailing slash), or `null`. */
    drive: string | null;
    /**
     * A UNC / network-share root (leading `\\` or `//`, e.g. `\\server\share`).
     * Tracked separately so it round-trips as `//…` and is not collapsed to a
     * single-slash POSIX root — which on Windows would silently re-root the path
     * to the current drive and lose the share (issue #213).
     */
    unc: boolean;
    /** Path segments after the root/drive. */
    parts: string[];
}
/**
 * Parse a path string into a {@link PosixPath}. Handles UNC (`\\server\share`),
 * POSIX absolute (`/a/b`), Windows drive-absolute (`C:/a/b` or `C:\a\b`),
 * Windows drive-relative (`C:a`), and relative (`a/b`) forms. Never throws.
 */
declare function parsePath(p: string): PosixPath;
/** Render a {@link PosixPath} back to a forward-slash string. Inverse of {@link parsePath}. */
declare function formatPath(pp: PosixPath): string;
/** Final path segment (cross-platform), or `""` for a rootless empty path. */
declare function posixBasename(p: string): string;
/** Directory portion of a path (cross-platform), preserving root/drive. */
declare function posixDirname(p: string): string;
/** Join `tail` (treated as a relative segment) onto directory `dir`. */
declare function posixJoin(dir: string, tail: string): string;
/**
 * Reconstruct a candidate by grafting the stored path's tail onto the labels dir
 * at their longest shared "anchor": the longest suffix of the labels-dir
 * segments that also occurs contiguously within the stored path's directory
 * segments. The stored directory portion AFTER that anchor (plus the basename)
 * is appended to the FULL labels dir.
 *
 * Example — labels dir `L:/code/proj/2026-mars`, stored
 * `/home/u/code/proj/2026-mars/raw/img_0.jpg`: the anchor is
 * `code/proj/2026-mars`, so the candidate is
 * `L:/code/proj/2026-mars/raw/img_0.jpg`.
 *
 * Returns `null` when there is no shared anchor.
 */
declare function anchorCandidate(storedPath: string, labelsDir: string): string | null;
/**
 * Ordered, de-duplicated candidate paths for a single stored source path,
 * resolved against `labelsDir`. The first entry is always the verbatim
 * (normalized) stored path. Later entries require a non-empty `labelsDir`.
 * The trailing-tail grafts are emitted MOST-SPECIFIC-FIRST (deepest tail before
 * basename) so the first existing match is the least ambiguous.
 */
declare function videoPathCandidates(storedPath: string, labelsDir: string, maxDepth?: number): string[];
/**
 * A leading-prefix substitution derived from how the first frame resolved:
 * replace the `old` leading segment (root + parts) of a path with the `new` one,
 * preserving the shared `suffixLen` trailing segments. Applied to every path in
 * an image sequence so the whole list is remapped from one resolution probe.
 */
interface PrefixSwap {
    old: PosixPath;
    new: PosixPath;
    suffixLen: number;
}
/**
 * Derive the {@link PrefixSwap} that turns `firstStored` into `firstResolved` by
 * keeping their longest common trailing segments and swapping everything before.
 */
declare function derivePrefixSwap(firstStored: string, firstResolved: string): PrefixSwap;
/**
 * Apply a {@link PrefixSwap} to `path`: if `path` starts with the swap's `old`
 * leading prefix (same root/drive and leading segments), replace that prefix
 * with `new`; otherwise return `path` normalized and unchanged (paths in the
 * list that don't share the first frame's prefix are left as-is).
 */
declare function applyPrefixSwap(path: string, swap: PrefixSwap): string;
/**
 * First candidate that {@link FsResolver.exists} confirms, or `null` if none do.
 * A resolver that throws on a candidate is treated as "does not exist" for that
 * candidate (the scan continues) — matching the conservative degrade elsewhere.
 */
declare function resolveFirstExisting(candidates: string[], fs: FsResolver): Promise<string | null>;
/** Result of resolving a video source against the labels directory. */
interface ResolvedVideoSource {
    /**
     * The source remapped to on-disk paths where resolution succeeded, or the
     * original source unchanged when it resolved verbatim / could not be located.
     * Same shape as the input (string vs string[]).
     */
    filename: string | string[];
    /**
     * `true` IFF the resolver was consulted and the first frame/file could NOT be
     * located at ANY candidate — the signal for callers to withhold an unreadable
     * backend and record a "missing" reason.
     */
    firstMissing: boolean;
}
/**
 * Resolve a stored video source (single file or `ImageVideo` list) against the
 * labels-file directory using `fs` for existence checks.
 *
 * Only the first frame of a list is probed; the winning candidate yields one
 * prefix-swap applied to the whole list. Returns the original source unchanged
 * on a verbatim hit (no churn) or when nothing could be located (`firstMissing`
 * then flags the miss). Callers MUST only invoke this when an `FsResolver` is
 * available; with none, degrade to the stored source directly.
 */
declare function resolveVideoSource(source: string | string[], labelsDir: string, fs: FsResolver): Promise<ResolvedVideoSource>;

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
declare function createVideoBackend(source: string | string[] | File | Blob, options?: {
    dataset?: string;
    embedded?: boolean;
    frameNumbers?: number[];
    frameSizes?: number[];
    format?: string;
    channelOrder?: string;
    shape?: [number, number, number, number];
    fps?: number;
    backend?: VideoBackendType;
    /**
     * Extra HTTP request headers (e.g. `{ Authorization: "Bearer …" }`) applied
     * to remote video byte fetches. Forwarded to {@link Mp4BoxVideoBackend} and
     * {@link MediaBunnyVideoBackend.fromUrl}. URL filenames are run through
     * {@link resolveUrl} (rejecting `s3://`/`az://`/`abfs://`).
     */
    headers?: Record<string, string>;
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
    /** Inner backend's embedded blob format (delegated; a crop is spatial). */
    get embeddedFormat(): string | undefined;
    /** Inner backend's embedded blob channel order (delegated). */
    get embeddedChannelOrder(): string | undefined;
    /**
     * Raw stored blob for `frameNumber`, delegated to the inner backend. The
     * stored blobs are the uncropped inner frames (the crop rides `/video_crops`),
     * so re-embedding copies the inner blobs verbatim.
     */
    getFrameBuffer(frameNumber: number): Promise<Uint8Array | null>;
    /** Deferred-metadata load, delegated to the inner backend (no-op if absent). */
    ensureLoaded(): Promise<void>;
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
     * First attempts crop pushdown: if the inner backend implements the optional
     * {@link VideoBackend.readCrop} hook (Item 1 of JS issue #153, mirroring
     * Python `_source_frame`, `video_reading.py:2392`) it is given the chance to
     * read only the crop region directly from storage. A non-null result is
     * already cropped/padded and is byte-identical to the fallback, so it is
     * returned as-is. `null` (the default for every shipping backend — encoded
     * blobs / per-frame rows cannot be spatially hyperslabbed) means fall back.
     *
     * Fallback: decode the inner full frame, normalize it to readable pixels
     * (rasterizing an opaque `ImageBitmap`, decoding undecoded encoded bytes, or
     * wrapping raw pixel bytes), then apply {@link cropFrame} with this wrapper's
     * crop/fill. Returns `null` when the inner returns `null` (no such frame).
     */
    getFrame(frameIndex: number, opts?: GetFrameOptions): Promise<VideoFrame | null>;
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
    /**
     * Extra HTTP request headers (e.g. `{ Authorization: "Bearer …" }`) applied to
     * every remote byte fetch for this file AND persisted onto embedded-video
     * backends so later reopens/probes stay authenticated. Header NAMES are
     * case-insensitive; `"Accept-Encoding"` is always overridden to `"identity"`
     * on range requests. Ignored for Google Drive URLs (credentials are stripped).
     *
     * Limitation: `createLazyFile` (Emscripten synchronous XHR) cannot carry
     * custom headers, so authenticated remote `.slp` is downloaded in full;
     * range streaming with custom headers is not yet supported on the main thread.
     */
    headers?: Record<string, string>;
    /**
     * URL to the h5wasm IIFE bundle loaded by the streaming Worker (via
     * `importScripts`). Defaults to a CDN. Set this to a **same-origin** URL when
     * the page is cross-origin-isolated (COOP/COEP), since COEP blocks the
     * cross-origin CDN `importScripts` — e.g. a desktop app that serves its own
     * bundled `h5wasm.js`.
     */
    h5wasmUrl?: string;
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
/** Static header (everything except the pose frames) for {@link openSlpWriter}. */
interface SlpWriteHeader {
    skeletons: Skeleton[];
    videos: Video[];
    tracks?: Track[];
    suggestions?: SuggestionFrame[];
    identities?: Identity[];
    sessions?: RecordingSession[];
    provenance?: Record<string, unknown>;
}
/** Per-store id offsets applied while appending (see {@link SlpStreamWriter.appendStore}). */
interface AppendStoreOptions {
    /** Added to each frame's (remapped) video index. */
    videoIndexOffset?: number;
    /** Added to each instance's non-null track index. */
    trackOffset?: number;
    /** Added to each instance's skeleton index. */
    skeletonOffset?: number;
    /** Frames per append window (defaults to {@link DEFAULT_WRITE_WINDOW_FRAMES}). */
    windowFrames?: number;
}
/**
 * A chunked byte sink for {@link SlpStreamWriter.writeToSink} — the output-side
 * companion to the append writer. Satisfied by a browser
 * `FileSystemWritableFileStream` (OPFS / save-file-picker) and by Node's
 * `fs.WriteStream`, so the finished file need not be resident as one big
 * `Uint8Array`.
 */
interface SlpWriteSink {
    write(chunk: Uint8Array): unknown | Promise<unknown>;
    close?(): unknown | Promise<unknown>;
}
/**
 * Incremental SLP writer. Open with {@link openSlpWriter} (which writes the
 * header and creates the resizable pose datasets), append one or more
 * {@link LazyDataStore}s with {@link appendStore}, then {@link close} to get the
 * file bytes. Ids are rebased per store so multiple stores concatenate into one
 * consistent multi-video file.
 */
declare class SlpStreamWriter {
    private file;
    private module;
    private memPath;
    private videos;
    private skeletons;
    private tracks;
    private frameRows;
    private instRows;
    private pointRows;
    private predPointRows;
    private negativeFrames;
    private closed;
    private writtenFrames;
    private pendingRois;
    private pendingMasks;
    private pendingBboxes;
    private pendingCentroids;
    private pendingLabelImages;
    /** @internal — use {@link openSlpWriter}. */
    constructor(module: any, file: any, memPath: string, header: {
        videos: Video[];
        skeletons: Skeleton[];
        tracks: Track[];
    });
    /**
     * Append every frame of `store` (in windows), rebasing its ids onto the
     * running file so the store's videos/instances/points/tracks land at the
     * offsets given in `opts`. Point coordinates and all per-instance fields are
     * copied verbatim from the store's columns — no `Instance`/`LabeledFrame`
     * object is constructed. The store's frame/instance/point tables are assumed
     * ordered by frame (the SLP on-disk invariant).
     *
     * A `(video, frameIdx)` already written (by an earlier append) is SKIPPED — so
     * append overlays via {@link appendFrames} first for them to win. Frame /
     * instance / point ids are assigned from running OUTPUT counters (not the
     * store's positions), so skips leave no gaps; cross-references
     * (`from_predicted`, annotation instance links) are remapped through the
     * skipped ranges. `store` must not itself contain duplicate `(video, frameIdx)`.
     */
    appendStore(store: LazyDataStore, opts?: AppendStoreOptions): void;
    /**
     * Append a batch of already-materialized `LabeledFrame`s — the write-side of
     * an edit overlay: user-corrected or newly-added frames layered onto a lazy
     * stream. Each frame's `video`/`skeleton`/`track` is resolved against this
     * writer's header (by identity); `from_predicted` links are resolved among the
     * batch. Intended for a bounded batch (the corrected subset), so it is not
     * windowed. Interleave freely with {@link appendStore}.
     */
    appendFrames(frames: LabeledFrame[]): void;
    /**
     * Collect a store's per-frame + undistributed annotations, remapping the
     * video index (`+vOff`) and the instance link (through `outIdxOf`, `+instBase`)
     * onto the combined file. Annotations on a SKIPPED (overlaid) frame — whose
     * combined `"vid:frameIdx"` key is in `skippedKeys` — are dropped. The store's
     * map keys are `"videoIndex:frameIdx"` (array-index video).
     */
    private collectStoreAnnotations;
    /**
     * Collect a materialized frame's annotations, resolving each annotation's live
     * `instance` to its GLOBAL index via the batch's local map (`+instBase`).
     * Annotations without a live `instance` in the batch drop their link (-1).
     */
    private collectFrameAnnotations;
    /**
     * Write all accumulated annotation datasets. The per-type writers read the
     * instance link off each object, so the resolved GLOBAL index is applied via a
     * contained mutate→write→restore (source annotations are left unchanged).
     */
    private writePendingAnnotations;
    /** Write pending `negative_frames` and close the HDF5 file (shared finalize). */
    private finalizeFile;
    /** Finalize the file (writes `negative_frames` if any) and return its bytes. */
    close(): Uint8Array;
    /**
     * Finalize and stream the file to `sink` in chunks, then unlink it — the
     * output-side companion to {@link appendStore}, so the finished file never has
     * to be resident as one big `Uint8Array` on the JS side. Reads the in-memory
     * HDF5 file with chunked FS reads when available (falling back to a single
     * read). `sink.close()` is awaited if present.
     *
     * @param opts.chunkBytes Chunk size (default 8 MiB).
     */
    writeToSink(sink: SlpWriteSink, opts?: {
        chunkBytes?: number;
    }): Promise<void>;
    /**
     * Release the underlying HDF5 file WITHOUT producing bytes — call to clean up
     * a writer that will not be finished (e.g. after an error). Idempotent and
     * best-effort (never throws); the file/MEMFS path are closed and unlinked.
     */
    dispose(): void;
}
/**
 * Open a streaming SLP writer: create the in-memory HDF5 file, write the header
 * (skeletons/videos/tracks/suggestions/identities/sessions/provenance), and
 * create the resizable `frames`/`instances`/`points`/`pred_points` datasets.
 * Frame data is appended later via {@link SlpStreamWriter.appendStore}.
 */
declare function openSlpWriter(header: SlpWriteHeader): Promise<SlpStreamWriter>;
/**
 * Merge N per-camera {@link LazyDataStore}s into one combined multi-video
 * `.slp`, streaming each store's frames in bounded windows (peak memory ≪ the
 * whole graph). The combined `videos` and `tracks` are the concatenation of the
 * stores' (video index and track index remapped accordingly); all stores must
 * share a structurally-identical skeleton list (the multi-camera case), which
 * becomes the combined skeleton set. Session graph / identities / suggestions /
 * provenance for the combined file are supplied via `options`.
 *
 * @returns the SLP file bytes (round-trips via `readSlpStreaming` / `readSlp`).
 */
interface MergeStoresOptions {
    sessions?: RecordingSession[];
    identities?: Identity[];
    suggestions?: SuggestionFrame[];
    provenance?: Record<string, unknown>;
    windowFrames?: number;
}
/**
 * Merge N per-camera {@link LazyDataStore}s into one combined multi-video
 * `.slp`, streaming each store's frames in bounded windows (peak memory ≪ the
 * whole graph). The combined `videos` and `tracks` are the concatenation of the
 * stores' (video index and track index remapped accordingly); all stores must
 * share a structurally-identical skeleton list (the multi-camera case), which
 * becomes the combined skeleton set. Session graph / identities / suggestions /
 * provenance for the combined file are supplied via `options`.
 *
 * @returns the SLP file bytes (round-trips via `readSlpStreaming` / `readSlp`).
 */
declare function saveSlpMergedFromStores(stores: LazyDataStore[], options?: MergeStoresOptions): Promise<Uint8Array>;
/**
 * Like {@link saveSlpMergedFromStores}, but streams the combined file to `sink`
 * in chunks instead of returning bytes — so neither the input `Labels` graph nor
 * the whole output is ever fully resident. Use with a browser
 * `FileSystemWritableFileStream` (OPFS / save picker) or Node `fs.WriteStream`.
 */
declare function saveSlpMergedToSink(stores: LazyDataStore[], sink: SlpWriteSink, options?: MergeStoresOptions & {
    chunkBytes?: number;
}): Promise<void>;
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
 * browser-safe too: `writeLabelsToBytes` builds the file in an h5wasm in-memory
 * virtual FS and returns the bytes. `writeLabels` wraps it to write those bytes
 * to disk through the Node filesystem ops registered by `h5-node.ts` — the only
 * Node-only step — so this module stays free of Node-only imports and the
 * browser bundle stays clean.
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
 * SLEAP Analysis CSV export.
 *
 * Writes `Labels` to the "SLEAP Analysis" CSV format — one row per instance per
 * frame with columns `track, frame_idx, instance.score, {node}.score,
 * {node}.x, {node}.y, ...` (node columns sorted alphabetically). A faithful
 * port of the `format="sleap"` path of Python `sleap_io.io.csv.write_labels`
 * (`_write_sleap` + `_transform_to_sleap_format`) over the instances-DataFrame
 * builder in `sleap_io.codecs.dataframe` (`_to_instances_df`).
 *
 * With `includeEmpty`, frames without instances are emitted as NaN rows and each
 * video's range is padded up to its full length — the fix from sleap-io PR #480
 * (matching the numpy / Analysis-HDF5 export, which already spans the whole
 * video).
 *
 * {@link labelsToCsv} is pure (browser-safe) and returns the CSV text;
 * {@link saveLabelsCsv} writes it to disk via the Node fs writer registered by
 * `h5-node.ts`, so this module stays free of Node-only imports.
 */

interface CsvExportOptions {
    /** Restrict output to one video (a `Video` or its index). Default: all videos. */
    video?: Video | number | null;
    /** Include per-node and instance confidence scores. Default `true`. */
    includeScore?: boolean;
    /**
     * Emit NaN-filled rows for frames with no instances, padding each video's
     * range up to its full length (falling back to last labeled frame + 1 when
     * the length is unknown). Default `false`. Mirrors sleap-io PR #480.
     */
    includeEmpty?: boolean;
    /**
     * First frame index (inclusive). Default: `0` when `includeEmpty`, else the
     * first labeled frame.
     */
    startFrame?: number | null;
    /**
     * End frame index (exclusive). Default: the full video length when known,
     * else last labeled frame + 1.
     */
    endFrame?: number | null;
}
/**
 * Build the SLEAP Analysis CSV text for `labels`.
 *
 * Pure and browser-safe. See {@link saveLabelsCsv} to write it to disk.
 */
declare function labelsToCsv(labels: Labels, options?: CsvExportOptions): string;
/**
 * Write `labels` to a SLEAP Analysis CSV file. Node-only (disk I/O); use
 * {@link labelsToCsv} for the browser-safe string.
 */
declare function saveLabelsCsv(labels: Labels, filename: string, options?: CsvExportOptions): Promise<void>;

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
 * @param options.onProgress - Optional callback fired as loading advances through
 *   its stages: (current, total, message?), where current/total count completed
 *   stages and message labels the stage about to run. Emitted by all reader
 *   paths (streaming, eager, and lazy); the final call is (total, total,
 *   "Finalizing"). Stage counts differ by path (streaming is finer-grained).
 * @returns Loaded Labels object
 */
declare function loadSlp(source: SlpSource, options?: {
    openVideos?: boolean;
    h5?: OpenH5Options;
    lazy?: boolean;
    onProgress?: (current: number, total: number, message?: string) => void;
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
 * Build SLEAP Analysis HDF5 (.h5) bytes from labels, in memory.
 *
 * Browser-safe counterpart to {@link saveAnalysisH5} (which writes to disk):
 * assembles the file in an h5wasm in-memory virtual FS and returns the bytes, so
 * callers in the browser or the Tauri WebView can save them however they like
 * (native dialog, download, etc.). Mirrors {@link saveSlpToBytes}.
 *
 * @param labels - Labels object to export
 * @param options - Same options as {@link saveAnalysisH5} (minus the filename)
 * @returns The `.h5` file contents
 */
declare function saveAnalysisH5ToBytes(labels: Labels, options?: {
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
}): Promise<Uint8Array>;

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

/**
 * Remote-loading helpers: URL/scheme resolution, credential redaction, a typed
 * {@link RemoteIOError}, retry/backoff, header transforms, and a non-throwing
 * existence probe.
 *
 * This is the browser+Node-portable subset of Python sleap-io's `_remote.py`
 * (PRs #439/#445). It threads auth headers end-to-end and guarantees that no
 * thrown error or log line leaks credentials (userinfo / sensitive query
 * params). See {@link redactUrl} and {@link RemoteIOError}.
 *
 * @module
 */
/** URL schemes recognized as remote (vs. a local path). Port of Python `URL_SCHEMES`. */
declare const URL_SCHEMES: Set<string>;
/** Cloud schemes that need a provider SDK (not available in the browser). */
declare const CLOUD_SCHEMES: Set<string>;
/** Hosts handled by the Google Drive resolver. */
declare const GDRIVE_HOSTS: Set<string>;
/**
 * Headers dropped on a cross-origin redirect and never sent to Google Drive
 * hosts. Lowercase for case-insensitive matching.
 */
declare const SENSITIVE_HEADERS: Set<string>;
/**
 * Query-param names (lowercased) whose VALUE is masked to `***` in
 * {@link redactUrl}. Other params are left untouched.
 */
declare const SENSITIVE_QUERY_PARAMS: Set<string>;
/** HTTP status codes that {@link withRetries} treats as retryable. */
declare const RETRYABLE_STATUSES: Set<number>;
/**
 * Whether `value` looks like a remote URL (one of {@link URL_SCHEMES}).
 *
 * Port of Python `_is_url`. The `scheme.length > 1` guard is mandatory so a
 * Windows drive letter (`C:\...`) is not misread as a URL.
 */
declare function isUrl(value: unknown): boolean;
/**
 * Whether `value` is a Google Drive share URL. Port of Python `_is_gdrive_url`.
 * Never throws on malformed input.
 */
declare function isGdriveUrl(value: unknown): boolean;
/**
 * Mask credentials in a URL: userinfo becomes `***:***@host`, and the VALUES of
 * sensitive query params ({@link SENSITIVE_QUERY_PARAMS}) become `***`
 * (serialized percent-encoded as `%2A%2A%2A`, matching Python). Other params are
 * left intact. On parse failure the input is returned unchanged.
 *
 * Port of Python `_redact_url`.
 */
declare function redactUrl(url: string): string;
/**
 * A short, credential-scrubbed one-line summary of an arbitrary error, suitable
 * for logging and for the `cause=` segment of {@link RemoteIOError}. Any URL
 * tokens embedded in the message are run through {@link redactUrl}.
 *
 * Port of Python `_redacted_cause_summary`.
 */
declare function redactedCauseSummary(e: unknown): string;
/**
 * Typed error for every remote-loading failure. The `url` is ALWAYS stored
 * redacted (redaction happens in the constructor from the RAW url passed in),
 * and the raw transport error is NEVER chained as `.cause` — only a redacted
 * {@link redactedCauseSummary} is kept, so credentials cannot leak through a
 * re-throw or `.cause` inspection.
 *
 * Port of Python `RemoteIOError`.
 */
declare class RemoteIOError extends Error {
    readonly status: number | null;
    /** ALWAYS redacted. */
    readonly url: string;
    readonly causeSummary?: string;
    /**
     * Delay (ms) hinted by a `Retry-After` response header, threaded to
     * {@link withRetries}. Not part of Python; a JS-side channel so the retry
     * loop can honor server backoff without re-issuing the failed request.
     */
    retryAfterMs?: number;
    constructor(opts: {
        message: string;
        url: string;
        status?: number | null;
        cause?: unknown;
    });
}
/** Result of {@link resolveUrl}. */
interface ResolvedUrl {
    /** Fetchable HTTPS URL (passthrough for http(s); mapped for gs/gcs). */
    url: string;
    /** When true, the caller must route through the Google Drive resolver. */
    gdrive: boolean;
}
/**
 * Turn any user-supplied URL into a fetchable HTTPS URL (or flag it for Google
 * Drive). The single public scheme gate.
 *
 * - `http(s)://` (non-Drive host): passthrough, `gdrive: false`.
 * - Google Drive host: `gdrive: true` (caller routes to `openGdrive`).
 * - `gs://<bucket>/<obj>` / `gcs://...`: mapped to
 *   `https://storage.googleapis.com/<bucket>/<obj>` (object path + query
 *   preserved verbatim). NOTE: this only resolves PUBLIC objects without auth;
 *   private buckets still need a presigned HTTPS URL — no signing is attempted.
 * - `s3://` / `az://` / `abfs://`: throws {@link RemoteIOError} (no in-browser
 *   SDK) directing the user to a presigned `https://` URL.
 * - non-URL input: throws {@link RemoteIOError} (`resolveUrl` only acts on URLs).
 *
 * Port of Python's scheme handling.
 */
declare function resolveUrl(url: string): ResolvedUrl;
/**
 * Map an HTTP status to a short human message. Port of Python's `_raise_remote`
 * table.
 */
declare function statusToMessage(status: number): string;
/**
 * Build and throw a {@link RemoteIOError} from a transport-level failure (no
 * `response`). Classifies fetch network errors / aborts. Port of Python's
 * fetch-level classification in `_raise_remote`.
 *
 * @param url Raw URL (redacted by the error constructor).
 * @param e The thrown transport error.
 * @param status Optional HTTP status when a response was received.
 */
declare function raiseRemote(url: string, e: unknown, status?: number | null): never;
/**
 * Copy `headers`, force `Accept-Encoding: identity`, and drop any user-supplied
 * `Accept-Encoding` (case-insensitive) so it cannot be overridden. Apply to
 * every ranged request. Port of Python `_identity_headers`.
 */
declare function identityHeaders(headers?: Record<string, string>): Record<string, string>;
/**
 * Drop sensitive headers ({@link SENSITIVE_HEADERS}) when `toUrl` is a different
 * origin than `fromUrl`; otherwise return `headers` unchanged. Port of Python
 * `_strip_cross_origin_headers`. Invoked only where WE follow redirects
 * manually (Node range reader, Drive); the browser strips `Authorization`
 * cross-origin natively.
 */
declare function stripCrossOriginHeaders(headers: Record<string, string>, fromUrl: string, toUrl: string): Record<string, string>;
/**
 * Run `fn`, retrying on retryable {@link RemoteIOError}s (retryable status or a
 * connection-error classification) with exponential backoff, honoring a
 * `Retry-After` hint when present.
 *
 * Backoff: `min(200 * 2**attempt, 30000)` ms (attempt 0-indexed). Port of
 * Python `_open_with_retries` / `_retry_sleep_seconds`.
 */
declare function withRetries<T>(fn: () => Promise<T>, options?: {
    retries?: number;
}): Promise<T>;
/**
 * Parse a `Retry-After` header into milliseconds. Only the integer-seconds form
 * is honored; the HTTP-date form is ignored (returns undefined → computed
 * backoff). Used by fetch wrappers to attach `retryAfterMs` to a thrown error.
 */
declare function parseRetryAfterMs(value: string | null): number | undefined;
/**
 * `fetch` wrapped in {@link withRetries}: every remote byte fetch goes through
 * here so transient failures are retried with backoff (mirrors Python's
 * `_open_with_retries`, which wraps every remote open).
 *
 * Retries on:
 * - transient network errors (`raiseRemote` classifies a `TypeError` →
 *   "connection error" / an `AbortError` → "timeout" as a retryable
 *   {@link RemoteIOError} with `status === null`), and
 * - retryable HTTP statuses ({@link RETRYABLE_STATUSES}: 429/500/502/503/504),
 *   honoring a `Retry-After` header via {@link parseRetryAfterMs}.
 *
 * For a NON-retryable status (e.g. 206/404/redirect) the `Response` is returned
 * unchanged so the caller applies its own handling. Every thrown error is the
 * redacted typed {@link RemoteIOError}; the raw transport error never escapes.
 *
 * @param url Resolved fetch URL (raw; redacted by the error constructor).
 * @param init `RequestInit` (headers, method, Range, etc.).
 * @param options `retries` forwarded to {@link withRetries}.
 */
declare function fetchRetrying(url: string, init?: RequestInit, options?: {
    retries?: number;
}): Promise<Response>;
/**
 * Non-throwing existence probe for a URL. Tries HEAD, falling back to a
 * `Range: bytes=0-0` GET when HEAD is unavailable. ALWAYS returns a boolean
 * (any thrown error → `false`). Port of Python `_head_or_range_probe`.
 *
 * For Google Drive, HEAD is rejected by Google, so success is approximated by
 * whether a file id can be parsed from the URL (no network).
 */
declare function headOrRangeProbe(url: string, options?: {
    headers?: Record<string, string>;
}): Promise<boolean>;

/**
 * Google Drive share-link resolver (browser + Node portable).
 *
 * Ports the realistic subset of Python sleap-io's `_gdrive.py` (PRs #441/#445):
 * parse a Drive file id from any share-link shape, scrape the virus-scan
 * interstitial to a real download URL, enforce a host allowlist (SSRF guard),
 * and buffer-download the file capped at a maximum in-memory size. Credentials
 * are stripped before any request and never sent to Google hosts.
 *
 * @module
 */
/** Default cap for a buffered Drive download: 8 GiB. */
declare const DEFAULT_MAX_BYTES: number;
/**
 * Extract a Google Drive file id from any share-link shape.
 *
 * Order matters: folders are rejected first, then an `id=` query param, then the
 * `/file/d/<ID>/...` path form. Throws (with a redacted url) for folder URLs,
 * trailing-segment URLs, and anything else unparsable. Port of `_parse_gdrive`.
 */
declare function parseGdrive(url: string): string;
/**
 * Scrape the next download URL out of a Drive confirmation page. Tries, in EXACT
 * precedence order: small-file href, large-file `#download-form`, JSON
 * `downloadUrl`, then an error caption (→ throws). Port of `_url_from_confirmation`.
 *
 * @param html The interstitial HTML.
 * @param url The originating URL (for redacted error context).
 */
declare function urlFromConfirmation(html: string, url?: string): string;
/**
 * SSRF guard: allow only http(s) URLs whose host is in the Drive allowlist or
 * ends with `.googleusercontent.com`. Throws a redacted {@link RemoteIOError}
 * otherwise. Call before EVERY cookie-carrying GET. Port of `_check_download_host`.
 */
declare function checkDownloadHost(url: string): void;
/**
 * Resolve a Google Drive share link and buffer-download the file.
 *
 * Strips sensitive headers, sends a browser User-Agent, follows the virus-scan
 * interstitial through up to {@link MAX_HOPS} hops (enforcing the host
 * allowlist on each), and caps the in-memory download at `maxBytes`. Port of
 * `_resolve_and_fetch`.
 *
 * Drive is always download-mode; `streamMode`/range options do not apply. Drive
 * VIDEO is unsupported (the SLP caller rejects it before reaching here).
 *
 * @returns The downloaded file bytes.
 */
declare function openGdrive(url: string, options?: {
    headers?: Record<string, string>;
    maxBytes?: number;
}): Promise<Uint8Array>;

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

/**
 * COCO-style dataset reader (read path only).
 *
 * Port of the read path of `sleap_io/io/coco.py`. Supports both pose-estimation
 * datasets (keypoints) and detection-only datasets (bounding boxes and/or
 * segmentation as polygons or RLE), decoding them into a {@link Labels} object.
 *
 * This module is browser-safe: it never imports `fs`/`path` at the top level.
 * The path-based Node loader lives in `coco-node.ts`. The COCO *writing* path
 * (`convert_labels`, `write_labels`, panoptic) is intentionally NOT ported.
 */

/** A COCO category definition. */
interface CocoCategory {
    id: number;
    name?: string;
    supercategory?: string;
    keypoints?: string[];
    skeleton?: number[][];
}
/** A COCO image entry. */
interface CocoImage {
    id: number;
    file_name: string;
    height?: number;
    width?: number;
    [key: string]: unknown;
}
/** A COCO RLE segmentation dict. */
interface CocoRle {
    counts: number[] | string;
    size: [number, number];
}
/** A COCO segmentation field: polygon list, RLE dict, or null. */
type CocoSegmentation = number[][] | CocoRle | null | undefined;
/** A COCO annotation entry. */
interface CocoAnnotation {
    id?: number;
    image_id: number;
    category_id: number;
    keypoints?: number[];
    num_keypoints?: number;
    bbox?: number[];
    segmentation?: CocoSegmentation;
    area?: number;
    iscrowd?: number;
    score?: number | null;
    track_id?: number | string;
    instance_id?: number | string;
    attributes?: {
        object_id?: number | string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
/** A parsed COCO annotation document. */
interface CocoJson {
    images: CocoImage[];
    annotations: CocoAnnotation[];
    categories: CocoCategory[];
    [key: string]: unknown;
}
/** Options for reading a COCO dataset. */
interface ReadCocoOptions {
    /** Root dir for resolving image paths. Node loader defaults to dirname(jsonPath). */
    datasetRoot?: string;
    /** false → 3 channels (RGB), true → 1 channel. Default false. */
    grayscale?: boolean;
    /** "mask" | "roi". Default "mask". Validated up front. */
    segmentationFormat?: "mask" | "roi";
    /** One shared Track per category name. Default false. */
    categoryAsTrack?: boolean;
    /**
     * Browser-safe image resolver. Given a COCO file_name and datasetRoot, return
     * the resolved path string, or null if unresolvable (→ image skipped). The
     * Node loader supplies a default fs-based resolver replicating Python's
     * resolve_image_path (direct + prefixes + recursive basename glob). If omitted
     * in the browser core, the resolver defaults to identity-join:
     *   datasetRoot ? `${datasetRoot}/${file_name}` : file_name  (never null).
     */
    resolveImage?: (fileName: string, datasetRoot: string | undefined) => string | null;
}
/**
 * Predicate mirroring Python `_is_coco_data`: true when the value is a non-array
 * object whose `images`, `annotations`, and `categories` fields are all arrays.
 */
declare function isCocoData(data: unknown): boolean;
/**
 * Parse a COCO JSON string-or-object and validate the required top-level fields.
 * Mirrors Python `parse_coco_json` (minus the file read, which is Node-only).
 */
declare function parseCocoJson(jsonOrObject: string | CocoJson): CocoJson;
/**
 * Create a {@link Skeleton} from a COCO category. Keypoint names become nodes;
 * 1-based skeleton connections become edges (out-of-range / non-pair entries are
 * skipped). Mirrors Python `create_skeleton_from_category`.
 */
declare function createSkeletonFromCategory(category: CocoCategory): Skeleton;
/**
 * Decode flat COCO `[x1,y1,v1,...]` keypoints into `(N, 3)` rows `[x, y, flag]`.
 * Visibility 0 → `[NaN, NaN, 0]` (not labeled); any other value → `[x, y, 1]`.
 * Mirrors Python `decode_keypoints`.
 */
declare function decodeKeypoints(keypoints: number[], numKeypoints: number, skeleton: Skeleton): number[][];
/**
 * Decode COCO compressed (LEB128 / pycocotools `frString`) RLE `counts` to a
 * list of run lengths. Each byte minus 48 yields 6 bits: low 5 bits are data,
 * `0x20` is the continuation flag, and `0x10` on the final byte marks a negative
 * value (sign-extended). Runs after index 2 are stored as a delta from the run
 * two positions earlier. Mirrors Python `_decode_compressed_rle_counts`.
 *
 * Note: JS bitwise ops are 32-bit signed. The shifts here are safe for run
 * lengths up to 2^31; very large masks (run > 2^31) could overflow, which is out
 * of scope for COCO fixtures.
 */
declare function decodeCompressedRleCounts(counts: string): number[];
/**
 * Decode COCO RLE `counts`/`size` to a row-major `H×W` boolean 2D array. COCO
 * RLE is column-major (Fortran); this transposes internally so the result is
 * row-major. Uncompressed (number[]) and compressed (string) counts are both
 * supported. Mirrors Python `_decode_coco_rle`.
 */
declare function decodeCocoRle(counts: number[] | string, size: [number, number]): boolean[][];
/** Metadata forwarded to created masks/ROIs/bboxes. */
interface DecodeKwargs {
    category?: string;
    instance?: Instance | null;
    track?: Track | null;
}
/**
 * Decode a COCO `segmentation` field into masks and/or ROIs. RLE always becomes
 * a {@link SegmentationMask} at its native size. Polygons rasterize to a mask in
 * `"mask"` mode (when image dims are positive) or stay as one ROI per ring in
 * `"roi"` mode (or `"mask"` mode without dims). A `score` selects predicted
 * variants. Mirrors Python `_decode_segmentation`.
 */
declare function decodeSegmentation(segmentation: CocoSegmentation, height: number, width: number, segmentationFormat: "mask" | "roi", kwargs: DecodeKwargs, score?: number | null): {
    masks: SegmentationMask[];
    rois: ROI[];
};
/**
 * Read a COCO dataset from a JSON string or parsed object into {@link Labels}.
 * Browser-safe core (no `fs`); image resolution is delegated to
 * `options.resolveImage` (defaults to identity-join). Mirrors Python
 * `read_labels` (read path).
 */
declare function readCoco(jsonOrObject: string | CocoJson, options?: ReadCocoOptions): Labels;
/**
 * Read multiple COCO splits (browser-safe core). Each split is read
 * independently with fresh track dicts. Mirrors Python `read_labels_set` minus
 * the directory glob (which lives in the Node loader). The provenance `split`
 * key is set per split.
 */
declare function readCocoSet(splits: Record<string, string | CocoJson>, options?: ReadCocoOptions): Record<string, Labels>;

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
/** Clamp a blend opacity to [0, 1]; non-finite inputs fall back to 0. */
declare function clampAlpha(alpha: number): number;
/**
 * Pick the per-item color for index `i`. When an explicit `colors` array is
 * shorter than the item list it cycles (`colors[i % colors.length]`) rather
 * than indexing out of bounds; an empty array falls back to `fallback`.
 */
declare function pickColor(colors: RGB[] | null, i: number, fallback: RGB): RGB;
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
 * A single-frame annotation overlay applied before poses are drawn.
 *
 * Mirrors Python `_apply_overlay` dispatch (core.py L473-566): a `LabelImage`
 * (or a raw `Int32Array`-backed object) routes to the label-image raster path;
 * a list of `SegmentationMask` / `ROI` / `BoundingBox` routes to the
 * corresponding draw function with per-item palette colors.
 */
type Overlay = LabelImage | RawLabelImage | SegmentationMask | ROI | BoundingBox | SegmentationMask[] | ROI[] | BoundingBox[];
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
    /**
     * Advanced: global track -> index map used to color overlay elements
     * (masks / ROIs / bboxes) by track identity under `colorBy: "track"`, keyed
     * off the project's `Labels.tracks` (stable across frames). Populated by
     * `renderVideo` so a bare per-frame `LabeledFrame` still gets GLOBAL
     * track-identity overlay colors instead of per-frame positional colors
     * (mirrors Python render_video `_track_idx_map`, fixing JS #162 flicker).
     * For a `Labels` source this is derived automatically from `Labels.tracks`.
     */
    overlayTrackIndexMap?: Map<Track, number> | null;
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
    /**
     * Extra HTTP request headers (e.g. `{ Authorization: "Bearer …" }`) forwarded
     * to the streaming worker. When non-empty, the worker downloads the file in a
     * buffer (authenticated) rather than using header-free range streaming.
     */
    headers?: Record<string, string>;
    /** Whether to open video backends for embedded videos (default: false) */
    openVideos?: boolean;
    /**
     * Capture the verbatim, deep-cloned `sessions_json` dict onto each
     * `RecordingSession.rawJson` (deprecated, transitional). Default `false`. See
     * `RecordingSession.rawJson`.
     */
    rawSessions?: boolean;
    /**
     * Defer frame materialization. When `true`, the pose tables are wrapped in a
     * `LazyDataStore`/`LazyFrameList` and individual `LabeledFrame`/`Instance`
     * objects are built only on first access (via `labels.frameAt(i)` /
     * `labels.materialize()`), instead of eagerly building the full object graph.
     * Bounds peak memory for very large prediction files. Default `false`.
     */
    lazy?: boolean;
    /**
     * Defer per-video metadata reads. When `true`, embedded videos are built from
     * `videos_json` ALONE — skipping the per-video HDF5 reads (dataset lookup,
     * `getAttrs`, `frame_numbers`, `frame_sizes`, `source_video`) that dominate
     * open time on many-video `pkg.slp` files read over high-latency storage
     * (hundreds of videos × several serial reads each). Shape/channel_order come
     * from JSON (with the `format_id` default fallback), so the videos panel still
     * shows dimensions; backends are NOT built — the caller opens them on demand
     * (e.g. on first view). Default `false`. Independent of `openVideos`; when
     * set, embedded backends are always deferred. Frames render blank until the
     * caller builds a backend on demand.
     */
    lazyVideoMetadata?: boolean;
    /**
     * Optional progress callback fired as loading advances through its stages.
     * `current` counts completed stages out of `total`; `message` labels the
     * stage about to run. Matches the (current, total, message?) convention used
     * elsewhere in the library (Labels.merge, RenderOptions.onProgress).
     */
    onProgress?: (current: number, total: number, message?: string) => void;
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

export { loadAnalysisH5 as $, urlFromConfirmation as A, BlobByteSource as B, CropVideoBackend as C, checkDownloadHost as D, openGdrive as E, DEFAULT_MAX_BYTES as F, StreamingH5File as G, openStreamingH5 as H, type ImageBytesReader as I, openH5Worker as J, isStreamingSupported as K, type StreamingH5Source as L, readSlpStreaming as M, Mp4BoxVideoBackend as N, type MediaBunnyOptions as O, type PaletteName as P, MediaBunnyVideoBackend as Q, type ReadCocoOptions as R, SeqVideoBackend as S, StreamingHdf5VideoBackend as T, UnsupportedVideoFormatError as U, type VideoOptions as V, type ImageVideoOptions as W, computePrefetchWindow as X, ImageVideoBackend as Y, loadSlp as Z, saveSlp as _, type RenderOptions as a, readCoco as a$, saveAnalysisH5 as a0, saveAnalysisH5ToBytes as a1, loadSlpSet as a2, saveSlpSet as a3, loadVideo as a4, loadLabelImages as a5, setLabelImageFileReader as a6, type PagesAs as a7, type LoadLabelImagesOptions as a8, type LabelImageFileReader as a9, statusToMessage as aA, raiseRemote as aB, identityHeaders as aC, stripCrossOriginHeaders as aD, withRetries as aE, parseRetryAfterMs as aF, fetchRetrying as aG, headOrRangeProbe as aH, type GeoJSONFeature as aI, type GeoJSONFeatureCollection as aJ, roisToGeoJSON as aK, roisFromGeoJSON as aL, writeGeoJSON as aM, readGeoJSON as aN, type CocoCategory as aO, type CocoImage as aP, type CocoRle as aQ, type CocoSegmentation as aR, type CocoAnnotation as aS, type CocoJson as aT, isCocoData as aU, parseCocoJson as aV, createSkeletonFromCategory as aW, decodeKeypoints as aX, decodeCompressedRleCounts as aY, decodeCocoRle as aZ, decodeSegmentation as a_, saveSlpToBytes as aa, openSlpWriter as ab, SlpStreamWriter as ac, saveSlpMergedFromStores as ad, saveSlpMergedToSink as ae, type SlpWriteHeader as af, type AppendStoreOptions as ag, type SlpWriteSink as ah, type MergeStoresOptions as ai, isAnalysisH5File as aj, labelsToCsv as ak, saveLabelsCsv as al, type CsvExportOptions as am, URL_SCHEMES as an, CLOUD_SCHEMES as ao, GDRIVE_HOSTS as ap, SENSITIVE_HEADERS as aq, SENSITIVE_QUERY_PARAMS as ar, RETRYABLE_STATUSES as as, isUrl as at, isGdriveUrl as au, redactUrl as av, redactedCauseSummary as aw, RemoteIOError as ax, type ResolvedUrl as ay, resolveUrl as az, type RGB as b, readCocoSet as b0, toNumpy as b1, fromNumpy as b2, labelsFromNumpy as b3, decodeYamlSkeleton as b4, encodeYamlSkeleton as b5, readSkeletonJson as b6, writeSkeletonJson as b7, readTrainingConfigSkeletons as b8, readTrainingConfigSkeleton as b9, type TrailTarget as bA, type Trail as bB, RenderContext as bC, InstanceContext as bD, drawMasks as bE, drawLabelImage as bF, clampAlpha as bG, pickColor as bH, isTrainingConfig as ba, type RGBA as bb, type ColorSpec as bc, type ColorScheme as bd, type MarkerShape as be, type Overlay as bf, type VideoOverlay as bg, NAMED_COLORS as bh, PALETTES as bi, getPalette as bj, resolveColor as bk, rgbToCSS as bl, determineColorScheme as bm, drawCircle as bn, drawSquare as bo, drawDiamond as bp, drawTriangle as bq, drawCross as br, drawTrails as bs, getMarkerFunction as bt, MARKER_FUNCTIONS as bu, type DrawTrailsOptions as bv, resolveTrailNode as bw, computeTrails as bx, nTrailPaletteColors as by, collectTracks as bz, type RawLabelImage as c, anchorCandidate as d, derivePrefixSwap as e, applyPrefixSwap as f, getImageBytesReader as g, resolveFirstExisting as h, formatPath as i, posixDirname as j, posixBasename as k, posixJoin as l, type PosixPath as m, type PrefixSwap as n, type ResolvedVideoSource as o, parsePath as p, SeqHeader as q, resolveVideoSource as r, setImageBytesReader as s, SeqIndex as t, type ByteSource as u, videoPathCandidates as v, createVideoBackend as w, type VideoBackendType as x, type CropWrapOptions as y, parseGdrive as z };
