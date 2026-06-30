# Demo

The demo loads `assets/demo-flies13-seg.slp` and overlays **segmentation masks**
(translucent fill via the browser-safe `drawMasks`, plus smoothed contour
outlines from `SegmentationMask.contours()`) colored by track, under the pose
skeleton. Toggle masks and their opacity with the controls under the player.

## Local development

1. Build the package:

```bash
bun run build
```

2. Build the self-contained demo bundle (`demo/demo.bundle.js`, gitignored). It
   inlines the browser build + JS deps (mediabunny, pako, yaml); the HDF5
   streaming worker fetches `h5wasm` from a CDN at runtime, so no importmap is
   needed:

```bash
bun run demo:build
```

3. Serve the repo root (needs a static server with HTTP range support):

```bash
bunx serve -p 8080 --cors --no-clipboard
```

4. Open the demo page:

```
http://localhost:8080/demo/index.html
```

> **Regenerating the segmentation demo data.** `assets/demo-flies13-seg.slp` is
> committed, but you can rebuild it from the pose-only `demo-flies13-preds.slp`
> with the one-off helper (it dilates each instance's skeleton into a mask):
> `bun scripts/burn-skeleton-masks.mjs`. This is throwaway tooling — a proper
> pose→mask utility is tracked upstream in sleap-io.

## Segmentation controls

- **Show masks**: toggle the mask fill + outline overlay.
- **Opacity**: blend strength of the mask fill (outlines stay crisp).

## Demo Modes

The demo supports two modes:

### External Video Mode (default)

- Preloaded with `demo/assets/demo-flies13-preds.slp` and `demo/assets/demo-flies13-preds.mp4`
- Uses separate SLP (annotations) and video files
- Supports video playback with Play/Pause

### Embedded Images Mode

For SLP files with embedded images (e.g., `.pkg.slp` validation datasets):

1. Use the file picker to select an SLP file
2. Leave the "Video URL" field **blank**
3. Click Load

The demo will:
- Detect embedded images and switch to embedded mode
- Display frames directly from the HDF5 file
- Support multi-video files (frames from different videos)
- Navigate with slider or arrow keys

## Keyboard Shortcuts

- **Arrow Left / A**: Previous frame
- **Arrow Right / D**: Next frame
