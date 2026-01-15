# API Reference

## Core I/O

```ts
import { loadSlp, saveSlp, loadVideo } from "@talmolab/sleap-io.js";
```

- `loadSlp(source, options)` — read `.slp` from path, URL, `File`, or `FileSystemFileHandle`.
- `saveSlp(labels, filename, options)` — write `.slp` in Node environments.
- `loadVideo(path, options)` — open a video backend for media files.

## Data Model

```ts
import {
  Labels,
  LabeledFrame,
  Instance,
  PredictedInstance,
  Skeleton,
  Video,
  SuggestionFrame,
  LabelsSet,
  Track,
} from "@talmolab/sleap-io.js";
```

## Codecs

```ts
import { toDict, fromDict, toNumpy, fromNumpy } from "@talmolab/sleap-io.js";
```

- `toDict(labels, options)` / `fromDict(data)`
- `toNumpy(labels, options)` / `fromNumpy(array, options)`

## Streaming Options

```ts
await loadSlp(url, {
  openVideos: false,
  h5: {
    stream: "auto",
    filenameHint: "session.slp",
  },
});
```
