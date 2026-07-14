import { describe, it, expect } from "./bun-test";
import { loadSlp } from "../src/io/main.js";
import {
  PNG_MAGIC,
  JPEG_MAGIC,
  matchesMagicAt,
} from "../src/video/embedded-frame.js";
import { Hdf5VideoBackend } from "../src/video/hdf5-video.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
const pkg = (name: string) => path.join(fixtureRoot, "slp", name);

function isEncodedBlob(b: Uint8Array): boolean {
  return matchesMagicAt(b, 0, PNG_MAGIC) || matchesMagicAt(b, 0, JPEG_MAGIC);
}

describe("getFrameBuffer (raw encoded blob accessor)", () => {
  it("returns the raw encoded bytes, not a decoded image", async () => {
    const labels = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const video = labels.videos[0];
    expect(video.hasEmbeddedImages).toBe(true);
    const fns = video.embeddedFrameIndices!;
    expect(fns.length).toBeGreaterThan(0);
    for (const fn of fns) {
      const blob = await video.getFrameBuffer(fn);
      expect(blob).not.toBeNull();
      expect(blob).toBeInstanceOf(Uint8Array);
      expect(isEncodedBlob(blob!)).toBe(true); // PNG/JPEG magic, i.e. NOT ImageData
    }
    video.close();
  });

  it("reports the source image format and channel order", async () => {
    const labels = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const b = labels.videos[0].backend!;
    expect(typeof b.embeddedFormat).toBe("string");
    expect(["png", "jpg", "jpeg"]).toContain(b.embeddedFormat!.toLowerCase());
    expect(["RGB", "BGR"]).toContain(b.embeddedChannelOrder);
    labels.videos[0].close();
  });

  it("reads vlen-layout blobs", async () => {
    // vlen_multiframe.pkg.slp is a bare synthetic vlen-of-int8 fixture (N>1)
    // written by gen_vlen_multiframe_fixture.py with NO `metadata` JSON group,
    // so it cannot be loaded via loadSlp (h5wasm can't WRITE vlen-of-int8, so
    // the layout can only come from an h5py-authored file). Construct the
    // backend directly against the raw file — the same pattern the existing
    // vlen test in tests/video/embedded-frame.test.ts uses — and exercise
    // getFrameBuffer on the vlen path.
    const bytes = fs.readFileSync(pkg("vlen_multiframe.pkg.slp"));
    const { file, close } = await openH5File(new Uint8Array(bytes));
    const frameNumbers = Array.from(
      file.get("video0/frame_numbers").value as ArrayLike<number>,
    ).map((v) => Number(v));
    const backend = new Hdf5VideoBackend({
      filename: ".",
      file,
      datasetPath: "video0/video",
      frameNumbers,
      format: "png",
      channelOrder: "RGB",
    });
    for (const fn of frameNumbers) {
      const blob = await backend.getFrameBuffer(fn);
      expect(blob).not.toBeNull();
      expect(isEncodedBlob(blob!)).toBe(true);
    }
    backend.close();
    close();
  });

  it("delegates through a crop backend to the inner embedded frames", async () => {
    const labels = await loadSlp(pkg("cropped_format_2_3.pkg.slp"), {
      openVideos: true,
    });
    const video = labels.videos[0];
    expect(video.hasEmbeddedImages).toBe(true);
    const fns = video.embeddedFrameIndices!;
    const blob = await video.getFrameBuffer(fns[0]);
    expect(blob).not.toBeNull();
    expect(isEncodedBlob(blob!)).toBe(true);
    video.close();
  });
});
