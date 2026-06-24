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
  _resolveMergedIsNegative,
  collectTracks,
  computePrefetchWindow,
  computeTrails,
  createVideoBackend,
  cropFrame,
  cropPoints,
  decodeRle,
  decodeWkb,
  decodeYamlSkeleton,
  determineColorScheme,
  drawCircle,
  drawCross,
  drawDiamond,
  drawSquare,
  drawTrails,
  drawTriangle,
  encodeRle,
  encodeWkb,
  encodeYamlSkeleton,
  fromDict,
  fromNumpy,
  getCentroidSkeleton,
  getImageBytesReader,
  getMarkerFunction,
  getPalette,
  isAnalysisH5File,
  isStreamingSupported,
  isTrainingConfig,
  labelsFromNumpy,
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
  rasterizeGeometry,
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
  uncropPoints,
  writeGeoJSON,
  writeSkeletonJson
} from "./chunk-6V6GRSIF.js";
import {
  Edge,
  Instance,
  Instance3D,
  Node,
  PredictedInstance,
  PredictedInstance3D,
  Skeleton,
  Symmetry,
  Track,
  _registerCentroidFactory,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict
} from "./chunk-P74PHRSF.js";

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
async function openH5FileNode(module, source) {
  if (typeof source === "string") {
    const file = new module.File(source, "r");
    return { file, close: () => file.close() };
  }
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const { writeFileSync: writeFileSync2, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join: join4 } = await import("path");
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);
    const tempPath = join4(
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
  throw new Error(
    "Node environments only support string paths or byte buffers for SLP inputs."
  );
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
  fileExists: async (path3) => {
    const { existsSync: existsSync3 } = await import("fs");
    return existsSync3(path3);
  },
  readPackageVersion: async () => {
    try {
      const { readFile } = await import("fs/promises");
      const { fileURLToPath } = await import("url");
      const { dirname: dirname3, join: join4 } = await import("path");
      const here = dirname3(fileURLToPath(import.meta.url));
      const candidates = [
        join4(here, "..", "..", "..", "package.json"),
        join4(here, "..", "..", "..", "..", "package.json")
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
  async exists(path3) {
    try {
      await fs.promises.access(path3);
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
  async realpath(path3) {
    try {
      return await fs.promises.realpath(path3);
    } catch {
      return nodePath.resolve(path3);
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
  constructor(path3) {
    this.path = path3;
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
setSeqFileByteSourceFactory((path3) => new NodeFileByteSource(path3));

// src/io/label-images-node.ts
import * as fs3 from "fs";
import * as nodePath2 from "path";
async function readTiffPath(path3) {
  const stat = fs3.statSync(path3);
  if (stat.isDirectory()) {
    const entries = fs3.readdirSync(path3).filter((name) => /\.tiff?$/i.test(name)).sort();
    const files = entries.map(
      (name) => new Uint8Array(fs3.readFileSync(nodePath2.join(path3, name)))
    );
    return { files };
  }
  return new Uint8Array(fs3.readFileSync(path3));
}
setLabelImageFileReader(readTiffPath);

// src/video/node-image-reader.ts
import * as fs4 from "fs";
async function nodeImageReader(path3) {
  return new Uint8Array(await fs4.promises.readFile(path3));
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
function blendChannel(dst, src, alpha) {
  return Math.trunc(dst * (1 - alpha) + src * alpha);
}
function clampAlpha(alpha) {
  if (!Number.isFinite(alpha)) return 0;
  return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
}
function pickColor(colors, i, fallback) {
  if (colors === null || colors.length === 0) return fallback;
  return colors[i % colors.length];
}
function drawMasks(image, masks, opts) {
  const color = opts?.color ?? [255, 0, 0];
  const colors = opts?.colors ?? null;
  const alpha = clampAlpha(opts?.alpha ?? 0.3);
  const imgW = image.width;
  const imgH = image.height;
  const pixels = image.data;
  for (let i = 0; i < masks.length; i++) {
    const mask = masks[i];
    const maskColor = pickColor(colors, i, color);
    const maskData = mask.data;
    let region;
    let x0;
    let y0;
    let drawW;
    let drawH;
    if (mask.hasSpatialTransform) {
      const ext = mask.imageExtent;
      const targetH = ext.height;
      const targetW = ext.width;
      const resized = resizeNearest(
        maskData,
        mask.height,
        mask.width,
        targetH,
        targetW
      );
      const ox = Math.trunc(mask.offset[0]);
      const oy = Math.trunc(mask.offset[1]);
      y0 = Math.max(0, oy);
      x0 = Math.max(0, ox);
      const y1 = Math.min(imgH, oy + targetH);
      const x1 = Math.min(imgW, ox + targetW);
      if (y1 <= y0 || x1 <= x0) continue;
      drawH = y1 - y0;
      drawW = x1 - x0;
      const my0 = y0 - oy;
      const mx0 = x0 - ox;
      region = new Uint8Array(drawH * drawW);
      for (let r = 0; r < drawH; r++) {
        const srcRow = (my0 + r) * targetW + mx0;
        region.set(resized.subarray(srcRow, srcRow + drawW), r * drawW);
      }
    } else {
      drawH = Math.min(mask.height, imgH);
      drawW = Math.min(mask.width, imgW);
      x0 = 0;
      y0 = 0;
      region = new Uint8Array(drawH * drawW);
      for (let r = 0; r < drawH; r++) {
        const srcRow = r * mask.width;
        region.set(maskData.subarray(srcRow, srcRow + drawW), r * drawW);
      }
    }
    const [cr, cg, cb] = maskColor;
    for (let r = 0; r < drawH; r++) {
      for (let c = 0; c < drawW; c++) {
        if (region[r * drawW + c] === 0) continue;
        const px = ((y0 + r) * imgW + (x0 + c)) * 4;
        pixels[px] = blendChannel(pixels[px], cr, alpha);
        pixels[px + 1] = blendChannel(pixels[px + 1], cg, alpha);
        pixels[px + 2] = blendChannel(pixels[px + 2], cb, alpha);
      }
    }
  }
  return image;
}
function drawLabelImage(image, labels, opts) {
  const alpha = clampAlpha(opts?.alpha ?? 0.3);
  const palette = opts?.palette ?? "distinct";
  const outline = opts?.outline ?? false;
  const outlineWidth = opts?.outlineWidth ?? 1;
  const outlineColor = opts?.outlineColor ?? null;
  const labData = labels.data;
  const labH = labels.height;
  const labW = labels.width;
  const scale = opts?.scale ?? labels.scale ?? [1, 1];
  const offset = opts?.offset ?? labels.offset ?? [0, 0];
  let maxId = 0;
  let hasFg = false;
  for (let i = 0; i < labData.length; i++) {
    const v = labData[i];
    if (v > 0) {
      hasFg = true;
      if (v > maxId) maxId = v;
    }
  }
  if (!hasFg) return image;
  const paletteColors = getPalette(palette, maxId + 1);
  const lut = new Float32Array((maxId + 1) * 3);
  for (let id = 1; id <= maxId; id++) {
    const col = paletteColors[id % paletteColors.length];
    lut[id * 3] = col[0];
    lut[id * 3 + 1] = col[1];
    lut[id * 3 + 2] = col[2];
  }
  const imgW = image.width;
  const imgH = image.height;
  const pixels = image.data;
  const hasTransform = scale[0] !== 1 || scale[1] !== 1 || offset[0] !== 0 || offset[1] !== 0;
  let region;
  let x0;
  let y0;
  let drawW;
  let drawH;
  if (hasTransform) {
    const sx = scale[0];
    const sy = scale[1];
    const targetH = Math.trunc(labH / sy);
    const targetW = Math.trunc(labW / sx);
    const resized = resizeNearest(labData, labH, labW, targetH, targetW);
    const ox = Math.trunc(offset[0]);
    const oy = Math.trunc(offset[1]);
    y0 = Math.max(0, oy);
    x0 = Math.max(0, ox);
    const y1 = Math.min(imgH, oy + targetH);
    const x1 = Math.min(imgW, ox + targetW);
    if (y1 <= y0 || x1 <= x0) return image;
    drawH = y1 - y0;
    drawW = x1 - x0;
    const my0 = y0 - oy;
    const mx0 = x0 - ox;
    region = new Int32Array(drawH * drawW);
    for (let r = 0; r < drawH; r++) {
      const srcRow = (my0 + r) * targetW + mx0;
      region.set(resized.subarray(srcRow, srcRow + drawW), r * drawW);
    }
  } else {
    drawH = Math.min(labH, imgH);
    drawW = Math.min(labW, imgW);
    x0 = 0;
    y0 = 0;
    region = new Int32Array(drawH * drawW);
    for (let r = 0; r < drawH; r++) {
      const srcRow = r * labW;
      region.set(labData.subarray(srcRow, srcRow + drawW), r * drawW);
    }
  }
  for (let r = 0; r < drawH; r++) {
    for (let c = 0; c < drawW; c++) {
      const lab = region[r * drawW + c];
      if (lab <= 0) continue;
      const safe = lab > maxId ? maxId : lab;
      const li = safe * 3;
      const px = ((y0 + r) * imgW + (x0 + c)) * 4;
      pixels[px] = Math.trunc(pixels[px] * (1 - alpha) + lut[li] * alpha);
      pixels[px + 1] = Math.trunc(
        pixels[px + 1] * (1 - alpha) + lut[li + 1] * alpha
      );
      pixels[px + 2] = Math.trunc(
        pixels[px + 2] * (1 - alpha) + lut[li + 2] * alpha
      );
    }
  }
  if (outline) {
    drawLabelOutlines(
      image,
      region,
      x0,
      y0,
      drawH,
      drawW,
      outlineWidth,
      outlineColor,
      lut,
      maxId
    );
  }
  return image;
}
function drawLabelOutlines(image, region, x0, y0, drawH, drawW, outlineWidth, outlineColor, lut, maxId) {
  const imgW = image.width;
  const pixels = image.data;
  const edges = new Uint8Array(drawH * drawW);
  const at = (r, c) => region[r * drawW + c];
  for (let r = 0; r < drawH; r++) {
    for (let c = 0; c < drawW; c++) {
      const v = at(r, c);
      let edge = false;
      if (c + 1 < drawW && v !== at(r, c + 1)) edge = true;
      if (!edge && c - 1 >= 0 && v !== at(r, c - 1)) edge = true;
      if (!edge && r + 1 < drawH && v !== at(r + 1, c)) edge = true;
      if (!edge && r - 1 >= 0 && v !== at(r - 1, c)) edge = true;
      if (edge && v > 0) edges[r * drawW + c] = 1;
    }
  }
  let finalEdges = edges;
  if (outlineWidth > 1) {
    const pad = Math.trunc(outlineWidth / 2);
    const dilated = new Uint8Array(drawH * drawW);
    for (let dy = -pad; dy <= pad; dy++) {
      for (let dx = -pad; dx <= pad; dx++) {
        const sy = Math.max(0, dy);
        const ey = drawH + Math.min(0, dy);
        const sx = Math.max(0, dx);
        const ex = drawW + Math.min(0, dx);
        const oy = Math.max(0, -dy);
        const ox = Math.max(0, -dx);
        for (let r = sy; r < ey; r++) {
          for (let c = sx; c < ex; c++) {
            if (edges[(oy + (r - sy)) * drawW + (ox + (c - sx))]) {
              dilated[r * drawW + c] = 1;
            }
          }
        }
      }
    }
    for (let i = 0; i < dilated.length; i++) {
      if (dilated[i] && region[i] > 0) dilated[i] = 1;
      else dilated[i] = 0;
    }
    finalEdges = dilated;
  }
  for (let r = 0; r < drawH; r++) {
    for (let c = 0; c < drawW; c++) {
      if (!finalEdges[r * drawW + c]) continue;
      const px = ((y0 + r) * imgW + (x0 + c)) * 4;
      if (outlineColor !== null) {
        pixels[px] = outlineColor[0];
        pixels[px + 1] = outlineColor[1];
        pixels[px + 2] = outlineColor[2];
      } else {
        const lab = region[r * drawW + c];
        const safe = lab > maxId ? maxId : lab;
        const li = safe * 3;
        pixels[px] = Math.trunc(lut[li] * 0.6);
        pixels[px + 1] = Math.trunc(lut[li + 1] * 0.6);
        pixels[px + 2] = Math.trunc(lut[li + 2] * 0.6);
      }
    }
  }
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
  if (!Array.isArray(overlay)) {
    if (isLabelImageLike(overlay)) {
      drawLabelImage(image, overlay, {
        alpha,
        palette,
        outline,
        outlineWidth,
        outlineColor
      });
    }
    return image;
  }
  if (overlay.length === 0) return image;
  const first = overlay[0];
  if (isLabelImageLike(first)) {
    throw new TypeError(
      "Pass individual LabelImage objects to applyOverlay, not a list. Per-frame dispatch from a list[LabelImage] should happen at the renderVideo level."
    );
  }
  const colors = getPalette(palette, overlay.length);
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
  if (opts.overlay !== void 0 && opts.overlay !== null) {
    const overlayOpts = {
      alpha: opts.overlayAlpha,
      palette: opts.overlayPalette,
      outline: opts.overlayOutline,
      outlineWidth: opts.overlayOutlineWidth,
      outlineColor: opts.overlayOutlineColor
    };
    if (opts.scale === 1) {
      const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
      applyOverlay(
        imageData,
        opts.overlay,
        overlayOpts
      );
      ctx.putImageData(imageData, 0, 0);
    } else {
      const srcCanvas = new Canvas(width, height);
      const srcCtx = srcCanvas.getContext("2d");
      srcCtx.drawImage(canvas, 0, 0, width, height);
      const imageData = srcCtx.getImageData(0, 0, width, height);
      applyOverlay(
        imageData,
        opts.overlay,
        overlayOpts
      );
      srcCtx.putImageData(imageData, 0, 0);
      ctx.clearRect(0, 0, scaledWidth, scaledHeight);
      ctx.drawImage(srcCanvas, 0, 0, scaledWidth, scaledHeight);
    }
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
    tracks,
    trackIndexMap
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
      const trackIdx = instance.track ? trackIndexMap.get(instance.track) ?? null : null;
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
async function saveImage(imageData, path3) {
  const { Canvas } = await import("skia-canvas");
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  await canvas.saveAs(path3);
}

// src/rendering/video.ts
async function checkFfmpeg() {
  const { spawn } = await import("child_process");
  return new Promise((resolve2) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve2(false));
    proc.on("close", (code) => resolve2(code === 0));
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
  let videoOverlay = options.overlay;
  if (videoOverlay === void 0 && !Array.isArray(source) && source.labelImages.length > 0) {
    const targetVideo = selectedFrames[0].video;
    const videoLabelImages = source.getLabelImages({ video: targetVideo });
    if (videoLabelImages.length > 0) {
      videoOverlay = videoLabelImages;
    }
  }
  const overlayForFrame = makeOverlayResolver(videoOverlay);
  const framesByVideo = /* @__PURE__ */ new Map();
  const trailPtsCache = options.showTrails ? /* @__PURE__ */ new Map() : void 0;
  const canonicalTracks = Array.isArray(source) ? void 0 : source.tracks;
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
    return base;
  };
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
        (resolve2) => ffmpeg.stdin?.once("drain", resolve2)
      );
    }
    if (options.onProgress) {
      options.onProgress(i + 1, total);
    }
  }
  ffmpeg.stdin?.end();
  return new Promise((resolve2, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve2();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);
  });
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
  Camera,
  CameraGroup,
  Centroid,
  ConflictResolution,
  CropVideoBackend,
  DUPLICATE_MATCHER,
  Edge,
  ErrorMode,
  FrameGroup,
  FrameStrategy,
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
  PredictedBoundingBox,
  PredictedCentroid,
  PredictedInstance,
  PredictedInstance3D,
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
  _resolveMergedIsNegative,
  applyOverlay,
  buildClassNamesFromBboxes,
  buildClassNamesFromRois,
  checkFfmpeg,
  classNamesFromConfig,
  collectTracks,
  computePrefetchWindow,
  computeTrails,
  createDataYaml,
  createSkeletonFromConfig,
  createSplitsFromLabels,
  createVideoBackend,
  cropFrame,
  cropPoints,
  decodeRle,
  decodeWkb,
  decodeYamlSkeleton,
  denormalizeCoordinates,
  detectLineFormat,
  determineColorScheme,
  drawBboxes,
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
  fromDict,
  fromNumpy,
  getCentroidSkeleton,
  getImageBytesReader,
  getMarkerFunction,
  getPalette,
  isAnalysisH5File,
  isStreamingSupported,
  isTrackMateFile,
  isTrainingConfig,
  labelsFromNumpy,
  loadAnalysisH5,
  loadJabs,
  loadLabelImages,
  loadSlp,
  loadSlpSet,
  loadTrackMate,
  loadUltralytics,
  loadVideo,
  makeCameraFromDict,
  makeJabsDefaultSkeleton,
  makeSimpleSkeleton,
  nTrailPaletteColors,
  normalizeCoordinates,
  normalizeLabelIds,
  openH5Worker,
  openStreamingH5,
  parseDataYaml,
  parseLabelFile,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict,
  predictionToInstance,
  probeImageSize,
  rasterizeGeometry,
  readGeoJSON,
  readLabels,
  readLabelsSet,
  readSkeletonJson,
  readSlpStreaming,
  readTrackMateCsv,
  readTrainingConfigSkeleton,
  readTrainingConfigSkeletons,
  renderImage,
  renderVideo,
  resizeNearest,
  resolveColor,
  resolveCropRect,
  resolveTrailNode,
  rgbToCSS,
  rodriguesTransformation,
  roisFromGeoJSON,
  roisToGeoJSON,
  saveAnalysisH5,
  saveImage,
  saveSlp,
  saveSlpSet,
  saveSlpToBytes,
  saveUltralytics,
  setFsResolver,
  setImageBytesReader,
  setLabelImageFileReader,
  staticObjectToRoi,
  toDataURL,
  toDict,
  toJPEG,
  toNumpy,
  toPNG,
  uncropPoints,
  writeBboxLabelFile,
  writeGeoJSON,
  writeLabelFile,
  writeLabels,
  writeRoiLabelFile,
  writeSkeletonJson
};
