// src/io/label-images-node.ts
//
// Node-only registration of a `node:fs`-backed TIFF reader for `loadLabelImages`.
//
// Imported by the Node entry point (`src/index.ts`) and the bun test preload
// (`bunfig.toml`), but NEVER by the browser entry. Keeps `node:fs` out of the
// browser module graph (issue #70), mirroring `seq-node.ts` / `node-fs-resolver.ts`.

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { setLabelImageFileReader } from "./label-images.js";

/**
 * Read a `.tif`/`.tiff` path. A file → its bytes; a directory → the bytes of its
 * `*.tif`/`*.tiff` entries, sorted alphanumerically (one file per frame),
 * matching Python `read_label_images`.
 */
async function readTiffPath(
  path: string
): Promise<Uint8Array | { files: Uint8Array[] }> {
  const stat = fs.statSync(path);
  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(path)
      .filter((name) => /\.tiff?$/i.test(name))
      .sort();
    const files = entries.map(
      (name) => new Uint8Array(fs.readFileSync(nodePath.join(path, name)))
    );
    return { files };
  }
  return new Uint8Array(fs.readFileSync(path));
}

setLabelImageFileReader(readTiffPath);

export { readTiffPath };
