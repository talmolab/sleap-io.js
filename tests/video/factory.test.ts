import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";

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
    (globalThis as any).document = {
      createElement: vi.fn(() => ({})),
      head: { appendChild: vi.fn() },
    };
    globalThis.VideoDecoder = {
      isConfigSupported: async () => ({ supported: true }),
    } as any;
    globalThis.EncodedVideoChunk = class {
      constructor() {}
    } as any;
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
    await expect(createVideoBackend("video.webm")).rejects.toThrow(
      /MediaBunny/,
    );
  });

  it("selects MediaBunny for .mkv files", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    await expect(createVideoBackend("video.mkv")).rejects.toThrow(/MediaBunny/);
  });

  it("allows user to force mediabunny backend", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    // Forcing mediabunny on an mp4 should attempt MediaBunny, not Mp4Box
    await expect(
      createVideoBackend("video.mp4", { backend: "mediabunny" }),
    ).rejects.toThrow(/MediaBunny/);
  });

  it("selects MediaBunny for Blob with .webm filename", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    const blob = new Blob(["fake"], { type: "video/webm" });
    const file = new File([blob], "clip.webm");
    await expect(createVideoBackend(file)).rejects.toThrow(/MediaBunny/);
  });

  it("routes Blob to MediaBunny when backend='mediabunny'", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    const file = new File([new Blob(["fake"])], "clip.mp4");
    await expect(
      createVideoBackend(file, { backend: "mediabunny" }),
    ).rejects.toThrow(/MediaBunny/);
  });

  it("selects MediaBunny for .ts (MPEG-TS) files", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    // .ts replaced .mpeg in the MediaBunny list: it is the real MPEG-TS case,
    // which MediaBunny can demux (typical H.264/H.265 payload).
    await expect(createVideoBackend("stream.ts")).rejects.toThrow(/MediaBunny/);
  });

  // .avi and MPEG program streams (.mpeg/.mpg) have no web decode path: reject
  // them with a clean, catchable error instead of silently routing to MediaBunny
  // (which has no AVI/MPEG-PS demuxer and would fail opaquely mid-decode).
  for (const ext of ["avi", "mpeg", "mpg"]) {
    it(`rejects .${ext} with a catchable UnsupportedVideoFormatError`, async () => {
      const { createVideoBackend, UnsupportedVideoFormatError } = await import(
        "../../src/video/factory.js"
      );
      let caught: unknown;
      try {
        await createVideoBackend(`clip.${ext}`);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(UnsupportedVideoFormatError);
      expect(
        (caught as InstanceType<typeof UnsupportedVideoFormatError>).extension,
      ).toBe(ext);
      // Traceable, not an opaque MediaBunny mid-decode failure; points at MP4.
      expect((caught as Error).message).not.toMatch(/MediaBunny/);
      expect((caught as Error).message).toMatch(/MP4/);
    });
  }

  it("rejects a Blob/File with an .avi filename", async () => {
    const { createVideoBackend, UnsupportedVideoFormatError } = await import(
      "../../src/video/factory.js"
    );
    const file = new File([new Blob(["fake"])], "clip.avi");
    await expect(createVideoBackend(file)).rejects.toThrow(
      UnsupportedVideoFormatError,
    );
  });

  it("honors an explicit backend override for unsupported extensions (escape hatch)", async () => {
    const { createVideoBackend } = await import("../../src/video/factory.js");
    // Forcing a backend bypasses the unsupported-format guard, so this attempts
    // MediaBunny (mock throws /MediaBunny/) rather than UnsupportedVideoFormatError.
    await expect(
      createVideoBackend("clip.avi", { backend: "mediabunny" }),
    ).rejects.toThrow(/MediaBunny/);
  });
});
