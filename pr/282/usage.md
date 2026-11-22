# Usage Guide

This guide covers how to use `sleap-io.js` in both Node.js and browser environments.

## Installation

```bash
npm install @talmolab/sleap-io.js
```

## Node.js Usage

In Node.js, all features work out of the box:

```ts
import { loadSlp, loadVideo } from "@talmolab/sleap-io.js";

// Load from file path
const labels = await loadSlp("path/to/file.slp");

// Access data
console.log(labels.skeletons[0].nodeNames);
console.log(labels.labeledFrames.length);

// Iterate over frames
for (const frame of labels.labeledFrames) {
  console.log(`Frame ${frame.frameIdx}: ${frame.instances.length} instances`);
}
```

### Loading Videos

```ts
import { loadVideo } from "@talmolab/sleap-io.js";

const video = await loadVideo("path/to/video.mp4");
const frame = await video.getFrame(0);  // Returns ImageData or raw bytes
```

#### Norpix `.seq` files

Norpix StreamPix `.seq` files (common in behavioral neuroscience) are supported
natively — no conversion needed. Uncompressed (raw grayscale / BGR) and
compressed (JPEG, PNG) codecs are read; Bayer codecs are not supported. Decoding
JPEG/PNG frames requires an image decoder (a browser, or the optional
`skia-canvas` package on Node).

```ts
import { loadVideo, SeqVideoBackend } from "@talmolab/sleap-io.js";

const video = await loadVideo("recording.seq");
const frame = await video.getFrame(0);        // ImageData (RGBA)
console.log(video.shape);                      // [frames, height, width, channels]
console.log(video.fps);                        // auto-computed from frame timestamps

// Per-frame timestamps (seconds since the Unix epoch):
const seq = video.backend as SeqVideoBackend;
const timestamps = await seq.getTimestamps();
```

In the browser, pass a `File`/`Blob` instead of a path:

```ts
const video = await loadVideo(fileFromInput); // fileFromInput: File ending in .seq
```

### Server-Side Rendering

For server-side skeleton rendering (e.g., generating thumbnails):

```ts
import { renderLabelsImage } from "@talmolab/sleap-io.js";

const labels = await loadSlp("file.slp");
const pngBuffer = await renderLabelsImage(labels, {
  frameIdx: 0,
  width: 640,
  height: 480,
});
// pngBuffer is a Node.js Buffer containing PNG data
```

See [rendering.md](./rendering.md) for more details.

### Saving SLP (Browser)

Use `saveSlpToBytes()` to serialize labels to SLP bytes in the browser:

```ts
import { loadSlp, saveSlpToBytes } from "@talmolab/sleap-io.js";

const labels = await loadSlp(source);
const bytes: Uint8Array = await saveSlpToBytes(labels);

// Download via blob
const blob = new Blob([bytes], { type: "application/octet-stream" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = "labels.slp";
a.click();
```

## Browser Usage

In the browser, `sleap-io.js` automatically uses a **Web Worker** for all HDF5 operations. This keeps the main thread responsive and avoids bundler issues with Node.js dependencies.

### How It Works

When you call `loadSlp()` in the browser:

1. A Web Worker is automatically created with h5wasm loaded from CDN
2. All HDF5 operations (reading datasets, attributes, etc.) run in the worker
3. For URLs, HTTP Range requests stream only the needed data
4. The main thread stays responsive - no blocking!

**No configuration needed** - this happens transparently.

### Required Import Map

Browser usage requires an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to resolve external dependencies:

```html
<script type="importmap">
{
  "imports": {
    "h5wasm": "https://unpkg.com/h5wasm@0.10.2/dist/esm/hdf5_hl.js",
    "yaml": "https://esm.sh/yaml@2.6.1"
  }
}
</script>
```

**Dependencies explained:**

| Module | Purpose | Browser handling |
|--------|---------|------------------|
| `h5wasm` | HDF5 file reading (WebAssembly) | Loaded in Worker from CDN |
| `yaml` | YAML skeleton parsing | Load from CDN |

> **Note:** `skia-canvas` and `child_process` stubs are no longer needed in the import map. These Node.js-only dependencies are now dynamically imported, so browser bundlers can safely tree-shake them.

### Loading SLP Files

```html
<script type="module">
import { loadSlp } from "./dist/index.js";

// From URL - automatically uses Worker + range requests
const labels = await loadSlp("https://example.com/file.slp");

// From file input - automatically uses Worker
const file = document.querySelector('input[type="file"]').files[0];
const labels = await loadSlp(file);

// From ArrayBuffer - automatically uses Worker
const buffer = await file.arrayBuffer();
const labels = await loadSlp(buffer, {
  h5: { filenameHint: file.name }
});

// Force full download (disable range requests)
const labels = await loadSlp("https://example.com/file.slp", {
  h5: { stream: "download" }
});
</script>
```

### External Video Mode

For SLP files with separate video files:

```ts
import { loadSlp, loadVideo } from "./dist/index.js";

// Load SLP without opening embedded videos
const labels = await loadSlp(slpUrl, { openVideos: false });

// Load external video separately
const video = await loadVideo(videoUrl);
const frame = await video.getFrame(frameIndex);
```

### Embedded Images Mode

For SLP files with embedded images (`.pkg.slp` files):

```ts
import { loadSlp } from "./dist/index.js";

// Load SLP with embedded video backends
const labels = await loadSlp(buffer, { openVideos: true });

// Access frames via video backend
for (const frame of labels.labeledFrames) {
  const video = frame.video;
  const imageData = await video.backend.getFrame(frame.frameIdx);
  // imageData is ImageBitmap or ImageData
}
```

### Multi-Video Files

Some SLP files contain multiple videos (e.g., validation datasets). Each `LabeledFrame` references its source video:

```ts
const labels = await loadSlp(buffer, { openVideos: true });

console.log(`${labels.videos.length} videos`);

for (const frame of labels.labeledFrames) {
  const videoIndex = labels.videos.indexOf(frame.video);
  console.log(`Frame from video ${videoIndex}, index ${frame.frameIdx}`);

  // Get embedded image
  const image = await frame.video.backend?.getFrame(frame.frameIdx);
}
```

### Complete Browser Example

```html
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  {
    "imports": {
      "h5wasm": "https://unpkg.com/h5wasm@0.10.2/dist/esm/hdf5_hl.js",
      "yaml": "https://esm.sh/yaml@2.6.1"
    }
  }
  </script>
</head>
<body>
  <input type="file" id="file" accept=".slp" />
  <pre id="output"></pre>

  <script type="module">
    import { loadSlp } from "./dist/index.js";

    document.getElementById("file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      const buffer = await file.arrayBuffer();

      const labels = await loadSlp(buffer, {
        openVideos: true,
        h5: { filenameHint: file.name }
      });

      const output = [
        `Skeletons: ${labels.skeletons.length}`,
        `Videos: ${labels.videos.length}`,
        `Labeled Frames: ${labels.labeledFrames.length}`,
        `Tracks: ${labels.tracks.length}`,
        ``,
        `Skeleton nodes: ${labels.skeletons[0]?.nodeNames.join(", ")}`,
      ];

      document.getElementById("output").textContent = output.join("\\n");
    });
  </script>
</body>
</html>
```

## Lazy Loading

For large SLP files, lazy loading defers frame parsing until individual frames are accessed:

```ts
import { loadSlp } from "@talmolab/sleap-io.js";

// Only metadata is parsed upfront
const labels = await loadSlp("large_dataset.slp", { lazy: true });
console.log(labels.isLazy);           // true
console.log(labels.labeledFrames.length); // frame count available immediately

// Frames are materialized on demand
const frame = labels.labeledFrames.at(0);

// Fast numpy conversion without materializing frames
const array = labels.numpy();

// Fully materialize when needed
labels.materialize();
```

> **Note:** `labels.getFrame()` and `labels.getTrackAnnotations()` **throw** on lazy `Labels`. These O(1) lookups rely on fully materialized frame/track indices and would otherwise silently return stale results. Either call `labels.materialize()` first, or use `labels.find({ video, frameIdx })`, which also materializes internally on the first call and then uses the O(1) index. Both paths do the same amount of work — there is no cheap lazy-preserving variant.
>
> ```ts
> // Option 1: materialize first, then O(1) lookup
> labels.materialize();
> const lf = labels.getFrame(video, 42);
>
> // Option 2: find() — equivalent, materializes on first call
> const [frame] = labels.find({ video, frameIdx: 42 });   // LabeledFrame | undefined
> ```

### Tracking load progress

Pass an `onProgress` callback to `loadSlp` to surface load progress (for example,
to drive a progress bar). It fires `(current, total, message?)` as the loader
advances through its stages: `current` counts completed stages out of `total`,
and `message` labels the stage about to run. The final call is always
`(total, total, "Finalizing")`. This matches the `(current, total, message?)`
convention used elsewhere in the library (`Labels.merge`,
`RenderOptions.onProgress`).

```ts
import { loadSlp } from "@talmolab/sleap-io.js";

const labels = await loadSlp("dataset.slp", {
  onProgress: (current, total, message) => {
    // Update a progress bar: current / total, with a stage label.
    const pct = Math.round((current / total) * 100);
    console.log(`[${pct}%] ${message ?? ""}`);
  },
});
```

All reader paths emit progress — the streaming reader (browser, HTTP range
requests), the eager reader, and the lazy reader (Node, or the no-Worker browser
fallback). The stage lists differ per path (the streaming reader reports finer
stages than the eager/lazy readers), but the `(current, total, message?)`
contract is identical, so a single bar works for any path. When `openVideos` is
enabled, the videos stage additionally reports `"Opening videos (i/n)"` as each
embedded video backend is opened. Reporting is a pure side effect and never
changes the loaded `Labels`.

### Files with broken point spans

Each instance in an SLP file points at its coordinates with a row range in the
`points` (or `pred_points`) table, and row `k` of that range is node `k`. If a
range's length differs from the skeleton's node count, the points can't be put
on the right nodes, so every reader throws `SlpPointSpanError`, as Python
sleap-io does. The error names the first bad instance (its row, frame and
video) and how many instances are affected.

Older sleap-io.js versions wrote two kinds of such files, and
`repairPointSpans: true` opens both:

- **Shifted ranges** (for example 16 and 18 rows for a 17-node skeleton) whose
  point rows are intact. #230 first traced these to a ≤0.5.4 off-by-one; #231
  found its example came from the `instances` table being written as float32.
  The ranges are rebuilt exactly, but only when that's provable: they cover the
  point table with no gaps or overlaps, and the table has exactly one row per
  node.
- **An instance saved with skeleton 0** because its own skeleton wasn't in
  `labels.skeletons`. Its rows are its own, so they're loaded as stored, with a
  warning, the same as before this check; check those instances' nodes.

Anything else still throws. After a rebuild, saving writes a file that reads
cleanly. Instances loaded as stored still have the wrong number of points for
their skeleton, so fix or remove them before saving. The writers now refuse to save an instance whose skeleton isn't in
`labels.skeletons`, as Python sleap-io does; add it there, or add frames with
`labels.append()`, which registers it.

```ts
import { loadSlp, SlpPointSpanError } from "@talmolab/sleap-io.js";

let labels;
try {
  labels = await loadSlp("dataset.slp");
} catch (e) {
  if (!(e instanceof SlpPointSpanError)) throw e;
  console.warn(e.message);
  labels = await loadSlp("dataset.slp", { repairPointSpans: true });
}
```

### Format 3.0 files, and formats this version cannot read

sleap-io.js reads SLP formats 1.x, 2.x and the pose tables of format 3.0, which
Python sleap-io 0.10 introduces. Format 3.0 stores each pose table (`/frames`,
`/instances`, `/points`, `/pred_points`) as a group with one dataset per
column. Every reader handles both layouts and returns the same `Labels`.

sleap-io.js still writes the 2.x layout only, so a format 3.0 file that is
loaded and saved comes out in the 2.x layout. That never happens silently: every
reader (and `loadSlp`) takes a `format3` option, and a 3.0 file loaded without
it throws `SlpFormat3ChoiceError` (a subclass of `SlpFormatError`):

- `format3: "view"` loads everything and marks the labels view-only
  (`labels.sourceFormat.access === "view"`). Every SLP writer (`saveSlp`,
  `saveSlpToBytes`, `saveSlpStructureToBytes`, `saveSlpSet`, `openSlpWriter`,
  `SlpStreamWriter.appendStore` and `appendFrames`, `saveSlpMergedFromStores`,
  `saveSlpMergedToSink` and the in-place save functions) refuses them with
  `SlpViewOnlyError` before it touches its target.
- `format3: "edit"` loads the same, and a save writes the 2.x layout and drops
  what that layout cannot store: points marked as not labelled are written as
  hidden points with no location, and metadata and unknown columns are not
  written.

The choice travels with the content, not only with the `Labels` it was loaded
into. Every labeled frame, instance and annotation read from a 3.0 file carries
it, and copies keep it (`Labels.copy`, `extract`, `merge`, `BoundingBox.pad`,
`toRoi`, `toMask` and the other conversions between boxes, centroids, masks,
ROIs and label images). So content from a view-only file is refused by every
SLP writer wherever it ends up (merged into other labels, passed to
`new Labels({ labeledFrames })`, or appended to a streaming writer), and content
from an edit-loaded file (its instances and annotations) is saved as the caller
chose wherever it ends up. A merge passes only a view-only choice on to records
of your own, and only with what they take: a frame of your own that takes
nothing from a view-only frame (for example with `frame: "keep_original"`)
stays yours. An edit choice is not passed on to your own frames: metadata keys
they take from an edit-loaded frame are warned about at save like your own.

Exports to other formats (Analysis HDF5, CSV, NWB, COCO and the like) are
conversions, not SLP saves, and do not check the choice. Nor do `toDict` /
`fromDict` and the numpy codec: records rebuilt from their output are new and
carry no choice. An application that rebuilds records itself, for example for
undo snapshots, carries it with `copySourceMark(original, rebuilt)`
(`sourceMarkOf(record)` reads it).

`labels.sourceFormat` and the records' choice are frozen. To change the choice
after loading (say, the user decides to edit a file opened view-only), call
`setSourceAccess(labels, "edit")`: it switches `labels.sourceFormat`, if set,
and every record the labels hold that carries a choice, whatever file it came
from. So it also works on a project of your own into which view-only content
was merged. Records held elsewhere keep their choice: copies in other labels
(switch those too), and a lazy frame released from the cache and still held
(materialize it again). A lazy copy shares its annotation records with the
labels it was copied from, so switching either switches those for both.

After saving edit-loaded labels over their source file, that file is in the
2.x layout. Set `labels.sourceFormat = null` to say so; the in-place save
functions then patch it again instead of asking for a full save. The records
keep their marks, so later saves still drop what the 2.x layout cannot store
without a warning.

Every 3.0 file asks, even one that holds nothing the 2.x layout cannot store,
because saving it rewrites it in another layout. The error's `summary` (also
returned as `format3` by the lite `loadSlpMetadata`, so an application can ask
before a full read) says what an edit would drop:

```ts
import { loadSlp, SlpFormat3ChoiceError } from "@talmolab/sleap-io.js";

let labels;
try {
  labels = await loadSlp("dataset.slp");
} catch (e) {
  if (!(e instanceof SlpFormat3ChoiceError)) throw e;
  // e.summary: { formatId, unlabeledPoints, metadataKeys, unknownColumns, lossless }
  const edit = e.summary.lossless || confirm(e.message);
  labels = await loadSlp("dataset.slp", { format3: edit ? "edit" : "view" });
}
```

What format 3.0 adds is read into the model either way: `point.labeled`
(`false` with `visible` false means the source did not annotate the node; absent
means `true`), and `metadata` on instances, labeled frames and bounding boxes.
Labels built in memory can hold them too. Saving records that were not read
from a 3.0 file follows Python's `legacy_format=True`: unlabelled points throw
unless the writer is given `unlabeledAs: "absent"`, and metadata is dropped
with a warning.

A reader learns that a file is in format 3.0, and what it holds, only after it
has read the file's pose tables, so `loadSlp` without `format3` followed by a
second `loadSlp` with it reads them twice. For a large or remote file, call the
lite `loadSlpMetadata` first (it reads only the flags and names it needs), or
pass `format3` from the start.

Every reader (`loadSlp`, `readSlp`, `readSlpLazy`, `readSlpStreaming`, and
`loadSlpMetadata` and `validateSlpBuffer` in the lite build) throws
`SlpFormatError` for a file it cannot read:

- a file of format 4 or higher;
- a file whose `required_features` attribute on `/metadata` names a feature
  this version doesn't know;
- a format 3.0 file that holds a table this version does not read in that
  format yet: ROIs, masks, label images, identity and category links, or
  session data. The message names the tables;
- a format 3.0 file whose tables are inconsistent (a missing required column,
  columns of different lengths, instance or point ranges that do not fit,
  metadata without one row per record). This is `SlpTableError`, a subclass of
  `SlpFormatError`, and the message names the table.

The message names the file and its format and says which tool can read it. The
error also carries `formatId` and `unsupportedFeatures`.

```ts
import { loadSlp, SlpFormatError } from "@talmolab/sleap-io.js";

try {
  const labels = await loadSlp("dataset.slp");
} catch (e) {
  if (!(e instanceof SlpFormatError)) throw e;
  console.error(e.message);
}
```

A format 3.0 file that is refused for its tables can be saved in the 2.x layout
with Python sleap-io 0.10 or newer:

```python
import sleap_io as sio

sio.load_slp("dataset.slp").save("dataset.v2.slp", legacy_format=True)
```

The 2.x layout cannot store everything format 3.0 can. If the file holds points
marked as not labelled, that save raises; pass `unlabeled_as="absent"` as well
to write them as missing points.

## Saving with Embedded Frames

Embed video frames directly into the SLP file:

```ts
import { saveSlp } from "@talmolab/sleap-io.js";

// Embed all frames
await saveSlp(labels, "output.slp", { embed: true });

// Embed only user-labeled frames
await saveSlp(labels, "output.slp", { embed: "user" });

// Embed user + suggestion frames
await saveSlp(labels, "output.slp", { embed: "user+suggestions" });

// Restore source video references (strip embedded data)
await saveSlp(labels, "output.slp", { embed: "source" });

// Embed exactly these frames (any frames, labeled or not)
await saveSlp(labels, "output.slp", {
  embed: [
    [labels.videos[0], 100],
    [labels.videos[0], 250],
  ],
});

// Leave videos with no frames to embed as external references
// (by default they become empty embedded videos, as in Python sleap-io)
await saveSlp(labels, "output.slp", { embed: "user", embedAllVideos: false });

// Report progress, and cancel by returning false (throws ExportCancelled)
await saveSlp(labels, "output.slp", {
  embed: "user",
  onProgress: (current, total, message) => {
    console.log(message, current, total);
    return !userClickedCancel;
  },
});
```

## Multi-File Loading

Load and save multiple SLP files in parallel:

```ts
import { loadSlpSet, saveSlpSet } from "@talmolab/sleap-io.js";

// Load from array of paths
const set = await loadSlpSet(["train.slp", "val.slp", "test.slp"]);

// Load from record (custom keys)
const set = await loadSlpSet({
  train: "/data/train.slp",
  val: "/data/val.slp",
});

// Access individual labels
const trainLabels = set.get("train");

// Save all back
await saveSlpSet(set);
```

## ROI, Segmentation Masks & Bounding Boxes

SLP format 1.5+ supports spatial annotations alongside pose data.

### Working with annotations

Annotations (`Centroid`, `BoundingBox`, `SegmentationMask`, `LabelImage`, and frame-bound `ROI`) live on individual `LabeledFrame` instances — not on `Labels`. The parent frame provides `video` and `frameIdx` context; annotation constructors no longer take those fields.

The primary mutation API is `LabeledFrame.append(annotation)`, which routes by runtime type to the correct per-frame list (`lf.centroids`, `lf.bboxes`, `lf.masks`, `lf.labelImages`, `lf.rois`). It also handles `Instance` and `PredictedInstance`.

```ts
// The mental model: create annotation → attach to frame → frame lives in Labels
const c = new UserCentroid({ x: 100, y: 200 });
let lf = labels.getFrame(video, 5);
if (!lf) {
  lf = new LabeledFrame({ video, frameIdx: 5 });
  labels.append(lf);
}
lf.append(c);
```

Static ROIs (e.g., arena boundaries that apply to an entire video rather than a specific frame) are the one exception — they live on `labels.staticRois` and are added via `labels.addStaticRoi(roi)`.

```ts
import {
  loadSlp, LabeledFrame, ROI, SegmentationMask,
  UserBoundingBox, PredictedBoundingBox, BoundingBox,
  writeGeoJSON, readGeoJSON,
} from "@talmolab/sleap-io.js";

const labels = await loadSlp("dataset.slp");

// Access annotations
console.log(`${labels.rois.length} ROIs, ${labels.masks.length} masks, ${labels.bboxes.length} bboxes, ${labels.centroids.length} centroids`);

// Query by video, frame, and predicted status
const frameRois = labels.getRois({ video: labels.videos[0], frameIdx: 0 });
const predMasks = labels.getMasks({ predicted: true });
const frameBboxes = labels.getBboxes({ video: labels.videos[0], frameIdx: 0 });

// Create a static arena ROI (video-level, not tied to a frame)
const arena = ROI.fromPolygon([[0,0], [100,0], [100,100], [0,100]], {
  category: "arena",
  video: labels.videos[0],
});
labels.addStaticRoi(arena);

// Or create a frame-bound ROI and attach it to a LabeledFrame
const frameRoi = ROI.fromPolygon([[10,10], [50,10], [50,50], [10,50]], {
  category: "crop",
});
let lf = labels.getFrame(labels.videos[0], 0);
if (!lf) {
  lf = new LabeledFrame({ video: labels.videos[0], frameIdx: 0 });
  labels.append(lf);
}
lf.append(frameRoi);

// Create a bounding box and attach it to the same frame
const bbox = new UserBoundingBox({
  x1: 125, y1: 200, x2: 175, y2: 280,
  category: "animal",
});
lf.append(bbox);

// Query centroids
const frameCentroids = labels.getCentroids({ video: labels.videos[0], frameIdx: 0 });

// Export ROIs to GeoJSON
const geojsonStr = writeGeoJSON(labels.rois);
const restoredRois = readGeoJSON(geojsonStr);

// Save — format version is set automatically based on content
await saveSlp(labels, "output.slp");
```

## Label Images (Dense Segmentation)

For dense instance segmentation workflows (Cellpose, StarDist, SAM, Mask R-CNN), use `LabelImage` to store per-pixel object IDs alongside pose data.

### From Segmentation Model Output

```ts
import { LabeledFrame, LabelImage, Track } from "@talmolab/sleap-io.js";

// Create from per-object binary masks (e.g., SAM output)
const trackA = new Track({ name: "cell_1" });
const trackB = new Track({ name: "cell_2" });

const li = LabelImage.fromBinaryMasks(
  [mask1, mask2],  // 2D boolean/number arrays or Uint8Arrays
  {
    height: 480, width: 640,  // required for Uint8Array input
    tracks: [trackA, trackB],
    categories: ["cell", "cell"],
  },
);

// Attach to a frame — video/frameIdx come from the parent LabeledFrame
let lf = labels.getFrame(video, 0);
if (!lf) {
  lf = new LabeledFrame({ video, frameIdx: 0 });
  labels.append(lf);
}
lf.append(li);

// Extract individual masks
const cellMask = li.getTrackMask(trackA);  // Uint8Array
const allCells = li.getCategoryMask("cell");
```

### Batch Processing Video Frames

```ts
import { LabeledFrame, LabelImage, normalizeLabelIds } from "@talmolab/sleap-io.js";

// Create label images for each frame from a stack of 2D arrays
const labelImages = LabelImage.fromStack({
  data: [frame0, frame1, frame2],  // number[][][] (per-frame 2D label arrays)
  createTracks: true,  // auto-create Track objects from label IDs
});

// Normalize IDs so the same track gets the same label ID across all frames
const trackMap = normalizeLabelIds(labelImages);

// Attach each label image to its corresponding frame
labelImages.forEach((li, frameIdx) => {
  let lf = labels.getFrame(video, frameIdx);
  if (!lf) {
    lf = new LabeledFrame({ video, frameIdx });
    labels.append(lf);
  }
  lf.append(li);
});
```

### Spatial Transforms

When predictions are at a different resolution than the source video:

```ts
// Create a downsampled label image
const li = LabelImage.fromArray(data, 120, 160, {
  scale: [0.25, 0.25],   // 4x downsampled
  offset: [0, 0],
});

li.imageExtent;  // { height: 480, width: 640 }

// Resample to full resolution
const fullRes = li.resampled(480, 640);
```

## 3D Pose Data

Multi-camera 3D pose estimation with cross-library interop (Python sleap-io, luc3d).

```ts
import { Identity, Instance3D, PredictedInstance3D } from "@talmolab/sleap-io.js";

// Ground-truth identity (persists across sessions)
const animal = new Identity({ name: "mouse_A", color: "#ff0000" });

// 3D instance from triangulation
const inst3d = new Instance3D({
  points: [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [NaN, NaN, NaN]],
  skeleton,
});
inst3d.nVisible;  // 2
inst3d.isEmpty;   // false

// Predicted 3D instance with per-keypoint confidence
const pred3d = new PredictedInstance3D({
  points: [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
  skeleton,
  score: 0.95,
  pointScores: [0.99, 0.87],
});

// Link to an instance group
group.identity = animal;
group.instance3d = inst3d;

// Identities are stored on Labels
labels.identities.push(animal);
```

## TrackMate CSV Import

Import tracking results from TrackMate (ImageJ/Fiji) CSV exports (Node.js only):

```ts
import { readTrackMateCsv, isTrackMateFile } from "@talmolab/sleap-io.js";

// Check format before loading
if (isTrackMateFile("experiment_spots.csv")) {
  // Auto-detects sibling _edges.csv and .tif video
  const labels = readTrackMateCsv("experiment_spots.csv");

  console.log(`${labels.centroids.length} spots in ${labels.tracks.length} tracks`);

  for (const c of labels.centroids) {
    console.log(`Frame ${c.frameIdx}: (${c.x}, ${c.y}) score=${c.score} track=${c.track?.name}`);
  }
}
```

## Advanced: Low-Level Worker APIs

For fine-grained control over HDF5 file access, you can use the streaming APIs directly:

```ts
import { openH5Worker, isStreamingSupported } from "@talmolab/sleap-io.js";

if (isStreamingSupported()) {
  // Open from any source type
  const h5 = await openH5Worker("https://example.com/data.h5");
  // or: await openH5Worker(file);
  // or: await openH5Worker(arrayBuffer);

  // Access HDF5 structure
  const keys = h5.keys();                    // Root-level keys
  const childKeys = await h5.getKeys("/group");  // Group children

  // Read attributes
  const attr = await h5.getAttr("/", "format_id");
  const allAttrs = await h5.getAttrs("/metadata");

  // Read datasets
  const meta = await h5.getDatasetMeta("/points");  // { shape, dtype }
  const data = await h5.getDatasetValue("/points"); // { value, shape, dtype }

  // Cleanup
  await h5.close();
}
```

## Lite Mode (Workers-Compatible)

For environments that don't support WebAssembly compilation at runtime (e.g., Cloudflare Workers), use the lite entry point:

```ts
import { loadSlpMetadata } from "@talmolab/sleap-io.js/lite";

const metadata = await loadSlpMetadata(buffer);
console.log(metadata.skeletons);
console.log(metadata.counts.labeledFrames);
```

Lite mode uses pure JavaScript (jsfive) instead of WebAssembly (h5wasm), but only provides metadata - not pose coordinates.

See [lite.md](./lite.md) for full documentation.

## Options Reference

### `loadSlp(source, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `openVideos` | `boolean` | `true` | Open video backends for embedded images |
| `h5.stream` | `"auto"` \| `"range"` \| `"download"` | `"auto"` | HDF5 streaming mode |
| `h5.filenameHint` | `string` | `undefined` | Filename hint for embedded video paths |
| `lazy` | `boolean` | `false` | Use lazy loading for on-demand frame materialization |
| `onProgress` | `(current, total, message?) => void` | `undefined` | Progress callback fired per load stage; ends with `(total, total, "Finalizing")`. Emitted by all reader paths (streaming/eager/lazy). See [Tracking load progress](#tracking-load-progress). |

### `loadVideo(source)`

Supports:

- File paths (Node.js)
- URLs (browser, with CORS)
- `ArrayBuffer` (both)

Returns a video backend with:

- `getFrame(index, signal?)` - Get frame as `ImageBitmap`, `ImageData`, or raw bytes. Accepts an optional `AbortSignal` to cancel in-flight decodes.
- `getFrameTimes()` - Get array of frame timestamps
- `fps` - Frames per second (getter and setter)
- `shape` - `[frames, height, width, channels]` (getter and setter)

## Error Handling

```ts
try {
  const labels = await loadSlp(source);
} catch (error) {
  if (error.message.includes("Missing /metadata")) {
    console.error("Invalid SLP file: not a SLEAP labels file");
  } else if (error.message.includes("fetch")) {
    console.error("Network error loading file");
  } else {
    console.error("Unknown error:", error);
  }
}
```

## TypeScript Support

Full TypeScript definitions are included:

```ts
import type { Labels, LabeledFrame, Instance, Skeleton } from "@talmolab/sleap-io.js";

const labels: Labels = await loadSlp(source);
const frame: LabeledFrame = labels.labeledFrames[0];
const instance: Instance = frame.instances[0];
const skeleton: Skeleton = instance.skeleton;
```
