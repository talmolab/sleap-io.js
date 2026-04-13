# sleap-io.js

JavaScript/TypeScript utilities for reading and writing SLEAP `.slp` files with streaming-friendly access patterns and a lightweight data model.

## Quick start

```bash
npm install
npm run build
```

```ts
import { loadSlp, saveSlp } from "@talmolab/sleap-io.js";

const labels = await loadSlp("/path/to/session.slp", { openVideos: false });
await saveSlp(labels, "/tmp/session-roundtrip.slp", { embed: false });
```

## Why this project

- Bring SLP parsing to browser and serverless environments.
- Keep large file workflows streaming-first.
- Mirror the sleap-io data model and codec behaviors in JS.

## Features

- SLP read/write with embedded frame support (format 1.0–2.2).
- ROI and segmentation mask annotations (format 1.5), ROI-instance associations (format 1.6), bounding boxes (format 1.7), label images (format 1.8), identities (format 1.9), corner-based bounding boxes (format 2.0), spatial metadata (format 2.1), chunked label image storage (format 2.2).
- Browser-compatible SLP writing via `saveSlpToBytes()`.
- Streaming inputs (URL, `File`, `FileSystemFileHandle`, `Blob`).
- Data model types (`Labels`, `LabeledFrame`, `Instance`, `Skeleton`, `Video`, `ROI`, `SegmentationMask`, `BoundingBox`, `Centroid`, `LabelImage`, `Identity`, `Instance3D`).
- TrackMate CSV import (`readTrackMateCsv`, `loadTrackMate`).
- Video backends accept `string`, `File`, or `Blob` sources.
- Browser-safe: Node.js-only code is fully isolated from the browser bundle.
- Dictionary and numpy codecs.
- **Lite mode** for Workers-compatible metadata extraction (no WASM).

## Environments

- **Static SPA**: Browser-only usage with URL streaming or File System Access API.
- **Server/Worker**: Stream from URLs or byte buffers for containerized runtimes.
- **Local Node/Electron**: Optional local filesystem access for `.slp` paths.

## Links

- Python sleap-io: https://github.com/talmolab/sleap-io
- Docs: https://iojs.sleap.ai
