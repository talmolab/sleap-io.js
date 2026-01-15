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

const ctx = canvas.getContext("2d");
const colors = ["#f3c56c", "#7dd3fc", "#a7f3d0", "#fda4af", "#c4b5fd"];

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
};

const drawFrame = (frameIdx) => {
  if (!ctx || !skeleton) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const frame = framesByIndex.get(frameIdx);
  if (!frame) return;

  frame.instances.forEach((instance, idx) => {
    const color = colors[idx % colors.length];
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
};

const updateFrameFromVideo = () => {
  const frameIdx = Math.min(maxFrame, Math.floor(videoEl.currentTime * fps));
  seek.value = String(frameIdx);
  frameLabel.textContent = `Frame ${frameIdx}`;
  drawFrame(frameIdx);
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

videoEl.addEventListener("timeupdate", updateFrameFromVideo);

playBtn.addEventListener("click", async () => {
  if (videoEl.paused) {
    await videoEl.play();
    playBtn.textContent = "Pause";
  } else {
    videoEl.pause();
    playBtn.textContent = "Play";
  }
});

loadBtn.addEventListener("click", handleLoad);

handleLoad();
