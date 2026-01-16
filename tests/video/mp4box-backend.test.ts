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

function createFetchMock() {
  return vi.fn(async (_url: string, options?: { method?: string; headers?: Record<string, string> }) => {
    if (options?.method === "HEAD") {
      return {
        ok: true,
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-length" ? "1024" : null;
          },
        },
      } as any;
    }
    if (options?.headers?.Range) {
      return {
        status: 206,
        arrayBuffer: async () => new ArrayBuffer(16),
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
});
