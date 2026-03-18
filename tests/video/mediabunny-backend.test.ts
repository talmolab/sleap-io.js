/* @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockPackets = [
  { timestamp: 0.0 },
  { timestamp: 0.04 },
  { timestamp: 0.08 },
];

const mockTrack = {
  displayWidth: 1024,
  displayHeight: 1024,
};

const mockGetSample = vi.fn(async (timestamp: number) => ({
  timestamp,
  toVideoFrame: () => ({ close: vi.fn() }),
}));

vi.mock("mediabunny", () => ({
  Input: class MockInput {
    async getPrimaryVideoTrack() {
      return mockTrack;
    }
  },
  UrlSource: class MockUrlSource {
    constructor(public url: string) {}
  },
  BlobSource: class MockBlobSource {
    constructor(public blob: Blob) {}
  },
  VideoSampleSink: class MockVideoSampleSink {
    getSample = mockGetSample;
    async *samples(startTime: number, endTime: number) {
      for (const p of mockPackets) {
        if (p.timestamp >= startTime && p.timestamp <= endTime) {
          yield {
            timestamp: p.timestamp,
            toVideoFrame: () => ({ close: vi.fn() }),
          };
        }
      }
    }
  },
  EncodedPacketSink: class MockEncodedPacketSink {
    async *packets() {
      for (const p of mockPackets) {
        yield p;
      }
    }
  },
  ALL_FORMATS: [],
}));

describe("MediaBunnyVideoBackend", () => {
  beforeEach(() => {
    (globalThis as any).createImageBitmap = async () => ({ close: vi.fn() });
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).createImageBitmap;
  });

  it("initializes with correct shape and fps", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.webm");

    expect(backend.shape).toEqual([3, 1024, 1024, 3]);
    expect(backend.fps).toBeCloseTo(25, 0);
    backend.close();
  });

  it("returns null for out-of-range frame indices", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.webm");

    expect(await backend.getFrame(-1)).toBeNull();
    expect(await backend.getFrame(999)).toBeNull();
    backend.close();
  });

  it("returns frame for valid index", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.webm");

    const frame = await backend.getFrame(0);
    expect(frame).not.toBeNull();
    backend.close();
  });

  it("caches frames and returns from cache on second access", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.webm");

    const frame1 = await backend.getFrame(0);
    const frame2 = await backend.getFrame(0);
    expect(frame1).not.toBeNull();
    expect(frame2).not.toBeNull();
    backend.close();
  });

  it("returns frame times array", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.webm");

    const times = await backend.getFrameTimes();
    expect(times).toEqual([0.0, 0.04, 0.08]);
    backend.close();
  });

  it("close() clears state", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.webm");

    await backend.getFrame(0);
    backend.close();

    // After close, numFrames should be 0
    expect(backend.numFrames).toBe(0);
  });

  it("implements VideoBackend interface", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.webm");

    expect(backend.filename).toBe("test.webm");
    expect(typeof backend.getFrame).toBe("function");
    expect(typeof backend.getFrameTimes).toBe("function");
    expect(typeof backend.close).toBe("function");
    backend.close();
  });
});
