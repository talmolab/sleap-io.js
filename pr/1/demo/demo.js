import { loadSlp } from "../assets/dist/index.js";

const urlInput = document.querySelector("#slp-url");
const fileInput = document.querySelector("#slp-file");
const loadButton = document.querySelector("#load-btn");
const summaryEl = document.querySelector("#summary");

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

const handleLoad = async () => {
  const source = resolveSource();
  if (!source) {
    summaryEl.textContent = "Add a URL or choose a local SLP file.";
    return;
  }

  loadButton.disabled = true;
  summaryEl.textContent = "Loading...";

  try {
    const labels = await loadSlp(source, {
      openVideos: false,
      h5: typeof source === "object" ? { filenameHint: source.name } : undefined,
    });
    summaryEl.textContent = JSON.stringify(buildSummary(labels), null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    summaryEl.textContent = JSON.stringify({ error: message }, null, 2);
  } finally {
    loadButton.disabled = false;
  }
};

loadButton.addEventListener("click", handleLoad);
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleLoad();
});
