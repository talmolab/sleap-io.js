# API Reference

This document covers the public API exported from `src/index.ts`. All examples assume:
```ts
import {
  loadSlp,
  saveSlp,
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

### `saveSlp(labels, filename, options)`
Write `.slp` (Node/Electron).

```ts
await saveSlp(labels, "/tmp/roundtrip.slp", {
  embed: false,
  restoreOriginalVideos: true,
});
```

- `options.embed`: embed frames (`true`, `false`, or dataset name).
- `options.restoreOriginalVideos` (default `true`): keep original video paths.

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
```

- `getFrameTimes()` returns `null` if the backend does not implement it.

### `Mp4BoxVideoBackend`
Browser-only backend for `.mp4` with WebCodecs + mp4box. Supports range requests when the server honors `Range` and falls back to full download.

```ts
const backend = new Mp4BoxVideoBackend("/data/movie.mp4");
const video = new Video({ filename: "/data/movie.mp4", backend });
const t = await video.getFrameTimes();
```

Notes:
- Requires WebCodecs (`VideoDecoder`, `EncodedVideoChunk`).
- Uses HEAD + `Range: bytes=0-0` probe to detect range support.
- Provides precise frame timestamps via `getFrameTimes()`.

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

```ts
const skeleton = new Skeleton(["nose", "tail"]);
const inst = Instance.fromArray([[10, 20], [30, 40]], skeleton);
const video = new Video({ filename: "/data/movie.mp4" });
const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
const labels = new Labels({ labeledFrames: [frame], skeletons: [skeleton], videos: [video] });
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
