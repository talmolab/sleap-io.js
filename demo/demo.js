import { loadSlp, loadVideo } from "../dist/index.js";

const slpInput = document.querySelector("#slp-url");
const videoInput = document.querySelector("#video-url");
const loadBtn = document.querySelector("#load-btn");
const statusEl = document.querySelector("#status");
const metaEl = document.querySelector("#meta");
const videoEl = document.querySelector("#video");
const canvas = document.querySelector("#overlay");
const seek = document.querySelector("#seek");
const playBtn = document.querySelector("#play-btn");
const frameLabel = document.querySelector("#frame-label");
const coordsEl = document.querySelector("#coords");

const ctx = canvas.getContext("2d");
const colors = ["#f3c56c", "#7dd3fc", "#a7f3d0", "#fda4af", "#c4b5fd"];
const trackColors = new Map();
const getTrackKey = (track) => {
  if (!track) return null;
  if (typeof track === "object") return track.id ?? track.name ?? track;
  return track;
};
const getInstanceColor = (instance, fallbackIndex) => {
  const trackKey = getTrackKey(instance.track);
  if (trackKey != null) {
    if (!trackColors.has(trackKey)) {
      trackColors.set(trackKey, colors[trackColors.size % colors.length]);
    }
    return trackColors.get(trackKey);
  }
  const stableIndex = instance.id ?? instance.instanceId ?? fallbackIndex;
  return colors[stableIndex % colors.length];
};

const formatPoint = (point) => {
  if (!point) return "None";
  if (!point.visible) return "None";
  const [x, y] = point.xy;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "None";
  return `${x.toFixed(2)}, ${y.toFixed(2)}`;
};

const formatFrameCoords = (frame) => {
  if (!coordsEl) return;
  if (!frame || !skeleton) {
    coordsEl.textContent = "—";
    return;
  }
  const lines = [];
  frame.instances.forEach((instance, idx) => {
    const trackName = instance.track?.name ?? `instance ${idx}`;
    lines.push(`Instance ${idx} (${trackName})`);
    instance.points.forEach((point, nodeIdx) => {
      const nodeName = skeleton.nodes[nodeIdx]?.name ?? `node ${nodeIdx}`;
      lines.push(`  ${nodeName}: ${formatPoint(point)}`);
    });
  });
  coordsEl.textContent = lines.length ? lines.join("\n") : "—";
};

const baseUrl = new URL("./", import.meta.url);
const defaultSlp = new URL("assets/demo-flies13-preds.slp", baseUrl).toString();
const defaultVideo = new URL("assets/demo-flies13-preds.mp4", baseUrl).toString();

slpInput.value = defaultSlp;
videoInput.value = defaultVideo;

let labels = null;
let videoModel = null;
let frameTimes = null;
let framesByIndex = new Map();
let skeleton = null;
let fps = 30;
let maxFrame = 0;
let frameCount = 0;
let currentFrame = 0;
let isPlaying = false;
let playHandle = null;
let playbackStartTime = 0;
let playbackStartFrame = 0;
let renderToken = 0;

const setStatus = (message) => {
  statusEl.textContent = message;
};

const setMeta = (data) => {
  if (!data) {
    metaEl.textContent = "";
    return;
  }
  metaEl.textContent = `Frames: ${data.frames} | Instances: ${data.instances} | Nodes: ${data.nodes}`;
};

const configureCanvas = () => {
  const shape = videoModel?.shape;
  const width = (shape?.[2] ?? videoEl.videoWidth) || 1280;
  const height = (shape?.[1] ?? videoEl.videoHeight) || 720;
  canvas.width = width;
  canvas.height = height;
};

const buildFrameIndex = () => {
  framesByIndex = new Map();
  let instanceCount = 0;
  for (const frame of labels.labeledFrames) {
    if (!Number.isFinite(frame.frameIdx)) continue;
    framesByIndex.set(frame.frameIdx, frame);
    instanceCount += frame.instances.length;
  }
  const frameIndices = Array.from(framesByIndex.keys()).filter((value) => Number.isFinite(value));
  maxFrame = frameIndices.length ? Math.max(...frameIndices) : 0;
  frameCount = frameIndices.length;
  seek.max = String(maxFrame);
  setMeta({ frames: frameCount, instances: instanceCount, nodes: skeleton?.nodes.length ?? 0 });

  trackColors.clear();
  labels.tracks.forEach((track, index) => {
    const key = getTrackKey(track) ?? track;
    trackColors.set(key, colors[index % colors.length]);
  });
};

const renderFrame = async (frameIdx) => {
  if (!ctx || !skeleton) return;
  const frame = framesByIndex.get(frameIdx);
  if (!frame) return;
  const token = ++renderToken;
  const videoFrame = await videoModel?.getFrame(frameIdx);
  if (token !== renderToken) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (videoFrame instanceof ImageBitmap) {
    ctx.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
  } else if (videoFrame instanceof ImageData) {
    ctx.putImageData(videoFrame, 0, 0);
  }

  frame.instances.forEach((instance, idx) => {
    const color = getInstanceColor(instance, idx);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    for (const edge of skeleton.edges) {
      const sourceIdx = skeleton.index(edge.source.name);
      const destIdx = skeleton.index(edge.destination.name);
      const source = instance.points[sourceIdx];
      const dest = instance.points[destIdx];
      if (!source || !dest) continue;
      if (!source.visible || !dest.visible) continue;
      if (Number.isNaN(source.xy[0]) || Number.isNaN(dest.xy[0])) continue;
      ctx.beginPath();
      ctx.moveTo(source.xy[0], source.xy[1]);
      ctx.lineTo(dest.xy[0], dest.xy[1]);
      ctx.stroke();
    }

    instance.points.forEach((point) => {
      if (!point.visible || Number.isNaN(point.xy[0])) return;
      ctx.beginPath();
      ctx.arc(point.xy[0], point.xy[1], 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  formatFrameCoords(frame);
};

const updateFpsFromVideo = () => {
  if (frameTimes?.length) return;
  if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;
  if (!frameCount) return;
  fps = frameCount / videoEl.duration;
};

const getFrameIndexForTime = (time) => {
  if (!Number.isFinite(time)) return 0;
  if (frameTimes?.length) {
    let low = 0;
    let high = frameTimes.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = frameTimes[mid];
      if (value === time) return mid;
      if (value < time) low = mid + 1;
      else high = mid - 1;
    }
    const idx = Math.min(frameTimes.length - 1, Math.max(0, low));
    const prev = Math.max(0, idx - 1);
    return Math.abs(frameTimes[idx] - time) < Math.abs(frameTimes[prev] - time) ? idx : prev;
  }
  return Math.min(maxFrame, Math.max(0, Math.round(time * fps)));
};

const getTimeForFrameIndex = (frameIdx) => {
  if (frameTimes?.length && frameTimes[frameIdx] != null) return frameTimes[frameIdx];
  return frameIdx / fps;
};

const updateFrameFromVideo = (time = 0) => {
  const frameIdx = getFrameIndexForTime(time);
  if (!Number.isFinite(frameIdx)) return;
  currentFrame = frameIdx;
  seek.value = String(frameIdx);
  frameLabel.textContent = `Frame ${frameIdx}`;
  renderFrame(frameIdx);
};

const playLoop = (timestamp) => {
  if (!isPlaying) return;
  if (!playbackStartTime) playbackStartTime = timestamp;
  const elapsed = (timestamp - playbackStartTime) / 1000;
  const startTime = getTimeForFrameIndex(playbackStartFrame);
  const nextFrame = getFrameIndexForTime(startTime + elapsed);
  if (nextFrame !== currentFrame) {
    updateFrameFromVideo(startTime + elapsed);
  }
  if (currentFrame >= maxFrame) {
    stopPlayback();
    return;
  }
  playHandle = requestAnimationFrame(playLoop);
};

const startPlayback = () => {
  if (isPlaying) return;
  isPlaying = true;
  playbackStartTime = 0;
  playbackStartFrame = currentFrame;
  playHandle = requestAnimationFrame(playLoop);
};

const stopPlayback = () => {
  isPlaying = false;
  if (playHandle) cancelAnimationFrame(playHandle);
  playHandle = null;
};

const handleLoad = async () => {
  const slpUrl = slpInput.value.trim();
  const videoUrl = videoInput.value.trim();
  if (!slpUrl || !videoUrl) {
    setStatus("Enter both SLP and video URLs.");
    return;
  }

  loadBtn.disabled = true;
  setStatus("Loading SLP...");

  try {
    labels = await loadSlp(slpUrl, {
      openVideos: false,
      h5: { stream: "range", filenameHint: "demo-flies13-preds.slp" },
    });
    skeleton = labels.skeletons[0];
    buildFrameIndex();

    setStatus("Loading video metadata...");
    videoModel = await loadVideo(videoUrl);
    frameTimes = await videoModel.getFrameTimes();
    fps = videoModel.fps ?? labels.video?.fps ?? 30;

    setStatus("Loading video...");
    videoEl.src = videoUrl;
    await videoEl.play().catch(() => {});
    videoEl.pause();
    await new Promise((resolve) => {
      if (videoEl.readyState >= 1) return resolve();
      videoEl.addEventListener("loadedmetadata", resolve, { once: true });
    });

    configureCanvas();
    updateFpsFromVideo();
    currentFrame = 0;
    renderToken = 0;
    updateFrameFromVideo(0);
    setStatus("Ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Load failed: ${message}`);
  } finally {
    loadBtn.disabled = false;
  }
};

seek.addEventListener("input", () => {
  const frameIdx = Number(seek.value);
  currentFrame = frameIdx;
  frameLabel.textContent = `Frame ${frameIdx}`;
  renderFrame(frameIdx);
});

playBtn.addEventListener("click", () => {
  if (isPlaying) {
    stopPlayback();
    playBtn.textContent = "Play";
  } else {
    startPlayback();
    playBtn.textContent = "Pause";
  }
});

loadBtn.addEventListener("click", handleLoad);

handleLoad();
