import { loadSlp } from "../dist/index.js";

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
const defaultSlp = new URL("demo-flies13-preds.slp", baseUrl).toString();
const defaultVideo = new URL("demo-flies13-preds.mp4", baseUrl).toString();

slpInput.value = defaultSlp;
videoInput.value = defaultVideo;

let labels = null;
let framesByIndex = new Map();
let skeleton = null;
let fps = 30;
let maxFrame = 0;
let lastFrameDrawn = -1;
let playbackLoopHandle = null;
let playbackLoopMode = null;

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
  const width = videoEl.videoWidth || 1280;
  const height = videoEl.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
};

const buildFrameIndex = () => {
  framesByIndex = new Map();
  let instanceCount = 0;
  for (const frame of labels.labeledFrames) {
    framesByIndex.set(frame.frameIdx, frame);
    instanceCount += frame.instances.length;
  }
  maxFrame = Math.max(...framesByIndex.keys());
  seek.max = String(maxFrame);
  setMeta({ frames: framesByIndex.size, instances: instanceCount, nodes: skeleton?.nodes.length ?? 0 });

  trackColors.clear();
  labels.tracks.forEach((track, index) => {
    const key = getTrackKey(track) ?? track;
    trackColors.set(key, colors[index % colors.length]);
  });
};

const drawFrame = (frameIdx) => {
  if (!ctx || !skeleton) return;
  if (frameIdx === lastFrameDrawn) return;
  lastFrameDrawn = frameIdx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const frame = framesByIndex.get(frameIdx);
  if (!frame) return;

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

const updateFrameFromVideo = () => {
  const frameIdx = Math.min(maxFrame, Math.floor(videoEl.currentTime * fps));
  seek.value = String(frameIdx);
  frameLabel.textContent = `Frame ${frameIdx}`;
  drawFrame(frameIdx);
};

const scheduleFrameUpdates = () => {
  if (playbackLoopHandle) return;
  if ("requestVideoFrameCallback" in videoEl) {
    const loop = () => {
      playbackLoopHandle = videoEl.requestVideoFrameCallback(() => {
        updateFrameFromVideo();
        if (!videoEl.paused) loop();
        else {
          playbackLoopHandle = null;
          playbackLoopMode = null;
        }
      });
      playbackLoopMode = "video";
    };
    loop();
    return;
  }

  const rafLoop = () => {
    if (videoEl.paused) {
      playbackLoopHandle = null;
      playbackLoopMode = null;
      return;
    }
    updateFrameFromVideo();
    playbackLoopHandle = requestAnimationFrame(rafLoop);
  };
  playbackLoopMode = "raf";
  playbackLoopHandle = requestAnimationFrame(rafLoop);
};

const stopFrameUpdates = () => {
  if (playbackLoopMode === "raf" && typeof playbackLoopHandle === "number") {
    cancelAnimationFrame(playbackLoopHandle);
  }
  if (
    playbackLoopMode === "video" &&
    playbackLoopHandle != null &&
    typeof videoEl.cancelVideoFrameCallback === "function"
  ) {
    videoEl.cancelVideoFrameCallback(playbackLoopHandle);
  }
  playbackLoopHandle = null;
  playbackLoopMode = null;
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
    fps = labels.video?.fps ?? 30;
    buildFrameIndex();

    setStatus("Loading video...");
    videoEl.src = videoUrl;
    await videoEl.play().catch(() => {});
    videoEl.pause();
    await new Promise((resolve) => {
      if (videoEl.readyState >= 1) return resolve();
      videoEl.addEventListener("loadedmetadata", resolve, { once: true });
    });

    configureCanvas();
    lastFrameDrawn = -1;
    updateFrameFromVideo();
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
  videoEl.currentTime = frameIdx / fps;
  frameLabel.textContent = `Frame ${frameIdx}`;
  drawFrame(frameIdx);
});

videoEl.addEventListener("seeked", updateFrameFromVideo);

playBtn.addEventListener("click", async () => {
  if (videoEl.paused) {
    await videoEl.play();
    playBtn.textContent = "Pause";
    scheduleFrameUpdates();
  } else {
    videoEl.pause();
    playBtn.textContent = "Play";
    stopFrameUpdates();
  }
});

videoEl.addEventListener("pause", stopFrameUpdates);
videoEl.addEventListener("ended", stopFrameUpdates);

loadBtn.addEventListener("click", handleLoad);

handleLoad();
