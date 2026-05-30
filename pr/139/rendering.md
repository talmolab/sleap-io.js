# Rendering

sleap-io.js provides pose visualization using [skia-canvas](https://github.com/nicholasmoles/skia-canvas), a high-performance 2D graphics library for Node.js.

---

## Quick Start

Render a single frame to an image:

```ts
import { loadSlp, renderImage, saveImage } from "@talmolab/sleap-io.js";

const labels = await loadSlp("predictions.slp");
const imageData = await renderImage(labels.labeledFrames[0], {
  width: 640,
  height: 480,
});
await saveImage(imageData, "output.png");
```

Render a full video (requires ffmpeg):

```ts
import { loadSlp, renderVideo } from "@talmolab/sleap-io.js";

const labels = await loadSlp("predictions.slp");
await renderVideo(labels, "output.mp4");
```

---

## Color Schemes

Color scheme determines how poses are colored across instances and frames.

### Color by track

Each tracked animal gets a consistent color across all frames:

```ts
const imageData = await renderImage(lf, { colorBy: "track", width: 640, height: 480 });
```

### Color by instance

Each animal within a frame gets a unique color (colors may change between frames):

```ts
const imageData = await renderImage(lf, { colorBy: "instance", width: 640, height: 480 });
```

### Color by node

Each body part gets a unique color (same across all animals):

```ts
const imageData = await renderImage(lf, { colorBy: "node", width: 640, height: 480 });
```

### Auto detection

By default (`colorBy: "auto"`), the color scheme is chosen based on context:
- If tracks are present → `"track"`
- If single image with no tracks → `"instance"`
- Otherwise → `"node"` (prevents flicker in videos)

---

## Color Palettes

### Built-in palettes

9 palettes are included:

| Palette | Description |
|---------|-------------|
| `standard` | MATLAB default colors (default) |
| `distinct` | High-contrast colors for many instances |
| `tableau10` | Data visualization standard |
| `viridis` | Perceptually uniform scientific |
| `rainbow` | Spectrum colors for node types |
| `warm` | Orange/red tones |
| `cool` | Blue/purple tones |
| `pastel` | Subtle colors for overlays |
| `seaborn` | Professional look for publications |

```ts
const imageData = await renderImage(lf, {
  colorBy: "node",
  palette: "tableau10",
  width: 640,
  height: 480,
});
```

### Getting palette colors programmatically

```ts
import { getPalette } from "@talmolab/sleap-io.js";

const colors = getPalette("tableau10", 10);
// Returns: [[31, 119, 180], [255, 127, 14], ...]
```

---

## Marker Shapes

Five marker shapes are available for node visualization:

| Shape | Description |
|-------|-------------|
| `circle` | Filled circle (default) |
| `square` | Filled square |
| `diamond` | Rotated square |
| `triangle` | Upward-pointing triangle |
| `cross` | Plus sign |

```ts
const imageData = await renderImage(lf, {
  markerShape: "diamond",
  markerSize: 6,
  width: 640,
  height: 480,
});
```

---

## Styling Options

### Marker and line sizes

```ts
// Small markers and thin lines
const small = await renderImage(lf, { markerSize: 3, lineWidth: 1.5, width: 640, height: 480 });

// Medium (default)
const medium = await renderImage(lf, { markerSize: 4, lineWidth: 2, width: 640, height: 480 });

// Large markers and thick lines
const large = await renderImage(lf, { markerSize: 10, lineWidth: 5, width: 640, height: 480 });
```

### Transparency

```ts
// Full opacity (default)
const opaque = await renderImage(lf, { alpha: 1.0, width: 640, height: 480 });

// Semi-transparent overlay
const semi = await renderImage(lf, { alpha: 0.5, width: 640, height: 480 });

// Subtle overlay
const subtle = await renderImage(lf, { alpha: 0.25, width: 640, height: 480 });
```

### Toggle elements

```ts
// Both nodes and edges (default)
const both = await renderImage(lf, { showNodes: true, showEdges: true, width: 640, height: 480 });

// Edges only
const edgesOnly = await renderImage(lf, { showNodes: false, showEdges: true, width: 640, height: 480 });

// Nodes only
const nodesOnly = await renderImage(lf, { showNodes: true, showEdges: false, width: 640, height: 480 });
```

---

## Scaling

The `scale` parameter resizes the output. Graphics (markers, lines) scale proportionally:

```ts
// Full resolution (default)
const full = await renderImage(lf, { scale: 1.0, width: 640, height: 480 });

// Half resolution - faster, smaller files
const half = await renderImage(lf, { scale: 0.5, width: 640, height: 480 });

// Double resolution
const double = await renderImage(lf, { scale: 2.0, width: 640, height: 480 });
```

---

## Background Control

### Transparent background (default)

```ts
const imageData = await renderImage(lf, {
  background: "transparent",
  width: 640,
  height: 480,
});
```

### Solid color background

```ts
// Named color
const black = await renderImage(lf, { background: "black", width: 640, height: 480 });

// RGB tuple
const gray = await renderImage(lf, { background: [40, 40, 40], width: 640, height: 480 });

// Hex color
const hex = await renderImage(lf, { background: "#1a1a2e", width: 640, height: 480 });

// Grayscale
const grayscale = await renderImage(lf, { background: 128, width: 640, height: 480 });
```

### Color specification formats

The `background` parameter accepts many formats:

| Format | Example | Description |
|--------|---------|-------------|
| Named color | `"black"`, `"white"`, `"gray"` | Predefined color names |
| Hex (6-digit) | `"#ff8000"` | Standard hex color |
| Hex (3-digit) | `"#f80"` | Shorthand hex |
| RGB tuple | `[255, 128, 0]` | Values 0-255 |
| Grayscale | `128` | Single value 0-255 |
| Palette index | `"tableau10[0]"` | Color from palette |

Available named colors: `black`, `white`, `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`, `gray`/`grey`, `orange`, `purple`, `pink`, `brown`.

---

## Custom Rendering with Callbacks

Callbacks let you add custom graphics with direct access to the canvas context.

| Callback | Context Type | When Called |
|----------|--------------|-------------|
| `preRenderCallback` | `RenderContext` | Before poses are drawn |
| `postRenderCallback` | `RenderContext` | After all poses are drawn |
| `perInstanceCallback` | `InstanceContext` | After each instance is drawn |

### Instance labels

Draw track names above each instance:

```ts
import { renderImage, InstanceContext } from "@talmolab/sleap-io.js";

function drawLabels(ctx: InstanceContext): void {
  const centroid = ctx.getCentroid();
  if (!centroid) return;

  const [cx, cy] = ctx.worldToCanvas(centroid[0], centroid[1]);
  const label = ctx.trackName ?? `Instance ${ctx.instanceIdx}`;

  ctx.canvas.font = "14px Arial";
  ctx.canvas.fillStyle = "rgba(0, 0, 0, 0.6)";
  const metrics = ctx.canvas.measureText(label);
  ctx.canvas.fillRect(cx - 2, cy - 18, metrics.width + 4, 16);

  ctx.canvas.fillStyle = "white";
  ctx.canvas.fillText(label, cx, cy - 6);
}

const imageData = await renderImage(lf, {
  perInstanceCallback: drawLabels,
  width: 640,
  height: 480,
});
```

### Bounding boxes

Draw bounding boxes around instances:

```ts
import { renderImage, InstanceContext } from "@talmolab/sleap-io.js";

function drawBbox(ctx: InstanceContext): void {
  const bbox = ctx.getBbox();
  if (!bbox) return;

  const [x1, y1] = ctx.worldToCanvas(bbox[0], bbox[1]);
  const [x2, y2] = ctx.worldToCanvas(bbox[2], bbox[3]);
  const pad = 8;

  ctx.canvas.strokeStyle = "white";
  ctx.canvas.lineWidth = 2;
  ctx.canvas.setLineDash([6, 3]);
  ctx.canvas.strokeRect(x1 - pad, y1 - pad, x2 - x1 + 2 * pad, y2 - y1 + 2 * pad);
  ctx.canvas.setLineDash([]);
}

const imageData = await renderImage(lf, {
  perInstanceCallback: drawBbox,
  width: 640,
  height: 480,
});
```

### Frame info overlay

Add frame number and instance count:

```ts
import { renderImage, RenderContext } from "@talmolab/sleap-io.js";

function drawFrameInfo(ctx: RenderContext): void {
  const text = `Frame: ${ctx.frameIdx}  Instances: ${ctx.instances.length}`;

  ctx.canvas.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.canvas.fillRect(4, 4, 200, 20);

  ctx.canvas.font = "14px Arial";
  ctx.canvas.fillStyle = "white";
  ctx.canvas.fillText(text, 8, 18);
}

const imageData = await renderImage(lf, {
  postRenderCallback: drawFrameInfo,
  width: 640,
  height: 480,
});
```

---

## Video Rendering

Video rendering requires [ffmpeg](https://ffmpeg.org/download.html) to be installed and in your PATH.

### Basic video rendering

```ts
import { loadSlp, renderVideo } from "@talmolab/sleap-io.js";

const labels = await loadSlp("predictions.slp");
await renderVideo(labels, "output.mp4");
```

### Render a clip

```ts
await renderVideo(labels, "clip.mp4", { start: 100, end: 200 });
```

### Specific frames

```ts
await renderVideo(labels, "selected.mp4", { frameInds: [0, 50, 100, 150, 200] });
```

### Encoding options

```ts
await renderVideo(labels, "output.mp4", {
  fps: 30,           // Output frame rate
  crf: 18,           // Quality (lower = better, default: 25)
  preset: "slow",    // Encoding speed (default: "superfast")
  codec: "libx264",  // Video codec (default: "libx264")
});
```

### Progress tracking

```ts
await renderVideo(labels, "output.mp4", {
  onProgress: (current, total) => {
    console.log(`Rendering frame ${current}/${total}`);
  },
});
```

---

## Motion Trails

Motion trails trace a node or centroid trajectory over the last N frames, so you
can see how animals moved through the rendered output. Trails are drawn behind
the poses and fade from faint (oldest) to opaque (newest).

Because trails need temporal context, they are only drawn when the source is a
`Labels` object (siblings are looked up via `Labels.find`) or when sibling frames
are supplied via `trailFrames`. They are a no-op for an instance-array source.

### Video with centroid trails

```ts
await renderVideo(labels, "output.mp4", {
  showTrails: true,
  trailLength: 10,        // past frames behind the current frame
  trailNode: "centroid",  // "centroid", a node name, or a list of node names
  trailWidth: 2,
  trailAlphaFade: true,   // fade oldest -> newest
});
```

### Single image with trails

```ts
import { renderImage, saveImage } from "@talmolab/sleap-io.js";

// Trail the head and thorax nodes (one trail per node, sharing the pose color).
const img = await renderImage(labels, {
  width: 640,
  height: 480,
  background: "black",
  showTrails: true,
  trailNode: ["head", "thorax"],
});
await saveImage(img, "trails.png");
```

### Faint, uniform-colored trails

```ts
await renderVideo(labels, "output.mp4", {
  showTrails: true,
  trailColor: "white",    // overrides the per-track palette
  trailAlpha: 0.5,        // global opacity multiplier
  trailAlphaFade: false,  // uniform opacity instead of a fade
});
```

By default trails are colored to match the poses (by track, or by instance index
when untracked). Set `trailColor` to any color spec to force a single color.

### Drawing trails on your own canvas (browser)

`renderImage`/`renderVideo` are Node-only (they depend on `skia-canvas`/ffmpeg),
but the trail building blocks are browser-safe and composable:

```ts
import {
  resolveTrailNode,
  computeTrails,
  drawTrails,
} from "@talmolab/sleap-io.js";

const targets = resolveTrailNode("centroid", skeleton);
const framesByIdx = new Map(labels.find({ video }).map((lf) => [lf.frameIdx, lf]));
const { trails, colors } = computeTrails({
  frameIdx: 100,
  frameIdxToLf: framesByIdx,
  trailLength: 10,
  trailTargets: targets,
  trackIndexMap,
  paletteColors,
  hasTracks: true,
});
drawTrails(ctx, trails, { colors, lineWidth: 2, alphaFade: true });
```

---

## Export Utilities

### Save to file

```ts
import { renderImage, saveImage } from "@talmolab/sleap-io.js";

const imageData = await renderImage(lf, { width: 640, height: 480 });
await saveImage(imageData, "output.png");
await saveImage(imageData, "output.jpg");
```

### Convert to buffer

```ts
import { renderImage, toPNG, toJPEG } from "@talmolab/sleap-io.js";

const imageData = await renderImage(lf, { width: 640, height: 480 });
const pngBuffer = await toPNG(imageData);
const jpegBuffer = await toJPEG(imageData, 0.9); // quality 0-1
```

### Convert to data URL

```ts
import { renderImage, toDataURL } from "@talmolab/sleap-io.js";

const imageData = await renderImage(lf, { width: 640, height: 480 });
const dataUrl = await toDataURL(imageData, "png"); // Note: toDataURL is now async
// "data:image/png;base64,..."
```

---

## API Reference

### `renderImage(source, options)`

Render poses from a `Labels`, `LabeledFrame`, or array of `Instance`/`PredictedInstance`.

**Parameters:**
- `source`: `Labels | LabeledFrame | Instance[]`
- `options.width`: Frame width (required if no image provided)
- `options.height`: Frame height (required if no image provided)
- `options.colorBy`: `"track" | "instance" | "node" | "auto"` (default: `"auto"`)
- `options.palette`: Palette name (default: `"standard"`)
- `options.markerShape`: `"circle" | "square" | "diamond" | "triangle" | "cross"` (default: `"circle"`)
- `options.markerSize`: Marker radius in pixels (default: `4`)
- `options.lineWidth`: Edge line width (default: `2`)
- `options.alpha`: Opacity 0-1 (default: `1`)
- `options.showNodes`: Draw nodes (default: `true`)
- `options.showEdges`: Draw edges (default: `true`)
- `options.scale`: Output scale factor (default: `1`)
- `options.showTrails`: Draw motion trails (default: `false`; only for a `Labels` source or with `trailFrames`)
- `options.trailLength`: Past frames behind the current frame (default: `10`)
- `options.trailNode`: `"centroid"`, a node name, or a list of node names (default: `"centroid"`)
- `options.trailWidth`: Trail line width in pixels (default: `2`)
- `options.trailAlphaFade`: Fade oldest → newest (default: `true`)
- `options.trailAlpha`: Global trail opacity 0-1 (default: `1`)
- `options.trailColor`: Uniform trail color spec, or `null` to match poses (default: `null`)
- `options.background`: `"transparent"` or color spec
- `options.image`: Background `ImageData`
- `options.preRenderCallback`: `(ctx: RenderContext) => void`
- `options.postRenderCallback`: `(ctx: RenderContext) => void`
- `options.perInstanceCallback`: `(ctx: InstanceContext) => void`

**Returns:** `Promise<ImageData>`

### `renderVideo(source, outputPath, options)`

Render video with pose overlays. Requires ffmpeg.

**Parameters:**
- `source`: `Labels | LabeledFrame[]`
- `outputPath`: Output video file path
- `options`: All `renderImage` options plus:
  - `options.frameInds`: Specific frame indices to render
  - `options.start`: Start frame index
  - `options.end`: End frame index (exclusive)
  - `options.fps`: Output frame rate (default: `30`)
  - `options.codec`: Video codec (default: `"libx264"`)
  - `options.crf`: Quality factor (default: `25`)
  - `options.preset`: Encoding preset (default: `"superfast"`)
  - `options.onProgress`: `(current: number, total: number) => void`

**Returns:** `Promise<void>`

### `RenderContext`

Context passed to `preRenderCallback` and `postRenderCallback`.

**Properties:**
- `canvas`: `CanvasRenderingContext2D`
- `frameIdx`: Frame index
- `frameSize`: `[width, height]`
- `instances`: Array of instances
- `skeletonEdges`: `[srcIdx, dstIdx][]`
- `nodeNames`: `string[]`
- `scale`: Current scale factor
- `offset`: `[x, y]` offset

**Methods:**
- `worldToCanvas(x, y)`: Transform world coordinates to canvas coordinates

### `InstanceContext`

Context passed to `perInstanceCallback`.

**Properties:**
- `canvas`: `CanvasRenderingContext2D`
- `instanceIdx`: Instance index within frame
- `points`: `[[x, y], ...]` coordinates
- `skeletonEdges`: `[srcIdx, dstIdx][]`
- `nodeNames`: `string[]`
- `trackIdx`: Track index or `null`
- `trackName`: Track name or `null`
- `confidence`: Instance score or `null`
- `scale`: Current scale factor
- `offset`: `[x, y]` offset

**Methods:**
- `worldToCanvas(x, y)`: Transform world coordinates to canvas coordinates
- `getCentroid()`: Get centroid of valid points, or `null`
- `getBbox()`: Get `[x1, y1, x2, y2]` bounding box, or `null`
