// src/video/seq-node.ts
//
// Node-only registration of a `node:fs`-backed byte source for `.seq` files.
//
// Imported by the Node entry point (`src/index.ts`) and the bun test preload
// (`bunfig.toml`), but NEVER by the browser entry (`src/index.browser.ts`).
// Keeping the `node:fs` reference out of the browser-reachable `seq-video.ts`
// ensures the browser module graph contains no Node-only imports (issue #70).

import * as fs from "node:fs";
import { setSeqFileByteSourceFactory, type ByteSource } from "./seq-video.js";

/** Random-access `.seq` byte source backed by a `node:fs` file descriptor. */
class NodeFileByteSource implements ByteSource {
  private path: string;
  private fd: number | null = null;
  private fileSize: number | null = null;

  constructor(path: string) {
    this.path = path;
  }

  private ensureOpen(): number {
    if (this.fd === null) {
      this.fd = fs.openSync(this.path, "r");
    }
    return this.fd;
  }

  async size(): Promise<number> {
    if (this.fileSize === null) {
      this.fileSize = fs.statSync(this.path).size;
    }
    return this.fileSize;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array(0);
    const fd = this.ensureOpen();
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, offset);
    // Copy into a standalone, exactly-sized Uint8Array (buf is not pooled here,
    // but a fresh buffer keeps byteOffset 0 for safe DataView construction).
    return new Uint8Array(buf.subarray(0, bytesRead));
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

setSeqFileByteSourceFactory((path) => new NodeFileByteSource(path));

export { NodeFileByteSource };
