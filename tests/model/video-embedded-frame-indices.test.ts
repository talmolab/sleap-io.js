/**
 * Tests for `Video.embeddedFrameIndices` — the public accessor that surfaces
 * the source frame numbers with a stored image for embedded-image (`pkg.slp`)
 * videos. Consumed by sleap-app's "navigate imaged frames only" mode
 * (sleap-app issue #137): for a continuous video every frame is decodable, so
 * the getter returns `null` ("no restriction"); for a `pkg.slp` it returns the
 * sparse embedded set so navigation can be confined to frames you can see.
 */
import { describe, it, expect } from "../bun-test";
import { Video } from "../../src/model/video.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import { readSlp } from "../../src/codecs/slp/read.js";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));

/** Minimal backend stub holding only the fields the getter reads. */
function backendWith(frameNumbers?: number[]): VideoBackend {
  return {
    filename: "stub",
    frameNumbers,
    getFrame: async (): Promise<VideoFrame | null> => null,
    close: () => {},
  } as VideoBackend;
}

describe("Video.embeddedFrameIndices", () => {
  it("returns sorted, de-duplicated frame numbers from an embedded backend", () => {
    const video = new Video({
      filename: "x",
      backend: backendWith([20, 10, 10, 30]),
    });
    expect(video.embeddedFrameIndices).toEqual([10, 20, 30]);
  });

  it("returns null for a continuous-video backend with no frame numbers", () => {
    const video = new Video({ filename: "x", backend: backendWith(undefined) });
    expect(video.embeddedFrameIndices).toBeNull();
  });

  it("returns null for an embedded backend with an empty set", () => {
    const video = new Video({ filename: "x", backend: backendWith([]) });
    expect(video.embeddedFrameIndices).toBeNull();
  });

  it("returns null when there is no backend", () => {
    const video = new Video({ filename: "x", backend: null });
    expect(video.embeddedFrameIndices).toBeNull();
  });

  it("surfaces the embedded set of a real pkg.slp loaded with openVideos", async () => {
    const labels = await readSlp(
      path.join(fixtureRoot, "slp", "minimal_instance.pkg.slp"),
      { openVideos: true },
    );
    const video = labels.videos[0];
    expect(video.hasEmbeddedImages).toBe(true);

    const indices = video.embeddedFrameIndices;
    expect(indices).not.toBeNull();
    expect(indices!.length).toBeGreaterThan(0);
    // Sorted ascending and de-duplicated.
    expect(indices).toEqual([...new Set(indices!)].sort((a, b) => a - b));
    // Every reported index must actually decode to a frame.
    expect(await video.getFrame(indices![0])).not.toBeNull();
  });

  it("surfaces the embedded set through a CropVideoBackend (cropped pkg.slp)", async () => {
    const labels = await readSlp(
      path.join(fixtureRoot, "slp", "cropped_format_2_3.pkg.slp"),
      { openVideos: true },
    );
    const video = labels.videos[0];
    // A cropped pkg.slp wraps the embedded backend in a CropVideoBackend; the
    // accessor must see through the wrapper or imaged-frame navigation no-ops.
    expect(video.backend instanceof CropVideoBackend).toBe(true);

    const indices = video.embeddedFrameIndices;
    expect(indices).not.toBeNull();
    expect(indices!.length).toBeGreaterThan(0);
    expect(indices).toEqual([...new Set(indices!)].sort((a, b) => a - b));
    expect(await video.getFrame(indices![0])).not.toBeNull();
  });
});
