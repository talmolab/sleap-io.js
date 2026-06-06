import { describe, it, expect } from "../bun-test";
import {
  type EmbeddedFrameReader,
  type H5wasmModule,
  type Hdf5Slice,
  PNG_MAGIC,
  JPEG_MAGIC,
  asUint8Array,
  classifyLayout,
  computeOffsetsFromSizes,
  findEncodedFrameOffsets,
  readEmbeddedFrameBytes,
  readVlenElementManual,
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
  /** When provided, the reader exposes `readVlenElement` (the safe vlen path). */
  onVlenElement?: (index: number) => Uint8Array | null;
}): {
  reader: EmbeddedFrameReader;
  calls: Array<Hdf5Slice | undefined>;
  vlenCalls: number[];
} {
  const calls: Array<Hdf5Slice | undefined> = [];
  const vlenCalls: number[] = [];
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
  if (opts.onVlenElement) {
    reader.readVlenElement = async (index: number) => {
      vlenCalls.push(index);
      return opts.onVlenElement!(index);
    };
  }
  return { reader, calls, vlenCalls };
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

  it("vlen: reads the one element via readVlenElement, never slicing", async () => {
    // h5wasm's single-element vlen slice corrupts the heap, so the backend's
    // safe per-element read (readVlenElement) is used and `readSlice` is never
    // called for the vlen layout.
    const blobs = [
      Uint8Array.from([0x89, 0x50, 0x01]),
      Uint8Array.from([0x89, 0x50, 0x02]),
    ];
    const { reader, calls, vlenCalls } = fakeReader({
      shape: [2],
      frameCount: 2, // == 2 -> vlen
      format: "png",
      onSlice: () => {
        throw new Error("readSlice must not be called for vlen when readVlenElement exists");
      },
      onVlenElement: (i) => blobs[i],
    });
    expect(Array.from((await readEmbeddedFrameBytes(reader, 1))!)).toEqual([0x89, 0x50, 0x02]);
    expect(Array.from((await readEmbeddedFrameBytes(reader, 0))!)).toEqual([0x89, 0x50, 0x01]);
    expect(vlenCalls).toEqual([1, 0]);
    expect(calls.length).toBe(0); // no hyperslab slice, no whole read
  });

  it("vlen fallback: no readVlenElement -> whole read once, cached, no per-element slice", async () => {
    // When the backend can't do the manual read (no Module access), the vlen
    // layout falls back to a single whole-dataset read + cache — never the
    // crashing per-element hyperslab slice.
    const blobs = [int8([0x89, 0x50, 0x01]), int8([0x89, 0x50, 0x02]), int8([0x89, 0x50, 0x03])];
    const { reader, calls } = fakeReader({
      shape: [3],
      frameCount: 3, // == length -> vlen
      format: "png",
      onSlice: (slice) => {
        // Only the whole-dataset read (no slice arg) is allowed.
        if (slice !== undefined) throw new Error("vlen fallback must not sub-slice");
        return blobs;
      },
    });
    expect(Array.from((await readEmbeddedFrameBytes(reader, 0))!)).toEqual([0x89, 0x50, 0x01]);
    expect(Array.from((await readEmbeddedFrameBytes(reader, 2))!)).toEqual([0x89, 0x50, 0x03]);
    expect(calls).toEqual([undefined]); // whole read exactly once, then cached
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
// readVlenElementManual — the manual single-element hvl_t read (synthetic heap)
// ---------------------------------------------------------------------------

/**
 * A synthetic Emscripten Module backed by a real ArrayBuffer "heap" and a bump
 * allocator. `get_dataset_data` lays out one element's `hvl_t {len, ptr}` at the
 * destination pointer and copies the blob bytes into the heap, exactly as
 * h5wasm's native read would. Lets us test the hvl_t parsing and — critically —
 * that the inner blob pointer is freed, with no real WASM.
 */
function fakeModule(blobs: Uint8Array[]): {
  Module: H5wasmModule;
  freed: number[];
  malloced: number[];
} {
  const heap = new Uint8Array(1 << 16);
  const u32 = new Uint32Array(heap.buffer);
  let next = 8; // never hand out 0 (it means NULL)
  const freed: number[] = [];
  const malloced: number[] = [];
  const alloc = (n: number): number => {
    const ptr = next;
    next += Math.ceil(n / 8) * 8 || 8; // keep 8-byte alignment for u32 views
    return ptr;
  };
  const Module: H5wasmModule = {
    HEAPU8: heap,
    H5T_class_t: { H5T_VLEN: { value: 9 } },
    _malloc: (n: number) => {
      const ptr = alloc(n);
      malloced.push(ptr);
      return ptr;
    },
    _free: (ptr: number) => {
      freed.push(ptr);
    },
    get_dataset_data: (_fileId, _path, _count, offset, _strides, dataPtr) => {
      const index = Number(offset[0]);
      const blob = blobs[index];
      // The native read allocates the blob on the heap (HDF5's vlen allocator =
      // malloc); record it so the inner-free invariant is meaningful.
      const blobPtr = alloc(blob.length);
      malloced.push(blobPtr);
      heap.set(blob, blobPtr);
      const hvl = Number(dataPtr) >> 2;
      u32[hvl] = blob.length; // len
      u32[hvl + 1] = blobPtr; // ptr
      return 0;
    },
  };
  return { Module, freed, malloced };
}

describe("readVlenElementManual", () => {
  const vlenDs = { file_id: 0, path: "/video0/video", metadata: { size: 8, type: 9 } };

  it("reads one element, copies the bytes, and frees the inner blob + struct", () => {
    const blobs = [
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xaa]),
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xbb, 0xcc]),
    ];
    const { Module, freed, malloced } = fakeModule(blobs);

    const out1 = readVlenElementManual(Module, vlenDs, 1)!;
    expect(Array.from(out1)).toEqual([0x89, 0x50, 0x4e, 0x47, 0xbb, 0xcc]);
    // Everything malloced this call was freed -> no leak (the bug's inner-blob leak).
    expect([...freed].sort()).toEqual([...malloced].sort());

    const out0 = readVlenElementManual(Module, vlenDs, 0)!;
    expect(Array.from(out0)).toEqual([0x89, 0x50, 0x4e, 0x47, 0xaa]);
    // The returned buffer is a copy: mutating the heap must not affect it.
    Module.HEAPU8.fill(0);
    expect(Array.from(out0)).toEqual([0x89, 0x50, 0x4e, 0x47, 0xaa]);
  });

  it("returns an empty array for a null (zero-pointer) element", () => {
    const { Module } = fakeModule([new Uint8Array(0)]);
    const out = readVlenElementManual(Module, vlenDs, 0)!;
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(0);
  });

  it("returns null (falls back) when not a wasm32 vlen dataset", () => {
    const { Module } = fakeModule([Uint8Array.from([1, 2, 3])]);
    // Wrong hvl_t size.
    expect(readVlenElementManual(Module, { file_id: 0, path: "x", metadata: { size: 16, type: 9 } }, 0)).toBeNull();
    // Not the vlen datatype class (and vlen flag false).
    expect(readVlenElementManual(Module, { file_id: 0, path: "x", metadata: { size: 8, type: 0 } }, 0)).toBeNull();
    // No Module.
    expect(readVlenElementManual(null, vlenDs, 0)).toBeNull();
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
  it("reads a vlen element via the manual hvl_t path — neither slice() nor value", async () => {
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
    // A real PNG blob, read via the manual single-element hvl_t path. The crashing
    // high-level slice() is never called, and the whole vlen dataset is never read.
    expect(Array.from(out.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(spy.slice).toBe(0);
    expect(spy.value).toBe(0);

    // Byte-for-byte identical to the same element from the safe whole-dataset read.
    const whole = rawFile.get("video0/video").value as Int8Array[];
    const ref = new Uint8Array(whole[0].buffer, whole[0].byteOffset, whole[0].length);
    expect(out.length).toBe(ref.length);
    expect(Array.from(out.subarray(0, 16))).toEqual(Array.from(ref.subarray(0, 16)));

    file._close();
  });

  // The committed fixture is a synthetic N>1 vlen-of-int8 file (generated with
  // h5py via tests/data/slp/gen_vlen_multiframe_fixture.py — h5wasm can only
  // WRITE vlen strings, so it cannot synthesize this layout at runtime). It
  // faithfully reproduces the abort: a raw `dataset.slice([[i, i+1]])` on it
  // aborts the WASM runtime (verified out-of-band), whereas the manual hvl_t read
  // does not. This is the regression guard for the N>1 case that minimal_instance
  // (N=1) can't cover, since a 1-element slice happens to select the whole dataset.
  it("multi-frame (N>1) vlen: reads every frame via the manual path, byte-identical, flat heap", async () => {
    const bytes = fs.readFileSync(path.join(fixtureRoot, "slp", "vlen_multiframe.pkg.slp"));
    const { file: rawFile, close } = await openH5File(new Uint8Array(bytes));
    const { file, spy } = wrapWithSpy(rawFile, close);

    const ds = rawFile.get("video0/video");
    expect(ds.shape).toEqual([5]); // N>1 vlen (this is what aborts via slice())
    expect(ds.metadata.size).toBe(8); // wasm32 hvl_t
    const whole = ds.value as Int8Array[]; // safe whole-read ground truth (off the raw file)

    const frameNumbers = Array.from(rawFile.get("video0/frame_numbers").value).map((v: any) => Number(v));
    const backend = new Hdf5VideoBackend({
      filename: ".",
      file,
      datasetPath: "video0/video",
      frameNumbers,
      format: "png",
      channelOrder: "RGB",
    });

    // Every frame: a real PNG blob of its own (varying) length, byte-identical to
    // the whole-read — and NO abort (the whole point of the fix).
    for (let i = 0; i < frameNumbers.length; i++) {
      const out = (await backend.getFrame(frameNumbers[i])) as Uint8Array;
      const ref = new Uint8Array(whole[i].buffer, whole[i].byteOffset, whole[i].length);
      expect(Array.from(out.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(out.length).toBe(ref.length);
      expect(Array.from(out)).toEqual(Array.from(ref));
    }
    // Per-element lengths genuinely vary (it is vlen, not 2D-padded/concat).
    expect([...new Set(frameNumbers.map((_, i) => whole[i].length))].length).toBeGreaterThan(1);

    // The crashing high-level slice() is never called, and the whole vlen dataset
    // is never read through the backend — only the manual per-element read.
    expect(spy.slice).toBe(0);
    expect(spy.value).toBe(0);

    // Memory: the manual read frees the inner blob each call, so the wasm heap
    // stays flat across many reads (guards against a reintroduced leak or a
    // whole-dataset read on the hot path).
    const mod: any = await getH5Module();
    const heap0 = mod.Module.HEAPU8.byteLength;
    for (let r = 0; r < 300; r++) await backend.getFrame(frameNumbers[r % frameNumbers.length]);
    expect(mod.Module.HEAPU8.byteLength).toBe(heap0);

    file._close();
  });
});
