// Fast columnar read for fixed-size HDF5 compound datasets.
//
// WHY: SLEAP stores `frames`/`instances`/`points`/`pred_points` as HDF5 compound
// datasets. h5wasm's high-level `Dataset.value` materializes a compound dataset
// by allocating, per record, one `Uint8Array.slice` for the row AND one more per
// member (plus a recursive `process_data` call) — ~8 allocations per row. On a
// ~0.9M-point table that is the dominant cost of opening a project (~2s of an
// ~11s open, measured). The record buffer is a single contiguous, uncompressed
// blob, so we read it once through the Emscripten Module and split it into
// per-field columns with one `DataView` pass — ~20x faster and allocation-light.
//
// This mirrors the manual vlen read in `../../video/embedded-frame.ts`
// (`readVlenElementManual`) and reuses the same blessed low-level Module surface
// (`getH5EmscriptenModule`). The upstream h5wasm fix is drafted in
// `scratch/vlen/h5wasm-compound-read.md`.
//
// SAFETY: this is a strict fast path. It returns `null` — and the caller falls
// back to `dataset.value` — for anything it does not fully understand (missing
// Module surface, non-compound dtype, vlen, non-1D shape, or a member whose type
// is not plain int/float/enum). Values are byte-identical to `.value` except
// int64 columns come back as `number` instead of `bigint`; every consumer of
// these columns already routes them through `Number(...)`, and the eager reader's
// own test fixtures exercise the equivalence.

/** HDF5 datatype class ids (`H5Tget_class`). */
const H5T_INTEGER = 0;
const H5T_FLOAT = 1;
const H5T_ENUM = 8;

interface CompoundMember {
  name: string;
  type: number;
  size: number;
  offset: number;
  signed?: boolean;
  littleEndian?: boolean;
}

/** Minimal Emscripten `Module` surface for a raw dataset read. */
export interface H5wasmRawModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  get_dataset_data(
    fileId: unknown,
    path: string,
    count: bigint[],
    offset: bigint[],
    strides: bigint[],
    dataPtr: bigint,
  ): unknown;
}

/** Minimal h5wasm `Dataset` surface for a raw compound read. */
export interface H5wasmStructDataset {
  file_id: unknown;
  path: string;
  metadata?: {
    size?: number;
    shape?: number[];
    vlen?: boolean;
    compound_type?: { members?: CompoundMember[] };
  };
}

function moduleUsable(m: unknown): m is H5wasmRawModule {
  const mm = m as Partial<H5wasmRawModule> | null | undefined;
  return (
    !!mm &&
    typeof mm._malloc === "function" &&
    typeof mm._free === "function" &&
    typeof mm.get_dataset_data === "function" &&
    mm.HEAPU8 instanceof Uint8Array
  );
}

/**
 * Read a fixed-size 1-D compound dataset as `{ [memberName]: value[] }`, reading
 * the whole record blob once and splitting it into columns with a single
 * `DataView` pass. Returns `null` (caller should fall back to `dataset.value`)
 * whenever the dataset is not a plain-numeric compound this path can read safely.
 */
export function readCompoundColumnsManual(
  module: unknown,
  dataset: H5wasmStructDataset,
): Record<string, unknown[]> | null {
  if (!moduleUsable(module)) return null;
  const md = dataset.metadata;
  const members = md?.compound_type?.members;
  if (!members || members.length === 0) return null; // not compound
  if (md?.vlen) return null; // vlen inner data — leave to the safe path
  const shape = md?.shape;
  if (!Array.isArray(shape) || shape.length !== 1) return null; // 1-D tables only
  const recSize = md?.size ?? 0;
  if (recSize <= 0) return null;

  // Only plain int/float/enum members are understood; bail on anything else
  // (strings, nested compounds, unusual float widths) so values stay exact.
  for (const m of members) {
    if (m.type !== H5T_INTEGER && m.type !== H5T_FLOAT && m.type !== H5T_ENUM) {
      return null;
    }
    if (m.type === H5T_FLOAT && m.size !== 8 && m.size !== 4) return null;
    if (m.size !== 1 && m.size !== 2 && m.size !== 4 && m.size !== 8)
      return null;
  }

  const nrows = shape[0];
  if (nrows === 0) {
    const empty: Record<string, unknown[]> = {};
    for (const m of members) empty[m.name] = [];
    return empty;
  }

  const nbytes = recSize * nrows;
  const dataPtr = module._malloc(nbytes);
  if (!dataPtr) return null;
  let buf: Uint8Array;
  try {
    // Full read: count=[nrows], offset=[0], strides=[1]. No vlen members, so no
    // reclaim is needed (unlike the sliced-vlen path).
    module.get_dataset_data(
      dataset.file_id,
      dataset.path,
      [BigInt(nrows)],
      [0n],
      [1n],
      BigInt(dataPtr),
    );
    // JS-owned copy — detaches us from later wasm heap growth.
    buf = module.HEAPU8.slice(dataPtr, dataPtr + nbytes);
  } finally {
    module._free(dataPtr);
  }

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cols: Record<string, unknown[]> = {};
  for (const m of members) {
    const col = new Array<number>(nrows);
    const off = m.offset;
    const sz = m.size;
    const isFloat = m.type === H5T_FLOAT;
    // h5wasm reports floats as signed:false; default int/enum to signed (SLEAP's
    // id columns carry -1 sentinels), honoring an explicit signed:false.
    const signed = m.signed !== false;
    const le = m.littleEndian !== false;
    for (let i = 0; i < nrows; i += 1) {
      const p = i * recSize + off;
      let v: number;
      if (isFloat) {
        v = sz === 8 ? dv.getFloat64(p, le) : dv.getFloat32(p, le);
      } else if (sz === 1) {
        v = signed ? dv.getInt8(p) : dv.getUint8(p);
      } else if (sz === 2) {
        v = signed ? dv.getInt16(p, le) : dv.getUint16(p, le);
      } else if (sz === 4) {
        v = signed ? dv.getInt32(p, le) : dv.getUint32(p, le);
      } else {
        v = Number(signed ? dv.getBigInt64(p, le) : dv.getBigUint64(p, le));
      }
      col[i] = v;
    }
    cols[m.name] = col;
  }
  return cols;
}
