import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";
import { readFileSync } from "fs";
import { resolve } from "path";

const WEBM_PATH = resolve(
  __dirname,
  "../data/videos/centered_pair_low_quality.webm",
);

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
  // which is available in browser/Tauri WebView but not in Node.js where Vitest runs.
  // The full decode pipeline works in Tauri v2 — this is a test-runner limitation only.
});

// Issue #262: opening a video must read only the container index, not every
// frame's bytes. Uses a real H.264 MP4 with B-frames (decode order differs from
// presentation order) read through a counting RangeSource.
describe("MediaBunnyVideoBackend frame index (real B-frame MP4)", () => {
  const MP4_PATH = resolve(
    __dirname,
    "../data/videos/centered_pair_low_quality.mp4",
  );

  function countingRangeSource(buf: Uint8Array) {
    const stats = { bytesRead: 0 };
    return {
      stats,
      source: {
        size: buf.byteLength,
        readRange: async (offset: number, length: number) => {
          stats.bytesRead += length;
          return buf.subarray(offset, offset + length);
        },
      },
    };
  }

  // The fix must not read the whole file; before it, initialize() read 100%.
  it("initializes without reading the frame payloads", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const data = new Uint8Array(readFileSync(MP4_PATH));
    const { source, stats } = countingRangeSource(data);
    const backend = await MediaBunnyVideoBackend.fromRangeSource(
      source,
      "test.mp4",
    );

    expect(backend.numFrames).toBe(1100);
    expect(stats.bytesRead).toBeLessThan(data.byteLength * 0.25);
    backend.close();
  });

  // The metadata-only index must hold exactly the timestamps a full packet walk
  // sees, sorted into presentation order so frame i is the i-th frame shown.
  it("matches a full packet walk, in presentation order", async () => {
    const { Input, BlobSource, EncodedPacketSink, ALL_FORMATS } = await import(
      "mediabunny"
    );
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const data = new Uint8Array(readFileSync(MP4_PATH));

    const input = new Input({
      source: new BlobSource(new Blob([data])),
      formats: ALL_FORMATS,
    });
    const track = await input.getPrimaryVideoTrack();
    const fullWalk: number[] = [];
    for await (const packet of new EncodedPacketSink(track!).packets()) {
      fullWalk.push(packet.timestamp);
    }
    // Sanity check: this fixture really stores frames out of display order.
    expect(fullWalk.some((t, i) => i > 0 && t < fullWalk[i - 1])).toBe(true);

    const { source } = countingRangeSource(data);
    const backend = await MediaBunnyVideoBackend.fromRangeSource(
      source,
      "test.mp4",
    );
    const times = (await backend.getFrameTimes())!;

    const expected = [...fullWalk].sort((a, b) => a - b);
    expect(times.length).toBe(expected.length);
    expect(times.every((t, i) => Object.is(t, expected[i]))).toBe(true);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
    // 1100 frames at 15 fps.
    expect(backend.fps!).toBeCloseTo(15, 3);
    backend.close();
  });
});
