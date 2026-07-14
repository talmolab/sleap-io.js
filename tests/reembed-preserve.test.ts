import { describe, it, expect } from "./bun-test";
import { loadSlp } from "../src/io/main.js";
import { readSlp } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import {
  Labels,
  LabeledFrame,
  Video,
  Skeleton,
  Instance,
} from "../src/index.js";
import type { VideoBackend } from "../src/index.js";
import {
  PNG_MAGIC,
  JPEG_MAGIC,
  matchesMagicAt,
} from "../src/video/embedded-frame.js";
import { Hdf5VideoBackend } from "../src/video/hdf5-video.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
const pkg = (name: string) => path.join(fixtureRoot, "slp", name);

function isEncodedBlob(b: Uint8Array): boolean {
  return matchesMagicAt(b, 0, PNG_MAGIC) || matchesMagicAt(b, 0, JPEG_MAGIC);
}

async function blobsOf(video: any, fns: number[]): Promise<Uint8Array[]> {
  return Promise.all(fns.map((fn) => video.getFrameBuffer(fn)));
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Reload saved SLP bytes via a temp DISK file. Reading embedded frame BYTES
 * back requires this: the in-memory `loadSlp(bytes)` node path stages to a temp
 * file whose handle is unlinked after load (openBytesNode in h5-node.ts), so a
 * retained embedded backend can't read frames from it. `embed.test.ts` uses the
 * same temp-file pattern for the same reason.
 */
async function reloadFromDisk(bytes: Uint8Array) {
  const p = path.join(
    os.tmpdir(),
    `reembed_${process.pid}_${Math.random().toString(16).slice(2)}.slp`,
  );
  fs.writeFileSync(p, bytes);
  const labels = await readSlp(p, { openVideos: true });
  return { labels, cleanup: () => fs.unlinkSync(p) };
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

describe("re-embed preserves embedded images (raw copy)", () => {
  it("bare saveSlpToBytes(labels) preserves the full set byte-for-byte", async () => {
    const src = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const fns = src.videos[0].embeddedFrameIndices!;
    const srcBlobs = await blobsOf(src.videos[0], fns);

    // No embed option — the old silent-loss default. Must now PRESERVE.
    const bytes = await saveSlpToBytes(src);

    const { labels: out, cleanup } = await reloadFromDisk(bytes);
    expect(out.videos[0].hasEmbeddedImages).toBe(true);
    expect(out.videos[0].embeddedFrameIndices).toEqual(fns);
    const outBlobs = await blobsOf(out.videos[0], fns);
    for (let i = 0; i < fns.length; i++) {
      expect(bytesEqual(outBlobs[i]!, srcBlobs[i]!)).toBe(true);
    }
    src.videos[0].close();
    out.videos[0].close();
    cleanup();
  });

  it('embed:"user+suggestions" still preserves the FULL stored set', async () => {
    const src = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const fns = src.videos[0].embeddedFrameIndices!;
    const bytes = await saveSlpToBytes(src, { embed: "user+suggestions" });
    const out = await loadSlp(bytes, { openVideos: true });
    expect(out.videos[0].embeddedFrameIndices).toEqual(fns);
    src.videos[0].close();
    out.videos[0].close();
  });

  it("cropped fixture round-trips byte-for-byte", async () => {
    // vlen's raw-READ path is covered by the earlier Task-1 test ("reads
    // vlen-layout blobs"); it can't round-trip through loadSlp (bare synthetic
    // fixture with no metadata JSON group), so only cropped is exercised here.
    const src = await loadSlp(pkg("cropped_format_2_3.pkg.slp"), {
      openVideos: true,
    });
    const fns = src.videos[0].embeddedFrameIndices!;
    const srcBlobs = await blobsOf(src.videos[0], fns);
    const bytes = await saveSlpToBytes(src);
    const { labels: out, cleanup } = await reloadFromDisk(bytes);
    expect(out.videos[0].embeddedFrameIndices).toEqual(fns);
    const outBlobs = await blobsOf(out.videos[0], fns);
    for (let i = 0; i < fns.length; i++) {
      expect(bytesEqual(outBlobs[i]!, srcBlobs[i]!)).toBe(true);
    }
    src.videos[0].close();
    out.videos[0].close();
    cleanup();
  });

  it('embed:"source" externalizes (drops embedded images)', async () => {
    const src = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const bytes = await saveSlpToBytes(src, { embed: "source" });
    const out = await loadSlp(bytes, { openVideos: false });
    expect(out.videos[0].hasEmbeddedImages).toBe(false);
    src.videos[0].close();
  });

  it("does NOT rely on getFrame (browser simulation): copies even when getFrame returns ImageData", async () => {
    const PNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    const frameNumbers = [0, 1, 2];
    const backend = {
      frameNumbers,
      shape: [3, 2, 2, 1] as [number, number, number, number],
      dataset: "video0/video",
      embeddedFormat: "png",
      embeddedChannelOrder: "RGB",
      async getFrame() {
        return { width: 2, height: 2, data: new Uint8ClampedArray(16) } as any;
      },
      async getFrameBuffer(fn: number) {
        return frameNumbers.includes(fn) ? PNG.slice() : null;
      },
      close() {},
    };
    const video = new Video({
      filename: "sim.pkg.slp",
      backend: backend as unknown as VideoBackend,
      embedded: true,
    });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const labels = new Labels({
      labeledFrames: frameNumbers.map(
        (fn) =>
          new LabeledFrame({
            video,
            frameIdx: fn,
            instances: [new Instance({ points: { A: [1, 1] }, skeleton })],
          }),
      ),
      videos: [video],
      skeletons: [skeleton],
    });
    const bytes = await saveSlpToBytes(labels); // preserve default
    // Reload from DISK (not loadSlp(bytes)) so the embedded blob BYTES can be
    // read back, then byte-compare frame 0 to the fake PNG the sim served.
    const { labels: out, cleanup } = await reloadFromDisk(bytes);
    expect(out.videos[0].embeddedFrameIndices).toEqual(frameNumbers);
    const outBlob = await out.videos[0].getFrameBuffer(0);
    expect(outBlob).not.toBeNull();
    expect(bytesEqual(outBlob!, PNG)).toBe(true);
    out.videos[0].close();
    cleanup();
  });

  it("streams into a resizable 1-D uint8 dataset (h5wasm capability)", async () => {
    const { getH5Module, getH5FileSystem, ensureH5StagingDir } = await import(
      "../src/codecs/slp/h5.js"
    );
    const m = await getH5Module();
    ensureH5StagingDir(m);
    const p = `/tmp/cap_${Date.now()}.h5`;
    const f = new (m as any).File(p, "w");
    f.create_dataset({
      name: "v",
      data: new Uint8Array(0),
      shape: [0],
      maxshape: [null],
      chunks: [8],
      dtype: "<B",
    });
    const ds = f.get("v");
    ds.resize([3]);
    ds.write_slice([[0, 3]], new Uint8Array([1, 2, 3]));
    ds.resize([5]);
    ds.write_slice([[3, 5]], new Uint8Array([4, 5]));
    f.close();
    const f2 = new (m as any).File(p, "r");
    const val = Array.from(f2.get("v").value as Uint8Array);
    f2.close();
    getH5FileSystem(m).unlink!(p);
    expect(val).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws (never silently writes 0) when a planned blob can't be read", async () => {
    const frameNumbers = [0, 1];
    const backend = {
      frameNumbers,
      shape: [2, 2, 2, 1] as [number, number, number, number],
      dataset: "video0/video",
      embeddedFormat: "png",
      embeddedChannelOrder: "RGB",
      async getFrame() {
        return null;
      },
      async getFrameBuffer() {
        return null; // simulate a closed/unreadable backend
      },
      close() {},
    };
    const video = new Video({
      filename: "broken.pkg.slp",
      backend: backend as unknown as VideoBackend,
      embedded: true,
    });
    const labels = new Labels({
      labeledFrames: [new LabeledFrame({ video, frameIdx: 0 })],
      videos: [video],
    });
    await expect(saveSlpToBytes(labels)).rejects.toThrow();
  });
});
