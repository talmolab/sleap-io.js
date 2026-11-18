/**
 * Unit tests for how MediaBunnyVideoBackend builds its frame-time index
 * (issue #262): the packet walk must skip packet payloads, and the index must
 * be in presentation order even though packets arrive in decode order.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";

// Decode order of an IBBP-style stream: the P frame (0.12) is stored before the
// two B frames it anchors (0.04, 0.08), so presentation order != decode order.
const decodeOrderPackets = [
  { timestamp: 0.0 },
  { timestamp: 0.12 },
  { timestamp: 0.04 },
  { timestamp: 0.08 },
  { timestamp: 0.24 },
  { timestamp: 0.16 },
  { timestamp: 0.2 },
];

const packetsCalls: unknown[][] = [];

const mockGetSample = vi.fn(async (timestamp: number) => ({
  timestamp,
  toVideoFrame: () => ({ close: vi.fn() }),
}));

vi.mock("mediabunny", () => ({
  Input: class MockInput {
    async getPrimaryVideoTrack() {
      return { displayWidth: 64, displayHeight: 48 };
    }
  },
  UrlSource: class MockUrlSource {},
  BlobSource: class MockBlobSource {},
  StreamSource: class MockStreamSource {},
  VideoSampleSink: class MockVideoSampleSink {
    getSample = mockGetSample;
  },
  EncodedPacketSink: class MockEncodedPacketSink {
    async *packets(...args: unknown[]) {
      packetsCalls.push(args);
      for (const p of decodeOrderPackets) {
        yield p;
      }
    }
  },
  ALL_FORMATS: [],
}));

describe("MediaBunnyVideoBackend frame-time index", () => {
  beforeEach(() => {
    (globalThis as any).createImageBitmap = async () => ({ close: vi.fn() });
    packetsCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as any).createImageBitmap;
  });

  // Without metadataOnly, mediabunny reads every packet's bytes, i.e. the whole
  // file, just to collect timestamps (#262).
  it("walks packets with metadataOnly so payloads are not read", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.mp4");

    expect(packetsCalls).toHaveLength(1);
    const options = packetsCalls[0][2] as { metadataOnly?: boolean };
    expect(options?.metadataOnly).toBe(true);
    backend.close();
  });

  // Frame i means the i-th frame on screen (as in Python sleap-io), so the
  // decode-order packet timestamps must be sorted into presentation order.
  it("orders frame times by presentation, not decode order", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.mp4");

    expect(await backend.getFrameTimes()).toEqual([
      0.0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24,
    ]);
    expect(backend.numFrames).toBe(7);
    // fps spans first-to-last presentation time: 6 intervals over 0.24 s.
    expect(backend.fps).toBeCloseTo(25, 5);
    backend.close();
  });

  // Seeking must ask the decoder for the frame shown at index i; before the
  // fix, index 1 asked for t=0.12 (the P frame) instead of t=0.04.
  it("getFrame(i) requests the i-th presentation timestamp", async () => {
    const { MediaBunnyVideoBackend } = await import(
      "../../src/video/mediabunny-video.js"
    );
    const backend = await MediaBunnyVideoBackend.fromUrl("test.mp4");

    await backend.getFrame(1);
    await backend.getFrame(4);
    expect(mockGetSample.mock.calls.map((c) => c[0])).toEqual([0.04, 0.16]);
    backend.close();
  });
});
