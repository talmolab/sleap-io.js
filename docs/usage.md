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

sleap-io.js reads SLP formats 1.x, 2.x and 3.0, which Python sleap-io 0.10
introduces, and writes both the 2.x layout and format 3.0. Format 3.0 stores
every table as a group with one dataset per column: the pose tables (`/frames`, `/instances`, `/points`, `/pred_points`),
`/rois`, `/masks` (with `score_maps/`), `/label_images` (with `objects/` and
`score_maps/`), the identity and category links (`/identity/links`,
`/categories/links`) and the recording session tables
(`/session_data/frame_groups`, `instance_groups`, `instance_group_members`).
Every reader handles both layouts and returns the same `Labels`. A 3.0 table
missing an optional column reads it as Python sleap-io does (for example, an
ROI without `is_predicted` is a user ROI), and the range checks Python runs
over these tables (links to videos, tracks, instances, catalogs and frames,
byte ranges inside their buffers) raise `SlpTableError`. The streaming reader
reads, of these tables, the links of instances and the session tables (it
reads no ROIs, masks or label images in any layout), and the summary it gives
for a 3.0 file lists the rest in `unreadTables` (below), as something an edit
drops. `loadSlp` in a browser uses the streaming reader, except that in its
default stream mode (`"auto"`) a 3.0 file holding ROIs, masks, label images,
or links or embeddings of detections other than instances is read with the
standard reader on the main thread, so nothing is lost. That read takes the
whole file into memory (a URL is downloaded whole, a `File` read whole) and
blocks the page while it runs; pass `h5: { stream: "range" }` to keep
streaming, and the summary then lists what is not read. Files before 3.0 take
the streaming route as before, which skips that content in them without a
word. The lite `loadSlpMetadata` reads the session tables, and its
`streamingUnreadTables` lists what a streaming read would leave out, for files
of any format (the link tables of Python-written 2.x files are listed whenever
present, as the lite reader cannot read their owner types); its `format3`
summary describes `readSlp`, `readSlpLazy` and `loadSlp`. The range checks run in the
readers that read a table, so the streaming and lite readers do not check the
tables they leave out. The streaming reader's `userInstancesOnly`, which skips
predicted instances and sessions, opens a 3.0 file only with
`format3: "view"`.

A recording session's metadata is stored at the top level of its
`sessions_json` entry, beside `calibration`, `camcorder_to_video_idx_map`,
`fg_start` and `fg_end`, as Python sleap-io stores it. A metadata key with one
of those names is not saved, and the readers read the entries of a `metadata`
key that holds an object as metadata (files from earlier sleap-io.js versions
stored it there), so avoid those keys.

What format 3.0 adds is read into the model: `point.labeled` (`false` with
`visible` false means the source did not annotate the node; absent means
`true`), and `metadata` on instances, labeled frames and bounding boxes.
Labels built in memory can hold them too.

#### Which layout a save writes

SLEAP and sleap-io < 0.10 cannot open format 3.0 files, so a save writes the
2.x layout unless something needs format 3.0. The `slpVersion` option of every
SLP writer chooses the layout: `saveSlp`, `saveSlpToBytes`,
`saveSlpStructureToBytes`, `writeSlp`, `saveSlpSet`, `openSlpWriter` (and the
writer's `appendStore` and `appendFrames`), `saveSlpMergedFromStores`,
`saveSlpMergedToSink` and the in-place save (`buildLabelTableUpdate`).

| `slpVersion` | Layout written |
| --- | --- |
| `"auto"` (default) | The 2.x layout, unless the rule below calls for format 3.0 |
| `"v2"` | Always the 2.x layout |
| `"v3"` | Always format 3.0 |

Any other value throws a `TypeError` before anything is written. With
`"auto"`, a save writes format 3.0 when:

1. the labels were last saved in format 3.0 (labels remember the layout they
   were saved in, so the next default save keeps it);
2. otherwise, for labels loaded from a 3.0 file with `format3: "edit"` (below),
   never: that choice saves the 2.x layout;
3. the format 3.0 defaults are on: `setV3Defaults(true)` for the process, or,
   in Node, the environment variable `SLEAP_IO_V3_DEFAULTS=1` (also `true`,
   `yes` or `on`). Explicit options win; `setV3Defaults(null)` defers to the
   environment again;
4. the labels, or any of their records, were loaded from a 3.0 file without
   `format3: "edit"`, so a file never changes layout silently. Copies,
   extracts, materialized lazy labels and records moved into other labels keep
   this. Labels since saved in the 2.x layout no longer count as loaded from
   3.0;
5. the labels hold something only format 3.0 can store: points marked as not
   labelled, metadata on instances, frames or bounding boxes, or unknown
   columns kept from a newer file. The save then warns once
   (`console.warn`), naming the content and the option.

Otherwise it writes the 2.x layout, exactly as earlier versions did. Hidden
points that keep their coordinates need no format 3.0: the 2.x layout has
always stored them.

A save remembers the layout it wrote, whatever its target: after
`saveSlp(labels, "share.slp", { slpVersion: "v2" })`, the next default save of
the same labels, to any file, writes the 2.x layout unless the labels hold
what only format 3.0 can store. Pass `slpVersion` again to choose.

```ts
import { saveSlp, resolveSlpVersion, setV3Defaults } from "@talmolab/sleap-io.js";

await saveSlp(labels, "labels.slp");                       // 2.x unless needed
await saveSlp(labels, "labels.slp", { slpVersion: "v3" }); // always format 3.0
await saveSlp(labels, "labels.slp", { slpVersion: "v2" }); // always the 2.x layout
resolveSlpVersion(labels, "auto", { warn: false }); // what "auto" would write
setV3Defaults(true);       // "auto" writes format 3.0 for the whole process
```

The streaming writer (`SlpStreamWriter.appendStore` and `appendFrames`,
`saveSlpMergedFromStores`, `saveSlpMergedToSink`) writes only the identities
and sessions given in its header. In the 2.x layout it also writes no
per-detection identity or category links or embeddings (the category of a
centroid, box, mask or ROI is kept, in its own column, but not its score), so
it refuses stores and frames loaded from a 3.0 file that hold any of those,
before writing them, and names what would be lost. In format 3.0 it writes the
links and embeddings, so only identities and sessions missing from the header
are refused there. Save such labels with `saveSlp` or `saveSlpToBytes`, which
keep everything.

Files written together share one layout: `saveSlpSet` and
`saveSlpMergedFromStores` decide once for all of them (format 3.0 if any needs
it, with one warning), before writing any. `resolveSlpVersion(labelsList)`
makes the same decision for code that writes several files itself.

**The 2.x layout, written strictly.** `slpVersion: "v2"` follows Python's
`legacy_format=True`: points marked as not labelled throw before anything is
written unless `unlabeledAs: "absent"` saves them as hidden points with no
location (with a warning), and metadata and unknown columns are dropped with a
warning. Records loaded with `format3: "edit"` drop all of this without a word,
since the caller chose. Like Python's `legacy_format=True`, the 2.x layout
stores some numbers in narrower types than 3.0: scores, tracking scores,
scales and offsets of ROIs, masks, label images and score maps as 32-bit
floats, and their video, track and instance indices as 32-bit integers.

**Format 3.0, as Python sleap-io 0.10 writes it.** Every table is a group of
1-D columns and no dataset is compound: the pose tables without id columns,
`/frames/video` as the index into the videos list, `/frames/is_negative` in
place of `/negative_frames`, points with `verified` (the 2.x `complete`) and
`labeled` written as `labeled | visible`, and unlabelled points without
coordinates. Record metadata goes to `<table>/metadata/<key>/{values,present}`
(`/instances`, `/frames`, `/bboxes`), one kind per key (bool, int, float or
string; a key that mixes kinds throws a `TypeError` before anything is
written), with a placeholder and `present` for records lacking the key. h5wasm
cannot write HDF5 booleans, so flags are written as `uint8`, which Python
reads as it reads booleans; a boolean metadata key is written as `uint8` with
the attribute `kind = "bool"`, which sleap-io.js reads back as booleans and
Python sleap-io reads as the integers 0 and 1. A format 3.0 save that writes
boolean metadata says so once (`console.warn`), naming the keys. Lazy labels are written from
their raw tables without materializing.

**Unknown columns.** Columns a newer writer added to a 3.0 table (the pose
tables, the ROI, mask, label image, score map, link and session tables) are
kept when the file is read and written back by a format 3.0 save while the
table's rows still line up with the records that own them: lazy labels always
keep their pose tables' columns; otherwise the records must be the ones loaded,
in the same order (editing values is fine; adding, removing or reordering
records is not), and link rows are matched by their owner and catalog index.
When they no longer line up, or with the 2.x layout, the columns are dropped
with a warning. Unknown columns of `/bboxes`, and columns that are not 1-D,
are not kept.

**Points are written as stored.** sleap-io.js reads the points of a file
before 3.0 as they are stored, and writes them so in either layout: a hidden
point keeps its coordinates (the SLEAP GUI leaves the last position on a node
it hides, and format 3.0 reads that as an occluded estimate), and a visible
point without coordinates stays visible. This matches what Python sleap-io
0.10 does by default when it loads an older file (it changes no point); its
`load_slp(..., clean_legacy_points=True)` (and
`Labels.clean_legacy_points()`) clears the coordinates of hidden points and
hides visible points without coordinates, which sleap-io.js does not do.

#### Opening a format 3.0 file

Every reader (and `loadSlp`) takes a `format3` option that says what a later
save may do with a 3.0 file:

- `format3: "keep"`, or unset: load it editable; `labels.sourceFormat.access`
  is `"keep"`, and saves keep format 3.0 (rule 4 above). Unset, a file
  holding what the reader does not read (the summary's `unreadTables`, below;
  for the streaming reader also ROIs, masks and label images) throws as
  `"ask"` does instead, since any save would drop that content; pass
  `"keep"` (or `"edit"`) to accept it;
- `format3: "view"` loads everything and marks the labels view-only
  (`labels.sourceFormat.access === "view"`). Every SLP writer (`saveSlp`,
  `saveSlpToBytes`, `saveSlpStructureToBytes`, `saveSlpSet`, `openSlpWriter`,
  `SlpStreamWriter.appendStore` and `appendFrames`, `saveSlpMergedFromStores`,
  `saveSlpMergedToSink` and the in-place save functions) refuses them with
  `SlpViewOnlyError` before it touches its target, whatever the layout;
- `format3: "edit"` loads the same, and a save writes the 2.x layout and drops
  what that layout cannot store: points marked as not labelled are written as
  hidden points with no location, and metadata and unknown columns (of any
  table) are not written. ROIs, masks, label images, links and session tables
  are written in their 2.x form. `slpVersion: "v3"` still saves such labels in
  format 3.0, with everything;
- `format3: "ask"` throws `SlpFormat3ChoiceError` (a subclass of
  `SlpFormatError`), for applications that ask the user first. Its `summary`
  (also returned as `format3` by the lite `loadSlpMetadata`, so an application
  can ask before a full read) says what an edit would drop. Besides unlabelled
  points, metadata and unknown columns, that is anything in the file this
  version does not read at all, in `unreadTables`: for example the
  frame-spanning events (`events`, `event_types`), the metadata of categories
  (`categories/meta_*`), a table added by a newer writer, or a sub-table it
  does not know inside one it reads (`masks/<name>`). A save of a 3.0 file
  drops those in either layout.

```ts
import { loadSlp, SlpFormat3ChoiceError } from "@talmolab/sleap-io.js";

let labels;
try {
  labels = await loadSlp("dataset.slp", { format3: "ask" });
} catch (e) {
  if (!(e instanceof SlpFormat3ChoiceError)) throw e;
  // e.summary: { formatId, unlabeledPoints, metadataKeys, unknownColumns,
  //              unreadTables, lossless }
  const choice = confirm(e.message) ? "keep" : "view";
  labels = await loadSlp("dataset.slp", { format3: choice });
}
```

The choice travels with the content, not only with the `Labels` it was loaded
into. Every labeled frame, instance and annotation (static ROIs included), and
every frame group and instance group of a recording session, read from a 3.0
file carries it, and copies keep it (`Labels.copy` with its sessions, `extract`, `merge`, `BoundingBox.pad`,
`toRoi`, `toMask` and the other conversions between boxes, centroids, masks,
ROIs and label images). So content from a view-only file is refused by every
SLP writer wherever it ends up (merged into other labels, passed to
`new Labels({ labeledFrames })`, or appended to a streaming writer), content
from an edit-loaded file (its instances and annotations) is saved as the caller
chose wherever it ends up, and content of a file loaded to be kept in format
3.0 makes the labels it ends up in save as format 3.0. A merge passes only a
view-only choice on to records of your own, and only with what they take: a
frame of your own that takes nothing from a view-only frame (for example with
`frame: "keep_original"`) stays yours. An edit choice is not passed on to your
own frames: metadata keys they take from an edit-loaded frame count as your
own.

Exports to other formats (Analysis HDF5, CSV, NWB, COCO and the like) are
conversions, not SLP saves, and do not check the choice. Nor do `toDict` /
`fromDict` and the numpy codec: records rebuilt from their output are new and
carry no choice. An application that rebuilds records itself, for example for
undo snapshots, carries it with `copySourceMark(original, rebuilt)`
(`sourceMarkOf(record)` reads it).

`labels.sourceFormat` and the records' choice are frozen. To change the choice
after loading (say, the user decides to edit a file opened view-only), call
`setSourceAccess(labels, "keep")` (or `"edit"`): it switches
`labels.sourceFormat`, if set, and every record the labels hold that carries a
choice, whatever file it came from. So it also works on a project of your own
into which view-only content was merged. Records held elsewhere keep their
choice: copies in other labels (switch those too), and a lazy frame released
from the cache and still held (materialize it again). A lazy copy shares its
annotation records with the labels it was copied from, so switching either
switches those for both.

After saving edit-loaded labels over their source file, that file is in the
2.x layout. Set `labels.sourceFormat = null` to say so; the in-place save
functions then patch it as a 2.x file.

A reader learns that a file is in format 3.0, and what it holds, only after it
has read the file's pose tables, so `loadSlp` with `format3: "ask"` followed by
a second `loadSlp` reads them twice. For a large or remote file, call the lite
`loadSlpMetadata` first (it reads only the flags and names it needs), or pass
the choice from the start.

#### Saving in place

The in-place save (`buildLabelTableUpdate`, `checkInPlaceWritable`,
`writeLabelTablesInPlace`, and the streaming worker's `updateLabelsInPlace`)
patches the label tables of an existing file without rewriting its embedded
frames. `buildLabelTableUpdate` builds the update in the layout `"auto"` picks
(or `opts.slpVersion`): labels loaded from a 3.0 file to be kept build a 3.0
update, which patches the file column by column when only values changed
(the same rows, the same metadata keys and kinds; changed string metadata
values cannot be rewritten); otherwise `checkInPlaceWritable` returns
`ok: false` and the caller does a full save. `onDiskTablesFromFile(file)`
describes an open file's tables in either layout, and
`onDiskColumnTableFromMeta` builds the description of a 3.0 table from the
worker's dataset metadata. 2.x files written by Python sleap-io, whose point
flags are HDF5 booleans, are patched in place too: the booleans are written
with the dataset's own type, then read back, a bounded slice at a time, and
checked. Only h5py's booleans are written this way; a table with another
HDF5 enum is sent to a full save. A value edit keeps the NaN tracking scores
of a Python-written file, which the 2.x readers read as 0.

**If an in-place write throws, the file may be partly written: the caller
must then do a full save to the same target.** `checkInPlaceWritable` and the
checks `writeLabelTablesInPlace` and the worker's `updateLabelsInPlace` run
before their first write catch what they can, but a failure after the first
write (an I/O error, a read-back check, a resize the caller's `onDisk` did not
describe) leaves tables patched and others not, and only a full save repairs
that. A 3.0 update of lazy labels materializes them
(`buildLabelTableUpdate` calls `labels.materialize()`).

Every reader (`loadSlp`, `readSlp`, `readSlpLazy`, `readSlpStreaming`, and
`loadSlpMetadata` and `validateSlpBuffer` in the lite build) throws
`SlpFormatError` for a file it cannot read:

- a file of format 4 or higher;
- a file whose `required_features` attribute on `/metadata` names a feature
  this version doesn't know;
- a format 3.0 file whose tables are inconsistent (a missing required column,
  columns of different lengths, instance or point ranges that do not fit,
  links to rows that do not exist, byte ranges outside their buffer, metadata
  without one row per record). This is `SlpTableError`, a subclass of
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

A format 3.0 file can also be saved in the 2.x layout with Python sleap-io 0.10
or newer, the equivalent of `slpVersion: "v2"`:

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
const animal = new Identity({ name: "animal_A", color: "#ff0000" });

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
| `format3` | `"keep"` \| `"view"` \| `"edit"` \| `"ask"` | `"keep"` | What a later save may do with a format 3.0 file. See [Opening a format 3.0 file](#opening-a-format-30-file). |

### `saveSlp(labels, filename, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embed` | `boolean` \| `string` | `false` | Embed video frames (see [Saving with Embedded Frames](#saving-with-embedded-frames)) |
| `slpVersion` | `"auto"` \| `"v2"` \| `"v3"` | `"auto"` | The layout to write. See [Which layout a save writes](#which-layout-a-save-writes). |
| `unlabeledAs` | `"error"` \| `"absent"` | `"error"` | How the 2.x layout saves points marked as not labelled |

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
