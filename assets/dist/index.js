// src/model/instance.ts
var Track = class {
  name;
  constructor(name) {
    this.name = name;
  }
};
function pointsEmpty(length, names) {
  const pts = [];
  for (let i = 0; i < length; i += 1) {
    pts.push({
      xy: [Number.NaN, Number.NaN],
      visible: false,
      complete: false,
      name: names?.[i]
    });
  }
  return pts;
}
function predictedPointsEmpty(length, names) {
  const pts = [];
  for (let i = 0; i < length; i += 1) {
    pts.push({
      xy: [Number.NaN, Number.NaN],
      visible: false,
      complete: false,
      score: Number.NaN,
      name: names?.[i]
    });
  }
  return pts;
}
function pointsFromArray(array, names) {
  const pts = [];
  for (let i = 0; i < array.length; i += 1) {
    const row = array[i] ?? [Number.NaN, Number.NaN];
    const visible = row.length > 2 ? Boolean(row[2]) : !Number.isNaN(row[0]);
    const complete = row.length > 3 ? Boolean(row[3]) : false;
    pts.push({ xy: [row[0] ?? Number.NaN, row[1] ?? Number.NaN], visible, complete, name: names?.[i] });
  }
  return pts;
}
function predictedPointsFromArray(array, names) {
  const pts = [];
  for (let i = 0; i < array.length; i += 1) {
    const row = array[i] ?? [Number.NaN, Number.NaN, Number.NaN];
    const visible = row.length > 3 ? Boolean(row[3]) : !Number.isNaN(row[0]);
    const complete = row.length > 4 ? Boolean(row[4]) : false;
    pts.push({
      xy: [row[0] ?? Number.NaN, row[1] ?? Number.NaN],
      score: row[2] ?? Number.NaN,
      visible,
      complete,
      name: names?.[i]
    });
  }
  return pts;
}
var Instance = class _Instance {
  points;
  skeleton;
  track;
  fromPredicted;
  trackingScore;
  constructor(options) {
    this.skeleton = options.skeleton;
    this.track = options.track ?? null;
    this.fromPredicted = options.fromPredicted ?? null;
    this.trackingScore = options.trackingScore ?? 0;
    if (Array.isArray(options.points)) {
      this.points = options.points;
    } else {
      this.points = pointsFromDict(options.points, options.skeleton);
    }
  }
  static fromArray(points, skeleton) {
    return new _Instance({ points: pointsFromArray(points, skeleton.nodeNames), skeleton });
  }
  static fromNumpy(options) {
    return new _Instance({
      points: pointsFromArray(options.pointsData, options.skeleton.nodeNames),
      skeleton: options.skeleton,
      track: options.track ?? null,
      fromPredicted: options.fromPredicted ?? null,
      trackingScore: options.trackingScore
    });
  }
  static empty(options) {
    return new _Instance({ points: pointsEmpty(options.skeleton.nodeNames.length, options.skeleton.nodeNames), skeleton: options.skeleton });
  }
  get length() {
    return this.points.length;
  }
  get nVisible() {
    return this.points.filter((point) => point.visible).length;
  }
  getPoint(target) {
    if (typeof target === "number") {
      if (target < 0 || target >= this.points.length) throw new Error("Point index out of range.");
      return this.points[target];
    }
    if (typeof target === "string") {
      const index2 = this.skeleton.index(target);
      return this.points[index2];
    }
    const index = this.skeleton.index(target.name);
    return this.points[index];
  }
  numpy(options) {
    const invisibleAsNaN = options?.invisibleAsNaN ?? true;
    return this.points.map((point) => {
      if (invisibleAsNaN && !point.visible) {
        return [Number.NaN, Number.NaN];
      }
      return [point.xy[0], point.xy[1]];
    });
  }
  toString() {
    const trackName = this.track ? `"${this.track.name}"` : "None";
    return `Instance(points=${JSON.stringify(this.numpy({ invisibleAsNaN: false }))}, track=${trackName})`;
  }
  get isEmpty() {
    return this.points.every((point) => !point.visible || Number.isNaN(point.xy[0]));
  }
  overlapsWith(other, iouThreshold = 0.1) {
    const boxA = this.boundingBox();
    const boxB = other.boundingBox();
    if (!boxA || !boxB) return false;
    const iou = intersectionOverUnion(boxA, boxB);
    return iou >= iouThreshold;
  }
  boundingBox() {
    const xs = [];
    const ys = [];
    for (const point of this.points) {
      if (Number.isNaN(point.xy[0]) || Number.isNaN(point.xy[1])) continue;
      xs.push(point.xy[0]);
      ys.push(point.xy[1]);
    }
    if (!xs.length || !ys.length) return null;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return [minX, minY, maxX, maxY];
  }
};
var PredictedInstance = class _PredictedInstance extends Instance {
  score;
  constructor(options) {
    const { score = 0, ...rest } = options;
    const pts = Array.isArray(rest.points) ? rest.points : predictedPointsFromDict(rest.points, rest.skeleton);
    super({
      points: pts,
      skeleton: rest.skeleton,
      track: rest.track,
      trackingScore: rest.trackingScore
    });
    this.score = score;
  }
  static fromArray(points, skeleton, score) {
    return new _PredictedInstance({
      points: predictedPointsFromArray(points, skeleton.nodeNames),
      skeleton,
      score
    });
  }
  static fromNumpy(options) {
    return new _PredictedInstance({
      points: predictedPointsFromArray(options.pointsData, options.skeleton.nodeNames),
      skeleton: options.skeleton,
      track: options.track ?? null,
      score: options.score,
      trackingScore: options.trackingScore
    });
  }
  static empty(options) {
    return new _PredictedInstance({ points: predictedPointsEmpty(options.skeleton.nodeNames.length, options.skeleton.nodeNames), skeleton: options.skeleton });
  }
  numpy(options) {
    const invisibleAsNaN = options?.invisibleAsNaN ?? true;
    return this.points.map((point) => {
      const xy = invisibleAsNaN && !point.visible ? [Number.NaN, Number.NaN] : [point.xy[0], point.xy[1]];
      if (options?.scores) {
        return [xy[0], xy[1], point.score ?? 0];
      }
      return xy;
    });
  }
  toString() {
    const trackName = this.track ? `"${this.track.name}"` : "None";
    return `PredictedInstance(points=${JSON.stringify(this.numpy({ invisibleAsNaN: false }))}, track=${trackName}, score=${this.score.toFixed(2)}, tracking_score=${this.trackingScore ?? "None"})`;
  }
};
function pointsFromDict(pointsDict, skeleton) {
  const points = pointsEmpty(skeleton.nodeNames.length, skeleton.nodeNames);
  for (const [nodeName, data] of Object.entries(pointsDict)) {
    const index = skeleton.index(nodeName);
    points[index] = {
      xy: [data[0] ?? Number.NaN, data[1] ?? Number.NaN],
      visible: data.length > 2 ? Boolean(data[2]) : !Number.isNaN(data[0]),
      complete: data.length > 3 ? Boolean(data[3]) : false,
      name: nodeName
    };
  }
  return points;
}
function predictedPointsFromDict(pointsDict, skeleton) {
  const points = predictedPointsEmpty(skeleton.nodeNames.length, skeleton.nodeNames);
  for (const [nodeName, data] of Object.entries(pointsDict)) {
    const index = skeleton.index(nodeName);
    points[index] = {
      xy: [data[0] ?? Number.NaN, data[1] ?? Number.NaN],
      score: data[2] ?? Number.NaN,
      visible: data.length > 3 ? Boolean(data[3]) : !Number.isNaN(data[0]),
      complete: data.length > 4 ? Boolean(data[4]) : false,
      name: nodeName
    };
  }
  return points;
}
function intersectionOverUnion(boxA, boxB) {
  const [ax1, ay1, ax2, ay2] = boxA;
  const [bx1, by1, bx2, by2] = boxB;
  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);
  const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - interArea;
  if (union === 0) return 0;
  return interArea / union;
}

// src/model/labeled-frame.ts
var LabeledFrame = class {
  video;
  frameIdx;
  instances;
  constructor(options) {
    this.video = options.video;
    this.frameIdx = options.frameIdx;
    this.instances = options.instances ?? [];
  }
  get length() {
    return this.instances.length;
  }
  [Symbol.iterator]() {
    return this.instances[Symbol.iterator]();
  }
  at(index) {
    return this.instances[index];
  }
  get userInstances() {
    return this.instances.filter((inst) => inst instanceof Instance);
  }
  get predictedInstances() {
    return this.instances.filter((inst) => inst instanceof PredictedInstance);
  }
  get hasUserInstances() {
    return this.userInstances.length > 0;
  }
  get hasPredictedInstances() {
    return this.predictedInstances.length > 0;
  }
  numpy() {
    return this.instances.map((inst) => inst.numpy());
  }
  get image() {
    return this.video.getFrame(this.frameIdx);
  }
  get unusedPredictions() {
    const usedPredicted = /* @__PURE__ */ new Set();
    for (const inst of this.instances) {
      if (inst instanceof Instance && inst.fromPredicted) {
        usedPredicted.add(inst.fromPredicted);
      }
    }
    const tracks = this.instances.map((inst) => inst.track).filter((track) => track !== null && track !== void 0);
    if (tracks.length) {
      const usedTracks = new Set(tracks);
      return this.predictedInstances.filter((inst) => !inst.track || !usedTracks.has(inst.track));
    }
    return this.predictedInstances.filter((inst) => !usedPredicted.has(inst));
  }
  removePredictions() {
    this.instances = this.instances.filter((inst) => inst instanceof Instance);
  }
  removeEmptyInstances() {
    this.instances = this.instances.filter((inst) => !inst.isEmpty);
  }
};

// src/model/skeleton.ts
var Node = class {
  name;
  constructor(name) {
    this.name = name;
  }
};
var Edge = class {
  source;
  destination;
  constructor(source, destination) {
    this.source = source;
    this.destination = destination;
  }
  at(index) {
    if (index === 0) return this.source;
    if (index === 1) return this.destination;
    throw new Error("Edge only has 2 nodes (source and destination).");
  }
};
var Symmetry = class {
  nodes;
  constructor(nodes) {
    const set = new Set(nodes);
    if (set.size !== 2) {
      throw new Error("Symmetry must contain exactly 2 nodes.");
    }
    this.nodes = set;
  }
  at(index) {
    let i = 0;
    for (const node of this.nodes) {
      if (i === index) return node;
      i += 1;
    }
    throw new Error("Symmetry index out of range.");
  }
};
var Skeleton = class {
  nodes;
  edges;
  symmetries;
  name;
  nameToNode;
  nodeToIndex;
  constructor(options) {
    const resolved = Array.isArray(options) ? { nodes: options } : options;
    this.nodes = resolved.nodes.map((node) => typeof node === "string" ? new Node(node) : node);
    this.edges = [];
    this.symmetries = [];
    this.name = resolved.name;
    this.nameToNode = /* @__PURE__ */ new Map();
    this.nodeToIndex = /* @__PURE__ */ new Map();
    this.rebuildCache();
    if (resolved.edges) {
      this.edges = resolved.edges.map((edge) => edge instanceof Edge ? edge : this.edgeFrom(edge));
    }
    if (resolved.symmetries) {
      this.symmetries = resolved.symmetries.map(
        (symmetry) => symmetry instanceof Symmetry ? symmetry : this.symmetryFrom(symmetry)
      );
    }
  }
  rebuildCache(nodes = this.nodes) {
    this.nameToNode = new Map(nodes.map((node) => [node.name, node]));
    this.nodeToIndex = new Map(nodes.map((node, index) => [node, index]));
  }
  get nodeNames() {
    return this.nodes.map((node) => node.name);
  }
  index(node) {
    if (typeof node === "number") return node;
    if (typeof node === "string") {
      const found = this.nameToNode.get(node);
      if (!found) throw new Error(`Node '${node}' not found in skeleton.`);
      return this.nodeToIndex.get(found) ?? -1;
    }
    const idx = this.nodeToIndex.get(node);
    if (idx === void 0) throw new Error("Node not found in skeleton.");
    return idx;
  }
  node(node) {
    if (node instanceof Node) return node;
    if (typeof node === "number") return this.nodes[node];
    const found = this.nameToNode.get(node);
    if (!found) throw new Error(`Node '${node}' not found in skeleton.`);
    return found;
  }
  get edgeIndices() {
    return this.edges.map((edge) => [this.index(edge.source), this.index(edge.destination)]);
  }
  get symmetryNames() {
    return this.symmetries.map((symmetry) => {
      const nodes = Array.from(symmetry.nodes).map((node) => node.name);
      return [nodes[0], nodes[1]];
    });
  }
  matches(other) {
    if (this.nodeNames.length !== other.nodeNames.length) return false;
    for (let i = 0; i < this.nodeNames.length; i += 1) {
      if (this.nodeNames[i] !== other.nodeNames[i]) return false;
    }
    return true;
  }
  addEdge(source, destination) {
    this.edges.push(new Edge(this.node(source), this.node(destination)));
  }
  addSymmetry(left, right) {
    this.symmetries.push(new Symmetry([this.node(left), this.node(right)]));
  }
  edgeFrom(edge) {
    const [source, destination] = edge;
    return new Edge(this.node(source), this.node(destination));
  }
  symmetryFrom(symmetry) {
    const [a, b] = symmetry;
    return new Symmetry([this.node(a), this.node(b)]);
  }
};

// src/model/video.ts
var Video = class {
  filename;
  backend;
  backendMetadata;
  sourceVideo;
  openBackend;
  constructor(options) {
    this.filename = options.filename;
    this.backend = options.backend ?? null;
    this.backendMetadata = options.backendMetadata ?? {};
    this.sourceVideo = options.sourceVideo ?? null;
    this.openBackend = options.openBackend ?? true;
  }
  get originalVideo() {
    if (!this.sourceVideo) return null;
    let current = this.sourceVideo;
    while (current.sourceVideo) {
      current = current.sourceVideo;
    }
    return current;
  }
  get shape() {
    return this.backend?.shape ?? this.backendMetadata.shape ?? null;
  }
  get fps() {
    return this.backend?.fps ?? this.backendMetadata.fps ?? null;
  }
  async getFrame(frameIndex) {
    if (!this.backend) return null;
    return this.backend.getFrame(frameIndex);
  }
  async getFrameTimes() {
    if (!this.backend?.getFrameTimes) return null;
    return this.backend.getFrameTimes();
  }
  close() {
    this.backend?.close();
  }
  matchesPath(other, strict = true) {
    if (Array.isArray(this.filename) || Array.isArray(other.filename)) {
      return JSON.stringify(this.filename) === JSON.stringify(other.filename);
    }
    if (strict) return this.filename === other.filename;
    const basenameA = this.filename.split("/").pop();
    const basenameB = other.filename.split("/").pop();
    return basenameA === basenameB;
  }
};

// src/model/suggestions.ts
var SuggestionFrame = class {
  video;
  frameIdx;
  metadata;
  constructor(options) {
    this.video = options.video;
    this.frameIdx = options.frameIdx;
    this.metadata = options.metadata ?? {};
  }
};

// src/video/media-video.ts
var isBrowser = typeof window !== "undefined";
var MediaVideoBackend = class {
  filename;
  shape;
  fps;
  dataset;
  video;
  canvas;
  ctx;
  ready;
  constructor(filename) {
    if (!isBrowser) {
      throw new Error("MediaVideoBackend requires a browser environment.");
    }
    this.filename = filename;
    this.dataset = null;
    this.video = document.createElement("video");
    this.video.src = filename;
    this.video.crossOrigin = "anonymous";
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.ready = new Promise((resolve, reject) => {
      this.video?.addEventListener("loadedmetadata", () => {
        if (!this.video || !this.canvas) return;
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.fps = this.video.duration ? this.video.videoHeight ? void 0 : void 0 : void 0;
        resolve();
      });
      this.video?.addEventListener("error", () => reject(new Error("Failed to load video")));
    });
  }
  async getFrame(frameIndex) {
    if (!this.video || !this.ctx || !this.canvas) return null;
    await this.ready;
    const duration = this.video.duration;
    const frameCount = Math.floor(duration * (this.video?.playbackRate || 1) * 30) || 1;
    const fps = duration ? frameCount / duration : 30;
    const targetTime = frameIndex / fps;
    await seekVideo(this.video, targetTime);
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }
  close() {
    if (this.video) {
      this.video.pause();
      this.video.src = "";
    }
    this.video = null;
    this.canvas = null;
    this.ctx = null;
  }
};
function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      reject(new Error("Video seek failed"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = Math.max(0, time);
  });
}

// src/codecs/dictionary.ts
function toDict(labels, options) {
  const videoFilter = resolveVideoFilter(labels, options?.video);
  const videos = videoFilter ? [videoFilter.video] : labels.videos;
  const tracks = collectTracks(labels, videoFilter?.video);
  const trackIndex = new Map(tracks.map((track, idx) => [track, idx]));
  const skeletons = labels.skeletons.map((skeleton) => {
    const edges = skeleton.edges.map((edge) => [
      skeleton.index(edge.source.name),
      skeleton.index(edge.destination.name)
    ]);
    const symmetries = skeleton.symmetries.map((sym) => {
      const [left, right] = sym.nodes;
      return [skeleton.index(left.name), skeleton.index(right.name)];
    });
    return {
      name: skeleton.name ?? void 0,
      nodes: skeleton.nodeNames,
      edges,
      symmetries
    };
  });
  const labeledFrames = [];
  for (const frame of labels.labeledFrames) {
    if (videoFilter && !frame.video.matchesPath(videoFilter.video, true)) continue;
    if (options?.skipEmptyFrames && frame.instances.length === 0) continue;
    const videoIdx = videos.indexOf(frame.video);
    if (videoIdx < 0) continue;
    labeledFrames.push({
      frame_idx: frame.frameIdx,
      video_idx: videoIdx,
      instances: frame.instances.map((instance) => instanceToDict(instance, labels, trackIndex))
    });
  }
  const suggestions = labels.suggestions.filter((suggestion) => !videoFilter || suggestion.video.matchesPath(videoFilter.video, true)).map((suggestion) => ({
    frame_idx: suggestion.frameIdx,
    video_idx: videos.indexOf(suggestion.video),
    ...suggestion.metadata
  }));
  const videoDicts = videos.map((video) => {
    const backendType = resolveBackendType(video);
    const backend = backendType ? { type: backendType } : void 0;
    const shape = video.shape ? Array.from(video.shape) : void 0;
    const fps = video.fps ?? void 0;
    return {
      filename: video.filename,
      shape,
      fps,
      backend
    };
  });
  return {
    version: "1.0.0",
    skeletons,
    videos: videoDicts,
    tracks: tracks.map((track) => trackToDict(track)),
    labeled_frames: labeledFrames,
    suggestions,
    provenance: labels.provenance ?? {}
  };
}
function fromDict(data) {
  validateDict(data);
  const skeletons = data.skeletons.map((skeleton) => {
    const nodes = skeleton.nodes.map((name) => new Node(name));
    const edges = skeleton.edges.map(([sourceIdx, destIdx]) => new Edge(nodes[sourceIdx], nodes[destIdx]));
    const symmetries = (skeleton.symmetries ?? []).map(
      ([leftIdx, rightIdx]) => new Symmetry([nodes[leftIdx], nodes[rightIdx]])
    );
    return new Skeleton({ name: skeleton.name, nodes, edges, symmetries });
  });
  const videos = data.videos.map((video) => new Video({ filename: video.filename }));
  const tracks = data.tracks.map((track) => new Track(String(track.name ?? "")));
  const labeledFrames = data.labeled_frames.map((frame) => {
    const video = videos[frame.video_idx];
    const instances = frame.instances.map((inst) => dictToInstance(inst, skeletons, tracks));
    return new LabeledFrame({ video, frameIdx: frame.frame_idx, instances });
  });
  const suggestions = data.suggestions.map((suggestion) => {
    const entry = suggestion;
    const video = videos[entry.video_idx ?? 0];
    return new SuggestionFrame({ video, frameIdx: entry.frame_idx ?? 0, metadata: entry });
  });
  return new Labels({
    labeledFrames,
    videos,
    skeletons,
    tracks,
    suggestions,
    provenance: data.provenance ?? {}
  });
}
function resolveVideoFilter(labels, video) {
  if (video === void 0) return null;
  if (typeof video === "number") {
    const entry = labels.videos[video];
    if (!entry) throw new Error("Video index out of range.");
    return { video: entry };
  }
  return { video };
}
function collectTracks(labels, video) {
  const trackSet = /* @__PURE__ */ new Set();
  for (const track of labels.tracks) {
    trackSet.add(track);
  }
  for (const frame of labels.labeledFrames) {
    if (video && !frame.video.matchesPath(video, true)) continue;
    for (const instance of frame.instances) {
      if (instance.track) trackSet.add(instance.track);
    }
  }
  return Array.from(trackSet);
}
function instanceToDict(instance, labels, trackIndex) {
  const skeletonIdx = labels.skeletons.indexOf(instance.skeleton);
  const isPredicted = instance instanceof PredictedInstance;
  const points = instance.points.map((point) => {
    const payload2 = {
      x: point.xy[0],
      y: point.xy[1],
      visible: point.visible,
      complete: point.complete
    };
    if (isPredicted && "score" in point) {
      payload2.score = point.score;
    }
    return payload2;
  });
  const payload = {
    type: isPredicted ? "predicted_instance" : "instance",
    skeleton_idx: skeletonIdx,
    points
  };
  if (instance.track) {
    payload.track_idx = trackIndex.get(instance.track);
  }
  if (isPredicted) {
    payload.score = instance.score;
  }
  if (instance.trackingScore !== void 0) {
    payload.tracking_score = instance.trackingScore;
  }
  if (!isPredicted && instance.fromPredicted) {
    payload.has_from_predicted = true;
  }
  return payload;
}
function dictToInstance(data, skeletons, tracks) {
  const type = data.type === "predicted_instance" ? "predicted" : "instance";
  const skeleton = skeletons[data.skeleton_idx ?? 0] ?? skeletons[0];
  const trackIdx = data.track_idx;
  const track = trackIdx !== void 0 ? tracks[trackIdx] : void 0;
  const points = Array.isArray(data.points) ? data.points : [];
  if (type === "predicted") {
    const pointRows2 = points.map((point) => [
      Number(point.x),
      Number(point.y),
      Number(point.score ?? Number.NaN),
      point.visible ? 1 : 0,
      point.complete ? 1 : 0
    ]);
    return new PredictedInstance({
      points: predictedPointsFromArray(pointRows2, skeleton.nodeNames),
      skeleton,
      track,
      score: Number(data.score ?? 0),
      trackingScore: Number(data.tracking_score ?? 0)
    });
  }
  const pointRows = points.map((point) => [
    Number(point.x),
    Number(point.y),
    point.visible ? 1 : 0,
    point.complete ? 1 : 0
  ]);
  return new Instance({
    points: pointsFromArray(pointRows, skeleton.nodeNames),
    skeleton,
    track,
    trackingScore: Number(data.tracking_score ?? 0)
  });
}
function resolveBackendType(video) {
  if (!video.backend) return null;
  if (video.backend instanceof MediaVideoBackend) return "MediaVideo";
  return video.backend.constructor?.name ?? null;
}
function trackToDict(track) {
  const payload = { name: track.name };
  const spawnedOn = track.spawned_on;
  if (spawnedOn !== void 0) {
    payload.spawned_on = spawnedOn;
  }
  return payload;
}
function validateDict(data) {
  const required = ["version", "skeletons", "videos", "tracks", "labeled_frames", "suggestions", "provenance"];
  for (const key of required) {
    if (!(key in data)) {
      throw new Error(`Missing required key: ${key}`);
    }
  }
}

// src/codecs/numpy.ts
function toNumpy(labels, options) {
  return labels.numpy({ returnConfidence: options?.returnConfidence, video: options?.video });
}
function fromNumpy(data, options) {
  if (data.length === 0 || data[0].length === void 0) {
    throw new Error("Input array must have 4 dimensions.");
  }
  const video = options.video ?? options.videos?.[0];
  if (!video) throw new Error("fromNumpy requires a video.");
  if (options.video && options.videos) {
    throw new Error("Cannot specify both video and videos.");
  }
  const skeleton = resolveSkeleton(options);
  const labels = labelsFromNumpy(data, {
    video,
    skeleton,
    trackNames: options.trackNames,
    firstFrame: options.firstFrame,
    returnConfidence: options.returnConfidence
  });
  return labels;
}
function labelsFromNumpy(data, options) {
  const frameCount = data.length;
  if (!frameCount || data[0].length === void 0) {
    throw new Error("Input array must have 4 dimensions.");
  }
  const trackCount = data[0].length;
  const nodeCount = data[0][0]?.length ?? 0;
  if (!nodeCount) {
    throw new Error("Input array must have node dimension.");
  }
  const trackNames = options.trackNames ?? Array.from({ length: trackCount }, (_, idx) => `track${idx}`);
  const tracks = trackNames.map((name) => new Track(name));
  const labeledFrames = [];
  const startFrame = options.firstFrame ?? 0;
  for (let frameIdx = 0; frameIdx < frameCount; frameIdx += 1) {
    const instances = [];
    for (let trackIdx = 0; trackIdx < trackCount; trackIdx += 1) {
      const points = data[frameIdx][trackIdx];
      if (!points) continue;
      const hasData = points.some((point) => point.some((value) => !Number.isNaN(value)));
      if (!hasData) continue;
      const arrayPoints = points.map((point) => {
        if (options.returnConfidence) {
          return [point[0], point[1], point[2] ?? Number.NaN, 1, 0];
        }
        return [point[0], point[1], 1, 0];
      });
      const instance = new PredictedInstance({
        points: predictedPointsFromArray(arrayPoints, options.skeleton.nodeNames),
        skeleton: options.skeleton,
        track: tracks[trackIdx]
      });
      instances.push(instance);
    }
    labeledFrames.push(new LabeledFrame({
      video: options.video,
      frameIdx: startFrame + frameIdx,
      instances
    }));
  }
  return new Labels({
    labeledFrames,
    videos: [options.video],
    skeletons: [options.skeleton],
    tracks
  });
}
function resolveSkeleton(options) {
  if (options.skeleton) return options.skeleton;
  if (Array.isArray(options.skeletons) && options.skeletons.length) return options.skeletons[0];
  if (options.skeletons && !Array.isArray(options.skeletons)) return options.skeletons;
  throw new Error("fromNumpy requires a skeleton.");
}

// src/model/labels.ts
var Labels = class {
  labeledFrames;
  videos;
  skeletons;
  tracks;
  suggestions;
  sessions;
  provenance;
  constructor(options) {
    this.labeledFrames = options?.labeledFrames ?? [];
    this.videos = options?.videos ?? [];
    this.skeletons = options?.skeletons ?? [];
    this.tracks = options?.tracks ?? [];
    this.suggestions = options?.suggestions ?? [];
    this.sessions = options?.sessions ?? [];
    this.provenance = options?.provenance ?? {};
    if (!this.videos.length && this.labeledFrames.length) {
      const uniqueVideos = /* @__PURE__ */ new Map();
      for (const frame of this.labeledFrames) {
        uniqueVideos.set(frame.video, frame.video);
      }
      this.videos = Array.from(uniqueVideos.values());
    }
    if (!this.skeletons.length && this.labeledFrames.length) {
      const uniqueSkeletons = /* @__PURE__ */ new Map();
      for (const frame of this.labeledFrames) {
        for (const instance of frame.instances) {
          uniqueSkeletons.set(instance.skeleton, instance.skeleton);
        }
      }
      this.skeletons = Array.from(uniqueSkeletons.values());
    }
    if (!this.tracks.length && this.labeledFrames.length) {
      const uniqueTracks = /* @__PURE__ */ new Map();
      for (const frame of this.labeledFrames) {
        for (const instance of frame.instances) {
          if (instance.track) uniqueTracks.set(instance.track, instance.track);
        }
      }
      this.tracks = Array.from(uniqueTracks.values());
    }
  }
  get video() {
    if (!this.videos.length) {
      throw new Error("No videos available on Labels.");
    }
    return this.videos[0];
  }
  get length() {
    return this.labeledFrames.length;
  }
  [Symbol.iterator]() {
    return this.labeledFrames[Symbol.iterator]();
  }
  get instances() {
    return this.labeledFrames.flatMap((frame) => frame.instances);
  }
  find(options) {
    return this.labeledFrames.filter((frame) => {
      if (options.video && frame.video !== options.video && !frame.video.matchesPath(options.video, false)) {
        return false;
      }
      if (options.frameIdx !== void 0 && frame.frameIdx !== options.frameIdx) {
        return false;
      }
      return true;
    });
  }
  append(frame) {
    this.labeledFrames.push(frame);
    if (!this.videos.includes(frame.video)) {
      this.videos.push(frame.video);
    }
  }
  toDict(options) {
    return toDict(this, options);
  }
  static fromNumpy(data, options) {
    const video = options.video ?? options.videos?.[0];
    if (!video) throw new Error("fromNumpy requires a video.");
    if (options.video && options.videos) {
      throw new Error("Cannot specify both video and videos.");
    }
    const skeletons = Array.isArray(options.skeletons) ? options.skeletons : options.skeletons ? [options.skeletons] : options.skeleton ? [options.skeleton] : [];
    if (!skeletons.length) throw new Error("fromNumpy requires a skeleton.");
    return labelsFromNumpy(data, {
      video,
      skeleton: skeletons[0],
      trackNames: options.trackNames,
      firstFrame: options.firstFrame,
      returnConfidence: options.returnConfidence
    });
  }
  numpy(options) {
    const targetVideo = options?.video ?? this.video;
    const frames = this.labeledFrames.filter((frame) => frame.video.matchesPath(targetVideo, true));
    if (!frames.length) return [];
    const maxFrame = Math.max(...frames.map((frame) => frame.frameIdx));
    const tracks = this.tracks.length ? this.tracks.length : Math.max(1, ...frames.map((frame) => frame.instances.length));
    const nodes = this.skeletons[0]?.nodes.length ?? 0;
    const channelCount = options?.returnConfidence ? 3 : 2;
    const videoArray = Array.from(
      { length: maxFrame + 1 },
      () => Array.from(
        { length: tracks },
        () => Array.from({ length: nodes }, () => Array.from({ length: channelCount }, () => Number.NaN))
      )
    );
    for (const frame of frames) {
      const frameSlot = videoArray[frame.frameIdx];
      if (!frameSlot) continue;
      frame.instances.forEach((inst, idx) => {
        const trackIndex = inst.track ? this.tracks.indexOf(inst.track) : idx;
        const resolvedTrack = trackIndex >= 0 ? trackIndex : idx;
        const trackSlot = frameSlot[resolvedTrack];
        if (!trackSlot) return;
        inst.points.forEach((point, nodeIdx) => {
          if (!trackSlot[nodeIdx]) return;
          const row = [point.xy[0], point.xy[1]];
          if (options?.returnConfidence) {
            const score = "score" in point ? point.score : Number.NaN;
            row.push(score);
          }
          trackSlot[nodeIdx] = row;
        });
      });
    }
    return videoArray;
  }
};

// src/model/labels-set.ts
var LabelsSet = class {
  labels;
  constructor(entries) {
    this.labels = new Map(Object.entries(entries ?? {}));
  }
  get size() {
    return this.labels.size;
  }
  get(key) {
    return this.labels.get(key);
  }
  set(key, value) {
    this.labels.set(key, value);
  }
  delete(key) {
    this.labels.delete(key);
  }
  keys() {
    return this.labels.keys();
  }
  values() {
    return this.labels.values();
  }
  entries() {
    return this.labels.entries();
  }
  [Symbol.iterator]() {
    return this.labels.entries();
  }
};

// src/model/camera.ts
function rodriguesTransformation(input) {
  if (input.length === 3 && Array.isArray(input[0]) === false) {
    const rvec = input;
    const theta2 = Math.hypot(rvec[0], rvec[1], rvec[2]);
    if (theta2 === 0) {
      return { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], vector: rvec };
    }
    const axis = rvec.map((v) => v / theta2);
    const [x, y, z] = axis;
    const cos = Math.cos(theta2);
    const sin = Math.sin(theta2);
    const K = [
      [0, -z, y],
      [z, 0, -x],
      [-y, x, 0]
    ];
    const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const KK = multiply3x3(K, K);
    const matrix2 = add3x3(add3x3(I, scale3x3(K, sin)), scale3x3(KK, 1 - cos));
    return { matrix: matrix2, vector: rvec };
  }
  const matrix = input;
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  const cosTheta = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const theta = Math.acos(cosTheta);
  if (theta === 0) {
    return { matrix, vector: [0, 0, 0] };
  }
  const rx = (matrix[2][1] - matrix[1][2]) / (2 * Math.sin(theta));
  const ry = (matrix[0][2] - matrix[2][0]) / (2 * Math.sin(theta));
  const rz = (matrix[1][0] - matrix[0][1]) / (2 * Math.sin(theta));
  return { matrix, vector: [rx * theta, ry * theta, rz * theta] };
}
function multiply3x3(a, b) {
  const result = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      result[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return result;
}
function add3x3(a, b) {
  return a.map((row, i) => row.map((val, j) => val + b[i][j]));
}
function scale3x3(a, scale) {
  return a.map((row) => row.map((val) => val * scale));
}
var Camera = class {
  name;
  rvec;
  tvec;
  matrix;
  distortions;
  constructor(options) {
    this.name = options.name;
    this.rvec = options.rvec;
    this.tvec = options.tvec;
    this.matrix = options.matrix;
    this.distortions = options.distortions;
  }
};
var CameraGroup = class {
  cameras;
  metadata;
  constructor(options) {
    this.cameras = options?.cameras ?? [];
    this.metadata = options?.metadata ?? {};
  }
};
var InstanceGroup = class {
  instanceByCamera;
  score;
  points;
  metadata;
  constructor(options) {
    this.instanceByCamera = options.instanceByCamera instanceof Map ? options.instanceByCamera : /* @__PURE__ */ new Map();
    if (!(options.instanceByCamera instanceof Map)) {
      for (const [key, value] of Object.entries(options.instanceByCamera)) {
        const camera = key;
        this.instanceByCamera.set(camera, value);
      }
    }
    this.score = options.score;
    this.points = options.points;
    this.metadata = options.metadata ?? {};
  }
  get instances() {
    return Array.from(this.instanceByCamera.values());
  }
};
var FrameGroup = class {
  frameIdx;
  instanceGroups;
  labeledFrameByCamera;
  metadata;
  constructor(options) {
    this.frameIdx = options.frameIdx;
    this.instanceGroups = options.instanceGroups;
    this.labeledFrameByCamera = options.labeledFrameByCamera instanceof Map ? options.labeledFrameByCamera : /* @__PURE__ */ new Map();
    if (!(options.labeledFrameByCamera instanceof Map)) {
      for (const [key, value] of Object.entries(options.labeledFrameByCamera)) {
        const camera = key;
        this.labeledFrameByCamera.set(camera, value);
      }
    }
    this.metadata = options.metadata ?? {};
  }
  get cameras() {
    return Array.from(this.labeledFrameByCamera.keys());
  }
  get labeledFrames() {
    return Array.from(this.labeledFrameByCamera.values());
  }
  getFrame(camera) {
    return this.labeledFrameByCamera.get(camera);
  }
};
var RecordingSession = class {
  cameraGroup;
  frameGroupByFrameIdx;
  videoByCamera;
  cameraByVideo;
  metadata;
  constructor(options) {
    this.cameraGroup = options?.cameraGroup ?? new CameraGroup();
    this.frameGroupByFrameIdx = options?.frameGroupByFrameIdx ?? /* @__PURE__ */ new Map();
    this.videoByCamera = options?.videoByCamera ?? /* @__PURE__ */ new Map();
    this.cameraByVideo = options?.cameraByVideo ?? /* @__PURE__ */ new Map();
    this.metadata = options?.metadata ?? {};
  }
  get frameGroups() {
    return this.frameGroupByFrameIdx;
  }
  get videos() {
    return Array.from(this.videoByCamera.values());
  }
  get cameras() {
    return Array.from(this.videoByCamera.keys());
  }
  addVideo(video, camera) {
    if (!this.cameraGroup.cameras.includes(camera)) {
      this.cameraGroup.cameras.push(camera);
    }
    this.videoByCamera.set(camera, video);
    this.cameraByVideo.set(video, camera);
  }
  getCamera(video) {
    return this.cameraByVideo.get(video);
  }
  getVideo(camera) {
    return this.videoByCamera.get(camera);
  }
};
function makeCameraFromDict(data) {
  return new Camera({
    name: data.name,
    rvec: data.rotation ?? [0, 0, 0],
    tvec: data.translation ?? [0, 0, 0],
    matrix: data.matrix,
    distortions: data.distortions
  });
}

// src/video/mp4box-video.ts
var isBrowser2 = typeof window !== "undefined" && typeof document !== "undefined";
var hasWebCodecs = isBrowser2 && typeof window.VideoDecoder !== "undefined" && typeof window.EncodedVideoChunk !== "undefined";
var MP4BOX_CDN = "https://unpkg.com/mp4box@0.5.4/dist/mp4box.all.min.js";
async function loadMp4box() {
  const globalMp4box = globalThis.MP4Box;
  if (globalMp4box) return globalMp4box;
  try {
    const module = await import("mp4box");
    return module.default ?? module;
  } catch {
    if (!isBrowser2 || typeof document === "undefined") {
      throw new Error("Failed to load mp4box");
    }
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = MP4BOX_CDN;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load mp4box"));
      document.head.appendChild(script);
    });
    const afterLoad = globalThis.MP4Box;
    if (afterLoad) return afterLoad;
    throw new Error("Failed to load mp4box");
  }
}
var DEFAULT_CACHE_SIZE = 120;
var DEFAULT_LOOKAHEAD = 60;
var PARSE_CHUNK_SIZE = 1024 * 1024;
var Mp4BoxVideoBackend = class {
  filename;
  shape;
  fps;
  dataset;
  ready;
  mp4box;
  mp4boxFile;
  videoTrack;
  samples;
  keyframeIndices;
  cache;
  cacheSize;
  lookahead;
  decoder;
  config;
  fileSize;
  supportsRangeRequests;
  fileBlob;
  isDecoding;
  pendingFrame;
  constructor(filename, options) {
    if (!hasWebCodecs) {
      throw new Error("Mp4BoxVideoBackend requires WebCodecs support.");
    }
    if (!isBrowser2) {
      throw new Error("Mp4BoxVideoBackend requires a browser environment.");
    }
    this.filename = filename;
    this.dataset = null;
    this.samples = [];
    this.keyframeIndices = [];
    this.cache = /* @__PURE__ */ new Map();
    this.cacheSize = options?.cacheSize ?? DEFAULT_CACHE_SIZE;
    this.lookahead = options?.lookahead ?? DEFAULT_LOOKAHEAD;
    this.decoder = null;
    this.config = null;
    this.fileSize = 0;
    this.supportsRangeRequests = false;
    this.fileBlob = null;
    this.isDecoding = false;
    this.pendingFrame = null;
    this.ready = this.init();
  }
  async getFrame(frameIndex) {
    await this.ready;
    if (frameIndex < 0 || frameIndex >= this.samples.length) return null;
    if (this.cache.has(frameIndex)) {
      const bitmap = this.cache.get(frameIndex) ?? null;
      if (bitmap) {
        this.cache.delete(frameIndex);
        this.cache.set(frameIndex, bitmap);
      }
      return bitmap;
    }
    if (this.isDecoding) {
      this.pendingFrame = frameIndex;
      await new Promise((resolve) => {
        const check = () => this.isDecoding ? setTimeout(check, 10) : resolve(null);
        check();
      });
      if (this.cache.has(frameIndex)) {
        return this.cache.get(frameIndex) ?? null;
      }
      if (this.pendingFrame !== null && this.pendingFrame !== frameIndex) {
        return null;
      }
    }
    const keyframe = this.findKeyframeBefore(frameIndex);
    const end = Math.min(frameIndex + this.lookahead, this.samples.length - 1);
    await this.decodeRange(keyframe, end, frameIndex);
    return this.cache.get(frameIndex) ?? null;
  }
  async getFrameTimes() {
    await this.ready;
    return this.samples.map((sample) => sample.timestamp / 1e6);
  }
  close() {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
      }
    }
    this.decoder = null;
    this.cache.forEach((bitmap) => bitmap.close());
    this.cache.clear();
    this.fileBlob = null;
  }
  async init() {
    await this.openSource();
    this.mp4box = await loadMp4box();
    this.mp4boxFile = this.mp4box.createFile();
    const ready = new Promise((resolve, reject) => {
      this.mp4boxFile.onError = reject;
      this.mp4boxFile.onReady = resolve;
    });
    let offset = 0;
    let resolved = false;
    ready.then(() => {
      resolved = true;
    });
    while (offset < this.fileSize && !resolved) {
      const buffer = await this.readChunk(offset, PARSE_CHUNK_SIZE);
      buffer.fileStart = offset;
      const next = this.mp4boxFile.appendBuffer(buffer);
      offset = next === void 0 ? offset + buffer.byteLength : next;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const info = await ready;
    if (!info.videoTracks.length) throw new Error("No video tracks found");
    this.videoTrack = info.videoTracks[0];
    const trak = this.mp4boxFile.getTrackById(this.videoTrack.id);
    const description = this.getCodecDescription(trak);
    const codec = this.videoTrack.codec.startsWith("vp08") ? "vp8" : this.videoTrack.codec;
    this.config = {
      codec,
      codedWidth: this.videoTrack.video.width,
      codedHeight: this.videoTrack.video.height,
      description
    };
    const support = await VideoDecoder.isConfigSupported(this.config);
    if (!support.supported) {
      throw new Error(`Codec ${codec} not supported`);
    }
    this.extractSamples();
    const duration = this.videoTrack.duration / this.videoTrack.timescale;
    this.fps = duration ? this.samples.length / duration : void 0;
    const frameCount = this.samples.length;
    const height = this.videoTrack.video.height;
    const width = this.videoTrack.video.width;
    this.shape = [frameCount, height, width, 3];
  }
  async openSource() {
    if (typeof this.filename !== "string") {
      throw new Error("Mp4BoxVideoBackend requires a single filename string.");
    }
    const response = await fetch(this.filename, { method: "HEAD" });
    if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
    const size = response.headers.get("Content-Length");
    this.fileSize = size ? Number.parseInt(size, 10) : 0;
    if (this.fileSize > 0) {
      try {
        const rangeTest = await fetch(this.filename, { method: "GET", headers: { Range: "bytes=0-0" } });
        this.supportsRangeRequests = rangeTest.status === 206;
      } catch {
        this.supportsRangeRequests = false;
      }
    }
    if (!this.supportsRangeRequests || !this.fileSize) {
      const full = await fetch(this.filename);
      const blob = await full.blob();
      this.fileBlob = blob;
      this.fileSize = blob.size;
    }
  }
  async readChunk(offset, size) {
    const end = Math.min(offset + size, this.fileSize);
    if (this.supportsRangeRequests) {
      const response = await fetch(this.filename, { headers: { Range: `bytes=${offset}-${end - 1}` } });
      return await response.arrayBuffer();
    }
    if (this.fileBlob) {
      return await this.fileBlob.slice(offset, end).arrayBuffer();
    }
    throw new Error("No video source available");
  }
  extractSamples() {
    const info = this.mp4boxFile.getTrackSamplesInfo(this.videoTrack.id);
    if (!info?.length) throw new Error("No samples");
    const ts = this.videoTrack.timescale;
    const samples = info.map((sample, index) => ({
      offset: sample.offset,
      size: sample.size,
      timestamp: sample.cts * 1e6 / ts,
      duration: sample.duration * 1e6 / ts,
      isKeyframe: sample.is_sync,
      cts: sample.cts,
      decodeIndex: index
    }));
    this.samples = samples.sort((a, b) => {
      if (a.cts === b.cts) return a.decodeIndex - b.decodeIndex;
      return a.cts - b.cts;
    });
    this.keyframeIndices = [];
    this.samples.forEach((sample, index) => {
      if (sample.isKeyframe) this.keyframeIndices.push(index);
    });
  }
  findKeyframeBefore(frameIndex) {
    let result = 0;
    for (const keyframe of this.keyframeIndices) {
      if (keyframe <= frameIndex) result = keyframe;
      else break;
    }
    return result;
  }
  getCodecDescription(trak) {
    const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];
    const dataStream = globalThis.DataStream ?? this.mp4box?.DataStream;
    if (!dataStream) return void 0;
    for (const entry of entries) {
      const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
      if (!box) continue;
      const stream = new dataStream(void 0, 0, dataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
    return void 0;
  }
  async readSampleDataByDecodeOrder(samplesToFeed) {
    const results = /* @__PURE__ */ new Map();
    let i = 0;
    while (i < samplesToFeed.length) {
      const first = samplesToFeed[i];
      let regionEnd = i;
      let regionBytes = first.sample.size;
      while (regionEnd < samplesToFeed.length - 1) {
        const current = samplesToFeed[regionEnd];
        const next = samplesToFeed[regionEnd + 1];
        if (next.sample.offset === current.sample.offset + current.sample.size) {
          regionEnd += 1;
          regionBytes += next.sample.size;
        } else {
          break;
        }
      }
      const buffer = await this.readChunk(first.sample.offset, regionBytes);
      const bufferView = new Uint8Array(buffer);
      let bufferOffset = 0;
      for (let j = i; j <= regionEnd; j += 1) {
        const { sample } = samplesToFeed[j];
        results.set(sample.decodeIndex, bufferView.slice(bufferOffset, bufferOffset + sample.size));
        bufferOffset += sample.size;
      }
      i = regionEnd + 1;
    }
    return results;
  }
  async decodeRange(start, end, target) {
    if (!this.config) throw new Error("Decoder not configured");
    this.isDecoding = true;
    try {
      if (this.decoder) {
        try {
          this.decoder.close();
        } catch {
        }
      }
      let minDecodeIndex = Infinity;
      let maxDecodeIndex = -Infinity;
      for (let i = start; i <= end; i += 1) {
        minDecodeIndex = Math.min(minDecodeIndex, this.samples[i].decodeIndex);
        maxDecodeIndex = Math.max(maxDecodeIndex, this.samples[i].decodeIndex);
      }
      const toFeed = [];
      for (let i = 0; i < this.samples.length; i += 1) {
        const sample = this.samples[i];
        if (sample.decodeIndex >= minDecodeIndex && sample.decodeIndex <= maxDecodeIndex) {
          toFeed.push({ pi: i, sample });
        }
      }
      toFeed.sort((a, b) => a.sample.decodeIndex - b.sample.decodeIndex);
      const dataMap = await this.readSampleDataByDecodeOrder(toFeed);
      const timestampMap = /* @__PURE__ */ new Map();
      for (const { pi, sample } of toFeed) {
        timestampMap.set(Math.round(sample.timestamp), pi);
      }
      const halfCache = Math.floor(this.cacheSize / 2);
      const cacheStart = Math.max(start, target - halfCache);
      const cacheEnd = Math.min(end, target + halfCache);
      let decodedCount = 0;
      let resolveComplete;
      let rejectComplete;
      const completionPromise = new Promise((resolve, reject) => {
        resolveComplete = resolve;
        rejectComplete = reject;
      });
      this.decoder = new VideoDecoder({
        output: (frame) => {
          const roundedTimestamp = Math.round(frame.timestamp);
          let frameIndex = timestampMap.get(roundedTimestamp);
          if (frameIndex === void 0) {
            let bestDiff = Infinity;
            for (const [ts, idx] of timestampMap) {
              const diff = Math.abs(ts - frame.timestamp);
              if (diff < bestDiff) {
                bestDiff = diff;
                frameIndex = idx;
              }
            }
          }
          const handleClose = () => {
            frame.close();
            decodedCount += 1;
            if (decodedCount >= toFeed.length) resolveComplete();
          };
          if (frameIndex !== void 0 && frameIndex >= cacheStart && frameIndex <= cacheEnd) {
            createImageBitmap(frame).then((bitmap) => {
              this.addToCache(frameIndex, bitmap);
              handleClose();
            }).catch(handleClose);
          } else {
            handleClose();
          }
        },
        error: (error) => {
          if (error.name === "AbortError") {
            resolveComplete();
          } else {
            rejectComplete(error);
          }
        }
      });
      this.decoder.configure(this.config);
      const BATCH_SIZE = 15;
      for (let i = 0; i < toFeed.length; i += BATCH_SIZE) {
        const batch = toFeed.slice(i, i + BATCH_SIZE);
        for (const { sample } of batch) {
          const data = dataMap.get(sample.decodeIndex);
          if (!data) continue;
          this.decoder.decode(
            new EncodedVideoChunk({
              type: sample.isKeyframe ? "key" : "delta",
              timestamp: sample.timestamp,
              duration: sample.duration,
              data
            })
          );
        }
        if (i + BATCH_SIZE < toFeed.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      await this.decoder.flush();
      await completionPromise;
    } finally {
      this.isDecoding = false;
    }
  }
  addToCache(frameIndex, bitmap) {
    if (this.cache.size >= this.cacheSize) {
      const first = this.cache.keys().next();
      if (!first.done) {
        const evicted = this.cache.get(first.value);
        if (evicted) evicted.close();
        this.cache.delete(first.value);
      }
    }
    this.cache.set(frameIndex, bitmap);
  }
};

// src/codecs/slp/h5.ts
var isNode = typeof process !== "undefined" && !!process.versions?.node;
var modulePromise = null;
async function getH5Module() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const module = isNode ? await import("h5wasm/node") : await import("h5wasm");
      await module.ready;
      return module;
    })();
  }
  return modulePromise;
}
async function openH5File(source, options) {
  const module = await getH5Module();
  if (isNode) {
    return openH5FileNode(module, source);
  }
  return openH5FileBrowser(module, source, options);
}
function isProbablyUrl(value) {
  return /^https?:\/\//i.test(value);
}
function isFileHandle(value) {
  return typeof value === "object" && value !== null && "getFile" in value;
}
async function openH5FileNode(module, source) {
  if (typeof source === "string") {
    const file = new module.File(source, "r");
    return { file, close: () => file.close() };
  }
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);
    const tempPath = join(tmpdir(), `sleap-io-${Date.now()}-${Math.random().toString(16).slice(2)}.slp`);
    writeFileSync(tempPath, data);
    const file = new module.File(tempPath, "r");
    return {
      file,
      close: () => {
        file.close();
        unlinkSync(tempPath);
      }
    };
  }
  throw new Error("Node environments only support string paths or byte buffers for SLP inputs.");
}
async function openH5FileBrowser(module, source, options) {
  const fs = getH5FileSystem(module);
  if (typeof source === "string" && isProbablyUrl(source)) {
    return openFromUrl(module, fs, source, options);
  }
  if (isFileHandle(source)) {
    const file = await source.getFile();
    return openFromFile(module, fs, file, options);
  }
  if (typeof File !== "undefined" && source instanceof File) {
    return openFromFile(module, fs, source, options);
  }
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);
    const filename = "/tmp-slp.slp";
    fs.writeFile(filename, data);
    const file = new module.File(filename, "r");
    return { file, close: () => file.close() };
  }
  if (typeof source === "string") {
    return openFromUrl(module, fs, source, options);
  }
  throw new Error("Unsupported SLP source type for browser environment.");
}
async function openFromUrl(module, fs, url, options) {
  const filename = options?.filenameHint ?? url.split("/").pop()?.split("?")[0] ?? "slp-data.slp";
  const streamMode = options?.stream ?? "auto";
  if (fs.createLazyFile && (streamMode === "auto" || streamMode === "range")) {
    const mountPath = `/slp-remote-${Date.now()}`;
    fs.mkdir?.(mountPath);
    try {
      fs.createLazyFile(mountPath, filename, url, true, false);
      const file2 = new module.File(`${mountPath}/${filename}`, "r");
      return {
        file: file2,
        close: () => {
          file2.close();
          fs.unlink?.(`${mountPath}/${filename}`);
          fs.rmdir?.(mountPath);
        }
      };
    } catch {
      fs.rmdir?.(mountPath);
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch SLP file: ${response.status} ${response.statusText}`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  const localPath = "/tmp-slp.slp";
  fs.writeFile(localPath, buffer);
  const file = new module.File(localPath, "r");
  return { file, close: () => file.close() };
}
async function openFromFile(module, fs, file, options) {
  const mountPath = `/slp-local-${Date.now()}`;
  fs.mkdir?.(mountPath);
  const filename = options?.filenameHint ?? file.name ?? "local.slp";
  if (fs.mount && fs.filesystems && fs.filesystems.WORKERFS) {
    fs.mount(fs.filesystems.WORKERFS, { files: [file] }, mountPath);
    const filePath = `${mountPath}/${filename}`;
    const h5file2 = new module.File(filePath, "r");
    return {
      file: h5file2,
      close: () => {
        h5file2.close();
        fs.unmount?.(mountPath);
        fs.rmdir?.(mountPath);
      }
    };
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  const localPath = "/tmp-slp.slp";
  fs.writeFile(localPath, buffer);
  const h5file = new module.File(localPath, "r");
  return { file: h5file, close: () => h5file.close() };
}
function getH5FileSystem(module) {
  const fs = module.FS;
  if (!fs) {
    throw new Error("h5wasm FS is not available.");
  }
  return fs;
}

// src/video/hdf5-video.ts
var isBrowser3 = typeof window !== "undefined" && typeof document !== "undefined";
var Hdf5VideoBackend = class {
  filename;
  dataset;
  shape;
  fps;
  file;
  datasetPath;
  frameNumbers;
  format;
  channelOrder;
  cachedData;
  constructor(options) {
    this.filename = options.filename;
    this.file = options.file;
    this.datasetPath = options.datasetPath;
    this.dataset = options.datasetPath;
    this.frameNumbers = options.frameNumbers ?? [];
    this.format = options.format ?? "png";
    this.channelOrder = options.channelOrder ?? "RGB";
    this.shape = options.shape;
    this.fps = options.fps;
    this.cachedData = null;
  }
  async getFrame(frameIndex) {
    const dataset = this.file.get(this.datasetPath);
    if (!dataset) return null;
    const index = this.frameNumbers.length ? this.frameNumbers.indexOf(frameIndex) : frameIndex;
    if (index < 0) return null;
    if (!this.cachedData) {
      this.cachedData = dataset.value;
    }
    const entry = this.cachedData[index];
    if (entry == null) return null;
    const rawBytes = toUint8Array(entry);
    if (!rawBytes) return null;
    if (isEncodedFormat(this.format)) {
      const decoded = await decodeImageBytes(rawBytes, this.format);
      return decoded ?? rawBytes;
    }
    const image = decodeRawFrame(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }
  close() {
    this.cachedData = null;
  }
};
function toUint8Array(entry) {
  if (entry instanceof Uint8Array) return entry;
  if (entry instanceof ArrayBuffer) return new Uint8Array(entry);
  if (ArrayBuffer.isView(entry)) return new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
  if (Array.isArray(entry)) return new Uint8Array(entry.flat());
  if (entry?.buffer) return new Uint8Array(entry.buffer);
  return null;
}
function isEncodedFormat(format) {
  const normalized = format.toLowerCase();
  return normalized === "png" || normalized === "jpg" || normalized === "jpeg";
}
async function decodeImageBytes(bytes, format) {
  if (!isBrowser3 || typeof createImageBitmap === "undefined") return null;
  const mime = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: mime });
  return createImageBitmap(blob);
}
function decodeRawFrame(bytes, shape, channelOrder) {
  if (!isBrowser3 || !shape) return null;
  const [, height, width, channels] = shape;
  if (!height || !width || !channels) return null;
  const expectedLength = height * width * channels;
  if (bytes.length < expectedLength) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const useBgr = channelOrder.toUpperCase() === "BGR";
  for (let i = 0; i < width * height; i += 1) {
    const base = i * channels;
    const r = bytes[base + (useBgr ? 2 : 0)] ?? 0;
    const g = bytes[base + 1] ?? 0;
    const b = bytes[base + (useBgr ? 0 : 2)] ?? 0;
    const a = channels === 4 ? bytes[base + 3] ?? 255 : 255;
    const out = i * 4;
    rgba[out] = r;
    rgba[out + 1] = g;
    rgba[out + 2] = b;
    rgba[out + 3] = a;
  }
  return new ImageData(rgba, width, height);
}

// src/video/factory.ts
async function createVideoBackend(filename, options) {
  if (options?.embedded || filename.endsWith(".slp") || filename.endsWith(".h5") || filename.endsWith(".hdf5")) {
    const { file } = await openH5File(filename);
    const datasetPath = options?.dataset ?? "";
    return new Hdf5VideoBackend({
      filename,
      file,
      datasetPath,
      frameNumbers: options?.frameNumbers,
      format: options?.format,
      channelOrder: options?.channelOrder,
      shape: options?.shape,
      fps: options?.fps
    });
  }
  const supportsWebCodecs = typeof window !== "undefined" && typeof window.VideoDecoder !== "undefined" && typeof window.EncodedVideoChunk !== "undefined";
  const normalized = filename.split("?")[0]?.toLowerCase();
  if (supportsWebCodecs && normalized.endsWith(".mp4")) {
    return new Mp4BoxVideoBackend(filename);
  }
  return new MediaVideoBackend(filename);
}

// src/codecs/slp/read.ts
var textDecoder = new TextDecoder();
async function readSlp(source, options) {
  const { file, close } = await openH5File(source, options?.h5);
  try {
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Missing /metadata group in SLP file");
    }
    const metadataAttrs = metadataGroup.attrs ?? {};
    const formatId = Number(metadataAttrs["format_id"]?.value ?? metadataAttrs["format_id"] ?? 1);
    const metadataJson = parseJsonAttr(metadataAttrs["json"]);
    const labelsPath = typeof source === "string" ? source : options?.h5?.filenameHint ?? "slp-data.slp";
    const skeletons = readSkeletons(metadataJson);
    const tracks = readTracks(file.get("tracks_json"));
    const videos = await readVideos(file.get("videos_json"), labelsPath, options?.openVideos ?? true, file);
    const suggestions = readSuggestions(file.get("suggestions_json"), videos);
    const framesData = normalizeStructDataset(file.get("frames"));
    const instancesData = normalizeStructDataset(file.get("instances"));
    const pointsData = normalizeStructDataset(file.get("points"));
    const predPointsData = normalizeStructDataset(file.get("pred_points"));
    const labeledFrames = buildLabeledFrames({
      framesData,
      instancesData,
      pointsData,
      predPointsData,
      skeletons,
      tracks,
      videos,
      formatId
    });
    const sessions = readSessions(file.get("sessions_json"), videos, skeletons, labeledFrames);
    return new Labels({
      labeledFrames,
      videos,
      skeletons,
      tracks,
      suggestions,
      sessions,
      provenance: metadataJson?.provenance ?? {}
    });
  } finally {
    close();
  }
}
function parseJsonAttr(attr) {
  if (!attr) return null;
  const value = attr.value ?? attr;
  if (typeof value === "string") return JSON.parse(value);
  if (value instanceof Uint8Array) return JSON.parse(textDecoder.decode(value));
  if (value.buffer) return JSON.parse(textDecoder.decode(new Uint8Array(value.buffer)));
  return JSON.parse(String(value));
}
function readSkeletons(metadataJson) {
  if (!metadataJson) return [];
  const nodeNames = (metadataJson.nodes ?? []).map((node) => node.name ?? node);
  const skeletonEntries = metadataJson.skeletons ?? [];
  const skeletons = [];
  for (const entry of skeletonEntries) {
    const edges = [];
    const symmetries = [];
    const typeCache = /* @__PURE__ */ new Map();
    const typeState = { nextId: 1 };
    const skeletonNodeIds = (entry.nodes ?? []).map((node) => Number(node.id ?? node));
    const nodeOrder = skeletonNodeIds.length ? skeletonNodeIds : nodeNames.map((_, index) => index);
    const nodes = nodeOrder.map((nodeId) => nodeNames[nodeId]).filter((name) => name !== void 0).map((name) => new Node(name));
    const nodeIndexById = /* @__PURE__ */ new Map();
    nodeOrder.forEach((nodeId, index) => {
      nodeIndexById.set(Number(nodeId), index);
    });
    for (const link of entry.links ?? []) {
      const source = Number(link.source);
      const target = Number(link.target);
      const edgeType = resolveEdgeType(link.type, typeCache, typeState);
      if (edgeType === 2) {
        symmetries.push([source, target]);
      } else {
        edges.push([source, target]);
      }
    }
    const remapPair = (pair) => {
      const sourceIndex = nodeIndexById.get(pair[0]);
      const targetIndex = nodeIndexById.get(pair[1]);
      if (sourceIndex === void 0 || targetIndex === void 0) return null;
      return [sourceIndex, targetIndex];
    };
    const mappedEdges = edges.map(remapPair).filter((pair) => pair !== null);
    const seenSymmetries = /* @__PURE__ */ new Set();
    const mappedSymmetries = symmetries.map(remapPair).filter((pair) => pair !== null).filter(([a, b]) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seenSymmetries.has(key)) return false;
      seenSymmetries.add(key);
      return true;
    });
    const skeleton = new Skeleton({
      nodes,
      edges: mappedEdges,
      symmetries: mappedSymmetries,
      name: entry.graph?.name ?? entry.name
    });
    skeletons.push(skeleton);
  }
  return skeletons;
}
function resolveEdgeType(edgeType, cache, state) {
  if (!edgeType) return 1;
  if (edgeType["py/reduce"]) {
    const typeId = edgeType["py/reduce"][1]?.["py/tuple"]?.[0] ?? 1;
    cache.set(state.nextId, typeId);
    state.nextId += 1;
    return typeId;
  }
  if (edgeType["py/tuple"]) {
    const typeId = edgeType["py/tuple"][0] ?? 1;
    cache.set(state.nextId, typeId);
    state.nextId += 1;
    return typeId;
  }
  if (edgeType["py/id"]) {
    const pyId = edgeType["py/id"];
    return cache.get(pyId) ?? pyId;
  }
  return 1;
}
function readTracks(dataset) {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const tracks = [];
  for (const entry of values) {
    let parsed = entry;
    if (typeof entry === "string") {
      try {
        parsed = JSON.parse(entry);
      } catch {
        parsed = entry;
      }
    }
    if (Array.isArray(parsed)) {
      tracks.push(new Track(String(parsed[1] ?? parsed[0])));
    } else if (parsed?.name) {
      tracks.push(new Track(String(parsed.name)));
    } else {
      tracks.push(new Track(String(parsed)));
    }
  }
  return tracks;
}
async function readVideos(dataset, labelsPath, openVideos, file) {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const videos = [];
  for (const entry of values) {
    if (!entry) continue;
    const parsed = typeof entry === "string" ? JSON.parse(entry) : JSON.parse(textDecoder.decode(entry));
    const backendMeta = parsed.backend ?? {};
    let filename = backendMeta.filename ?? parsed.filename ?? "";
    let datasetPath = backendMeta.dataset ?? null;
    let embedded = false;
    if (filename === ".") {
      embedded = true;
      filename = labelsPath;
    }
    let backend = null;
    if (openVideos) {
      backend = await createVideoBackend(filename, {
        dataset: datasetPath ?? void 0,
        embedded,
        frameNumbers: readFrameNumbers(file, datasetPath),
        format: backendMeta.format,
        channelOrder: backendMeta.channel_order,
        shape: backendMeta.shape,
        fps: backendMeta.fps
      });
    }
    const sourceVideo = parsed.source_video ? new Video({ filename: parsed.source_video.filename ?? "" }) : null;
    videos.push(
      new Video({
        filename,
        backend,
        backendMetadata: backendMeta,
        sourceVideo,
        openBackend: openVideos
      })
    );
  }
  return videos;
}
function readFrameNumbers(file, datasetPath) {
  if (!datasetPath) return [];
  const groupPath = datasetPath.endsWith("/video") ? datasetPath.slice(0, -6) : datasetPath;
  const frameDataset = file.get(`${groupPath}/frame_numbers`);
  if (!frameDataset) return [];
  const values = frameDataset.value ?? [];
  return Array.from(values).map((v) => Number(v));
}
function readSuggestions(dataset, videos) {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const suggestions = [];
  for (const entry of values) {
    const parsed = typeof entry === "string" ? JSON.parse(entry) : JSON.parse(textDecoder.decode(entry));
    const videoIndex = Number(parsed.video ?? 0);
    const video = videos[videoIndex];
    if (!video) continue;
    suggestions.push(new SuggestionFrame({ video, frameIdx: parsed.frame_idx ?? parsed.frameIdx ?? 0, metadata: parsed }));
  }
  return suggestions;
}
function readSessions(dataset, videos, skeletons, labeledFrames) {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const sessions = [];
  for (const entry of values) {
    const parsed = typeof entry === "string" ? JSON.parse(entry) : JSON.parse(textDecoder.decode(entry));
    const cameraGroup = new CameraGroup();
    const cameraMap = /* @__PURE__ */ new Map();
    const calibration = asRecord(parsed.calibration);
    for (const [key, data] of Object.entries(calibration)) {
      if (key === "metadata") continue;
      const cameraData = asRecord(data);
      const camera = new Camera({
        name: cameraData.name ?? key,
        rvec: cameraData.rotation ?? [0, 0, 0],
        tvec: cameraData.translation ?? [0, 0, 0],
        matrix: cameraData.matrix,
        distortions: cameraData.distortions
      });
      cameraGroup.cameras.push(camera);
      cameraMap.set(String(key), camera);
    }
    const session = new RecordingSession({ cameraGroup, metadata: parsed.metadata ?? {} });
    const map = asRecord(parsed.camcorder_to_video_idx_map);
    for (const [cameraKey, videoIdx] of Object.entries(map)) {
      const camera = cameraMap.get(cameraKey);
      const video = videos[Number(videoIdx)];
      if (camera && video) {
        session.addVideo(video, camera);
      }
    }
    const frameGroups = Array.isArray(parsed.frame_group_dicts) ? parsed.frame_group_dicts : [];
    for (const group of frameGroups) {
      const groupRecord = asRecord(group);
      const frameIdx = groupRecord.frame_idx ?? groupRecord.frameIdx ?? 0;
      const instanceGroups = [];
      const instanceGroupList = Array.isArray(groupRecord.instance_groups) ? groupRecord.instance_groups : [];
      for (const instanceGroup of instanceGroupList) {
        const instanceGroupRecord = asRecord(instanceGroup);
        const instanceByCamera = /* @__PURE__ */ new Map();
        const instancesRecord = asRecord(instanceGroupRecord.instances);
        for (const [cameraKey, points] of Object.entries(instancesRecord)) {
          const camera = cameraMap.get(cameraKey);
          if (!camera) continue;
          const skeleton = skeletons[0] ?? new Skeleton({ nodes: [] });
          instanceByCamera.set(camera, new Instance({ points, skeleton }));
        }
        const rawPoints = instanceGroupRecord.points;
        const pointsValue = Array.isArray(rawPoints) ? rawPoints : void 0;
        instanceGroups.push(
          new InstanceGroup({
            instanceByCamera,
            score: instanceGroupRecord.score,
            points: pointsValue,
            metadata: instanceGroupRecord.metadata ?? {}
          })
        );
      }
      const labeledFrameByCamera = /* @__PURE__ */ new Map();
      const labeledFrameMap = asRecord(groupRecord.labeled_frame_by_camera);
      for (const [cameraKey, labeledFrameIdx] of Object.entries(labeledFrameMap)) {
        const camera = cameraMap.get(cameraKey);
        const labeledFrame = labeledFrames[Number(labeledFrameIdx)];
        if (camera && labeledFrame) {
          labeledFrameByCamera.set(camera, labeledFrame);
        }
      }
      session.frameGroups.set(
        Number(frameIdx),
        new FrameGroup({
          frameIdx: Number(frameIdx),
          instanceGroups,
          labeledFrameByCamera,
          metadata: groupRecord.metadata ?? {}
        })
      );
    }
    sessions.push(session);
  }
  return sessions;
}
function asRecord(value) {
  if (value && typeof value === "object") {
    return value;
  }
  return {};
}
function normalizeStructDataset(dataset) {
  if (!dataset) return {};
  const raw = dataset.value;
  if (!raw) return {};
  const fieldNames = getFieldNames(dataset);
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return mapStructuredRows(raw, fieldNames);
  }
  if (raw && ArrayBuffer.isView(raw) && Array.isArray(dataset.shape) && dataset.shape.length === 2) {
    const [rowCount, colCount] = dataset.shape;
    const rows = [];
    for (let i = 0; i < rowCount; i += 1) {
      const start = i * colCount;
      const end = start + colCount;
      const slice = Array.from(raw.slice(start, end));
      rows.push(slice);
    }
    return mapStructuredRows(rows, fieldNames);
  }
  if (raw && typeof raw === "object") {
    return raw;
  }
  return {};
}
function mapStructuredRows(rows, fieldNames) {
  if (!fieldNames.length) {
    return rows.reduce((acc, row, idx) => {
      acc[String(idx)] = row;
      return acc;
    }, {});
  }
  const data = {};
  fieldNames.forEach((field, idx) => {
    data[field] = rows.map((row) => row[idx]);
  });
  return data;
}
function getFieldNames(dataset) {
  const fields = dataset.dtype?.fields ? Object.keys(dataset.dtype.fields) : [];
  if (fields.length) return fields;
  const compoundMembers = dataset.metadata?.compound_type?.members;
  if (Array.isArray(compoundMembers) && compoundMembers.length) {
    const names = compoundMembers.map((member) => member.name).filter((name) => !!name);
    if (names.length) return names;
  }
  const attr = dataset.attrs?.field_names ?? dataset.attrs?.fieldNames;
  if (!attr) return [];
  const value = attr.value ?? attr;
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      return value.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
  }
  if (value instanceof Uint8Array) {
    try {
      const parsed = JSON.parse(textDecoder.decode(value));
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      return [];
    }
  }
  return [];
}
function buildLabeledFrames(options) {
  const frames = [];
  const { framesData, instancesData, pointsData, predPointsData, skeletons, tracks, videos, formatId } = options;
  const frameIds = framesData.frame_id ?? [];
  const videoIdToIndex = buildVideoIdMap(framesData, videos);
  const instanceById = /* @__PURE__ */ new Map();
  const fromPredictedPairs = [];
  for (let frameIdx = 0; frameIdx < frameIds.length; frameIdx += 1) {
    const rawVideoId = Number(framesData.video?.[frameIdx] ?? 0);
    const videoIndex = videoIdToIndex.get(rawVideoId) ?? rawVideoId;
    const frameIndex = Number(framesData.frame_idx?.[frameIdx] ?? 0);
    const instStart = Number(framesData.instance_id_start?.[frameIdx] ?? 0);
    const instEnd = Number(framesData.instance_id_end?.[frameIdx] ?? 0);
    const video = videos[videoIndex];
    if (!video) continue;
    const instances = [];
    for (let instIdx = instStart; instIdx < instEnd; instIdx += 1) {
      const instanceType = Number(instancesData.instance_type?.[instIdx] ?? 0);
      const skeletonId = Number(instancesData.skeleton?.[instIdx] ?? 0);
      const trackId = Number(instancesData.track?.[instIdx] ?? -1);
      const pointStart = Number(instancesData.point_id_start?.[instIdx] ?? 0);
      const pointEnd = Number(instancesData.point_id_end?.[instIdx] ?? 0);
      const score = Number(instancesData.score?.[instIdx] ?? 0);
      const trackingScore = Number(instancesData.tracking_score?.[instIdx] ?? 0);
      const fromPredicted = Number(instancesData.from_predicted?.[instIdx] ?? -1);
      const skeleton = skeletons[skeletonId] ?? skeletons[0];
      const track = trackId >= 0 ? tracks[trackId] : null;
      let instance;
      if (instanceType === 0) {
        const points = slicePoints(pointsData, pointStart, pointEnd);
        instance = new Instance({ points: pointsFromArray(points, skeleton.nodeNames), skeleton, track, trackingScore });
        if (formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
        if (fromPredicted >= 0) {
          fromPredictedPairs.push([instIdx, fromPredicted]);
        }
      } else {
        const points = slicePoints(predPointsData, pointStart, pointEnd, true);
        instance = new PredictedInstance({ points: predictedPointsFromArray(points, skeleton.nodeNames), skeleton, track, score, trackingScore });
        if (formatId < 1.1) {
          instance.points.forEach((point) => {
            point.xy = [point.xy[0] - 0.5, point.xy[1] - 0.5];
          });
        }
      }
      instanceById.set(instIdx, instance);
      instances.push(instance);
    }
    frames.push(new LabeledFrame({ video, frameIdx: frameIndex, instances }));
  }
  for (const [instanceId, fromPredictedId] of fromPredictedPairs) {
    const instance = instanceById.get(instanceId);
    const predicted = instanceById.get(fromPredictedId);
    if (instance && predicted instanceof PredictedInstance && instance instanceof Instance) {
      instance.fromPredicted = predicted;
    }
  }
  return frames;
}
function buildVideoIdMap(framesData, videos) {
  const videoIds = /* @__PURE__ */ new Set();
  for (const value of framesData.video ?? []) {
    videoIds.add(Number(value));
  }
  if (!videoIds.size) return /* @__PURE__ */ new Map();
  const maxId = Math.max(...Array.from(videoIds));
  if (videoIds.size === videos.length && maxId === videos.length - 1) {
    const identity = /* @__PURE__ */ new Map();
    for (let i = 0; i < videos.length; i += 1) {
      identity.set(i, i);
    }
    return identity;
  }
  const map = /* @__PURE__ */ new Map();
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const dataset = video.backend?.dataset ?? video.backendMetadata?.dataset ?? "";
    const parsedId = parseVideoIdFromDataset(dataset);
    if (parsedId != null) {
      map.set(parsedId, index);
    }
  }
  return map;
}
function parseVideoIdFromDataset(dataset) {
  if (!dataset) return null;
  const group = dataset.split("/")[0];
  if (!group.startsWith("video")) return null;
  const id = Number(group.slice(5));
  return Number.isNaN(id) ? null : id;
}
function slicePoints(data, start, end, predicted = false) {
  const xs = data.x ?? [];
  const ys = data.y ?? [];
  const visible = data.visible ?? [];
  const complete = data.complete ?? [];
  const scores = data.score ?? [];
  const points = [];
  for (let i = start; i < end; i += 1) {
    if (predicted) {
      points.push([xs[i], ys[i], scores[i], visible[i], complete[i]]);
    } else {
      points.push([xs[i], ys[i], visible[i], complete[i]]);
    }
  }
  return points;
}

// src/codecs/slp/write.ts
var isNode2 = typeof process !== "undefined" && !!process.versions?.node;
var FORMAT_ID = 1.4;
var SPAWNED_ON = 0;
async function writeSlp(filename, labels, options) {
  const embedMode = options?.embed ?? false;
  if (embedMode && embedMode !== "source") {
    throw new Error("Embedding frames is not supported yet in writeSlp.");
  }
  if (!isNode2) {
    throw new Error("writeSlp currently requires a Node.js environment.");
  }
  const module = await getH5Module();
  const file = new module.File(filename, "w");
  try {
    writeMetadata(file, labels);
    writeVideos(file, labels.videos);
    writeTracks(file, labels.tracks);
    writeSuggestions(file, labels.suggestions, labels.videos);
    writeSessions(file, labels.sessions, labels.videos, labels.labeledFrames);
    writeLabeledFrames(file, labels);
  } finally {
    file.close();
  }
}
function writeMetadata(file, labels) {
  const { skeletons, nodes } = serializeSkeletons(labels.skeletons);
  const metadata = {
    version: "2.0.0",
    skeletons,
    nodes,
    videos: [],
    tracks: [],
    suggestions: [],
    negative_anchors: {},
    provenance: labels.provenance ?? {}
  };
  file.create_group("metadata");
  const metadataGroup = file.get("metadata");
  metadataGroup.create_attribute("format_id", FORMAT_ID);
  metadataGroup.create_attribute("json", JSON.stringify(metadata));
}
function serializeSkeletons(skeletons) {
  const nodes = [];
  const nodeIndex = /* @__PURE__ */ new Map();
  for (const skeleton of skeletons) {
    for (const nodeName of skeleton.nodeNames) {
      if (!nodeIndex.has(nodeName)) {
        nodeIndex.set(nodeName, nodes.length);
        nodes.push({ name: nodeName });
      }
    }
  }
  const serialized = skeletons.map((skeleton) => {
    const links = [];
    for (const edge of skeleton.edges) {
      const source = nodeIndex.get(edge.source.name) ?? 0;
      const target = nodeIndex.get(edge.destination.name) ?? 0;
      links.push({ source, target, type: { "py/tuple": [1] } });
    }
    for (const [left, right] of skeleton.symmetryNames) {
      const source = nodeIndex.get(left) ?? 0;
      const target = nodeIndex.get(right) ?? 0;
      links.push({ source, target, type: { "py/tuple": [2] } });
    }
    return {
      links,
      name: skeleton.name ?? void 0,
      graph: skeleton.name ? { name: skeleton.name } : void 0
    };
  });
  return { skeletons: serialized, nodes };
}
function writeVideos(file, videos) {
  const payload = videos.map((video) => JSON.stringify(serializeVideo(video)));
  file.create_dataset({ name: "videos_json", data: payload });
}
function serializeVideo(video) {
  const backend = { ...video.backendMetadata ?? {} };
  if (backend.filename == null) backend.filename = video.filename;
  if (backend.dataset == null && video.backend?.dataset) backend.dataset = video.backend.dataset;
  if (backend.shape == null && video.backend?.shape) backend.shape = video.backend.shape;
  if (backend.fps == null && video.backend?.fps != null) backend.fps = video.backend.fps;
  const entry = {
    filename: video.filename,
    backend
  };
  if (video.sourceVideo) {
    entry.source_video = { filename: video.sourceVideo.filename };
  }
  return entry;
}
function writeTracks(file, tracks) {
  const payload = tracks.map((track) => JSON.stringify([SPAWNED_ON, track.name]));
  file.create_dataset({ name: "tracks_json", data: payload });
}
function writeSuggestions(file, suggestions, videos) {
  const payload = suggestions.map(
    (suggestion) => JSON.stringify({
      video: String(videos.indexOf(suggestion.video)),
      frame_idx: suggestion.frameIdx,
      group: suggestion.metadata?.group ?? 0
    })
  );
  file.create_dataset({ name: "suggestions_json", data: payload });
}
function writeSessions(file, sessions, videos, labeledFrames) {
  const labeledFrameIndex = /* @__PURE__ */ new Map();
  labeledFrames.forEach((lf, idx) => labeledFrameIndex.set(lf, idx));
  const payload = sessions.map((session) => JSON.stringify(serializeSession(session, videos, labeledFrameIndex)));
  file.create_dataset({ name: "sessions_json", data: payload });
}
function serializeSession(session, videos, labeledFrameIndex) {
  const calibration = { metadata: session.cameraGroup.metadata ?? {} };
  session.cameraGroup.cameras.forEach((camera, idx) => {
    const key = camera.name ?? String(idx);
    calibration[key] = {
      name: camera.name ?? key,
      rotation: camera.rvec,
      translation: camera.tvec,
      matrix: camera.matrix,
      distortions: camera.distortions
    };
  });
  const camcorder_to_video_idx_map = {};
  for (const [camera, video] of session.videoByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    const videoIndex = videos.indexOf(video);
    if (videoIndex >= 0) {
      camcorder_to_video_idx_map[cameraKey] = videoIndex;
    }
  }
  const frame_group_dicts = [];
  for (const frameGroup of session.frameGroups.values()) {
    if (!frameGroup.instanceGroups.length) continue;
    frame_group_dicts.push(serializeFrameGroup(frameGroup, session, labeledFrameIndex));
  }
  return {
    calibration,
    camcorder_to_video_idx_map,
    frame_group_dicts,
    metadata: session.metadata ?? {}
  };
}
function serializeFrameGroup(frameGroup, session, labeledFrameIndex) {
  const instance_groups = frameGroup.instanceGroups.map((group) => serializeInstanceGroup(group, session));
  const labeled_frame_by_camera = {};
  for (const [camera, labeledFrame] of frameGroup.labeledFrameByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    const index = labeledFrameIndex.get(labeledFrame);
    if (index !== void 0) {
      labeled_frame_by_camera[cameraKey] = index;
    }
  }
  return {
    frame_idx: frameGroup.frameIdx,
    instance_groups,
    labeled_frame_by_camera,
    metadata: frameGroup.metadata ?? {}
  };
}
function serializeInstanceGroup(group, session) {
  const instances = {};
  for (const [camera, instance] of group.instanceByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    instances[cameraKey] = pointsToDict(instance);
  }
  const payload = {
    instances
  };
  if (group.score != null) payload.score = group.score;
  if (group.points != null) payload.points = group.points;
  if (group.metadata && Object.keys(group.metadata).length) payload.metadata = group.metadata;
  return payload;
}
function pointsToDict(instance) {
  const names = instance.skeleton.nodeNames;
  const dict = {};
  instance.points.forEach((point, idx) => {
    const name = point.name ?? names[idx] ?? String(idx);
    const row = [
      point.xy[0],
      point.xy[1],
      point.visible ? 1 : 0,
      point.complete ? 1 : 0
    ];
    if (point.score != null) {
      row.push(point.score);
    }
    dict[name] = row;
  });
  return dict;
}
function cameraKeyForSession(camera, session) {
  const index = session.cameraGroup.cameras.indexOf(camera);
  return camera.name ?? String(index);
}
function writeLabeledFrames(file, labels) {
  const frames = [];
  const instances = [];
  const points = [];
  const predPoints = [];
  const instanceIndex = /* @__PURE__ */ new Map();
  const predictedLinks = [];
  for (const labeledFrame of labels.labeledFrames) {
    const frameId = frames.length;
    const instanceStart = instances.length;
    const videoIndex = Math.max(0, labels.videos.indexOf(labeledFrame.video));
    for (const instance of labeledFrame.instances) {
      const instanceId = instances.length;
      instanceIndex.set(instance, instanceId);
      const skeletonId = Math.max(0, labels.skeletons.indexOf(instance.skeleton));
      const trackId = instance.track ? labels.tracks.indexOf(instance.track) : -1;
      const trackingScore = instance.trackingScore ?? 0;
      let fromPredicted = -1;
      let score = 0;
      let pointStart = 0;
      let pointEnd = 0;
      if (instance instanceof PredictedInstance) {
        score = instance.score ?? 0;
        pointStart = predPoints.length;
        for (const point of instance.points) {
          predPoints.push([
            point.xy[0],
            point.xy[1],
            point.visible ? 1 : 0,
            point.complete ? 1 : 0,
            point.score ?? 0
          ]);
        }
        pointEnd = predPoints.length;
      } else {
        pointStart = points.length;
        for (const point of instance.points) {
          points.push([
            point.xy[0],
            point.xy[1],
            point.visible ? 1 : 0,
            point.complete ? 1 : 0
          ]);
        }
        pointEnd = points.length;
        if (instance.fromPredicted) {
          predictedLinks.push([instanceId, instance.fromPredicted]);
        }
      }
      instances.push([
        instanceId,
        instance instanceof PredictedInstance ? 1 : 0,
        frameId,
        skeletonId,
        trackId,
        fromPredicted,
        score,
        pointStart,
        pointEnd,
        trackingScore
      ]);
    }
    const instanceEnd = instances.length;
    frames.push([frameId, videoIndex, labeledFrame.frameIdx, instanceStart, instanceEnd]);
  }
  for (const [instanceId, fromPredictedInstance] of predictedLinks) {
    const fromIndex = instanceIndex.get(fromPredictedInstance);
    if (fromIndex != null) {
      instances[instanceId][5] = fromIndex;
    } else {
      instances[instanceId][5] = -1;
    }
  }
  createMatrixDataset(file, "frames", frames, ["frame_id", "video", "frame_idx", "instance_id_start", "instance_id_end"], "<i8");
  createMatrixDataset(
    file,
    "instances",
    instances,
    [
      "instance_id",
      "instance_type",
      "frame_id",
      "skeleton",
      "track",
      "from_predicted",
      "score",
      "point_id_start",
      "point_id_end",
      "tracking_score"
    ],
    "<f8"
  );
  createMatrixDataset(file, "points", points, ["x", "y", "visible", "complete"], "<f8");
  createMatrixDataset(file, "pred_points", predPoints, ["x", "y", "visible", "complete", "score"], "<f8");
}
function createMatrixDataset(file, name, rows, fieldNames, dtype) {
  const rowCount = rows.length;
  const colCount = fieldNames.length;
  const data = rows.flat();
  file.create_dataset({ name, data, shape: [rowCount, colCount], dtype });
  const dataset = file.get(name);
  dataset.create_attribute("field_names", fieldNames);
}

// src/io/main.ts
async function loadSlp(source, options) {
  return readSlp(source, { openVideos: options?.openVideos ?? true, h5: options?.h5 });
}
async function saveSlp(labels, filename, options) {
  await writeSlp(filename, labels, {
    embed: options?.embed ?? false,
    restoreOriginalVideos: options?.restoreOriginalVideos ?? true
  });
}
async function loadVideo(filename, options) {
  const backend = await createVideoBackend(filename, { dataset: options?.dataset });
  return new Video({ filename, backend, openBackend: options?.openBackend ?? true });
}

// src/codecs/skeleton-yaml.ts
import YAML from "yaml";
function getNodeName(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.name === "string") return entry.name;
  throw new Error("Invalid node entry in skeleton YAML.");
}
function resolveName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.name === "string") return value.name;
  throw new Error("Invalid name reference in skeleton YAML.");
}
function decodeSkeleton(data, fallbackName) {
  if (!data?.nodes) throw new Error("Skeleton YAML missing nodes.");
  const nodes = data.nodes.map((entry) => new Node(getNodeName(entry)));
  const edges = (data.edges ?? []).map((edge) => {
    if (Array.isArray(edge)) {
      const [source2, destination] = edge;
      return new Edge(nodes[Number(source2)], nodes[Number(destination)]);
    }
    const sourceName = resolveName(edge.source);
    const destName = resolveName(edge.destination);
    const source = nodes.find((node) => node.name === sourceName);
    const dest = nodes.find((node) => node.name === destName);
    if (!source || !dest) throw new Error("Edge references unknown node.");
    return new Edge(source, dest);
  });
  const symmetries = (data.symmetries ?? []).map((symmetry) => {
    if (!Array.isArray(symmetry) || symmetry.length !== 2) {
      throw new Error("Symmetry must contain exactly 2 nodes.");
    }
    const [left, right] = symmetry;
    const leftName = resolveName(left);
    const rightName = resolveName(right);
    const leftNode = nodes.find((node) => node.name === leftName);
    const rightNode = nodes.find((node) => node.name === rightName);
    if (!leftNode || !rightNode) throw new Error("Symmetry references unknown node.");
    return new Symmetry([leftNode, rightNode]);
  });
  return new Skeleton({
    name: data.name ?? fallbackName,
    nodes,
    edges,
    symmetries
  });
}
function decodeYamlSkeleton(yamlData) {
  const parsed = YAML.parse(yamlData);
  if (!parsed) throw new Error("Empty skeleton YAML.");
  if (Object.prototype.hasOwnProperty.call(parsed, "nodes")) {
    return decodeSkeleton(parsed);
  }
  return Object.entries(parsed).map(
    ([name, skeletonData]) => decodeSkeleton(skeletonData, name)
  );
}
function encodeYamlSkeleton(skeletons) {
  const list = Array.isArray(skeletons) ? skeletons : [skeletons];
  const payload = {};
  list.forEach((skeleton, index) => {
    const name = skeleton.name ?? `Skeleton-${index}`;
    const nodes = skeleton.nodes.map((node) => ({ name: node.name }));
    const edges = skeleton.edges.map((edge) => ({
      source: { name: edge.source.name },
      destination: { name: edge.destination.name }
    }));
    const symmetries = skeleton.symmetries.map((symmetry) => {
      const pair = Array.from(symmetry.nodes);
      return [{ name: pair[0].name }, { name: pair[1].name }];
    });
    payload[name] = { nodes, edges, symmetries };
  });
  return YAML.stringify(payload);
}
export {
  Camera,
  CameraGroup,
  Edge,
  FrameGroup,
  Instance,
  InstanceGroup,
  LabeledFrame,
  Labels,
  LabelsSet,
  Mp4BoxVideoBackend,
  Node,
  PredictedInstance,
  RecordingSession,
  Skeleton,
  SuggestionFrame,
  Symmetry,
  Track,
  Video,
  decodeYamlSkeleton,
  encodeYamlSkeleton,
  fromDict,
  fromNumpy,
  labelsFromNumpy,
  loadSlp,
  loadVideo,
  makeCameraFromDict,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict,
  rodriguesTransformation,
  saveSlp,
  toDict,
  toNumpy
};
