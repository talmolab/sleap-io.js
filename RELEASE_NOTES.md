# v0.2.1 Release Notes

This release closes all remaining feature gaps identified in [#50](https://github.com/talmolab/sleap-io.js/issues/50), bringing the JavaScript implementation to near-parity with the Python `sleap-io` library. It adds lazy loading, video frame embedding, negative frames, multi-file operations, skeleton codecs, and browser bundler compatibility.

## New Features

### Lazy Loading ([#58](https://github.com/talmolab/sleap-io.js/pull/58), [#61](https://github.com/talmolab/sleap-io.js/pull/61))

SLP files can now be loaded lazily, deferring frame parsing until individual frames are accessed. This dramatically improves load times for large datasets.

```ts
import { loadSlp } from "@talmolab/sleap-io.js";

// Only metadata, skeletons, videos, and tracks are parsed upfront
const labels = await loadSlp("large_dataset.slp", { lazy: true });

console.log(labels.isLazy);                  // true
console.log(labels.labeledFrames.length);    // frame count is immediately available

// Individual frames are materialized on demand
const frame = labels.labeledFrames.at(0);

// Fast numpy conversion directly from raw columns (no frame materialization needed)
const array = labels.numpy();

// Fully materialize all frames when needed
labels.materialize();
console.log(labels.isLazy);                  // false
```

**New exports:** `LazyDataStore`, `LazyFrameList`, `readSlpLazy`

`Labels` methods that access frames (`instances`, `find()`, `append()`, `toDict()`, `numpy()`, `negativeFrames`) auto-materialize when in lazy mode, so existing code continues to work without changes.

### Video Frame Embedding ([#57](https://github.com/talmolab/sleap-io.js/pull/57), [#60](https://github.com/talmolab/sleap-io.js/pull/60))

Video frames can now be embedded directly into SLP files when saving, matching Python's `Labels.save(..., embed=True)` behavior.

```ts
import { saveSlp, saveSlpToBytes } from "@talmolab/sleap-io.js";

// Embed all labeled frames
await saveSlp(labels, "output.slp", { embed: true });

// Embed only user-annotated frames
await saveSlp(labels, "output.slp", { embed: "user" });

// Embed user + suggestion frames
await saveSlp(labels, "output.slp", { embed: "user+suggestions" });

// Also works with in-memory serialization
const bytes = await saveSlpToBytes(labels, { embed: "user" });
```

**Supported embed modes:** `true` / `"all"`, `"user"`, `"suggestions"`, `"user+suggestions"`

Each embedded video is written with a `frame_sizes` dataset for reliable frame boundary detection, eliminating the need for fragile magic-byte scanning when reading back.

### Source Video Restoration ([#62](https://github.com/talmolab/sleap-io.js/pull/62))

The `embed: "source"` mode replaces embedded videos with their original source video references before writing, matching Python's `write_videos(restore_source=True)`:

```ts
// Strip embedded frames and restore original video paths
await saveSlp(labels, "output.slp", { embed: "source" });
```

### Negative Frames ([#55](https://github.com/talmolab/sleap-io.js/pull/55))

Negative-annotated frames (frames explicitly marked as containing no instances of interest) are now read and written correctly.

```ts
const labels = await loadSlp("dataset.slp");

// Check individual frames
for (const frame of labels.labeledFrames) {
  if (frame.isNegative) {
    console.log(`Frame ${frame.frameIdx} is a negative sample`);
  }
}

// Filter to negative frames only
const negatives = labels.negativeFrames;
```

**New properties:** `LabeledFrame.isNegative` (boolean), `Labels.negativeFrames` (getter)

Previously, negative frame annotations were silently lost on load. This was a **critical data loss bug** for training workflows that use negative samples.

### Multi-File Loading ([#56](https://github.com/talmolab/sleap-io.js/pull/56))

Load and save multiple SLP files in parallel with `loadSlpSet()` and `saveSlpSet()`:

```ts
import { loadSlpSet, saveSlpSet } from "@talmolab/sleap-io.js";

// Load from array of paths (keys default to filenames)
const set = await loadSlpSet(["train.slp", "val.slp", "test.slp"]);

// Load from record with custom keys
const set = await loadSlpSet({
  training: "/data/train.slp",
  validation: "/data/val.slp",
});

// Access individual labels
const trainLabels = set.get("training");

// Save all labels in the set
await saveSlpSet(set);
```

**New exports:** `loadSlpSet`, `saveSlpSet`

`LabelsSet` also gains `fromLabelsList()`, `toArray()`, and `keyArray()` methods.

### Skeleton JSON Codec ([#51](https://github.com/talmolab/sleap-io.js/pull/51))

Parse SLEAP's jsonpickle-format skeleton definitions (the format used in standalone `.json` skeleton files and training configs):

```ts
import { readSkeletonJson, isSkeletonJson } from "@talmolab/sleap-io.js";

const json = fs.readFileSync("skeleton.json", "utf-8");
if (isSkeletonJson(json)) {
  const skeleton = readSkeletonJson(json);
  console.log(skeleton.nodeNames); // ["nose", "head", "neck", ...]
}
```

Handles `py/reduce`, `py/id`, `py/tuple` patterns, shared-object and duplicate-object format variants, and deduplicates symmetry pairs.

### Training Config Skeleton Extraction ([#52](https://github.com/talmolab/sleap-io.js/pull/52))

Extract skeleton definitions from SLEAP training configuration JSON files:

```ts
import { readTrainingConfigSkeletons, isTrainingConfig } from "@talmolab/sleap-io.js";

const config = fs.readFileSync("training_config.json", "utf-8");
if (isTrainingConfig(config)) {
  const skeletons = readTrainingConfigSkeletons(config);
}
```

### Suggestion Frame Groups ([#53](https://github.com/talmolab/sleap-io.js/pull/53))

`SuggestionFrame` now has an explicit `group` property (defaults to `"default"`) that is read from and written to SLP files:

```ts
for (const suggestion of labels.suggestions) {
  console.log(`Frame ${suggestion.frameIdx} in group "${suggestion.group}"`);
}
```

### Session Parsing in Streaming Reader ([#54](https://github.com/talmolab/sleap-io.js/pull/54))

The streaming SLP reader (`readSlpStreaming()`) now parses `RecordingSession` objects with `CameraGroup`, video mappings, frame groups, and instance groups. Previously, sessions were hardcoded as an empty array.

## Bug Fixes & Improvements

### Format 1.2 `tracking_score` Handling ([#62](https://github.com/talmolab/sleap-io.js/pull/62))

- Added explicit `formatId < 1.2` guard that zeroes `tracking_score` for older format versions
- NaN values in `tracking_score` are now handled correctly in all three readers (eager, streaming, lazy)

### Lazy `toNumpy()` Fast Path ([#62](https://github.com/talmolab/sleap-io.js/pull/62))

`LazyDataStore.toNumpy()` builds the 4D numpy-like array directly from raw HDF5 column data without materializing any `LabeledFrame` or `Instance` objects, providing significant performance improvements for large datasets.

### Frame Boundary Detection ([#60](https://github.com/talmolab/sleap-io.js/pull/60))

Embedded video frames now use a `frame_sizes` dataset for reliable frame boundary detection via cumulative sum, replacing fragile JPEG/PNG magic-byte scanning. The reader falls back to magic-byte scanning for backward compatibility with older files.

### Lazy Loading Auto-Materialization ([#61](https://github.com/talmolab/sleap-io.js/pull/61))

- `Labels` methods that access `labeledFrames` (`instances`, `find()`, `append()`, `toDict()`, `numpy()`, `negativeFrames`) now auto-materialize when in lazy mode
- `LazyFrameList` iterator skips null frames instead of stopping early
- Sessions are read eagerly in `readSlpLazy()` for correct session data

### JSDoc Restoration ([#59](https://github.com/talmolab/sleap-io.js/pull/59))

Restored JSDoc comments for `loadSlp()` and `saveSlp()` that were accidentally stripped, and added documentation for `loadSlpSet()`, `saveSlpSet()`, and `loadVideo()`.

## Build & Infrastructure

### Browser Bundler Compatibility ([#63](https://github.com/talmolab/sleap-io.js/pull/63))

**This is a key improvement for browser users.**

- Browser bundlers (Vite, Rollup, webpack) can now import `@talmolab/sleap-io.js` without build failures or manual stubs
- Added `"browser"` conditional export in `package.json` routing to a browser-safe entry point that excludes Node-only modules (`skia-canvas`, `child_process`)
- Moved `skia-canvas` to `optionalDependencies` so `npm install` doesn't fail in browser-only projects
- `skia-canvas` is marked as external in tsup to avoid bundling the 29MB native binary

**Migration note:** You no longer need to stub `skia-canvas` or `child_process` in your bundler config. The `"browser"` export condition handles this automatically. If you had manual stubs in your Vite/Rollup/webpack config, you can safely remove them.

### Versioned Documentation ([#64](https://github.com/talmolab/sleap-io.js/pull/64))

- Documentation at [iojs.sleap.ai](https://iojs.sleap.ai/) now uses [mike](https://github.com/jimporter/mike) for versioned docs
- `dev` version deployed on every push to `main`
- Release versions (e.g., `v0.2.1`) deployed with `latest` alias on GitHub release
- PR previews at `https://iojs.sleap.ai/pr/{number}/` with sticky comments and automatic cleanup
- Version dropdown in the docs header

## Migration Guide

### From v0.2.0

This is a **backward-compatible** release. All existing code continues to work without changes. New features are opt-in.

**Lazy loading** (opt-in):
```ts
// Before (still works)
const labels = await loadSlp("file.slp");

// New option
const labels = await loadSlp("file.slp", { lazy: true });
```

**Frame embedding** (opt-in):
```ts
// Before: embedding threw "not supported yet" error
// Now: works with multiple modes
await saveSlp(labels, "output.slp", { embed: true });
```

**Browser bundler users**: Remove any manual `skia-canvas` / `child_process` stubs from your bundler config. The new browser conditional export handles this automatically.

**Negative frames**: If you were working with SLP files containing negative samples, these annotations are now preserved through load/save cycles. No code changes needed — this fixes a silent data loss issue.

## Full Changelog

| PR | Title |
|----|-------|
| [#51](https://github.com/talmolab/sleap-io.js/pull/51) | Add standalone skeleton JSON (jsonpickle format) codec |
| [#52](https://github.com/talmolab/sleap-io.js/pull/52) | Add training config skeleton extraction |
| [#53](https://github.com/talmolab/sleap-io.js/pull/53) | Add explicit group property to SuggestionFrame |
| [#54](https://github.com/talmolab/sleap-io.js/pull/54) | Add session parsing to streaming SLP reader |
| [#55](https://github.com/talmolab/sleap-io.js/pull/55) | Add negative frames support |
| [#56](https://github.com/talmolab/sleap-io.js/pull/56) | Add multi-file labels loading with loadSlpSet/saveSlpSet |
| [#57](https://github.com/talmolab/sleap-io.js/pull/57) | Add video frame embedding on SLP write |
| [#58](https://github.com/talmolab/sleap-io.js/pull/58) | Add lazy loading system for SLP files |
| [#59](https://github.com/talmolab/sleap-io.js/pull/59) | Restore JSDoc comments for public API functions |
| [#60](https://github.com/talmolab/sleap-io.js/pull/60) | Add frame_sizes dataset for reliable frame boundary detection |
| [#61](https://github.com/talmolab/sleap-io.js/pull/61) | Fix lazy loading Labels method gaps |
| [#62](https://github.com/talmolab/sleap-io.js/pull/62) | Close remaining feature gaps from issue #50 |
| [#63](https://github.com/talmolab/sleap-io.js/pull/63) | Add browser conditional exports to fix bundler compatibility |
| [#64](https://github.com/talmolab/sleap-io.js/pull/64) | Add mike versioned docs with PR previews and release deployment |
