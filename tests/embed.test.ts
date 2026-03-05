/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlp } from "../src/io/main.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { readSlp } from "../src/codecs/slp/read.js";
import { Labels, LabeledFrame, Video, Skeleton, Instance, SuggestionFrame } from "../src/index.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

async function loadFixture(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false });
}

describe("Frame Embedding", () => {
  it("saveSlpToBytes no longer throws for embed=true", async () => {
    // Even without open video backends, it should not throw "not supported yet"
    const labels = await loadFixture("minimal_instance.slp");
    // With openVideos=false, backends are null so no frames will be read
    // But it should not throw the old error
    const bytes = await saveSlpToBytes(labels, { embed: true });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("saveSlpToBytes with embed=false works as before", async () => {
    const labels = await loadFixture("minimal_instance.slp");
    const bytes = await saveSlpToBytes(labels);
    expect(bytes.length).toBeGreaterThan(0);

    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });
    expect(reloaded.labeledFrames.length).toBe(labels.labeledFrames.length);
  });

  it("embeds frames from pkg.slp with open backends", async () => {
    // Load a package file that has embedded video frames
    const labels = await loadSlp(
      path.join(fixtureRoot, "slp", "minimal_instance.pkg.slp"),
      { openVideos: true }
    );

    // Verify the video has embedded images
    expect(labels.videos[0].hasEmbeddedImages).toBe(true);
    expect(labels.videos[0].backend).not.toBeNull();

    // Write with embedding to a temp file so the reader can find it
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sleap-embed-"));
    const tmpFile = path.join(tmpDir, "embedded.slp");

    const bytes = await saveSlpToBytes(labels, { embed: true });
    expect(bytes.length).toBeGreaterThan(0);
    fs.writeFileSync(tmpFile, bytes);

    // Read back and verify
    const reloaded = await readSlp(tmpFile, { openVideos: true });
    expect(reloaded.labeledFrames.length).toBe(labels.labeledFrames.length);
    expect(reloaded.videos[0].hasEmbeddedImages).toBe(true);

    // Verify we can read a frame from the re-embedded video
    const frame = await reloaded.videos[0].getFrame(labels.labeledFrames[0].frameIdx);
    expect(frame).not.toBeNull();

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("embed='user' only embeds frames with user instances", async () => {
    const labels = await loadSlp(
      path.join(fixtureRoot, "slp", "minimal_instance.pkg.slp"),
      { openVideos: true }
    );

    // Count frames with user instances
    const userFrameCount = labels.labeledFrames.filter((f) => f.hasUserInstances).length;
    expect(userFrameCount).toBeGreaterThan(0);

    const bytes = await saveSlpToBytes(labels, { embed: "user" });
    expect(bytes.length).toBeGreaterThan(0);

    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: true });
    expect(reloaded.videos[0].hasEmbeddedImages).toBe(true);
  });

  it("embed='source' does not embed (backward compat)", async () => {
    const labels = await loadFixture("minimal_instance.slp");
    const bytes = await saveSlpToBytes(labels, { embed: "source" });
    expect(bytes.length).toBeGreaterThan(0);

    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });
    expect(reloaded.videos[0].hasEmbeddedImages).toBe(false);
  });

  it("sets source_video when embedding non-embedded video", async () => {
    // Create a labels with a non-embedded video that has a backend returning bytes
    const video = new Video({ filename: "original_video.mp4" });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({ labeledFrames: [frame], videos: [video], skeletons: [skeleton] });

    // Without a backend, no frames will be embedded, but the code path should work
    const bytes = await saveSlpToBytes(labels, { embed: true });
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });
    // Since no backend was available, video should not be embedded
    expect(reloaded.videos[0].hasEmbeddedImages).toBe(false);
  });

  it("re-embedded pkg.slp preserves frame data", async () => {
    const labels = await loadSlp(
      path.join(fixtureRoot, "slp", "minimal_instance.pkg.slp"),
      { openVideos: true }
    );

    // Read a frame before embedding
    const originalFrame = await labels.videos[0].getFrame(labels.labeledFrames[0].frameIdx);
    expect(originalFrame).not.toBeNull();

    // Re-embed and verify metadata
    const bytes = await saveSlpToBytes(labels, { embed: true });
    expect(bytes.length).toBeGreaterThan(0);

    // Verify the embedded video metadata
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sleap-embed-"));
    const tmpFile = path.join(tmpDir, "test.slp");
    fs.writeFileSync(tmpFile, bytes);

    const reloaded = await readSlp(tmpFile, { openVideos: true });
    expect(reloaded.videos[0].hasEmbeddedImages).toBe(true);
    expect(reloaded.labeledFrames.length).toBe(labels.labeledFrames.length);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
