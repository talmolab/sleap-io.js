import { V as VideoBackend, G as GetFrameOptions, b as VideoFrame, c as Video, L as Labels, I as Instance, R as ROI, B as BoundingBox, S as Skeleton, d as LabeledFrame, e as LabelsSet, T as Track, P as PredictedInstance, U as UserROI, C as Centroid, f as LabelImage, g as SegmentationMask } from './dictionary-CTac_neq.js';
export { J as AUTO_VIDEO_MATCHER, aE as AnnotationType, Q as BASENAME_VIDEO_MATCHER, aU as BoundingBoxOptions, aZ as CENTROID_SKELETON, aq as Camera, ar as CameraGroup, a_ as CentroidOptions, r as ConflictResolution, ak as CropOptions, bb as CropRect, D as DUPLICATE_MATCHER, aj as EXISTS_TTL_MS, E as Edge, ay as Embedding, m as ErrorMode, bj as Fill, bc as FlatPoints, F as FrameGroup, bh as FrameLike, l as FrameStrategy, Z as FsResolver, aF as Geometry, z as IDENTITY_INSTANCE_MATCHER, H as IDENTITY_TRACK_MATCHER, W as IMAGE_DEDUP_VIDEO_MATCHER, y as IOU_MATCHER, ax as Identity, az as Instance3D, as as InstanceGroup, i as InstanceMatchMethod, o as InstanceMatcher, b1 as LabelImageObjectInfo, b2 as LabelImageOptions, b6 as LabelsDict, aB as LazyDataStore, aC as LazyFrameList, u as MatchResult, M as MergeError, v as MergeProgressBar, t as MergeResult, _ as MergeStrategy, A as NAME_TRACK_MATCHER, N as Node, ai as NodeOrIndex, O as OVERLAP_SKELETON_MATCHER, K as PATH_VIDEO_MATCHER, a5 as Point, a9 as PointColumns, bd as PointPairs, af as PointView, a7 as PointsArray, aW as PredictedBoundingBox, b0 as PredictedCentroid, aA as PredictedInstance3D, b4 as PredictedLabelImage, a6 as PredictedPoint, a8 as PredictedPointsArray, aK as PredictedROI, aT as PredictedSegmentationMask, aG as ROIOptions, bi as RawFrame, at as RecordingSession, X as SHAPE_VIDEO_MATCHER, w as STRUCTURE_SKELETON_MATCHER, x as SUBSET_SKELETON_MATCHER, aQ as SegmentationMaskOptions, h as SkeletonMatchMethod, n as SkeletonMatcher, s as SkeletonMismatchError, ao as SuggestionFrame, a as Symmetry, j as TrackMatchMethod, p as TrackMatcher, aV as UserBoundingBox, a$ as UserCentroid, b3 as UserLabelImage, aS as UserSegmentationMask, aR as UserSegmentationMaskOptions, an as VideoBackendError, am as VideoBackendErrorKind, k as VideoMatchMethod, q as VideoMatcher, a0 as _annotationCentroidXy, a2 as _findAnnotationLinkMatches, a1 as _findAnnotationMatches, a4 as _registerCentroidFactory, aD as _registerMaskFactory, $ as _relinkFromPredicted, a3 as _resolveMergedIsNegative, ac as clonePoint, av as cloneRecordingSession, be as cropFrame, b9 as cropPoints, aM as decodeRle, aJ as decodeWkb, bf as detectGrayscale, aL as encodeRle, aI as encodeWkb, b8 as fromDict, aY as getCentroidSkeleton, bg as grayscaleFrame, aP as groupRingsIntoPolygons, au as injectSessionFrameResolver, aw as makeCameraFromDict, aX as normalizeCentroidSource, b5 as normalizeLabelIds, aa as pointsEmpty, ad as pointsFromArray, ag as pointsFromDict, ab as predictedPointsEmpty, ae as predictedPointsFromArray, ah as predictedPointsFromDict, aH as rasterizeGeometry, aN as resizeNearest, al as resolveCropRect, ap as rodriguesTransformation, Y as setFsResolver, b7 as toDict, aO as traceMaskContours, ba as uncropPoints } from './dictionary-CTac_neq.js';
import { M as Mp4Sample, S as SerializableDecoderConfig, a as Mp4ParseResult, R as ReadCocoOptions, D as DlcFileSystem, C as Config, b as RenderOptions, V as VideoOptions, c as RGB, d as RawLabelImage, P as PaletteName } from './index.browser-hVbamTV8.js';
export { aU as AppendStoreOptions, au as AviVideoBackend, at as AviVideoOptions, G as BlobByteSource, H as ByteSource, bo as CLOUD_SCHEMES, bS as CocoAnnotation, bO as CocoCategory, bP as CocoImage, bT as CocoJson, bQ as CocoRle, bR as CocoSegmentation, ct as ColorScheme, cs as ColorSpec, N as CreateVideoBackendOptions, O as CropVideoBackend, Q as CropWrapOptions, bm as CsvExportOptions, $ as DEFAULT_MAX_BYTES, bg as DatasetMetaLike, cg as DlcDataframe, cL as DrawTrailsOptions, ae as FeedEntry, bp as GDRIVE_HOSTS, bI as GeoJSONFeature, bJ as GeoJSONFeatureCollection, T as GrayscaleVideoBackend, W as GrayscaleWrapOptions, I as ImageBytesReader, ay as ImageVideoBackend, aw as ImageVideoOptions, bf as InPlaceWritable, cT as InstanceContext, aM as LabelImageFileReader, b8 as LabelTable, b9 as LabelTableRows, ba as LabelTableUpdate, g as LibavDecoderConfig, L as LibavH264Decoder, aL as LoadLabelImagesOptions, cK as MARKER_FUNCTIONS, cu as MarkerShape, ao as MediaBunnyOptions, ap as MediaBunnyVideoBackend, aW as MergeStoresOptions, ad as Mp4BoxVideoBackend, cx as NAMED_COLORS, bb as OnDiskMember, be as OnDiskSidecars, bc as OnDiskTable, bd as OnDiskTables, cv as Overlay, cy as PALETTES, aK as PagesAs, y as PosixPath, z as PrefixSwap, bs as RETRYABLE_STATUSES, cr as RGBA, ab as RangeSink, aa as RangeSource, ce as ReadDlcOptions, cf as ReadDlcProjectOptions, af as ReadRegion, bx as RemoteIOError, cS as RenderContext, by as ResolvedUrl, A as ResolvedVideoSource, bq as SENSITIVE_HEADERS, br as SENSITIVE_QUERY_PARAMS, E as SeqHeader, F as SeqIndex, B as SeqVideoBackend, aY as SerializableEmbedEntry, aZ as SerializableEmbedPlan, aQ as SlpStreamWriter, aT as SlpWriteHeader, aV as SlpWriteSink, a0 as StreamingH5File, a9 as StreamingH5Source, a1 as StreamingH5Writer, av as StreamingHdf5VideoBackend, cR as Trail, cQ as TrailTarget, bn as URL_SCHEMES, U as UnsupportedVideoFormatError, K as VideoBackendType, cw as VideoOverlay, aq as WebDemuxerConfig, k as anchorCandidate, m as applyPrefixSwap, c6 as attachConfigSkeleton, b4 as buildExpectedSidecars, a_ as buildLabelTableRows, a$ as buildLabelTableUpdate, b0 as buildMetadataJson, aX as buildSerializableEmbedPlan, b2 as buildSuggestionsJson, b1 as buildTracksJson, b3 as buildVideoSignatures, Z as checkDownloadHost, b5 as checkInPlaceWritable, cP as collectTracks, ai as computeCacheWindow, ax as computePrefetchWindow, cN as computeTrails, e as configureLibavDecoder, ar as configureWebDemuxer, bW as createSkeletonFromCategory, J as createVideoBackend, bZ as decodeCocoRle, bY as decodeCompressedRleCounts, bX as decodeKeypoints, b_ as decodeSegmentation, ck as decodeYamlSkeleton, l as derivePrefixSwap, cC as determineColorScheme, cD as drawCircle, cH as drawCross, cF as drawDiamond, cV as drawLabelImage, cU as drawMasks, cE as drawSquare, cI as drawTrails, cG as drawTriangle, cl as encodeYamlSkeleton, f as ensureNativeH264Probe, c8 as extractFrameIndex, bG as fetchRetrying, ag as findKeyframeBefore, cb as findProjectCsvs, t as formatPath, ci as fromNumpy, h as getImageBytesReader, cJ as getMarkerFunction, cz as getPalette, bH as headOrRangeProbe, bC as identityHeaders, bh as isAnalysisH5File, bU as isCocoData, c3 as isDlcData, bu as isGdriveUrl, i as isLibavDecoderConfigured, bj as isNwbFile, a5 as isRangeSource, a4 as isStreamingSupported, cq as isTrainingConfig, bt as isUrl, as as isWebDemuxerConfigured, cj as labelsFromNumpy, bk as labelsToCsv, aB as loadAnalysisH5, aI as loadLabelImages, aE as loadNwb, az as loadSlp, aF as loadSlpSet, aH as loadVideo, c5 as looksLikeDlcConfig, cO as nTrailPaletteColors, n as nativeH264DecodableSync, am as nextUncached, b6 as onDiskTableFromMeta, _ as openGdrive, a3 as openH5Worker, aP as openSlpWriter, a2 as openStreamingH5, o as overrideNativeH264Decodable, bV as parseCocoJson, c4 as parseDlcCrop, X as parseGdrive, q as parsePath, bF as parseRetryAfterMs, ah as planDecodeRange, ak as planReadRegions, w as posixBasename, u as posixDirname, x as posixJoin, bB as raiseRemote, b$ as readCoco, c0 as readCocoSet, c1 as readDlc, cd as readDlcDataframe, c2 as readDlcProject, bN as readGeoJSON, bi as readNwb, al as readSamplesByDecodeOrder, cm as readSkeletonJson, ac as readSlpStreaming, cp as readTrainingConfigSkeleton, co as readTrainingConfigSkeletons, bv as redactUrl, bw as redactedCauseSummary, r as registerLibavH264Decoder, cA as resolveColor, c9 as resolveConfig, p as resolveFirstExisting, cc as resolveProjectConfigPath, cM as resolveTrailNode, bz as resolveUrl, j as resolveVideoSource, cB as rgbToCSS, bL as roisFromGeoJSON, bK as roisToGeoJSON, aC as saveAnalysisH5, aD as saveAnalysisH5ToBytes, bl as saveLabelsCsv, aA as saveSlp, aR as saveSlpMergedFromStores, aS as saveSlpMergedToSink, aG as saveSlpSet, aO as saveSlpStructureToBytes, aN as saveSlpToBytes, aj as selectFeedSamples, a6 as serviceRangeBridge, a8 as serviceTruncateBridge, a7 as serviceWriteBridge, s as setImageBytesReader, aJ as setLabelImageFileReader, ca as setSourceVideo, an as shouldDecodeAhead, bA as statusToMessage, bD as stripCrossOriginHeaders, ch as toNumpy, Y as urlFromConfirmation, v as videoPathCandidates, c7 as videoSetsStemMap, bE as withRetries, bM as writeGeoJSON, b7 as writeLabelTablesInPlace, cn as writeSkeletonJson } from './index.browser-hVbamTV8.js';
import 'mediabunny';

/**
 * Off-main mp4 decode worker (scrub-proxy v2 → off-main-thread decode).
 *
 * The main thread parses the mp4 once (mp4box) and sends this worker the sample
 * table + decoder config + a serializable byte-source descriptor. The worker then
 * owns the per-seek heavy work that used to block the UI: reading sample bytes
 * (`readRange`), feeding `VideoDecoder`, and `createImageBitmap`. It streams each
 * decoded frame back to the main thread as a Transferable `ImageBitmap` (zero
 * copy); the main-thread proxy caches + blits. The worker needs NO mp4box — only
 * `VideoDecoder`/`EncodedVideoChunk`/`createImageBitmap` + a byte source, all of
 * which exist in a Worker (verified by the 2026-09-07 spike on macOS + Windows).
 *
 * Packaging follows the io idiom (`h5-worker.ts`): the worker is an inline
 * template-string turned into a Blob URL, so it bundles with the library without
 * separate file hosting and needs no bundler cooperation. The WebCodecs-free
 * helpers below are COPIES of `mp4-decode-core.ts` and MUST be kept in lockstep
 * with it (that module is the tested source of truth; this string can't import).
 *
 * @module
 */

/**
 * A structured-cloneable byte source the worker reconstructs into a `readRange`.
 * Closures can't cross `postMessage`, so desktop (Tauri) must be described by
 * primitives (the app captures the invoke key + IPC url); browser passes the Blob
 * or a ranged URL directly.
 */
type ByteSourceDescriptor = {
    /** Desktop: POST to the Tauri custom-protocol IPC url with the invoke key. */
    kind: "tauri";
    /** `convertFileSrc("plugin:sleap|read_range","ipc")` (mac ipc://, win http://ipc.localhost). */
    url: string;
    /** Includes `Tauri-Invoke-Key` (+ dummy `Tauri-Callback`/`Tauri-Error`, Content-Type). */
    headers: Record<string, string>;
    /** Absolute file path passed to `read_range`. */
    path: string;
    size: number;
} | {
    kind: "blob";
    blob: Blob;
    size: number;
} | {
    kind: "url";
    url: string;
    headers: Record<string, string>;
    size: number;
};
/** main → worker. */
type WorkerInMessage = {
    type: "init";
    samples: Mp4Sample[];
    config: SerializableDecoderConfig;
    byteSource: ByteSourceDescriptor;
} | {
    type: "decode";
    reqId: number;
    start: number;
    end: number;
    target: number;
    cacheStart: number;
    cacheEnd: number;
} | {
    type: "abort";
    reqId: number;
} | {
    type: "close";
};
/** worker → main. */
type WorkerOutMessage = {
    type: "ready";
} | {
    type: "unsupported";
    reason: string;
} | {
    type: "bitmap";
    reqId: number;
    frame: number;
    bitmap: ImageBitmap;
} | {
    type: "decodeDone";
    reqId: number;
    aborted: boolean;
} | {
    type: "decodeError";
    reqId: number;
    message: string;
};
/**
 * The worker source. No `${}` interpolation or nested backticks so the outer
 * template literal passes it through verbatim. Helpers mirror `mp4-decode-core.ts`
 * (KEEP IN LOCKSTEP); the WebCodecs feed loop mirrors
 * `Mp4BoxVideoBackend.decodeRange`.
 */
declare const MP4_DECODE_WORKER_CODE = "\n\"use strict\";\n\nvar SAMPLES = null;\nvar CONFIG = null;\nvar readRange = null;\nvar decoder = null;\n// reqIds the main thread has aborted (checked between decode batches + in output).\nvar abortedReqs = new Set();\n// Serialize decode work: one VideoDecoder at a time, like the on-main decodeQueue.\nvar queue = Promise.resolve();\n\n// --- byte source (reconstructed from the descriptor) ---\nfunction buildReadRange(bs) {\n  if (bs.kind === \"blob\") {\n    return function (offset, length) {\n      return bs.blob.slice(offset, offset + length).arrayBuffer().then(function (b) {\n        return new Uint8Array(b);\n      });\n    };\n  }\n  if (bs.kind === \"tauri\") {\n    return function (offset, length) {\n      return fetch(bs.url, {\n        method: \"POST\",\n        headers: bs.headers,\n        body: JSON.stringify({ path: bs.path, offset: offset, length: length }),\n      }).then(function (resp) {\n        if (resp.headers.get(\"Tauri-Response\") === \"error\") {\n          return resp.text().then(function (t) { throw new Error(\"read_range: \" + t); });\n        }\n        return resp.arrayBuffer().then(function (b) { return new Uint8Array(b); });\n      });\n    };\n  }\n  // ranged URL\n  return function (offset, length) {\n    var headers = Object.assign({}, bs.headers || {});\n    headers.Range = \"bytes=\" + offset + \"-\" + (offset + length - 1);\n    return fetch(bs.url, { headers: headers }).then(function (resp) {\n      return resp.arrayBuffer().then(function (b) { return new Uint8Array(b); });\n    });\n  };\n}\n\n// --- decode-core copies (KEEP IN LOCKSTEP with mp4-decode-core.ts) ---\nfunction selectFeedSamples(samples, start, end) {\n  var minDI = Infinity, maxDI = -Infinity;\n  for (var i = start; i <= end; i += 1) {\n    if (samples[i].decodeIndex < minDI) minDI = samples[i].decodeIndex;\n    if (samples[i].decodeIndex > maxDI) maxDI = samples[i].decodeIndex;\n  }\n  var toFeed = [];\n  for (var k = 0; k < samples.length; k += 1) {\n    var s = samples[k];\n    if (s.decodeIndex >= minDI && s.decodeIndex <= maxDI) {\n      toFeed.push({ presentationIndex: k, sample: s });\n    }\n  }\n  toFeed.sort(function (a, b) { return a.sample.decodeIndex - b.sample.decodeIndex; });\n  return toFeed;\n}\n\nfunction planReadRegions(toFeed) {\n  var regions = [];\n  var i = 0;\n  while (i < toFeed.length) {\n    var first = toFeed[i].sample;\n    var regionEnd = i;\n    var regionBytes = first.size;\n    while (regionEnd < toFeed.length - 1) {\n      var cur = toFeed[regionEnd].sample;\n      var next = toFeed[regionEnd + 1].sample;\n      if (next.offset === cur.offset + cur.size) {\n        regionEnd += 1;\n        regionBytes += next.size;\n      } else {\n        break;\n      }\n    }\n    var members = [];\n    for (var j = i; j <= regionEnd; j += 1) {\n      members.push({ decodeIndex: toFeed[j].sample.decodeIndex, size: toFeed[j].sample.size });\n    }\n    regions.push({ offset: first.offset, length: regionBytes, members: members });\n    i = regionEnd + 1;\n  }\n  return regions;\n}\n\nfunction readSamplesByDecodeOrder(toFeed) {\n  var regions = planReadRegions(toFeed);\n  var results = new Map();\n  var idx = 0;\n  function step() {\n    if (idx >= regions.length) return Promise.resolve(results);\n    var region = regions[idx];\n    idx += 1;\n    return readRange(region.offset, region.length).then(function (buffer) {\n      var view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);\n      var off = 0;\n      for (var m = 0; m < region.members.length; m += 1) {\n        var member = region.members[m];\n        results.set(member.decodeIndex, view.slice(off, off + member.size));\n        off += member.size;\n      }\n      return step();\n    });\n  }\n  return step();\n}\n\n// --- decode one range (mirrors Mp4BoxVideoBackend.decodeRange) ---\nfunction handleDecode(msg) {\n  var reqId = msg.reqId;\n  if (abortedReqs.has(reqId)) {\n    self.postMessage({ type: \"decodeDone\", reqId: reqId, aborted: true });\n    abortedReqs.delete(reqId);\n    return Promise.resolve();\n  }\n  var toFeed = selectFeedSamples(SAMPLES, msg.start, msg.end);\n  return readSamplesByDecodeOrder(toFeed).then(function (dataMap) {\n    if (abortedReqs.has(reqId)) {\n      self.postMessage({ type: \"decodeDone\", reqId: reqId, aborted: true });\n      return;\n    }\n    var timestampMap = new Map();\n    for (var t = 0; t < toFeed.length; t += 1) {\n      timestampMap.set(Math.round(toFeed[t].sample.timestamp), toFeed[t].presentationIndex);\n    }\n\n    if (decoder) { try { decoder.close(); } catch (e) {} }\n\n    var decodedCount = 0;\n    var resolveComplete, rejectComplete;\n    var completion = new Promise(function (res, rej) { resolveComplete = res; rejectComplete = rej; });\n\n    decoder = new VideoDecoder({\n      output: function (frame) {\n        var rounded = Math.round(frame.timestamp);\n        var fi = timestampMap.get(rounded);\n        if (fi === undefined) {\n          var best = Infinity;\n          timestampMap.forEach(function (idx, ts) {\n            var d = Math.abs(ts - frame.timestamp);\n            if (d < best) { best = d; fi = idx; }\n          });\n        }\n        var done = function () {\n          try { frame.close(); } catch (e) {}\n          decodedCount += 1;\n          if (decodedCount >= toFeed.length) resolveComplete();\n        };\n        if (fi !== undefined && fi >= msg.cacheStart && fi <= msg.cacheEnd && !abortedReqs.has(reqId)) {\n          var frameIdx = fi;\n          createImageBitmap(frame).then(function (bmp) {\n            self.postMessage({ type: \"bitmap\", reqId: reqId, frame: frameIdx, bitmap: bmp }, [bmp]);\n            done();\n          }).catch(done);\n        } else {\n          done();\n        }\n      },\n      error: function (e) {\n        if (e && e.name === \"AbortError\") resolveComplete();\n        else rejectComplete(e);\n      },\n    });\n    decoder.configure(CONFIG);\n\n    var BATCH = 15;\n    var i = 0;\n    function feedBatch() {\n      if (i >= toFeed.length) return Promise.resolve();\n      var slice = toFeed.slice(i, i + BATCH);\n      for (var b = 0; b < slice.length; b += 1) {\n        var fe = slice[b];\n        var data = dataMap.get(fe.sample.decodeIndex);\n        if (!data) continue;\n        decoder.decode(new EncodedVideoChunk({\n          type: fe.sample.isKeyframe ? \"key\" : \"delta\",\n          timestamp: fe.sample.timestamp,\n          duration: fe.sample.duration,\n          data: data,\n        }));\n      }\n      i += BATCH;\n      if (i < toFeed.length) {\n        return new Promise(function (r) { setTimeout(r, 0); }).then(function () {\n          if (abortedReqs.has(reqId)) {\n            try { decoder.close(); } catch (e) {}\n            return \"aborted\";\n          }\n          return feedBatch();\n        });\n      }\n      return Promise.resolve();\n    }\n\n    return feedBatch().then(function (result) {\n      if (result === \"aborted\") {\n        self.postMessage({ type: \"decodeDone\", reqId: reqId, aborted: true });\n        return;\n      }\n      return decoder.flush().then(function () {\n        return completion;\n      }).then(function () {\n        self.postMessage({ type: \"decodeDone\", reqId: reqId, aborted: abortedReqs.has(reqId) });\n      });\n    });\n  }).catch(function (e) {\n    self.postMessage({ type: \"decodeError\", reqId: reqId, message: String((e && e.message) || e) });\n  }).then(function () {\n    abortedReqs.delete(reqId);\n  });\n}\n\nfunction handleInit(msg) {\n  SAMPLES = msg.samples;\n  CONFIG = msg.config;\n  if (typeof VideoDecoder === \"undefined\" || typeof EncodedVideoChunk === \"undefined\" || typeof createImageBitmap === \"undefined\") {\n    self.postMessage({ type: \"unsupported\", reason: \"no WebCodecs in worker\" });\n    return;\n  }\n  try {\n    readRange = buildReadRange(msg.byteSource);\n  } catch (e) {\n    self.postMessage({ type: \"unsupported\", reason: \"byte source: \" + String((e && e.message) || e) });\n    return;\n  }\n  var probeLen = Math.min(8, msg.byteSource.size || 8);\n  Promise.resolve()\n    .then(function () { return readRange(0, probeLen); })\n    .then(function () { return VideoDecoder.isConfigSupported(CONFIG); })\n    .then(function (support) {\n      if (!support || !support.supported) {\n        self.postMessage({ type: \"unsupported\", reason: \"codec unsupported in worker\" });\n        return;\n      }\n      self.postMessage({ type: \"ready\" });\n    })\n    .catch(function (e) {\n      self.postMessage({ type: \"unsupported\", reason: String((e && e.message) || e) });\n    });\n}\n\nself.onmessage = function (ev) {\n  var msg = ev.data;\n  if (!msg) return;\n  if (msg.type === \"init\") {\n    handleInit(msg);\n  } else if (msg.type === \"decode\") {\n    queue = queue.then(function () { return handleDecode(msg); });\n  } else if (msg.type === \"abort\") {\n    // Handled OUTSIDE the queue so it preempts a running decode immediately.\n    abortedReqs.add(msg.reqId);\n  } else if (msg.type === \"close\") {\n    try { if (decoder) decoder.close(); } catch (e) {}\n    decoder = null;\n    self.close();\n  }\n};\n";
/** Create the decode worker from the inline blob (io idiom). */
declare function createDecodeWorker(): Worker;

/**
 * Off-main mp4 backend: the main-thread half of the split (scrub-proxy v2 →
 * off-main-thread decode).
 *
 * Implements the SAME {@link VideoBackend} interface as {@link Mp4BoxVideoBackend}
 * so it is a drop-in replacement, but does no decoding itself. The mp4 is parsed
 * once on the main thread (reusing `Mp4BoxVideoBackend.getParseResult`); this proxy
 * then forwards each read to the decode worker (`mp4box-decode-worker.ts`) and
 * receives finished frames back as Transferable `ImageBitmap`s. It owns the LRU
 * cache (so cache hits are instant, main-only) and answers `nearestKeyframe`
 * synchronously from the keyframe table it already holds. See the design doc
 * `docs/plans/2026-09-07-offmain-decode-design.md`.
 *
 * @module
 */

/**
 * Cheap main-thread pre-check: can a Web Worker even be constructed here? The real
 * capability gate is the worker's own self-test (VideoDecoder-in-worker + a
 * readable byte source), which surfaces as {@link WorkerMp4BoxBackend.create}
 * rejecting — the caller then keeps the on-main {@link Mp4BoxVideoBackend}.
 */
declare function isWorkerDecodeAvailable(): boolean;
/** The subset of `Worker` this backend uses — injectable so tests pass a fake. */
interface WorkerLike {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    terminate(): void;
    onmessage: ((ev: {
        data: unknown;
    }) => void) | null;
    onerror?: ((ev: unknown) => void) | null;
}
interface WorkerBackendParams {
    /** Main-thread parse result (from `Mp4BoxVideoBackend.getParseResult()`). */
    parseResult: Mp4ParseResult;
    /** Serializable byte source the WORKER reconstructs into `readRange`. */
    byteSource: ByteSourceDescriptor;
    filename: string;
    cacheSize?: number;
    lookahead?: number;
    /** Injectable worker factory (defaults to the real blob worker). For tests. */
    createWorker?: () => WorkerLike;
}
declare class WorkerMp4BoxBackend implements VideoBackend {
    filename: string;
    shape?: [number, number, number, number];
    fps?: number;
    dataset?: string | null;
    private worker;
    private samples;
    private keyframeIndices;
    private samplesLength;
    private cache;
    private cacheSize;
    private lookahead;
    private reqCounter;
    private pending;
    private aheadReqId;
    private aheadInFlight;
    private closed;
    /** Resolves once the worker reports `ready`; rejects on `unsupported`. */
    readonly ready: Promise<void>;
    private resolveReady;
    private rejectReady;
    constructor(params: WorkerBackendParams);
    /**
     * Build a worker backend and wait for its self-test. Rejects (worker
     * `unsupported`: no WebCodecs-in-worker / unreadable source / codec) so the
     * caller can keep the on-main {@link Mp4BoxVideoBackend} fallback.
     */
    static create(params: WorkerBackendParams): Promise<WorkerMp4BoxBackend>;
    private handleMessage;
    private onBitmap;
    private onDecodeSettled;
    getFrame(frameIndex: number, opts?: GetFrameOptions): Promise<VideoFrame | null>;
    decodeAhead(fromFrame: number, opts?: GetFrameOptions): void;
    nearestKeyframe(frameIndex: number): number;
    getFrameTimes(): Promise<number[] | null>;
    private addToCache;
    close(): void;
}

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

export { BoundingBox, type ByteSourceDescriptor, Centroid, Config, type CreateDataYamlOptions, DlcFileSystem, GetFrameOptions, type ImageShape, Instance, JABS_DEFAULT_EDGE_INDICES, JABS_DEFAULT_KEYPOINT_NAMES, JABS_DEFAULT_SKELETON, JABS_DEFAULT_SYMMETRY_INDICES, LabelImage, LabeledFrame, Labels, LabelsSet, type LineFormat, type LoadDlcOptions, type LoadDlcProjectOptions, type LoadDlcSplitsOptions, type LoadJabsOptions, MP4_DECODE_WORKER_CODE, Mp4ParseResult, Mp4Sample, PaletteName, type ParseLabelFileOptions, type ParsedLabelFile, PredictedInstance, RGB, ROI, RawLabelImage, ReadCocoOptions, type ReadLabelsOptions, type ReadLabelsSetOptions, RenderOptions, SegmentationMask, SerializableDecoderConfig, Skeleton, Track, type TrackMateOptions, UserROI, Video, VideoBackend, VideoFrame, VideoOptions, type WorkerBackendParams, type WorkerInMessage, type WorkerLike, WorkerMp4BoxBackend, type WorkerOutMessage, type WriteLabelsOptions, applyOverlay, buildClassNamesFromBboxes, buildClassNamesFromRois, checkFfmpeg, classNamesFromConfig, createDataYaml, createDecodeWorker, createSkeletonFromConfig, createSplitsFromLabels, denormalizeCoordinates, detectLineFormat, discoverConfig, dlcMergedOrder, drawBboxes, drawCentroids, drawRois, encodePng, isDlcFile, isDlcProjectPath, isTrackMateFile, isWorkerDecodeAvailable, loadCoco, loadCocoSet, loadDlc, loadDlcProject, loadDlcSplits, loadJabs, loadTrackMate, loadUltralytics, makeJabsDefaultSkeleton, makeSimpleSkeleton, nodeDlcFileSystem, normalizeCoordinates, parseDataYaml, parseLabelFile, predictionToInstance, probeImageSize, readCsvScorer, readDlcConfig, readDlcSplit, readLabels, readLabelsSet, readPickle, readTrackMateCsv, renderImage, renderVideo, saveImage, saveUltralytics, staticObjectToRoi, toDataURL, toJPEG, toPNG, warnIfNonlexicographic, writeBboxLabelFile, writeLabelFile, writeLabels, writeRoiLabelFile };
