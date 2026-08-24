/**
 * Unit tests for `Video.grayscale` (getter + new setter), and its interaction
 * with `Video.crop` / `deduplicateWith` / `mergeWith` (`src/model/video.ts`).
 *
 * Port of Python `Video.grayscale` getter/setter (video.py:225-239) plus the
 * grayscale-backend composition this JS port adds via `GrayscaleVideoBackend`
 * (`src/video/grayscale-backend.ts`).
 */
import { describe, it, expect } from "../bun-test";
import { Video } from "../../src/model/video.js";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import { GrayscaleVideoBackend } from "../../src/video/grayscale-backend.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import type { RawFrame } from "../../src/transform/frame.js";

/** Fake backend with a known shape; getFrame returns a tiny color ImageData. */
function makeBackend(
  width: number,
  height: number,
  filename = "src.mp4",
): VideoBackend {
  return {
    filename,
    shape: [1, height, width, 1],
    dataset: "video0/video",
    fps: 25,
    async getFrame(i: number): Promise<VideoFrame | null> {
      if (i !== 0) return null;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let p = 0; p < width * height; p++) {
        const v = p % 200;
        data[p * 4] = v;
        data[p * 4 + 1] = v;
        data[p * 4 + 2] = (v + 77) % 256; // R !== B: genuinely color.
        data[p * 4 + 3] = 255;
      }
      return { data, width, height, colorSpace: "srgb" } as ImageData;
    },
    close() {},
  };
}

function makeVideo(width = 8, height = 6): Video {
  return new Video({
    filename: "src.mp4",
    backend: makeBackend(width, height),
  });
}

describe("Video.grayscale — getter (pre-existing behavior, unaffected)", () => {
  it("derives true/false from shape[-1] when a backend/shape is known", () => {
    const video = makeVideo();
    video.backend!.shape = [1, 6, 8, 1];
    expect(video.grayscale).toBe(true);
    video.backend!.shape = [1, 6, 8, 3];
    expect(video.grayscale).toBe(false);
  });

  it("falls back to backendMetadata.grayscale when shape is unknown", () => {
    const video = new Video({
      filename: "x.mp4",
      backend: null,
      backendMetadata: { grayscale: true },
    });
    expect(video.grayscale).toBe(true);
  });

  it("returns null when nothing is known", () => {
    const video = new Video({ filename: "x.mp4", backend: null });
    expect(video.grayscale).toBeNull();
  });
});

describe("Video.grayscale — setter", () => {
  it("throws when there is no open backend", () => {
    const video = new Video({ filename: "x.mp4", backend: null });
    expect(() => {
      video.grayscale = true;
    }).toThrow(/no open backend/);
  });

  it("wraps the backend in a GrayscaleVideoBackend and forces collapsing", async () => {
    const video = makeVideo();
    video.grayscale = true;
    expect(video.backend).toBeInstanceOf(GrayscaleVideoBackend);
    expect(video.grayscale).toBe(true);
    const frame = (await video.getFrame(0)) as RawFrame;
    expect(frame.channels).toBe(1);
  });

  it("persists into backendMetadata.grayscale (survives a closed/metadata-only read)", () => {
    const video = makeVideo();
    video.grayscale = true;
    expect(video.backendMetadata.grayscale).toBe(true);
    // Simulate a closed video (no live backend): the getter must still work.
    video.backend = null;
    expect(video.grayscale).toBe(true);
  });

  it("setting true then false then true never nests GrayscaleVideoBackend", () => {
    const video = makeVideo();
    const rawInner = video.backend!;
    video.grayscale = true;
    video.grayscale = false;
    video.grayscale = true;
    const wrapped = video.backend as GrayscaleVideoBackend;
    expect(wrapped.inner).toBe(rawInner);
    expect(wrapped.inner instanceof GrayscaleVideoBackend).toBe(false);
    expect(wrapped.grayscale).toBe(true);
  });

  it("setting false never collapses, even after a prior true", async () => {
    const video = makeVideo();
    video.grayscale = true;
    video.grayscale = false;
    expect(video.grayscale).toBe(false);
    const frame = (await video.getFrame(0)) as ImageData;
    expect(frame.data.length).toBe(8 * 6 * 4);
  });
});

describe("Video.crop composition with grayscale — canonical Grayscale(Crop(inner)) order", () => {
  it("grayscale set BEFORE crop: the cropped video stays grayscale-forced and is spatially cropped", async () => {
    const video = makeVideo(10, 10);
    video.grayscale = true;
    const cropped = video.crop([2, 2, 6, 6]);

    expect(cropped.backend).toBeInstanceOf(GrayscaleVideoBackend);
    const grayLayer = cropped.backend as GrayscaleVideoBackend;
    expect(grayLayer.inner).toBeInstanceOf(CropVideoBackend);
    expect(grayLayer.grayscale).toBe(true);

    const frame = (await cropped.getFrame(0)) as RawFrame;
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(4);
    expect(frame.channels).toBe(1);
    expect(cropped.shape).toEqual([1, 4, 4, 1]);
  });

  it("crop FIRST, then grayscale set on the cropped video: same canonical composition", async () => {
    const video = makeVideo(10, 10);
    const cropped = video.crop([2, 2, 6, 6]);
    cropped.grayscale = true;

    expect(cropped.backend).toBeInstanceOf(GrayscaleVideoBackend);
    const grayLayer = cropped.backend as GrayscaleVideoBackend;
    expect(grayLayer.inner).toBeInstanceOf(CropVideoBackend);

    const frame = (await cropped.getFrame(0)) as RawFrame;
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(4);
    expect(frame.channels).toBe(1);
  });

  it("cropRect/isCropped/cropFill still resolve correctly when the backend is grayscale-wrapped", () => {
    const video = makeVideo(10, 10);
    video.grayscale = true;
    const cropped = video.crop([1, 1, 5, 5], { fill: 42 });

    expect(cropped.isCropped).toBe(true);
    expect(cropped.cropRect).toEqual([1, 1, 5, 5]);
    expect(cropped.cropFill).toBe(42);
  });

  it("cropping twice on a grayscale-forced video flattens the crop layer (WRAP LAW) under the grayscale layer", () => {
    const video = makeVideo(20, 20);
    video.grayscale = true;
    const c1 = video.crop([2, 2, 12, 12]); // 10x10
    const c2 = c1.crop([1, 1, 9, 9]); // in-bounds of c1 -> flattens

    const grayLayer = c2.backend as GrayscaleVideoBackend;
    expect(grayLayer.inner).toBeInstanceOf(CropVideoBackend);
    const cropLayer = grayLayer.inner as CropVideoBackend;
    // Flattened: the crop's own inner is the ORIGINAL raw backend, not c1's crop.
    expect(cropLayer.inner instanceof CropVideoBackend).toBe(false);
    expect(cropLayer.crop).toEqual([3, 3, 11, 11]); // composed rect.
  });
});

describe("deduplicateWith / mergeWith carry `grayscale` forward", () => {
  function imageSeqVideo(paths: string[], grayscale: boolean | null): Video {
    return new Video({
      filename: paths,
      backend: null,
      backendMetadata: grayscale != null ? { grayscale } : {},
      openBackend: false,
    });
  }

  it("deduplicateWith carries this video's grayscale value onto the result", () => {
    const a = imageSeqVideo(["1.png", "2.png", "3.png"], true);
    const b = imageSeqVideo(["2.png"], null);
    const result = a.deduplicateWith(b);
    expect(result).not.toBeNull();
    expect(result!.grayscale).toBe(true);
  });

  it("mergeWith carries this video's grayscale value onto the result", () => {
    const a = imageSeqVideo(["1.png", "2.png"], false);
    const b = imageSeqVideo(["3.png"], null);
    const result = a.mergeWith(b);
    expect(result.grayscale).toBe(false);
  });

  it("deduplicateWith/mergeWith carry `null` (unknown) as null, not a stringified value", () => {
    const a = imageSeqVideo(["1.png", "2.png"], null);
    const b = imageSeqVideo(["3.png"], null);
    expect(a.mergeWith(b).grayscale).toBeNull();
  });
});
