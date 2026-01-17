// src/rendering/render.ts

import { Canvas } from "skia-canvas";
import type { Labels } from "../model/labels.js";
import type { LabeledFrame } from "../model/labeled-frame.js";
import type { Instance, PredictedInstance, Track } from "../model/instance.js";
import type { Skeleton } from "../model/skeleton.js";
import type { RenderOptions, RGB, ColorScheme, PaletteName } from "./types.js";
import {
  getPalette,
  resolveColor,
  rgbToCSS,
  determineColorScheme,
  PALETTES,
} from "./colors.js";
import { getMarkerFunction } from "./shapes.js";
import { RenderContext, InstanceContext } from "./context.js";

// Default options
const DEFAULT_OPTIONS: Required<
  Omit<
    RenderOptions,
    | "image"
    | "preRenderCallback"
    | "postRenderCallback"
    | "perInstanceCallback"
    | "width"
    | "height"
  >
> = {
  colorBy: "auto",
  palette: "standard",
  markerShape: "circle",
  markerSize: 4,
  lineWidth: 2,
  alpha: 1,
  showNodes: true,
  showEdges: true,
  scale: 1,
  background: "transparent",
};

/** Default fallback color */
const DEFAULT_COLOR: RGB = PALETTES.standard[0];

/** Extracted data from source for rendering */
interface SourceData {
  instances: (Instance | PredictedInstance)[];
  skeleton: Skeleton | null;
  frameSize: [number, number];
  frameIdx: number;
  tracks: Track[];
}

/**
 * Render poses on a single frame.
 *
 * @param source - Labels, LabeledFrame, or array of Instances to render
 * @param options - Rendering options
 * @returns ImageData with rendered poses
 */
export async function renderImage(
  source: Labels | LabeledFrame | (Instance | PredictedInstance)[],
  options: RenderOptions = {}
): Promise<ImageData> {
  // Merge with defaults
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Extract instances and metadata from source
  const { instances, skeleton, frameSize, frameIdx, tracks } =
    extractSourceData(source, opts);

  if (instances.length === 0 && !opts.image) {
    throw new Error(
      "No instances to render and no background image provided"
    );
  }

  // Determine frame dimensions
  const width = opts.image?.width ?? opts.width ?? frameSize[0];
  const height = opts.image?.height ?? opts.height ?? frameSize[1];

  if (!width || !height) {
    throw new Error(
      "Cannot determine frame size. Provide image, width/height options, or ensure source has frame data."
    );
  }

  // Create canvas
  const scaledWidth = Math.round(width * opts.scale);
  const scaledHeight = Math.round(height * opts.scale);
  const canvas = new Canvas(scaledWidth, scaledHeight);
  const ctx = canvas.getContext("2d");

  // Draw background
  if (opts.image) {
    // Draw provided image, scaled
    // Cast to any to work around skia-canvas ImageData type differences
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.putImageData(opts.image as any, 0, 0);
    if (opts.scale !== 1) {
      // If scaling, we need to redraw
      const tempCanvas = new Canvas(opts.image.width, opts.image.height);
      const tempCtx = tempCanvas.getContext("2d");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tempCtx.putImageData(opts.image as any, 0, 0);
      ctx.clearRect(0, 0, scaledWidth, scaledHeight);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.drawImage(tempCanvas as any, 0, 0, scaledWidth, scaledHeight);
    }
  } else if (opts.background !== "transparent") {
    const bgColor = resolveColor(opts.background);
    ctx.fillStyle = rgbToCSS(bgColor);
    ctx.fillRect(0, 0, scaledWidth, scaledHeight);
  }

  // Get skeleton info
  const edgeInds = skeleton?.edgeIndices ?? [];
  const nodeNames = skeleton?.nodeNames ?? [];

  // Determine color scheme
  const hasTracks = instances.some((inst) => inst.track != null);
  const colorScheme = determineColorScheme(opts.colorBy, hasTracks, true);

  // Build color map
  const colors = buildColorMap(
    colorScheme,
    instances,
    nodeNames.length,
    opts.palette,
    tracks
  );

  // Create render context for callbacks
  // Cast ctx to CanvasRenderingContext2D for compatibility
  const renderCtx = new RenderContext(
    ctx as unknown as CanvasRenderingContext2D,
    frameIdx,
    [width, height],
    instances,
    edgeInds,
    nodeNames,
    opts.scale,
    [0, 0]
  );

  // Pre-render callback
  if (opts.preRenderCallback) {
    opts.preRenderCallback(renderCtx);
  }

  // Render each instance
  const drawMarker = getMarkerFunction(opts.markerShape);
  const scaledMarkerSize = opts.markerSize * opts.scale;
  const scaledLineWidth = opts.lineWidth * opts.scale;

  for (let instIdx = 0; instIdx < instances.length; instIdx++) {
    const instance = instances[instIdx];
    const points = getInstancePoints(instance);

    // Get colors for this instance (with fallback to default)
    const instanceColor: RGB =
      colors.instanceColors?.[instIdx] ??
      colors.instanceColors?.[0] ??
      DEFAULT_COLOR;

    // Draw edges first (so nodes appear on top)
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

        // Edge color: use node color for 'node' scheme, else instance color
        const edgeColor: RGB =
          colorScheme === "node"
            ? colors.nodeColors?.[dstIdx] ?? instanceColor
            : instanceColor;

        ctx.strokeStyle = rgbToCSS(edgeColor, opts.alpha);
        ctx.lineWidth = scaledLineWidth;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(x1 * opts.scale, y1 * opts.scale);
        ctx.lineTo(x2 * opts.scale, y2 * opts.scale);
        ctx.stroke();
      }
    }

    // Draw nodes
    if (opts.showNodes) {
      for (let nodeIdx = 0; nodeIdx < points.length; nodeIdx++) {
        const pt = points[nodeIdx];
        if (!pt) continue;

        const [x, y] = pt;

        if (isNaN(x) || isNaN(y)) {
          continue;
        }

        const nodeColor: RGB =
          colorScheme === "node"
            ? colors.nodeColors?.[nodeIdx] ?? instanceColor
            : instanceColor;

        drawMarker(
          ctx as unknown as CanvasRenderingContext2D,
          x * opts.scale,
          y * opts.scale,
          scaledMarkerSize,
          rgbToCSS(nodeColor, opts.alpha)
        );
      }
    }

    // Per-instance callback
    if (opts.perInstanceCallback) {
      const trackIdx = instance.track
        ? tracks.indexOf(instance.track)
        : null;
      const instCtx = new InstanceContext(
        ctx as unknown as CanvasRenderingContext2D,
        instIdx,
        points,
        edgeInds,
        nodeNames,
        trackIdx !== -1 ? trackIdx : null,
        instance.track?.name ?? null,
        "score" in instance ? (instance as PredictedInstance).score : null,
        opts.scale,
        [0, 0]
      );
      opts.perInstanceCallback(instCtx);
    }
  }

  // Post-render callback
  if (opts.postRenderCallback) {
    opts.postRenderCallback(renderCtx);
  }

  // Return ImageData
  // Cast to standard ImageData for compatibility
  return ctx.getImageData(0, 0, scaledWidth, scaledHeight) as unknown as ImageData;
}

/**
 * Extract instances, skeleton, and frame info from various source types.
 */
function extractSourceData(
  source: Labels | LabeledFrame | (Instance | PredictedInstance)[],
  options: RenderOptions
): SourceData {
  // Case 1: Array of Instances
  if (Array.isArray(source)) {
    const instances = source;
    const skeleton = instances.length > 0 ? instances[0].skeleton : null;

    // Collect unique tracks
    const trackSet = new Set<Track>();
    for (const inst of instances) {
      if (inst.track) trackSet.add(inst.track);
    }
    const tracks = Array.from(trackSet);

    return {
      instances,
      skeleton,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks,
    };
  }

  // Case 2: LabeledFrame
  if ("instances" in source && "frameIdx" in source && !("labeledFrames" in source)) {
    const frame = source as LabeledFrame;
    const skeleton =
      frame.instances.length > 0 ? frame.instances[0].skeleton : null;

    // Collect unique tracks
    const trackSet = new Set<Track>();
    for (const inst of frame.instances) {
      if (inst.track) trackSet.add(inst.track);
    }
    const tracks = Array.from(trackSet);

    // Try to get video dimensions
    let frameSize: [number, number] = [options.width ?? 0, options.height ?? 0];
    if (frame.video) {
      const video = frame.video;
      if ("width" in video && "height" in video) {
        const w = (video as { width?: number }).width;
        const h = (video as { height?: number }).height;
        if (w && h) {
          frameSize = [w, h];
        }
      }
    }

    return {
      instances: frame.instances,
      skeleton,
      frameSize,
      frameIdx: frame.frameIdx,
      tracks,
    };
  }

  // Case 3: Labels - use first labeled frame
  const labels = source as Labels;
  if (labels.labeledFrames.length === 0) {
    return {
      instances: [],
      skeleton: labels.skeletons?.[0] ?? null,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks: labels.tracks ?? [],
    };
  }

  const firstFrame = labels.labeledFrames[0];
  const skeleton =
    labels.skeletons?.[0] ??
    (firstFrame.instances.length > 0
      ? firstFrame.instances[0].skeleton
      : null);

  // Try to get video dimensions
  let frameSize: [number, number] = [options.width ?? 0, options.height ?? 0];
  if (firstFrame.video) {
    const video = firstFrame.video;
    if ("width" in video && "height" in video) {
      const w = (video as { width?: number }).width;
      const h = (video as { height?: number }).height;
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
    tracks: labels.tracks ?? [],
  };
}

/**
 * Extract point coordinates from an instance.
 * Returns array of [x, y] pairs.
 */
function getInstancePoints(instance: Instance | PredictedInstance): number[][] {
  return instance.points.map((point) => [point.xy[0], point.xy[1]]);
}

/**
 * Build color maps based on color scheme.
 */
function buildColorMap(
  scheme: ColorScheme,
  instances: (Instance | PredictedInstance)[],
  nNodes: number,
  paletteName: string,
  tracks: Track[]
): { instanceColors?: RGB[]; nodeColors?: RGB[] } {
  switch (scheme) {
    case "instance":
      return {
        instanceColors: getPalette(
          paletteName as PaletteName,
          Math.max(1, instances.length)
        ),
      };

    case "track": {
      // Assign colors based on track index
      const nTracks = Math.max(1, tracks.length);
      const trackPalette = getPalette(paletteName as PaletteName, nTracks);

      const instanceColors = instances.map((inst) => {
        if (inst.track) {
          const trackIdx = tracks.indexOf(inst.track);
          if (trackIdx >= 0) {
            return trackPalette[trackIdx % trackPalette.length];
          }
        }
        // Fallback to first color for untracked instances
        return trackPalette[0];
      });

      return { instanceColors };
    }

    case "node":
      return {
        instanceColors: getPalette(paletteName as PaletteName, 1),
        nodeColors: getPalette(paletteName as PaletteName, Math.max(1, nNodes)),
      };

    default:
      // 'auto' should have been resolved by now, but fallback to instance
      return {
        instanceColors: getPalette(
          paletteName as PaletteName,
          Math.max(1, instances.length)
        ),
      };
  }
}

// Export utilities

/**
 * Convert ImageData to PNG buffer (Node.js only).
 */
export async function toPNG(imageData: ImageData): Promise<Buffer> {
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(imageData as any, 0, 0);
  return canvas.toBuffer("png");
}

/**
 * Convert ImageData to JPEG buffer (Node.js only).
 */
export async function toJPEG(
  imageData: ImageData,
  quality: number = 0.9
): Promise<Buffer> {
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(imageData as any, 0, 0);
  return canvas.toBuffer("jpeg", { quality });
}

/**
 * Convert ImageData to data URL.
 */
export function toDataURL(
  imageData: ImageData,
  format: "png" | "jpeg" = "png"
): string {
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(imageData as any, 0, 0);
  // Use toDataURL (now synchronous in skia-canvas v3)
  // Cast format to work around skia-canvas type definitions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return canvas.toDataURL(`image/${format}` as any);
}

/**
 * Save ImageData to a file.
 */
export async function saveImage(
  imageData: ImageData,
  path: string
): Promise<void> {
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(imageData as any, 0, 0);
  // Use saveAs which is the recommended way in skia-canvas
  await canvas.saveAs(path);
}
