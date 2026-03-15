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
    "h5wasm": "https://unpkg.com/h5wasm@0.8.8/dist/esm/hdf5_hl.js",
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
      "h5wasm": "https://unpkg.com/h5wasm@0.8.8/dist/esm/hdf5_hl.js",
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

## ROI & Segmentation Masks

SLP format 1.5 supports spatial annotations (regions of interest and segmentation masks) alongside pose data:

```ts
import { loadSlp, ROI, SegmentationMask, AnnotationType } from "@talmolab/sleap-io.js";

const labels = await loadSlp("dataset.slp");

// Access ROIs and masks
console.log(`${labels.rois.length} ROIs, ${labels.masks.length} masks`);

// Query by video and frame
const frameRois = labels.getRois({ video: labels.videos[0], frameIdx: 0 });
const frameMasks = labels.getMasks({ video: labels.videos[0], frameIdx: 0 });

// Create new ROIs
const bbox = ROI.fromBbox(100, 200, 50, 80, {
  category: "arena",
  video: labels.videos[0],
});
labels.rois.push(bbox);

// Save — format 1.5 is used automatically when ROIs/masks are present
await saveSlp(labels, "output.slp");
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
