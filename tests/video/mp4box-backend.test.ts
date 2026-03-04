/* @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type GlobalSnapshot = {
  window?: typeof globalThis.window;
  document?: typeof globalThis.document;
  fetch?: typeof globalThis.fetch;
  MP4Box?: any;
  DataStream?: any;
  VideoDecoder?: typeof globalThis.VideoDecoder;
  EncodedVideoChunk?: typeof globalThis.EncodedVideoChunk;
};

const sampleInfo = [
  { offset: 0, size: 1, cts: 0, duration: 1000, is_sync: true },
  { offset: 1, size: 1, cts: 2000, duration: 1000, is_sync: false },
  { offset: 2, size: 1, cts: 1000, duration: 1000, is_sync: false },
];

function createMp4BoxMock() {
  return {
    createFile() {
      const file: any = {
        _ready: false,
        onReady: null,
        onError: null,
        appendBuffer(buffer: ArrayBuffer) {
          if (!file._ready) {
            file._ready = true;
            file.onReady?.({
              videoTracks: [
                {
                  id: 1,
                  codec: "avc1.42E01E",
                  video: { width: 1024, height: 1024 },
                  duration: 3000,
                  timescale: 1000,
                },
              ],
            });
          }
          const start = (buffer as any).fileStart ?? 0;
          return start + buffer.byteLength;
        },
        getTrackSamplesInfo() {
          return sampleInfo;
        },
        getTrackById() {
          return {
            mdia: {
              minf: {
                stbl: {
                  stsd: {
                    entries: [],
                  },
                },
              },
            },
          };
        },
      };
      return file;
    },
  };
}

function createFetchMock(supportsRange = true) {
  return vi.fn(async (_url: string, options?: { method?: string; headers?: Record<string, string> }) => {
    if (options?.headers?.Range) {
      if (supportsRange) {
        return {
          ok: true,
          status: 206,
          headers: {
            get(name: string) {
              return name.toLowerCase() === "content-range" ? "bytes 0-0/1024" : null;
            },
          },
          arrayBuffer: async () => new ArrayBuffer(1),
        } as any;
      }
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        blob: async () => new Blob([new Uint8Array(16)]),
      } as any;
    }
    return {
      ok: true,
      blob: async () => new Blob([new Uint8Array(16)]),
    } as any;
  });
}

describe("Mp4BoxVideoBackend", () => {
  const globals: GlobalSnapshot = {};

  beforeEach(() => {
    globals.window = globalThis.window;
    globals.document = globalThis.document;
    globals.fetch = globalThis.fetch;
    globals.MP4Box = (globalThis as any).MP4Box;
    globals.DataStream = (globalThis as any).DataStream;
    globals.VideoDecoder = globalThis.VideoDecoder;
    globals.EncodedVideoChunk = globalThis.EncodedVideoChunk;

    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      createElement: vi.fn(() => ({ })),
      head: { appendChild: vi.fn() },
    };

    class FakeVideoDecoder {
      static async isConfigSupported() {
        return { supported: true };
      }

      constructor(_options: any) {}
      configure() {}
      decode() {}
      flush() {
        return Promise.resolve();
      }
      close() {}
    }

    class FakeEncodedVideoChunk {
      constructor(_init: any) {}
    }

    globalThis.VideoDecoder = FakeVideoDecoder as any;
    globalThis.EncodedVideoChunk = FakeEncodedVideoChunk as any;

    (globalThis as any).MP4Box = createMp4BoxMock();
    (globalThis as any).DataStream = undefined;
    globalThis.fetch = createFetchMock() as any;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.window = globals.window as any;
    globalThis.document = globals.document as any;
    globalThis.fetch = globals.fetch as any;
    (globalThis as any).MP4Box = globals.MP4Box;
    (globalThis as any).DataStream = globals.DataStream;
    globalThis.VideoDecoder = globals.VideoDecoder as any;
    globalThis.EncodedVideoChunk = globals.EncodedVideoChunk as any;
    vi.restoreAllMocks();
  });

  it("returns frame times sorted by CTS", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    const times = await backend.getFrameTimes();
    expect(times).toEqual([0, 1, 2]);
    expect(backend.shape?.[0]).toBe(3);
    backend.close();
  });

  it("selects mp4box backend for mp4 files", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const { createVideoBackend } = await import("../../src/video/factory.js");
    const backend = await createVideoBackend("https://example.com/video.mp4");
    expect(backend).toBeInstanceOf(Mp4BoxVideoBackend);
    if (backend instanceof Mp4BoxVideoBackend) {
      await backend.getFrameTimes();
      backend.close();
    }
  });

  it("accepts a Blob source without calling fetch", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const blob = new Blob([new Uint8Array(16)]);
    const backend = new Mp4BoxVideoBackend(blob);
    const times = await backend.getFrameTimes();
    expect(times).toEqual([0, 1, 2]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    backend.close();
  });

  it("accepts a File source without calling fetch", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const file = new File([new Uint8Array(16)], "test.mp4", { type: "video/mp4" });
    const backend = new Mp4BoxVideoBackend(file);
    const times = await backend.getFrameTimes();
    expect(times).toEqual([0, 1, 2]);
    expect(backend.filename).toBe("test.mp4");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    backend.close();
  });

  it("falls back to blob when range requests are not supported", async () => {
    globalThis.fetch = createFetchMock(false) as any;
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    const times = await backend.getFrameTimes();
    expect(times).toEqual([0, 1, 2]);
    backend.close();
  });

  it("does not send HEAD requests", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    await backend.getFrameTimes();
    const calls = (globalThis.fetch as any).mock.calls;
    const headCalls = calls.filter((c: any) => c[1]?.method === "HEAD");
    expect(headCalls).toHaveLength(0);
    backend.close();
  });

  it("cache hit returns immediately without decoding", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    await backend.getFrameTimes();

    const mockBitmap = { close: vi.fn() } as any;
    (backend as any).cache.set(1, mockBitmap);

    const result = await backend.getFrame(1);
    expect(result).toBe(mockBitmap);
    backend.close();
  });

  it("concurrent getFrame calls resolve last request correctly", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    await backend.getFrameTimes();

    const mockBitmap = { close: vi.fn() } as any;
    (backend as any).cache.set(2, mockBitmap);

    const results = await Promise.all([
      backend.getFrame(0),
      backend.getFrame(1),
      backend.getFrame(2),
    ]);

    expect(results[2]).toBe(mockBitmap);
    backend.close();
  });

  it("rapid sequential calls only decode the latest frame", async () => {
    let decodeRangeCallCount = 0;
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    await backend.getFrameTimes();

    const originalDecodeRange = (backend as any).decodeRange.bind(backend);
    (backend as any).decodeRange = async (...args: any[]) => {
      decodeRangeCallCount++;
      return originalDecodeRange(...args);
    };

    const p1 = backend.getFrame(0);
    const p2 = backend.getFrame(1);
    const p3 = backend.getFrame(2);

    await Promise.all([p1, p2, p3]);

    expect(decodeRangeCallCount).toBe(1);
    backend.close();
  });

  it("AbortSignal cancels decode before it starts", async () => {
    let decodeRangeCallCount = 0;
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    await backend.getFrameTimes();

    const originalDecodeRange = (backend as any).decodeRange.bind(backend);
    (backend as any).decodeRange = async (...args: any[]) => {
      decodeRangeCallCount++;
      return originalDecodeRange(...args);
    };

    const controller = new AbortController();
    controller.abort();

    const result = await backend.getFrame(0, controller.signal);
    expect(result).toBeNull();
    expect(decodeRangeCallCount).toBe(0);
    backend.close();
  });

  it("returns null for out-of-range frame indices", async () => {
    const { Mp4BoxVideoBackend } = await import("../../src/video/mp4box-video.js");
    const backend = new Mp4BoxVideoBackend("https://example.com/video.mp4");
    await backend.getFrameTimes();

    expect(await backend.getFrame(-1)).toBeNull();
    expect(await backend.getFrame(100)).toBeNull();
    backend.close();
  });
});
