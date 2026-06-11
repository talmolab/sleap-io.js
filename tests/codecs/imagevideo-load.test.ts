/**
 * End-to-end SLP loading of image-sequence (ImageVideo) videos, plus the
 * per-video crash-guard.
 *
 * `imgvideo.slp` references a single image path (`tests/data/videos/imgs/
 * img.00.jpg`). Before this work, `loadSlp(..., { openVideos: true })` routed
 * that to `MediaVideoBackend` and threw ("requires a browser environment"),
 * aborting the WHOLE load. Now:
 *  - a single image-extension filename routes to `ImageVideoBackend` (parity
 *    with Python `ImageVideo.from_filename`), and
 *  - any per-video backend-creation failure is caught: the video loads with
 *    `backend === null` and a `backendError`, instead of aborting the project.
 */
import { describe, it, expect } from "../bun-test";
import { loadSlp } from "../../src/io/main.js";
import { ImageVideoBackend } from "../../src/video/image-video.js";
import { setImageBytesReader } from "../../src/video/image-source.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const imgvideo = path.join(fixtureRoot, "slp", "imgvideo.slp");

describe("ImageVideo SLP loading", () => {
  it("loads a single-image ImageVideo and decodes its frame (Node default reader)", async () => {
    const labels = await loadSlp(imgvideo, { openVideos: true });
    const video = labels.videos[0];
    expect(video.backend).toBeInstanceOf(ImageVideoBackend);
    // The relative path resolves from the repo-root cwd via the Node reader.
    const frame = (await video.getFrame(0)) as ImageData;
    expect(frame).not.toBeNull();
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
    // shape = [frames, H, W, C]
    expect(video.shape?.[1]).toBe(frame.height);
    expect(video.shape?.[2]).toBe(frame.width);
  });

  it("crash-guard: a failing backend leaves the video backend null instead of aborting", async () => {
    setImageBytesReader(async () => {
      throw new Error("simulated missing image file");
    });
    try {
      const labels = await loadSlp(imgvideo, { openVideos: true });
      const video = labels.videos[0];
      expect(video.backend).toBeNull();
      expect(video.backendError?.kind).toBe("image-sequence");
      expect(video.backendError?.message).toContain("simulated missing image");
    } finally {
      setImageBytesReader(null);
    }
  });
});
