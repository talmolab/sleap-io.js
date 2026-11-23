/**
 * Encoding/decoding of `Labels.provenance` and the `/metadata` `json` attribute,
 * shared by every SLP reader (h5wasm eager/lazy, streaming, jsfive lite) and
 * writer. Port of Python sleap-io PR #517 (`read_provenance`,
 * `_encode_metadata_attr`, `_write_provenance_dataset` in `slp.py`).
 *
 * Provenance lives in a top-level `/provenance_json` dataset (one JSON string),
 * which HDF5's 64 KB per-attribute limit does not apply to. It is also mirrored
 * into the `metadata/json` attribute for older readers, but that attribute
 * drops its largest droppable keys when it would exceed the limit, so readers
 * must prefer the dataset.
 *
 * No h5wasm dependency: the lite (jsfive) entry point imports this too.
 */

import { datasetValueToString } from "./parsers.js";

/** Name of the top-level dataset holding the provenance JSON string. */
export const PROVENANCE_DATASET = "provenance_json";

/**
 * Python `METADATA_ATTR_SIZE_LIMIT`: keep the `metadata/json` attribute under
 * HDF5's 64 KiB attribute ceiling, with headroom for the object header and the
 * sibling `format_id` attribute.
 */
export const METADATA_ATTR_SIZE_LIMIT = 64_000;

/**
 * Top-level metadata keys the reader has no other source for, so they are never
 * dropped from the attribute (Python `_METADATA_PROTECTED_KEYS`). `provenance`
 * is stored in `/provenance_json`; the rest are empty placeholders whose data
 * lives in their own datasets.
 */
const METADATA_PROTECTED_KEYS = new Set(["version", "skeletons", "nodes"]);

const textEncoder = new TextEncoder();

function byteLength(s: string): number {
  return textEncoder.encode(s).length;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse the raw value of a `/provenance_json` dataset, as any reader backend
 * surfaces it (string, length-1 array, bytes, `{ value }`). Returns `undefined`
 * when it is absent, empty, not valid JSON, or not a JSON object, so callers
 * fall back to the metadata attribute instead of failing the load.
 */
export function decodeProvenanceDataset(
  value: unknown,
): Record<string, unknown> | undefined {
  let text: string | undefined;
  try {
    text = datasetValueToString(value);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a file's provenance as Python `read_provenance`: the
 * `/provenance_json` dataset when it holds a JSON object, else the `provenance`
 * key of the parsed `metadata/json` attribute (files written before the dataset
 * existed). `datasetValue` is `undefined` when the dataset is absent. Returns
 * `undefined` when neither source has provenance.
 */
export function resolveProvenance(
  datasetValue: unknown,
  metadataJson: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  const fromDataset =
    datasetValue === undefined
      ? undefined
      : decodeProvenanceDataset(datasetValue);
  if (fromDataset) return fromDataset;
  const fromAttr = metadataJson?.provenance;
  return isPlainObject(fromAttr) ? fromAttr : undefined;
}

/**
 * Serialize provenance for the `/provenance_json` dataset (compact separators,
 * like Python's `json.dumps(..., separators=(",", ":"))`). Returns `null` for
 * empty provenance: no dataset is written, as Python.
 */
export function encodeProvenanceJson(
  provenance: Record<string, unknown> | null | undefined,
): string | null {
  if (!provenance || Object.keys(provenance).length === 0) return null;
  return JSON.stringify(provenance);
}

/**
 * Serialize metadata to the JSON string stored in the `metadata/json`
 * attribute, keeping it within {@link METADATA_ATTR_SIZE_LIMIT} bytes. Port of
 * Python `_encode_metadata_attr`: when the blob is too large, droppable
 * top-level keys (everything but `version`/`skeletons`/`nodes`) are removed
 * largest-first until it fits. Nothing is lost from the file: provenance is in
 * `/provenance_json` and the other droppable keys are empty placeholders.
 *
 * `md` is not mutated.
 *
 * @param options.warn Emit a `console.warn` naming the dropped keys (default
 *   `true`). Callers that only compute the string for comparison pass `false`.
 * @throws {Error} If the protected keys alone exceed the limit.
 */
export function encodeMetadataAttr(
  md: Record<string, unknown>,
  options?: { warn?: boolean },
): string {
  let blob = JSON.stringify(md);
  if (byteLength(blob) <= METADATA_ATTR_SIZE_LIMIT) return blob;

  const originalSize = byteLength(blob);
  const kept: Record<string, unknown> = { ...md };
  const droppable = Object.keys(md)
    .filter((k) => !METADATA_PROTECTED_KEYS.has(k))
    .map((k) => ({ k, size: byteLength(JSON.stringify({ [k]: md[k] })) }))
    // Stable sort, so equal-size keys drop in insertion order (as Python's
    // sorted(..., reverse=True)).
    .sort((a, b) => b.size - a.size);
  const dropped: string[] = [];
  for (const { k } of droppable) {
    delete kept[k];
    dropped.push(k);
    blob = JSON.stringify(kept);
    if (byteLength(blob) <= METADATA_ATTR_SIZE_LIMIT) break;
  }

  const size = byteLength(blob);
  if (size > METADATA_ATTR_SIZE_LIMIT) {
    throw new Error(
      "Unable to fit Labels metadata within HDF5's " +
        `${METADATA_ATTR_SIZE_LIMIT}-byte attribute limit: the required ` +
        `skeletons/nodes metadata alone serializes to ${size} bytes. ` +
        "Reduce the number or size of the skeletons/nodes.",
    );
  }

  if (options?.warn ?? true) {
    console.warn(
      `Labels metadata JSON (${originalSize} bytes) exceeded the ` +
        `${METADATA_ATTR_SIZE_LIMIT}-byte HDF5 attribute limit; dropped top-level ` +
        `key(s) ${JSON.stringify(dropped)} from the 'metadata/json' attribute so ` +
        "the file could be saved. No data was lost: provenance is stored in the " +
        "'provenance_json' dataset and the other dropped keys are empty " +
        "placeholders whose data is stored in separate datasets.",
    );
  }
  return blob;
}
