import { loadSlp, loadVideo } from "../dist/index.js";

const slpInput = document.querySelector("#slp-url");
const videoInput = document.querySelector("#video-url");
const fileInput = document.querySelector("#slp-file");
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

const formatFrameCoords = (frame, skeleton) => {
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

// Embedded video mode state
let embeddedMode = false;
let labeledFramesList = [];
let currentLabeledFrameIndex = 0;

const setStatus = (message) => {
  statusEl.textContent = message;
};

const setMeta = (data) => {
  if (!data) {
    metaEl.textContent = "";
    return;
  }
  let text = `Frames: ${data.frames} | Instances: ${data.instances} | Nodes: ${data.nodes}`;
  if (data.videos > 1) {
    text += ` | Videos: ${data.videos}`;
  }
  if (data.mode) {
    text += ` | Mode: ${data.mode}`;
  }
  metaEl.textContent = text;
};

const configureCanvas = (width, height) => {
  const w = width || videoEl?.videoWidth || 1280;
  const h = height || videoEl?.videoHeight || 720;
  canvas.width = w;
  canvas.height = h;
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

  trackColors.clear();
  labels.tracks.forEach((track, index) => {
    const key = getTrackKey(track) ?? track;
    trackColors.set(key, colors[index % colors.length]);
  });

  return instanceCount;
};

const drawSkeleton = (frame, skel) => {
  if (!ctx || !skel || !frame) return;

  frame.instances.forEach((instance, idx) => {
    const color = getInstanceColor(instance, idx);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    for (const edge of skel.edges) {
      const sourceIdx = skel.index(edge.source.name);
      const destIdx = skel.index(edge.destination.name);
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
};

// Render frame for external video mode
const renderExternalFrame = async (frameIdx) => {
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

  drawSkeleton(frame, skeleton);
  formatFrameCoords(frame, skeleton);
};

// Render frame for embedded video mode (multi-video)
const renderEmbeddedFrame = async (labeledFrameIndex) => {
  if (!ctx || !skeleton || labeledFrameIndex < 0 || labeledFrameIndex >= labeledFramesList.length) return;

  const frame = labeledFramesList[labeledFrameIndex];
  const video = frame.video;
  const token = ++renderToken;

  // Try to get embedded frame image
  let imageData = null;
  if (video.backend) {
    try {
      imageData = await video.backend.getFrame(frame.frameIdx);
    } catch (err) {
      console.warn("Error getting embedded frame:", err);
    }
  }

  if (token !== renderToken) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (imageData) {
    if (imageData instanceof ImageBitmap) {
      configureCanvas(imageData.width, imageData.height);
      ctx.drawImage(imageData, 0, 0);
    } else if (imageData instanceof ImageData) {
      configureCanvas(imageData.width, imageData.height);
      ctx.putImageData(imageData, 0, 0);
    } else if (imageData instanceof Uint8Array) {
      // Raw bytes - try to decode as image
      const blob = new Blob([imageData], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      configureCanvas(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
    }
  } else {
    // No image - draw placeholder
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#888";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    const videoIdx = labels.videos.indexOf(video);
    ctx.fillText(`Video ${videoIdx}, Frame ${frame.frameIdx}`, canvas.width / 2, canvas.height / 2);
    ctx.fillText(`(No embedded image data)`, canvas.width / 2, canvas.height / 2 + 24);
  }

  drawSkeleton(frame, skeleton);
  formatFrameCoords(frame, skeleton);
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
  renderExternalFrame(frameIdx);
};

const updateEmbeddedFrame = (labeledFrameIndex) => {
  if (labeledFrameIndex < 0 || labeledFrameIndex >= labeledFramesList.length) return;
  currentLabeledFrameIndex = labeledFrameIndex;
  seek.value = String(labeledFrameIndex);
  const frame = labeledFramesList[labeledFrameIndex];
  const videoIdx = labels.videos.indexOf(frame.video);
  frameLabel.textContent = `Frame ${labeledFrameIndex + 1}/${labeledFramesList.length} (v${videoIdx}:${frame.frameIdx})`;
  renderEmbeddedFrame(labeledFrameIndex);
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

// Check if videos have embedded images
const hasEmbeddedImages = () => {
  if (!labels?.videos?.length) return false;
  return labels.videos.some((v) => v.backend?.dataset || v.backendMetadata?.dataset);
};

const handleLoad = async () => {
  const file = fileInput?.files?.[0];
  const slpUrl = slpInput.value.trim();
  const videoUrl = videoInput.value.trim();

  // Determine source
  const slpSource = file ? await file.arrayBuffer() : slpUrl;
  const slpFilename = file ? file.name : slpUrl;

  if (!slpSource) {
    setStatus("Enter an SLP URL or select a file.");
    return;
  }

  loadBtn.disabled = true;
  setStatus("Loading SLP...");

  try {
    // Decide whether to open embedded videos based on whether external video URL is provided
    const useEmbedded = !videoUrl;

    labels = await loadSlp(slpSource, {
      openVideos: useEmbedded,
      h5: { stream: file ? undefined : "range", filenameHint: slpFilename },
    });
    skeleton = labels.skeletons[0];
    const instanceCount = buildFrameIndex();
    labeledFramesList = labels.labeledFrames;

    // Determine mode: external video or embedded images
    embeddedMode = useEmbedded && (hasEmbeddedImages() || labels.videos.length > 1);

    if (embeddedMode) {
      // Embedded multi-video mode
      setMeta({
        frames: labeledFramesList.length,
        instances: instanceCount,
        nodes: skeleton?.nodes.length ?? 0,
        videos: labels.videos.length,
        mode: "embedded",
      });

      seek.max = String(labeledFramesList.length - 1);
      videoEl.style.display = "none";
      playBtn.style.display = "none";
      configureCanvas(1024, 1024);
      currentLabeledFrameIndex = 0;
      updateEmbeddedFrame(0);
      setStatus("Ready. Navigate through labeled frames.");
    } else {
      // External video mode
      if (!videoUrl) {
        setStatus("Enter a video URL for external video mode.");
        loadBtn.disabled = false;
        return;
      }

      setMeta({
        frames: frameCount,
        instances: instanceCount,
        nodes: skeleton?.nodes.length ?? 0,
        videos: 1,
        mode: "external",
      });

      setStatus("Loading video metadata...");
      videoModel = await loadVideo(videoUrl);
      frameTimes = await videoModel.getFrameTimes();
      fps = videoModel.fps ?? labels.video?.fps ?? 30;

      setStatus("Loading video...");
      videoEl.style.display = "block";
      playBtn.style.display = "inline-block";
      videoEl.src = videoUrl;
      await videoEl.play().catch(() => {});
      videoEl.pause();
      await new Promise((resolve) => {
        if (videoEl.readyState >= 1) return resolve();
        videoEl.addEventListener("loadedmetadata", resolve, { once: true });
      });

      const shape = videoModel?.shape;
      configureCanvas(shape?.[2], shape?.[1]);
      updateFpsFromVideo();
      seek.max = String(maxFrame);
      currentFrame = 0;
      renderToken = 0;
      updateFrameFromVideo(0);
      setStatus("Ready.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Load failed: ${message}`);
    console.error(error);
  } finally {
    loadBtn.disabled = false;
  }
};

seek.addEventListener("input", () => {
  if (embeddedMode) {
    updateEmbeddedFrame(Number(seek.value));
  } else {
    const frameIdx = Number(seek.value);
    currentFrame = frameIdx;
    frameLabel.textContent = `Frame ${frameIdx}`;
    renderExternalFrame(frameIdx);
  }
});

playBtn?.addEventListener("click", () => {
  if (embeddedMode) return; // No playback in embedded mode
  if (isPlaying) {
    stopPlayback();
    playBtn.textContent = "Play";
  } else {
    startPlayback();
    playBtn.textContent = "Pause";
  }
});

// Keyboard navigation (works in both modes)
document.addEventListener("keydown", (e) => {
  if (!labels) return;
  if (e.key === "ArrowLeft" || e.key === "a") {
    if (embeddedMode) {
      if (currentLabeledFrameIndex > 0) {
        updateEmbeddedFrame(currentLabeledFrameIndex - 1);
      }
    } else {
      if (currentFrame > 0) {
        currentFrame--;
        seek.value = String(currentFrame);
        frameLabel.textContent = `Frame ${currentFrame}`;
        renderExternalFrame(currentFrame);
      }
    }
  } else if (e.key === "ArrowRight" || e.key === "d") {
    if (embeddedMode) {
      if (currentLabeledFrameIndex < labeledFramesList.length - 1) {
        updateEmbeddedFrame(currentLabeledFrameIndex + 1);
      }
    } else {
      if (currentFrame < maxFrame) {
        currentFrame++;
        seek.value = String(currentFrame);
        frameLabel.textContent = `Frame ${currentFrame}`;
        renderExternalFrame(currentFrame);
      }
    }
  }
});

// Clear video URL when file is selected
fileInput?.addEventListener("change", () => {
  if (fileInput.files?.length) {
    videoInput.value = "";
    slpInput.value = fileInput.files[0].name;
  }
});

loadBtn.addEventListener("click", handleLoad);

handleLoad();
