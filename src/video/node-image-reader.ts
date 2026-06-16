// src/video/node-image-reader.ts
//
// Node-only registration of a `node:fs`-backed default reader for
// `ImageVideoBackend` (image-sequence videos).
//
// Imported by the Node entry point (`src/index.ts`) and the bun test preload
// (`bunfig.toml`), but NEVER by the browser entry — keeping `node:fs` out of the
// browser module graph (issue #70), exactly like `node-fs-resolver.ts`,
// `seq-node.ts`, and `label-images-node.ts`.

import * as fs from "node:fs";
import { setDefaultImageBytesReader } from "./image-source.js";

/** Read an image file path to its raw bytes. */
async function nodeImageReader(path: string): Promise<Uint8Array> {
  return new Uint8Array(await fs.promises.readFile(path));
}

setDefaultImageBytesReader(nodeImageReader);

export { nodeImageReader };
