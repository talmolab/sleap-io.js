/**
 * Node-only path-based COCO loaders (file I/O + image-path resolution).
 *
 * Wraps the browser-safe core in `coco.ts`. Reads the annotation JSON from disk
 * and installs a default fs-based image resolver replicating Python
 * `resolve_image_path` (direct path, common prefixes, recursive basename glob).
 */

import * as fs from "fs";
import * as path from "path";

import type { Labels } from "../model/labels.js";
import { readCoco, type ReadCocoOptions } from "./coco.js";

/**
 * Recursively search `root` for a file whose basename equals `base`. Returns the
 * first match (directory traversal order is filesystem-dependent), or null.
 */
function recursiveFindByBasename(root: string, base: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile()) {
      if (entry.name === base) return full;
    } else if (entry.isDirectory()) {
      const hit = recursiveFindByBasename(full, base);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Resolve a COCO `file_name` against a dataset root, replicating Python
 * `resolve_image_path`: try the direct path, then common prefixes, then a
 * recursive basename search. Returns null when unresolvable (image skipped).
 */
function resolveImagePath(
  fileName: string,
  datasetRoot: string,
): string | null {
  // 1. Direct path.
  let p = path.join(datasetRoot, fileName);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;

  // 2. Common prefixes.
  for (const prefix of ["images", "imgs", "data/images"]) {
    p = path.join(datasetRoot, prefix, fileName);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }

  // 3. Recursive basename search (matches Python's empty-prefix rglob).
  const base = path.basename(fileName);
  const hit = recursiveFindByBasename(datasetRoot, base);
  if (hit) return hit;

  return null;
}

/**
 * Read a COCO dataset from a JSON file on disk. Defaults `datasetRoot` to the
 * JSON file's directory and installs the fs-based image resolver unless the
 * caller supplied one. Mirrors Python `read_labels(json_path)`.
 */
export function loadCoco(
  jsonPath: string,
  options: ReadCocoOptions = {},
): Labels {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`COCO annotation file not found: ${jsonPath}`);
  }
  const text = fs.readFileSync(jsonPath, "utf-8");
  const datasetRoot = options.datasetRoot ?? path.dirname(jsonPath);
  const resolveImage =
    options.resolveImage ??
    ((fileName: string, root: string | undefined) =>
      resolveImagePath(fileName, root ?? datasetRoot));
  return readCoco(text, { ...options, datasetRoot, resolveImage });
}

/**
 * Read multiple COCO splits from a directory of `*.json` annotation files. When
 * `jsonFiles` is omitted, discovers all top-level `.json` files (non-recursive).
 * Split names are filename stems. Tracks are independent per split. Mirrors
 * Python `read_labels_set`.
 */
export function loadCocoSet(
  datasetPath: string,
  options: ReadCocoOptions & { jsonFiles?: string[] } = {},
): Record<string, Labels> {
  const { jsonFiles, ...readOptions } = options;
  let files = jsonFiles;
  if (files === undefined) {
    files = fs.readdirSync(datasetPath).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      throw new Error(`No JSON annotation files found in ${datasetPath}`);
    }
  }

  const result: Record<string, Labels> = {};
  for (const file of files) {
    const splitName = path.basename(file, ".json");
    const labels = loadCoco(path.join(datasetPath, file), {
      ...readOptions,
      datasetRoot: datasetPath,
    });
    labels.provenance = { ...labels.provenance, split: splitName };
    result[splitName] = labels;
  }
  return result;
}
