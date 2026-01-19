import { loadSlp } from "../assets/dist/index.js";

const slpInput = document.querySelector("#slp-url");
const loadBtn = document.querySelector("#load-btn");
const statusEl = document.querySelector("#status");
const metaEl = document.querySelector("#meta");
const imageCanvas = document.querySelector("#image");
const overlayCanvas = document.querySelector("#overlay");
const seek = document.querySelector("#seek");
const playBtn = document.querySelector("#play-btn");
const frameLabel = document.querySelector("#frame-label");

const imageCtx = imageCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");
const colors = ["#f3c56c", "#7dd3fc", "#a7f3d0", "#fda4af", "#c4b5fd"];
const trackColors = new Map();

const baseUrl = new URL("./", import.meta.url);
const defaultSlp = new URL("../assets/demo/minimal_instance.pkg.slp", baseUrl).toString();

slpInput.value = defaultSlp;

let labels = null;
let framesByIndex = new Map();
let skeleton = null;
let lastFrameDrawn = -1;
let playbackInterval = null;
let isPlaying = false;
let frameIndices = [];

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

const configureCanvas = (width, height) => {
  imageCanvas.width = width;
  imageCanvas.height = height;
  overlayCanvas.width = width;
  overlayCanvas.height = height;
};

const buildFrameIndex = () => {
  framesByIndex = new Map();
  frameIndices = [];
  let instanceCount = 0;
  for (const frame of labels.labeledFrames) {
    framesByIndex.set(frame.frameIdx, frame);
    frameIndices.push(frame.frameIdx);
    instanceCount += frame.instances.length;
  }
  frameIndices.sort((a, b) => a - b);
  seek.max = String(frameIndices.length - 1);
  setMeta({ frames: frameIndices.length, instances: instanceCount, nodes: skeleton?.nodes.length ?? 0 });

  trackColors.clear();
  labels.tracks.forEach((track, index) => {
    trackColors.set(track, colors[index % colors.length]);
  });
};

const drawImage = async (frameIdx) => {
  if (!labels?.video?.backend) return false;
  const frame = await labels.video.getFrame(frameIdx);
  if (!frame) return false;

  if (frame instanceof ImageBitmap) {
    imageCtx.drawImage(frame, 0, 0);
  } else if (frame instanceof ImageData) {
    imageCtx.putImageData(frame, 0, 0);
  }
  return true;
};

const drawOverlay = (frameIdx) => {
  if (!overlayCtx || !skeleton) return;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const frame = framesByIndex.get(frameIdx);
  if (!frame) return;

  frame.instances.forEach((instance, idx) => {
    const color = instance.track ? trackColors.get(instance.track) ?? colors[idx % colors.length] : colors[idx % colors.length];
    overlayCtx.lineWidth = 2;
    overlayCtx.strokeStyle = color;
    overlayCtx.fillStyle = color;

    for (const edge of skeleton.edges) {
      const sourceIdx = skeleton.index(edge.source.name);
      const destIdx = skeleton.index(edge.destination.name);
      const source = instance.points[sourceIdx];
      const dest = instance.points[destIdx];
      if (!source || !dest) continue;
      if (!source.visible || !dest.visible) continue;
      if (Number.isNaN(source.xy[0]) || Number.isNaN(dest.xy[0])) continue;
      overlayCtx.beginPath();
      overlayCtx.moveTo(source.xy[0], source.xy[1]);
      overlayCtx.lineTo(dest.xy[0], dest.xy[1]);
      overlayCtx.stroke();
    }

    instance.points.forEach((point) => {
      if (!point.visible || Number.isNaN(point.xy[0])) return;
      overlayCtx.beginPath();
      overlayCtx.arc(point.xy[0], point.xy[1], 3.5, 0, Math.PI * 2);
      overlayCtx.fill();
    });
  });
};

const drawFrame = async (seekIndex) => {
  const frameIdx = frameIndices[seekIndex];
  if (frameIdx === undefined) return;
  if (frameIdx === lastFrameDrawn) return;
  lastFrameDrawn = frameIdx;
  frameLabel.textContent = `Frame ${frameIdx}`;
  await drawImage(frameIdx);
  drawOverlay(frameIdx);
};

const startPlayback = () => {
  if (playbackInterval) return;
  isPlaying = true;
  playBtn.textContent = "Pause";
  const fps = labels?.video?.fps ?? 30;
  const interval = 1000 / fps;
  playbackInterval = setInterval(async () => {
    let currentSeek = Number(seek.value);
    currentSeek += 1;
    if (currentSeek >= frameIndices.length) {
      currentSeek = 0;
    }
    seek.value = String(currentSeek);
    await drawFrame(currentSeek);
  }, interval);
};

const stopPlayback = () => {
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  isPlaying = false;
  playBtn.textContent = "Play";
};

const handleLoad = async () => {
  const slpUrl = slpInput.value.trim();
  if (!slpUrl) {
    setStatus("Enter an SLP URL.");
    return;
  }

  loadBtn.disabled = true;
  stopPlayback();
  setStatus("Loading SLP...");

  try {
    labels = await loadSlp(slpUrl, {
      openVideos: true,
      h5: { stream: "range", filenameHint: "minimal_instance.pkg.slp" },
    });
    skeleton = labels.skeletons[0];
    buildFrameIndex();

    // Configure canvas size from video shape
    const shape = labels.video?.shape;
    if (shape) {
      const [, height, width] = shape;
      configureCanvas(width, height);
    } else {
      configureCanvas(384, 384);
    }

    lastFrameDrawn = -1;
    seek.value = "0";
    await drawFrame(0);
    setStatus("Ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Load failed: ${message}`);
    console.error(error);
  } finally {
    loadBtn.disabled = false;
  }
};

seek.addEventListener("input", async () => {
  const seekIndex = Number(seek.value);
  await drawFrame(seekIndex);
});

playBtn.addEventListener("click", () => {
  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

loadBtn.addEventListener("click", handleLoad);

handleLoad();
