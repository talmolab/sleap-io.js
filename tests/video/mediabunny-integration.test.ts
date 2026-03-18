/* @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const WEBM_PATH = resolve(__dirname, "../data/videos/centered_pair_low_quality.webm");

describe("MediaBunnyVideoBackend integration (real WebM file)", () => {
  beforeEach(() => {
    (globalThis as any).createImageBitmap = async () => ({
      width: 388,
      height: 384,
      close: vi.fn(),
    });
  });

  afterEach(() => {
    delete (globalThis as any).createImageBitmap;
  });

  it("initializes from a real WebM blob with correct metadata", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );

    const data = readFileSync(WEBM_PATH);
    const blob = new Blob([data]);
    const backend = await MediaBunnyVideoBackend.fromBlob(blob, "test.webm");

    // 30 frames, 388x384 (display width with SAR 97:96), 3 channels
    expect(backend.shape).toBeDefined();
    expect(backend.shape![0]).toBe(30);
    expect(backend.shape![1]).toBe(384);
    expect(backend.shape![2]).toBe(388);
    expect(backend.shape![3]).toBe(3);

    expect(backend.fps).toBeDefined();
    expect(backend.fps!).toBeCloseTo(15, 0);

    expect(backend.filename).toBe("test.webm");
    expect(backend.numFrames).toBe(30);

    backend.close();
  });

  it("returns correct frame times from real WebM", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );

    const data = readFileSync(WEBM_PATH);
    const blob = new Blob([data]);
    const backend = await MediaBunnyVideoBackend.fromBlob(blob, "test.webm");

    const times = await backend.getFrameTimes();
    expect(times).not.toBeNull();
    expect(times!.length).toBe(30);

    // First frame at t=0
    expect(times![0]).toBeCloseTo(0, 2);

    // Timestamps should be monotonically increasing
    for (let i = 1; i < times!.length; i++) {
      expect(times![i]).toBeGreaterThan(times![i - 1]);
    }

    // Last frame near 1.933s (2s video at 15fps)
    expect(times![times!.length - 1]).toBeCloseTo(1.933, 1);

    backend.close();
  });

  it("returns null for out-of-range frames on real WebM", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );

    const data = readFileSync(WEBM_PATH);
    const blob = new Blob([data]);
    const backend = await MediaBunnyVideoBackend.fromBlob(blob, "test.webm");

    expect(await backend.getFrame(-1)).toBeNull();
    expect(await backend.getFrame(30)).toBeNull();
    expect(await backend.getFrame(999)).toBeNull();

    backend.close();
  });

  it("close resets frame count and clears state", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );

    const data = readFileSync(WEBM_PATH);
    const blob = new Blob([data]);
    const backend = await MediaBunnyVideoBackend.fromBlob(blob, "test.webm");

    expect(backend.numFrames).toBe(30);
    backend.close();
    expect(backend.numFrames).toBe(0);
  });

  // Frame decoding (getFrame with valid index) requires WebCodecs (VideoDecoder),
  // which is only available in browsers. Initialization, metadata, and frame time
  // tests above verify the MediaBunny parsing pipeline works correctly.
});
