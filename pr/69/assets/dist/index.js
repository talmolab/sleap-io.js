import {
  AnnotationType,
  Camera,
  CameraGroup,
  FrameGroup,
  InstanceContext,
  InstanceGroup,
  LabeledFrame,
  Labels,
  LabelsSet,
  LazyDataStore,
  LazyFrameList,
  MARKER_FUNCTIONS,
  Mp4BoxVideoBackend,
  NAMED_COLORS,
  PALETTES,
  ROI,
  RecordingSession,
  RenderContext,
  SegmentationMask,
  StreamingH5File,
  StreamingHdf5VideoBackend,
  SuggestionFrame,
  Video,
  _registerMaskFactory,
  decodeRle,
  decodeWkb,
  decodeYamlSkeleton,
  determineColorScheme,
  drawCircle,
  drawCross,
  drawDiamond,
  drawSquare,
  drawTriangle,
  encodeRle,
  encodeWkb,
  encodeYamlSkeleton,
  fromDict,
  fromNumpy,
  getMarkerFunction,
  getPalette,
  isStreamingSupported,
  isTrainingConfig,
  labelsFromNumpy,
  loadSlp,
  loadSlpSet,
  loadVideo,
  makeCameraFromDict,
  openH5Worker,
  openStreamingH5,
  rasterizeGeometry,
  readSkeletonJson,
  readSlpStreaming,
  readTrainingConfigSkeleton,
  readTrainingConfigSkeletons,
  resolveColor,
  rgbToCSS,
  rodriguesTransformation,
  saveSlp,
  saveSlpSet,
  saveSlpToBytes,
  toDict,
  toNumpy
} from "./chunk-DWLQER7A.js";
import {
  Edge,
  Instance,
  Node,
  PredictedInstance,
  Skeleton,
  Symmetry,
  Track,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict
} from "./chunk-NWJVKWIL.js";

// src/rendering/render.ts
var DEFAULT_OPTIONS = {
  colorBy: "auto",
  palette: "standard",
  markerShape: "circle",
  markerSize: 4,
  lineWidth: 2,
  alpha: 1,
  showNodes: true,
  showEdges: true,
  scale: 1,
  background: "transparent"
};
var DEFAULT_COLOR = PALETTES.standard[0];
async function renderImage(source, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { instances, skeleton, frameSize, frameIdx, tracks } = extractSourceData(source, opts);
  if (instances.length === 0 && !opts.image) {
    throw new Error(
      "No instances to render and no background image provided"
    );
  }
  const width = opts.image?.width ?? opts.width ?? frameSize[0];
  const height = opts.image?.height ?? opts.height ?? frameSize[1];
  if (!width || !height) {
    throw new Error(
      "Cannot determine frame size. Provide image, width/height options, or ensure source has frame data."
    );
  }
  const scaledWidth = Math.round(width * opts.scale);
  const scaledHeight = Math.round(height * opts.scale);
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(scaledWidth, scaledHeight);
  const ctx = canvas.getContext("2d");
  if (opts.image) {
    ctx.putImageData(opts.image, 0, 0);
    if (opts.scale !== 1) {
      const tempCanvas = new Canvas(opts.image.width, opts.image.height);
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.putImageData(opts.image, 0, 0);
      ctx.clearRect(0, 0, scaledWidth, scaledHeight);
      ctx.drawImage(tempCanvas, 0, 0, scaledWidth, scaledHeight);
    }
  } else if (opts.background !== "transparent") {
    const bgColor = resolveColor(opts.background);
    ctx.fillStyle = rgbToCSS(bgColor);
    ctx.fillRect(0, 0, scaledWidth, scaledHeight);
  }
  const edgeInds = skeleton?.edgeIndices ?? [];
  const nodeNames = skeleton?.nodeNames ?? [];
  const hasTracks = instances.some((inst) => inst.track != null);
  const colorScheme = determineColorScheme(opts.colorBy, hasTracks, true);
  const colors = buildColorMap(
    colorScheme,
    instances,
    nodeNames.length,
    opts.palette,
    tracks
  );
  const renderCtx = new RenderContext(
    ctx,
    frameIdx,
    [width, height],
    instances,
    edgeInds,
    nodeNames,
    opts.scale,
    [0, 0]
  );
  if (opts.preRenderCallback) {
    opts.preRenderCallback(renderCtx);
  }
  const drawMarker = getMarkerFunction(opts.markerShape);
  const scaledMarkerSize = opts.markerSize * opts.scale;
  const scaledLineWidth = opts.lineWidth * opts.scale;
  for (let instIdx = 0; instIdx < instances.length; instIdx++) {
    const instance = instances[instIdx];
    const points = getInstancePoints(instance);
    const instanceColor = colors.instanceColors?.[instIdx] ?? colors.instanceColors?.[0] ?? DEFAULT_COLOR;
    if (opts.showEdges) {
      for (const [srcIdx, dstIdx] of edgeInds) {
        const srcPt = points[srcIdx];
        const dstPt = points[dstIdx];
        if (!srcPt || !dstPt) continue;
        const [x1, y1] = srcPt;
        const [x2, y2] = dstPt;
        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
          continue;
        }
        const edgeColor = colorScheme === "node" ? colors.nodeColors?.[dstIdx] ?? instanceColor : instanceColor;
        ctx.strokeStyle = rgbToCSS(edgeColor, opts.alpha);
        ctx.lineWidth = scaledLineWidth;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1 * opts.scale, y1 * opts.scale);
        ctx.lineTo(x2 * opts.scale, y2 * opts.scale);
        ctx.stroke();
      }
    }
    if (opts.showNodes) {
      for (let nodeIdx = 0; nodeIdx < points.length; nodeIdx++) {
        const pt = points[nodeIdx];
        if (!pt) continue;
        const [x, y] = pt;
        if (isNaN(x) || isNaN(y)) {
          continue;
        }
        const nodeColor = colorScheme === "node" ? colors.nodeColors?.[nodeIdx] ?? instanceColor : instanceColor;
        drawMarker(
          ctx,
          x * opts.scale,
          y * opts.scale,
          scaledMarkerSize,
          rgbToCSS(nodeColor, opts.alpha)
        );
      }
    }
    if (opts.perInstanceCallback) {
      const trackIdx = instance.track ? tracks.indexOf(instance.track) : null;
      const instCtx = new InstanceContext(
        ctx,
        instIdx,
        points,
        edgeInds,
        nodeNames,
        trackIdx !== -1 ? trackIdx : null,
        instance.track?.name ?? null,
        "score" in instance ? instance.score : null,
        opts.scale,
        [0, 0]
      );
      opts.perInstanceCallback(instCtx);
    }
  }
  if (opts.postRenderCallback) {
    opts.postRenderCallback(renderCtx);
  }
  return ctx.getImageData(0, 0, scaledWidth, scaledHeight);
}
function extractSourceData(source, options) {
  if (Array.isArray(source)) {
    const instances = source;
    const skeleton2 = instances.length > 0 ? instances[0].skeleton : null;
    const trackSet = /* @__PURE__ */ new Set();
    for (const inst of instances) {
      if (inst.track) trackSet.add(inst.track);
    }
    const tracks = Array.from(trackSet);
    return {
      instances,
      skeleton: skeleton2,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks
    };
  }
  if ("instances" in source && "frameIdx" in source && !("labeledFrames" in source)) {
    const frame = source;
    const skeleton2 = frame.instances.length > 0 ? frame.instances[0].skeleton : null;
    const trackSet = /* @__PURE__ */ new Set();
    for (const inst of frame.instances) {
      if (inst.track) trackSet.add(inst.track);
    }
    const tracks = Array.from(trackSet);
    let frameSize2 = [options.width ?? 0, options.height ?? 0];
    if (frame.video) {
      const video = frame.video;
      if ("width" in video && "height" in video) {
        const w = video.width;
        const h = video.height;
        if (w && h) {
          frameSize2 = [w, h];
        }
      }
    }
    return {
      instances: frame.instances,
      skeleton: skeleton2,
      frameSize: frameSize2,
      frameIdx: frame.frameIdx,
      tracks
    };
  }
  const labels = source;
  if (labels.labeledFrames.length === 0) {
    return {
      instances: [],
      skeleton: labels.skeletons?.[0] ?? null,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks: labels.tracks ?? []
    };
  }
  const firstFrame = labels.labeledFrames[0];
  const skeleton = labels.skeletons?.[0] ?? (firstFrame.instances.length > 0 ? firstFrame.instances[0].skeleton : null);
  let frameSize = [options.width ?? 0, options.height ?? 0];
  if (firstFrame.video) {
    const video = firstFrame.video;
    if ("width" in video && "height" in video) {
      const w = video.width;
      const h = video.height;
      if (w && h) {
        frameSize = [w, h];
      }
    }
  }
  return {
    instances: firstFrame.instances,
    skeleton,
    frameSize,
    frameIdx: firstFrame.frameIdx,
    tracks: labels.tracks ?? []
  };
}
function getInstancePoints(instance) {
  return instance.points.map((point) => [point.xy[0], point.xy[1]]);
}
function buildColorMap(scheme, instances, nNodes, paletteName, tracks) {
  switch (scheme) {
    case "instance":
      return {
        instanceColors: getPalette(
          paletteName,
          Math.max(1, instances.length)
        )
      };
    case "track": {
      const nTracks = Math.max(1, tracks.length);
      const trackPalette = getPalette(paletteName, nTracks);
      const instanceColors = instances.map((inst) => {
        if (inst.track) {
          const trackIdx = tracks.indexOf(inst.track);
          if (trackIdx >= 0) {
            return trackPalette[trackIdx % trackPalette.length];
          }
        }
        return trackPalette[0];
      });
      return { instanceColors };
    }
    case "node":
      return {
        instanceColors: getPalette(paletteName, 1),
        nodeColors: getPalette(paletteName, Math.max(1, nNodes))
      };
    default:
      return {
        instanceColors: getPalette(
          paletteName,
          Math.max(1, instances.length)
        )
      };
  }
}
async function toPNG(imageData) {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("png");
}
async function toJPEG(imageData, quality = 0.9) {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("jpeg", { quality });
}
async function toDataURL(imageData, format = "png") {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL(`image/${format}`);
}
async function saveImage(imageData, path) {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  await canvas.saveAs(path);
}

// src/rendering/video.ts
async function checkFfmpeg() {
  const { spawn } = await import("child_process");
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}
async function renderVideo(source, outputPath, options = {}) {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    throw new Error(
      "ffmpeg not found. Please install ffmpeg and ensure it is in your PATH.\nInstallation: https://ffmpeg.org/download.html"
    );
  }
  const frames = Array.isArray(source) ? source : source.labeledFrames;
  let selectedFrames = frames;
  if (options.frameInds) {
    selectedFrames = options.frameInds.map((i) => frames[i]).filter((f) => f !== void 0);
  } else if (options.start !== void 0 || options.end !== void 0) {
    const start = options.start ?? 0;
    const end = options.end ?? frames.length;
    selectedFrames = frames.slice(start, end);
  }
  if (selectedFrames.length === 0) {
    throw new Error("No frames to render");
  }
  const firstImage = await renderImage(selectedFrames[0], options);
  const width = firstImage.width;
  const height = firstImage.height;
  const fps = options.fps ?? 30;
  const codec = options.codec ?? "libx264";
  const crf = options.crf ?? 25;
  const preset = options.preset ?? "superfast";
  const ffmpegArgs = [
    "-y",
    // Overwrite output
    "-f",
    "rawvideo",
    // Input format
    "-pix_fmt",
    "rgba",
    // Input pixel format
    "-s",
    `${width}x${height}`,
    // Frame size
    "-r",
    String(fps),
    // Frame rate
    "-i",
    "pipe:0",
    // Read from stdin
    "-c:v",
    codec,
    // Video codec
    "-pix_fmt",
    "yuv420p"
    // Output pixel format
  ];
  if (codec === "libx264") {
    ffmpegArgs.push("-crf", String(crf), "-preset", preset);
  }
  ffmpegArgs.push(outputPath);
  const { spawn } = await import("child_process");
  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let ffmpegError = null;
  ffmpeg.on("error", (err) => {
    ffmpegError = err;
  });
  const total = selectedFrames.length;
  for (let i = 0; i < selectedFrames.length; i++) {
    if (ffmpegError) {
      throw ffmpegError;
    }
    const frame = selectedFrames[i];
    const imageData = await renderImage(frame, options);
    const buffer = Buffer.from(imageData.data.buffer);
    if (!ffmpeg.stdin) {
      throw new Error("ffmpeg stdin not available");
    }
    const canWrite = ffmpeg.stdin.write(buffer);
    if (!canWrite) {
      await new Promise(
        (resolve) => ffmpeg.stdin?.once("drain", resolve)
      );
    }
    if (options.onProgress) {
      options.onProgress(i + 1, total);
    }
  }
  ffmpeg.stdin?.end();
  return new Promise((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);
  });
}
export {
  AnnotationType,
  Camera,
  CameraGroup,
  Edge,
  FrameGroup,
  Instance,
  InstanceContext,
  InstanceGroup,
  LabeledFrame,
  Labels,
  LabelsSet,
  LazyDataStore,
  LazyFrameList,
  MARKER_FUNCTIONS,
  Mp4BoxVideoBackend,
  NAMED_COLORS,
  Node,
  PALETTES,
  PredictedInstance,
  ROI,
  RecordingSession,
  RenderContext,
  SegmentationMask,
  Skeleton,
  StreamingH5File,
  StreamingHdf5VideoBackend,
  SuggestionFrame,
  Symmetry,
  Track,
  Video,
  _registerMaskFactory,
  checkFfmpeg,
  decodeRle,
  decodeWkb,
  decodeYamlSkeleton,
  determineColorScheme,
  drawCircle,
  drawCross,
  drawDiamond,
  drawSquare,
  drawTriangle,
  encodeRle,
  encodeWkb,
  encodeYamlSkeleton,
  fromDict,
  fromNumpy,
  getMarkerFunction,
  getPalette,
  isStreamingSupported,
  isTrainingConfig,
  labelsFromNumpy,
  loadSlp,
  loadSlpSet,
  loadVideo,
  makeCameraFromDict,
  openH5Worker,
  openStreamingH5,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict,
  rasterizeGeometry,
  readSkeletonJson,
  readSlpStreaming,
  readTrainingConfigSkeleton,
  readTrainingConfigSkeletons,
  renderImage,
  renderVideo,
  resolveColor,
  rgbToCSS,
  rodriguesTransformation,
  saveImage,
  saveSlp,
  saveSlpSet,
  saveSlpToBytes,
  toDataURL,
  toDict,
  toJPEG,
  toNumpy,
  toPNG
};
