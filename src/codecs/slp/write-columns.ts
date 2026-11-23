/**
 * Writing the tables of SLP format 3.0: groups of 1-D columns.
 *
 * Format 3.0 (Python sleap-io 0.10) stores every table as a group with one
 * 1-D dataset per column, its strings in variable-length UTF-8 datasets and
 * its byte buffers inside the group. The column types follow Python's raw
 * record layouts (`_TABLE_SPECS`, `RAW_*_DTYPE` in `sleap_io/io/slp.py`),
 * except that h5wasm cannot write HDF5 booleans: flags are written as `uint8`,
 * which Python's reading rules accept ("any numeric dtype is accepted").
 *
 * Record metadata (`<table>/metadata/<key>/{values,present}`) follows
 * Python's kinds and placeholders. A boolean key is written as `uint8` with
 * the attribute `kind = "bool"`, which this library's readers honour; Python
 * sleap-io reads such a key as the integers 0 and 1.
 */

import type {
  MetadataColumn,
  MetadataKind,
  RecordMetadata,
} from "../../model/record-metadata.js";
import type { CarriedColumn } from "./column-carry.js";

// h5wasm reads only the type character of a dtype string: `<q` is int64,
// `<d` float64, `<B` uint8 (see the note above INSTANCE_COMPOUND_FIELDS in
// write.ts).

/** A column type, as Python names it. */
export type ColumnType = "u1" | "bool" | "i4" | "i8" | "f4" | "f8" | "str";

const H5_DTYPES: Record<ColumnType, string> = {
  u1: "<B",
  bool: "<B",
  i4: "<i",
  i8: "<q",
  f4: "<f",
  f8: "<d",
  str: "S",
};

/** One column to write: its name, values (one per row) and type. */
export interface Column {
  name: string;
  values: ArrayLike<number> | readonly string[] | ArrayLike<bigint>;
  type: ColumnType;
}

/** Rows per chunk of a resizable column. */
const CHUNK_ROWS = 8192;

/** The attribute that marks a `uint8` metadata column as boolean. */
export const METADATA_KIND_ATTR = "kind";

// biome-ignore lint/suspicious/noExplicitAny: h5wasm File / Group
type H5Parent = any;

/** Whether `path` exists in `file`, as a group or dataset. */
function exists(file: H5Parent, path: string): boolean {
  try {
    return !!file.get(path);
  } catch {
    return false;
  }
}

/** Create the group `path` (and its parents) unless it exists. */
export function ensureGroup(file: H5Parent, path: string): void {
  let prefix = "";
  for (const part of path.split("/")) {
    prefix = prefix ? `${prefix}/${part}` : part;
    if (!exists(file, prefix)) file.create_group(prefix);
  }
}

/**
 * Values as the typed array h5wasm writes for `dtype` (a dtype string such as
 * `<q`), or a string array for `S`.
 */
export function typedValues(
  values: ArrayLike<number> | readonly string[] | ArrayLike<bigint>,
  dtype: string,
): ArrayLike<number> | string[] | BigInt64Array | BigUint64Array {
  const char = dtype.replace(/^[<>|=]/, "")[0];
  const n = values.length;
  switch (char) {
    case "S":
    case "A":
      return Array.from(values as ArrayLike<unknown>, (v) =>
        v === null || v === undefined ? "" : String(v),
      );
    case "q":
    case "Q": {
      const out = char === "q" ? new BigInt64Array(n) : new BigUint64Array(n);
      for (let i = 0; i < n; i += 1) {
        const v = (values as ArrayLike<unknown>)[i];
        out[i] =
          typeof v === "bigint"
            ? v
            : BigInt(Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
      }
      return out;
    }
    case "d":
      return Float64Array.from(values as ArrayLike<number>, Number);
    case "f":
      return Float32Array.from(values as ArrayLike<number>, Number);
    case "i":
      return Int32Array.from(values as ArrayLike<number>, Number);
    case "I":
      return Uint32Array.from(values as ArrayLike<number>, Number);
    case "h":
      return Int16Array.from(values as ArrayLike<number>, Number);
    case "H":
      return Uint16Array.from(values as ArrayLike<number>, Number);
    case "b":
      return Int8Array.from(values as ArrayLike<number>, Number);
    case "B":
      return Uint8Array.from(values as ArrayLike<number>, Number);
    default:
      throw new Error(`cannot write a column of dtype ${dtype}`);
  }
}

/**
 * Write one 1-D dataset at `path`. A resizable dataset is chunked with an
 * unlimited first dimension (Python writes the link and session columns so).
 */
export function writeDataset(
  file: H5Parent,
  path: string,
  values: ArrayLike<number> | readonly string[] | ArrayLike<bigint>,
  dtype: string,
  options?: { resizable?: boolean },
): void {
  const n = values.length;
  const data = typedValues(values, dtype);
  if (options?.resizable && dtype !== "S") {
    file.create_dataset({
      name: path,
      data,
      shape: [n],
      maxshape: [null],
      chunks: [Math.max(1, Math.min(CHUNK_ROWS, n))],
      dtype,
    });
  } else {
    file.create_dataset({ name: path, data, shape: [n], dtype });
  }
}

/**
 * Write a table as a group of 1-D columns, then any `carried` unknown columns
 * (written as they were read). Creates the group if needed.
 */
export function writeColumnTable(
  file: H5Parent,
  path: string,
  columns: readonly Column[],
  options?: {
    resizable?: boolean;
    carried?: Readonly<Record<string, CarriedColumn>>;
  },
): void {
  ensureGroup(file, path);
  const known = new Set<string>();
  for (const column of columns) {
    known.add(column.name);
    writeDataset(
      file,
      `${path}/${column.name}`,
      column.values,
      H5_DTYPES[column.type],
      options,
    );
  }
  for (const [name, column] of Object.entries(options?.carried ?? {})) {
    if (known.has(name)) continue;
    if (column.shape && column.shape.length > 1) {
      // A column of rank 2 or more: its rows keep their shape.
      const rows =
        column.values.length / column.shape.slice(1).reduce((a, b) => a * b, 1);
      const shape = [rows, ...column.shape.slice(1)];
      const data = typedValues(column.values, column.dtype);
      if (options?.resizable) {
        file.create_dataset({
          name: `${path}/${name}`,
          data,
          shape,
          maxshape: [null, ...shape.slice(1)],
          chunks: [Math.max(1, Math.min(CHUNK_ROWS, rows)), ...shape.slice(1)],
          dtype: column.dtype,
        });
      } else {
        file.create_dataset({
          name: `${path}/${name}`,
          data,
          shape,
          dtype: column.dtype,
        });
      }
      continue;
    }
    writeDataset(file, `${path}/${name}`, column.values, column.dtype, options);
  }
}

/**
 * Write a flat `uint8` byte buffer inside a table group. A non-empty buffer is
 * chunked, and gzip-compressed (level 1) when `gzip`; an empty one is
 * contiguous, as Python writes it.
 */
export function writeByteBuffer(
  file: H5Parent,
  path: string,
  bytes: Uint8Array,
  gzip: boolean,
): void {
  if (bytes.length > 0) {
    file.create_dataset({
      name: path,
      data: bytes,
      shape: [bytes.length],
      dtype: "<B",
      chunks: [bytes.length],
      ...(gzip ? { compression: "gzip", compression_opts: 1 } : {}),
    });
  } else {
    file.create_dataset({ name: path, data: bytes, shape: [0], dtype: "<B" });
  }
}

// ---- Record metadata --------------------------------------------------------

/** The kind of one metadata value, or `null` for a missing one. */
function valueKind(value: unknown): MetadataKind | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return "str";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (typeof value === "bigint") return "int";
  return null;
}

/**
 * Build the metadata columns of a table from its records' `metadata`, as
 * Python sleap-io does: one kind per key (`int` and `float` mix as `float`),
 * a placeholder (`false`, `0`, NaN or `""`) for records lacking the key, and
 * `present` only when some record lacks it. Keys no record holds are not
 * written.
 *
 * @param records One per table row, in row order.
 * @param table The table name, for messages.
 * @param kindOf The kind a key was read as, if known, so a float key whose
 *   values are whole numbers stays float.
 * @throws {TypeError} If a key mixes kinds across records (for example a
 *   boolean and a number), naming the table and key.
 */
export function metadataColumnsOf(
  records: ReadonlyArray<{ metadata?: RecordMetadata | null }>,
  table: string,
  kindOf?: (key: string) => MetadataKind | undefined,
): Record<string, MetadataColumn> {
  const kinds = new Map<string, MetadataKind>();
  for (const record of records) {
    for (const [key, value] of Object.entries(record.metadata ?? {})) {
      const kind = valueKind(value);
      if (kind === null) continue;
      const seen = kinds.get(key);
      if (seen === undefined || seen === kind) {
        kinds.set(key, kind);
      } else if (
        (seen === "int" || seen === "float") &&
        (kind === "int" || kind === "float")
      ) {
        kinds.set(key, "float");
      } else {
        throw new TypeError(
          `The metadata key "${key}" of /${table} holds values of different ` +
            `kinds (${seen} and ${kind}); every record must hold one kind ` +
            "(bool, int, float or str) per key.",
        );
      }
    }
  }
  const out: Record<string, MetadataColumn> = {};
  const n = records.length;
  for (const [key, seenKind] of kinds) {
    const kind =
      seenKind === "int" && kindOf?.(key) === "float" ? "float" : seenKind;
    const present = new Uint8Array(n);
    let values: number[] | string[];
    if (kind === "str") {
      const strings = new Array<string>(n).fill("");
      records.forEach((record, row) => {
        const v = record.metadata?.[key];
        if (v === null || v === undefined) return;
        strings[row] = String(v);
        present[row] = 1;
      });
      values = strings;
    } else {
      const numbers = new Array<number>(n).fill(
        kind === "float" ? Number.NaN : 0,
      );
      records.forEach((record, row) => {
        const v = record.metadata?.[key];
        if (v === null || v === undefined) return;
        numbers[row] = Number(v);
        present[row] = 1;
      });
      values = numbers;
    }
    out[key] = {
      kind,
      values,
      present: present.every((p) => p === 1) ? null : present,
    };
  }
  return out;
}

/** Boolean metadata keys written during {@link withBoolMetadataNotice}. */
let boolKeysWritten: Array<[table: string, key: string]> | null = null;

/**
 * Run a format 3.0 save, then warn once if it wrote boolean metadata: h5wasm
 * cannot write HDF5 booleans, so such keys are stored as `uint8` with
 * `kind = "bool"`, which this library reads back as booleans but Python
 * sleap-io reads as the integers 0 and 1.
 */
export function withBoolMetadataNotice<T>(write: () => T): T {
  const outer = boolKeysWritten;
  boolKeysWritten = [];
  try {
    const out = write();
    const written = boolKeysWritten;
    if (written.length > 0) {
      const byTable = new Map<string, string[]>();
      for (const [table, key] of written) {
        const keys = byTable.get(table) ?? [];
        if (!keys.includes(key)) keys.push(key);
        byTable.set(table, keys);
      }
      const named = [...byTable]
        .map(([table, keys]) => `${table}: ${keys.sort().join(", ")}`)
        .join("; ");
      console.warn(
        `Saving boolean metadata (${named}) in SLP format 3.0 as uint8 ` +
          'values marked kind="bool", since HDF5 booleans cannot be written ' +
          "here. sleap-io.js reads them back as booleans, but Python " +
          "sleap-io reads them as the integers 0 and 1.",
      );
    }
    return out;
  } finally {
    boolKeysWritten = outer;
  }
}

/**
 * Write metadata columns into `<tablePath>/metadata/<key>/{values,present}`.
 * Nothing is written when there are none.
 */
export function writeMetadataColumns(
  file: H5Parent,
  tablePath: string,
  columns: Readonly<Record<string, MetadataColumn>> | null | undefined,
): void {
  const keys = Object.keys(columns ?? {});
  if (keys.length === 0) return;
  ensureGroup(file, `${tablePath}/metadata`);
  for (const key of keys) {
    const column = (columns as Record<string, MetadataColumn>)[key];
    const base = `${tablePath}/metadata/${key}`;
    ensureGroup(file, base);
    const dtype =
      column.kind === "str"
        ? "S"
        : column.kind === "float"
          ? "<d"
          : column.kind === "int"
            ? "<q"
            : "<B";
    const values =
      column.kind === "str"
        ? Array.from(column.values, (v) =>
            v instanceof Uint8Array
              ? new TextDecoder().decode(v).replace(/\0+$/, "")
              : String(v ?? ""),
          )
        : column.kind === "bool"
          ? Array.from(column.values, (v) => (Number(v) ? 1 : 0))
          : Array.from(column.values, (v) => Number(v));
    writeDataset(file, `${base}/values`, values, dtype);
    if (column.kind === "bool") {
      boolKeysWritten?.push([tablePath, key]);
      const ds = file.get(`${base}/values`);
      ds.create_attribute(METADATA_KIND_ATTR, "bool", null, "S4");
    }
    if (column.present) {
      writeDataset(
        file,
        `${base}/present`,
        Array.from(column.present, (v) => (Number(v) ? 1 : 0)),
        "<B",
      );
    }
  }
}
