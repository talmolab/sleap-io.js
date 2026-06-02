/**
 * Crop-aware video deduplication tests (`src/model/matching.ts`, port of
 * Python `_crop_key` / `_same_file_different_crop` / crop-aware `is_same_file`).
 *
 * The decided scope is a NON-BREAKING addition: two DISTINCT crops of one
 * physical source file (e.g. mosaic tiles) must NOT be collapsed by the AUTO
 * cascade, while two IDENTICAL crops still match and two uncropped videos of
 * one file behave exactly as before.
 */
import { describe, it, expect, afterEach } from "../bun-test";
import { Video } from "../../src/model/video.js";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import {
  VideoMatcher,
  VideoMatchMethod,
  _cropKey,
  _sameFileDifferentCrop,
  isSameFile,
  setFsResolver,
} from "../../src/model/matching.js";

afterEach(() => setFsResolver(null));

/** A fake source backend (shared inner) with a known shape. */
function makeBackend(filename: string, width = 384, height = 384): VideoBackend {
  return {
    filename,
    shape: [1, height, width, 1],
    dataset: "video0/video",
    async getFrame(): Promise<VideoFrame | null> {
      return null;
    },
    close() {},
  };
}

/** An uncropped source Video over a single file. */
function makeSource(filename: string): Video {
  return new Video({ filename, backend: makeBackend(filename) });
}

describe("_cropKey", () => {
  it("returns the crop rect for a cropped video and null otherwise", () => {
    const src = makeSource("/data/mosaic.mp4");
    const tile = src.crop([0, 0, 192, 192]);
    expect(_cropKey(tile)).toEqual([0, 0, 192, 192]);
    expect(_cropKey(src)).toBeNull();
  });
});

describe("_sameFileDifferentCrop", () => {
  it("true for two DISTINCT crops of one file (shared root basename)", async () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([0, 0, 192, 192]);
    const tileB = src.crop([192, 0, 384, 192]);
    expect(await _sameFileDifferentCrop(tileA, tileB)).toBe(true);
  });

  it("false for two IDENTICAL crops of one file", async () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([0, 0, 192, 192]);
    const tileB = src.crop([0, 0, 192, 192]);
    expect(await _sameFileDifferentCrop(tileA, tileB)).toBe(false);
  });

  it("false for two uncropped videos (both crop keys null)", async () => {
    const a = makeSource("/data/mosaic.mp4");
    const b = makeSource("/data/mosaic.mp4");
    expect(await _sameFileDifferentCrop(a, b)).toBe(false);
  });
});

describe("isSameFile — crop-aware", () => {
  it("two distinct crops of one file are NOT the same file", async () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([0, 0, 192, 192]);
    const tileB = src.crop([192, 0, 384, 192]);
    // Same underlying root, but different crop keys -> distinct.
    expect(await isSameFile(tileA, tileB)).toBe(false);
  });

  it("two identical crops of one file ARE the same file", async () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([10, 10, 100, 100]);
    const tileB = src.crop([10, 10, 100, 100]);
    expect(await isSameFile(tileA, tileB)).toBe(true);
  });
});

describe("VideoMatcher AUTO — crop-aware dedup (non-breaking)", () => {
  it("does NOT match two distinct crops of one source file", async () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([0, 0, 192, 192]);
    const tileB = src.crop([192, 0, 384, 192]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.match(tileA, tileB)).toBe(false);

    // findMatch must reject the distinct tile as a candidate.
    const found = await matcher.findMatch(tileB, [tileA]);
    expect(found).toBeNull();
  });

  it("DOES match two identical crops of one source file", async () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([5, 5, 100, 100]);
    const tileB = src.crop([5, 5, 100, 100]);

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.match(tileA, tileB)).toBe(true);
    const found = await matcher.findMatch(tileB, [tileA]);
    expect(found).toBe(tileA);
  });

  it("still matches two uncropped videos of one file (behavior unchanged)", async () => {
    const a = makeSource("/data/mosaic.mp4");
    const b = makeSource("/data/mosaic.mp4");
    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await matcher.match(a, b)).toBe(true);
    const found = await matcher.findMatch(b, [a]);
    expect(found).toBe(a);
  });

  it("a distinct crop is rejected, but a matching tile in the candidate set is found", async () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([0, 0, 192, 192]);
    const tileADup = src.crop([0, 0, 192, 192]); // same crop as tileA
    const tileB = src.crop([192, 0, 384, 192]); // distinct crop

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    // Incoming = tileADup; candidates = [tileB (distinct, rejected), tileA (match)].
    const found = await matcher.findMatch(tileADup, [tileB, tileA]);
    expect(found).toBe(tileA);
  });

  it("the wrapped backends really are distinct CropVideoBackends", () => {
    const src = makeSource("/data/mosaic.mp4");
    const tileA = src.crop([0, 0, 192, 192]);
    const tileB = src.crop([192, 0, 384, 192]);
    expect(tileA.backend instanceof CropVideoBackend).toBe(true);
    expect(tileB.backend instanceof CropVideoBackend).toBe(true);
    expect((tileA.backend as CropVideoBackend).crop).not.toEqual(
      (tileB.backend as CropVideoBackend).crop,
    );
  });
});
