# sleap-io.js

JavaScript/TypeScript utilities for reading and writing SLEAP `.slp` files with streaming-friendly access patterns and a lightweight data model. This is the JS companion to the Python library at https://github.com/talmolab/sleap-io.

## Intent

- Make SLP parsing available in browsers and serverless runtimes.
- Support streaming-first workflows for large `.slp`/`.pkg.slp` files.
- Provide a minimal data model and codecs that mirror sleap-io behavior.
- Enable client-side visualization and analysis pipelines.

## Features

- SLP read/write with format compatibility (including embedded frames via HDF5 video datasets).
- Streaming-friendly file access (URL, `File`, `FileSystemFileHandle`).
- Core data model (`Labels`, `LabeledFrame`, `Instance`, `Skeleton`, `Video`, etc.).
- Dictionary and numpy codecs for interchange.
- Demo app for quick inspection.

## Quickstart

```bash
npm install
npm run build
```

### Load and save SLP

```ts
import { loadSlp, saveSlp } from "sleap-io.js";

const labels = await loadSlp("/path/to/session.slp", { openVideos: false });
await saveSlp(labels, "/tmp/session-roundtrip.slp", { embed: false });
```

### Load video

```ts
import { loadVideo } from "sleap-io.js";

const video = await loadVideo("/path/to/video.mp4", { openBackend: false });
video.close();
```

## Architecture

- **I/O layer**: `loadSlp`/`saveSlp` wrap the HDF5 reader/writer in `src/codecs/slp`.
- **Data model**: `src/model` mirrors sleap-io classes and supports numpy/dict codecs.
- **Backends**: `src/video` provides browser media and embedded HDF5 decoding.
- **Streaming**: `src/codecs/slp/h5.ts` selects URL/File/FS handle strategies.

## Environments and Streaming

- **Env1 (Static SPA)**: Browser-only usage with URL streaming (CORS + Range) or the File System Access API.
- **Env2 (Server/Worker)**: Server-side or worker environments that stream `.slp` from URLs or byte buffers.
- **Env3 (Local Node/Electron)**: Optional local filesystem access for Node/Electron.

Streaming can be tuned with:

```ts
await loadSlp(url, { h5: { stream: "auto", filenameHint: "session.slp" } });
```

## Demo

The demo in `demo/` loads the built package from `dist/`. Build first, then serve the repo with a static server and open `demo/index.html`:

```bash
npm run build
```

## Links

- Python sleap-io: https://github.com/talmolab/sleap-io
- Docs: https://io.sleap.ai
