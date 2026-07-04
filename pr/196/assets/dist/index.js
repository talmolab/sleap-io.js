import {
  AUTO_VIDEO_MATCHER,
  AnnotationType,
  BASENAME_VIDEO_MATCHER,
  BlobByteSource,
  BoundingBox,
  CENTROID_SKELETON,
  Camera,
  CameraGroup,
  Centroid,
  ConflictResolution,
  CropVideoBackend,
  DUPLICATE_MATCHER,
  EXISTS_TTL_MS,
  ErrorMode,
  FrameGroup,
  FrameStrategy,
  IDENTITY_INSTANCE_MATCHER,
  IDENTITY_TRACK_MATCHER,
  IMAGE_DEDUP_VIDEO_MATCHER,
  IOU_MATCHER,
  Identity,
  ImageVideoBackend,
  InstanceContext,
  InstanceGroup,
  InstanceMatchMethod,
  InstanceMatcher,
  LabelImage,
  LabeledFrame,
  Labels,
  LabelsSet,
  LazyDataStore,
  LazyFrameList,
  MARKER_FUNCTIONS,
  MatchResult,
  MediaBunnyVideoBackend,
  MergeError,
  MergeProgressBar,
  MergeResult,
  Mp4BoxVideoBackend,
  NAMED_COLORS,
  NAME_TRACK_MATCHER,
  OVERLAP_SKELETON_MATCHER,
  PALETTES,
  PATH_VIDEO_MATCHER,
  PredictedBoundingBox,
  PredictedCentroid,
  PredictedLabelImage,
  PredictedROI,
  PredictedSegmentationMask,
  ROI,
  RecordingSession,
  RenderContext,
  SHAPE_VIDEO_MATCHER,
  STRUCTURE_SKELETON_MATCHER,
  SUBSET_SKELETON_MATCHER,
  SegmentationMask,
  SeqHeader,
  SeqIndex,
  SeqVideoBackend,
  SkeletonMatchMethod,
  SkeletonMatcher,
  SkeletonMismatchError,
  StreamingH5File,
  StreamingHdf5VideoBackend,
  SuggestionFrame,
  TrackMatchMethod,
  TrackMatcher,
  UnsupportedVideoFormatError,
  UserBoundingBox,
  UserCentroid,
  UserLabelImage,
  UserROI,
  UserSegmentationMask,
  Video,
  VideoMatchMethod,
  VideoMatcher,
  _annotationCentroidXy,
  _findAnnotationLinkMatches,
  _findAnnotationMatches,
  _registerFileWriter,
  _registerMaskFactory,
  _registerNodeFileOps,
  _registerNodeH5,
  _relinkFromPredicted,
  _resolveMergedIsNegative,
  clampAlpha,
  collectTracks,
  computePrefetchWindow,
  computeTrails,
  createSkeletonFromCategory,
  createVideoBackend,
  cropFrame,
  cropPoints,
  decodeCocoRle,
  decodeCompressedRleCounts,
  decodeKeypoints,
  decodeRle,
  decodeSegmentation,
  decodeWkb,
  decodeYamlSkeleton,
  determineColorScheme,
  drawCircle,
  drawCross,
  drawDiamond,
  drawLabelImage,
  drawMasks,
  drawSquare,
  drawTrails,
  drawTriangle,
  encodeRle,
  encodeWkb,
  encodeYamlSkeleton,
  fetchRemoteSlpBytes,
  fromDict,
  fromNumpy,
  getCentroidSkeleton,
  getImageBytesReader,
  getMarkerFunction,
  getPalette,
  groupRingsIntoPolygons,
  isAnalysisH5File,
  isCocoData,
  isStreamingSupported,
  isTrainingConfig,
  labelsFromNumpy,
  labelsToCsv,
  loadAnalysisH5,
  loadLabelImages,
  loadSlp,
  loadSlpSet,
  loadVideo,
  makeCameraFromDict,
  nTrailPaletteColors,
  nodeFileExists,
  normalizeLabelIds,
  openH5File,
  openH5Worker,
  openStreamingH5,
  parseCocoJson,
  pickColor,
  rasterizeGeometry,
  readCoco,
  readCocoSet,
  readGeoJSON,
  readSkeletonJson,
  readSlpStreaming,
  readTrainingConfigSkeleton,
  readTrainingConfigSkeletons,
  resizeNearest,
  resolveColor,
  resolveCropRect,
  resolveTrailNode,
  rgbToCSS,
  rodriguesTransformation,
  roisFromGeoJSON,
  roisToGeoJSON,
  saveAnalysisH5,
  saveLabelsCsv,
  saveSlp,
  saveSlpSet,
  saveSlpToBytes,
  setDefaultFsResolver,
  setDefaultImageBytesReader,
  setFsResolver,
  setImageBytesReader,
  setLabelImageFileReader,
  setSeqFileByteSourceFactory,
  toDict,
  toNumpy,
  traceMaskContours,
  uncropPoints,
  writeGeoJSON,
  writeSkeletonJson
} from "./chunk-3KS4N23B.js";
import {
  Edge,
  Instance,
  Instance3D,
  Node,
  PointView,
  PredictedInstance,
  PredictedInstance3D,
  Skeleton,
  Symmetry,
  Track,
  _registerCentroidFactory,
  clonePoint,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict
} from "./chunk-NIFGJKOL.js";
import {
  CLOUD_SCHEMES,
  DEFAULT_MAX_BYTES,
  GDRIVE_HOSTS,
  RETRYABLE_STATUSES,
  RemoteIOError,
  SENSITIVE_HEADERS,
  SENSITIVE_QUERY_PARAMS,
  URL_SCHEMES,
  checkDownloadHost,
  fetchRetrying,
  headOrRangeProbe,
  identityHeaders,
  isGdriveUrl,
  isUrl,
  openGdrive,
  parseGdrive,
  parseRetryAfterMs,
  raiseRemote,
  redactUrl,
  redactedCauseSummary,
  resolveUrl,
  statusToMessage,
  stripCrossOriginHeaders,
  urlFromConfirmation,
  withRetries
} from "./chunk-YS7Q6CO6.js";

// src/codecs/slp/h5-node.ts
var modulePromise = null;
async function getH5ModuleNode() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const module = await import("h5wasm/node");
      await module.ready;
      return module;
    })();
  }
  return modulePromise;
}
async function openH5FileNode(module, source, options) {
  if (typeof source === "string" && isUrl(source)) {
    const bytes = await fetchRemoteSlpBytes(source, options);
    return openBytesNode(module, bytes);
  }
  if (typeof source === "string") {
    const file = new module.File(source, "r");
    return { file, close: () => file.close() };
  }
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);
    return openBytesNode(module, data);
  }
  throw new Error(
    "Node environments only support string paths or byte buffers for SLP inputs."
  );
}
async function openBytesNode(module, data) {
  const { writeFileSync: writeFileSync2, unlinkSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join: join6 } = await import("path");
  const tempPath = join6(
    tmpdir(),
    `sleap-io-${Date.now()}-${Math.random().toString(16).slice(2)}.slp`
  );
  writeFileSync2(tempPath, data);
  const file = new module.File(tempPath, "r");
  return {
    file,
    close: () => {
      file.close();
      unlinkSync(tempPath);
    }
  };
}
_registerNodeH5(getH5ModuleNode, openH5FileNode);
_registerFileWriter(async (filename, bytes) => {
  const { writeFile } = await import("fs/promises");
  await writeFile(filename, bytes);
});
_registerNodeFileOps({
  writeFile: async (filename, bytes) => {
    const { writeFile } = await import("fs/promises");
    await writeFile(filename, bytes);
  },
  fileExists: async (path5) => {
    const { existsSync: existsSync5 } = await import("fs");
    return existsSync5(path5);
  },
  readPackageVersion: async () => {
    try {
      const { readFile } = await import("fs/promises");
      const { fileURLToPath } = await import("url");
      const { dirname: dirname5, join: join6 } = await import("path");
      const here = dirname5(fileURLToPath(import.meta.url));
      const candidates = [
        join6(here, "..", "..", "..", "package.json"),
        join6(here, "..", "..", "..", "..", "package.json")
      ];
      for (const candidate of candidates) {
        try {
          const raw = await readFile(candidate, "utf-8");
          const pkg = JSON.parse(raw);
          if (pkg.version) return pkg.version;
        } catch {
        }
      }
    } catch {
    }
    return null;
  }
});

// src/model/node-fs-resolver.ts
import * as fs from "fs";
import * as nodePath from "path";
var nodeFsResolver = {
  async exists(path5) {
    try {
      await fs.promises.access(path5);
      return true;
    } catch {
      return false;
    }
  },
  async sameFile(path1, path22) {
    const s1 = await fs.promises.stat(path1);
    const s2 = await fs.promises.stat(path22);
    return s1.dev === s2.dev && s1.ino === s2.ino;
  },
  async realpath(path5) {
    try {
      return await fs.promises.realpath(path5);
    } catch {
      return nodePath.resolve(path5);
    }
  }
};
setDefaultFsResolver(nodeFsResolver);

// src/video/seq-node.ts
import * as fs2 from "fs";
var NodeFileByteSource = class {
  path;
  fd = null;
  fileSize = null;
  constructor(path5) {
    this.path = path5;
  }
  ensureOpen() {
    if (this.fd === null) {
      this.fd = fs2.openSync(this.path, "r");
    }
    return this.fd;
  }
  async size() {
    if (this.fileSize === null) {
      this.fileSize = fs2.statSync(this.path).size;
    }
    return this.fileSize;
  }
  async read(offset, length) {
    if (length <= 0) return new Uint8Array(0);
    const fd = this.ensureOpen();
    const buf = Buffer.alloc(length);
    const bytesRead = fs2.readSync(fd, buf, 0, length, offset);
    return new Uint8Array(buf.subarray(0, bytesRead));
  }
  close() {
    if (this.fd !== null) {
      fs2.closeSync(this.fd);
      this.fd = null;
    }
  }
};
setSeqFileByteSourceFactory((path5) => new NodeFileByteSource(path5));

// src/io/label-images-node.ts
import * as fs3 from "fs";
import * as nodePath2 from "path";
async function readTiffPath(path5) {
  const stat = fs3.statSync(path5);
  if (stat.isDirectory()) {
    const entries = fs3.readdirSync(path5).filter((name) => /\.tiff?$/i.test(name)).sort();
    const files = entries.map(
      (name) => new Uint8Array(fs3.readFileSync(nodePath2.join(path5, name)))
    );
    return { files };
  }
  return new Uint8Array(fs3.readFileSync(path5));
}
setLabelImageFileReader(readTiffPath);

// src/video/node-image-reader.ts
import * as fs4 from "fs";
async function nodeImageReader(path5) {
  return new Uint8Array(await fs4.promises.readFile(path5));
}
setDefaultImageBytesReader(nodeImageReader);

// src/io/trackmate.ts
import * as fs5 from "fs";
import * as path from "path";
var HEADER_ROWS = 4;
var SPOTS_SIGNATURE = [
  "LABEL",
  "ID",
  "TRACK_ID",
  "QUALITY",
  "POSITION_X",
  "POSITION_Y"
];
function isTrackMateFile(filePath) {
  try {
    const fd = fs5.openSync(filePath, "r");
    const buf = Buffer.alloc(1024);
    const bytesRead = fs5.readSync(fd, buf, 0, 1024, 0);
    fs5.closeSync(fd);
    const firstLine = buf.toString("utf-8", 0, bytesRead).split("\n")[0]?.trim() ?? "";
    const cols = firstLine.split(",");
    return SPOTS_SIGNATURE.every((sig, i) => cols[i] === sig);
  } catch {
    return false;
  }
}
function findSibling(spotsPath, suffix) {
  const dir = path.dirname(spotsPath);
  const base = path.basename(spotsPath, path.extname(spotsPath));
  if (!base.includes("_spots")) return null;
  const stem = base.replace("_spots", "");
  if (suffix.startsWith(".")) {
    for (const ext of [suffix, suffix + "f"]) {
      const candidate = path.join(dir, stem + ext);
      if (fs5.existsSync(candidate)) return candidate;
    }
  } else {
    const candidate = path.join(dir, stem + suffix + ".csv");
    if (fs5.existsSync(candidate)) return candidate;
  }
  return null;
}
function parseEdges(edgesPath) {
  const targetToCost = /* @__PURE__ */ new Map();
  const content = fs5.readFileSync(edgesPath, "utf-8");
  const lines = content.split("\n");
  if (lines.length <= HEADER_ROWS) return targetToCost;
  const header = lines[0].split(",");
  const targetCol = header.indexOf("SPOT_TARGET_ID");
  const costCol = header.indexOf("LINK_COST");
  if (targetCol === -1 || costCol === -1) return targetToCost;
  for (let i = HEADER_ROWS; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    const targetId = parseInt(cols[targetCol], 10);
    const cost = parseFloat(cols[costCol]);
    if (!isNaN(targetId) && !isNaN(cost)) {
      targetToCost.set(targetId, cost);
    }
  }
  return targetToCost;
}
function readTrackMateCsv(spotsPath, options) {
  if (!fs5.existsSync(spotsPath)) {
    throw new Error(`Spots CSV not found: ${spotsPath}`);
  }
  const edgesPath = options?.edgesPath ?? findSibling(spotsPath, "_edges");
  let videoObj = null;
  if (options?.video) {
    if (typeof options.video === "string") {
      videoObj = new Video({ filename: options.video });
    } else {
      videoObj = options.video;
    }
  } else {
    const tifPath = findSibling(spotsPath, ".tif");
    if (tifPath) {
      videoObj = new Video({ filename: tifPath });
    }
  }
  const targetToCost = edgesPath ? parseEdges(edgesPath) : /* @__PURE__ */ new Map();
  const content = fs5.readFileSync(spotsPath, "utf-8");
  const lines = content.split("\n");
  const header = lines[0]?.split(",") ?? [];
  if (header.length < SPOTS_SIGNATURE.length || !SPOTS_SIGNATURE.every((sig, i) => header[i] === sig)) {
    throw new Error(
      `Not a TrackMate spots CSV. Expected columns starting with ${SPOTS_SIGNATURE.join(", ")}.`
    );
  }
  const col = {};
  for (let i = 0; i < header.length; i++) {
    col[header[i]] = i;
  }
  const dataRows = [];
  const trackIds = /* @__PURE__ */ new Set();
  for (let i = HEADER_ROWS; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    dataRows.push(cols);
    const tid = cols[col["TRACK_ID"]];
    if (tid) {
      trackIds.add(parseInt(tid, 10));
    }
  }
  const trackMap = /* @__PURE__ */ new Map();
  for (const tid of [...trackIds].sort((a, b) => a - b)) {
    trackMap.set(tid, new Track(`Track_${tid}`));
  }
  const tracks = [...trackMap.values()];
  const centroidsByFrame = /* @__PURE__ */ new Map();
  for (const row of dataRows) {
    const spotId = parseInt(row[col["ID"]], 10);
    const tidStr = row[col["TRACK_ID"]];
    const x = parseFloat(row[col["POSITION_X"]]);
    const y = parseFloat(row[col["POSITION_Y"]]);
    const zVal = col["POSITION_Z"] !== void 0 ? parseFloat(row[col["POSITION_Z"]]) : 0;
    const z = zVal !== 0 ? zVal : null;
    const frameIdx = parseInt(row[col["FRAME"]], 10);
    const score = parseFloat(row[col["QUALITY"]]);
    const track = tidStr ? trackMap.get(parseInt(tidStr, 10)) ?? null : null;
    const trackingScore = targetToCost.get(spotId) ?? null;
    const label = col["LABEL"] !== void 0 ? row[col["LABEL"]] : `ID${spotId}`;
    const centroid = new PredictedCentroid({
      x,
      y,
      z,
      track,
      trackingScore,
      score,
      name: label,
      source: "trackmate"
    });
    centroidsByFrame.set(frameIdx, [
      ...centroidsByFrame.get(frameIdx) ?? [],
      centroid
    ]);
  }
  const videos = videoObj ? [videoObj] : [];
  const video = videoObj ?? new Video({ filename: "" });
  const labeledFrames = [];
  for (const [frameIdx, frameCentroids] of [...centroidsByFrame.entries()].sort(
    (a, b) => a[0] - b[0]
  )) {
    labeledFrames.push(
      new LabeledFrame({ video, frameIdx, centroids: frameCentroids })
    );
  }
  const labels = new Labels({ labeledFrames, videos, tracks });
  labels.provenance["filename"] = spotsPath;
  return labels;
}
function loadTrackMate(filename, options) {
  return readTrackMateCsv(filename, options);
}

// src/io/ultralytics.ts
import * as fs6 from "fs";
import * as path2 from "path";
import YAML from "yaml";
import { deflate } from "pako";
var READ_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tiff", ".bmp"];
var IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".bmp",
  ".gif"
];
function parseDataYaml(yamlPath) {
  const text = fs6.readFileSync(yamlPath, "utf-8");
  return YAML.parse(text) ?? {};
}
function classNamesFromConfig(config) {
  const raw = config["names"];
  const result = /* @__PURE__ */ new Map();
  if (Array.isArray(raw)) {
    raw.forEach((name, i) => {
      result.set(i, String(name));
    });
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      const id = Number(k);
      if (Number.isFinite(id)) result.set(id, String(v));
    }
  }
  return result;
}
function createSkeletonFromConfig(config) {
  const kptShape = config["kpt_shape"] ?? [1, 3];
  const numKeypoints = kptShape[0];
  const nodeNames = config["node_names"] ?? Array.from({ length: numKeypoints }, (_, i) => `point_${i}`);
  const nodes = nodeNames.slice(0, numKeypoints).map((name) => new Node(String(name)));
  const edges = [];
  const connections = config["skeleton"] ?? [];
  for (const connection of connections) {
    if (Array.isArray(connection) && connection.length === 2) {
      const [srcIdx, dstIdx] = connection;
      if (srcIdx >= 0 && srcIdx < nodes.length && dstIdx >= 0 && dstIdx < nodes.length) {
        edges.push(new Edge(nodes[srcIdx], nodes[dstIdx]));
      }
    }
  }
  return new Skeleton({ nodes, edges, name: "ultralytics_skeleton" });
}
function detectLineFormat(parts) {
  const n = parts.length;
  if (n === 5) return "detection";
  if (n === 6) return "detection_conf";
  const remainder = n - 5;
  if (remainder > 0 && remainder % 3 === 0) return "pose";
  if ((n - 1) % 2 === 0 && n > 5) return "segmentation";
  return "pose";
}
function normalizeCoordinates(instance, imageShape) {
  const [height, width] = imageShape;
  const normalized = [];
  for (const point of instance.points) {
    const [x, y] = point.xy;
    if (point.visible && !Number.isNaN(x)) {
      normalized.push([x / width, y / height, 2]);
    } else {
      normalized.push([0, 0, 0]);
    }
  }
  return normalized;
}
function denormalizeCoordinates(normalizedPoints, imageShape) {
  const [height, width] = imageShape;
  return normalizedPoints.map(([xNorm, yNorm, visibility]) => {
    if (visibility > 0) {
      return [xNorm * width, yNorm * height, 1];
    }
    return [Number.NaN, Number.NaN, 0];
  });
}
function parseLabelFile(labelPath, skeleton, imageShape, options) {
  const classNames = options?.classNames;
  const instances = [];
  const rois = [];
  const bboxes = [];
  const content = fs6.readFileSync(labelPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const [heightPx, widthPx] = imageShape;
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum].trim();
    if (!line || line.startsWith("#")) continue;
    try {
      const parts = line.split(/\s+/);
      if (parts.length < 5) {
        console.warn(
          `Invalid line ${lineNum} in ${labelPath}: insufficient data`
        );
        continue;
      }
      const fmt = detectLineFormat(parts);
      const classId = parseStrictInt(parts[0]);
      const category = classNames ? classNames.get(classId) ?? "" : "";
      if (fmt === "detection" || fmt === "detection_conf") {
        const xCenterNorm = parseStrictFloat(parts[1]);
        const yCenterNorm = parseStrictFloat(parts[2]);
        const wNorm = parseStrictFloat(parts[3]);
        const hNorm = parseStrictFloat(parts[4]);
        const xCenterPx = xCenterNorm * widthPx;
        const yCenterPx = yCenterNorm * heightPx;
        const wPx = wNorm * widthPx;
        const hPx = hNorm * heightPx;
        const x1 = xCenterPx - wPx / 2;
        const y1 = yCenterPx - hPx / 2;
        if (fmt === "detection_conf") {
          const score = parseStrictFloat(parts[5]);
          bboxes.push(
            new PredictedBoundingBox({
              x1,
              y1,
              x2: x1 + wPx,
              y2: y1 + hPx,
              category,
              score
            })
          );
        } else {
          bboxes.push(
            new UserBoundingBox({
              x1,
              y1,
              x2: x1 + wPx,
              y2: y1 + hPx,
              category
            })
          );
        }
      } else if (fmt === "segmentation") {
        const coordValues = parts.slice(1).map(parseStrictFloat);
        const coords = [];
        for (let i = 0; i + 1 < coordValues.length; i += 2) {
          coords.push([
            coordValues[i] * widthPx,
            coordValues[i + 1] * heightPx
          ]);
        }
        rois.push(UserROI.fromPolygon(coords, { category }));
      } else {
        parts.slice(1, 5).forEach(parseStrictFloat);
        const keypointData = parts.slice(5);
        if (keypointData.length % 3 !== 0) {
          console.warn(`Invalid keypoint data in ${labelPath} line ${lineNum}`);
          continue;
        }
        const numKeypoints = keypointData.length / 3;
        if (numKeypoints !== skeleton.nodes.length) {
          console.warn(
            `Keypoint count mismatch: expected ${skeleton.nodes.length}, got ${numKeypoints} in ${labelPath} line ${lineNum}`
          );
          continue;
        }
        const points = [];
        for (let i = 0; i < numKeypoints; i++) {
          const xNorm = parseStrictFloat(keypointData[i * 3]);
          const yNorm = parseStrictFloat(keypointData[i * 3 + 1]);
          const visibility = parseStrictInt(keypointData[i * 3 + 2]);
          if (visibility === 0) {
            points.push([Number.NaN, Number.NaN, 0]);
          } else {
            points.push([xNorm * widthPx, yNorm * heightPx, 1]);
          }
        }
        instances.push(Instance.fromNumpy({ pointsData: points, skeleton }));
      }
    } catch (e) {
      console.warn(
        `Error parsing line ${lineNum} in ${labelPath}: ${e.message}`
      );
      continue;
    }
  }
  return { instances, rois, bboxes };
}
function writeLabelFile(labelPath, frame, skeleton, imageShape, classId = 0) {
  const [heightPx, widthPx] = imageShape;
  const out = [];
  for (const instance of frame.instances) {
    if (instance.points.length !== skeleton.nodes.length) {
      console.warn(
        `Instance has ${instance.points.length} points, skeleton has ${skeleton.nodes.length} nodes. Skipping.`
      );
      continue;
    }
    const visibleXy = [];
    for (const point of instance.points) {
      if (point.visible && !Number.isNaN(point.xy[0])) {
        visibleXy.push([point.xy[0], point.xy[1]]);
      }
    }
    if (visibleXy.length === 0) continue;
    const xs = visibleXy.map((p) => p[0]);
    const ys = visibleXy.map((p) => p[1]);
    const padding = 10;
    const xMin = Math.max(0, Math.min(...xs) - padding);
    const yMin = Math.max(0, Math.min(...ys) - padding);
    const xMax = Math.min(widthPx, Math.max(...xs) + padding);
    const yMax = Math.min(heightPx, Math.max(...ys) + padding);
    const xCenterNorm = (xMin + xMax) / 2 / widthPx;
    const yCenterNorm = (yMin + yMax) / 2 / heightPx;
    const widthNorm = (xMax - xMin) / widthPx;
    const heightNorm = (yMax - yMin) / heightPx;
    const lineParts = [
      String(classId),
      fmt6(xCenterNorm),
      fmt6(yCenterNorm),
      fmt6(widthNorm),
      fmt6(heightNorm)
    ];
    for (const point of instance.points) {
      const [x, y] = point.xy;
      if (point.visible && !Number.isNaN(x)) {
        lineParts.push(fmt6(x / widthPx), fmt6(y / heightPx), "2");
      } else {
        lineParts.push("0.000000", "0.000000", "0");
      }
    }
    out.push(lineParts.join(" "));
  }
  fs6.writeFileSync(labelPath, out.length ? out.join("\n") + "\n" : "");
}
function writeRoiLabelFile(labelPath, rois, imageShape, nameToId) {
  const [heightPx, widthPx] = imageShape;
  const explodedRois = [];
  for (const roi of rois) explodedRois.push(...roi.explode());
  const out = [];
  for (const roi of explodedRois) {
    const classId = nameToId.get(roi.category) ?? 0;
    if (!roi.isBbox) {
      const geom = roi.geometry;
      if (geom.type === "Polygon") {
        if (geom.coordinates.length > 1) {
          console.warn(
            `ROI polygon has ${geom.coordinates.length - 1} interior ring(s) (holes) that will be dropped. YOLO segmentation format does not support polygon holes.`
          );
        }
        const ring = geom.coordinates[0] ?? [];
        const coords = ring.slice(0, -1);
        const lineParts = [String(classId)];
        for (const [x, y] of coords) {
          lineParts.push(fmt6(x / widthPx), fmt6(y / heightPx));
        }
        out.push(lineParts.join(" "));
      }
    } else {
      const { minX, minY, maxX, maxY } = roi.bounds;
      const xCenter = (minX + maxX) / 2 / widthPx;
      const yCenter = (minY + maxY) / 2 / heightPx;
      const w = (maxX - minX) / widthPx;
      const h = (maxY - minY) / heightPx;
      out.push(
        [String(classId), fmt6(xCenter), fmt6(yCenter), fmt6(w), fmt6(h)].join(
          " "
        )
      );
    }
  }
  fs6.writeFileSync(labelPath, out.length ? out.join("\n") + "\n" : "");
}
function writeBboxLabelFile(labelPath, bboxes, imageShape, nameToId) {
  const [heightPx, widthPx] = imageShape;
  const out = [];
  for (const bbox of bboxes) {
    const classId = nameToId.get(bbox.category) ?? 0;
    const lineParts = [
      String(classId),
      fmt6(bbox.xCenter / widthPx),
      fmt6(bbox.yCenter / heightPx),
      fmt6(bbox.width / widthPx),
      fmt6(bbox.height / heightPx)
    ];
    if (bbox instanceof PredictedBoundingBox) {
      lineParts.push(fmt6(bbox.score));
    }
    out.push(lineParts.join(" "));
  }
  fs6.writeFileSync(labelPath, out.length ? out.join("\n") + "\n" : "");
}
function createDataYaml(yamlPath, skeleton, splitRatios, options) {
  const task = options?.task ?? "pose";
  const classNames = options?.classNames ?? /* @__PURE__ */ new Map([[0, "animal"]]);
  const config = {
    path: ".",
    names: classNames
  };
  if (task !== "pose") {
    config["task"] = task;
  } else if (skeleton !== null) {
    const connections = [];
    for (const edge of skeleton.edges) {
      connections.push([
        skeleton.index(edge.source),
        skeleton.index(edge.destination)
      ]);
    }
    config["kpt_shape"] = [skeleton.nodes.length, 3];
    config["flip_idx"] = Array.from(
      { length: skeleton.nodes.length },
      (_, i) => i
    );
    config["skeleton"] = connections;
    config["node_names"] = skeleton.nodes.map((node) => node.name);
  }
  for (const splitName of Object.keys(splitRatios)) {
    config[splitName] = `${splitName}/images`;
  }
  fs6.writeFileSync(yamlPath, YAML.stringify(config));
}
function buildClassNamesFromRois(rois) {
  return buildClassNames(rois.map((roi) => roi.category));
}
function buildClassNamesFromBboxes(bboxes) {
  return buildClassNames(bboxes.map((bbox) => bbox.category));
}
function buildClassNames(categories) {
  const distinct = Array.from(new Set(categories.filter((c) => c))).sort();
  const result = /* @__PURE__ */ new Map();
  if (distinct.length === 0) {
    result.set(0, "object");
    return result;
  }
  distinct.forEach((name, i) => {
    result.set(i, name);
  });
  return result;
}
function readLabels(datasetPath, options) {
  const split = options?.split ?? "train";
  const imageSize = options?.imageSize ?? [480, 640];
  let skeleton = options?.skeleton ?? null;
  let dataYamlPath;
  let root;
  if (path2.basename(datasetPath) === "data.yaml") {
    dataYamlPath = datasetPath;
    root = path2.dirname(datasetPath);
  } else {
    root = datasetPath;
    dataYamlPath = path2.join(datasetPath, "data.yaml");
  }
  if (!fs6.existsSync(dataYamlPath)) {
    throw new Error(`data.yaml not found at ${dataYamlPath}`);
  }
  const config = parseDataYaml(dataYamlPath);
  if (skeleton === null && "kpt_shape" in config) {
    skeleton = createSkeletonFromConfig(config);
  }
  const classNames = classNamesFromConfig(config);
  const splitPath = config[split] ?? `${split}/images`;
  const imagesDir = path2.join(root, splitPath);
  const labelsDir = path2.join(root, splitPath.replace(/\/images/g, "/labels"));
  if (!fs6.existsSync(imagesDir)) {
    throw new Error(`Images directory not found: ${imagesDir}`);
  }
  if (!fs6.existsSync(labelsDir)) {
    throw new Error(`Labels directory not found: ${labelsDir}`);
  }
  const labeledFrames = [];
  const tracks = /* @__PURE__ */ new Map();
  const imageFiles = fs6.readdirSync(imagesDir).filter(
    (name) => READ_IMAGE_EXTENSIONS.includes(path2.extname(name).toLowerCase())
  ).sort();
  for (const imageName of imageFiles) {
    const imageFile = path2.join(imagesDir, imageName);
    const stem = path2.basename(imageName, path2.extname(imageName));
    const labelFile = path2.join(labelsDir, `${stem}.txt`);
    const video = new Video({ filename: imageFile, openBackend: false });
    let instances = [];
    let rois = [];
    let bboxes = [];
    if (fs6.existsSync(labelFile)) {
      const imgShape = probeImageSize(imageFile) ?? imageSize;
      const parseSkeleton = skeleton ?? new Skeleton({ nodes: [] });
      ({ instances, rois, bboxes } = parseLabelFile(
        labelFile,
        parseSkeleton,
        imgShape,
        {
          classNames,
          video,
          frameIdx: 0
        }
      ));
      for (let i = 0; i < instances.length; i++) {
        const trackName = `track_${i}`;
        let track = tracks.get(trackName);
        if (!track) {
          track = new Track(trackName);
          tracks.set(trackName, track);
        }
        instances[i].track = track;
      }
    }
    const frame = new LabeledFrame({ video, frameIdx: 0, instances });
    frame.rois.push(...rois);
    frame.bboxes.push(...bboxes);
    labeledFrames.push(frame);
  }
  const skeletons = skeleton !== null ? [skeleton] : [];
  return new Labels({
    labeledFrames,
    skeletons,
    tracks: Array.from(tracks.values()),
    provenance: { source: root, split }
  });
}
function readLabelsSet(datasetPath, options) {
  const imageSize = options?.imageSize;
  let skeleton = options?.skeleton ?? null;
  let splits = options?.splits;
  if (!splits) {
    splits = [];
    for (const splitName of ["train", "val", "test", "valid"]) {
      if (fs6.existsSync(path2.join(datasetPath, splitName))) {
        splits.push(splitName);
      }
    }
    if (splits.length === 0) {
      throw new Error(`No splits found in dataset path: ${datasetPath}`);
    }
  }
  if (skeleton === null) {
    const dataYamlPath = path2.join(datasetPath, "data.yaml");
    if (fs6.existsSync(dataYamlPath)) {
      const dataConfig = parseDataYaml(dataYamlPath);
      if ("node_names" in dataConfig && "skeleton" in dataConfig) {
        try {
          const nodeNames = dataConfig["node_names"];
          const connections = dataConfig["skeleton"];
          const nodes = nodeNames.map((name) => new Node(String(name)));
          const edges = [];
          for (const connection of connections) {
            if (Array.isArray(connection) && connection.length === 2) {
              const [srcIdx, dstIdx] = connection;
              if (srcIdx >= 0 && srcIdx < nodes.length && dstIdx >= 0 && dstIdx < nodes.length) {
                edges.push(new Edge(nodes[srcIdx], nodes[dstIdx]));
              }
            }
          }
          skeleton = new Skeleton({ nodes, edges });
        } catch {
        }
      }
      if (skeleton === null && "kpt_shape" in dataConfig) {
        const kptShape = dataConfig["kpt_shape"];
        if (Array.isArray(kptShape) && kptShape.length >= 2) {
          const nKeypoints = kptShape[0];
          const nodes = Array.from(
            { length: nKeypoints },
            (_, i) => new Node(String(i))
          );
          skeleton = new Skeleton({ nodes });
        }
      }
    }
  }
  const entries = {};
  for (const split of splits) {
    try {
      entries[split] = readLabels(datasetPath, { split, skeleton, imageSize });
    } catch {
      continue;
    }
  }
  if (Object.keys(entries).length === 0) {
    throw new Error(`Could not load any splits from dataset: ${datasetPath}`);
  }
  return new LabelsSet(entries);
}
async function writeLabels(labels, datasetPath, options) {
  const splitRatios = options?.splitRatios ?? { train: 0.8, val: 0.2 };
  const classId = options?.classId ?? 0;
  const imageFormat = options?.imageFormat ?? "png";
  const imageQuality = options?.imageQuality ?? null;
  const task = options?.task ?? "pose";
  fs6.mkdirSync(datasetPath, { recursive: true });
  const totalRatio = Object.values(splitRatios).reduce((a, b) => a + b, 0);
  if (Math.abs(totalRatio - 1) > 1e-8 + 1e-5) {
    throw new Error(`Split ratios must sum to 1.0, got ${totalRatio}`);
  }
  let skeleton;
  if (task === "pose") {
    if (labels.skeletons.length === 0) {
      throw new Error("Labels must have at least one skeleton for pose task");
    }
    skeleton = labels.skeletons[0];
  } else {
    skeleton = null;
  }
  let classNames;
  if (task === "detect") {
    classNames = buildClassNamesFromBboxes(labels.bboxes);
  } else if (task === "segment") {
    classNames = buildClassNamesFromRois(labels.rois);
  } else {
    classNames = /* @__PURE__ */ new Map([[0, "animal"]]);
  }
  createDataYaml(path2.join(datasetPath, "data.yaml"), skeleton, splitRatios, {
    task,
    classNames
  });
  if (task === "detect") {
    writeBboxLabels(
      labels,
      datasetPath,
      splitRatios,
      classNames,
      imageFormat,
      imageQuality
    );
    return;
  }
  if (task === "segment") {
    writeRoiLabels(
      labels,
      datasetPath,
      splitRatios,
      classNames,
      imageFormat,
      imageQuality
    );
    return;
  }
  let splitLabels;
  const splitNames = Object.keys(splitRatios);
  if (splitNames.length === 1) {
    splitLabels = { [splitNames[0]]: labels };
  } else {
    splitLabels = createSplitsFromLabels(labels, splitRatios);
  }
  for (const [splitName, splitData] of Object.entries(splitLabels)) {
    const imagesDir = path2.join(datasetPath, splitName, "images");
    const labelsDir = path2.join(datasetPath, splitName, "labels");
    fs6.mkdirSync(imagesDir, { recursive: true });
    fs6.mkdirSync(labelsDir, { recursive: true });
    const frames = splitData.labeledFrames;
    for (let lfIdx = 0; lfIdx < frames.length; lfIdx++) {
      const frame = frames[lfIdx];
      const written = await writeFrameImage(
        frame,
        imagesDir,
        lfIdx,
        imageFormat,
        imageQuality
      );
      if (written === null) {
        console.warn(
          `Could not load frame ${frame.frameIdx} from video, skipping.`
        );
        continue;
      }
      const labelPath = path2.join(labelsDir, `${pad7(lfIdx)}.txt`);
      writeLabelFile(labelPath, frame, skeleton, written.shape, classId);
    }
  }
}
function writeBboxLabels(labels, datasetPath, splitRatios, classNames, imageFormat, imageQuality) {
  const nameToId = invertClassNames(classNames);
  const itemsByVideo = /* @__PURE__ */ new Map();
  const videoByKey = /* @__PURE__ */ new Map();
  for (const lf of labels.labeledFrames) {
    if (lf.bboxes.length) {
      const key = videoKey(lf.video);
      if (!itemsByVideo.has(key)) {
        itemsByVideo.set(key, []);
        videoByKey.set(key, lf.video);
      }
      itemsByVideo.get(key).push(...lf.bboxes);
    }
  }
  writeGroupedLabels(
    itemsByVideo,
    videoByKey,
    datasetPath,
    splitRatios,
    imageFormat,
    imageQuality,
    (labelPath, items, shape) => writeBboxLabelFile(labelPath, items, shape, nameToId)
  );
}
function writeRoiLabels(labels, datasetPath, splitRatios, classNames, imageFormat, imageQuality) {
  const nameToId = invertClassNames(classNames);
  const itemsByVideo = /* @__PURE__ */ new Map();
  const videoByKey = /* @__PURE__ */ new Map();
  for (const lf of labels.labeledFrames) {
    if (lf.rois.length) {
      const key = videoKey(lf.video);
      if (!itemsByVideo.has(key)) {
        itemsByVideo.set(key, []);
        videoByKey.set(key, lf.video);
      }
      itemsByVideo.get(key).push(...lf.rois);
    }
  }
  writeGroupedLabels(
    itemsByVideo,
    videoByKey,
    datasetPath,
    splitRatios,
    imageFormat,
    imageQuality,
    (labelPath, items, shape) => writeRoiLabelFile(labelPath, items, shape, nameToId)
  );
}
function writeGroupedLabels(itemsByVideo, videoByKey, datasetPath, splitRatios, imageFormat, imageQuality, writeLabel) {
  const videoKeys = Array.from(itemsByVideo.keys()).sort();
  const nVideos = videoKeys.length;
  const splitNames = Object.keys(splitRatios);
  const boundaries = [];
  let cumulative = 0;
  for (const name of splitNames) {
    cumulative += splitRatios[name];
    boundaries.push(roundHalfToEven(cumulative * nVideos));
  }
  let startIdx = 0;
  for (let splitIdx = 0; splitIdx < splitNames.length; splitIdx++) {
    const splitName = splitNames[splitIdx];
    const endIdx = boundaries[splitIdx];
    const splitVideoKeys = videoKeys.slice(startIdx, endIdx);
    startIdx = endIdx;
    if (splitVideoKeys.length === 0) continue;
    const imagesDir = path2.join(datasetPath, splitName, "images");
    const labelsDir = path2.join(datasetPath, splitName, "labels");
    fs6.mkdirSync(imagesDir, { recursive: true });
    fs6.mkdirSync(labelsDir, { recursive: true });
    for (let lfIdx = 0; lfIdx < splitVideoKeys.length; lfIdx++) {
      const key = splitVideoKeys[lfIdx];
      const video = videoByKey.get(key);
      const items = itemsByVideo.get(key);
      const written = copyImageFileFrom(video, imagesDir, lfIdx);
      if (written === null) {
        console.warn(`Error processing ${key}, skipping.`);
        continue;
      }
      const labelPath = path2.join(labelsDir, `${pad7(lfIdx)}.txt`);
      writeLabel(labelPath, items, written.shape);
    }
  }
}
function createSplitsFromLabels(labels, splitRatios) {
  const splitNames = Object.keys(splitRatios);
  if (splitNames.length === 2) {
    const ratio = splitRatios[splitNames[0]];
    const set = labels.split(ratio);
    return {
      [splitNames[0]]: set.get("split1"),
      [splitNames[1]]: set.get("split2")
    };
  }
  if (splitNames.length === 3) {
    const total = labels.labeledFrames.length;
    const trainRatio = splitRatios["train"] ?? 0.6;
    const valRatio = splitRatios["val"] ?? 0.2;
    const testRatio = splitRatios["test"] ?? 0.2;
    const trainSet = labels.split(trainRatio);
    const train = trainSet.get("split1");
    let rest = trainSet.get("split2");
    let nTest = testRatio;
    if (nTest < 1) {
      nTest = testRatio * total / Math.max(1, rest.labeledFrames.length);
    }
    const testSet = rest.split(nTest);
    const test = testSet.get("split1");
    rest = testSet.get("split2");
    let nVal = valRatio;
    if (nVal < 1) {
      nVal = valRatio * total / Math.max(1, rest.labeledFrames.length);
    }
    const val = nVal === 1 ? rest : rest.split(nVal).get("split1");
    return { train, val, test };
  }
  return { [splitNames[0]]: labels };
}
function loadUltralytics(datasetPath, options) {
  return readLabels(datasetPath, options);
}
async function saveUltralytics(labels, datasetPath, options) {
  return writeLabels(labels, datasetPath, options);
}
async function writeFrameImage(frame, imagesDir, lfIdx, imageFormat, imageQuality) {
  const copied = copyImageFileFrom(frame.video, imagesDir, lfIdx);
  if (copied !== null) return copied;
  try {
    const img = await frame.image;
    if (isImageData(img)) {
      const png = encodePng(img.data, img.width, img.height, imageQuality);
      const imagePath = path2.join(imagesDir, `${pad7(lfIdx)}.png`);
      fs6.writeFileSync(imagePath, png);
      return { imagePath, shape: [img.height, img.width] };
    }
  } catch {
  }
  void imageFormat;
  return null;
}
function copyImageFileFrom(video, imagesDir, lfIdx) {
  const filename = Array.isArray(video.filename) ? video.filename[0] : video.filename;
  if (typeof filename !== "string" || filename.length === 0) return null;
  const ext = path2.extname(filename).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) return null;
  if (!fs6.existsSync(filename)) return null;
  const shape = probeImageSize(filename);
  if (shape === null) return null;
  const imagePath = path2.join(imagesDir, `${pad7(lfIdx)}${ext}`);
  fs6.copyFileSync(filename, imagePath);
  return { imagePath, shape };
}
function probeImageSize(filePath) {
  let fd = null;
  try {
    fd = fs6.openSync(filePath, "r");
    const head = Buffer.alloc(32);
    const n = fs6.readSync(fd, head, 0, 32, 0);
    if (n < 2) return null;
    if (head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71) {
      const width = head.readUInt32BE(16);
      const height = head.readUInt32BE(20);
      return [height, width];
    }
    if (head[0] === 71 && head[1] === 73 && head[2] === 70) {
      const width = head.readUInt16LE(6);
      const height = head.readUInt16LE(8);
      return [height, width];
    }
    if (head[0] === 66 && head[1] === 77) {
      const width = head.readInt32LE(18);
      const height = Math.abs(head.readInt32LE(22));
      return [height, width];
    }
    if (head[0] === 73 && head[1] === 73 && head[2] === 42 || head[0] === 77 && head[1] === 77 && head[3] === 42) {
      return probeTiffSize(fd);
    }
    if (head[0] === 255 && head[1] === 216) {
      return probeJpegSize(fd);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs6.closeSync(fd);
      } catch {
      }
    }
  }
}
function probeJpegSize(fd) {
  const stat = fs6.fstatSync(fd);
  const buf = Buffer.alloc(stat.size);
  fs6.readSync(fd, buf, 0, stat.size, 0);
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 255) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 216 || marker === 217 || marker >= 208 && marker <= 215) {
      offset += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(offset + 2);
    const isSof = marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204;
    if (isSof) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return [height, width];
    }
    offset += 2 + segLen;
  }
  return null;
}
function probeTiffSize(fd) {
  const stat = fs6.fstatSync(fd);
  const size = Math.min(stat.size, 65536);
  const buf = Buffer.alloc(size);
  fs6.readSync(fd, buf, 0, size, 0);
  const le = buf[0] === 73;
  const readU16 = (o) => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const readU32 = (o) => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const ifdOffset = readU32(4);
  if (ifdOffset + 2 > buf.length) return null;
  const numEntries = readU16(ifdOffset);
  let width = 0;
  let height = 0;
  for (let i = 0; i < numEntries; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > buf.length) break;
    const tag = readU16(entry);
    const type = readU16(entry + 2);
    const value = type === 3 ? readU16(entry + 8) : readU32(entry + 8);
    if (tag === 256) width = value;
    if (tag === 257) height = value;
  }
  if (width > 0 && height > 0) return [height, width];
  return null;
}
function isImageData(img) {
  return !!img && typeof img === "object" && typeof img.width === "number" && typeof img.height === "number" && !!img.data && typeof img.data.length === "number";
}
function encodePng(rgba, width, height, compressLevel = null) {
  const level = compressLevel == null ? 6 : Math.min(9, Math.max(0, compressLevel));
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(
      rgba.subarray(y * stride, y * stride + stride),
      y * (stride + 1) + 1
    );
  }
  const compressed = deflate(raw, {
    level
  });
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const signature = new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10
  ]);
  const chunks = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0))
  ];
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
function pngChunk(type, data) {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3)
  ]);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}
var CRC_TABLE = null;
function crc32(bytes) {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      }
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 4294967295;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
function fmt6(x) {
  return x.toFixed(6);
}
function pad7(i) {
  return String(i).padStart(7, "0");
}
function roundHalfToEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
function parseStrictInt(s) {
  if (!/^[+-]?\d+$/.test(s.trim())) {
    throw new Error(`invalid integer: ${s}`);
  }
  return parseInt(s, 10);
}
function parseStrictFloat(s) {
  const t = s.trim();
  if (/^[+-]?(inf|infinity)$/i.test(t)) {
    return t.startsWith("-") ? -Infinity : Infinity;
  }
  if (/^[+-]?nan$/i.test(t)) return Number.NaN;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    throw new Error(`invalid float: ${s}`);
  }
  return Number(t);
}
function videoKey(video) {
  return Array.isArray(video.filename) ? String(video.filename[0]) : String(video.filename);
}
function invertClassNames(classNames) {
  const result = /* @__PURE__ */ new Map();
  for (const [id, name] of classNames) result.set(name, id);
  return result;
}

// src/io/coco-node.ts
import * as fs7 from "fs";
import * as path3 from "path";
function recursiveFindByBasename(root, base) {
  let entries;
  try {
    entries = fs7.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path3.join(root, entry.name);
    if (entry.isFile()) {
      if (entry.name === base) return full;
    } else if (entry.isDirectory()) {
      const hit = recursiveFindByBasename(full, base);
      if (hit) return hit;
    }
  }
  return null;
}
function resolveImagePath(fileName, datasetRoot) {
  let p = path3.join(datasetRoot, fileName);
  if (fs7.existsSync(p) && fs7.statSync(p).isFile()) return p;
  for (const prefix of ["images", "imgs", "data/images"]) {
    p = path3.join(datasetRoot, prefix, fileName);
    if (fs7.existsSync(p) && fs7.statSync(p).isFile()) return p;
  }
  const base = path3.basename(fileName);
  const hit = recursiveFindByBasename(datasetRoot, base);
  if (hit) return hit;
  return null;
}
function loadCoco(jsonPath, options = {}) {
  if (!fs7.existsSync(jsonPath)) {
    throw new Error(`COCO annotation file not found: ${jsonPath}`);
  }
  const text = fs7.readFileSync(jsonPath, "utf-8");
  const datasetRoot = options.datasetRoot ?? path3.dirname(jsonPath);
  const resolveImage = options.resolveImage ?? ((fileName, root) => resolveImagePath(fileName, root ?? datasetRoot));
  return readCoco(text, { ...options, datasetRoot, resolveImage });
}
function loadCocoSet(datasetPath, options = {}) {
  const { jsonFiles, ...readOptions } = options;
  let files = jsonFiles;
  if (files === void 0) {
    files = fs7.readdirSync(datasetPath).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      throw new Error(`No JSON annotation files found in ${datasetPath}`);
    }
  }
  const result = {};
  for (const file of files) {
    const splitName = path3.basename(file, ".json");
    const labels = loadCoco(path3.join(datasetPath, file), {
      ...readOptions,
      datasetRoot: datasetPath
    });
    labels.provenance = { ...labels.provenance, split: splitName };
    result[splitName] = labels;
  }
  return result;
}

// src/io/jabs.ts
var JABS_DEFAULT_KEYPOINT_NAMES = [
  "NOSE",
  "LEFT_EAR",
  "RIGHT_EAR",
  "BASE_NECK",
  "LEFT_FRONT_PAW",
  "RIGHT_FRONT_PAW",
  "CENTER_SPINE",
  "LEFT_REAR_PAW",
  "RIGHT_REAR_PAW",
  "BASE_TAIL",
  "MID_TAIL",
  "TIP_TAIL"
];
var JABS_DEFAULT_EDGE_INDICES = [
  // Spine
  [3, 0],
  [3, 6],
  [6, 9],
  [9, 10],
  [10, 11],
  // Ears
  [0, 1],
  [0, 2],
  // Front paws
  [6, 4],
  [6, 5],
  // Rear paws
  [9, 7],
  [9, 8]
];
var JABS_DEFAULT_SYMMETRY_INDICES = [
  [1, 2],
  // ears
  [4, 5],
  // front paws
  [7, 8]
  // rear paws
];
function makeJabsDefaultSkeleton() {
  const nodes = JABS_DEFAULT_KEYPOINT_NAMES.map((name) => new Node(name));
  const edges = JABS_DEFAULT_EDGE_INDICES.map(
    ([a, b]) => new Edge(nodes[a], nodes[b])
  );
  const symmetries = JABS_DEFAULT_SYMMETRY_INDICES.map(
    ([a, b]) => new Symmetry([nodes[a], nodes[b]])
  );
  return new Skeleton({ nodes, edges, symmetries, name: "Mouse" });
}
var JABS_DEFAULT_SKELETON = makeJabsDefaultSkeleton();
function makeSimpleSkeleton(name, numPoints) {
  const nodes = Array.from(
    { length: numPoints },
    (_, i) => new Node(`${name}_kp${i}`)
  );
  const edges = Array.from(
    { length: Math.max(0, numPoints - 1) },
    (_, i) => new Edge(nodes[i], nodes[i + 1])
  );
  return new Skeleton({ nodes, edges, name });
}
function predictionToInstance(data, confidence, skeleton, track) {
  if (skeleton.nodes.length !== data.length) {
    throw new Error(
      `Skeleton (${skeleton.nodes.length}) does not match number of keypoints (${data.length})`
    );
  }
  const pointsData = [];
  const scores = [];
  for (let i = 0; i < skeleton.nodes.length; i++) {
    if (confidence[i] > 0) {
      pointsData.push([data[i][0], data[i][1], confidence[i], 1]);
      scores.push(confidence[i]);
    } else {
      pointsData.push([Number.NaN, Number.NaN, Number.NaN, 0]);
    }
  }
  if (scores.length === 0) return null;
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  return PredictedInstance.fromNumpy({
    pointsData,
    skeleton,
    track: track ?? null,
    score: meanScore
  });
}
function staticObjectToRoi(name, coords, video) {
  let geometry;
  if (coords.length === 1) {
    geometry = { type: "Point", coordinates: [coords[0][0], coords[0][1]] };
  } else {
    geometry = {
      type: "MultiPoint",
      coordinates: coords.map(([x, y]) => [x, y])
    };
  }
  const category = name === "corners" ? "arena" : "anchor";
  return new UserROI({ geometry, name, category, source: "jabs", video });
}
function getDataset(file, name) {
  const item = file.get(name);
  if (item == null || !("value" in item)) return null;
  return item;
}
function attrValue(attr) {
  if (attr == null) return void 0;
  if (typeof attr === "object" && "value" in attr) {
    return attr.value;
  }
  return attr;
}
function num(v) {
  return typeof v === "bigint" ? Number(v) : v;
}
async function loadJabs(labelsPath, options) {
  const skeleton = options?.skeleton ?? JABS_DEFAULT_SKELETON;
  const videoName = labelsPath.replace(/(_pose_est_v[2-6])?\.h5/g, ".avi");
  const video = new Video({ filename: videoName, openBackend: false });
  const exists = await nodeFileExists(labelsPath);
  if (exists === false) {
    throw new Error(`${labelsPath} doesn't exist.`);
  }
  const tracks = /* @__PURE__ */ new Map();
  const frames = [];
  const { file: rawFile, close } = await openH5File(labelsPath);
  const file = rawFile;
  try {
    const pointsDs = getDataset(file, "poseest/points");
    if (pointsDs == null) {
      throw new Error(
        `JABS pose file is missing 'poseest/points': ${labelsPath}`
      );
    }
    const pShape = Array.from(pointsDs.shape, num);
    const numFrames = pShape[0];
    const poseest = file.get("poseest");
    const verRaw = poseest?.attrs ? attrValue(poseest.attrs["version"]) : void 0;
    let poseVersion;
    if (verRaw != null && verRaw.length > 0) {
      poseVersion = Number(verRaw[0]);
    } else {
      if (pShape.length !== 3) {
        throw new Error(
          `Pose version not present and shape does not match single mouse: shape of ${JSON.stringify(pShape)} for ${labelsPath}`
        );
      }
      poseVersion = 2;
    }
    const M = pShape.length === 4 ? pShape[1] : 1;
    const N = pShape[pShape.length - 2];
    const pointsVal = pointsDs.value;
    const confVal = getDataset(file, "poseest/confidence")?.value ?? [];
    if (poseVersion === 2) {
      tracks.set(1, new Track("1"));
    }
    let idVal = null;
    let instanceCountVal = null;
    if (poseVersion === 3) {
      const idDs = getDataset(file, "poseest/instance_track_id");
      const countDs = getDataset(file, "poseest/instance_count");
      if (idDs == null) {
        throw new Error(
          `JABS pose file is missing 'poseest/instance_track_id': ${labelsPath}`
        );
      }
      if (countDs == null) {
        throw new Error(
          `JABS pose file is missing 'poseest/instance_count': ${labelsPath}`
        );
      }
      idVal = idDs.value;
      instanceCountVal = countDs.value;
    } else if (poseVersion > 3) {
      const idDs = getDataset(file, "poseest/instance_embed_id");
      if (idDs == null) {
        throw new Error(
          `JABS pose file is missing 'poseest/instance_embed_id': ${labelsPath}`
        );
      }
      idVal = idDs.value;
    }
    const extractInstance = (f, slot) => {
      const data = [];
      const conf = [];
      for (let n = 0; n < N; n++) {
        const flat = (f * M + slot) * N + n;
        const pbase = flat * 2;
        const rawY = num(pointsVal[pbase]);
        const rawX = num(pointsVal[pbase + 1]);
        data.push([rawX, rawY]);
        conf.push(confVal.length ? num(confVal[flat]) : 0);
      }
      return { data, conf };
    };
    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      const instances = [];
      if (poseVersion === 2) {
        const { data, conf } = extractInstance(frameIdx, 0);
        const inst = predictionToInstance(data, conf, skeleton, tracks.get(1));
        if (inst) instances.push(inst);
      } else {
        let maxIds;
        if (poseVersion === 3) {
          maxIds = instanceCountVal ? num(instanceCountVal[frameIdx]) : M;
        } else {
          maxIds = M;
        }
        for (let curId = 0; curId < maxIds; curId++) {
          const poseId = idVal ? num(idVal[frameIdx * M + curId]) : 0;
          if (poseVersion > 3 && poseId <= 0) continue;
          if (!tracks.has(poseId)) {
            tracks.set(poseId, new Track(String(poseId)));
          }
          const { data, conf } = extractInstance(frameIdx, curId);
          const inst = predictionToInstance(
            data,
            conf,
            skeleton,
            tracks.get(poseId)
          );
          if (inst) instances.push(inst);
        }
      }
      frames.push(new LabeledFrame({ video, frameIdx, instances }));
    }
    const rois = [];
    const rootKeys = typeof file.keys === "function" ? file.keys() : [];
    if (poseVersion >= 5 && rootKeys.includes("static_objects")) {
      const soGroup = file.get("static_objects");
      const objNames = soGroup && typeof soGroup.keys === "function" ? soGroup.keys() : [];
      for (const objName of objNames) {
        const ds = getDataset(file, `static_objects/${objName}`);
        if (ds == null) continue;
        const shape = Array.from(ds.shape, num);
        const nPts = shape[0] ?? 0;
        const coords = [];
        for (let k = 0; k < nPts; k++) {
          coords.push([num(ds.value[k * 2]), num(ds.value[k * 2 + 1])]);
        }
        rois.push(staticObjectToRoi(objName, coords, video));
      }
    }
    const labels = new Labels({ labeledFrames: frames, rois });
    labels.provenance["filename"] = labelsPath;
    return labels;
  } finally {
    close();
  }
}

// src/io/dlc.ts
import * as fs8 from "fs";
import * as path4 from "path";
import YAML2 from "yaml";
function warn(msg) {
  console.warn(msg);
}
function isDlcFile(filename) {
  try {
    const lines = fs8.readFileSync(filename, "utf-8").split(/\r?\n/).slice(0, 4).map((l) => l.trim());
    const content = lines.join("\n").toLowerCase();
    const hasScorer = content.includes("scorer");
    const hasCoords = content.includes("coords");
    const hasXy = content.includes("x") && content.includes("y");
    const hasBodyparts = content.includes("bodyparts") || content.includes("animal") || content.includes("individual");
    return hasScorer && hasCoords && hasXy && hasBodyparts;
  } catch {
    return false;
  }
}
var DLC_CONFIG_KEYS = [
  "video_sets",
  "bodyparts",
  "scorer",
  "Task",
  "skeleton",
  "individuals"
];
function isDlcProjectPath(filename) {
  let stat;
  try {
    stat = fs8.statSync(filename);
  } catch {
    return false;
  }
  if (stat.isDirectory()) {
    return fs8.existsSync(path4.join(filename, "config.yaml")) && fs8.existsSync(path4.join(filename, "labeled-data"));
  }
  if (path4.basename(filename) === "config.yaml" && stat.isFile()) {
    const cfg = readDlcConfig(filename);
    return cfg !== null && looksLikeDlcConfig(cfg);
  }
  return false;
}
function readDlcConfig(p) {
  if (!fs8.existsSync(p) || !fs8.statSync(p).isFile()) {
    warn(`DLC config file not found: ${p}`);
    return null;
  }
  let cfg;
  try {
    cfg = YAML2.parse(fs8.readFileSync(p, "utf-8"));
  } catch (e) {
    warn(`Failed to parse DLC config ${p}: ${e}`);
    return null;
  }
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
    warn(`DLC config ${p} did not parse to a mapping.`);
    return null;
  }
  return cfg;
}
function looksLikeDlcConfig(cfg) {
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
    return false;
  }
  const obj = cfg;
  return DLC_CONFIG_KEYS.filter((k) => Object.hasOwn(obj, k)).length >= 2;
}
function discoverConfig(csvPath, maxLevels = 3) {
  const start = path4.dirname(path4.resolve(csvPath));
  const dirs = [start];
  let cur = start;
  for (let i = 0; i < maxLevels; i += 1) {
    const parent = path4.dirname(cur);
    if (parent === cur) break;
    dirs.push(parent);
    cur = parent;
  }
  for (const d of dirs) {
    const candidate = path4.join(d, "config.yaml");
    if (fs8.existsSync(candidate) && fs8.statSync(candidate).isFile()) {
      const cfg = readDlcConfig(candidate);
      if (cfg !== null && looksLikeDlcConfig(cfg)) return candidate;
    }
  }
  return null;
}
function resolveConfig(csvPath, config) {
  if (config === false) return null;
  if (config == null) {
    const discovered = discoverConfig(csvPath);
    return discovered !== null ? readDlcConfig(discovered) : null;
  }
  return readDlcConfig(config);
}
function attachConfigSkeleton(skeleton, cfg) {
  const task = cfg.Task;
  if (task && skeleton.name == null) {
    skeleton.name = String(task);
  }
  const rawEdges = cfg.skeleton ?? [];
  const nodeNames = new Set(skeleton.nodeNames);
  const valid = [];
  const dropped = [];
  for (const entry of rawEdges) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      dropped.push(entry);
      continue;
    }
    const src = String(entry[0]);
    const dst = String(entry[1]);
    if (nodeNames.has(src) && nodeNames.has(dst)) {
      valid.push([src, dst]);
    } else {
      dropped.push([src, dst]);
    }
  }
  for (const [src, dst] of valid) {
    skeleton.addEdge(src, dst);
  }
  if (dropped.length) {
    warn(
      `Dropped ${dropped.length} DLC skeleton edge(s) referencing bodyparts not present in the labeled data: ${JSON.stringify(dropped)}`
    );
  }
}
function parseDlcCrop(crop) {
  if (crop == null) return null;
  let parts;
  if (typeof crop === "string") {
    parts = crop.split(",").map((s) => s.trim()).filter((s) => s !== "");
  } else if (Array.isArray(crop)) {
    parts = [...crop];
  } else {
    return null;
  }
  if (parts.length !== 4) return null;
  const nums = [];
  for (const p of parts) {
    if (typeof p === "number") {
      if (!Number.isFinite(p)) return null;
      nums.push(Math.trunc(p));
      continue;
    }
    const s = String(p).trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    nums.push(Math.trunc(v));
  }
  const [x1, x2, y1, y2] = nums;
  if (x2 <= x1 || y2 <= y1) {
    warn(
      `Ignoring inverted DLC crop ${JSON.stringify(crop)}: expected x1 < x2 and y1 < y2 (width-range-first 'x1, x2, y1, y2').`
    );
    return null;
  }
  if (x1 === 0 && y1 === 0) return null;
  return [x1, y1, x2, y2];
}
function videoSetsStemMap(cfg) {
  const out = /* @__PURE__ */ new Map();
  const videoSets = cfg.video_sets ?? {};
  for (const [key, value] of Object.entries(videoSets)) {
    const keyStr = String(key);
    if (keyStr.includes("WILL BE AUTOMATICALLY UPDATED")) continue;
    const name = keyStr.replace(/\\/g, "/").split("/").pop() ?? "";
    const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    if (stem) {
      const crop = value && typeof value === "object" ? value.crop : null;
      out.set(stem, { original: keyStr, rect: parseDlcCrop(crop) });
    }
  }
  return out;
}
function setSourceVideo(video, folderName, stemMap, searchPaths) {
  const entry = stemMap.get(folderName);
  if (entry === void 0) return null;
  const { original, rect } = entry;
  let resolvedPath = original;
  if (searchPaths?.length) {
    const basename5 = original.replace(/\\/g, "/").split("/").pop() ?? original;
    for (const dir of searchPaths) {
      const candidate = path4.join(dir, basename5);
      if (fs8.existsSync(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
  }
  video.sourceVideo = new Video({ filename: resolvedPath, openBackend: false });
  return { path: resolvedPath, rect };
}
function readDlcDataframe(filename) {
  const raw = fs8.readFileSync(filename, "utf-8").split(/\r?\n/);
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  const cells = raw.map((line) => line.split(","));
  let isMultianimal = false;
  let isMultiindex = false;
  try {
    if (cells.length < 5) throw new Error("too few rows to peek");
    isMultianimal = cells[1][0] === "individuals";
    isMultiindex = cells[4][0] === "labeled-data";
  } catch {
    isMultianimal = false;
    isMultiindex = false;
  }
  const headerRowIdxs = isMultianimal ? [1, 2, 3] : [0, 1, 2];
  const dataStartRow = isMultianimal ? 4 : 3;
  const indexColCount = isMultiindex ? 3 : 1;
  const columns = [];
  const headerRow0 = cells[headerRowIdxs[0]] ?? [];
  const ncols = headerRow0.length;
  for (let j = indexColCount; j < ncols; j += 1) {
    columns.push([
      cells[headerRowIdxs[0]]?.[j] ?? "",
      cells[headerRowIdxs[1]]?.[j] ?? "",
      cells[headerRowIdxs[2]]?.[j] ?? ""
    ]);
  }
  const index = [];
  const rows = [];
  for (let r = dataStartRow; r < cells.length; r += 1) {
    const row = cells[r];
    if (!row) continue;
    if (row.every((c) => c === "")) continue;
    let idxStr;
    if (isMultiindex) {
      idxStr = [row[0] ?? "", row[1] ?? "", row[2] ?? ""].join("/");
    } else {
      idxStr = row[0] ?? "";
    }
    index.push(idxStr);
    const values = [];
    for (let j = indexColCount; j < ncols; j += 1) {
      const cell = row[j];
      if (cell === void 0 || cell === "") {
        values.push(null);
      } else {
        const v = parseFloat(cell);
        values.push(Number.isNaN(v) ? null : v);
      }
    }
    rows.push(values);
  }
  return { index, columns, rows, isMultianimal };
}
function parseSingleAnimalStructure(df) {
  const collected = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [, bodypart, coord] of df.columns) {
    if (coord === "x" && bodypart !== "" && bodypart != null) {
      if (!seen.has(bodypart)) {
        seen.add(bodypart);
        collected.push(bodypart);
      }
    }
  }
  const nodeNames = [...new Set(collected)].sort();
  return new Skeleton({ nodes: nodeNames.map((n) => new Node(n)) });
}
function parseMultiAnimalStructure(df) {
  const trackMap = /* @__PURE__ */ new Map();
  const collected = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [individual, bodypart, coord] of df.columns) {
    if (coord !== "x") continue;
    if (individual !== "" && individual != null && individual !== "individuals" && !trackMap.has(individual)) {
      trackMap.set(individual, new Track(individual));
    }
    if (bodypart !== "" && bodypart != null && bodypart !== "bodyparts" && !seen.has(bodypart)) {
      seen.add(bodypart);
      collected.push(bodypart);
    }
  }
  const nodeNames = [...new Set(collected)].sort();
  const skeleton = new Skeleton({ nodes: nodeNames.map((n) => new Node(n)) });
  const tracks = [...trackMap.values()];
  return { skeleton, tracks };
}
function parseSingleAnimalRow(columns, values, skeleton) {
  const bodypartsData = /* @__PURE__ */ new Map();
  for (let c = 0; c < columns.length; c += 1) {
    const [, bodypart, coord] = columns[c];
    if (bodypart && bodypart !== "") {
      let bp = bodypartsData.get(bodypart);
      if (!bp) {
        bp = {};
        bodypartsData.set(bodypart, bp);
      }
      if (coord === "x") bp.x = values[c];
      else if (coord === "y") bp.y = values[c];
    }
  }
  let hasValidPoints = false;
  const pointsData = skeleton.nodeNames.map((name) => {
    const bp = bodypartsData.get(name);
    const x = bp?.x;
    const y = bp?.y;
    if (x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y)) {
      hasValidPoints = true;
      return [Number(x), Number(y)];
    }
    return [Number.NaN, Number.NaN];
  });
  if (hasValidPoints) {
    return [Instance.fromNumpy({ pointsData, skeleton })];
  }
  return [];
}
function parseMultiAnimalRow(columns, values, skeleton, tracks) {
  const instancesDict = /* @__PURE__ */ new Map();
  for (let c = 0; c < columns.length; c += 1) {
    const [individual, bodypart, coord] = columns[c];
    if (!individual || individual === "" || individual === "individuals") {
      continue;
    }
    let bps = instancesDict.get(individual);
    if (!bps) {
      bps = /* @__PURE__ */ new Map();
      instancesDict.set(individual, bps);
    }
    if (bodypart && bodypart !== "") {
      let bp = bps.get(bodypart);
      if (!bp) {
        bp = {};
        bps.set(bodypart, bp);
      }
      if (coord === "x") bp.x = values[c];
      else if (coord === "y") bp.y = values[c];
    }
  }
  const instances = [];
  for (const [individual, bodypartsData] of instancesDict) {
    const track = tracks.find((t) => t.name === individual) ?? null;
    let hasValidPoints = false;
    const pointsData = skeleton.nodeNames.map((name) => {
      const bp = bodypartsData.get(name);
      const x = bp?.x;
      const y = bp?.y;
      if (x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y)) {
        hasValidPoints = true;
        return [Number(x), Number(y)];
      }
      return [Number.NaN, Number.NaN];
    });
    if (hasValidPoints) {
      instances.push(Instance.fromNumpy({ pointsData, skeleton, track }));
    }
  }
  return instances;
}
function extractFrameIndex(imgPath) {
  const base = path4.basename(imgPath);
  const stem = base.replace(/\.[^.]*$/, "");
  const matches = stem.match(/\d+/g);
  return matches ? parseInt(matches[matches.length - 1], 10) : 0;
}
function videoNameFor(imgPath) {
  const parts = imgPath.split("/");
  if (parts.length >= 2 && parts[0] === "labeled-data") {
    return parts[1];
  }
  return path4.basename(path4.dirname(imgPath)) || "default";
}
function loadDlc(filename, options) {
  const cfg = resolveConfig(filename, options?.config ?? null);
  return loadDlcCsv(filename, {
    config: cfg,
    videoSearchPaths: options?.videoSearchPaths
  });
}
function loadDlcCsv(filename, opts) {
  const df = readDlcDataframe(filename);
  const { isMultianimal } = df;
  let skeleton;
  let tracks;
  if (opts.skeleton) {
    skeleton = opts.skeleton;
    tracks = opts.tracks ?? [];
  } else {
    if (isMultianimal) {
      const parsed = parseMultiAnimalStructure(df);
      skeleton = parsed.skeleton;
      tracks = parsed.tracks;
    } else {
      skeleton = parseSingleAnimalStructure(df);
      tracks = [];
    }
    if (opts.config != null) {
      attachConfigSkeleton(skeleton, opts.config);
    }
  }
  const videoImagePaths = /* @__PURE__ */ new Map();
  const frameMap = /* @__PURE__ */ new Map();
  for (const imgPath of df.index) {
    frameMap.set(imgPath, extractFrameIndex(imgPath));
    const videoName = videoNameFor(imgPath);
    if (!videoImagePaths.has(videoName)) videoImagePaths.set(videoName, []);
    videoImagePaths.get(videoName).push(imgPath);
  }
  const csvDir = path4.dirname(path4.resolve(filename));
  const videos = /* @__PURE__ */ new Map();
  const sortedVideoPaths = /* @__PURE__ */ new Map();
  for (const [videoName, imgPaths] of videoImagePaths) {
    const sortedImgPaths = [...imgPaths].sort(
      (a, b) => (frameMap.get(a) ?? 0) - (frameMap.get(b) ?? 0)
    );
    const actualImageFiles = [];
    for (const imgPath of sortedImgPaths) {
      const candidates = [
        path4.join(csvDir, imgPath),
        path4.join(csvDir, path4.basename(imgPath)),
        path4.join(path4.dirname(csvDir), imgPath)
      ];
      const found = candidates.find((c) => fs8.existsSync(c));
      if (found) actualImageFiles.push(found);
    }
    if (actualImageFiles.length > 0) {
      videos.set(
        videoName,
        new Video({ filename: actualImageFiles, openBackend: false })
      );
      sortedVideoPaths.set(videoName, sortedImgPaths);
    }
  }
  const dlcCrops = {};
  if (opts.config != null && videos.size > 0) {
    const stemMap = videoSetsStemMap(opts.config);
    for (const [videoName, video] of videos) {
      const result = setSourceVideo(
        video,
        videoName,
        stemMap,
        opts.videoSearchPaths
      );
      if (result != null && result.rect != null) {
        dlcCrops[result.path] = [...result.rect];
      }
    }
  }
  const allFrames = [];
  for (let r = 0; r < df.index.length; r += 1) {
    const imgPath = df.index[r];
    const videoName = videoNameFor(imgPath);
    if (!videos.has(videoName)) continue;
    const video = videos.get(videoName);
    const sortedPaths = sortedVideoPaths.get(videoName);
    const videoFrameIdx = sortedPaths.indexOf(imgPath);
    const instances = isMultianimal ? parseMultiAnimalRow(df.columns, df.rows[r], skeleton, tracks) : parseSingleAnimalRow(df.columns, df.rows[r], skeleton);
    allFrames.push(
      new LabeledFrame({ video, frameIdx: videoFrameIdx, instances })
    );
  }
  const labels = new Labels({
    labeledFrames: allFrames,
    videos: [...videos.values()],
    tracks,
    skeletons: skeleton.nodes.length ? [skeleton] : []
  });
  if (Object.keys(dlcCrops).length) {
    labels.provenance.dlc_crops = dlcCrops;
  }
  return labels;
}
function resolveProjectConfigPath(config) {
  let stat = null;
  try {
    stat = fs8.statSync(config);
  } catch {
    stat = null;
  }
  if (stat?.isDirectory()) {
    const candidate = path4.join(config, "config.yaml");
    if (fs8.existsSync(candidate) && fs8.statSync(candidate).isFile()) {
      return candidate;
    }
    throw new Error(`No config.yaml found in DLC project directory: ${config}`);
  }
  return config;
}
function findProjectCsvs(projectDir, scorer) {
  const labeledDir = path4.join(projectDir, "labeled-data");
  const folders = [];
  if (!fs8.existsSync(labeledDir) || !fs8.statSync(labeledDir).isDirectory()) {
    return folders;
  }
  const subs = fs8.readdirSync(labeledDir).sort();
  for (const sub of subs) {
    const subDir = path4.join(labeledDir, sub);
    if (!fs8.statSync(subDir).isDirectory()) continue;
    let csv = path4.join(subDir, `CollectedData_${scorer}.csv`);
    if (!fs8.existsSync(csv) || !fs8.statSync(csv).isFile()) {
      const candidates = fs8.readdirSync(subDir).filter((f) => f.endsWith(".csv")).sort().map((f) => path4.join(subDir, f)).filter((c) => isDlcFile(c));
      if (candidates.length === 0) continue;
      csv = candidates[0];
    }
    folders.push([sub, csv]);
  }
  return folders;
}
function loadDlcProject(config, options) {
  const videoSearchPaths = options?.videoSearchPaths;
  const configPath = resolveProjectConfigPath(config);
  const cfg = readDlcConfig(configPath);
  if (cfg === null) {
    throw new Error(`Could not read DLC config: ${configPath}`);
  }
  const projectDir = path4.dirname(configPath);
  const scorer = cfg.scorer ?? null;
  const folders = findProjectCsvs(projectDir, scorer);
  if (folders.length === 0) {
    throw new Error(
      `No DLC annotation CSVs found under ${path4.join(projectDir, "labeled-data")}`
    );
  }
  const nodeNames = [];
  const trackNames = [];
  for (const [, csv] of folders) {
    const df = readDlcDataframe(csv);
    if (df.isMultianimal) {
      const { skeleton: folderSkeleton, tracks: folderTracks } = parseMultiAnimalStructure(df);
      for (const track of folderTracks) {
        if (!trackNames.includes(track.name)) trackNames.push(track.name);
      }
      for (const name of folderSkeleton.nodeNames) {
        if (!nodeNames.includes(name)) nodeNames.push(name);
      }
    } else {
      const folderSkeleton = parseSingleAnimalStructure(df);
      for (const name of folderSkeleton.nodeNames) {
        if (!nodeNames.includes(name)) nodeNames.push(name);
      }
    }
  }
  const sharedSkeleton = new Skeleton({
    nodes: [...new Set(nodeNames)].sort().map((n) => new Node(n))
  });
  attachConfigSkeleton(sharedSkeleton, cfg);
  const sharedTracks = trackNames.map((n) => new Track(n));
  const allFrames = [];
  const allVideos = [];
  const dlcCrops = {};
  for (const [, csv] of folders) {
    const folderLabels = loadDlcCsv(csv, {
      config: cfg,
      videoSearchPaths,
      skeleton: sharedSkeleton,
      tracks: sharedTracks
    });
    allFrames.push(...folderLabels.labeledFrames);
    allVideos.push(...folderLabels.videos);
    const crops = folderLabels.provenance.dlc_crops;
    if (crops) Object.assign(dlcCrops, crops);
  }
  const labels = new Labels({
    labeledFrames: allFrames,
    videos: allVideos,
    tracks: sharedTracks,
    skeletons: sharedSkeleton.nodes.length ? [sharedSkeleton] : []
  });
  labels.provenance.dlc_project = String(configPath);
  labels.provenance.dlc_scorer = scorer;
  labels.provenance.dlc_task = cfg.Task ?? null;
  if (Object.keys(dlcCrops).length) {
    labels.provenance.dlc_crops = dlcCrops;
  }
  return labels;
}
function getTrainingSetFolder(projectDir, cfg, iteration) {
  const it = iteration == null ? cfg.iteration ?? 0 : iteration;
  const task = cfg.Task ?? "";
  const date = cfg.date ?? "";
  return path4.join(
    projectDir,
    "training-datasets",
    `iteration-${it}`,
    `UnaugmentedDataSet_${task}${date}`
  );
}
function selectDocumentationPickle(projectDir, cfg, selectors) {
  const trainsetDir = getTrainingSetFolder(
    projectDir,
    cfg,
    selectors.iteration
  );
  const pickles = (fs8.existsSync(trainsetDir) && fs8.statSync(trainsetDir).isDirectory() ? fs8.readdirSync(trainsetDir).filter((f) => /^Documentation_data-.*\.pickle$/.test(f)) : []).sort();
  if (pickles.length === 0) {
    throw new Error(
      `No DLC Documentation_data-*.pickle found in ${trainsetDir}. Run create_training_dataset in DLC to generate splits.`
    );
  }
  const pattern = /^Documentation_data-(.+)_(\d+)shuffle(\d+)\.pickle$/;
  const parsed = [];
  for (const name of pickles) {
    const m = pattern.exec(name);
    if (m) {
      parsed.push({
        path: path4.join(trainsetDir, name),
        fracInt: parseInt(m[2], 10),
        shuffleInt: parseInt(m[3], 10)
      });
    }
  }
  if (parsed.length === 0) {
    if (pickles.length === 1) return path4.join(trainsetDir, pickles[0]);
    throw new Error(
      `Could not parse train_fraction/shuffle from pickles in ${trainsetDir}: ` + JSON.stringify(pickles)
    );
  }
  let candidates = parsed;
  if (selectors.trainFraction != null) {
    const fracInt = Math.round(selectors.trainFraction * 100);
    candidates = candidates.filter((c) => c.fracInt === fracInt);
  }
  if (selectors.shuffle != null) {
    candidates = candidates.filter((c) => c.shuffleInt === selectors.shuffle);
  }
  if (candidates.length === 0) {
    const available = parsed.map((c) => [
      path4.basename(c.path),
      c.fracInt,
      c.shuffleInt
    ]);
    throw new Error(
      `No Documentation pickle matched train_fraction=${selectors.trainFraction}, shuffle=${selectors.shuffle}. Available: ${JSON.stringify(available)}`
    );
  }
  if (candidates.length > 1) {
    const available = candidates.map((c) => [
      path4.basename(c.path),
      c.fracInt,
      c.shuffleInt
    ]);
    throw new Error(
      `Multiple DLC splits found; specify trainFraction and/or shuffle. Available (name, train%, shuffle): ${JSON.stringify(available)}`
    );
  }
  return candidates[0].path;
}
function readDlcSplit(picklePath) {
  const buf = fs8.readFileSync(picklePath);
  const meta = readPickle(buf);
  return [extractIndexArray(meta[1]), extractIndexArray(meta[2])];
}
function extractIndexArray(value) {
  const raw = value instanceof NumpyArray ? value.values : value;
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => Number(i)).filter((i) => i !== -1 && !Number.isNaN(i));
}
function readCsvScorer(csv) {
  let first;
  try {
    const content = fs8.readFileSync(csv, "utf-8");
    first = content.split(/\r?\n/)[0]?.trim() ?? "";
  } catch {
    return null;
  }
  const parts = first.split(",");
  return parts.length > 1 ? parts[1] : null;
}
function dlcMergedOrder(projectDir, cfg) {
  const scorer = cfg.scorer ?? null;
  const stemMap = videoSetsStemMap(cfg);
  const included = [];
  for (const stem of stemMap.keys()) {
    const csv = path4.join(
      projectDir,
      "labeled-data",
      stem,
      `CollectedData_${scorer}.csv`
    );
    if (!fs8.existsSync(csv) || !fs8.statSync(csv).isFile()) continue;
    const csvScorer = readCsvScorer(csv);
    if (scorer != null && csvScorer != null && csvScorer !== scorer) {
      warn(
        `Skipping ${csv} labeled by '${csvScorer}' (project scorer is '${scorer}'); this matches DLC's training-set merge behavior.`
      );
      continue;
    }
    included.push([stem, csv]);
  }
  if (included.length === 0) {
    for (const [folder, csv] of findProjectCsvs(projectDir, scorer)) {
      included.push([folder, csv]);
    }
  }
  const merged = [];
  for (const [, csv] of included) {
    const df = readDlcDataframe(csv);
    for (const idx of df.index) {
      merged.push([path4.basename(path4.dirname(idx)), path4.basename(idx)]);
    }
  }
  merged.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });
  return merged;
}
function warnIfNonlexicographic(merged) {
  const lastDigitsRun = (fname) => {
    const nums = fname.match(/\d+/g);
    return nums ? parseInt(nums[nums.length - 1], 10) : -1;
  };
  const lexCmp = (a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  };
  const numericCmp = (a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    const na = lastDigitsRun(a[1]);
    const nb = lastDigitsRun(b[1]);
    if (na !== nb) return na - nb;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  };
  const lex = [...merged].sort(lexCmp);
  const num2 = [...merged].sort(numericCmp);
  const differ = lex.length !== num2.length || lex.some((m, i) => m[0] !== num2[i][0] || m[1] !== num2[i][1]);
  if (differ) {
    warn(
      "DLC split import: image filenames are not zero-padded, so DLC's lexicographic ordering differs from numeric order (e.g. 'img10' < 'img2'). Train/test assignment follows DLC's lexicographic order; verify the result."
    );
  }
}
function loadDlcSplits(config, options) {
  const configPath = resolveProjectConfigPath(config);
  const cfg = readDlcConfig(configPath);
  if (cfg === null) {
    throw new Error(`Could not read DLC config: ${configPath}`);
  }
  const projectDir = path4.dirname(configPath);
  const labels = loadDlcProject(configPath, {
    videoSearchPaths: options?.videoSearchPaths
  });
  const merged = dlcMergedOrder(projectDir, cfg);
  warnIfNonlexicographic(merged);
  if (merged.length && labels.labeledFrames.length === 0) {
    warn(
      "DLC split import: the project's labeled images were not found on disk, so no frames could be loaded and the train/test splits will be empty. Restore the referenced images under 'labeled-data/' (or pass videoSearchPaths) and try again."
    );
  }
  const picklePath = selectDocumentationPickle(projectDir, cfg, {
    shuffle: options?.shuffle,
    trainFraction: options?.trainFraction,
    iteration: options?.iteration
  });
  const [trainIdx, testIdx] = readDlcSplit(picklePath);
  const SEP = "\0";
  const lfLookup = /* @__PURE__ */ new Map();
  for (let g = 0; g < labels.labeledFrames.length; g += 1) {
    const lf = labels.labeledFrames[g];
    const filename = lf.video.filename;
    const fname = Array.isArray(filename) ? filename[lf.frameIdx] : filename;
    const key = `${path4.basename(path4.dirname(fname))}${SEP}${path4.basename(fname)}`;
    lfLookup.set(key, g);
  }
  const mapIndices = (indices) => {
    const out = [];
    for (const i of indices) {
      if (i >= 0 && i < merged.length) {
        const [folder, fname] = merged[i];
        const g = lfLookup.get(`${folder}${SEP}${fname}`);
        if (g !== void 0) out.push(g);
      }
    }
    return out;
  };
  const trainGlobal = mapIndices(trainIdx);
  const testGlobal = mapIndices(testIdx);
  const train = labels.extract(trainGlobal, true);
  const test = labels.extract(testGlobal, true);
  return new LabelsSet({ train, test });
}
var PickleGlobalRef = class {
  constructor(module, name) {
    this.module = module;
    this.name = name;
  }
};
var NumpyDtype = class {
  kind;
  // "i" (signed), "u" (unsigned), "f" (float), etc.
  itemsize;
  // bytes per element
  littleEndian;
  constructor(name) {
    let s = name;
    let little = true;
    if (s.length > 0 && (s[0] === "<" || s[0] === ">" || s[0] === "=" || s[0] === "|")) {
      little = s[0] !== ">";
      s = s.slice(1);
    }
    this.kind = s.length > 0 ? s[0] : "i";
    const size = parseInt(s.slice(1), 10);
    this.itemsize = Number.isNaN(size) ? 8 : size;
    this.littleEndian = little;
  }
};
var NumpyArray = class {
  constructor(values) {
    this.values = values;
  }
};
function asByteBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === "string") return Buffer.from(raw, "latin1");
  return null;
}
function decodeIntBuffer(buf, dtype) {
  const { itemsize, kind, littleEndian } = dtype;
  const signed = kind === "i";
  const out = [];
  const n = Math.floor(buf.length / itemsize);
  for (let i = 0; i < n; i += 1) {
    const off = i * itemsize;
    let v;
    switch (itemsize) {
      case 1:
        v = signed ? buf.readInt8(off) : buf.readUInt8(off);
        break;
      case 2:
        v = littleEndian ? signed ? buf.readInt16LE(off) : buf.readUInt16LE(off) : signed ? buf.readInt16BE(off) : buf.readUInt16BE(off);
        break;
      case 4:
        v = littleEndian ? signed ? buf.readInt32LE(off) : buf.readUInt32LE(off) : signed ? buf.readInt32BE(off) : buf.readUInt32BE(off);
        break;
      case 8: {
        const big = littleEndian ? signed ? buf.readBigInt64LE(off) : buf.readBigUInt64LE(off) : signed ? buf.readBigInt64BE(off) : buf.readBigUInt64BE(off);
        v = Number(big);
        break;
      }
      default:
        return out;
    }
    out.push(v);
  }
  return out;
}
function buildNumpyArray(rawdata, dtype) {
  if (!(dtype instanceof NumpyDtype)) return null;
  if (dtype.kind !== "i" && dtype.kind !== "u") return null;
  const buf = asByteBuffer(rawdata);
  if (buf === null) return null;
  return new NumpyArray(decodeIntBuffer(buf, dtype));
}
function readPickle(buffer) {
  const MARK = /* @__PURE__ */ Symbol("mark");
  const stack = [];
  const memo = /* @__PURE__ */ new Map();
  let pos = 0;
  const popMark = () => {
    const items = [];
    while (stack.length > 0) {
      const top = stack.pop();
      if (top === MARK) return items.reverse();
      items.push(top);
    }
    throw new Error("pickle: MARK not found on stack");
  };
  const readLine = () => {
    let end = pos;
    while (end < buffer.length && buffer[end] !== 10) end += 1;
    const s = buffer.toString("latin1", pos, end);
    pos = end + 1;
    return s;
  };
  const reduce = (func, args) => {
    if (func instanceof PickleGlobalRef) {
      if (func.module.startsWith("numpy") && func.name === "dtype") {
        const name = args[0];
        if (typeof name === "string") return new NumpyDtype(name);
        return { __reduce__: [func.module, func.name], args };
      }
      if (func.module.startsWith("numpy") && func.name === "_frombuffer") {
        const arr = buildNumpyArray(args[0], args[1]);
        if (arr !== null) return arr;
      }
      if (func.module.startsWith("numpy") && (func.name === "_reconstruct" || func.name === "ndarray")) {
        return { __numpy__: true };
      }
      if (func.module === "_codecs" && func.name === "encode") {
        const buf = asByteBuffer(args[0]);
        if (buf !== null) return buf;
      }
      return { __reduce__: [func.module, func.name], args };
    }
    return { __reduce__: func, args };
  };
  const build = (obj, state) => {
    if (obj instanceof NumpyDtype) {
      if (Array.isArray(state) && typeof state[1] === "string") {
        const bo = state[1];
        if (bo === ">") obj.littleEndian = false;
        else if (bo === "<" || bo === "=") obj.littleEndian = true;
      }
      return obj;
    }
    if (obj && typeof obj === "object" && obj.__numpy__) {
      if (Array.isArray(state)) {
        const rawdata = state[state.length - 1];
        const dtype = state.length >= 3 ? state[2] : void 0;
        const arr = buildNumpyArray(rawdata, dtype);
        if (arr !== null) return arr;
        obj.rawdata = rawdata;
      }
      return obj;
    }
    return obj;
  };
  while (pos < buffer.length) {
    const op = buffer[pos];
    pos += 1;
    switch (op) {
      case 128:
        pos += 1;
        break;
      case 149:
        pos += 8;
        break;
      case 46:
        return stack.pop();
      case 40:
        stack.push(MARK);
        break;
      case 78:
        stack.push(null);
        break;
      case 136:
        stack.push(true);
        break;
      case 137:
        stack.push(false);
        break;
      // ---- ints ----
      case 75:
        stack.push(buffer[pos]);
        pos += 1;
        break;
      case 77:
        stack.push(buffer.readUInt16LE(pos));
        pos += 2;
        break;
      case 74:
        stack.push(buffer.readInt32LE(pos));
        pos += 4;
        break;
      case 73: {
        const s = readLine();
        if (s === "00") stack.push(false);
        else if (s === "01") stack.push(true);
        else stack.push(parseInt(s, 10));
        break;
      }
      case 138: {
        const n = buffer[pos];
        pos += 1;
        let val = 0;
        for (let i = 0; i < n; i += 1) val += buffer[pos + i] * 2 ** (8 * i);
        if (n > 0 && buffer[pos + n - 1] & 128) val -= 2 ** (8 * n);
        pos += n;
        stack.push(val);
        break;
      }
      case 139: {
        const n = buffer.readUInt32LE(pos);
        pos += 4;
        let val = 0;
        for (let i = 0; i < n; i += 1) val += buffer[pos + i] * 2 ** (8 * i);
        if (n > 0 && buffer[pos + n - 1] & 128) val -= 2 ** (8 * n);
        pos += n;
        stack.push(val);
        break;
      }
      case 76: {
        const s = readLine().replace(/L$/, "");
        stack.push(parseInt(s, 10));
        break;
      }
      // ---- floats ----
      case 71:
        stack.push(buffer.readDoubleBE(pos));
        pos += 8;
        break;
      case 70:
        stack.push(parseFloat(readLine()));
        break;
      // ---- strings / unicode / bytes ----
      case 140: {
        const len = buffer[pos];
        pos += 1;
        stack.push(buffer.toString("utf-8", pos, pos + len));
        pos += len;
        break;
      }
      case 88: {
        const len = buffer.readUInt32LE(pos);
        pos += 4;
        stack.push(buffer.toString("utf-8", pos, pos + len));
        pos += len;
        break;
      }
      case 141: {
        const len = Number(buffer.readBigUInt64LE(pos));
        pos += 8;
        stack.push(buffer.toString("utf-8", pos, pos + len));
        pos += len;
        break;
      }
      case 85: {
        const len = buffer[pos];
        pos += 1;
        stack.push(buffer.toString("latin1", pos, pos + len));
        pos += len;
        break;
      }
      case 84: {
        const len = buffer.readUInt32LE(pos);
        pos += 4;
        stack.push(buffer.toString("latin1", pos, pos + len));
        pos += len;
        break;
      }
      case 67: {
        const len = buffer[pos];
        pos += 1;
        stack.push(buffer.subarray(pos, pos + len));
        pos += len;
        break;
      }
      case 66: {
        const len = buffer.readUInt32LE(pos);
        pos += 4;
        stack.push(buffer.subarray(pos, pos + len));
        pos += len;
        break;
      }
      case 142: {
        const len = Number(buffer.readBigUInt64LE(pos));
        pos += 8;
        stack.push(buffer.subarray(pos, pos + len));
        pos += len;
        break;
      }
      case 150: {
        const len = Number(buffer.readBigUInt64LE(pos));
        pos += 8;
        stack.push(buffer.subarray(pos, pos + len));
        pos += len;
        break;
      }
      // ---- lists ----
      case 93:
        stack.push([]);
        break;
      case 108:
        stack.push(popMark());
        break;
      case 97: {
        const value = stack.pop();
        stack[stack.length - 1].push(value);
        break;
      }
      case 101: {
        const items = popMark();
        const list = stack[stack.length - 1];
        for (const it of items) list.push(it);
        break;
      }
      // ---- dicts ----
      case 125:
        stack.push(/* @__PURE__ */ new Map());
        break;
      case 100: {
        const items = popMark();
        const map = /* @__PURE__ */ new Map();
        for (let i = 0; i < items.length; i += 2) {
          map.set(items[i], items[i + 1]);
        }
        stack.push(map);
        break;
      }
      case 115: {
        const value = stack.pop();
        const key = stack.pop();
        stack[stack.length - 1].set(key, value);
        break;
      }
      case 117: {
        const items = popMark();
        const map = stack[stack.length - 1];
        for (let i = 0; i < items.length; i += 2) {
          map.set(items[i], items[i + 1]);
        }
        break;
      }
      // ---- tuples ----
      case 41:
        stack.push([]);
        break;
      case 116:
        stack.push(popMark());
        break;
      case 133: {
        const a = stack.pop();
        stack.push([a]);
        break;
      }
      case 134: {
        const b = stack.pop();
        const a = stack.pop();
        stack.push([a, b]);
        break;
      }
      case 135: {
        const c = stack.pop();
        const b = stack.pop();
        const a = stack.pop();
        stack.push([a, b, c]);
        break;
      }
      // ---- memo ----
      case 113:
        memo.set(buffer[pos], stack[stack.length - 1]);
        pos += 1;
        break;
      case 114:
        memo.set(buffer.readUInt32LE(pos), stack[stack.length - 1]);
        pos += 4;
        break;
      case 148:
        memo.set(memo.size, stack[stack.length - 1]);
        break;
      case 112: {
        const idx = parseInt(readLine(), 10);
        memo.set(idx, stack[stack.length - 1]);
        break;
      }
      case 104:
        stack.push(memo.get(buffer[pos]));
        pos += 1;
        break;
      case 106:
        stack.push(memo.get(buffer.readUInt32LE(pos)));
        pos += 4;
        break;
      case 103:
        stack.push(memo.get(parseInt(readLine(), 10)));
        break;
      // ---- globals / reduce / build / newobj ----
      case 99: {
        const module = readLine();
        const name = readLine();
        stack.push(new PickleGlobalRef(module, name));
        break;
      }
      case 147: {
        const name = stack.pop();
        const module = stack.pop();
        stack.push(new PickleGlobalRef(String(module), String(name)));
        break;
      }
      case 82: {
        const args = stack.pop();
        const func = stack.pop();
        stack.push(reduce(func, args));
        break;
      }
      case 98: {
        const state = stack.pop();
        const obj = stack[stack.length - 1];
        stack[stack.length - 1] = build(obj, state);
        break;
      }
      case 129: {
        const args = stack.pop();
        const cls = stack.pop();
        stack.push(reduce(cls, args));
        break;
      }
      case 146: {
        stack.pop();
        const args = stack.pop();
        const cls = stack.pop();
        stack.push(reduce(cls, args));
        break;
      }
      default:
        throw new Error(
          `pickle: unsupported opcode 0x${op.toString(16)} at offset ${pos - 1}`
        );
    }
  }
  throw new Error("pickle: reached end of buffer without STOP");
}

// src/rendering/overlays.ts
import { createRequire } from "module";
var requireCjs = createRequire(import.meta.url);
var _skiaCanvas = null;
function getSkiaCanvas() {
  if (_skiaCanvas === null) {
    _skiaCanvas = requireCjs("skia-canvas");
  }
  return _skiaCanvas;
}
function configureStroke(ctx, rgb, lineWidth) {
  ctx.strokeStyle = rgbToCSS(rgb);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "square";
}
function drawBboxes(image, bboxes, opts) {
  if (bboxes.length === 0) return image;
  const color = opts?.color ?? [0, 255, 0];
  const colors = opts?.colors ?? null;
  const lineWidth = opts?.lineWidth ?? 2;
  const fillAlpha = clampAlpha(opts?.fillAlpha ?? 0);
  return withVectorCanvas(image, (ctx) => {
    for (let i = 0; i < bboxes.length; i++) {
      const bbox = bboxes[i];
      const c = pickColor(colors, i, color);
      const corners = bbox.corners;
      if (corners.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (let j = 1; j < corners.length; j++) {
        ctx.lineTo(corners[j][0], corners[j][1]);
      }
      ctx.closePath();
      if (fillAlpha > 0) {
        ctx.fillStyle = rgbToCSS(c, fillAlpha);
        ctx.fill();
      }
      configureStroke(ctx, c, lineWidth);
      ctx.stroke();
      if (bbox.isPredicted) {
        const score = bbox.score;
        ctx.font = "12px sans-serif";
        ctx.fillStyle = rgbToCSS(c);
        ctx.fillText(score.toFixed(2), corners[0][0], corners[0][1] - 5);
      }
    }
  });
}
function drawRois(image, rois, opts) {
  if (rois.length === 0) return image;
  const color = opts?.color ?? [0, 255, 0];
  const colors = opts?.colors ?? null;
  const lineWidth = opts?.lineWidth ?? 2;
  const fillAlpha = clampAlpha(opts?.fillAlpha ?? 0);
  return withVectorCanvas(image, (ctx) => {
    for (let i = 0; i < rois.length; i++) {
      const c = pickColor(colors, i, color);
      drawGeometry(ctx, rois[i].geometry, c, lineWidth, fillAlpha);
    }
  });
}
function drawCentroids(image, centroids, opts) {
  if (centroids.length === 0) return image;
  const color = opts?.color ?? [0, 255, 0];
  const colors = opts?.colors ?? null;
  const markerSize = opts?.markerSize ?? 5;
  const alpha = clampAlpha(opts?.alpha ?? 1);
  const [ox, oy] = opts?.offset ?? [0, 0];
  return withVectorCanvas(image, (ctx) => {
    for (let i = 0; i < centroids.length; i++) {
      const cx = centroids[i].x - ox;
      const cy = centroids[i].y - oy;
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      const c = pickColor(colors, i, color);
      ctx.beginPath();
      ctx.arc(cx, cy, markerSize, 0, Math.PI * 2);
      ctx.fillStyle = rgbToCSS(c, alpha);
      ctx.fill();
    }
  });
}
function drawGeometry(ctx, geometry, rgb, lineWidth, fillAlpha) {
  switch (geometry.type) {
    case "Polygon": {
      polygonToPath(ctx, geometry.coordinates);
      if (fillAlpha > 0) {
        ctx.fillStyle = rgbToCSS(rgb, fillAlpha);
        ctx.fill("evenodd");
      }
      configureStroke(ctx, rgb, lineWidth);
      ctx.stroke();
      break;
    }
    case "MultiPolygon": {
      for (const polygon of geometry.coordinates) {
        polygonToPath(ctx, polygon);
        if (fillAlpha > 0) {
          ctx.fillStyle = rgbToCSS(rgb, fillAlpha);
          ctx.fill("evenodd");
        }
        configureStroke(ctx, rgb, lineWidth);
        ctx.stroke();
      }
      break;
    }
    case "Point": {
      const radius = Math.max(lineWidth, 2);
      ctx.beginPath();
      ctx.arc(
        geometry.coordinates[0],
        geometry.coordinates[1],
        radius,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = rgbToCSS(rgb);
      ctx.fill();
      break;
    }
    case "MultiPoint": {
      const radius = Math.max(lineWidth, 2);
      ctx.fillStyle = rgbToCSS(rgb);
      for (const pt of geometry.coordinates) {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], radius, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "LineString": {
      const coords = geometry.coordinates;
      if (coords.length > 0) {
        ctx.beginPath();
        ctx.moveTo(coords[0][0], coords[0][1]);
        for (let i = 1; i < coords.length; i++) {
          ctx.lineTo(coords[i][0], coords[i][1]);
        }
        configureStroke(ctx, rgb, lineWidth);
        ctx.stroke();
      }
      break;
    }
    case "GeometryCollection": {
      for (const sub of geometry.geometries) {
        drawGeometry(ctx, sub, rgb, lineWidth, fillAlpha);
      }
      break;
    }
  }
}
function polygonToPath(ctx, rings) {
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length === 0) continue;
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(ring[i][0], ring[i][1]);
    }
    ctx.closePath();
  }
}
function withVectorCanvas(image, draw) {
  const { Canvas } = getSkiaCanvas();
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(image, 0, 0);
  draw(ctx);
  const result = ctx.getImageData(0, 0, image.width, image.height);
  const src = result.data;
  const dst = image.data;
  for (let i = 0; i < dst.length; i += 4) {
    dst[i] = src[i];
    dst[i + 1] = src[i + 1];
    dst[i + 2] = src[i + 2];
    dst[i + 3] = 255;
  }
  return image;
}
function isLabelImageLike(value) {
  return typeof value === "object" && value !== null && "data" in value && value.data instanceof Int32Array && "width" in value && "height" in value;
}
function isSegmentationMask(value) {
  return typeof value === "object" && value !== null && "rleCounts" in value && "hasSpatialTransform" in value;
}
function isBoundingBox(value) {
  return typeof value === "object" && value !== null && "corners" in value && "x1" in value && "x2" in value;
}
function isROI(value) {
  return typeof value === "object" && value !== null && "geometry" in value && typeof value.geometry === "object";
}
function applyOverlay(image, overlay, opts) {
  const alpha = clampAlpha(opts?.alpha ?? 0.3);
  const palette = opts?.palette ?? "distinct";
  const outline = opts?.outline ?? false;
  const outlineWidth = opts?.outlineWidth ?? 1;
  const outlineColor = opts?.outlineColor ?? null;
  const explicitColors = opts?.colors ?? null;
  if (!Array.isArray(overlay)) {
    if (isLabelImageLike(overlay)) {
      drawLabelImage(image, overlay, {
        alpha,
        palette,
        outline,
        outlineWidth,
        outlineColor
      });
      return image;
    }
    if (isSegmentationMask(overlay)) overlay = [overlay];
    else if (isROI(overlay)) overlay = [overlay];
    else if (isBoundingBox(overlay)) overlay = [overlay];
    else return image;
  }
  if (overlay.length === 0) return image;
  const first = overlay[0];
  if (isLabelImageLike(first)) {
    throw new TypeError(
      "Pass individual LabelImage objects to applyOverlay, not a list. Per-frame dispatch from a list[LabelImage] should happen at the renderVideo level."
    );
  }
  const colors = explicitColors ?? getPalette(palette, overlay.length);
  if (isSegmentationMask(first)) {
    drawMasks(image, overlay, { colors, alpha });
  } else if (isROI(first)) {
    drawRois(image, overlay, { colors, fillAlpha: alpha });
  } else if (isBoundingBox(first)) {
    drawBboxes(image, overlay, { colors, fillAlpha: alpha });
  } else {
    throw new TypeError(
      `Unsupported overlay element type: ${first?.constructor?.name ?? typeof first}. Expected SegmentationMask, ROI, or BoundingBox.`
    );
  }
  return image;
}

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
  overlayOutlineColor: null
};
var DEFAULT_COLOR = PALETTES.standard[0];
async function renderImage(source, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { instances, skeleton, frameSize, frameIdx, tracks, trackIndexMap } = extractSourceData(source, opts);
  let effectiveOverlay = opts.overlay ?? void 0;
  if (effectiveOverlay == null && !Array.isArray(source)) {
    const renderedFrame = renderedLabeledFrame(source);
    if (renderedFrame && renderedFrame.masks.length > 0) {
      effectiveOverlay = [...renderedFrame.masks];
    }
  }
  const trailsPossible = opts.showTrails && opts.trailLength > 0 && !Array.isArray(source);
  if (instances.length === 0 && !opts.image && !hasNonInstanceAnnotations(source) && !trailsPossible) {
    throw new Error("No instances to render and no background image provided");
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
  const hasTracks = !Array.isArray(source) && "labeledFrames" in source ? source.tracks.length > 0 : instances.some((inst) => inst.track != null);
  const colorScheme = determineColorScheme(opts.colorBy, hasTracks, true);
  const globalTrackIndexMap = opts.overlayTrackIndexMap ? opts.overlayTrackIndexMap : trackIndexMap;
  const globalTracks = opts.overlayTrackIndexMap ? Array.from(opts.overlayTrackIndexMap.keys()) : tracks;
  const frameCentroids = Array.isArray(source) ? [] : renderedLabeledFrame(source)?.centroids ?? [];
  let centroidColors = [];
  if (frameCentroids.length > 0) {
    const cPal = getPalette(
      opts.palette,
      Math.max(globalTracks.length, 1)
    );
    centroidColors = frameCentroids.map((c) => {
      const tidx = c.track ? globalTrackIndexMap.get(c.track) : void 0;
      return tidx !== void 0 ? cPal[tidx % cPal.length] : cPal[0] ?? DEFAULT_COLOR;
    });
  }
  const hasOverlay = effectiveOverlay !== void 0 && effectiveOverlay !== null;
  if (hasOverlay || frameCentroids.length > 0) {
    const trackColorable = opts.overlayTrackIndexMap != null || !Array.isArray(source) && "labeledFrames" in source;
    let overlayColors = null;
    if (hasOverlay && colorScheme === "track" && trackColorable && globalTrackIndexMap.size > 0 && Array.isArray(effectiveOverlay) && effectiveOverlay.length > 0) {
      const ovPal = getPalette(
        opts.palette,
        Math.max(globalTrackIndexMap.size, 1)
      );
      overlayColors = effectiveOverlay.map(
        (el) => {
          const tidx = el.track ? globalTrackIndexMap.get(el.track) : void 0;
          return tidx !== void 0 ? ovPal[tidx % ovPal.length] : ovPal[0];
        }
      );
    }
    const overlayOpts = {
      alpha: opts.overlayAlpha,
      palette: opts.overlayPalette,
      outline: opts.overlayOutline,
      outlineWidth: opts.overlayOutlineWidth,
      outlineColor: opts.overlayOutlineColor,
      colors: overlayColors
    };
    const applySourceSpace = (imageData) => {
      if (hasOverlay) {
        applyOverlay(imageData, effectiveOverlay, overlayOpts);
      }
      if (frameCentroids.length > 0) {
        drawCentroids(imageData, frameCentroids, {
          colors: centroidColors,
          markerSize: opts.markerSize,
          alpha: opts.alpha
        });
      }
    };
    if (opts.scale === 1) {
      const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
      applySourceSpace(imageData);
      ctx.putImageData(imageData, 0, 0);
    } else {
      const srcCanvas = new Canvas(width, height);
      const srcCtx = srcCanvas.getContext("2d");
      srcCtx.drawImage(canvas, 0, 0, width, height);
      const imageData = srcCtx.getImageData(0, 0, width, height);
      applySourceSpace(imageData);
      srcCtx.putImageData(imageData, 0, 0);
      ctx.clearRect(0, 0, scaledWidth, scaledHeight);
      ctx.drawImage(srcCanvas, 0, 0, scaledWidth, scaledHeight);
    }
  }
  const edgeInds = skeleton?.edgeIndices ?? [];
  const nodeNames = skeleton?.nodeNames ?? [];
  const colors = buildColorMap(
    colorScheme,
    instances,
    nodeNames.length,
    opts.palette,
    globalTracks,
    globalTrackIndexMap
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
  if (trailsPossible) {
    const labelsFrame = source;
    const framesByIdx = resolveTrailFrames(
      labelsFrame,
      frameIdx,
      options.trailFrames
    );
    const trailSkeleton = skeleton ?? firstSkeletonIn(framesByIdx);
    if (framesByIdx && framesByIdx.size > 0 && trailSkeleton) {
      const trailTracks = "labeledFrames" in labelsFrame ? labelsFrame.tracks : options.trailTracks ?? collectTracks(framesByIdx.values());
      const trailHasTracks = trailTracks.length > 0;
      const trailTrackIndexMap = new Map(trailTracks.map((t, i) => [t, i]));
      const nColors = nTrailPaletteColors(
        trailHasTracks,
        trailTracks.length,
        framesByIdx.values()
      );
      const trailPalette = getPalette(opts.palette, nColors);
      const trailTargets = resolveTrailNode(opts.trailNode, trailSkeleton);
      const { trails, colors: trailColors } = computeTrails({
        frameIdx,
        frameIdxToLf: framesByIdx,
        trailLength: opts.trailLength,
        trailTargets,
        trackIndexMap: trailTrackIndexMap,
        paletteColors: trailPalette,
        hasTracks: trailHasTracks,
        ptsCache: options.trailPtsCache
      });
      if (trails.length > 0) {
        const trailDrawOpts = {
          lineWidth: opts.trailWidth,
          alphaFade: opts.trailAlphaFade,
          alpha: opts.trailAlpha,
          scale: opts.scale,
          offset: [0, 0]
        };
        if (opts.trailColor != null) {
          trailDrawOpts.color = resolveColor(opts.trailColor);
        } else {
          trailDrawOpts.colors = trailColors;
        }
        drawTrails(
          ctx,
          trails,
          trailDrawOpts
        );
      }
    }
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
      const trackIdx = instance.track ? globalTrackIndexMap.get(instance.track) ?? null : null;
      const instCtx = new InstanceContext(
        ctx,
        instIdx,
        points,
        edgeInds,
        nodeNames,
        trackIdx,
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
  return ctx.getImageData(
    0,
    0,
    scaledWidth,
    scaledHeight
  );
}
function renderedLabeledFrame(source) {
  if ("labeledFrames" in source) {
    return source.labeledFrames[0];
  }
  return source;
}
function hasNonInstanceAnnotations(source) {
  if (Array.isArray(source)) return false;
  const lf = "labeledFrames" in source ? source.labeledFrames[0] : source;
  if (!lf) return false;
  return (lf.labelImages?.length ?? 0) > 0 || (lf.masks?.length ?? 0) > 0 || (lf.bboxes?.length ?? 0) > 0 || (lf.rois?.length ?? 0) > 0 || (lf.centroids?.length ?? 0) > 0;
}
function resolveTrailFrames(source, frameIdx, trailFrames) {
  if ("labeledFrames" in source) {
    const rendered = source.labeledFrames[0];
    if (!rendered) return null;
    const map = /* @__PURE__ */ new Map();
    for (const lf of source.find({ video: rendered.video })) {
      map.set(lf.frameIdx, lf);
    }
    return map;
  }
  if (trailFrames instanceof Map) return trailFrames;
  if (Array.isArray(trailFrames)) {
    const map = /* @__PURE__ */ new Map();
    for (const lf of trailFrames) map.set(lf.frameIdx, lf);
    return map;
  }
  return /* @__PURE__ */ new Map([[frameIdx, source]]);
}
function firstSkeletonIn(framesByIdx) {
  if (!framesByIdx) return null;
  for (const lf of framesByIdx.values()) {
    if (lf.instances.length > 0) return lf.instances[0].skeleton;
  }
  return null;
}
function extractSourceData(source, options) {
  if (Array.isArray(source)) {
    const instances = source;
    const skeleton2 = instances.length > 0 ? instances[0].skeleton : null;
    const trackSet = /* @__PURE__ */ new Set();
    for (const inst of instances) {
      if (inst.track) trackSet.add(inst.track);
    }
    const tracks2 = Array.from(trackSet);
    const trackIndexMap2 = /* @__PURE__ */ new Map();
    tracks2.forEach((t, i) => {
      trackIndexMap2.set(t, i);
    });
    return {
      instances,
      skeleton: skeleton2,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks: tracks2,
      trackIndexMap: trackIndexMap2
    };
  }
  if ("instances" in source && "frameIdx" in source && !("labeledFrames" in source)) {
    const frame = source;
    const skeleton2 = frame.instances.length > 0 ? frame.instances[0].skeleton : null;
    const trackSet = /* @__PURE__ */ new Set();
    for (const inst of frame.instances) {
      if (inst.track) trackSet.add(inst.track);
    }
    const tracks2 = Array.from(trackSet);
    const trackIndexMap2 = /* @__PURE__ */ new Map();
    tracks2.forEach((t, i) => {
      trackIndexMap2.set(t, i);
    });
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
      tracks: tracks2,
      trackIndexMap: trackIndexMap2
    };
  }
  const labels = source;
  if (labels.labeledFrames.length === 0) {
    const tracks2 = labels.tracks ?? [];
    const trackIndexMap2 = /* @__PURE__ */ new Map();
    tracks2.forEach((t, i) => {
      trackIndexMap2.set(t, i);
    });
    return {
      instances: [],
      skeleton: labels.skeletons?.[0] ?? null,
      frameSize: [options.width ?? 0, options.height ?? 0],
      frameIdx: 0,
      tracks: tracks2,
      trackIndexMap: trackIndexMap2
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
  const tracks = labels.tracks ?? [];
  const trackIndexMap = /* @__PURE__ */ new Map();
  tracks.forEach((t, i) => {
    trackIndexMap.set(t, i);
  });
  return {
    instances: firstFrame.instances,
    skeleton,
    frameSize,
    frameIdx: firstFrame.frameIdx,
    tracks,
    trackIndexMap
  };
}
function getInstancePoints(instance) {
  return instance.points.map((point) => [point.xy[0], point.xy[1]]);
}
function buildColorMap(scheme, instances, nNodes, paletteName, tracks, trackIndexMap) {
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
          const trackIdx = trackIndexMap.get(inst.track);
          if (trackIdx !== void 0) {
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
async function saveImage(imageData, path5) {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  await canvas.saveAs(path5);
}

// src/rendering/video.ts
async function checkFfmpeg() {
  const { spawn } = await import("child_process");
  return new Promise((resolve3) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve3(false));
    proc.on("close", (code) => resolve3(code === 0));
  });
}
async function renderVideo(source, outputPath, options = {}) {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    throw new Error(
      "ffmpeg not found. Please install ffmpeg and ensure it is in your PATH.\nInstallation: https://ffmpeg.org/download.html"
    );
  }
  const { selectedFrames, optsForFrame } = buildFrameRenderer(source, options);
  const firstImage = await renderImage(
    selectedFrames[0],
    optsForFrame(selectedFrames[0], 0)
  );
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
    const imageData = await renderImage(frame, optsForFrame(frame, i));
    const buffer = Buffer.from(imageData.data.buffer);
    if (!ffmpeg.stdin) {
      throw new Error("ffmpeg stdin not available");
    }
    const canWrite = ffmpeg.stdin.write(buffer);
    if (!canWrite) {
      await new Promise(
        (resolve3) => ffmpeg.stdin?.once("drain", resolve3)
      );
    }
    if (options.onProgress) {
      options.onProgress(i + 1, total);
    }
  }
  ffmpeg.stdin?.end();
  return new Promise((resolve3, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve3();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);
  });
}
function buildFrameRenderer(source, options = {}) {
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
  let videoOverlay = options.overlay;
  if (videoOverlay === void 0 && !Array.isArray(source) && source.labelImages.length > 0) {
    const targetVideo = selectedFrames[0].video;
    const videoLabelImages = source.getLabelImages({ video: targetVideo });
    if (videoLabelImages.length > 0) {
      videoOverlay = videoLabelImages;
    }
  }
  if (videoOverlay === void 0 && !Array.isArray(source) && source.masks.length > 0) {
    const targetVideo = selectedFrames[0].video;
    const labels = source;
    if (labels.getMasks({ video: targetVideo }).length > 0) {
      videoOverlay = (frameIdx) => labels.getMasks({ video: targetVideo, frameIdx });
    }
  }
  const overlayForFrame = makeOverlayResolver(videoOverlay);
  const framesByVideo = /* @__PURE__ */ new Map();
  const trailPtsCache = options.showTrails ? /* @__PURE__ */ new Map() : void 0;
  const canonicalTracks = Array.isArray(source) ? void 0 : source.tracks;
  const globalTracks = canonicalTracks ?? [];
  const hasTracks = globalTracks.length > 0;
  const resolvedScheme = determineColorScheme(
    options.colorBy ?? "auto",
    hasTracks,
    false
  );
  const overlayTrackIndexMap = hasTracks ? new Map(globalTracks.map((t, i) => [t, i])) : void 0;
  if (options.showTrails) {
    for (const lf of frames) {
      let videoFrames = framesByVideo.get(lf.video);
      if (!videoFrames) {
        videoFrames = /* @__PURE__ */ new Map();
        framesByVideo.set(lf.video, videoFrames);
      }
      videoFrames.set(lf.frameIdx, lf);
    }
  }
  const optsForFrame = (frame, position) => {
    const { overlay: _ignored, ...rest } = options;
    void _ignored;
    const base = options.showTrails ? {
      ...rest,
      trailFrames: framesByVideo.get(frame.video),
      trailTracks: options.trailTracks ?? canonicalTracks,
      trailPtsCache
    } : { ...rest };
    base.overlay = overlayForFrame(frame, position);
    base.colorBy = resolvedScheme;
    base.overlayTrackIndexMap = overlayTrackIndexMap;
    return base;
  };
  return { selectedFrames, optsForFrame };
}
function isLabelImageLike2(value) {
  return typeof value === "object" && value !== null && "data" in value && value.data instanceof Int32Array;
}
function isLabelImageList(value) {
  return Array.isArray(value) && value.length > 0 && isLabelImageLike2(value[0]);
}
function makeOverlayResolver(overlay) {
  if (overlay === void 0) {
    return () => void 0;
  }
  if (typeof overlay === "function") {
    const fn = overlay;
    return (frame) => fn(frame.frameIdx);
  }
  if (overlay instanceof Map) {
    const map = overlay;
    return (frame) => map.get(frame.frameIdx);
  }
  if (isLabelImageList(overlay)) {
    const list = overlay;
    return (_frame, position) => position < list.length ? list[position] : void 0;
  }
  const staticOverlay = overlay;
  return () => staticOverlay;
}
export {
  AUTO_VIDEO_MATCHER,
  AnnotationType,
  BASENAME_VIDEO_MATCHER,
  BlobByteSource,
  BoundingBox,
  CENTROID_SKELETON,
  CLOUD_SCHEMES,
  Camera,
  CameraGroup,
  Centroid,
  ConflictResolution,
  CropVideoBackend,
  DEFAULT_MAX_BYTES,
  DUPLICATE_MATCHER,
  EXISTS_TTL_MS,
  Edge,
  ErrorMode,
  FrameGroup,
  FrameStrategy,
  GDRIVE_HOSTS,
  IDENTITY_INSTANCE_MATCHER,
  IDENTITY_TRACK_MATCHER,
  IMAGE_DEDUP_VIDEO_MATCHER,
  IOU_MATCHER,
  Identity,
  ImageVideoBackend,
  Instance,
  Instance3D,
  InstanceContext,
  InstanceGroup,
  InstanceMatchMethod,
  InstanceMatcher,
  JABS_DEFAULT_EDGE_INDICES,
  JABS_DEFAULT_KEYPOINT_NAMES,
  JABS_DEFAULT_SKELETON,
  JABS_DEFAULT_SYMMETRY_INDICES,
  LabelImage,
  LabeledFrame,
  Labels,
  LabelsSet,
  LazyDataStore,
  LazyFrameList,
  MARKER_FUNCTIONS,
  MatchResult,
  MediaBunnyVideoBackend,
  MergeError,
  MergeProgressBar,
  MergeResult,
  Mp4BoxVideoBackend,
  NAMED_COLORS,
  NAME_TRACK_MATCHER,
  Node,
  OVERLAP_SKELETON_MATCHER,
  PALETTES,
  PATH_VIDEO_MATCHER,
  PointView,
  PredictedBoundingBox,
  PredictedCentroid,
  PredictedInstance,
  PredictedInstance3D,
  PredictedLabelImage,
  PredictedROI,
  PredictedSegmentationMask,
  RETRYABLE_STATUSES,
  ROI,
  RecordingSession,
  RemoteIOError,
  RenderContext,
  SENSITIVE_HEADERS,
  SENSITIVE_QUERY_PARAMS,
  SHAPE_VIDEO_MATCHER,
  STRUCTURE_SKELETON_MATCHER,
  SUBSET_SKELETON_MATCHER,
  SegmentationMask,
  SeqHeader,
  SeqIndex,
  SeqVideoBackend,
  Skeleton,
  SkeletonMatchMethod,
  SkeletonMatcher,
  SkeletonMismatchError,
  StreamingH5File,
  StreamingHdf5VideoBackend,
  SuggestionFrame,
  Symmetry,
  Track,
  TrackMatchMethod,
  TrackMatcher,
  URL_SCHEMES,
  UnsupportedVideoFormatError,
  UserBoundingBox,
  UserCentroid,
  UserLabelImage,
  UserROI,
  UserSegmentationMask,
  Video,
  VideoMatchMethod,
  VideoMatcher,
  _annotationCentroidXy,
  _findAnnotationLinkMatches,
  _findAnnotationMatches,
  _registerCentroidFactory,
  _registerMaskFactory,
  _relinkFromPredicted,
  _resolveMergedIsNegative,
  applyOverlay,
  attachConfigSkeleton,
  buildClassNamesFromBboxes,
  buildClassNamesFromRois,
  checkDownloadHost,
  checkFfmpeg,
  classNamesFromConfig,
  clonePoint,
  collectTracks,
  computePrefetchWindow,
  computeTrails,
  createDataYaml,
  createSkeletonFromCategory,
  createSkeletonFromConfig,
  createSplitsFromLabels,
  createVideoBackend,
  cropFrame,
  cropPoints,
  decodeCocoRle,
  decodeCompressedRleCounts,
  decodeKeypoints,
  decodeRle,
  decodeSegmentation,
  decodeWkb,
  decodeYamlSkeleton,
  denormalizeCoordinates,
  detectLineFormat,
  determineColorScheme,
  discoverConfig,
  dlcMergedOrder,
  drawBboxes,
  drawCentroids,
  drawCircle,
  drawCross,
  drawDiamond,
  drawLabelImage,
  drawMasks,
  drawRois,
  drawSquare,
  drawTrails,
  drawTriangle,
  encodePng,
  encodeRle,
  encodeWkb,
  encodeYamlSkeleton,
  extractFrameIndex,
  fetchRetrying,
  fromDict,
  fromNumpy,
  getCentroidSkeleton,
  getImageBytesReader,
  getMarkerFunction,
  getPalette,
  groupRingsIntoPolygons,
  headOrRangeProbe,
  identityHeaders,
  isAnalysisH5File,
  isCocoData,
  isDlcFile,
  isDlcProjectPath,
  isGdriveUrl,
  isStreamingSupported,
  isTrackMateFile,
  isTrainingConfig,
  isUrl,
  labelsFromNumpy,
  labelsToCsv,
  loadAnalysisH5,
  loadCoco,
  loadCocoSet,
  loadDlc,
  loadDlcProject,
  loadDlcSplits,
  loadJabs,
  loadLabelImages,
  loadSlp,
  loadSlpSet,
  loadTrackMate,
  loadUltralytics,
  loadVideo,
  looksLikeDlcConfig,
  makeCameraFromDict,
  makeJabsDefaultSkeleton,
  makeSimpleSkeleton,
  nTrailPaletteColors,
  normalizeCoordinates,
  normalizeLabelIds,
  openGdrive,
  openH5Worker,
  openStreamingH5,
  parseCocoJson,
  parseDataYaml,
  parseDlcCrop,
  parseGdrive,
  parseLabelFile,
  parseRetryAfterMs,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict,
  predictionToInstance,
  probeImageSize,
  raiseRemote,
  rasterizeGeometry,
  readCoco,
  readCocoSet,
  readCsvScorer,
  readDlcConfig,
  readDlcDataframe,
  readDlcSplit,
  readGeoJSON,
  readLabels,
  readLabelsSet,
  readPickle,
  readSkeletonJson,
  readSlpStreaming,
  readTrackMateCsv,
  readTrainingConfigSkeleton,
  readTrainingConfigSkeletons,
  redactUrl,
  redactedCauseSummary,
  renderImage,
  renderVideo,
  resizeNearest,
  resolveColor,
  resolveConfig,
  resolveCropRect,
  resolveTrailNode,
  resolveUrl,
  rgbToCSS,
  rodriguesTransformation,
  roisFromGeoJSON,
  roisToGeoJSON,
  saveAnalysisH5,
  saveImage,
  saveLabelsCsv,
  saveSlp,
  saveSlpSet,
  saveSlpToBytes,
  saveUltralytics,
  setFsResolver,
  setImageBytesReader,
  setLabelImageFileReader,
  setSourceVideo,
  staticObjectToRoi,
  statusToMessage,
  stripCrossOriginHeaders,
  toDataURL,
  toDict,
  toJPEG,
  toNumpy,
  toPNG,
  traceMaskContours,
  uncropPoints,
  urlFromConfirmation,
  videoSetsStemMap,
  warnIfNonlexicographic,
  withRetries,
  writeBboxLabelFile,
  writeGeoJSON,
  writeLabelFile,
  writeLabels,
  writeRoiLabelFile,
  writeSkeletonJson
};
