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
  UserROI,
  PredictedROI,
  SegmentationMask,
  UserSegmentationMask,
  PredictedSegmentationMask,
  BoundingBox,
  UserBoundingBox,
  PredictedBoundingBox,
  Centroid,
  UserCentroid,
  PredictedCentroid,
  getCentroidSkeleton,
  CENTROID_SKELETON,
  LabelImage,
  UserLabelImage,
  PredictedLabelImage,
  normalizeLabelIds,
  readTrackMateCsv,
  loadTrackMate,
  isTrackMateFile,
  Identity,
  Instance3D,
  PredictedInstance3D,
  Camera,
  CameraGroup,
  RecordingSession,
  toDict,
  fromDict,
  toNumpy,
  fromNumpy,
  roisToGeoJSON,
  roisFromGeoJSON,
  writeGeoJSON,
  readGeoJSON,
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

### `loadVideo(source, options)`
Open a `Video` with an appropriate backend.

```ts
// From file path (Node.js) or URL (browser)
const video = await loadVideo("/data/movie.mp4", { openBackend: true });
const frame0 = await video.getFrame(0);
video.close();

// From File object (browser)
const video = await loadVideo(fileInput.files[0]);
```

- `source`: `string` (path or URL) or `File` (browser).
- `options.dataset`: dataset path for embedded HDF5 sources.
- `options.openBackend` (default `true`): set `false` for deferred open.
- `options.backend`: explicit backend type (`"mp4box"`, `"mediabunny"`, `"media"`, `"hdf5"`).

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
- `Camera`, `CameraGroup`, `RecordingSession`, `InstanceGroup` (camera/3D utilities)
- `Identity` (ground-truth animal identity across sessions)
- `Instance3D`, `PredictedInstance3D` (3D keypoint data)
- `LazyDataStore`, `LazyFrameList` (lazy loading)
- `ROI`, `UserROI`, `PredictedROI` (spatial annotations)
- `SegmentationMask`, `UserSegmentationMask`, `PredictedSegmentationMask` (binary masks)
- `BoundingBox`, `UserBoundingBox`, `PredictedBoundingBox` (detection/tracking)
- `Centroid`, `UserCentroid`, `PredictedCentroid` (point detections/tracking)
- `LabelImage`, `UserLabelImage`, `PredictedLabelImage` (dense instance segmentation)
- `Point` has fields `{ xy, visible, complete, score? }` where `score` is an optional confidence value.
- `LabeledFrame.isNegative` (`boolean`, default `false`): marks negative-annotated frames.
- `SuggestionFrame.group` (`string`, default `"default"`): the suggestion group name.

```ts
const skeleton = new Skeleton(["nose", "tail"]);
const inst = Instance.fromArray([[10, 20], [30, 40]], skeleton);
const video = new Video({ filename: "/data/movie.mp4" });
const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
const labels = new Labels({ labeledFrames: [frame], skeletons: [skeleton], videos: [video] });

// Add a video with deduplication
labels.addVideo(video); // no-op if already present
```

### Frame and track index lookups

`Labels` builds lazy `Map` indices for O(1) frame and track lookups, replacing linear scans through `labeledFrames`. The frame-aware `find()` / `getCentroids()` / `getBboxes()` / `getMasks()` / `getLabelImages()` / `getRois()` methods use these indices internally when both `video` and `frameIdx` are passed.

```ts
// O(1) frame lookup
const lf = labels.getFrame(video, 42);  // LabeledFrame | null

// O(1) track annotation lookup, sorted by frameIdx
const annotations = labels.getTrackAnnotations(video, track);

// Force index rebuild after external mutations
labels.reindex();
```

Indices are built lazily on first access and auto-invalidated when frames are added or videos replaced. See the [Lazy Loading](#lazy-loading) section below for the caveat that applies when the `Labels` is lazy.

### Deep copy and video remapping

`Labels.copy()` produces a fully independent copy of a `Labels` object with consistent internal references — frame videos point to the copy's video objects, instance skeletons point to the copy's skeletons, etc. Both eager and lazy `Labels` are supported.

`Labels.replaceVideos()` rewrites video references across every collection in one call: `labeledFrames`, `suggestions`, `sessions`, `staticRois`, `temporalRois`, `masks`, `labelImages`, and `centroids`.

```ts
// Deep copy (eager or lazy — matches the original)
const copy = labels.copy();

// Suppress backend auto-opening on the new copy (faster, safer for bulk ops)
const detached = labels.copy({ openVideos: false });

// Replace video references — specify both old and new
labels.replaceVideos({ oldVideos: [oldVid], newVideos: [newVid] });

// Or infer old from current
labels.replaceVideos({ newVideos: [newVid] });

// Or pass a Map
labels.replaceVideos({ videoMap: new Map([[oldVid, newVid]]) });
```

`LazyDataStore.copy()` duplicates the underlying HDF5 column arrays so that two `Labels` wrapping the same source file can diverge safely.

### Frame merging

Merge annotations from one `LabeledFrame` into another with strategy-aware handling. `LabeledFrame.mergeAnnotations(other, strategy?, threshold?)` supports six strategies, applied across all annotation modalities (centroids, bboxes, masks, label images, ROIs). To populate a single `LabeledFrame` in the first place, see [Adding annotations to frames](#adding-annotations-to-frames) below.

| Strategy | Behavior |
|---|---|
| `"keep_original"` | Keep self only, discard everything from `other` |
| `"keep_new"` | Replace self's annotations with (copies of) `other`'s |
| `"keep_both"` *(default)* | Deduplicate by object identity, union both sets (items from `other` are shallow-copied before insertion) |
| `"replace_predictions"` | Keep user annotations from self; drop self's predicted and take all predicted from `other` |
| `"auto"` | Spatially match by centroid distance; user beats predicted; add unmatched |
| `"update_tracks"` | Spatially match and cascade track assignments only |

The `auto` and `update_tracks` strategies compare centroid distances against `threshold` (default `5.0` px). Empty masks and ROIs whose centroid is `null` are skipped by the matcher.

The strategy argument is typed as `MergeStrategy`, re-exported from the package root for type-safe call sites:

```ts
import type { MergeStrategy } from "@talmolab/sleap-io.js";

const strategy: MergeStrategy = "auto";
lfA.mergeAnnotations(lfB, strategy, 3.0);
```

```ts
// Default behavior (keep_both): dedupe by identity, union everything
lfA.mergeAnnotations(lfB);

// Spatial auto merge with a 3 px threshold
lfA.mergeAnnotations(lfB, "auto", 3.0);

// Keep only predicted updates from other, leave user annotations alone
lfA.mergeAnnotations(lfB, "replace_predictions");
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

- **`LazyDataStore`**: Holds raw HDF5 column data; supports `materializeFrame(idx)`, `materializeAll()`, `copy()`, and `toNumpy()` fast path.
- **`LazyFrameList`**: Array-like container with `at(idx)`, `length`, `toArray()`, `[Symbol.iterator]()`, and `materializedCount`.

> **Note:** `labels.getFrame()` and `labels.getTrackAnnotations()` **throw** on lazy `Labels`. These O(1) lookups rely on fully materialized frame/track indices and would otherwise silently return stale or partial results. You have two options, both of which trigger full materialization under the hood:
>
> 1. Call `labels.materialize()` explicitly, then use the O(1) lookups.
> 2. Call `labels.find({ video, frameIdx })`, which materializes internally on first call and then uses the same O(1) index. It returns `LabeledFrame[]` — take the first element.
>
> Both paths do the same amount of work on the first call; there's no cheap "lazy-preserving" variant of frame lookup by `(video, frameIdx)`.

```ts
// Option 1: materialize first, then O(1) lookup
labels.materialize();
const lf = labels.getFrame(video, 42);

// Option 2: find() — equivalent, materializes on first call
const [frame] = labels.find({ video, frameIdx: 42 });   // LabeledFrame | undefined
```

## ROI & Segmentation Masks

Spatial annotations stored alongside pose data (SLP format 1.5+).

### `ROI`
Region of interest with GeoJSON-like geometry. `ROI` is abstract; use `UserROI` or `PredictedROI` for construction, or use the static factory methods which return `UserROI`.

```ts
// Create from polygon vertices
const roi = ROI.fromPolygon([[0,0], [100,0], [100,100], [0,100]], {
  category: "region",
});

// Create from multi-polygon
const roi = ROI.fromMultiPolygon([
  [[[0,0], [10,0], [10,10], [0,10], [0,0]]],
  [[[20,20], [30,20], [30,30], [20,30], [20,20]]],
]);

// Predicted ROI with confidence score
const pred = new PredictedROI({
  geometry: { type: "Polygon", coordinates: [[[0,0],[10,0],[10,10],[0,10],[0,0]]] },
  score: 0.95,
});

// Properties
roi.bounds;       // { minX, minY, maxX, maxY }
roi.area;         // polygon area
roi.centroidXy;   // [x, y]
roi.isBbox;       // true if axis-aligned rectangle
roi.isPredicted;  // false for UserROI, true for PredictedROI

// Explode multi-geometries into individual ROIs (preserves subclass)
const parts = roi.explode();  // ROI[]

// Convert to GeoJSON Feature
const feature = roi.toGeoJSON();

// Convert to mask
const mask = roi.toMask(480, 640);
```

> **Note:** `ROI.fromBbox()` and `ROI.fromXyxy()` are deprecated. Use `BoundingBox.fromXywh()` or `BoundingBox.fromXyxy()` instead.

### `SegmentationMask`
RLE-encoded binary mask. `SegmentationMask` is abstract; use `UserSegmentationMask` or `PredictedSegmentationMask` for direct construction. The `fromArray()` factory returns `UserSegmentationMask`.

```ts
// Create from 2D boolean array
const mask = SegmentationMask.fromArray(boolArray, 480, 640, {
  category: "segmentation",
});

// Create from array with stride (downsampled prediction)
const mask = SegmentationMask.fromArray(data, 120, 160, {
  stride: 4,  // sets scale to [0.25, 0.25]
});

// Predicted mask with score and optional score map
const pred = new PredictedSegmentationMask({
  rleCounts, height: 480, width: 640,
  score: 0.92,
  scoreMap: new Float32Array(480 * 640),  // optional per-pixel confidence
});

// Properties
mask.data;                // Uint8Array (decoded)
mask.area;                // pixel count
mask.bbox;                // { x, y, width, height }
mask.isPredicted;         // false for User, true for Predicted
mask.scale;               // [number, number] spatial scale (default [1, 1])
mask.offset;              // [number, number] spatial offset (default [0, 0])
mask.hasSpatialTransform; // true if scale != [1,1] or offset != [0,0]
mask.imageExtent;         // { height, width } in image coordinates

// Resample to target size (removes spatial transform)
const fullRes = mask.resampled(480, 640);

// Convert to polygon ROI
const roi = mask.toPolygon();

// Convert to BoundingBox object (with metadata)
const bb = mask.toBbox();
```

### `BoundingBox`
Axis-aligned or rotated bounding box for detection/tracking workflows. `BoundingBox` is abstract; use `UserBoundingBox` or `PredictedBoundingBox` for direct construction.

Bounding boxes use corner coordinates (`x1`, `y1`, `x2`, `y2`) as their primary storage. Center-based properties (`xCenter`, `yCenter`, `width`, `height`) are available as computed getters.

Construct a user-annotated bbox and attach it to a frame:

```ts
const bbox = new UserBoundingBox({
  x1: 0, y1: 20, x2: 100, y2: 100,
  category: "animal",
});

// The parent LabeledFrame provides video + frameIdx context
let lf = labels.getFrame(labels.videos[0], 3);
if (!lf) {
  lf = new LabeledFrame({ video: labels.videos[0], frameIdx: 3 });
  labels.append(lf);
}
lf.append(bbox);
```

Construct a predicted bbox with confidence score:

```ts
const predBbox = new PredictedBoundingBox({
  x1: 0, y1: 20, x2: 100, y2: 100,
  score: 0.95,
});
```

Factory methods (return `UserBoundingBox`):

```ts
const fromCorners = BoundingBox.fromXyxy(10, 20, 110, 100);  // corner coords
const fromTopLeft = BoundingBox.fromXywh(10, 20, 100, 80);   // top-left + size
```

Properties and conversions:

```ts
// Stored properties
bbox.x1; bbox.y1; bbox.x2; bbox.y2;  // corner coordinates
bbox.angle;      // rotation in radians (default 0)

// Computed properties
bbox.xCenter;    // (x1 + x2) / 2
bbox.yCenter;    // (y1 + y2) / 2
bbox.width;      // abs(x2 - x1)
bbox.height;     // abs(y2 - y1)
bbox.xyxy;       // [x1, y1, x2, y2] (axis-aligned bounding box)
bbox.xywh;       // { x, y, width, height }
bbox.corners;    // number[][] (4 corner points, respects rotation)
bbox.bounds;     // { minX, minY, maxX, maxY }
bbox.area;       // width * height
bbox.centroidXy; // [x, y]
bbox.isPredicted; // true for PredictedBoundingBox
bbox.isRotated;  // true if angle != 0

// Conversion
const roi = bbox.toRoi();              // Polygon ROI
const mask = bbox.toMask(480, 640);    // SegmentationMask
```

### `Centroid`
Point representing the center of an object. `Centroid` is abstract; use `UserCentroid` or `PredictedCentroid`.

```ts
// Create user centroid (attach to a frame to provide video + frameIdx context)
const c = new UserCentroid({ x: 100, y: 200, track });
let lf = labels.getFrame(video, 0);
if (!lf) {
  lf = new LabeledFrame({ video, frameIdx: 0 });
  labels.append(lf);
}
lf.append(c);

// Create predicted centroid with confidence
const pc = new PredictedCentroid({
  x: 50, y: 60, z: 3.5,
  score: 0.95,
  trackingScore: 0.8,
  track,
  name: "spot1", source: "trackmate",
});
let lf1 = labels.getFrame(video, 1);
if (!lf1) {
  lf1 = new LabeledFrame({ video, frameIdx: 1 });
  labels.append(lf1);
}
lf1.append(pc);

// Properties
c.xy;           // [x, y]
c.yx;           // [y, x] (row, col)
c.xyz;          // [x, y, z | null]
c.isPredicted;  // false for User, true for Predicted

// Convert to single-node Instance
const inst = pc.toInstance();  // PredictedInstance with centroid skeleton

// Create from Instance (center of mass, bbox center, or anchor node)
const centroid = Centroid.fromInstance(instance);
const centroid = Centroid.fromInstance(instance, { method: "bboxCenter" });
const centroid = Centroid.fromInstance(instance, { method: "anchor", node: "head" });

// Instance convenience method (requires centroid.ts import)
const centroid = instance.toCentroid();
const centroid = instance.toCentroid("anchor", "head");

// Instance centroid shortcut (no Centroid object, just coordinates)
instance.centroidXy;  // [x, y] | null (mean of visible points)
```

#### Centroid Skeleton
```ts
// Shared single-node skeleton for centroid conversions
const skel = getCentroidSkeleton();  // Skeleton(["centroid"])
CENTROID_SKELETON === getCentroidSkeleton();  // true (singleton)
```

### `Labels` Annotation Access

Annotations (`Centroid`, `BoundingBox`, `SegmentationMask`, `LabelImage`, frame-bound `ROI`) live on individual `LabeledFrame` instances, not on `Labels`. The `Labels` getters return flattened read-only views across all frames; mutation always goes through the owning frame.

```ts
// Read-only property getters (flat views across all frames)
labels.rois;           // ROI[]
labels.masks;          // SegmentationMask[]
labels.bboxes;         // BoundingBox[]
labels.centroids;      // Centroid[]
labels.labelImages;    // LabelImage[]
labels.identities;     // Identity[]
labels.staticRois;     // Static (video-level) ROIs, e.g. arena boundaries
labels.temporalRois;   // Frame-bound ROIs (flat view across frames)

// Filtered queries (all support `predicted` filter; frame-aware filters use O(1) indices)
labels.getRois({ video, frameIdx: 0, category: "arena", predicted: false });
labels.getMasks({ video, category: "segmentation", predicted: true });
labels.getBboxes({ video, frameIdx: 0, predicted: true });
labels.getCentroids({ video, frameIdx: 0, track, predicted: true });
labels.getLabelImages({ video, frameIdx: 0, track, category: "cell" });

// Note: getRois({ video }) returns only frame-bound ROIs for that video.
// For static ROIs, use labels.staticRois directly.

// Add a video (deduplicates automatically)
labels.addVideo(video);
```

#### Adding annotations to frames

Use `LabeledFrame.append(annotation)` to add any annotation type. It routes by runtime type to the appropriate per-frame list (`lf.centroids`, `.bboxes`, `.masks`, `.labelImages`, `.rois`) and handles `Instance` and `PredictedInstance` as well. If you know the target list at the call site, you can also push directly.

> **Note:** `Labels` and `LabeledFrame` each have an `append()` method. `labels.append(lf)` adds a `LabeledFrame` to a `Labels` (and also registers its video and tracks). `lf.append(annotation)` adds an annotation to a single `LabeledFrame`. They're different operations at different levels of the hierarchy.

```ts
import {
  Labels,
  LabeledFrame,
  UserCentroid,
  UserBoundingBox,
  UserSegmentationMask,
} from "@talmolab/sleap-io.js";

// Build a frame with mixed annotations
const lf = new LabeledFrame({ video, frameIdx: 5 });
lf.append(new UserCentroid({ x: 100, y: 200, track }));
lf.append(new UserBoundingBox({ x1: 50, y1: 50, x2: 150, y2: 150 }));
lf.append(UserSegmentationMask.fromArray(maskData, 480, 640));

// Or push directly if you know the type
lf.centroids.push(new UserCentroid({ x: 10, y: 20 }));

// Pass frames as labeledFrames when constructing Labels
const labels = new Labels({ labeledFrames: [lf], videos: [video], skeletons: [skeleton] });

// To mutate an existing Labels, look up the target frame first
let existing = labels.getFrame(video, 5);
if (!existing) {
  existing = new LabeledFrame({ video, frameIdx: 5 });
  labels.append(existing);
}
existing.append(anotherBbox);
```

Static ROIs (video-level, e.g. arena boundaries) live on `labels.staticRois`. Use `labels.addStaticRoi(roi)` to add one — the method also registers the ROI's track on `labels.tracks` if present:

```ts
labels.addStaticRoi(arenaRoi);
```

The SLP format version is set automatically based on content:

| Version | Trigger |
|---------|---------|
| 1.5 | ROIs or masks present |
| 1.6 | ROIs with instance associations |
| 1.7 | Bounding boxes |
| 1.8 | Label images |
| 1.9 | Identities or predicted annotations |
| 2.0 | BBox corner-based format |
| 2.1 | Spatial metadata (scale/offset) |
| 2.2 | Chunked label image storage |

## Label Images (Dense Segmentation)

Dense integer label images for instance segmentation workflows (Cellpose, StarDist, SAM, Mask R-CNN output). Each pixel stores an object ID (0 = background, positive integers = objects) with per-object metadata (track, category, name).

`LabelImage` is abstract; use `UserLabelImage` or `PredictedLabelImage`, or use the static factory methods which return `UserLabelImage`.

### Creating Label Images

```ts
// From a 2D integer array
const li = LabelImage.fromArray(
  new Int32Array([0, 0, 1, 1, 0, 2, 2, 0, 0]),
  3, 3,  // height, width
  { tracks: [trackA, trackB] },
);

// From segmentation masks (composites multiple binary masks)
const li2 = LabelImage.fromMasks(masks);

// From per-object binary masks (SAM / Mask R-CNN output)
const li3 = LabelImage.fromBinaryMasks(
  [mask1_2d, mask2_2d, mask3_2d],
  {
    tracks: [trackA, trackB, trackC],
    categories: ["cell", "cell", "debris"],
    scores: [0.95, 0.88, 0.72],  // creates PredictedLabelImage if provided
  },
);

// Batch creation from a stack of 2D arrays (one per frame)
const labelImages = LabelImage.fromStack({
  data: [frame0_2d, frame1_2d, frame2_2d],
  tracks: new Map([[1, trackA], [2, trackB]]),
  createTracks: true,  // auto-create Track objects from label IDs
});

// Attach each label image to its frame
labelImages.forEach((li, i) => {
  let lf = labels.getFrame(video, i);
  if (!lf) {
    lf = new LabeledFrame({ video, frameIdx: i });
    labels.append(lf);
  }
  lf.append(li);
});
```

Frame and video context for label images comes from the parent `LabeledFrame`. Factory methods return plain `UserLabelImage` objects; use `lf.append(li)` to attach them to a frame.

### Properties and Methods

```ts
// Data access
li.data;       // Int32Array (flat, row-major)
li.height;     // number
li.width;      // number
li.objects;    // Map<number, LabelImageObjectInfo>
li.nObjects;   // number of objects
li.labelIds;   // sorted unique non-zero label IDs in data
li.tracks;     // Track[] from object metadata
li.categories; // Set<string> from object metadata

// Spatial transforms (for downsampled predictions)
li.scale;               // [number, number] (default [1, 1])
li.offset;              // [number, number] (default [0, 0])
li.hasSpatialTransform; // boolean
li.imageExtent;         // { height, width } in image coordinates

// Mask extraction
const mask = li.getObjectMask(1);         // Uint8Array for label ID 1
const mask = li.getTrackMask(trackA);     // Uint8Array for all objects with trackA
const mask = li.getCategoryMask("cell");  // Uint8Array for all "cell" objects

// Iteration over objects
for (const [track, category, binaryMask] of li.items()) {
  console.log(track?.name, category, binaryMask.length);
}

// Conversion
const masks = li.toMasks();                       // SegmentationMask[]
const bboxes = li.toBboxes();                     // BoundingBox[]
const fullRes = li.resampled(480, 640);           // new LabelImage at full resolution

// Predicted label image
li.isPredicted;  // false for UserLabelImage, true for PredictedLabelImage
// PredictedLabelImage also has: score, scoreMap, scoreMapScale, scoreMapOffset
```

### `LabelImageObjectInfo`

Per-object metadata stored in `LabelImage.objects`:

```ts
interface LabelImageObjectInfo {
  track: Track | null;
  category: string;
  name: string;
  instance: Instance | null;
  score?: number | null;           // per-object confidence (PredictedLabelImage)
  trackingScore?: number | null;   // per-link tracking cost
}
```

### `normalizeLabelIds()`

Normalize label IDs across multiple frames so each Track or category gets a globally consistent ID. Mutates label images in place.

```ts
// Normalize by track (default) — each Track gets a unique, consistent ID
const trackMap: Map<Track, number> = normalizeLabelIds(labelImages);

// Normalize by category — same category string gets the same ID
const catMap: Map<string, number> = normalizeLabelIds(labelImages, { by: "category" });
```

## Identity & 3D Data Structures

### `Identity`

Ground-truth animal identity that persists across videos, sessions, and experiments. Unlike `Track` (which represents a temporal trajectory within a single video), `Identity` represents the actual animal.

```ts
const id = new Identity({ name: "mouse_A", color: "#ff0000" });

id.name;      // "mouse_A"
id.color;     // "#ff0000"
id.metadata;  // Record<string, unknown>
```

### `Instance3D` and `PredictedInstance3D`

3D keypoint data from multi-camera triangulation.

```ts
// User-annotated 3D instance
const inst3d = new Instance3D({
  points: [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
  skeleton,
  score: 0.95,
});

inst3d.nVisible;  // number of non-NaN keypoints
inst3d.isEmpty;   // true if all keypoints are NaN/null

// Predicted 3D instance (with per-keypoint scores)
const pred3d = new PredictedInstance3D({
  points: [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
  skeleton,
  score: 0.95,
  pointScores: [0.99, 0.87],
});
```

### 3D Fields on Existing Types

```ts
// Labels.identities — all ground-truth identities
labels.identities;  // Identity[]

// Camera.size — image dimensions
camera.size;  // [width, height] | undefined

// InstanceGroup — links identity and 3D data to multi-camera groups
group.identity;    // Identity | undefined
group.instance3d;  // Instance3D | undefined
group.points;      // delegates to instance3d.points if available
```

## GeoJSON I/O

Convert ROIs to/from GeoJSON format.

```ts
// Convert ROIs to GeoJSON FeatureCollection
const geojson = roisToGeoJSON(labels.rois);

// Serialize to JSON string
const json = writeGeoJSON(labels.rois);

// Parse GeoJSON back to ROIs
const rois = roisFromGeoJSON(geojson);
const rois = readGeoJSON(jsonString);
```

## TrackMate CSV I/O

Import TrackMate (ImageJ/Fiji) CSV tracking exports as `PredictedCentroid` objects. Node.js only.

```ts
import { readTrackMateCsv, loadTrackMate, isTrackMateFile } from "@talmolab/sleap-io.js";

// Check if a file is a TrackMate spots CSV
isTrackMateFile("data_spots.csv");  // true/false

// Load spots CSV (auto-detects sibling _edges.csv and .tif video)
const labels = readTrackMateCsv("data_spots.csv");
labels.centroids;  // PredictedCentroid[]
labels.tracks;     // Track[] (from TRACK_ID column)

// With explicit options
const labels = readTrackMateCsv("data_spots.csv", {
  edgesPath: "data_edges.csv",  // optional, auto-detected from _spots suffix
  video: "data.tif",            // optional, auto-detected from _spots suffix
});

// Public API alias
const labels = loadTrackMate("data_spots.csv");
```

TrackMate CSV format:
- `*_spots.csv` — spot detections with `POSITION_X`, `POSITION_Y`, `POSITION_Z`, `FRAME`, `QUALITY`, `TRACK_ID`
- `*_edges.csv` — frame-to-frame linkages; `LINK_COST` is stored as `trackingScore` on target centroids

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
