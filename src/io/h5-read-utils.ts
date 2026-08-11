/**
 * Shared, browser-safe HDF5 read helpers.
 *
 * These string/scalar/attribute decoders unify the small primitives that the
 * HDF5-backed readers (`analysis-h5.ts`, `nwb-predictions.ts`, …) all need:
 * h5wasm reports string data as `string` | `Uint8Array` | `number[]` (per
 * element) and attribute values may be plain OR wrapped as `{ value }` depending
 * on the provider, so every reader has to decode/unwrap uniformly.
 *
 * Kept free of Node-only imports so it is safe in the browser bundle.
 */

const textDecoder = new TextDecoder();

/** Minimal h5wasm dataset surface used by the readers. */
export interface H5ReadDataset {
  value: unknown;
  shape?: ArrayLike<number | bigint>;
  attrs?: Record<string, unknown>;
}

/** Minimal h5wasm file surface used by the readers. */
export interface H5ReadFile {
  get(name: string): unknown;
  attrs?: Record<string, unknown>;
}

/**
 * Fetch a dataset by name as a typed {@link H5ReadDataset}.
 *
 * `openH5File`'s `file.get` is typed to return the broad `Entity` union; we cast
 * to the minimal value/shape/attrs surface actually used. Returns null when
 * absent or when the entity carries no `value` (e.g. a group).
 */
export function getDs(
  file: { get(name: string): unknown },
  name: string,
): H5ReadDataset | null {
  const item = file.get(name) as H5ReadDataset | null | undefined;
  if (item == null) return null;
  if (!("value" in item)) return null;
  return item;
}

/** Decode a single h5wasm string element (string | Uint8Array | number[]). */
export function decodeStringElement(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return textDecoder.decode(v);
  if (Array.isArray(v))
    return textDecoder.decode(Uint8Array.from(v as number[]));
  return String(v);
}

/** Decode an h5wasm string dataset `.value` into a string[]. */
export function decodeStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (value instanceof Uint8Array) return [textDecoder.decode(value)];
  if (Array.isArray(value))
    return (value as unknown[]).map(decodeStringElement);
  if (typeof (value as { length?: number }).length === "number") {
    return Array.from(value as ArrayLike<unknown>).map(decodeStringElement);
  }
  return [decodeStringElement(value)];
}

/** Decode an h5wasm scalar string dataset `.value` into a string. */
export function decodeScalarString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return textDecoder.decode(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return decodeStringElement(value[0]);
  }
  return decodeStringElement(value);
}

/** Unwrap an attribute value that may be wrapped as `{ value }`. */
export function unwrapAttr(attr: unknown): unknown {
  if (attr != null && typeof attr === "object" && "value" in (attr as object)) {
    return (attr as { value: unknown }).value;
  }
  return attr;
}

/**
 * Read a numeric attribute, unwrapping a `{ value }` wrapper, taking the first
 * element of an array/typed-array-wrapped scalar, and coercing bigint. Returns
 * undefined when absent or not coercible to a finite number (e.g. a string).
 *
 * Used for integer NWB attrs like `TrainingFrame.source_video_frame_index` and
 * `SkeletonInstance.id`, which providers may report as a number, a bigint, a
 * `{ value }` wrapper, or a length-1 (typed) array.
 */
export function readNumberAttr(
  attrs: Record<string, unknown> | undefined,
  name: string,
): number | undefined {
  if (!attrs || !(name in attrs)) return undefined;
  let raw: unknown = unwrapAttr(attrs[name]);
  if (raw != null && ArrayBuffer.isView(raw) && !(raw instanceof DataView)) {
    const av = raw as unknown as ArrayLike<number | bigint>;
    raw = av.length ? av[0] : undefined;
  } else if (Array.isArray(raw)) {
    raw = raw.length ? raw[0] : undefined;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "bigint") return Number(raw);
  return undefined;
}

/**
 * Read a string attribute, decoding bytes if needed. Returns undefined if
 * absent.
 */
export function readStringAttr(
  attrs: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!attrs || !(name in attrs)) return undefined;
  const raw = unwrapAttr(attrs[name]);
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) return textDecoder.decode(raw);
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "";
    return decodeStringElement(raw[0]);
  }
  return String(raw);
}
