import { loadSlp } from "../dist/index.js";

const urlInput = document.querySelector("#slp-url");
const fileInput = document.querySelector("#slp-file");
const loadButton = document.querySelector("#load-btn");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");

const defaultSummary = "No data loaded yet.";

const setStatus = (message, state = "idle") => {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
};

const setSummary = (payload) => {
  summaryEl.textContent = payload ? JSON.stringify(payload, null, 2) : defaultSummary;
};

const resolveSource = () => {
  if (fileInput.files && fileInput.files.length > 0) {
    return fileInput.files[0];
  }
  const url = urlInput.value.trim();
  return url.length ? url : null;
};

const buildSummary = (labels) => ({
  skeletons: labels.skeletons.length,
  videos: labels.videos.length,
  labeledFrames: labels.labeledFrames.length,
});

const setLoadingState = (isLoading) => {
  loadButton.disabled = isLoading;
  urlInput.disabled = isLoading;
  fileInput.disabled = isLoading;
};

const handleLoad = async () => {
  const source = resolveSource();
  if (!source) {
    setStatus("Add a URL or choose a local SLP file.", "error");
    setSummary(null);
    return;
  }

  setLoadingState(true);
  setStatus("Loading SLP data…", "ready");

  try {
    const labels = await loadSlp(source, {
      openVideos: false,
      h5: typeof source === "object" ? { filenameHint: source.name } : undefined,
    });
    setSummary(buildSummary(labels));
    setStatus("Loaded successfully.", "ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSummary({ error: message });
    setStatus("Load failed. Check the console for details.", "error");
    console.error("Failed to load SLP", error);
  } finally {
    setLoadingState(false);
  }
};

loadButton.addEventListener("click", handleLoad);
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleLoad();
});
