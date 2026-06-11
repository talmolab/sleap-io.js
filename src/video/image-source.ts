// src/video/image-source.ts
//
// Pluggable "read image-file bytes by path" hook for `ImageVideoBackend`.
//
// Mirrors the FsResolver pattern (`src/model/matching.ts`): a settable override
// plus a registered default. The Node default lives in `node-image-reader.ts`,
// imported only by the Node entry point + the bun test preload — never by the
// browser entry — so `node:fs` stays out of the browser module graph (issue
// #70). In the browser, a consumer injects a reader (e.g. mapping basenames to
// user-picked `File` bytes); on desktop (Tauri) a `plugin-fs.readFile` reader.

export type ImageBytesReader = (path: string) => Promise<Uint8Array>;

let _reader: ImageBytesReader | null = null;
let _default: ImageBytesReader | null = null;

/** Override the image-bytes reader. Pass `null` to fall back to the default. */
export function setImageBytesReader(reader: ImageBytesReader | null): void {
  _reader = reader;
}

/** Register the DEFAULT reader (called by the Node-only `node-image-reader`). */
export function setDefaultImageBytesReader(reader: ImageBytesReader | null): void {
  _default = reader;
}

/** The effective reader: explicit override if set, else the registered default. */
export function getImageBytesReader(): ImageBytesReader | null {
  return _reader ?? _default;
}
