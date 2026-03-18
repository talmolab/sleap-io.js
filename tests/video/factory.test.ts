/* @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock mediabunny to throw immediately so we can detect routing
vi.mock("mediabunny", () => ({
  Input: class MockInput {
    async getPrimaryVideoTrack() {
      throw new Error("MediaBunny: mock not available");
    }
  },
  UrlSource: class MockUrlSource {
    constructor(public url: string) {}
  },
  BlobSource: class MockBlobSource {
    constructor(public blob: Blob) {}
  },
  VideoSampleSink: class MockVideoSampleSink {},
  EncodedPacketSink: class MockEncodedPacketSink {},
  ALL_FORMATS: [],
}));

describe("createVideoBackend", () => {
  beforeEach(() => {
    // Mock browser globals for WebCodecs detection
    (globalThis as any).window = globalThis;
    (globalThis as any).document = { createElement: vi.fn(() => ({})), head: { appendChild: vi.fn() } };
    globalThis.VideoDecoder = { isConfigSupported: async () => ({ supported: true }) } as any;
    globalThis.EncodedVideoChunk = class { constructor() {} } as any;
    (globalThis as any).createImageBitmap = async () => ({ close() {} });
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).VideoDecoder;
    delete (globalThis as any).EncodedVideoChunk;
    delete (globalThis as any).createImageBitmap;
    vi.restoreAllMocks();
  });

  it("selects MediaBunny for .webm files", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    await expect(createVideoBackend("video.webm")).rejects.toThrow(/MediaBunny/);
  });

  it("selects MediaBunny for .mkv files", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    await expect(createVideoBackend("video.mkv")).rejects.toThrow(/MediaBunny/);
  });

  it("allows user to force mediabunny backend", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    // Forcing mediabunny on an mp4 should attempt MediaBunny, not Mp4Box
    await expect(
      createVideoBackend("video.mp4", { backend: "mediabunny" })
    ).rejects.toThrow(/MediaBunny/);
  });
});
