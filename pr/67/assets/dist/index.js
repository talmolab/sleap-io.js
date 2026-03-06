import {
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
  RecordingSession,
  RenderContext,
  StreamingH5File,
  StreamingHdf5VideoBackend,
  SuggestionFrame,
  Video,
  decodeYamlSkeleton,
  determineColorScheme,
  drawCircle,
  drawCross,
  drawDiamond,
  drawSquare,
  drawTriangle,
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
} from "./chunk-Q3IADGC5.js";
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

// src/model/roi.ts
var _maskFactory = null;
function _registerMaskFactory(factory) {
  _maskFactory = factory;
}
var AnnotationType = /* @__PURE__ */ ((AnnotationType2) => {
  AnnotationType2[AnnotationType2["DEFAULT"] = 0] = "DEFAULT";
  AnnotationType2[AnnotationType2["BOUNDING_BOX"] = 1] = "BOUNDING_BOX";
  AnnotationType2[AnnotationType2["SEGMENTATION"] = 2] = "SEGMENTATION";
  AnnotationType2[AnnotationType2["ARENA"] = 3] = "ARENA";
  AnnotationType2[AnnotationType2["ANCHOR"] = 4] = "ANCHOR";
  return AnnotationType2;
})(AnnotationType || {});
var ROI = class _ROI {
  geometry;
  annotationType;
  name;
  category;
  score;
  source;
  video;
  frameIdx;
  track;
  instance;
  constructor(options) {
    this.geometry = options.geometry;
    this.annotationType = options.annotationType ?? 0 /* DEFAULT */;
    this.name = options.name ?? "";
    this.category = options.category ?? "";
    this.score = options.score ?? null;
    this.source = options.source ?? "";
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.track = options.track ?? null;
    this.instance = options.instance ?? null;
  }
  static fromBbox(x, y, width, height, options) {
    const geometry = {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + width, y],
          [x + width, y + height],
          [x, y + height],
          [x, y]
        ]
      ]
    };
    return new _ROI({
      geometry,
      annotationType: 1 /* BOUNDING_BOX */,
      ...options
    });
  }
  static fromXyxy(x1, y1, x2, y2, options) {
    const geometry = {
      type: "Polygon",
      coordinates: [
        [
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
          [x1, y1]
        ]
      ]
    };
    return new _ROI({
      geometry,
      annotationType: 1 /* BOUNDING_BOX */,
      ...options
    });
  }
  static fromPolygon(coords, options) {
    const ring = [...coords];
    if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push([ring[0][0], ring[0][1]]);
    }
    const geometry = { type: "Polygon", coordinates: [ring] };
    return new _ROI({
      geometry,
      annotationType: 2 /* SEGMENTATION */,
      ...options
    });
  }
  get isPredicted() {
    return this.score !== null;
  }
  get isStatic() {
    return this.frameIdx === null;
  }
  get isBbox() {
    if (this.geometry.type !== "Polygon") return false;
    const coords = this.geometry.coordinates[0];
    if (!coords || coords.length !== 5) return false;
    for (let i = 0; i < 4; i++) {
      const dx = Math.abs(coords[i + 1][0] - coords[i][0]);
      const dy = Math.abs(coords[i + 1][1] - coords[i][1]);
      if (dx > 1e-10 && dy > 1e-10) return false;
    }
    return true;
  }
  get bounds() {
    const points = this._allPoints();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }
  get area() {
    if (this.geometry.type === "Point") return 0;
    if (this.geometry.type === "Polygon") {
      return polygonArea(this.geometry.coordinates);
    }
    if (this.geometry.type === "MultiPolygon") {
      let total = 0;
      for (const poly of this.geometry.coordinates) {
        total += polygonArea(poly);
      }
      return total;
    }
    return 0;
  }
  get centroid() {
    if (this.geometry.type === "Point") {
      return { x: this.geometry.coordinates[0], y: this.geometry.coordinates[1] };
    }
    const b = this.bounds;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  toMask(height, width) {
    if (!_maskFactory) {
      throw new Error(
        "SegmentationMask not available. Import mask.ts before calling toMask()."
      );
    }
    const mask = rasterizeGeometry(this.geometry, height, width);
    return _maskFactory(mask, height, width, {
      annotationType: this.annotationType,
      name: this.name,
      category: this.category,
      score: this.score,
      source: this.source,
      video: this.video,
      frameIdx: this.frameIdx,
      track: this.track,
      instance: this.instance
    });
  }
  _allPoints() {
    if (this.geometry.type === "Point") {
      return [this.geometry.coordinates];
    }
    if (this.geometry.type === "Polygon") {
      return this.geometry.coordinates.flat();
    }
    if (this.geometry.type === "MultiPolygon") {
      return this.geometry.coordinates.flat(2);
    }
    return [];
  }
};
function ringArea(ring) {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}
function polygonArea(rings) {
  if (rings.length === 0) return 0;
  let area = Math.abs(ringArea(rings[0]));
  for (let i = 1; i < rings.length; i++) {
    area -= Math.abs(ringArea(rings[i]));
  }
  return Math.abs(area);
}
function rasterizeGeometry(geometry, height, width) {
  const mask = new Uint8Array(height * width);
  if (geometry.type !== "Polygon") return mask;
  scanlineFill(geometry.coordinates[0], mask, height, width, true);
  for (let i = 1; i < geometry.coordinates.length; i++) {
    scanlineFill(geometry.coordinates[i], mask, height, width, false);
  }
  return mask;
}
function scanlineFill(coords, mask, height, width, fill) {
  if (!coords || coords.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of coords) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const startY = Math.max(0, Math.floor(minY));
  const endY = Math.min(height - 1, Math.floor(maxY));
  const n = coords.length - 1;
  for (let y = startY; y <= endY; y++) {
    const intersections = [];
    for (let i = 0; i < n; i++) {
      const y0 = coords[i][1];
      const y1 = coords[i + 1][1];
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1);
      const hi = Math.max(y0, y1);
      if (lo <= y + 0.5 && y + 0.5 < hi) {
        const x0 = coords[i][0];
        const x1 = coords[i + 1][0];
        const t = (y + 0.5 - y0) / (y1 - y0);
        intersections.push(x0 + t * (x1 - x0));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let j = 0; j < intersections.length - 1; j += 2) {
      const xStart = Math.max(0, Math.floor(intersections[j]));
      const xEnd = Math.min(width, Math.ceil(intersections[j + 1]));
      const val = fill ? 1 : 0;
      for (let x = xStart; x < xEnd; x++) {
        mask[y * width + x] = val;
      }
    }
  }
}
function encodeWkb(geometry) {
  if (geometry.type === "Point") {
    const buf = new ArrayBuffer(21);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint32(1, 1, true);
    view.setFloat64(5, geometry.coordinates[0], true);
    view.setFloat64(13, geometry.coordinates[1], true);
    return new Uint8Array(buf);
  }
  if (geometry.type === "Polygon") {
    return encodeWkbPolygon(geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    const polygonBuffers = [];
    for (const poly of geometry.coordinates) {
      polygonBuffers.push(encodeWkbPolygon(poly));
    }
    const totalSize = 9 + polygonBuffers.reduce((sum, b) => sum + b.length, 0);
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint32(1, 6, true);
    view.setUint32(5, geometry.coordinates.length, true);
    let offset = 9;
    for (const pb of polygonBuffers) {
      new Uint8Array(buf, offset, pb.length).set(pb);
      offset += pb.length;
    }
    return new Uint8Array(buf);
  }
  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}
function encodeWkbPolygon(rings) {
  let size = 9;
  for (const ring of rings) {
    size += 4 + ring.length * 16;
  }
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint8(0, 1);
  view.setUint32(1, 3, true);
  view.setUint32(5, rings.length, true);
  let offset = 9;
  for (const ring of rings) {
    view.setUint32(offset, ring.length, true);
    offset += 4;
    for (const [x, y] of ring) {
      view.setFloat64(offset, x, true);
      view.setFloat64(offset + 8, y, true);
      offset += 16;
    }
  }
  return new Uint8Array(buf);
}
function decodeWkb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteOrder = view.getUint8(0);
  const le = byteOrder === 1;
  const wkbType = view.getUint32(1, le);
  if (wkbType === 1) {
    const x = view.getFloat64(5, le);
    const y = view.getFloat64(13, le);
    return { type: "Point", coordinates: [x, y] };
  }
  if (wkbType === 3) {
    const { rings } = decodeWkbPolygon(view, 5, le);
    return { type: "Polygon", coordinates: rings };
  }
  if (wkbType === 6) {
    const numPolygons = view.getUint32(5, le);
    const polygons = [];
    let offset = 9;
    for (let i = 0; i < numPolygons; i++) {
      const innerLe = view.getUint8(offset) === 1;
      offset += 5;
      const { rings, bytesRead } = decodeWkbPolygon(view, offset, innerLe);
      polygons.push(rings);
      offset += bytesRead;
    }
    return { type: "MultiPolygon", coordinates: polygons };
  }
  throw new Error(`Unsupported WKB type: ${wkbType}`);
}
function decodeWkbPolygon(view, offset, le) {
  const numRings = view.getUint32(offset, le);
  let pos = offset + 4;
  const rings = [];
  for (let i = 0; i < numRings; i++) {
    const numPoints = view.getUint32(pos, le);
    pos += 4;
    const ring = [];
    for (let j = 0; j < numPoints; j++) {
      const x = view.getFloat64(pos, le);
      const y = view.getFloat64(pos + 8, le);
      ring.push([x, y]);
      pos += 16;
    }
    rings.push(ring);
  }
  return { rings, bytesRead: pos - offset };
}

// src/model/mask.ts
function encodeRle(mask, height, width) {
  const total = height * width;
  if (total === 0) return new Uint32Array(0);
  const runs = [];
  let currentVal = 0;
  let count = 0;
  for (let i = 0; i < total; i++) {
    const val = mask[i] ? 1 : 0;
    if (val === currentVal) {
      count++;
    } else {
      runs.push(count);
      currentVal = val;
      count = 1;
    }
  }
  runs.push(count);
  return new Uint32Array(runs);
}
function decodeRle(rleCounts, height, width) {
  const total = height * width;
  if (rleCounts.length === 0) return new Uint8Array(total);
  const flat = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < rleCounts.length; i++) {
    const val = i % 2 === 0 ? 0 : 1;
    const count = rleCounts[i];
    if (val === 1) {
      for (let j = 0; j < count && pos + j < total; j++) {
        flat[pos + j] = 1;
      }
    }
    pos += count;
  }
  return flat;
}
var SegmentationMask = class _SegmentationMask {
  rleCounts;
  height;
  width;
  annotationType;
  name;
  category;
  score;
  source;
  video;
  frameIdx;
  track;
  instance;
  constructor(options) {
    this.rleCounts = options.rleCounts;
    this.height = options.height;
    this.width = options.width;
    this.annotationType = options.annotationType ?? 2 /* SEGMENTATION */;
    this.name = options.name ?? "";
    this.category = options.category ?? "";
    this.score = options.score ?? null;
    this.source = options.source ?? "";
    this.video = options.video ?? null;
    this.frameIdx = options.frameIdx ?? null;
    this.track = options.track ?? null;
    this.instance = options.instance ?? null;
  }
  static fromArray(mask, height, width, options) {
    let flat;
    if (mask instanceof Uint8Array) {
      flat = mask;
    } else {
      flat = new Uint8Array(height * width);
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          flat[r * width + c] = mask[r][c] ? 1 : 0;
        }
      }
    }
    const rleCounts = encodeRle(flat, height, width);
    return new _SegmentationMask({
      rleCounts,
      height,
      width,
      ...options
    });
  }
  get data() {
    return decodeRle(this.rleCounts, this.height, this.width);
  }
  get area() {
    let total = 0;
    for (let i = 1; i < this.rleCounts.length; i += 2) {
      total += this.rleCounts[i];
    }
    return total;
  }
  get bbox() {
    const flat = this.data;
    let minR = this.height, maxR = -1, minC = this.width, maxC = -1;
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (flat[r * this.width + c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    if (maxR === -1) return { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: minC,
      y: minR,
      width: maxC - minC + 1,
      height: maxR - minR + 1
    };
  }
  toPolygon() {
    const flat = this.data;
    const rectangles = [];
    for (let y = 0; y < this.height; y++) {
      let x = 0;
      while (x < this.width) {
        if (flat[y * this.width + x]) {
          const start = x;
          while (x < this.width && flat[y * this.width + x]) x++;
          rectangles.push([start, y, x, y + 1]);
        } else {
          x++;
        }
      }
    }
    let geometry;
    if (rectangles.length === 0) {
      geometry = { type: "Polygon", coordinates: [[]] };
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x1, y1, x2, y2] of rectangles) {
        if (x1 < minX) minX = x1;
        if (y1 < minY) minY = y1;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
      }
      geometry = {
        type: "Polygon",
        coordinates: [
          [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY],
            [minX, minY]
          ]
        ]
      };
    }
    return new ROI({
      geometry,
      annotationType: this.annotationType,
      name: this.name,
      category: this.category,
      score: this.score,
      source: this.source,
      video: this.video,
      frameIdx: this.frameIdx,
      track: this.track,
      instance: this.instance
    });
  }
};
_registerMaskFactory(
  (mask, height, width, options) => {
    return SegmentationMask.fromArray(mask, height, width, options);
  }
);

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
