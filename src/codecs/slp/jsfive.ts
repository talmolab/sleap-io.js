/**
 * jsfive-based HDF5 file interface.
 * Pure JavaScript implementation for Workers-compatible environments.
 */

import * as hdf5 from "jsfive";

export type JsfiveSource = ArrayBuffer | Uint8Array;

export interface JsfiveDataset {
  value: unknown;
  shape: number[];
  dtype: string;
  attrs: Record<string, unknown>;
}

export interface JsfiveGroup {
  keys: string[];
  attrs: Record<string, unknown>;
  get(path: string): JsfiveDataset | JsfiveGroup | null;
}

export interface JsfiveFile {
  get(path: string): JsfiveDataset | JsfiveGroup | null;
  keys: string[];
  close(): void;
}

/**
 * Open an HDF5 file using jsfive (pure JavaScript, no WASM).
 *
 * @param source - ArrayBuffer or Uint8Array containing the HDF5 file
 * @param filename - Optional filename hint for error messages
 * @returns JsfiveFile interface for reading the file
 */
export function openJsfiveFile(source: JsfiveSource, filename?: string): JsfiveFile {
  let buffer: ArrayBuffer;
  if (source instanceof Uint8Array) {
    // Create a proper ArrayBuffer copy to avoid SharedArrayBuffer issues
    const slice = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    buffer = slice as ArrayBuffer;
  } else {
    buffer = source;
  }
  const file = new hdf5.File(buffer, filename ?? "data.slp");

  return {
    get: (path: string): JsfiveDataset | JsfiveGroup | null => {
      try {
        const item = file.get(path);
        if (!item) return null;
        return item as JsfiveDataset | JsfiveGroup;
      } catch {
        return null;
      }
    },
    keys: file.keys as string[],
    close: () => {
      // jsfive doesn't need explicit close
    },
  };
}

/**
 * Check if an item is a jsfive dataset (has value property).
 */
export function isDataset(item: JsfiveDataset | JsfiveGroup | null): item is JsfiveDataset {
  if (!item) return false;
  return "value" in item || "shape" in item;
}

/**
 * Check if an item is a jsfive group (has keys property but no value).
 */
export function isGroup(item: JsfiveDataset | JsfiveGroup | null): item is JsfiveGroup {
  if (!item) return false;
  return "keys" in item && !("value" in item);
}

/**
 * Safely get attributes from a dataset or group.
 */
export function getAttrs(item: JsfiveDataset | JsfiveGroup | null): Record<string, unknown> {
  if (!item) return {};
  return (item.attrs ?? {}) as Record<string, unknown>;
}

/**
 * Safely get the shape of a dataset.
 */
export function getShape(item: JsfiveDataset | JsfiveGroup | null): number[] {
  if (!item || !isDataset(item)) return [];
  return item.shape ?? [];
}

/**
 * Safely get the value of a dataset.
 */
export function getValue(item: JsfiveDataset | JsfiveGroup | null): unknown {
  if (!item || !isDataset(item)) return null;
  try {
    return item.value;
  } catch {
    // jsfive throws on compound datasets
    return null;
  }
}
