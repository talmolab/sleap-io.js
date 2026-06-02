/**
 * Unit tests for `Video.crop` / `Video.fromCrop` and the crop facade
 * (`src/model/video.ts`, port of Python `Video.crop` / `_resolve_crop_rect` /
 * `_crop_tuple` / `_crop_fill` / `to_crop_coords` / `to_source_coords`).
 *
 * `resolveCropRect` golden values are the OUTPUT of the authoritative Python
 * `sleap_io.model.video._resolve_crop_rect` (sleap-io 0.8.0):
 *
 *   bbox=(1.2,2.8,5.4,6.1)                       -> (1,2,6,7)    (floor/ceil)
 *   center=(10,10), size=(4,6)                   -> (8,7,12,13)  (round; exact size)
 *   roi.bounds=(2.2,3.7,8.1,9.4), margin=2       -> (0,1,11,12)
 *   crop=(1.9,2.9,5.9,6.9)                       -> (1,2,5,6)    (int() truncation)
 *   multi-spec / zero-spec / inverted            -> ValueError
 */
import { describe, it, expect } from "../bun-test";
import { Video, resolveCropRect } from "../../src/model/video.js";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";

/** Fake backend with a known shape; getFrame returns a tiny RGBA ImageData. */
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
        const v = p % 256;
        data[p * 4] = v;
        data[p * 4 + 1] = v;
        data[p * 4 + 2] = v;
        data[p * 4 + 3] = 255;
      }
      return { data, width, height, colorSpace: "srgb" } as ImageData;
    },
    close() {},
  };
}

function makeVideo(width = 256, height = 192): Video {
  return new Video({
    filename: "src.mp4",
    backend: makeBackend(width, height),
  });
}

describe("resolveCropRect — Python parity for every spec form", () => {
  it("explicit crop rect truncates toward zero (int())", () => {
    expect(resolveCropRect([1.9, 2.9, 5.9, 6.9])).toEqual([1, 2, 5, 6]);
  });

  it("bbox floors mins and ceils maxs", () => {
    expect(resolveCropRect(null, { bbox: [1.2, 2.8, 5.4, 6.1] })).toEqual([
      1, 2, 6, 7,
    ]);
  });

  it("center+size rounds and yields exactly `size`", () => {
    const rect = resolveCropRect(null, { center: [10, 10], size: [4, 6] });
    expect(rect).toEqual([8, 7, 12, 13]);
    // Output extent is exactly size: w=12-8=4, h=13-7=6.
    expect([rect[2] - rect[0], rect[3] - rect[1]]).toEqual([4, 6]);
  });

  it("roi bounds + margin expands symmetrically", () => {
    const roi = { bounds: [2.2, 3.7, 8.1, 9.4] as [number, number, number, number] };
    expect(resolveCropRect(null, { roi, margin: 2 })).toEqual([0, 1, 11, 12]);
  });

  it("throws on multiple specs", () => {
    expect(() =>
      resolveCropRect([0, 0, 1, 1], { bbox: [0, 0, 1, 1] }),
    ).toThrow(/Exactly one/);
  });

  it("throws on zero specs", () => {
    expect(() => resolveCropRect(null, {})).toThrow(/Exactly one/);
  });

  it("throws when center/size are not provided together", () => {
    expect(() => resolveCropRect(null, { center: [10, 10] })).toThrow(
      /center and size/,
    );
    expect(() => resolveCropRect(null, { size: [4, 4] })).toThrow(
      /center and size/,
    );
  });

  it("throws on an inverted rect", () => {
    expect(() => resolveCropRect([5, 5, 1, 1])).toThrow(/Inverted/);
  });
});

describe("Video.crop — basic facade", () => {
  it("produces a cropped Video with a CropVideoBackend, correct shape + source", () => {
    const v = makeVideo(256, 192);
    const cropped = v.crop([10, 20, 110, 120], { fill: 128 });

    expect(cropped.backend instanceof CropVideoBackend).toBe(true);
    expect(cropped.sourceVideo).toBe(v);
    // Cropped shape: [F, h=100, w=100, c]
    expect(cropped.shape).toEqual([1, 100, 100, 1]);
    expect(cropped.backendMetadata.source_shape).toEqual([1, 192, 256, 1]);
    expect(cropped._cropTuple()).toEqual([10, 20, 110, 120]);
    expect(cropped._cropFill()).toBe(128);
    expect(cropped.isCropped).toBe(true);
    expect(cropped.cropRect).toEqual([10, 20, 110, 120]);
    expect(cropped.cropFill).toBe(128);
  });

  it("supports bbox / center+size / roi spec forms", () => {
    const v = makeVideo(256, 192);
    expect(v.crop(null, { bbox: [1.2, 2.8, 5.4, 6.1] })._cropTuple()).toEqual([
      1, 2, 6, 7,
    ]);
    expect(
      v.crop(null, { center: [50, 40], size: [10, 20] })._cropTuple(),
    ).toEqual([45, 30, 55, 50]);
    const roi = { bounds: [2.2, 3.7, 8.1, 9.4] as [number, number, number, number] };
    expect(v.crop(null, { roi, margin: 2 })._cropTuple()).toEqual([
      0, 1, 11, 12,
    ]);
  });

  it("uncropped video reports null crop tuple and fill 0", () => {
    const v = makeVideo();
    expect(v._cropTuple()).toBeNull();
    expect(v._cropFill()).toBe(0);
    expect(v.isCropped).toBe(false);
    expect(v.cropRect).toBeNull();
  });

  it("throws when cropping a video with no backend", () => {
    const v = new Video({ filename: "x.mp4", backend: null });
    expect(() => v.crop([0, 0, 10, 10])).toThrow(/no open backend/);
  });

  it("Video.fromCrop delegates to video.crop", () => {
    const v = makeVideo();
    const cropped = Video.fromCrop(v, [0, 0, 50, 60], { fill: 5 });
    expect(cropped._cropTuple()).toEqual([0, 0, 50, 60]);
    expect(cropped._cropFill()).toBe(5);
  });

  it("Video.fromCrop throws on a path string (no FS auto-open in JS)", () => {
    expect(() => Video.fromCrop("some/path.mp4", [0, 0, 10, 10])).toThrow(
      /path string/,
    );
  });

  it("shareDecode controls ownsInner on the wrapped backend", () => {
    const v = makeVideo();
    const shared = v.crop([0, 0, 10, 10]); // default shareDecode=true
    expect((shared.backend as CropVideoBackend).ownsInner).toBe(false);
    const owned = v.crop([0, 0, 10, 10], { shareDecode: false });
    expect((owned.backend as CropVideoBackend).ownsInner).toBe(true);
  });
});

describe("Video._cropTuple / _cropFill — open AND forced-closed", () => {
  it("reads the crop from backend.crop when open, and metadata when closed", () => {
    const v = makeVideo(256, 192);
    const cropped = v.crop([10, 20, 110, 120], { fill: 99 });

    // Open path: reads from the live CropVideoBackend.
    expect(cropped._cropTuple()).toEqual([10, 20, 110, 120]);
    expect(cropped._cropFill()).toBe(99);

    // Force-closed: drop the backend, rely on backendMetadata.crop / crop_fill.
    cropped.backend = null;
    expect(cropped._cropTuple()).toEqual([10, 20, 110, 120]);
    expect(cropped._cropFill()).toBe(99);
    // Shape getter falls back to backendMetadata.shape (the cropped shape).
    expect(cropped.shape).toEqual([1, 100, 100, 1]);
  });
});

describe("Video.toCropCoords / toSourceCoords", () => {
  it("toSourceCoords(toCropCoords(p)) === p for a cropped video", () => {
    const v = makeVideo();
    const cropped = v.crop([10, 20, 110, 120]);
    const pts: [number, number][] = [
      [30, 50],
      [NaN, 5],
      [10, 20],
    ];
    const inCrop = cropped.toCropCoords(pts);
    expect(inCrop[0]).toEqual([20, 30]);
    expect(inCrop[2]).toEqual([0, 0]);
    expect(inCrop[1][0]).toBeNaN();

    const restored = cropped.toSourceCoords(inCrop);
    expect(restored[0]).toEqual([30, 50]);
    expect(restored[2]).toEqual([10, 20]);
    expect(restored[1][0]).toBeNaN();
  });

  it("uncropped video returns a copy unchanged (input unmutated)", () => {
    const v = makeVideo();
    const pts: [number, number][] = [
      [1, 2],
      [3, 4],
    ];
    const out = v.toCropCoords(pts);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts); // copy
    const out2 = v.toSourceCoords(pts);
    expect(out2).toEqual(pts);
  });
});

describe("Video.crop — getFrame returns the cropped pixels", () => {
  it("getFrame yields a crop-sized frame matching the inner subregion", async () => {
    const v = makeVideo(20, 20);
    const cropped = v.crop([3, 4, 13, 12], { fill: 0 }); // 10 x 8
    const frame = (await cropped.getFrame(0)) as ImageData;
    expect(frame.width).toBe(10);
    expect(frame.height).toBe(8);
  });
});
