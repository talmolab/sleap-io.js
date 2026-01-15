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

- SLP read/write with embedded frame support.
- Streaming inputs (URL, `File`, `FileSystemFileHandle`).
- Data model types (`Labels`, `LabeledFrame`, `Instance`, `Skeleton`, `Video`).
- Dictionary and numpy codecs.

## Environments

- **Static SPA**: Browser-only usage with URL streaming or File System Access API.
- **Server/Worker**: Stream from URLs or byte buffers for containerized runtimes.
- **Local Node/Electron**: Optional local filesystem access for `.slp` paths.

## Links

- Python sleap-io: https://github.com/talmolab/sleap-io
- Docs: https://io.sleap.ai
