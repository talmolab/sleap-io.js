/**
 * SLP virtual-crop read/write round-trip tests (SLP format 2.3).
 *
 * Covers (per the project test plan):
 *  - PYTHON -> JS: load the committed Python-written fixture
 *    `cropped_format_2_3.pkg.slp` (open AND openVideos=false) and assert the
 *    crop rect / fill / cropped shape / source_shape / CropVideoBackend, plus
 *    a crop-sized getFrame whose pixels equal the Python-authoritative values.
 *  - FORMAT_ID + /video_crops emission: a cropped JS save bumps format_id to
 *    2.3 and emits a compact length-1-vlen-array /video_crops; an uncropped
 *    save emits NO /video_crops and keeps format_id <= 2.2 with crop-free
 *    videos_json (byte-stable).
 *  - videos_json UNCROPPED INVARIANT: a saved cropped video's videos_json entry
 *    describes the FULL source shape and carries NO crop/crop_fill/source_shape
 *    keys; reload re-applies the crop from /video_crops only.
 *  - JS -> JS round-trip preserves the crop.
 *  - Nested crop-of-crop write throws.
 *
 * Pixel golden values are from the authoritative Python sleap-io 0.8.0:
 *   v.crop_rect=(64,96,320,288) v.crop_fill=128 v.shape=(1,192,256,1)
 *   cropped[94,74]=110 (full[190,138]=110, full[94,74]=0 -> proves cropped)
 *   cropped[52,64]=55
 */
import { describe, it, expect } from "../bun-test";
import { readSlp } from "../../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../../src/codecs/slp/write.js";
import { Labels } from "../../src/model/labels.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { CropVideoBackend } from "../../src/video/crop-backend.js";
import { Instance } from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";
import { ready, File as H5File } from "h5wasm/node";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const FIXTURE = path.join(fixtureRoot, "slp", "cropped_format_2_3.pkg.slp");

/** Grayscale value of the RGBA pixel (x,y) in an ImageData-shaped frame. */
function gray(
  frame: { data: ArrayLike<number>; width: number },
  x: number,
  y: number,
): number {
  return frame.data[(y * frame.width + x) * 4];
}

/** A stub source backend with a known shape (no real frames; for write tests). */
function makeBackend(
  width: number,
  height: number,
  filename: string,
): VideoBackend {
  return {
    filename,
    shape: [1, height, width, 1],
    dataset: null,
    fps: 30,
    async getFrame(): Promise<VideoFrame | null> {
      return null;
    },
    close() {},
  };
}

/** Read the file-level metadata/datasets from saved SLP bytes via h5wasm/node. */
async function inspectSlp(bytes: Uint8Array): Promise<{
  keys: string[];
  formatId: number;
  videoCrops: unknown;
  videoCropsShape: number[] | undefined;
  videosJson: Array<Record<string, unknown>>;
}> {
  const module = await ready;
  const memPath = `/tmp/slp_crop_inspect_${Date.now()}_${Math.random().toString(16).slice(2)}.slp`;
  module.FS.writeFile(memPath, bytes);
  const file = new H5File(memPath, "r");
  try {
    const keys = file.keys() as string[];
    const fmtAttr = (
      file.get("metadata") as { attrs: Record<string, { value?: number }> }
    ).attrs["format_id"];
    const formatId = Number(fmtAttr?.value ?? fmtAttr);
    let videoCrops: unknown;
    let videoCropsShape: number[] | undefined;
    if (keys.includes("video_crops")) {
      const vc = file.get("video_crops") as { value: unknown; shape: number[] };
      videoCrops = vc.value;
      videoCropsShape = vc.shape;
    }
    const vj = file.get("videos_json") as { value: string[] };
    const videosJson = vj.value.map((s) => JSON.parse(s));
    return { keys, formatId, videoCrops, videoCropsShape, videosJson };
  } finally {
    file.close();
    module.FS.unlink(memPath);
  }
}

describe("PYTHON -> JS: committed format-2.3 cropped fixture", () => {
  it("eager read (openVideos=true): crop metadata + CropVideoBackend + cropped frame", async () => {
    const labels = await readSlp(FIXTURE, { openVideos: true });
    const v = labels.videos[0];

    expect(v._cropTuple()).toEqual([64, 96, 320, 288]);
    expect(v._cropFill()).toBe(128);
    expect(v.shape).toEqual([1, 192, 256, 1]); // cropped
    expect(v.backendMetadata.source_shape).toEqual([1, 384, 384, 1]); // uncropped
    expect(v.backendMetadata.crop).toEqual([64, 96, 320, 288]);
    expect(v.backendMetadata.crop_fill).toBe(128);
    expect(v.backend instanceof CropVideoBackend).toBe(true);

    const frame = (await v.getFrame(0)) as ImageData;
    expect(frame.width).toBe(256);
    expect(frame.height).toBe(192);

    // Python-authoritative cropped pixels (proves cropped, not full-frame).
    expect(gray(frame, 74, 94)).toBe(110); // full[190,138] == 110, full[94,74] == 0
    expect(gray(frame, 64, 52)).toBe(55);
    // The same source coords (74,94) in the FULL frame are 0 -> confirms the
    // value above came from the cropped (offset) region, not the full frame.
    expect(gray(frame, 74, 94)).not.toBe(0);
  });

  it("closed read (openVideos=false): cropped shape + crop metadata, null backend", async () => {
    const labels = await readSlp(FIXTURE, { openVideos: false });
    const v = labels.videos[0];

    expect(v.backend).toBeNull();
    expect(v._cropTuple()).toEqual([64, 96, 320, 288]);
    expect(v._cropFill()).toBe(128);
    expect(v.shape).toEqual([1, 192, 256, 1]); // cropped (from backendMetadata)
    expect(v.backendMetadata.source_shape).toEqual([1, 384, 384, 1]);
    expect(v.isCropped).toBe(true);
  });

  it("the fixture is detected as format 2.3 with a /video_crops dataset", async () => {
    const module = await ready;
    const file = new H5File(FIXTURE, "r");
    try {
      const fmt = (
        file.get("metadata") as { attrs: Record<string, { value?: number }> }
      ).attrs["format_id"];
      expect(Number(fmt?.value ?? fmt)).toBe(2.3);
      expect((file.keys() as string[]).includes("video_crops")).toBe(true);
    } finally {
      file.close();
    }
  });
});

describe("FORMAT_ID + /video_crops byte-stability", () => {
  it("cropped JS save: format 2.3 + compact length-1-vlen /video_crops", async () => {
    const skel = new Skeleton({ name: "s", nodes: ["a", "b"] });
    const src = new Video({
      filename: "/data/big.mp4",
      backend: makeBackend(640, 480, "/data/big.mp4"),
    });
    const cropped = src.crop([100, 50, 300, 250], { fill: 7 });
    const inst = Instance.fromArray(
      [
        [10, 20],
        [30, 40],
      ],
      skel,
    );
    const lf = new LabeledFrame({
      video: cropped,
      frameIdx: 0,
      instances: [inst],
    });
    const labels = new Labels({
      skeletons: [skel],
      videos: [cropped],
      labeledFrames: [lf],
    });

    const bytes = await saveSlpToBytes(labels);
    const info = await inspectSlp(bytes);

    expect(info.formatId).toBe(2.3);
    expect(info.keys.includes("video_crops")).toBe(true);
    // Length-1 vlen string array wrapping ONE compact JSON array.
    expect(info.videoCropsShape).toEqual([1]);
    expect(Array.isArray(info.videoCrops)).toBe(true);
    const payload = (info.videoCrops as string[])[0];
    expect(payload).toBe('[{"video":0,"crop":[100,50,300,250],"fill":7}]');
    // No spaces (matches Python json.dumps(separators=(",",":"))).
    expect(payload).not.toContain(", ");
    expect(payload).not.toContain('": ');
  });

  it("uncropped JS save: NO /video_crops, format <= 2.2, crop-free videos_json", async () => {
    const skel = new Skeleton({ name: "s", nodes: ["a"] });
    const v = new Video({
      filename: "/data/plain.mp4",
      backend: makeBackend(640, 480, "/data/plain.mp4"),
    });
    const inst = Instance.fromArray([[1, 2]], skel);
    const lf = new LabeledFrame({ video: v, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      skeletons: [skel],
      videos: [v],
      labeledFrames: [lf],
    });

    const bytes = await saveSlpToBytes(labels);
    const info = await inspectSlp(bytes);

    expect(info.keys.includes("video_crops")).toBe(false);
    expect(info.formatId).toBeLessThanOrEqual(2.2);
    const entry = info.videosJson[0];
    expect(entry).not.toHaveProperty("crop");
    expect(entry).not.toHaveProperty("crop_fill");
    expect(entry.backend as Record<string, unknown>).not.toHaveProperty("crop");
    expect(entry.backend as Record<string, unknown>).not.toHaveProperty(
      "crop_fill",
    );
    expect(entry.backend as Record<string, unknown>).not.toHaveProperty(
      "source_shape",
    );
    // videos_json still describes the full (uncropped) shape.
    expect((entry.backend as Record<string, unknown>).shape).toEqual([
      1, 480, 640, 1,
    ]);
  });
});

describe("videos_json UNCROPPED INVARIANT", () => {
  it("a cropped video serializes its UNCROPPED source with no crop keys", async () => {
    const skel = new Skeleton({ name: "s", nodes: ["a"] });
    const src = new Video({
      filename: "/data/big.mp4",
      backend: makeBackend(640, 480, "/data/big.mp4"),
    });
    const cropped = src.crop([100, 50, 300, 250], { fill: 7 });
    const inst = Instance.fromArray([[5, 5]], skel);
    const lf = new LabeledFrame({
      video: cropped,
      frameIdx: 0,
      instances: [inst],
    });
    const labels = new Labels({
      skeletons: [skel],
      videos: [cropped],
      labeledFrames: [lf],
    });

    const bytes = await saveSlpToBytes(labels);
    const info = await inspectSlp(bytes);

    const backend = info.videosJson[0].backend as Record<string, unknown>;
    // Full source shape (NOT the cropped 200x200).
    expect(backend.shape).toEqual([1, 480, 640, 1]);
    expect(backend).not.toHaveProperty("crop");
    expect(backend).not.toHaveProperty("crop_fill");
    expect(backend).not.toHaveProperty("source_shape");

    // Reload: the crop is re-applied from /video_crops only.
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });
    const rv = reloaded.videos[0];
    expect(rv._cropTuple()).toEqual([100, 50, 300, 250]);
    expect(rv._cropFill()).toBe(7);
    expect(rv.shape).toEqual([1, 200, 200, 1]);
    expect(rv.backendMetadata.source_shape).toEqual([1, 480, 640, 1]);
  });
});

describe("JS -> JS round-trip preserves the crop", () => {
  it("save + reload yields the same crop / fill / shape (open AND closed)", async () => {
    const skel = new Skeleton({ name: "s", nodes: ["a"] });
    const src = new Video({
      filename: "/data/big.mp4",
      backend: makeBackend(512, 512, "/data/big.mp4"),
    });
    const cropped = src.crop([16, 32, 144, 160], { fill: 42 });
    const inst = Instance.fromArray([[1, 1]], skel);
    const lf = new LabeledFrame({
      video: cropped,
      frameIdx: 0,
      instances: [inst],
    });
    const labels = new Labels({
      skeletons: [skel],
      videos: [cropped],
      labeledFrames: [lf],
    });

    const bytes = await saveSlpToBytes(labels);

    const reClosed = await readSlp(new Uint8Array(bytes).buffer, {
      openVideos: false,
    });
    const vc = reClosed.videos[0];
    expect(vc._cropTuple()).toEqual([16, 32, 144, 160]);
    expect(vc._cropFill()).toBe(42);
    expect(vc.shape).toEqual([1, 128, 128, 1]);
    expect(vc.backendMetadata.source_shape).toEqual([1, 512, 512, 1]);
  });
});

describe("nested crop-of-crop write throws", () => {
  it("serializeVideo refuses a nested (un-flattened) crop-of-crop", async () => {
    const skel = new Skeleton({ name: "s", nodes: ["a"] });
    const inner = makeBackend(640, 480, "/data/big.mp4");
    // Different fills -> wrap NESTS (no flatten), so inner stays a crop wrapper.
    const c1 = CropVideoBackend.wrap({
      inner,
      crop: [100, 50, 300, 250],
      fill: 0,
    });
    const c2 = CropVideoBackend.wrap({
      inner: c1,
      crop: [10, 10, 50, 50],
      fill: 9,
    });
    expect(c2.inner instanceof CropVideoBackend).toBe(true); // genuinely nested

    const v = new Video({ filename: "/data/big.mp4", backend: c2 });
    v.backendMetadata = {
      crop: [...c2.crop],
      crop_fill: c2.fill,
      source_shape: [1, 480, 640, 1],
    };
    const inst = Instance.fromArray([[1, 1]], skel);
    const lf = new LabeledFrame({ video: v, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      skeletons: [skel],
      videos: [v],
      labeledFrames: [lf],
    });

    await expect(saveSlpToBytes(labels)).rejects.toThrow(/nested crop-of-crop/);
  });
});
