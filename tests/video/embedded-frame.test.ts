import { describe, it, expect } from "../bun-test";
import {
  type EmbeddedFrameReader,
  type Hdf5Slice,
  PNG_MAGIC,
  JPEG_MAGIC,
  asUint8Array,
  classifyLayout,
  computeOffsetsFromSizes,
  findEncodedFrameOffsets,
  readEmbeddedFrameBytes,
  rowSlice,
  trimPaddedRow,
} from "../../src/video/embedded-frame.js";
import { Hdf5VideoBackend } from "../../src/video/hdf5-video.js";
import { getH5Module, ensureH5StagingDir, openH5File } from "../../src/codecs/slp/h5.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));

// ---------------------------------------------------------------------------
// Test doubles for the shared reader
// ---------------------------------------------------------------------------

/** An int8 view over the given byte values — mimics h5wasm dtype `<b`. */
function int8(bytes: number[]): Int8Array {
  return new Int8Array(Uint8Array.from(bytes).buffer);
}

function fakeReader(opts: {
  shape: number[];
  frameCount: number;
  format: string;
  frameSizes?: number[];
  onSlice: (slice: Hdf5Slice | undefined) => unknown;
}): { reader: EmbeddedFrameReader; calls: Array<Hdf5Slice | undefined> } {
  const calls: Array<Hdf5Slice | undefined> = [];
  const reader: EmbeddedFrameReader = {
    frameCount: opts.frameCount,
    format: opts.format,
    frameSizes: opts.frameSizes,
    legacy: { whole: null, offsets: null },
    getMeta: async () => ({ shape: opts.shape, dtype: "<b" }),
    readSlice: async (slice?: Hdf5Slice) => {
      calls.push(slice);
      return { value: opts.onSlice(slice), shape: opts.shape };
    },
  };
  return { reader, calls };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("embedded-frame helpers", () => {
  it("classifies layouts from shape + frame count", () => {
    expect(classifyLayout([3, 100], 3)).toBe("padded");
    expect(classifyLayout([3, 100], 0)).toBe("padded");
    expect(classifyLayout([5], 5)).toBe("vlen"); // length == frame count
    expect(classifyLayout([5000], 5)).toBe("concat"); // length >> frame count
    expect(classifyLayout([5], 0)).toBe("ambiguous1d"); // unknown count
  });

  it("rowSlice selects only the first dim", () => {
    expect(rowSlice([3, 100], 1)).toEqual([[1, 2], [0, 100]]);
    expect(rowSlice([3, 4, 5], 2)).toEqual([[2, 3], [0, 4], [0, 5]]);
  });

  it("computeOffsetsFromSizes is a cumulative sum", () => {
    expect(computeOffsetsFromSizes([10, 20, 5])).toEqual([0, 10, 30]);
  });

  it("trimPaddedRow strips trailing zeros (PNG/JPEG never end in 0x00)", () => {
    const row = Uint8Array.from([1, 2, 3, 0, 0, 0]);
    expect(Array.from(trimPaddedRow(row))).toEqual([1, 2, 3]);
  });

  it("trimPaddedRow uses an exact size when provided", () => {
    const row = Uint8Array.from([1, 2, 3, 4, 5]); // no trailing zeros
    expect(Array.from(trimPaddedRow(row, 2))).toEqual([1, 2]);
  });

  it("asUint8Array reinterprets int8 bytes as unsigned", () => {
    const i8 = int8([0x89, 0xff, 0x00, 0x50]);
    const u8 = asUint8Array(i8)!;
    expect(Array.from(u8)).toEqual([0x89, 0xff, 0x00, 0x50]);
  });

  it("findEncodedFrameOffsets uses indexed compare + exits at expected count", () => {
    const frameA = Uint8Array.from([...PNG_MAGIC, 1, 2]);
    const frameB = Uint8Array.from([...PNG_MAGIC, 3, 4, 5]);
    const buf = Uint8Array.from([...frameA, ...frameB]);
    expect(findEncodedFrameOffsets(buf, "png", 2)).toEqual([0, frameA.length]);
  });
});

// ---------------------------------------------------------------------------
// readEmbeddedFrameBytes — layout-aware single-frame slicing
// ---------------------------------------------------------------------------

describe("readEmbeddedFrameBytes", () => {
  it("padded 2D: slices one row, trims padding, reinterprets int8", async () => {
    const M = 8;
    const { reader, calls } = fakeReader({
      shape: [3, M],
      frameCount: 3,
      format: "png",
      onSlice: () => int8([0x89, 0x50, 0x4e, 0x47, 0x01, 0, 0, 0]), // 5 real + 3 pad
    });
    const out = await readEmbeddedFrameBytes(reader, 1);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x01]);
    // Exactly one slice, targeting only row 1 — never the whole dataset.
    expect(calls).toEqual([[[1, 2], [0, M]]]);
  });

  it("padded 2D: trims to frame_sizes[index] when present", async () => {
    const { reader } = fakeReader({
      shape: [2, 10],
      frameCount: 2,
      format: "jpg",
      frameSizes: [4, 7],
      onSlice: () => int8(new Array(10).fill(0xff)), // no trailing zeros
    });
    const out = await readEmbeddedFrameBytes(reader, 0);
    expect(out!.length).toBe(4);
  });

  it("concat 1D + frame_sizes: byte-range slice, no whole read", async () => {
    const { reader, calls } = fakeReader({
      shape: [30],
      frameCount: 2, // != 30 -> concat
      format: "png",
      frameSizes: [10, 20],
      onSlice: (slice) => {
        expect(slice).toEqual([[10, 30]]);
        return new Uint8Array(20).fill(7);
      },
    });
    const out = await readEmbeddedFrameBytes(reader, 1);
    expect(out!.length).toBe(20);
    expect(calls.length).toBe(1);
  });

  it("vlen: reads the whole dataset once and caches it (h5wasm vlen hyperslab is unsafe)", async () => {
    // h5wasm's single-element hyperslab slice of a variable-length dataset is
    // memory-unsafe: selecting a SUBSET of the global-heap-backed elements
    // throws "memory access out of bounds" (browser worker) / aborts (Node),
    // intermittently, depending on heap state. Reading the WHOLE dataset (all
    // elements) is reliable. So vlen must read whole + cache, never sub-slice.
    const blobs = [int8([0x89, 0x50, 0x01]), int8([0x89, 0x50, 0x02]), int8([0x89, 0x50, 0x03])];
    const { reader, calls } = fakeReader({
      shape: [3],
      frameCount: 3, // == length -> vlen
      format: "png",
      onSlice: (slice) => {
        // A sub-range hyperslab is exactly what crashes h5wasm — never attempt it.
        if (slice !== undefined) throw new Error("memory access out of bounds");
        return blobs; // whole read returns every blob, reliably
      },
    });
    expect(Array.from((await readEmbeddedFrameBytes(reader, 0))!)).toEqual([0x89, 0x50, 0x01]);
    expect(Array.from((await readEmbeddedFrameBytes(reader, 2))!)).toEqual([0x89, 0x50, 0x03]);
    // Whole dataset read exactly once (cached across frames); no sub-slice.
    expect(calls).toEqual([undefined]);
  });

  it("legacy fallback: 1D concat without frame_sizes scans once and caches", async () => {
    const frameA = Uint8Array.from([...PNG_MAGIC, 11, 22]);
    const frameB = Uint8Array.from([...PNG_MAGIC, 33, 44, 55]);
    const whole = Uint8Array.from([...frameA, ...frameB]);
    const { reader, calls } = fakeReader({
      shape: [whole.length],
      frameCount: 2, // != length -> concat; no frameSizes -> fallback
      format: "png",
      onSlice: (slice) => {
        expect(slice).toBeUndefined(); // whole-dataset read
        return whole;
      },
    });
    const a = await readEmbeddedFrameBytes(reader, 0);
    const b = await readEmbeddedFrameBytes(reader, 1);
    expect(Array.from(a!)).toEqual(Array.from(frameA));
    expect(Array.from(b!)).toEqual(Array.from(frameB));
    // The whole buffer is read once and reused, not re-read per frame.
    expect(calls.length).toBe(1);
  });

  it("ambiguous 1D (unknown frame count) resolves a vlen array", async () => {
    const { reader } = fakeReader({
      shape: [2],
      frameCount: 0, // unknown
      format: "png",
      onSlice: (slice) => {
        expect(slice).toBeUndefined();
        return [int8([1, 2]), int8([3, 4, 5])];
      },
    });
    const out = await readEmbeddedFrameBytes(reader, 1);
    expect(Array.from(out!)).toEqual([3, 4, 5]);
  });

  it("ambiguous 1D (unknown frame count) resolves a contiguous buffer via magic scan", async () => {
    const frameA = Uint8Array.from([...PNG_MAGIC, 0xaa]);
    const frameB = Uint8Array.from([...PNG_MAGIC, 0xbb, 0xcc]);
    const whole = Uint8Array.from([...frameA, ...frameB]);
    const { reader, calls } = fakeReader({
      shape: [whole.length],
      frameCount: 0, // unknown -> ambiguous1d
      format: "png",
      onSlice: (slice) => {
        expect(slice).toBeUndefined();
        return whole; // TypedArray -> magic-scan branch
      },
    });
    expect(Array.from((await readEmbeddedFrameBytes(reader, 0))!)).toEqual(Array.from(frameA));
    expect(Array.from((await readEmbeddedFrameBytes(reader, 1))!)).toEqual(Array.from(frameB));
    expect(calls.length).toBe(1); // read whole once, cached
  });
});

// ---------------------------------------------------------------------------
// Integration: synthetic 2D-padded fixtures through the real sync backend
// ---------------------------------------------------------------------------

/**
 * Create an in-wasm HDF5 file with a 2D int8 padded `video0/video` dataset and
 * a `frame_numbers` dataset, then reopen it read-only. Returns the h5wasm File
 * plus an access counter proxy so tests can assert slicing vs whole reads.
 */
async function makePaddedFixture(frames: Uint8Array[]): Promise<{
  file: any;
  spy: { value: number; slice: number };
}> {
  const mod: any = await getH5Module();
  await mod.ready;
  ensureH5StagingDir(mod);
  const path = `/tmp/issue135-${Math.floor(performance.now())}-${frames.length}.h5`;
  const N = frames.length;
  const M = Math.max(...frames.map((f) => f.length)) + 8; // guarantee padding
  const flat = new Uint8Array(N * M); // zero-filled => trailing padding
  for (let i = 0; i < N; i++) flat.set(frames[i], i * M);

  const wf = new mod.File(path, "w");
  wf.create_group("video0");
  wf.create_dataset({
    name: "video0/video",
    data: new Int8Array(flat.buffer), // store as signed bytes like Python
    shape: [N, M],
    dtype: "<b",
  });
  wf.create_dataset({
    name: "video0/frame_numbers",
    data: Int32Array.from(frames.map((_, i) => i)),
    shape: [N],
    dtype: "<i4",
  });
  wf.close();

  const rf = new mod.File(path, "r");
  return wrapWithSpy(rf, () => rf.close());
}

/**
 * Wrap an h5wasm File so accesses to a dataset's `.value` (whole read) and
 * `.slice` (hyperslab read) are counted, letting tests assert that slicing —
 * not whole-dataset reads — is used. frame_numbers/frame_sizes are passed
 * through unwrapped (the backend reads those eagerly and small).
 */
function wrapWithSpy(rf: any, close: () => void): { file: any; spy: { value: number; slice: number } } {
  const spy = { value: 0, slice: 0 };
  const file = {
    get(p: string) {
      const ds = rf.get(p);
      if (!ds || p.endsWith("frame_numbers") || p.endsWith("frame_sizes")) return ds;
      return new Proxy(ds, {
        get(target, prop, recv) {
          if (prop === "value") {
            spy.value++;
            return target.value;
          }
          if (prop === "slice") {
            spy.slice++;
            return target.slice.bind(target);
          }
          return Reflect.get(target, prop, recv);
        },
      });
    },
    keys: () => rf.keys(),
    _close: close,
  };
  return { file, spy };
}

describe("Hdf5VideoBackend single-frame slicing (2D padded)", () => {
  it("slices a PNG frame, trims padding, and never reads the whole dataset", async () => {
    const frameA = Uint8Array.from([...PNG_MAGIC, 0xde, 0xad, 0xbe, 0xef]);
    const frameB = Uint8Array.from([...PNG_MAGIC, 0x01, 0x02]);
    const { file, spy } = await makePaddedFixture([frameA, frameB]);

    const backend = new Hdf5VideoBackend({
      filename: ".",
      file,
      datasetPath: "video0/video",
      frameNumbers: [0, 1],
      format: "png",
      channelOrder: "BGR",
    });

    // Node has no createImageBitmap -> getFrame returns the raw (sliced) bytes.
    const out0 = (await backend.getFrame(0)) as Uint8Array;
    expect(Array.from(out0)).toEqual(Array.from(frameA)); // trimmed, padding gone
    const out1 = (await backend.getFrame(1)) as Uint8Array;
    expect(Array.from(out1)).toEqual(Array.from(frameB));

    // The whole-dataset read path (`dataset.value`) is never taken.
    expect(spy.value).toBe(0);
    expect(spy.slice).toBeGreaterThan(0);

    file._close();
  });

  it("0x89/0xFF bytes round-trip (int8 -> uint8) and JPEG with embedded magic slices exactly", async () => {
    // A JPEG payload that contains the 3-byte JPEG magic (FF D8 FF) mid-stream,
    // which would defeat the old magic-byte scan but is irrelevant to slicing.
    const frame = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, // SOI + APP0
      0x12, 0xff, 0xd8, 0xff, 0x34, // embedded false-positive magic
      0xff, 0xd9, // EOI
    ]);
    const { file, spy } = await makePaddedFixture([frame]);

    const backend = new Hdf5VideoBackend({
      filename: ".",
      file,
      datasetPath: "video0/video",
      frameNumbers: [0],
      format: "jpg",
      channelOrder: "RGB",
    });

    const out = (await backend.getFrame(0)) as Uint8Array;
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual(Array.from(frame)); // exact, padding trimmed
    expect(spy.value).toBe(0);

    file._close();
  });

  it("maps sparse, non-identity frame numbers to the right storage row", async () => {
    const frame10 = Uint8Array.from([...PNG_MAGIC, 0x10, 0x11]);
    const frame20 = Uint8Array.from([...PNG_MAGIC, 0x20, 0x21, 0x22]);
    const { file, spy } = await makePaddedFixture([frame10, frame20]);

    // frame numbers 10 and 20 -> storage indices 0 and 1.
    const backend = new Hdf5VideoBackend({
      filename: ".",
      file,
      datasetPath: "video0/video",
      frameNumbers: [10, 20],
      format: "png",
      channelOrder: "RGB",
    });

    expect(Array.from((await backend.getFrame(20)) as Uint8Array)).toEqual(Array.from(frame20));
    expect(Array.from((await backend.getFrame(10)) as Uint8Array)).toEqual(Array.from(frame10));
    expect(await backend.getFrame(15)).toBeNull(); // not an embedded frame number
    expect(spy.value).toBe(0);

    file._close();
  });
});

describe("Hdf5VideoBackend frame reads (real vlen pkg.slp)", () => {
  it("reads the whole vlen dataset once and caches it (h5wasm vlen hyperslab is unsafe)", async () => {
    const bytes = fs.readFileSync(path.join(fixtureRoot, "slp", "minimal_instance.pkg.slp"));
    const { file: rawFile, close } = await openH5File(new Uint8Array(bytes));
    const { file, spy } = wrapWithSpy(rawFile, close);

    const frameNumbers = Array.from(rawFile.get("video0/frame_numbers").value).map((v: any) => Number(v));
    const backend = new Hdf5VideoBackend({
      filename: ".",
      file,
      datasetPath: "video0/video",
      frameNumbers,
      format: "png",
      channelOrder: "BGR",
    });

    const out = (await backend.getFrame(frameNumbers[0])) as Uint8Array;
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
    // A real PNG blob, read via the whole-dataset path — a per-element vlen
    // hyperslab slice is memory-unsafe in h5wasm, so it is never attempted.
    expect(Array.from(out.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(spy.slice).toBe(0);
    expect(spy.value).toBeGreaterThan(0);

    // A second read is served from cache — the whole dataset is read only once.
    await backend.getFrame(frameNumbers[0]);
    expect(spy.value).toBe(1);

    file._close();
  });
});
