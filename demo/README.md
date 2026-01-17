# Demo

## Local development

1. Build the package:

```bash
npm run build
```

2. Serve the repo root (needs static server for module imports):

```bash
npx serve -p 8080 --cors --no-clipboard
```

3. Open the demo page:

```
http://localhost:8080/demo/index.html
```

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
