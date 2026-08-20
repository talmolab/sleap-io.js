import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";

// ── Mutable mock state (reset per test) ───────────────────────────────────────
let mockStream: Record<string, unknown>;
let mockDecoderConfig: Record<string, unknown>;
let mockChunks: Array<{ timestamp: number }>;
let mockPacketData: Uint8Array;
let supported: boolean;

function resetMocks() {
  mockStream = {
    width: 384,
    height: 384,
    nb_frames: "10",
    avg_frame_rate: "25/1",
    r_frame_rate: "25/1",
    duration: 0.4,
    codec_name: "h264",
  };
  mockDecoderConfig = {
    codec: "avc1.640015",
    codedWidth: 384,
    codedHeight: 384,
    description: undefined,
  };
  // 10 frames at 25fps → 40000µs apart (WebCodecs timestamps are microseconds).
  mockChunks = Array.from({ length: 10 }, (_, i) => ({ timestamp: i * 40000 }));
  mockPacketData = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG SOI/EOI
  supported = true;
}
resetMocks();

vi.mock("web-demuxer", () => ({
  WebDemuxer: class MockWebDemuxer {
    async load() {}
    async getAVStream() {
      return mockStream;
    }
    async getDecoderConfig() {
      return mockDecoderConfig;
    }
    read() {
      return new ReadableStream({
        start(controller) {
          for (const ch of mockChunks) controller.enqueue(ch);
          controller.close();
        },
      });
    }
    async getAVPacket() {
      return { data: mockPacketData, timestamp: 0, keyframe: 1, duration: 0 };
    }
    destroy() {}
  },
  AVSeekFlag: {
    AVSEEK_FLAG_BACKWARD: 1,
    AVSEEK_FLAG_BYTE: 2,
    AVSEEK_FLAG_ANY: 4,
    AVSEEK_FLAG_FRAME: 8,
  },
}));

// A VideoDecoder that echoes each decoded chunk to `output` as a fake frame.
class FakeVideoDecoder {
  static async isConfigSupported() {
    return { supported };
  }
  private output: (f: unknown) => void;
  constructor(init: {
    output: (f: unknown) => void;
    error: (e: Error) => void;
  }) {
    this.output = init.output;
  }
  configure() {}
  decode(chunk: { timestamp: number }) {
    this.output({
      timestamp: chunk.timestamp,
      displayWidth: 384,
      displayHeight: 384,
      close() {},
    });
  }
  async flush() {}
  close() {}
}

async function loadBackend() {
  const mod = await import("../../src/video/avi-video.js");
  mod.configureWebDemuxer({ wasmFilePath: "http://test/web-demuxer.wasm" });
  return mod;
}

describe("AviVideoBackend", () => {
  beforeEach(() => {
    resetMocks();
    (globalThis as any).window = globalThis;
    (globalThis as any).document = {};
    globalThis.VideoDecoder = FakeVideoDecoder as any;
    globalThis.EncodedVideoChunk = class {} as any;
    (globalThis as any).createImageBitmap = async () => ({
      width: 384,
      height: 384,
      close() {},
    });
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).VideoDecoder;
    delete (globalThis as any).EncodedVideoChunk;
    delete (globalThis as any).createImageBitmap;
  });

  // MUST run first: `configureWebDemuxer` sets module-level state and bun's
  // `vi.resetModules()` is a no-op, so once any later test configures it the
  // config persists. This asserts the unconfigured guard before that happens.
  it("throws if configureWebDemuxer() was not called", async () => {
    const { AviVideoBackend } = await import("../../src/video/avi-video.js");
    await expect(
      AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi"),
    ).rejects.toThrow(/configureWebDemuxer/);
  });

  it("classifies H.264 as the WebCodecs path with correct shape/fps", async () => {
    const { AviVideoBackend } = await loadBackend();
    const backend = await AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi");
    expect(backend.shape).toEqual([10, 384, 384, 3]);
    expect(backend.fps).toBeCloseTo(25, 0);
    backend.close();
  });

  it("decodes a WebCodecs frame frame-accurately (maps timestamp→index)", async () => {
    const { AviVideoBackend } = await loadBackend();
    const backend = await AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi");
    const frame = await backend.getFrame(3);
    expect(frame).not.toBeNull();
    expect((frame as ImageBitmap).width).toBe(384);
    backend.close();
  });

  it("uses the MJPEG (ImageDecoder) path for mjpeg streams", async () => {
    mockStream.codec_name = "mjpeg";
    const { AviVideoBackend } = await loadBackend();
    const backend = await AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi");
    const frame = await backend.getFrame(5);
    expect(frame).not.toBeNull();
    expect((frame as ImageBitmap).width).toBe(384);
    backend.close();
  });

  it("rejects an undecodable codec with a transcode message", async () => {
    mockStream.codec_name = "mpeg4"; // Xvid/DivX
    supported = false;
    const { AviVideoBackend } = await loadBackend();
    await expect(
      AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi"),
    ).rejects.toThrow(/transcode/i);
  });

  it("returns null for out-of-range indices", async () => {
    const { AviVideoBackend } = await loadBackend();
    const backend = await AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi");
    expect(await backend.getFrame(-1)).toBeNull();
    expect(await backend.getFrame(10)).toBeNull();
    backend.close();
  });

  it("requires a browser environment with WebCodecs", async () => {
    delete (globalThis as any).VideoDecoder;
    const { AviVideoBackend } = await loadBackend();
    await expect(
      AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi"),
    ).rejects.toThrow(/WebCodecs/);
  });

  it("close() clears frame count and cache", async () => {
    const { AviVideoBackend } = await loadBackend();
    const backend = await AviVideoBackend.fromBlob(new Blob(["x"]), "clip.avi");
    await backend.getFrame(0);
    backend.close();
    expect(await backend.getFrame(0)).toBeNull(); // frameCount reset → out of range
  });
});
