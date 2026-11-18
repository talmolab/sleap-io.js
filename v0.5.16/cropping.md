# Virtual Cropping

`sleap-io.js` can expose a **virtual, on-read crop** of a video — a cropped view
whose frames are produced by decoding the source and slicing in memory, without
copying or re-encoding any pixels. It is a lazy, non-destructive view: the source
video is never mutated, and the crop lives only in the cropped `Video`'s backend
(and, when saved, in a small `/video_crops` dataset in the `.slp`).

Virtual cropping is browser-safe. The crop primitives (`cropPoints`, `uncropPoints`,
`cropFrame`), the `CropVideoBackend`, and `Video.crop` are exported from both the
Node and browser entry points.

---

## Quick start

```ts
import { loadVideo } from "@talmolab/sleap-io.js";

const full = await loadVideo("session.mp4"); // shape: [1000, 1080, 1920, 3]

// A cropped view. crop = [x1, y1, x2, y2], with x2/y2 EXCLUSIVE.
const view = full.crop([320, 200, 576, 456]);

view.shape; // [1000, 256, 256, 3]   -- cropped (frames, h, w, channels)
view.cropRect; // [320, 200, 576, 456]
view.isCropped; // true
view.sourceVideo === full; // true   -- provenance to the uncropped original

const frame = await view.getFrame(0); // a 256x256 ImageData (cropped)
```

`Video.fromCrop` is a thin wrapper around `video.crop(...)`:

```ts
import { Video } from "@talmolab/sleap-io.js";

const view = Video.fromCrop(full, [320, 200, 576, 456]);
```

The returned object is a normal [`Video`](api.md#video): `shape`, `getFrame`,
`getFrameTimes`, `fps`, and matching all report the **cropped** view.

!!! note "No filesystem auto-open in the JS port"
    Unlike Python's `Video.from_crop("session.mp4", ...)`, the JS port has no generic
    filesystem-backed open facade, so you must already hold a `Video` with an open
    backend. Pass a `Video` (not a path string) to `Video.fromCrop`, or call
    `video.crop(...)` directly. Cropping a `Video` with no open backend throws.

---

## The crop convention

A crop is `[x1, y1, x2, y2]` in **source pixel coordinates**, with `x2`/`y2`
**exclusive**. The cropped size is `[y2 - y1, x2 - x1]` (height, width).

Coordinates may be **negative or extend past the source** — out-of-bounds regions
are **padded** with `fill` (default `0`), never clamped, so the output shape is
always exactly `[y2 - y1, x2 - x1]`. This makes fixed-size, centroid-following
windows easy:

```ts
// Fixed 128x128 window centered on a point (may run off the frame edge -> padded).
const view = full.crop(null, { center: [cx, cy], size: [128, 128], fill: 0 });
view.shape; // [nFrames, 128, 128, 3]
```

`Video.crop` accepts exactly **one** region spec — an explicit `crop` rect (the
positional argument), a `bbox`, an `roi` (anything exposing shapely-style `.bounds`,
expanded by `margin`), or a `center`/`size` pair:

```ts
full.crop([x1, y1, x2, y2]); // explicit rect
full.crop(null, { bbox: [x1, y1, x2, y2] }); // same, named
full.crop(null, { roi: myRoi, margin: 8 }); // axis-aligned bounds of an ROI + margin
full.crop(null, { center: [cx, cy], size: [w, h] }); // fixed-size window
```

Float bounds are rounded **outward** (floor of the mins, ceil of the maxs) so the
integer rect always *contains* the requested region; the centered window uses
`round` so the output shape is exactly `size`. An inverted rect (`x2 < x1` or
`y2 < y1`) throws.

The `roi` spec accepts any object with a `bounds: [minx, miny, maxx, maxy]` field —
including a `sleap-io.js` [`ROI`](api.md#roi):

```ts
const view = full.crop(null, { roi: labels.rois[0], margin: 8 });
```

---

## Coordinates

A crop is a pure integer translation by `(x1, y1)`, so mapping landmark coordinates
between source and cropped frames is exact and NaN-preserving:

```ts
const ptsCrop = view.toCropCoords(ptsSource); // subtract (x1, y1)
const ptsSource = view.toSourceCoords(ptsCrop); // add (x1, y1)
```

Both accept either an array of `[x, y]` pairs or a flat interleaved buffer
(`[x0, y0, x1, y1, ...]`, a `Float64Array`/`Float32Array` or plain `number[]`) and
return the same kind. The input is copied, never mutated.

On an **uncropped** video these are identity passthroughs (returning a copy), so the
same call works regardless of whether a video happens to be cropped. The underlying
functions are exported as `cropPoints` / `uncropPoints`:

```ts
import { cropPoints, uncropPoints } from "@talmolab/sleap-io.js";

const local = cropPoints(
  [
    [400, 250],
    [NaN, NaN],
  ],
  [320, 200, 576, 456]
); // [[80, 50], [NaN, NaN]]
const back = uncropPoints(local, [320, 200, 576, 456]); // [[400, 250], [NaN, NaN]]
```

!!! note "Coordinates are never rewritten on disk"
    Virtual cropping never mutates stored instance points. These helpers are
    read-time conveniences for presenting/ingesting coordinates in cropped-frame
    space.

---

## Cropping a frame directly

`cropFrame` is the pure pixel primitive behind the backend. It operates on an
`ImageData` (or any `{ data, width, height, channels? }`) and returns a new
`ImageData`-shaped result with the same pad-fill semantics as `Video.crop`:

```ts
import { cropFrame } from "@talmolab/sleap-io.js";

const cropped = cropFrame(imageData, [320, 200, 576, 456], 0);
cropped.width; // 256
cropped.height; // 256
```

`cropFrame` is intentionally pure and **throws on a raw `ImageBitmap`** (its pixels
cannot be read synchronously). Rasterizing an `ImageBitmap` to readable pixels is the
backend's job: `CropVideoBackend.getFrame` does this lazily, using `OffscreenCanvas`
when available (browser) and falling back to `skia-canvas` on Node. No Node-only
import leaks into the browser bundle.

---

## Mosaics: many crops, one decode

Multiple differently-cropped views of one physical file can share a single decoder,
so the source frame is decoded once per read rather than once per tile. This is the
default (`shareDecode: true`):

```ts
const full = await loadVideo("session.mp4");
const tiles = [];
for (let y = 0; y + 128 <= 1080; y += 128) {
  for (let x = 0; x + 128 <= 1920; x += 128) {
    tiles.push(full.crop([x, y, x + 128, y + 128])); // shareDecode: true (default)
  }
}
const labels = new Labels({ videos: tiles });
```

Each tile reuses `full`'s backend as its inner reader. The tiles do **not** own that
shared decoder, so closing one tile does not tear down its siblings; the owning
source `Video` manages the decoder's lifetime. Pass `shareDecode: false` to give a
tile its own independent backend instead.

Two crops of the same file with **different** rects are kept distinct through merge,
append, and matching; two crops with the **same** rect dedup to one view. This
crop-aware deduplication is non-breaking: uncropped videos match exactly as before.

!!! info "Decoder sharing is not persisted"
    Sharing a decoder is a runtime optimization only. It is intentionally not
    preserved across save/load — each reconstructed tile rebuilds its own reader
    from the stored uncropped source.

---

## Saving and loading (SLP round-trip)

Crops round-trip through `.slp` without breaking older readers:

```ts
import { saveSlp, loadSlp } from "@talmolab/sleap-io.js";

await saveSlp(labels, "mosaic.slp");
const labels2 = await loadSlp("mosaic.slp");

labels2.videos[0].cropRect; // [0, 0, 128, 128]        -- preserved
labels2.videos[0].shape; // [1000, 128, 128, 3]
labels2.videos[0].sourceVideo?.shape; // [1000, 1080, 1920, 3]
labels2.videos.length; // all tiles preserved (not collapsed)
```

In the browser, `saveSlpToBytes(labels)` serializes the same way. The streaming
reader (`loadSlp` from a URL/`File`) reconstructs crops identically.

- The crop rects are stored in a dedicated top-level `/video_crops` dataset (a single
  JSON string), written **only when at least one video is cropped**. The
  `videos_json` entry describes the **uncropped source**.
- An older reader that does not understand `/video_crops` simply loads the uncropped
  source video — a graceful, lossy degrade, never an error.
- Files with **no** crops are byte-identical to before this feature existed (no
  `/video_crops` dataset, no format-version bump).

See [SLP format: Virtual Crops](api.md#slp-format-versions) for the on-disk layout.

---

## Non-goals

Virtual cropping is a pure translate-and-clip view. It deliberately does **not** do:

- **Rotation, scale, pad, or flip on read** — virtual cropping is translate-and-clip
  only.
- **Decode-cost savings for compressed video** — the crop is applied **after** a
  full-frame decode for every backend (`h5wasm` exposes no hyperslab slicing, so even
  raw HDF5 decodes the full frame first). The slice is a free in-memory view; it saves
  resident array size, not decode time or I/O.
- **Materializing (baking) a crop to a new video file** — there is no encoder in the
  JS port, so `apply_crop` / `apply-crops` (available in Python `sleap-io`) are not
  ported. A virtual crop is always a read-time view.
- **Lossless export through non-SLP writers** — formats without a crop concept emit
  the cropped frame and its coordinates as-is (acceptably lossy).
- **Rewriting on-disk point coordinates** — source labels are never mutated.

---

## See also

- [API Reference: `Video`](api.md#video) and the SLP format version table.
- [Usage Guide](usage.md): loading, saving, and the video backends.
- Python `sleap-io` virtual cropping: <https://io.sleap.ai/latest/cropping/>
