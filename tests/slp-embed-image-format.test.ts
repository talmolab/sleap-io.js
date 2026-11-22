/**
 * The image format of newly embedded frames (`imageFormat` / `imageQuality`
 * of the SLP writers), as Python sleap-io's `image_format` / `image_quality`:
 * option checks, PNG (the default) and JPEG embeds of colour and grayscale
 * sources, image files and encoded bytes stored verbatim, the in-memory and
 * the streaming (worker) paths, and read-backs in JS and in Python.
 *
 * Python read-backs run each interpreter listed (comma-separated) in
 * `SLEAP_IO_TEST_PYTHONS`, or `uv run --with sleap-io python` when unset, and
 * print the sleap-io version each one ran. `SLEAP_IO_SKIP_PYTHON_TESTS=1`
 * skips them; otherwise a Python that cannot run fails the test.
 */
import { describe, it, expect, setDefaultTimeout } from "./bun-test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ready, File as H5File } from "h5wasm/node";
import { Canvas, ImageData as SkiaImageData } from "skia-canvas";
import { readSlp } from "../src/codecs/slp/read.js";
import {
  buildSerializableEmbedPlan,
  saveSlpStructureToBytes,
  saveSlpToBytes,
  type SerializableEncodeEntry,
} from "../src/codecs/slp/write.js";
import {
  checkEmbedImageFormat,
  encodedImageChannels,
} from "../src/codecs/slp/embed-format.js";
import {
  appendEncodedVideos,
  type EncodeFramePayload,
  type EncodedVideoSink,
} from "../src/codecs/slp/stream-embed.js";
import { EMBED_ENCODE_WORKER_CODE } from "../src/codecs/slp/embed-encode-worker.js";
import { saveSlp, saveSlpSet } from "../src/io/main.js";
import { encodeGrayJpeg, encodeJpegPixels } from "../src/video/jpeg-encode.js";
import { decodeEncoded } from "../src/video/image-decode.js";
import { ImageVideoBackend } from "../src/video/image-video.js";
import { GrayscaleVideoBackend } from "../src/video/grayscale-backend.js";
import { Labels } from "../src/model/labels.js";
import { LabelsSet } from "../src/model/labels-set.js";
import { Video } from "../src/model/video.js";
import { Skeleton } from "../src/model/skeleton.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance } from "../src/model/instance.js";
import type { VideoBackend, VideoFrame } from "../src/video/backend.js";
import { readPng } from "./png-read";
import { encodePngPixels } from "../src/video/png-encode.js";
import { fileURLToPath } from "node:url";

setDefaultTimeout(120_000);

const W = 20;
const H = 12;
/** A smooth test image: value of frame `idx` at (x, y), channel `c`. */
const value = (idx: number, x: number, y: number, c: number) =>
  Math.min(255, 20 + x * 6 + y * 5 + c * 30 + idx * 4);

function rgbaFrame(idx: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = value(idx, x, y, c);
      data[o + 3] = 255;
    }
  }
  return data;
}

function grayFrame(idx: number): Uint8Array {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data[y * W + x] = value(idx, x, y, 0);
  }
  return data;
}

/**
 * A continuous video returning RGBA `ImageData`-like frames; with `bgr`, the
 * same images with R and B swapped.
 */
function rgbaBackend(n = 10, bgr = false): VideoBackend {
  return {
    filename: "clip.mp4",
    shape: [n, H, W, 3],
    fps: 30,
    async getFrame(idx: number): Promise<VideoFrame | null> {
      if (idx < 0 || idx >= n) return null;
      const data = rgbaFrame(idx);
      if (bgr) {
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          data[i] = data[i + 2];
          data[i + 2] = r;
        }
      }
      return { data, width: W, height: H } as never;
    },
    close() {},
  } as unknown as VideoBackend;
}

/** A grayscale video returning one-channel raw frames. */
function grayBackend(n = 10): VideoBackend {
  return {
    filename: "gray.mp4",
    shape: [n, H, W, 1],
    fps: 25,
    async getFrame(idx: number): Promise<VideoFrame | null> {
      if (idx < 0 || idx >= n) return null;
      return {
        data: grayFrame(idx),
        width: W,
        height: H,
        channels: 1,
      } as never;
    },
    close() {},
  } as unknown as VideoBackend;
}

/** A colour JPEG of frame `idx` (skia), with R and B swapped when `bgr`. */
async function colourJpeg(idx: number, bgr = false): Promise<Uint8Array> {
  const data = rgbaFrame(idx);
  if (bgr) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      data[i] = data[i + 2];
      data[i + 2] = r;
    }
  }
  const canvas = new Canvas(W, H);
  canvas.gpu = false;
  canvas.getContext("2d").putImageData(new SkiaImageData(data, W, H), 0, 0);
  return new Uint8Array(await canvas.toBuffer("jpeg", { quality: 0.95 }));
}

/** A backend returning encoded image bytes, as an embedded video on Node. */
function bytesBackend(
  frames: Uint8Array[],
  channelOrder: string,
): VideoBackend {
  return {
    filename: "frames.bin",
    shape: [frames.length, H, W, 3],
    fps: 30,
    embeddedChannelOrder: channelOrder,
    async getFrame(idx: number): Promise<VideoFrame | null> {
      return (frames[idx] ?? null) as never;
    },
    close() {},
  } as unknown as VideoBackend;
}

function labelsOn(videos: Video[], userFrames: number[][]): Labels {
  const skeleton = new Skeleton({ nodes: ["A"] });
  const labeledFrames = videos.flatMap((video, vi) =>
    userFrames[vi].map(
      (frameIdx) =>
        new LabeledFrame({
          video,
          frameIdx,
          instances: [new Instance({ points: { A: [1, 2] }, skeleton })],
        }),
    ),
  );
  return new Labels({ labeledFrames, videos, skeletons: [skeleton] });
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "sleap-io-jpg-"));

function writeTmp(bytes: Uint8Array, name = "out.pkg.slp"): string {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(file, bytes);
  return file;
}

type VideoAttrs = {
  format: string;
  channel_order: string;
  channels: number;
  height: number;
  width: number;
  frameNumbers: number[];
  rows: Uint8Array[];
};

/** Each embedded video's dataset attributes and stored rows (unpadded). */
async function embeddedVideos(file: string): Promise<VideoAttrs[]> {
  await ready;
  const h5 = new H5File(file, "r");
  try {
    const out: VideoAttrs[] = [];
    for (let i = 0; h5.get(`video${i}/video`); i++) {
      const ds = h5.get(`video${i}/video`) as any;
      const attr = (k: string) => {
        const v = ds.attrs[k]?.value;
        return typeof v === "bigint" ? Number(v) : v;
      };
      const fns = Array.from(
        (h5.get(`video${i}/frame_numbers`) as any).value as ArrayLike<number>,
        Number,
      );
      const rows: Uint8Array[] = [];
      if (ds.shape.length === 2) {
        const all = new Uint8Array((ds.value as Int8Array).buffer);
        const width = ds.shape[1];
        for (let r = 0; r < ds.shape[0]; r++) {
          const row = all.subarray(r * width, (r + 1) * width);
          rows.push(row.slice(0, encodedLength(row)));
        }
      }
      out.push({
        format: attr("format"),
        channel_order: attr("channel_order"),
        channels: attr("channels"),
        height: attr("height"),
        width: attr("width"),
        frameNumbers: fns,
        rows,
      });
    }
    return out;
  } finally {
    h5.close();
  }
}

/** Length of a zero-padded PNG/JPEG row: through IEND / the EOI marker. */
function encodedLength(row: Uint8Array): number {
  if (row[0] === 0x89) {
    const dv = new DataView(row.buffer, row.byteOffset, row.byteLength);
    let off = 8;
    while (off < row.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(...row.subarray(off + 4, off + 8));
      off += 12 + len;
      if (type === "IEND") return off;
    }
    return row.length;
  }
  let end = row.length;
  while (end > 2 && !(row[end - 2] === 0xff && row[end - 1] === 0xd9)) end--;
  return end;
}

/** Decoded pixels of stored bytes, as `channels` interleaved values. */
async function pixelsOf(
  bytes: Uint8Array,
  channels: number,
): Promise<number[]> {
  const img = await decodeEncoded(bytes);
  const out: number[] = [];
  for (let p = 0; p < img.width * img.height; p++) {
    for (let c = 0; c < channels; c++) out.push(img.data[p * 4 + c]);
  }
  return out;
}

function expected(idx: number, channels: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < channels; c++) out.push(value(idx, x, y, c));
    }
  }
  return out;
}

/** Largest and mean absolute difference. */
function diff(a: number[], b: number[]): { max: number; mean: number } {
  expect(a.length).toBe(b.length);
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
  }
  return { max, mean: sum / a.length };
}

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;
const isPngBytes = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50;

// --- streaming path: the worker helpers on h5wasm, as stream-embed.test.ts ---

type WorkerHelpers = {
  encodeFrameEnc: (
    frame: EncodeFramePayload,
    collapseToGray: boolean,
    entry?: SerializableEncodeEntry,
  ) => Promise<Uint8Array>;
  encodeJpegEnc: (
    px: Uint8Array,
    w: number,
    h: number,
    channels: number,
    q: number | null,
  ) => Uint8Array;
  beginEncodedVideoEnc: (
    file: unknown,
    entry: SerializableEncodeEntry,
  ) => {
    collapseToGray?: boolean;
    entry: SerializableEncodeEntry;
  };
  appendEncodedBytesEnc: (s: unknown, i: number, b: Uint8Array) => void;
  endEncodedVideoEnc: (f: unknown, s: unknown) => { framesWritten: number };
};

function workerHelpers(): WorkerHelpers {
  const writeSourceVideoJsonWorker = (
    file: any,
    group: string,
    dict: unknown,
  ) => {
    file.create_group(`${group}/source_video`);
    file
      .get(`${group}/source_video`)
      .create_attribute("json", JSON.stringify(dict));
  };
  return new Function(
    "writeSourceVideoJsonWorker",
    "CompressionStream",
    `${EMBED_ENCODE_WORKER_CODE}\nreturn { encodeFrameEnc, encodeJpegEnc, beginEncodedVideoEnc, appendEncodedBytesEnc, endEncodedVideoEnc };`,
  )(
    writeSourceVideoJsonWorker,
    (globalThis as { CompressionStream?: unknown }).CompressionStream,
  ) as WorkerHelpers;
}

/** A sink over an open h5wasm file, run like the worker's message queue. */
function fileSink(file: unknown, helpers: WorkerHelpers): EncodedVideoSink {
  let state: {
    collapseToGray?: boolean;
    entry: SerializableEncodeEntry;
  } | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const next = chain.then(fn);
    chain = next.catch(() => {});
    return next;
  };
  return {
    beginEncodedVideo: (entry, collapseToGray) =>
      queue(() => {
        state = helpers.beginEncodedVideoEnc(file, entry);
        state.collapseToGray = collapseToGray;
      }),
    appendEncodedFrame: (frameIdx, frame) =>
      queue(async () => {
        const bytes = await helpers.encodeFrameEnc(
          frame,
          !!state!.collapseToGray,
          state!.entry,
        );
        helpers.appendEncodedBytesEnc(state, frameIdx, bytes);
      }),
    endEncodedVideo: () =>
      queue(() => {
        const r = helpers.endEncodedVideoEnc(file, state);
        state = null;
        return r;
      }),
  };
}

/** Structure write + streamed frames, as an app's desktop export. */
async function streamSave(
  labels: Labels,
  options: { imageFormat?: "png" | "jpg" | "jpeg"; imageQuality?: number },
): Promise<string> {
  const file = writeTmp(
    await saveSlpStructureToBytes(labels, { embed: "user", ...options }),
  );
  const plan = await buildSerializableEmbedPlan(labels, "user", "", {
    allowEncode: true,
    ...options,
  });
  await ready;
  const h5 = new H5File(file, "a");
  try {
    await appendEncodedVideos(
      fileSink(h5, workerHelpers()),
      labels,
      plan.encodeEntries,
    );
  } finally {
    h5.close();
  }
  return file;
}

// ---------------------------------------------------------------------------

describe("imageFormat / imageQuality checks (as Python's)", () => {
  it("normalizes the format", () => {
    expect(checkEmbedImageFormat(undefined)).toBeNull();
    expect(checkEmbedImageFormat(null)).toBeNull();
    expect(checkEmbedImageFormat("png")).toBe("png");
    expect(checkEmbedImageFormat("jpg")).toBe("jpg");
    expect(checkEmbedImageFormat("jpeg")).toBe("jpg");
    expect(checkEmbedImageFormat("JPEG")).toBe("jpg");
    expect(checkEmbedImageFormat("PNG", 9)).toBe("png");
    expect(checkEmbedImageFormat("jpg", 0)).toBe("jpg");
    expect(checkEmbedImageFormat("jpg", 100)).toBe("jpg");
  });

  const refused: Array<
    [string, string | undefined, number | undefined, string]
  > = [
    ["an unknown format", "tiff", undefined, "imageFormat must be"],
    ["hdf5 (raw pixels)", "hdf5", undefined, "not supported by sleap-io.js"],
    ["a quality without a format", undefined, 90, "imageQuality needs"],
    ["a JPEG quality above 100", "jpg", 101, "must be in [0, 100]"],
    ["a negative JPEG quality", "jpeg", -1, "must be in [0, 100]"],
    ["a PNG level above 9", "png", 10, "must be in [0, 9]"],
    ["a non-number quality", "jpg", Number.NaN, "must be in [0, 100]"],
  ];
  for (const [what, format, quality, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(() => checkEmbedImageFormat(format, quality)).toThrow(message);
    });
  }

  it("refuses bad options before writing anything, embedding or not", async () => {
    const labels = labelsOn(
      [new Video({ filename: "clip.mp4", backend: rgbaBackend() })],
      [[0]],
    );
    await expect(
      saveSlpToBytes(labels, { imageFormat: "gif" as never }),
    ).rejects.toThrow("imageFormat must be");
    await expect(
      saveSlpToBytes(labels, { embed: "user", imageQuality: 50 }),
    ).rejects.toThrow("imageQuality needs");
    await expect(
      saveSlpStructureToBytes(labels, {
        embed: "user",
        imageFormat: "jpg",
        imageQuality: 200,
      }),
    ).rejects.toThrow("must be in [0, 100]");
    await expect(
      buildSerializableEmbedPlan(labels, "user", "", {
        allowEncode: true,
        imageFormat: "png",
        imageQuality: 11,
      }),
    ).rejects.toThrow("must be in [0, 9]");

    const dir = tmpDir();
    const file = path.join(dir, "refused.pkg.slp");
    await expect(
      saveSlp(labels, file, { embed: "user", imageQuality: 3 }),
    ).rejects.toThrow("imageQuality needs");
    const set = new LabelsSet();
    set.set(path.join(dir, "a.slp"), labels);
    set.set(path.join(dir, "b.slp"), labels);
    await expect(
      saveSlpSet(set, { imageFormat: "bmp" as never }),
    ).rejects.toThrow("imageFormat must be");
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

/** JPEG frame header: component count and each component's sampling. */
function jpegLayout(jpg: Uint8Array): { comps: number; sampling: number[] } {
  let i = 2;
  while (i < jpg.length) {
    const marker = jpg[i + 1];
    const len = (jpg[i + 2] << 8) | jpg[i + 3];
    if (marker === 0xc0) {
      const comps = jpg[i + 9];
      const sampling = [];
      for (let c = 0; c < comps; c++) sampling.push(jpg[i + 11 + c * 3]);
      return { comps, sampling };
    }
    i += 2 + len;
  }
  throw new Error("no SOF0");
}

/** Test images for the encoder: smooth, noisy, hard edges, flat. */
function pattern(kind: string, w: number, h: number, ch: number): Uint8Array {
  const px = new Uint8Array(w * h * ch);
  let seed = 12345;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        const i = (y * w + x) * ch + c;
        if (kind === "noise") {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          px[i] = seed >> 23;
        } else if (kind === "checker") {
          px[i] = ((x >> 1) + (y >> 1) + c) % 2 ? 255 : 0;
        } else if (kind === "flat") {
          px[i] = 255;
        } else {
          px[i] = Math.min(255, (x * 255) / w + y + c * 40) | 0;
        }
      }
    }
  }
  return px;
}

/** True when entropy-coded data holds a stuffed 0xFF (0xFF 0x00). */
function hasStuffing(jpg: Uint8Array): boolean {
  for (let i = 0; i + 1 < jpg.length; i++) {
    if (jpg[i] === 0xff && jpg[i + 1] === 0x00) return true;
  }
  return false;
}

describe("JPEG encoder", () => {
  it("writes a one-component baseline JPEG for gray pixels", async () => {
    const px = grayFrame(3);
    const jpg = encodeGrayJpeg(px, W, H, 95);
    expect(isJpeg(jpg)).toBe(true);
    expect(jpegLayout(jpg)).toEqual({ comps: 1, sampling: [0x11] });
    expect(encodedImageChannels(jpg)).toBe(1);
    const d = diff(await pixelsOf(jpg, 1), Array.from(px));
    expect(d.max).toBeLessThanOrEqual(4);
    // Quality 100 is near lossless; quality 0 is coarser and smaller.
    expect(
      diff(await pixelsOf(encodeGrayJpeg(px, W, H, 100), 1), Array.from(px))
        .max,
    ).toBeLessThanOrEqual(1);
    expect(encodeGrayJpeg(px, W, H, 0).length).toBeLessThan(jpg.length);
  });

  it("writes YCbCr 4:2:0 for colour pixels, ignoring alpha", async () => {
    const rgb = encodeJpegPixels(framePixels3(rgbaFrame(2)), W, H, 3, 95);
    expect(jpegLayout(rgb)).toEqual({ comps: 3, sampling: [0x22, 0x11, 0x11] });
    expect(
      diff(await pixelsOf(rgb, 3), expected(2, 3)).max,
    ).toBeLessThanOrEqual(12);
    // RGBA with any alpha encodes as its RGB (frames are opaque).
    const rgba = rgbaFrame(2);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = i % 8 === 3 ? 0 : 128;
    expect([...encodeJpegPixels(rgba, W, H, 4, 95)]).toEqual([...rgb]);
    // Gray + alpha encodes as its gray channel.
    const ga = new Uint8Array(W * H * 2);
    const g = grayFrame(1);
    for (let p = 0; p < W * H; p++) ga[p * 2] = g[p];
    expect([...encodeJpegPixels(ga, W, H, 2, 80)]).toEqual([
      ...encodeGrayJpeg(g, W, H, 80),
    ]);
  });

  it("handles sizes that are not a multiple of the block, and 1x1", async () => {
    for (const [w, h] of [
      [1, 1],
      [9, 3],
      [17, 13],
      [33, 1],
    ]) {
      for (const ch of [1, 3]) {
        const jpg = encodeJpegPixels(pattern("grad", w, h, ch), w, h, ch, 100);
        const img = await decodeEncoded(jpg);
        expect([img.width, img.height]).toEqual([w, h]);
      }
    }
  });

  it("refuses frames it can't encode", () => {
    expect(() => encodeJpegPixels(new Uint8Array(5 * 4), 2, 2, 5)).toThrow(
      "expected 1-4",
    );
    expect(() => encodeJpegPixels(new Uint8Array(3), 2, 2, 1)).toThrow(
      "expected 4 bytes",
    );
  });

  it("the worker's copy writes the same bytes", () => {
    const helpers = workerHelpers();
    let cases = 0;
    let stuffed = 0;
    const sizes = [
      [1, 1],
      [8, 8],
      [17, 9],
      [64, 16],
      [129, 67],
    ];
    for (const [w, h] of sizes) {
      for (const kind of ["noise", "grad", "checker", "flat"]) {
        for (const ch of [1, 2, 3, 4]) {
          const px = pattern(kind, w, h, ch);
          for (const q of [0, 1, 10, 50, 75, 95, 100, null]) {
            const main = encodeJpegPixels(px, w, h, ch, q);
            expect([...helpers.encodeJpegEnc(px, w, h, ch, q)]).toEqual([
              ...main,
            ]);
            cases++;
            if (hasStuffing(main.subarray(600))) stuffed++;
          }
        }
      }
    }
    expect(cases).toBe(sizes.length * 4 * 4 * 8);
    // The sweep exercises 0xFF byte stuffing, long zero runs and many blocks.
    expect(stuffed).toBeGreaterThan(20);
  });
});

/** RGBA pixels as RGB. */
function framePixels3(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let p = 0; p < rgba.length / 4; p++) {
    out[p * 3] = rgba[p * 4];
    out[p * 3 + 1] = rgba[p * 4 + 1];
    out[p * 3 + 2] = rgba[p * 4 + 2];
  }
  return out;
}

/** The same labels, rebuilt per save (backends hold no state to share). */
function sources() {
  return {
    colour: () =>
      labelsOn(
        [new Video({ filename: "clip.mp4", backend: rgbaBackend() })],
        [[5, 0, 3]],
      ),
    gray: () =>
      labelsOn(
        [new Video({ filename: "gray.mp4", backend: grayBackend() })],
        [[1, 2]],
      ),
    grayWrapped: () =>
      labelsOn(
        [
          new Video({
            filename: "clip.mp4",
            backend: GrayscaleVideoBackend.wrap({
              inner: rgbaBackend(),
              grayscale: true,
            }),
          }),
        ],
        [[4, 1]],
      ),
  };
}

describe("new embeds in each format (in memory and streamed)", () => {
  const cases: Array<{
    name: keyof ReturnType<typeof sources>;
    channels: number;
    frames: number[];
  }> = [
    { name: "colour", channels: 3, frames: [0, 3, 5] },
    { name: "gray", channels: 1, frames: [1, 2] },
    { name: "grayWrapped", channels: 1, frames: [1, 4] },
  ];
  for (const { name, channels, frames } of cases) {
    it(`${name}: the default stays PNG, as before`, async () => {
      const mem = await embeddedVideos(
        writeTmp(await saveSlpToBytes(sources()[name](), { embed: "user" })),
      );
      const explicit = await embeddedVideos(
        writeTmp(
          await saveSlpToBytes(sources()[name](), {
            embed: "user",
            imageFormat: "png",
          }),
        ),
      );
      for (const v of [mem[0], explicit[0]]) {
        expect(v.format).toBe("png");
        expect(v.channel_order).toBe("RGB");
        expect(v.channels).toBe(channels);
        expect(v.frameNumbers).toEqual(frames);
        for (const [i, row] of v.rows.entries()) {
          expect(isPngBytes(row)).toBe(true);
          const png = readPng(row);
          expect(png.channels).toBe(channels);
          expect([...png.pixels]).toEqual(expected(frames[i], channels));
        }
      }
    });

    for (const format of ["jpg", "jpeg"] as const) {
      it(`${name}: imageFormat "${format}" stores JPEGs ("jpg")`, async () => {
        const memFile = writeTmp(
          await saveSlpToBytes(sources()[name](), {
            embed: "user",
            imageFormat: format,
          }),
        );
        const streamFile = await streamSave(sources()[name](), {
          imageFormat: format,
        });
        const [mem] = await embeddedVideos(memFile);
        const [streamed] = await embeddedVideos(streamFile);
        for (const v of [mem, streamed]) {
          expect(v.format).toBe("jpg");
          expect(v.channel_order).toBe("RGB");
          expect([v.channels, v.height, v.width]).toEqual([channels, H, W]);
          expect(v.frameNumbers).toEqual(frames);
          for (const [i, row] of v.rows.entries()) {
            expect(isJpeg(row)).toBe(true);
            // A grayscale video stores one-component JPEGs, as Python.
            expect(encodedImageChannels(row)).toBe(channels);
            const d = diff(
              await pixelsOf(row, channels),
              expected(frames[i], channels),
            );
            expect(d.max).toBeLessThanOrEqual(channels === 1 ? 4 : 12);
            expect(d.mean).toBeLessThan(3);
          }
        }
        // The same encoder on both paths: the same bytes.
        expect(streamed.rows.map((r) => [...r])).toEqual(
          mem.rows.map((r) => [...r]),
        );
        // And read back through the reader.
        const labels = await readSlp(memFile, { openVideos: true });
        expect(labels.videos[0].embeddedFrameIndices).toEqual(frames);
        expect(labels.videos[0].shape?.[3]).toBe(channels);
        const raw = await labels.videos[0].getFrameBuffer(frames[0]);
        expect(isJpeg(raw!)).toBe(true);
      });
    }
  }

  it("imageQuality sets the JPEG quality and the PNG level, on both paths", async () => {
    const size = async (opts: {
      imageFormat: "png" | "jpg";
      imageQuality?: number;
    }) => {
      const [mem] = await embeddedVideos(
        writeTmp(
          await saveSlpToBytes(sources().gray(), { embed: "user", ...opts }),
        ),
      );
      const [streamed] = await embeddedVideos(
        await streamSave(sources().gray(), opts),
      );
      return [mem, streamed].map((v) =>
        v.rows.reduce((n, r) => n + r.length, 0),
      );
    };
    const [lowMem, lowStream] = await size({
      imageFormat: "jpg",
      imageQuality: 10,
    });
    const [defMem] = await size({ imageFormat: "jpg" });
    const [q95Mem] = await size({ imageFormat: "jpg", imageQuality: 95 });
    expect(lowMem).toBeLessThan(defMem);
    expect(lowStream).toBe(lowMem); // the same grayscale encoder
    expect(q95Mem).toBe(defMem); // the default quality is 95
    const [png0Mem, png0Stream] = await size({
      imageFormat: "png",
      imageQuality: 0,
    });
    const [png9Mem] = await size({ imageFormat: "png", imageQuality: 9 });
    expect(png9Mem).toBeLessThan(png0Mem);
    expect(png0Stream).toBeGreaterThan(png9Mem);
  });

  it("an empty embedded video records the chosen format", async () => {
    const a = new Video({ filename: "a.mp4", backend: rgbaBackend() });
    const b = new Video({ filename: "b.mp4", backend: rgbaBackend() });
    const labels = labelsOn([a, b], [[1], []]);
    const vids = await embeddedVideos(
      writeTmp(
        await saveSlpToBytes(labels, { embed: "user", imageFormat: "jpeg" }),
      ),
    );
    expect(vids.map((v) => [v.format, v.frameNumbers.length])).toEqual([
      ["jpg", 1],
      ["jpg", 0],
    ]);
  });
});

describe("frames already encoded", () => {
  async function jpegFiles(gray = false): Promise<string[]> {
    const dir = tmpDir();
    const files: string[] = [];
    for (let i = 0; i < 4; i++) {
      const file = path.join(dir, `frame${i}.${i === 3 ? "jpeg" : "jpg"}`);
      fs.writeFileSync(
        file,
        gray ? encodeGrayJpeg(grayFrame(i), W, H, 90) : await colourJpeg(i),
      );
      files.push(file);
    }
    return files;
  }
  const imageVideoLabels = async (files: string[]) =>
    labelsOn(
      [
        new Video({
          filename: files,
          backend: await ImageVideoBackend.create({ filename: files }),
        }),
      ],
      [[0, 3]],
    );

  for (const gray of [false, true]) {
    const kind = gray ? "grayscale" : "colour";
    it(`${kind} JPEG image files are stored verbatim with imageFormat "jpg"`, async () => {
      const files = await jpegFiles(gray);
      const memFile = writeTmp(
        await saveSlpToBytes(await imageVideoLabels(files), {
          embed: "user",
          imageFormat: "jpg",
        }),
      );
      const streamFile = await streamSave(await imageVideoLabels(files), {
        imageFormat: "jpg",
      });
      for (const file of [memFile, streamFile]) {
        const [v] = await embeddedVideos(file);
        expect([v.format, v.channel_order, v.channels]).toEqual([
          "jpg",
          "RGB",
          gray ? 1 : 3,
        ]);
        expect(v.rows.map((r) => [...r])).toEqual(
          [0, 3].map((i) => [...fs.readFileSync(files[i])]),
        );
      }
      // Byte-copied even with a quality, as Python.
      const [q] = await embeddedVideos(
        writeTmp(
          await saveSlpToBytes(await imageVideoLabels(files), {
            embed: "user",
            imageFormat: "jpg",
            imageQuality: 20,
          }),
        ),
      );
      expect([...q.rows[0]]).toEqual([...fs.readFileSync(files[0])]);
    });
  }

  it('JPEG image files become PNGs by default and with imageFormat "png"', async () => {
    const files = await jpegFiles();
    for (const opts of [{}, { imageFormat: "png" as const }]) {
      const [v] = await embeddedVideos(
        writeTmp(
          await saveSlpToBytes(await imageVideoLabels(files), {
            embed: "user",
            ...opts,
          }),
        ),
      );
      expect(v.format).toBe("png");
      expect(v.rows.every(isPngBytes)).toBe(true);
    }
  });

  it("a colour image file of a grayscale video is re-encoded with one channel", async () => {
    const files = await jpegFiles();
    const backend = GrayscaleVideoBackend.wrap({
      inner: await ImageVideoBackend.create({ filename: files }),
      grayscale: true,
    });
    const labels = labelsOn([new Video({ filename: files, backend })], [[0]]);
    const [v] = await embeddedVideos(
      writeTmp(
        await saveSlpToBytes(labels, { embed: "user", imageFormat: "jpg" }),
      ),
    );
    expect(v.channels).toBe(1);
    expect(encodedImageChannels(v.rows[0])).toBe(1);
    expect([...v.rows[0]]).not.toEqual([...fs.readFileSync(files[0])]);
  });

  it("encoded RGB bytes in the format are kept; BGR bytes are swapped and re-encoded", async () => {
    const rgb = await Promise.all([0, 1].map((i) => colourJpeg(i)));
    const bgr = await Promise.all([0, 1].map((i) => colourJpeg(i, true)));
    const save = async (
      frames: Uint8Array[],
      order: string,
      stream: boolean,
    ) => {
      const labels = labelsOn(
        [
          new Video({
            filename: "frames.bin",
            backend: bytesBackend(frames, order),
          }),
        ],
        [[0, 1]],
      );
      const file = stream
        ? await streamSave(labels, { imageFormat: "jpg" })
        : writeTmp(
            await saveSlpToBytes(labels, { embed: "user", imageFormat: "jpg" }),
          );
      return (await embeddedVideos(file))[0];
    };
    for (const stream of [false, true]) {
      const kept = await save(rgb, "RGB", stream);
      expect(kept.rows.map((r) => [...r])).toEqual(rgb.map((r) => [...r]));
      const swapped = await save(bgr, "BGR", stream);
      expect(swapped.channel_order).toBe("RGB");
      expect([...swapped.rows[0]]).not.toEqual([...bgr[0]]);
      for (const [i, row] of swapped.rows.entries()) {
        const d = diff(await pixelsOf(row, 3), expected(i, 3));
        expect(d.max).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe("other sources", () => {
  it("a four-channel raw frame is stored as its colour, alpha ignored, on both paths", async () => {
    const labels = () =>
      labelsOn(
        [
          new Video({
            filename: "rgba.bin",
            backend: {
              filename: "rgba.bin",
              shape: [4, H, W, 3],
              fps: 30,
              async getFrame(idx: number) {
                const data = rgbaFrame(idx);
                for (let i = 3; i < data.length; i += 4) data[i] = 0;
                return { data, width: W, height: H, channels: 4 } as never;
              },
              close() {},
            } as unknown as VideoBackend,
          }),
        ],
        [[1, 2]],
      );
    const [mem] = await embeddedVideos(
      writeTmp(
        await saveSlpToBytes(labels(), { embed: "user", imageFormat: "jpg" }),
      ),
    );
    const [streamed] = await embeddedVideos(
      await streamSave(labels(), { imageFormat: "jpg" }),
    );
    expect(streamed.rows.map((r) => [...r])).toEqual(
      mem.rows.map((r) => [...r]),
    );
    for (const [i, row] of mem.rows.entries()) {
      const d = diff(await pixelsOf(row, 3), expected([1, 2][i], 3));
      expect(d.max).toBeLessThanOrEqual(12);
    }
  });

  it('PNG image files are stored verbatim with imageFormat "png", with any level', async () => {
    const dir = tmpDir();
    const files = [0, 1, 2].map((i) => {
      const file = path.join(dir, `frame${i}.png`);
      fs.writeFileSync(
        file,
        encodePngPixels(framePixels3(rgbaFrame(i)), W, H, 3),
      );
      return file;
    });
    const labels = async () =>
      labelsOn(
        [
          new Video({
            filename: files,
            backend: await ImageVideoBackend.create({ filename: files }),
          }),
        ],
        [[0, 2]],
      );
    const want = [0, 2].map((i) => [...fs.readFileSync(files[i])]);
    for (const imageQuality of [undefined, 0, 9]) {
      const opts = { imageFormat: "png" as const, imageQuality };
      const [mem] = await embeddedVideos(
        writeTmp(
          await saveSlpToBytes(await labels(), { embed: "user", ...opts }),
        ),
      );
      const [streamed] = await embeddedVideos(
        await streamSave(await labels(), opts),
      );
      for (const v of [mem, streamed]) {
        expect(v.format).toBe("png");
        expect(v.rows.map((r) => [...r])).toEqual(want);
      }
    }
  });
});

/** Set an embedded video's recorded channel order (h5wasm, in place). */
async function setChannelOrder(file: string, order: string): Promise<void> {
  await ready;
  const h5 = new H5File(file, "a");
  try {
    const ds = h5.get("video0/video") as any;
    ds.delete_attribute("channel_order");
    ds.create_attribute("channel_order", order);
  } finally {
    h5.close();
  }
}

/** A colour package (PNG frames 0, 3, 5), as the default save writes it. */
async function colourPackage({ bgr = false } = {}): Promise<string> {
  const labels = labelsOn(
    [new Video({ filename: "clip.mp4", backend: rgbaBackend(10, bgr) })],
    [[5, 0, 3]],
  );
  const file = writeTmp(await saveSlpToBytes(labels, { embed: "user" }));
  // Stored swapped and recorded as BGR: the images are still the RGB ones.
  if (bgr) await setChannelOrder(file, "BGR");
  return file;
}

const fixture = (name: string) =>
  path.join(fileURLToPath(new URL("./data/slp", import.meta.url)), name);

describe("already-embedded videos with imageFormat (as Python)", () => {
  it("are copied as they are without imageFormat, or in the same format", async () => {
    const pkg = await colourPackage();
    const [original] = await embeddedVideos(pkg);
    for (const opts of [{}, { imageFormat: "png" as const, imageQuality: 0 }]) {
      const labels = await readSlp(pkg, { openVideos: true });
      const [v] = await embeddedVideos(
        writeTmp(await saveSlpToBytes(labels, { embed: "user", ...opts })),
      );
      expect(v.format).toBe("png");
      expect(v.rows.map((r) => [...r])).toEqual(
        original.rows.map((r) => [...r]),
      );
    }
  });

  for (const bgr of [false, true]) {
    it(`a ${bgr ? "BGR" : "RGB"} PNG package becomes JPEG, all of its stored frames, on both paths`, async () => {
      const pkg = await colourPackage({ bgr });
      const load = () => readSlp(pkg, { openVideos: true });
      // Embedding only frame 0 still converts every stored frame.
      const only0 = (labels: Labels) =>
        [[labels.videos[0], 0]] as Array<[Video, number]>;
      const memLabels = await load();
      const memFile = writeTmp(
        await saveSlpToBytes(memLabels, {
          embed: only0(memLabels),
          imageFormat: "jpg",
        }),
      );
      const streamFile = await streamSave(await load(), {
        imageFormat: "jpeg",
      });
      const [mem] = await embeddedVideos(memFile);
      const [streamed] = await embeddedVideos(streamFile);
      expect(streamed.rows.map((r) => [...r])).toEqual(
        mem.rows.map((r) => [...r]),
      );
      expect([mem.format, mem.channel_order, mem.channels]).toEqual([
        "jpg",
        "RGB",
        3,
      ]);
      expect(mem.frameNumbers).toEqual([0, 3, 5]);
      for (const [i, row] of mem.rows.entries()) {
        expect(isJpeg(row)).toBe(true);
        const d = diff(
          await pixelsOf(row, 3),
          expected(mem.frameNumbers[i], 3),
        );
        expect(d.max).toBeLessThanOrEqual(12);
      }
      const reread = await readSlp(memFile, { openVideos: true });
      expect(reread.videos[0].embeddedFrameIndices).toEqual([0, 3, 5]);
    });
  }

  it("a legacy grayscale package becomes one-component JPEGs, also on a re-save without embed", async () => {
    const original = await readSlp(fixture("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const frame = original.videos[0].embeddedFrameIndices![0];
    const png = readPng((await original.videos[0].getFrameBuffer(frame))!);
    const file = writeTmp(
      await saveSlpToBytes(original, { imageFormat: "jpg", imageQuality: 95 }),
    );
    const [v] = await embeddedVideos(file);
    expect([v.format, v.channel_order, v.channels]).toEqual(["jpg", "RGB", 1]);
    expect(v.frameNumbers).toEqual([frame]);
    expect(encodedImageChannels(v.rows[0])).toBe(1);
    const d = diff(await pixelsOf(v.rows[0], 1), [...png.pixels]);
    expect(d.max).toBeLessThanOrEqual(12);
    expect(d.mean).toBeLessThan(2);
  });
});

// --- Python read-back -------------------------------------------------------

function pythons(): Array<{ label: string; cmd: string; args: string[] }> {
  const listed = process.env.SLEAP_IO_TEST_PYTHONS;
  if (listed) {
    return listed
      .split(",")
      .filter(Boolean)
      .map((exe) => ({ label: exe, cmd: exe, args: [] }));
  }
  return [
    {
      label: "uv run --with sleap-io",
      cmd: "uv",
      args: ["run", "--with", "sleap-io", "python"],
    },
  ];
}

const SKIP_PYTHON = process.env.SLEAP_IO_SKIP_PYTHON_TESTS === "1";

const READ_BACK_PY = `
import json, sys
import h5py
import sleap_io as sio
path = sys.argv[1]
labels = sio.load_slp(path)
videos = []
with h5py.File(path, "r") as f:
    for i, video in enumerate(labels.videos):
        ds = f["video%d/video" % i]
        frames = {}
        for lf in labels.labeled_frames:
            if lf.video is video:
                img = video[lf.frame_idx]
                frames[str(lf.frame_idx)] = {
                    "shape": list(img.shape),
                    "pixels": img.reshape(-1).tolist(),
                }
        videos.append({
            "format": str(ds.attrs["format"]),
            "channel_order": str(ds.attrs["channel_order"]),
            "channels": int(ds.attrs["channels"]),
            "shape": list(video.shape),
            "frames": frames,
        })
print(json.dumps({"version": sio.__version__, "videos": videos}))
`;

/** A package to read back, and what its first video must hold. */
type ReadBack = {
  file: string;
  format: string;
  channels: number;
  height: number;
  width: number;
  /** Expected pixels by frame index, and the largest allowed difference. */
  expected: (idx: number) => number[];
  tolerance: number;
};

const synthetic = (
  file: string,
  format: string,
  channels: number,
  tolerance: number,
): ReadBack => ({
  file,
  format,
  channels,
  height: H,
  width: W,
  expected: (idx) => expected(idx, channels),
  tolerance,
});

describe("embedded JPEGs read back in Python sleap-io", () => {
  const saves: Array<[string, () => Promise<ReadBack>]> = [
    [
      "colour, in memory",
      async () =>
        synthetic(
          writeTmp(
            await saveSlpToBytes(sources().colour(), {
              embed: "user",
              imageFormat: "jpg",
            }),
          ),
          "jpg",
          3,
          12,
        ),
    ],
    [
      "colour, streamed",
      async () =>
        synthetic(
          await streamSave(sources().colour(), { imageFormat: "jpeg" }),
          "jpg",
          3,
          12,
        ),
    ],
    [
      "grayscale, in memory",
      async () =>
        synthetic(
          writeTmp(
            await saveSlpToBytes(sources().gray(), {
              embed: "user",
              imageFormat: "jpg",
              imageQuality: 90,
            }),
          ),
          "jpg",
          1,
          6,
        ),
    ],
    [
      "grayscale wrapper, streamed",
      async () =>
        synthetic(
          await streamSave(sources().grayWrapped(), { imageFormat: "jpg" }),
          "jpg",
          1,
          6,
        ),
    ],
    [
      "default PNG",
      async () =>
        synthetic(
          writeTmp(await saveSlpToBytes(sources().colour(), { embed: "user" })),
          "png",
          3,
          0,
        ),
    ],
    [
      "a BGR PNG package converted to JPEG",
      async () => {
        const labels = await readSlp(await colourPackage({ bgr: true }), {
          openVideos: true,
        });
        return synthetic(
          writeTmp(await saveSlpToBytes(labels, { imageFormat: "jpg" })),
          "jpg",
          3,
          12,
        );
      },
    ],
    [
      "a legacy grayscale package converted to JPEG",
      async () => {
        const labels = await readSlp(fixture("minimal_instance.pkg.slp"), {
          openVideos: true,
        });
        const video = labels.videos[0];
        const pixels = new Map<number, number[]>();
        for (const idx of video.embeddedFrameIndices!) {
          pixels.set(idx, [
            ...readPng((await video.getFrameBuffer(idx))!).pixels,
          ]);
        }
        const [, height, width] = video.shape!;
        return {
          file: writeTmp(await saveSlpToBytes(labels, { imageFormat: "jpg" })),
          format: "jpg",
          channels: 1,
          height,
          width,
          expected: (idx) => pixels.get(idx)!,
          tolerance: 12,
        };
      },
    ],
  ];
  for (const python of pythons()) {
    for (const [what, save] of saves) {
      it.skipIf(SKIP_PYTHON)(`${what}, with ${python.label}`, async () => {
        const want = await save();
        const out = execFileSync(
          python.cmd,
          [...python.args, "-c", READ_BACK_PY, want.file],
          { timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
        ).toString();
        const result = JSON.parse(out.trim().split("\n").pop()!);
        console.log(
          `${what} read back with sleap-io ${result.version} (${python.label})`,
        );
        const [v] = result.videos;
        expect(v.format).toBe(want.format);
        expect(v.channel_order).toBe("RGB");
        expect(v.channels).toBe(want.channels);
        expect(v.shape.slice(1)).toEqual([
          want.height,
          want.width,
          want.channels,
        ]);
        const frames = Object.entries(v.frames) as Array<
          [string, { shape: number[]; pixels: number[] }]
        >;
        expect(frames.length).toBeGreaterThan(0);
        for (const [idx, frame] of frames) {
          expect(frame.shape).toEqual([want.height, want.width, want.channels]);
          const d = diff(frame.pixels, want.expected(Number(idx)));
          expect(d.max).toBeLessThanOrEqual(want.tolerance);
        }
      });
    }
  }
});
