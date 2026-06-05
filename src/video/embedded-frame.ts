/**
 * Shared helpers for reading a single embedded frame out of an HDF5 video
 * dataset without materializing (and caching) the whole per-video dataset.
 *
 * Used by both the synchronous {@link Hdf5VideoBackend} (Node/Bun) and the
 * streaming {@link StreamingHdf5VideoBackend} (browser Web Worker) so the two
 * stay in lockstep. See issue #135 for the motivation and measurements: reading
 * the entire dataset to display one frame took 0.5–3.3 s per video switch and
 * retained tens of MB per video; slicing one frame takes ~tens of ms and retains
 * effectively nothing.
 *
 * Supported storage layouts (classified from the dataset shape + embedded frame
 * count, never from `video.shape`):
 *  - `padded`  — 2D `[N, M]` (Python writer): row `i` is one encoded image plus
 *                trailing zero padding. Slice row `i`, trim the padding.
 *  - `vlen`    — 1D `[N]` variable-length blobs (legacy pkg.slp): element `i` is
 *                one encoded image. h5wasm slices a single element directly.
 *  - `concat`  — 1D `[totalBytes]` (JS writer): all frames concatenated. Needs
 *                `frame_sizes` to byte-range slice; otherwise the legacy
 *                magic-byte scan fallback applies.
 *
 * @module
 */

/** A hyperslab selection: one `[start, stop]` pair (or `[]` = full) per dim. */
export type Hdf5Slice = Array<[number, number] | []>;

// PNG magic bytes: 0x89 P N G \r \n 0x1A \n
export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// JPEG magic bytes: 0xFF 0xD8 0xFF
export const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);

/** Whether a format string denotes an encoded image (PNG/JPEG) vs raw pixels. */
export function isEncodedFormat(format: string): boolean {
  const n = format.toLowerCase();
  return n === "png" || n === "jpg" || n === "jpeg";
}

/** Magic-byte signature for an encoded format (defaults to JPEG when unknown). */
export function magicFor(format: string): Uint8Array {
  return format.toLowerCase() === "png" ? PNG_MAGIC : JPEG_MAGIC;
}

/**
 * Whether `magic` appears at `pos` in `buffer`, using an indexed compare.
 *
 * This deliberately avoids `buffer.subarray(pos)` (which allocates a throwaway
 * view at every byte position — the ~30× self-inflicted cost in the old scan).
 */
export function matchesMagicAt(buffer: Uint8Array, pos: number, magic: Uint8Array): boolean {
  if (pos + magic.length > buffer.length) return false;
  for (let k = 0; k < magic.length; k++) {
    if (buffer[pos + k] !== magic[k]) return false;
  }
  return true;
}

/** Whether the buffer starts with a PNG or JPEG signature. */
export function startsWithImageMagic(buffer: Uint8Array): boolean {
  return matchesMagicAt(buffer, 0, PNG_MAGIC) || matchesMagicAt(buffer, 0, JPEG_MAGIC);
}

/**
 * Scan a contiguous buffer for encoded-frame start offsets.
 *
 * Used only by the legacy fallback (1D concatenated buffer without
 * `frame_sizes`). Uses the indexed compare and exits once `expectedFrameCount`
 * frames are found. NOTE: the 3-byte JPEG magic can occur inside entropy-coded
 * data, so this is only reliable for PNG; prefer `frame_sizes` / slicing.
 */
export function findEncodedFrameOffsets(
  buffer: Uint8Array,
  format: string,
  expectedFrameCount: number
): number[] {
  const magic = magicFor(format);
  const m0 = magic[0];
  const L = magic.length;
  const limit = buffer.length - L;
  const offsets: number[] = [];
  for (let i = 0; i <= limit; i++) {
    if (buffer[i] !== m0) continue;
    let ok = true;
    for (let k = 1; k < L; k++) {
      if (buffer[i + k] !== magic[k]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    offsets.push(i);
    i += L - 1;
    if (expectedFrameCount > 0 && offsets.length >= expectedFrameCount) break;
  }
  return offsets;
}

/** Cumulative byte offsets from per-frame sizes (valid for `concat` only). */
export function computeOffsetsFromSizes(sizes: number[]): number[] {
  const offsets: number[] = new Array(sizes.length);
  let off = 0;
  for (let i = 0; i < sizes.length; i++) {
    offsets[i] = off;
    off += sizes[i];
  }
  return offsets;
}

/**
 * Trim a sliced 2D padded row (one encoded image + trailing zero padding) down
 * to just the encoded image bytes.
 *
 * When the exact byte length is known (`frame_sizes`) it is used directly.
 * Otherwise trailing zero bytes are stripped — valid because PNG streams end in
 * the IEND CRC (`…0x60 0x82`) and JPEG streams end in EOI (`0xFF 0xD9`), so an
 * encoded image never ends in `0x00`; any trailing zeros are pure padding.
 */
export function trimPaddedRow(row: Uint8Array, size?: number): Uint8Array {
  if (size != null && size >= 0 && size <= row.length) {
    return size === row.length ? row : row.subarray(0, size);
  }
  let end = row.length;
  while (end > 0 && row[end - 1] === 0) end--;
  return end === row.length ? row : row.subarray(0, end);
}

/** Storage layout of an embedded-image dataset. */
export type EmbeddedLayout = "padded" | "vlen" | "concat" | "ambiguous1d";

/**
 * Classify the dataset layout from its shape and the embedded frame count.
 *
 * A 2D+ dataset is always `padded` (slice the first dim). A 1D dataset whose
 * length equals the embedded frame count is `vlen` (one blob per element);
 * otherwise it is `concat` (bytes). When the frame count is unknown the 1D case
 * is `ambiguous1d` and must be resolved by reading the value.
 */
export function classifyLayout(shape: number[], frameCount: number): EmbeddedLayout {
  if (shape.length >= 2) return "padded";
  if (shape.length === 1) {
    if (frameCount > 0) return shape[0] === frameCount ? "vlen" : "concat";
    return "ambiguous1d";
  }
  return "ambiguous1d";
}

/** Build a hyperslab slice selecting only row `index` along the first dim. */
export function rowSlice(shape: number[], index: number): Hdf5Slice {
  return shape.map(
    (dim, d) => (d === 0 ? [index, index + 1] : [0, dim]) as [number, number]
  );
}

/**
 * Reinterpret a value read from HDF5 as a `Uint8Array` view without copying when
 * possible. Crucially this reinterprets the bytes of an `Int8Array` (h5wasm
 * dtype `<b`) as unsigned, matching how the image bytes were originally written.
 */
export function asUint8Array(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const v = value as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value as number[]);
  }
  if (typeof value === "object" && "buffer" in (value as Record<string, unknown>)) {
    return new Uint8Array((value as { buffer: ArrayBuffer }).buffer);
  }
  return null;
}

/** Result of reading a (possibly sliced) dataset value. */
export interface SliceReadResult {
  value: unknown;
  shape: number[];
}

/** Mutable per-backend cache for the legacy whole-buffer fallback path. */
export interface LegacyFrameCache {
  whole: Uint8Array | unknown[] | null;
  offsets: number[] | null;
}

/**
 * The minimal capabilities a backend must provide for {@link readEmbeddedFrameBytes}.
 */
export interface EmbeddedFrameReader {
  /** Number of embedded frames (length of `frame_numbers`); 0 if unknown. */
  frameCount: number;
  /** Image format ("png" | "jpg" | "jpeg" | raw). */
  format: string;
  /** Per-frame byte sizes when available (enables exact byte-range slicing). */
  frameSizes?: number[];
  /** Read dataset metadata (cheap; the caller should memoize across frames). */
  getMeta(): Promise<{ shape: number[]; dtype: string }>;
  /** Read a hyperslab slice; omit `slice` to read the whole dataset. */
  readSlice(slice?: Hdf5Slice): Promise<SliceReadResult>;
  /** Mutable cache shared across calls for the legacy fallback path. */
  legacy: LegacyFrameCache;
}

/**
 * Read the raw bytes (encoded image or raw pixels) of the embedded frame stored
 * at `index`, slicing only that frame from the dataset wherever the layout
 * allows. Returns `null` if the frame cannot be located.
 */
export async function readEmbeddedFrameBytes(
  reader: EmbeddedFrameReader,
  index: number
): Promise<Uint8Array | null> {
  if (index < 0) return null;
  const meta = await reader.getMeta();
  const shape = meta.shape ?? [];
  const layout = classifyLayout(shape, reader.frameCount);
  const encoded = isEncodedFormat(reader.format);

  // 2D padded (and N-D raw): slice the requested row only.
  if (layout === "padded") {
    const { value } = await reader.readSlice(rowSlice(shape, index));
    const row = asUint8Array(value);
    if (!row) return null;
    // Raw pixels are trimmed downstream by decodeRawFrame using the shape.
    return encoded ? trimPaddedRow(row, reader.frameSizes?.[index]) : row;
  }

  // vlen: read the WHOLE dataset once and index into the cached blob array.
  //
  // h5wasm's hyperslab *sub-selection* of a variable-length dataset is
  // memory-unsafe: requesting a single element (`[[index, index+1]]`) selects a
  // subset of the global-heap-backed blobs and intermittently throws "memory
  // access out of bounds" (browser Web Worker) or aborts the WASM runtime
  // (Node), depending on heap state. Reading the whole dataset (`dataset.value`,
  // all elements) goes through a different, reliable code path. This costs one
  // video's worth of embedded images in memory (cached on `reader.legacy.whole`,
  // freed on backend `close()`) — the per-frame slice optimization from #135
  // simply does not apply to vlen, where slicing is broken. Legacy pkg.slp files
  // (older PyQt SLEAP) use this layout; without this, getFrame returns null and
  // the frame renders black.
  if (layout === "vlen") {
    if (!reader.legacy.whole) {
      const { value } = await reader.readSlice();
      reader.legacy.whole = Array.isArray(value) ? value : [];
    }
    const whole = reader.legacy.whole;
    return Array.isArray(whole) ? asUint8Array(whole[index]) : null;
  }

  // 1D concatenated with known sizes: exact byte-range slice.
  if (layout === "concat" && reader.frameSizes && reader.frameSizes.length > index) {
    const offsets = (reader.legacy.offsets ??= computeOffsetsFromSizes(reader.frameSizes));
    const start = offsets[index];
    const end = start + reader.frameSizes[index];
    const { value } = await reader.readSlice([[start, end]]);
    return asUint8Array(value);
  }

  // Legacy fallback: read the whole dataset once, cache it, and index into it.
  // Covers 1D concatenated without frame_sizes (magic-byte scan) and the
  // ambiguous 1D case (which may resolve to a vlen array).
  if (!reader.legacy.whole) {
    const { value } = await reader.readSlice();
    if (Array.isArray(value)) {
      reader.legacy.whole = value;
    } else {
      const buf = asUint8Array(value);
      if (!buf) return null;
      reader.legacy.whole = buf;
      if (encoded && startsWithImageMagic(buf)) {
        reader.legacy.offsets = findEncodedFrameOffsets(buf, reader.format, reader.frameCount);
      }
    }
  }

  const whole = reader.legacy.whole;
  if (Array.isArray(whole)) {
    return asUint8Array(whole[index]);
  }
  const buf = whole as Uint8Array;
  const offsets = reader.legacy.offsets;
  if (offsets && offsets.length > index) {
    const start = offsets[index];
    const end = index + 1 < offsets.length ? offsets[index + 1] : buf.length;
    return buf.slice(start, end);
  }
  return null;
}
