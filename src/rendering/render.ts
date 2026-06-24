// src/rendering/render.ts

import type { Labels } from "../model/labels.js";
import type { LabeledFrame } from "../model/labeled-frame.js";
import type { Instance, PredictedInstance, Track } from "../model/instance.js";
import type { Skeleton } from "../model/skeleton.js";
import type {
  RenderOptions,
  RGB,
  ColorScheme,
  PaletteName,
  Overlay,
} from "./types.js";
import {
  getPalette,
  resolveColor,
  rgbToCSS,
  determineColorScheme,
  PALETTES,
} from "./colors.js";
import { getMarkerFunction, drawTrails } from "./shapes.js";
import type { DrawTrailsOptions } from "./shapes.js";
import {
  resolveTrailNode,
  computeTrails,
  nTrailPaletteColors,
  collectTracks,
} from "./trails.js";
import { RenderContext, InstanceContext } from "./context.js";
import { applyOverlay } from "./overlays.js";

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
    | "trailFrames"
    | "trailTracks"
    | "trailPtsCache"
    // `overlay` is absence-checked (undefined = no overlay), so it has no
    // default value; `overlayOutlineColor` is null by default below.
    | "overlay"
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
  // Motion trails (off by default; appearance-neutral when enabled).
  showTrails: false,
  trailLength: 10,
  trailNode: "centroid",
  trailWidth: 2,
  trailAlphaFade: true,
  trailAlpha: 1,
  trailColor: null,
  // Segmentation / annotation overlay (off by default). Mirrors Python
  // render_image overlay params (overlay=None, overlay_alpha=0.3, etc.).
  overlayAlpha: 0.3,
  overlayPalette: "distinct",
  overlayOutline: false,
  overlayOutlineWidth: 1,
  overlayOutlineColor: null,
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
  trackIndexMap: Map<Track, number>;
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
  options: RenderOptions = {},
): Promise<ImageData> {
  // Merge with defaults
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Extract instances and metadata from source
  const { instances, skeleton, frameSize, frameIdx, tracks, trackIndexMap } =
    extractSourceData(source, opts);

  // Auto-use the frame's segmentation masks as the overlay when no explicit
  // overlay is given and the frame carries masks. Mirrors Python render_image
  // (core.py L1142-1156): a segmentation-only frame still draws its masks. Only
  // masks are auto-resolved here (not label images), and an explicit overlay
  // always wins.
  let effectiveOverlay: Overlay | undefined = opts.overlay ?? undefined;
  if (effectiveOverlay == null && !Array.isArray(source)) {
    const renderedFrame = renderedLabeledFrame(source);
    if (renderedFrame && renderedFrame.masks.length > 0) {
      effectiveOverlay = [...renderedFrame.masks];
    }
  }

  // Motion trails can contribute frames even when the current frame is empty
  // (past frames supply the trail), so they relax the "nothing to render" guard
  // for a Labels / LabeledFrame source. Mirrors Python PR #434.
  const trailsPossible =
    opts.showTrails && opts.trailLength > 0 && !Array.isArray(source);

  if (
    instances.length === 0 &&
    !opts.image &&
    !hasNonInstanceAnnotations(source) &&
    !trailsPossible
  ) {
    throw new Error("No instances to render and no background image provided");
  }

  // Determine frame dimensions
  const width = opts.image?.width ?? opts.width ?? frameSize[0];
  const height = opts.image?.height ?? opts.height ?? frameSize[1];

  if (!width || !height) {
    throw new Error(
      "Cannot determine frame size. Provide image, width/height options, or ensure source has frame data.",
    );
  }

  // Create canvas
  const scaledWidth = Math.round(width * opts.scale);
  const scaledHeight = Math.round(height * opts.scale);
  const { Canvas } = await import("skia-canvas");
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

  // Determine the color scheme up front (hoisted above the overlay block so
  // track-colored overlays can match the pose/centroid/trail track colors).
  // Mirrors Python render_image (core.py L1183-1187, PR #470). `hasTracks` is
  // instance-based here (consistent with the existing pose path); the overlay
  // track-color gate below additionally requires a Labels source with tracks.
  const hasTracks = instances.some((inst) => inst.track != null);
  const colorScheme = determineColorScheme(opts.colorBy, hasTracks, true);

  // Apply the annotation overlay AFTER the background and BEFORE trails/poses,
  // mirroring Python render_image (core.py L1159-1180: overlay applied on the
  // base frame, before trails/centroids/poses).
  //
  // Scale handling: overlay annotation coordinates (mask/label-image pixels,
  // bbox corners, ROI geometry) are in SOURCE pixels. Python applies the
  // overlay to the un-scaled base frame and then scales the whole result, so
  // poses (drawn here at `x * scale`) stay aligned with the overlay. We
  // replicate that equivalent: read the canvas at source resolution, blend the
  // overlay in source space, then scale-composite back onto the (possibly
  // scaled) canvas. When `scale === 1` this is an in-place read/blend/write.
  if (effectiveOverlay !== undefined && effectiveOverlay !== null) {
    // Color overlay elements (masks/ROIs/bboxes) by track identity when
    // color_by resolves to "track", matching poses/centroids/trails (same
    // `palette`). Otherwise fall through to positional `overlayPalette`
    // coloring. Gated on a Labels source with tracks (track-less labels stay
    // positional, mirroring Python `has_tracks` at render_video level). A
    // single LabelImage overlay is not an array, so label images are skipped.
    // Untracked elements fall back to the first palette color. Mirrors Python
    // render_image (core.py L1216-1239, PR #470).
    let overlayColors: RGB[] | null = null;
    if (
      colorScheme === "track" &&
      !Array.isArray(source) &&
      "labeledFrames" in source &&
      tracks.length > 0 &&
      Array.isArray(effectiveOverlay) &&
      effectiveOverlay.length > 0
    ) {
      const ovPal = getPalette(
        opts.palette as PaletteName,
        Math.max(tracks.length, 1),
      );
      overlayColors = (effectiveOverlay as { track?: Track | null }[]).map(
        (el) => {
          const tidx = el.track ? trackIndexMap.get(el.track) : undefined;
          return tidx !== undefined ? ovPal[tidx % ovPal.length] : ovPal[0];
        },
      );
    }
    const overlayOpts = {
      alpha: opts.overlayAlpha,
      palette: opts.overlayPalette,
      outline: opts.overlayOutline,
      outlineWidth: opts.overlayOutlineWidth,
      outlineColor: opts.overlayOutlineColor,
      colors: overlayColors,
    };
    if (opts.scale === 1) {
      // Fast path: blend directly on the scaled canvas (== source resolution).
      const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
      applyOverlay(
        imageData as unknown as ImageData,
        effectiveOverlay,
        overlayOpts,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.putImageData(imageData as any, 0, 0);
    } else {
      // Scaled path: render the current background at source resolution onto a
      // temporary canvas, blend the overlay there (source-pixel coords), then
      // draw it scaled onto the main canvas so it lines up with the poses.
      const srcCanvas = new Canvas(width, height);
      const srcCtx = srcCanvas.getContext("2d");
      // Downscale the already-drawn (scaled) background into source space.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srcCtx.drawImage(canvas as any, 0, 0, width, height);
      const imageData = srcCtx.getImageData(0, 0, width, height);
      applyOverlay(
        imageData as unknown as ImageData,
        effectiveOverlay,
        overlayOpts,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srcCtx.putImageData(imageData as any, 0, 0);
      ctx.clearRect(0, 0, scaledWidth, scaledHeight);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.drawImage(srcCanvas as any, 0, 0, scaledWidth, scaledHeight);
    }
  }

  // Get skeleton info
  const edgeInds = skeleton?.edgeIndices ?? [];
  const nodeNames = skeleton?.nodeNames ?? [];

  // Build color map
  const colors = buildColorMap(
    colorScheme,
    instances,
    nodeNames.length,
    opts.palette,
    tracks,
    trackIndexMap,
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
    [0, 0],
  );

  // Pre-render callback
  if (opts.preRenderCallback) {
    opts.preRenderCallback(renderCtx);
  }

  // Draw motion trails behind the poses. Trails need temporal context, so they
  // are only drawn for a Labels source (siblings come from `find`) or when the
  // caller passes `trailFrames`; they are skipped for an instance-list source.
  if (trailsPossible) {
    const labelsFrame = source as Labels | LabeledFrame;
    const framesByIdx = resolveTrailFrames(
      labelsFrame,
      frameIdx,
      options.trailFrames,
    );
    // The current frame may be empty, so fall back to a skeleton from the trail
    // context for resolving node-name targets.
    const trailSkeleton = skeleton ?? firstSkeletonIn(framesByIdx);
    if (framesByIdx && framesByIdx.size > 0 && trailSkeleton) {
      // Key/color trails off the project track list (matches Python keying off
      // `Labels.tracks`): full list for a Labels source, the caller-provided
      // `trailTracks`, or the tracks discovered in the trail context.
      const trailTracks =
        "labeledFrames" in labelsFrame
          ? labelsFrame.tracks
          : (options.trailTracks ?? collectTracks(framesByIdx.values()));
      const trailHasTracks = trailTracks.length > 0;
      const trailTrackIndexMap = new Map(trailTracks.map((t, i) => [t, i]));
      const nColors = nTrailPaletteColors(
        trailHasTracks,
        trailTracks.length,
        framesByIdx.values(),
      );
      const trailPalette = getPalette(opts.palette as PaletteName, nColors);
      const trailTargets = resolveTrailNode(opts.trailNode, trailSkeleton);
      const { trails, colors: trailColors } = computeTrails({
        frameIdx,
        frameIdxToLf: framesByIdx,
        trailLength: opts.trailLength,
        trailTargets,
        trackIndexMap: trailTrackIndexMap,
        paletteColors: trailPalette,
        hasTracks: trailHasTracks,
        ptsCache: options.trailPtsCache,
      });
      if (trails.length > 0) {
        const trailDrawOpts: DrawTrailsOptions = {
          lineWidth: opts.trailWidth,
          alphaFade: opts.trailAlphaFade,
          alpha: opts.trailAlpha,
          scale: opts.scale,
          offset: [0, 0],
        };
        // A uniform trailColor overrides the per-track palette colors.
        if (opts.trailColor != null) {
          trailDrawOpts.color = resolveColor(opts.trailColor);
        } else {
          trailDrawOpts.colors = trailColors;
        }
        drawTrails(
          ctx as unknown as CanvasRenderingContext2D,
          trails,
          trailDrawOpts,
        );
      }
    }
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
            ? (colors.nodeColors?.[dstIdx] ?? instanceColor)
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
            ? (colors.nodeColors?.[nodeIdx] ?? instanceColor)
            : instanceColor;

        drawMarker(
          ctx as unknown as CanvasRenderingContext2D,
          x * opts.scale,
          y * opts.scale,
          scaledMarkerSize,
          rgbToCSS(nodeColor, opts.alpha),
        );
      }
    }

    // Per-instance callback
    if (opts.perInstanceCallback) {
      const trackIdx = instance.track
        ? (trackIndexMap.get(instance.track) ?? null)
        : null;
      const instCtx = new InstanceContext(
        ctx as unknown as CanvasRenderingContext2D,
        instIdx,
        points,
        edgeInds,
        nodeNames,
        trackIdx,
        instance.track?.name ?? null,
        "score" in instance ? (instance as PredictedInstance).score : null,
        opts.scale,
        [0, 0],
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
  return ctx.getImageData(
    0,
    0,
    scaledWidth,
    scaledHeight,
  ) as unknown as ImageData;
}

/**
 * The single `LabeledFrame` that `renderImage` renders for a non-array source:
 * the `LabeledFrame` itself, or a `Labels`' first labeled frame. Used to
 * auto-resolve that frame's segmentation masks as the overlay. Returns
 * `undefined` for an empty `Labels`.
 */
function renderedLabeledFrame(
  source: Labels | LabeledFrame,
): LabeledFrame | undefined {
  if ("labeledFrames" in source) {
    return (source as Labels).labeledFrames[0];
  }
  return source as LabeledFrame;
}

/**
 * Whether `source` carries non-instance annotations (label images, masks,
 * bboxes, rois, centroids) that should keep renderImage from throwing even
 * when there are no instances. For Labels, checks the first labeled frame.
 *
 * Mirrors Python sleap-io PR #420: renderImage(source=lf) must work on
 * segmentation-only LabeledFrames. The actual overlay rendering of these
 * annotations is tracked in issue #96 — this hook is the single place to
 * extend when that lands.
 */
function hasNonInstanceAnnotations(
  source: Labels | LabeledFrame | (Instance | PredictedInstance)[],
): boolean {
  if (Array.isArray(source)) return false;
  const lf: LabeledFrame | undefined =
    "labeledFrames" in source
      ? (source as Labels).labeledFrames[0]
      : (source as LabeledFrame);
  if (!lf) return false;
  return (
    (lf.labelImages?.length ?? 0) > 0 ||
    (lf.masks?.length ?? 0) > 0 ||
    (lf.bboxes?.length ?? 0) > 0 ||
    (lf.rois?.length ?? 0) > 0 ||
    (lf.centroids?.length ?? 0) > 0
  );
}

/**
 * Resolve the temporal frame context used to compute motion trails.
 *
 * - For a `Labels` source, gathers all labeled frames of the rendered video
 *   (the frame at `labeledFrames[0]`), keyed by frame index.
 * - For a `LabeledFrame` source, uses the caller-supplied `trailFrames` (a `Map`
 *   keyed by frame index, or an array), falling back to just the rendered frame
 *   when no context is provided.
 *
 * Returns `null` when there is no usable context (e.g. an empty `Labels`).
 */
function resolveTrailFrames(
  source: Labels | LabeledFrame,
  frameIdx: number,
  trailFrames?: LabeledFrame[] | Map<number, LabeledFrame>,
): Map<number, LabeledFrame> | null {
  if ("labeledFrames" in source) {
    const rendered = source.labeledFrames[0];
    if (!rendered) return null;
    const map = new Map<number, LabeledFrame>();
    for (const lf of source.find({ video: rendered.video })) {
      map.set(lf.frameIdx, lf);
    }
    return map;
  }
  if (trailFrames instanceof Map) return trailFrames;
  if (Array.isArray(trailFrames)) {
    const map = new Map<number, LabeledFrame>();
    for (const lf of trailFrames) map.set(lf.frameIdx, lf);
    return map;
  }
  return new Map([[frameIdx, source]]);
}

/** First instance skeleton found across the trail context frames, or `null`. */
function firstSkeletonIn(
  framesByIdx: Map<number, LabeledFrame> | null,
): Skeleton | null {
  if (!framesByIdx) return null;
  for (const lf of framesByIdx.values()) {
    if (lf.instances.length > 0) return lf.instances[0].skeleton;
  }
  return null;
}

/**
 * Extract instances, skeleton, and frame info from various source types.
 */
function extractSourceData(
  source: Labels | LabeledFrame | (Instance | PredictedInstance)[],
  options: RenderOptions,
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
    const trackIndexMap = new Map<Track, number>();
    tracks.forEach((t, i) => {
      trackIndexMap.set(t, i);
    });

    return {
      instances,
      skeleton,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks,
      trackIndexMap,
    };
  }

  // Case 2: LabeledFrame
  if (
    "instances" in source &&
    "frameIdx" in source &&
    !("labeledFrames" in source)
  ) {
    const frame = source as LabeledFrame;
    const skeleton =
      frame.instances.length > 0 ? frame.instances[0].skeleton : null;

    // Collect unique tracks
    const trackSet = new Set<Track>();
    for (const inst of frame.instances) {
      if (inst.track) trackSet.add(inst.track);
    }
    const tracks = Array.from(trackSet);
    const trackIndexMap = new Map<Track, number>();
    tracks.forEach((t, i) => {
      trackIndexMap.set(t, i);
    });

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
      trackIndexMap,
    };
  }

  // Case 3: Labels - use first labeled frame
  const labels = source as Labels;
  if (labels.labeledFrames.length === 0) {
    const tracks = labels.tracks ?? [];
    const trackIndexMap = new Map<Track, number>();
    tracks.forEach((t, i) => {
      trackIndexMap.set(t, i);
    });
    return {
      instances: [],
      skeleton: labels.skeletons?.[0] ?? null,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks,
      trackIndexMap,
    };
  }

  const firstFrame = labels.labeledFrames[0];
  const skeleton =
    labels.skeletons?.[0] ??
    (firstFrame.instances.length > 0 ? firstFrame.instances[0].skeleton : null);

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

  const tracks = labels.tracks ?? [];
  const trackIndexMap = new Map<Track, number>();
  tracks.forEach((t, i) => {
    trackIndexMap.set(t, i);
  });

  return {
    instances: firstFrame.instances,
    skeleton,
    frameSize,
    frameIdx: firstFrame.frameIdx,
    tracks,
    trackIndexMap,
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
  tracks: Track[],
  trackIndexMap: Map<Track, number>,
): { instanceColors?: RGB[]; nodeColors?: RGB[] } {
  switch (scheme) {
    case "instance":
      return {
        instanceColors: getPalette(
          paletteName as PaletteName,
          Math.max(1, instances.length),
        ),
      };

    case "track": {
      // Assign colors based on track index (O(1) Map lookup)
      const nTracks = Math.max(1, tracks.length);
      const trackPalette = getPalette(paletteName as PaletteName, nTracks);

      const instanceColors = instances.map((inst) => {
        if (inst.track) {
          const trackIdx = trackIndexMap.get(inst.track);
          if (trackIdx !== undefined) {
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
          Math.max(1, instances.length),
        ),
      };
  }
}

// Export utilities

/**
 * Convert ImageData to PNG buffer (Node.js only).
 */
export async function toPNG(imageData: ImageData): Promise<Buffer> {
  const { Canvas } = await import("skia-canvas");
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
  quality: number = 0.9,
): Promise<Buffer> {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(imageData as any, 0, 0);
  return canvas.toBuffer("jpeg", { quality });
}

/**
 * Convert ImageData to data URL.
 */
export async function toDataURL(
  imageData: ImageData,
  format: "png" | "jpeg" = "png",
): Promise<string> {
  const { Canvas } = await import("skia-canvas");
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
  path: string,
): Promise<void> {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.putImageData(imageData as any, 0, 0);
  // Use saveAs which is the recommended way in skia-canvas
  await canvas.saveAs(path);
}
