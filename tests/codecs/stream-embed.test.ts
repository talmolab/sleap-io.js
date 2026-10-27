/**
 * Streaming NEW-embed: `appendEncodedVideos` (main thread) + the worker's
 * encode/append helpers (`EMBED_ENCODE_WORKER_CODE`), which embed a continuous
 * video's frames into a pkg.slp written straight to disk instead of building
 * the file in memory.
 *
 * The worker helpers are evaluated here directly and driven against a real
 * h5wasm file on Node, through a sink that serializes calls the way the worker
 * queues its messages. The result is reloaded with the normal reader.
 */
import { describe, it, expect } from "../bun-test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflate } from "pako";
import { ready, File as H5File } from "h5wasm/node";
import { readSlp } from "../../src/codecs/slp/read.js";
import {
  buildSerializableEmbedPlan,
  saveSlpStructureToBytes,
  saveSlpToBytes,
  ExportCancelled,
  type SerializableEncodeEntry,
} from "../../src/codecs/slp/write.js";
import {
  appendEncodedVideos,
  toEncodeFramePayload,
  type EncodeFramePayload,
  type EncodedVideoSink,
} from "../../src/codecs/slp/stream-embed.js";
import { EMBED_ENCODE_WORKER_CODE } from "../../src/codecs/slp/embed-encode-worker.js";
import { H5_WORKER_CODE } from "../../src/codecs/slp/h5-worker.js";
import { GrayscaleVideoBackend } from "../../src/video/grayscale-backend.js";
import { Labels } from "../../src/model/labels.js";
import { Video } from "../../src/model/video.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Instance } from "../../src/model/instance.js";
import type { VideoBackend, VideoFrame } from "../../src/video/backend.js";

type Helpers = {
  encodePngEnc: (
    pixels: Uint8Array,
    w: number,
    h: number,
    channels: number,
  ) => Promise<Uint8Array>;
  encodeFrameEnc: (
    frame: EncodeFramePayload,
    collapseToGray: boolean,
  ) => Promise<Uint8Array>;
  beginEncodedVideoEnc: (
    file: unknown,
    entry: SerializableEncodeEntry,
  ) => {
    collapseToGray?: boolean;
  };
  appendEncodedBytesEnc: (
    state: unknown,
    idx: number,
    bytes: Uint8Array,
  ) => void;
  endEncodedVideoEnc: (
    file: unknown,
    state: unknown,
  ) => { framesWritten: number };
};

/** Evaluate the worker helpers with the four names `H5_WORKER_CODE` supplies. */
function loadHelpers({
  windowBytes = 32 * 1024 * 1024,
  compressionStream = (globalThis as { CompressionStream?: unknown })
    .CompressionStream,
}: {
  windowBytes?: number;
  compressionStream?: unknown;
} = {}): Helpers {
  // Same as h5-worker.ts's setStringAttrWorker / writeSourceVideoJsonWorker.
  const setStringAttrWorker = (
    target: { create_attribute: (...a: unknown[]) => void },
    name: string,
    value: string,
  ) => {
    const n = new TextEncoder().encode(value).length;
    target.create_attribute(name, value, null, `S${n}`);
  };
  const writeSourceVideoJsonWorker = (
    file: {
      create_group: (p: string) => void;
      get: (p: string) => { create_attribute: (...a: unknown[]) => void };
    },
    group: string,
    dict: unknown,
  ) => {
    file.create_group(`${group}/source_video`);
    setStringAttrWorker(
      file.get(`${group}/source_video`),
      "json",
      JSON.stringify(dict),
    );
  };
  const make = new Function(
    "setStringAttrWorker",
    "writeSourceVideoJsonWorker",
    "EMBED_WRITE_WINDOW_BYTES",
    "EMBED_VIDEO_CHUNK_BYTES",
    "CompressionStream",
    EMBED_ENCODE_WORKER_CODE +
      "\nreturn { encodePngEnc, encodeFrameEnc, beginEncodedVideoEnc, appendEncodedBytesEnc, endEncodedVideoEnc };",
  );
  return make(
    setStringAttrWorker,
    writeSourceVideoJsonWorker,
    windowBytes,
    1 << 20,
    compressionStream,
  ) as Helpers;
}

/** A sink over an open h5wasm file, serialized like the worker's queue. */
function fileSink(file: unknown, helpers: Helpers) {
  let state: { collapseToGray?: boolean } | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const next = chain.then(fn);
    chain = next.catch(() => {});
    return next;
  };
  const calls = { collapseToGray: [] as boolean[], frames: [] as number[] };
  const sink: EncodedVideoSink = {
    beginEncodedVideo: (entry, collapseToGray) =>
      queue(() => {
        calls.collapseToGray.push(collapseToGray);
        state = helpers.beginEncodedVideoEnc(file, entry);
        state.collapseToGray = collapseToGray;
      }),
    appendEncodedFrame: (frameIdx, frame) =>
      queue(async () => {
        calls.frames.push(frameIdx);
        const bytes = await helpers.encodeFrameEnc(
          frame,
          !!state!.collapseToGray,
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
  return { sink, calls };
}

/** Parse a PNG's color type and unfiltered pixels. */
function readPng(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const colorType = png[25];
  const idat: number[] = [];
  let off = 8;
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (type === "IDAT") idat.push(...png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflate(Uint8Array.from(idat));
  const channels = ({ 0: 1, 4: 2, 2: 3, 6: 4 } as Record<number, number>)[
    colorType
  ];
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    pixels.set(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      y * stride,
    );
  }
  return { width, height, colorType, channels, pixels };
}

const W = 6;
const H = 4;
/** RGBA pixel value of frame `idx` at byte `i`: distinct per frame/channel. */
const px = (idx: number, i: number) => (idx * 37 + i * 3) % 256;

/** A continuous-video backend returning RGBA `ImageData`-like frames. */
function rgbaBackend(name: string, nFrames = 20) {
  const reads: number[] = [];
  const backend = {
    filename: name,
    shape: [nFrames, H, W, 3],
    fps: 30,
    async getFrame(idx: number): Promise<VideoFrame | null> {
      reads.push(idx);
      if (idx < 0 || idx >= nFrames) return null;
      const data = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < data.length; i++) data[i] = px(idx, i);
      return { data, width: W, height: H } as unknown as VideoFrame;
    },
    close() {},
  } as unknown as VideoBackend;
  return { backend, reads };
}

function labelsOn(videos: Video[], userFrames: number[]): Labels {
  const skeleton = new Skeleton({ nodes: ["A"] });
  return new Labels({
    labeledFrames: userFrames.map(
      (frameIdx) =>
        new LabeledFrame({
          video: videos[0],
          frameIdx,
          instances: [new Instance({ points: { A: [1, 2] }, skeleton })],
        }),
    ),
    videos,
    skeletons: [skeleton],
  });
}

function tmpFile(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sleap-stream-${tag}-`));
  return path.join(dir, "out.pkg.slp");
}

/** Structure write + streamed frames, the way the app's desktop export does. */
async function streamSave(
  labels: Labels,
  embed: "user" | "user+suggestions" | "all",
  tag: string,
  opts: Parameters<typeof appendEncodedVideos>[3] & {
    windowBytes?: number;
  } = {},
) {
  const file = tmpFile(tag);
  fs.writeFileSync(file, await saveSlpStructureToBytes(labels, { embed }));
  const plan = await buildSerializableEmbedPlan(labels, embed, "", {
    allowEncode: true,
  });
  await ready;
  const h5 = new H5File(file, "a");
  const { sink, calls } = fileSink(
    h5,
    loadHelpers({ windowBytes: opts.windowBytes }),
  );
  try {
    await appendEncodedVideos(sink, labels, plan.encodeEntries, opts);
  } finally {
    h5.close();
  }
  return { file, plan, calls };
}

describe("appendEncodedVideos — streaming new-embed to disk", () => {
  it("embeds the same frames as the in-memory save, as RGB PNGs of the source pixels", async () => {
    const { backend } = rgbaBackend("clip.mp4");
    const video = new Video({ filename: "clip.mp4", backend });
    const labels = labelsOn([video], [5, 0, 3]);

    // A tiny write window forces several flushes into the resizable dataset.
    const { file } = await streamSave(labels, "user", "rgb", {
      windowBytes: 64,
    });
    const streamed = await readSlp(file, { openVideos: true });

    const memFile = tmpFile("mem");
    fs.writeFileSync(memFile, await saveSlpToBytes(labels, { embed: "user" }));
    const inMemory = await readSlp(memFile, { openVideos: true });

    expect(streamed.videos[0].embeddedFrameIndices).toEqual([0, 3, 5]);
    expect(streamed.videos[0].embeddedFrameIndices).toEqual(
      inMemory.videos[0].embeddedFrameIndices,
    );
    expect(streamed.labeledFrames.map((f) => f.frameIdx).sort()).toEqual([
      0, 3, 5,
    ]);
    for (const idx of [0, 3, 5]) {
      const png = readPng((await streamed.videos[0].getFrameBuffer(idx))!);
      expect(png.colorType).toBe(2);
      const want = new Uint8Array(W * H * 3);
      for (let p = 0; p < W * H; p++) {
        for (let c = 0; c < 3; c++) want[p * 3 + c] = px(idx, p * 4 + c);
      }
      expect([...png.pixels]).toEqual([...want]);
    }
  });

  it("reads a grayscale video's inner decoder and collapses to one channel in the worker", async () => {
    const { backend: inner, reads } = rgbaBackend("gray.mp4");
    const video = new Video({
      filename: "gray.mp4",
      backend: GrayscaleVideoBackend.wrap({ inner, grayscale: true }),
    });
    const labels = labelsOn([video], [2, 7]);

    const { file, calls } = await streamSave(labels, "user", "gray");
    expect(calls.collapseToGray).toEqual([true]);
    // Only the inner decoder was read, once per frame.
    expect(reads).toEqual([2, 7]);

    const r = await readSlp(file, { openVideos: true });
    for (const idx of [2, 7]) {
      const png = readPng((await r.videos[0].getFrameBuffer(idx))!);
      expect(png.colorType).toBe(0);
      const want = Uint8Array.from({ length: W * H }, (_, p) => px(idx, p * 4));
      expect([...png.pixels]).toEqual([...want]);
    }
  });

  it("writes an empty embedded video for a video with nothing to embed, as the in-memory save", async () => {
    const a = new Video({
      filename: "a.mp4",
      backend: rgbaBackend("a.mp4").backend,
    });
    const b = new Video({
      filename: "b.mp4",
      backend: rgbaBackend("b.mp4").backend,
    });
    const labels = labelsOn([a, b], [1]);

    const { file, plan } = await streamSave(labels, "user", "empty");
    expect(plan.encodeEntries.map((e) => e.frameNumbers)).toEqual([[1], []]);
    expect(plan.encodeEntries[1].emptyAttrs).toEqual({
      frames: 20,
      height: H,
      width: W,
      channels: 3,
      fps: 30,
    });

    const r = await readSlp(file, { openVideos: true });
    expect(r.videos.map((v) => v.hasEmbeddedImages)).toEqual([true, true]);
    expect(r.videos[1].embeddedFrameIndices ?? []).toEqual([]);
  });

  it("reports progress per frame and cancels with ExportCancelled when it returns false", async () => {
    const video = new Video({
      filename: "c.mp4",
      backend: rgbaBackend("c.mp4").backend,
    });
    const labels = labelsOn([video], [0, 1, 2, 3, 4, 5]);
    const seen: Array<[number, number, string | undefined]> = [];
    await streamSave(labels, "user", "progress", {
      onProgress: (c, t, m) => {
        seen.push([c, t, m]);
      },
    });
    expect(seen.map(([c]) => c)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.every(([, t, m]) => t === 6 && m === "Embedding frames")).toBe(
      true,
    );

    await expect(
      streamSave(labels, "user", "cancel", { onProgress: (c) => c < 2 }),
    ).rejects.toBeInstanceOf(ExportCancelled);
  });

  it("fails on a frame that can't be read instead of writing a package without it", async () => {
    const backend = {
      ...rgbaBackend("bad.mp4").backend,
      async getFrame(idx: number) {
        return idx === 4 ? null : rgbaBackend("bad.mp4").backend.getFrame(idx);
      },
    } as unknown as VideoBackend;
    const labels = labelsOn(
      [new Video({ filename: "bad.mp4", backend })],
      [3, 4],
    );
    await expect(streamSave(labels, "user", "unreadable")).rejects.toThrow(
      'Couldn\'t read frame 4 from "bad.mp4"',
    );
  });
});

describe("streaming new-embed plan", () => {
  it("plans without reading a single frame (structure write + plan)", async () => {
    const { backend, reads } = rgbaBackend("lazy.mp4");
    const labels = labelsOn(
      [new Video({ filename: "lazy.mp4", backend })],
      [0, 9],
    );
    await saveSlpStructureToBytes(labels, { embed: "user" });
    const plan = await buildSerializableEmbedPlan(labels, "user", "", {
      allowEncode: true,
    });
    expect(reads).toEqual([]);
    expect(plan.entries).toEqual([]);
    expect(
      plan.encodeEntries.map((e) => [e.videoIndex, e.frameNumbers, e.format]),
    ).toEqual([[0, [0, 9], "png"]]);
  });

  it("leaves frames past the video's end out, as reading would", async () => {
    const { backend } = rgbaBackend("short.mp4", 5);
    const labels = labelsOn(
      [new Video({ filename: "short.mp4", backend })],
      [2, 8],
    );
    const plan = await buildSerializableEmbedPlan(labels, "user", "", {
      allowEncode: true,
    });
    expect(plan.encodeEntries[0].frameNumbers).toEqual([2]);
  });

  it("still refuses a new embed without allowEncode (raw-copy callers)", async () => {
    const labels = labelsOn(
      [new Video({ filename: "x.mp4", backend: rgbaBackend("x.mp4").backend })],
      [0],
    );
    await expect(
      buildSerializableEmbedPlan(labels, "user", ""),
    ).rejects.toThrow("new-embed");
  });
});

describe("worker frame encoding", () => {
  it("inlines into the h5 worker as valid JavaScript, with its message handlers", () => {
    expect(H5_WORKER_CODE).toContain("function encodeFrameEnc(");
    for (const type of [
      "beginEncodedVideo",
      "appendEncodedFrame",
      "endEncodedVideo",
    ]) {
      expect(H5_WORKER_CODE).toContain(`case '${type}':`);
    }
    expect(() => new Function(H5_WORKER_CODE)).not.toThrow();
  });

  it("writes a valid PNG with stored deflate blocks when CompressionStream is missing", async () => {
    const helpers = loadHelpers({ compressionStream: undefined });
    // > 65535 bytes, so the stored stream spans several blocks.
    const w = 300;
    const h = 250;
    const pixels = Uint8Array.from({ length: w * h }, (_, i) => (i * 13) % 256);
    const png = readPng(await helpers.encodePngEnc(pixels, w, h, 1));
    expect(png.colorType).toBe(0);
    expect([...png.pixels]).toEqual([...pixels]);
  });

  it("stores already-encoded PNG bytes verbatim", async () => {
    const helpers = loadHelpers();
    const png = await helpers.encodePngEnc(
      Uint8Array.from([1, 2, 3, 4]),
      2,
      2,
      1,
    );
    const payload = await toEncodeFramePayload(png as unknown as VideoFrame);
    expect(payload.kind).toBe("png");
    expect([...(await helpers.encodeFrameEnc(payload, false))]).toEqual([
      ...png,
    ]);
  });

  it("keeps a RawFrame's own channel count (only RGBA ImageData drops its alpha)", async () => {
    const helpers = loadHelpers();
    const data = Uint8Array.from({ length: 2 * 2 * 4 }, (_, i) => i * 9);
    const payload = await toEncodeFramePayload({
      data,
      width: 2,
      height: 2,
      channels: 4,
    } as unknown as VideoFrame);
    const png = readPng(await helpers.encodeFrameEnc(payload, false));
    expect(png.channels).toBe(4);
    expect([...png.pixels]).toEqual([...data]);
  });

  it("hands the worker a copy, so the backend's frame stays intact", async () => {
    const data = new Uint8ClampedArray(2 * 2 * 4).fill(7);
    const payload = await toEncodeFramePayload({
      data,
      width: 2,
      height: 2,
    } as unknown as VideoFrame);
    if (payload.kind !== "pixels") throw new Error("expected pixels");
    payload.data.fill(0);
    expect(data[0]).toBe(7);
    expect(payload.rgba).toBe(true);
  });
});
