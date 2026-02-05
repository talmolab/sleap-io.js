import {
  Edge,
  Instance,
  Node,
  PredictedInstance,
  Skeleton,
  Symmetry,
  Track,
  parseJsonAttr,
  parseSkeletons,
  parseSuggestions,
  parseTracks,
  parseVideosMetadata,
  pointsEmpty,
  pointsFromArray,
  pointsFromDict,
  predictedPointsEmpty,
  predictedPointsFromArray,
  predictedPointsFromDict
} from "./chunk-23DE7GPK.js";

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

// src/model/video.ts
var Video = class {
  filename;
  backend;
  backendMetadata;
  sourceVideo;
  openBackend;
  _embedded;
  constructor(options) {
    this.filename = options.filename;
    this.backend = options.backend ?? null;
    this.backendMetadata = options.backendMetadata ?? {};
    this.sourceVideo = options.sourceVideo ?? null;
    this.openBackend = options.openBackend ?? true;
    this._embedded = options.embedded ?? false;
  }
  get hasEmbeddedImages() {
    return this._embedded;
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

// src/video/streaming-hdf5-video.ts
var isBrowser3 = typeof window !== "undefined" && typeof document !== "undefined";
var PNG_MAGIC = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
var JPEG_MAGIC = new Uint8Array([255, 216, 255]);
var StreamingHdf5VideoBackend = class {
  filename;
  dataset;
  shape;
  fps;
  h5file;
  datasetPath;
  frameNumberToIndex;
  format;
  channelOrder;
  cachedData;
  frameOffsets;
  // For contiguous buffer: byte offsets of each frame
  constructor(options) {
    this.filename = options.filename;
    this.h5file = options.h5file;
    this.datasetPath = options.datasetPath;
    this.dataset = options.datasetPath;
    const frameNumbers = options.frameNumbers ?? [];
    this.frameNumberToIndex = new Map(frameNumbers.map((num, idx) => [num, idx]));
    this.format = options.format ?? "png";
    this.channelOrder = options.channelOrder ?? "RGB";
    this.shape = options.shape;
    this.fps = options.fps;
    this.cachedData = null;
    this.frameOffsets = null;
  }
  async getFrame(frameIndex) {
    const index = this.frameNumberToIndex.size > 0 ? this.frameNumberToIndex.get(frameIndex) : frameIndex;
    if (index === void 0) return null;
    if (!this.cachedData) {
      try {
        const data = await this.h5file.getDatasetValue(this.datasetPath);
        this.cachedData = normalizeVideoData(data.value, data.shape);
        if (isContiguousEncodedBuffer(this.cachedData, this.format, this.shape)) {
          this.frameOffsets = findEncodedFrameOffsets(
            this.cachedData,
            this.format,
            this.shape?.[0] ?? 0
          );
        }
      } catch {
        return null;
      }
    }
    let rawBytes;
    if (this.frameOffsets && this.frameOffsets.length > index) {
      const buffer = this.cachedData;
      const start = this.frameOffsets[index];
      const end = index + 1 < this.frameOffsets.length ? this.frameOffsets[index + 1] : buffer.length;
      rawBytes = buffer.slice(start, end);
    } else {
      const entry = this.cachedData[index];
      if (entry == null) return null;
      rawBytes = toUint8Array(entry);
    }
    if (!rawBytes || rawBytes.length === 0) return null;
    if (isEncodedFormat(this.format)) {
      const decoded = await decodeImageBytes(rawBytes, this.format, this.channelOrder);
      return decoded ?? rawBytes;
    }
    const image = decodeRawFrame(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }
  close() {
    this.cachedData = null;
    this.frameOffsets = null;
  }
};
function normalizeVideoData(value, _shape) {
  if (Array.isArray(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const arr = value;
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  return [];
}
function isContiguousEncodedBuffer(data, format, shape) {
  if (!isEncodedFormat(format)) return false;
  if (!(data instanceof Uint8Array)) return false;
  if (data.length < 8) return false;
  const isPng = matchesMagic(data, PNG_MAGIC);
  const isJpeg = matchesMagic(data, JPEG_MAGIC);
  if (!isPng && !isJpeg) return false;
  if (shape) {
    const frameCount = shape[0];
    if (frameCount > 1 && data.length > 1e4) {
      return true;
    }
  }
  return true;
}
function matchesMagic(buffer, magic) {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}
function findEncodedFrameOffsets(buffer, format, expectedFrameCount) {
  const offsets = [];
  const magic = format.toLowerCase() === "png" ? PNG_MAGIC : JPEG_MAGIC;
  for (let i = 0; i <= buffer.length - magic.length; i++) {
    if (matchesMagic(buffer.subarray(i), magic)) {
      offsets.push(i);
      i += magic.length - 1;
      if (expectedFrameCount > 0 && offsets.length >= expectedFrameCount) {
        break;
      }
    }
  }
  return offsets;
}
function toUint8Array(entry) {
  if (entry instanceof Uint8Array) return entry;
  if (entry instanceof ArrayBuffer) return new Uint8Array(entry);
  if (ArrayBuffer.isView(entry)) return new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
  if (Array.isArray(entry)) return new Uint8Array(entry.flat());
  if (entry && typeof entry === "object" && "buffer" in entry) {
    return new Uint8Array(entry.buffer);
  }
  return null;
}
function isEncodedFormat(format) {
  const normalized = format.toLowerCase();
  return normalized === "png" || normalized === "jpg" || normalized === "jpeg";
}
async function decodeImageBytes(bytes, format, channelOrder) {
  if (!isBrowser3 || typeof createImageBitmap === "undefined") return null;
  const mime = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const useBgr = channelOrder.toUpperCase() === "BGR";
  if (!useBgr) {
    return bitmap;
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const b = data[i + 2];
    data[i] = b;
    data[i + 2] = r;
  }
  return imageData;
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

// src/codecs/slp/h5-worker.ts
var H5_WORKER_CODE = `
// h5wasm streaming worker
// Handles all HDF5 operations in a Web Worker to avoid main thread blocking
// Supports: URL streaming (range requests), local files (WORKERFS), and ArrayBuffers

let h5wasmModule = null;
let FS = null;
let currentFile = null;
let mountPath = null;

self.onmessage = async function(e) {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'init':
        await initH5Wasm(payload?.h5wasmUrl);
        respond(id, { success: true });
        break;

      case 'openUrl':
        const urlResult = await openRemoteFile(payload.url, payload.filename);
        respond(id, urlResult);
        break;

      case 'openLocal':
        const localResult = await openLocalFile(payload.file, payload.filename);
        respond(id, localResult);
        break;

      case 'openBuffer':
        const bufferResult = await openBufferFile(payload.buffer, payload.filename);
        respond(id, bufferResult);
        break;

      case 'getKeys':
        const keys = getKeys(payload.path);
        respond(id, { success: true, keys });
        break;

      case 'getAttr':
        const attr = getAttr(payload.path, payload.name);
        respond(id, { success: true, value: attr });
        break;

      case 'getAttrs':
        const attrs = getAttrs(payload.path);
        respond(id, { success: true, attrs });
        break;

      case 'getDatasetMeta':
        const meta = getDatasetMeta(payload.path);
        respond(id, { success: true, meta });
        break;

      case 'getDatasetValue':
        const data = getDatasetValue(payload.path, payload.slice);
        respond(id, { success: true, data }, data.transferables);
        break;

      case 'close':
        closeFile();
        respond(id, { success: true });
        break;

      default:
        respond(id, { success: false, error: 'Unknown message type: ' + type });
    }
  } catch (error) {
    // Robustly extract error message from various error types
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object') {
      // Handle Emscripten errors which may be objects with various properties
      errorMessage = error.message || error.error || error.reason || JSON.stringify(error);
    }
    respond(id, { success: false, error: errorMessage });
  }
};

function respond(id, data, transferables) {
  if (transferables) {
    self.postMessage({ id, ...data }, transferables);
  } else {
    self.postMessage({ id, ...data });
  }
}

async function initH5Wasm(h5wasmUrl) {
  if (h5wasmModule) return;

  // Default to CDN if no URL provided
  const url = h5wasmUrl || 'https://cdn.jsdelivr.net/npm/h5wasm@0.8.8/dist/iife/h5wasm.js';

  // Import h5wasm IIFE
  importScripts(url);

  // Wait for module to be ready
  await h5wasm.ready;
  h5wasmModule = h5wasm;
  // FS is exposed directly on h5wasm module after ready
  FS = h5wasm.FS;
}

async function openRemoteFile(url, filename = 'data.h5') {
  if (!h5wasmModule) {
    throw new Error('h5wasm not initialized');
  }

  // Close any existing file
  closeFile();

  // Create mount point
  mountPath = '/remote-' + Date.now();
  FS.mkdir(mountPath);

  // Create lazy file - this enables range request streaming!
  FS.createLazyFile(mountPath, filename, url, true, false);

  // Open with h5wasm
  const filePath = mountPath + '/' + filename;
  currentFile = new h5wasm.File(filePath, 'r');

  return {
    success: true,
    path: currentFile.path,
    filename: currentFile.filename,
    keys: currentFile.keys()
  };
}

async function openLocalFile(file, filename) {
  if (!h5wasmModule) {
    throw new Error('h5wasm not initialized');
  }

  // Close any existing file
  closeFile();

  // Use provided filename or file.name
  const fname = filename || file.name || 'local.h5';

  // Create mount point for WORKERFS
  mountPath = '/local-' + Date.now();
  FS.mkdir(mountPath);

  // Mount the file using WORKERFS (zero-copy access)
  FS.mount(FS.filesystems.WORKERFS, { files: [file] }, mountPath);

  // Open with h5wasm
  const filePath = mountPath + '/' + fname;
  currentFile = new h5wasm.File(filePath, 'r');

  return {
    success: true,
    path: currentFile.path,
    filename: currentFile.filename,
    keys: currentFile.keys()
  };
}

async function openBufferFile(buffer, filename = 'data.h5') {
  if (!h5wasmModule) {
    throw new Error('h5wasm not initialized');
  }

  // Close any existing file
  closeFile();

  // Write buffer to virtual filesystem
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  mountPath = '/buffer-' + Date.now() + '/' + filename;

  // Create parent directory
  const dir = mountPath.substring(0, mountPath.lastIndexOf('/'));
  FS.mkdir(dir);

  // Write file to virtual FS
  FS.writeFile(mountPath, data);

  // Open with h5wasm
  currentFile = new h5wasm.File(mountPath, 'r');

  return {
    success: true,
    path: currentFile.path,
    filename: currentFile.filename,
    keys: currentFile.keys()
  };
}

function getKeys(path) {
  if (!currentFile) throw new Error('No file open');
  const item = path === '/' || !path ? currentFile : currentFile.get(path);
  if (!item) throw new Error('Path not found: ' + path);
  return item.keys ? item.keys() : [];
}

function serializeAttrValue(attr) {
  if (!attr) return null;
  // h5wasm Attribute objects have a .value property
  const val = attr.value !== undefined ? attr.value : attr;
  // Convert Uint8Array to string for JSON attributes
  if (val instanceof Uint8Array) {
    return { value: new TextDecoder().decode(val) };
  }
  // Wrap primitive values to preserve structure
  return { value: val };
}

function getAttr(path, name) {
  if (!currentFile) throw new Error('No file open');
  const item = path === '/' || !path ? currentFile : currentFile.get(path);
  if (!item) throw new Error('Path not found: ' + path);
  const attrs = item.attrs;
  const attr = attrs?.[name];
  return serializeAttrValue(attr);
}

function getAttrs(path) {
  if (!currentFile) throw new Error('No file open');
  const item = path === '/' || !path ? currentFile : currentFile.get(path);
  if (!item) throw new Error('Path not found: ' + path);
  const rawAttrs = item.attrs || {};
  // Serialize all attributes for proper transfer through postMessage
  const serialized = {};
  for (const key of Object.keys(rawAttrs)) {
    serialized[key] = serializeAttrValue(rawAttrs[key]);
  }
  return serialized;
}

function getDatasetMeta(path) {
  if (!currentFile) throw new Error('No file open');
  const dataset = currentFile.get(path);
  if (!dataset) throw new Error('Dataset not found: ' + path);
  return {
    shape: dataset.shape,
    dtype: dataset.dtype,
    metadata: dataset.metadata
  };
}

function getDatasetValue(path, slice) {
  if (!currentFile) throw new Error('No file open');
  const dataset = currentFile.get(path);
  if (!dataset) throw new Error('Dataset not found: ' + path);

  // Get value or slice
  let value;
  if (slice && Array.isArray(slice)) {
    value = dataset.slice(slice);
  } else {
    value = dataset.value;
  }

  // Prepare for transfer
  const transferables = [];
  let transferValue = value;

  if (ArrayBuffer.isView(value)) {
    // TypedArray - transfer the underlying buffer
    transferValue = {
      type: 'typedarray',
      dtype: value.constructor.name,
      buffer: value.buffer,
      byteOffset: value.byteOffset,
      length: value.length
    };
    transferables.push(value.buffer);
  } else if (value instanceof ArrayBuffer) {
    transferValue = { type: 'arraybuffer', buffer: value };
    transferables.push(value);
  }

  return {
    value: transferValue,
    shape: dataset.shape,
    dtype: dataset.dtype,
    transferables
  };
}

function closeFile() {
  if (currentFile) {
    try { currentFile.close(); } catch (e) {}
    currentFile = null;
  }
  if (mountPath && FS) {
    try { FS.rmdir(mountPath); } catch (e) {}
    mountPath = null;
  }
}
`;
function createH5Worker() {
  const blob = new Blob([H5_WORKER_CODE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  worker.addEventListener(
    "error",
    () => {
      URL.revokeObjectURL(url);
    },
    { once: true }
  );
  return worker;
}

// src/codecs/slp/h5-streaming.ts
function reconstructValue(data) {
  if (data && typeof data === "object" && "type" in data) {
    const typed = data;
    if (typed.type === "typedarray" && typed.buffer) {
      const TypedArrayConstructor = getTypedArrayConstructor(typed.dtype || "Uint8Array");
      return new TypedArrayConstructor(typed.buffer, typed.byteOffset || 0, typed.length);
    }
    if (typed.type === "arraybuffer" && typed.buffer) {
      return typed.buffer;
    }
  }
  return data;
}
function getTypedArrayConstructor(name) {
  const constructors = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array
  };
  return constructors[name] || Uint8Array;
}
var StreamingH5File = class {
  worker;
  messageId = 0;
  pendingMessages = /* @__PURE__ */ new Map();
  _keys = [];
  _isOpen = false;
  constructor() {
    this.worker = createH5Worker();
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
  }
  handleMessage(e) {
    const { id, ...data } = e.data;
    const pending = this.pendingMessages.get(id);
    if (pending) {
      this.pendingMessages.delete(id);
      if (data.success) {
        pending.resolve(e.data);
      } else {
        let errorMessage = "Worker operation failed";
        if (typeof data.error === "string") {
          errorMessage = data.error;
        } else if (data.error && typeof data.error === "object") {
          errorMessage = JSON.stringify(data.error);
        }
        pending.reject(new Error(errorMessage));
      }
    }
  }
  handleError(e) {
    console.error("[StreamingH5File] Worker error:", e.message);
    for (const [id, pending] of this.pendingMessages) {
      pending.reject(new Error(`Worker error: ${e.message}`));
      this.pendingMessages.delete(id);
    }
  }
  send(type, payload) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingMessages.set(id, { resolve, reject });
      this.worker.postMessage({ type, payload, id });
    });
  }
  /**
   * Initialize the h5wasm module in the worker.
   */
  async init(options) {
    await this.send("init", { h5wasmUrl: options?.h5wasmUrl });
  }
  /**
   * Open a remote HDF5 file for streaming access via URL.
   *
   * @param url - URL to the HDF5 file (must support HTTP range requests)
   * @param options - Optional settings
   */
  async open(url, options) {
    await this.init(options);
    const filename = options?.filenameHint || url.split("/").pop()?.split("?")[0] || "data.h5";
    const result = await this.send("openUrl", { url, filename });
    this._keys = result.keys || [];
    this._isOpen = true;
  }
  /**
   * Open a local File object using WORKERFS (zero-copy).
   *
   * @param file - File object from file input or drag-and-drop
   * @param options - Optional settings
   */
  async openLocal(file, options) {
    await this.init(options);
    const filename = options?.filenameHint || file.name || "data.h5";
    const result = await this.send("openLocal", { file, filename });
    this._keys = result.keys || [];
    this._isOpen = true;
  }
  /**
   * Open an HDF5 file from an ArrayBuffer or Uint8Array.
   *
   * @param buffer - ArrayBuffer or Uint8Array containing the HDF5 file data
   * @param options - Optional settings
   */
  async openBuffer(buffer, options) {
    await this.init(options);
    const filename = options?.filenameHint || "data.h5";
    const data = buffer instanceof Uint8Array ? buffer.buffer : buffer;
    const result = await this.send("openBuffer", { buffer: data, filename });
    this._keys = result.keys || [];
    this._isOpen = true;
  }
  /**
   * Open an HDF5 file from any supported source.
   *
   * @param source - URL string, File, ArrayBuffer, or Uint8Array
   * @param options - Optional settings
   */
  async openAny(source, options) {
    if (typeof source === "string") {
      return this.open(source, options);
    }
    if (typeof File !== "undefined" && source instanceof File) {
      return this.openLocal(source, options);
    }
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      return this.openBuffer(source, options);
    }
    throw new Error("Unsupported source type for StreamingH5File");
  }
  /**
   * Whether a file is currently open.
   */
  get isOpen() {
    return this._isOpen;
  }
  /**
   * Get the root-level keys in the file.
   */
  keys() {
    return this._keys;
  }
  /**
   * Get the keys (children) at a given path.
   */
  async getKeys(path) {
    const result = await this.send("getKeys", { path });
    return result.keys || [];
  }
  /**
   * Get an attribute value.
   */
  async getAttr(path, name) {
    const result = await this.send("getAttr", { path, name });
    return result.value?.value ?? result.value;
  }
  /**
   * Get all attributes at a path.
   */
  async getAttrs(path) {
    const result = await this.send("getAttrs", { path });
    return result.attrs || {};
  }
  /**
   * Get dataset metadata (shape, dtype) without reading values.
   */
  async getDatasetMeta(path) {
    const result = await this.send("getDatasetMeta", { path });
    const meta = result.meta;
    return meta;
  }
  /**
   * Read a dataset's value.
   *
   * @param path - Path to the dataset
   * @param slice - Optional slice specification (array of [start, end] pairs)
   */
  async getDatasetValue(path, slice) {
    const result = await this.send("getDatasetValue", { path, slice });
    const data = result.data;
    return {
      value: reconstructValue(data.value),
      shape: data.shape,
      dtype: data.dtype
    };
  }
  /**
   * Close the file and terminate the worker.
   */
  async close() {
    if (this._isOpen) {
      await this.send("close");
      this._isOpen = false;
    }
    this.worker.terminate();
    this._keys = [];
  }
};
function isStreamingSupported() {
  return typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined";
}
async function openStreamingH5(url, options) {
  if (!isStreamingSupported()) {
    throw new Error("Streaming HDF5 requires Web Worker support");
  }
  const file = new StreamingH5File();
  await file.open(url, options);
  return file;
}
async function openH5Worker(source, options) {
  if (!isStreamingSupported()) {
    throw new Error("Web Worker HDF5 access requires Worker/Blob/URL support");
  }
  const file = new StreamingH5File();
  await file.openAny(source, options);
  return file;
}

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
var isBrowser4 = typeof window !== "undefined" && typeof document !== "undefined";
var PNG_MAGIC2 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
var JPEG_MAGIC2 = new Uint8Array([255, 216, 255]);
var Hdf5VideoBackend = class {
  filename;
  dataset;
  shape;
  fps;
  file;
  datasetPath;
  frameNumberToIndex;
  format;
  channelOrder;
  cachedData;
  frameOffsets;
  constructor(options) {
    this.filename = options.filename;
    this.file = options.file;
    this.datasetPath = options.datasetPath;
    this.dataset = options.datasetPath;
    const frameNumbers = options.frameNumbers ?? [];
    this.frameNumberToIndex = new Map(frameNumbers.map((num, idx) => [num, idx]));
    this.format = options.format ?? "png";
    this.channelOrder = options.channelOrder ?? "RGB";
    this.shape = options.shape;
    this.fps = options.fps;
    this.cachedData = null;
    this.frameOffsets = null;
  }
  async getFrame(frameIndex) {
    const dataset = this.file.get(this.datasetPath);
    if (!dataset) return null;
    const index = this.frameNumberToIndex.size > 0 ? this.frameNumberToIndex.get(frameIndex) : frameIndex;
    if (index === void 0) return null;
    if (!this.cachedData) {
      const value = dataset.value;
      this.cachedData = normalizeVideoData2(value);
      if (isContiguousEncodedBuffer2(this.cachedData, this.format, this.shape)) {
        this.frameOffsets = findEncodedFrameOffsets2(
          this.cachedData,
          this.format,
          this.shape?.[0] ?? 0
        );
      }
    }
    let rawBytes;
    if (this.frameOffsets && this.frameOffsets.length > index) {
      const buffer = this.cachedData;
      const start = this.frameOffsets[index];
      const end = index + 1 < this.frameOffsets.length ? this.frameOffsets[index + 1] : buffer.length;
      rawBytes = buffer.slice(start, end);
    } else {
      const entry = this.cachedData[index];
      if (entry == null) return null;
      rawBytes = toUint8Array2(entry);
    }
    if (!rawBytes || rawBytes.length === 0) return null;
    if (isEncodedFormat2(this.format)) {
      const decoded = await decodeImageBytes2(rawBytes, this.format, this.channelOrder);
      return decoded ?? rawBytes;
    }
    const image = decodeRawFrame2(rawBytes, this.shape, this.channelOrder);
    return image ?? rawBytes;
  }
  close() {
    this.cachedData = null;
    this.frameOffsets = null;
  }
};
function normalizeVideoData2(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const arr = value;
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  return [];
}
function isContiguousEncodedBuffer2(data, format, shape) {
  if (!isEncodedFormat2(format)) return false;
  if (!(data instanceof Uint8Array)) return false;
  if (data.length < 8) return false;
  const isPng = matchesMagic2(data, PNG_MAGIC2);
  const isJpeg = matchesMagic2(data, JPEG_MAGIC2);
  if (!isPng && !isJpeg) return false;
  if (shape) {
    const frameCount = shape[0];
    if (frameCount > 1 && data.length > 1e4) {
      return true;
    }
  }
  return true;
}
function matchesMagic2(buffer, magic) {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}
function findEncodedFrameOffsets2(buffer, format, expectedFrameCount) {
  const offsets = [];
  const magic = format.toLowerCase() === "png" ? PNG_MAGIC2 : JPEG_MAGIC2;
  for (let i = 0; i <= buffer.length - magic.length; i++) {
    if (matchesMagic2(buffer.subarray(i), magic)) {
      offsets.push(i);
      i += magic.length - 1;
      if (expectedFrameCount > 0 && offsets.length >= expectedFrameCount) {
        break;
      }
    }
  }
  return offsets;
}
function toUint8Array2(entry) {
  if (entry instanceof Uint8Array) return entry;
  if (entry instanceof ArrayBuffer) return new Uint8Array(entry);
  if (ArrayBuffer.isView(entry)) return new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
  if (Array.isArray(entry)) return new Uint8Array(entry.flat());
  if (entry?.buffer) return new Uint8Array(entry.buffer);
  return null;
}
function isEncodedFormat2(format) {
  const normalized = format.toLowerCase();
  return normalized === "png" || normalized === "jpg" || normalized === "jpeg";
}
async function decodeImageBytes2(bytes, format, channelOrder) {
  if (!isBrowser4 || typeof createImageBitmap === "undefined") return null;
  const mime = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes.buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const useBgr = channelOrder.toUpperCase() === "BGR";
  if (!useBgr) {
    return bitmap;
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const b = data[i + 2];
    data[i] = b;
    data[i + 2] = r;
  }
  return imageData;
}
function decodeRawFrame2(bytes, shape, channelOrder) {
  if (!isBrowser4 || !shape) return null;
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
    const skeletons = parseSkeletons(metadataJson);
    const tracks = readTracks(file.get("tracks_json"));
    const videos = await readVideos(file.get("videos_json"), labelsPath, options?.openVideos ?? true, file, formatId);
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
async function readVideos(dataset, labelsPath, openVideos, file, formatId) {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const videos = [];
  for (let videoIndex = 0; videoIndex < values.length; videoIndex++) {
    const entry = values[videoIndex];
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
    if (embedded && !datasetPath) {
      datasetPath = findVideoDataset(file, videoIndex);
    }
    let format = backendMeta.format;
    let channelOrderFromAttrs;
    if (datasetPath) {
      const videoDs = file.get(datasetPath);
      if (videoDs) {
        const attrs = videoDs.attrs ?? {};
        if (!format) {
          format = attrs.format?.value ?? attrs.format;
        }
        if (attrs.channel_order) {
          channelOrderFromAttrs = attrs.channel_order?.value ?? attrs.channel_order;
        }
      }
    }
    const channelOrder = backendMeta.channel_order ?? channelOrderFromAttrs ?? (formatId < 1.4 ? "BGR" : "RGB");
    let backend = null;
    if (openVideos) {
      backend = await createVideoBackend(filename, {
        dataset: datasetPath ?? void 0,
        embedded,
        frameNumbers: readFrameNumbers(file, datasetPath),
        format,
        channelOrder,
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
        openBackend: openVideos,
        embedded
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
function findVideoDataset(file, videoIndex) {
  const explicitPath = `video${videoIndex}/video`;
  if (file.get(explicitPath)) {
    return explicitPath;
  }
  const keys = file.keys?.() ?? [];
  for (const key of keys) {
    if (key.startsWith("video")) {
      const candidatePath = `${key}/video`;
      if (file.get(candidatePath)) {
        if (videoIndex === 0) {
          return candidatePath;
        }
        const keyIndex = parseInt(key.slice(5), 10);
        if (!isNaN(keyIndex) && keyIndex === videoIndex) {
          return candidatePath;
        }
      }
    }
  }
  return null;
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

// src/codecs/slp/read-streaming.ts
async function readSlpStreaming(source, options) {
  if (!isStreamingSupported()) {
    throw new Error("Streaming HDF5 requires Web Worker support (browser environment)");
  }
  const file = await openH5Worker(source, {
    h5wasmUrl: options?.h5wasmUrl,
    filenameHint: options?.filenameHint
  });
  const openVideos = options?.openVideos ?? false;
  const sourcePath = typeof source === "string" ? source : typeof File !== "undefined" && source instanceof File ? source.name : options?.filenameHint ?? "slp-data.slp";
  try {
    return await readFromStreamingFile(file, sourcePath, options?.filenameHint, openVideos);
  } finally {
    if (!openVideos) {
      await file.close();
    }
  }
}
async function readFromStreamingFile(file, url, filenameHint, openVideos = false) {
  const metadataAttrs = await file.getAttrs("metadata");
  const formatId = Number(
    metadataAttrs["format_id"]?.value ?? metadataAttrs["format_id"] ?? 1
  );
  const metadataJson = parseJsonAttr(metadataAttrs["json"]);
  const labelsPath = filenameHint ?? url.split("/").pop()?.split("?")[0] ?? "slp-data.slp";
  const skeletons = parseSkeletons(metadataJson);
  const tracks = await readTracksStreaming(file);
  const videos = await readVideosStreaming(file, labelsPath, openVideos, formatId);
  const suggestions = await readSuggestionsStreaming(file, videos);
  const framesData = await readStructDatasetStreaming(file, "frames");
  const instancesData = await readStructDatasetStreaming(file, "instances");
  const pointsData = await readStructDatasetStreaming(file, "points");
  const predPointsData = await readStructDatasetStreaming(file, "pred_points");
  const labeledFrames = buildLabeledFrames2({
    framesData,
    instancesData,
    pointsData,
    predPointsData,
    skeletons,
    tracks,
    videos,
    formatId
  });
  return new Labels({
    labeledFrames,
    videos,
    skeletons,
    tracks,
    suggestions,
    sessions: [],
    // Sessions require complex parsing, skip for now
    provenance: metadataJson?.provenance ?? {}
  });
}
async function readTracksStreaming(file) {
  try {
    const keys = file.keys();
    if (!keys.includes("tracks_json")) return [];
    const data = await file.getDatasetValue("tracks_json");
    const values = normalizeDatasetArray(data.value);
    return parseTracks(values);
  } catch {
    return [];
  }
}
async function readVideosStreaming(file, labelsPath, openVideos = false, formatId = 1) {
  try {
    const keys = file.keys();
    if (!keys.includes("videos_json")) return [];
    const data = await file.getDatasetValue("videos_json");
    const values = normalizeDatasetArray(data.value);
    const metadataList = parseVideosMetadata(values, labelsPath);
    const videos = [];
    for (let videoIndex = 0; videoIndex < metadataList.length; videoIndex++) {
      const meta = metadataList[videoIndex];
      const shape = meta.frameCount && meta.height && meta.width && meta.channels ? [meta.frameCount, meta.height, meta.width, meta.channels] : void 0;
      let datasetPath = meta.dataset;
      if (meta.embedded && !datasetPath) {
        datasetPath = await findVideoDatasetStreaming(file, videoIndex) ?? void 0;
      }
      let format = meta.format;
      let channelOrderFromAttrs;
      if (datasetPath) {
        try {
          const attrs = await file.getAttrs(datasetPath);
          if (!format) {
            const formatAttr = attrs.format;
            if (formatAttr) {
              format = typeof formatAttr === "string" ? formatAttr : formatAttr?.value;
            }
          }
          const channelOrderAttr = attrs.channel_order;
          if (channelOrderAttr) {
            channelOrderFromAttrs = typeof channelOrderAttr === "string" ? channelOrderAttr : channelOrderAttr?.value;
          }
        } catch {
        }
      }
      const channelOrder = meta.channelOrder ?? channelOrderFromAttrs ?? (formatId < 1.4 ? "BGR" : "RGB");
      let backend = null;
      if (openVideos && meta.embedded && datasetPath) {
        const frameNumbers = await readFrameNumbersStreaming(file, datasetPath);
        backend = new StreamingHdf5VideoBackend({
          filename: meta.filename,
          h5file: file,
          datasetPath,
          frameNumbers,
          format: format ?? "png",
          channelOrder,
          shape,
          fps: meta.fps
        });
      }
      videos.push(new Video({
        filename: meta.filename,
        backend,
        backendMetadata: {
          dataset: datasetPath,
          format,
          shape,
          fps: meta.fps,
          channel_order: channelOrder
        },
        sourceVideo: meta.sourceVideo ? new Video({ filename: meta.sourceVideo.filename }) : null,
        openBackend: openVideos && meta.embedded,
        embedded: meta.embedded
      }));
    }
    return videos;
  } catch {
    return [];
  }
}
async function readFrameNumbersStreaming(file, datasetPath) {
  try {
    const groupPath = datasetPath.endsWith("/video") ? datasetPath.slice(0, -6) : datasetPath;
    const frameNumbersPath = `${groupPath}/frame_numbers`;
    const groupKeys = await file.getKeys(groupPath);
    if (!groupKeys.includes("frame_numbers")) {
      return [];
    }
    const data = await file.getDatasetValue(frameNumbersPath);
    const values = data.value;
    if (Array.isArray(values)) {
      return values.map((v) => Number(v));
    }
    if (ArrayBuffer.isView(values)) {
      return Array.from(values).map(Number);
    }
    return [];
  } catch {
    return [];
  }
}
async function findVideoDatasetStreaming(file, videoIndex) {
  try {
    const explicitPath = `video${videoIndex}/video`;
    const explicitGroupPath = `video${videoIndex}`;
    try {
      const groupKeys = await file.getKeys(explicitGroupPath);
      if (groupKeys.includes("video")) {
        return explicitPath;
      }
    } catch {
    }
    const rootKeys = file.keys();
    for (const key of rootKeys) {
      if (key.startsWith("video")) {
        try {
          const groupKeys = await file.getKeys(key);
          if (groupKeys.includes("video")) {
            const candidatePath = `${key}/video`;
            if (videoIndex === 0) {
              return candidatePath;
            }
            const keyIndex = parseInt(key.slice(5), 10);
            if (!isNaN(keyIndex) && keyIndex === videoIndex) {
              return candidatePath;
            }
          }
        } catch {
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
async function readSuggestionsStreaming(file, videos) {
  try {
    const keys = file.keys();
    if (!keys.includes("suggestions_json")) return [];
    const data = await file.getDatasetValue("suggestions_json");
    const values = normalizeDatasetArray(data.value);
    const metadataList = parseSuggestions(values);
    return metadataList.map((meta) => {
      const video = videos[meta.video];
      if (!video) return null;
      return new SuggestionFrame({
        video,
        frameIdx: meta.frameIdx,
        metadata: meta.metadata
      });
    }).filter((s) => s !== null);
  } catch {
    return [];
  }
}
async function readStructDatasetStreaming(file, path) {
  try {
    const keys = file.keys();
    if (!keys.includes(path)) return {};
    const meta = await file.getDatasetMeta(path);
    const data = await file.getDatasetValue(path);
    const fieldNames = getFieldNamesFromMeta(meta);
    return normalizeStructData(data.value, data.shape, fieldNames);
  } catch {
    return {};
  }
}
function getFieldNamesFromMeta(meta) {
  const dtype = meta.dtype;
  if (typeof dtype === "string") {
    const namesMatch = dtype.match(/'names':\s*\[([^\]]+)\]/);
    if (namesMatch) {
      const namesStr = namesMatch[1];
      const names = namesStr.match(/'([^']+)'/g);
      if (names) {
        return names.map((n) => n.replace(/'/g, ""));
      }
    }
  }
  if (typeof dtype === "object" && dtype !== null) {
    const dtypeObj = dtype;
    if (dtypeObj.compound_type && typeof dtypeObj.compound_type === "object") {
      const compound = dtypeObj.compound_type;
      if (compound.members) {
        return compound.members.map((m) => m.name).filter((n) => !!n);
      }
    }
  }
  return [];
}
function normalizeStructData(value, shape, fieldNames) {
  if (!value) return {};
  if (value && typeof value === "object" && !Array.isArray(value) && !ArrayBuffer.isView(value)) {
    const obj = value;
    const firstKey = Object.keys(obj)[0];
    if (firstKey && Array.isArray(obj[firstKey])) {
      return obj;
    }
  }
  if (ArrayBuffer.isView(value) && shape.length === 2) {
    const [rowCount, colCount] = shape;
    const arr = value;
    if (fieldNames.length === colCount) {
      const result = {};
      for (let col = 0; col < colCount; col++) {
        const colData = [];
        for (let row = 0; row < rowCount; row++) {
          colData.push(arr[row * colCount + col]);
        }
        result[fieldNames[col]] = colData;
      }
      return result;
    }
  }
  if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) {
    const rows = value;
    if (fieldNames.length) {
      const result = {};
      fieldNames.forEach((field, colIdx) => {
        result[field] = rows.map((row) => row[colIdx]);
      });
      return result;
    }
  }
  return {};
}
function normalizeDatasetArray(value) {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Array.from(value);
  }
  return [];
}
function buildLabeledFrames2(options) {
  const frames = [];
  const { framesData, instancesData, pointsData, predPointsData, skeletons, tracks, videos, formatId } = options;
  const frameIds = framesData.frame_id ?? [];
  const videoIdToIndex = buildVideoIdMap2(framesData, videos);
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
      const skeleton = skeletons[skeletonId] ?? skeletons[0] ?? new Skeleton({ nodes: [] });
      const track = trackId >= 0 ? tracks[trackId] : null;
      let instance;
      if (instanceType === 0) {
        const points = slicePoints2(pointsData, pointStart, pointEnd);
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
        const points = slicePoints2(predPointsData, pointStart, pointEnd, true);
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
function buildVideoIdMap2(framesData, videos) {
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
    const dataset = video.backendMetadata?.dataset ?? "";
    const parsedId = parseVideoIdFromDataset2(dataset);
    if (parsedId != null) {
      map.set(parsedId, index);
    }
  }
  return map;
}
function parseVideoIdFromDataset2(dataset) {
  if (!dataset) return null;
  const group = dataset.split("/")[0];
  if (!group.startsWith("video")) return null;
  const id = Number(group.slice(5));
  return Number.isNaN(id) ? null : id;
}
function slicePoints2(data, start, end, predicted = false) {
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
function isNode3() {
  return typeof process !== "undefined" && !!process.versions?.node;
}
function isBrowserWithWorkerSupport() {
  return typeof window !== "undefined" && isStreamingSupported();
}
async function loadSlp(source, options) {
  const streamMode = options?.h5?.stream ?? "auto";
  const openVideos = options?.openVideos ?? true;
  if (isBrowserWithWorkerSupport() && !isNode3() && streamMode !== "download") {
    let streamingSource;
    if (typeof source === "string") {
      streamingSource = source;
    } else if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      streamingSource = source;
    } else if (typeof File !== "undefined" && source instanceof File) {
      streamingSource = source;
    } else if (typeof FileSystemFileHandle !== "undefined" && "getFile" in source) {
      streamingSource = await source.getFile();
    } else {
      streamingSource = null;
    }
    if (streamingSource !== null) {
      try {
        return await readSlpStreaming(streamingSource, {
          filenameHint: options?.h5?.filenameHint,
          openVideos
        });
      } catch (e) {
        if (streamMode === "auto") {
          console.warn("[sleap-io] Worker-based loading failed, falling back to main thread:", e);
        } else {
          throw e;
        }
      }
    }
  }
  return readSlp(source, { openVideos, h5: options?.h5 });
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

// src/rendering/colors.ts
var NAMED_COLORS = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  brown: [139, 69, 19]
};
var PALETTES = {
  // MATLAB default colors
  standard: [
    [0, 114, 189],
    [217, 83, 25],
    [237, 177, 32],
    [126, 47, 142],
    [119, 172, 48],
    [77, 190, 238],
    [162, 20, 47]
  ],
  // Tableau 10
  tableau10: [
    [31, 119, 180],
    [255, 127, 14],
    [44, 160, 44],
    [214, 39, 40],
    [148, 103, 189],
    [140, 86, 75],
    [227, 119, 194],
    [127, 127, 127],
    [188, 189, 34],
    [23, 190, 207]
  ],
  // High-contrast distinct colors (Glasbey-inspired, for many instances)
  distinct: [
    [230, 25, 75],
    [60, 180, 75],
    [255, 225, 25],
    [67, 99, 216],
    [245, 130, 49],
    [145, 30, 180],
    [66, 212, 244],
    [240, 50, 230],
    [191, 239, 69],
    [250, 190, 212],
    [70, 153, 144],
    [220, 190, 255],
    [154, 99, 36],
    [255, 250, 200],
    [128, 0, 0],
    [170, 255, 195],
    [128, 128, 0],
    [255, 216, 177],
    [0, 0, 117],
    [169, 169, 169]
  ],
  // Viridis (10 samples)
  viridis: [
    [68, 1, 84],
    [72, 40, 120],
    [62, 74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [110, 206, 88],
    [181, 222, 43],
    [253, 231, 37]
  ],
  // Rainbow for node coloring
  rainbow: [
    [255, 0, 0],
    [255, 127, 0],
    [255, 255, 0],
    [127, 255, 0],
    [0, 255, 0],
    [0, 255, 127],
    [0, 255, 255],
    [0, 127, 255],
    [0, 0, 255],
    [127, 0, 255],
    [255, 0, 255],
    [255, 0, 127]
  ],
  // Warm colors
  warm: [
    [255, 89, 94],
    [255, 146, 76],
    [255, 202, 58],
    [255, 154, 0],
    [255, 97, 56],
    [255, 50, 50]
  ],
  // Cool colors
  cool: [
    [67, 170, 139],
    [77, 144, 142],
    [87, 117, 144],
    [97, 90, 147],
    [107, 63, 149],
    [117, 36, 152]
  ],
  // Pastel colors
  pastel: [
    [255, 179, 186],
    [255, 223, 186],
    [255, 255, 186],
    [186, 255, 201],
    [186, 225, 255],
    [219, 186, 255]
  ],
  // Seaborn-inspired
  seaborn: [
    [76, 114, 176],
    [221, 132, 82],
    [85, 168, 104],
    [196, 78, 82],
    [129, 114, 179],
    [147, 120, 96],
    [218, 139, 195],
    [140, 140, 140],
    [204, 185, 116],
    [100, 181, 205]
  ]
};
function getPalette(name, n) {
  const palette = PALETTES[name];
  if (!palette) {
    throw new Error(`Unknown palette: ${name}`);
  }
  if (n <= palette.length) {
    return palette.slice(0, n);
  }
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}
function resolveColor(color) {
  if (Array.isArray(color)) {
    if (color.length >= 3) {
      return [color[0], color[1], color[2]];
    }
    throw new Error(`Invalid color array: ${color}`);
  }
  if (typeof color === "number") {
    const v = Math.round(color);
    return [v, v, v];
  }
  if (typeof color === "string") {
    const s = color.trim().toLowerCase();
    if (s in NAMED_COLORS) {
      return NAMED_COLORS[s];
    }
    if (s.startsWith("#")) {
      return hexToRgb(s);
    }
    const paletteMatch = s.match(/^(\w+)\[(\d+)\]$/);
    if (paletteMatch) {
      const [, paletteName, indexStr] = paletteMatch;
      const palette = PALETTES[paletteName];
      if (palette) {
        const index = parseInt(indexStr, 10) % palette.length;
        return palette[index];
      }
    }
    const rgbMatch = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
    if (rgbMatch) {
      return [
        parseInt(rgbMatch[1], 10),
        parseInt(rgbMatch[2], 10),
        parseInt(rgbMatch[3], 10)
      ];
    }
  }
  throw new Error(`Cannot resolve color: ${color}`);
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16)
    ];
  }
  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }
  throw new Error(`Invalid hex color: ${hex}`);
}
function rgbToCSS(rgb, alpha = 1) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}
function determineColorScheme(scheme, hasTracks, isSingleImage) {
  if (scheme !== "auto") {
    return scheme;
  }
  if (hasTracks) {
    return "track";
  }
  if (isSingleImage) {
    return "instance";
  }
  return "node";
}

// src/rendering/shapes.ts
function drawCircle(ctx, x, y, size, fillColor, edgeColor, edgeWidth = 1) {
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}
function drawSquare(ctx, x, y, size, fillColor, edgeColor, edgeWidth = 1) {
  const half = size;
  ctx.fillStyle = fillColor;
  ctx.fillRect(x - half, y - half, half * 2, half * 2);
  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  }
}
function drawDiamond(ctx, x, y, size, fillColor, edgeColor, edgeWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}
function drawTriangle(ctx, x, y, size, fillColor, edgeColor, edgeWidth = 1) {
  const h = size * 0.866;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y + h);
  ctx.lineTo(x - size, y + h);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (edgeColor) {
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}
function drawCross(ctx, x, y, size, fillColor, _edgeColor, edgeWidth = 2) {
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = edgeWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}
var MARKER_FUNCTIONS = {
  circle: drawCircle,
  square: drawSquare,
  diamond: drawDiamond,
  triangle: drawTriangle,
  cross: drawCross
};
function getMarkerFunction(shape) {
  return MARKER_FUNCTIONS[shape];
}

// src/rendering/context.ts
var RenderContext = class {
  constructor(canvas, frameIdx, frameSize, instances, skeletonEdges, nodeNames, scale = 1, offset = [0, 0]) {
    this.canvas = canvas;
    this.frameIdx = frameIdx;
    this.frameSize = frameSize;
    this.instances = instances;
    this.skeletonEdges = skeletonEdges;
    this.nodeNames = nodeNames;
    this.scale = scale;
    this.offset = offset;
  }
  /**
   * Transform world coordinates to canvas coordinates.
   */
  worldToCanvas(x, y) {
    return [
      (x - this.offset[0]) * this.scale,
      (y - this.offset[1]) * this.scale
    ];
  }
};
var InstanceContext = class {
  constructor(canvas, instanceIdx, points, skeletonEdges, nodeNames, trackIdx = null, trackName = null, confidence = null, scale = 1, offset = [0, 0]) {
    this.canvas = canvas;
    this.instanceIdx = instanceIdx;
    this.points = points;
    this.skeletonEdges = skeletonEdges;
    this.nodeNames = nodeNames;
    this.trackIdx = trackIdx;
    this.trackName = trackName;
    this.confidence = confidence;
    this.scale = scale;
    this.offset = offset;
  }
  /**
   * Transform world coordinates to canvas coordinates.
   */
  worldToCanvas(x, y) {
    return [
      (x - this.offset[0]) * this.scale,
      (y - this.offset[1]) * this.scale
    ];
  }
  /**
   * Get centroid of valid (non-NaN) points.
   */
  getCentroid() {
    let sumX = 0, sumY = 0, count = 0;
    for (const pt of this.points) {
      const x = pt[0];
      const y = pt[1];
      if (!isNaN(x) && !isNaN(y)) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
    if (count === 0) return null;
    return [sumX / count, sumY / count];
  }
  /**
   * Get bounding box of valid points.
   * Returns [x1, y1, x2, y2] or null if no valid points.
   */
  getBbox() {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    let hasValid = false;
    for (const pt of this.points) {
      const x = pt[0];
      const y = pt[1];
      if (!isNaN(x) && !isNaN(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        hasValid = true;
      }
    }
    if (!hasValid) return null;
    return [minX, minY, maxX, maxY];
  }
};

// src/rendering/render.ts
import { Canvas } from "skia-canvas";
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
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("png");
}
async function toJPEG(imageData, quality = 0.9) {
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toBuffer("jpeg", { quality });
}
function toDataURL(imageData, format = "png") {
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL(`image/${format}`);
}
async function saveImage(imageData, path) {
  const canvas = new Canvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  await canvas.saveAs(path);
}

// src/rendering/video.ts
import { spawn } from "child_process";
async function checkFfmpeg() {
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
  MARKER_FUNCTIONS,
  Mp4BoxVideoBackend,
  NAMED_COLORS,
  Node,
  PALETTES,
  PredictedInstance,
  RecordingSession,
  RenderContext,
  Skeleton,
  StreamingH5File,
  StreamingHdf5VideoBackend,
  SuggestionFrame,
  Symmetry,
  Track,
  Video,
  checkFfmpeg,
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
  labelsFromNumpy,
  loadSlp,
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
  readSlpStreaming,
  renderImage,
  renderVideo,
  resolveColor,
  rgbToCSS,
  rodriguesTransformation,
  saveImage,
  saveSlp,
  toDataURL,
  toDict,
  toJPEG,
  toNumpy,
  toPNG
};
