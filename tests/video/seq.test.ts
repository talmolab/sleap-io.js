import { describe, it, expect } from "../bun-test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SeqVideoBackend,
  SeqHeader,
  SeqIndex,
} from "../../src/video/seq-video";
import "../../src/video/seq-node"; // register node:fs byte source
import { loadVideo } from "../../src/io/main";

const HEADER_SIZE = 1024;
const MAGIC = 0xfeed;

interface Timestamp {
  sec: number;
  ms: number;
  us?: number;
}

function tsValue(ts: Timestamp, size: number): number {
  let v = ts.sec + ts.ms / 1000.0;
  if (size === 8) v += (ts.us ?? 0) / 1_000_000.0;
  return v;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function makeHeader(opts: {
  width: number;
  height: number;
  imageFormat: number;
  version: number;
  fps: number;
  numFrames: number;
  bitDepth: number;
  bitDepthReal?: number;
  imageSizeBytes: number;
  trueImageSize: number;
}): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setInt32(28, opts.version, true);
  dv.setUint32(32, HEADER_SIZE, true);
  dv.setUint32(548, opts.width, true);
  dv.setUint32(552, opts.height, true);
  dv.setUint32(556, opts.bitDepth, true);
  dv.setUint32(560, opts.bitDepthReal ?? 8, true);
  dv.setUint32(564, opts.imageSizeBytes, true);
  dv.setUint32(568, opts.imageFormat, true);
  dv.setUint32(572, opts.numFrames, true);
  dv.setUint32(580, opts.trueImageSize, true);
  dv.setFloat64(584, opts.fps, true);
  return buf;
}

function encodeTimestamp(ts: Timestamp, size: number): Uint8Array {
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, ts.sec, true);
  dv.setUint16(4, ts.ms, true);
  if (size === 8) dv.setUint16(6, ts.us ?? 0, true);
  return buf;
}

/** Build an uncompressed (mono or BGR) .seq file. */
function buildUncompressed(opts: {
  width: number;
  height: number;
  color: boolean;
  version: number;
  fps: number;
  frames: Uint8Array[]; // raw image bytes per frame
  timestamps: Timestamp[];
}): Uint8Array {
  const nch = opts.color ? 3 : 1;
  const imageSizeBytes = opts.width * opts.height * nch;
  const tsSize = opts.version >= 5 ? 8 : 6;
  const trueImageSize = imageSizeBytes + tsSize;
  const header = makeHeader({
    width: opts.width,
    height: opts.height,
    imageFormat: opts.color ? 200 : 100,
    version: opts.version,
    fps: opts.fps,
    numFrames: opts.frames.length,
    bitDepth: opts.color ? 24 : 8,
    imageSizeBytes,
    trueImageSize,
  });
  const parts: Uint8Array[] = [header];
  for (let i = 0; i < opts.frames.length; i++) {
    parts.push(opts.frames[i]);
    parts.push(encodeTimestamp(opts.timestamps[i], tsSize));
  }
  return concat(parts);
}

/** Build a compressed (JPEG/PNG) .seq file from encoded payloads. */
function buildCompressed(opts: {
  width: number;
  height: number;
  imageFormat: number; // 201 jpg, 2 png, etc.
  version: number;
  fps: number;
  numFramesHeader: number;
  payloads: Uint8Array[]; // encoded image bytes (must start with the magic)
  timestamps: Timestamp[];
}): Uint8Array {
  const tsSize = opts.version >= 5 ? 8 : 6;
  const header = makeHeader({
    width: opts.width,
    height: opts.height,
    imageFormat: opts.imageFormat,
    version: opts.version,
    fps: opts.fps,
    numFrames: opts.numFramesHeader,
    bitDepth: opts.imageFormat === 2 || opts.imageFormat === 201 ? 24 : 8,
    imageSizeBytes: 0,
    trueImageSize: 0,
  });
  const parts: Uint8Array[] = [header];
  for (let i = 0; i < opts.payloads.length; i++) {
    const payload = opts.payloads[i];
    const sizeField = new Uint8Array(4);
    new DataView(sizeField.buffer).setUint32(0, 4 + payload.length, true);
    parts.push(sizeField);
    parts.push(payload);
    parts.push(encodeTimestamp(opts.timestamps[i], tsSize));
  }
  return concat(parts);
}

function fakeJpeg(len: number, seed: number): Uint8Array {
  const b = new Uint8Array(len);
  b[0] = 0xff;
  b[1] = 0xd8; // SOI
  for (let i = 2; i < len - 2; i++) b[i] = (seed + i) & 0xff;
  b[len - 2] = 0xff;
  b[len - 1] = 0xd9; // EOI
  return b;
}

async function encodePng(
  width: number,
  height: number,
  rgb: [number, number, number]
): Promise<Uint8Array> {
  const sc = await import("skia-canvas");
  const canvas = new sc.Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.fillRect(0, 0, width, height);
  const buf = await canvas.toBuffer("png");
  return new Uint8Array(buf);
}

async function encodeJpeg(
  width: number,
  height: number,
  rgb: [number, number, number]
): Promise<Uint8Array> {
  const sc = await import("skia-canvas");
  const canvas = new sc.Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  ctx.fillRect(0, 0, width, height);
  const buf = await canvas.toBuffer("jpeg", { quality: 1 });
  return new Uint8Array(buf);
}

function px(img: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes.buffer as ArrayBuffer]);

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("SeqHeader", () => {
  it("parses a valid header", () => {
    const bytes = buildUncompressed({
      width: 4,
      height: 3,
      color: false,
      version: 4,
      fps: 25,
      frames: [new Uint8Array(12)],
      timestamps: [{ sec: 1, ms: 0 }],
    });
    const h = SeqHeader.fromBytes(bytes.slice(0, HEADER_SIZE));
    expect(h.magic).toBe(MAGIC);
    expect(h.width).toBe(4);
    expect(h.height).toBe(3);
    expect(h.imageFormat).toBe(100);
    expect(h.codecName).toBe("monoraw");
    expect(h.numChannels).toBe(1);
    expect(h.isCompressed).toBe(false);
    expect(h.fps).toBeCloseTo(25, 5);
  });

  it("reports color channels and compression for color JPEG", () => {
    const bytes = buildCompressed({
      width: 2,
      height: 2,
      imageFormat: 201,
      version: 5,
      fps: 30,
      numFramesHeader: 1,
      payloads: [fakeJpeg(20, 1)],
      timestamps: [{ sec: 1, ms: 0, us: 0 }],
    });
    const h = SeqHeader.fromBytes(bytes.slice(0, HEADER_SIZE));
    expect(h.codecName).toBe("jpg");
    expect(h.numChannels).toBe(3);
    expect(h.isCompressed).toBe(true);
  });

  it("throws on invalid magic", () => {
    const bytes = new Uint8Array(HEADER_SIZE);
    new DataView(bytes.buffer).setUint32(0, 0x1234, true);
    expect(() => SeqHeader.fromBytes(bytes)).toThrow("Invalid .seq magic");
  });

  it("throws when too small", () => {
    expect(() => SeqHeader.fromBytes(new Uint8Array(10))).toThrow("too small");
  });
});

// ---------------------------------------------------------------------------
// SeqIndex
// ---------------------------------------------------------------------------

describe("SeqIndex.buildUncompressed", () => {
  it("computes analytic offsets and timestamp size", () => {
    const h = new SeqHeader();
    h.numFrames = 3;
    h.trueImageSize = 50;
    h.version = 4;
    const idx = SeqIndex.buildUncompressed(h);
    expect(idx.numFrames).toBe(3);
    expect(idx.offsets).toEqual([1024, 1074, 1124]);
    expect(idx.timestampSize).toBe(6);

    h.version = 5;
    expect(SeqIndex.buildUncompressed(h).timestampSize).toBe(8);
  });

  it("frameOffset throws out of range", () => {
    const idx = new SeqIndex([1024], 1, 6);
    expect(() => idx.frameOffset(1)).toThrow("out of range");
  });
});

// ---------------------------------------------------------------------------
// Uncompressed reading
// ---------------------------------------------------------------------------

describe("SeqVideoBackend — uncompressed mono", () => {
  it("reads frames, shape, and handles indexing", async () => {
    // 3x2 mono, 2 frames with distinct pixel values.
    const f0 = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const f1 = new Uint8Array([100, 110, 120, 130, 140, 150]);
    const bytes = buildUncompressed({
      width: 3,
      height: 2,
      color: false,
      version: 4,
      fps: 30,
      frames: [f0, f1],
      timestamps: [
        { sec: 1000, ms: 0 },
        { sec: 1000, ms: 100 },
      ],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    expect(be.shape).toEqual([2, 2, 3, 1]); // [frames, height, width, channels]
    expect(be.numFrames).toBe(2);

    const img0 = (await be.getFrame(0)) as ImageData;
    expect(img0.width).toBe(3);
    expect(img0.height).toBe(2);
    // mono replicates gray across RGB, alpha 255.
    expect(px(img0, 0, 0)).toEqual([10, 10, 10, 255]);
    expect(px(img0, 2, 1)).toEqual([60, 60, 60, 255]);

    const img1 = (await be.getFrame(1)) as ImageData;
    expect(px(img1, 0, 0)).toEqual([100, 100, 100, 255]);

    // Negative index resolves from the end.
    const imgNeg = (await be.getFrame(-1)) as ImageData;
    expect(px(imgNeg, 0, 0)).toEqual([100, 100, 100, 255]);

    // Out of range -> null.
    expect(await be.getFrame(99)).toBeNull();
    expect(await be.getFrame(-99)).toBeNull();
    be.close();
  });
});

describe("SeqVideoBackend — uncompressed color (BGR -> RGB)", () => {
  it("swaps BGR to RGB", async () => {
    // 1x1 color: BGR bytes [b=30, g=20, r=10] -> RGBA [10,20,30,255].
    const f0 = new Uint8Array([30, 20, 10]);
    const bytes = buildUncompressed({
      width: 1,
      height: 1,
      color: true,
      version: 4,
      fps: 30,
      frames: [f0],
      timestamps: [{ sec: 5, ms: 0 }],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    expect(be.shape).toEqual([1, 1, 1, 3]);
    const img = (await be.getFrame(0)) as ImageData;
    expect(px(img, 0, 0)).toEqual([10, 20, 30, 255]);
    be.close();
  });
});

// ---------------------------------------------------------------------------
// Timestamps & FPS
// ---------------------------------------------------------------------------

describe("SeqVideoBackend — timestamps", () => {
  it("reads absolute timestamps (version 4, 6-byte)", async () => {
    const bytes = buildUncompressed({
      width: 1,
      height: 1,
      color: false,
      version: 4,
      fps: 30,
      frames: [new Uint8Array([0]), new Uint8Array([1])],
      timestamps: [
        { sec: 1000, ms: 250 },
        { sec: 1000, ms: 500 },
      ],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    expect(await be.getTimestamp(0)).toBeCloseTo(1000.25, 6);
    expect(await be.getTimestamp(1)).toBeCloseTo(1000.5, 6);
    expect(await be.getTimestamps()).toEqual([1000.25, 1000.5]);
    // getFrameTimes is relative to the first frame.
    const rel = await be.getFrameTimes();
    expect(rel![0]).toBeCloseTo(0, 6);
    expect(rel![1]).toBeCloseTo(0.25, 6);
    be.close();
  });

  it("reads microsecond precision (version 5, 8-byte)", async () => {
    const bytes = buildUncompressed({
      width: 1,
      height: 1,
      color: false,
      version: 5,
      fps: 30,
      frames: [new Uint8Array([0])],
      timestamps: [{ sec: 10, ms: 500, us: 250 }],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    expect(await be.getTimestamp(0)).toBeCloseTo(10.50025, 6);
    be.close();
  });

  it("getTimestamp throws out of range", async () => {
    const bytes = buildUncompressed({
      width: 1,
      height: 1,
      color: false,
      version: 4,
      fps: 30,
      frames: [new Uint8Array([0])],
      timestamps: [{ sec: 1, ms: 0 }],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    await expect(be.getTimestamp(5)).rejects.toThrow("out of range");
    be.close();
  });
});

describe("SeqVideoBackend — fps", () => {
  it("computes fps from uniform timestamps", async () => {
    // 10 frames spaced 10ms apart -> 100 fps.
    const frames: Uint8Array[] = [];
    const timestamps: Timestamp[] = [];
    for (let i = 0; i < 10; i++) {
      frames.push(new Uint8Array([i]));
      timestamps.push({ sec: 100, ms: i * 10 });
    }
    const be = await SeqVideoBackend.create(
      blobOf(
        buildUncompressed({
          width: 1,
          height: 1,
          color: false,
          version: 4,
          fps: 5, // header fps deliberately wrong
          frames,
          timestamps,
        })
      )
    );
    expect(be.fps).toBeCloseTo(100, 1);
    be.close();
  });

  it("uses only the first 100 frames to estimate fps", async () => {
    // 150 frames at 10ms spacing -> 100 fps; exercises the min(100, n) window.
    const frames: Uint8Array[] = [];
    const timestamps: Timestamp[] = [];
    for (let i = 0; i < 150; i++) {
      frames.push(new Uint8Array([i & 0xff]));
      timestamps.push({ sec: 50, ms: i * 10 });
    }
    const be = await SeqVideoBackend.create(
      blobOf(
        buildUncompressed({
          width: 1,
          height: 1,
          color: false,
          version: 4,
          fps: 5,
          frames,
          timestamps,
        })
      )
    );
    expect(be.numFrames).toBe(150);
    expect(be.fps).toBeCloseTo(100, 1);
    be.close();
  });

  it("falls back to header fps for a single frame", async () => {
    const be = await SeqVideoBackend.create(
      blobOf(
        buildUncompressed({
          width: 1,
          height: 1,
          color: false,
          version: 4,
          fps: 24,
          frames: [new Uint8Array([0])],
          timestamps: [{ sec: 1, ms: 0 }],
        })
      )
    );
    expect(be.fps).toBe(24);
    be.close();
  });

  it("falls back to header fps when intervals are too irregular", async () => {
    // Diffs alternate 2s / 3s: filtered set is empty -> fallback to header fps.
    const frames: Uint8Array[] = [];
    const timestamps: Timestamp[] = [];
    let t = 0;
    for (let i = 0; i < 5; i++) {
      frames.push(new Uint8Array([i]));
      timestamps.push({ sec: t, ms: 0 });
      t += i % 2 === 0 ? 2 : 3;
    }
    const be = await SeqVideoBackend.create(
      blobOf(
        buildUncompressed({
          width: 1,
          height: 1,
          color: false,
          version: 4,
          fps: 7,
          frames,
          timestamps,
        })
      )
    );
    expect(be.fps).toBe(7);
    be.close();
  });
});

// ---------------------------------------------------------------------------
// Compressed
// ---------------------------------------------------------------------------

describe("SeqVideoBackend — compressed index scan", () => {
  it("scans variable-length frames and reads timestamps", async () => {
    const payloads = [fakeJpeg(20, 1), fakeJpeg(30, 2), fakeJpeg(25, 3)];
    const bytes = buildCompressed({
      width: 4,
      height: 4,
      imageFormat: 201,
      version: 4,
      fps: 30,
      numFramesHeader: 3,
      payloads,
      timestamps: [
        { sec: 1, ms: 0 },
        { sec: 1, ms: 20 },
        { sec: 1, ms: 40 },
      ],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    expect(be.numFrames).toBe(3);
    expect(be.shape[0]).toBe(3);
    expect(await be.getTimestamp(0)).toBeCloseTo(1.0, 6);
    expect(await be.getTimestamp(2)).toBeCloseTo(1.04, 6);
    be.close();
  });
});

describe("SeqVideoBackend — compressed PNG decode", () => {
  it("decodes a real PNG frame to pixels", async () => {
    const png = await encodePng(2, 1, [10, 20, 30]);
    const bytes = buildCompressed({
      width: 2,
      height: 1,
      imageFormat: 2, // png
      version: 4,
      fps: 30,
      numFramesHeader: 1,
      payloads: [png],
      timestamps: [{ sec: 1, ms: 0 }],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    expect(be.numFrames).toBe(1);
    const img = (await be.getFrame(0)) as ImageData;
    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect(px(img, 0, 0)).toEqual([10, 20, 30, 255]);
    be.close();
  });
});

describe("SeqVideoBackend — compressed JPEG decode", () => {
  it("decodes a real color JPEG frame to pixels (within lossy tolerance)", async () => {
    const jpeg = await encodeJpeg(4, 2, [200, 100, 50]);
    const bytes = buildCompressed({
      width: 4,
      height: 2,
      imageFormat: 201, // jpg (color)
      version: 4,
      fps: 30,
      numFramesHeader: 1,
      payloads: [jpeg],
      timestamps: [{ sec: 1, ms: 0 }],
    });
    const be = await SeqVideoBackend.create(blobOf(bytes));
    const img = (await be.getFrame(0)) as ImageData;
    expect(img.width).toBe(4);
    expect(img.height).toBe(2);
    const [r, g, b, a] = px(img, 0, 0);
    expect(Math.abs(r - 200)).toBeLessThan(12);
    expect(Math.abs(g - 100)).toBeLessThan(12);
    expect(Math.abs(b - 50)).toBeLessThan(12);
    expect(a).toBe(255);
    be.close();
  });
});

// ---------------------------------------------------------------------------
// Errors & factory routing
// ---------------------------------------------------------------------------

describe("SeqVideoBackend — errors", () => {
  it("rejects Bayer codecs", async () => {
    const bytes = buildCompressed({
      width: 2,
      height: 2,
      imageFormat: 101, // brgb8 (bayer)
      version: 4,
      fps: 30,
      numFramesHeader: 1,
      payloads: [fakeJpeg(20, 1)],
      timestamps: [{ sec: 1, ms: 0 }],
    });
    await expect(SeqVideoBackend.create(blobOf(bytes))).rejects.toThrow("Bayer");
  });

  it("rejects a missing file path", async () => {
    const missing = path.join(os.tmpdir(), "seq-does-not-exist-xyz123.seq");
    await expect(SeqVideoBackend.create(missing)).rejects.toThrow();
  });
});

describe("loadVideo with a .seq path (node:fs byte source)", () => {
  it("routes .seq through the SeqVideo backend from a file path", async () => {
    const f0 = new Uint8Array([11, 22, 33, 44]);
    const f1 = new Uint8Array([55, 66, 77, 88]);
    const bytes = buildUncompressed({
      width: 2,
      height: 2,
      color: false,
      version: 4,
      fps: 30,
      frames: [f0, f1],
      timestamps: [
        { sec: 2000, ms: 0 },
        { sec: 2000, ms: 33 },
      ],
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seq-test-"));
    const file = path.join(dir, "recording.seq");
    fs.writeFileSync(file, bytes);
    try {
      const video = await loadVideo(file);
      expect(video.shape).toEqual([2, 2, 2, 1]);
      const img = (await video.getFrame(0)) as ImageData;
      expect(px(img, 0, 0)).toEqual([11, 11, 11, 255]);
      expect(px(img, 1, 1)).toEqual([44, 44, 44, 255]);
      video.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
