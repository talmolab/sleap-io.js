# API Reference

This document covers the public API exported from `src/index.ts`. All examples assume:
```ts
import {
  loadSlp,
  saveSlp,
  saveSlpToBytes,
  loadVideo,
  Video,
  Mp4BoxVideoBackend,
  Labels,
  LabeledFrame,
  Instance,
  PredictedInstance,
  Skeleton,
  Track,
  LabelsSet,
  SuggestionFrame,
  ROI,
  AnnotationType,
  SegmentationMask,
  toDict,
  fromDict,
  toNumpy,
  fromNumpy,
} from "@talmolab/sleap-io.js";
```

## Core I/O

### `loadSlp(source, options)`
Read `.slp` from a path, URL, `File`, `FileSystemFileHandle`, or byte buffer.

```ts
const labels = await loadSlp("/data/session.slp", {
  openVideos: false,
  h5: { stream: "auto", filenameHint: "session.slp" },
});
```

- `source`: string path/URL, `File`, `FileSystemFileHandle`, `Uint8Array`, or `ArrayBuffer`.
- `options.openVideos` (default `true`): set `false` to skip opening video backends.
- `options.h5.stream`: `"auto" | "range" | "download"` (browser URL streaming).
- `options.h5.filenameHint`: helps name temporary files.
- `options.lazy` (default `false`): use lazy loading for on-demand frame materialization.

### `saveSlp(labels, filename, options)`
Write `.slp` (Node/Electron).

```ts
await saveSlp(labels, "/tmp/roundtrip.slp", {
  embed: false,
  restoreOriginalVideos: true,
});
```

- `options.embed`: embed frames (`true`/`"all"`, `"user"`, `"suggestions"`, `"user+suggestions"`, or `"source"` to restore source video paths before writing).
- `options.restoreOriginalVideos` (default `true`): keep original video paths.

### `saveSlpToBytes(labels, options)`
Serialize Labels to SLP format and return the bytes. Works in both Node.js and browser environments.

```ts
const bytes: Uint8Array = await saveSlpToBytes(labels, { embed: false });
```

- `labels`: `Labels` object to serialize.
- `options.embed`: embed frames (`true`, `false`, or dataset name).
- Returns `Promise<Uint8Array>`.

### `loadVideo(filename, options)`
Open a `Video` with an appropriate backend.

```ts
const video = await loadVideo("/data/movie.mp4", { openBackend: true });
const frame0 = await video.getFrame(0);
video.close();
```

- `options.dataset`: dataset path for embedded HDF5 sources.
- `options.openBackend` (default `true`): set `false` for deferred open.

## Video Backends

### `Video`
`Video` wraps a backend and exposes `shape`, `fps`, `getFrame`, `getFrameTimes`, and `close`.

```ts
const video = await loadVideo("/data/movie.mp4");
const timestamps = await video.getFrameTimes(); // number[] | null

// shape and fps have setters
video.shape = [100, 480, 640, 3];
video.fps = 30;
```

- `shape` and `fps` have both getters and setters.
- `getFrame(index, signal?)` accepts an optional `AbortSignal` to cancel in-flight decodes.
- `getFrameTimes()` returns `null` if the backend does not implement it.

### `Mp4BoxVideoBackend`
Browser-only backend for `.mp4` with WebCodecs + mp4box. Supports range requests when the server honors `Range` and falls back to full download.

```ts
// From URL
const backend = new Mp4BoxVideoBackend("/data/movie.mp4");

// From File or Blob (browser)
const backend = new Mp4BoxVideoBackend(file);

const video = new Video({ filename: "/data/movie.mp4", backend });
const t = await video.getFrameTimes();
```

Constructor: `new Mp4BoxVideoBackend(source: string | File | Blob, options?)`

Notes:
- Requires WebCodecs (`VideoDecoder`, `EncodedVideoChunk`).
- Uses a `Range: bytes=0-0` probe to detect range support (no longer requires HEAD).
- Provides precise frame timestamps via `getFrameTimes()`.
- `getFrame()` uses an async queue internally to prevent race conditions, and accepts an optional `AbortSignal`.

### `Hdf5VideoBackend`
Used for `.slp`, `.h5`, or `.hdf5` sources (embedded frames).

- Selected automatically by `loadVideo()` for HDF5 inputs.
- Decodes embedded PNG/JPEG frames in browsers; raw frames require `shape` + `channelOrder`.

### `MediaVideoBackend`
Browser fallback when WebCodecs/mp4box is unavailable.

- Uses `HTMLVideoElement` + canvas.
- No `getFrameTimes()` support.

## Labels & Model Classes

Key types:

- `Labels`, `LabeledFrame`, `Instance`, `PredictedInstance`
- `Skeleton`, `Track`
- `Video`, `SuggestionFrame`, `LabelsSet`
- `Camera`, `CameraGroup`, `RecordingSession` (camera utilities)
- `LazyDataStore`, `LazyFrameList` (lazy loading)
- `ROI`, `SegmentationMask`, `AnnotationType` (spatial annotations)
- `Point` has fields `{ xy, visible, complete, score? }` where `score` is an optional confidence value.
- `LabeledFrame.isNegative` (`boolean`, default `false`): marks negative-annotated frames.
- `SuggestionFrame.group` (`string`, default `"default"`): the suggestion group name.

```ts
const skeleton = new Skeleton(["nose", "tail"]);
const inst = Instance.fromArray([[10, 20], [30, 40]], skeleton);
const video = new Video({ filename: "/data/movie.mp4" });
const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
const labels = new Labels({ labeledFrames: [frame], skeletons: [skeleton], videos: [video] });
```

## Lazy Loading

Load SLP files with on-demand frame materialization for better performance on large datasets.

```ts
// Load lazily - only metadata is parsed initially
const labels = await loadSlp("large_dataset.slp", { lazy: true });
console.log(labels.isLazy);  // true

// Access individual frames on demand
const frame = labels.labeledFrames.at(0);

// Materialize all frames when needed
labels.materialize();
console.log(labels.isLazy);  // false
```

Key classes:

- **`LazyDataStore`**: Holds raw HDF5 column data; supports `materializeFrame(idx)`, `materializeAll()`, and `toNumpy()` fast path.
- **`LazyFrameList`**: Array-like container with `at(idx)`, `length`, `toArray()`, `[Symbol.iterator]()`, and `materializedCount`.

## ROI & Segmentation Masks

Spatial annotations stored alongside pose data in SLP format 1.5.

### `ROI`
Region of interest with GeoJSON-like geometry.

```ts
// Create from bounding box
const roi = ROI.fromBbox(100, 200, 50, 80, {
  category: "arena",
  annotationType: AnnotationType.ARENA,
  video: labels.videos[0],
});

// Create from polygon vertices
const roi = ROI.fromPolygon([[0,0], [100,0], [100,100], [0,100]], {
  category: "region",
});

// Properties
roi.bounds;    // { minX, minY, maxX, maxY }
roi.area;      // polygon area
roi.centroid;  // { x, y }
roi.isBbox;    // true if axis-aligned rectangle

// Convert to mask
const mask = roi.toMask(480, 640);
```

### `SegmentationMask`
RLE-encoded binary mask.

```ts
// Create from 2D boolean array
const mask = SegmentationMask.fromArray(boolArray, 480, 640, {
  category: "segmentation",
});

// Properties
mask.data;  // Uint8Array (decoded)
mask.area;  // pixel count
mask.bbox;  // { x, y, width, height }

// Convert to polygon ROI
const roi = mask.toPolygon();
```

### `Labels` ROI/Mask Access

```ts
// Direct access
labels.rois;       // ROI[]
labels.masks;      // SegmentationMask[]
labels.staticRois; // ROIs without frame index
labels.temporalRois; // ROIs with frame index

// Filtered queries
labels.getRois({ video, frameIdx: 0, category: "arena" });
labels.getMasks({ video, annotationType: AnnotationType.SEGMENTATION });
```

ROIs and masks are read/written in SLP format 1.5 files. The format ID is automatically set to 1.5 when ROIs or masks are present.

## Skeleton Codecs

### JSON (jsonpickle format)
```ts
import { readSkeletonJson, isSkeletonJson } from "@talmolab/sleap-io.js";

const skeleton = readSkeletonJson(jsonString);
```

### Training Config
```ts
import { readTrainingConfigSkeletons, isTrainingConfig } from "@talmolab/sleap-io.js";

const skeletons = readTrainingConfigSkeletons(jsonString);
```

## Codecs & Numpy Helpers

### Dictionary codec
```ts
const dict = toDict(labels);
const restored = fromDict(dict);
```

### Numpy codec
```ts
const array = toNumpy(labels, { returnConfidence: true });
const rebuilt = fromNumpy(array, { video, skeleton, returnConfidence: true });
```

Also available:
- `Labels.numpy({ video, returnConfidence })`
- `Labels.fromNumpy(data, { video, skeleton, trackNames, firstFrame })`

## Streaming Options

SLP streaming is handled by HDF5 open helpers:

```ts
const labels = await loadSlp("https://example.com/session.slp", {
  openVideos: false,
  h5: { stream: "range", filenameHint: "session.slp" },
});
```

- `stream: "auto"` uses range streaming when available.
- `stream: "download"` forces full file download.
- Node only supports string paths or byte buffers for SLP inputs.
- Browser supports URL, `File`, `FileSystemFileHandle`, or byte buffers.

## Error Handling Notes

Common runtime errors to anticipate:

- SLP parsing:
  - Missing `/metadata` group in invalid `.slp`.
  - Unsupported source type in browser or Node.
  - Failed fetch for remote SLP (bad URL/status).
  - `h5wasm` FS unavailable in unsupported environments.

- MP4/WebCodecs:
  - WebCodecs not supported or non-browser environment.
  - No video tracks or unsupported codec.
  - Failed fetch or no video source available.

- Media backend:
  - Browser-only usage.
  - Video load or seek failures.
